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
 * 比较两个语义化版本号 (SemVer: a vs b)
 * 返回 1 表示 a > b，-1 表示 a < b，0 表示相等
 */
export function compareSemver(a: string, b: string): number {
  const parse = (v: string) =>
    v.replace(/^v/i, "").split(/[-+]/)[0].split(".").map((n) => parseInt(n, 10) || 0);

  const pa = parse(a);
  const pb = parse(b);
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
 * 检查软件更新（支持自动跨镜像重试与国内 CDN 加速）
 * @param customUrl 可选自定义更新 JSON 地址
 */
export async function checkForUpdates(customUrl?: string): Promise<UpdateCheckResult> {
  const candidateEndpoints: string[] = customUrl
    ? [customUrl]
    : [DEFAULT_UPDATE_ENDPOINT, ...FALLBACK_UPDATE_ENDPOINTS];

  // 去重
  const endpoints = Array.from(new Set(candidateEndpoints));

  for (const endpoint of endpoints) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4500);

      const cacheBustUrl = endpoint.includes("?")
        ? `${endpoint}&_t=${Date.now()}`
        : `${endpoint}?_t=${Date.now()}`;

      const res = await fetch(cacheBustUrl, {
        signal: controller.signal,
        cache: "no-store",
      }).catch(() => null);

      clearTimeout(timer);

      if (!res || !res.ok) continue;

      const data = (await res.json()) as VersionInfo;
      if (!data || typeof data.version !== "string") continue;

      const isNewer = compareSemver(data.version, APP_VERSION) > 0;

      return {
        hasUpdate: isNewer,
        currentVersion: APP_VERSION,
        latestVersion: data.version,
        releaseDate: data.releaseDate,
        changelog: Array.isArray(data.changelog) ? data.changelog : [],
        downloadUrl: data.downloadUrl,
        mirrors: data.mirrors,
      };
    } catch {
      // 尝试下一个镜像源
      continue;
    }
  }

  return {
    hasUpdate: false,
    currentVersion: APP_VERSION,
    latestVersion: APP_VERSION,
    changelog: ["当前已是最新稳定版本。"],
  };
}

