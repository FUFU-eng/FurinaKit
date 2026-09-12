import json
import logging
import os
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, NamedTuple

from app.storage_paths import storage_root

logger = logging.getLogger("furinakit.file_job_store")

UUID_PATTERN = re.compile(
    r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)
QUEUE_FILE_PATTERN = re.compile(
    r"^[0-9]+-[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-"
    r"[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\.json$"
)

# 认领实现（多线程 / 多进程安全），目录 queue/claimed/：
#   1) <原文件名>.lock            —— 认领令牌，用 os.open(O_CREAT|O_EXCL) 独占创建，
#                                    内核保证同一时刻只有一个赢家（实测见 tests/test_file_job_store.py）。
#   2) <原文件名>.<uuid>.claim    —— 被 os.replace 原子搬过来的任务文件本体，名字唯一。
# 两个名字都不是 *.json 且位于子目录，所以 glob("*.json") 永远不会再选中认领中的文件。
#
# 为什么不能只用 os.replace：Windows 上并发 os.replace(同一个 src, 同一个 dst) 会向所有调用者
# 返回「成功」（实测 8/8 成功，但只有一个文件真的落盘），loser 会误以为自己抢到了任务
# —— 那样同一个任务就会被处理多次。所以用 O_EXCL 令牌判定所有权，用唯一名 rename 搬文件。
CLAIM_SUFFIX = ".claim"
CLAIM_LOCK_SUFFIX = ".lock"
CLAIMED_DIR_NAME = "claimed"
# 认领只存在于「改名 → 解析」这几毫秒内，超过这个时限还留在 queue/claimed/ 的一定是
# 上一个进程被强杀（或断电）留下的孤儿，启动时回收/接管，避免任务被永久吞掉。
STALE_CLAIM_SECONDS = 300.0


class Claim(NamedTuple):
    """一次成功的认领：data_path 是任务文件本体，lock_path 是认领令牌，queue_name 是队列里的原名。"""
    data_path: Path
    lock_path: Path
    queue_name: str



def _storage_root() -> Path:
    return storage_root()


def jobs_dir() -> Path:
    path = _storage_root() / "jobs"
    path.mkdir(parents=True, exist_ok=True)
    return path


def queue_dir() -> Path:
    path = _storage_root() / "queue"
    path.mkdir(parents=True, exist_ok=True)
    return path


def failed_queue_dir() -> Path:
    """坏队列文件的隔离目录（queue/failed），避免它们反复阻塞整个队列"""
    path = queue_dir() / "failed"
    path.mkdir(parents=True, exist_ok=True)
    return path


def claimed_queue_dir() -> Path:
    """认领目录（queue/claimed）：出队时被 os.replace 抢走的队列文件暂存在这里。

    与 queue/ 同一个磁盘卷，因此 os.replace 是同卷原子改名。
    """
    path = queue_dir() / CLAIMED_DIR_NAME
    path.mkdir(parents=True, exist_ok=True)
    return path


def _atomic_write_text(path: Path, text: str) -> None:
    """先写同目录临时文件再 os.replace 原子替换，避免进程被杀/磁盘异常时留下半截文件。

    半截 JSON 正是让整个队列永久卡死的原因：解析失败 → 每轮都重新失败 → 后面的新任务再也取不到。
    """
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_name(f".{path.name}.{uuid.uuid4().hex}.tmp")
    try:
        tmp_path.write_text(text, encoding="utf-8")
        os.replace(tmp_path, path)
    finally:
        if tmp_path.exists():
            try:
                tmp_path.unlink()
            except OSError:  # pragma: no cover - 清理失败不影响已完成的替换
                pass


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def is_valid_job_id(job_id: str) -> bool:
    """A job id must be a plain UUID so it can never escape the jobs dir."""
    return bool(job_id) and UUID_PATTERN.fullmatch(job_id) is not None


