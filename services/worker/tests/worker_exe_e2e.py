"""在**打包后的 furinakit-worker.exe** 上真跑任务并校验产物内容（不是只在 venv 里跑）。

用法：
    .venv\\Scripts\\python.exe tests\\worker_exe_e2e.py <exe路径> [scenario ...]

scenario 可选（缺省全部）：
    pdf-to-excel      —— 触发 openpyxl 写 xlsx（读回断言是真 xlsx）
    images-to-pdf     —— 既有能力回归（fitz 读回页数）
    video-compress    —— 既有能力回归（时长）
    video-trim        —— 新增能力（时长 + 容器）
    video-trim-mkv    —— container=same：mkv 源必须交付 .mkv
    audio-trim        —— 新增能力（时长 + 有音轨）
    video-frame-extract
    csv-excel         —— 中文 CSV 名 → 交付名必须是 数据.xlsx（_safe_filename 修复证据）
    markdown-to-pdf   —— **用 PyMuPDF 把中文从产出的 PDF 里读回来**（打包版证据）

工作机制与前端一致：写 jobs/<uuid>.json + queue/<毫秒>-<uuid>.json，
启动 exe（独立 STORAGE_PATH / 输出目录），轮询任务终态，校验产物，最后关掉进程树。
"""

import json
import os
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.ffmpeg import get_ffmpeg_path  # noqa: E402
from tests._job_harness import ffprobe_path, make_audio, make_video, run_tool_cmd  # noqa: E402

CREATE_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0
ALL_SCENARIOS = ["pdf-to-excel", "images-to-pdf", "video-compress",
                 "video-trim", "video-trim-mkv", "audio-trim", "video-frame-extract",
                 "csv-excel", "markdown-to-pdf"]

MD_TEXT = "# 打包版中文标题\n\n这是打包版里的中文正文，用来验证中文真的被写进了 PDF。\n\n- 列表项一\n\n```python\ndef 中文函数():\n    return \"hello 世界\"\n```\n"
MD_PROBES = ["打包版中文标题", "打包版里的中文正文", "列表项一", "def 中文函数", "hello 世界"]

# 场景名 → 真实 tool id（场景名只是给人看的，允许比 tool id 更细）
TOOL_FOR = {"video-trim-mkv": "video-trim"}


def build_fixtures(tmp: Path) -> dict:
    fixtures = {}
    fixtures["video"] = make_video(tmp / "clip.mp4", duration=5, gop=10)
    fixtures["mkv"] = make_video(tmp / "clip.mkv", duration=3, gop=10)
    fixtures["mp3"] = make_audio(tmp / "tone.mp3", duration=4)

    import pymupdf
    doc = pymupdf.open()
    page = doc.new_page(width=300, height=200)
    page.insert_text((40, 80), "PDF to excel 測試")
    fixtures["pdf"] = str(tmp / "table.pdf")
    doc.save(fixtures["pdf"])
    doc.close()

    from PIL import Image
    fixtures["png1"] = str(tmp / "a.png")
    fixtures["png2"] = str(tmp / "b.png")
    Image.new("RGB", (200, 150), (255, 0, 0)).save(fixtures["png1"])
    Image.new("RGB", (200, 150), (0, 0, 255)).save(fixtures["png2"])

    # 中文文件名 + 前导 0 编号 + 含逗号字段：同时验证 _safe_filename 与单元格类型
    csv_path = tmp / "数据.csv"
    csv_path.write_text("姓名,备注,编号,数量\n张三,\"含,逗号\",007,12\n李四,普通,00123,30\n",
                        encoding="utf-8", newline="")
    fixtures["csv"] = str(csv_path)
    return fixtures


def payload_for(scenario: str, fixtures: dict) -> dict:
    if scenario == "pdf-to-excel":
        return {"file": fixtures["pdf"]}
    if scenario == "images-to-pdf":
        return {"files": [fixtures["png1"], fixtures["png2"]], "merge_mode": "merge"}
    if scenario == "video-compress":
        return {"file": fixtures["video"], "quality": "low"}
    if scenario == "video-trim":
        return {"file": fixtures["video"], "start": "1", "end": "3", "mode": "precise"}
    if scenario == "video-trim-mkv":
        return {"file": fixtures["mkv"], "start": "1", "end": "2", "mode": "fast"}
    if scenario == "audio-trim":
        return {"file": fixtures["mp3"], "start": "1", "end": "3", "mode": "fast"}
    if scenario == "video-frame-extract":
        return {"file": fixtures["video"], "time": "1.5", "format": "jpg", "width": "160"}
    if scenario == "csv-excel":
        return {"file": fixtures["csv"], "direction": "auto", "has_header": "true"}
    if scenario == "markdown-to-pdf":
        return {"text": MD_TEXT, "page_size": "a4", "font_size": "12"}
    raise SystemExit(f"未知场景: {scenario}")


