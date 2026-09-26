"""PDF 内容层编辑：文字替换、插入文字、插入图片、加高亮。

与之前的「页面层」编辑（删页/旋转/移动）不同，这一层直接改页面内容：
  · 文字替换 —— 先按原文定位，用涂白（redaction）盖掉旧字，再在同样位置写上新字；
  · 插入文字 —— 在指定位置写文字，可选字号、颜色、对齐；
  · 插入图片 —— 把图片贴到指定矩形区域（按比例适应，不变形）。

三个必须处理好的细节（不处理就会出难看的结果）：
1. **中文要指定中文字体**：默认字体不含汉字，会画成一堆方块或直接丢失。这里统一用 PyMuPDF 的
   内置中文字体 china-s（简体）。
2. **涂白会连带删掉同区域里的其他内容**：所以先用 search_for 拿到精确矩形，
   只在那个矩形上涂，而不是整段整行地涂。
3. **字号要跟原文匹配**：替换后的文字用原文的字号，否则一眼就能看出被改过。
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import pymupdf as fitz

CJK_FONT = "china-s"  # PyMuPDF 内置简体中文字体


def _font_size_for(page: fitz.Page, rect: fitz.Rect, text: str) -> float:
    """按原文矩形高度估算字号（PyMuPDF 的 span 更准，这里做兜底）"""
    try:
        for block in page.get_text("dict")["blocks"]:
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    if fitz.Rect(span["bbox"]).intersects(rect):
                        return float(span["size"])
    except Exception:
        pass
    return max(6.0, min(rect.height * 0.8, 72.0))


def replace_text(
    doc: fitz.Document,
    page_no: int,
    old_text: str,
    new_text: str,
    color: Tuple[float, float, float] = (0, 0, 0),
    all_occurrences: bool = False,
    font_name: str = CJK_FONT,
) -> int:
    """把某一页上的 old_text 换成 new_text，返回替换处数"""
    page = doc[page_no]
    hits = page.search_for(old_text)
    if not hits:
        return 0
    if not all_occurrences:
        hits = hits[:1]

    for rect in hits:
        size = _font_size_for(page, rect, old_text)
        # ① 涂白：只在命中矩形上涂，避免连带删掉同一行旁边的文字
        page.add_redact_annot(rect, fill=(1, 1, 1))
        page.apply_redactions()
        # ② 写上新字：基线落在矩形底部往上一点的位置
        baseline = fitz.Point(rect.x0, rect.y1 - size * 0.22)
        try:
            page.insert_text(baseline, new_text, fontname=font_name, fontsize=size, color=color)
        except Exception:
            # 内置中文字体不可用时退回默认字体（英文数字仍能正常显示）
            page.insert_text(baseline, new_text, fontsize=size, color=color)
    return len(hits)


def insert_text(
    doc: fitz.Document,
    page_no: int,
    text: str,
    x: float,
    y: float,
    size: float = 12.0,
    color: Tuple[float, float, float] = (0, 0, 0),
    font_name: str = CJK_FONT,
    max_width: Optional[float] = None,
) -> None:
    """在指定位置写入文字；给了 max_width 就自动换行"""
    page = doc[page_no]
    if max_width:
        rect = fitz.Rect(x, y, x + max_width, page.rect.height - 24)
        page.insert_textbox(rect, text, fontname=font_name, fontsize=size, color=color)
    else:
        try:
            page.insert_text(fitz.Point(x, y), text, fontname=font_name, fontsize=size, color=color)
        except Exception:
            page.insert_text(fitz.Point(x, y), text, fontsize=size, color=color)


def insert_image(
    doc: fitz.Document,
    page_no: int,
    image_path: str,
    x: float,
    y: float,
    width: float,
    height: Optional[float] = None,
    keep_ratio: bool = True,
) -> None:
    """把图片贴到指定区域；keep_ratio 时按比例缩放并居中，避免被拉变形"""
    page = doc[page_no]
    if not os.path.isfile(image_path):
        raise RuntimeError("要插入的图片不存在")

    if keep_ratio:
        with fitz.open(image_path) as im:
            iw, ih = im[0].rect.width, im[0].rect.height
        if iw <= 0 or ih <= 0:
            raise RuntimeError("图片尺寸异常")
        target_w = width
        target_h = height if height else width * ih / iw
        scale = min(target_w / iw, target_h / ih)
        draw_w, draw_h = iw * scale, ih * scale
        cx, cy = x + (target_w - draw_w) / 2, y + (target_h - draw_h) / 2
        rect = fitz.Rect(cx, cy, cx + draw_w, cy + draw_h)
    else:
        rect = fitz.Rect(x, y, x + width, y + (height or width))

    page.insert_image(rect, filename=image_path, keep_proportion=False)


def pdf_content_edit(
    file_path: str,
    output_path: str,
    ops: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """按 ops 顺序做内容层编辑。每步都做越界检查并给出明确原因，不静默跳过。"""
    src = Path(file_path)
    if src.suffix.lower() != ".pdf":
        raise RuntimeError("只支持 PDF 文件")
    if not ops:
        raise RuntimeError("没有任何编辑操作")

    doc = fitz.open(str(src))
    applied: List[Dict[str, Any]] = []

    try:
        for index, op in enumerate(ops, start=1):
            kind = str(op.get("type", "")).lower()
            page_no = int(op.get("page", 1))
            if page_no < 1 or page_no > len(doc):
                raise RuntimeError(f"第 {page_no} 页不存在（当前共 {len(doc)} 页）")
            page_no -= 1

            if kind == "replace":
                old = str(op.get("old", ""))
                new = str(op.get("new", ""))
                if not old:
                    raise RuntimeError("文字替换需要提供要查找的原文")
                count = replace_text(doc, page_no, old, new, all_occurrences=bool(op.get("all", False)))
                if count == 0:
                    raise RuntimeError(f"第 {page_no + 1} 页上没有找到「{old}」，请确认文字与页面上完全一致")
                applied.append({"step": index, "type": kind, "page": page_no + 1, "count": count})

            elif kind == "text":
                text = str(op.get("text", ""))
                if not text:
                    raise RuntimeError("插入文字需要提供内容")
                insert_text(
                    doc, page_no, text,
                    float(op.get("x", 72)), float(op.get("y", 72)),
                    size=float(op.get("size", 12)),
                    max_width=float(op["maxWidth"]) if op.get("maxWidth") else None,
                )
                applied.append({"step": index, "type": kind, "page": page_no + 1, "chars": len(text)})

            elif kind == "image":
                img = str(op.get("file", ""))
                insert_image(
                    doc, page_no, img,
                    float(op.get("x", 72)), float(op.get("y", 72)),
                    float(op.get("width", 200)),
                    float(op["height"]) if op.get("height") else None,
                    keep_ratio=bool(op.get("keepRatio", True)),
                )
                applied.append({"step": index, "type": kind, "page": page_no + 1, "file": Path(img).name})

            else:
                raise RuntimeError(f"不支持的内容层操作「{kind}」")

        doc.save(str(output_path), garbage=3, deflate=True)
        pages = len(doc)
    finally:
        doc.close()

    return {"success": True, "output": output_path, "pages": pages, "applied": applied}
