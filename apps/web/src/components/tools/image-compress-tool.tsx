"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload, Download, RefreshCw, CheckCircle2,
  Loader2, Sliders, ArrowRight, Eye, Trash2, Check,
  ImageIcon, FileArchive
} from "lucide-react";
import { Button, Input, Label, ProgressBar } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { Confetti } from "@/components/ui/confetti";
import { formatBytes, cn } from "@/lib/utils";

interface CompressItem {
  id: string;
  file: File;
  previewUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  originalSize: number;
  compressedBlob?: Blob;
  compressedUrl?: string;
  compressedSize?: number;
  /** 实际压缩产物的扩展名（可能与原文件不同，例如 PNG 转成了 JPEG） */
  compressedExt?: string;
  status: "pending" | "compressing" | "done" | "error";
  error?: string;
}

/** 该类型是否可能带有透明通道 */
function mayHaveAlpha(file: File): boolean {
  const t = (file.type || "").toLowerCase();
  return (
    t === "image/png" ||
    t === "image/webp" ||
    t === "image/gif" ||
    t === "image/avif" ||
    t === "image/tiff" ||
    t === "image/svg+xml"
  );
}

/** Blob 实际格式 → 扩展名，保证下载出来的文件名与内容一致 */
function extForMime(mime: string): string {
  const m = (mime || "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("webp")) return "webp";
  if (m.includes("avif")) return "avif";
  if (m.includes("gif")) return "gif";
  if (m.includes("bmp")) return "bmp";
  if (m.includes("tiff")) return "tiff";
  return "jpg";
}

/** 把文件名换成指定扩展名 */
function withExt(name: string, ext: string): string {
  const base = (name || "image").replace(/\.[^./\\]+$/, "");
  return `${base || "image"}.${ext}`;
}

/** 检查画布上是否真的存在半透明像素；取不到像素时保守地认为有 */
function canvasHasAlpha(ctx: CanvasRenderingContext2D, w: number, h: number): boolean {
  try {
    const data = ctx.getImageData(0, 0, w, h).data;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] < 255) return true;
    }
    return false;
  } catch {
    return true;
  }
}

// ==========================================================================
// 模块级缓存：离开页面（切到别的工具、回首页）再回来时，恢复输入、结果与参数。
//
// 为什么必须是模块级：File / Blob 无法序列化进 localStorage / sessionStorage，
// 而组件一卸载，useState 里的东西就全没了。做法与 fileHideCache、
// imagesToPdfCache、tool-runner 里的 toolDraftCache 保持一致。
//
// 为什么 object URL 也归缓存持有：预览图和压缩结果用的是 URL.createObjectURL 的链接。
// 以前在组件卸载时 revoke，用户切走再回来只剩「死图」和点了没反应的下载按钮 ——
// 链接已经被释放了。现在只在三种情况下释放：
//   ① 那份文件 / 结果被换成新的一份（用户重新选文件、重新压缩）
//   ② 用户清空 / 删除
//   ③ 缓存条目被淘汰
// 判断依据是「对象引用是否变化」（上一份快照的 URL 与新一份不同才释放），
// 而不是每次保存都释放 —— 每次保存都释放等于把正在用的链接掐断。
// ==========================================================================
interface CompressCacheEntry {
  items: CompressItem[];
  quality: number;
  maxWidth: number | "";
  comparingIndex: number;
  sliderPos: number;
}

const COMPRESS_CACHE_KEY = "image-compress";
/** 最多保留 6 个条目，与 tool-runner 的 TOOL_DRAFT_LIMIT 对齐；本工具只用一个 key，实际只占 1 份 */
const COMPRESS_CACHE_LIMIT = 6;
/** key → 条目，迭代顺序即最近使用顺序（先删再存），便于淘汰最旧的 */
const compressCache = new Map<string, CompressCacheEntry>();

const COMPRESS_CACHE_DEFAULTS = {
  quality: 75,
  maxWidth: "" as number | "",
  comparingIndex: 0,
  sliderPos: 50,
};

