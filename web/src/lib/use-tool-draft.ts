"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";

/**
 * 小工具「纯文本输入」草稿：切到别的工具、回首页再回来、甚至按 F5，输入与结果都还在。
 *
 * 为什么不直接写 localStorage：
 * - 文本输入是「击键级」高频写入，每个字符都同步落盘会卡（项目里已有教训）；
 * - 纯文本草稿属于本次会话的临时状态，没必要长期驻留在磁盘上。
 *
 * 策略：
 * 1. 模块级 Map 作为主缓存 —— 同页面会话内切换工具/回首页即时恢复，读写都在内存里，几乎零成本；
 * 2. 防抖 400ms 后再写 sessionStorage —— 刷新（F5）也能恢复；
 *    pagehide / visibilitychange(hidden) 时立刻补写，避免「刚打完字就按 F5」丢掉最后几个字符；
 * 3. 只有值真正变化时才写入（浅比较），相同值直接跳过：不写缓存、不写存储、也不触发重渲染；
 * 4. 缓存有条目上限，超出后按「最久未使用」淘汰（与 tool-runner 的按工具草稿缓存同一思路）；
 * 5. 草稿只在客户端存在，所以首帧先渲染 initial、挂载后再换草稿（水合一致性，见 useToolDraft 注释）。
 *
 * key 由「工具 id + 字段名」拼成，所以不同工具用同名字段（例如都叫 input）不会串台。
 *
 * ⚠️ 项目里现在有**两套**「记住用户输入」的机制，职责**互不重叠**，是有意保留两套的
 *    （让它们各管一半，避免两边都接管同一个字段而互相覆盖）：
 *
 *   A. `use-tool-prefs.ts` 的 `loadToolSettings / saveToolSettings`
 *      —— 只管**通用表单**：由 tool-runner 按 `tool.inputs` 自动渲染出来的 `select | number`。
 *
 *   B. 本文件 `useToolDraft`（以及 tool-runner 里给通用表单纯文本用的 `furina:textdraft:`）
 *      —— 管**自带界面**的工具（自己写 UI 的那些）里的文本 / 数值 / 下拉，
 *         例如 simple-tools / extra-tools / 各图片工具 / 计算器 / 签名设计器。
 *
 *   以后新增工具时，请先判断它属于哪一类，**只接对应的那一套**，不要两边都接。
 */

const STORAGE_PREFIX = "furinakit:tool-draft:";
/** 模块缓存条目上限：一个键 = 一个工具的一个字段 */
const DRAFT_LIMIT = 240;
/** sessionStorage 写入防抖：避免每敲一个字都写一次存储 */
const FLUSH_DEBOUNCE_MS = 400;

/**
 * 服务端渲染阶段没有 DOM，直接用 useLayoutEffect 会报警告；客户端用 useLayoutEffect，
 * 是为了在首次绘制之前就把草稿换上（不会先闪一帧默认值）。
 */
const useIsomorphicLayoutEffect =
  typeof window === "undefined" ? useEffect : useLayoutEffect;

/** 主缓存：key -> 值。Map 的插入顺序即「最近使用顺序」，队首最久未使用。 */
const draftCache = new Map<string, unknown>();
/** 待写入 sessionStorage 的 key -> 防抖定时器 */
const flushTimers = new Map<string, ReturnType<typeof setTimeout>>();

function draftKey(toolKey: string, field: string): string {
  // 用 \u0000 分隔，避免「工具名/字段名里含分隔符」造成的键冲突
  return `${toolKey}\u0000${field}`;
}

function storageKey(key: string): string {
  return STORAGE_PREFIX + key;
}

/** 浅比较：原始值走 Object.is，数组/对象逐层比一层。用于「值没变就不写」的判断。 */
function isSameValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const keysA = Object.keys(a as Record<string, unknown>);
  const keysB = Object.keys(b as Record<string, unknown>);
  if (keysA.length !== keysB.length) return false;
  return keysA.every((k) => Object.is((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]));
}

/** 立即把某个 key 的待写值落到 sessionStorage（幂等）。 */
function flushKey(key: string, value: unknown): void {
  const timer = flushTimers.get(key);
  if (timer !== undefined) {
    clearTimeout(timer);
    flushTimers.delete(key);
  }
  if (typeof window === "undefined") return;
  try {
    if (value === undefined) window.sessionStorage.removeItem(storageKey(key));
    else window.sessionStorage.setItem(storageKey(key), JSON.stringify(value));
  } catch {
    /* 忽略隐私模式 / 配额不足 / 无法序列化的值 */
  }
}

/** 把当前所有待写项立刻落盘（页面隐藏或卸载时调用）。 */
function flushAllPending(): void {
  for (const [key, timer] of Array.from(flushTimers.entries())) {
    clearTimeout(timer);
    flushTimers.delete(key);
    const value = draftCache.get(key);
    if (value === undefined) continue;
    try {
      window.sessionStorage.setItem(storageKey(key), JSON.stringify(value));
    } catch {
      /* 同上，忽略 */
    }
  }
}

