"use client";

import { useEffect, useRef, useState } from "react";
import type { useSortable } from "@dnd-kit/sortable";
import Link from "next/link";
import { motion } from "framer-motion";
import { Heart, Pin, Lock } from "lucide-react";
import type { OmniTool } from "@furinakit/shared";
import { getToolIcon } from "@/lib/tool-icons";
import { useFavorites, usePins } from "@/lib/use-tool-prefs";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

/** 各分类主题色（与侧边栏图标保持一致） */
export const CATEGORY_COLOR: Record<string, string> = {
  image: "#0ea5e9",
  download: "#f59e0b",
  audio: "#a855f7",
  pdf: "#10b981",
  text: "#14b8a6",
  mathcalc: "#7c3aed",
  dev: "#3b82f6",
  security: "#ef4444",
  utility: "#f97316",
  favorite: "#ec4899",
};

/** 拖拽注入句柄（由 SortableToolGrid 提供） */
type DndSortable = ReturnType<typeof useSortable>;
export interface DragHandle {
  setNodeRef: DndSortable["setNodeRef"];
  attributes: DndSortable["attributes"];
  listeners: DndSortable["listeners"];
  style: React.CSSProperties;
  isDragging: boolean;
  /** 长按多久才算「拖到了」（毫秒）。用来驱动卡片上的蓄力进度条，必须和传感器的 delay 一致 */
  longPressMs: number;
}

type ToolCardProps = {
  tool: OmniTool;
  index?: number;
  drag?: DragHandle;
  /** 返回 true 时拦截本次点击（用于“拖拽刚结束，不打开工具”） */
  suppressClick?: () => boolean;
  animate?: boolean;
};

