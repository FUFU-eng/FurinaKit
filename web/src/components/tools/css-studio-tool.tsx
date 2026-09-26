"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/css-studio-tool.tsx");


/**
 * CSS 样式生成器工具箱（14 个生成器合并在一个页面）
 *
 * 架构上刻意做成数据驱动：每个生成器只声明「有哪些控件」和「怎么生成 CSS」，
 * 界面、复制、实时预览全部共用一套壳。这样加生成器只需要加一条数据，
 * 不会再出现「有的生成器做得好、有的很单薄」。
 *
 * 全部纯前端，零依赖零体积。
 */

import { useMemo, useState, type ReactNode } from "react";
import { Check, Copy, Layout, Wand2 } from "lucide-react";
import { Button, Input, Select } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

type Control =
  | { id: string; type: "range"; label: string; min: number; max: number; step?: number; unit?: string; def: number }
  | { id: string; type: "color"; label: string; def: string }
  | { id: string; type: "select"; label: string; def: string; options: { label: string; value: string }[] }
  | { id: string; type: "toggle"; label: string; def: boolean }
  | { id: string; type: "text"; label: string; def: string; placeholder?: string };

interface Generator {
  id: string;
  name: string;
  hint: string;
  controls: Control[];
  /** 生成 CSS 代码文本 */
  build: (v: Record<string, number | string | boolean>) => string;
  /** 生成预览元素（把 CSS 应用到示例上） */
  preview: (v: Record<string, number | string | boolean>, css: string) => ReactNode;
  /** 预览容器是否需要深色底 */
  dark?: boolean;
}

const px = (v: unknown) => `${v}px`;
const str = (v: unknown) => String(v);

/* ══════════════════════ 生成器定义 ══════════════════════ */

