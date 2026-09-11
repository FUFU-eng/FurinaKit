"""Locate ffmpeg and make it discoverable by yt-dlp / spotdl.

Both tools auto-detect ffmpeg from PATH, so injecting its directory into the
worker process environment fixes both at once — without a system-level PATH
change (which is fragile and breaks on every ffmpeg version bump). On Windows,
winget's Gyan.FFmpeg package installs ffmpeg but often does not add it to PATH.
"""

import glob
import os
import shutil
from typing import Optional


def _candidate_paths() -> list[str]:
    import sys
    candidates: list[str] = []

    # 优先检查打包内置环境（furinakit-worker.exe 同级目录或 resources 目录）
    exe_dir = os.path.dirname(os.path.abspath(sys.executable))
    candidates += [
        os.path.join(exe_dir, "ffmpeg.exe"),
        os.path.join(exe_dir, "resources", "ffmpeg.exe"),
        os.path.join(os.path.dirname(exe_dir), "ffmpeg.exe"),
        os.path.join(os.path.dirname(exe_dir), "resources", "ffmpeg.exe"),
    ]

    local = os.environ.get("LOCALAPPDATA", "")
    if local:
        # winget (Gyan.FFmpeg) — version dir varies, so glob it.
        candidates += glob.glob(
            os.path.join(
                local, "Microsoft", "WinGet", "Packages",
                "Gyan.FFmpeg*", "**", "bin", "ffmpeg.exe",
            ),
            recursive=True,
        )

    program_data = os.environ.get("ProgramData", "")
    userprofile = os.environ.get("USERPROFILE", "")
    candidates += [
        r"C:\ffmpeg\bin\ffmpeg.exe",
        os.path.join(program_data, "chocolatey", "bin", "ffmpeg.exe") if program_data else "",
        os.path.join(userprofile, "scoop", "shims", "ffmpeg.exe") if userprofile else "",
    ]
    return [c for c in candidates if c]


def ensure_ffmpeg_on_path() -> Optional[str]:
    """Ensure ffmpeg is on PATH for this process. Returns its bin dir, or None."""
    existing = shutil.which("ffmpeg")
    if existing:
        return os.path.dirname(existing)

    for path in _candidate_paths():
        if os.path.isfile(path):
            bin_dir = os.path.dirname(path)
            os.environ["PATH"] = bin_dir + os.pathsep + os.environ.get("PATH", "")
            return bin_dir

    return None


def get_ffmpeg_path() -> str:
    """获取可用的 ffmpeg 可执行文件完整路径或命令名称。"""
    for path in _candidate_paths():
        if os.path.isfile(path):
            return path
    existing = shutil.which("ffmpeg")
    if existing:
        return existing
    return "ffmpeg"
