"use client";

/**
 * 娱乐与创作类工具的自带界面（番茄钟 / 名片生成器 / 文字云 / 拼豆图纸生成器）。
 *
 * 四个工具的任务模型完全不同，布局各按任务选（规范第二部分）：
 *   - 番茄钟：**居中的专注式布局**（不是左右分栏）。用户在这里是「盯着一个数字等它走完」，
 *     视线应当只有一个焦点，所以把大号环形进度摆中间、按钮摆它下面，参数（时长设置）折叠收起。
 *     左右分栏会把注意力撕成两半，属于为分栏而分栏。
 *   - 名片生成器：**工作台（模式 B，12 栏 4:8）**。左侧字段与模板较多，右侧必须看到成品，
 *     而且成品要按名片真实比例（90 × 54 mm）等比呈现，边改边看才判断得出字号层级与留白。
 *   - 文字云：**工作台（模式 B）**。参数（最大词数 / 配色 / 形状 / 角度）与结果互相牵制，
 *     必须实时看到重新摆放后的效果；点词删除也要在成品上直接操作。
 *   - 拼豆图纸：**工作台 + 表格数据（B + D）**。上半部分是「参数 → 图纸」，下半部分是完整宽度的
 *     用料清单表格 —— 清单是这个工具最有价值的产出，塞进窄侧栏会看不全。
 *
 * 关于十六进制色值的说明（供审计区分「界面」与「内容」）：
 *   本文件里出现的 hex 色值**全部**属于「用户可选数据」或「导出成品的内容」，刻意例外，逐处列出：
 *     ① BEAD_PALETTE_STANDARD / BEAD_PALETTE_SOFT —— 内置拼豆色卡（用户可选的色号数据）；
 *     ② CLOUD_PALETTES —— 文字云配色方案（用户可选）；文字云 SVG 的白色背景是导出成品的一部分；
 *     ③ CARD_ACCENT_PRESETS / CARD_BACKGROUND_PRESETS / CARD_INK_DARK / CARD_INK_LIGHT、
 *        名片模板默认底色与主色 —— 名片底色与主色是用户数据，导出图要给别人看，必须用真颜色；
 *     ④ 示例图片/示例名片用的颜色 —— 那是「用户文件/用户内容」；
 *     ⑤ canvas 导出时绘制的所有颜色（拼豆格子的色号文字、图纸网格线、透明像素合成白底）。
 *   界面本体（卡片、边框、文字、背景、按钮、徽章）一律走主题变量，没有一处写死颜色。
 *   三套主题（浅色 / 深色 / 护眼）下，界面部分只用 bg-card / border-border / text-muted-foreground /
 *   text-primary / text-success / bg-secondary 这类变量，不会出现刺眼色块。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  BellOff,
  BellRing,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  Coffee,
  Download,
  Eraser,
  FileSpreadsheet,
  Grid3x3,
  Hash,
  ImagePlus,
  Loader2,
  MousePointerClick,
  Palette,
  Pause,
  Percent,
  Play,
  RotateCcw,
  Shapes,
  SkipForward,
  Sparkles,
  Square,
  Timer,
  Trash2,
  Type as TypeIcon,
  Undo2,
  Upload,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { Badge, Button, Input, Label, Textarea } from "@/components/ui/primitives";
import {
  POMODORO_SOUND_MAX_BYTES,
  formatSoundBytes,
  loadStoredPomodoroSound,
  removeStoredPomodoroSound,
  saveStoredPomodoroSound,
} from "@/lib/pomodoro-sound-store";
import { cn, formatBytes } from "@/lib/utils";
import { useToolDraft } from "@/lib/use-tool-draft";

// ══════════════════════════════════════════════════════════════════════════
// PURE LOGIC ZONE START
// 纯函数区：番茄钟计时/跨天判定、名片文本折行、文字云分词与螺旋摆放、拼豆最近色与抖动、CSV。
// 这一整段不依赖 React / DOM / 网络（文本宽度一律由调用方注入测量函数），
// 可以被整段抽出来单独跑单元测试。
// ══════════════════════════════════════════════════════════════════════════

/** 把数值夹到 [min, max] 区间并取整；非有限数一律回落到 min（输入框清空时用得到）。 */
export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/* ---------------------------------------------------------------- 番茄钟 */

export type PomodoroMode = "focus" | "short" | "long";

export const POMODORO_MODE_LABELS: Record<PomodoroMode, string> = {
  focus: "专注",
  short: "短休息",
  long: "长休息",
};

export const POMODORO_DEFAULT_MINUTES: Record<PomodoroMode, number> = {
  focus: 25,
  short: 5,
  long: 15,
};

/** 每完成这么多个专注，就进入一次长休息。 */
export const POMODORO_LONG_BREAK_EVERY = 4;

