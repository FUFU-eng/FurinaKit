import path from "path";
import fs from "fs";
import os from "os";

export interface FurinaKitSettings {
  outputDir?: string;
  maxConcurrentJobs?: number;
  autoCleanDays?: number;
  [key: string]: unknown;
}

export function getSettingsFilePath(): string | null {
  const envPath = process.env.FURINAKIT_SETTINGS_FILE;
  if (envPath && fs.existsSync(envPath)) {
    return envPath;
  }

  const candidates = [
    path.join(process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming"), "FurinaKit", "furinakit-settings.json"),
    path.join(os.homedir(), ".config", "FurinaKit", "furinakit-settings.json"),
    path.resolve(process.cwd(), "..", "..", "furinakit-settings.json"),
    path.resolve(process.cwd(), "furinakit-settings.json"),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

export function loadSettings(): FurinaKitSettings {
  try {
    const file = getSettingsFilePath();
    if (file && fs.existsSync(file)) {
      const raw = fs.readFileSync(file, "utf-8");
      return JSON.parse(raw);
    }
  } catch {}
  return {};
}

export function getCustomOutputDir(): string | null {
  const settings = loadSettings();
  if (typeof settings.outputDir === "string" && settings.outputDir.trim()) {
    return settings.outputDir.trim();
  }
  return null;
}
