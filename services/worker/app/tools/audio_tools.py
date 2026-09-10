"""
音频工具处理模块
支持音频格式转换等功能
"""
import os
import sys
import subprocess
import tempfile

# Windows: 隐藏子进程控制台窗口
CREATE_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0
from typing import Dict, Any


def get_ffmpeg_path() -> str:
    """获取 FFmpeg 路径"""
    # 尝试系统 PATH
    try:
        result = subprocess.run(
            ["where", "ffmpeg"], capture_output=True, text=True, timeout=5,
            creationflags=CREATE_NO_WINDOW,
        )
        if result.returncode == 0 and result.stdout.strip():
            return result.stdout.strip().split("\n")[0].strip()
    except Exception:
        pass
    
    # 尝试常见安装路径
    common_paths = [
        r"C:\Program Files\ffmpeg\bin\ffmpeg.exe",
        r"C:\ffmpeg\bin\ffmpeg.exe",
        r"C:\ProgramData\chocolatey\bin\ffmpeg.exe",
    ]
    for path in common_paths:
        if os.path.exists(path):
            return path
    
    return "ffmpeg"  #  fallback to PATH


def audio_format_convert(file_path: str, output_path: str, format: str = "mp3", bitrate: str = "192k") -> Dict[str, Any]:
    """
    音频格式转换
    支持 MP3、WAV、FLAC、AAC、OGG、M4A、WMA、OPUS
    """
    ffmpeg = get_ffmpeg_path()
    
    format = format.lower()
    ext_map = {
        "mp3": "mp3",
        "wav": "wav",
        "flac": "flac",
        "aac": "aac",
        "ogg": "ogg",
        "m4a": "m4a",
        "wma": "wma",
        "opus": "opus",
    }
    
    ext = ext_map.get(format, format)
    
    # 构建 FFmpeg 命令
    cmd = [ffmpeg, "-y", "-i", file_path]
    
    # 根据格式设置编码器和参数
    if format == "mp3":
        cmd.extend(["-c:a", "libmp3lame", "-b:a", bitrate])
    elif format == "aac":
        cmd.extend(["-c:a", "aac", "-b:a", bitrate])
    elif format == "ogg":
        cmd.extend(["-c:a", "libvorbis", "-b:a", bitrate])
    elif format == "m4a":
        cmd.extend(["-c:a", "aac", "-b:a", bitrate])
    elif format == "wma":
        cmd.extend(["-c:a", "wmav2", "-b:a", bitrate])
    elif format == "opus":
        cmd.extend(["-c:a", "libopus", "-b:a", bitrate])
    elif format == "flac":
        cmd.extend(["-c:a", "flac"])
    elif format == "wav":
        cmd.extend(["-c:a", "pcm_s16le"])
    
    cmd.append(output_path)
    
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120, creationflags=CREATE_NO_WINDOW)
        if result.returncode != 0:
            return {"success": False, "error": result.stderr[-500:] if result.stderr else "转换失败"}
        
        if not os.path.exists(output_path):
            return {"success": False, "error": "输出文件未生成"}
        
        file_size = os.path.getsize(output_path)
        return {
            "success": True,
            "output": output_path,
            "format": format,
            "bitrate": bitrate,
            "size": file_size
        }
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "转换超时"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def extract_audio_from_video(file_path: str, output_path: str, format: str = "mp3", bitrate: str = "192k", on_progress=None) -> Dict[str, Any]:
    """
    从视频文件中提取音频（视频转音频）
    -vn 丢弃视频流，仅保留/转码音频。支持 MP3、WAV、FLAC、AAC、M4A、OGG、OPUS。
    """
    ffmpeg = get_ffmpeg_path()
    format = format.lower()

    cmd = [ffmpeg, "-y", "-i", file_path, "-vn"]

    if format == "mp3":
        if bitrate == "lossless":
            cmd.extend(["-c:a", "libmp3lame", "-q:a", "0"])  # VBR 最高质量
        else:
            cmd.extend(["-c:a", "libmp3lame", "-b:a", bitrate])
    elif format in ("aac", "m4a"):
        cmd.extend(["-c:a", "aac", "-b:a", "320k" if bitrate == "lossless" else bitrate])
    elif format == "ogg":
        cmd.extend(["-c:a", "libvorbis", "-b:a", bitrate])
    elif format == "opus":
        cmd.extend(["-c:a", "libopus", "-b:a", bitrate])
    elif format == "flac":
        cmd.extend(["-c:a", "flac"])
    elif format == "wav":
        cmd.extend(["-c:a", "pcm_s16le"])
    else:
        cmd.extend(["-c:a", "libmp3lame", "-b:a", bitrate])

    cmd.append(output_path)

    import time
    last_detail = ""
    try:
        # 先检测输入文件是否有音频流
        probe_cmd = [ffmpeg, "-i", file_path, "-hide_banner"]
        probe = subprocess.run(probe_cmd, capture_output=True, text=True, encoding="utf-8", errors="replace", creationflags=CREATE_NO_WINDOW)
        probe_output = (probe.stdout or "") + (probe.stderr or "")
        if "Audio:" not in probe_output:
            return {"success": False, "error": "该视频文件不包含音频流，无法提取音频"}

        # 最多尝试两次：首次可能因安全软件扫描新进程、文件句柄占用等瞬时因素失败
        for attempt in range(2):
            process = subprocess.Popen(
                cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                universal_newlines=True, encoding="utf-8", errors="replace",
                creationflags=CREATE_NO_WINDOW,
            )
            tail_lines: list[str] = []
            while process.poll() is None:
                line = process.stdout.readline()
                if line:
                    tail_lines.append(line.rstrip())
                    tail_lines = tail_lines[-15:]
                    if on_progress and "time=" in line:
                        try:
                            on_progress("提取中: " + line.split("time=")[1].split()[0])
                        except Exception:
                            pass
            process.wait()
            if process.returncode == 0 and os.path.exists(output_path):
                return {
                    "success": True,
                    "output": output_path,
                    "format": format,
                    "size": os.path.getsize(output_path),
                }
            last_detail = " | ".join(tail_lines[-3:])[:300]
            if attempt == 0:
                time.sleep(1)
                continue
        return {"success": False, "error": f"提取失败（ffmpeg 退出码 {process.returncode}）：{last_detail}"}
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "处理超时"}
    except Exception as e:
        return {"success": False, "error": str(e)}



