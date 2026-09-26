"""老照片修复（不依赖任何新模型）。

老照片的典型问题按出现频率排：泛黄褪色、发灰没层次、噪点/颗粒、模糊、划痕与破损。
这四类里有三类是传统图像处理就能做好的，不需要下载模型：

  · 泛黄褪色 —— 自动白平衡 + 去色偏（灰世界 + 白点拉伸）
  · 发灰没层次 —— CLAHE 自适应对比度增强
  · 噪点颗粒 —— 非局部均值去噪（保边效果好）
  · 模糊 —— 交给已有的 Real-ESRGAN 放大链路（同一套引擎，不再重复引入）
  · 划痕破损 —— 交给已有的去水印工具（LaMa 修补）

所以这个工具的价值在于「一次把前面几步做好」，而不是再塞一个大模型进来。
"""

from __future__ import annotations

from typing import Any, Dict, Optional

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


def auto_white_balance(img: np.ndarray, strength: float = 1.0) -> np.ndarray:
    """灰世界自动白平衡：把偏色的整体色偏拉回来（老照片泛黄主要靠这一步）"""
    result = img.astype(np.float32)
    means = result.reshape(-1, 3).mean(axis=0)
    gray = float(means.mean())
    for c in range(3):
        if means[c] > 1:
            gain = 1.0 + (gray / means[c] - 1.0) * max(0.0, min(1.0, strength))
            result[:, :, c] *= gain
    return np.clip(result, 0, 255).astype(np.uint8)


def stretch_levels(img: np.ndarray, min_span: int = 200) -> np.ndarray:
    """只在**亮度**上做黑白点拉伸。

    注意：早先我按通道各自拉伸，实测会把色相直接拉反（泛黄的老照片会变成偏蓝）——
    因为逐通道独立定标就破坏了三个通道之间的相对关系，色偏信息全丢了。
    现在只在 LAB 的 L 通道上拉伸，色彩关系原样保留。
    """
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    lo, hi = np.percentile(l, 0.5), np.percentile(l, 99.5)
    # 只在「确实发灰」时才拉：黑白点跨度已经接近满量程的图不需要拉，
    # 硬拉只会把它推得比原片更硬（实测过：拉伸后与干净原图的差距反而变大）。
    if hi - lo >= 1 and (hi - lo) < min_span:
        # 但拉伸量要设上限：直接把扁平的老照片拉到 0~255 满量程，会把层次推到原片的三倍以上
        # （实测层次 18 → 62），看起来又硬又假。这里最多放大 1.6 倍。
        gain = min(255.0 / (hi - lo), 1.6)
        l = np.clip((l.astype(np.float32) - lo) * gain + (255 - (hi - lo) * gain) / 2, 0, 255).astype(np.uint8)
    return cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)


def enhance_contrast(img: np.ndarray, clip: float = 1.2, grid: int = 8) -> np.ndarray:
    """CLAHE 自适应对比度：发灰的老照片会明显"透亮"起来，又不会像直方图均衡那样过曝"""
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l, a, b = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=clip, tileGridSize=(grid, grid))
    l = clahe.apply(l)
    return cv2.cvtColor(cv2.merge([l, a, b]), cv2.COLOR_LAB2BGR)


def denoise(img: np.ndarray, strength: int = 6) -> np.ndarray:
    """非局部均值去噪：颗粒感明显但边缘保得住（老照片颗粒重时很有用）"""
    if strength <= 0:
        return img
    return cv2.fastNlMeansDenoisingColored(img, None, strength, strength, 7, 21)


def unsharp(img: np.ndarray, amount: float = 0.6, radius: int = 2) -> np.ndarray:
    """轻度锐化，把去噪后发肉的感觉补回来（幅度刻意保守，避免老照片出现生硬白边）"""
    if amount <= 0:
        return img
    blur = cv2.GaussianBlur(img, (0, 0), radius)
    return cv2.addWeighted(img, 1 + amount, blur, -amount, 0)


def restore_old_photo(
    file_path: str,
    output_path: str,
    balance: float = 0.8,
    denoise_strength: int = 6,
    contrast: float = 1.2,
    sharpen: float = 0.0,
    keep_tone: bool = False,
) -> Dict[str, Any]:
    """老照片修复主流程。

    keep_tone=True 时跳过白平衡与色偏校正 —— 有些老照片的暖黄本身就是纪念意义的一部分，
    硬拉成"标准色"反而不好，所以给用户留这个开关。
    """
    img = _load(file_path)
    steps: list[str] = []

    # 顺序很重要（实测踩过）：先去噪 → 再白平衡 → 最后提层次 → 锐化放最后且默认关闭。
    # 早先"先提对比度、最后锐化"的顺序会把噪点放大三倍：拉伸对比度会一起放大颗粒，
    # 而锐化又专门强化高频（噪点正是高频），两者叠加等于把颗粒越修越重。
    out = img
    if denoise_strength > 0:
        out = denoise(out, denoise_strength)
        steps.append(f"去噪（{denoise_strength}）")

    if not keep_tone:
        out = auto_white_balance(out, balance)
        steps.append(f"去黄褪色（强度 {balance}）")
        out = stretch_levels(out)
        steps.append("提亮到正常黑白点")

    if contrast > 0:
        out = enhance_contrast(out, contrast)
        steps.append(f"提升层次（{contrast}）")

    if sharpen > 0:
        out = unsharp(out, sharpen)
        steps.append(f"锐化（{sharpen}，会略微提高颗粒感）")

    _save(output_path, out)

    # 用可量化的指标回执，而不是只说"处理完成"
    before = img.astype(np.float32)
    after = out.astype(np.float32)
    # 色偏用「红蓝差 / 绿」表示：正值偏暖（黄），负值偏冷（蓝）。
    # 只比较各通道的标准差看不出偏色方向，实测时就被这个坑过一次。
    def warm_ratio(a: np.ndarray) -> float:
        m = a.reshape(-1, 3).mean(axis=0)  # BGR
        if m[1] < 1:
            return 0.0
        return float((m[2] - m[0]) / m[1])

    cast_before = round(warm_ratio(before) * 100, 2)
    cast_after = round(warm_ratio(after) * 100, 2)
    contrast_before = float(np.std(cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)))
    contrast_after = float(np.std(cv2.cvtColor(out, cv2.COLOR_BGR2GRAY)))

    return {
        "success": True,
        "output": output_path,
        "steps": steps,
        "colorCastBefore": cast_before,
        "colorCastAfter": cast_after,
        "contrastBefore": round(contrast_before, 2),
        "contrastAfter": round(contrast_after, 2),
        "width": int(out.shape[1]),
        "height": int(out.shape[0]),
    }
