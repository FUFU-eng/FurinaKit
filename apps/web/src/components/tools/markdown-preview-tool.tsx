"use client";

import { useState } from "react";
import { Label, Textarea } from "@/components/ui/primitives";
import { CopyButton } from "@/components/tools/copy-button";
import { renderMarkdown } from "@/lib/markdown";

const SAMPLE = `# Markdown 实时预览

在浏览器本地**安全渲染**，*无需联网*。

## 支持的语法
- 标题、**加粗**、*斜体*、\`行内代码\`
- [链接](https://example.com)（仅允许安全链接）
- 有序列表：
1. 第一项
2. 第二项

> 引用块也可以正常显示。

\`\`\`
const code = "代码块使用等宽字体";
\`\`\`
`;

export function MarkdownPreviewTool() {
  const [input, setInput] = useState(SAMPLE);
  const [layout, setLayout] = useState<"split" | "stacked">("split");

  return (
    <div className="space-y-4">
      {/* 顶部工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 pb-3">
        <div className="flex items-center gap-2">
          <CopyButton value={input} label="复制原文" />
          <button
            type="button"
            onClick={() => setInput(SAMPLE)}
            className="rounded-lg border border-border/60 bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-muted hover:text-foreground"
          >
            重置为示例
          </button>
          {input && (
            <button
              type="button"
              onClick={() => setInput("")}
              className="rounded-lg border border-border/60 bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive"
            >
              清空
            </button>
          )}
        </div>

        {/* 视窗布局切换 */}
        <div className="flex items-center gap-1 rounded-lg border border-border/50 bg-background/50 p-1 text-xs">
          <button
            type="button"
            onClick={() => setLayout("split")}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors ${
              layout === "split"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            左右并排
          </button>
          <button
            type="button"
            onClick={() => setLayout("stacked")}
            className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors ${
              layout === "stacked"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            上下全宽（大视窗）
          </button>
        </div>
      </div>

      <div className={layout === "split" ? "grid gap-4 lg:grid-cols-2" : "space-y-4"}>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>Markdown 原文</Label>
            <span className="text-[11px] text-muted-foreground font-mono-accent">
              {input.length} 字符 · {input.split("\n").length} 行
            </span>
          </div>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="# 在此输入 Markdown…"
            className="thin-scroll min-h-[460px] md:min-h-[540px] font-mono text-xs leading-relaxed resize-y"
          />
        </div>

        <div className="space-y-2">
          <Label>实时预览效果</Label>
          <div className="thin-scroll prose dark:prose-invert max-w-none min-h-[460px] md:min-h-[540px] max-h-[680px] overflow-auto rounded-xl border border-border bg-card p-6 leading-relaxed">
            {input.trim() ? (
              renderMarkdown(input)
            ) : (
              <p className="text-sm text-muted-foreground">暂无内容可预览，请在左侧输入 Markdown。</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