def audio_reverse(file_path: str, output_path: str) -> Dict[str, Any]:
    """音频倒放"""
    ffmpeg = get_ffmpeg_path()
    cmd = [ffmpeg, "-y", "-i", file_path, "-af", "areverse", output_path]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120, creationflags=CREATE_NO_WINDOW)
        if result.returncode != 0:
            return {"success": False, "error": result.stderr[-500:] if result.stderr else "倒放失败"}
        if not os.path.exists(output_path):
            return {"success": False, "error": "输出文件未生成"}
        return {"success": True, "output": output_path, "size": os.path.getsize(output_path)}
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "处理超时"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def audio_volume(file_path: str, output_path: str, volume: float = 1.0) -> Dict[str, Any]:
    """音频音量调节，volume 为倍数（0.5=减半，2.0=翻倍）"""
    ffmpeg = get_ffmpeg_path()
    cmd = [ffmpeg, "-y", "-i", file_path, "-af", f"volume={volume}", output_path]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120, creationflags=CREATE_NO_WINDOW)
        if result.returncode != 0:
            return {"success": False, "error": result.stderr[-500:] if result.stderr else "音量调节失败"}
        if not os.path.exists(output_path):
            return {"success": False, "error": "输出文件未生成"}
        return {"success": True, "output": output_path, "volume": volume, "size": os.path.getsize(output_path)}
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "处理超时"}
    except Exception as e:
        return {"success": False, "error": str(e)}


def audio_merge(file_paths: list, output_path: str) -> Dict[str, Any]:
    """音频合并（拼接多个音频文件）"""
    ffmpeg = get_ffmpeg_path()
    
    # 创建临时文件列表
    list_file = output_path + ".txt"
    with open(list_file, "w", encoding="utf-8") as lf:
        for fp in file_paths:
            safe_fp = str(fp).replace("\\", "/").replace("'", "'\\''")
            lf.write(f"file '{safe_fp}'\n")
    
    cmd = [ffmpeg, "-y", "-f", "concat", "-safe", "0", "-i", list_file, "-c:a", "libmp3lame", "-b:a", "192k", output_path]
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=180, creationflags=CREATE_NO_WINDOW)
        # 清理临时文件
        if os.path.exists(list_file):
            os.remove(list_file)
        if result.returncode != 0:
            return {"success": False, "error": result.stderr[-500:] if result.stderr else "合并失败"}
        if not os.path.exists(output_path):
            return {"success": False, "error": "输出文件未生成"}
        return {"success": True, "output": output_path, "count": len(file_paths), "size": os.path.getsize(output_path)}
    except subprocess.TimeoutExpired:
        if os.path.exists(list_file):
            os.remove(list_file)
        return {"success": False, "error": "处理超时"}
    except Exception as e:
        if os.path.exists(list_file):
            os.remove(list_file)
        return {"success": False, "error": str(e)}
