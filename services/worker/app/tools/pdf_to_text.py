"""PDF → Markdown / HTML（用 PyMuPDF，保版面）。

为什么用 PyMuPDF：它能拿到每段文字的字号、粗体、位置，也能取表格与内嵌图片 ——
这正是"把 PDF 还原成可编辑文本"需要的全部信息，比单纯抽文字流强得多。
各家在线转换工具的做法也是这个路子：按字号推标题层级、按缩进与项目符号识别列表、按文字块位置还原段落。

设计约定（与项目其它 worker 模块一致）：
- 对外报错一律中文人话（PdfTextError）
- 图片以 data URL 内嵌，保证输出是**单个文件**，方便直接下载与分享
"""

from __future__ import annotations

import base64
import html as html_mod
import os
import re
from collections import Counter
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple


class PdfTextError(Exception):
    """可以直接展示给用户的中文错误。"""


def _open_pdf(path: str):
    import fitz  # PyMuPDF

    if not os.path.isfile(path):
        raise PdfTextError("找不到这个 PDF 文件")
    try:
        doc = fitz.open(path)
    except Exception as exc:  # noqa: BLE001
        raise PdfTextError(f"这个 PDF 打不开（可能已加密或损坏）：{exc}") from exc
    if doc.needs_pass:
        raise PdfTextError("这个 PDF 有密码保护，请先解除密码再转换")
    if doc.page_count == 0:
        raise PdfTextError("这个 PDF 里没有页面")
    return doc


def _span_size(span: dict) -> float:
    return float(span.get("size", 0) or 0)


def _is_bold(span: dict, font_name: str) -> bool:
    flags = int(span.get("flags", 0) or 0)
    # PyMuPDF 的 flags 第 4 位（16）表示粗体
    return bool(flags & 16) or ("bold" in (font_name or "").lower()) or ("heavy" in (font_name or "").lower())


def _collect_lines(page) -> List[Dict[str, Any]]:
    """把页面上的文字整理成"行"：带字号、是否粗体、左侧位置、是否项目符号"""
    data = page.get_text("dict")
    lines: List[Dict[str, Any]] = []
    for block in data.get("blocks", []):
        if block.get("type") != 0:
            continue  # 非文字块（图片）跳过
        for line in block.get("lines", []):
            spans = line.get("spans", [])
            if not spans:
                continue
            text = "".join(str(s.get("text", "")) for s in spans)
            if not text.strip():
                continue
            sizes = [_span_size(s) for s in spans if _span_size(s) > 0]
            fonts = [str(s.get("font", "")) for s in spans]
            lines.append({
                "text": text.rstrip(),
                "size": max(sizes) if sizes else 0.0,
                "bold": any(_is_bold(s, str(s.get("font", ""))) for s in spans),
                "x": float(line.get("bbox", [0, 0, 0, 0])[0]),
                "font": fonts[0] if fonts else "",
                "bbox": line.get("bbox", [0, 0, 0, 0]),
            })
    return lines


_BULLET_RE = re.compile(r"^\s*[•·▪◦●○\-–—*]\s+")
_ORDERED_RE = re.compile(r"^\s*(?:\d{1,3}|[一二三四五六七八九十]{1,3})\s*[.、)）]\s*")


def _body_size(lines: List[Dict[str, Any]]) -> float:
    """正文基准字号 = 出现最多的字号（只作参考）"""
    sizes = [round(l["size"], 1) for l in lines if l["size"] > 0]
    if not sizes:
        return 0.0
    return Counter(sizes).most_common(1)[0][0]


def _heading_levels(lines: List[Dict[str, Any]]) -> Dict[float, int]:
    """算出"字号 → 标题级别"的映射。

    ★ 不能用"正文基准字号 × 倍数"来判级别：表格文字常常比正文还多，
      会把基准拉低，于是一个 16pt 的二级标题被算成一级（实测踩过）。
      改成**按字号排名**：全文用到的字号去重后从大到小排，
      最大的那档算一级标题，第二档算二级……这是各家转换器的通行做法。
    """
    sizes = sorted({round(l["size"], 1) for l in lines if l["size"] > 0}, reverse=True)
    if len(sizes) < 2:
        return {}
    body = _body_size(lines)
    # 只有明显大于正文的字号才算标题档位（≥ 正文 1.12 倍）
    heads = [s for s in sizes if body > 0 and s >= body * 1.12]
    heads = heads[:3]  # 最多三级
    return {size: idx + 1 for idx, size in enumerate(heads)}


def _level_of(line: Dict[str, Any], levels: Dict[float, int]) -> int:
    size = round(line["size"], 1)
    if size in levels:
        return levels[size]
    return 0


