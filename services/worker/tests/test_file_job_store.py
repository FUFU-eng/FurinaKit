import json
import os
import tempfile
import time
import unittest
import uuid

from app.file_job_store import (
    QUEUE_FILE_PATTERN,
    dequeue_file_job,
    get_job,
    is_valid_job_id,
)
from app.tasks import _safe_filename


class JobIdValidationTests(unittest.TestCase):
    def test_accepts_plain_uuid(self):
        sample = str(uuid.uuid4())
        self.assertTrue(is_valid_job_id(sample))

    def test_rejects_path_traversal_and_garbage(self):
        for bad in (
            "",
            "../../secrets.json",
            "..\\..\\secrets.json",
            "not-a-uuid",
            "123e4567-e89b-12d3-a456-nothex",
        ):
            self.assertFalse(is_valid_job_id(bad), bad)

    def test_queue_pattern_matches_frontend_filename(self):
        name = f"{int(time.time() * 1000)}-{uuid.uuid4()}.json"
        self.assertIsNotNone(QUEUE_FILE_PATTERN.fullmatch(name))
        self.assertIsNone(QUEUE_FILE_PATTERN.fullmatch("bad.json"))


class FileStorePathSafetyTests(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        os.environ["STORAGE_PATH"] = self._tmp.name

    def tearDown(self):
        os.environ.pop("STORAGE_PATH", None)
        self._tmp.cleanup()

    def test_get_job_rejects_non_uuid_without_reading_disk(self):
        self.assertIsNone(get_job("../../outside"))

    def test_dequeue_file_job_only_reads_valid_queue_names(self):
        from app.file_job_store import jobs_dir, queue_dir

        jobs_dir()
        queue = queue_dir()

        valid_payload = {"jobId": str(uuid.uuid4()), "toolId": "image-compress"}
        valid_name = f"{int(time.time() * 1000)}-{valid_payload['jobId']}.json"
        valid_path = queue / valid_name
        valid_path.write_text(json.dumps(valid_payload), encoding="utf-8")

        # A malformed queue file with an older mtime must be ignored.
        malicious_path = queue / "evil.json"
        malicious_path.write_text("{}", encoding="utf-8")
        old = valid_path.stat().st_mtime - 10
        os.utime(malicious_path, (old, old))

        item = dequeue_file_job(timeout=1)
        self.assertIsNotNone(item)
        self.assertEqual(item["toolId"], "image-compress")


class FilenameSanitizationTests(unittest.TestCase):
    def test_strips_path_separators(self):
        self.assertEqual(_safe_filename("..\\..\\evil.mp4"), "evil.mp4")

    def test_prefix_keeps_safe_name_stable(self):
        self.assertEqual(_safe_filename("report final.pdf"), "report_final.pdf")

    def test_empty_falls_back(self):
        self.assertEqual(_safe_filename("/"), "result.bin")


if __name__ == "__main__":
    unittest.main()
