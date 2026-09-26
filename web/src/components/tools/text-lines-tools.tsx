"use client";
import { createUiText as __createUiText, useLanguage as __useLanguage, uiCount as __count } from "@/lib/language";
const __ui = __createUiText("components/tools/text-lines-tools.tsx");


/**
 * 文本行处理工具族（12 个入口，共用一套界面与实现）
 *
 * 设计要点：
 *  · 纯字符串运算，零依赖、零体积，输入一变结果立刻出来（不需要点按钮）；
 *  · 左输入右输出，选项在中间一行，符合「左文档右操作」的布局规范；
 *  · 每个操作都是独立工具入口，方便搜索（搜「去重」「排序」都能直接命中）。
 */

import { useMemo, useState } from "react";
import {
  AlignLeft, ArrowDownUp, Copy, Download, Eraser, Hash, ListOrdered, Plus,
  RotateCcw, Rows3, Scissors, Shuffle, Sigma, Sparkles, SplitSquareVertical,
} from "lucide-react";
import { Button, Input, Select } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useTheme } from "@/components/theme-provider";
import { useToolDraft } from "@/lib/use-tool-draft";
import { cn } from "@/lib/utils";

export type TextLinesKind =
  | "text-sort"
  | "text-dedupe"
  | "text-trim"
  | "text-affix"
  | "text-number"
  | "text-reverse"
  | "text-transpose"
  | "text-split-columns"
  | "text-regex-extract"
  | "text-join"
  | "text-case"
  | "text-stats";

const SAMPLE = `第三点，上手成本
第一点，这个工具能解决什么问题
第二点，它和同类软件相比好在哪里
第一点，这个工具能解决什么问题

工具太散，图片要开一个软件`;

/* ────────────────────────── 各种行处理实现 ────────────────────────── */

function splitLines(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n");
}

/** 冒泡以外的常见排序：字典序（可按数值、可忽略大小写）、按长度、随机 */
function sortLines(lines: string[], mode: string, ignoreCase: boolean): string[] {
  const key = (s: string) => (ignoreCase ? s.toLowerCase() : s);
  const arr = [...lines];
  switch (mode) {
    case "desc":
      return arr.sort((a, b) => key(b).localeCompare(key(a), "zh-Hans-CN"));
    case "numeric-asc":
      return arr.sort((a, b) => (parseFloat(a.replace(/[^\d.-]/g, "")) || 0) - (parseFloat(b.replace(/[^\d.-]/g, "")) || 0));
    case "numeric-desc":
      return arr.sort((a, b) => (parseFloat(b.replace(/[^\d.-]/g, "")) || 0) - (parseFloat(a.replace(/[^\d.-]/g, "")) || 0));
    case "length-asc":
      return arr.sort((a, b) => a.length - b.length);
    case "length-desc":
      return arr.sort((a, b) => b.length - a.length);
    case "shuffle": {
      const out = [...arr];
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    }
    default:
      return arr.sort((a, b) => key(a).localeCompare(key(b), "zh-Hans-CN"));
  }
}

/** 英文命名风格转换（做开发时最常用的一组） */
function toCase(text: string, mode: string): string {
  const words = text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_\-.]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
  switch (mode) {
    case "upper":
      return text.toUpperCase();
    case "lower":
      return text.toLowerCase();
    case "sentence":
      return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
    case "title":
      return text.replace(/\b\w/g, (c) => c.toUpperCase());
    case "camel":
      return words.map((w, i) => (i === 0 ? w : w.charAt(0).toUpperCase() + w.slice(1))).join("");
    case "pascal":
      return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
    case "snake":
      return words.join("_");
    case "kebab":
      return words.join("-");
    case "constant":
      return words.join("_").toUpperCase();
    default:
      return text;
  }
}

function numberingStart(value: string): number {
  const n = Number(value);
  return value.trim() !== "" && Number.isSafeInteger(n) ? n : 1;
}

function csvEscape(v: string, sep: string): string {
  return v.includes(sep) || v.includes('"') || v.includes("\n") ? `"${v.replace(/"/g, '""')}"` : v;
}

