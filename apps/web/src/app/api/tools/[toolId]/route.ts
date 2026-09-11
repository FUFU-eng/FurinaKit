import { NextResponse } from "next/server";
import { getToolById, downloadsEnabled, heavyWorkerToolsEnabled } from "@furinakit/shared";
import { saveUpload, getMaxFileSizeBytes } from "@/lib/storage";
import { SYNC_HANDLERS, type SyncInput } from "@/lib/tools/registry";
import { createJob, createLocalJob } from "@/lib/jobs";
import { runVideoDownloadJob } from "@/lib/video-downloader";
import { runMagnetDownloadJob } from "@/lib/magnet-downloader";
import { runImageUpscaleJob } from "@/lib/image-upscaler";

export const runtime = "nodejs";
export const maxDuration = 60;

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function handleSyncTool(formData: FormData, toolId: string) {
  const handler = SYNC_HANDLERS[toolId];
  if (!handler) {
    return NextResponse.json({ error: "This tool runs in your browser." }, { status: 400 });
  }

  const maxSize = getMaxFileSizeBytes();
  const files: Buffer[] = [];
  const filenames: string[] = [];
  const fields: Record<string, string> = {};

  for (const [key, value] of formData.entries()) {
    if (value instanceof File) {
      if (value.size === 0) continue;
      if (value.size > maxSize) {
        return NextResponse.json(
          { error: `"${value.name}" is too large (max ${Math.round(maxSize / 1024 / 1024)} MB).` },
          { status: 413 },
        );
      }
      files.push(Buffer.from(await value.arrayBuffer()));
      filenames.push(sanitizeName(value.name));
    } else {
      fields[key] = String(value);
    }
  }

  const input: SyncInput = { files, filenames, fields };

  try {
    const result = await handler(input);
    const bytes = result.kind === "text" ? Buffer.from(result.text ?? "", "utf8") : result.buffer!;
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": result.mimeType,
        "Content-Disposition": `attachment; filename="${result.filename}"`,
        "Content-Length": String(bytes.length),
        "X-Result-Filename": encodeURIComponent(result.filename),
        "X-Result-Kind": result.kind,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Processing failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

async function handleAsyncTool(formData: FormData, toolId: string) {
  const tool = getToolById(toolId);
  if (!tool || tool.mode !== "async" || tool.comingSoon) {
    return NextResponse.json({ error: "Tool not found or unavailable" }, { status: 404 });
  }
  if (tool.selfHostOnly && !downloadsEnabled()) {
    return NextResponse.json(
      { error: "Downloaders require the self-hosted worker and are disabled on this deployment." },
      { status: 503 },
    );
  }
  if (tool.heavyWorkerOnly && !heavyWorkerToolsEnabled()) {
    return NextResponse.json(
      { error: "This tool is disabled on this deployment (requires more memory)." },
      { status: 503 },
    );
  }

  const payload: Record<string, unknown> = {};
  for (const input of tool.inputs) {
    if (input.type === "file") {
      // 支持多文件上传（如 PDF 合并、图片转 PDF）
      const uploaded = formData.getAll(input.id);
      const validFiles = uploaded.filter((f): f is File => f instanceof File && f.size > 0);
      if (validFiles.length === 1) {
        payload[input.id] = await saveUpload(validFiles[0], toolId);
      } else if (validFiles.length > 1) {
        payload[input.id] = await Promise.all(validFiles.map((f) => saveUpload(f, toolId)));
      }
    } else {
      const value = formData.get(input.id);
      if (value !== null && value !== "") payload[input.id] = value;
    }
  }

  if (toolId === "bg-remove" && !payload.file) {
    return NextResponse.json({ error: "Image file is required" }, { status: 400 });
  }
  const VIDEO_TOOL_IDS = ["video-download", "bilibili-download", "twitter-download"];
  if ((VIDEO_TOOL_IDS.includes(toolId) || toolId === "spotify-download") && !payload.url) {
    return NextResponse.json({ error: "A URL is required" }, { status: 400 });
  }

  // All video/social downloaders run directly in Node.js via local job & bundled yt-dlp/ffmpeg
  if (VIDEO_TOOL_IDS.includes(toolId)) {
    try {
      const job = await createLocalJob(toolId, payload);
      // Run video download asynchronously in background
      runVideoDownloadJob(job.id, payload).catch((err) => {
        console.error(`[video-download] Background job ${job.id} failed:`, err);
      });
      return NextResponse.json({ job });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create video download job";
      return NextResponse.json({ error: message }, { status: 429 });
    }
  }

  // Magnet / BitTorrent 下载器通过内置 aria2c 引擎在后台异步运行
  if (toolId === "magnet-download") {
    const torrentPath = formData.get("torrentPath");
    if (torrentPath) payload.torrentPath = String(torrentPath);
    if (!payload.url && !payload.torrentPath) {
      return NextResponse.json({ error: "请输入磁力链接或上传种子文件" }, { status: 400 });
    }
    try {
      const job = await createLocalJob(toolId, payload);
      runMagnetDownloadJob(job.id, payload).catch((err) => {
        console.error(`[magnet-download] Background job ${job.id} failed:`, err);
      });
      return NextResponse.json({ job });
    } catch (error) {
      const message = error instanceof Error ? error.message : "创建磁力下载任务失败";
      return NextResponse.json({ error: message }, { status: 429 });
    }
  }

  // 图片高清强化通过内置 Real-ESRGAN Vulkan 引擎在后台异步运行
  if (toolId === "image-upscale") {
    if (!payload.file) {
      return NextResponse.json({ error: "请上传需要强化的图片" }, { status: 400 });
    }
    try {
      const job = await createLocalJob(toolId, payload);
      runImageUpscaleJob(job.id, payload).catch((err) => {
        console.error(`[image-upscale] Background job ${job.id} failed:`, err);
      });
      return NextResponse.json({ job });
    } catch (error) {
      const message = error instanceof Error ? error.message : "创建图片超分任务失败";
      return NextResponse.json({ error: message }, { status: 429 });
    }
  }

  try {
    const job = await createJob(toolId, payload);
    return NextResponse.json({ job });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create job";
    return NextResponse.json({ error: message }, { status: 429 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ toolId: string }> }) {
  const { toolId } = await context.params;
  const tool = getToolById(toolId);
  if (!tool || tool.comingSoon) {
    return NextResponse.json({ error: "Tool not found" }, { status: 404 });
  }
  if (tool.selfHostOnly && !downloadsEnabled()) {
    return NextResponse.json({ error: "Tool unavailable on this deployment" }, { status: 503 });
  }
  if (tool.heavyWorkerOnly && !heavyWorkerToolsEnabled()) {
    return NextResponse.json({ error: "Tool unavailable on this deployment" }, { status: 503 });
  }

  const formData = await request.formData();
  return tool.mode === "sync" ? handleSyncTool(formData, toolId) : handleAsyncTool(formData, toolId);
}
