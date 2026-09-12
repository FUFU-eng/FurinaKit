import { NextResponse } from "next/server";
import { getToolById, downloadsEnabled, heavyWorkerToolsEnabled } from "@furinakit/shared";
import { saveUploadStream, removeFileQuietly } from "@/lib/storage";
import { parseMultipart } from "@/lib/multipart";
import { verifyUploadSignature, needsSignatureCheck } from "@/lib/file-signature";

/** 校验文件头需要偷看的字节数：够覆盖所有 magic bytes 与 SVG/脚本的文本特征即可 */
const HEAD_PEEK_BYTES = 4096;

/**
 * 先从流里取出开头若干个字节做校验，再把「已取出的字节 + 剩余部分」拼成一条新流。
 *
 * 这样既能在写盘之前拿到文件头，又完全不破坏流式处理：
 * 偷看走的字节会原样补回去，最终落盘的内容与不校验时逐字节一致，内存占用也仍然只是一个 chunk。
 */
async function peekHead(
  source: AsyncIterable<Uint8Array>,
  count: number,
): Promise<{ head: Buffer; stream: AsyncIterable<Uint8Array> }> {
  const iterator = source[Symbol.asyncIterator]();
  const chunks: Buffer[] = [];
  let length = 0;
  let exhausted = false;

  while (length < count) {
    const next = await iterator.next();
    if (next.done) {
      exhausted = true;
      break;
    }
    const buf = Buffer.isBuffer(next.value) ? next.value : Buffer.from(next.value);
    chunks.push(buf);
    length += buf.length;
  }

  const head = Buffer.concat(chunks);
  const stream: AsyncIterable<Uint8Array> = {
    async *[Symbol.asyncIterator]() {
      // 先把偷看过的字节原样吐回去
      for (const chunk of chunks) yield chunk;
      if (exhausted) return;
      for (;;) {
        const next = await iterator.next();
        if (next.done) return;
        yield next.value;
      }
    },
  };

  return { head, stream };
}
import { SYNC_HANDLERS, type SyncInput } from "@/lib/tools/registry";
import { createJob, createLocalJob } from "@/lib/jobs";
import { runVideoDownloadJob } from "@/lib/video-downloader";
import { runMagnetDownloadJob } from "@/lib/magnet-downloader";
import { runImageUpscaleJob } from "@/lib/image-upscaler";
import { guardApiRequest } from "@/lib/api-guard";

export const runtime = "nodejs";
export const maxDuration = 60;

function sanitizeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