const GENERATORS: Generator[] = [
  /* 1. 阴影 */
  {
    id: "shadow",
    name: "阴影",
    hint: "可叠加多层，做出更自然的立体感",
    controls: [
      { id: "x", type: "range", label: "水平偏移", min: -40, max: 40, def: 0, unit: "px" },
      { id: "y", type: "range", label: "垂直偏移", min: -40, max: 40, def: 12, unit: "px" },
      { id: "blur", type: "range", label: "模糊", min: 0, max: 80, def: 28, unit: "px" },
      { id: "spread", type: "range", label: "扩展", min: -20, max: 30, def: -8, unit: "px" },
      { id: "alpha", type: "range", label: "不透明度", min: 0, max: 100, def: 28, unit: "%" },
      { id: "layers", type: "select", label: "层数", def: "2", options: [{ label: "单层", value: "1" }, { label: "两层（更自然）", value: "2" }, { label: "三层（更立体）", value: "3" }] },
      { id: "inset", type: "toggle", label: "内阴影", def: false },
    ],
    build: (v) => {
      const a = Number(v.alpha) / 100;
      const n = Number(v.layers);
      const base = `${v.x}px ${v.y}px ${v.blur}px ${v.spread}px rgba(0,0,0,${a.toFixed(2)})`;
      const more = [
        `0 ${Number(v.y) * 2}px ${Number(v.blur) * 2}px ${Number(v.spread) * 2}px rgba(0,0,0,${(a * 0.5).toFixed(2)})`,
        `0 ${Number(v.y) * 3}px ${Number(v.blur) * 3}px ${Number(v.spread) * 3}px rgba(0,0,0,${(a * 0.3).toFixed(2)})`,
      ];
      const list = [v.inset ? `inset ${base}` : base, ...more.slice(0, n - 1)];
      return `box-shadow: ${list.join(",\n            ")};`;
    },
    preview: (v, css) => (
      <div className="flex h-40 items-center justify-center">
        <div className="h-24 w-40 rounded-xl bg-white" style={{ boxShadow: css.replace("box-shadow:", "").replace(";", "") }} />
      </div>
    ),
  },

  /* 2. 圆角 */
  {
    id: "radius",
    name: "圆角",
    hint: "四角可分别设置，还能做「花瓣」形",
    controls: [
      { id: "tl", type: "range", label: "左上", min: 0, max: 100, def: 16, unit: "px" },
      { id: "tr", type: "range", label: "右上", min: 0, max: 100, def: 16, unit: "px" },
      { id: "br", type: "range", label: "右下", min: 0, max: 100, def: 16, unit: "px" },
      { id: "bl", type: "range", label: "左下", min: 0, max: 100, def: 16, unit: "px" },
      { id: "petal", type: "toggle", label: "花瓣形（对角相同）", def: false },
    ],
    build: (v) => {
      const tl = Number(v.tl), tr = Number(v.tr), br = Number(v.br), bl = Number(v.bl);
      if (v.petal) return `border-radius: ${tl}px ${tr}px ${tl}px ${tr}px / ${tr}px ${tl}px ${tr}px ${tl}px;`;
      return `border-radius: ${tl}px ${tr}px ${br}px ${bl}px;`;
    },
    preview: (v, css) => (
      <div className="flex h-40 items-center justify-center">
        <div className="h-28 w-40 bg-[hsl(var(--primary))]" style={{ borderRadius: css.replace("border-radius:", "").replace(";", "") }} />
      </div>
    ),
  },

  /* 3. 渐变背景 */
  {
    id: "gradient",
    name: "渐变背景",
    hint: "线性 / 径向 / 锥形，可加多段色标",
    controls: [
      { id: "type", type: "select", label: "类型", def: "linear", options: [{ label: "线性", value: "linear" }, { label: "径向", value: "radial" }, { label: "锥形", value: "conic" }] },
      { id: "angle", type: "range", label: "角度", min: 0, max: 360, def: 135, unit: "deg" },
      { id: "c1", type: "color", label: "起始色", def: "#6366f1" },
      { id: "c2", type: "color", label: "中间色", def: "#a855f7" },
      { id: "c3", type: "color", label: "结束色", def: "#ec4899" },
      { id: "useC3", type: "toggle", label: "使用第三色", def: true },
    ],
    build: (v) => {
      const stops = `${v.c1} 0%, ${v.c2} ${v.useC3 ? "50%" : "100%"}${v.useC3 ? `, ${v.c3} 100%` : ""}`;
      if (v.type === "radial") return `background: radial-gradient(circle at 50% 50%, ${stops});`;
      if (v.type === "conic") return `background: conic-gradient(from ${v.angle}deg at 50% 50%, ${stops});`;
      return `background: linear-gradient(${v.angle}deg, ${stops});`;
    },
    preview: (v, css) => (
      <div className="flex h-40 items-center justify-center">
        <div className="h-28 w-full max-w-sm rounded-xl" style={{ background: css.replace("background:", "").replace(";", "") }} />
      </div>
    ),
    dark: true,
  },

  /* 4. 玻璃拟态 */
  {
    id: "glass",
    name: "玻璃拟态",
    hint: "毛玻璃卡片，注意要放在有内容的背景上才看得出效果",
    controls: [
      { id: "blur", type: "range", label: "背景模糊", min: 0, max: 40, def: 14, unit: "px" },
      { id: "alpha", type: "range", label: "填充透明度", min: 0, max: 60, def: 14, unit: "%" },
      { id: "border", type: "range", label: "描边透明度", min: 0, max: 80, def: 28, unit: "%" },
      { id: "radius", type: "range", label: "圆角", min: 0, max: 40, def: 18, unit: "px" },
    ],
    build: (v) => `backdrop-filter: blur(${v.blur}px);
background: rgba(255, 255, 255, ${(Number(v.alpha) / 100).toFixed(2)});
border: 1px solid rgba(255, 255, 255, ${(Number(v.border) / 100).toFixed(2)});
border-radius: ${v.radius}px;`,
    preview: (v) => (
      <div className="relative flex h-40 items-center justify-center overflow-hidden rounded-xl" style={{ background: "linear-gradient(135deg,#6366f1,#ec4899)" }}>
        <div
          className="flex h-24 w-56 items-center justify-center text-[13px] font-medium text-white"
          style={{
            backdropFilter: `blur(${v.blur}px)`,
            background: `rgba(255,255,255,${Number(v.alpha) / 100})`,
            border: `1px solid rgba(255,255,255,${Number(v.border) / 100})`,
            borderRadius: `${v.radius}px`,
          }}
        >
          {__ui("毛玻璃卡片")}</div>
      </div>
    ),
    dark: true,
  },

  /* 5. 加载动画 */
  {
    id: "loader",
    name: "加载动画",
    hint: "转圈 / 三点跳动 / 条形脉冲，CSS 动画代码可直接粘贴",
    controls: [
      { id: "style", type: "select", label: "样式", def: "spin", options: [{ label: "转圈", value: "spin" }, { label: "三点跳动", value: "dots" }, { label: "条形脉冲", value: "bars" }] },
      { id: "size", type: "range", label: "尺寸", min: 16, max: 80, def: 40, unit: "px" },
      { id: "color", type: "color", label: "颜色", def: "#6366f1" },
      { id: "speed", type: "range", label: "一圈耗时", min: 0.4, max: 3, step: 0.1, def: 0.9, unit: "s" },
      { id: "thickness", type: "range", label: "线条粗细", min: 1, max: 10, def: 4, unit: "px" },
    ],
    build: (v) => {
      if (v.style === "dots") {
        return `.loader { display: flex; gap: 8px; }
.loader span {
  width: ${Math.round(Number(v.size) / 4)}px; height: ${Math.round(Number(v.size) / 4)}px;
  border-radius: 50%; background: ${v.color};
  animation: loader-bounce ${v.speed}s infinite ease-in-out;
}
.loader span:nth-child(2) { animation-delay: 0.15s; }
.loader span:nth-child(3) { animation-delay: 0.3s; }
@keyframes loader-bounce {
  0%, 80%, 100% { transform: scale(0.6); opacity: 0.5; }
  40% { transform: scale(1); opacity: 1; }
}`;
      }
      if (v.style === "bars") {
        return `.loader { display: flex; gap: 4px; align-items: flex-end; height: ${v.size}px; }
.loader span {
  width: ${Math.max(3, Number(v.thickness))}px; height: 100%;
  background: ${v.color}; border-radius: 2px;
  animation: loader-pulse ${v.speed}s infinite ease-in-out;
}
.loader span:nth-child(2) { animation-delay: 0.1s; }
.loader span:nth-child(3) { animation-delay: 0.2s; }
.loader span:nth-child(4) { animation-delay: 0.3s; }
@keyframes loader-pulse {
  0%, 100% { transform: scaleY(0.3); }
  50% { transform: scaleY(1); }
}`;
      }
      return `.loader {
  width: ${v.size}px; height: ${v.size}px;
  border: ${v.thickness}px solid rgba(0,0,0,0.12);
  border-top-color: ${v.color};
  border-radius: 50%;
  animation: loader-spin ${v.speed}s linear infinite;
}
@keyframes loader-spin { to { transform: rotate(360deg); } }`;
    },
    preview: (v) => (
      <div className="flex h-40 items-center justify-center gap-0">
        <style>{GENERATORS[4].build(v).replace(/\.loader/g, ".pv-loader")}</style>
        {v.style === "dots" ? (
          <div className="pv-loader flex gap-2">
            <span /><span /><span />
          </div>
        ) : v.style === "bars" ? (
          <div className="pv-loader flex items-end gap-1" style={{ height: `${v.size}px` }}>
            <span /><span /><span /><span />
          </div>
        ) : (
          <div className="pv-loader" />
        )}
      </div>
    ),
  },

  /* 6. 复选框开关 */
  {
    id: "toggle",
    name: "开关按钮",
    hint: "带动画的 ON/OFF 开关（用 checkbox 实现，无需 JS）",
    controls: [
      { id: "width", type: "range", label: "宽度", min: 32, max: 90, def: 48, unit: "px" },
      { id: "onColor", type: "color", label: "开启色", def: "#6366f1" },
      { id: "offColor", type: "color", label: "关闭色", def: "#d1d5db" },
      { id: "thumb", type: "color", label: "滑块色", def: "#ffffff" },
    ],
    build: (v) => {
      const h = Math.round(Number(v.width) * 0.56);
      const d = h - 6;
      return `.switch { position: relative; display: inline-block; width: ${v.width}px; height: ${h}px; }
.switch input { opacity: 0; width: 0; height: 0; }
.switch .slider {
  position: absolute; inset: 0; cursor: pointer;
  background: ${v.offColor}; border-radius: 999px; transition: background .25s;
}
.switch .slider::before {
  content: ""; position: absolute; left: 3px; top: 3px;
  width: ${d}px; height: ${d}px; border-radius: 50%;
  background: ${v.thumb}; transition: transform .25s;
}
.switch input:checked + .slider { background: ${v.onColor}; }
.switch input:checked + .slider::before { transform: translateX(${Number(v.width) - d - 6}px); }`;
    },
    preview: (v) => <TogglePreview width={Number(v.width)} onColor={str(v.onColor)} offColor={str(v.offColor)} thumb={str(v.thumb)} />,
  },

  /* 7. 渐变文字 */
  {
    id: "text-gradient",
    name: "渐变文字",
    hint: "文字填充渐变色，需要 -webkit-background-clip",
    controls: [
      { id: "c1", type: "color", label: "起始色", def: "#6366f1" },
      { id: "c2", type: "color", label: "结束色", def: "#ec4899" },
      { id: "angle", type: "range", label: "角度", min: 0, max: 360, def: 90, unit: "deg" },
      { id: "size", type: "range", label: "字号", min: 16, max: 72, def: 40, unit: "px" },
      { id: "weight", type: "select", label: "字重", def: "800", options: [{ label: "常规", value: "400" }, { label: "中粗", value: "600" }, { label: "很粗", value: "800" }, { label: "极粗", value: "900" }] },
    ],
    build: (v) => `.gradient-text {
  font-size: ${v.size}px;
  font-weight: ${v.weight};
  background: linear-gradient(${v.angle}deg, ${v.c1}, ${v.c2});
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}`,
    preview: (v) => (
      <div className="flex h-40 items-center justify-center">
        <span
          style={{
            fontSize: `${v.size}px`,
            fontWeight: Number(v.weight),
            background: `linear-gradient(${v.angle}deg, ${v.c1}, ${v.c2})`,
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            color: "transparent",
          }}
        >
          {__ui("渐变文字")}</span>
      </div>
    ),
  },

  /* 8. 文字描边 */
  {
    id: "text-stroke",
    name: "文字描边",
    hint: "镂空标题字，常用于海报与封面",
    controls: [
      { id: "width", type: "range", label: "描边粗细", min: 1, max: 8, def: 2, unit: "px" },
      { id: "color", type: "color", label: "描边色", def: "#6366f1" },
      { id: "fill", type: "color", label: "填充色", def: "#ffffff" },
      { id: "size", type: "range", label: "字号", min: 20, max: 90, def: 48, unit: "px" },
    ],
    build: (v) => `.stroke-text {
  font-size: ${v.size}px;
  font-weight: 800;
  color: ${v.fill};
  -webkit-text-stroke: ${v.width}px ${v.color};
}`,
    preview: (v) => (
      <div className="flex h-40 items-center justify-center">
        <span style={{ fontSize: `${v.size}px`, fontWeight: 800, color: str(v.fill), WebkitTextStroke: `${v.width}px ${v.color}` }}>{__ui("描边标题")}</span>
      </div>
    ),
  },

  /* 9. cubic-bezier 缓动 */
  {
    id: "bezier",
    name: "缓动曲线",
    hint: "用四个控制点调出想要的动画手感，右边小球可直接试",
    controls: [
      { id: "x1", type: "range", label: "P1 横", min: 0, max: 1, step: 0.01, def: 0.34 },
      { id: "y1", type: "range", label: "P1 纵", min: -1, max: 2, step: 0.01, def: 1.56 },
      { id: "x2", type: "range", label: "P2 横", min: 0, max: 1, step: 0.01, def: 0.64 },
      { id: "y2", type: "range", label: "P2 纵", min: -1, max: 2, step: 0.01, def: 1 },
      { id: "duration", type: "range", label: "时长", min: 0.2, max: 3, step: 0.1, def: 1, unit: "s" },
    ],
    build: (v) => `transition: transform ${v.duration}s cubic-bezier(${v.x1}, ${v.y1}, ${v.x2}, ${v.y2});`,
    preview: (v) => (
      <BezierPreview x1={Number(v.x1)} y1={Number(v.y1)} x2={Number(v.x2)} y2={Number(v.y2)} duration={Number(v.duration)} />
    ),
  },

  /* 10. 背景图案 */
  {
    id: "pattern",
    name: "背景图案",
    hint: "纯 CSS 画点阵、网格、斜纹、棋盘，不用图片",
    controls: [
      { id: "style", type: "select", label: "图案", def: "dots", options: [{ label: "点阵", value: "dots" }, { label: "网格", value: "grid" }, { label: "斜纹", value: "stripes" }, { label: "棋盘", value: "checker" }] },
      { id: "size", type: "range", label: "单元大小", min: 4, max: 40, def: 16, unit: "px" },
      { id: "color", type: "color", label: "图案色", def: "#6366f1" },
      { id: "bg", type: "color", label: "底色", def: "#ffffff" },
    ],
    build: (v) => {
      const s = Number(v.size);
      const base = `background-color: ${v.bg};`;
      if (v.style === "grid") {
        return `background-image:
  linear-gradient(${v.color} 1px, transparent 1px),
  linear-gradient(90deg, ${v.color} 1px, transparent 1px);
background-size: ${s}px ${s}px;
${base}`;
      }
      if (v.style === "stripes") {
        return `background-image: repeating-linear-gradient(45deg, ${v.color} 0 ${s / 4}px, transparent ${s / 4}px ${s / 2}px);
${base}`;
      }
      if (v.style === "checker") {
        return `background-image:
  linear-gradient(45deg, ${v.color} 25%, transparent 25%, transparent 75%, ${v.color} 75%),
  linear-gradient(45deg, ${v.color} 25%, transparent 25%, transparent 75%, ${v.color} 75%);
background-size: ${s}px ${s}px;
background-position: 0 0, ${s / 2}px ${s / 2}px;
${base}`;
      }
      return `background-image: radial-gradient(${v.color} ${Math.max(1, s / 8)}px, transparent ${Math.max(1, s / 8)}px);
background-size: ${s}px ${s}px;
${base}`;
    },
    preview: (v, css) => (
      <div className="h-40 rounded-xl border" style={{ borderColor: "rgba(127,127,127,0.3)", backgroundColor: str(v.bg), backgroundImage: css.split("background-image:")[1]?.split("background-size:")[0]?.trim().replace(/;$/, "") ?? "none", backgroundSize: `${v.size}px ${v.size}px` }} />
    ),
    dark: true,
  },

  /* 11. 滚动条美化 */
  {
    id: "scrollbar",
    name: "滚动条美化",
    hint: "Webkit 与 Firefox 两种写法都给出来",
    controls: [
      { id: "width", type: "range", label: "宽度", min: 4, max: 20, def: 8, unit: "px" },
      { id: "thumb", type: "color", label: "滑块色", def: "#c7c7cc" },
      { id: "track", type: "color", label: "轨道色", def: "transparent" },
      { id: "radius", type: "range", label: "圆角", min: 0, max: 10, def: 8, unit: "px" },
    ],
    build: (v) => `/* Webkit（Chrome / Edge / 新版 Safari） */
::-webkit-scrollbar { width: ${v.width}px; height: ${v.width}px; }
::-webkit-scrollbar-track { background: ${v.track}; }
::-webkit-scrollbar-thumb { background: ${v.thumb}; border-radius: ${v.radius}px; }
::-webkit-scrollbar-thumb:hover { background: color-mix(in srgb, ${v.thumb} 80%, #000); }

/* Firefox */
* { scrollbar-width: thin; scrollbar-color: ${v.thumb} ${v.track}; }`,
    preview: (v) => (
      <div className="flex h-40 items-center justify-center">
        <div
          className="h-32 w-64 overflow-y-scroll rounded-xl border p-3 text-[12px] leading-relaxed"
          style={{ borderColor: "rgba(127,127,127,0.3)", scrollbarWidth: "thin", scrollbarColor: `${v.thumb} ${v.track}` }}
        >
          {Array.from({ length: 20 }).map((_, i) => (
            <p key={i}>{__ui("第")}{i + 1} {__ui("行 —— 滚动看看右侧滚动条")}</p>
          ))}
        </div>
      </div>
    ),
    dark: true,
  },

  /* 12. Flex 布局速配 */
  {
    id: "flex",
    name: "Flex 布局",
    hint: "选完就能拿到对应的 CSS，不用记属性名",
    controls: [
      { id: "dir", type: "select", label: "主轴方向", def: "row", options: [{ label: "横向", value: "row" }, { label: "纵向", value: "column" }, { label: "横向反转", value: "row-reverse" }, { label: "纵向反转", value: "column-reverse" }] },
      { id: "justify", type: "select", label: "主轴对齐", def: "center", options: [{ label: "起点", value: "flex-start" }, { label: "居中", value: "center" }, { label: "终点", value: "flex-end" }, { label: "两端", value: "space-between" }, { label: "环绕", value: "space-around" }, { label: "均匀", value: "space-evenly" }] },
      { id: "align", type: "select", label: "交叉轴对齐", def: "center", options: [{ label: "起点", value: "flex-start" }, { label: "居中", value: "center" }, { label: "终点", value: "flex-end" }, { label: "拉伸", value: "stretch" }] },
      { id: "wrap", type: "select", label: "换行", def: "nowrap", options: [{ label: "不换行", value: "nowrap" }, { label: "换行", value: "wrap" }] },
      { id: "gap", type: "range", label: "间距", min: 0, max: 40, def: 12, unit: "px" },
    ],
    build: (v) => `.container {
  display: flex;
  flex-direction: ${v.dir};
  justify-content: ${v.justify};
  align-items: ${v.align};
  flex-wrap: ${v.wrap};
  gap: ${v.gap}px;
}`,
    preview: (v) => (
      <div className="h-40 rounded-xl border p-3" style={{ borderColor: "rgba(127,127,127,0.3)" }}>
        <div
          className="h-full w-full"
          style={{ display: "flex", flexDirection: str(v.dir) as "row", justifyContent: str(v.justify), alignItems: str(v.align), flexWrap: str(v.wrap) as "wrap", gap: `${v.gap}px` }}
        >
          {[1, 2, 3].map((n) => (
            <div key={n} className="flex h-10 w-16 items-center justify-center rounded-lg text-[12px] text-white" style={{ background: "hsl(var(--primary))" }}>
              {n}
            </div>
          ))}
        </div>
      </div>
    ),
    dark: true,
  },

  /* 13. Grid 布局 */
  {
    id: "grid",
    name: "Grid 布局",
    hint: "自动填充的卡片网格，一改列宽就自适应",
    controls: [
      { id: "minWidth", type: "range", label: "卡片最小宽", min: 60, max: 260, def: 120, unit: "px" },
      { id: "gap", type: "range", label: "间距", min: 0, max: 40, def: 12, unit: "px" },
      { id: "mode", type: "select", label: "模式", def: "auto-fill", options: [{ label: "自动填充（列数随宽度变）", value: "auto-fill" }, { label: "自动适应（尽量放大）", value: "auto-fit" }] },
    ],
    build: (v) => `.grid {
  display: grid;
  grid-template-columns: repeat(${v.mode}, minmax(${v.minWidth}px, 1fr));
  gap: ${v.gap}px;
}`,
    preview: (v) => (
      <div className="h-40 rounded-xl border p-3" style={{ borderColor: "rgba(127,127,127,0.3)" }}>
        <div className="grid h-full" style={{ gridTemplateColumns: `repeat(${v.mode}, minmax(${v.minWidth}px, 1fr))`, gap: `${v.gap}px` }}>
          {[1, 2, 3, 4, 5, 6].map((n) => (
            <div key={n} className="flex min-h-8 items-center justify-center rounded-lg text-[12px] text-white" style={{ background: "hsl(var(--primary))" }}>
              {n}
            </div>
          ))}
        </div>
      </div>
    ),
    dark: true,
  },

  /* 14. 按钮样式 */
  {
    id: "button",
    name: "按钮样式",
    hint: "带悬停与按下态，直接可用",
    controls: [
      { id: "bg", type: "color", label: "背景色", def: "#6366f1" },
      { id: "fg", type: "color", label: "文字色", def: "#ffffff" },
      { id: "radius", type: "range", label: "圆角", min: 0, max: 999, def: 10, unit: "px" },
      { id: "padX", type: "range", label: "左右内边距", min: 8, max: 60, def: 22, unit: "px" },
      { id: "padY", type: "range", label: "上下内边距", min: 4, max: 28, def: 10, unit: "px" },
      { id: "shadow", type: "toggle", label: "带投影", def: true },
    ],
    build: (v) => `.btn {
  display: inline-flex; align-items: center; justify-content: center;
  padding: ${v.padY}px ${v.padX}px;
  border: none; border-radius: ${v.radius}px;
  background: ${v.bg}; color: ${v.fg};
  font-size: 14px; font-weight: 600; cursor: pointer;
  transition: transform .15s, filter .15s${v.shadow ? ", box-shadow .15s" : ""};${v.shadow ? `\n  box-shadow: 0 6px 16px -8px ${v.bg};` : ""}
}
.btn:hover { filter: brightness(1.08);${v.shadow ? `\n  box-shadow: 0 10px 24px -10px ${v.bg};` : ""} }
.btn:active { transform: translateY(1px) scale(0.99); }`,
    preview: (v) => (
      <div className="flex h-40 items-center justify-center">
        <button
          className="font-semibold transition-all hover:brightness-110 active:translate-y-px"
          style={{
            padding: `${v.padY}px ${v.padX}px`,
            borderRadius: `${v.radius}px`,
            background: str(v.bg),
            color: str(v.fg),
            boxShadow: v.shadow ? `0 6px 16px -8px ${v.bg}` : "none",
          }}
        >
          {__ui("按钮文字")}</button>
      </div>
    ),
    dark: true,
  },
];

