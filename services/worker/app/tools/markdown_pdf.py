"""Markdown → 真 PDF（tool id: markdown-to-pdf）。

实现：markdown_it 解析 Markdown → PyMuPDF 排版成 A4 / Letter PDF。

- **中文字体用 PyMuPDF 内置的 china-s（简体中文），不需要任何字体文件**；西文用 Base-14（helv/hebo/heit/...）
- 只处理 Markdown 语法；HTML 标签不做解析，一律当纯文本画出来（防注入）
- 断行：西文按单词断，中文（以及超长单词）按字符宽度硬切，保证永不溢出页宽
- 支持：多级标题、段落、有序/无序/嵌套列表、引用块（左竖线 + 灰底）、代码块（等宽 + 浅底）、
  水平分割线、表格（画线 + 表头加粗 + 换页重复表头）、行内粗体/斜体/行内代码/链接/删除线
- 页边距 18mm，页脚居中页码
- 本文件是新增模块，不改动任何现有模块的行为
"""

import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

import pymupdf as fitz
from markdown_it import MarkdownIt

MM = 72.0 / 25.4
MARGIN_MM = 18.0
PAGE_SIZES = {"a4": (595.28, 841.89), "letter": (612.0, 792.0)}
PAGE_SIZE_ALIASES = {
    "a4": "a4", "a4纸": "a4", "iso-a4": "a4",
    "letter": "letter", "us-letter": "letter", "usletter": "letter", "信纸": "letter",
}
MAX_MD_BYTES = 5 * 1024 * 1024
MIN_FONT_SIZE = 6.0
MAX_FONT_SIZE = 72.0

# ── 颜色（PyMuPDF 用 0~1 的三元组）────────────────────────────────────
C_TEXT = (0.10, 0.10, 0.12)
C_MUTED = (0.45, 0.45, 0.50)
C_LINK = (0.05, 0.30, 0.75)
C_CODE = (0.62, 0.12, 0.34)
C_CODE_TEXT = (0.16, 0.16, 0.19)
C_CODE_BG = (0.955, 0.957, 0.965)
C_QUOTE_BG = (0.955, 0.955, 0.96)
C_QUOTE_BAR = (0.72, 0.73, 0.78)
C_RULE = (0.75, 0.75, 0.78)
C_TABLE_BORDER = (0.72, 0.72, 0.76)
C_TABLE_HEAD_BG = (0.93, 0.94, 0.965)

# 引用块 / 代码块背景块的上下补白（让灰底看起来像一整块）
BG_EDGE_PAD = 5.0
QUOTE_INDENT = 14.0
LIST_INDENT = 22.0

# (字号倍数, 上方留白, 下方留白, 行高倍数)
_HEADING_SPEC = {
    1: (1.90, 20.0, 10.0, 1.40),
    2: (1.55, 16.0, 8.0, 1.42),
    3: (1.32, 13.0, 7.0, 1.45),
    4: (1.16, 10.0, 5.0, 1.50),
    5: (1.05, 9.0, 4.0, 1.55),
    6: (1.00, 8.0, 4.0, 1.55),
}

_CJK_RANGES = (
    (0x1100, 0x11FF), (0x2E80, 0x303F), (0x3040, 0x30FF), (0x3130, 0x318F),
    (0x3400, 0x4DBF), (0x4E00, 0x9FFF), (0xA960, 0xA97F), (0xAC00, 0xD7FF),
    (0xF900, 0xFAFF), (0xFE30, 0xFE4F), (0xFF00, 0xFFEF), (0x20000, 0x2FA1F),
)
_CJK_RE = re.compile("[" + "".join(f"\\U{lo:08x}-\\U{hi:08x}" for lo, hi in _CJK_RANGES) + "]")

_LATIN_FONTS = {
    (False, False): "helv", (True, False): "hebo", (False, True): "heit", (True, True): "hebi",
}
_MONO_FONTS = {
    (False, False): "cour", (True, False): "cobo", (False, True): "coit", (True, True): "cobi",
}
CJK_FONT = "china-s"

_FONT_OK: Dict[str, bool] = {}
_FONT_OBJ: Dict[str, Any] = {}
_WIDTH_CACHE: Dict[Tuple[str, float, str], float] = {}


class MarkdownPdfError(Exception):
    """可以直接展示给用户的中文错误。"""


def failed(exc: BaseException, prefix: str = "") -> Dict[str, Any]:
    if isinstance(exc, MarkdownPdfError):
        return {"success": False, "error": str(exc)}
    return {"success": False, "error": f"{prefix}：{exc}" if prefix else f"生成 PDF 失败：{exc}"}


# ── 字体与测量 ──────────────────────────────────────────────────────

def _is_cjk(ch: str) -> bool:
    code = ord(ch)
    for low, high in _CJK_RANGES:
        if low <= code <= high:
            return True
    return False


