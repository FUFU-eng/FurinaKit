"""音频裁剪（audio-trim）。

- fast = 流复制（秒级完成、不损失音质），但不同容器对流复制的支持不同（mp3 可能写出空帧、
  时长不对），因此流复制失败或产出明显异常时会**自动回退到重编码**，并在成功消息里说明实际用的方式
- precise = 直接重编码，切点精确
- 输出保留原扩展名；容器**不做硬性白名单**（aac/opus/wma/aiff/amr 等都能进），
  先交给 ffmpeg 判断，真认不出再报中文错误并列出常见格式
- 本文件是新增模块，不改动任何现有模块的行为
"""

from pathlib import Path
from typing import Any, Dict, Optional

from app.tools.media_probe import (
    MEDIA_TIMEOUT,
    MediaError,
    error_tail,
    failed,
    format_seconds,
    get_ffmpeg_path,
    parse_time_spec,
    probe_media,
    require_existing_file,
    resolve_range,
    run_process,
)

# 契约里支持的容器（保留原扩展名输出）
# 重编码时按容器选编码器；**不在表里的容器不拒绝**，交给 ffmpeg 自己挑该容器的默认编码器
_ENCODERS = {
    "mp3": ["-c:a", "libmp3lame", "-b:a", "192k"],
    "wav": ["-c:a", "pcm_s16le"],
    "m4a": ["-c:a", "aac", "-b:a", "192k"],
    "mp4": ["-c:a", "aac", "-b:a", "192k"],
    "flac": ["-c:a", "flac"],
    "ogg": ["-c:a", "libvorbis", "-b:a", "192k"],
    "oga": ["-c:a", "libvorbis", "-b:a", "192k"],
    "opus": ["-c:a", "libopus", "-b:a", "128k"],
    "webm": ["-c:a", "libopus", "-b:a", "128k"],
    "aac": ["-c:a", "aac", "-b:a", "192k"],
    "wma": ["-c:a", "wmav2", "-b:a", "192k"],
    "aiff": ["-c:a", "pcm_s16be"],
    "aif": ["-c:a", "pcm_s16be"],
    "amr": ["-c:a", "libopencore_amrnb", "-b:a", "12.2k", "-ar", "8000", "-ac", "1"],
}

# 报错时给用户的提示：这是「我们确认跑得通」的常见格式，不是硬性白名单
COMMON_FORMAT_HINT = "mp3 / wav / m4a / flac / ogg / aac / opus / wma / aiff / amr"

_MIME_BY_EXT = {
    "mp3": "audio/mpeg", "mp2": "audio/mpeg", "wav": "audio/wav",
    "m4a": "audio/mp4", "mp4": "audio/mp4", "flac": "audio/flac",
    "ogg": "audio/ogg", "oga": "audio/ogg", "opus": "audio/opus",
    "aac": "audio/aac", "wma": "audio/x-ms-wma", "aiff": "audio/aiff",
    "aif": "audio/aiff", "amr": "audio/amr", "ac3": "audio/ac3",
    "webm": "audio/webm", "caf": "audio/x-caf",
}

_FAST_ALIASES = {"fast", "copy", "quick", "stream", "快速", "流复制"}
_PRECISE_ALIASES = {"precise", "accurate", "accurate-cut", "reencode", "re-encode", "精确", "重编码"}


def normalize_mode(mode: Any) -> str:
    raw = str(mode if mode is not None else "").strip().lower()
    if raw == "":
        return "fast"
    if raw in _FAST_ALIASES:
        return "fast"
    if raw in _PRECISE_ALIASES:
        return "precise"
    raise MediaError(
        f"裁剪模式只支持 fast（快速流复制）或 precise（精确重编码），收到的是「{mode}」"
    )


def _output_ok(path: Any, min_bytes: int = 64) -> bool:
    try:
        p = Path(path)
        return p.is_file() and p.stat().st_size > min_bytes
    except OSError:
        return False


def _drop(path: Any) -> None:
    try:
        p = Path(path)
        if p.exists():
            p.unlink()
    except OSError:
        pass


