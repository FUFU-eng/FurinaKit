"use client";

import { Suspense, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import {
  getAvailableTools,
  toolCategories,
  CATEGORY_LABELS,
  CATEGORY_DESCRIPTIONS,
  type OmniTool,
  type ToolCategory,
} from "@furinakit/shared";
import { categoryIcon } from "@/lib/tool-icons";
import { SortableToolGrid } from "@/components/tools/sortable-grid";
import { CATEGORY_COLOR } from "@/components/tools/tool-card";

function SectionTitle({
  category,
  title,
  count,
  description,
}: {
  category: ToolCategory;
  title: string;
  count: number;
  description?: string;
}) {
  const accent = CATEGORY_COLOR[category] ?? "#0ea5e9";
  const Icon = categoryIcon[category];
  return (
    <div className="mb-4 flex items-center gap-3">
      <span
        className="flex h-9 w-9 items-center justify-center rounded-xl border"
        style={{ color: accent, background: `${accent}12`, borderColor: `${accent}30` }}
      >
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
      </span>
      <div className="min-w-0">
        <h2 className="flex items-center gap-2 text-[16px] font-bold leading-tight text-foreground">
          {title}
          <span className="text-[12px] font-normal text-muted-foreground">{count} 个工具</span>
        </h2>
        {description && (
          <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">{description}</p>
        )}
      </div>
    </div>
  );
}

/** 渲染一个大类分类工具网格 */
function CategoryBlock({ category, tools }: { category: ToolCategory; tools: OmniTool[] }) {
  const list = tools.filter((t) => t.category === category);

  return (
    <section className="space-y-4">
      <SectionTitle
        category={category}
        title={CATEGORY_LABELS[category]}
        count={list.length}
        description={CATEGORY_DESCRIPTIONS[category]}
      />
      <SortableToolGrid tools={list} storageKey={category} />
    </section>
  );
}

function HomeInner() {
  const searchParams = useSearchParams();
  const c = searchParams.get("c") as ToolCategory | null;

  const all = useMemo(() => getAvailableTools(), []);
  const visibleCats = useMemo(() => {
    if (c && toolCategories.includes(c as never)) return [c];
    return toolCategories.filter((cat) => all.some((t) => t.category === cat));
  }, [all, c]);

  return (
    <div className="mx-auto max-w-none space-y-10 p-6 lg:p-8">
      {!c && (
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-foreground">全部工具</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            共 {all.length} 个本地工具，长按卡片可自由拖动排序，图钉可置顶，心形可收藏。
          </p>
        </div>
      )}
      {visibleCats.map((cat) => (
        <CategoryBlock key={cat} category={cat} tools={all} />
      ))}
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={null}>
      <HomeInner />
    </Suspense>
  );
}
