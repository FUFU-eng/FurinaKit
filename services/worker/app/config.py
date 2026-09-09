from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    redis_url: str = "redis://127.0.0.1:6379/0"
    storage_dir: str = "../../data/storage"
    max_concurrent_jobs: int = 10
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
