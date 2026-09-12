"use client";

import { useEffect, useMemo, useState, Fragment } from "react";
import { AlertTriangle } from "lucide-react";
import { Label, Input, Textarea } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

const FLAG_OPTIONS = [
  { flag: "g", label: "全局匹配" },
  { flag: "i", label: "忽略大小写" },
  { flag: "m", label: "多行模式" },
  { flag: "s", label: "点匹配换行" },
  { flag: "u", label: "Unicode" },
];

type MatchInfo = { index: number; length: number; text: string; groups: string[] };

/**
 * 工具级缓存：切到别的工具或回首页会让本组件卸载，正则、标志位、测试文本与匹配结果都会丢。
 * 这里把这三项输入固定在模块作用域里：挂载时用它初始化 useState，之后每次变化写回，
 * 只有用户自己修改 / 清空时才会被覆盖；匹配结果由缓存的输入经原有纯匹配逻辑渲染出来，与离开前完全一致。
 * 与项目里已有的 fileHideCache / imagesToPdfCache / toolDraftCache 保持一致的模块缓存方案。
 */
type RegexTesterCache = { pattern: string; flags: string; sample: string };

const regexTesterCache: RegexTesterCache = {
  pattern: "\\b\\w+@\\w+\\.\\w+\\b",
  flags: "gi",
  sample: "Reach us at hi@furinakit.dev or support@example.com.",
};

export function RegexTesterTool() {
  const [pattern, setPattern] = useState(regexTesterCache.pattern);
  const [flags, setFlags] = useState(regexTesterCache.flags);
  const [sample, setSample] = useState(regexTesterCache.sample);

  // 三项输入任一变化就写回缓存，保证离开工具时缓存里是最新的一份
  useEffect(() => {
    regexTesterCache.pattern = pattern;
    regexTesterCache.flags = flags;
    regexTesterCache.sample = sample;
  }, [pattern, flags, sample]);

  const { matches, error, segments } = useMemo(() => {
    if (!pattern) return { matches: [] as MatchInfo[], error: null as string | null, segments: null };
    let re: RegExp;
    try {
      re = new RegExp(pattern, flags.includes("g") ? flags : flags + "g");
    } catch (e) {
      return { matches: [], error: e instanceof Error ? e.message : "无效的正则表达式", segments: null };
    }

    const found: MatchInfo[] = [];
    const segs: { text: string; match: boolean }[] = [];
    let last = 0;
    let m: RegExpExecArray | null;
    let guard = 0;
    while ((m = re.exec(sample)) !== null && guard < 10000) {
      guard++;
      if (m.index > last) segs.push({ text: sample.slice(last, m.index), match: false });
      segs.push({ text: m[0], match: true });
      found.push({ index: m.index, length: m[0].length, text: m[0], groups: m.slice(1) });
      last = m.index + m[0].length;
      if (m[0].length === 0) re.lastIndex++; // avoid zero-length infinite loop
    }
    if (last < sample.length) segs.push({ text: sample.slice(last), match: false });

    return { matches: found, error: null, segments: segs };
  }, [pattern, flags, sample]);

  const toggleFlag = (flag: string) =>
    setFlags((f) => (f.includes(flag) ? f.replace(flag, "") : f + flag));

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>正则表达式</Label>
        <div className="flex items-center gap-2">
          <span className="font-mono-accent text-sm text-muted-foreground">/</span>
          <Input
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
            placeholder="\\b\\w+@\\w+\\.\\w+\\b"
            className="font-mono-accent"
          />
          <span className="font-mono-accent text-sm text-muted-foreground">/{flags}</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {FLAG_OPTIONS.map(({ flag, label }) => (
          <button
            key={flag}
            type="button"
            onClick={() => toggleFlag(flag)}
            className={cn(
              "rounded-full border px-3 py-1 font-mono-accent text-[11px] transition-all",
              flags.includes(flag)
                ? "border-primary/40 bg-primary/15 text-primary"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {flag} · {label}
          </button>
        ))}
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>测试文本</Label>
          <span className="font-mono-accent text-[11px] text-muted-foreground">
            {sample.length} 字符 · {sample.split("\n").length} 行
          </span>
        </div>
        <Textarea
          value={sample}
          onChange={(e) => setSample(e.target.value)}
          className="min-h-[220px] md:min-h-[280px] font-mono-accent text-xs leading-relaxed resize-y"
          placeholder="在此输入待匹配的测试文本..."
        />
      </div>

      {error ? (
        <div className="flex items-center gap-2 rounded-md border-l-2 border-l-destructive bg-destructive/10 px-4 py-3 font-mono-accent text-xs text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      ) : pattern ? (
        <div className="space-y-3 animate-fade-in-up">
          <div className="flex items-center justify-between">
            <Label>匹配结果高亮</Label>
            <span className="font-mono-accent text-[11px] text-muted-foreground">
              {matches.length} 个匹配
            </span>
          </div>
          <div className="thin-scroll min-h-[160px] max-h-[380px] overflow-auto whitespace-pre-wrap rounded-xl border border-border bg-card p-4 font-mono-accent text-xs leading-relaxed">
            {segments && segments.length > 0 ? (
              segments.map((s, i) =>
                s.match ? (
                  <mark key={i} className="rounded bg-primary/25 px-0.5 text-primary-foreground/90 text-foreground">
                    {s.text}
                  </mark>
                ) : (
                  <Fragment key={i}>{s.text}</Fragment>
                ),
              )
            ) : (
              <span className="text-muted-foreground">暂无匹配。</span>
            )}
          </div>

          {matches.some((m) => m.groups.length > 0) && (
            <div className="space-y-1.5">
              {matches.map((m, i) => (
                <div key={i} className="rounded-md border border-border bg-card px-3 py-2 font-mono-accent text-[11px]">
                  <span className="text-primary">{JSON.stringify(m.text)}</span>
                  {m.groups.length > 0 && (
                    <span className="text-muted-foreground">
                      {"  →  分组："}
                      {m.groups.map((g, gi) => (
                        <span key={gi} className="text-foreground">
                          {gi > 0 ? ", " : ""}
                          {JSON.stringify(g)}
                        </span>
                      ))}
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
