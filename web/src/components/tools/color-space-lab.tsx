"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/color-space-lab.tsx");


/**
 * 色彩空间对照 —— 联动滑杆版
 *
 * 与普通「换算器」的区别：每个色彩空间是一张卡片，卡片里每个分量都有一根滑杆，
 * 滑杆轨道按该分量取值的真实颜色画成渐变；拖动任意一根滑杆，所有空间的数值与
 * 颜色实时联动，可以直观看到「改了 L 之后其它空间怎么变」。
 *
 * 所有换算都是自己实现的（含正向与逆向），没有引入任何依赖：
 *   RGB ↔ HSL/HSV/HWB/CMYK/XYZ/CIELAB/LCh/OKLab/OKLCh
 */

import { useCallback, useMemo, useState } from "react";
import { Check, Copy, Eye, Lock, LockOpen, Palette, RotateCcw } from "lucide-react";
import { Button, Input } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

/* ══════════════════════ 颜色换算（正反向都自己实现） ══════════════════════ */

const clamp = (v: number, min = 0, max = 1) => Math.min(max, Math.max(min, v));
const clamp255 = (v: number) => Math.min(255, Math.max(0, v));

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "").trim();
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h.padEnd(6, "0").slice(0, 6);
  const r = parseInt(full.slice(0, 2), 16);
  const g = parseInt(full.slice(2, 4), 16);
  const b = parseInt(full.slice(4, 6), 16);
  return [r, g, b].map((v) => (Number.isNaN(v) ? 0 : v)) as [number, number, number];
}

const rgbToHex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((v) => Math.round(clamp255(v)).toString(16).padStart(2, "0")).join("");

const toLinear = (c: number) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
const toSrgb = (c: number) => clamp255((c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055) * 255);

function rgbToXyz(r: number, g: number, b: number): [number, number, number] {
  const R = toLinear(r), G = toLinear(g), B = toLinear(b);
  return [
    R * 0.4124564 + G * 0.3575761 + B * 0.1804375,
    R * 0.2126729 + G * 0.7151522 + B * 0.0721750,
    R * 0.0193339 + G * 0.1191920 + B * 0.9503041,
  ];
}
function xyzToRgb(x: number, y: number, z: number): [number, number, number] {
  return [
    toSrgb(x * 3.2404542 + y * -1.5371385 + z * -0.4985314),
    toSrgb(x * -0.9692660 + y * 1.8760108 + z * 0.0415560),
    toSrgb(x * 0.0556434 + y * -0.2040259 + z * 1.0572252),
  ];
}

const D65: [number, number, number] = [0.95047, 1.0, 1.08883];
const fLab = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (841 / 108) * t + 4 / 29);
const fLabInv = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (108 / 841) * (t - 4 / 29));

function xyzToLab(x: number, y: number, z: number): [number, number, number] {
  const fx = fLab(x / D65[0]), fy = fLab(y / D65[1]), fz = fLab(z / D65[2]);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}
function labToXyz(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  return [fLabInv(fx) * D65[0], fLabInv(fy) * D65[1], fLabInv(fz) * D65[2]];
}

