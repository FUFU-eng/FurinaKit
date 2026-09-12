"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FileDown,
  FileSpreadsheet,
  FileText,
  FileUp,
  Flag,
  ImageDown,
  Info,
  Loader2,
  Music,
  RefreshCw,
  Scissors,
  Sparkles,
  Table2,
  Timer,
  Trash2,
  Wand2,
  XCircle,
} from "lucide-react";
import {
  Badge,
  Button,
  Input,
  Label,
  ProgressBar,
  Textarea,
} from "@/components/ui/primitives";
import { FileDropzone } from "@/components/tools/file-dropzone";
import { useToast } from "@/components/ui/toast";
import { useToolDraft } from "@/lib/use-tool-draft";
import { cn, formatBytes } from "@/lib/utils";

/* ============================================================================
 * PURE LOGIC ZONE START
 *
 * 下面这一段里只有纯函数：没有 React、没有 JSX、不碰 DOM、不引用上面的导入。
 * 所以它可以被原样切出来丢进一个 .ts 文件里跑单元测试（验收用的测试脚本就是
 * 从这对标记之间把这段代码抽出来单独执行的）。改动这里之后请重跑那份测试。
 * ========================================================================== */

/* ---------------------------------------------------------------- 时间码 */

/**
 * 把用户写的时间码解析成秒，认这几种写法：
 *   `10` `10.5`（秒）、`00:10`（分:秒）、`00:00:10`（时:分:秒）、`00:00:10.5`（带小数）。
 * 返回 null 表示「看不懂」：空串、非数字、多过三段、小数出现在非末段、
 * 或者分/秒位 ≥ 60（`00:90` 这种写法是有歧义的，宁可让人改清楚）。
 */
function parseTimecode(raw: string): number | null {
  const text = raw.trim();
  if (text === "") return null;

  const parts = text.split(":");
  if (parts.length === 0 || parts.length > 3) return null;

  let total = 0;
  for (let index = 0; index < parts.length; index++) {
    const part = parts[index].trim();
    if (!/^\d+(?:\.\d+)?$/.test(part)) return null;
    const value = Number(part);
    if (!Number.isFinite(value)) return null;
    // 小数只允许出现在最后一段（时/分位带小数没有意义）
    if (index < parts.length - 1 && part.includes(".")) return null;
    // 除最高位之外，其余各段必须小于 60
    if (parts.length > 1 && index > 0 && value >= 60) return null;
    total = total * 60 + value;
  }
  return total;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/** 秒 → `MM:SS`；超过一小时用 `H:MM:SS`（不然会出现 `120:00` 这种读不出来的写法）。 */
function formatClock(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return hours > 0 ? `${hours}:${pad2(minutes)}:${pad2(secs)}` : `${pad2(minutes)}:${pad2(secs)}`;
}

/** 秒 → `MM:SS.d`（带一位小数）：给「用当前播放位置」这种按钮填值用。 */
function formatClockTenths(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const total = Math.floor(safe);
  const tenth = Math.min(9, Math.round((safe - total) * 10));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  const head = hours > 0 ? `${hours}:${pad2(minutes)}:${pad2(secs)}` : `${pad2(minutes)}:${pad2(secs)}`;
  return `${head}.${tenth}`;
}

/** 「12.5 秒」这种给人看的秒数：整数就不带小数点。 */
function formatSeconds(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  const rounded = Math.round(seconds * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded} 秒` : `${rounded.toFixed(1)} 秒`;
}

type TrimRangeAnalysis = {
  /** 起点秒数；null = 还没填对 */
  start: number | null;
  /** 终点秒数；null = 留空（裁到结尾）或没填对 */
  end: number | null;
  /** 截取时长；两端都解析出来才算得出来 */
  seconds: number | null;
  /** 拦下来的问题（起点 ≥ 终点这种），有值时不应该提交 */
  error: string | null;
  /** 不拦、只提醒（终点超过总长） */
  warning: string | null;
};

/**
 * 起止时间的实时分析：给内联提示用。
 * `mediaDuration` 是媒体元素报出来的总时长，未知时传 null（此时不做越界判断）。
 */
function analyzeTrimRange(
  startText: string,
  endText: string,
  mediaDuration: number | null,
): TrimRangeAnalysis {
  const empty: TrimRangeAnalysis = {
    start: null,
    end: null,
    seconds: null,
    error: null,
    warning: null,
  };

  const startRaw = startText.trim();
  const endRaw = endText.trim();

  if (startRaw === "") {
    return { ...empty, error: "请填起点时间，可以写 10、00:10 或 00:00:10.5。" };
  }

  const start = parseTimecode(startRaw);
  if (start === null) {
    return { ...empty, error: "起点时间看不懂，可以写 10、00:10 或 00:00:10.5。" };
  }

  let end: number | null = null;
  if (endRaw !== "") {
    end = parseTimecode(endRaw);
    if (end === null) {
      return { ...empty, start, error: "终点时间看不懂，可以写 00:30、00:00:30 或 00:00:30.5。" };
    }
    if (end <= start) {
      return {
        ...empty,
        start,
        end,
        seconds: 0,
        error: `终点必须晚于起点，现在两端相差 ${formatSeconds(Math.max(0, end - start))}。`,
      };
    }
  }

  let warning: string | null = null;
  if (mediaDuration !== null && mediaDuration > 0) {
    if (start >= mediaDuration) {
      return {
        ...empty,
        start,
        end,
        error: `起点已经超出了总长（${formatClock(mediaDuration)}）。`,
      };
    }
    if (end !== null && end > mediaDuration) {
      warning = `终点超过了总长 ${formatClock(mediaDuration)}，超出的一段会被忽略。`;
    }
  }

  const seconds = end === null ? (mediaDuration !== null && mediaDuration > 0 ? mediaDuration - start : null) : end - start;

  return { start, end, seconds, error: null, warning };
}

/* ------------------------------------------------------------------ CSV */

const CSV_DELIMITERS: Array<{ value: string; label: string }> = [
  { value: ",", label: "逗号 ," },
  { value: "\t", label: "制表符 Tab" },
  { value: ";", label: "分号 ;" },
  { value: "|", label: "竖线 |" },
];

function delimiterLabel(delimiter: string): string {
  if (delimiter === "\t") return "制表符";
  if (delimiter === ",") return "逗号";
  if (delimiter === ";") return "分号";
  if (delimiter === "|") return "竖线";
  return delimiter;
}

function linesOf(source: string): string[] {
  return source.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
}

function leadingSpaces(text: string): number {
  const matched = /^[ \t]*/.exec(text);
  return matched === null ? 0 : matched[0].length;
}

/** 数一行里有多少个「不在引号内」的分隔符。 */
function countOutsideQuotes(line: string, delimiter: string): number {
  let count = 0;
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i++;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (!inQuotes && char === delimiter) count++;
  }
  return count;
}

/** 自动探测分隔符：谁让前几行的列数最多、最稳定，就选谁。 */
function detectDelimiter(source: string): string {
  const lines = linesOf(source)
    .filter((line) => line.trim() !== "")
    .slice(0, 5);
  if (lines.length === 0) return ",";

  let best = ",";
  let bestScore = -1;
  for (const candidate of CSV_DELIMITERS) {
    const counts = lines.map((line) => countOutsideQuotes(line, candidate.value));
    const total = counts.reduce((sum, n) => sum + n, 0);
    if (total === 0) continue;
    const consistent = counts.every((n) => n === counts[0]);
    const score = total + (consistent ? 10 : 0);
    if (score > bestScore) {
      bestScore = score;
      best = candidate.value;
    }
  }
  return best;
}

type CsvTable = { rows: string[][]; warnings: string[] };

/**
 * 标准 CSV 解析：引号内的分隔符、换行、以及 `""` 转义的引号都按规范处理。
 * 列数不一致的行补空单元格并给一条提示，避免预览和实际转换结果对不上。
 */
function parseCsvTable(source: string, delimiter: string): CsvTable {
  const src = source.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const rows: string[][] = [];
  const warnings: string[] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldStartLine = 1;
  let line = 1;
  let i = 0;

  while (i < src.length) {
    const char = src[i];

    if (inQuotes) {
      if (char === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      if (char === "\n") line++;
      field += char;
      i++;
      continue;
    }

    if (char === '"' && field === "") {
      inQuotes = true;
      fieldStartLine = line;
      i++;
      continue;
    }
    if (char === delimiter) {
      row.push(field);
      field = "";
      i++;
      continue;
    }
    if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      line++;
      fieldStartLine = line;
      i++;
      continue;
    }
    field += char;
    i++;
  }

  if (inQuotes) {
    warnings.push(`第 ${fieldStartLine} 行有个引号没有闭合，已经按「一直到最后」处理。`);
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  while (rows.length > 0 && rows[rows.length - 1].every((cell) => cell.trim() === "")) {
    rows.pop();
  }

  const width = rows.reduce((max, current) => Math.max(max, current.length), 0);
  rows.forEach((current, index) => {
    if (current.length < width && current.length > 0) {
      warnings.push(`第 ${index + 1} 行只有 ${current.length} 列（其它行是 ${width} 列），已经补上空单元格。`);
      while (current.length < width) current.push("");
    }
  });

  return { rows, warnings };
}

/** 某一列是不是整列都是数字（数字列右对齐，看表格的时候更顺眼）。 */
function numericColumnFlags(rows: string[][], hasHeader: boolean): boolean[] {
  const columns = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const start = hasHeader ? 1 : 0;
  const flags: boolean[] = [];
  for (let column = 0; column < columns; column++) {
    let seen = 0;
    let allNumeric = true;
    for (let row = start; row < rows.length; row++) {
      const value = (rows[row][column] ?? "").trim();
      if (value === "") continue;
      seen++;
      if (!/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(value)) {
        allNumeric = false;
        break;
      }
    }
    flags.push(allNumeric && seen > 0);
  }
  return flags;
}

/* ------------------------------------------------------------- Markdown */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** 链接只允许这些协议，别的（例如 javascript:）一律退化成纯文本，避免点到就执行脚本。 */
function safeHref(href: string): string | null {
  const trimmed = href.trim();
  if (trimmed === "") return null;
  if (/^(https?:|mailto:|tel:)/i.test(trimmed)) return trimmed;
  if (
    trimmed.startsWith("#") ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../")
  ) {
    return trimmed;
  }
  return null;
}

/**
 * 行内标记：先转义 HTML，再套自己的标签 —— 顺序很关键。
 * 用户输入里的 < > & " 在第一步就变成实体，后面无论怎么替换都拼不出可执行标签。
 * 行内代码先抽成占位符，避免里面的 ** 之类被当成标记。
 */
function renderMarkdownInline(raw: string): string {
  const codes: string[] = [];
  const withPlaceholders = raw.replace(/`([^`]+)`/g, (_whole, code: string) => {
    codes.push(`<code>${escapeHtml(code)}</code>`);
    return `\u0000${codes.length - 1}\u0000`;
  });

  let text = escapeHtml(withPlaceholders);

  text = text.replace(/\[([^\]]*)\]\(([^)\s]*)\)/g, (_whole, label: string, href: string) => {
    const safe = safeHref(href);
    if (safe === null) return `[${label}](${href})`;
    return `<a href="${safe}" target="_blank" rel="noreferrer noopener">${label}</a>`;
  });

  text = text.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  text = text.replace(/__([^_]+)__/g, "<strong>$1</strong>");
  text = text.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  text = text.replace(/(^|[^_\w])_([^_\n]+)_/g, "$1<em>$2</em>");

  text = text.replace(/\u0000(\d+)\u0000/g, (_whole, index: string) => codes[Number(index)] ?? "");

  return text;
}

