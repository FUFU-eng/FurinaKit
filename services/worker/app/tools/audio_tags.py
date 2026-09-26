"""音频标签读写（MP3 标签编辑器用）。

设计约定（与项目其它 worker 模块一致）：
- 对外报错一律中文人话（TagError），由调用方转成 {"success": False, "error": ...}
- 用 mutagen 读写，不改动原文件：结果写成新文件由 job 机制交回前端
- 支持 ID3（MP3/WAV）、Vorbis 注释（FLAC/OGG）、MP4（M4A）三类常见容器

字段映射：不同格式的键名不一样（比如专辑艺术家在 ID3 里是 TPE2、在 Vorbis 里是 ALBUMARTIST），
这里统一成一套内部键名，调用方只认这一套。
"""

from __future__ import annotations

import base64
import io
import os
from pathlib import Path
from typing import Any, Dict, Optional

# 内部统一字段 → 各格式的键名
FIELD_MAP = {
    "title": {"id3": "TIT2", "vorbis": "TITLE", "mp4": "\xa9nam"},
    "artist": {"id3": "TPE1", "vorbis": "ARTIST", "mp4": "\xa9ART"},
    "album": {"id3": "TALB", "vorbis": "ALBUM", "mp4": "\xa9alb"},
    "albumartist": {"id3": "TPE2", "vorbis": "ALBUMARTIST", "mp4": "aART"},
    "date": {"id3": "TDRC", "vorbis": "DATE", "mp4": "\xa9day"},
    "genre": {"id3": "TCON", "vorbis": "GENRE", "mp4": "\xa9gen"},
    "track": {"id3": "TRCK", "vorbis": "TRACKNUMBER", "mp4": "trkn"},
    "disc": {"id3": "TPOS", "vorbis": "DISCNUMBER", "mp4": "disk"},
    "composer": {"id3": "TCOM", "vorbis": "COMPOSER", "mp4": "\xa9wrt"},
    "comment": {"id3": "COMM", "vorbis": "COMMENT", "mp4": "\xa9cmt"},
    "lyrics": {"id3": "USLT", "vorbis": "LYRICS", "mp4": "\xa9lyr"},
}

FIELD_LABEL = {
    "title": "标题", "artist": "艺术家", "album": "专辑", "albumartist": "专辑艺术家",
    "date": "年份", "genre": "流派", "track": "音轨号", "disc": "碟号",
    "composer": "作曲", "comment": "备注", "lyrics": "歌词",
}


class TagError(Exception):
    """可以直接展示给用户的中文错误。"""


def _kind(path: str) -> str:
    ext = Path(path).suffix.lower()
    if ext in (".mp3", ".wav"):
        return "id3"
    if ext in (".flac", ".ogg", ".opus"):
        return "vorbis"
    if ext in (".m4a", ".mp4", ".aac"):
        return "mp4"
    raise TagError(f"暂不支持这种格式（{ext or '无扩展名'}）。支持 MP3 / FLAC / M4A / OGG / WAV。")


def _open(path: str):
    from mutagen import File as MutagenFile

    if not os.path.isfile(path):
        raise TagError("找不到这个音频文件")
    try:
        f = MutagenFile(path)
    except Exception as exc:  # noqa: BLE001
        raise TagError(f"这个文件读不出来（可能已损坏或不是音频）：{exc}") from exc
    if f is None:
        raise TagError("无法识别这个音频文件，可能文件损坏或格式不常见")
    return f


def _get(f, kind: str, field: str) -> str:
    key = FIELD_MAP[field][kind]
    try:
        if kind == "id3":
            if field == "comment":
                frames = f.tags.getall("COMM") if f.tags else []
                return str(frames[0].text[0]) if frames else ""
            if field == "lyrics":
                frames = f.tags.getall("USLT") if f.tags else []
                return str(frames[0].text) if frames else ""
            fr = f.tags.get(key) if f.tags else None
            return str(fr.text[0]) if fr is not None and getattr(fr, "text", None) else ""
        if kind == "vorbis":
            v = f.tags.get(key) if f.tags else None
            if not v:
                return ""
            return str(v[0]) if isinstance(v, list) else str(v)
        # mp4
        v = f.tags.get(key) if f.tags else None
        if v is None:
            return ""
        if isinstance(v, list) and v:
            item = v[0]
            if isinstance(item, tuple) and len(item) == 2:
                return str(item[0])
            return str(item)
        return str(v)
    except Exception:  # noqa: BLE001
        return ""


def read_tags(path: str) -> Dict[str, Any]:
    """读标签 + 基本信息 + 封面（封面以 data URL 返回，前端可直接预览）"""
    f = _open(path)
    kind = _kind(path)

    tags = {field: _get(f, kind, field) for field in FIELD_MAP}

    info: Dict[str, Any] = {}
    try:
        stream = f.info
        info["duration"] = float(getattr(stream, "length", 0) or 0)
        info["bitrate"] = int(getattr(stream, "bitrate", 0) or 0)
        info["sampleRate"] = int(getattr(stream, "sample_rate", 0) or 0)
        info["channels"] = int(getattr(stream, "channels", 0) or 0)
        if hasattr(stream, "bits_per_sample"):
            info["bitsPerSample"] = int(getattr(stream, "bits_per_sample", 0) or 0)
    except Exception:  # noqa: BLE001
        pass

    cover = None
    try:
        data = None
        mime = "image/jpeg"
        if kind == "id3":
            frames = f.tags.getall("APIC") if f.tags else []
            if frames:
                data = frames[0].data
                mime = frames[0].mime or mime
        elif kind == "vorbis":
            pics = (f.tags or {}).get("metadata_block_picture")
            if pics:
                from mutagen.flac import Picture

                pic = Picture(base64.b64decode(pics[0]))
                data = pic.data
                mime = pic.mime or mime
        else:
            covers = (f.tags or {}).get("covr")
            if covers:
                from mutagen.mp4 import MP4Cover

                c = covers[0]
                data = bytes(c)
                mime = "image/png" if c.imageformat == MP4Cover.FORMAT_PNG else mime
        if data:
            cover = {
                "mime": mime,
                "size": len(data),
                "dataUrl": f"data:{mime};base64,{base64.b64encode(data).decode()}",
            }
    except Exception:  # noqa: BLE001
        cover = None

    return {
        "success": True,
        "kind": kind,
        "filename": os.path.basename(path),
        "size": os.path.getsize(path),
        "tags": tags,
        "info": info,
        "cover": cover,
    }