def _font_usable(name: str) -> bool:
    cached = _FONT_OK.get(name)
    if cached is None:
        try:
            fitz.Font(name)
            cached = True
        except Exception:
            cached = False
        _FONT_OK[name] = cached
    return cached


def _resolve_font(name: str) -> str:
    """字体不存在时退回可用的等价字体，保证测量和绘制用的是同一个字体。"""
    if _font_usable(name):
        return name
    fallback = CJK_FONT if name == CJK_FONT else "helv"
    if _font_usable(fallback):
        return fallback
    return "helv"


def _font_obj(name: str) -> Any:
    obj = _FONT_OBJ.get(name)
    if obj is None:
        obj = fitz.Font(name)
        _FONT_OBJ[name] = obj
    return obj


def _estimate_width(text: str, size: float) -> float:
    return sum(size * (1.0 if _is_cjk(ch) else 0.5) for ch in text)


def _text_width(text: str, font: str, size: float) -> float:
    if not text:
        return 0.0
    key = (font, size, text)
    hit = _WIDTH_CACHE.get(key)
    if hit is not None:
        return hit
    try:
        width = float(_font_obj(font).text_length(text, size))
    except Exception:
        width = _estimate_width(text, size)
    _WIDTH_CACHE[key] = width
    return width


def _font_for(text: str, style: dict) -> str:
    if _CJK_RE.search(text):
        return _resolve_font(CJK_FONT)
    if style.get("mono"):
        return _resolve_font(_MONO_FONTS[(bool(style.get("bold")), bool(style.get("italic")))])
    return _resolve_font(_LATIN_FONTS[(bool(style.get("bold")), bool(style.get("italic")))])


def _style(size: float, bold: bool = False, italic: bool = False, mono: bool = False,
           color: Tuple[float, float, float] = C_TEXT, link: Optional[str] = None,
           strike: bool = False) -> dict:
    return {
        "size": float(size), "bold": bool(bold), "italic": bool(italic), "mono": bool(mono),
        "color": color, "link": link, "strike": bool(strike),
    }


# ── 原子化 / 断行 ───────────────────────────────────────────────────

def _make_atom(kind: str, text: str, style: dict) -> dict:
    return {"kind": kind, "text": text, "style": style, "font": _font_for(text, style)}


def _atomize(text: str, style: dict, preserve_spaces: bool = False) -> List[dict]:
    """把一段文本切成 word / space / break 原子。

    中文不按空格分词：连续的非空白字符算一个 word，超出行宽时由断行器按字符硬切，
    因此中文可以逐字断行，西文按单词断行。
    """
    atoms: List[dict] = []
    buf: List[str] = []

    def flush():
        if buf:
            atoms.append(_make_atom("word", "".join(buf), style))
            buf.clear()

    for ch in str(text):
        if ch == "\n":
            flush()
            atoms.append({"kind": "break", "text": "", "style": style, "font": "helv"})
        elif ch in " \t\u3000":
            flush()
            if preserve_spaces or not (atoms and atoms[-1]["kind"] == "space"):
                atoms.append(_make_atom("space", " ", style))
        else:
            buf.append(ch)
    flush()
    return atoms


def _atom_width(atom: dict) -> float:
    return _text_width(atom["text"], atom["font"], atom["style"]["size"])


def _wrap_atoms(atoms: Sequence[dict], first_width: float, next_width: float,
                keep_leading: bool = False) -> List[List[dict]]:
    """贪心断行：西文按单词、中文/超长单词按字符硬切，绝不超出给定宽度。"""
    lines: List[List[dict]] = [[]]
    used = [0.0]
    limit = [max(float(first_width), 1.0)]

    def newline():
        lines.append([])
        used.append(0.0)
        limit.append(max(float(next_width), 1.0))

    for atom in atoms:
        kind = atom["kind"]
        if kind == "break":
            newline()
            continue
        style = atom["style"]
        text = atom["text"]
        if kind == "space":
            if lines[-1] or keep_leading:
                lines[-1].append(atom)
                used[-1] += _atom_width(atom)
            continue

        width = _atom_width(atom)
        if lines[-1] and used[-1] + width > limit[-1]:
            newline()
        while width > limit[-1] and len(text) > 1:
            take: List[str] = []
            acc = 0.0
            for ch in text:
                cw = _text_width(ch, _font_for(ch, style), style["size"])
                if take and acc + cw > limit[-1]:
                    break
                take.append(ch)
                acc += cw
            if not take:
                break
            lines[-1].append({"kind": "word", "text": "".join(take), "style": style,
                              "font": _font_for("".join(take), style)})
            used[-1] += acc
            text = text[len(take):]
            width = _text_width(text, _font_for(text, style), style["size"]) if text else 0.0
            if text:
                newline()
        if text:
            lines[-1].append({"kind": "word", "text": text, "style": style,
                              "font": _font_for(text, style)})
            used[-1] += width

    for line in lines:
        while line and line[-1]["kind"] == "space":
            line.pop()
    return lines


