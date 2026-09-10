import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { spawn } from "child_process";
import { updateJob } from "./jobs";
import { ensureStorageDir } from "./storage";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function findYtDlp(): string {
  if (process.env.FURINAKIT_YTDLP_PATH && existsSync(process.env.FURINAKIT_YTDLP_PATH)) {
    return process.env.FURINAKIT_YTDLP_PATH;
  }
  const candidates = [
    path.join(process.cwd(), "resources", "yt-dlp.exe"),
    path.join(process.cwd(), "..", "yt-dlp.exe"),
    path.join(process.cwd(), "..", "..", "resources", "yt-dlp.exe"),
    path.join(process.cwd(), "dist-installer", "win-unpacked", "resources", "yt-dlp.exe"),
    path.join(process.cwd(), "yt-dlp.exe"),
    "yt-dlp.exe",
    "yt-dlp",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return "yt-dlp";
}

function findFfmpegDir(): string | null {
  if (process.env.FURINAKIT_FFMPEG_PATH && existsSync(process.env.FURINAKIT_FFMPEG_PATH)) {
    return path.dirname(process.env.FURINAKIT_FFMPEG_PATH);
  }
  const candidates = [
    path.join(process.cwd(), "resources", "ffmpeg.exe"),
    path.join(process.cwd(), "..", "ffmpeg.exe"),
    path.join(process.cwd(), "..", "..", "resources", "ffmpeg.exe"),
    path.join(process.cwd(), "dist-installer", "win-unpacked", "resources", "ffmpeg.exe"),
    path.join(process.cwd(), "ffmpeg.exe"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return path.dirname(c);
  }
  return null;
}

function localizeError(output: string): string {
  const text = output.toLowerCase();
  if (text.includes("no video could be found in this tweet") || text.includes("no media found")) {
    return "该推文中未找到视频或动图（可能已被删除或设为私密）";
  }
  if (text.includes("from a protected account") || text.includes("protected")) {
    return "该推文来自私密/上锁账号，无法直接提取";
  }
  if (text.includes("private video") || text.includes("sign in")) {
    return "该视频为私密内容或需要登录账号后才能查看";
  }
  if (text.includes("video unavailable") || text.includes("removed")) {
    return "该视频已失效或已被作者删除";
  }
  if (text.includes("is not available in your country") || text.includes("geo-restricted")) {
    return "该视频受到地区版权限制，请尝试切换代理节点";
  }
  if (text.includes("unsupported url")) {
    return "不支持该链接格式，请确认输入正确的视频或推文链接";
  }
  if (text.includes("timeout") || text.includes("timed out")) {
    return "下载请求超时，请检查网络连接或系统代理设置";
  }
  if (text.includes("403") || text.includes("forbidden")) {
    return "访问受限 (403 Forbidden)，内容可能已被平台风控保护";
  }
  if (text.includes("412")) {
    return "视频平台安全验证拦截，请稍后重试";
  }
  const lines = output.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const lastLine = lines[lines.length - 1] || "下载失败";
  return lastLine.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?/i, "").slice(0, 200);
}

export async function runVideoDownloadJob(
  jobId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const rawUrl = String(payload.url || "").trim();
  const format = String(payload.format || "mp4").toLowerCase();
  const quality = String(payload.quality || "best").toLowerCase();

  // 从分享文本中提取真正的 URL
  const match = rawUrl.match(/https?:\/\/[^\s]+/i);
  const targetUrl = match ? match[0].replace(/[.,;:!?）)】」\]]+$/g, "") : rawUrl;

  const storagePath = await ensureStorageDir();
  const resultsDir = path.join(storagePath, "results");

  await updateJob(jobId, {
    status: "processing",
    progress: 15,
    message: "正在连接并解析媒体流...",
  });

  const ytdlpExe = findYtDlp();
  const ffmpegDir = findFfmpegDir();

  const outputTemplate = path.join(resultsDir, "%(title).150s-%(id)s.%(ext)s");

  const args: string[] = [
    targetUrl,
    "-o",
    outputTemplate,
    "--no-playlist",
    "--restrict-filenames",
    "--newline",
    "--no-color",
    "--user-agent",
    DEFAULT_USER_AGENT,
    "--print",
    "after_move:filepath",
  ];

  if (ffmpegDir) {
    args.push("--ffmpeg-location", ffmpegDir);
  }

  if (format === "thumbnail") {
    args.push("--write-thumbnail", "--skip-download");
  } else if (format === "mp3") {
    const audioQ = quality === "best" ? "0" : `${quality}K`;
    args.push("-x", "--audio-format", "mp3", "--audio-quality", audioQ);
  } else {
    // MP4 视频
    const heights: Record<string, number> = { "1080": 1080, "720": 720, "480": 480 };
    const h = heights[quality];
    if (h) {
      args.push("-f", `bestvideo[height<=${h}]+bestaudio/best[height<=${h}]/best`);
    } else {
      args.push("-f", "bestvideo+bestaudio/best");
    }
    args.push("--merge-output-format", "mp4");
  }

  console.log(`[video-downloader] 启动下载: ${ytdlpExe} ${args.join(" ")}`);

  let savedFilePath: string | null = null;
  const tailLog: string[] = [];
  const percentRegex = /(\d{1,3}(?:\.\d+)?)%/;

  const proc = spawn(ytdlpExe, args, {
    windowsHide: true,
    env: { ...process.env },
  });

  let lastReportedPct = -1;

  proc.stdout?.on("data", (chunk: Buffer) => {
    const lines = chunk.toString("utf-8").split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      tailLog.push(trimmed);
      if (tailLog.length > 30) tailLog.shift();

      if (trimmed.includes("[download]") && trimmed.includes("%")) {
        const m = percentRegex.exec(trimmed);
        if (m) {
          const rawPct = parseFloat(m[1]);
          const currentPct = Math.min(95, Math.max(15, 15 + Math.floor(rawPct * 0.8)));
          if (currentPct !== lastReportedPct) {
            lastReportedPct = currentPct;
            updateJob(jobId, {
              progress: currentPct,
              message: `下载中... ${rawPct.toFixed(1)}%`,
            }).catch(() => {});
          }
        }
      } else if (!trimmed.startsWith("[") && !trimmed.startsWith("WARNING")) {
        if (existsSync(trimmed)) {
          savedFilePath = trimmed;
        }
      }
    }
  });

  proc.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf-8");
    tailLog.push(text);
    if (tailLog.length > 30) tailLog.shift();
  });

  proc.on("error", async (err) => {
    console.error(`[video-downloader] 进程执行出错:`, err);
    await updateJob(jobId, {
      status: "failed",
      error: `下载程序启动失败: ${err.message}`,
      message: "下载失败",
    });
  });

  proc.on("exit", async (code) => {
    console.log(`[video-downloader] 任务 ${jobId} 下载完成，代码: ${code}`);

    if (code === 0) {
      // 成功完成，寻找生成的文件
      let finalFile = savedFilePath;
      if (!finalFile || !existsSync(finalFile)) {
        // 在 results 目录中按最新修改时间匹配文件
        try {
          const files = await fs.readdir(resultsDir);
          let latestTime = 0;
          for (const f of files) {
            const p = path.join(resultsDir, f);
            const st = await fs.stat(p);
            if (st.isFile() && st.mtimeMs > latestTime) {
              latestTime = st.mtimeMs;
              finalFile = p;
            }
          }
        } catch {}
      }

      if (finalFile && existsSync(finalFile)) {
        const filename = path.basename(finalFile);
        const mimeType = filename.toLowerCase().endsWith(".mp3")
          ? "audio/mpeg"
          : "video/mp4";

        await updateJob(jobId, {
          status: "completed",
          progress: 100,
          message: "下载完成！",
          resultFilename: filename,
          resultMimeType: mimeType,
        });
        console.log(`[video-downloader] 任务成功完成: ${filename}`);
      } else {
        await updateJob(jobId, {
          status: "failed",
          error: "下载完成但未找到生成的目标媒体文件",
          message: "下载失败",
        });
      }
    } else {
      const fullErrorText = tailLog.join("\n");
      const friendly = localizeError(fullErrorText);
      await updateJob(jobId, {
        status: "failed",
        error: friendly,
        message: "下载失败",
      });
    }
  });
}
