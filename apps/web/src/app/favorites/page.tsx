"use client";

import { useMemo } from "react";
import Link from "next/link";
import { getAvailableTools, type ToolCategory, type OmniTool } from "@furinakit/shared";
import { useFavorites } from "@/lib/use-tool-prefs";
import { useTheme } from "@/components/theme-provider";
import { useGridCols } from "@/lib/use-window-cols";
import { getToolIcon } from "@/lib/tool-icons";
import { Heart, ArrowLeft } from "lucide-react";

const categoryColors: Record<ToolCategory, string> = {
  image: "#0ea5e9",
  download: "#f59e0b",
  audio: "#a855f7",
  pdf: "#10b981",
  text: "#14b8a6",
  mathcalc: "#7c3aed",
  dev: "#3b82f6",
  security: "#ef4444",
  utility: "#f97316",
};

export default function FavoritesPage() {
  const { colors } = useTheme();
  const { favorites, toggleFavorite } = useFavorites();
  const tools = useMemo(() => getAvailableTools(), []);
  const cols = useGridCols();

  const favoriteTools = useMemo(
    () => tools.filter((t) => favorites.includes(t.id)),
    [tools, favorites]
  );

  return (
    <div className="p-6">
      {/* 标题 */}
      <div className="mb-6 flex items-center gap-4">
        <Link
          href="/"
          className="flex h-10 w-10 items-center justify-center rounded-xl border transition-all hover:bg-white/5"
          style={{ borderColor: colors.borderSolid, color: colors.muted }}
        >
          <ArrowLeft size={20} />
        </Link>
        <div>
          <h1 className="text-2xl font-bold" style={{ color: colors.text }}>
            我的收藏
          </h1>
          <p className="mt-1 text-sm" style={{ color: colors.muted }}>
            共 {favoriteTools.length} 个收藏的工具
          </p>
        </div>
      </div>

      {/* 工具网格：列数跟随窗口最大化状态自适应（3/4 列） */}
      {favoriteTools.length > 0 ? (
        <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {favoriteTools.map((tool) => {
            const Icon = getToolIcon(tool.icon);
            const color = categoryColors[tool.category as ToolCategory];
            return (
              <div key={tool.id} className="group relative">
                <Link href={`/tools/${tool.id}`} className="block h-full">
                  <div
                    className="flex h-full min-h-[140px] flex-col rounded-xl border p-5 transition-all duration-200 hover:border-opacity-50"
                    style={{
                      backgroundColor: colors.panel,
                      borderColor: colors.borderSolid,
                    }}
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg"
                        style={{
                          backgroundColor: `${color}15`,
                          color: color,
                          border: `1px solid ${color}30`,
                        }}
                      >
                        <Icon size={18} />
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="truncate text-base font-semibold" style={{ color: colors.text }}>
                          {tool.name}
                        </h3>
                        <p className="mt-1 line-clamp-2 text-xs leading-relaxed" style={{ color: colors.muted }}>
                          {tool.description}
                        </p>
                      </div>
                    </div>
                  </div>
                </Link>

                {/* 收藏按钮 */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggleFavorite(tool.id);
                  }}
                  className="absolute bottom-3 right-3 z-10 flex h-7 w-7 items-center justify-center rounded-lg transition-all hover:bg-white/10"
                  style={{ color: "#f472b6" }}
                  aria-label="取消收藏"
                >
                  <Heart size={16} className="fill-current" />
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <div
          className="flex flex-col items-center justify-center rounded-xl border py-20"
          style={{ borderColor: colors.borderSolid, backgroundColor: colors.panel }}
        >
          <Heart size={48} style={{ color: colors.muted }} className="mb-4" />
          <p className="text-lg font-medium" style={{ color: colors.text }}>
            还没有收藏的工具
          </p>
          <p className="mt-2 text-sm" style={{ color: colors.muted }}>
            点击工具卡片上的爱心图标即可收藏
          </p>
          <Link
            href="/"
            className="mt-6 rounded-xl px-6 py-3 text-sm font-medium transition-all hover:opacity-90"
            style={{ backgroundColor: "hsl(var(--primary))", color: "hsl(var(--primary-foreground))" }}
          >
            去发现工具
          </Link>
        </div>
      )}
    </div>
  );
}
