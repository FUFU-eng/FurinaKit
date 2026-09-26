"""V66 opt-in TTS packages. No network or inference at import/catalog time.
Archives are SHA-256 pinned; all upstream LICENSE/NOTICE files are retained.
"""
from __future__ import annotations
import contextlib
import hashlib
import json
import os
import re
import shutil
import stat
import sys
import tarfile
import time
import urllib.request
import uuid
from pathlib import Path, PurePosixPath

RUNTIME_ID = "tts-sherpa-runtime"
# Pinned release metadata; do not accept URLs, hashes or paths from the UI.
PACKAGES = {
    RUNTIME_ID: dict(name="sherpa-onnx 1.13.8 · Windows x64", kind="runtime", family="runtime", size=24805859,
        sha256="6dffdc715a4465b989446a6105265d2cb345e7101591a17d35534b6758f6e8df",
        url="https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.8/sherpa-onnx-v1.13.8-win-x64-shared-MT-Release.tar.bz2",
        licenseNoteZh="sherpa-onnx 为 Apache-2.0；依赖组件各自许可另计。", licenseNoteEn="sherpa-onnx is Apache-2.0; bundled dependencies retain their own terms.",
        licenseUrl="https://github.com/k2-fsa/sherpa-onnx/blob/v1.13.8/LICENSE", speakers=0, languages=[]),
    "tts-kokoro-zh-en": dict(name="Kokoro 1.1 · INT8", kind="model", family="kokoro", size=147031220,
        sha256="a1e94694776049035c4f2c6529f003aaece993c76aae9a78995831c3c4dcafc6",
        url="https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/kokoro-int8-multi-lang-v1_1.tar.bz2",
        licenseNoteZh="上游模型卡标注 Apache-2.0；eSpeak 数据等依赖仍适用各自条款。", licenseNoteEn="The upstream model card states Apache-2.0; dependencies such as eSpeak data retain their own terms.",
        licenseUrl="https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh", speakers=103, languages=["zh-CN", "en-US"], defaultSpeaker=3),
    "tts-piper-ljspeech": dict(name="Piper LJSpeech · INT8", kind="model", family="vits", size=21090429,
        sha256="24dc3bd77dd48c291e52c297878d3437c9492f245d823d7f6a06c4bbb67f4b6b",
        url="https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_US-ljspeech-medium-int8.tar.bz2",
        licenseNoteZh="模型卡注明 LJSpeech 数据集为公有领域；模型及依赖请查阅原始条款。", licenseNoteEn="The model card identifies LJSpeech data as public domain; consult the original model and dependency terms.",
        licenseUrl="https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/ljspeech/medium/MODEL_CARD", speakers=1, languages=["en-US"], defaultSpeaker=0),
    "tts-piper-ryan": dict(name="Piper Ryan · INT8", kind="model", family="vits", size=21083446,
        sha256="376eb489d42e98cb49f0e13a633e8d88580bd247ed8aacc298a733210404f771",
        url="https://github.com/k2-fsa/sherpa-onnx/releases/download/tts-models/vits-piper-en_US-ryan-medium-int8.tar.bz2",
        licenseNoteZh="注意：Ryan 数据集标注 CC BY-NC-SA 4.0（非商业）；不要默认可商用。", licenseNoteEn="Warning: Ryan data is CC BY-NC-SA 4.0 (non-commercial). Do not assume commercial use is permitted.",
        licenseUrl="https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_US/ryan/medium/MODEL_CARD", speakers=1, languages=["en-US"], defaultSpeaker=0),
}

class ComponentError(RuntimeError):
    pass

def _spec(id):
    if id not in PACKAGES:
        raise ComponentError("未知语音组件 / Unknown TTS component")
    return PACKAGES[id]

def _safe(path):
    """Reject symlinks, Windows junctions/reparse points, and nonregular files."""
    p = Path(path).absolute()
    for q in [p, *p.parents]:
        try:
            s = q.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(s.st_mode) or getattr(s, "st_file_attributes", 0) & 0x400:
            raise ComponentError("组件路径不能含链接或重解析点 / Linked component paths are not allowed")
        if not (stat.S_ISDIR(s.st_mode) or stat.S_ISREG(s.st_mode)):
            raise ComponentError("组件路径类型不安全 / Unsafe component path type")
    return p

