"use client";

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

// 按拖入文件类型推荐工具（id 均为 tools.ts 中真实存在的工具）
const IMAGE_PICKS = [
  "image-format-convert", "image-compress", "image-resize", "image-crop",
  "bg-remove", "image-rotate", "images-to-pdf", "image-watermark",
];
const PDF_PICKS = [
  "pdf-merge", "pdf-split", "pdf-compress", "pdf-to-images",
  "pdf-rotate", "pdf-watermark", "pdf-extract-images",
];
const AUDIO_PICKS = [
  "audio-format-convert", "audio-volume", "audio-merge", "audio-reverse",
];
const VIDEO_PICKS = [
  "video-format-convert", "video-compress", "video-to-audio", "video-to-gif",
];

function suggestionsFor(file: File | undefined): OmniTool[] {
  if (!file) return [];
  const available = getAvailableTools();
  const byId = new Map(available.map((t) => [t.id, t]));
  const isPdf = file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
  const isAudio = file.type.startsWith("audio/") || /\.(mp3|wav|flac|aac|ogg|m4a|wma|opus)$/i.test(file.name);
  const isVideo = file.type.startsWith("video/") || /\.(mp4|mov|mkv|avi|webm|flv|wmv|m4v)$/i.test(file.name);

  let ids: string[] = [];
  if (file.type.startsWith("image/") || /\.(jpg|jpeg|png|webp|gif|bmp|tiff|avif|ico)$/i.test(file.name)) {
    ids = IMAGE_PICKS;
  } else if (isPdf) {
    ids = PDF_PICKS;
  } else if (isAudio) {
    ids = AUDIO_PICKS;
  } else if (isVideo) {
    ids = VIDEO_PICKS;
  }
  return ids.map((id) => byId.get(id)).filter((t): t is OmniTool => Boolean(t)).slice(0, 6);
}

export function GlobalDrop() {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [dropped, setDropped] = useState<File[] | null>(null);
  const depth = useRef(0);

  useEffect(() => setMounted(true), []);

  const pageHasDropzone = () => {
    if (typeof window === "undefined") return false;
    // 如果已经在具体工具页面中，不截获拖拽，完全留给当前工具处理
    if (window.location.pathname.startsWith("/tools/")) return true;
    return !!document.querySelector("[data-furinakit-dropzone]");
  };

  const hasFiles = (e: DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e) || pageHasDropzone()) return;
      e.preventDefault();
      depth.current += 1;
      setDragging(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e) || pageHasDropzone()) return;
      e.preventDefault();
    };
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      depth.current = 0;
      setDragging(false);
      if (pageHasDropzone()) return;
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (files.length === 0) return;
      e.preventDefault();
      setDropped(files);
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, []);

  const choose = useCallback(
    (tool: OmniTool) => {
      if (dropped) setPendingFiles(tool.inputs.some((i) => i.type === "file" && i.multiple) ? dropped : dropped.slice(0, 1));
      setDropped(null);
      router.push(`/tools/${tool.id}`);
    },
    [dropped, router],
  );

  if (!mounted) return null;

  const file = dropped?.[0];
  const picks = suggestionsFor(file);

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
                <p className="text-lg font-semibold text-foreground">松开即可载入文件</p>
                <p className="mt-1 text-sm text-muted-foreground">会为你推荐合适的处理工具</p>
              </div>
            </motion.div>
          )}

          {dropped && (
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 12 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ type: "spring", stiffness: 320, damping: 26 }}
              className="relative w-full max-w-lg rounded-2xl border border-border bg-card p-6 shadow-2xl"
            >
              <button
                onClick={() => setDropped(null)}
                className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                aria-label="关闭"
              >
                <X className="h-4 w-4" />
              </button>

              <p className="text-[11px] font-medium text-primary">已载入文件</p>
              <p className="mt-1 truncate pr-8 text-base font-semibold text-foreground">{file?.name}</p>
              <p className="text-[12px] text-muted-foreground">
                {file ? `${file.type || "未知类型"} · ${formatBytes(file.size)}` : ""}
                {dropped.length > 1 ? ` · 共 ${dropped.length} 个文件` : ""}
              </p>

              {picks.length > 0 ? (
                <>
                  <p className="mb-2 mt-5 text-[11px] font-medium text-muted-foreground">选择一个工具打开</p>
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
                  </div>
                </>
              ) : (
                <p className="mt-5 text-sm text-muted-foreground">
                  没有匹配该文件类型的工具，目前支持图片、PDF、音频与视频的快捷推荐。
                </p>
              )}
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
