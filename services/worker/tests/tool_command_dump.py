"""临时取证脚本：打印真实使用的 ffmpeg 命令行 + 中文 PDF 读回证据。用完即删。"""
import os
import sys
import tempfile
from pathlib import Path
from unittest import mock

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

import pymupdf as fitz  # noqa: E402

from app.tools import audio_trim, markdown_pdf, video_trim  # noqa: E402
from app.tools.media_probe import run_process as real_run  # noqa: E402
from tests._job_harness import make_audio, make_video, probe_duration  # noqa: E402


def dump(cmd):
    print("   $" + " ".join(f'"{c}"' if " " in str(c) else str(c) for c in cmd))


def traced(cmd, timeout=None):
    """打印真实命令行后再真的执行，保证贴出来的是实际跑的东西。"""
    dump(cmd)
    return real_run(cmd, timeout=timeout or 900)


def main():
    tmp = Path(tempfile.mkdtemp(prefix="furinakit_evidence_"))
    video = make_video(tmp / "clip.mp4", duration=5, gop=10)
    audio = make_audio(tmp / "tone.mp3", duration=4)
    print(f"素材: {video} ({probe_duration(video):.2f}s) / {audio} ({probe_duration(audio):.2f}s)")
    print()

    print("=== video-trim mode=fast ===")
    with mock.patch.object(video_trim, "run_process", traced):
        result = video_trim.trim_video(video, str(tmp / "fast.mp4"), start="00:00:01", end="00:00:03", mode="fast")
    print(f"   结果: success={result['success']} 输出时长={probe_duration(tmp / 'fast.mp4'):.2f}s")
    print(f"   消息: {result.get('message')}")
    print()

    print("=== video-trim mode=precise ===")
    with mock.patch.object(video_trim, "run_process", traced):
        result = video_trim.trim_video(video, str(tmp / "precise.mp4"), start="00:00:01", end="00:00:03", mode="precise")
    print(f"   结果: success={result['success']} 输出时长={probe_duration(tmp / 'precise.mp4'):.2f}s")
    print()

    print("=== video-trim 流复制不可用时的自动回退（模拟 copy 失败）===")

    def failing_copy(cmd, timeout=None):
        if "copy" in cmd:
            dump(cmd)
            print("   (模拟这一步失败)")
            class R:
                returncode = 1
                stdout = ""
                stderr = "simulated failure"
            return R()
        return traced(cmd, timeout)

    with mock.patch.object(video_trim, "run_process", failing_copy):
        result = video_trim.trim_video(video, str(tmp / "fb.mp4"), start="1", end="2", mode="fast")
    print(f"   结果: success={result['success']} 消息: {result.get('message')}")
    print()

    print("=== video-frame-extract (time=1.5, format=jpg, width=160) ===")
    with mock.patch.object(video_trim, "run_process", traced):
        result = video_trim.extract_thumbnail(video, str(tmp / "frame.jpg"), time="1.5", fmt="jpg", width="160")
    print(f"   结果: success={result['success']} 文件大小={os.path.getsize(tmp / 'frame.jpg')} 字节")
    print()

    print("=== audio-trim mode=fast (mp3) ===")
    with mock.patch.object(audio_trim, "run_process", traced):
        result = audio_trim.trim_audio(audio, str(tmp / "trim.mp3"), start="1", end="3", mode="fast")
    print(f"   结果: success={result['success']} 消息: {result.get('message')}")
    print()

    print("=== audio-trim mode=precise (mp3) ===")
    with mock.patch.object(audio_trim, "run_process", traced):
        result = audio_trim.trim_audio(audio, str(tmp / "trim_p.mp3"), start="1", end="3", mode="precise")
    print(f"   结果: success={result['success']} 输出时长={probe_duration(tmp / 'trim_p.mp3'):.2f}s")
    print()

    print("=== markdown-to-pdf 中文读回证据 ===")
    md = ("# 中文一级标题\n\n这是一段中文正文，验证中文抽取。\n\n"
          "- 列表项一\n\n```python\ndef 中文函数():\n    return \"hello 世界\"\n```\n")
    out = tmp / "document.pdf"
    result = markdown_pdf.markdown_to_pdf(text=md, output_path=str(out))
    doc = fitz.open(str(out))
    text = doc[0].get_text()
    print(f"   结果: success={result['success']} 页数={doc.page_count} 大小={os.path.getsize(out)} 字节")
    print(f"   get_text() 读回: {text!r}")
    doc.close()
    print()

    print("=== 错误信息样例（中文人话）===")
    for label, call in (
        ("end<=start", lambda: video_trim.trim_video(video, str(tmp / "x.mp4"), start=4, end=2)),
        ("非法时间格式", lambda: video_trim.trim_video(video, str(tmp / "x.mp4"), start="abc")),
        ("开始超出时长", lambda: video_trim.trim_video(video, str(tmp / "x.mp4"), start=30)),
        ("抽帧超出时长", lambda: video_trim.extract_thumbnail(video, str(tmp / "x.png"), time="30")),
        ("音频格式不支持", lambda: audio_trim.trim_audio(video, str(tmp / "x.mp3"))),
    ):
        print(f"   {label}: {call().get('error')}")


if __name__ == "__main__":
    main()
