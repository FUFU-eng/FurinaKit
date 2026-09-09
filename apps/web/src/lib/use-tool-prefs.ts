"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";

/**
 * 轻量 localStorage 存储：收藏、置顶、最近使用、每个分类的自定义排序、
 * 以及单个工具上次使用的参数。通过 useSyncExternalStore 在组件间响应式共享。
 */

const RECENT_KEY = "furinakit:recent";
const FAV_KEY = "furinakit:favorites";
const PIN_KEY = "furina:pins";
const ORDER_PREFIX = "furina:order:";
const RECENT_MAX = 8;

const WATCHED = [RECENT_KEY, FAV_KEY, PIN_KEY];
const orderKey = (category: string) => ORDER_PREFIX + category;

type Listener = () => void;
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: Listener) {
  listeners.add(listener);
  // 同步其它标签页的改动
  const onStorage = (e: StorageEvent) => {
    if (
      !e.key ||
      WATCHED.includes(e.key) ||
      e.key.startsWith(ORDER_PREFIX)
    ) {
      emit();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function read(key: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
}

const EMPTY: string[] = [];
const getServerSnapshot = () => EMPTY;

function makeSnapshot(key: string) {
  let cache: string[] = [];
  let lastRaw = "__init__";
  return () => {
    if (typeof window === "undefined") return EMPTY;
    const raw = window.localStorage.getItem(key) ?? "";
    if (raw !== lastRaw) {
      lastRaw = raw;
      cache = read(key);
    }
    return cache;
  };
}

const recentSnapshot = makeSnapshot(RECENT_KEY);
const favSnapshot = makeSnapshot(FAV_KEY);
const pinSnapshot = makeSnapshot(PIN_KEY);

/* ── 分类排序快照（按 key 缓存，保证引用稳定，避免 #185 无限重渲染） ── */
type OrderCache = { lastRaw: string; cache: string[] };
const orderSnapCache = new Map<string, OrderCache>();

function makeOrderSnapshot(key: string) {
  return () => {
    if (typeof window === "undefined") return EMPTY;
    const raw = window.localStorage.getItem(key) ?? "";
    let c = orderSnapCache.get(key);
    if (!c || c.lastRaw !== raw) {
      c = { lastRaw: raw, cache: read(key) };
      orderSnapCache.set(key, c);
    }
    return c.cache;
  };
}

function write(key: string, value: string[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* 忽略隐私模式/配额错误 */
  }
  emit();
}

export function useRecentTools() {
  const recent = useSyncExternalStore(subscribe, recentSnapshot, getServerSnapshot);

  const recordTool = useCallback((id: string) => {
    const current = read(RECENT_KEY);
    const next = [id, ...current.filter((x) => x !== id)].slice(0, RECENT_MAX);
    write(RECENT_KEY, next);
  }, []);

  const clearRecent = useCallback(() => write(RECENT_KEY, []), []);

  return { recent, recordTool, clearRecent };
}

/* ── 收藏 ─────────────────────────────────────────────────────────────── */
export function useFavorites() {
  const favorites = useSyncExternalStore(subscribe, favSnapshot, getServerSnapshot);

  const toggleFavorite = useCallback((id: string) => {
    const current = read(FAV_KEY);
    const nowFav = !current.includes(id);
    const next = nowFav ? [id, ...current] : current.filter((x) => x !== id);
    write(FAV_KEY, next);
    return nowFav;
  }, []);

  const isFavorite = useCallback((id: string) => favorites.includes(id), [favorites]);

  return { favorites, toggleFavorite, isFavorite };
}

/* ── 置顶（可多个）─────────────────────────────────────────────────────── */
export function usePins() {
  const pins = useSyncExternalStore(subscribe, pinSnapshot, getServerSnapshot);

  const togglePin = useCallback((id: string) => {
    const current = read(PIN_KEY);
    const nowPinned = !current.includes(id);
    const next = nowPinned ? [...current, id] : current.filter((x) => x !== id);
    write(PIN_KEY, next);
    return nowPinned;
  }, []);

  const isPinned = useCallback((id: string) => pins.includes(id), [pins]);

  return { pins, togglePin, isPinned };
}

/* ── 每个分类的自定义排序（长按拖拽后持久化）────────────────────────────── */
export function useCategoryOrder(category: string) {
  const key = orderKey(category);
  const snap = useMemo(() => makeOrderSnapshot(key), [key]);
  const order = useSyncExternalStore(subscribe, snap, getServerSnapshot);

  const setOrder = useCallback(
    (next: string[]) => {
      write(key, next);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [key],
  );

  return { order: order.length ? order : null, setOrder };
}

/* ── 单个工具的参数记忆 ───────────────────────────────────────────────── */
const SETTINGS_PREFIX = "furinakit:settings:";

export function loadToolSettings(toolId: string): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(SETTINGS_PREFIX + toolId);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, v]) => typeof v === "string"),
    ) as Record<string, string>;
  } catch {
    return {};
  }
}

export function saveToolSettings(toolId: string, values: Record<string, string>): void {
  if (typeof window === "undefined") return;
  try {
    if (Object.keys(values).length === 0) {
      window.localStorage.removeItem(SETTINGS_PREFIX + toolId);
    } else {
      window.localStorage.setItem(SETTINGS_PREFIX + toolId, JSON.stringify(values));
    }
  } catch {
    /* 忽略配额/隐私模式错误 */
  }
}
