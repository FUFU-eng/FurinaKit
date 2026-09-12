"""既有引擎工具的回归测试：证明这次改动没有碰坏任何现有能力。

覆盖（按任务要求）：images-to-pdf、pdf-merge、video-compress、video-to-gif、audio-merge。
每个都在两个层面验证：
  1) 直接调用 app/tools 里的函数；
  2) 走真实 tasks.py 的 process_job 分发链路（这一步同时证明新增分支没有影响既有分支的分发）。
不联网：素材全部现场生成。
"""

import unittest
from pathlib import Path

import pymupdf as fitz
from PIL import Image

from app.tasks import _safe_filename
from app.tools import audio_tools, pdf_tools, video_tools
from tests._job_harness import WorkerToolTest, make_audio, make_video, probe_duration


def make_png(path: Path, color, size=(200, 150)) -> str:
    Image.new("RGB", size, color).save(str(path))
    return str(path)


def make_pdf(path: Path, label: str) -> str:
    doc = fitz.open()
    page = doc.new_page(width=300, height=200)
    page.insert_text((40, 80), label)
    doc.save(str(path))
    doc.close()
    return str(path)


class ImagesToPdfRegressionTests(WorkerToolTest):
    def test_module_merges_two_images(self):
        first = make_png(self.work / "a.png", (255, 0, 0))
        second = make_png(self.work / "b.png", (0, 0, 255))
        out = str(self.work / "images.pdf")
        result = pdf_tools.images_to_pdf([first, second], out, page_size="a4", orientation="portrait")
        self.assertTrue(result.get("success"), result.get("error"))
        doc = fitz.open(out)
        try:
            self.assertEqual(doc.page_count, 2)
        finally:
            doc.close()

    def test_job_merges_two_images(self):
        first = make_png(self.work / "c.png", (0, 255, 0))
        second = make_png(self.work / "d.png", (255, 255, 0))
        job = self.run_job("images-to-pdf", {"files": [first, second], "merge_mode": "merge",
                                            "page_size": "a4", "orientation": "portrait"})
        path = self.assert_job_ok(job)
        self.assertEqual(job["resultMimeType"], "application/pdf")
        doc = fitz.open(str(path))
        try:
            self.assertEqual(doc.page_count, 2)
        finally:
            doc.close()

    def test_job_individual_returns_zip(self):
        first = make_png(self.work / "e.png", (10, 10, 10))
        second = make_png(self.work / "f.png", (240, 240, 240))
        job = self.run_job("images-to-pdf", {"files": [first, second], "merge_mode": "individual"})
        path = self.assert_job_ok(job)
        self.assertEqual(job["resultMimeType"], "application/zip")
        self.assertEqual(path.suffix, ".zip")


class PdfMergeRegressionTests(WorkerToolTest):
    def test_module_merges_two_pdfs(self):
        first = make_pdf(self.work / "one.pdf", "page one")
        second = make_pdf(self.work / "two.pdf", "page two")
        out = str(self.work / "merged.pdf")
        result = pdf_tools.pdf_merge([first, second], out)
        self.assertTrue(result.get("success"), result.get("error"))
        doc = fitz.open(out)
        try:
            self.assertEqual(doc.page_count, 2)
            self.assertIn("page one", doc[0].get_text())
            self.assertIn("page two", doc[1].get_text())
        finally:
            doc.close()

    def test_job_merges_two_pdfs(self):
        first = make_pdf(self.work / "three.pdf", "alpha")
        second = make_pdf(self.work / "four.pdf", "beta")
        job = self.run_job("pdf-merge", {"files": [first, second]})
        path = self.assert_job_ok(job)
        self.assertEqual(job["resultFilename"], "merged.pdf")
        self.assertEqual(job["resultMimeType"], "application/pdf")
        doc = fitz.open(str(path))
        try:
            self.assertEqual(doc.page_count, 2)
        finally:
            doc.close()

    def test_job_pdf_compress_still_works(self):
        source = make_pdf(self.work / "source.pdf", "compress me")
        job = self.run_job("pdf-compress", {"file": source, "quality": 60})
        path = self.assert_job_ok(job)
        doc = fitz.open(str(path))
        try:
            self.assertGreaterEqual(doc.page_count, 1)
        finally:
            doc.close()


