"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage, uiCount as __count } from "@/lib/language";
const __ui = __createUiText("components/tools/encoding-tools.tsx");


/**
 * 编码类工具的自带界面：字符编码自动检测、乱码修复。
 *
 * 布局选择（依据《新工具UI规范》第二部分）：
 *   · 字符编码自动检测 —— **模式 A（转换对照）的变体**：左边放"待检测的内容"，右边给结论与候选表。
 *     这个工具的核心产出是**一份判定结果 + 若干候选的对照**，用户要来回看"为什么判成这个"，
 *     所以左右并排、右侧用真正的表格呈现候选（模式 D 的表格手法），比堆成一段文字有用得多。
 *   · 乱码修复 —— **模式 A**：左边粘贴乱码，右边列出几个"可能的原文"供挑选。
 *     用户要做的是"从几个候选里认出正确那个"，所以候选要并排可对比、每条都能一键采用。
 *
 * 两个工具都走 Rust 侧的 /api/encoding/convert（浏览器不会"把文字编回 GBK 字节"，
 * 乱码修复必须靠 encoding_rs，见 src-tauri/src/encoding.rs）。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  Eraser,
  FileCode2,
  Lightbulb,
  Loader2,
  Search,
  Sparkles,
  Wand2,
} from "lucide-react";
import { Badge, Button, Label, Textarea } from "@/components/ui/primitives";
import { CopyButton } from "./copy-button";
import { useToolDraft } from "@/lib/use-tool-draft";
import { cn } from "@/lib/utils";

// ── 公用小件（只在本文件用，样式与全站一致）────────────────────────────

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
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">
                {icon}
              </span>
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

/** 十六进制 / 文本 互转时需要的小工具 */
function bytesFromText(text: string): Uint8Array {
  // 支持 "E4 BD A0"、"e4bda0"、"0xE4,0xBD" 三种常见写法
  const cleaned = text.replace(/0x/gi, " ").replace(/[^0-9a-fA-F]/g, " ").trim();
  const hex = cleaned.split(/\s+/).filter(Boolean).join("");
  const out = new Uint8Array(Math.floor(hex.length / 2));
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  bytes.forEach((b) => {
    bin += String.fromCharCode(b);
  });
  return btoa(bin);
}

function useFileBytes() {
  const [bytes, setBytes] = useState<Uint8Array | null>(null);
  const [fileName, setFileName] = useState("");
  const load = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = () => {
      const buf = reader.result as ArrayBuffer;
      setBytes(new Uint8Array(buf));
      setFileName(file.name);
    };
    reader.readAsArrayBuffer(file);
  }, []);
  const clear = useCallback(() => {
    setBytes(null);
    setFileName("");
  }, []);
  return { bytes, fileName, load, clear };
}

const ENCODING_OPTIONS = [
  { id: "utf-8", label: "UTF-8" },
  { id: "gb18030", label: "GBK / GB18030" },
  { id: "big5", label: "Big5（繁体）" },
  { id: "shift_jis", label: "Shift_JIS（日文）" },
  { id: "euc-kr", label: "EUC-KR（韩文）" },
  { id: "windows-1252", label: "Windows-1252（西欧）" },
  { id: "utf-16le", label: "UTF-16 LE" },
  { id: "utf-16be", label: "UTF-16 BE" },
];

// ══════════════════════════════════════════════════════════════════════
// 工具一：字符编码自动检测
// ══════════════════════════════════════════════════════════════════════

interface DetectItem {
  encoding: string;
  label: string;
  score: number;
  hadErrors: boolean;
  preview: string;
}

