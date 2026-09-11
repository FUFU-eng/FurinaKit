"""
视频处理工具：格式转换、压缩、转GIF
使用 FFmpeg 实现
"""

import os
import sys
import subprocess
import shutil
import time

# Windows: 隐藏子进程控制台窗口
CREATE_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0
from pathlib import Path
from typing import Optional, Tuple


def _get_ffmpeg_path() -> str:
    """获取 FFmpeg 路径"""
    try:
        from app.ffmpeg import get_ffmpeg_path
        return get_ffmpeg_path()
    except Exception:
        return shutil.which("ffmpeg") or "ffmpeg"


def convert_video(
    input_path: str,
    output_format: str,
    quality: str = "high",
    on_progress=None,
) -> Tuple[str, str, str]:
    """
    视频格式转换

    Args:
        input_path: 输入文件路径
        output_format: 目标格式（mp4, avi, mov, mkv, webm, flv, wmv, m4v）
        quality: 画质（original, high, medium, low）
        on_progress: 进度回调函数

    Returns:
        (output_path, filename, mime_type)
    """
    ffmpeg = _get_ffmpeg_path()
    input_path = Path(input_path)
    output_dir = input_path.parent
    output_filename = f"{input_path.stem}_converted.{output_format}"
    output_path = output_dir / output_filename

    # 构建 FFmpeg 命令
    cmd = [ffmpeg, "-y", "-i", str(input_path)]

    # 画质设置
    if quality == "original":
        cmd.extend(["-c", "copy"])
    elif quality == "high":
        cmd.extend(["-c:v", "libx264", "-crf", "18", "-preset", "medium"])
    elif quality == "medium":
        cmd.extend(["-c:v", "libx264", "-crf", "23", "-preset", "medium"])
    elif quality == "low":
        cmd.extend(["-c:v", "libx264", "-crf", "28", "-preset", "fast"])

    # 音频设置
    if output_format in ["mp4", "m4v", "mov"]:
        cmd.extend(["-c:a", "aac", "-b:a", "192k"])
    elif output_format == "webm":
        cmd.extend(["-c:v", "libvpx-vp9", "-c:a", "libopus"])
    elif output_format == "avi":
        cmd.extend(["-c:a", "mp3"])

    cmd.append(str(output_path))

    # 执行转换
    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        universal_newlines=True,
        encoding="utf-8",
        errors="replace",
        creationflags=CREATE_NO_WINDOW,
    )

    # 简单进度跟踪
    while process.poll() is None:
        line = process.stdout.readline()
        if line and on_progress:
            # 解析时间信息
            if "time=" in line:
                try:
                    time_str = line.split("time=")[1].split()[0]
                    on_progress(f"转换中: {time_str}")
                except:
                    pass

    process.wait()

    if process.returncode != 0:
        raise RuntimeError(f"FFmpeg 转换失败，返回码: {process.returncode}")

    if not output_path.exists():
        raise RuntimeError("输出文件未生成")

    # MIME 类型
    mime_types = {
        "mp4": "video/mp4",
        "avi": "video/x-msvideo",
        "mov": "video/quicktime",
        "mkv": "video/x-matroska",
        "webm": "video/webm",
        "flv": "video/x-flv",
        "wmv": "video/x-ms-wmv",
        "m4v": "video/x-m4v",
    }
    mime = mime_types.get(output_format, "application/octet-stream")

    return str(output_path), output_filename, mime


