"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { Search, CornerDownLeft, ArrowUp, ArrowDown, History, Heart, Home } from "lucide-react";
import { getAvailableTools, CATEGORY_LABELS, downloadsEnabled } from "@furinakit/shared";
import type { OmniTool } from "@furinakit/shared";
import { getToolIcon } from "@/lib/tool-icons";
import { CATEGORY_COLOR } from "@/components/tools/tool-card";
import { cn } from "@/lib/utils";

export const OPEN_COMMAND_EVENT = "furinakit:open-command";

type Item =
  | { type: "tool"; tool: OmniTool }
  | { type: "link"; id: string; name: string; description: string; href: string };

export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const tools = useMemo(() => getAvailableTools().filter((t) => !t.comingSoon), []);

  const links: Item[] = useMemo(() => {
    const base: Item[] = [
      { type: "link", id: "home", name: "首页", description: "浏览全部工具", href: "/" },
      { type: "link", id: "favorites", name: "我的收藏", description: "查看收藏的工具", href: "/favorites" },
    ];
    if (downloadsEnabled()) {
      base.push({ type: "link", id: "jobs", name: "任务记录", description: "查看下载与处理任务", href: "/jobs" });
    }
    return base;
  }, []);

  const items: Item[] = useMemo(() => {
    const q = query.trim().toLowerCase();
    const toolItems: Item[] = tools.map((tool) => ({ type: "tool", tool }));
    const all = [...links, ...toolItems];
    if (!q) return all;
    return all.filter((item) => {
      if (item.type === "tool") {
        return (
          item.tool.name.toLowerCase().includes(q) ||
          item.tool.description.toLowerCase().includes(q) ||
          item.tool.id.includes(q) ||
          CATEGORY_LABELS[item.tool.category].toLowerCase().includes(q)
        );
      }
      return item.name.toLowerCase().includes(q) || item.description.toLowerCase().includes(q);
    });
  }, [query, tools, links]);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
  }, []);

  const go = useCallback(
    (item: Item) => {
      const href = item.type === "tool" ? `/tools/${item.tool.id}` : item.href;
      close();
      router.push(href);
    },
    [router, close],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_COMMAND_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_COMMAND_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setActive(0);
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open]);

  useEffect(() => setActive(0), [query]);

  const onListKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[active];
      if (item) go(item);
    }
  };

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    node?.scrollIntoView({ block: "nearest" });
  }, [active]);

  const linkIcon = (id: string) => (id === "jobs" ? History : id === "favorites" ? Heart : Home);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[12vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
        >
          <div className="absolute inset-0 bg-background/70 backdrop-blur-sm" onClick={close} aria-hidden />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="搜索工具"
            initial={{ opacity: 0, y: -12, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -8, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 380, damping: 30 }}
            onKeyDown={onListKey}
            className="glass relative w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl"
          >
            <div className="flex items-center gap-3 border-b border-border px-4">
              <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索工具或页面…"
                className="h-14 flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground/70 focus:outline-none"
              />
              <kbd className="hidden shrink-0 rounded border border-border bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground sm:block">
                ESC
              </kbd>
            </div>

            <div ref={listRef} className="thin-scroll max-h-[52vh] overflow-y-auto p-2">
              {items.length === 0 ? (
                <div className="px-3 py-10 text-center">
                  <p className="text-xs text-muted-foreground">
                    没有找到与「<span className="text-primary">{query}</span>」相关的工具
                  </p>
                </div>
              ) : (
                items.map((item, idx) => {
                  const isActive = idx === active;
                  if (item.type === "link") {
                    const LinkIcon = linkIcon(item.id);
                    return (
                      <button
                        key={item.id}
                        data-idx={idx}
                        onClick={() => go(item)}
                        onMouseMove={() => setActive(idx)}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                          isActive ? "bg-secondary" : "hover:bg-secondary/60",
                        )}
                      >
                        <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground">
                          <LinkIcon className="h-4 w-4" strokeWidth={1.6} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium text-foreground">{item.name}</span>
                          <span className="block truncate text-xs text-muted-foreground">{item.description}</span>
                        </span>
                        {isActive && <CornerDownLeft className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                      </button>
                    );
                  }
                  const Icon = getToolIcon(item.tool.icon);
                  const accent = CATEGORY_COLOR[item.tool.category] ?? "#0ea5e9";
                  return (
                    <button
                      key={item.tool.id}
                      data-idx={idx}
                      onClick={() => go(item)}
                      onMouseMove={() => setActive(idx)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                        isActive ? "bg-secondary" : "hover:bg-secondary/60",
                      )}
                    >
                      <span
                        className="flex h-8 w-8 items-center justify-center rounded-lg border"
                        style={{ color: accent, background: `${accent}14`, borderColor: `${accent}30` }}
                      >
                        <Icon className="h-4 w-4" strokeWidth={1.6} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-foreground">{item.tool.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">{item.tool.description}</span>
                      </span>
                      <span className="shrink-0 text-[11px]" style={{ color: accent }}>
                        {CATEGORY_LABELS[item.tool.category]}
                      </span>
                    </button>
                  );
                })
              )}
            </div>

            <div className="flex items-center justify-between border-t border-border px-4 py-2.5">
              <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="flex items-center gap-1">
                  <ArrowUp className="h-3 w-3" />
                  <ArrowDown className="h-3 w-3" />
                  选择
                </span>
                <span className="flex items-center gap-1">
                  <CornerDownLeft className="h-3 w-3" />
                  打开
                </span>
              </div>
              <span className="text-[11px] text-muted-foreground">{items.length} 个结果</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
