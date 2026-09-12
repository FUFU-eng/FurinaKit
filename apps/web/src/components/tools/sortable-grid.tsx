"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  rectSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { OmniTool } from "@furinakit/shared";
import { useCategoryOrder, usePins } from "@/lib/use-tool-prefs";
import { useGridCols } from "@/lib/use-window-cols";
import { ToolCard, type DragHandle } from "./tool-card";

function SortableItem({
  tool,
  index,
  suppressClick,
}: {
  tool: OmniTool;
  index: number;
  suppressClick: () => boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: tool.id });

  const drag: DragHandle = {
    setNodeRef,
    attributes,
    listeners,
    style: {
      transform: CSS.Transform.toString(transform),
      transition,
    },
    isDragging,
    longPressMs: LONG_PRESS_MS,
  };

  // 拖拽项不加入场动画，避免双层 transform 干扰
  return <ToolCard tool={tool} index={index} drag={drag} suppressClick={suppressClick} animate={false} />;
}

const GRID_CLS = "grid gap-4";

/**
 * 长按多久才算「拖到了」（毫秒）。
 * 这个值同时喂给两处，必须保持一致：
 *  - dnd-kit 的 PointerSensor activationConstraint.delay（真正的判定）
 *  - 卡片上的蓄力进度条（给用户看的"还要摁多久"）
 * 一路调下来的：400（原始）→ 350 → 220。220 已经比一次正常点击（通常在 120ms 内松手）
 * 留出足够余量，不会把"点一下打开工具"误判成拖拽，同时读条一闪就满、不再有等待感。
 */
const LONG_PRESS_MS = 220;
/** 长按判定期间允许的手指抖动（px）。原值 8 太苛刻，稍微动一下就取消，感觉"不跟手" */
const LONG_PRESS_TOLERANCE = 15;

/**
 * 单个分组内的工具卡片网格：
 * - 长按 0.22s 进入拖拽排序（短按/单击 = 打开工具，绝不误触发）
 * - 置顶的卡片永远排在最前（多个置顶保持相对顺序）
 * - 自定义顺序按分类持久化到 localStorage
 * - 挂载前渲染普通卡片，避免 dnd-kit 的 aria 序号在 SSR/客户端不一致导致水合报错
 */
export function SortableToolGrid({
  tools,
  storageKey,
}: {
  tools: OmniTool[];
  /** 排序持久化的分组键（分类名或 分类:子分类） */
  storageKey: string;
}) {
  const { order, setOrder } = useCategoryOrder(storageKey);
  const { pins } = usePins();
  const [mounted, setMounted] = useState(false);
  const [, setActiveId] = useState<string | null>(null);
  const lastDragEnd = useRef(0);
  const isDraggingRef = useRef(false);

  useEffect(() => setMounted(true), []);

  // 列数：默认 3 列，最大化或视口 ≥ 1500 时升到 4 列（详见 useGridCols）
  const cols = useGridCols();

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { delay: LONG_PRESS_MS, tolerance: LONG_PRESS_TOLERANCE },
    }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const ordered = useMemo(() => {
    const arr = [...tools];
    if (order && order.length) {
      const rank = (id: string) => {
        const i = order.indexOf(id);
        return i === -1 ? Number.MAX_SAFE_INTEGER : i;
      };
      arr.sort((a, b) => rank(a.id) - rank(b.id));
    }
    // 置顶优先
    arr.sort((a, b) => {
      const pa = pins.includes(a.id) ? 0 : 1;
      const pb = pins.includes(b.id) ? 0 : 1;
      return pa - pb;
    });
    return arr;
  }, [tools, order, pins]);

  const onDragStart = (e: DragStartEvent) => {
    setActiveId(String(e.active.id));
    isDraggingRef.current = true;
    // 给body添加class，全局禁用链接点击，防止拖拽结束后误触发
    document.body.classList.add("furinakit-dragging");
  };

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    isDraggingRef.current = false;
    lastDragEnd.current = Date.now();
    // 延迟移除dragging class，确保拖拽结束后的click事件被拦截
    setTimeout(() => {
      document.body.classList.remove("furinakit-dragging");
    }, 400);
    const { active, over } = e;
    if (over && active.id !== over.id) {
      const ids = ordered.map((t) => t.id);
      const oldI = ids.indexOf(String(active.id));
      const newI = ids.indexOf(String(over.id));
      if (oldI >= 0 && newI >= 0) {
        setOrder(arrayMove(ids, oldI, newI));
      }
    }
  };

  // 拖拽刚结束的 500ms 内吞掉 click，防止"松手即打开工具"。
  // dnd-kit 的 PointerSensor 在 pointerup 后浏览器仍会合成 click，但那次 click 是紧接着来的，
  // 500ms 足够拦住它；窗口再长就会把用户「拖完顺手点一下卡片」的正常点击也吃掉，显得不跟手。
  const suppressClick = () => isDraggingRef.current || Date.now() - lastDragEnd.current < 500;

  if (ordered.length === 0) return null;

  // 首屏（SSR + 首次客户端渲染）：普通卡片，保证水合一致
  if (!mounted) {
    return (
      <div className={GRID_CLS} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {ordered.map((tool, i) => (
          <ToolCard key={tool.id} tool={tool} index={i} suppressClick={suppressClick} />
        ))}
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <SortableContext items={ordered.map((t) => t.id)} strategy={rectSortingStrategy}>
        <div className={GRID_CLS} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {ordered.map((tool, i) => (
            <SortableItem key={tool.id} tool={tool} index={i} suppressClick={suppressClick} />
          ))}
        </div>
      </SortableContext>
    </DndContext>
  );
}
