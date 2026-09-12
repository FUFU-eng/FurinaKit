import { NextResponse } from "next/server";
import path from "path";
import fs from "fs";

import { getStoragePath } from "@/lib/storage";
import { getCustomOutputDir } from "@/lib/settings";
import { guardApiRequest } from "@/lib/api-guard";

export const runtime = "nodejs";

function getOutputDir(): string {
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

export async function GET(request: Request) {
  const denied = guardApiRequest(request);
  if (denied) return denied;
  try {
    const outputDir = getOutputDir();
    const resultsDir = path.resolve(getStoragePath(), "results");
    
    // 确保目录存在
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    return NextResponse.json({
      outputDir,
      resultsDir,
      storagePath: getStoragePath(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to get output directory";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const denied = guardApiRequest(request);
  if (denied) return denied;
  try {
    const outputDir = getOutputDir();
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    // 在 Windows 系统下若通过本地 API 触发打开文件夹
    if (process.platform === "win32") {
      const { exec } = await import("child_process");
      exec(`explorer.exe "${outputDir}"`);
    }

    return NextResponse.json({ success: true, outputDir });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to open output directory";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}