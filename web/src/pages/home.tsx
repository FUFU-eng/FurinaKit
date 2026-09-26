"use client";
import { createUiText as __createUiText, useLanguage as __useLanguage, uiCount as __count } from "@/lib/language";
const __ui = __createUiText("pages/home.tsx");


import { Suspense, useMemo, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  getAvailableTools,
  toolCategories,
  CATEGORY_LABELS,
  CATEGORY_DESCRIPTIONS,
  type OmniTool,
  type ToolCategory,
} from "@furinakit/shared";
import { categoryIcon, getToolIcon } from "@/lib/tool-icons";
import { SortableToolGrid } from "@/components/tools/sortable-grid";
import { CATEGORY_COLOR } from "@/components/tools/tool-card";
import { trackAppLaunch } from "@/lib/analytics";
import { Button } from "@/components/ui/primitives";
import { useFavorites } from "@/lib/use-tool-prefs";
import { useTheme } from "@/components/theme-provider";
import {
  Flame,
  Heart,
  ArrowRight,
  ArrowLeft,
  Sparkles,
  Compass,
  UserCheck,
  Shield,
  Lock,
  Github,
  ExternalLink,
  Plus,
  BookmarkPlus,
  ChevronRight,
  MessageSquareHeart,
} from "lucide-react";
import { FeedbackModal } from "@/components/layout/feedback-modal";

/**
 * ─────────────────────────────────────────────────────────────────────────────
 * 热门工具配置清单（首期内置 4 款核心高频工具）
 * 后续修改/增删热门工具极其简易，只需在此数组中增删对应工具的 id 即可：
 *  1. lan-transfer: 跨设备互传
 *  2. image-upscale: 图片高清强化
 *  3. image-obfuscate: 图片混淆
 *  4. image-to-pdf: 图片转 PDF
 * ─────────────────────────────────────────────────────────────────────────────
 */
export const DEFAULT_HOT_TOOL_IDS: string[] = [
  "lan-transfer",
  "image-upscale",
  "image-obfuscate",
  "image-to-pdf",
  "magnet-download",
  "bilibili-download",
  "image-dedup",
  "batch-rename",
  "mind-map",
];

/**
 * 热门工具极简项组件（统一高质感天蓝微光色调，避免多种类工具五花八门杂乱，视觉清爽高级）
 */
function HotToolItem({ tool }: { tool: OmniTool }) {
  const __locale = __useLanguage();
  const Icon = getToolIcon(tool.icon);

  return (
    <Link
      href={`/tools/${tool.id}`}
      className="group flex w-[84px] flex-col items-center gap-2 py-2 px-1 rounded-2xl transition-all duration-200 hover:bg-black/[0.03] dark:hover:bg-white/[0.04] active:scale-95 cursor-pointer shrink-0"
      title={`${tool.name} · ${tool.description}`}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-sky-500/20 bg-sky-500/10 text-sky-600 dark:text-sky-400 dark:border-sky-400/20 dark:bg-sky-400/10 transition-all duration-300 group-hover:scale-105 group-hover:bg-sky-500/20 dark:group-hover:bg-sky-400/20 group-hover:border-sky-400/50 group-hover:shadow-[0_0_16px_rgba(56,189,248,0.25)]">
        <Icon size={22} strokeWidth={1.9} />
      </div>
      <span className="w-full text-center text-[12px] font-medium text-foreground/90 truncate group-hover:text-sky-500 dark:group-hover:text-sky-400 transition-colors">
        {tool.name}
      </span>
    </Link>
  );
}

/** 分类头部组件 */
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
  const __locale = __useLanguage();
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
          {__ui(title)}
          <span className="text-[12px] font-normal text-muted-foreground">{__count(count, "个工具")} </span>
        </h2>
        {description && (
          <p className="mt-0.5 truncate text-[12.5px] text-muted-foreground">{__ui(description)}</p>
        )}
      </div>
    </div>
  );
}

