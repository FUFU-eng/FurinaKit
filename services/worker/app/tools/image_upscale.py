"""Real-ESRGAN ncnn-vulkan 图片超分处理。"""

import os
import re
import subprocess
import tempfile
from pathlib import Path

# Real-ESRGAN 可执行文件和模型目录
WORKER_DIR = Path(__file__).parent.parent.parent
UPSCALE_EXE = WORKER_DIR / "upscale" / "realesrgan-ncnn-vulkan.exe"
UPSCALE_MODELS_DIR = WORKER_DIR / "upscale" / "models"

# 支持的模型
MODELS = {
    "anime-x2": "realesr-animevideov3-x2",
    "anime-x3": "realesr-animevideov3-x3",
    "anime-x4": "realesr-animevideov3-x4",
    "real-x4": "realesrgan-x4plus",
}

# 缓存探测到的 GPU 设备号
_cached_gpu_id = None


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


def _probe_gpu_id():
    """探测 NVIDIA 独显设备号，结果缓存。"""
    global _cached_gpu_id
    if _cached_gpu_id is not None:
        return _cached_gpu_id

    if not UPSCALE_EXE.exists():
        return 0

    try:
        # 用一张小图预热，获取设备列表
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
            in_path = f.name
        out_path = in_path + ".out.png"

        # 创建一张 64x64 的测试图
        from PIL import Image
        Image.new("RGB", (64, 64), (128, 128, 128)).save(in_path, "PNG")

        args = [
            str(UPSCALE_EXE),
            "-i", in_path,
            "-o", out_path,
            "-n", "realesr-animevideov3-x2",
            "-s", "2",
            "-g", "0",
            "-t", "0",
            "-m", str(UPSCALE_MODELS_DIR),
        ]
        proc = subprocess.run(
            args,
            capture_output=True,
            timeout=60,
            cwd=str(UPSCALE_EXE.parent),
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
        stderr_text = proc.stderr.decode("utf-8", errors="replace")
        gid = _find_nvidia_gpu(stderr_text)
        if gid is not None:
            _cached_gpu_id = gid

        # 清理临时文件
        try:
            os.unlink(in_path)
            if os.path.exists(out_path):
                os.unlink(out_path)
        except Exception:
            pass
    except Exception:
        pass

    return _cached_gpu_id if _cached_gpu_id is not None else 0


def upscale_image(input_path: str, model: str = "anime-x2", scale: int = 2):
    """执行图片超分，返回 (输出路径, 文件名)。

    Args:
        input_path: 输入图片路径
        model: 模型名称，可选 anime-x2, anime-x3, anime-x4, real-x4
        scale: 放大倍数（2, 3, 4）

    Returns:
        (output_path, filename)
    """
    if not UPSCALE_EXE.exists():
        raise RuntimeError(f"找不到超分引擎: {UPSCALE_EXE}")

    model_name = MODELS.get(model, "realesr-animevideov3-x2")
    gpu_id = _probe_gpu_id()

    # 生成输出路径
    input_path = Path(input_path)
    output_path = input_path.parent / f"{input_path.stem}_upscaled{input_path.suffix}"

    args = [
        str(UPSCALE_EXE),
        "-i", str(input_path),
        "-o", str(output_path),
        "-n", model_name,
        "-s", str(scale),
        "-g", str(gpu_id),
        "-t", "0",
        "-m", str(UPSCALE_MODELS_DIR),
    ]

    proc = subprocess.run(
        args,
        capture_output=True,
        timeout=300,
        cwd=str(UPSCALE_EXE.parent),
        creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
    )

    if proc.returncode != 0:
        stderr_text = proc.stderr.decode("utf-8", errors="replace")
        raise RuntimeError(f"超分引擎执行失败（exit={proc.returncode}）: {stderr_text[-500:]}")

    if not output_path.exists() or output_path.stat().st_size == 0:
        raise RuntimeError("超分未生成输出文件")

    return str(output_path), output_path.name
