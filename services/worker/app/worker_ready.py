"""Publish only queue-loop readiness, not model capabilities or authenticity.

No config/queue/task imports here. Unconfigured legacy callers retain their mode.
The real entry calls this after its imports/executor setup, before dispatching.
"""
import json
import os
from pathlib import Path
import re


def publish_ready(*, file_queue: bool, storage: Path) -> bool:
    name = os.environ.get("FURINAKIT_WORKER_READY_FILE")
    nonce = os.environ.get("FURINAKIT_WORKER_READY_NONCE")
    if name is None and nonce is None:
        return False
    if not name or not nonce or not re.fullmatch(r"[0-9a-f]{32}", nonce):
        raise RuntimeError("Incomplete worker readiness challenge")
    reply = Path(name)
    if not reply.is_absolute() or reply.name != "ready.json":
        raise ValueError("Invalid readiness reply location")
    if file_queue is not True or os.environ.get("USE_FILE_QUEUE") != "1":
        raise RuntimeError("Native worker requires file queue mode")
    supplied = os.environ.get("STORAGE_PATH", "")
    alias = os.environ.get("STORAGE_DIR", "")
    if (not supplied or not alias or not Path(supplied).is_absolute()
            or not Path(alias).is_absolute() or not os.path.samefile(storage, supplied)
            or not os.path.samefile(alias, supplied)):
        raise RuntimeError("Worker storage does not match native staging")
    from app.component_leases import _keys, _ordinary
    namespace = os.environ.get("FURINAKIT_COMPONENT_LEASE_NAMESPACE", "")
    if not namespace or not Path(namespace).is_absolute():
        raise RuntimeError("Missing native component lease namespace")
    _ordinary(Path(namespace), directory=True)
    _keys(json.loads(os.environ.get("FURINAKIT_COMPONENT_LEASE_FILES", "null")))
    _ordinary(reply.parent, directory=True)
    # Parent owns a newly created, unique challenge directory. Never overwrite a receipt.
    if reply.exists():
        raise FileExistsError("Readiness receipt already exists")
    temporary = reply.with_name("ready.tmp")
    created = False
    try:
        with temporary.open("x", encoding="utf-8", newline="\n") as stream:
            created = True
            json.dump({"schema": 1, "nonce": nonce, "pid": os.getpid(), "leaseProtocol": 1,
                       "fileQueue": True, "storage": supplied}, stream)
            stream.flush()
            os.fsync(stream.fileno())
        # Windows rename fails if the destination exists; no stale file replacement.
        # This native protocol targets Windows; do not claim POSIX no-replace semantics.
        if os.name != "nt":
            raise RuntimeError("Native readiness publication requires Windows")
        os.rename(temporary, reply)
    finally:
        if created:
            try:
                temporary.unlink()
            except FileNotFoundError:
                pass
    return True