def _atoms_to_runs(atoms: Sequence[dict]) -> List[Tuple[str, dict]]:
    """把相邻同一样式的原子合成一段，减少 PDF 里的碎片。"""
    runs: List[List[Any]] = []
    for atom in atoms:
        if atom["kind"] == "break" or not atom["text"]:
            continue
        if runs and runs[-1][1] is atom["style"]:
            runs[-1][0] += atom["text"]
        else:
            runs.append([atom["text"], atom["style"]])
    return [(text, style) for text, style in runs]


def _line_cjk(text: str) -> bool:
    return bool(_CJK_RE.search(text))


# ── 绘制 ────────────────────────────────────────────────────────────

def _draw_run(page, x: float, baseline: float, text: str, style: dict, font: str) -> float:
    size = style["size"]
    width = _text_width(text, font, size)
    try:
        if style.get("bold") and font == CJK_FONT:
            # 内置中文字体没有粗体字重，需要自己"加粗"。
            #
            # ⚠️ 绝对不要用 render_mode=2（填充+描边）来做这件事：实测在 MuPDF 的内置 CJK
            # 字体上，它会把整个字形糊成实心黑块（一行粗体变成一条黑杠），字号 15 时
            # 描边宽度 0.45 就足以糊死，缩到 0.1 依然是黑的。
            # 改用经典做法：同一串文字错开极小距离再描一遍，笔画变粗但字形保持清晰。
            page.insert_text((x, baseline), text, fontname=font, fontsize=size, color=style["color"])
            page.insert_text((x + size * 0.02, baseline), text, fontname=font, fontsize=size,
                             color=style["color"])
        else:
            page.insert_text((x, baseline), text, fontname=font, fontsize=size, color=style["color"])
    except Exception:
        try:
            page.insert_text((x, baseline), text, fontname="helv", fontsize=size, color=style["color"])
        except Exception:
            return x + width
    if style.get("strike"):
        y = baseline - size * 0.28
        try:
            page.draw_line(fitz.Point(x, y), fitz.Point(x + width, y),
                           color=style["color"], width=max(0.5, size * 0.05))
        except Exception:
            pass
    link = style.get("link")
    if link:
        try:
            page.insert_link({
                "kind": getattr(fitz, "LINK_URI", 2),
                "from": fitz.Rect(x, baseline - size * 0.85, x + width, baseline + size * 0.25),
                "uri": str(link),
            })
        except Exception:
            pass
    return x + width


