"""ISNet 精细抠图（按需下载的模型档）。

与内置的快速抠图（rembg 的 u2net）相比，ISNet 在**发丝、半透明边缘、细小镂空**上明显更干净，
代价是慢一些、模型大一些（170MB，因此走按需下载）。

模型接口（rembg 发布的 isnet-general-use.onnx）：
  input : [1, 3, H, W] float32，像素 /255 之后按 ImageNet 的均值方差归一化
  输出  : 单通道 logits，需要 sigmoid 得到 0~1 的 alpha
不同导出版本输入名与尺寸可能不同，所以这里同样先探签名、按形状喂数据，不把细节写死。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import cv2
import numpy as np

_session = None
_session_path: Optional[str] = None

# rembg 里 isnet 用的 ImageNet 归一化系数
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)
DEFAULT_SIZE = 1024


def _load_session(model_path: str):
    global _session, _session_path
    if _session is not None and _session_path == model_path:
        return _session
    import onnxruntime as ort

    opts = ort.SessionOptions()
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    _session = ort.InferenceSession(model_path, sess_options=opts, providers=["CPUExecutionProvider"])
    _session_path = model_path
    return _session


def describe_model(model_path: str) -> Dict[str, Any]:
    """打印模型签名，便于确认版本差异"""
    sess = _load_session(model_path)
    return {
        "inputs": [{"name": i.name, "shape": [str(d) for d in i.shape], "type": i.type} for i in sess.get_inputs()],
        "outputs": [{"name": o.name, "shape": [str(d) for d in o.shape], "type": o.type} for o in sess.get_outputs()],
    }


def _pick_size(sess, fallback: int = DEFAULT_SIZE) -> int:
    """从模型签名里读输入尺寸；是动态维度时用默认值"""
    for spec in sess.get_inputs():
        shape = list(spec.shape)
        if len(shape) == 4:
            h = shape[2]
            if isinstance(h, int) and h > 0:
                return h
    return fallback


def _to_input(img_bgr: np.ndarray, size: int) -> Tuple[np.ndarray, Tuple[int, int]]:
    h, w = img_bgr.shape[:2]
    rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    # 归一化只用 /255，**不加 ImageNet 的 mean/std**。
    # 这也是逐像素对比 rembg 实测出来的：
    #   只 /255        → 平均差 7.61（主体中心 254.0，rembg 是 253.8）
    #   /255 + mean/std → 平均差 73.92（主体中心 0.0，完全不对）
    # 注意别照抄 rembg 里 u2net 那套（它用 /max 再减 mean/std），ISNet 不吃那一套。
    small = cv2.resize(rgb, (size, size), interpolation=cv2.INTER_LANCZOS4).astype(np.float32) / 255.0
    return small.transpose(2, 0, 1)[None, ...].astype(np.float32), (h, w)


def isnet_alpha(img_bgr: np.ndarray, model_path: str) -> np.ndarray:
    """算出 0~255 的 alpha（前景不透明度），尺寸与原图一致"""
    if not Path(model_path).is_file():
        raise RuntimeError("ISNet 模型文件不存在，请在设置里的「按需下载组件」下载后重试")

    sess = _load_session(model_path)
    size = _pick_size(sess)
    tensor, (h, w) = _to_input(img_bgr, size)

    input_name = sess.get_inputs()[0].name
    out = sess.run(None, {input_name: tensor})[0]

    # 输出可能是 [1,1,h,w]、[1,h,w] 或 [1,1,1,h,w]
    while out.ndim > 3:
        out = out[0]
    if out.ndim == 2:
        out = out[None, ...]
    logits = out[0] if out.shape[0] == 1 else out.max(axis=0)

    # 归一化方式：min-max，**不是 sigmoid**。
    # 这是逐像素对比 rembg 实测出来的结论：
    #   min-max 平均差 7.6（主体中心 254.0，与 rembg 的 253.8 一致）
    #   sigmoid 平均差 110.6（主体中心 186.0，明显不对）
    # 原因是这些分割模型输出的是 logits，rembg 用的是 (x-min)/(max-min)。
    mi, ma = float(logits.min()), float(logits.max())
    alpha = (logits - mi) / max(ma - mi, 1e-6)

    alpha = np.clip(alpha, 0, 1)
    alpha_u8 = (alpha * 255).astype(np.uint8)
    if alpha_u8.shape[:2] != (h, w):
        alpha_u8 = cv2.resize(alpha_u8, (w, h), interpolation=cv2.INTER_LANCZOS4)
    return alpha_u8


def remove_background(
    img_bgr: np.ndarray,
    model_path: str,
    background: Optional[Tuple[int, int, int]] = None,
    feather: int = 0,
) -> np.ndarray:
    """抠图：默认输出带透明通道的 BGRA；给了 background 就换成该底色（BGR）"""
    alpha = isnet_alpha(img_bgr, model_path)

    # 边缘羽化：把 alpha 轻微模糊，避免锯齿（发丝细节靠模型本身，不靠模糊）
    if feather > 0:
        k = feather * 2 + 1
        alpha = cv2.GaussianBlur(alpha, (k, k), 0)

    if background is None:
        bgra = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2BGRA)
        bgra[:, :, 3] = alpha
        return bgra

    # 合成到指定底色
    a = (alpha.astype(np.float32) / 255.0)[..., None]
    bg = np.zeros_like(img_bgr, dtype=np.float32)
    bg[:, :] = background
    out = img_bgr.astype(np.float32) * a + bg * (1 - a)
    return out.astype(np.uint8)


def compose_background(
    img_bgr: np.ndarray,
    alpha: np.ndarray,
    bg_image: Optional[np.ndarray] = None,
    bg_color: Optional[Tuple[int, int, int]] = None,
    blur_original: int = 0,
    feather: int = 0,
) -> np.ndarray:
    """把抠出来的主体合成到新背景上。

    三种背景来源（优先级：背景图 > 模糊原背景 > 纯色）：
      · bg_image：上传的背景图，会按原图尺寸等比铺满（不足处放大裁切）；
      · blur_original：把原背景高斯模糊，得到自然的「景深虚化」效果；
      · bg_color：纯色底（BGR）。
    """
    h, w = img_bgr.shape[:2]

    if feather > 0:
        k = feather * 2 + 1
        alpha = cv2.GaussianBlur(alpha, (k, k), 0)

    if bg_image is not None:
        # 等比放大到覆盖整张画布，再居中裁切，避免拉伸变形
        bh, bw = bg_image.shape[:2]
        scale = max(w / bw, h / bh)
        resized = cv2.resize(bg_image, (max(1, int(bw * scale)), max(1, int(bh * scale))), interpolation=cv2.INTER_AREA)
        rh, rw = resized.shape[:2]
        x0 = max(0, (rw - w) // 2)
        y0 = max(0, (rh - h) // 2)
        background = resized[y0:y0 + h, x0:x0 + w].copy()
    elif blur_original > 0:
        k = blur_original * 2 + 1
        background = cv2.GaussianBlur(img_bgr, (k, k), 0)
    elif bg_color is not None:
        background = np.zeros_like(img_bgr, dtype=np.uint8)
        background[:, :] = bg_color
    else:
        background = np.zeros_like(img_bgr, dtype=np.uint8)

    a = (alpha.astype(np.float32) / 255.0)[..., None]
    out = img_bgr.astype(np.float32) * a + background.astype(np.float32) * (1 - a)
    return out.astype(np.uint8)

def generic_alpha(img_bgr: np.ndarray, model_path: str, size: int = 320) -> np.ndarray:
    """通用 ONNX 抠图（u2net 这类）：与 isnet_alpha 同一套预处理，只是输入尺寸不同。

    u2net 用 320x320、ISNet 用 1024x1024，归一化与后处理完全一致
    （只 /255、min-max 归一化，不做 sigmoid、不加 mean/std）。
    """
    if not Path(model_path).is_file():
        raise RuntimeError("抠图模型文件不存在，请在工具页上方或设置里下载后重试")

    sess = _load_session(model_path)
    sig = _pick_size(sess, fallback=size)
    tensor, (h, w) = _to_input(img_bgr, sig)
    out = sess.run(None, {sess.get_inputs()[0].name: tensor})[0]

    while out.ndim > 3:
        out = out[0]
    if out.ndim == 2:
        out = out[None, ...]
    logits = out[0] if out.shape[0] == 1 else out.max(axis=0)

    mi, ma = float(logits.min()), float(logits.max())
    alpha = np.clip((logits - mi) / max(ma - mi, 1e-6), 0, 1)
    alpha_u8 = (alpha * 255).astype(np.uint8)
    if alpha_u8.shape[:2] != (h, w):
        alpha_u8 = cv2.resize(alpha_u8, (w, h), interpolation=cv2.INTER_LANCZOS4)
    return alpha_u8


def alpha_with_model(img_bgr: np.ndarray, model_path: str) -> np.ndarray:
    """按模型签名自动选尺寸：小模型（320）走 generic，大模型（1024）走 isnet 那条。"""
    sess = _load_session(model_path)
    size = _pick_size(sess, fallback=0)
    if size and size <= 512:
        return generic_alpha(img_bgr, model_path, size=size)
    return isnet_alpha(img_bgr, model_path)
