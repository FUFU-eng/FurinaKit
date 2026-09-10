"""
图片工具处理模块
参考 docsmall.com 的图片工具逻辑
"""
import os
import io
from typing import List, Dict, Any, Optional, Tuple
from PIL import Image, ImageSequence


def image_compress(file_path: str, output_path: str, quality: int = 75, max_width: Optional[int] = None) -> Dict[str, Any]:
    """压缩图片"""
    img = Image.open(file_path)
    original_size = os.path.getsize(file_path)
    
    if max_width and img.width > max_width:
        ratio = max_width / img.width
        new_height = int(img.height * ratio)
        img = img.resize((max_width, new_height), Image.LANCZOS)
    
    if img.mode in ("RGBA", "P"):
        img = img.convert("RGB")
    
    img.save(output_path, format="JPEG", quality=quality, optimize=True)
    compressed_size = os.path.getsize(output_path)
    ratio = (1 - compressed_size / original_size) * 100 if original_size > 0 else 0
    
    return {
        "success": True,
        "output": output_path,
        "original_size": original_size,
        "compressed_size": compressed_size,
        "ratio": round(ratio, 1)
    }


def image_crop(file_path: str, output_path: str, x: int, y: int, width: int, height: int) -> Dict[str, Any]:
    """裁剪图片"""
    img = Image.open(file_path)
    cropped = img.crop((x, y, x + width, y + height))
    cropped.save(output_path)
    return {"success": True, "output": output_path, "width": width, "height": height}


def image_resize(file_path: str, output_path: str, width: Optional[int] = None, height: Optional[int] = None, keep_ratio: bool = True) -> Dict[str, Any]:
    """调整图片尺寸"""
    img = Image.open(file_path)
    orig_w, orig_h = img.size
    
    if keep_ratio:
        if width and not height:
            ratio = width / orig_w
            height = int(orig_h * ratio)
        elif height and not width:
            ratio = height / orig_h
            width = int(orig_w * ratio)
        elif not width and not height:
            width, height = orig_w, orig_h
    else:
        width = width or orig_w
        height = height or orig_h
    
    resized = img.resize((width, height), Image.LANCZOS)
    resized.save(output_path)
    return {"success": True, "output": output_path, "width": width, "height": height}


def image_rotate(file_path: str, output_path: str, angle: float = 90, expand: bool = True) -> Dict[str, Any]:
    """旋转图片"""
    img = Image.open(file_path)
    rotated = img.rotate(angle, expand=expand, resample=Image.BICUBIC)
    rotated.save(output_path)
    return {"success": True, "output": output_path, "angle": angle}


