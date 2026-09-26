"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/job-progress.tsx");

import { AudioPreview } from "./audio-preview";
import { SeparatedAudioPreview } from "./separated-audio-preview";
import { OcrTextDownload } from "./ocr-text-download";
import { downloadJobResult } from "@/lib/job-download";

import { useState, useRef } from "react";
import { motion } from "framer-motion";
import {
  Download, Loader2, CheckCircle2, XCircle, Eye,
  Film, FileText, ExternalLink, Volume2, FolderOpen
} from "lucide-react";
import type { Job } from "@furinakit/shared";
import { Alert, Badge, ProgressBar } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { cn, formatBytes } from "@/lib/utils";
import { useJobPreviewUrl } from "@/lib/use-job-preview";

type JobProgressProps = {
  job: Job | null;
  isLoading?: boolean;
  error?: string | null;
  beforeUrl?: string;
  beforeName?: string;
  beforeSize?: number;
  toolId?: string;
};

const STATUS_LABEL: Record<string, string> = {
  pending: "排队中",
  processing: "处理中",
  completed: "已完成",
  failed: "失败",
};

const IMAGE_EXTS = new Set(["png", "jpg", "jpeg", "webp", "gif", "svg", "bmp", "ico", "avif"]);
// 含引擎实际会交付的容器：视频裁剪默认跟随源容器，所以 mkv/webm/mov/avi/flv/ts/wmv 都可能出现
const VIDEO_EXTS = new Set(["mp4", "m4v", "webm", "mkv", "mov", "avi", "flv", "wmv", "ts", "mpg", "mpeg"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "aac", "flac", "m4a", "ogg", "oga", "opus", "wma", "aiff", "aif", "amr"]);