/* ══════════════════════ 带交互的预览组件（需要自己持有状态） ══════════════════════ */

/** 开关预览：点一下能真的切换，直接感受动画 */
function TogglePreview({ width, onColor, offColor, thumb }: { width: number; onColor: string; offColor: string; thumb: string }) {
  const __locale = __useLanguage();
  const [on, setOn] = useState(true);
  const h = Math.round(width * 0.56);
  const d = h - 6;
  return (
    <div className="flex h-40 items-center justify-center">
      <button
        onClick={() => setOn(!on)}
        className="relative rounded-full transition-colors"
        style={{ width: `${width}px`, height: `${h}px`, background: on ? onColor : offColor }}
      >
        <span
          className="absolute top-[3px] rounded-full transition-all"
          style={{ left: on ? width - d - 3 : 3, width: `${d}px`, height: `${d}px`, background: thumb }}
        />
      </button>
    </div>
  );
}

/** 缓动曲线预览：点按钮让小球按当前曲线跑一趟 */
function BezierPreview({ x1, y1, x2, y2, duration }: { x1: number; y1: number; x2: number; y2: number; duration: number }) {
  const __locale = __useLanguage();
  const [right, setRight] = useState(false);
  return (
    <div className="flex h-40 flex-col items-center justify-center gap-3">
      <div className="relative h-12 w-full max-w-sm">
        <div
          className="absolute top-1/2 h-9 w-9 -translate-y-1/2 rounded-full"
          style={{
            left: right ? "calc(100% - 36px)" : 0,
            background: "hsl(var(--primary))",
            transition: `left ${duration}s cubic-bezier(${x1}, ${y1}, ${x2}, ${y2})`,
          }}
        />
      </div>
      <Button size="sm" variant="outline" onClick={() => setRight(!right)}>
        {__ui("点我试一下")}</Button>
    </div>
  );
}