/** 释放单个条目占用的 object URL；预览与结果恰好是同一个链接时只释放一次 */
function releaseCompressItem(item: CompressItem): void {
  URL.revokeObjectURL(item.previewUrl);
  if (item.compressedUrl && item.compressedUrl !== item.previewUrl) {
    URL.revokeObjectURL(item.compressedUrl);
  }
}

/**
 * 给 items 拍一份浅拷贝快照。
 * 压缩流程是「原地改写 item 对象」（it.compressedUrl = url），如果缓存直接持有原对象，
 * 上一次保存的 URL 记录会被下一次压缩改写掉，于是「换了新结果」看起来像「没变」，
 * 旧链接就永远漏在那里了。浅拷贝把 URL 字段冻在保存的那一刻。
 */
function snapshotCompressItems(items: CompressItem[]): CompressItem[] {
  return items.map((it) => ({ ...it }));
}

/** 从缓存恢复输入项：再拷一份，避免运行期的原地改动写进缓存快照 */
function readCompressItems(): CompressItem[] {
  const cached = compressCache.get(COMPRESS_CACHE_KEY);
  if (!cached) return [];
  return snapshotCompressItems(cached.items).map((it) => ({
    ...it,
    // 离开时正在压缩的项不能永远转圈：回来时回退到「待处理」
    status: it.status === "compressing" ? "pending" : it.status,
  }));
}

/** 写入缓存：先释放被替换 / 被移除的 URL，再按最近使用顺序存入并做上限淘汰 */
function rememberCompressEntry(key: string, entry: CompressCacheEntry): void {
  const previous = compressCache.get(key);

  if (previous) {
    const nextById = new Map(entry.items.map((it) => [it.id, it]));
    previous.items.forEach((prevItem) => {
      const nextItem = nextById.get(prevItem.id);
      if (!nextItem) {
        // 用户删除单项 / 清空列表
        releaseCompressItem(prevItem);
        return;
      }
      // URL 字符串不同 ⇒ 这份预览 / 结果确实换成了新的一份（URL 与 Blob 一一对应）
      if (prevItem.previewUrl !== nextItem.previewUrl) {
        URL.revokeObjectURL(prevItem.previewUrl);
      }
      if (prevItem.compressedUrl && prevItem.compressedUrl !== nextItem.compressedUrl) {
        URL.revokeObjectURL(prevItem.compressedUrl);
      }
    });
  }

  // 先删再存：让 Map 的迭代顺序等于「最近使用顺序」
  compressCache.delete(key);
  compressCache.set(key, { ...entry, items: snapshotCompressItems(entry.items) });

  while (compressCache.size > COMPRESS_CACHE_LIMIT) {
    const oldestKey = compressCache.keys().next().value;
    if (oldestKey === undefined) break;
    const oldest = compressCache.get(oldestKey);
    if (oldest) oldest.items.forEach((it) => releaseCompressItem(it));
    compressCache.delete(oldestKey);
  }
}

