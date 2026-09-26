"""OCR：图片取字与扫描件加文字层。

用 RapidOCR（PP-OCRv5 的 onnxruntime 实现，Apache-2.0 可商用）：
  · 纯 CPU、无独显要求，模型内置在包里，离线可用；
  · 单张图片通常几十到几百毫秒。

两个能力：
  1. image_ocr —— 从图片里取出文字，返回纯文本、逐行结果（带坐标与置信度）与结构化数据；
  2. pdf_ocr  —— 把扫描件 PDF 变成**可搜索的 PDF**：逐页渲染 → 识别 → 在原图上层
     叠一层「不可见文字」（render_mode=3），文件看起来没变，但文字可以选中、搜索、复制，
     再拿去转 Word 就是可编辑文字，而不是一张图。

这正是「扫描件转 Word 出来全是图片」的根治办法：问题不在转换器，而在原 PDF 没有文字层。
"""

from __future__ import annotations

import io
from pathlib import Path
from typing import Any, Dict, List, Optional

# PP-OCR 内置的中文简体字体名（PyMuPDF 自带，无需外挂字体文件）
PDF_CJK_FONT = "china-s"

_engine = None


def _get_engine():
    """懒加载：第一次用到才初始化（模型加载约 1 秒，避免拖慢 worker 启动）"""
    global _engine
    if _engine is None:
        from rapidocr_onnxruntime import RapidOCR

        _engine = RapidOCR()
    return _engine


def _to_lines(result: Optional[List[Any]]) -> List[Dict[str, Any]]:
    """把 RapidOCR 的原始输出整理成 [{text, score, box}] """
    lines: List[Dict[str, Any]] = []
    for item in result or []:
        try:
            box, text, score = item[0], item[1], item[2]
        except Exception:
            continue
        if not text:
            continue
        xs = [float(p[0]) for p in box]
        ys = [float(p[1]) for p in box]
        lines.append(
            {
                "text": str(text),
                "score": round(float(score), 4),
                "box": [round(min(xs)), round(min(ys)), round(max(xs)), round(max(ys))],
            }
        )
    return lines


def ocr_image_array(image_input, low_confidence: float = 0.5) -> Dict[str, Any]:
    """对图片（路径或 numpy 数组）做识别，返回文本与逐行明细"""
    engine = _get_engine()
    result, _elapse = engine(image_input)
    lines = _to_lines(result)
    text = "\n".join(line["text"] for line in lines)
    low = [line for line in lines if line["score"] < low_confidence]
    avg = round(sum(line["score"] for line in lines) / len(lines), 4) if lines else 0.0
    return {
        "text": text,
        "lines": lines,
        "count": len(lines),
        "averageScore": avg,
        "lowConfidence": len(low),
    }


def image_ocr(
    file_path: str,
    output_path: str,
    output_format: str = "txt",
    low_confidence: float = 0.5,
) -> Dict[str, Any]:
    """图片 OCR。output_format: txt / md / json"""
    src = Path(file_path)
    if not src.is_file():
        raise RuntimeError("图片不存在")

    data = ocr_image_array(str(src), low_confidence)
    lines = data["lines"]
    text = data["text"]

    if output_format == "json":
        import json

        payload = json.dumps(
            {"text": text, "lines": lines, "averageScore": data["averageScore"]},
            ensure_ascii=False,
            indent=2,
        )
    elif output_format == "md":
        # 按行高分组，行距明显变大时插入空行，尽量还原段落
        grouped: List[List[Dict[str, Any]]] = []
        for line in lines:
            if grouped:
                prev_bottom = max(l["box"][3] for l in grouped[-1])
                gap = line["box"][1] - prev_bottom
                height = max(1, line["box"][3] - line["box"][1])
                if gap > height * 0.8:
                    grouped.append([line])
                    continue
                # 同一段落：是否与上一行横向错开（判断是否新的一段）
                if abs(line["box"][0] - grouped[-1][0]["box"][0]) > height * 0.6:
                    grouped.append([line])
                    continue
                grouped[-1].append(line)
            else:
                grouped.append([line])
        payload = "\n\n".join("\n".join(l["text"] for l in g) for g in grouped)
    else:
        payload = text

    Path(output_path).write_text(payload, encoding="utf-8")
    return {
        "success": True,
        "output": output_path,
        "lines": data["count"],
        "averageScore": data["averageScore"],
        "lowConfidence": data["lowConfidence"],
        "chars": len(text.replace("\n", "")),
    }


def pdf_ocr(
    file_path: str,
    output_path: str,
    dpi: int = 200,
    text_path: Optional[str] = None,
    low_confidence: float = 0.5,
) -> Dict[str, Any]:
    """给扫描件 PDF 叠一层不可见文字，输出可搜索 PDF（可选同时导出纯文本）"""
    import pymupdf as fitz

    src = Path(file_path)
    if src.suffix.lower() != ".pdf":
        raise RuntimeError("只支持 PDF 文件")

    dpi = max(96, min(400, int(dpi)))
    doc = fitz.open(str(src))
    all_text: List[str] = []
    total_lines = 0
    scores: List[float] = []

    for index, page in enumerate(doc):
        pix = page.get_pixmap(dpi=dpi)
        img = pix.tobytes("png")
        data = ocr_image_array(img, low_confidence)
        all_text.append(data["text"])
        total_lines += data["count"]
        if data["averageScore"]:
            scores.append(data["averageScore"])

        if not data["lines"]:
            continue

        # 图片坐标 → PDF 坐标（注意 y 轴方向相反）
        scale_x = page.rect.width / pix.width
        scale_y = page.rect.height / pix.height
        for line in data["lines"]:
            x0, y0, x1, y1 = line["box"]
            text = line["text"]
            if not text.strip():
                continue
            px = x0 * scale_x
            py = y1 * scale_y  # box 下沿作为基线
            box_h = max(4.0, (y1 - y0) * scale_y)
            try:
                # render_mode=3 表示「不可见」：看得见的是原图，选中的是这层文字
                page.insert_text(
                    (px, py),
                    text,
                    fontsize=box_h * 0.92,
                    fontname=PDF_CJK_FONT,
                    render_mode=3,
                )
            except Exception:
                # 字体缺字等情况跳过这一行，不影响整体可搜索性
                continue

    doc.save(str(output_path), garbage=3, deflate=True)
    doc.close()

    if text_path:
        Path(text_path).write_text("\n\n".join(all_text), encoding="utf-8")

    return {
        "success": True,
        "output": output_path,
        "textOutput": text_path,
        "pages": len(all_text),
        "lines": total_lines,
        "averageScore": round(sum(scores) / len(scores), 4) if scores else 0.0,
        "chars": sum(len(t.replace("\n", "")) for t in all_text),
    }


def pdf_has_text_layer(file_path: str, sample_pages: int = 3) -> Dict[str, Any]:
    """判断 PDF 是否已有文字层（用于提示用户「这份是扫描件，需要 OCR」）"""
    import pymupdf as fitz

    doc = fitz.open(file_path)
    pages = min(len(doc), max(1, sample_pages))
    total_chars = 0
    for i in range(pages):
        total_chars += len(doc[i].get_text().strip())
    doc.close()
    return {
        "hasText": total_chars > 20,
        "sampledChars": total_chars,
        "sampledPages": pages,
    }