def ffprobe_duration(path: Path) -> float:
    result = run_tool_cmd([ffprobe_path(), "-v", "error", "-show_entries", "format=duration",
                           "-of", "default=noprint_wrappers=1:nokey=1", str(path)], timeout=60)
    try:
        return float((result.stdout or "").strip())
    except ValueError:
        return float("nan")


def verify(scenario: str, path: Path, job: dict) -> list:
    """返回校验失败的原因列表（空列表 = 通过）。"""
    problems = []
    import pymupdf
    from openpyxl import load_workbook
    from PIL import Image

    if scenario == "pdf-to-excel":
        wb = load_workbook(str(path))
        ws = wb.active
        if ws.max_row < 1:
            problems.append("xlsx 里没有内容")
        wb.close()
    elif scenario == "images-to-pdf":
        doc = pymupdf.open(str(path))
        if doc.page_count != 2:
            problems.append(f"PDF 页数应为 2，实际 {doc.page_count}")
        doc.close()
    elif scenario == "video-compress":
        duration = ffprobe_duration(path)
        if not (4.0 <= duration <= 6.0):
            problems.append(f"压缩后时长异常: {duration}")
    elif scenario == "video-trim":
        duration = ffprobe_duration(path)
        if not (1.5 <= duration <= 2.6):
            problems.append(f"裁剪后时长异常: {duration}")
        if not path.name.endswith(".mp4"):
            problems.append(f"mp4 源应交付 .mp4，实际 {path.name}")
    elif scenario == "video-trim-mkv":
        if not path.name.endswith(".mkv"):
            problems.append(f"mkv 源应交付 .mkv（container=same），实际 {path.name}")
        if job.get("resultMimeType") != "video/x-matroska":
            problems.append(f"mime 应为 video/x-matroska，实际 {job.get('resultMimeType')}")
        duration = ffprobe_duration(path)
        if not (0.8 <= duration <= 2.4):
            problems.append(f"mkv 裁剪后时长异常: {duration}")
    elif scenario == "audio-trim":
        duration = ffprobe_duration(path)
        if not (1.5 <= duration <= 2.6):
            problems.append(f"音频裁剪后时长异常: {duration}")
    elif scenario == "video-frame-extract":
        with Image.open(path) as img:
            if img.size != (160, 120):
                problems.append(f"缩略图尺寸应为 (160, 120)，实际 {img.size}")
    elif scenario == "csv-excel":
        if job.get("resultFilename") != "数据.xlsx":
            problems.append(f"中文 CSV 名应交付 数据.xlsx，实际 {job.get('resultFilename')!r}")
        wb = load_workbook(str(path))
        ws = wb.active
        if ws["A2"].value != "张三":
            problems.append(f"A2 应为 张三，实际 {ws['A2'].value!r}")
        if ws["B2"].value != "含,逗号":
            problems.append(f"含逗号字段应完整保留，实际 {ws['B2'].value!r}")
        if ws["C2"].value != "007" or ws["C2"].data_type != "s":
            problems.append(f"前导 0 编号必须保持文本，实际 {ws['C2'].value!r}/{ws['C2'].data_type}")
        if ws["D2"].value != 12 or ws["D2"].data_type != "n":
            problems.append(f"普通数字必须是真数字，实际 {ws['D2'].value!r}/{ws['D2'].data_type}")
        if not ws["A1"].font.bold or ws.freeze_panes != "A2":
            problems.append("has_header=true 时表头应加粗并冻结首行")
        wb.close()
    elif scenario == "markdown-to-pdf":
        doc = pymupdf.open(str(path))
        text = "\n".join(page.get_text() for page in doc)
        pages = doc.page_count
        doc.close()
        if pages < 1:
            problems.append("PDF 页数应 ≥ 1")
        for probe in MD_PROBES:
            if probe not in text:
                problems.append(f"PDF 文本里读不到「{probe}」")
    return problems


