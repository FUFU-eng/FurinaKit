"""PDF 文字增强：把扫描件处理得更清楚。

适用场景：手机拍的文档、老扫描件 —— 底子发灰、有噪点、字边发虚。
做法是逐页渲染成位图后处理，再重新组成 PDF：
  去噪（中值滤波）→ 提亮背景（自动对比度 / 白平衡）→ 锐化字边 → 可选二值化。
处理强度分三档，默认「标准」：多数扫描件一次就能明显变清楚，又不会把细节磨平。

注意：增强后页面成为整页位图，原 PDF 的文字层会丢失（扫描件本来也没有文字层）；
需要保留可搜索文字的 PDF 请不要用这个工具。
"""

from __future__ import annotations

import io
from pathlib import Path
from typing import Any, Dict, Optional

import numpy as np
from PIL import Image, ImageFilter, ImageOps


def _to_image(pix) -> Image.Image:
    mode = "RGBA" if pix.alpha else "RGB"
    return Image.frombytes(mode, (pix.width, pix.height), pix.samples).convert("RGB")


def _auto_white_balance(img: Image.Image) -> Image.Image:
    """按亮度分布把「纸张白」拉到接近纯白，去掉拍歪的灰底。"""
    arr = np.asarray(img.convert("L"), dtype=np.float32)
    # 取 95 分位当作纸白，低于它的整体拉伸
    paper = np.percentile(arr, 95)
    if paper < 30:
        return img
    scale = 255.0 / max(1.0, paper)
    arr = np.clip(arr * scale, 0, 255)
    gray = Image.fromarray(arr.astype(np.uint8), mode="L")
    # 保留原色彩倾向：用灰度做亮度、原图做色度
    hsv = img.convert("HSV")
    h, s, _ = hsv.split()
    return Image.merge("HSV", (h, s, gray)).convert("RGB")


def _process(img: Image.Image, mode: str, strength: str) -> Image.Image:
    levels = {
        "light": {"blur": 3, "sharpen": (1.2, 1.2, 3), "contrast": 1.05},
        "medium": {"blur": 3, "sharpen": (1.8, 1.6, 3), "contrast": 1.12},
        "strong": {"blur": 5, "sharpen": (2.6, 2.0, 5), "contrast": 1.22},
    }
    cfg = levels.get(strength, levels["medium"])

    # 1) 去噪：中值滤波对扫描噪点最有效，且不会像高斯模糊那样糊字
    img = img.filter(ImageFilter.MedianFilter(size=cfg["blur"]))
    # 2) 提亮背景
    img = _auto_white_balance(img)
    img = ImageOps.autocontrast(img.convert("L") if mode != "color" else img, cutoff=1)
    # 3) 锐化字边
    img = img.filter(ImageFilter.UnsharpMask(radius=cfg["sharpen"][2], percent=int(cfg["sharpen"][0] * 100), threshold=2))
    # 4) 对比度
    from PIL import ImageEnhance

    img = ImageEnhance.Contrast(img).enhance(cfg["contrast"])

    if mode == "bw":
        # 二值化：阈值取 Otsu 的简化版（均值 + 半标准差），对文档图像足够稳
        gray = np.asarray(img.convert("L"), dtype=np.float32)
        threshold = gray.mean() + gray.std() * 0.15
        binary = np.where(gray > threshold, 255, 0).astype(np.uint8)
        img = Image.fromarray(binary, mode="L").convert("RGB")
    elif mode == "gray":
        img = img.convert("L").convert("RGB")

    return img


def pdf_enhance(
    file_path: str,
    output_path: str,
    mode: str = "gray",
    strength: str = "medium",
    dpi: int = 200,
    pages: Optional[str] = None,
) -> Dict[str, Any]:
    """逐页增强后重新生成 PDF。mode: gray（灰度）/ bw（黑白）/ color（彩色）"""
    import pymupdf as fitz

    src = Path(file_path)
    if src.suffix.lower() != ".pdf":
        raise RuntimeError("只支持 PDF 文件")

    dpi = max(96, min(400, int(dpi)))
    doc = fitz.open(str(src))

    if pages and pages != "all":
        target = set()
        for part in pages.split(","):
            part = part.strip()
            if not part:
                continue
            if "-" in part:
                a, b = part.split("-")
                target.update(range(int(a) - 1, int(b)))
            else:
                target.add(int(part) - 1)
    else:
        target = set(range(len(doc)))

    out = fitz.open()
    processed = 0
    for index, page in enumerate(doc):
        if index not in target:
            # 不在处理范围的页面原样保留（用原页面的显示列表绘制）
            rect = page.rect
            newpage = out.new_page(width=rect.width, height=rect.height)
            newpage.show_pdf_page(rect, doc, index)
            continue
        rect = page.rect
        pix = page.get_pixmap(dpi=dpi)
        img = _to_image(pix)
        img = _process(img, mode, strength)
        buf = io.BytesIO()
        # 灰度/黑白用 PNG（无损且体积可控），彩色用高质量 JPEG
        if mode in ("gray", "bw"):
            img.save(buf, format="PNG", optimize=True)
        else:
            img.save(buf, format="JPEG", quality=88, optimize=True, progressive=True)
        newpage = out.new_page(width=rect.width, height=rect.height)
        newpage.insert_image(rect, stream=buf.getvalue())
        processed += 1

    if processed == 0:
        doc.close()
        out.close()
        raise RuntimeError("没有需要处理的页面")

    out.save(str(output_path), garbage=3, deflate=True)
    out.close()
    doc.close()

    return {
        "success": True,
        "output": str(output_path),
        "processed": processed,
        "total": len(target),
        "dpi": dpi,
        "mode": mode,
        "strength": strength,
    }
