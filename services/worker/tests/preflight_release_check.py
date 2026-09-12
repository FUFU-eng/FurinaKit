# -*- coding: utf-8 -*-
"""发布前自检：venv 依赖是否齐全、现有 worker exe 里有没有本轮新增的工具模块。"""
import importlib
import sys
import zipfile

print("Python:", sys.version.split()[0])
print("=== venv 依赖 ===")
for m in ["openpyxl", "markdown_it", "mdurl", "fitz", "docx", "pptx", "PIL"]:
    try:
        mod = importlib.import_module(m)
        print("  {:<12} OK   {}".format(m, getattr(mod, "__version__", "")))
    except Exception as e:
        print("  {:<12} 缺失 -> {}".format(m, e))

print("=== 现有 worker exe 的内容（两层结构：外层 CArchive + 内层 PYZ）===")
p = r"E:\FurinaKit\services\worker\dist\furinakit-worker.exe"
z = zipfile.ZipFile(p)
names = z.namelist()
pyz = [n for n in names if n.lower().endswith(".pyz")]
print("  外层条目数:", len(names), " PYZ:", pyz)
mods = []
if pyz:
    inner = zipfile.ZipFile(z.open(pyz[0]))
    mods = inner.namelist()
print("  PYZ 里模块数:", len(mods))
want = [
    "app.tasks",
    "app.tools.markdown_pdf",
    "app.tools.csv_excel",
    "app.tools.video_trim",
    "app.tools.audio_trim",
    "app.tools.media_probe",
]
for w in want:
    hit = [m for m in mods if m.replace("/", ".").startswith(w)]
    print("  {:<28} {}".format(w, "有" if hit else "**没有**"))
for w in ["openpyxl", "markdown_it", "mdurl"]:
    hit = [m for m in mods if m.replace("/", ".").startswith(w)]
    print("  {:<28} {}".format(w + " (三方库)", "有 ({})".format(len(hit)) if hit else "**没有**"))
