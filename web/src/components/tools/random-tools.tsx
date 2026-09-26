"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/random-tools.tsx");


/**
 * 随机与决策类工具：抽奖转盘、随机决策器。
 *
 * 布局选择：
 *   · 抽奖转盘 —— **模式 B（工作台 4:8）**：左边编辑奖项（名称 + 权重 + 是否不重复），
 *     右边是**大的转盘本体**。转盘必须给足面积 —— 它就是这个工具的全部意义，
 *     挤在小方块里既不好看也看不清字。
 *   · 随机决策器 —— **模式 A（转换对照）**：左边填候选，右边出结果。支持多种随机方式
 *     （抽一个 / 抛硬币 / 掷骰子 / 打乱排序 / 不重复抽签），结果与历史记录都放在右侧。
 *
 * 关于 canvas 里的配色：界面本体一律走主题变量；画在 canvas 上的扇区颜色属于"导出/绘制内容"，
 * 做法是**从主题的 primary 颜色推导出同色系的深浅**（见 buildPalette），这样三套主题下都不会突兀。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Coins,
  Dices,
  Eraser,
  History,
  ListOrdered,
  Minus,
  Plus,
  RotateCcw,
  Shuffle,
  Sparkles,
  Target,
  Trash2,
  Trophy,
} from "lucide-react";
import { Badge, Button, Input, Label, Select } from "@/components/ui/primitives";
import { CopyButton } from "./copy-button";
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

function ErrorBar({ message }: { message: string }) {
  const __locale = __useLanguage();
  return (
    <div className="flex items-center gap-2 rounded-xl border-l-4 border-l-destructive bg-destructive/10 px-4 py-3 font-mono text-xs text-destructive">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      {__msg(message)}
    </div>
  );
}

/** 把主题色转成 HSL 分量，便于生成同色系的一组颜色 */
function readPrimaryHsl(): { h: number; s: number; l: number } {
  if (typeof window === "undefined") return { h: 32, s: 75, l: 45 };
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--primary").trim();
  // 项目里 --primary 存的是 "32 75% 45%" 这种 HSL 分量
  const m = /^([\d.]+)\s+([\d.]+)%\s+([\d.]+)%$/.exec(raw);
  if (m) return { h: Number(m[1]), s: Number(m[2]), l: Number(m[3]) };
  return { h: 32, s: 75, l: 45 };
}