def compress_video(
    input_path: str,
    quality: str = "medium",
    target_size_mb: Optional[float] = None,
    on_progress=None,
) -> Tuple[str, str, str]:
    """
    视频压缩

    Args:
        input_path: 输入文件路径
        quality: 压缩质量（high, medium, low）
        target_size_mb: 目标文件大小（MB），可选
        on_progress: 进度回调函数

    Returns:
        (output_path, filename, mime_type)
    """
    ffmpeg = _get_ffmpeg_path()
    input_path = Path(input_path)
    output_dir = input_path.parent
    output_filename = f"{input_path.stem}_compressed.mp4"
    output_path = output_dir / output_filename

    # 构建 FFmpeg 命令
    cmd = [ffmpeg, "-y", "-i", str(input_path)]

    if target_size_mb and target_size_mb > 0:
        # 目标大小模式：计算比特率
        # 获取视频时长
        try:
            probe_cmd = [
                ffmpeg.replace("ffmpeg", "ffprobe"),
                "-v", "error",
                "-show_entries", "format=duration",
                "-of", "default=noprint_wrappers=1:nokey=1",
                str(input_path),
            ]
            duration = float(
                subprocess.check_output(
                    probe_cmd,
                    stderr=subprocess.STDOUT,
                    creationflags=CREATE_NO_WINDOW,
                ).decode().strip()
            )
            # 目标比特率 = 目标大小 * 8 / 时长（kbps）
            target_bitrate = int((target_size_mb * 8192) / duration)
            cmd.extend([
                "-c:v", "libx264",
                "-b:v", f"{target_bitrate}k",
                "-maxrate", f"{target_bitrate}k",
                "-bufsize", f"{target_bitrate * 2}k",
                "-c:a", "aac", "-b:a", "128k",
            ])
        except:
            # 如果获取时长失败，使用质量模式
            quality = "medium"

    if not target_size_mb or target_size_mb <= 0:
        # 质量模式
        if quality == "high":
            cmd.extend(["-c:v", "libx264", "-crf", "20", "-preset", "medium"])
        elif quality == "medium":
            cmd.extend(["-c:v", "libx264", "-crf", "26", "-preset", "medium"])
        elif quality == "low":
            cmd.extend(["-c:v", "libx264", "-crf", "30", "-preset", "fast"])
        cmd.extend(["-c:a", "aac", "-b:a", "128k"])

    cmd.append(str(output_path))

    # 执行压缩
    process = subprocess.Popen(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        universal_newlines=True,
        encoding="utf-8",
        errors="replace",
        creationflags=CREATE_NO_WINDOW,
    )

    while process.poll() is None:
        line = process.stdout.readline()
        if line and on_progress and "time=" in line:
            try:
                time_str = line.split("time=")[1].split()[0]
                on_progress(f"压缩中: {time_str}")
            except:
                pass

    process.wait()

    if process.returncode != 0:
        raise RuntimeError(f"FFmpeg 压缩失败，返回码: {process.returncode}")

    if not output_path.exists():
        raise RuntimeError("输出文件未生成")

    return str(output_path), output_filename, "video/mp4"


def video_to_gif(
    input_path: str,
    start_time: float = 0,
    duration: float = 5,
    width: int = 480,
    fps: int = 15,
    on_progress=None,
) -> Tuple[str, str, str]:
    """
    视频转 GIF

    Args:
        input_path: 输入文件路径
        start_time: 开始时间（秒）
        duration: 持续时长（秒）
        width: 输出宽度（像素），高度自动等比缩放
        fps: 帧率
        on_progress: 进度回调函数

    Returns:
        (output_path, filename, mime_type)
    """
    ffmpeg = _get_ffmpeg_path()
    input_path = Path(input_path)
    output_dir = input_path.parent
    output_filename = f"{input_path.stem}.gif"
    output_path = output_dir / output_filename

    # 使用 palettegen + paletteuse 两步法生成高质量 GIF
    palette_path = output_dir / f"{input_path.stem}_palette.png"

    # 第一步：生成调色板
    cmd1 = [
        ffmpeg, "-y",
        "-ss", str(start_time),
        "-t", str(duration),
        "-i", str(input_path),
        "-vf", f"fps={fps},scale={width}:-1:flags=lanczos,palettegen",
        str(palette_path),
    ]

    if on_progress:
        on_progress("生成调色板中...")

    result1 = subprocess.run(cmd1, capture_output=True, text=True, encoding="utf-8", errors="replace", creationflags=CREATE_NO_WINDOW)
    if result1.returncode != 0:
        # 如果调色板生成失败，尝试直接转换
        pass

    # 第二步：使用调色板生成 GIF
    cmd2 = [
        ffmpeg, "-y",
        "-ss", str(start_time),
        "-t", str(duration),
        "-i", str(input_path),
    ]

    if palette_path.exists():
        cmd2.extend(["-i", str(palette_path)])
        cmd2.extend([
            "-lavfi", f"fps={fps},scale={width}:-1:flags=lanczos[x];[x][1:v]paletteuse",
        ])
    else:
        cmd2.extend([
            "-vf", f"fps={fps},scale={width}:-1:flags=lanczos",
        ])

    cmd2.append(str(output_path))

    if on_progress:
        on_progress("生成 GIF 中...")

    # 最多重试2次（应对偶发的 DLL 初始化失败）
    result2 = None
    for attempt in range(2):
        result2 = subprocess.run(cmd2, capture_output=True, text=True, encoding="utf-8", errors="replace", creationflags=CREATE_NO_WINDOW)
        if result2.returncode == 0:
            break
        if attempt == 0:
            time.sleep(1)

    # 清理临时调色板文件
    if palette_path.exists():
        try:
            os.remove(palette_path)
        except:
            pass

    if result2.returncode != 0:
        raise RuntimeError(f"FFmpeg 转 GIF 失败，返回码: {result2.returncode}")

    if not output_path.exists():
        raise RuntimeError("输出文件未生成")

    return str(output_path), output_filename, "image/gif"
