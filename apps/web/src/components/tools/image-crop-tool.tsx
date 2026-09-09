"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Download, Trash2, Scissors } from "lucide-react";
import { Button, Input } from "@/components/ui/primitives";
import { FileDropzone } from "@/components/tools/file-dropzone";
import { useToast } from "@/components/ui/toast";
import { formatBytes, cn } from "@/lib/utils";

type Rect = { x: number; y: number; w: number; h: number };
type Handle = "move" | "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";
type RatioMode = "free" | "original" | "1:1" | "4:3" | "16:9" | "custom";
type OutFormat = "jpeg" | "png" | "webp";

const MIN_SIZE = 24; // 最小显示像素

const HANDLES: { id: Handle; className: string; cursor: string }[] = [
  { id: "nw", className: "left-0 top-0 -translate-x-1/2 -translate-y-1/2", cursor: "nwse-resize" },
  { id: "n",  className: "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2", cursor: "ns-resize" },
  { id: "ne", className: "right-0 top-0 translate-x-1/2 -translate-y-1/2", cursor: "nesw-resize" },
  { id: "e",  className: "right-0 top-1/2 translate-x-1/2 -translate-y-1/2", cursor: "ew-resize" },
  { id: "se", className: "right-0 bottom-0 translate-x-1/2 translate-y-1/2", cursor: "nwse-resize" },
  { id: "s",  className: "left-1/2 bottom-0 -translate-x-1/2 translate-y-1/2", cursor: "ns-resize" },
  { id: "sw", className: "left-0 bottom-0 -translate-x-1/2 translate-y-1/2", cursor: "nesw-resize" },
  { id: "w",  className: "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2", cursor: "ew-resize" },
];

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

