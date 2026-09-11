"use client";

import React, { useState, useRef, useEffect, useCallback, useMemo } from "react";
import JSZip from "jszip";
import {
  ZoomIn,
  Upload,
  Download,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Sparkles,
  Sliders,
  Trash2,
  ChevronsLeftRight,
  Layers,
  Clock,
  FolderOpen,
} from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { cn, formatBytes } from "@/lib/utils";
import { trackToolUsage } from "@/lib/analytics";

interface UpscaleItem {
  id: string;
  file: File;
  name: string;
  size: number;
  originalUrl: string;
  status: "idle" | "processing" | "completed" | "failed";
  progress: number;
  resultUrl?: string;
  resultFilename?: string;
  resultSize?: number;
  error?: string;
}

const MAX_FILES = 50;

const MODELS = [
  { id: "anime-x2", name: "动漫 2倍 (anime-x2)", scale: 2, desc: "二次元插画/动漫，速度快，画质纯净" },
  { id: "anime-x3", name: "动漫 3倍 (anime-x3)", scale: 3, desc: "二次元中高倍率，平衡细节与体积" },
  { id: "anime-x4", name: "动漫 4倍 (anime-x4)", scale: 4, desc: "动漫超高倍率极致放大，纹理丰富" },
  { id: "real-x4", name: "通用真实 4倍 (real-x4)", scale: 4, desc: "真人、写实摄影、通用场景抗噪与超分" },
];

// 模块级全局状态缓存：保持在页面跳转/返回间不丢失，避免用户切出后任务或已上传图片清空
export const upscaleStore = {
  items: [] as UpscaleItem[],
  selectedIndex: 0,
  selectedModel: "anime-x2",
  isProcessing: false,
  overallProgress: 0,
  sliderPos: 50,
  cancelRequested: false,
  listeners: new Set<() => void>(),

  subscribe(fn: () => void) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  },

  notify() {
    this.listeners.forEach((fn) => fn());
  },

  setItems(updater: UpscaleItem[] | ((prev: UpscaleItem[]) => UpscaleItem[])) {
    this.items = typeof updater === "function" ? updater(this.items) : updater;
    this.notify();
  },

  setSelectedIndex(idx: number | ((prev: number) => number)) {
    this.selectedIndex = typeof idx === "function" ? idx(this.selectedIndex) : idx;
    this.notify();
  },

  setSelectedModel(m: string) {
    this.selectedModel = m;
    this.notify();
  },

  setIsProcessing(v: boolean) {
    this.isProcessing = v;
    this.notify();
  },

  setOverallProgress(p: number) {
    this.overallProgress = p;
    this.notify();
  },

  setSliderPos(pos: number) {
    this.sliderPos = pos;
    this.notify();
  },

  removeItem(id: string) {
    const target = this.items.find((i) => i.id === id);
    if (target) {
      if (target.originalUrl) URL.revokeObjectURL(target.originalUrl);
      if (target.resultUrl) URL.revokeObjectURL(target.resultUrl);
    }
    this.items = this.items.filter((i) => i.id !== id);
    if (this.selectedIndex >= this.items.length) {
      this.selectedIndex = Math.max(0, this.items.length - 1);
    }
    this.notify();
  },

  clearAll() {
    this.items.forEach((item) => {
      if (item.originalUrl) URL.revokeObjectURL(item.originalUrl);
      if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
    });
    this.items = [];
    this.selectedIndex = 0;
    this.overallProgress = 0;
    this.isProcessing = false;
    this.cancelRequested = true;
    this.notify();
  },
};

