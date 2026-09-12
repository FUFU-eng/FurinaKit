import logging
import os

from pydantic_settings import BaseSettings

logger = logging.getLogger("furinakit.config")

# ── 并发上限 ────────────────────────────────────────────────────────────────
# worker 用 ThreadPoolExecutor 并行处理任务，上限由环境变量 MAX_CONCURRENT_JOBS 决定：
#   默认 2，硬上限 4（超过 4 会被夹到 4），非法值（非数字/小于 1）回落到默认值。
# 之所以给硬上限：本机是桌面端，GPU 推理、LibreOffice/ffmpeg 子进程、磁盘 I/O 都有物理上限，
# 盲目并发只会互相拖垮（详见 SERIAL_TOOL_IDS）。
DEFAULT_MAX_CONCURRENT_JOBS = 2
MAX_CONCURRENT_JOBS_CAP = 4
MAX_CONCURRENT_JOBS_ENV = "MAX_CONCURRENT_JOBS"


class Settings(BaseSettings):
    redis_url: str = "redis://127.0.0.1:6379/0"
    storage_dir: str = "../../data/storage"
    # 注意：worker 实际用的是 resolve_max_concurrent_jobs()（环境变量优先 + 硬上限夹取），
    # 这个字段既是 .env 的读取入口，也是环境变量缺省时的兜底来源。
    max_concurrent_jobs: int = DEFAULT_MAX_CONCURRENT_JOBS
    job_ttl_hours: int = 24
    use_file_queue: bool = False

    # Optional auth for login-gated downloads (Instagram, age-restricted X, etc.).
    # cookies_from_browser: a browser name (firefox/brave/edge/chrome) for yt-dlp to
    # read cookies from; cookies_file: path to a Netscape cookies.txt export.
    cookies_from_browser: str = ""
    cookies_file: str = ""

    class Config:
        env_file = ".env"
        extra = "ignore"  # don't crash on unrecognized keys in .env


settings = Settings()


# ── 串行执行清单（一次只允许跑一个的任务）──────────────────────────────────
# worker 会用一把独立锁（app 层不再关心）把这些工具串行化：即使并发上限是 4，
# 同一时刻也只会有一个清单内的任务在跑。加入清单的理由分两类：
#   1) GPU / 显存敏感：同时跑会抢显存（OOM）或让两个推理都降速；
#   2) 重度 CPU / 内存：底层是 LibreOffice / PDF 版面重排这类吃满 CPU 和内存的进程，
#      并行只会让整机抖动、总耗时反而更长。
# 不在此清单里的工具（图片压缩、格式转换、文本类、ffmpeg 视频/音频等）默认并行。
SERIAL_TOOL_IDS: frozenset[str] = frozenset({
    # ── GPU / 显存敏感 ──
    "bg-remove",        # rembg / onnxruntime 推理，模型常驻显存，并发直接 OOM
    "image-upscale",    # Real-ESRGAN 类放大，显存占用与输入面积成正比
    # ── 重度 CPU / 内存 ──
    "pdf-to-word",      # LibreOffice / PDF 版面重排
    "word-to-pdf",      # LibreOffice headless
    "excel-to-pdf",     # LibreOffice headless
    "ppt-to-pdf",       # LibreOffice headless
    "pdf-to-excel",     # PDF 表格重排
    "pdf-to-ppt",       # PDF 版面重排
})


def resolve_max_concurrent_jobs(raw_value: str | None = None) -> int:
    """解析并发上限：环境变量 MAX_CONCURRENT_JOBS 优先，默认 2，硬上限 4，非法值回落默认。

    - 环境变量显式给了值：非数字 / 小于 1 → 回落默认 2；大于硬上限 → 夹到 4（并告警）。
    - 环境变量缺失：退回 .env / 字段默认（settings.max_concurrent_jobs），同样受夹取保护。
    """
    source = "env"
    if raw_value is None:
        raw_value = os.environ.get(MAX_CONCURRENT_JOBS_ENV)
    if raw_value is None or str(raw_value).strip() == "":
        source = "settings"
        raw_value = settings.max_concurrent_jobs

    try:
        value = int(str(raw_value).strip())
    except (TypeError, ValueError):
        logger.warning(
            "%s=%r is not an integer; falling back to default %d",
            MAX_CONCURRENT_JOBS_ENV, raw_value, DEFAULT_MAX_CONCURRENT_JOBS,
        )
        return DEFAULT_MAX_CONCURRENT_JOBS

    if value < 1:
        logger.warning(
            "%s=%d is out of range (must be >= 1); falling back to default %d",
            MAX_CONCURRENT_JOBS_ENV, value, DEFAULT_MAX_CONCURRENT_JOBS,
        )
        return DEFAULT_MAX_CONCURRENT_JOBS

    if value > MAX_CONCURRENT_JOBS_CAP:
        logger.warning(
            "%s=%d exceeds the hard cap %d (from %s); clamping to %d",
            MAX_CONCURRENT_JOBS_ENV, value, MAX_CONCURRENT_JOBS_CAP, source, MAX_CONCURRENT_JOBS_CAP,
        )
        return MAX_CONCURRENT_JOBS_CAP

    return value


def is_serial_tool(tool_id: str | None) -> bool:
    """工具是否需要独占执行（见 SERIAL_TOOL_IDS）。"""
    return bool(tool_id) and tool_id in SERIAL_TOOL_IDS
