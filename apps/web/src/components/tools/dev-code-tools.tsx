"use client";

/**
 * 四个「开发 / 代码处理」工具的界面：CSS 格式化与压缩、SQL 格式化、HTML·CSS·JS 压缩、JSON Schema 校验。
 *
 * 这四个都**完全在浏览器本地算完**（不调用 /api/tools/）：输入是纯文本，本地转换是瞬时的，
 * 走服务端只会更慢，也和项目里 json-formatter / 格式转换那一批 clientSide 工具保持一致。
 * 全部逻辑手写，没有引入任何依赖。
 *
 * 目录：
 *  1. PURE LOGIC ZONE（纯逻辑区）：CSS 解析/格式化/压缩、SQL 词法与美化、HTML 压缩、JS 安全压缩、
 *     JSON Schema（draft-07 子集）校验。**不依赖 React 与 DOM**，可以按标记整段抽出来跑 Node 单测。
 *  2. 示例数据。
 *  3. 共用外观件：错误提示（带行号）、提示列表、复制按钮、空状态、元信息、分段控件。
 *  4. 四个导出组件：CssFormatterTool / SqlFormatterTool / CodeMinifyTool / JsonSchemaTool。
 *
 * 视觉语言严格跟随 docs/新工具UI规范.md：rounded-2xl + border-border/70 + shadow-xs、只用主题色变量、
 * 不写死颜色；布局按每个工具的任务模型单独设计（见各组件上方的说明）。
 */

import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Braces,
  Check,
  CheckCircle2,
  Code2,
  Copy,
  Database,
  Eye,
  FileCode2,
  Info,
  LayoutTemplate,
  Minimize2,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import { Badge, Button, Label, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useToolDraft } from "@/lib/use-tool-draft";
import { cn } from "@/lib/utils";

/* ==========================================================================================
 * PURE LOGIC ZONE START
 * 下面全部是纯函数：不引用 React、不碰 DOM，输入输出都是字符串 / 数组 / 数字 / 布尔。
 * （单测脚本按这两行标记抽取源码，用项目自带 typescript 转译后在 Node 里单独跑。）
 * ========================================================================================== */

type LogicResult<T> =
  | { ok: true; value: T; warnings: string[] }
  | { ok: false; message: string; line?: number; lineText?: string };

function logicOk<T>(value: T, warnings: string[] = []): LogicResult<T> {
  return { ok: true, value, warnings };
}

function logicErr<T>(message: string, line?: number, lineText?: string): LogicResult<T> {
  return { ok: false, message, line, lineText };
}

/* ------------------------------------------------------------------ 通用小工具 */

/** 按 UTF-8 算字节数：中文一个字 3 字节，字符数会骗人，而 CSS/SQL 的体积要看字节。 */
function byteLength(text: string): number {
  return new TextEncoder().encode(text).length;
}

/** 行数：末尾换行不算多出来的一行。 */
function countLines(text: string): number {
  if (text === "") return 0;
  return text.replace(/\n$/, "").split("\n").length;
}

function linesOf(text: string): string[] {
  return text.replace(/\r\n?/g, "\n").split("\n");
}

function buildLineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

/** 字符位置 → 行号（二分查找，避免每次 slice 整个前缀）。 */
function lineAt(starts: number[], position: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (starts[mid] <= position) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

function lineTextAt(source: string, line: number): string {
  const lines = linesOf(source);
  return line >= 1 && line <= lines.length ? lines[line - 1] : "";
}

/** 把一段文本压成一行短摘要，用在「第 N 行的 xxx 有问题」这种提示里。 */
function clipText(text: string, max = 46): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max)}…`;
}

function kbText(bytes: number): string {
  const kb = bytes / 1024;
  if (kb >= 100) return `${Math.round(kb)} KB`;
  return `${kb.toFixed(kb < 10 ? 2 : 1)} KB`;
}

/** 省下的百分比，保留一位小数。 */
function savedPercent(before: number, after: number): number {
  if (before <= 0) return 0;
  return Math.round(((before - after) / before) * 1000) / 10;
}

/** 「1MB 以上」的大输入判定：仍然处理，只是先在界面上提示一句。 */
const LARGE_INPUT_BYTES = 1024 * 1024;

function isLargeInput(text: string): boolean {
  return byteLength(text) > LARGE_INPUT_BYTES;
}

/* ==========================================================================================
 * 一、CSS：解析 → 格式化 / 压缩
 *
 * 解析用「显式栈」而不是递归：样式表可以被人为嵌套到几千层，递归写法的调用栈会直接爆掉，
 * 显式栈配上深度上限（CSS_MAX_DEPTH）最多是解析得浅一点，不会把主线程卡死。
 *
 * 三条「绝不能压坏」的红线，压缩与格式化都靠扫描器里统一的状态判断来守住：
 *   - 引号里的内容（`content: "a;b"`、`[data-x="a b"]`）原样搬运；
 *   - `url(...)` 里的内容（`url(a.png?x=1&y=2)`、`url(data:image/png;base64,…)`）整段原样搬运；
 *   - 注释里的 `{ } ; "` 不参与结构判断。
 * ========================================================================================== */

type CssDecl = { kind: "decl"; prop: string; value: string; line: number };
type CssComment = { kind: "comment"; text: string; line: number };
type CssRaw = { kind: "raw"; text: string; line: number };
type CssAt = { kind: "at"; text: string; line: number };
type CssRule = { kind: "rule"; prelude: string; children: CssNode[]; line: number };
type CssNode = CssDecl | CssComment | CssRaw | CssAt | CssRule;

/** 嵌套深度上限：超过就不再往里解析，直接报错，避免超深嵌套把主线程占死。 */
const CSS_MAX_DEPTH = 64;

type CssTextOptions = { collapseCommas?: boolean; shrinkHex?: boolean };

const RE_HEX6 = /#([0-9a-fA-F]{6})(?![0-9a-fA-F])/y;

function isSpaceChar(char: string): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f";
}

/**
 * CSS 片段（选择器 / 声明值）的空白归一化。
 * 引号内与 url() 内**一个字符都不动**；其余位置把连续空白并成一个空格。
 */
function normalizeCssText(text: string, options: CssTextOptions = {}): string {
  const collapseCommas = options.collapseCommas === true;
  const shrinkHex = options.shrinkHex === true;
  let out = "";
  let quote: string | null = null;
  let urlDepth = 0;
  let pendingSpace = false;
  let i = 0;

  while (i < text.length) {
    const char = text[i];

    // url(...) 内部：整段原样搬运（里面有 ? & = : ; / 甚至中文，动一下就可能失效）
    if (urlDepth > 0) {
      if (char === ")") urlDepth--;
      out += char;
      i++;
      continue;
    }

    // 引号内部：原样搬运，含转义
    if (quote !== null) {
      out += char;
      if (char === "\\" && i + 1 < text.length) {
        out += text[i + 1];
        i += 2;
        continue;
      }
      if (char === quote) quote = null;
      i++;
      continue;
    }

    if (isSpaceChar(char)) {
      let j = i;
      while (j < text.length && isSpaceChar(text[j])) j++;
      pendingSpace = true;
      i = j;
      continue;
    }

    // 到这里 char 是一个有意义的字符，先把攒着的空白吐出去
    if (pendingSpace) {
      pendingSpace = false;
      if (!(collapseCommas && char === ",")) out += " ";
    }

    if (char === '"' || char === "'") {
      quote = char;
      out += char;
      i++;
      continue;
    }

    if (char === "(") {
      // 往前看这个括号前面是不是 url（用倒着数字母的方式判断，避免正则回溯扫描整串）
      let k = out.length;
      while (k > 0 && /[A-Za-z-]/.test(out[k - 1])) k--;
      if (out.slice(k).toLowerCase() === "url") urlDepth++;
      out += char;
      i++;
      continue;
    }

    if (char === "," && collapseCommas) {
      while (out.endsWith(" ")) out = out.slice(0, -1);
      out += ",";
      i++;
      while (i < text.length && (text[i] === " " || text[i] === "\t")) i++;
      continue;
    }

    if (char === "#" && shrinkHex) {
      RE_HEX6.lastIndex = i;
      const match = RE_HEX6.exec(text);
      if (match !== null) {
        const body = match[1].toLowerCase();
        if (body[0] === body[1] && body[2] === body[3] && body[4] === body[5]) {
          out += `#${body[0]}${body[2]}${body[4]}`;
          i += 7;
          continue;
        }
      }
    }

    out += char;
    i++;
  }

  return out.trim();
}

/** 去掉 CSS 注释（保留引号内的 `/*`，那不是注释）。 */
function stripCssComments(text: string): string {
  let out = "";
  let quote: string | null = null;
  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (quote !== null) {
      out += char;
      if (char === "\\" && i + 1 < text.length) {
        out += text[i + 1];
        i += 2;
        continue;
      }
      if (char === quote) quote = null;
      i++;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      out += char;
      i++;
      continue;
    }
    if (char === "/" && text[i + 1] === "*") {
      const end = text.indexOf("*/", i + 2);
      if (end === -1) {
        out += text.slice(i);
        break;
      }
      out += " ";
      i = end + 2;
      continue;
    }
    out += char;
    i++;
  }
  return out;
}

/** 找声明里的冒号：跳过引号、括号、中括号里的冒号（`url(data:...)`、`[href^="http:"]`）。 */
function findDeclarationColon(text: string): number {
  let quote: string | null = null;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote !== null) {
      if (char === "\\") {
        i++;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "(" || char === "[") {
      depth++;
      continue;
    }
    if (char === ")" || char === "]") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (char === ":" && depth === 0) return i;
  }
  return -1;
}

/** 解析 CSS 文本。返回扁平的节点森林（规则块自己带 children）。 */
function parseCss(source: string): LogicResult<CssNode[]> {
  const src = source.replace(/\r\n?/g, "\n");
  const starts = buildLineStarts(src);
  const root: CssNode[] = [];
  const warnings: string[] = [];
  const stack: Array<{ children: CssNode[]; braceLine: number }> = [];

  let buffer = "";
  let parenDepth = 0;
  let parenLine = 1;
  let i = 0;

  const currentChildren = (): CssNode[] => (stack.length === 0 ? root : stack[stack.length - 1].children);

  const addDeclaration = (line: number) => {
    const text = buffer.trim();
    buffer = "";
    if (text === "") return;
    if (text.startsWith("@")) {
      currentChildren().push({ kind: "at", text, line });
      return;
    }
    const colon = findDeclarationColon(text);
    if (colon === -1) {
      warnings.push(`第 ${line} 行的「${clipText(text)}」里没有冒号，不像是声明，已经原样留在结果里。`);
      currentChildren().push({ kind: "raw", text, line });
      return;
    }
    const prop = text.slice(0, colon).trim();
    const value = text.slice(colon + 1).trim();
    if (prop === "") {
      warnings.push(`第 ${line} 行的属性名是空的，已经原样留在结果里。`);
      currentChildren().push({ kind: "raw", text, line });
      return;
    }
    currentChildren().push({ kind: "decl", prop, value, line });
  };

  while (i < src.length) {
    const char = src[i];

    // 注释：只在「还没开始攒内容」时作为独立节点，否则留在值里面（例如 color: red /* x */）
    if (char === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end === -1) {
        const line = lineAt(starts, i);
        return logicErr(
          `第 ${line} 行的 /* 注释没有闭合（一直到这段 CSS 结束都没等到 */）。`,
          line,
          lineTextAt(source, line),
        );
      }
      const text = src.slice(i, end + 2);
      if (buffer.trim() === "") currentChildren().push({ kind: "comment", text, line: lineAt(starts, i) });
      else buffer += text;
      i = end + 2;
      continue;
    }

    // 字符串：整体吃进来，里面的 ; { } 不算结构
    if (char === '"' || char === "'") {
      let j = i + 1;
      let closed = false;
      while (j < src.length) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === char) {
          closed = true;
          j++;
          break;
        }
        if (src[j] === "\n") break;
        j++;
      }
      if (!closed) {
        const line = lineAt(starts, i);
        return logicErr(
          `第 ${line} 行有一个引号没有收尾（少了配对的 ${char}）。`,
          line,
          lineTextAt(source, line),
        );
      }
      buffer += src.slice(i, j);
      i = j;
      continue;
    }

    if (char === "(") {
      if (parenDepth === 0) parenLine = lineAt(starts, i);
      parenDepth++;
      buffer += char;
      i++;
      continue;
    }

    if (char === ")" && parenDepth > 0) {
      parenDepth--;
      buffer += char;
      i++;
      continue;
    }

    // 括号里的 { } ; 是函数参数的一部分（data URI 里就有），不参与结构判断
    if (parenDepth === 0) {
      if (char === "{") {
        const prelude = buffer.trim();
        buffer = "";
        const line = lineAt(starts, i);
        if (prelude === "") {
          return logicErr(`第 ${line} 行出现了一个 {，但它前面没有选择器。`, line, lineTextAt(source, line));
        }
        if (stack.length >= CSS_MAX_DEPTH) {
          return logicErr(
            `CSS 嵌套超过了 ${CSS_MAX_DEPTH} 层，这个工具不再往里解析（避免页面卡住）。`,
            line,
            lineTextAt(source, line),
          );
        }
        const rule: CssRule = { kind: "rule", prelude, children: [], line };
        currentChildren().push(rule);
        stack.push({ children: rule.children, braceLine: line });
        i++;
        continue;
      }

      if (char === "}") {
        const line = lineAt(starts, i);
        if (buffer.trim() !== "") addDeclaration(line);
        if (stack.length === 0) {
          return logicErr(`第 ${line} 行多了一个 }，前面没有和它配对的 {。`, line, lineTextAt(source, line));
        }
        stack.pop();
        i++;
        continue;
      }

      if (char === ";") {
        const line = lineAt(starts, i);
        if (stack.length > 0) {
          addDeclaration(line);
        } else {
          const text = buffer.trim();
          buffer = "";
          if (text !== "" && !text.startsWith("@")) {
            return logicErr(
              `第 ${line} 行在规则块外面出现了「${clipText(text)};」。声明要包在选择器里，例如 .card { ${clipText(text, 24)}; }`,
              line,
              lineTextAt(source, line),
            );
          }
          if (text !== "") currentChildren().push({ kind: "at", text, line });
        }
        i++;
        continue;
      }
    }

    buffer += char;
    i++;
  }

  if (stack.length > 0) {
    const open = stack[stack.length - 1];
    return logicErr(
      `第 ${open.braceLine} 行开始的 { 没有闭合（一直到这段 CSS 结束都没等到 }）。`,
      open.braceLine,
      lineTextAt(source, open.braceLine),
    );
  }

  if (parenDepth > 0) {
    return logicErr(
      `第 ${parenLine} 行的 ( 没有闭合，后面的内容都被当成括号里的参数了。`,
      parenLine,
      lineTextAt(source, parenLine),
    );
  }

  const leftover = buffer.trim();
  if (leftover !== "") {
    return logicErr(
      `这段内容里的「${clipText(leftover)}」没有放在 { } 里，不是完整的 CSS。只格式化零散声明时，请把它们包进选择器，例如 .box { ${clipText(leftover, 24)} }。`,
    );
  }

  return logicOk(root, warnings);
}