export function ImageUpscaleTool() {
  const { toast } = useToast();
  const [, setTick] = useState(0);

  // 监听全局 store 更新
  useEffect(() => {
    return upscaleStore.subscribe(() => setTick((t) => t + 1));
  }, []);

  const items = upscaleStore.items;
  const selectedIndex = upscaleStore.selectedIndex;
  const selectedModel = upscaleStore.selectedModel;
  const isProcessing = upscaleStore.isProcessing;
  const overallProgress = upscaleStore.overallProgress;
  const sliderPos = upscaleStore.sliderPos;

  const [isDragging, setIsDragging] = useState(false);
  const compareContainerRef = useRef<HTMLDivElement>(null);

  const [externalJob, setExternalJob] = useState<{
    id: string;
    status: string;
    progress: number;
    message: string;
    resultFilename?: string;
    error?: string;
  } | null>(null);
  const extPollTimerRef = useRef<NodeJS.Timeout | null>(null);

  const pollExternalJob = useCallback((jobId: string) => {
    if (extPollTimerRef.current) clearTimeout(extPollTimerRef.current);
    try {
      sessionStorage.setItem("furina:job:image-upscale", jobId);
    } catch {}

    const poll = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        const data = await res.json();
        if (res.ok && data.job) {
          setExternalJob({
            id: data.job.id,
            status: data.job.status,
            progress: data.job.progress || 0,
            message: data.job.message || "超分计算中...",
            resultFilename: data.job.resultFilename,
            error: data.job.error,
          });
          if (data.job.status === "completed" || data.job.status === "failed") {
            return;
          }
        }
        extPollTimerRef.current = setTimeout(poll, 1200);
      } catch {
        extPollTimerRef.current = setTimeout(poll, 2000);
      }
    };
    poll();
  }, []);

  // 页面挂载时自动恢复后台超分任务
  useEffect(() => {
    let unmounted = false;
    const restore = async () => {
      let jId: string | null = null;
      if (typeof window !== "undefined") {
        const sp = new URLSearchParams(window.location.search);
        jId = sp.get("jobId") || sessionStorage.getItem("furina:job:image-upscale");
      }
      if (!jId) {
        try {
          const r = await fetch("/api/jobs", { cache: "no-store" });
          const data = await r.json();
          const running = data?.jobs?.find(
            (j: { toolId?: string; status?: string; id?: string }) =>
              j.toolId === "image-upscale" &&
              (j.status === "processing" || j.status === "pending" || j.status === "queued")
          );
          if (running?.id) jId = running.id;
        } catch {}
      }
      if (!jId || unmounted) return;
      pollExternalJob(jId);
    };

    restore();

    const handleSelectJob = (e: Event) => {
      const detail = (e as CustomEvent<{ toolId?: string; jobId?: string }>).detail;
      if (detail?.toolId === "image-upscale" && detail?.jobId) {
        pollExternalJob(detail.jobId);
      }
    };
    window.addEventListener("furinakit:select-job", handleSelectJob);
    return () => {
      unmounted = true;
      window.removeEventListener("furinakit:select-job", handleSelectJob);
      if (extPollTimerRef.current) clearTimeout(extPollTimerRef.current);
    };
  }, [pollExternalJob]);

  // 处理滑块拖拽
  const updateSliderPos = useCallback((clientX: number) => {
    if (!compareContainerRef.current) return;
    const rect = compareContainerRef.current.getBoundingClientRect();
    const pos = ((clientX - rect.left) / rect.width) * 100;
    upscaleStore.setSliderPos(Math.min(100, Math.max(0, pos)));
  }, []);

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    updateSliderPos(e.clientX);
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length > 0) {
      setIsDragging(true);
      updateSliderPos(e.touches[0].clientX);
    }
  };

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (isDragging) updateSliderPos(e.clientX);
    };
    const handleTouchMove = (e: TouchEvent) => {
      if (isDragging && e.touches.length > 0) updateSliderPos(e.touches[0].clientX);
    };
    const handleMouseUp = () => setIsDragging(false);

    if (isDragging) {
      window.addEventListener("mousemove", handleMouseMove);
      window.addEventListener("mouseup", handleMouseUp);
      window.addEventListener("touchmove", handleTouchMove);
      window.addEventListener("touchend", handleMouseUp);
    }
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      window.removeEventListener("touchmove", handleTouchMove);
      window.removeEventListener("touchend", handleMouseUp);
    };
  }, [isDragging, updateSliderPos]);

  // 添加文件（上限 50 张）
  const handleAddFiles = (fileList: FileList | File[]) => {
    const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return;

    upscaleStore.setItems((prev) => {
      const remainingSlots = MAX_FILES - prev.length;
      if (remainingSlots <= 0) {
        toast({ title: `已达到最大上限 ${MAX_FILES} 张`, variant: "error" });
        return prev;
      }
      const toAdd = files.slice(0, remainingSlots);
      if (files.length > remainingSlots) {
        toast({
          title: "文件数量超出上限",
          description: `单次最多支持 ${MAX_FILES} 张图片，已自动截取前 ${toAdd.length} 张`,
          variant: "info",
        });
      }

      const newItems: UpscaleItem[] = toAdd.map((file, idx) => ({
        id: `img_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 7)}`,
        file,
        name: file.name,
        size: file.size,
        originalUrl: URL.createObjectURL(file),
        status: "idle",
        progress: 0,
      }));

      return [...prev, ...newItems];
    });
  };

  // 键盘快捷键切换对比图片
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (items.length <= 1) return;
      if (e.key === "ArrowLeft") {
        upscaleStore.setSelectedIndex((i) => Math.max(0, i - 1));
      } else if (e.key === "ArrowRight") {
        upscaleStore.setSelectedIndex((i) => Math.min(items.length - 1, i + 1));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [items.length]);

  // 执行单张图片的超分任务
  const runUpscaleSingle = async (
    item: UpscaleItem,
    model: string,
    scale: number
  ): Promise<{ url: string; filename: string; size: number }> => {
    const formData = new FormData();
    formData.append("file", item.file);
    formData.append("model", model);
    formData.append("scale", String(scale));

    const res = await fetch("/api/tools/image-upscale", {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.error || `请求失败 (${res.status})`);
    }

    const jobData = await res.json();
    const jobId = jobData?.id || jobData?.job?.id;
    if (!jobId) throw new Error("未能获取到任务编号");
    try {
      sessionStorage.setItem("furina:job:image-upscale", jobId);
    } catch {}

    // 轮询直到完成
    while (!upscaleStore.cancelRequested) {
      await new Promise((r) => setTimeout(r, 1000));
      const pollRes = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
      if (!pollRes.ok) continue;
      const pollData = await pollRes.json();
      const job = pollData.job;
      if (!job) continue;

      if (job.status === "failed") {
        throw new Error(job.error || "超分计算失败");
      }

      if (job.status === "completed") {
        const downloadRes = await fetch(`/api/jobs/${jobId}/download`);
        if (!downloadRes.ok) throw new Error("下载超分结果失败");
        const blob = await downloadRes.blob();
        const url = URL.createObjectURL(blob);
        const filename = `${item.name.replace(/\.[^.]+$/, "")}_upscaled.png`;
        return { url, filename, size: blob.size };
      }
    }

    throw new Error("任务已取消");
  };

  // 开始批量强化
  const handleStartBatch = async () => {
    if (items.length === 0 || isProcessing) return;
    trackToolUsage("image-upscale");
    upscaleStore.setIsProcessing(true);
    upscaleStore.cancelRequested = false;
    upscaleStore.setOverallProgress(0);

    const modelObj = MODELS.find((m) => m.id === selectedModel) || MODELS[0];
    const total = items.length;

    // 默认对比第一张
    upscaleStore.setSelectedIndex(0);

    let completedCount = 0;

    for (let i = 0; i < total; i++) {
      if (upscaleStore.cancelRequested) break;

      const current = items[i];
      if (current.status === "completed") {
        completedCount++;
        upscaleStore.setOverallProgress(Math.floor((completedCount / total) * 100));
        continue;
      }

      // 标记为处理中
      upscaleStore.setItems((prev) =>
        prev.map((item, idx) => (idx === i ? { ...item, status: "processing", progress: 20 } : item))
      );

      try {
        const result = await runUpscaleSingle(current, modelObj.id, modelObj.scale);
        completedCount++;

        upscaleStore.setItems((prev) =>
          prev.map((item, idx) =>
            idx === i
              ? {
                  ...item,
                  status: "completed",
                  progress: 100,
                  resultUrl: result.url,
                  resultFilename: result.filename,
                  resultSize: result.size,
                }
              : item
          )
        );

        if (completedCount === 1) {
          upscaleStore.setSelectedIndex(0);
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : "强化失败";
        upscaleStore.setItems((prev) =>
          prev.map((item, idx) =>
            idx === i ? { ...item, status: "failed", error: message } : item
          )
        );
      }

      upscaleStore.setOverallProgress(Math.floor((completedCount / total) * 100));
    }

    upscaleStore.setIsProcessing(false);
    toast({
      title: "批量强化处理完成",
      description: `成功 ${completedCount} / ${total} 张`,
      variant: completedCount > 0 ? "success" : "error",
    });
  };

  // 取消处理
  const handleCancel = () => {
    upscaleStore.cancelRequested = true;
    upscaleStore.setIsProcessing(false);
    toast({ title: "已停止后续批量处理", variant: "info" });
  };

  // 打包下载全部强化后图片
  const handleDownloadAll = async () => {
    const completedItems = items.filter((i) => i.status === "completed" && i.resultUrl);
    if (completedItems.length === 0) {
      toast({ title: "暂无已完成的强化图片", variant: "info" });
      return;
    }

    const zip = new JSZip();
    for (const item of completedItems) {
      if (!item.resultUrl) continue;
      const res = await fetch(item.resultUrl);
      const blob = await res.blob();
      zip.file(item.resultFilename || `${item.name}_upscaled.png`, blob);
    }

    const zipBlob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `upscaled_batch_${Date.now()}.zip`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };

  // 当前选中的对比项
  const currentItem = items[selectedIndex] || null;
  const completedCount = useMemo(() => items.filter((i) => i.status === "completed").length, [items]);

  return (
    <div className="space-y-6">
      {/* 顶部控制栏与模型配置 */}
      <div className="rounded-2xl border border-border bg-card p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h3 className="text-base font-bold text-foreground flex items-center gap-2">
              <Sparkles size={18} className="text-primary" />
              图片超分辨率强化 (Real-ESRGAN AI)
            </h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              支持单张与批量高清重绘放大，上限 50 张。配备智能前后对比滑块与快捷切换。
            </p>
          </div>

          <div className="flex items-center gap-2">
            {items.length > 0 && !isProcessing && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  upscaleStore.clearAll();
                  toast({ title: "已清空列表", variant: "info" });
                }}
                className="text-xs text-muted-foreground hover:text-red-400 gap-1.5"
              >
                <Trash2 size={13} />
                清空列表
              </Button>
            )}
            {completedCount > 0 && (
              <Button size="sm" onClick={handleDownloadAll} className="text-xs gap-1.5">
                <Download size={13} />
                打包下载已完成 ({completedCount})
              </Button>
            )}
          </div>
        </div>

        {/* 模型选择按钮组 */}
        <div className="space-y-2 pt-1">
          <span className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
            <Sliders size={13} />
            选择 AI 超分模型：
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5">
            {MODELS.map((m) => (
              <div
                key={m.id}
                onClick={() => !isProcessing && upscaleStore.setSelectedModel(m.id)}
                className={cn(
                  "rounded-xl border p-3 cursor-pointer transition-all duration-200 select-none",
                  selectedModel === m.id
                    ? "border-primary bg-primary/10 shadow-xs ring-1 ring-primary/40"
                    : "border-border bg-background/60 hover:border-border/80 hover:bg-muted/40",
                  isProcessing && "opacity-60 cursor-not-allowed"
                )}
              >
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-foreground">{m.name}</span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-primary/20 text-primary">
                    {m.scale}X
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground mt-1 line-clamp-1">{m.desc}</p>
              </div>
            ))}
          </div>
        </div>

        {/* 批量操作控制条 */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border">
          <div className="flex items-center gap-3">
            <label className="inline-flex items-center gap-2 rounded-xl border border-dashed border-border bg-muted/20 px-4 py-2 text-xs font-medium text-foreground cursor-pointer hover:border-primary/50 transition-colors">
              <Upload size={14} className="text-primary" />
              添加图片 (已选 {items.length} / {MAX_FILES})
              <input
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                disabled={isProcessing || items.length >= MAX_FILES}
                onChange={(e) => {
                  if (e.target.files) handleAddFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
            {isProcessing && (
              <div className="flex items-center gap-2 text-xs text-primary">
                <Loader2 size={14} className="animate-spin" />
                正在批量强化中 ({overallProgress}%)
              </div>
            )}
          </div>

          <div className="flex items-center gap-2">
            {isProcessing ? (
              <Button variant="destructive" size="sm" onClick={handleCancel}>
                停止批处理
              </Button>
            ) : (
              <Button
                size="sm"
                disabled={items.length === 0}
                onClick={handleStartBatch}
                className="gap-2 px-5 font-semibold"
              >
                <Sparkles size={14} />
                开始批量强化 ({items.length} 张)
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* 核心展示区：原图 vs 强化图丝滑对比框 */}
      {items.length > 0 && currentItem ? (
        <div className="space-y-4">
          <div className="rounded-2xl border border-border bg-card p-5 space-y-3">
            {/* 对比框顶部信息与下载按钮 */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs font-bold text-foreground truncate max-w-[280px]">
                  {currentItem.name}
                </span>
                <span className="text-[11px] text-muted-foreground">({formatBytes(currentItem.size)})</span>
                {currentItem.status === "completed" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2 py-0.5 text-[10px] font-semibold text-success">
                    <CheckCircle2 size={11} />
                    已强化 ({formatBytes(currentItem.resultSize || 0)})
                  </span>
                )}
                {currentItem.status === "processing" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
                    <Loader2 size={11} className="animate-spin" />
                    AI 强化计算中...
                  </span>
                )}
                {currentItem.status === "failed" && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-red-500/15 px-2 py-0.5 text-[10px] font-semibold text-red-400">
                    <AlertCircle size={11} />
                    处理失败
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                {currentItem.status === "completed" && currentItem.resultUrl && (
                  <a
                    href={currentItem.resultUrl}
                    download={currentItem.resultFilename || `${currentItem.name}_upscaled.png`}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground shadow hover:brightness-105 active:scale-95 transition-all"
                  >
                    <Download size={13} />
                    下载此图
                  </a>
                )}
                <div className="text-[11px] text-muted-foreground pl-2 font-mono">
                  {selectedIndex + 1} / {items.length}
                </div>
              </div>
            </div>

            {/* 对比画布主体 */}
            <div
              ref={compareContainerRef}
              onMouseDown={handleMouseDown}
              onTouchStart={handleTouchStart}
              className="relative aspect-video w-full max-h-[560px] overflow-hidden rounded-xl border border-border/80 bg-neutral-950 select-none cursor-ew-resize"
              style={{ touchAction: "none" }}
            >
              {/* 底层：强化后图片 (右侧) */}
              {currentItem.resultUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={currentItem.resultUrl}
                  alt="强化后"
                  className="absolute inset-0 h-full w-full object-contain pointer-events-none"
                />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center text-muted-foreground gap-2">
                  {currentItem.status === "processing" ? (
                    <>
                      <Loader2 size={32} className="animate-spin text-primary" />
                      <span className="text-xs text-primary">AI 神经网络高清重绘中...</span>
                    </>
                  ) : currentItem.status === "failed" ? (
                    <>
                      <AlertCircle size={32} className="text-red-400" />
                      <span className="text-xs text-red-400">{currentItem.error || "处理失败"}</span>
                    </>
                  ) : (
                    <>
                      <Clock size={32} className="text-muted-foreground/60" />
                      <span className="text-xs">等待强化处理，点击上方「开始批量强化」</span>
                    </>
                  )}
                </div>
              )}

              {/* 顶层裁切层：原图 (左侧) */}
              <div
                className="absolute inset-0 overflow-hidden pointer-events-none"
                style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={currentItem.originalUrl}
                  alt="原图"
                  className="absolute inset-0 h-full w-full object-contain"
                />
              </div>

              {/* 分割线与拖拽把柄 */}
              {currentItem.resultUrl && (
                <div
                  className="absolute top-0 bottom-0 z-20 pointer-events-none -translate-x-1/2"
                  style={{ left: `${sliderPos}%` }}
                >
                  <div className="h-full w-0.5 bg-white/90 shadow-[0_0_8px_rgba(0,0,0,0.8)]" />
                  <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-white text-neutral-900 shadow-xl border border-neutral-300">
                    <ChevronsLeftRight size={16} />
                  </div>
                </div>
              )}

              {/* 左上角与右上角标签提示 */}
              <div className="absolute top-3 left-3 z-10 pointer-events-none rounded-md bg-black/60 backdrop-blur-xs px-2 py-1 text-[10px] font-semibold text-white/90">
                原图 (原始画质)
              </div>
              {currentItem.resultUrl && (
                <div className="absolute top-3 right-3 z-10 pointer-events-none rounded-md bg-primary/80 backdrop-blur-xs px-2 py-1 text-[10px] font-semibold text-primary-foreground shadow">
                  ✨ AI 强化后 ({selectedModel})
                </div>
              )}
            </div>

            <div className="flex items-center justify-between text-[11px] text-muted-foreground pt-1">
              <span>💡 左右拖拽中间把柄对比画质变化；使用键盘 ← / → 方向键切换图片</span>
              <span>
                对比位置: {sliderPos.toFixed(0)}%
              </span>
            </div>
          </div>

          {/* 底部：全部 50 张图片无缝缩略图卡片切换带 */}
          <div className="rounded-2xl border border-border bg-card p-4 space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground mb-1">
              <span className="flex items-center gap-1.5">
                <Layers size={13} />
                批量图片列表 (点击任意缩略图即时切换对比)：
              </span>
              <span>
                已完成 {completedCount} / {items.length} 张
              </span>
            </div>

            <div className="flex items-center gap-2.5 overflow-x-auto pb-2 thin-scroll">
              {items.map((item, idx) => {
                const isSelected = idx === selectedIndex;
                return (
                  <div
                    key={item.id}
                    onClick={() => upscaleStore.setSelectedIndex(idx)}
                    className={cn(
                      "group relative flex-shrink-0 w-24 rounded-xl border p-1.5 cursor-pointer transition-all duration-200 bg-background select-none",
                      isSelected
                        ? "border-primary ring-2 ring-primary/50 shadow-md scale-102"
                        : "border-border hover:border-border/80 hover:bg-muted/30"
                    )}
                  >
                    <div className="relative aspect-square w-full rounded-lg overflow-hidden bg-muted/20">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={item.resultUrl || item.originalUrl}
                        alt={item.name}
                        className="h-full w-full object-cover"
                      />
                      {/* 状态徽标 */}
                      <div className="absolute bottom-1 right-1">
                        {item.status === "completed" && (
                          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-success text-white shadow">
                            <CheckCircle2 size={10} />
                          </span>
                        )}
                        {item.status === "processing" && (
                          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary text-white shadow">
                            <Loader2 size={10} className="animate-spin" />
                          </span>
                        )}
                        {item.status === "failed" && (
                          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-white shadow">
                            <AlertCircle size={10} />
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="mt-1 text-[10px] font-mono text-muted-foreground truncate" title={item.name}>
                      {idx + 1}. {item.name}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ) : (
        <div className="space-y-4">
          {/* 若检测到正在进行中或刚完成的后台单张/独立任务，展示任务卡片 */}
          {externalJob && (
            <div className="rounded-2xl border border-primary/40 bg-card p-5 space-y-3 shadow-md">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {externalJob.status === "completed" ? (
                    <CheckCircle2 className="h-5 w-5 text-success" />
                  ) : externalJob.status === "failed" ? (
                    <AlertCircle className="h-5 w-5 text-destructive" />
                  ) : (
                    <Loader2 className="h-5 w-5 animate-spin text-primary" />
                  )}
                  <div>
                    <h4 className="text-sm font-bold text-foreground">
                      {externalJob.status === "completed"
                        ? "图片强化完成"
                        : externalJob.status === "failed"
                        ? "图片强化失败"
                        : "AI 图像超分处理中"}
                    </h4>
                    <p className="text-xs text-muted-foreground">{externalJob.message}</p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {externalJob.status === "completed" && (
                    <>
                      <button
                        type="button"
                        onClick={async () => {
                          try {
                            const win = typeof window !== "undefined" ? (window as unknown as { furinakit?: { openPath?: (p: string) => Promise<unknown> } }).furinakit : null;
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
                        className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-secondary transition-all"
                      >
                        <FolderOpen size={13} className="text-primary" />
                        打开保存目录
                      </button>
                      <a
                        href={`/api/jobs/${externalJob.id}/download?download=1`}
                        download={externalJob.resultFilename || "upscaled.png"}
                        className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground shadow hover:brightness-105 active:scale-95 transition-all"
                      >
                        <Download size={13} />
                        立即下载结果
                      </a>
                    </>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setExternalJob(null)}
                    className="text-xs text-muted-foreground h-8"
                  >
                    关闭卡片
                  </Button>
                </div>
              </div>

              {externalJob.status === "processing" && (
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-300"
                    style={{ width: `${externalJob.progress}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {/* 空状态提示卡片 */}
          <div className="rounded-2xl border-2 border-dashed border-border bg-card/50 p-12 text-center space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
              <ZoomIn size={28} />
            </div>
            <div className="space-y-1">
              <h4 className="text-base font-bold text-foreground">尚未选择任何图片</h4>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                拖拽或选择最多 50 张图片文件至上方，开启 AI 批量超清放大与实时滑动对比
              </p>
            </div>
            <label className="inline-flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-xs font-semibold text-primary-foreground shadow cursor-pointer hover:brightness-105 active:scale-95 transition-all">
              <Upload size={14} />
              立即选择图片 (最多 50 张)
              <input
                type="file"
                multiple
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files) handleAddFiles(e.target.files);
                  e.target.value = "";
                }}
              />
            </label>
          </div>
        </div>
      )}
    </div>
  );
}