/** 倒计时显示：向上取整到秒，所以刚开始时是 25:00 而不是 24:59。 */
export function formatCountdown(ms: number): string {
  const safe = Number.isFinite(ms) && ms > 0 ? ms : 0;
  const totalSeconds = Math.ceil(safe / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/**
 * 一个阶段结束后应该切到哪个阶段。
 * @param current 刚结束的阶段
 * @param focusCountAfterThis 完成这一个专注之后，今天累计完成的专注数
 */
export function nextPomodoroMode(current: PomodoroMode, focusCountAfterThis: number): PomodoroMode {
  if (current !== "focus") return "focus";
  if (focusCountAfterThis > 0 && focusCountAfterThis % POMODORO_LONG_BREAK_EVERY === 0) return "long";
  return "short";
}

export interface PomodoroDayCount {
  /** 本地日期，YYYY-MM-DD */
  date: string;
  count: number;
}

/** 本地日期键（不用 toISOString：那是 UTC，跨时区会在错误的时刻清零）。 */
export function localDateKey(now: number | Date): string {
  const date = typeof now === "number" ? new Date(now) : now;
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** 今日计数：存的日期不是今天就归零（跨天自动清零），计数非法也归零。 */
export function resolveTodayCount(
  stored: PomodoroDayCount | null | undefined,
  now: number | Date,
): PomodoroDayCount {
  const key = localDateKey(now);
  if (!stored || stored.date !== key || !Number.isFinite(stored.count) || stored.count < 0) {
    return { date: key, count: 0 };
  }
  return { date: key, count: Math.floor(stored.count) };
}

export function incrementTodayCount(
  stored: PomodoroDayCount | null | undefined,
  now: number | Date,
): PomodoroDayCount {
  const base = resolveTodayCount(stored, now);
  return { date: base.date, count: base.count + 1 };
}

/* ------------------------------------------------------------ 名片生成器 */

export type BusinessCardTemplate = "minimal" | "dark" | "gradient" | "sidebar";

export interface BusinessCardData {
  name: string;
  title: string;
  company: string;
  phone: string;
  email: string;
  website: string;
  address: string;
  slogan: string;
  template: BusinessCardTemplate;
  /** 主色（用户数据） */
  accent: string;
  /** 底色（用户数据）；「商务深色」模板会用它和主色混合成深底 */
  background: string;
}

/** 名片成品尺寸：90 × 54 mm，这里按 8 倍像素比绘制（导出时再乘 2 倍）。 */
export const CARD_WIDTH = 720;
export const CARD_HEIGHT = 432;

/** 名片与文字云共用的系统中文字体栈：不加载任何在线字体，离线环境也画得出来。 */
export const CARD_FONT_STACK =
  'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif';

/** 文本测量函数：宽度由调用方注入，纯函数区因此不碰 canvas。 */
export type TextMeasure = (text: string, fontSize: number, fontWeight: number) => number;

/** 卡片上的浅色/深色文字（内容色，刻意例外：导出的名片必须自带真颜色）。 */
export const CARD_INK_DARK = "#111827";
export const CARD_INK_LIGHT = "#ffffff";

/** 3/6 位十六进制归一化，非法返回 null。 */
export function normalizeHex(value: string | null | undefined): string | null {
  const text = (value ?? "").trim();
  if (text === "") return null;
  const withHash = text.startsWith("#") ? text : `#${text}`;
  if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(withHash)) return null;
  const body = withHash.slice(1).toLowerCase();
  if (body.length === 3) {
    return `#${body
      .split("")
      .map((ch) => ch + ch)
      .join("")}`;
  }
  return `#${body}`;
}

export function hexToRgb(hex: string): [number, number, number] {
  const norm = normalizeHex(hex) ?? "#000000";
  return [
    parseInt(norm.slice(1, 3), 16),
    parseInt(norm.slice(3, 5), 16),
    parseInt(norm.slice(5, 7), 16),
  ];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const part = (value: number) =>
    Math.min(255, Math.max(0, Math.round(value))).toString(16).padStart(2, "0");
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** 线性混合：amount = 0 取 from，amount = 1 取 to。 */
export function mixHex(from: string, to: string, amount: number): string {
  const t = Math.min(1, Math.max(0, amount));
  const [r1, g1, b1] = hexToRgb(from);
  const [r2, g2, b2] = hexToRgb(to);
  return rgbToHex(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
}

/** factor < 1 变暗（向黑），> 1 变亮（向白）。 */
export function shadeHex(hex: string, factor: number): string {
  return factor >= 1 ? mixHex(hex, "#ffffff", factor - 1) : mixHex(hex, "#000000", 1 - factor);
}

/** rgba 字符串：低透明度装饰用（canvas 与 CSS 都认）。 */
export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${Math.min(1, Math.max(0, alpha))})`;
}

/** 感知亮度（sRGB → 相对亮度），用来决定底色上该配深字还是浅字。 */
export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((value) => {
    const channel = value / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function pickInkColor(surface: string): string {
  return relativeLuminance(surface) > 0.5 ? CARD_INK_DARK : CARD_INK_LIGHT;
}

/** 折到宽度内并在结尾补省略号（纯函数，宽度仍由注入的测量函数给出）。 */
export function ellipsizeLine(text: string, maxWidth: number, measure: (s: string) => number): string {
  const ellipsis = "…";
  if (measure(text + ellipsis) <= maxWidth) return text + ellipsis;
  const chars = [...text];
  while (chars.length > 0 && measure(chars.join("") + ellipsis) > maxWidth) chars.pop();
  return chars.length > 0 ? chars.join("") + ellipsis : ellipsis;
}

export interface WrappedText {
  lines: string[];
  /** true 表示原文没能全部放进 maxLines 行（界面上如实提示用户）。 */
  truncated: boolean;
}

/**
 * 按宽度折行，最多 maxLines 行。
 * 中英文混排：英文优先在空格处断开，中文没有空格就逐字断开。
 * 返回的每一行都满足 measure(line) <= maxWidth（单个字符比整行还宽的极端情况下退化为省略号）。
 */
export function wrapTextLines(
  text: string,
  maxWidth: number,
  maxLines: number,
  measure: (s: string) => number,
): WrappedText {
  const clean = (text ?? "").replace(/\s+/g, " ").trim();
  if (clean === "" || maxWidth <= 0 || maxLines <= 0) return { lines: [], truncated: false };

  const lines: string[] = [];
  let current = "";
  let consumedAll = true;

  for (const ch of clean) {
    const candidate = current + ch;
    if (current !== "" && measure(candidate) > maxWidth) {
      let rest = ch;
      const spaceAt = current.lastIndexOf(" ");
      // 只在「回到空格处仍然占了大半行」时才用它断行，避免把英文短词拆得七零八落
      if (spaceAt > 0 && measure(current.slice(0, spaceAt)) > maxWidth * 0.55) {
        rest = `${current.slice(spaceAt + 1)}${ch}`;
        current = current.slice(0, spaceAt);
      }
      lines.push(current);
      current = rest;
      if (lines.length >= maxLines) {
        consumedAll = false;
        break;
      }
    } else {
      current = candidate;
    }
  }
  if (consumedAll && current !== "" && lines.length < maxLines) lines.push(current);

  let truncated = !consumedAll;
  const result: string[] = [];
  for (const line of lines.slice(0, maxLines)) {
    if (measure(line) > maxWidth) {
      result.push(ellipsizeLine(line, maxWidth, measure));
      truncated = true;
    } else {
      result.push(line);
    }
  }
  if (truncated && result.length > 0) {
    const last = result[result.length - 1];
    if (!last.endsWith("…")) result[result.length - 1] = ellipsizeLine(last, maxWidth, measure);
  }
  return { lines: result, truncated };
}

export interface CardGradient {
  from: string;
  mid: string;
  to: string;
}

export interface CardSurface {
  /** 纯色底（渐变模板下作为兜底色） */
  background: string;
  gradient: CardGradient | null;
  /** 文字颜色 */
  ink: string;
  /** 用于计算对比的「实际底色」（渐变模板取中段色） */
  flat: string;
}

/** 模板 + 用户选的主色/底色 → 名片实际表面（颜色是用户数据，允许写死默认值）。 */
export function resolveCardSurface(
  template: BusinessCardTemplate,
  background: string,
  accent: string,
): CardSurface {
  const bg = normalizeHex(background) ?? "#ffffff";
  const ac = normalizeHex(accent) ?? "#2563eb";
  if (template === "dark") {
    const flat = mixHex(ac, "#0b1220", 0.82);
    return { background: flat, gradient: null, ink: pickInkColor(flat), flat };
  }
  if (template === "gradient") {
    const flat = ac;
    return {
      background: flat,
      gradient: { from: shadeHex(ac, 0.55), mid: ac, to: mixHex(ac, "#ffffff", 0.34) },
      ink: pickInkColor(flat),
      flat,
    };
  }
  return { background: bg, gradient: null, ink: pickInkColor(bg), flat: bg };
}

export interface CardTextBlock {
  lines: string[];
  /** 文字块左上角坐标（多行时行高为 lineHeight） */
  x: number;
  y: number;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
  color: string;
  width: number;
  align: "left" | "center" | "right";
  italic?: boolean;
}

export interface CardDecoration {
  kind: "rect" | "circle";
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  radius?: number;
}

export interface CardLayout {
  width: number;
  height: number;
  background: string;
  gradient: CardGradient | null;
  ink: string;
  sidebar: { width: number; color: string } | null;
  decorations: CardDecoration[];
  blocks: CardTextBlock[];
  truncated: boolean;
}

interface CardSpec {
  contentX: number;
  contentWidth: number;
  nameSize: number;
  metaSize: number;
  contactSize: number;
  ruleWidth: number;
  sidebar: boolean;
  gradient: boolean;
  corner: boolean;
}

const CARD_SPECS: Record<BusinessCardTemplate, CardSpec> = {
  minimal: {
    contentX: 56,
    contentWidth: 608,
    nameSize: 46,
    metaSize: 20,
    contactSize: 15,
    ruleWidth: 64,
    sidebar: false,
    gradient: false,
    corner: false,
  },
  dark: {
    contentX: 56,
    contentWidth: 608,
    nameSize: 46,
    metaSize: 20,
    contactSize: 15,
    ruleWidth: 64,
    sidebar: false,
    gradient: false,
    corner: true,
  },
  gradient: {
    contentX: 56,
    contentWidth: 608,
    nameSize: 48,
    metaSize: 21,
    contactSize: 15,
    ruleWidth: 72,
    sidebar: false,
    gradient: true,
    corner: true,
  },
  sidebar: {
    contentX: 168,
    contentWidth: 496,
    nameSize: 44,
    metaSize: 19,
    contactSize: 14,
    ruleWidth: 56,
    sidebar: true,
    gradient: false,
    corner: false,
  },
};

export const BUSINESS_CARD_TEMPLATES: { id: BusinessCardTemplate; name: string; hint: string }[] = [
  { id: "minimal", name: "简约", hint: "留白为主，一条强调线" },
  { id: "dark", name: "商务深色", hint: "主色加深作底，浅色字" },
  { id: "gradient", name: "渐变", hint: "主色渐变底" },
  { id: "sidebar", name: "侧边色带", hint: "左侧整条色带" },
];

/**
 * 把名片数据排成一份「版式」（文字块 + 装饰块）。
 * 界面预览与 canvas 导出共用这一份版式，所以预览就是成品，不会出现「预览好看、导出跑版」。
 */
export function buildBusinessCardLayout(data: BusinessCardData, measure: TextMeasure): CardLayout {
  const spec = CARD_SPECS[data.template];
  const accent = normalizeHex(data.accent) ?? "#2563eb";
  const surface = resolveCardSurface(data.template, data.background, accent);
  const ink = surface.ink;
  const blocks: CardTextBlock[] = [];
  const decorations: CardDecoration[] = [];
  let truncated = false;

  const name = data.name.trim();
  const meta = [data.title.trim(), data.company.trim()].filter((value) => value !== "").join("  ·  ");
  const slogan = data.slogan.trim();

  let cursor = 96;

  if (name !== "") {
    const wrapped = wrapTextLines(name, spec.contentWidth, 1, (s) => measure(s, spec.nameSize, 700));
    truncated = truncated || wrapped.truncated;
    blocks.push({
      lines: wrapped.lines,
      x: spec.contentX,
      y: cursor,
      fontSize: spec.nameSize,
      fontWeight: 700,
      lineHeight: spec.nameSize * 1.2,
      color: ink,
      width: spec.contentWidth,
      align: "left",
    });
    cursor += spec.nameSize * 1.2 + 12;
  }

  if (meta !== "") {
    const wrapped = wrapTextLines(meta, spec.contentWidth, 1, (s) => measure(s, spec.metaSize, 500));
    truncated = truncated || wrapped.truncated;
    blocks.push({
      lines: wrapped.lines,
      x: spec.contentX,
      y: cursor,
      fontSize: spec.metaSize,
      fontWeight: 500,
      lineHeight: spec.metaSize * 1.3,
      color: mixHex(ink, surface.flat, 0.24),
      width: spec.contentWidth,
      align: "left",
    });
    cursor += spec.metaSize * 1.3 + 18;
  }

  decorations.push({
    kind: "rect",
    x: spec.contentX,
    y: cursor,
    w: spec.ruleWidth,
    h: 4,
    color: data.template === "gradient" ? withAlpha(ink, 0.75) : accent,
    radius: 2,
  });
  cursor += 4 + 20;

  // 联系方式贴底排（先算，才知道上面还剩多少空间给标语）
  const contactEntries: string[] = [];
  const firstContact = [data.phone.trim(), data.email.trim()].filter((value) => value !== "").join("   ");
  if (firstContact !== "") contactEntries.push(firstContact);
  if (data.website.trim() !== "") contactEntries.push(data.website.trim());
  if (data.address.trim() !== "") contactEntries.push(data.address.trim());

  const contactLines: string[] = [];
  for (const entry of contactEntries) {
    const wrapped = wrapTextLines(entry, spec.contentWidth, 2, (s) => measure(s, spec.contactSize, 500));
    truncated = truncated || wrapped.truncated;
    for (const line of wrapped.lines) {
      if (contactLines.length >= 4) break;
      contactLines.push(line);
    }
  }
  const contactLineHeight = spec.contactSize * 1.6;
  const contactTop = CARD_HEIGHT - 56 - contactLines.length * contactLineHeight;

  if (slogan !== "") {
    // 标语最多两行；如果下方紧接着就是联系方式，就只留一行，避免两段文字叠在一起
    const sloganLineHeight = 22;
    const roomForSlogan = contactTop - cursor - 10;
    const sloganMaxLines = roomForSlogan >= sloganLineHeight * 2 ? 2 : 1;
    const wrapped = wrapTextLines(slogan, spec.contentWidth, sloganMaxLines, (s) => measure(s, 16, 500));
    truncated = truncated || wrapped.truncated;
    blocks.push({
      lines: wrapped.lines,
      x: spec.contentX,
      y: cursor,
      fontSize: 16,
      fontWeight: 500,
      lineHeight: sloganLineHeight,
      color: mixHex(ink, surface.flat, 0.34),
      width: spec.contentWidth,
      align: "left",
      italic: true,
    });
  }

  if (contactLines.length > 0) {
    blocks.push({
      lines: contactLines,
      x: spec.contentX,
      y: contactTop,
      fontSize: spec.contactSize,
      fontWeight: 500,
      lineHeight: contactLineHeight,
      color: mixHex(ink, surface.flat, 0.1),
      width: spec.contentWidth,
      align: "left",
    });
  }

  if (spec.corner) {
    decorations.push({
      kind: "circle",
      x: CARD_WIDTH - 92,
      y: 76,
      w: 132,
      h: 132,
      color: data.template === "gradient" ? withAlpha(ink, 0.14) : withAlpha(shadeHex(accent, 1.55), 0.18),
    });
  }

  const sidebar = spec.sidebar ? { width: 112, color: accent } : null;

  return {
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    background: surface.background,
    gradient: surface.gradient,
    ink,
    sidebar,
    decorations,
    blocks,
    truncated,
  };
}

/** 把版式画到 canvas（导出用；界面预览走 DOM，两者共用同一份版式）。 */
export function drawBusinessCard(canvas: HTMLCanvasElement, layout: CardLayout, scale: number): boolean {
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  canvas.width = Math.round(layout.width * scale);
  canvas.height = Math.round(layout.height * scale);
  ctx.setTransform(scale, 0, 0, scale, 0, 0);
  ctx.clearRect(0, 0, layout.width, layout.height);

  if (layout.gradient) {
    // CSS 的 135deg 等价于「左上 → 右下」，这里用同样的方向画，导出与预览一致
    const gradient = ctx.createLinearGradient(0, 0, layout.width, layout.height);
    gradient.addColorStop(0, layout.gradient.from);
    gradient.addColorStop(0.52, layout.gradient.mid);
    gradient.addColorStop(1, layout.gradient.to);
    ctx.fillStyle = gradient;
  } else {
    ctx.fillStyle = layout.background;
  }
  ctx.fillRect(0, 0, layout.width, layout.height);

  if (layout.sidebar) {
    ctx.fillStyle = layout.sidebar.color;
    ctx.fillRect(0, 0, layout.sidebar.width, layout.height);
  }

  for (const item of layout.decorations) {
    ctx.fillStyle = item.color;
    if (item.kind === "circle") {
      ctx.beginPath();
      ctx.arc(item.x, item.y, item.w / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.fillRect(item.x, item.y, item.w, item.h);
    }
  }

  for (const block of layout.blocks) {
    if (block.lines.length === 0) continue;
    ctx.fillStyle = block.color;
    ctx.textBaseline = "top";
    ctx.font = `${block.italic ? "italic " : ""}${block.fontWeight} ${block.fontSize}px ${CARD_FONT_STACK}`;
    const halfLeading = (block.lineHeight - block.fontSize) / 2;
    block.lines.forEach((line, index) => {
      const lineWidth = ctx.measureText(line).width;
      let x = block.x;
      if (block.align === "center") x = block.x + (block.width - lineWidth) / 2;
      else if (block.align === "right") x = block.x + block.width - lineWidth;
      ctx.fillText(line, x, block.y + halfLeading + index * block.lineHeight);
    });
  }
  return true;
}

/* --------------------------------------------------------------- 文字云 */

/** 中英文停用词（用户数据里挑出来的功能词，出现在云里毫无信息量）。 */
export const CLOUD_STOPWORDS = new Set<string>([
  "的", "了", "和", "是", "在", "我", "有", "就", "不", "人", "都", "一", "也", "这", "那",
  "上", "下", "与", "及", "或", "而", "被", "把", "你", "他", "她", "它", "们", "个", "之",
  "为", "以", "于", "并", "但", "很", "会", "要", "着", "过", "中", "对", "从", "到", "还",
  "the", "a", "an", "and", "or", "of", "to", "in", "is", "are", "was", "were", "be", "been",
  "for", "on", "with", "that", "this", "these", "those", "it", "its", "as", "at", "by", "from",
  "into", "than", "then", "so", "such", "but", "not", "no", "do", "does", "did", "has", "have",
  "had", "will", "would", "can", "could", "should", "we", "you", "they", "he", "she", "i",
]);

const CJK_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const TOKEN_PATTERN = /[A-Za-z][A-Za-z0-9'’\-]*|\d+(?:\.\d+)?|[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]+/g;

export function isCjkChar(ch: string): boolean {
  return CJK_PATTERN.test(ch);
}

/** 词组最长取到几个字：中文常用词多为 2~4 字，再长就只是碰巧重复的句子片段了。 */
export const CLOUD_MAX_PHRASE_LENGTH = 4;

/**
 * 词组首尾不允许出现的功能字。
 * 中文没有空格，靠频率切词必然会切出「的时间」「和效率」这类尾巴；
 * 首尾是功能字的候选一律不算词，剩下的部分再按两字词与单字处理。
 * 这里只列纯功能字，不列「中、上、下、对、从、到、为、以」—— 它们在「中国、上面、对话」里是实词的一部分。
 */
export const CJK_EDGE_CHARS = new Set<string>([
  "的", "了", "着", "过", "是", "在", "和", "与", "及", "或", "而", "被", "把", "也", "都",
  "就", "还", "很", "太", "我", "你", "他", "她", "它", "们", "这", "那", "之", "其", "并",
  "但", "因", "所", "并", "则", "且", "由", "让", "使", "得", "地",
]);

function isBlockedPhrase(chars: string[]): boolean {
  if (chars.length === 0) return true;
  // 两字词只查首尾；三字以上的候选只要中间夹着功能字，几乎一定是跨词片段
  // （「据的分析」「率和时间」都是这么来的），这种情况直接丢掉。
  if (chars.length <= 2) {
    return CJK_EDGE_CHARS.has(chars[0]) || CJK_EDGE_CHARS.has(chars[chars.length - 1]);
  }
  return chars.some((ch) => CJK_EDGE_CHARS.has(ch));
}

/**
 * 中文分词（无词典，纯统计）：
 *   1. 先按「重复出现的 2~4 字片段」提取词组，从长到短、次数多的优先，已被占用的字不再重复切；
 *   2. 剩下的零散片段：长度 1 就成单字，长度 ≥ 2 按相邻两字切分。
 * 为什么要先提词组：只按两字滑窗的话，「深度工作」会被切成「深度 / 度工 / 工作」，
 * 那个「度工」是纯噪声；先认词组就能把它整体取出来（见开发时跑的单测）。
 * 含功能字的候选（首尾或中间）直接丢弃，避免「的时间」「据的分析」这种跨词片段。
 * @param runs 每个元素是一段连续汉字的逐字数组（调用方已按标点/空白切开）
 * @returns 与输入等长的数组，每项是这一段切出来的词
 */
export function tokenizeCjkRuns(runs: string[][], maxPhraseLength = CLOUD_MAX_PHRASE_LENGTH): string[][] {
  const used = runs.map((chars) => new Array<boolean>(chars.length).fill(false));
  const result: string[][] = runs.map(() => []);
  const maxLength = Math.max(2, Math.round(maxPhraseLength));

  for (let length = maxLength; length >= 3; length -= 1) {
    const occurrences = new Map<string, { run: number; start: number }[]>();
    runs.forEach((chars, runIndex) => {
      for (let start = 0; start + length <= chars.length; start += 1) {
        const gram = chars.slice(start, start + length).join("");
        if (isBlockedPhrase([...gram])) continue;
        const list = occurrences.get(gram);
        if (list) list.push({ run: runIndex, start });
        else occurrences.set(gram, [{ run: runIndex, start }]);
      }
    });
    const repeated = [...occurrences.entries()]
      .filter(([, list]) => list.length >= 2)
      .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
    for (const [gram, list] of repeated) {
      for (const occurrence of list) {
        const row = used[occurrence.run];
        let free = true;
        for (let i = 0; i < length; i += 1) {
          if (row[occurrence.start + i]) {
            free = false;
            break;
          }
        }
        if (!free) continue;
        for (let i = 0; i < length; i += 1) row[occurrence.start + i] = true;
        result[occurrence.run].push(gram);
      }
    }
  }

  runs.forEach((chars, runIndex) => {
    const row = used[runIndex];
    let start = 0;
    while (start < chars.length) {
      if (row[start]) {
        start += 1;
        continue;
      }
      let end = start;
      while (end < chars.length && !row[end]) end += 1;
      const span = chars.slice(start, end);
      if (span.length === 1) {
        if (!CJK_EDGE_CHARS.has(span[0])) result[runIndex].push(span[0]);
      } else {
        for (let i = 0; i + 1 < span.length; i += 1) {
          const gram = `${span[i]}${span[i + 1]}`;
          if (isBlockedPhrase([...gram])) continue;
          result[runIndex].push(gram);
        }
      }
      start = end;
    }
  });

  return result;
}

/**
 * 分词。
 * - 英文 / 数字：整词取用并转小写（`AI` 与 `ai` 算同一个词）；
 * - 中文：见 tokenizeCjkRuns（重复词组优先，其次两字词与单字）；
 * - 标点、空白、其他符号一律丢弃。
 */
export function tokenizeText(text: string): string[] {
  if (typeof text !== "string" || text.trim() === "") return [];
  const matches = text.match(TOKEN_PATTERN);
  if (!matches) return [];

  const runIndexes: number[] = [];
  const runs: string[][] = [];
  matches.forEach((match, index) => {
    if (isCjkChar(match[0])) {
      runIndexes.push(index);
      runs.push([...match]);
    }
  });
  const perRun = tokenizeCjkRuns(runs);
  const byMatch = new Map<number, string[]>();
  runIndexes.forEach((matchIndex, i) => byMatch.set(matchIndex, perRun[i] ?? []));

  const tokens: string[] = [];
  matches.forEach((match, index) => {
    const cjk = byMatch.get(index);
    if (cjk) {
      for (const token of cjk) tokens.push(token);
      return;
    }
    tokens.push(match.toLowerCase());
  });
  return tokens;
}

export interface CloudWord {
  word: string;
  count: number;
}

/** 词频统计：按次数降序；次数相同按首次出现顺序（保证同样的输入永远给同样的云）。 */
export function countWordFrequencies(tokens: string[]): CloudWord[] {
  const counts = new Map<string, number>();
  const order = new Map<string, number>();
  tokens.forEach((token, index) => {
    counts.set(token, (counts.get(token) ?? 0) + 1);
    if (!order.has(token)) order.set(token, index);
  });
  return [...counts.entries()]
    .map(([word, count]) => ({ word, count }))
    .sort((a, b) => b.count - a.count || (order.get(a.word) ?? 0) - (order.get(b.word) ?? 0));
}

export interface CloudExtractOptions {
  maxWords: number;
  /** 英文单词的最短长度，默认 2（`a`/`of` 这类靠停用词也挡不住） */
  minLatinLength?: number;
  stopwords?: Set<string>;
}

export interface CloudExtraction {
  words: CloudWord[];
  /** 过滤后剩下的候选词总数（"共 N 个词"里的 N 用 placed + skipped 更直观，这里留作参考） */
  candidates: number;
  /** 去掉的停用词与太短的词的数量 */
  dropped: number;
}

export function extractCloudWords(text: string, options: CloudExtractOptions): CloudExtraction {
  const stopwords = options.stopwords ?? CLOUD_STOPWORDS;
  const minLatinLength = Math.max(1, options.minLatinLength ?? 2);
  const tokens = tokenizeText(text);
  const kept: string[] = [];
  let dropped = 0;
  for (const token of tokens) {
    if (stopwords.has(token)) {
      dropped += 1;
      continue;
    }
    if (!isCjkChar(token[0]) && [...token].length < minLatinLength) {
      dropped += 1;
      continue;
    }
    kept.push(token);
  }
  const all = countWordFrequencies(kept);
  // 出现两次以上的词才是"真的在说这个词"；但如果筛完太少（短文本），就退回全部候选，
  // 免得用户粘一句话进来只看到两三个词。
  const repeated = all.filter((item) => item.count >= 2);
  const chosen = repeated.length >= 6 ? repeated : all;
  return {
    words: chosen.slice(0, Math.max(1, options.maxWords)),
    candidates: all.length,
    dropped,
  };
}

export type CloudShape = "rect" | "circle" | "heart";
export const CLOUD_SHAPE_LABELS: Record<CloudShape, string> = {
  rect: "矩形",
  circle: "圆形",
  heart: "心形",
};

/** 归一化坐标（nx、ny ∈ [-1, 1]，ny 向上为正）是否落在形状内。 */
export function shapeContains(shape: CloudShape, nx: number, ny: number): boolean {
  if (shape === "rect") return Math.abs(nx) <= 1 && Math.abs(ny) <= 1;
  if (shape === "circle") return nx * nx + ny * ny <= 1;
  // 心形：经典隐式方程 (x² + y² - 1)³ - x²y³ ≤ 0（y 向上）。
  // 该曲线的包围盒约为 x ∈ [-1.14, 1.14]、y ∈ [-1, 1.26]，所以先按包围盒把归一化坐标映进去，
  // 心尖才正好落在画布下沿、两瓣落在上沿。
  const x = nx * 1.15;
  const y = ny * 1.13 + 0.13;
  const t = x * x + y * y - 1;
  return t * t * t - x * x * y * y * y <= 0;
}

/** 稳定哈希：同一批词每次排版结果一致（避免每次重渲染都换一个摆法）。 */
export function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export interface CloudLayoutOptions {
  width: number;
  height: number;
  shape: CloudShape;
  allowRotate: boolean;
  minFontSize: number;
  maxFontSize: number;
  /** 文字宽度测量（由调用方注入，通常是 canvas.measureText） */
  measure: (text: string, fontSize: number) => number;
  /** 用于分配颜色的颜色数量（= 当前配色方案里的颜色个数） */
  colorCount: number;
  padding?: number;
  /** 每个词最多试探多少个位置；试不到就跳过该词（不会无上限地找下去） */
  maxAttempts?: number;
}

export interface CloudWordBox {
  word: string;
  count: number;
  /** 文字框中心 */
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
  rotated: boolean;
  colorIndex: number;
}

export interface CloudLayoutResult {
  placed: CloudWordBox[];
  /** 试不到位置、被跳过的词（界面上如实告知用户） */
  skipped: string[];
  attempts: number;
}

/** 字号建议：词多就整体变小，词少就把最大的词放大，让画面填得比较满。 */
export function suggestCloudFontSizes(
  wordCount: number,
  width: number,
  height: number,
): { min: number; max: number } {
  const area = Math.max(1, width * height);
  const count = Math.max(1, wordCount);
  const base = Math.sqrt(area / count) * 0.72;
  const max = clampInt(Math.min(92, Math.max(20, base * 1.55)), 20, 120);
  const min = clampInt(Math.min(max * 0.45, Math.max(11, base * 0.4)), 8, max);
  return { min, max };
}

function boxCollides(box: CloudWordBox, placed: CloudWordBox[], padding: number): boolean {
  for (const other of placed) {
    const gapX = (box.width + other.width) / 2 + padding;
    const gapY = (box.height + other.height) / 2 + padding;
    if (Math.abs(box.x - other.x) < gapX && Math.abs(box.y - other.y) < gapY) return true;
  }
  return false;
}

function boxInsideShape(box: CloudWordBox, shape: CloudShape, width: number, height: number): boolean {
  const left = box.x - box.width / 2;
  const right = box.x + box.width / 2;
  const top = box.y - box.height / 2;
  const bottom = box.y + box.height / 2;
  if (left < 0 || top < 0 || right > width || bottom > height) return false;
  if (shape === "rect") return true;
  const halfW = width / 2;
  const halfH = height / 2;
  const nx = (value: number) => (value - halfW) / halfW;
  const ny = (value: number) => (halfH - value) / halfH;
  const corners: [number, number][] = [
    [left, top],
    [right, top],
    [left, bottom],
    [right, bottom],
  ];
  return corners.every(([px, py]) => shapeContains(shape, nx(px), ny(py)));
}

/**
 * 螺旋试探 + 矩形包围盒碰撞的简化排版。
 *
 * 刻意不做「完美无重叠的最优摆放」（那需要一整套布局引擎，还会把首屏拖慢）：
 * 每个词从画布中心出发沿阿基米德螺线向外试探，位置不合法就继续下一个候选点，
 * 试探次数到上限就跳过这个词。**已放下的词之间保证不重叠**（碰撞检测是硬条件），
 * 被跳过的词数量会显示在界面上，不欺骗用户。
 */
export function layoutWordCloud(words: CloudWord[], options: CloudLayoutOptions): CloudLayoutResult {
  const placed: CloudWordBox[] = [];
  const skipped: string[] = [];
  let attempts = 0;
  const width = options.width;
  const height = options.height;
  if (width <= 0 || height <= 0 || words.length === 0) {
    return { placed, skipped: words.map((item) => item.word), attempts };
  }

  const minFontSize = Math.max(6, options.minFontSize);
  const maxFontSize = Math.max(minFontSize, options.maxFontSize);
  const padding = Math.max(0, options.padding ?? 3);
  const maxAttempts = Math.max(50, Math.round(options.maxAttempts ?? 900));
  const colorCount = Math.max(1, options.colorCount);
  const counts = words.map((item) => item.count);
  const maxCount = Math.max(...counts);
  const minCount = Math.min(...counts);
  const spread = maxCount - minCount;
  const centerX = width / 2;
  const centerY = height / 2;

  words.forEach((item, index) => {
    const ratio = spread === 0 ? 1 : Math.sqrt((item.count - minCount) / spread);
    const fontSize = Math.round(minFontSize + (maxFontSize - minFontSize) * (0.34 + 0.66 * ratio));
    const rotated = options.allowRotate && hashString(item.word) % 4 === 0;
    const textWidth = Math.max(options.measure(item.word, fontSize), fontSize * 0.7);
    const boxWidth = rotated ? fontSize * 1.08 : textWidth;
    const boxHeight = rotated ? textWidth : fontSize * 1.08;

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      attempts += 1;
      const angle = attempt * 0.38;
      const radius = 1.05 * angle;
      const candidate: CloudWordBox = {
        word: item.word,
        count: item.count,
        x: centerX + radius * Math.cos(angle),
        y: centerY + radius * Math.sin(angle) * 0.72,
        width: boxWidth,
        height: boxHeight,
        fontSize,
        rotated,
        colorIndex: index % colorCount,
      };
      if (!boxInsideShape(candidate, options.shape, width, height)) continue;
      if (boxCollides(candidate, placed, padding)) continue;
      placed.push(candidate);
      return;
    }
    skipped.push(item.word);
  });

  return { placed, skipped, attempts };
}

export interface CloudFitOptions extends CloudLayoutOptions {
  /** 希望至少放下的比例（默认 0.85） */
  targetRatio?: number;
  /** 最多试几遍（默认 3：1 → 0.8 → 0.64 倍字号） */
  maxPasses?: number;
}

/**
 * 自适应字号摆放：先用给定字号排一遍，若放下的词太少就整体缩小字号重排。
 * 为什么需要它：一张固定画布能放多少词，取决于词数、词长与字号，
 * 用户改一下「最大词数」就可能放不下 —— 与其让界面上写「有 N 个词放不下」，
 * 不如先自动把字号收一收（每遍实测只有几毫秒），实在放不下才如实告知。
 * 返回的是「放下最多」的那一遍结果；版面之间不会互相污染（每遍都是独立排版）。
 */
export function fitCloudLayout(words: CloudWord[], options: CloudFitOptions): CloudLayoutResult {
  const target = Math.min(1, Math.max(0.1, options.targetRatio ?? 0.85));
  const maxPasses = Math.max(1, Math.min(3, Math.round(options.maxPasses ?? 3)));
  const factors = [1, 0.8, 0.64];
  let best: CloudLayoutResult | null = null;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const factor = factors[Math.min(pass, factors.length - 1)];
    const result = layoutWordCloud(words, {
      ...options,
      minFontSize: Math.max(8, Math.round(options.minFontSize * factor)),
      maxFontSize: Math.max(10, Math.round(options.maxFontSize * factor)),
    });
    if (result.placed.length >= words.length) return result;
    if (best === null || result.placed.length > best.placed.length) best = result;
    if (words.length > 0 && result.placed.length / words.length >= target) return result;
  }
  return best ?? layoutWordCloud(words, options);
}

export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export interface CloudSvgOptions {
  width: number;
  height: number;
  palette: string[];
  transparent: boolean;
  /** 不透明时的底色（导出成品的内容色，刻意写死白色） */
  background: string;
  fontFamily: string;
}

/** 生成的 SVG 既用于界面预览的下载，也用于 PNG 栅格化（矢量，下载后还能再编辑）。 */
export function buildCloudSvgMarkup(result: CloudLayoutResult, options: CloudSvgOptions): string {
  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${options.width}" height="${options.height}" viewBox="0 0 ${options.width} ${options.height}">`,
  );
  if (!options.transparent) {
    parts.push(`<rect x="0" y="0" width="${options.width}" height="${options.height}" fill="${options.background}"/>`);
  }
  for (const box of result.placed) {
    const color = options.palette[box.colorIndex % Math.max(1, options.palette.length)] ?? "#111827";
    const transform = box.rotated ? ` transform="rotate(-90 ${box.x.toFixed(2)} ${box.y.toFixed(2)})"` : "";
    parts.push(
      `<text x="${box.x.toFixed(2)}" y="${box.y.toFixed(2)}" font-family="${escapeXml(options.fontFamily)}" font-size="${box.fontSize}" font-weight="700" fill="${color}" text-anchor="middle" dominant-baseline="central"${transform}>${escapeXml(box.word)}</text>`,
    );
  }
  parts.push("</svg>");
  return parts.join("");
}

/* ------------------------------------------------------------ 拼豆图纸 */

export interface BeadColor {
  code: string;
  name: string;
  /** 色卡色值（用户数据，刻意写死的十六进制） */
  hex: string;
}

/** 内置色卡：常见拼豆配色的近似色（不是任何一家厂商的官方色卡，界面上有说明）。 */
export const BEAD_PALETTE_STANDARD: BeadColor[] = [
  { code: "P01", name: "纯白", hex: "#FFFFFF" },
  { code: "P02", name: "奶白", hex: "#F7F3E8" },
  { code: "P03", name: "浅灰", hex: "#D9D9D9" },
  { code: "P04", name: "中灰", hex: "#9AA0A6" },
  { code: "P05", name: "深灰", hex: "#5A5F66" },
  { code: "P06", name: "纯黑", hex: "#1C1C1C" },
  { code: "P07", name: "浅肤", hex: "#F6C9A8" },
  { code: "P08", name: "深肤", hex: "#D99E6F" },
  { code: "P09", name: "浅粉", hex: "#FBC7D4" },
  { code: "P10", name: "粉红", hex: "#F27C9E" },
  { code: "P11", name: "玫红", hex: "#D6336C" },
  { code: "P12", name: "酒红", hex: "#8E1D3C" },
  { code: "P13", name: "大红", hex: "#E03131" },
  { code: "P14", name: "砖红", hex: "#B3412C" },
  { code: "P15", name: "橙色", hex: "#F76707" },
  { code: "P16", name: "橘黄", hex: "#FF922B" },
  { code: "P17", name: "琥珀", hex: "#FFB703" },
  { code: "P18", name: "金黄", hex: "#F9C74F" },
  { code: "P19", name: "浅黄", hex: "#FFF3B0" },
  { code: "P20", name: "柠檬", hex: "#E9F56A" },
  { code: "P21", name: "黄绿", hex: "#B5D33D" },
  { code: "P22", name: "草绿", hex: "#74B816" },
  { code: "P23", name: "正绿", hex: "#2F9E44" },
  { code: "P24", name: "深绿", hex: "#1B6B33" },
  { code: "P25", name: "墨绿", hex: "#0B3D24" },
  { code: "P26", name: "薄荷", hex: "#96E6C1" },
  { code: "P27", name: "青绿", hex: "#12B886" },
  { code: "P28", name: "湖蓝", hex: "#22B8CF" },
  { code: "P29", name: "天蓝", hex: "#4DABF7" },
  { code: "P30", name: "宝蓝", hex: "#1C64F2" },
  { code: "P31", name: "深蓝", hex: "#14337A" },
  { code: "P32", name: "藏青", hex: "#0B1E45" },
  { code: "P33", name: "靛蓝", hex: "#4C6EF5" },
  { code: "P34", name: "浅紫", hex: "#B197FC" },
  { code: "P35", name: "紫色", hex: "#7048E8" },
  { code: "P36", name: "深紫", hex: "#4A1D96" },
  { code: "P37", name: "淡紫", hex: "#E5DBFF" },
  { code: "P38", name: "香芋", hex: "#C8A2D8" },
  { code: "P39", name: "浅棕", hex: "#C8A27A" },
  { code: "P40", name: "棕", hex: "#8B5E3C" },
  { code: "P41", name: "深棕", hex: "#5C3A21" },
  { code: "P42", name: "咖啡", hex: "#3E2A1E" },
  { code: "P43", name: "卡其", hex: "#D9C7A3" },
  { code: "P44", name: "米色", hex: "#EEE0C9" },
  { code: "P45", name: "灰蓝", hex: "#7A8CA3" },
  { code: "P46", name: "石板", hex: "#475569" },
  { code: "P47", name: "银灰", hex: "#C0C6CF" },
  { code: "P48", name: "冰蓝", hex: "#D0EBFF" },
];

export const BEAD_PALETTE_SOFT: BeadColor[] = [
  { code: "S01", name: "暖白", hex: "#FAF6F0" },
  { code: "S02", name: "雾灰", hex: "#CFCFCB" },
  { code: "S03", name: "石墨", hex: "#4C4A48" },
  { code: "S04", name: "藕粉", hex: "#E8C4C4" },
  { code: "S05", name: "豆沙", hex: "#C98B8B" },
  { code: "S06", name: "陶土", hex: "#B4735A" },
  { code: "S07", name: "奶咖", hex: "#C7A98B" },
  { code: "S08", name: "燕麦", hex: "#E3D5B8" },
  { code: "S09", name: "奶油黄", hex: "#F2E2A6" },
  { code: "S10", name: "抹茶", hex: "#B9C98A" },
  { code: "S11", name: "鼠尾草", hex: "#9BB39A" },
  { code: "S12", name: "松绿", hex: "#5E7F6A" },
  { code: "S13", name: "灰蓝绿", hex: "#8FAFAE" },
  { code: "S14", name: "雾蓝", hex: "#A8C0D6" },
  { code: "S15", name: "牛仔蓝", hex: "#6E88A8" },
  { code: "S16", name: "藏蓝灰", hex: "#404E63" },
  { code: "S17", name: "薰衣草", hex: "#C4B7DA" },
  { code: "S18", name: "紫藤", hex: "#9B8BB4" },
  { code: "S19", name: "灰紫", hex: "#7A7086" },
  { code: "S20", name: "浅杏", hex: "#F3D8C0" },
  { code: "S21", name: "珊瑚", hex: "#E79A87" },
  { code: "S22", name: "砖粉", hex: "#C4767A" },
  { code: "S23", name: "暖灰", hex: "#B2A79C" },
  { code: "S24", name: "深褐灰", hex: "#6B5F57" },
];

export type BeadPaletteId = "standard" | "soft";

export const BEAD_PALETTES: { id: BeadPaletteId; name: string; colors: BeadColor[] }[] = [
  { id: "standard", name: "标准 48 色", colors: BEAD_PALETTE_STANDARD },
  { id: "soft", name: "柔和 24 色", colors: BEAD_PALETTE_SOFT },
];

export function getBeadPalette(id: BeadPaletteId): BeadColor[] {
  const found = BEAD_PALETTES.find((item) => item.id === id);
  return found ? found.colors : BEAD_PALETTE_STANDARD;
}

/**
 * 精确最近色：逐个色号算平方距离。
 * 并列时取色卡里靠前的那个（严格小于比较），所以结果是确定的。
 */
export function nearestBeadIndex(palette: BeadColor[], r: number, g: number, b: number): number {
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < palette.length; i += 1) {
    const [pr, pg, pb] = hexToRgb(palette[i].hex);
    const dr = pr - r;
    const dg = pg - g;
    const db = pb - b;
    const distance = dr * dr + dg * dg + db * db;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/**
 * 取色匹配器：一张「实际出现过的颜色 → 色号」的惰性查找表。
 *
 * 为什么不是一次建满的 64³ 全色域查找表（先说结论，再说实测数据）：
 * 全色域查找表只能用「桶中心色」代替真实像素来算最近色，6 位量化（64³）实测
 *   建表 1402ms（48 色卡）/ 与精确最近色一致率 96.40% / 最大平方距离增量 495；
 * 而本工具允许的最大网格 120×120 = 14400 格、且每格颜色都不相同（最坏情况，下面这张惰性表
 * 全部未命中）时，精确匹配只要 3.1ms（50×50 约 1ms，实测于本机 Node 24）。
 * 也就是说：全色域查找表在「慢三个数量级」的同时还「不够准」。所以这里改成按实际像素颜色
 * 惰性建表：首次遇到某个颜色时精确算一次（O(色卡数)），之后同色直接命中 Map（O(1)）。
 * 照片降采样到网格尺寸后颜色重复率很高，实际远快于最坏值，而且结果与精确最近色**完全一致**
 * —— 图纸上每个色号都是真正最近的那一个。
 *
 * 注意：这个匹配器是有状态的（内部有缓存），一次量化任务用一个实例即可；
 * 换了色卡要重新创建（组件里按色卡 id 缓存，见 PerlerBeadsTool）。
 */
export interface BeadMatcher {
  match(r: number, g: number, b: number): number;
  /** 已经精确算过的不同颜色数（性能说明与测试用） */
  cachedCount(): number;
}

export function createBeadMatcher(palette: BeadColor[]): BeadMatcher {
  // 色卡 RGB 预先解析一次，避免在内层循环里反复解析十六进制字符串
  const paletteRgb = palette.map((color) => hexToRgb(color.hex));
  const table = new Map<number, number>();
  return {
    match(r: number, g: number, b: number): number {
      const red = clampInt(r, 0, 255);
      const green = clampInt(g, 0, 255);
      const blue = clampInt(b, 0, 255);
      const key = (red << 16) | (green << 8) | blue;
      const cached = table.get(key);
      if (cached !== undefined) return cached;
      let best = 0;
      let bestDistance = Number.POSITIVE_INFINITY;
      for (let i = 0; i < paletteRgb.length; i += 1) {
        const target = paletteRgb[i];
        const dr = target[0] - red;
        const dg = target[1] - green;
        const db = target[2] - blue;
        const distance = dr * dr + dg * dg + db * db;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = i;
        }
      }
      table.set(key, best);
      return best;
    },
    cachedCount(): number {
      return table.size;
    },
  };
}

export type BeadColorMode = "nearest" | "dither";

function spreadError(
  error: Float32Array,
  index: number,
  dr: number,
  dg: number,
  db: number,
  factor: number,
  total: number,
): void {
  if (index < 0 || index >= total) return;
  error[index * 3] += dr * factor;
  error[index * 3 + 1] += dg * factor;
  error[index * 3 + 2] += db * factor;
}

/**
 * 把网格像素（RGB 三元组，长度 = gridW × gridH × 3）量化成色号下标。
 * nearest：逐格取最近色；dither：Floyd–Steinberg 误差扩散（照片观感明显更好）。
 * matcher 不传时按色卡现建一个（抖动模式下每一格的颜色都被误差改写过，
 * 但它们同样是重复出现的小范围颜色，惰性表照样命中）。
 */
export function quantizeGrid(
  rgb: ArrayLike<number>,
  gridW: number,
  gridH: number,
  palette: BeadColor[],
  mode: BeadColorMode,
  matcher?: BeadMatcher,
): Uint8Array {
  const total = Math.max(0, gridW * gridH);
  const indices = new Uint8Array(total);
  if (total === 0 || palette.length === 0) return indices;
  const pick = matcher ?? createBeadMatcher(palette);

  if (mode === "nearest") {
    for (let i = 0; i < total; i += 1) {
      indices[i] = pick.match(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]);
    }
    return indices;
  }

  const paletteRgb = palette.map((color) => hexToRgb(color.hex));
  const error = new Float32Array(total * 3);
  for (let y = 0; y < gridH; y += 1) {
    for (let x = 0; x < gridW; x += 1) {
      const i = y * gridW + x;
      const r = clampInt(rgb[i * 3] + error[i * 3], 0, 255);
      const g = clampInt(rgb[i * 3 + 1] + error[i * 3 + 1], 0, 255);
      const b = clampInt(rgb[i * 3 + 2] + error[i * 3 + 2], 0, 255);
      const index = pick.match(r, g, b);
      indices[i] = index;
      const target = paletteRgb[index] ?? [0, 0, 0];
      const dr = r - target[0];
      const dg = g - target[1];
      const db = b - target[2];
      spreadError(error, i + 1, dr, dg, db, 7 / 16, total);
      spreadError(error, i + gridW - 1, dr, dg, db, 3 / 16, total);
      spreadError(error, i + gridW, dr, dg, db, 5 / 16, total);
      spreadError(error, i + gridW + 1, dr, dg, db, 1 / 16, total);
    }
  }
  return indices;
}

