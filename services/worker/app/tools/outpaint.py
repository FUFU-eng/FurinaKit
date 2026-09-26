"""AI 扩图（外扩画布）—— 复用已有的 LaMa 修补模型，不引入扩散模型。

关键认识：LaMa 这类修补模型本来就是为「补全空白」训练的，论文里外扩（outpainting）
就是它的核心用例之一。所以「扩图」不需要几百 MB 到几 GB 的 Stable Diffusion：
把画布放大、把新出来的空白边当作掩膜交给 LaMa 就行。

这样做还有两个额外好处：
  · 原图区域**逐像素保留**（LaMa 的结果只贴回掩膜区域），不会被重新生成而损失细节；
  · 复用已经按需下载好的模型（约 198MB），安装包不增加任何体积。

需要多大就扩多大：四周各自可指定扩展比例，也能指定成目标宽高比（把竖图扩成横图）。
"""

from __future__ import annotations

import os
from typing import Any, Dict, Optional, Tuple

import cv2
import numpy as np


def _load(path: str) -> np.ndarray:
    img = cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise RuntimeError("无法读取图片，请确认格式是否受支持")
    return img


def _save(path: str, img: np.ndarray) -> None:
    ext = "." + path.rsplit(".", 1)[-1].lower() if "." in path else ".png"
    ok, buf = cv2.imencode(ext, img)
    if not ok:
        raise RuntimeError("图片保存失败")
    buf.tofile(path)


def plan_canvas(
    w: int,
    h: int,
    left: float, right: float, top: float, bottom: float,
    target_ratio: Optional[float] = None,
    anchor: str = "center",
) -> Tuple[int, int, Tuple[int, int]]:
    """算出目标画布尺寸与原图在画布里的左上角位置。

    target_ratio 给了就优先按它来（例如 16/9 把竖图扩成横图）：
    保持原图尺寸不变，把画布补齐到目标比例。
    """
    if target_ratio and target_ratio > 0:
        cur = w / h
        if cur < target_ratio:          # 太窄 → 左右补
            new_w = int(round(h * target_ratio))
            new_h = h
        else:                            # 太扁 → 上下补
            new_w = w
            new_h = int(round(w / target_ratio))
        pad_w, pad_h = new_w - w, new_h - h
        if anchor == "center":
            ox, oy = pad_w // 2, pad_h // 2
        elif anchor == "top-left":
            ox, oy = 0, 0
        elif anchor == "bottom-right":
            ox, oy = pad_w, pad_h
        else:
            ox, oy = pad_w // 2, pad_h // 2
        return new_w, new_h, (ox, oy)

    new_w = max(8, int(round(w * (1 + max(0.0, left) + max(0.0, right)))))
    new_h = max(8, int(round(h * (1 + max(0.0, top) + max(0.0, bottom)))))
    ox = int(round(w * max(0.0, left)))
    oy = int(round(h * max(0.0, top)))
    # 保证原图一定放得下
    ox = max(0, min(ox, new_w - w))
    oy = max(0, min(oy, new_h - h))
    return new_w, new_h, (ox, oy)


def outpaint(
    file_path: str,
    output_path: str,
    model_path: Optional[str] = None,
    left: float = 0.25,
    right: float = 0.25,
    top: float = 0.25,
    bottom: float = 0.25,
    target_ratio: Optional[float] = None,
    anchor: str = "center",
) -> Dict[str, Any]:
    """把画布向外扩大，并用 LaMa 把新出现的空白补成连贯的画面。"""
    img = _load(file_path)
    h, w = img.shape[:2]

    new_w, new_h, (ox, oy) = plan_canvas(w, h, left, right, top, bottom, target_ratio, anchor)
    if new_w == w and new_h == h:
        raise RuntimeError("扩图比例都是 0，画布没有变大 —— 请把某一边的扩展比例调大一点")

    # ① 建更大的画布：空白处先用边缘像素铺一层，给模型一个更接近真实延展的起点
    canvas = np.zeros((new_h, new_w, 3), dtype=np.uint8)
    canvas[oy:oy + h, ox:ox + w] = img
    if oy > 0:
        canvas[:oy, ox:ox + w] = img[0:1, :, :]
    if oy + h < new_h:
        canvas[oy + h:, ox:ox + w] = img[-1:, :, :]
    if ox > 0:
        canvas[:, :ox] = canvas[:, ox:ox + 1]
    if ox + w < new_w:
        canvas[:, ox + w:] = canvas[:, ox + w - 1:ox + w]

    # ② 掩膜：只把新扩出来的区域交给模型，原图区域一律不碰
    mask = np.zeros((new_h, new_w), dtype=np.uint8)
    mask[:oy, :] = 255
    mask[oy + h:, :] = 255
    mask[:, :ox] = 255
    mask[:, ox + w:] = 255
    if int(np.count_nonzero(mask)) == 0:
        raise RuntimeError("没有需要补全的区域")

    # ③ 让掩膜稍微吃进原图一点，接缝才自然（不吃进去会留下一条明显的直边）
    blend = max(2, int(min(new_w, new_h) * 0.012))
    kernel = np.ones((blend, blend), np.uint8)
    mask = cv2.dilate(mask, kernel, iterations=1)

    from app.tools import lama_inpaint

    if not model_path or not os.path.isfile(model_path):
        raise RuntimeError("还没下载「去水印 · 精细模型」，请到设置里的「按需下载组件」下载后重试（约 198MB）")

    filled = lama_inpaint.lama_inpaint(canvas, mask, model_path)

    # ④ 原图区域逐像素恢复 —— 保证扩图不会把原来的内容"重新生成"一遍
    result = filled.copy()
    result[oy:oy + h, ox:ox + w] = img

    _save(output_path, result)

    return {
        "success": True,
        "output": output_path,
        "sourceWidth": w,
        "sourceHeight": h,
        "width": new_w,
        "height": new_h,
        "offsetX": ox,
        "offsetY": oy,
        "ratioBefore": round(w / h, 3),
        "ratioAfter": round(new_w / new_h, 3),
        "filledPixels": int(np.count_nonzero(mask)),
        "filledRatio": round(float(np.count_nonzero(mask)) / (new_w * new_h), 4),
    }
