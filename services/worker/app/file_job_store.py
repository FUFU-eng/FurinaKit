import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.storage_paths import storage_root

UUID_PATTERN = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
QUEUE_FILE_PATTERN = re.compile(
    r"^[0-9]+-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.json$"
)


def _storage_root() -> Path:
    return storage_root()


def jobs_dir() -> Path:
    path = _storage_root() / "jobs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def queue_dir() -> Path:
    path = _storage_root() / "queue"
    path.mkdir(parents=True, exist_ok=True)
    return path


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def is_valid_job_id(job_id: str) -> bool:
    """A job id must be a plain UUID so it can never escape the jobs dir."""
    return bool(job_id) and UUID_PATTERN.fullmatch(job_id) is not None


def get_job(job_id: str) -> dict[str, Any] | None:
    if not is_valid_job_id(job_id):
        return None
    job_path = jobs_dir() / f"{job_id}.json"
    if not job_path.exists():
        return None
    return json.loads(job_path.read_text(encoding="utf-8"))


def update_job(job_id: str, **updates: Any) -> dict[str, Any] | None:
    job = get_job(job_id)
    if not job:
        return None

    job.update(updates)
    job["updatedAt"] = _now()
    job_path = jobs_dir() / f"{job_id}.json"
    job_path.write_text(json.dumps(job), encoding="utf-8")
    return job


def dequeue_file_job(timeout: int = 5) -> dict[str, Any] | None:
    deadline = time.time() + timeout
    while time.time() < deadline:
        queue = queue_dir()
        candidates = [
            p for p in queue.glob("*.json")
            if QUEUE_FILE_PATTERN.fullmatch(p.name)
        ]
        if candidates:
            item_path = min(candidates, key=lambda p: p.stat().st_mtime)
            payload = json.loads(item_path.read_text(encoding="utf-8"))
            item_path.unlink(missing_ok=True)
            return payload
        time.sleep(0.5)
    return None