type CssFormatOptions = { indentUnit: string; keepComments: boolean };

/** 格式化：选择器独立成行、每条声明一行、冒号后一个空格、按嵌套层级缩进。 */
function formatCss(nodes: CssNode[], options: CssFormatOptions): string {
  const out: string[] = [];
  const pad = (level: number) => options.indentUnit.repeat(Math.max(0, level));
  const frames: Array<{ children: CssNode[]; index: number; level: number; closeLevel: number | null }> = [
    { children: nodes, index: 0, level: 0, closeLevel: null },
  ];
  let topLevelItems = 0;

  const beforeTopLevel = (level: number) => {
    if (level !== 0) return;
    if (topLevelItems > 0) out.push("");
    topLevelItems++;
  };

  while (frames.length > 0) {
    const frame = frames[frames.length - 1];
    if (frame.index >= frame.children.length) {
      frames.pop();
      if (frame.closeLevel !== null) out.push(`${pad(frame.closeLevel)}}`);
      continue;
    }
    const node = frame.children[frame.index++];

    if (node.kind === "comment") {
      if (!options.keepComments) continue;
      beforeTopLevel(frame.level);
      out.push(`${pad(frame.level)}${node.text.trim()}`);
      continue;
    }

    if (node.kind === "at") {
      const text = normalizeCssText(options.keepComments ? node.text : stripCssComments(node.text));
      if (text === "") continue;
      beforeTopLevel(frame.level);
      out.push(`${pad(frame.level)}${text}${text.endsWith(";") ? "" : ";"}`);
      continue;
    }

    if (node.kind === "raw") {
      const text = normalizeCssText(options.keepComments ? node.text : stripCssComments(node.text));
      if (text === "") continue;
      out.push(`${pad(frame.level)}${text}`);
      continue;
    }

    if (node.kind === "decl") {
      const value = normalizeCssText(options.keepComments ? node.value : stripCssComments(node.value));
      if (value === "") continue;
      out.push(`${pad(frame.level)}${node.prop.trim()}: ${value};`);
      continue;
    }

    const prelude = normalizeCssText(options.keepComments ? node.prelude : stripCssComments(node.prelude));
    const children = options.keepComments
      ? node.children
      : node.children.filter((child) => child.kind !== "comment");
    beforeTopLevel(frame.level);
    if (children.length === 0) {
      out.push(`${pad(frame.level)}${prelude} {}`);
      continue;
    }
    out.push(`${pad(frame.level)}${prelude} {`);
    frames.push({ children: node.children, index: 0, level: frame.level + 1, closeLevel: frame.level });
  }

  return `${out.join("\n")}\n`;
}

type CssMinifyOptions = { keepComments: boolean; shrinkHex: boolean };

/** 压缩：去注释、去多余空白、去掉块里最后一条声明的分号。 */
function minifyCss(nodes: CssNode[], options: CssMinifyOptions): string {
  const parts: string[] = [];
  const frames: Array<{ children: CssNode[]; index: number; closeBrace: boolean }> = [
    { children: nodes, index: 0, closeBrace: false },
  ];

  while (frames.length > 0) {
    const frame = frames[frames.length - 1];
    if (frame.index >= frame.children.length) {
      frames.pop();
      if (frame.closeBrace) {
        const last = parts.length - 1;
        if (last >= 0 && parts[last].endsWith(";")) parts[last] = parts[last].slice(0, -1);
        parts.push("}");
      }
      continue;
    }
    const node = frame.children[frame.index++];

    if (node.kind === "comment") {
      if (options.keepComments) parts.push(node.text.trim());
      continue;
    }

    if (node.kind === "at" || node.kind === "raw") {
      const text = normalizeCssText(
        options.keepComments ? node.text : stripCssComments(node.text),
        { collapseCommas: true },
      );
      if (text === "") continue;
      parts.push(node.kind === "at" && !text.endsWith(";") ? `${text};` : text);
      continue;
    }

    if (node.kind === "decl") {
      const prop = node.prop.trim();
      const value = normalizeCssText(options.keepComments ? node.value : stripCssComments(node.value), {
        collapseCommas: true,
        shrinkHex: options.shrinkHex,
      });
      if (prop === "" || value === "") continue;
      parts.push(`${prop}:${value};`);
      continue;
    }

    const prelude = normalizeCssText(
      options.keepComments ? node.prelude : stripCssComments(node.prelude),
      { collapseCommas: true },
    );
    if (node.children.length === 0) {
      parts.push(`${prelude}{}`);
      continue;
    }
    parts.push(`${prelude}{`);
    frames.push({ children: node.children, index: 0, closeBrace: true });
  }

  return `${parts.join("")}\n`;
}

type CssStats = { rules: number; selectors: number; declarations: number; atStatements: number; comments: number };

/** 逗号分隔的选择器个数（引号、括号、中括号里的逗号不算）。 */
function countSelectors(prelude: string): number {
  let count = 0;
  let current = false;
  let quote: string | null = null;
  let depth = 0;
  for (let i = 0; i < prelude.length; i++) {
    const char = prelude[i];
    if (quote !== null) {
      if (char === "\\") {
        i++;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current = true;
      continue;
    }
    if (char === "(" || char === "[") {
      depth++;
      current = true;
      continue;
    }
    if (char === ")" || char === "]") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (char === "," && depth === 0) {
      if (current) count++;
      current = false;
      continue;
    }
    if (!isSpaceChar(char)) current = true;
  }
  if (current) count++;
  return Math.max(1, count);
}

function cssStats(nodes: CssNode[]): CssStats {
  const stats: CssStats = { rules: 0, selectors: 0, declarations: 0, atStatements: 0, comments: 0 };
  const stack: CssNode[][] = [nodes];
  while (stack.length > 0) {
    const list = stack.pop() as CssNode[];
    for (const node of list) {
      if (node.kind === "comment") stats.comments++;
      else if (node.kind === "decl") stats.declarations++;
      else if (node.kind === "at") stats.atStatements++;
      else if (node.kind === "rule") {
        stats.rules++;
        stats.selectors += countSelectors(node.prelude);
        if (node.children.length > 0) stack.push(node.children);
      }
    }
  }
  return stats;
}

/* ==========================================================================================
 * 二、SQL：词法分析 → 美化 / 压缩 / 高亮
 *
 * 只做词法级别的排版，不建语法树 —— 这样对任何方言都不会「改坏语义」：
 *   - 字符串字面量（'...'，含 '' 转义）、双引号/反引号标识符、Postgres 的 $$...$$ 整体原样保留；
 *   - 注释 -- ... 与 /* ... *\/ 原样保留（不参与大小写、不拆行）；
 *   - 只对内置词表里的关键字改大小写，数据类型名与函数名不动。
 * ========================================================================================== */

type SqlTokenKind = "keyword" | "word" | "string" | "number" | "param" | "punct" | "lineComment" | "blockComment" | "space";

type SqlToken = { kind: SqlTokenKind; text: string };

const SQL_KEYWORDS = new Set<string>([
  // 查询
  "SELECT", "FROM", "WHERE", "GROUP", "BY", "ORDER", "HAVING", "LIMIT", "OFFSET", "FETCH", "NEXT", "ROWS", "ONLY",
  "DISTINCT", "ALL", "AS", "AND", "OR", "NOT", "IN", "EXISTS", "BETWEEN", "LIKE", "ILIKE", "IS", "NULL", "TRUE", "FALSE",
  "CASE", "WHEN", "THEN", "ELSE", "END", "CAST", "OVER", "PARTITION", "WINDOW", "ASC", "DESC", "NULLS", "FIRST", "LAST",
  "JOIN", "INNER", "LEFT", "RIGHT", "FULL", "OUTER", "CROSS", "ON", "USING", "UNION", "EXCEPT", "INTERSECT", "RECURSIVE",
  "WITH", "RETURNING", "INTO", "TOP", "PERCENT", "TIES",
  // 写入与结构
  "INSERT", "VALUES", "UPDATE", "SET", "DELETE", "MERGE", "MATCHED", "TARGET", "SOURCE", "CREATE", "TABLE", "VIEW",
  "INDEX", "UNIQUE", "ALTER", "DROP", "TRUNCATE", "PRIMARY", "KEY", "FOREIGN", "REFERENCES", "DEFAULT", "CHECK",
  "CONSTRAINT", "CASCADE", "RESTRICT", "ADD", "COLUMN", "RENAME", "TO", "IF", "REPLACE", "TEMPORARY", "DATABASE", "SCHEMA",
  // 事务与脚本
  "BEGIN", "COMMIT", "ROLLBACK", "TRANSACTION", "DECLARE", "GRANT", "REVOKE", "EXPLAIN", "ANALYZE", "PRAGMA", "GO",
]);

/** 会另起一行的子句起始词（词组用第一个词定位，紧跟的伙伴词保持同行，见 SQL_PARTNERS）。 */
const SQL_CLAUSE_START = new Set<string>([
  "SELECT", "FROM", "WHERE", "GROUP", "ORDER", "HAVING", "LIMIT", "OFFSET", "FETCH", "UNION", "EXCEPT", "INTERSECT",
  "INSERT", "VALUES", "UPDATE", "SET", "DELETE", "CREATE", "ALTER", "DROP", "TRUNCATE", "MERGE", "WITH", "RETURNING",
  "WINDOW", "JOIN", "LEFT", "RIGHT", "FULL", "INNER", "CROSS", "OUTER",
  "AND", "OR", "BEGIN", "COMMIT", "ROLLBACK", "DECLARE", "GRANT", "REVOKE", "EXPLAIN", "END",
]);

/** 这些子句的「内容」比子句本身再缩进一层（字段列表、表列表、值列表…）。 */
const SQL_CONTENT_CLAUSE = new Set<string>([
  "SELECT", "FROM", "GROUP", "ORDER", "SET", "VALUES", "RETURNING", "INSERT", "PARTITION", "WINDOW",
]);

/** 内容需要另起一行（一个字段一行）的子句。ORDER BY / GROUP BY 的首个字段留在子句行上。 */
const SQL_BREAK_AFTER = new Set<string>(["SELECT", "SET", "VALUES"]);

/** 伙伴词：紧跟在子句首词后面的词保持同一行（DELETE FROM / INSERT INTO / LEFT JOIN / GROUP BY…）。 */
const SQL_PARTNERS: Record<string, string[]> = {
  DELETE: ["FROM"],
  INSERT: ["INTO"],
  MERGE: ["INTO"],
  REPLACE: ["INTO"],
  CREATE: ["TABLE", "VIEW", "INDEX", "UNIQUE", "TEMPORARY", "DATABASE", "SCHEMA"],
  ALTER: ["TABLE", "VIEW", "INDEX"],
  DROP: ["TABLE", "VIEW", "INDEX", "DATABASE", "SCHEMA"],
  TRUNCATE: ["TABLE"],
  GROUP: ["BY"],
  ORDER: ["BY"],
  PARTITION: ["BY"],
  UNION: ["ALL", "DISTINCT"],
  EXCEPT: ["ALL"],
  INTERSECT: ["ALL"],
  LEFT: ["JOIN", "OUTER"],
  RIGHT: ["JOIN", "OUTER"],
  FULL: ["JOIN", "OUTER"],
  INNER: ["JOIN"],
  CROSS: ["JOIN"],
  OUTER: ["JOIN"],
  IS: ["NOT"],
  NOT: ["IN", "LIKE", "ILIKE", "EXISTS", "BETWEEN", "NULL"],
  WITH: ["RECURSIVE"],
  SELECT: ["DISTINCT", "ALL", "TOP"],
};

const RE_SQL_WORD = /[A-Za-z_\u0080-\uffff][A-Za-z0-9_$\u0080-\uffff]*/y;
const RE_SQL_NUMBER = /(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d*)?(?:[eE][-+]?\d+)?|\.\d+(?:[eE][-+]?\d+)?)/y;
const RE_SQL_DOLLAR_STRING = /\$([A-Za-z_][A-Za-z0-9_]*)?\$/y;
const RE_SQL_DOLLAR_NUMBER = /\$\d+/y;
const RE_SQL_VARIABLE = /[@:][A-Za-z_][A-Za-z0-9_$]*/y;

/** 从下标处做粘性匹配（sticky），避免 slice 出整条尾巴（那会是 O(n²)）。 */
function matchAt(regex: RegExp, source: string, index: number): string | null {
  regex.lastIndex = index;
  const match = regex.exec(source);
  return match === null ? null : match[0];
}

function isDigitChar(char: string | undefined): boolean {
  return char !== undefined && char >= "0" && char <= "9";
}

function isWordStartChar(char: string | undefined): boolean {
  return char !== undefined && /[A-Za-z_\u0080-\uffff]/.test(char);
}

