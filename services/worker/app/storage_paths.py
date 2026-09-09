from pathlib import Path
import json
import os

from app.config import settings


def _load_electron_settings():
    """读取Electron端保存的设置文件（路径从环境变量读取，不硬编码盘符）"""
    settings_file_str = os.environ.get("FURINAKIT_SETTINGS_FILE")
    if settings_file_str:
        settings_file = Path(settings_file_str)
    else:
        # 降级：尝试常见位置
        candidates = [
            Path.home() / "AppData" / "Roaming" / "FurinaKit" / "furinakit-settings.json",
            Path(r"E:\FurinaKit\furinakit-settings.json"),
        ]
        settings_file = None
        for c in candidates:
            if c.exists():
                settings_file = c
                break
        if settings_file is None:
            return {}
    
    if settings_file.exists():
        try:
            with open(settings_file, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
    return {}


def storage_dir() -> Path:
    """存储目录（包含jobs/queue/results/uploads四个子目录）
    优先从STORAGE_PATH环境变量读取，确保前端和worker路径一致
    """
    storage_path = os.environ.get("STORAGE_PATH")
    if storage_path:
        root = Path(storage_path)
        root.mkdir(parents=True, exist_ok=True)
        return root
    
    # 否则使用默认配置
    configured = Path(settings.storage_dir)
    if configured.is_absolute():
        root = configured
    else:
        root = (Path(__file__).resolve().parents[1] / configured).resolve()
    root.mkdir(parents=True, exist_ok=True)
    return root


def output_dir() -> Path:
    """输出目录（用户下载的文件保存的位置）
    优先使用Electron端设置的outputDir，其次使用环境变量中的默认输出目录
    """
    # 优先使用Electron端设置的outputDir
    electron_settings = _load_electron_settings()
    output_dir_str = electron_settings.get("outputDir")
    if output_dir_str:
        root = Path(output_dir_str)
        root.mkdir(parents=True, exist_ok=True)
        return root
    
    # 其次使用环境变量中的默认输出目录
    default_output = os.environ.get("FURINAKIT_DEFAULT_OUTPUT_DIR")
    if default_output:
        root = Path(default_output)
        root.mkdir(parents=True, exist_ok=True)
        return root
    
    # 否则使用存储目录下的results子目录
    return storage_dir() / "results"


def storage_root() -> Path:
    """兼容旧代码：返回存储目录（包含jobs/queue/results/uploads）
    注意：旧代码可能误以为这是输出目录，但实际上这是存储目录
    """
    return storage_dir()


def results_dir() -> Path:
    """结果文件目录：优先使用输出目录，否则使用存储目录下的results子目录"""
    path = output_dir()
    path.mkdir(parents=True, exist_ok=True)
    return path


def uploads_dir() -> Path:
    path = storage_dir() / "uploads"
    path.mkdir(parents=True, exist_ok=True)
    return path
