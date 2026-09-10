"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Upload, Download, ArrowUp, ArrowDown, Trash2, Eye, Layers, Move
} from "lucide-react";
import { Button, Label, Select } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { Confetti } from "@/components/ui/confetti";

interface MergeImageItem {
  id: string;
  file: File;
  previewUrl: string;
  imgElement: HTMLImageElement;
  width: number;
  height: number;
}

interface LayoutItem {
  index: number;
  item: MergeImageItem;
  x: number;
  y: number;
  w: number;
  h: number;
  radius: number;
  drawX?: number;
  drawY?: number;
  drawW?: number;
  drawH?: number;
}

interface ComputedLayout {
  width: number;
  height: number;
  items: LayoutItem[];
}

interface DragState {
  isPointerDown: boolean;
  isDragging: boolean;
  dragIndex: number | null;
  targetIndex: number | null;
  startPos: { x: number; y: number };
  currentPos: { x: number; y: number };
  grabOffset: { x: number; y: number };
}

function computeLayout(
  images: MergeImageItem[],
  direction: "vertical" | "horizontal" | "grid",
  gridCols: number,
  gap: number,
  padding: number,
  borderRadius: number,
  forExport: boolean
): ComputedLayout {
  if (images.length === 0) {
    return { width: 0, height: 0, items: [] };
  }

  if (direction === "vertical") {
    const rawTargetW = Math.max(...images.map((it) => it.width), 800);
    const scaleFactor = forExport ? 1 : Math.min(1, 1200 / rawTargetW);
    const targetW = Math.round(rawTargetW * scaleFactor);
    const curPadding = Math.round(padding * scaleFactor);
    const curGap = Math.round(gap * scaleFactor);
    const curRadius = Math.round(borderRadius * scaleFactor);

    let totalH = curPadding * 2;
    images.forEach((it, idx) => {
      const ratio = targetW / it.width;
      totalH += it.height * ratio;
      if (idx < images.length - 1) totalH += curGap;
    });

    const items: LayoutItem[] = [];
    let curY = curPadding;
    images.forEach((it, idx) => {
      const ratio = targetW / it.width;
      const curH = it.height * ratio;
      items.push({
        index: idx,
        item: it,
        x: curPadding,
        y: curY,
        w: targetW,
        h: curH,
        radius: curRadius,
      });
      curY += curH + curGap;
    });

    return {
      width: targetW + curPadding * 2,
      height: Math.round(totalH),
      items,
    };
  }

  if (direction === "horizontal") {
    const rawTargetH = Math.max(...images.map((it) => it.height), 800);
    const scaleFactor = forExport ? 1 : Math.min(1, 1000 / rawTargetH);
    const targetH = Math.round(rawTargetH * scaleFactor);
    const curPadding = Math.round(padding * scaleFactor);
    const curGap = Math.round(gap * scaleFactor);
    const curRadius = Math.round(borderRadius * scaleFactor);

    let totalW = curPadding * 2;
    images.forEach((it, idx) => {
      const ratio = targetH / it.height;
      totalW += it.width * ratio;
      if (idx < images.length - 1) totalW += curGap;
    });

    const items: LayoutItem[] = [];
    let curX = curPadding;
    images.forEach((it, idx) => {
      const ratio = targetH / it.height;
      const curW = it.width * ratio;
      items.push({
        index: idx,
        item: it,
        x: curX,
        y: curPadding,
        w: curW,
        h: targetH,
        radius: curRadius,
      });
      curX += curW + curGap;
    });

    return {
      width: Math.round(totalW),
      height: targetH + curPadding * 2,
      items,
    };
  }

  // 宫格模式 (Grid)
  const cols = Math.max(1, gridCols);
  const cellW = forExport ? 600 : 360;
  const cellH = forExport ? 600 : 360;
  const curPadding = forExport ? padding : Math.round(padding * 0.6);
  const curGap = forExport ? gap : Math.round(gap * 0.6);
  const curRadius = forExport ? borderRadius : Math.round(borderRadius * 0.6);
  const rows = Math.ceil(images.length / cols);

  const items: LayoutItem[] = [];
  images.forEach((it, idx) => {
    const c = idx % cols;
    const r = Math.floor(idx / cols);
    const curX = curPadding + c * (cellW + curGap);
    const curY = curPadding + r * (cellH + curGap);

    const sW = it.width;
    const sH = it.height;
    const scale = Math.max(cellW / sW, cellH / sH);
    const dW = sW * scale;
    const dH = sH * scale;
    const dX = curX + (cellW - dW) / 2;
    const dY = curY + (cellH - dH) / 2;

    items.push({
      index: idx,
      item: it,
      x: curX,
      y: curY,
      w: cellW,
      h: cellH,
      drawX: dX,
      drawY: dY,
      drawW: dW,
      drawH: dH,
      radius: curRadius,
    });
  });

  return {
    width: cols * cellW + (cols - 1) * curGap + curPadding * 2,
    height: rows * cellH + (rows - 1) * curGap + curPadding * 2,
    items,
  };
}