/** 板块内部再分组时的子板块名 */
const SUBCATEGORY_LABELS: Record<string, string> = {
  math: "数学",
  calc: "计算",
  life: "生活工具",
  work: "日常办公",
};

/** 单个分类工具网格 */
function CategoryBlock({ category, tools }: { category: ToolCategory; tools: OmniTool[] }) {
  const __locale = __useLanguage();
  const list = useMemo(() => tools.filter((t) => t.category === category), [tools, category, __locale]);
  const accent = CATEGORY_COLOR[category] ?? "#0ea5e9";

  const groups = useMemo(() => {
    const map = new Map<string, OmniTool[]>();
    for (const tool of list) {
      const key = ""; // Central catalog already defines intentional category order.
      const bucket = map.get(key);
      if (bucket) bucket.push(tool);
      else map.set(key, [tool]);
    }
    return [...map.entries()];
  }, [list, __locale]);

  const split = groups.length > 1;

  return (
    <section className="space-y-4">
      <SectionTitle
        category={category}
        title={__ui(CATEGORY_LABELS[category])}
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
                  {__ui(SUBCATEGORY_LABELS[key]) ?? __ui("其他")}
                </h3>
                <span className="text-[12px] text-muted-foreground">{__count(groupTools.length, "个工具")} </span>
              </div>
              <SortableToolGrid tools={groupTools} storageKey={`${category}:${key}`} />
            </div>
          ))}
        </div>
      ) : (
        <SortableToolGrid tools={list} storageKey={`catalog-v63:${category}`} />
      )}
    </section>
  );
}

/**
 * 首页视图主容器
 */
