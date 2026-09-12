"use client";

import { Suspense, useMemo, useEffect } from "react";
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
import { trackAppLaunch } from "@/lib/analytics";

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

/** 板块内部再分组时的子板块名（只有声明了 subcategory 的板块才会用到） */
const SUBCATEGORY_LABELS: Record<string, string> = {
  math: "数学",
  calc: "计算",
  life: "生活工具",
  work: "日常办公",
};

/** 渲染一个大类分类工具网格（若该板块声明了 subcategory，则内部再分几个子板块） */
function CategoryBlock({ category, tools }: { category: ToolCategory; tools: OmniTool[] }) {
  const list = tools.filter((t) => t.category === category);
  const accent = CATEGORY_COLOR[category] ?? "#0ea5e9";

  // 按 subcategory 分组：保持 tools.ts 里的原始顺序，未声明的归入默认组
  const groups = useMemo(() => {
    const map = new Map<string, OmniTool[]>();
    for (const tool of list) {
      const key = tool.subcategory && SUBCATEGORY_LABELS[tool.subcategory] ? tool.subcategory : "";
      const bucket = map.get(key);
      if (bucket) bucket.push(tool);
      else map.set(key, [tool]);
    }
    return [...map.entries()];
  }, [list]);

  const split = groups.length > 1;

  return (
    <section className="space-y-4">
      <SectionTitle
        category={category}
        title={CATEGORY_LABELS[category]}
        count={list.length}
        description={CATEGORY_DESCRIPTIONS[category]}
      />
      {split ? (
        <div className="space-y-7">
          {groups.map(([key, groupTools]) => (
            <div key={key || "default"} className="space-y-3.5">
              <div className="flex items-center gap-2">
                <span className="h-3.5 w-1 shrink-0 rounded-full" style={{ background: accent }} />
                <h3 className="text-[13.5px] font-semibold text-foreground">
                  {SUBCATEGORY_LABELS[key] ?? "其他"}
                </h3>
                <span className="text-[12px] text-muted-foreground">{groupTools.length} 个工具</span>
              </div>
              <SortableToolGrid tools={groupTools} storageKey={`${category}:${key}`} />
            </div>
          ))}
        </div>
      ) : (
        <SortableToolGrid tools={list} storageKey={category} />
      )}
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

  useEffect(() => {
    trackAppLaunch();
  }, []);

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
