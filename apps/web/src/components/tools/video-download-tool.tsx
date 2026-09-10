"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useRef, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Download, ExternalLink, AlertCircle,
  RefreshCw, Play,
  Loader2, CheckCircle2, XCircle, Film, Music, Image as LucideImage,
  ClipboardPaste, Trash2, FolderOpen,
} from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

// 视频信息类型
interface VideoInfo {
  title: string;
  duration: number;
  durationText: string;
  thumbnail: string;
  uploader: string;
  qualities: Array<{ height: number; label: string; format_id: string }>;
  url: string;
}

// 任务状态类型
interface JobState {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress: number;
  message: string;
  resultFilename?: string;
  error?: string;
}

export function VideoDownloadTool({ toolId }: { toolId: string }) {
  // 通用视频下载使用 webview 嵌入 datatool.vip
  if (toolId === "video-download") {
    return <WebViewDownloader />;
  }

  // B站和推特下载器使用先解析后下载的表单
  return <ParseThenDownload toolId={toolId} />;
}

// ========== 通用视频下载：内置 webview 嵌入 datatool.vip（原生 DOM 层级，永不遮挡弹窗） ==========
function WebViewDownloader() {
  const { theme } = useTheme();
  const [darkFilter, setDarkFilter] = useState(true);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [mounted, setMounted] = useState(false);
  const webviewRef = useRef<any>(null);

  const isElectron = typeof window !== "undefined" && Boolean((window as any).furinakit);

  useEffect(() => {
    setMounted(true);
  }, []);

  // webview 事件监听
  useEffect(() => {
    if (!isElectron || !mounted) {
      setLoading(false);
      return;
    }

    const wv = webviewRef.current;
    if (!wv) return;

    const handleDidStart = () => {
      setLoading(true);
      setLoadError(false);
    };

    const handleDidStop = () => {
      setLoading(false);
      setLoadError(false);
    };

    const handleFailLoad = (e: any) => {
      // 忽略请求取消 (-3) 等无害错误
      if (e.errorCode === -3) return;
      console.warn("[webview] 加载异常:", e);
      setLoadError(true);
      setLoading(false);
    };

    const handleNewWindow = (e: any) => {
      if (e.url && (e.url.startsWith("http://") || e.url.startsWith("https://"))) {
        // 如果是媒体链接、下载链接或外部广告推广，调用系统默认浏览器打开或下载，绝不占用当前窗口
        if (typeof window !== "undefined" && (window as any).furinakit?.openExternal) {
          (window as any).furinakit.openExternal(e.url);
        } else {
          window.open(e.url, "_blank");
        }
      }
    };

    const handleWillNavigate = (e: any) => {
      if (!e.url) return;
      // 如果 webview 内试图直接导航到音视频文件或非当前网页，拦截到系统浏览器或下载，防止 webview/主窗口变成播放器
      const isMediaOrExternal =
        /\.(mp4|mp3|m4a|mkv|webm|flv|avi)(\?.*)?$/i.test(e.url) ||
        e.url.includes("download") ||
        (!e.url.includes("datatool.vip") && (e.url.startsWith("http://") || e.url.startsWith("https://")));
      if (isMediaOrExternal) {
        try {
          e.preventDefault();
        } catch {}
        if (typeof window !== "undefined" && (window as any).furinakit?.openExternal) {
          (window as any).furinakit.openExternal(e.url);
        } else {
          window.open(e.url, "_blank");
        }
      }
    };

    wv.addEventListener("did-start-loading", handleDidStart);
    wv.addEventListener("did-stop-loading", handleDidStop);
    wv.addEventListener("did-fail-load", handleFailLoad);
    wv.addEventListener("new-window", handleNewWindow);
    wv.addEventListener("will-navigate", handleWillNavigate);

    // 兜底超时处理：避免外部三方跟踪脚本卡住 loading 状态
    const fallbackTimer = setTimeout(() => {
      setLoading(false);
    }, 4500);

    return () => {
      clearTimeout(fallbackTimer);
      wv.removeEventListener("did-start-loading", handleDidStart);
      wv.removeEventListener("did-stop-loading", handleDidStop);
      wv.removeEventListener("did-fail-load", handleFailLoad);
      wv.removeEventListener("new-window", handleNewWindow);
      wv.removeEventListener("will-navigate", handleWillNavigate);
    };
  }, [isElectron, mounted]);

  const handleRefresh = () => {
    setLoading(true);
    setLoadError(false);
    if (isElectron && webviewRef.current) {
      try {
        webviewRef.current.reload();
      } catch {
        webviewRef.current.src = "https://www.datatool.vip/zh";
      }
      setTimeout(() => setLoading(false), 2500);
    }
  };

  const handleOpenExternal = () => {
    const url = "https://www.datatool.vip/zh";
    if (typeof window !== "undefined" && (window as any).furinakit?.openExternal) {
      (window as any).furinakit.openExternal(url);
    } else {
      window.open(url, "_blank");
    }
  };

  return (
    <div className="flex h-full flex-col gap-2.5">
      {/* 顶部控制栏卡片 */}
      <div className="flex items-center justify-between gap-2.5 rounded-2xl border border-border bg-card px-3.5 py-2.5 shadow-xs overflow-hidden">
        <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-xs">
          <span className="shrink-0 text-sm font-semibold text-foreground">全平台视频下载</span>
          <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary font-medium">
            datatool.vip
          </span>
          <span className="hidden sm:inline-block shrink-0 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-900 dark:text-amber-200 truncate max-w-[280px]">
            芙芙也没招了，平台反爬机制太强了555
          </span>
          <span className="shrink-0 rounded-lg border border-border/60 bg-muted/60 px-2 py-0.5 text-xs text-muted-foreground">
            首次使用需登录
          </span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {theme === "dark" && (
            <button
              onClick={() => setDarkFilter(!darkFilter)}
              className={cn(
                "flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs transition-all border",
                darkFilter
                  ? "border-primary/40 bg-primary/10 text-primary font-medium shadow-xs"
                  : "border-border bg-background text-muted-foreground hover:text-foreground"
              )}
              title="切换网页深色滤镜适配"
            >
              <span>{darkFilter ? "已开启深色适配" : "未开启深色适配"}</span>
            </button>
          )}
          <button
            onClick={handleRefresh}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground border border-transparent hover:border-border"
            title="刷新"
          >
            <RefreshCw className="h-4 w-4" />
          </button>
          <button
            onClick={handleOpenExternal}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground border border-transparent hover:border-border"
            title="在系统浏览器中打开"
          >
            <ExternalLink className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 网站容器：位于 DOM 内，窗口弹窗（如投喂赞赏、设置）可正常无损覆盖在其上方 */}
      <div className="relative flex-1 overflow-hidden rounded-2xl border border-border bg-card">
        {loading && !loadError && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-card/90 backdrop-blur-sm pointer-events-none">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">正在加载内置下载引擎...</p>
          </div>
        )}
        {loadError && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-card">
            <AlertCircle className="h-12 w-12 text-destructive" />
            <div className="text-center">
              <p className="text-base font-medium text-foreground">加载失败</p>
              <p className="mt-1 text-sm text-muted-foreground">无法连接到 datatool.vip，请检查网络或代理设置</p>
            </div>
            <Button onClick={handleRefresh} size="sm">
              <RefreshCw className="h-4 w-4 mr-1.5" />
              重新加载
            </Button>
          </div>
        )}

        {/* 仅在客户端挂载后渲染，保证 SSR 安全 */}
        {mounted && (
          isElectron ? (
            <webview
              ref={webviewRef}
              src="https://www.datatool.vip/zh"
              partition="persist:datatool"
              className="h-full w-full border-0 transition-all duration-300"
              allowpopups={true}
              useragent="Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
              style={{
                width: "100%",
                height: "100%",
                border: "none",
                filter: theme === "dark" && darkFilter ? "invert(0.9) hue-rotate(180deg)" : "none",
              }}
            />
          ) : (
            <iframe
              src="https://www.datatool.vip/zh"
              className="h-full w-full border-0 transition-all duration-300"
              title="datatool.vip"
              sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
              style={{
                filter: theme === "dark" && darkFilter ? "invert(0.9) hue-rotate(180deg)" : "none",
              }}
            />
          )
        )}
      </div>
    </div>
  );
}

