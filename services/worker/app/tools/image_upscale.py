import os
import re
import subprocess
import sys
import tempfile
from pathlib import Path

def get_upscale_paths():
    """动态获取 Real-ESRGAN 可执行文件及模型目录，全面兼容开发、运行时打包环境。"""
    candidates = []
    # 1. 打包环境（可执行文件所在目录及上级 resources）
    if getattr(sys, "frozen", False):
        exe_dir = Path(sys.executable).parent
        candidates.extend([
            exe_dir / "upscale",
            exe_dir / "resources" / "upscale",
            exe_dir.parent / "resources" / "upscale",
            exe_dir.parent / "upscale",
        ])
    else:
        exe_dir = Path(sys.executable).parent
        candidates.extend([
            exe_dir / "upscale",
            exe_dir / "resources" / "upscale",
            exe_dir.parent / "resources" / "upscale",
        ])
    
    # 2. 模块文件自身路径回溯（开发环境）
    cur = Path(__file__).resolve()
    candidates.extend([
        cur.parents[2] / "upscale",
        cur.parents[3] / "services" / "worker" / "upscale",
        cur.parents[4] / "services" / "worker" / "upscale" if len(cur.parents) > 4 else None,
    ])
    
    # 3. 当前工作目录回溯
    cwd = Path.cwd()
    candidates.extend([
        cwd / "services" / "worker" / "upscale",
        cwd / "resources" / "upscale",
        cwd / "upscale",
    ])

    for base in candidates:
        if base and (base / "realesrgan-ncnn-vulkan.exe").is_file():
            return (base / "realesrgan-ncnn-vulkan.exe"), (base / "models")

    # 兜底回退
    fallback = Path(__file__).resolve().parents[2] / "upscale"
    return (fallback / "realesrgan-ncnn-vulkan.exe"), (fallback / "models")

# 支持的模型
MODELS = {
    "anime-x2": "realesr-animevideov3",
    "anime-x3": "realesr-animevideov3",
    "anime-x4": "realesr-animevideov3",
    "real-x4": "realesrgan-x4plus",
}

# 缓存探测到的 GPU 设备号
_cached_gpu_id = None
_cached_gpu_key = None


def _parse_gpu_devices(stderr: str):
    """从 exe 输出解析设备列表。"""
    devices = []
    for m in re.finditer(r"\[(\d+)\s+([^\]]+)\]\s+queueC", stderr):
        try:
            devices.append((int(m.group(1)), m.group(2).strip()))
        except Exception:
            continue
    return devices


def _find_nvidia_gpu(stderr: str):
    """在输出中找 NVIDIA/GeForce/RTX 设备号。"""
    for gid, name in _parse_gpu_devices(stderr):
        low = name.lower()
        if "nvidia" in low or "geforce" in low or "rtx" in low:
            return gid
    return None


def _probe_gpu_id(exe=None, models_dir=None):
    """Probe exactly the resource pair used for inference; cache by that pair."""
    global _cached_gpu_id, _cached_gpu_key
    if exe is None or models_dir is None:
        exe, models_dir = get_upscale_paths()
    key = (str(exe.absolute()), str(models_dir.absolute()))
    if _cached_gpu_key == key and _cached_gpu_id is not None:
        return _cached_gpu_id
    if not exe.exists():
        return 0
    try:
        from PIL import Image
        with tempfile.TemporaryDirectory(prefix="furina-upscale-probe-") as temp:
            in_path = Path(temp) / "input.png"
            out_path = Path(temp) / "output.png"
            Image.new("RGB", (64, 64), (128, 128, 128)).save(in_path, "PNG")
            args = [str(exe), "-i", str(in_path), "-o", str(out_path),
                    "-n", "realesr-animevideov3", "-s", "2", "-g", "0", "-t", "0",
                    "-m", str(models_dir)]
            proc = subprocess.run(args, capture_output=True, timeout=60, cwd=str(exe.parent),
                                  creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
            if proc.returncode == 0:
                gid = _find_nvidia_gpu(proc.stderr.decode("utf-8", errors="replace"))
                if gid is not None:
                    _cached_gpu_key, _cached_gpu_id = key, gid
                    return gid
    except Exception:
        pass  # Preserve legacy default-GPU behavior; actual inference still reports failure.
    return 0


def upscale_image(input_path: str, model: str = "anime-x2", scale: int = 2):
    """Use opt-in verified resources for the entire task, or unchanged legacy discovery."""
    from app.tools.upscale_component import acquire_upscale
    with acquire_upscale() as selected:
        exe, models_dir = selected if selected is not None else get_upscale_paths()
        return _upscale_image_with_paths(input_path, model, scale, exe, models_dir)


def _upscale_image_with_paths(input_path, model, scale, exe, models_dir):
    if not exe.exists():
        raise RuntimeError(f"找不到超分引擎: {exe}。请确保已在 resources 或 worker 目录下部署 upscale/realesrgan-ncnn-vulkan.exe")

    model_name = MODELS.get(model, "realesr-animevideov3")
    gpu_id = _probe_gpu_id(exe, models_dir)

    # Run the RGB network on RGB pixels only. NCNN's RGBA path may yield a zero alpha
    # plane even for opaque screenshot PNGs. Preserve source alpha separately and reapply
    # it after inference; never trust the engine's alpha channel or overwrite original input.
    from PIL import Image, ImageOps
    input_path = Path(input_path)
    with Image.open(input_path) as source:
        source = ImageOps.exif_transpose(source).convert("RGBA")
        source.load()
        source_alpha = source.getchannel("A")
        if source_alpha.getextrema()[1] == 0:
            raise RuntimeError("输入图片完全透明，无法强化；请重新截图或更换图片")
        source_size = source.size
        rgb = source.convert("RGB")
    with tempfile.TemporaryDirectory(prefix="furina-upscale-") as temp:
        prepared = Path(temp) / "input.png"
        result = Path(temp) / "output.png"
        rgb.save(prepared, "PNG")
        args = [str(exe), "-i", str(prepared), "-o", str(result), "-n", model_name,
                "-s", str(scale), "-g", str(gpu_id), "-t", "128", "-m", str(models_dir)]
        proc = subprocess.run(args, capture_output=True, timeout=300, cwd=str(exe.parent),
                              creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
        if proc.returncode != 0:
            raise RuntimeError(f"超分引擎执行失败（exit={proc.returncode}）: {proc.stderr.decode('utf-8',errors='replace')[-500:]}")
        if not result.is_file() or result.stat().st_size == 0:
            raise RuntimeError("超分未生成输出文件")
        with Image.open(result) as rendered:
            rendered.load()
            expected = (source_size[0]*scale, source_size[1]*scale)
            if rendered.size != expected:
                raise RuntimeError(f"超分输出尺寸异常：{rendered.size}，预期{expected}")
            output = rendered.convert("RGB")
            if source_alpha.getextrema() != (255,255):
                output = output.convert("RGBA")
                output.putalpha(source_alpha.resize(expected,Image.Resampling.LANCZOS))
            import uuid
            output_path = input_path.parent / f"{input_path.stem}_upscaled_{uuid.uuid4().hex[:8]}.png"
            output.save(output_path,"PNG")
    return str(output_path), output_path.name
