import os
import re
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Callable, Optional

from app.config import settings
from app.storage_paths import results_dir

ProgressCb = Optional[Callable[[int, str], None]]

_PERCENT = re.compile(r"(\d{1,3}(?:\.\d+)?)%")


def _auth_args() -> list[str]:
    """Authentication for login-gated content (Instagram, age-restricted X/Twitter,
    private/members-only videos). Opt-in via the worker's config (.env):

      COOKIES_FILE=C:\\path\\cookies.txt                  → a Netscape cookies.txt.
      COOKIES_FROM_BROWSER=firefox|brave|edge|chrome|...  → yt-dlp reads cookies
          directly from that browser's profile.

    A valid cookies file takes precedence, so a leftover browser setting won't
    override an explicit export. yt-dlp rewrites the cookies file after each run
    to persist refreshed session tokens, but that rewrite can silently drop
    cookies for domains/flags it doesn't fully recognize, degrading the session
    over repeated runs. So we hand it a disposable copy instead of the master file.
    """
    cookies_file = settings.cookies_file.strip()
    if cookies_file and os.path.isfile(cookies_file):
        scratch = os.path.join(tempfile.gettempdir(), f"omnikit-cookies-{os.getpid()}.txt")
        shutil.copyfile(cookies_file, scratch)
        return ["--cookies", scratch]
    browser = settings.cookies_from_browser.strip()
    if browser:
        return ["--cookies-from-browser", browser]
    return []


def _build_format_args(format_type: str, quality: str) -> list[str]:
    if format_type == "mp3":
        # quality: "best" → VBR 0, "320"/"192"/"128" → CBR in kbps
        audio_q = "0" if quality == "best" else f"{quality}K"
        return ["-x", "--audio-format", "mp3", "--audio-quality", audio_q]

    heights = {"1080": 1080, "720": 720, "480": 480}
    height = heights.get(quality)
    if height:
        selector = f"bestvideo[height<={height}]+bestaudio/best[height<={height}]/best"
    else:
        selector = "bestvideo+bestaudio/best"
    return ["-f", selector, "--merge-output-format", "mp4"]


def _friendly_error(output: str) -> str:
    text = output.lower()
    if "no video could be found in this tweet" in text or "no media found" in text:
        return "该推文中未找到视频或动图（可能仅包含纯文字、静态图片，或推文已被删除/设为仅关注者可见）"
    if "from a protected account" in text or "protected" in text:
        return "该推文来自私密/上锁账号，无法直接提取"
    if "private video" in text or "sign in" in text:
        return "该视频为私密内容或需要登录账号后才能查看"
    if "video unavailable" in text or "removed" in text:
        return "该视频已失效或已被作者删除"
    if "is not available in your country" in text or "geo" in text:
        return "该视频受到地区版权限制，请尝试切换代理节点"
    if "unsupported url" in text:
        return "不支持该链接格式，请确认输入正确的视频或推文链接"
    if "timeout" in text or "timed out" in text:
        return "请求超时，请检查网络连接或科学上网代理是否正常开启"
    if "10061" in text or "connection refused" in text or "proxyerror" in text:
        return "代理连接失败，请确认系统代理/梯子软件已正常开启并在运行"
    if "404" in text or "not found" in text:
        return "视频或推文不存在，链接可能失效或已被删除"
    if "403" in text or "forbidden" in text:
        return "访问受限 (403 Forbidden)，内容可能需登录或已被平台风控保护"
    if "412" in text:
        return "视频平台安全验证/反爬机制拦截，请稍后重试"
    # Fall back to the last meaningful line of yt-dlp output.
    lines = [l.strip() for l in output.splitlines() if l.strip()]
    return (lines[-1] if lines else "下载失败")[:300]


def download_video(
    url: str,
    format_type: str = "mp4",
    quality: str = "best",
    on_progress: ProgressCb = None,
) -> tuple[str, str, str]:
    output_dir = results_dir()
    output_template = str(output_dir / "%(title).200s-%(id)s.%(ext)s")

    # Invoke yt-dlp as a module via the worker's own interpreter. On Windows the
    # yt-dlp.exe script dir is often not on PATH, which would raise WinError 2.
    cmd = [
        sys.executable,
        "-m",
        "yt_dlp",
        url,
        "-o",
        output_template,
        "--no-playlist",
        "--restrict-filenames",
        "--newline",
        "--no-color",
        "--print",
        "after_move:filepath",
        *_auth_args(),
        *_build_format_args(format_type, quality),
    ]

    proc = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        bufsize=1,
    )

    candidates: list[str] = []
    tail: list[str] = []
    last_pct = -1

    assert proc.stdout is not None
    for raw in proc.stdout:
        line = raw.rstrip()
        if not line:
            continue
        tail.append(line)
        if len(tail) > 40:
            tail.pop(0)

        if "[download]" in line and "%" in line:
            match = _PERCENT.search(line)
            if match and on_progress:
                pct = int(float(match.group(1)))
                if pct != last_pct:
                    last_pct = pct
                    # Map raw download % into the worker's 40–95 band.
                    on_progress(40 + int(pct * 0.55), f"Downloading… {pct}%")
        elif not line.startswith("[") and not line.startswith("WARNING"):
            candidates.append(line)

    proc.wait()
    output = "\n".join(tail)

    if proc.returncode != 0:
        raise RuntimeError(_friendly_error(output))

    output_path = next((c for c in reversed(candidates) if Path(c).exists()), None)
    if not output_path:
        raise RuntimeError("Download finished but the output file could not be located.")

    path = Path(output_path)
    mime = "audio/mpeg" if path.suffix.lower() == ".mp3" else "video/mp4"
    return str(path), path.name, mime
