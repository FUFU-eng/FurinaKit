"use client";
import { createUiText as __createUiText, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/dropzone-empty.tsx");


/**
 * 统一的「请选择文件」空状态。
 *
 * 全站只有这一个样式来源：
 *  · 通用表单（FileDropzone 的空状态）与所有自定义界面（PDF 裁剪、图片色彩替换、配色提取等）都用它；
 *  · 想调整上传区的样子，只改这一个文件，不会再出现「有的工具是这套、有的是那套」。
 */

import { useCallback, useRef, useState } from "react";
import { ImageUp, RefreshCw, Upload } from "lucide-react";
import { cn } from "@/lib/utils";

export function EmptyDropzone({
  title,
  subtitle,
  hint,
  accept,
  multiple = false,
  onFiles,
  className,
}: {
  /** 主标题，例如「点击选择文件，或将文件拖拽到此处」 */
  title?: string;
  /** 副标题，说明支持哪些格式 */
  subtitle?: string;
  /** 右上角/底部的补充说明，例如「单个文件」 */
  hint?: string;
  accept?: string;
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  className?: string;
}) {
  const __locale = __useLanguage();
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handle = useCallback(
    (list: FileList | null) => {
      if (!list || list.length === 0) return;
      const files = Array.from(list);
      onFiles(multiple ? files : files.slice(0, 1));
    },
    [multiple, onFiles],
  );

  return (
    <div className={cn("space-y-3", className)}>
      <div
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          handle(e.dataTransfer.files);
        }}
        className={cn(
          "group flex w-full cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-primary/40 bg-primary/[0.04] px-6 py-10 transition-all duration-200",
          dragging ? "border-primary bg-primary/15 ring-4 ring-primary/20" : "hover:border-primary/60 hover:bg-primary/10",
        )}
      >
        <input ref={inputRef} type="file" accept={accept} multiple={multiple} className="hidden" onChange={(e) => handle(e.target.files)} />
        <span
          className={cn(
            "mb-2.5 flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-[0_1px_0_0_hsl(0_0%_100%/0.18)_inset,0_8px_20px_-12px_hsl(var(--primary)/0.8)] transition-transform",
            dragging ? "-translate-y-0.5 scale-105" : "group-hover:-translate-y-0.5 group-hover:scale-105",
          )}
        >
          {dragging ? <Upload className="h-5 w-5" /> : multiple ? <ImageUp className="h-5 w-5" /> : <RefreshCw className="h-5 w-5" />}
        </span>
        <p className="text-[13.5px] font-semibold text-foreground">
          {dragging ? __ui("松开即可载入文件") : (__ui(title) ?? (multiple ? __ui("点击选择文件，或将文件拖拽到此处") : __ui("点击选择文件，或将文件拖拽到此处")))}
        </p>
        {subtitle && <p className="mt-1 text-[11.5px] text-muted-foreground">{dragging ? __ui("文件只在本机处理") : __ui(subtitle)}</p>}
        <p className="mt-1.5 text-[11px] text-muted-foreground/80">{__ui(hint) ?? (multiple ? __ui("可一次选择多个文件") : __ui("单个文件"))}</p>
      </div>
    </div>
  );
}
