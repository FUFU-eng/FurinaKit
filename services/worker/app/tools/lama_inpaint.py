"""LaMa 精细修补（按需下载的模型档）。

与内置的 Telea 极速修补相比，LaMa 是学习式模型：它「见过」大量图像，能推断出纹理、
线条与渐变的延续方式，所以在复杂背景上补得更自然。

模型接口（Carve/LaMa-ONNX 的 lama_fp32.onnx）预期为两个输入：
  image: [1, 3, 512, 512] float32，取值 0~1，RGB
  mask : [1, 1, 512, 512] float32，0 = 保留，1 = 要补
输出 [1, 3, 512, 512] float32。
不同导出版本偶有差异，所以这里用「按名字/形状匹配输入」的写法，并在首次调用时打印实际签名，
而不是把顺序写死 —— 写死一旦版本不同就会静默出错。
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, Optional, Tuple

import cv2
import numpy as np

_session = None
_session_path: Optional[str] = None
_input_names: Tuple[str, ...] = ()


def _load_session(model_path: str):
    """懒加载 ONNX 会话（首次约 1 秒）"""
    global _session, _session_path, _input_names
    if _session is not None and _session_path == model_path:
        return _session
    import onnxruntime as ort

    opts = ort.SessionOptions()
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    opts.intra_op_num_threads = 0
    _session = ort.InferenceSession(model_path, sess_options=opts, providers=["CPUExecutionProvider"])
    _input_names = tuple(i.name for i in _session.get_inputs())
    _session_path = model_path
    return _session


def describe_model(model_path: str) -> Dict[str, Any]:
    """打印模型的输入输出签名，便于确认接口（第一次调用时自动执行）"""
    sess = _load_session(model_path)
    return {
        "inputs": [
            {"name": i.name, "shape": [str(d) for d in i.shape], "type": i.type} for i in sess.get_inputs()
        ],
        "outputs": [
            {"name": o.name, "shape": [str(d) for d in o.shape], "type": o.type} for o in sess.get_outputs()
        ],
    }


def _prepare(img_bgr: np.ndarray, mask: np.ndarray, size: int = 512):
    """把原图与掩膜缩放/归一化成模型输入"""
    h, w = img_bgr.shape[:2]
    rgb = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    rgb_small = cv2.resize(rgb, (size, size), interpolation=cv2.INTER_AREA)
    mask_small = cv2.resize(mask, (size, size), interpolation=cv2.INTER_NEAREST)
    image = (rgb_small.astype(np.float32) / 255.0).transpose(2, 0, 1)[None, ...]
    m = (mask_small.astype(np.float32) > 127).astype(np.float32)[None, None, ...]
    return image, m, (h, w)


def lama_inpaint(img_bgr: np.ndarray, mask: np.ndarray, model_path: str) -> np.ndarray:
    """用 LaMa 修补掩膜区域，返回整图（掩膜外保持原像素）"""
    if not Path(model_path).is_file():
        raise RuntimeError("LaMa 模型文件不存在，请在设置里下载「去水印 · 精细模型」")
    if int(np.count_nonzero(mask)) == 0:
        raise RuntimeError("没有需要修补的区域")

    sess = _load_session(model_path)
    image, m, (h, w) = _prepare(img_bgr, mask)

    # 按输入形状匹配：3 通道的当图像，1 通道的当掩膜；名字里带 mask 的优先当掩膜
    feeds: Dict[str, Any] = {}
    remaining = [image, m]
    for spec in sess.get_inputs():
        shape = spec.shape
        is_mask = "mask" in spec.name.lower() or (len(shape) == 4 and str(shape[1]) == "1")
        pick = None
        for cand in remaining:
            if is_mask and cand.shape[1] == 1:
                pick = cand
                break
            if not is_mask and cand.shape[1] == 3:
                pick = cand
                break
        if pick is None:
            pick = remaining[0]
        feeds[spec.name] = pick
        remaining = [r for r in remaining if r is not pick]

    out = sess.run(None, feeds)[0]

    # 后处理：还原到 0~255 的 BGR，并缩放回原尺寸
    if out.ndim == 4:
        out = out[0]
    if out.shape[0] == 3:
        out = out.transpose(1, 2, 0)
    # 该模型的输出**已经是 0~255**（实测 min=71 / max=246），不要再乘 255：
    # 乘了会把 71~246 放大成 18105~62773，clip 之后整片饱和成纯白 ——
    # 表面现象是「修补区域变成一片死平」（高频能量为 0），根因就是这个量纲错误。
    out = np.clip(out, 0, 255).astype(np.uint8)
    out_bgr = cv2.cvtColor(out, cv2.COLOR_RGB2BGR)
    if out_bgr.shape[:2] != (h, w):
        out_bgr = cv2.resize(out_bgr, (w, h), interpolation=cv2.INTER_LANCZOS4)

    # 只把掩膜区域贴回去：区域外保持原像素，避免整图被重新编码而损失细节
    result = img_bgr.copy()
    sel = mask > 127
    result[sel] = out_bgr[sel]
    return result
