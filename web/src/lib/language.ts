import { v67Message } from "./locales/v67-messages";
import { v66Message } from "./locales/v66-messages";
import { useSyncExternalStore } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ENGLISH, CONTEXT_EN, MESSAGE_KEYS } from "./locales/en";

export type Language = "zh-CN" | "en";
const KEY = "furinakit:language";
const EVENT = "furinakit:language-changed";
const listeners = new Set<() => void>();
let initialized = false;
let revision = 0;
function storedLanguage(): Language {
  try { return localStorage.getItem(KEY) === "en" ? "en" : "zh-CN"; }
  catch { return "zh-CN"; }
}
let current: Language = storedLanguage();
export function language(): Language { return current; }
function publish(next: Language, persist = true) {
  const changed = next !== current;
  current = next;
  if (persist) { try { localStorage.setItem(KEY, next); } catch { /* Native preference remains authoritative. */ } }
  if (typeof document !== "undefined") {
    document.documentElement.lang = next;
    document.documentElement.dataset.language = next;
  }
  if (changed) listeners.forEach(fn => fn());
}
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
export function useLanguage() { return useSyncExternalStore(subscribe, language, () => "zh-CN" as Language); }

/** One explicit settings action; no reload, remount, file change or translation request. */
export async function setLanguage(next: Language): Promise<void> {
  if (next !== "zh-CN" && next !== "en") throw new Error("Unsupported interface language");
  ++revision;
  if (isTauri()) await invoke("set_ui_language", { language: next });
  else localStorage.setItem(KEY, next); // Report unavailable browser storage instead of claiming it saved.
  publish(next);
}
export async function initializeLanguage(): Promise<void> {
  if (initialized || typeof window === "undefined") return;
  initialized = true;
  publish(current, false);
  window.addEventListener("storage", event => {
    if (event.key === KEY || event.key === null) { ++revision; publish(storedLanguage(), false); }
  });
  if (!isTauri()) return;
  try {
    // Install the event listener first so an overlapping change cannot be overwritten by bootstrap.
    await listen<Language>(EVENT, event => {
      if (event.payload === "en" || event.payload === "zh-CN") { ++revision; publish(event.payload); }
    });
    const before = revision;
    const saved = await invoke<Language>("get_ui_language");
    if (before === revision && (saved === "en" || saved === "zh-CN")) publish(saved);
  } catch (error) { console.warn("Could not synchronize the interface language", error); }
}

/** Only call at authored interface-copy positions. Never apply to input values, filenames or document contents. */
function lookup(table: Readonly<Record<string,string>> | undefined, key: string): string | undefined {
  return table && Object.prototype.hasOwnProperty.call(table,key) ? table[key] : undefined;
}
export function uiText<T>(value: T, context?: string): T {
  if (current !== "en" || typeof value !== "string") return value;
  return (lookup(context ? CONTEXT_EN[context] : undefined, value) ?? lookup(ENGLISH,value) ?? value) as T;
}
export function createUiText(context: string) { return <T>(value: T): T => uiText(value, context); }
export function tr(zh: string, en: string) { return current === "en" ? en : zh; }
export function localeTag() { return current === "en" ? "en-US" : "zh-CN"; }

