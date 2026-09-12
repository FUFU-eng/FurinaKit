import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { v4 as uuidv4 } from "uuid";
import type { Job, JobStatus } from "@furinakit/shared";
import { JobSchema } from "@furinakit/shared";
import { getStoragePath } from "./storage";

const JOB_INDEX_FILE = "job-index.json";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidJobId(id: string): boolean {
  return typeof id === "string" && UUID_RE.test(id);
}

/** 终态：写下去之后任务就结束了，前端不再轮询 */
function isTerminalStatus(status: JobStatus | undefined): boolean {
  return status === "completed" || status === "failed";
}

/**
 * 进度更新是否可以覆盖终态。
 *
 * 背景：worker 的「进度回调」和「完成回调」是两条独立的异步链，顺序交错时会把已经写好的
 * `completed` 覆盖回 `processing`。后果是前端永远转圈、下载按钮永远不出现，
 * 而结果文件其实早就生成好了 —— 用户只能重启软件。
 * 所以终态一旦写入，就不允许被非终态更新覆盖回去。
 */
function wouldResurrectTerminal(
  existingStatus: JobStatus | undefined,
  incomingStatus: JobStatus | undefined,
): boolean {
  return isTerminalStatus(existingStatus) && !isTerminalStatus(incomingStatus);
}

function jobsDir(): string {
  return path.join(getStoragePath(), "jobs");
}

function queueDir(): string {
  return path.join(getStoragePath(), "queue");
}

async function ensureDirs(): Promise<void> {
  await fs.mkdir(jobsDir(), { recursive: true });
  await fs.mkdir(queueDir(), { recursive: true });
}

function jobFilePath(id: string): string {
  if (!isValidJobId(id)) {
    throw new Error("Invalid job id");
  }
  return path.join(jobsDir(), `${id}.json`);
}

async function readJobIndex(): Promise<string[]> {
  const indexPath = path.join(getStoragePath(), JOB_INDEX_FILE);
  try {
    const raw = await fs.readFile(indexPath, "utf8");
    return JSON.parse(raw) as string[];
  } catch {
    return [];
  }
}

async function writeJobIndex(ids: string[]): Promise<void> {
  const indexPath = path.join(getStoragePath(), JOB_INDEX_FILE);
  await fs.writeFile(indexPath, JSON.stringify(ids.slice(0, 200)));
}

async function saveJob(job: Job): Promise<void> {
  await fs.writeFile(jobFilePath(job.id), JSON.stringify(job));
  const index = await readJobIndex();
  if (!index.includes(job.id)) {
    await writeJobIndex([job.id, ...index]);
  }
}

export async function createFileJob(
  toolId: string,
  payload: Record<string, unknown>,
  maxConcurrent: number,
): Promise<Job> {
  await ensureDirs();

  const active = await countActiveFileJobs();
  if (active >= maxConcurrent) {
    throw new Error(`Too many active jobs. Maximum concurrent jobs: ${maxConcurrent}`);
  }

  const now = new Date().toISOString();
  const ttlHours = Number(process.env.JOB_TTL_HOURS || 24);
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();

  const job: Job = {
    id: uuidv4(),
    toolId,
    status: "pending",
    progress: 0,
    message: "Queued",
    createdAt: now,
    updatedAt: now,
    expiresAt,
  };

  await saveJob(job);
  const queueItem = {
    jobId: job.id,
    toolId,
    payload,
    enqueuedAt: now,
  };
  await fs.writeFile(path.join(queueDir(), `${Date.now()}-${job.id}.json`), JSON.stringify(queueItem));

  return job;
}

export async function createLocalFileJob(
  toolId: string,
  payload: Record<string, unknown>,
): Promise<Job> {
  await ensureDirs();
  const now = new Date().toISOString();
  const ttlHours = Number(process.env.JOB_TTL_HOURS || 24);
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000).toISOString();

  const job: Job = {
    id: uuidv4(),
    toolId,
    status: "pending",
    progress: 0,
    message: "准备中...",
    createdAt: now,
    updatedAt: now,
    expiresAt,
  };

  await saveJob(job);
  return job;
}

