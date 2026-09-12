"""新增工具与既有工具测试共用的脚手架（不联网、不碰真实输出目录）。

- venv 里没有 pytest，所以统一用 stdlib unittest（与 tests/test_file_job_store.py 同风格）
- 所有媒体素材都用 `ffmpeg -f lavfi` 现场生成，测试不依赖网络
- 所有 job 都跑在临时 STORAGE_PATH / 输出目录里，跑完即清理
"""

import json
import os
import subprocess
import sys
import tempfile
import unittest
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.ffmpeg import get_ffmpeg_path  # noqa: E402
from app.file_job_store import jobs_dir  # noqa: E402
from app.storage_paths import results_dir  # noqa: E402
from app.tasks import process_job  # noqa: E402

CREATE_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0


def ffmpeg_path() -> str:
    return get_ffmpeg_path()


def ffprobe_path() -> str:
    exe = Path(ffmpeg_path())
    cand = exe.with_name(exe.name.replace("ffmpeg", "ffprobe", 1))
    return str(cand) if cand.is_file() else "ffprobe"


def run_tool_cmd(args, timeout: int = 180) -> subprocess.CompletedProcess:
    return subprocess.run(
        args, capture_output=True, text=True, encoding="utf-8", errors="replace",
        timeout=timeout, creationflags=CREATE_NO_WINDOW,
    )


def make_video(path, duration: float = 5, size: str = "320x240", rate: int = 10,
               gop: int = 10, audio: bool = True) -> str:
    """生成一段确定性的小视频（关键帧每 gop 帧一个，便于验证流复制裁剪）。"""
    args = [
        ffmpeg_path(), "-y", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", f"testsrc=duration={duration}:size={size}:rate={rate}",
    ]
    if audio:
        args += ["-f", "lavfi", "-i", f"sine=frequency=440:duration={duration}"]
    args += ["-c:v", "libx264", "-preset", "ultrafast", "-g", str(gop), "-pix_fmt", "yuv420p"]
    if audio:
        args += ["-c:a", "aac", "-b:a", "96k", "-shortest"]
    args += [str(path)]
    result = run_tool_cmd(args)
    if result.returncode != 0:
        raise RuntimeError(f"生成测试视频失败: {result.stderr[-400:]}")
    return str(path)


def make_audio(path, duration: float = 4, fmt: str = "mp3") -> str:
    """生成一段确定性的小音频（mp3 / wav / flac / ogg / m4a / aac / opus / wma / aiff）。

    统一用 48kHz 采样：libopus 不接受 44.1kHz，其它编码器也都支持 48kHz。
    """
    codec = {
        "mp3": ["-c:a", "libmp3lame", "-b:a", "128k"],
        "wav": ["-c:a", "pcm_s16le"],
        "flac": ["-c:a", "flac"],
        "ogg": ["-c:a", "libvorbis", "-b:a", "128k"],
        "m4a": ["-c:a", "aac", "-b:a", "128k"],
        "aac": ["-c:a", "aac", "-b:a", "128k"],
        "opus": ["-c:a", "libopus", "-b:a", "96k", "-ar", "48000"],
        "wma": ["-c:a", "wmav2", "-b:a", "128k"],
        "aiff": ["-c:a", "pcm_s16be"],
    }.get(fmt, ["-c:a", "libmp3lame", "-b:a", "128k"])
    args = [
        ffmpeg_path(), "-y", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", f"sine=frequency=440:duration={duration}:sample_rate=48000",
    ] + codec + [str(path)]
    result = run_tool_cmd(args)
    if result.returncode != 0:
        raise RuntimeError(f"生成测试音频失败: {result.stderr[-400:]}")
    return str(path)


def probe_duration(path) -> float:
    result = run_tool_cmd([
        ffprobe_path(), "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", str(path),
    ], timeout=60)
    text = (result.stdout or "").strip()
    return float(text) if text else float("nan")


def stream_types(path) -> set:
    result = run_tool_cmd([
        ffprobe_path(), "-v", "error", "-show_entries", "stream=codec_type",
        "-of", "default=noprint_wrappers=1:nokey=1", str(path),
    ], timeout=60)
    return {line.strip() for line in (result.stdout or "").splitlines() if line.strip()}


class WorkerToolTest(unittest.TestCase):
    """基类：临时目录 + 隔离的 STORAGE_PATH / 输出目录 + 一键跑 job。"""

    _ENV_KEYS = ("STORAGE_PATH", "FURINAKIT_DEFAULT_OUTPUT_DIR", "FURINAKIT_SETTINGS_FILE")

    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory(prefix="furinakit_test_")
        self.tmp = Path(self._tmp.name)
        self.work = self.tmp / "work"
        self.work.mkdir(parents=True, exist_ok=True)
        self._saved_env = {key: os.environ.get(key) for key in self._ENV_KEYS}
        os.environ["STORAGE_PATH"] = str(self.tmp / "storage")
        os.environ["FURINAKIT_DEFAULT_OUTPUT_DIR"] = str(self.tmp / "output")
        # 指向不存在的设置文件，确保不会读到用户真实的 Electron 输出目录
        os.environ["FURINAKIT_SETTINGS_FILE"] = str(self.tmp / "missing-settings.json")
        if not Path(ffmpeg_path()).exists() and not str(ffmpeg_path()).endswith("ffmpeg"):
            self.skipTest("找不到 ffmpeg，跳过需要 ffmpeg 的测试")

    def tearDown(self):
        for key, value in self._saved_env.items():
            if value is None:
                os.environ.pop(key, None)
            else:
                os.environ[key] = value
        self._tmp.cleanup()

    # -- 走真实的 tasks.py 分发链路 -------------------------------------
    def run_job(self, tool_id: str, payload: dict, use_file: bool = True) -> dict:
        """模拟 worker 主循环：写 job 文件 → process_job → 读回终态。"""
        job_id = str(uuid.uuid4())
        job = {
            "jobId": job_id, "toolId": tool_id, "payload": payload,
            "status": "pending", "progress": 0, "createdAt": "test",
        }
        (jobs_dir() / f"{job_id}.json").write_text(json.dumps(job), encoding="utf-8")
        process_job(job_id, tool_id, payload, use_file=use_file)
        final = json.loads((jobs_dir() / f"{job_id}.json").read_text(encoding="utf-8"))
        final["_job_id"] = job_id
        name = final.get("resultFilename")
        if name:
            final["_result_path"] = results_dir() / f"{job_id}-{name}"
        return final

    def assert_job_ok(self, job: dict) -> Path:
        self.assertEqual(job.get("status"), "completed",
                         f"任务没有成功: status={job.get('status')} error={job.get('error')}")
        self.assertEqual(job.get("progress"), 100)
        self.assertTrue(job.get("resultFilename"), "没有 resultFilename，前端拿不到结果")
        self.assertTrue(job.get("resultMimeType"), "没有 resultMimeType")
        path = Path(job["_result_path"])
        self.assertTrue(path.is_file(), f"结果文件不存在: {path}")
        self.assertGreater(path.stat().st_size, 0, "结果文件是空的")
        return path

    def assert_job_failed(self, job: dict, *needles: str) -> str:
        self.assertEqual(job.get("status"), "failed",
                         f"任务本该失败但状态是 {job.get('status')}")
        error = str(job.get("error") or "")
        for needle in needles:
            self.assertIn(needle, error, f"错误信息里没有「{needle}」: {error}")
        return error