type MarkdownListEntry = { indent: number; ordered: boolean; text: string };
type MarkdownListNode = { ordered: boolean; items: Array<{ text: string; sub: MarkdownListNode | null }> };

function buildMarkdownList(entries: MarkdownListEntry[]): MarkdownListNode {
  const root: MarkdownListNode = { ordered: entries[0]?.ordered ?? false, items: [] };
  const stack: Array<{ indent: number; node: MarkdownListNode }> = [{ indent: -1, node: root }];

  for (const entry of entries) {
    while (stack.length > 1 && entry.indent < stack[stack.length - 1].indent) stack.pop();
    let top = stack[stack.length - 1];

    if (entry.indent > top.indent) {
      if (top.node.items.length > 0) {
        const last = top.node.items[top.node.items.length - 1];
        const child: MarkdownListNode = { ordered: entry.ordered, items: [] };
        last.sub = child;
        stack.push({ indent: entry.indent, node: child });
        top = stack[stack.length - 1];
      } else {
        root.ordered = entry.ordered;
        stack[stack.length - 1] = { indent: entry.indent, node: root };
        top = stack[stack.length - 1];
      }
    }

    top.node.items.push({ text: entry.text, sub: null });
  }

  return root;
}

function renderMarkdownList(node: MarkdownListNode): string {
  const tag = node.ordered ? "ol" : "ul";
  const items = node.items
    .map((item) => `<li>${renderMarkdownInline(item.text)}${item.sub ? renderMarkdownList(item.sub) : ""}</li>`)
    .join("");
  return `<${tag}>${items}</${tag}>`;
}

const MARKDOWN_LIST_ITEM = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const MARKDOWN_HEADING = /^(#{1,6})\s+(.*)$/;
const MARKDOWN_FENCE = /^```\s*([A-Za-z0-9_+-]*)\s*$/;
const MARKDOWN_HR = /^(?:\*\s*){3,}$|^(?:-\s*){3,}$|^(?:_\s*){3,}$/;
const MARKDOWN_TABLE_SEPARATOR = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

function isMarkdownBlockStart(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed === "") return true;
  if (MARKDOWN_HEADING.test(trimmed)) return true;
  if (MARKDOWN_FENCE.test(trimmed)) return true;
  if (MARKDOWN_HR.test(trimmed)) return true;
  if (trimmed.startsWith(">")) return true;
  if (MARKDOWN_LIST_ITEM.test(line)) return true;
  return false;
}

function splitMarkdownTableRow(line: string): string[] {
  const trimmed = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.trim());
}

function isMarkdownTableAt(lines: string[], index: number): boolean {
  if (index + 1 >= lines.length) return false;
  if (!lines[index].includes("|")) return false;
  return MARKDOWN_TABLE_SEPARATOR.test(lines[index + 1]) && lines[index + 1].includes("-");
}

function renderMarkdownTableAlignment(separatorCell: string): string {
  const left = separatorCell.startsWith(":");
  const right = separatorCell.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  return "left";
}

/**
 * 够用就好的一套 Markdown 渲染：标题 / 粗体 / 斜体 / 行内代码 / 列表（可嵌套）/
 * 引用 / 代码块 / 表格 / 分割线 / 链接。
 *
 * 安全前提：所有用户文本在拼进 HTML 之前都先过 escapeHtml，输出里不可能出现用户写的
 * 标签，也不存在 img / iframe / 事件属性这类通道 —— 所以 XSS 在这条路径上不成立。
 * 新增语法时请沿用这个顺序（先转义、再套自己的标签），不要放宽 safeHref 的白名单。
 */
function renderMarkdown(source: string): string {
  const lines = linesOf(source);
  const out: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") {
      i++;
      continue;
    }

    const fence = MARKDOWN_FENCE.exec(trimmed);
    if (fence !== null) {
      const language = fence[1];
      const body: string[] = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
        body.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      const cls = language !== "" ? ` class="language-${escapeHtml(language)}"` : "";
      out.push(`<pre><code${cls}>${escapeHtml(body.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = MARKDOWN_HEADING.exec(trimmed);
    if (heading !== null) {
      const level = heading[1].length;
      out.push(`<h${level}>${renderMarkdownInline(heading[2])}</h${level}>`);
      i++;
      continue;
    }

    if (MARKDOWN_HR.test(trimmed)) {
      out.push("<hr />");
      i++;
      continue;
    }

    if (isMarkdownTableAt(lines, i)) {
      const headerCells = splitMarkdownTableRow(lines[i]);
      const separatorCells = splitMarkdownTableRow(lines[i + 1]);
      const aligns = headerCells.map((_cell, index) =>
        renderMarkdownTableAlignment(separatorCells[index] ?? "---"),
      );
      i += 2;
      const bodyRows: string[][] = [];
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        bodyRows.push(splitMarkdownTableRow(lines[i]));
        i++;
      }
      const head = headerCells
        .map((cell, index) => `<th style="text-align:${aligns[index]}">${renderMarkdownInline(cell)}</th>`)
        .join("");
      const body = bodyRows
        .map(
          (row) =>
            `<tr>${headerCells
              .map(
                (_cell, index) =>
                  `<td style="text-align:${aligns[index]}">${renderMarkdownInline(row[index] ?? "")}</td>`,
              )
              .join("")}</tr>`,
        )
        .join("");
      out.push(`<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`);
      continue;
    }

    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
        i++;
      }
      out.push(`<blockquote>${renderMarkdown(quoteLines.join("\n"))}</blockquote>`);
      continue;
    }

    if (MARKDOWN_LIST_ITEM.test(line)) {
      const entries: MarkdownListEntry[] = [];
      while (i < lines.length) {
        const candidate = lines[i];
        if (candidate.trim() === "") {
          // 空行后面还是列表项（或缩进的续行）才算同一个列表
          const next = lines[i + 1] ?? "";
          if (MARKDOWN_LIST_ITEM.test(next) || (next.trim() !== "" && leadingSpaces(next) > 0)) {
            i++;
            continue;
          }
          break;
        }
        const item = MARKDOWN_LIST_ITEM.exec(candidate);
        if (item !== null) {
          entries.push({
            indent: item[1].length,
            ordered: /\d/.test(item[2]),
            text: item[3],
          });
          i++;
          continue;
        }
        if (leadingSpaces(candidate) > 0 && entries.length > 0) {
          entries[entries.length - 1].text += ` ${candidate.trim()}`;
          i++;
          continue;
        }
        break;
      }
      out.push(renderMarkdownList(buildMarkdownList(entries)));
      continue;
    }

    const paragraph: string[] = [];
    while (i < lines.length && !isMarkdownBlockStart(lines[i])) {
      paragraph.push(lines[i].trim());
      i++;
    }
    if (paragraph.length === 0) {
      paragraph.push(trimmed);
      i++;
    }
    out.push(`<p>${paragraph.map((part) => renderMarkdownInline(part)).join("<br />")}</p>`);
  }

  return out.join("\n");
}

/** 文档标题：第一个标题，没有标题就用第一行非空文本（截 40 字）。 */
function markdownTitle(source: string): string {
  const lines = linesOf(source);
  for (const line of lines) {
    const heading = MARKDOWN_HEADING.exec(line.trim());
    if (heading !== null) return heading[2].trim();
  }
  for (const line of lines) {
    if (line.trim() !== "") return line.trim().slice(0, 40);
  }
  return "";
}

