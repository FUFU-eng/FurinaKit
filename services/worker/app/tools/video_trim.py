"""视频裁剪（tool id: video-trim）与视频抽帧缩略图（tool id: video-frame-extract）。

- 视频裁剪：fast = 流复制（秒级完成、不损失画质，切点对齐关键帧）；precise = 重编码（切点精确）
  输出容器默认**跟随源文件**（payload.container 缺省 "same"）：clip.mkv → clip-trimmed.mkv，
  这样流复制才能真正无损秒出；container="mp4" 可强制 mp4（装不下时自动回退重编码并说明）
- 抽帧缩略图：按时间点用 ffmpeg 取一帧，可等比缩放宽度
  注意：这里是**本地视频文件抽帧**，与 tasks.py 里既有的 video-thumbnail（在线视频封面下载）
  是完全不同的能力，因此使用独立 tool id video-frame-extract，既有分支一行都不动
- 全部通过 ffmpeg 外部进程完成，不把视频读进内存
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

# 缩略图宽度上限（ffmpeg 自身也处理不了过大的尺寸）
MAX_THUMB_WIDTH = 16384

# ── 输出容器 ────────────────────────────────────────────────────────
# container="same"（缺省）时沿用源容器；下面这些是**用真实 ffmpeg 逐个实测过**的容器
# （流复制 copy 全部通过；重编码按容器选编码器：webm 用 vp9+opus，其余用 h264+aac）。
# 不在列表里的扩展名（.mpg/.mpeg/未知扩展名/无扩展名）一律退回 .mp4。
SAME_CONTAINER_EXTS = ("mp4", "m4v", "mov", "mkv", "webm", "avi", "flv", "wmv", "ts")
_MOVFLAGS_EXTS = ("mp4", "m4v", "mov")  # 只有 mov 家族认 -movflags +faststart
_MIME_BY_EXT = {
    "mp4": "video/mp4", "m4v": "video/x-m4v", "mov": "video/quicktime",
    "mkv": "video/x-matroska", "webm": "video/webm", "avi": "video/x-msvideo",
    "flv": "video/x-flv", "wmv": "video/x-ms-wmv", "ts": "video/mp2t",
}

_FAST_ALIASES = {"fast", "copy", "quick", "stream", "快速", "流复制"}
_PRECISE_ALIASES = {"precise", "accurate", "accurate-cut", "reencode", "re-encode", "精确", "重编码"}


def _normalize_mode(mode: Any) -> str:
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


def normalize_container(value: Any) -> str:
    """payload.container：只认 same / mp4；缺省与非法值一律按 same（前端目前不发这个字段）。"""
    raw = str(value if value is not None else "").strip().lower().lstrip(".")
    if raw == "mp4":
        return "mp4"
    return "same"


def resolve_output_suffix(src_path: Any, container: Any = None) -> str:
    """输出文件后缀（含点）。

    container="same" 且源扩展名在实测白名单里 → 用源后缀（可流复制、无损、秒出）；
    否则（container="mp4"、源扩展名不在白名单、源没有扩展名）→ ".mp4"。
    """
    src_ext = Path(str(src_path or "")).suffix.lower().lstrip(".")
    if normalize_container(container) == "same" and src_ext in SAME_CONTAINER_EXTS:
        return "." + src_ext
    return ".mp4"


def _movflags_args(ext: str) -> list:
    return ["-movflags", "+faststart"] if ext in _MOVFLAGS_EXTS else []


def _precise_codec_args(ext: str) -> list:
    """重编码参数：webm 只认 VP8/VP9/AV1，其余容器用 h264+aac（均实测通过）。"""
    if ext == "webm":
        return ["-c:v", "libvpx-vp9", "-crf", "32", "-b:v", "0", "-cpu-used", "2",
                "-deadline", "good", "-c:a", "libopus", "-b:a", "128k"]
    return ["-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "192k"]


def _output_ok(path: Any, min_bytes: int = 1) -> bool:
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


def _time_args(start: float, duration_arg: Optional[float]) -> list:
    args = ["-ss", f"{start:.3f}"]
    if duration_arg is not None:
        args += ["-t", f"{duration_arg:.3f}"]
    return args


def trim_video(
    input_path: str,
    output_path: str,
    start: Any = None,
    end: Any = None,
    mode: str = "fast",
    container: Any = "same",
    on_progress=None,
) -> Dict[str, Any]:
    """裁剪视频。

    Args:
        input_path: 源视频
        output_path: 输出路径（后缀决定容器；用 resolve_output_suffix() 算出来即可）
        start: 开始时间（"10" / "00:00:10" / 10），缺省 0
        end: 结束时间，缺省 = 裁到结尾
        mode: fast（流复制）| precise（精确重编码）
        container: same（缺省，跟随源容器）| mp4（强制 mp4）
    """
    try:
        mode_key = _normalize_mode(mode)
        src = require_existing_file(input_path, "源视频文件")
        info = probe_media(src)
        if not info["has_video"]:
            raise MediaError("这个文件里没有视频画面，无法裁剪视频（如果是音频文件，请改用「音频裁剪」）")

        start_sec = parse_time_spec(start, "开始时间")
        if start_sec is None:
            start_sec = 0.0
        end_sec = parse_time_spec(end, "结束时间")
        start_sec, end_sec, clamped = resolve_range(start_sec, end_sec, info["duration"], "视频")

        duration_arg = None
        if end_sec is not None:
            duration_arg = max(0.05, end_sec - start_sec)

        out = Path(output_path)
        if out.parent and str(out.parent):
            out.parent.mkdir(parents=True, exist_ok=True)

        ffmpeg = get_ffmpeg_path()
        notes = []
        if clamped:
            notes.append("结束时间超过视频长度，已自动裁到结尾")

        wanted = normalize_container(container)
        src_ext = src.suffix.lower().lstrip(".")
        out_ext = out.suffix.lower().lstrip(".") or "mp4"
        if wanted == "same" and src_ext not in SAME_CONTAINER_EXTS:
            notes.append(
                f"源文件扩展名 .{src_ext}（空=没有扩展名）不能直接当输出容器，已输出为 .{out_ext}"
                if src_ext else f"源文件没有扩展名，已输出为 .{out_ext}"
            )
        elif wanted == "mp4" and out_ext == "mp4" and src_ext != "mp4":
            notes.append(f"已按要求强制输出为 mp4（源容器为 .{src_ext}）")

        def _fast_cmd(target: Path) -> list:
            # -ss 放在 -i 之前：快速定位到关键帧；-c copy 不重编码
            cmd = [ffmpeg, "-nostdin", "-hide_banner", "-nostats", "-y"]
            cmd += _time_args(start_sec, duration_arg)
            cmd += ["-i", str(src), "-map", "0:v:0", "-map", "0:a?"]
            cmd += ["-c", "copy", "-avoid_negative_ts", "make_zero"]
            cmd += _movflags_args(target.suffix.lower().lstrip("."))
            cmd += [str(target)]
            return cmd

        def _precise_cmd(target: Path) -> list:
            ext = target.suffix.lower().lstrip(".")
            cmd = [ffmpeg, "-nostdin", "-hide_banner", "-nostats", "-y"]
            cmd += _time_args(start_sec, duration_arg)
            cmd += ["-i", str(src), "-map", "0:v:0", "-map", "0:a?"]
            cmd += _precise_codec_args(ext)
            cmd += _movflags_args(ext)
            cmd += [str(target)]
            return cmd

        used = mode_key
        if mode_key == "fast":
            if on_progress:
                on_progress("正在快速裁剪（流复制）...")
            result = run_process(_fast_cmd(out), timeout=MEDIA_TIMEOUT)
            reason = ""
            if result.returncode != 0 or not _output_ok(out):
                reason = error_tail(result, 160)
            else:
                # 流复制偶尔会产出没有画面 / 时长离谱的文件，这里实测一次再决定
                out_info = probe_media(out)
                out_dur = out_info["duration"]
                expected = duration_arg
                if not out_info["has_video"]:
                    reason = "流复制产出的文件里没有画面"
                elif out_dur is None or out_dur <= 0.05:
                    reason = "流复制产出的文件没有有效时长"
                elif expected and abs(out_dur - expected) > max(2.0, 0.6 * expected):
                    reason = (
                        f"流复制产出的时长不正确（{format_seconds(out_dur)} 秒，"
                        f"期望 {format_seconds(expected)} 秒）"
                    )
            if reason:
                notes.append(f"流复制不可用，已自动改用精确重编码（{reason}）")
                used = "precise"
                _drop(out)

        if used == "precise":
            if on_progress:
                on_progress("正在精确重编码裁剪...")
            result = run_process(_precise_cmd(out), timeout=MEDIA_TIMEOUT)
            ok = result.returncode == 0 and _output_ok(out)
            if not ok and out_ext != "mp4" and wanted == "same":
                # 有些容器装不下 h264/aac（或源容器本身不接受重编码）：
                # 退回最保险的 mp4 再试一次，而不是直接把任务判失败。
                alt = out.with_name(f"{out.stem}.mp4")
                retry = run_process(_precise_cmd(alt), timeout=MEDIA_TIMEOUT)
                if retry.returncode == 0 and _output_ok(alt):
                    _drop(out)
                    out = alt
                    out_ext = "mp4"
                    ok = True
                    notes.append(f"源容器 .{src_ext} 无法用 h264/aac 重编码，已改用 mp4 输出")
            if not ok:
                raise MediaError(f"视频裁剪失败：{error_tail(result)}")

        final_info = probe_media(out)
        if not _output_ok(out) or not final_info["has_video"]:
            raise MediaError("裁剪失败：没有生成有效的视频文件，请确认源视频可以正常播放")

        if used == "fast":
            message = "视频裁剪完成（流复制：秒级完成、不损失画质，切点会对齐到关键帧，可能有零点几秒偏差）"
        else:
            message = "视频裁剪完成（精确重编码：切点精确，画质有轻微重编码损失）"
        message += f"，输出容器 {out.suffix.lower() or '.mp4'}"
        if notes:
            message += "；" + "；".join(notes)

        return {
            "success": True,
            "output": str(out),
            "filename": out.name,
            "mime": _MIME_BY_EXT.get(out.suffix.lower().lstrip("."), "video/mp4"),
            "container": out.suffix.lower().lstrip("."),
            "duration": final_info["duration"],
            "message": message,
        }
    except MediaError as exc:
        return failed(exc)
    except Exception as exc:  # noqa: BLE001
        return failed(exc, "视频裁剪失败")


def _parse_width(width: Any) -> Optional[int]:
    if width is None:
        return None
    raw = str(width).strip()
    if raw == "":
        return None
    try:
        value = int(float(raw))
    except (TypeError, ValueError):
        raise MediaError(f"缩放宽度必须是数字，收到的是「{width}」") from None
    if value < 2:
        raise MediaError("缩放宽度至少为 2 像素")
    if value > MAX_THUMB_WIDTH:
        raise MediaError(f"缩放宽度 {value} 太大，最大支持 {MAX_THUMB_WIDTH} 像素")
    return value


def extract_thumbnail(
    input_path: str,
    output_path: str,
    time: Any = None,
    fmt: str = "png",
    width: Any = None,
    on_progress=None,
) -> Dict[str, Any]:
    """从本地视频里抽一帧做缩略图。"""
    try:
        src = require_existing_file(input_path, "源视频文件")
        fmt_raw = str(fmt if fmt is not None else "png").strip().lower().lstrip(".")
        if fmt_raw in ("jpeg", "jpe"):
            fmt_raw = "jpg"
        if fmt_raw not in ("png", "jpg"):
            raise MediaError(f"不支持的缩略图格式：「{fmt}」，仅支持 png 或 jpg")

        at_time = parse_time_spec(time, "截图时间")
        if at_time is None:
            at_time = 0.0
        width_px = _parse_width(width)

        info = probe_media(src)
        if not info["has_video"]:
            raise MediaError("这个文件里没有视频画面，无法抽取缩略图")
        duration = info["duration"]
        if duration is not None and duration > 0 and at_time > duration:
            raise MediaError(
                f"这个视频只有 {format_seconds(duration)} 秒，取不到第 "
                f"{format_seconds(at_time)} 秒的画面"
            )

        out = Path(output_path)
        if out.parent and str(out.parent):
            out.parent.mkdir(parents=True, exist_ok=True)

        ffmpeg = get_ffmpeg_path()
        vf = f"scale={width_px}:-2:flags=lanczos" if width_px else None

        # 只尝试一次请求的时间点；若刚好落在结尾取不到画面，再退一点点重试一次
        attempts = [at_time]
        if duration is not None and duration > 0:
            fallback_time = min(at_time, max(0.0, duration - 0.2))
            if abs(fallback_time - at_time) > 1e-6:
                attempts.append(fallback_time)

        used_time = at_time
        last_result = None
        got = False
        for attempt in attempts:
            cmd = [ffmpeg, "-nostdin", "-hide_banner", "-nostats", "-y", "-ss", f"{attempt:.3f}",
                   "-i", str(src), "-frames:v", "1", "-an", "-sn"]
            if vf:
                cmd += ["-vf", vf]
            if fmt_raw == "jpg":
                cmd += ["-q:v", "2"]
            cmd += [str(out)]
            if on_progress:
                on_progress(f"正在抽取第 {format_seconds(attempt)} 秒的画面...")
            _drop(out)
            last_result = run_process(cmd, timeout=MEDIA_TIMEOUT)
            if last_result.returncode == 0 and _output_ok(out, 64):
                used_time = attempt
                got = True
                break
        if not got:
            raise MediaError(f"抽取缩略图失败：{error_tail(last_result)}")

        head = b""
        try:
            with open(out, "rb") as fh:
                head = fh.read(8)
        except OSError:
            head = b""
        if fmt_raw == "png" and not head.startswith(b"\x89PNG"):
            raise MediaError("生成的缩略图不是有效的 PNG 文件，请重试或换一个时间点")
        if fmt_raw == "jpg" and not head.startswith(b"\xff\xd8\xff"):
            raise MediaError("生成的缩略图不是有效的 JPG 文件，请重试或换一个时间点")

        message = f"缩略图已生成（第 {format_seconds(used_time)} 秒的画面）"
        if abs(used_time - at_time) > 1e-6:
            message += f"：{format_seconds(at_time)} 秒处已经没有画面，已自动改用 {format_seconds(used_time)} 秒"
        if width_px:
            message += f"，宽度已缩放到 {width_px} 像素"

        return {
            "success": True,
            "output": str(out),
            "filename": out.name,
            "mime": "image/png" if fmt_raw == "png" else "image/jpeg",
            "time": used_time,
            "message": message,
        }
    except MediaError as exc:
        return failed(exc)
    except Exception as exc:  # noqa: BLE001
        return failed(exc, "抽取缩略图失败")
