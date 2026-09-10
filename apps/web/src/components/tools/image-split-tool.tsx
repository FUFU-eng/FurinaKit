"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import {
  Upload, Download, Trash2,
  Loader2, FileArchive, Grid,
  Layers
} from "lucide-react";
import { Button, Input, Label, Select } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { Confetti } from "@/components/ui/confetti";
import { cn } from "@/lib/utils";
import { consumePendingFiles } from "@/lib/file-handoff";

interface SliceItem {
  id: string;
  row: number;
  col: number;
  index: number;
  width: number;
  height: number;
  blob: Blob;
  url: string;
  size: number;
}

export function ImageSplitTool() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [imageSize, setImageSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  // Grid settings
  const [rows, setRows] = useState<number>(3);
  const [cols, setCols] = useState<number>(3);
  const [outputFormat, setOutputFormat] = useState<"original" | "png" | "jpeg">("original");

  // Generated slices
  const [slices, setSlices] = useState<SliceItem[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [confetti, setConfetti] = useState(0);

  const previewUrlRef = useRef(previewUrl);
  previewUrlRef.current = previewUrl;
  const slicesRef = useRef(slices);
  slicesRef.current = slices;

  // 接收从全局拖拽或其他工具移交的文件
  useEffect(() => {
    const pending = consumePendingFiles();
    if (pending && pending[0]) {
      handleFile(pending[0]);
    }
  }, []);

  // 监听窗口拖拽直接放入当前工具
  useEffect(() => {
    const onWindowDragOver = (e: DragEvent) => {
      if (Array.from(e.dataTransfer?.types ?? []).includes("Files")) {
        e.preventDefault();
      }
    };
    const onWindowDrop = (e: DragEvent) => {
      const files = Array.from(e.dataTransfer?.files ?? []);
      const valid = files.find((f) => f.type.startsWith("image/"));
      if (valid) {
        e.preventDefault();
        e.stopPropagation();
        handleFile(valid);
      }
    };
    window.addEventListener("dragover", onWindowDragOver);
    window.addEventListener("drop", onWindowDrop);
    return () => {
      window.removeEventListener("dragover", onWindowDragOver);
      window.removeEventListener("drop", onWindowDrop);
    };
  }, []);

  // Clean up object URLs
  useEffect(() => {
    return () => {
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
      slicesRef.current.forEach((s) => URL.revokeObjectURL(s.url));
    };
  }, []);

  const handleFile = (f: File) => {
    if (!f.type.startsWith("image/")) {
      toast({ title: "请选择有效的图片文件", variant: "error" });
      return;
    }

    if (previewUrl) URL.revokeObjectURL(previewUrl);
    slices.forEach((s) => URL.revokeObjectURL(s.url));
    setSlices([]);

    const url = URL.createObjectURL(f);
    const img = new Image();
    img.onload = () => {
      setImageSize({ width: img.naturalWidth, height: img.naturalHeight });
      setFile(f);
      setPreviewUrl(url);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      toast({ title: "图片解析失败", variant: "error" });
    };
    img.src = url;
  };

  const clearAll = () => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    slices.forEach((s) => URL.revokeObjectURL(s.url));
    setFile(null);
    setPreviewUrl("");
    setImageSize({ width: 0, height: 0 });
    setSlices([]);
  };

  // Presets
  const applyPreset = (r: number, c: number) => {
    setRows(r);
    setCols(c);
  };

  // Perform split
  const runSplit = async () => {
    if (!file || !previewUrl || imageSize.width === 0) return;
    if (rows < 1 || cols < 1) {
      toast({ title: "行数与列数必须大于等于 1", variant: "error" });
      return;
    }

    setIsProcessing(true);
    slices.forEach((s) => URL.revokeObjectURL(s.url));
    setSlices([]);

    try {
      const img = new Image();
      img.src = previewUrl;
      await new Promise((res, rej) => {
        if (img.complete) res(true);
        else {
          img.onload = () => res(true);
          img.onerror = rej;
        }
      });

      const totalW = img.naturalWidth;
      const totalH = img.naturalHeight;

      const sliceW = Math.floor(totalW / cols);
      const sliceH = Math.floor(totalH / rows);

      let mime = file.type;
      if (outputFormat === "png") mime = "image/png";
      else if (outputFormat === "jpeg") mime = "image/jpeg";

      const newSlices: SliceItem[] = [];
      let idx = 1;

      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const sx = c * sliceW;
          const sy = r * sliceH;
          // Last column/row takes remaining pixels to avoid gaps
          const curW = c === cols - 1 ? totalW - sx : sliceW;
          const curH = r === rows - 1 ? totalH - sy : sliceH;

          const canvas = document.createElement("canvas");
          canvas.width = curW;
          canvas.height = curH;
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("无法初始化切图画布");

          ctx.drawImage(img, sx, sy, curW, curH, 0, 0, curW, curH);

          const blob = await new Promise<Blob>((resolve, reject) => {
            canvas.toBlob(
              (b) => {
                if (b) resolve(b);
                else reject(new Error("切图生成失败"));
              },
              mime,
              0.95
            );
          });

          const sliceUrl = URL.createObjectURL(blob);
          newSlices.push({
            id: `slice_${r}_${c}_${idx}`,
            row: r + 1,
            col: c + 1,
            index: idx++,
            width: curW,
            height: curH,
            blob,
            url: sliceUrl,
            size: blob.size,
          });
        }
      }

      setSlices(newSlices);
      setConfetti((c) => c + 1);
      toast({ title: `成功切片为 ${newSlices.length} 张图片！`, variant: "success" });
    } catch (err: unknown) {
      toast({ title: "切图失败", description: err instanceof Error ? err.message : "切图失败", variant: "error" });
    } finally {
      setIsProcessing(false);
    }
  };

  // Download single slice
  const downloadSlice = (slice: SliceItem) => {
    const ext = outputFormat === "original" ? (file?.name.split(".").pop() || "png") : outputFormat;
    const baseName = file?.name.substring(0, file?.name.lastIndexOf(".")) || "image";
    const a = document.createElement("a");
    a.href = slice.url;
    a.download = `${baseName}_part_${slice.index}_r${slice.row}_c${slice.col}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  // Download all as ZIP
  const downloadZip = async () => {
    if (!slices.length) return;

    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();

      const ext = outputFormat === "original" ? (file?.name.split(".").pop() || "png") : outputFormat;
      const baseName = file?.name.substring(0, file?.name.lastIndexOf(".")) || "image";

      slices.forEach((slice) => {
        const filename = `${baseName}_part_${slice.index}_r${slice.row}_c${slice.col}.${ext}`;
        zip.file(filename, slice.blob);
      });

      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${baseName}_split_${rows}x${cols}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast({ title: "已打包下载全部切片 ZIP", variant: "success" });
    } catch {
      toast({ title: "打包下载失败", variant: "error" });
    }
  };

  const perSliceApprox = useMemo(() => {
    if (!imageSize.width || !rows || !cols) return { w: 0, h: 0 };
    return {
      w: Math.round(imageSize.width / cols),
      h: Math.round(imageSize.height / rows),
    };
  }, [imageSize, rows, cols]);

  return (
    <div className="space-y-6">
      {confetti > 0 && <Confetti key={confetti} />}

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.[0]) handleFile(e.target.files[0]);
          e.target.value = "";
        }}
      />

      {/* 参数与设置卡片 (docsmall 风格) */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/60 pb-4">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary font-bold">
              <Grid size={18} />
            </span>
            <div>
              <h3 className="text-sm font-bold text-foreground">图片分割设置</h3>
              <p className="text-xs text-muted-foreground">
                支持九宫格、四宫格、横向或竖向等多宫格切图，支持实时网格预览与一键 ZIP 打包
              </p>
            </div>
          </div>

          {/* 快捷预设 */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-xs text-muted-foreground mr-1">快捷切法:</span>
            {[
              { label: "九宫格 (3×3)", r: 3, c: 3 },
              { label: "四宫格 (2×2)", r: 2, c: 2 },
              { label: "六宫格 (2×3)", r: 2, c: 3 },
              { label: "横切 3 份 (3×1)", r: 3, c: 1 },
              { label: "竖切 3 份 (1×3)", r: 1, c: 3 },
            ].map((preset) => (
              <button
                key={preset.label}
                type="button"
                onClick={() => applyPreset(preset.r, preset.c)}
                className={cn(
                  "px-2.5 py-1 text-xs rounded-lg border transition-colors",
                  rows === preset.r && cols === preset.c
                    ? "border-primary bg-primary/10 text-primary font-bold"
                    : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"
                )}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>

        {/* 详细行数列数与格式配置 */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-center pt-1">
          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">切分行数 (水平等分)</Label>
            <Input
              type="number"
              min={1}
              max={20}
              value={rows}
              onChange={(e) => setRows(Math.max(1, Math.min(20, Number(e.target.value))))}
              className="h-9 text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">切分列数 (垂直等分)</Label>
            <Input
              type="number"
              min={1}
              max={20}
              value={cols}
              onChange={(e) => setCols(Math.max(1, Math.min(20, Number(e.target.value))))}
              className="h-9 text-xs"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs font-semibold">输出格式</Label>
            <Select
              value={outputFormat}
              onChange={(e) => setOutputFormat(e.target.value as "original" | "png" | "jpeg")}
              className="h-9 text-xs"
            >
              <option value="original">保持原格式</option>
              <option value="png">PNG (高清无损)</option>
              <option value="jpeg">JPG (体积小)</option>
            </Select>
          </div>
        </div>

        {/* 底部操作与统计 */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-border/50">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            {file && (
              <>
                <span>原图: {imageSize.width} × {imageSize.height} px</span>
                <span className="text-foreground font-semibold">
                  总切片数: {rows * cols} 张
                </span>
                <span>单片约: {perSliceApprox.w} × {perSliceApprox.h} px</span>
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            {file && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={clearAll}
                className="gap-1.5 h-8 text-xs text-muted-foreground hover:text-destructive"
              >
                <Trash2 size={14} />
                清除
              </Button>
            )}

            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              className="gap-1.5 h-8 text-xs"
            >
              <Upload size={14} />
              {file ? "更换图片" : "选择图片"}
            </Button>

            {slices.length > 0 && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={downloadZip}
                className="gap-1.5 h-8 text-xs text-primary border-primary/30 hover:bg-primary/5 font-semibold"
              >
                <FileArchive size={14} />
                打包下载全部切片 (ZIP)
              </Button>
            )}

            <Button
              type="button"
              onClick={runSplit}
              disabled={!file || isProcessing}
              className="gap-2 px-6 h-9"
            >
              {isProcessing ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  <span>切图中…</span>
                </>
              ) : (
                <>
                  <Grid className="h-4 w-4" />
                  <span>立即切图 ({rows * cols} 份)</span>
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

      {/* 未上传时的拖拽区 */}
      {!file && (
        <div
          data-furinakit-dropzone="true"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files?.[0]) handleFile(e.dataTransfer.files[0]);
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
              支持 JPG, PNG, WebP 格式，分割社交媒体九宫格朋友圈利器
            </p>
          </div>
        </div>
      )}

      {/* 已上传图片：实时分割网格预览区 */}
      {file && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
          {/* 左侧：原图与实时网格叠加预览 */}
          <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold text-foreground">
              <span className="flex items-center gap-1.5">
                <Layers size={14} className="text-primary" />
                网格切割线实时预览 ({rows} 行 × {cols} 列)
              </span>
              <span className="text-muted-foreground font-normal">{file.name}</span>
            </div>

            <div className="relative rounded-xl overflow-hidden border border-border bg-neutral-950 flex items-center justify-center max-h-[500px]">
              <img
                src={previewUrl}
                alt="Original preview"
                className="max-h-[500px] w-full object-contain block select-none pointer-events-none"
              />

              {/* 网格叠加层 */}
              <div
                className="absolute inset-0 grid pointer-events-none"
                style={{
                  gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
                  gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
                }}
              >
                {Array.from({ length: rows * cols }).map((_, i) => (
                  <div
                    key={i}
                    className="border border-dashed border-white/60 bg-primary/5 flex items-center justify-center relative"
                  >
                    <span className="px-1.5 py-0.5 rounded-full bg-black/60 text-white font-mono text-[10px] backdrop-blur-xs font-bold shadow-xs">
                      #{i + 1}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 右侧：切片生成结果列表 */}
          <div className="rounded-2xl border border-border bg-card p-4 space-y-3">
            <div className="flex items-center justify-between text-xs font-semibold text-foreground">
              <span>切片结果展示 {slices.length > 0 && `(${slices.length} 张)`}</span>
              {slices.length > 0 && (
                <button
                  type="button"
                  onClick={downloadZip}
                  className="text-primary hover:underline text-xs flex items-center gap-1 font-medium"
                >
                  <Download size={12} />
                  一键打包下载全部
                </button>
              )}
            </div>

            {slices.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center text-muted-foreground space-y-3">
                <Grid size={36} className="text-muted-foreground/40" />
                <p className="text-xs">点击上方“立即切图”，切片将即时生成在此处</p>
              </div>
            ) : (
              <div
                className="grid gap-2 max-h-[500px] overflow-y-auto p-1"
                style={{
                  gridTemplateColumns: `repeat(${Math.min(cols, 4)}, minmax(0, 1fr))`,
                }}
              >
                {slices.map((slice) => (
                  <div
                    key={slice.id}
                    className="group relative rounded-xl border border-border overflow-hidden bg-muted/30 hover:border-primary/60 transition-all flex flex-col items-center justify-between"
                  >
                    <div className="relative w-full aspect-square bg-black/5 flex items-center justify-center overflow-hidden">
                      <img
                        src={slice.url}
                        alt={`Slice ${slice.index}`}
                        className="w-full h-full object-cover transition-transform group-hover:scale-105"
                      />
                      <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-full bg-black/70 text-white text-[10px] font-mono font-bold shadow-xs">
                        #{slice.index}
                      </span>
                    </div>

                    <div className="w-full p-2 bg-background/95 border-t border-border flex items-center justify-between text-[10px]">
                      <span className="text-muted-foreground font-mono">
                        {slice.width}×{slice.height}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => downloadSlice(slice)}
                        className="h-6 w-6 p-0 text-primary hover:bg-primary/10"
                        title="下载此切片"
                      >
                        <Download size={12} />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
