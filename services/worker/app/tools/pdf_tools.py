"""
PDF 工具处理模块
参考 docsmall.com 的 PDF 工具逻辑
"""
import os
import io
import math
import tempfile
import logging
from typing import List, Dict, Any, Optional
import pymupdf as fitz
from PIL import Image, ImageSequence

logger = logging.getLogger("furinakit.pdf")


def pdf_merge(files: List[str], output_path: str) -> Dict[str, Any]:
    """合并多个 PDF 文件"""
    result = fitz.open()
    for file_path in files:
        doc = fitz.open(file_path)
        result.insert_pdf(doc)
        doc.close()
    pages = result.page_count
    result.save(output_path)
    result.close()
    return {"success": True, "output": output_path, "pages": pages}


def pdf_split(file_path: str, ranges: str, output_dir: str) -> Dict[str, Any]:
    """
    分割 PDF
    ranges 格式: "1-3,5,7-9"
    """
    doc = fitz.open(file_path)
    total_pages = len(doc)
    outputs = []
    
    # 解析范围
    parts = ranges.split(",")
    for i, part in enumerate(parts):
        part = part.strip()
        if "-" in part:
            start, end = part.split("-")
            start = max(1, int(start.strip()))
            end = min(total_pages, int(end.strip()))
        else:
            start = end = max(1, min(total_pages, int(part.strip())))
        
        if start > end:
            continue
            
        new_doc = fitz.open()
        new_doc.insert_pdf(doc, from_page=start-1, to_page=end-1)
        output_path = os.path.join(output_dir, f"part_{i+1}_pages_{start}-{end}.pdf")
        new_doc.save(output_path)
        new_doc.close()
        outputs.append(output_path)
    
    doc.close()
    return {"success": True, "outputs": outputs, "count": len(outputs)}


def pdf_compress(file_path: str, output_path: str, quality: int = 75) -> Dict[str, Any]:
    """压缩 PDF（压缩图片）"""
    doc = fitz.open(file_path)
    original_size = os.path.getsize(file_path)
    
    for page in doc:
        images = page.get_images(full=True)
        for img_index, img in enumerate(images):
            xref = img[0]
            try:
                base_image = doc.extract_image(xref)
                image_bytes = base_image["image"]
                image_ext = base_image["ext"]
                
                # 用 Pillow 压缩图片
                img_pil = Image.open(io.BytesIO(image_bytes))
                if img_pil.mode in ("RGBA", "P"):
                    img_pil = img_pil.convert("RGB")
                
                output_buffer = io.BytesIO()
                img_pil.save(output_buffer, format="JPEG", quality=quality, optimize=True)
                compressed_bytes = output_buffer.getvalue()
                
                # 替换图片
                page.replace_image(xref, stream=compressed_bytes)
            except Exception as e:
                logger.warning("压缩图片失败: %s", e)
                continue
    
    doc.save(output_path, garbage=4, deflate=True)
    doc.close()
    
    compressed_size = os.path.getsize(output_path)
    ratio = (1 - compressed_size / original_size) * 100 if original_size > 0 else 0
    
    return {
        "success": True,
        "output": output_path,
        "original_size": original_size,
        "compressed_size": compressed_size,
        "ratio": round(ratio, 1)
    }


def pdf_rotate(file_path: str, output_path: str, rotation: int = 90, pages: Optional[str] = None) -> Dict[str, Any]:
    """
    旋转 PDF 页面
    rotation: 90, 180, 270
    pages: "all" 或 "1,3,5-7"
    """
    doc = fitz.open(file_path)
    total_pages = len(doc)
    
    # 解析要旋转的页面
    if pages is None or pages == "all":
        target_pages = list(range(1, total_pages + 1))
    else:
        target_pages = []
        parts = pages.split(",")
        for part in parts:
            part = part.strip()
            if "-" in part:
                start, end = part.split("-")
                target_pages.extend(range(int(start.strip()), int(end.strip()) + 1))
            else:
                target_pages.append(int(part.strip()))
    
    for page_num in target_pages:
        if 1 <= page_num <= total_pages:
            page = doc[page_num - 1]
            page.set_rotation((page.rotation + rotation) % 360)
    
    doc.save(output_path)
    doc.close()
    return {"success": True, "output": output_path, "rotated_pages": len(target_pages)}


def pdf_delete_pages(file_path: str, output_path: str, pages: str) -> Dict[str, Any]:
    """
    删除指定页面
    pages: "1,3,5-7"
    """
    doc = fitz.open(file_path)
    total_pages = len(doc)
    
    # 解析要删除的页面
    pages_to_delete = set()
    parts = pages.split(",")
    for part in parts:
        part = part.strip()
        if "-" in part:
            start, end = part.split("-")
            pages_to_delete.update(range(int(start.strip()) - 1, int(end.strip())))
        else:
            pages_to_delete.add(int(part.strip()) - 1)
    
    # 按从大到小删除，避免索引偏移
    deleted_count = 0
    for page_num in sorted(pages_to_delete, reverse=True):
        if 0 <= page_num < total_pages:
            doc.delete_page(page_num)
            deleted_count += 1
    
    doc.save(output_path)
    doc.close()
    return {
        "success": True,
        "output": output_path,
        "deleted": deleted_count,
        "remaining": total_pages - deleted_count,
    }