class _Layout:
    """按行往下排版，空间不够就翻页；表格 / 分割线 / 页脚单独处理。"""

    def __init__(self, page_w: float, page_h: float, margin: float, base_size: float):
        self.doc = fitz.open()
        self.page_w = page_w
        self.page_h = page_h
        self.margin = margin
        self.base = base_size
        self.left = margin
        self.right = page_w - margin
        self.content_w = self.right - self.left
        self.top = margin
        self.bottom = page_h - margin - 22.0
        self.page = None
        self.y = self.top

    def new_page(self):
        self.page = self.doc.new_page(width=self.page_w, height=self.page_h)
        self.y = self.top
        return self.page

    def ensure(self, height: float):
        if self.page is None or self.y + height > self.bottom:
            self.new_page()

    # -- 普通行 -----------------------------------------------------
    def place_lines(self, lines: Sequence[dict]):
        for line in lines:
            runs = line.get("runs") or []
            marker = line.get("marker")
            height = float(line.get("height") or 0.0)
            after = float(line.get("after") or 0.0)
            if line.get("spacer"):
                # 纯留白：只推进光标，不触发换页（避免页顶凭空多出空白）
                self.y += height
                continue
            self.ensure(height + after)
            y0 = self.y
            y1 = y0 + height
            bg = line.get("bg")
            if bg:
                x0 = self.left + float(line.get("bg_x0") or 0.0)
                x1 = self.right - float(line.get("bg_x1") or 0.0)
                pad_top = float(line.get("bg_pad_top", 1.0))
                pad_bottom = float(line.get("bg_pad_bottom", 1.0))
                try:
                    self.page.draw_rect(fitz.Rect(x0, y0 - pad_top, x1, y1 + pad_bottom),
                                        color=None, fill=bg)
                except Exception:
                    pass
            bar = line.get("bar")
            if bar:
                bx = self.left + float(line.get("bar_x") or 0.0)
                try:
                    self.page.draw_rect(fitz.Rect(bx, y0 - 2.0, bx + 3.0, y1 + 2.0),
                                        color=None, fill=bar)
                except Exception:
                    pass
            baseline = y0 + height * 0.78
            if marker:
                mtext, mstyle, mx = marker
                _draw_run(self.page, self.left + float(mx), baseline, mtext, mstyle,
                          _font_for(mtext, mstyle))
            x = self.left + float(line.get("indent") or 0.0)
            for text, style in runs:
                if not text:
                    continue
                x = _draw_run(self.page, x, baseline, text, style, _font_for(text, style))
            self.y = y1 + after

    # -- 分割线 -----------------------------------------------------
    def place_hr(self):
        self.ensure(24.0)
        y = self.y + 12.0
        try:
            self.page.draw_line(fitz.Point(self.left, y), fitz.Point(self.right, y),
                                color=C_RULE, width=0.7)
        except Exception:
            pass
        self.y = y + 12.0

    # -- 表格 -------------------------------------------------------
    def place_table(self, table: dict):
        widths: List[float] = table["col_widths"]
        pad: float = table["pad"]
        line_h: float = table["line_h"]
        aligns: List[str] = table["align"]
        header = table.get("header")
        rows = table.get("rows") or []

        def wrap_cell(atoms: List[dict], index: int) -> List[List[dict]]:
            width = widths[index] if index < len(widths) else widths[-1]
            avail = max(2.0, width - 2 * pad)
            return _wrap_atoms(atoms, avail, avail)

        def prepare(cells: List[List[dict]]) -> List[Tuple[float, List[List[dict]]]]:
            return [(widths[i] if i < len(widths) else widths[-1], wrap_cell(cell, i))
                    for i, cell in enumerate(cells)]

        def height_of(prepared) -> float:
            rows_count = max((len(lines) for _, lines in prepared), default=1)
            return max(1, rows_count) * line_h + 2 * pad

        def draw(prepared, bg):
            row_h = height_of(prepared)
            y0 = self.y
            y1 = y0 + row_h
            if bg:
                try:
                    self.page.draw_rect(fitz.Rect(self.left, y0, self.right, y1), color=None, fill=bg)
                except Exception:
                    pass
            try:
                self.page.draw_line(fitz.Point(self.left, y0), fitz.Point(self.right, y0),
                                    color=C_TABLE_BORDER, width=0.5)
                self.page.draw_line(fitz.Point(self.left, y1), fitz.Point(self.right, y1),
                                    color=C_TABLE_BORDER, width=0.5)
                bx = self.left
                for width in widths:
                    self.page.draw_line(fitz.Point(bx, y0), fitz.Point(bx, y1),
                                        color=C_TABLE_BORDER, width=0.5)
                    bx += width
                self.page.draw_line(fitz.Point(self.right, y0), fitz.Point(self.right, y1),
                                    color=C_TABLE_BORDER, width=0.5)
            except Exception:
                pass
            x = self.left
            for index, (width, cell_lines) in enumerate(prepared):
                avail = max(1.0, width - 2 * pad)
                align = aligns[index] if index < len(aligns) else "left"
                for line_index, atoms in enumerate(cell_lines):
                    baseline = y0 + pad + line_index * line_h + line_h * 0.78
                    total = sum(_atom_width(a) for a in atoms)
                    offset = 0.0
                    if align == "center":
                        offset = max(0.0, (avail - total) / 2)
                    elif align == "right":
                        offset = max(0.0, avail - total)
                    xx = x + pad + offset
                    for text, style in _atoms_to_runs(atoms):
                        xx = _draw_run(self.page, xx, baseline, text, style, _font_for(text, style))
                x += width
            self.y = y1

        header_prepared = prepare(header) if header else None
        if header_prepared is not None:
            self.ensure(height_of(header_prepared))
            draw(header_prepared, C_TABLE_HEAD_BG)

        for cells in rows:
            prepared = prepare(cells)
            if self.y + height_of(prepared) > self.bottom:
                self.new_page()
                if header_prepared is not None:
                    draw(header_prepared, C_TABLE_HEAD_BG)
            draw(prepared, None)
        self.y += 8.0

    # -- 页脚 -------------------------------------------------------
    def draw_footer(self):
        if self.doc.page_count == 0:
            self.new_page()
        total = self.doc.page_count
        style = _style(9.0, color=C_MUTED)
        for index in range(total):
            page = self.doc[index]
            label = f"第 {index + 1} 页 / 共 {total} 页"
            width = _text_width(label, _resolve_font(CJK_FONT), style["size"])
            try:
                page.insert_text(((self.page_w - width) / 2.0, self.page_h - self.margin + 10.0),
                                 label, fontname=_resolve_font(CJK_FONT),
                                 fontsize=style["size"], color=C_MUTED)
            except Exception:
                pass


# ── Markdown 结构 → 行 ──────────────────────────────────────────────

