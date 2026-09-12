"use client";

import { Suspense, useCallback, useEffect, useMemo, useState, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { getToolById, getAvailableTools, CATEGORY_LABELS, type ToolCategory } from "@furinakit/shared";
import { useTheme } from "@/components/theme-provider";
import { useFavorites } from "@/lib/use-tool-prefs";
import { GlobalDrop } from "@/components/global-drop";
import { TaskFloatBall } from "@/components/layout/task-float-ball";
import { SettingsModal } from "@/components/layout/settings-modal";
import DonateModal from "@/components/layout/donate-modal";
import { checkForUpdates } from "@/lib/updater";
import { PageTransition } from "@/components/page-transition";
import { cn } from "@/lib/utils";

// Electron 预加载脚本暴露的 API 类型
declare global {
  interface Window {
    furinaKit?: {
      minimize?: () => void;
      toggleMaximize?: () => void;
      close?: () => void;
    };
    furinakit?: {
      isElectron?: boolean;
      platform?: string;
      minimize?: () => void;
      toggleMaximize?: () => void;
      close?: () => void;
      setTheme?: (theme: string) => void;
      onMaximizedChange?: (callback: (maximized: boolean) => void) => () => void;
      getIsMaximized?: () => Promise<boolean>;
      selectDirectory?: () => Promise<string | null>;
      applySettings?: (settings: Record<string, unknown>) => Promise<{ success: boolean; error?: string }> | void;
      openPath?: (path: string) => Promise<{ success: boolean; error?: string; openedParent?: boolean }>;
      launchArchpr?: () => Promise<{ success: boolean; path?: string; error?: string }>;
      openArchprDir?: () => Promise<{ success: boolean; path?: string; error?: string }>;
      openDatatool?: () => Promise<{ success: boolean; error?: string }>;
    };
  }
}

import {
  Heart,
  Image as ImageIcon,
  FileText,
  Download,
  Music,
  Wrench,
  Code,
  Type,
  Sigma,
  Shield,
  Search,
  Moon,
  Sun,
  Eye,
  Monitor,
  PanelLeftClose,
  PanelLeftOpen,
  ListTodo,
  LayoutGrid,
  Minus,
  Square,
  Copy,
  X,
  Settings,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

type NavKey = "all" | "favorites" | ToolCategory;

interface NavItem {
  key: NavKey;
  label: string;
  icon: LucideIcon;
  color: string;
  href: string;
  isCategory: boolean;
}

// 侧边栏最多放 12 行（含「全部工具」与「我的收藏」），所以分类固定为 10 个。
// 顺序 = 使用频率：先四类「按文件类型找」的（图片/视频/音频/PDF），再六类「按做什么找」的。
const NAV_ITEMS: NavItem[] = [
  { key: "all", label: "全部工具", icon: LayoutGrid, color: "#8b5cf6", href: "/", isCategory: false },
  { key: "favorites", label: "我的收藏", icon: Heart, color: "#ec4899", href: "/favorites", isCategory: false },
  { key: "image", label: "图片工具", icon: ImageIcon, color: "#0ea5e9", href: "/?c=image", isCategory: true },
  { key: "download", label: "视频工具", icon: Download, color: "#f59e0b", href: "/?c=download", isCategory: true },
  { key: "audio", label: "音频工具", icon: Music, color: "#a855f7", href: "/?c=audio", isCategory: true },
  { key: "pdf", label: "PDF 工具", icon: FileText, color: "#10b981", href: "/?c=pdf", isCategory: true },
  { key: "text", label: "文本工具", icon: Type, color: "#14b8a6", href: "/?c=text", isCategory: true },
  { key: "mathcalc", label: "数理工具", icon: Sigma, color: "#7c3aed", href: "/?c=mathcalc", isCategory: true },
  { key: "dev", label: "开发工具", icon: Code, color: "#3b82f6", href: "/?c=dev", isCategory: true },
  { key: "security", label: "编码安全", icon: Shield, color: "#ef4444", href: "/?c=security", isCategory: true },
  { key: "utility", label: "生活办公", icon: Wrench, color: "#f97316", href: "/?c=utility", isCategory: true },
];

/**
 * ── 顶部搜索的匹配与排序核心 ──────────────────────────────────────────
 * 这一整段是纯函数（不碰 React、不碰 DOM），改动后请同步跑一下单测。
 *
 * 排序规则（越靠前越相关）：
 *   0 名称以关键字开头 → 1 名称包含 → 2 id 包含 → 3 描述或分类包含
 * 同一档内保持 tools 数组原有顺序（Array.prototype.sort 自 ES2019 起保证稳定）。
 *
 * 之所以要排序：以前是「谁在 tools 数组里靠前谁先出」，而候选又被截断到 8 条，
 * 于是像「Markdown 转 PDF」这种追加在数组末尾的新工具，搜 pdf 时会被前面的
 * PDF 系列挤掉、根本进不了候选列表。
 */
// #region fk-search-core
export type SearchableTool = {
  id: string;
  name: string;
  description: string;
  category: string;
};

export type ToolSearchHit<T extends SearchableTool = SearchableTool> = {
  tool: T;
  /** 命中档位，见上方排序规则；未命中不会出现在结果里 */
  rank: number;
  /** 名称里的命中区间，用来做高亮；名称没命中时为 null */
  nameRange: [number, number] | null;
  /** 描述里的命中区间，用来做高亮；没命中时为 null */
  descriptionRange: [number, number] | null;
};

/** 候选上限：下拉框本身是 max-h-80 + overflow-y-auto，可以滚动，放宽到 20 条即可。 */
export const SEARCH_RESULT_LIMIT = 20;

/** 大小写不敏感的子串定位，找不到返回 -1 */
export function indexOfLoose(haystack: string, needle: string): number {
  return haystack.toLowerCase().indexOf(needle.toLowerCase());
}

/** 命中档位；未命中返回 -1 */
export function rankToolMatch(tool: SearchableTool, rawQuery: string): number {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return -1;
  const name = tool.name.toLowerCase();
  if (name.startsWith(q)) return 0;
  if (name.includes(q)) return 1;
  if (tool.id.toLowerCase().includes(q)) return 2;
  if (tool.description.toLowerCase().includes(q)) return 3;
  const categoryLabel = CATEGORY_LABELS[tool.category as ToolCategory];
  if (categoryLabel && categoryLabel.toLowerCase().includes(q)) return 3;
  return -1;
}

export function searchTools<T extends SearchableTool>(
  tools: readonly T[],
  query: string,
  limit: number = SEARCH_RESULT_LIMIT,
): ToolSearchHit<T>[] {
  const q = query.trim();
  if (!q || limit <= 0) return [];
  const hits: ToolSearchHit<T>[] = [];
  for (const tool of tools) {
    const rank = rankToolMatch(tool, q);
    if (rank < 0) continue;
    const nameAt = indexOfLoose(tool.name, q);
    const descAt = indexOfLoose(tool.description, q);
    hits.push({
      tool,
      rank,
      nameRange: nameAt >= 0 ? [nameAt, nameAt + q.length] : null,
      descriptionRange: descAt >= 0 ? [descAt, descAt + q.length] : null,
    });
  }
  return hits.sort((a, b) => a.rank - b.rank).slice(0, limit);
}
// #endregion fk-search-core

/** 把命中的那一段用 <mark> 标出来（主题色，三套主题自适应，不用 dangerouslySetInnerHTML） */
function HighlightedText({ text, range }: { text: string; range: [number, number] | null }) {
  if (!range) return <>{text}</>;
  const [start, end] = range;
  if (start < 0 || start >= end || end > text.length) return <>{text}</>;
  return (
    <>
      {text.slice(0, start)}
      <mark className="rounded-[3px] bg-primary/25 px-px text-inherit">{text.slice(start, end)}</mark>
      {text.slice(end)}
    </>
  );
}

const COLLAPSE_KEY = "furina:sidebar-collapsed";

function Logo({ size = 36 }: { size?: number }) {
  return (
    <img
      src="/furina-logo.png"
      alt="FurinaKit"
      style={{ width: size, height: size, borderRadius: "0.6rem" }}
      className="shrink-0 object-cover shadow-[0_6px_16px_-6px_hsl(var(--primary)/0.8)]"
    />
  );
}

function TopSearchBar() {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  /** 候选按钮的 ref：键盘上下选择时要把选中项滚进可视区（候选放宽到 20 条后尤其需要） */
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const tools = useMemo(() => getAvailableTools().filter((t) => !t.comingSoon), []);

  // 过滤 + 按相关性排序 + 截断（纯函数在文件顶部 fk-search-core 区，单独有单测）
  const results = useMemo(() => searchTools(tools, query), [query, tools]);

  // 结果集变小（继续打字）时把选中项夹回范围内，避免 Enter 落到空处
  useEffect(() => {
    setSelectedIndex((prev) => (prev < results.length ? prev : 0));
  }, [results]);

  // 全局快捷键 Ctrl+空格 聚焦输入框直接打字（Ctrl+K 作为老习惯保留，主推 Ctrl+空格）
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // 主键是 Ctrl+空格：用 e.code === "Space" 判断物理空格键，同时排除
      // Ctrl+Shift+空格（输入法全角空格）与 Ctrl+Alt+空格（部分键盘布局的 AltGr）。
      const isSpace = e.code === "Space" && !e.shiftKey && !e.altKey;
      const isLegacyK = e.code === "KeyK";
      if (!((e.ctrlKey || e.metaKey) && (isSpace || isLegacyK))) return;
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
      // 用下拉选过一个工具之后，输入框仍然带着 DOM 焦点，这时再按快捷键调
      // .focus() 不会触发 focus 事件，React 里的 focused 会一直停在 false ——
      // 于是「能打字但下拉不出来」。这里显式置为 true。
      setFocused(true);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // 点击外部收起候选下拉列表
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setFocused(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = (toolId: string) => {
    setFocused(false);
    setQuery("");
    router.push(`/tools/${toolId}`);
  };

  /**
   * 上下键移动选中项。循环语义与原来完全一致，只是额外把选中项滚进可视区 ——
   * 候选放宽到 20 条后，光靠 bg-accent 高亮而列表不滚动，选中项会跑到视野外面去。
   * 鼠标悬停（onMouseEnter）不触发滚动，避免和用户自己滚轮打架。
   */
  const moveSelection = (delta: number) => {
    if (!results.length) {
      setSelectedIndex(0);
      return;
    }
    const next = (selectedIndex + delta + results.length) % results.length;
    setSelectedIndex(next);
    requestAnimationFrame(() => {
      itemRefs.current[next]?.scrollIntoView({ block: "nearest" });
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setFocused(false);
      inputRef.current?.blur();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      moveSelection(1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      moveSelection(-1);
    } else if (e.key === "Enter" && results.length > 0) {
      e.preventDefault();
      handleSelect(results[selectedIndex]?.tool.id || results[0].tool.id);
    }
  };

  const showDropdown = focused && query.trim().length > 0;

  return (
    <div ref={containerRef} className="relative w-[240px]" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
      <div className="relative flex items-center">
        <Search size={14} className="absolute left-3 text-muted-foreground pointer-events-none" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setSelectedIndex(0);
          }}
          onFocus={() => setFocused(true)}
          onClick={() => setFocused(true)}
          onKeyDown={handleKeyDown}
          placeholder="搜索工具 (Ctrl+空格)..."
          className="h-9 w-full rounded-xl border border-input bg-card pl-9 pr-[3.75rem] text-xs text-foreground placeholder:text-muted-foreground/60 transition-all duration-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
        />
        {query ? (
          <button
            type="button"
            onClick={() => {
              setQuery("");
              inputRef.current?.focus();
            }}
            className="absolute right-2.5 text-muted-foreground hover:text-foreground"
          >
            <X size={13} />
          </button>
        ) : (
          <kbd className="absolute right-2 pointer-events-none rounded border border-border bg-muted/40 px-1.5 py-0.5 text-[10px] text-muted-foreground">
            Ctrl 空格
          </kbd>
        )}
      </div>

      {showDropdown && (
        <div className="absolute left-0 top-[calc(100%+6px)] z-50 max-h-80 w-[320px] overflow-y-auto rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl">
          {results.length === 0 ? (
            <div className="px-3 py-3 text-center text-xs text-muted-foreground">
              未找到匹配的工具
            </div>
          ) : (
            results.map((hit, index) => {
              const isSelected = index === selectedIndex;
              const tool = hit.tool;
              return (
                <button
                  key={tool.id}
                  type="button"
                  ref={(el) => {
                    itemRefs.current[index] = el;
                  }}
                  onClick={() => handleSelect(tool.id)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                    isSelected ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-accent/60"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold">
                        <HighlightedText text={tool.name} range={hit.nameRange} />
                      </span>
                      <span className="rounded bg-primary/10 px-1.5 py-0.2 text-[10px] text-primary">
                        {CATEGORY_LABELS[tool.category]}
                      </span>
                    </div>
                    <p className="truncate text-[11px] text-muted-foreground">
                      <HighlightedText text={tool.description} range={hit.descriptionRange} />
                    </p>
                  </div>
                </button>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}

function ShellBody({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { theme, themeMode, toggleTheme, setTheme, colors, mounted } = useTheme();
  const { favorites } = useFavorites();

  const [collapsed, setCollapsed] = useState(false);
  const [online, setOnline] = useState<boolean | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [donateOpen, setDonateOpen] = useState(false);
  const [hasUpdate, setHasUpdate] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);

  // 检测云端是否有新版本，为设置按钮显示高亮发光红点微标
  useEffect(() => {
    checkForUpdates()
      .then((res) => {
        setHasUpdate(res.hasUpdate);
      })
      .catch(() => {});
  }, []);

  // 跟踪 Electron 窗口的最大化状态：先问一次初值，再订阅后续变化。
  // Web 端（非 Electron）默认 false，组件卸载时清理订阅避免内存泄漏。
  useEffect(() => {
    if (typeof window === "undefined" || !window.furinakit?.isElectron) {
      setIsMaximized(false);
      return;
    }
    let cancelled = false;
    window.furinakit.getIsMaximized?.()
      .then((v) => { if (!cancelled) setIsMaximized(Boolean(v)); })
      .catch(() => { /* ignore */ });
    const unsubscribe = window.furinakit.onMaximizedChange?.((maximized) => {
      if (!cancelled) setIsMaximized(Boolean(maximized));
    });
    return () => {
      cancelled = true;
      try { unsubscribe?.(); } catch { /* ignore */ }
    };
  }, []);

  // 读取折叠偏好（layout 内联脚本之外的普通交互状态，首屏直接给展开值即可）
  useEffect(() => {
    try {
      if (localStorage.getItem(COLLAPSE_KEY) === "1") setCollapsed(true);
    } catch {
      /* ignore */
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  // Worker 在线状态
  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const res = await fetch("/api/health", { cache: "no-store" });
        if (alive) setOnline(res.ok);
      } catch {
        if (alive) setOnline(false);
      }
    };
    check();
    const id = window.setInterval(check, 8000);
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, []);

  // 当前高亮的导航项
  const activeKey = useMemo<NavKey | null>(() => {
    if (pathname === "/favorites") return "favorites";
    if (pathname === "/jobs") return null;
    if (pathname === "/") {
      const c = searchParams.get("c");
      return (c as NavKey) ?? "all";
    }
    const m = pathname?.match(/^\/tools\/([^/]+)/);
    if (m) {
      const tool = getToolById(decodeURIComponent(m[1]));
      return (tool?.category as NavKey) ?? null;
    }
    return null;
  }, [pathname, searchParams]);

  const mainRef = useRef<HTMLElement>(null);

  // 实时记录列表页滚动高度
  const handleMainScroll = useCallback(() => {
    if (!mainRef.current) return;
    const top = mainRef.current.scrollTop;
    if (!pathname.startsWith("/tools/")) {
      const fullUrl = pathname + (searchParams?.toString() ? `?${searchParams.toString()}` : "");
      try {
        sessionStorage.setItem("furina:last_list_url", fullUrl);
        sessionStorage.setItem("furina:last_tool_scroll", String(top));
      } catch {
        /* ignore */
      }
    }
  }, [pathname, searchParams]);

  // 监听路由变化，若从工具页面返回，则精准恢复此前的滚动位置
  useEffect(() => {
    if (!mainRef.current) return;

    if (pathname.startsWith("/tools/")) {
      mainRef.current.scrollTop = 0;
      return;
    }

    let needRestore = false;
    try {
      needRestore = sessionStorage.getItem("furina:restore_scroll") === "1";
    } catch {
      /* ignore */
    }

    if (needRestore) {
      try {
        sessionStorage.removeItem("furina:restore_scroll");
      } catch {
        /* ignore */
      }
      const targetScroll = Number(sessionStorage.getItem("furina:last_tool_scroll") || 0);
      const lastToolId = sessionStorage.getItem("furina:last_tool_id");

      const doRestore = () => {
        if (!mainRef.current) return;
        if (targetScroll > 0) {
          mainRef.current.scrollTop = targetScroll;
        }
        if (lastToolId) {
          const card = document.querySelector(`[data-tool-id="${lastToolId}"]`);
          if (card && Math.abs(mainRef.current.scrollTop - targetScroll) > 80) {
            card.scrollIntoView({ block: "center", behavior: "instant" });
          }
        }
      };

      doRestore();
      const rAF = requestAnimationFrame(doRestore);
      const t1 = setTimeout(doRestore, 40);
      const t2 = setTimeout(doRestore, 120);
      const t3 = setTimeout(doRestore, 260);

      return () => {
        cancelAnimationFrame(rAF);
        clearTimeout(t1);
        clearTimeout(t2);
        clearTimeout(t3);
      };
    }
  }, [pathname, searchParams]);

  // 监听浏览器/鼠标后退按键
  useEffect(() => {
    const handlePopState = () => {
      try {
        sessionStorage.setItem("furina:restore_scroll", "1");
      } catch {
        /* ignore */
      }
    };
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  const handleNavClick = (item: NavItem) => {
    try {
      sessionStorage.removeItem("furina:restore_scroll");
    } catch {
      /* ignore */
    }
    if (mainRef.current) {
      mainRef.current.scrollTop = 0;
    }
    if (!item.isCategory) {
      router.push(item.href);
      return;
    }
    // 已在首页则用 query 切换，避免整页刷新，保证丝滑
    if (pathname === "/") {
      router.push(item.href);
    } else {
      router.push(item.href);
    }
  };

  // 移动端或跨端传送门页面不渲染电脑端侧边栏和顶栏
  if (pathname?.startsWith("/portal")) {
    return <main className="min-h-screen w-full bg-background">{children}</main>;
  }

  return (
    <div className="flex h-screen" style={{ background: colors.bg }}>
      <GlobalDrop />
      <TaskFloatBall />


      {/* ── 左侧边栏 ─────────────────────────────────────────────── */}
      <aside
        className="relative z-30 flex h-full shrink-0 flex-col border-r transition-[width] duration-200 ease-out"
        style={{
          width: collapsed ? 76 : 208,
          background: colors.sidebar,
          borderColor: colors.borderSolid,
        }}
      >
        {/* Logo 区 */}
        <div
          className="flex h-16 shrink-0 items-center gap-2.5 overflow-hidden px-4"
          style={{ borderBottom: `1px solid ${colors.border}` }}
        >
          <Logo size={36} />
          <div
            className="flex min-w-0 flex-col leading-none transition-opacity duration-150"
            style={{ opacity: collapsed ? 0 : 1, whiteSpace: "nowrap" }}
          >
            <span
              className="truncate text-[17px] font-bold tracking-tight"
              style={{ color: colors.text }}
            >
              FurinaKit
            </span>
            <span className="mt-1 truncate text-[11px]" style={{ color: colors.muted }}>
              芙宁娜工具箱
            </span>
          </div>
        </div>

        {/* 导航 */}
        <nav className="thin-scroll flex-1 space-y-1 overflow-y-auto overflow-x-hidden px-3 py-4">
          {NAV_ITEMS.map((item) => {
            const active = activeKey === item.key;
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                onClick={() => handleNavClick(item)}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "group flex h-11 w-full items-center gap-3 rounded-xl px-3 text-[14px] font-medium transition-all duration-150",
                  collapsed && "justify-center px-0",
                )}
                style={{
                  background: active ? colors.active : "transparent",
                  color: active ? item.color : colors.navText,
                  boxShadow: active ? `inset 0 0 0 1px ${colors.activeBorder}` : "none",
                  whiteSpace: "nowrap",
                }}
                onMouseEnter={(e) => {
                  if (!active) e.currentTarget.style.background = colors.dropdownHover;
                }}
                onMouseLeave={(e) => {
                  if (!active) e.currentTarget.style.background = "transparent";
                }}
              >
                <Icon
                  size={20}
                  strokeWidth={2}
                  className="shrink-0"
                  style={{ color: item.color }}
                />
                {!collapsed && (
                  <>
                    <span className="flex-1 text-left transition-opacity duration-150">
                      {item.label}
                    </span>
                    {item.key === "favorites" && favorites.length > 0 && (
                      <span
                        className="rounded-full px-1.5 py-0.5 text-[11px] font-semibold leading-none"
                        style={{ background: colors.btn, color: colors.muted }}
                      >
                        {favorites.length}
                      </span>
                    )}
                  </>
                )}
              </button>
            );
          })}

        </nav>

        {/* 左下角：服务状态 + 折叠 */}
        <div
          className="flex shrink-0 items-center gap-2 px-4 py-3"
          style={{ borderTop: `1px solid ${colors.border}` }}
        >
          <span className="relative flex h-2 w-2 shrink-0">
            <span
              className="absolute inline-flex h-full w-full rounded-full opacity-60"
              style={{
                background: online === false ? colors.mutedDark : colors.green,
                animation: online === false ? "none" : "pulse-glow 1.8s ease-in-out infinite",
              }}
            />
            <span
              className="relative inline-flex h-2 w-2 rounded-full"
              style={{ background: online === false ? colors.mutedDark : colors.green }}
            />
          </span>
          {!collapsed && (
            <span
              className="flex-1 truncate text-[12px]"
              style={{ color: colors.muted, whiteSpace: "nowrap" }}
            >
              {online === null ? "检测服务中…" : online ? "服务运行中" : "服务未运行"}
            </span>
          )}
          <button
            onClick={toggleCollapsed}
            title={collapsed ? "展开侧边栏" : "收起侧边栏"}
            className="ml-auto flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors"
            style={{ color: colors.muted }}
            onMouseEnter={(e) => (e.currentTarget.style.background = colors.dropdownHover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>
      </aside>

      {/* ── 右侧主区 ─────────────────────────────────────────────── */}
      <div className="flex h-full min-w-0 flex-1 flex-col">
        {/* 顶部栏：搜索框 + 深浅模式 + 设置 + 窗口控制 */}
        <header
          className="relative z-20 flex h-16 shrink-0 items-center gap-3 px-4"
          style={{
            borderBottom: `1px solid ${colors.border}`,
            background: colors.bg,
            WebkitAppRegion: "drag",
          } as React.CSSProperties}
        >
          {/* 搜索框 - 直接打字搜索，废除全屏遮罩 */}
          <TopSearchBar />

          {/* 搜索框右边：三态主题切换 + 设置 + 打赏 */}
          <div className="flex shrink-0 items-center gap-2" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
            {/* 四态主题切换：跟随系统 | 浅色 | 深色 | 护眼 */}
            <div
              className="flex h-9 items-center gap-0.5 rounded-xl border p-0.5"
              style={{ borderColor: colors.borderSolid, background: colors.card }}
            >
              <button
                type="button"
                onClick={() => setTheme("system")}
                title="跟随系统（自动同步操作系统深色/浅色偏好）"
                className={cn(
                  "flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-medium transition-all select-none",
                  mounted && themeMode === "system"
                    ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                )}
              >
                <Monitor size={13} />
                <span className="hidden sm:inline">系统</span>
              </button>
              <button
                type="button"
                onClick={() => setTheme("light")}
                title="浅色模式"
                className={cn(
                  "flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-medium transition-all select-none",
                  mounted && themeMode === "light"
                    ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                )}
              >
                <Sun size={13} />
                <span className="hidden sm:inline">浅色</span>
              </button>
              <button
                type="button"
                onClick={() => setTheme("dark")}
                title="深色模式"
                className={cn(
                  "flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-medium transition-all select-none",
                  mounted && themeMode === "dark"
                    ? "bg-primary text-primary-foreground shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                )}
              >
                <Moon size={13} />
                <span className="hidden sm:inline">深色</span>
              </button>
              <button
                type="button"
                onClick={() => setTheme("eye-care")}
                title="护眼模式（温润羊皮纸暖色调，防蓝光）"
                className={cn(
                  "flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-medium transition-all select-none",
                  mounted && themeMode === "eye-care"
                    ? "shadow-xs font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                )}
                style={
                  mounted && themeMode === "eye-care"
                    ? { backgroundColor: "#b45309", color: "#ffffff" }
                    : undefined
                }
              >
                <Eye size={13} style={mounted && themeMode === "eye-care" ? { color: "#ffffff" } : undefined} />
                <span
                  className="hidden sm:inline"
                  style={mounted && themeMode === "eye-care" ? { color: "#ffffff", fontWeight: 600 } : undefined}
                >
                  护眼
                </span>
              </button>
            </div>

            {/* 设置（有新版本时高亮发光并带脉冲微标） */}
            <button
              onClick={() => setSettingsOpen(true)}
              title={hasUpdate ? "设置（发现全新版本！）" : "设置"}
              className={cn(
                "relative flex h-9 w-9 items-center justify-center rounded-xl border transition-all hover:shadow-sm",
                hasUpdate && "ring-2 ring-primary/60 border-primary/80 shadow-[0_0_12px_rgba(56,189,248,0.35)]"
              )}
              style={{
                borderColor: hasUpdate ? "hsl(var(--primary))" : colors.borderSolid,
                background: colors.card,
                color: hasUpdate ? "hsl(var(--primary))" : colors.text,
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = colors.dropdownHover)}
              onMouseLeave={(e) => (e.currentTarget.style.background = colors.card)}
            >
              <Settings size={17} />
              {hasUpdate && (
                <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary" />
                </span>
              )}
            </button>

            {/* 打赏 */}
            <button
              onClick={() => setDonateOpen(true)}
              title="投喂芙芙小蛋糕"
              className="flex h-9 w-9 items-center justify-center rounded-xl border transition-all hover:shadow-sm"
              style={{
                borderColor: colors.borderSolid,
                background: colors.card,
                color: "#f472b6",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = colors.dropdownHover; e.currentTarget.style.color = "#ec4899"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = colors.card; e.currentTarget.style.color = "#f472b6"; }}
            >
              <Heart size={17} fill="currentColor" />
            </button>
          </div>

          {/* spacer：把窗口控制按钮组推到顶栏最右侧（flex-1 占满剩余空间即可，header 自身已是 drag 区） */}
          <div className="flex-1" style={{ minWidth: 0 }} />

          {/* 窗口控制按钮 - 最右侧（ml-auto 兜底，确保贴右） */}
          <div
            className="ml-auto flex shrink-0 items-center gap-2"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            <button
              onClick={() => window.furinakit?.minimize?.()}
              title="最小化"
              className="flex h-9 w-9 items-center justify-center rounded-xl border transition-all hover:shadow-sm"
              style={{ borderColor: colors.borderSolid, background: colors.card, color: colors.text }}
            >
              <Minus size={16} strokeWidth={2.5} />
            </button>
            <button
              onClick={() => window.furinakit?.toggleMaximize?.()}
              title={isMaximized ? "还原" : "最大化"}
              aria-label={isMaximized ? "还原窗口" : "最大化窗口"}
              className="flex h-9 w-9 items-center justify-center rounded-xl border transition-all hover:shadow-sm"
              style={{ borderColor: colors.borderSolid, background: colors.card, color: colors.text }}
            >
              {isMaximized ? (
                // 还原图标：后置的小方框叠在左上方框上（lucide Copy 的视觉语义）
                <Copy size={14} strokeWidth={2.5} />
              ) : (
                <Square size={14} strokeWidth={2.5} />
              )}
            </button>
            <button
              onClick={() => window.furinakit?.close?.()}
              title="关闭"
              className="flex h-9 w-9 items-center justify-center rounded-xl border transition-all hover:shadow-sm"
              style={{ borderColor: colors.borderSolid, background: colors.card, color: colors.text }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "#ef4444"; e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = "#ef4444"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = colors.card; e.currentTarget.style.color = colors.text; e.currentTarget.style.borderColor = colors.borderSolid; }}
            >
              <X size={16} strokeWidth={2.5} />
            </button>
          </div>

        </header>

        {/* 内容滚动区 */}
        <main ref={mainRef} onScroll={handleMainScroll} className="thin-scroll min-h-0 flex-1 overflow-y-auto">
          <PageTransition key={pathname + (searchParams?.toString() ?? "")}>
            {children}
          </PageTransition>
        </main>
      </div>
      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      <DonateModal open={donateOpen} onClose={() => setDonateOpen(false)} />
    </div>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="min-h-screen w-full bg-background" />}>
      <ShellBody>{children}</ShellBody>
    </Suspense>
  );
}
