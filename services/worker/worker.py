import logging
import os
import tempfile
import time

# numba (pulled in by rembg → pymatting) caches compiled functions to disk. On Microsoft
# Store Python it cannot write into site-packages/__pycache__, which crashes the import.
# Redirect the cache to a writable temp dir BEFORE any import chain pulls numba in.
os.environ.setdefault("NUMBA_CACHE_DIR", os.path.join(tempfile.gettempdir(), "furinakit-numba"))

from app.config import settings
from app.ffmpeg import ensure_ffmpeg_on_path
from app.file_job_store import dequeue_file_job
from app.job_store import dequeue_job
from app.tasks import process_job

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("furinakit.worker")


def redis_available() -> bool:
    if settings.use_file_queue:
        return False
    try:
        import redis
        client = redis.from_url(settings.redis_url, socket_connect_timeout=2, socket_timeout=2)
        client.ping()
        return True
    except Exception:
        return False


_redis_ok: bool | None = None


def main() -> None:
    global _redis_ok
    if _redis_ok is None:
        _redis_ok = redis_available() if not settings.use_file_queue else False
    use_file = settings.use_file_queue or not _redis_ok
    mode = "file queue" if use_file else "redis"
    logger.info("FurinaKit worker started (%s)", mode)

    ffmpeg_dir = ensure_ffmpeg_on_path()
    if ffmpeg_dir:
        logger.info("ffmpeg found: %s", ffmpeg_dir)
    else:
        logger.warning("ffmpeg not found — MP3 extraction and high-quality video merging will fail. "
                       "Install it (winget install Gyan.FFmpeg) and restart the worker.")

    while True:
        try:
            job = dequeue_file_job() if use_file else dequeue_job(timeout=5)
        except Exception:  # noqa: BLE001
            logger.exception("Queue read failed, retrying in 2s")
            time.sleep(2)
            continue
        if not job:
            continue

        job_id = job.get("jobId")
        tool_id = job.get("toolId")
        payload = job.get("payload", {})
        logger.info("Processing job %s (%s)", job_id, tool_id)

        try:
            process_job(job_id, tool_id, payload, use_file=use_file)
        except Exception:  # noqa: BLE001
            logger.exception("Unhandled error for job %s", job_id)


if __name__ == "__main__":
    main()
