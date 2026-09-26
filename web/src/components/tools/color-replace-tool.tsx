"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/color-replace-tool.tsx");


/**
 * 图片色彩替换
 *
 * 设计要点：
 *  · 预览走缩放后的画布（长边 ≤ 1600），参数拖动实时重算，手感流畅；
 *    导出时才按原始分辨率重算一遍，保证输出画质不受预览缩放影响。
 *  · 画布可缩放（滚轮/滑杆）与平移（按住空格拖动，或直接拖动），带透明棋盘格底。
 *  · 每一步替换都进撤销栈，最多保留 8 步。
 *  · 「保留明暗层次」只换色相、保住原像素明暗，替换后画面依然有光影；
 *    「智能保护」用洪水填充只替换相连区域，画面其它位置的同色物体不受影响。
 *  · 导出支持 PNG / JPG / WEBP / BMP（BMP 由自己编码，画布本身不提供）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronsLeftRight, Download, Eye, ImageUp, Maximize, Minus, Palette, Pipette,
  Plus, Redo2, RotateCcw, Undo2, ZoomIn,
  Upload,
} from "lucide-react";
import { Button, Input, Select } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

const PREVIEW_MAX = 1600;

/** 取色器（针管）光标：CSS 没有内置的取色器光标，这里用一张自绘 SVG，
 *  热点放在针尖（左下角），保证「针尖指哪就取哪」。 */
const PIPETTE_CURSOR = `url("/cursor-pipette.svg") 2 26, crosshair`;
const UNDO_LIMIT = 8;

const hexToRgb = (hex: string): [number, number, number] => {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0").slice(0, 6);
  return [0, 2, 4].map((i) => {
    const v = parseInt(full.slice(i, i + 2), 16);
    return Number.isNaN(v) ? 0 : v;
  }) as [number, number, number];
};

const rgbToHex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((v) => Math.min(255, Math.max(0, Math.round(v))).toString(16).padStart(2, "0")).join("");

interface ReplaceParams {
  source: string;
  target: string;
  tolerance: number;
  softness: number;
  keepShading: boolean;
  contiguous: boolean;
  contiguousSeed?: [number, number] | null;
}

/** 在给定的 ImageData 上执行替换，返回替换的像素数 */
function applyReplace(image: ImageData, p: ReplaceParams): number {
  const [sr, sg, sb] = hexToRgb(p.source);
  const [tr, tg, tb] = hexToRgb(p.target);
  const data = image.data;
  const w = image.width;
  const h = image.height;
  const tol = (p.tolerance / 100) * 441.67;
  const soft = (p.softness / 100) * 441.67 + 0.0001;
  const targetLum = Math.max(1, 0.2126 * tr + 0.7152 * tg + 0.0722 * tb);
  let replaced = 0;

  const paint = (i: number, weight: number) => {
    if (p.keepShading) {
      const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      const f = Math.max(0.25, Math.min(1.7, lum / targetLum));
      data[i] = data[i] * (1 - weight) + Math.min(255, tr * f) * weight;
      data[i + 1] = data[i + 1] * (1 - weight) + Math.min(255, tg * f) * weight;
      data[i + 2] = data[i + 2] * (1 - weight) + Math.min(255, tb * f) * weight;
    } else {
      data[i] = data[i] * (1 - weight) + tr * weight;
      data[i + 1] = data[i + 1] * (1 - weight) + tg * weight;
      data[i + 2] = data[i + 2] * (1 - weight) + tb * weight;
    }
  };

  const dist = (i: number) => {
    const dr = data[i] - sr, dg = data[i + 1] - sg, db = data[i + 2] - sb;
    return Math.sqrt(dr * dr + dg * dg + db * db);
  };

  if (p.contiguous && p.contiguousSeed) {
    // 从取样点开始洪水填充，只影响相连区域
    const [sx, sy] = p.contiguousSeed;
    const visited = new Uint8Array(w * h);
    const stack: number[] = [Math.min(h - 1, Math.max(0, sy)) * w + Math.min(w - 1, Math.max(0, sx))];
    while (stack.length) {
      const pos = stack.pop()!;
      if (visited[pos]) continue;
      visited[pos] = 1;
      const i = pos * 4;
      const dd = dist(i);
      if (dd > tol + soft) continue;
      const weight = dd <= tol ? 1 : 1 - (dd - tol) / soft;
      if (weight > 0) {
        paint(i, weight);
        replaced++;
      }
      const x = pos % w, y = (pos - x) / w;
      if (x > 0) stack.push(pos - 1);
      if (x < w - 1) stack.push(pos + 1);
      if (y > 0) stack.push(pos - w);
      if (y < h - 1) stack.push(pos + w);
    }
  } else {
    for (let i = 0; i < data.length; i += 4) {
      const dd = dist(i);
      if (dd <= tol + soft) {
        const weight = dd <= tol ? 1 : 1 - (dd - tol) / soft;
        if (weight > 0) {
          paint(i, weight);
          replaced++;
        }
      }
    }
  }
  return replaced;
}

