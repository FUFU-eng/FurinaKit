"""Minimal ctypes ABI for sherpa-onnx v1.13.8 only.
Declarations adapted from sherpa-onnx/c-api/c-api.h, Copyright 2023-2026 Xiaomi
Corporation and contributors, Apache-2.0. Full license accompanies this patch.
No downloaded code is imported until an explicit offline synthesis request.
"""
from __future__ import annotations
import array
import ctypes as C
import os
import sys
import wave
from pathlib import Path
from app.tools import tts_components as components

class SherpaOnnxOfflineTtsVitsModelConfig(C.Structure):
    _fields_ = [
        ("model", C.c_char_p),
        ("lexicon", C.c_char_p),
        ("tokens", C.c_char_p),
        ("data_dir", C.c_char_p),
        ("noise_scale", C.c_float),
        ("noise_scale_w", C.c_float),
        ("length_scale", C.c_float),
        ("dict_dir", C.c_char_p),
    ]

class SherpaOnnxOfflineTtsMatchaModelConfig(C.Structure):
    _fields_ = [
        ("acoustic_model", C.c_char_p),
        ("vocoder", C.c_char_p),
        ("lexicon", C.c_char_p),
        ("tokens", C.c_char_p),
        ("data_dir", C.c_char_p),
        ("noise_scale", C.c_float),
        ("length_scale", C.c_float),
        ("dict_dir", C.c_char_p),
    ]

class SherpaOnnxOfflineTtsKokoroModelConfig(C.Structure):
    _fields_ = [
        ("model", C.c_char_p),
        ("voices", C.c_char_p),
        ("tokens", C.c_char_p),
        ("data_dir", C.c_char_p),
        ("length_scale", C.c_float),
        ("dict_dir", C.c_char_p),
        ("lexicon", C.c_char_p),
        ("lang", C.c_char_p),
    ]

class SherpaOnnxOfflineTtsKittenModelConfig(C.Structure):
    _fields_ = [
        ("model", C.c_char_p),
        ("voices", C.c_char_p),
        ("tokens", C.c_char_p),
        ("data_dir", C.c_char_p),
        ("length_scale", C.c_float),
    ]

class SherpaOnnxOfflineTtsZipvoiceModelConfig(C.Structure):
    _fields_ = [
        ("tokens", C.c_char_p),
        ("encoder", C.c_char_p),
        ("decoder", C.c_char_p),
        ("vocoder", C.c_char_p),
        ("data_dir", C.c_char_p),
        ("lexicon", C.c_char_p),
        ("feat_scale", C.c_float),
        ("t_shift", C.c_float),
        ("target_rms", C.c_float),
        ("guidance_scale", C.c_float),
    ]

class SherpaOnnxOfflineTtsPocketModelConfig(C.Structure):
    _fields_ = [
        ("lm_flow", C.c_char_p),
        ("lm_main", C.c_char_p),
        ("encoder", C.c_char_p),
        ("decoder", C.c_char_p),
        ("text_conditioner", C.c_char_p),
        ("vocab_json", C.c_char_p),
        ("token_scores_json", C.c_char_p),
        ("voice_embedding_cache_capacity", C.c_int32),
    ]

class SherpaOnnxOfflineTtsSupertonicModelConfig(C.Structure):
    _fields_ = [
        ("duration_predictor", C.c_char_p),
        ("text_encoder", C.c_char_p),
        ("vector_estimator", C.c_char_p),
        ("vocoder", C.c_char_p),
        ("tts_json", C.c_char_p),
        ("unicode_indexer", C.c_char_p),
        ("voice_style", C.c_char_p),
    ]

