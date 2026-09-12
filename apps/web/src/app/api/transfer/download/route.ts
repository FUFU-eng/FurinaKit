import { NextResponse } from "next/server";
import fsSync from "fs";
import fs from "fs/promises";
import path from "path";
import { getStoragePath } from "@/lib/storage";
import { guardApiRequest } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  // 互传功能：本机请求需同源；手机等局域网设备需携带本次启动的互传令牌
  const denied = guardApiRequest(req, { allowLanToken: true });
  if (denied) return denied;
  try {
    const url = new URL(req.url);
    const fileName = url.searchParams.get("id") || url.searchParams.get("name");
    const type = url.searchParams.get("type") || "shared";

    if (!fileName) {
      return new NextResponse("File name is required", { status: 400 });
    }

    // 防目录遍历
    const safeBaseName = path.basename(fileName);
    const subDir = type === "received" ? "received" : "shared";
    const filePath = path.join(getStoragePath(), "transfers", subDir, safeBaseName);

    if (!fsSync.existsSync(filePath)) {
      return new NextResponse("File not found", { status: 404 });
    }

    const stat = await fs.stat(filePath);
    const buffer = await fs.readFile(filePath);

    // 格式化文件名编码以兼容各系统与手机浏览器
    const encodedFileName = encodeURIComponent(safeBaseName);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(stat.size),
        "Content-Disposition": `attachment; filename="${encodedFileName}"; filename*=UTF-8''${encodedFileName}`,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Download error";
    return new NextResponse(message, { status: 500 });
  }
}
