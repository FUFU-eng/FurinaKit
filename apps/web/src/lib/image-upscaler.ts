import path from "path";
import fs from "fs/promises";
import { existsSync } from "fs";
import { spawn } from "child_process";
import { updateJob } from "./jobs";
import { ensureStorageDir } from "./storage";

interface UpscalePaths {
  exePath: string;
  modelsDir: string;
}

function findUpscaleEngine(): UpscalePaths {
  if (process.env.FURINAKIT_UPSCALE_PATH && existsSync(process.env.FURINAKIT_UPSCALE_PATH)) {
    const exe = process.env.FURINAKIT_UPSCALE_PATH;
    const models = path.join(path.dirname(exe), "models");
    return { exePath: exe, modelsDir: models };
  }

  const baseCandidates = [
    // 环境变量资源目录
    process.env.FURINAKIT_RESOURCES_PATH
      ? path.join(process.env.FURINAKIT_RESOURCES_PATH, "upscale")
      : null,
    // 打包后 resources/app 的上级目录 resources/upscale
    path.join(process.cwd(), "..", "upscale"),
    path.join(process.cwd(), "..", "resources", "upscale"),
    // Electron 打包路径
    typeof process !== "undefined" &&
    (process as unknown as { resourcesPath?: string }).resourcesPath
      ? path.join(
          (process as unknown as { resourcesPath?: string }).resourcesPath!,
          "upscale"
        )
      : null,
    // Web / Next 根目录与相对路径
    path.join(process.cwd(), "resources", "upscale"),
    path.join(process.cwd(), "dist-installer", "win-unpacked", "resources", "upscale"),
    path.join(process.cwd(), "..", "dist-installer", "win-unpacked", "resources", "upscale"),
    path.join(process.cwd(), "..", "..", "apps", "web", "dist-installer", "win-unpacked", "resources", "upscale"),
    // services/worker/upscale 目录
    path.join(process.cwd(), "services", "worker", "upscale"),
    path.join(process.cwd(), "..", "worker", "upscale"),
    path.join(process.cwd(), "..", "..", "services", "worker", "upscale"),
    path.join(process.cwd(), "..", "services", "worker", "upscale"),
  ].filter((p): p is string => Boolean(p));

  for (const dir of baseCandidates) {
    const exe = path.join(dir, "realesrgan-ncnn-vulkan.exe");
    const models = path.join(dir, "models");
    if (existsSync(exe) && existsSync(models)) {
      return { exePath: exe, modelsDir: models };
    }
  }

  // 兜底返回默认相对路径
  return {
    exePath: path.join(process.cwd(), "resources", "upscale", "realesrgan-ncnn-vulkan.exe"),
    modelsDir: path.join(process.cwd(), "resources", "upscale", "models"),
  };
}

interface GpuPlan {
  gpuId: string;
  tileSize: number;
  name: string;
}

let cachedGpuPlan: GpuPlan | null = null;

async function detectGpuPlan(): Promise<GpuPlan> {
  if (cachedGpuPlan) return cachedGpuPlan;

  try {
    const output = await new Promise<string>((resolve) => {
      const proc = spawn(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          "Get-CimInstance Win32_VideoController | Select-Object -ExpandProperty Name",
        ],
        { windowsHide: true }
      );
      let out = "";
      proc.stdout.on("data", (d) => (out += d.toString()));
      proc.on("close", () => resolve(out.trim()));
      proc.on("error", () => resolve(""));
    });

    const lines = output
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean);

    // 过滤虚拟显示器与远程桌面适配器
    const physical = lines.filter(
      (l) => !/virtual|remote|citrix|rdp|gameviewer/i.test(l)
    );

    const nvidiaIdx = physical.findIndex((l) =>
      /nvidia|geforce|rtx|gtx|quadro/i.test(l)
    );
    if (nvidiaIdx >= 0) {
      cachedGpuPlan = {
        gpuId: String(nvidiaIdx),
        tileSize: 0,
        name: physical[nvidiaIdx],
      };
      console.log(`[image-upscale] 探测到 NVIDIA 显卡: ${physical[nvidiaIdx]} (GPU ID: ${nvidiaIdx})`);
      return cachedGpuPlan;
    }

    // 若无 N 卡，检测 AMD 或 Intel 显卡（Vulkan 原生硬件加速）
    const amdIdx = physical.findIndex((l) => /amd|radeon/i.test(l));
    if (amdIdx >= 0) {
      cachedGpuPlan = {
        gpuId: String(amdIdx),
        tileSize: 100,
        name: physical[amdIdx],
      };
      console.log(`[image-upscale] 探测到 AMD 显卡 (Vulkan加速): ${physical[amdIdx]} (GPU ID: ${amdIdx}, 安全切片: 100)`);
      return cachedGpuPlan;
    }

    const intelIdx = physical.findIndex((l) => /intel|arc|iris|uhd/i.test(l));
    if (intelIdx >= 0) {
      cachedGpuPlan = {
        gpuId: String(intelIdx),
        tileSize: 100,
        name: physical[intelIdx],
      };
      console.log(`[image-upscale] 探测到 Intel 显卡 (Vulkan加速): ${physical[intelIdx]} (GPU ID: ${intelIdx}, 安全切片: 100)`);
      return cachedGpuPlan;
    }

    // 通用兼容方案
    cachedGpuPlan = {
      gpuId: "0",
      tileSize: 64,
      name: physical[0] || "通用图形设备 (Vulkan)",
    };
    return cachedGpuPlan;
  } catch {
    cachedGpuPlan = { gpuId: "0", tileSize: 64, name: "默认设备" };
    return cachedGpuPlan;
  }
}