function tokenizeSql(source: string, keepSpace = false): LogicResult<SqlToken[]> {
  const src = source.replace(/\r\n?/g, "\n");
  const starts = buildLineStarts(src);
  const tokens: SqlToken[] = [];
  const push = (kind: SqlTokenKind, text: string) => {
    tokens.push({ kind, text });
  };
  let i = 0;

  while (i < src.length) {
    const char = src[i];

    if (isSpaceChar(char)) {
      let j = i;
      while (j < src.length && isSpaceChar(src[j])) j++;
      if (keepSpace) push("space", src.slice(i, j));
      i = j;
      continue;
    }

    if (char === "-" && src[i + 1] === "-") {
      let j = i + 2;
      while (j < src.length && src[j] !== "\n") j++;
      push("lineComment", src.slice(i, j));
      i = j;
      continue;
    }

    if (char === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end === -1) {
        const line = lineAt(starts, i);
        return logicErr(
          `第 ${line} 行的 /* 注释没有闭合（少了 */）。`,
          line,
          lineTextAt(source, line),
        );
      }
      push("blockComment", src.slice(i, end + 2));
      i = end + 2;
      continue;
    }

    if (char === "'" || char === '"' || char === "`") {
      let j = i + 1;
      let closed = false;
      while (j < src.length) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === char) {
          if (src[j + 1] === char) {
            j += 2;
            continue;
          }
          closed = true;
          j++;
          break;
        }
        if (src[j] === "\n") break;
        j++;
      }
      if (!closed) {
        const line = lineAt(starts, i);
        return logicErr(
          `第 ${line} 行有一个引号没有收尾（少了配对的 ${char}）。`,
          line,
          lineTextAt(source, line),
        );
      }
      push("string", src.slice(i, j));
      i = j;
      continue;
    }

    if (char === "$") {
      const delimiter = matchAt(RE_SQL_DOLLAR_STRING, src, i);
      if (delimiter !== null) {
        const end = src.indexOf(delimiter, i + delimiter.length);
        if (end === -1) {
          const line = lineAt(starts, i);
          return logicErr(
            `第 ${line} 行的 ${delimiter} 字符串没有收尾（少了配对的 ${delimiter}）。`,
            line,
            lineTextAt(source, line),
          );
        }
        push("string", src.slice(i, end + delimiter.length));
        i = end + delimiter.length;
        continue;
      }
      const dollarNumber = matchAt(RE_SQL_DOLLAR_NUMBER, src, i);
      if (dollarNumber !== null) {
        push("param", dollarNumber);
        i += dollarNumber.length;
        continue;
      }
    }

    if (char === "?") {
      push("param", "?");
      i++;
      continue;
    }

    if ((char === "@" || char === ":") && isWordStartChar(src[i + 1])) {
      const variable = matchAt(RE_SQL_VARIABLE, src, i);
      if (variable !== null) {
        push("param", variable);
        i += variable.length;
        continue;
      }
    }

    if (isDigitChar(char) || (char === "." && isDigitChar(src[i + 1]))) {
      const number = matchAt(RE_SQL_NUMBER, src, i);
      if (number !== null) {
        push("number", number);
        i += number.length;
        continue;
      }
    }

    if (isWordStartChar(char)) {
      const word = matchAt(RE_SQL_WORD, src, i) as string;
      push(SQL_KEYWORDS.has(word.toUpperCase()) ? "keyword" : "word", word);
      i += word.length;
      continue;
    }

    const two = src.slice(i, i + 2);
    if (
      two === "<=" || two === ">=" || two === "<>" || two === "!=" ||
      two === "||" || two === "::" || two === ":=" || two === "->" || two === "=>"
    ) {
      push("punct", two);
      i += 2;
      continue;
    }

    push("punct", char);
    i++;
  }

  return logicOk(tokens);
}

type SqlFormatOptions = {
  indentUnit: string;
  caseMode: "upper" | "lower" | "keep";
  oneFieldPerLine: boolean;
};

/** 关键词大小写。 */
function sqlCaseWord(word: string, mode: SqlFormatOptions["caseMode"]): string {
  if (mode === "upper") return word.toUpperCase();
  if (mode === "lower") return word.toLowerCase();
  return word;
}

/**
 * SQL 美化：主关键字另起一行、逗号后换行并缩进、括号内子查询缩进加深、JOIN 系列单独成行。
 * 字符串与注释由分词器整体保管，这里只重新分配它们的行与缩进。
 */
function formatSql(tokens: SqlToken[], options: SqlFormatOptions): string {
  const lines: string[] = [];
  let current = "";
  let lineLevel = 0;
  let indent = 0;
  let contentOffset = 0;
  let lastClauseKeyword: string | null = null;
  let signNext = false;

  const flush = () => {
    const trimmed = current.replace(/\s+$/, "");
    if (trimmed !== "") lines.push(`${options.indentUnit.repeat(Math.max(0, lineLevel))}${trimmed}`);
    current = "";
  };

  const write = (text: string, level: number, space = true) => {
    if (current === "") {
      lineLevel = level;
    } else if (space) {
      const last = current[current.length - 1];
      if (last !== " " && last !== "(" && last !== ".") current += " ";
    }
    current += text;
  };

  const parenStack: Array<{ sub: boolean; indent: number; contentOffset: number }> = [];
  const caseStack: number[] = [];

  /**
   * 逗号要在多深的嵌套里才换行。
   * 只按「当前子句自己那一层」换行：`IN ('paid', 'shipped')` 这种值列表不能被拆开，
   * 而子查询里的字段列表（括号深度与子句起点相同）照拆不误；
   * CREATE / ALTER TABLE 的列定义列表是包在括号里的，所以额外放宽一层。
   */
  let commaDepthLimit = 0;
  const enterClause = (head: string) => {
    commaDepthLimit = parenStack.length + (head === "CREATE" || head === "ALTER" ? 1 : 0);
  };

  /** CREATE / ALTER TABLE 后面的括号是列定义块：要和子查询一样整块缩进。 */
  let tableDefinitionClause = false;

  /** 子句首词后面要不要换行 —— 遇到 SELECT DISTINCT 这种词组时，等词组写完再换。 */
  let pendingHeadBreak = false;

  const significantAhead = (index: number): SqlToken | null => {
    for (let k = index + 1; k < tokens.length; k++) {
      const token = tokens[k];
      if (token.kind === "lineComment" || token.kind === "blockComment" || token.kind === "space") continue;
      return token;
    }
    return null;
  };

  const significantBehind = (index: number): SqlToken | null => {
    for (let k = index - 1; k >= 0; k--) {
      const token = tokens[k];
      if (token.kind === "lineComment" || token.kind === "blockComment" || token.kind === "space") continue;
      return token;
    }
    return null;
  };

  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];

    if (token.kind === "space") continue;

    if (token.kind === "lineComment") {
      write(token.text, indent + contentOffset);
      flush();
      lastClauseKeyword = null;
      continue;
    }

    if (token.kind === "blockComment") {
      write(token.text, indent + contentOffset);
      if (token.text.includes("\n")) flush();
      lastClauseKeyword = null;
      continue;
    }

    if (token.kind === "punct") {
      const text = token.text;

      if (text === ";") {
        current = `${current.replace(/\s+$/, "")};`;
        flush();
        indent = 0;
        contentOffset = 0;
        parenStack.length = 0;
        caseStack.length = 0;
        lastClauseKeyword = null;
        if (lines.length > 0 && lines[lines.length - 1] !== "") lines.push("");
        continue;
      }

      if (text === ",") {
        current = `${current.replace(/\s+$/, "")},`;
        if (options.oneFieldPerLine && parenStack.length <= commaDepthLimit) flush();
        else current += " ";
        lastClauseKeyword = null;
        continue;
      }

      if (text === "(") {
        const next = significantAhead(index);
        const isSubquery = next !== null && next.kind === "keyword" && ["SELECT", "WITH", "VALUES"].includes(next.text.toUpperCase());
        const isTableDefinition = tableDefinitionClause;
        const isBlock = isSubquery || isTableDefinition;
        const previous = significantBehind(index);
        const spaceBefore =
          isTableDefinition ||
          (previous !== null &&
            (previous.kind === "keyword" ||
              (previous.kind === "punct" && ![ "(", ",", ".", ";", "::" ].includes(previous.text))));
        write("(", indent + contentOffset, spaceBefore);
        parenStack.push({ sub: isBlock, indent, contentOffset });
        contentOffset = 0;
        tableDefinitionClause = false;
        if (isBlock) {
          indent += 1;
          flush();
        }
        lastClauseKeyword = null;
        continue;
      }

      if (text === ")") {
        const frame = parenStack.pop();
        if (frame !== undefined) {
          indent = frame.indent;
          contentOffset = frame.contentOffset;
          if (frame.sub) flush();
        }
        write(")", frame !== undefined ? frame.indent : indent, false);
        lastClauseKeyword = null;
        continue;
      }

      if (text === "." || text === "::") {
        write(text, indent + contentOffset, false);
        lastClauseKeyword = null;
        continue;
      }

      // 正负号：`-1` 不能写成 `- 1`，但 `a - 1` 要保持空格
      if (text === "+" || text === "-") {
        const previous = significantBehind(index);
        signNext =
          previous === null ||
          previous.kind === "punct" ||
          (previous.kind === "keyword" && !["NULL", "TRUE", "FALSE", "END"].includes(previous.text.toUpperCase()));
      }

      write(text, indent + contentOffset, !signNext);
      signNext = false;
      lastClauseKeyword = null;
      continue;
    }

    if (token.kind === "keyword") {
      const upper = token.text.toUpperCase();
      const cased = sqlCaseWord(token.text, options.caseMode);
      const previousUpper: string | null = lastClauseKeyword;
      const partnerOk =
        previousUpper !== null &&
        current !== "" &&
        (SQL_PARTNERS[previousUpper] ?? []).includes(upper);

      if (partnerOk) {
        write(cased, indent + contentOffset, true);
        lastClauseKeyword = upper;
        signNext = false;
        if (pendingHeadBreak) {
          pendingHeadBreak = false;
          flush();
        }
        continue;
      }

      if (upper === "CASE") {
        write(cased, indent + contentOffset, true);
        caseStack.push(contentOffset);
        contentOffset = 1;
        enterClause("CASE");
        lastClauseKeyword = null;
        signNext = false;
        continue;
      }

      if (upper === "WHEN" || (upper === "ELSE" && caseStack.length > 0)) {
        flush();
        write(cased, indent + 1, false);
        contentOffset = 1;
        enterClause("WHEN");
        lastClauseKeyword = null;
        signNext = false;
        continue;
      }

      if (upper === "END" && caseStack.length > 0) {
        flush();
        const restored = caseStack.pop();
        write(cased, indent, false);
        contentOffset = restored === undefined ? 0 : restored;
        lastClauseKeyword = upper;
        signNext = false;
        continue;
      }

      if (SQL_CLAUSE_START.has(upper)) {
        if (upper === "AND" || upper === "OR") {
          flush();
          write(cased, indent + 1, false);
          contentOffset = 1;
          enterClause(upper);
          lastClauseKeyword = upper;
          signNext = false;
          continue;
        }
        flush();
        write(cased, indent, false);
        contentOffset = SQL_CONTENT_CLAUSE.has(upper) ? 1 : 0;
        enterClause(upper);
        tableDefinitionClause = upper === "CREATE" || upper === "ALTER";
        pendingHeadBreak = options.oneFieldPerLine && SQL_BREAK_AFTER.has(upper);
        {
          // SELECT DISTINCT 这类词组要写在同一行，等词组写完再换行
          const nextToken = significantAhead(index);
          const nextUpper = nextToken !== null && nextToken.kind === "keyword" ? nextToken.text.toUpperCase() : "";
          const partnerFollows = nextUpper !== "" && (SQL_PARTNERS[upper] ?? []).includes(nextUpper);
          if (pendingHeadBreak && !partnerFollows) {
            pendingHeadBreak = false;
            flush();
          }
        }
        lastClauseKeyword = upper;
        signNext = false;
        continue;
      }

      if (upper === "ON") {
        flush();
        write(cased, indent + 1, false);
        contentOffset = 0;
        enterClause(upper);
        lastClauseKeyword = upper;
        signNext = false;
        continue;
      }

      write(cased, indent + contentOffset, !signNext);
      signNext = false;
      lastClauseKeyword = upper;
      continue;
    }

    write(token.text, indent + contentOffset, !signNext);
    signNext = false;
    lastClauseKeyword = null;
  }

  flush();
  while (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
  return `${lines.join("\n")}\n`;
}

type SqlMinifyReport = { output: string; removedLineComments: number };

/** 压缩成单行：多余空白去掉。`--` 行注释会被丢掉（否则后面的语句会被整行注释掉），块注释保留。 */
function minifySql(tokens: SqlToken[], options: SqlFormatOptions): SqlMinifyReport {
  const parts: string[] = [];
  let removedLineComments = 0;
  let previous: SqlToken | null = null;
  let noSpaceNext = false;

  const NO_SPACE_BEFORE = new Set([")", ",", ";", ".", "(", "::"]);
  const NO_SPACE_AFTER = new Set(["(", ".", "::"]);

  for (const token of tokens) {
    if (token.kind === "space") continue;
    if (token.kind === "lineComment") {
      removedLineComments++;
      continue;
    }
    const text = token.kind === "keyword" ? sqlCaseWord(token.text, options.caseMode) : token.text;
    if (previous === null) {
      parts.push(text);
    } else if (noSpaceNext) {
      parts.push(text);
    } else {
      const needSpace = !NO_SPACE_BEFORE.has(token.text) && !NO_SPACE_AFTER.has(previous.text);
      parts.push(`${needSpace ? " " : ""}${text}`);
    }
    noSpaceNext =
      (token.text === "+" || token.text === "-") &&
      previous !== null &&
      (previous.kind === "punct" || previous.kind === "keyword");
    previous = token;
  }

  return { output: `${parts.join("").trim()}\n`, removedLineComments };
}

type SqlStatementStats = { statements: number; keywords: number; lineComments: number; blockComments: number };

function sqlStats(tokens: SqlToken[]): SqlStatementStats {
  const stats: SqlStatementStats = { statements: 0, keywords: 0, lineComments: 0, blockComments: 0 };
  let meaningful = false;
  for (const token of tokens) {
    if (token.kind === "keyword") stats.keywords++;
    else if (token.kind === "lineComment") stats.lineComments++;
    else if (token.kind === "blockComment") stats.blockComments++;
    if (token.kind === "space" || token.kind === "lineComment" || token.kind === "blockComment") continue;
    meaningful = true;
    if (token.kind === "punct" && token.text === ";") {
      stats.statements++;
      meaningful = false;
    }
  }
  if (meaningful) stats.statements++;
  return stats;
}

