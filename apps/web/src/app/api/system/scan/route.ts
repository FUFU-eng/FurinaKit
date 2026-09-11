import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { cleanupExpiredFiles } from "@/lib/storage";

export const runtime = "nodejs";

export async function POST() {
  const cwd = process.cwd();
  const execDir = path.dirname(process.execPath);

  // 待检测组件列表
  const checkPaths = (relPaths: string[]): boolean => {
    for (const rel of relPaths) {
      const candidates = [
        path.join(cwd, rel),
        path.join(cwd, "resources", rel),
        path.join(cwd, "..", "resources", rel),
        path.join(execDir, rel),
        path.join(execDir, "resources", rel),
        path.join(cwd, "..", "..", "services", "worker", rel),
      ];
      for (const p of candidates) {
        if (fs.existsSync(p)) return true;
      }
    }
    return false;
  };

  const hasWorker = checkPaths([
    "furinakit-worker.exe",
    "../../services/worker/dist/furinakit-worker.exe",
    "../../services/worker/app/main.py",
  ]);

  const hasFfmpeg = checkPaths([
    "ffmpeg.exe",
    "resources/ffmpeg.exe",
  ]);

  const hasAria2 = checkPaths([
    "aria2c.exe",
    "resources/aria2c.exe",
  ]);

  const hasUpscale = checkPaths([
    "upscale/realesrgan-ncnn-vulkan.exe",
    "resources/upscale/realesrgan-ncnn-vulkan.exe",
    "../../services/worker/upscale/realesrgan-ncnn-vulkan.exe",
  ]);

  const hasModels = checkPaths([
    "upscale/models",
    "resources/upscale/models",
    "../../services/worker/upscale/models",
  ]);

  // 执行缓存清理与完整性校验
  let cleaned = false;
  try {
    await cleanupExpiredFiles();
    cleaned = true;
  } catch {}

  return NextResponse.json({
    ok: true,
    components: {
      worker: hasWorker,
      ffmpeg: hasFfmpeg,
      aria2c: hasAria2,
      upscaleEngine: hasUpscale,
      upscaleModels: hasModels,
      storageCleaned: cleaned,
    },
  });
}
