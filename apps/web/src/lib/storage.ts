import path from "path";
import os from "os";
import fs from "fs/promises";

export function getStoragePath(): string {
  const configured = process.env.STORAGE_PATH;
  if (configured) {
    return path.isAbsolute(configured)
      ? configured
      : path.resolve(process.cwd(), configured);
  }
  // On Vercel the project dir is read-only; only /tmp is writable (and ephemeral).
  // Async tools are disabled there anyway, but keep this defensive.
  if (process.env.VERCEL) {
    return path.join(os.tmpdir(), "furinakit-storage");
  }
  return path.resolve(process.cwd(), "../../data/storage");
}

export function getMaxFileSizeBytes(): number {
  const mb = Number(process.env.MAX_FILE_SIZE_MB || 100);
  return mb * 1024 * 1024;
}

export async function ensureStorageDir(): Promise<string> {
  const storagePath = getStoragePath();
  await fs.mkdir(storagePath, { recursive: true });
  await fs.mkdir(path.join(storagePath, "jobs"), { recursive: true });
  await fs.mkdir(path.join(storagePath, "queue"), { recursive: true });
  await fs.mkdir(path.join(storagePath, "uploads"), { recursive: true });
  await fs.mkdir(path.join(storagePath, "results"), { recursive: true });
  return storagePath;
}

export async function saveUpload(file: File, prefix: string): Promise<string> {
  const storagePath = await ensureStorageDir();
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const filename = `${prefix}-${Date.now()}-${safeName}`;
  const fullPath = path.resolve(storagePath, "uploads", filename);
  const buffer = Buffer.from(await file.arrayBuffer());
  await fs.writeFile(fullPath, buffer);
  return fullPath;
}

export async function saveResult(
  jobId: string,
  data: Buffer | Uint8Array,
  filename: string,
): Promise<string> {
  const storagePath = await ensureStorageDir();
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_");
  const fullPath = path.resolve(storagePath, "results", `${jobId}-${safeName}`);
  await fs.writeFile(fullPath, data);
  return fullPath;
}

export async function cleanupExpiredFiles(ttlHours = Number(process.env.JOB_TTL_HOURS || 24)) {
  const storagePath = getStoragePath();
  const cutoff = Date.now() - ttlHours * 60 * 60 * 1000;
  const dirs = ["uploads", "results", "queue"];

  for (const dir of dirs) {
    const dirPath = path.join(storagePath, dir);
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const filePath = path.join(dirPath, entry.name);
        const stat = await fs.stat(filePath);
        if (stat.mtimeMs < cutoff) {
          await fs.unlink(filePath);
        }
      }
    } catch {
      // directory may not exist yet
    }
  }
}
