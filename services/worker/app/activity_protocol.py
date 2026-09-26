"""Opt-in v2 admission ledger, interoperable with recovery_guard::protocol.
Not imported by existing worker task_lease. No PID/age/lock-release recovery.
Only the trusted observer/host can authorize completion; JSON is not an OS proof.
All mutators must participate before this can be a production recovery fence.
"""
import ctypes
from ctypes import wintypes
from functools import lru_cache
import hashlib
import json
import os
from pathlib import Path
import stat
import uuid

MAX = 128 * 1024

def keys(names):
    if not isinstance(names, (list, tuple)) or not 1 <= len(names) <= 64:
        raise ValueError("INVALID: resource count")
    for n in names:
        if (not isinstance(n, str) or not n or len(n.encode('utf-8')) > 1024
                or n in ('.', '..') or n.endswith(('.', ' '))
                or any(ord(c) < 32 or 127 <= ord(c) <= 159 or c in ':/' + '\\<>\"|?*' for c in n)):
            raise ValueError('INVALID: resource name')
    return sorted(set(n.lower() for n in names))

def validate(rec):
    if (type(rec) is not dict or set(rec) != {'version', 'activity', 'resources', 'mode'}
            or type(rec['version']) is not int or rec['version'] != 2
            or not isinstance(rec['activity'], str) or len(rec['activity']) != 32
            or any(c not in '0123456789abcdef' for c in rec['activity'])
            or type(rec['resources']) is not list or rec['mode'] not in ('use', 'change')):
        raise ValueError('INVALID: record identity/version/fields')
    if keys(rec['resources']) != rec['resources']:
        raise ValueError('INVALID: noncanonical resources')
    return rec

def _pairs(pairs):
    value = {}
    for k, v in pairs:
        if k in value:
            raise ValueError('INVALID: duplicate JSON field')
        value[k] = v
    return value

def _ordinary(path, directory=False):
    m = Path(path).lstat()
    if (stat.S_ISLNK(m.st_mode) or getattr(m, 'st_file_attributes', 0) & 0x400
            or not (stat.S_ISDIR(m.st_mode) if directory else stat.S_ISREG(m.st_mode))):
        raise ValueError('INVALID: linked/non-file namespace or journal')
    return m

@lru_cache(maxsize=1)
def _kernel():
    if os.name != 'nt':
        raise RuntimeError('Windows required')
    k = ctypes.WinDLL('kernel32', use_last_error=True)
    k.CreateFileW.argtypes = [wintypes.LPCWSTR,wintypes.DWORD,wintypes.DWORD,ctypes.c_void_p,wintypes.DWORD,wintypes.DWORD,wintypes.HANDLE]
    k.CreateFileW.restype = wintypes.HANDLE
    k.CloseHandle.argtypes = [wintypes.HANDLE]
    k.CloseHandle.restype = wintypes.BOOL
    k.GetFileType.argtypes = [wintypes.HANDLE]
    k.GetFileType.restype = wintypes.DWORD
    k.GetFileInformationByHandle.argtypes = [wintypes.HANDLE, ctypes.c_void_p]
    k.GetFileInformationByHandle.restype = wintypes.BOOL
    k.MoveFileExW.argtypes = [wintypes.LPCWSTR,wintypes.LPCWSTR,wintypes.DWORD]
    k.MoveFileExW.restype = wintypes.BOOL
    return k

class _Info(ctypes.Structure):
    _fields_ = [('attributes',wintypes.DWORD),('creation',wintypes.FILETIME),('access',wintypes.FILETIME),('write',wintypes.FILETIME),('volume',wintypes.DWORD),('size_high',wintypes.DWORD),('size_low',wintypes.DWORD),('links',wintypes.DWORD),('index_high',wintypes.DWORD),('index_low',wintypes.DWORD)]