def get_job(job_id: str) -> dict[str, Any] | None:
    if not is_valid_job_id(job_id):
        return None
    job_path = jobs_dir() / f"{job_id}.json"
    if not job_path.exists():
        return None
    return json.loads(job_path.read_text(encoding="utf-8"))


def update_job(job_id: str, **updates: Any) -> dict[str, Any] | None:
    job = get_job(job_id)
    if not job:
        return None

    job.update(updates)
    job["updatedAt"] = _now()
    job_path = jobs_dir() / f"{job_id}.json"
    _atomic_write_text(job_path, json.dumps(job))
    return job


def write_queue_file(payload: dict[str, Any], filename: str | None = None) -> Path:
    """原子地写入一个队列文件（临时文件 + os.replace），返回写入后的路径。

    文件命名与前端一致：<毫秒时间戳>-<jobId>.json，这样析取端仍能按 mtime 排序。
    """
    job_id = str(payload.get("jobId") or "")
    if not is_valid_job_id(job_id):
        job_id = str(uuid.uuid4())
        payload = {**payload, "jobId": job_id}
    name = filename or f"{int(time.time() * 1000)}-{job_id}.json"
    if not QUEUE_FILE_PATTERN.fullmatch(name):
        raise ValueError(f"invalid queue file name: {name!r}")
    target = queue_dir() / name
    _atomic_write_text(target, json.dumps(payload))
    return target


def _quarantine_queue_file(item_path: Path, reason: Exception, original_name: str | None = None) -> None:
    """把无法解析的队列文件移进 queue/failed/，绝不让它继续卡住队列。

    参数 item_path 可能是认领文件（<原名>.claim）；此时用 original_name 还原成
    队列里的原始名字再归档，方便事后排查。
    """
    display_name = original_name or item_path.name
    try:
        target = failed_queue_dir() / display_name
        if target.exists():
            target = target.with_name(f"{target.stem}.{int(time.time() * 1000)}.bad{target.suffix}")
        os.replace(item_path, target)
        logger.warning("Quarantined corrupt queue file %s -> %s (%s)", display_name, target.name, reason)
    except OSError as exc:  # 连移动都失败：退化为加 .bad 后缀原地改名，最后才考虑删除
        logger.warning("Failed to quarantine corrupt queue file %s: %s", item_path, exc)
        fallback = item_path.with_name(f"{display_name}.bad")
        try:
            item_path.rename(fallback)
        except OSError as exc2:
            logger.error("Failed to rename corrupt queue file %s: %s", item_path, exc2)