/** 从主题色推导出一组同色系、深浅交替的颜色（浅色主题下也够清楚） */
function buildPalette(count: number): string[] {
  const { h, s, l } = readPrimaryHsl();
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const hue = (h + i * (360 / Math.max(count, 3)) * 0.35) % 360; // 小幅度偏色，保持同一家族
    const light = l + (i % 2 === 0 ? 12 : -8); // 深浅交替，相邻扇区能分开
    out.push(`hsl(${hue.toFixed(1)} ${Math.min(90, s).toFixed(0)}% ${Math.max(28, Math.min(78, light)).toFixed(0)}%)`);
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════════
// 工具一：抽奖转盘
// ══════════════════════════════════════════════════════════════════════

interface WheelItem {
  id: number;
  name: string;
  weight: number;
}

export function LuckyWheelTool() {
  const __locale = __useLanguage();
  const [items, setItems] = useState<WheelItem[]>([
    { id: 1, name: "一等奖", weight: 1 },
    { id: 2, name: "二等奖", weight: 2 },
    { id: 3, name: "三等奖", weight: 3 },
    { id: 4, name: "再来一次", weight: 4 },
    { id: 5, name: "谢谢参与", weight: 6 },
  ]);
  const [noRepeat, setNoRepeat] = useToolDraft("lucky-wheel", "noRepeat", false);
  const [spinning, setSpinning] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const angleRef = useRef(0); // 当前旋转角（弧度）
  const rafRef = useRef<number | null>(null);

  const totalWeight = items.reduce((s, i) => s + Math.max(0.0001, i.weight), 0);

  const draw = useCallback(
    (rotation: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      const dpr = window.devicePixelRatio || 1;
      const size = 360;
      canvas.width = size * dpr;
      canvas.height = size * dpr;
      canvas.style.width = `${size}px`;
      canvas.style.height = `${size}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, size, size);

      const cx = size / 2;
      const cy = size / 2;
      const radius = size / 2 - 6;
      const palette = buildPalette(Math.max(items.length, 2));
      const textColor = getComputedStyle(document.documentElement).getPropertyValue("--card-foreground").trim() || "0 0% 10%";
      const isLight = (() => {
        const l = readPrimaryHsl().l;
        return l > 55;
      })();
      const label = isLight ? "hsl(30 20% 18%)" : "hsl(40 30% 96%)";

      if (items.length === 0) {
        ctx.fillStyle = "hsl(0 0% 60% / 0.25)";
        ctx.beginPath();
        ctx.arc(cx, cy, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = label;
        ctx.font = "14px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(__ui("尚未添加奖项，请先在左侧添加"), cx, cy);
        return;
      }

      let start = rotation;
      items.forEach((item, idx) => {
        const span = (Math.max(0.0001, item.weight) / totalWeight) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.arc(cx, cy, radius, start, start + span);
        ctx.closePath();
        ctx.fillStyle = palette[idx % palette.length];
        ctx.fill();
        ctx.strokeStyle = "hsl(0 0% 100% / 0.35)";
        ctx.lineWidth = 1;
        ctx.stroke();

        // 文字沿半径方向写
        const mid = start + span / 2;
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(mid);
        ctx.textAlign = "right";
        ctx.textBaseline = "middle";
        ctx.fillStyle = label;
        const fontSize = span < 0.35 ? 11 : 13;
        ctx.font = `600 ${fontSize}px system-ui, sans-serif`;
        const text = item.name.length > 8 ? item.name.slice(0, 8) + "…" : item.name;
        ctx.fillText(text, radius - 14, 0);
        ctx.restore();

        start += span;
      });

      // 中心圆
      ctx.beginPath();
      ctx.arc(cx, cy, 34, 0, Math.PI * 2);
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--card").trim()
        ? `hsl(${getComputedStyle(document.documentElement).getPropertyValue("--card").trim()})`
        : "#fff";
      ctx.fill();
      ctx.strokeStyle = "hsl(0 0% 50% / 0.25)";
      ctx.stroke();
      ctx.fillStyle = "hsl(0 0% 45%)";
      ctx.font = "600 12px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(__ui("转盘"), cx, cy);

      // 指针（顶部）
      ctx.beginPath();
      ctx.moveTo(cx, 6);
      ctx.lineTo(cx - 11, 32);
      ctx.lineTo(cx + 11, 32);
      ctx.closePath();
      ctx.fillStyle = "hsl(0 0% 55%)";
      ctx.fill();
    },
    [items, totalWeight],
  );

  useEffect(() => {
    draw(angleRef.current);
    const onResize = () => draw(angleRef.current);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [draw]);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const spin = () => {
    const pool = items.filter((i) => i.name.trim());
    if (spinning || pool.length === 0) return;
    setResult(null);
    const weights = pool.map((i) => Math.max(0.0001, i.weight));
    const sum = weights.reduce((a, b) => a + b, 0);
    // 先按权重抽定中奖项，再把转盘转到那一格 —— 这样"概率"和"看起来停在哪"一定一致
    let r = Math.random() * sum;
    let pickedIndex = 0;
    for (let i = 0; i < pool.length; i++) {
      r -= weights[i];
      if (r <= 0) {
        pickedIndex = i;
        break;
      }
    }

    // 目标角度：让中奖扇区的中线停在顶部指针处
    let acc = 0;
    for (let i = 0; i < pickedIndex; i++) acc += (weights[i] / sum) * Math.PI * 2;
    const span = (weights[pickedIndex] / sum) * Math.PI * 2;
    const mid = acc + span / 2;
    const start = angleRef.current;
    const turns = 5 + Math.floor(Math.random() * 3);
    // canvas 里 0 弧度在 3 点方向，指针在 12 点方向（-PI/2），据此换算
    const target = -Math.PI / 2 - mid;
    const end = start + turns * Math.PI * 2 + (((target - start) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const duration = 3600;
    const t0 = performance.now();
    setSpinning(true);

    const step = (now: number) => {
      const p = Math.min(1, (now - t0) / duration);
      const eased = 1 - Math.pow(1 - p, 3); // 先快后慢
      const current = start + (end - start) * eased;
      angleRef.current = current;
      draw(current);
      if (p < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        setSpinning(false);
        const winner = pool[pickedIndex].name;
        setResult(winner);
        setHistory((h) => [winner, ...h].slice(0, 30));
        if (noRepeat) {
          setItems((prev) => prev.filter((i) => i.id !== pool[pickedIndex].id));
        }
      }
    };
    rafRef.current = requestAnimationFrame(step);
  };

  const addItem = (name = "") => setItems((prev) => [...prev, { id: Date.now() + Math.random(), name, weight: 1 }]);
  const updateItem = (id: number, patch: Partial<WheelItem>) =>
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)));

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="thin-scroll space-y-4 lg:col-span-5">
          <SectionCard
            icon={<Target className="h-4 w-4" />}
            title={__msg("奖项设置（{0} 项）", items.length)}
            extra={
              <div className="flex items-center gap-1.5">
                <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => addItem()}>
                  <Plus className="h-3.5 w-3.5" /> {__ui("加一项")}</Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1.5"
                  onClick={() =>
                    setItems([
                      { id: 1, name: "一等奖", weight: 1 },
                      { id: 2, name: "二等奖", weight: 2 },
                      { id: 3, name: "三等奖", weight: 3 },
                      { id: 4, name: "再来一次", weight: 4 },
                      { id: 5, name: "谢谢参与", weight: 6 },
                    ])
                  }
                >
                  <Sparkles className="h-3.5 w-3.5" /> {__ui("示例")}</Button>
              </div>
            }
          >
            <div className="space-y-2">
              {items.map((item, idx) => (
                <div key={item.id} className="flex items-center gap-2 rounded-xl border border-border/60 bg-background/40 p-2">
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[11px] font-semibold"
                    style={{
                      background: buildPalette(Math.max(items.length, 2))[idx % Math.max(items.length, 2)],
                      color: "hsl(40 30% 97%)",
                    }}
                  >
                    {idx + 1}
                  </span>
                  <Input
                    value={item.name}
                    onChange={(e) => updateItem(item.id, { name: e.target.value })}
                    placeholder={__ui("奖项名称")}
                    className="min-w-0 flex-1 text-xs"
                  />
                  <div className="flex items-center gap-1">
                    <Label className="text-[10.5px] text-muted-foreground">{__ui("权重")}</Label>
                    <Input
                      type="number"
                      min="0.1"
                      step="0.5"
                      value={String(item.weight)}
                      onChange={(e) => updateItem(item.id, { weight: Number(e.target.value) || 1 })}
                      className="h-8 w-16 text-[11.5px]"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => setItems((prev) => prev.filter((i) => i.id !== item.id))}
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                    aria-label={__ui("删除")}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {items.length === 0 && (
                <p className="py-6 text-center text-xs text-muted-foreground">{__ui("还没有奖项，点右上「加一项」开始")}</p>
              )}
            </div>

            <label className="mt-3 flex cursor-pointer items-center gap-2 rounded-xl border border-border/60 bg-background/40 px-3 py-2">
              <input type="checkbox" checked={noRepeat} onChange={(e) => setNoRepeat(e.target.checked)} className="accent-primary" />
              <span className="text-xs text-foreground">{__ui("不重复中奖（中过的奖项自动移出转盘）")}</span>
            </label>

            <div className="mt-3 rounded-xl border border-border/60 bg-secondary/20 p-3">
              <div className="mb-1.5 text-[11.5px] font-medium text-foreground">{__ui("各奖项概率")}</div>
              <div className="space-y-1">
                {items
                  .filter((i) => i.name.trim())
                  .map((i) => (
                    <div key={i.id} className="flex items-center gap-2 text-[11.5px]">
                      <span className="w-24 shrink-0 truncate text-muted-foreground">{__ui(i.name)}</span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                        <span
                          className="block h-full rounded-full bg-primary"
                          style={{ width: `${(Math.max(0.0001, i.weight) / totalWeight) * 100}%` }}
                        />
                      </span>
                      <span className="w-12 shrink-0 text-right font-mono text-foreground">
                        {((Math.max(0.0001, i.weight) / totalWeight) * 100).toFixed(1)}%
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          </SectionCard>
        </div>

        <div className="thin-scroll space-y-4 lg:col-span-7">
          <SectionCard
            icon={<RotateCcw className="h-4 w-4" />}
            title={__ui("转盘")}
            extra={
              <Button type="button" onClick={spin} disabled={spinning || items.length === 0} className="gap-1.5">
                <Dices className={cn("h-3.5 w-3.5", spinning && "animate-spin")} />
                {spinning ? __ui("转动中…") : __ui("开始抽奖")}
              </Button>
            }
          >
            <div className="flex flex-col items-center gap-4">
              <canvas ref={canvasRef} className="select-none" />

              {result && !spinning && (
                <div className="w-full max-w-sm rounded-xl border border-primary/30 bg-primary/[0.07] px-4 py-3 text-center">
                  <div className="flex items-center justify-center gap-1.5 text-[11.5px] text-muted-foreground">
                    <Trophy className="h-3.5 w-3.5 text-primary" />
                    {__ui("本次结果")}</div>
                  <div className="mt-1 text-xl font-bold text-primary">{result}</div>
                </div>
              )}

              {items.length === 0 && (
                <p className="text-xs text-muted-foreground">{__ui("奖项已全部抽完，可取消「不重复中奖」或重新添加奖项")}</p>
              )}
            </div>
          </SectionCard>

          <SectionCard
            icon={<History className="h-4 w-4" />}
            title={__msg("中奖记录（{0}）", history.length)}
            extra={
              history.length > 0 ? (
                <div className="flex items-center gap-1.5">
                  <CopyButton value={history.map((h, i) => `${history.length - i}. ${h}`).join("\n")} label={__ui("复制记录")} />
                  <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={() => setHistory([])}>
                    <Eraser className="h-3.5 w-3.5" /> {__ui("清空")}</Button>
                </div>
              ) : undefined
            }
          >
            {history.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">{__ui("暂无记录，点击「开始抽奖」开始")}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {history.map((h, i) => (
                  <Badge key={i} variant={i === 0 ? "default" : "outline"} className="font-normal">
                    {h}
                  </Badge>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 工具二：随机决策器
// ══════════════════════════════════════════════════════════════════════

type DecisionMode = "pick" | "shuffle" | "coin" | "dice" | "unique";

const MODES: Array<{ id: DecisionMode; label: string; hint: string }> = [
  { id: "pick", label: "随机抽一个", hint: "从候选项里随机选一个" },
  { id: "shuffle", label: "打乱排序", hint: "把所有候选项随机排出先后" },
  { id: "unique", label: "不重复抽签", hint: "每次抽走一个，直到抽完（不重复）" },
  { id: "coin", label: "抛硬币", hint: "正面还是反面" },
  { id: "dice", label: "掷骰子", hint: "1~6，也可以自定义面数" },
];

export function RandomDecisionTool() {
  const __locale = __useLanguage();
  const [mode, setMode] = useToolDraft<DecisionMode>("random-decision", "mode", "pick");
  const [optionsRaw, setOptionsRaw] = useToolDraft("random-decision", "options", "吃火锅\n吃烧烤\n吃日料\n在家做");
  const [diceFaces, setDiceFaces] = useToolDraft("random-decision", "diceFaces", "6");
  const [result, setResult] = useState<{ main: string; detail?: string[] } | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [drawn, setDrawn] = useState<string[]>([]);

  const options = useMemo(
    () =>
      optionsRaw
        .split("\n")
        .map((x) => x.trim())
        .filter(Boolean),
    [optionsRaw, __locale],
  );

  const remaining = options.filter((o) => !drawn.includes(o));

  const run = () => {
    if (mode === "coin") {
      const v = Math.random() < 0.5 ? "正面" : "反面";
      setResult({ main: v });
      setHistory((h) => [v, ...h].slice(0, 30));
      return;
    }
    if (mode === "dice") {
      const faces = Math.max(2, Math.min(100, Number(diceFaces) || 6));
      const v = 1 + Math.floor(Math.random() * faces);
      setResult({ main: `${v} 点`, detail: [`${faces} 面骰子`] });
      setHistory((h) => [`${v} 点`, ...h].slice(0, 30));
      return;
    }
    if (mode === "unique") {
      if (remaining.length === 0) {
        setResult({ main: "都抽完了", detail: ["可以点「重置抽签」重新开始"] });
        return;
      }
      const picked = remaining[Math.floor(Math.random() * remaining.length)];
      setDrawn((d) => [...d, picked]);
      setResult({ main: picked, detail: [`还剩 ${remaining.length - 1} 个没抽`] });
      setHistory((h) => [picked, ...h].slice(0, 30));
      return;
    }
    if (options.length === 0) {
      setResult(null);
      return;
    }
    if (mode === "shuffle") {
      const shuffled = [...options];
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
      setResult({ main: shuffled[0], detail: shuffled.map((s, i) => `${i + 1}. ${s}`) });
      setHistory((h) => [shuffled.slice(0, 3).join(" → "), ...h].slice(0, 30));
      return;
    }
    const picked = options[Math.floor(Math.random() * options.length)];
    setResult({ main: picked, detail: [`从 ${options.length} 个候选里选出`] });
    setHistory((h) => [picked, ...h].slice(0, 30));
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="thin-scroll space-y-4 lg:col-span-5">
          <SectionCard
            icon={<ListOrdered className="h-4 w-4" />}
            title={__ui("选项")}
            extra={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOptionsRaw("吃火锅\n吃烧烤\n吃日料\n在家做")}
              >
                <Sparkles className="h-3.5 w-3.5" /> {__ui("填入示例")}</Button>
            }
          >
            <div className="mb-3 flex flex-wrap gap-1.5">
              {MODES.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setMode(m.id)}
                  title={__ui(m.hint)}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                    mode === m.id ? "bg-primary text-primary-foreground" : "bg-secondary/40 text-muted-foreground hover:bg-muted",
                  )}
                >
                  {__ui(m.label)}
                </button>
              ))}
            </div>

            {mode === "coin" || mode === "dice" ? (
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  {mode === "coin" ? __ui("抛硬币无需选项，直接点击右侧按钮。") : __ui("掷骰子支持自定义面数（2~100）。")}
                </p>
                {mode === "dice" && (
                  <div className="space-y-1.5">
                    <Label htmlFor="rd-faces">{__ui("骰子面数")}</Label>
                    <Input
                      id="rd-faces"
                      type="number"
                      value={diceFaces}
                      onChange={(e) => setDiceFaces(e.target.value)}
                      className="w-28 text-xs"
                    />
                  </div>
                )}
              </div>
            ) : (
              <>
                <textarea
                  value={optionsRaw}
                  onChange={(e) => setOptionsRaw(e.target.value)}
                  placeholder={__ui("一行一个选项，例如：\n吃火锅\n吃烧烤\n吃日料")}
                  className="thin-scroll min-h-[200px] w-full rounded-xl border border-border/60 bg-background/50 px-3 py-2 font-mono text-xs leading-relaxed text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary"
                />
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">
                    {__ui("共")}{options.length} {__ui("个选项")}{mode === "unique" && drawn.length > 0 && __msg(" · 已抽走 {0} 个", drawn.length)}
                  </span>
                  <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={() => { setOptionsRaw(""); setDrawn([]); setResult(null); }}>
                    <Eraser className="h-3.5 w-3.5" /> {__ui("清空")}</Button>
                </div>
                {mode === "unique" && drawn.length > 0 && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5 rounded-xl border border-border/60 bg-secondary/20 p-2">
                    <span className="text-[11px] text-muted-foreground">{__ui("已抽走：")}</span>
                    {drawn.map((d) => (
                      <Badge key={d} variant="outline" className="font-normal">
                        {d}
                      </Badge>
                    ))}
                    <button
                      type="button"
                      onClick={() => setDrawn([])}
                      className="ml-auto rounded-md px-1.5 py-0.5 text-[11px] text-primary transition-colors hover:bg-primary/10"
                    >
                      {__ui("重置抽签")}</button>
                  </div>
                )}
              </>
            )}
          </SectionCard>
        </div>

        <div className="thin-scroll space-y-4 lg:col-span-7">
          <SectionCard
            icon={<Shuffle className="h-4 w-4" />}
            title={__ui("结果")}
            extra={
              <Button type="button" onClick={run} className="gap-1.5">
                {mode === "coin" ? <Coins className="h-3.5 w-3.5" /> : <Shuffle className="h-3.5 w-3.5" />}
                {mode === "coin" ? __ui("抛硬币") : mode === "dice" ? __ui("掷骰子") : __ui("帮我决定")}
              </Button>
            }
          >
            {!result ? (
              <div className="flex flex-col items-center justify-center gap-2.5 py-16 text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Shuffle className="h-5 w-5" />
                </span>
                <p className="text-sm font-medium text-foreground">{__ui("填写选项后，点击右上角按钮")}</p>
                <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
                  {__ui("无法决定时可交由随机数处理，另支持抛硬币、掷骰子与打乱排序。")}</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="rounded-xl border border-primary/30 bg-primary/[0.07] px-4 py-5 text-center">
                  <div className="text-[11.5px] text-muted-foreground">{__ui("结果")}</div>
                  <div className="mt-1 text-2xl font-bold text-primary">{result.main}</div>
                  {result.detail && result.detail.length === 1 && (
                    <div className="mt-1 text-[11.5px] text-muted-foreground">{result.detail[0]}</div>
                  )}
                </div>
                {result.detail && result.detail.length > 1 && (
                  <div className="rounded-xl border border-border/60 bg-background/40 p-3">
                    <div className="mb-1.5 text-[11.5px] font-medium text-foreground">{__ui("完整顺序")}</div>
                    <ol className="space-y-1 text-[12px] text-muted-foreground">
                      {result.detail.map((d, i) => (
                        <li key={i} className={cn(i === 0 && "font-medium text-foreground")}>
                          {d}
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            )}
          </SectionCard>

          <SectionCard
            icon={<History className="h-4 w-4" />}
            title={__msg("历史（{0}）", history.length)}
            extra={
              history.length > 0 ? (
                <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={() => setHistory([])}>
                  <Eraser className="h-3.5 w-3.5" /> {__ui("清空")}</Button>
              ) : undefined
            }
          >
            {history.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">{__ui("还没有记录")}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {history.map((h, i) => (
                  <Badge key={i} variant={i === 0 ? "default" : "outline"} className="font-normal">
                    {h}
                  </Badge>
                ))}
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
