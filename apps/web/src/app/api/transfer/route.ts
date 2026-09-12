import { NextResponse } from "next/server";
import os from "os";
import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { exec } from "child_process";
import { getStoragePath, writeStreamToFile } from "@/lib/storage";
import { parseMultipart } from "@/lib/multipart";
import { guardApiRequest } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

/** 互传落盘的文件名清洗：与旧实现逐字一致（Windows 不允许的字符换成下划线） */
function sanitizeTransferName(name: string): string {
  return name.replace(/[/\\?%*:|"<>]/g, "_");
}

interface TransferredFile {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  createdAt: string;
  path?: string;
  downloadUrl?: string;
}

interface TransferMeta {
  sharedFiles: TransferredFile[];
  receivedFiles: TransferredFile[];
  clipboardText: string;
  receiveDir?: string;
}

function getDefaultTransfersDir(): { root: string; received: string; shared: string; metaFile: string } {
  const root = path.join(getStoragePath(), "transfers");
  const received = path.join(root, "received");
  const shared = path.join(root, "shared");
  const metaFile = path.join(root, "metadata.json");
  return { root, received, shared, metaFile };
}

async function ensureDirs(meta?: TransferMeta) {
  const { received, shared } = getDefaultTransfersDir();
  await fs.mkdir(received, { recursive: true });
  await fs.mkdir(shared, { recursive: true });
  if (meta?.receiveDir) {
    try {
      await fs.mkdir(meta.receiveDir, { recursive: true });
    } catch {}
  }
}

function getEffectiveReceiveDir(meta: TransferMeta): string {
  if (meta.receiveDir && fsSync.existsSync(meta.receiveDir)) {
    return meta.receiveDir;
  }
  return getDefaultTransfersDir().received;
}

async function loadMeta(): Promise<TransferMeta> {
  const { metaFile } = getDefaultTransfersDir();
  try {
    if (fsSync.existsSync(metaFile)) {
      const raw = await fs.readFile(metaFile, "utf-8");
      return JSON.parse(raw);
    }
  } catch {}
  return { sharedFiles: [], receivedFiles: [], clipboardText: "" };
}

async function saveMeta(meta: TransferMeta): Promise<void> {
  const { metaFile } = getDefaultTransfersDir();
  await ensureDirs(meta);
  await fs.writeFile(metaFile, JSON.stringify(meta, null, 2), "utf-8");
}

function isVirtualAdapter(name: string): boolean {
  const lower = name.toLowerCase();
  return (
    lower.includes("wsl") ||
    lower.includes("vethernet") ||
    lower.includes("virtual") ||
    lower.includes("vbox") ||
    lower.includes("vmware") ||
    lower.includes("vmnet") ||
    lower.includes("hyper-v") ||
    lower.includes("docker") ||
    lower.includes("tailscale") ||
    lower.includes("zerotier") ||
    lower.includes("loopback") ||
    lower.includes("bluetooth") ||
    lower.includes("tap") ||
    lower.includes("npcap") ||
    lower.includes("mihomo") ||
    lower.includes("clash") ||
    lower.includes("sing-box") ||
    lower.includes("tun") ||
    lower.includes("wireguard")
  );
}

/** 获取所有局域网可用的 IPv4 地址（智能排除虚拟网卡并物理网卡优先） */
function getLanIps(): Array<{ name: string; ip: string }> {
  const interfaces = os.networkInterfaces();
  const physicalIps: Array<{ name: string; ip: string }> = [];
  const virtualIps: Array<{ name: string; ip: string }> = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === "IPv4" && !addr.internal) {
        // 排除保留与代理 TUN 网段 (如 198.18.0.1)
        if (addr.address.startsWith("198.18.") || addr.address.startsWith("198.19.")) {
          continue;
        }

        const item = { name, ip: addr.address };
        if (isVirtualAdapter(name)) {
          virtualIps.push(item);
        } else {
          // 真实 Wi-Fi / 以太网优先
          if (
            addr.address.startsWith("192.168.") ||
            addr.address.startsWith("10.") ||
            addr.address.startsWith("172.")
          ) {
            physicalIps.unshift(item);
          } else {
            physicalIps.push(item);
          }
        }
      }
    }
  }

  const results = [...physicalIps, ...virtualIps];

  if (results.length === 0) {
    results.push({ name: "本地回环", ip: "127.0.0.1" });
  }

  return results;
}