def trim_audio(
    input_path: str,
    output_path: str,
    start: Any = None,
    end: Any = None,
    mode: str = "fast",
    on_progress=None,
) -> Dict[str, Any]:
    """裁剪音频，输出保留原扩展名。

    容器不做硬性白名单：先交给 ffmpeg 处理，认不出/装不下时再报中文错误并提示常见格式。
    """
    try:
        mode_key = normalize_mode(mode)
        src = require_existing_file(input_path, "源音频文件")
        ext = src.suffix.lower().lstrip(".")

        info = probe_media(src)
        if not info["has_audio"]:
            if info["duration"] is None and not info["format"]:
                raise MediaError(
                    f"识别不出这个文件是不是音频：{src.name}。"
                    f"目前确认支持 {COMMON_FORMAT_HINT} 等常见格式；"
                    "少见的容器请先用「音频格式转换」转成 mp3 再裁剪"
                )
            raise MediaError(
                "这个文件里没有音频轨道，无法裁剪音频（如果它只有画面，请改用「视频裁剪」或「视频转音频」）"
            )

        start_sec = parse_time_spec(start, "开始时间")
        if start_sec is None:
            start_sec = 0.0
        end_sec = parse_time_spec(end, "结束时间")
        start_sec, end_sec, clamped = resolve_range(start_sec, end_sec, info["duration"], "音频")

        duration_arg: Optional[float] = None
        if end_sec is not None:
            duration_arg = max(0.05, end_sec - start_sec)

        out = Path(output_path)
        if out.parent and str(out.parent):
            out.parent.mkdir(parents=True, exist_ok=True)

        ffmpeg = get_ffmpeg_path()
        notes = []
        if clamped:
            notes.append("结束时间超过音频长度，已自动裁到结尾")

        def _time_args() -> list:
            args = ["-ss", f"{start_sec:.3f}"]
            if duration_arg is not None:
                args += ["-t", f"{duration_arg:.3f}"]
            return args

        def _fast_cmd() -> list:
            cmd = [ffmpeg, "-nostdin", "-hide_banner", "-nostats", "-y"]
            cmd += _time_args()
            cmd += ["-i", str(src), "-map", "0:a:0", "-c", "copy", "-avoid_negative_ts", "make_zero"]
            cmd += [str(out)]
            return cmd

        def _precise_cmd() -> list:
            cmd = [ffmpeg, "-nostdin", "-hide_banner", "-nostats", "-y"]
            cmd += _time_args()
            cmd += ["-i", str(src), "-map", "0:a:0", "-vn"]
            # 不在 _ENCODERS 表里的容器：不指定编码器，让 ffmpeg 自己挑该容器的默认编码器
            cmd += _ENCODERS.get(ext, [])
            cmd += [str(out)]
            return cmd

        used = mode_key
        if mode_key == "fast":
            if on_progress:
                on_progress("正在快速裁剪（流复制）...")
            result = run_process(_fast_cmd(), timeout=MEDIA_TIMEOUT)
            reason = ""
            if result.returncode != 0 or not _output_ok(out):
                reason = f"流复制失败（{error_tail(result, 160)}）"
            else:
                out_info = probe_media(out)
                got = out_info["duration"]
                expected = duration_arg
                if not out_info["has_audio"]:
                    reason = "流复制产出的文件里没有音频轨道"
                elif got is None or got <= 0.05:
                    reason = "流复制产出的文件没有有效时长（这类容器常见）"
                elif expected and abs(got - expected) > max(1.0, 0.25 * expected):
                    reason = (
                        f"流复制产出的时长不正确（{format_seconds(got)} 秒，"
                        f"期望 {format_seconds(expected)} 秒）"
                    )
            if reason:
                notes.append(f"{reason}，已自动改用重编码")
                used = "precise"
                _drop(out)

        if used == "precise":
            if on_progress:
                on_progress("正在重新编码裁剪...")
            result = run_process(_precise_cmd(), timeout=MEDIA_TIMEOUT)
            if result.returncode != 0 or not _output_ok(out):
                raise MediaError(
                    f"音频裁剪失败：{error_tail(result)}。"
                    f"目前确认支持 {COMMON_FORMAT_HINT} 等常见格式；"
                    "少见的容器请先用「音频格式转换」转成 mp3 再裁剪"
                )

        if not _output_ok(out):
            raise MediaError("裁剪失败：没有生成有效的音频文件，请确认源音频可以正常播放")
        final_info = probe_media(out)
        if not final_info["has_audio"]:
            raise MediaError("裁剪失败：生成的文件里没有音频轨道")

        if used == "fast":
            message = "音频裁剪完成（流复制：秒级完成、不损失音质，切点对齐到音频帧）"
        else:
            message = f"音频裁剪完成（重编码：已按 .{ext or '源格式'} 重新编码，切点精确）"
        if notes:
            message += "；" + "；".join(notes)

        return {
            "success": True,
            "output": str(out),
            "filename": out.name,
            "mime": _MIME_BY_EXT.get(ext, "application/octet-stream"),
            "mode": used,
            "duration": final_info["duration"],
            "message": message,
        }
    except MediaError as exc:
        return failed(exc)
    except Exception as exc:  # noqa: BLE001
        return failed(exc, "音频裁剪失败")