/**
 * 按 CSV 规则拆一行：引号内的分隔符不算分隔符，两个连续引号表示一个引号。
 * 直接 split(",") 会把 "甜,脆" 拆成两个字段，导出时又被二次转义成 \"\"\"甜\" 这种乱码。
 */
function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"' && cur.trim() === "") {
      inQuotes = true;
      cur = "";
    } else if (ch === sep) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

/* ────────────────────────── 界面 ────────────────────────── */

export function TextLinesTool() {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  const { toast } = useToast();
  const [kind, setKind] = useState<TextLinesKind>("text-sort");
  const [input, setInput] = useToolDraft("text-lines", "input", "");

  // 各工具自己的选项
  const [sortMode, setSortMode] = useState("asc");
  const [ignoreCase, setIgnoreCase] = useState(true);
  const [keepLast, setKeepLast] = useState(false);
  const [dropEmpty, setDropEmpty] = useState(true);
  /** 空行处理：remove 全部删除 / collapse 最多留一个 / keep 不动 */
  const [blankMode, setBlankMode] = useState("remove");
  const [prefix, setPrefix] = useState("");
  const [suffix, setSuffix] = useState("");
  const [numberFormat, setNumberFormat] = useState("{n}. ");
  const [numberStart, setNumberStart] = useState("1");
  const [delimiter, setDelimiter] = useState(",");
  const [outSep, setOutSep] = useState("csv");
  const [regex, setRegex] = useState("");
  const [regexGroup, setRegexGroup] = useState("1");
  const [regexMode, setRegexMode] = useState("group");
  const [joinWith, setJoinWith] = useState(" ");
  const [caseMode, setCaseMode] = useState("camel");

  const result = useMemo(() => {
    const raw = splitLines(input);
    const base = dropEmpty ? raw.filter((l) => l.trim() !== "") : raw;

    switch (kind) {
      case "text-sort":
        return sortLines(base, sortMode, ignoreCase).join("\n");

      case "text-dedupe": {
        const seen = new Map<string, number>();
        const key = (s: string) => (ignoreCase ? s.trim().toLowerCase() : s.trim());
        base.forEach((l, i) => seen.set(key(l), i));
        const lastIndex = seen;
        const firstSeen = new Set<string>();
        const out: string[] = [];
        base.forEach((l, i) => {
          const k = key(l);
          if (keepLast) {
            if (lastIndex.get(k) === i) out.push(l);
          } else if (!firstSeen.has(k)) {
            firstSeen.add(k);
            out.push(l);
          }
        });
        return out.join("\n");
      }

      case "text-trim": {
        const cleaned = splitLines(input)
          .map((l) => l.replace(/[ \t\u3000]+$/g, "").replace(/^[ \t\u3000]+/g, "").replace(/[ \t\u3000]{2,}/g, " "));
        if (blankMode === "keep") return cleaned.join("\n");
        if (blankMode === "collapse") {
          return cleaned.filter((l, i) => !(l === "" && (cleaned[i - 1] ?? "") === "")).join("\n").trim();
        }
        return cleaned.filter((l) => l !== "").join("\n");
      }

      case "text-affix": {
        const start = numberingStart(numberStart);
        return base
          .map((l, i) => {
            const n = start + i;
            return `${prefix.replace(/\{n\}/g, String(n))}${l}${suffix.replace(/\{n\}/g, String(n))}`;
          })
          .join("\n");
      }

      case "text-number": {
        const start = numberingStart(numberStart);
        const nums = numberFormat || "{n}. ";
        const padWidth = String(start + base.length - 1).length;
        return base
          .map((l, i) => {
            const n = start + i;
            const text = nums.replace(/\{n\}/g, (m) => (nums.includes("{n:0}") ? String(n).padStart(padWidth, "0") : String(n)));
            return text.replace("{n:0}", String(n).padStart(padWidth, "0")) + l;
          })
          .join("\n");
      }

      case "text-reverse":
        return [...base].reverse().join("\n");

      case "text-transpose": {
        const rows = base.map((l) => splitCsvLine(l, delimiter || ","));
        const cols = Math.max(0, ...rows.map((r) => r.length));
        const out: string[] = [];
        for (let c = 0; c < cols; c++) out.push(rows.map((r) => csvEscape(r[c] ?? "", delimiter || ",")).join(delimiter || ","));
        return out.join("\n");
      }

      case "text-split-columns": {
        const sep = outSep === "tsv" ? "\t" : ",";
        return base.map((l) => splitCsvLine(l, delimiter || ",").map((c) => csvEscape(c, sep)).join(sep)).join("\n");
      }

      case "text-regex-extract": {
        if (!regex.trim()) return "";
        let re: RegExp;
        let reFirst: RegExp;
        try {
          re = new RegExp(regex, "gm");
          // 取捕获组时不能用 g 标志：String.match 带 g 只返回整段匹配，拿不到括号里的内容
          reFirst = new RegExp(regex, "m");
        } catch (err) {
          return `正则表达式有误：${err instanceof Error ? err.message : ""}`;
        }
        if (regexMode === "match") {
          return base.map((l) => l.match(re)?.[0] ?? "").filter(Boolean).join("\n");
        }
        if (regexMode === "remove") {
          return base.map((l) => l.replace(re, "")).join("\n");
        }
        const gi = Math.max(0, Number(regexGroup) || 0);
        return base
          .map((l) => {
            const m = l.match(reFirst);
            if (!m) return "";
            return gi === 0 ? m[0] : (m[gi] ?? "");
          })
          .filter(Boolean)
          .join("\n");
      }

      case "text-join":
        return base.join(joinWith === "\\n" ? "\n" : joinWith);

      case "text-case":
        return base.map((l) => toCase(l, caseMode)).join("\n");

      case "text-stats": {
        const lines = base;
        const chars = input.length;
        const charsNoSpace = input.replace(/\s/g, "").length;
        const words = input.split(/[\s，。、；：！？,.;:!?()（）「」【】]+/).filter(Boolean);
        const uniq = new Set(lines.map((l) => l.trim().toLowerCase()));
        const freq = new Map<string, number>();
        // 中文按 2~4 字词组、英文按单词统计
        for (const w of words) {
          if (/^[\u4e00-\u9fa5]+$/.test(w)) {
            for (let n = 2; n <= 4; n++) {
              for (let i = 0; i + n <= w.length; i++) {
                const g = w.slice(i, i + n);
                freq.set(g, (freq.get(g) ?? 0) + 1);
              }
            }
          } else if (w.length > 1) {
            freq.set(w, (freq.get(w) ?? 0) + 1);
          }
        }
        const top = [...freq.entries()]
          .filter(([, c]) => c > 1)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20);
        const lens = lines.map((l) => l.length);
        const rows: [string, string][] = [
          ["总行数", String(splitLines(input).length)],
          ["非空行数", String(lines.length)],
          ["去重后行数", String(uniq.size)],
          ["字符数（含空格）", String(chars)],
          ["字符数（不含空格）", String(charsNoSpace)],
          ["词数", String(words.length)],
          ["最长行", String(lens.length ? Math.max(...lens) : 0)],
          ["最短行", String(lens.length ? Math.min(...lens) : 0)],
          ["平均行长", String(lens.length ? (lens.reduce((a, b) => a + b, 0) / lens.length).toFixed(1) : "0")],
          ["预计朗读时长", `${Math.max(1, Math.round(charsNoSpace / 240))} 分钟（按每分钟 240 字）`],
        ];
        const freqText = top.length ? `\n\n高频词组（出现 2 次以上，Top 20）\n${top.map(([w, c]) => `${w}\t${c}`).join("\n")}` : "";
        return rows.map(([k, v]) => `${k}：${v}`).join("\n") + freqText;
      }

      default:
        return "";
    }
  }, [kind, input, sortMode, ignoreCase, keepLast, dropEmpty, blankMode, prefix, suffix, numberFormat, numberStart, delimiter, outSep, regex, regexGroup, regexMode, joinWith, caseMode, __locale]);

  const lines = splitLines(input);
  const outLines = result ? splitLines(result) : [];

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result);
      toast({ title: "已复制结果", variant: "success" });
    } catch {
      toast({ title: "复制失败", variant: "error" });
    }
  };

  const download = () => {
    const blob = new Blob([result], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `文本处理-${Date.now()}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };

  /* 选项区：按工具显示不同选项 */
  const options = (
    <div className="flex flex-wrap items-end gap-3">
      {kind === "text-sort" && (
        <>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium" style={{ color: colors.muted }}>{__ui("排序方式")}</span>
            <Select value={sortMode} onChange={(e) => setSortMode(e.target.value)} className="w-44">
              <option value="asc">{__ui("字典序 升序")}</option>
              <option value="desc">{__ui("字典序 降序")}</option>
              <option value="numeric-asc">{__ui("按数字 升序")}</option>
              <option value="numeric-desc">{__ui("按数字 降序")}</option>
              <option value="length-asc">{__ui("按行长 升序")}</option>
              <option value="length-desc">{__ui("按行长 降序")}</option>
              <option value="shuffle">{__ui("随机打乱")}</option>
            </Select>
          </label>
          <Switch label={__ui("忽略大小写")} value={ignoreCase} onChange={setIgnoreCase} colors={colors} />
        </>
      )}

      {kind === "text-dedupe" && (
        <>
          <Switch label={__ui("保留最后一条")} value={keepLast} onChange={setKeepLast} colors={colors} />
          <Switch label={__ui("忽略大小写")} value={ignoreCase} onChange={setIgnoreCase} colors={colors} />
        </>
      )}

      {kind === "text-affix" && (
        <>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium" style={{ color: colors.muted }}>{__ui("每行前缀")}</span>
            <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder={__ui("例如 - 或 {n}. ")} className="w-44" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium" style={{ color: colors.muted }}>{__ui("每行后缀")}</span>
            <Input value={suffix} onChange={(e) => setSuffix(e.target.value)} placeholder={__ui("例如 ；")} className="w-44" />
          </label>
          <p className="text-[11.5px]" style={{ color: colors.muted }}>{__ui("用")}{"{n}"} {__ui("表示行号")}</p>
        </>
      )}

      {kind === "text-number" && (
        <>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium" style={{ color: colors.muted }}>{__ui("编号格式")}</span>
            <Input value={numberFormat} onChange={(e) => setNumberFormat(e.target.value)} placeholder={__ui("例如 {n}. 或 ({n}) ")} className="w-40" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium" style={{ color: colors.muted }}>{__ui("起始编号")}</span>
            <Input type="number" value={numberStart} onChange={(e) => setNumberStart(e.target.value)} className="w-24" />
          </label>
        </>
      )}

      {(kind === "text-transpose" || kind === "text-split-columns") && (
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium" style={{ color: colors.muted }}>{__ui("原分隔符")}</span>
          <Select value={delimiter} onChange={(e) => setDelimiter(e.target.value)} className="w-36">
            <option value=",">{__ui("英文逗号 ,")}</option>
            <option value="，">{__ui("中文逗号 ，")}</option>
            <option value="\t">{__ui("制表符 Tab")}</option>
            <option value="|">{__ui("竖线 |")}</option>
            <option value=" ">{__ui("空格")}</option>
            <option value=";">{__ui("分号 ;")}</option>
          </Select>
        </label>
      )}

      {kind === "text-split-columns" && (
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium" style={{ color: colors.muted }}>{__ui("输出格式")}</span>
          <Select value={outSep} onChange={(e) => setOutSep(e.target.value)} className="w-36">
            <option value="csv">{__ui("CSV（可直接给 Excel）")}</option>
            <option value="tsv">{__ui("TSV（制表符）")}</option>
          </Select>
        </label>
      )}

      {kind === "text-regex-extract" && (
        <>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium" style={{ color: colors.muted }}>{__ui("正则表达式")}</span>
            <Input value={regex} onChange={(e) => setRegex(e.target.value)} placeholder={__ui("例如 电话：(1\\d{10})")} className="w-64 font-mono text-[12px]" />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium" style={{ color: colors.muted }}>{__ui("处理方式")}</span>
            <Select value={regexMode} onChange={(e) => setRegexMode(e.target.value)} className="w-36">
              <option value="group">{__ui("只留第 N 个括号里的内容")}</option>
              <option value="match">{__ui("只留匹配到的部分")}</option>
              <option value="remove">{__ui("删掉匹配到的部分")}</option>
            </Select>
          </label>
          {regexMode === "group" && (
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium" style={{ color: colors.muted }}>{__ui("第几个括号")}</span>
              <Input type="number" min={1} value={regexGroup} onChange={(e) => setRegexGroup(e.target.value)} className="w-20" />
            </label>
          )}
        </>
      )}

      {kind === "text-join" && (
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium" style={{ color: colors.muted }}>{__ui("连接符")}</span>
          <Select value={joinWith} onChange={(e) => setJoinWith(e.target.value)} className="w-40">
            <option value=" ">{__ui("空格")}</option>
            <option value=",">{__ui("英文逗号 ,")}</option>
            <option value="，">{__ui("中文逗号 ，")}</option>
            <option value="\n">{__ui("换行（等于不合并）")}</option>
            <option value="|">{__ui("竖线 |")}</option>
            <option value="、">{__ui("顿号 、")}</option>
          </Select>
        </label>
      )}

      {kind === "text-trim" && (
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium" style={{ color: colors.muted }}>{__ui("空行处理")}</span>
          <Select value={blankMode} onChange={(e) => setBlankMode(e.target.value)} className="w-40">
            <option value="remove">{__ui("全部删除")}</option>
            <option value="collapse">{__ui("最多保留一个空行")}</option>
            <option value="keep">{__ui("保留全部空行")}</option>
          </Select>
        </label>
      )}

      {kind === "text-case" && (
        <label className="flex flex-col gap-1.5">
          <span className="text-[12px] font-medium" style={{ color: colors.muted }}>{__ui("转换方式")}</span>
          <Select value={caseMode} onChange={(e) => setCaseMode(e.target.value)} className="w-52">
            <option value="camel">{__ui("小驼峰 camelCase")}</option>
            <option value="pascal">{__ui("大驼峰 PascalCase")}</option>
            <option value="snake">{__ui("下划线 snake_case")}</option>
            <option value="kebab">{__ui("中划线 kebab-case")}</option>
            <option value="constant">{__ui("常量 CONSTANT_CASE")}</option>
            <option value="upper">{__ui("全部大写")}</option>
            <option value="lower">{__ui("全部小写")}</option>
            <option value="sentence">{__ui("句首大写")}</option>
            <option value="title">{__ui("每词首字母大写")}</option>
          </Select>
        </label>
      )}

      {(kind === "text-sort" || kind === "text-dedupe" || kind === "text-reverse" || kind === "text-transpose" ||
        kind === "text-split-columns" || kind === "text-regex-extract" || kind === "text-join" || kind === "text-case") && (
        <Switch label={__ui("去掉空行")} value={dropEmpty} onChange={setDropEmpty} colors={colors} />
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {/* 操作切换：12 个操作都在这一页，切换时输入内容保持不变 */}
      <section className="rounded-2xl border p-4" style={{ borderColor: colors.borderSolid, background: colors.card }}>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(TEXT_LINES_LABELS) as TextLinesKind[]).map((k) => {
            const Icon = TEXT_LINES_ICONS[k];
            const active = k === kind;
            return (
              <button
                key={k}
                onClick={() => setKind(k)}
                className="flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[12.5px] font-medium transition-all"
                style={{
                  borderColor: active ? "hsl(var(--primary))" : colors.borderSolid,
                  background: active ? colors.active : "transparent",
                  color: colors.text,
                }}
              >
                <Icon size={13} />
                {__ui(TEXT_LINES_LABELS[k])}
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
        {options}
        <div className="mt-4 flex flex-wrap items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setInput(SAMPLE)}
          >
            <Sparkles size={13} /> {__ui("填入示例")}</Button>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setInput("")}>
            <Eraser size={13} /> {__ui("清空")}</Button>
          <span className="text-[11.5px]" style={{ color: colors.muted }}>
            {__ui("输入即处理，不需要点按钮 · 内容只在本机处理")}</span>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="flex min-w-0 flex-col rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
          <header className="mb-2.5 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-[13.5px] font-semibold" style={{ color: colors.text }}>
              <AlignLeft size={15} /> {__ui("输入")}</h2>
            <span className="text-[11.5px]" style={{ color: colors.muted }}>{lines.length} {__ui("行 ·")}{input.length} {__ui("字")}</span>
          </header>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={__ui("把要处理的文本粘进来，每行一条")}
            className="h-80 w-full resize-y rounded-xl border p-3.5 text-[13px] leading-relaxed focus:outline-none"
            style={{ borderColor: colors.borderSolid, background: colors.bg, color: colors.text }}
          />
        </section>

        <section className="flex min-w-0 flex-col rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
          <header className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-[13.5px] font-semibold" style={{ color: colors.text }}>
              <Hash size={15} /> {__ui("结果")}<span className="text-[11.5px] font-normal" style={{ color: colors.muted }}>{__count(outLines.length, "行")} </span>
            </h2>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void copy()} disabled={!result}>
                <Copy size={13} /> {__ui("复制")}</Button>
              <Button size="sm" variant="outline" className="gap-1.5" onClick={download} disabled={!result}>
                <Download size={13} /> {__ui("下载")}</Button>
            </div>
          </header>
          <textarea
            value={result}
            readOnly
            placeholder={__ui("处理结果会显示在这里")}
            className="h-80 w-full resize-y rounded-xl border p-3.5 font-mono text-[12.5px] leading-relaxed focus:outline-none"
            style={{ borderColor: colors.borderSolid, background: colors.bg, color: colors.text }}
          />
        </section>
      </div>
    </div>
  );
}

function Switch({
  label,
  value,
  onChange,
  colors,
}: {
  label: string;
  value: boolean;
  onChange: (v: boolean) => void;
  colors: Record<string, string>;
}) {
  const __locale = __useLanguage();
  return (
    <label className="flex cursor-pointer items-center gap-2 pb-2">
      <button
        type="button"
        onClick={() => onChange(!value)}
        className="relative h-5 w-9 shrink-0 rounded-full transition-colors"
        style={{ background: value ? "hsl(var(--primary))" : colors.btnHover }}
      >
        <span className="absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all" style={{ left: value ? 18 : 2 }} />
      </button>
      <span className="text-[12.5px]" style={{ color: colors.text }}>{__ui(label)}</span>
    </label>
  );
}

/** 操作清单与图标（工具箱里切换用） */
export const TEXT_LINES_ICONS: Record<TextLinesKind, typeof ArrowDownUp> = {
  "text-sort": ArrowDownUp,
  "text-dedupe": Copy,
  "text-trim": Eraser,
  "text-affix": Plus,
  "text-number": ListOrdered,
  "text-reverse": RotateCcw,
  "text-transpose": SplitSquareVertical,
  "text-split-columns": Rows3,
  "text-regex-extract": Scissors,
  "text-join": AlignLeft,
  "text-case": Sparkles,
  "text-stats": Sigma,
};

export const TEXT_LINES_LABELS: Record<TextLinesKind, string> = {
  "text-sort": "行排序",
  "text-dedupe": "行去重",
  "text-trim": "清理空行",
  "text-affix": "批量加前后缀",
  "text-number": "批量加行号",
  "text-reverse": "行序反转",
  "text-transpose": "行列互换",
  "text-split-columns": "拆列导出",
  "text-regex-extract": "正则提取",
  "text-join": "多行合并",
  "text-case": "命名风格转换",
  "text-stats": "文本统计",
};
