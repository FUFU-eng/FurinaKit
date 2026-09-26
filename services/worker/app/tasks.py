import contextvars
import logging
import json
import os
import re
import shutil
import tempfile
import zipfile
from pathlib import Path

from app.file_job_store import update_job as update_file_job
from app.job_store import update_job as update_redis_job
from app.storage_paths import results_dir

_logger = logging.getLogger("furinakit.tasks")

_SAFE_FILENAME_RE = re.compile(r"[^a-zA-Z0-9._-]+")

# ── 文件名清洗（见 _safe_filename）────────────────────────────────────
# 历史实现是「把 [^a-zA-Z0-9._-] 全换成 _，再 strip("._")」，有两个问题：
#   1) 中文/日文等非 ASCII 字符会被整段换掉：`数据.xlsx` → `_.xlsx` → strip 又把那个点吃掉 → `xlsx`
#      （交付给用户的文件没有扩展名、双击打不开；而中文文件名在这个 App 里是常态）；
#   2) 末尾的点/空格 Windows 不接受，保留名（CON/PRN/COM1…）会直接写文件失败。
# 新规则（对外承诺）：
#   1) 纯 ASCII 名字与旧实现逐字节一致（空格/路径分隔符等 -> _，首尾多余的点与下划线去掉）；
#   2) 中文、日文等非 ASCII 字符原样保留；
#   3) 扩展名永远保留（除非原文件名本来就没有扩展名）；
#   4) Windows 保留名加前缀 _ 避开；主名限长 80，避免路径过长。
# 关键点：非法字符先被换成 `_`，所以右侧 `.rstrip(" .")` 不会误删「由空格变来的下划线」，
#         这也是「纯 ASCII 与旧实现完全一致」的原因（旧实现里 `a .csv` 同样是 `a_.csv`）。
_UNSAFE_STEM_RUN_RE = re.compile(r"[^0-9A-Za-z._\-\u0080-\U0010ffff]+")
_UNSAFE_EXT_RUN_RE = re.compile(r"[^0-9A-Za-z.\u0080-\U0010ffff]+")
_WINDOWS_RESERVED_NAMES = frozenset(
    {"CON", "PRN", "AUX", "NUL"}
    | {f"COM{i}" for i in range(1, 10)}
    | {f"LPT{i}" for i in range(1, 10)}
)
_MAX_STEM_LENGTH = 80
_MAX_EXT_LENGTH = 16

# 终态：写下去之后前端就不会再转圈了
_TERMINAL_STATUSES = {"completed", "failed"}

# 每个 job 的临时目录列表（用于 finally 里统一清理，避免 %TEMP% 被逐步占满）
_job_temp_dirs: contextvars.ContextVar[list[str] | None] = contextvars.ContextVar(
    "furinakit_job_temp_dirs", default=None
)
# 每个 job 的状态上下文（记录是否已写入终态，用于兜底）
_job_state: contextvars.ContextVar[dict | None] = contextvars.ContextVar(
    "furinakit_job_state", default=None
)

# Tool handlers are imported lazily inside process_job() so that a heavy/broken dependency
# in one tool can't prevent the worker from starting or block unrelated tools.


def _safe_filename(filename: str) -> str:
    """清洗结果文件名：去掉路径分隔符与非法字符，但保留中文与扩展名（见上方规则）。"""
    name = str(filename or "")
    stem, ext = os.path.splitext(name)

    stem = _UNSAFE_STEM_RUN_RE.sub("_", stem)
    if ext:
        # 有扩展名：只清洗主名两端，扩展名单独处理
        stem = stem.lstrip("._").rstrip(" .")
    else:
        stem = stem.strip("._")
    if len(stem) > _MAX_STEM_LENGTH:
        stem = stem[:_MAX_STEM_LENGTH].strip("._").rstrip(" .")

    # 扩展名只保留字母数字与点（同时允许非 ASCII，避免把「文件.中国」这种扩展名整段删掉）
    ext = _UNSAFE_EXT_RUN_RE.sub("", ext)[:_MAX_EXT_LENGTH]

    if not stem:
        stem = "result"
        if not ext:
            # 与旧实现一致的回退值：带扩展名，绝不会是「没有后缀、打不开」的文件
            ext = ".bin"
    head = stem.upper().split(".")[0]
    if stem.upper() in _WINDOWS_RESERVED_NAMES or head in _WINDOWS_RESERVED_NAMES:
        stem = "_" + stem
    return stem + ext


def _store_result(job_id: str, source_path: str, filename: str) -> str:
    safe_name = _safe_filename(filename)
    state = _job_state.get()
    if state is not None and state.get("defer"):
        state["moves"].append((str(source_path), safe_name))
        return safe_name  # Published only after every tracked child tree is confirmed.
    target = results_dir() / f"{job_id}-{safe_name}"
    source = Path(source_path)
    if source.resolve() != target.resolve():
        shutil.move(str(source), str(target))
    return safe_name