function drawItemImage(ctx: CanvasRenderingContext2D, layout: LayoutItem) {
  ctx.save();
  if (layout.radius > 0) {
    ctx.beginPath();
    if (typeof ctx.roundRect === "function") {
      ctx.roundRect(layout.x, layout.y, layout.w, layout.h, layout.radius);
    } else {
      ctx.rect(layout.x, layout.y, layout.w, layout.h);
    }
    ctx.clip();
  }

  if (
    layout.drawX !== undefined &&
    layout.drawY !== undefined &&
    layout.drawW !== undefined &&
    layout.drawH !== undefined
  ) {
    ctx.drawImage(layout.item.imgElement, layout.drawX, layout.drawY, layout.drawW, layout.drawH);
  } else {
    ctx.drawImage(layout.item.imgElement, layout.x, layout.y, layout.w, layout.h);
  }
  ctx.restore();
}

function findHitItemIndex(items: LayoutItem[], x: number, y: number): number | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (x >= it.x && x <= it.x + it.w && y >= it.y && y <= it.y + it.h) {
      return i;
    }
  }
  return null;
}

function findNearestItemIndex(items: LayoutItem[], x: number, y: number): number | null {
  const hit = findHitItemIndex(items, x, y);
  if (hit !== null) return hit;

  if (items.length === 0) return null;
  let nearestIdx = 0;
  let minDist = Infinity;
  items.forEach((it, idx) => {
    const cx = it.x + it.w / 2;
    const cy = it.y + it.h / 2;
    const dist = Math.hypot(x - cx, y - cy);
    if (dist < minDist) {
      minDist = dist;
      nearestIdx = idx;
    }
  });
  return nearestIdx;
}