export async function getFileJob(id: string): Promise<Job | null> {
  if (!isValidJobId(id)) return null;
  try {
    const raw = await fs.readFile(jobFilePath(id), "utf8");
    return JobSchema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

export async function updateFileJob(
  id: string,
  updates: Partial<Job> & { status?: JobStatus },
): Promise<Job | null> {
  const existing = await getFileJob(id);
  if (!existing) return null;

  // 已结束的任务不允许被"进度更新"拉回处理中
  if (wouldResurrectTerminal(existing.status, updates.status)) {
    return existing;
  }

  const updated: Job = {
    ...existing,
    ...updates,
    updatedAt: new Date().toISOString(),
  };

  await saveJob(updated);
  return updated;
}

function isExpired(job: Job, now = Date.now()): boolean {
  return Boolean(job.expiresAt && new Date(job.expiresAt).getTime() <= now);
}

/**
 * 只移除该任务在队列里的待处理项，保留任务记录本身。
 * 取消任务时必须调用它：否则任务虽然显示"已取消"，worker 稍后仍会把它从队列里取出来执行，
 * 完成时再把状态写回 completed —— 用户会看到任务"自己复活"。
 * @returns 实际移除的队列项数量
 */
export async function removeQueuedItems(id: string): Promise<number> {
  if (!isValidJobId(id)) return 0;
  let removed = 0;
  try {
    const files = await fs.readdir(queueDir());
    for (const f of files) {
      if (!f.endsWith(`-${id}.json`)) continue;
      await fs.rm(path.join(queueDir(), f), { force: true }).catch(() => {});
      removed += 1;
    }
  } catch {
    /* queue dir may be absent */
  }
  return removed;
}

/** Delete a job's state file plus any pending queue items referencing it. */
async function purgeJobFiles(id: string): Promise<void> {
  if (!isValidJobId(id)) return;
  await fs.rm(jobFilePath(id), { force: true }).catch(() => {});
  await removeQueuedItems(id);
}

export async function countActiveFileJobs(): Promise<number> {
  const jobs = await listFileJobs(50);
  return jobs.filter((job) => job.status === "pending" || job.status === "processing").length;
}

export async function listFileJobs(limit = 50): Promise<Job[]> {
  await ensureDirs();
  const index = await readJobIndex();
  const jobs: Job[] = [];

  if (index.length > 0) {
    for (const id of index) {
      const job = await getFileJob(id);
      if (job) jobs.push(job);
    }
  } else {
    const files = await fs.readdir(jobsDir());
    for (const file of files) {
      if (!file.endsWith(".json")) continue;
      const raw = await fs.readFile(path.join(jobsDir(), file), "utf8");
      try {
        jobs.push(JobSchema.parse(JSON.parse(raw)));
      } catch {
        continue;
      }
    }
  }

  // Drop expired jobs and self-heal: remove their files + queue items + index entries.
  const now = Date.now();
  const live = jobs.filter((job) => !isExpired(job, now));
  const expired = jobs.filter((job) => isExpired(job, now));
  if (expired.length > 0) {
    await Promise.all(expired.map((job) => purgeJobFiles(job.id)));
  }

  // 回收「僵尸任务」：状态还停在待处理/处理中，但很久没有任何更新。
  // 这类任务会一直占着并发名额，等累积到上限之后所有新任务都会被 429 拒绝，
  // 而且重建前端也无法自愈（限制是读磁盘上的任务状态算出来的）。
  // 注意：这里只影响「多久没更新」的判定，真正长时间在跑的任务仍会持续刷新进度；
  // 万一误判，任务真正完成时 worker 会把终态写回来（completed 也是终态，允许覆盖）。
  const staleHours = Math.max(1, Number(process.env.JOB_STALE_HOURS || 3) || 3);
  const staleMs = staleHours * 60 * 60 * 1000;
  const stale = live.filter((job) => {
    if (job.status !== "processing" && job.status !== "pending") return false;
    const updated = new Date(job.updatedAt || job.createdAt).getTime();
    return Number.isFinite(updated) && now - updated > staleMs;
  });
  if (stale.length > 0) {
    for (const job of stale) {
      const reason = `超过 ${staleHours} 小时没有任何进度更新，已判定为卡死并回收`;
      await updateFileJob(job.id, {
        status: "failed",
        progress: 100,
        message: "任务已失效",
        error: reason,
      });
      // 同步内存中的副本，让本次返回的结果与磁盘一致
      job.status = "failed";
      job.progress = 100;
      job.message = "任务已失效";
      job.error = reason;
    }
    console.log(`[file-jobs] 回收了 ${stale.length} 个卡死的任务`);
  }

  if (expired.length > 0 || index.length === 0) {
    await writeJobIndex(live.map((j) => j.id));
  }

  return live
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, limit);
}

export function isFileQueueEnabled(): boolean {
  return process.env.USE_FILE_QUEUE === "1" || process.env.USE_FILE_QUEUE === "true";
}

export function fileQueueReady(): boolean {
  return existsSync(getStoragePath());
}