function xyzToOklab(x: number, y: number, z: number): [number, number, number] {
  const l = 0.8189330101 * x + 0.3618667424 * y - 0.1288597137 * z;
  const m = 0.0329845436 * x + 0.9293118715 * y + 0.0361456387 * z;
  const s = 0.0482003018 * x + 0.2643662691 * y + 0.6338517070 * z;
  const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
  return [
    0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
    1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
    0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
  ];
}
function oklabToXyz(L: number, a: number, b: number): [number, number, number] {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [
    +1.2270138511 * l - 0.5577999807 * m + 0.2812561490 * s,
    -0.0405801784 * l + 1.1122568696 * m - 0.0716766787 * s,
    -0.0763812845 * l - 0.4214819784 * m + 1.5861632204 * s,
  ];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === R) h = ((G - B) / d + (G < B ? 6 : 0)) / 6;
  else if (max === G) h = ((B - R) / d + 2) / 6;
  else h = ((R - G) / d + 4) / 6;
  return [h * 360, s * 100, l * 100];
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360 / 360;
  s = clamp(s / 100);
  l = clamp(l / 100);
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue2rgb = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [hue2rgb(h + 1 / 3) * 255, hue2rgb(h) * 255, hue2rgb(h - 1 / 3) * 255];
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  const h = d === 0 ? 0 : max === R ? ((((G - B) / d) % 6) + 6) % 6 * 60 : max === G ? ((B - R) / d + 2) * 60 : ((R - G) / d + 4) * 60;
  return [h, max === 0 ? 0 : (d / max) * 100, max * 100];
}
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  s = clamp(s / 100);
  v = clamp(v / 100);
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const seg = Math.floor(h / 60) % 6;
  const table: [number, number, number][] = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ];
  const [r, g, b] = table[seg];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function rgbToHwb(r: number, g: number, b: number): [number, number, number] {
  const [h] = rgbToHsv(r, g, b);
  return [h, (Math.min(r, g, b) / 255) * 100, (1 - Math.max(r, g, b) / 255) * 100];
}
function hwbToRgb(h: number, w: number, bl: number): [number, number, number] {
  w = clamp(w / 100);
  bl = clamp(bl / 100);
  if (w + bl >= 1) {
    const g = (w / (w + bl)) * 255;
    return [g, g, g];
  }
  const [r, gg, b] = hsvToRgb(h, 100, 100);
  const f = (c: number) => (c / 255) * (1 - w - bl) * 255 + w * 255;
  return [f(r), f(gg), f(b)];
}

function rgbToCmyk(r: number, g: number, b: number): [number, number, number, number] {
  const R = r / 255, G = g / 255, B = b / 255;
  const k = 1 - Math.max(R, G, B);
  if (k === 1) return [0, 0, 0, 100];
  return [((1 - R - k) / (1 - k)) * 100, ((1 - G - k) / (1 - k)) * 100, ((1 - B - k) / (1 - k)) * 100, k * 100];
}
function cmykToRgb(c: number, m: number, y: number, k: number): [number, number, number] {
  c = clamp(c / 100); m = clamp(m / 100); y = clamp(y / 100); k = clamp(k / 100);
  return [(1 - Math.min(1, c * (1 - k) + k)) * 255, (1 - Math.min(1, m * (1 - k) + k)) * 255, (1 - Math.min(1, y * (1 - k) + k)) * 255];
}

const labToRgb = (L: number, a: number, b: number) => xyzToRgb(...labToXyz(L, a, b));
const oklabToRgb = (L: number, a: number, b: number) => xyzToRgb(...oklabToXyz(L, a, b));
const lchToRgb = (L: number, C: number, h: number) => labToRgb(L, C * Math.cos((h * Math.PI) / 180), C * Math.sin((h * Math.PI) / 180));
const oklchToRgb = (L: number, C: number, h: number) => oklabToRgb(L, C * Math.cos((h * Math.PI) / 180), C * Math.sin((h * Math.PI) / 180));
const xyzToRgbTuple = (x: number, y: number, z: number) => xyzToRgb(x, y, z);

/** 相对亮度 / 对比度 / ΔE2000 */
const relativeLuminance = (r: number, g: number, b: number) =>
  0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);

function contrastRatio(a: [number, number, number], b: [number, number, number]) {
  const la = relativeLuminance(...a), lb = relativeLuminance(...b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

function deltaE2000(lab1: [number, number, number], lab2: [number, number, number]) {
  const [L1, a1, b1] = lab1;
  const [L2, a2, b2] = lab2;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cbar = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cbar ** 7 / (Cbar ** 7 + 25 ** 7)));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h1p = ((Math.atan2(b1, a1p) * 180) / Math.PI + 360) % 360;
  const h2p = ((Math.atan2(b2, a2p) * 180) / Math.PI + 360) % 360;
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = h2p - h1p;
  if (dhp > 180) dhp -= 360;
  else if (dhp < -180) dhp += 360;
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp * Math.PI) / 360);
  const Lbarp = (L1 + L2) / 2, Cbarp = (C1p + C2p) / 2;
  let hbarp = (h1p + h2p) / 2;
  if (C1p * C2p !== 0 && Math.abs(h1p - h2p) > 180) hbarp = (h1p + h2p + 360) / 2;
  const T =
    1 - 0.17 * Math.cos(((hbarp - 30) * Math.PI) / 180) +
    0.24 * Math.cos((2 * hbarp * Math.PI) / 180) +
    0.32 * Math.cos(((3 * hbarp + 6) * Math.PI) / 180) -
    0.2 * Math.cos(((4 * hbarp - 63) * Math.PI) / 180);
  const SL = 1 + (0.015 * (Lbarp - 50) ** 2) / Math.sqrt(20 + (Lbarp - 50) ** 2);
  const SC = 1 + 0.045 * Cbarp;
  const SH = 1 + 0.015 * Cbarp * T;
  const RT = -2 * Math.sqrt(Cbarp ** 7 / (Cbarp ** 7 + 25 ** 7)) * Math.sin((60 * Math.exp(-(((hbarp - 275) / 25) ** 2)) * Math.PI) / 180);
  return Math.sqrt((dLp / SL) ** 2 + (dCp / SC) ** 2 + (dHp / SH) ** 2 + RT * (dCp / SC) * (dHp / SH));
}

