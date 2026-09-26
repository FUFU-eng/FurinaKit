/**
 * 客户端路由 —— 把原版的 Next 路由在这边用 history API 原样复刻。
 *
 * 为什么需要：原版是 Next 的 app 路由（`/`、`/tools/bg-remove`、`/favorites`、`/jobs`、
 * `/portal/transfer`），组件里到处是 `useRouter().push("/tools/xxx")`、`usePathname()`、
 * `useSearchParams()`。桌面版没有服务端，所以这里用 pushState 做一个最小但**行为一致**的路由，
 * 再让 `next/navigation`、`next/link` 的 shim 转接到这里 —— 这样原版组件一行都不用改。
 *
 * 几个要注意的点：
 *  · 用 useSyncExternalStore 订阅，保证 pushState / 浏览器前进后退都能触发重渲染；
 *  · useSearchParams 返回的 URLSearchParams 必须**按 search 字符串缓存**，
 *    否则每次渲染都是新对象，会触发无限重渲染；
 *  · 组件里读的是真的 window.location.search（例如抠图工具用它恢复未完成的任务），
 *    所以这里必须用真实路径而不是 hash 路由，否则那些逻辑会失效。
 */

import { useMemo, useSyncExternalStore } from "react";

type Listener = () => void;

const listeners = new Set<Listener>();
let started = false;

function emit() {
  for (const l of listeners) l();
}

function ensureStarted() {
  if (started || typeof window === "undefined") return;
  started = true;
  // 浏览器前进/后退
  window.addEventListener("popstate", emit);
  // 兼容旧写法：有些地方直接派发这个事件来跳转
  window.addEventListener("furinakit:navigate", ((e: CustomEvent<string>) => {
    if (typeof e.detail === "string" && e.detail) navigate(e.detail);
  }) as EventListener);
}

function subscribe(listener: Listener) {
  ensureStarted();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 当前路径（不含查询串），没有就是 "/" */
export function getPathname(): string {
  if (typeof window === "undefined") return "/";
  return window.location.pathname || "/";
}

/** 当前查询串（含 "?"） */
export function getSearch(): string {
  if (typeof window === "undefined") return "";
  return window.location.search || "";
}

/** 跳转。opts 只是兼容 Next 的调用写法（scroll 之类），桌面端用不上 */
export function navigate(href: string, opts?: { replace?: boolean; scroll?: boolean } | boolean) {
  if (typeof window === "undefined" || !href) return;
  const replace = typeof opts === "boolean" ? opts : Boolean(opts?.replace);

  // 只处理站内路径；外链交给浏览器
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href)) {
    window.open(href, "_blank");
    return;
  }

  const target = href.startsWith("/") ? href : `/${href}`;
  const current = window.location.pathname + window.location.search;
  if (target === current) return;

  const enteringTool = target.startsWith("/tools/");
  const fromTool = current.startsWith("/tools/");
  const returnTo = enteringTool
    ? (fromTool ? window.history.state?.toolReturnTo : current)
    : undefined;
  const state = returnTo ? { toolReturnTo: returnTo } : null;
  if (enteringTool && !fromTool) {
    try {
      sessionStorage.setItem("furina:last_list_url", current);
      sessionStorage.setItem("furina:last_tool_scroll", String(document.querySelector("main")?.scrollTop || 0));
    } catch { /* Navigation still works without session storage. */ }
  }
  if (replace) window.history.replaceState(state, "", target);
  else window.history.pushState(state, "", target);
  emit();
}

export const router = {
  push: (href: string, opts?: { scroll?: boolean }) => navigate(href, opts),
  replace: (href: string, opts?: { scroll?: boolean }) => navigate(href, { ...opts, replace: true }),
  back: () => window.history.back(),
  forward: () => window.history.forward(),
  refresh: () => emit(),
  prefetch: () => {},
};

export function usePathname(): string {
  return useSyncExternalStore(subscribe, getPathname, getPathname);
}

export function useSearchParams(): URLSearchParams {
  const search = useSyncExternalStore(subscribe, getSearch, getSearch);
  // 必须按字符串缓存：每次 new 一个的话，依赖它的组件会一直重渲染
  return useMemo(() => new URLSearchParams(search), [search]);
}

export function useRouter() {
  return router;
}

/** notFound() 抛这个，由顶层的错误边界接管，渲染原版的 not-found 页面 */
export class NotFoundError extends Error {
  constructor() {
    super("NOT_FOUND");
    this.name = "NotFoundError";
  }
}

export function notFound(): never {
  throw new NotFoundError();
}
