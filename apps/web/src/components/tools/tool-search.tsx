"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import {
  getAvailableTools,
  toolCategories,
  CATEGORY_LABELS,
  CATEGORY_DESCRIPTIONS,
} from "@furinakit/shared";
import type { ToolCategory } from "@furinakit/shared";
import { ToolCard } from "@/components/tools/tool-card";
import { categoryIcon } from "@/lib/tool-icons";
import { cn } from "@/lib/utils";

const categoryText: Record<string, string> = {
  image:    "text-sky-400",
  pdf:      "text-rose-400",
  download: "text-emerald-400",
  audio:    "text-fuchsia-400",
  text:     "text-teal-400",
  dev:      "text-indigo-400",
  encode:   "text-orange-400",
  utility:  "text-primary",
};

const categoryDot: Record<string, string> = {
  image:    "bg-sky-400",
  pdf:      "bg-rose-400",
  download: "bg-emerald-400",
  audio:    "bg-fuchsia-400",
  text:     "bg-teal-400",
  dev:      "bg-indigo-400",
  encode:   "bg-orange-400",
  utility:  "bg-primary",
};

export function ToolSearch() {
  const tools = useMemo(() => getAvailableTools(), []);
  const [query, setQuery] = useState("");
  const [activeCat, setActiveCat] = useState<ToolCategory | "all">("all");

  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      tools.filter((t) => {
        const matchesQuery =
          !q || t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q) || t.id.includes(q);
        const matchesCat = activeCat === "all" || t.category === activeCat;
        return matchesQuery && matchesCat;
      }),
    [tools, q, activeCat],
  );

  const visibleCategories = toolCategories.filter((c) => tools.some((t) => t.category === c));
  const isFiltering = q.length > 0 || activeCat !== "all";

  return (
    <div className="space-y-10">
      {/* Sticky search + category filter */}
      <div className="sticky top-16 z-30 -mx-6 border-b border-border/70 glass px-6 py-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search tools…"
              className="h-11 w-full rounded-md border border-input bg-secondary/40 pl-10 pr-9 text-sm text-foreground placeholder:text-muted-foreground/70 transition-all focus-visible:border-primary/60 focus-visible:bg-secondary/20 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-primary/10"
            />
            {query && (
              <button
                onClick={() => setQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label="Clear search"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <div className="flex flex-wrap gap-1.5">
            <CatChip
              active={activeCat === "all"}
              onClick={() => setActiveCat("all")}
              label="All"
              count={tools.filter((t) => !t.comingSoon).length}
            />
            {visibleCategories.map((c) => (
              <CatChip
                key={c}
                active={activeCat === c}
                onClick={() => setActiveCat(c)}
                label={CATEGORY_LABELS[c].split(" ")[0]}
                dot={categoryDot[c]}
                count={tools.filter((t) => t.category === c && !t.comingSoon).length}
              />
            ))}
          </div>
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="flex flex-col items-center justify-center gap-4 py-16">
          <div className="flex h-16 w-16 items-center justify-center rounded-xl border border-border bg-card">
            <Search className="h-7 w-7 text-muted-foreground/40" />
          </div>
          <div className="text-center">
            <p className="text-sm font-semibold text-foreground">No tools found</p>
            <p className="mt-1 text-xs text-muted-foreground">
              No results for <span className="text-primary">&ldquo;{query}&rdquo;</span>
            </p>
          </div>
          <button
            onClick={() => {
              setQuery("");
              setActiveCat("all");
            }}
            className="font-mono-accent text-xs uppercase tracking-widest text-primary hover:underline"
          >
            Clear filters
          </button>
        </div>
      )}

      {/* Flat grid when filtering, category sections otherwise */}
      {isFiltering ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {filtered.map((tool, i) => (
            <ToolCard key={tool.id} tool={tool} index={i} />
          ))}
        </div>
      ) : (
        visibleCategories.map((category) => {
          const catTools = tools.filter((t) => t.category === category);
          const CatIcon = categoryIcon[category];
          return (
            <section key={category} id={category} className="scroll-mt-32 space-y-4">
              {/* Section header */}
              <div className={cn("cat-section-strip cat-" + category, "px-4 py-3.5")}>
                <div className="flex items-center gap-3">
                  <span
                    className={cn(
                      "flex h-8 w-8 items-center justify-center rounded-md border bg-background/40",
                      categoryText[category],
                    )}
                    style={{ borderColor: "hsl(var(--cat) / 0.3)" }}
                  >
                    <CatIcon className="h-4 w-4" strokeWidth={1.6} />
                  </span>
                  <h2 className={cn("text-sm font-bold tracking-tight", categoryText[category])}>
                    {CATEGORY_LABELS[category]}
                  </h2>
                  <span
                    className="font-mono-accent ml-auto rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-widest"
                    style={{ borderColor: "hsl(var(--cat) / 0.3)", color: "hsl(var(--cat))" }}
                  >
                    {catTools.length} tool{catTools.length !== 1 ? "s" : ""}
                  </span>
                </div>
                <p className="mt-2 pl-11 text-[13px] text-muted-foreground">
                  {CATEGORY_DESCRIPTIONS[category]}
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {catTools.map((tool, i) => (
                  <ToolCard key={tool.id} tool={tool} index={i} />
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

function CatChip({
  active,
  onClick,
  label,
  dot,
  count,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  dot?: string;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-all",
        active
          ? "border-primary/50 bg-primary/15 text-primary"
          : "border-border text-muted-foreground hover:border-border/80 hover:bg-secondary/50 hover:text-foreground",
      )}
    >
      {dot && <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dot)} />}
      {label}
      {count !== undefined && (
        <span className={cn("font-mono-accent text-[10px]", active ? "text-primary/70" : "text-muted-foreground/50")}>
          {count}
        </span>
      )}
    </button>
  );
}