export function ImageCompressTool() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 挂载时从模块级缓存恢复：切到别的工具 / 回首页再回来，输入、结果与参数都还在。
  // 恢复时直接复用缓存里存的 object URL，绝不重新 createObjectURL
  // （重建会立刻泄漏旧链接，而且没有任何意义）。
  const [items, setItems] = useState<CompressItem[]>(() => readCompressItems());
  const [quality, setQuality] = useState<number>(() => compressCache.get(COMPRESS_CACHE_KEY)?.quality ?? COMPRESS_CACHE_DEFAULTS.quality);
  const [maxWidth, setMaxWidth] = useState<number | "">(() => compressCache.get(COMPRESS_CACHE_KEY)?.maxWidth ?? COMPRESS_CACHE_DEFAULTS.maxWidth);
  const [comparingIndex, setComparingIndex] = useState<number>(() => compressCache.get(COMPRESS_CACHE_KEY)?.comparingIndex ?? COMPRESS_CACHE_DEFAULTS.comparingIndex);
  const [sliderPos, setSliderPos] = useState<number>(() => compressCache.get(COMPRESS_CACHE_KEY)?.sliderPos ?? COMPRESS_CACHE_DEFAULTS.sliderPos);
  const [isProcessing, setIsProcessing] = useState(false);
  const [confetti, setConfetti] = useState(0);

  // 离开本工具（组件卸载）时不做任何释放 —— 预览与结果的链接由缓存持有，
  // 这样回来时图片还在、下载按钮还能用。释放时机见 rememberCompressEntry()。
  useEffect(() => {
    rememberCompressEntry(COMPRESS_CACHE_KEY, { items, quality, maxWidth, comparingIndex, sliderPos });
  }, [items, quality, maxWidth, comparingIndex, sliderPos]);

  const handleFiles = (fileList: FileList | File[]) => {
    const valid = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (!valid.length) {
      toast({ title: "请选择有效的图片文件", variant: "error" });
      return;
    }

    const newItems: CompressItem[] = valid.map((file) => {
      const url = URL.createObjectURL(file);
      const item: CompressItem = {
        id: Math.random().toString(36).substring(2, 9),
        file,
        previewUrl: url,
        naturalWidth: 0,
        naturalHeight: 0,
        originalSize: file.size,
        status: "pending",
      };

      const img = new Image();
      img.onload = () => {
        setItems((prev) =>
          prev.map((it) =>
            it.id === item.id
              ? { ...it, naturalWidth: img.naturalWidth, naturalHeight: img.naturalHeight }
              : it
          )
        );
      };
      img.src = url;

      return item;
    });

    setItems((prev) => [...prev, ...newItems]);
  };

  // 这里不再手动 revoke URL：链接归缓存所有，删除后由 rememberCompressEntry
  // 的「上一份快照里有、新一份里没有」判定来释放，避免同一链接被释放两次。
  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((t) => t.id !== id));
  };

  const clearAll = () => {
    setItems([]);
  };

  // 纯客户端高保真快速压缩算法（基于 Canvas）
  const compressSingle = async (item: CompressItem, q: number, maxW?: number): Promise<{ blob: Blob; url: string; ext: string }> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        let w = img.naturalWidth;
        let h = img.naturalHeight;

        if (maxW && w > maxW) {
          // Math.max(1, ...) 防止极端长条图被算成 0 高，导致画布为空、压缩直接失败
          h = Math.max(1, Math.round((h * maxW) / w));
          w = maxW;
        }
        if (!w || !h) {
          reject(new Error("图片尺寸无效"));
          return;
        }

        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) {
          reject(new Error("创建画布失败"));
          return;
        }

        // 高质量图像平滑
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, w, h);

        // 之前只要「PNG 且质量 < 90」就会静默转成 JPEG：透明区域被编码成黑色，
        // 而文件名仍然是 .png。现在改为：原图可能带透明、且画布上确实存在半透明像素时，
        // 保留 PNG 不转换（画质与透明都不会丢）。
        const keepPng = mayHaveAlpha(item.file) && canvasHasAlpha(ctx, w, h);
        const outMime = keepPng ? "image/png" : "image/jpeg";

        if (!keepPng) {
          // 转 JPEG 前先垫一层白底，避免任何残留透明像素变成黑块
          ctx.clearRect(0, 0, w, h);
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
        }

        canvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error("图片压缩失败"));
              return;
            }
            const outUrl = URL.createObjectURL(blob);
            resolve({ blob, url: outUrl, ext: extForMime(blob.type || outMime) });
          },
          outMime,
          keepPng ? undefined : q / 100
        );
      };
      img.onerror = () => reject(new Error("图片加载失败"));
      img.src = item.previewUrl;
    });
  };

  const runCompress = async () => {
    if (!items.length) {
      toast({ title: "请先上传需要压缩的图片", variant: "error" });
      return;
    }

    setIsProcessing(true);
    const updated = [...items];

    for (let i = 0; i < updated.length; i++) {
      const it = updated[i];
      it.status = "compressing";
      setItems([...updated]);

      try {
        const { blob, url, ext } = await compressSingle(
          it,
          quality,
          typeof maxWidth === "number" && maxWidth > 0 ? maxWidth : undefined
        );
        it.compressedBlob = blob;
        it.compressedUrl = url;
        it.compressedSize = blob.size;
        it.compressedExt = ext;
        it.status = "done";
      } catch (err) {
        it.status = "error";
        it.error = err instanceof Error ? err.message : "压缩异常";
      }
      setItems([...updated]);
    }

    setIsProcessing(false);
    setConfetti((c) => c + 1);
    toast({ title: "压缩完成！", description: `已完成 ${items.length} 张图片压缩对比`, variant: "success" });
  };

  const downloadOne = (item: CompressItem) => {
    if (!item.compressedUrl) return;
    const a = document.createElement("a");
    a.href = item.compressedUrl;
    // 用压缩产物真实的格式来决定扩展名，避免"内容是 JPEG 但名字是 .png"
    const ext = item.compressedExt || item.file.name.split(".").pop() || "jpg";
    a.download = `compressed_${withExt(item.file.name, ext)}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const downloadAllZip = async () => {
    const doneItems = items.filter((it) => it.compressedBlob);
    if (!doneItems.length) return;

    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      doneItems.forEach((it) => {
        const ext = it.compressedExt || "jpg";
        zip.file(`compressed_${withExt(it.file.name, ext)}`, it.compressedBlob!);
      });
      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = url;
      a.download = `FurinaKit_Images_${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast({ title: "已打包下载压缩包", variant: "success" });
    } catch {
      toast({ title: "打包下载失败", variant: "error" });
    }
  };

  const totalOriginal = useMemo(() => items.reduce((acc, it) => acc + it.originalSize, 0), [items]);
  const totalCompressed = useMemo(
    () => items.reduce((acc, it) => acc + (it.compressedSize || it.originalSize), 0),
    [items]
  );
  const totalSaved = totalOriginal > 0 && totalCompressed < totalOriginal ? totalOriginal - totalCompressed : 0;
  const savedPercent = totalOriginal > 0 ? Math.round((totalSaved / totalOriginal) * 100) : 0;

  const currentComparing = items[comparingIndex] || items[0];

  return (
    <div className="space-y-6">
      {confetti > 0 && <Confetti key={confetti} />}

      {/* 参数控制栏 */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Sliders size={18} />
            </span>
            <div>
              <h3 className="text-sm font-bold text-foreground">压缩参数调节</h3>
              <p className="text-xs text-muted-foreground">实时调节画质与尺寸限制，即刻所见即所得对比</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="gap-1.5"
            >
              <Upload size={14} /> 添加图片
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                if (e.target.files) handleFiles(e.target.files);
                e.target.value = "";
              }}
            />
            {items.length > 0 && (
              <Button variant="ghost" size="sm" onClick={clearAll} className="text-muted-foreground hover:text-destructive">
                清空列表
              </Button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2 border-t border-border/60">
          {/* 质量滑块 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="text-foreground">压缩质量：{quality}%</span>
              <span className="text-muted-foreground">
                {quality >= 80 ? "✨ 高保真（适合精细摄影）" : quality >= 60 ? "平衡推荐（体积大幅缩减）" : "极小体积（网页加载加速）"}
              </span>
            </div>
            <input
              type="range"
              min={10}
              max={100}
              step={5}
              value={quality}
              onChange={(e) => setQuality(Number(e.target.value))}
              className="w-full accent-primary h-2 bg-muted rounded-lg cursor-pointer"
            />
          </div>

          {/* 最大宽度限制 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs font-semibold">
              <span className="text-foreground">最大宽度限制 (像素)</span>
              <span className="text-muted-foreground">{maxWidth ? `${maxWidth} px` : "保持原图宽度"}</span>
            </div>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                placeholder="例如: 1920 (为空保持原宽)"
                value={maxWidth}
                onChange={(e) => setMaxWidth(e.target.value ? Number(e.target.value) : "")}
                className="h-9 text-xs"
              />
              <div className="flex gap-1">
                {[1280, 1920].map((w) => (
                  <button
                    key={w}
                    type="button"
                    onClick={() => setMaxWidth(w)}
                    className="h-9 px-2 text-[11px] rounded-lg border border-border hover:border-primary text-muted-foreground hover:text-primary transition-colors"
                  >
                    {w}p
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-between pt-2">
          {/* 总体积统计 */}
          <div className="flex items-center gap-3 text-xs">
            <span className="text-muted-foreground">待处理: {items.length} 张</span>
            {totalOriginal > 0 && (
              <span className="font-semibold text-foreground">
                原总大小: {formatBytes(totalOriginal)}
              </span>
            )}
            {totalSaved > 0 && (
              <span className="font-bold text-emerald-500 bg-emerald-500/10 px-2 py-0.5 rounded-full">
                预计瘦身: -{formatBytes(totalSaved)} ({savedPercent}%)
              </span>
            )}
          </div>

          <Button
            onClick={runCompress}
            disabled={!items.length || isProcessing}
            className="gap-2 px-6"
          >
            {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            {isProcessing ? "正在压缩中…" : "开始智能压缩"}
          </Button>
        </div>
      </div>

      {/* 上传托盘区（无图片时） */}
      {items.length === 0 && (
        <div
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
          }}
          className="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border bg-card/60 p-12 text-center transition-all hover:border-primary/60 hover:bg-card cursor-pointer group"
        >
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary group-hover:scale-110 transition-transform mb-3">
            <Upload size={28} />
          </div>
          <p className="text-sm font-semibold text-foreground">点击或拖拽图片到此处</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm">
            支持 JPG、PNG、WebP 等格式，可批量拖入多张图片
          </p>
        </div>
      )}

      {/* 图片就绪：左右分栏对比与预览 */}
      {items.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* 左侧：画质滑块实时对比大视口 */}
          <div className="lg:col-span-8 rounded-2xl border border-border bg-card p-5 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Eye size={16} className="text-primary" />
                <span className="text-xs font-bold text-foreground">
                  画质放大镜对比（原图 vs 压缩后）
                </span>
              </div>
              {currentComparing && (
                <span className="text-xs text-muted-foreground truncate max-w-[200px]">
                  {currentComparing.file.name}
                </span>
              )}
            </div>

            {currentComparing && (
              <div className="space-y-3">
                {/* 交互式画质对比视口 */}
                <div
                  className="relative h-96 w-full overflow-hidden rounded-xl border border-border/80 bg-black/10 dark:bg-black/40 select-none flex items-center justify-center"
                  style={{
                    backgroundImage: "radial-gradient(circle, rgba(120,120,120,0.15) 1px, transparent 1px)",
                    backgroundSize: "20px 20px",
                  }}
                >
                  {/* 底层：压缩后的图 */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={currentComparing.compressedUrl || currentComparing.previewUrl}
                    alt="压缩图"
                    className="max-h-full max-w-full object-contain pointer-events-none"
                  />

                  {/* 顶层：原图（利用 clip-path 裁剪实现滑动对比） */}
                  <div
                    className="absolute inset-0 flex items-center justify-center overflow-hidden pointer-events-none"
                    style={{
                      clipPath: `inset(0 ${100 - sliderPos}% 0 0)`,
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={currentComparing.previewUrl}
                      alt="原图"
                      className="max-h-full max-w-full object-contain"
                    />
                  </div>

                  {/* 滑割线 */}
                  <div
                    className="absolute top-0 bottom-0 w-0.5 bg-primary shadow-[0_0_10px_rgba(0,0,0,0.5)] cursor-ew-resize flex items-center justify-center"
                    style={{ left: `${sliderPos}%` }}
                  >
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md text-[10px] font-bold">
                      ↔
                    </div>
                  </div>

                  {/* 左右标签提示 */}
                  <span className="absolute top-3 left-3 rounded-lg bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-xs">
                    原图: {formatBytes(currentComparing.originalSize)}
                  </span>
                  <span className="absolute top-3 right-3 rounded-lg bg-primary/90 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-xs">
                    压缩后: {formatBytes(currentComparing.compressedSize || currentComparing.originalSize)}
                    {currentComparing.compressedSize && (
                      <span className="ml-1 text-emerald-300 font-bold">
                        (-{Math.round(((currentComparing.originalSize - currentComparing.compressedSize) / currentComparing.originalSize) * 100)}%)
                      </span>
                    )}
                  </span>
                </div>

                {/* 滑动调节条 */}
                <div className="flex items-center gap-3 text-xs text-muted-foreground pt-1">
                  <span>拖动滑块对比左右画质：</span>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={sliderPos}
                    onChange={(e) => setSliderPos(Number(e.target.value))}
                    className="flex-1 accent-primary h-1.5 bg-muted rounded cursor-pointer"
                  />
                  <span className="w-10 text-right font-mono">{sliderPos}%</span>
                </div>
              </div>
            )}
          </div>

          {/* 右侧：压缩队列与下载管理 */}
          <div className="lg:col-span-4 rounded-2xl border border-border bg-card p-5 shadow-xs space-y-4 flex flex-col justify-between">
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-foreground">压缩队列 ({items.length})</span>
                {items.some((it) => it.status === "done") && (
                  <Button size="sm" variant="outline" onClick={downloadAllZip} className="h-7 text-xs gap-1">
                    <FileArchive size={13} /> 打包 ZIP
                  </Button>
                )}
              </div>

              <div className="max-h-[340px] overflow-y-auto space-y-2 pr-1 thin-scroll">
                {items.map((it, idx) => {
                  const isSelected = idx === comparingIndex;
                  const isDone = it.status === "done";
                  const saved = it.compressedSize ? it.originalSize - it.compressedSize : 0;
                  const percent = it.compressedSize ? Math.round((saved / it.originalSize) * 100) : 0;

                  return (
                    <div
                      key={it.id}
                      onClick={() => setComparingIndex(idx)}
                      className={cn(
                        "flex items-center justify-between gap-2.5 rounded-xl border p-2.5 text-xs transition-all cursor-pointer",
                        isSelected
                          ? "border-primary bg-primary/5 shadow-xs"
                          : "border-border/70 bg-background/50 hover:border-border hover:bg-background"
                      )}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={it.compressedUrl || it.previewUrl}
                          alt={it.file.name}
                          className="h-10 w-10 shrink-0 rounded-lg object-cover border border-border/80"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="font-semibold text-foreground truncate">{it.file.name}</p>
                          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mt-0.5">
                            <span>{formatBytes(it.originalSize)}</span>
                            {isDone && (
                              <>
                                <ArrowRight size={10} className="text-primary" />
                                <span className="font-bold text-primary">{formatBytes(it.compressedSize!)}</span>
                                <span className="text-emerald-500 font-semibold">(-{percent}%)</span>
                              </>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        {isDone && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              downloadOne(it);
                            }}
                            title="下载单张"
                            className="flex h-7 w-7 items-center justify-center rounded-lg text-primary hover:bg-primary/10 transition-colors"
                          >
                            <Download size={14} />
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeItem(it.id);
                          }}
                          title="删除"
                          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* 批量操作 */}
            {items.some((it) => it.status === "done") && (
              <div className="pt-3 border-t border-border/60">
                <Button onClick={downloadAllZip} className="w-full gap-2 font-semibold">
                  <Download size={15} /> 一键打包下载全部压缩图片
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
