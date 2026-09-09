import json
from datetime import datetime, timezone
from typing import Any

import redis

from app.config import settings

JOB_PREFIX = "furinakit:job:"
ACTIVE_JOBS_KEY = "furinakit:active_jobs"
JOB_QUEUE = "furinakit:job_queue"

_client: redis.Redis | None = None


def get_redis() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.from_url(settings.redis_url, decode_responses=True)
    return _client


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def get_job(job_id: str) -> dict[str, Any] | None:
    client = get_redis()
    raw = client.get(f"{JOB_PREFIX}{job_id}")
    if not raw:
        return None
    return json.loads(raw)


def update_job(job_id: str, **updates: Any) -> dict[str, Any] | None:
    job = get_job(job_id)
    if not job:
        return None

    job.update(updates)
    job["updatedAt"] = _now()

    client = get_redis()
    client.set(f"{JOB_PREFIX}{job_id}", json.dumps(job))

    status = job.get("status")
    if status in {"completed", "failed"}:
        client.srem(ACTIVE_JOBS_KEY, job_id)

    return job


def dequeue_job(timeout: int = 5) -> dict[str, Any] | None:
    client = get_redis()
    item = client.brpop(JOB_QUEUE, timeout=timeout)
    if not item:
        return None
    _, raw = item
    return json.loads(raw)
