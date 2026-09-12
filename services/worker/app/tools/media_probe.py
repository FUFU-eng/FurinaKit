"""媒体探测与时间解析（供新增的裁剪 / 抽帧模块共用）。

设计约定：
- 对外报错一律是中文人话（MediaError），由调用方转成 {"success": False, "error": ...}
- 只通过 ffmpeg / ffprobe 外部进程处理媒体，绝不把媒体文件读进内存
- 本文件是新增模块，不改动任何现有模块的行为
"""

import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

# Windows: 隐藏子进程控制台窗口（与 video_tools / audio_tools 同一写法）
CREATE_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0

# 单次 ffmpeg / ffprobe 调用的最长等待时间（秒）
MEDIA_TIMEOUT = 900
PROBE_TIMEOUT = 120

# 支持 12 / 12.5 / 00:12 / 00:00:12 / 00:00:12.250，小数点也允许写成逗号
_SINGLE_RE = re.compile(r"^\d+(?:[.,]\d+)?$")
_MMSS_RE = re.compile(r"^(\d{1,3}):([0-5]?\d)(?:[.,](\d+))?$")
_HHMMSS_RE = re.compile(r"^(\d{1,3}):([0-5]?\d):([0-5]?\d)(?:[.,](\d+))?$")


class MediaError(Exception):
    """可以直接展示给用户的中文错误。"""


def get_ffmpeg_path() -> str:
    """复用既有 app.ffmpeg 的查找逻辑（打包版会找 exe 同级的 ffmpeg.exe）。"""
    try:
        from app.ffmpeg import get_ffmpeg_path as _find
        return _find()
    except Exception:
        return shutil.which("ffmpeg") or "ffmpeg"


def get_ffprobe_path() -> str:
    """ffprobe 一般和 ffmpeg 同目录；找不到就退回 PATH 上的 ffprobe。"""
    ffmpeg = get_ffmpeg_path()
    try:
        p = Path(ffmpeg)
        if p.name.lower().startswith("ffmpeg"):
            cand = p.with_name(p.name.replace("ffmpeg", "ffprobe", 1))
            if cand.is_file():
                return str(cand)
    except Exception:
        pass
    found = shutil.which("ffprobe")
    return found or "ffprobe"


def run_process(cmd, timeout: int = MEDIA_TIMEOUT) -> subprocess.CompletedProcess:
    """运行外部命令；只把「找不到程序 / 超时」转成中文错误，退出码交给调用方判断。"""
    try:
        return subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            creationflags=CREATE_NO_WINDOW,
        )
    except FileNotFoundError as exc:
        raise MediaError("找不到 ffmpeg，请确认 FurinaKit 自带的 ffmpeg 是否完整") from exc
    except subprocess.TimeoutExpired as exc:
        raise MediaError(
            f"处理超时（超过 {int(timeout)} 秒），文件可能太大，建议先裁剪或压缩后再试"
        ) from exc


def error_tail(result: Optional[subprocess.CompletedProcess], limit: int = 300) -> str:
    """取 ffmpeg 输出末尾一小段，拼进中文错误里方便定位。"""
    if result is None:
        return "ffmpeg 没有返回任何信息"
    raw = (result.stderr or "") or (result.stdout or "")
    raw = " ".join(str(raw).split())
    if not raw:
        return f"ffmpeg 退出码 {result.returncode}"
    return raw[-limit:]


def failed(exc: BaseException, prefix: str = "") -> Dict[str, Any]:
    """把异常统一转成工具约定的失败结果；MediaError 本身就是中文人话，直接透传。"""
    if isinstance(exc, MediaError):
        message = str(exc)
    elif prefix:
        message = f"{prefix}：{exc}"
    else:
        message = f"处理失败：{exc}"
    return {"success": False, "error": message}


def _to_float(value: Any) -> Optional[float]:
    try:
        if value is None or value == "":
            return None
        f = float(value)
    except (TypeError, ValueError):
        return None
    if f != f or f in (float("inf"), float("-inf")):
        return None
    return f


def _is_attached_pic(stream: Dict[str, Any]) -> bool:
    """mp3 / m4a 里内嵌的封面也算 codec_type=video，必须排除，否则会被当成视频。"""
    disp = stream.get("disposition") or {}
    try:
        return int(disp.get("attached_pic") or 0) == 1
    except (TypeError, ValueError):
        return False


