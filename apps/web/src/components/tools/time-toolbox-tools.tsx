"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlarmClock,
  BellRing,
  CalendarDays,
  Clock3,
  Flag,
  Gauge,
  Hourglass,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Timer,
  Trash2,
  Volume2,
  VolumeX,
} from "lucide-react";
import { Badge, Button, Input, Label, ProgressBar } from "@/components/ui/primitives";
import { CopyButton } from "@/components/tools/copy-button";
import { useToast } from "@/components/ui/toast";
import { useToolDraft } from "@/lib/use-tool-draft";
import { cn } from "@/lib/utils";

/* --- PURE-LOGIC-START ---
   下面这一段是纯函数：不 import React、不碰 DOM，单测直接把这一段切出来在 Node 里跑。
   时间逻辑（下一个触发时刻、倒数日天数差、超 24 小时格式化、秒表统计）全部在这里，
   界面只负责渲染，所以「算错」和「画错」能分开定位。 */

export const MS_SECOND = 1000;
export const MS_MINUTE = 60 * MS_SECOND;
export const MS_HOUR = 60 * MS_MINUTE;
export const MS_DAY = 24 * MS_HOUR;

const WEEKDAY_CN = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

/** 两位补零（取绝对值，符号由调用方负责）。 */
export function pad2(value: number): string {
  return String(Math.floor(Math.abs(value))).padStart(2, "0");
}

/** 把毫秒拆成时/分/秒（向下取整到秒），小时可以超过 24（倒计时需要）。 */
export function splitDuration(ms: number): {
  hours: number;
  minutes: number;
  seconds: number;
  negative: boolean;
  totalSeconds: number;
} {
  const negative = ms < 0;
  const totalSeconds = Math.floor(Math.abs(ms) / MS_SECOND);
  return {
    hours: Math.floor(totalSeconds / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    negative,
    totalSeconds,
  };
}

/**
 * 时长格式化成 HH:MM:SS（小时不限位数，超过 24 小时就是 25:00:00）。
 * 负数保留负号，绝对值向下取整到秒：-1500ms 给 "-00:00:01"。
 */
export function formatDurationHMS(ms: number): string {
  const { hours, minutes, seconds, negative } = splitDuration(ms);
  return `${negative ? "-" : ""}${String(hours).padStart(2, "0")}:${pad2(minutes)}:${pad2(seconds)}`;
}

/**
 * 倒计时用的剩余时间显示：向上取整到秒（还剩 0.2 秒时显示 00:00:01 而不是 00:00:00），
 * 到点或超时一律显示 00:00:00，不会出现负数。
 */
export function countdownSeconds(remainingMs: number): number {
  if (!(remainingMs > 0)) return 0;
  return Math.ceil(remainingMs / MS_SECOND);
}

export function formatCountdown(remainingMs: number): string {
  const total = countdownSeconds(remainingMs);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  return `${String(hours).padStart(2, "0")}:${pad2(minutes)}:${pad2(seconds)}`;
}

/** 秒表读数：不足 1 小时用 MM:SS.mmm，超过 1 小时自动补上小时。 */
export function formatStopwatchTime(ms: number): string {
  const negative = ms < 0;
  const totalMs = Math.abs(Math.floor(ms));
  const hours = Math.floor(totalMs / MS_HOUR);
  const minutes = Math.floor((totalMs % MS_HOUR) / MS_MINUTE);
  const seconds = Math.floor((totalMs % MS_MINUTE) / MS_SECOND);
  const millis = totalMs % MS_SECOND;
  const head = hours > 0 ? `${hours}:${pad2(minutes)}:${pad2(seconds)}` : `${pad2(minutes)}:${pad2(seconds)}`;
  return `${negative ? "-" : ""}${head}.${String(millis).padStart(3, "0")}`;
}

/**
 * 按「固定时区偏移」拆时间，纯整数运算（不依赖运行环境的本地时区），方便单测对答案。
 * offsetMinutes 是「本地时间比 UTC 快多少分钟」，例如东八区是 480。
 */
export function splitClockAt(
  epochMs: number,
  offsetMinutes: number,
): {
  year: number;
  month: number;
  day: number;
  hour24: number;
  minute: number;
  second: number;
  millisecond: number;
  weekday: number;
} {
  const shifted = epochMs + offsetMinutes * MS_MINUTE;
  const days = Math.floor(shifted / MS_DAY);
  const inDay = shifted - days * MS_DAY;
  const utc = new Date(days * MS_DAY);
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
    hour24: Math.floor(inDay / MS_HOUR),
    minute: Math.floor((inDay % MS_HOUR) / MS_MINUTE),
    second: Math.floor((inDay % MS_MINUTE) / MS_SECOND),
    millisecond: Math.round(inDay % MS_SECOND),
    // 1970-01-01 是星期四
    weekday: (((days + 4) % 7) + 7) % 7,
  };
}

/** 按运行环境的本地时区拆时间。 */
export function splitLocalClock(epochMs: number): ReturnType<typeof splitClockAt> {
  return splitClockAt(epochMs, -new Date(epochMs).getTimezoneOffset());
}

/** 12 小时制换算：0 点 -> 12 上午，12 点 -> 12 下午，13 点 -> 1 下午。 */
export function to12Hour(hour24: number): { hour: number; meridiem: "AM" | "PM"; meridiemLabel: string } {
  const meridiem: "AM" | "PM" = hour24 < 12 ? "AM" : "PM";
  const hour = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return { hour, meridiem, meridiemLabel: meridiem === "AM" ? "上午" : "下午" };
}

/** 只产出时间本身（HH:MM / HH:MM:SS），上午下午由界面单独渲染。 */
export function formatClockTime(epochMs: number, options: { hour12: boolean; showSeconds: boolean }): string {
  const parts = splitLocalClock(epochMs);
  const hour = options.hour12 ? to12Hour(parts.hour24).hour : parts.hour24;
  const head = `${pad2(hour)}:${pad2(parts.minute)}`;
  return options.showSeconds ? `${head}:${pad2(parts.second)}` : head;
}

/** 2026年2月14日 */
export function formatDateCN(epochMs: number): string {
  const p = splitLocalClock(epochMs);
  return `${p.year}年${p.month}月${p.day}日`;
}

/** 星期六 */
export function formatWeekdayCN(epochMs: number): string {
  return WEEKDAY_CN[splitLocalClock(epochMs).weekday];
}