def _open(path, *, write=False, share=7, create=3, empty=False):
    import msvcrt
    k = _kernel()
    h = k.CreateFileW(str(path),0xC0000000 if write else 0x80000000,share,None,create,0x00200000,None)
    if h == ctypes.c_void_p(-1).value:
        code = ctypes.get_last_error()
        if code in (32,33):
            raise RuntimeError('BUSY: resource/admission transaction')
        raise ctypes.WinError(code)
    fd = None
    try:
        info = _Info()
        if not k.GetFileInformationByHandle(h,ctypes.byref(info)):
            raise ctypes.WinError(ctypes.get_last_error())
        if k.GetFileType(h) != 1 or info.attributes & (0x400|0x10) or (empty and (info.size_high or info.size_low)):
            raise ValueError('INVALID: file handle')
        fd = msvcrt.open_osfhandle(int(h), (os.O_RDWR if write else os.O_RDONLY)|os.O_BINARY)
        return os.fdopen(fd,'r+b' if write else 'rb',buffering=0)
    except BaseException:
        if fd is None:
            k.CloseHandle(h)
        else:
            os.close(fd)
        raise

def _read(path, limit):
    try:
        m = _ordinary(path)
    except FileNotFoundError:
        return None
    if m.st_size > limit:
        raise ValueError('INVALID: oversized journal')
    with _open(path) as f:
        data = f.read(limit + 1)
    if len(data) > limit:
        raise ValueError('INVALID: oversized journal')
    return data

def read_record(path):
    data = _read(Path(path),MAX)
    if data is None:
        raise ValueError('INVALID: record disappeared')
    return validate(json.loads(data.decode('utf-8'),object_pairs_hook=_pairs))

def _lock(path, mode):
    try:
        with open(path,'xb'):
            pass
    except FileExistsError:
        pass
    if _ordinary(path).st_size:
        raise ValueError('INVALID: lease sentinel')
    return _open(path,write=mode=='change',share=0 if mode=='change' else 1,empty=True)

def receipt_complete(ns, rec):
    validate(rec)
    expected = ('{"version":1,"activity":"'+rec['activity']+'","state":"job-empty"}\n').encode('ascii')
    data = _read(Path(ns)/('receipt-v2-'+rec['activity']+'.json'),256)
    if data is None:
        return False
    if data == expected:
        return True
    if expected.startswith(data):
        return False
    raise ValueError('INVALID: foreign completion receipt')

def _scan_locked(ns, resources, mode):
    count = 0
    for p in ns.iterdir():
        name = p.name
        folded = name.lower()  # classify Windows aliases, then require canonical spelling
        if not folded.startswith('activity-') or not folded.endswith('.json'):
            continue
        count += 1
        if count > 4096:
            raise RuntimeError('RECOVERY_REQUIRED: ledger needs bounded archival')
        if not folded.startswith('activity-v2-'):
            raise RuntimeError('RECOVERY_REQUIRED: legacy/unknown activity, no implicit migration')
        rec = read_record(p)
        if name != 'activity-v2-'+rec['activity']+'.json':
            raise ValueError('INVALID: filename/identity mismatch')
        if (mode == 'change' or rec['mode'] == 'change') and set(resources).intersection(rec['resources']):
            if not receipt_complete(ns,rec):
                raise RuntimeError('RECOVERY_REQUIRED: unresolved activity '+rec['activity'])

def _namespace(ns):
    ns = Path(ns)
    if not ns.is_absolute():
        raise ValueError('INVALID: namespace')
    _ordinary(ns,directory=True)
    return ns

def _mode(mode):
    if mode not in ('use','change'):
        raise ValueError('INVALID: mode')

def inspect(ns, names, mode):
    ns = _namespace(ns)
    _mode(mode)
    resources = keys(names)
    with _lock(ns/'admission-v2.lease','change'):
        _scan_locked(ns,resources,mode)

def _publish(ns, path, rec):
    data = json.dumps(rec,ensure_ascii=False,separators=(',',':')).encode('utf-8')
    if len(data)>MAX:
        raise ValueError('INVALID: oversized journal')
    tmp = ns/('.activity-v2-'+uuid.uuid4().hex+'.pending')
    with open(tmp,'xb') as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    try:
        if not _kernel().MoveFileExW(str(tmp),str(path),8):
            raise ctypes.WinError(ctypes.get_last_error())
    finally:
        tmp.unlink(missing_ok=True)