let flushHooksInstalled = false;

function installFlushHooks(): void {
  if (flushHooksInstalled || typeof window === "undefined") return;
  flushHooksInstalled = true;
  window.addEventListener("pagehide", flushAllPending);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flushAllPending();
  });
}

/** 写主缓存并按 LRU 淘汰；淘汰前先把待写值落盘，避免刚输入的内容因淘汰而丢失。 */
function rememberInCache(key: string, value: unknown): void {
  if (draftCache.has(key)) draftCache.delete(key);
  draftCache.set(key, value);
  while (draftCache.size > DRAFT_LIMIT) {
    const oldest = draftCache.keys().next().value;
    if (oldest === undefined || oldest === key) break;
    if (flushTimers.has(oldest)) flushKey(oldest, draftCache.get(oldest));
    draftCache.delete(oldest);
  }
}

/** 防抖安排一次 sessionStorage 写入。 */
function scheduleFlush(key: string, value: unknown): void {
  installFlushHooks();
  const timer = flushTimers.get(key);
  if (timer !== undefined) clearTimeout(timer);
  flushTimers.set(
    key,
    setTimeout(() => {
      flushTimers.delete(key);
      if (typeof window === "undefined") return;
      try {
        window.sessionStorage.setItem(storageKey(key), JSON.stringify(value));
      } catch {
        /* 忽略隐私模式 / 配额不足 */
      }
    }, FLUSH_DEBOUNCE_MS),
  );
}

/** 读取草稿：模块缓存优先，其次 sessionStorage，最后才是组件给的初始值。 */
function readDraft<T>(key: string, initial: T): T {
  if (draftCache.has(key)) {
    const cached = draftCache.get(key) as T;
    // 命中即代表「最近被访问过」，挪到队尾
    draftCache.delete(key);
    draftCache.set(key, cached);
    return cached;
  }
  if (typeof window === "undefined") return initial;
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(storageKey(key));
  } catch {
    raw = null;
  }
  if (raw === null) return initial;
  try {
    const parsed = JSON.parse(raw) as T;
    // 从存储恢复的值也进主缓存，后续读取不再碰存储
    rememberInCache(key, parsed);
    return parsed;
  } catch {
    return initial;
  }
}

/**
 * 记住一个工具里某个纯文本字段的草稿。
 *
 * 恢复时机：首帧先渲染 initial，挂载后（首次绘制之前）立刻换成草稿值。
 * 之所以不在 useState 初始值里直接读草稿：这些工具页面是服务端渲染的
 * （app/tools/[toolId]/page.tsx 直接渲染 ToolRunner），而草稿只存在于客户端。
 * 如果首帧就渲染草稿，服务端 HTML 与客户端首帧不一致，凡是「渲染了输入派生结果」的
 * 工具（大小写转换的字数统计、HTTP 状态码说明、文本对比视图、花体/拼音结果等）
 * 都会水合不上。这里遵循项目里已有的约定（见 lib/use-window-cols.ts 的
 * 「SSR / 首屏固定返回 3 列，避免 hydration mismatch」、components/tools/sortable-grid.tsx
 * 的「首屏保证水合一致」）：首屏与服务端保持一致，恢复动作放在挂载后。
 * 用 useLayoutEffect 是为了在浏览器首次绘制前完成替换 —— 既不会闪一下默认值，
 * 也不会像 useEffect 那样先画一帧空输入框。
 *
 * @param toolKey 工具 id（与 tool-runner 的 CLIENT_TOOL_COMPONENTS 键一致）
 * @param field   字段名，同一个工具内必须唯一（一般直接用 state 变量名）
 * @param initial 初始值，只在「缓存和存储里都没有」时使用
 */
export function useToolDraft<T>(
  toolKey: string,
  field: string,
  initial: T,
): [T, Dispatch<SetStateAction<T>>] {
  const key = draftKey(toolKey, field);
  const [value, setValue] = useState<T>(initial);
  // initial 只作为「没有草稿」时的兜底，放进 ref 是为了让它不出现在 effect 依赖里
  // （调用点经常直接写字面量/内联数组，进依赖会导致每次渲染都重跑 effect）
  const initialRef = useRef(initial);

  useIsomorphicLayoutEffect(() => {
    const restored = readDraft(key, initialRef.current);
    // 没有草稿时 restored 就是 initial，浅比较相等 -> 不触发多余渲染
    setValue((prev) => (isSameValue(prev, restored) ? prev : restored));
  }, [key]);

  const update = useCallback<Dispatch<SetStateAction<T>>>(
    (next) => {
      setValue((prev) => {
        const resolved =
          typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        // 值没变：不写缓存、不写存储、也不触发重渲染
        if (isSameValue(prev, resolved)) return prev;
        rememberInCache(key, resolved);
        scheduleFlush(key, resolved);
        return resolved;
      });
    },
    [key],
  );

  return [value, update];
}