export function ImageMergeTool() {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const [images, setImages] = useState<MergeImageItem[]>([]);
  const [direction, setDirection] = useState<"vertical" | "horizontal" | "grid">("vertical");
  const [gridCols, setGridCols] = useState(2);
  const [gap, setGap] = useState(10);
  const [padding, setPadding] = useState(15);
  const [borderRadius, setBorderRadius] = useState(8);
  const [bgColor, setBgColor] = useState("#ffffff");
  const [exportFormat, setExportFormat] = useState<"png" | "jpeg" | "webp">("png");
  const [isExporting, setIsExporting] = useState(false);
  const [confetti, setConfetti] = useState(0);

  // 画布直接拖拽调序状态
  const dragRef = useRef<DragState>({
    isPointerDown: false,
    isDragging: false,
    dragIndex: null,
    targetIndex: null,
    startPos: { x: 0, y: 0 },
    currentPos: { x: 0, y: 0 },
    grabOffset: { x: 0, y: 0 },
  });
  const hoverIdxRef = useRef<number | null>(null);

  // 清理 URL
  useEffect(() => {
    return () => {
      images.forEach((it) => URL.revokeObjectURL(it.previewUrl));
    };
  }, []);

  const handleFiles = (fileList: FileList | File[]) => {
    const valid = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (!valid.length) {
      toast({ title: "请选择有效图片", variant: "error" });
      return;
    }

    const newItems: MergeImageItem[] = [];
    let loadedCount = 0;

    valid.forEach((file) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        newItems.push({
          id: Math.random().toString(36).substring(2, 9),
          file,
          previewUrl: url,
          imgElement: img,
          width: img.naturalWidth,
          height: img.naturalHeight,
        });
        loadedCount++;
        if (loadedCount === valid.length) {
          setImages((prev) => [...prev, ...newItems]);
        }
      };
      img.src = url;
    });
  };

  const moveUp = (index: number) => {
    if (index <= 0) return;
    setImages((prev) => {
      const next = [...prev];
      const temp = next[index - 1];
      next[index - 1] = next[index];
      next[index] = temp;
      return next;
    });
  };

  const moveDown = (index: number) => {
    if (index >= images.length - 1) return;
    setImages((prev) => {
      const next = [...prev];
      const temp = next[index + 1];
      next[index + 1] = next[index];
      next[index] = temp;
      return next;
    });
  };

  const removeImg = (id: string) => {
    setImages((prev) => {
      const target = prev.find((it) => it.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((it) => it.id !== id);
    });
  };

  // 核心渲染逻辑：区分快速流畅预览与全尺寸超清导出，支持拖拽中的动态反馈渲染
  const drawToCanvas = useCallback(
    (canvas: HTMLCanvasElement, forExport: boolean, drag?: DragState) => {
      if (!canvas || images.length === 0) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const layout = computeLayout(images, direction, gridCols, gap, padding, borderRadius, forExport);
      canvas.width = layout.width;
      canvas.height = layout.height;

      // 绘制背景
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      const isDragging = !forExport && Boolean(drag?.isDragging && drag.dragIndex !== null);

      if (!isDragging) {
        // 正常状态：按序渲染各图片
        layout.items.forEach((item) => {
          drawItemImage(ctx, item);
        });
        return;
      }

      // 处于鼠标画布拖拽中：
      const dragIdx = drag!.dragIndex!;
      const targetIdx = drag!.targetIndex;

      // 1. 绘制底层图片序列
      layout.items.forEach((item) => {
        if (item.index === dragIdx) {
          // 原位置显示半透明占位及蓝色虚线轮廓
          ctx.save();
          ctx.globalAlpha = 0.22;
          drawItemImage(ctx, item);
          ctx.restore();

          ctx.save();
          ctx.setLineDash([8, 6]);
          ctx.strokeStyle = "#3b82f6";
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          if (typeof ctx.roundRect === "function") {
            ctx.roundRect(item.x + 2, item.y + 2, item.w - 4, item.h - 4, Math.max(2, item.radius - 2));
          } else {
            ctx.rect(item.x + 2, item.y + 2, item.w - 4, item.h - 4);
          }
          ctx.stroke();
          ctx.restore();
        } else {
          drawItemImage(ctx, item);
        }
      });

      // 2. 高亮当前悬浮的目标槽位落点
      if (targetIdx !== null && targetIdx !== dragIdx && layout.items[targetIdx]) {
        const targetItem = layout.items[targetIdx];
        ctx.save();
        ctx.fillStyle = "rgba(59, 130, 246, 0.25)";
        ctx.strokeStyle = "#2563eb";
        ctx.lineWidth = 4;
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") {
          ctx.roundRect(targetItem.x, targetItem.y, targetItem.w, targetItem.h, targetItem.radius);
        } else {
          ctx.rect(targetItem.x, targetItem.y, targetItem.w, targetItem.h);
        }
        ctx.fill();
        ctx.stroke();

        // 槽位中心气泡徽标
        const cx = targetItem.x + targetItem.w / 2;
        const cy = targetItem.y + targetItem.h / 2;
        const badgeW = 144;
        const badgeH = 34;
        ctx.fillStyle = "#2563eb";
        ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
        ctx.shadowBlur = 10;
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") {
          ctx.roundRect(cx - badgeW / 2, cy - badgeH / 2, badgeW, badgeH, 17);
        } else {
          ctx.rect(cx - badgeW / 2, cy - badgeH / 2, badgeW, badgeH);
        }
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 13px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`松开调换到第 ${targetIdx + 1} 位`, cx, cy);
        ctx.restore();
      }

      // 3. 在最顶层绘制随指针浮动的被抓取图片
      const draggedItem = layout.items[dragIdx];
      if (draggedItem && drag!.currentPos) {
        ctx.save();
        const fx = drag!.currentPos.x - (drag!.grabOffset?.x ?? (draggedItem.w / 2));
        const fy = drag!.currentPos.y - (drag!.grabOffset?.y ?? (draggedItem.h / 2));

        ctx.shadowColor = "rgba(0, 0, 0, 0.5)";
        ctx.shadowBlur = 24;
        ctx.shadowOffsetY = 12;
        ctx.globalAlpha = 0.92;

        const floatingLayout: LayoutItem = {
          ...draggedItem,
          x: fx,
          y: fy,
          drawX: draggedItem.drawX !== undefined ? fx + (draggedItem.drawX - draggedItem.x) : undefined,
          drawY: draggedItem.drawY !== undefined ? fy + (draggedItem.drawY - draggedItem.y) : undefined,
        };
        drawItemImage(ctx, floatingLayout);

        // 浮动边框
        ctx.strokeStyle = "#3b82f6";
        ctx.lineWidth = 3;
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") {
          ctx.roundRect(fx, fy, draggedItem.w, draggedItem.h, draggedItem.radius);
        } else {
          ctx.rect(fx, fy, draggedItem.w, draggedItem.h);
        }
        ctx.stroke();

        // 顶部编号微标
        const tagW = 96;
        const tagH = 26;
        ctx.fillStyle = "#2563eb";
        ctx.beginPath();
        if (typeof ctx.roundRect === "function") {
          ctx.roundRect(fx + 10, fy + 10, tagW, tagH, 8);
        } else {
          ctx.rect(fx + 10, fy + 10, tagW, tagH);
        }
        ctx.fill();

        ctx.fillStyle = "#ffffff";
        ctx.font = "bold 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`正在移动: 图 ${dragIdx + 1}`, fx + 10 + tagW / 2, fy + 10 + tagH / 2);

        ctx.restore();
      }
    },
    [images, direction, gridCols, gap, padding, borderRadius, bgColor]
  );

  const requestRender = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || images.length === 0) return;
    drawToCanvas(canvas, false, dragRef.current);
  }, [drawToCanvas, images.length]);

  // 利用 requestAnimationFrame 丝滑无阻塞重绘预览
  useEffect(() => {
    const animId = requestAnimationFrame(requestRender);
    return () => cancelAnimationFrame(animId);
  }, [requestRender]);

  // 坐标转换辅助：计算 PointerEvent 在画布内部分辨率中的真实像素位置
  const getCanvasCoords = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  };

  // 画布拖拽事件
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (images.length <= 1) return;
    const coords = getCanvasCoords(e);
    const currentLayout = computeLayout(images, direction, gridCols, gap, padding, borderRadius, false);
    const hitIndex = findHitItemIndex(currentLayout.items, coords.x, coords.y);
    if (hitIndex !== null) {
      const hitItem = currentLayout.items[hitIndex];
      dragRef.current = {
        isPointerDown: true,
        isDragging: false,
        dragIndex: hitIndex,
        targetIndex: hitIndex,
        startPos: coords,
        currentPos: coords,
        grabOffset: {
          x: coords.x - hitItem.x,
          y: coords.y - hitItem.y,
        },
      };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas || images.length === 0) return;
    const coords = getCanvasCoords(e);
    const currentLayout = computeLayout(images, direction, gridCols, gap, padding, borderRadius, false);

    if (!dragRef.current.isPointerDown) {
      const hoverIdx = findHitItemIndex(currentLayout.items, coords.x, coords.y);
      hoverIdxRef.current = hoverIdx;
      canvas.style.cursor = hoverIdx !== null ? "grab" : "default";
      return;
    }

    // 已按下并移动
    const dist = Math.hypot(coords.x - dragRef.current.startPos.x, coords.y - dragRef.current.startPos.y);
    if (!dragRef.current.isDragging && dist > 5) {
      dragRef.current.isDragging = true;
      canvas.style.cursor = "grabbing";
    }

    if (dragRef.current.isDragging) {
      dragRef.current.currentPos = coords;
      dragRef.current.targetIndex = findNearestItemIndex(currentLayout.items, coords.x, coords.y);
      requestRender();
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }

    const { isDragging, dragIndex, targetIndex } = dragRef.current;
    if (isDragging && dragIndex !== null && targetIndex !== null && dragIndex !== targetIndex) {
      setImages((prev) => {
        const next = [...prev];
        const [moved] = next.splice(dragIndex, 1);
        next.splice(targetIndex, 0, moved);
        return next;
      });
      toast({
        title: `已调换位置：图 ${dragIndex + 1} 移至第 ${targetIndex + 1} 位`,
        variant: "info",
      });
    }

    dragRef.current = {
      isPointerDown: false,
      isDragging: false,
      dragIndex: null,
      targetIndex: null,
      startPos: { x: 0, y: 0 },
      currentPos: { x: 0, y: 0 },
      grabOffset: { x: 0, y: 0 },
    };
    if (canvas) canvas.style.cursor = "default";
    requestRender();
  };

  const handlePointerLeave = () => {
    const canvas = canvasRef.current;
    if (!dragRef.current.isPointerDown && canvas) {
      canvas.style.cursor = "default";
    }
  };

  const handleExport = () => {
    if (!images.length) return;
    setIsExporting(true);

    // 异步执行导出，保证 UI loading 反馈立即渲染
    setTimeout(() => {
      try {
        const exportCanvas = document.createElement("canvas");
        drawToCanvas(exportCanvas, true); // 全尺寸高画质渲染

        const mime = `image/${exportFormat}`;
        exportCanvas.toBlob(
          (blob) => {
            if (!blob) throw new Error("导出失败");
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `FurinaKit_Merge_${Date.now()}.${exportFormat}`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 4000);
            setIsExporting(false);
            setConfetti((c) => c + 1);
            toast({ title: "超清长图导出成功！", variant: "success" });
          },
          mime,
          0.94
        );
      } catch {
        setIsExporting(false);
        toast({ title: "导出失败", variant: "error" });
      }
    }, 40);
  };

  return (
    <div className="space-y-6">
      {confetti > 0 && <Confetti key={confetti} />}

      {/* 顶部控制栏 */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-xs space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Layers size={18} />
            </span>
            <div>
              <h3 className="text-sm font-bold text-foreground">多图拼接 / 拼长图工作台</h3>
              <p className="text-xs text-muted-foreground">自由组合、拖拽调序、间距圆角自定义，所见即所得导出高清长图</p>
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
            {images.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setImages([])}
                className="text-muted-foreground hover:text-destructive text-xs"
              >
                清空全部
              </Button>
            )}
          </div>
        </div>

        {/* 排版参数设置 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2 border-t border-border/60">
          {/* 排列方向 */}
          <div className="space-y-1.5">
            <Label className="text-xs">排列方向</Label>
            <Select
              value={direction}
              onChange={(e) => setDirection(e.target.value as "vertical" | "horizontal" | "grid")}
              className="h-9 text-xs"
            >
              <option value="vertical">📜 纵向长图 (推荐)</option>
              <option value="horizontal">↔️ 横向拼接</option>
              <option value="grid">⊞ 宫格多列</option>
            </Select>
          </div>

          {/* 宫格列数 (当为宫格时可用) */}
          {direction === "grid" ? (
            <div className="space-y-1.5">
              <Label className="text-xs">宫格列数</Label>
              <Select
                value={String(gridCols)}
                onChange={(e) => setGridCols(Number(e.target.value))}
                className="h-9 text-xs"
              >
                <option value="2">2 列</option>
                <option value="3">3 列 (九宫格)</option>
                <option value="4">4 列</option>
              </Select>
            </div>
          ) : (
            /* 图片间距 */
            <div className="space-y-1.5">
              <div className="flex justify-between text-xs">
                <Label className="text-xs">图片间距</Label>
                <span className="text-muted-foreground font-mono">{gap}px</span>
              </div>
              <input
                type="range"
                min={0}
                max={40}
                value={gap}
                onChange={(e) => setGap(Number(e.target.value))}
                className="w-full accent-primary h-2 bg-muted rounded cursor-pointer mt-2"
              />
            </div>
          )}

          {/* 圆角与边距 */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <Label className="text-xs">图片圆角</Label>
              <span className="text-muted-foreground font-mono">{borderRadius}px</span>
            </div>
            <input
              type="range"
              min={0}
              max={30}
              value={borderRadius}
              onChange={(e) => setBorderRadius(Number(e.target.value))}
              className="w-full accent-primary h-2 bg-muted rounded cursor-pointer mt-2"
            />
          </div>

          {/* 背景色与格式 */}
          <div className="space-y-1.5">
            <Label className="text-xs">背景颜色</Label>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={bgColor}
                onChange={(e) => setBgColor(e.target.value)}
                className="h-9 w-10 p-0.5 rounded-lg border border-border cursor-pointer bg-card"
              />
              <div className="flex gap-1">
                {[
                  { name: "白", val: "#ffffff" },
                  { name: "黑", val: "#18181b" },
                  { name: "米", val: "#faf7f2" },
                ].map((c) => (
                  <button
                    key={c.val}
                    type="button"
                    onClick={() => setBgColor(c.val)}
                    className="h-9 px-2 text-[11px] rounded-lg border border-border hover:border-primary text-muted-foreground"
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 底部导出操作 */}
        <div className="flex items-center justify-between pt-2">
          <span className="text-xs text-muted-foreground">已选 {images.length} 张图片</span>
          <div className="flex items-center gap-3">
            <Select
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value as "png" | "jpeg" | "webp")}
              className="h-9 text-xs w-28"
            >
              <option value="png">PNG (无损)</option>
              <option value="jpeg">JPG (高压缩)</option>
              <option value="webp">WebP (高效)</option>
            </Select>

            <Button
              onClick={handleExport}
              disabled={!images.length || isExporting}
              className="gap-2 px-6"
            >
              <Download size={15} />
              {isExporting ? "正在导出…" : "导出拼接长图"}
            </Button>
          </div>
        </div>
      </div>

      {/* 无图片上传占位 */}
      {images.length === 0 && (
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
          <p className="text-sm font-semibold text-foreground">上传需要拼接的图片序列</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm">
            支持拖拽多张图片，可随意调节拼接顺序与排版样式
          </p>
        </div>
      )}

      {/* 双栏布局：左侧顺序调整，右侧大视口画布 */}
      {images.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* 左侧：图片列表与排序 */}
          <div className="lg:col-span-4 rounded-2xl border border-border bg-card p-4 shadow-xs space-y-3 flex flex-col justify-between">
            <div className="space-y-2">
              <div className="flex items-center justify-between pb-1 border-b border-border/60">
                <span className="text-xs font-bold text-foreground">图片序列 ({images.length})</span>
                <span className="text-[11px] text-muted-foreground">上下移动调序</span>
              </div>

              <div className="max-h-[480px] overflow-y-auto space-y-2 pr-1 thin-scroll">
                {images.map((it, idx) => (
                  <div
                    key={it.id}
                    className="flex items-center justify-between gap-2.5 rounded-xl border border-border/80 bg-background/50 p-2.5 text-xs transition-colors hover:border-border"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary">
                        {idx + 1}
                      </span>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={it.previewUrl}
                        alt={it.file.name}
                        className="h-10 w-10 shrink-0 rounded-lg object-cover border border-border"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="font-semibold text-foreground truncate">{it.file.name}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {it.width} × {it.height}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        onClick={() => moveUp(idx)}
                        disabled={idx === 0}
                        title="上移"
                        className="flex h-6 w-6 items-center justify-center rounded hover:bg-accent disabled:opacity-30"
                      >
                        <ArrowUp size={12} />
                      </button>
                      <button
                        onClick={() => moveDown(idx)}
                        disabled={idx === images.length - 1}
                        title="下移"
                        className="flex h-6 w-6 items-center justify-center rounded hover:bg-accent disabled:opacity-30"
                      >
                        <ArrowDown size={12} />
                      </button>
                      <button
                        onClick={() => removeImg(it.id)}
                        title="删除"
                        className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <Button
              onClick={handleExport}
              className="w-full gap-2 mt-4 font-semibold"
            >
              <Download size={15} /> 立即导出拼接图片
            </Button>
          </div>

          {/* 右侧：实时 Canvas 渲染大视口 */}
          <div className="lg:col-span-8 rounded-2xl border border-border bg-card p-5 shadow-xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-1.5 text-xs font-bold text-foreground">
                <Eye size={15} className="text-primary" />
                拼接效果实时画布预览
              </span>
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 border border-primary/20 px-2.5 py-0.5 text-[11px] font-medium text-primary">
                  <Move size={11} /> 鼠标按住图片可直接在画布上拖拽调序
                </span>
                <span className="hidden sm:inline text-xs text-muted-foreground">· 导出为原始分辨率</span>
              </div>
            </div>

            <div
              className="flex max-h-[560px] min-h-[420px] w-full items-center justify-center overflow-auto rounded-xl border border-border/80 p-4"
              style={{
                backgroundImage: "radial-gradient(circle, rgba(120,120,120,0.15) 1px, transparent 1px)",
                backgroundSize: "20px 20px",
              }}
            >
              <canvas
                ref={canvasRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={handlePointerUp}
                onPointerLeave={handlePointerLeave}
                className="max-h-[500px] max-w-full rounded-lg shadow-lg object-contain transition-all select-none touch-none"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