def _claim_queue_file(source: Path, _retry_on_stale: bool = True) -> Claim | None:
    """抢占一个候选队列文件，成功返回 Claim，抢占失败返回 None。

    两步抢占（先拿令牌，再搬文件）：
      1. os.open(<原名>.lock, O_CREAT|O_EXCL) —— 独占创建，内核保证同一时刻只有一个赢家
         （POSIX 的 open(O_EXCL) 与 Windows 的 CreateFile(CREATE_NEW) 都保证这一点）；
      2. os.replace(source, <原名>.<uuid>.claim) —— 同卷原子改名把任务文件搬进认领目录。

    第 2 步之后还必须确认文件真的落在自己的唯一名字下：Windows 上并发 os.replace
    可能「返回成功却没有真的搬动文件」，不校验会让多个线程都以为自己抢到了同一个任务。
    """
    claimed = claimed_queue_dir()
    lock_path = claimed / f"{source.name}{CLAIM_LOCK_SUFFIX}"

    try:
        fd = os.open(lock_path, os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        if _retry_on_stale and _takeover_stale_lock(lock_path):
            return _claim_queue_file(source, _retry_on_stale=False)
        return None  # 已被其它线程/进程认领
    except OSError as exc:
        # Windows 上文件被占用（共享冲突）等：本轮跳过，下一轮再试，绝不让整条队列停摆
        logger.debug("Cannot claim %s: %s", source.name, exc)
        return None
    try:
        os.close(fd)
    except OSError:  # pragma: no cover
        pass

    data_path = claimed / f"{source.name}.{uuid.uuid4().hex}{CLAIM_SUFFIX}"
    try:
        os.replace(source, data_path)
    except OSError as exc:  # FileNotFoundError = 源文件已经被别人拿走/生产端删掉了
        _release_claim(Claim(data_path, lock_path, source.name))
        logger.debug("Lost claim race for %s: %s", source.name, exc)
        return None

    # 见 docstring：Windows 的 rename 在并发下会「假成功」，必须自己确认文件真的到了
    if not data_path.exists():
        _release_claim(Claim(data_path, lock_path, source.name))
        logger.debug("Claim of %s did not actually move the file; retrying later.", source.name)
        return None
    return Claim(data_path, lock_path, source.name)


def _takeover_stale_lock(lock_path: Path) -> bool:
    """接管一个明显过期的认领令牌（只有上次进程被强杀才会留下），成功返回 True。"""
    try:
        age = time.time() - lock_path.stat().st_mtime
    except OSError:
        return False
    if age < STALE_CLAIM_SECONDS:
        return False
    try:
        lock_path.unlink()
        logger.warning("Took over stale claim lock %s (age %.0fs)", lock_path.name, age)
        return True
    except OSError:
        return False


def _release_claim(claim: Claim) -> None:
    """认领的使命在解析完成后就结束了（payload 已在内存里），立刻清理两个文件，不留垃圾。"""
    for path in (claim.data_path, claim.lock_path):
        try:
            path.unlink(missing_ok=True)
        except OSError as exc:  # pragma: no cover - 极端权限问题
            logger.warning("Failed to remove claim file %s: %s", path.name, exc)


def _quarantine_claim(claim: Claim, reason: Exception) -> None:
    """坏任务：把本体归档到 queue/failed/（用队列原名），并释放认领令牌。"""
    _quarantine_queue_file(claim.data_path, reason, original_name=claim.queue_name)
    _release_claim(claim)


def _queue_candidates() -> list[Path]:
    """queue/ 下所有符合命名规范的待处理文件，按 mtime 从旧到新。"""
    def _mtime(path: Path) -> float:
        """按 mtime 排序；文件在扫描后消失时排到最后而不是让整轮抛异常。"""
        try:
            return path.stat().st_mtime
        except OSError:
            return float("inf")

    queue = queue_dir()
    candidates = [
        p for p in queue.glob("*.json")
        if QUEUE_FILE_PATTERN.fullmatch(p.name)
    ]
    return sorted(candidates, key=_mtime)


def dequeue_file_job(timeout: int = 5) -> dict[str, Any] | None:
    """取出最旧的合法队列任务（多线程 / 多进程安全）。

    流程是「先原子抢占、再解析」：
      1. 扫描 queue/ 下符合命名规范的候选（忽略不规范的文件），按 mtime 最旧优先；
      2. 用 O_EXCL 独占创建认领令牌，再把候选文件 os.replace 到 queue/claimed/ 下的
         唯一名字 —— 只有一个调用者能拿到同一个任务的令牌，因此并发出队不会重复取到
         同一个任务；认领中的文件也不再出现在第 1 步的候选里；
      3. 解析认领到的文件；解析失败 / 结构非法就移进 queue/failed/（重名加时间戳 + .bad），
         然后继续尝试下一个候选；
      4. 解析成功立即删除认领文件与令牌并返回 payload。

    任何情况下都不会抛异常把队列堵死；超时（timeout 秒）内没有任务就返回 None。
    """
    deadline = time.time() + timeout
    while time.time() < deadline:
        for item_path in _queue_candidates():
            claim = _claim_queue_file(item_path)
            if claim is None:
                continue
            try:
                raw = claim.data_path.read_text(encoding="utf-8")
            except OSError as exc:  # 认领成功但读失败（占用/权限）：隔离后继续下一个
                _quarantine_claim(claim, exc)
                continue
            try:
                payload = json.loads(raw)
            except ValueError as exc:  # json.JSONDecodeError / UnicodeDecodeError 都是 ValueError
                _quarantine_claim(claim, exc)
                continue
            if not isinstance(payload, dict):
                _quarantine_claim(
                    claim, ValueError(f"payload is {type(payload).__name__}, expected object")
                )
                continue
            _release_claim(claim)
            return payload
        time.sleep(0.5)
    return None


def requeue_stale_claims(max_age_seconds: float = STALE_CLAIM_SECONDS) -> int:
    """回收「上一次进程被强杀」留下的孤儿认领，避免任务被永久吞掉。

    正常的认领只存在几毫秒（拿令牌 → 搬文件 → 解析 → 删除），所以超过 max_age_seconds
    还留在 queue/claimed/ 的必然是死进程遗留物：
      - 有令牌又有数据文件：把数据文件改回 queue/ 重新排队，然后删掉令牌；
      - 只有令牌（崩在两步之间）：任务文件还在 queue/ 里，直接删掉令牌即可；
      - 只有数据文件（没有令牌）：同样改回 queue/。
    返回重新排队的任务数量。
    """
    claimed = claimed_queue_dir()
    recovered = 0
    try:
        locks = list(claimed.glob(f"*{CLAIM_LOCK_SUFFIX}"))
        datas = list(claimed.glob(f"*{CLAIM_SUFFIX}"))
    except OSError as exc:  # pragma: no cover
        logger.warning("Failed to scan claimed queue dir: %s", exc)
        return 0

    now = time.time()

    def _age(path: Path) -> float | None:
        try:
            return now - path.stat().st_mtime
        except OSError:
            return None

    def _requeue(data_path: Path, queue_name: str, age: float) -> bool:
        nonlocal recovered
        if not QUEUE_FILE_PATTERN.fullmatch(queue_name):
            logger.warning("Dropping unrecognized claim file %s", data_path.name)
            _quarantine_queue_file(
                data_path, ValueError("unrecognized claim file name"), original_name=data_path.name
            )
            return False
        target = queue_dir() / queue_name
        try:
            if target.exists():  # 同名文件已经在队列里，避免互相覆盖
                _quarantine_queue_file(
                    data_path, ValueError("queue file name already in use"), original_name=queue_name
                )
                return False
            os.replace(data_path, target)
            recovered += 1
            logger.warning("Requeued stale claimed job file %s (age %.0fs)", queue_name, age)
            return True
        except OSError as exc:
            logger.warning("Failed to requeue stale claim %s: %s", data_path.name, exc)
            return False

    # 1) 先按令牌处理：令牌 + 数据文件 = 崩在解析阶段；只有令牌 = 崩在两步之间
    for lock in locks:
        lock_age = _age(lock)
        if lock_age is None or lock_age < max_age_seconds:
            continue
        queue_name = lock.name[: -len(CLAIM_LOCK_SUFFIX)]
        data_candidates = sorted(claimed.glob(f"{queue_name}.*{CLAIM_SUFFIX}"))
        handled = False
        for data_path in data_candidates:
            data_age = _age(data_path)
            if data_age is None:
                continue
            _requeue(data_path, queue_name, data_age)
            handled = True
        if not handled:
            logger.warning("Removing orphan claim lock %s (no data file, age %.0fs)", lock.name, lock_age)
        try:
            lock.unlink(missing_ok=True)
        except OSError as exc:
            logger.warning("Failed to remove stale claim lock %s: %s", lock.name, exc)

    # 2) 再处理没有令牌的数据文件（理论上不该出现，出现了也要收干净）
    for data_path in datas:
        data_age = _age(data_path)
        if data_age is None or data_age < max_age_seconds:
            continue
        name = data_path.name[: -len(CLAIM_SUFFIX)]
        queue_name = name.rsplit(".", 1)[0] if "." in name else name
        if (claimed / f"{queue_name}{CLAIM_LOCK_SUFFIX}").exists():
            continue  # 归属上面那条令牌，已经处理过了
        _requeue(data_path, queue_name, data_age)
    return recovered
