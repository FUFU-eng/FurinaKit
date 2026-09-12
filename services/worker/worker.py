import concurrent.futures
import logging
import os
import re
import signal
import sys
import tempfile
import threading
import time
from concurrent.futures import Future, ThreadPoolExecutor
from typing import Any

# numba (pulled in by rembg → pymatting) caches compiled functions to disk. On Microsoft
# Store Python it cannot write into site-packages/__pycache__, which crashes the import.
# Redirect the cache to a writable temp dir BEFORE any import chain pulls numba in.
os.environ.setdefault("NUMBA_CACHE_DIR", os.path.join(tempfile.gettempdir(), "furinakit-numba"))

from app.config import (
    MAX_CONCURRENT_JOBS_CAP,
    MAX_CONCURRENT_JOBS_ENV,
    SERIAL_TOOL_IDS,
    is_serial_tool,
    resolve_max_concurrent_jobs,
    settings,
)
from app.ffmpeg import ensure_ffmpeg_on_path
from app.file_job_store import dequeue_file_job, requeue_stale_claims
from app.job_store import dequeue_job
from app.tasks import process_job

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("furinakit.worker")

# 优雅停机：收到信号后最多等这么久等在跑的任务结束，超时就不再等并记录日志
SHUTDOWN_GRACE_SECONDS = 30.0
# 单次出队的最长阻塞时间：主循环现在只负责「取任务 → 提交」，短轮询能更快响应退出信号
DEQUEUE_TIMEOUT_SECONDS = 1
# 空队列时的休眠，避免 CPU 忙轮询
IDLE_SLEEP_SECONDS = 0.1


def mask_sensitive_url(url: str | None) -> str:
    """脱敏 URL 中的密码凭据，避免在日志与堆栈中明文泄露"""
    if not url:
        return ""
    return re.sub(r":([^:@]+)@", ":***@", url)


# 运行与优雅停机控制信号
_is_shutting_down = False
# 兼容旧日志行为：最近一次派发的任务 id（并发下真正的全集是 _active_jobs）
_current_active_job: str | None = None
# 最近一个跑完的任务 id（停机时打印「在跑任务已结束」的日志）
_last_finished_job: str | None = None
_active_jobs: set[str] = set()
_active_jobs_lock = threading.Lock()
# 串行化清单里所有工具共用的一把锁：把 GPU/CPU 重任务串起来，避免互相拖垮
_serial_tool_lock = threading.Lock()


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