class SherpaOnnxOfflineTtsModelConfig(C.Structure):
    _fields_ = [
        ("vits", SherpaOnnxOfflineTtsVitsModelConfig),
        ("num_threads", C.c_int32),
        ("debug", C.c_int32),
        ("provider", C.c_char_p),
        ("matcha", SherpaOnnxOfflineTtsMatchaModelConfig),
        ("kokoro", SherpaOnnxOfflineTtsKokoroModelConfig),
        ("kitten", SherpaOnnxOfflineTtsKittenModelConfig),
        ("zipvoice", SherpaOnnxOfflineTtsZipvoiceModelConfig),
        ("pocket", SherpaOnnxOfflineTtsPocketModelConfig),
        ("supertonic", SherpaOnnxOfflineTtsSupertonicModelConfig),
    ]

class SherpaOnnxOfflineTtsConfig(C.Structure):
    _fields_ = [
        ("model", SherpaOnnxOfflineTtsModelConfig),
        ("rule_fsts", C.c_char_p),
        ("max_num_sentences", C.c_int32),
        ("rule_fars", C.c_char_p),
        ("silence_scale", C.c_float),
    ]

class SherpaOnnxGeneratedAudio(C.Structure):
    _fields_ = [
        ("samples", C.POINTER(C.c_float)),
        ("n", C.c_int32),
        ("sample_rate", C.c_int32),
    ]

def _path(path):
    # Prefer an ASCII short path on Windows for C++/eSpeak dependencies that still
    # use narrow file APIs. Text itself always crosses the C ABI as UTF-8.
    p = str(path)
    if sys.platform == "win32" and not p.isascii():
        fn = C.WinDLL("kernel32", use_last_error=True).GetShortPathNameW
        fn.argtypes = [C.c_wchar_p, C.c_wchar_p, C.c_uint32]
        fn.restype = C.c_uint32
        size = fn(p, None, 0)
        if size:
            buf = C.create_unicode_buffer(size)
            if fn(p, buf, size) and buf.value.isascii():
                p = buf.value
    return p.encode("utf-8")