export function formatDateInputValue(epochMs: number): string {
  const p = splitLocalClock(epochMs);
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}`;
}

/** date 输入框的值（YYYY-MM-DD）-> 本地零点时间戳；非法日期（如 2026-02-30）返回 null。 */
export function parseDateInput(value: string): number | null {
  const matched = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value.trim());
  if (!matched) return null;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date.getTime();
}

/** time 输入框的值（HH:MM 或 HH:MM:SS）-> 时/分/秒；非法返回 null。 */
export function parseTimeInput(value: string): { hour: number; minute: number; second: number } | null {
  const matched = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/.exec(value.trim());
  if (!matched) return null;
  const hour = Number(matched[1]);
  const minute = Number(matched[2]);
  const second = matched[3] === undefined ? 0 : Number(matched[3]);
  if (hour > 23 || minute > 59 || second > 59) return null;
  return { hour, minute, second };
}

/** 倒计时时长输入：空字符串当作 0，非法（含负数、分秒越界）返回 null。 */
export function parseDurationParts(hours: string, minutes: string, seconds: string): number | null {
  const parsePart = (raw: string): number | null => {
    const text = raw.trim();
    if (text === "") return 0;
    if (!/^\d{1,6}$/.test(text)) return null;
    return Number(text);
  };
  const h = parsePart(hours);
  const m = parsePart(minutes);
  const s = parsePart(seconds);
  if (h === null || m === null || s === null || m > 59 || s > 59) return null;
  return h * MS_HOUR + m * MS_MINUTE + s * MS_SECOND;
}

/** 今天这个钟点的时间戳（可能已经过去）。 */
export function alarmTimestampToday(nowMs: number, hour: number, minute: number, second = 0): number {
  const base = new Date(nowMs);
  return new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, minute, second, 0).getTime();
}

/**
 * 下一个响铃时刻（严格晚于 nowMs）：
 * 今天的钟点还没到就用今天，已经到了（或正好等于当前时刻）就用明天。
 * 跨天/跨月/跨年/闰日全部交给 Date 构造器做日历进位，不用手写月份天数。
 */
export function nextAlarmTimestamp(nowMs: number, hour: number, minute: number, second = 0): number {
  const today = alarmTimestampToday(nowMs, hour, minute, second);
  if (today > nowMs) return today;
  const base = new Date(nowMs);
  return new Date(base.getFullYear(), base.getMonth(), base.getDate() + 1, hour, minute, second, 0).getTime();
}

export interface AlarmItem {
  id: string;
  title: string;
  /** HH:MM，来自 time 输入框 */
  time: string;
  enabled: boolean;
}

export interface AlarmScheduleEntry {
  item: AlarmItem;
  hour: number;
  minute: number;
  atMs: number;
  remainingMs: number;
  isTomorrow: boolean;
}

/** 在所有开启的闹钟里挑出最近的一次响铃。 */
export function nextAlarmFromList(alarms: AlarmItem[], nowMs: number): AlarmScheduleEntry | null {
  let best: AlarmScheduleEntry | null = null;
  for (const item of alarms) {
    if (!item.enabled) continue;
    const parsed = parseTimeInput(item.time);
    if (!parsed) continue;
    const atMs = nextAlarmTimestamp(nowMs, parsed.hour, parsed.minute, parsed.second);
    if (best === null || atMs < best.atMs) {
      best = {
        item,
        hour: parsed.hour,
        minute: parsed.minute,
        atMs,
        remainingMs: atMs - nowMs,
        isTomorrow: atMs - nowMs > MS_DAY - 1,
      };
    }
  }
  return best;
}

/** "还有 2 小时 5 分" 这种短描述（闹钟预告用）。 */
export function describeRemainingShort(ms: number): string {
  if (!(ms > 0)) return "已到时间";
  const total = Math.floor(ms / MS_SECOND);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (days > 0) return `${days} 天 ${hours} 小时`;
  if (hours > 0) return `${hours} 小时 ${minutes} 分`;
  if (minutes > 0) return `${minutes} 分 ${seconds} 秒`;
  return `${seconds} 秒`;
}

/**
 * 倒计时状态机。running 时只存「绝对目标时间戳」，剩余时间永远由 targetMs - nowMs 现算，
 * 所以浏览器把 setInterval/rAF 降频、甚至标签页被冻结，切回来算出来的值都是对的，
 * 不会像「每个 tick 减 20ms」那样累积误差。
 */
export type CountdownState =
  | { status: "idle"; durationMs: number }
  | { status: "running"; durationMs: number; targetMs: number }
  | { status: "paused"; durationMs: number; remainingMs: number }
  | { status: "finished"; durationMs: number };

export function createCountdown(durationMs: number): CountdownState {
  return { status: "idle", durationMs: Math.max(0, Math.round(durationMs)) };
}

export function countdownRemainingMs(state: CountdownState, nowMs: number): number {
  switch (state.status) {
    case "running":
      return Math.max(0, state.targetMs - nowMs);
    case "paused":
      return Math.max(0, state.remainingMs);
    case "idle":
      return Math.max(0, state.durationMs);
    case "finished":
      return 0;
  }
}

export function countdownProgress(state: CountdownState, nowMs: number): number {
  if (state.durationMs <= 0) return state.status === "finished" ? 1 : 0;
  const remaining = countdownRemainingMs(state, nowMs);
  return Math.min(1, Math.max(0, 1 - remaining / state.durationMs));
}

/** 开始 / 继续：把「剩余」换算成一个绝对目标时间戳。 */
export function startCountdown(state: CountdownState, nowMs: number): CountdownState {
  if (state.status === "running") return state;
  const remaining = countdownRemainingMs(state, nowMs);
  return { status: "running", durationMs: state.durationMs, targetMs: nowMs + remaining };
}

export function pauseCountdown(state: CountdownState, nowMs: number): CountdownState {
  if (state.status !== "running") return state;
  return { status: "paused", durationMs: state.durationMs, remainingMs: Math.max(0, state.targetMs - nowMs) };
}

export function resetCountdown(state: CountdownState): CountdownState {
  return createCountdown(state.durationMs);
}

/** 换一个时长：已经跑着的倒计时不打断，只改「重置后」的时长。 */
export function retargetCountdown(state: CountdownState, durationMs: number): CountdownState {
  if (state.status === "running") return { ...state, durationMs };
  return createCountdown(durationMs);
}

/**
 * 每次 tick 调一次：把 running 推进成 finished，并用 justFinished 表示「这一拍刚刚到点」——
 * 界面只在这里触发一次提醒，不会因为降频、重复 tick 而重复响铃。
 */
export function advanceCountdown(
  state: CountdownState,
  nowMs: number,
): { state: CountdownState; justFinished: boolean } {
  if (state.status !== "running") return { state, justFinished: false };
  if (nowMs < state.targetMs) return { state, justFinished: false };
  return { state: { status: "finished", durationMs: state.durationMs }, justFinished: true };
}

/** 本地零点（当天 00:00:00）。 */
export function localDayStart(epochMs: number): number {
  const date = new Date(epochMs);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

/**
 * 本地日历日序号（1970-01-01 本地零点 = 0）。
 * 先把本地年月日取出来，再交给 Date.UTC 求天数差 —— 全程不吃夏令时那天的 23/25 小时。
 */
export function localDayNumber(epochMs: number): number {
  const date = new Date(epochMs);
  return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / MS_DAY;
}

/** 相差几天（正数=未来，负数=过去，同一天=0）。 */
export function daysUntilLocalDay(fromMs: number, toMs: number): number {
  return Math.round(localDayNumber(toMs) - localDayNumber(fromMs));
}

export type DayDiffKind = "future" | "today" | "past";

export function describeDays(days: number): { kind: DayDiffKind; value: number; text: string } {
  if (days > 0) return { kind: "future", value: days, text: `还有 ${days} 天` };
  if (days < 0) return { kind: "past", value: -days, text: `已过 ${-days} 天` };
  return { kind: "today", value: 0, text: "就是今天" };
}

/**
 * 把某个日期整体平移 y 年 m 月（日超出当月天数就取当月最后一天，即 1/31 + 1 月 = 2/29）。
 * 单独抽出来是为了让「年月日差值」有一个可被检验的定义：a + y年m月 ≈ anchor。
 */
export function addMonthsClamped(epochMs: number, years: number, months: number): number {
  const base = new Date(epochMs);
  const year = base.getFullYear() + years;
  const month = base.getMonth() + months;
  const daysInTargetMonth = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(base.getDate(), daysInTargetMonth)).getTime();
}

/**
 * 年月日差值（倒数日卡片的「年月日」显示方式）。两个时间戳都先归到本地零点。
 * 定义：先取尽量大的整年整月，使「起点平移 y 年 m 月」不超过终点，剩下的按天算；
 * 平移时日期溢出取当月最后一天，所以 2024-01-31 -> 2024-03-01 是 0 年 1 个月 1 天。
 */
export function ymdDiff(fromMs: number, toMs: number): {
  years: number;
  months: number;
  days: number;
  negative: boolean;
} {
  const fromDay = localDayStart(fromMs);
  const toDay = localDayStart(toMs);
  const negative = toDay < fromDay;
  const start = negative ? toDay : fromDay;
  const end = negative ? fromDay : toDay;
  const startDate = new Date(start);
  const endDate = new Date(end);
  let years = endDate.getFullYear() - startDate.getFullYear();
  let months = endDate.getMonth() - startDate.getMonth();
  // 先把「月和」归一化到 0..11（等价平移，避免出现「-6 个月」这种读数）
  if (months < 0) {
    months += 12;
    years -= 1;
  }
  let anchor = addMonthsClamped(start, years, months);
  if (anchor > end && (years > 0 || months > 0)) {
    months -= 1;
    if (months < 0) {
      months += 12;
      years -= 1;
    }
    anchor = addMonthsClamped(start, years, months);
  }
  // 两端都归到了本地零点，跨夏令时那天是 23/25 小时，所以四舍五入而不是整除
  const days = Math.round((end - anchor) / MS_DAY);
  return { years, months, days, negative };
}

export function formatYmdDiff(diff: { years: number; months: number; days: number; negative: boolean }): string {
  const parts: string[] = [];
  if (diff.years > 0) parts.push(`${diff.years} 年`);
  if (diff.months > 0) parts.push(`${diff.months} 个月`);
  if (diff.days > 0 || parts.length === 0) parts.push(`${diff.days} 天`);
  return `${diff.negative ? "已过 " : "还有 "}${parts.join(" ")}`;
}

/** 每圈用时（第 1 圈就是累计值，之后是「与上一圈」的差值）。 */
export function lapSplits(laps: number[]): number[] {
  return laps.map((total, index) => (index === 0 ? total : total - laps[index - 1]));
}

export interface LapStats {
  count: number;
  bestMs: number;
  worstMs: number;
  averageMs: number;
  bestIndex: number;
  worstIndex: number;
}

/** 最快 / 最慢 / 平均（并列时取第一次出现的那个）。 */
export function lapStats(splits: number[]): LapStats | null {
  if (splits.length === 0) return null;
  let bestIndex = 0;
  let worstIndex = 0;
  let sum = 0;
  splits.forEach((ms, index) => {
    if (ms < splits[bestIndex]) bestIndex = index;
    if (ms > splits[worstIndex]) worstIndex = index;
    sum += ms;
  });
  return {
    count: splits.length,
    bestMs: splits[bestIndex],
    worstMs: splits[worstIndex],
    averageMs: sum / splits.length,
    bestIndex,
    worstIndex,
  };
}

export interface StopwatchState {
  running: boolean;
  /** 本次开始时的绝对时间戳（running 时有效） */
  startedAt: number;
  /** 之前各段累计（暂停后累加） */
  accumulatedMs: number;
  laps: number[];
}

export function createStopwatch(): StopwatchState {
  return { running: false, startedAt: 0, accumulatedMs: 0, laps: [] };
}

/** 秒表读数同样由绝对时间戳现算，pause 时才落回累计值。 */
export function stopwatchElapsedMs(state: StopwatchState, nowMs: number): number {
  if (!state.running) return state.accumulatedMs;
  return state.accumulatedMs + Math.max(0, nowMs - state.startedAt);
}

export function stopwatchStart(state: StopwatchState, nowMs: number): StopwatchState {
  if (state.running) return state;
  return { ...state, running: true, startedAt: nowMs };
}

export function stopwatchPause(state: StopwatchState, nowMs: number): StopwatchState {
  if (!state.running) return state;
  return {
    ...state,
    running: false,
    accumulatedMs: state.accumulatedMs + Math.max(0, nowMs - state.startedAt),
    startedAt: 0,
  };
}

export function stopwatchLap(state: StopwatchState, nowMs: number): StopwatchState {
  if (!state.running) return state;
  return { ...state, laps: [...state.laps, stopwatchElapsedMs(state, nowMs)] };
}

/**
 * 全屏 / 沉浸模式下的字号：让「字数 × 0.62em ≈ 文本宽度」的时间文本始终贴着可用宽度，
 * 窗口拉大拉小、文字从 8 位变到 12 位都不会溢出，也不会挤在一行外面。
 * 0.97 是留白安全系数（等宽字体真实字宽约 0.6em，这里按 0.62em 再压 3%）。
 */
export function fitFontSizeCss(text: string, maxWidthPercent: number, maxHeightPercent: number): string {
  const chars = Math.max(1, text.length);
  const byWidth = (maxWidthPercent * 0.97) / (0.62 * chars);
  return `min(${byWidth.toFixed(2)}vw, ${maxHeightPercent.toFixed(2)}vh)`;
}

/* --- PURE-LOGIC-END --- */

/* ==========================================================================
   提醒音：Web Audio 现场合成（不引入音频文件，也不引入任何依赖）
   —— 手机闹钟那种「一轮三声、响几秒、可以随时停」的做法。
   ========================================================================== */

export type RingKind = "countdown" | "alarm";

/** 最长响铃时长：到点后最多响这么久，用户可以随时点「停止提醒」。 */
export const RING_DURATION_MS = 30_000;

/** 一轮的间隔与音高（两个模式各用一组上行音，听感上能区分）。 */
const RING_BURST_MS = 1150;
const RING_NOTES: Record<RingKind, number[]> = {
  countdown: [880, 1108.73, 1318.51],
  alarm: [1046.5, 1318.51, 1567.98],
};

let sharedAudioContext: AudioContext | null = null;
let ringOscillators: OscillatorNode[] = [];
let ringOutput: GainNode | null = null;
let ringStopTimer: ReturnType<typeof setTimeout> | null = null;

type WindowWithWebkitAudio = Window & { webkitAudioContext?: typeof AudioContext };

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const ctor = typeof AudioContext !== "undefined" ? AudioContext : (window as WindowWithWebkitAudio).webkitAudioContext;
  if (!ctor) return null;
  try {
    if (!sharedAudioContext) sharedAudioContext = new ctor();
    // 浏览器要求音频上下文在用户手势里被唤醒，所以每次响铃都补一次 resume
    if (sharedAudioContext.state === "suspended") void sharedAudioContext.resume().catch(() => undefined);
    return sharedAudioContext;
  } catch {
    return null;
  }
}

/** 排一声「滴」：带 12ms 淡入淡出，避免爆音。 */
function scheduleBeep(ctx: AudioContext, output: GainNode, frequency: number, atSeconds: number, durationSeconds: number): OscillatorNode {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "triangle";
  osc.frequency.value = frequency;
  gain.gain.setValueAtTime(0.0001, atSeconds);
  gain.gain.linearRampToValueAtTime(0.9, atSeconds + 0.012);
  gain.gain.setValueAtTime(0.9, atSeconds + durationSeconds * 0.55);
  gain.gain.linearRampToValueAtTime(0.0001, atSeconds + durationSeconds);
  osc.connect(gain);
  gain.connect(output);
  osc.start(atSeconds);
  osc.stop(atSeconds + durationSeconds + 0.02);
  return osc;
}

function createOutput(ctx: AudioContext): GainNode {
  const output = ctx.createGain();
  output.gain.value = 0.22;
  output.connect(ctx.destination);
  return output;
}

/** 立刻停掉所有还在排队的音符与定时器（幂等，重复调用安全）。 */
export function stopRingSound(): void {
  if (ringStopTimer !== null) {
    clearTimeout(ringStopTimer);
    ringStopTimer = null;
  }
  for (const osc of ringOscillators) {
    try {
      osc.stop();
    } catch {
      /* 已经自然结束的振荡器再 stop() 是安全的，这里只是兜底 */
    }
    try {
      osc.disconnect();
    } catch {
      /* 同上 */
    }
  }
  ringOscillators = [];
  if (ringOutput) {
    try {
      ringOutput.disconnect();
    } catch {
      /* 同上 */
    }
    ringOutput = null;
  }
}

/** 试听一声（铃声设置里的「试听」按钮）。 */
export function playTestRing(kind: RingKind): void {
  const ctx = getAudioContext();
  if (!ctx) return;
  const output = createOutput(ctx);
  const notes = RING_NOTES[kind];
  const start = ctx.currentTime + 0.03;
  for (let index = 0; index < notes.length; index += 1) {
    scheduleBeep(ctx, output, notes[index], start + index * 0.22, 0.17);
  }
  setTimeout(() => {
    try {
      output.disconnect();
    } catch {
      /* 忽略 */
    }
  }, 1200);
}

/** 开始响铃：一次性把整段（最多 30 秒）的三连音排进音频时钟。 */
export function startRingSound(kind: RingKind): void {
  stopRingSound();
  const ctx = getAudioContext();
  if (!ctx) return;
  const output = createOutput(ctx);
  ringOutput = output;
  const notes = RING_NOTES[kind];
  const start = ctx.currentTime + 0.05;
  const bursts = Math.ceil(RING_DURATION_MS / RING_BURST_MS);
  for (let burst = 0; burst < bursts; burst += 1) {
    for (let index = 0; index < notes.length; index += 1) {
      const at = start + (burst * RING_BURST_MS + index * 0.22) / 1000;
      ringOscillators.push(scheduleBeep(ctx, output, notes[index], at, 0.17));
    }
  }
  ringStopTimer = setTimeout(() => stopRingSound(), RING_DURATION_MS + 300);
}

/* ==========================================================================
   通用 hook
   ========================================================================== */

/**
 * 当前时间。用 rAF 驱动，但按 intervalMs 限频，并且把相位对齐到 intervalMs 的整数倍
 * （1000ms 就是对齐到整秒），所以秒变化是准点跳的，而不是「从挂载时刻起每 1 秒」。
 *
 * 首帧返回 null（服务端渲染与客户端首帧一致，不会水合不一致），挂载后立刻补上真实时间。
 * rAF 在后台标签页会自动暂停，所以额外监听 visibilitychange / focus：切回来立刻校正一次。
 */
function useNow(intervalMs: number): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    const step = Math.max(1, intervalMs);
    let rafId = 0;
    let lastTick = Date.now() - (Date.now() % step);

    const align = () => Date.now() - (Date.now() % step);

    const loop = () => {
      rafId = requestAnimationFrame(loop);
      const current = Date.now();
      if (current - lastTick >= step) {
        lastTick = current - ((current - lastTick) % step);
        setNow(current);
      }
    };

    const resync = () => {
      lastTick = align();
      setNow(Date.now());
    };

    setNow(Date.now());
    rafId = requestAnimationFrame(loop);
    document.addEventListener("visibilitychange", resync);
    window.addEventListener("focus", resync);
    return () => {
      cancelAnimationFrame(rafId);
      document.removeEventListener("visibilitychange", resync);
      window.removeEventListener("focus", resync);
    };
  }, [intervalMs]);

  return now;
}

/** 分段切换器（和媒体工具同一套外观）。 */
function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
  size = "sm",
  testIdPrefix,
}: {
  value: T;
  options: Array<{ value: T; label: string; icon?: React.ReactNode }>;
  onChange: (next: T) => void;
  label: string;
  size?: "sm" | "md";
  testIdPrefix?: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-border/60 bg-muted/30 p-1"
    >
      {options.map((option) => (
        <Button
          key={option.value}
          type="button"
          size="sm"
          variant={option.value === value ? "default" : "ghost"}
          aria-pressed={option.value === value}
          data-testid={testIdPrefix ? `${testIdPrefix}-${option.value}` : undefined}
          onClick={() => onChange(option.value)}
          className={cn(
            "gap-1.5 rounded-lg font-semibold",
            size === "sm" ? "h-7 px-2.5 text-[11px]" : "h-8 px-3 text-xs",
          )}
        >
          {option.icon}
          {option.label}
        </Button>
      ))}
    </div>
  );
}

/** 开关（用按钮做，避免自己造一套 checkbox 样式）。 */
function ToggleChip({
  checked,
  onChange,
  label,
  icon,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  label: string;
  icon?: React.ReactNode;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[11px] font-semibold transition-colors",
        checked
          ? "border-primary/40 bg-primary/15 text-primary"
          : "border-border/60 bg-muted/30 text-muted-foreground hover:text-foreground",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

/** 大字号时间文本：用一个 flex 行拼出 HH:MM:SS，冒号半透明、数字走品牌渐变。 */
function BigTime({
  parts,
  fontSize,
  tone = "gradient",
  className,
  testId,
}: {
  parts: string[];
  fontSize: string;
  tone?: "gradient" | "foreground" | "primary";
  className?: string;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      className={cn(
        "flex max-w-full items-baseline justify-center gap-[0.05em] whitespace-nowrap font-mono-accent font-semibold tabular-nums leading-none tracking-tight",
        tone === "gradient" && "text-gradient",
        tone === "foreground" && "text-foreground",
        tone === "primary" && "text-primary",
        className,
      )}
      style={{ fontSize }}
    >
      {parts.map((part, index) => (
        <span key={`${part}-${index}`} className="contents">
          {index > 0 && (
            <span
              aria-hidden
              style={{
                color: "hsl(var(--primary) / 0.55)",
                WebkitTextFillColor: "hsl(var(--primary) / 0.55)",
              }}
            >
              :
            </span>
          )}
          <span>{part}</span>
        </span>
      ))}
    </div>
  );
}

/* ==========================================================================
   显示区（大屏主角）：每个模式一个 face，纯 props 渲染
   ========================================================================== */

function DigitalFace({
  now,
  hour12,
  showSeconds,
  showDate,
  showWeekday,
  presenting,
}: {
  now: number | null;
  hour12: boolean;
  showSeconds: boolean;
  showDate: boolean;
  showWeekday: boolean;
  presenting: boolean;
}) {
  const text = now === null ? (showSeconds ? "--:--:--" : "--:--") : formatClockTime(now, { hour12, showSeconds });
  const parts = text.split(":");
  const meridiem = now !== null && hour12 ? to12Hour(splitLocalClock(now).hour24).meridiemLabel : null;
  const fontSize = presenting
    ? fitFontSizeCss(`${text} ${meridiem ?? ""}`.trim(), 84, 34)
    : "clamp(2.1rem, 8.5vw, 5rem)";

  return (
    <div className="flex w-full flex-col items-center justify-center gap-3">
      <div className="flex max-w-full items-end justify-center gap-3">
        <BigTime parts={parts} fontSize={fontSize} testId="clock-digits" />
        {meridiem && (
          <span
            className={cn(
              "shrink-0 pb-[0.35em] font-semibold tracking-widest text-primary/80",
              presenting ? "text-[clamp(1rem,3vh,2.4rem)]" : "text-sm",
            )}
          >
            {meridiem}
          </span>
        )}
      </div>
      {(showDate || showWeekday) && (
        <p className={cn("text-muted-foreground", presenting ? "text-[clamp(0.9rem,2.4vh,1.75rem)]" : "text-sm")}>
          {now === null
            ? "--"
            : [showDate ? formatDateCN(now) : null, showWeekday ? formatWeekdayCN(now) : null]
                .filter(Boolean)
                .join(" ")}
        </p>
      )}
    </div>
  );
}

function AnalogFace({
  now,
  smooth,
  showNumbers,
  showSecondHand,
  presenting,
}: {
  now: number | null;
  smooth: boolean;
  showNumbers: boolean;
  showSecondHand: boolean;
  presenting: boolean;
}) {
  const clock = now === null ? null : splitLocalClock(now);
  const seconds = clock === null ? 0 : clock.second + (smooth ? clock.millisecond / 1000 : 0);
  const minutes = clock === null ? 0 : clock.minute + seconds / 60;
  const hours = clock === null ? 0 : (clock.hour24 % 12) + minutes / 60;
  const secondAngle = seconds * 6;
  const minuteAngle = minutes * 6;
  const hourAngle = hours * 30;
  const hand = (angle: number, length: number, width: number, color: string, tail = 0) => (
    <g transform={`rotate(${angle.toFixed(3)} 100 100)`}>
      <line
        x1={100}
        y1={100 + tail}
        x2={100}
        y2={100 - length}
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
      />
    </g>
  );

  return (
    <div className="flex w-full items-center justify-center">
      <svg
        viewBox="0 0 200 200"
        role="img"
        aria-label="模拟时钟"
        data-testid="analog-clock"
        className={cn(
          presenting ? "h-[min(74vh,74vw)] w-[min(74vh,74vw)]" : "h-[min(52vh,320px)] w-[min(52vh,320px)]",
        )}
      >
        <circle cx="100" cy="100" r="95" fill="hsl(var(--card))" stroke="hsl(var(--border))" strokeWidth="1.5" />
        <circle cx="100" cy="100" r="88" fill="none" stroke="hsl(var(--border) / 0.6)" strokeWidth="0.6" />
        {Array.from({ length: 60 }, (_, index) => {
          const major = index % 5 === 0;
          return (
            <line
              key={index}
              x1="100"
              y1={major ? 11 : 14}
              x2="100"
              y2={major ? 21 : 18}
              stroke={major ? "hsl(var(--foreground) / 0.75)" : "hsl(var(--muted-foreground) / 0.55)"}
              strokeWidth={major ? 1.8 : 0.8}
              strokeLinecap="round"
              transform={`rotate(${index * 6} 100 100)`}
            />
          );
        })}
        {showNumbers &&
          Array.from({ length: 12 }, (_, index) => {
            const value = index + 1;
            const angle = (value * 30 * Math.PI) / 180;
            return (
              <text
                key={value}
                x={100 + 72 * Math.sin(angle)}
                y={100 - 72 * Math.cos(angle)}
                textAnchor="middle"
                dominantBaseline="central"
                fontSize="13"
                fontWeight="600"
                fill="hsl(var(--muted-foreground))"
              >
                {value}
              </text>
            );
          })}
        {hand(hourAngle, 46, 5, "hsl(var(--foreground))")}
        {hand(minuteAngle, 68, 3.4, "hsl(var(--foreground))")}
        {showSecondHand && hand(secondAngle, 78, 1.6, "hsl(var(--primary))", 16)}
        <circle cx="100" cy="100" r="4.2" fill="hsl(var(--primary))" />
        <circle cx="100" cy="100" r="1.8" fill="hsl(var(--card))" />
      </svg>
    </div>
  );
}

function CountdownFace({
  now,
  state,
  presenting,
}: {
  now: number | null;
  state: CountdownState;
  presenting: boolean;
}) {
  const reference = now ?? 0;
  const remaining = countdownRemainingMs(state, reference);
  const text = formatCountdown(remaining);
  const progress = countdownProgress(state, reference) * 100;
  const statusText =
    state.status === "idle"
      ? "准备就绪"
      : state.status === "running"
        ? "计时中"
        : state.status === "paused"
          ? "已暂停"
          : "时间到";

  return (
    <div className="flex w-full flex-col items-center justify-center gap-4">
      <BigTime
        parts={text.split(":")}
        testId="countdown-digits"
        fontSize={presenting ? fitFontSizeCss(text, 84, 32) : "clamp(2.1rem, 8.5vw, 5rem)"}
      />
      <div className={cn("w-full", presenting ? "max-w-[46rem] px-2" : "max-w-xl")}>
        <ProgressBar value={progress} />
      </div>
      <div className="flex items-center gap-2">
        <Badge variant={state.status === "finished" ? "default" : "outline"}>{statusText}</Badge>
        <span className={cn("text-muted-foreground", presenting ? "text-[clamp(0.8rem,2vh,1.2rem)]" : "text-xs")}>
          共 {formatDurationHMS(state.durationMs)}
        </span>
      </div>
    </div>
  );
}

function AlarmFace({
  now,
  alarms,
  presenting,
}: {
  now: number | null;
  alarms: AlarmItem[];
  presenting: boolean;
}) {
  const entry = now === null ? null : nextAlarmFromList(alarms, now);
  const enabledCount = alarms.filter((item) => item.enabled).length;
  if (now === null) {
    return <div className="py-10 text-center text-sm text-muted-foreground">正在读取时间…</div>;
  }
  if (!entry) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <AlarmClock className="h-8 w-8 text-muted-foreground/60" />
        <p className="text-sm text-muted-foreground">
          {alarms.length === 0 ? "还没有闹钟，先在下面添加一个" : "闹钟都关着呢，打开任意一个就会开始倒计时"}
        </p>
      </div>
    );
  }
  const text = `${pad2(entry.hour)}:${pad2(entry.minute)}`;
  return (
    <div className="flex w-full flex-col items-center justify-center gap-4">
      <p className={cn("text-muted-foreground", presenting ? "text-[clamp(0.9rem,2.2vh,1.4rem)]" : "text-xs")}>
        {entry.item.title || "闹钟"} · 下一次响铃{entry.isTomorrow ? "明天" : "今天"}
      </p>
      <BigTime
        parts={text.split(":")}
        testId="alarm-next-time"
        fontSize={presenting ? fitFontSizeCss(text, 62, 30) : "clamp(2.1rem, 8.5vw, 5rem)"}
      />
      <p className={cn("text-primary", presenting ? "text-[clamp(1rem,2.8vh,1.9rem)]" : "text-sm")}>
        还有 {describeRemainingShort(entry.remainingMs)}（{formatDateCN(entry.atMs)} {formatWeekdayCN(entry.atMs)}）
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Badge variant="outline">{enabledCount} 个已开启</Badge>
        {alarms.length > 1 && <Badge variant="secondary">共 {alarms.length} 个闹钟</Badge>}
      </div>
    </div>
  );
}

interface DayItem {
  id: string;
  title: string;
  date: string;
}

interface EnrichedDay {
  item: DayItem;
  atMs: number | null;
  days: number | null;
}

function DaysFace({ now, items, presenting }: { now: number | null; items: DayItem[]; presenting: boolean }) {
  const enriched: EnrichedDay[] = useMemo(
    () =>
      items.map((item) => {
        const atMs = parseDateInput(item.date);
        return { item, atMs, days: now === null || atMs === null ? null : daysUntilLocalDay(now, atMs) };
      }),
    [items, now],
  );

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <CalendarDays className="h-8 w-8 text-muted-foreground/60" />
        <p className="text-sm text-muted-foreground">还没有倒数日，先在下面添加一个日期</p>
      </div>
    );
  }

  const sorted = [...enriched].sort((a, b) => {
    const left = a.days ?? Number.MAX_SAFE_INTEGER;
    const right = b.days ?? Number.MAX_SAFE_INTEGER;
    const leftFuture = left >= 0;
    const rightFuture = right >= 0;
    if (leftFuture !== rightFuture) return leftFuture ? -1 : 1;
    return leftFuture ? left - right : right - left;
  });
  const featured = sorted[0];
  const others = sorted.slice(1);
  const featuredDiff = featured.days === null ? null : describeDays(featured.days);
  const featuredYmd =
    featured.atMs === null || now === null ? null : formatYmdDiff(ymdDiff(now, featured.atMs));

  return (
    <div className="flex w-full flex-col gap-4">
      <div
        className={cn(
          "flex flex-col items-center justify-center gap-3 rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent",
          presenting ? "px-6 py-8" : "px-5 py-6",
        )}
      >
        <p className={cn("font-semibold text-foreground", presenting ? "text-[clamp(1rem,2.6vh,1.8rem)]" : "text-sm")}>
          {featured.item.title || "未命名事件"}
        </p>
        <div className="flex max-w-full items-end justify-center gap-2">
          <span
            data-testid="days-featured"
            className="font-mono-accent font-semibold tabular-nums leading-none tracking-tight text-gradient"
            style={{
              fontSize: presenting
                ? fitFontSizeCss(`${featuredDiff?.value ?? 0}`, 44, 26)
                : "clamp(2.4rem, 9vw, 5rem)",
            }}
          >
            {featured.days === null ? "--" : featuredDiff?.value}
          </span>
          <span className={cn("pb-[0.2em] text-primary/80", presenting ? "text-[clamp(1rem,2.6vh,1.8rem)]" : "text-base")}>
            天
          </span>
        </div>
        <p className={cn("text-muted-foreground", presenting ? "text-[clamp(0.85rem,2.1vh,1.3rem)]" : "text-xs")}>
          {featuredDiff?.text} · {featured.atMs === null ? "日期无效" : formatDateCN(featured.atMs)}
          {featuredYmd ? ` · ${featuredYmd}` : ""}
        </p>
      </div>
      {others.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {others.map((entry) => {
            const diff = entry.days === null ? null : describeDays(entry.days);
            return (
              <div
                key={entry.item.id}
                className="flex items-baseline gap-2 rounded-xl border border-border/70 bg-card px-3 py-2 shadow-xs"
              >
                <span className="text-xs text-muted-foreground">{entry.item.title || "未命名事件"}</span>
                <span
                  className={cn(
                    "font-mono-accent text-sm font-semibold tabular-nums",
                    diff?.kind === "past" ? "text-muted-foreground" : "text-primary",
                  )}
                >
                  {diff?.text ?? "--"}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StopwatchFace({
  now,
  state,
  presenting,
}: {
  now: number | null;
  state: StopwatchState;
  presenting: boolean;
}) {
  const reference = now ?? 0;
  const elapsed = now === null ? state.accumulatedMs : stopwatchElapsedMs(state, reference);
  const text = formatStopwatchTime(elapsed);
  const splits = lapSplits(state.laps);
  const stats = lapStats(splits);
  return (
    <div className="flex w-full flex-col items-center justify-center gap-4">
      <BigTime
        parts={[text]}
        tone="foreground"
        testId="stopwatch-elapsed"
        fontSize={presenting ? fitFontSizeCss(text, 82, 26) : "clamp(1.85rem, 7.4vw, 4.4rem)"}
      />
      {stats && (
        <div className="flex flex-wrap items-center justify-center gap-2">
          <Badge variant="success">最快 {formatStopwatchTime(stats.bestMs)}</Badge>
          <Badge variant="secondary">最慢 {formatStopwatchTime(stats.worstMs)}</Badge>
          <Badge variant="outline">平均 {formatStopwatchTime(stats.averageMs)}</Badge>
        </div>
      )}
    </div>
  );
}

/* ==========================================================================
   主工具：时间工具箱
   ========================================================================== */

const TOOL_KEY = "time-toolbox";

type Mode = "digital" | "analog" | "countdown" | "alarm" | "days" | "stopwatch";

const MODES: Array<{ value: Mode; label: string; icon: React.ReactNode }> = [
  { value: "digital", label: "数字时钟", icon: <Clock3 className="h-3.5 w-3.5" /> },
  { value: "analog", label: "模拟时钟", icon: <Gauge className="h-3.5 w-3.5" /> },
  { value: "countdown", label: "倒计时", icon: <Hourglass className="h-3.5 w-3.5" /> },
  { value: "alarm", label: "闹钟", icon: <AlarmClock className="h-3.5 w-3.5" /> },
  { value: "days", label: "倒数日", icon: <CalendarDays className="h-3.5 w-3.5" /> },
  { value: "stopwatch", label: "秒表", icon: <Timer className="h-3.5 w-3.5" /> },
];

const MODE_LABEL: Record<Mode, string> = {
  digital: "数字时钟",
  analog: "模拟时钟",
  countdown: "倒计时",
  alarm: "闹钟",
  days: "倒数日",
  stopwatch: "秒表",
};

const COUNTDOWN_PRESETS: Array<{ label: string; ms: number }> = [
  { label: "1 分钟", ms: MS_MINUTE },
  { label: "3 分钟", ms: 3 * MS_MINUTE },
  { label: "5 分钟", ms: 5 * MS_MINUTE },
  { label: "10 分钟", ms: 10 * MS_MINUTE },
  { label: "25 分钟", ms: 25 * MS_MINUTE },
  { label: "1 小时", ms: MS_HOUR },
];

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function TimeToolboxTool() {
  const { toast } = useToast();

  /* ---- 用户设置（切工具 / 刷新都记得） ---- */
  const [mode, setMode] = useToolDraft<Mode>(TOOL_KEY, "mode", "digital");
  const [hour12, setHour12] = useToolDraft(TOOL_KEY, "hour12", false);
  const [showSeconds, setShowSeconds] = useToolDraft(TOOL_KEY, "showSeconds", true);
  const [showDate, setShowDate] = useToolDraft(TOOL_KEY, "showDate", true);
  const [showWeekday, setShowWeekday] = useToolDraft(TOOL_KEY, "showWeekday", true);
  const [smoothSweep, setSmoothSweep] = useToolDraft(TOOL_KEY, "smoothSweep", true);
  const [showNumbers, setShowNumbers] = useToolDraft(TOOL_KEY, "showNumbers", true);
  const [showSecondHand, setShowSecondHand] = useToolDraft(TOOL_KEY, "showSecondHand", true);
  const [countdownHours, setCountdownHours] = useToolDraft(TOOL_KEY, "countdownHours", "0");
  const [countdownMinutes, setCountdownMinutes] = useToolDraft(TOOL_KEY, "countdownMinutes", "5");
  const [countdownSecondsInput, setCountdownSecondsInput] = useToolDraft(TOOL_KEY, "countdownSeconds", "0");
  const [countdownSound, setCountdownSound] = useToolDraft(TOOL_KEY, "countdownSound", true);
  const [alarms, setAlarms] = useToolDraft<AlarmItem[]>(TOOL_KEY, "alarms", []);
  const [alarmTitle, setAlarmTitle] = useToolDraft(TOOL_KEY, "alarmTitle", "");
  const [alarmTime, setAlarmTime] = useToolDraft(TOOL_KEY, "alarmTime", "07:30");
  const [days, setDays] = useToolDraft<DayItem[]>(TOOL_KEY, "days", []);
  const [dayTitle, setDayTitle] = useToolDraft(TOOL_KEY, "dayTitle", "");
  const [dayDate, setDayDate] = useToolDraft(TOOL_KEY, "dayDate", "");

  /* ---- 运行态 ---- */
  const initialDuration = useMemo(() => parseDurationParts("0", "5", "0") ?? 5 * MS_MINUTE, []);
  const [countdown, setCountdown] = useState<CountdownState>(() => createCountdown(initialDuration));
  const [stopwatch, setStopwatch] = useState<StopwatchState>(() => createStopwatch());
  const [ringing, setRinging] = useState<{ kind: RingKind; title: string } | null>(null);

  /* ---- 全屏 / 沉浸式 ---- */
  const [presenting, setPresenting] = useState(false);
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const [immersiveFallback, setImmersiveFallback] = useState(false);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const wantNativeRef = useRef(false);
  const wasNativeRef = useRef(false);

  const enterStage = useCallback(() => {
    wantNativeRef.current = true;
    setPresenting(true);
  }, []);

  const exitStage = useCallback(() => {
    setPresenting(false);
    setImmersiveFallback(false);
    if (typeof document !== "undefined" && document.fullscreenElement) {
      void document.exitFullscreen().catch(() => undefined);
    }
  }, []);

  // 舞台挂载后再申请系统全屏；被拒绝（非用户手势 / 环境不支持 / 权限）就退化成「沉浸式放大」，
  // 界面照常显示，不会白屏。
  useEffect(() => {
    if (!presenting || !wantNativeRef.current) return;
    wantNativeRef.current = false;
    const element = stageRef.current;
    if (!element) return;
    if (typeof element.requestFullscreen !== "function" || document.fullscreenEnabled === false) {
      setImmersiveFallback(true);
      return;
    }
    let cancelled = false;
    element.requestFullscreen({ navigationUI: "hide" }).then(
      () => {
        if (cancelled) return;
        wasNativeRef.current = true;
        setNativeFullscreen(true);
        setImmersiveFallback(false);
      },
      () => {
        if (cancelled) return;
        setNativeFullscreen(false);
        setImmersiveFallback(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [presenting]);

  // 系统全屏被 Esc 关掉时（fullscreenchange 与 fullscreenElement 同时变化）要同步收起舞台
  useEffect(() => {
    const onFullscreenChange = () => {
      const active = document.fullscreenElement !== null && document.fullscreenElement === stageRef.current;
      setNativeFullscreen(active);
      if (active) {
        wasNativeRef.current = true;
        return;
      }
      if (wasNativeRef.current) {
        wasNativeRef.current = false;
        setPresenting(false);
        setImmersiveFallback(false);
      }
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  // 沉浸式模式没有系统全屏，Esc 要自己接管；同时锁掉底层页面的滚动
  useEffect(() => {
    if (!presenting) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.fullscreenElement) {
        event.preventDefault();
        setPresenting(false);
        setImmersiveFallback(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [presenting]);

  /* ---- 当前 tick 频率：每个模式自己的需求，最大 1 秒一次 ---- */
  const intervalMs = useMemo(() => {
    if (mode === "stopwatch") return stopwatch.running ? 33 : 1000;
    if (mode === "analog") return smoothSweep && showSecondHand ? 33 : 1000;
    if (mode === "countdown") return countdown.status === "running" ? 200 : 1000;
    return 1000;
  }, [mode, stopwatch.running, smoothSweep, showSecondHand, countdown.status]);
  const now = useNow(intervalMs);

  /* ---- 提醒音：响铃状态一变就开声，状态清掉（或组件卸载）就立刻停 ---- */
  const stopRing = useCallback(() => {
    setRinging(null);
  }, []);

  useEffect(() => {
    if (!ringing) return;
    startRingSound(ringing.kind);
    const autoStop = setTimeout(() => setRinging(null), RING_DURATION_MS);
    return () => {
      clearTimeout(autoStop);
      stopRingSound();
    };
  }, [ringing]);

  // 无论依赖怎么变，卸载时都保证音频与定时器被清干净
  useEffect(() => () => stopRingSound(), []);

  const beginRing = useCallback((kind: RingKind, title: string) => {
    setRinging({ kind, title });
  }, []);

  /* ---- 倒计时时长输入 -> 状态机 ---- */
  const countdownDurationMs = useMemo(
    () => parseDurationParts(countdownHours, countdownMinutes, countdownSecondsInput),
    [countdownHours, countdownMinutes, countdownSecondsInput],
  );
  const countdownDurationInvalid = countdownDurationMs === null;

  useEffect(() => {
    if (countdownDurationMs === null) return;
    setCountdown((prev) => retargetCountdown(prev, countdownDurationMs));
  }, [countdownDurationMs]);

  const countdownRef = useRef(countdown);
  countdownRef.current = countdown;
  const firedTargetRef = useRef<number | null>(null);

  /** 到点判定：只有 advanceCountdown 说「这一拍刚到点」才响，且同一个目标只响一次。 */
  const checkCountdown = useCallback(
    (atMs: number) => {
      const current = countdownRef.current;
      const { state, justFinished } = advanceCountdown(current, atMs);
      if (!justFinished) return;
      const target = current.status === "running" ? current.targetMs : null;
      if (target !== null && firedTargetRef.current === target) return;
      firedTargetRef.current = target;
      setCountdown(state);
      if (countdownSound) beginRing("countdown", "倒计时结束");
    },
    [beginRing, countdownSound],
  );

  useEffect(() => {
    if (now === null) return;
    checkCountdown(now);
  }, [now, checkCountdown]);

  // 标签页在后台时 rAF 会停，用绝对目标时间戳排一个兜底定时器（浏览器后台定时器粒度约 1 秒）
  const countdownTargetMs = countdown.status === "running" ? countdown.targetMs : null;
  useEffect(() => {
    if (countdownTargetMs === null) return;
    const delay = Math.max(0, countdownTargetMs - Date.now());
    const timer = setTimeout(() => checkCountdown(Date.now()), delay);
    return () => clearTimeout(timer);
  }, [countdownTargetMs, checkCountdown]);

  /* ---- 闹钟：跨过某个整分就响，同样基于绝对时间戳 ---- */
  const alarmsRef = useRef(alarms);
  alarmsRef.current = alarms;
  const lastAlarmCheckRef = useRef<number | null>(null);

  useEffect(() => {
    if (now === null) return;
    const previous = lastAlarmCheckRef.current;
    lastAlarmCheckRef.current = now;
    if (previous === null) return;
    // 后台被冻结很久时只看「这一次检查窗口」里的整分点，避免补响一串历史闹钟
    for (const item of alarmsRef.current) {
      if (!item.enabled) continue;
      const parsed = parseTimeInput(item.time);
      if (!parsed) continue;
      const occurrence = alarmTimestampToday(now, parsed.hour, parsed.minute, parsed.second);
      if (occurrence > previous && occurrence <= now) {
        beginRing("alarm", item.title ? `${item.title} 时间到` : "闹钟时间到");
        break;
      }
    }
  }, [now, beginRing]);

  /* ---- 全屏舞台开关 ---- */
  const nextAlarmEntry = useMemo(() => (now === null ? null : nextAlarmFromList(alarms, now)), [alarms, now]);

  /* ---- 各模式的操作 ---- */
  const startCountdownNow = useCallback(() => {
    setCountdown((prev) => startCountdown(prev, Date.now()));
  }, []);
  const pauseCountdownNow = useCallback(() => {
    setCountdown((prev) => pauseCountdown(prev, Date.now()));
  }, []);
  const resetCountdownNow = useCallback(() => {
    firedTargetRef.current = null;
    setCountdown((prev) => resetCountdown(prev));
    setRinging(null);
  }, []);

  const toggleStopwatch = useCallback(() => {
    setStopwatch((prev) => (prev.running ? stopwatchPause(prev, Date.now()) : stopwatchStart(prev, Date.now())));
  }, []);
  const lapStopwatch = useCallback(() => {
    setStopwatch((prev) => stopwatchLap(prev, Date.now()));
  }, []);
  const resetStopwatch = useCallback(() => {
    setStopwatch(createStopwatch());
  }, []);

  const addAlarm = useCallback(() => {
    const parsed = parseTimeInput(alarmTime);
    if (!parsed) {
      toast({ title: "时间格式不对", description: "请填 24 小时制的 HH:MM，例如 07:30", variant: "error" });
      return;
    }
    const item: AlarmItem = {
      id: makeId("alarm"),
      title: alarmTitle.trim() || "闹钟",
      time: `${pad2(parsed.hour)}:${pad2(parsed.minute)}`,
      enabled: true,
    };
    setAlarms((prev) => [...prev, item]);
    setAlarmTitle("");
    toast({ title: `已设置 ${item.time} 的闹钟`, variant: "success", duration: 1600 });
  }, [alarmTime, alarmTitle, setAlarms, setAlarmTitle, toast]);

  const addSampleAlarm = useCallback(() => {
    const samples: AlarmItem[] = [
      { id: makeId("alarm"), title: "起床", time: "07:30", enabled: true },
      { id: makeId("alarm"), title: "午休结束", time: "13:50", enabled: false },
    ];
    setAlarms(samples);
    toast({ title: "已填入两个示例闹钟", variant: "success", duration: 1600 });
  }, [setAlarms, toast]);

  const addDay = useCallback(() => {
    const atMs = parseDateInput(dayDate);
    if (atMs === null) {
      toast({ title: "请选择有效日期", description: "点日期框挑一天，或者按 YYYY-MM-DD 填", variant: "error" });
      return;
    }
    const item: DayItem = { id: makeId("day"), title: dayTitle.trim() || "未命名事件", date: formatDateInputValue(atMs) };
    setDays((prev) => [...prev, item]);
    setDayTitle("");
    setDayDate("");
    toast({ title: "已添加倒数日", variant: "success", duration: 1600 });
  }, [dayDate, dayTitle, setDayDate, setDays, setDayTitle, toast]);

  const addSampleDays = useCallback(() => {
    const base = Date.now();
    const nextYear = new Date(new Date(base).getFullYear() + 1, 0, 1).getTime();
    const samples: DayItem[] = [
      { id: makeId("day"), title: "下一个元旦", date: formatDateInputValue(nextYear) },
      { id: makeId("day"), title: "100 天后的今天", date: formatDateInputValue(base + 100 * MS_DAY) },
      { id: makeId("day"), title: "今天", date: formatDateInputValue(base) },
    ];
    setDays(samples);
    toast({ title: "已填入三个示例倒数日", variant: "success", duration: 1600 });
  }, [setDays, toast]);

  /* ---- 显示区 ---- */
  const reference = now ?? 0;
  const stopwatchText = formatStopwatchTime(now === null ? stopwatch.accumulatedMs : stopwatchElapsedMs(stopwatch, reference));

  const display = (() => {
    switch (mode) {
      case "digital":
        return (
          <DigitalFace
            now={now}
            hour12={hour12}
            showSeconds={showSeconds}
            showDate={showDate}
            showWeekday={showWeekday}
            presenting={presenting}
          />
        );
      case "analog":
        return (
          <AnalogFace
            now={now}
            smooth={smoothSweep}
            showNumbers={showNumbers}
            showSecondHand={showSecondHand}
            presenting={presenting}
          />
        );
      case "countdown":
        return <CountdownFace now={now} state={countdown} presenting={presenting} />;
      case "alarm":
        return <AlarmFace now={now} alarms={alarms} presenting={presenting} />;
      case "days":
        return <DaysFace now={now} items={days} presenting={presenting} />;
      case "stopwatch":
        return <StopwatchFace now={now} state={stopwatch} presenting={presenting} />;
      default:
        return null;
    }
  })();

  /* ---- 全屏里只留最小必要的操作 ---- */
  const stageControls = (() => {
    if (mode === "countdown") {
      return (
        <div className="flex items-center justify-center gap-3">
          <Button size="lg" data-testid="stage-countdown-start" onClick={countdown.status === "running" ? pauseCountdownNow : startCountdownNow}>
            {countdown.status === "running" ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {countdown.status === "running" ? "暂停" : countdown.status === "paused" ? "继续" : "开始"}
          </Button>
          <Button size="lg" variant="outline" onClick={resetCountdownNow}>
            <RotateCcw className="h-4 w-4" />
            重置
          </Button>
        </div>
      );
    }
    if (mode === "stopwatch") {
      return (
        <div className="flex items-center justify-center gap-3">
          <Button size="lg" data-testid="stage-stopwatch-toggle" onClick={toggleStopwatch}>
            {stopwatch.running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
            {stopwatch.running ? "暂停" : "开始"}
          </Button>
          <Button size="lg" variant="outline" data-testid="stage-stopwatch-lap" onClick={lapStopwatch} disabled={!stopwatch.running}>
            <Flag className="h-4 w-4" />
            计次
          </Button>
          <Button size="lg" variant="ghost" onClick={resetStopwatch}>
            <RotateCcw className="h-4 w-4" />
            重置
          </Button>
        </div>
      );
    }
    if (mode === "alarm") {
      return (
        <p className="text-center text-xs text-muted-foreground">
          {nextAlarmEntry ? `下一次响铃：${formatDateCN(nextAlarmEntry.atMs)} ${pad2(nextAlarmEntry.hour)}:${pad2(nextAlarmEntry.minute)}` : "没有已开启的闹钟"}
        </p>
      );
    }
    return null;
  })();

  /* ---- 舞台（全屏 / 沉浸式） ---- */
  const stage = presenting ? (
    <div
      ref={stageRef}
      data-testid="stage-overlay"
      data-native-fullscreen={nativeFullscreen ? "true" : "false"}
      className="fixed inset-0 z-[60] flex flex-col overflow-hidden bg-background"
    >
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60rem 40rem at 50% 8%, hsl(var(--brand-1) / 0.10), transparent 62%), radial-gradient(52rem 36rem at 82% 108%, hsl(var(--brand-3) / 0.08), transparent 60%)",
        }}
      />
      <header className="relative flex items-center justify-between gap-3 px-5 py-3.5 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-2 font-semibold tracking-wide">
          {MODES.find((item) => item.value === mode)?.icon}
          {MODE_LABEL[mode]}
        </span>
        <span className="flex items-center gap-3">
          <span className="hidden font-mono-accent sm:inline">按 Esc 退出全屏</span>
          {immersiveFallback && <Badge variant="outline">沉浸式放大（系统全屏不可用）</Badge>}
          <Button size="sm" variant="outline" onClick={exitStage} data-testid="exit-stage">
            <Minimize2 className="h-4 w-4" />
            退出
          </Button>
        </span>
      </header>
      <div className="relative flex min-h-0 flex-1 items-center justify-center px-4">{display}</div>
      <footer className="relative flex min-h-[4.5rem] items-center justify-center px-6 pb-6 pt-2">{stageControls}</footer>
    </div>
  ) : null;

  /* ---- 常规布局：顶部模式切换 + 大面积显示区 + 对应设置 ---- */
  const controls = (() => {
    switch (mode) {
      case "digital":
        return (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <SegmentedControl
                label="小时制"
                value={hour12 ? "12" : "24"}
                onChange={(next) => setHour12(next === "12")}
                options={[
                  { value: "24", label: "24 小时制" },
                  { value: "12", label: "12 小时制" },
                ]}
              />
              <ToggleChip checked={showSeconds} onChange={setShowSeconds} label="显示秒" />
              <ToggleChip checked={showDate} onChange={setShowDate} label="显示日期" />
              <ToggleChip checked={showWeekday} onChange={setShowWeekday} label="显示星期" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <CopyButton
                value={now === null ? "" : `${formatDateCN(now)} ${formatWeekdayCN(now)} ${formatClockTime(now, { hour12, showSeconds: true })}`}
                label="复制当前时间"
              />
              <span className="text-xs text-muted-foreground">时间取自你这台电脑的系统时钟</span>
            </div>
          </div>
        );
      case "analog":
        return (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <ToggleChip checked={smoothSweep} onChange={setSmoothSweep} label="秒针连续扫动" />
              <ToggleChip checked={showNumbers} onChange={setShowNumbers} label="显示数字刻度" />
              <ToggleChip checked={showSecondHand} onChange={setShowSecondHand} label="显示秒针" />
            </div>
            <p className="text-xs text-muted-foreground">
              秒针连续扫动按 33ms 一帧走时，关掉后是每秒跳一下的传统走法。
            </p>
          </div>
        );
      case "countdown":
        return (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 sm:max-w-md">
              <div className="space-y-1.5">
                <Label htmlFor="cd-h">小时</Label>
                <Input
                  id="cd-h"
                  inputMode="numeric"
                  value={countdownHours}
                  onChange={(event) => setCountdownHours(event.target.value.replace(/[^\d]/g, "").slice(0, 6))}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cd-m">分钟</Label>
                <Input
                  id="cd-m"
                  inputMode="numeric"
                  value={countdownMinutes}
                  onChange={(event) => setCountdownMinutes(event.target.value.replace(/[^\d]/g, "").slice(0, 2))}
                  placeholder="0"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cd-s">秒</Label>
                <Input
                  id="cd-s"
                  inputMode="numeric"
                  value={countdownSecondsInput}
                  onChange={(event) => setCountdownSecondsInput(event.target.value.replace(/[^\d]/g, "").slice(0, 2))}
                  placeholder="0"
                />
              </div>
            </div>
            {countdownDurationInvalid && (
              <div className="flex items-center gap-2 rounded-xl border-l-4 border-l-destructive bg-destructive/10 px-4 py-3 font-mono text-xs text-destructive">
                分钟和秒请填 0 到 59 之间的整数
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2">
              {COUNTDOWN_PRESETS.map((preset) => (
                <Button
                  key={preset.label}
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    const total = Math.floor(preset.ms / MS_SECOND);
                    setCountdownHours(String(Math.floor(total / 3600)));
                    setCountdownMinutes(String(Math.floor((total % 3600) / 60)));
                    setCountdownSecondsInput(String(total % 60));
                  }}
                >
                  {preset.label}
                </Button>
              ))}
              <span className="font-mono-accent text-xs text-muted-foreground">
                当前设置 {formatDurationHMS(countdownDurationMs ?? 0)}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button
                data-testid="countdown-start"
                onClick={countdown.status === "running" ? pauseCountdownNow : startCountdownNow}
                disabled={countdownDurationInvalid || countdownDurationMs === 0}
              >
                {countdown.status === "running" ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {countdown.status === "running" ? "暂停" : countdown.status === "paused" ? "继续" : "开始"}
              </Button>
              <Button variant="outline" onClick={resetCountdownNow} data-testid="countdown-reset">
                <RotateCcw className="h-4 w-4" />
                重置
              </Button>
              <ToggleChip
                checked={countdownSound}
                onChange={setCountdownSound}
                label={countdownSound ? "到点响铃" : "静音"}
                icon={countdownSound ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
              />
              <Button variant="ghost" size="sm" onClick={() => playTestRing("countdown")}>
                试听
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              到点会响 30 秒并全屏闪烁提醒，可以随时点「停止提醒」；倒计时按绝对时间戳推进，标签页在后台也不会走偏。
            </p>
          </div>
        );
      case "alarm":
        return (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_180px_auto] sm:items-end">
              <div className="space-y-1.5">
                <Label htmlFor="alarm-title">闹钟标题</Label>
                <Input
                  id="alarm-title"
                  value={alarmTitle}
                  maxLength={20}
                  placeholder="起床、开会、吃药…"
                  onChange={(event) => setAlarmTitle(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="alarm-time">响铃时间</Label>
                <Input id="alarm-time" type="time" value={alarmTime} onChange={(event) => setAlarmTime(event.target.value)} />
              </div>
              <div className="flex gap-2">
                <Button onClick={addAlarm} data-testid="alarm-add">
                  <Plus className="h-4 w-4" />
                  添加
                </Button>
                <Button variant="outline" onClick={() => playTestRing("alarm")}>
                  试听
                </Button>
              </div>
            </div>
            {alarms.length === 0 ? (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-border/60 bg-muted/30 px-4 py-3">
                <p className="text-xs text-muted-foreground">还没有闹钟。时间是「每天」的，今天已经过了就明天响。</p>
                <Button size="sm" variant="outline" onClick={addSampleAlarm} data-testid="alarm-sample">
                  填入示例
                </Button>
              </div>
            ) : (
              <ul className="space-y-2">
                {alarms.map((item) => {
                  const parsed = parseTimeInput(item.time);
                  const nextAt =
                    parsed && now !== null ? nextAlarmTimestamp(now, parsed.hour, parsed.minute, parsed.second) : null;
                  return (
                    <li
                      key={item.id}
                      className={cn(
                        "flex flex-wrap items-center gap-3 rounded-xl border px-4 py-3",
                        item.enabled ? "border-primary/30 bg-primary/[0.06]" : "border-border/60 bg-muted/20",
                      )}
                    >
                      <span
                        className={cn(
                          "font-mono-accent text-lg font-semibold tabular-nums",
                          item.enabled ? "text-primary" : "text-muted-foreground",
                        )}
                      >
                        {item.time}
                      </span>
                      <span className="text-sm text-foreground">{item.title}</span>
                      {nextAt !== null && (
                        <span className="text-xs text-muted-foreground">
                          下次 {formatDateCN(nextAt)} {formatWeekdayCN(nextAt)}（{describeRemainingShort(nextAt - (now ?? 0))}后）
                        </span>
                      )}
                      <span className="ml-auto flex items-center gap-2">
                        <ToggleChip
                          checked={item.enabled}
                          label={item.enabled ? "已开启" : "已关闭"}
                          onChange={(next) =>
                            setAlarms((prev) => prev.map((entry) => (entry.id === item.id ? { ...entry, enabled: next } : entry)))
                          }
                        />
                        <Button
                          size="sm"
                          variant="ghost"
                          aria-label="删除这个闹钟"
                          onClick={() => setAlarms((prev) => prev.filter((entry) => entry.id !== item.id))}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" variant="ghost" onClick={() => setAlarms([])} disabled={alarms.length === 0}>
                清空全部
              </Button>
              <p className="text-xs text-muted-foreground">
                网页闹钟需要保持本页打开（最小化可以，关掉页面就不会响）。
              </p>
            </div>
          </div>
        );
      case "days":
        return (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[1fr_200px_auto] sm:items-end">
              <div className="space-y-1.5">
                <Label htmlFor="day-title">事件名称</Label>
                <Input
                  id="day-title"
                  value={dayTitle}
                  maxLength={20}
                  placeholder="生日、考试、项目上线…"
                  onChange={(event) => setDayTitle(event.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="day-date">日期</Label>
                <Input id="day-date" type="date" value={dayDate} onChange={(event) => setDayDate(event.target.value)} />
              </div>
              <Button onClick={addDay} data-testid="days-add">
                <Plus className="h-4 w-4" />
                添加
              </Button>
            </div>
            {days.length > 0 && (
              <ul className="space-y-2">
                {days.map((item) => {
                  const atMs = parseDateInput(item.date);
                  const diff = atMs === null || now === null ? null : describeDays(daysUntilLocalDay(now, atMs));
                  const ymd = atMs === null || now === null ? null : formatYmdDiff(ymdDiff(now, atMs));
                  return (
                    <li key={item.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border/70 bg-card px-4 py-3 shadow-xs">
                      <span className="text-sm font-semibold text-foreground">{item.title}</span>
                      <span className="font-mono-accent text-xs text-muted-foreground">{item.date}</span>
                      <span
                        className={cn(
                          "font-mono-accent text-sm font-semibold tabular-nums",
                          diff?.kind === "past" ? "text-muted-foreground" : diff?.kind === "today" ? "text-primary" : "text-primary",
                        )}
                      >
                        {diff?.text ?? "日期无效"}
                      </span>
                      {ymd && <span className="text-xs text-muted-foreground">{ymd}</span>}
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto"
                        aria-label="删除这个倒数日"
                        onClick={() => setDays((prev) => prev.filter((entry) => entry.id !== item.id))}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="flex flex-wrap items-center gap-3">
              {days.length === 0 && (
                <Button size="sm" variant="outline" onClick={addSampleDays} data-testid="days-sample">
                  填入示例
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setDays([])} disabled={days.length === 0}>
                清空
              </Button>
              <p className="text-xs text-muted-foreground">天数按本地日期的零点相减，夏令时那天也不会差一天。</p>
            </div>
          </div>
        );
      case "stopwatch":
        return (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={toggleStopwatch} data-testid="stopwatch-toggle">
                {stopwatch.running ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                {stopwatch.running ? "暂停" : stopwatch.laps.length > 0 || stopwatch.accumulatedMs > 0 ? "继续" : "开始"}
              </Button>
              <Button variant="outline" onClick={lapStopwatch} disabled={!stopwatch.running} data-testid="stopwatch-lap">
                <Flag className="h-4 w-4" />
                计次
              </Button>
              <Button variant="ghost" onClick={resetStopwatch} data-testid="stopwatch-reset">
                <RotateCcw className="h-4 w-4" />
                重置
              </Button>
              {stopwatch.laps.length > 0 && (
                <CopyButton
                  value={stopwatch.laps
                    .map((total, index) => `${index + 1}\t累计 ${formatStopwatchTime(total)}\t单圈 ${formatStopwatchTime(lapSplits(stopwatch.laps)[index])}`)
                    .join("\n")}
                  label="复制计次"
                />
              )}
            </div>
            {stopwatch.laps.length > 0 ? (
              <div className="overflow-hidden rounded-xl border border-border/70">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="bg-muted/40 text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-3 py-2 text-left font-semibold">圈次</th>
                      <th className="px-3 py-2 text-right font-semibold">单圈</th>
                      <th className="px-3 py-2 text-right font-semibold">累计</th>
                      <th className="px-3 py-2 text-right font-semibold">与最快比</th>
                    </tr>
                  </thead>
                  <tbody className="font-mono-accent tabular-nums">
                    {stopwatch.laps.map((total, index) => {
                      const splits = lapSplits(stopwatch.laps);
                      const stats = lapStats(splits);
                      const isBest = stats !== null && stats.count > 1 && index === stats.bestIndex;
                      const isWorst = stats !== null && stats.count > 1 && index === stats.worstIndex;
                      return (
                        <tr key={index} className="border-t border-border/40 even:bg-muted/20">
                          <td className="px-3 py-2 text-left">
                            第 {index + 1} 圈
                            {isBest && <span className="ml-2 text-[11px] font-semibold text-success">最快</span>}
                            {isWorst && <span className="ml-2 text-[11px] font-semibold text-destructive">最慢</span>}
                          </td>
                          <td className={cn("px-3 py-2 text-right", isBest && "text-success", isWorst && "text-destructive")}>
                            {formatStopwatchTime(splits[index])}
                          </td>
                          <td className="px-3 py-2 text-right text-muted-foreground">{formatStopwatchTime(total)}</td>
                          <td className="px-3 py-2 text-right text-muted-foreground">
                            {stats === null || stats.count < 2 ? "—" : `+${formatStopwatchTime(splits[index] - stats.bestMs)}`}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">
                开始后按「计次」记录每一圈，表格里同时给出单圈用时与累计用时，并标注最快最慢。
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              读数由 {now === null ? "系统时钟" : "绝对时间戳"}现算（不是每帧累加），所以后台降频也不会走慢。
            </p>
          </div>
        );
      default:
        return null;
    }
  })();

  const stageHint = (() => {
    if (mode === "countdown" && countdownSound) return "到点会响铃 30 秒并用闪烁提醒";
    if (mode === "alarm") return "到点会响铃 30 秒；需要保持本页打开";
    return null;
  })();

  return (
    <div className="space-y-5">
      {presenting ? (
        stage
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-4 py-3">
            <SegmentedControl
              label="时间工具模式"
              size="md"
              value={mode}
              options={MODES}
              testIdPrefix="mode"
              onChange={(next) => setMode(next)}
            />
            <div className="flex items-center gap-2">
              {stageHint && <span className="hidden text-[11px] text-muted-foreground sm:inline">{stageHint}</span>}
              <Button variant="outline" onClick={enterStage} data-testid="enter-stage">
                <Maximize2 className="h-4 w-4" />
                全屏
              </Button>
            </div>
          </div>

          <div className="relative rounded-2xl border border-border/70 bg-card/60 p-5 shadow-sm backdrop-blur-md sm:p-6">
            <div className="flex min-h-[240px] items-center justify-center py-2">{display}</div>
          </div>

          <div className="rounded-2xl border border-border/70 bg-card p-5 shadow-xs sm:p-6">{controls}</div>
        </>
      )}

      {ringing && (
        <>
          <div
            aria-hidden
            className="pointer-events-none fixed inset-0 z-[65] animate-pulse bg-destructive/10"
            data-testid="ring-flash"
          />
          <div className="pointer-events-none fixed inset-x-0 top-4 z-[70] flex justify-center px-4" data-ringing="true">
            <div className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-2xl border border-destructive/40 bg-card/90 px-5 py-3 shadow-sm backdrop-blur-md">
              <BellRing className="h-5 w-5 animate-pulse text-destructive" />
              <span className="text-sm font-semibold text-destructive">{ringing.title}</span>
              <span className="font-mono-accent text-xs text-muted-foreground">
                {formatClockTime(now ?? Date.now(), { hour12: false, showSeconds: true })} · 响铃中
              </span>
              <Button variant="destructive" size="sm" onClick={stopRing} data-testid="stop-ring">
                停止提醒
              </Button>
            </div>
          </div>
        </>
      )}

      {!presenting && (
        <p className="text-center text-[11px] text-muted-foreground">
          秒表读数 {stopwatchText}
          {nextAlarmEntry
            ? ` · 下一次闹钟 ${formatDateCN(nextAlarmEntry.atMs)} ${pad2(nextAlarmEntry.hour)}:${pad2(nextAlarmEntry.minute)}`
            : ""}
        </p>
      )}
    </div>
  );
}