def _set(f, kind: str, field: str, value: str) -> None:
    key = FIELD_MAP[field][kind]
    if kind == "id3":
        from mutagen.id3 import COMM, TALB, TCOM, TCON, TDRC, TIT2, TPE1, TPE2, TPOS, TRCK, USLT

        # ★ 注意：这里必须按**字段名**（title/artist/…）查表，不能按 ID3 的键名查 ——
        #   我第一版写成按 "TIT2" 这种键名查，结果永远查不到、静默什么都不写（实测踩过）。
        tag_cls = {
            "title": TIT2, "artist": TPE1, "album": TALB, "albumartist": TPE2,
            "date": TDRC, "genre": TCON, "track": TRCK, "disc": TPOS, "composer": TCOM,
        }
        if field in tag_cls:
            f.tags.delall(key)
            if value:
                f.tags.add(tag_cls[field](encoding=3, text=[value]))
        elif field == "comment":
            f.tags.delall("COMM")
            if value:
                f.tags.add(COMM(encoding=3, lang="XXX", desc="", text=[value]))
        elif field == "lyrics":
            f.tags.delall("USLT")
            if value:
                f.tags.add(USLT(encoding=3, lang="XXX", desc="", text=value))
        return

    if kind == "vorbis":
        if value:
            f.tags[key] = [value]
        elif key in f.tags:
            del f.tags[key]
        return

    # mp4
    if field in ("track", "disc") and value:
        try:
            n = int(str(value).split("/")[0])
            f.tags[key] = [(n, 0)]
        except ValueError:
            pass
        return
    if value:
        f.tags[key] = [value]
    elif key in f.tags:
        del f.tags[key]


def write_tags(path: str, changes: Dict[str, str], cover_path: Optional[str],
               remove_cover: bool, out_path: str) -> Dict[str, Any]:
    """把改动写进一份**副本**，原文件一个字节都不动。

    ★ mutagen 的 save() 是**就地写回**的 —— 所以绝不能直接对着用户的原文件改，
      必须先把原文件复制到输出路径，再打开那份副本来改。
    """
    import shutil

    if not os.path.isfile(path):
        raise TagError("找不到这个音频文件")
    out = Path(out_path)
    out.parent.mkdir(parents=True, exist_ok=True)
    try:
        shutil.copy2(path, out)
    except Exception as exc:  # noqa: BLE001
        raise TagError(f"无法创建输出文件：{exc}") from exc

    f = _open(str(out))
    kind = _kind(str(out))

    if f.tags is None:
        try:
            f.add_tags()
        except Exception as exc:  # noqa: BLE001
            raise TagError(f"这个文件不支持写入标签：{exc}") from exc

    # 文本字段
    for field, value in (changes or {}).items():
        if field not in FIELD_MAP:
            continue
        try:
            _set(f, kind, field, "" if value is None else str(value))
        except Exception as exc:  # noqa: BLE001
            raise TagError(f"写入「{FIELD_LABEL.get(field, field)}」失败：{exc}") from exc

    # 封面
    if remove_cover:
        try:
            if kind == "id3":
                f.tags.delall("APIC")
            elif kind == "vorbis":
                f.tags.pop("metadata_block_picture", None)
            else:
                f.tags.pop("covr", None)
        except Exception:  # noqa: BLE001
            pass
    elif cover_path:
        if not os.path.isfile(cover_path):
            raise TagError("找不到选中的封面图片")
        data = Path(cover_path).read_bytes()
        ext = Path(cover_path).suffix.lower()
        mime = "image/png" if ext == ".png" else "image/jpeg"
        try:
            if kind == "id3":
                from mutagen.id3 import APIC

                f.tags.delall("APIC")
                f.tags.add(APIC(encoding=3, mime=mime, type=3, desc="Cover", data=data))
            elif kind == "vorbis":
                from mutagen.flac import Picture

                pic = Picture()
                pic.type = 3
                pic.mime = mime
                pic.desc = "Cover"
                pic.data = data
                f.tags["metadata_block_picture"] = [base64.b64encode(pic.write()).decode()]
            else:
                from mutagen.mp4 import MP4Cover

                fmt = MP4Cover.FORMAT_PNG if mime == "image/png" else MP4Cover.FORMAT_JPEG
                f.tags["covr"] = [MP4Cover(data, imageformat=fmt)]
        except Exception as exc:  # noqa: BLE001
            raise TagError(f"写入封面失败：{exc}") from exc

    try:
        f.save()
    except Exception as exc:  # noqa: BLE001
        raise TagError(f"保存标签失败：{exc}") from exc

    # 上面改的是副本（原文件复制过来的），所以这里直接把副本路径交回去
    return {"success": True, "output": str(out)}
