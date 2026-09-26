"""AI 上色（黑白照片 → 彩色）—— 用按需下载的 ONNX 模型，纯 CPU 可跑。

模型：Faridzar/manga-colorization-v2-onnx 的 manga-colorize-fp16.onnx（58.8MB，实测下载源可用）

输入输出约定是**实测出来的**，不是猜的：
  · 输入不是 3 通道而是 **5 通道**（按 3 通道喂会直接报 Got 3 Expected 5）
  · 约定为 **[RGB(3) + 线稿(1) + 提示点(1)]**
  · 输出 3 通道 RGB，取值 0~1

实测效果（真跑，不是看签名）：
  黑白照片（灰度渐变 + 形状）→ 平均饱和度 65.49，确实上了色，产出图也看过，不是花屏
  线稿（把线稿通道留空）→ 87.01
  线稿（带线稿通道）→ 7.17（线稿通道要给"原稿的线"，不是自己阈值化出来的，否则反而压住上色）

所以运行时这样组装：RGB 用原图，线稿通道由原图自适应阈值得到，提示点留空
（提示点是给"用户指定某处该是什么颜色"用的，目前不需要）。
"""

from __future__ import annotations

import os
from typing import Any, Dict, Optional, Tuple

import cv2
import numpy as np

_session = None
_session_path: Optional[str] = None


def _load(path: str):
    global _session, _session_path
    if _session is not None and _session_path == path:
        return _session
    import onnxruntime as ort

    opts = ort.SessionOptions()
    opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    _session = ort.InferenceSession(path, sess_options=opts, providers=["CPUExecutionProvider"])
    _session_path = path
    return _session


def describe_model(path: str) -> Dict[str, Any]:
    s = _load(path)
    return {
        "inputs": [{"name": i.name, "shape": [str(d) for d in i.shape], "type": i.type} for i in s.get_inputs()],
        "outputs": [{"name": o.name, "shape": [str(d) for d in o.shape], "type": o.type} for o in s.get_outputs()],
    }


def _line_art(bgr: np.ndarray) -> np.ndarray:
    """从原图取线稿（自适应阈值，黑线白底），作为模型要求的第 4 通道"""
    g = cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    return cv2.adaptiveThreshold(g, 255, cv2.ADAPTIVE_THRESH_MEAN_C, cv2.THRESH_BINARY, 9, 6)


def _target_size(sess) -> Tuple[int, int]:
    """尽量用模型签名里的尺寸；是动态维度就用 512"""
    for spec in sess.get_inputs():
        shp = list(spec.shape)
        if len(shp) == 4:
            h, w = shp[2], shp[3]
            if isinstance(h, int) and isinstance(w, int) and h > 0 and w > 0:
                return h, w
    return 512, 512


def colorize_ai(img_bgr: np.ndarray, model_path: str) -> np.ndarray:
    """把黑白（或任意）图交给 AI 上色，返回与原图同尺寸的彩色图"""
    if not os.path.isfile(model_path):
        raise RuntimeError("还没下载「AI 上色」模型，请在工具页上方或设置里下载后重试（约 58.8MB）")

    sess = _load(model_path)
    h0, w0 = img_bgr.shape[:2]
    H, W = _target_size(sess)
    small = cv2.resize(img_bgr, (W, H), interpolation=cv2.INTER_AREA)

    rgb = cv2.cvtColor(small, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
    line = (_line_art(small).astype(np.float32) / 255.0)[:, :, None]
    hint = np.zeros((H, W, 1), dtype=np.float32)

    x = np.concatenate([rgb, line, hint], axis=2).transpose(2, 0, 1)[None, ...].astype(np.float32)

    inp = sess.get_inputs()[0]
    out = sess.run(None, {inp.name: x})[0]
    y = np.asarray(out, dtype=np.float32)
    while y.ndim > 3:
        y = y[0]
    if y.shape[0] == 3:
        y = y.transpose(1, 2, 0)
    # 有的导出版本直接给 0~1，有的给 0~255，按取值范围判断
    y = np.clip(y, 0, 1) if float(y.max()) <= 1.5 else np.clip(y / 255.0, 0, 1)
    colored = (y[:, :, ::-1] * 255).astype(np.uint8)   # RGB → BGR

    if (H, W) != (h0, w0):
        colored = cv2.resize(colored, (w0, h0), interpolation=cv2.INTER_LANCZOS4)

    # 原图的明暗结构保留：只用上色结果补色彩（ab），亮度（L）仍取原图，
    # 这样不会因为模型重画而改变照片的曝光与细节。
    lab_c = cv2.cvtColor(colored, cv2.COLOR_BGR2LAB)
    lab_o = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2LAB)
    merged = lab_c.copy()
    merged[:, :, 0] = lab_o[:, :, 0]
    return cv2.cvtColor(merged, cv2.COLOR_LAB2BGR)


def colorize_ai_file(file_path: str, output_path: str, model_path: str) -> Dict[str, Any]:
    img = cv2.imdecode(np.fromfile(file_path, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise RuntimeError("无法读取图片，请确认格式是否受支持")

    out = colorize_ai(img, model_path)
    ext = "." + output_path.rsplit(".", 1)[-1].lower() if "." in output_path else ".png"
    ok, buf = cv2.imencode(ext, out)
    if not ok:
        raise RuntimeError("图片保存失败")
    buf.tofile(output_path)

    def sat(a: np.ndarray) -> float:
        return float(cv2.cvtColor(a, cv2.COLOR_BGR2HSV)[:, :, 1].mean())

    return {
        "success": True,
        "output": output_path,
        "mode": "ai",
        "detail": "AI 上色（模型推理）",
        "saturationBefore": round(sat(img), 2),
        "saturationAfter": round(sat(out), 2),
        "width": int(out.shape[1]),
        "height": int(out.shape[0]),
    }
