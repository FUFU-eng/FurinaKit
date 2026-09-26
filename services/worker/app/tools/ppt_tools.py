"""PPT 演示文稿处理：素材提取、文稿提取、体积压缩。

PPTX 本质是一个 zip 包（内含 XML 与媒体文件），所以：
  · 素材提取 / 压缩直接操作 zip 里的 ppt/media/*，不经过任何渲染，速度快且无损；
  · 文稿提取用 python-pptx 解析形状树，能拿到标题、正文、表格与备注。
不依赖 Office 或 LibreOffice，纯本地完成。
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional

from PIL import Image

MEDIA_EXT_KIND = {
    ".png": "图片", ".jpg": "图片", ".jpeg": "图片", ".gif": "图片", ".bmp": "图片",
    ".tif": "图片", ".tiff": "图片", ".webp": "图片", ".emf": "矢量图", ".wmf": "矢量图",
    ".svg": "矢量图",
    ".mp3": "音频", ".wav": "音频", ".m4a": "音频", ".aac": "音频", ".wma": "音频",
    ".mp4": "视频", ".mov": "视频", ".avi": "视频", ".wmv": "视频", ".mkv": "视频",
    ".webm": "视频",
}


def _safe_name(name: str) -> str:
    return re.sub(r'[\\/:*?"<>|]+', "_", name).strip() or "未命名"


def _human(size: int) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if size < 1024 or unit == "GB":
            return f"{size:.1f} {unit}" if unit != "B" else f"{size} B"
        size /= 1024
    return f"{size:.1f} GB"


# ────────────────────────────── 素材提取 ──────────────────────────────

def ppt_extract_media(file_path: str, output_path: str) -> Dict[str, Any]:
    """把 PPT 里的图片、音频、视频素材全部导出，自动去重并打包成 zip。

    去重是关键：同一张 logo 在几十页里会被引用多次，PPT 内部存了多份，
    直接导出会得到一堆重复文件。这里按内容哈希去重。
    """
    src = Path(file_path)
    if src.suffix.lower() not in (".pptx", ".pptm", ".ppsx"):
        raise RuntimeError("只支持 .pptx / .pptm 格式（.ppt 旧格式请先另存为 pptx）")

    results: List[Dict[str, Any]] = []
    seen: Dict[str, str] = {}
    duplicates = 0

    with zipfile.ZipFile(src) as zf:
        media = [n for n in zf.namelist() if n.startswith("ppt/media/") and not n.endswith("/")]
        for name in sorted(media):
            data = zf.read(name)
            digest = hashlib.sha1(data).hexdigest()
            ext = Path(name).suffix.lower()
            kind = MEDIA_EXT_KIND.get(ext, "其他")

            if digest in seen:
                duplicates += 1
                continue
            seen[digest] = name

            results.append({
                "name": Path(name).name,
                "kind": kind,
                "size": len(data),
                "data": data,
                "digest": digest,
            })

    if not results:
        raise RuntimeError("这个演示文稿里没有可提取的素材（图片、音频或视频）")

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    # 按类别分目录打包，并在文件名前加序号，方便对着页序查找
    counters: Dict[str, int] = {}
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for item in results:
            kind = item["kind"]
            counters[kind] = counters.get(kind, 0) + 1
            target = f"{kind}/{counters[kind]:03d}_{_safe_name(item['name'])}"
            zf.writestr(target, item["data"])
        # 附一份清单，说明每个素材的来源与体积
        manifest = {
            "源文件": src.name,
            "素材总数": len(results),
            "去重丢弃的重复素材": duplicates,
            "按类别统计": {k: v for k, v in counters.items()},
            "明细": [
                {"文件名": it["name"], "类别": it["kind"], "体积": _human(it["size"])}
                for it in results
            ],
        }
        zf.writestr("素材清单.json", json.dumps(manifest, ensure_ascii=False, indent=2))

    total = sum(it["size"] for it in results)
    return {
        "success": True,
        "output": str(out),
        "count": len(results),
        "duplicates": duplicates,
        "totalSize": total,
        "byKind": counters,
    }


# ────────────────────────────── 文稿提取 ──────────────────────────────

def ppt_extract_text(
    file_path: str,
    output_path: str,
    fmt: str = "md",
    include_notes: bool = True,
    include_tables: bool = True,
) -> Dict[str, Any]:
    """提取每页的标题、正文与备注，可输出 Markdown / 纯文本 / JSON。"""
    from pptx import Presentation  # 延迟导入：没装 python-pptx 时其它工具不受影响

    src = Path(file_path)
    prs = Presentation(str(src))

    slides: List[Dict[str, Any]] = []
    char_count = 0

    for index, slide in enumerate(prs.slides, start=1):
        title = ""
        body: List[str] = []
        tables: List[List[List[str]]] = []

        for shape in slide.shapes:
            # 标题
            try:
                if shape.has_text_frame and shape == slide.shapes.title:
                    title = shape.text_frame.text.strip()
                    continue
            except (AttributeError, ValueError):
                pass

            if shape.has_text_frame:
                text = shape.text_frame.text.strip()
                if text:
                    body.append(text)

            if include_tables and getattr(shape, "has_table", False) and shape.has_table:
                rows: List[List[str]] = []
                for row in shape.table.rows:
                    rows.append([cell.text.strip() for cell in row.cells])
                tables.append(rows)

        notes = ""
        if include_notes:
            try:
                if slide.has_notes_slide:
                    notes = slide.notes_slide.notes_text_frame.text.strip()
            except (AttributeError, ValueError):
                notes = ""

        char_count += len(title) + sum(len(b) for b in body) + len(notes) + sum(
            len(c) for t in tables for r in t for c in r
        )
        slides.append({"page": index, "title": title, "body": body, "tables": tables, "notes": notes})

    if not any(s["title"] or s["body"] or s["notes"] or s["tables"] for s in slides):
        raise RuntimeError("没有从这份演示文稿里提取到文字内容")

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    if fmt == "json":
        out.write_text(json.dumps({"file": src.name, "slides": slides}, ensure_ascii=False, indent=2), encoding="utf-8")
    elif fmt == "txt":
        lines: List[str] = []
        for s in slides:
            lines.append(f"=== 第 {s['page']} 页 ===")
            if s["title"]:
                lines.append(s["title"])
            lines.extend(s["body"])
            for t in s["tables"]:
                for r in t:
                    lines.append(" | ".join(r))
            if s["notes"]:
                lines.append(f"[备注] {s['notes']}")
            lines.append("")
        out.write_text("\n".join(lines), encoding="utf-8")
    else:  # markdown
        lines = [f"# {src.stem}", ""]
        for s in slides:
            heading = s["title"] or f"第 {s['page']} 页"
            lines.append(f"## {s['page']}. {heading}")
            lines.append("")
            for para in s["body"]:
                for sub in para.split("\n"):
                    if sub.strip():
                        lines.append(sub.strip())
                        lines.append("")
            for t in s["tables"]:
                if not t:
                    continue
                lines.append("| " + " | ".join(t[0]) + " |")
                lines.append("| " + " | ".join(["---"] * len(t[0])) + " |")
                for r in t[1:]:
                    lines.append("| " + " | ".join(r) + " |")
                lines.append("")
            if s["notes"]:
                lines.append(f"> 备注：{s['notes']}")
                lines.append("")
        out.write_text("\n".join(lines), encoding="utf-8")

    return {
        "success": True,
        "output": str(out),
        "slides": len(slides),
        "chars": char_count,
        "withNotes": sum(1 for s in slides if s["notes"]),
    }


# ────────────────────────────── 体积压缩 ──────────────────────────────

def ppt_compress(
    file_path: str,
    output_path: str,
    quality: int = 75,
    max_width: int = 1920,
) -> Dict[str, Any]:
    """重新压缩 PPT 里的图片来减小体积。

    做法：把 pptx 当 zip 打开，逐个处理 ppt/media 下的位图 —— 超过 max_width 的等比缩小，
    再按指定质量重新编码；矢量图（emf/wmf/svg）与音视频原样保留。
    """
    src = Path(file_path)
    if src.suffix.lower() not in (".pptx", ".pptm", ".ppsx"):
        raise RuntimeError("只支持 .pptx / .pptm 格式")

    quality = max(30, min(95, int(quality)))
    max_width = max(320, min(6000, int(max_width)))

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    before = 0
    after = 0
    touched = 0
    skipped = 0

    with zipfile.ZipFile(src) as zin, zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zout:
        for info in zin.infolist():
            data = zin.read(info.filename)
            is_media = info.filename.startswith("ppt/media/") and Path(info.filename).suffix.lower() in (
                ".png", ".jpg", ".jpeg", ".bmp", ".tif", ".tiff", ".webp",
            )
            if not is_media:
                zout.writestr(info, data)
                continue

            before += len(data)
            try:
                img = Image.open(io.BytesIO(data))
                img.load()
                original_format = img.format or "PNG"

                # 缩小超宽图片（PPT 里常见的 4K 截图）
                if img.width > max_width:
                    ratio = max_width / img.width
                    img = img.resize((max_width, max(1, int(img.height * ratio))), Image.LANCZOS)

                buf = io.BytesIO()
                if original_format in ("JPEG", "JPG"):
                    img.convert("RGB").save(buf, format="JPEG", quality=quality, optimize=True, progressive=True)
                elif original_format == "PNG":
                    # PNG 有透明通道时保留，否则按 JPEG 处理体积更小
                    has_alpha = img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info)
                    if has_alpha and img.width * img.height < 4_000_000:
                        img.save(buf, format="PNG", optimize=True)
                    else:
                        img.convert("RGB").save(buf, format="JPEG", quality=quality, optimize=True, progressive=True)
                else:
                    img.save(buf, format=original_format)

                new_data = buf.getvalue()
                # 压完反而更大就用原图（小图重新编码常常变大）
                if len(new_data) >= len(data):
                    zout.writestr(info, data)
                    after += len(data)
                    skipped += 1
                else:
                    zout.writestr(info, new_data)
                    after += len(new_data)
                    touched += 1
            except Exception:
                zout.writestr(info, data)
                after += len(data)
                skipped += 1

    if before == 0:
        raise RuntimeError("这份演示文稿里没有可压缩的图片")

    saved = before - after
    return {
        "success": True,
        "output": str(out),
        "beforeSize": before,
        "afterSize": after,
        "savedBytes": saved,
        "savedPercent": round(saved / before * 100, 1) if before else 0,
        "compressed": touched,
        "skipped": skipped,
    }