def pdf_reorder_pages(file_path: str, output_path: str, order: str) -> Dict[str, Any]:
    """
    重新排列页面顺序
    order: "3,1,2,4" （新的页面顺序，从1开始）
    """
    doc = fitz.open(file_path)
    total_pages = len(doc)
    
    # 解析新顺序
    new_order = [int(x.strip()) - 1 for x in order.split(",") if x.strip()]
    
    # 验证
    if len(new_order) != total_pages:
        return {"success": False, "error": f"需要 {total_pages} 个页码，实际提供 {len(new_order)} 个"}
    
    if min(new_order) < 0 or max(new_order) >= total_pages:
        return {"success": False, "error": "页码超出范围"}
    
    # 创建新文档并按新顺序插入
    new_doc = fitz.open()
    for page_idx in new_order:
        new_doc.insert_pdf(doc, from_page=page_idx, to_page=page_idx)
    
    new_doc.save(output_path)
    new_doc.close()
    doc.close()
    return {"success": True, "output": output_path, "pages": total_pages}


def pdf_to_images(file_path: str, output_dir: str, format: str = "png", dpi: int = 150) -> Dict[str, Any]:
    """将 PDF 每页转为图片"""
    doc = fitz.open(file_path)
    total_pages = len(doc)
    outputs = []
    
    zoom = dpi / 72
    matrix = fitz.Matrix(zoom, zoom)
    
    for i, page in enumerate(doc):
        pix = page.get_pixmap(matrix=matrix)
        output_path = os.path.join(output_dir, f"page_{i+1:03d}.{format}")
        pix.save(output_path)
        outputs.append(output_path)
    
    doc.close()
    return {"success": True, "outputs": outputs, "count": total_pages, "format": format, "dpi": dpi}


def images_to_pdf(files: List[str], output_path: str, page_size: str = "a4", orientation: str = "portrait") -> Dict[str, Any]:
    """
    将多张图片合并为 PDF。
    动图 GIF 逐帧展开：每一帧单独生成一页，完整保留动画内容。
    page_size: a4, letter, original
    orientation: portrait, landscape
    """
    if page_size == "a4":
        width, height = 595, 842
    elif page_size == "letter":
        width, height = 612, 792
    else:
        width, height = None, None
    
    if orientation == "landscape" and width and height:
        width, height = height, width
    
    doc = fitz.open()
    total_pages = 0
    
    for file_path in files:
        img = Image.open(file_path)
        # 判断是否为动图：n_frames > 1 即动画 GIF
        n_frames = getattr(img, "n_frames", 1)
        frames = list(ImageSequence.Iterator(img)) if n_frames > 1 else [img]
        
        for frame in frames:
            # 统一转为 RGB（透明像素垫白底），保证每帧都能可靠嵌入 PDF
            if frame.mode in ("RGBA", "LA") or (frame.mode == "P" and "transparency" in frame.info):
                rgba = frame.convert("RGBA")
                background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
                background.alpha_composite(rgba)
                frame = background.convert("RGB")
            elif frame.mode != "RGB":
                frame = frame.convert("RGB")
            
            fw, fh = frame.size
            
            if width and height:
                # 固定页面大小，图片居中缩放
                page = doc.new_page(width=width, height=height)
                scale = min(width / fw, height / fh) * 0.9
                new_width = fw * scale
                new_height = fh * scale
                x = (width - new_width) / 2
                y = (height - new_height) / 2
                rect = fitz.Rect(x, y, x + new_width, y + new_height)
            else:
                # 原始图片大小
                page = doc.new_page(width=fw, height=fh)
                rect = fitz.Rect(0, 0, fw, fh)
            
            # 优先以 JPEG 格式嵌入，极大降低输出体积（对包含透明通道的图片使用优化 PNG）
            has_alpha = frame.mode in ("RGBA", "LA") or (frame.mode == "P" and "transparency" in getattr(frame, "info", {}))
            img_buffer = io.BytesIO()
            if has_alpha:
                frame.save(img_buffer, format="PNG", optimize=True)
            else:
                frame.save(img_buffer, format="JPEG", quality=90, optimize=True)
            page.insert_image(rect, stream=img_buffer.getvalue())
            total_pages += 1
        
        img.close()
    
    doc.save(output_path, garbage=4, deflate=True)
    doc.close()
    return {"success": True, "output": output_path, "images": len(files), "pages": total_pages}