def _store_dir_as_zip(job_id: str, source_dir: str, zip_name: str) -> str:
    """把目录打包成 zip 后存储，返回最终文件名"""
    src = Path(source_dir)
    zip_path = src.parent / (zip_name if zip_name.endswith(".zip") else zip_name + ".zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for f in src.rglob("*"):
            if f.is_file():
                zf.write(f, f.relative_to(src))
    return _store_result(job_id, str(zip_path), zip_path.name)


def _set_status(job_id: str, use_file: bool, **updates):
    state = _job_state.get()
    if state is not None and state.get("defer") and updates.get("status") in _TERMINAL_STATUSES:
        state["pending"] = dict(updates)
        return None
    result = update_file_job(job_id, **updates) if use_file else update_redis_job(job_id, **updates)
    if updates.get("status") in _TERMINAL_STATUSES:
        state = _job_state.get()
        if state is not None:
            state["terminal"] = True
    return result


def _safe_set_status(job_id: str, use_file: bool, **updates):
    """状态写入失败（磁盘满/权限/文件损坏）只记日志，绝不再向上抛。

    否则 process_job 的异常会一路冒泡到 worker 主循环，job 状态永远停在 pending，
    前端只能一直转圈且没有任何提示。
    """
    try:
        return _set_status(job_id, use_file, **updates)
    except Exception as exc:  # noqa: BLE001
        _logger.warning("Failed to update status of job %s: %s", job_id, exc, exc_info=True)
        return None


def _tmp_dir() -> str:
    """为本任务创建一个临时目录，并登记到当前 job 上下文，退出时统一清理。"""
    td = tempfile.mkdtemp(prefix="furinakit_")
    dirs = _job_temp_dirs.get()
    if dirs is not None:
        dirs.append(td)
    return td


def _cleanup_tmp_dirs(dirs) -> None:
    """清理本任务的临时目录。

    结果文件在 _finish_file/_store_result 里已经用 shutil.move 移出临时目录
    （落到 results_dir()），因此删除临时目录不会影响已经交付的结果文件。
    """
    for td in dirs or []:
        shutil.rmtree(td, ignore_errors=True)


def _finish_file(job_id, use_file, output_path, filename, mime, message="处理完成"):
    final_name = _store_result(job_id, output_path, filename)
    _set_status(
        job_id, use_file, status="completed", progress=100,
        message=message, resultFilename=final_name, resultMimeType=mime,
    )


def _finish_dict_result(job_id, use_file, result, default_mime="application/octet-stream", message="处理完成"):
    """处理返回 Dict 的工具结果（image_tools / pdf_tools / audio_tools / office_to_pdf / pdf_convert）"""
    if not result.get("success"):
        raise RuntimeError(result.get("error", "处理失败"))
    output = result.get("output")
    if not output:
        raise RuntimeError("未生成输出文件")
    p = Path(output)
    mime_map = {
        ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg", ".webp": "image/webp", ".gif": "image/gif",
        ".bmp": "image/bmp", ".tif": "image/tiff", ".tiff": "image/tiff",
        ".mp3": "audio/mpeg", ".wav": "audio/wav", ".flac": "audio/flac",
        ".aac": "audio/aac", ".m4a": "audio/mp4", ".ogg": "audio/ogg",
        ".opus": "audio/opus", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ".zip": "application/zip",
        ".ico": "image/x-icon",
    }
    # 工具显式返回的 MIME 优先（例如 image_watermark 声明它真实写出的格式），
    # 其次按最终文件名后缀推断，保证「文件内容 / 扩展名 / MIME」三者一致。
    mime = result.get("mime") or mime_map.get(p.suffix.lower(), default_mime)
    _finish_file(job_id, use_file, str(p), p.name, mime, message)


def _parse_ico_sizes(val):
    if not val or val == "all":
        return [16, 24, 32, 48, 64, 128, 256]
    if val == "favicon":
        return [16, 32]
    if val == "desktop":
        return [32, 48, 256]
    if isinstance(val, list):
        parsed = [int(x) for x in val if str(x).isdigit()]
        return parsed if parsed else [16, 24, 32, 48, 64, 128, 256]
    if str(val).isdigit():
        return [int(val)]
    if "," in str(val):
        parsed = [int(x.strip()) for x in str(val).split(",") if x.strip().isdigit()]
        return parsed if parsed else [16, 24, 32, 48, 64, 128, 256]
    return [16, 24, 32, 48, 64, 128, 256]


def _payload_number(payload: dict, key: str, default):
    """读取数值型参数：缺省 / 空值 / 非法值一律回退到默认值，避免 None、"" 把任务直接搞挂。"""
    raw = payload.get(key)
    if raw is None or raw == "":
        return default
    try:
        return type(default)(float(raw))
    except (TypeError, ValueError):
        return default


def _payload_bool(payload: dict, key: str, default: bool) -> bool:
    """读取开关型参数：表单里勾选框可能传 "true"/"on"/"1"，也可能是真布尔值。"""
    raw = payload.get(key)
    if raw is None or raw == "":
        return default
    if isinstance(raw, bool):
        return raw
    return str(raw).strip().lower() in ("1", "true", "on", "yes", "是")


def process_job(job_id: str, tool_id: str, payload: dict, use_file: bool = False) -> None:
    """Keep configured task lease/scratch/slot until owned subprocess cleanup confirms.

    Terminal updates and result moves are staged while the body runs. Unconfigured
    legacy callers keep their prior behavior; native launch bypass and owner death
    are not covered by this in-process CPython subprocess adapter.
    """
    tmp_dirs: list[str] = []
    tmp_token = _job_temp_dirs.set(tmp_dirs)
    managed = os.environ.get("FURINAKIT_COMPONENT_LEASE_NAMESPACE") is not None
    job_state = {"terminal": False, "defer": managed, "moves": [], "pending": None}
    state_token = _job_state.set(job_state)
    confirmed = False

    def pending_cleanup():
        _safe_set_status(job_id, use_file, status="processing", progress=99,
                         message="正在停止任务子进程，请稍候", processCleanupPending=True,
                         processCleanupConfirmed=False)

    try:
        _safe_set_status(job_id, use_file, status="processing", progress=10, message="Starting...")
        try:
            from app.component_leases import task_lease
            from app.task_processes import task_scope
            with task_lease():
                with task_scope(pending_cleanup):
                    _run_job(job_id, tool_id, payload, use_file)
                confirmed = managed
                # Child trees are now empty. Keep the lease during staged publication.
                job_state["defer"] = False
                updates = job_state["pending"]
                if updates is not None:
                    if updates.get("status") == "completed":
                        for source, filename in job_state["moves"]:
                            _store_result(job_id, source, filename)
                    _safe_set_status(job_id, use_file, **dict(updates,
                        processCleanupPending=False, processCleanupConfirmed=confirmed))
        except Exception as exc:  # noqa: BLE001
            # task_scope does not return from an unconfirmed cleanup. A forced stop
            # can report failure even after confirmation, but is never task success.
            job_state["defer"] = False
            _safe_set_status(job_id, use_file, status="failed", progress=100,
                             message="处理失败", error=str(exc), processCleanupPending=False,
                             processCleanupConfirmed=confirmed)
    finally:
        if not job_state.get("terminal"):
            job_state["defer"] = False
            _safe_set_status(job_id, use_file, status="failed", progress=100,
                             message="处理失败", error="任务结束前未写入终态")
        _job_state.reset(state_token)
        _job_temp_dirs.reset(tmp_token)
        _cleanup_tmp_dirs(tmp_dirs)

def _run_job(job_id: str, tool_id: str, payload: dict, use_file: bool) -> None:
    # 支持单文件（"file"）和多文件（"files" 或 "file" 数组）两种格式
    file_val = payload.get("file") if payload.get("file") is not None else payload.get("files")
    if isinstance(file_val, list):
        files = [str(f) for f in file_val if f]
        input_path = files[0] if files else ""
    else:
        input_path = str(file_val or "")
        files = [input_path] if input_path else []

    # ── 抠图 ──────────────────────────────────────────────────────────
    if tool_id == "bg-remove":
        # 走自研的 ONNX 推理，不再依赖 rembg。
        # 这样可以把 rembg 及其拖来的 numba / llvmlite / scipy 一起卸掉（约 134MB）。
        # 预处理与后处理严格照逐像素比对 rembg 得出的配方：
        #   只 /255、min-max 归一化（不是 sigmoid）、不加 mean/std、LANCZOS 缩放
        import os as _os5
        import numpy as _np5
        import cv2 as _cv5
        from PIL import Image as _Image5
        from app.tools import isnet_matting as _im5

        comp = _os5.environ.get("FURINAKIT_COMPONENTS_DIR") or _os5.path.join(
            _os5.getcwd(), "..", "..", "apps", "web", "components")
        model_name = str(payload.get("model", "u2net"))
        # 模型文件对应关系
        files = {
            "u2net": "u2net.onnx",
            "u2net_human_seg": "u2net_human_seg.onnx",
            "isnet-general-use": "isnet-general-use.onnx",
        }
        mf = files.get(model_name, "u2net.onnx")
        mp = _os5.path.join(comp, mf)
        if not _os5.path.isfile(mp):
            raise RuntimeError(
                f"还没下载抠图模型（{mf}），请在工具页上方或设置里的「按需下载组件」下载后重试")

        img = _cv5.imdecode(_np5.fromfile(input_path, dtype=_np5.uint8), _cv5.IMREAD_COLOR)
        if img is None:
            raise RuntimeError("无法读取图片")

        alpha = _im5.alpha_with_model(img, mp)

        # 组装结果：透明底 PNG，或按 bg_color 换成纯色底
        h, w = img.shape[:2]
        bg = str(payload.get("bg_color", "") or "").strip()
        rgba = _np5.dstack([_cv5.cvtColor(img, _cv5.COLOR_BGR2RGB), alpha])
        out_img = _Image5.fromarray(rgba, "RGBA")
        suffix = "_已抠图"
        if bg:
            palette = {
                "white": (255, 255, 255), "black": (0, 0, 0),
                "blue": (219, 68, 55), "red": (36, 28, 237),
                "green": (80, 175, 76), "gray": (200, 200, 200),
            }
            rgb = palette.get(bg, (255, 255, 255))
            canvas = _Image5.new("RGB", (w, h), rgb)
            canvas.paste(out_img, mask=out_img.split()[3])
            out_img = canvas
            suffix = "_已换底"

        out = Path(_tmp_dir()) / f"{Path(input_path).stem}{suffix}.png"
        out_img.save(str(out), "PNG")
        _finish_file(job_id, use_file, str(out), out.name, "image/png",
                     f"抠图完成（{model_name}）")
        return

    if tool_id == "image-upscale":
        from app.tools.image_upscale import upscale_image
        model = str(payload.get("model", "anime-x2"))
        scale = int(payload.get("scale", 2))

        if len(files) > 1:
            import zipfile
            td = _tmp_dir()
            out_files = []
            total = len(files)
            for idx, fpath in enumerate(files):
                src = Path(fpath)
                _set_status(job_id, use_file, progress=int(10 + (idx / total) * 80),
                            message=f"AI 放大中 {idx+1}/{total}: {src.name}")
                out_p, fn = upscale_image(fpath, model, scale)
                out_files.append((out_p, fn))
                
            zip_path = Path(td) / "upscaled_images.zip"
            with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
                for out_p, fn in out_files:
                    zf.write(out_p, fn)
            _finish_file(job_id, use_file, str(zip_path), "upscaled_images.zip", "application/zip", f"已完成放大 {total} 张图片")
            return

        _set_status(job_id, use_file, progress=20, message="AI 放大中...")
        output_path, filename = upscale_image(input_path, model, scale)
        _finish_file(job_id, use_file, output_path, filename, "image/png", "放大完成")
        return

    # ── 图片处理（image_tools.py，返回 Dict）──────────────────────────
    if tool_id in ("image-compress", "image-crop", "image-resize", "image-rotate",
                    "image-to-jpg", "image-format-convert", "gif-compress", "gif-crop", "image-to-ico", "image-watermark"):
        from app.tools import image_tools
        td = _tmp_dir()
            
        # 批量处理：如果有多个文件，逐个处理并打包 zip
        if len(files) > 1 and tool_id in ("image-compress", "image-format-convert", "image-to-jpg", "image-to-ico", "image-watermark"):
            import zipfile
            output_files = []
            total = len(files)
                
            for idx, fpath in enumerate(files):
                src = Path(fpath)
                ext = src.suffix.lower()
                _set_status(job_id, use_file, progress=int(10 + (idx / total) * 80), 
                            message=f"处理中 {idx+1}/{total}: {src.name}")
                    
                if tool_id == "image-compress":
                    out = Path(td) / f"{src.stem}_compressed.jpg"
                    quality = int(payload.get("quality", 75))
                    max_w = payload.get("max_width")
                    max_width = int(max_w) if max_w else None
                    result = image_tools.image_compress(fpath, str(out), quality, max_width)
                elif tool_id == "image-format-convert":
                    fmt = str(payload.get("format", "webp")).lower()
                    out = Path(td) / f"{src.stem}.{fmt}"
                    result = image_tools.image_format_convert(fpath, str(out), fmt, int(payload.get("quality", 90)))
                elif tool_id == "image-to-jpg":
                    out = Path(td) / f"{src.stem}.jpg"
                    result = image_tools.image_to_jpg(fpath, str(out), int(payload.get("quality", 95)))
                elif tool_id == "image-to-ico":
                    out = Path(td) / f"{src.stem}.ico"
                    ico_sizes = _parse_ico_sizes(payload.get("sizes"))
                    result = image_tools.image_to_ico(fpath, str(out), sizes=ico_sizes)
                elif tool_id == "image-watermark":
                    out = Path(td) / f"{src.stem}_watermarked{ext}"
                    f_size = payload.get("actual_font_size") or payload.get("font_size") or payload.get("fontSize") or payload.get("size") or 36
                    f_rot = payload.get("rotate") or payload.get("angle") or payload.get("rotation") or 0
                    f_xp = payload.get("x_percent") if payload.get("x_percent") is not None else payload.get("x", -1)
                    f_yp = payload.get("y_percent") if payload.get("y_percent") is not None else payload.get("y", -1)
                    result = image_tools.image_watermark(
                        fpath, str(out),
                        str(payload.get("text", "FurinaKit")),
                        str(payload.get("position", "bottom-right")),
                        int(float(f_size)),
                        int(float(payload.get("opacity", 50))),
                        str(payload.get("color", "#ffffff")),
                        float(f_rot),
                        float(f_xp),
                        float(f_yp),
                    )
                    
                if result.get("success"):
                    # 工具可能因为格式不匹配而改写输出路径（例如不支持的原扩展名退化为 .png），
                    # 因此以工具返回的 output 为准，避免打包进不存在或错误的文件
                    output_files.append(str(result.get("output") or out))
                
            # 打包成 zip
            if output_files:
                zip_path = Path(td) / "batch_result.zip"
                with zipfile.ZipFile(str(zip_path), "w", zipfile.ZIP_DEFLATED) as zf:
                    for of in output_files:
                        zf.write(of, Path(of).name)
                    
                _set_status(job_id, use_file, progress=100, message=f"批量处理完成，共 {len(output_files)} 个文件")
                _finish_file(job_id, use_file, str(zip_path), "batch_result.zip", "application/zip", "批量处理完成")
                return
            
        # 单文件处理
        src = Path(input_path)
        ext = src.suffix.lower()

        if tool_id == "image-compress":
            out = Path(td) / f"{src.stem}_compressed.jpg"
            quality = int(payload.get("quality", 75))
            max_w = payload.get("max_width")
            max_width = int(max_w) if max_w else None
            result = image_tools.image_compress(input_path, str(out), quality, max_width)
        elif tool_id == "image-crop":
            out = Path(td) / f"{src.stem}_cropped{ext}"
            result = image_tools.image_crop(
                input_path, str(out),
                int(payload.get("x", 0)), int(payload.get("y", 0)),
                int(payload.get("width", 100)), int(payload.get("height", 100)),
            )
        elif tool_id == "image-resize":
            out = Path(td) / f"{src.stem}_resized{ext}"
            w = payload.get("width"); h = payload.get("height")
            result = image_tools.image_resize(
                input_path, str(out),
                int(w) if w else None, int(h) if h else None,
                bool(payload.get("keep_ratio", True)),
            )
        elif tool_id == "image-rotate":
            out = Path(td) / f"{src.stem}_rotated{ext}"
            result = image_tools.image_rotate(input_path, str(out), float(payload.get("angle", 90)))
        elif tool_id == "image-to-jpg":
            out = Path(td) / f"{src.stem}.jpg"
            result = image_tools.image_to_jpg(input_path, str(out), int(payload.get("quality", 95)))
        elif tool_id == "image-format-convert":
            fmt = str(payload.get("format", "webp")).lower()
            out = Path(td) / f"{src.stem}.{fmt}"
            result = image_tools.image_format_convert(input_path, str(out), fmt, int(payload.get("quality", 90)))
        elif tool_id == "gif-compress":
            out = Path(td) / f"{src.stem}_compressed.gif"
            max_w = payload.get("max_width")
            result = image_tools.gif_compress(input_path, str(out), int(payload.get("quality", 75)),
                                                int(max_w) if max_w else None)
        elif tool_id == "gif-crop":
            out = Path(td) / f"{src.stem}_cropped.gif"
            result = image_tools.gif_crop(
                input_path, str(out),
                int(payload.get("x", 0)), int(payload.get("y", 0)),
                int(payload.get("width", 100)), int(payload.get("height", 100)),
            )
        elif tool_id == "image-to-ico":
            out = Path(td) / f"{src.stem}.ico"
            ico_sizes = _parse_ico_sizes(payload.get("sizes"))
            result = image_tools.image_to_ico(input_path, str(out), sizes=ico_sizes)
        elif tool_id == "image-watermark":
            out = Path(td) / f"{src.stem}_watermarked{ext}"
            f_size = payload.get("actual_font_size") or payload.get("font_size") or payload.get("fontSize") or payload.get("size") or 36
            f_rot = payload.get("rotate") or payload.get("angle") or payload.get("rotation") or 0
            f_xp = payload.get("x_percent") if payload.get("x_percent") is not None else payload.get("x", -1)
            f_yp = payload.get("y_percent") if payload.get("y_percent") is not None else payload.get("y", -1)
            result = image_tools.image_watermark(
                input_path, str(out),
                str(payload.get("text", "FurinaKit")),
                str(payload.get("position", "bottom-right")),
                int(float(f_size)),
                int(float(payload.get("opacity", 50))),
                str(payload.get("color", "#ffffff")),
                float(f_rot),
                float(f_xp),
                float(f_yp),
            )
        _finish_dict_result(job_id, use_file, result, message="图片处理完成")
        return

    # ── 图片分割（多文件输出 → zip）───────────────────────────────────
    if tool_id == "image-split":
        from app.tools import image_tools
        td = _tmp_dir()
        out_dir = Path(td) / "split_result"
        out_dir.mkdir(exist_ok=True)
        result = image_tools.image_split(
            input_path, str(out_dir),
            int(payload.get("rows", 2)), int(payload.get("cols", 2)),
        )
        if not result.get("success"):
            raise RuntimeError(result.get("error", "分割失败"))
        zip_name = _store_dir_as_zip(job_id, str(out_dir), "split_images.zip")
        _set_status(job_id, use_file, status="completed", progress=100,
                    message="分割完成", resultFilename=zip_name, resultMimeType="application/zip")
        return

    # ── PDF 工具（pdf_tools.py，返回 Dict）────────────────────────────
    if tool_id in ("pdf-merge", "pdf-compress", "pdf-rotate", "pdf-delete-pages",
                    "pdf-reorder", "pdf-unlock", "pdf-encrypt", "pdf-watermark",
                    "pdf-page-numbers", "pdf-crop", "pdf-enhance", "images-to-pdf", "image-to-pdf"):
        from app.tools import pdf_tools
        td = _tmp_dir()
        src = Path(input_path) if input_path else None

        if tool_id == "pdf-merge":
            out = Path(td) / "merged.pdf"
            result = pdf_tools.pdf_merge([str(f) for f in files], str(out))
        elif tool_id == "pdf-compress":
            out = Path(td) / f"{src.stem}_compressed.pdf"
            result = pdf_tools.pdf_compress(input_path, str(out), int(payload.get("quality", 75)))
        elif tool_id == "pdf-rotate":
            out = Path(td) / f"{src.stem}_rotated.pdf"
            result = pdf_tools.pdf_rotate(input_path, str(out), int(payload.get("rotation", 90)),
                                           payload.get("pages"))
        elif tool_id == "pdf-delete-pages":
            out = Path(td) / f"{src.stem}_deleted.pdf"
            result = pdf_tools.pdf_delete_pages(input_path, str(out), str(payload.get("pages", "")))
        elif tool_id == "pdf-reorder":
            out = Path(td) / f"{src.stem}_reordered.pdf"
            result = pdf_tools.pdf_reorder_pages(input_path, str(out), str(payload.get("order", "")))
        elif tool_id == "pdf-unlock":
            out = Path(td) / f"{src.stem}_unlocked.pdf"
            result = pdf_tools.pdf_unlock(input_path, str(out), str(payload.get("password", "")))
        elif tool_id == "pdf-encrypt":
            out = Path(td) / f"{src.stem}_encrypted.pdf"
            result = pdf_tools.pdf_encrypt(
                input_path, str(out),
                user_password=str(payload.get("user_password", "")),
                owner_password=str(payload.get("owner_password", "")),
            )
        elif tool_id == "pdf-watermark":
            out = Path(td) / f"{src.stem}_watermarked.pdf"
            # 默认值与 packages/shared/src/tools.ts 的 pdf-watermark 定义保持一致
            # （font_size=40 / opacity=0.3 / rotation=45），界面上传的字段必须真正透传下去
            result = pdf_tools.pdf_add_watermark(
                input_path, str(out),
                text=str(payload.get("text", "CONFIDENTIAL")),
                font_size=_payload_number(payload, "font_size", 40),
                opacity=_payload_number(payload, "opacity", 0.3),
                rotation=_payload_number(payload, "rotation", 45),
            )
        elif tool_id == "pdf-page-numbers":
            out = Path(td) / f"{src.stem}_numbered.pdf"
            # font_size / start_from 同样是界面会提交、以前被直接丢弃的参数
            # （默认值 12 / 1，与 tools.ts 中 pdf-page-numbers 的默认值一致）
            result = pdf_tools.pdf_add_page_numbers(
                input_path, str(out),
                position=str(payload.get("position", "bottom-center")),
                font_size=_payload_number(payload, "font_size", 12),
                start_from=_payload_number(payload, "start_from", 1),
            )
        elif tool_id == "pdf-crop":
            out = Path(td) / f"{src.stem}_cropped.pdf"
            # 新版界面提交逐页边距（JSON），老版是四个统一数字；两种都支持
            raw_per_page = payload.get("per_page")
            if raw_per_page:
                try:
                    per_page = json.loads(raw_per_page) if isinstance(raw_per_page, str) else raw_per_page
                except Exception:
                    per_page = None
                result = pdf_tools.pdf_crop_pages(
                    input_path, str(out),
                    per_page=per_page,
                    default=None,
                    unit=str(payload.get("unit", "mm")),
                )
            else:
                result = pdf_tools.pdf_crop(
                    input_path, str(out),
                    top=_payload_number(payload, "top", 0),
                    bottom=_payload_number(payload, "bottom", 0),
                    left=_payload_number(payload, "left", 0),
                    right=_payload_number(payload, "right", 0),
                    pages=str(payload.get("pages", "")),
                    unit=str(payload.get("unit", "percent")),
                )
        elif tool_id == "pdf-enhance":
            from app.tools import pdf_enhance as pe
            out = Path(td) / f"{src.stem}_已增强.pdf"
            result = pe.pdf_enhance(
                input_path, str(out),
                mode=str(payload.get("mode", "gray")),
                strength=str(payload.get("strength", "medium")),
                dpi=int(_payload_number(payload, "dpi", 200)),
                pages=str(payload.get("pages", "")),
            )
        elif tool_id in ("images-to-pdf", "image-to-pdf"):
            merge_mode = str(payload.get("merge_mode", "merge"))
            page_size = str(payload.get("page_size", "a4"))
            orientation = str(payload.get("orientation", "portrait"))

            if merge_mode == "individual" and len(files) > 1:
                out_dir = Path(td) / "result"
                out_dir.mkdir(exist_ok=True)
                for f in files:
                    base_stem = Path(f).stem
                    single_out = out_dir / f"{base_stem}.pdf"
                    pdf_tools.images_to_pdf([str(f)], str(single_out), page_size=page_size, orientation=orientation)
                zip_name = _store_dir_as_zip(job_id, str(out_dir), "converted_pdfs.zip")
                _set_status(job_id, use_file, status="completed", progress=100,
                            message="独立转换完成", resultFilename=zip_name, resultMimeType="application/zip")
                return
            else:
                out = Path(td) / "images.pdf"
                result = pdf_tools.images_to_pdf(
                    [str(f) for f in files], str(out),
                    page_size=page_size,
                    orientation=orientation,
                )
        _finish_dict_result(job_id, use_file, result, message="PDF 处理完成")
        return

    # ── 用 AI 大纲生成可编辑的 PPTX ──────────────────────────────────
    if tool_id == "ppt-from-outline":
        from app.tools import ppt_build
        td = _tmp_dir()
        outline_json = str(payload.get("outline", "") or "")
        if not outline_json:
            raise RuntimeError("缺少大纲数据")
        out = Path(td) / "AI生成草稿.pptx"
        result = ppt_build.build_from_json(
            outline_json, str(out),
            theme_id=str(payload.get("theme", "business")),
            with_toc=_payload_bool(payload, "with_toc", True),
        )
        _finish_dict_result(
            job_id, use_file, result,
            default_mime="application/vnd.openxmlformats-officedocument.presentationml.presentation",
            message=f"已生成 {result.get('slides', 0)} 页可编辑草稿",
        )
        return

    # ── 音频降噪（谱减 + 保护有信号的频点，不需要模型）──────────────
    if tool_id == "audio-denoise":
        from app.tools import audio_denoise

        td = _tmp_dir()
        src = Path(input_path)
        out = Path(td) / f"{src.stem}_已降噪.wav"
        result = audio_denoise.denoise(
            input_path,
            str(out),
            strength=float(_payload_number(payload, "strength", 0.6)),
            noise_floor_percentile=float(_payload_number(payload, "percentile", 5)),
            oversubtract=float(_payload_number(payload, "oversubtract", 1.0)),
        )
        _finish_dict_result(
            job_id, use_file, result, default_mime="audio/wav",
            message=(
                f"已降噪（强度 {result.get('strength')}）：电平 {result.get('rmsBefore')} → "
                f"{result.get('rmsAfter')}，时长 {result.get('durationSec')} 秒"
            ),
        )
        return

    # V66: publish both stems inside the managed job result store, never the user's output directory.
    if tool_id == "vocal-separate":
        import os as _os
        import zipfile
        from app.tools import vocal_runner

        td = _tmp_dir()
        src = Path(input_path)
        selected = str(payload.get("model", "vocals"))
        if selected not in ("vocals", "instrumental"):
            raise ValueError("不支持的分离模式 / Unsupported separation mode")
        fname = "UVR-MDX-NET-Inst_HQ_3.onnx" if selected == "instrumental" else "UVR-MDX-NET-Voc_FT.onnx"
        components_dir = _os.environ.get("FURINAKIT_COMPONENTS_DIR") or ""
        candidates = [
            _os.path.join(components_dir, fname) if components_dir else "",
            _os.path.join(_os.getcwd(), "components", fname),
            _os.path.join(_os.getcwd(), "..", "..", "apps", "web", "components", fname),
        ]
        model_path = next((p for p in candidates if p and _os.path.isfile(p)), None)
        if not model_path:
            raise RuntimeError("请在设置中下载人声与伴奏双核心组件 / Download the vocal and instrumental model pair in Settings")
        work = Path(td) / "sep"
        work.mkdir(parents=True, exist_ok=True)
        def separation_progress(percent, message):
            _set_status(job_id, use_file, progress=percent, message=message)
        def separation_cancelled():
            if not use_file:
                return False
            root = _os.environ.get("STORAGE_DIR") or _os.environ.get("STORAGE_PATH")
            if not root:
                return False
            try:
                record = json.loads((Path(root) / "jobs" / f"{job_id}.json").read_text(encoding="utf-8"))
                return record.get("status") in ("cancelled", "canceled", "failed")
            except (OSError, ValueError):
                return False
        result = vocal_runner.separate(str(src), str(work), model_path, separation_progress, separation_cancelled, quality=str(payload.get("quality", "balanced")))
        _set_status(job_id, use_file, progress=98, message="正在打包人声与伴奏…")
        zip_path = Path(td) / "vocal-and-instrumental.zip"
        with zipfile.ZipFile(str(zip_path), "w", zipfile.ZIP_STORED) as zf:
            zf.write(result["vocals"], arcname="vocals.wav")
            zf.write(result["instrumental"], arcname="instrumental.wav")
        _store_result(job_id, result["vocals"], "vocals.wav")
        _store_result(job_id, result["instrumental"], "instrumental.wav")
        final_name = _store_result(job_id, str(zip_path), zip_path.name)
        _set_status(job_id, use_file, status="completed", progress=100,
                    message=f"分离完成，可先试听再保存 / Separation ready for preview (audio {result['durationSec']} s; processing {result.get('processingSeconds', 0)} s; {result.get('quality', 'balanced')})",
                    resultFilename=final_name, resultMimeType="application/zip", audioStems=True)
        return

    # ── AI 扩图（复用 LaMa 修补模型，不引入扩散模型）──────────────────
    if tool_id == "ai-outpaint":
        import os as _os
        from app.tools import outpaint

        td = _tmp_dir()
        src = Path(input_path)

        components_dir = _os.environ.get("FURINAKIT_COMPONENTS_DIR") or ""
        candidates = [
            _os.path.join(components_dir, "lama_fp32.onnx") if components_dir else "",
            _os.path.join(_os.getcwd(), "components", "lama_fp32.onnx"),
            _os.path.join(_os.getcwd(), "..", "..", "apps", "web", "components", "lama_fp32.onnx"),
        ]
        model_path = next((m for m in candidates if m and _os.path.isfile(m)), None)

        # 常用扩法预设 → 具体参数（界面上给的是预设，真正计算用这些数值）
        preset = str(payload.get("preset", "all25"))
        pads = {"all25": (0.25, 0.25, 0.25, 0.25), "lr50": (0.5, 0.5, 0.0, 0.0),
                "top50": (0.0, 0.0, 0.5, 0.0)}
        ratio_by_preset = {"169": 16 / 9, "916": 9 / 16, "11": 1.0}
        if preset in pads:
            left, right, top, bottom = pads[preset]
            ratio_raw = "none"
        elif preset in ratio_by_preset:
            left = right = top = bottom = 0.0
            ratio_raw = str(ratio_by_preset[preset])
        else:
            left = float(_payload_number(payload, "left", 0.25))
            right = float(_payload_number(payload, "right", 0.25))
            top = float(_payload_number(payload, "top", 0.25))
            bottom = float(_payload_number(payload, "bottom", 0.25))
            ratio_raw = str(payload.get("target_ratio", "none"))
        target_ratio = None
        if ratio_raw not in ("none", "", "0"):
            try:
                target_ratio = float(ratio_raw)
            except ValueError:
                target_ratio = None

        out = Path(td) / f"{src.stem}_已扩图.png"
        result = outpaint.outpaint(
            input_path,
            str(out),
            model_path=model_path,
            left=left, right=right, top=top, bottom=bottom,
            target_ratio=target_ratio,
            anchor=str(payload.get("anchor", "center")),
        )
        _finish_dict_result(
            job_id, use_file, result, default_mime="image/png",
            message=(
                f"已扩图：{result['sourceWidth']}×{result['sourceHeight']} → "
                f"{result['width']}×{result['height']}"
                f"（比例 {result['ratioBefore']} → {result['ratioAfter']}，"
                f"补全 {round(float(result['filledRatio']) * 100, 1)}%）"
            ),
        )
        return

    # ── 黑白上色（两条无模型路线：风格预设 / 参考图迁移）──────────────
    if tool_id == "colorize-photo":
        from app.tools import colorize_photo

        td = _tmp_dir()
        src = Path(input_path)
        out = Path(td) / f"{src.stem}_已上色.png"
        # AI 上色走另一条链路（需要按需下载的模型），其余两种走色彩迁移
        if str(payload.get("mode", "style")) == "ai":
            import os as _os4
            from app.tools import colorize_ai

            comp = _os4.environ.get("FURINAKIT_COMPONENTS_DIR") or _os4.path.join(
                _os4.getcwd(), "..", "..", "apps", "web", "components")
            mp = _os4.path.join(comp, "manga-colorize-fp16.onnx")
            if not _os4.path.isfile(mp):
                raise RuntimeError("还没下载「AI 上色」模型，请在工具页上方或设置里下载后重试（约 58.8MB）")
            result = colorize_ai.colorize_ai_file(input_path, str(out), mp)
            _finish_dict_result(
                job_id, use_file, result, default_mime="image/png",
                message=(
                    f"{result.get('detail')}：平均饱和度 "
                    f"{result.get('saturationBefore')} → {result.get('saturationAfter')}"
                ),
            )
            return

        result = colorize_photo.colorize(
            input_path,
            str(out),
            mode=str(payload.get("mode", "style")),
            style=str(payload.get("style", "portrait")),
            reference_path=(str(payload.get("reference_file")) if payload.get("reference_file") else None),
            strength=float(_payload_number(payload, "strength", 1.0)),
        )
        _finish_dict_result(
            job_id, use_file, result, default_mime="image/png",
            message=(
                f"{result.get('detail', '')}：平均饱和度 "
                f"{result.get('saturationBefore')} → {result.get('saturationAfter')}"
            ),
        )
        return

    # ── 老照片修复（不依赖新模型）────────────────────────────────────
    if tool_id == "photo-restore":
        from app.tools import photo_restore

        td = _tmp_dir()
        src = Path(input_path)
        out = Path(td) / f"{src.stem}_已修复.png"
        result = photo_restore.restore_old_photo(
            input_path,
            str(out),
            balance=float(_payload_number(payload, "balance", 0.8)),
            denoise_strength=int(_payload_number(payload, "denoise", 6)),
            contrast=float(_payload_number(payload, "contrast", 1.2)),
            sharpen=float(_payload_number(payload, "sharpen", 0.0)),
            keep_tone=str(payload.get("keep_tone", "no")) == "yes",
        )
        _finish_dict_result(
            job_id, use_file, result, default_mime="image/png",
            message=(
                "已修复：" + " → ".join(result.get("steps", [])) +
                f"（色偏 {result.get('colorCastBefore')} → {result.get('colorCastAfter')}，"
                f"层次 {result.get('contrastBefore')} → {result.get('contrastAfter')}）"
            ),
        )
        return

    # ── 图片换背景（复用 ISNet 抠图，不需要新模型）──────────────────
    if tool_id == "bg-replace":
        import os as _os
        import numpy as _np
        import cv2 as _cv2
        from app.tools import isnet_matting

        td = _tmp_dir()
        src = Path(input_path)

        components_dir = _os.environ.get("FURINAKIT_COMPONENTS_DIR") or ""
        candidates = [
            _os.path.join(components_dir, "isnet-general-use.onnx") if components_dir else "",
            _os.path.join(_os.getcwd(), "components", "isnet-general-use.onnx"),
            _os.path.join(_os.getcwd(), "..", "..", "apps", "web", "components", "isnet-general-use.onnx"),
        ]
        model_path = next((m for m in candidates if m and _os.path.isfile(m)), None)
        if not model_path:
            raise RuntimeError("还没下载「精细抠图」模型，请到设置里的「按需下载组件」下载后重试（约 170MB）")

        img = _cv2.imdecode(_np.fromfile(input_path, dtype=_np.uint8), _cv2.IMREAD_COLOR)
        if img is None:
            raise RuntimeError("无法读取图片")
        alpha = isnet_matting.isnet_alpha(img, model_path)

        mode = str(payload.get("mode", "color"))
        palette = {
            "white": (255, 255, 255), "blue": (219, 68, 55), "red": (36, 28, 237),
            "black": (0, 0, 0), "green": (80, 175, 76), "gray": (200, 200, 200),
        }
        bg_color = palette.get(str(payload.get("color", "white")), (255, 255, 255))
        blur = int(_payload_number(payload, "blur", 20)) if mode == "blur" else 0
        feather = int(_payload_number(payload, "feather", 0))

        bg_img = None
        bg_path = payload.get("bg_image")
        if mode == "image":
            if not bg_path or not _os.path.isfile(str(bg_path)):
                raise RuntimeError("选择了「使用背景图」但没有上传背景图")
            bg_img = _cv2.imdecode(_np.fromfile(str(bg_path), dtype=_np.uint8), _cv2.IMREAD_COLOR)
            if bg_img is None:
                raise RuntimeError("背景图无法读取")

        out_img = isnet_matting.compose_background(
            img, alpha,
            bg_image=bg_img,
            bg_color=None if mode in ("image", "blur") else bg_color,
            blur_original=blur,
            feather=feather,
        )
        out = Path(td) / f"{src.stem}_换背景.png"
        ok, buf = _cv2.imencode(".png", out_img)
        if not ok:
            raise RuntimeError("结果保存失败")
        buf.tofile(str(out))
        _finish_dict_result(
            job_id, use_file,
            {"success": True, "output": str(out), "mode": mode,
             "width": int(out_img.shape[1]), "height": int(out_img.shape[0])},
            default_mime="image/png",
            message={"image": "已换成上传的背景图", "blur": f"已虚化原背景（模糊 {blur}）"}.get(mode, "已换成纯色背景"),
        )
        return

    # ── 精细抠图（ISNet，按需下载的模型）────────────────────────────
    if tool_id == "precise-matting":
        import os as _os
        from app.tools import isnet_matting

        td = _tmp_dir()
        src = Path(input_path)

        # 模型位置：优先用环境变量给出的组件目录，其次退回仓库内的默认位置
        components_dir = _os.environ.get("FURINAKIT_COMPONENTS_DIR") or ""
        model_candidates = [
            _os.path.join(components_dir, "isnet-general-use.onnx") if components_dir else "",
            _os.path.join(_os.getcwd(), "components", "isnet-general-use.onnx"),
            _os.path.join(_os.getcwd(), "..", "..", "apps", "web", "components", "isnet-general-use.onnx"),
        ]
        model_path = next((m for m in model_candidates if m and _os.path.isfile(m)), None)
        if not model_path:
            raise RuntimeError(
                "还没下载「精细抠图」模型，请到设置里的「按需下载组件」下载后重试（约 170MB）"
            )

        import numpy as _np
        import cv2 as _cv2

        img = _cv2.imdecode(_np.fromfile(input_path, dtype=_np.uint8), _cv2.IMREAD_COLOR)
        if img is None:
            raise RuntimeError("无法读取图片")

        bg = str(payload.get("background", "transparent"))
        palette = {
            "white": (255, 255, 255),
            "blue": (219, 68, 55),   # BGR
            "red": (36, 28, 237),
            "black": (0, 0, 0),
            "green": (80, 175, 76),
        }
        feather = int(_payload_number(payload, "feather", 0))
        result_img = isnet_matting.remove_background(
            img, model_path, background=palette.get(bg), feather=feather
        )

        out = Path(td) / (f"{src.stem}_已抠图.png" if bg == "transparent" else f"{src.stem}_换底.png")
        ext = ".png"
        ok, buf = _cv2.imencode(ext, result_img)
        if not ok:
            raise RuntimeError("结果保存失败")
        buf.tofile(str(out))

        _finish_dict_result(
            job_id, use_file,
            {"success": True, "output": str(out), "background": bg,
             "width": int(result_img.shape[1]), "height": int(result_img.shape[0])},
            default_mime="image/png",
            message=("已抠出透明背景 PNG" if bg == "transparent" else f"已抠图并换成{bg}底"),
        )
        return

    # ── PDF 内容层编辑（文字替换 / 插入文字 / 插入图片）──────────────
    if tool_id == "pdf-content-edit":
        import json as _json
        from app.tools import pdf_content_edit

        td = _tmp_dir()
        src = Path(input_path)
        mode = str(payload.get("mode", "replace"))
        page = int(_payload_number(payload, "page", 1))

        if mode == "replace":
            old = str(payload.get("old_text", "")).strip()
            new = str(payload.get("new_text", ""))
            if not old:
                raise RuntimeError("请填写要替换掉的原文（需与 PDF 上完全一致）")
            ops = [{"type": "replace", "page": page, "old": old, "new": new,
                    "all": str(payload.get("replace_all", "no")) == "yes"}]
        elif mode == "text":
            text = str(payload.get("insert_text", ""))
            if not text:
                raise RuntimeError("请填写要插入的文字")
            ops = [{"type": "text", "page": page, "text": text,
                    "x": _payload_number(payload, "x", 72), "y": _payload_number(payload, "y", 72),
                    "size": _payload_number(payload, "size", 12)}]
        elif mode == "image":
            img = payload.get("insert_image")
            if not img:
                raise RuntimeError("请选择要插入的图片")
            ops = [{"type": "image", "page": page, "file": img,
                    "x": _payload_number(payload, "x", 72), "y": _payload_number(payload, "y", 72),
                    "width": _payload_number(payload, "width", 200)}]
        else:
            raise RuntimeError(f"不支持的操作「{mode}」")

        out = Path(td) / f"{src.stem}_已改内容.pdf"
        result = pdf_content_edit.pdf_content_edit(input_path, str(out), ops)
        _finish_dict_result(
            job_id, use_file, result, default_mime="application/pdf",
            message={
                "replace": f"已替换 {result['applied'][0].get('count', 1)} 处文字",
                "text": "已插入文字",
                "image": "已插入图片",
            }.get(mode, "已完成"),
        )
        return

    # ── PDF 编辑器（页面层操作）──────────────────────────────────────
    if tool_id == "pdf-editor":
        import json as _json
        from app.tools import pdf_edit

        td = _tmp_dir()
        src = Path(input_path)
        raw_ops = payload.get("ops")
        try:
            ops = _json.loads(raw_ops) if isinstance(raw_ops, str) else raw_ops
        except Exception:
            raise RuntimeError("操作清单格式不正确")
        if not isinstance(ops, list) or not ops:
            raise RuntimeError("没有任何编辑操作")

        # 追加另一份 PDF：把上传的第二个文件路径写进 append 操作里
        append_path = payload.get("append_file")
        if append_path:
            for op in ops:
                if isinstance(op, dict) and str(op.get("type")) == "append" and not op.get("file"):
                    op["file"] = append_path

        out = Path(td) / f"{src.stem}_已编辑.pdf"
        result = pdf_edit.pdf_edit(input_path, str(out), ops)
        _finish_dict_result(
            job_id, use_file, result, default_mime="application/pdf",
            message=f"执行 {len(ops)} 步操作，输出 {result.get('pages', 0)} 页",
        )
        return

    # ── 去水印（图像修补）────────────────────────────────────────────
    if tool_id == "watermark-remove":
        import json as _json
        from app.tools import image_inpaint

        td = _tmp_dir()
        src = Path(input_path)

        def _parse(raw, fallback):
            if not raw:
                return fallback
            try:
                v = _json.loads(raw) if isinstance(raw, str) else raw
                return v if isinstance(v, list) else fallback
            except Exception:
                return fallback

        rects = _parse(payload.get("regions"), [])
        strokes = _parse(payload.get("strokes"), [])
        out = Path(td) / f"{src.stem}_已去水印.png"
        result = image_inpaint.image_inpaint(
            input_path,
            str(out),
            rects=rects,
            strokes=strokes,
            brush=int(_payload_number(payload, "brush", 24)),
            method=str(payload.get("method", "telea")),
            radius=int(_payload_number(payload, "radius", 4)),
            auto_light=str(payload.get("auto_light", "yes")) == "yes",
            model_path=(str(payload.get("model_path")) if payload.get("model_path") else None),
        )
        _finish_dict_result(
            job_id, use_file, result, default_mime="image/png",
            message=f"已抹除 {result.get('paintedPixels', 0)} 个像素（占 {round(float(result.get('paintedRatio', 0)) * 100, 2)}%）",
        )
        return

    # ── OCR：图片取字 / 扫描件转可搜索 PDF ───────────────────────────
    if tool_id in ("ocr-image", "ocr-pdf"):
        from app.tools import ocr
        td = _tmp_dir()
        src = Path(input_path)
        # 识别严格度：严格 = 阈值更高，会把不确定的行也标出来
        strict = str(payload.get("strictness", "standard")) == "strict"
        low_conf = 0.65 if strict else 0.5

        if tool_id == "ocr-image":
            fmt = str(payload.get("format", "txt"))
            ext = {"txt": "txt", "md": "md", "json": "json"}.get(fmt, "txt")
            out = Path(td) / f"{src.stem}_文字.{ext}"
            result = ocr.image_ocr(input_path, str(out), fmt, low_conf)
            mime = "application/json" if fmt == "json" else "text/plain"
            _finish_dict_result(
                job_id, use_file, result, default_mime=mime,
                message=f"识别出 {result.get('lines', 0)} 行 · 平均置信度 {result.get('averageScore', 0)}",
            )
            return

        # 扫描件：叠一层不可见文字，输出可搜索 PDF（可选同时给纯文本）
        out = Path(td) / f"{src.stem}_可搜索.pdf"
        txt = Path(td) / f"{src.stem}_文字.txt" if str(payload.get("export_text", "yes")) == "yes" else None
        result = ocr.pdf_ocr(
            input_path, str(out),
            dpi=int(_payload_number(payload, "dpi", 200)),
            text_path=str(txt) if txt else None,
            low_confidence=low_conf,
        )
        _finish_dict_result(
            job_id, use_file, result, default_mime="application/pdf",
            message=f"已为 {result.get('pages', 0)} 页叠加文字层 · {result.get('lines', 0)} 行 · 平均置信度 {result.get('averageScore', 0)}",
        )
        return

    # ── 演示文稿（PPTX）三件套 + 应用图标生成 ────────────────────────
    if tool_id in ("ppt-extract-media", "ppt-extract-text", "ppt-compress", "ppt-to-images", "app-icon-generator"):
        td = _tmp_dir()
        src = Path(input_path)

        if tool_id == "ppt-extract-media":
            from app.tools import ppt_tools
            out = Path(td) / f"{src.stem}_素材.zip"
            result = ppt_tools.ppt_extract_media(input_path, str(out))
            _finish_dict_result(job_id, use_file, result, default_mime="application/zip", message="素材提取完成")
            return

        if tool_id == "ppt-extract-text":
            from app.tools import ppt_tools
            fmt = str(payload.get("format", "md"))
            ext = {"md": "md", "txt": "txt", "json": "json"}.get(fmt, "md")
            out = Path(td) / f"{src.stem}_文稿.{ext}"
            result = ppt_tools.ppt_extract_text(
                input_path, str(out),
                fmt=fmt,
                include_notes=_payload_bool(payload, "include_notes", True),
                include_tables=_payload_bool(payload, "include_tables", True),
            )
            mime = "application/json" if fmt == "json" else "text/markdown" if fmt == "md" else "text/plain"
            _finish_dict_result(job_id, use_file, result, default_mime=f"{mime}; charset=utf-8", message="文稿提取完成")
            return

        if tool_id == "ppt-compress":
            from app.tools import ppt_tools
            out = Path(td) / f"{src.stem}_已瘦身.pptx"
            result = ppt_tools.ppt_compress(
                input_path, str(out),
                quality=int(_payload_number(payload, "quality", 75)),
                max_width=int(_payload_number(payload, "max_width", 1920)),
            )
            _finish_dict_result(
                job_id, use_file, result,
                default_mime="application/vnd.openxmlformats-officedocument.presentationml.presentation",
                message=f"瘦身完成，节省 {result.get('savedPercent', 0)}%",
            )
            return

        if tool_id == "ppt-to-images":
            from app.tools import ppt_render
            out_dir = Path(td) / "slides"
            result = ppt_render.ppt_to_images(
                input_path, str(out_dir),
                width=int(_payload_number(payload, "width", 1920)),
                height=int(_payload_number(payload, "height", 1080)),
                fmt=str(payload.get("format", "png")),
            )
            mime = "image/png" if result.get("count") == 1 and str(result.get("output", "")).endswith(".png") else "application/zip"
            if str(result.get("output", "")).endswith(".jpg"):
                mime = "image/jpeg"
            _finish_dict_result(
                job_id, use_file, result, default_mime=mime,
                message=f"已导出 {result.get('count', 0)} 页（{result.get('engine', '')}）",
            )
            return

        if tool_id == "app-icon-generator":
            from app.tools import icon_gen
            out = Path(td) / f"{src.stem}_图标.zip"
            sizes_raw = str(payload.get("sizes", "") or "").strip()
            sizes = [int(x) for x in sizes_raw.replace("，", ",").split(",") if x.strip().isdigit()] if sizes_raw else None
            result = icon_gen.generate_icons(
                input_path, str(out),
                sizes=sizes,
                rounded=_payload_number(payload, "rounded", 0),
                background=str(payload.get("background", "")),
            )
            _finish_dict_result(job_id, use_file, result, default_mime="application/zip", message="图标生成完成")
            return

    # ── PDF 分割 / 提取图片 / PDF转图片（多文件 → zip）────────────────
    if tool_id in ("pdf-split", "pdf-extract-images", "pdf-to-images"):
        from app.tools import pdf_tools as pt
        from app.tools import pdf_convert as pc
        td = _tmp_dir()
        out_dir = Path(td) / "result"
        out_dir.mkdir(exist_ok=True)
        src = Path(input_path)

        if tool_id == "pdf-split":
            result = pt.pdf_split(input_path, str(payload.get("ranges", "")), str(out_dir))
            zip_n = "split_pdf.zip"
        elif tool_id == "pdf-extract-images":
            result = pt.pdf_extract_images(input_path, str(out_dir))
            zip_n = "extracted_images.zip"
        elif tool_id == "pdf-to-images":
            fmt = str(payload.get("format", "png"))
            result = pc.pdf_to_images(input_path, str(out_dir), fmt, int(payload.get("dpi", 150)))
            zip_n = "pdf_images.zip"

        if not result.get("success"):
            raise RuntimeError(result.get("error", "处理失败"))
        zip_name = _store_dir_as_zip(job_id, str(out_dir), zip_n)
        _set_status(job_id, use_file, status="completed", progress=100,
                    message="处理完成", resultFilename=zip_name, resultMimeType="application/zip")
        return

    # ── PDF 转 Office / Office 转 PDF（返回 Dict）─────────────────────
    if tool_id in ("pdf-to-word", "pdf-to-excel", "pdf-to-ppt",
                    "word-to-pdf", "excel-to-pdf", "ppt-to-pdf"):
        td = _tmp_dir()
        src = Path(input_path)

        if tool_id == "pdf-to-word":
            from app.tools.pdf_convert import pdf_to_word
            out = Path(td) / f"{src.stem}.docx"
            result = pdf_to_word(input_path, str(out))
        elif tool_id == "pdf-to-excel":
            from app.tools.pdf_convert import pdf_to_excel
            out = Path(td) / f"{src.stem}.xlsx"
            result = pdf_to_excel(input_path, str(out))
        elif tool_id == "pdf-to-ppt":
            from app.tools.pdf_convert import pdf_to_ppt
            out = Path(td) / f"{src.stem}.pptx"
            result = pdf_to_ppt(input_path, str(out), int(payload.get("dpi", 150)))
        elif tool_id == "word-to-pdf":
            from app.tools.office_to_pdf import word_to_pdf
            out = Path(td) / f"{src.stem}.pdf"
            result = word_to_pdf(input_path, str(out))
        elif tool_id == "excel-to-pdf":
            from app.tools.office_to_pdf import excel_to_pdf
            out = Path(td) / f"{src.stem}.pdf"
            result = excel_to_pdf(input_path, str(out))
        elif tool_id == "ppt-to-pdf":
            from app.tools.office_to_pdf import ppt_to_pdf
            out = Path(td) / f"{src.stem}.pdf"
            result = ppt_to_pdf(input_path, str(out))
        _finish_dict_result(job_id, use_file, result, message="转换完成")
        return

    # ── 视频格式转换批量处理 ─────────────────────────────────────────
    if tool_id == "video-format-convert" and len(files) > 1:
        from app.tools import video_tools
        import zipfile
        td = _tmp_dir()
        output_files = []
        total = len(files)
        fmt = str(payload.get("format", "mp4"))
        quality = str(payload.get("quality", "high"))
            
        for idx, fpath in enumerate(files):
            _set_status(job_id, use_file, progress=int(20 + (idx/total)*60), message=f"处理中 {idx+1}/{total}")
            try:
                src = Path(fpath)
                out_path, out_name, out_mime = video_tools.convert_video(str(src), fmt, quality, lambda msg: None)
                output_files.append((out_path, out_name))
            except Exception as e:
                _set_status(job_id, use_file, progress=90, message=f"第 {idx+1} 个文件处理失败: {e}")
            
        if output_files:
            zip_path = Path(td) / "batch_result.zip"
            with zipfile.ZipFile(str(zip_path), "w", zipfile.ZIP_DEFLATED) as zf:
                for out_path, out_name in output_files:
                    zf.write(str(out_path), out_name)
            _finish_file(job_id, use_file, str(zip_path), "batch_result.zip", "application/zip", f"批量处理完成，共 {len(output_files)} 个文件")
        else:
            _set_status(job_id, use_file, status="failed", message="所有文件处理失败")
        return

    # ── 视频处理（video_tools.py，返回 Tuple）─────────────────────────
    if tool_id in ("video-format-convert", "video-compress", "video-to-gif"):
        from app.tools import video_tools
        _set_status(job_id, use_file, progress=20, message="处理中...")

        def _vprogress(msg):
            _set_status(job_id, use_file, progress=50, message=msg)

        if tool_id == "video-format-convert":
            fmt = str(payload.get("format", "mp4"))
            quality = str(payload.get("quality", "high"))
            output_path, filename, mime = video_tools.convert_video(input_path, fmt, quality, _vprogress)
        elif tool_id == "video-compress":
            quality = str(payload.get("quality", "medium"))
            tsize = payload.get("target_size_mb")
            output_path, filename, mime = video_tools.compress_video(
                input_path, quality, float(tsize) if tsize else None, _vprogress)
        elif tool_id == "video-to-gif":
            output_path, filename, mime = video_tools.video_to_gif(
                input_path,
                float(payload.get("start_time", 0)),
                float(payload.get("duration", 5)),
                int(payload.get("width", 480)),
                int(payload.get("fps", 15)),
                _vprogress,
            )
        _finish_file(job_id, use_file, output_path, filename, mime, "视频处理完成")
        return

    # ── 音频格式转换批量处理 ─────────────────────────────────────────
    if tool_id == "audio-format-convert" and len(files) > 1:
        from app.tools import audio_tools
        import zipfile
        td = _tmp_dir()
        output_files = []
        total = len(files)
        fmt = str(payload.get("format", "mp3")).lower()
        bitrate = str(payload.get("bitrate", "192k"))
            
        for idx, fpath in enumerate(files):
            _set_status(job_id, use_file, progress=int(20 + (idx/total)*60), message=f"处理中 {idx+1}/{total}")
            try:
                src = Path(fpath)
                out = Path(td) / f"{src.stem}.{fmt}"
                result = audio_tools.audio_format_convert(str(src), str(out), fmt, bitrate)
                if result.get("success"):
                    output_files.append((str(out), f"{src.stem}.{fmt}"))
            except Exception as e:
                _set_status(job_id, use_file, progress=90, message=f"第 {idx+1} 个文件处理失败: {e}")
            
        if output_files:
            zip_path = Path(td) / "batch_result.zip"
            with zipfile.ZipFile(str(zip_path), "w", zipfile.ZIP_DEFLATED) as zf:
                for out_path, out_name in output_files:
                    zf.write(str(out_path), out_name)
            _finish_file(job_id, use_file, str(zip_path), "batch_result.zip", "application/zip", f"批量处理完成，共 {len(output_files)} 个文件")
        else:
            _set_status(job_id, use_file, status="failed", message="所有文件处理失败")
        return

    # ── 音频格式转换 / 视频转音频（返回 Dict）─────────────────────────
    if tool_id in ("audio-format-convert", "video-to-audio"):
        from app.tools import audio_tools
        td = _tmp_dir()
        src = Path(input_path)
        fmt = str(payload.get("format", "mp3")).lower()
        bitrate = str(payload.get("bitrate", "192k"))
        out = Path(td) / f"{src.stem}.{fmt}"

        def _aprogress(msg):
            _set_status(job_id, use_file, progress=50, message=msg)

        if tool_id == "audio-format-convert":
            result = audio_tools.audio_format_convert(input_path, str(out), fmt, bitrate)
        else:
            result = audio_tools.extract_audio_from_video(input_path, str(out), fmt, bitrate, _aprogress)
        _finish_dict_result(job_id, use_file, result, message="音频处理完成")
        return

    # ── 音频倒放 / 音量调节 / 音频合并（返回 Dict）────────────────────
    if tool_id in ("audio-reverse", "audio-volume", "audio-merge"):
        from app.tools import audio_tools
        td = _tmp_dir()
        src = Path(input_path)
            
        if tool_id == "audio-reverse":
            out = Path(td) / f"{src.stem}_reversed.mp3"
            result = audio_tools.audio_reverse(input_path, str(out))
        elif tool_id == "audio-volume":
            volume = float(payload.get("volume", 1.0))
            out = Path(td) / f"{src.stem}_volume.mp3"
            result = audio_tools.audio_volume(input_path, str(out), volume)
        elif tool_id == "audio-merge":
            # 多文件合并
            if len(files) > 1:
                out = Path(td) / "merged_audio.mp3"
                result = audio_tools.audio_merge(files, str(out))
            else:
                result = {"success": False, "error": "请选择至少两个音频文件进行合并"}
        _finish_dict_result(job_id, use_file, result, message="音频处理完成")
        return

    # ── 视频裁剪 / 音频裁剪（新增，返回 Dict）─────────────────────────
    if tool_id in ("video-trim", "audio-trim"):
        from app.tools import audio_trim, video_trim
        if not input_path:
            raise RuntimeError("请先选择要裁剪的文件")
        td = _tmp_dir()
        src = Path(input_path)
        mode = payload.get("mode", "fast")
        start = payload.get("start")
        end = payload.get("end")
        _set_status(job_id, use_file, progress=25, message="正在准备裁剪...")

        def _trim_progress(msg):
            _set_status(job_id, use_file, progress=65, message=msg)

        if tool_id == "video-trim":
            # 契约输出名：<原名去扩展>-trimmed.<容器>；容器默认跟随源文件（container=same），
            # 不支持/缺省时退回 .mp4
            suffix = video_trim.resolve_output_suffix(input_path, payload.get("container"))
            out = Path(td) / f"{src.stem}-trimmed{suffix}"
            result = video_trim.trim_video(input_path, str(out), start=start, end=end,
                                           mode=mode, container=payload.get("container"),
                                           on_progress=_trim_progress)
        else:
            # 契约输出名：<原名去扩展>-trimmed.<原扩展名>
            ext = src.suffix.lower() or ".mp3"
            out = Path(td) / f"{src.stem}-trimmed{ext}"
            result = audio_trim.trim_audio(input_path, str(out), start=start, end=end,
                                           mode=mode, on_progress=_trim_progress)

        if not result.get("success"):
            raise RuntimeError(result.get("error", "裁剪失败"))
        output = result.get("output") or str(out)
        _finish_file(job_id, use_file, output, result.get("filename") or Path(output).name,
                     result.get("mime") or "application/octet-stream",
                     result.get("message") or "裁剪完成")
        return

    # ── 视频抽帧缩略图（新增，本地视频文件取一帧）──────────────────────
    # 注意：这是「本地视频抽帧」，与下面既有的 video-thumbnail（在线视频封面下载）是两件事，
    # 因此使用独立 tool id，既有分支保持原样。
    if tool_id == "video-frame-extract":
        from app.tools import video_trim
        if not input_path:
            raise RuntimeError("请先选择要抽帧的视频文件")
        td = _tmp_dir()
        src = Path(input_path)
        fmt = str(payload.get("format", "png") or "png").strip().lower()
        ext = "jpg" if fmt in ("jpg", "jpeg", "jpe") else ("png" if fmt == "png" else fmt)
        # 契约输出名：<原名去扩展>-frame.png|jpg
        out = Path(td) / f"{src.stem}-frame.{ext}"
        _set_status(job_id, use_file, progress=35, message="正在抽取画面...")
        result = video_trim.extract_thumbnail(input_path, str(out), time=payload.get("time"),
                                              fmt=fmt, width=payload.get("width"))
        if not result.get("success"):
            raise RuntimeError(result.get("error", "抽取缩略图失败"))
        output = result.get("output") or str(out)
        _finish_file(job_id, use_file, output, result.get("filename") or Path(output).name,
                     result.get("mime") or "image/png",
                     result.get("message") or "缩略图已生成")
        return

    # ── CSV ↔ Excel 互转（新增，真 xlsx）─────────────────────────────
    if tool_id == "csv-excel":
        from app.tools import csv_excel
        if not input_path:
            raise RuntimeError("请先选择要转换的文件")
        td = _tmp_dir()
        _set_status(job_id, use_file, progress=35, message="正在转换表格...")
        result = csv_excel.convert_file(
            input_path, td,
            direction=payload.get("direction", "auto"),
            sheet=payload.get("sheet"),
            delimiter=payload.get("delimiter"),
            has_header=payload.get("has_header"),
        )
        if not result.get("success"):
            raise RuntimeError(result.get("error", "转换失败"))
        output = result.get("output") or ""
        if not output:
            raise RuntimeError("转换失败：没有生成输出文件")
        _finish_file(job_id, use_file, output, result.get("filename") or Path(output).name,
                     result.get("mime") or "application/octet-stream",
                     result.get("message") or "转换完成")
        return

    # ── Markdown 转 PDF（新增，中文用 PyMuPDF 内置字体渲染）────────────
    if tool_id == "markdown-to-pdf":
        from app.tools import markdown_pdf
        td = _tmp_dir()
        _set_status(job_id, use_file, progress=35, message="正在排版 PDF...")
        result = markdown_pdf.markdown_to_pdf(
            text=payload.get("text"),
            source_file=input_path or None,
            output_dir=td,
            page_size=payload.get("page_size", "a4"),
            font_size=payload.get("font_size", 12),
        )
        if not result.get("success"):
            raise RuntimeError(result.get("error", "生成 PDF 失败"))
        output = result.get("output") or ""
        if not output:
            raise RuntimeError("生成 PDF 失败：没有生成输出文件")
        _finish_file(job_id, use_file, output, result.get("filename") or Path(output).name,
                     result.get("mime") or "application/pdf",
                     result.get("message") or "转换完成")
        return

    # ── 视频/音频链接下载（video.py，含 B站抖音）──────────────────────
    if tool_id in ("video-download", "twitter-download", "bilibili-download"):
        url = str(payload.get("url", ""))
        format_type = str(payload.get("format", "mp4"))
        quality = str(payload.get("quality", "best"))
        # 编码偏好：h264（默认，哪都能播）/ av1（体积小但老播放器不兼容）
        codec = str(payload.get("codec", "h264")).lower()

        # 封面下载
        if format_type == "thumbnail":
            from app.tools.video import download_thumbnail
            _set_status(job_id, use_file, progress=20, message="获取视频信息...")
            _set_status(job_id, use_file, progress=40, message="提取封面中...")

            def _tprogress(pct, message):
                _set_status(job_id, use_file, progress=min(95, max(40, pct)), message=message)

            output_path, filename, mime = download_thumbnail(url, on_progress=_tprogress)
            _finish_file(job_id, use_file, output_path, filename, mime, "封面提取完成")
            return

        # 视频/音频下载
        from app.tools.video import download_video
        _set_status(job_id, use_file, progress=20, message="获取媒体信息...")
        _set_status(job_id, use_file, progress=40, message="下载中...")

        def _dprogress(pct, message):
            _set_status(job_id, use_file, progress=min(95, max(40, pct)), message=message)

        output_path, filename, mime = download_video(url, format_type, quality, codec=codec, on_progress=_dprogress)
        _finish_file(job_id, use_file, output_path, filename, mime, "下载完成")
        return

    # ── 视频封面提取 ──────────────────────────────────────────────────
    if tool_id in ("video-thumbnail", "bilibili-thumbnail", "douyin-thumbnail"):
        from app.tools.video import download_thumbnail
        _set_status(job_id, use_file, progress=20, message="获取视频信息...")
        url = str(payload.get("url", ""))
        _set_status(job_id, use_file, progress=40, message="提取封面中...")

        def _tprogress(pct, message):
            _set_status(job_id, use_file, progress=min(95, max(40, pct)), message=message)

        output_path, filename, mime = download_thumbnail(url, on_progress=_tprogress)
        _finish_file(job_id, use_file, output_path, filename, mime, "封面提取完成")
        return

    # ── Spotify 下载 ──────────────────────────────────────────────────
    if tool_id == "spotify-download":
        from app.tools.spotify import download_spotify
        td = _tmp_dir()
        _set_status(job_id, use_file, progress=20, message="解析 Spotify 链接...")
        url = str(payload.get("url", ""))
        format_type = str(payload.get("format", "mp3"))
        _set_status(job_id, use_file, progress=40, message="下载音频...")
        output_path, filename, mime = download_spotify(url, format_type, output_dir=td)
        _finish_file(job_id, use_file, output_path, filename, mime, "Spotify 下载完成")
        return

    # ── MP3 标签编辑器 ────────────────────────────────────────────────
    # 写成"改好标签的副本"交回前端，原文件一个字节都不动（mutagen 是就地写回的）。
    if tool_id == "audio-tags":
        from app.tools import audio_tags

        fields = ["title", "artist", "album", "albumartist", "date", "genre", "track", "disc", "composer", "comment", "lyrics"]
        changes = {f: str(payload.get(f, "") or "") for f in fields if f in payload}
        if not changes and not payload.get("remove_cover") and not payload.get("cover_file"):
            raise ValueError("没有要修改的内容：请至少填写一个标签字段，或选择更换/移除封面")

        _set_status(job_id, use_file, progress=30, message="正在写入标签…")
        src = Path(input_path)
        out = src.with_name(f"{src.stem}_已改标签{src.suffix}")
        res = audio_tags.write_tags(
            input_path,
            changes,
            str(payload.get("cover_file") or "") or None,
            bool(payload.get("remove_cover")),
            str(out),
        )
        _finish_file(job_id, use_file, res["output"], out.name, "application/octet-stream", "标签已写入")
        return

    # ── 证件照制作 ────────────────────────────────────────────────────
    if tool_id == "id-photo":
        from app.tools import id_photo as idp

        _set_status(job_id, use_file, progress=25, message="正在抠人像并换底色…")
        src = Path(input_path)
        out = src.with_name(f"{src.stem}_证件照.jpg")
        res = idp.make_id_photo(input_path, payload, str(out))
        _set_status(job_id, use_file, progress=90, message="正在按规格输出…")
        _finish_file(
            job_id, use_file, res["output"], out.name, "image/jpeg",
            f"{res['specLabel']} · {res['bgLabel']} · {res['width']}×{res['height']} 像素",
        )
        return

    # ── PDF 转 Markdown / HTML ────────────────────────────────────────
    if tool_id in ("pdf-to-markdown", "pdf-to-html"):
        from app.tools import pdf_to_text

        _set_status(job_id, use_file, progress=30, message="正在解析 PDF 版面…")
        src = Path(input_path)
        if tool_id == "pdf-to-markdown":
            res = pdf_to_text.pdf_to_markdown(input_path, payload)
            out = src.with_name(f"{src.stem}.md")
            out.write_text(res["markdown"], encoding="utf-8")
            mime = "text/markdown; charset=utf-8"
            msg = f"已转换 {res['stats']['pages']} 页（标题 {res['stats']['headings']}、表格 {res['stats']['tables']}、图片 {res['stats']['images']}）"
        else:
            res = pdf_to_text.pdf_to_html(input_path, payload)
            out = src.with_name(f"{src.stem}.html")
            out.write_text(res["html"], encoding="utf-8")
            mime = "text/html; charset=utf-8"
            msg = f"已转换 {res['stats']['pages']} 页（标题 {res['stats']['headings']}、表格 {res['stats']['tables']}、图片 {res['stats']['images']}）"
        _set_status(job_id, use_file, progress=90, message="正在生成文件…")
        _finish_file(job_id, use_file, str(out), out.name, mime, msg)
        return

    # ── 视频去水印 ────────────────────────────────────────────────────
    if tool_id == "video-watermark-remove":
        from app.tools import video_watermark as vw

        _set_status(job_id, use_file, progress=15, message="正在读取视频信息…")
        src = Path(input_path)
        out = src.with_name(f"{src.stem}_去水印{src.suffix}")
        _set_status(job_id, use_file, progress=35, message="正在处理水印区域（视频越长时间越久）…")
        res = vw.remove_watermark(input_path, payload, str(out))
        mode_label = {"delogo": "delogo 插值覆盖", "blur": "区域模糊", "crop": "裁掉边缘"}.get(res["mode"], res["mode"])
        _finish_file(
            job_id, use_file, res["output"], out.name, "video/mp4",
            f"完成（{mode_label}）· {res['before'][0]}×{res['before'][1]} → {res['after'][0]}×{res['after'][1]}",
        )
        return

    # ── 文字转语音 ────────────────────────────────────────────────────
    if tool_id == "text-to-speech":
        from app.tools import tts

        engine = str(payload.get("engine", "sapi"))
        voice = str(payload.get("voice", "") or "")
        rate = int(float(payload.get("rate", 0) or 0))
        pitch = int(float(payload.get("pitch", 0) or 0))
        volume = int(float(payload.get("volume", 0) or 0))
        text = str(payload.get("text", "") or "")
        _set_status(job_id, use_file, progress=30, message="正在合成语音…")

        # Always stage inside the managed job temp area, never beside an input file.
        out = Path(_tmp_dir()) / "语音.mp3"
        res = tts.synthesize(text, engine, voice, rate, pitch, volume, str(out))
        actual = Path(res["output"])
        _finish_file(job_id, use_file, str(actual), "语音" + actual.suffix,
                     res["mime"], "合成完成，可先试听再保存 / Speech ready; preview before saving")
        return

    raise ValueError(f"Unsupported tool: {tool_id}")
