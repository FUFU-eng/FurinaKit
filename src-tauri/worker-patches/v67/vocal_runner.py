"""V67: supervised, per-task MDX process; no queue/config imports in render mode."""
from __future__ import annotations
import json
import os
import subprocess
import sys
import time
from pathlib import Path


def _write(path: Path, data: dict) -> None:
    temp = path.with_name(path.name + ".writing")
    temp.write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")
    os.replace(temp, path)


def render_cli(request_path: str) -> None:
    request = json.loads(Path(request_path).read_text(encoding="utf-8"))
    progress_path = Path(request["progress"])
    sequence = 0
    def report(percent: int, message: str) -> None:
        nonlocal sequence
        sequence += 1
        _write(progress_path, {"seq": sequence, "percent": percent, "message": message})
    try:
        report(11, "正在载入分离引擎…")
        from app.tools import vocal_separate
        result = vocal_separate.separate(request["input"], request["output"], request["model"], progress=report)
        _write(Path(request["result"]), {"ok": True, "result": result})
    except Exception as exc:
        _write(Path(request["result"]), {"ok": False, "error": str(exc)})
        raise SystemExit(1)


def separate(audio_path: str, output_dir: str, model_path: str, progress, cancelled=None) -> dict:
    if getattr(sys, "frozen", False):
        raise RuntimeError("当前分离运行库不支持独立任务模式，请更新运行库 / Update the separation runtime")
    worker = Path(__file__).resolve().parents[2] / "worker.py"
    if not worker.is_file():
        raise RuntimeError("分离运行库入口缺失 / Separation runtime entry is missing")
    directory = Path(output_dir)
    directory.mkdir(parents=True, exist_ok=True)
    request_path, progress_path, result_path = (directory / name for name in ("request.json", "progress.json", "result.json"))
    _write(request_path, {"input": str(Path(audio_path).resolve()), "output": str(directory.resolve()),
                          "model": str(Path(model_path).resolve()), "progress": str(progress_path.resolve()), "result": str(result_path.resolve())})
    env = os.environ.copy()
    env.update({"OMP_NUM_THREADS": "2", "OPENBLAS_NUM_THREADS": "2", "MKL_NUM_THREADS": "2"})
    flags = getattr(subprocess, "CREATE_NO_WINDOW", 0)
    progress(11, "正在启动独立分离进程…")
    started = changed = time.monotonic()
    sequence, percent, message = -1, 11, "正在载入分离引擎…"
    with (directory / "engine.log").open("wb") as log:
        child = subprocess.Popen([sys.executable, str(worker), "--vocal-render", str(request_path.resolve())],
                                 cwd=str(worker.parent), env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=log, creationflags=flags)
        try:
            while True:
                if cancelled and cancelled():
                    raise RuntimeError("任务已取消 / Task cancelled")
                state = None
                try:
                    state = json.loads(progress_path.read_text(encoding="utf-8"))
                    next_sequence = int(state["seq"])
                    next_percent = int(state["percent"])
                    next_message = str(state["message"])
                except (OSError, ValueError, KeyError, TypeError):
                    state = None  # Not published yet; never invent progress.
                if state is not None and next_sequence != sequence:
                    sequence = next_sequence
                    percent, message = max(percent, min(97, next_percent)), next_message
                    changed = time.monotonic()
                    progress(percent, message)  # Storage/callback failures must not be swallowed.
                code = child.poll()
                if code is not None:
                    break
                # A deadline is an explicit failure, not a fabricated completion/heartbeat.
                limit = 300 if percent < 20 else 600
                if time.monotonic() - changed > limit:
                    raise RuntimeError(f"分离阶段超时：{message}。该阶段超过 {limit} 秒没有完成；请缩短音频或检查模型运行库 / Separation stage timed out")
                if time.monotonic() - started > 7200:
                    raise RuntimeError("分离任务超过两小时上限，请分段处理 / Split this long audio into shorter sections")
                time.sleep(0.25)
            if not result_path.is_file():
                raise RuntimeError(f"分离进程异常退出（代码 {code}），请检查模型运行库 / Separation process exited unexpectedly")
            result = json.loads(result_path.read_text(encoding="utf-8"))
            if not result.get("ok"):
                raise RuntimeError(result.get("error") or "分离未完成 / Separation failed")
            if code != 0:
                raise RuntimeError("分离进程未正常结束 / Separation process did not exit successfully")
            return result["result"]
        finally:
            # Only the child created for this exact user-requested task; never an existing worker/app.
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=5)
