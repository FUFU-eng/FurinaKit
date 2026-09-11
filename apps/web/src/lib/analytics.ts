/**
 * FurinaKit 全能用量与运行环境数据统计模块
 * 包含：工具使用排行、错误率自检、设备环境（系统/分辨率/语言）、软件启动与留存统计
 * 纯本地隐私安全存储 + 云端极简匿名打点
 */

const STORAGE_USAGE_KEY = "furinakit:tool_usage_v1";
const STORAGE_TELEMETRY_KEY = "furinakit:telemetry_v1";
const STORAGE_ERROR_KEY = "furinakit:tool_errors_v1";

export interface ToolUsageInfo {
  count: number;
  lastUsed: string; // ISO 日期
}

export type ToolUsageMap = Record<string, ToolUsageInfo>;
export type ToolErrorMap = Record<string, { count: number; lastError: string; lastAt: string }>;

export interface SystemEnvironmentInfo {
  os: string;
  screenResolution: string;
  devicePixelRatio: number;
  language: string;
  isElectron: boolean;
  platform: string;
}

export interface AppTelemetryData {
  launchCount: number;
  firstLaunchAt: string;
  lastLaunchAt: string;
  activeDaysCount: number;
  activeDates: string[]; // YYYY-MM-DD
  totalToolUses: number;
  toolUsage: ToolUsageMap;
  toolErrors: ToolErrorMap;
  system: SystemEnvironmentInfo;
}

/**
 * 获取当前系统与显示环境信息
 */
export function getSystemEnvironmentInfo(): SystemEnvironmentInfo {
  if (typeof window === "undefined") {
    return {
      os: "Unknown",
      screenResolution: "1920x1080",
      devicePixelRatio: 1,
      language: "zh-CN",
      isElectron: false,
      platform: "win32",
    };
  }

  const ua = navigator.userAgent || "";
  let os = "Windows";
  if (ua.includes("Windows NT 10.0")) {
    os = "Windows 10 / 11";
  } else if (ua.includes("Windows NT 6.3")) {
    os = "Windows 8.1";
  } else if (ua.includes("Windows NT 6.1")) {
    os = "Windows 7";
  } else if (ua.includes("Mac OS")) {
    os = "macOS";
  } else if (ua.includes("Linux")) {
    os = "Linux";
  }

  const screenResolution = `${window.screen?.width || 1920} x ${window.screen?.height || 1080}`;
  const isElectron = Boolean(
    (window as unknown as { furinakit?: unknown }).furinakit ||
    ua.includes("Electron")
  );

  return {
    os,
    screenResolution,
    devicePixelRatio: window.devicePixelRatio || 1,
    language: navigator.language || "zh-CN",
    isElectron,
    platform: navigator.platform || "Win32",
  };
}

/**
 * 软件启动时打卡记录（启动次数、连续使用天数）
 */
export function trackAppLaunch(): void {
  if (typeof window === "undefined") return;

  try {
    const raw = localStorage.getItem(STORAGE_TELEMETRY_KEY);
    const today = new Date().toISOString().slice(0, 10);
    const now = new Date().toISOString();

    const data: {
      launchCount: number;
      firstLaunchAt: string;
      lastLaunchAt: string;
      activeDates: string[];
    } = raw ? JSON.parse(raw) : {
      launchCount: 0,
      firstLaunchAt: now,
      lastLaunchAt: now,
      activeDates: [],
    };


    data.launchCount = (data.launchCount || 0) + 1;
    data.lastLaunchAt = now;
    if (!data.firstLaunchAt) data.firstLaunchAt = now;

    if (!Array.isArray(data.activeDates)) {
      data.activeDates = [];
    }
    if (!data.activeDates.includes(today)) {
      data.activeDates.push(today);
      if (data.activeDates.length > 90) {
        data.activeDates = data.activeDates.slice(-90);
      }
    }

    localStorage.setItem(STORAGE_TELEMETRY_KEY, JSON.stringify(data));

    // 匿名云端打点：总启动数与当日活跃
    try {
      fetch("https://abacus.jasoncameron.dev/hit/furinakit_prod/launches", {
        method: "GET",
        mode: "no-cors",
        cache: "no-store",
      }).catch(() => {});
    } catch {}
  } catch {}
}

/**
 * 记录工具使用事件（无感静默上报 + 本地持久化）
 */
