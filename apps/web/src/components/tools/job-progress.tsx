"use client";

import { useState, useRef } from "react";
import { motion } from "framer-motion";
import {
  Download, Loader2, CheckCircle2, XCircle, Eye,
  Film, FileText, ExternalLink, Volume2, FolderOpen
} from "lucide-react";
import type { Job } from "@furinakit/shared";
import { Alert, Badge, ProgressBar } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

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
const VIDEO_EXTS = new Set(["mp4", "webm", "mkv", "mov", "avi", "flv"]);
const AUDIO_EXTS = new Set(["mp3", "wav", "aac", "flac", "m4a", "ogg", "opus", "wma"]);

export function JobProgress({
  job,
  isLoading,
  error,
  beforeUrl,
  beforeName,
  beforeSize,
  toolId,
}: JobProgressProps) {
  const { toast } = useToast();
  const [downloading, setDownloading] = useState(false);
  const [sliderPos, setSliderPos] = useState(50);
  const [showSliderView, setShowSliderView] = useState(true);
  const sliderRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

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
      const res = await fetch(`/api/jobs/${id}/download?download=1`);
      if (!res.ok) throw new Error("下载失败");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
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
        <span className="text-sm font-medium text-foreground">正在提交任务，请稍候…</span>
      </div>
    );
  }

  if (error && !job) {
    return <Alert variant="destructive">{error}</Alert>;
  }

  if (!job) return null;

  const done = job.status === "completed";
  const failed = job.status === "failed";

  const resultExt = job.resultFilename ? job.resultFilename.split(".").pop()?.toLowerCase() || "" : "";
  const isImage = IMAGE_EXTS.has(resultExt);
  const isVideo = VIDEO_EXTS.has(resultExt);
  const isAudio = AUDIO_EXTS.has(resultExt);
  const isPdf = resultExt === "pdf";
  const downloadUrl = job.id ? `/api/jobs/${job.id}/download` : "";

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
            <p className="text-xs font-semibold text-foreground">任务状态</p>
            <p className="text-sm text-muted-foreground">{job.message ?? "处理中…"}</p>
          </div>
        </div>
        <Badge variant={failed ? "outline" : "default"}>{STATUS_LABEL[job.status] ?? job.status}</Badge>
      </div>

      {!done && !failed && <ProgressBar value={job.progress} />}

      {job.error && <Alert variant="destructive">{job.error}</Alert>}

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
                      ? "画质放大镜对比（原图 vs 强化后）"
                      : "画质放大镜对比（原图 vs 处理后）"
                    : resultExt === "gif"
                    ? "GIF 动图生成预览"
                    : "处理结果图片预览"}
                </span>
                <div className="flex items-center gap-3">
                  {beforeUrl && (
                    <button
                      type="button"
                      onClick={() => setShowSliderView((v) => !v)}
                      className="text-[11px] text-primary hover:underline"
                    >
                      {showSliderView ? "切换为单图展示" : "开启对比放大镜"}
                    </button>
                  )}
                  <a
                    href={downloadUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-1 hover:text-primary transition-colors text-[11px]"
                  >
                    <ExternalLink className="h-3 w-3" /> 查看全高清大图
                  </a>
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
                      src={downloadUrl}
                      alt="强化后"
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
                        alt="原图"
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
                      原图 {beforeSize ? `(${Math.round(beforeSize / 1024)} KB)` : ""}
                    </span>
                    <span className="absolute top-3 right-3 rounded-lg bg-primary/90 px-2.5 py-1 text-[11px] font-semibold text-primary-foreground backdrop-blur-xs shadow-xs">
                      {toolId === "image-upscale" ? "✨ AI 强化后" : "处理后"}
                    </span>
                  </div>

                  {/* 底部滑块控制 */}
                  <div className="flex items-center gap-3 px-1 text-xs text-muted-foreground">
                    <span className="shrink-0">拖动滑块对比左右画质:</span>
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
                    src={downloadUrl}
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
                  视频生成预览
                </span>
                <span className="text-[11px] text-muted-foreground">{job.resultFilename}</span>
              </div>
              <div className="overflow-hidden rounded-lg border border-border/60 bg-black">
                <video
                  controls
                  preload="metadata"
                  src={downloadUrl}
                  className="w-full max-h-80 object-contain"
                >
                  您的浏览器暂不支持此视频播放。
                </video>
              </div>
            </div>
          )}

          {/* 音频预览 */}
          {isAudio && (
            <div className="space-y-2 rounded-xl border border-border/80 bg-background/50 p-4">
              <div className="flex items-center justify-between text-xs">
                <span className="flex items-center gap-1.5 font-semibold text-foreground">
                  <Volume2 className="h-4 w-4 text-primary animate-pulse" />
                  音频试听播放
                </span>
                <span className="rounded bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary uppercase">
                  {resultExt}
                </span>
              </div>
              <p className="text-xs text-muted-foreground truncate">{job.resultFilename}</p>
              <div className="pt-1">
                <audio
                  controls
                  src={downloadUrl}
                  className="w-full h-10 rounded-lg accent-primary"
                >
                  您的浏览器不支持音频播放。
                </audio>
              </div>
            </div>
          )}

          {/* PDF 预览卡片 */}
          {isPdf && (
            <div className="flex items-center justify-between rounded-xl border border-border/80 bg-background/50 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-red-500/10 text-red-500">
                  <FileText className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-sm font-semibold text-foreground">{job.resultFilename}</p>
                  <p className="text-xs text-muted-foreground">PDF 文档已准备就绪</p>
                </div>
              </div>
              <a
                href={downloadUrl}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:border-primary hover:text-primary transition-all"
              >
                <Eye className="h-3.5 w-3.5" /> 浏览器中打开
              </a>
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
                title="在系统资源管理器中打开输出目录"
              >
                <FolderOpen className="h-4 w-4 text-primary" />
                <span>打开输出文件夹</span>
              </button>
              <button
                onClick={(e) => download(e, job.id, job.resultFilename!)}
                disabled={downloading}
                className="sheen relative inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-all hover:brightness-110 active:scale-[0.98] disabled:opacity-50"
              >
                {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                <span>{downloading ? "下载中…" : "立即下载结果"}</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