def render(request):
    from app.tools.tts import text_chunks
    import math
    if sys.platform != "win32" or C.sizeof(C.c_void_p) != 8:
        raise components.ComponentError("本地语音需要 64 位 Windows / Offline TTS requires 64-bit Windows")
    id = request["model"]
    spec = components._spec(id)
    if spec["kind"] != "model":
        raise components.ComponentError("请选择语音模型 / Select a voice model")
    sid = int(request["sid"])
    if not 0 <= sid < spec["speakers"]:
        raise components.ComponentError("说话人编号无效 / Invalid speaker ID")
    text = str(request["text"])
    if not text.strip() or len(text) > 20000:
        raise components.ComponentError("文本应为 1–20000 字 / Text must contain 1–20000 characters")
    root = components.root_dir(request["base"])
    with components.operation_lock(root):
        runtime = components.installed(root, components.RUNTIME_ID, deep=True)
        model = components.installed(root, id, deep=True)
        if not runtime or not model:
            raise components.ComponentError("请先下载或修复所选模型与运行库 / Download or repair the selected model and runtime first")
        runtime_dir, model_dir = root / components.RUNTIME_ID, root / id
        handles = []
        try:
            directories = sorted({(runtime_dir / item["path"]).parent for item in runtime["files"] if item["path"].lower().endswith(".dll")})
            for directory in directories:
                handles.append(os.add_dll_directory(str(directory)))
            lib = C.CDLL(str(runtime_dir / runtime["layout"]["dll"]))
            lib.SherpaOnnxCreateOfflineTts.argtypes = [C.POINTER(SherpaOnnxOfflineTtsConfig)]
            lib.SherpaOnnxCreateOfflineTts.restype = C.c_void_p
            lib.SherpaOnnxDestroyOfflineTts.argtypes = [C.c_void_p]
            lib.SherpaOnnxDestroyOfflineTts.restype = None
            lib.SherpaOnnxOfflineTtsNumSpeakers.argtypes = [C.c_void_p]
            lib.SherpaOnnxOfflineTtsNumSpeakers.restype = C.c_int32
            lib.SherpaOnnxOfflineTtsGenerate.argtypes = [C.c_void_p, C.c_char_p, C.c_int32, C.c_float]
            lib.SherpaOnnxOfflineTtsGenerate.restype = C.POINTER(SherpaOnnxGeneratedAudio)
            lib.SherpaOnnxDestroyOfflineTtsGeneratedAudio.argtypes = [C.POINTER(SherpaOnnxGeneratedAudio)]
            lib.SherpaOnnxDestroyOfflineTtsGeneratedAudio.restype = None
            config = SherpaOnnxOfflineTtsConfig()
            config.model.num_threads = 2
            config.model.provider = b"cpu"
            config.max_num_sentences = 2
            config.silence_scale = 1.0
            layout = model["layout"]
            selected = config.model.kokoro if spec["family"] == "kokoro" else config.model.vits
            selected.model = _path(model_dir / layout["model"])
            selected.tokens = _path(model_dir / layout["tokens"])
            selected.data_dir = _path(model_dir / layout["data"])
            selected.length_scale = 1.0
            if spec["family"] == "kokoro":
                if "," in str(model_dir):
                    raise components.ComponentError("Kokoro 组件目录不能包含逗号 / Kokoro component paths must not contain commas")
                selected.voices = _path(model_dir / layout["voices"])
                selected.lexicon = b",".join(_path(model_dir / layout[k]) for k in ("lexiconEn", "lexiconZh"))
                config.rule_fsts = b",".join(_path(model_dir / p) for p in layout.get("rules", []))
            else:
                selected.noise_scale = 0.667
                selected.noise_scale_w = 0.8
            tts = lib.SherpaOnnxCreateOfflineTts(C.byref(config))
            if not tts:
                raise components.ComponentError("本地语音引擎无法加载组件 / Offline TTS could not load its components")
            try:
                if sid >= lib.SherpaOnnxOfflineTtsNumSpeakers(tts):
                    raise components.ComponentError("模型实际说话人编号不匹配 / Speaker ID does not match the installed model")
                rate = max(-50, min(50, int(request["rate"])))
                gain = max(0.0, min(1.0, 1.0 + int(request["volume"]) / 100.0))
                sample_rate, frames = None, 0
                with wave.open(str(request["output"]), "wb") as wav:
                    wav.setnchannels(1); wav.setsampwidth(2)
                    for chunk in text_chunks(text, 500):
                        audio = lib.SherpaOnnxOfflineTtsGenerate(tts, chunk.encode("utf-8"), sid, 1.0 + rate / 100.0)
                        if not audio:
                            raise components.ComponentError("本地模型未生成音频 / Offline model returned no audio")
                        try:
                            data = audio.contents
                            if not data.samples or not 8000 <= data.sample_rate <= 96000 or not 0 < data.n <= data.sample_rate * 600:
                                raise components.ComponentError("模型返回的音频无效 / Invalid audio from model")
                            if sample_rate is None:
                                sample_rate = data.sample_rate; wav.setframerate(sample_rate)
                            if data.sample_rate != sample_rate:
                                raise components.ComponentError("音频采样率不一致 / Inconsistent audio sample rates")
                            frames += data.n
                            if frames > sample_rate * 3600:
                                raise components.ComponentError("音频长度超过一小时 / Audio exceeds one hour")
                            for start in range(0, data.n, 65536):
                                pcm = array.array("h")
                                for i in range(start, min(start + 65536, data.n)):
                                    value = float(data.samples[i]) * gain
                                    if not math.isfinite(value):
                                        raise components.ComponentError("模型产生了无效采样 / Model produced a non-finite sample")
                                    pcm.append(int(max(-1.0, min(1.0, value)) * 32767))
                                if sys.byteorder != "little":
                                    pcm.byteswap()
                                wav.writeframesraw(pcm.tobytes())
                        finally:
                            lib.SherpaOnnxDestroyOfflineTtsGeneratedAudio(audio)
            finally:
                lib.SherpaOnnxDestroyOfflineTts(tts)
        finally:
            for handle in handles:
                handle.close()
    return dict(ok=True)