class VideoCompressRegressionTests(WorkerToolTest):
    def test_module_compresses(self):
        source = make_video(self.work / "big.mp4", duration=5, gop=10)
        out_path, name, mime = video_tools.compress_video(source, "low", None, None)
        self.assertTrue(Path(out_path).is_file())
        self.assertEqual(mime, "video/mp4")
        self.assertEqual(name, "big_compressed.mp4")
        self.assertAlmostEqual(probe_duration(out_path), 5.0, delta=0.6)
        self.assertLess(Path(out_path).stat().st_size, Path(source).stat().st_size,
                        "压缩后的文件应该更小")

    def test_job_compresses(self):
        source = make_video(self.work / "big2.mp4", duration=4, gop=10)
        job = self.run_job("video-compress", {"file": source, "quality": "low"})
        path = self.assert_job_ok(job)
        self.assertEqual(job["resultFilename"], "big2_compressed.mp4")
        self.assertEqual(job["resultMimeType"], "video/mp4")
        self.assertAlmostEqual(probe_duration(path), 4.0, delta=0.6)


class VideoToGifRegressionTests(WorkerToolTest):
    def test_module_makes_gif(self):
        source = make_video(self.work / "gifme.mp4", duration=3, gop=10)
        out_path, name, mime = video_tools.video_to_gif(source, 0, 2, 160, 8, None)
        self.assertEqual(mime, "image/gif")
        self.assertEqual(name, "gifme.gif")
        with Image.open(out_path) as img:
            self.assertEqual(img.format, "GIF")
            self.assertEqual(img.size[0], 160)
            self.assertGreaterEqual(getattr(img, "n_frames", 1), 2)

    def test_job_makes_gif(self):
        source = make_video(self.work / "gifme2.mp4", duration=3, gop=10)
        job = self.run_job("video-to-gif", {"file": source, "start_time": 0, "duration": 2,
                                           "width": 120, "fps": 8})
        path = self.assert_job_ok(job)
        self.assertEqual(job["resultMimeType"], "image/gif")
        with Image.open(path) as img:
            self.assertEqual(img.size[0], 120)
            self.assertGreaterEqual(getattr(img, "n_frames", 1), 2)


class AudioMergeRegressionTests(WorkerToolTest):
    def test_module_merges_two_mp3(self):
        first = make_audio(self.work / "one.mp3", duration=2)
        second = make_audio(self.work / "two.mp3", duration=2)
        out = str(self.work / "merged_audio.mp3")
        result = audio_tools.audio_merge([first, second], out)
        self.assertTrue(result.get("success"), result.get("error"))
        self.assertEqual(result.get("count"), 2)
        self.assertAlmostEqual(probe_duration(out), 4.0, delta=0.8)
        self.assertFalse(Path(out + ".txt").exists(), "临时的 concat 列表文件必须被清掉")

    def test_job_merges_two_mp3(self):
        first = make_audio(self.work / "three.mp3", duration=2)
        second = make_audio(self.work / "four.mp3", duration=2)
        job = self.run_job("audio-merge", {"files": [first, second]})
        path = self.assert_job_ok(job)
        self.assertEqual(job["resultFilename"], "merged_audio.mp3")
        self.assertAlmostEqual(probe_duration(path), 4.0, delta=0.8)

    def test_job_merge_requires_two_files(self):
        only = make_audio(self.work / "only.mp3", duration=2)
        job = self.run_job("audio-merge", {"file": only})
        self.assert_job_failed(job, "请选择至少两个音频文件")