def _fit_widths(natural: Sequence[float], content_w: float, min_w: float = 26.0) -> List[float]:
    total = sum(natural)
    if total <= content_w:
        return list(natural)
    scale = content_w / total
    scaled = [max(min_w, value * scale) for value in natural]
    total_scaled = sum(scaled)
    if total_scaled > content_w:
        factor = content_w / total_scaled
        scaled = [max(1.0, value * factor) for value in scaled]
    return scaled


class _Builder:
    """把 markdown_it 的 token 流变成「行 / 表格 / 分割线」的操作列表。"""

    def __init__(self, base_size: float, content_w: float):
        self.base = float(base_size)
        self.content_w = max(10.0, float(content_w))
        self.indent = 0.0
        self.quote = 0
        self.lists: List[dict] = []
        self.pending_marker: Optional[str] = None

    # -- 小工具 -----------------------------------------------------
    def _spacer(self, height: float) -> dict:
        return {"spacer": True, "runs": [], "indent": 0.0, "height": float(max(0.0, height)),
                "after": 0.0}

    def _quote_left(self) -> float:
        return max(0.0, self.indent - QUOTE_INDENT) if self.quote > 0 else 0.0

    def _line(self, atoms: List[dict], indent: float, size: float, line_h: float,
              after: float = 0.0, bg: Optional[tuple] = None, marker=None) -> dict:
        text = "".join(a["text"] for a in atoms)
        height = max(line_h, size * 1.7) if _line_cjk(text) else line_h
        line = {
            "runs": _atoms_to_runs(atoms), "indent": float(indent), "height": float(height),
            "after": float(after), "bg": bg, "bg_pad_top": 1.0, "bg_pad_bottom": 1.0,
            "bg_x0": 0.0, "bg_x1": 0.0, "bar": None, "bar_x": 0.0, "marker": marker,
        }
        if bg is not None and self.quote > 0:
            line["bg_x0"] = self._quote_left()
            line["bar"] = C_QUOTE_BAR
            line["bar_x"] = self._quote_left()
        return line

    # -- 行内 -------------------------------------------------------
    def _inline_runs(self, token, base_style: dict) -> List[Tuple[str, dict]]:
        runs: List[Tuple[str, dict]] = []
        if token is None:
            return runs
        stack: List[dict] = [base_style]
        for child in (token.children or []):
            ctype = child.type
            if ctype == "text":
                runs.append((child.content, stack[-1]))
            elif ctype in ("html_inline", "html_block", "text_special"):
                # 不做标签解析：HTML 一律当纯文本绘制（防注入）
                runs.append((child.content, stack[-1]))
            elif ctype == "code_inline":
                style = dict(stack[-1])
                style.update(mono=True, color=C_CODE, size=stack[-1]["size"] * 0.95)
                runs.append((child.content, style))
            elif ctype == "strong_open":
                style = dict(stack[-1])
                style["bold"] = True
                stack.append(style)
            elif ctype == "em_open":
                style = dict(stack[-1])
                style["italic"] = True
                stack.append(style)
            elif ctype == "s_open":
                style = dict(stack[-1])
                style["strike"] = True
                stack.append(style)
            elif ctype == "link_open":
                style = dict(stack[-1])
                style["link"] = child.attrGet("href") or None
                style["color"] = C_LINK
                stack.append(style)
            elif ctype in ("strong_close", "em_close", "s_close", "link_close"):
                if len(stack) > 1:
                    stack.pop()
            elif ctype == "softbreak":
                runs.append((" ", stack[-1]))
            elif ctype == "hardbreak":
                runs.append(("\n", stack[-1]))
            elif ctype == "image":
                alt = ""
                for sub in (child.children or []):
                    if sub.type == "text":
                        alt += sub.content
                alt = alt or (child.attrGet("alt") or "")
                style = dict(stack[-1])
                style.update(color=C_MUTED, italic=True)
                runs.append((f"［图片：{alt}］" if alt else "［图片］", style))
            elif child.content:
                runs.append((child.content, stack[-1]))
        return runs

    def _inline_atoms(self, token, base_style: dict) -> List[dict]:
        atoms: List[dict] = []
        for text, style in self._inline_runs(token, base_style):
            atoms.extend(_atomize(text, style))
        return atoms

    # -- 各种块 -----------------------------------------------------
    def _heading(self, inline, level: int) -> List[dict]:
        scale, before, after, lh = _HEADING_SPEC.get(level, _HEADING_SPEC[6])
        size = self.base * scale
        style = _style(size, bold=True, color=C_TEXT if level <= 3 else C_MUTED)
        runs = self._inline_runs(inline, style)
        atoms: List[dict] = []
        for text, run_style in runs:
            atoms.extend(_atomize(text, run_style))
        width = max(10.0, self.content_w - self.indent)
        wrapped = _wrap_atoms(atoms, width, width)
        out = [self._spacer(before)]
        last = len(wrapped) - 1
        for index, atoms_line in enumerate(wrapped):
            out.append(self._line(atoms_line, self.indent, size, size * lh,
                                  after=(after if index == last else 0.0)))
        return out

    def _paragraph(self, inline) -> List[dict]:
        style = _style(self.base, color=C_TEXT)
        atoms: List[dict] = []
        for text, run_style in self._inline_runs(inline, style):
            atoms.extend(_atomize(text, run_style))
        width = max(10.0, self.content_w - self.indent)
        wrapped = _wrap_atoms(atoms, width, width)
        marker_text = self.pending_marker
        self.pending_marker = None
        if self.lists:
            after = self.base * 0.35
        else:
            after = self.base * 0.6
        bg = C_QUOTE_BG if self.quote > 0 else None
        out: List[dict] = []
        last = len(wrapped) - 1
        for index, atoms_line in enumerate(wrapped):
            marker = None
            if index == 0 and marker_text:
                mstyle = _style(self.base, color=C_TEXT)
                mwidth = _text_width(marker_text, _font_for(marker_text, mstyle), mstyle["size"])
                marker = (marker_text, mstyle, max(0.0, self.indent - 4.0 - mwidth))
            out.append(self._line(atoms_line, self.indent, self.base, self.base * 1.65,
                                  after=(after if index == last else 0.0), bg=bg, marker=marker))
        if not wrapped:
            out.append(self._line([], self.indent, self.base, self.base * 1.65, after=after, bg=bg))
        return out

    def _code(self, token) -> List[dict]:
        raw = str(token.content or "").replace("\r\n", "\n").replace("\r", "\n")
        raw = raw.rstrip("\n")
        lines = raw.split("\n") if raw else [""]
        while lines and lines[0].strip() == "":
            lines.pop(0)
        while lines and lines[-1].strip() == "":
            lines.pop()
        if not lines:
            lines = [""]
        size = self.base * 0.92
        style = _style(size, mono=True, color=C_CODE_TEXT)
        pad = 9.0
        width = max(10.0, self.content_w - pad * 2)
        out = [self._spacer(self.base * 0.7)]
        for raw_line in lines:
            atoms = _atomize(raw_line, style, preserve_spaces=True)
            for atoms_line in _wrap_atoms(atoms, width, width, keep_leading=True):
                text = "".join(a["text"] for a in atoms_line)
                height = size * (1.72 if _line_cjk(text) else 1.5)
                out.append(self._line(atoms_line, pad, size, height, bg=C_CODE_BG))
        out.append(self._spacer(self.base * 0.8))
        return out

    def _quote_blank(self) -> List[dict]:
        """引用块里的空行也铺灰底，保证整块连续。"""
        if self.quote <= 0:
            return []
        return [self._line([], self.indent, self.base, self.base * 0.7, bg=C_QUOTE_BG)]

    def _table(self, tokens: List, start: int) -> Tuple[dict, int]:
        header: Optional[List[List[dict]]] = None
        rows: List[List[List[dict]]] = []
        aligns: List[str] = []
        current: Optional[List[List[dict]]] = None
        in_header = False
        base_style = _style(self.base, color=C_TEXT)
        index = start + 1
        while index < len(tokens) and tokens[index].type != "table_close":
            ttype = tokens[index].type
            if ttype == "thead_open":
                in_header = True
            elif ttype == "thead_close":
                in_header = False
            elif ttype == "tr_open":
                current = []
            elif ttype == "tr_close":
                if current is not None:
                    if in_header and header is None:
                        header = current
                    else:
                        rows.append(current)
                current = None
            elif ttype in ("th_open", "td_open"):
                if in_header or header is None:
                    attrs = getattr(tokens[index], "attrs", None) or {}
                    style_attr = str(attrs.get("style") or "")
                    align = "left"
                    if "center" in style_attr:
                        align = "center"
                    elif "right" in style_attr:
                        align = "right"
                    aligns.append(align)
            elif ttype == "inline" and current is not None:
                current.append(self._inline_atoms(tokens[index], base_style))
            index += 1

        all_rows = ([header] if header else []) + rows
        col_count = max((len(row) for row in all_rows), default=0)
        pad = 4.0
        natural: List[float] = []
        for col in range(col_count):
            widest = 0.0
            for row in all_rows:
                if col < len(row):
                    widest = max(widest, sum(_atom_width(a) for a in row[col]))
            natural.append(min(widest, self.content_w) + 2 * pad + 2.0)
        widths = _fit_widths(natural, self.content_w) if natural else []
        while len(aligns) < col_count:
            aligns.append("left")

        table = {
            "type": "table",
            "col_widths": widths,
            "align": aligns[:col_count],
            "header": header,
            "rows": rows,
            "pad": pad,
            "line_h": max(15.0, self.base * 1.45),
        }
        return table, index + 1

    # -- 主循环 -----------------------------------------------------
    def build(self, tokens: List) -> List[dict]:
        ops: List[dict] = []
        index = 0
        total = len(tokens)
        while index < total:
            token = tokens[index]
            ttype = token.type

            if ttype == "heading_open":
                level = 1
                tag = str(getattr(token, "tag", "") or "")
                if len(tag) > 1 and tag[1:].isdigit():
                    level = int(tag[1:])
                inline = tokens[index + 1] if index + 1 < total else None
                ops.append({"type": "lines", "lines": self._heading(inline, level)})
                index += 3
                continue

            if ttype == "paragraph_open":
                inline = tokens[index + 1] if index + 1 < total else None
                ops.append({"type": "lines", "lines": self._paragraph(inline)})
                index += 3
                continue

            if ttype == "inline":
                # 兜底：没有 paragraph_open 包裹的 inline
                ops.append({"type": "lines", "lines": self._paragraph(token)})
                index += 1
                continue

            if ttype in ("bullet_list_open", "ordered_list_open"):
                entry = {"ordered": ttype == "ordered_list_open", "counter": 0}
                if entry["ordered"]:
                    attrs = getattr(token, "attrs", None) or {}
                    try:
                        entry["counter"] = int(attrs.get("start") or 1) - 1
                    except (TypeError, ValueError):
                        entry["counter"] = 0
                self.indent += LIST_INDENT
                self.lists.append(entry)
                index += 1
                continue

            if ttype in ("bullet_list_close", "ordered_list_close"):
                self.indent = max(0.0, self.indent - LIST_INDENT)
                if self.lists:
                    self.lists.pop()
                if not self.lists:
                    self.pending_marker = None
                index += 1
                continue

            if ttype == "list_item_open":
                if self.lists:
                    entry = self.lists[-1]
                    entry["counter"] += 1
                    self.pending_marker = (f"{entry['counter']}." if entry["ordered"] else "•")
                index += 1
                continue

            if ttype == "list_item_close":
                self.pending_marker = None
                index += 1
                continue

            if ttype == "blockquote_open":
                self.indent += QUOTE_INDENT
                self.quote += 1
                index += 1
                continue

            if ttype == "blockquote_close":
                ops.append({"type": "lines", "lines": self._quote_blank()})
                self.indent = max(0.0, self.indent - QUOTE_INDENT)
                self.quote = max(0, self.quote - 1)
                if self.quote > 0:
                    ops.append({"type": "lines", "lines": self._quote_blank()})
                index += 1
                continue

            if ttype in ("fence", "code_block"):
                ops.append({"type": "lines", "lines": self._code(token)})
                index += 1
                continue

            if ttype == "hr":
                ops.append({"type": "hr"})
                index += 1
                continue

            if ttype == "table_open":
                table, next_index = self._table(tokens, index)
                ops.append(table)
                index = next_index
                continue

            if ttype == "html_block":
                fake = _FakeInline(str(token.content or ""))
                ops.append({"type": "lines", "lines": self._paragraph(fake)})
                index += 1
                continue

            index += 1
        return ops


