import path from "path";
import os from "os";
import fs from "fs/promises";
import fsSync from "fs";
import { Readable, type Writable } from "stream";
import { pipeline } from "stream/promises";
import { once } from "events";
import type { ReadableStream as NodeWebReadableStream } from "stream/web";

/**
 * 关于并发：上传现在是「边收边写盘」，请求体本身是一条流，文件段天然一个接一个地到达，
 * 所以同一时刻只会有一个文件在写盘 —— 既不需要并发控制，也不可能因为多文件工具
 * 一次提交几十个文件而把内存或磁盘 IO 铺满。这里不再保留旧的并发常量。
 */

/**
 * 等一个写流彻底关闭。
 *
 * 这一步在 Windows 上是必须的：文件句柄没关之前 `fs.rm` 会以 EBUSY/EPERM 失败，
 * 而失败被吞掉之后就只会在 uploads 里留下一个 0 字节的空壳。
 * 最多等 2 秒，绝不因为一个关不掉的流把请求挂住。
 */
async function waitUntilClosed(stream: Writable): Promise<void> {
  if (stream.closed) return;
  await Promise.race([
    once(stream, "close").catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 2000)),
  ]);
}

/**
 * 删除一个文件，失败就重试几次。
 * 半成品文件（写了一半就出错）必须删干净，不能靠 24 小时后的自动清理兜底。
 */
export async function removeFileQuietly(target: string): Promise<void> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rm(target, { force: true });
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50 * (attempt + 1)));
    }
  }
}

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

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

async function uploadFilePath(storagePath: string, prefix: string, safeName: string): Promise<string> {
  const uploadsDir = path.resolve(storagePath, "uploads");
  let fullPath = path.resolve(uploadsDir, `${prefix}-${Date.now()}-${safeName}`);
  // 同一毫秒内上传两个同名文件（例如从不同目录各选一个 screenshot.png）时，
  // 旧的实现会让两个写入流落到同一个路径、互相覆盖。这里只在真的撞名时才加序号，
  // 常规文件名格式保持不变。
  for (let attempt = 1; attempt <= 100; attempt += 1) {
    if (!(await pathExists(fullPath))) break;
    fullPath = path.resolve(uploadsDir, `${prefix}-${Date.now()}-${attempt}-${safeName}`);
  }
  return fullPath;
}

/**
 * 上传文件名清洗：与旧实现逐字一致（只保留 ASCII 字母数字与 . _ -）。
 * 单独抽出来，是为了让「流式落盘」和「File 落盘」两条路用同一套规则。
 */
function sanitizeUploadName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/**
 * 把一个数据流写到指定路径（命名规则由调用方自己决定），返回实际写入字节数。
 * 内存里只有一个 chunk，失败时清掉半成品。互传（transfer）那条路用它。
 */
export async function writeStreamToFile(
  target: string,
  source: AsyncIterable<Uint8Array>,
): Promise<number> {
  let written = 0;
  const counted = async function* (): AsyncGenerator<Buffer> {
    for await (const chunk of source) {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      written += buf.length;
      yield buf;
    }
  };

  const sink = fsSync.createWriteStream(target);
  try {
    await pipeline(counted(), sink);
  } catch (error) {
    // 先等句柄关闭，再删（否则 Windows 上删不掉，会留下 0 字节空壳）
    await waitUntilClosed(sink);
    await removeFileQuietly(target);
    throw error;
  }

  const onDisk = await fs.stat(target).then(
    (stat) => stat.size,
    () => -1,
  );
  if (onDisk !== written) {
    await removeFileQuietly(target);
    throw new Error(`Incomplete write to "${target}" (${onDisk}/${written} bytes).`);
  }

  return written;
}

/**
 * 把一个上传数据流边收边写到磁盘（内存卫生的关键路径）。
 *
 * 与旧实现最大的区别：源不再是「已经完整躺在内存里的 File」，而是直接从请求体上
 * 切下来的字节流（见 lib/multipart.ts）。内存里只有一个 chunk（默认 64KB 量级），
 * 上传多大的文件都不会让进程内存跟着涨。中途出错会删掉半成品文件。
 *
 * 返回落盘的绝对路径与实际写入字节数（调用方要拿字节数写记录）。
 */
