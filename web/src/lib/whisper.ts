import fs from "fs/promises";
import { createWriteStream, existsSync, statSync } from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import { updateJob } from "./jobs";
import { ensureStorageDir } from "./storage";

/**
 * 本地语音转文字（whisper.cpp）
 *
 * 设计要点：
 *  · 程序本体（10MB，纯 CPU 版）随安装包分发，用户不用下载；
 *  · 语音模型不预装，第一次使用时在界面上选一个下载 —— 模型体积 74MB ~ 3GB，
 *    打包进去会让安装包白白变大几百 MB，而多数用户只用得上其中一个；
 *  · 转写全程在本机完成，音频不上传任何服务器。
 *
 * 模型下载源做了多级镜像：Hugging Face 在国内直连基本下不动，
 * 所以按「国内镜像 → 官方 → GitHub 加速」的顺序自动重试。
 */

export interface WhisperModelInfo {
  id: string;
  label: string;
  /** 字节数（来自官方仓库实测大小） */
  size: number;
  note: string;
  recommended?: boolean;
}

/** 模型目录：打包版由主进程给出（用户数据目录下），开发环境放在 apps/web/whisper-models */
export function whisperModelsDir(): string {
  const fromEnv = process.env.FURINAKIT_WHISPER_MODELS_DIR;
  if (fromEnv) return fromEnv;
  return path.join(process.cwd(), "whisper-models");
}

/** whisper.cpp 程序所在目录 */
function whisperBinDir(): string {
  const fromEnv = process.env.FURINAKIT_WHISPER_DIR;
  if (fromEnv) return fromEnv;
  return path.join(process.cwd(), "whisper");
}

/** whisper-cli 可执行文件路径；找不到返回 null */
export function findWhisperCli(): string | null {
  const dir = whisperBinDir();
  const candidates = [path.join(dir, "whisper-cli.exe"), path.join(dir, "main.exe"), path.join(dir, "whisper-cli")];
  for (const c of candidates) if (existsSync(c)) return c;
  return null;
}

/** 模型清单（体积取自 ggerganov/whisper.cpp 官方仓库实测） */
export const WHISPER_MODELS: WhisperModelInfo[] = [
  {
    id: "tiny",
    label: "极速版",
    size: 77_691_713,
    note: "体积最小、速度最快，识别准确率有限，适合快速预览",
  },
  {
    id: "base",
    label: "轻量版",
    size: 147_951_465,
    note: "速度较快，适合口齿清晰、环境安静的录音",
  },
  {
    id: "small-q5_1",
    label: "标准版（省空间）",
    size: 190_085_487,
    note: "压缩后的标准模型，准确率与体积兼顾，适合日常使用",
  },
  {
    id: "small",
    label: "标准版",
    size: 487_601_967,
    note: "中文识别准确率良好，速度与体积较为均衡",
  },
  {
    id: "large-v3-turbo-q5_0",
    label: "高精度版（推荐）",
    size: 574_041_195,
    note: "准确率接近最高精度模型，速度提升明显，体积约为其五分之一",
    recommended: true,
  },
  {
    id: "medium",
    label: "专业版",
    size: 1_533_774_781,
    note: "准确率更高，处理耗时与占用相应增加",
  },
  {
    id: "large-v3",
    label: "最高精度版",
    size: 3_094_623_691,
    note: "识别准确率最高，模型 3GB，处理耗时较长",
  },
];

export function modelFileName(id: string): string {
  return `ggml-${id}.bin`;
}

export function modelPath(id: string): string {
  return path.join(whisperModelsDir(), modelFileName(id));
}

export function isModelDownloaded(id: string): boolean {
  try {
    const p = modelPath(id);
    if (!existsSync(p)) return false;
    const st = statSync(p);
    const info = WHISPER_MODELS.find((m) => m.id === id);
    // 大于 90% 官方体积即视为完整（避免把半截文件当成已下载）
    return info ? st.size > info.size * 0.9 : st.size > 1024 * 1024;
  } catch {
    return false;
  }
}

/* ────────────────────────── 模型下载 ────────────────────────── */

type DownloadState = {
  modelId: string;
  received: number;
  total: number;
  status: "downloading" | "done" | "error";
  error?: string;
  mirror?: string;
};

const downloads = new Map<string, DownloadState>();

export function getDownloadState(modelId: string): DownloadState | null {
  return downloads.get(modelId) ?? null;
}