class _FakeInline:
    """把 html_block 之类的内容伪装成 inline token（只当纯文本画）。"""

    def __init__(self, content: str):
        self.children = [_FakeChild(content)]


class _FakeChild:
    def __init__(self, content: str):
        self.type = "text"
        self.content = content


def _finalize_bg(ops: List[dict]) -> None:
    """给灰色背景块的首尾行补上下内边距，看起来像一整块。"""
    previous = None
    for op in ops:
        if op.get("type") != "lines":
            if previous is not None:
                previous["bg_pad_bottom"] = BG_EDGE_PAD
                previous = None
            continue
        for line in op["lines"]:
            if line.get("bg") is None:
                if previous is not None:
                    previous["bg_pad_bottom"] = BG_EDGE_PAD
                    previous = None
                continue
            if previous is None:
                line["bg_pad_top"] = BG_EDGE_PAD
            previous = line
    if previous is not None:
        previous["bg_pad_bottom"] = BG_EDGE_PAD


def _make_parser() -> MarkdownIt:
    md = MarkdownIt("commonmark", {"html": False, "linkify": False, "typographer": False})
    for rule in ("table", "strikethrough"):
        try:
            md.enable(rule)
        except Exception:
            pass
    return md


def _decode_markdown_bytes(data: bytes) -> str:
    for bom, encoding in ((b"\xef\xbb\xbf", "utf-8-sig"), (b"\xff\xfe", "utf-16"), (b"\xfe\xff", "utf-16")):
        if data.startswith(bom):
            try:
                return data.decode(encoding)
            except UnicodeDecodeError:
                break
    try:
        return data.decode("utf-8")
    except UnicodeDecodeError:
        pass
    try:
        return data.decode("gb18030")
    except UnicodeDecodeError:
        return data.decode("utf-8", errors="replace")