def pdf_to_markdown(path: str, opts: Dict[str, Any]) -> Dict[str, Any]:
    """PDF → Markdown"""
    keep_images = bool(opts.get("keepImages", True))
    detect_tables = bool(opts.get("detectTables", True))
    page_break = bool(opts.get("pageBreak", False))
    max_pages = int(opts.get("maxPages", 0) or 0)

    doc = _open_pdf(path)
    out: List[str] = []
    stats = {"pages": 0, "headings": 0, "lists": 0, "tables": 0, "images": 0, "chars": 0}

    limit = doc.page_count if max_pages <= 0 else min(max_pages, doc.page_count)
    for pno in range(limit):
        page = doc[pno]
        stats["pages"] += 1
        if page_break and pno > 0:
            out.append("\n---\n")

        lines = _collect_lines(page)
        base = _body_size(lines)
        levels = _heading_levels(lines)

        # 表格：PyMuPDF 自带表格识别，先占位后填充，避免和正文重复输出
        table_boxes: List[Tuple[float, float, float, float]] = []
        table_md: Dict[int, str] = {}
        if detect_tables:
            try:
                finder = page.find_tables()
                for t_idx, table in enumerate(getattr(finder, "tables", []) or []):
                    rows = table.extract() or []
                    rows = [[(c or "").replace("\n", " ").strip() for c in row] for row in rows]
                    rows = [r for r in rows if any(c for c in r)]
                    if len(rows) < 1:
                        continue
                    width = max(len(r) for r in rows)
                    rows = [r + [""] * (width - len(r)) for r in rows]
                    md = ["| " + " | ".join(rows[0]) + " |", "| " + " | ".join(["---"] * width) + " |"]
                    for r in rows[1:]:
                        md.append("| " + " | ".join(r) + " |")
                    table_md[t_idx] = "\n".join(md)
                    stats["tables"] += 1
                    bbox = tuple(getattr(table, "bbox", (0, 0, 0, 0)))
                    table_boxes.append(bbox)  # type: ignore[arg-type]
            except Exception:  # noqa: BLE001
                table_boxes = []

        def in_table(line: Dict[str, Any]) -> bool:
            x0, y0, x1, y1 = line["bbox"]
            cy = (y0 + y1) / 2
            for (tx0, ty0, tx1, ty1) in table_boxes:
                if tx0 - 2 <= x0 and cy >= ty0 - 2 and cy <= ty1 + 2:
                    return True
            return False

        buffer_lines: List[str] = []
        for line in lines:
            if in_table(line):
                continue
            text = line["text"].strip()
            if not text:
                continue

            level = _level_of(line, levels)
            if level > 0:
                buffer_lines.append(f"\n{'#' * level} {text}\n")
                stats["headings"] += 1
                continue

            if _BULLET_RE.match(text):
                buffer_lines.append("- " + _BULLET_RE.sub("", text))
                stats["lists"] += 1
                continue
            if _ORDERED_RE.match(text):
                item = _ORDERED_RE.sub("", text)
                buffer_lines.append(f"1. {item}")
                stats["lists"] += 1
                continue

            # 明显是标题的短行（居中 + 很短）也当小标题
            if base > 0 and line["bold"] and len(text) <= 24 and not text.endswith(("。", ".", "，", ",")):
                buffer_lines.append(f"\n**{text}**\n")
                continue

            buffer_lines.append(text)

        out.append("\n\n".join(buffer_lines))

        # 表格放到本页正文之后
        for t_idx in sorted(table_md):
            out.append("\n" + table_md[t_idx] + "\n")

        # 图片：以 data URL 内嵌，保持单文件输出
        if keep_images:
            try:
                for img in page.get_images(full=True):
                    xref = img[0]
                    pix = doc.extract_image(xref)
                    data = pix.get("image")
                    if not data or len(data) < 256:
                        continue
                    ext = pix.get("ext", "png")
                    mime = f"image/{'jpeg' if ext in ('jpg', 'jpeg') else ext}"
                    b64 = base64.b64encode(data).decode()
                    out.append(f"\n![图片](data:{mime};base64,{b64})\n")
                    stats["images"] += 1
            except Exception:  # noqa: BLE001
                pass

    doc.close()

    text = "\n\n".join(x for x in out if x.strip())
    # 收掉过多的空行（标题前后会留下多余空行，看着很散）
    text = re.sub(r"\n{3,}", "\n\n", text).strip() + "\n"
    stats["chars"] = len(text)

    # 输出文件
    src = Path(path)
    name = f"{src.stem}.md"
    return {
        "success": True,
        "markdown": text,
        "filename": name,
        "stats": stats,
    }


