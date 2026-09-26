"""应用图标生成：一份原图产出多尺寸 PNG、ICO 与 SVG，并打包成 zip。

和 ToolKnit 的「图标生成器」对标，额外提供：
  · 圆角版本（可选，按比例缩放的圆角半径）
  · 各尺寸的体积与预览说明
  · 附带一份 Android / iOS / Web 常用尺寸对照表
"""

from __future__ import annotations

import io
import json
import zipfile
from pathlib import Path
from typing import Any, Dict, List, Optional

from PIL import Image, ImageDraw

# 桌面、Web、Android、iOS 常用尺寸
DEFAULT_SIZES = [16, 24, 32, 48, 64, 96, 128, 180, 192, 256, 512, 1024]

# 每个尺寸的典型用途，写进清单方便用户挑选
USAGE = {
    16: "浏览器标签页、通知图标",
    24: "工具栏、任务栏小图标",
    32: "Windows 任务栏、桌面小图标",
    48: "Windows 桌面图标",
    64: "应用列表、快捷键图标",
    96: "中等尺寸图标",
    128: "macOS 图标、商店列表",
    180: "iOS 主屏（Apple Touch Icon）",
    192: "Android 主屏（PWA）",
    256: "Windows 大图标、ICO 上限",
    512: "PWA 启动图、商店素材",
    1024: "App Store、高清矢量替代",
}


def _rounded(img: Image.Image, radius_percent: float) -> Image.Image:
    """给图片加圆角（保留透明通道）"""
    img = img.convert("RGBA")
    w, h = img.size
    radius = int(min(w, h) * max(0.0, min(50.0, radius_percent)) / 100)
    if radius <= 0:
        return img
    mask = Image.new("L", (w, h), 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle((0, 0, w, h), radius=radius, fill=255)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def generate_icons(
    file_path: str,
    output_path: str,
    sizes: Optional[List[int]] = None,
    rounded: float = 0,
    background: str = "",
) -> Dict[str, Any]:
    """生成多尺寸图标并打包。

    rounded 为圆角百分比（0 表示直角，22 大约是主流 App 图标的圆角观感）。
    background 可填 #RRGGBB，用于给透明图片垫底色（例如应用商店不接受透明）。
    """
    src = Path(file_path)
    try:
        img = Image.open(src)
        img.load()
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"无法读取图片：{exc}") from exc

    size_list = sorted({int(s) for s in (sizes or DEFAULT_SIZES) if 8 <= int(s) <= 4096}) or DEFAULT_SIZES

    # 统一成正方形：非正方形居中裁剪
    img = img.convert("RGBA")
    w, h = img.size
    if w != h:
        side = min(w, h)
        left = (w - side) // 2
        top = (h - side) // 2
        img = img.crop((left, top, left + side, top + side))

    if rounded and rounded > 0:
        img = _rounded(img, rounded)

    # 垫底色（如果需要）
    if background:
        hexcolor = background.lstrip("#")
        if len(hexcolor) == 6:
            rgb = tuple(int(hexcolor[i:i + 2], 16) for i in (0, 2, 4))
            base = Image.new("RGBA", img.size, (*rgb, 255))
            base.alpha_composite(img)
            img = base

    # 主图最大边至少 1024 才能保证大尺寸不糊；不够时按原始尺寸上限生成
    max_available = img.width

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    entries: List[Dict[str, Any]] = []
    ico_images: List[Image.Image] = []

    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as zf:
        for size in size_list:
            if size > max_available * 2:
                continue  # 放大超过两倍没有意义
            resized = img.resize((size, size), Image.LANCZOS)
            buf = io.BytesIO()
            resized.save(buf, format="PNG", optimize=True)
            data = buf.getvalue()
            zf.writestr(f"png/icon-{size}.png", data)
            entries.append({
                "size": size,
                "file": f"png/icon-{size}.png",
                "bytes": len(data),
                "usage": USAGE.get(size, "自定义尺寸"),
            })
            if size <= 256:
                ico_images.append(resized)

        # ICO：把 ≤256 的尺寸全部塞进一个文件（Windows 会自动挑合适的那张）
        ico_buf = io.BytesIO()
        if ico_images:
            base = ico_images[-1]
            base.save(ico_buf, format="ICO", sizes=[(im.width, im.height) for im in ico_images])
            zf.writestr("icon.ico", ico_buf.getvalue())

        # SVG 包装：把 512 的位图嵌进 SVG，方便需要矢量占位的场景直接引用
        svg_size = 512 if any(e["size"] == 512 for e in entries) else (entries[-1]["size"] if entries else 0)
        if svg_size:
            import base64

            buf = io.BytesIO()
            img.resize((svg_size, svg_size), Image.LANCZOS).save(buf, format="PNG", optimize=True)
            b64 = base64.b64encode(buf.getvalue()).decode("ascii")
            svg = (
                f'<svg xmlns="http://www.w3.org/2000/svg" width="{svg_size}" height="{svg_size}" '
                f'viewBox="0 0 {svg_size} {svg_size}">\n'
                f'  <image width="{svg_size}" height="{svg_size}" href="data:image/png;base64,{b64}"/>\n'
                f"</svg>\n"
            )
            zf.writestr("icon.svg", svg.encode("utf-8"))

        manifest = {
            "源文件": src.name,
            "原始尺寸": f"{w}x{h}",
            "生成尺寸数": len(entries),
            "圆角百分比": rounded,
            "底色": background or "保持透明",
            "文件明细": entries,
            "常见尺寸用途": {str(k): v for k, v in USAGE.items()},
        }
        zf.writestr("图标清单.json", json.dumps(manifest, ensure_ascii=False, indent=2))

    total = sum(e["bytes"] for e in entries)
    return {
        "success": True,
        "output": str(out),
        "count": len(entries),
        "sizes": [e["size"] for e in entries],
        "totalSize": total,
    }