def pdf_unlock(file_path: str, output_path: str, password: str = "") -> Dict[str, Any]:
    """解锁 PDF（移除密码和权限限制）"""
    doc = fitz.open(file_path)
    
    if doc.is_encrypted:
        if not password:
            # 尝试空密码
            if not doc.authenticate(""):
                doc.close()
                return {"success": False, "error": "PDF 已加密，需要提供密码"}
        else:
            if not doc.authenticate(password):
                doc.close()
                return {"success": False, "error": "密码错误"}
    
    # 保存为未加密的 PDF
    doc.save(output_path, encryption=fitz.PDF_ENCRYPT_NONE)
    doc.close()
    return {"success": True, "output": output_path}


def pdf_encrypt(file_path: str, output_path: str, user_password: str = "", owner_password: str = "", 
                allow_print: bool = True, allow_copy: bool = True) -> Dict[str, Any]:
    """加密 PDF（添加密码和权限限制）"""
    doc = fitz.open(file_path)
    
    permissions = 0
    if allow_print:
        permissions |= fitz.PDF_PERM_PRINT
    if allow_copy:
        permissions |= fitz.PDF_PERM_COPY
    permissions |= fitz.PDF_PERM_ANNOTATE
    permissions |= fitz.PDF_PERM_FORM
    
    doc.save(
        output_path,
        encryption=fitz.PDF_ENCRYPT_AES_256,
        user_pw=user_password,
        owner_pw=owner_password or user_password,
        permissions=permissions
    )
    doc.close()
    return {"success": True, "output": output_path, "has_password": bool(user_password)}


def pdf_add_watermark(file_path: str, output_path: str, text: str = "CONFIDENTIAL", 
                      font_size: int = 40, opacity: float = 0.3, rotation: int = 45) -> Dict[str, Any]:
    """给 PDF 添加文字水印（支持任意旋转角度）"""
    doc = fitz.open(file_path)
    angle = math.radians(rotation % 360)
    # 旋转矩阵：pymupdf 的 insert_text 的 rotate 参数只支持 0/90/180/270，
    # 这里用 morph 实现任意角度（如 45 度）的斜向水印。
    rot_matrix = fitz.Matrix(math.cos(angle), math.sin(angle), -math.sin(angle), math.cos(angle), 0, 0)
    
    for page in doc:
        rect = page.rect
        center = fitz.Point(rect.width / 2, rect.height / 2)
        page.insert_text(
            center,
            text,
            fontsize=font_size,
            fontname="helv",
            color=(0.5, 0.5, 0.5),
            fill_opacity=opacity,
            morph=(center, rot_matrix),
        )
    
    doc.save(output_path)
    doc.close()
    return {"success": True, "output": output_path, "watermark": text}


def pdf_add_page_numbers(file_path: str, output_path: str, position: str = "bottom-center", 
                          font_size: int = 12, start_from: int = 1) -> Dict[str, Any]:
    """给 PDF 添加页码"""
    doc = fitz.open(file_path)
    
    for i, page in enumerate(doc):
        page_num = i + start_from
        rect = page.rect
        
        # 根据位置计算坐标
        margin = 36
        if position == "bottom-center":
            x = rect.width / 2 - 10
            y = rect.height - margin
        elif position == "bottom-left":
            x = margin
            y = rect.height - margin
        elif position == "bottom-right":
            x = rect.width - margin - 20
            y = rect.height - margin
        elif position == "top-center":
            x = rect.width / 2 - 10
            y = margin
        elif position == "top-left":
            x = margin
            y = margin
        elif position == "top-right":
            x = rect.width - margin - 20
            y = margin
        else:
            x = rect.width / 2 - 10
            y = rect.height - margin
        
        page.insert_text(
            (x, y),
            str(page_num),
            fontsize=font_size,
            fontname="helv",
            color=(0, 0, 0)
        )
    
    pages = len(doc)
    doc.save(output_path)
    doc.close()
    return {"success": True, "output": output_path, "pages": pages}


def pdf_extract_images(file_path: str, output_dir: str) -> Dict[str, Any]:
    """从 PDF 中提取所有图片"""
    doc = fitz.open(file_path)
    outputs = []
    image_count = 0
    
    for page_num, page in enumerate(doc):
        images = page.get_images(full=True)
        for img_index, img in enumerate(images):
            xref = img[0]
            try:
                base_image = doc.extract_image(xref)
                image_bytes = base_image["image"]
                image_ext = base_image["ext"]
                image_count += 1
                output_path = os.path.join(output_dir, f"page{page_num+1}_img{img_index+1}.{image_ext}")
                with open(output_path, "wb") as f:
                    f.write(image_bytes)
                outputs.append(output_path)
            except Exception as e:
                logger.warning("提取图片失败: %s", e)
                continue
    
    doc.close()
    return {"success": True, "outputs": outputs, "count": image_count}