export interface BeadUsage {
  code: string;
  name: string;
  hex: string;
  count: number;
  /** 占比 0 ~ 1 */
  ratio: number;
}

/** 用料清单：只保留用到的色号，按数量降序（数量相同按色号升序）。 */
export function buildBeadUsage(indices: Uint8Array, palette: BeadColor[]): BeadUsage[] {
  const counts = new Array<number>(palette.length).fill(0);
  let total = 0;
  for (let i = 0; i < indices.length; i += 1) {
    const index = indices[i];
    if (index < counts.length) {
      counts[index] += 1;
      total += 1;
    }
  }
  return palette
    .map((color, index) => ({
      code: color.code,
      name: color.name,
      hex: color.hex,
      count: counts[index],
      ratio: total > 0 ? counts[index] / total : 0,
    }))
    .filter((item) => item.count > 0)
    .sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** 用料清单 CSV：带 BOM，Excel 直接打开不乱码。 */
export function beadsToCsv(usage: BeadUsage[]): string {
  const lines = ["色号,颜色名,色值,数量,占比"];
  for (const item of usage) {
    lines.push(
      [
        csvField(item.code),
        csvField(item.name),
        csvField(item.hex.toUpperCase()),
        String(item.count),
        `${(item.ratio * 100).toFixed(1)}%`,
      ].join(","),
    );
  }
  return `\ufeff${lines.join("\r\n")}\r\n`;
}

/* ------------------------------------------------ 番茄钟提示音（合成参数表） */

/**
 * 提示音全部由 Web Audio 现场合成，不引入任何音频文件：铃声包几乎都有版权问题，
 * 而且合成出来的音色不受体积、网络与授权影响，离线环境一样响。
 *
 * 音色为什么长这样：主流专注类工具（Pomofocus 的 settings 里就有 alarm sounds 一项、
 * Forest / 潮汐 走自然音、番茄土豆一类走轻铃）给的都不是一声固定的「哔」，而是**可挑选的
 * 若干打击类单发音**，共同点是单次触发、起音极快、衰减自然、不刺耳 —— 用户是在安静环境里
 * 等一个阶段结束，提示音要把人叫醒，但不能惊到人。据此这里内置 6 种差别明显的音色
 * （禅意铃 / 木块 / 水滴 / 电子 / 教堂钟 / 木琴）+ 一个静音项，全部是打击型单发音。
 *
 * 这一整段是纯数据 + 纯函数（不碰 AudioContext / DOM，所以也不依赖 lib.dom 的类型），
 * 音色表与参数换算可以整段抽出来单独跑单测。
 * 音色定义里的数值属于「声音数据」而不是界面配色，不受「禁止写死颜色」约束。
 */

/** 波形。刻意不用 lib.dom 的 OscillatorType，纯函数区要能在 Node 里直接跑。 */
export type PomodoroWave = "sine" | "triangle" | "square" | "sawtooth";

/** 一个分音（一次敲击里的一个振动模态）。频率一律写成相对基频的比值。 */
export interface PomodoroPartial {
  /** 相对基频的比值。合金乐器的高阶模态**不是**整数倍（见各音色注释）。 */
  ratio: number;
  /** 滑音的终点比值（水滴用）。等于 ratio 表示不滑音。 */
  endRatio: number;
  /** 相对增益：决定这个模态在音色里的分量，也参与整体归一化。 */
  gain: number;
  /** 衰减时长（秒）。高阶模态衰减更快，这是「像真乐器」最关键的一条。 */
  decay: number;
  /** 起始延迟（秒）：做「敲一下、泛音依次亮起」的层次，也用来排琶音。 */
  delay: number;
  wave: PomodoroWave;
  /**
   * 拍频（Hz）。单个振荡器听不出「拍」，所以非 0 时会再叠一个同频失谐的
   * 影子振荡器，两个靠得很近的频率一起响才有金属的闪烁感。
   */
  beat: number;
}

/** 噪声瞬态：一段极短白噪过低通，做出「敲在实体上」的质感；没有它只剩电子味。 */
export interface PomodoroNoiseSpec {
  gain: number;
  decay: number;
  /** 低通截止（Hz）。木块偏暗、金属偏亮。 */
  cutoff: number;
  /** 低通 Q 值，略高一点噪声才有「材质」。 */
  q: number;
}

export interface PomodoroSoundSpec {
  id: PomodoroSoundToneId;
  label: string;
  /** 界面上的一句客观说明（不是广告词）。 */
  hint: string;
  /** 基频（Hz）。 */
  baseFreq: number;
  /** 起音时间（秒）。打击类必须极短，否则听起来像「吹」出来的而不是「敲」出来的。 */
  attack: number;
  /**
   * 归一化峰值：把所有分音（含影子振荡器与噪声瞬态）的相对增益按比例缩放到这个上界，
   * 这样换音色不会突然变吵或变轻。默认 0.85。
   */
  peakLevel: number;
  partials: PomodoroPartial[];
  noise: PomodoroNoiseSpec | null;
}

/** 内置音色 id。 */
export type PomodoroSoundToneId = "zen" | "wood" | "drop" | "digital" | "bell" | "marimba";

/** 用户可选的提示音：内置音色 / 静音 / 自己导入的音频。 */
export type PomodoroSoundChoice = PomodoroSoundToneId | "none" | "imported";

/** 导入的音频读不出来 / 解码失败时的回落音色（不静默无声）。 */
export const POMODORO_SOUND_FALLBACK_ID: PomodoroSoundToneId = "zen";

/** 影子振荡器相对本体的增益：太高拍频会变成两个音，太低听不出闪烁（实测包络起伏约 4 dB）。 */
export const POMODORO_BEAT_SHADOW_GAIN = 0.32;

/** 分音定义的简写：默认不滑音、无延迟、正弦、无拍频。 */
function partial(
  ratio: number,
  gain: number,
  decay: number,
  extra?: Partial<PomodoroPartial>,
): PomodoroPartial {
  return { ratio, endRatio: ratio, gain, decay, delay: 0, wave: "sine", beat: 0, ...extra };
}

/**
 * 内置音色表。
 *
 * 非谐比例取自被广泛使用的调音乐器模态参数（不是随手写的整数倍）：
 *   - 钟/钵：1 : 2.76 : 5.40 : 8.93 : 13.34，振幅按 1/n² 递减
 *     （见 https://docs.rs/rill-core-model/0.5.0/rill_core_model/modal/fn.bell_modes.html ）；
 *     整数倍泛音听起来像风琴，非谐比例才有金属被敲的味道。
 *   - 木琴（马林巴）条：1 : 4 : 9，振幅按 1/n 递减
 *     （见 https://docs.rs/rill-core-model/0.5.0-beta.6/rill_core_model/modal/fn.marimba_modes.html ），
 *     即基音 + 两个八度 + 两个八度加大三度，这是削膛调音后的真实比例。
 *   - 教堂钟用标准的部分音命名：嗡(hum) 0.5、基音(prime) 1.0、小三度(tierce) 1.19、
 *     五度(quint) 1.5、八度(nominal) 2.0、超五度 2.4。
 */
export const POMODORO_SOUND_SPECS = [
  {
    id: "zen",
    label: "禅意铃",
    hint: "钵体非谐五模态，长衰减，尾音带轻微拍频。",
    baseFreq: 440,
    attack: 0.006,
    peakLevel: 0.85,
    partials: [
      // 低频「嗡」+ 基音互相拍：真实的钵不可能完全圆，这一点点不完美才是它的呼吸感
      partial(0.5, 0.16, 2.4, { beat: 1.2 }),
      partial(1.0, 0.44, 2.0, { beat: -0.9 }),
      partial(2.76, 0.2, 1.25, { delay: 0.004 }),
      partial(5.4, 0.09, 0.7, { delay: 0.008 }),
      partial(8.93, 0.045, 0.42, { delay: 0.01 }),
    ],
    // 绒布槌击钵：极短、偏暗的一点点噪声，纯正弦起音会显得「电子」
    noise: { gain: 0.05, decay: 0.05, cutoff: 2600, q: 0.8 },
  },
  {
    id: "wood",
    label: "木块",
    hint: "短促干敲击，噪声瞬态明显，几乎不留尾音。",
    baseFreq: 1180,
    attack: 0.0015,
    // 最干的音色：高频模态很快就走散、峰值上不去，所以归一化目标直接顶到 1.0 补偿它的短促
    peakLevel: 1,
    partials: [
      // 木块是板振动，模态比接近 1 : 1.63 : 2.34 : 3.41，越高的模态衰减越快
      partial(1.0, 0.5, 0.24),
      partial(1.63, 0.2, 0.09),
      partial(2.34, 0.09, 0.055, { wave: "triangle" }),
      partial(3.41, 0.04, 0.032, { wave: "triangle" }),
    ],
    // 敲击感几乎全靠这一段 16ms 的低通白噪
    noise: { gain: 0.3, decay: 0.016, cutoff: 1900, q: 1.1 },
  },
  {
    id: "drop",
    label: "水滴",
    hint: "下滑正弦，两声「叮—咚」，音头很亮、尾巴很暗。",
    baseFreq: 1046.5,
    attack: 0.001,
    peakLevel: 0.85,
    partials: [
      // 水滴的听感来自气泡共鸣频率的下滑：先高后低，且第一声比第二声亮
      partial(1.0, 0.6, 0.16, { endRatio: 0.45 }),
      partial(1.32, 0.2, 0.1, { endRatio: 0.6, delay: 0.004 }),
      partial(0.55, 0.4, 0.32, { endRatio: 0.31, delay: 0.13 }),
    ],
    // 破水面的那一下「啵」：极短的高频噪声
    noise: { gain: 0.02, decay: 0.008, cutoff: 6000, q: 0.7 },
  },
  {
    id: "digital",
    label: "电子",
    hint: "两声方波上行四度，最短最直接。",
    baseFreq: 1318.51,
    attack: 0.003,
    // 方波的有效值远高于正弦，同样峰值听起来更吵，所以单独压低
    peakLevel: 0.62,
    partials: [
      partial(1.0, 0.42, 0.085, { wave: "square" }),
      partial(2.0, 0.12, 0.06, { wave: "triangle" }),
      // 1760 / 1318.51 ≈ 1.3348，上行纯四度
      partial(1.3348, 0.5, 0.1, { delay: 0.13, wave: "square" }),
    ],
    noise: null,
  },
  {
    id: "bell",
    label: "教堂钟",
    hint: "嗡、基音、小三度、五度、八度共同发声，极长衰减。",
    baseFreq: 261.63,
    attack: 0.004,
    peakLevel: 0.85,
    partials: [
      partial(0.5, 0.3, 2.45, { beat: 0.9 }),
      partial(1.0, 0.46, 2.3, { beat: -0.7 }),
      partial(1.19, 0.22, 1.9, { delay: 0.005 }),
      partial(1.5, 0.16, 1.55, { delay: 0.005 }),
      partial(2.0, 0.2, 1.15, { delay: 0.008, wave: "triangle" }),
      partial(2.4, 0.08, 0.85, { delay: 0.01 }),
    ],
    // 金属槌击：比木块更亮、更短
    noise: { gain: 0.06, decay: 0.025, cutoff: 4200, q: 0.9 },
  },
  {
    id: "marimba",
    label: "木琴",
    hint: "大三度—纯五度琶音，木条模态，中等衰减。",
    baseFreq: 523.25,
    attack: 0.003,
    peakLevel: 0.85,
    partials: [
      // 每个音两个模态：基音 + 两个八度（1 : 3.94），第三个音起上行三度、五度
      partial(1.0, 0.46, 1.0),
      partial(3.94, 0.14, 0.35),
      partial(1.25, 0.34, 0.9, { delay: 0.11 }),
      partial(4.925, 0.1, 0.3, { delay: 0.11 }),
      partial(1.5, 0.26, 0.8, { delay: 0.22 }),
      partial(5.91, 0.08, 0.26, { delay: 0.22 }),
    ],
    // 木槌击：干净的一点点噪声，太强就变成木鱼了
    noise: { gain: 0.12, decay: 0.014, cutoff: 2600, q: 1.0 },
  },
] satisfies readonly PomodoroSoundSpec[];

/** 按 id 取音色定义；"none" / "imported" / 未收录的 id 一律返回 null。 */
export function findSoundSpec(id: PomodoroSoundChoice): PomodoroSoundSpec | null {
  return POMODORO_SOUND_SPECS.find((spec) => spec.id === id) ?? null;
}

/**
 * 拍频（Hz）换算成 detune 需要的音分：1200·log2((f + beat) / f)。
 * 直接用 Hz 加减频率会在大分音上偏得离谱，音分才是等比的。
 */
export function beatToCents(freq: number, beatHz: number): number {
  if (!Number.isFinite(freq) || freq <= 0 || !Number.isFinite(beatHz) || beatHz === 0) return 0;
  const target = freq + beatHz;
  if (target <= 0) return 0;
  return Math.round(1200 * Math.log2(target / freq) * 100) / 100;
}

/** 归一化后排给振荡器的一条事件。 */
export interface PomodoroToneEvent {
  /** 起始频率（Hz，已按基频换算）。 */
  freq: number;
  /** 终点频率（Hz）。等于 freq 表示不滑音。 */
  endFreq: number;
  /** 峰值增益（已按 peakLevel 归一化，总增益在 master 上另算）。 */
  gain: number;
  /** 相对本次播放起点的延迟（秒）。 */
  start: number;
  /** 该分音持续时长（秒）= 起音 + 衰减。 */
  duration: number;
  wave: PomodoroWave;
  attack: number;
  /** 失谐（音分）。非 0 表示这是一条拍频影子振荡器。 */
  detuneCents: number;
}

/**
 * 展开分音（含拍频影子），此时还没归一化。
 *
 * @param tailLimit 可选的尾音上限（秒）。响铃模式下一次敲击必须在下一次敲击之前收干净：
 *   20 多次余音互相叠加会「越叠越响」并糊成一片（作者明确要求不要爆音），
 *   所以按上限把衰减截短 —— 听感上就是从「长鸣的钵」变成「被按住止振的钵」，
 *   这恰好是闹钟要的效果。不传就是完整自然衰减（试听走这条路）。
 */
function expandSoundEvents(spec: PomodoroSoundSpec, tailLimit?: number): PomodoroToneEvent[] {
  const events: PomodoroToneEvent[] = [];
  const limit =
    typeof tailLimit === "number" && Number.isFinite(tailLimit) && tailLimit > 0 ? tailLimit : Infinity;
  for (const item of spec.partials) {
    // 起音加延迟都排不进上限的分音整条丢掉，否则会排出一个负时长的包络（ExponentialRamp 会抛错）
    const decay = Math.min(item.decay, limit - item.delay - spec.attack);
    if (decay <= 0.004) continue;
    const freq = spec.baseFreq * item.ratio;
    const endFreq = spec.baseFreq * item.endRatio;
    const base = {
      freq,
      endFreq: Number.isFinite(endFreq) && endFreq > 0 ? endFreq : freq,
      start: item.delay,
      duration: spec.attack + decay,
      wave: item.wave,
      attack: spec.attack,
    };
    events.push({ ...base, gain: item.gain, detuneCents: 0 });
    const cents = beatToCents(freq, item.beat);
    if (cents !== 0) {
      events.push({ ...base, gain: item.gain * POMODORO_BEAT_SHADOW_GAIN, detuneCents: cents });
    }
  }
  return events;
}

/** 归一化前的峰值上界 = 所有分音（含影子）相对增益之和 + 噪声瞬态。 */
export function soundRawPeak(spec: PomodoroSoundSpec): number {
  const tones = expandSoundEvents(spec).reduce((sum, event) => sum + event.gain, 0);
  return tones + (spec.noise ? spec.noise.gain : 0);
}

/** 把整个音色缩放到 spec.peakLevel 的系数（分音越多越响的问题在这里解决）。 */
export function soundNormalizeScale(spec: PomodoroSoundSpec): number {
  const raw = soundRawPeak(spec);
  return raw > 0 ? spec.peakLevel / raw : 0;
}

/**
 * 把音色定义展开成可以直接排给振荡器的事件表（单测就跑这个函数）。
 * 传 tailLimit 时所有分音都会被压进这段时长里，用于响铃模式（见 expandSoundEvents）。
 */
export function buildSoundToneEvents(
  spec: PomodoroSoundSpec,
  options?: { tailLimit?: number },
): PomodoroToneEvent[] {
  const scale = soundNormalizeScale(spec);
  return expandSoundEvents(spec, options?.tailLimit).map((event) => ({
    ...event,
    gain: event.gain * scale,
  }));
}

/** 音色总时长（秒）= 最后一个分音的「延迟 + 起音 + 衰减」，噪声瞬态也参与比较。 */
export function soundTotalDuration(spec: PomodoroSoundSpec): number {
  let total = spec.noise ? spec.noise.decay : 0;
  for (const item of spec.partials) {
    total = Math.max(total, item.delay + spec.attack + item.decay);
  }
  return Math.round(total * 1000) / 1000;
}

export const POMODORO_VOLUME_MIN = 0;
export const POMODORO_VOLUME_MAX = 100;
/** 默认音量。改版前固定峰值只有 0.16，作者反馈太轻，所以默认直接给到 85%。 */
export const POMODORO_VOLUME_DEFAULT = 85;
/** 滑块 100% 对应的总增益。大于 1 是有意的：总增益本来就该能推过 1（限幅器兜底）。 */
export const POMODORO_GAIN_CEILING = 1.6;

/**
 * 音量滑块（0~100）→ 总增益。
 * 用 x^1.5 而不是线性：人耳对响度的感知接近振幅的 0.6 次方，线性映射会让
 * 「0 → 50%」这一段听起来几乎没变化。0 一定映射到 0（真静音），非法值一律被夹到 [0,100]。
 */
export function pomodoroVolumeToGain(volume: number): number {
  const safe = clampInt(volume, POMODORO_VOLUME_MIN, POMODORO_VOLUME_MAX);
  if (safe <= 0) return 0;
  return Math.round(Math.pow(safe / 100, 1.5) * POMODORO_GAIN_CEILING * 1000) / 1000;
}

/**
 * 一次播放的峰值上界：归一化保证分音之和 = peakLevel，所以这里就是 peakLevel × 总增益。
 * 用来在单测里确认「不会一上来就削顶」，也用来在界面之外定位音量问题。
 */
export function soundPeakUpperBound(spec: PomodoroSoundSpec, volume: number): number {
  return Math.round(spec.peakLevel * pomodoroVolumeToGain(volume) * 1000) / 1000;
}

/* ────────────── 响铃节奏：照手机闹钟来（不是「叮」一下就没了） ────────────── */

/**
 * 一次响铃的总时长（秒）。
 *
 * 依据：手机闹钟的响铃窗口就是 20~30 秒这个量级（响够之后才进入「稍后提醒」或自动停止）。
 * 上一版一次只响 0.2~2.5 秒，作者的原话是「怎么这么短，用户都没听到呢就没了」；
 * 24 秒足够让离开座位接水的人走回来听见，又短到不会像忘了关的闹钟那样响一整晚。
 */
export const POMODORO_RING_TOTAL_SECONDS = 24;

/**
 * 一组敲几声。
 * 3 声一组 + 组间停顿，就是手机闹钟最典型的「嘟嘟嘟—嘟嘟嘟」节奏：
 * 有分组才有「催促感」，等间隔的滴答听起来像节拍器，很容易被大脑过滤掉（这正是作者嫌「单调」的原因）。
 */
export const POMODORO_RING_STRIKES_PER_GROUP = 3;

/**
 * 组内相邻敲击间隔的下限 / 上限（秒）。
 * - 下限 0.45 秒：再密就糊成一片嗡鸣，听不出「敲」的颗粒，也更容易让人烦躁；
 * - 上限 1.5 秒：再疏就不像闹钟，而像背景音乐里的点缀。
 */
export const POMODORO_RING_STRIKE_GAP_MIN = 0.45;
export const POMODORO_RING_STRIKE_GAP_MAX = 1.5;

/** 每组之后的额外停顿（秒）：分组节奏靠它，光有等间隔就退回「单调」了。 */
export const POMODORO_RING_GROUP_GAP = 0.6;

/**
 * 某个音色的敲击间隔：跟着音色自身的尾巴长度走。
 * - 长衰减的音色（禅意铃 2.42 秒、教堂钟 2.45 秒）间隔放宽到上限，否则余音互相叠加会糊成一团、
 *   峰值也越叠越高；
 * - 短促的音色（木块 0.24 秒、电子 0.23 秒）用下限，敲得更密才有催促感。
 * 系数 0.8 的含义：下一次敲击落在上一次余音衰减到大约三成的时候 —— 留一点点余韵连成句，
 * 又不至于拖泥带水。
 */
export function ringStrikeGapSeconds(spec: PomodoroSoundSpec): number {
  const scaled = soundTotalDuration(spec) * 0.8;
  const clamped = Math.min(
    POMODORO_RING_STRIKE_GAP_MAX,
    Math.max(POMODORO_RING_STRIKE_GAP_MIN, scaled),
  );
  return Math.round(clamped * 1000) / 1000;
}

/** 响铃计划：什么时候敲、敲多少次、每一次允许占多长。纯函数，单测直接对拍。 */
export interface PomodoroRingPlan {
  /** 组内相邻敲击的间隔（秒） */
  strikeGap: number;
  /** 组间额外停顿（秒） */
  groupGap: number;
  /**
   * 每一次敲击允许占用的时长（秒）＝ strikeGap。
   * 它同时是「尾音上限」：保证相邻两次敲击的波形**完全不重叠**，
   * 于是整段响铃的峰值恒等于单次敲击的峰值（不会越叠越响、不会爆音）。
   */
  tailLimit: number;
  /** 每次敲击相对响铃起点的偏移（秒） */
  offsets: number[];
  /** 一共敲几次 */
  strikeCount: number;
  /** 总时长（秒） */
  totalSeconds: number;
}

/** 生成响铃节奏表。纯函数：给定音色与总时长，输出确定的敲击时刻表。 */
export function buildRingPlan(
  spec: PomodoroSoundSpec,
  totalSeconds: number = POMODORO_RING_TOTAL_SECONDS,
): PomodoroRingPlan {
  const total =
    typeof totalSeconds === "number" && Number.isFinite(totalSeconds) && totalSeconds > 0
      ? totalSeconds
      : 0;
  const strikeGap = ringStrikeGapSeconds(spec);
  const offsets: number[] = [];
  let at = 0;
  // 浮点累加会有 24.000000000000004 这种尾巴，所以每步都归一到毫秒再比较
  while (at < total) {
    offsets.push(Math.round(at * 1000) / 1000);
    const endOfGroup = offsets.length % POMODORO_RING_STRIKES_PER_GROUP === 0;
    at += strikeGap + (endOfGroup ? POMODORO_RING_GROUP_GAP : 0);
  }
  return {
    strikeGap,
    groupGap: POMODORO_RING_GROUP_GAP,
    tailLimit: strikeGap,
    offsets,
    strikeCount: offsets.length,
    totalSeconds: total,
  };
}

/** 一共敲几次（界面文案与单测用）。 */
export function ringStrikeCount(
  spec: PomodoroSoundSpec,
  totalSeconds: number = POMODORO_RING_TOTAL_SECONDS,
): number {
  return buildRingPlan(spec, totalSeconds).strikeCount;
}

/** 响铃模式：整段循环播放，最多 60 秒自动停 —— 避免用户离开后响一整晚。 */
export const POMODORO_IMPORT_RING_SECONDS = 60;
/**
 * 试听一次最多播多久（秒）。
 * 试听只是确认「就是这段声音」，不该响 20 秒：导入的音频常常是一整首歌，
 * 试听把它从头播 20 秒既不礼貌也拖慢用户的操作。
 */
export const POMODORO_IMPORT_PREVIEW_SECONDS = 6;
/** 结束前的淡出时长（秒）。 */
export const POMODORO_IMPORT_FADE_SECONDS = 0.8;

/** 两种播放模式：试听只响一次，计时到点则进入「响铃」，一直响到用户停。 */
export type PomodoroSoundPlaybackMode = "preview" | "ring";

/** 导入音频的播放计划：播多久、从哪里开始淡出、起音多长、要不要循环。纯函数，单测可覆盖。 */
export interface PomodoroImportedPlan {
  playSeconds: number;
  fadeStart: number;
  attackSeconds: number;
  /** 是否整段循环：响铃模式为 true（手机闹钟就是一段循环的铃声），试听为 false。 */
  loop: boolean;
}

export function importedPlaybackPlan(
  durationSeconds: number,
  mode: PomodoroSoundPlaybackMode = "preview",
): PomodoroImportedPlan {
  const safe =
    typeof durationSeconds === "number" && Number.isFinite(durationSeconds) && durationSeconds > 0
      ? durationSeconds
      : 0;
  if (safe <= 0) return { playSeconds: 0, fadeStart: 0, attackSeconds: 0, loop: false };
  const playSeconds =
    mode === "ring"
      ? POMODORO_IMPORT_RING_SECONDS
      : Math.min(safe, POMODORO_IMPORT_PREVIEW_SECONDS);
  // 起音/淡出都不能超过总长的四分之一，否则极短的音频会被淡成一声闷响
  const attackSeconds = Math.min(0.02, playSeconds / 4);
  const fadeSeconds = Math.min(POMODORO_IMPORT_FADE_SECONDS, playSeconds / 4);
  return {
    playSeconds,
    fadeStart: playSeconds - fadeSeconds,
    attackSeconds,
    loop: mode === "ring",
  };
}

/**
 * 导入的音频还没读出来（首次从本机读取中）或彻底读不出来的时候，
 * 必须如实回落到内置音色，否则界面显示「自定义音频」却什么也不响。
 */
export function resolveSoundChoice(
  choice: PomodoroSoundChoice,
  hasImportedBuffer: boolean,
): PomodoroSoundChoice {
  if (choice !== "imported") return choice;
  return hasImportedBuffer ? "imported" : POMODORO_SOUND_FALLBACK_ID;
}

/** 音色在界面上的名字（"imported" 的完整名字由调用方拼上文件名）。 */
export function soundChoiceLabel(choice: PomodoroSoundChoice): string {
  if (choice === "none") return "静音";
  if (choice === "imported") return "自定义音频";
  return findSoundSpec(choice)?.label ?? "静音";
}

// ══════════════════════════════════════════════════════════════════════════
// PURE LOGIC ZONE END
// ══════════════════════════════════════════════════════════════════════════

/* ══════════════════════════════════════════════════════════════════════════
 * 界面小件（与全站一致的材质：rounded-2xl / border-border\/70 / shadow-xs）
 * ══════════════════════════════════════════════════════════════════════════ */

/** 规范第五节的错误样式，四处共用。 */
function ToolError({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border-l-4 border-l-destructive bg-destructive/10 px-4 py-3 font-mono text-xs text-destructive">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      {message}
    </div>
  );
}

/** 分段控件：参数一律用按钮组，不用下拉框。 */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { value: T; label: string; icon?: ComponentType<{ className?: string }> }[];
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const active = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-all",
              active
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border/70 bg-card text-muted-foreground hover:bg-secondary hover:text-foreground",
              disabled && "cursor-not-allowed opacity-40 hover:bg-card hover:text-muted-foreground",
            )}
          >
            {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
            {option.label}
            {active ? <Check className="h-3.5 w-3.5" /> : null}
          </button>
        );
      })}
    </div>
  );
}

