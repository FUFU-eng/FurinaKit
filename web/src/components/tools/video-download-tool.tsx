"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/video-download-tool.tsx");

import { downloadJobResult } from "@/lib/job-download";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useRef, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Download, AlertCircle,
  Play,
  Loader2, CheckCircle2, XCircle, Film, Music, Image as LucideImage,
  ClipboardPaste, Trash2, FolderOpen, Sparkles,
} from "lucide-react";
import { Button, Select } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { EmbeddedVideoDownloader } from "./embedded-video-downloader";
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
  const __locale = __useLanguage();
  // 通用视频下载直接嵌入酷酷工具网站
  if (toolId === "video-download") {
    return <EmbeddedVideoDownloader />;
  }

  // B站和推特下载器使用先解析后下载的表单
  return <ParseThenDownload key={toolId} toolId={toolId} />;
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
  const __locale = __useLanguage();
  const [url, setUrl] = useState("");
  const [parsing, setParsing] = useState(false);
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);
  const [downloadType, setDownloadType] = useState<"video" | "audio" | "thumbnail">("video");
  const [quality, setQuality] = useState<string>("best");
  // 编码偏好：默认 H.264（任何播放器都能播）；目前只有 B站 提供 AV1 片源可选
  const [codec, setCodec] = useState<"h264" | "av1">("h264");
  const [job, setJob] = useState<JobState | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submissionLock = useRef(false);
  const interaction = useRef(0);
  const parseAbort = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const invalidateInteraction = () => {
    interaction.current += 1;
    parseAbort.current?.abort();
    setParsing(false);
  };
  const changeUrl = (next: string) => {
    invalidateInteraction();
    setUrl(next);
    setVideoInfo(null);
    setParseError(null);
  };
  const pollGeneration = useRef(0);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollAbort = useRef<AbortController | null>(null);
  const stopPolling = useCallback(() => {
    pollGeneration.current += 1;
    if (pollTimer.current) clearTimeout(pollTimer.current);
    pollAbort.current?.abort();
  }, []);
  const { toast } = useToast();

  const toolName =
    toolId === "bilibili-download"
      ? "B站"
      : toolId === "twitter-download"
        ? "推特"
        : "视频";
  // 只有 B站 提供 AV1 片源，推特/通用下载没有这个选择
  const codecSelectable = toolId === "bilibili-download";
  const needsProxy = toolId === "twitter-download";

  // 解析视频链接
  const handleParse = async () => {
    if (!url.trim()) {
      toast({ title: "请输入链接", variant: "error" });
      return;
    }

    invalidateInteraction();
    const generation = interaction.current;
    const controller = new AbortController();
    parseAbort.current = controller;
    stopPolling();
    setParsing(true);
    setParseError(null);
    setVideoInfo(null);
    setJob(null);

    try {
      const res = await fetch("/api/video-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: url.trim() }),
        signal: controller.signal,
      });

      const data = await res.json();
      if (generation !== interaction.current || controller.signal.aborted) return;

      if (!res.ok) {
        throw new Error(data.error || "解析失败");
      }

      setVideoInfo(data);
      setQuality("best");
      toast({ title: "解析成功", description: data.title, variant: "success" });
    } catch (err) {
      if (generation !== interaction.current || controller.signal.aborted) return;
      const message = localizeVideoErrorMessage(err instanceof Error ? err.message : "解析失败");
      setParseError(message);
      toast({ title: "解析失败", description: message, variant: "error" });
    } finally {
      if (generation === interaction.current) setParsing(false);
    }
  };

  // 开始下载
  const handleDownload = async () => {
    if (!videoInfo || submissionLock.current) return;
    submissionLock.current = true;
    invalidateInteraction();
    const generation = interaction.current;
    setSubmitting(true);
    try {
      const format = downloadType === "thumbnail" ? "thumbnail" : downloadType === "audio" ? "mp3" : "mp4";
      
      const formData = new FormData();
      formData.append("url", videoInfo.url);
      formData.append("format", format);
      formData.append("quality", downloadType === "video" ? quality : "best");
      formData.append("codec", codecSelectable ? codec : "h264");
      const res = await fetch(`/api/tools/${toolId}`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (generation !== interaction.current) return;

      if (!res.ok || !data.job?.id) {
        throw new Error(data.error || "创建任务失败");
      }

      setJob({
        id: data.job.id,
        status: "pending",
        progress: 0,
        message: "任务已创建，等待处理...",
      });
      try {
        sessionStorage.setItem(`furina:job:${toolId}`, data.job.id);
      } catch {}

      // 开始轮询任务状态
      pollJobStatus(data.job.id);
    } catch (err) {
      if (generation !== interaction.current) return;
      const message = localizeVideoErrorMessage(err instanceof Error ? err.message : "下载失败");
      toast({ title: "下载失败", description: message, variant: "error" });
    } finally {
      submissionLock.current = false;
      if (mounted.current) setSubmitting(false);
    }
  };

  // A single cancellable poll chain prevents old jobs overwriting the selected job.
  const pollJobStatus = useCallback((jobId: string) => {
    stopPolling();
    const generation = pollGeneration.current;
    let failures = 0;
    try { sessionStorage.setItem(`furina:job:${toolId}`, jobId); } catch {}
    const poll = async () => {
      if (generation !== pollGeneration.current) return;
      const controller = new AbortController();
      pollAbort.current = controller;
      try {
        const res = await fetch(`/api/jobs/${jobId}`, { signal: controller.signal });
        const data = await res.json();
        if (generation !== pollGeneration.current) return;
        if (!res.ok || !data.job || data.job.toolId !== toolId) {
          if (res.status === 404 || (data.job && data.job.toolId !== toolId)) {
            try { sessionStorage.removeItem(`furina:job:${toolId}`); } catch {}
            setJob(null);
            return;
          }
          throw new Error(data.error || "暂时无法读取下载状态");
        }
        failures = 0;
        const next = data.job;
        const error = next.error ? localizeVideoErrorMessage(next.error) : undefined;
        setJob({ id: next.id, status: next.status, progress: next.progress || 0,
          message: next.message || "处理中…", resultFilename: next.resultFilename, error });
        if (next.status === "completed" || next.status === "failed") return;
        pollTimer.current = setTimeout(poll, 1500);
      } catch {
        if (generation !== pollGeneration.current || controller.signal.aborted) return;
        failures += 1;
        if (failures === 3) toast({ title: "下载状态连接中断", description: "后台任务可能仍在运行，正在重新连接…", variant: "info" });
        pollTimer.current = setTimeout(poll, Math.min(10000, 2000 * failures));
      }
    };
    void poll();
  }, [toolId, toast, stopPolling]);

  // 页面挂载时自动恢复进行中的下载任务
  useEffect(() => {
    let unmounted = false;
    mounted.current = true;
    const generation = interaction.current;
    const restore = async () => {
      let jId: string | null = null;
      if (typeof window !== "undefined") {
        const sp = new URLSearchParams(window.location.search);
        jId = sp.get("jobId");
        if (!jId) { try { jId = sessionStorage.getItem(`furina:job:${toolId}`); } catch {} }
      }
      if (!jId) {
        try {
          const r = await fetch("/api/jobs", { cache: "no-store" });
          const data = await r.json();
          if (!r.ok) return;
          const running = data?.jobs?.find(
            (j: { toolId?: string; status?: string; id?: string }) =>
              j.toolId === toolId &&
              (j.status === "processing" || j.status === "pending" || j.status === "queued")
          );
          if (running?.id) jId = running.id;
        } catch {}
      }
      if (!jId || unmounted || generation !== interaction.current) return;
      pollJobStatus(jId);
    };

    restore();

    const handleSelectJob = (e: Event) => {
      const detail = (e as CustomEvent<{ toolId?: string; jobId?: string }>).detail;
      if (detail?.toolId === toolId && detail?.jobId) {
        invalidateInteraction();
        pollJobStatus(detail.jobId);
      }
    };
    window.addEventListener("furinakit:select-job", handleSelectJob);
    return () => {
      unmounted = true;
      mounted.current = false;
      interaction.current += 1;
      parseAbort.current?.abort();
      stopPolling();
      window.removeEventListener("furinakit:select-job", handleSelectJob);
    };
  }, [toolId, pollJobStatus, stopPolling]);

  // 下载结果文件
  const handleDownloadResult = async () => {
    if (!job?.resultFilename) return;

    try {
      if (!await downloadJobResult(job.id, job.resultFilename)) return;
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
            {__msg(toolName)}{__ui("视频链接")}</label>
          <div className="flex items-center gap-2">
            {needsProxy && (
              <span className="rounded-md bg-blue-500/10 px-2.5 py-0.5 text-xs text-blue-500 dark:text-blue-400 border border-blue-500/20">
                {__ui("需开启系统科学上网/网络代理")}</span>
            )}
            <span className="text-xs text-muted-foreground">
              {__ui("支持直接粘贴包含链接的分享文案，系统将自动提取")}</span>
          </div>
        </div>

        <div className="relative">
          <textarea
            value={url}
            onChange={(e) => changeUrl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey || !e.shiftKey)) {
                e.preventDefault();
                if (!parsing && url.trim()) handleParse();
              }
            }}
            placeholder={
              toolId === "twitter-download"
                ? __ui("粘贴推特 / X 视频链接，例如：https://x.com/username/status/... 或直接粘贴分享文案")
                : __ui("粘贴 B站 视频链接，例如：https://www.bilibili.com/video/BV... 或 b23.tv 短链，支持带文字的分享文案")
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
                const generation = interaction.current;
                try {
                  if (typeof navigator !== "undefined" && navigator?.clipboard?.readText) {
                    const clip = await navigator.clipboard.readText();
                    if (clip && mounted.current && generation === interaction.current) changeUrl(clip);
                  }
                } catch {
                  // clipboard read fallback
                }
              }}
              className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <ClipboardPaste className="h-3.5 w-3.5" />
              {__ui("一键粘贴")}</Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                if (toolId === "twitter-download") {
                  changeUrl("https://x.com/OpenAI/status/1758192957386342735");
                } else {
                  changeUrl("https://www.bilibili.com/video/BV1GJ411x7h7");
                }
              }}
              className="h-8 gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <Sparkles className="h-3.5 w-3.5" />
              {__ui("填入示例")}</Button>
            {url && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => changeUrl("")}
                className="h-8 gap-1 text-xs text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
                {__ui("清空")}</Button>
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
            <span>{parsing ? __ui("正在解析视频...") : __ui("开始解析")}</span>
          </Button>
        </div>

        {parseError && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="text-sm text-destructive">{__msg(parseError)}</p>
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
                  {__ui("上传者：")}{videoInfo.uploader}
                </p>
              )}
              <div className="mt-2 flex flex-wrap gap-2">
                {videoInfo.qualities?.map((q) => (
                  <span key={q.format_id} className="rounded-md bg-primary/10 px-2 py-0.5 text-xs text-primary">
                    {__ui(q.label)}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* 下载选项 */}
          <div className="flex flex-col gap-4 border-t border-border pt-4 sm:flex-row sm:items-end">
            {/* 下载类型 */}
            <div className="flex-1">
              <label className="mb-2 block text-sm font-medium text-foreground">{__ui("下载内容")}</label>
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
                    <span className="text-xs">{__ui(opt.label)}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 画质选择 */}
            {downloadType === "video" && videoInfo.qualities?.length > 0 && (
              <div className="w-full sm:w-44">
                <label className="mb-2 block text-sm font-medium text-foreground">{__ui("画质")}</label>
                {/* 注意：className 是加在 Select 的**外层容器**上的，边框/底色/高度要留给
                    组件自己的触发器 —— 外面再加一圈边框就变成"框中框"了（作者提过这个很丑） */}
                <Select
                  value={quality}
                  onChange={(e) => setQuality(e.target.value)}
                  className="w-full"
                >
                  <option value="best">{__ui("最高画质")}</option>
                  {videoInfo.qualities.map((q) => (
                    <option key={q.format_id} value={String(q.height)}>
                      {__ui(q.label)}
                    </option>
                  ))}
                </Select>
              </div>
            )}

            {/* 编码选择：yt-dlp 默认会挑 AV1（体积小一半，但老播放器打不开），
                做成两行点选而不是下拉 —— 下拉框放不下这么长的说明，用户也看不到区别 */}
            {downloadType === "video" && codecSelectable && (
              <div className="w-full sm:w-72">
                <label className="mb-1.5 block text-sm font-medium text-foreground">{__ui("视频编码")}</label>
                <div className="flex flex-col gap-[3px]">
                  {[
                    { v: "h264" as const, name: "H.264", desc: "任何播放器均可播放" },
                    { v: "av1" as const, name: "AV1", desc: "体积很小，老播放器可能不兼容" },
                  ].map((opt) => (
                    <button
                      key={opt.v}
                      type="button"
                      onClick={() => setCodec(opt.v)}
                      className={cn(
                        "flex items-center gap-2 rounded-lg border px-2.5 py-[3px] text-left transition-all",
                        codec === opt.v
                          ? "border-primary bg-primary/10"
                          : "border-border hover:border-primary/50",
                      )}
                    >
                      <span
                        className={cn(
                          "h-3 w-3 shrink-0 rounded-full border-2 transition-colors",
                          codec === opt.v ? "border-primary bg-primary" : "border-muted-foreground/50",
                        )}
                      />
                      <span className="shrink-0 text-[12px] font-medium text-foreground">{__msg(opt.name)}</span>
                      <span className="truncate text-[11px] leading-tight text-muted-foreground">{__ui(opt.desc)}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* 下载按钮 */}
            <div className="w-full sm:w-auto">
              <Button
                onClick={handleDownload}
                disabled={submitting || job?.status === "processing" || job?.status === "pending"}
                size="lg"
                className="w-full sm:w-auto sm:px-8"
              >
                <Download className="h-4 w-4" />
                {job?.status === "processing" || job?.status === "pending" ? __ui("下载中...") : __ui("开始下载")}
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
                {job.status === "completed" ? __ui("下载完成") : job.status === "failed" ? __ui("下载失败") : __ui("下载中")}
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

          <p className="text-sm text-muted-foreground">{__msg(job.message)}</p>

          {job.error && (
            <p className="text-sm text-destructive">{__msg(job.error)}</p>
          )}

          {job.status === "completed" && job.resultFilename && (
            <div className="flex gap-2">
              <Button onClick={handleDownloadResult} className="flex-1">
                <Download className="h-4 w-4 mr-1.5" />
                {__ui("保存文件")}</Button>
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
                title={__ui("在资源管理器中打开输出目录")}
              >
                <FolderOpen className="h-4 w-4 text-primary" />
                <span>{__ui("打开保存目录")}</span>
              </Button>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