def render_markdown_document(
    md_text: str,
    page_size: str = "a4",
    font_size: float = 12.0,
    title: Optional[str] = None,
) -> Any:
    """把 Markdown 渲染成一个 PyMuPDF 文档对象（供测试直接检查）。"""
    key = PAGE_SIZE_ALIASES.get(str(page_size or "a4").strip().lower())
    if key is None:
        raise MarkdownPdfError(
            f"不支持的纸张尺寸：「{page_size}」，仅支持 a4 或 letter"
        )
    page_w, page_h = PAGE_SIZES[key]
    margin = MARGIN_MM * MM
    content_w = page_w - 2 * margin

    md = _make_parser()
    tokens = md.parse(str(md_text))
    builder = _Builder(font_size, content_w)
    ops = builder.build(tokens)
    _finalize_bg(ops)

    layout = _Layout(page_w, page_h, margin, font_size)
    layout.new_page()
    for op in ops:
        if op["type"] == "lines":
            layout.place_lines(op["lines"])
        elif op["type"] == "table":
            layout.place_table(op)
        elif op["type"] == "hr":
            layout.place_hr()
    layout.draw_footer()
    if title:
        try:
            layout.doc.set_metadata({"title": str(title), "producer": "FurinaKit", "creator": "FurinaKit"})
        except Exception:
            pass
    return layout.doc