def root_dir(base=None):
    base = base or os.environ.get("FURINAKIT_COMPONENTS_DIR")
    if not base:
        raise ComponentError("未配置组件目录，请从桌面应用运行 / Component directory is not configured")
    return _safe(Path(base) / "tts-v66")

def _atomic_json(path, value):
    path = _safe(path)
    tmp = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        with tmp.open("x", encoding="utf-8") as f:
            json.dump(value, f, ensure_ascii=False)
        os.replace(tmp, path)
    finally:
        tmp.unlink(missing_ok=True)

def _digest(path):
    h = hashlib.sha256()
    with _safe(path).open("rb") as f:
        for b in iter(lambda: f.read(1024 * 1024), b""):
            h.update(b)
    return h.hexdigest()

@contextlib.contextmanager
def operation_lock(root):
    root = _safe(root)
    root.mkdir(parents=True, exist_ok=True)
    path = _safe(root / ".operation.lock")
    with path.open("a+b") as f:
        if not path.stat().st_size:
            f.write(b"0"); f.flush()
        f.seek(0)
        try:
            if sys.platform == "win32":
                import msvcrt
                msvcrt.locking(f.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(f, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            raise ComponentError("本地语音组件正在使用或下载，请稍后重试 / Offline TTS components are busy") from exc
        try:
            yield
        finally:
            f.seek(0)
            if sys.platform == "win32":
                msvcrt.locking(f.fileno(), msvcrt.LK_UNLCK, 1)
            else:
                fcntl.flock(f, fcntl.LOCK_UN)

def _member_path(name):
    if "\\" in name or ":" in name or any(ord(c) < 32 for c in name):
        raise ComponentError("压缩包含非法路径 / Invalid archive path")
    p = PurePosixPath(name)
    if p.is_absolute() or not p.parts or any(x in ("..", "") for x in p.parts):
        raise ComponentError("压缩包路径越界 / Archive path escapes its directory")
    for part in p.parts:
        if part.endswith((".", " ")) or re.match(r"(?i)^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)", part):
            raise ComponentError("压缩包包含保留路径 / Reserved archive path")
    return p

def _layout(folder, family):
    files = [p for p in folder.rglob("*") if p.is_file() and p.name != "receipt.json"]
    def one(name):
        matches = [p for p in files if p.name == name]
        if len(matches) != 1:
            raise ComponentError("组件文件缺失或不唯一 / Missing or ambiguous package file: " + name)
        return matches[0]
    def relative(p):
        return p.relative_to(folder).as_posix()
    if family == "runtime":
        return {"dll": relative(one("sherpa-onnx-c-api.dll"))}
    models = [p for p in files if p.suffix == ".onnx"]
    quantized = [p for p in models if "int8" in p.name]
    models = quantized or models
    if len(models) != 1:
        raise ComponentError("未找到唯一的量化模型 / Cannot locate the quantized model")
    data = one("phontab").parent
    layout = dict(model=relative(models[0]), tokens=relative(one("tokens.txt")), data=relative(data))
    if family == "kokoro":
        layout.update(voices=relative(one("voices.bin")), lexiconZh=relative(one("lexicon-zh.txt")), lexiconEn=relative(one("lexicon-us-en.txt")))
        # Preserve and use the model's own number/date/phone normalization rules.
        layout["rules"] = [relative(p) for name in ("date-zh.fst", "number-zh.fst", "phone-zh.fst") for p in files if p.name == name]
    return layout

def installed(root, id, deep=False):
    spec = _spec(id)
    folder = _safe(root / id)
    receipt = _safe(folder / "receipt.json")
    if not receipt.is_file() or receipt.stat().st_size > 8 * 1024 * 1024:
        return None
    try:
        data = json.loads(receipt.read_text(encoding="utf-8"))
        if data.get("id") != id or data.get("archiveSha256") != spec["sha256"] or not data.get("files"):
            return None
        for item in data["files"]:
            rel = _member_path(item["path"])
            p = _safe(folder.joinpath(*rel.parts))
            if not p.is_file() or p.stat().st_size != item["size"]:
                return None
            if deep and _digest(p) != item["sha256"]:
                return None
        # Do not trust executable/model paths supplied by an editable receipt.
        data["layout"] = _layout(folder, spec["family"])
        return data
    except (OSError, ValueError, KeyError, TypeError, ComponentError):
        return None

def catalog(base):
    root = root_dir(base)
    rows = []
    for id, spec in PACKAGES.items():
        try:
            data = installed(root, id)
            problem = ""
        except ComponentError as e:
            data, problem = None, str(e)
        rows.append(dict(id=id, **spec, downloaded=bool(data), installedBytes=sum(x["size"] for x in data["files"]) if data else 0, error=problem))
    progress = {}
    try:
        p = _safe(root / "progress.json")
        if p.stat().st_size < 16384:
            progress = json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError, ComponentError):
        pass
    return dict(ok=True, components=rows, progress=progress)

def _progress(root, id, status, received=0, total=0):
    _atomic_json(root / "progress.json", dict(id=id, status=status, received=received, total=total))

def _download_url(root, id, source_url):
    spec = _spec(id)
    cache = _safe(root / "archives")
    cache.mkdir(exist_ok=True)
    part = _safe(cache / (id + ".tar.bz2.part"))
    size = spec["size"]
    start = part.stat().st_size if part.is_file() else 0
    if start > size or (start == size and _digest(part) != spec["sha256"]):
        part.rename(part.with_name(part.name + ".invalid-" + uuid.uuid4().hex)); start = 0
    if start < size:
        headers = {"User-Agent": "FurinaKit-TTS/2.1.0", "Accept-Encoding": "identity"}
        if start:
            headers["Range"] = f"bytes={start}-"
        req = urllib.request.Request(source_url, headers=headers)
        deadline = time.monotonic() + 3500
        with urllib.request.urlopen(req, timeout=45) as response:
            if not response.url.startswith("https://"):
                raise ComponentError("拒绝不安全的下载重定向 / Insecure download redirect")
            code = response.status
            if "text/html" in response.headers.get("Content-Type", "").lower():
                raise ComponentError("下载源返回了网页而非模型文件 / Download source returned an HTML page")
            if code == 206:
                match = re.fullmatch(r"bytes (\d+)-(\d+)/(\d+)", response.headers.get("Content-Range", ""))
                if not match or int(match[1]) != start or int(match[3]) != size or int(match[2]) != size - 1:
                    raise ComponentError("下载断点响应不匹配 / Invalid download range")
            elif code == 200:
                start = 0
            else:
                raise ComponentError("下载服务未返回有效文件 / Invalid download response")
            with part.open("ab" if start else "wb") as f:
                _progress(root, id, "downloading", start, size)
                while True:
                    if time.monotonic() > deadline:
                        raise ComponentError("下载超时，已保留断点 / Download timed out; partial file retained")
                    block = response.read(1024 * 1024)
                    if not block:
                        break
                    start += len(block)
                    if start > size:
                        raise ComponentError("下载文件超过预期大小 / Download exceeds the pinned size")
                    f.write(block)
                    _progress(root, id, "downloading", start, size)
    _progress(root, id, "verifying", start, size)
    if part.stat().st_size != size or _digest(part) != spec["sha256"]:
        if part.stat().st_size == size:
            part.rename(part.with_name(part.name + ".invalid-" + uuid.uuid4().hex))
        raise ComponentError("下载不完整或 SHA-256 不匹配，未安装 / Incomplete download or SHA-256 mismatch; not installed")
    return part

def _download(root, id):
    url = _spec(id)["url"]
    urls = [url]
    if url.startswith("https://github.com/"):
        urls = ["https://ghfast.top/" + url, url, "https://gh-proxy.com/" + url]
    failures = []
    for source_url in urls:
        try:
            return _download_url(root, id, source_url)
        except (OSError, TimeoutError, ValueError, ComponentError) as exc:
            failures.append(type(exc).__name__)
    raise ComponentError("所有下载源均失败，断点已保留，可再次点击下载 / All sources failed; partial download retained (" + ", ".join(failures) + ")")


def _install_one(root, id):
    spec = _spec(id)
    if installed(root, id, deep=True):
        return
    archive = _download(root, id)
    _progress(root, id, "extracting", spec["size"], spec["size"])
    stage = root / (".stage-" + uuid.uuid4().hex)
    stage.mkdir()
    try:
        records, seen, total = [], set(), 0
        with tarfile.open(archive, "r:bz2") as tar:
            for index, member in enumerate(tar):
                if index > 20000 or not (member.isdir() or member.isfile()):
                    raise ComponentError("拒绝链接、特殊文件或过多文件 / Unsafe archive member")
                rel = _member_path(member.name)
                key = rel.as_posix().casefold()
                if key in seen:
                    raise ComponentError("压缩包路径重复 / Duplicate archive path")
                seen.add(key)
                dest = stage.joinpath(*rel.parts)
                if member.isdir():
                    dest.mkdir(parents=True, exist_ok=True); continue
                total += member.size
                if member.size < 0 or total > 3 * 1024 ** 3:
                    raise ComponentError("解压大小超限 / Unpacked size limit exceeded")
                dest.parent.mkdir(parents=True, exist_ok=True)
                source = tar.extractfile(member)
                if source is None:
                    raise ComponentError("无法读取组件文件 / Cannot read archive member")
                h, count = hashlib.sha256(), 0
                with source, dest.open("xb") as out:
                    for block in iter(lambda: source.read(1024 * 1024), b""):
                        count += len(block); h.update(block); out.write(block)
                if count != member.size:
                    raise ComponentError("组件解压不完整 / Incomplete extracted file")
                records.append(dict(path=rel.as_posix(), size=count, sha256=h.hexdigest()))
        layout = _layout(stage, spec["family"])
        _atomic_json(stage / "receipt.json", dict(id=id, archiveSha256=spec["sha256"], files=records, layout=layout))
        target = _safe(root / id)
        if target.exists():
            # Preserve a damaged previous package rather than silently deleting it.
            target.rename(target.with_name(id + ".preserved-" + uuid.uuid4().hex))
        stage.rename(target)
        archive.unlink(missing_ok=True)
        _progress(root, id, "completed", spec["size"], spec["size"])
    finally:
        if stage.exists():
            shutil.rmtree(stage)

def install(base, id):
    _spec(id)
    if sys.platform != "win32" or __import__("struct").calcsize("P") != 8:
        raise ComponentError("本地语音运行库要求 64 位 Windows / Offline TTS requires 64-bit Windows")
    root = root_dir(base)
    with operation_lock(root):
        if id != RUNTIME_ID:
            _install_one(root, RUNTIME_ID)
        _install_one(root, id)
    return dict(ok=True)

def delete(base, id):
    _spec(id)
    root = root_dir(base)
    with operation_lock(root):
        if id == RUNTIME_ID and any(installed(root, x) for x in PACKAGES if x != id):
            raise ComponentError("请先删除依赖此运行库的本地音色 / Remove dependent voice models first")
        target = _safe(root / id)
        if target.exists():
            marker = _safe(target / "receipt.json")
            if not marker.is_file() or json.loads(marker.read_text(encoding="utf-8")).get("id") != id:
                raise ComponentError("无法确认目录归属，未删除 / Cannot confirm package ownership; nothing deleted")
            for path in target.rglob("*"):
                _safe(path)
            shutil.rmtree(target)
        # Only this exact package's partial archive, never arbitrary cache directories.
        part = _safe(root / "archives" / (id + ".tar.bz2.part"))
        part.unlink(missing_ok=True)
    return dict(ok=True)

def cli(args):
    """Invoked by the native owned-process bridge, never by a background queue."""
    action, base, id, reply = args
    try:
        if action == "catalog":
            result = catalog(base)
        elif action == "download":
            result = install(base, id)
        elif action == "delete":
            result = delete(base, id)
        elif action == "voices" and id in ("sapi", "edge"):
            from app.tools import tts
            result = dict(ok=True, voices=tts.list_sapi_voices() if id == "sapi" else tts.list_edge_voices())
        else:
            raise ComponentError("不支持的语音操作 / Unsupported TTS operation")
    except Exception as exc:
        result = dict(ok=False, error=str(exc)[:1500])
    _atomic_json(Path(reply), result)
