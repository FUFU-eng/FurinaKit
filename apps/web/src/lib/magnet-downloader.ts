import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { spawn, type ChildProcess } from "child_process";
import { updateJob } from "./jobs";
import { getStoragePath } from "./storage";
import { getCustomOutputDir } from "./settings";

/**
 * 经过精选的高可用公共 Tracker 列表（定期同步各大开源 Tracker 项目）
 * 能显著提升国内与海外磁力链接的做种节点发现速度
 */
export const PUBLIC_TRACKERS: string[] = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://opentracker.i2p.rocks:6969/announce",
  "udp://open.tracker.ink:6969/announce",
  "udp://tracker.openbittorrent.com:6969/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://open.stealth.si:80/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://explodie.org:6969/announce",
  "udp://tracker.dler.org:6969/announce",
  "udp://tracker.dler.com:6969/announce",
  "udp://p4p.arenabg.com:1337/announce",
  "udp://open.demonii.com:1337/announce",
  "udp://tracker.tiny-vps.com:6969/announce",
  "udp://bt1.archive.org:6969/announce",
  "udp://bt2.archive.org:6969/announce",
  "udp://opentor.org:2710/announce",
  "udp://tracker.moeking.me:6969/announce",
  "udp://tracker.bittor.pw:1337/announce",
  "udp://tracker.dump.cl:6969/announce",
  "udp://evan.im:6969/announce",
  "udp://tracker.004430.xyz:1337/announce",
  "udp://tracker.0x7c0.com:6969/announce",
  "udp://tracker.nyaa.net:6969/announce",
  "udp://tracker.cn.nyaa.net:6969/announce",
  "udp://tracker.therarbg.to:6969/announce",
  "udp://tracker.qu.ax:6969/announce",
  "udp://tracker.skyts.net:6969/announce",
  "udp://tracker.teambelgium.net:6969/announce",
  "udp://tracker-udp.gbitt.info:80/announce",
  "udp://tr4ck3r.duckdns.org:6969/announce",
  "udp://t.overflow.biz:6969/announce",
  "https://tracker.foreverpirates.co:443/announce",
  "https://tracker.kuroy.me:443/announce",
  "https://tracker.nekomi.cn:443/announce",
  "https://tracker.onetracker.net:443/announce",
  "https://tracker.zhuqiy.com:443/announce",
  "https://1337.abcvg.info:443/announce",
  "https://tr.abiir.top:443/announce",
  "https://tr.burnabyhighstar.com:443/announce",
  "http://tracker.renfei.net:8080/announce",
  "http://tracker.waaa.moe:6969/announce",
  "http://nyaa.tracker.wf:7777/announce",
  "http://open.acgnxtracker.com:80/announce",
];

