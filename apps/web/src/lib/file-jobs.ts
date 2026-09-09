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

/** Delete a job's state file plus any pending queue items referencing it. */
async function purgeJobFiles(id: string): Promise<void> {
  if (!isValidJobId(id)) return;
  await fs.rm(jobFilePath(id), { force: true }).catch(() => {});
  try {
    const files = await fs.readdir(queueDir());
    await Promise.all(
      files
        .filter((f) => f.endsWith(`-${id}.json`))
        .map((f) => fs.rm(path.join(queueDir(), f), { force: true }).catch(() => {})),
    );
  } catch {
    /* queue dir may be absent */
  }
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