def wait_for_job(jobs_dir: Path, job_id: str, timeout: float) -> dict:
    deadline = time.time() + timeout
    last = {}
    while time.time() < deadline:
        path = jobs_dir / f"{job_id}.json"
        if path.exists():
            try:
                last = json.loads(path.read_text(encoding="utf-8"))
            except ValueError:
                last = {}
            if last.get("status") in ("completed", "failed"):
                return last
        time.sleep(0.5)
    return last


def main(argv: list) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    exe = Path(argv[1])
    if not exe.is_file():
        print(f"[X] 找不到 exe: {exe}")
        return 2
    scenarios = argv[2:] or ALL_SCENARIOS

    tmp = Path(tempfile.mkdtemp(prefix="furinakit_exe_e2e_"))
    fixtures = build_fixtures(tmp)
    storage = tmp / "storage"
    output = tmp / "output"
    (storage / "jobs").mkdir(parents=True, exist_ok=True)
    (storage / "queue").mkdir(parents=True, exist_ok=True)
    output.mkdir(parents=True, exist_ok=True)

    env = dict(os.environ)
    env.update({
        "STORAGE_PATH": str(storage),
        "FURINAKIT_DEFAULT_OUTPUT_DIR": str(output),
        "FURINAKIT_SETTINGS_FILE": str(tmp / "missing-settings.json"),
        "USE_FILE_QUEUE": "true",
        "MAX_CONCURRENT_JOBS": "1",
    })

    print(f"exe: {exe}  ({exe.stat().st_size / 1048576:.1f} MB)")
    print(f"临时 STORAGE_PATH={storage}")
    print()
    print("启动 worker...")
    proc = subprocess.Popen([str(exe)], cwd=str(tmp), env=env,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                            text=True, encoding="utf-8", errors="replace",
                            creationflags=CREATE_NO_WINDOW)

    failures = 0
    try:
        for scenario in scenarios:
            job_id = str(uuid.uuid4())
            tool_id = TOOL_FOR.get(scenario, scenario)
            payload = payload_for(scenario, fixtures)
            job = {"jobId": job_id, "toolId": tool_id, "payload": payload,
                   "status": "pending", "progress": 0, "createdAt": "e2e"}
            (storage / "jobs" / f"{job_id}.json").write_text(json.dumps(job), encoding="utf-8")
            queue_name = f"{int(time.time() * 1000)}-{job_id}.json"
            (storage / "queue" / queue_name).write_text(json.dumps(job), encoding="utf-8")

            result = wait_for_job(storage / "jobs", job_id, timeout=240)
            status = result.get("status")
            name = result.get("resultFilename")
            produced = output / f"{job_id}-{name}" if name else None
            print(f"[{scenario}] status={status}")
            if status != "completed":
                print(f"    error={result.get('error')!r}")
                failures += 1
                print()
                continue
            size = produced.stat().st_size if produced and produced.is_file() else -1
            print(f"    resultFilename={name!r}  mime={result.get('resultMimeType')}  大小={size} 字节")
            if result.get("message"):
                print(f"    message={result['message']}")
            if size <= 0:
                print("    [X] 结果文件不存在或是空的")
                failures += 1
                print()
                continue
            problems = verify(scenario, produced, result)
            if problems:
                failures += 1
                for problem in problems:
                    print(f"    [X] {problem}")
            else:
                print("    [OK] 产物内容校验通过")
            print()
    finally:
        # onefile 的 exe 是「引导进程 + 真正的 worker 子进程」，只 terminate 父进程会留下
        # 一个占着 exe 和临时目录的子进程，所以 Windows 上直接按进程树强杀。
        if sys.platform == "win32":
            subprocess.run(["taskkill", "/PID", str(proc.pid), "/T", "/F"],
                           capture_output=True, creationflags=CREATE_NO_WINDOW)
        else:
            proc.terminate()
        try:
            out, _ = proc.communicate(timeout=15)
        except subprocess.TimeoutExpired:
            proc.kill()
            out = ""
        tail = [line for line in (out or "").splitlines() if line.strip()][-6:]
        if tail:
            print("worker 日志尾部:")
            for line in tail:
                print("   ", line)

    print()
    print(f"结论：{len(scenarios) - failures}/{len(scenarios)} 个任务成功且产物校验通过")
    print(f"（临时目录保留供检查：{tmp}）")
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
