import { NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import type { ReadStream, Stats } from "fs";
import { Readable } from "stream";
import { getJob } from "@/lib/jobs";
import { getStoragePath } from "@/lib/storage";
import { getCustomOutputDir } from "@/lib/settings";
import { guardApiRequest } from "@/lib/api-guard";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 流式下载的分块大小：单个 chunk 的上限，与文件大小无关。 */
const STREAM_HIGH_WATER_MARK = 64 * 1024;

function isValidJobId(id: string): boolean {
  return typeof id === "string" && UUID_RE.test(id);
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

function isInside(baseDir: string, target: string): boolean {
  const rel = path.relative(baseDir, target);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function candidateIfInside(baseDir: string, target: string): string | null {
  return isInside(baseDir, target) ? target : null;
}

function getOutputDir(): string {
  // 优先使用用户在设置中自定义的输出目录
  const customOutputDir = getCustomOutputDir();
  if (customOutputDir) {
    return path.isAbsolute(customOutputDir)
      ? customOutputDir
      : path.resolve(process.cwd(), customOutputDir);
  }
  // 其次使用 Electron 设置的默认输出目录
  const defaultOutputDir = process.env.FURINAKIT_DEFAULT_OUTPUT_DIR;
  if (defaultOutputDir) {
    return path.isAbsolute(defaultOutputDir)
      ? defaultOutputDir
      : path.resolve(process.cwd(), defaultOutputDir);
  }
  // 回退到存储目录下的 results
  return path.resolve(getStoragePath(), "results");
}

/**
 * 取 stat 并确认它是普通文件。只有「读不到」或「不是文件」才返回 null，
 * 让调用方继续尝试下一个候选路径（与旧实现里 readFile 抛错后继续的行为一致）。
 */
async function statIfFile(filePath: string): Promise<Stats | null> {
  try {
    const stat = await fs.stat(filePath);
    return stat.isFile() ? stat : null;
  } catch {
    return null;
  }
}

/** 一个已经解析成功、可以满足的 byte range（两端都含）。 */
type ResolvedRange = { start: number; end: number };

/**
 * 解析单段 HTTP Range（RFC 7233 §2.1）。
 *
 * 返回 null 表示「无法满足」：语法非法（`bytes=0-abc`、`bytes=`）、越界
 * （`start >= fileSize`）、`end < start`，以及后缀长度非法的 `bytes=-0`。
 * 调用方对 null 一律回 416 + `Content-Range: bytes (星号)/size`。
 *
 * 支持的形态：
 *   `bytes=0-9`   → 0..9
 *   `bytes=0-`    → 0..fileSize-1（缺省 end）
 *   `bytes=-500`  → 最后 500 字节（后缀范围，以前会被 parseInt("") 的 NaN 误判成 416）
 *   `bytes=0-999999`（末字节越界）→ 按 RFC 截断到 fileSize-1
 */
function resolveRange(rawRange: string, fileSize: number): ResolvedRange | null {
  const headerMatch = /^\s*bytes\s*=\s*(.+)$/i.exec(rawRange);
  if (!headerMatch) return null;

  // 只认第一个 range（多段 range 在旧实现里也只是取第一段的效果）
  const spec = headerMatch[1].split(",")[0].trim();
  const specMatch = /^(\d*)-(\d*)$/.exec(spec);
  if (!specMatch) return null;

  const rawStart = specMatch[1];
  const rawEnd = specMatch[2];

  if (rawStart === "" && rawEnd === "") return null;

  if (rawStart === "") {
    // 后缀范围：bytes=-N 表示最后 N 个字节
    const suffixLength = Number(rawEnd);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    if (fileSize === 0) return null;
    const start = Math.max(fileSize - suffixLength, 0);
    return { start, end: fileSize - 1 };
  }

  const start = Number(rawStart);
  if (!Number.isSafeInteger(start) || start >= fileSize) return null;

  let end: number;
  if (rawEnd === "") {
    end = fileSize - 1;
  } else {
    const parsedEnd = Number(rawEnd);
    if (!Number.isSafeInteger(parsedEnd)) return null;
    // 末字节越界时按 RFC 截断（旧实现直接回 416，会让 `bytes=0-<很大的数>` 的播放器播不出来）
    end = parsedEnd >= fileSize ? fileSize - 1 : parsedEnd;
  }

  if (end < start) return null;
  return { start, end };
}

/**
 * 打开一个流式响应体。
 *
 * 先用 fs.open 打开（这样「文件读不了」能在发响应头之前就暴露出来，
 * 调用方还能继续尝试下一个候选路径），随后把 fd 的所有权交给 ReadStream：
 * autoClose 保证正常读完、出错、以及被上层 cancel/destroy 时都会关闭 fd。
 * 客户端断开（request.signal abort）时主动 destroy，避免流挂在后台继续读文件。
 */
async function openStreamBody(
  filePath: string,
  signal: AbortSignal,
  range?: ResolvedRange,
): Promise<ReadableStream<Uint8Array>> {
  const fileHandle = await fs.open(filePath, "r");
  let nodeStream: ReadStream;
  try {
    nodeStream = fileHandle.createReadStream({
      ...(range ? { start: range.start, end: range.end } : {}),
      autoClose: true,
      highWaterMark: STREAM_HIGH_WATER_MARK,
    });
  } catch (error) {
    await fileHandle.close().catch(() => {});
    throw error;
  }

  const abortStream = () => {
    nodeStream.destroy();
  };
  if (signal.aborted) {
    abortStream();
  } else {
    signal.addEventListener("abort", abortStream, { once: true });
  }
  nodeStream.once("close", () => {
    signal.removeEventListener("abort", abortStream);
  });
  // 响应头早就发出去了，此刻无法再改状态码；至少要记录原因，
  // 并且 destroy 会关闭 fd，不会留下泄漏的句柄。
  nodeStream.on("error", (error) => {
    console.error(`[download] streaming ${filePath} failed:`, error);
    nodeStream.destroy();
  });

  // Readable.toWeb 会把底层流的 error 传给 web 流（由消费者处理），
  // 消费者取消时也会 destroy 底层流。
  return Readable.toWeb(nodeStream) as unknown as ReadableStream<Uint8Array>;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const denied = guardApiRequest(request);
  if (denied) return denied;
  const { id } = await context.params;
  if (!isValidJobId(id)) {
    return NextResponse.json({ error: "Result not available" }, { status: 404 });
  }
  const job = await getJob(id);

  if (!job || job.status !== "completed" || !job.resultFilename) {
    return NextResponse.json({ error: "Result not available" }, { status: 404 });
  }

  const outputDir = getOutputDir();
  const safeResultName = sanitizeFilename(job.resultFilename);
  const fileName = `${id}-${safeResultName}`;
  const resultsDir = path.resolve(getStoragePath(), "results");
  const defaultDir = process.env.FURINAKIT_DEFAULT_OUTPUT_DIR
    ? (path.isAbsolute(process.env.FURINAKIT_DEFAULT_OUTPUT_DIR)
        ? process.env.FURINAKIT_DEFAULT_OUTPUT_DIR
        : path.resolve(process.cwd(), process.env.FURINAKIT_DEFAULT_OUTPUT_DIR))
    : null;

  // 在所有可能的目录（自定义目录、默认输出目录、存储 results 目录）中检索
  const searchDirs = Array.from(
    new Set([outputDir, resultsDir, defaultDir].filter((d): d is string => Boolean(d)))
  );

  const candidatePaths: string[] = [];
  for (const dir of searchDirs) {
    candidatePaths.push(path.resolve(dir, fileName));
    const rawMatch = candidateIfInside(dir, path.resolve(dir, `${id}-${job.resultFilename}`));
    if (rawMatch && !candidatePaths.includes(rawMatch)) candidatePaths.push(rawMatch);
    const bareMatch = candidateIfInside(dir, path.resolve(dir, job.resultFilename));
    if (bareMatch && !candidatePaths.includes(bareMatch)) candidatePaths.push(bareMatch);
  }

  for (const filePath of candidatePaths) {
    // 只有「取 stat」这一步失败才继续尝试下一个候选路径；
    // Range 解析失败等 416 判定必须在它外面，否则会被当成「文件不存在」吞掉。
    const stat = await statIfFile(filePath);
    if (!stat) continue;

    const fileSize = stat.size;
    const mimeType = job.resultMimeType || "application/octet-stream";

    // 检查是否为 HTTP Range 请求（音频/视频拖动进度条需要 Range 支持）
    const rangeHeader = request.headers.get("range");
    if (rangeHeader) {
      const range = resolveRange(rangeHeader, fileSize);
      if (!range) {
        return new NextResponse(null, {
          status: 416,
          headers: {
            "Content-Range": `bytes */${fileSize}`,
          },
        });
      }

      let body: ReadableStream<Uint8Array>;
      try {
        body = await openStreamBody(filePath, request.signal, range);
      } catch {
        // 候选路径打不开（权限/被占用等）→ 继续尝试下一个
        continue;
      }

      const contentLength = range.end - range.start + 1;
      return new NextResponse(body, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${range.start}-${range.end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(contentLength),
          "Content-Type": mimeType,
        },
      });
    }

    // 常规完整文件下载或初次流式读取（默认必须为 attachment，防止浏览器或窗口直接作为网页/播放器跳转）
    const urlObj = new URL(request.url);
    const isPreview = urlObj.searchParams.get("preview") === "1";
    const dispositionType = isPreview ? "inline" : "attachment";

    let body: ReadableStream<Uint8Array>;
    try {
      body = await openStreamBody(filePath, request.signal);
    } catch {
      continue;
    }

    // 下载名：filename* 按 RFC 5987 带 UTF-8 编码（中文名不会被浏览器存成 %E6%95%B0… 这种乱码），
    // filename 保留一份纯 ASCII 兜底，给不支持 filename* 的老客户端用。
    const downloadName = job.resultFilename || safeResultName;
    const asciiName = downloadName.replace(/[^A-Za-z0-9._-]/g, "_") || "download";

    return new NextResponse(body, {
      headers: {
        "Content-Type": mimeType,
        "Accept-Ranges": "bytes",
        "Content-Length": String(fileSize),
        "Content-Disposition": `${dispositionType}; filename="${asciiName}"; filename*=UTF-8''${encodeURIComponent(downloadName)}`,
      },
    });
  }

  return NextResponse.json({ error: "File not found or expired" }, { status: 404 });
}
