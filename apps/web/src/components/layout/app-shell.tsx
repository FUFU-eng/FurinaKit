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
  Hash,
  Search,
  Moon,
  Sun,
  Eye,
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

const NAV_ITEMS: NavItem[] = [
  { key: "all", label: "全部工具", icon: LayoutGrid, color: "#6366f1", href: "/", isCategory: false },
  { key: "favorites", label: "我的收藏", icon: Heart, color: "#ec4899", href: "/favorites", isCategory: false },
  { key: "image", label: "图片工具", icon: ImageIcon, color: "#0ea5e9", href: "/?c=image", isCategory: true },
  { key: "pdf", label: "PDF 工具", icon: FileText, color: "#10b981", href: "/?c=pdf", isCategory: true },
  { key: "download", label: "视频工具", icon: Download, color: "#f59e0b", href: "/?c=download", isCategory: true },
  { key: "audio", label: "音频工具", icon: Music, color: "#a855f7", href: "/?c=audio", isCategory: true },
  { key: "text", label: "文本办公", icon: Type, color: "#14b8a6", href: "/?c=text", isCategory: true },
  { key: "dev", label: "开发运维", icon: Code, color: "#6366f1", href: "/?c=dev", isCategory: true },
  { key: "encode", label: "密码编码", icon: Hash, color: "#f97316", href: "/?c=encode", isCategory: true },
  { key: "utility", label: "实用生活", icon: Wrench, color: "#f472b6", href: "/?c=utility", isCategory: true },
];

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

  const tools = useMemo(() => getAvailableTools().filter((t) => !t.comingSoon), []);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return tools
      .filter((t) => {
        return (
          t.name.toLowerCase().includes(q) ||
          t.description.toLowerCase().includes(q) ||
          t.id.toLowerCase().includes(q) ||
          (CATEGORY_LABELS[t.category] && CATEGORY_LABELS[t.category].toLowerCase().includes(q))
        );
      })
      .slice(0, 8);
  }, [query, tools]);

  // 全局快捷键 Ctrl+K 聚焦输入框直接打字
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setFocused(false);
      inputRef.current?.blur();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (results.length ? (prev + 1) % results.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (results.length ? (prev - 1 + results.length) % results.length : 0));
    } else if (e.key === "Enter" && results.length > 0) {
      e.preventDefault();
      handleSelect(results[selectedIndex]?.id || results[0].id);
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
          onKeyDown={handleKeyDown}
          placeholder="搜索工具 (Ctrl+K)..."
          className="h-9 w-full rounded-xl border border-input bg-card pl-9 pr-8 text-xs text-foreground placeholder:text-muted-foreground/60 transition-all duration-200 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
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
            Ctrl K
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
            results.map((tool, index) => {
              const isSelected = index === selectedIndex;
              return (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => handleSelect(tool.id)}
                  onMouseEnter={() => setSelectedIndex(index)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors",
                    isSelected ? "bg-accent text-accent-foreground" : "text-foreground hover:bg-accent/60"
                  )}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold">{tool.name}</span>
                      <span className="rounded bg-primary/10 px-1.5 py-0.2 text-[10px] text-primary">
                        {CATEGORY_LABELS[tool.category]}
                      </span>
                    </div>
                    <p className="truncate text-[11px] text-muted-foreground">{tool.description}</p>
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
  const { theme, toggleTheme, setTheme, colors, mounted } = useTheme();
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
            {/* 三态主题切换：浅色 | 深色 | 护眼 */}
            <div
              className="flex h-9 items-center gap-0.5 rounded-xl border p-0.5"
              style={{ borderColor: colors.borderSolid, background: colors.card }}
            >
              <button
                type="button"
                onClick={() => setTheme("light")}
                title="浅色模式"
                className={cn(
                  "flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-medium transition-all",
                  mounted && theme === "light"
                    ? "bg-primary text-primary-foreground shadow-xs"
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
                  "flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-medium transition-all",
                  mounted && theme === "dark"
                    ? "bg-primary text-primary-foreground shadow-xs"
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
                  "flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-medium transition-all",
                  mounted && theme === "eye-care"
                    ? "bg-amber-600 text-white shadow-xs"
                    : "text-muted-foreground hover:text-foreground hover:bg-muted/40"
                )}
              >
                <Eye size={13} />
                <span className="hidden sm:inline">护眼</span>
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
