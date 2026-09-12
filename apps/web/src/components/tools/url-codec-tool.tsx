"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRightLeft, AlertTriangle } from "lucide-react";
import { Button, Label, Textarea } from "@/components/ui/primitives";
import { CopyButton } from "@/components/tools/copy-button";
import { cn } from "@/lib/utils";

type Mode = "encode" | "decode";

/**
 * 工具级缓存：切到别的工具或回首页会让本组件卸载，待编码文本与编码结果就没了。
 * 这里把它们固定在模块作用域里：组件挂载时用它初始化 useState，之后每次变化写回，
 * 只有用户自己修改 / 点击清空时才会被覆盖。
 * 与项目里已有的 fileHideCache / imagesToPdfCache / toolDraftCache 保持一致的模块缓存方案。
 */
type UrlCodecCache = { input: string; mode: Mode };

const urlCodecCache: UrlCodecCache = { input: "", mode: "encode" };

export function UrlCodecTool() {
  const [input, setInput] = useState(urlCodecCache.input);
  const [mode, setMode] = useState<Mode>(urlCodecCache.mode);

  // 输入 / 模式一变就写回缓存，保证离开工具时缓存里是最新的一份
  useEffect(() => {
    urlCodecCache.input = input;
    urlCodecCache.mode = mode;
  }, [input, mode]);

  const { output, error } = useMemo(() => {
    if (!input) return { output: "", error: null as string | null };
    try {
      return {
        output: mode === "encode" ? encodeURIComponent(input) : decodeURIComponent(input),
        error: null,
      };
    } catch {
      return { output: "", error: "输入包含无效的百分号编码序列。" };
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
          <Label>{mode === "encode" ? "待编码文本" : "待解码 URL 字符串"}</Label>
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
          placeholder={mode === "encode" ? "hello world & friends?" : "hello%20world%20%26%20friends%3F"}
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
            <Label>{mode === "encode" ? "URL 编码结果" : "URL 解码结果"}</Label>
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
