"""去水印：把图上指定区域「抹掉」，再用周围像素补回来。

原理是图像修补（inpainting）：给出要抹掉的范围（矩形或画笔轨迹），
算法根据边缘像素往里面推演，把水印、日期戳、路人、杂物补成背景。

三档能力：
  · 极速（Telea）——OpenCV 自带，0 体积、瞬时完成，适合纯色/规则背景上的水印；
  · 标准（MI-GAN）——按需下载模型，纹理背景效果明显更好；
  · 精细（LaMa）——按需下载大模型，复杂纹理最自然。
本轮先落地「极速」，模型档位留出接口（method 参数已预留），下载逻辑走统一模块。

也支持「自动检测」：对纯色/近纯色水印（例如淡灰日期戳），按亮度阈值自动生成掩膜，
用户点一下就能去掉，不用手动涂。
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Sequence

import cv2
import numpy as np

# 掩膜生成方式
MASK_RECTS = "rects"
MASK_STROKES = "strokes"


def _load_image(file_path: str) -> np.ndarray:
    """读图，兼容中文路径（cv2.imread 在中文路径下会失败）"""
    data = np.fromfile(file_path, dtype=np.uint8)
    img = cv2.imdecode(data, cv2.IMREAD_COLOR)
    if img is None:
        raise RuntimeError("无法读取图片，请确认格式是否受支持")
    return img


def _save_image(output_path: str, img: np.ndarray) -> None:
    ext = "." + output_path.rsplit(".", 1)[-1].lower() if "." in output_path else ".png"
    ok, buf = cv2.imencode(ext, img)
    if not ok:
        raise RuntimeError("图片保存失败")
    buf.tofile(output_path)


def build_mask(
    shape: Sequence[int],
    rects: Optional[List[Dict[str, float]]] = None,
    strokes: Optional[List[Dict[str, Any]]] = None,
    brush: int = 24,
) -> np.ndarray:
    """根据矩形与画笔轨迹生成掩膜（白 = 要抹掉的区域）"""
    mask = np.zeros(shape[:2], dtype=np.uint8)
    for r in rects or []:
        x, y, w, h = int(r.get("x", 0)), int(r.get("y", 0)), int(r.get("w", 0)), int(r.get("h", 0))
        if w > 0 and h > 0:
            cv2.rectangle(mask, (x, y), (x + w, y + h), 255, -1)
    for s in strokes or []:
        points = [(int(p[0]), int(p[1])) for p in s.get("points", []) if len(p) >= 2]
        width = int(s.get("brush", brush))
        if len(points) == 1:
            cv2.circle(mask, points[0], max(1, width // 2), 255, -1)
        elif len(points) > 1:
            cv2.polylines(mask, [np.array(points, dtype=np.int32)], False, 255, max(1, width))
    return mask


def auto_mask_for_light_watermark(img: np.ndarray, brightness: int = 200, min_area: int = 30) -> np.ndarray:
    """自动识别「浅色水印」（淡灰/半透明白）：找出比背景亮很多又成片的区域"""
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    # 用大核中值滤波估计背景，再找明显比背景亮的像素
    background = cv2.medianBlur(gray, 31)
    diff = cv2.subtract(gray, background)
    _, mask = cv2.threshold(diff, max(8, 255 - brightness), 255, cv2.THRESH_BINARY)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    # 去掉太小的噪点
    num, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    cleaned = np.zeros_like(mask)
    for i in range(1, num):
        if stats[i, cv2.CC_STAT_AREA] >= min_area:
            cleaned[labels == i] = 255
    return cleaned


def image_inpaint(
    file_path: str,
    output_path: str,
    rects: Optional[List[Dict[str, float]]] = None,
    strokes: Optional[List[Dict[str, Any]]] = None,
    brush: int = 24,
    method: str = "telea",
    radius: int = 3,
    auto_light: bool = False,
    dilate: int = 4,
    model_path: Optional[str] = None,
) -> Dict[str, Any]:
    """抹掉指定区域并补全背景。method: telea（本轮支持） / migan / lama（按需下载后支持）"""
    if method not in ("telea", "ns", "lama"):
        raise RuntimeError(f"不支持的处理方式「{method}」")

    img = _load_image(file_path)
    h, w = img.shape[:2]

    mask = build_mask(img.shape, rects, strokes, brush)
    if auto_light:
        mask = cv2.bitwise_or(mask, auto_mask_for_light_watermark(img))

    painted = int(np.count_nonzero(mask))
    if painted == 0:
        raise RuntimeError("没有需要处理的区域：请先在图上框出或涂出要抹掉的部分")

    # 掩膜稍微膨胀一点，避免水印边缘留下残影
    if dilate > 0:
        mask = cv2.dilate(mask, np.ones((dilate, dilate), np.uint8), iterations=1)

    if method == "lama":
        from app.tools import lama_inpaint

        if not model_path:
            raise RuntimeError(
                "还没下载「去水印 · 精细模型」，请到设置里的「按需下载组件」下载后重试（约 198MB）"
            )
        result = lama_inpaint.lama_inpaint(img, mask, model_path)
    else:
        flags = cv2.INPAINT_TELEA if method == "telea" else cv2.INPAINT_NS
        result = cv2.inpaint(img, mask, max(1, int(radius)), flags)
    _save_image(output_path, result)

    return {
        "success": True,
        "output": output_path,
        "method": method,
        "paintedPixels": painted,
        "paintedRatio": round(painted / (h * w), 4),
        "width": w,
        "height": h,
    }


def remove_watermark_region(
    file_path: str,
    output_path: str,
    region: Dict[str, float],
    method: str = "telea",
    radius: int = 3,
    auto_light: bool = False,
    model_path: Optional[str] = None,
) -> Dict[str, Any]:
    """便捷入口：只给一个矩形区域（水印通常在角落，一个框就够）"""
    return image_inpaint(
        file_path,
        output_path,
        rects=[region],
        method=method,
        radius=radius,
        auto_light=auto_light,
        model_path=model_path,
    )