function executeUpscaleAttempt(
  exePath: string,
  args: string[],
  jobId: string,
  outputPath: string,
  resultFilename: string,
  progressPrefix: string
): Promise<{ ok: boolean; error?: string }> {
  return new Promise((resolve) => {
    console.log(`[image-upscale] 启动超分进程: ${exePath} ${args.join(" ")}`);
    const proc = spawn(exePath, args, {
      cwd: path.dirname(exePath),
      windowsHide: true,
    });

    let lastReportedPct = -1;
    const tailLog: string[] = [];
    const pctRegex = /(\d+(?:\.\d+)?)%/;

    proc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      const lines = text.split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        tailLog.push(trimmed);
        if (tailLog.length > 20) tailLog.shift();

        const match = pctRegex.exec(trimmed);
        if (match) {
          const rawPct = parseFloat(match[1]);
          const currentPct = Math.min(99, Math.max(5, Math.floor(rawPct)));
          if (currentPct !== lastReportedPct && currentPct > lastReportedPct) {
            lastReportedPct = currentPct;
            updateJob(jobId, {
              progress: currentPct,
              message: `${progressPrefix} ${rawPct.toFixed(0)}%`,
            }).catch(() => {});
          }
        }
      }
    });

    proc.on("error", (err) => {
      resolve({ ok: false, error: err.message });
    });

    proc.on("exit", async (code) => {
      if (code === 0 && existsSync(outputPath)) {
        try {
          const st = await fs.stat(outputPath);
          if (st.size > 0) {
            await updateJob(jobId, {
              status: "completed",
              progress: 100,
              message: "高清强化完成！",
              resultFilename,
              resultMimeType: "image/png",
            });
            console.log(`[image-upscale] 任务 ${jobId} 成功生成: ${outputPath} (${st.size} 字节)`);
            return resolve({ ok: true });
          }
        } catch {
          /* ignore */
        }
      }

      const errDetail = tailLog.join("\n").slice(-300);
      resolve({
        ok: false,
        error: `处理异常 (exit=${code})${errDetail ? ": " + errDetail : ""}`,
      });
    });
  });
}

export async function runImageUpscaleJob(
  jobId: string,
  payload: Record<string, unknown>
): Promise<void> {
  const { exePath, modelsDir } = findUpscaleEngine();

  if (!existsSync(exePath)) {
    console.error(`[image-upscale] 找不到超分引擎可执行文件: ${exePath}`);
    await updateJob(jobId, {
      status: "failed",
      error: `超分引擎缺失: 未能找到 ${path.basename(exePath)}，请检查资源包`,
      message: "超分失败",
    });
    return;
  }

  const inputFile = String(payload.file || "").trim();
  if (!inputFile || !existsSync(inputFile)) {
    await updateJob(jobId, {
      status: "failed",
      error: "输入图片不存在或已被移除",
      message: "超分失败",
    });
    return;
  }

  const model = String(payload.model || "anime-x2");
  const scale = Number(payload.scale || 2);

  let modelName = "realesr-animevideov3";
  let targetScale = scale;

  if (model === "real-x4") {
    modelName = "realesrgan-x4plus";
    targetScale = 4;
  } else if (model === "anime-x3") {
    targetScale = 3;
  } else if (model === "anime-x4") {
    targetScale = 4;
  } else {
    targetScale = 2;
  }

  const storagePath = await ensureStorageDir();
  const resultsDir = path.join(storagePath, "results");
  await fs.mkdir(resultsDir, { recursive: true });

  const inputExt = path.extname(inputFile) || ".png";
  const inputBase = path.basename(inputFile, inputExt);
  const resultFilename = `${inputBase}_upscaled.png`;
  const outputPath = path.join(resultsDir, `${jobId}-${resultFilename}`);

  await updateJob(jobId, {
    status: "processing",
    progress: 5,
    message: "正在初始化超分辨率模型...",
  });

  const plan = await detectGpuPlan();

  const primaryArgs = [
    "-i",
    inputFile,
    "-o",
    outputPath,
    "-n",
    modelName,
    "-s",
    String(targetScale),
    "-m",
    modelsDir,
    "-g",
    plan.gpuId,
    "-t",
    String(plan.tileSize),
  ];

  const firstAttempt = await executeUpscaleAttempt(
    exePath,
    primaryArgs,
    jobId,
    outputPath,
    resultFilename,
    `高清超分中 (${plan.name})...`
  );

  if (firstAttempt.ok) return;

  // 若首次失败且切片非安全切片 (例如 0 或显存溢出)，自动降级安全切片 (-t 64) 二次重试
  console.warn(
    `[image-upscale] 任务 ${jobId} 首轮超分未能成功 (${firstAttempt.error})，启动通用安全低显存保护模式 (-t 64) 自动重试...`
  );

  await updateJob(jobId, {
    progress: 10,
    message: "已启用低显存保护模式，正在安全重绘...",
  });

  const fallbackArgs = [
    "-i",
    inputFile,
    "-o",
    outputPath,
    "-n",
    modelName,
    "-s",
    String(targetScale),
    "-m",
    modelsDir,
    "-g",
    "0",
    "-t",
    "64",
  ];

  const secondAttempt = await executeUpscaleAttempt(
    exePath,
    fallbackArgs,
    jobId,
    outputPath,
    resultFilename,
    "安全低显存模式超分中..."
  );

  if (!secondAttempt.ok) {
    await updateJob(jobId, {
      status: "failed",
      error: `超分处理失败: ${secondAttempt.error || firstAttempt.error}`,
      message: "超分失败",
    });
  }
}
