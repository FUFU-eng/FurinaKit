"""黑白上色的两条不依赖模型的路线。

说明清楚：这里做的**不是 AI 上色**，不假装是。
  · 参考图上色：把一张彩色图的色彩分布（LAB 里的 a/b 通道统计）迁移到黑白图上，
    保留黑白图自己的明暗结构。给一张配色相近的参考图，效果相当可用。
  · 风格预设上色：内置几组常见场景（人像 / 风景 / 室内 / 复古）的色彩统计做同样的事，
    不需要用户准备参考图，但只能给出"大致像那个场景"的颜色，细节不会自己长出来。

真正的 AI 上色（DDColor / DeOldify 那一类）需要几百 MB 的模型，本轮还没找到可用的 ONNX 源，
所以先把能确定做好的两条路线做扎实，并在界面上如实说明它们不是 AI 上色。
"""

from __future__ import annotations

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


def is_grayscale(img: np.ndarray, tolerance: int = 6) -> bool:
    """判断是不是近黑白图（三通道差异极小）"""
    b, g, r = img[:, :, 0].astype(np.int16), img[:, :, 1].astype(np.int16), img[:, :, 2].astype(np.int16)
    return bool(max(np.abs(b - g).mean(), np.abs(g - r).mean(), np.abs(b - r).mean()) < tolerance)


def colorize_by_reference(
    gray_img: np.ndarray,
    ref_img: np.ndarray,
    strength: float = 1.0,
    keep_luminance: bool = True,
) -> np.ndarray:
    """把参考图的色彩分布迁移到黑白图上（在 LAB 空间做统计匹配）。

    keep_luminance=True 时保留原图的明暗（推荐）——否则整张图的曝光也会被参考图带跑。
    strength 控制迁移强度：0 完全不上色，1 完全采用参考图的色彩分布。
    """
    src = cv2.cvtColor(gray_img, cv2.COLOR_BGR2LAB).astype(np.float32)
    ref = cv2.cvtColor(ref_img, cv2.COLOR_BGR2LAB).astype(np.float32)

    out = src.copy()
    for c in (1, 2):  # 只迁移 a/b 两个色彩通道，亮度通道按需保留
        s_mean, s_std = float(src[:, :, c].mean()), float(src[:, :, c].std()) or 1.0
        r_mean, r_std = float(ref[:, :, c].mean()), float(ref[:, :, c].std()) or 1.0
        mapped = (src[:, :, c] - s_mean) / s_std * r_std + r_mean
        out[:, :, c] = src[:, :, c] * (1 - strength) + mapped * strength

    if not keep_luminance:
        s_mean, s_std = float(src[:, :, 0].mean()), float(src[:, :, 0].std()) or 1.0
        r_mean, r_std = float(ref[:, :, 0].mean()), float(ref[:, :, 0].std()) or 1.0
        out[:, :, 0] = (src[:, :, 0] - s_mean) / s_std * r_std + r_mean

    out = np.clip(out, 0, 255).astype(np.uint8)
    return cv2.cvtColor(out, cv2.COLOR_LAB2BGR)


# 内置风格预设：直接在 LAB 的 a/b 通道上给目标均值与标准差。
# 这些数值是按「该场景常见配色」定的经验值，不是从模型里学来的 —— 界面上也这样说明。
STYLE_PRESETS: Dict[str, Dict[str, Any]] = {
    "portrait": {
        "label": "人像（偏暖，肤色自然）",
        "a": (150.0, 7.0),   # a 通道：绿-红，>128 偏红
        "b": (150.0, 9.0),   # b 通道：蓝-黄，>128 偏黄
    },
    "landscape": {
        "label": "风景（蓝天绿地，色彩通透）",
        "a": (126.0, 9.0),
        "b": (140.0, 13.0),
    },
    "indoor": {
        "label": "室内（暖光，柔和）",
        "a": (134.0, 5.0),
        "b": (146.0, 8.0),
    },
    "vintage": {
        "label": "复古（低饱和偏黄）",
        "a": (134.0, 4.0),
        "b": (142.0, 6.0),
    },
    "neutral": {
        "label": "自然（接近真实，克制）",
        "a": (128.0, 5.0),
        "b": (130.0, 6.0),
    },
}


def colorize_by_style(gray_img: np.ndarray, style: str = "portrait", strength: float = 1.0) -> np.ndarray:
    """按风格预设上色：把 a/b 通道按预设的均值与标准差重新分布，亮度保持不变。"""
    preset = STYLE_PRESETS.get(style)
    if not preset:
        raise RuntimeError(f"没有「{style}」这个风格，可选：{'、'.join(STYLE_PRESETS)}")

    lab = cv2.cvtColor(gray_img, cv2.COLOR_BGR2LAB).astype(np.float32)
    out = lab.copy()

    # 先把近黑白的图变"活"：a/b 通道本身几乎是常数，直接按预设重排
    for idx, key in ((1, "a"), (2, "b")):
        target_mean, target_std = preset[key]
        src = lab[:, :, idx]
        # 黑白图的 a/b 几乎是常量，用亮度做一点变化，避免上色后一片死板
        lum = (lab[:, :, 0] - lab[:, :, 0].mean()) / max(float(lab[:, :, 0].std()), 1.0)
        variation = lum * target_std * 0.8
        mapped = target_mean + variation
        out[:, :, idx] = src * (1 - strength) + mapped * strength

    out = np.clip(out, 0, 255).astype(np.uint8)
    return cv2.cvtColor(out, cv2.COLOR_LAB2BGR)


def colorize(
    file_path: str,
    output_path: str,
    mode: str = "style",
    style: str = "portrait",
    reference_path: Optional[str] = None,
    strength: float = 1.0,
) -> Dict[str, Any]:
    """上色入口。mode: style（风格预设） / reference（参考图）"""
    img = _load(file_path)
    was_gray = is_grayscale(img)

    if mode == "reference":
        if not reference_path:
            raise RuntimeError("参考图上色需要选择一张彩色参考图")
        ref = _load(reference_path)
        if is_grayscale(ref):
            raise RuntimeError("参考图本身也是黑白的，无法提供色彩，请换一张有明显颜色的图片")
        out = colorize_by_reference(img, ref, strength)
        detail = "参考图色彩迁移"
    elif mode == "style":
        out = colorize_by_style(img, style, strength)
        detail = STYLE_PRESETS[style]["label"]
    else:
        raise RuntimeError(f"不支持的上色方式「{mode}」")

    _save(output_path, out)

    # 回执指标用「平均饱和度」：HSV 的 S 通道均值，含义直白（画面平均有多"彩"），
    # 不会有歧义。早先用「LAB 的 a/b 标准差之和」，在参考图路线上出现过
    # 「像素差明显变小、这个指标却报 0」的自相矛盾，换掉它。
    def chroma(a: np.ndarray) -> float:
        hsv = cv2.cvtColor(a, cv2.COLOR_BGR2HSV)
        return float(hsv[:, :, 1].mean())

    return {
        "success": True,
        "output": output_path,
        "mode": mode,
        "detail": detail,
        "wasGrayscale": was_gray,
        "saturationBefore": round(chroma(img), 2),
        "saturationAfter": round(chroma(out), 2),
        "width": int(out.shape[1]),
        "height": int(out.shape[0]),
    }
