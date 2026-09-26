"""Windows atomic Job launch adapter for CPython subprocess (configured worker only).

No config/queue imports. No spawn-then-assign, no PID lookup for termination.
This is cooperative subprocess containment, not a native-DLL sandbox or a durable
owner-death lease mechanism. APIs bypassing _winapi.CreateProcess are not covered.
"""
import ctypes as C
from ctypes import wintypes as W
import os

D = C.c_uint32
H = C.c_void_p
S = C.c_size_t


class Startup(C.Structure):
    _fields_ = [("cb", D), ("reserved", H), ("desktop", H), ("title", H),
                ("x", D), ("y", D), ("xs", D), ("ys", D), ("xc", D), ("yc", D),
                ("fill", D), ("flags", D), ("show", C.c_uint16), ("reserved_size", C.c_uint16),
                ("reserved_bytes", H), ("stdin", H), ("stdout", H), ("stderr", H)]


class StartupEx(C.Structure):
    _fields_ = [("startup", Startup), ("attributes", H)]


class ProcessInfo(C.Structure):
    _fields_ = [("process", H), ("thread", H), ("pid", D), ("tid", D)]


class BasicLimits(C.Structure):
    _fields_ = [("process_time", C.c_int64), ("job_time", C.c_int64), ("flags", D),
                ("min_ws", S), ("max_ws", S), ("active_limit", D), ("affinity", S),
                ("priority", D), ("scheduling", D)]


class Limits(C.Structure):
    _fields_ = [("basic", BasicLimits), ("io", C.c_uint64 * 6), ("process_memory", S),
                ("job_memory", S), ("peak_process", S), ("peak_job", S)]


class Accounting(C.Structure):
    _fields_ = [("times", C.c_int64 * 4), ("faults", D), ("total", D), ("active", D), ("terminated", D)]


def _api():
    if os.name != "nt":
        raise RuntimeError("Owned worker subprocesses require Windows")
    k = C.WinDLL("kernel32", use_last_error=True)
    signatures = {
        "CreateJobObjectW": ([H, W.LPCWSTR], H),
        "SetInformationJobObject": ([H, C.c_int, H, D], W.BOOL),
        "QueryInformationJobObject": ([H, C.c_int, H, D, H], W.BOOL),
        "TerminateJobObject": ([H, D], W.BOOL),
        "CloseHandle": ([H], W.BOOL),
        "WaitForSingleObject": ([H, D], D),
        "GetCurrentProcess": ([], H),
        "DuplicateHandle": ([H, H, H, C.POINTER(H), D, W.BOOL, D], W.BOOL),
        "InitializeProcThreadAttributeList": ([H, D, D, C.POINTER(S)], W.BOOL),
        "UpdateProcThreadAttribute": ([H, D, S, H, S, H, H], W.BOOL),
        "DeleteProcThreadAttributeList": ([H], None),
        "CreateProcessW": ([W.LPCWSTR, W.LPWSTR, H, H, W.BOOL, D, H, W.LPCWSTR, H, C.POINTER(ProcessInfo)], W.BOOL),
    }
    for name, (args, result) in signatures.items():
        fn = getattr(k, name); fn.argtypes = args; fn.restype = result
    return k


def _check(ok):
    if not ok:
        raise C.WinError(C.get_last_error())


class Job:
    def __init__(self):
        self.k = _api()
        self.handle = self.k.CreateJobObjectW(None, None)
        _check(self.handle)
        self.root = None
        limits = Limits(); limits.basic.flags = 0x2000  # KILL_ON_JOB_CLOSE; no breakaway
        try:
            _check(self.k.SetInformationJobObject(self.handle, 9, C.byref(limits), C.sizeof(limits)))
        except BaseException:
            self.k.CloseHandle(self.handle); self.handle = None
            raise

    def empty(self):
        info = Accounting()
        _check(self.k.QueryInformationJobObject(self.handle, 1, C.byref(info), C.sizeof(info), None))
        return info.active == 0 and (self.root is None or self.root_exited())

    def root_exited(self):
        if self.root is None:
            return False
        status = self.k.WaitForSingleObject(self.root, 0)
        if status not in (0, 258):
            _check(False)
        return status == 0

    def stop(self):
        _check(self.k.TerminateJobObject(self.handle, 1))

    def close_confirmed(self):
        if not self.empty():
            raise RuntimeError("Refusing to release a live or unconfirmed process tree")
        if self.root:
            self.k.CloseHandle(self.root); self.root = None
        self.k.CloseHandle(self.handle); self.handle = None

    def spawn(self, application, command, process_attrs, thread_attrs, inherit, flags, env, cwd, startup):
        if process_attrs is not None or thread_attrs is not None or flags & (0x01000000 | 0x00080000 | 0x00000004):
            raise ValueError("Unsupported security/extended/suspended/breakaway worker launch")
        attrs = getattr(startup, "lpAttributeList", None) or {}
        if set(attrs) - {"handle_list"}:
            raise ValueError("Unsupported worker startup attribute")
        handles = attrs.get("handle_list") or []
        if inherit and not handles:
            raise ValueError("Unbounded handle inheritance is not allowed for worker tasks")
        entries = [(0x2000D, (H * 1)(self.handle))]
        if handles:
            entries.append((0x20002, (H * len(handles))(*(int(h) for h in handles))))
        size = S()
        self.k.InitializeProcThreadAttributeList(None, len(entries), 0, C.byref(size))
        if not size.value:
            _check(False)
        storage = C.create_string_buffer(size.value)
        _check(self.k.InitializeProcThreadAttributeList(storage, len(entries), 0, C.byref(size)))
        try:
            for attr, data in entries:
                _check(self.k.UpdateProcThreadAttribute(storage, 0, attr, C.byref(data), C.sizeof(data), None, None))
            si = StartupEx(); si.startup.cb = C.sizeof(si); si.attributes = C.cast(storage, H)
            si.startup.flags = getattr(startup, "dwFlags", 0)
            si.startup.show = getattr(startup, "wShowWindow", 0)
            for dest, src in [("stdin", "hStdInput"), ("stdout", "hStdOutput"), ("stderr", "hStdError")]:
                value = getattr(startup, src, None)
                setattr(si.startup, dest, int(value) if value is not None else None)
            environment = None
            if env is not None:
                pairs = []
                for key, value in env.items():
                    if not isinstance(key, str) or not isinstance(value, str) or not key or "\0" in key + value or "=" in key[1:]:
                        raise ValueError("Invalid Unicode worker environment")
                    pairs.append((key, value))
                pairs.sort(key=lambda p: p[0].upper())
                environment = C.create_unicode_buffer("\0".join(k + "=" + v for k, v in pairs) + "\0\0")
            mutable = C.create_unicode_buffer(command)
            pi = ProcessInfo()
            _check(self.k.CreateProcessW(application, mutable, None, None, bool(handles),
                                        flags | 0x80000 | 0x400, environment, cwd, C.byref(si), C.byref(pi)))
            # Own an independent root handle; CPython is free to close its returned handle.
            duplicate = H()
            me = self.k.GetCurrentProcess()
            if not self.k.DuplicateHandle(me, pi.process, me, C.byref(duplicate), 0, False, 2):
                error = C.WinError(C.get_last_error())
                self.k.TerminateJobObject(self.handle, 1)
                self.k.CloseHandle(pi.thread); self.k.CloseHandle(pi.process)
                raise error  # Scope still retains the Job and lease until query confirms empty.
            self.root = duplicate.value
            return pi.process, pi.thread, pi.pid, pi.tid
        finally:
            self.k.DeleteProcThreadAttributeList(storage)
