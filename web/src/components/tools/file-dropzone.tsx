
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/file-dropzone.tsx");
import {pickDirectFolder} from "@/lib/folder-import";
import { resolveFileImport, sameFileSelection, type ImportRejection } from "@/lib/file-import-selection";
import { recommendFiles } from "@/lib/file-recommendations";
"use client";

import { useCallback, useEffect, useState, useRef } from "react";
import { InputAudioPreview } from "./audio-preview";
import { useDropzone } from "react-dropzone";
import { Upload, X, FileText, Plus, RefreshCw } from "lucide-react";
import { cn, formatBytes } from "@/lib/utils";

type FileDropzoneProps = {
  files: File[];
  onChange: (files: File[]) => void;
  multiple?: boolean;
  accept?: Record<string, string[]>;
  maxFiles?: number;
  previewAudio?: boolean;
};

function FilePreview({ file }: { file: File }) {
  const __locale = __useLanguage();
  const [preview, setPreview] = useState<{ file: File; url: string } | null>(null);
  const [failedFile, setFailedFile] = useState<File | null>(null);

  useEffect(() => {
    setPreview(null);
    setFailedFile(null);
    if (!file.type.startsWith("image/")) return;
    const objectUrl = URL.createObjectURL(file);
    setPreview({ file, url: objectUrl });
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  if (preview?.file === file && failedFile !== file) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={preview.url} alt={file.name} onError={() => setFailedFile(file)} className="h-10 w-10 rounded-md object-cover border border-border" />;
  }
  return (
    <div className="flex h-10 w-10 items-center justify-center rounded-md border border-border bg-secondary text-muted-foreground">
      <FileText className="h-4 w-4" />
    </div>
  );
}

export function FileDropzone({
  files,
  onChange,
  multiple = false,
  accept,
  maxFiles,
  previewAudio = true,
}: FileDropzoneProps) {
  const __locale = __useLanguage();
  const hostRef = useRef<HTMLDivElement>(null);
  const [feedback, setFeedback] = useState<{ selection: File[]; message: string } | null>(null);
  // External handoff can change the selected File objects without a drop event.
  // Never display an old rejection against the newly accepted selection.
  const rejection = feedback && sameFileSelection(feedback.selection, files) ? feedback.message : null;
  const reportError = useCallback((message: string) => setFeedback({ selection: files, message }), [files]);
  const importFiles = useCallback(
    (incoming: File[], replace = false, rejected: ImportRejection[] = []) => {
      if (!incoming.length) return; // Cancelling the file chooser is not a replacement.
      const result = resolveFileImport(files, incoming, { multiple, maxFiles, accept, replace }, rejected);
      setFeedback(result.message ? { selection: result.files, message: result.message } : null);
      if (result.wrongType.length && !hostRef.current?.closest('[role="dialog"]')) {
        recommendFiles(result.wrongType, true);
      }
      if (result.changed) onChange(result.files);
    },
    [files, multiple, maxFiles, accept, onChange],
  );
  useEffect(() => {
    const input = hostRef.current?.querySelector('input');
    const replace = (event: Event) => {
      event.preventDefault();
      const incoming = (event as CustomEvent<File[]>).detail;
      if (Array.isArray(incoming)) importFiles(incoming, true);
    };
    input?.addEventListener('furinakit:replace-input', replace);
    return () => input?.removeEventListener('furinakit:replace-input', replace);
  }, [importFiles]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    // One outcome handles accepted and rejected files together. Separate callbacks
    // used to overwrite a successful import with a misleading all-files-rejected error.
    onDrop: (accepted, rejected) => importFiles([...accepted, ...rejected.map(item => item.file)], false, rejected),
    onError: (error) => reportError(`文件读取失败，请重新选择：${error.message}`),
    multiple,
    accept,
    ...(maxFiles ? { maxFiles } : {}),
  });

  const removeFile = (index: number) => {
    setFeedback(null);
    onChange(files.filter((_, i) => i !== index));
  };

  // 空态：一个货真价实的"投放区"。高度刻意压着（≈125px，和上一版 129px 基本持平，
  // 绝不回到 180px 那种大框），靠**视觉重量**而不是尺寸来显眼 ——
  // 品牌色实底图标块 + 品牌色实线填充 + 明确的品牌色虚线边框。
  // 已选文件：不再是一条飘着灰字的横条，而是一条"能点、能拖、能换"的入口条：
  // 左侧品牌色图标块（单文件=更换／多文件=添加），中间主副两行文案，右侧一枚"更换/添加"胶囊。
  const hasFiles = files.length > 0;

  return (
    <div ref={hostRef} className="space-y-3" data-furinakit-dropzone>
      {multiple&&<button type="button" className="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-xs font-medium text-primary hover:bg-primary/10" onClick={()=>void pickDirectFolder().then(list=>{if(list.length)importFiles(list);}).catch(e=>reportError(String(e)))}>{__ui("导入文件夹")}<span className="font-normal text-muted-foreground">{__ui("· 仅第一层文件")}</span></button>}
      <div
        {...getRootProps()}
        data-furinakit-dropzone-state={hasFiles ? "filled" : "empty"}
        className={cn(
          "group flex w-full cursor-pointer transition-all duration-200",
          hasFiles
            ? "min-h-[4rem] items-center gap-3 rounded-xl border border-primary/30 bg-primary/[0.07] px-3.5 py-2.5 text-left shadow-xs"
            : "flex-col items-center justify-center rounded-2xl border-2 border-dashed border-primary/35 bg-primary/[0.06] px-5 py-4 text-center shadow-xs",
          isDragActive
            ? "border-primary bg-primary/15 ring-4 ring-primary/20"
            : "hover:border-primary/60 hover:bg-primary/10",
        )}
      >
        <input {...getInputProps()} data-max-files={maxFiles} />
        {hasFiles ? (
          <>
            <span
              className={cn(
                "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground transition-transform duration-200",
                "shadow-[0_1px_0_0_hsl(0_0%_100%/0.18)_inset,0_6px_16px_-10px_hsl(var(--primary)/0.8)]",
                isDragActive ? "scale-105" : "group-hover:scale-105",
              )}
            >
              {isDragActive ? (
                <Upload className="h-4 w-4" />
              ) : multiple ? (
                <Plus className="h-4 w-4" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </span>

            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-foreground">
                {isDragActive ? __ui("松开即可载入文件") : multiple ? __ui("继续添加文件") : __ui("替换当前文件")}
              </p>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {isDragActive
                  ? multiple
                    ? __ui("新文件会追加到下面的列表")
                    : __ui("新文件会替换掉下面的列表")
                  : __ui("把文件拖到这里，或点击此条选择")}
              </p>
            </div>

            <span className="hidden shrink-0 items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary sm:inline-flex">
              {isDragActive ? __ui("松开") : multiple ? __ui("添加") : __ui("更换")}
            </span>
          </>
        ) : (
          <>
            <span
              className={cn(
                "mb-2.5 flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-transform duration-200",
                "shadow-[0_1px_0_0_hsl(0_0%_100%/0.18)_inset,0_8px_20px_-12px_hsl(var(--primary)/0.85)]",
                isDragActive ? "-translate-y-0.5 scale-105" : "group-hover:-translate-y-0.5 group-hover:scale-105",
              )}
            >
              <Upload className="h-5 w-5" />
            </span>
            <p className="text-sm font-semibold text-foreground">
              {isDragActive ? __ui("松开即可载入文件") : __ui("点击选择文件，或将文件拖拽到此处")}
            </p>
            <p className="mt-1.5 font-mono-accent text-[10px] uppercase tracking-widest text-primary/80">
              {multiple ? (maxFiles ? __msg("最多 {0} 个文件", maxFiles) : __ui("支持批量导入，无文件数量限制")) : __ui("单个文件")}
            </p>
          </>
        )}
      </div>

      {rejection && <p role="alert" className="text-xs text-destructive">{rejection}</p>}
      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-3 py-2 text-sm animate-fade-in-up"
            >
              <FilePreview file={file} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{file.name}</p>
                <p className="font-mono-accent text-[10px] uppercase tracking-widest text-muted-foreground">
                  {__msg(formatBytes(file.size))}
                </p>
              </div>
              <button
                type="button"
                onClick={() => removeFile(index)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive"
                aria-label={__ui("移除文件")}
              >
                <X className="h-4 w-4" />
              </button>
              {previewAudio && <InputAudioPreview file={file} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