type SqlSegment = { kind: "keyword" | "string" | "number" | "comment" | "plain"; text: string };

/** 把「已排好版」的 SQL 切成上色片段（界面里用 <span> 渲染，不用 innerHTML）。 */
function highlightSql(source: string): SqlSegment[] {
  const tokenized = tokenizeSql(source, true);
  if (!tokenized.ok) return [{ kind: "plain", text: source }];

  const segments: SqlSegment[] = [];
  const push = (kind: SqlSegment["kind"], text: string) => {
    const last = segments[segments.length - 1];
    if (last !== undefined && last.kind === kind) last.text += text;
    else segments.push({ kind, text });
  };

  for (const token of tokenized.value) {
    if (token.kind === "keyword") push("keyword", token.text);
    else if (token.kind === "string") push("string", token.text);
    else if (token.kind === "number") push("number", token.text);
    else if (token.kind === "lineComment" || token.kind === "blockComment") push("comment", token.text);
    else push("plain", token.text);
  }

  return segments;
}

/* ==========================================================================================
 * 三、HTML 压缩
 *
 * 只做「机械」的空白与注释处理：<pre> / <textarea> / <script> / <style> 内部整段原样搬运，
 * 因为它们的内容对空白敏感（pre）或属于别的语言（script/style 交给各自的压缩器）。
 * ========================================================================================== */

type MinifyReport = { output: string; notes: string[]; removedComments: number; removedBlankLines: number };

const HTML_RAW_TEXT_TAGS = new Set(["pre", "textarea", "script", "style"]);

function htmlTagName(tag: string): string | null {
  const match = /^<\/?\s*([A-Za-z][A-Za-z0-9:-]*)/.exec(tag);
  return match === null ? null : match[1].toLowerCase();
}

/** 找标签的 `>`：属性值里的 `>` 不算（`title="a>b"` 这种情况）。 */
function findHtmlTagEnd(source: string, start: number): number {
  let quote: string | null = null;
  for (let i = start + 1; i < source.length; i++) {
    const char = source[i];
    if (quote !== null) {
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === ">") return i;
  }
  return -1;
}

/** 单个标签内部的空白压缩，以及（可选的）属性值去引号。 */
function minifyHtmlTag(tag: string, removeAttributeQuotes: boolean): string {
  let out = "";
  let pendingSpace = false;
  let afterEquals = false;
  let i = 0;

  while (i < tag.length) {
    const char = tag[i];

    if (char === '"' || char === "'") {
      let j = i + 1;
      while (j < tag.length && tag[j] !== char) j++;
      const value = tag.slice(i + 1, j);
      const closing = j < tag.length ? 1 : 0;
      // 去引号的三个前提：跟在 = 后面、值里没有空白或引号、不是空值
      if (afterEquals && removeAttributeQuotes && /^[^\s"'`=<>]+$/.test(value)) out += value;
      else out += tag.slice(i, j + closing);
      i = j + closing;
      afterEquals = false;
      pendingSpace = false;
      continue;
    }

    if (isSpaceChar(char)) {
      let j = i;
      while (j < tag.length && isSpaceChar(tag[j])) j++;
      pendingSpace = true;
      i = j;
      continue;
    }

    if (char === ">") {
      out = out.replace(/\s+$/, "");
      out += tag.slice(i);
      break;
    }

    if (char === "/" && tag[i + 1] === ">") {
      out = out.replace(/\s+$/, "");
      out += "/>";
      break;
    }

    if (out !== "") {
      const last = out[out.length - 1];
      if (pendingSpace && last !== "<" && last !== "=") out += " ";
    }
    pendingSpace = false;
    afterEquals = char === "=";
    out += char;
    i++;
  }

  return out;
}

function minifyHtml(source: string, options: { removeAttributeQuotes: boolean }): LogicResult<MinifyReport> {
  const src = source.replace(/\r\n?/g, "\n");
  const lower = src.toLowerCase();
  const starts = buildLineStarts(src);
  const notes: string[] = [];
  const preserved = new Set<string>();

  let out = "";
  let removedComments = 0;
  let droppedPureWhitespace = 0;
  let pos = 0;

  const lastOutChar = () => (out === "" ? "" : out[out.length - 1]);

  while (pos < src.length) {
    const lt = src.indexOf("<", pos);

    if (lt === -1) {
      const tail = src.slice(pos).replace(/[ \t\r\n\f]+/g, " ");
      if (tail.trim() !== "") out += tail;
      else if (lastOutChar() !== ">") out += tail;
      break;
    }

    if (lt > pos) {
      const chunk = src.slice(pos, lt);
      const collapsed = chunk.replace(/[ \t\r\n\f]+/g, " ");
      if (collapsed.trim() === "" && lastOutChar() === ">") droppedPureWhitespace++;
      else out += collapsed;
    }

    if (src.startsWith("<!--", lt)) {
      const end = src.indexOf("-->", lt + 4);
      if (end === -1) {
        const line = lineAt(starts, lt);
        return logicErr(`第 ${line} 行的注释没有收尾（少了 -->）。`, line, lineTextAt(src, line));
      }
      const text = src.slice(lt, end + 3);
      // 条件注释（<!--[if IE]>）是给老浏览器看的开关，删掉会改变行为，原样保留
      if (/^<!--\[if/i.test(text)) notes.push("条件注释 <!--[if …]> 原样保留（它会影响老浏览器的解析）。");
      else removedComments++;
      pos = end + 3;
      continue;
    }

    if (src.startsWith("<!", lt)) {
      const end = src.indexOf(">", lt);
      if (end === -1) {
        const line = lineAt(starts, lt);
        return logicErr(`第 ${line} 行的 <! 声明没有收尾（少了 >）。`, line, lineTextAt(src, line));
      }
      out += minifyHtmlTag(src.slice(lt, end + 1), false);
      pos = end + 1;
      continue;
    }

    const tagEnd = findHtmlTagEnd(src, lt);
    if (tagEnd === -1) {
      const line = lineAt(starts, lt);
      return logicErr(`第 ${line} 行的标签没有收尾（少了 >）。`, line, lineTextAt(src, line));
    }

    const tag = src.slice(lt, tagEnd + 1);
    out += minifyHtmlTag(tag, options.removeAttributeQuotes);
    const name = htmlTagName(tag);
    const isClosing = tag.startsWith("</");
    const isSelfClosing = tag.endsWith("/>");
    pos = tagEnd + 1;

    if (name !== null && !isClosing && !isSelfClosing && HTML_RAW_TEXT_TAGS.has(name)) {
      const closing = lower.indexOf(`</${name}`, pos);
      if (closing === -1) {
        notes.push(`<${name}> 没有找到结束标签，它后面的内容原样保留。`);
        out += src.slice(pos);
        pos = src.length;
        break;
      }
      out += src.slice(pos, closing);
      preserved.add(name);
      pos = closing;
    }
  }

  if (droppedPureWhitespace > 0) {
    notes.push("标签之间的纯空白已删除；靠标签间那个空格排版的地方（例如并排的两个链接）会贴在一起。");
  }
  if (preserved.size > 0) {
    const list = Array.from(preserved).map((name) => `<${name}>`).join(" 、 ");
    notes.push(`${list} 内部的内容整段原样保留（这些标签里的空白有意义，或者属于别的语言）。`);
  }
  if (options.removeAttributeQuotes) {
    notes.push("属性值只在不含空白和引号时才去掉引号，含空格的值（例如 class=\"a b\"）保持原样。");
  }

  const cleaned = `${out.replace(/^\s+/, "").replace(/\s+$/, "")}\n`;
  return logicOk({ output: cleaned, notes, removedComments, removedBlankLines: 0 });
}

/* ==========================================================================================
 * 四、JS 安全压缩
 *
 * 这个工具**不做变量重命名**（真正的混淆），因为浏览器里做词法作用域分析不安全：
 * 一旦把 eval / with / 全局引用判断错，代码会在线上才炸。这里只做「任何情况下都不改语义」的处理：
 *   - 去掉 // 与 /* *\/ 注释；
 *   - 合并连续空白、去掉行首行尾空白与空行；
 *   - 字符串、模板字符串（含 ${} 里的表达式）、正则字面量整体原样保留。
 * 两个必须踩准的坑：
 *   1. `"http://a.com"` 里的 // 不是注释，`/* *\/` 在字符串里也不是注释；
 *   2. 行注释、以及带换行的块注释，在 JS 语法里等价于一个换行 —— 必须补回换行，
 *      否则自动分号插入（ASI）的语义会被改掉（`return\n x` 就是个典型）。
 * ========================================================================================== */

type JsPrevKind = "none" | "word" | "value" | "close" | "punct";

const JS_REGEX_KEYWORD_BEFORE = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "case", "do",
  "else", "yield", "await", "throw",
]);

/** 这个 `/` 是正则字面量的开头还是除号？按前一个有意义记号的类型判断。 */
function jsRegexAllowed(prevKind: JsPrevKind, prevWord: string): boolean {
  if (prevKind === "none" || prevKind === "punct") return true;
  if (prevKind === "word") return JS_REGEX_KEYWORD_BEFORE.has(prevWord.toLowerCase());
  // value（字符串/模板/正则/数字的结果）与 close（) ] }）后面按除号处理
  return false;
}

function countBlankLines(text: string): number {
  const body = text.replace(/\n$/, "");
  if (body === "") return 0;
  let count = 0;
  for (const line of linesOf(body)) {
    if (line.trim() === "") count++;
  }
  return count;
}

function minifyJs(source: string): LogicResult<MinifyReport> {
  const src = source.replace(/\r\n?/g, "\n");
  const starts = buildLineStarts(src);
  const notes: string[] = [];
  const modes: Array<{ kind: "code"; braces: number } | { kind: "template" }> = [{ kind: "code", braces: 0 }];

  let out = "";
  let removedComments = 0;
  let pending: "" | " " | "\n" = "";
  let prevKind: JsPrevKind = "none";
  let prevWord = "";
  let i = 0;

  const fail = (message: string, position: number): LogicResult<MinifyReport> => {
    const line = lineAt(starts, position);
    return logicErr(`第 ${line} 行：${message}`, line, lineTextAt(src, line));
  };

  const flushPending = (nextChar: string) => {
    if (pending === "") return;
    if (pending === "\n") {
      if (out !== "" && !out.endsWith("\n")) out += "\n";
    } else if (out !== "" && !out.endsWith("\n")) {
      const last = out[out.length - 1];
      if (!";,({[".includes(last) && !",;)]}".includes(nextChar)) out += " ";
    }
    pending = "";
  };

  /** 换行优先于空格：原来的换行必须留下来（ASI）。 */
  const markSpace = (sawNewline: boolean) => {
    if (sawNewline) pending = "\n";
    else if (pending !== "\n") pending = " ";
  };

  while (i < src.length) {
    const mode = modes[modes.length - 1];

    if (mode.kind === "template") {
      const char = src[i];
      if (char === "\\") {
        out += src.slice(i, i + 2);
        i += 2;
        continue;
      }
      if (char === "`") {
        modes.pop();
        out += "`";
        prevKind = "value";
        prevWord = "";
        i++;
        continue;
      }
      if (char === "$" && src[i + 1] === "{") {
        modes.push({ kind: "code", braces: 0 });
        out += "${";
        prevKind = "punct";
        prevWord = "";
        i += 2;
        continue;
      }
      out += char;
      i++;
      continue;
    }

    const char = src[i];

    // 首行的 #! 直译器声明：整行保留
    if (i === 0 && char === "#" && src[1] === "!") {
      let j = 0;
      while (j < src.length && src[j] !== "\n") j++;
      out += src.slice(0, j);
      pending = "\n";
      i = j;
      continue;
    }

    if (isSpaceChar(char)) {
      let j = i;
      let sawNewline = false;
      while (j < src.length && isSpaceChar(src[j])) {
        if (src[j] === "\n") sawNewline = true;
        j++;
      }
      markSpace(sawNewline);
      i = j;
      continue;
    }

    if (char === "/" && src[i + 1] === "/") {
      let j = i + 2;
      while (j < src.length && src[j] !== "\n") j++;
      removedComments++;
      pending = "\n";
      i = j;
      continue;
    }

    if (char === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      if (end === -1) return fail("/* 注释没有闭合（少了 */）。", i);
      const body = src.slice(i, end + 2);
      removedComments++;
      markSpace(body.includes("\n"));
      i = end + 2;
      continue;
    }

    if (char === "'" || char === '"') {
      let j = i + 1;
      let closed = false;
      while (j < src.length) {
        if (src[j] === "\\") {
          j += 2;
          continue;
        }
        if (src[j] === char) {
          closed = true;
          j++;
          break;
        }
        if (src[j] === "\n") break;
        j++;
      }
      if (!closed) return fail("字符串没有收尾（少了配对的引号）。", i);
      flushPending(char);
      out += src.slice(i, j);
      prevKind = "value";
      prevWord = "";
      i = j;
      continue;
    }

    if (char === "`") {
      flushPending(char);
      modes.push({ kind: "template" });
      out += "`";
      prevKind = "value";
      prevWord = "";
      i++;
      continue;
    }

    if (char === "/" && jsRegexAllowed(prevKind, prevWord)) {
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < src.length) {
        const inner = src[j];
        if (inner === "\\") {
          j += 2;
          continue;
        }
        if (inner === "\n") break;
        if (inner === "[") {
          inClass = true;
          j++;
          continue;
        }
        if (inner === "]") {
          inClass = false;
          j++;
          continue;
        }
        if (inner === "/" && !inClass) {
          closed = true;
          j++;
          break;
        }
        j++;
      }
      if (!closed) return fail("正则字面量没有收尾（少了 /）。", i);
      while (j < src.length && /[a-z]/i.test(src[j])) j++;
      flushPending(char);
      out += src.slice(i, j);
      prevKind = "value";
      prevWord = "";
      i = j;
      continue;
    }

    if (char === "}" && mode.braces === 0 && modes.length > 1) {
      flushPending(char);
      out += "}";
      modes.pop();
      prevKind = "close";
      prevWord = "";
      i++;
      continue;
    }

    if (char === "{") mode.braces++;
    else if (char === "}") mode.braces = Math.max(0, mode.braces - 1);

    flushPending(char);
    out += char;
    if (/[A-Za-z0-9_$]/.test(char)) {
      prevWord += char;
      prevKind = "word";
    } else {
      prevWord = "";
      prevKind = char === ")" || char === "]" || char === "}" ? "close" : "punct";
    }
    i++;
  }

  if (modes.length > 1) return fail("模板字符串没有收尾（少了 `）。", src.length - 1);

  const output = `${out.replace(/\s+$/, "")}\n`;
  const removedBlankLines = Math.max(0, countBlankLines(src) - countBlankLines(output));

  if (removedComments > 0) {
    notes.push(`去掉了 ${removedComments} 处注释；行注释与带换行的块注释都换成了一个换行，自动分号插入的结果不变。`);
  }
  notes.push("字符串、模板字符串（含 ${} 里的表达式）、正则字面量整体原样保留，没有做变量重命名。");
  notes.push("保留原有换行，不做跨行合并。");

  return logicOk({ output, notes, removedComments, removedBlankLines });
}

