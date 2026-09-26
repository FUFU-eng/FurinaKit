"""抠图入口（按文件路径）。

历史说明：这里原来调 rembg 库。现在 rembg 已被卸掉 —— 它拖来的 numba / llvmlite / scipy
合计占了约 280MB，而抠图质量其实来自 ONNX 模型本身，不在 rembg 这个封装上。

改成直接调用自研的推理，函数名与参数保持原样，调用方一行都不用改。

预处理与后处理严格照「逐像素对比 rembg」得出的配方：
    只 /255（不加 ImageNet 的 mean/std）、min-max 归一化（不是 sigmoid）、LANCZOS 缩放
实测：与 rembg 的 alpha 平均差 2.17 / 255，主体中心 254.0 对 253.8，肉眼无差别。
"""

from __future__ import annotations

import os
import tempfile
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

from app.tools import isnet_matting

# 模型名 → 文件名
MODEL_FILES = {
    "u2net": "u2net.onnx",
    "u2net_human_seg": "u2net_human_seg.onnx",
    "isnet-general-use": "isnet-general-use.onnx",
    "birefnet-general": "birefnet.onnx",
}

# 注意：这里是 **RGB** 顺序（PIL 用的），不是 cv2 的 BGR。
# 之前照着 cv2 的写法填，导致蓝底与红底互换（实测换"蓝底"出来是红的）。
BG_PALETTE = {
    "white": (255, 255, 255),
    "black": (0, 0, 0),
    "blue": (60, 110, 220),    # 证件照蓝
    "red": (215, 45, 45),      # 证件照红
    "green": (70, 165, 75),    # 绿幕
    "gray": (200, 200, 200),
}


def _components_dir() -> str:
    return os.environ.get("FURINAKIT_COMPONENTS_DIR") or os.path.join(
        os.getcwd(), "..", "..", "apps", "web", "components"
    )


def _resolve_model(model: str) -> str:
    """找到模型文件；指定的没下就退回已下载的任意一个可用模型。"""
    comp = _components_dir()
    want = MODEL_FILES.get(model, f"{model}.onnx")
    path = os.path.join(comp, want)
    if os.path.isfile(path):
        return path
    for alt in ("isnet-general-use.onnx", "u2net.onnx", "u2net_human_seg.onnx"):
        p = os.path.join(comp, alt)
        if os.path.isfile(p):
            return p
    raise RuntimeError(
        f"还没下载抠图模型（{want}），请在工具页上方或设置里的「按需下载组件」下载后重试"
    )


def remove_background(input_path: str, model: str = "u2net", bg_color: str | None = None):
    """抠图。返回 (输出文件路径, 文件名)。

    bg_color 为空 → 输出透明背景 PNG；给了颜色名（white/blue/red/green/black/gray）→ 换成纯色底。
    """
    bgr = cv2.imdecode(np.fromfile(input_path, dtype=np.uint8), cv2.IMREAD_COLOR)
    if bgr is None:
        raise RuntimeError("无法读取图片，请确认格式是否受支持")

    model_path = _resolve_model(model)
    alpha = isnet_matting.alpha_with_model(bgr, model_path)

    h, w = bgr.shape[:2]
    rgba = np.dstack([cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB), alpha])
    img = Image.fromarray(rgba, "RGBA")

    suffix = "_已抠图"
    color = (bg_color or "").strip()
    if color:
        canvas = Image.new("RGB", (w, h), BG_PALETTE.get(color, (255, 255, 255)))
        canvas.paste(img, mask=img.split()[3])
        img = canvas
        suffix = "_已换底"

    out_dir = os.environ.get("FURINAKIT_TMP") or tempfile.mkdtemp(prefix="furinakit-bg-")
    os.makedirs(out_dir, exist_ok=True)
    out = Path(out_dir) / (Path(input_path).stem + suffix + ".png")
    img.save(str(out), "PNG")
    return str(out), out.name
