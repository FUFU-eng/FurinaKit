"""Cooperative v1 Windows leases for configured Tauri worker jobs.

Only the parent-supplied cache namespace is written, never component/model files.
Unconfigured older/Electron callers keep their previous behavior. They do NOT gain
lease protection. A configured but invalid namespace fails closed, not silently open.
"""
from contextlib import contextmanager
import ctypes
from ctypes import wintypes
import hashlib
import json
import os
from pathlib import Path
import stat


def _keys(files):
    if not isinstance(files, list) or not 1 <= len(files) <= 64:
        raise ValueError("Invalid component lease set")
    for name in files:
        if (not isinstance(name, str) or not name or len(name.encode("utf-8")) > 1024
                or name.endswith((".", " ")) or name in (".", "..")
                or any(ord(c) < 32 or 127 <= ord(c) <= 159 or c in ':/' + '\\<>"|?*' for c in name)):
            raise ValueError("Invalid component lease filename")
    return sorted(set(name.lower() for name in files))


def _ordinary(path, *, directory=False):
    meta = path.lstat()
    if (stat.S_ISLNK(meta.st_mode) or getattr(meta, "st_file_attributes", 0) & 0x400
            or (not stat.S_ISDIR(meta.st_mode) if directory else not stat.S_ISREG(meta.st_mode) or meta.st_size != 0)):
        raise ValueError("Refusing linked, nonempty or non-file component lease")


@contextmanager
def acquire_namespace(namespace, files, *, change=False):
    keys = _keys(files)
    if os.name != "nt":
        raise RuntimeError("Component leases require Windows")
    namespace = Path(namespace)
    if not namespace.is_absolute():
        raise ValueError("Component lease namespace must be absolute")
    _ordinary(namespace, directory=True)
    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    create = kernel.CreateFileW
    create.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p,
                       wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
    create.restype = wintypes.HANDLE
    close = kernel.CloseHandle
    close.argtypes = [wintypes.HANDLE]
    close.restype = wintypes.BOOL
    invalid = ctypes.c_void_p(-1).value
    handles = []
    try:
        for name in keys:
            path = namespace / ("file-" + hashlib.sha256(name.encode("utf-8")).hexdigest() + ".lease")
            try:
                _ordinary(path)
            except FileNotFoundError:
                try:
                    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
                except FileExistsError:
                    pass
                else:
                    os.close(fd)
                _ordinary(path)
            handle = create(str(path), 0xC0000000 if change else 0x80000000,
                            0 if change else 1, None, 3, 0x00200000, None)
            if handle == invalid:
                error = ctypes.get_last_error()
                if error in (32, 33):
                    raise RuntimeError("组件正在使用或变更，请稍后重试 / Component busy: " + name)
                raise OSError(error, "Cannot acquire component lease: " + name)
            handles.append(handle)
            # OPEN_REPARSE_POINT above and another metadata check reject replacement links.
            _ordinary(path)
        yield
    finally:
        for handle in reversed(handles):
            close(handle)


@contextmanager
def task_lease():
    namespace = os.environ.get("FURINAKIT_COMPONENT_LEASE_NAMESPACE")
    names = os.environ.get("FURINAKIT_COMPONENT_LEASE_FILES")
    if namespace is None and names is None:
        yield  # Explicitly unconfigured legacy/Electron mode; no protection claim.
        return
    if not namespace or not names:
        raise RuntimeError("Incomplete component lease configuration")
    with acquire_namespace(namespace, json.loads(names)):
        yield
