// 从 2.0.6（Electron 版）升级上来时，把旧版的收藏、置顶、最近使用、各工具设置、记账、思维导图、
// 主题等数据一次性带过来。只补「当前还没有的键」，绝不覆盖 2.1.0 里已有的数据；只做一次。
//
// 旧数据由 Rust 端只读解析（见 src-tauri/src/legacy_import.rs），这里负责写进 WebView 的 localStorage。
import { invoke } from "@tauri-apps/api/core";

const MARK = "furinakit:legacy-import-v1";
const SETTINGS_KEY = "furinakit:settings";

interface LegacyPayload {
  found: boolean;
  items?: Record<string, string>;
  settings?: Record<string, unknown> | null;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T | null> {
  return Promise.race([p, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

function readSettings(): Record<string, unknown> | null {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    const v = raw ? JSON.parse(raw) : null;
    return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function runLegacyImport(): Promise<void> {
  if (typeof window === "undefined" || !("__TAURI_INTERNALS__" in window)) return;
  try {
    if (!localStorage.getItem(MARK)) {
      const r = await withTimeout(invoke<LegacyPayload>("legacy_local_storage"), 4000).catch(() => null);
      if (r) {
        let imported = 0;
        let settingsImported = false;
        if (r.found && r.items) {
          for (const [k, v] of Object.entries(r.items)) {
            if (typeof v !== "string" || localStorage.getItem(k) !== null) continue;
            localStorage.setItem(k, v);
            imported++;
            if (k === SETTINGS_KEY) settingsImported = true;
          }
        }
        // 旧版设置文件（furinakit-settings.json）兜底：localStorage 里没有设置时用它
        if (r.found && r.settings && localStorage.getItem(SETTINGS_KEY) === null) {
          const s = r.settings;
          const pick: Record<string, unknown> = {};
          for (const key of ["autoStart", "outputDir", "closeAction", "documentDir", "imageDir", "audioDir", "videoDir"]) {
            if (s[key] !== undefined) pick[key] = s[key];
          }
          if (Object.keys(pick).length) {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify(pick));
            imported++;
            settingsImported = true;
          }
        }
        localStorage.setItem(MARK, JSON.stringify({ at: new Date().toISOString(), imported }));
        // 旧版里开了「开机自启 / 关闭即退出」的，升级后继续生效
        if (settingsImported) {
          const s = readSettings();
          if (s) await withTimeout(invoke("apply_desktop_settings", { settings: s }), 4000).catch(() => null);
        }
      }
    }
    // 每次启动把「关闭按钮行为」同步给后端（不动开机自启）
    const s = readSettings();
    if (s) void invoke("apply_desktop_settings", { settings: s, boot: true }).catch(() => {});
  } catch {
    /* 导入失败不影响正常使用 */
  }
}