def pdf_to_html(path: str, opts: Dict[str, Any]) -> Dict[str, Any]:
    """PDF → HTML（保留段落/标题层级，图片内嵌，带基础样式）"""
    keep_images = bool(opts.get("keepImages", True))
    detect_tables = bool(opts.get("detectTables", True))

    doc = _open_pdf(path)
    body: List[str] = []
    stats = {"pages": 0, "headings": 0, "lists": 0, "tables": 0, "images": 0, "chars": 0}

    for pno in range(doc.page_count):
        page = doc[pno]
        stats["pages"] += 1
        lines = _collect_lines(page)
        base = _body_size(lines)
        levels = _heading_levels(lines)

        parts: List[str] = []
        list_open = False

        def close_list() -> None:
            nonlocal list_open
            if list_open:
                parts.append("</ul>")
                list_open = False

        for line in lines:
            text = line["text"].strip()
            if not text:
                continue
            esc = html_mod.escape(text)
            lvl = _level_of(line, levels)
            if lvl > 0:
                close_list()
                parts.append(f"<h{lvl}>{esc}</h{lvl}>")
                stats["headings"] += 1
            elif _BULLET_RE.match(text):
                if not list_open:
                    parts.append("<ul>")
                    list_open = True
                parts.append(f"<li>{html_mod.escape(_BULLET_RE.sub('', text))}</li>")
                stats["lists"] += 1
            else:
                close_list()
                if line["bold"]:
                    parts.append(f"<p><strong>{esc}</strong></p>")
                else:
                    parts.append(f"<p>{esc}</p>")
        close_list()

        if detect_tables:
            try:
                for table in getattr(page.find_tables(), "tables", []) or []:
                    rows = [[(c or "").strip() for c in row] for row in (table.extract() or [])]
                    rows = [r for r in rows if any(r)]
                    if not rows:
                        continue
                    width = max(len(r) for r in rows)
                    rows = [r + [""] * (width - len(r)) for r in rows]
                    t = ["<table>"]
                    t.append("<thead><tr>" + "".join(f"<th>{html_mod.escape(c)}</th>" for c in rows[0]) + "</tr></thead><tbody>")
                    for r in rows[1:]:
                        t.append("<tr>" + "".join(f"<td>{html_mod.escape(c)}</td>" for c in r) + "</tr>")
                    t.append("</tbody></table>")
                    parts.append("".join(t))
                    stats["tables"] += 1
            except Exception:  # noqa: BLE001
                pass

        if keep_images:
            try:
                for img in page.get_images(full=True):
                    pix = doc.extract_image(img[0])
                    data = pix.get("image")
                    if not data or len(data) < 256:
                        continue
                    ext = pix.get("ext", "png")
                    mime = f"image/{'jpeg' if ext in ('jpg', 'jpeg') else ext}"
                    b64 = base64.b64encode(data).decode()
                    parts.append(f'<figure><img src="data:{mime};base64,{b64}" alt=""/></figure>')
                    stats["images"] += 1
            except Exception:  # noqa: BLE001
                pass

        body.append(f'<section class="page">' + "\n".join(parts) + "</section>")

    doc.close()

    title = Path(path).stem
    html_out = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<title>{html_mod.escape(title)}</title>
<style>
  body {{ margin: 0; padding: 32px; background: #f6f7f9; color: #1f2328;
         font-family: "Microsoft YaHei", "PingFang SC", "Segoe UI", system-ui, sans-serif; line-height: 1.75; }}
  .page {{ max-width: 820px; margin: 0 auto 28px; padding: 40px 48px; background: #fff;
           border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,.08); }}
  h1 {{ font-size: 26px; margin: 1.2em 0 .6em; }} h2 {{ font-size: 21px; margin: 1.1em 0 .5em; }}
  h3 {{ font-size: 17px; margin: 1em 0 .4em; }}
  p {{ margin: .55em 0; }} ul {{ margin: .5em 0; padding-left: 1.6em; }}
  table {{ border-collapse: collapse; margin: 1em 0; width: 100%; font-size: 14px; }}
  th, td {{ border: 1px solid #d8dee4; padding: 6px 10px; text-align: left; }}
  th {{ background: #f2f4f7; }}
  img {{ max-width: 100%; height: auto; }}
  figure {{ margin: 1em 0; text-align: center; }}
</style>
</head>
<body>
{chr(10).join(body)}
</body>
</html>
"""
    stats["chars"] = len(html_out)

    return {
        "success": True,
        "html": html_out,
        "filename": f"{Path(path).stem}.html",
        "stats": stats,
    }
