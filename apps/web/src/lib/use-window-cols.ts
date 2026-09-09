"use client";

import { useEffect, useState } from "react";

/**
 * 主界面卡片网格列数共享常量。
 * 提升到 4 列的条件：
 *   1) Electron 窗口处于最大化状态（用户主动最大化 → 横向空间充裕）；
 *   2) 浏览器视口宽度 ≥ WIDE_VIEWPORT_PX（兜底：把窗口手动拉得很宽时也能 4 列）。
 */
const WIDE_VIEWPORT_PX = 1500;
const COLS_NORMAL = 3;
const COLS_WIDE = 4;

/**
 * 跟踪 Electron 窗口是否处于"最大化"状态：
 * - Electron 环境：先问一次初值（避免和后续推送竞态），再订阅 IPC；
 * - 非 Electron 环境（纯浏览器）：始终 false。
 * 卸载时自动清理订阅。
 */
export function useWindowMaximized(): boolean {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const api = window.furinakit;
    if (!api?.isElectron || !api.onMaximizedChange) {
      setIsMaximized(false);
      return;
    }

    let cancelled = false;
    api.getIsMaximized?.()
      .then((v) => {
        if (!cancelled) setIsMaximized(Boolean(v));
      })
      .catch(() => {
        /* ignore */
      });

    const unsubscribe = api.onMaximizedChange((maximized: boolean) => {
      if (!cancelled) setIsMaximized(Boolean(maximized));
    });

    return () => {
      cancelled = true;
      try {
        unsubscribe?.();
      } catch {
        /* ignore */
      }
    };
  }, []);

  return isMaximized;
}

/**
 * 返回主界面卡片网格应使用的列数：3（默认）或 4。
 *
 * SSR / 首屏固定返回 3 列，避免 hydration mismatch；
 * 客户端 mount 后才按 (isMaximized || 视口 ≥ WIDE_VIEWPORT_PX) 升级到 4 列。
 */
export function useGridCols(): number {
  const isMaximized = useWindowMaximized();
  const [mounted, setMounted] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setMounted(true);
    setViewportWidth(window.innerWidth);
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  if (!mounted) return COLS_NORMAL;

  const shouldUseWide = isMaximized || viewportWidth >= WIDE_VIEWPORT_PX;
  return shouldUseWide ? COLS_WIDE : COLS_NORMAL;
}
