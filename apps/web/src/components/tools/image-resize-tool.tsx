"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  Upload, Download, Trash2, Sliders, CheckCircle2,
  Loader2, RefreshCw, FileArchive, Plus,
  AlertCircle
} from "lucide-react";
import { Button, Input, Label, Select } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { Confetti } from "@/components/ui/confetti";
import { formatBytes, cn } from "@/lib/utils";
import { consumePendingFiles } from "@/lib/file-handoff";

interface ResizeFileItem {
  id: string;
  file: File;
  previewUrl: string;
  name: string;
  size: number;
  width: number;
  height: number;
  status: "pending" | "processing" | "done" | "skipped" | "error";
  targetWidth?: number;
  targetHeight?: number;
  resultBlob?: Blob;
  resultUrl?: string;
  resultSize?: number;
  error?: string;
}

type ScaleType = "percent" | "dimension";
type DimensionMode = "fixed" | "width" | "height" | "max_side" | "min_side";
type FitMode = "crop" | "stretch";

export function ImageResizeTool() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // File queue
  const [items, setItems] = useState<ResizeFileItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [confetti, setConfetti] = useState(0);

  // Settings
  const [scaleType, setScaleType] = useState<ScaleType>("dimension");
  const [percent, setPercent] = useState<number>(50);

  const [dimensionMode, setDimensionMode] = useState<DimensionMode>("fixed");
  const [targetWidth, setTargetWidth] = useState<number>(1000);
  const [targetHeight, setTargetHeight] = useState<number>(1000);
  const [skipSmall, setSkipSmall] = useState<boolean>(true);
  const [fitMode, setFitMode] = useState<FitMode>("crop");
  const [outputFormat, setOutputFormat] = useState<"original" | "jpeg" | "png" | "webp">("original");

  const itemsRef = useRef<ResizeFileItem[]>(items);
  itemsRef.current = items;

  // 接收从全局拖拽或其他工具移交的文件
  useEffect(() => {
    const pending = consumePendingFiles();
    if (pending && pending.length > 0) {
      handleFiles(pending);
    }
  }, []);

  // 监听全窗口拖拽放开，直接向本工具添加图片
  useEffect(() => {
    const onWindowDragOver = (e: DragEvent) => {
      if (Array.from(e.dataTransfer?.types ?? []).includes("Files")) {
        e.preventDefault();
      }
    };
    const onWindowDrop = (e: DragEvent) => {
      const files = Array.from(e.dataTransfer?.files ?? []);
      const valid = files.filter((f) => f.type.startsWith("image/"));
      if (valid.length > 0) {
        e.preventDefault();
        e.stopPropagation();
        handleFiles(valid);
      }
    };
    window.addEventListener("dragover", onWindowDragOver);
    window.addEventListener("drop", onWindowDrop);
    return () => {
      window.removeEventListener("dragover", onWindowDragOver);
      window.removeEventListener("drop", onWindowDrop);
    };
  }, []);

  // Clean up object URLs on unmount
  useEffect(() => {
    return () => {
      itemsRef.current.forEach((item) => {
        URL.revokeObjectURL(item.previewUrl);
        if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
      });
    };
  }, []);

  const handleFiles = (fileList: FileList | File[]) => {
    const valid = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (!valid.length) {
      toast({ title: "请选择有效的图片文件", variant: "error" });
      return;
    }

    valid.forEach((file) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        setItems((prev) => [
          ...prev,
          {
            id: `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
            file,
            previewUrl: url,
            name: file.name,
            size: file.size,
            width: img.naturalWidth,
            height: img.naturalHeight,
            status: "pending",
          },
        ]);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
      };
      img.src = url;
    });
  };

  const removeItem = (id: string) => {
    setItems((prev) => {
      const item = prev.find((it) => it.id === id);
      if (item) {
        URL.revokeObjectURL(item.previewUrl);
        if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
      }
      return prev.filter((it) => it.id !== id);
    });
  };

  const clearAll = () => {
    items.forEach((item) => {
      URL.revokeObjectURL(item.previewUrl);
      if (item.resultUrl) URL.revokeObjectURL(item.resultUrl);
    });
    setItems([]);
  };

  // Target size calculation per image
  const computeTargetSize = (w: number, h: number) => {
    if (scaleType === "percent") {
      const ratio = Math.max(1, percent) / 100;
      return {
        w: Math.max(1, Math.round(w * ratio)),
        h: Math.max(1, Math.round(h * ratio)),
        skipped: false,
      };
    }

    let tw = w;
    let th = h;
    let skipped = false;

    if (dimensionMode === "fixed") {
      if (skipSmall && w <= targetWidth && h <= targetHeight) {
        skipped = true;
      } else {
        tw = targetWidth;
        th = targetHeight;
      }
    } else if (dimensionMode === "width") {
      if (skipSmall && w <= targetWidth) {
        skipped = true;
      } else {
        tw = targetWidth;
        th = Math.round((h / w) * targetWidth);
      }
    } else if (dimensionMode === "height") {
      if (skipSmall && h <= targetHeight) {
        skipped = true;
      } else {
        th = targetHeight;
        tw = Math.round((w / h) * targetHeight);
      }
    } else if (dimensionMode === "max_side") {
      const maxSide = Math.max(w, h);
      if (skipSmall && maxSide <= targetWidth) {
        skipped = true;
      } else {
        const r = targetWidth / maxSide;
        tw = Math.round(w * r);
        th = Math.round(h * r);
      }
    } else if (dimensionMode === "min_side") {
      const minSide = Math.min(w, h);
      if (skipSmall && minSide <= targetWidth) {
        skipped = true;
      } else {
        const r = targetWidth / minSide;
        tw = Math.round(w * r);
        th = Math.round(h * r);
      }
    }

    return {
      w: Math.max(1, tw),
      h: Math.max(1, th),
      skipped,
    };
  };

  // Perform client-side resize
  const processResize = async () => {
    if (!items.length) return;
    setIsProcessing(true);

    const updated = [...items];

    for (let i = 0; i < updated.length; i++) {
      const item = updated[i];
      const { w: destW, h: destH, skipped } = computeTargetSize(item.width, item.height);

      if (skipped) {
        item.status = "skipped";
        item.targetWidth = item.width;
        item.targetHeight = item.height;
        item.resultBlob = item.file;
        item.resultUrl = item.previewUrl;
        item.resultSize = item.size;
        setItems([...updated]);
        continue;
      }

      item.status = "processing";
      setItems([...updated]);

      try {
        const img = new Image();
        img.src = item.previewUrl;
        await new Promise((res, rej) => {
          if (img.complete) res(true);
          else {
            img.onload = () => res(true);
            img.onerror = rej;
          }
        });

        const canvas = document.createElement("canvas");
        canvas.width = destW;
        canvas.height = destH;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("无法初始化图形画布");

        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";

        if (dimensionMode === "fixed" && scaleType === "dimension" && fitMode === "crop") {
          // Center crop
          const aspectTarget = destW / destH;
          const aspectSource = item.width / item.height;
          let sx = 0, sy = 0, sw = item.width, sh = item.height;
          if (aspectSource > aspectTarget) {
            sw = Math.round(item.height * aspectTarget);
            sx = Math.round((item.width - sw) / 2);
          } else {
            sh = Math.round(item.width / aspectTarget);
            sy = Math.round((item.height - sh) / 2);
          }
          ctx.drawImage(img, sx, sy, sw, sh, 0, 0, destW, destH);
        } else {
          // Stretch or direct proportional scale
          ctx.drawImage(img, 0, 0, destW, destH);
        }

        // Determine mime type
        let mime = item.file.type;
        if (outputFormat === "jpeg") mime = "image/jpeg";
        else if (outputFormat === "png") mime = "image/png";
        else if (outputFormat === "webp") mime = "image/webp";

        const blob = await new Promise<Blob>((res, rej) => {
          canvas.toBlob(
            (b) => {
              if (b) res(b);
              else rej(new Error("生成图片失败"));
            },
            mime,
            0.92
          );
        });

        if (item.resultUrl && item.resultUrl !== item.previewUrl) {
          URL.revokeObjectURL(item.resultUrl);
        }

        item.resultBlob = blob;
        item.resultUrl = URL.createObjectURL(blob);
        item.resultSize = blob.size;
        item.targetWidth = destW;
        item.targetHeight = destH;
        item.status = "done";
      } catch (err: unknown) {
        item.status = "error";
        item.error = err instanceof Error ? err.message : "调整尺寸失败";
      }

      setItems([...updated]);
    }

    setIsProcessing(false);
    setConfetti((c) => c + 1);
    toast({ title: "所有图片尺寸调整完成！", variant: "success" });
  };

  const downloadOne = (item: ResizeFileItem) => {
    const url = item.resultUrl || item.previewUrl;
    const a = document.createElement("a");
    a.href = url;
    const ext = outputFormat === "original" ? item.name.split(".").pop() : outputFormat;
    const baseName = item.name.substring(0, item.name.lastIndexOf(".")) || item.name;
    a.download = `${baseName}_resized.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const downloadAllZip = async () => {
    const doneItems = items.filter((it) => it.resultBlob || it.status === "done" || it.status === "skipped");
    if (!doneItems.length) return;

    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();

      doneItems.forEach((it) => {
        const ext = outputFormat === "original" ? it.name.split(".").pop() : outputFormat;
        const baseName = it.name.substring(0, it.name.lastIndexOf(".")) || it.name;
        const filename = `${baseName}_resized.${ext}`;
        zip.file(filename, it.resultBlob || it.file);
      });

      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = url;
      a.download = `FurinaKit_Resized_Images_${Date.now()}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast({ title: "已打包下载全部修改后图片", variant: "success" });
    } catch {
      toast({ title: "打包下载失败", variant: "error" });
    }
  };

  const doneCount = items.filter((i) => i.status === "done" || i.status === "skipped").length;

  return (
    <div className="space-y-6">
      {confetti > 0 && <Confetti key={confetti} />}

      {/* 隐藏的文件选择 input */}
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

      {/* 参数控制卡片 (对齐 docsmall) */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary font-bold">
              <Sliders size={18} />
            </span>
            <div>
              <h3 className="text-sm font-bold text-foreground">修改图片尺寸设置</h3>
              <p className="text-xs text-muted-foreground">支持单张或批量修改图片尺寸，支持比例缩放与精准像素控制</p>
            </div>
          </div>

          {/* 模式切换：按比例 vs 按尺寸 */}
          <div className="flex items-center bg-muted/60 p-1 rounded-xl border border-border/50 text-xs">
            <button
              type="button"
              onClick={() => setScaleType("percent")}
              className={cn(
                "px-3.5 py-1.5 rounded-lg font-medium transition-all",
                scaleType === "percent"
                  ? "bg-background text-primary shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              % 按比例缩放
            </button>
            <button
              type="button"
              onClick={() => setScaleType("dimension")}
              className={cn(
                "px-3.5 py-1.5 rounded-lg font-medium transition-all",
                scaleType === "dimension"
                  ? "bg-background text-primary shadow-xs font-semibold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              # 按尺寸缩放
            </button>
          </div>
        </div>

        {/* 详细参数配置 */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 items-start pt-1">
          {scaleType === "percent" ? (
            <div className="col-span-full space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-foreground">缩放比例</span>
                <span className="text-primary font-bold text-sm">{percent}%</span>
              </div>
              <input
                type="range"
                min={5}
                max={400}
                step={5}
                value={percent}
                onChange={(e) => setPercent(Number(e.target.value))}
                className="w-full accent-primary h-2 bg-muted rounded-lg cursor-pointer"
              />
              <div className="flex items-center gap-2">
                {[25, 50, 75, 120, 150, 200].map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setPercent(p)}
                    className={cn(
                      "px-2.5 py-1 text-xs rounded-lg border transition-colors",
                      percent === p
                        ? "border-primary bg-primary/10 text-primary font-bold"
                        : "border-border text-muted-foreground hover:border-primary/50"
                    )}
                  >
                    {p}%
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <>
              {/* 缩放方式 */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">缩放方式</Label>
                <Select
                  value={dimensionMode}
                  onChange={(e) => setDimensionMode(e.target.value as DimensionMode)}
                  className="h-9 text-xs"
                >
                  <option value="fixed">固定尺寸 (自定义宽与高)</option>
                  <option value="width">固定宽度 (高度自动等比)</option>
                  <option value="height">固定高度 (宽度自动等比)</option>
                  <option value="max_side">固定最大边 (长边固定)</option>
                  <option value="min_side">固定最小边 (短边固定)</option>
                </Select>
              </div>

              {/* 宽度 */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold">
                    {dimensionMode === "height" ? "宽度 (自动)" : dimensionMode === "max_side" ? "最大边 (像素)" : dimensionMode === "min_side" ? "最小边 (像素)" : "宽度 (像素)"}
                  </Label>
                </div>
                <Input
                  type="number"
                  min={1}
                  disabled={dimensionMode === "height"}
                  value={targetWidth}
                  onChange={(e) => setTargetWidth(Math.max(1, Number(e.target.value)))}
                  className="h-9 text-xs"
                  placeholder="如: 1000"
                />
              </div>

              {/* 高度 */}
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label className="text-xs font-semibold">
                    {dimensionMode === "fixed" ? "高度 (像素)" : "高度 (自动)"}
                  </Label>
                </div>
                <Input
                  type="number"
                  min={1}
                  disabled={dimensionMode !== "fixed"}
                  value={targetHeight}
                  onChange={(e) => setTargetHeight(Math.max(1, Number(e.target.value)))}
                  className="h-9 text-xs"
                  placeholder="如: 1000"
                />
              </div>

              {/* 输出格式 */}
              <div className="space-y-1.5">
                <Label className="text-xs font-semibold">输出格式</Label>
                <Select
                  value={outputFormat}
                  onChange={(e) => setOutputFormat(e.target.value as "original" | "jpeg" | "png" | "webp")}
                  className="h-9 text-xs"
                >
                  <option value="original">保持原图格式</option>
                  <option value="jpeg">JPG (体积小)</option>
                  <option value="png">PNG (高清无损)</option>
                  <option value="webp">WebP (现代高效)</option>
                </Select>
              </div>
            </>
          )}
        </div>

        {/* 附加选项与固定尺寸裁剪模式 */}
        {scaleType === "dimension" && (
          <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-border/40 text-xs">
            <div className="flex items-center gap-6">
              {/* 跳过小图 */}
              <label className="flex items-center gap-2 cursor-pointer select-none text-muted-foreground hover:text-foreground">
                <input
                  type="checkbox"
                  checked={skipSmall}
                  onChange={(e) => setSkipSmall(e.target.checked)}
                  className="rounded border-border accent-primary h-4 w-4"
                />
                <span>跳过小图 (当原图尺寸小于目标尺寸时不放大)</span>
              </label>

              {/* 固定尺寸模式下的填充策略 */}
              {dimensionMode === "fixed" && (
                <div className="flex items-center gap-3">
                  <span className="text-muted-foreground">填充方式:</span>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="fitMode"
                      value="crop"
                      checked={fitMode === "crop"}
                      onChange={() => setFitMode("crop")}
                      className="accent-primary"
                    />
                    <span className="font-medium text-foreground">居中裁剪 (推荐·不变形)</span>
                  </label>
                  <label className="flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="fitMode"
                      value="stretch"
                      checked={fitMode === "stretch"}
                      onChange={() => setFitMode("stretch")}
                      className="accent-primary"
                    />
                    <span className="text-muted-foreground">拉伸图像</span>
                  </label>
                </div>
              )}
            </div>
          </div>
        )}

        {/* 底部操作工具栏 */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border/50">
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="gap-1.5 h-8 text-xs"
            >
              <Plus size={14} />
              添加图片
            </Button>
            {items.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearAll}
                className="gap-1.5 h-8 text-xs text-muted-foreground hover:text-destructive"
              >
                <Trash2 size={14} />
                清空全部 ({items.length})
              </Button>
            )}
          </div>

          <div className="flex items-center gap-3">
            {doneCount > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={downloadAllZip}
                className="gap-1.5 h-8 text-xs text-primary border-primary/30 hover:bg-primary/5"
              >
                <FileArchive size={14} />
                批量下载全部 (ZIP)
              </Button>
            )}

            <Button
              type="button"
              onClick={processResize}
              disabled={!items.length || isProcessing}
              className="gap-2 px-6 h-9"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>正在处理中…</span>
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4" />
                  <span>开始批量修改 ({items.length})</span>
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* 上传托盘区（无图片时显示） */}
      {items.length === 0 && (
        <div
          data-furinakit-dropzone="true"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
          }}
          className="flex flex-col items-center justify-center p-14 rounded-2xl border-2 border-dashed border-border hover:border-primary/60 bg-muted/20 hover:bg-muted/40 transition-all cursor-pointer group text-center space-y-4"
        >
          <div className="h-16 w-16 rounded-2xl bg-primary/10 group-hover:bg-primary/20 text-primary flex items-center justify-center transition-transform group-hover:scale-110">
            <Upload size={30} />
          </div>
          <div className="space-y-1">
            <p className="text-base font-bold text-foreground">
              拖拽图片到这里，或 <span className="text-primary underline underline-offset-4">点击上传图片</span>
            </p>
            <p className="text-xs text-muted-foreground">
              支持 JPG, PNG, WebP 等常见格式，支持同时处理多张图片
            </p>
          </div>
        </div>
      )}

      {/* 图片列表表格 (docsmall 风格) */}
      {items.length > 0 && (
        <div className="rounded-2xl border border-border bg-card overflow-hidden shadow-xs">
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-muted/50 border-b border-border text-muted-foreground font-semibold">
                <tr>
                  <th className="py-3 px-4 w-16">预览</th>
                  <th className="py-3 px-4">文件名</th>
                  <th className="py-3 px-4">原尺寸 / 体积</th>
                  <th className="py-3 px-4">目标尺寸</th>
                  <th className="py-3 px-4">处理状态</th>
                  <th className="py-3 px-4 text-right w-28">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {items.map((item) => {
                  const { w: previewTargetW, h: previewTargetH, skipped } = computeTargetSize(item.width, item.height);

                  return (
                    <tr key={item.id} className="hover:bg-muted/30 transition-colors">
                      {/* 缩略图 */}
                      <td className="py-2.5 px-4">
                        <div className="h-12 w-12 rounded-lg border border-border overflow-hidden bg-muted/40 flex items-center justify-center flex-shrink-0">
                          <img
                            src={item.resultUrl || item.previewUrl}
                            alt={item.name}
                            className="h-full w-full object-cover"
                          />
                        </div>
                      </td>

                      {/* 文件名 */}
                      <td className="py-2.5 px-4 font-medium text-foreground max-w-[200px] truncate" title={item.name}>
                        {item.name}
                      </td>

                      {/* 原尺寸 */}
                      <td className="py-2.5 px-4 text-muted-foreground whitespace-nowrap">
                        <span className="font-mono text-foreground">{item.width} × {item.height}</span> px
                        <div className="text-[11px] text-muted-foreground">{formatBytes(item.size)}</div>
                      </td>

                      {/* 目标尺寸 */}
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        {skipped ? (
                          <span className="text-amber-500 font-medium">跳过放大 (保持原尺寸)</span>
                        ) : (
                          <div className="flex items-center gap-1.5">
                            <span className="font-mono font-bold text-primary">
                              {item.targetWidth || previewTargetW} × {item.targetHeight || previewTargetH}
                            </span>
                            <span className="text-muted-foreground">px</span>
                          </div>
                        )}
                        {item.resultSize && (
                          <div className="text-[11px] text-emerald-500 font-medium">
                            修改后: {formatBytes(item.resultSize)}
                          </div>
                        )}
                      </td>

                      {/* 状态 */}
                      <td className="py-2.5 px-4 whitespace-nowrap">
                        {item.status === "pending" && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] bg-muted text-muted-foreground">
                            待处理
                          </span>
                        )}
                        {item.status === "processing" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-blue-500/10 text-blue-500 font-medium">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            正在调整…
                          </span>
                        )}
                        {item.status === "done" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-emerald-500/10 text-emerald-500 font-bold">
                            <CheckCircle2 className="h-3 w-3" />
                            已完成
                          </span>
                        )}
                        {item.status === "skipped" && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] bg-amber-500/10 text-amber-500 font-medium">
                            已保持原图
                          </span>
                        )}
                        {item.status === "error" && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] bg-red-500/10 text-red-500 font-medium" title={item.error}>
                            <AlertCircle className="h-3 w-3" />
                            失败
                          </span>
                        )}
                      </td>

                      {/* 操作 */}
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-1">
                          {(item.status === "done" || item.status === "skipped") && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => downloadOne(item)}
                              className="h-8 w-8 p-0 text-primary hover:bg-primary/10"
                              title="下载这张图片"
                            >
                              <Download size={14} />
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => removeItem(item.id)}
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                            title="移除"
                          >
                            <Trash2 size={14} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
