import { NextResponse } from "next/server";
import { randomBytes } from "crypto";

/**
 * 本地 API 的访问门禁。
 *
 * 背景：FurinaKit 的前端服务必须监听 0.0.0.0，否则 2.0.5 的「局域网跨设备互传」
 * 无法被手机访问。但这也意味着同一网络下的任何设备、甚至用户浏览器里打开的
 * 任意网页，都可能直接调用本机的 /api/*（尤其是 transfer 的写入与打开文件接口）。
 *
 * 因此这里做两道门：
 *   1. 来自本机（Host 是 127.0.0.1 / localhost / ::1）的请求，必须是同源发起的，
 *      借此挡掉「恶意网页偷偷访问本机服务」与「DNS 重绑定」。
 *   2. 来自局域网其它设备的请求，默认一律拒绝；只有携带本次启动随机生成的一次性
 *      令牌时才放行，且仅限互传功能自己需要的接口。
 */

const LOOPBACK_HOSTS = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "[::1]",
  "0.0.0.0",
]);

/** 允许局域网设备（手机）凭令牌访问的接口；其余接口局域网一律不可达 */
const LAN_ALLOWED_PATHS = ["/api/transfer", "/api/transfer/download"];

export const LAN_TOKEN_COOKIE = "furinakit_lan_token";
export const LAN_TOKEN_HEADER = "x-furinakit-token";

/**
 * 本次启动的局域网互传令牌。
 *
 * Electron 可以用 FURINAKIT_LAN_TOKEN 指定；未指定时（例如直接 `pnpm dev`）本进程
 * 随机生成一个。界面本身是「本机 + 同源」，可以通过 /api/lan-token 读到它并拼进二维码，
 * 手机扫码后就带着这个令牌访问互传接口。局域网上的其它设备没有令牌，一律被拒绝。
 */
const RUNTIME_LAN_TOKEN = randomBytes(24).toString("hex");

export function getLanToken(): string {
  const fromEnv = (process.env.FURINAKIT_LAN_TOKEN || "").trim();
  return fromEnv || RUNTIME_LAN_TOKEN;
}

function hostnameOf(value: string | null | undefined): string | null {
  if (!value) return null;
  let v = value.trim().toLowerCase();
  if (!v) return null;
  // 允许传入带协议的完整 URL（Origin 用）
  const schemeIdx = v.indexOf("://");
  if (schemeIdx !== -1) {
    v = v.slice(schemeIdx + 3);
  }
  // 去掉 userinfo（http://user@host 这类，注意别被 @ 骗过）
  const atIdx = v.lastIndexOf("@");
  if (atIdx !== -1) {
    v = v.slice(atIdx + 1);
  }
  // 去掉路径/查询
  v = v.split("/")[0].split("?")[0];
  // 去掉端口（注意 IPv6 的 [::1]:3001 形式）
  if (v.startsWith("[")) {
    const close = v.indexOf("]");
    return close === -1 ? v : v.slice(0, close + 1);
  }
  const colon = v.indexOf(":");
  if (colon !== -1) {
    v = v.slice(0, colon);
  }
  return v;
}

function isLoopbackHostname(host: string | null): boolean {
  if (!host) return false;
  return LOOPBACK_HOSTS.has(host);
}

function readCookie(req: Request, name: string): string | null {
  const raw = req.headers.get("cookie");
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return null;
}

export function extractRequestToken(req: Request): string | null {
  try {
    const url = new URL(req.url);
    const fromQuery = url.searchParams.get("t");
    if (fromQuery) return fromQuery;
  } catch {
    // 忽略解析失败
  }
  const fromHeader = req.headers.get(LAN_TOKEN_HEADER);
  if (fromHeader) return fromHeader.trim();
  return readCookie(req, LAN_TOKEN_COOKIE);
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function deny(reason: string): NextResponse {
  return NextResponse.json(
    { success: false, error: "拒绝访问：该请求来源未被授权", reason },
    { status: 403 },
  );
}

export type GuardOptions = {
  /** 该接口是否允许局域网设备凭令牌访问（仅互传功能需要） */
  allowLanToken?: boolean;
};

/**
 * 校验一次 API 请求。
 * @returns 通过时返回 null；不通过时返回应当直接回给客户端的 403 响应。
 */
export function guardApiRequest(req: Request, options: GuardOptions = {}): NextResponse | null {
  let pathname = "";
  try {
    pathname = new URL(req.url).pathname;
  } catch {
    return deny("bad_request_url");
  }

  const host = hostnameOf(req.headers.get("host") ?? req.headers.get("x-forwarded-host"));

  // ── 门 1：本机访问 → 必须是同源发起 ──
  if (isLoopbackHostname(host)) {
    const origin = req.headers.get("origin");
    if (origin) {
      // Origin 存在时（跨域请求、以及同源的 POST 都会带）必须也是本机
      const originHost = hostnameOf(origin);
      if (!isLoopbackHostname(originHost)) {
        return deny("cross_origin_origin_header");
      }
    }
    // 浏览器会带 Sec-Fetch-Site；恶意网页对我方发起的请求一律是 cross-site
    const site = req.headers.get("sec-fetch-site");
    if (site === "cross-site") {
      return deny("cross_site");
    }
    return null;
  }

  // ── 门 2：局域网（或 Host 伪造/缺失）访问 → 仅互传接口 + 有效令牌 ──
  const lanAllowed =
    options.allowLanToken === true ||
    LAN_ALLOWED_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));

  if (lanAllowed) {
    const expected = getLanToken();
    const provided = extractRequestToken(req);
    if (expected && provided && timingSafeEqual(provided, expected)) {
      return null;
    }
    return deny(expected ? "lan_token_mismatch" : "lan_disabled");
  }

  return deny("lan_not_allowed");
}
