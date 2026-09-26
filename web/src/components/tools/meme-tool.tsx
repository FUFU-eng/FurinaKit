"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/meme-tool.tsx");


/**
 * 表情包制作。
 *
 * 参考同类工具（斗图类 App、在线表情包生成器）的通用做法：
 *   · 图片 + 上下两行大字，白字黑边（这是"表情包"最核心的视觉特征）；
 *   · 文字可拖动、可调字号与颜色、可加描边；
 *   · 不需要图片也能做：纯色 / 渐变底 + 文字，就是一张"字图"；
 *   · 一键导出 PNG。
 *
 * 实现全部在画布上完成（导出的就是所见画面）。
 * 布局：**模式 B（4:8）** —— 左边是参数与文字，右边大预览（可拖动文字位置）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Eraser,
  Image as ImageIcon,
  Info,
  Loader2,
  Move,
  Palette,
  Smile,
  Sparkles,
  Type,
  Upload,
  Download,
} from "lucide-react";
import { Button, Input, Label, Select } from "@/components/ui/primitives";
import { useToolDraft } from "@/lib/use-tool-draft";
import { cn } from "@/lib/utils";

function SectionCard({
  icon,
  title,
  extra,
  children,
  className,
}: {
  icon?: React.ReactNode;
  title?: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const __locale = __useLanguage();
  return (
    <div className={cn("rounded-2xl border border-border/70 bg-card/60 p-5 shadow-sm backdrop-blur-md", className)}>
      {(title || extra) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
          <div className="flex items-center gap-2">
            {icon && (
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</span>
            )}
            {title && <span className="text-sm font-semibold text-foreground">{__ui(title)}</span>}
          </div>
          {extra}
        </div>
      )}
      {children}
    </div>
  );
}

/** 常用表情/颜文字，点了直接追加到文字里 */
const EMOJI = ["😂", "🤣", "😭", "😅", "🙃", "😏", "🤔", "😱", "🥲", "😤", "🤯", "😴", "🐶", "🐱", "🍜", "💔", "🔥", "✨", "👍", "🙏"];
/** 纯色 / 渐变底色（不传图时用） */
const BACKDROPS = [
  { id: "warm", name: "暖黄", css: ["#ffd76e", "#ffb03a"] },
  { id: "blue", name: "天蓝", css: ["#7ec8ff", "#4a9df0"] },
  { id: "mint", name: "薄荷", css: ["#a8ecd0", "#63d5a8"] },
  { id: "pink", name: "粉红", css: ["#ffc2d6", "#ff8fb1"] },
  { id: "dark", name: "深灰", css: ["#4a4f57", "#23262b"] },
  { id: "paper", name: "米白", css: ["#f7f3ea", "#e6dfd0"] },
];

const FONTS = [
  { id: "yahei", name: "微软雅黑（最通用）", css: '"Microsoft YaHei", "PingFang SC", sans-serif' },
  { id: "hei", name: "黑体（更粗更醒目）", css: '"SimHei", "Microsoft YaHei", sans-serif' },
  { id: "song", name: "宋体（文艺一点）", css: '"SimSun", "Songti SC", serif' },
  { id: "kai", name: "楷体（手写感）", css: '"KaiTi", "Kaiti SC", serif' },
];

interface MemeState {
  topText: string;
  bottomText: string;
  centerText: string;
  topSize: number;
  bottomSize: number;
  centerSize: number;
  color: string;
  stroke: number;
  fontId: string;
  backdrop: string;
  imageScale: number;
  topY: number; // 0~1 相对高度
  bottomY: number;
}

const DEFAULT_STATE: MemeState = {
  topText: "",
  bottomText: "",
  centerText: "",
  topSize: 64,
  bottomSize: 64,
  centerSize: 56,
  color: "#ffffff",
  stroke: 6,
  fontId: "yahei",
  backdrop: "warm",
  imageScale: 1,
  topY: 0.08,
  bottomY: 0.92,
};

