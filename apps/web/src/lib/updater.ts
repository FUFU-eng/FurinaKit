import { APP_VERSION, DEFAULT_UPDATE_ENDPOINT, FALLBACK_UPDATE_ENDPOINTS, type VersionInfo } from "./version";

export interface UpdateCheckResult {
  hasUpdate: boolean;
  currentVersion: string;
  latestVersion: string;
  releaseDate?: string;
  changelog: string[];
  downloadUrl?: string;
  mirrors?: Array<{ name: string; url: string }>;
  error?: string;
}

/**
 * 校验更新地址的合法性与安全性（必须为合法的 https 协议，开发模式下允许本地 http）
 */
export function isValidUpdateUrl(url?: string | null): boolean {
  if (!url || typeof url !== "string") return false;
  try {
    const parsed = new URL(url);
    if (parsed.protocol === "https:") return true;
    if (
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function parseSemver(v: string): number[] {
  return v
    .replace(/^v/i, "")
    .split(/[-+]/)[0]
    .split(".")
    .map((n) => parseInt(n, 10) || 0);
}

/** 缓存当前运行软件的版本解析结果，避免重复解析 */
const PARSED_APP_VERSION = parseSemver(APP_VERSION);

/**
 * 比较两个语义化版本号 (SemVer: a vs b)
 * 返回 1 表示 a > b，-1 表示 a < b，0 表示相等
 */
export function compareSemver(a: string, b: string): number {
  const pa = a === APP_VERSION ? PARSED_APP_VERSION : parseSemver(a);
  const pb = b === APP_VERSION ? PARSED_APP_VERSION : parseSemver(b);
  const len = Math.max(pa.length, pb.length);

  for (let i = 0; i < len; i++) {
    const na = pa[i] ?? 0;
    const nb = pb[i] ?? 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

/**
 * 检查软件更新（支持自动跨镜像重试、国内 CDN 加速与安全校验）
 * @param customUrl 可选自定义更新 JSON 地址
 */
export async function checkForUpdates(customUrl?: string): Promise<UpdateCheckResult> {
  // 安全校验：若传入非法或非安全协议 customUrl，则直接忽略，防止恶意注入或解析崩溃
  const validCustomUrl = isValidUpdateUrl(customUrl) ? customUrl : undefined;

  const candidateEndpoints: string[] = validCustomUrl
    ? [validCustomUrl]
    : [DEFAULT_UPDATE_ENDPOINT, ...FALLBACK_UPDATE_ENDPOINTS];

  // 严格过滤合法 URL 并去重
  const endpoints = Array.from(new Set(candidateEndpoints.filter(isValidUpdateUrl)));
  let bestResult: UpdateCheckResult | null = null;

  for (const endpoint of endpoints) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4500);

    try {
      const cacheBustUrl = endpoint.includes("?")
        ? `${endpoint}&_t=${Date.now()}`
        : `${endpoint}?_t=${Date.now()}`;

      // 统一使用标准 try/catch 异步处理，移除混用的 .catch
      const res = await fetch(cacheBustUrl, {
        signal: controller.signal,
        cache: "no-store",
      });

      if (!res.ok) continue;

      const data = (await res.json()) as VersionInfo;
      if (!data || typeof data.version !== "string") continue;

      const isNewer = compareSemver(data.version, APP_VERSION) > 0;
      if (isNewer) {
        // 发现更高版本，立即返回新版本更新信息
        return {
          hasUpdate: true,
          currentVersion: APP_VERSION,
          latestVersion: data.version,
          releaseDate: data.releaseDate,
          changelog: Array.isArray(data.changelog) ? data.changelog : [],
          downloadUrl: data.downloadUrl,
          mirrors: data.mirrors,
        };
      } else if (!bestResult) {
        // 若该镜像暂未同步到最新版（<= 本地版本），暂存该有效响应，继续探测备用镜像
        bestResult = {
          hasUpdate: false,
          currentVersion: APP_VERSION,
          latestVersion: data.version,
          releaseDate: data.releaseDate,
          changelog: Array.isArray(data.changelog) ? data.changelog : ["当前已是最新稳定版本。"],
          downloadUrl: data.downloadUrl,
          mirrors: data.mirrors,
        };
      }
    } catch {
      // 网络请求超时、被取消或 JSON 解析异常，平滑尝试下一个可用镜像源
      continue;
    } finally {
      // 在 finally 块中 100% 清理释放定时器，杜绝后台游离计时器
      clearTimeout(timer);
    }
  }

  return bestResult ?? {
    hasUpdate: false,
    currentVersion: APP_VERSION,
    latestVersion: APP_VERSION,
    changelog: ["当前已是最新稳定版本。"],
  };
}