// 将 yt-dlp 或后端返回的英文/技术性错误翻译为通俗友好的中文提示
function localizeVideoErrorMessage(raw?: string | null): string {
  if (!raw) return "操作失败";
  const lower = raw.toLowerCase();
  if (lower.includes("no video could be found in this tweet") || lower.includes("no media found")) {
    return "该推文中未找到视频或动图（可能仅包含纯文字、静态图片，或推文已被删除/设为仅关注者可见）";
  }
  if (lower.includes("from a protected account") || lower.includes("protected")) {
    return "该推文来自私密/上锁账号，无法直接提取";
  }
  if (lower.includes("rate limit exceeded") || lower.includes("rate-limited")) {
    return "推特/X 访问频率超限，请稍等片刻后再试";
  }
  if (lower.includes("http error 404") || lower.includes("not found")) {
    return "视频或推文不存在，链接可能失效或已被发布者删除";
  }
  if (lower.includes("http error 403") || lower.includes("forbidden")) {
    return "访问受限 (403 Forbidden)，内容可能需登录或已被平台风控保护";
  }
  if (lower.includes("http error 429") || lower.includes("too many requests")) {
    return "请求过于频繁被平台限流，请稍后再试";
  }
  if (lower.includes("http error 412")) {
    return "视频平台安全验证/反爬机制拦截，请稍后重试";
  }
  if (lower.includes("timeout") || lower.includes("timed out")) {
    return "获取视频信息超时，请检查网络连接或科学上网代理是否开启";
  }
  if (
    lower.includes("10061") ||
    lower.includes("connection refused") ||
    lower.includes("proxyerror") ||
    lower.includes("cannot connect to proxy")
  ) {
    return "代理连接失败，请确认系统代理/科学上网工具已正常开启并在运行";
  }
  if (lower.includes("private video") || lower.includes("sign in") || lower.includes("login")) {
    return "该内容为私密内容或需要登录账号后才能查看";
  }
  if (lower.includes("video unavailable") || lower.includes("removed")) {
    return "该视频已失效或已被作者删除";
  }
  if (lower.includes("is not available in your country") || lower.includes("geo-restricted")) {
    return "该视频受到地区版权限制，请尝试切换代理节点";
  }
  if (lower.includes("unsupported url")) {
    return "不支持该链接格式，请确认输入正确的视频或推文链接";
  }
  return raw.replace(/^ERROR:\s*(\[[^\]]+\]\s*)?([0-9]+:\s*)?/i, "");
}