class SafeFilenameTests(WorkerToolTest):
    """`_safe_filename`（结果文件落地时的清洗）：中文与扩展名必须活下来。

    背景（已修）：旧实现是 `re.sub(r"[^a-zA-Z0-9._-]+","_",name).strip("._")`，
    中文名会被整段替换成 `_`，紧接着 `.strip("._")` 又把扩展名前的那个点吃掉：
    `数据.xlsx` → `_.xlsx` → `xlsx`（交付给用户的文件没有扩展名，双击打不开）。
    """

    def test_chinese_name_keeps_stem_and_extension(self):
        # 作者给的验收表：这几行是这次修复的核心
        self.assertEqual(_safe_filename("数据.xlsx"), "数据.xlsx")
        self.assertEqual(_safe_filename("我的文档.pdf"), "我的文档.pdf")
        self.assertEqual(_safe_filename("测试图.png"), "测试图.png")
        self.assertEqual(_safe_filename("数据.csv"), "数据.csv")
        self.assertEqual(_safe_filename("说明文档.md"), "说明文档.md")

    def test_ascii_names_stay_byte_identical_to_old_behaviour(self):
        # 修中文不能顺手改掉英文名的行为：这些必须与旧实现逐字节一致
        self.assertEqual(_safe_filename("video.mp4"), "video.mp4")
        self.assertEqual(_safe_filename("clip-trimmed.mp4"), "clip-trimmed.mp4")
        self.assertEqual(_safe_filename("a b c.csv"), "a_b_c.csv")
        self.assertEqual(_safe_filename("report final.pdf"), "report_final.pdf")
        self.assertEqual(_safe_filename("a.tar.gz"), "a.tar.gz")
        self.assertEqual(_safe_filename("a_.csv"), "a_.csv")      # 旧实现同样是 a_.csv
        self.assertEqual(_safe_filename("a .csv"), "a_.csv")      # 空格先变 _，所以右侧不会被再删
        self.assertEqual(_safe_filename("abc_"), "abc")           # 无扩展名时两端都清
        self.assertEqual(_safe_filename(".hidden"), "hidden")
        self.assertEqual(_safe_filename("..\\..\\evil.mp4"), "evil.mp4")
        self.assertEqual(_safe_filename("报告 2024 总结.docx"), "报告_2024_总结.docx")

    def test_illegal_characters_are_replaced_but_chinese_kept(self):
        self.assertEqual(_safe_filename('a<b>c:d"e/f\\g|h?i*j.png'), "a_b_c_d_e_f_g_h_i_j.png")
        self.assertEqual(_safe_filename("数据<坏>字符.xlsx"), "数据_坏_字符.xlsx")
        self.assertEqual(_safe_filename("tab\tname.txt"), "tab_name.txt")

    def test_windows_reserved_names_are_prefixed(self):
        for name, expected in (
            ("CON", "_CON"),
            ("con.txt", "_con.txt"),
            ("PRN.pdf", "_PRN.pdf"),
            ("aux", "_aux"),
            ("NUL", "_NUL"),
            ("COM1.mp4", "_COM1.mp4"),
            ("lpt9.docx", "_lpt9.docx"),
        ):
            with self.subTest(name=name):
                self.assertEqual(_safe_filename(name), expected)

    def test_empty_or_all_illegal_falls_back_with_extension(self):
        # 不能回退成没有扩展名的东西；result.bin 与旧实现的回退值一致
        for name in ("", "/", "\\", "...", "???", None):
            with self.subTest(name=name):
                self.assertEqual(_safe_filename(name), "result.bin")
        # 有扩展名但主名全废：保留扩展名
        self.assertEqual(_safe_filename("???.pdf"), "result.pdf")

    def test_overlong_stem_is_capped_ext_kept(self):
        long_name = "a" * 300 + ".txt"
        result = _safe_filename(long_name)
        self.assertEqual(len(result), 84)                  # 80 主名 + ".txt"
        self.assertTrue(result.endswith(".txt"))
        long_cn = "中文文件名" * 40 + ".xlsx"
        result_cn = _safe_filename(long_cn)
        self.assertTrue(result_cn.endswith(".xlsx"))
        self.assertLessEqual(len(result_cn.split(".")[0]), 80)

    def test_chinese_extension_is_not_dropped(self):
        self.assertEqual(_safe_filename("文件.中国"), "文件.中国")

    def test_no_path_separator_can_survive(self):
        for name in ("../etc/passwd", "..\\..\\windows\\system32\\cmd.exe", "/abs/path.mp4",
                     "C:\\Users\\x\\文档.pdf"):
            with self.subTest(name=name):
                result = _safe_filename(name)
                self.assertNotIn("/", result)
                self.assertNotIn("\\", result)
                self.assertFalse(result.startswith("."))


class ExistingBehaviourDocumentationTests(WorkerToolTest):
    """把「刻意没有改动的既有行为」钉在测试里，避免以后被无意改掉。"""

    def test_unsupported_tool_id_still_raises(self):
        job = self.run_job("definitely-not-a-tool", {})
        self.assertEqual(job.get("status"), "failed")
        self.assertIn("Unsupported tool", str(job.get("error")))

    def test_video_thumbnail_legacy_branch_is_untouched(self):
        """video-thumbnail（含 bilibili/douyin）这段既有分支必须逐字不变。

        本次新增的本地抽帧用的是独立 id `video-frame-extract`，绝不与它抢路由。
        这里做源文件级断言（比运行时断言更直接，也不会触发任何网络调用）。
        """
        source = (Path(__file__).resolve().parents[1] / "app" / "tasks.py").read_text(encoding="utf-8")
        legacy = (
            '    if tool_id in ("video-thumbnail", "bilibili-thumbnail", "douyin-thumbnail"):\n'
            '        from app.tools.video import download_thumbnail\n'
        )
        self.assertIn(legacy, source, "既有的 video-thumbnail 分支被改动了")
        self.assertIn('if tool_id == "video-frame-extract":', source,
                      "新的本地抽帧分支应该用独立 id")
        # 新增抽帧分支里不允许出现老分支的条件写法（避免以后有人把两者合并成多态）
        self.assertNotIn('tool_id == "video-thumbnail" and', source,
                         "不应该存在「video-thumbnail + 本地文件」的多态守卫")


if __name__ == "__main__":
    unittest.main(verbosity=2)
