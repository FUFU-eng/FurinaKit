"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage, uiCount as __count } from "@/lib/language";
const __ui = __createUiText("components/tools/pdf-crop-tool.tsx");


/**
 * PDF 页面裁剪
 *
 * 与「填四个数字」的做法不同，这里是可视化操作：
 *  · 左侧实时预览当前页，页面上有一个可拖动的裁剪框（四角 + 四边共 8 个控制点）；
 *  · 右侧给出毫米精度的四个边距，与裁剪框双向同步；
 *  · 支持全部页面 / 仅当前页两种作用范围，可把当前设置套用到全部页面；
 *  · 底部是页面缩略图，已裁剪的页面会打上标记；
 *  · 带撤销 / 重做与「自动边距」（按内容外接框留出统一留白）。
 *
 * 导出仍走无头渲染：只改页面边界（CropBox），文字可选中搜索、清晰度不变。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle, ChevronLeft, ChevronRight, Crop, Download, FileUp, Layers, Loader2, Trash2,
  Maximize2, Minus, Plus, Redo2, RotateCcw, Shield, Undo2, Wand2, ZoomIn,
  Upload,
} from "lucide-react";
import { Button, Input, Select } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";
import { downloadJobResult } from "@/lib/job-download";

type Margins = { top: number; bottom: number; left: number; right: number };
type PageSize = { width_mm: number; height_mm: number };

const EMPTY: Margins = { top: 0, bottom: 0, left: 0, right: 0 };
const PT_PER_MM = 72 / 25.4;

export function PdfCropTool() {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  const { toast } = useToast();

  const [file, setFile] = useState<File | null>(null);
  const [pdf, setPdf] = useState<{ numPages: number; getPage: (n: number) => Promise<unknown> } | null>(null);
  const [pageSizes, setPageSizes] = useState<PageSize[]>([]);
  const [pageIndex, setPageIndex] = useState(0);
  const [zoom, setZoom] = useState(1);
  const [unit, setUnit] = useState<"mm" | "percent">("mm");
  const [scope, setScope] = useState<"all" | "current">("all");
  const [margins, setMargins] = useState<Record<number, Margins>>({});
  const [undoStack, setUndoStack] = useState<Record<number, Margins>[]>([]);
  const [redoStack, setRedoStack] = useState<Record<number, Margins>[]>([]);
  const [dragging, setDragging] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [thumbUrls, setThumbUrls] = useState<string[]>([]);
  /** 100% 缩放时页面在屏幕上的 CSS 尺寸（绘制与显示解耦：画布按固定倍率渲染，显示靠 CSS 缩放） */
  const [pageCss, setPageCss] = useState<{ w: number; h: number } | null>(null);
  /** 正在用鼠标拖画的新裁剪框（相对页面左上角的 CSS 像素） */
  const [drawRect, setDrawRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [fitting, setFitting] = useState(true);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const drawRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  drawRectRef.current = drawRect;
  const dragRef = useRef<{
    handle: string;
    startX: number;
    startY: number;
    start: Margins;
    scale: number;
  } | null>(null);

  const current = margins[pageIndex] ?? EMPTY;
  const size = pageSizes[pageIndex];

  /** 换一个文件：清掉当前解析结果，回到选择界面 */
  const clearFile = useCallback(() => {
    setFile(null);
    setPdf(null);
    setPageSizes([]);
    setMargins({});
    setUndoStack([]);
    setRedoStack([]);
    setThumbUrls([]);
    setPageIndex(0);
    setPageCss(null);
    setZoom(1);
    setFitting(true);
    if (fileRef.current) fileRef.current.value = "";
    toast({ title: "已清除当前文件，可以重新选择", variant: "info" });
  }, [toast]);

  /* ────────── 载入 PDF ────────── */
  const loadFile = useCallback(
    async (f: File | null | undefined) => {
      if (!f) return;
      if (!/\.pdf$/i.test(f.name)) {
        toast({ title: "请选择 PDF 文件", variant: "error" });
        return;
      }
      setFile(f);
      setMargins({});
      setUndoStack([]);
      setRedoStack([]);
      setPageIndex(0);
      setThumbUrls([]);
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
        const data = new Uint8Array(await f.arrayBuffer());
        const doc = await pdfjs.getDocument({ data }).promise;

        // 页尺寸：用 pdfjs 自己读，避免多一次后端往返
        const sizes: PageSize[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const page = await doc.getPage(i);
          const vp = page.getViewport({ scale: 1 });
          sizes.push({ width_mm: (vp.width / PT_PER_MM), height_mm: (vp.height / PT_PER_MM) });
        }
        setPageSizes(sizes);
        setPdf(doc as unknown as { numPages: number; getPage: (n: number) => Promise<unknown> });

        // 缩略图（最多先渲染 24 页，避免打开大文件卡顿）
        const limit = Math.min(doc.numPages, 24);
        const urls: string[] = [];
        for (let i = 1; i <= limit; i++) {
          const page = await doc.getPage(i);
          const vp = page.getViewport({ scale: 0.22 });
          const canvas = document.createElement("canvas");
          canvas.width = Math.floor(vp.width);
          canvas.height = Math.floor(vp.height);
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          await page.render({ canvasContext: ctx, viewport: vp }).promise;
          urls.push(canvas.toDataURL("image/jpeg", 0.72));
        }
        setThumbUrls(urls);
      } catch (err) {
        toast({ title: "无法打开 PDF", description: err instanceof Error ? err.message : "", variant: "error" });
      }
    },
    [toast],
  );

  /* ────────── 渲染当前页 ────────── */
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!pdf || !canvas) return;
    let cancelled = false;
    setRendering(true);
    (async () => {
      try {
        const page = (await pdf.getPage(pageIndex + 1)) as {
          getViewport: (o: { scale: number }) => { width: number; height: number };
          render: (o: { canvasContext: CanvasRenderingContext2D; viewport: unknown }) => { promise: Promise<void> };
        };
        // 画布始终按固定倍率渲染（放大到 300% 也不糊），显示大小交给 CSS，
        // 这样「缩到能看全整页」不会牺牲清晰度。
        const renderScale = 2.2;
        const vp = page.getViewport({ scale: renderScale });
        canvas.width = Math.floor(vp.width);
        canvas.height = Math.floor(vp.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        // 100% 时的 CSS 尺寸：PDF 的 pt 按 96/72 换算成屏幕像素
        const cssVp = page.getViewport({ scale: 96 / 72 });
        if (!cancelled) {
          setPageCss({ w: cssVp.width, h: cssVp.height });
          setRendering(false);
        }
      } catch {
        if (!cancelled) setRendering(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pdf, pageIndex]);

  /** 缩放以完整显示整页（预览区左右会留出一点空隙） */
  const fitPage = useCallback(() => {
    const wrap = stageRef.current;
    if (!wrap || !pageCss) return;
    const rect = wrap.getBoundingClientRect();
    const availW = Math.max(80, wrap.clientWidth - 32);
    // 可用高度取「视口内实际能看到的高度」。
    // 不能用 wrap.clientHeight：这一栏现在是自然高度，会被页面内容撑大，
    // 用它当可用空间就成了循环，页面会一直按放大的倍数显示。
    const availH = Math.max(120, window.innerHeight - rect.top - 24);
    setZoom(Math.max(0.05, Math.min(2, Math.min(availW / pageCss.w, availH / pageCss.h))));
  }, [pageCss]);

  /** 适应宽度（宽度铺满，纵向可滚） */
  const fitWidth = useCallback(() => {
    const wrap = stageRef.current;
    if (!wrap || !pageCss) return;
    setZoom(Math.max(0.05, Math.min(3, (wrap.clientWidth - 32) / pageCss.w)));
  }, [pageCss]);

  // 首次打开、换页、窗口变化时自动适应整页，避免一进来就看不清全貌
  useEffect(() => {
    if (!pageCss || !fitting) return;
    fitPage();
  }, [pageCss, fitting, fitPage]);

  // 按住 Ctrl 在预览区滚动即可缩放（放大到能看清要裁剪的细节）
  useEffect(() => {
    const wrap = stageRef.current;
    if (!wrap) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return; // 普通滚动留给页面滚动
      e.preventDefault();
      setFitting(false);
      setZoom((z) => Math.max(0.05, Math.min(4, z * (e.deltaY < 0 ? 1.12 : 0.89))));
    };
    wrap.addEventListener("wheel", onWheel, { passive: false });
    return () => wrap.removeEventListener("wheel", onWheel);
  }, [file]);

  useEffect(() => {
    const wrap = stageRef.current;
    if (!wrap || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => {
      if (fitting) fitPage();
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [fitting, fitPage]);

  /* ────────── 裁剪框的像素换算 ────────── */
  const box = useMemo(() => {
    const sizeNow = pageSizes[pageIndex];
    if (!sizeNow || !pageCss) return { left: 0, top: 0, width: 0, height: 0 };
    // 用「100% 时的 CSS 尺寸 × 当前缩放」推导，而不读 canvas.clientWidth。
    // 后者在 CSS 尺寸尚未生效时仍是旧的固有宽度，会把裁剪框算大、
    // 在预览区里撑出一大片空白滚动区。
    const displayW = pageCss.w * zoom;
    const displayH = pageCss.h * zoom;
    const pxPerMmX = displayW / sizeNow.width_mm;
    const pxPerMmY = displayH / sizeNow.height_mm;
    const left = Math.max(0, current.left * pxPerMmX);
    const top = Math.max(0, current.top * pxPerMmY);
    const width = Math.max(8, displayW - (current.left + current.right) * pxPerMmX);
    const height = Math.max(8, displayH - (current.top + current.bottom) * pxPerMmY);
    return { left, top, width, height };
  }, [current, pageIndex, pageSizes, zoom, pageCss, __locale]);

  /* ────────── 拖动裁剪框 ────────── */
  const pushHistory = (next: Record<number, Margins>) => {
    setUndoStack((st) => [...st.slice(-19), margins]);
    setRedoStack([]);
    setMargins(next);
  };

  const onHandleDown = (handle: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const canvas = canvasRef.current;
    const sizeNow = pageSizes[pageIndex];
    if (!canvas || !sizeNow) return;
    setDragging(true);
    dragRef.current = {
      handle,
      startX: e.clientX,
      startY: e.clientY,
      start: { ...current },
      scale: sizeNow.width_mm / canvas.clientWidth,
    };
  };

  /**
   * 在页面上按下：拉出一个新的裁剪范围。
   *
   * 监听器在这里一次性挂上、在 mouseup 时摘掉，中间所有计算走 ref。
   * 早先版本把监听器挂在「拖画状态」的 effect 里，每次移动都重新挂载，
   * 快速拖动时会丢掉中间的 move 事件，导致画出来的框比手实际划的短。
   */
  const onPageMouseDown = (e: React.MouseEvent) => {
    const canvas = canvasRef.current;
    const sizeNow = pageSizes[pageIndex];
    if (!canvas || !sizeNow) return;
    if (e.button !== 0 || !pageCss) return;
    e.preventDefault();
    const rect = canvas.getBoundingClientRect();
    const startX = e.clientX - rect.left;
    const startY = e.clientY - rect.top;
    const pxPerMmX = pageCss.w * zoom / sizeNow.width_mm;
    const pxPerMmY = pageCss.h * zoom / sizeNow.height_mm;
    const current0 = { x: startX, y: startY, w: 0, h: 0 };
    drawRectRef.current = current0;
    setDrawRect(current0);

    const onMove = (ev: MouseEvent) => {
      const cx = Math.max(0, Math.min(rect.width, ev.clientX - rect.left));
      const cy = Math.max(0, Math.min(rect.height, ev.clientY - rect.top));
      const next = {
        x: Math.min(startX, cx),
        y: Math.min(startY, cy),
        w: Math.abs(cx - startX),
        h: Math.abs(cy - startY),
      };
      drawRectRef.current = next;
      setDrawRect(next);
    };

    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      const r = drawRectRef.current;
      drawRectRef.current = null;
      setDrawRect(null);
      if (!r || r.w < 6 || r.h < 6) return;
      const rounded: Margins = {
        left: Math.max(0, Number((r.x / pxPerMmX).toFixed(1))),
        top: Math.max(0, Number((r.y / pxPerMmY).toFixed(1))),
        right: Math.max(0, Number(((rect.width - (r.x + r.w)) / pxPerMmX).toFixed(1))),
        bottom: Math.max(0, Number(((rect.height - (r.y + r.h)) / pxPerMmY).toFixed(1))),
      };
      const target =
        scope === "all"
          ? Object.fromEntries(pageSizes.map((_, i) => [i, rounded]))
          : { ...margins, [pageIndex]: rounded };
      pushHistory(target);
      toast({ title: "已按框选区域设置裁剪范围", variant: "success" });
    };

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  };

  /** 在框内按下：整体挪动裁剪框 */
  const onBoxMouseDown = (e: React.MouseEvent) => {
    e.stopPropagation();
    const canvas = canvasRef.current;
    const sizeNow = pageSizes[pageIndex];
    if (!canvas || !sizeNow) return;
    setDragging(true);
    dragRef.current = {
      handle: "move",
      startX: e.clientX,
      startY: e.clientY,
      start: { ...current },
      scale: sizeNow.width_mm / canvas.clientWidth,
    };
  };

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      const canvas = canvasRef.current;
      const sizeNow = pageSizes[pageIndex];
      if (!d || !canvas || !sizeNow) return;
      const dxMm = (e.clientX - d.startX) * d.scale;
      const dyMm = (e.clientY - d.startY) * (sizeNow.height_mm / canvas.clientHeight);
      const next = { ...d.start };
      const clamp = (v: number) => Math.max(0, v);
      if (d.handle === "move") {
        // 整体平移：四边同步变化，且不能把框推出去
        const xMm = (e.clientX - d.startX) * d.scale;
        const yMm = (e.clientY - d.startY) * (sizeNow.height_mm / canvas.clientHeight);
        const nx = Math.max(-d.start.left, Math.min(d.start.right, xMm));
        const ny = Math.max(-d.start.top, Math.min(d.start.bottom, yMm));
        setMargins((prev) => ({
          ...prev,
          [pageIndex]: { left: d.start.left + nx, right: d.start.right - nx, top: d.start.top + ny, bottom: d.start.bottom - ny },
        }));
        return;
      }
      // 每次只动被拖的那条边（或那两条边），其余保持不变
      if (d.handle.includes("l")) next.left = clamp(d.start.left + dxMm);
      if (d.handle.includes("r")) next.right = clamp(d.start.right - dxMm);
      if (d.handle.includes("t")) next.top = clamp(d.start.top + dyMm);
      if (d.handle.includes("b")) next.bottom = clamp(d.start.bottom - dyMm);
      // 别把框拖成负数
      const maxW = sizeNow.width_mm * 0.9;
      const maxH = sizeNow.height_mm * 0.9;
      if (next.left + next.right > maxW) {
        if (d.handle.includes("l")) next.left = maxW - next.right;
        else next.right = maxW - next.left;
      }
      if (next.top + next.bottom > maxH) {
        if (d.handle.includes("t")) next.top = maxH - next.bottom;
        else next.bottom = maxH - next.top;
      }
      setMargins((prev) => ({ ...prev, [pageIndex]: next }));
    };
    const onUp = () => {
      setDragging(false);
      dragRef.current = null;
      // 一次拖动结束后记一步历史
      setUndoStack((st) => (st.length && st[st.length - 1] === margins ? st : [...st.slice(-19), margins]));
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [dragging, pageIndex, pageSizes, margins]);

  /** 改某个边距（输入框与滑杆共用） */
  const setEdge = (edge: keyof Margins, value: number) => {
    const sizeNow = pageSizes[pageIndex];
    const maxValue = sizeNow ? (edge === "top" || edge === "bottom" ? sizeNow.height_mm * 0.45 : sizeNow.width_mm * 0.45) : 100;
    const v = Math.max(0, Math.min(maxValue, Number.isFinite(value) ? value : 0));
    const next: Record<number, Margins> = { ...margins };
    const target = scope === "all" ? Array.from({ length: pageSizes.length }, (_, i) => i) : [pageIndex];
    for (const i of target) {
      next[i] = { ...(next[i] ?? EMPTY), [edge]: v };
    }
    setMargins(next);
  };

  /** 自动边距：按文字内容的外接框，四边各留 5mm */
  const autoMargins = async () => {
    if (!pdf || !size) return;
    try {
      const page = (await pdf.getPage(pageIndex + 1)) as {
        getTextContent: () => Promise<{ items: { transform: number[]; width?: number; height?: number }[] }>;
        getViewport: (o: { scale: number }) => { width: number; height: number };
      };
      const content = await page.getTextContent();
      const vp = page.getViewport({ scale: 1 });
      if (!content.items.length) {
        toast({ title: "这一页没有文字，无法自动判断边距", variant: "info" });
        return;
      }
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const item of content.items) {
        const x = item.transform[4];
        const y = vp.height - item.transform[5];
        const w = item.width ?? 0;
        const h = item.height ?? 10;
        minX = Math.min(minX, x);
        minY = Math.min(minY, y - h);
        maxX = Math.max(maxX, x + w);
        maxY = Math.max(maxY, y);
      }
      const pad = 5; // 留 5mm 白边
      const mm = (pt: number) => pt / PT_PER_MM;
      const next: Margins = {
        left: Math.max(0, mm(minX) - pad),
        right: Math.max(0, size.width_mm - mm(maxX) - pad),
        top: Math.max(0, mm(minY) - pad),
        bottom: Math.max(0, size.height_mm - mm(maxY) - pad),
      };
      pushHistory({ ...margins, [pageIndex]: next });
      toast({ title: "已按内容自动计算边距（每边留 5mm）", variant: "success" });
    } catch {
      toast({ title: "自动边距失败", variant: "error" });
    }
  };

  const undo = () => {
    if (!undoStack.length) return;
    setRedoStack((r) => [...r, margins]);
    setMargins(undoStack[undoStack.length - 1]);
    setUndoStack((st) => st.slice(0, -1));
  };
  const redo = () => {
    if (!redoStack.length) return;
    setUndoStack((s) => [...s, margins]);
    setMargins(redoStack[redoStack.length - 1]);
    setRedoStack((st) => st.slice(0, -1));
  };
  const reset = () => {
    pushHistory({});
    toast({ title: "已还原为未裁剪", variant: "info" });
  };

  /* ────────── 导出 ────────── */
  const exportPdf = async () => {
    if (!file || !size) return;
    const cropped = Object.entries(margins).filter(([, m]) => m.top || m.bottom || m.left || m.right);
    if (cropped.length === 0) {
      toast({ title: "还没有设置任何裁剪", variant: "info" });
      return;
    }
    setExporting(true);
    try {
      const perPage: Record<string, Margins> = {};
      for (const [i, m] of cropped) perPage[String(Number(i) + 1)] = m;
      const fd = new FormData();
      fd.append("file", file);
      fd.append("per_page", JSON.stringify(perPage));
      fd.append("unit", "mm");
      const res = await fetch("/api/tools/pdf-crop", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "创建任务失败");
      const jobId = data.job?.id;
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const j = await (await fetch(`/api/jobs/${jobId}`, { cache: "no-store" })).json();
        const st = j.job?.status;
        if (st === "completed") {
          toast({ title: "裁剪完成", description: `已生成 ${j.job.resultFilename}`, variant: "success" });
          // ★ 以前用分离的 <a href="/api/..."> 触发下载：这种锚点不在 DOM 里，
          //   fetch-bridge 的下载兜底拦不到，桌面版里直接变成页面导航 → "未找到工具"。
          //   改走 V32 已验证的 Blob 下载模块。
          await downloadJobResult(jobId, j.job.resultFilename || "裁剪结果.pdf");
          return;
        }
        if (st === "failed") throw new Error(j.job?.error || "裁剪失败");
      }
      throw new Error("裁剪超时");
    } catch (err) {
      toast({ title: "导出失败", description: err instanceof Error ? err.message : "", variant: "error" });
    } finally {
      setExporting(false);
    }
  };

  const croppedCount = useMemo(
    () => Object.values(margins).filter((m) => m.top || m.bottom || m.left || m.right).length,
    [margins, __locale],
  );

  const resultSize = size
    ? {
        w: Math.max(1, size.width_mm - current.left - current.right),
        h: Math.max(1, size.height_mm - current.top - current.bottom),
      }
    : null;

  /* ────────── 空状态 ────────── */
  if (!file) {
    return (
      <div className="flex flex-col gap-4">
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => void loadFile(e.target.files?.[0])} />
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            void loadFile(e.dataTransfer.files?.[0]);
          }}
          className="group flex cursor-pointer flex-col items-center justify-center gap-2.5 rounded-2xl border-2 border-dashed border-primary/35 bg-primary/[0.06] px-5 py-16 transition-all hover:border-primary/60 hover:bg-primary/10"
        >
          {/* 图标用实心主题色方块（和「截图取字」等工具的上传区一致）——
              原来这里是 1 像素、且没指定颜色的虚线框，几乎看不见 */}
          <span className="mb-1 flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[0_1px_0_0_hsl(0_0%_100%/0.18)_inset,0_8px_20px_-12px_hsl(var(--primary)/0.8)] transition-transform group-hover:-translate-y-0.5 group-hover:scale-105">
            <FileUp size={20} />
          </span>
          <p className="text-[13.5px] font-semibold" style={{ color: colors.text }}>{__ui("点击选择文件，或将文件拖拽到此处")}</p>
          <p className="mt-1 text-[11.5px]" style={{ color: colors.muted }}>{__ui("拖动画布上的裁剪框即可，边距精确到毫米")}</p>
        </div>
      </div>
    );
  }

  const HANDLES = ["tl", "t", "tr", "r", "br", "b", "bl", "l"];

  return (
    <div className="flex flex-col gap-4">
      <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="hidden" onChange={(e) => void loadFile(e.target.files?.[0])} />

      <div className="grid items-start gap-4 xl:grid-cols-[1fr_380px]">
        {/* 预览区 */}
        {/* 左栏只放页面本身：纵向 flex，预览区 flex-1 吃掉全部剩余高度，不留空白 */}
        <section
          className="min-w-0 rounded-2xl border p-3"
          style={{ borderColor: colors.borderSolid, background: colors.card }}
        >
          <div
            ref={stageRef}
            className="relative rounded-xl p-4"
            style={{
              background: colors.bg,
              backgroundImage:
                "linear-gradient(45deg, rgba(127,127,127,0.10) 25%, transparent 25%), linear-gradient(-45deg, rgba(127,127,127,0.10) 25%, transparent 25%)",
              backgroundSize: "18px 18px",
            }}
          >
            <div className="relative mx-auto w-fit">
              <canvas
                ref={canvasRef}
                onMouseDown={onPageMouseDown}
                className="block rounded shadow-sm"
                style={{
                  background: "#fff",
                  width: pageCss ? pageCss.w * zoom : undefined,
                  height: pageCss ? pageCss.h * zoom : undefined,
                  cursor: "crosshair",
                }}
              />

              {/* 遮罩：把裁剪框以外的部分压暗 */}
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute bg-black/45" style={{ left: 0, top: 0, right: 0, height: box.top }} />
                <div className="absolute bg-black/45" style={{ left: 0, bottom: 0, right: 0, height: `calc(100% - ${box.top + box.height}px)` }} />
                <div className="absolute bg-black/45" style={{ left: 0, top: box.top, width: box.left, height: box.height }} />
                <div className="absolute bg-black/45" style={{ right: 0, top: box.top, width: `calc(100% - ${box.left + box.width}px)`, height: box.height }} />
              </div>

              {/* 拖画中的新框预览 */}
              {drawRect && drawRect.w > 1 && (
                <div
                  className="pointer-events-none absolute border-2 border-dashed"
                  style={{ left: drawRect.x, top: drawRect.y, width: drawRect.w, height: drawRect.h, borderColor: "hsl(var(--primary))", background: "hsl(var(--primary) / 0.12)" }}
                />
              )}

              {/* 裁剪框 */}
              <div
                className={cn("pointer-events-none absolute border-2", dragging ? "border-primary" : "border-white")}
                style={{ left: box.left, top: box.top, width: box.width, height: box.height, boxShadow: "0 0 0 1px rgba(0,0,0,0.4)" }}
              >
                {HANDLES.map((h) => {
                  const pos: React.CSSProperties = {};
                  if (h.includes("t")) pos.top = -5;
                  if (h.includes("b")) pos.bottom = -5;
                  if (h.includes("l")) pos.left = -5;
                  if (h.includes("r")) pos.right = -5;
                  if (h === "t" || h === "b") pos.left = "50%", pos.marginLeft = -5;
                  if (h === "l" || h === "r") pos.top = "50%", pos.marginTop = -5;
                  const cursor = h === "tl" || h === "br" ? "nwse-resize" : h === "tr" || h === "bl" ? "nesw-resize" : h === "t" || h === "b" ? "ns-resize" : "ew-resize";
                  return (
                    <span
                      key={h}
                      onMouseDown={onHandleDown(h)}
                      className="pointer-events-auto absolute h-2.5 w-2.5 rounded-full border border-black/40 bg-white"
                      style={{ ...pos, cursor }}
                    />
                  );
                })}

                {/* 四条边线：拖动可整体平移裁剪框（框内部让给「拖出新的裁剪范围」） */}
                {(
                  [
                    ["top", { left: 0, right: 0, top: -3, height: 6 }, "ns-resize"],
                    ["bottom", { left: 0, right: 0, bottom: -3, height: 6 }, "ns-resize"],
                    ["left", { left: -3, top: 0, bottom: 0, width: 6 }, "ew-resize"],
                    ["right", { right: -3, top: 0, bottom: 0, width: 6 }, "ew-resize"],
                  ] as [string, React.CSSProperties, string][]
                ).map(([key, style, cursor]) => (
                  <span
                    key={key}
                    onMouseDown={onBoxMouseDown}
                    className="pointer-events-auto absolute"
                    style={{ ...style, cursor }}
                    title={__ui("拖动可整体平移")}
                  />
                ))}
              </div>
            </div>

            {/* 角落里的极简缩放提示与控件：不占右栏空间 */}
            <div className="sticky bottom-0 left-0 mt-2 flex justify-end">
              <div
                className="flex items-center gap-1.5 rounded-full border px-2.5 py-1 backdrop-blur"
                style={{ borderColor: colors.borderSolid, background: `${colors.card}d9` }}
              >
                <span className="text-[10.5px]" style={{ color: colors.muted }}>{__ui("Ctrl + 滚轮缩放")}</span>
                <span className="h-3 w-px" style={{ background: colors.borderSolid }} />
                <button onClick={() => { setFitting(false); setZoom((z) => Math.max(0.05, z - 0.1)); }} title={__ui("缩小")} style={{ color: colors.text }}>
                  <Minus size={12} />
                </button>
                <span className="min-w-[32px] text-center font-mono text-[11px]" style={{ color: colors.text }}>{Math.round(zoom * 100)}%</span>
                <button onClick={() => { setFitting(false); setZoom((z) => Math.min(4, z + 0.1)); }} title={__ui("放大")} style={{ color: colors.text }}>
                  <Plus size={12} />
                </button>
                <button onClick={() => { setFitting(true); fitPage(); }} className="flex items-center gap-1 text-[11px]" title={__ui("缩放到能看见整页")} style={{ color: colors.text }}>
                  <Maximize2 size={11} /> {__ui("整页")}</button>
                <button onClick={() => { setFitting(false); fitWidth(); }} className="flex items-center gap-1 text-[11px]" title={__ui("宽度铺满，纵向可滚")} style={{ color: colors.text }}>
                  <ZoomIn size={11} /> {__ui("宽度")}</button>
              </div>
            </div>
          </div>

        </section>

        {/* 参数区 */}
        {/* 右栏自己滚动：拉到下面的设置时，左边的页面位置不会跟着动 */}
        <div className="flex min-w-0 flex-col gap-4 overscroll-contain xl:sticky xl:top-4 xl:max-h-[calc(100vh-190px)] xl:overflow-y-auto xl:pr-1">
          {/* 文件 */}
          <section className="rounded-2xl border p-4" style={{ borderColor: colors.borderSolid, background: colors.card }}>
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <FileUp size={14} />
                <span className="truncate text-[12.5px] font-medium" style={{ color: colors.text }}>{file.name}</span>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => fileRef.current?.click()}>
                  <FileUp size={12} /> {__ui("换一个")}</Button>
                <Button size="sm" variant="ghost" className="gap-1.5" onClick={clearFile} title={__ui("清除当前文件与全部设置")}>
                  <Trash2 size={12} /> {__ui("清除")}</Button>
              </div>
            </div>
          </section>

          {/* 页面与缩略图 */}
          <section className="rounded-2xl border p-4" style={{ borderColor: colors.borderSolid, background: colors.card }}>
            <div className="mb-2.5 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Layers size={14} />
                <h3 className="text-[12.5px] font-semibold" style={{ color: colors.muted }}>{__ui("页面")}</h3>
              </div>
              <div className="flex items-center gap-1">
                <Button size="sm" variant="ghost" onClick={() => setPageIndex((i) => Math.max(0, i - 1))} disabled={pageIndex === 0}>
                  <ChevronLeft size={14} />
                </Button>
                <span className="min-w-[68px] text-center font-mono text-[12px]" style={{ color: colors.text }}>
                  {pageIndex + 1} / {pageSizes.length}
                </span>
                <Button size="sm" variant="ghost" onClick={() => setPageIndex((i) => Math.min(pageSizes.length - 1, i + 1))} disabled={pageIndex >= pageSizes.length - 1}>
                  <ChevronRight size={14} />
                </Button>
              </div>
            </div>
            <div className="grid max-h-56 grid-cols-4 gap-1.5 overflow-y-auto">
              {thumbUrls.map((url, i) => {
                const m = margins[i];
                const cropped = Boolean(m && (m.top || m.bottom || m.left || m.right));
                return (
                  <button
                    key={i}
                    onClick={() => setPageIndex(i)}
                    className="relative overflow-hidden rounded-md border transition-all"
                    style={{
                      borderColor: i === pageIndex ? "hsl(var(--primary))" : colors.borderSolid,
                      outline: i === pageIndex ? "2px solid hsl(var(--primary))" : "none",
                      outlineOffset: 1,
                    }}
                    title={__msg("第 {0} 页", i + 1)}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={__msg("第 {0} 页", i + 1)} className="h-16 w-full object-cover" />
                    <span className="absolute left-0.5 top-0.5 rounded bg-black/65 px-1 text-[9px] text-white">{i + 1}</span>
                    {cropped && <span className="absolute bottom-0.5 right-0.5 rounded px-1 text-[9px] text-white" style={{ background: colors.green }}>✓</span>}
                  </button>
                );
              })}
            </div>
            <p className="mt-2 text-[11px]" style={{ color: colors.muted }}>
              {__ui("共")}{pageSizes.length} {__ui("页 · 已裁剪")}{__count(croppedCount, "页")} </p>
          </section>

          <section className="rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
            <h3 className="mb-3 flex items-center gap-2 text-[12.5px] font-semibold" style={{ color: colors.muted }}>
              <Crop size={14} /> {__ui("04 作用范围")}</h3>
            <div className="flex gap-2">
              {[
                { v: "all", label: "全部页面", desc: "改一次，所有页跟着变" },
                { v: "current", label: "当前页面", desc: "只改正在预览的这一页" },
              ].map((o) => (
                <button
                  key={o.v}
                  onClick={() => setScope(o.v as "all" | "current")}
                  className="flex-1 rounded-xl border px-3 py-2 text-left transition-all"
                  style={{
                    borderColor: scope === o.v ? "hsl(var(--primary))" : colors.borderSolid,
                    background: scope === o.v ? colors.active : "transparent",
                  }}
                >
                  <span className="block text-[12.5px] font-medium" style={{ color: colors.text }}>{__ui(o.label)}</span>
                  <span className="block text-[10.5px]" style={{ color: colors.muted }}>{__ui(o.desc)}</span>
                </button>
              ))}
            </div>

          </section>

          <section className="rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
            <h3 className="mb-3 flex items-center gap-2 text-[12.5px] font-semibold" style={{ color: colors.muted }}>
              <ZoomIn size={14} /> {__ui("05 精确边距")}</h3>
            <div className="flex items-center gap-2">
              <Select value={unit} onChange={(e) => setUnit(e.target.value as "mm" | "percent")} className="flex-1">
                <option value="mm">{__ui("毫米（精确）")}</option>
                <option value="percent">{__ui("百分比")}</option>
              </Select>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void autoMargins()}>
                <Wand2 size={13} /> {__ui("自动边距")}</Button>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              {(
                [
                  ["上", "top"],
                  ["右", "right"],
                  ["下", "bottom"],
                  ["左", "left"],
                ] as [string, keyof Margins][]
              ).map(([label, edge]) => (
                <label key={edge} className="flex flex-col gap-1">
                  <span className="text-[11.5px]" style={{ color: colors.muted }}>{__ui(label)}</span>
                  {/* 这四输入框原来"看不见"：它所在的 section 背景就是 colors.card，
                      而共享的 <Input> 背景也是 bg-card —— 两个颜色一模一样，
                      只剩一圈很淡的边框，实测背景双方都是 rgb(250,248,244)。
                      这里把输入框背景改成页面底色（colors.bg），
                      跟其它工具里"浅色输入框落在卡片上"的观感一致，一眼就能看出这是输入框。 */}
                  <Input
                    type="number"
                    step="0.5"
                    min={0}
                    value={Number(current[edge].toFixed(1))}
                    onChange={(e) => setEdge(edge, Number(e.target.value))}
                    className="font-mono text-[12.5px]"
                    style={{ background: colors.bg }}
                  />
                </label>
              ))}
            </div>
            {resultSize && (
              <div className="mt-3 rounded-xl border px-3.5 py-2.5" style={{ borderColor: colors.borderSolid, background: colors.bg }}>
                <p className="text-[11.5px]" style={{ color: colors.muted }}>{__ui("裁剪后尺寸")}</p>
                <p className="mt-0.5 font-mono text-[13px]" style={{ color: colors.text }}>
                  {resultSize.w.toFixed(1)} × {resultSize.h.toFixed(1)} mm
                </p>
                {size && (
                  <p className="mt-0.5 text-[11px]" style={{ color: colors.muted }}>
                    {__ui("原始")}{size.width_mm.toFixed(1)} × {size.height_mm.toFixed(1)} mm
                  </p>
                )}
              </div>
            )}
          </section>

          <section className="rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
            <h3 className="mb-3 flex items-center gap-2 text-[12.5px] font-semibold" style={{ color: colors.muted }}>
              <Undo2 size={14} /> {__ui("06 调整与历史")}</h3>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={undo} disabled={undoStack.length === 0}>
                <Undo2 size={13} /> {__ui("撤销")}</Button>
              <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={redo} disabled={redoStack.length === 0}>
                <Redo2 size={13} /> {__ui("重做")}</Button>
              <Button variant="outline" size="sm" className="flex-1 gap-1.5" onClick={reset}>
                <RotateCcw size={13} /> {__ui("清空")}</Button>
            </div>
            <Button className="mt-3 w-full gap-1.5" onClick={() => void exportPdf()} disabled={exporting || croppedCount === 0}>
              {exporting ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
              {exporting ? __ui("正在导出…") : __msg("导出裁剪后的 PDF（{0} 页）", croppedCount)}
            </Button>
            <p className="mt-2.5 flex items-start gap-1.5 text-[11px]" style={{ color: colors.muted }}>
              <Shield size={12} className="mt-0.5 shrink-0" />
              {__ui("只改页面边界，不重新渲染：文字仍可选中与搜索，原文件不会被修改。")}</p>
          </section>

          <section className="flex items-start gap-2 rounded-2xl border p-4" style={{ borderColor: colors.borderSolid }}>
            <AlertCircle size={14} className="mt-0.5 shrink-0" style={{ color: colors.muted }} />
            <p className="text-[11.5px] leading-relaxed" style={{ color: colors.muted }}>
              {__ui("在页面上按住鼠标拖一下就能画出裁剪范围（拖到哪就是哪）；拖四角圆点可单独调某条边， 拖白框的四条边可整体平移； 右侧可直接输入毫米数。想放大细看，用上方的缩放滑块或按住 Ctrl 滚动滚轮； 点「适应整页」一键回到完整页面。「换一个文件」可随时重新选择 PDF，「清除」会重置全部设置。一页一页调好后，「作用范围」选「全部页面」 会把每次修改同步到所有页；想逐页不同就选「当前页面」。")}</p>
          </section>
        </div>
      </div>
    </div>
  );
}