class Reservation:
    def __init__(self,rec,receipt,leases):
        self.record,self.receipt,self.leases = rec,receipt,leases
    def close(self):
        # Does NOT delete/complete the record. Handle release is not Job-empty proof.
        self.receipt.close()
        for f in reversed(self.leases):
            f.close()
    def __enter__(self):
        return self
    def __exit__(self,*_):
        self.close()

def reserve(ns,names,mode,*,activity=None):
    ns = _namespace(ns)
    rec = validate({'version':2,'activity':uuid.uuid4().hex if activity is None else activity,'resources':keys(names),'mode':mode})
    with _lock(ns/'admission-v2.lease','change'):
        path = ns/('activity-v2-'+rec['activity']+'.json')
        for prefix in ('activity-v2-','completed-v2-','unlaunched-v2-'):
            try:
                (ns/(prefix+rec['activity']+'.json')).lstat()
            except FileNotFoundError:
                continue
            raise ValueError('INVALID: activity identity already used')
        _scan_locked(ns,rec['resources'],mode)
        leases,receipt = [],None
        try:
            for name in rec['resources']:
                leases.append(_lock(ns/('file-'+hashlib.sha256(name.encode('utf-8')).hexdigest()+'.lease'),mode))
            receipt = _open(ns/('receipt-v2-'+rec['activity']+'.json'),write=True,create=1)
            os.fsync(receipt.fileno())
            _publish(ns,path,rec)
            return Reservation(rec,receipt,leases)
        except BaseException:
            if receipt is not None:
                receipt.close()
            for f in reversed(leases):
                f.close()
            # Retain staging/receipt on publication uncertainty; never synthesize proof.
            raise

def _archive_one(ns, activity):
    active = ns/('activity-v2-'+activity+'.json')
    archived = ns/('completed-v2-'+activity+'.json')
    def exists(path):
        try:
            path.lstat()
            return True
        except FileNotFoundError:
            return False
    def bound(rec):
        if rec['activity'] != activity:
            raise ValueError('INVALID: archive identity mismatch')
    if not exists(active):
        if not exists(archived):
            return 'not-found'
        rec = read_record(archived)
        bound(rec)
        return 'already-archived' if receipt_complete(ns,rec) else 'unproven'
    if exists(archived):
        return 'destination-exists'
    rec = read_record(active)
    bound(rec)
    if not receipt_complete(ns,rec):
        return 'unproven'
    held = []
    try:
        for name in rec['resources']:
            held.append(_lock(ns/('file-'+hashlib.sha256(name.encode('utf-8')).hexdigest()+'.lease'),'change'))
        if read_record(active) != rec:
            raise ValueError('INVALID: activity changed during archival')
        if not receipt_complete(ns,rec):
            return 'unproven'
        if not _kernel().MoveFileExW(str(active),str(archived),8):
            raise ctypes.WinError(ctypes.get_last_error())
        return 'archived'
    finally:
        for f in reversed(held):
            f.close()

def archive_completed(ns, activities):
    """Explicit 1..64 IDs. Atomic per record, NOT all-or-nothing per batch.

    A returned list may contain failures: callers must inspect every status. Never
    deletes receipts, leases, scratch or models; never infers proof from free locks.
    The admission gate serializes cooperating writers, not hostile disk writers.
    """
    if (not isinstance(activities,(list,tuple)) or not 1 <= len(activities) <= 64
            or any(not isinstance(a,str) or len(a)!=32 or any(c not in '0123456789abcdef' for c in a) for a in activities)
            or len(set(activities)) != len(activities)):
        raise ValueError('INVALID: archive identity set')
    ns = _namespace(ns)
    results = []
    with _lock(ns/'admission-v2.lease','change'):
        for activity in activities:
            detail = None
            try:
                status = _archive_one(ns,activity)
            except ValueError as e:
                status,detail = 'invalid',str(e)
            except (RuntimeError,OSError) as e:
                detail = str(e)
                status = 'busy' if detail.startswith('BUSY:') else 'io-error'
            results.append({'activity':activity,'status':status,'detail':detail})
    return results
