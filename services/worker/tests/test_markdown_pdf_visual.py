# -*- coding: utf-8 -*-
"""Markdown → PDF 的视觉回归：中文加粗绝对不能糊成黑块。

背景：这里曾经用 PyMuPDF 的「假粗体」`render_mode=2` + `border_width` 描边来实现加粗，
中文（内置 china-s 字体）描边后笔画连成一坨，整段看起来像黑疙瘩。
现在改成两遍 insert_text（第二遍沿 x 方向偏移 `size * 0.02`），字形必须干净。

关键：**不能只看抽出来的文字** —— 糊成黑块时文字照样能正确抽出（这正是当初漏掉这个 bug 的原因）。
所以这里把 PDF 栅格化，逐行统计暗像素比例：
  - 整页暗像素占比不能太高；
  - 不允许出现成片黑块的行（单行暗像素 > 35%）。

venv 里没有 pytest，用 stdlib unittest：`python -m unittest discover -s tests -v`
直接运行本文件（`python tests/test_markdown_pdf_visual.py`）会额外打印一份人看的报告并存一张预览图。
"""

import os
import sys
import tempfile
import unittest

import pymupdf as fitz

# 允许 `python tests/test_markdown_pdf_visual.py` 直接跑（其它测试要求从 worker 根目录启动）
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)

from app.tools import markdown_pdf  # noqa: E402

MD = """# 芙宁娜工具箱 使用说明

这是一段**加粗的中文正文**，用来检查加粗是否会把字糊成黑块。混排 English words 与数字 1234567890。

## 二级标题：功能介绍

- 普通列表项：支持**批量**处理
- 带 `行内代码` 的条目
- 长句测试：把一段比较长的中文文字放进列表里，看看换行与行距是否正常，字与字之间会不会粘连在一起。

> 引用块：**注意**，历史签名会留存一个月，请及时保存。

```python
def hello(name: str) -> str:
    return f"你好，{name}"
```

最后一段收尾，**整段加粗**：这是一整段全部加粗的中文，如果假粗体有问题，这一整段都会变成黑疙瘩。
"""

# 成片黑块的判定阈值：一行里超过这个比例的像素是暗的，就认为「糊了」
BLACK_ROW_RATIO = 0.35
# 整页暗像素占比上限（正常正文页在 3% 上下）
PAGE_DARK_LIMIT = 0.05


def render_markdown(text, output_dir, font_size=15):
    result = markdown_pdf.markdown_to_pdf(
        text=text,
        source_file=None,
        output_dir=output_dir,
        page_size="a4",
        font_size=font_size,
    )
    assert result.get("success"), f"生成 PDF 失败: {result.get('error')}"
    return result


def row_dark_ratios(pdf_path):
    """返回 (每页暗像素占比, 暗像素超过阈值的行, 全文文字)"""
    page_ratios = []
    black_rows = []
    with fitz.open(pdf_path) as doc:
        for pno in range(doc.page_count):
            pix = doc[pno].get_pixmap(dpi=140, colorspace=fitz.csGRAY)
            width, height, channels = pix.width, pix.height, pix.n
            samples = pix.samples
            dark_total = 0
            for y in range(height):
                base = y * width * channels
                row_dark = 0
                for x in range(width):
                    if samples[base + x * channels] < 128:
                        row_dark += 1
                dark_total += row_dark
                ratio = row_dark / width
                if ratio > BLACK_ROW_RATIO:
                    black_rows.append((pno + 1, y, round(ratio, 4)))
            page_ratios.append(dark_total / (width * height))
        text = "".join(doc[i].get_text() for i in range(doc.page_count))
    return page_ratios, black_rows, text


class MarkdownPdfVisualTests(unittest.TestCase):
    def _check(self, font_size):
        with tempfile.TemporaryDirectory() as td:
            result = render_markdown(MD, td, font_size=font_size)
            pdf_path = result["output"]
            self.assertGreater(os.path.getsize(pdf_path), 2000, "PDF 太小，多半没渲染出内容")
            page_ratios, black_rows, text = row_dark_ratios(pdf_path)

        self.assertTrue(page_ratios, "没有渲染出任何页面")
        avg = sum(page_ratios) / len(page_ratios)
        self.assertLess(avg, PAGE_DARK_LIMIT, f"整页暗像素占比过高（{avg * 100:.2f}%），像是有黑块")
        self.assertFalse(black_rows, f"出现了成片黑块的行: {black_rows[:8]}")
        return text

    def test_chinese_bold_has_no_black_blocks(self):
        text = self._check(font_size=15)
        # 顺带确认文字没丢（黑块能把文字抽出来，所以这两条不是主证据，只是补充）
        self.assertIn("芙宁娜工具箱", text)
        self.assertIn("加粗的中文正文", text)
        self.assertIn("整段加粗", text)

    def test_tiny_font_also_clean(self):
        # 小字号笔画更容易粘连，13 号字下同样不允许出现黑块
        self._check(font_size=13)


def _manual():
    """人看的报告：打印结论并存一张预览图（写文件用眼睛复核）"""
    with tempfile.TemporaryDirectory() as td:
        result = render_markdown(MD, td)
        pdf_path = result["output"]
        page_ratios, black_rows, _ = row_dark_ratios(pdf_path)
        shot = os.path.join(tempfile.gettempdir(), "fk-markdown-pdf-page1.png")
        with fitz.open(pdf_path) as doc:
            doc[0].get_pixmap(dpi=150).save(shot)
        print("PDF:", pdf_path, os.path.getsize(pdf_path), "字节")
        print("预览图:", shot)
        print("每页暗像素占比:", [f"{r * 100:.2f}%" for r in page_ratios])
        print(f"暗像素 > {BLACK_ROW_RATIO:.0%} 的行数:", len(black_rows))
        print("最暗的 10 行:", sorted(black_rows, key=lambda t: -t[2])[:10] or "（没有超过阈值的行）")


if __name__ == "__main__":
    _manual()
    unittest.main(verbosity=2)