const TOKEN = /\{(\d+|[A-Za-z_]\w*)(?::[^{}]*)?\}|\{(:[^{}]*)?\}/g;
function fill(template: string, args: readonly unknown[]) {
  return template.replace(/\{(\d+)\}/g, (all, i: string) => Number(i) < args.length ? String(args[Number(i)] ?? "") : all);
}
type Pattern = { parts: string[]; source: string; target: string; slots: string[]; prefix: string };
function pattern(source: string, target: string): Pattern | null {
  const parts: string[] = [], slots: string[] = [];
  let offset = 0;
  source.replace(TOKEN, (whole, _key: string | undefined, _format: string | undefined, at: number) => {
    parts.push(source.slice(offset, at)); slots.push(whole); offset = at + whole.length; return whole;
  });
  parts.push(source.slice(offset));
  if (!slots.length || slots.length > 8 || parts.join("").length < 4 || /<\/?(?:div|script|html|body)/i.test(source)) return null;
  // Ambiguous adjacent placeholders are not eligible for pattern matching.
  if (parts.slice(1,-1).some(p => !p)) return null;
  return { parts, source, target, slots, prefix: parts[0] };
}
const forward: Pattern[] = [], backward: Pattern[] = [];
const reverse: Record<string, string> = Object.create(null);
for (const [zh, en] of Object.entries(ENGLISH)) {
  // Reverse lookup is used only for already-recorded system messages, never for UI labels or user data.
  if (!(en in reverse)) reverse[en] = zh;
}
for (const zh of MESSAGE_KEYS) {
  const en = ENGLISH[zh]; if (!en) continue;
  const a = pattern(zh, en), b = pattern(en, zh);
  if (a) forward.push(a);
  if (b) backward.push(b);
}
forward.sort((a,b) => b.prefix.length-a.prefix.length || b.source.length-a.source.length);
backward.sort((a,b) => b.prefix.length-a.prefix.length || b.source.length-a.source.length);
function matchMessage(value: string, patterns: Pattern[]): string | null {
  if (value.length > 16384) return null;
  for (const p of patterns) {
    if (!value.startsWith(p.prefix) || !value.endsWith(p.parts[p.parts.length - 1])) continue;
    let offset = p.prefix.length;
    const captures: string[] = [];
    let valid = true;
    for (let i = 0; i < p.slots.length; ++i) {
      const next = p.parts[i + 1];
      const at = i === p.slots.length - 1 ? value.length - next.length : value.indexOf(next, offset);
      if (at < offset) { valid = false; break; }
      captures.push(value.slice(offset, at)); offset = at + next.length;
    }
    if (!valid || offset !== value.length) continue;
    const values = new Map(p.slots.map((slot, i) => [slot, captures[i]]));
    let unnamed = 0;
    const unnamedValues = captures.filter((_, i) => p.slots[i] === "{}" || /^\{:[^{}]*\}$/.test(p.slots[i]));
    return p.target.replace(TOKEN, slot => slot === "{}" || /^\{:[^{}]*\}$/.test(slot) ? unnamedValues[unnamed++] ?? slot : values.get(slot) ?? slot);
  }
  return null;
}
/** Translate known app messages while preserving embedded names, paths, numbers and external diagnostics. */
export function uiMessage<T>(value: T, ...args: unknown[]): T {
  if (typeof value !== "string" || value.trim() === "") return value;
  const v67 = v67Message(value, current);
  if(v67 !== undefined)return v67 as T;
  const v66 = v66Message(value, current);
  if (v66 !== undefined) return v66 as T;
  if (args.length) return fill(current === "en" ? lookup(ENGLISH,value) ?? value : value, args) as T;
  const exact = current === "en" ? lookup(ENGLISH,value) : reverse[value];
  if (exact !== undefined) return exact as T;
  const matched = matchMessage(value, current === "en" ? forward : backward);
  if (matched !== null) return matched as T;
  // Error.toString() often adds a prefix outside the authored message.
  const prefix = /^(?:Error|TypeError|RangeError):\s*/.exec(value);
  if (prefix) {
    const body = value.slice(prefix[0].length);
    const known = (current === "en" ? lookup(ENGLISH,body) : reverse[body]) ?? matchMessage(body, current === "en" ? forward : backward);
    if (known !== undefined && known !== null) return (prefix[0] + known) as T;
  }
  return value;
}

const COUNT_UNITS: Record<string, readonly [string,string]> = {
  '页':['page','pages'], '行':['row','rows'], '列':['column','columns'],
  '次':['time','times'], '个文件':['file','files'], '张图片':['image','images'],
  '张':['image','images'], '项':['item','items'], '个字符':['character','characters'],
  '字符':['character','characters'], '字节':['byte','bytes'], '秒':['second','seconds'],
  '分钟':['minute','minutes'], '小时':['hour','hours'], '天':['day','days'], '个工具':['tool','tools'],
};
export function uiCount(count: unknown, unit: string): string {
  if (current !== 'en') return `${count ?? ''}${unit}`;
  const pair=COUNT_UNITS[unit];
  return pair ? `${count ?? ''} ${pair[Number(count)===1?0:1]}` : `${count ?? ''} ${uiText(unit)}`;
}
