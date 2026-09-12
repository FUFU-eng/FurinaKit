import { NextResponse } from "next/server";
import { execFile, execSync } from "child_process";
import { promisify } from "util";
import path from "path";

const execFileAsync = promisify(execFile);

import { guardApiRequest } from "@/lib/api-guard";

export const runtime = "nodejs";

// 检测打包环境：优先使用环境变量指定的yt-dlp.exe，其次使用开发环境的python -m yt_dlp
const YTDLP_EXE = process.env.FURINAKIT_YTDLP_PATH || "";
const IS_PACKAGED = !!YTDLP_EXE;
const WORKER_PYTHON = path.resolve(
  process.cwd(),
  "../../services/worker/.venv/Scripts/python.exe"
);

// 模拟Chrome浏览器的user-agent，绕过B站等网站的反爬机制
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// 国内网站列表（这些网站不需要走代理，走代理反而可能触发反爬）
const DOMESTIC_SITES = [
  "bilibili.com", "b23.tv",
  "douyin.com", "iesdouyin.com",
  "ixigua.com", "toutiao.com",
  "youku.com", "youku.net",
  "iqiyi.com", "qiyi.com",
  "v.qq.com", "qq.com",
  "weibo.com", "weibo.cn",
  "zhihu.com",
  "xiaohongshu.com", "xhslink.com",
  "kuaishou.com", "gifshow.com",
  "mgtv.com",
  "acfun.cn",
  "pptv.com",
  "sohu.com", "tv.sohu.com",
];

// 检测是否是国内网站
function isDomesticSite(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase();
    return DOMESTIC_SITES.some(site => hostname === site || hostname.endsWith("." + site));
  } catch {
    return false;
  }
}

// 获取系统代理（从环境变量读取，main.js会自动设置）
// 国内网站不使用代理，避免触发反爬或连接问题
function getProxy(url: string): string | null {
  // 国内网站直连，不走代理
  if (isDomesticSite(url)) {
    console.log("[video-info] 国内网站，直连不走代理:", url);
    return null;
  }
  let proxy = null; // 优先从注册表读取，环境变量可能为空或不正确
  // 如果环境变量没有代理，从Windows注册表读取系统代理
  if (!proxy) {
    try {
      const result = execSync(
        'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyServer',
        { encoding: "utf-8", windowsHide: true }
      );
      const match = result.match(/ProxyServer\s+REG_SZ\s+(\S+)/);
      if (match) {
        const enableResult = execSync(
          'reg query "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings" /v ProxyEnable',
          { encoding: "utf-8", windowsHide: true }
        );
        const enableMatch = enableResult.match(/ProxyEnable\s+REG_DWORD\s+(0x[0-9a-fA-F]+|\d+)/);
        if (enableMatch && parseInt(enableMatch[1], 16) === 1) {
          const proxyAddr = match[1];
          proxy = proxyAddr.startsWith("http") ? proxyAddr : "http://" + proxyAddr;
        }
      }
    } catch (e) {}
  }
  if (proxy) {
    console.log("[video-info] 国外网站，使用代理:", proxy);
  } else {
    console.log("[video-info] 国外网站，未找到代理");
  }
  return proxy || null;
}

// 从带文字的分享内容中提取第一个有效URL
function extractUrl(text: string): string {
  if (!text) return text;
  text = text.trim();
  // 如果本身就是URL，直接返回
  if (/^https?:\/\//i.test(text)) {
    return text;
  }
  // 否则从文本中提取第一个URL
  const match = text.match(/https?:\/\/[^\s]+/i);
  if (match) {
    let url = match[0];
    // 清理URL末尾可能的标点符号
    url = url.replace(/[.,;:!?）)】」\]]+$/g, "");
    return url;
  }
  return text;
}