/* ══════════════════════ 工具箱外壳 ══════════════════════ */

export function CssStudioTool() {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  const { toast } = useToast();
  const [activeId, setActiveId] = useState(GENERATORS[0].id);
  const active = GENERATORS.find((g) => g.id === activeId)!;
  const [values, setValues] = useState<Record<string, Record<string, number | string | boolean>>>(
    () => Object.fromEntries(GENERATORS.map((g) => [g.id, Object.fromEntries(g.controls.map((c) => [c.id, c.def]))])),
  );

  const v = values[activeId];
  const css = useMemo(() => active.build(v), [active, v, __locale]);

  const set = (id: string, value: number | string | boolean) =>
    setValues((prev) => ({ ...prev, [activeId]: { ...prev[activeId], [id]: value } }));

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(css);
      toast({ title: "CSS 已复制", variant: "success" });
    } catch {
      toast({ title: "复制失败", variant: "error" });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* 生成器切换 */}
      <section className="rounded-2xl border p-4" style={{ borderColor: colors.borderSolid, background: colors.card }}>
        <div className="flex flex-wrap gap-2">
          {GENERATORS.map((g) => {
            const activeOne = g.id === activeId;
            return (
              <button
                key={g.id}
                onClick={() => setActiveId(g.id)}
                className="rounded-xl border px-3 py-1.5 text-[12.5px] font-medium transition-all"
                style={{
                  borderColor: activeOne ? "hsl(var(--primary))" : colors.borderSolid,
                  background: activeOne ? colors.active : "transparent",
                  color: colors.text,
                }}
              >
                {__msg(g.name)}
              </button>
            );
          })}
        </div>
        <p className="mt-2.5 flex items-center gap-1.5 text-[11.5px]" style={{ color: colors.muted }}>
          <Wand2 size={12} /> {__ui(active.hint)}
        </p>
      </section>

      <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
        {/* 左：控件 */}
        <section className="flex min-w-0 flex-col gap-3.5 rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
          <h2 className="flex items-center gap-2 text-[13.5px] font-semibold" style={{ color: colors.text }}>
            <Layout size={15} /> {__msg(active.name)} {__ui("· 参数")}</h2>
          {active.controls.map((c) => {
            if (c.type === "range") {
              return (
                <label key={c.id} className="flex flex-col gap-1">
                  <span className="flex items-center justify-between text-[12px]" style={{ color: colors.muted }}>
                    <span>{__ui(c.label)}</span>
                    <span className="font-mono" style={{ color: colors.text }}>{v[c.id]}{c.unit ?? ""}</span>
                  </span>
                  <input
                    type="range"
                    min={c.min}
                    max={c.max}
                    step={c.step ?? 1}
                    value={Number(v[c.id])}
                    onChange={(e) => set(c.id, Number(e.target.value))}
                  />
                </label>
              );
            }
            if (c.type === "color") {
              return (
                <label key={c.id} className="flex items-center justify-between gap-3">
                  <span className="text-[12px]" style={{ color: colors.muted }}>{__ui(c.label)}</span>
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-[11.5px]" style={{ color: colors.text }}>{String(v[c.id])}</span>
                    <input type="color" value={String(v[c.id])} onChange={(e) => set(c.id, e.target.value)} className="h-8 w-12 cursor-pointer rounded-lg border-0 bg-transparent" />
                  </span>
                </label>
              );
            }
            if (c.type === "select") {
              return (
                <label key={c.id} className="flex flex-col gap-1.5">
                  <span className="text-[12px]" style={{ color: colors.muted }}>{__ui(c.label)}</span>
                  {/* className/style 是作用在 Select 外层容器上的，边框与底色留给组件自己的
                      触发器即可 —— 外面再加一圈会变成"框中框" */}
                  <Select
                    value={String(v[c.id])}
                    onChange={(e) => set(c.id, e.target.value)}
                    className="w-full"
                  >
                    {c.options.map((o) => (
                      <option key={o.value} value={o.value}>{__ui(o.label)}</option>
                    ))}
                  </Select>
                </label>
              );
            }
            if (c.type === "toggle") {
              const on = Boolean(v[c.id]);
              return (
                <label key={c.id} className="flex cursor-pointer items-center justify-between">
                  <span className="text-[12px]" style={{ color: colors.muted }}>{__ui(c.label)}</span>
                  <button
                    type="button"
                    onClick={() => set(c.id, !on)}
                    className="relative h-5 w-9 rounded-full transition-colors"
                    style={{ background: on ? "hsl(var(--primary))" : colors.btnHover }}
                  >
                    <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all" style={{ left: on ? 18 : 2 }} />
                  </button>
                </label>
              );
            }
            return (
              <label key={c.id} className="flex flex-col gap-1.5">
                <span className="text-[12px]" style={{ color: colors.muted }}>{__ui(c.label)}</span>
                <Input value={String(v[c.id])} onChange={(e) => set(c.id, e.target.value)} placeholder={__ui(c.placeholder)} />
              </label>
            );
          })}
        </section>

        {/* 右：预览 + 代码 */}
        <div className="flex min-w-0 flex-col gap-4">
          <section className="rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
            <h2 className="mb-3 text-[13.5px] font-semibold" style={{ color: colors.text }}>{__ui("实时预览")}</h2>
            <div className={cn("overflow-hidden rounded-xl", active.dark && "bg-[#f7f7f8]")}>{active.preview(v, css)}</div>
          </section>

          <section className="rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
            <header className="mb-3 flex items-center justify-between gap-2">
              <h2 className="text-[13.5px] font-semibold" style={{ color: colors.text }}>{__ui("生成的 CSS")}</h2>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="gap-1.5"
                  onClick={() => {
                    const blob = new Blob([css], { type: "text/css;charset=utf-8" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `${active.id}.css`;
                    a.click();
                    setTimeout(() => URL.revokeObjectURL(url), 4000);
                  }}
                >
                  <Check size={13} /> {__ui("下载 .css")}</Button>
                <Button size="sm" className="gap-1.5" onClick={() => void copy()}>
                  <Copy size={13} /> {__ui("复制 CSS")}</Button>
              </div>
            </header>
            <pre
              className="max-h-72 overflow-auto rounded-xl border p-3.5 font-mono text-[12px] leading-relaxed"
              style={{ borderColor: colors.borderSolid, background: colors.bg, color: colors.text }}
            >
              {css}
            </pre>
          </section>
        </div>
      </div>
    </div>
  );
}