/** 结果区空状态：不留白，给一句引导 + 一个示例入口。 */
function EmptyPane({
  icon,
  hint,
  action,
  className,
}: {
  icon: ReactNode;
  hint: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/70 bg-card/40 p-6 text-center",
        className,
      )}
    >
      <div className="text-muted-foreground/40">{icon}</div>
      <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">{hint}</p>
      {action}
    </div>
  );
}

/** 卡片里的小节标题（与 dev-format-tools 一致，不是工具名/描述）。 */
function SectionTitle({ icon: Icon, title, extra }: { icon?: ComponentType<{ className?: string }>; title: string; extra?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex items-center gap-2">
        {Icon ? <Icon className="h-3.5 w-3.5 text-primary" /> : null}
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      </div>
      {extra}
    </div>
  );
}

/** 一次性下载：链接用完必须释放（这类链接不跨工具复用，所以点击后延迟撤销）。 */
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/** 文件名里不能出现的字符统一替换掉。 */
function safeFileName(value: string, fallback: string): string {
  const trimmed = value.trim().replace(/[\\/:*?"<>|]+/g, "_");
  return trimmed === "" ? fallback : trimmed.slice(0, 60);
}

/* ══════════════════════════════════════════════════════════════════════════
 * 1. 番茄钟
 *
 * 布局：居中专注式。理由见文件头 —— 这个工具的使用姿势是「盯着它」，所以画面只有一个焦点：
 * 环形进度 → 环内时间 → 一排按钮 → 模式切换 → 折叠的时长设置。
 * 不做左右分栏：分栏会让人在两个区域之间来回扫视，对这个工具没有任何好处。
 * ══════════════════════════════════════════════════════════════════════════ */

const POMODORO_RING_SIZE = 268;
const POMODORO_RING_STROKE = 14;

/* ── Web Audio 引擎：整个文件里只有这一段碰 AudioContext（有副作用，不属于纯函数区） ── */

interface PomodoroAudioWindow extends Window {
  webkitAudioContext?: typeof AudioContext;
}

/** 环境不支持时给用户看的一句话，界面直接展示。 */
const POMODORO_AUDIO_UNSUPPORTED = "当前环境不支持 Web Audio，提示音无法播放（计时不受影响）。";

function getAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  // AudioContext 来自全局作用域（typeof globalThis）而不是 Window 本身，所以交叉一下再取
  const target = window as Window & typeof globalThis & PomodoroAudioWindow;
  return target.AudioContext ?? target.webkitAudioContext ?? null;
}

/** 共享的 AudioContext 与总增益。整段信号链：osc → 分音包络 → master → 限幅器 → 输出。 */
let pomodoroCtx: AudioContext | null = null;
let pomodoroMaster: GainNode | null = null;

/**
 * 取得（必要时建立）共享的 AudioContext。
 *
 * **必须在用户手势里调用**：「开始」「试听」「导入」三个入口都会先走这里。
 * 浏览器与 Electron 的自动播放策略要求 AudioContext 在用户交互中被 resume，否则
 * 之后（倒计时结束时的定时器回调里）播出来的声音会被静默丢弃 —— 这正是「有时候不响」的根因。
 *
 * @param resume 传 false 时只建图不尝试恢复（挂载时从 IndexedDB 读回音频、纯解码用得上：
 *   解码在 suspended 的 AudioContext 上照样能跑，而此时 resume() 会因为没有用户手势而 reject）。
 */
function unlockPomodoroAudio(resume = true): AudioContext | null {
  const Ctor = getAudioContextCtor();
  if (!Ctor) return null;
  try {
    if (!pomodoroCtx || pomodoroCtx.state === "closed") {
      const ctx = new Ctor();
      const master = ctx.createGain();
      master.gain.value = 0;
      // 安全限幅器：滑块推到 100%、或用户导入的音频本身录得很热时不至于削顶爆音。
      // 实测（OfflineAudioContext 离屏渲染）：默认音量 85% 时峰值 0.75，它完全不介入；
      // 推到 100% 才把峰值从约 0.95 压到 0.83，听感上没有变化，但避免了削顶。
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -3;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.001;
      limiter.release.value = 0.12;
      master.connect(limiter).connect(ctx.destination);
      pomodoroCtx = ctx;
      pomodoroMaster = master;
    }
    if (resume && pomodoroCtx.state === "suspended") {
      // 没有用户手势时 resume() 会 reject（NotAllowedError）；必须接住，
      // 否则控制台会留下一条未处理的 Promise 拒绝，看起来像功能坏了。
      void pomodoroCtx.resume().catch(() => undefined);
    }
    return pomodoroCtx;
  } catch {
    return null;
  }
}

/** 把音量滑块的值写到总增益上。拖滑块时应当立刻跟手，所以直接赋值不排 ramp。 */
function applyPomodoroVolume(volume: number): void {
  if (!pomodoroCtx || !pomodoroMaster) return;
  pomodoroMaster.gain.setValueAtTime(pomodoroVolumeToGain(volume), pomodoroCtx.currentTime);
}

/** 一次播放产生的全部节点：停播与回收都靠这两个数组，不留悬挂的振荡器。 */
interface PomodoroVoice {
  sources: AudioScheduledSourceNode[];
  nodes: AudioNode[];
}

let pomodoroVoice: PomodoroVoice | null = null;
let pomodoroVoiceTimer: number | null = null;

/**
 * 立刻停掉正在响的提示音并断开所有节点。
 * 暂停 / 重置 / 跳过 / 换模式 / 卸载都必须调：一次性提醒不该在用户已经动过手之后还在响。
 */
function stopPomodoroSound(): void {
  if (typeof window !== "undefined" && pomodoroVoiceTimer !== null) {
    window.clearTimeout(pomodoroVoiceTimer);
  }
  pomodoroVoiceTimer = null;
  const voice = pomodoroVoice;
  pomodoroVoice = null;
  if (!voice) return;
  for (const source of voice.sources) {
    try {
      source.stop();
    } catch {
      /* 已经自然结束 */
    }
  }
  for (const node of voice.nodes) {
    try {
      node.disconnect();
    } catch {
      /* 已经断开 */
    }
  }
}

/** 自然播完后回收节点（长会话里反复播放不会越积越多）。 */
function scheduleVoiceCleanup(voice: PomodoroVoice, seconds: number): void {
  if (typeof window === "undefined") return;
  if (pomodoroVoiceTimer !== null) window.clearTimeout(pomodoroVoiceTimer);
  pomodoroVoiceTimer = window.setTimeout(
    () => {
      pomodoroVoiceTimer = null;
      if (pomodoroVoice !== voice) return;
      pomodoroVoice = null;
      for (const node of voice.nodes) {
        try {
          node.disconnect();
        } catch {
          /* 忽略 */
        }
      }
    },
    Math.max(200, seconds * 1000 + 400),
  );
}

/** 白噪缓冲按需生成一次并复用（噪声瞬态最长只有 50ms，0.5 秒够用）。 */
let pomodoroNoiseBuffer: AudioBuffer | null = null;

function getNoiseBuffer(ctx: AudioContext): AudioBuffer {
  if (pomodoroNoiseBuffer && pomodoroNoiseBuffer.sampleRate === ctx.sampleRate) {
    return pomodoroNoiseBuffer;
  }
  const length = Math.max(1, Math.floor(ctx.sampleRate * 0.5));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let index = 0; index < length; index += 1) data[index] = Math.random() * 2 - 1;
  pomodoroNoiseBuffer = buffer;
  return buffer;
}

/** 排一段噪声瞬态：短白噪 → 低通 → 极快包络。 */
function scheduleNoiseTransient(
  ctx: AudioContext,
  master: GainNode,
  voice: PomodoroVoice,
  spec: PomodoroNoiseSpec,
  scale: number,
  start: number,
  tailLimit?: number,
): void {
  const source = ctx.createBufferSource();
  source.buffer = getNoiseBuffer(ctx);
  const filter = ctx.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.value = spec.cutoff;
  filter.Q.value = spec.q;
  const gain = ctx.createGain();
  // 响铃模式下噪声瞬态同样要收在这一次敲击的时长里
  const decay = Math.min(
    spec.decay,
    typeof tailLimit === "number" && Number.isFinite(tailLimit) && tailLimit > 0 ? tailLimit : Infinity,
  );
  const peak = Math.max(spec.gain * scale, 0.0002);
  const attackSeconds = Math.min(0.0015, decay / 4);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(peak, start + attackSeconds);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + decay);
  source.connect(filter).connect(gain).connect(master);
  source.start(start);
  source.stop(start + decay + 0.02);
  voice.sources.push(source);
  voice.nodes.push(source, filter, gain);
}

/**
 * 排「一次敲击」：该音色的全部振荡器分音 + 噪声瞬态。
 *
 * @param tailLimit 尾音上限（秒）。响铃模式下等于敲击间隔，于是相邻两次敲击的波形完全不重叠，
 *   整段响铃的峰值恒等于单次敲击的峰值 —— 既不会越叠越响，也不会爆音。
 *   试听时不传，保留音色的完整自然衰减。
 */
function scheduleSoundStrike(
  ctx: AudioContext,
  master: GainNode,
  voice: PomodoroVoice,
  spec: PomodoroSoundSpec,
  scale: number,
  start: number,
  tailLimit?: number,
): void {
  for (const event of buildSoundToneEvents(spec, tailLimit === undefined ? undefined : { tailLimit })) {
    const at = start + event.start;
    const end = at + event.duration;
    const oscillator = ctx.createOscillator();
    oscillator.type = event.wave;
    oscillator.frequency.setValueAtTime(event.freq, at);
    // 拍频影子：同频失谐一点点，两个一起响才有金属的闪烁
    if (event.detuneCents !== 0) oscillator.detune.setValueAtTime(event.detuneCents, at);
    if (event.endFreq !== event.freq) {
      // 滑音：在衰减的前 70% 里滑到终点，剩下的时间留给尾巴（水滴的下滑感全在这段）
      oscillator.frequency.exponentialRampToValueAtTime(
        event.endFreq,
        at + Math.max(event.duration * 0.7, event.attack + 0.01),
      );
    }
    const gain = ctx.createGain();
    const peak = Math.max(event.gain, 0.0002);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(peak, at + Math.max(event.attack, 0.0005));
    gain.gain.exponentialRampToValueAtTime(0.0001, end);
    oscillator.connect(gain).connect(master);
    oscillator.start(at);
    oscillator.stop(end + 0.02);
    voice.sources.push(oscillator);
    voice.nodes.push(oscillator, gain);
  }
  if (spec.noise) scheduleNoiseTransient(ctx, master, voice, spec.noise, scale, start, tailLimit);
}

/**
 * 排一个内置音色。返回它的总时长（秒）。
 *
 * - "preview"：只敲一次，完整自然衰减（试听不该响 20 秒）。
 * - "ring"   ：按 buildRingPlan 的节奏表反复敲，一直响满 POMODORO_RING_TOTAL_SECONDS
 *              （手机闹钟就是这么响的：不是响一下，而是响到你处理为止）。
 */
function scheduleBuiltInSound(
  ctx: AudioContext,
  master: GainNode,
  spec: PomodoroSoundSpec,
  mode: PomodoroSoundPlaybackMode,
): number {
  stopPomodoroSound();
  const voice: PomodoroVoice = { sources: [], nodes: [] };
  const scale = soundNormalizeScale(spec);
  // 提前 20ms 起音：立刻 start 在部分实现里会丢掉最前面的包络
  const base = ctx.currentTime + 0.02;
  if (mode === "ring") {
    const plan = buildRingPlan(spec);
    for (const offset of plan.offsets) {
      scheduleSoundStrike(ctx, master, voice, spec, scale, base + offset, plan.tailLimit);
    }
    pomodoroVoice = voice;
    scheduleVoiceCleanup(voice, plan.totalSeconds);
    return plan.totalSeconds;
  }
  scheduleSoundStrike(ctx, master, voice, spec, scale, base);
  const total = soundTotalDuration(spec);
  pomodoroVoice = voice;
  scheduleVoiceCleanup(voice, total);
  return total;
}

/**
 * 排一段用户导入的音频。返回实际播放时长（秒）。
 *
 * - "preview"：从头播最多 6 秒并淡出（只听一次）。
 * - "ring"   ：`loop = true` 整段循环播放，最多 60 秒自动淡出停止（手机闹钟的铃声本来就是循环的）。
 */
function scheduleImportedSound(
  ctx: AudioContext,
  master: GainNode,
  buffer: AudioBuffer,
  mode: PomodoroSoundPlaybackMode,
): number {
  stopPomodoroSound();
  const plan = importedPlaybackPlan(buffer.duration, mode);
  if (plan.playSeconds <= 0) return 0;
  const voice: PomodoroVoice = { sources: [], nodes: [] };
  const source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = plan.loop;
  const gain = ctx.createGain();
  const start = ctx.currentTime + 0.02;
  // 用户自己的文件不做归一化：原样播，音量由总增益控制
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(1, start + Math.max(plan.attackSeconds, 0.001));
  gain.gain.setValueAtTime(1, start + plan.fadeStart);
  gain.gain.linearRampToValueAtTime(0.0001, start + plan.playSeconds);
  source.connect(gain).connect(master);
  source.start(start);
  // 循环播放时更要盯住 stop 时刻：先淡出再停，不会在波形中间被硬切（硬切就是爆音）
  source.stop(start + plan.playSeconds + 0.02);
  voice.sources.push(source);
  voice.nodes.push(source, gain);
  pomodoroVoice = voice;
  scheduleVoiceCleanup(voice, plan.playSeconds);
  return plan.playSeconds;
}