// ========== B站/推特下载器：先解析后下载 ==========
function ParseThenDownload({ toolId }: { toolId: string }) {
  const [url, setUrl] = useState("");
  const [parsing, setParsing] = useState(false);
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [downloadType, setDownloadType] = useState<"video" | "audio" | "thumbnail">("video");
  const [quality, setQuality] = useState<string>("best");
  const [job, setJob] = useState<JobState | null>(null);
  const { toast } = useToast();

  const toolName = toolId === "bilibili-download" ? "B站" : toolId === "twitter-download" ? "推特" : "视频";

  // 解析视频链接
  const handleParse = async () => {
    if (!url.trim()) {
      toast({ title: "请输入链接", variant: "error" });
      return;
    }

    setParsing(true);
    setParseError(null);
    setVideoInfo(null);
    setJob(null);

    try {
      const res = await fetch("/api/video-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "解析失败");
      }

      setVideoInfo(data);
      setQuality(data.qualities?.[0]?.format_id || "best");
      toast({ title: "解析成功", description: data.title, variant: "success" });
    } catch (err) {
      const message = localizeVideoErrorMessage(err instanceof Error ? err.message : "解析失败");
      setParseError(message);
      toast({ title: "解析失败", description: message, variant: "error" });
    } finally {
      setParsing(false);
    }
  };

  // 开始下载
  const handleDownload = async () => {
    if (!videoInfo) return;

    try {
      const format = downloadType === "thumbnail" ? "thumbnail" : downloadType === "audio" ? "mp3" : "mp4";
      
      const formData = new FormData();
      formData.append("url", videoInfo.url);
      formData.append("format", format);
      formData.append("quality", downloadType === "video" ? quality : "best");
      const res = await fetch(`/api/tools/${toolId}`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "创建任务失败");
      }

      setJob({
        id: data.job.id,
        status: "pending",
        progress: 0,
        message: "任务已创建，等待处理...",
      });

      // 开始轮询任务状态
      pollJobStatus(data.job.id);
    } catch (err) {
      const message = localizeVideoErrorMessage(err instanceof Error ? err.message : "下载失败");
      toast({ title: "下载失败", description: message, variant: "error" });
    }
  };

  // 轮询任务状态
  const pollJobStatus = async (jobId: string) => {
    const poll = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        const data = await res.json();

        if (res.ok) {
          const localizedError = data.job.error ? localizeVideoErrorMessage(data.job.error) : undefined;
          setJob({
            id: data.job.id,
            status: data.job.status,
            progress: data.job.progress || 0,
            message: data.job.message || "处理中...",
            resultFilename: data.job.resultFilename,
            error: localizedError,
          });

          if (data.job.status === "completed") {
            toast({ title: "下载完成", description: data.job.resultFilename, variant: "success" });
            return;
          }

          if (data.job.status === "failed") {
            toast({ title: "下载失败", description: localizedError || "未知错误", variant: "error" });
            return;
          }
        }

        // 继续轮询
        setTimeout(poll, 1500);
      } catch {
        setTimeout(poll, 2000);
      }
    };

    poll();
  };

  // 下载结果文件
  const handleDownloadResult = async () => {
    if (!job?.resultFilename) return;

    try {
      const res = await fetch(`/api/jobs/${job.id}/download?download=1`);
      if (!res.ok) throw new Error("下载失败");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = job.resultFilename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast({ title: "下载已开始", description: job.resultFilename, variant: "success" });
    } catch {
      toast({ title: "下载失败", variant: "error" });
    }
  };

  return (
    <div className="space-y-5">
      {/* 链接输入区 */}
      <div className="space-y-3 rounded-2xl border border-border bg-card p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="text-sm font-semibold text-foreground">
            {toolName}视频链接
          </label>
          <div className="flex items-center gap-2">
            {toolId === "twitter-download" && (
              <span className="rounded-md bg-blue-500/10 px-2.5 py-0.5 text-xs text-blue-500 dark:text-blue-400 border border-blue-500/20">
                需开启系统科学上网/网络代理
              </span>
            )}
            <span className="text-xs text-muted-foreground">
              支持直接粘贴包含链接的分享文案，系统将自动提取
            </span>
          </div>
        </div>

        <div className="relative">
          <textarea
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
                e.preventDefault();
                if (!parsing && url.trim()) handleParse();
              }
            }}
            placeholder={
              toolId === "twitter-download"
                ? "粘贴推特 / X 视频链接，例如：https://x.com/username/status/... 或直接粘贴分享文案"
                : "粘贴 B站 视频链接，例如：https://www.bilibili.com/video/BV... 或 b23.tv 短链，支持带文字的分享文案"
            }
            rows={4}
            className="w-full resize-none rounded-xl border border-input bg-background/60 p-4 text-sm leading-relaxed text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:bg-background focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all"
          />
        </div>

        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={async () => {
                try {
                  if (typeof navigator !== "undefined" && navigator?.clipboard?.readText) {
                    const clip = await navigator.clipboard.readText();
                    if (clip) setUrl(clip);
                  }
                } catch {
                  // clipboard read fallback
                }
              }}
              className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <ClipboardPaste className="h-3.5 w-3.5" />
              一键粘贴
            </Button>
            {url && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setUrl("")}
                className="h-8 gap-1 text-xs text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
                清空
              </Button>
            )}
          </div>

          <Button
            onClick={handleParse}
            disabled={parsing || !url.trim()}
            size="default"
            className="h-9 px-5 gap-2 font-medium"
          >
            {parsing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4 fill-current" />
            )}
            <span>{parsing ? "正在解析视频..." : "开始解析"}</span>
          </Button>
        </div>

        {parseError && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">{parseError}</p>
          </div>
        )}
      </div>

      {/* 视频信息展示区 */}
      {videoInfo && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4 rounded-2xl border border-border bg-card p-5"
        >
          <div className="flex gap-4">
            {/* 封面 */}
            <div className="relative h-32 w-56 shrink-0 overflow-hidden rounded-lg bg-muted">
              {videoInfo.thumbnail ? (
                <img
                  src={videoInfo.thumbnail}
                  alt={videoInfo.title}
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                  referrerPolicy="no-referrer"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center">
                  <Film className="h-8 w-8 text-muted-foreground" />
                </div>
              )}
              {videoInfo.durationText && (
                <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1.5 py-0.5 text-xs text-white">
                  {videoInfo.durationText}
                </span>
              )}
            </div>

            {/* 信息 */}
            <div className="min-w-0 flex-1">
              <h3 className="line-clamp-2 text-base font-semibold text-foreground">
                {videoInfo.title}
              </h3>
              {videoInfo.uploader && (
                <p className="mt-1 text-sm text-muted-foreground">
                  上传者：{videoInfo.uploader}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {videoInfo.qualities?.map((q) => (
                  <span key={q.format_id} className="rounded-md bg-primary/10 px-2 py-0.5 text-xs text-primary">
                    {q.label}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* 下载选项 */}
          <div className="flex flex-col gap-4 border-t border-border pt-4 sm:flex-row sm:items-end">
            {/* 下载类型 */}
            <div className="flex-1">
              <label className="mb-2 block text-sm font-medium text-foreground">下载内容</label>
              <div className="flex gap-2">
                {[
                  { value: "video", label: "视频", icon: Film },
                  { value: "audio", label: "音频", icon: Music },
                  { value: "thumbnail", label: "封面", icon: LucideImage },
                ].map((opt) => (
                  <button
                    key={opt.value}
                    onClick={() => setDownloadType(opt.value as typeof downloadType)}
                    className={cn(
                      "flex flex-1 flex-col items-center gap-1 rounded-lg border px-3 py-2 transition-all",
                      downloadType === opt.value
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/50"
                    )}
                  >
                    <opt.icon className="h-4 w-4" />
                    <span className="text-xs">{opt.label}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 画质选择 */}
            {downloadType === "video" && videoInfo.qualities?.length > 0 && (
              <div className="w-full sm:w-40">
                <label className="mb-2 block text-sm font-medium text-foreground">画质</label>
                <select
                  value={quality}
                  onChange={(e) => setQuality(e.target.value)}
                  className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none"
                >
                  <option value="best">最高画质</option>
                  {videoInfo.qualities.map((q) => (
                    <option key={q.format_id} value={q.format_id}>
                      {q.label}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* 下载按钮 */}
            <div className="w-full sm:w-auto">
              <Button
                onClick={handleDownload}
                disabled={job?.status === "processing" || job?.status === "pending"}
                size="lg"
                className="w-full sm:w-auto sm:px-8"
              >
                <Download className="h-4 w-4" />
                {job?.status === "processing" || job?.status === "pending" ? "下载中..." : "开始下载"}
              </Button>
            </div>
          </div>
        </motion.div>
      )}

      {/* 下载进度 */}
      {job && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            "space-y-3 rounded-2xl border p-5",
            job.status === "completed"
              ? "border-success/30 bg-success/5"
              : job.status === "failed"
              ? "border-destructive/30 bg-destructive/5"
              : "border-border bg-card"
          )}
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {job.status === "completed" ? (
                <CheckCircle2 className="h-5 w-5 text-success" />
              ) : job.status === "failed" ? (
                <XCircle className="h-5 w-5 text-destructive" />
              ) : (
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              )}
              <span className="font-medium text-foreground">
                {job.status === "completed" ? "下载完成" : job.status === "failed" ? "下载失败" : "下载中"}
              </span>
            </div>
            <span className="text-sm text-muted-foreground">{job.progress}%</span>
          </div>

          {job.status !== "completed" && job.status !== "failed" && (
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${job.progress}%` }}
              />
            </div>
          )}

          <p className="text-sm text-muted-foreground">{job.message}</p>

          {job.error && (
            <p className="text-sm text-destructive">{job.error}</p>
          )}

          {job.status === "completed" && job.resultFilename && (
            <div className="flex gap-2">
              <Button onClick={handleDownloadResult} className="flex-1">
                <Download className="h-4 w-4 mr-1.5" />
                保存文件
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={async () => {
                  try {
                    const win = typeof window !== "undefined" ? (window as any).furinakit : null;
                    if (win?.openPath) {
                      const dirRes = await fetch("/api/output-dir");
                      const dirData = await dirRes.json();
                      if (dirData?.outputDir) {
                        win.openPath(dirData.outputDir);
                        return;
                      }
                    }
                    await fetch("/api/output-dir", { method: "POST" });
                  } catch {}
                }}
                className="gap-1.5"
                title="在资源管理器中打开输出目录"
              >
                <FolderOpen className="h-4 w-4 text-primary" />
                <span>打开保存目录</span>
              </Button>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