export function JobProgress({
  job,
  isLoading,
  error,
  beforeUrl,
  beforeName,
  beforeSize,
  toolId,
}: JobProgressProps) {
  const __locale = __useLanguage();
  const { toast } = useToast();
  const [downloading, setDownloading] = useState(false);
  const [sliderPos, setSliderPos] = useState(50);
  const [showSliderView, setShowSliderView] = useState(true);
  const sliderRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);
  // ★ 预览不能直接 <img src="/api/...">：fetch-bridge 拦不到原生资源加载，
  //   桌面版里那是必挂的。这里经 fetch 取回 Blob 转 object URL。
  const previewExt = job?.resultFilename?.split(".").pop()?.toLowerCase() || "";
  const canPreview = IMAGE_EXTS.has(previewExt) || VIDEO_EXTS.has(previewExt) || AUDIO_EXTS.has(previewExt);
  const previewUrl = useJobPreviewUrl(job?.status === "completed" && canPreview ? job.id : null);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    isDraggingRef.current = true;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    updateSlider(e.clientX);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current) return;
    updateSlider(e.clientX);
  };

  const handlePointerUp = () => {
    isDraggingRef.current = false;
  };

  const updateSlider = (clientX: number) => {
    if (!sliderRef.current) return;
    const rect = sliderRef.current.getBoundingClientRect();
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setSliderPos(Math.max(0, Math.min(100, Math.round(pct))));
  };

  // 内部下载，避免点击后跳到浏览器页面
  const download = async (e: React.MouseEvent, id: string, filename: string) => {
    e.preventDefault();
    if (downloading) return;
    setDownloading(true);
    try {
      if (!await downloadJobResult(id, filename)) return;
      toast({ title: "下载已开始", description: filename, variant: "success" });
    } catch (err) {
      toast({
        title: "下载失败",
        description: err instanceof Error ? err.message : "请重试",
        variant: "error",
      });
    } finally {
      setDownloading(false);
    }
  };

  // 桌面版：后端把结果复制到临时预览目录并用 Edge / 默认程序打开（旧的 <a target=_blank> 在 WebView 里只会触发下载）
  const openInBrowser = async (id: string) => {
    try {
      if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke<string>("open_job_result", { jobId: id });
        return;
      }
      window.open(`/api/jobs/${encodeURIComponent(id)}/download`, "_blank", "noreferrer");
    } catch (err) {
      toast({ title: "打开失败", description: err instanceof Error ? err.message : String(err), variant: "error" });
    }
  };

  const handleOpenFolder = async () => {
    try {
      const win = typeof window !== "undefined" ? (window as unknown as { furinakit?: { openPath?: (p: string) => Promise<{ success?: boolean }> } }) : null;
      if (win?.furinakit?.openPath) {
        const dirRes = await fetch("/api/output-dir");
        const dirData = await dirRes.json();
        if (dirData?.outputDir) {
          const res = await win.furinakit.openPath(dirData.outputDir);
          if (res?.success) {
            toast({ title: "已在资源管理器中打开输出目录", variant: "success" });
            return;
          }
        }
      }

      const res = await fetch("/api/output-dir", { method: "POST" });
      const data = await res.json();
      if (data?.outputDir) {
        toast({ title: "已打开保存目录", description: data.outputDir, variant: "success" });
      } else {
        toast({ title: "未能打开目录", description: "请前往设置中查看输出目录位置", variant: "error" });
      }
    } catch (err) {
      toast({ title: "打开目录失败", description: String(err), variant: "error" });
    }
  };

  if (isLoading && !job) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-6">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <span className="text-sm font-medium text-foreground">{__ui("正在提交任务，请稍候…")}</span>
      </div>
    );
  }

  if (error && !job) {
    return <Alert variant="destructive">{__msg(error)}</Alert>;
  }

  if (!job) return null;

  const done = job.status === "completed";
  const failed = job.status === "failed";

  const resultExt = job.resultFilename ? job.resultFilename.split(".").pop()?.toLowerCase() || "" : "";
  const isImage = IMAGE_EXTS.has(resultExt);
  const isVideo = VIDEO_EXTS.has(resultExt);
  const isAudio = AUDIO_EXTS.has(resultExt);
  const isPdf = resultExt === "pdf";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "space-y-4 rounded-xl border bg-card p-5",
        done ? "border-success/30" : failed ? "border-destructive/30" : "border-border",
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {done ? (
            <CheckCircle2 className="h-4 w-4 text-success" />
          ) : failed ? (
            <XCircle className="h-4 w-4 text-destructive" />
          ) : (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          )}
          <div>
            <p className="text-xs font-semibold text-foreground">{__ui("任务状态")}</p>
            <p className="text-sm text-muted-foreground">{__msg(job.message) ?? __ui("处理中…")}</p>
          </div>
        </div>
        <Badge variant={failed ? "outline" : "default"}>{__ui(STATUS_LABEL[job.status]) ?? __msg(job.status)}</Badge>
      </div>

      {!done && !failed && <ProgressBar value={job.progress} />}

      {job.error && <Alert variant="destructive">{__msg(job.error)}</Alert>}

      {done && canPreview && !previewUrl && (
        <p className="text-xs text-muted-foreground">
          {__ui("正在准备预览。桌面版视频按需读取，播放和拖动定位无需先加载整个文件。")}</p>
      )}

      {/* 压缩类工具的诚实提示：结果不比原文件小就直说（video-compress 曾出现反而变大 18.8%） */}
      {done &&
        beforeSize &&
        (job as { resultBytes?: number }).resultBytes &&
        (job as { resultBytes?: number }).resultBytes! >= beforeSize &&
        (toolId ?? "").includes("compress") && (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11.5px] leading-relaxed text-amber-600 dark:text-amber-400">
            {__ui("提示：处理后的文件并不比原文件小（原")}{__msg(formatBytes(beforeSize))} {__ui("→ 结果")}{" "}
            {__msg(formatBytes((job as { resultBytes?: number }).resultBytes!))}{__ui("）。这类输入可能已经高度压缩过， 可以试试更低的画质/分辨率参数，或改用其他格式。")}</div>
        )}

      {/* 任务完成后的多媒体预览区域 */}
      {done && job.resultFilename && (
        <div className="space-y-3 pt-2">
          {/* 图片 / GIF 预览：支持原图 vs 强化/处理后画质放大镜对比 */}
          {isImage && (
            <div className="space-y-3 rounded-xl border border-border/80 bg-background/50 p-4">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5 font-medium text-foreground">
                  <Eye className="h-4 w-4 text-primary" />
                  {beforeUrl && showSliderView
                    ? toolId === "image-upscale"
                      ? __ui("画质放大镜对比（原图 vs 强化后）")
                      : __ui("画质放大镜对比（原图 vs 处理后）")
                    : resultExt === "gif"
                    ? __ui("GIF 动图生成预览")
                    : __ui("处理结果图片预览")}
                </span>
                <div className="flex items-center gap-3">
                  {beforeUrl && (
                    <button
                      type="button"
                      onClick={() => setShowSliderView((v) => !v)}
                      className="text-[11px] text-primary hover:underline"
                    >
                      {showSliderView ? __ui("切换为单图展示") : __ui("开启对比放大镜")}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => openInBrowser(job.id)}
                    className="flex items-center gap-1 hover:text-primary transition-colors text-[11px]"
                  >
                    <ExternalLink className="h-3 w-3" /> {__ui("查看全高清大图")}</button>
                </div>
              </div>

              {/* 对比滑块视图 */}
              {beforeUrl && showSliderView ? (
                <div className="space-y-3">
                  <div
                    ref={sliderRef}
                    onPointerDown={handlePointerDown}
                    onPointerMove={handlePointerMove}
                    onPointerUp={handlePointerUp}
                    onPointerCancel={handlePointerUp}
                    className="relative h-96 w-full cursor-ew-resize select-none overflow-hidden rounded-xl border border-border/80 bg-black/10 dark:bg-black/40 flex items-center justify-center shadow-inner"
                    style={{
                      backgroundImage: "radial-gradient(circle, rgba(120,120,120,0.15) 1px, transparent 1px)",
                      backgroundSize: "20px 20px",
                    }}
                  >
                    {/* 底层：强化/处理后高清图 */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={previewUrl || undefined}
                      alt={__ui("强化后")}
                      className="max-h-full max-w-full object-contain pointer-events-none"
                    />

                    {/* 顶层：原图（利用 clipPath 动态裁剪，随滑块展开） */}
                    <div
                      className="absolute inset-0 flex items-center justify-center overflow-hidden pointer-events-none"
                      style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={beforeUrl}
                        alt={__ui("原图")}
                        className="max-h-full max-w-full object-contain"
                      />
                    </div>

                    {/* 中间分割拖动条 */}
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-primary shadow-[0_0_12px_rgba(56,189,248,0.7)] pointer-events-none flex items-center justify-center"
                      style={{ left: `${sliderPos}%` }}
                    >
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-lg text-[10px] font-bold">
                        ↔
                      </div>
                    </div>

                    {/* 左右原图与结果徽标 */}
                    <span className="absolute top-3 left-3 rounded-lg bg-black/65 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-xs">
                      {__ui("原图")}{beforeSize ? `(${Math.round(beforeSize / 1024)} KB)` : ""}
                    </span>
                    <span className="absolute top-3 right-3 rounded-lg bg-primary/90 px-2.5 py-1 text-[11px] font-semibold text-primary-foreground backdrop-blur-xs shadow-xs">
                      {toolId === "image-upscale" ? __ui("✨ AI 强化后") : __ui("处理后")}
                    </span>
                  </div>

                  {/* 底部滑块控制 */}
                  <div className="flex items-center gap-3 px-1 text-xs text-muted-foreground">
                    <span className="shrink-0">{__ui("拖动滑块对比左右画质:")}</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={sliderPos}
                      onChange={(e) => setSliderPos(Number(e.target.value))}
                      className="h-1.5 flex-1 cursor-pointer rounded-lg bg-secondary accent-primary"
                    />
                    <span className="w-9 text-right font-mono">{sliderPos}%</span>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center overflow-hidden rounded-lg border border-border/60 bg-black/5 dark:bg-black/30 p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={previewUrl || undefined}
                    alt={job.resultFilename}
                    className="max-h-72 max-w-full rounded object-contain shadow-sm transition-transform hover:scale-[1.01]"
                  />
                </div>
              )}
            </div>
          )}

          {/* 视频预览 */}
          {isVideo && (
            <div className="space-y-2 rounded-xl border border-border/80 bg-background/50 p-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5 font-medium text-foreground">
                  <Film className="h-3.5 w-3.5 text-primary" />
                  {__ui("视频生成预览")}</span>
                <span className="text-[11px] text-muted-foreground">{job.resultFilename}</span>
              </div>
              <div className="overflow-hidden rounded-lg border border-border/60 bg-black">
                <video
                  controls
                  preload="metadata"
                  src={previewUrl || undefined}
                  className="w-full max-h-80 object-contain"
                >
                  {__ui("您的浏览器暂不支持此视频播放。")}</video>
              </div>
            </div>
          )}

          {/* Audio is previewed from managed job storage; saving remains an explicit action. */}
          {isAudio && <AudioPreview src={previewUrl} name={job.resultFilename} />}
          {job.toolId === "vocal-separate" && job.audioStems && <SeparatedAudioPreview jobId={job.id} />}

          {/* PDF 预览卡片 */}
          {isPdf && (
            <div className="flex items-center justify-between rounded-xl border border-border/80 bg-background/50 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/10 text-red-500">
                  <FileText className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{job.resultFilename}</p>
                  <p className="text-xs text-muted-foreground">{__ui("PDF 文档已准备就绪")}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => openInBrowser(job.id)}
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:border-primary hover:text-primary transition-all"
              >
                <Eye className="h-3.5 w-3.5" /> {__ui("浏览器中打开")}</button>
            </div>
          )}

          {/* 下载与目录操作按钮栏 */}
          <div className="flex items-center justify-between pt-1 gap-3">
            <span className="text-xs text-muted-foreground truncate max-w-[40%]">
              {job.resultFilename}
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleOpenFolder}
                className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-border bg-secondary/50 px-3 text-xs font-medium text-foreground transition-all hover:bg-secondary hover:border-primary/40 active:scale-[0.98]"
                title={__ui("在系统资源管理器中打开输出目录")}
              >
                <FolderOpen className="h-4 w-4 text-primary" />
                <span>{__ui("打开输出文件夹")}</span>
              </button>
              {job.status === "completed" && job.toolId === "ocr-pdf" && <OcrTextDownload jobId={job.id} filename={job.textResultFilename} />}
              <button
                onClick={(e) => download(e, job.id, job.resultFilename!)}
                disabled={downloading}
                className="sheen relative inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
              >
                {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                <span>{downloading ? __ui("下载中…") : __ui("立即下载结果")}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
