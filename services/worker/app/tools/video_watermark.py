"""视频去水印。

三种方式（和常见的视频去水印工具一致，都是 ffmpeg 的原生能力）：
  · delogo：用水印四周的像素做插值把区域"抹平"，适合压在纯色/渐变背景上的水印；
  · 模糊：把区域做高斯模糊，适合压在复杂画面上的水印（抹不干净但便宜、快）；
  · 裁剪：直接把含水印的边缘裁掉，最干净，但画面会变小。

不做"逐帧 AI 修复"：那要按帧跑图像修复模型，一个几分钟的视频要几十分钟，
在桌面工具里不实用。这里给的三条路都是秒级到分钟级能出结果的做法，
界面上也把各自的取舍写清楚了 —— 用户知道自己选的是什么。

设计约定（与项目其它 worker 模块一致）：对外报错一律中文人话。
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

CREATE_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0
TIMEOUT = 3600


class WatermarkError(Exception):
    """可以直接展示给用户的中文错误。"""


def _ffmpeg() -> str:
    try:
        from app.ffmpeg import get_ffmpeg_path as _find

        return _find()
    except Exception:  # noqa: BLE001
        return shutil.which("ffmpeg") or "ffmpeg"


def _ffprobe() -> str:
    """ffprobe 与 ffmpeg 在同一个目录里，所以从 ffmpeg 的路径直接推出来。

    ★ 不要只写 shutil.which("ffprobe")：winget 装的 ffmpeg 常常不在 PATH 上，
      项目里的 app.ffmpeg 也只找 ffmpeg.exe；只靠 which 会拿到裸命令名，
      subprocess 直接抛 WinError 2（实测踩过）。
    """
    ff = _ffmpeg()
    try:
        cand = os.path.join(os.path.dirname(os.path.abspath(ff)), "ffprobe.exe")
        if os.path.isfile(cand):
            return cand
    except Exception:  # noqa: BLE001
        pass
    return shutil.which("ffprobe") or "ffprobe"


def _run(args: list[str]) -> Tuple[int, str]:
    proc = subprocess.run(
        args, capture_output=True, text=True, encoding="utf-8", errors="replace",
        creationflags=CREATE_NO_WINDOW, timeout=TIMEOUT,
    )
    return proc.returncode, (proc.stderr or "")[-1500:]


def probe_size(path: str) -> Tuple[int, int, float]:
    """返回 (宽, 高, 时长秒)"""
    proc = subprocess.run(
        [_ffprobe(), "-v", "quiet", "-print_format", "json", "-show_streams", "-show_format", path],
        capture_output=True, text=True, encoding="utf-8", errors="replace",
        creationflags=CREATE_NO_WINDOW, timeout=120,
    )
    if proc.returncode != 0:
        raise WatermarkError("这个视频读不出信息（可能不是视频文件，或已损坏）")
    try:
        data = json.loads(proc.stdout or "{}")
    except Exception as exc:  # noqa: BLE001
        raise WatermarkError(f"解析视频信息失败：{exc}") from exc
    w = h = 0
    for s in data.get("streams", []):
        if s.get("codec_type") == "video":
            w = int(s.get("width") or 0)
            h = int(s.get("height") or 0)
            break
    if w == 0 or h == 0:
        raise WatermarkError("这个文件里没有视频画面")
    dur = float((data.get("format") or {}).get("duration") or 0)
    return w, h, dur


def _region(payload: Dict[str, Any], w: int, h: int) -> Tuple[int, int, int, int]:
    """算出要处理的矩形（左上角 x, y 与宽高），并保证在画面内"""
    preset = str(payload.get("position", "bottom-right"))
    frac = {
        "top-left": (0.0, 0.0),
        "top-right": (0.66, 0.0),
        "bottom-left": (0.0, 0.84),
        "bottom-right": (0.66, 0.84),
        "bottom-center": (0.3, 0.86),
        "top-center": (0.3, 0.02),
    }
    rw = int(payload.get("rectW") or 0)
    rh = int(payload.get("rectH") or 0)
    if preset == "custom":
        rx = int(payload.get("rectX") or 0)
        ry = int(payload.get("rectY") or 0)
    else:
        fx, fy = frac.get(preset, (0.66, 0.84))
        rx = int(w * fx)
        ry = int(h * fy)
    if rw <= 0:
        rw = max(40, int(w * 0.3))
    if rh <= 0:
        rh = max(24, int(h * 0.12))
    # ffmpeg 的 delogo 要求区域不能贴边（四周各留 1 像素）
    rx = max(1, min(rx, w - rw - 1))
    ry = max(1, min(ry, h - rh - 1))
    rw = max(4, min(rw, w - rx - 1))
    rh = max(4, min(rh, h - ry - 1))
    return rx, ry, rw, rh


def remove_watermark(path: str, payload: Dict[str, Any], out_path: str) -> Dict[str, Any]:
    if not os.path.isfile(path):
        raise WatermarkError("找不到这个视频")

    mode = str(payload.get("mode", "delogo"))
    w, h, dur = probe_size(path)
    rx, ry, rw, rh = _region(payload, w, h)

    ff = _ffmpeg()
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)

    # 编码参数：优先直接复制音频，视频重编码（画面被改了，必须重编）
    # ★ args 的第一个元素必须是 ffmpeg 可执行文件本身 ——
    #   我第一版直接把 ["-y", "-i", ...] 当成完整命令，subprocess 找不到程序、抛 WinError 2（踩过）。
    common = [ff, "-y", "-i", path]

    if mode == "crop":
        # 裁掉含水印的一边（哪个角的水印就裁哪边）
        pos = str(payload.get("position", "bottom-right"))
        if pos in ("bottom-right", "bottom-left", "bottom-center"):
            cut = h - ry
            vf = f"crop={w}:{max(16, h - cut)}:0:0"
        elif pos in ("top-right", "top-left", "top-center"):
            cut = ry + rh
            vf = f"crop={w}:{max(16, h - cut)}:0:{cut}"
        else:
            vf = f"crop={max(16, rx)}:{h}:0:0"
        args = common + ["-vf", vf, "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
                         "-c:a", "copy", "-movflags", "+faststart", str(out)]
    elif mode == "blur":
        # 把区域抠出来高斯模糊，再叠回去（split → crop → boxblur → overlay）
        vf = (
            f"[0:v]split=2[base][tmp];"
            f"[tmp]crop={rw}:{rh}:{rx}:{ry},boxblur=10:2[blurred];"
            f"[base][blurred]overlay={rx}:{ry}[out]"
        )
        args = common + ["-filter_complex", vf, "-map", "[out]", "-map", "0:a?",
                         "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
                         "-c:a", "copy", "-movflags", "+faststart", str(out)]
    else:
        # delogo：用四周像素做插值覆盖
        args = common + ["-vf", f"delogo=x={rx}:y={ry}:w={rw}:h={rh}",
                         "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
                         "-c:a", "copy", "-movflags", "+faststart", str(out)]

    code, err = _run(args)
    if code != 0 or not out.is_file():
        tail = " ".join(err.split())[-260:]
        raise WatermarkError(f"处理失败：{tail or 'ffmpeg 返回了错误'}")

    nw, nh, ndur = probe_size(str(out))
    return {
        "success": True,
        "output": str(out),
        "mode": mode,
        "region": [rx, ry, rw, rh],
        "before": [w, h, round(dur, 2)],
        "after": [nw, nh, round(ndur, 2)],
    }