/** 各级下载源（{file} 会被替换成模型文件名） */
const MIRRORS: Array<{ name: string; url: (file: string) => string }> = [
  { name: "国内镜像", url: (f) => `https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/${f}` },
  { name: "官方源", url: (f) => `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${f}` },
  { name: "加速源", url: (f) => `https://ghproxy.net/https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${f}` },
];

async function downloadFrom(url: string, dest: string, modelId: string): Promise<void> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
  const total = Number(res.headers.get("content-length") || 0);
  const state = downloads.get(modelId)!;
  state.total = total || state.total;

  const ws = createWriteStream(dest);
  const reader = res.body.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!ws.write(Buffer.from(value))) {
        await new Promise<void>((r) => ws.once("drain", () => r()));
      }
      state.received += value.byteLength;
    }
  } finally {
    await new Promise((r) => ws.end(r));
  }
}

/** 开始下载模型。同一模型重复调用会直接返回当前状态。 */
export function startModelDownload(modelId: string): DownloadState {
  const existing = downloads.get(modelId);
  if (existing && existing.status === "downloading") return existing;

  const info = WHISPER_MODELS.find((m) => m.id === modelId);
  if (!info) throw new Error("模型不存在");

  const state: DownloadState = { modelId, received: 0, total: info.size, status: "downloading" };
  downloads.set(modelId, state);

  (async () => {
    const dir = whisperModelsDir();
    await fs.mkdir(dir, { recursive: true });
    const finalPath = modelPath(modelId);
    const partPath = `${finalPath}.part`;

    let lastError = "";
    for (const mirror of MIRRORS) {
      try {
        state.received = 0;
        state.mirror = mirror.name;
        await downloadFrom(mirror.url(modelFileName(modelId)), partPath, modelId);
        const size = (await fs.stat(partPath)).size;
        if (size < info.size * 0.9) throw new Error(`文件不完整（${(size / 1048576).toFixed(0)}MB）`);
        await fs.rm(finalPath, { force: true });
        await fs.rename(partPath, finalPath);
        state.status = "done";
        state.received = size;
        console.log(`[whisper] 模型 ${modelId} 下载完成（来源：${mirror.name}）`);
        return;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        console.error(`[whisper] 从「${mirror.name}」下载失败：${lastError}`);
        await fs.rm(partPath, { force: true }).catch(() => {});
      }
    }
    state.status = "error";
    state.error = `模型下载失败（${lastError}）。请检查网络连接后重试。`;
    console.error(`[whisper] 模型 ${modelId} 下载失败：${state.error}`);
  })();

  return state;
}

/* ────────────────────────── 转写 ────────────────────────── */

export interface TranscribeOptions {
  inputPath: string;
  modelId: string;
  /** 语言代码，auto 表示自动识别 */
  language?: string;
  /** 输出格式：txt / srt */
  wantSrt?: boolean;
  onProgress?: (percent: number, message: string) => Promise<void> | void;
}

/**
 * 把音频/视频里的语音转成文字，返回 (文本, 文件名清单)。
 * 流程：先用 ffmpeg 把任意输入转成 16kHz 单声道 WAV（whisper 只认这个采样率），
 *       再调 whisper-cli 识别，最后把结果写成 txt（可选 srt）。
 */