/** 色域判断（CIE xy 上的近似多边形） */
function gamutCheck(x: number, y: number, z: number) {
  const sum = x + y + z || 1;
  const cx = x / sum, cy = y / sum;
  const gamuts: { name: string; poly: [number, number][] }[] = [
    { name: "sRGB", poly: [[0.64, 0.33], [0.3, 0.6], [0.15, 0.06], [0.3127, 0.329]] },
    { name: "Display P3", poly: [[0.68, 0.32], [0.265, 0.69], [0.15, 0.06], [0.3127, 0.329]] },
    { name: "Adobe RGB", poly: [[0.64, 0.33], [0.21, 0.71], [0.15, 0.06], [0.3127, 0.329]] },
    { name: "Rec.2020", poly: [[0.708, 0.292], [0.17, 0.797], [0.131, 0.046], [0.3127, 0.329]] },
  ];
  const inPoly = (px: number, py: number, poly: [number, number][]) => {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  };
  return { xy: [cx, cy] as [number, number], inside: gamuts.filter((g) => inPoly(cx, cy, g.poly)).map((g) => g.name) };
}

/* ══════════════════════ 分量滑杆 ══════════════════════ */

interface Comp {
  key: string;
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** 由分量值算出颜色（用于画轨道渐变与联动） */
  apply: (v: number) => [number, number, number];
}