/** 查找系统或打包内的 aria2c 可执行程序 */
export function findAria2(): string {
  if (process.env.FURINAKIT_ARIA2_PATH && existsSync(process.env.FURINAKIT_ARIA2_PATH)) {
    return process.env.FURINAKIT_ARIA2_PATH;
  }
  const candidates = [
    path.join(process.cwd(), "resources", "aria2c.exe"),
    path.join(process.cwd(), "..", "resources", "aria2c.exe"),
    path.join(process.cwd(), "..", "..", "resources", "aria2c.exe"),
    path.join(process.cwd(), "dist-installer", "win-unpacked", "resources", "aria2c.exe"),
    path.join(process.cwd(), "aria2c.exe"),
    "aria2c.exe",
    "aria2c",
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return "aria2c";
}

/** 活动任务的进程映射（支持主动取消与优雅关闭） */
const activeAriaProcesses = new Map<string, { proc: ChildProcess; cancelled: boolean }>();

/** 取消正在运行的磁力下载任务 */
export function cancelMagnetJob(jobId: string): boolean {
  const item = activeAriaProcesses.get(jobId);
  if (!item) return false;
  item.cancelled = true;
  try {
    if (process.platform === "win32" && item.proc.pid) {
      // 在 Windows 上通过 taskkill 递归终止进程树
      spawn("taskkill", ["/pid", String(item.proc.pid), "/T", "/F"], { windowsHide: true });
    } else {
      item.proc.kill("SIGTERM");
    }
  } catch (err) {
    console.warn(`[magnet-downloader] 取消任务 ${jobId} 进程出错:`, err);
  }
  return true;
}

/** 获取保存输出目录（用户自定义设置优先） */
function resolveOutputDir(): string {
  const customOutputDir = getCustomOutputDir();
  if (customOutputDir) {
    return path.isAbsolute(customOutputDir) ? customOutputDir : path.resolve(process.cwd(), customOutputDir);
  }
  const defaultOutputDir = process.env.FURINAKIT_DEFAULT_OUTPUT_DIR;
  if (defaultOutputDir) {
    return path.isAbsolute(defaultOutputDir) ? defaultOutputDir : path.resolve(process.cwd(), defaultOutputDir);
  }
  return path.resolve(getStoragePath(), "results");
}

function guessMimeType(filename: string, isDirectory: boolean): string {
  if (isDirectory) return "application/x-directory";
  const ext = path.extname(filename).toLowerCase();
  const map: Record<string, string> = {
    ".mp4": "video/mp4",
    ".mkv": "video/x-matroska",
    ".avi": "video/x-msvideo",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".flv": "video/x-flv",
    ".mp3": "audio/mpeg",
    ".flac": "audio/flac",
    ".wav": "audio/wav",
    ".zip": "application/zip",
    ".rar": "application/x-rar-compressed",
    ".7z": "application/x-7z-compressed",
    ".iso": "application/x-iso9660-image",
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".png": "image/png",
  };
  return map[ext] || "application/octet-stream";
}

/**
 * 运行磁力/种子下载后台任务
 */
export async function runMagnetDownloadJob(
  jobId: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const rawUrl = String(payload.url || "").trim();
  const torrentFilePath = payload.torrentPath ? String(payload.torrentPath).trim() : "";

  let targetInput = "";
  if (torrentFilePath && existsSync(torrentFilePath)) {
    targetInput = torrentFilePath;
  } else {
    // 从输入文本中提取磁力链接
    const magnetMatch = rawUrl.match(/magnet:\?[^\s"'<>]+/i);
    targetInput = magnetMatch ? magnetMatch[0] : rawUrl;
  }

  if (!targetInput) {
    await updateJob(jobId, {
      status: "failed",
      error: "未找到有效的磁力链接或种子文件",
      message: "下载失败",
    });
    return;
  }

  const aria2Exe = findAria2();
  const resultsDir = resolveOutputDir();
  await fs.mkdir(resultsDir, { recursive: true });

  await updateJob(jobId, {
    status: "processing",
    progress: 0,
    message: "正在启动下载引擎并连接 Tracker 节点...",
  });

  // 组装 aria2 启动参数（针对国内网络与反吸血限制深度调优）
  const args: string[] = [
    "--enable-dht=true",
    "--enable-dht6=true",
    "--dht-listen-port=6881-6999",
    "--listen-port=6881-6999",
    "--enable-peer-exchange=true",
    "--bt-enable-lpd=true",
    "--follow-torrent=mem",
    "--max-connection-per-server=16",
    "--split=16",
    "--min-split-size=1M",
    "--seed-time=0", // 下载完成后立即退出做种，交给用户
    "--summary-interval=1",
    "--file-allocation=none", // 快速启动，避免大文件预分配造成卡顿
    "--bt-save-metadata=true", // 自动将磁力链接转存为 .torrent 种子文件（方便网盘离线/备份）
    "--bt-max-peers=256",
    "--bt-request-peer-speed-limit=50M",
    "--peer-id-prefix=-TR3000-", // 伪装为 Transmission 3.00，防止被 BT 节点反吸血规则针对
    "--user-agent=Transmission/3.00",
    "--peer-agent=Transmission/3.00",
    "--bt-tracker-connect-timeout=8",
    "--bt-tracker-timeout=15",
    `--bt-tracker=${PUBLIC_TRACKERS.join(",")}`,
    `--dir=${resultsDir}`,
    targetInput,
  ];

  console.log(`[magnet-downloader] 启动任务 ${jobId}: ${aria2Exe} (dir: ${resultsDir})`);

  let lastUpdateTime = 0;
  let discoveredSavedPath: string | null = null;
  const tailLog: string[] = [];

  const proc = spawn(aria2Exe, args, {
    windowsHide: true,
    env: { ...process.env },
  });

  const stateObj = { proc, cancelled: false };
  activeAriaProcesses.set(jobId, stateObj);

  // 解析进度与下载状态
  proc.stdout?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf-8");
    const lines = text.split(/\r?\n/);

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      tailLog.push(trimmed);
      if (tailLog.length > 50) tailLog.shift();

      // 检测下载成功通知：[NOTICE] Download complete: /path/to/file
      const completeMatch = trimmed.match(/Download complete:\s*(.+)/i);
      if (completeMatch) {
        const found = path.normalize(completeMatch[1].trim());
        if (existsSync(found) && !found.includes("[METADATA]")) {
          discoveredSavedPath = found;
        }
      }

      // 检测 Download Results 结果表（多文件时形如：425740|OK  |   2.5MiB/s|C://path/NACT-077/NACT-077.mp4 (2more)）
      const okMatch = trimmed.match(/\|\s*OK\s*\|\s*[^|]*\|\s*(.+)/i);
      if (okMatch) {
        let p = okMatch[1].replace(/\s*\(\d+more\)/i, "").trim();
        p = path.normalize(p);
        if (existsSync(p)) {
          discoveredSavedPath = p;
        } else if (existsSync(path.dirname(p))) {
          discoveredSavedPath = path.dirname(p);
        }
      }

      // 匹配行如：[#b584d5 45MiB/1.2GiB(3%) CN:15 SD:6 DL:4.2MiB UL:32KiB ETA:4m45s]
      // 或元数据检索阶段：[#b584d5 0B/0B CN:3] 或 [#b584d5 111KiB/111KiB(100%)]
      if (trimmed.startsWith("[#") && trimmed.includes("]")) {
        const isMetadataPhase = trimmed.includes("METADATA") || tailLog.some((l) => l.includes("[METADATA]"));
        const pctMatch = trimmed.match(/\((\d{1,3})%\)/);
        const dlMatch = trimmed.match(/DL:([^\s\]]+)/);
        const cnMatch = trimmed.match(/CN:(\d+)/);
        const sdMatch = trimmed.match(/SD:(\d+)/);
        const etaMatch = trimmed.match(/ETA:([^\s\]]+)/);
        const sizeMatch = trimmed.match(/([0-9.]+[KMGT]?i?B)\/([0-9.]+[KMGT]?i?B)/);

        const now = Date.now();
        // 控制更新频率，至少间隔 700ms 或进度变化
        if (now - lastUpdateTime < 700) {
          continue;
        }

        if (pctMatch && !isMetadataPhase) {
          const rawPct = parseInt(pctMatch[1], 10);
          const peers = cnMatch ? cnMatch[1] : "0";
          const seeds = sdMatch ? sdMatch[1] : null;
          const speed = dlMatch ? dlMatch[1] : "0B";
          const eta = etaMatch ? etaMatch[1] : "";
          const sizeInfo = sizeMatch ? `${sizeMatch[1]} / ${sizeMatch[2]}` : "";

          let message = `速度: ${speed}/s · 节点: ${peers}${seeds ? `(做种:${seeds})` : ""}`;
          if (sizeInfo) message += ` · ${sizeInfo}`;
          if (eta) message += ` · 剩余: ${eta}`;

          lastUpdateTime = now;

          updateJob(jobId, {
            progress: rawPct,
            message,
          }).catch(() => {});
        } else {
          // 正在获取元数据阶段
          const peers = cnMatch ? cnMatch[1] : "0";
          lastUpdateTime = now;
          updateJob(jobId, {
            progress: 0,
            message: `正在通过 DHT/Tracker 检索种子元数据 (已连接 ${peers} 个节点)...`,
          }).catch(() => {});
        }
      }
    }
  });

  proc.stderr?.on("data", (chunk: Buffer) => {
    const text = chunk.toString("utf-8");
    tailLog.push(text);
    if (tailLog.length > 50) tailLog.shift();
  });

  proc.on("error", async (err) => {
    activeAriaProcesses.delete(jobId);
    console.error(`[magnet-downloader] 进程执行出错 (${jobId}):`, err);
    await updateJob(jobId, {
      status: "failed",
      error: `aria2 引擎启动失败: ${err.message}`,
      message: "下载失败",
    });
  });

  proc.on("exit", async (code) => {
    activeAriaProcesses.delete(jobId);
    console.log(`[magnet-downloader] 任务 ${jobId} 进程退出，代码: ${code}`);

    if (stateObj.cancelled) {
      await updateJob(jobId, {
        status: "failed",
        error: "下载已取消",
        message: "任务已取消",
      });
      return;
    }

    const fullLog = tailLog.join("\n");

    // 特殊情况：如果退出代码为 13（目标文件已存在于下载目录且未留存 .aria2 临时控制文件，表示此前已完整下载完毕）
    if (code === 13 || fullLog.includes("errorCode=13") || fullLog.includes("exists, but a control file")) {
      const existMatch = fullLog.match(/File\s+(.+?)\s+exists,\s+but a control file/i);
      let existingTarget = existMatch ? path.normalize(existMatch[1].trim()) : null;
      if (!existingTarget || !existsSync(existingTarget)) {
        // 尝试从 resultsDir 寻找
        existingTarget = discoveredSavedPath || null;
      }

      if (existingTarget && existsSync(existingTarget)) {
        const stat = await fs.stat(existingTarget);
        const filename = path.basename(existingTarget);
        const mimeType = guessMimeType(filename, stat.isDirectory());

        await updateJob(jobId, {
          status: "completed",
          progress: 100,
          message: "资源已在目标目录中下载完成，无需重复下载！",
          resultFilename: filename,
          resultMimeType: mimeType,
        });
        console.log(`[magnet-downloader] 任务 ${jobId} 命中已完成文件: ${filename}`);
        return;
      }
    }

    if (code === 0) {
      // 成功完成，确认生成的目标文件或目录
      let finalPath = discoveredSavedPath;

      if (!finalPath || !existsSync(finalPath)) {
        try {
          const files = await fs.readdir(resultsDir);
          let latestMtime = 0;
          for (const f of files) {
            // 排除 aria2 元数据缓存文件与中间下载锁
            if (f.endsWith(".aria2") || f.endsWith(".torrent")) continue;
            const full = path.join(resultsDir, f);
            const st = await fs.stat(full);
            if (st.mtimeMs > latestMtime) {
              latestMtime = st.mtimeMs;
              finalPath = full;
            }
          }
        } catch {}
      }

      if (finalPath && existsSync(finalPath)) {
        const stat = await fs.stat(finalPath);
        const filename = path.basename(finalPath);
        const mimeType = guessMimeType(filename, stat.isDirectory());

        await updateJob(jobId, {
          status: "completed",
          progress: 100,
          message: "磁力下载完成！",
          resultFilename: filename,
          resultMimeType: mimeType,
        });
        console.log(`[magnet-downloader] 任务 ${jobId} 顺利完成: ${filename}`);
      } else {
        await updateJob(jobId, {
          status: "completed",
          progress: 100,
          message: "下载完成，文件已保存在指定目录",
        });
      }
    } else {
      let friendlyError = "磁力下载失败，请检查网络或资源有效性";
      if (fullLog.includes("No URI to download")) {
        friendlyError = "无效的下载地址或磁力链接";
      } else if (fullLog.includes("Permission denied")) {
        friendlyError = "输出目录写入权限不足，请在设置中更改目录";
      } else if (fullLog.includes("Disk full") || fullLog.includes("No space left")) {
        friendlyError = "磁盘存储空间不足";
      }

      await updateJob(jobId, {
        status: "failed",
        error: friendlyError,
        message: "下载失败",
      });
    }
  });
}
