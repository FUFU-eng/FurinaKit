import Redis from "ioredis";
import { v4 as uuidv4 } from "uuid";
import type { Job, JobStatus } from "@furinakit/shared";
import { JobSchema } from "@furinakit/shared";
import {
  createFileJob,
  createLocalFileJob,
  getFileJob,
  listFileJobs,
  updateFileJob,
  countActiveFileJobs,
  isFileQueueEnabled,
  removeQueuedItems,
} from "./file-jobs";

const JOB_PREFIX = "furinakit:job:";
const ACTIVE_JOBS_KEY = "furinakit:active_jobs";
const JOB_INDEX_KEY = "furinakit:job_index";
export const JOB_QUEUE = "furinakit:job_queue";

let redis: Redis | null = null;
let redisAvailable: boolean | null = null;
let redisCheckedAt = 0;
const REDIS_CHECK_TTL_MS = 30_000;

function getRedisClient(): Redis {
  if (!redis) {
    redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379/0", {
      maxRetriesPerRequest: 1,
      enableReadyCheck: true,
      enableOfflineQueue: false,
      connectTimeout: 2_000,
      commandTimeout: 2_000,
      retryStrategy: () => null,
      lazyConnect: true,
    });
  }
  return redis;
}

async function checkRedisAvailable(): Promise<boolean> {
  if (isFileQueueEnabled()) return false;

  const now = Date.now();
  if (redisAvailable !== null && now - redisCheckedAt < REDIS_CHECK_TTL_MS) {
    return redisAvailable;
  }

  const client = getRedisClient();
  try {
    if (client.status === "wait") {
      await client.connect();
    }
    await client.ping();
    redisAvailable = true;
  } catch {
    redisAvailable = false;
    try {
      client.disconnect();
    } catch {
      // ignore
    }
  }

  redisCheckedAt = now;
  return redisAvailable;
}

export async function isQueueAvailable(): Promise<{ ok: boolean; mode: "redis" | "file" }> {
  if (await checkRedisAvailable()) {
    return { ok: true, mode: "redis" };
  }
  return { ok: true, mode: "file" };
}

function jobKey(id: string) {
  return `${JOB_PREFIX}${id}`;
}

export function getMaxConcurrentJobs(): number {
  return Number(process.env.MAX_CONCURRENT_JOBS || 10);
}

export async function countActiveJobs(): Promise<number> {
  if (await checkRedisAvailable()) {
    const client = getRedisClient();
    return client.scard(ACTIVE_JOBS_KEY);
  }
  return countActiveFileJobs();
}

export async function createLocalJob(toolId: string, payload: Record<string, unknown>): Promise<Job> {
  if (!(await checkRedisAvailable())) {
    return createLocalFileJob(toolId, payload);
  }

  const client = getRedisClient();
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

  await client.set(jobKey(job.id), JSON.stringify(job));
  await client.sadd(ACTIVE_JOBS_KEY, job.id);
  await client.lpush(JOB_INDEX_KEY, job.id);
  await client.ltrim(JOB_INDEX_KEY, 0, 199);

  return job;
}

export async function createJob(toolId: string, payload: Record<string, unknown>): Promise<Job> {
  const maxConcurrent = getMaxConcurrentJobs();

  if (!(await checkRedisAvailable())) {
    return createFileJob(toolId, payload, maxConcurrent);
  }

  const client = getRedisClient();
  const active = await countActiveJobs();
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

  await client.set(jobKey(job.id), JSON.stringify(job));
  await client.sadd(ACTIVE_JOBS_KEY, job.id);
  await client.lpush(JOB_INDEX_KEY, job.id);
  await client.ltrim(JOB_INDEX_KEY, 0, 199);
  await client.lpush(JOB_QUEUE, JSON.stringify({ jobId: job.id, toolId, payload }));

  return job;
}

export async function getJob(id: string): Promise<Job | null> {
  if (await checkRedisAvailable()) {
    const client = getRedisClient();
    const raw = await client.get(jobKey(id));
    if (!raw) return null;
    return JobSchema.parse(JSON.parse(raw));
  }
  return getFileJob(id);
}

export async function updateJob(
  id: string,
  updates: Partial<Job> & { status?: JobStatus },
): Promise<Job | null> {
  if (await checkRedisAvailable()) {
    const existing = await getJob(id);
    if (!existing) return null;

    // 已结束的任务不允许被"进度更新"拉回处理中（与文件队列模式保持一致）
    const terminal = (s: JobStatus | undefined) => s === "completed" || s === "failed";
    if (terminal(existing.status) && !terminal(updates.status)) {
      return existing;
    }

    const updated: Job = {
      ...existing,
      ...updates,
      updatedAt: new Date().toISOString(),
    };

    const client = getRedisClient();
    await client.set(jobKey(id), JSON.stringify(updated));

    if (updated.status === "completed" || updated.status === "failed") {
      await client.srem(ACTIVE_JOBS_KEY, id);
    }

    return updated;
  }

  return updateFileJob(id, updates);
}

// 取消任务：把状态标记为失败（错误信息"已取消"），并且真正清掉队列里的待处理项，
// 这样 worker 不会在之后把这个任务取出来执行、完成后再把状态写回 completed。
export async function cancelJob(id: string): Promise<Job | null> {
  const existing = await getJob(id);
  if (!existing) return null;

  // 只有进行中的任务才能取消
  const status = existing.status as string;
  if (status === "completed" || status === "failed") {
    return existing;
  }

  let removed = 0;
  if (await checkRedisAvailable()) {
    // Redis 模式的队列项是序列化后的 JSON，扫一遍把属于该任务的项删掉
    try {
      const client = getRedisClient();
      const items = await client.lrange(JOB_QUEUE, 0, -1);
      for (const raw of items) {
        try {
          const item = JSON.parse(raw) as { jobId?: string };
          if (item && item.jobId === id) {
            await client.lrem(JOB_QUEUE, 0, raw);
            removed += 1;
          }
        } catch {
          // 忽略无法解析的队列项
        }
      }
    } catch {
      // Redis 异常时仍然要把任务标记为已取消
    }
  } else {
    removed = await removeQueuedItems(id);
  }

  const updated = await updateJob(id, {
    status: "failed",
    error: "已取消",
    progress: existing.progress || 0,
  });

  if (removed > 0) {
    console.log(`[jobs] 任务 ${id} 已取消，同时从队列移除了 ${removed} 个待处理项`);
  }
  return updated;
}

export async function listRecentJobs(limit = 50): Promise<Job[]> {
  if (await checkRedisAvailable()) {
    const client = getRedisClient();
    const ids = await client.lrange(JOB_INDEX_KEY, 0, limit - 1);
    const jobs: Job[] = [];

    const now = Date.now();
    for (const id of ids) {
      const raw = await client.get(jobKey(id));
      if (!raw) continue;
      const job = JobSchema.parse(JSON.parse(raw));
      if (job.expiresAt && new Date(job.expiresAt).getTime() <= now) continue;
      jobs.push(job);
    }

    return jobs.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    );
  }

  return listFileJobs(limit);
}