/* ==========================================================================================
 * 五、JSON Schema（draft-07 子集）校验
 *
 * 手写校验器，只覆盖常用关键字。**不支持的关键字会原样列给用户看**（$ref / oneOf / allOf …），
 * 绝不假装校验过 —— 这类关键字一旦被忽略，结果就是「假通过」，比报错更危险。
 * ========================================================================================== */

type SchemaIssue = { path: string; keyword: string; message: string };

type SchemaReport = {
  errors: SchemaIssue[];
  hints: SchemaIssue[];
  unsupported: string[];
  checkedCount: number;
};

/** 明确不支持的关键字（会逐条列在界面上）。 */
const SCHEMA_UNSUPPORTED_KEYWORDS = [
  "$ref", "$dynamicRef", "$recursiveRef", "$anchor", "$defs", "definitions",
  "oneOf", "anyOf", "allOf", "not", "if", "then", "else",
  "dependencies", "dependentRequired", "dependentSchemas", "propertyNames", "patternProperties",
  "additionalItems", "contains", "minContains", "maxContains", "prefixItems",
  "unevaluatedProperties", "unevaluatedItems", "contentEncoding", "contentMediaType", "contentSchema",
];

/** 只做基础校验的 format（其余 format 只当标注，不校验）。 */
const SCHEMA_WEAK_FORMATS = ["date", "date-time", "email", "uri"];

const SCHEMA_TYPE_LABELS: Record<string, string> = {
  object: "对象",
  array: "数组",
  string: "字符串",
  number: "数字",
  integer: "整数",
  boolean: "布尔值",
  null: "null",
};

/** 递归深度上限：数据被构造成超深嵌套时不至于把主线程压在递归里。 */
const SCHEMA_DEPTH_LIMIT = 80;
const SCHEMA_UNIQUE_ITEMS_LIMIT = 2000;

function schemaTypeLabel(type: string): string {
  return SCHEMA_TYPE_LABELS[type] ?? type;
}

function schemaIsObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 待校验值的人话描述，直接用在校验错误里（「实际给的是字符串 "18"」）。 */
function schemaDescribeValue(value: unknown): string {
  if (value === undefined) return "没有这个字段";
  if (value === null) return "null";
  if (typeof value === "string") return `字符串 ${JSON.stringify(value)}`;
  if (typeof value === "number") return `数字 ${String(value)}`;
  if (typeof value === "boolean") return `布尔值 ${value ? "true" : "false"}`;
  if (Array.isArray(value)) return `数组（${value.length} 项）`;
  if (schemaIsObject(value)) return `对象（${Object.keys(value).length} 个字段）`;
  return String(value);
}

function schemaShortJson(value: unknown, max = 60): string {
  const text = JSON.stringify(value);
  if (text === undefined) return String(value);
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function schemaDeepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!schemaDeepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (schemaIsObject(a) && schemaIsObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    for (const key of keysA) {
      if (!Object.prototype.hasOwnProperty.call(b, key)) return false;
      if (!schemaDeepEqual(a[key], b[key])) return false;
    }
    return true;
  }
  return false;
}

function schemaMatchesType(value: unknown, type: string): boolean {
  switch (type) {
    case "object":
      return schemaIsObject(value);
    case "array":
      return Array.isArray(value);
    case "string":
      return typeof value === "string";
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "integer":
      return typeof value === "number" && Number.isInteger(value);
    case "boolean":
      return typeof value === "boolean";
    case "null":
      return value === null;
    default:
      return false;
  }
}

