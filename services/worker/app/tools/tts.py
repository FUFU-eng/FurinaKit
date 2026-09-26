"""V66 TTS: explicit online Edge, installed SAPI voices, and opt-in local models.
Never silently substitute a different engine or voice. Output paths/MIME describe
actual bytes (Edge MP3; SAPI and sherpa WAV). No download during synthesis.
"""
from __future__ import annotations
import asyncio
import base64
import datetime
import hashlib
import inspect
import json
import os
import re
import subprocess
import sys
import time
import urllib.parse
import urllib.request
import uuid
import wave
from pathlib import Path
from xml.sax.saxutils import escape, quoteattr

CREATE_NO_WINDOW = 0x08000000 if sys.platform == "win32" else 0
EDGE_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4"
EDGE_BASE = "https://speech.platform.bing.com/consumer/speech/synthesize/readaloud"
EDGE_VERSION = "143.0.3650.75"
EDGE_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0"

class TtsError(RuntimeError):
    pass

def text_chunks(text, limit=500):
    # Split raw Unicode, never encoded bytes or SSML entities. Preserve every
    # non-whitespace character, including quotes, angle brackets and emoji.
    while len(text) > limit:
        cut = max((text.rfind(c, limit // 2, limit) + 1 for c in "。！？.!?;；\n "), default=0)
        cut = cut or limit
        part, text = text[:cut], text[cut:]
        if part.strip():
            yield part
    if text.strip():
        yield text

def _edge_query():
    ticks = (int(time.time()) + 11644473600) // 300 * 300 * 10000000
    gec = hashlib.sha256((str(ticks) + EDGE_TOKEN).encode("ascii")).hexdigest().upper()
    return urllib.parse.urlencode({"TrustedClientToken": EDGE_TOKEN, "Sec-MS-GEC": gec, "Sec-MS-GEC-Version": "1-" + EDGE_VERSION})

def _headers():
    return {"User-Agent": EDGE_UA, "Accept-Language": "en-US,en;q=0.9", "Cache-Control": "no-cache", "Pragma": "no-cache", "Cookie": "muid=" + uuid.uuid4().hex.upper() + ";"}

def list_edge_voices():
    # This endpoint is called only by an explicit online-voice refresh action.
    req = urllib.request.Request(EDGE_BASE + "/voices/list?" + _edge_query(), headers=_headers())
    try:
        with urllib.request.urlopen(req, timeout=25) as r:
            raw = r.read(4 * 1024 * 1024 + 1)
        if len(raw) > 4 * 1024 * 1024:
            raise ValueError("oversized voice list")
        data = json.loads(raw)
        if not isinstance(data, list):
            raise ValueError("invalid voice list")
        return [dict(name=v["ShortName"], label=v.get("FriendlyName") or v["ShortName"], locale=v.get("Locale", ""), gender=v.get("Gender", "")) for v in data if isinstance(v, dict) and re.fullmatch(r"[A-Za-z0-9-]{3,100}", str(v.get("ShortName", "")))]
    except Exception as exc:
        raise TtsError("在线音色清单获取失败，请检查网络、代理和系统时间 / Could not retrieve online voices; check network, proxy and system clock") from exc

_PS_COMMON = r"""
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
"""
_PS_LIST = _PS_COMMON + r"""
try {
    $items = @($s.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object {
        @{name=$_.VoiceInfo.Name; label=$_.VoiceInfo.Name; locale=$_.VoiceInfo.Culture.Name; gender=$_.VoiceInfo.Gender.ToString()}
    })
    ConvertTo-Json -InputObject $items -Compress -Depth 3
} finally { $s.Dispose() }
"""
_PS_SYNTH = _PS_COMMON + r"""
try {
    $p = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $available = @($s.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Name -ceq $p.voice })
    if ($available.Count -ne 1) { throw 'Selected SAPI voice is not installed or is disabled' }
    $s.SelectVoice([string]$p.voice)
    if ($s.Voice.Name -cne $p.voice) { throw 'SAPI did not select the requested voice' }
    $s.Rate = [int]$p.rate
    $s.Volume = [int]$p.volume
    $s.SetOutputToWaveFile([string]$p.output)
    $s.Speak([string]$p.text)
    $s.SetOutputToNull()
    @{voice=$s.Voice.Name; ok=$true} | ConvertTo-Json -Compress
} finally { $s.Dispose() }
"""

def _powershell(script, payload=None, timeout=60):
    if sys.platform != "win32":
        raise TtsError("系统语音仅适用于 Windows / System voices require Windows")
    exe = Path(os.environ.get("SystemRoot", r"C:\Windows")) / "System32/WindowsPowerShell/v1.0/powershell.exe"
    if not exe.is_file():
        raise TtsError("缺少 Windows PowerShell / Windows PowerShell is unavailable")
    command = base64.b64encode(script.encode("utf-16-le")).decode("ascii")
    try:
        result = subprocess.run([str(exe), "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", command],
            input=json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else b"",
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=CREATE_NO_WINDOW, timeout=timeout, check=False)
    except subprocess.TimeoutExpired as exc:
        raise TtsError("系统语音超时 / System speech timed out") from exc
    if result.returncode != 0:
        raise TtsError("系统语音失败；所选声线可能不可用，请刷新真实声线列表 / SAPI failed; refresh the installed voice list")
    try:
        return json.loads(result.stdout.decode("utf-8-sig"))
    except (UnicodeError, ValueError) as exc:
        raise TtsError("系统语音返回了无效结果 / Invalid response from system speech") from exc

def list_sapi_voices():
    data = _powershell(_PS_LIST)
    if isinstance(data, dict):
        data = [data]
    if not isinstance(data, list):
        raise TtsError("无法读取系统声线 / Could not read system voices")
    return [v for v in data if isinstance(v, dict) and v.get("name")]

def _ssml(text, voice, rate, pitch, volume):
    if not re.fullmatch(r"[A-Za-z0-9-]{3,100}", voice):
        raise TtsError("在线声线名称无效 / Invalid online voice name")
    parts = voice.split("-")
    if len(parts) < 3:
        raise TtsError("在线声线名称无效 / Invalid online voice name")
    locale = "-".join(parts[:2])
    # Edge's SSML uses the service's full voice name, while the UI/API catalog
    # use ShortName. Regional variants keep their locale suffix (e.g. liaoning).
    service_voice = "Microsoft Server Speech Text to Speech Voice (" + "-".join(parts[:-1]) + ", " + parts[-1] + ")"
    return ("<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang=" + quoteattr(locale) + ">"
        + "<voice name=" + quoteattr(service_voice) + "><prosody pitch=" + quoteattr(f"{pitch:+d}Hz")
        + " rate=" + quoteattr(f"{rate:+d}%") + " volume=" + quoteattr(f"{volume:+d}%") + ">"
        + escape(text) + "</prosody></voice></speak>")

def _frame_headers(raw):
    return {key.strip().lower(): value.strip() for line in raw.split("\r\n") if ":" in line for key, value in [line.split(":", 1)]}

async def _edge_segment(text, voice, rate, pitch, volume):
    try:
        import websockets
    except ImportError as exc:
        raise TtsError("缺少 websockets 组件 / The websockets dependency is missing") from exc
    connect = websockets.connect
    parameters = inspect.signature(connect).parameters
    header_key = "additional_headers" if "additional_headers" in parameters else "extra_headers"
    headers = _headers()
    headers.pop("User-Agent")
    kwargs = {header_key: headers, "origin": "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
              "user_agent_header": EDGE_UA, "compression": None, "max_size": 2 * 1024 * 1024,
              "open_timeout": 25, "close_timeout": 5, "ping_interval": 20, "ping_timeout": 30}
    request_id = uuid.uuid4().hex
    url = EDGE_BASE.replace("https://", "wss://") + "/edge/v1?" + _edge_query() + "&ConnectionId=" + uuid.uuid4().hex
    now = datetime.datetime.now(datetime.timezone.utc)
    day = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")[now.weekday()]
    month = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")[now.month - 1]
    stamp = f"{day} {month} {now.day:02d} {now.year} {now:%H:%M:%S} GMT+0000 (Coordinated Universal Time)"
    audio = bytearray()
    async with connect(url, **kwargs) as ws:
        config = {"context": {"synthesis": {"audio": {"metadataoptions": {"sentenceBoundaryEnabled": "false", "wordBoundaryEnabled": "false"}, "outputFormat": "audio-24khz-48kbitrate-mono-mp3"}}}}
        await ws.send(f"X-Timestamp:{stamp}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n" + json.dumps(config))
        await ws.send(f"X-RequestId:{request_id}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:{stamp}Z\r\nPath:ssml\r\n\r\n" + _ssml(text, voice, rate, pitch, volume))
        ended = False
        while not ended:
            message = await asyncio.wait_for(ws.recv(), timeout=60)
            if isinstance(message, bytes):
                if len(message) < 2:
                    raise TtsError("在线服务返回了不完整帧 / Truncated online audio frame")
                size = int.from_bytes(message[:2], "big")
                if size > len(message) - 2:
                    raise TtsError("在线服务帧头无效 / Invalid online frame header")
                meta = _frame_headers(message[2:2 + size].decode("ascii"))
                payload = message[2 + size:]
                if meta.get("path", "").lower() != "audio":
                    continue
                if meta.get("x-requestid", request_id).lower() != request_id:
                    raise TtsError("在线响应任务不匹配 / Online response ID mismatch")
                if payload:
                    if meta.get("content-type", "").split(";")[0].lower() != "audio/mpeg":
                        raise TtsError("在线音频格式不匹配 / Unexpected online audio format")
                    audio.extend(payload)
                    if len(audio) > 24 * 1024 * 1024:
                        raise TtsError("在线音频分段超出大小限制 / Online audio segment exceeds the size limit")
            else:
                header, _, _body = message.partition("\r\n\r\n")
                meta = _frame_headers(header)
                if meta.get("path", "").lower() == "turn.end":
                    if meta.get("x-requestid", request_id).lower() != request_id:
                        raise TtsError("在线响应任务不匹配 / Online response ID mismatch")
                    ended = True
    if not ended or len(audio) < 100:
        raise TtsError("在线服务未返回完整音频 / Online service returned no complete audio")
    return audio

async def _edge_synth(text, voice, rate, pitch, volume, path):
    partial = path.with_suffix(".mp3.part")
    deadline = time.monotonic() + 3600
    try:
        with partial.open("xb") as out:
            for segment in text_chunks(text, 500):
                for attempt in range(3):
                    if time.monotonic() > deadline:
                        raise TtsError("在线合成总时长超限，请缩短文本 / Online synthesis timed out; shorten the text")
                    try:
                        audio = await asyncio.wait_for(_edge_segment(segment, voice, rate, pitch, volume), timeout=240)
                        out.write(audio)
                        if out.tell() > 128 * 1024 * 1024:
                            raise TtsError("语音结果过大 / Speech output exceeds the size limit")
                        break
                    except Exception as exc:
                        if attempt == 2:
                            kind = type(exc).__name__
                            winerror = getattr(exc, "winerror", None)
                            hint = f"{kind}" + (f" / WinError {winerror}" if winerror else "")
                            raise TtsError("在线合成失败，已重试；请检查网络、代理、系统时间或改选离线方式 / Online synthesis failed after retries; check network, proxy and system clock, or choose an offline engine (" + hint + ")") from exc
                        await asyncio.sleep(1 + 2 * attempt)
        os.replace(partial, path)
    finally:
        partial.unlink(missing_ok=True)

def _check_wav(path):
    try:
        with wave.open(str(path), "rb") as wav:
            if wav.getnframes() <= 0 or wav.getnchannels() not in (1, 2) or wav.getsampwidth() not in (1, 2, 3, 4):
                raise ValueError("empty or invalid wave")
    except (OSError, EOFError, wave.Error, ValueError) as exc:
        raise TtsError("未生成有效 WAV 音频 / No valid WAV audio was generated") from exc

def _local_synth(text, voice, rate, volume, path):
    from app.tools import tts_components as components
    if ":" not in voice:
        raise TtsError("请选择本地模型及说话人 / Select an offline model and speaker")
    id, speaker = voice.rsplit(":", 1)
    spec = components._spec(id)
    if spec["kind"] != "model" or not speaker.isdecimal() or not 0 <= int(speaker) < spec["speakers"]:
        raise TtsError("本地声线无效 / Invalid offline voice")
    base = os.environ.get("FURINAKIT_COMPONENTS_DIR", "")
    if not base:
        raise TtsError("未配置组件目录 / Component directory is not configured")
    request = path.with_name("tts-request-" + uuid.uuid4().hex + ".json")
    reply = request.with_suffix(".result.json")
    prefix = [sys.executable] if getattr(sys, "frozen", False) else [sys.executable, str(Path(__file__).resolve().parents[2] / "worker.py")]
    request.write_text(json.dumps(dict(text=text, model=id, sid=int(speaker), base=base, rate=rate, volume=volume, output=str(path), reply=str(reply)), ensure_ascii=False), encoding="utf-8")
    try:
        # Keep native DLL crashes and memory lifetimes out of the persistent worker.
        result = subprocess.run(prefix + ["--tts-render", str(request)], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL, creationflags=CREATE_NO_WINDOW, timeout=3600, check=False)
        if result.returncode != 0 or not reply.is_file():
            raise TtsError("本地语音进程失败，请检查组件完整性及可用内存 / Offline speech process failed; check components and available memory")
        response = json.loads(reply.read_text(encoding="utf-8"))
        if response.get("ok") is not True:
            raise TtsError(response.get("error") or "本地语音失败 / Offline synthesis failed")
    except subprocess.TimeoutExpired as exc:
        raise TtsError("本地合成超时，请缩短文本 / Offline synthesis timed out; shorten the text") from exc
    finally:
        request.unlink(missing_ok=True); reply.unlink(missing_ok=True)

def render_cli(request_path):
    # Worker entry dispatches here BEFORE queue/config imports and signal handlers.
    request = json.loads(Path(request_path).read_text(encoding="utf-8"))
    try:
        from app.tools.tts_sherpa import render
        response = render(request)
    except Exception as exc:
        response = dict(ok=False, error=str(exc)[:1500])
    Path(request["reply"]).write_text(json.dumps(response, ensure_ascii=False), encoding="utf-8")

def synthesize(text, engine, voice, rate, pitch, volume, out_path):
    text = (text or "").strip()
    if not text or len(text) > 20000:
        raise TtsError("请输入 1–20000 字的朗读文本 / Enter 1–20000 characters")
    if any(ord(c) < 32 and c not in "\n\r\t" for c in text):
        raise TtsError("文本包含不支持的控制字符 / Text contains unsupported control characters")
    engine = engine or "sapi"
    if engine not in ("sapi", "edge", "local"):
        raise TtsError("不支持的语音引擎 / Unsupported speech engine")
    rate, pitch, volume = int(rate), int(pitch), int(volume)
    if not (-50 <= rate <= 50 and -50 <= pitch <= 50 and -100 <= volume <= 100):
        raise TtsError("语速、音调或音量超出范围 / Rate, pitch or volume is out of range")
    if engine != "edge" and (pitch != 0 or volume > 0):
        raise TtsError("离线引擎不支持音调偏移或音量增益 / Offline engines do not support pitch shifting or volume boost")
    path = Path(out_path).with_suffix(".mp3" if engine == "edge" else ".wav")
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        if engine == "edge":
            voice = voice or "zh-CN-XiaoxiaoNeural"
            asyncio.run(_edge_synth(text, voice, rate, pitch, volume, path))
        elif engine == "sapi":
            voices = list_sapi_voices()
            if not voices:
                raise TtsError("本机没有可用 SAPI 声线，请在 Windows 设置安装语音包 / No SAPI voices are installed; add a Windows speech language pack")
            voice = voice or voices[0]["name"]
            if not any(v["name"] == voice for v in voices):
                raise TtsError("所选系统声线未安装，不会自动替换 / Selected system voice is not installed; no fallback was used")
            # User text, voice and paths are JSON stdin, never interpolated script.
            result = _powershell(_PS_SYNTH, dict(text=text, voice=voice, rate=max(-10, min(10, round(rate / 10))), volume=100 + volume, output=str(path)), timeout=3600)
            if result.get("ok") is not True or result.get("voice") != voice:
                raise TtsError("系统未应用所选声线 / System did not apply the selected voice")
            _check_wav(path)
        else:
            _local_synth(text, voice, rate, volume, path)
            _check_wav(path)
    except Exception:
        path.unlink(missing_ok=True)
        raise
    return dict(success=True, output=str(path), mime="audio/mpeg" if engine == "edge" else "audio/wav", engine=engine, voice=voice, chars=len(text))