export function CharsetDetectTool() {
  const __locale = __useLanguage();
  const [source, setSource] = useToolDraft<"text" | "file">("charset-detect", "source", "text");
  const [input, setInput] = useToolDraft("charset-detect", "input", "");
  const file = useFileBytes();
  const [result, setResult] = useState<{
    size: number;
    bom: string | null;
    lineEnding: string;
    hexPreview: string;
    best: DetectItem | null;
    candidates: DetectItem[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const run = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      let data: string;
      if (source === "file") {
        if (!file.bytes) throw new Error("请先选择一个文件");
        data = toBase64(file.bytes);
      } else {
        if (!input.trim()) throw new Error("请粘贴内容，或改成“上传文件”来检测文件编码");
        // 纯文本输入按 UTF-8 取字节来检测（用户通常是从别处复制来的内容）
        const bytes = new TextEncoder().encode(input);
        // 额外识别一种常见情况：用户粘贴的是十六进制字节串
        const looksHex = /^[\s0-9a-fA-Fx,]+$/.test(input) && input.replace(/[^0-9a-fA-F]/g, "").length >= 4;
        data = toBase64(looksHex ? bytesFromText(input) : bytes);
      }
      const res = await fetch("/api/encoding/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "detect", data }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "检测失败");
      setResult(json);
    } catch (err) {
      setResult(null);
      setError(err instanceof Error ? err.message : "检测失败");
    } finally {
      setBusy(false);
    }
  }, [source, input, file.bytes]);

  const sample = () => {
    setSource("text");
    setInput("你好，世界！这是一段用来测试编码检测的中文文本。\nHello, world!");
  };

  const clearAll = () => {
    setInput("");
    file.clear();
    setResult(null);
    setError(null);
  };

  const confidence = (score: number) =>
    score >= 85 ? { text: "很可信", cls: "text-emerald-500" } : score >= 60 ? { text: "较可能", cls: "text-primary" } : { text: "疑似", cls: "text-muted-foreground" };

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        {/* 左：待检测的内容 */}
        <div className="thin-scroll space-y-4 lg:col-span-5">
          <SectionCard
            icon={<FileCode2 className="h-4 w-4" />}
            title={__ui("待检测的内容")}
            extra={
              <div className="flex items-center gap-1.5">
                <Button type="button" variant="outline" size="sm" onClick={sample}>
                  <Sparkles className="h-3.5 w-3.5" /> {__ui("填入示例")}</Button>
                <Button type="button" variant="ghost" size="sm" onClick={clearAll}>
                  <Eraser className="h-3.5 w-3.5" /> {__ui("清空")}</Button>
              </div>
            }
          >
            <div className="mb-3 flex gap-1.5 rounded-xl border border-border/60 bg-secondary/30 p-1">
              {[
                { id: "text" as const, label: "粘贴文本 / 十六进制" },
                { id: "file" as const, label: "上传文件" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setSource(tab.id)}
                  className={cn(
                    "flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                    source === tab.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {__ui(tab.label)}
                </button>
              ))}
            </div>

            {source === "text" ? (
              <>
                <Textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  placeholder={__ui("粘贴一段看起来像乱码的文字；也可以直接粘十六进制字节（如 E4 BD A0）")}
                  className="min-h-[180px] font-mono text-xs"
                />
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  {__ui("识别困难时的常见原因：文件保存所用的编码与读取时按的编码不一致。")}</p>
              </>
            ) : (
              <div className="space-y-3" data-furinakit-file-field>
                <input
                  ref={inputRef}
                  type="file"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) file.load(f);
                    e.target.value = "";
                  }}
                />
                <button
                  type="button"
                  onClick={() => inputRef.current?.click()}
                  className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-secondary/20 px-6 py-8 text-center transition-all hover:border-primary/50 hover:bg-secondary/40"
                >
                  <FileCode2 className="h-6 w-6 text-muted-foreground" />
                  <span className="text-sm font-medium">{file.bytes ? __ui("换一个文件") : __ui("点击选择文件")}</span>
                  <span className="text-[10px] text-muted-foreground">{__ui("支持 .txt / .csv / .json / .log 等文本类文件")}</span>
                </button>
                {file.bytes && (
                  <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-card px-3 py-2 text-xs">
                    <span className="min-w-0 flex-1 truncate font-medium text-foreground">{file.fileName}</span>
                    <span className="font-mono-accent text-[10px] text-muted-foreground">{__count(file.bytes.length, "字节")} </span>
                  </div>
                )}
              </div>
            )}

            <Button type="button" className="mt-3 w-full gap-1.5" onClick={() => void run()} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
              {busy ? __ui("检测中…") : __ui("开始检测编码")}
            </Button>
          </SectionCard>
        </div>

        {/* 右：结论 + 候选表 */}
        <div className="thin-scroll space-y-4 lg:col-span-7">
          {error && <ErrorBar message={__msg(error)} />}

          {!result && !error && (
            <SectionCard>
              <div className="flex flex-col items-center justify-center gap-2.5 py-16 text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <FileCode2 className="h-5 w-5" />
                </span>
                <p className="text-sm font-medium text-foreground">{__ui("粘贴内容或上传文件，这里会给出编码判定")}</p>
                <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
                  {__ui("会同时告诉你是哪种编码、有多可信，以及字节里的 BOM 与换行风格。")}</p>
              </div>
            </SectionCard>
          )}

          {result && (
            <>
              <SectionCard icon={<Lightbulb className="h-4 w-4" />} title={__ui("检测结论")}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-2xl font-bold text-primary">
                    {__ui(ENCODING_OPTIONS.find((e) => e.id === result.best?.encoding)?.label) || result.best?.encoding || __ui("未知")}
                  </span>
                  {result.best && (
                    <Badge variant="outline" className={confidence(result.best.score).cls}>
                      {__msg(confidence(result.best.score).text)}（{result.best.score} {__ui("分）")}</Badge>
                  )}
                </div>
                {result.best?.preview && (
                  <div className="mt-3 rounded-xl border border-border/60 bg-background/60 p-3">
                    <div className="mb-1 text-[11px] text-muted-foreground">{__ui("按这个编码读出来的开头：")}</div>
                    <p className="whitespace-pre-wrap break-all font-mono text-xs text-foreground">
                      {result.best.preview}
                    </p>
                  </div>
                )}
                <div className="mt-3 grid grid-cols-3 gap-2 text-[11.5px]">
                  <div className="rounded-lg border border-border/60 bg-secondary/20 px-3 py-2">
                    <div className="text-muted-foreground">{__ui("大小")}</div>
                    <div className="mt-0.5 font-mono-accent text-foreground">{__count(result.size, "字节")} </div>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-secondary/20 px-3 py-2">
                    <div className="text-muted-foreground">BOM</div>
                    <div className="mt-0.5 text-foreground">{result.bom || __ui("没有")}</div>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-secondary/20 px-3 py-2">
                    <div className="text-muted-foreground">{__ui("换行")}</div>
                    <div className="mt-0.5 text-foreground">{result.lineEnding}</div>
                  </div>
                </div>
              </SectionCard>

              <SectionCard icon={<Search className="h-4 w-4" />} title={__msg("候选编码对照（{0} 种）", result.candidates.length)}>
                <div className="overflow-hidden rounded-xl border border-border/70">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="bg-muted/60">
                        <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("编码")}</th>
                        <th className="px-3 py-2 text-right font-semibold text-foreground">{__ui("可信度")}</th>
                        <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("读出来的样子")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.candidates.map((c, i) => (
                        <tr key={c.encoding} className={cn("border-t border-border/40", i === 0 && "bg-primary/[0.06]")}>
                          <td className="whitespace-nowrap px-3 py-2 font-medium text-foreground">
                            {__ui(ENCODING_OPTIONS.find((e) => e.id === c.encoding)?.label) || __ui(c.label)}
                            {c.hadErrors && <span className="ml-1 text-[10px] text-destructive">{__ui("有非法字节")}</span>}
                          </td>
                          <td className={cn("whitespace-nowrap px-3 py-2 text-right font-mono-accent", confidence(c.score).cls)}>
                            {c.score}
                          </td>
                          <td className="max-w-[280px] truncate px-3 py-2 text-muted-foreground">{c.preview || __ui("（空）")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <ArrowRight className="h-3 w-3" />
                  {__ui("分数越高越可信。中文内容通常在 UTF-8 与 GBK 之间二选一，以能读出正常汉字者为准。")}</div>
              </SectionCard>

              <SectionCard icon={<FileCode2 className="h-4 w-4" />} title={__ui("字节开头（十六进制）")}>
                <p className="break-all rounded-xl border border-border/60 bg-background/60 p-3 font-mono text-[11.5px] text-muted-foreground">
                  {result.hexPreview}
                </p>
                <div className="mt-2 flex items-center justify-between">
                  <span className="text-[11px] text-muted-foreground">{__ui("前 48 个字节")}</span>
                  <CopyButton value={result.hexPreview} label={__ui("复制十六进制")} />
                </div>
              </SectionCard>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 工具二：乱码修复
// ══════════════════════════════════════════════════════════════════════

interface RepairItem {
  from: string;
  to: string;
  score: number;
  text: string;
}

const LABEL_OF: Record<string, string> = {
  "utf-8": "UTF-8",
  gb18030: "GBK / GB18030",
  big5: "Big5",
  shift_jis: "Shift_JIS",
  "euc-kr": "EUC-KR",
  "windows-1252": "Windows-1252",
};

export function EncodingRepairTool() {
  const __locale = __useLanguage();
  const [input, setInput] = useToolDraft("encoding-repair", "input", "");
  const [items, setItems] = useState<RepairItem[] | null>(null);
  const [picked, setPicked] = useState<string>("");
  const [damageNote, setDamageNote] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async () => {
    setError(null);
    setBusy(true);
    try {
      if (!input.trim()) throw new Error("请把乱码内容粘贴进来");
      const res = await fetch("/api/encoding/convert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "repair", text: input }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || "修复失败");
      setItems(json.candidates || []);
      setDamageNote(json.inputDamaged ? String(json.damageNote || "") : "");
      setPicked(json.candidates?.[0]?.text || "");
    } catch (err) {
      setItems(null);
      setDamageNote("");
      setError(err instanceof Error ? err.message : "修复失败");
    } finally {
      setBusy(false);
    }
  }, [input]);

  const sample = () => {
    // 这是"UTF-8 字节被当 GBK 读"的典型样子，修复后应当是「你好，世界！」
    setInput("浣犲ソ锛屼笘鐣岋紒");
    setItems(null);
    setDamageNote("");
  };

  const clearAll = () => {
    setInput("");
    setItems(null);
    setPicked("");
    setDamageNote("");
    setError(null);
  };

  const verdict = useMemo(() => {
    if (!items || items.length === 0) return null;
    const top = items[0];
    if (top.score >= 85) return { text: "分数最高者最可能为原文", ok: true };
    if (top.score >= 60) return { text: "可能是这个，请自己核对一下", ok: true };
    return { text: "未出现明显可信的结果，该内容可能并非由编码识别错误造成", ok: false };
  }, [items, __locale]);

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        {/* 左：乱码输入 */}
        <div className="thin-scroll space-y-4 lg:col-span-5">
          <SectionCard
            icon={<Wand2 className="h-4 w-4" />}
            title={__ui("粘贴乱码内容")}
            extra={
              <div className="flex items-center gap-1.5">
                <Button type="button" variant="outline" size="sm" onClick={sample}>
                  <Sparkles className="h-3.5 w-3.5" /> {__ui("填入示例")}</Button>
                <Button type="button" variant="ghost" size="sm" onClick={clearAll}>
                  <Eraser className="h-3.5 w-3.5" /> {__ui("清空")}</Button>
              </div>
            }
          >
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={__ui("例如：ä½ å¥½ ／ 浣犲ソ ／ ÊÀ½ç")}
              className="min-h-[200px] font-mono text-sm"
            />
            <Button type="button" className="mt-3 w-full gap-1.5" onClick={() => void run()} disabled={busy}>
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />}
              {busy ? __ui("正在修复…") : __ui("修复乱码")}
            </Button>
            <div className="mt-3 rounded-xl border border-border/60 bg-secondary/20 p-3">
              <div className="mb-1 flex items-center gap-1.5 text-[11.5px] font-medium text-foreground">
                <Lightbulb className="h-3.5 w-3.5 text-primary" /> {__ui("乱码是怎么来的")}</div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {__ui("原文以某种编码保存为字节，读取时却按另一种编码解释。字节本身并未损坏， 修复方式为：还原字节后按正确编码重新解码。")}</p>
            </div>
          </SectionCard>
        </div>

        {/* 右：候选结果 */}
        <div className="thin-scroll space-y-4 lg:col-span-7">
          {error && <ErrorBar message={__msg(error)} />}

          {!items && !error && (
            <SectionCard>
              <div className="flex flex-col items-center justify-center gap-2.5 py-16 text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Wand2 className="h-5 w-5" />
                </span>
                <p className="text-sm font-medium text-foreground">{__ui("粘贴乱码内容，此处将列出若干可能的原文")}</p>
                <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
                  {__ui("常见于：老网站、邮箱、下载的文本文件、别人发来的消息。")}</p>
              </div>
            </SectionCard>
          )}

          {items && (
            <>
              <SectionCard
                icon={<Check className="h-4 w-4" />}
                title={__msg("修复结果（{0} 个候选）", items.length)}
                extra={picked ? <CopyButton value={picked} label={__ui("复制选中的")} /> : undefined}
              >
                {verdict && (
                  <div
                    className={cn(
                      "mb-3 rounded-xl px-3 py-2 text-[12px]",
                      verdict.ok ? "bg-primary/10 text-primary" : "bg-secondary/40 text-muted-foreground",
                    )}
                  >
                    {__msg(verdict.text)}
                  </div>
                )}

                {/* 输入本身就已经缺字节时，明确说清楚，别让用户以为修好了 */}
                {damageNote && (
                  <div className="mb-3 flex items-start gap-2 rounded-xl border-l-4 border-l-amber-500 bg-amber-500/10 px-3 py-2 text-[12px] leading-relaxed text-foreground">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                    <span>{damageNote}</span>
                  </div>
                )}

                {items.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {__ui("未能得出更合理的结果，该内容可能并非由编码识别错误造成。")}</p>
                ) : (
                  <div className="space-y-2">
                    {items.map((it, i) => (
                      <button
                        key={`${it.from}-${it.to}-${i}`}
                        type="button"
                        onClick={() => setPicked(it.text)}
                        className={cn(
                          "w-full rounded-xl border px-3 py-2.5 text-left transition-colors",
                          picked === it.text
                            ? "border-primary/60 bg-primary/[0.07]"
                            : "border-border/60 bg-background/40 hover:border-primary/40 hover:bg-secondary/30",
                        )}
                      >
                        <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                          <span className="rounded bg-secondary/60 px-1.5 py-0.5 font-medium">
                            {LABEL_OF[it.from] || it.from}
                          </span>
                          <ArrowRight className="h-3 w-3" />
                          <span className="rounded bg-secondary/60 px-1.5 py-0.5 font-medium">{LABEL_OF[it.to] || it.to}</span>
                          <span className={cn("ml-auto font-mono-accent", it.score >= 85 ? "text-emerald-500" : "")}>
                            {it.score} {__ui("分")}</span>
                          {picked === it.text && <Check className="h-3.5 w-3.5 text-primary" />}
                        </div>
                        <p className="whitespace-pre-wrap break-all text-sm text-foreground">
                          {it.text || <span className="text-muted-foreground">{__ui("（空）")}</span>}
                        </p>
                      </button>
                    ))}
                  </div>
                )}
              </SectionCard>

              {picked && (
                <SectionCard icon={<Check className="h-4 w-4" />} title={__ui("选定结果")}>
                  <div className="rounded-xl border border-primary/25 bg-primary/[0.06] p-3">
                    <p className="whitespace-pre-wrap break-all text-sm text-foreground">{picked}</p>
                  </div>
                  <div className="mt-2 flex justify-end">
                    <CopyButton value={picked} label={__ui("复制修复结果")} />
                  </div>
                </SectionCard>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