function schemaPath(parent: string, key: string): string {
  const escaped = key.replace(/~/g, "~0").replace(/\//g, "~1");
  return `${parent}/${escaped}`;
}

function schemaDisplayPath(path: string): string {
  return path === "" ? "/" : path;
}

function isRealDateText(text: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (match === null) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** 只做「看得出来就不对」的基础格式判断：够用，但不等于完整校验。 */
function checkWeakFormat(format: string, value: string): { expectation: string; ok: boolean } | null {
  if (format === "date") {
    return { expectation: "YYYY-MM-DD 形式的真实日期", ok: isRealDateText(value) };
  }
  if (format === "date-time") {
    const match = /^(\d{4}-\d{2}-\d{2})[Tt](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?([Zz]|[+-]\d{2}:\d{2})$/.exec(value);
    const ok =
      match !== null &&
      isRealDateText(match[1]) &&
      Number(match[2]) <= 23 &&
      Number(match[3]) <= 59 &&
      (match[4] === undefined || Number(match[4]) <= 60);
    return { expectation: "ISO 8601 的日期时间（yyyy-MM-ddTHH:mm:ssZ）", ok };
  }
  if (format === "email") {
    return { expectation: "含 @ 与域名后缀的邮箱形式", ok: /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value) };
  }
  if (format === "uri") {
    return { expectation: "带协议前缀的 URI", ok: /^[A-Za-z][A-Za-z0-9+.-]*:[^\s]*$/.test(value) };
  }
  return null;
}

/** 沿「子 schema 的位置」收集不支持的关键字（不把 enum/const 里的普通数据当 schema 看）。 */
function collectUnsupportedKeywords(root: unknown): string[] {
  const found = new Set<string>();
  const queue: unknown[] = [root];
  let cursor = 0;
  while (cursor < queue.length && cursor < 5000) {
    const node = queue[cursor++];
    if (!schemaIsObject(node)) continue;
    for (const key of Object.keys(node)) {
      if (SCHEMA_UNSUPPORTED_KEYWORDS.includes(key)) found.add(key);
    }
    if (schemaIsObject(node.properties)) {
      for (const value of Object.values(node.properties)) queue.push(value);
    }
    if (node.items !== undefined) {
      if (Array.isArray(node.items)) for (const value of node.items) queue.push(value);
      else queue.push(node.items);
    }
    if (schemaIsObject(node.additionalProperties)) queue.push(node.additionalProperties);
  }
  return Array.from(found).sort();
}

type SchemaContext = {
  errors: SchemaIssue[];
  hints: SchemaIssue[];
  checked: number;
};

function validateSchemaNode(
  schema: unknown,
  data: unknown,
  path: string,
  ctx: SchemaContext,
  depth: number,
): void {
  if (depth > SCHEMA_DEPTH_LIMIT) {
    ctx.errors.push({
      path,
      keyword: "depth",
      message: `数据嵌套超过 ${SCHEMA_DEPTH_LIMIT} 层，这一层往下的内容没有继续校验。`,
    });
    return;
  }

  if (schema === true || schema === undefined) return;
  if (schema === false) {
    ctx.errors.push({ path, keyword: "false", message: "schema 写成了 false，这个位置不允许出现任何值。" });
    return;
  }
  if (!schemaIsObject(schema)) return;

  if (depth > 0) ctx.checked++;
  const add = (keyword: string, message: string) => ctx.errors.push({ path, keyword, message });
  const addAt = (targetPath: string, keyword: string, message: string) =>
    ctx.errors.push({ path: targetPath, keyword, message });

  // type（含 ["string","null"] 这种数组写法）
  if (schema.type !== undefined) {
    const list = Array.isArray(schema.type) ? schema.type : [schema.type];
    const names = list.filter((item): item is string => typeof item === "string");
    if (names.length > 0 && !names.some((name) => schemaMatchesType(data, name))) {
      add(
        "type",
        `要求是${names.map(schemaTypeLabel).join(" 或 ")}，实际给的是${schemaDescribeValue(data)}`,
      );
    }
  }

  if (Array.isArray(schema.enum) && !schema.enum.some((item) => schemaDeepEqual(item, data))) {
    add(
      "enum",
      `取值必须是 ${schema.enum.map((item) => schemaShortJson(item, 24)).join(" / ")} 之一，实际是 ${schemaShortJson(data, 24)}`,
    );
  }

  if (schema.const !== undefined && !schemaDeepEqual(schema.const, data)) {
    add("const", `必须正好是 ${schemaShortJson(schema.const, 24)}，实际是 ${schemaShortJson(data, 24)}`);
  }

  if (typeof data === "number") {
    if (typeof schema.minimum === "number" && data < schema.minimum) {
      add("minimum", `不能小于 ${schema.minimum}，实际是 ${data}`);
    }
    if (typeof schema.maximum === "number" && data > schema.maximum) {
      add("maximum", `不能大于 ${schema.maximum}，实际是 ${data}`);
    }
    if (typeof schema.exclusiveMinimum === "number" && data <= schema.exclusiveMinimum) {
      add("exclusiveMinimum", `必须大于 ${schema.exclusiveMinimum}，实际是 ${data}`);
    }
    if (typeof schema.exclusiveMaximum === "number" && data >= schema.exclusiveMaximum) {
      add("exclusiveMaximum", `必须小于 ${schema.exclusiveMaximum}，实际是 ${data}`);
    }
    if (typeof schema.multipleOf === "number" && schema.multipleOf > 0) {
      const quotient = data / schema.multipleOf;
      if (Math.abs(quotient - Math.round(quotient)) > 1e-9) {
        add("multipleOf", `必须是 ${schema.multipleOf} 的整数倍，实际是 ${data}`);
      }
    }
  }

  if (typeof data === "string") {
    if (typeof schema.minLength === "number" && data.length < schema.minLength) {
      add("minLength", `长度至少 ${schema.minLength} 个字符，实际是 ${data.length} 个`);
    }
    if (typeof schema.maxLength === "number" && data.length > schema.maxLength) {
      add("maxLength", `长度最多 ${schema.maxLength} 个字符，实际是 ${data.length} 个`);
    }
    if (typeof schema.pattern === "string") {
      try {
        if (!new RegExp(schema.pattern).test(data)) {
          add("pattern", `不匹配正则 ${schema.pattern}，实际是 ${JSON.stringify(data)}`);
        }
      } catch {
        add("pattern", `schema 里的 pattern 不是合法的正则表达式：${schema.pattern}`);
      }
    }
    if (typeof schema.format === "string") {
      const checked = checkWeakFormat(schema.format, data);
      if (checked !== null && !checked.ok) {
        ctx.hints.push({
          path,
          keyword: "format",
          message: `format: ${schema.format} 要求${checked.expectation}，实际是 ${JSON.stringify(data)}`,
        });
      }
    }
  }

  if (Array.isArray(data)) {
    if (typeof schema.minItems === "number" && data.length < schema.minItems) {
      add("minItems", `至少要有 ${schema.minItems} 项，实际是 ${data.length} 项`);
    }
    if (typeof schema.maxItems === "number" && data.length > schema.maxItems) {
      add("maxItems", `最多 ${schema.maxItems} 项，实际是 ${data.length} 项`);
    }
    if (schema.uniqueItems === true) {
      if (data.length > SCHEMA_UNIQUE_ITEMS_LIMIT) {
        ctx.hints.push({
          path,
          keyword: "uniqueItems",
          message: `数组有 ${data.length} 项，超过 ${SCHEMA_UNIQUE_ITEMS_LIMIT} 项时不再检查重复（避免卡住）。`,
        });
      } else {
        for (let i = 0; i < data.length; i++) {
          let duplicated = false;
          for (let j = i + 1; j < data.length && !duplicated; j++) {
            if (schemaDeepEqual(data[i], data[j])) {
              addAt(
                schemaPath(path, String(j)),
                "uniqueItems",
                `这一项和第 ${i + 1} 项重复（uniqueItems 要求数组里不能有重复项）`,
              );
              duplicated = true;
            }
          }
        }
      }
    }
    if (schema.items !== undefined) {
      if (Array.isArray(schema.items)) {
        const limit = Math.min(data.length, schema.items.length);
        for (let index = 0; index < limit; index++) {
          validateSchemaNode(schema.items[index], data[index], schemaPath(path, String(index)), ctx, depth + 1);
        }
      } else {
        for (let index = 0; index < data.length; index++) {
          validateSchemaNode(schema.items, data[index], schemaPath(path, String(index)), ctx, depth + 1);
        }
      }
    }
  }

  if (schemaIsObject(data)) {
    if (Array.isArray(schema.required)) {
      for (const key of schema.required) {
        if (typeof key !== "string") continue;
        if (!Object.prototype.hasOwnProperty.call(data, key)) {
          add("required", `缺少必填字段 "${key}"`);
        }
      }
    }

    const properties = schemaIsObject(schema.properties) ? schema.properties : {};
    for (const key of Object.keys(properties)) {
      if (Object.prototype.hasOwnProperty.call(data, key)) {
        validateSchemaNode(properties[key], data[key], schemaPath(path, key), ctx, depth + 1);
      }
    }

    const additional = schema.additionalProperties;
    if (additional !== undefined) {
      const extras = Object.keys(data).filter((key) => !Object.prototype.hasOwnProperty.call(properties, key));
      for (const key of extras) {
        const childPath = schemaPath(path, key);
        if (additional === false) {
          ctx.errors.push({
            path: childPath,
            keyword: "additionalProperties",
            message: `字段 "${key}" 不在 schema 允许的字段里（additionalProperties 为 false）`,
          });
        } else if (schemaIsObject(additional)) {
          validateSchemaNode(additional, data[key], childPath, ctx, depth + 1);
        }
      }
    }
  }
}

function validateJsonSchema(schema: unknown, data: unknown): SchemaReport {
  const ctx: SchemaContext = { errors: [], hints: [], checked: 0 };
  validateSchemaNode(schema, data, "", ctx, 0);
  return {
    errors: ctx.errors,
    hints: ctx.hints,
    unsupported: collectUnsupportedKeywords(schema),
    checkedCount: ctx.checked,
  };
}

/* ------------------------------------------------------------------ JSON 文本解析（带行号） */

type JsonParseOutcome =
  | { ok: true; value: unknown }
  | { ok: false; message: string; line?: number; lineText?: string };

/** JSON.parse 的英文报错翻成人话（拿不准就返回 null，不硬编）。 */
function jsonHumanHint(message: string): string | null {
  if (/Unexpected end of JSON input/i.test(message)) return "内容好像没写完，检查括号和引号有没有配对。";
  if (/Expected property name or/i.test(message)) return "对象的键要写成双引号包起来的字符串。";
  if (/Unexpected non-whitespace character after JSON/i.test(message)) return "JSON 后面还有多余内容，一段输入里只能有一段 JSON。";
  if (/Unexpected token/i.test(message)) return "这里出现了不该出现的字符，多半是少写或多写了逗号、括号、引号。";
  if (/Bad control character/i.test(message)) return "字符串里有不能直接出现的控制字符。";
  if (/Unterminated string/i.test(message)) return "有字符串没有收尾（少了右引号）。";
  return null;
}

function cleanJsonMessage(message: string): string {
  return message
    .replace(/^JSON\.parse:\s*/i, "")
    .replace(/,\s*(?:\.\.\.)?\s*"[\s\S]*"\s*is not valid JSON\s*$/i, "")
    .replace(/\s*in JSON at position \d+.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** 解析 JSON，并把报错换算成「第几行 + 那一行的原文」。 */
function parseJsonInput(source: string): JsonParseOutcome {
  try {
    return { ok: true, value: JSON.parse(source) as unknown };
  } catch (error) {
    const raw = error instanceof Error ? error.message : "这段内容不是合法的 JSON。";
    const starts = buildLineStarts(source.replace(/\r\n?/g, "\n"));
    const positioned = /position (\d+)/i.exec(raw);
    const lined = /line (\d+)/i.exec(raw);
    let line: number | undefined;
    if (positioned !== null) line = lineAt(starts, Number(positioned[1]));
    else if (lined !== null) line = Number(lined[1]);
    const hint = jsonHumanHint(raw) ?? cleanJsonMessage(raw);
    return {
      ok: false,
      message: line === undefined ? hint : `第 ${line} 行：${hint}`,
      line,
      lineText: line === undefined ? undefined : lineTextAt(source, line),
    };
  }
}

/* ==========================================================================================
 * PURE LOGIC ZONE END
 * ========================================================================================== */

/* ------------------------------------------------------------------ 示例数据 */

/** CSS 示例：专门挑了最容易压坏的几种写法（分号在字符串里、url 带查询串、属性选择器带空格）。 */
const CSS_SAMPLE = `/* 商品卡片 */
:root {
  --brand: #ff8a3d;
  --card-radius: 12px;
}

.card, .card--wide {
  color: #ffffff;
  padding: 0  12px;
  background: url(bg.png?x=1&y=2) no-repeat center / cover;
  content: "a;b";
}

.card > .title[data-x="a b"] { font-weight: 600 }

@media screen and (min-width: 768px) {
  .card {
    padding: 0 24px;
    &:hover { transform: translateY(-2px) }
  }
}
`;

const SQL_SAMPLE = `-- 统计下单量靠前的用户
select u.id, u.name, count(o.id) as order_count,
       case when sum(o.total) > 1000 then 'VIP' else 'NORMAL' end as level
from users u
left join orders o on o.user_id = u.id
where u.created_at >= '2024-01-01'
  and o.status in ('paid', 'shipped')
  and o.id in (select id from orders where total > 0)
group by u.id, u.name
having count(o.id) > 0
order by order_count desc
limit 20;

update users set level = 'VIP' where id = 'select from'; /* 字符串里的关键字不能被改 */
`;

const HTML_SAMPLE = `<!DOCTYPE html>
<html lang="zh-CN">
  <head>
    <!-- 这段注释会被删掉 -->
    <style>
      .card {   padding : 0  12px ;  }
    </style>
  </head>
  <body>
    <div class="card  card--wide" title="含 空格">
      <p>普通段落里的连续空白   会被合并</p>
      <pre>
  这里的缩进与   空白
  必须原样保留
      </pre>
      <textarea>
  表单默认值里的空白也原样保留
      </textarea>
      <script>
        var url = "http://example.com/a";   // 脚本内部原样保留
      </script>
    </div>
  </body>
</html>
`;

const JS_SAMPLE = `/**
 * 订单金额统计。
 * 注释与多余空白会被去掉，字符串 / 模板串 / 正则原样保留。
 */
function summarize(orders) {
  var total = 0;          // 累加金额
  var re = /^https?:\\/\\//;   // 正则里的转义斜杠不能被当成分隔符

  for (var i = 0; i < orders.length; i++) {
    var order = orders[i];
    if (re.test(order.url || "http://placeholder.test")) {
      total += order.amount;
    }
    console.log(\`订单 \${order.id} 金额 \${order.amount}，累计 \${total}\`);
  }

  return {
    total: total,
    count: orders.length,
  };
}
`;

const JSON_SCHEMA_SAMPLE = JSON.stringify(
  {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: "商品",
    type: "object",
    required: ["id", "name", "price", "stock"],
    additionalProperties: false,
    properties: {
      id: { type: "integer", minimum: 1, description: "商品编号" },
      name: { type: "string", minLength: 2, maxLength: 60 },
      price: { type: "number", exclusiveMinimum: 0, multipleOf: 0.01 },
      stock: { type: "integer", minimum: 0 },
      status: { type: "string", enum: ["on_sale", "sold_out", "draft"] },
      tags: { type: "array", items: { type: "string", minLength: 1 }, minItems: 1, uniqueItems: true },
      seller: {
        type: "object",
        required: ["name", "email"],
        properties: {
          name: { type: "string", minLength: 1 },
          email: { type: "string", format: "email", pattern: "^[^@\\s]+@[^@\\s]+$" },
          homepage: { type: "string", format: "uri" },
          joinedAt: { type: "string", format: "date" },
        },
        additionalProperties: false,
      },
      variants: {
        type: "array",
        items: {
          type: "object",
          required: ["sku", "price"],
          properties: {
            sku: { type: "string", pattern: "^[A-Z0-9-]{4,}$" },
            price: { type: "number", minimum: 0 },
            color: { type: ["string", "null"] },
          },
          additionalProperties: false,
        },
        maxItems: 20,
      },
    },
  },
  null,
  2,
);

const JSON_SCHEMA_DATA_SAMPLE = JSON.stringify(
  {
    id: "1001",
    name: "芙宁娜",
    price: 0,
    stock: 12,
    status: "presale",
    tags: ["水", "水"],
    seller: { name: "", email: "not-an-email", homepage: "example.com", joinedAt: "2024-02-30" },
    variants: [
      { sku: "ab", price: 9.9, color: null },
      { sku: "SKU-0002", price: -1, color: "蓝" },
    ],
    extra: true,
  },
  null,
  2,
);

/* ------------------------------------------------------------------ 共用外观件 */

/** 顶部操作栏：只放控件，不放工具名与描述（外壳已经给过了）。 */
function ActionBar({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-card/60 p-3.5 shadow-xs backdrop-blur-md">
      {children}
    </div>
  );
}

/** 分段控件（模式切换 / 选项切换都用它，样式与项目里既有的视图切换一致）。 */
function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string; icon?: ReactNode }>;
  onChange: (next: T) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-lg border border-border/50 bg-background/50 p-1 text-xs">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => onChange(option.value)}
          className={cn(
            "flex items-center gap-1.5 rounded-md px-2.5 py-1 font-medium transition-colors",
            value === option.value
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  );
}

function OptionGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

/** 错误提示：规范里那套固定样式；带行号时把出错那一行的原文也摆出来。 */
function ErrorNote({ message, line, lineText }: { message: string; line?: number; lineText?: string }) {
  return (
    <div className="space-y-2">
      <div className="flex items-start gap-2 rounded-xl border-l-4 border-l-destructive bg-destructive/10 px-4 py-3 font-mono-accent text-xs text-destructive">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        <span className="leading-relaxed">{message}</span>
      </div>
      {line !== undefined && lineText !== undefined && lineText !== "" && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-2">
          <span className="mt-0.5 shrink-0 rounded-md bg-destructive/15 px-1.5 py-0.5 font-mono-accent text-[10px] font-semibold text-destructive">
            第 {line} 行
          </span>
          <code className="min-w-0 flex-1 overflow-x-auto font-mono-accent text-[11px] whitespace-pre text-foreground/80">
            {lineText}
          </code>
        </div>
      )}
    </div>
  );
}

/** 说明列表：压缩时「哪些东西被保留了」这类信息走这里。 */
function NoteList({ notes }: { notes: string[] }) {
  if (notes.length === 0) return null;
  return (
    <div className="space-y-1.5 rounded-xl border border-border/60 bg-muted/30 px-4 py-3">
      {notes.map((note) => (
        <div key={note} className="flex items-start gap-2 text-[11.5px] leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <span>{note}</span>
        </div>
      ))}
    </div>
  );
}

function CopyButton({
  text,
  label = "复制",
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    if (text === "") {
      toast({ title: "还没有可以复制的内容", variant: "info", duration: 1800 });
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast({ title: "已复制到剪贴板", variant: "success", duration: 1600 });
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({
        title: "复制失败",
        description: "系统没有给剪贴板权限，手动选中再复制吧。",
        variant: "error",
      });
    }
  }, [text, toast]);

  return (
    <Button type="button" variant="ghost" size="sm" onClick={handleCopy} className={cn("h-7 px-2 text-xs", className)}>
      {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "已复制" : label}
    </Button>
  );
}

function EmptyPane({
  icon,
  hint,
  action,
  className,
}: {
  icon: ReactNode;
  hint: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border/70 bg-card/40 p-6 text-center",
        className,
      )}
    >
      <div className="text-muted-foreground/40">{icon}</div>
      <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">{hint}</p>
      {action}
    </div>
  );
}

function MetaText({ children }: { children: ReactNode }) {
  return <span className="font-mono-accent text-[11px] text-muted-foreground">{children}</span>;
}

function InputMeta({ text }: { text: string }) {
  return (
    <MetaText>
      {countLines(text)} 行 · {byteLength(text)} 字节
    </MetaText>
  );
}

/** 大输入的固定提示：不阻止处理，只是先说一声。 */
function LargeInputNote({ text }: { text: string }) {
  if (!isLargeInput(text)) return null;
  return (
    <div className="flex items-start gap-2 text-[11px] leading-relaxed text-muted-foreground">
      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
      <span>
        输入已经有 {kbText(byteLength(text))}，超过 1MB 时解析会明显变慢，仍然会照常处理。
      </span>
    </div>
  );
}

/** 「原 X KB → 现 Y KB（省 Z%）」：这一行是压缩类工具的核心反馈。 */
function SizeDiff({ before, after }: { before: number; after: number }) {
  const percent = savedPercent(before, after);
  return (
    <MetaText>
      原 {kbText(before)} → 现 {kbText(after)}（{percent > 0 ? `省 ${percent}%` : `增加 ${Math.abs(percent)}%`}）
    </MetaText>
  );
}

const CODE_AREA_CLASS =
  "thin-scroll min-h-[380px] resize-y whitespace-pre font-mono-accent text-xs leading-relaxed md:min-h-[440px]";

const RESULT_AREA_CLASS =
  "thin-scroll max-h-[560px] min-h-[380px] overflow-auto rounded-xl border border-border bg-background/40 p-4 font-mono-accent text-xs leading-relaxed whitespace-pre select-text md:min-h-[440px]";

/* ==========================================================================================
 * 工具 1：CSS 格式化与压缩
 * 布局模式 A（转换对照）：输入与输出要互相对照（改哪条声明影响了哪一行），左右并排最直观；
 * 顶部操作栏放「格式化 / 压缩成一行 / 填入示例 / 清空」与三个选项（缩进、注释、#fff 缩写）。
 * ========================================================================================== */

type CssAction = "format" | "minify";
type IndentChoice = "2" | "4" | "tab";

function indentUnitOf(choice: IndentChoice): string {
  if (choice === "4") return "    ";
  if (choice === "tab") return "\t";
  return "  ";
}

const INDENT_OPTIONS: Array<{ value: IndentChoice; label: string }> = [
  { value: "2", label: "2 空格" },
  { value: "4", label: "4 空格" },
  { value: "tab", label: "Tab" },
];