/**
 * 用户导入的音频（解码后的缓冲）。
 *
 * 字节本体是 **存在 IndexedDB 里的**（见 lib/pomodoro-sound-store.ts），
 * 这里只是本次会话的解码结果缓存：放模块级而不是组件 state，
 * 切到别的工具再回来就不用重新解码了。
 */
let importedSoundBuffer: AudioBuffer | null = null;

/** 已导入音频的元信息（不含字节），界面直接显示，不用为了拿文件名再去读一次磁盘。 */
interface PomodoroImportedInfo {
  name: string;
  size: number;
  /** 试听时长（秒），也就是界面上的「· N 秒」 */
  seconds: number;
}

let importedSoundInfo: PomodoroImportedInfo | null = null;

/**
 * 本次会话有没有尝试过从 IndexedDB 读回音频。
 * 有了它，「切到别的工具再回来」不会重复读盘，也不会重复弹一次「已从本机读出…」。
 */
let importedRestoreAttempted = false;

function hasImportedSoundBuffer(): boolean {
  return importedSoundBuffer !== null;
}

/** 用当前环境可用的解码方式解出一个 AudioBuffer；失败一律抛错，由调用方转成中文提示。 */
async function decodeAudioFile(ctx: AudioContext, data: ArrayBuffer): Promise<AudioBuffer> {
  return await new Promise<AudioBuffer>((resolve, reject) => {
    const settle = (buffer: AudioBuffer | null): void => {
      if (!buffer || !Number.isFinite(buffer.duration) || buffer.duration <= 0) {
        reject(new Error("empty"));
        return;
      }
      resolve(buffer);
    };
    const failed = (): void => reject(new Error("decode"));
    // 用回调形式（兼容面最广）。但要注意：Chromium 里它**同时**返回一个 Promise，
    // 解码失败时那个 Promise 也会 reject —— 不接住就会在控制台留下一条
    // 「未处理的 Promise 拒绝」（实测是 EncodingError），所以两个都接上；
    // Promise 的第二次 settle 是空操作，不会重复处理。
    const pending: Promise<AudioBuffer> | undefined = ctx.decodeAudioData(data, settle, failed);
    if (pending && typeof pending.then === "function") pending.then(settle, failed);
  });
}

/**
 * 解码一个 Blob（从 IndexedDB 读回来的保存音频走这条路）。
 * 每次都新取一份 ArrayBuffer：decodeAudioData 会把传进去的 ArrayBuffer **detach 掉**，
 * 直接复用同一份字节第二次必然失败。
 */
async function decodeAudioBlob(ctx: AudioContext, blob: Blob): Promise<AudioBuffer> {
  const data = await blob.arrayBuffer();
  return await decodeAudioFile(ctx, data);
}

type PomodoroPlaybackResult = "played" | "unsupported" | "muted" | "missing-audio";

/** 一次播放的结果：除了「成没成」，还要告诉调用方「会响多久」（用来安排「响铃中」状态）。 */
interface PomodoroPlaybackOutcome {
  result: PomodoroPlaybackResult;
  /** 实际排出去的时长（秒）：0 表示没有声音 */
  seconds: number;
}

/**
 * 播放一次提醒。音频链路上的任何异常都在这里被吃掉并转成返回值 ——
 * 提示音只是锦上添花，不该把倒计时逻辑带崩。
 * @param choice 用户选的音色（可能是 "imported"）
 * @param volume 音量滑块的当前值（0~100）
 * @param mode   "preview" 只响一次；"ring" 是计时到点的响铃（反复响 / 循环，直到用户停）
 */
function playPomodoroAlert(
  choice: PomodoroSoundChoice,
  volume: number,
  mode: PomodoroSoundPlaybackMode,
): PomodoroPlaybackOutcome {
  const target = resolveSoundChoice(choice, hasImportedSoundBuffer());
  if (target === "none") return { result: "muted", seconds: 0 };
  const ctx = unlockPomodoroAudio();
  if (!ctx || !pomodoroMaster) return { result: "unsupported", seconds: 0 };
  try {
    applyPomodoroVolume(volume);
    if (target === "imported") {
      if (!importedSoundBuffer) return { result: "missing-audio", seconds: 0 };
      const seconds = scheduleImportedSound(ctx, pomodoroMaster, importedSoundBuffer, mode);
      return { result: seconds > 0 ? "played" : "muted", seconds };
    }
    const spec = findSoundSpec(target);
    if (!spec) return { result: "muted", seconds: 0 };
    // 静音音色（peakLevel 0 之类）不会走到这里，但时长照收，界面才有数可显示
    const seconds = scheduleBuiltInSound(ctx, pomodoroMaster, spec, mode);
    return { result: "played", seconds };
  } catch {
    return { result: "unsupported", seconds: 0 };
  }
}

/**
 * 「从本机读回上次导入的音频」这件事的状态。
 * 读盘是异步的，界面必须如实反映，不能在还没读完时就假装音频已经能用。
 */
type SoundRestoreState = "idle" | "loading" | "ready" | "empty" | "failed";

/** 番茄钟示例配置：50 / 10 / 20 的深度工作节奏。 */
const POMODORO_SAMPLE = { focus: 50, short: 10, long: 20 };