export async function saveUploadStream(
  prefix: string,
  filename: string,
  source: AsyncIterable<Uint8Array>,
  declaredSize?: number,
): Promise<{ path: string; size: number }> {
  const storagePath = await ensureStorageDir();
  const safeName = sanitizeUploadName(filename);
  const fullPath = await uploadFilePath(storagePath, prefix, safeName);
  const size = await writeStreamToFile(fullPath, source);

  if (declaredSize !== undefined && declaredSize !== size) {
    await removeFileQuietly(fullPath);
    throw new Error(`Upload of "${filename}" was incomplete (${size}/${declaredSize} bytes written).`);
  }

  return { path: fullPath, size };
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

/**
 * 保存一个上传文件并返回它的绝对路径。
 * 行为与旧实现保持一致（同样的文件名清洗规则、同样返回绝对路径、同样不做大小限制），
 * 唯一的区别是写盘方式：改成流式，内存占用不再随文件大小线性增长。
 */
export async function saveUpload(file: File, prefix: string): Promise<string> {
  const saved = await saveUploadStream(
    prefix,
    file.name,
    Readable.fromWeb(file.stream() as unknown as NodeWebReadableStream<Uint8Array>),
    file.size,
  );
  return saved.path;
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
  // queue 目录里放的是「还没被 worker 取走的任务」。若按同样的 TTL 清理，
  // 用户排了队、隔天才开软件的任务会被静默删掉，所以给它更长的宽限期。
  const queueCutoff = Date.now() - Math.max(ttlHours, 24 * 7) * 60 * 60 * 1000;

  const targets: Array<{ dir: string; limit: number }> = [
    { dir: "uploads", limit: cutoff },
    { dir: "queue", limit: queueCutoff },
  ];

  // 刻意不清理 results：
  // results 里放的可能是某些工具「唯一」的产出文件 —— 视频下载（video-downloader）、
  // 图片超分（image-upscaler）、以及走 saveResult() 的服务端同步小工具，它们的输出
  // 只写在这一处，别处没有副本。用户下载完的视频、超分好的图片属于用户产出，
  // 24 小时后被自动删掉就是实实在在的数据丢失，所以应用绝不主动删除它们。
  // 需要清理的用户可以在界面里自己删除；目录本身仍由 ensureStorageDir() 继续创建。

  // 刻意不清理 transfers/received 与 transfers/shared：
  // 这两个目录里是「用户互传的文件」，它们对用户是有意义的，不能被当成临时文件删掉。
  // 尤其是手机传过来的那一份，很可能是这台电脑上唯一的副本（手机端可能已经删了）。
  // 这些文件由用户在互传界面里自己删除（delete-shared / delete-received），
  // 应用只在下面把「文件已经不在」的记录清掉，绝不主动删用户的文件。

  let removed = 0;
  for (const { dir, limit } of targets) {
    const dirPath = path.join(storagePath, dir);
    try {
      const entries = await fs.readdir(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isFile()) continue;
        const filePath = path.join(dirPath, entry.name);
        try {
          const stat = await fs.stat(filePath);
          if (stat.mtimeMs < limit) {
            await fs.unlink(filePath);
            removed += 1;
          }
        } catch {
          // 单个文件清理失败不影响其它文件
        }
      }
    } catch {
      // directory may not exist yet
    }
  }

  await pruneTransferMetadata(storagePath);

  return { removed, ttlHours };
}

/**
 * 清理互传记录里「文件已经不在了」的条目。
 * 否则界面会一直列出早已过期（或被用户自己删掉）的文件，点下载却 404。
 */
async function pruneTransferMetadata(storagePath: string): Promise<void> {
  const metaPath = path.join(storagePath, "transfers", "metadata.json");
  try {
    const raw = await fs.readFile(metaPath, "utf-8");
    const meta = JSON.parse(raw) as {
      sharedFiles?: Array<{ name?: string }>;
      receivedFiles?: Array<{ name?: string; path?: string }>;
      [key: string]: unknown;
    };
    if (!meta || typeof meta !== "object") return;

    const sharedDir = path.join(storagePath, "transfers", "shared");
    let changed = false;

    if (Array.isArray(meta.sharedFiles)) {
      const kept = meta.sharedFiles.filter((f) => {
        if (!f?.name) return false;
        const p = path.join(sharedDir, f.name);
        const exists = fsSync.existsSync(p);
        if (!exists) changed = true;
        return exists;
      });
      meta.sharedFiles = kept;
    }

    if (Array.isArray(meta.receivedFiles)) {
      const kept = meta.receivedFiles.filter((f) => {
        // 有记录绝对路径的按路径判断（接收目录可能被用户自定义到别处）
        const candidate = f?.path || (f?.name ? path.join(storagePath, "transfers", "received", f.name) : "");
        if (!candidate) return false;
        const exists = fsSync.existsSync(candidate);
        if (!exists) changed = true;
        return exists;
      });
      meta.receivedFiles = kept;
    }

    if (changed) {
      await fs.writeFile(metaPath, JSON.stringify(meta, null, 2), "utf-8");
    }
  } catch {
    // 没有元数据文件或格式异常时忽略
  }
}