/** 给 Content-Disposition 的 filename 参数用的纯 ASCII 兜底名（中文名见 filename* 那一份） */
function asciiFilename(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "").replace(/["\\]/g, "").trim();
  return ascii || "result";
}

async function handleSyncTool(formData: FormData, toolId: string) {
  const handler = SYNC_HANDLERS[toolId];
  if (!handler) {
    return NextResponse.json({ error: "This tool runs in your browser." }, { status: 400 });
  }

  const files: Buffer[] = [];
  const filenames: string[] = [];
  const fields: Record<string, string> = {};

  try {
    for (const [key, value] of formData.entries()) {
      if (value instanceof File) {
        if (value.size === 0) continue;
        const buffer = Buffer.from(await value.arrayBuffer());
        // 与流式通道用同一套文件头校验，保证两条路口径一致（见 lib/file-signature.ts）。
        // 豁免工具（文件伪装类等）跳过；校验失败要和"处理失败"一样回 400 + 中文提示，而不是抛到外面变成 500。
        if (needsSignatureCheck(toolId)) {
          const verdict = verifyUploadSignature(buffer.subarray(0, HEAD_PEEK_BYTES), value.name);
          if (!verdict.ok) throw new Error(verdict.reason);
        }
        files.push(buffer);
        filenames.push(sanitizeName(value.name));
      } else {
        fields[key] = String(value);
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  const input: SyncInput = { files, filenames, fields };

  try {
    const result = await handler(input);
    const bytes = result.kind === "text" ? Buffer.from(result.text ?? "", "utf8") : result.buffer!;
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        "Content-Type": result.mimeType,
        // HTTP 响应头只允许 latin1，文件名里出现中文会让 Node 直接抛 ERR_INVALID_CHAR（变成 500）。
        // 所以按 RFC 5987 再给一个 UTF-8 编码的 filename*，同时保留一个 ASCII 化的 filename 兜底，
        // 这样中文文件名也能正常下载（与 /api/jobs/[id]/download 的做法一致）。
        "Content-Disposition": `attachment; filename="${asciiFilename(result.filename)}"; filename*=UTF-8''${encodeURIComponent(result.filename)}`,
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

async function handleAsyncToolStreamed(request: Request, toolId: string) {
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

  // 边收边写盘：文件段的正文直接从请求体流进 uploads 目录，内存里只有一个 chunk。
  // 空文件（0 字节）按老规矩丢弃：先落盘拿到真实字节数，是空的就删掉、不写进 payload。
  // 写盘前先偷看开头 4KB，按文件头判断"内容和扩展名有没有在骗人"（见 lib/file-signature.ts）。
  const writtenPaths: string[] = [];
  let parsed: Awaited<ReturnType<typeof parseMultipart>>;
  try {
    parsed = await parseMultipart(request, async (part) => {
      // 豁免工具（文件伪装类、给任意文件算哈希类）不做"表里不一"校验 —— 那正是它们的用途
      if (needsSignatureCheck(toolId)) {
        const { head, stream } = await peekHead(part.body, HEAD_PEEK_BYTES);
        const verdict = verifyUploadSignature(head, part.filename);
        if (!verdict.ok) throw new Error(verdict.reason);
        const saved = await saveUploadStream(toolId, part.filename, stream);
        writtenPaths.push(saved.path);
        if (saved.size === 0) await removeFileQuietly(saved.path);
        return saved;
      }

      const saved = await saveUploadStream(toolId, part.filename, part.body);
      writtenPaths.push(saved.path);
      if (saved.size === 0) await removeFileQuietly(saved.path);
      return saved;
    });
  } catch (error) {
    // 中途失败（网络中断、请求体被截断、磁盘写不进去……）：
    // 把本次请求已经写下去的文件清掉，不在 uploads 里留半套垃圾。
    // 用 removeFileQuietly：Windows 上句柄刚关的瞬间直接删会失败，它会重试。
    await Promise.all(writtenPaths.map((p) => removeFileQuietly(p)));
    const message = error instanceof Error ? error.message : "上传失败";
    return NextResponse.json({ error: `文件上传未完成：${message}` }, { status: 400 });
  }
  const { fields, files } = parsed;

  const payload: Record<string, unknown> = {};
  for (const input of tool.inputs) {
    if (input.type === "file") {
      // 支持多文件上传（如 PDF 合并、图片转 PDF）；不限制数量与大小
      const savedPaths = files
        .filter((file) => file.field === input.id && file.size > 0)
        .map((file) => file.path);
      if (savedPaths.length === 1) {
        payload[input.id] = savedPaths[0];
      } else if (savedPaths.length > 1) {
        payload[input.id] = savedPaths;
      }
    } else {
      const value = fields[input.id];
      if (value !== undefined && value !== "") payload[input.id] = value;
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
    // torrentPath 不是工具声明的输入项，而是前端在上传种子文件后直接塞进来的字段
    const torrentPath = fields.torrentPath;
    if (torrentPath) payload.torrentPath = torrentPath;
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
  const denied = guardApiRequest(request);
  if (denied) return denied;
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

  // 同步工具（在服务端算完直接返回结果）本来就需要把文件整份读进内存交给处理器，
  // 所以这里保持原来的 formData 读法不变。
  if (tool.mode === "sync") {
    const formData = await request.formData();
    return handleSyncTool(formData, toolId);
  }

  // 异步工具（交给后台 worker / 下载器）的文件只需要落到磁盘再传路径过去，
  // 全程用流式解析，内存占用与文件大小无关（原先 formData + arrayBuffer 会占两份）。
  return handleAsyncToolStreamed(request, toolId);
}
