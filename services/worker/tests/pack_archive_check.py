"""打包归档读取器：检查 furinakit-worker.exe 里到底有哪些 Python 模块。

用法：
    .venv\\Scripts\\python.exe tests\\pack_archive_check.py [exe路径] [模块名 ...]

要点（这也是最容易踩的坑）：onefile exe 的**纯 Python 模块不在外层 CArchive 的 toc 里**，
外层 toc 只有二进制 / 数据文件和一个 "PYZ.pyz"，必须用 `open_embedded_archive("PYZ.pyz")`
把内嵌归档打开，才能看到 openpyxl / markdown_it 这些模块。
只看外层 toc 会把所有纯 Python 依赖都误判成「不在包里」。

退出码：0 = 目标模块全部找到；1 = 有缺失；2 = 用法/文件问题。
"""

import sys
from pathlib import Path

from PyInstaller.archive.readers import CArchiveReader

DEFAULT_EXE = Path(__file__).resolve().parents[1] / "dist" / "furinakit-worker.exe"
DEFAULT_TARGETS = [
    "openpyxl",
    "et_xmlfile",
    "markdown_it",
    "mdurl",
    "pymupdf",
    "fitz",
    "app.tools.csv_excel",
    "app.tools.markdown_pdf",
    "app.tools.media_probe",
    "app.tools.video_trim",
    "app.tools.audio_trim",
]


def load_tocs(exe: Path):
    """返回 (外层归档条目名集合, PYZ 里的模块名集合)。"""
    reader = CArchiveReader(str(exe))
    outer = list(reader.toc.keys())
    modules = []
    for name in outer:
        if "PYZ" in str(name).upper():
            try:
                modules = list(reader.open_embedded_archive(name).toc.keys())
            except Exception as exc:  # pragma: no cover
                print(f"[!] 打开内嵌归档 {name} 失败: {exc}")
            break
    return outer, modules


def main(argv: list) -> int:
    exe = Path(argv[1]) if len(argv) > 1 else DEFAULT_EXE
    targets = argv[2:] or DEFAULT_TARGETS
    if not exe.is_file():
        print(f"[X] 找不到 exe: {exe}")
        return 2

    print(f"归档: {exe}")
    print(f"大小: {exe.stat().st_size / 1048576:.1f} MB")
    outer, modules = load_tocs(exe)
    print(f"外层归档条目: {len(outer)}    PYZ 里的纯 Python 模块: {len(modules)}")
    print()

    missing = []
    for target in targets:
        mod_hits = [m for m in modules if m == target or m.startswith(target + ".")]
        data_hits = [n for n in outer if str(n).replace("\\", "/").startswith(target + "/")]
        total = len(mod_hits) + len(data_hits)
        print(f"  {'OK  ' if total else 'MISS'} {target:26s} 模块 {len(mod_hits):4d}  数据 {len(data_hits):3d}  "
              f"例: {(mod_hits[:2] or data_hits[:2])}")
        if total == 0:
            missing.append(target)

    print()
    if missing:
        print(f"结论：缺失 {missing}")
        return 1
    print("结论：目标模块全部在归档里")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