export function ImageCropTool() {
  const { toast } = useToast();
  const [files, setFiles] = useState<File[]>([]);
  const [srcUrl, setSrcUrl] = useState<string | null>(null);
  const [display, setDisplay] = useState({ w: 0, h: 0 });
  const [natural, setNatural] = useState({ w: 0, h: 0 });
  const [rect, setRect] = useState<Rect>({ x: 0, y: 0, w: 0, h: 0 });

  // 比例与格式控制（对标 docsmall）
  const [ratioMode, setRatioMode] = useState<RatioMode>("free");
  const [customW, setCustomW] = useState("16");
  const [customH, setCustomH] = useState("10");
  const [appliedCustomRatio, setAppliedCustomRatio] = useState<number | null>(null);
  const [format, setFormat] = useState<OutFormat>("jpeg");
  const [isCropping, setIsCropping] = useState(false);

  const imgRef = useRef<HTMLImageElement>(null);
  const drag = useRef<{ mode: Handle; startX: number; startY: number; start: Rect } | null>(null);

  const file = files[0] ?? null;

  useEffect(() => {
    if (!file) {
      setSrcUrl(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setSrcUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  // 根据当前选择的比例计算对应比值
  const getNumericRatio = useCallback((): number | null => {
    if (ratioMode === "free") return null;
    if (ratioMode === "1:1") return 1;
    if (ratioMode === "4:3") return 4 / 3;
    if (ratioMode === "16:9") return 16 / 9;
    if (ratioMode === "original") {
      return natural.w && natural.h ? natural.w / natural.h : null;
    }
    if (ratioMode === "custom") {
      return appliedCustomRatio;
    }
    return null;
  }, [ratioMode, natural, appliedCustomRatio]);

  // 重置裁剪框到指定比例的居中最大区域
  const applyRatioToCenter = useCallback(
    (ratio: number | null, dw = display.w, dh = display.h) => {
      if (dw <= 0 || dh <= 0) return;
      if (ratio === null) {
        // 自由比例：居中 80%
        setRect({ x: dw * 0.1, y: dh * 0.1, w: dw * 0.8, h: dh * 0.8 });
        return;
      }

      let rw = dw * 0.85;
      let rh = rw / ratio;
      if (rh > dh * 0.85) {
        rh = dh * 0.85;
        rw = rh * ratio;
      }
      const rx = (dw - rw) / 2;
      const ry = (dh - rh) / 2;
      setRect({ x: Math.max(0, rx), y: Math.max(0, ry), w: rw, h: rh });
    },
    [display]
  );

  // 图片加载完成后初次测量
  const measure = useCallback(() => {
    const img = imgRef.current;
    if (!img) return;
    const w = img.clientWidth;
    const h = img.clientHeight;
    setDisplay({ w, h });
    setNatural({ w: img.naturalWidth, h: img.naturalHeight });
    applyRatioToCenter(getNumericRatio(), w, h);
  }, [applyRatioToCenter, getNumericRatio]);

  // 比例切换时自动重设裁剪框
  const handleRatioChange = (mode: RatioMode) => {
    setRatioMode(mode);
    if (mode === "custom") {
      const numW = parseFloat(customW);
      const numH = parseFloat(customH);
      if (numW > 0 && numH > 0) {
        const r = numW / numH;
        setAppliedCustomRatio(r);
        applyRatioToCenter(r);
      }
    } else {
      let r: number | null = null;
      if (mode === "1:1") r = 1;
      else if (mode === "4:3") r = 4 / 3;
      else if (mode === "16:9") r = 16 / 9;
      else if (mode === "original" && natural.w && natural.h) r = natural.w / natural.h;
      applyRatioToCenter(r);
    }
  };

  const handleApplyCustom = () => {
    const numW = parseFloat(customW);
    const numH = parseFloat(customH);
    if (!numW || !numH || numW <= 0 || numH <= 0) {
      toast({ title: "请输入有效的自定义比例", variant: "error" });
      return;
    }
    const r = numW / numH;
    setAppliedCustomRatio(r);
    setRatioMode("custom");
    applyRatioToCenter(r);
    toast({ title: `已设置自定义比例 ${numW}:${numH}`, variant: "info" });
  };

  // 窗口改变时自适应缩放
  useEffect(() => {
    if (!srcUrl) return;
    const onResize = () => {
      const img = imgRef.current;
      if (!img || !img.clientWidth) return;
      setDisplay((prev) => {
        const w = img.clientWidth;
        const h = img.clientHeight;
        if (prev.w === 0) return prev;
        const sx = w / prev.w;
        const sy = h / prev.h;
        setRect((r) => ({ x: r.x * sx, y: r.y * sy, w: r.w * sx, h: r.h * sy }));
        return { w, h };
      });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [srcUrl]);

  // 拖动处理
  const startDrag = (mode: Handle) => (e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = { mode, startX: e.clientX, startY: e.clientY, start: { ...rect } };
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      const { w: DW, h: DH } = display;
      const activeRatio = getNumericRatio();

      if (d.mode === "move") {
        const nx = clamp(d.start.x + dx, 0, DW - d.start.w);
        const ny = clamp(d.start.y + dy, 0, DH - d.start.h);
        setRect((r) => ({ ...r, x: nx, y: ny }));
        return;
      }

      // 手柄缩放裁剪框
      let left = d.start.x;
      let top = d.start.y;
      let right = d.start.x + d.start.w;
      let bottom = d.start.y + d.start.h;

      if (activeRatio === null) {
        // 自由比例
        if (d.mode.includes("w")) left = clamp(d.start.x + dx, 0, right - MIN_SIZE);
        if (d.mode.includes("n")) top = clamp(d.start.y + dy, 0, bottom - MIN_SIZE);
        if (d.mode.includes("e")) right = clamp(d.start.x + d.start.w + dx, left + MIN_SIZE, DW);
        if (d.mode.includes("s")) bottom = clamp(d.start.y + d.start.h + dy, top + MIN_SIZE, DH);
      } else {
        // 锁定比例
        if (d.mode === "se" || d.mode === "e" || d.mode === "s") {
          let newW = clamp(d.start.w + dx, MIN_SIZE, DW - left);
          let newH = newW / activeRatio;
          if (top + newH > DH) {
            newH = DH - top;
            newW = newH * activeRatio;
          }
          right = left + newW;
          bottom = top + newH;
        } else if (d.mode === "sw" || d.mode === "w") {
          let newW = clamp(d.start.w - dx, MIN_SIZE, right);
          let newH = newW / activeRatio;
          if (top + newH > DH) {
            newH = DH - top;
            newW = newH * activeRatio;
          }
          left = right - newW;
          bottom = top + newH;
        } else if (d.mode === "ne") {
          let newW = clamp(d.start.w + dx, MIN_SIZE, DW - left);
          let newH = newW / activeRatio;
          if (bottom - newH < 0) {
            newH = bottom;
            newW = newH * activeRatio;
          }
          right = left + newW;
          top = bottom - newH;
        } else if (d.mode === "nw" || d.mode === "n") {
          let newW = clamp(d.start.w - dx, MIN_SIZE, right);
          let newH = newW / activeRatio;
          if (bottom - newH < 0) {
            newH = bottom;
            newW = newH * activeRatio;
          }
          left = right - newW;
          top = bottom - newH;
        }
      }

      setRect({
        x: Math.max(0, left),
        y: Math.max(0, top),
        w: Math.max(MIN_SIZE, right - left),
        h: Math.max(MIN_SIZE, bottom - top),
      });
    };

    const onUp = () => {
      drag.current = null;
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [display, getNumericRatio]);

  const scaleX = display.w ? natural.w / display.w : 1;
  const scaleY = display.h ? natural.h / display.h : 1;
  const cropPx = {
    x: Math.round(rect.x * scaleX),
    y: Math.round(rect.y * scaleY),
    w: Math.round(rect.w * scaleX),
    h: Math.round(rect.h * scaleY),
  };

  const doCropAndDownload = () => {
    const img = imgRef.current;
    if (!img || cropPx.w < 1 || cropPx.h < 1 || !file) return;
    setIsCropping(true);

    setTimeout(() => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = cropPx.w;
        canvas.height = cropPx.h;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("创建画布失败");

        // 若导出为 JPEG，先填充纯白背景底
        if (format === "jpeg") {
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, cropPx.w, cropPx.h);
        }

        ctx.drawImage(img, cropPx.x, cropPx.y, cropPx.w, cropPx.h, 0, 0, cropPx.w, cropPx.h);

        const mime = format === "jpeg" ? "image/jpeg" : format === "webp" ? "image/webp" : "image/png";
        const ext = format === "jpeg" ? "jpg" : format;
        const quality = format === "png" ? undefined : 0.95;

        canvas.toBlob(
          (blob) => {
            if (!blob) throw new Error("裁剪失败");
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            const base = file.name.replace(/\.[^.]+$/, "");
            a.href = url;
            a.download = `${base}-cropped.${ext}`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 4000);
            setIsCropping(false);
            toast({
              title: "图片裁剪成功并已开始下载！",
              description: `尺寸: ${cropPx.w}×${cropPx.h} · ${formatBytes(blob.size)}`,
              variant: "success",
            });
          },
          mime,
          quality
        );
      } catch (err) {
        setIsCropping(false);
        toast({ title: "裁剪失败", description: String(err), variant: "error" });
      }
    }, 40);
  };

  const reset = () => {
    setFiles([]);
    setSrcUrl(null);
  };

  return (
    <div className="space-y-5 max-w-6xl mx-auto">
      {/* 顶部工具栏说明 */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-xs text-center space-y-1">
        <h2 className="text-xl font-bold text-foreground">免费在线图片裁剪工具</h2>
        <p className="text-xs text-muted-foreground">自由或按比例裁剪图片，可按需求存储为不同格式</p>
      </div>

      {!srcUrl && (
        <FileDropzone
          files={files}
          onChange={setFiles}
          accept={{ "image/*": [".png", ".jpg", ".jpeg", ".webp"] }}
        />
      )}

      {srcUrl && (
        <div className="space-y-4">
          {/* 对标 docsmall 的控制栏 */}
          <div className="rounded-2xl border-2 border-primary/40 bg-card p-5 shadow-sm space-y-4">
            {/* 裁剪比例行 */}
            <div className="flex flex-wrap items-center gap-4">
              <span className="text-xs font-bold text-primary shrink-0 w-16">裁剪比例</span>
              <div className="flex flex-wrap items-center gap-1.5 bg-muted/60 p-1 rounded-xl border border-border/80">
                {[
                  { id: "free", label: "自由比例" },
                  { id: "original", label: "原图比例" },
                  { id: "1:1", label: "1 : 1" },
                  { id: "4:3", label: "4 : 3" },
                  { id: "16:9", label: "16 : 9" },
                  { id: "custom", label: "自定义比例" },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleRatioChange(item.id as RatioMode)}
                    className={cn(
                      "px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all",
                      ratioMode === item.id
                        ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                        : "text-muted-foreground hover:text-foreground hover:bg-background/80"
                    )}
                  >
                    {item.label}
                  </button>
                ))}
              </div>

              {/* 当选中自定义比例时的宽高输入框 */}
              {ratioMode === "custom" && (
                <div className="flex items-center gap-2 pl-2 animate-fade-in-up">
                  <Input
                    type="number"
                    value={customW}
                    onChange={(e) => setCustomW(e.target.value)}
                    placeholder="宽度"
                    className="h-8 w-20 text-xs"
                    min={1}
                  />
                  <span className="text-xs text-muted-foreground">:</span>
                  <Input
                    type="number"
                    value={customH}
                    onChange={(e) => setCustomH(e.target.value)}
                    placeholder="高度"
                    className="h-8 w-20 text-xs"
                    min={1}
                  />
                  <Button size="sm" onClick={handleApplyCustom} className="h-8 px-3 text-xs">
                    确定
                  </Button>
                </div>
              )}
            </div>

            {/* 存储格式与动作按钮行 */}
            <div className="flex flex-wrap items-center justify-between gap-4 pt-3 border-t border-border/60">
              <div className="flex items-center gap-4">
                <span className="text-xs font-bold text-primary shrink-0 w-16">存储格式</span>
                <div className="flex items-center gap-1.5 bg-muted/60 p-1 rounded-xl border border-border/80">
                  {(["jpeg", "png", "webp"] as const).map((fmt) => (
                    <button
                      key={fmt}
                      type="button"
                      onClick={() => setFormat(fmt)}
                      className={cn(
                        "px-4 py-1 rounded-lg text-xs font-medium uppercase transition-all",
                        format === fmt
                          ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                          : "text-muted-foreground hover:text-foreground hover:bg-background/80"
                      )}
                    >
                      {fmt === "jpeg" ? "JPG" : fmt}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={reset}
                  className="gap-1.5 text-xs text-muted-foreground hover:text-destructive hover:border-destructive"
                >
                  <Trash2 size={14} /> 清除文件
                </Button>

                <Button
                  size="sm"
                  onClick={doCropAndDownload}
                  disabled={isCropping}
                  className="gap-2 px-6 shadow-sm text-xs font-semibold"
                >
                  {isCropping ? <Scissors size={14} className="animate-spin" /> : <Download size={14} />}
                  {isCropping ? "裁剪中…" : "下载裁剪文件"}
                </Button>
              </div>
            </div>
          </div>

          {/* 大视口裁剪工作台（九宫格辅助线与高亮边框） */}
          <div className="flex justify-center rounded-2xl border-2 border-primary/20 bg-background/90 p-6 overflow-hidden shadow-inner">
            <div className="relative inline-block select-none leading-none">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={imgRef}
                src={srcUrl}
                alt="待裁剪原图"
                onLoad={measure}
                draggable={false}
                className="block max-h-[65vh] max-w-full rounded-md"
              />

              {display.w > 0 && (
                <div
                  className="absolute cursor-move border-2 border-primary shadow-[0_0_0_9999px_rgba(0,0,0,0.58)] transition-[border-color]"
                  style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
                  onPointerDown={startDrag("move")}
                >
                  {/* 九宫格辅助参考线 (Rule of Thirds) */}
                  <div className="pointer-events-none absolute inset-0">
                    <div className="absolute left-1/3 top-0 h-full w-px border-r border-dashed border-white/40" />
                    <div className="absolute left-2/3 top-0 h-full w-px border-r border-dashed border-white/40" />
                    <div className="absolute top-1/3 left-0 w-full h-px border-b border-dashed border-white/40" />
                    <div className="absolute top-2/3 left-0 w-full h-px border-b border-dashed border-white/40" />
                  </div>

                  {/* 8 个高亮手柄 */}
                  {HANDLES.map((handle) => (
                    <span
                      key={handle.id}
                      onPointerDown={startDrag(handle.id)}
                      style={{ cursor: handle.cursor }}
                      className={cn(
                        "absolute h-3.5 w-3.5 rounded-[3px] border-2 border-white bg-primary shadow-md transition-transform hover:scale-125",
                        handle.className
                      )}
                    />
                  ))}

                  {/* 实时尺寸悬浮徽标 */}
                  <span className="pointer-events-none absolute -top-7 left-0 whitespace-nowrap rounded-md bg-primary px-2 py-0.5 text-[11px] font-mono font-bold text-primary-foreground shadow-md">
                    {cropPx.w} × {cropPx.h} px
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
