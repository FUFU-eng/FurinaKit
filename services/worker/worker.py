import logging
import os
import re
import signal
import sys
import tempfile
import time
from typing import Any

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


def mask_sensitive_url(url: str | None) -> str:
    """脱敏 URL 中的密码凭据，避免在日志与堆栈中明文泄露"""
    if not url:
        return ""
    return re.sub(r":([^:@]+)@", ":***@", url)


# 运行与优雅停机控制信号
_is_shutting_down = False
_current_active_job: str | None = None


def handle_shutdown_signal(signum: int, _frame: Any) -> None:
    """监听系统关闭或 Ctrl+C 信号，启动优雅停机流程"""
    global _is_shutting_down
    sig_name = signal.Signals(signum).name if hasattr(signal, "Signals") else str(signum)
    logger.info("Received termination signal %s. Initiating graceful shutdown...", sig_name)
    _is_shutting_down = True


# 注册跨平台退出信号捕获
signal.signal(signal.SIGINT, handle_shutdown_signal)
signal.signal(signal.SIGTERM, handle_shutdown_signal)
if hasattr(signal, "SIGBREAK"):
    signal.signal(signal.SIGBREAK, handle_shutdown_signal)


def check_redis_connection() -> tuple[bool, str | None]:
    """细化 Redis 连接探测，提供结构化诊断与脱敏提示"""
    if settings.use_file_queue:
        return False, "file_queue_forced"

    safe_url = mask_sensitive_url(settings.redis_url)
    try:
        import redis
        client = redis.from_url(settings.redis_url, socket_connect_timeout=2, socket_timeout=2)
        client.ping()
        return True, None
    except (ImportError, ModuleNotFoundError):
        return False, "redis_module_not_installed"
    except Exception as exc:
        exc_type = type(exc).__name__
        # 仅记录异常类型与脱敏后的目标地址，坚决不泄露密码堆栈
        logger.debug("Redis ping failed (%s) on %s", exc_type, safe_url)
        return False, f"{exc_type}"


_redis_status: bool = False
_last_redis_probe_time: float = 0.0
REDIS_PROBE_COOLDOWN = 30.0  # 若 Redis 失效，每 30 秒重新探测一次，支持热恢复


def is_redis_active() -> bool:
    """动态获取 Redis 可用性，支持离线降级与恢复自愈"""
    global _redis_status, _last_redis_probe_time
    if settings.use_file_queue:
        return False

    now = time.time()
    if not _redis_status and (now - _last_redis_probe_time > REDIS_PROBE_COOLDOWN):
        _last_redis_probe_time = now
        ok, reason = check_redis_connection()
        if ok != _redis_status:
            _redis_status = ok
            if ok:
                logger.info("Redis connection recovered! Switching queue mode to redis.")
            else:
                logger.debug("Redis remains unavailable (%s), continuing with file queue.", reason)
    return _redis_status


def main() -> None:
    global _redis_status, _last_redis_probe_time, _current_active_job
    _redis_status, _ = check_redis_connection()
    _last_redis_probe_time = time.time()

    initial_mode = "redis" if _redis_status else "file queue"
    logger.info("FurinaKit worker started (%s)", initial_mode)

    ffmpeg_dir = ensure_ffmpeg_on_path()
    if ffmpeg_dir:
        logger.info("ffmpeg found: %s", ffmpeg_dir)
    else:
        logger.warning(
            "ffmpeg not found — MP3 extraction and high-quality video merging will fail. "
            "Install it (winget install Gyan.FFmpeg) and restart the worker."
        )

    try:
        while not _is_shutting_down:
            use_file = settings.use_file_queue or not is_redis_active()
            try:
                # 轮询间隔：若正在关闭则直接跳过读取
                if _is_shutting_down:
                    break
                job = dequeue_file_job() if use_file else dequeue_job(timeout=2)
            except Exception as exc:  # noqa: BLE001
                # 脱敏提示，防止 Redis 密码随异常 Traceback 泄露
                safe_err = mask_sensitive_url(str(exc))
                logger.warning("Queue read failed: %s. Retrying in 2s...", safe_err)
                time.sleep(2)
                continue

            if not job:
                # 适当休眠，避免在空队列时 CPU 忙轮询，同时保证快速响应退出信号
                time.sleep(0.1)
                continue

            job_id = job.get("jobId")
            tool_id = job.get("toolId")
            payload = job.get("payload", {})
            _current_active_job = job_id
            logger.info("Processing job %s (%s)", job_id, tool_id)

            try:
                process_job(job_id, tool_id, payload, use_file=use_file)
            except Exception:  # noqa: BLE001
                logger.exception("Unhandled error for job %s", job_id)
            finally:
                _current_active_job = None

    except KeyboardInterrupt:
        logger.info("KeyboardInterrupt received.")
    finally:
        if _current_active_job:
            logger.warning("Worker shutting down: active job %s finished processing.", _current_active_job)
        logger.info("FurinaKit worker stopped cleanly.")


if __name__ == "__main__":
    main()
