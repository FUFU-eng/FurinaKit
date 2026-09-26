"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/global-drop.tsx");

import {useEscapeDismiss} from "@/lib/use-escape-dismiss";
import { recommendationsFor, recommendationCategory } from "@/lib/file-recommendations";
import { fromFiles } from "@/lib/pending-file-model";
import { usePendingFiles } from "@/lib/pending-files-context";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { UploadCloud, X, ArrowRight } from "lucide-react";
import { getAvailableTools, type OmniTool } from "@furinakit/shared";
import { getToolIcon } from "@/lib/tool-icons";
import { setPendingFiles } from "@/lib/file-handoff";
import { CATEGORY_COLOR } from "@/components/tools/tool-card";
import { formatBytes } from "@/lib/utils";

export function GlobalDrop() {
  const __locale = __useLanguage();
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dropped, setDropped] = useState<File[] | null>(null);
  const [unsupported, setUnsupported] = useState(false);
  const pending = usePendingFiles();
  useEscapeDismiss(()=>{setDropped(null);setDragging(false);},!!dropped||dragging,110);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    const receive = (e:Event) => {const d=(e as CustomEvent).detail;if(d?.files?.length){setDropped(d.files);setUnsupported(Boolean(d.unsupported));setDragging(false);}};
    window.addEventListener("furinakit:recommend-files",receive);
    return ()=>{window.removeEventListener("furinakit:recommend-files",receive);};
  }, []);

  const choose = useCallback(
    (tool: OmniTool) => {
      if (dropped) { pending.clearPendingFiles(); setPendingFiles(tool.inputs.some((i) => i.type === "file" && i.multiple) ? dropped : dropped.slice(0, 1)); }
      setDropped(null);
      window.dispatchEvent(new Event("furina:close-settings"));
      router.push(`/tools/${tool.id}`);
    },
    [dropped, router, pending],
  );

  if (!mounted) return null;

  const file = dropped?.[0];
  const picks = recommendationsFor(file);

  return createPortal(
    <AnimatePresence>
      {(dragging || dropped) && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[80] flex items-center justify-center p-6"
        >
          <div className="absolute inset-0 bg-background/70 backdrop-blur-sm" onClick={() => setDropped(null)} />

          {dragging && !dropped && (
            <motion.div
              initial={{ scale: 0.96, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              className="relative flex w-full max-w-lg flex-col items-center gap-4 rounded-2xl border-2 border-dashed border-primary/60 bg-card/80 px-10 py-16 text-center"
            >
              <motion.span
                animate={{ y: [0, -8, 0] }}
                transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                className="flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/15 text-primary"
              >
                <UploadCloud className="h-8 w-8" />
              </motion.span>
              <div>
                <p className="text-lg font-semibold text-foreground">{__ui("松开即可载入文件")}</p>
                <p className="mt-1 text-sm text-muted-foreground">{__ui("会为你推荐合适的处理工具")}</p>
              </div>
            </motion.div>
          )}

          {dropped && (
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 12 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 26 }}
              role="dialog" aria-modal="true" aria-label={__ui("文件工具推荐")} className="relative w-full max-w-xl rounded-2xl border border-border bg-card p-6 shadow-2xl"
            >
              <button
                onClick={() => setDropped(null)}
                className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                aria-label={__ui("关闭")}
              >
                <X className="h-4 w-4" />
              </button>

              <p className="text-[11px] font-medium text-primary">{__ui("已载入文件")}</p>
              <p className="mt-1 truncate pr-8 text-base font-semibold text-foreground">{file?.name}</p>
              <p className="text-[12px] text-muted-foreground">
                {file ? `${file.type || "未知类型"} · ${formatBytes(file.size)}` : ""}
                {dropped.length > 1 ? __msg(" · 共 {0} 个文件", dropped.length) : ""}
              </p>

              {picks.length > 0 ? (
                <>
                  <p className="mb-2 mt-5 text-[11px] font-medium text-muted-foreground">{unsupported ? __ui("当前工具不支持该文件类型，已为您推荐以下工具") : __ui("根据当前文件类型，为您推荐下列工具")}</p>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {picks.map((tool, i) => {
                      const Icon = getToolIcon(tool.icon);
                      const accent = CATEGORY_COLOR[tool.category] ?? "#0ea5e9";
                      return (
                        <motion.button
                          key={tool.id}
                          initial={{ opacity: 0, y: 8 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: 0.03 * i }}
                          onClick={() => choose(tool)}
                          className="group flex items-center gap-3 rounded-xl border border-border bg-secondary/30 px-3 py-2.5 text-left transition-all hover:border-primary/50 hover:bg-secondary/60"
                        >
                          <span
                            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                            style={{ color: accent, background: `${accent}18` }}
                          >
                            <Icon className="h-4 w-4" />
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-medium text-foreground">{tool.name}</span>
                          </span>
                          <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground transition-all group-hover:translate-x-0.5" />
                        </motion.button>
                      );
                    })}
                    <button onClick={()=>{if(!file||!dropped)return;pending.setPendingFiles(fromFiles(dropped));setDropped(null);window.dispatchEvent(new Event("furina:close-settings"));router.push(`/?c=${recommendationCategory(file)}`);}} className="group flex items-center gap-3 rounded-xl border border-dashed border-primary/30 bg-primary/5 px-3 py-2.5 text-left hover:bg-primary/10">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 text-primary"><ArrowRight className="h-4 w-4"/></span>
                      <span className="text-sm font-medium">{__ui("更多工具")}<span className="block text-[11px] font-normal text-muted-foreground">{__ui("前往相关分类")}</span></span>
                    </button>
                  </div>
                </>
              ) : (
                <p className="mt-5 text-sm text-muted-foreground">
                  {__ui("没有匹配该文件类型的工具，目前支持图片、PDF、音频与视频的快捷推荐。")}</p>
              )}
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
