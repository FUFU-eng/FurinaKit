"""G51: opt-in pinned local upscale resource selection, NOT a public installer.
No remote URL, user-supplied hash, download or executable discovery is accepted.
Windows retains read-only file handles denying writes/deletion during the task.
This is not a sandbox against a hostile same-user process changing directory trees.
"""
from contextlib import contextmanager, ExitStack
import hashlib
import os
from pathlib import Path
import stat

MANIFEST_SHA256 = 'dd8a2723af70b7bdbf47f6d71a47c629b42bcab212ff27ef5ddbc8af04d4f4de'
# Fixed audit-derived content pins. Changing these is a source/release change.
FILES = {'services/worker/upscale/models/realesr-animevideov3-x2.bin': (1247368, '548a36f9c3f4ab8da56cd3b13badf23968bee207b396dad14d04b830e5f2ab2d'), 'services/worker/upscale/models/realesr-animevideov3-x2.param': (3173, 'b88ff4f00ebf019a7fdac17fdd45a7fd3665d37509efc5baf2e4da2e24420a04'), 'services/worker/upscale/models/realesr-animevideov3-x3.bin': (1247368, '548a36f9c3f4ab8da56cd3b13badf23968bee207b396dad14d04b830e5f2ab2d'), 'services/worker/upscale/models/realesr-animevideov3-x3.param': (3173, 'd1a5755008791d09b57e3425fc9dd0bd26b00fdf79c606210bc0e693f8230881'), 'services/worker/upscale/models/realesr-animevideov3-x4.bin': (1247368, '548a36f9c3f4ab8da56cd3b13badf23968bee207b396dad14d04b830e5f2ab2d'), 'services/worker/upscale/models/realesr-animevideov3-x4.param': (3077, '850a248e7c14c27e5bd8cf7265113a9441036a7db63963bb8aa5169d788a435e'), 'services/worker/upscale/models/realesrgan-x4plus-anime.bin': (8943500, 'fe01c269cfd10cdef8e018ab66ebe750cf79c7af4d1f9c16c737e1295229bacc'), 'services/worker/upscale/models/realesrgan-x4plus-anime.param': (30290, '2b8fb6e0ae4d2d85704ca08c119a2f5ea40add4f2ecd512eb7f4cd44b6127ed4'), 'services/worker/upscale/models/realesrgan-x4plus.bin': (33424520, '713ee713b0353afaa27976f0563a64a5043bd70b9bd8936c2e26e25ebcdbcddf'), 'services/worker/upscale/models/realesrgan-x4plus.param': (116029, '35330ececcea33b6c397a72548e788d5d53becee4734c50b7fada36e89f10a86'), 'services/worker/upscale/realesrgan-ncnn-vulkan.exe': (6161408, '07e49f7cbb4ede01ae4dd4c399d3a7e5846e3d2085c3128eff881e55cb7b1a0c')}
PREFIX = 'services/worker/upscale/'


def _ordinary(path, directory=False):
    meta = path.lstat()
    if (stat.S_ISLNK(meta.st_mode) or getattr(meta, 'st_file_attributes', 0) & 0x400
            or not (stat.S_ISDIR(meta.st_mode) if directory else stat.S_ISREG(meta.st_mode))):
        raise RuntimeError('超分组件包含链接或非普通文件 / Invalid upscale component path')
    return meta


@contextmanager
def _locked_read(path):
    _ordinary(path)
    if os.name == 'nt':
        import ctypes
        from ctypes import wintypes
        import msvcrt
        kernel = ctypes.WinDLL('kernel32', use_last_error=True)
        create = kernel.CreateFileW
        create.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD, ctypes.c_void_p,
                           wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
        create.restype = wintypes.HANDLE
        close = kernel.CloseHandle
        close.argtypes = [wintypes.HANDLE]
        close.restype = wintypes.BOOL
        handle = create(str(path), 0x80000000, 1, None, 3, 0x00200000, None)
        if handle == ctypes.c_void_p(-1).value:
            raise OSError(ctypes.get_last_error(), 'Upscale component busy or unreadable')
        try:
            fd = msvcrt.open_osfhandle(handle, os.O_RDONLY | os.O_BINARY)
        except BaseException:
            close(handle)
            raise
        stream = os.fdopen(fd, 'rb')  # fd now owns the Windows handle
    else:
        stream = path.open('rb')  # Tests only; no mandatory write/delete protection claim.
    try:
        _ordinary(path)
        if not stat.S_ISREG(os.fstat(stream.fileno()).st_mode):
            raise RuntimeError('Invalid opened component file')
        yield stream
    finally:
        stream.close()


def _verify_stream(stream, size, expected):
    if os.fstat(stream.fileno()).st_size != size:
        raise RuntimeError('超分组件文件大小不匹配 / Upscale component size mismatch')
    if hashlib.file_digest(stream, 'sha256').hexdigest() != expected:
        raise RuntimeError('超分组件校验失败 / Upscale component hash mismatch')


@contextmanager
def acquire_upscale():
    """Yield None for legacy, or one verified (exe, models) pair held for task duration."""
    flag = os.environ.get('FURINAKIT_EXPERIMENTAL_UPSCALE')
    configured = os.environ.get('FURINAKIT_EXPERIMENTAL_UPSCALE_ROOT')
    if flag is None and configured is None:
        yield None
        return
    if flag != '1' or not configured:
        raise RuntimeError('超分实验配置不完整 / Incomplete experimental upscale configuration')
    root = Path(configured)
    if not root.is_absolute() or '..' in root.parts:
        raise RuntimeError('超分组件必须使用绝对路径 / Absolute component path required')
    if os.name == 'nt' and str(root).startswith('\\\\'):
        raise RuntimeError('Network/extended component paths not supported in this experiment')
    for parent in [root, *root.parents]:
        _ordinary(parent, directory=True)
    base = root / 'services/worker/upscale'
    for relative in ['services', 'services/worker', 'services/worker/upscale', 'services/worker/upscale/models']:
        _ordinary(root / relative, directory=True)
    actual = set()
    for directory, dirs, files in os.walk(base, followlinks=False):
        for name in dirs:
            child = Path(directory) / name
            _ordinary(child, directory=True)
            if child != base / 'models':
                raise RuntimeError('Unexpected upscale component directory')
        for name in files:
            f = Path(directory) / name
            _ordinary(f)
            relative = f.relative_to(root).as_posix()
            if relative not in FILES:
                raise RuntimeError('Unexpected upscale component file')
            actual.add(relative)
    if actual != set(FILES):
        raise RuntimeError('超分组件文件缺失或多出未知文件 / Upscale component file-set mismatch')
    with ExitStack() as stack:
        manifest = root / 'split-component.json'
        meta = _ordinary(manifest)
        if meta.st_size > 12000000:
            raise RuntimeError('Oversized upscale manifest')
        f = stack.enter_context(_locked_read(manifest))
        _verify_stream(f, meta.st_size, MANIFEST_SHA256)
        for relative, (size, digest) in sorted(FILES.items()):
            f = stack.enter_context(_locked_read(root / relative))
            _verify_stream(f, size, digest)
        yield base / 'realesrgan-ncnn-vulkan.exe', base / 'models'
