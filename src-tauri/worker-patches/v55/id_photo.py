"""证件照制作。

做三件事，全部在本机完成：
  1. **抠人像**：复用项目已有的 ISNet 抠图模型（与「图片换背景」同一个模型文件）；
  2. **换背景**：按证件照常见的白底 / 蓝底 / 红底 / 灰底填充；
  3. **按规格裁切**：按国标尺寸（一寸 25×35mm 等）以 300dpi 输出**精确像素**，
     并按证件照惯例对齐头部（头顶留白 + 头部占比），可选在 6 寸相纸上排版多张。

设计约定（与项目其它 worker 模块一致）：对外报错一律中文人话。

证件照尺寸（毫米，300dpi 下的像素）：
  一寸 25×35mm → 295×413
  大一寸 33×48mm → 390×567
  小一寸 22×32mm → 260×378
  二寸 35×49mm → 413×579
  小二寸 35×45mm → 413×531
  大二寸 35×53mm → 413×626
  护照 33×48mm → 390×567
标准依据是常见的证件照规格表（mm × dpi/25.4 取整）。
"""

from __future__ import annotations

import os
from pathlib import Path
from typing import Any, Dict, List, Tuple

# 规格表：名称 → (宽 mm, 高 mm)
SPECS: Dict[str, Tuple[float, float]] = {
    "one": (25.0, 35.0),      # 一寸
    "one-big": (33.0, 48.0),  # 大一寸
    "one-small": (22.0, 32.0),# 小一寸
    "two": (35.0, 49.0),      # 二寸
    "two-small": (35.0, 45.0),# 小二寸
    "two-big": (35.0, 53.0),  # 大二寸
    "passport": (33.0, 48.0), # 护照
}

SPEC_LABEL = {
    "one": "一寸（25×35mm）",
    "one-big": "大一寸（33×48mm）",
    "one-small": "小一寸（22×32mm）",
    "two": "二寸（35×49mm）",
    "two-small": "小二寸（35×45mm）",
    "two-big": "大二寸（35×53mm）",
    "passport": "护照（33×48mm）",
}

BG_COLORS: Dict[str, Tuple[int, int, int]] = {
    "white": (255, 255, 255),
    "blue": (67, 142, 219),   # 证件照标准蓝
    "red": (214, 58, 58),     # 证件照标准红
    "gray": (221, 221, 221),
}

DPI = 300


class IdPhotoError(Exception):
    """可以直接展示给用户的中文错误。"""


def mm_to_px(mm: float, dpi: int = DPI) -> int:
    return int(round(mm / 25.4 * dpi))


def _load_model_path() -> str:
    comp = os.environ.get("FURINAKIT_COMPONENTS_DIR") or os.path.join(
        os.getcwd(), "..", "..", "apps", "web", "components"
    )
    for name in ("isnet-general-use.onnx", "u2net.onnx", "u2net_human_seg.onnx"):
        p = os.path.join(comp, name)
        if os.path.isfile(p):
            return p
    raise IdPhotoError("还没下载抠图模型。请先在「图片换背景」工具页上方（或设置里的「按需下载组件」）下载后重试")


def make_id_photo(path: str, opts: Dict[str, Any], out_path: str) -> Dict[str, Any]:
    import numpy as np
    import cv2
    from PIL import Image

    if not os.path.isfile(path):
        raise IdPhotoError("找不到这张照片")

    spec = str(opts.get("spec", "one"))
    if spec not in SPECS:
        spec = "one"
    bg_key = str(opts.get("bg", "white"))
    if bg_key not in BG_COLORS:
        bg_key = "white"
    head_ratio = float(opts.get("headRatio", 0.62) or 0.62)  # 头部高度占整张照片的比例
    top_margin = float(opts.get("topMargin", 0.08) or 0.08)  # 头顶留白比例
    layout = str(opts.get("layout", False)).strip().lower() in ("yes", "true", "1", "8")                 # 是否在 6 寸相纸上排版
    feather = int(opts.get("feather", 2) or 0)               # 边缘羽化半径

    w_mm, h_mm = SPECS[spec]
    out_w, out_h = mm_to_px(w_mm), mm_to_px(h_mm)

    img = cv2.imdecode(np.fromfile(path, dtype=np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise IdPhotoError("这张图片读不出来（可能格式不对或文件损坏）")

    # ── ① 抠人像 ───────────────────────────────────────────────────
    from app.tools import isnet_matting

    alpha = isnet_matting.alpha_with_model(img, _load_model_path())
    if feather > 0:
        alpha = cv2.GaussianBlur(alpha, (feather * 2 + 1, feather * 2 + 1), 0)

    # Only change the background in the original coordinate system. Do not guess head
    # size or reframe the alpha bounding box: that moved the user's subject into the middle.
    if not np.any(alpha > 24):
        raise IdPhotoError("没能识别人像，请换一张背景清晰的照片")
    crop = img
    crop_a = alpha

    # ── ③ 换底色并缩放到精确像素 ───────────────────────────────────
    rgb = cv2.cvtColor(crop, cv2.COLOR_BGR2RGB)
    bg = np.zeros_like(rgb)
    bg[:, :] = BG_COLORS[bg_key]
    a = (crop_a.astype(np.float32) / 255.0)[:, :, None]
    merged = (rgb.astype(np.float32) * a + bg.astype(np.float32) * (1 - a)).astype(np.uint8)

    out_img = Image.fromarray(merged, "RGB").resize((out_w, out_h), Image.LANCZOS)

    layout_count = 1
    if layout:
        # Landscape 6-inch paper. Try both photo orientations, without shrinking print size.
        # The old 2-column/4-row arrangement could not fit even one-inch photos vertically,
        # then silently returned the single photo instead of a sheet.
        sheet_w, sheet_h = mm_to_px(152), mm_to_px(102)
        margin = mm_to_px(3)
        candidates = []
        for rotated in (False, True):
            tw, th = (out_h, out_w) if rotated else (out_w, out_h)
            for cols in range(1, 9):
                for rows in range(1, 9):
                    count = cols * rows
                    if count > 8 or count < 1:
                        continue
                    if cols * tw + (cols + 1) * margin <= sheet_w and rows * th + (rows + 1) * margin <= sheet_h:
                        candidates.append((count, not rotated, cols, rows, rotated))
        if not candidates:
            raise IdPhotoError("此规格无法放入6寸相纸，请选择单张输出")
        layout_count, _, cols, rows, rotated = max(candidates)
        tile = out_img.transpose(Image.Transpose.ROTATE_90) if rotated else out_img
        tw, th = tile.size
        gx, gy = (sheet_w-cols*tw)//(cols+1), (sheet_h-rows*th)//(rows+1)
        sheet = Image.new("RGB", (sheet_w, sheet_h), (255,255,255))
        from PIL import ImageDraw
        draw = ImageDraw.Draw(sheet)
        for row in range(rows):
            for col in range(cols):
                x, y = gx*(col+1)+tw*col, gy*(row+1)+th*row
                sheet.paste(tile, (x,y))
                draw.rectangle((x-1,y-1,x+tw,y+th),outline=(200,200,200))
        out_img = sheet

    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    out_img.save(out_path, "JPEG", quality=95, dpi=(DPI, DPI))

    return {
        "success": True,
        "output": out_path,
        "width": out_img.width,
        "height": out_img.height,
        "specLabel": SPEC_LABEL[spec] + (f" · 6寸相纸排版{layout_count}张" if layout else " · 保留原构图"),
        "bgLabel": {"white": "白底", "blue": "蓝底", "red": "红底", "gray": "灰底"}[bg_key],
    }