/** 字数统计：中文按字算，英文/数字按词算。 */
function docStats(source: string): { lines: number; chars: number; words: number; headings: number } {
  const lines = source === "" ? 0 : linesOf(source).length;
  const chars = source.replace(/\s/g, "").length;
  const cjk = source.match(/[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff]/g)?.length ?? 0;
  const latin = source.match(/[A-Za-z0-9][A-Za-z0-9'’-]*/g)?.length ?? 0;
  const headings = linesOf(source).filter((line) => /^#{1,6}\s/.test(line.trim())).length;
  return { lines, chars, words: cjk + latin, headings };
}

/* ============================================================================
 * PURE LOGIC ZONE END
 * ========================================================================== */

/* ------------------------------------------------------- 异步任务：提交与轮询 */

type ToolJobStatus = "pending" | "processing" | "completed" | "failed";

type ToolJob = {
  id: string;
  status: ToolJobStatus;
  progress: number;
  message: string;
  resultFilename?: string;
  error?: string;
};

/** 轮询间隔与「连续失败多少次就放弃」——放着不管的定时器是这套东西最容易出的事故。 */
const POLL_INTERVAL_MS = 1200;
const POLL_RETRY_MS = 2500;
const MAX_POLL_FAILURES = 10;

type AsyncJob = {
  job: ToolJob | null;
  error: string | null;
  submitting: boolean;
  running: boolean;
  /** 手上还有一个可以继续查询的任务编号（提交阶段就失败时为 false，此时没有可重试的对象） */
  canRetry: boolean;
  submit: (body: FormData) => Promise<boolean>;
  reset: () => void;
  retryPolling: () => void;
};

/**
 * 提交 → 轮询 → 终态停机的完整流程。
 *
 * 关于「轮询停不下来」这个坑，这里有三道闸：
 *   ① 任务进入 completed / failed 之后不再排下一次定时器（终态 return，等于停机）；
 *   ② 组件卸载（切工具、回首页）时 aliveRef 置 false 并清掉当前定时器，
 *      已经在飞的那个请求回来后发现 jobIdRef 对不上就直接丢弃，不会重新起定时器；
 *   ③ 重新提交 / 清空 / 换任务时先按 jobId 作废旧轮询（jobIdRef 一换，旧的回调自然失效），
 *      并且 pollingRef 保证同一个任务只有一条轮询链（挂载接回旧任务时不会起两条）。
 * 另外网络连续失败 MAX_POLL_FAILURES 次就停下来并把「重新查询」交给用户，
 * 而不是无限重试刷接口。
 */
function useAsyncJob(toolId: string): AsyncJob {
  const [job, setJob] = useState<ToolJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aliveRef = useRef(true);
  const failuresRef = useRef(0);
  const jobIdRef = useRef<string | null>(null);
  /** 当前正在轮询的任务编号；已有链在跑同一个任务时不再另起一条 */
  const pollingRef = useRef<string | null>(null);

  const stopPolling = useCallback(() => {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    pollingRef.current = null;
  }, []);

  useEffect(() => {
    aliveRef.current = true;
    return () => {
      // 卸载：停表 + 作废本轮任务。**不**取消服务端的任务（那是用户自己交的活）。
      aliveRef.current = false;
      jobIdRef.current = null;
      stopPolling();
    };
  }, [stopPolling]);

  const poll = useCallback(
    (jobId: string) => {
      // 同一个任务已经有一条链在轮询：不再起第二条（否则每次重渲染/严格模式双跑都会翻倍打接口）
      if (pollingRef.current === jobId) return;
      pollingRef.current = jobId;

      const tick = async () => {
        timerRef.current = null;

        let next: ToolJob | null = null;
        let missing = false;
        try {
          const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
          // 404 = 这个任务确实不存在了（例如接回来的旧任务已经被清理），不必再重试
          if (res.status === 404) missing = true;
          const data = (await res.json().catch(() => null)) as
            | { job?: Partial<ToolJob> & { status?: string } }
            | null;
          if (res.ok && data?.job) {
            next = {
              id: String(data.job.id ?? jobId),
              status: (data.job.status as ToolJobStatus) ?? "processing",
              progress: typeof data.job.progress === "number" ? data.job.progress : 0,
              message: data.job.message ?? "处理中…",
              resultFilename: data.job.resultFilename,
              error: data.job.error,
            };
          }
        } catch {
          next = null;
        }

        // 组件已经卸载、或者用户已经换了另一个任务：这个回调作废，且不再排下一次
        if (!aliveRef.current || jobIdRef.current !== jobId) {
          if (pollingRef.current === jobId) pollingRef.current = null;
          return;
        }

        if (next === null) {
          if (missing) {
            pollingRef.current = null;
            jobIdRef.current = null;
            setJob(null);
            setError("上一次的任务已经不存在（可能已经被清理），重新提交一次即可。");
            return;
          }
          failuresRef.current += 1;
          if (failuresRef.current >= MAX_POLL_FAILURES) {
            pollingRef.current = null;
            setError("连续多次查不到任务状态。任务可能已经结束，重新提交一次即可。");
            return;
          }
          timerRef.current = setTimeout(() => void tick(), POLL_RETRY_MS);
          return;
        }

        failuresRef.current = 0;
        setJob(next);

        // 终态：到此为止，不再有任何定时器被排上
        if (next.status === "completed" || next.status === "failed") {
          pollingRef.current = null;
          return;
        }
        timerRef.current = setTimeout(() => void tick(), POLL_INTERVAL_MS);
      };

      void tick();
    },
    [],
  );

  // 挂载时把上一次交给本工具的任务接回来：切走再回来（甚至按 F5）时进度、失败原因与结果都还在。
  // 项目里其它异步工具（图片超分、水印、磁力）走的是同一套 sessionStorage 约定。
  useEffect(() => {
    let restored: string | null = null;
    try {
      restored = sessionStorage.getItem(`furina:job:${toolId}`);
    } catch {
      restored = null;
    }
    if (restored === null || restored === "") return;
    jobIdRef.current = restored;
    setJob({ id: restored, status: "processing", progress: 0, message: "正在接回上一次的任务…" });
    poll(restored);
  }, [poll, toolId]);

  const submit = useCallback(
    async (body: FormData): Promise<boolean> => {
      stopPolling();
      jobIdRef.current = null;
      failuresRef.current = 0;
      setError(null);
      setJob(null);
      setSubmitting(true);

      try {
        const res = await fetch(`/api/tools/${toolId}`, { method: "POST", body });
        const data = (await res.json().catch(() => null)) as
          | { job?: { id?: string }; error?: string }
          | null;
        if (!res.ok) throw new Error(data?.error || `提交失败（HTTP ${res.status}）`);

        const jobId = data?.job?.id;
        if (!jobId) throw new Error("服务端没有返回任务编号，请确认后台服务在运行。");

        jobIdRef.current = jobId;
        try {
          sessionStorage.setItem(`furina:job:${toolId}`, jobId);
        } catch {
          /* 隐私模式下写不进去，不影响任务本身 */
        }
        setJob({ id: jobId, status: "pending", progress: 0, message: "任务已提交，正在排队…" });
        poll(jobId);
        return true;
      } catch (err) {
        setError(err instanceof Error ? err.message : "提交失败，请稍后重试。");
        return false;
      } finally {
        setSubmitting(false);
      }
    },
    [poll, stopPolling, toolId],
  );

  const reset = useCallback(() => {
    stopPolling();
    jobIdRef.current = null;
    failuresRef.current = 0;
    setJob(null);
    setError(null);
    // 「清空」要把记下的任务编号一并抹掉：否则切走再回来，刚清掉的结果又会被接回来
    try {
      sessionStorage.removeItem(`furina:job:${toolId}`);
    } catch {
      /* 隐私模式下读不到存储，忽略 */
    }
  }, [stopPolling, toolId]);

  const retryPolling = useCallback(() => {
    const jobId = jobIdRef.current;
    if (jobId === null) return;
    setError(null);
    failuresRef.current = 0;
    poll(jobId);
  }, [poll]);

  const running = submitting || job?.status === "pending" || job?.status === "processing";
  // 提交阶段就失败时没有任务编号，这时候给「重新查询」按钮只会点了没反应
  const canRetry = jobIdRef.current !== null;

  return { job, error, submitting, running, canRetry, submit, reset, retryPolling };
}

/**
 * 下载任务结果。
 *
 * 文件名以响应头 `X-Result-Filename`（encodeURIComponent 过的原始名）为准，
 * 拿不到时才退回调用方给的兜底名。链接只服务于这一次点击：点完 4 秒必定释放，
 * 没有任何人长期持有它，所以这里不存在「忘记释放」的常驻链接。
 */
async function downloadJobResult(jobId: string, fallbackName: string): Promise<string> {
  const res = await fetch(`/api/jobs/${jobId}/download?download=1`);
  if (!res.ok) throw new Error("下载失败，结果文件可能已经被清理，请重新处理一次。");

  const header = res.headers.get("x-result-filename");
  const filename = header !== null && header !== "" ? decodeURIComponent(header) : fallbackName;
  const blob = await res.blob();

  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);

  return filename;
}

/* ------------------------------------------------------- 本地媒体预览链接 */

/* ===== MEDIA LINK ZONE START =====
 * 这段只管「链接归谁持有、什么时候释放」，不依赖 React，所以也能被测试脚本单独切出来跑。
 */

type MediaEntry = { file: File; url: string };

/** 同时最多持有几份媒体预览链接（一份 = 一个工具选中的那个文件） */
const MEDIA_CACHE_LIMIT = 6;

/**
 * 工具 id → 「选中的本地文件 + 它的预览链接」。
 *
 * 为什么必须放在模块级：File 存不进 localStorage，组件一卸载 useState 就全没了；
 * 而 `<video>` / `<audio>` 的 src 是 URL.createObjectURL 的产物，必须有人长期持有。
 *
 * 释放时机（只有这三条，且每条都只释放一次）：
 *   ① 换了文件：同 key 的新链接把旧链接顶掉时，释放旧的那条（compare 链接字符串，相同就不动）
 *   ② 用户清空：显式释放并把条目移出缓存
 *   ③ 缓存淘汰：超过 MEDIA_CACHE_LIMIT 时释放最久未用的那条
 * **不释放**的时机：组件卸载（切到别的工具、回首页）。链接归缓存持有，回来时直接复用
 * 同一条字符串 —— 既不重建（重建只会白漏一条），也不会出现已经失效的死链接。
 */
const mediaCache = new Map<string, MediaEntry>();

function readMediaEntry(key: string): MediaEntry | null {
  const entry = mediaCache.get(key);
  if (entry === undefined) return null;
  // 命中即「最近使用过」：挪到队尾，淘汰时先淘汰别人
  mediaCache.delete(key);
  mediaCache.set(key, entry);
  return entry;
}

function writeMediaEntry(key: string, next: MediaEntry): void {
  const previous = mediaCache.get(key);
  // 只有「链接换了」才释放旧的：同一条链接（effect 重跑之类）一律不动
  if (previous !== undefined && previous.url !== next.url) {
    URL.revokeObjectURL(previous.url);
  }

  mediaCache.delete(key);
  mediaCache.set(key, next);

  while (mediaCache.size > MEDIA_CACHE_LIMIT) {
    const oldestKey = mediaCache.keys().next().value;
    if (oldestKey === undefined || oldestKey === key) break;
    const oldest = mediaCache.get(oldestKey);
    if (oldest !== undefined) URL.revokeObjectURL(oldest.url);
    mediaCache.delete(oldestKey);
  }
}

function releaseMediaEntry(key: string): void {
  const entry = mediaCache.get(key);
  if (entry !== undefined) URL.revokeObjectURL(entry.url);
  mediaCache.delete(key);
}

/* ===== MEDIA LINK ZONE END ===== */

/** 选中 / 清空本地媒体文件，并管好预览链接的生命周期（见上面 mediaCache 的说明）。 */
function useMediaFile(cacheKey: string) {
  const [media, setMedia] = useState<MediaEntry | null>(null);

  // 首帧与服务端保持一致（都是「没有文件」），挂载后再从模块缓存恢复，
  // 避免 hydration 不一致；恢复时直接复用缓存里那条链接，不重新 createObjectURL。
  useEffect(() => {
    const cached = readMediaEntry(cacheKey);
    if (cached !== null) setMedia(cached);
  }, [cacheKey]);

  const select = useCallback(
    (files: File[]) => {
      const file = files[0];
      if (file === undefined) {
        // 移除文件：链接在这里释放（此后没人会再用它）
        releaseMediaEntry(cacheKey);
        setMedia(null);
        return;
      }
      const next: MediaEntry = { file, url: URL.createObjectURL(file) };
      // writeMediaEntry 内部会把被顶掉的旧链接释放掉
      writeMediaEntry(cacheKey, next);
      setMedia(next);
    },
    [cacheKey],
  );

  const clear = useCallback(() => {
    releaseMediaEntry(cacheKey);
    setMedia(null);
  }, [cacheKey]);

  return { media, select, clear };
}

/** 媒体元素的播放位置与总时长。读数放在 state 里，render 阶段绝不碰 DOM。 */
function useMediaClock(src: string | null) {
  const [element, setElement] = useState<HTMLMediaElement | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // 换了文件就先把读数清零，免得上一个视频的位置被当成这个视频的位置
  useEffect(() => {
    setCurrentTime(0);
    setDuration(0);
  }, [src]);

  useEffect(() => {
    if (element === null) return;

    const syncDuration = () => {
      const value = element.duration;
      setDuration(Number.isFinite(value) && value > 0 ? value : 0);
    };
    const syncTime = () => setCurrentTime(element.currentTime);

    element.addEventListener("loadedmetadata", syncDuration);
    element.addEventListener("durationchange", syncDuration);
    element.addEventListener("timeupdate", syncTime);
    element.addEventListener("seeked", syncTime);
    // 本地文件常常在这条 effect 之前就已经读到元数据了，补读一次
    syncDuration();
    syncTime();

    return () => {
      element.removeEventListener("loadedmetadata", syncDuration);
      element.removeEventListener("durationchange", syncDuration);
      element.removeEventListener("timeupdate", syncTime);
      element.removeEventListener("seeked", syncTime);
    };
  }, [element, src]);

  return { attachMedia: setElement, element, currentTime, duration };
}

/* ------------------------------------------------------------ 共用外观件 */

/** 分段按钮：方向 / 方式 / 格式这种 2–4 个互斥选项用它，比下拉框少一次点击。 */
function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
  disabled,
  label,
}: {
  value: T;
  options: Array<{ value: T; label: string; icon?: ReactNode }>;
  onChange: (next: T) => void;
  disabled?: boolean;
  label: string;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-border/60 bg-muted/30 p-1"
    >
      {options.map((option) => (
        <Button
          key={option.value}
          type="button"
          size="sm"
          variant={option.value === value ? "default" : "ghost"}
          disabled={disabled}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className="h-7 gap-1.5 rounded-lg px-2.5 text-[11px] font-semibold"
        >
          {option.icon}
          {option.label}
        </Button>
      ))}
    </div>
  );
}

