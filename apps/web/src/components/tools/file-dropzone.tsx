"use client";

import { useCallback, useEffect, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, X, FileText } from "lucide-react";
import { cn, formatBytes } from "@/lib/utils";

type FileDropzoneProps = {
  files: File[];
  onChange: (files: File[]) => void;
  multiple?: boolean;
  accept?: Record<string, string[]>;
  maxFiles?: number;
};

function FilePreview({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file.type.startsWith("image/")) return;
    const objectUrl = URL.createObjectURL(file);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  if (url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={url} alt={file.name} className="h-10 w-10 rounded-md object-cover border border-border" />;
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
}: FileDropzoneProps) {
  const onDrop = useCallback(
    (accepted: File[]) => {
      if (multiple) {
        onChange(maxFiles ? [...files, ...accepted].slice(0, maxFiles) : [...files, ...accepted]);
      } else {
        onChange(accepted.slice(0, 1));
      }
    },
    [files, maxFiles, multiple, onChange],
  );

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    multiple,
    accept,
    ...(maxFiles ? { maxFiles } : {}),
  });

  const removeFile = (index: number) => onChange(files.filter((_, i) => i !== index));

  return (
    <div className="space-y-3" data-furinakit-dropzone>
      <div
        {...getRootProps()}
        className={cn(
          "group flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-border bg-secondary/20 px-6 py-10 text-center transition-all duration-200",
          isDragActive
            ? "border-primary bg-primary/10 ring-4 ring-primary/15"
            : "hover:border-primary/50 hover:bg-secondary/40",
        )}
      >
        <input {...getInputProps()} />
        <span
          className={cn(
            "mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-border bg-card transition-all duration-200 group-hover:-translate-y-0.5 group-hover:border-primary/40",
            isDragActive && "-translate-y-0.5 border-primary/50",
          )}
        >
          <Upload
            className={cn(
              "h-5 w-5 text-muted-foreground transition-colors group-hover:text-primary",
              isDragActive && "text-primary",
            )}
          />
        </span>
        <p className="text-sm font-medium">
          {isDragActive ? "松开即可载入文件" : "点击选择文件，或将文件拖拽到此处"}
        </p>
        <p className="mt-1 font-mono-accent text-[10px] uppercase tracking-widest text-muted-foreground">
          {multiple ? (maxFiles ? `最多 ${maxFiles} 个文件` : "支持批量导入，无文件数量限制") : "单个文件"}
        </p>
      </div>

      {files.length > 0 && (
        <ul className="space-y-2">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="flex items-center gap-3 rounded-md border border-border bg-card px-3 py-2 text-sm animate-fade-in-up"
            >
              <FilePreview file={file} />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">{file.name}</p>
                <p className="font-mono-accent text-[10px] uppercase tracking-widest text-muted-foreground">
                  {formatBytes(file.size)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => removeFile(index)}
                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-destructive"
                aria-label="移除文件"
              >
                <X className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