class WorkerEngine:
    """有界并发的任务引擎。

    并发模型：
      - 线程池 ThreadPoolExecutor(max_concurrent_jobs)，上限来自 MAX_CONCURRENT_JOBS
        （默认 2、硬上限 4、非法值回落默认，见 app/config.py）。
      - 主循环只做「取任务 → 提交线程池 → 继续取下一个」，不再执行任务本身；
        提交前先拿一个信号量槽位（BoundedSemaphore），槽位满时主循环会等待，
        因此队列里不会堆积无限个已提交任务（背压）。
      - 串行清单 SERIAL_TOOL_IDS 里的工具共用一把独立的锁，即使并发上限是 4，
        同一时刻也只会有一个清单内任务在跑；其余工具自由并行。
      - 优雅停机：收到信号后主循环立刻停止取新任务，等待在跑任务结束（上限
        shutdown_grace_seconds），超时只记日志不再等待。

    contextvars 说明：app/tasks.process_job 用 contextvars 记录本任务的临时目录与终态标记。
    contextvars 是「每个线程一份」的（线程池里的工作线程各有一份独立上下文），而 process_job
    自己 set、自己 reset，所以在线程池里并发调用是安全的：两个任务不会看到对方的临时目录
    列表（实测见验证项 3b）。
    """

    def __init__(
        self,
        max_concurrent_jobs: int | None = None,
        shutdown_grace_seconds: float = SHUTDOWN_GRACE_SECONDS,
        # 保持 int：Redis 的 BRPOP 超时必须是整数
        dequeue_timeout_seconds: int = DEQUEUE_TIMEOUT_SECONDS,
    ) -> None:
        self.max_concurrent_jobs = (
            max_concurrent_jobs if max_concurrent_jobs else resolve_max_concurrent_jobs()
        )
        self.shutdown_grace_seconds = shutdown_grace_seconds
        self.dequeue_timeout_seconds = dequeue_timeout_seconds
        self._slots = threading.BoundedSemaphore(self.max_concurrent_jobs)
        self._executor: ThreadPoolExecutor | None = None
        self._futures: dict[Future, str] = {}
        self._futures_lock = threading.Lock()
        self._stop_requested = threading.Event()

    # ── 停机控制 ──────────────────────────────────────────────────────────
    def request_shutdown(self) -> None:
        """请求停机（信号处理函数与测试都用它）"""
        global _is_shutting_down
        _is_shutting_down = True
        self._stop_requested.set()

    def _should_stop(self) -> bool:
        return self._stop_requested.is_set() or _is_shutting_down

    # ── 主循环 ────────────────────────────────────────────────────────────
    def run(self) -> None:
        """主循环：取任务 → 提交线程池 → 继续取下一个（直到收到停机信号）"""
        logger.info(
            "Concurrency: %s=%d (default 2, hard cap %d) — up to %d job(s) run in parallel; "
            "serialized (one at a time) tools: %s",
            MAX_CONCURRENT_JOBS_ENV, self.max_concurrent_jobs, MAX_CONCURRENT_JOBS_CAP,
            self.max_concurrent_jobs, ", ".join(sorted(SERIAL_TOOL_IDS)) or "(none)",
        )
        self._executor = ThreadPoolExecutor(
            max_workers=self.max_concurrent_jobs, thread_name_prefix="furinakit-job"
        )
        try:
            self._dispatch_loop()
        except KeyboardInterrupt:
            logger.info("KeyboardInterrupt received.")
            self.request_shutdown()
        finally:
            self.drain()

    def _dispatch_loop(self) -> None:
        while not self._should_stop():
            # 背压：没有空闲槽位就先等一会儿（而不是把任务无限提交进线程池队列）
            if not self._slots.acquire(timeout=0.2):
                continue
            try:
                use_file = settings.use_file_queue or not is_redis_active()
                if self._should_stop():
                    self._slots.release()
                    break
                job = (
                    dequeue_file_job(timeout=self.dequeue_timeout_seconds)
                    if use_file
                    else dequeue_job(timeout=self.dequeue_timeout_seconds)
                )
            except Exception as exc:  # noqa: BLE001
                self._slots.release()
                # 脱敏提示，防止 Redis 密码随异常 Traceback 泄露
                safe_err = mask_sensitive_url(str(exc))
                logger.warning("Queue read failed: %s. Retrying in 2s...", safe_err)
                time.sleep(2)
                continue

            if not job:
                self._slots.release()
                # 空队列：适当休眠，避免 CPU 忙轮询，同时保证快速响应退出信号
                time.sleep(IDLE_SLEEP_SECONDS)
                continue

            self._submit(job, use_file)

    def _submit(self, job: dict[str, Any], use_file: bool) -> None:
        """把任务交给线程池；槽位由 _execute 在结束时释放（背压计数）"""
        global _current_active_job
        executor = self._executor
        if executor is None:  # pragma: no cover - 只有 run() 之前才会发生
            self._slots.release()
            return

        job_id = job.get("jobId")
        tool_id = job.get("toolId")
        payload = job.get("payload") or {}
        lane = "serial" if is_serial_tool(tool_id) else "parallel"
        logger.info("Processing job %s (%s) [%s lane]", job_id, tool_id, lane)

        with _active_jobs_lock:
            _active_jobs.add(job_id)
            _current_active_job = job_id
        try:
            future = executor.submit(self._execute, job_id, tool_id, payload, use_file)
        except RuntimeError:  # 线程池已关闭（停机竞态）：把槽位还回去
            with _active_jobs_lock:
                _active_jobs.discard(job_id)
                _current_active_job = next(iter(_active_jobs), None)
            self._slots.release()
            logger.warning("Worker is shutting down; job %s was not started.", job_id)
            return
        with self._futures_lock:
            self._futures[future] = str(job_id)
        future.add_done_callback(self._forget_future)

    def _forget_future(self, future: Future) -> None:
        with self._futures_lock:
            self._futures.pop(future, None)

    # ── 任务执行（线程池工作线程）───────────────────────────────────────────
    def _execute(self, job_id: str, tool_id: str, payload: dict[str, Any], use_file: bool) -> None:
        global _current_active_job, _last_finished_job
        serialized = is_serial_tool(tool_id)
        try:
            if serialized:
                logger.info(
                    "Job %s (%s) queued for the serialized lane (thread %s)",
                    job_id, tool_id, threading.current_thread().name,
                )
                with _serial_tool_lock:
                    logger.info(
                        "Running job %s (%s) [serialized] on thread %s",
                        job_id, tool_id, threading.current_thread().name,
                    )
                    process_job(job_id, tool_id, payload, use_file=use_file)
            else:
                logger.info(
                    "Running job %s (%s) [parallel] on thread %s",
                    job_id, tool_id, threading.current_thread().name,
                )
                process_job(job_id, tool_id, payload, use_file=use_file)
        except Exception:  # noqa: BLE001
            # process_job 内部已经兜底（自己写终态、自己清理临时目录、不抛异常），
            # 这里是最后一道防线，保证异常不会打死线程、也不会漏掉槽位释放。
            logger.exception("Unhandled error for job %s", job_id)
        finally:
            with _active_jobs_lock:
                _active_jobs.discard(job_id)
                _last_finished_job = job_id
                _current_active_job = next(iter(_active_jobs), None)
            self._slots.release()

    # ── 停机收尾 ──────────────────────────────────────────────────────────
    def drain(self) -> None:
        """停止取新任务后，等待在跑任务结束（上限 shutdown_grace_seconds）并关闭线程池"""
        executor = self._executor
        if executor is None:
            return
        self._executor = None

        with self._futures_lock:
            pending = list(self._futures)
        still_running: set[Future] = set()

        if pending:
            running_ids = sorted(self._futures.get(f, "?") for f in pending)
            logger.info(
                "Graceful shutdown: waiting up to %.0fs for %d running job(s): %s",
                self.shutdown_grace_seconds, len(pending), ", ".join(running_ids),
            )
            _, still_running = concurrent.futures.wait(
                pending, timeout=self.shutdown_grace_seconds
            )
            if still_running:
                logger.warning(
                    "Graceful shutdown: %d job(s) did not finish within %.0fs (%s); "
                    "not waiting any longer. These worker threads keep running until the process exits.",
                    len(still_running), self.shutdown_grace_seconds,
                    ", ".join(sorted(self._futures.get(f, "?") for f in still_running)),
                )
            else:
                logger.info("Graceful shutdown: all running jobs finished.")

        # wait=True 只在所有任务都已结束时才会立即返回；有超时残留时就不再阻塞。
        # cancel_futures=False：已经出队的任务必须跑完（出队时队列文件已被认领并删除）。
        executor.shutdown(wait=not still_running, cancel_futures=False)

        with _active_jobs_lock:
            leftovers = sorted(_active_jobs)
            last_finished = _last_finished_job
        if leftovers:
            logger.warning(
                "Worker shutting down: %d job(s) were still running: %s",
                len(leftovers), ", ".join(leftovers),
            )
        elif last_finished:
            logger.warning(
                "Worker shutting down: active job %s finished processing.", last_finished
            )


def main() -> None:
    global _redis_status, _last_redis_probe_time
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

    # 回收上一次被强杀时残留的认领文件，避免任务被永久吞掉
    try:
        recovered = requeue_stale_claims()
        if recovered:
            logger.warning("Recovered %d stale claimed job file(s) back into the queue.", recovered)
    except Exception:  # noqa: BLE001 - 回收失败绝不能挡住 worker 启动
        logger.exception("Failed to recover stale claimed job files.")

    WorkerEngine().run()
    logger.info("FurinaKit worker stopped cleanly.")


if __name__ == "__main__":
    main()