function CompSlider({
  comp,
  colors,
  onChange,
}: {
  comp: Comp;
  colors: Record<string, string>;
  onChange: (v: number) => void;
}) {
  const __locale = __useLanguage();
  // 轨道渐变：沿该分量取样 16 个颜色
  const gradient = useMemo(() => {
    const stops: string[] = [];
    for (let i = 0; i <= 16; i++) {
      const v = comp.min + ((comp.max - comp.min) * i) / 16;
      const [r, g, b] = comp.apply(v);
      stops.push(`${rgbToHex(r, g, b)} ${(i / 16) * 100}%`);
    }
    return `linear-gradient(90deg, ${stops.join(", ")})`;
  }, [comp, __locale]);

  const pct = ((comp.value - comp.min) / (comp.max - comp.min)) * 100;

  return (
    <div className="flex items-center gap-2.5">
      <span className="w-5 shrink-0 text-center font-mono text-[12px] font-semibold" style={{ color: colors.text }}>
        {__ui(comp.label)}
      </span>
      <div className="relative h-6 flex-1">
        <div className="absolute inset-x-0 top-1/2 h-3 -translate-y-1/2 rounded-full border" style={{ background: gradient, borderColor: colors.borderSolid }} />
        <div
          className="pointer-events-none absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-sm"
          style={{ left: `${pct}%`, background: "#ffffff", borderColor: "rgba(0,0,0,0.35)" }}
        />
        <input
          type="range"
          min={comp.min}
          max={comp.max}
          step={comp.step}
          value={comp.value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
        />
      </div>
      <input
        type="number"
        value={Number(comp.value.toFixed(comp.step < 1 ? 3 : 0))}
        min={comp.min}
        max={comp.max}
        step={comp.step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-20 shrink-0 rounded-lg border px-2 py-1 text-right font-mono text-[12px] focus:outline-none"
        style={{ borderColor: colors.borderSolid, background: colors.bg, color: colors.text }}
      />
    </div>
  );
}

function SpaceCard({
  name,
  note,
  comps,
  colors,
  onSet,
  onCopy,
  text,
}: {
  name: string;
  note?: string;
  comps: Comp[];
  colors: Record<string, string>;
  onSet: (key: string, v: number) => void;
  onCopy: () => void;
  text: string;
}) {
  const __locale = __useLanguage();
  return (
    <section className="rounded-2xl border p-4" style={{ borderColor: colors.borderSolid, background: colors.card }}>
      <header className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-bold tracking-wide" style={{ color: colors.text }}>{__msg(name)}</h3>
          {note && <span className="text-[10.5px]" style={{ color: colors.muted }}>{__ui(note)}</span>}
        </div>
        <button onClick={onCopy} title={__msg("复制 {0}", text)} style={{ color: colors.muted }}>
          <Copy size={12} />
        </button>
      </header>
      <div className="flex flex-col gap-2">
        {comps.map((c) => (
          <CompSlider key={c.key} comp={c} colors={colors} onChange={(v) => onSet(c.key, v)} />
        ))}
      </div>
    </section>
  );
}

/* ══════════════════════ 主组件 ══════════════════════ */

export function ColorSpaceLabTool() {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  const { toast } = useToast();
  const [hex, setHex] = useState("#3b82f6");
  const [glued, setGlued] = useState(false);
  const [compareHex, setCompareHex] = useState("#8b5cf6");

  const rgb = useMemo(() => hexToRgb(hex), [hex, __locale]);
  const [r, g, b] = rgb;

  const setRgb = useCallback((nr: number, ng: number, nb: number) => {
    setHex(rgbToHex(nr, ng, nb).toUpperCase());
  }, []);

  const derived = useMemo(() => {
    const [h, s, l] = rgbToHsl(r, g, b);
    const [hv, sv, v] = rgbToHsv(r, g, b);
    const [hw, w, bl] = rgbToHwb(r, g, b);
    const [c, m, y, k] = rgbToCmyk(r, g, b);
    const [x, yy, z] = rgbToXyz(r, g, b);
    const [L, A, B] = xyzToLab(x, yy, z);
    const [ol, oa, ob] = xyzToOklab(x, yy, z);
    const C = Math.hypot(A, B);
    const H = ((Math.atan2(B, A) * 180) / Math.PI + 360) % 360;
    const oC = Math.hypot(oa, ob);
    const oH = ((Math.atan2(ob, oa) * 180) / Math.PI + 360) % 360;
    return { h, s, l, hv, sv, v, hw, w, bl, c, m, y, k, x, yy, z, L, A, B, C, H, ol, oa, ob, oC, oH };
  }, [r, g, b, __locale]);

  const d = derived;

  const applyRgb = (t: [number, number, number]) => setRgb(clamp255(t[0]), clamp255(t[1]), clamp255(t[2]));

  /** 拖动某个分量：重算整条颜色，其余空间自然联动 */
  const setComponent = useCallback(
    (space: string, key: string, val: number) => {
      switch (space) {
        case "rgb": {
          const next: [number, number, number] = [r, g, b];
          if (key === "r") next[0] = val;
          if (key === "g") next[1] = val;
          if (key === "b") next[2] = val;
          applyRgb(next);
          break;
        }
        case "hsl": {
          const v = { h: d.h, s: d.s, l: d.l, [key]: val } as Record<string, number>;
          applyRgb(hslToRgb(v.h, v.s, v.l));
          break;
        }
        case "hsv": {
          const v = { h: d.hv, s: d.sv, v: d.v, [key]: val } as Record<string, number>;
          applyRgb(hsvToRgb(v.h, v.s, v.v));
          break;
        }
        case "hwb": {
          const v = { h: d.hw, w: d.w, b: d.bl, [key]: val } as Record<string, number>;
          applyRgb(hwbToRgb(v.h, v.w, v.b));
          break;
        }
        case "cmyk": {
          const v = { c: d.c, m: d.m, y: d.y, k: d.k, [key]: val } as Record<string, number>;
          applyRgb(cmykToRgb(v.c, v.m, v.y, v.k));
          break;
        }
        case "lab": {
          const v = { L: d.L, a: d.A, b: d.B, [key]: val } as Record<string, number>;
          applyRgb(labToRgb(v.L, v.a, v.b));
          break;
        }
        case "lch": {
          const v = { L: d.L, C: d.C, h: d.H, [key]: val } as Record<string, number>;
          applyRgb(lchToRgb(v.L, v.C, v.h));
          break;
        }
        case "oklab": {
          const v = { L: d.ol, a: d.oa, b: d.ob, [key]: val } as Record<string, number>;
          applyRgb(oklabToRgb(v.L, v.a, v.b));
          break;
        }
        case "oklch": {
          const v = { L: d.ol, C: d.oC, h: d.oH, [key]: val } as Record<string, number>;
          applyRgb(oklchToRgb(v.L, v.C, v.h));
          break;
        }
        case "xyz": {
          const v = { x: d.x, y: d.yy, z: d.z, [key]: val } as Record<string, number>;
          applyRgb(xyzToRgbTuple(v.x, v.y, v.z));
          break;
        }
        default:
          break;
      }
    },
    [r, g, b, d, setRgb],
  );

  const gamut = useMemo(() => gamutCheck(d.x, d.yy, d.z), [d, __locale]);

  const compareRgb = useMemo(() => hexToRgb(compareHex), [compareHex, __locale]);
  const de = useMemo(() => deltaE2000(xyzToLab(d.x, d.yy, d.z), xyzToLab(...rgbToXyz(...compareRgb))), [d, compareRgb, __locale]);

  const [textColor, setTextColor] = useState("#ffffff");
  const cr = contrastRatio(rgb, hexToRgb(textColor));

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `已复制 ${label}`, variant: "success" });
    } catch {
      toast({ title: "复制失败", variant: "error" });
    }
  };

  // 每个空间的文本表示（供复制）
  const textOf = {
    "sRGB HEX": rgbToHex(r, g, b).toUpperCase(),
    RGB: `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`,
    HSL: `hsl(${d.h.toFixed(1)}, ${d.s.toFixed(1)}%, ${d.l.toFixed(1)}%)`,
    HSV: `hsv(${d.hv.toFixed(1)}, ${d.sv.toFixed(1)}%, ${d.v.toFixed(1)}%)`,
    HWB: `hwb(${d.hw.toFixed(1)} ${d.w.toFixed(1)}% ${d.bl.toFixed(1)}%)`,
    CMYK: `cmyk(${d.c.toFixed(1)}%, ${d.m.toFixed(1)}%, ${d.y.toFixed(1)}%, ${d.k.toFixed(1)}%)`,
    "CIE LAB": `lab(${d.L.toFixed(2)}, ${d.A.toFixed(2)}, ${d.B.toFixed(2)})`,
    "CIE LCh": `lch(${d.L.toFixed(2)}, ${d.C.toFixed(2)}, ${d.H.toFixed(1)})`,
    OKLab: `oklab(${d.ol.toFixed(4)}, ${d.oa.toFixed(4)}, ${d.ob.toFixed(4)})`,
    OKLCh: `oklch(${d.ol.toFixed(4)}, ${d.oC.toFixed(4)}, ${d.oH.toFixed(1)})`,
    XYZ: `xyz(${d.x.toFixed(4)}, ${d.yy.toFixed(4)}, ${d.z.toFixed(4)})`,
  } as const;

  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        {/* 左侧：实时预览与色域 */}
        <div className="flex flex-col gap-4">
          <section className="rounded-2xl border p-4" style={{ borderColor: colors.borderSolid, background: colors.card }}>
            <h3 className="mb-3 text-[12px] font-semibold tracking-wide" style={{ color: colors.muted }}>{__ui("实时颜色预览")}</h3>
            <div className="h-24 w-full rounded-xl border" style={{ background: rgbToHex(r, g, b), borderColor: colors.borderSolid }} />
            <div className="mt-2.5 flex items-center justify-between">
              <span className="font-mono text-[13px] font-semibold" style={{ color: colors.text }}>{rgbToHex(r, g, b).toUpperCase()}</span>
              <label className="flex items-center gap-1.5 text-[11.5px]" style={{ color: colors.muted }}>
                <input type="color" value={rgbToHex(r, g, b)} onChange={(e) => setHex(e.target.value.toUpperCase())} className="h-6 w-8 cursor-pointer rounded border-0 bg-transparent" />
                {__ui("取色")}</label>
            </div>
            <label className="mt-3 flex flex-col gap-1.5">
              <span className="text-[11.5px]" style={{ color: colors.muted }}>{__ui("十六进制")}</span>
              <Input value={hex} onChange={(e) => setHex(e.target.value)} className="font-mono text-[12.5px]" />
            </label>
          </section>

          <section className="rounded-2xl border p-4" style={{ borderColor: colors.borderSolid, background: colors.card }}>
            <div className="mb-2.5 flex items-center gap-2">
              <Eye size={14} />
              <h3 className="text-[12px] font-semibold tracking-wide" style={{ color: colors.muted }}>{__ui("色域覆盖")}</h3>
            </div>
            <div className="flex flex-col gap-1.5">
              {["sRGB", "Display P3", "Adobe RGB", "Rec.2020"].map((name) => {
                const inside = gamut.inside.includes(name);
                return (
                  <span key={name} className="flex items-center gap-2 text-[12.5px]" style={{ color: inside ? colors.green : colors.muted }}>
                    {inside ? <Check size={12} /> : <span className="inline-block h-3 w-3 rounded-full border" style={{ borderColor: colors.borderSolid }} />}
                    {__msg(name)}
                  </span>
                );
              })}
            </div>
            <p className="mt-2.5 font-mono text-[11px]" style={{ color: colors.muted }}>
              xy = {gamut.xy[0].toFixed(4)}, {gamut.xy[1].toFixed(4)}
            </p>
          </section>

          <section className="rounded-2xl border p-4" style={{ borderColor: colors.borderSolid, background: colors.card }}>
            <h3 className="mb-2.5 text-[12px] font-semibold tracking-wide" style={{ color: colors.muted }}>{__ui("色差与对比度")}</h3>
            <div className="flex items-center gap-2.5">
              <input type="color" value={compareHex} onChange={(e) => setCompareHex(e.target.value.toUpperCase())} className="h-8 w-12 cursor-pointer rounded border-0 bg-transparent" />
              <div className="h-8 flex-1 rounded-lg border" style={{ background: compareHex, borderColor: colors.borderSolid }} />
            </div>
            <p className="mt-2 text-[12.5px]" style={{ color: colors.text }}>
              ΔE 2000 = <strong>{de.toFixed(2)}</strong>
              <span className="ml-2 text-[11px]" style={{ color: colors.muted }}>
                {de < 1 ? __ui("几乎无法分辨") : de < 2 ? __ui("仔细看才有点差别") : de < 5 ? __ui("能看出差别") : __ui("明显不同")}
              </span>
            </p>
            <div className="mt-3 flex items-center gap-2.5">
              <input type="color" value={textColor} onChange={(e) => setTextColor(e.target.value.toUpperCase())} className="h-8 w-12 cursor-pointer rounded border-0 bg-transparent" />
              <div className="flex h-8 flex-1 items-center justify-center rounded-lg text-[12px] font-semibold" style={{ background: rgbToHex(r, g, b), color: textColor }}>
                {__ui("示例文字")}</div>
            </div>
            <p className="mt-2 text-[12.5px]" style={{ color: cr >= 4.5 ? colors.green : colors.gold }}>
              {__ui("对比度")}<strong>{cr.toFixed(2)} : 1</strong>
              <span className="ml-2 text-[11px]" style={{ color: colors.muted }}>
                {cr >= 7 ? __ui("AAA 达标") : cr >= 4.5 ? __ui("AA 正文达标") : cr >= 3 ? __ui("仅大字达标") : __ui("不达标")}
              </span>
            </p>
          </section>

          <Button
            variant="outline"
            className="gap-2"
            onClick={() => copy(Object.entries(textOf).map(([k, v]) => `${k}: ${v}`).join("\n"), "全部表示")}
          >
            <Copy size={14} /> {__ui("复制全部表示")}</Button>
        </div>

        {/* 右侧：联动色彩模型 */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Palette size={16} />
              <h2 className="text-[14px] font-semibold" style={{ color: colors.text }}>{__ui("联动色彩模型")}</h2>
              <span className="text-[11.5px]" style={{ color: colors.muted }}>{__ui("拖动任意滑杆，其余空间实时联动")}</span>
            </div>
            <button
              onClick={() => setGlued((v) => !v)}
              className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] transition-all"
              style={{
                borderColor: glued ? "hsl(var(--primary))" : colors.borderSolid,
                background: glued ? colors.active : "transparent",
                color: colors.text,
              }}
              title={__ui("锁定后滑杆只按整数步进，便于对照取整")}
            >
              {glued ? <Lock size={12} /> : <LockOpen size={12} />} {__ui("吸附取整")}</button>
          </div>

          <div className="grid gap-3.5 sm:grid-cols-2">
            <SpaceCard
              name="OKLCh"
              note={__ui("感知均匀圆柱坐标")}
              text={textOf.OKLCh}
              colors={colors}
              onCopy={() => copy(textOf.OKLCh, "OKLCh")}
              onSet={(k, v) => setComponent("oklch", k, v)}
              comps={[
                { key: "L", label: "L", value: d.ol, min: 0, max: 1, step: glued ? 0.01 : 0.001, apply: (v) => oklchToRgb(v, d.oC, d.oH) },
                { key: "C", label: "C", value: d.oC, min: 0, max: 0.4, step: glued ? 0.01 : 0.001, apply: (v) => oklchToRgb(d.ol, v, d.oH) },
                { key: "h", label: "H", value: d.oH, min: 0, max: 360, step: 1, apply: (v) => oklchToRgb(d.ol, d.oC, v) },
              ]}
            />
            <SpaceCard
              name="OKLab"
              note={__ui("感知均匀直角坐标")}
              text={textOf.OKLab}
              colors={colors}
              onCopy={() => copy(textOf.OKLab, "OKLab")}
              onSet={(k, v) => setComponent("oklab", k, v)}
              comps={[
                { key: "L", label: "L", value: d.ol, min: 0, max: 1, step: glued ? 0.01 : 0.001, apply: (v) => oklabToRgb(v, d.oa, d.ob) },
                { key: "a", label: "a", value: d.oa, min: -0.4, max: 0.4, step: glued ? 0.01 : 0.001, apply: (v) => oklabToRgb(d.ol, v, d.ob) },
                { key: "b", label: "b", value: d.ob, min: -0.4, max: 0.4, step: glued ? 0.01 : 0.001, apply: (v) => oklabToRgb(d.ol, d.oa, v) },
              ]}
            />
            <SpaceCard
              name="CIE LAB"
              note={__ui("D65 观察者")}
              text={textOf["CIE LAB"]}
              colors={colors}
              onCopy={() => copy(textOf["CIE LAB"], "CIE LAB")}
              onSet={(k, v) => setComponent("lab", k, v)}
              comps={[
                { key: "L", label: "L", value: d.L, min: 0, max: 100, step: glued ? 1 : 0.01, apply: (v) => labToRgb(v, d.A, d.B) },
                { key: "a", label: "a", value: d.A, min: -128, max: 128, step: glued ? 1 : 0.01, apply: (v) => labToRgb(d.L, v, d.B) },
                { key: "b", label: "b", value: d.B, min: -128, max: 128, step: glued ? 1 : 0.01, apply: (v) => labToRgb(d.L, d.A, v) },
              ]}
            />
            <SpaceCard
              name="CIE LCh"
              note={__ui("D65 极坐标")}
              text={textOf["CIE LCh"]}
              colors={colors}
              onCopy={() => copy(textOf["CIE LCh"], "CIE LCh")}
              onSet={(k, v) => setComponent("lch", k, v)}
              comps={[
                { key: "L", label: "L", value: d.L, min: 0, max: 100, step: glued ? 1 : 0.01, apply: (v) => lchToRgb(v, d.C, d.H) },
                { key: "C", label: "C", value: d.C, min: 0, max: 150, step: glued ? 1 : 0.01, apply: (v) => lchToRgb(d.L, v, d.H) },
                { key: "h", label: "h", value: d.H, min: 0, max: 360, step: 1, apply: (v) => lchToRgb(d.L, d.C, v) },
              ]}
            />
            <SpaceCard
              name="RGB"
              note={__ui("屏幕原生色彩通道")}
              text={textOf.RGB}
              colors={colors}
              onCopy={() => copy(textOf.RGB, "RGB")}
              onSet={(k, v) => setComponent("rgb", k, v)}
              comps={[
                { key: "r", label: "R", value: r, min: 0, max: 255, step: 1, apply: (v) => [v, g, b] },
                { key: "g", label: "G", value: g, min: 0, max: 255, step: 1, apply: (v) => [r, v, b] },
                { key: "b", label: "B", value: b, min: 0, max: 255, step: 1, apply: (v) => [r, g, v] },
              ]}
            />
            <SpaceCard
              name="HSL"
              note={__ui("色相/饱和度/亮度")}
              text={textOf.HSL}
              colors={colors}
              onCopy={() => copy(textOf.HSL, "HSL")}
              onSet={(k, v) => setComponent("hsl", k, v)}
              comps={[
                { key: "h", label: "h", value: d.h, min: 0, max: 360, step: 1, apply: (v) => hslToRgb(v, d.s, d.l) },
                { key: "s", label: "s", value: d.s, min: 0, max: 100, step: 1, apply: (v) => hslToRgb(d.h, v, d.l) },
                { key: "l", label: "l", value: d.l, min: 0, max: 100, step: 1, apply: (v) => hslToRgb(d.h, d.s, v) },
              ]}
            />
            <SpaceCard
              name="HSV"
              note={__ui("色相/饱和度/明度")}
              text={textOf.HSV}
              colors={colors}
              onCopy={() => copy(textOf.HSV, "HSV")}
              onSet={(k, v) => setComponent("hsv", k, v)}
              comps={[
                { key: "h", label: "h", value: d.hv, min: 0, max: 360, step: 1, apply: (v) => hsvToRgb(v, d.sv, d.v) },
                { key: "s", label: "s", value: d.sv, min: 0, max: 100, step: 1, apply: (v) => hsvToRgb(d.hv, v, d.v) },
                { key: "v", label: "v", value: d.v, min: 0, max: 100, step: 1, apply: (v) => hsvToRgb(d.hv, d.sv, v) },
              ]}
            />
            <SpaceCard
              name="HWB"
              note={__ui("色相/白度/黑度")}
              text={textOf.HWB}
              colors={colors}
              onCopy={() => copy(textOf.HWB, "HWB")}
              onSet={(k, v) => setComponent("hwb", k, v)}
              comps={[
                { key: "h", label: "h", value: d.hw, min: 0, max: 360, step: 1, apply: (v) => hwbToRgb(v, d.w, d.bl) },
                { key: "w", label: "w", value: d.w, min: 0, max: 100, step: 1, apply: (v) => hwbToRgb(d.hw, v, d.bl) },
                { key: "b", label: "b", value: d.bl, min: 0, max: 100, step: 1, apply: (v) => hwbToRgb(d.hw, d.w, v) },
              ]}
            />
            <SpaceCard
              name="CMYK"
              note={__ui("印刷色彩")}
              text={textOf.CMYK}
              colors={colors}
              onCopy={() => copy(textOf.CMYK, "CMYK")}
              onSet={(k, v) => setComponent("cmyk", k, v)}
              comps={[
                { key: "c", label: "C", value: d.c, min: 0, max: 100, step: 1, apply: (v) => cmykToRgb(v, d.m, d.y, d.k) },
                { key: "m", label: "M", value: d.m, min: 0, max: 100, step: 1, apply: (v) => cmykToRgb(d.c, v, d.y, d.k) },
                { key: "y", label: "Y", value: d.y, min: 0, max: 100, step: 1, apply: (v) => cmykToRgb(d.c, d.m, v, d.k) },
                { key: "k", label: "K", value: d.k, min: 0, max: 100, step: 1, apply: (v) => cmykToRgb(d.c, d.m, d.y, v) },
              ]}
            />
            <SpaceCard
              name="XYZ"
              note={__ui("CIE 1931 基准")}
              text={textOf.XYZ}
              colors={colors}
              onCopy={() => copy(textOf.XYZ, "XYZ")}
              onSet={(k, v) => setComponent("xyz", k, v)}
              comps={[
                { key: "x", label: "X", value: d.x, min: 0, max: 1.2, step: glued ? 0.01 : 0.001, apply: (v) => xyzToRgbTuple(v, d.yy, d.z) },
                { key: "y", label: "Y", value: d.yy, min: 0, max: 1.2, step: glued ? 0.01 : 0.001, apply: (v) => xyzToRgbTuple(d.x, v, d.z) },
                { key: "z", label: "Z", value: d.z, min: 0, max: 1.4, step: glued ? 0.01 : 0.001, apply: (v) => xyzToRgbTuple(d.x, d.yy, v) },
              ]}
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                setHex("#3B82F6");
                setCompareHex("#8B5CF6");
              }}
            >
              <RotateCcw size={13} /> {__ui("重置为默认颜色")}</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
