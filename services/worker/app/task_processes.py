"""Configured worker task custody. Standard-library only; no application imports.

Retains the calling task slot, lease and scratch until all tracked Jobs are empty.
An unconfirmed stop retries without publishing a terminal state. Native launches
bypassing CPython's CreateProcess hook and owner death are separate open boundaries.
"""
from contextlib import contextmanager
import contextvars
import logging
import os
import subprocess
import threading
import time
from app.owned_process import Job

_log = logging.getLogger("furinakit.task_processes")
_current = contextvars.ContextVar("furinakit_process_scope", default=None)
_launch = contextvars.ContextVar("furinakit_process_launch", default=None)
_install_lock = threading.Lock()
_original_popen = subprocess.Popen
_installed = False


class Node:
    def __init__(self):
        self.job = Job()
        self.ready = False
        self.exited_at = None
        self.forced = False
        self.process = None  # Keep Popen alive until its owned tree is confirmed empty.


class Scope:
    def __init__(self, pending=lambda: None):
        install()
        self.lock = threading.RLock()
        self.nodes = []
        self.closing = False
        self.pending = pending
        self.done = threading.Event()
        self.watcher = threading.Thread(target=self._watch, daemon=True, name="task-tree-watch")
        self.watcher.start()

    def launch(self, node, args):
        with self.lock:
            if self.closing:
                raise RuntimeError("Task subprocess scope is closing")
            if node is None:
                node = Node()
                self.nodes.append(node)
            try:
                return node.job.spawn(*args)
            finally:
                node.ready = True

    def new_node(self):
        with self.lock:
            if self.closing:
                raise RuntimeError("Task subprocess scope is closing")
            node = Node(); self.nodes.append(node)
            return node

    def _watch(self):
        while not self.done.wait(0.05):
            try:
                with self.lock:
                    for node in self.nodes:
                        if not node.ready or node.job.root is None:
                            continue
                        if node.job.root_exited() and not node.job.empty():
                            if node.exited_at is None:
                                node.exited_at = time.monotonic()
                            elif time.monotonic() - node.exited_at >= 1:
                                # Close descendant-held stdout/stderr even when communicate
                                # is blocked waiting for EOF after the root has already exited.
                                node.forced = True
                                node.job.stop()
            except Exception:
                _log.exception("Task process observation failed; resources remain held")

    def settle(self, node, timeout, command):
        end = None if timeout is None else time.monotonic() + max(0, timeout)
        while True:
            with self.lock:
                empty = node.job.empty()
                forced = node.forced
            if empty:
                if forced:
                    raise RuntimeError("Subprocess root exited with surviving descendants; tree stopped")
                return
            if end is not None and time.monotonic() >= end:
                raise subprocess.TimeoutExpired(command, timeout)
            time.sleep(0.01)

    def finish(self):
        with self.lock:
            self.closing = True
        announced = False
        while True:
            try:
                with self.lock:
                    pending = [n for n in self.nodes if not n.job.empty()]
                    if not pending:
                        # Reap the CPython view too, before dropping our strong references.
                        # Job cleanup alone leaves abandoned Popen.returncode unset and can
                        # run its destructor while the process is still alive.
                        for node in self.nodes:
                            if node.process is not None and _original_popen.poll(node.process) is None:
                                raise RuntimeError("Owned root not reaped; retaining task resources")
                        break
                    for node in pending:
                        node.forced = True
                        node.job.stop()
            except Exception:
                _log.exception("Task cleanup not confirmed; retaining lease, scratch and slot")
            if not announced:
                announced = True
                try:
                    self.pending()
                except Exception:
                    _log.exception("Unable to report pending process cleanup")
            time.sleep(0.25)
        self.done.set()
        # No pipe-reader join. Do not close handles while the observer may use them.
        while self.watcher.is_alive():
            self.watcher.join(0.1)
        with self.lock:
            forced = any(n.forced for n in self.nodes)
            for node in self.nodes:
                node.job.close_confirmed()
                node.process = None
        return forced


class OwnedPopen(_original_popen):
    def __init__(self, *args, **kwargs):
        self._task_scope = _current.get()
        self._task_node = None
        if self._task_scope is None:
            super().__init__(*args, **kwargs)
            return
        # Serialize construction/registration with scope closure, including copied
        # contexts. Never close a Job between CreateProcess and Popen registration.
        with self._task_scope.lock:
            self._task_node = self._task_scope.new_node()
            token = _launch.set(self._task_node)
            try:
                super().__init__(*args, **kwargs)
            finally:
                if getattr(self, "_child_created", False) and hasattr(self, "_handle"):
                    self._task_node.process = self
                _launch.reset(token)

    def kill(self):
        if self._task_node is None:
            return super().kill()
        with self._task_scope.lock:
            # A later destructor may run after scope closure. Never act on reused handles.
            if self._task_node.job.handle is not None:
                self._task_node.job.stop()

    terminate = kill

    def wait(self, timeout=None):
        started = time.monotonic()
        result = super().wait(timeout=timeout)
        if self._task_node is not None and self._task_node.job.handle is not None:
            remaining = None if timeout is None else max(0, timeout - (time.monotonic() - started))
            self._task_scope.settle(self._task_node, remaining, self.args)
        return result


def configured():
    return any(os.environ.get(name) is not None for name in (
        "FURINAKIT_COMPONENT_LEASE_NAMESPACE", "FURINAKIT_COMPONENT_LEASE_FILES"))


def install_configured():
    """Install before queue/config imports; leave unconfigured legacy entry unchanged."""
    if configured():
        install()


def install():
    global _installed
    if os.name != "nt":
        raise RuntimeError("Task subprocess custody requires Windows")
    with _install_lock:
        if _installed:
            return
        import _winapi
        original = _winapi.CreateProcess

        def create(*args):
            scope = _current.get()
            if scope is not None:
                return scope.launch(_launch.get(), args)
            if configured():
                raise RuntimeError("Configured worker subprocess lacks task custody context")
            return original(*args)  # Explicit unconfigured legacy mode only.

        _winapi.CreateProcess = create
        subprocess.Popen = OwnedPopen
        _installed = True


@contextmanager
def task_scope(pending=lambda: None):
    if os.environ.get("FURINAKIT_COMPONENT_LEASE_NAMESPACE") is None:
        yield None  # Historical unconfigured caller: no protection claim.
        return
    scope = Scope(pending)
    token = _current.set(scope)
    try:
        yield scope
    finally:
        try:
            forced = scope.finish()
        finally:
            _current.reset(token)
        if forced:
            raise RuntimeError("Task left subprocesses running; owned trees stopped before finalization")
