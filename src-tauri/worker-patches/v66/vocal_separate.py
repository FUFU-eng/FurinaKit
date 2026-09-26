"""Pinned UVR MDX two-stem inference, implemented with NumPy and ONNX Runtime.

V66: use model-specific FFT metadata, complex spectrum output, periodic Hann,
centered reflection padding, synthesis window-squared normalization and overlapped
waveform chunks. No signal-dependent mask guessing. See docs/mcp-v66-resume.md.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import shutil
import subprocess
from pathlib import Path

import numpy as np

_MODELS = {
    "UVR-MDX-NET-Voc_FT.onnx": (66762490, "534b2070fcc7df514b13ef660dc8cbb328679c2374d04354a5c42bb14ecce111", "Vocals"),
    "UVR-MDX-NET-Inst_HQ_3.onnx": (66759214, "317554b07fe1ea5279a77f2b1520a41ea4b93432560c4ffd08792c30fddf9adc", "Instrumental"),
}
_session = None
_session_key = None


def _ffmpeg() -> str:
    env = os.environ.get("FURINAKIT_FFMPEG_PATH")
    if env and Path(env).is_file():
        return env
    found = shutil.which("ffmpeg")
    if found:
        return found
    for path in (
        Path(os.environ.get("FURINAKIT_RESOURCES_PATH", "")) / "ffmpeg" / "ffmpeg.exe",
        Path.cwd() / "ffmpeg" / "ffmpeg.exe",
        Path.cwd().parent / "resources" / "ffmpeg" / "ffmpeg.exe",
    ):
        if path.is_file():
            return str(path)
    raise RuntimeError("找不到 FFmpeg，无法读写音频 / FFmpeg is unavailable")


def _profile(model_path: str):
    path = Path(model_path).resolve(strict=True)
    expected = _MODELS.get(path.name)
    if not expected or path.stat().st_size != expected[0]:
        raise RuntimeError("分离模型未知或大小不符，请在设置中修复双核心组件 / Unknown or incomplete separation model")
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
        stream.seek(max(0, path.stat().st_size - 10000 * 1024))
        signature = hashlib.md5(stream.read()).hexdigest()
    if digest.hexdigest() != expected[1]:
        raise RuntimeError("分离模型 SHA-256 不符，请重新下载 / Model checksum mismatch")
    profiles = json.loads(Path(__file__).with_name("mdx_profiles.json").read_text(encoding="utf-8"))
    p = profiles["profiles"].get(signature)
    if not p or p["primary_stem"] != expected[2]:
        raise RuntimeError("没有与模型哈希匹配的官方参数，拒绝猜测 FFT / No matching verified FFT profile")
    return path, p


def _load_session(path: Path, p: dict):
    global _session, _session_key
    key = (str(path), path.stat().st_mtime_ns, path.stat().st_size)
    if _session is None or _session_key != key:
        import onnxruntime as ort
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = max(1, min(4, os.cpu_count() or 1))
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        _session = ort.InferenceSession(str(path), sess_options=opts, providers=["CPUExecutionProvider"])
        _session_key = key
    shape = _session.get_inputs()[0].shape
    expected = (1, 4, p["mdx_dim_f_set"], 2 ** p["mdx_dim_t_set"])
    if len(shape) != 4 or any(isinstance(got, int) and got != want for got, want in zip(shape, expected)):
        raise RuntimeError("模型输入维度与已核对参数不符 / Model input shape mismatch")
    return _session


def _decode(audio_path: str, sample_rate: int) -> np.ndarray:
    cmd = [_ffmpeg(), "-nostdin", "-v", "error", "-i", audio_path, "-vn", "-f", "f32le",
           "-acodec", "pcm_f32le", "-ar", str(sample_rate), "-ac", "2", "-"]
    result = subprocess.run(cmd, capture_output=True, timeout=7200)
    if result.returncode != 0 or not result.stdout or len(result.stdout) % 8:
        raise RuntimeError("音频解码失败或没有音轨 / Audio decoding failed or no audio stream")
    audio = np.frombuffer(result.stdout, dtype="<f4").reshape(-1, 2).T.copy()
    if not np.isfinite(audio).all():
        raise RuntimeError("音频含非有限采样值 / Non-finite audio samples")
    return audio


def _encode(path: str, audio: np.ndarray, sample_rate: int) -> None:
    if not np.isfinite(audio).all():
        raise RuntimeError("分离结果包含非有限值 / Non-finite separation result")
    cmd = [_ffmpeg(), "-nostdin", "-v", "error", "-n", "-f", "f32le", "-ar", str(sample_rate),
           "-ac", "2", "-i", "-", "-c:a", "pcm_f32le", path]
    result = subprocess.run(cmd, input=audio.T.astype("<f4").tobytes(), capture_output=True, timeout=7200)
    if result.returncode != 0 or not Path(path).is_file() or Path(path).stat().st_size <= 44:
        raise RuntimeError("音频写出失败 / Failed to write output audio")


def stft(audio: np.ndarray, n_fft: int, hop: int) -> np.ndarray:
    window = np.hanning(n_fft + 1)[:-1].astype(np.float32)
    padded = np.pad(audio, ((0, 0), (n_fft // 2, n_fft // 2)), mode="reflect")
    frames = np.lib.stride_tricks.sliding_window_view(padded, n_fft, axis=-1)[:, ::hop, :]
    return np.fft.rfft(frames * window, axis=-1).transpose(0, 2, 1).astype(np.complex64)


def istft(spectrum: np.ndarray, n_fft: int, hop: int, length: int) -> np.ndarray:
    window = np.hanning(n_fft + 1)[:-1].astype(np.float32)
    frames = spectrum.shape[-1]
    out = np.zeros((2, (frames - 1) * hop + n_fft), dtype=np.float32)
    norm = np.zeros(out.shape[-1], dtype=np.float32)
    waves = np.fft.irfft(spectrum.transpose(0, 2, 1), n=n_fft, axis=-1).astype(np.float32)
    for i in range(frames):
        start = i * hop
        out[:, start:start + n_fft] += waves[:, i] * window
        norm[start:start + n_fft] += window * window
    start = n_fft // 2
    denominator = norm[start:start + length]
    if denominator.shape[0] != length or np.any(denominator <= 1e-8):
        raise RuntimeError("逆变换窗覆盖不足 / Invalid inverse-transform window coverage")
    return out[:, start:start + length] / denominator


def _predict_chunk(wave: np.ndarray, sess, profile: dict) -> np.ndarray:
    n_fft, dim_f, dim_t = profile["mdx_n_fft_scale_set"], profile["mdx_dim_f_set"], 2 ** profile["mdx_dim_t_set"]
    spec = stft(wave, n_fft, 1024)
    inputs = np.stack((spec[0].real, spec[0].imag, spec[1].real, spec[1].imag))[:, :dim_f].copy()
    inputs[:, :3] = 0  # UVR low-frequency suppression, applied before inference.
    inputs = inputs[None].astype(np.float32)
    if inputs.shape != (1, 4, dim_f, dim_t):
        raise RuntimeError("分块频谱维度不正确 / Incorrect chunk spectrum shape")
    name = sess.get_inputs()[0].name
    # Odd-symmetric averaging reduces model bias; outputs are complex spectra, never masks.
    positive = sess.run(None, {name: inputs})[0]
    negative = sess.run(None, {name: -inputs})[0]
    if positive.shape != inputs.shape or negative.shape != inputs.shape:
        raise RuntimeError("模型输出维度不正确 / Model output shape mismatch")
    prediction = (positive[0] - negative[0]) * 0.5
    if not np.isfinite(prediction).all():
        raise RuntimeError("模型返回非有限值 / Model returned non-finite values")
    restored = np.zeros_like(spec)
    restored[0, :dim_f] = prediction[0] + 1j * prediction[1]
    restored[1, :dim_f] = prediction[2] + 1j * prediction[3]
    return istft(restored, n_fft, 1024, wave.shape[1])


def separate(audio_path: str, output_dir: str, model_path: str, sample_rate: int = 44100, progress=None) -> dict:
    if sample_rate != 44100:
        raise ValueError("MDX profiles require 44100 Hz")
    path, profile = _profile(model_path)
    sess = _load_session(path, profile)
    audio = _decode(audio_path, sample_rate)
    length = audio.shape[1]
    n_fft, dim_t = profile["mdx_n_fft_scale_set"], 2 ** profile["mdx_dim_t_set"]
    chunk_size, trim = 1024 * (dim_t - 1), n_fft // 2
    useful = chunk_size - 2 * trim
    if useful <= 0:
        raise RuntimeError("无效分块参数 / Invalid chunk profile")
    step = useful // 2
    padded = np.pad(audio, ((0, 0), (trim, chunk_size)))
    target = np.zeros_like(audio)
    weights = np.zeros(length, dtype=np.float32)
    window = np.hanning(useful + 2)[1:-1].astype(np.float32)
    count = math.ceil(length / step)
    for index, start in enumerate(range(0, length, step)):
        prediction = _predict_chunk(padded[:, start:start + chunk_size], sess, profile)
        end = min(length, start + useful)
        size = end - start
        target[:, start:end] += prediction[:, trim:trim + size] * window[:size]
        weights[start:end] += window[:size]
        if progress:
            progress(min(99, int((index + 1) * 99 / count)))
    if np.any(weights <= 0):
        raise RuntimeError("分离音轨分块覆盖不足 / Incomplete overlap coverage")
    target = target / weights * float(profile["compensate"])
    if profile["primary_stem"] == "Vocals":
        vocals, instrumental = target, audio - target
    else:
        instrumental, vocals = target, audio - target
    if not np.isfinite(vocals).all() or not np.isfinite(instrumental).all():
        raise RuntimeError("分离结果无效 / Invalid separation output")
    peak = max(float(np.max(np.abs(vocals))), float(np.max(np.abs(instrumental))))
    gain = min(1.0, 0.99 / peak) if peak > 0 else 1.0
    vocals, instrumental = vocals * gain, instrumental * gain
    directory = Path(output_dir)
    directory.mkdir(parents=True, exist_ok=True)
    # Fixed, safe basenames inside this job's newly-created temporary directory.
    voc_path, inst_path = directory / "vocals.wav", directory / "instrumental.wav"
    _encode(str(voc_path), vocals, sample_rate)
    _encode(str(inst_path), instrumental, sample_rate)
    rms = lambda x: round(float(np.sqrt(np.mean(x.astype(np.float64) ** 2))), 6)
    if progress:
        progress(100)
    return {"success": True, "vocals": str(voc_path), "instrumental": str(inst_path),
            "durationSec": round(length / sample_rate, 2), "sampleRate": sample_rate,
            "nFft": n_fft, "hop": 1024, "dimF": profile["mdx_dim_f_set"], "dimT": dim_t,
            "vocalsRms": rms(vocals), "instrumentalRms": rms(instrumental), "sourceRms": rms(audio),
            "modelOutputMode": "complex-spectrogram", "primaryStem": profile["primary_stem"],
            "outputGain": gain, "compensate": profile["compensate"]}