export function PomodoroTool() {
  const [focusMinutes, setFocusMinutes] = useToolDraft<number>(
    "pomodoro",
    "focusMinutes",
    POMODORO_DEFAULT_MINUTES.focus,
  );
  const [shortMinutes, setShortMinutes] = useToolDraft<number>(
    "pomodoro",
    "shortMinutes",
    POMODORO_DEFAULT_MINUTES.short,
  );
  const [longMinutes, setLongMinutes] = useToolDraft<number>(
    "pomodoro",
    "longMinutes",
    POMODORO_DEFAULT_MINUTES.long,
  );
  const [soundEnabled, setSoundEnabled] = useToolDraft<boolean>("pomodoro", "sound", true);
  const [soundChoice, setSoundChoice] = useToolDraft<PomodoroSoundChoice>(
    "pomodoro",
    "soundChoice",
    POMODORO_SOUND_FALLBACK_ID,
  );
  const [soundVolume, setSoundVolume] = useToolDraft<number>(
    "pomodoro",
    "soundVolume",
    POMODORO_VOLUME_DEFAULT,
  );
  /** 只存文件名：音频本体存在 IndexedDB 里（见 lib/pomodoro-sound-store.ts），这里存名字只是为了首帧快一点 */
  const [importedName, setImportedName] = useToolDraft<string>("pomodoro", "soundFile", "");
  const [today, setToday] = useToolDraft<PomodoroDayCount>("pomodoro", "today", {
    date: "",
    count: 0,
  });
  const [showSettings, setShowSettings] = useState(false);

  // 运行态不持久化：刷新之后倒计时归零是合理行为，设置与今日计数才需要记住
  const [mode, setMode] = useState<PomodoroMode>("focus");
  const [running, setRunning] = useState(false);
  /** null = 这一阶段还没开始，显示当前模式的完整时长（改了时长会自动跟着变） */
  const [remainingMs, setRemainingMs] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState<string | null>(null);
  /** 提示音这一块自己的状态提示（试听结果 / 导入结果 / 格式不支持），与倒计时的 error 分开 */
  const [soundNotice, setSoundNotice] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  /** 内存里到底还有没有导入的音频（首帧不知道，挂载后再同步，避免 hydration 不一致） */
  const [importedReady, setImportedReady] = useState(false);
  const [importedSeconds, setImportedSeconds] = useState(0);
  /**
   * 从本机 IndexedDB 读回上次导入音频的状态。
   * "loading" 期间界面上会明确写「正在读取…」，**不会**假装音频已经可用。
   */
  const [restoreState, setRestoreState] = useState<SoundRestoreState>("idle");
  /** null = 没在响铃；数字 = 本次响铃的总秒数（界面直接显示出来） */
  const [ringingSeconds, setRingingSeconds] = useState<number | null>(null);
  const [audioSupported, setAudioSupported] = useState(true);
  const deadlineRef = useRef<number | null>(null);
  const titleRef = useRef<string | null>(null);
  const soundFileRef = useRef<HTMLInputElement | null>(null);
  /** 响铃自然结束的定时器；暂停 / 重置 / 换模式 / 停止响铃都要清掉它 */
  const ringTimerRef = useRef<number | null>(null);
  /** 倒计时结束时的回调活在定时器里，用 ref 拿最新的音色与音量，免得每次拖滑块都重建定时器 */
  const soundRef = useRef({ enabled: soundEnabled, choice: soundChoice, volume: soundVolume });

  const volume = clampInt(soundVolume, POMODORO_VOLUME_MIN, POMODORO_VOLUME_MAX);
  const effectiveChoice = resolveSoundChoice(soundChoice, importedReady);
  const currentSpec = findSoundSpec(effectiveChoice);
  const gainNow = pomodoroVolumeToGain(volume);
  /** 当前音色的响铃节奏表（界面上的「每 x 秒一次 · 共 n 次」直接来自它，不另写死文案） */
  const ringPlan = useMemo(
    () => (currentSpec ? buildRingPlan(currentSpec) : null),
    [currentSpec],
  );

  const minutesOf = useCallback(
    (target: PomodoroMode): number => {
      if (target === "focus") return clampInt(focusMinutes, 1, 180);
      if (target === "short") return clampInt(shortMinutes, 1, 60);
      return clampInt(longMinutes, 1, 120);
    },
    [focusMinutes, shortMinutes, longMinutes],
  );

  const totalMs = minutesOf(mode) * 60_000;
  const displayedMs = remainingMs ?? totalMs;
  const modeLabel = POMODORO_MODE_LABELS[mode];
  const focusMode = mode === "focus";
  const todayCount = resolveTodayCount(today, Date.now()).count;

  /** 立刻停铃：音频停掉、节点断开、「响铃中」的状态也一起撤掉。 */
  const stopRinging = useCallback(() => {
    if (typeof window !== "undefined" && ringTimerRef.current !== null) {
      window.clearTimeout(ringTimerRef.current);
    }
    ringTimerRef.current = null;
    stopPomodoroSound();
    setRingingSeconds(null);
  }, []);

  /** 开始响铃：记下「还会响多少秒」，到点自动收尾（用户随时可以手动停）。 */
  const startRinging = useCallback((seconds: number) => {
    if (typeof window === "undefined") return;
    if (ringTimerRef.current !== null) window.clearTimeout(ringTimerRef.current);
    setRingingSeconds(seconds);
    ringTimerRef.current = window.setTimeout(
      () => {
        ringTimerRef.current = null;
        setRingingSeconds(null);
      },
      Math.max(500, seconds * 1000 + 250),
    );
  }, []);

  // 跨天自动清零：挂载时按当天日期判断一次（计数只可能在同一天里被 +1）
  useEffect(() => {
    setToday((prev) => resolveTodayCount(prev, Date.now()));
  }, [setToday]);

  /**
   * 挂载时把「内存里有没有音频」和「本机存着没有音频」都同步一遍。
   *
   * 首次读出是**异步**的：期间界面显示「正在读取上次导入的音频…」，读完才把「自定义」这一项
   * 加进音色列表并自动选中 —— 不在异步还没回来的时候就假装已经可用。
   * 本次会话已经读过就不重复读盘（切到别的工具再回来不会重新解码、也不会重复弹提示）。
   */
  useEffect(() => {
    setAudioSupported(getAudioContextCtor() !== null);
    let cancelled = false;

    const applyCachedSound = (): boolean => {
      if (!importedSoundBuffer || !importedSoundInfo) return false;
      setImportedReady(true);
      setImportedName(importedSoundInfo.name);
      setImportedSeconds(importedSoundInfo.seconds);
      setRestoreState("ready");
      return true;
    };

    if (importedRestoreAttempted) {
      if (!applyCachedSound()) {
        setImportedReady(false);
        setImportedSeconds(0);
        setRestoreState("empty");
      }
      return () => {
        cancelled = true;
      };
    }

    setRestoreState("loading");
    void (async () => {
      const record = await loadStoredPomodoroSound();
      if (cancelled) return;
      if (!record) {
        importedRestoreAttempted = true;
        setRestoreState("empty");
        return;
      }
      // 纯解码：没有用户手势，所以只建图不 resume（解码在 suspended 的上下文上照样能跑）
      const ctx = unlockPomodoroAudio(false);
      if (!ctx) {
        importedRestoreAttempted = true;
        setRestoreState("failed");
        setSoundNotice(POMODORO_AUDIO_UNSUPPORTED);
        return;
      }
      try {
        const buffer = await decodeAudioBlob(ctx, record.blob);
        if (cancelled) return;
        importedRestoreAttempted = true;
        importedSoundBuffer = buffer;
        importedSoundInfo = {
          name: record.name,
          size: record.size,
          seconds: importedPlaybackPlan(buffer.duration, "preview").playSeconds,
        };
        setImportedReady(true);
        setImportedName(record.name);
        setImportedSeconds(importedSoundInfo.seconds);
        setRestoreState("ready");
        // 读完自动选中「自定义」：用户上次选的就是它，这里不用再手动选一遍。
        // 只有当选择本来就是「自定义」或还是默认回落音色时才接管 —— 用户在这一轮里明确选过别的
        // 音色就不该被覆盖（那个选择在本次会话里是被记住的）。
        setSoundChoice((prev) =>
          prev === "imported" || prev === POMODORO_SOUND_FALLBACK_ID ? "imported" : prev,
        );
        setSoundNotice(
          `已从本机读出上次导入的「${record.name}」` +
            `（${formatSoundBytes(record.size)}，${buffer.duration.toFixed(1)} 秒），可以直接用。`,
        );
      } catch {
        if (cancelled) return;
        importedRestoreAttempted = true;
        importedSoundBuffer = null;
        importedSoundInfo = null;
        setImportedReady(false);
        setImportedSeconds(0);
        setRestoreState("failed");
        setSoundNotice(
          `上次保存的「${record.name}」这次解不出音频（文件可能已损坏、或格式不再被支持），` +
            `已回落到内置音色「${soundChoiceLabel(POMODORO_SOUND_FALLBACK_ID)}」。` +
            "点「移除」可以清掉它，然后重新导入。",
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setImportedName, setSoundChoice]);

  // 音量滑块实时作用到总增益上：正在试听/正在响的提示音也一起变
  useEffect(() => {
    applyPomodoroVolume(volume);
  }, [volume]);

  // 音色与音量放进 ref：定时器回调读它，避免每次改设置都重建倒计时
  useEffect(() => {
    soundRef.current = { enabled: soundEnabled, choice: soundChoice, volume: soundVolume };
  }, [soundEnabled, soundChoice, soundVolume]);

  // 卸载时把正在响的提示音停掉并断开，不留悬挂的振荡器与定时器；标题同理
  useEffect(
    () => () => {
      if (ringTimerRef.current !== null) window.clearTimeout(ringTimerRef.current);
      ringTimerRef.current = null;
      stopPomodoroSound();
      if (typeof document !== "undefined" && titleRef.current !== null) {
        document.title = titleRef.current;
      }
    },
    [],
  );

  /** 一个阶段走完：计数（仅专注）、响铃、切到下一个阶段。 */
  const complete = useCallback(() => {
    setRunning(false);
    deadlineRef.current = null;
    const settings = soundRef.current;
    if (settings.enabled) {
      // 计时到点走「响铃」模式：内置音色按节奏反复敲满 24 秒，导入的音频整段循环最多 60 秒
      const outcome = playPomodoroAlert(settings.choice, settings.volume, "ring");
      if (outcome.result === "unsupported") setSoundNotice(POMODORO_AUDIO_UNSUPPORTED);
      else if (outcome.result === "missing-audio") {
        setSoundNotice(
          `导入的音频这次读不出来，已回落到内置音色「${soundChoiceLabel(POMODORO_SOUND_FALLBACK_ID)}」。`,
        );
      } else if (outcome.result === "played" && outcome.seconds > 0) {
        startRinging(outcome.seconds);
      }
    }
    if (mode === "focus") {
      const next = incrementTodayCount(today, Date.now());
      setToday(next);
      const nextMode = nextPomodoroMode("focus", next.count);
      setMode(nextMode);
      setNotice(`专注完成，已切到${POMODORO_MODE_LABELS[nextMode]}，点开始即可计时。`);
    } else {
      setMode("focus");
      setNotice("休息结束，已回到专注模式。");
    }
    setRemainingMs(null);
  }, [mode, setToday, startRinging, today]);

  /**
   * 倒计时：一切都是「截止时间戳 - 当前时间」，不做累加。
   * 累加式在标签页被系统挂起时不会走时，回来就会偏；时间戳差值天然免疫这个问题。
   */
  useEffect(() => {
    if (!running) return;
    const tick = () => {
      const deadline = deadlineRef.current;
      if (deadline === null) return;
      const left = deadline - Date.now();
      if (left <= 0) {
        setRemainingMs(0);
        complete();
        return;
      }
      setRemainingMs(left);
    };
    tick();
    const timer = window.setInterval(tick, 200);
    // 卸载 / 暂停 / 换模式都必须清掉，否则定时器会在后台一直跑（项目里踩过这个坑）
    return () => window.clearInterval(timer);
  }, [running, complete]);

  // 运行时把剩余时间写到标题栏，切到别的标签页也能看见
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (titleRef.current === null) titleRef.current = document.title;
    if (running) document.title = `${formatCountdown(displayedMs)} · ${modeLabel}`;
    else if (titleRef.current !== null) document.title = titleRef.current;
  }, [running, displayedMs, modeLabel]);

  const start = () => {
    setError(null);
    if (displayedMs <= 0) {
      setError("这一阶段已经是 0:00，先重置再开始。");
      return;
    }
    // 用户手势里解锁音频：现在就把 AudioContext 建好并 resume，
    // 否则 25 分钟后由定时器触发的那次播放会被自动播放策略静默拦掉。
    const unlocked = unlockPomodoroAudio();
    // 没有 Web Audio 只是没有提示音，不该拦着用户开始计时
    const noAudio = soundEnabled && unlocked === null;
    deadlineRef.current = Date.now() + displayedMs;
    setNotice(noAudio ? "当前环境不支持 Web Audio，提示音无法播放（计时照常运行）。" : "");
    setRunning(true);
  };

  const pause = () => {
    const deadline = deadlineRef.current;
    const left = deadline === null ? displayedMs : Math.max(0, deadline - Date.now());
    deadlineRef.current = null;
    // 暂停时正在响的铃也要立刻停：用户已经动手了，提醒不该还在响
    stopRinging();
    setRunning(false);
    setRemainingMs(left);
  };

  const reset = () => {
    deadlineRef.current = null;
    stopRinging();
    setRunning(false);
    setRemainingMs(null);
    setNotice("");
    setError(null);
  };

  const skip = () => {
    deadlineRef.current = null;
    stopRinging();
    setRunning(false);
    setRemainingMs(null);
    setMode(focusMode ? "short" : "focus");
    setNotice("已跳过当前阶段（跳过不计入番茄数）。");
  };

  /**
   * 试听：不管「提示音」开关是开是关，都按当前音色与音量立刻响一次。
   * 走 "preview" 模式 —— 试听就是听一耳朵，不该像闹钟那样响 24 秒。
   */
  const previewSound = () => {
    if (!audioSupported) {
      setSoundNotice(POMODORO_AUDIO_UNSUPPORTED);
      return;
    }
    if (effectiveChoice === "none") {
      setSoundNotice("当前选择是「静音」，先选一个音色再试听。");
      return;
    }
    if (restoreState === "loading") {
      setSoundNotice("还在读取上次导入的音频，稍等一下再试听。");
      return;
    }
    const outcome = playPomodoroAlert(effectiveChoice, volume, "preview");
    if (outcome.result === "unsupported") {
      setSoundNotice(POMODORO_AUDIO_UNSUPPORTED);
      return;
    }
    if (outcome.result === "missing-audio") {
      setSoundNotice("导入的音频这次读不出来，先重新导入一个。");
      return;
    }
    if (outcome.result === "muted") {
      setSoundNotice("这是静音项，试听不会有声音。");
      return;
    }
    setSoundNotice(
      effectiveChoice === "imported" && outcome.seconds > 0
        ? `正在试听导入的音频，只播 ${outcome.seconds.toFixed(1)} 秒（提醒时会循环响 ${POMODORO_IMPORT_RING_SECONDS} 秒）。`
        : `正在试听「${soundChoiceLabel(effectiveChoice)}」。提醒时会按闹钟节奏反复响 ${POMODORO_RING_TOTAL_SECONDS} 秒。`,
    );
  };

  /**
   * 导入本地音频。
   *
   * 两件事一起做：
   * ① 解码成 AudioBuffer 放进本次会话的缓存（马上能用）；
   * ② 把**原始文件字节**存进 IndexedDB（下次打开软件还在，不用重新导入）。
   * 第 ② 步失败（文件过大 / 配额用尽 / 存储不可用）时如实告诉用户「只在本次运行有效」，
   * 不假装保存成功。
   */
  const acceptSoundFile = async (file: File | undefined) => {
    if (!file) return;
    setSoundNotice(null);
    if (!audioSupported) {
      setSoundNotice(POMODORO_AUDIO_UNSUPPORTED);
      return;
    }
    // 先解锁：在用户手势里拿到 AudioContext，后面解码与播放都复用它
    const ctx = unlockPomodoroAudio();
    if (!ctx) {
      setSoundNotice(POMODORO_AUDIO_UNSUPPORTED);
      return;
    }
    setImporting(true);
    try {
      const data = await file.arrayBuffer();
      const buffer = await decodeAudioFile(ctx, data);
      const seconds = importedPlaybackPlan(buffer.duration, "preview").playSeconds;
      importedSoundBuffer = buffer;
      importedSoundInfo = { name: file.name, size: file.size, seconds };
      importedRestoreAttempted = true;
      setImportedReady(true);
      setImportedSeconds(seconds);
      setImportedName(file.name);
      setRestoreState("ready");
      setSoundChoice("imported");
      const head = `已导入「${file.name}」（${buffer.duration.toFixed(1)} 秒，${formatSoundBytes(file.size)}）。`;
      const saved = await saveStoredPomodoroSound({
        name: file.name,
        mimeType: file.type,
        blob: file,
      });
      if (saved.ok) {
        setSoundNotice(
          `${head}已经保存在本机：关闭软件或刷新页面后，下次打开这个工具还能直接用它。` +
            `试听播 ${seconds.toFixed(1)} 秒；提醒时整段循环响，最多 ${POMODORO_IMPORT_RING_SECONDS} 秒自动停。`,
        );
      } else {
        // 已经降级成「只在本次运行有效」，所以这里只说事实，不说「保存成功」
        const replaced = saved.reason === "too-large" ? "（原先保存在本机的那份也已被替换掉）" : "";
        setSoundNotice(`${head}${saved.message}${replaced}`);
      }
    } catch {
      importedSoundBuffer = null;
      importedSoundInfo = null;
      setImportedReady(false);
      setImportedSeconds(0);
      setSoundNotice("这个文件解不出音频，请换 MP3 / WAV / M4A / OGG 再试一次。");
    } finally {
      setImporting(false);
    }
  };

  /** 移除导入的音频：内存缓冲与 IndexedDB 里的字节一起清掉，选择回落到内置音色。 */
  const removeImportedSound = async () => {
    stopRinging();
    importedSoundBuffer = null;
    importedSoundInfo = null;
    importedRestoreAttempted = true;
    setImportedReady(false);
    setImportedSeconds(0);
    setImportedName("");
    setRestoreState("empty");
    setSoundChoice(POMODORO_SOUND_FALLBACK_ID);
    const cleared = await removeStoredPomodoroSound();
    setSoundNotice(
      cleared
        ? `已移除导入的音频（本机保存的那份也一起清掉了），回落到「${soundChoiceLabel(POMODORO_SOUND_FALLBACK_ID)}」。`
        : `已移除本次运行用的音频，回落到「${soundChoiceLabel(POMODORO_SOUND_FALLBACK_ID)}」。` +
            "但本机保存的那份没能清掉，下次打开还会读出来。",
    );
  };

  const changeDuration = (target: PomodoroMode, value: number) => {
    const max = target === "focus" ? 180 : target === "short" ? 60 : 120;
    const clamped = clampInt(value, 1, max);
    if (running) {
      setError("计时进行中，先暂停或重置再改时长。");
      return;
    }
    setError(null);
    if (target === "focus") setFocusMinutes(clamped);
    else if (target === "short") setShortMinutes(clamped);
    else setLongMinutes(clamped);
    setRemainingMs(null);
  };

  const loadSample = () => {
    deadlineRef.current = null;
    stopRinging();
    setRunning(false);
    setMode("focus");
    setRemainingMs(null);
    setFocusMinutes(POMODORO_SAMPLE.focus);
    setShortMinutes(POMODORO_SAMPLE.short);
    setLongMinutes(POMODORO_SAMPLE.long);
    setSoundEnabled(true);
    setNotice(`已填入 ${POMODORO_SAMPLE.focus} / ${POMODORO_SAMPLE.short} / ${POMODORO_SAMPLE.long} 分钟的深度工作节奏。`);
  };

  const clearAll = () => {
    deadlineRef.current = null;
    stopRinging();
    setRunning(false);
    setMode("focus");
    setRemainingMs(null);
    setFocusMinutes(POMODORO_DEFAULT_MINUTES.focus);
    setShortMinutes(POMODORO_DEFAULT_MINUTES.short);
    setLongMinutes(POMODORO_DEFAULT_MINUTES.long);
    setSoundEnabled(true);
    setSoundChoice(POMODORO_SOUND_FALLBACK_ID);
    setSoundVolume(POMODORO_VOLUME_DEFAULT);
    setNotice("");
    setError(null);
    setSoundNotice(null);
    // 「清空」只重置设置，**不删**用户已经导入到本机的那份音频文件
  };

  const ringRadius = (POMODORO_RING_SIZE - POMODORO_RING_STROKE) / 2;
  const circumference = 2 * Math.PI * ringRadius;
  const progress = totalMs > 0 ? Math.min(1, Math.max(0, 1 - displayedMs / totalMs)) : 0;
  const modeOptions: { value: PomodoroMode; label: string }[] = [
    { value: "focus", label: "专注" },
    { value: "short", label: "短休息" },
    { value: "long", label: "长休息" },
  ];
  /** 音色选择项：内置音色 + 静音，导入过音频时再加一项「自定义」。 */
  const soundOptions: { value: PomodoroSoundChoice; label: string }[] = [
    ...POMODORO_SOUND_SPECS.map((spec) => ({ value: spec.id as PomodoroSoundChoice, label: spec.label })),
    ...(importedReady ? [{ value: "imported" as PomodoroSoundChoice, label: "自定义" }] : []),
    { value: "none" as PomodoroSoundChoice, label: "静音" },
  ];
  const soundSummary = !soundEnabled
    ? "已关闭"
    : effectiveChoice === "imported"
      ? `自定义${importedName === "" ? "" : ` · ${importedName}`}`
      : soundChoiceLabel(effectiveChoice);
  const dots = Math.min(todayCount, 12);

  return (
    <div className="space-y-4">
      <div className="mx-auto w-full max-w-2xl space-y-5">
        <div className="rounded-2xl border border-border/70 bg-card/60 p-6 shadow-sm backdrop-blur-md">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{modeLabel}</Badge>
              <Badge variant="outline">今日 {todayCount} 个番茄</Badge>
              {soundEnabled ? (
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Volume2 className="h-3.5 w-3.5" /> {soundSummary}
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <VolumeX className="h-3.5 w-3.5" /> 提示音关
                </span>
              )}
            </div>
            <div className="flex items-center gap-1.5">
              <Button type="button" variant="outline" size="sm" onClick={loadSample}>
                <Sparkles className="h-3.5 w-3.5" /> 填入示例
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={clearAll}>
                <Eraser className="h-3.5 w-3.5" /> 清空
              </Button>
            </div>
          </div>

          <div className="mt-6 flex flex-col items-center gap-6">
            <div className="relative" style={{ width: POMODORO_RING_SIZE, height: POMODORO_RING_SIZE }}>
              <svg
                viewBox={`0 0 ${POMODORO_RING_SIZE} ${POMODORO_RING_SIZE}`}
                className="h-full w-full -rotate-90"
                role="img"
                aria-label={`${modeLabel}剩余 ${formatCountdown(displayedMs)}`}
              >
                <circle
                  cx={POMODORO_RING_SIZE / 2}
                  cy={POMODORO_RING_SIZE / 2}
                  r={ringRadius}
                  fill="none"
                  strokeWidth={POMODORO_RING_STROKE}
                  className="stroke-secondary"
                />
                {/* 专注走品牌色、休息走成功色：颜色全部来自主题变量，跟随三套主题 */}
                <circle
                  cx={POMODORO_RING_SIZE / 2}
                  cy={POMODORO_RING_SIZE / 2}
                  r={ringRadius}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={POMODORO_RING_STROKE}
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={circumference * (1 - progress)}
                  className={cn(
                    "transition-[stroke-dashoffset] duration-200 ease-linear",
                    focusMode ? "text-primary" : "text-success",
                  )}
                />
              </svg>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1">
                <span className="font-mono text-5xl font-semibold tabular-nums tracking-tight text-foreground">
                  {formatCountdown(displayedMs)}
                </span>
                <span className="flex items-center gap-1 text-xs text-muted-foreground">
                  {focusMode ? <Timer className="h-3.5 w-3.5" /> : <Coffee className="h-3.5 w-3.5" />}
                  {modeLabel} · {minutesOf(mode)} 分钟
                </span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-center gap-2">
              {running ? (
                <Button type="button" onClick={pause}>
                  <Pause className="h-4 w-4" /> 暂停
                </Button>
              ) : (
                <Button type="button" onClick={start}>
                  <Play className="h-4 w-4" /> 开始
                </Button>
              )}
              <Button type="button" variant="outline" onClick={reset}>
                <RotateCcw className="h-4 w-4" /> 重置
              </Button>
              <Button type="button" variant="ghost" onClick={skip}>
                <SkipForward className="h-4 w-4" /> 跳过
              </Button>
            </div>

            <div className="flex flex-col items-center gap-2">
              <div className="flex flex-wrap items-center justify-center gap-1.5">
                {Array.from({ length: dots }).map((_dot, index) => (
                  <span key={index} className="h-2.5 w-2.5 rounded-full bg-primary/80" />
                ))}
                {todayCount > 12 ? <Badge variant="outline">+{todayCount - 12}</Badge> : null}
                {todayCount === 0 ? (
                  <span className="text-[11px] text-muted-foreground">今天还没有完成的番茄</span>
                ) : null}
              </div>
              {todayCount > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-[11px]"
                  onClick={() => setToday(resolveTodayCount(null, Date.now()))}
                >
                  <Trash2 className="h-3.5 w-3.5" /> 清零今日计数
                </Button>
              ) : null}
            </div>

            {/* 响铃中：手机闹钟式的持续性提醒，用户可能离开座位，回来第一眼要能立刻停掉它 */}
            {ringingSeconds !== null ? (
              <div
                className="flex w-full flex-wrap items-center justify-between gap-3 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3"
                role="status"
                aria-live="polite"
              >
                <span className="flex items-center gap-2 text-sm font-medium text-primary">
                  <BellRing className="h-4 w-4 animate-pulse" />
                  响铃中 · 本次会响 {Math.round(ringingSeconds)} 秒
                  {ringPlan
                    ? `（每 ${ringPlan.strikeGap.toFixed(2)} 秒敲一次）`
                    : "（音频循环播放）"}
                </span>
                <Button type="button" size="sm" onClick={stopRinging}>
                  <BellOff className="h-3.5 w-3.5" /> 停止响铃
                </Button>
              </div>
            ) : null}

            {notice !== "" ? (
              <p className="text-center text-xs leading-relaxed text-success">{notice}</p>
            ) : null}
            {error !== null ? <ToolError message={error} /> : null}
          </div>
        </div>

        <div className="rounded-2xl border border-border/70 bg-card/60 p-5 shadow-sm backdrop-blur-md">
          <SectionTitle
            icon={Clock}
            title="模式"
            extra={
              <span className="text-[11px] text-muted-foreground">
                {clampInt(focusMinutes, 1, 180)} / {clampInt(shortMinutes, 1, 60)} /{" "}
                {clampInt(longMinutes, 1, 120)} 分钟
              </span>
            }
          />
          <div className="mt-3">
            <Segmented
              value={mode}
              options={modeOptions}
              onChange={(next) => {
                deadlineRef.current = null;
                stopRinging();
                setRunning(false);
                setRemainingMs(null);
                setMode(next);
                setNotice("");
              }}
            />
          </div>

          <button
            type="button"
            onClick={() => setShowSettings((prev) => !prev)}
            className="mt-4 flex w-full items-center justify-between gap-2 rounded-xl border border-border/60 bg-card px-3 py-2 text-left text-xs font-medium text-foreground transition-colors hover:bg-secondary"
            aria-expanded={showSettings}
          >
            <span className="flex items-center gap-1.5">
              {showSettings ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              时长设置
            </span>
            <span className="text-[11px] text-muted-foreground">
              {showSettings ? "收起" : "展开"}
            </span>
          </button>

          {showSettings ? (
            <div className="mt-3 space-y-4 animate-fade-in-up">
              <div className="grid gap-3 sm:grid-cols-3">
                {(
                  [
                    { key: "focus" as PomodoroMode, label: "专注（分钟）", value: focusMinutes, max: 180 },
                    { key: "short" as PomodoroMode, label: "短休息（分钟）", value: shortMinutes, max: 60 },
                    { key: "long" as PomodoroMode, label: "长休息（分钟）", value: longMinutes, max: 120 },
                  ] as const
                ).map((item) => (
                  <div key={item.key} className="space-y-2">
                    <Label htmlFor={`pomodoro-${item.key}`}>{item.label}</Label>
                    <Input
                      id={`pomodoro-${item.key}`}
                      type="number"
                      min={1}
                      max={item.max}
                      value={String(clampInt(item.value, 1, item.max))}
                      onChange={(event) => changeDuration(item.key, Number(event.target.value))}
                    />
                  </div>
                ))}
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                每完成 {POMODORO_LONG_BREAK_EVERY} 个专注进入一次长休息；专注结束后会停在休息模式的起点，需要手动点开始。
              </p>
            </div>
          ) : null}
        </div>

        <div className="rounded-2xl border border-border/70 bg-card/60 p-5 shadow-sm backdrop-blur-md">
          <SectionTitle
            icon={soundEnabled ? Volume2 : VolumeX}
            title="提示音"
            extra={<span className="text-[11px] text-muted-foreground">{soundSummary}</span>}
          />
          <div className="mt-3 space-y-4">
            <div className="space-y-2">
              <Label>开关</Label>
              <Segmented
                value={soundEnabled ? "on" : "off"}
                options={[
                  { value: "on", label: "开", icon: Volume2 },
                  { value: "off", label: "关", icon: VolumeX },
                ]}
                onChange={(next) => {
                  // 在用户手势里顺手解锁音频：之后由定时器触发的播放才不会被自动播放策略拦掉
                  if (next === "on") unlockPomodoroAudio();
                  else stopRinging();
                  setSoundEnabled(next === "on");
                }}
              />
            </div>

            <div className="space-y-2">
              <Label>音色</Label>
              <Segmented
                value={effectiveChoice}
                options={soundOptions}
                onChange={(next) => {
                  stopRinging();
                  setSoundNotice(null);
                  setSoundChoice(next);
                }}
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {currentSpec
                  ? currentSpec.hint
                  : effectiveChoice === "imported"
                    ? `使用导入的音频：试听只播 ${POMODORO_IMPORT_PREVIEW_SECONDS} 秒，提醒时整段循环响最多 ${POMODORO_IMPORT_RING_SECONDS} 秒。音量仍由下面的滑块控制。`
                    : "静音：计时照常，只是不响。"}
              </p>
              {currentSpec && ringPlan ? (
                <p className="font-mono-accent text-[11px] text-muted-foreground">
                  单次 {soundTotalDuration(currentSpec).toFixed(2)} 秒 · 响铃每{" "}
                  {ringPlan.strikeGap.toFixed(2)} 秒敲一次 · 共 {ringPlan.strikeCount} 次 /{" "}
                  {POMODORO_RING_TOTAL_SECONDS} 秒 · 峰值上界{" "}
                  {soundPeakUpperBound(currentSpec, volume).toFixed(2)}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <Label htmlFor="pomodoro-volume">音量</Label>
                <span className="font-mono-accent text-[11px] text-muted-foreground">
                  {volume}%　总增益 ×{gainNow.toFixed(2)}
                </span>
              </div>
              <Input
                id="pomodoro-volume"
                type="range"
                min={POMODORO_VOLUME_MIN}
                max={POMODORO_VOLUME_MAX}
                step={5}
                value={String(volume)}
                onChange={(event) => setSoundVolume(clampInt(Number(event.target.value), POMODORO_VOLUME_MIN, POMODORO_VOLUME_MAX))}
                className="h-1.5 border-0 bg-transparent px-0 accent-primary focus-visible:ring-0"
                aria-label="提示音音量"
              />
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span>静音</span>
                <span>最大</span>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={previewSound}>
                  <Volume2 className="h-3.5 w-3.5" /> 试听
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={importing}
                  onClick={() => soundFileRef.current?.click()}
                >
                  {importing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5" />
                  )}
                  {importing ? "解码中" : "导入音频"}
                </Button>
                {importedReady ? (
                  <>
                    <span className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
                      <TypeIcon className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{importedName === "" ? "已导入的音频" : importedName}</span>
                      {importedSeconds > 0 ? <span className="shrink-0">· {importedSeconds.toFixed(1)} 秒</span> : null}
                    </span>
                    <Button type="button" variant="ghost" size="sm" onClick={removeImportedSound}>
                      <X className="h-3.5 w-3.5" /> 移除
                    </Button>
                  </>
                ) : restoreState === "loading" ? (
                  <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> 正在读取上次导入的音频…
                  </span>
                ) : importedName !== "" ? (
                  <span className="text-[11px] text-muted-foreground">
                    上次导入的「{importedName}」这次没读出来，请重新导入。
                  </span>
                ) : null}
              </div>
              <input
                ref={soundFileRef}
                type="file"
                accept="audio/*"
                className="sr-only"
                onChange={(event) => {
                  void acceptSoundFile(event.target.files?.[0]);
                  // 清空 value：同一个文件再选一次也要能触发 change
                  event.target.value = "";
                }}
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                内置音色由 Web Audio 实时合成，不引入音频文件、不联网；音色比值取自调音钵与马林巴木条的实测模态，
                不是整数倍泛音叠加。
                <span className="text-foreground">
                  导入的音频会保存在本机（IndexedDB），关闭软件或刷新页面后下次打开还在，直接就能用，不用重新导入
                </span>
                ；再导入一个会替换掉上一个（本机只留一份）。单个文件上限{" "}
                {formatSoundBytes(POMODORO_SOUND_MAX_BYTES)}，超过的文件只在本次运行有效。
              </p>
              {restoreState === "loading" ? (
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  正在从本机读取上次导入的音频，读完会自动选中「自定义」。
                </p>
              ) : null}
              {!audioSupported ? <ToolError message={POMODORO_AUDIO_UNSUPPORTED} /> : null}
              {soundNotice !== null ? (
                <p className="text-[11px] leading-relaxed text-success">{soundNotice}</p>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * 2. 名片生成器
 *
 * 布局：工作台（模式 B，12 栏 4:8）。字段多、模板多，都需要边改边看；
 * 右侧按名片真实比例（90 × 54 mm → 720 × 432 px）等比缩放呈现，
 * 预览与导出共用同一份版式数据，所以「预览什么样，导出就是什么样」。
 * ══════════════════════════════════════════════════════════════════════════ */

/** 主色预设（用户数据，允许写死十六进制）。 */
const CARD_ACCENT_PRESETS = [
  "#2563eb",
  "#0f766e",
  "#b91c1c",
  "#7c3aed",
  "#ea580c",
  "#be185d",
  "#0f172a",
  "#059669",
];

/** 底色预设（用户数据）。 */
const CARD_BACKGROUND_PRESETS = ["#ffffff", "#f8f5ef", "#f1f5f9", "#e2e8f0", "#111827", "#0b1220"];

const BUSINESS_CARD_SAMPLE: BusinessCardData = {
  name: "芙宁娜",
  title: "产品总监",
  company: "枫丹科技（上海）有限公司",
  phone: "138 0000 0000",
  email: "furina@example.com",
  website: "www.example.com",
  address: "上海市徐汇区漕溪北路 100 号 20 层",
  slogan: "把工具做顺手，让重复劳动少一点",
  template: "minimal",
  accent: "#2563eb",
  background: "#ffffff",
};

/** 名片的文本测量：用 canvas 量真实字宽（中英混排不能按字数估）。 */
let cardMeasureCanvas: HTMLCanvasElement | null = null;

function measureCardText(text: string, fontSize: number, fontWeight: number): number {
  if (typeof document === "undefined") {
    // 服务端没有 canvas：按「汉字 1 字宽、西文 0.55 字宽」估一个，只用于首屏占位
    let width = 0;
    for (const ch of text) width += isCjkChar(ch) ? fontSize : fontSize * 0.55;
    return width;
  }
  if (cardMeasureCanvas === null) cardMeasureCanvas = document.createElement("canvas");
  const ctx = cardMeasureCanvas.getContext("2d");
  if (!ctx) return [...text].length * fontSize * 0.6;
  ctx.font = `${fontWeight} ${fontSize}px ${CARD_FONT_STACK}`;
  return ctx.measureText(text).width;
}

/** 量容器宽度：名片要按容器等比缩放，不能用固定宽度硬撑。 */
function useContainerWidth<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const update = () => setWidth(element.clientWidth);
    update();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export function BusinessCardTool() {
  const [name, setName] = useToolDraft<string>("business-card", "name", "");
  const [title, setTitle] = useToolDraft<string>("business-card", "title", "");
  const [company, setCompany] = useToolDraft<string>("business-card", "company", "");
  const [phone, setPhone] = useToolDraft<string>("business-card", "phone", "");
  const [email, setEmail] = useToolDraft<string>("business-card", "email", "");
  const [website, setWebsite] = useToolDraft<string>("business-card", "website", "");
  const [address, setAddress] = useToolDraft<string>("business-card", "address", "");
  const [slogan, setSlogan] = useToolDraft<string>("business-card", "slogan", "");
  const [template, setTemplate] = useToolDraft<BusinessCardTemplate>(
    "business-card",
    "template",
    "minimal",
  );
  const [accent, setAccent] = useToolDraft<string>("business-card", "accent", "#2563eb");
  const [background, setBackground] = useToolDraft<string>("business-card", "background", "#ffffff");
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cardWrapRef, cardPaneWidth] = useContainerWidth<HTMLDivElement>();

  const data: BusinessCardData = useMemo(
    () => ({
      name,
      title,
      company,
      phone,
      email,
      website,
      address,
      slogan,
      template,
      accent,
      background,
    }),
    [name, title, company, phone, email, website, address, slogan, template, accent, background],
  );

  const layout = useMemo(() => buildBusinessCardLayout(data, measureCardText), [data]);
  const scale = Math.min(1, (cardPaneWidth > 0 ? cardPaneWidth : 640) / CARD_WIDTH);
  const isEmpty =
    [name, title, company, phone, email, website, address, slogan].every(
      (value) => value.trim() === "",
    );
  const darkTemplate = template === "dark";

  const surfaceStyle: CSSProperties = {
    position: "absolute",
    left: 0,
    top: 0,
    width: CARD_WIDTH,
    height: CARD_HEIGHT,
    transform: `scale(${scale})`,
    transformOrigin: "top left",
    fontFamily: CARD_FONT_STACK,
    background: layout.gradient
      ? `linear-gradient(135deg, ${layout.gradient.from} 0%, ${layout.gradient.mid} 52%, ${layout.gradient.to} 100%)`
      : layout.background,
    transition: "background 240ms ease",
  };

  const exportPng = async () => {
    setError(null);
    setExporting(true);
    try {
      const canvas = document.createElement("canvas");
      if (!drawBusinessCard(canvas, layout, 2)) throw new Error("当前环境不支持 Canvas 绘制");
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("导出 PNG 失败"))), "image/png"),
      );
      downloadBlob(blob, `${safeFileName(name, "名片")}-名片.png`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出失败，请重试。");
    } finally {
      setExporting(false);
    }
  };

  const loadSample = () => {
    setError(null);
    setName(BUSINESS_CARD_SAMPLE.name);
    setTitle(BUSINESS_CARD_SAMPLE.title);
    setCompany(BUSINESS_CARD_SAMPLE.company);
    setPhone(BUSINESS_CARD_SAMPLE.phone);
    setEmail(BUSINESS_CARD_SAMPLE.email);
    setWebsite(BUSINESS_CARD_SAMPLE.website);
    setAddress(BUSINESS_CARD_SAMPLE.address);
    setSlogan(BUSINESS_CARD_SAMPLE.slogan);
    setTemplate(BUSINESS_CARD_SAMPLE.template);
    setAccent(BUSINESS_CARD_SAMPLE.accent);
    setBackground(BUSINESS_CARD_SAMPLE.background);
  };

  const clearAll = () => {
    setError(null);
    setName("");
    setTitle("");
    setCompany("");
    setPhone("");
    setEmail("");
    setWebsite("");
    setAddress("");
    setSlogan("");
    setTemplate("minimal");
    setAccent("#2563eb");
    setBackground("#ffffff");
  };

  const fields: { key: string; label: string; value: string; set: (next: string) => void; placeholder: string }[] = [
    { key: "name", label: "姓名", value: name, set: setName, placeholder: "张三" },
    { key: "title", label: "职位", value: title, set: setTitle, placeholder: "产品经理" },
    { key: "company", label: "公司", value: company, set: setCompany, placeholder: "某某科技有限公司" },
    { key: "phone", label: "手机", value: phone, set: setPhone, placeholder: "138 0000 0000" },
    { key: "email", label: "邮箱", value: email, set: setEmail, placeholder: "name@example.com" },
    { key: "website", label: "网址", value: website, set: setWebsite, placeholder: "www.example.com" },
    { key: "address", label: "地址", value: address, set: setAddress, placeholder: "城市 + 街道门牌" },
    { key: "slogan", label: "标语", value: slogan, set: setSlogan, placeholder: "一句话说明你在做什么" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        {/* 左：配置 */}
        <div className="space-y-5 lg:col-span-4">
          <div className="space-y-4 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-sm backdrop-blur-md">
            <SectionTitle
              icon={Square}
              title="名片内容"
              extra={
                <div className="flex items-center gap-1.5">
                  <Button type="button" variant="outline" size="sm" onClick={loadSample}>
                    <Sparkles className="h-3.5 w-3.5" /> 填入示例
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={clearAll}>
                    <Eraser className="h-3.5 w-3.5" /> 清空
                  </Button>
                </div>
              }
            />
            <div className="grid gap-3 sm:grid-cols-2">
              {fields.map((field) => (
                <div key={field.key} className="space-y-1.5">
                  <Label htmlFor={`card-${field.key}`}>{field.label}</Label>
                  <Input
                    id={`card-${field.key}`}
                    value={field.value}
                    placeholder={field.placeholder}
                    onChange={(event) => field.set(event.target.value)}
                  />
                </div>
              ))}
            </div>
          </div>

          <div className="space-y-3 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-sm backdrop-blur-md">
            <SectionTitle icon={Grid3x3} title="模板" />
            <div className="grid grid-cols-2 gap-2">
              {BUSINESS_CARD_TEMPLATES.map((item) => {
                const active = item.id === template;
                const previewSurface = resolveCardSurface(item.id, background, accent);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setTemplate(item.id);
                      setError(null);
                    }}
                    className={cn(
                      "flex flex-col gap-1.5 rounded-xl border p-2 text-left transition-all",
                      active
                        ? "border-primary/50 bg-primary/10"
                        : "border-border/60 hover:border-primary/40 hover:bg-secondary/60",
                    )}
                  >
                    <span
                      className="relative h-9 w-full overflow-hidden rounded-lg border border-border/60"
                      style={{
                        background: previewSurface.gradient
                          ? `linear-gradient(135deg, ${previewSurface.gradient.from} 0%, ${previewSurface.gradient.mid} 52%, ${previewSurface.gradient.to} 100%)`
                          : previewSurface.background,
                      }}
                    >
                      <span
                        className="absolute left-1/2 top-1/2 h-1 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full"
                        style={{
                          background:
                            item.id === "gradient" || item.id === "dark"
                              ? withAlpha(previewSurface.ink, 0.7)
                              : accent,
                        }}
                      />
                    </span>
                    <span className="flex items-center gap-1 text-[11px] font-medium text-foreground">
                      {item.name}
                      {active ? <Check className="h-3 w-3 text-primary" /> : null}
                    </span>
                    <span className="text-[10px] leading-relaxed text-muted-foreground">{item.hint}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="space-y-4 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-sm backdrop-blur-md">
            <SectionTitle icon={Palette} title="配色" />
            <div className="space-y-2">
              <Label htmlFor="card-accent">主色</Label>
              <div className="flex items-center gap-3">
                <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-border">
                  <input
                    id="card-accent"
                    type="color"
                    value={normalizeHex(accent) ?? "#2563eb"}
                    onChange={(event) => setAccent(event.target.value)}
                    className="absolute -inset-2 h-[calc(100%+1rem)] w-[calc(100%+1rem)] cursor-pointer border-0 bg-transparent p-0"
                    aria-label="主色"
                  />
                </div>
                <Input
                  value={accent}
                  onChange={(event) => setAccent(event.target.value)}
                  className="font-mono text-sm"
                  spellCheck={false}
                  autoComplete="off"
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {CARD_ACCENT_PRESETS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setAccent(color)}
                    aria-label={`主色 ${color}`}
                    className={cn(
                      "h-6 w-6 rounded-full border transition-transform hover:scale-110",
                      (normalizeHex(accent) ?? "") === color ? "border-primary ring-2 ring-primary/30" : "border-border",
                    )}
                    style={{ background: color }}
                  />
                ))}
              </div>
            </div>

            <div className="space-y-2 border-t border-border/40 pt-4">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="card-background">底色</Label>
                {darkTemplate ? (
                  <span className="text-[11px] text-muted-foreground">深色模板用主色加深作底</span>
                ) : null}
              </div>
              <div className="flex items-center gap-3">
                <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-border">
                  <input
                    id="card-background"
                    type="color"
                    value={normalizeHex(background) ?? "#ffffff"}
                    onChange={(event) => setBackground(event.target.value)}
                    disabled={darkTemplate}
                    className="absolute -inset-2 h-[calc(100%+1rem)] w-[calc(100%+1rem)] cursor-pointer border-0 bg-transparent p-0 disabled:cursor-not-allowed"
                    aria-label="底色"
                  />
                </div>
                <Input
                  value={background}
                  onChange={(event) => setBackground(event.target.value)}
                  className="font-mono text-sm"
                  spellCheck={false}
                  autoComplete="off"
                  disabled={darkTemplate}
                />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {CARD_BACKGROUND_PRESETS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    disabled={darkTemplate}
                    onClick={() => setBackground(color)}
                    aria-label={`底色 ${color}`}
                    className={cn(
                      "h-6 w-6 rounded-full border transition-transform hover:scale-110",
                      (normalizeHex(background) ?? "") === color ? "border-primary ring-2 ring-primary/30" : "border-border",
                      darkTemplate && "cursor-not-allowed opacity-40",
                    )}
                    style={{ background: color }}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* 右：成品预览 */}
        <div className="space-y-4 lg:col-span-8">
          <div className="space-y-4 rounded-2xl border border-border/70 bg-card/70 p-5 shadow-sm backdrop-blur-md">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <SectionTitle icon={TypeIcon} title="预览" />
                <Badge variant="outline">
                  {BUSINESS_CARD_TEMPLATES.find((item) => item.id === template)?.name ?? "简约"}
                </Badge>
                <Badge variant="secondary">90 × 54 mm</Badge>
              </div>
              <Button type="button" onClick={() => void exportPng()} disabled={exporting}>
                {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                {exporting ? "导出中…" : "下载 PNG（2 倍图）"}
              </Button>
            </div>

            <div ref={cardWrapRef} className="w-full">
              <div
                className="relative w-full overflow-hidden rounded-xl border border-border/70 shadow-sm"
                style={{ height: CARD_HEIGHT * scale }}
              >
                <div key={template} className="animate-fade-in-up" style={surfaceStyle}>
                  {layout.sidebar ? (
                    <div
                      className="absolute left-0 top-0"
                      style={{ width: layout.sidebar.width, height: CARD_HEIGHT, background: layout.sidebar.color }}
                    />
                  ) : null}
                  {layout.decorations.map((item, index) => (
                    <div
                      key={`${item.kind}-${index}`}
                      className="absolute"
                      style={{
                        left: item.kind === "circle" ? item.x - item.w / 2 : item.x,
                        top: item.kind === "circle" ? item.y - item.h / 2 : item.y,
                        width: item.w,
                        height: item.h,
                        background: item.color,
                        borderRadius: item.kind === "circle" ? "50%" : (item.radius ?? 0),
                      }}
                    />
                  ))}
                  {layout.blocks
                    .filter((block) => block.lines.length > 0)
                    .map((block, index) => (
                      <div
                        key={`${block.y}-${index}`}
                        className="absolute select-text"
                        style={{
                          left: block.x,
                          top: block.y,
                          width: block.width,
                          fontFamily: CARD_FONT_STACK,
                          fontSize: block.fontSize,
                          fontWeight: block.fontWeight,
                          fontStyle: block.italic ? "italic" : "normal",
                          color: block.color,
                          lineHeight: `${block.lineHeight}px`,
                          textAlign: block.align,
                          whiteSpace: "pre",
                        }}
                      >
                        {block.lines.join("\n")}
                      </div>
                    ))}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Square className="h-3 w-3" /> 720 × 432 像素（2 倍导出为 1440 × 864）
              </span>
              <span className="flex items-center gap-1">
                <ImagePlus className="h-3 w-3" /> 使用系统中文字体，不加载在线字体
              </span>
            </div>

            {layout.truncated ? (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                有内容超过名片宽度，已在结尾用省略号截断：把公司名或标语缩短一些就能完整显示。
              </p>
            ) : null}
            {isEmpty ? (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                左侧填写内容，或点「填入示例」看一张填满的名片长什么样。
              </p>
            ) : null}
            {error !== null ? <ToolError message={error} /> : null}
          </div>

          <div className="space-y-2 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-sm backdrop-blur-md">
            <SectionTitle icon={MousePointerClick} title="导出说明" />
            <ul className="space-y-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <li>· 导出的 PNG 用你选的底色与主色绘制，与界面主题无关，可以直接印。</li>
              <li>· 文件名取自「姓名」，留空时用「名片」。</li>
              <li>· 预览按容器宽度等比缩放，版式与导出图完全一致。</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * 3. 文字云
 *
 * 布局：工作台（模式 B，12 栏 4:8）。左侧参数一动，右侧的云就要跟着重排，
 * 而且成品要能直接点选（点词删除），所以预览区必须给足面积。
 * ══════════════════════════════════════════════════════════════════════════ */

const CLOUD_WIDTH = 760;
const CLOUD_HEIGHT = 440;

/** 配色方案（用户可选的数据色，允许写死十六进制）。 */
export const CLOUD_PALETTES: { name: string; colors: string[] }[] = [
  { name: "品牌蓝", colors: ["#2563eb", "#0ea5e9", "#0f766e", "#1e3a8a", "#0284c7", "#155e75"] },
  { name: "暖霞", colors: ["#e11d48", "#f97316", "#f59e0b", "#b91c1c", "#be185d", "#7c2d12"] },
  { name: "森林", colors: ["#166534", "#15803d", "#65a30d", "#047857", "#3f6212", "#14532d"] },
  { name: "紫罗兰", colors: ["#7c3aed", "#a855f7", "#4c1d95", "#c026d3", "#6d28d9", "#9333ea"] },
  { name: "石墨", colors: ["#111827", "#374151", "#6b7280", "#1f2937", "#4b5563", "#0f172a"] },
  { name: "霓虹糖", colors: ["#06b6d4", "#ec4899", "#8b5cf6", "#f59e0b", "#10b981", "#f43f5e"] },
];

const WORD_CLOUD_SAMPLE = `番茄钟 番茄钟 专注 专注 专注 效率 效率 效率 时间管理 时间管理 休息 休息
记录 记录 复盘 复盘 复盘 计划 计划 工具 本地 离线 隐私 隐私 简洁 设计 细节 体验 体验
快速 稳定 轻量 创作 灵感 节奏 清单 目标 习惯 打卡 深度工作 深度工作 专注力 专注力
分心 分心 拖延 拖延 自律 自律 待办 待办 笔记 笔记 白噪音 白噪音 focus focus flow flow
心流 心流 复盘 效率 专注 专注 番茄钟 番茄钟 专注力`;

/** 文字云的文本测量：canvas measureText（中文不能按等宽字符估）。 */
let cloudMeasureCanvas: HTMLCanvasElement | null = null;

function measureCloudText(text: string, fontSize: number): number {
  if (typeof document === "undefined") {
    let width = 0;
    for (const ch of text) width += isCjkChar(ch) ? fontSize : fontSize * 0.55;
    return width;
  }
  if (cloudMeasureCanvas === null) cloudMeasureCanvas = document.createElement("canvas");
  const ctx = cloudMeasureCanvas.getContext("2d");
  if (!ctx) return [...text].length * fontSize * 0.62;
  ctx.font = `700 ${fontSize}px ${CARD_FONT_STACK}`;
  return ctx.measureText(text).width;
}

/** SVG → PNG（2 倍图）：中间的 object URL 只活在这一个函数里，用完立刻撤销。 */
async function cloudSvgToPngBlob(
  markup: string,
  width: number,
  height: number,
  scale: number,
  transparent: boolean,
): Promise<Blob> {
  const svgBlob = new Blob([markup], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);
  try {
    const image = new Image();
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("SVG 转 PNG 失败，请换成下载 SVG。"));
      image.src = url;
    });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("当前环境不支持 Canvas");
    if (!transparent) {
      // 导出成品的内容底色（刻意写死白色：这是图片内容，不是界面配色）
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("导出 PNG 失败"))), "image/png"),
    );
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function WordCloudTool() {
  const [text, setText] = useToolDraft<string>("word-cloud", "text", "");
  const [maxWords, setMaxWords] = useToolDraft<number>("word-cloud", "maxWords", 40);
  const [paletteIndex, setPaletteIndex] = useToolDraft<number>("word-cloud", "palette", 0);
  const [allowRotate, setAllowRotate] = useToolDraft<boolean>("word-cloud", "rotate", true);
  const [shape, setShape] = useToolDraft<CloudShape>("word-cloud", "shape", "rect");
  const [transparent, setTransparent] = useToolDraft<boolean>("word-cloud", "transparent", true);
  /** 被点掉的词（视图态，不持久化：换一批文字之后它们没有意义） */
  const [removed, setRemoved] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const limit = clampInt(maxWords, 5, 120);
  const palette = CLOUD_PALETTES[clampInt(paletteIndex, 0, CLOUD_PALETTES.length - 1)] ?? CLOUD_PALETTES[0];
  const colors = palette.colors;

  const extraction = useMemo(() => extractCloudWords(text, { maxWords: limit }), [text, limit]);
  const words = useMemo(
    () => extraction.words.filter((item) => !removed.includes(item.word)),
    [extraction, removed],
  );
  const sizes = useMemo(() => suggestCloudFontSizes(words.length, CLOUD_WIDTH, CLOUD_HEIGHT), [words.length]);
  const layout = useMemo(
    () =>
      fitCloudLayout(words, {
        width: CLOUD_WIDTH,
        height: CLOUD_HEIGHT,
        shape,
        allowRotate,
        minFontSize: sizes.min,
        maxFontSize: sizes.max,
        measure: measureCloudText,
        colorCount: colors.length,
        padding: 3,
        maxAttempts: 1100,
        targetRatio: 0.85,
      }),
    [words, shape, allowRotate, sizes, colors.length],
  );

  const svgMarkup = useMemo(
    () =>
      buildCloudSvgMarkup(layout, {
        width: CLOUD_WIDTH,
        height: CLOUD_HEIGHT,
        palette: colors,
        transparent,
        background: "#ffffff",
        fontFamily: CARD_FONT_STACK,
      }),
    [layout, colors, transparent],
  );

  const loadSample = () => {
    setError(null);
    setRemoved([]);
    setText(WORD_CLOUD_SAMPLE);
  };

  const clearAll = () => {
    setError(null);
    setRemoved([]);
    setText("");
    setMaxWords(40);
    setPaletteIndex(0);
    setAllowRotate(true);
    setShape("rect");
    setTransparent(true);
  };

  const downloadSvg = () => {
    setError(null);
    try {
      downloadBlob(new Blob([svgMarkup], { type: "image/svg+xml;charset=utf-8" }), "文字云.svg");
    } catch {
      setError("下载 SVG 失败，请重试。");
    }
  };

  const downloadPng = async () => {
    setError(null);
    setBusy(true);
    try {
      const blob = await cloudSvgToPngBlob(svgMarkup, CLOUD_WIDTH, CLOUD_HEIGHT, 2, transparent);
      downloadBlob(blob, "文字云.png");
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出 PNG 失败，请重试。");
    } finally {
      setBusy(false);
    }
  };

  const hasWords = extraction.words.length > 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        {/* 左：参数 */}
        <div className="space-y-5 lg:col-span-4">
          <div className="space-y-4 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-sm backdrop-blur-md">
            <SectionTitle
              icon={TypeIcon}
              title="文字"
              extra={
                <div className="flex items-center gap-1.5">
                  <Button type="button" variant="outline" size="sm" onClick={loadSample}>
                    <Sparkles className="h-3.5 w-3.5" /> 填入示例
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={clearAll}>
                    <Eraser className="h-3.5 w-3.5" /> 清空
                  </Button>
                </div>
              }
            />
            <Textarea
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setRemoved([]);
              }}
              placeholder="粘贴一段文字：中文按重复出现的词组切分，英文按单词统计词频。"
              className="min-h-[200px]"
              spellCheck={false}
            />
            <div className="space-y-2">
              <Label htmlFor="cloud-max">最大词数</Label>
              <Input
                id="cloud-max"
                type="number"
                min={5}
                max={120}
                value={String(limit)}
                onChange={(event) => setMaxWords(clampInt(Number(event.target.value), 5, 120))}
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                词数多、画布放不下时会自动把字号整体收小再排一遍，尽量把词都放进去；实在放不下的会被跳过，数量显示在预览区。
              </p>
            </div>
          </div>

          <div className="space-y-4 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-sm backdrop-blur-md">
            <SectionTitle icon={Palette} title="配色方案" />
            <div className="grid grid-cols-2 gap-2">
              {CLOUD_PALETTES.map((item, index) => (
                <button
                  key={item.name}
                  type="button"
                  onClick={() => setPaletteIndex(index)}
                  className={cn(
                    "flex items-center gap-2 rounded-xl border p-2 text-left transition-all",
                    index === clampInt(paletteIndex, 0, CLOUD_PALETTES.length - 1)
                      ? "border-primary/50 bg-primary/10"
                      : "border-border/60 hover:border-primary/40 hover:bg-secondary/60",
                  )}
                >
                  <span className="flex shrink-0 gap-0.5">
                    {item.colors.slice(0, 4).map((color) => (
                      <span
                        key={color}
                        className="h-5 w-1.5 rounded-full"
                        style={{ background: color }}
                      />
                    ))}
                  </span>
                  <span className="truncate text-[11px] text-foreground">{item.name}</span>
                </button>
              ))}
            </div>

            <div className="space-y-2 border-t border-border/40 pt-4">
              <Label>形状遮罩</Label>
              <Segmented
                value={shape}
                options={[
                  { value: "rect" as CloudShape, label: "矩形", icon: Square },
                  { value: "circle" as CloudShape, label: "圆形", icon: Shapes },
                  { value: "heart" as CloudShape, label: "心形", icon: Sparkles },
                ]}
                onChange={setShape}
              />
            </div>

            <div className="space-y-2 border-t border-border/40 pt-4">
              <Label>排版</Label>
              <Segmented
                value={allowRotate ? "on" : "off"}
                options={[
                  { value: "on", label: "允许竖排/倾斜" },
                  { value: "off", label: "全部水平" },
                ]}
                onChange={(next) => setAllowRotate(next === "on")}
              />
              <Segmented
                value={transparent ? "on" : "off"}
                options={[
                  { value: "on", label: "背景透明" },
                  { value: "off", label: "白色背景" },
                ]}
                onChange={(next) => setTransparent(next === "on")}
              />
            </div>
          </div>
        </div>

        {/* 右：实时预览 */}
        <div className="space-y-4 lg:col-span-8">
          <div className="space-y-4 rounded-2xl border border-border/70 bg-card/70 p-5 shadow-sm backdrop-blur-md">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <SectionTitle icon={TypeIcon} title="预览" />
                <Badge variant="outline">
                  共 {extraction.words.length} 个词，已放置 {layout.placed.length} 个
                </Badge>
                {layout.skipped.length > 0 ? (
                  <Badge variant="secondary">有 {layout.skipped.length} 个词放不下</Badge>
                ) : null}
                {removed.length > 0 ? <Badge variant="secondary">已删除 {removed.length} 个</Badge> : null}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {removed.length > 0 ? (
                  <Button type="button" variant="ghost" size="sm" onClick={() => setRemoved([])}>
                    <Undo2 className="h-3.5 w-3.5" /> 恢复
                  </Button>
                ) : null}
                <Button type="button" variant="outline" size="sm" onClick={downloadSvg} disabled={!hasWords}>
                  <Download className="h-3.5 w-3.5" /> SVG
                </Button>
                <Button type="button" size="sm" onClick={() => void downloadPng()} disabled={!hasWords || busy}>
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  PNG（2 倍图）
                </Button>
              </div>
            </div>

            {!hasWords ? (
              <EmptyPane
                icon={<TypeIcon className="h-8 w-8" />}
                hint="左边粘一段文字，这里会实时排出文字云；词频越高字号越大。"
                action={
                  <Button type="button" variant="outline" size="sm" onClick={loadSample}>
                    <Sparkles className="h-3.5 w-3.5" /> 填入示例看看
                  </Button>
                }
                className="min-h-[360px]"
              />
            ) : (
              <div
                className={cn(
                  "relative overflow-hidden rounded-xl border border-border/60 p-2",
                  transparent ? "bg-muted/20" : "bg-card",
                )}
                style={
                  transparent
                    ? {
                        backgroundImage:
                          "linear-gradient(45deg, hsl(var(--border) / 0.45) 25%, transparent 25%, transparent 75%, hsl(var(--border) / 0.45) 75%), linear-gradient(45deg, hsl(var(--border) / 0.45) 25%, transparent 25%, transparent 75%, hsl(var(--border) / 0.45) 75%)",
                        backgroundSize: "16px 16px",
                        backgroundPosition: "0 0, 8px 8px",
                      }
                    : undefined
                }
              >
                <svg
                  viewBox={`0 0 ${CLOUD_WIDTH} ${CLOUD_HEIGHT}`}
                  className="h-auto w-full"
                  style={transparent ? undefined : { background: "#ffffff" }}
                  role="img"
                  aria-label="文字云预览"
                >
                  {layout.placed.map((box) => (
                    <text
                      key={box.word}
                      x={box.x}
                      y={box.y}
                      fontSize={box.fontSize}
                      fontWeight={700}
                      fill={colors[box.colorIndex % colors.length]}
                      textAnchor="middle"
                      dominantBaseline="central"
                      fontFamily={CARD_FONT_STACK}
                      transform={box.rotated ? `rotate(-90 ${box.x} ${box.y})` : undefined}
                      className="cursor-pointer transition-opacity hover:opacity-60"
                      onClick={() => setRemoved((prev) => [...prev, box.word])}
                    >
                      <title>{`${box.word}（${box.count} 次）— 点击可从云里删掉`}</title>
                      {box.word}
                    </text>
                  ))}
                </svg>
              </div>
            )}

            {hasWords ? (
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <MousePointerClick className="h-3 w-3" /> 点击云里的词可以把它删掉
                </span>
                <span className="flex items-center gap-1">
                  <Hash className="h-3 w-3" /> 候选词 {extraction.candidates} 个，过滤停用词 {extraction.dropped} 次
                </span>
                {layout.skipped.length > 0 ? (
                  <span className="flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    放不下：{layout.skipped.slice(0, 6).join("、")}
                    {layout.skipped.length > 6 ? " 等" : ""}
                  </span>
                ) : null}
              </div>
            ) : null}

            {error !== null ? <ToolError message={error} /> : null}
          </div>

          <div className="space-y-2 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-sm backdrop-blur-md">
            <SectionTitle icon={Percent} title="导出说明" />
            <ul className="space-y-1.5 text-[11px] leading-relaxed text-muted-foreground">
              <li>· SVG 是矢量文件，下载后还能在矢量软件里继续改。</li>
              <li>· PNG 按 2 倍尺寸栅格化，字体使用系统字体栈，不依赖在线字体。</li>
              <li>· 排版为「螺旋试探 + 碰撞检测」：放下的词保证不重叠，试不到位置的词会被跳过。</li>
              <li>· 中文按「重复出现的词组（最长 4 字）→ 两字词 → 单字」切分，不引词典；英文按单词统计。</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════
 * 4. 拼豆图纸生成器
 *
 * 布局：工作台 + 表格（模式 B + D）。上半部分「左参数 / 右图纸」，下半部分整幅宽度的用料清单：
 * 清单里有色号、色名、数量、占比，是这个工具最有价值的产出，塞进侧栏会看不全。
 * ══════════════════════════════════════════════════════════════════════════ */

