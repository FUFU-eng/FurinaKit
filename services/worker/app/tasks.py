import re
import shutil
import tempfile
import zipfile
from pathlib import Path

from app.file_job_store import update_job as update_file_job
from app.job_store import update_job as update_redis_job
from app.storage_paths import results_dir

_SAFE_FILENAME_RE = re.compile(r"[^a-zA-Z0-9._-]+")

# Tool handlers are imported lazily inside process_job() so that a heavy/broken dependency
# in one tool can't prevent the worker from starting or block unrelated tools.


def _safe_filename(filename: str) -> str:
    """Keep result filenames inside the output directory (no path separators)."""
    safe = _SAFE_FILENAME_RE.sub("_", str(filename)).strip("._")
    return safe or "result.bin"


def _store_result(job_id: str, source_path: str, filename: str) -> str:
    safe_name = _safe_filename(filename)
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
    if use_file:
        return update_file_job(job_id, **updates)
    return update_redis_job(job_id, **updates)


def _tmp_dir() -> str:
    return tempfile.mkdtemp(prefix="furinakit_")


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
        ".mp3": "audio/mpeg", ".wav": "audio/wav", ".flac": "audio/flac",
        ".aac": "audio/aac", ".m4a": "audio/mp4", ".ogg": "audio/ogg",
        ".opus": "audio/opus", ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ".zip": "application/zip",
        ".ico": "image/x-icon",
    }
    mime = mime_map.get(p.suffix.lower(), default_mime)
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


def process_job(job_id: str, tool_id: str, payload: dict, use_file: bool = False) -> None:
    _set_status(job_id, use_file, status="processing", progress=10, message="Starting...")

    try:
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
            from app.tools.bg_remove import remove_background
            _set_status(job_id, use_file, progress=30, message="Removing background...")
            model = str(payload.get("model", "u2net"))
            bg_color = str(payload.get("bg_color", "")) or None
            output_path, filename = remove_background(input_path, model, bg_color)
            mime_map = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp"}
            ext = Path(filename).suffix.lower()
            _finish_file(job_id, use_file, output_path, filename, mime_map.get(ext, "image/png"), "抠图完成")
            return

        # ── 图片放大 ──────────────────────────────────────────────────────
        if tool_id == "image-upscale":
            from app.tools.image_upscale import upscale_image
            _set_status(job_id, use_file, progress=20, message="AI 放大中...")
            model = str(payload.get("model", "anime-x2"))
            scale = int(payload.get("scale", 2))
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
                        output_files.append(str(out))
                
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
                        "pdf-page-numbers", "images-to-pdf", "image-to-pdf"):
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
                result = pdf_tools.pdf_add_watermark(
                    input_path, str(out), text=str(payload.get("text", "CONFIDENTIAL")),
                )
            elif tool_id == "pdf-page-numbers":
                out = Path(td) / f"{src.stem}_numbered.pdf"
                result = pdf_tools.pdf_add_page_numbers(
                    input_path, str(out), position=str(payload.get("position", "bottom-center")),
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

        # ── 视频/音频链接下载（video.py，含 B站抖音）──────────────────────
        if tool_id in ("video-download", "twitter-download", "bilibili-download"):
            url = str(payload.get("url", ""))
            format_type = str(payload.get("format", "mp4"))
            quality = str(payload.get("quality", "best"))

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

            output_path, filename, mime = download_video(url, format_type, quality, on_progress=_dprogress)
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

        raise ValueError(f"Unsupported tool: {tool_id}")
    except Exception as exc:  # noqa: BLE001
        _set_status(
            job_id, use_file, status="failed", progress=100,
            message="处理失败", error=str(exc),
        )