export function ToolCard({ tool, index = 0, drag, suppressClick, animate = true }: ToolCardProps) {
  const Icon = getToolIcon(tool.icon);
  const accent = CATEGORY_COLOR[tool.category] ?? "#0ea5e9";
  const { isFavorite, toggleFavorite } = useFavorites();
  const { isPinned, togglePin } = usePins();
  const { toast } = useToast();

  const favorited = isFavorite(tool.id);
  const pinned = isPinned(tool.id);

  // 卡片级别的拖拽检测：记录鼠标按下位置，click时检查移动距离
  const dragStartPos = useRef<{ x: number; y: number } | null>(null);
  const justDragged = useRef(false);

  const handlePointerDown = (e: React.PointerEvent) => {
    dragStartPos.current = { x: e.clientX, y: e.clientY };
    justDragged.current = false;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!dragStartPos.current) return;
    const dx = Math.abs(e.clientX - dragStartPos.current.x);
    const dy = Math.abs(e.clientY - dragStartPos.current.y);
    // 移动超过8px就认为是拖拽
    if (dx > 8 || dy > 8) {
      justDragged.current = true;
    }
  };

  const handlePointerUp = () => {
    dragStartPos.current = null;
    // 延迟重置justDragged，确保click事件能检测到
    setTimeout(() => { justDragged.current = false; }, 500);
  };

  // ── 长按拖拽的触感反馈 ──────────────────────────────────────────────
  // 参考手机上的长按拖动：摁住立刻缩小一点 → 蓄力（进度条走完）→ 弹一下变大、跟手走。
  // 之前这里长按期间没有任何反馈，用户既不知道要摁多久，也不确定有没有摁到。
  const [pressed, setPressed] = useState(false);
  const [chargeKey, setChargeKey] = useState(0);
  const longPressMs = drag?.longPressMs ?? 350;
  const dragging = !!drag?.isDragging;

  const beginPress = () => {
    setPressed(true);
    setChargeKey((k) => k + 1); // 每次按下都从头开始蓄力
  };
  const endPress = () => setPressed(false);

  // 拖拽结束时（onDragEnd 之后 isDragging 变 false）把按下态一起收掉
  useEffect(() => {
    if (!dragging) return;
    setPressed(false);
  }, [dragging]);

  const stop = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const onToggleFav = (e: React.MouseEvent) => {
    stop(e);
    const nowFav = toggleFavorite(tool.id);
    toast({
      title: nowFav ? `已收藏「${tool.name}」` : `已取消收藏「${tool.name}」`,
      variant: nowFav ? "success" : "info",
      duration: 1600,
    });
  };

  const onTogglePin = (e: React.MouseEvent) => {
    stop(e);
    const nowPinned = togglePin(tool.id);
    toast({
      title: nowPinned ? `已置顶「${tool.name}」` : `已取消置顶「${tool.name}」`,
      variant: nowPinned ? "success" : "info",
      duration: 1600,
    });
  };

  const card = (
    <div
      ref={drag?.setNodeRef}
      style={drag?.style}
      id={`tool-card-${tool.id}`}
      className="h-full"
      {...(drag?.attributes ?? {})}
      {...(drag?.listeners ?? {})}
      // 按下/松开的反馈自己接管：dnd-kit 的 listeners 里只有 PointerSensor 的 onPointerDown，
      // 先让它照跑，再叠加我们的视觉状态（顺序不能反，否则会把传感器覆盖掉）
      onPointerDown={(e) => {
        (drag?.listeners as { onPointerDown?: (ev: React.PointerEvent) => void } | undefined)?.onPointerDown?.(e);
        beginPress();
      }}
      onPointerUp={endPress}
      onPointerCancel={endPress}
      onPointerLeave={endPress}
    >
      <div
        data-tool-id={tool.id}
        // 缩放/倾斜用「状态类 + CSS」而不是 framer-motion：
        // 1) 拖拽期间 dnd-kit 每帧都会更新外层 transform 触发重渲染，motion 的 spring 会被反复重启，
        //    实测要 1.2 秒才慢慢爬到目标值，完全没有"弹一下"的感觉；CSS transition 只认最终样式值。
        // 2) 具体数值与缓动写在 globals.css 的 .fk-card-pressed / .fk-card-dragging 里 —— 因为卡片上的
        //    .tool-card-hover:hover 自带一个 translateY 位移，普通工具类的 .scale-* 优先级不够，会被它顶掉。
        className={cn(
          "group tool-card-hover relative h-full touch-none select-none rounded-2xl border bg-card text-card-foreground",
          dragging && "fk-card-dragging z-50 cursor-grabbing border-primary/40 shadow-2xl ring-2 ring-primary/25",
          !dragging && pressed && "fk-card-pressed",
        )}
      >
        {/* 蓄力进度：走完就代表已经「拖到了」，松开即落位 */}
        {pressed && !dragging && (
          <motion.span
            key={chargeKey}
            initial={{ scaleX: 0 }}
            animate={{ scaleX: 1 }}
            transition={{ duration: longPressMs / 1000, ease: "linear" }}
            className="pointer-events-none absolute inset-x-2 bottom-1.5 z-20 h-[3px] origin-left rounded-full bg-primary/60"
          />
        )}
      <Link
        href={`/tools/${tool.id}`}
        prefetch={false}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onClick={(e) => {
          if (tool.comingSoon) {
            e.preventDefault();
            e.stopPropagation();
            return;
          }
          // 三重检测：suppressClick（全局） + justDragged（卡片级） + isDragging（拖拽中）
          if (suppressClick?.() || justDragged.current) {
            e.preventDefault();
            e.stopPropagation();
            justDragged.current = false;
            return;
          }
          // 记录进入工具前的滚动高度与页面路径，以便返回时无缝自动定位
          try {
            sessionStorage.setItem("furina:last_tool_id", tool.id);
            const mainEl = document.querySelector("main");
            if (mainEl) {
              sessionStorage.setItem("furina:last_tool_scroll", String(mainEl.scrollTop));
            }
            sessionStorage.setItem("furina:last_list_url", window.location.pathname + window.location.search);
            sessionStorage.setItem("furina:restore_scroll", "1");
          } catch {
            /* ignore */
          }
        }}
        className={cn(
          "relative flex h-full cursor-pointer flex-col gap-3.5 rounded-2xl p-5",
          tool.comingSoon && "cursor-not-allowed",
        )}
      >
        {tool.comingSoon && (
          <div className="absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-card/60">
            <Lock className="h-5 w-5 text-muted-foreground/50" />
          </div>
        )}

        {/* 顶部：图标 + 角标/收藏 */}
        <div className="flex items-start justify-between gap-2">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border transition-transform duration-300 group-hover:scale-105"
            style={{
              color: accent,
              background: `${accent}14`,
              borderColor: `${accent}33`,
            }}
          >
            <Icon className="h-5 w-5" strokeWidth={1.8} />
          </span>

          <div className="flex items-center gap-1">
            {tool.clientSide && (
              <span className="shrink-0 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-500">
                本地
              </span>
            )}
            {tool.selfHostOnly && !tool.clientSide && (
              <span className="shrink-0 rounded-full border border-sky-500/30 bg-sky-500/10 px-2 py-0.5 text-[10px] font-medium text-sky-500">
                本地服务
              </span>
            )}
            <button
              type="button"
              onClick={onToggleFav}
              aria-label={favorited ? "取消收藏" : "收藏"}
              aria-pressed={favorited}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-colors hover:bg-secondary"
              style={{ color: favorited ? "#ec4899" : undefined }}
            >
              <Heart className={cn("h-4 w-4", favorited && "fill-[#ec4899]")} />
            </button>
          </div>
        </div>

        {/* 文案 */}
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-[15px] font-semibold text-foreground">{tool.name}</h3>
          <p className="mt-1.5 line-clamp-2 text-[12.5px] leading-relaxed text-muted-foreground pr-9">
            {tool.description}
          </p>
        </div>
      </Link>

      {/* 右下角：置顶图钉（和右上角收藏按钮竖直对齐，right位置相同） */}
      {!tool.comingSoon && (
        <button
          type="button"
          onClick={onTogglePin}
          aria-label={pinned ? "取消置顶" : "置顶"}
          aria-pressed={pinned}
          title={pinned ? "取消置顶" : "置顶"}
          className="absolute bottom-2.5 right-[18px] z-10 flex h-7 w-7 items-center justify-center rounded-lg transition-colors hover:bg-secondary"
          style={{
            color: pinned ? accent : undefined,
            background: pinned ? `${accent}18` : undefined,
          }}
        >
          <Pin
            className={cn(
              "h-4 w-4 transition-colors",
              pinned ? "fill-current" : "text-muted-foreground/40 group-hover:text-muted-foreground"
            )}
          />
        </button>
      )}
      </div>
    </div>
  );

  if (!animate) return card;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{
        duration: 0.3,
        delay: Math.min(index * 0.02, 0.25),
        ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
      }}
      className="h-full"
    >
      {card}
    </motion.div>
  );
}