def image_split(file_path: str, output_dir: str, rows: int = 2, cols: int = 2) -> Dict[str, Any]:
    """分割图片为网格，支持保持原图格式并安全处理透明通道"""
    img = Image.open(file_path)
    width, height = img.size
    cell_width = max(1, width // cols)
    cell_height = max(1, height // rows)
    outputs = []

    ext = os.path.splitext(file_path)[1].lower()
    if ext not in [".jpg", ".jpeg", ".png", ".webp"]:
        ext = ".png" if img.mode in ("RGBA", "P", "LA") else ".jpg"

    for r in range(rows):
        for c in range(cols):
            left = c * cell_width
            top = r * cell_height
            right = width if c == cols - 1 else left + cell_width
            bottom = height if r == rows - 1 else top + cell_height
            cell = img.crop((left, top, right, bottom))
            output_path = os.path.join(output_dir, f"part_{r+1}_{c+1}{ext}")

            if ext in [".jpg", ".jpeg"]:
                if cell.mode in ("RGBA", "P", "LA"):
                    bg = Image.new("RGB", cell.size, (255, 255, 255))
                    if cell.mode == "RGBA":
                        bg.paste(cell, mask=cell.split()[3])
                    else:
                        bg.paste(cell)
                    cell = bg
                elif cell.mode != "RGB":
                    cell = cell.convert("RGB")
                cell.save(output_path, format="JPEG", quality=95)
            elif ext == ".png":
                cell.save(output_path, format="PNG")
            elif ext == ".webp":
                cell.save(output_path, format="WEBP", quality=95)
            else:
                cell.save(output_path)

            outputs.append(output_path)

    return {"success": True, "outputs": outputs, "count": len(outputs)}


def image_to_jpg(file_path: str, output_path: str, quality: int = 95) -> Dict[str, Any]:
    """图片转 JPG"""
    img = Image.open(file_path)
    if img.mode in ("RGBA", "P", "LA"):
        background = Image.new("RGB", img.size, (255, 255, 255))
        if img.mode == "RGBA":
            background.paste(img, mask=img.split()[3])
        else:
            background.paste(img)
        img = background
    elif img.mode != "RGB":
        img = img.convert("RGB")
    
    img.save(output_path, format="JPEG", quality=quality)
    return {"success": True, "output": output_path}


def image_format_convert(file_path: str, output_path: str, format: str = "webp", quality: int = 90) -> Dict[str, Any]:
    """图片格式转换（支持 PNG/JPG/WebP/AVIF/BMP/TIFF/GIF）"""
    img = Image.open(file_path)
    
    format = format.lower()
    format_map = {
        "jpg": "JPEG",
        "jpeg": "JPEG",
        "png": "PNG",
        "webp": "WEBP",
        "avif": "AVIF",
        "tiff": "TIFF",
        "bmp": "BMP",
        "gif": "GIF",
    }
    
    pil_format = format_map.get(format, format.upper())
    
    # 处理透明背景
    if pil_format in ("JPEG", "BMP") and img.mode in ("RGBA", "P", "LA"):
        background = Image.new("RGB", img.size, (255, 255, 255))
        if img.mode == "RGBA":
            background.paste(img, mask=img.split()[3])
        else:
            background.paste(img)
        img = background
    elif pil_format == "JPEG" and img.mode != "RGB":
        img = img.convert("RGB")
    
    # 保存参数
    save_kwargs = {}
    if pil_format in ("JPEG", "WEBP"):
        save_kwargs["quality"] = quality
        save_kwargs["optimize"] = True
    elif pil_format == "PNG":
        save_kwargs["optimize"] = True
    
    img.save(output_path, format=pil_format, **save_kwargs)
    return {"success": True, "output": output_path, "format": format}


def gif_compress(file_path: str, output_path: str, quality: int = 75, max_width: Optional[int] = None) -> Dict[str, Any]:
    """压缩 GIF"""
    original_size = os.path.getsize(file_path)
    img = Image.open(file_path)
    
    frames = []
    for frame in ImageSequence.Iterator(img):
        frame = frame.convert("P", palette=Image.ADAPTIVE, colors=256)
        if max_width and frame.width > max_width:
            ratio = max_width / frame.width
            new_height = int(frame.height * ratio)
            frame = frame.resize((max_width, new_height), Image.LANCZOS)
        frames.append(frame)
    
    frames[0].save(
        output_path,
        save_all=True,
        append_images=frames[1:],
        loop=img.info.get("loop", 0),
        duration=img.info.get("duration", 100),
        optimize=True,
        quality=quality
    )
    
    compressed_size = os.path.getsize(output_path)
    ratio = (1 - compressed_size / original_size) * 100 if original_size > 0 else 0
    
    return {
        "success": True,
        "output": output_path,
        "original_size": original_size,
        "compressed_size": compressed_size,
        "ratio": round(ratio, 1)
    }


def gif_crop(file_path: str, output_path: str, x: int, y: int, width: int, height: int) -> Dict[str, Any]:
    """裁剪 GIF"""
    img = Image.open(file_path)
    frames = []
    
    for frame in ImageSequence.Iterator(img):
        cropped = frame.crop((x, y, x + width, y + height))
        frames.append(cropped)
    
    frames[0].save(
        output_path,
        save_all=True,
        append_images=frames[1:],
        loop=img.info.get("loop", 0),
        duration=img.info.get("duration", 100),
        optimize=True
    )
    
    return {"success": True, "output": output_path, "width": width, "height": height}



def image_to_ico(file_path: str, output_path: str, sizes: Optional[List[int]] = None) -> Dict[str, Any]:
    """图片转 ICO 图标（支持多尺寸，保持透明通道）"""
    img = Image.open(file_path)
    
    # 默认尺寸与去重排序
    if not sizes:
        sizes = [16, 24, 32, 48, 64, 128, 256]
    else:
        sizes = sorted(list(set([int(s) for s in sizes if int(s) > 0])))
        if not sizes:
            sizes = [16, 24, 32, 48, 64, 128, 256]
    
    # 确保图片是 RGBA 模式（保持透明）
    if img.mode != "RGBA":
        img = img.convert("RGBA")
    
    # 生成各个尺寸的图标
    icon_images = []
    for size in sizes:
        # 等比例缩放，居中裁剪为正方形
        w, h = img.size
        if w != h:
            min_dim = min(w, h)
            left = (w - min_dim) // 2
            top = (h - min_dim) // 2
            img_cropped = img.crop((left, top, left + min_dim, top + min_dim))
        else:
            img_cropped = img.copy()
        
        # 缩放到目标尺寸
        if img_cropped.size != (size, size):
            img_resized = img_cropped.resize((size, size), Image.LANCZOS)
        else:
            img_resized = img_cropped
        
        icon_images.append(img_resized)
    
    # 保存为 ICO
    if len(icon_images) == 1:
        icon_images[0].save(output_path, format="ICO", sizes=[(sizes[0], sizes[0])])
    else:
        icon_images[0].save(
            output_path,
            format="ICO",
            sizes=[(s, s) for s in sizes],
            append_images=icon_images[1:]
        )
    
    return {"success": True, "output": output_path, "sizes": sizes}



def image_watermark(file_path: str, output_path: str, text: str,
                    position: str = "bottom-right", font_size: int = 36,
                    opacity: int = 50, color: str = "#ffffff",
                    rotate: float = 0, x_percent: float = -1, y_percent: float = -1) -> Dict[str, Any]:
    """给图片添加文字水印（支持相对坐标所见即所得与旋转）"""
    from PIL import ImageDraw, ImageFont
    import math

    img = Image.open(file_path).convert("RGBA")
    width, height = img.size

    # 创建透明图层用于绘制水印
    overlay = Image.new("RGBA", img.size, (0, 0, 0, 0))
    draw = ImageDraw.Draw(overlay)

    # 尝试加载字体，优先使用系统中文字体
    font = None
    font_candidates = [
        r"C:\Windows\Fonts\msyh.ttc",
        r"C:\Windows\Fonts\msyhbd.ttc",
        r"C:\Windows\Fonts\simhei.ttf",
        r"C:\Windows\Fonts\simsun.ttc",
        r"C:\Windows\Fonts\arial.ttf",
    ]
    for fp in font_candidates:
        if os.path.exists(fp):
            try:
                font = ImageFont.truetype(fp, font_size)
                break
            except Exception:
                continue
    if font is None:
        font = ImageFont.load_default()

    # 计算文字尺寸
    try:
        bbox = draw.textbbox((0, 0), text, font=font)
        text_w = bbox[2] - bbox[0]
        text_h = bbox[3] - bbox[1]
    except Exception:
        text_w = len(text) * font_size
        text_h = font_size

    # 解析颜色
    color = color.lstrip("#")
    if len(color) == 6:
        r = int(color[0:2], 16)
        g = int(color[2:4], 16)
        b = int(color[4:6], 16)
    else:
        r, g, b = 255, 255, 255
    alpha = int(255 * (opacity / 100.0))

    # 计算位置：如果有前端传递的百分比坐标（所见即所得拖拽），优先根据百分比居中锚定
    if x_percent >= 0 and y_percent >= 0:
        x = int(width * (x_percent / 100.0) - text_w / 2)
        y = int(height * (y_percent / 100.0) - text_h / 2)
    else:
        # 自适应边距：根据图片尺寸比例计算，高分辨率大图不会缩在微小边缘
        margin = max(20, int(min(width, height) * 0.03))
        if position == "top-left":
            x, y = margin, margin
        elif position == "top-center":
            x, y = (width - text_w) // 2, margin
        elif position == "top-right":
            x, y = width - text_w - margin, margin
        elif position == "center":
            x, y = (width - text_w) // 2, (height - text_h) // 2
        elif position == "bottom-left":
            x, y = margin, height - text_h - margin
        elif position == "bottom-center":
            x, y = (width - text_w) // 2, height - text_h - margin
        else:  # bottom-right
            x, y = width - text_w - margin, height - text_h - margin

    # 旋转水印（CSS 中的 rotate 是顺时针，PIL 是逆时针，取反以保持所见即所得一致）
    if rotate != 0:
        diag = int(math.sqrt(text_w**2 + text_h**2)) + 20
        txt_layer = Image.new("RGBA", (diag, diag), (0, 0, 0, 0))
        txt_draw = ImageDraw.Draw(txt_layer)
        txt_draw.text(((diag - text_w) // 2, (diag - text_h) // 2),
                       text, font=font, fill=(r, g, b, alpha))
        # 取 -rotate 与前端 CSS rotate(deg) 顺时针方向一致
        txt_layer = txt_layer.rotate(-rotate, expand=True, resample=Image.BICUBIC)
        paste_x = x - (txt_layer.width - text_w) // 2
        paste_y = y - (txt_layer.height - text_h) // 2
        overlay.paste(txt_layer, (paste_x, paste_y), txt_layer)
    else:
        draw.text((x, y), text, font=font, fill=(r, g, b, alpha))

    # 合并图层
    result = Image.alpha_composite(img, overlay)

    # 根据输出格式保存
    ext = os.path.splitext(output_path)[1].lower()
    if ext in (".jpg", ".jpeg"):
        result = result.convert("RGB")
        result.save(output_path, format="JPEG", quality=95)
    elif ext == ".webp":
        result.save(output_path, format="WEBP", quality=95)
    else:
        result.save(output_path, format="PNG")

    return {"success": True, "output": output_path}