export function MemeMakerTool() {
  const __locale = __useLanguage();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [state, setState] = useState<MemeState>(DEFAULT_STATE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dragTarget, setDragTarget] = useState<null | "top" | "center" | "bottom">(null);
  const [outW, setOutW] = useState(720);
  const [outH, setOutH] = useState(720);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const font = FONTS.find((f) => f.id === state.fontId) ?? FONTS[0];

  const set = <K extends keyof MemeState>(k: K, v: MemeState[K]) => setState((p) => ({ ...p, [k]: v }));

  // 载入图片
  const loadImage = useCallback(async (file: File | null | undefined) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("请选择图片文件");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      await new Promise<void>((res, rej) => {
        img.onload = () => res();
        img.onerror = () => rej(new Error("这张图片打不开"));
        img.src = url;
      });
      imgRef.current = img;
      setImageUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return url;
      });
      // 画布尺寸跟随图片（限制最大边，避免超大图卡顿）
      const maxSide = 1200;
      const k = Math.min(1, maxSide / Math.max(img.width, img.height));
      setOutW(Math.round(img.width * k));
      setOutH(Math.round(img.height * k));
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取图片失败");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    return () => {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 画一行动态文字：白字 + 黑边（表情包的标准样式） */
  const drawTextLine = (
    ctx: CanvasRenderingContext2D,
    text: string,
    cx: number,
    cy: number,
    size: number,
    color: string,
    stroke: number,
    fontCss: string,
  ) => {
    if (!text.trim()) return;
    ctx.font = `bold ${size}px ${fontCss}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.miterLimit = 2;
    if (stroke > 0) {
      ctx.strokeStyle = "#000000";
      ctx.lineWidth = stroke * 2;
      ctx.strokeText(text, cx, cy);
    }
    ctx.fillStyle = color;
    ctx.fillText(text, cx, cy);
  };

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext("2d")!;
    ctx.clearRect(0, 0, outW, outH);

    // 底：图片或渐变
    if (imgRef.current) {
      const img = imgRef.current;
      const k = Math.max(outW / img.width, outH / img.height) * state.imageScale;
      const w = img.width * k;
      const h = img.height * k;
      ctx.drawImage(img, (outW - w) / 2, (outH - h) / 2, w, h);
    } else {
      const bd = BACKDROPS.find((b) => b.id === state.backdrop) ?? BACKDROPS[0];
      const g = ctx.createLinearGradient(0, 0, 0, outH);
      g.addColorStop(0, bd.css[0]);
      g.addColorStop(1, bd.css[1]);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, outW, outH);
    }

    const scale = outW / 720; // 以 720 宽为基准换算字号
    // 文字按宽度自动折行
    const wrap = (text: string, size: number): string[] => {
      if (!text.trim()) return [];
      ctx.font = `bold ${size}px ${font.css}`;
      const maxWidth = outW * 0.92;
      const lines: string[] = [];
      for (const para of text.split("\n")) {
        let cur = "";
        for (const ch of Array.from(para)) {
          const test = cur + ch;
          if (ctx.measureText(test).width > maxWidth && cur) {
            lines.push(cur);
            cur = ch;
          } else {
            cur = test;
          }
        }
        if (cur) lines.push(cur);
      }
      return lines;
    };

    // 上
    const topLines = wrap(state.topText, state.topSize * scale);
    topLines.forEach((l, i) => {
      drawTextLine(
        ctx,
        l,
        outW / 2,
        state.topY * outH + i * state.topSize * scale * 1.1,
        state.topSize * scale,
        state.color,
        state.stroke * scale,
        font.css,
      );
    });
    // 中
    const centerLines = wrap(state.centerText, state.centerSize * scale);
    centerLines.forEach((l, i) => {
      const offset = (i - (centerLines.length - 1) / 2) * state.centerSize * scale * 1.15;
      drawTextLine(ctx, l, outW / 2, outH / 2 + offset, state.centerSize * scale, state.color, state.stroke * scale, font.css);
    });
    // 下（多行时整体上移，避免超出画面）
    const bottomLines = wrap(state.bottomText, state.bottomSize * scale);
    bottomLines.forEach((l, i) => {
      const y = state.bottomY * outH - (bottomLines.length - 1 - i) * state.bottomSize * scale * 1.1;
      drawTextLine(ctx, l, outW / 2, y, state.bottomSize * scale, state.color, state.stroke * scale, font.css);
    });
  }, [state, outW, outH, font]);

  useEffect(() => {
    draw();
  }, [draw]);

  /** 在预览上拖动：按落点纵坐标决定拖的是"上""中""下"哪一行 */
  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const rel = (e.clientY - rect.top) / rect.height;
    const t = state.topText ? Math.abs(rel - state.topY) : 9;
    const b = state.bottomText ? Math.abs(rel - state.bottomY) : 9;
    const c = state.centerText ? Math.abs(rel - 0.5) : 9;
    const which = t <= b && t <= c ? "top" : b <= c ? "bottom" : "center";
    setDragTarget(which);
    canvas.setPointerCapture(e.pointerId);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!dragTarget) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const rel = Math.max(0.03, Math.min(0.97, (e.clientY - rect.top) / rect.height));
    if (dragTarget === "top") set("topY", rel);
    if (dragTarget === "bottom") set("bottomY", rel);
  };

  const onPointerUp = () => setDragTarget(null);

  const exportPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `表情包_${Date.now()}.png`;
      // ★ 游离的 <a> 直接 click() 在 WebView2 里会被忽略（点了没反应）——
    //   必须挂到 DOM 上再点，点完移除（通用结果卡那边用的是页面里的真链接，所以正常）
    document.body.appendChild(a);
    document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 1000);
    setTimeout(() => a.remove(), 1000);
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    }, "image/png");
  };

  const presets = useMemo(
    () => [
      { id: "classic", name: "经典白字黑边", apply: { color: "#ffffff", stroke: 6 } },
      { id: "yellow", name: "醒目黄字", apply: { color: "#ffe14d", stroke: 7 } },
      { id: "red", name: "报警红字", apply: { color: "#ff5a5a", stroke: 6 } },
      { id: "thin", name: "细体无衬边", apply: { color: "#ffffff", stroke: 0 } },
    ],
    [ __locale],
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="thin-scroll space-y-4 lg:col-span-4">
          <SectionCard
            icon={<ImageIcon className="h-4 w-4" />}
            title={__ui("底图（可跳过）")}
            extra={
              imageUrl ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    if (imageUrl) URL.revokeObjectURL(imageUrl);
                    imgRef.current = null;
                    setImageUrl(null);
                  }}
                >
                  <Eraser className="h-3.5 w-3.5" /> {__ui("去掉底图")}</Button>
              ) : null
            }
          >
            <div data-furinakit-file-field className="space-y-2">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-primary/35 bg-primary/[0.06] p-4 text-center transition-colors hover:border-primary/60 hover:bg-primary/10"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                </span>
                <span className="text-xs font-semibold text-foreground">{__ui("点击选择图片，或把图片拖到这里")}</span>
                <span className="text-[11px] text-muted-foreground">{__ui("不选图也能做：用下面的纯色底 + 文字")}</span>
              </button>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  void loadImage(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </div>
            {!imageUrl && (
              <div className="mt-3 space-y-1.5">
                <Label>{__ui("纯色底")}</Label>
                <div className="grid grid-cols-6 gap-1.5">
                  {BACKDROPS.map((b) => (
                    <button
                      key={b.id}
                      type="button"
                      onClick={() => set("backdrop", b.id)}
                      title={b.name}
                      className={cn(
                        "h-8 rounded-lg border transition-all",
                        state.backdrop === b.id ? "border-primary ring-2 ring-primary/30" : "border-border/60",
                      )}
                      style={{ background: `linear-gradient(180deg, ${b.css[0]}, ${b.css[1]})` }}
                    />
                  ))}
                </div>
              </div>
            )}
            {imageUrl && (
              <div className="mt-3 space-y-1">
                <div className="flex items-center justify-between text-[11.5px]">
                  <span className="text-muted-foreground">{__ui("图片缩放")}</span>
                  <span className="font-mono text-foreground">{state.imageScale.toFixed(2)}×</span>
                </div>
                <input
                  type="range"
                  min={0.5}
                  max={1.6}
                  step={0.01}
                  value={state.imageScale}
                  onChange={(e) => set("imageScale", Number(e.target.value))}
                  className="h-1.5 w-full accent-primary"
                />
              </div>
            )}
          </SectionCard>

          <SectionCard icon={<Type className="h-4 w-4" />} title={__ui("文字")}>
            <div className="space-y-3">
              {[
                { key: "topText" as const, sizeKey: "topSize" as const, label: "上方大字" },
                { key: "centerText" as const, sizeKey: "centerSize" as const, label: "中间文字" },
                { key: "bottomText" as const, sizeKey: "bottomSize" as const, label: "下方大字" },
              ].map((f) => (
                <div key={f.key} className="space-y-1.5">
                  <Label htmlFor={`mm-${f.key}`}>{__ui(f.label)}</Label>
                  <Input
                    id={`mm-${f.key}`}
                    value={state[f.key]}
                    onChange={(e) => set(f.key, e.target.value)}
                    placeholder={__ui("留空则不显示")}
                    className="text-xs"
                  />
                  <div className="flex items-center gap-2">
                    <span className="w-8 shrink-0 text-[11px] text-muted-foreground">{__ui("字号")}</span>
                    <input
                      type="range"
                      min={24}
                      max={140}
                      value={state[f.sizeKey]}
                      onChange={(e) => set(f.sizeKey, Number(e.target.value))}
                      className="h-1.5 flex-1 accent-primary"
                    />
                    <span className="w-8 shrink-0 text-right font-mono text-[11px] text-foreground">{state[f.sizeKey]}</span>
                  </div>
                </div>
              ))}
              <div className="space-y-1.5">
                <Label>{__ui("常用表情（点一下加到中间文字）")}</Label>
                <div className="flex flex-wrap gap-1">
                  {EMOJI.map((em) => (
                    <button
                      key={em}
                      type="button"
                      onClick={() => set("centerText", state.centerText + em)}
                      className="rounded-lg border border-border/60 px-1.5 py-0.5 text-[15px] transition-colors hover:bg-muted/50"
                    >
                      {em}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </SectionCard>

          <SectionCard icon={<Palette className="h-4 w-4" />} title={__ui("样式")}>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>{__ui("字体")}</Label>
                <Select value={state.fontId} onChange={(e) => set("fontId", e.target.value)} className="w-full text-xs">
                  {FONTS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {__msg(f.name)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="mm-color">{__ui("文字颜色")}</Label>
                  <input
                    id="mm-color"
                    type="color"
                    value={state.color}
                    onChange={(e) => set("color", e.target.value)}
                    className="h-9 w-full cursor-pointer rounded-lg border border-border/60 bg-transparent"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mm-stroke">{__ui("描边粗细（")}{state.stroke}）</Label>
                  <input
                    id="mm-stroke"
                    type="range"
                    min={0}
                    max={14}
                    value={state.stroke}
                    onChange={(e) => set("stroke", Number(e.target.value))}
                    className="mt-3 h-1.5 w-full accent-primary"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>{__ui("快速样式")}</Label>
                <div className="grid grid-cols-2 gap-1.5">
                  {presets.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => setState((prev) => ({ ...prev, ...p.apply }))}
                      className="rounded-lg border border-border/60 px-2 py-1.5 text-[11.5px] text-foreground transition-colors hover:bg-muted/50"
                    >
                      {__msg(p.name)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="mm-w">{__ui("导出宽")}</Label>
                  <Input id="mm-w" type="number" value={outW} onChange={(e) => setOutW(Math.max(120, Number(e.target.value) || 720))} className="text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mm-h">{__ui("导出高")}</Label>
                  <Input id="mm-h" type="number" value={outH} onChange={(e) => setOutH(Math.max(120, Number(e.target.value) || 720))} className="text-xs" />
                </div>
              </div>
            </div>
          </SectionCard>
        </div>

        <div className="thin-scroll space-y-4 lg:col-span-8">
          <SectionCard
            icon={<Smile className="h-4 w-4" />}
            title={__ui("预览（可直接拖动文字上下移动）")}
            extra={
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() =>
                    setState((p) => ({
                      ...DEFAULT_STATE,
                      topText: "当你以为今天能准时下班",
                      bottomText: "结果临时来了个需求",
                      backdrop: p.backdrop,
                      fontId: p.fontId,
                    }))
                  }
                >
                  <Sparkles className="h-3.5 w-3.5" /> {__ui("填入示例")}</Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => setState({ ...DEFAULT_STATE })}
                >
                  <Eraser className="h-3.5 w-3.5" /> {__ui("清空")}</Button>
                <Button type="button" size="sm" className="gap-1.5" onClick={exportPng}>
                  <Download className="h-3.5 w-3.5" /> {__ui("导出 PNG")}</Button>
              </div>
            }
          >
            <div className="relative flex items-center justify-center overflow-hidden rounded-xl border border-border/60 bg-muted/20 p-2">
              <canvas
                ref={canvasRef}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={onPointerUp}
                className={cn("max-h-[520px] w-auto max-w-full touch-none rounded-lg", dragTarget ? "cursor-grabbing" : "cursor-grab")}
              />
              {dragTarget && (
                <span className="pointer-events-none absolute left-3 top-3 flex items-center gap-1.5 rounded-lg bg-background/90 px-2 py-1 text-[11px] text-foreground">
                  <Move className="h-3 w-3" /> {__ui("拖动中")}</span>
              )}
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
              <span>{__ui("导出尺寸")}{outW} × {outH}</span>
              <span>{__ui("· 按住画布上下拖动可调整文字位置")}</span>
            </div>
            {error && (
              <div className="mt-3 flex items-center gap-2 rounded-xl border-l-4 border-l-destructive bg-destructive/10 px-4 py-2.5 text-xs text-destructive">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {__msg(error)}
              </div>
            )}
          </SectionCard>

          <SectionCard icon={<Info className="h-4 w-4" />} title={__ui("说明")}>
            <ul className="space-y-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
              <li>{__ui("· 文字是")}<b className="text-foreground">{__ui("白字 + 黑边")}</b>{__ui("的表情包经典样式，长句会自动折行，不会超出画面。")}</li>
              <li>{__ui("· 不选图片也能用：挑一个纯色底，配上上下两行大字，就是一张字图。")}</li>
              <li>{__ui("· 全部在本机画布上完成，图片与文字都不上传；导出的 PNG 与预览所见一致。")}</li>
              <li>{__ui("· 用别人的照片做表情包前，请确认对方不介意。")}</li>
            </ul>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
