"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/life-family-tools.tsx");


/**
 * 生活类工具：亲戚关系计算、字幕格式转换。
 *
 * 布局：
 *   · 亲戚关系 —— **模式 B（4:8）**：左侧用按钮"搭"出关系链（也可直接输入「爸爸的哥哥的儿子」），
 *     右侧是结论卡 + 反向查询 + 说明。这类工具的核心是「把口语关系翻成称谓」，所以结论要非常醒目，
 *     并且要如实说明「有些情况本来就有两个答案」（比如堂哥/堂弟取决于谁年纪大）。
 *   · 字幕转换 —— **模式 A + 编辑器**：上面选格式，中间原文、下面结果，带时间轴预览。
 *
 * ★ 亲戚关系算法用的是开源库 relationship.js（MIT 许可，作者 HaoLe Zheng），已内置在
 *   `web/src/vendor/relationship.min.js`。这是中文亲属称谓领域事实上的标准实现，
 *   覆盖直系、旁系、姻亲与多种方言叫法；自己重写一遍反而更容易出错。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  Baby,
  Captions,
  Copy,
  Eraser,
  FileText,
  Info,
  Languages,
  RotateCcw,
  Sparkles,
  User,
  Users,
  Wand2,
} from "lucide-react";
import { Badge, Button, Input, Label, Select } from "@/components/ui/primitives";
import { CopyButton } from "./copy-button";
import { useToolDraft } from "@/lib/use-tool-draft";
import { cn } from "@/lib/utils";


// ── relationship.js 的按需加载 ────────────────────────────────────────────
//
// 这是中文亲属称谓领域事实上的标准实现（MIT，作者 HaoLe Zheng）。
// 它是 UMD 包，直接 import 会被 Rollup 当成 ES 模块而构建失败，
// 所以放在 public/vendor/ 下用 <script> 按需加载；不用这个工具的用户不会下载它。
declare global {
  interface Window {
    relationship?: (opt: { text: string; reverse?: boolean; sex?: number }) => string | string[];
  }
}

let relLoading: Promise<NonNullable<Window["relationship"]>> | null = null;

function loadRelationship(): Promise<NonNullable<Window["relationship"]>> {
  if (typeof window === "undefined") return Promise.reject(new Error("no window"));
  if (window.relationship) return Promise.resolve(window.relationship);
  if (relLoading) return relLoading;
  relLoading = new Promise((resolve, reject) => {
    const el = document.createElement("script");
    el.src = "/vendor/relationship.min.js";
    el.async = true;
    el.onload = () => {
      if (window.relationship) resolve(window.relationship);
      else reject(new Error("关系库加载后没有挂上 window.relationship"));
    };
    el.onerror = () => reject(new Error("关系库加载失败（请检查安装目录里的 vendor/relationship.min.js 是否存在）"));
    document.head.appendChild(el);
  });
  return relLoading;
}

function SectionCard({
  icon,
  title,
  extra,
  children,
  className,
}: {
  icon?: React.ReactNode;
  title?: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const __locale = __useLanguage();
  return (
    <div className={cn("rounded-2xl border border-border/70 bg-card/60 p-5 shadow-sm backdrop-blur-md", className)}>
      {(title || extra) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
          <div className="flex items-center gap-2">
            {icon && (
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</span>
            )}
            {title && <span className="text-sm font-semibold text-foreground">{__ui(title)}</span>}
          </div>
          {extra}
        </div>
      )}
      {children}
    </div>
  );
}

function ErrorBar({ message }: { message: string }) {
  const __locale = __useLanguage();
  return (
    <div className="flex items-center gap-2 rounded-xl border-l-4 border-l-destructive bg-destructive/10 px-4 py-3 font-mono text-xs text-destructive">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      {__msg(message)}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 工具一：亲戚关系计算
// ══════════════════════════════════════════════════════════════════════

/** 搭关系链用的基本称呼 */
const LINK_WORDS = ["爸爸", "妈妈", "哥哥", "弟弟", "姐姐", "妹妹", "儿子", "女儿", "丈夫", "妻子"];