export function CssFormatterTool() {
  const [input, setInput] = useToolDraft<string>("css-format", "input", "");
  const [action, setAction] = useToolDraft<CssAction>("css-format", "action", "format");
  const [indent, setIndent] = useToolDraft<IndentChoice>("css-format", "indent", "2");
  const [keepComments, setKeepComments] = useToolDraft<boolean>("css-format", "keepComments", true);
  const [shrinkHex, setShrinkHex] = useToolDraft<boolean>("css-format", "shrinkHex", false);

  const parsed = useMemo(() => (input.trim() === "" ? null : parseCss(input)), [input]);

  const result = useMemo(() => {
    if (parsed === null || !parsed.ok) {
      return { text: "", warnings: [] as string[], stats: null as CssStats | null };
    }
    const text =
      action === "minify"
        ? minifyCss(parsed.value, { keepComments, shrinkHex })
        : formatCss(parsed.value, { indentUnit: indentUnitOf(indent), keepComments });
    return { text, warnings: parsed.warnings, stats: cssStats(parsed.value) };
  }, [parsed, action, indent, keepComments, shrinkHex]);

  const error = parsed !== null && !parsed.ok ? parsed : null;
  const inputBytes = byteLength(input);
  const outputBytes = byteLength(result.text);

  return (
    <div className="space-y-4">
      <ActionBar>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={() => setAction("format")}>
            <Wand2 className="h-4 w-4" /> 格式化
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setAction("minify")}>
            <Minimize2 className="h-4 w-4" /> 压缩成一行
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setInput(CSS_SAMPLE)}>
            <Sparkles className="h-3.5 w-3.5" /> 填入示例
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setInput("")}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" /> 清空
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <OptionGroup label="缩进">
            <Segmented value={indent} options={INDENT_OPTIONS} onChange={setIndent} />
          </OptionGroup>
          <OptionGroup label="注释">
            <Segmented
              value={keepComments ? "keep" : "drop"}
              onChange={(next) => setKeepComments(next === "keep")}
              options={[
                { value: "keep", label: "保留" },
                { value: "drop", label: "去掉" },
              ]}
            />
          </OptionGroup>
          <OptionGroup label="颜色值">
            <Segmented
              value={shrinkHex ? "shrink" : "keep"}
              onChange={(next) => setShrinkHex(next === "shrink")}
              options={[
                { value: "shrink", label: "缩写成 #fff" },
                { value: "keep", label: "保持原样" },
              ]}
            />
          </OptionGroup>
        </div>
      </ActionBar>

      {error !== null && <ErrorNote message={error.message} line={error.line} lineText={error.lineText} />}

      {parsed !== null && parsed.ok && <NoteList notes={parsed.warnings} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>输入</Label>
            <InputMeta text={input} />
          </div>
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={".card {\n  color: #fff;\n  padding: 0 12px;\n}\n\n@media (min-width: 768px) {\n  .card { padding: 0 24px }\n}"}
            spellCheck={false}
            wrap="off"
            className={CODE_AREA_CLASS}
          />
          <LargeInputNote text={input} />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            支持嵌套的 @media / @supports / @keyframes。引号里与 url() 里的内容不参与空白压缩。
          </p>
        </div>

        <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Label>输出</Label>
              <Badge variant="secondary">{action === "minify" ? "压缩" : "格式化"}</Badge>
              {result.stats !== null && (
                <MetaText>
                  选择器 {result.stats.selectors} 个 · 声明 {result.stats.declarations} 条
                </MetaText>
              )}
              {result.text !== "" && <SizeDiff before={inputBytes} after={outputBytes} />}
            </div>
            <CopyButton text={result.text} label="复制结果" />
          </div>

          {result.text !== "" ? (
            <pre className={RESULT_AREA_CLASS}>{result.text}</pre>
          ) : (
            <EmptyPane
              className="min-h-[380px] md:min-h-[440px]"
              icon={<Braces className="h-8 w-8" />}
              hint={
                error !== null
                  ? "左边这段 CSS 还有问题，改好这里就会出现结果。"
                  : "左边粘一段 CSS，格式化与压缩的结果会立刻出现在这里。"
              }
              action={
                <Button type="button" variant="outline" size="sm" onClick={() => setInput(CSS_SAMPLE)}>
                  <Sparkles className="h-3.5 w-3.5" /> 填入示例看看
                </Button>
              }
            />
          )}
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================================
 * 工具 2：SQL 格式化
 * 布局模式 A（转换对照）：原语句与排版后的语句要逐句对照，所以左右并排；
 * 输出区多了「高亮 / 纯文本」两种看法（高亮用 React 元素渲染，不走 innerHTML），
 * 底部一条状态栏给出语句数、行数与高亮关键字个数。
 * ========================================================================================== */

type SqlAction = "format" | "minify";
type SqlCaseMode = "upper" | "lower" | "keep";
type SqlView = "highlight" | "plain";

const SQL_SEGMENT_CLASS: Record<SqlSegment["kind"], string> = {
  keyword: "text-primary font-semibold",
  string: "text-success",
  number: "text-foreground font-semibold",
  comment: "text-muted-foreground italic",
  plain: "",
};

const MAX_HIGHLIGHT_SEGMENTS = 2500;

export function SqlFormatterTool() {
  const [input, setInput] = useToolDraft<string>("sql-format", "input", "");
  const [action, setAction] = useToolDraft<SqlAction>("sql-format", "action", "format");
  const [indent, setIndent] = useToolDraft<IndentChoice>("sql-format", "indent", "2");
  const [caseMode, setCaseMode] = useToolDraft<SqlCaseMode>("sql-format", "caseMode", "upper");
  const [oneFieldPerLine, setOneFieldPerLine] = useToolDraft<boolean>("sql-format", "oneFieldPerLine", true);
  const [view, setView] = useToolDraft<SqlView>("sql-format", "view", "highlight");

  const tokenized = useMemo(() => (input.trim() === "" ? null : tokenizeSql(input)), [input]);

  const options = useMemo(
    () => ({ indentUnit: indentUnitOf(indent), caseMode, oneFieldPerLine }),
    [indent, caseMode, oneFieldPerLine],
  );

  const result = useMemo(() => {
    if (tokenized === null || !tokenized.ok) {
      return { text: "", stats: null as SqlStatementStats | null, removedLineComments: 0 };
    }
    if (action === "minify") {
      const report = minifySql(tokenized.value, options);
      return { text: report.output, stats: sqlStats(tokenized.value), removedLineComments: report.removedLineComments };
    }
    return { text: formatSql(tokenized.value, options), stats: sqlStats(tokenized.value), removedLineComments: 0 };
  }, [tokenized, action, options]);

  const segments = useMemo(() => (result.text === "" ? [] : highlightSql(result.text)), [result.text]);
  const highlightTooLarge = segments.length > MAX_HIGHLIGHT_SEGMENTS;
  const showHighlight = view === "highlight" && !highlightTooLarge;
  const keywordCount = useMemo(
    () => segments.filter((segment) => segment.kind === "keyword").length,
    [segments],
  );

  const error = tokenized !== null && !tokenized.ok ? tokenized : null;

  return (
    <div className="space-y-4">
      <ActionBar>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={() => setAction("format")}>
            <Wand2 className="h-4 w-4" /> 格式化
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => setAction("minify")}>
            <Minimize2 className="h-4 w-4" /> 压缩成单行
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setInput(SQL_SAMPLE)}>
            <Sparkles className="h-3.5 w-3.5" /> 填入示例
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setInput("")}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" /> 清空
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <OptionGroup label="缩进">
            <Segmented value={indent} options={INDENT_OPTIONS} onChange={setIndent} />
          </OptionGroup>
          <OptionGroup label="关键字">
            <Segmented
              value={caseMode}
              onChange={setCaseMode}
              options={[
                { value: "upper", label: "大写" },
                { value: "lower", label: "小写" },
                { value: "keep", label: "保持原样" },
              ]}
            />
          </OptionGroup>
          <OptionGroup label="字段">
            <Segmented
              value={oneFieldPerLine ? "each" : "inline"}
              onChange={(next) => setOneFieldPerLine(next === "each")}
              options={[
                { value: "each", label: "每个一行" },
                { value: "inline", label: "尽量同行" },
              ]}
            />
          </OptionGroup>
        </div>
      </ActionBar>

      {error !== null && <ErrorNote message={error.message} line={error.line} lineText={error.lineText} />}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label>输入 SQL</Label>
            <InputMeta text={input} />
          </div>
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={"select id, name from users where id = 1 and name like 'a%'\n\n-- 多条语句用 ; 分隔"}
            spellCheck={false}
            wrap="off"
            className={CODE_AREA_CLASS}
          />
          <LargeInputNote text={input} />
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            字符串与注释（-- 与 /* */）原样保留；只有内置词表里的结构关键字会改大小写，同名的列名也会一起被改，
            需要原样就选「保持原样」。
          </p>
        </div>

        <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Label>输出</Label>
              <Badge variant="secondary">{action === "minify" ? "单行" : "美化"}</Badge>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Segmented
                value={view}
                onChange={setView}
                options={[
                  { value: "highlight", label: "高亮", icon: <Eye className="h-3.5 w-3.5" /> },
                  { value: "plain", label: "纯文本", icon: <AlignLeftIcon /> },
                ]}
              />
              <CopyButton text={result.text} label="复制结果" />
            </div>
          </div>

          {result.text !== "" ? (
            showHighlight ? (
              <pre className={RESULT_AREA_CLASS}>
                {segments.map((segment, index) => (
                  <span key={index} className={SQL_SEGMENT_CLASS[segment.kind]}>
                    {segment.text}
                  </span>
                ))}
              </pre>
            ) : (
              <pre className={RESULT_AREA_CLASS}>{result.text}</pre>
            )
          ) : (
            <EmptyPane
              className="min-h-[380px] md:min-h-[440px]"
              icon={<Database className="h-8 w-8" />}
              hint={
                error !== null
                  ? "左边这段 SQL 还有问题，改好这里就会出现结果。"
                  : "左边粘一段 SQL，排版后的语句会出现在这里。"
              }
              action={
                <Button type="button" variant="outline" size="sm" onClick={() => setInput(SQL_SAMPLE)}>
                  <Sparkles className="h-3.5 w-3.5" /> 填入示例看看
                </Button>
              }
            />
          )}

          <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/60 bg-muted/25 px-3.5 py-2.5">
            <MetaText>
              {result.stats !== null
                ? `共 ${result.stats.statements} 条语句 · ${countLines(result.text)} 行 · 高亮 ${keywordCount} 个关键字`
                : "还没有可统计的内容"}
            </MetaText>
            {highlightTooLarge && (
              <span className="text-[11px] text-muted-foreground">
                内容较长，已按纯文本显示（高亮需要生成的元素太多）。
              </span>
            )}
          </div>

          {action === "minify" && result.removedLineComments > 0 && (
            <NoteList
              notes={[
                `压缩成单行时去掉了 ${result.removedLineComments} 处 -- 行注释：留着它会把同一行后面的语句整段注释掉。/* */ 块注释仍然保留。`,
              ]}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** 「纯文本」那格的图标：用一个小方框，避免和「高亮」的 Eye 混淆。 */
function AlignLeftIcon() {
  return <FileCode2 className="h-3.5 w-3.5" />;
}

/* ==========================================================================================
 * 工具 3：HTML / CSS / JS 压缩
 * 布局模式 A（转换对照）+ 顶部模式分段按钮：三种语言的处理规则完全不同，所以模式必须显眼；
 * 模式一变，输入区的示例与右侧的「保留了哪些东西」提示也跟着变。
 * ========================================================================================== */

type CodeMinifyMode = "html" | "css" | "js";

const MINIFY_SAMPLES: Record<CodeMinifyMode, string> = {
  html: HTML_SAMPLE,
  css: CSS_SAMPLE,
  js: JS_SAMPLE,
};

const MINIFY_LABELS: Record<CodeMinifyMode, string> = {
  html: "HTML",
  css: "CSS",
  js: "JavaScript",
};

type MinifyOutcome = {
  output: string;
  notes: string[];
  removedComments: number;
  removedBlankLines: number;
  error: { message: string; line?: number; lineText?: string } | null;
};

const EMPTY_MINIFY: MinifyOutcome = {
  output: "",
  notes: [],
  removedComments: 0,
  removedBlankLines: 0,
  error: null,
};

export function CodeMinifyTool() {
  const [input, setInput] = useToolDraft<string>("code-minify", "input", "");
  const [mode, setMode] = useToolDraft<CodeMinifyMode>("code-minify", "mode", "html");
  const [htmlRemoveQuotes, setHtmlRemoveQuotes] = useToolDraft<boolean>("code-minify", "htmlRemoveQuotes", false);
  const [cssKeepComments, setCssKeepComments] = useToolDraft<boolean>("code-minify", "cssKeepComments", false);
  const [cssShrinkHex, setCssShrinkHex] = useToolDraft<boolean>("code-minify", "cssShrinkHex", false);

  const outcome = useMemo<MinifyOutcome>(() => {
    if (input.trim() === "") return EMPTY_MINIFY;

    if (mode === "html") {
      const report = minifyHtml(input, { removeAttributeQuotes: htmlRemoveQuotes });
      if (!report.ok) {
        return { ...EMPTY_MINIFY, error: { message: report.message, line: report.line, lineText: report.lineText } };
      }
      return {
        output: report.value.output,
        notes: report.value.notes,
        removedComments: report.value.removedComments,
        removedBlankLines: report.value.removedBlankLines,
        error: null,
      };
    }

    if (mode === "css") {
      const parsed = parseCss(input);
      if (!parsed.ok) {
        return { ...EMPTY_MINIFY, error: { message: parsed.message, line: parsed.line, lineText: parsed.lineText } };
      }
      const notes = parsed.warnings.slice();
      if (cssKeepComments) notes.push("按当前设置保留了注释。");
      else notes.push("注释（包括 /*! 开头的许可注释）会一起去掉，需要留着就切到「保留注释」。");
      if (cssShrinkHex) notes.push("#ffffff 这类 6 位颜色会缩写成 3 位（#fff），写法可能与原文件不一致。");
      else notes.push("颜色值保持原来的位数，不做 #ffffff → #fff 的缩写。");
      notes.push("引号里与 url() 里的内容原样保留。");
      return {
        output: minifyCss(parsed.value, { keepComments: cssKeepComments, shrinkHex: cssShrinkHex }),
        notes,
        removedComments: 0,
        removedBlankLines: 0,
        error: null,
      };
    }

    const report = minifyJs(input);
    if (!report.ok) {
      return { ...EMPTY_MINIFY, error: { message: report.message, line: report.line, lineText: report.lineText } };
    }
    return {
      output: report.value.output,
      notes: report.value.notes,
      removedComments: report.value.removedComments,
      removedBlankLines: report.value.removedBlankLines,
      error: null,
    };
  }, [input, mode, htmlRemoveQuotes, cssKeepComments, cssShrinkHex]);

  const inputBytes = byteLength(input);
  const outputBytes = byteLength(outcome.output);

  return (
    <div className="space-y-4">
      <ActionBar>
        <div className="flex flex-wrap items-center gap-3">
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: "html", label: "HTML 压缩", icon: <LayoutTemplate className="h-3.5 w-3.5" /> },
              { value: "css", label: "CSS 压缩", icon: <Braces className="h-3.5 w-3.5" /> },
              { value: "js", label: "JS 压缩", icon: <Code2 className="h-3.5 w-3.5" /> },
            ]}
          />
        </div>

        <div className="flex flex-wrap items-center gap-3">
          {mode === "html" && (
            <OptionGroup label="属性引号">
              <Segmented
                value={htmlRemoveQuotes ? "drop" : "keep"}
                onChange={(next) => setHtmlRemoveQuotes(next === "drop")}
                options={[
                  { value: "keep", label: "保留" },
                  { value: "drop", label: "能去就去" },
                ]}
              />
            </OptionGroup>
          )}
          {mode === "css" && (
            <>
              <OptionGroup label="注释">
                <Segmented
                  value={cssKeepComments ? "keep" : "drop"}
                  onChange={(next) => setCssKeepComments(next === "keep")}
                  options={[
                    { value: "drop", label: "去掉" },
                    { value: "keep", label: "保留" },
                  ]}
                />
              </OptionGroup>
              <OptionGroup label="颜色值">
                <Segmented
                  value={cssShrinkHex ? "shrink" : "keep"}
                  onChange={(next) => setCssShrinkHex(next === "shrink")}
                  options={[
                    { value: "keep", label: "保持原样" },
                    { value: "shrink", label: "缩写成 #fff" },
                  ]}
                />
              </OptionGroup>
            </>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={() => setInput(MINIFY_SAMPLES[mode])}>
            <Sparkles className="h-3.5 w-3.5" /> 填入示例
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setInput("")}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" /> 清空
          </Button>
        </div>
      </ActionBar>

      {mode === "js" && (
        <div className="flex items-start gap-2 rounded-2xl border border-border/70 bg-card/60 px-4 py-3 text-[11.5px] leading-relaxed text-muted-foreground backdrop-blur-md">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <span>
            仅做安全压缩（去注释与空白），不做变量重命名：重命名需要完整的作用域分析，
            在浏览器里判断错一次就会改坏线上代码，所以这一项故意不提供。
          </span>
        </div>
      )}

      {outcome.error !== null && (
        <ErrorNote
          message={outcome.error.message}
          line={outcome.error.line}
          lineText={outcome.error.lineText}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Label>输入</Label>
              <Badge variant="outline">{MINIFY_LABELS[mode]}</Badge>
            </div>
            <InputMeta text={input} />
          </div>
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={
              mode === "html"
                ? '<div class="a">\n  <!-- 注释 -->\n  <pre>  空白保留  </pre>\n</div>'
                : mode === "css"
                  ? ".a {\n  color: #ffffff; /* 注释 */\n  background: url(a.png?x=1);\n}"
                  : 'var a = "http://a.com"; // 注释\nvar t = `x${y}`;'
            }
            spellCheck={false}
            wrap="off"
            className={CODE_AREA_CLASS}
          />
          <LargeInputNote text={input} />
        </div>

        <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Label>压缩结果</Label>
              <Badge variant="secondary">{MINIFY_LABELS[mode]}</Badge>
              {outcome.output !== "" && <SizeDiff before={inputBytes} after={outputBytes} />}
              {outcome.removedComments > 0 && <MetaText>去掉注释 {outcome.removedComments} 处</MetaText>}
              {outcome.removedBlankLines > 0 && <MetaText>去掉空行 {outcome.removedBlankLines} 行</MetaText>}
            </div>
            <CopyButton text={outcome.output} label="复制结果" />
          </div>

          {outcome.output !== "" ? (
            <pre className={RESULT_AREA_CLASS}>{outcome.output}</pre>
          ) : (
            <EmptyPane
              className="min-h-[380px] md:min-h-[440px]"
              icon={<Minimize2 className="h-8 w-8" />}
              hint={
                outcome.error !== null
                  ? "上面那段还有问题，改好这里就会出现压缩结果。"
                  : `左边粘一段 ${MINIFY_LABELS[mode]}，压缩结果会立刻出现在这里。`
              }
              action={
                <Button type="button" variant="outline" size="sm" onClick={() => setInput(MINIFY_SAMPLES[mode])}>
                  <Sparkles className="h-3.5 w-3.5" /> 填入示例看看
                </Button>
              }
            />
          )}

          <NoteList notes={outcome.notes} />
        </div>
      </div>
    </div>
  );
}

/* ==========================================================================================
 * 工具 4：JSON Schema 校验
 * 布局模式 D 的变体（上下两栏 + 结果清单）：schema 与待校验 JSON 通常都很长，
 * 而且使用顺序是「先写 schema，再贴数据」，所以上下排列而不是左右并排；
 * 最下面单独给结果区，逐条列路径与原因 —— 结果本身就是清单，糊成一段文字没法用。
 * ========================================================================================== */

type SchemaOutcome =
  | { kind: "idle" }
  | { kind: "inputError"; error: { message: string; line?: number; lineText?: string } }
  | { kind: "shapeError" }
  | { kind: "report"; report: SchemaReport };

function schemaReportText(report: SchemaReport): string {
  const lines: string[] = [];
  lines.push(`错误 ${report.errors.length} 条 · 提示 ${report.hints.length} 条 · 共校验 ${report.checkedCount} 个字段`);
  if (report.unsupported.length > 0) {
    lines.push(`暂不支持的关键字（未参与校验）：${report.unsupported.join("、")}`);
  }
  for (const issue of report.errors) {
    lines.push(`[错误] ${schemaDisplayPath(issue.path)} ${issue.message}`);
  }
  for (const issue of report.hints) {
    lines.push(`[提示] ${schemaDisplayPath(issue.path)} ${issue.message}`);
  }
  return `${lines.join("\n")}\n`;
}

export function JsonSchemaTool() {
  const [schemaText, setSchemaText] = useToolDraft<string>("json-schema-validate", "schema", "");
  const [dataText, setDataText] = useToolDraft<string>("json-schema-validate", "data", "");
  const [checkedSchema, setCheckedSchema] = useToolDraft<string>("json-schema-validate", "checkedSchema", "");
  const [checkedData, setCheckedData] = useToolDraft<string>("json-schema-validate", "checkedData", "");

  const run = useCallback(() => {
    setCheckedSchema(schemaText);
    setCheckedData(dataText);
  }, [schemaText, dataText, setCheckedSchema, setCheckedData]);

  const loadSample = useCallback(() => {
    setSchemaText(JSON_SCHEMA_SAMPLE);
    setDataText(JSON_SCHEMA_DATA_SAMPLE);
    setCheckedSchema("");
    setCheckedData("");
  }, [setSchemaText, setDataText, setCheckedSchema, setCheckedData]);

  const outcome = useMemo<SchemaOutcome>(() => {
    if (checkedSchema.trim() === "" || checkedData.trim() === "") return { kind: "idle" };

    const schemaParsed = parseJsonInput(checkedSchema);
    if (!schemaParsed.ok) {
      return {
        kind: "inputError",
        error: { message: `Schema 不是合法的 JSON。${schemaParsed.message}`, line: schemaParsed.line, lineText: schemaParsed.lineText },
      };
    }
    const dataParsed = parseJsonInput(checkedData);
    if (!dataParsed.ok) {
      return {
        kind: "inputError",
        error: { message: `待校验的 JSON 不合法。${dataParsed.message}`, line: dataParsed.line, lineText: dataParsed.lineText },
      };
    }

    const schema = schemaParsed.value;
    if (!schemaIsObject(schema) && typeof schema !== "boolean") {
      return { kind: "shapeError" };
    }

    return { kind: "report", report: validateJsonSchema(schema, dataParsed.value) };
  }, [checkedSchema, checkedData]);

  const sortedErrors = useMemo(() => {
    if (outcome.kind !== "report") return [] as SchemaIssue[];
    return outcome.report.errors
      .slice()
      .sort((a, b) => a.path.localeCompare(b.path) || a.keyword.localeCompare(b.keyword));
  }, [outcome]);

  const stale = schemaText !== checkedSchema || dataText !== checkedData;
  const reportText = outcome.kind === "report" ? schemaReportText(outcome.report) : "";

  return (
    <div className="space-y-4">
      <ActionBar>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" onClick={run}>
            <ShieldCheck className="h-4 w-4" /> 校验
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={loadSample}>
            <Sparkles className="h-3.5 w-3.5" /> 插入示例 Schema
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => {
              setSchemaText("");
              setDataText("");
              setCheckedSchema("");
              setCheckedData("");
            }}
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" /> 清空
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <Badge variant="outline">draft-07 常用子集</Badge>
          {stale && <span className="text-[11px] text-muted-foreground">内容改过了，点「校验」重新检查</span>}
          <CopyButton text={reportText} label="复制报告" />
        </div>
      </ActionBar>

      <div className="rounded-2xl border border-border/70 bg-card/60 px-4 py-3 text-[11.5px] leading-relaxed text-muted-foreground backdrop-blur-md">
        {"支持 type（含 [\"string\",\"null\"] 数组写法）、required、properties、additionalProperties、items、enum、const、"}
        minimum / maximum / exclusiveMinimum / exclusiveMaximum、minLength / maxLength、pattern、
        minItems / maxItems、uniqueItems、multipleOf、format 的基础判断。
        $ref、oneOf / anyOf / allOf、if / then / else 等暂不支持，会在结果里逐条列出，不会当作已校验。
      </div>

      <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Label>JSON Schema</Label>
            <MetaText>先写约束</MetaText>
          </div>
          <InputMeta text={schemaText} />
        </div>
        <Textarea
          value={schemaText}
          onChange={(event) => setSchemaText(event.target.value)}
          placeholder={'{\n  "type": "object",\n  "required": ["id"],\n  "properties": { "id": { "type": "integer", "minimum": 1 } }\n}'}
          spellCheck={false}
          wrap="off"
          className="thin-scroll min-h-[240px] resize-y whitespace-pre font-mono-accent text-xs leading-relaxed"
        />
        <LargeInputNote text={schemaText} />
      </div>

      <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Label>待校验的 JSON</Label>
            <MetaText>再贴数据</MetaText>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <InputMeta text={dataText} />
            <Button type="button" variant="ghost" size="sm" onClick={() => setDataText(JSON_SCHEMA_DATA_SAMPLE)}>
              <Sparkles className="h-3.5 w-3.5" /> 填入示例数据
            </Button>
          </div>
        </div>
        <Textarea
          value={dataText}
          onChange={(event) => setDataText(event.target.value)}
          placeholder={'{\n  "id": "1001",\n  "name": ""\n}'}
          spellCheck={false}
          wrap="off"
          className="thin-scroll min-h-[260px] resize-y whitespace-pre font-mono-accent text-xs leading-relaxed"
        />
        <LargeInputNote text={dataText} />
      </div>

      <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label>校验结果</Label>
          {outcome.kind === "report" && (
            <MetaText>
              共校验 {outcome.report.checkedCount} 个字段 · 错误 {outcome.report.errors.length} 条 · 提示{" "}
              {outcome.report.hints.length} 条
            </MetaText>
          )}
        </div>

        {outcome.kind === "idle" && (
          <EmptyPane
            icon={<ShieldCheck className="h-8 w-8" />}
            hint="上面写好 schema、下面贴一段 JSON，然后点「校验」。示例 Schema 覆盖了常用的约束，可以直接拿来试。"
            action={
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={loadSample}>
                  <Sparkles className="h-3.5 w-3.5" /> 插入示例 Schema
                </Button>
                <Button type="button" size="sm" onClick={run}>
                  <ShieldCheck className="h-3.5 w-3.5" /> 校验
                </Button>
              </div>
            }
          />
        )}

        {outcome.kind === "inputError" && (
          <ErrorNote message={outcome.error.message} line={outcome.error.line} lineText={outcome.error.lineText} />
        )}

        {outcome.kind === "shapeError" && (
          <ErrorNote message="Schema 顶层要是一个 JSON 对象（以 { 开头），或者直接写 true / false。" />
        )}

        {outcome.kind === "report" && (
          <div className="space-y-3">
            {outcome.report.unsupported.length > 0 && (
              <div className="space-y-2 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3">
                <div className="flex items-start gap-2 text-[12px] font-semibold text-primary">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>
                    schema 里用了 {outcome.report.unsupported.length} 个暂不支持的关键字，这些约束没有被检查
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 pl-5">
                  {outcome.report.unsupported.map((keyword) => (
                    <span
                      key={keyword}
                      className="rounded-md bg-primary/15 px-1.5 py-0.5 font-mono-accent text-[11px] text-primary"
                    >
                      {keyword}
                    </span>
                  ))}
                </div>
                <p className="pl-5 text-[11px] leading-relaxed text-muted-foreground">
                  使用这些关键字的工具（$ref 组合、oneOf 分支等）没有生效，所以「通过」不代表真的满足约束。
                </p>
              </div>
            )}

            {outcome.report.errors.length === 0 ? (
              <div className="flex items-start gap-2 rounded-xl border border-success/30 bg-success/10 px-4 py-3">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                <div className="space-y-1">
                  <div className="text-[13px] font-semibold text-success">
                    校验通过 · 共 {outcome.report.checkedCount} 个字段
                  </div>
                  <p className="text-[11.5px] leading-relaxed text-success/90">
                    {outcome.report.unsupported.length > 0
                      ? "在「已支持的关键字」范围内没有发现问题；上面列出的暂不支持关键字没有参与校验。"
                      : "schema 里用到的关键字都通过了。"}
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                {sortedErrors.map((issue, index) => (
                  <div
                    key={`${issue.path}-${issue.keyword}-${index}`}
                    className="flex flex-wrap items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3.5 py-2.5"
                  >
                    <span className="mt-0.5 shrink-0 rounded-md bg-destructive/15 px-1.5 py-0.5 font-mono-accent text-[11px] font-semibold text-destructive">
                      {schemaDisplayPath(issue.path)}
                    </span>
                    <span className="min-w-0 flex-1 text-[12.5px] leading-relaxed text-destructive">{issue.message}</span>
                    <span className="shrink-0 rounded-md border border-destructive/30 px-1.5 py-0.5 font-mono-accent text-[10px] text-destructive/80">
                      {issue.keyword}
                    </span>
                  </div>
                ))}
              </div>
            )}

            {outcome.report.hints.length > 0 && (
              <NoteList notes={outcome.report.hints.map((hint) => `${schemaDisplayPath(hint.path)} ${hint.message}`)} />
            )}

            <p className="text-[11px] leading-relaxed text-muted-foreground">
              format 是弱校验：只对 {SCHEMA_WEAK_FORMATS.join("、")} 做基础格式判断，判错的可能性存在，
              所以只作为提示列出，不计入错误；其它 format（uuid、ipv4 等）只当标注，不参与校验。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
