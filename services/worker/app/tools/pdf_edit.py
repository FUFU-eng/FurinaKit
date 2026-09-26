"""PDF 编辑器的页面操作。

编辑器要的是「所见即所得地改页面」：删一页、复制一页、转个方向、把第 5 页挪到第 2 页、
插一页空白、把另一份 PDF 追加到后面。这些操作都在页面层完成，不动页面内容本身，
所以文字依然可选中搜索、清晰度不变。

设计上只接受一个 ops 列表，按顺序执行；每一步都做越界检查并给出明确原因，
不静默跳过 —— 用户点了删除却什么都没发生是最糟的体验。

op 形如：
  {"type": "delete", "pages": [1, 3]}            删除第 1、3 页（页号从 1 开始）
  {"type": "duplicate", "pages": [2], "times": 1} 复制第 2 页一次，插在其后
  {"type": "rotate", "pages": [1], "angle": 90}   顺时针旋转（支持 90/180/270）
  {"type": "move", "from": 5, "to": 2}            把第 5 页挪到第 2 位
  {"type": "blank", "after": 2, "count": 1, "size": "same|a4"} 在第 2 页后插空白页
  {"type": "reverse"}                             整份倒序
  {"type": "append", "file": "另一个.pdf"}         追加另一份 PDF
"""

from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List

import pymupdf as fitz


def _pages_arg(op: Dict[str, Any], total: int, key: str = "pages") -> List[int]:
    """把页码参数转成 0 基索引，并做越界检查"""
    raw = op.get(key)
    if raw is None:
        raise RuntimeError(f"「{op.get('type')}」操作缺少页码")
    if isinstance(raw, int):
        nums = [raw]
    elif isinstance(raw, str):
        nums = []
        for part in raw.split(","):
            part = part.strip()
            if not part:
                continue
            if "-" in part:
                a, b = part.split("-")
                nums.extend(range(int(a), int(b) + 1))
            else:
                nums.append(int(part))
    else:
        nums = [int(x) for x in raw]

    out: List[int] = []
    for n in nums:
        if n < 1 or n > total:
            raise RuntimeError(f"第 {n} 页不存在（当前共 {total} 页）")
        out.append(n - 1)
    if not out:
        raise RuntimeError("没有指定任何页面")
    return out


def pdf_edit(file_path: str, output_path: str, ops: List[Dict[str, Any]]) -> Dict[str, Any]:
    """按 ops 顺序编辑 PDF，返回每步的执行结果"""
    src = Path(file_path)
    if src.suffix.lower() != ".pdf":
        raise RuntimeError("只支持 PDF 文件")
    if not ops:
        raise RuntimeError("没有任何编辑操作")

    doc = fitz.open(str(src))
    applied: List[Dict[str, Any]] = []

    for index, op in enumerate(ops, start=1):
        kind = str(op.get("type", "")).lower()
        total = len(doc)

        if kind == "delete":
            idx = sorted(_pages_arg(op, total), reverse=True)
            if len(idx) >= total:
                raise RuntimeError("不能把所有页面都删掉，至少保留一页")
            for i in idx:
                doc.delete_page(i)
            applied.append({"step": index, "type": kind, "pages": [i + 1 for i in idx], "remaining": len(doc)})

        elif kind == "duplicate":
            idx = _pages_arg(op, total)
            times = max(1, min(20, int(op.get("times", 1))))
            # 从后往前插，避免前面的插入影响后面的下标
            for i in sorted(idx, reverse=True):
                for t in range(times):
                    doc.copy_page(i, i + 1 + t)
            applied.append({"step": index, "type": kind, "pages": [i + 1 for i in idx], "times": times, "remaining": len(doc)})

        elif kind == "rotate":
            idx = _pages_arg(op, total)
            angle = int(op.get("angle", 90))
            if angle not in (90, 180, 270, -90, -180, -270):
                raise RuntimeError("旋转角度只能是 90 / 180 / 270")
            for i in idx:
                page = doc[i]
                page.set_rotation((page.rotation + angle) % 360)
            applied.append({"step": index, "type": kind, "pages": [i + 1 for i in idx], "angle": angle})

        elif kind == "move":
            frm = int(op.get("from", 0))
            to = int(op.get("to", 0))
            if frm < 1 or frm > total or to < 1 or to > total:
                raise RuntimeError(f"页码超出范围（当前共 {total} 页）")
            doc.move_page(frm - 1, to - 1)
            applied.append({"step": index, "type": kind, "from": frm, "to": to})

        elif kind == "blank":
            after = int(op.get("after", total))
            if after < 0 or after > total:
                raise RuntimeError(f"插入位置超出范围（当前共 {total} 页）")
            count = max(1, min(20, int(op.get("count", 1))))
            # 尺寸：与原页一致，或固定 A4
            if str(op.get("size", "same")) == "a4":
                size = (595.0, 842.0)
            else:
                ref = doc[after - 1] if after >= 1 else doc[0]
                size = (ref.rect.width, ref.rect.height)
            for c in range(count):
                doc.new_page(pno=after + c, width=size[0], height=size[1])
            applied.append({"step": index, "type": kind, "after": after, "count": count, "remaining": len(doc)})

        elif kind == "reverse":
            # 用 select 一次性按倒序重排页面。
            # 早先我用「反复 move_page」的写法，实测得到的是错序（PAGE-2,4,3,1,5），
            # 原因是移动过程中下标基准一直在变。select 是按给定顺序重建，语义明确。
            order = list(range(len(doc)))[::-1]
            doc.select(order)
            applied.append({"step": index, "type": kind, "remaining": len(doc)})

        elif kind == "append":
            other = op.get("file")
            if not other or not Path(str(other)).is_file():
                raise RuntimeError("要追加的 PDF 不存在")
            extra = fitz.open(str(other))
            doc.insert_pdf(extra)
            extra.close()
            applied.append({"step": index, "type": kind, "remaining": len(doc)})

        else:
            raise RuntimeError(f"不支持的编辑操作「{kind}」")

    doc.save(str(output_path), garbage=3, deflate=True)
    pages = len(doc)
    doc.close()
    return {"success": True, "output": output_path, "pages": pages, "applied": applied}


def pdf_page_info(file_path: str) -> Dict[str, Any]:
    """列出每页尺寸与旋转角，供编辑器界面显示缩略图信息"""
    doc = fitz.open(file_path)
    mm = 72 / 25.4
    pages = [
        {
            "page": i + 1,
            "width_mm": round(p.rect.width / mm, 1),
            "height_mm": round(p.rect.height / mm, 1),
            "rotation": p.rotation,
        }
        for i, p in enumerate(doc)
    ]
    doc.close()
    return {"success": True, "pages": pages, "count": len(pages)}