export function trackToolUsage(toolId: string): void {
  if (!toolId || typeof window === "undefined") return;

  const cleanId = toolId.trim().toLowerCase();

  // 1. 本地统计自增与时间更新
  try {
    const raw = localStorage.getItem(STORAGE_USAGE_KEY);
    const map: ToolUsageMap = raw ? JSON.parse(raw) : {};
    const current = map[cleanId] || { count: 0, lastUsed: "" };
    map[cleanId] = {
      count: current.count + 1,
      lastUsed: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_USAGE_KEY, JSON.stringify(map));
  } catch {}

  // 2. 远端双通道异步打点（不阻塞主流程，静默失败）
  const safeId = cleanId.replace(/[^a-zA-Z0-9_-]/g, "_");

  // 通道 1: Abacus 计数服务
  try {
    const abacusUrl = `https://abacus.jasoncameron.dev/hit/furinakit_tools/${safeId}`;
    fetch(abacusUrl, {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
    }).catch(() => {});
    // 全局工具调用总数统计
    fetch("https://abacus.jasoncameron.dev/hit/furinakit_prod/total_tool_runs", {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
    }).catch(() => {});
  } catch {}

  // 通道 2: CountAPI 备用通道
  try {
    const countApiUrl = `https://countapi.mileshilliard.com/api/v1/hit/furinakit_tool_${safeId.replace(/-/g, "_")}`;
    fetch(countApiUrl, {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
    }).catch(() => {});
    fetch("https://countapi.mileshilliard.com/api/v1/hit/furinakit_prod_total_tool_runs", {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
    }).catch(() => {});
  } catch {}
}

/**
 * 记录工具执行异常（帮助作者发现并修复在线 Bug）
 */
export function trackToolError(toolId: string, errorMsg: string): void {
  if (!toolId || typeof window === "undefined") return;
  const cleanId = toolId.trim().toLowerCase();

  try {
    const raw = localStorage.getItem(STORAGE_ERROR_KEY);
    const map: ToolErrorMap = raw ? JSON.parse(raw) : {};
    const current = map[cleanId] || { count: 0, lastError: "", lastAt: "" };
    map[cleanId] = {
      count: current.count + 1,
      lastError: String(errorMsg || "Unknown error").slice(0, 150),
      lastAt: new Date().toISOString(),
    };
    localStorage.setItem(STORAGE_ERROR_KEY, JSON.stringify(map));
  } catch {}
}

/**
 * 获取本地记录的所有工具使用频次字典
 */
export function getLocalToolUsage(): ToolUsageMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_USAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * 获取本地记录的工具报错情况
 */
export function getLocalToolErrors(): ToolErrorMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_ERROR_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

/**
 * 获取完整的本地统计报表对象（供数据看板展示）
 */
export function getAppTelemetry(): AppTelemetryData {
  const toolUsage = getLocalToolUsage();
  const toolErrors = getLocalToolErrors();
  const system = getSystemEnvironmentInfo();

  let launchCount = 1;
  let firstLaunchAt = new Date().toISOString();
  let lastLaunchAt = new Date().toISOString();
  let activeDates: string[] = [new Date().toISOString().slice(0, 10)];

  if (typeof window !== "undefined") {
    try {
      const raw = localStorage.getItem(STORAGE_TELEMETRY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        launchCount = parsed.launchCount || 1;
        firstLaunchAt = parsed.firstLaunchAt || firstLaunchAt;
        lastLaunchAt = parsed.lastLaunchAt || lastLaunchAt;
        activeDates = Array.isArray(parsed.activeDates) ? parsed.activeDates : activeDates;
      }
    } catch {}
  }

  const totalToolUses = Object.values(toolUsage).reduce((acc, cur) => acc + (cur.count || 0), 0);

  return {
    launchCount,
    firstLaunchAt,
    lastLaunchAt,
    activeDaysCount: activeDates.length,
    activeDates,
    totalToolUses,
    toolUsage,
    toolErrors,
    system,
  };
}

/**
 * 异步查询云端累计数据（安装量、启动量等）
 */
export async function fetchRemoteStats(): Promise<{
  installs: number | null;
  launches: number | null;
}> {
  let installs: number | null = null;
  let launches: number | null = null;

  try {
    const res = await fetch("https://abacus.jasoncameron.dev/get/furinakit_prod/installs", {
      cache: "no-store",
    });
    if (res.ok) {
      const data = await res.json();
      if (typeof data?.value === "number") installs = data.value;
    }
  } catch {}

  if (installs === null) {
    try {
      const cRes = await fetch("https://countapi.mileshilliard.com/api/v1/get/furinakit_prod_installs_v2", {
        cache: "no-store",
      });
      if (cRes.ok) {
        const cData = await cRes.json();
        if (typeof cData?.value === "number") installs = cData.value;
      }
    } catch {}
  }

  try {
    const lRes = await fetch("https://abacus.jasoncameron.dev/get/furinakit_prod/launches", {
      cache: "no-store",
    });
    if (lRes.ok) {
      const lData = await lRes.json();
      if (typeof lData?.value === "number") launches = lData.value;
    }
  } catch {}

  return { installs, launches };
}

