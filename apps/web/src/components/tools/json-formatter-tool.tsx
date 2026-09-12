"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Wand2, Minimize2, AlertTriangle, Columns2, Rows2, Trash2, FileJson } from "lucide-react";
import { Button, Label, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";

const SAMPLE_JSON = JSON.stringify(
  {
    name: "FurinaKit",
    version: "2.0.1",
    description: "芙宁娜现代多功能开发与效率工具箱",
    author: { name: "Furina", github: "https://github.com/furinakit" },
    features: ["视频提取", "格式化工具", "图片转PDF", "文本处理", "加密解密"],
    settings: { theme: "eye-care", checkUpdate: true, autoFormat: true }
  },
  null,
  2
);

/**
 * 工具级缓存：切到别的工具或回首页会让本组件卸载，粘贴的 JSON 与格式化结果都会丢。
 * 这里把「输入 + 结果 + 报错 + 视窗布局」一起固定在模块作用域里：挂载时用它初始化 useState，
 * 之后每次变化写回，只有用户自己修改 / 清空时才覆盖。
 *
 * output 是「格式化美化 / 压缩成单行」按钮算出来的结果状态（不是随输入实时派生的），
 * 所以它必须整份缓存并原样复原 —— 不能靠回来时重跑一次 run() 来还原，
 * 那样既会丢掉用户当时选择的是美化还是压缩，也可能得到与离开前不同的呈现。
 * 与项目里已有的 fileHideCache / imagesToPdfCache / toolDraftCache 保持一致的模块缓存方案。
 */
type JsonFormatterCache = {
  input: string;
  output: string;
  error: string | null;
  layout: "split" | "stacked";
};

const jsonFormatterCache: JsonFormatterCache = {
  input: "",
  output: "",
  error: null,
  layout: "split",
};

export function JsonFormatterTool() {
  const [input, setInput] = useState(jsonFormatterCache.input);
  const [output, setOutput] = useState(jsonFormatterCache.output);
  const [error, setError] = useState<string | null>(jsonFormatterCache.error);
  const [copied, setCopied] = useState(false);
  const [layout, setLayout] = useState<"split" | "stacked">(jsonFormatterCache.layout);
  const { toast } = useToast();

  // 任何一项变化都写回缓存，保证离开工具时缓存里是最新的一份
  useEffect(() => {
    jsonFormatterCache.input = input;
    jsonFormatterCache.output = output;
    jsonFormatterCache.error = error;
    jsonFormatterCache.layout = layout;
  }, [input, output, error, layout]);

  const run = (minify: boolean) => {
    setError(null);
    if (!input.trim()) {
      setError("请先粘贴 JSON 内容。");
      setOutput("");
      return;
    }
    try {
      const parsed = JSON.parse(input);
      setOutput(JSON.stringify(parsed, null, minify ? 0 : 2));
    } catch (err) {
      setError(err instanceof Error ? err.message : "无效的 JSON");
      setOutput("");
    }
  };

  const loadSample = () => {
    setInput(SAMPLE_JSON);
    setOutput("");
    setError(null);
  };

  const clearAll = () => {
    setInput("");
    setOutput("");
    setError(null);
  };

  const copy = async () => {
    if (!output) return;
    await navigator.clipboard.writeText(output);
    setCopied(true);
    toast({ title: "已复制到剪贴板", variant: "success", duration: 1800 });
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-4">
      {/* 顶部工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/40 pb-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={() => run(false)} size="sm">
            <Wand2 className="h-4 w-4" /> 格式化美化
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => run(true)}>
            <Minimize2 className="h-4 w-4" /> 压缩成单行
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={loadSample}>
            <FileJson className="h-3.5 w-3.5 text-muted-foreground" /> 填入示例
          </Button>
          {input && (
            <Button type="button" variant="ghost" size="sm" onClick={clearAll} className="text-muted-foreground hover:text-destructive">
              <Trash2 className="h-3.5 w-3.5" /> 清空
            </Button>
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
            <Columns2 className="h-3.5 w-3.5" /> 左右并排
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
            <Rows2 className="h-3.5 w-3.5" /> 上下全宽（大视窗）
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 rounded-xl border-l-4 border-l-destructive bg-destructive/10 px-4 py-3 font-mono-accent text-xs text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {/* 核心编辑与结果区 */}
      <div className={layout === "split" ? "grid gap-4 lg:grid-cols-2" : "space-y-4"}>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>JSON 输入</Label>
            <span className="text-[11px] text-muted-foreground font-mono-accent">
              {input.length} 字符 · {input.split("\n").length} 行
            </span>
          </div>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder='{"hello": "world", "status": 200}'
            className="min-h-[380px] md:min-h-[460px] font-mono-accent text-xs leading-relaxed resize-y whitespace-pre overflow-x-auto"
            wrap="off"
            spellCheck={false}
          />
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>格式化结果</Label>
            {output && (
              <Button type="button" variant="ghost" size="sm" onClick={copy} className="h-7 text-xs">
                {copied ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? "已复制" : "复制代码"}
              </Button>
            )}
          </div>
          {output ? (
            <pre className="thin-scroll min-h-[380px] md:min-h-[460px] max-h-[640px] overflow-auto rounded-xl border border-border bg-card p-4 font-mono-accent text-xs leading-relaxed whitespace-pre select-text">
              {output}
            </pre>
          ) : (
            <div className="flex min-h-[380px] md:min-h-[460px] flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-card/40 p-6 text-center text-muted-foreground">
              <FileJson className="h-8 w-8 opacity-30 mb-2" />
              <p className="text-xs">点击上方「格式化美化」后，此处将呈现高亮结构化结果</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