/** 提示：哪些名词其实有两个答案 */
function whyMultiple(text: string, results: string[]): string | null {
  if (results.length < 2) return null;
  const t = results.join("");
  if (/哥/.test(t) && /弟/.test(t)) return "结果里同时出现「哥」「弟」，是因为还取决于你们俩谁年纪大 —— 对方比你大是哥，比你小是弟。";
  if (/姐/.test(t) && /妹/.test(t)) return "结果里同时出现「姐」「妹」，同样取决于你俩的年龄长幼。";
  if (results.length > 1 && text.includes("的")) return null;
  return null;
}

export function KinshipTool() {
  const __locale = __useLanguage();
  const [chain, setChain] = useState<string[]>([]);
  const [freeText, setFreeText] = useToolDraft("kinship", "freeText", "");
  const [sex, setSex] = useToolDraft<"1" | "0">("kinship", "sex", "1");
  const [reverseText, setReverseText] = useToolDraft("kinship", "reverseText", "");
  /** 称谓库是按需加载的（79KB，不打开这个工具就不下载） */
  const [relReady, setRelReady] = useState(false);
  const [relError, setRelError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadRelationship()
      .then(() => {
        if (!cancelled) setRelReady(true);
      })
      .catch((e: unknown) => {
        if (!cancelled) setRelError(e instanceof Error ? e.message : "称谓库加载失败");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const chainText = useMemo(() => chain.join("的"), [chain, __locale]);

  const forward = useMemo(() => {
    const text = (chain.length > 0 ? chainText : freeText).trim();
    if (!text) return { text: "", results: [] as string[], error: "" };
    if (!relReady || !window.relationship) {
      return { text, results: [] as string[], error: relError ?? "正在加载称谓库…" };
    }
    // 把「我的」「我」这类前缀去掉 —— "我"不在称谓表里
    const cleaned = text.replace(/^我的/, "").replace(/我/, "").trim();
    let results: string[] = [];
    try {
      const r = window.relationship({ text: cleaned, sex: Number(sex) });
      results = Array.isArray(r) ? r.filter(Boolean) : r ? [String(r)] : [];
    } catch {
      results = [];
    }
    return {
      text: cleaned,
      results,
      error:
        results.length === 0
          ? `没能认出「${cleaned}」这串关系。请用「爸爸 / 妈妈 / 哥哥 / 姐姐 / 儿子 / 丈夫」这类称呼来组合，例如「爸爸的哥哥的儿子」。`
          : "",
    };
  }, [chain, chainText, freeText, sex, relReady, relError, __locale]);

  const reverse = useMemo(() => {
    const text = reverseText.trim();
    if (!text) return { text: "", results: [] as string[], error: "" };
    if (!relReady || !window.relationship) {
      return { text, results: [] as string[], error: relError ?? "正在加载称谓库…" };
    }
    let results: string[] = [];
    try {
      const r = window.relationship({ text, reverse: true, sex: Number(sex) });
      results = Array.isArray(r) ? r.filter(Boolean) : r ? [String(r)] : [];
    } catch {
      results = [];
    }
    return {
      text,
      results,
      error: results.length === 0 ? `「${text}」不在称谓表里，换个常见叫法试试（例如「爷爷」「舅舅」「堂哥」）。` : "",
    };
  }, [reverseText, sex, relReady, relError, __locale]);

  const pushWord = (w: string) => {
    setChain((prev) => [...prev, w]);
    setFreeText("");
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="thin-scroll space-y-4 lg:col-span-4">
          <SectionCard
            icon={<Users className="h-4 w-4" />}
            title={__ui("搭出关系")}
            extra={
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setChain(["爸爸", "哥哥", "儿子"]);
                    setFreeText("");
                  }}
                >
                  <Sparkles className="h-3.5 w-3.5" /> {__ui("示例")}</Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    setChain([]);
                    setFreeText("");
                  }}
                >
                  <Eraser className="h-3.5 w-3.5" /> {__ui("清空")}</Button>
              </div>
            }
          >
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="kp-sex">{__ui("我的性别（影响对方的称呼）")}</Label>
                <Select id="kp-sex" value={sex} onChange={(e) => setSex(e.target.value as "1" | "0")} className="w-full text-xs">
                  <option value="1">{__ui("男")}</option>
                  <option value="0">{__ui("女")}</option>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>{__ui("点按钮依次添加（顺着关系一层层点）")}</Label>
                <div className="grid grid-cols-5 gap-1.5">
                  {LINK_WORDS.map((w) => (
                    <button
                      key={w}
                      type="button"
                      onClick={() => pushWord(w)}
                      className="rounded-lg border border-border/60 px-1 py-1.5 text-[11.5px] text-foreground transition-colors hover:border-primary/40 hover:bg-primary/[0.07]"
                    >
                      {w}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => setChain((p) => p.slice(0, -1))} disabled={chain.length === 0}>
                    <RotateCcw className="h-3.5 w-3.5" /> {__ui("退一步")}</Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setChain([])} disabled={chain.length === 0}>
                    {__ui("清空链条")}</Button>
                </div>
              </div>

              {chain.length > 0 && (
                <div className="rounded-xl border border-border/60 bg-secondary/20 p-2.5">
                  <div className="mb-1 text-[11px] text-muted-foreground">{__ui("当前关系链")}</div>
                  <div className="flex flex-wrap items-center gap-1">
                    {chain.map((w, i) => (
                      <span key={i} className="flex items-center gap-1">
                        {i > 0 && <span className="text-muted-foreground">{__ui("的")}</span>}
                        <span className="rounded-md bg-primary/10 px-1.5 py-0.5 text-[11.5px] text-primary">{w}</span>
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-1.5">
                <Label htmlFor="kp-free">{__ui("或者直接输入")}</Label>
                <Input
                  id="kp-free"
                  value={freeText}
                  onChange={(e) => {
                    setFreeText(e.target.value);
                    if (e.target.value) setChain([]);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  placeholder={__ui("例如：爸爸的哥哥的儿子")}
                  className="text-xs"
                />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {__ui("支持直系（爸爸的妈妈）、旁系（妈妈的哥哥的女儿）、姻亲（妻子的爸爸、哥哥的妻子）。")}</p>
              </div>
            </div>
          </SectionCard>

          <SectionCard
            icon={<ArrowLeftRight className="h-4 w-4" />}
            title={__ui("反向查询")}
            extra={
              <Button type="button" variant="outline" size="sm" onClick={() => setReverseText("堂哥")}>
                <Sparkles className="h-3.5 w-3.5" /> {__ui("示例")}</Button>
            }
          >
            <Input
              value={reverseText}
              onChange={(e) => setReverseText(e.target.value)}
              placeholder={__ui("输入对方的称呼，例如：堂哥")}
              className="text-xs"
            />
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              {__ui("用来算「他该叫我什么」：输入对方与你的关系，就能得到你在他那边的称呼。")}</p>
          </SectionCard>
        </div>

        <div className="thin-scroll space-y-4 lg:col-span-8">
          <SectionCard icon={<User className="h-4 w-4" />} title={__ui("计算结果")}>
            {!forward.text ? (
              <div className="flex flex-col items-center justify-center gap-2.5 py-16 text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Users className="h-5 w-5" />
                </span>
                <p className="text-sm font-medium text-foreground">{__ui("点左边的按钮，或者直接输入关系")}</p>
                <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
                  {__ui("例如「爸爸的哥哥的儿子」会得到堂哥 / 堂弟；「妈妈的哥哥的女儿」会得到舅表姐 / 舅表妹。")}</p>
              </div>
            ) : forward.error ? (
              <ErrorBar message={__msg(forward.error)} />
            ) : (
              <div className="space-y-3">
                <div className="rounded-xl border border-primary/30 bg-primary/[0.07] px-4 py-4">
                  <div className="text-[11.5px] text-muted-foreground">
                    「{forward.text}{__ui("」是你的")}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {forward.results.map((r) => (
                      <span key={r} className="text-2xl font-bold text-primary">
                        {r}
                      </span>
                    ))}
                    <CopyButton value={`${forward.text} → ${forward.results.join(" / ")}`} label="" />
                  </div>
                </div>
                {whyMultiple(forward.text, forward.results) && (
                  <div className="flex items-start gap-2 rounded-xl border-l-4 border-l-amber-500 bg-amber-500/10 px-3 py-2.5 text-[12px] leading-relaxed text-foreground">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                    {whyMultiple(forward.text, forward.results)}
                  </div>
                )}
                {forward.results.length > 1 && !whyMultiple(forward.text, forward.results) && (
                  <p className="text-[11.5px] leading-relaxed text-muted-foreground">
                    {__ui("出现多个结果，是因为这条关系本身还缺少信息（例如对方性别、长幼），需要结合具体情况选用。")}</p>
                )}
              </div>
            )}
          </SectionCard>

          {reverse.text && (
            <SectionCard icon={<ArrowLeftRight className="h-4 w-4" />} title={__msg("反向 · 对方是「{0}」时", reverse.text)}>
              {reverse.error ? (
                <ErrorBar message={__msg(reverse.error)} />
              ) : (
                <div className="rounded-xl border border-border/60 bg-secondary/20 px-4 py-4">
                  <div className="text-[11.5px] text-muted-foreground">{__ui("那么你在他那边是")}</div>
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    {reverse.results.map((r) => (
                      <span key={r} className="text-xl font-bold text-foreground">
                        {r}
                      </span>
                    ))}
                    <CopyButton value={reverse.results.join(" / ")} label="" />
                  </div>
                </div>
              )}
            </SectionCard>
          )}

          <SectionCard icon={<Info className="h-4 w-4" />} title={__ui("算法与说明")}>
            <ul className="space-y-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
              <li>
                {__ui("· 关系解析采用开源库")}<b className="text-foreground">relationship.js</b>{__ui("（MIT 许可，作者 HaoLe Zheng）， 已内置在本工具中，离线可用；它把「爸爸 / 妈妈 / 哥哥 / 儿子 / 妻子」等基本称呼按二叉树关系推导成称谓， 覆盖直系、旁系与姻亲。")}</li>
              <li>
                {__ui("· 称谓按")}<b className="text-foreground">{__ui("普通话通用叫法")}</b>{__ui("给出（例如同样一位长辈，有的地方叫「大姑」、有的地方叫「姑妈」）； 各地习惯不同，以家中长辈的实际叫法为准。")}</li>
              <li>
                {__ui("· 有些关系本身就有多个答案（堂哥还是堂弟，取决于谁年纪大），这时会全部列出并说明原因。")}</li>
              <li>{__ui("· 计算全在本机完成，不需要联网。")}</li>
            </ul>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 工具二：字幕格式转换（SRT / VTT / ASS / LRC / 纯文本）
// ══════════════════════════════════════════════════════════════════════

interface Cue {
  start: number; // 毫秒
  end: number; // 毫秒
  lines: string[];
}

type SubFormat = "srt" | "vtt" | "ass" | "lrc" | "txt";

const FORMAT_NAME: Record<SubFormat, string> = {
  srt: "SRT（SubRip，最通用）",
  vtt: "VTT（WebVTT，网页播放器）",
  ass: "ASS / SSA（带样式，播放器常用）",
  lrc: "LRC（歌词，只有开始时间）",
  txt: "纯文本（只要文字）",
};

const shortName = (f: SubFormat) => FORMAT_NAME[f].replace(/（.*/, "");

/** 00:00:01,000 / 00:00:01.000 / 0:00:01.00 → 毫秒 */
function parseTime(s: string): number | null {
  const t = s.trim().replace(",", ".");
  const m = t.match(/^(?:(\d+):)?(\d{1,2}):(\d{1,2})(?:[.:](\d{1,3}))?$/);
  if (!m) return null;
  const [, h, mm, ss, ms] = m;
  return (Number(h ?? 0) * 3600 + Number(mm) * 60 + Number(ss)) * 1000 + Number((ms ?? "0").padEnd(3, "0").slice(0, 3));
}

const pad = (n: number, len = 2) => String(n).padStart(len, "0");

function fmtSrtTime(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3600000);
  const m = Math.floor((t % 3600000) / 60000);
  const s = Math.floor((t % 60000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(t % 1000, 3)}`;
}

const fmtVttTime = (ms: number) => fmtSrtTime(ms).replace(",", ".");

function fmtAssTime(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  const h = Math.floor(t / 3600000);
  const m = Math.floor((t % 3600000) / 60000);
  const s = Math.floor((t % 60000) / 1000);
  return `${h}:${pad(m)}:${pad(s)}.${pad(Math.floor((t % 1000) / 10))}`;
}

function fmtLrcTime(ms: number): string {
  const t = Math.max(0, Math.round(ms));
  return `[${pad(Math.floor(t / 60000))}:${((t % 60000) / 1000).toFixed(2).padStart(5, "0")}]`;
}

/** 去掉 <i>、{\an8}、\N 这类样式标记，只留文字 */
function stripTags(text: string): string {
  return text
    .replace(/\{[^}]*\}/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\\N|\\n/gi, "\n")
    .trim();
}

/** 自动判断输入是哪种格式 */
function detectFormat(text: string): SubFormat {
  const head = text.slice(0, 4000);
  if (/^\s*WEBVTT/m.test(head)) return "vtt";
  if (/^\s*\[Script Info\]/m.test(head) || /^\s*Dialogue\s*:/m.test(head)) return "ass";
  if (/^\s*\[\d{1,2}:\d{2}(\.\d{1,3})?\]/m.test(head) && !/-->/.test(head)) return "lrc";
  if (/-->/.test(head) && /\d{2}:\d{2}:\d{2},\d{3}/.test(head)) return "srt";
  if (/-->/.test(head)) return "vtt";
  return "txt";
}

function parseSubtitles(text: string, format: SubFormat): Cue[] {
  const cues: Cue[] = [];
  const norm = text.replace(/\r\n?/g, "\n");

  if (format === "lrc") {
    for (const line of norm.split("\n")) {
      const m = line.match(/^\[(\d{1,2}):(\d{1,2}(?:\.\d{1,3})?)\](.*)$/);
      if (!m) continue;
      const start = (Number(m[1]) * 60 + Number(m[2])) * 1000;
      const body = m[3].trim();
      if (body) cues.push({ start, end: start + 3000, lines: [body] });
    }
    for (let i = 0; i < cues.length - 1; i++) cues[i].end = Math.max(cues[i].start + 1, Math.min(cues[i].end, cues[i + 1].start));
    return cues;
  }

  if (format === "ass") {
    let inEvents = false;
    let textIndex = 9;
    for (const line of norm.split("\n")) {
      const l = line.trim();
      if (/^\[Events\]/i.test(l)) {
        inEvents = true;
        continue;
      }
      if (/^\[/.test(l)) {
        inEvents = /^\[Events\]/i.test(l);
        continue;
      }
      if (!inEvents) continue;
      const fm = l.match(/^Format\s*:\s*(.+)$/i);
      if (fm) {
        const idx = fm[1].split(",").map((c) => c.trim().toLowerCase()).indexOf("text");
        if (idx >= 0) textIndex = idx;
        continue;
      }
      const dm = l.match(/^Dialogue\s*:\s*(.+)$/i);
      if (!dm) continue;
      const parts = dm[1].split(",");
      if (parts.length <= textIndex) continue;
      const start = parseTime(parts[1]);
      const end = parseTime(parts[2]);
      if (start === null || end === null) continue;
      const lines = stripTags(parts.slice(textIndex).join(",")).split("\n").map((x) => x.trim()).filter(Boolean);
      if (lines.length) cues.push({ start, end, lines });
    }
    return cues;
  }

  if (format === "txt") {
    return norm
      .split(/\n{2,}/)
      .map((block) => block.split("\n").map((x) => x.trim()).filter(Boolean))
      .filter((lines) => lines.length > 0)
      .map((lines, i) => ({ start: i * 3000, end: i * 3000 + 3000, lines }));
  }

  // SRT / VTT：都是「时间行 + 文本行」，VTT 多一个 WEBVTT 头与可选 cue id
  for (const block of norm.split(/\n{2,}/)) {
    const raw = block.split("\n").map((l) => l.trimEnd());
    const timeIdx = raw.findIndex((l) => l.includes("-->"));
    if (timeIdx < 0) continue;
    const tm = raw[timeIdx].match(/([\d:.,]+)\s*-->\s*([\d:.,]+)/);
    if (!tm) continue;
    const start = parseTime(tm[1]);
    const end = parseTime(tm[2]);
    if (start === null || end === null) continue;
    const lines = raw.slice(timeIdx + 1).map((l) => stripTags(l)).filter((l) => l.length > 0);
    if (lines.length) cues.push({ start, end, lines });
  }
  return cues;
}

function buildSubtitles(cues: Cue[], format: SubFormat, mergeLines: boolean): string {
  const linesOf = (c: Cue) => (mergeLines ? [c.lines.join(" ")] : c.lines);

  if (format === "txt") return cues.map((c) => linesOf(c).join("\n")).join("\n\n");
  if (format === "lrc") return cues.map((c) => `${fmtLrcTime(c.start)}${linesOf(c).join(" ")}`).join("\n");
  if (format === "vtt") {
    return (
      "WEBVTT\n\n" +
      cues
        .map((c, i) => `${i + 1}\n${fmtVttTime(c.start)} --> ${fmtVttTime(c.end)}\n${linesOf(c).join("\n")}`)
        .join("\n\n") +
      "\n"
    );
  }
  if (format === "ass") {
    const head = [
      "[Script Info]",
      "ScriptType: v4.00+",
      "WrapStyle: 0",
      "ScaledBorderAndShadow: yes",
      "PlayResX: 1920",
      "PlayResY: 1080",
      "",
      "[V4+ Styles]",
      "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
      "Style: Default,微软雅黑,54,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,2,1,2,20,20,28,1",
      "",
      "[Events]",
      "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
    ];
    const body = cues.map(
      (c) => `Dialogue: 0,${fmtAssTime(c.start)},${fmtAssTime(c.end)},Default,,0,0,0,,${linesOf(c).join("\\N")}`,
    );
    return [...head, ...body].join("\n") + "\n";
  }
  return (
    cues.map((c, i) => `${i + 1}\n${fmtSrtTime(c.start)} --> ${fmtSrtTime(c.end)}\n${linesOf(c).join("\n")}`).join("\n\n") + "\n"
  );
}

const SAMPLE_SRT = `1
00:00:01,000 --> 00:00:04,000
第一句字幕

2
00:00:04,500 --> 00:00:08,250
第二句字幕
可以有两行

3
00:00:09,000 --> 00:00:12,000
<i>带标签的一句</i>
`;

export function SubtitleConvertTool() {
  const __locale = __useLanguage();
  const [source, setSource] = useState("");
  const [from, setFrom] = useState<SubFormat | "auto">("auto");
  const [to, setTo] = useToolDraft<SubFormat>("subtitle-convert", "to", "vtt");
  const [offsetSec, setOffsetSec] = useToolDraft("subtitle-convert", "offsetSec", "0");
  const [fpsFrom, setFpsFrom] = useToolDraft("subtitle-convert", "fpsFrom", "23.976");
  const [fpsTo, setFpsTo] = useToolDraft("subtitle-convert", "fpsTo", "25");
  const [useFps, setUseFps] = useState(false);
  const [mergeLines, setMergeLines] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const detected = useMemo(() => (source.trim() ? detectFormat(source) : null), [source, __locale]);
  const actualFrom = from === "auto" ? detected ?? "srt" : from;

  const cues = useMemo(() => {
    if (!source.trim()) return [] as Cue[];
    const parsed = parseSubtitles(source, actualFrom);
    const offset = (Number(offsetSec) || 0) * 1000;
    const k = useFps ? (Number(fpsFrom) || 1) / (Number(fpsTo) || 1) : 1;
    return parsed
      .map((c) => ({ start: Math.max(0, c.start * k + offset), end: Math.max(0, c.end * k + offset), lines: c.lines }))
      .filter((c) => c.end > c.start);
  }, [source, actualFrom, offsetSec, useFps, fpsFrom, fpsTo, __locale]);

  const output = useMemo(() => (cues.length ? buildSubtitles(cues, to, mergeLines) : ""), [cues, to, mergeLines, __locale]);

  const loadFile = useCallback(async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setSource((await f.text()).replace(/^\uFEFF/, ""));
  }, []);

  const duration = cues.length ? cues[cues.length - 1].end - cues[0].start : 0;
  const fmtDur = (ms: number) => {
    const s = Math.round(ms / 1000);
    return `${Math.floor(s / 60)} 分 ${pad(s % 60)} 秒`;
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="thin-scroll space-y-4 lg:col-span-5">
          <SectionCard
            icon={<FileText className="h-4 w-4" />}
            title={__ui("字幕内容")}
            extra={
              <div className="flex items-center gap-1.5">
                <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                  {__ui("打开文件")}</Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setSource(SAMPLE_SRT)}>
                  <Sparkles className="h-3.5 w-3.5" /> {__ui("示例")}</Button>
                <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={() => setSource("")}>
                  <Eraser className="h-3.5 w-3.5" /> {__ui("清空")}</Button>
              </div>
            }
          >
            <input
              ref={fileRef}
              type="file"
              accept=".srt,.vtt,.ass,.ssa,.lrc,.txt,text/plain"
              className="hidden"
              onChange={(e) => {
                void loadFile(e.target.files);
                e.target.value = "";
              }}
            />
            <textarea
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder={__ui("把字幕内容粘贴到这里，或点右上角「打开文件」（也可以直接把文件拖进来）")}
              className="thin-scroll h-64 w-full resize-y rounded-xl border border-border/60 bg-background/60 p-3 font-mono text-[11.5px] leading-relaxed text-foreground outline-none focus:ring-2 focus:ring-primary/30"
            />
            {detected && (
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11.5px]">
                <span className="text-muted-foreground">{__ui("识别为")}</span>
                <Badge variant="outline" className="text-primary">
                  {__msg(shortName(detected))}
                </Badge>
                <span className="text-muted-foreground">{__ui("共")}{cues.length} {__ui("条")}</span>
                {cues.length > 0 && <span className="text-muted-foreground">{__ui("· 跨度")}{fmtDur(duration)}</span>}
              </div>
            )}
          </SectionCard>

          <SectionCard icon={<Languages className="h-4 w-4" />} title={__ui("转换设置")}>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="sc-from">{__ui("源格式")}</Label>
                  <Select id="sc-from" value={from} onChange={(e) => setFrom(e.target.value as SubFormat | "auto")} className="w-full text-xs">
                    <option value="auto">{__ui("自动识别")}</option>
                    {(Object.keys(FORMAT_NAME) as SubFormat[]).map((f) => (
                      <option key={f} value={f}>
                        {__msg(shortName(f))}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="sc-to">{__ui("目标格式")}</Label>
                  <Select id="sc-to" value={to} onChange={(e) => setTo(e.target.value as SubFormat)} className="w-full text-xs">
                    {(Object.keys(FORMAT_NAME) as SubFormat[]).map((f) => (
                      <option key={f} value={f}>
                        {__msg(shortName(f))}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="sc-offset">{__ui("整段时间偏移（秒，可填负数）")}</Label>
                <Input id="sc-offset" type="number" step="0.1" value={offsetSec} onChange={(e) => setOffsetSec(e.target.value)} className="text-xs" />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {__ui("字幕比画面早出现就填正数、晚出现就填负数，用来对齐不同来源的字幕。")}</p>
              </div>

              <div className="space-y-2 rounded-xl border border-border/60 bg-secondary/20 p-3">
                <label className="flex items-center gap-2 text-[12px] text-foreground">
                  <input type="checkbox" checked={useFps} onChange={(e) => setUseFps(e.target.checked)} className="accent-primary" />
                  {__ui("按帧率换算时间轴")}</label>
                {useFps && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="sc-fps1">{__ui("字幕原本的帧率")}</Label>
                      <Input id="sc-fps1" value={fpsFrom} onChange={(e) => setFpsFrom(e.target.value)} className="text-xs" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="sc-fps2">{__ui("视频的帧率")}</Label>
                      <Input id="sc-fps2" value={fpsTo} onChange={(e) => setFpsTo(e.target.value)} className="text-xs" />
                    </div>
                  </div>
                )}
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {__ui("常见场景：23.976 帧的字幕配 25 帧的视频（或反过来）时时间轴会整体对不上，勾选后按帧率比例换算。")}</p>
              </div>

              <div className="space-y-2 rounded-xl border border-border/60 bg-secondary/20 p-3">
                <label className="flex items-center gap-2 text-[12px] text-foreground">
                  <input type="checkbox" checked={mergeLines} onChange={(e) => setMergeLines(e.target.checked)} className="accent-primary" />
                  {__ui("把每条字幕的多行合并成一行")}</label>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {__ui("同时会去掉 SRT 的样式标记与 ASS 的特效标记，只保留文字内容。")}</p>
              </div>
            </div>
          </SectionCard>
        </div>

        <div className="thin-scroll space-y-4 lg:col-span-7">
          <SectionCard
            icon={<Captions className="h-4 w-4" />}
            title={__msg("转换结果 · {0}", shortName(to))}
            extra={
              <div className="flex items-center gap-2">
                <CopyButton value={output} label={__ui("复制结果")} />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={!output}
                  onClick={() => {
                    const blob = new Blob(["\ufeff" + output], { type: "text/plain;charset=utf-8" });
                    const a = document.createElement("a");
                    a.href = URL.createObjectURL(blob);
                    a.download = `字幕.${to}`;
                    // ★ 游离的 <a> 直接 click() 在 WebView2 里会被忽略（点了没反应）——
    //   必须挂到 DOM 上再点，点完移除（通用结果卡那边用的是页面里的真链接，所以正常）
    document.body.appendChild(a);
    document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 1000);
    setTimeout(() => a.remove(), 1000);
                    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
                  }}
                >
                  {__ui("下载文件")}</Button>
              </div>
            }
          >
            {output ? (
              <>
                <textarea
                  readOnly
                  value={output}
                  className="thin-scroll h-56 w-full resize-y rounded-xl border border-border/60 bg-background/60 p-3 font-mono text-[11.5px] leading-relaxed text-foreground outline-none"
                />
                <div className="mt-3 overflow-hidden rounded-xl border border-border/60">
                  <div className="bg-muted/60 px-3 py-2 text-[11.5px] font-semibold text-foreground">
                    {__ui("时间轴预览（前")}{Math.min(12, cues.length)} {__ui("条）")}</div>
                  <table className="w-full border-collapse text-xs">
                    <tbody>
                      {cues.slice(0, 12).map((c, i) => (
                        <tr key={i} className="border-t border-border/40 even:bg-muted/20">
                          <td className="w-10 px-3 py-1.5 text-muted-foreground">{i + 1}</td>
                          <td className="w-48 whitespace-nowrap px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
                            {fmtSrtTime(c.start)} → {fmtSrtTime(c.end)}
                          </td>
                          <td className="px-3 py-1.5 text-foreground">{c.lines.join(" / ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2.5 py-16 text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Captions className="h-5 w-5" />
                </span>
                <p className="text-sm font-medium text-foreground">{__ui("粘贴字幕内容后这里出结果")}</p>
                <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
                  {__ui("支持 SRT、VTT、ASS/SSA、LRC 与纯文本互转，可整体平移时间轴、按帧率换算、清理样式标记。")}</p>
              </div>
            )}
          </SectionCard>

          <SectionCard icon={<Info className="h-4 w-4" />} title={__ui("说明")}>
            <ul className="space-y-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
              <li>{__ui("· 解析按「时间行 + 文本行」识别；SRT 用逗号、VTT 用小数点，本工具会自动处理两种写法。")}</li>
              <li>{__ui("· 转 ASS 时会带上一套常规样式（微软雅黑、白字黑边、底部居中），保证在播放器里能正常显示。")}</li>
              <li>{__ui("· 转 LRC 时只保留开始时间（歌词格式本身没有结束时间），每条持续到下一句开始。")}</li>
              <li>{__ui("· 转换在本机完成，字幕内容不会上传。")}</li>
            </ul>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