export async function POST(request: Request) {
  const denied = guardApiRequest(request);
  if (denied) return denied;
  try {
    const body = await request.json();
    const rawUrl = body.url;

    if (!rawUrl) {
      return NextResponse.json(
        { error: "请提供视频链接" },
        { status: 400 }
      );
    }

    // 从带文字的分享内容中提取URL
    const url = extractUrl(rawUrl);
    console.log("[video-info] 提取的URL:", url);

    // 获取代理（国内网站直连，国外网站走代理）
    const proxy = getProxy(url);

    // 调用yt-dlp获取视频信息
    let exePath: string;
    let args: string[];
    if (IS_PACKAGED) {
      exePath = YTDLP_EXE;
      args = [
        url,
        "--no-playlist",
        "--no-color",
        "--no-check-certificates",
        "--user-agent",
        DEFAULT_USER_AGENT,
        "--dump-single-json",
      ];
    } else {
      exePath = WORKER_PYTHON;
      args = [
        "-m",
        "yt_dlp",
        url,
        "--no-playlist",
        "--no-color",
        "--no-check-certificates",
        "--user-agent",
        DEFAULT_USER_AGENT,
        "--dump-single-json",
      ];
    }

    // 如果有代理，添加--proxy参数（最可靠的方式，不依赖yt-dlp自动识别环境变量）
    if (proxy) {
      args.push("--proxy", proxy);
    }

    const { stdout, stderr } = await execFileAsync(exePath, args, {
      maxBuffer: 10 * 1024 * 1024,
      timeout: 60000,
    });

    const info = JSON.parse(stdout);

    // 提取可用的画质选项
    const formats = info.formats || [];
    const qualities: Array<{ height: number; label: string; format_id: string }> = [];
    const seenHeights = new Set<number>();

    for (const fmt of formats) {
      const height = fmt.height;
      if (height && !seenHeights.has(height) && height >= 360) {
        seenHeights.add(height);
        qualities.push({
          height,
          label: `${height}p`,
          format_id: fmt.format_id,
        });
      }
    }

    qualities.sort((a, b) => b.height - a.height);

    // 格式化时长
    let durationText = "";
    if (info.duration) {
      const minutes = Math.floor(info.duration / 60);
      const seconds = Math.floor(info.duration % 60);
      durationText = `${minutes}:${seconds.toString().padStart(2, "0")}`;
    }

    return NextResponse.json({
      title: info.title || "未知标题",
      duration: info.duration,
      durationText,
      thumbnail: info.thumbnail,
      uploader: info.uploader,
      qualities,
      url,
    });
  } catch (error: unknown) {
    console.error("获取视频信息失败:", error);

    let rawError = "获取视频信息失败";
    const err = error as { stderr?: { toString: () => string }; message?: string };
    if (err.stderr) {
      rawError = err.stderr.toString();
    } else if (err.message) {
      rawError = err.message;
    }

    const lower = rawError.toLowerCase();
    let errorMessage = "视频解析失败，请检查链接或网络代理设置";

    if (lower.includes("no video could be found in this tweet") || lower.includes("no media found")) {
      errorMessage = "该推文中未找到视频或动图（可能仅包含纯文字、静态图片，或推文已被删除/设为仅关注者可见）";
    } else if (lower.includes("from a protected account") || lower.includes("protected")) {
      errorMessage = "该推文来自私密/上锁账号，无法直接提取";
    } else if (lower.includes("rate limit exceeded") || lower.includes("rate-limited")) {
      errorMessage = "推特/X 访问频率超限，请稍等片刻后再试";
    } else if (lower.includes("http error 404") || lower.includes("not found")) {
      errorMessage = "视频或推文不存在，链接可能失效或已被发布者删除";
    } else if (lower.includes("http error 403") || lower.includes("forbidden")) {
      errorMessage = "访问受限 (403 Forbidden)，内容可能需登录或已被平台风控保护";
    } else if (lower.includes("http error 429") || lower.includes("too many requests")) {
      errorMessage = "请求过于频繁被平台限流，请稍后再试";
    } else if (lower.includes("http error 412")) {
      errorMessage = "视频平台安全验证/反爬机制拦截，请稍后重试";
    } else if (lower.includes("timeout") || lower.includes("timed out")) {
      errorMessage = "获取视频信息超时，请检查网络连接或科学上网代理是否正常开启";
    } else if (
      lower.includes("10061") ||
      lower.includes("connection refused") ||
      lower.includes("proxyerror") ||
      lower.includes("cannot connect to proxy")
    ) {
      errorMessage = "代理连接失败，请确认系统代理/梯子软件已正常开启并在运行";
    } else if (lower.includes("private video") || lower.includes("sign in") || lower.includes("login")) {
      errorMessage = "该内容为私密内容或需要登录账号后才能查看";
    } else if (lower.includes("video unavailable") || lower.includes("removed")) {
      errorMessage = "该视频已失效或已被作者删除";
    } else if (lower.includes("is not available in your country") || lower.includes("geo-restricted")) {
      errorMessage = "该视频受到地区版权限制，请尝试切换代理节点";
    } else if (lower.includes("unsupported url")) {
      errorMessage = "不支持该链接格式，请确认输入正确的视频或推文链接";
    }

    return NextResponse.json(
      { error: errorMessage },
      { status: 500 }
    );
  }
}
