import { NextResponse } from "next/server";
import path from "path";
import fs from "fs/promises";
import { getJob } from "@/lib/jobs";
import { getStoragePath } from "@/lib/storage";
import { getCustomOutputDir } from "@/lib/settings";

export const runtime = "nodejs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
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
    try {
      const stat = await fs.stat(filePath);
      const fileSize = stat.size;
      const mimeType = job.resultMimeType || "application/octet-stream";

      // 检查是否为 HTTP Range 请求（音频/视频拖动进度条需要 Range 支持）
      const rangeHeader = _request.headers.get("range");
      if (rangeHeader) {
        const parts = rangeHeader.replace(/bytes=/, "").split("-");
        const start = parseInt(parts[0], 10);
        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

        if (isNaN(start) || start >= fileSize || (end && end >= fileSize)) {
          return new NextResponse(null, {
            status: 416,
            headers: {
              "Content-Range": `bytes */${fileSize}`,
            },
          });
        }

        const chunksize = end - start + 1;
        const fileHandle = await fs.open(filePath, "r");
        const buffer = Buffer.alloc(chunksize);
        await fileHandle.read(buffer, 0, chunksize, start);
        await fileHandle.close();

        return new NextResponse(buffer, {
          status: 206,
          headers: {
            "Content-Range": `bytes ${start}-${end}/${fileSize}`,
            "Accept-Ranges": "bytes",
            "Content-Length": String(chunksize),
            "Content-Type": mimeType,
          },
        });
      }

      // 常规完整文件下载或初次流式读取（默认必须为 attachment，防止浏览器或窗口直接作为网页/播放器跳转）
      const urlObj = new URL(_request.url);
      const isPreview = urlObj.searchParams.get("preview") === "1";
      const dispositionType = isPreview ? "inline" : "attachment";

      const data = await fs.readFile(filePath);
      return new NextResponse(data, {
        headers: {
          "Content-Type": mimeType,
          "Accept-Ranges": "bytes",
          "Content-Length": String(fileSize),
          "Content-Disposition": `${dispositionType}; filename="${encodeURIComponent(safeResultName)}"`,
        },
      });
    } catch {
      // 继续尝试下一个路径
    }
  }

  return NextResponse.json({ error: "File not found or expired" }, { status: 404 });
}