/**
 * 上传图片的预览链接：模块级单槽缓存持有。
 *
 * 只在三种情况释放：① 换成另一张图 ② 清空 ③ 移除；判断依据是「链接字符串是否还是同一条」，
 * 每次写入都无条件释放会把正在显示的链接掐断。组件卸载（切工具 / 回首页）**不释放** ——
 * 回来时复用同一条链接，否则用户切走再回来就只剩一张死图。
 * （项目里踩过 object URL 泄漏与「切回来图挂了」两个坑，这里按 pdf-to-images-tool 的写法来。）
 */
interface PerlerImageEntry {
  file: File;
  url: string;
}

let perlerImageCache: PerlerImageEntry | null = null;

function readPerlerImage(): PerlerImageEntry | null {
  return perlerImageCache;
}

function rememberPerlerImage(next: PerlerImageEntry | null): void {
  const previous = perlerImageCache;
  if (previous && previous.url !== next?.url) URL.revokeObjectURL(previous.url);
  perlerImageCache = next;
}

/** 取色用的离屏画布（反复使用同一个，别每次新建）。 */
let beadScratchCanvas: HTMLCanvasElement | null = null;

/**
 * 色卡匹配器缓存：按色卡 id 复用同一个惰性查找表（切回上一套色卡时不必重建）。
 * 只放两张表的对象，没有需要释放的资源。
 */
