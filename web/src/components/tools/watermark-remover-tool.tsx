"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/watermark-remover-tool.tsx");


/**
 * 去水印
 *
 * 左边是图片本体，右边是操作（遵循「左文档右操作」的布局规范）：
 *  · 在图上直接拖出矩形（水印多在角落，一个框就够）；
 *  · 或者用画笔沿着水印涂过去（适合细长/不规则的水印）；
 *  · 也可以点「自动检测浅色水印」，让程序把淡灰日期戳这类水印自己找出来。
 * 画好的范围会以半透明红色叠加显示，随时可「撤销一笔」「清空」。
 *
 * 处理在本机完成，图片不上传。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Brush, Eraser, Loader2, RotateCcw, ScanSearch, Square, Wand2 } from "lucide-react";
import { Button, Select } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useTheme } from "@/components/theme-provider";
import { EmptyDropzone as DropzoneEmpty } from "@/components/tools/dropzone-empty";
import { cn } from "@/lib/utils";
import { consumePendingFiles } from "@/lib/file-handoff";
import { getWatermarkModel, submitWatermarkJob, type WatermarkResult } from "@/lib/watermark-job";
import { WatermarkResultPreview } from "@/components/tools/watermark-result-preview";
import { WatermarkModelNotice } from "@/components/tools/watermark-model-notice";

type Rect = { x: number; y: number; w: number; h: number };
type Stroke = { points: [number, number][]; brush: number };
type Shape = { kind: "rect"; rect: Rect } | { kind: "stroke"; stroke: Stroke };

const MAX_SIDE = 1400;

export function WatermarkRemoverTool() {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState("");
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [shapes, setShapes] = useState<Shape[]>([]);
  const [tool, setTool] = useState<"rect" | "brush">("rect");
  const [brushSize, setBrushSize] = useState(28);
  const [radius, setRadius] = useState("4");
  const [method, setMethod] = useState("telea");
  const [autoLight, setAutoLight] = useState(true);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [drag, setDrag] = useState<Rect | null>(null);

  const [result, setResult] = useState<WatermarkResult | null>(null);
  const [error, setError] = useState("");
  const operation = useRef<AbortController | null>(null);
  const resultAnchor = useRef<HTMLDivElement>(null);
  useEffect(() => () => { operation.current?.abort(); operation.current = null; }, []);
  useEffect(() => { return () => { if (imageUrl) URL.revokeObjectURL(imageUrl); }; }, [imageUrl]);
  useEffect(() => {
    if (result) resultAnchor.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [result?.jobId]);

  const imgRef = useRef<HTMLImageElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef<{ pointerId: number; tool: "rect" | "brush"; brush: number; startX: number; startY: number; points: [number, number][] } | null>(null);

  const loadFile = useCallback((files: File[]) => {
    const f = files[0];
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      toast({ title: "请选择图片文件", variant: "error" });
      return;
    }
    operation.current?.abort(); operation.current = null;
    setBusy(false); setProgress(""); setError(""); setResult(null);
    drawingRef.current = null;
    setDrag(null);
    setFile(f);
    setImageUrl(URL.createObjectURL(f));
    setShapes([]);
    setSize(null);
  }, [toast]);

  const resetInput = useCallback(() => {
    operation.current?.abort(); operation.current = null;
    drawingRef.current = null;
    setBusy(false); setProgress(""); setError(""); setResult(null);
    setDrag(null); setShapes([]); setSize(null); setFile(null); setImageUrl("");
    // No picker: the initial dropzone owns the next user-selected input.
  }, []);

  // 监听并自动载入来自悬浮球或外部拖拽的待办文件
  useEffect(() => {
    const onInject = (e: Event) => {
      const incoming = (e as CustomEvent<File[]>).detail;
      if (incoming && incoming.length > 0) {
        loadFile(incoming);
      }
    };
    window.addEventListener("furinakit:inject-files", onInject);

    const handoff = consumePendingFiles();
    if (handoff && handoff.length > 0) {
      loadFile(handoff);
    }

    return () => window.removeEventListener("furinakit:inject-files", onInject);
  }, [loadFile]);

  /** 图片载入后按显示尺寸画到 canvas 上 */
  const onImageLoad = useCallback((event: React.SyntheticEvent<HTMLImageElement>) => {
    const img = imgRef.current;
    const canvas = canvasRef.current;
    if (!img || !canvas || event.currentTarget !== img) return;
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
    setSize({ w: canvas.width, h: canvas.height });
  }, []);

  /** 每次 shapes 变化重画：图片 + 叠加层 */
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !size) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.fillStyle = "rgba(239,68,68,0.42)";
    ctx.strokeStyle = "rgba(239,68,68,0.95)";
    ctx.lineWidth = 2;
    const active = drawingRef.current;
    const visibleShapes: Shape[] = active?.tool === "brush"
      ? [...shapes, { kind: "stroke", stroke: { points: active.points, brush: active.brush } }]
      : shapes;
    for (const s of visibleShapes) {
      if (s.kind === "rect") {
        ctx.fillRect(s.rect.x, s.rect.y, s.rect.w, s.rect.h);
        ctx.strokeRect(s.rect.x, s.rect.y, s.rect.w, s.rect.h);
      } else {
        const pts = s.stroke.points;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        ctx.lineWidth = s.stroke.brush;
        ctx.globalAlpha = 0.42;
        ctx.beginPath();
        pts.forEach(([x, y], i) => (i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)));
        if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.1, pts[0][1]);
        ctx.stroke();
        ctx.globalAlpha = 1;
      }
    }
    if (drag) {
      ctx.setLineDash([6, 4]);
      ctx.strokeStyle = "rgba(37,99,235,0.95)";
      ctx.fillStyle = "rgba(37,99,235,0.22)";
      ctx.fillRect(drag.x, drag.y, drag.w, drag.h);
      ctx.strokeRect(drag.x, drag.y, drag.w, drag.h);
      ctx.setLineDash([]);
    }
    ctx.restore();
  }, [shapes, drag, size]);

  const posOf = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: Math.max(0, Math.min(canvas.width, ((e.clientX - rect.left) / rect.width) * canvas.width)),
      y: Math.max(0, Math.min(canvas.height, ((e.clientY - rect.top) / rect.height) * canvas.height)),
    };
  };

  const onDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (busy || e.button !== 0 || drawingRef.current) return;
    const p = posOf(e);
    if (!p) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    drawingRef.current = { pointerId: e.pointerId, tool, brush: brushSize, startX: p.x, startY: p.y, points: [[p.x, p.y]] };
    setDrag({ x: p.x, y: p.y, w: 0, h: 0 });
  };

  const onMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drawingRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const p = posOf(e);
    if (!p) return;
    if (d.tool === "rect") {
      setDrag({ x: Math.min(d.startX, p.x), y: Math.min(d.startY, p.y), w: Math.abs(p.x - d.startX), h: Math.abs(p.y - d.startY) });
    } else {
      d.points.push([p.x, p.y]);
      setDrag({ x: p.x, y: p.y, w: 0, h: 0 });
    }
  };

  const onCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (drawingRef.current?.pointerId !== e.pointerId) return;
    drawingRef.current = null;
    setDrag(null);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  };

  const onUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const d = drawingRef.current;
    if (!d || d.pointerId !== e.pointerId) return;
    // Use the release position directly, never a potentially stale React render/ref.
    const p = posOf(e);
    onCancel(e);
    if (!p) return;
    if (d.tool === "rect") {
      const rect = { x: Math.min(d.startX, p.x), y: Math.min(d.startY, p.y), w: Math.abs(p.x - d.startX), h: Math.abs(p.y - d.startY) };
      if (rect.w > 3 && rect.h > 3) setShapes((s) => [...s, { kind: "rect", rect }]);
    } else {
      d.points.push([p.x, p.y]);
      setShapes((s) => [...s, { kind: "stroke", stroke: { points: d.points, brush: d.brush } }]);
    }
  };

  const undo = () => setShapes((s) => s.slice(0, -1));
  const clear = () => setShapes([]);

  /** 提交任务：把画好的范围换算回原图坐标 */
  const run = async () => {
    if (!file || !size || operation.current) return;
    if (shapes.length === 0 && !autoLight) {
      toast({ title: "请先在图上框出或涂出要抹掉的部分", variant: "info" });
      return;
    }
    const ctrl = new AbortController();
    operation.current = ctrl;
    const owned = () => operation.current === ctrl && !ctrl.signal.aborted;
    setBusy(true); setError(""); setProgress("正在处理…");
    try {
      const img = imgRef.current;
      if (!img || !img.naturalWidth || !img.naturalHeight) throw new Error("图片尚未载入，请稍后重试");
      const kx = img.naturalWidth / size.w, ky = img.naturalHeight / size.h;
      const rects: Rect[] = [];
      const strokes: Stroke[] = [];
      for (const s of shapes) {
        if (s.kind === "rect") rects.push({ x: s.rect.x * kx, y: s.rect.y * ky, w: s.rect.w * kx, h: s.rect.h * ky });
        else strokes.push({ points: s.stroke.points.map(([x, y]) => [x * kx, y * ky] as [number, number]), brush: Math.max(2, Math.round(s.stroke.brush * kx)) });
      }
      const fd = new FormData();
      fd.append("file", file);
      fd.append("regions", JSON.stringify(rects)); fd.append("strokes", JSON.stringify(strokes));
      fd.append("brush", String(Math.max(2, Math.round(brushSize * kx))));
      fd.append("method", method); fd.append("radius", radius); fd.append("auto_light", autoLight ? "yes" : "no");
      if (method === "lama") {
        const model = await getWatermarkModel(ctrl.signal);
        if (!owned()) return;
        if (!model.ready) throw new Error("精细修复需要 LaMa 模型，请点击下方“下载 / 管理模型”；首次下载需要联网。");
        fd.append("model_path", model.path);
      }
      const completed = await submitWatermarkJob(fd, ctrl.signal, text => { if (owned()) setProgress(text); });
      if (!owned()) return;
      setResult(completed); setProgress("处理完成，可直接查看效果并与原图对比");
      toast({ title: "处理完成", description: "已生成效果预览，满意后点击保存", variant: "success" });
    } catch (err) {
      if (!owned()) return;
      const message = err instanceof Error ? err.message : "处理失败，请重试";
      setError(message); setProgress("");
      toast({ title: "处理失败", description: message, variant: "error" });
    } finally {
      if (owned()) { operation.current = null; setBusy(false); }
    }
  };

  if (!imageUrl) {
    return (
      <div className="flex flex-col gap-4">
        <DropzoneEmpty
          title={__ui("点击选择图片，或将文件拖拽到此处")}
          subtitle={__ui("在图上框出或涂出水印位置，程序会用周围像素补回来")}
          hint={__ui("支持 PNG / JPG / WEBP，图片只在本机处理")}
          accept="image/*"
          onFiles={loadFile}
        />
      </div>
    );
  }

  const rectCount = shapes.filter((s) => s.kind === "rect").length;
  const strokeCount = shapes.filter((s) => s.kind === "stroke").length;

  return (
    <div className="flex flex-col gap-4">
      {result && <div ref={resultAnchor} className="scroll-mt-4"><WatermarkResultPreview key={result.jobId} result={result} originalUrl={imageUrl} busy={busy} /></div>}
      <div className="grid items-start gap-4 xl:grid-cols-[1fr_340px]">
        {/* 左：图片与标注 */}
        <section className="min-w-0 rounded-2xl border p-4" style={{ borderColor: colors.borderSolid, background: colors.card }}>
          <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <span className="truncate text-[12.5px] font-medium" style={{ color: colors.text }}>{file?.name}</span>
              <span className="shrink-0 text-[11.5px]" style={{ color: colors.muted }}>
                {size ? __msg("{0} × {1} 预览", size.w, size.h) : ""} {__ui("· 已标注")}{rectCount} {__ui("个框 /")}{strokeCount} {__ui("笔")}</span>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="ghost" onClick={resetInput}><RotateCcw size={13} />{__ui("重新输入")}</Button>
              <Button size="sm" disabled={busy} variant={tool === "rect" ? "default" : "outline"} className="gap-1.5" onClick={() => setTool("rect")}>
                <Square size={13} /> {__ui("框选")}</Button>
              <Button size="sm" disabled={busy} variant={tool === "brush" ? "default" : "outline"} className="gap-1.5" onClick={() => setTool("brush")}>
                <Brush size={13} /> {__ui("画笔")}</Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={undo} disabled={busy || shapes.length === 0}>
                <RotateCcw size={13} /> {__ui("撤销一笔")}</Button>
              <Button size="sm" variant="ghost" className="gap-1.5" onClick={clear} disabled={busy || shapes.length === 0}>
                <Eraser size={13} /> {__ui("清空")}</Button>
            </div>
          </header>

          <div
            className="relative overflow-auto rounded-xl p-3"
            style={{
              background: colors.bg,
              backgroundImage:
                "linear-gradient(45deg, rgba(127,127,127,0.10) 25%, transparent 25%), linear-gradient(-45deg, rgba(127,127,127,0.10) 25%, transparent 25%)",
              backgroundSize: "18px 18px",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img key={imageUrl} ref={imgRef} src={imageUrl} alt={__ui("待处理图片")} onLoad={onImageLoad} onError={() => { setSize(null); setError("图片无法预览，请更换 PNG、JPG 或 WEBP 图片"); }} className="hidden" />
            <div className="flex justify-center">
              <canvas
                ref={canvasRef}
                onPointerDown={onDown}
                onPointerMove={onMove}
                onPointerUp={onUp}
                onPointerCancel={onCancel}
                onLostPointerCapture={onCancel}
                className="max-w-full cursor-crosshair rounded-lg"
                style={{ imageRendering: "auto", touchAction: "none" }}
              />
            </div>
          </div>
          <p className="mt-2.5 text-[11.5px]" style={{ color: colors.muted }}>
            {tool === "rect" ? __ui("在图上按住鼠标拖出矩形，把水印整个框住（框得稍大一点更保险）。") : __ui("按住鼠标沿着水印涂过去，画笔粗细可在右侧调整。")}
            {__ui("红色区域就是会被抹掉并补全的部分。")}</p>
        </section>

        {/* 右：操作 */}
        <div className="flex min-w-0 flex-col gap-4">
          <section className="rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
            <h3 className="mb-3.5 text-[12.5px] font-semibold" style={{ color: colors.muted }}>{__ui("处理设置")}</h3>

            <label className="flex flex-col gap-1.5">
              <span className="text-[12px]" style={{ color: colors.muted }}>{__ui("处理方式")}</span>
              <Select value={method} disabled={busy} onChange={(e) => setMethod(e.target.value)}>
                <option value="telea">{__ui("极速修补（内置 Telea，无需下载）")}</option>
                <option value="ns">{__ui("平滑修补（内置 NS，无需下载）")}</option>
                <option value="lama">{__ui("精细修复（LaMa）")}</option>
              </Select>
            </label>
            {method === "lama" && <WatermarkModelNotice />}

            <label className="mt-3.5 flex flex-col gap-1">
              <span className="flex items-center justify-between text-[12px]" style={{ color: colors.muted }}>
                <span>{__ui("修补半径")}</span><span className="font-mono" style={{ color: colors.text }}>{radius}</span>
              </span>
              <input type="range" min={1} max={12} value={Number(radius)} onChange={(e) => setRadius(e.target.value)} />
              <span className="text-[11px]" style={{ color: colors.muted }}>{__ui("数值越大越平滑，太大可能把细节抹平")}</span>
            </label>

            {tool === "brush" && (
              <label className="mt-3.5 flex flex-col gap-1">
                <span className="flex items-center justify-between text-[12px]" style={{ color: colors.muted }}>
                  <span>{__ui("画笔粗细")}</span><span className="font-mono" style={{ color: colors.text }}>{brushSize}px</span>
                </span>
                <input type="range" min={6} max={80} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} />
              </label>
            )}

            <label className="mt-4 flex cursor-pointer items-start gap-2.5">
              <button
                type="button"
                onClick={() => setAutoLight((v) => !v)}
                className="relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors"
                style={{ background: autoLight ? "hsl(var(--primary))" : colors.btnHover }}
              >
                <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all" style={{ left: autoLight ? 18 : 2 }} />
              </button>
              <span>
                <span className="flex items-center gap-1.5 text-[12.5px] font-medium" style={{ color: colors.text }}>
                  <ScanSearch size={13} /> {__ui("自动检测浅色水印")}</span>
                <span className="mt-0.5 block text-[11px]" style={{ color: colors.muted }}>
                  {__ui("适合淡灰日期戳、半透明白字这类水印，会与手动标注叠加")}</span>
              </span>
            </label>
          </section>

          <section className="rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
            <Button className="w-full gap-2" onClick={() => void run()} disabled={busy || !size}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
              {busy ? progress || __ui("正在处理…") : __ui("开始去水印")}
            </Button>
            {progress && !busy && <p role="status" className="mt-3 text-xs" style={{ color: colors.muted }}>{progress}</p>}
            {error && <p role="alert" className="mt-3 rounded-xl bg-destructive/10 p-3 text-xs leading-5 text-destructive">{__msg(error)}</p>}
            <p className={cn("mt-3 text-[11.5px] leading-relaxed")} style={{ color: colors.muted }}>
              {__ui("处理在本机完成，图片不会上传。建议先用「极速修补」试一次：多数纯色或规则背景上的水印， 这一档就足够干净，而且不需要下载任何模型。")}</p>
          </section>
        </div>
      </div>
    </div>
  );
}