/** 错误提示：全站固定样式。 */
function ErrorNote({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border-l-4 border-l-destructive bg-destructive/10 px-4 py-3 font-mono text-xs text-destructive">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      <span className="leading-relaxed">{message}</span>
    </div>
  );
}

function HintNote({ children }: { children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-border/60 bg-muted/30 px-4 py-3 text-[11.5px] leading-relaxed text-muted-foreground">
      <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <div className="space-y-1">{children}</div>
    </div>
  );
}

const JOB_STATUS_LABEL: Record<ToolJobStatus, string> = {
  pending: "排队中",
  processing: "处理中",
  completed: "已完成",
  failed: "失败",
};

/** 任务状态卡：消息 + 进度 + 失败原因。终态时进度条收起，交给结果区展示成品。 */
function JobStatusCard({
  job,
  error,
  canRetry,
  onRetry,
}: {
  job: ToolJob | null;
  error: string | null;
  canRetry: boolean;
  onRetry: () => void;
}) {
  if (error !== null) {
    return (
      <div className="space-y-3 rounded-2xl border border-destructive/30 bg-card p-5 shadow-xs">
        <ErrorNote message={error} />
        {canRetry && (
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>
            <RefreshCw className="h-3.5 w-3.5" />
            重新查询任务状态
          </Button>
        )}
      </div>
    );
  }

  if (job === null) return null;

  const done = job.status === "completed";
  const failed = job.status === "failed";

  return (
    <div
      className={cn(
        "space-y-3 rounded-2xl border bg-card p-5 shadow-xs",
        done ? "border-success/40" : failed ? "border-destructive/40" : "border-primary/30",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2">
          {done ? (
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
          ) : failed ? (
            <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          ) : (
            <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />
          )}
          <p className="min-w-0 text-sm text-muted-foreground">{job.message}</p>
        </div>
        <Badge variant={done ? "success" : failed ? "outline" : "default"}>
          {JOB_STATUS_LABEL[job.status]}
        </Badge>
      </div>

      {!done && !failed && <ProgressBar value={job.progress} />}
      {job.error && <ErrorNote message={job.error} />}
    </div>
  );
}

/** 下载结果的按钮：自己处理下载中的状态与 toast，省得五个工具各写一遍。 */
function DownloadResultButton({
  jobId,
  filename,
  label,
  size = "default",
  variant = "default",
}: {
  jobId: string;
  filename: string;
  label: string;
  size?: "default" | "sm";
  variant?: "default" | "outline";
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const handleClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const saved = await downloadJobResult(jobId, filename);
      toast({ title: "下载已开始", description: saved, variant: "success" });
    } catch (err) {
      toast({
        title: "下载失败",
        description: err instanceof Error ? err.message : "请重试",
        variant: "error",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button type="button" size={size} variant={variant} onClick={handleClick} disabled={busy}>
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
      {busy ? "下载中…" : label}
    </Button>
  );
}

/** 结果区外壳：把「成品预览 + 文件名 + 下载」的排版固定下来。 */
function ResultCard({
  title,
  filename,
  size,
  jobId,
  downloadLabel,
  children,
}: {
  title: string;
  filename: string;
  size?: "default" | "sm";
  jobId: string;
  downloadLabel: string;
  children?: ReactNode;
}) {
  return (
    <div className="space-y-3 rounded-2xl border border-success/40 bg-card p-5 shadow-xs animate-fade-in-up">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-success" />
          <span className="text-sm font-semibold text-foreground">{title}</span>
          <span className="truncate font-mono-accent text-[11px] text-muted-foreground" title={filename}>
            {filename}
          </span>
        </div>
        <DownloadResultButton
          jobId={jobId}
          filename={filename}
          label={downloadLabel}
          size={size}
          variant="default"
        />
      </div>
      {children}
    </div>
  );
}

/** 预览画布：媒体/图片都摊在这块深底上，让「成品」有展示空间。
 *  底色用 --stage（三套主题都接近黑）而不是 bg-muted：视频的黑边在任何主题下都该是黑的，
 *  用 muted 的话浅色/护眼主题下会变成一块浅灰，画面像浮在脏纸上。 */
function PreviewStage({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "flex items-center justify-center overflow-hidden rounded-xl border border-border/60 bg-stage p-3",
        className,
      )}
    >
      {children}
    </div>
  );
}

/**
 * 结果预览。直接走服务端的预览接口（`?preview=1` 走 inline），不另外造 object URL。
 * 服务端没给出媒体类型时会落成 application/octet-stream，播放器/图片就会拉 error ——
 * 那种情况下把它收起来换成一句提示，而不是留一个坏掉的播放器或者一张裂图。
 */
function ResultPreview({
  jobId,
  kind,
  alt,
}: {
  jobId: string;
  kind: "image" | "video" | "audio";
  alt: string;
}) {
  const [failed, setFailed] = useState(false);
  const src = `/api/jobs/${jobId}/download?preview=1`;

  if (failed) {
    return (
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        这里没法直接预览这个结果（服务端没有给出媒体类型），点右边的下载按钮拿到文件再打开即可。
      </p>
    );
  }

  return (
    <PreviewStage className={kind === "image" ? "min-h-[220px] p-4" : undefined}>
      {kind === "image" && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          onError={() => setFailed(true)}
          className="max-h-[520px] max-w-full rounded-lg object-contain shadow-xs"
        />
      )}
      {kind === "video" && (
        <video
          src={src}
          controls
          preload="metadata"
          onError={() => setFailed(true)}
          className="max-h-[360px] w-full rounded-xl object-contain"
        >
          当前环境不支持视频播放。
        </video>
      )}
      {kind === "audio" && (
        <audio src={src} controls preload="metadata" onError={() => setFailed(true)} className="w-full">
          当前环境不支持音频播放。
        </audio>
      )}
    </PreviewStage>
  );
}

/** 文件信息行：名称 + 体积（选完文件后到处都要显示这一行）。 */
function FileMeta({ file }: { file: File }) {
  return (
    <span
      className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground"
      title={file.name}
    >
      <FileText className="h-3.5 w-3.5 shrink-0 text-primary" />
      <span className="truncate">{file.name}</span>
      <span className="shrink-0 font-mono-accent">{formatBytes(file.size)}</span>
    </span>
  );
}

/** 工具栏里那排「填入示例 / 清空」小按钮。 */
function DraftActions({
  onSample,
  onClear,
  disabled,
}: {
  onSample: () => void;
  onClear: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onSample}
        disabled={disabled}
        className="h-7 gap-1.5 px-2 text-xs"
      >
        <Wand2 className="h-3.5 w-3.5" />
        填入示例
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onClear}
        disabled={disabled}
        className="h-7 gap-1.5 px-2 text-xs text-muted-foreground hover:text-destructive"
      >
        <Trash2 className="h-3.5 w-3.5" />
        清空
      </Button>
    </div>
  );
}

/* ============================================================================
 * 工具 1 / 2：视频裁剪、音频裁剪
 *
 * 布局（两条共用一套骨架，因为任务模型逐条对应）：来源与播放器 → 时间范围
 * → 裁剪方式 → 提交 → 进度 → 结果。
 * 视频和音频的差异落在播放器那一块：视频是 16:9 的大画面 + 画面下方的位置读数；
 * 音频没有画面，所以改成一条紧凑的播放条 + 一条进度指示，把纵向空间让给时间设置。
 * ========================================================================== */

type TrimMode = "fast" | "precise";

const TRIM_MODES: Array<{ value: TrimMode; label: string }> = [
  { value: "fast", label: "快速裁剪" },
  { value: "precise", label: "精确裁剪" },
];

