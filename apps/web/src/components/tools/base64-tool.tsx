"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, AlertTriangle } from "lucide-react";
import { Button, Label, Textarea } from "@/components/ui/primitives";
import { CopyButton } from "@/components/tools/copy-button";
import { cn } from "@/lib/utils";

type Mode = "encode" | "decode";

/**
 * 工具级缓存：切到别的工具或回首页会让本组件卸载，用户粘贴的原文与编码结果就没了。
 * 这里把它们固定在模块作用域里：组件挂载时用它初始化 useState，之后每次变化写回，
 * 只有用户自己修改 / 点击清空时才会被覆盖。
 * 与项目里已有的 fileHideCache / imagesToPdfCache / toolDraftCache 保持一致的模块缓存方案：
 * 不做序列化、不受存储配额限制。整页刷新（F5）会丢失，这一点也和上面几个缓存相同。
 */
type Base64Cache = { input: string; mode: Mode };

const base64Cache: Base64Cache = { input: "", mode: "encode" };

// Unicode-safe Base64 (handles emoji / non-Latin).
function encodeB64(str: string): string {
  const bytes = new TextEncoder().encode(str);
  let binary = "";
  bytes.forEach((b) => (binary += String.fromCharCode(b)));
  return btoa(binary);
}

function decodeB64(b64: string): string {
  const binary = atob(b64.trim());
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function Base64Tool() {
  const [input, setInput] = useState(base64Cache.input);
  const [mode, setMode] = useState<Mode>(base64Cache.mode);

  // 输入 / 模式一变就写回缓存，保证离开工具时缓存里是最新的一份
  useEffect(() => {
    base64Cache.input = input;
    base64Cache.mode = mode;
  }, [input, mode]);

  const { output, error } = useMemo(() => {
    if (!input) return { output: "", error: null as string | null };
    try {
      return { output: mode === "encode" ? encodeB64(input) : decodeB64(input), error: null };
    } catch {
      return { output: "", error: "这不是有效的 Base64。" };
    }
  }, [input, mode]);

  return (
    <div className="space-y-5">
      <div className="inline-flex rounded-md border border-border bg-secondary/40 p-1">
        {(["encode", "decode"] as Mode[]).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={cn(
              "rounded px-4 py-1.5 text-xs font-medium capitalize transition-all",
              mode === m
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {m === "encode" ? "编码" : "解码"}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>{mode === "encode" ? "原文内容" : "Base64 密文"}</Label>
          <div className="flex items-center gap-2">
            <span className="font-mono-accent text-[11px] text-muted-foreground">
              {input.length} 字符
            </span>
            {input && (
              <button
                type="button"
                onClick={() => setInput("")}
                className="text-[11px] text-muted-foreground hover:text-destructive transition-colors"
              >
                清空
              </button>
            )}
          </div>
        </div>
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={mode === "encode" ? "Hello, FurinaKit! 🚀" : "SGVsbG8sIEZ1cmluYUtpdCEg8J+agA=="}
          className="min-h-[200px] md:min-h-[260px] font-mono-accent text-xs leading-relaxed resize-y"
        />
      </div>

      <div className="flex justify-center">
        <Button type="button" variant="outline" size="sm" onClick={() => setMode((m) => (m === "encode" ? "decode" : "encode"))}>
          <ArrowRightLeft className="h-4 w-4" /> 切换编 / 解码
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-md border-l-2 border-l-destructive bg-destructive/10 px-4 py-3 font-mono-accent text-xs text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {output && (
        <div className="space-y-2 animate-fade-in-up">
          <div className="flex items-center justify-between">
            <Label>{mode === "encode" ? "Base64 编码结果" : "解码后文本"}</Label>
            <CopyButton value={output} />
          </div>
          <pre className="thin-scroll min-h-[160px] max-h-[400px] overflow-auto rounded-xl border border-border bg-card p-4 font-mono-accent text-xs leading-relaxed break-all whitespace-pre-wrap select-text">
            {output}
          </pre>
        </div>
      )}
    </div>
  );
}