export async function GET(req: Request) {
  // 互传功能：本机请求需同源；手机等局域网设备需携带本次启动的互传令牌
  const denied = guardApiRequest(req, { allowLanToken: true });
  if (denied) return denied;
  try {
    const meta = await loadMeta();
    await ensureDirs(meta);
    const ips = getLanIps();

    const url = new URL(req.url);
    const port = url.port || process.env.PORT || "3001";
    const receiveDir = getEffectiveReceiveDir(meta);

    return NextResponse.json({
      success: true,
      ips,
      port,
      receiveDir,
      sharedFiles: meta.sharedFiles,
      receivedFiles: meta.receivedFiles,
      clipboardText: meta.clipboardText,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "获取状态失败";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  // 互传功能：本机请求需同源；手机等局域网设备需携带本次启动的互传令牌
  const denied = guardApiRequest(req, { allowLanToken: true });
  if (denied) return denied;
  try {
    const meta = await loadMeta();
    await ensureDirs(meta);
    const url = new URL(req.url);
    const action = url.searchParams.get("action");
    const { shared } = getDefaultTransfersDir();
    const effectiveReceived = getEffectiveReceiveDir(meta);

    // 1. 上传文件（手机传给电脑）
    if (action === "upload") {
      // 边收边写盘：手机传大文件时不再把整份文件先收进内存（见 lib/multipart.ts）
      const { files } = await parseMultipart(req, async (part) => {
        const safeName = sanitizeTransferName(part.filename);
        let targetPath = path.join(effectiveReceived, safeName);

        // 防重名覆盖
        if (fsSync.existsSync(targetPath)) {
          const ext = path.extname(safeName);
          const base = path.basename(safeName, ext);
          targetPath = path.join(effectiveReceived, `${base}_${Date.now()}${ext}`);
        }

        const size = await writeStreamToFile(targetPath, part.body);
        return { path: targetPath, size };
      });

      const incoming = files.filter((file) => file.field === "files");
      if (incoming.length === 0) {
        return NextResponse.json({ success: false, error: "未接收到上传文件" }, { status: 400 });
      }

      const addedList: TransferredFile[] = [];

      for (const file of incoming) {
        const record: TransferredFile = {
          id: `rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name: path.basename(file.path),
          size: file.size,
          mimeType: file.contentType || "application/octet-stream",
          createdAt: new Date().toISOString(),
          path: file.path,
        };
        addedList.push(record);
        meta.receivedFiles.unshift(record);
      }

      await saveMeta(meta);
      return NextResponse.json({ success: true, added: addedList });
    }

    // 2. 电脑添加共享文件（电脑发给手机）
    if (action === "share") {
      const { files } = await parseMultipart(req, async (part) => {
        const safeName = sanitizeTransferName(part.filename);
        let targetPath = path.join(shared, safeName);

        if (fsSync.existsSync(targetPath)) {
          const ext = path.extname(safeName);
          const base = path.basename(safeName, ext);
          targetPath = path.join(shared, `${base}_${Date.now()}${ext}`);
        }

        const size = await writeStreamToFile(targetPath, part.body);
        return { path: targetPath, size };
      });

      const incoming = files.filter((file) => file.field === "files");
      if (incoming.length === 0) {
        return NextResponse.json({ success: false, error: "未接收到共享文件" }, { status: 400 });
      }

      const addedList: TransferredFile[] = [];

      for (const file of incoming) {
        const record: TransferredFile = {
          id: `shr_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          name: path.basename(file.path),
          size: file.size,
          mimeType: file.contentType || "application/octet-stream",
          createdAt: new Date().toISOString(),
          downloadUrl: `/api/transfer/download?id=${encodeURIComponent(path.basename(file.path))}&type=shared`,
        };
        addedList.push(record);
        meta.sharedFiles.unshift(record);
      }

      await saveMeta(meta);
      return NextResponse.json({ success: true, added: addedList });
    }

    // 3. 剪贴板 / 文字同步
    if (action === "clipboard") {
      const body = await req.json();
      meta.clipboardText = String(body.text || "");
      await saveMeta(meta);
      return NextResponse.json({ success: true, text: meta.clipboardText });
    }

    // 4. 删除共享文件
    if (action === "delete-shared") {
      const body = await req.json();
      const target = meta.sharedFiles.find((f) => f.id === body.id);
      if (target) {
        try {
          const filePath = path.join(shared, target.name);
          if (fsSync.existsSync(filePath)) await fs.unlink(filePath);
        } catch {}
        meta.sharedFiles = meta.sharedFiles.filter((f) => f.id !== body.id);
        await saveMeta(meta);
      }
      return NextResponse.json({ success: true });
    }

    // 5. 移除已接收记录（**只删记录，绝不删磁盘上的文件**）
    //
    // received 目录里是用户互传过来的文件，属于用户数据。用户想删文件时，
    // 自己会去接收文件夹里删（界面提供「打开文件夹」）。所以这里只移除列表记录。
    if (action === "delete-received") {
      const body = await req.json().catch(() => null);
      const id = typeof body?.id === "string" ? body.id : "";
      if (!id) {
        return NextResponse.json({ success: false, error: "缺少文件标识" }, { status: 400 });
      }
      meta.receivedFiles = meta.receivedFiles.filter((f) => f.id !== id);
      await saveMeta(meta);
      return NextResponse.json({ success: true });
    }

    // 6. 打开所在文件夹 (Windows Explorer)
    if (action === "open-folder") {
      const targetDir = effectiveReceived;
      if (process.platform === "win32") {
        exec(`explorer.exe "${targetDir}"`);
      } else if (process.platform === "darwin") {
        exec(`open "${targetDir}"`);
      } else {
        exec(`xdg-open "${targetDir}"`);
      }
      return NextResponse.json({ success: true, path: targetDir });
    }

    // 7. 设置/更改手机上传文件的保存目录
    if (action === "set-receive-dir") {
      const body = await req.json().catch(() => null);
      const dir = (body?.receiveDir || "").trim();
      if (dir) {
        // 必须是已经存在的目录：避免被当成「随便新建一个目录」的写入原语
        let isDir = false;
        try {
          isDir = fsSync.statSync(dir).isDirectory();
        } catch {
          isDir = false;
        }
        if (!isDir) {
          return NextResponse.json(
            { success: false, error: "接收目录不存在或不是文件夹，请先创建后重试" },
            { status: 400 },
          );
        }
        meta.receiveDir = dir;
        await saveMeta(meta);
      }
      return NextResponse.json({ success: true, receiveDir: getEffectiveReceiveDir(meta) });
    }

    // 7. 直接打开特定文件
    if (action === "open-file") {
      const body = await req.json().catch(() => null);
      const targetPath = typeof body?.path === "string" ? body.path : "";
      if (!targetPath) {
        return NextResponse.json({ success: false, error: "缺少文件路径" }, { status: 400 });
      }
      if (fsSync.existsSync(targetPath)) {
        // 只允许打开「由本功能自己收下来的文件」或共享目录里的文件。
        // 否则这会变成一个「让电脑运行任意程序」的接口（Windows 上 start 走 ShellExecute）。
        const allowedRoots = [
          getEffectiveReceiveDir(meta),
          getDefaultTransfersDir().shared,
        ].filter(Boolean) as string[];
        const resolvedTarget = path.resolve(targetPath);
        const inside = allowedRoots.some((root) => {
          const rel = path.relative(path.resolve(root), resolvedTarget);
          return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
        });
        if (!inside) {
          return NextResponse.json(
            { success: false, error: "出于安全考虑，只能打开互传目录中的文件" },
            { status: 403 },
          );
        }
        if (process.platform === "win32") {
          // 用 shell.showItemInFolder 语义：在资源管理器中定位并选中，而不是执行它
          exec(`explorer.exe /select,"${resolvedTarget}"`);
        } else if (process.platform === "darwin") {
          exec(`open -R "${resolvedTarget}"`);
        } else {
          exec(`xdg-open "${path.dirname(resolvedTarget)}"`);
        }
      }
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ success: false, error: "未知的 action" }, { status: 400 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "请求处理失败";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