function HomeInner() {
  const __locale = __useLanguage();
  const searchParams = useSearchParams();
  const c = searchParams.get("c") as ToolCategory | null;
  const { colors } = useTheme();
  const { favorites, toggleFavorite } = useFavorites();
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  const all = useMemo(() => getAvailableTools(), [ __locale]);

  // 1. 热门工具列表（首期 4 款）
  const hotTools = useMemo(() => {
    return DEFAULT_HOT_TOOL_IDS.map((id) => all.find((t) => t.id === id)).filter(Boolean) as OmniTool[];
  }, [all, __locale]);

  // 2. 我的收藏工具列表
  const favoriteTools = useMemo(() => {
    return all.filter((t) => favorites.includes(t.id));
  }, [all, favorites, __locale]);

  useEffect(() => {
    trackAppLaunch();
  }, []);

  // ── 场景一：用户点击了左侧或底部的某个大类（如 /?c=image） ──
  if (c && toolCategories.includes(c as never)) {
    return (
      <div className="mx-auto max-w-none space-y-6 p-6 lg:p-8">
        {/* 分类工具内容 */}
        <CategoryBlock category={c} tools={all} />
      </div>
    );
  }

  // ── 场景二：全新综合首页（热门工具 + 我的收藏 + 概览） ──
  return (
    <div className="mx-auto max-w-none space-y-9 p-6 lg:p-8">
      {/* 1. 顶部品牌欢迎与状态 Banner */}
      <div
        className="relative overflow-hidden rounded-3xl border p-6 lg:p-7 shadow-xs"
        style={{
          background: colors.card,
          borderColor: colors.borderSolid,
        }}
      >
        <div
          className="pointer-events-none absolute -right-20 -top-20 h-60 w-60 rounded-full blur-3xl opacity-20"
          style={{ background: colors.gold }}
        />
        <div
          className="pointer-events-none absolute -left-20 -bottom-20 h-60 w-60 rounded-full blur-3xl opacity-15"
          style={{ background: "#0ea5e9" }}
        />

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div className="space-y-2">
            <div
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[11.5px] font-semibold"
              style={{ borderColor: `${colors.gold}40`, background: `${colors.gold}12`, color: colors.gold }}
            >
              <Sparkles size={13} />
              <span>{__ui("FurinaKit 芙宁娜工具箱 v2.1.0")}</span>
            </div>
            <h1 className="text-[23px] lg:text-[25px] font-extrabold tracking-tight" style={{ color: colors.text }}>
              {__ui("全能 · 纯净 · 高效的一站式轻量工具箱")}</h1>
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              {__ui("追求以轻量化的设计，满足日常95%的工具使用需求。")}</p>
          </div>

          {/* 右侧：上层一体化微透磨砂状态条 + 下层对齐快捷操作按钮 */}
          <div className="flex flex-col items-start md:items-end gap-3 shrink-0 self-start md:self-center">
            {/* 上层：三大特性保障承诺胶囊（独立三胶囊样式，带对应彩色图标与背景微光） */}
            <div className="flex items-center gap-2 flex-wrap select-none">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-3 py-1 text-[12px] font-medium text-emerald-600 dark:text-emerald-400 shadow-2xs">
                <UserCheck size={13} strokeWidth={2.2} />
                <span>{__ui("无需登录")}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-500/25 bg-sky-500/10 px-3 py-1 text-[12px] font-medium text-sky-600 dark:text-sky-400 shadow-2xs">
                <Shield size={13} strokeWidth={2.2} />
                <span>{__ui("纯净无广")}</span>
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/25 bg-amber-500/10 px-3 py-1 text-[12px] font-medium text-amber-600 dark:text-amber-400 shadow-2xs">
                <Lock size={13} strokeWidth={2.2} />
                <span>{__ui("本地私密")}</span>
              </span>
            </div>

            {/* 下层：支持作者 & Github开源 快捷交互胶囊（统一灰白毛玻璃高质感规格） */}
            <div className="flex items-center gap-2.5">
              {/* 支持作者 */}
              <button
                type="button"
                onClick={() => {
                  window.dispatchEvent(new CustomEvent("furina:open-settings", { detail: { section: "donate" } }));
                }}
                className="group inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-background/50 backdrop-blur-md px-3.5 py-1.5 text-[12px] font-medium text-foreground/85 transition-all hover:bg-card hover:text-foreground hover:border-border hover:scale-105 active:scale-95 cursor-pointer shadow-2xs"
                title={__ui("赞赏支持作者持续开发与维护")}
              >
                <Heart size={12.5} className="text-rose-500/80 group-hover:text-rose-500 group-hover:fill-rose-500 transition-all" />
                <span>{__ui("支持作者")}</span>
              </button>

              {/* Github开源 */}
              <button
                type="button"
                onClick={() => {
                  const url = "https://github.com/FUFU-eng/FurinaKit";
                  if (typeof window !== "undefined" && window.furinakit?.openExternal) {
                    window.furinakit.openExternal(url);
                  } else {
                    window.open(url, "_blank");
                  }
                }}
                className="group inline-flex items-center gap-1.5 rounded-full border border-border/80 bg-background/50 backdrop-blur-md px-3.5 py-1.5 text-[12px] font-medium text-foreground/85 transition-all hover:bg-card hover:text-foreground hover:border-border hover:scale-105 active:scale-95 cursor-pointer shadow-2xs"
                title={__ui("访问 GitHub 开源仓库")}
              >
                <Github size={12.5} className="text-foreground/75 group-hover:text-foreground transition-colors" />
                <span>{__ui("Github开源")}</span>
                <ExternalLink size={10.5} className="text-muted-foreground/60 group-hover:text-foreground transition-colors" />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 2. 🔥 热门工具板块 */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20">
              <Flame size={17} />
            </span>
            <div>
              <h2 className="text-[17px] font-bold tracking-tight" style={{ color: colors.text }}>
                {__ui("热门工具")}</h2>
            </div>
          </div>
        </div>

        {/* 热门工具应用图标栏（纯图标+名称，无卡片框，轻盈小巧，支持大量快捷启动） */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {hotTools.map((tool) => (
            <HotToolItem key={tool.id} tool={tool} />
          ))}
        </div>
      </section>

      {/* 3. ❤️ 我的收藏板块 */}
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-pink-500/10 text-pink-500 border border-pink-500/20">
              <Heart size={16} fill="currentColor" />
            </span>
            <div>
              <h2 className="text-[17px] font-bold tracking-tight" style={{ color: colors.text }}>
                {__ui("我的收藏")}</h2>
            </div>
          </div>
        </div>

        {favoriteTools.length > 0 ? (
          <SortableToolGrid tools={favoriteTools} storageKey="home:favorites" />
        ) : (
          /* 空状态展示：全面重构美化，告别原细长条与突兀感 */
          <div
            className="rounded-2xl border border-dashed p-8 text-center transition-all shadow-xs"
            style={{ background: colors.card, borderColor: colors.borderSolid }}
          >
            <div
              className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border mb-3 transition-transform hover:scale-105"
              style={{
                background: "#ec489915",
                color: "#ec4899",
                borderColor: "#ec489930",
              }}
            >
              <Heart size={22} strokeWidth={2} />
            </div>
            <h3 className="text-[14.5px] font-bold" style={{ color: colors.text }}>
              {__ui("暂无常用收藏")}</h3>
            <p className="mx-auto mt-1 max-w-md text-[12px] leading-relaxed text-muted-foreground">
              {__ui("轻点卡片右上角爱心即可固定于此，支持长按自由拖拽排序")}</p>
          </div>
        )}
      </section>

      {/* 4. ⚡ 分类快速直达面板 */}
      <section className="space-y-4 pt-2">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-purple-500/10 text-purple-400 border border-purple-500/20">
              <Compass size={16} />
            </span>
            <div>
              <h2 className="text-[17px] font-bold tracking-tight" style={{ color: colors.text }}>
                {__ui("功能探索")}</h2>
            </div>
          </div>

          {/* 没找到想要的工具？反馈建议入口 */}
          <div
            className="flex items-center gap-2.5 rounded-xl border px-3 py-1.5 self-start sm:self-auto"
            style={{ borderColor: colors.borderSolid, background: colors.card }}
          >
            <span className="text-[12px] text-muted-foreground">
              {__ui("没找到你想要的工具？告诉芙芙，下次更新就有啦！")}</span>
            <button
              type="button"
              onClick={() => setFeedbackOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-500/30 bg-sky-500/10 px-2.5 py-1 text-[11.5px] font-semibold text-sky-400 transition-all hover:bg-sky-500/20 hover:scale-105 active:scale-95 cursor-pointer shrink-0"
            >
              <MessageSquareHeart size={13} />
              <span>{__ui("反馈建议")}</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {toolCategories.map((cat) => {
            const Icon = categoryIcon[cat];
            const accent = CATEGORY_COLOR[cat] ?? "#0ea5e9";
            const count = all.filter((t) => t.category === cat).length;
            return (
              <Link
                key={cat}
                href={`/?c=${cat}`}
                className="group flex flex-col justify-between rounded-xl border p-3.5 transition-all duration-200 hover:-translate-y-0.5 hover:shadow-sm"
                style={{ background: colors.card, borderColor: colors.borderSolid }}
              >
                <div className="flex items-center justify-between">
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-xl border"
                    style={{ background: `${accent}15`, color: accent, borderColor: `${accent}30` }}
                  >
                    <Icon size={18} strokeWidth={2} />
                  </div>
                  <span
                    className="rounded-full px-2 py-0.5 text-[10.5px] font-bold font-mono"
                    style={{ background: colors.bg, color: colors.muted }}
                  >
                    {count}
                  </span>
                </div>
                <div className="mt-2.5 flex items-center justify-between">
                  <span
                    className="text-[13px] font-bold transition-colors group-hover:text-sky-400"
                    style={{ color: colors.text }}
                  >
                    {__ui(CATEGORY_LABELS[cat])}
                  </span>
                  <ChevronRight
                    size={13}
                    className="text-muted-foreground/60 group-hover:text-sky-400 group-hover:translate-x-0.5 transition-all"
                  />
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* 意见与心愿反馈模态框 */}
      <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </div>
  );
}

export default function HomePage() {
  const __locale = __useLanguage();
  return (
    <Suspense fallback={null}>
      <HomeInner />
    </Suspense>
  );
}