def markdown_to_pdf(
    text: Optional[str] = None,
    source_file: Any = None,
    output_dir: Any = None,
    output_path: Any = None,
    page_size: str = "a4",
    font_size: Any = 12,
    title: Optional[str] = None,
) -> Dict[str, Any]:
    """Markdown 源码或 .md 文件 → PDF。

    - source_file 优先（两者都给时用文件）
    - 输出文件名：<原名>.pdf 或 document.pdf
    """
    try:
        src_path: Optional[Path] = None
        raw_file = str(source_file or "").strip()
        if raw_file:
            src_path = Path(raw_file)
            if not src_path.is_file():
                raise MarkdownPdfError(f"找不到 Markdown 文件：{raw_file}")
            try:
                data = src_path.read_bytes()
            except OSError as exc:
                raise MarkdownPdfError(f"无法读取 Markdown 文件：{src_path.name}（{exc}）") from exc
            if len(data) > MAX_MD_BYTES:
                raise MarkdownPdfError(
                    f"Markdown 文件太大（{len(data) / 1048576:.1f} MB），"
                    f"超过 {MAX_MD_BYTES // 1048576} MB 上限"
                )
            md_text = _decode_markdown_bytes(data)
            default_name = f"{src_path.stem}.pdf"
            if not title:
                title = src_path.stem
        else:
            md_text = str(text or "")
            default_name = "document.pdf"

        if not md_text.strip():
            raise MarkdownPdfError("没有可转换的 Markdown 内容：请上传 .md 文件，或在 text 里提供 Markdown 源码")

        size_raw = str(font_size if font_size is not None else 12).strip()
        if size_raw == "":
            size_raw = "12"
        try:
            size_value = float(size_raw)
        except (TypeError, ValueError):
            raise MarkdownPdfError(f"字号必须是数字，收到的是「{font_size}」") from None
        if not (MIN_FONT_SIZE <= size_value <= MAX_FONT_SIZE):
            raise MarkdownPdfError(
                f"字号必须在 {MIN_FONT_SIZE:g} 到 {MAX_FONT_SIZE:g} 之间，收到的是 {size_value:g}"
            )

        doc = render_markdown_document(md_text, page_size=page_size, font_size=size_value, title=title)

        if output_path:
            out = Path(str(output_path))
        else:
            base_dir = Path(str(output_dir or "."))
            out = base_dir / default_name
        if out.parent and str(out.parent):
            out.parent.mkdir(parents=True, exist_ok=True)
        doc.save(str(out), garbage=3, deflate=True)
        pages = doc.page_count
        doc.close()

        size_label = PAGE_SIZE_ALIASES.get(str(page_size or "a4").strip().lower(), "a4")
        return {
            "success": True,
            "output": str(out),
            "filename": out.name,
            "mime": "application/pdf",
            "pages": pages,
            "message": (
                f"Markdown 已转换为 PDF（{pages} 页，"
                f"{'A4' if size_label == 'a4' else 'Letter'} 纸，正文 {size_value:g} 号字，中文用内置字体渲染）"
            ),
        }
    except MarkdownPdfError as exc:
        return failed(exc)
    except Exception as exc:  # noqa: BLE001
        return failed(exc, "生成 PDF 失败")
