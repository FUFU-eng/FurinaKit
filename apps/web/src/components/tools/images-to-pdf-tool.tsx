"use client";

import { useState, useCallback, useEffect, useMemo, useRef } from "react";
import { useDropzone } from "react-dropzone";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload, Trash2, RefreshCw, FileText, CheckCircle2,
  XCircle, Loader2, Download, AlertTriangle, Image as ImageIcon,
  Layers, FileArchive, Check, X
} from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { Confetti } from "@/components/ui/confetti";
import { cn, formatBytes } from "@/lib/utils";

type MergeMode = "merge" | "individual";
type PageSizeOption = "original" | "a4_portrait" | "a4_landscape";

interface FileItem {
  file: File;
  id: string;
  url?: string;
  width?: number;
  height?: number;
}

interface JobState {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress: number;
  message: string;
  resultFilename?: string;
  error?: string;
}

export function ImagesToPdfTool() {
  const [items, setItems] = useState<FileItem[]>([]);
  const [mergeMode, setMergeMode] = useState<MergeMode>("merge");
  const [pageSize, setPageSize] = useState<PageSizeOption>("a4_portrait");
  const [submitting, setSubmitting] = useState(false);
  const [job, setJob] = useState<JobState | null>(null);
  const { toast } = useToast();
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 清理内存中的 Object URL
  useEffect(() => {
    return () => {
      items.forEach((item) => {
        if (item.url) URL.revokeObjectURL(item.url);
      });
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [items]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newItems: FileItem[] = acceptedFiles.map((file) => {
      const url = URL.createObjectURL(file);
      const item: FileItem = {
        file,
        id: `${file.name}-${file.size}-${Math.random().toString(36).slice(2, 7)}`,
        url,
      };

      // 异步读取真实宽高以支持“图像尺寸”自然长宽比自适应
      if (file.type.startsWith("image/")) {
        const img = new Image();
        img.onload = () => {
          setItems((prev) =>
            prev.map((i) => (i.id === item.id ? { ...i, width: img.naturalWidth, height: img.naturalHeight } : i))
          );
        };
        img.src = url;
      }
      return item;
    });

    setItems((prev) => [...prev, ...newItems]);
    setJob(null);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple: true,
    accept: {
      "image/*": [".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".tiff", ".tif", ".bmp", ".svg"],
    },
  });

  const removeItem = (id: string) => {
    setItems((prev) => {
      const target = prev.find((i) => i.id === id);
      if (target?.url) URL.revokeObjectURL(target.url);
      return prev.filter((i) => i.id !== id);
    });
  };

  const clearAll = () => {
    items.forEach((item) => {
      if (item.url) URL.revokeObjectURL(item.url);
    });
    setItems([]);
    setJob(null);
  };

  const totalSize = useMemo(() => items.reduce((sum, item) => sum + item.file.size, 0), [items]);

  // 开始转换
  const handleStartConvert = async () => {
    if (items.length === 0) {
      toast({ title: "请先添加图片", variant: "error" });
      return;
    }

    setSubmitting(true);
    setJob(null);

    try {
      const formData = new FormData();
      items.forEach((item) => {
        formData.append("files", item.file);
      });

      const isOriginal = pageSize === "original";
      const isLandscape = pageSize === "a4_landscape";

      formData.append("page_size", isOriginal ? "original" : "a4");
      formData.append("orientation", isLandscape ? "landscape" : "portrait");
      formData.append("merge_mode", mergeMode);

      const res = await fetch("/api/tools/images-to-pdf", {
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
        progress: 10,
        message: "正在排队处理...",
      });

      pollJobStatus(data.job.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "提交失败";
      toast({ title: "转换失败", description: msg, variant: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  // 轮询任务
  const pollJobStatus = async (jobId: string) => {
    const poll = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        const data = await res.json();

        if (res.ok && data.job) {
          setJob({
            id: data.job.id,
            status: data.job.status,
            progress: data.job.progress || 0,
            message: data.job.message || "处理中...",
            resultFilename: data.job.resultFilename,
            error: data.job.error,
          });

          if (data.job.status === "completed") {
            toast({ title: "转换成功", description: data.job.resultFilename, variant: "success" });
            return;
          }
          if (data.job.status === "failed") {
            toast({ title: "转换失败", description: data.job.error || "未知错误", variant: "error" });
            return;
          }
        }
        pollTimerRef.current = setTimeout(poll, 1200);
      } catch {
        pollTimerRef.current = setTimeout(poll, 2000);
      }
    };
    poll();
  };

  const handleDownload = async () => {
    if (!job?.id) return;
    window.location.href = `/api/jobs/${job.id}/download`;
  };

  const isSmallBatch = items.length <= 30;

  return (
    <div className="space-y-6">
      {/* 顶部建议与大批量说明卡片 */}
      <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4 text-xs font-medium text-amber-900 dark:text-amber-200">
        <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
        <div className="leading-relaxed">
          <span className="font-semibold">批量使用建议：</span>
          建议单次导入 <span className="font-bold underline">100 张以内</span>。
          已完全解除数量限制，但一次性转换过多超大分辨率图片会占用较大系统内存与 CPU 负荷，且生成的超大 PDF 文件在部分手机或阅读器中可能会出现卡顿。
        </div>
      </div>

      {/* 控制面板（图 3 风格） */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-xs space-y-4">
        {/* 合并方式 */}
        <div className="flex flex-wrap items-center gap-4">
          <span className="w-20 text-sm font-semibold text-primary">合并方式</span>
          <div className="flex rounded-xl border border-border bg-secondary/50 p-1">
            <button
              type="button"
              onClick={() => setMergeMode("merge")}
              className={cn(
                "rounded-lg px-4 py-1.5 text-xs font-medium transition-all",
                mergeMode === "merge"
                  ? "bg-card text-primary shadow-xs border border-border"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              合并文件
            </button>
            <button
              type="button"
              onClick={() => setMergeMode("individual")}
              className={cn(
                "rounded-lg px-4 py-1.5 text-xs font-medium transition-all",
                mergeMode === "individual"
                  ? "bg-card text-primary shadow-xs border border-border"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              独立文件
            </button>
          </div>
          <span className="text-xs text-muted-foreground">
            {mergeMode === "merge" ? "所有图片按顺序合并为一个完整 PDF" : "每张图片生成一个单独的 PDF（自动打包为 ZIP）"}
          </span>
        </div>

        {/* 页面尺寸 */}
        <div className="flex flex-wrap items-center justify-between gap-4 pt-1">
          <div className="flex flex-wrap items-center gap-4">
            <span className="w-20 text-sm font-semibold text-primary">页面尺寸</span>
            <div className="flex rounded-xl border border-border bg-secondary/50 p-1">
              <button
                type="button"
                onClick={() => setPageSize("original")}
                className={cn(
                  "rounded-lg px-4 py-1.5 text-xs font-medium transition-all",
                  pageSize === "original"
                    ? "bg-card text-primary shadow-xs border border-border"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                图像尺寸
              </button>
              <button
                type="button"
                onClick={() => setPageSize("a4_portrait")}
                className={cn(
                  "rounded-lg px-4 py-1.5 text-xs font-medium transition-all",
                  pageSize === "a4_portrait"
                    ? "bg-card text-primary shadow-xs border border-border"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                竖版 A4
              </button>
              <button
                type="button"
                onClick={() => setPageSize("a4_landscape")}
                className={cn(
                  "rounded-lg px-4 py-1.5 text-xs font-medium transition-all",
                  pageSize === "a4_landscape"
                    ? "bg-card text-primary shadow-xs border border-border"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                横版 A4
              </button>
            </div>
            <span className="text-xs text-muted-foreground hidden md:inline">
              {pageSize === "original"
                ? "无白边，预览自适应每张图的原始长宽比例"
                : pageSize === "a4_portrait"
                ? "标准 A4 纵向排版，适合文档与竖屏照片"
                : "标准 A4 横向排版，适合宽屏图与摄影作品"}
            </span>
          </div>

          {/* 右侧主操作按钮组（图 3 风格） */}
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="default"
              onClick={clearAll}
              disabled={items.length === 0 || submitting}
              className="gap-1.5 border-border hover:border-destructive/40 hover:text-destructive text-muted-foreground"
            >
              <Trash2 className="h-4 w-4" />
              <span>清除队列</span>
            </Button>
            <Button
              type="button"
              onClick={handleStartConvert}
              disabled={items.length === 0 || submitting}
              size="default"
              className="gap-2 px-6 font-medium shadow-md"
            >
              {submitting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              <span>{submitting ? "正在提交..." : "开始转换"}</span>
            </Button>
          </div>
        </div>
      </div>

      {/* 拖拽上传区域 */}
      <div
        {...getRootProps()}
        className={cn(
          "group flex flex-col items-center justify-center rounded-2xl border-2 border-dashed p-7 text-center transition-all cursor-pointer",
          isDragActive
            ? "border-primary bg-primary/10 shadow-inner"
            : "border-border hover:border-primary/50 hover:bg-card/70 bg-card/40"
        )}
      >
        <input {...getInputProps()} />
        <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary text-muted-foreground group-hover:bg-primary/15 group-hover:text-primary transition-all">
          <Upload className="h-6 w-6" />
        </div>
        <p className="mt-3 text-sm font-semibold text-foreground">
          {isDragActive ? "松开即可载入图片" : "点击选择图片，或将图片批量拖拽到此处"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          支持 JPG、PNG、WebP、GIF、BMP、TIFF 等常见图片格式 · 支持批量导入无数量上限
        </p>
      </div>

      {/* 队列区域 */}
      {items.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-foreground">
                转换队列 ({items.length} 张图片)
              </span>
              <span className="text-xs text-muted-foreground">
                合计 {formatBytes(totalSize)}
              </span>
            </div>
            {isSmallBatch ? (
              <span className="text-xs text-primary font-medium">
                动态预览模式：
                {pageSize === "original"
                  ? "「图像尺寸」自适应原图真实长宽比"
                  : pageSize === "a4_portrait"
                  ? "「竖版 A4」纵向排版纸张预览 (1:1.414)"
                  : "「横版 A4」横向排版纸张预览 (1.414:1)"}
              </span>
            ) : (
              <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs text-primary font-medium">
                性能保护模式已激活
              </span>
            )}
          </div>

          {/* 小于等于 30 张：可视化缩略图预览队列，排版比例随横版/竖版/图像尺寸自适应联动 */}
          {isSmallBatch ? (
            <motion.div
              layout
              className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3.5"
            >
              {items.map((item, index) => {
                // 动态计算卡片长宽比：
                // 竖版 A4: 1 / 1.414 约 0.707
                // 横版 A4: 1.414 / 1 约 1.414
                // 图像尺寸: 根据图片真实宽高比渲染，若尚未加载完成则默认为 1:1 或自然包裹
                const imageRatio = item.width && item.height ? item.width / item.height : 1;
                const aspectStyle =
                  pageSize === "a4_portrait"
                    ? { aspectRatio: "1 / 1.414" }
                    : pageSize === "a4_landscape"
                    ? { aspectRatio: "1.414 / 1" }
                    : { aspectRatio: `${Math.max(0.5, Math.min(2, imageRatio))}` };

                return (
                  <motion.div
                    key={item.id}
                    layout
                    style={aspectStyle}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.2 }}
                    className={cn(
                      "group relative flex flex-col justify-between overflow-hidden rounded-xl border border-border bg-card p-2 shadow-xs transition-all hover:border-primary hover:shadow-md",
                      pageSize === "original" ? "bg-card/90" : "bg-card"
                    )}
                  >
                    {/* 纸张微衬底标识（在A4版面下表现出纸张页面的视觉感） */}
                    {pageSize !== "original" && (
                      <div className="absolute inset-1 rounded-lg border border-dashed border-border/40 pointer-events-none" />
                    )}

                    {/* 页码与删除按钮 */}
                    <div className="z-10 flex items-center justify-between w-full">
                      <span className="rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-mono text-white backdrop-blur-xs">
                        #{index + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        className="flex h-5 w-5 items-center justify-center rounded-md bg-black/60 text-white/80 transition-colors hover:bg-destructive hover:text-white backdrop-blur-xs"
                        title="移除此图"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>

                    {/* 图片预览 */}
                    <div className="relative flex-1 flex items-center justify-center p-1 overflow-hidden">
                      {item.url ? (
                        <img
                          src={item.url}
                          alt={item.file.name}
                          className="h-full w-full object-contain rounded transition-transform duration-200 group-hover:scale-105"
                        />
                      ) : (
                        <ImageIcon className="h-8 w-8 text-muted-foreground" />
                      )}
                    </div>

                    {/* 底部信息栏：文件名与尺寸/比例标识 */}
                    <div className="z-10 w-full truncate text-[11px] text-muted-foreground text-center pt-1 border-t border-border/50">
                      <span className="truncate block font-medium">{item.file.name}</span>
                      {item.width && item.height && pageSize === "original" && (
                        <span className="text-[9px] text-primary/80 font-mono block">
                          {item.width}×{item.height}
                        </span>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </motion.div>
          ) : (
            /* 超过 30 张：高效率极速模式，不渲染大量缩略图以杜绝浏览器卡顿 */
            <div className="rounded-2xl border border-border bg-card p-6 text-center space-y-3">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Layers className="h-6 w-6" />
              </div>
              <div>
                <p className="text-base font-semibold text-foreground">
                  已成功载入 {items.length} 张图片（合计 {formatBytes(totalSize)}）
                </p>
                <p className="mt-1 text-xs text-muted-foreground max-w-md mx-auto">
                  为保障系统的极速流畅，超过 30 张图片时已自动隐藏详细小图预览。所有图片均已就绪，点击上方「开始转换」即可直接一键生成！
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 转换进度与完成结果卡片 */}
      {job && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            "space-y-4 rounded-2xl border p-5 shadow-sm",
            job.status === "completed"
              ? "border-success/30 bg-success/5"
              : job.status === "failed"
              ? "border-destructive/30 bg-destructive/5"
              : "border-border bg-card"
          )}
        >
          {job.status === "completed" && <Confetti />}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              {job.status === "completed" ? (
                <CheckCircle2 className="h-5 w-5 text-success" />
              ) : job.status === "failed" ? (
                <XCircle className="h-5 w-5 text-destructive" />
              ) : (
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              )}
              <span className="font-semibold text-sm text-foreground">
                {job.status === "completed"
                  ? "转换完成"
                  : job.status === "failed"
                  ? "转换失败"
                  : "正在处理 PDF 转换..."}
              </span>
            </div>
            <span className="font-mono text-xs text-muted-foreground">{job.progress}%</span>
          </div>

          {job.status !== "completed" && job.status !== "failed" && (
            <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${job.progress}%` }}
              />
            </div>
          )}

          <p className="text-xs text-muted-foreground">{job.message}</p>

          {job.error && <p className="text-xs text-destructive">{job.error}</p>}

          {job.status === "completed" && job.resultFilename && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border">
              <span className="text-xs font-medium text-foreground">
                生成文件：{job.resultFilename}
              </span>
              <Button onClick={handleDownload} size="default" className="gap-2 px-6">
                <Download className="h-4 w-4" />
                <span>立即下载</span>
              </Button>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
