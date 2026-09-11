"""
磁力链接下载工具
使用 aria2 下载 BT/磁力链接资源
"""

import glob
import os
import re
import subprocess
import shutil
import sys
from pathlib import Path
from typing import Optional, Tuple, Callable

CREATE_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0


def _get_aria2_path() -> str:
    """获取 aria2c 路径"""
    # 显式配置优先，避免换机器后硬编码路径失效
    override = os.environ.get("ARIA2C_PATH", "").strip()
    if override:
        return override
    # 优先检查打包内置环境（furinakit-worker.exe 同级或 resources 目录）
    exe_dir = os.path.dirname(os.path.abspath(sys.executable))
    candidates = [
        os.path.join(exe_dir, "aria2c.exe"),
        os.path.join(exe_dir, "resources", "aria2c.exe"),
        os.path.join(os.path.dirname(exe_dir), "aria2c.exe"),
        os.path.join(os.path.dirname(exe_dir), "resources", "aria2c.exe"),
    ]
    for c in candidates:
        if os.path.isfile(c):
            return c

    # 优先使用系统 PATH 中的 aria2c
    aria2 = shutil.which("aria2c")
    if aria2:
        return aria2
    # winget 安装路径（版本目录会变，用 glob 找，不写死用户名）
    local_app_data = os.environ.get("LOCALAPPDATA", "")
    if local_app_data:
        matches = glob.glob(
            os.path.join(
                local_app_data, "Microsoft", "WinGet", "Packages",
                "aria2.aria2*", "**", "aria2c.exe",
            ),
            recursive=True,
        )
        if matches:
            return matches[0]
    return "aria2c"


def download_magnet(
    magnet_url: str,
    output_dir: str,
    on_progress: Optional[Callable[[str], None]] = None,
) -> Tuple[str, str, str]:
    """
    下载磁力链接

    Args:
        magnet_url: 磁力链接（magnet:?xt=urn:btih:...）
        output_dir: 输出目录
        on_progress: 进度回调函数

    Returns:
        (output_path, filename, mime_type)
    """
    aria2c = _get_aria2_path()
    output_dir = Path(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    # 记录下载前的文件列表
    before_files = set()
    if output_dir.exists():
        for f in output_dir.rglob("*"):
            if f.is_file():
                before_files.add(str(f.resolve()))

    # 构建 aria2c 命令
    cmd = [
        aria2c,
        "--dir=" + str(output_dir),
        "--seed-time=0",           # 下载完成后不做种
        "--summary-interval=1",    # 每秒输出一次进度
        "--console-log-level=notice",
        "--download-result=full",
        "--file-allocation=none",  # 不预分配文件空间
        "--max-connection-per-server=16",
        "--split=16",
        "--min-split-size=1M",
        "--bt-tracker=" + ",".join([
            "udp://tracker.opentrackr.org:1337/announce",
            "udp://tracker.openbittorrent.com:6969/announce",
            "udp://tracker.coppersurfer.tk:6969/announce",
            "udp://open.stealth.si:80/announce",
            "udp://exodus.desync.com:6969/announce",
            "udp://tracker.torrent.eu.org:451/announce",
        ]),
        magnet_url,
    ]

    if on_progress:
        on_progress("正在连接磁力网络，获取资源信息...")

    # 启动下载进程
    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        universal_newlines=True,
        encoding="utf-8",
        errors="replace",
        cwd=str(output_dir),
        creationflags=CREATE_NO_WINDOW,
    )

    # 解析输出获取进度
    last_progress = 0
    downloaded_files = []

    while process.poll() is None:
        line = process.stdout.readline()
        if not line:
            continue

        line = line.strip()

        # 解析下载进度
        # aria2 输出格式: "[#aabbcc 1.2MiB/10MiB(12%) CN:10 DL:500KiB ETA:30s]"
        progress_match = re.search(r"\((\d+)%\)", line)
        if progress_match:
            pct = int(progress_match.group(1))
            if pct != last_progress:
                last_progress = pct
                # 提取下载速度
                speed_match = re.search(r"DL:([\d.]+\w+)", line)
                speed = speed_match.group(1) if speed_match else ""
                # 提取剩余时间
                eta_match = re.search(r"ETA:([\d\w]+)", line)
                eta = eta_match.group(1) if eta_match else ""

                msg = f"下载中: {pct}%"
                if speed:
                    msg += f" 速度: {speed}/s"
                if eta:
                    msg += f" 剩余: {eta}"
                if on_progress:
                    on_progress(msg)

        # 检测文件名
        if "Downloading:" in line or "File:" in line:
            file_match = re.search(r"(?:Downloading|File):\s*(.+)", line)
            if file_match:
                filename = file_match.group(1).strip()
                if filename and filename not in downloaded_files:
                    downloaded_files.append(filename)

    process.wait()

    if process.returncode != 0:
        # aria2 返回码 0 表示成功，其他表示失败
        # 但是某些情况下返回码可能是 7（参数错误）或其他
        error_output = ""
        try:
            remaining = process.stdout.read()
            error_output = remaining
        except:
            pass
        raise RuntimeError(f"aria2 下载失败（返回码: {process.returncode}）。{error_output[-500:] if error_output else ''}")

    # 找到新下载的文件
    after_files = set()
    for f in output_dir.rglob("*"):
        if f.is_file():
            after_files.add(str(f.resolve()))

    new_files = after_files - before_files

    # 过滤掉 aria2 的临时文件和控制文件
    result_files = [
        f for f in new_files
        if not f.endswith(".aria2") and not f.endswith(".torrent")
    ]

    if not result_files:
        # 如果没有找到新文件，检查整个输出目录中最大的文件
        all_files = [
            f for f in output_dir.rglob("*")
            if f.is_file() and not f.name.endswith(".aria2") and not f.name.endswith(".torrent")
        ]
        if all_files:
            result_files = [str(max(all_files, key=lambda f: f.stat().st_size))]
        else:
            raise RuntimeError("下载完成但未找到输出文件")

    # 如果只有一个文件，直接返回
    if len(result_files) == 1:
        output_path = result_files[0]
        filename = os.path.basename(output_path)
    else:
        # 多个文件，打包成 zip
        import zipfile
        zip_path = output_dir / "magnet_download.zip"
        with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for f in result_files:
                arcname = os.path.relpath(f, output_dir)
                zf.write(f, arcname)
        output_path = str(zip_path)
        filename = "magnet_download.zip"

    # 根据扩展名判断 MIME 类型
    ext = Path(filename).suffix.lower()
    mime_map = {
        ".mp4": "video/mp4",
        ".mkv": "video/x-matroska",
        ".avi": "video/x-msvideo",
        ".mov": "video/quicktime",
        ".mp3": "audio/mpeg",
        ".flac": "audio/flac",
        ".wav": "audio/wav",
        ".zip": "application/zip",
        ".rar": "application/x-rar-compressed",
        ".7z": "application/x-7z-compressed",
        ".pdf": "application/pdf",
        ".jpg": "image/jpeg",
        ".png": "image/png",
        ".txt": "text/plain",
    }
    mime = mime_map.get(ext, "application/octet-stream")

    return output_path, filename, mime