def probe_media(path) -> Dict[str, Any]:
    """一次 ffprobe 拿到时长 / 是否有画面 / 是否有声音 / 分辨率。

    探测失败时返回 duration=None，调用方自行决定是否还能继续（例如裁到结尾）。
    """
    info: Dict[str, Any] = {
        "duration": None,
        "has_video": False,
        "has_audio": False,
        "width": None,
        "height": None,
        "format": "",
    }
    cmd = [
        get_ffprobe_path(), "-v", "error",
        "-print_format", "json",
        "-show_format", "-show_streams",
        str(path),
    ]
    try:
        result = run_process(cmd, timeout=PROBE_TIMEOUT)
    except MediaError:
        return info
    if result.returncode != 0 or not (result.stdout or "").strip():
        return info
    try:
        data = json.loads(result.stdout)
    except (ValueError, TypeError):
        return info

    fmt = data.get("format") or {}
    info["format"] = str(fmt.get("format_name") or "")
    stream_durations = []
    for stream in data.get("streams") or []:
        ctype = str(stream.get("codec_type") or "")
        if ctype == "video" and not _is_attached_pic(stream):
            info["has_video"] = True
            if info["width"] is None:
                info["width"] = stream.get("width")
                info["height"] = stream.get("height")
            stream_durations.append(_to_float(stream.get("duration")))
        elif ctype == "audio":
            info["has_audio"] = True
            stream_durations.append(_to_float(stream.get("duration")))

    duration = _to_float(fmt.get("duration"))
    if duration is None or duration <= 0:
        for cand in stream_durations:
            if cand and cand > 0:
                duration = cand
                break
    info["duration"] = duration
    return info


def probe_duration(path) -> Optional[float]:
    return probe_media(path)["duration"]


def format_seconds(value: Any) -> str:
    """把秒数写成给人看的样子：12 / 12.5 / 12.25"""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return str(value)
    if abs(v - round(v)) < 0.005:
        return str(int(round(v)))
    return f"{round(v, 2):g}"


def parse_time_spec(value: Any, field: str = "时间") -> Optional[float]:
    """解析时间参数，返回秒数；空值返回 None，非法值抛中文错误。

    支持：12 / 12.5 / 00:12 / 00:12.5 / 00:00:12 / 00:00:12.250（逗号小数点也认）
    """
    if value is None:
        return None
    if isinstance(value, bool):
        raise MediaError(f"{field}格式不正确：「{value}」，请使用秒数（如 10）、MM:SS（如 00:10）或 HH:MM:SS（如 00:00:10）")
    if isinstance(value, (int, float)):
        seconds = float(value)
        if seconds != seconds or seconds in (float("inf"), float("-inf")):
            raise MediaError(f"{field}格式不正确：「{value}」，请填写一个正常的秒数")
        if seconds < 0:
            raise MediaError(f"{field}不能是负数（收到 {format_seconds(seconds)} 秒）")
        return seconds

    raw = str(value).strip()
    if raw == "":
        return None

    m = _HHMMSS_RE.match(raw)
    if m:
        hours, minutes, secs, frac = m.groups()
        seconds = int(hours) * 3600 + int(minutes) * 60 + int(secs)
        if frac:
            seconds += float("0." + frac)
        return float(seconds)

    m = _MMSS_RE.match(raw)
    if m:
        minutes, secs, frac = m.groups()
        seconds = int(minutes) * 60 + int(secs)
        if frac:
            seconds += float("0." + frac)
        return float(seconds)

    m = _SINGLE_RE.match(raw)
    if m:
        return float(raw.replace(",", "."))

    raise MediaError(
        f"{field}格式不正确：「{value}」，请使用秒数（如 10）、MM:SS（如 00:10）或 HH:MM:SS（如 00:00:10）"
    )


def require_existing_file(path: Any, what: str = "文件") -> Path:
    raw = str(path or "").strip()
    if not raw:
        raise MediaError(f"没有拿到要处理的{what}路径，请重新选择文件")
    p = Path(raw)
    try:
        if not p.is_file():
            raise MediaError(f"找不到{what}：{raw}")
        if p.stat().st_size <= 0:
            raise MediaError(f"{what}是空文件：{p.name}")
    except MediaError:
        raise
    except OSError as exc:
        raise MediaError(f"无法读取{what}：{raw}（{exc}）") from exc
    return p


def resolve_range(
    start: Optional[float],
    end: Optional[float],
    duration: Optional[float],
    what: str = "视频",
) -> Tuple[float, Optional[float], bool]:
    """校验并规整裁剪区间，返回 (start, end, 是否把 end 截到了结尾)。"""
    if end is not None and end <= start:
        raise MediaError(
            f"结束时间必须晚于开始时间（开始 {format_seconds(start)} 秒，结束 {format_seconds(end)} 秒）"
        )
    clamped = False
    if duration is not None and duration > 0:
        if start >= duration - 0.01:
            raise MediaError(
                f"这个{what}只有 {format_seconds(duration)} 秒，开始时间 "
                f"{format_seconds(start)} 秒已经超出{what}长度"
            )
        if end is not None and end > duration:
            end = duration
            clamped = True
    return start, end, clamped
