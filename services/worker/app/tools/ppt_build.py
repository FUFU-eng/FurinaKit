"""用大纲数据生成可编辑的 PPTX。

与「把每页截图塞进 PPT」的做法不同，这里用 python-pptx 生成**真正的占位符与文本框**：
标题、正文、项目符号、备注都可编辑，改字号配色、增删条目都行。

版式：封面页（标题 + 副标题）+ 目录页 + 内容页（标题 + 分级要点）+ 结束页，
配色内置四套主题，字体跟随系统中文黑体，避免打开时缺字体变形。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Dict, List, Optional

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.util import Inches, Pt

# 四套配色：主色 / 深色 / 浅色底
THEMES: Dict[str, Dict[str, str]] = {
    "business": {"name": "商务蓝", "primary": "1F4E79", "dark": "17375E", "light": "EAF1F8", "text": "1F2937"},
    "fresh": {"name": "清新绿", "primary": "1B7F5A", "dark": "14604A", "light": "E8F5EF", "text": "1F2937"},
    "warm": {"name": "暖橙", "primary": "C2410C", "dark": "9A3412", "light": "FDF0E7", "text": "1F2937"},
    "dark": {"name": "暗夜紫", "primary": "5B21B6", "dark": "3C1580", "light": "F1EBFC", "text": "1F2937"},
}

CN_FONT = "微软雅黑"


def _rgb(hexstr: str) -> RGBColor:
    return RGBColor.from_string(hexstr.upper())


def _set_font(run, size: int, bold: bool = False, color: str = "1F2937") -> None:
    run.font.size = Pt(size)
    run.font.bold = bold
    run.font.name = CN_FONT
    run.font.color.rgb = _rgb(color)
    # 中文字体需要额外设置 eastasia，否则 PowerPoint 里可能回落成宋体
    try:
        from pptx.oxml.ns import qn

        rPr = run._r.get_or_add_rPr()
        ea = rPr.find(qn("a:ea"))
        if ea is None:
            ea = rPr.makeelement(qn("a:ea"), {})
            rPr.append(ea)
        ea.set("typeface", CN_FONT)
    except Exception:
        pass


def _blank(prs: Presentation):
    return prs.slides.add_slide(prs.slide_layouts[6])


def _fill_background(slide, color: str) -> None:
    from pptx.oxml.ns import qn

    bg = slide.background
    bgPr = bg._element.get_or_add_bgPr()  # type: ignore[attr-defined]
    for child in list(bgPr):
        if child.tag == qn("a:solidFill"):
            bgPr.remove(child)
    fill = bgPr.makeelement(qn("a:solidFill"), {})
    clr = fill.makeelement(qn("a:srgbClr"), {"val": color.upper()})
    fill.append(clr)
    bgPr.insert(0, fill)


def _title_bar(slide, theme: Dict[str, str], title: str, subtitle: str = "") -> None:
    """内容页统一的标题条：左侧竖色块 + 标题"""
    bar = slide.shapes.add_shape(1, Inches(0.6), Inches(0.55), Inches(0.12), Inches(0.62))
    bar.fill.solid()
    bar.fill.fore_color.rgb = _rgb(theme["primary"])
    bar.line.fill.background()

    box = slide.shapes.add_textbox(Inches(0.9), Inches(0.45), Inches(11.8), Inches(0.9))
    tf = box.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    run = p.add_run()
    run.text = title
    _set_font(run, 28, True, theme["dark"])
    if subtitle:
        p2 = tf.add_paragraph()
        r2 = p2.add_run()
        r2.text = subtitle
        _set_font(r2, 13, False, "6B7280")


def build_pptx(outline: Dict[str, Any], output_path: str, theme_id: str = "business", with_toc: bool = True) -> Dict[str, Any]:
    """outline 形如：
    {"title": "...", "subtitle": "...", "slides": [{"title": "...", "points": ["...", "..."], "notes": "..."}]}
    """
    theme = THEMES.get(theme_id, THEMES["business"])
    slides = outline.get("slides") or []
    if not isinstance(slides, list) or not slides:
        raise RuntimeError("大纲里没有任何内容页")

    prs = Presentation()
    prs.slide_width = Inches(13.333)
    prs.slide_height = Inches(7.5)

    title_text = str(outline.get("title") or "演示文稿")
    subtitle_text = str(outline.get("subtitle") or "")

    # 封面
    cover = _blank(prs)
    _fill_background(cover, theme["dark"])
    box = cover.shapes.add_textbox(Inches(1.0), Inches(2.5), Inches(11.3), Inches(1.6))
    tf = box.text_frame
    tf.word_wrap = True
    p = tf.paragraphs[0]
    r = p.add_run()
    r.text = title_text
    _set_font(r, 44, True, "FFFFFF")
    if subtitle_text:
        b2 = cover.shapes.add_textbox(Inches(1.05), Inches(4.15), Inches(11), Inches(0.8))
        t2 = b2.text_frame
        t2.word_wrap = True
        p2 = t2.paragraphs[0]
        r2 = p2.add_run()
        r2.text = subtitle_text
        _set_font(r2, 18, False, "E5E7EB")

    # 目录
    if with_toc and len(slides) > 1:
        toc = _blank(prs)
        _fill_background(toc, "FFFFFF")
        _title_bar(toc, theme, "目录", f"共 {len(slides)} 个部分")
        box = toc.shapes.add_textbox(Inches(1.1), Inches(1.7), Inches(11), Inches(5.2))
        tf = box.text_frame
        tf.word_wrap = True
        for i, s in enumerate(slides):
            p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
            p.space_after = Pt(10)
            r = p.add_run()
            r.text = f"{i + 1:02d}   {s.get('title', '')}"
            _set_font(r, 18, False, theme["text"])

    # 内容页
    for s in slides:
        slide = _blank(prs)
        _fill_background(slide, "FFFFFF")
        _title_bar(slide, theme, str(s.get("title", "")))
        content = slide.shapes.add_textbox(Inches(1.05), Inches(1.65), Inches(11.3), Inches(5.0))
        tf = content.text_frame
        tf.word_wrap = True
        points = s.get("points") or []
        if not points and s.get("content"):
            points = [str(s["content"])]
        for i, pt in enumerate(points):
            text = str(pt)
            # 二级要点（以 - 或 • 开头）缩进一级
            sub = text.lstrip().startswith(("-", "•", "·"))
            p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
            p.space_after = Pt(9)
            if sub:
                p.level = 1
                text = text.lstrip().lstrip("-•·").strip()
            r = p.add_run()
            r.text = ("• " if not sub else "– ") + text
            _set_font(r, 18 if not sub else 16, False, theme["text"] if not sub else "4B5563")

        notes = str(s.get("notes") or "").strip()
        if notes:
            slide.notes_slide.notes_text_frame.text = notes

    # 结束页
    end = _blank(prs)
    _fill_background(end, theme["dark"])
    box = end.shapes.add_textbox(Inches(1.0), Inches(3.2), Inches(11.3), Inches(1.2))
    tf = box.text_frame
    p = tf.paragraphs[0]
    p.alignment = PP_ALIGN.CENTER
    r = p.add_run()
    r.text = "谢谢观看"
    _set_font(r, 36, True, "FFFFFF")

    out = Path(output_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(out))

    return {
        "success": True,
        "output": str(out),
        "slides": len(slides) + (2 if with_toc and len(slides) > 1 else 1),
        "theme": theme["name"],
        "title": title_text,
    }


def build_from_json(outline_json: str, output_path: str, theme_id: str = "business", with_toc: bool = True) -> Dict[str, Any]:
    """给 worker 分发用：大纲以 JSON 字符串形式传入"""
    try:
        outline = json.loads(outline_json)
    except Exception as exc:  # noqa: BLE001
        raise RuntimeError(f"大纲数据不是合法 JSON：{exc}") from exc
    return build_pptx(outline, output_path, theme_id=theme_id, with_toc=with_toc)
