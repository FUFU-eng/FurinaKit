"""PPT 转图片：把演示文稿逐页导出为 PNG / JPG。

渲染这件事绕不开真正的排版引擎，所以按优先级找可用的：
  1. Microsoft PowerPoint（本机装了 Office 就直接用，速度最快、还原度最高）；
  2. WPS 演示（接口与 PowerPoint 基本一致，国内用户更常见）；
  3. LibreOffice（装了就走无头转 PDF，再用 PyMuPDF 拆成图片）。
三者都没有时给出明确提示，不假装成功。

注意：走 Office/WPS 的 COM 导出时，PowerPoint 进程必须可见才能导出，
这段代码会在打开后立刻把窗口最小化，并在结束时退出进程，尽量不打扰用户。
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any, Dict, List, Optional


def _find_soffice() -> Optional[str]:
    """找 LibreOffice 的可执行文件"""
    candidates = [
        r"C:\Program Files\LibreOffice\program\soffice.exe",
        r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
        os.path.expandvars(r"%LOCALAPPDATA%\Programs\LibreOffice\program\soffice.exe"),
    ]
    found = shutil.which("soffice") or shutil.which("soffice.exe")
    if found:
        return found
    for c in candidates:
        if c and os.path.isfile(c):
            return c
    return None


def _export_with_com(file_path: str, out_dir: str, width: int, height: int, fmt: str) -> Optional[List[str]]:
    """用 PowerPoint / WPS 演示导出。返回图片路径列表；不能用时返回 None。"""
    try:
        import win32com.client  # type: ignore
    except Exception:
        return None

    app = None
    pres = None
    for prog_id in ("PowerPoint.Application", "KWPP.Application"):
        try:
            app = win32com.client.Dispatch(prog_id)
            break
        except Exception:
            app = None
    if app is None:
        return None

    try:
        # Visible 必须为 True 才能稳定导出（这是 PowerPoint COM 的历史行为）
        try:
            app.Visible = True
        except Exception:
            pass
        pres = app.Presentations.Open(os.path.abspath(file_path), ReadOnly=True, WithWindow=False)
        # PowerPoint 的导出接口要求进程可见，否则会直接失败；但可以把窗口压到最小，
        # 避免在用户屏幕上弹出/闪烁（曾因此让用户以为软件在闪屏）。
        try:
            if pres.Windows.Count > 0:
                pres.Windows(1).WindowState = 2  # ppWindowMinimized
        except Exception:
            pass
        try:
            app.WindowState = 2
        except Exception:
            pass
        outputs: List[str] = []
        ext = "jpg" if fmt.lower() in ("jpg", "jpeg") else "png"
        for i, slide in enumerate(pres.Slides, start=1):
            target = os.path.join(out_dir, f"第{i:03d}页.{ext}")
            slide.Export(target, ext.upper(), width, height)
            if os.path.isfile(target):
                outputs.append(target)
        return outputs or None
    except Exception:
        return None
    finally:
        try:
            if pres is not None:
                pres.Close()
        except Exception:
            pass
        try:
            if app is not None:
                app.Quit()
        except Exception:
            pass


def _export_with_soffice(soffice: str, file_path: str, out_dir: str) -> Optional[str]:
    """用 LibreOffice 无头模式转成 PDF，返回 PDF 路径"""
    try:
        subprocess.run(
            [soffice, "--headless", "--norestore", "--convert-to", "pdf", "--outdir", out_dir, file_path],
            capture_output=True,
            timeout=300,
        )
    except Exception:
        return None
    stem = Path(file_path).stem
    pdf = os.path.join(out_dir, f"{stem}.pdf")
    return pdf if os.path.isfile(pdf) else None


def ppt_to_images(
    file_path: str,
    out_dir: str,
    width: int = 1920,
    height: int = 1080,
    fmt: str = "png",
) -> Dict[str, Any]:
    """把 PPT 逐页导出为图片，返回 {'success', 'outputs'|'output', ...}"""
    src = Path(file_path)
    if src.suffix.lower() not in (".pptx", ".pptm", ".ppsx", ".ppt"):
        raise RuntimeError("只支持 .pptx / .pptm / .ppt 格式")

    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    width = max(320, min(7680, int(width)))
    height = max(180, min(4320, int(height)))

    # 1) PowerPoint / WPS
    images = _export_with_com(str(src), str(out), width, height, fmt)
    engine = "PowerPoint"
    if not images:
        # 2) LibreOffice
        soffice = _find_soffice()
        if soffice:
            engine = "LibreOffice"
            with tempfile.TemporaryDirectory() as tmp:
                pdf = _export_with_soffice(soffice, str(src), tmp)
                if pdf:
                    import pymupdf as fitz

                    doc = fitz.open(pdf)
                    images = []
                    ext = "jpg" if fmt.lower() in ("jpg", "jpeg") else "png"
                    for i, page in enumerate(doc, start=1):
                        pix = page.get_pixmap(dpi=150 if ext == "jpg" else 200)
                        target = out / f"第{i:03d}页.{ext}"
                        pix.save(str(target))
                        images.append(str(target))
                    doc.close()
        if not images:
            raise RuntimeError(
                "没有找到可用的演示文稿渲染引擎。请安装 Microsoft Office（PowerPoint）或 WPS Office，"
                "或安装 LibreOffice（免费开源）后再试"
            )

    # 打包：只有一张就直接给图片，多张打 zip
    if len(images) == 1:
        return {"success": True, "output": images[0], "count": 1, "engine": engine}

    import zipfile

    zip_path = out.parent / f"{src.stem}_图片.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for p in images:
            zf.write(p, Path(p).name)
    total = sum(os.path.getsize(p) for p in images if os.path.isfile(p))
    return {
        "success": True,
        "output": str(zip_path),
        "outputs": images,
        "count": len(images),
        "engine": engine,
        "totalSize": total,
    }