/** 24 位 BMP 编码（画布只支持 PNG/JPEG/WEBP，BMP 自己写） */
function encodeBmp(image: ImageData): Blob {
  const { width: w, height: h, data } = image;
  const rowSize = Math.floor((24 * w + 31) / 32) * 4;
  const pixelArraySize = rowSize * h;
  const fileSize = 54 + pixelArraySize;
  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  view.setUint8(0, 0x42);
  view.setUint8(1, 0x4d);
  view.setUint32(2, fileSize, true);
  view.setUint32(10, 54, true);
  view.setUint32(14, 40, true);
  view.setInt32(18, w, true);
  view.setInt32(22, h, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelArraySize, true);

  for (let y = 0; y < h; y++) {
    const srcRow = (h - 1 - y) * w * 4;
    const dstRow = 54 + y * rowSize;
    for (let x = 0; x < w; x++) {
      const si = srcRow + x * 4;
      const di = dstRow + x * 3;
      bytes[di] = data[si + 2];
      bytes[di + 1] = data[si + 1];
      bytes[di + 2] = data[si];
    }
  }
  return new Blob([buffer], { type: "image/bmp" });
}

export function ColorReplaceTool() {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  const { toast } = useToast();

  const [imageUrl, setImageUrl] = useState("");
  const [fileName, setFileName] = useState("");
  const [source, setSource] = useState("#3B82F6");
  const [target, setTarget] = useState("#2D7AD2");
  const [tolerance, setTolerance] = useState(20);
  const [softness, setSoftness] = useState(24);
  const [keepShading, setKeepShading] = useState(true);
  const [contiguous, setContiguous] = useState(true);
  const [picking, setPicking] = useState<"source" | "target" | null>(null);
  const [zoom, setZoom] = useState(1);
  const [matched, setMatched] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [format, setFormat] = useState("png");

  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const originRef = useRef<ImageData | null>(null);
  const undoRef = useRef<ImageData[]>([]);
  const redoRef = useRef<ImageData[]>([]);
  const seedRef = useRef<[number, number] | null>(null);
  const panRef = useRef<{ x: number; y: number; left: number; top: number } | null>(null);

  const loadFile = useCallback(
    (f: File | null | undefined) => {
      if (!f) return;
      if (!f.type.startsWith("image/")) {
        toast({ title: "请选择图片文件", variant: "error" });
        return;
      }
      setImageUrl(URL.createObjectURL(f));
      setFileName(f.name);
      setMatched(null);
      setZoom(1);
      undoRef.current = [];
      redoRef.current = [];
      seedRef.current = null;
    },
    [toast],
  );

  /** 图片载入画布：按长边限制缩放，作为预览底 */
  const onImageLoad = useCallback(() => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas) return;
    const scale = Math.min(1, PREVIEW_MAX / Math.max(img.naturalWidth, img.naturalHeight));
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    originRef.current = ctx.getImageData(0, 0, canvas.width, canvas.height);
    setSize({ w: img.naturalWidth, h: img.naturalHeight });
    seedRef.current = [Math.floor(canvas.width / 2), Math.floor(canvas.height / 2)];
    // 自动缩小到合适宽度
    const wrapW = wrapRef.current?.clientWidth ?? 900;
    setZoom(Math.min(1, wrapW / canvas.width));
    // 载入后立刻按当前参数算一遍，否则界面上看不到「已匹配多少像素」
    recomputeRef.current(false);
  }, []);

  /** 参数变化 → 从原图重算（保证不会累积误差） */
  const recompute = useCallback(
    (record = false) => {
      const canvas = canvasRef.current;
      const origin = originRef.current;
      if (!canvas || !origin) return;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      if (record) {
        undoRef.current.push(new ImageData(new Uint8ClampedArray(ctx.getImageData(0, 0, canvas.width, canvas.height).data), canvas.width, canvas.height));
        if (undoRef.current.length > UNDO_LIMIT) undoRef.current.shift();
        redoRef.current = [];
      }
      const work = new ImageData(new Uint8ClampedArray(origin.data), origin.width, origin.height);
      const n = applyReplace(work, {
        source,
        target,
        tolerance,
        softness,
        keepShading,
        contiguous,
        contiguousSeed: seedRef.current,
      });
      ctx.putImageData(work, 0, 0);
      setMatched(n);
    },
    [source, target, tolerance, softness, keepShading, contiguous],
  );

  const recomputeRef = useRef(recompute);
  recomputeRef.current = recompute;
  useEffect(() => {
    if (originRef.current) recomputeRef.current(false);
  }, [source, target, tolerance, softness, keepShading, contiguous]);

  const undo = () => {
    const stack = undoRef.current;
    const canvas = canvasRef.current;
    if (!canvas || stack.length === 0) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    redoRef.current.push(new ImageData(new Uint8ClampedArray(ctx.getImageData(0, 0, canvas.width, canvas.height).data), canvas.width, canvas.height));
    const prev = stack.pop()!;
    ctx.putImageData(prev, 0, 0);
    toast({ title: `已撤销（还可撤销 ${stack.length} 步）`, variant: "info" });
  };

  const redo = () => {
    const stack = redoRef.current;
    const canvas = canvasRef.current;
    if (!canvas || stack.length === 0) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    undoRef.current.push(new ImageData(new Uint8ClampedArray(ctx.getImageData(0, 0, canvas.width, canvas.height).data), canvas.width, canvas.height));
    const next = stack.pop()!;
    ctx.putImageData(next, 0, 0);
  };

  const reset = () => {
    const canvas = canvasRef.current;
    const origin = originRef.current;
    if (!canvas || !origin) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    undoRef.current = [];
    redoRef.current = [];
    ctx.putImageData(origin, 0, 0);
    setMatched(null);
    toast({ title: "已还原为原图", variant: "info" });
  };

  /** 画布坐标 → 原始像素坐标（考虑缩放） */
  const toImageCoords = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || !originRef.current) return null;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * canvas.width);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * canvas.height);
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null;
    return { x, y };
  };

  const handleCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const coords = toImageCoords(e);
    if (!coords) return;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    if (picking) {
      const origin = originRef.current;
      if (!origin) return;
      const i = (coords.y * origin.width + coords.x) * 4;
      const picked = rgbToHex(origin.data[i], origin.data[i + 1], origin.data[i + 2]).toUpperCase();
      if (picking === "source") setSource(picked);
      else setTarget(picked);
      seedRef.current = [coords.x, coords.y];
      setPicking(null);
      toast({ title: `${picking === "source" ? "取样颜色" : "目标颜色"}：${picked}`, variant: "success" });
      return;
    }
    // 非取色状态点一下 = 把该点作为「相连区域」的起点
    seedRef.current = [coords.x, coords.y];
    recompute(true);
  };

  /* 滚轮缩放（以光标为中心） */
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey && !e.shiftKey) return; // 普通滚动留给页面
      e.preventDefault();
      setZoom((z) => Math.min(8, Math.max(0.1, z * (e.deltaY < 0 ? 1.15 : 0.87))));
    };
    wrap.addEventListener("wheel", onWheel, { passive: false });
    return () => wrap.removeEventListener("wheel", onWheel);
  }, [imageUrl]);

  /* 空格 + 拖动 或 中键拖动 = 平移 */
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const onDown = (e: MouseEvent) => {
      if (e.button === 1 || (e.button === 0 && (e.target as HTMLElement).dataset.pan === "1")) {
        panRef.current = { x: e.clientX, y: e.clientY, left: wrap.scrollLeft, top: wrap.scrollTop };
        wrap.style.cursor = "grabbing";
      }
    };
    const onMove = (e: MouseEvent) => {
      const p = panRef.current;
      if (!p) return;
      wrap.scrollLeft = p.left - (e.clientX - p.x);
      wrap.scrollTop = p.top - (e.clientY - p.y);
    };
    const onUp = () => {
      panRef.current = null;
      wrap.style.cursor = "";
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Space" && e.type === "keydown") e.preventDefault();
    };
    wrap.addEventListener("mousedown", onDown);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    window.addEventListener("keydown", onKey);
    return () => {
      wrap.removeEventListener("mousedown", onDown);
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("keydown", onKey);
    };
  }, [imageUrl]);

  const exportImage = () => {
    const img = imgRef.current;
    const origin = originRef.current;
    if (!img || !origin) return;

    // 按原始分辨率重算一遍，再按所选格式编码
    const full = document.createElement("canvas");
    full.width = img.naturalWidth;
    full.height = img.naturalHeight;
    const ctx = full.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(img, 0, 0, full.width, full.height);
    const fullData = ctx.getImageData(0, 0, full.width, full.height);

    // 预览坐标 → 原始坐标的等比换算
    const scale = full.width / origin.width;
    const seed = seedRef.current;
    const scaledSeed: [number, number] | null = seed
      ? [Math.round(seed[0] * scale), Math.round(seed[1] * scale)]
      : null;

    applyReplace(fullData, { source, target, tolerance, softness, keepShading, contiguous, contiguousSeed: scaledSeed });

    const ext = format;
    const name = `${fileName.replace(/\.[^.]+$/, "")}-色彩替换-${Date.now()}.${ext}`;
    const download = (url: string) => {
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    };

    if (format === "bmp") {
      // 需要先把重算结果写回画布才能取到像素
      ctx.putImageData(fullData, 0, 0);
      const bmp = encodeBmp(ctx.getImageData(0, 0, full.width, full.height));
      download(URL.createObjectURL(bmp));
    } else {
      ctx.putImageData(fullData, 0, 0);
      const mime = format === "jpg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png";
      const url = full.toDataURL(mime, format === "png" ? undefined : 0.92);
      const a = document.createElement("a");
      a.href = url;
      a.download = name;
      a.click();
    }
    toast({ title: `已导出 ${ext.toUpperCase()}`, description: `${full.width} × ${full.height} 全分辨率`, variant: "success" });
  };

  const matchedRatio = useMemo(() => {
    if (!matched || !originRef.current) return 0;
    return (matched / (originRef.current.width * originRef.current.height)) * 100;
  }, [matched, __locale]);

  return (
    <div className="flex flex-col gap-4">
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={(e) => loadFile(e.target.files?.[0])} />

      {!imageUrl ? (
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); loadFile(e.dataTransfer.files?.[0]); }}
          className={cn(
            "group flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-primary/40 bg-primary/[0.04] px-6 py-12 transition-all duration-200",
            dragging ? "border-primary bg-primary/15 ring-4 ring-primary/20" : "hover:border-primary/60 hover:bg-primary/10",
          )}
        >
          <span
            className={cn(
              "mb-2.5 flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[0_1px_0_0_hsl(0_0%_100%/0.18)_inset,0_8px_20px_-12px_hsl(var(--primary)/0.8)] transition-transform",
              dragging ? "-translate-y-0.5 scale-105" : "group-hover:-translate-y-0.5 group-hover:scale-105",
            )}
          >
            {dragging ? <Upload className="h-5 w-5" /> : <ImageUp className="h-5 w-5" />}
          </span>
          <p className="text-[13.5px] font-semibold" style={{ color: colors.text }}>{__ui("点击选择文件，或将文件拖拽到此处")}</p>
          <p className="mt-1 text-[11.5px]" style={{ color: colors.muted }}>{__ui("支持 PNG / JPG / WEBP / BMP，替换后可导出为四种格式")}</p>
        </div>
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-[1fr_340px]">
          {/* 画布区：加 min-w-0，否则画布的固有宽度会把网格列撑破 */}
          <section className="min-w-0 rounded-2xl border p-4" style={{ borderColor: colors.borderSolid, background: colors.card }}>
            <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="truncate text-[12.5px] font-medium" style={{ color: colors.text }}>{fileName}</span>
                {size && (
                  <span className="shrink-0 text-[11.5px]" style={{ color: colors.muted }}>
                    {size.w} × {size.h} px{matched !== null ? __msg(" · 已匹配 {0} 个预览像素（{1}%）", matched.toLocaleString(), matchedRatio.toFixed(2)) : ""}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant={picking === "source" ? "default" : "outline"}
                  className="gap-1.5"
                  style={{ cursor: PIPETTE_CURSOR }}
                  onClick={() => setPicking(picking === "source" ? null : "source")}
                >
                  <Pipette size={13} /> {__ui("取样颜色")}</Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => fileRef.current?.click()}>
                  <ImageUp size={13} /> {__ui("换一张")}</Button>
                <Button size="sm" className="gap-1.5" onClick={exportImage}>
                  <Download size={13} /> {__ui("导出")}</Button>
              </div>
            </header>

            <div
              ref={wrapRef}
              className="relative max-h-[560px] overflow-auto overscroll-contain rounded-xl border"
              style={{
                borderColor: colors.borderSolid,
                // 透明区域用棋盘格衬底，一眼能看出哪里是透明的
                backgroundColor: colors.bg,
                backgroundImage:
                  "linear-gradient(45deg, rgba(127,127,127,0.14) 25%, transparent 25%), linear-gradient(-45deg, rgba(127,127,127,0.14) 25%, transparent 25%), linear-gradient(45deg, transparent 75%, rgba(127,127,127,0.14) 75%), linear-gradient(-45deg, transparent 75%, rgba(127,127,127,0.14) 75%)",
                backgroundSize: "16px 16px",
                backgroundPosition: "0 0, 0 8px, 8px -8px, -8px 0",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img ref={imgRef} src={imageUrl} alt={__ui("原图")} onLoad={onImageLoad} className="hidden" />
              <div className="flex min-h-full items-center justify-center p-3">
                <canvas
                  ref={canvasRef}
                  data-pan="1"
                  onClick={handleCanvasClick}
                  className="max-w-none rounded-lg"
                  style={{
                    width: originRef.current ? originRef.current.width * zoom : undefined,
                    height: originRef.current ? originRef.current.height * zoom : undefined,
                    imageRendering: zoom > 2 ? "pixelated" : "auto",
                    cursor: picking ? PIPETTE_CURSOR : "default",
                  }}
                />
              </div>
            </div>

            {/* 缩放条 */}
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-1.5">
                <ZoomIn size={14} style={{ color: colors.muted }} />
                <Button size="sm" variant="ghost" onClick={() => setZoom((z) => Math.max(0.1, z * 0.87))} title={__ui("缩小")}>
                  <Minus size={13} />
                </Button>
                <input
                  type="range"
                  min={10}
                  max={800}
                  value={Math.round(zoom * 100)}
                  onChange={(e) => setZoom(Number(e.target.value) / 100)}
                  className="w-40"
                />
                <Button size="sm" variant="ghost" onClick={() => setZoom((z) => Math.min(8, z * 1.15))} title={__ui("放大")}>
                  <Plus size={13} />
                </Button>
                <span className="w-12 text-right font-mono text-[11.5px]" style={{ color: colors.text }}>{Math.round(zoom * 100)}%</span>
              </div>
              <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => {
                const wrap = wrapRef.current;
                if (!wrap || !originRef.current) return;
                setZoom(Math.min(1, wrap.clientWidth / originRef.current.width));
              }}>
                <Maximize size={13} /> {__ui("适应宽度")}</Button>
              <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => setZoom(1)}>
                100%
              </Button>
              <span className="flex items-center gap-1 text-[11.5px]" style={{ color: colors.muted }}>
                <ChevronsLeftRight size={12} /> {__ui("按住中键或拖动可平移 · Ctrl+滚轮缩放 · 点击画布可设定保护起点")}</span>
            </div>
          </section>

          {/* 参数区：自己滚动，拉下面的设置时画布位置不动 */}
          <div className="flex min-w-0 flex-col gap-4 overscroll-contain xl:sticky xl:top-4 xl:max-h-[calc(100vh-190px)] xl:overflow-y-auto xl:pr-1">
            <section className="rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
              <h3 className="mb-3 flex items-center gap-2 text-[12.5px] font-semibold" style={{ color: colors.muted }}>
                <Palette size={14} /> {__ui("01 取样与目标色")}</h3>
              {/* 竖排：这一列只有 340px，两组「色块 + 输入框」并排会溢出去 */}
              <div className="flex flex-col gap-3">
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11.5px]" style={{ color: colors.muted }}>{__ui("要替换的颜色")}</span>
                  <div className="flex items-center gap-2">
                    <input type="color" value={source} onChange={(e) => setSource(e.target.value.toUpperCase())} className="h-9 w-12 shrink-0 cursor-pointer rounded-lg border-0 bg-transparent" />
                    <Input value={source} onChange={(e) => setSource(e.target.value)} className="min-w-0 flex-1 font-mono text-[12px]" />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <span className="text-[11.5px]" style={{ color: colors.muted }}>{__ui("换成")}</span>
                  <div className="flex items-center gap-2">
                    <input type="color" value={target} onChange={(e) => setTarget(e.target.value.toUpperCase())} className="h-9 w-12 shrink-0 cursor-pointer rounded-lg border-0 bg-transparent" />
                    <Input value={target} onChange={(e) => setTarget(e.target.value)} className="min-w-0 flex-1 font-mono text-[12px]" />
                  </div>
                </div>
              </div>
              <p className="mt-2.5 flex items-start gap-1.5 text-[11px]" style={{ color: colors.muted }}>
                <Eye size={12} className="mt-0.5 shrink-0" />
                {picking ? __ui("已进入取色状态：鼠标移到左边图片上，针尖点哪里就取哪里的颜色。") : __ui("点「取样颜色」后可在图上直接吸取；点击画布其它位置可指定保护区域的起点。")}
              </p>
            </section>

            <section className="rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
              <h3 className="mb-3 text-[12.5px] font-semibold" style={{ color: colors.muted }}>{__ui("02 替换范围")}</h3>
              <label className="flex flex-col gap-1">
                <span className="flex items-center justify-between text-[12px]" style={{ color: colors.text }}>
                  <span>{__ui("颜色偏差")}</span>
                  <span className="font-mono">{tolerance}</span>
                </span>
                <input type="range" min={0} max={100} value={tolerance} onChange={(e) => setTolerance(Number(e.target.value))} />
                <span className="text-[11px]" style={{ color: colors.muted }}>{__ui("数值越大，包含更多相近颜色")}</span>
              </label>
              <label className="mt-3.5 flex flex-col gap-1">
                <span className="flex items-center justify-between text-[12px]" style={{ color: colors.text }}>
                  <span>{__ui("边缘柔化")}</span>
                  <span className="font-mono">{softness}%</span>
                </span>
                <input type="range" min={0} max={100} value={softness} onChange={(e) => setSoftness(Number(e.target.value))} />
                <span className="text-[11px]" style={{ color: colors.muted }}>{__ui("让边缘过渡更自然，避免锯齿")}</span>
              </label>
            </section>

            <section className="rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
              <h3 className="mb-3 text-[12.5px] font-semibold" style={{ color: colors.muted }}>{__ui("03 主体保护")}</h3>
              <div className="flex flex-col gap-3">
                {[
                  { label: "智能保护", desc: "只替换和取样点相连的区域", value: contiguous, set: setContiguous },
                  { label: "保留明暗层次", desc: "保留原区域明暗，只换色相", value: keepShading, set: setKeepShading },
                ].map((x) => (
                  <label key={x.label} className="flex cursor-pointer items-start justify-between gap-3">
                    <span>
                      <span className="block text-[12.5px] font-medium" style={{ color: colors.text }}>{__ui(x.label)}</span>
                      <span className="block text-[11px]" style={{ color: colors.muted }}>{__ui(x.desc)}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => x.set(!x.value)}
                      className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors"
                      style={{ background: x.value ? "hsl(var(--primary))" : colors.btnHover }}
                    >
                      <span
                        className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all"
                        style={{ left: x.value ? 18 : 2 }}
                      />
                    </button>
                  </label>
                ))}
              </div>
            </section>

            <section className="rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
              <h3 className="mb-3 text-[12.5px] font-semibold" style={{ color: colors.muted }}>{__ui("04 导出")}</h3>
              <div className="flex gap-2">
                {["png", "jpg", "webp", "bmp"].map((f) => (
                  <button
                    key={f}
                    onClick={() => setFormat(f)}
                    className="flex-1 rounded-lg border px-2 py-1.5 text-[12px] font-medium uppercase transition-all"
                    style={{
                      borderColor: format === f ? "hsl(var(--primary))" : colors.borderSolid,
                      background: format === f ? colors.active : "transparent",
                      color: colors.text,
                    }}
                  >
                    {f}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex gap-2">
                <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={undo} disabled={undoRef.current.length === 0}>
                  <Undo2 size={13} /> {__ui("撤销")}</Button>
                <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={redo} disabled={redoRef.current.length === 0}>
                  <Redo2 size={13} /> {__ui("重做")}</Button>
                <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={reset}>
                  <RotateCcw size={13} /> {__ui("还原")}</Button>
              </div>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