function MediaTrimWorkspace({ kind }: { kind: "video" | "audio" }) {
  const toolId = kind === "video" ? "video-trim" : "audio-trim";
  const cacheKey = toolId;
  const isVideo = kind === "video";

  const { toast } = useToast();
  const { media, select, clear: clearMedia } = useMediaFile(cacheKey);
  const { attachMedia, element, currentTime, duration } = useMediaClock(media?.url ?? null);
  const { job, error, submitting, running, canRetry, submit, reset, retryPolling } = useAsyncJob(toolId);

  const [start, setStart] = useToolDraft<string>(toolId, "start", "00:00");
  const [end, setEnd] = useToolDraft<string>(toolId, "end", "");
  const [mode, setMode] = useToolDraft<TrimMode>(toolId, "mode", "precise");

  const range = useMemo(
    () => analyzeTrimRange(start, end, duration > 0 ? duration : null),
    [start, end, duration],
  );

  // 任务完成前显示的占位名：保留源文件扩展名，因为引擎默认让输出容器跟随源文件
  // （裁 .mkv 得到的就是 _trimmed.mkv，不能一律写成 .mp4，否则用户会以为拿错了文件）。
  const sourceExt = media ? (media.file.name.match(/\.([^.]+)$/)?.[1] ?? "") : "";
  const resultName =
    job?.resultFilename ??
    (media
      ? media.file.name.replace(/\.[^.]+$/, "") + (isVideo ? `_trimmed.${sourceExt || "mp4"}` : `_trimmed.${sourceExt || "mp3"}`)
      : "result");

  /** 用当前播放位置填起点 / 终点：这个工具最常用的一步，省得手打时间码。 */
  const markCurrent = (target: "start" | "end") => {
    if (element === null) {
      toast({ title: "还没有可播放的文件", description: "先在下面选一个本地文件。", variant: "info" });
      return;
    }
    const value = formatClockTenths(element.currentTime);
    if (target === "start") setStart(value);
    else setEnd(value);
    toast({
      title: target === "start" ? "已把当前播放位置设为起点" : "已把当前播放位置设为终点",
      description: `${value}（${formatSeconds(element.currentTime)}）`,
      variant: "success",
      duration: 2000,
    });
  };

  const handleSubmit = async () => {
    if (media === null) {
      toast({ title: "请先选择文件", variant: "error" });
      return;
    }
    if (range.error !== null) {
      toast({ title: "时间范围有问题", description: range.error, variant: "error" });
      return;
    }

    const body = new FormData();
    body.append("file", media.file);
    body.append("start", start.trim());
    // 终点留空 = 裁到结尾；这里仍然把字段带上，值就是空串
    body.append("end", end.trim());
    body.append("mode", mode);
    await submit(body);
  };

  const handleSample = () => {
    setStart("00:00");
    setEnd("00:30");
    setMode("precise");
    toast({
      title: "已填入示例时间范围",
      description: isVideo ? "视频文件请在上方选择本地文件，示例只会填参数。" : "音频文件请在上方选择本地文件，示例只会填参数。",
      variant: "info",
      duration: 3200,
    });
  };

  const handleClear = () => {
    clearMedia();
    reset();
    setStart("00:00");
    setEnd("");
    setMode("precise");
  };

  const progressPercent = duration > 0 ? Math.min(100, Math.max(0, (currentTime / duration) * 100)) : 0;

  return (
    <div className="space-y-4">
      {/* 来源与播放器 */}
      <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Label>{isVideo ? "视频文件" : "音频文件"}</Label>
            {media !== null && <FileMeta file={media.file} />}
            {duration > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground">
                <Clock className="h-3.5 w-3.5 text-primary" />
                总时长 {formatClock(duration)}
              </span>
            )}
          </div>
          <DraftActions onSample={handleSample} onClear={handleClear} />
        </div>

        <FileDropzone
          files={media !== null ? [media.file] : []}
          onChange={select}
          accept={
            isVideo
              ? { "video/*": [".mp4", ".mov", ".mkv", ".webm", ".avi", ".flv", ".m4v", ".ts"] }
              : { "audio/*": [".mp3", ".wav", ".flac", ".aac", ".m4a", ".ogg", ".opus", ".wma"] }
          }
        />

        {media !== null && (
          <div className="space-y-3">
            <PreviewStage className={isVideo ? "p-0" : undefined}>
              {isVideo ? (
                <video
                  ref={attachMedia}
                  src={media.url}
                  controls
                  preload="metadata"
                  className="max-h-[420px] w-full rounded-xl bg-stage object-contain"
                >
                  当前环境不支持视频播放。
                </video>
              ) : (
                <div className="w-full space-y-3 py-1">
                  {/* 音频没有画面，用一条进度指示代替波形：宽度由 state 算出来，render 阶段不碰 DOM */}
                  <div className="flex items-center gap-3 px-1">
                    <Music className="h-4 w-4 shrink-0 text-primary" />
                    <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-[width] duration-200 ease-out"
                        style={{ width: `${progressPercent}%` }}
                      />
                    </div>
                    <span className="shrink-0 font-mono-accent text-[11px] text-muted-foreground">
                      {formatClock(currentTime)} / {duration > 0 ? formatClock(duration) : "--:--"}
                    </span>
                  </div>
                  <audio ref={attachMedia} src={media.url} controls preload="metadata" className="w-full">
                    当前环境不支持音频播放。
                  </audio>
                </div>
              )}
            </PreviewStage>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono-accent text-[11px] text-muted-foreground">
                当前播放位置 {formatClockTenths(currentTime)}
              </span>
              <div className="flex flex-wrap items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => markCurrent("start")}>
                  <Flag className="h-3.5 w-3.5" />
                  用当前位置作起点
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => markCurrent("end")}>
                  <Flag className="h-3.5 w-3.5" />
                  用当前位置作终点
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 时间范围 */}
      <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label>截取范围</Label>
          <span className="font-mono-accent text-[11px] text-muted-foreground">
            支持 10 / 00:10 / 00:00:10.5；终点留空表示裁到结尾
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor={`${toolId}-start`}>起点</Label>
            <Input
              id={`${toolId}-start`}
              value={start}
              onChange={(event) => setStart(event.target.value)}
              placeholder="00:00"
              spellCheck={false}
              className="font-mono-accent"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${toolId}-end`}>终点（留空 = 到结尾）</Label>
            <Input
              id={`${toolId}-end`}
              value={end}
              onChange={(event) => setEnd(event.target.value)}
              placeholder={duration > 0 ? formatClock(duration) : "00:30"}
              spellCheck={false}
              className="font-mono-accent"
            />
          </div>
        </div>

        {range.error !== null ? (
          <ErrorNote message={range.error} />
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
              <Clock className="h-3.5 w-3.5" />
              截取时长 {range.seconds === null ? "—" : formatSeconds(range.seconds)}
            </span>
            {range.warning !== null && (
              <span className="text-[11px] text-muted-foreground">{range.warning}</span>
            )}
          </div>
        )}
      </div>

      {/* 裁剪方式与提交 */}
      <div className="space-y-3 rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Label>裁剪方式</Label>
            <SegmentedControl<TrimMode>
              label="裁剪方式"
              value={mode}
              options={TRIM_MODES}
              onChange={setMode}
              disabled={running}
            />
          </div>
          <Button type="button" onClick={handleSubmit} disabled={running || media === null} className="gap-2">
            {submitting || running ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Scissors className="h-4 w-4" />
            )}
            {running ? "处理中…" : isVideo ? "开始裁剪" : "开始裁剪音频"}
          </Button>
        </div>
        <p className="text-[11px] leading-relaxed text-muted-foreground">
          快速裁剪直接复制原编码的片段，几乎瞬间完成，切点会对齐到最近的关键帧；精确裁剪重新编码，
          切点精确到帧，耗时随片段长度增长。两种方式都只在本机处理。
        </p>
      </div>

      <JobStatusCard job={job} error={error} canRetry={canRetry} onRetry={retryPolling} />

      {job !== null && job.status === "completed" && (
        <ResultCard
          title={isVideo ? "裁剪后的视频" : "裁剪后的音频"}
          filename={resultName}
          jobId={job.id}
          downloadLabel="下载结果"
        >
          <ResultPreview jobId={job.id} kind={isVideo ? "video" : "audio"} alt="裁剪结果" />
        </ResultCard>
      )}
    </div>
  );
}

export function VideoTrimTool() {
  return <MediaTrimWorkspace kind="video" />;
}

export function AudioTrimTool() {
  return <MediaTrimWorkspace kind="audio" />;
}

/* ============================================================================
 * 工具 3：视频抽帧缩略图
 * 布局：来源与预览 → 取帧参数（时间 + 格式 + 宽度）→ 提交 → 进度 → 结果大图。
 * ========================================================================== */

type FrameFormat = "png" | "jpg";

const FRAME_FORMATS: Array<{ value: FrameFormat; label: string }> = [
  { value: "png", label: "PNG" },
  { value: "jpg", label: "JPG" },
];

export function VideoThumbnailTool() {
  const toolId = "video-frame-extract";
  const { toast } = useToast();
  const { media, select, clear: clearMedia } = useMediaFile(toolId);
  const { attachMedia, element, currentTime, duration } = useMediaClock(media?.url ?? null);
  const { job, error, submitting, running, canRetry, submit, reset, retryPolling } = useAsyncJob(toolId);

  const [time, setTime] = useToolDraft<string>(toolId, "time", "");
  const [format, setFormat] = useToolDraft<FrameFormat>(toolId, "format", "png");
  const [width, setWidth] = useToolDraft<string>(toolId, "width", "");

  const parsedTime = time.trim() === "" ? 0 : parseTimecode(time);
  const timeError =
    parsedTime === null
      ? "取帧时间看不懂，可以写 5、00:05 或 00:00:05.5。"
      : duration > 0 && parsedTime > duration
        ? `取帧时间超出了视频总长（${formatClock(duration)}）。`
        : null;

  const widthValue = width.trim() === "" ? null : Number(width);
  const widthError =
    widthValue !== null && (!Number.isFinite(widthValue) || widthValue < 16 || widthValue > 7680)
      ? "宽度请填 16 – 7680 之间的数字（留空表示保持原始尺寸）。"
      : null;

  const resultName =
    job?.resultFilename ??
    (media !== null
      ? `${media.file.name.replace(/\.[^.]+$/, "")}-frame.${format}`
      : `frame.${format}`);

  const takeCurrentFrame = () => {
    if (element === null) {
      toast({ title: "还没有可播放的文件", variant: "info" });
      return;
    }
    const value = formatClockTenths(element.currentTime);
    setTime(value);
    toast({ title: "已把当前画面时间填入取帧时间", description: value, variant: "success", duration: 2000 });
  };

  const handleSubmit = async () => {
    if (media === null) {
      toast({ title: "请先选择视频文件", variant: "error" });
      return;
    }
    if (timeError !== null || widthError !== null) {
      toast({ title: "参数有问题", description: timeError ?? widthError ?? "", variant: "error" });
      return;
    }

    const body = new FormData();
    body.append("file", media.file);
    body.append("time", time.trim());
    body.append("format", format);
    if (width.trim() !== "") body.append("width", width.trim());
    await submit(body);
  };

  const handleSample = () => {
    setTime("00:05");
    setFormat("png");
    setWidth("640");
    toast({
      title: "已填入示例参数",
      description: "视频文件请在上方选择本地文件，示例只会填参数。",
      variant: "info",
      duration: 3200,
    });
  };

  const handleClear = () => {
    clearMedia();
    reset();
    setTime("");
    setFormat("png");
    setWidth("");
  };

  return (
    <div className="space-y-4">
      {/* 来源与预览 */}
      <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Label>视频文件</Label>
            {media !== null && <FileMeta file={media.file} />}
            {duration > 0 && (
              <span className="inline-flex items-center gap-1.5 rounded-lg border border-border/60 bg-muted/40 px-2.5 py-1 text-[11px] text-muted-foreground">
                <Clock className="h-3.5 w-3.5 text-primary" />
                总长 {formatClock(duration)}
              </span>
            )}
          </div>
          <DraftActions onSample={handleSample} onClear={handleClear} />
        </div>

        <FileDropzone
          files={media !== null ? [media.file] : []}
          onChange={select}
          accept={{ "video/*": [".mp4", ".mov", ".mkv", ".webm", ".avi", ".flv", ".m4v", ".ts"] }}
        />

        {media !== null && (
          <div className="space-y-3">
            <PreviewStage className="p-0">
              <video
                ref={attachMedia}
                src={media.url}
                controls
                preload="metadata"
                className="max-h-[420px] w-full rounded-xl bg-stage object-contain"
              >
                当前环境不支持视频播放。
              </video>
            </PreviewStage>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono-accent text-[11px] text-muted-foreground">
                当前播放位置 {formatClockTenths(currentTime)}
                {duration > 0 ? ` / ${formatClock(duration)}` : ""}
              </span>
              <Button type="button" variant="outline" size="sm" onClick={takeCurrentFrame}>
                <ImageDown className="h-3.5 w-3.5" />
                取当前帧
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* 取帧参数 */}
      <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label>取帧参数</Label>
          <span className="font-mono-accent text-[11px] text-muted-foreground">
            {duration > 0 ? `视频总长 ${formatClock(duration)}` : "选好文件后这里会显示视频总长"}
          </span>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="video-frame-extract-time">取帧时间（留空 = 第 0 秒）</Label>
            <div className="flex items-center gap-2">
              <Input
                id="video-frame-extract-time"
                value={time}
                onChange={(event) => setTime(event.target.value)}
                placeholder="00:05"
                spellCheck={false}
                className="font-mono-accent"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={takeCurrentFrame}
                disabled={media === null}
                className="h-11 shrink-0"
              >
                <Timer className="h-3.5 w-3.5" />
                取当前帧
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="video-frame-extract-width">输出宽度（留空 = 原始尺寸）</Label>
            <Input
              id="video-frame-extract-width"
              type="number"
              min={16}
              max={7680}
              value={width}
              onChange={(event) => setWidth(event.target.value)}
              placeholder="例如 640，高度按比例缩放"
              className="font-mono-accent"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Label>输出格式</Label>
          <SegmentedControl<FrameFormat>
            label="输出格式"
            value={format}
            options={FRAME_FORMATS}
            onChange={setFormat}
            disabled={running}
          />
          <span className="text-[11px] text-muted-foreground">
            JPG 体积更小，PNG 无损、适合再编辑。
          </span>
        </div>

        {timeError !== null ? (
          <ErrorNote message={timeError} />
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary">
            <Clock className="h-3.5 w-3.5" />
            取第 {formatSeconds(parsedTime ?? 0)} 处的画面
          </span>
        )}
        {widthError !== null && <ErrorNote message={widthError} />}
      </div>

      {/* 提交 */}
      <div className="rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            抽帧在本机完成后端处理，取帧点由视频解码器定位，结果尺寸与时间点以参数为准。
          </p>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={running || media === null || timeError !== null || widthError !== null}
            className="gap-2"
          >
            {submitting || running ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ImageDown className="h-4 w-4" />
            )}
            {running ? "处理中…" : "提取缩略图"}
          </Button>
        </div>
      </div>

      <JobStatusCard job={job} error={error} canRetry={canRetry} onRetry={retryPolling} />

      {job !== null && job.status === "completed" && (
        <ResultCard
          title="提取的缩略图"
          filename={resultName}
          jobId={job.id}
          downloadLabel="下载图片"
        >
          <ResultPreview jobId={job.id} kind="image" alt="提取的缩略图" />
          <p className="text-[11px] text-muted-foreground">
            预览按显示区域缩放；点「下载图片」拿到的是导出时的原始尺寸。
          </p>
        </ResultCard>
      )}
    </div>
  );
}

/* ============================================================================
 * 工具 4：CSV ↔ Excel
 *
 * 布局模式 D（表格数据）：数据来源（上传 / 粘贴）→ 真表格预览 → 底部操作条 → 进度 → 下载。
 * 没有拆成「左参数右结果」的原因：这个工具的全部价值就是让人在**转换之前**把数据核对
 * 一遍，所以表格必须占据主视区，转换参数与提交按钮收在底部一条，不与表格争宽度。
 * ========================================================================== */

type ConversionDirection = "auto" | "to-xlsx" | "to-csv";
type DelimiterChoice = "auto" | "," | ";" | "\t";
type HeaderChoice = "header" | "data";

const CSV_DIRECTIONS: Array<{ value: ConversionDirection; label: string; icon: ReactNode }> = [
  { value: "auto", label: "自动", icon: <ArrowRightLeft className="h-3.5 w-3.5" /> },
  { value: "to-xlsx", label: "转成 Excel（.xlsx）", icon: <FileSpreadsheet className="h-3.5 w-3.5" /> },
  { value: "to-csv", label: "转成 CSV", icon: <FileText className="h-3.5 w-3.5" /> },
];

const CSV_DELIMITER_OPTIONS: Array<{ value: DelimiterChoice; label: string }> = [
  { value: "auto", label: "自动识别" },
  { value: ",", label: "逗号" },
  { value: ";", label: "分号" },
  { value: "\t", label: "Tab" },
];

const CSV_SAMPLE = [
  "姓名,阵营,等级,备注",
  "芙宁娜,枫丹,90,众水的颂歌",
  '那维莱特,枫丹,90,"最高审判官, 水龙王"',
  "旅行者,游历,80,\"第一行\n第二行\"",
].join("\n");

/** 表格预览最多画多少行：画得再多也没人看，留着让它卡就是纯粹的负担。 */
const CSV_PREVIEW_ROWS = 50;

/* ===== TEXT DECODE ZONE START =====
 * 读文本文件这一小段同样不依赖 React / DOM，只吃 File 自己的字节，所以也能单独测。
 */

/**
 * 读文本文件：先按 UTF-8 解，出现替换字符（说明这份字节不是 UTF-8）再试一次 GBK。
 * 中文 CSV 导出成 GBK 的很常见，读出来全是乱码时这一步就是救命的；环境没有 GBK
 * 解码器时保持 UTF-8 的结果，不抛错。
 */
async function decodeTextFile(file: File): Promise<{ text: string; encoding: string }> {
  const buffer = await file.arrayBuffer();
  let text = new TextDecoder("utf-8").decode(buffer);
  let encoding = "UTF-8";
  if (text.includes("\uFFFD")) {
    try {
      const gbk = new TextDecoder("gbk").decode(buffer);
      if (!gbk.includes("\uFFFD")) {
        text = gbk;
        encoding = "GBK";
      }
    } catch {
      /* 这个环境没有 GBK 解码器，那就保持 UTF-8 的结果 */
    }
  }
  return { text, encoding };
}

/* ===== TEXT DECODE ZONE END ===== */

/** 表格预览：表头、斑马纹、数字列右对齐、超长内容截断（title 里给全文）、横向滚动。 */
function CsvPreviewTable({
  rows,
  hasHeader,
  maxRows,
  numericColumns,
}: {
  rows: string[][];
  hasHeader: boolean;
  maxRows: number;
  numericColumns: boolean[];
}) {
  const columns = rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (rows.length === 0 || columns === 0) return null;

  const header = hasHeader ? rows[0] : null;
  const body = hasHeader ? rows.slice(1) : rows;
  const shown = body.slice(0, maxRows);

  return (
    <div className="thin-scroll max-h-[520px] overflow-auto rounded-xl border border-border/70">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            {Array.from({ length: columns }).map((_cell, index) => (
              <th
                key={index}
                className="sticky top-0 z-10 border-b border-border/70 bg-muted/50 px-3 py-2 text-left font-semibold whitespace-nowrap text-foreground backdrop-blur"
              >
                {header !== null ? (header[index] ?? "") : `第 ${index + 1} 列`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, rowIndex) => (
            <tr key={rowIndex} className="even:bg-muted/20 hover:bg-muted/30">
              {Array.from({ length: columns }).map((_cell, index) => {
                const value = row[index] ?? "";
                return (
                  <td
                    key={index}
                    className={cn(
                      "border-b border-border/40 px-3 py-1.5 align-top",
                      numericColumns[index] === true
                        ? "text-right font-mono-accent tabular-nums"
                        : "text-left",
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-[280px] truncate text-foreground/90",
                        value.includes("\n") && "whitespace-pre-wrap",
                      )}
                      title={value}
                    >
                      {value}
                    </div>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CsvExcelTool() {
  const toolId = "csv-excel";
  const { toast } = useToast();
  const { job, error, submitting, running, canRetry, submit, reset, retryPolling } = useAsyncJob(toolId);

  const [text, setText] = useToolDraft<string>(toolId, "text", "");
  const [direction, setDirection] = useToolDraft<ConversionDirection>(toolId, "direction", "auto");
  const [delimiterChoice, setDelimiterChoice] = useToolDraft<DelimiterChoice>(toolId, "delimiter", "auto");
  const [hasHeader, setHasHeader] = useToolDraft<boolean>(toolId, "hasHeader", true);
  const [sheet, setSheet] = useToolDraft<string>(toolId, "sheet", "");

  const [sourceFile, setSourceFile] = useState<File | null>(null);
  const [encoding, setEncoding] = useState("");

  const isSpreadsheet =
    sourceFile !== null && /\.(xlsx|xls)$/i.test(sourceFile.name);

  const delimiter: string = delimiterChoice === "auto" ? detectDelimiter(text) : delimiterChoice;
  const table = useMemo(() => parseCsvTable(text, delimiter), [text, delimiter]);
  const rows = table.rows;
  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const dataRowCount = hasHeader ? Math.max(0, rows.length - 1) : rows.length;
  const numericFlags = useMemo(() => numericColumnFlags(rows, hasHeader), [rows, hasHeader]);

  /** 粘贴内容时用它兜底：把文本包成一个 .csv 文件交给后端，比另开一条通道简单可靠。 */
  const pastedFile = useMemo(
    () => new File([text], "pasted.csv", { type: "text/csv" }),
    [text],
  );

  const handlePickFiles = async (files: File[]) => {
    const file = files[0];
    if (file === undefined) {
      // 移除文件：表格预览也一起收掉，避免留下的数据来源说不清
      setSourceFile(null);
      setEncoding("");
      setText("");
      reset();
      return;
    }

    if (/\.(xlsx|xls)$/i.test(file.name)) {
      // 浏览器没有 Excel 解析能力，这里只登记文件，预览交给后端转换后的结果
      setSourceFile(file);
      setEncoding("");
      setText("");
      toast({
        title: "已选择 Excel 文件",
        description: "浏览器不解析 .xlsx，转换完成后再下载 CSV 查看内容。",
        variant: "info",
        duration: 3600,
      });
      return;
    }

    if (file.size > 8 * 1024 * 1024) {
      toast({
        title: "文件有点大",
        description: "超过 8 MB 的 CSV 在浏览器里预览会比较慢，建议先切一段数据再试。",
        variant: "error",
        duration: 4200,
      });
    }

    try {
      const decoded = await decodeTextFile(file);
      setSourceFile(file);
      setEncoding(decoded.encoding);
      setText(decoded.text);
      toast({
        title: "文件已读进来",
        description:
          decoded.encoding === "GBK" ? "按 GBK 解码，中文应该正常了。" : "按 UTF-8 解码。",
        variant: "success",
        duration: 2600,
      });
    } catch {
      toast({ title: "文件读不了", description: "换一个 CSV 文件试试。", variant: "error" });
    }
  };

  const handleSubmit = async () => {
    if (sourceFile === null && text.trim() === "") {
      toast({ title: "还没有数据", description: "先选一个 .csv / .xlsx 文件，或者把内容粘进来。", variant: "error" });
      return;
    }

    const body = new FormData();
    body.append("file", sourceFile ?? pastedFile);
    body.append("direction", direction);
    body.append("delimiter", delimiterChoice);
    body.append("has_header", hasHeader ? "true" : "false");
    if (sheet.trim() !== "") body.append("sheet", sheet.trim());
    await submit(body);
  };

  const handleSample = () => {
    setText(CSV_SAMPLE);
    setSourceFile(null);
    setEncoding("");
    setDelimiterChoice("auto");
    setHasHeader(true);
    toast({ title: "已填入示例表格", description: "其中一格带逗号、一格带换行，用来检验解析是否正确。", variant: "success", duration: 3200 });
  };

  const handleClear = () => {
    setText("");
    setSourceFile(null);
    setEncoding("");
    setSheet("");
    setDirection("auto");
    setDelimiterChoice("auto");
    setHasHeader(true);
    reset();
  };

  const resultName = job?.resultFilename ?? (direction === "to-csv" ? "converted.csv" : "converted.xlsx");
  const resultIsSheet = /\.xlsx$/i.test(resultName);

  return (
    <div className="space-y-4">
      {/* 数据来源 */}
      <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Label>数据来源</Label>
            {sourceFile !== null && <FileMeta file={sourceFile} />}
            {encoding !== "" && (
              <Badge variant="secondary">按 {encoding} 解码</Badge>
            )}
          </div>
          <DraftActions onSample={handleSample} onClear={handleClear} />
        </div>

        <FileDropzone
          files={sourceFile !== null ? [sourceFile] : []}
          onChange={handlePickFiles}
          accept={{
            "text/csv": [".csv", ".tsv", ".txt"],
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
          }}
        />

        <div className="space-y-2">
          <Label htmlFor="csv-excel-paste">或者直接粘贴表格内容</Label>
          <Textarea
            id="csv-excel-paste"
            value={text}
            onChange={(event) => {
              setText(event.target.value);
              setSourceFile(null);
              setEncoding("");
            }}
            placeholder={"姓名,阵营,等级\n芙宁娜,枫丹,90"}
            spellCheck={false}
            wrap="off"
            className="thin-scroll min-h-[120px] resize-y whitespace-pre font-mono-accent text-xs leading-relaxed"
          />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            粘贴的内容会作为一个 pasted.csv 文件提交转换。带逗号、引号、换行的字段按 CSV 标准处理；
            列数不一致的行会补空单元格并给出提示。
          </p>
        </div>
      </div>

      {/* 表格预览 */}
      <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Label>分隔符</Label>
            <SegmentedControl<DelimiterChoice>
              label="分隔符"
              value={delimiterChoice}
              options={CSV_DELIMITER_OPTIONS}
              onChange={setDelimiterChoice}
              disabled={running}
            />
            {delimiterChoice === "auto" && text.trim() !== "" && (
              <span className="font-mono-accent text-[11px] text-muted-foreground">
                自动识别为：{delimiterLabel(delimiter)}
              </span>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Label>首行</Label>
            <SegmentedControl<HeaderChoice>
              label="首行"
              value={hasHeader ? "header" : "data"}
              options={[
                { value: "header", label: "首行是表头" },
                { value: "data", label: "首行也是数据" },
              ]}
              onChange={(next) => setHasHeader(next === "header")}
              disabled={running}
            />
          </div>
        </div>

        {isSpreadsheet ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/70 bg-card/40 p-8 text-center">
            <FileSpreadsheet className="h-9 w-9 text-muted-foreground/40" />
            <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
              浏览器没有解析 .xlsx 的能力，所以这里不画表格。{sourceFile?.name} 会由本机后端读取，
              转换完成后在下面的结果里下载 CSV 就能看到内容。
            </p>
          </div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/70 bg-card/40 p-8 text-center">
            <Table2 className="h-9 w-9 text-muted-foreground/40" />
            <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
              还没有数据。选一个 .csv 文件，或者把内容粘到上面的输入框，这里会把它画成表格。
            </p>
            <Button type="button" variant="outline" size="sm" onClick={handleSample}>
              <Sparkles className="h-3.5 w-3.5" />
              填入示例看看
            </Button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-mono-accent text-[11px] text-muted-foreground">
                共 {dataRowCount} 行 {columnCount} 列
              </span>
              <span className="font-mono-accent text-[11px] text-muted-foreground">
                {linesOf(text).length} 行文本 · {text.length} 字符
              </span>
            </div>
            <CsvPreviewTable
              rows={rows}
              hasHeader={hasHeader}
              maxRows={CSV_PREVIEW_ROWS}
              numericColumns={numericFlags}
            />
            {dataRowCount > CSV_PREVIEW_ROWS && (
              <p className="text-[11px] text-muted-foreground">
                表格只画前 {CSV_PREVIEW_ROWS} 行，后面还有 {dataRowCount - CSV_PREVIEW_ROWS} 行没有画出来；
                转换用的是完整数据，不受预览行数影响。单元格可以横向滚动查看。
              </p>
            )}
          </div>
        )}

        {table.warnings.length > 0 && (
          <div className="space-y-1.5 rounded-xl border border-border/60 bg-muted/30 px-4 py-3">
            {table.warnings.map((warning) => (
              <div key={warning} className="flex items-start gap-2 text-[11.5px] leading-relaxed text-muted-foreground">
                <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
                <span>{warning}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 底部操作条 */}
      <div className="space-y-3 rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <Label>转换方向</Label>
            <SegmentedControl<ConversionDirection>
              label="转换方向"
              value={direction}
              options={CSV_DIRECTIONS}
              onChange={setDirection}
              disabled={running}
            />
          </div>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={running || (sourceFile === null && text.trim() === "")}
            className="gap-2"
          >
            {submitting || running ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileSpreadsheet className="h-4 w-4" />
            )}
            {running ? "转换中…" : "开始转换"}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="w-[220px] space-y-2">
            <Label htmlFor="csv-excel-sheet">工作表名（可空）</Label>
            <Input
              id="csv-excel-sheet"
              value={sheet}
              onChange={(event) => setSheet(event.target.value)}
              placeholder="留空 = 第一个工作表"
              className="font-mono-accent"
            />
          </div>
          <p className="max-w-md text-[11px] leading-relaxed text-muted-foreground">
            {direction === "to-xlsx"
              ? "将生成真正的 .xlsx：Excel 打开后可以直接求和、排序、套公式。"
              : direction === "to-csv"
                ? "将生成 .csv 文本文件；工作表名只在输入是 .xlsx 时生效。"
                : "自动按扩展名判断方向：.csv 转成 .xlsx，.xlsx 转成 .csv。"}
            「首行是表头」决定预览里第一行怎么显示，并会以 has_header 一起提交给后端。
          </p>
        </div>
      </div>

      <JobStatusCard job={job} error={error} canRetry={canRetry} onRetry={retryPolling} />

      {job !== null && job.status === "completed" && (
        <ResultCard
          title={resultIsSheet ? "转换后的 Excel 工作簿" : "转换后的 CSV"}
          filename={resultName}
          jobId={job.id}
          downloadLabel={resultIsSheet ? "下载 .xlsx" : "下载 .csv"}
        >
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {resultIsSheet
              ? "这是后端生成的 .xlsx 工作簿，用 Excel / WPS / LibreOffice 直接打开即可。"
              : "这是逗号分隔的 CSV 文本，分隔符与「首行是表头」的判断都按上面的设置执行。"}
          </p>
        </ResultCard>
      )}
    </div>
  );
}

/* ============================================================================
 * 工具 5：Markdown → PDF
 *
 * 布局模式 F（文档预览）：左边写、右边立刻排成一页纸。工具栏放在上面一行，
 * 字号与页面尺寸都在那里，主按钮是「生成 PDF」。
 * ========================================================================== */

/** 一页纸的排版：全部用主题变量，成品预览要跟着三套主题走。 */
const PAPER_TYPOGRAPHY = [
  "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
  "[&_h1]:mt-0 [&_h1]:mb-4 [&_h1]:border-b [&_h1]:border-border/60 [&_h1]:pb-2 [&_h1]:text-[1.9em] [&_h1]:leading-snug [&_h1]:font-bold",
  "[&_h2]:mt-7 [&_h2]:mb-3 [&_h2]:border-b [&_h2]:border-border/50 [&_h2]:pb-1.5 [&_h2]:text-[1.5em] [&_h2]:font-bold",
  "[&_h3]:mt-6 [&_h3]:mb-2.5 [&_h3]:text-[1.22em] [&_h3]:font-semibold",
  "[&_h4]:mt-5 [&_h4]:mb-2 [&_h4]:text-[1.08em] [&_h4]:font-semibold",
  "[&_p]:my-3 [&_p]:leading-[1.8]",
  "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
  "[&_strong]:font-semibold [&_strong]:text-foreground",
  "[&_ul]:my-3 [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:my-3 [&_ol]:list-decimal [&_ol]:pl-6",
  "[&_li]:my-1 [&_li]:leading-[1.8] [&_ul_ul]:my-1 [&_ol_ol]:my-1",
  "[&_blockquote]:my-4 [&_blockquote]:rounded-r-lg [&_blockquote]:border-l-4 [&_blockquote]:border-l-primary/60 [&_blockquote]:bg-muted/40 [&_blockquote]:px-4 [&_blockquote]:py-2 [&_blockquote]:text-muted-foreground",
  "[&_blockquote_p]:my-1.5",
  "[&_code]:rounded [&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:font-mono-accent [&_code]:text-[0.9em]",
  "[&_pre]:my-4 [&_pre]:overflow-x-auto [&_pre]:rounded-xl [&_pre]:border [&_pre]:border-border/60 [&_pre]:bg-muted/40 [&_pre]:p-4",
  "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:text-[0.88em]",
  "[&_table]:my-4 [&_table]:w-full [&_table]:border-collapse [&_table]:text-[0.96em]",
  "[&_th]:border [&_th]:border-border/60 [&_th]:bg-muted/50 [&_th]:px-3 [&_th]:py-2 [&_th]:font-semibold",
  "[&_td]:border [&_td]:border-border/60 [&_td]:px-3 [&_td]:py-2",
  "[&_hr]:my-6 [&_hr]:border-border/60",
].join(" ");

type PdfPageSize = "a4" | "letter";

const PDF_PAGE_SIZES: Array<{ value: PdfPageSize; label: string }> = [
  { value: "a4", label: "A4" },
  { value: "letter", label: "Letter" },
];

const PDF_FONT_SIZES: Array<{ value: string; label: string }> = [
  { value: "13", label: "13" },
  { value: "15", label: "15" },
  { value: "17", label: "17" },
  { value: "19", label: "19" },
];

const MARKDOWN_SAMPLE = `# 芙宁娜 · 使用说明

左边写 Markdown，右边立刻排成一页纸。

## 支持的语法

- 标题、**粗体**、*斜体*、\`行内代码\`
- 列表可以嵌套
  1. 缩进两个空格就算下一层
  2. 有序无序都认
- 还有引用、代码块、表格、分割线

> 把水搅浑很容易，把水看清楚很难。
> —— 这行也是引用的一部分。

### 代码块

\`\`\`js
const regions = ["枫丹", "歌剧", "审判"];
regions.forEach((name) => console.log(name));
\`\`\`

### 表格

| 语法 | 说明 | 数量 |
| :--- | :--- | ---: |
| 标题 | 一到六级 | 6 |
| 表格 | 支持对齐写法 | 1 |
| 代码块 | 语言标记可选 | 3 |

---

尖括号这类字符会被转义，直接写 <script> 也不会被执行。`;

export function MarkdownToPdfTool() {
  const toolId = "markdown-to-pdf";
  const { toast } = useToast();
  const { job, error, submitting, running, canRetry, submit, reset, retryPolling } = useAsyncJob(toolId);

  const [markdown, setMarkdown] = useToolDraft<string>(toolId, "markdown", "");
  const [fontSize, setFontSize] = useToolDraft<string>(toolId, "fontSize", "15");
  const [pageSize, setPageSize] = useToolDraft<PdfPageSize>(toolId, "pageSize", "a4");

  const [fileName, setFileName] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const html = useMemo(() => renderMarkdown(markdown), [markdown]);
  const stats = useMemo(() => docStats(markdown), [markdown]);
  const title = markdownTitle(markdown);
  const exportTitle = title === "" ? "document" : title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 60);

  const handlePickMarkdown = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file === undefined) return;
    if (file.size > 2 * 1024 * 1024) {
      toast({
        title: "文件有点大",
        description: "超过 2 MB 的文档在浏览器里实时预览会比较吃力。",
        variant: "error",
        duration: 4200,
      });
    }
    try {
      const decoded = await decodeTextFile(file);
      setMarkdown(decoded.text);
      setFileName(file.name);
      toast({
        title: "已读入 Markdown 文件",
        description: `${file.name} · ${decoded.encoding}`,
        variant: "success",
        duration: 2600,
      });
    } catch {
      toast({ title: "文件读不了", description: "换一个 .md 文件试试。", variant: "error" });
    }
  };

  const handleSubmit = async () => {
    if (markdown.trim() === "") {
      toast({ title: "先写点内容", description: "左侧编辑区还是空的。", variant: "error" });
      return;
    }
    const body = new FormData();
    // 正文用 text 字段提交；同时带上一份同内容的 .md 文件，
    // 后端无论按 text 还是按 file 取值，拿到的都是同一份内容。
    body.append("text", markdown);
    body.append("file", new File([markdown], `${exportTitle}.md`, { type: "text/markdown" }));
    body.append("page_size", pageSize);
    body.append("font_size", fontSize);
    await submit(body);
  };

  const handleSample = () => {
    setMarkdown(MARKDOWN_SAMPLE);
    setFileName("");
  };

  const handleClear = () => {
    setMarkdown("");
    setFileName("");
    setFontSize("15");
    setPageSize("a4");
    reset();
  };

  const resultName = job?.resultFilename ?? `${exportTitle}.pdf`;

  return (
    <div className="space-y-4">
      {/* 工具栏：字号 / 页面 / 生成 PDF */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card p-4 shadow-xs">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <Label>字号</Label>
            <SegmentedControl<string>
              label="字号"
              value={fontSize}
              options={PDF_FONT_SIZES}
              onChange={setFontSize}
              disabled={running}
            />
          </div>
          <div className="flex items-center gap-2">
            <Label>页面</Label>
            <SegmentedControl<PdfPageSize>
              label="页面尺寸"
              value={pageSize}
              options={PDF_PAGE_SIZES}
              onChange={setPageSize}
              disabled={running}
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={running}
          >
            <FileUp className="h-3.5 w-3.5" />
            打开 .md 文件
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.markdown,.txt,text/markdown,text/plain"
            onChange={handlePickMarkdown}
            className="hidden"
          />
          <DraftActions onSample={handleSample} onClear={handleClear} disabled={running} />
          <Button type="button" onClick={handleSubmit} disabled={running || markdown.trim() === ""} className="gap-2">
            {submitting || running ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <FileDown className="h-4 w-4" />
            )}
            {running ? "生成中…" : "生成 PDF"}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 左：Markdown 编辑区 */}
        <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Label htmlFor="markdown-to-pdf-source">Markdown 源码</Label>
              {fileName !== "" && <Badge variant="secondary">{fileName}</Badge>}
            </div>
            <span className="font-mono-accent text-[11px] text-muted-foreground">
              {stats.lines} 行 · {stats.chars} 字（不含空白）· 约 {stats.words} 词 · {stats.headings} 个标题
            </span>
          </div>

          <Textarea
            id="markdown-to-pdf-source"
            value={markdown}
            onChange={(event) => {
              setMarkdown(event.target.value);
              setFileName("");
            }}
            placeholder={"# 标题\n\n正文里可以用 **粗体**、*斜体* 和 `行内代码`。\n\n- 列表\n- 还有表格、引用、代码块"}
            spellCheck={false}
            className="thin-scroll min-h-[400px] resize-y font-mono-accent text-xs leading-relaxed md:min-h-[560px]"
          />

          <HintNote>
            <p>
              打开 .md 文件后内容会读进这个编辑区，提交的一直是这里的内容；改完再点「生成 PDF」。
            </p>
            <p>
              渲染在浏览器里实时完成，生成 PDF 由本机后端处理；页面尺寸与字号按上面工具栏的设置生效。
            </p>
          </HintNote>
        </div>

        {/* 右：一页纸的成品预览 */}
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/70 bg-card px-5 py-3 shadow-xs">
            <div className="flex flex-wrap items-center gap-2">
              <Label>成品预览</Label>
              <Badge variant="default">{pageSize === "a4" ? "A4" : "Letter"}</Badge>
              <span className="font-mono-accent text-[11px] text-muted-foreground">字号 {fontSize}px</span>
            </div>
            <span className="font-mono-accent text-[11px] text-muted-foreground">
              约 {stats.words} 词 · {stats.headings} 个标题
            </span>
          </div>

          <div className="thin-scroll max-h-[760px] overflow-auto rounded-2xl border border-border/70 bg-muted/30 p-4 md:p-6">
            <article
              className={cn(
                "mx-auto w-full rounded-xl border border-border/60 bg-card px-7 py-9 text-foreground shadow-sm md:px-10 md:py-12",
                pageSize === "a4" ? "max-w-[820px]" : "max-w-none",
                PAPER_TYPOGRAPHY,
              )}
              style={{ fontSize: `${fontSize}px` }}
            >
              {html !== "" ? (
                // 这里注入的 HTML 全部由 renderMarkdown 生成：用户文本在拼标签之前已经整体转义，
                // 用户写的标签不可能出现在结果里（XSS 不成立），所以不需要再额外过滤一层。
                <div dangerouslySetInnerHTML={{ __html: html }} />
              ) : (
                <div className="flex min-h-[420px] flex-col items-center justify-center gap-3 text-center">
                  <FileText className="h-9 w-9 text-muted-foreground/40" />
                  <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
                    纸还是空的。左边写点 Markdown，或者先填一段示例看看它能排成什么样。
                  </p>
                  <Button type="button" variant="outline" size="sm" onClick={handleSample}>
                    <Sparkles className="h-3.5 w-3.5" />
                    填入示例
                  </Button>
                </div>
              )}
            </article>
          </div>
        </div>
      </div>

      <JobStatusCard job={job} error={error} canRetry={canRetry} onRetry={retryPolling} />

      {job !== null && job.status === "completed" && (
        <ResultCard title="生成的 PDF" filename={resultName} jobId={job.id} downloadLabel="下载 PDF">
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={`/api/jobs/${job.id}/download?preview=1`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary hover:text-primary"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              在浏览器中打开
            </a>
            <span className="text-[11px] text-muted-foreground">
              中文字体由后端内置，PDF 里的文字可以选择、可以搜索。
            </span>
          </div>
        </ResultCard>
      )}
    </div>
  );
}