export async function transcribe(opts: TranscribeOptions): Promise<{ text: string; files: string[] }> {
  const cli = findWhisperCli();
  if (!cli) throw new Error("未找到内置的语音识别程序，请重新安装软件");

  if (!isModelDownloaded(opts.modelId)) {
    throw new Error("所选语音模型尚未下载，请先在模型列表中完成下载");
  }

  const resultsDir = path.join(await ensureStorageDir(), "results");
  const stamp = Date.now();
  const wavPath = path.join(resultsDir, `whisper-${stamp}.wav`);

  // 1) 转成 whisper 要的格式
  await opts.onProgress?.(2, "正在提取音频…");
  const ffmpeg = ffmpegExe();
  await runProcess(ffmpeg, ["-y", "-i", opts.inputPath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", wavPath]);

  // 2) 识别
  const baseArgs = [
    "-m", modelPath(opts.modelId),
    "-f", wavPath,
    "-t", String(Math.max(2, Math.min(8, os.cpus().length - 1))),
    "-pp", // 打印进度
    "-np", // 不打印无关信息，便于解析
  ];
  if (opts.language && opts.language !== "auto") baseArgs.push("-l", opts.language);
  else baseArgs.push("-l", "auto");

  const outBase = path.join(resultsDir, `whisper-${stamp}`);
  const txtPath = `${outBase}.txt`;
  const srtPath = `${outBase}.srt`;

  await opts.onProgress?.(5, "正在识别语音…");
  const { stdout, stderr } = await runProcess(cli, [...baseArgs, "-otxt", "-of", outBase, ...(opts.wantSrt ? ["-osrt"] : [])], {
    onStderr: (line) => {
      // whisper-cli 的进度形如：whisper_print_progress_callback: progress = 42%
      const m = line.match(/progress\s*=\s*(\d+)%/);
      if (m) {
        const pct = 5 + Math.round((Number(m[1]) / 100) * 93);
        void opts.onProgress?.(Math.min(pct, 98), `正在识别语音… ${m[1]}%`);
      }
    },
  });

  await fs.rm(wavPath, { force: true }).catch(() => {});

  let text = "";
  try {
    text = (await fs.readFile(txtPath, "utf8")).trim();
  } catch {
    // 个别情况下 -otxt 没落盘，从 stdout 里兜底取
    text = stdout
      .split(/\r?\n/)
      .filter((l) => l.trim() && !l.startsWith("whisper_") && !l.includes("load_backend"))
      .join("\n")
      .trim();
  }
  if (!text) {
    const tail = stderr.split(/\r?\n/).filter(Boolean).slice(-3).join(" ");
    throw new Error(tail || "未识别到有效内容，请确认文件中包含人声");
  }

  const files: string[] = [];
  if (existsSync(txtPath)) files.push(path.basename(txtPath));
  if (opts.wantSrt && existsSync(srtPath)) files.push(path.basename(srtPath));

  return { text, files };
}

function ffmpegExe(): string {
  const fromEnv = process.env.FURINAKIT_FFMPEG_PATH;
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const local = path.join(process.cwd(), "ffmpeg.exe");
  if (existsSync(local)) return local;
  return "ffmpeg";
}

function runProcess(
  cmd: string,
  args: string[],
  opts: { onStderr?: (line: string) => void } = {},
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    let stderrBuf = "";
    proc.stdout.on("data", (c: Buffer) => (stdout += c.toString("utf8")));
    proc.stderr.on("data", (c: Buffer) => {
      const text = c.toString("utf8");
      stderr += text;
      if (opts.onStderr) {
        stderrBuf += text;
        const lines = stderrBuf.split(/\r?\n/);
        stderrBuf = lines.pop() ?? "";
        for (const l of lines) if (l.trim()) opts.onStderr(l);
      }
    });
    proc.on("error", (err) => reject(new Error(`无法启动语音识别程序：${err.message}`)));
    proc.on("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr.split(/\r?\n/).filter(Boolean).slice(-2).join(" ") || "语音识别未能完成，请确认这个文件可以正常播放"));
    });
  });
}

/* ────────────────────────── 任务入口 ────────────────────────── */

/** 把转写接到统一的任务体系里，前端照常轮询 /api/jobs/<id> 拿进度 */
export async function runAudioTranscribeJob(jobId: string, payload: Record<string, unknown>): Promise<void> {
  const inputPath = String(payload.file || "");
  const modelId = String(payload.model || "large-v3-turbo-q5_0");
  const language = String(payload.language || "auto");
  const format = String(payload.output || "txt");

  try {
    if (!inputPath) throw new Error("请先选择需要转写的音频或视频文件");
    await updateJob(jobId, { status: "processing", progress: 1, message: "正在准备…" });

    const { text, files } = await transcribe({
      inputPath,
      modelId,
      language,
      wantSrt: format === "srt" || format === "both",
      onProgress: async (percent, message) => {
        await updateJob(jobId, { status: "processing", progress: percent, message });
      },
    });

    await updateJob(jobId, {
      status: "completed",
      progress: 100,
      message: `识别完成，共 ${text.length} 字`,
      // 结果以文件形式落在 results 目录，正文由 /api/whisper/result 读回来展示
      resultFilename: files[0],
      resultMimeType: "text/plain; charset=utf-8",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[whisper] 转写失败：", message);
    await updateJob(jobId, { status: "failed", error: message, message: "识别失败" });
  }
}