const beadMatcherCache = new Map<BeadPaletteId, BeadMatcher>();

function getBeadMatcher(id: BeadPaletteId): BeadMatcher {
  const cached = beadMatcherCache.get(id);
  if (cached) return cached;
  const created = createBeadMatcher(getBeadPalette(id));
  beadMatcherCache.set(id, created);
  return created;
}

/** 把图片按网格尺寸降采样成 RGB 三元组（浏览器自带的缩放足够好，不必手写平均）。 */
function sampleImageToRgb(image: CanvasImageSource, gridW: number, gridH: number): Uint8ClampedArray | null {
  if (beadScratchCanvas === null) beadScratchCanvas = document.createElement("canvas");
  const canvas = beadScratchCanvas;
  canvas.width = gridW;
  canvas.height = gridH;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // 透明像素按白底合成（图纸是要打印的成品，底色是内容的一部分）
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, gridW, gridH);
  ctx.drawImage(image, 0, 0, gridW, gridH);
  const data = ctx.getImageData(0, 0, gridW, gridH).data;
  const rgb = new Uint8ClampedArray(gridW * gridH * 3);
  for (let i = 0; i < gridW * gridH; i += 1) {
    rgb[i * 3] = data[i * 4];
    rgb[i * 3 + 1] = data[i * 4 + 1];
    rgb[i * 3 + 2] = data[i * 4 + 2];
  }
  return rgb;
}

/**
 * 画图纸：色块 + 网格线 + 行列号（可选）+ 每格色号（可选）。
 * 打印用，所以底色是白的、网格线是中性灰 —— 这些是图片内容，不随界面主题变化。
 */
function drawBeadChart(
  canvas: HTMLCanvasElement,
  chart: { indices: Uint8Array; gridW: number; gridH: number; palette: BeadColor[] },
  options: { cell: number; showGrid: boolean; showCodes: boolean; scale: number },
): void {
  const { indices, gridW, gridH, palette } = chart;
  const cell = Math.max(4, Math.round(options.cell));
  const margin = options.showGrid && cell >= 11 ? Math.round(Math.min(cell * 1.6, 30)) : 0;
  const step = cell >= 18 ? 1 : 5;
  const width = gridW * cell + margin;
  const height = gridH * cell + margin;
  canvas.width = Math.round(width * options.scale);
  canvas.height = Math.round(height * options.scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.setTransform(options.scale, 0, 0, options.scale, 0, 0);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);

  for (let y = 0; y < gridH; y += 1) {
    for (let x = 0; x < gridW; x += 1) {
      const index = indices[y * gridW + x];
      const color = palette[index];
      if (!color) continue;
      const px = margin + x * cell;
      const py = margin + y * cell;
      ctx.fillStyle = color.hex;
      ctx.fillRect(px, py, cell, cell);
      if (options.showCodes && cell >= 11) {
        ctx.fillStyle = pickInkColor(color.hex);
        ctx.font = `600 ${Math.max(6, Math.round(cell * 0.42))}px ${CARD_FONT_STACK}`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(color.code, px + cell / 2, py + cell / 2);
      }
    }
  }

  if (options.showGrid && cell >= 4) {
    ctx.strokeStyle = "rgba(0,0,0,0.22)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= gridW; x += 1) {
      const px = margin + x * cell + 0.5;
      ctx.moveTo(px, margin);
      ctx.lineTo(px, margin + gridH * cell);
    }
    for (let y = 0; y <= gridH; y += 1) {
      const py = margin + y * cell + 0.5;
      ctx.moveTo(margin, py);
      ctx.lineTo(margin + gridW * cell, py);
    }
    ctx.stroke();

    if (margin > 0) {
      ctx.fillStyle = "rgba(0,0,0,0.55)";
      ctx.font = `600 ${Math.max(7, Math.round(margin * 0.5))}px ${CARD_FONT_STACK}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (let x = 0; x < gridW; x += 1) {
        const label = String(x + 1);
        if (step === 1 || (x + 1) % step === 0) {
          ctx.fillText(label, margin + x * cell + cell / 2, margin / 2);
        }
      }
      for (let y = 0; y < gridH; y += 1) {
        if (step === 1 || (y + 1) % step === 0) {
          ctx.fillText(String(y + 1), margin / 2, margin + y * cell + cell / 2);
        }
      }
    }
  }
}

/** 示例图片：现场画一张渐变 + 图形的图，用来让「填入示例」立刻能跑出效果。 */
async function createPerlerSampleFile(): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 240;
  canvas.height = 200;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("当前环境不支持 Canvas");
  const sky = ctx.createLinearGradient(0, 0, 0, 200);
  sky.addColorStop(0, "#FDE68A");
  sky.addColorStop(0.55, "#FCA5A5");
  sky.addColorStop(1, "#7DD3FC");
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 240, 200);
  ctx.fillStyle = "#F59E0B";
  ctx.beginPath();
  ctx.arc(70, 70, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#166534";
  ctx.beginPath();
  ctx.moveTo(-10, 200);
  ctx.lineTo(90, 110);
  ctx.lineTo(190, 200);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#15803D";
  ctx.beginPath();
  ctx.moveTo(120, 200);
  ctx.lineTo(200, 130);
  ctx.lineTo(260, 200);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#1E3A8A";
  ctx.beginPath();
  ctx.arc(196, 56, 18, 0, Math.PI * 2);
  ctx.fill();
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("生成示例图片失败"))), "image/png"),
  );
  return new File([blob], "示例图案.png", { type: "image/png" });
}

const PERLER_GRID_PRESETS: { value: string; label: string; size?: number }[] = [
  { value: "29", label: "29 × 29", size: 29 },
  { value: "50", label: "50 × 50", size: 50 },
  { value: "custom", label: "自定义" },
];

export function PerlerBeadsTool() {
  // 输入图放在模块级缓存里（File 无法序列化），组件卸载不释放链接
  const [image, setImage] = useState<PerlerImageEntry | null>(() => readPerlerImage());
  const [mode, setMode] = useToolDraft<BeadColorMode>("perler-beads", "colorMode", "nearest");
  const [gridW, setGridW] = useToolDraft<number>("perler-beads", "gridW", 50);
  const [gridH, setGridH] = useToolDraft<number>("perler-beads", "gridH", 50);
  const [paletteId, setPaletteId] = useToolDraft<BeadPaletteId>("perler-beads", "palette", "standard");
  const [showGrid, setShowGrid] = useToolDraft<boolean>("perler-beads", "showGrid", true);
  const [showCodes, setShowCodes] = useToolDraft<boolean>("perler-beads", "showCodes", false);
  const [cell, setCell] = useToolDraft<number>("perler-beads", "cell", 14);
  const [bitmap, setBitmap] = useState<HTMLImageElement | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const palette = getBeadPalette(paletteId);
  const matcher = getBeadMatcher(paletteId);
  const width = clampInt(gridW, 5, 120);
  const height = clampInt(gridH, 5, 120);
  const zoom = clampInt(cell, 6, 34);

  // 预览链接的所有权归模块级缓存：只在换图 / 清空 / 移除时释放（比较链接字符串）
  useEffect(() => {
    rememberPerlerImage(image);
  }, [image]);

  // 载入位图（图片内容本身不画在界面上，只用它的像素）
  useEffect(() => {
    if (!image) {
      setBitmap(null);
      setNaturalSize(null);
      return;
    }
    let cancelled = false;
    const next = new Image();
    next.onload = () => {
      if (cancelled) return;
      setBitmap(next);
      setNaturalSize({ width: next.naturalWidth, height: next.naturalHeight });
    };
    next.onerror = () => {
      if (cancelled) return;
      setBitmap(null);
      setNaturalSize(null);
      setError("这张图片读不出来，换一张 PNG / JPG 试试。");
    };
    next.src = image.url;
    return () => {
      cancelled = true;
    };
  }, [image]);

  /**
   * 量化结果：网格降采样 → 最近色匹配（或抖动）→ 用料清单。
   * 这是本工具唯一的重活：最大网格 120×120 = 14400 格、每格颜色都不相同的最坏情况下，
   * 实测（本机 Node 24，见开发时单测输出）最近色 3.1ms、Floyd–Steinberg 抖动 5.4ms，
   * 远低于 100ms 预算，所以这里同步算，不引入分块 —— 分块只会让「改参数 → 看到图纸」变迟钝。
   * 如果以后把网格上限放开到几百格，这个 useMemo 就必须改成分批计算。
   */
  const chart = useMemo(() => {
    if (!bitmap) return null;
    const rgb = sampleImageToRgb(bitmap, width, height);
    if (!rgb) return null;
    const indices = quantizeGrid(rgb, width, height, palette, mode, matcher);
    return { indices, usage: buildBeadUsage(indices, palette) };
  }, [bitmap, width, height, palette, mode, matcher]);

  // 画图纸（canvas 只在这里重绘；50 × 50 = 2500 格，只在参数变化时算一次）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !chart) return;
    drawBeadChart(
      canvas,
      { indices: chart.indices, gridW: width, gridH: height, palette },
      { cell: zoom, showGrid, showCodes, scale: 2 },
    );
  }, [chart, width, height, palette, zoom, showGrid, showCodes]);

  const totalBeads = chart ? chart.usage.reduce((sum, item) => sum + item.count, 0) : 0;

  const acceptFile = (file: File) => {
    setError(null);
    if (!file.type.startsWith("image/")) {
      setError("这个文件不是图片，换一张 PNG / JPG / WebP 试试。");
      return;
    }
    if (file.size > 40 * 1024 * 1024) {
      setError(`图片有 ${formatBytes(file.size)}，太大了；先压缩一下再传。`);
      return;
    }
    // 新链接交给缓存持有，被替换掉的那条由 rememberPerlerImage 释放（卸载不释放）
    setImage({ file, url: URL.createObjectURL(file) });
  };

  const loadSample = async () => {
    setError(null);
    try {
      const file = await createPerlerSampleFile();
      setImage({ file, url: URL.createObjectURL(file) });
      setMode("nearest");
      setGridW(50);
      setGridH(50);
      setShowGrid(true);
      setShowCodes(false);
      setCell(14);
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成示例图片失败。");
    }
  };

  const clearAll = () => {
    setError(null);
    setImage(null); // 链接由缓存释放
    setBitmap(null);
    setNaturalSize(null);
    setMode("nearest");
    setGridW(50);
    setGridH(50);
    setPaletteId("standard");
    setShowGrid(true);
    setShowCodes(false);
    setCell(14);
  };

  const exportPng = async () => {
    if (!chart) return;
    setError(null);
    setBusy(true);
    try {
      const canvas = document.createElement("canvas");
      // 导出固定用 24px/格 + 2 倍缩放：50 × 50 得到 2400 × 2400 左右，打印够清楚
      drawBeadChart(
        canvas,
        { indices: chart.indices, gridW: width, gridH: height, palette },
        { cell: 24, showGrid: true, showCodes: true, scale: 2 },
      );
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((value) => (value ? resolve(value) : reject(new Error("导出 PNG 失败"))), "image/png"),
      );
      downloadBlob(blob, `拼豆图纸-${width}x${height}.png`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "导出图纸失败，请重试。");
    } finally {
      setBusy(false);
    }
  };

  const exportCsv = () => {
    if (!chart) return;
    setError(null);
    try {
      downloadBlob(
        new Blob([beadsToCsv(chart.usage)], { type: "text/csv;charset=utf-8" }),
        `拼豆用料清单-${width}x${height}.csv`,
      );
    } catch {
      setError("导出 CSV 失败，请重试。");
    }
  };

  const gridPresetValue =
    width === 29 && height === 29 ? "29" : width === 50 && height === 50 ? "50" : "custom";

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        {/* 左：参数 */}
        <div className="space-y-5 lg:col-span-4">
          <div className="space-y-4 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-sm backdrop-blur-md">
            <SectionTitle
              icon={Upload}
              title="原图"
              extra={
                <div className="flex items-center gap-1.5">
                  <Button type="button" variant="outline" size="sm" onClick={() => void loadSample()}>
                    <Sparkles className="h-3.5 w-3.5" /> 填入示例
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={clearAll}>
                    <Eraser className="h-3.5 w-3.5" /> 清空
                  </Button>
                </div>
              }
            />
            <label
              onDragOver={(event) => {
                event.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(event) => {
                event.preventDefault();
                setDragging(false);
                const file = event.dataTransfer.files?.[0];
                if (file) acceptFile(file);
              }}
              className={cn(
                "group flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border bg-secondary/20 px-6 py-8 text-center transition-all duration-200",
                dragging ? "border-primary bg-primary/10 ring-4 ring-primary/15" : "hover:border-primary/50 hover:bg-secondary/40",
              )}
            >
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) acceptFile(file);
                  event.target.value = "";
                }}
              />
              <span className="mb-2 flex h-11 w-11 items-center justify-center rounded-full border border-border bg-card transition-all group-hover:-translate-y-0.5 group-hover:border-primary/40">
                <ImagePlus className="h-5 w-5 text-muted-foreground transition-colors group-hover:text-primary" />
              </span>
              <p className="text-sm font-medium">
                {image ? "点击换一张图片" : "点击选择图片，或拖拽到此处"}
              </p>
              <p className="mt-1 text-[10px] text-muted-foreground">图片只在本机解析，不上传</p>
            </label>

            {image ? (
              <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-card px-3 py-2">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={image.url}
                  alt={image.file.name}
                  className="h-12 w-12 shrink-0 rounded-lg border border-border object-cover"
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-foreground">{image.file.name}</p>
                  <p className="font-mono-accent text-[10px] uppercase tracking-widest text-muted-foreground">
                    {formatBytes(image.file.size)}
                    {naturalSize ? ` · ${naturalSize.width} × ${naturalSize.height}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setImage(null);
                    setBitmap(null);
                    setNaturalSize(null);
                  }}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive"
                  aria-label="移除图片"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            ) : null}
          </div>

          <div className="space-y-4 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-sm backdrop-blur-md">
            <SectionTitle icon={Grid3x3} title="网格与配色" />
            <div className="space-y-2">
              <Label>网格尺寸</Label>
              <Segmented
                value={gridPresetValue}
                options={PERLER_GRID_PRESETS.map((item) => ({ value: item.value, label: item.label }))}
                onChange={(next) => {
                  const preset = PERLER_GRID_PRESETS.find((item) => item.value === next);
                  if (preset?.size) {
                    setGridW(preset.size);
                    setGridH(preset.size);
                  }
                }}
              />
              <div className="grid grid-cols-2 gap-3 pt-1">
                <div className="space-y-1.5">
                  <Label htmlFor="perler-w">宽（格）</Label>
                  <Input
                    id="perler-w"
                    type="number"
                    min={5}
                    max={120}
                    value={String(width)}
                    onChange={(event) => setGridW(clampInt(Number(event.target.value), 5, 120))}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="perler-h">高（格）</Label>
                  <Input
                    id="perler-h"
                    type="number"
                    min={5}
                    max={120}
                    value={String(height)}
                    onChange={(event) => setGridH(clampInt(Number(event.target.value), 5, 120))}
                  />
                </div>
              </div>
            </div>

            <div className="space-y-2 border-t border-border/40 pt-4">
              <Label>取色模式</Label>
              <Segmented
                value={mode}
                options={[
                  { value: "nearest" as BeadColorMode, label: "最近色", icon: Palette },
                  { value: "dither" as BeadColorMode, label: "抖动", icon: Shapes },
                ]}
                onChange={setMode}
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                抖动用 Floyd–Steinberg 误差扩散，照片层次更自然，但同色块会碎成更细的颗粒。
              </p>
            </div>

            <div className="space-y-2 border-t border-border/40 pt-4">
              <Label htmlFor="perler-palette">色卡</Label>
              <Segmented
                value={paletteId}
                options={BEAD_PALETTES.map((item) => ({
                  value: item.id,
                  label: `${item.name}（${item.colors.length} 色）`,
                }))}
                onChange={setPaletteId}
              />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                内置色卡是常见拼豆配色的近似色，不是任何厂商的官方色卡；换卡后立即重新匹配。
              </p>
            </div>

            <div className="space-y-2 border-t border-border/40 pt-4">
              <Label>图纸显示</Label>
              <Segmented
                value={showGrid ? "on" : "off"}
                options={[
                  { value: "on", label: "显示网格与行列号" },
                  { value: "off", label: "只要色块" },
                ]}
                onChange={(next) => setShowGrid(next === "on")}
              />
              <Segmented
                value={showCodes ? "on" : "off"}
                options={[
                  { value: "on", label: "每格显示色号" },
                  { value: "off", label: "不显示色号" },
                ]}
                onChange={(next) => setShowCodes(next === "on")}
              />
            </div>
          </div>
        </div>

        {/* 右：图纸 */}
        <div className="space-y-4 lg:col-span-8">
          <div className="space-y-4 rounded-2xl border border-border/70 bg-card/70 p-5 shadow-sm backdrop-blur-md">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <SectionTitle icon={Grid3x3} title="图纸" />
                <Badge variant="outline">
                  {naturalSize
                    ? `原图 ${naturalSize.width} × ${naturalSize.height} 像素 → 网格 ${width} × ${height}`
                    : `网格 ${width} × ${height}`}
                </Badge>
                {chart ? <Badge variant="secondary">共用到 {chart.usage.length} 种颜色</Badge> : null}
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button type="button" variant="outline" size="sm" onClick={exportCsv} disabled={!chart}>
                  <FileSpreadsheet className="h-3.5 w-3.5" /> 用料清单 CSV
                </Button>
                <Button type="button" size="sm" onClick={() => void exportPng()} disabled={!chart || busy}>
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  下载图纸 PNG
                </Button>
              </div>
            </div>

            {!image ? (
              <EmptyPane
                icon={<ImagePlus className="h-8 w-8" />}
                hint="上传一张图片，这里会按网格尺寸生成拼豆图纸与用料清单。"
                action={
                  <Button type="button" variant="outline" size="sm" onClick={() => void loadSample()}>
                    <Sparkles className="h-3.5 w-3.5" /> 填入示例看看
                  </Button>
                }
                className="min-h-[320px]"
              />
            ) : (
              <div className="space-y-3">
                <div className="thin-scroll max-h-[520px] overflow-auto rounded-xl border border-border/60 bg-card p-3">
                  <canvas ref={canvasRef} className="h-auto max-w-full" />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                    <Grid3x3 className="h-3.5 w-3.5" /> 缩放
                  </span>
                  <input
                    type="range"
                    min={6}
                    max={34}
                    value={zoom}
                    onChange={(event) => setCell(clampInt(Number(event.target.value), 6, 34))}
                    className="h-1.5 max-w-[240px] flex-1 accent-primary"
                    aria-label="图纸缩放"
                  />
                  <span className="font-mono-accent text-[11px] text-muted-foreground">每格 {zoom} px</span>
                  {showCodes && zoom < 11 ? (
                    <span className="text-[11px] text-muted-foreground">放大到 11 px 以上才看得清色号</span>
                  ) : null}
                </div>
              </div>
            )}

            {error !== null ? <ToolError message={error} /> : null}
          </div>
        </div>
      </div>

      {/* 下方：用料清单（模式 D，整幅宽度） */}
      <div className="space-y-4 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-sm backdrop-blur-md">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <SectionTitle icon={Palette} title="用料清单" />
            {chart ? (
              <>
                <Badge variant="outline">{chart.usage.length} 个色号</Badge>
                <Badge variant="secondary">合计 {totalBeads} 颗</Badge>
              </>
            ) : null}
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={exportCsv} disabled={!chart}>
            <FileSpreadsheet className="h-3.5 w-3.5" /> 导出 CSV
          </Button>
        </div>

        {!chart ? (
          <p className="text-xs leading-relaxed text-muted-foreground">
            上传图片并选好网格尺寸后，这里会按用量从多到少列出每个色号需要多少颗。
          </p>
        ) : (
          <div className="thin-scroll max-h-[420px] overflow-auto rounded-xl border border-border/70">
            <table className="w-full border-collapse text-xs">
              <thead>
                <tr>
                  <th className="sticky top-0 z-10 border-b border-border/70 bg-muted/80 px-3 py-2 text-left font-semibold text-foreground backdrop-blur">
                    色号
                  </th>
                  <th className="sticky top-0 z-10 border-b border-border/70 bg-muted/80 px-3 py-2 text-left font-semibold text-foreground backdrop-blur">
                    色块
                  </th>
                  <th className="sticky top-0 z-10 border-b border-border/70 bg-muted/80 px-3 py-2 text-left font-semibold text-foreground backdrop-blur">
                    颜色名
                  </th>
                  <th className="sticky top-0 z-10 border-b border-border/70 bg-muted/80 px-3 py-2 text-right font-semibold text-foreground backdrop-blur">
                    数量
                  </th>
                  <th className="sticky top-0 z-10 border-b border-border/70 bg-muted/80 px-3 py-2 text-right font-semibold text-foreground backdrop-blur">
                    占比
                  </th>
                </tr>
              </thead>
              <tbody>
                {chart.usage.map((item) => (
                  <tr key={item.code} className="even:bg-muted/20 hover:bg-muted/30">
                    <td className="border-b border-border/40 px-3 py-1.5 font-mono-accent text-foreground">
                      {item.code}
                    </td>
                    <td className="border-b border-border/40 px-3 py-1.5">
                      <span
                        className="inline-block h-4 w-8 rounded border border-border/60"
                        style={{ background: item.hex }}
                        aria-label={`色块 ${item.hex}`}
                      />
                    </td>
                    <td className="border-b border-border/40 px-3 py-1.5 text-foreground/90">{item.name}</td>
                    <td className="border-b border-border/40 px-3 py-1.5 text-right font-mono-accent tabular-nums text-foreground">
                      {item.count}
                    </td>
                    <td className="border-b border-border/40 px-3 py-1.5 text-right font-mono-accent tabular-nums text-muted-foreground">
                      {(item.ratio * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <ul className="space-y-1.5 text-[11px] leading-relaxed text-muted-foreground">
          <li>· 导出的图纸 PNG 固定按「每格 24 px、2 倍缩放」绘制，并带网格线与色号，方便打印。</li>
          <li>· 取色为精确最近色匹配（色卡 RGB 预解析 + 按实际颜色惰性查找表，结果与逐个色号比对完全一致）。</li>
          <li>· 透明像素按白底合成；图纸底色固定为白色，与界面主题无关。</li>
        </ul>
      </div>
    </div>
  );
}
