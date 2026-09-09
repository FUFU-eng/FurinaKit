"use client";

import { useMemo } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Star, Clock, X } from "lucide-react";
import { getAvailableTools } from "@furinakit/shared";
import type { OmniTool } from "@furinakit/shared";
import { getToolIcon } from "@/lib/tool-icons";
import { useFavorites, useRecentTools } from "@/lib/use-tool-prefs";
import { cn } from "@/lib/utils";

const catText: Record<string, string> = {
  image: "text-sky-400",
  pdf: "text-rose-400",
  download: "text-emerald-400",
  audio: "text-fuchsia-400",
  utility: "text-primary",
};

function Chip({ tool, index }: { tool: OmniTool; index: number }) {
  const Icon = getToolIcon(tool.icon);
  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.92 }}
      transition={{ duration: 0.22, delay: Math.min(index * 0.03, 0.2) }}
    >
      <Link
        href={`/tools/${tool.id}`}
        prefetch={false}
        className="group/chip flex items-center gap-2 whitespace-nowrap rounded-full border border-border bg-card px-3 py-1.5 text-[13px] text-muted-foreground transition-all hover:-translate-y-0.5 hover:border-border/80 hover:bg-secondary/60 hover:text-foreground"
      >
        <Icon className={cn("h-3.5 w-3.5 shrink-0", catText[tool.category])} strokeWidth={1.8} />
        {tool.name}
      </Link>
    </motion.div>
  );
}

export function QuickAccess() {
  const available = useMemo(() => getAvailableTools().filter((t) => !t.comingSoon), []);
  const byId = useMemo(() => new Map(available.map((t) => [t.id, t])), [available]);

  const { favorites } = useFavorites();
  const { recent, clearRecent } = useRecentTools();

  const favTools = favorites.map((id) => byId.get(id)).filter(Boolean) as OmniTool[];
  const recentTools = recent
    .map((id) => byId.get(id))
    .filter((t): t is OmniTool => Boolean(t) && !favorites.includes((t as OmniTool).id))
    .slice(0, 6);

  if (favTools.length === 0 && recentTools.length === 0) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
      className="space-y-4 rounded-xl border border-border bg-card/40 p-5"
    >
      {favTools.length > 0 && (
        <div>
          <div className="mb-2.5 flex items-center gap-2">
            <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
            <h3 className="font-mono-accent text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">
              Pinned
            </h3>
          </div>
          <div className="thin-scroll flex flex-wrap gap-2">
            <AnimatePresence mode="popLayout">
              {favTools.map((tool, i) => (
                <Chip key={tool.id} tool={tool} index={i} />
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}

      {recentTools.length > 0 && (
        <div className={cn(favTools.length > 0 && "border-t border-border/50 pt-4")}>
          <div className="mb-2.5 flex items-center gap-2">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <h3 className="font-mono-accent text-[11px] font-semibold uppercase tracking-[0.16em] text-foreground">
              Recently used
            </h3>
            <button
              onClick={() => clearRecent()}
              className="ml-auto flex items-center gap-1 font-mono-accent text-[10px] uppercase tracking-widest text-muted-foreground/60 transition-colors hover:text-foreground"
            >
              <X className="h-3 w-3" /> Clear
            </button>
          </div>
          <div className="thin-scroll flex flex-wrap gap-2">
            <AnimatePresence mode="popLayout">
              {recentTools.map((tool, i) => (
                <Chip key={tool.id} tool={tool} index={i} />
              ))}
            </AnimatePresence>
          </div>
        </div>
      )}
    </motion.div>
  );
}
