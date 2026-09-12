"use client";

/**
 * 三个纯文本「格式转换」工具的前端界面：JSON↔YAML / JSON↔XML / JSON↔CSV。
 *
 * 这三个都是**完全在浏览器本地算完**的（不调用 /api/tools/，输入一变就出结果）：
 * 纯文本转换在本地是瞬时的，走服务端只会更慢，而且和项目里现有的文本类工具
 * （json-formatter / case-converter / base64 这些 clientSide 工具）保持一致。
 *
 * 目录：
 *  1. 纯逻辑区（PURE LOGIC ZONE）：JSON / YAML / XML / CSV 的序列化、反序列化、格式识别。
 *     这一块**不依赖 React 与 DOM**，可以按标记整段抽出来单独跑 Node 单测。
 *  2. 共用外观件：渐变横幅、方向指示器、错误提示（带行号）、复制按钮、空状态。
 *  3. 三个导出组件：JsonYamlTool / JsonXmlTool / JsonCsvTool。
 *
 * 视觉语言严格跟随 docs/新工具UI规范.md：圆角 2xl 卡片 + border-border/70 + shadow-xs，
 * 只用主题色变量，禁止写死颜色；布局则是每个工具按自己的任务模型单独设计的。
 */

import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  Braces,
  Check,
  Copy,
  Eye,
  FileCode2,
  Info,
  RefreshCw,
  Sparkles,
  Table2,
  Trash2,
  Wand2,
} from "lucide-react";
import { Badge, Button, Label, Select, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useToolDraft } from "@/lib/use-tool-draft";
import { cn } from "@/lib/utils";

/* ==========================================================================================
 * PURE LOGIC ZONE START
 * 下面全部是纯函数：不引用 React、不碰 DOM，输入输出都是字符串/对象/数组。
 * （测试脚本按这两行标记抽取源码，转译后单独跑 Node 单测。）
 * ========================================================================================== */

/** 需要讲给用户听的错误：消息本身就是人话。 */
class DataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DataError";
  }
}

/** YAML 解析错误：额外带行号，方便界面指出错在哪一行。 */
class YamlError extends Error {
  line: number;
  constructor(message: string, line: number) {
    super(message);
    this.name = "YamlError";
    this.line = line;
  }
}

/** XML 解析错误：同样带行号。 */
class XmlError extends Error {
  line: number;
  constructor(message: string, line: number) {
    super(message);
    this.name = "XmlError";
    this.line = line;
  }
}

type Ok<T> = { ok: true; value: T; warnings: string[] };
type Err = { ok: false; message: string; line?: number; column?: number; lineText?: string };
type Result<T> = Ok<T> | Err;

function makeOk<T>(value: T, warnings: string[] = []): Ok<T> {
  return { ok: true, value, warnings };
}

function makeErr(
  message: string,
  extra?: { line?: number; column?: number; lineText?: string },
): Err {
  return {
    ok: false,
    message,
    line: extra?.line,
    column: extra?.column,
    lineText: extra?.lineText,
  };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 按 UTF-8 算字节数（中文一个字 3 字节，字符数会骗人）。 */
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

function lineTextAt(text: string, line: number): string {
  const lines = linesOf(text);
  if (line < 1 || line > lines.length) return "";
  return lines[line - 1];
}

function leadingSpaces(text: string): number {
  const match = /^[ \t]*/.exec(text);
  return match ? match[0].length : 0;
}

/* ------------------------------------------------------------------ JSON 解析与报错定位 */

/** 把字符位置换算成「第几行第几列」。 */
function positionToLineColumn(source: string, pos: number): { line: number; column: number } {
  const clamped = Math.max(0, Math.min(pos, source.length));
  const before = source.slice(0, clamped);
  const line = before.split(/\r\n?|\n/).length;
  const lastBreak = Math.max(before.lastIndexOf("\n"), before.lastIndexOf("\r"));
  return { line, column: clamped - lastBreak };
}

/**
 * V8 的 JSON 报错格式换过好几代，这里依次尝试能拿到位置的所有写法：
 *  1. (line X column Y)：新版直接给了行号；
 *  2. at position N：老版给字符位置；
 *  3. Unexpected token 'X', ..."片段" is not valid JSON：Node 20+ 换成了「带上下文的片段」，
 *     片段结尾就是出错那个字符，所以用 片段起点 + 片段长度 - 1 反推位置；
 *  4. Unexpected end of JSON input：内容没写完，位置就是结尾。
 */
function locateJsonError(source: string, message: string): { line: number; column: number } | null {
  const direct = /line (\d+) column (\d+)/i.exec(message);
  if (direct) return { line: Number(direct[1]), column: Number(direct[2]) };

  const positioned = /position (\d+)/i.exec(message);
  if (positioned) {
    return positionToLineColumn(source, Number(positioned[1]));
  }

  const snippet = /,\s*(\.\.\.)?\s*"([\s\S]*)"\s*is not valid JSON\s*$/i.exec(message);
  if (snippet !== null) {
    const fragment = snippet[2];
    if (fragment !== "") {
      // 前面带省略号说明片段是从中间截的，取最后一次出现；否则取第一次
      const index = snippet[1] !== undefined ? source.lastIndexOf(fragment) : source.indexOf(fragment);
      if (index >= 0) return positionToLineColumn(source, index + fragment.length - 1);
    }
  }

  if (/Unexpected end of JSON input/i.test(message)) {
    return positionToLineColumn(source, source.length);
  }

  return null;
}

/** 把 JSON.parse 的英文报错翻成人话提示（拿不准就返回 null，不硬编）。 */
function humanJsonHint(message: string): string | null {
  if (/Unexpected end of JSON input/i.test(message)) return "内容好像没写完，检查括号和引号有没有配对。";
  if (/Expected property name or/i.test(message)) return "对象的键要写成双引号包起来的字符串，比如 \"name\"。";
  if (/Unexpected non-whitespace character after JSON/i.test(message)) return "JSON 后面还有多余内容，一段输入里只能有一段 JSON。";
  if (/Unexpected token/i.test(message)) return "这里出现了不该出现的字符，多半是少写或多写了逗号、括号、引号。";
  if (/Bad control character/i.test(message)) return "字符串里有不能直接出现的控制字符。";
  if (/Unterminated string/i.test(message)) return "有字符串没有收尾（少了右引号）。";
  return null;
}

function cleanJsonMessage(message: string): string {
  return message
    .replace(/^JSON\.parse:\s*/i, "")
    // 新版 V8 会把出错位置附近的源码原样贴进报错里，界面上不好看，去掉它
    .replace(/,\s*(?:\.\.\.)?\s*"[\s\S]*"\s*is not valid JSON\s*$/i, "")
    .replace(/\s*in JSON at position \d+.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseJsonText(source: string): Result<unknown> {
  try {
    return makeOk(JSON.parse(source) as unknown);
  } catch (error) {
    const raw = error instanceof Error ? error.message : "这段内容不是合法的 JSON。";
    const ref = locateJsonError(source, raw);
    const hint = humanJsonHint(raw);
    if (!ref) {
      return makeErr(hint ? `${hint}（原始信息：${cleanJsonMessage(raw)}）` : cleanJsonMessage(raw));
    }
    const where = `第 ${ref.line} 行第 ${ref.column} 列`;
    const detail = cleanJsonMessage(raw);
    return makeErr(hint ? `${where}：${hint}（原始信息：${detail}）` : `${where}：${detail}`, {
      line: ref.line,
      column: ref.column,
      lineText: lineTextAt(source, ref.line),
    });
  }
}

/* ------------------------------------------------------------------ YAML 序列化 */

const YAML_SPECIAL_VALUES =
  /^(?:~|null|Null|NULL|true|True|TRUE|false|False|FALSE|yes|Yes|YES|no|No|NO|on|On|ON|off|Off|OFF)$/;

/** 这个字符串能不能不加引号直接写进 YAML（不能就加双引号）。 */
function needsYamlQuote(text: string): boolean {
  if (text === "") return true;
  if (YAML_SPECIAL_VALUES.test(text)) return true;
  if (/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(text)) return true;
  if (/^0[xX][0-9a-fA-F]+$/.test(text) || /^0[oO][0-7]+$/.test(text)) return true;
  if (/^[-?:,[\]{}#&*!|>'"%@`]/.test(text)) return true;
  if (text !== text.trim()) return true;
  if (/:\s/.test(text) || text.endsWith(":")) return true;
  if (/\s#/.test(text)) return true;
  if (/[\t\n\r]/.test(text)) return true;
  return false;
}

function quoteYaml(text: string): string {
  const escaped = text
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t")
    .replace(/[\u0000-\u001f]/g, (char) => `\\x${char.charCodeAt(0).toString(16).padStart(2, "0")}`);
  return `"${escaped}"`;
}

function yamlKeyText(key: string): string {
  if (key !== "" && /^[A-Za-z0-9_\u3400-\u9fff][A-Za-z0-9_\u3400-\u9fff.\- ]*$/.test(key) && !key.endsWith(" ")) {
    return key;
  }
  return quoteYaml(key);
}

function yamlScalarText(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "null";
  if (typeof value === "bigint") return String(value);
  const text = String(value);
  return needsYamlQuote(text) ? quoteYaml(text) : text;
}

/** 把一个值渲染成「一个块」（每行带好缩进）。 */
function yamlEntry(key: string | null, value: unknown, indent: number): string[] {
  const pad = " ".repeat(indent);

  if (Array.isArray(value)) {
    if (value.length === 0) return [`${pad}${key === null ? "-" : `${yamlKeyText(key)}:`} []`];
    if (key === null) {
      // 列表项本身又是一个列表：写成「-」再往下缩进一层，否则会被拍平成同一个列表
      return [
        `${pad}-`,
        ...value.reduce<string[]>((acc, item) => acc.concat(yamlEntry(null, item, indent + 2)), []),
      ];
    }
    return [`${pad}${yamlKeyText(key)}:`, ...value.reduce<string[]>((acc, item) => acc.concat(yamlEntry(null, item, indent + 2)), [])];
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return [`${pad}${key === null ? "-" : `${yamlKeyText(key)}:`} {}`];

    if (key === null) {
      // 列表项是对象时写成「- 第一个键: 值」，比孤零零一个 - 好看得多
      const first = keys[0];
      const firstLines = yamlEntry(first, value[first], indent + 2);
      const head = `${pad}- ${firstLines[0].slice(indent + 2)}`;
      const rest = keys
        .slice(1)
        .reduce<string[]>((acc, k) => acc.concat(yamlEntry(k, value[k], indent + 2)), []);
      return [head, ...firstLines.slice(1), ...rest];
    }

    return [
      `${pad}${yamlKeyText(key)}:`,
      ...keys.reduce<string[]>((acc, k) => acc.concat(yamlEntry(k, value[k], indent + 2)), []),
    ];
  }

  if (typeof value === "string" && value.includes("\n")) {
    const body = value.replace(/\r\n?/g, "\n");
    const trailingNewline = body.endsWith("\n");
    const content = trailingNewline ? body.slice(0, -1) : body;
    const inner = " ".repeat(indent + 2);
    const head = `${pad}${key === null ? "-" : `${yamlKeyText(key)}:`} ${trailingNewline ? "|" : "|-"}`;
    return [head, ...content.split("\n").map((line) => (line === "" ? "" : inner + line))];
  }

  return [`${pad}${key === null ? "-" : `${yamlKeyText(key)}:`} ${yamlScalarText(value)}`];
}

/** JSON 值 → YAML 文本。 */
function toYaml(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]\n";
    return value.reduce<string[]>((acc, item) => acc.concat(yamlEntry(null, item, 0)), []).join("\n") + "\n";
  }
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return "{}\n";
    return keys.reduce<string[]>((acc, k) => acc.concat(yamlEntry(k, value[k], 0)), []).join("\n") + "\n";
  }
  return yamlScalarText(value) + "\n";
}

/* ------------------------------------------------------------------ YAML 反序列化 */

type YamlLine = { indent: number; text: string; no: number; block?: string[] };

/** 剥掉行尾注释：只在引号外、且 # 前面是空白（或行首）时才算注释。 */
function stripYamlComment(raw: string): string {
  let quote: string | null = null;
  for (let i = 0; i < raw.length; i++) {
    const char = raw[i];
    if (quote !== null) {
      if (char === "\\" && quote === '"') {
        i++;
        continue;
      }
      if (char === quote) {
        if (quote === "'" && raw[i + 1] === "'") {
          i++;
          continue;
        }
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "#" && (i === 0 || /\s/.test(raw[i - 1]))) return raw.slice(0, i);
  }
  return raw;
}

function isBlockScalarHeader(text: string): boolean {
  return /^[|>][+-]?\d*$/.test(text) || /^\d+[+-]?[|>]$/.test(text);
}

function isSequenceLine(text: string): boolean {
  return text === "-" || text.startsWith("- ") || text.startsWith("-\t");
}

function tokenizeYaml(source: string): YamlLine[] {
  const rawLines = source.replace(/\r\n?/g, "\n").split("\n");
  const lines: YamlLine[] = [];

  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i];
    if (raw.trim() === "") continue;
    const lead = /^[ \t]*/.exec(raw)?.[0] ?? "";
    if (lead.includes("\t")) {
      throw new YamlError("缩进里用了 Tab。YAML 只认空格缩进，请把 Tab 换成空格。", i + 1);
    }
    const content = stripYamlComment(raw.slice(lead.length)).replace(/\s+$/, "");
    if (content === "") continue;
    if (content === "---") {
      if (lines.length > 0) throw new YamlError("只支持单个文档，这里出现了第二个 ---。", i + 1);
      continue;
    }
    if (content === "...") break;

    const tail = content.split(/\s+/).pop() ?? "";
    if (isBlockScalarHeader(tail)) {
      const body: string[] = [];
      let j = i + 1;
      while (j < rawLines.length) {
        const candidate = rawLines[j];
        if (candidate.trim() === "") {
          body.push("");
          j++;
          continue;
        }
        if (leadingSpaces(candidate) <= lead.length) break;
        body.push(candidate);
        j++;
      }
      lines.push({ indent: lead.length, text: content, no: i + 1, block: body });
      i = j - 1;
      continue;
    }

    lines.push({ indent: lead.length, text: content, no: i + 1 });
  }

  return lines;
}

/** 找「键: 值」的分隔冒号（跳过引号内和 [] {} 内的冒号）。 */
function matchYamlKey(text: string): { key: string; rest: string } | null {
  let quote: string | null = null;
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote !== null) {
      if (char === "\\" && quote === '"') {
        i++;
        continue;
      }
      if (char === quote) {
        if (quote === "'" && text[i + 1] === "'") {
          i++;
          continue;
        }
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "[" || char === "{") {
      depth++;
      continue;
    }
    if (char === "]" || char === "}") {
      depth--;
      continue;
    }
    if (char === ":" && depth === 0) {
      const next = text[i + 1];
      if (next === undefined || next === " " || next === "\t") {
        const rawKey = text.slice(0, i).trim();
        if (rawKey === "") return null;
        return { key: unquoteYamlKey(rawKey), rest: text.slice(i + 1).trim() };
      }
    }
  }
  return null;
}

function unquoteYamlKey(raw: string): string {
  if (raw.length >= 2 && raw.startsWith('"') && raw.endsWith('"')) {
    return decodeDoubleQuoted(raw.slice(1, -1));
  }
  if (raw.length >= 2 && raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1).replace(/''/g, "'");
  }
  return raw;
}

function decodeDoubleQuoted(body: string): string {
  let out = "";
  for (let i = 0; i < body.length; i++) {
    const char = body[i];
    if (char !== "\\") {
      out += char;
      continue;
    }
    const next = body[i + 1];
    i++;
    if (next === "n") out += "\n";
    else if (next === "t") out += "\t";
    else if (next === "r") out += "\r";
    else if (next === "0") out += "\u0000";
    else if (next === '"') out += '"';
    else if (next === "\\") out += "\\";
    else if (next === "/") out += "/";
    else if (next === "x") {
      out += String.fromCharCode(parseInt(body.slice(i + 1, i + 3), 16) || 0);
      i += 2;
    } else if (next === "u") {
      out += String.fromCharCode(parseInt(body.slice(i + 1, i + 5), 16) || 0);
      i += 4;
    } else if (next === undefined) out += "\\";
    else out += next;
  }
  return out;
}

/** 块标量：| 保留换行，> 折叠成空格；- 表示不要结尾换行。 */
function readBlockScalar(header: string, body: string[], parentIndent: number): string {
  const style = header.startsWith(">") ? "fold" : "literal";
  const strip = header.includes("-");
  const keep = header.includes("+");

  const source = body.slice();
  while (source.length > 0 && source[source.length - 1].trim() === "") source.pop();
  if (source.length === 0) return "";

  let minIndent = Number.POSITIVE_INFINITY;
  for (const line of source) {
    if (line.trim() === "") continue;
    const spaces = leadingSpaces(line);
    if (spaces < minIndent) minIndent = spaces;
  }
  if (!Number.isFinite(minIndent)) minIndent = parentIndent + 2;

  const content = source.map((line) => (line.trim() === "" ? "" : line.slice(minIndent)));

  let result: string;
  if (style === "literal") {
    result = content.join("\n");
  } else {
    // 折叠样式：同一段里的换行折成空格，空行表示分段（几个空行就是几个换行）
    let buffer: string[] = [];
    let breaks = 0;
    const flush = () => {
      if (buffer.length > 0) {
        if (result !== "") result += "\n".repeat(Math.max(0, breaks));
        result += buffer.join(" ");
        buffer = [];
      }
      breaks = 0;
    };
    result = "";
    for (const line of content) {
      if (line.trim() === "") {
        if (buffer.length > 0) flush();
        breaks++;
        continue;
      }
      buffer.push(line.trim());
    }
    flush();
  }

  if (strip) return result;
  if (keep) return result + "\n";
  return result === "" ? "" : result + "\n";
}

function parseYamlPlainScalar(text: string, lineNo: number): unknown {
  const trimmed = text.trim();
  if (trimmed === "") return null;
  if (trimmed.startsWith('"')) {
    if (!trimmed.endsWith('"') || trimmed.length < 2) {
      throw new YamlError("这一行的双引号没有闭合。", lineNo);
    }
    return decodeDoubleQuoted(trimmed.slice(1, -1));
  }
  if (trimmed.startsWith("'")) {
    if (!trimmed.endsWith("'") || trimmed.length < 2) {
      throw new YamlError("这一行的单引号没有闭合（YAML 里单引号要成对出现）。", lineNo);
    }
    return trimmed.slice(1, -1).replace(/''/g, "'");
  }
  if (/^(null|Null|NULL|~)$/.test(trimmed)) return null;
  if (/^(true|True|TRUE|yes|Yes|YES|on|On|ON)$/.test(trimmed)) return true;
  if (/^(false|False|FALSE|no|No|NO|off|Off|OFF)$/.test(trimmed)) return false;
  if (/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(trimmed)) return Number(trimmed);
  if (/^[-+]?\.(?:inf|Inf|INF)$/.test(trimmed)) return Number.POSITIVE_INFINITY;
  if (/^\.(?:nan|NaN|NAN)$/.test(trimmed)) return Number.NaN;
  return trimmed;
}

/** 内联值：[a, b] / {a: 1} / 普通标量。 */
function parseYamlInline(text: string, lineNo: number): unknown {
  const trimmed = text.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) {
    return parseYamlPlainScalar(trimmed, lineNo);
  }

  let pos = 0;
  const source = trimmed;

  const skipSpace = () => {
    while (pos < source.length && /\s/.test(source[pos])) pos++;
  };

  const readQuoted = (): string => {
    const quote = source[pos];
    pos++;
    let out = "";
    while (pos < source.length) {
      const char = source[pos];
      if (char === "\\" && quote === '"') {
        const next = source[pos + 1];
        pos += 2;
        if (next === "n") out += "\n";
        else if (next === "t") out += "\t";
        else if (next === "r") out += "\r";
        else if (next === "u") {
          out += String.fromCharCode(parseInt(source.slice(pos, pos + 4), 16) || 0);
          pos += 4;
        } else out += next ?? "";
        continue;
      }
      if (char === quote) {
        if (quote === "'" && source[pos + 1] === "'") {
          out += "'";
          pos += 2;
          continue;
        }
        pos++;
        return out;
      }
      out += char;
      pos++;
    }
    throw new YamlError("内联写法里的引号没有闭合。", lineNo);
  };

  const readValue = (): unknown => {
    skipSpace();
    const char = source[pos];
    if (char === "[") {
      pos++;
      const list: unknown[] = [];
      skipSpace();
      if (source[pos] === "]") {
        pos++;
        return list;
      }
      for (;;) {
        list.push(readValue());
        skipSpace();
        if (source[pos] === ",") {
          pos++;
          continue;
        }
        if (source[pos] === "]") {
          pos++;
          return list;
        }
        throw new YamlError("内联数组 [ ] 里少了逗号或者右中括号。", lineNo);
      }
    }
    if (char === "{") {
      pos++;
      const obj: Record<string, unknown> = {};
      skipSpace();
      if (source[pos] === "}") {
        pos++;
        return obj;
      }
      for (;;) {
        skipSpace();
        let key: string;
        if (source[pos] === '"' || source[pos] === "'") key = readQuoted();
        else {
          const start = pos;
          while (pos < source.length && !/[:,\]}]/.test(source[pos])) pos++;
          key = source.slice(start, pos).trim();
        }
        skipSpace();
        if (source[pos] !== ":") throw new YamlError("内联对象 { } 里的键后面少了冒号。", lineNo);
        pos++;
        obj[key] = readValue();
        skipSpace();
        if (source[pos] === ",") {
          pos++;
          continue;
        }
        if (source[pos] === "}") {
          pos++;
          return obj;
        }
        throw new YamlError("内联对象 { } 里少了逗号或者右大括号。", lineNo);
      }
    }
    if (char === '"' || char === "'") return readQuoted();
    const start = pos;
    while (pos < source.length && !/[,}\]]/.test(source[pos])) pos++;
    return parseYamlPlainScalar(source.slice(start, pos), lineNo);
  };

  const value = readValue();
  skipSpace();
  if (pos < source.length) {
    throw new YamlError(`内联写法后面多了内容：${source.slice(pos)}`, lineNo);
  }
  return value;
}

function parseYamlScalarLine(line: YamlLine, extraLines: YamlLine[]): unknown {
  const text = line.text.trim();
  if (line.block !== undefined && isBlockScalarHeader(text.split(/\s+/).pop() ?? "")) {
    const header = text.split(/\s+/).pop() ?? "|";
    return readBlockScalar(header, line.block, line.indent);
  }
  if (extraLines.length > 0) {
    // 纯文本换行续写：YAML 会把它折成一行空格
    const merged = [text, ...extraLines.map((l) => l.text.trim())].join(" ");
    return parseYamlInline(merged, line.no);
  }
  return parseYamlInline(text, line.no);
}

function parseYamlBlock(block: YamlLine[]): unknown {
  if (block.length === 0) return null;
  const head = block[0];
  if (isSequenceLine(head.text)) return parseYamlSequence(block);
  if (matchYamlKey(head.text) !== null) return parseYamlMapping(block);
  return parseYamlScalarLine(head, block.slice(1));
}

function parseYamlMapping(block: YamlLine[]): Record<string, unknown> {
  const indent = block[0].indent;
  const obj: Record<string, unknown> = {};
  let i = 0;

  while (i < block.length) {
    const line = block[i];
    if (line.indent < indent) break;
    if (line.indent > indent) {
      throw new YamlError(`第 ${line.no} 行多缩进了 ${line.indent - indent} 个空格，和上面的键对不齐。`, line.no);
    }
    if (isSequenceLine(line.text)) {
      throw new YamlError("这里应该是「键: 值」，但写成了列表项。", line.no);
    }
    const match = matchYamlKey(line.text);
    if (match === null) {
      throw new YamlError(`看不懂这一行：${line.text}（要写成「键: 值」）。`, line.no);
    }
    const { key, rest } = match;

    if (rest === "") {
      let j = i + 1;
      while (j < block.length && block[j].indent > indent) j++;
      if (j > i + 1) {
        obj[key] = parseYamlBlock(block.slice(i + 1, j));
        i = j;
        continue;
      }
      // 允许「键: 回车，再在同缩进写 - 列表」这种写法
      let k = i + 1;
      while (k < block.length && block[k].indent === indent && isSequenceLine(block[k].text)) k++;
      if (k > i + 1) {
        obj[key] = parseYamlSequence(block.slice(i + 1, k));
        i = k;
        continue;
      }
      obj[key] = null;
      i++;
      continue;
    }

    if (isBlockScalarHeader(rest)) {
      // 块标量的正文在 tokenize 阶段就已经收进了 line.block，这里直接用
      obj[key] = readBlockScalar(rest, line.block ?? [], indent);
      i++;
      continue;
    }

    let j = i + 1;
    while (j < block.length && block[j].indent > indent) j++;
    if (j > i + 1) {
      const inlineValue = parseYamlInline(rest, line.no);
      if (typeof inlineValue === "string") {
        obj[key] = [inlineValue, ...block.slice(i + 1, j).map((l) => l.text.trim())].join(" ").trim();
      } else {
        throw new YamlError(
          `第 ${block[i + 1].no} 行比上一行缩进更深，可上一行的值已经写完了。检查一下是不是多打了空格。`,
          block[i + 1].no,
        );
      }
      i = j;
      continue;
    }

    obj[key] = parseYamlInline(rest, line.no);
    i++;
  }

  if (i < block.length) {
    throw new YamlError(`第 ${block[i].no} 行的缩进和这一块对不上。`, block[i].no);
  }
  return obj;
}

function parseYamlSequence(block: YamlLine[]): unknown[] {
  const indent = block[0].indent;
  const items: unknown[] = [];
  let i = 0;

  while (i < block.length) {
    const line = block[i];
    if (line.indent < indent) break;
    if (line.indent > indent) {
      throw new YamlError(`第 ${line.no} 行多缩进了 ${line.indent - indent} 个空格，和上面的列表项对不齐。`, line.no);
    }
    if (!isSequenceLine(line.text)) {
      throw new YamlError(`第 ${line.no} 行不是列表项（列表项要以「- 」开头）。`, line.no);
    }

    const afterDash = line.text.slice(1);
    const trimmed = afterDash.replace(/^[ \t]+/, "");
    const restIndent = line.indent + 1 + (afterDash.length - trimmed.length);

    let j = i + 1;
    while (j < block.length && block[j].indent > indent) j++;

    if (trimmed === "") {
      if (j > i + 1) items.push(parseYamlBlock(block.slice(i + 1, j)));
      else items.push(null);
      i = j;
      continue;
    }

    const synthetic: YamlLine = { indent: restIndent, text: trimmed, no: line.no, block: line.block };
    const extra = block.slice(i + 1, j);
    if (isSequenceLine(trimmed) || matchYamlKey(trimmed) !== null) {
      items.push(parseYamlBlock([synthetic, ...extra]));
    } else {
      items.push(parseYamlScalarLine(synthetic, extra));
    }
    i = j;
  }

  if (i < block.length) {
    throw new YamlError(`第 ${block[i].no} 行的缩进和这一块对不上。`, block[i].no);
  }
  return items;
}

/** YAML 文本 → JSON 值。支持的是常用子集：缩进映射、列表、块标量、内联 [] {}、引号、注释。 */
function parseYamlText(source: string): Result<unknown> {
  try {
    const lines = tokenizeYaml(source);
    if (lines.length === 0) return makeOk(null);
    return makeOk(parseYamlBlock(lines));
  } catch (error) {
    if (error instanceof YamlError) {
      return makeErr(`第 ${error.line} 行：${error.message}`, {
        line: error.line,
        lineText: lineTextAt(source, error.line),
      });
    }
    return makeErr(
      error instanceof Error ? `解析 YAML 时出错：${error.message}` : "解析 YAML 时出错。",
    );
  }
}

/* ------------------------------------------------------------------ XML 序列化 / 解析 */

function xmlEscapeText(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function xmlEscapeAttr(text: string): string {
  return xmlEscapeText(text).replace(/"/g, "&quot;");
}

function isValidXmlName(name: string): boolean {
  return /^[A-Za-z_\u3400-\u9fff][A-Za-z0-9_.\-\u3400-\u9fff]*$/.test(name);
}

function scalarToText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value) ?? "";
}

function renderXmlElement(name: string, node: unknown, depth: number, out: string[]): void {
  if (!isValidXmlName(name)) {
    throw new DataError(
      `「${name}」不能直接当 XML 标签名。标签名只能由字母、数字、下划线、中划线、点组成，并且不能用数字开头；想让它当属性就给键名加个 @ 前缀。`,
    );
  }
  const pad = "  ".repeat(depth);

  if (Array.isArray(node)) {
    if (node.length === 0) {
      out.push(`${pad}<${name}/>`);
      return;
    }
    for (const item of node) renderXmlElement(name, item, depth, out);
    return;
  }

  if (node === null || node === undefined) {
    out.push(`${pad}<${name}/>`);
    return;
  }

  if (!isPlainObject(node)) {
    out.push(`${pad}<${name}>${xmlEscapeText(scalarToText(node))}</${name}>`);
    return;
  }

  const attrs: string[] = [];
  const children: Array<[string, unknown]> = [];
  let text = "";

  for (const key of Object.keys(node)) {
    const value = node[key];
    if (key.startsWith("@")) {
      const attrName = key.slice(1);
      if (!isValidXmlName(attrName)) {
        throw new DataError(`「${attrName}」不能当 XML 属性名（属性名和标签名的规则一样）。`);
      }
      attrs.push(`${attrName}="${xmlEscapeAttr(scalarToText(value))}"`);
      continue;
    }
    if (key === "#text") {
      text = scalarToText(value);
      continue;
    }
    children.push([key, value]);
  }

  const attrText = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";

  if (children.length === 0) {
    if (text === "") {
      out.push(`${pad}<${name}${attrText}/>`);
      return;
    }
    out.push(`${pad}<${name}${attrText}>${xmlEscapeText(text)}</${name}>`);
    return;
  }

  out.push(`${pad}<${name}${attrText}>`);
  if (text !== "") out.push(`${pad}  ${xmlEscapeText(text)}`);
  for (const [childName, childValue] of children) {
    renderXmlElement(childName, childValue, depth + 1, out);
  }
  out.push(`${pad}</${name}>`);
}

/**
 * JSON 值 → XML 文本。映射规则（界面上也会写出来）：
 *  - 顶层对象只有一个键时，用这个键当根元素；否则根元素叫 root；
 *  - 对象的普通键 → 子元素；键以 @ 开头 → 属性；键 #text → 文本内容；
 *  - 数组 → 同名子元素重复出现；
 *  - null → 自闭合空元素；数字/布尔 → 文本。
 */
function jsonToXml(value: unknown, rootName = "root"): Result<string> {
  try {
    const out: string[] = [];
    if (isPlainObject(value)) {
      const keys = Object.keys(value);
      if (keys.length === 1 && !keys[0].startsWith("@") && !keys[0].startsWith("#")) {
        renderXmlElement(keys[0], value[keys[0]], 0, out);
      } else {
        renderXmlElement(rootName, value, 0, out);
      }
    } else {
      renderXmlElement(rootName, value, 0, out);
    }
    return makeOk(out.join("\n") + "\n");
  } catch (error) {
    if (error instanceof DataError) return makeErr(error.message);
    return makeErr(error instanceof Error ? `转成 XML 时出错：${error.message}` : "转成 XML 时出错。");
  }
}

type XmlElement = {
  name: string;
  attrs: Array<[string, string]>;
  children: XmlElement[];
  text: string;
  line: number;
};

function decodeXmlEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = parseInt(body.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (body.startsWith("#")) {
      const code = parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (body === "lt") return "<";
    if (body === "gt") return ">";
    if (body === "amp") return "&";
    if (body === "quot") return '"';
    if (body === "apos") return "'";
    return whole;
  });
}

function lineStarts(source: string): number[] {
  const starts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

function lineAt(starts: number[], pos: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if (starts[mid] <= pos) low = mid;
    else high = mid - 1;
  }
  return low + 1;
}

function findTagEnd(source: string, from: number): number {
  let quote: string | null = null;
  for (let i = from + 1; i < source.length; i++) {
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

function parseXmlOpenTag(body: string, line: number): XmlElement {
  const match = /^([^\s/>]+)/.exec(body);
  if (match === null) throw new XmlError("标签名是空的。", line);
  const name = match[1];
  const rest = body.slice(name.length);
  const attrs: Array<[string, string]> = [];

  const attrPattern = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
  let consumed = 0;
  let attrMatch: RegExpExecArray | null = attrPattern.exec(rest);
  while (attrMatch !== null) {
    const value = attrMatch[2] !== undefined ? attrMatch[2] : attrMatch[3] ?? "";
    attrs.push([attrMatch[1], decodeXmlEntities(value)]);
    consumed = attrPattern.lastIndex;
    attrMatch = attrPattern.exec(rest);
  }

  const leftover = rest.slice(consumed).trim();
  if (leftover !== "") {
    throw new XmlError(`属性看不懂：${leftover}（属性要写成 名字="值" 的形式）。`, line);
  }

  return { name, attrs, children: [], text: "", line };
}

function parseXmlDocument(source: string): XmlElement {
  const src = source.replace(/\r\n?/g, "\n");
  const starts = lineStarts(src);
  let pos = 0;
  let root: XmlElement | null = null;
  const stack: XmlElement[] = [];

  while (pos < src.length) {
    const lt = src.indexOf("<", pos);
    if (lt === -1) {
      const tail = src.slice(pos);
      if (stack.length > 0) stack[stack.length - 1].text += decodeXmlEntities(tail);
      else if (tail.trim() !== "") {
        throw new XmlError("根元素外面还有文字。XML 只允许有一个根元素。", lineAt(starts, pos));
      }
      break;
    }

    if (lt > pos) {
      const chunk = src.slice(pos, lt);
      if (stack.length > 0) stack[stack.length - 1].text += decodeXmlEntities(chunk);
      else if (chunk.trim() !== "") {
        throw new XmlError("根元素外面还有文字。XML 只允许有一个根元素。", lineAt(starts, pos));
      }
    }

    if (src.startsWith("<!--", lt)) {
      const end = src.indexOf("-->", lt + 4);
      if (end === -1) throw new XmlError("注释没有收尾（少了 --）。", lineAt(starts, lt));
      pos = end + 3;
      continue;
    }

    if (src.startsWith("<![CDATA[", lt)) {
      const end = src.indexOf("]]>", lt + 9);
      if (end === -1) throw new XmlError("CDATA 没有收尾（少了 ]）。", lineAt(starts, lt));
      if (stack.length === 0) throw new XmlError("CDATA 必须在某个元素里面。", lineAt(starts, lt));
      stack[stack.length - 1].text += src.slice(lt + 9, end);
      pos = end + 3;
      continue;
    }

    if (src.startsWith("<?", lt)) {
      const end = src.indexOf("?>", lt + 2);
      if (end === -1) throw new XmlError("XML 声明没有收尾（少了 ?）。", lineAt(starts, lt));
      pos = end + 2;
      continue;
    }

    if (src.startsWith("<!", lt)) {
      const end = src.indexOf(">", lt + 2);
      if (end === -1) throw new XmlError("DOCTYPE 之类的声明没有收尾。", lineAt(starts, lt));
      pos = end + 1;
      continue;
    }

    const gt = findTagEnd(src, lt);
    if (gt === -1) throw new XmlError("标签没有收尾（少了右尖括号）。", lineAt(starts, lt));

    const inner = src.slice(lt + 1, gt).trim();
    const line = lineAt(starts, lt);

    if (inner.startsWith("/")) {
      const name = inner.slice(1).trim();
      const open = stack.pop();
      if (open === undefined) {
        throw new XmlError(`多了一个结束标签 </${name}>，前面没有对应的开始标签。`, line);
      }
      if (open.name !== name) {
        throw new XmlError(`标签对不上：这里是 </${name}>，但正在等的是 </${open.name}>。`, line);
      }
      if (stack.length === 0) root = open;
    } else {
      const selfClosing = inner.endsWith("/");
      const body = selfClosing ? inner.slice(0, -1).trim() : inner;
      const element = parseXmlOpenTag(body, line);
      if (stack.length === 0) {
        if (root !== null) throw new XmlError("出现了第二个根元素。XML 只允许有一个根元素。", line);
        if (selfClosing) root = element;
      } else {
        stack[stack.length - 1].children.push(element);
      }
      if (!selfClosing) stack.push(element);
    }

    pos = gt + 1;
  }

  if (stack.length > 0) {
    const open = stack[stack.length - 1];
    throw new XmlError(`<${open.name}> 没有对应的结束标签。`, open.line);
  }
  if (root === null) throw new XmlError("没有找到任何元素，检查一下内容是不是完整的 XML。", 1);
  return root;
}

function xmlElementToJson(element: XmlElement): unknown {
  const obj: Record<string, unknown> = {};

  for (const [key, value] of element.attrs) obj[`@${key}`] = value;

  const grouped = new Map<string, unknown[]>();
  for (const child of element.children) {
    const value = xmlElementToJson(child);
    const list = grouped.get(child.name);
    if (list === undefined) grouped.set(child.name, [value]);
    else list.push(value);
  }
  for (const [name, list] of grouped) obj[name] = list.length === 1 ? list[0] : list;

  const text = element.text.trim();
  if (text !== "") {
    if (Object.keys(obj).length === 0) return text;
    obj["#text"] = text;
  }

  if (Object.keys(obj).length === 0) return "";
  return obj;
}

/** XML 文本 → JSON 值（根元素名会变成最外层的键）。 */
function xmlToJson(source: string): Result<unknown> {
  try {
    const root = parseXmlDocument(source);
    const wrapper: Record<string, unknown> = {};
    wrapper[root.name] = xmlElementToJson(root);
    return makeOk(wrapper);
  } catch (error) {
    if (error instanceof XmlError) {
      return makeErr(`第 ${error.line} 行：${error.message}`, {
        line: error.line,
        lineText: lineTextAt(source, error.line),
      });
    }
    return makeErr(error instanceof Error ? `解析 XML 时出错：${error.message}` : "解析 XML 时出错。");
  }
}

/* ------------------------------------------------------------------ CSV 解析 / 生成 */

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
  const lines = linesOf(source).filter((line) => line.trim() !== "").slice(0, 5);
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

function parseCsv(source: string, delimiter: string): CsvTable {
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

function csvEscapeField(value: string, delimiter: string): string {
  if (value === "") return "";
  const mustQuote =
    value.includes(delimiter) ||
    value.includes('"') ||
    value.includes("\n") ||
    value.includes("\r") ||
    value !== value.trim();
  if (!mustQuote) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

function serializeCsv(rows: string[][], delimiter: string, eol = "\r\n"): string {
  if (rows.length === 0) return "";
  return rows.map((row) => row.map((cell) => csvEscapeField(cell, delimiter)).join(delimiter)).join(eol) + eol;
}

/** JSON 值 → 二维表格。 */
function jsonToRows(value: unknown): Result<string[][]> {
  const warnings: string[] = [];

  const cellToText = (cell: unknown): string => {
    if (cell === null || cell === undefined) return "";
    if (typeof cell === "string") return cell;
    if (typeof cell === "number" || typeof cell === "boolean") return String(cell);
    if (warnings.every((w) => !w.startsWith("有嵌套"))) {
      warnings.push("有嵌套的对象或数组，已经压成一行 JSON 文本塞进单元格里（那一格会有点长）。");
    }
    return JSON.stringify(cell) ?? "";
  };

  if (Array.isArray(value)) {
    if (value.length === 0) return makeErr("JSON 数组是空的，没有可以变成表格的数据。");

    if (value.every((item) => isPlainObject(item))) {
      const keys: string[] = [];
      for (const item of value) {
        for (const key of Object.keys(item as Record<string, unknown>)) {
          if (!keys.includes(key)) keys.push(key);
        }
      }
      const rows: string[][] = [keys.slice()];
      for (const item of value) {
        const record = item as Record<string, unknown>;
        rows.push(keys.map((key) => (key in record ? cellToText(record[key]) : "")));
      }
      const usedKeys = new Set<string>();
      for (const item of value) {
        for (const key of Object.keys(item as Record<string, unknown>)) usedKeys.add(key);
      }
      if (usedKeys.size > keys.length) warnings.push("有些对象的字段不统一，缺的位置已经留空。");
      return makeOk(rows, warnings);
    }

    if (value.every((item) => Array.isArray(item))) {
      return makeOk(value.map((row) => (row as unknown[]).map((cell) => cellToText(cell))), warnings);
    }

    if (value.every((item) => item === null || typeof item !== "object")) {
      return makeOk([["value"], ...value.map((item) => [cellToText(item)])], warnings);
    }

    return makeErr("这个数组里对象和数字混在一起了，拼不成一张规整的表。让每一项结构一致（都是对象或都是数组）再试。");
  }

  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return makeErr("JSON 对象是空的，没有可以变成表格的数据。");
    return makeOk([keys.slice(), keys.map((key) => cellToText(value[key]))], warnings);
  }

  return makeErr("要变成表格，JSON 顶层得是数组或对象。单个数字或字符串没有行列结构。");
}

/** 二维表格 → JSON（首行当表头就是对象数组，否则是二维字符串数组）。 */
function csvRowsToJson(rows: string[][], hasHeader: boolean): unknown {
  if (rows.length === 0) return [];
  if (!hasHeader) return rows.map((row) => row.slice());

  const header = rows[0].map((cell, index) => (cell.trim() === "" ? `列${index + 1}` : cell.trim()));
  const seen = new Map<string, number>();
  const keys = header.map((cell) => {
    const times = seen.get(cell) ?? 0;
    seen.set(cell, times + 1);
    return times === 0 ? cell : `${cell}_${times + 1}`;
  });

  return rows.slice(1).map((row) => {
    const record: Record<string, string> = {};
    keys.forEach((key, index) => {
      record[key] = row[index] ?? "";
    });
    return record;
  });
}

/* ------------------------------------------------------------------ 格式识别 */

type FormatKind = "empty" | "json" | "yaml" | "xml" | "csv";

function detectJsonOrYaml(source: string): FormatKind {
  const trimmed = source.trim();
  if (trimmed === "") return "empty";
  try {
    JSON.parse(trimmed);
    return "json";
  } catch {
    /* 不是合法 JSON，继续看是不是 YAML */
  }
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  if (trimmed.startsWith("<")) return "xml";
  return "yaml";
}

function detectJsonOrXml(source: string): FormatKind {
  const trimmed = source.trim();
  if (trimmed === "") return "empty";
  if (trimmed.startsWith("<")) return "xml";
  return "json";
}

function detectJsonOrCsv(source: string): FormatKind {
  const trimmed = source.trim();
  if (trimmed === "") return "empty";
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) return "json";
  return "csv";
}

/* ==========================================================================================
 * PURE LOGIC ZONE END
 * ========================================================================================== */

/* ------------------------------------------------------------------ 示例数据 */

const JSON_YAML_SAMPLE = JSON.stringify(
  {
    name: "芙宁娜",
    title: "Furina · 水之神",
    version: 2,
    active: true,
    id: "123",
    regions: ["枫丹", "歌剧", "审判"],
    profile: {
      level: 90,
      weapon: null,
      motto: "众水的颂诗\n—— 我要向全世界的观众致意",
    },
    constellation: [1, 2, 3],
  },
  null,
  2,
);

const JSON_XML_SAMPLE = JSON.stringify(
  {
    note: {
      "@id": "n1",
      "@lang": "zh-CN",
      to: "旅行者",
      from: "芙宁娜",
      title: "水的颂诗",
      body: { "@style": "italic", "#text": "所有水都会记得来时的路。" },
      tags: ["枫丹", "歌剧", "审判"],
      urgent: false,
    },
  },
  null,
  2,
);

const JSON_CSV_SAMPLE = JSON.stringify(
  [
    { 姓名: "芙宁娜", 阵营: "枫丹", 等级: 90, 备注: "众水的颂诗" },
    { 姓名: "那维莱特", 阵营: "枫丹", 等级: 90, 备注: "最高审判官" },
    { 姓名: "旅行者", 阵营: "游历", 等级: 80, 备注: "备注里带逗号, 还带「引号」" },
  ],
  null,
  2,
);

/** CSV 方向用的示例：故意带上「被引号包住的逗号」和「单元格里的换行」。 */
const CSV_TEXT_SAMPLE = [
  "姓名,阵营,等级,备注",
  "芙宁娜,枫丹,90,众水的颂诗",
  '那维莱特,枫丹,90,"最高审判官, 水龙王"',
  "旅行者,游历,80,\"第一行\n第二行\"",
].join("\n");

/* ------------------------------------------------------------------ 共用外观件 */

/** 错误提示：规范里那套固定样式；错误带行号时，把出错那一行也摆出来。 */
function ErrorNote({
  message,
  line,
  lineText,
}: {
  message: string;
  line?: number;
  lineText?: string;
}) {
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
          <code className="min-w-0 flex-1 overflow-x-auto whitespace-pre font-mono-accent text-[11px] text-foreground/80">
            {lineText}
          </code>
        </div>
      )}
    </div>
  );
}

function WarningList({ warnings }: { warnings: string[] }) {
  if (warnings.length === 0) return null;
  return (
    <div className="space-y-1.5 rounded-xl border border-border/60 bg-muted/30 px-4 py-3">
      {warnings.map((warning) => (
        <div key={warning} className="flex items-start gap-2 text-[11.5px] leading-relaxed text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
          <span>{warning}</span>
        </div>
      ))}
    </div>
  );
}

/** 复制按钮 + 复制反馈。 */
function CopyButton({
  text,
  label = "复制",
  size = "sm",
  variant = "ghost",
  className,
}: {
  text: string;
  label?: string;
  size?: "sm" | "default";
  variant?: "ghost" | "outline" | "secondary";
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
    <Button
      type="button"
      variant={variant}
      size={size}
      onClick={handleCopy}
      className={className}
    >
      {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "已复制" : label}
    </Button>
  );
}

/** 结果区的空状态：不留白，给引导 + 填入示例。 */
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
      <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">{hint}</p>
      {action}
    </div>
  );
}

/** 元信息小字：行数 / 字节数 / 行列数这种。 */
function MetaText({ children }: { children: ReactNode }) {
  return <span className="font-mono-accent text-[11px] text-muted-foreground">{children}</span>;
}

/** JSON / YAML / XML / CSV 三个转换工共用的方向指示器。 */
function DirectionBar({
  fromLabel,
  toLabel,
  manual,
  onToggle,
  onAuto,
}: {
  fromLabel: string;
  toLabel: string;
  manual: boolean;
  onToggle: () => void;
  onAuto: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-border/60 bg-card/70 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={fromLabel === "等待输入" ? "secondary" : "default"}>{fromLabel}</Badge>
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
        <Badge variant="outline">{toLabel}</Badge>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Button type="button" variant="ghost" size="sm" onClick={onToggle} className="h-7 px-2 text-[11px]">
          <ArrowLeftRight className="h-3.5 w-3.5" /> 换个方向
        </Button>
        {manual ? (
          <Button type="button" variant="ghost" size="sm" onClick={onAuto} className="h-7 px-2 text-[11px] text-primary">
            <RefreshCw className="h-3.5 w-3.5" /> 恢复自动识别
          </Button>
        ) : (
          <span className="text-[11px] text-muted-foreground">方向是自动识别的</span>
        )}
      </div>
    </div>
  );
}

function ResultHeader({
  formatLabel,
  text,
  extra,
  copyLabel = "复制结果",
}: {
  formatLabel: string;
  text: string;
  extra?: ReactNode;
  copyLabel?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Label>输出</Label>
        <Badge variant="secondary">{formatLabel}</Badge>
        <MetaText>
          {countLines(text)} 行 · {byteLength(text)} 字节
        </MetaText>
        {extra}
      </div>
      <CopyButton text={text} label={copyLabel} className="h-7 px-2 text-xs" />
    </div>
  );
}

/* ==========================================================================================
 * 工具 1：JSON ↔ YAML
 * 布局模式 A（转换对照）：输入和输出要互相对照，所以左右并排；顶部多了「方向自动识别」。
 * ========================================================================================== */

type JsonYamlDirection = "auto" | "json2yaml" | "yaml2json";

export function JsonYamlTool() {
  const [input, setInput] = useToolDraft<string>("json-yaml", "input", "");
  const [direction, setDirection] = useToolDraft<JsonYamlDirection>("json-yaml", "direction", "auto");

  const detected = useMemo(() => detectJsonOrYaml(input), [input]);
  const effective: "json2yaml" | "yaml2json" | null =
    direction === "auto"
      ? detected === "json"
        ? "json2yaml"
        : detected === "yaml"
          ? "yaml2json"
          : null
      : direction;

  const fromLabel =
    detected === "empty" ? "等待输入" : detected === "json" ? "检测到：JSON" : "检测到：YAML";
  const toLabel =
    effective === null ? "先粘点内容进来" : effective === "json2yaml" ? "将转换为 YAML" : "将转换为 JSON";

  const conversion = useMemo(() => {
    if (input.trim() === "" || effective === null) {
      return { output: "", error: null as string | null, line: undefined as number | undefined, lineText: undefined as string | undefined };
    }
    if (effective === "json2yaml") {
      const parsed = parseJsonText(input);
      if (!parsed.ok) {
        return { output: "", error: parsed.message, line: parsed.line, lineText: parsed.lineText };
      }
      return { output: toYaml(parsed.value), error: null, line: undefined, lineText: undefined };
    }
    const parsed = parseYamlText(input);
    if (!parsed.ok) {
      return { output: "", error: parsed.message, line: parsed.line, lineText: parsed.lineText };
    }
    return {
      output: JSON.stringify(parsed.value, null, 2) + "\n",
      error: null,
      line: undefined,
      lineText: undefined,
    };
  }, [input, effective]);

  const toggleDirection = () => {
    const next: JsonYamlDirection = (effective ?? "json2yaml") === "json2yaml" ? "yaml2json" : "json2yaml";
    setDirection(next);
  };

  return (
    <div className="space-y-4">
      <DirectionBar
        fromLabel={fromLabel}
        toLabel={toLabel}
        manual={direction !== "auto"}
        onToggle={toggleDirection}
        onAuto={() => setDirection("auto")}
      />

      {conversion.error !== null && (
        <ErrorNote message={conversion.error} line={conversion.line} lineText={conversion.lineText} />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 输入 */}
        <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Label>输入</Label>
              <MetaText>
                {countLines(input)} 行 · {input.length} 字符
              </MetaText>
            </div>
            <div className="flex items-center gap-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => setInput(JSON_YAML_SAMPLE)} className="h-7 px-2 text-xs">
                <Wand2 className="h-3.5 w-3.5" /> 填入示例
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setInput("")}
                className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" /> 清空
              </Button>
            </div>
          </div>

          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={'{\n  "name": "芙宁娜",\n  "regions": ["枫丹", "歌剧"]\n}\n\n…或者直接粘 YAML：\nname: 芙宁娜\nregions:\n  - 枫丹'}
            spellCheck={false}
            wrap="off"
            className="thin-scroll min-h-[380px] resize-y whitespace-pre font-mono-accent text-xs leading-relaxed md:min-h-[440px]"
          />

          {/* 输入框下面这一行就是格式检测结果，用户不用自己选方向 */}
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={detected === "empty" ? "secondary" : "default"}>
              {detected === "empty" ? "等待输入" : detected === "json" ? "检测到：JSON" : "检测到：YAML"}
            </Badge>
            <span className="text-[11px] leading-relaxed text-muted-foreground">
              {detected === "empty"
                ? "空着的时候什么都不做；粘进内容后自动判断格式。"
                : detected === "json"
                  ? "看起来是 JSON，会按 YAML 输出。多行文本写成 | 块，字符串形式的数字会加引号保住类型。"
                  : "看起来是 YAML，会按 JSON 输出。注释会被丢掉，缩进必须用空格。"}
            </span>
          </div>
        </div>

        {/* 输出 */}
        <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
          <ResultHeader
            formatLabel={effective === "yaml2json" ? "JSON" : "YAML"}
            text={conversion.output}
            copyLabel="复制结果"
          />
          {conversion.output !== "" ? (
            <pre className="thin-scroll max-h-[560px] min-h-[380px] overflow-auto rounded-xl border border-border bg-background/40 p-4 font-mono-accent text-xs leading-relaxed whitespace-pre select-text md:min-h-[440px]">
              {conversion.output}
            </pre>
          ) : (
            <EmptyPane
              className="min-h-[380px] md:min-h-[440px]"
              icon={<Braces className="h-8 w-8" />}
              hint={
                conversion.error !== null
                  ? "上面那段还有问题，改好这里就会出现结果。"
                  : "左边粘一段 JSON 或 YAML，结果会立刻出现在这里。"
              }
              action={
                <Button type="button" variant="outline" size="sm" onClick={() => setInput(JSON_YAML_SAMPLE)}>
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
 * 工具 2：JSON ↔ XML
 * 布局模式 A（转换对照）+ 一张映射规则说明卡（XML 的映射规则不写清楚没人看得懂结果）。
 * ========================================================================================== */

type JsonXmlDirection = "auto" | "json2xml" | "xml2json";

export function JsonXmlTool() {
  const [input, setInput] = useToolDraft<string>("json-xml", "input", "");
  const [direction, setDirection] = useToolDraft<JsonXmlDirection>("json-xml", "direction", "auto");
  const [showRules, setShowRules] = useToolDraft<boolean>("json-xml", "showRules", true);

  const detected = useMemo(() => detectJsonOrXml(input), [input]);
  const effective: "json2xml" | "xml2json" | null =
    direction === "auto"
      ? detected === "xml"
        ? "xml2json"
        : detected === "json"
          ? "json2xml"
          : null
      : direction;

  const fromLabel =
    detected === "empty" ? "等待输入" : detected === "xml" ? "检测到：XML" : "检测到：JSON";
  const toLabel =
    effective === null ? "先粘点内容进来" : effective === "json2xml" ? "将转换为 XML" : "将转换为 JSON";

  const conversion = useMemo(() => {
    const empty = {
      output: "",
      error: null as string | null,
      line: undefined as number | undefined,
      lineText: undefined as string | undefined,
      warnings: [] as string[],
    };
    if (input.trim() === "" || effective === null) return empty;

    if (effective === "json2xml") {
      const parsed = parseJsonText(input);
      if (!parsed.ok) {
        return { ...empty, error: parsed.message, line: parsed.line, lineText: parsed.lineText };
      }
      const xml = jsonToXml(parsed.value);
      if (!xml.ok) return { ...empty, error: xml.message };
      return { ...empty, output: xml.value, warnings: xml.warnings };
    }

    const parsed = xmlToJson(input);
    if (!parsed.ok) {
      return { ...empty, error: parsed.message, line: parsed.line, lineText: parsed.lineText };
    }
    return { ...empty, output: JSON.stringify(parsed.value, null, 2) + "\n", warnings: parsed.warnings };
  }, [input, effective]);

  const elementCount = useMemo(() => {
    if (conversion.output === "" || effective !== "json2xml") return 0;
    return (conversion.output.match(/<[A-Za-z_\u3400-\u9fff][^>]*>/g) ?? []).length;
  }, [conversion.output, effective]);

  const toggleDirection = () => {
    const next: JsonXmlDirection = (effective ?? "json2xml") === "json2xml" ? "xml2json" : "json2xml";
    setDirection(next);
  };

  return (
    <div className="space-y-4">
      <DirectionBar
        fromLabel={fromLabel}
        toLabel={toLabel}
        manual={direction !== "auto"}
        onToggle={toggleDirection}
        onAuto={() => setDirection("auto")}
      />

      {/* 映射规则说明卡：XML 的数组/属性/文本怎么来，必须写明白 */}
      <div className="rounded-2xl border border-border/70 bg-card/60 p-5 shadow-xs backdrop-blur-md">
        <button
          type="button"
          onClick={() => setShowRules(!showRules)}
          className="flex w-full items-center justify-between gap-3 text-left"
        >
          <span className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
            <Info className="h-4 w-4 text-primary" /> 这个工具用的映射规则
          </span>
          <span className="text-[11px] text-muted-foreground">{showRules ? "收起" : "展开"}</span>
        </button>

        {showRules && (
          <div className="mt-3 grid gap-2.5 md:grid-cols-2">
            <div className="space-y-2 rounded-xl border border-border/50 bg-muted/25 p-3.5">
              <div className="text-[12px] font-semibold text-foreground">JSON → XML</div>
              <ul className="space-y-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
                <li>
                  <code className="rounded bg-muted px-1 font-mono-accent text-[11px] text-foreground">@name</code>{" "}
                  开头的键 → 当前元素的属性
                </li>
                <li>
                  <code className="rounded bg-muted px-1 font-mono-accent text-[11px] text-foreground">#text</code>{" "}
                  键 → 当前元素的文本内容
                </li>
                <li>数组 → 同名的子元素重复出现（{"{"}tags: [a, b]{"}"} 会变成两个 tags 元素）</li>
                <li>顶层对象只有一个键时，用它当根元素；否则根元素叫 root</li>
                <li>数字、布尔会写成文本；null 写成自闭合空元素</li>
                <li>文本里的尖括号和 &amp; 会转义；中文标签名可用</li>
                <li>键名不是合法标签名（比如带空格或数字开头）时会报错，不会偷偷改名</li>
              </ul>
            </div>
            <div className="space-y-2 rounded-xl border border-border/50 bg-muted/25 p-3.5">
              <div className="text-[12px] font-semibold text-foreground">XML → JSON</div>
              <ul className="space-y-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
                <li>属性 → @开头的键；文本 → #text（元素没有属性也没有子元素时直接给字符串）</li>
                <li>同名的兄弟元素 → 合并成数组，只有一个时给单个值</li>
                <li>根元素名会成为最外层的键</li>
                <li>XML 里没有类型信息，文本一律按字符串处理；要数字的话在 JSON 里自己改</li>
                <li>注释会被丢掉，CDATA 里的内容会保留</li>
              </ul>
            </div>
          </div>
        )}
      </div>

      {conversion.error !== null && (
        <ErrorNote message={conversion.error} line={conversion.line} lineText={conversion.lineText} />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Label>输入</Label>
              <MetaText>
                {countLines(input)} 行 · {input.length} 字符
              </MetaText>
            </div>
            <div className="flex items-center gap-1">
              <Button type="button" variant="ghost" size="sm" onClick={() => setInput(JSON_XML_SAMPLE)} className="h-7 px-2 text-xs">
                <Wand2 className="h-3.5 w-3.5" /> 填入示例
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setInput("")}
                className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" /> 清空
              </Button>
            </div>
          </div>

          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={'{\n  "note": { "@id": "n1", "to": "旅行者", "tags": ["枫丹", "歌剧"] }\n}\n\n…或者粘 XML：\n<note id="n1">\n  <to>旅行者</to>\n</note>'}
            spellCheck={false}
            wrap="off"
            className="thin-scroll min-h-[380px] resize-y whitespace-pre font-mono-accent text-xs leading-relaxed md:min-h-[440px]"
          />

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={detected === "empty" ? "secondary" : "default"}>
              {detected === "empty" ? "等待输入" : detected === "xml" ? "检测到：XML" : "检测到：JSON"}
            </Badge>
            <span className="text-[11px] leading-relaxed text-muted-foreground">
              {detected === "empty"
                ? "粘 JSON 或 XML 都行，以左尖括号开头的会当成 XML。"
                : detected === "xml"
                  ? "看起来是 XML，会按上面的规则折回 JSON。"
                  : "看起来是 JSON，会按上面的规则展开成缩进好的 XML。"}
            </span>
          </div>
        </div>

        <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
          <ResultHeader
            formatLabel={effective === "xml2json" ? "JSON" : "XML"}
            text={conversion.output}
            copyLabel="复制结果"
            extra={elementCount > 0 ? <MetaText>{elementCount} 个标签</MetaText> : undefined}
          />
          {conversion.output !== "" ? (
            <pre className="thin-scroll max-h-[560px] min-h-[380px] overflow-auto rounded-xl border border-border bg-background/40 p-4 font-mono-accent text-xs leading-relaxed whitespace-pre select-text md:min-h-[440px]">
              {conversion.output}
            </pre>
          ) : (
            <EmptyPane
              className="min-h-[380px] md:min-h-[440px]"
              icon={<FileCode2 className="h-8 w-8" />}
              hint={
                conversion.error !== null
                  ? "上面那段还有问题，改好这里就会出现结果。"
                  : "左边粘 JSON 或 XML，按照上面的规则转出来的结果会显示在这里。"
              }
              action={
                <Button type="button" variant="outline" size="sm" onClick={() => setInput(JSON_XML_SAMPLE)}>
                  <Sparkles className="h-3.5 w-3.5" /> 填入示例看看
                </Button>
              }
            />
          )}
          {conversion.warnings.length > 0 && <WarningList warnings={conversion.warnings} />}
        </div>
      </div>
    </div>
  );
}

/** 表格预览：这是「结果像成品」的关键 —— 数据就该长成表格的样子。 */
function DataTable({
  rows,
  hasHeader,
  maxRows,
  numericColumns,
  className,
}: {
  rows: string[][];
  hasHeader: boolean;
  maxRows?: number;
  numericColumns?: boolean[];
  className?: string;
}) {
  const columns = rows.reduce((max, row) => Math.max(max, row.length), 0);
  if (rows.length === 0 || columns === 0) return null;

  const header = hasHeader ? rows[0] : null;
  const body = hasHeader ? rows.slice(1) : rows;
  const shown = maxRows !== undefined ? body.slice(0, maxRows) : body;

  return (
    <div className={cn("thin-scroll max-h-[520px] overflow-auto rounded-xl border border-border/70", className)}>
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr>
            {Array.from({ length: columns }).map((_cell, index) => (
              <th
                key={index}
                className="sticky top-0 z-10 border-b border-border/70 bg-muted/80 px-3 py-2 text-left font-semibold whitespace-nowrap text-foreground backdrop-blur"
              >
                {header !== null ? header[index] ?? "" : `第 ${index + 1} 列`}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {shown.map((row, rowIndex) => (
            <tr key={rowIndex} className="even:bg-muted/20 hover:bg-muted/30">
              {Array.from({ length: columns }).map((_cell, index) => {
                const value = row[index] ?? "";
                const right = numericColumns !== undefined && numericColumns[index] === true;
                return (
                  <td
                    key={index}
                    className={cn(
                      "border-b border-border/40 px-3 py-1.5 align-top",
                      right ? "text-right font-mono-accent tabular-nums" : "text-left",
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

/** 选项卡切换（表格预览 / 文本输出这种「同一个结果两种看法」用它）。 */
function ViewTabs<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string; icon: ReactNode }>;
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

/* ==========================================================================================
 * 工具 3：JSON ↔ CSV
 * 布局模式 A（转换对照）+ 输出区可以切成真表格预览 —— CSV 对不对，看一眼表格最直观。
 * ========================================================================================== */

type JsonCsvDirection = "auto" | "json2csv" | "csv2json";
type DelimiterChoice = "auto" | "," | "\t" | ";" | "|";
type JsonCsvView = "table" | "text";

export function JsonCsvTool() {
  const [input, setInput] = useToolDraft<string>("json-csv", "input", "");
  const [direction, setDirection] = useToolDraft<JsonCsvDirection>("json-csv", "direction", "auto");
  const [delimiterChoice, setDelimiterChoice] = useToolDraft<DelimiterChoice>("json-csv", "delimiter", "auto");
  const [hasHeader, setHasHeader] = useToolDraft<boolean>("json-csv", "hasHeader", true);
  const [view, setView] = useToolDraft<JsonCsvView>("json-csv", "view", "table");

  const detected = useMemo(() => detectJsonOrCsv(input), [input]);
  const effective: "json2csv" | "csv2json" | null =
    direction === "auto"
      ? detected === "json"
        ? "json2csv"
        : detected === "csv"
          ? "csv2json"
          : null
      : direction;

  // CSV → JSON 时才需要「猜」分隔符；JSON → CSV 是输出方向，自动就是标准逗号
  const delimiter =
    delimiterChoice !== "auto" ? delimiterChoice : effective === "csv2json" ? detectDelimiter(input) : ",";
  const delimiterIsAuto = delimiterChoice === "auto";

  const fromLabel =
    detected === "empty" ? "等待输入" : detected === "json" ? "检测到：JSON" : "检测到：CSV";
  const toLabel =
    effective === null ? "先粘点内容进来" : effective === "json2csv" ? "将转换为 CSV" : "将转换为 JSON";

  const conversion = useMemo(() => {
    const empty = {
      output: "",
      error: null as string | null,
      line: undefined as number | undefined,
      lineText: undefined as string | undefined,
      warnings: [] as string[],
      rows: [] as string[][],
      tableHasHeader: true,
    };
    if (input.trim() === "" || effective === null) return empty;

    if (effective === "json2csv") {
      const parsed = parseJsonText(input);
      if (!parsed.ok) {
        return { ...empty, error: parsed.message, line: parsed.line, lineText: parsed.lineText };
      }
      const rows = jsonToRows(parsed.value);
      if (!rows.ok) return { ...empty, error: rows.message };
      return {
        ...empty,
        output: serializeCsv(rows.value, delimiter),
        warnings: rows.warnings,
        rows: rows.value,
        tableHasHeader: true,
      };
    }

    const table = parseCsv(input, delimiter);
    if (table.rows.length === 0) {
      return { ...empty, error: "这段内容里没有解析出任何一行，检查一下是不是粘到了空内容。" };
    }
    const json = csvRowsToJson(table.rows, hasHeader);
    return {
      ...empty,
      output: JSON.stringify(json, null, 2) + "\n",
      warnings: table.warnings,
      rows: table.rows,
      tableHasHeader: hasHeader,
    };
  }, [input, effective, delimiter, hasHeader]);

  const numericFlags = useMemo(
    () => numericColumnFlags(conversion.rows, conversion.tableHasHeader),
    [conversion.rows, conversion.tableHasHeader],
  );

  const dataRowCount = conversion.tableHasHeader
    ? Math.max(0, conversion.rows.length - 1)
    : conversion.rows.length;
  const columnCount = conversion.rows.reduce((max, row) => Math.max(max, row.length), 0);

  const toggleDirection = () => {
    const next: JsonCsvDirection = (effective ?? "json2csv") === "json2csv" ? "csv2json" : "json2csv";
    setDirection(next);
  };

  const loadSample = () => {
    setInput(detected === "csv" ? CSV_TEXT_SAMPLE : JSON_CSV_SAMPLE);
  };

  return (
    <div className="space-y-4">
      <DirectionBar
        fromLabel={fromLabel}
        toLabel={toLabel}
        manual={direction !== "auto"}
        onToggle={toggleDirection}
        onAuto={() => setDirection("auto")}
      />

      {conversion.error !== null && (
        <ErrorNote message={conversion.error} line={conversion.line} lineText={conversion.lineText} />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        {/* 输入 */}
        <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Label>输入</Label>
              <MetaText>
                {countLines(input)} 行 · {input.length} 字符
              </MetaText>
            </div>
            <div className="flex items-center gap-1">
              <Button type="button" variant="ghost" size="sm" onClick={loadSample} className="h-7 px-2 text-xs">
                <Wand2 className="h-3.5 w-3.5" /> 填入示例
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setInput("")}
                className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" /> 清空
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <Label htmlFor="json-csv-delimiter">分隔符</Label>
              <Select
                id="json-csv-delimiter"
                value={delimiterChoice}
                onChange={(event) => setDelimiterChoice(event.target.value as DelimiterChoice)}
                className="w-[130px]"
              >
                <option value="auto">自动识别</option>
                <option value=",">逗号 ,</option>
                <option value={"\t"}>制表符 Tab</option>
                <option value=";">分号 ;</option>
                <option value="|">竖线 |</option>
              </Select>
            </div>
            {effective === "csv2json" && (
              <div className="flex items-center gap-1 rounded-lg border border-border/50 bg-background/50 p-1 text-xs">
                <button
                  type="button"
                  onClick={() => setHasHeader(true)}
                  className={cn(
                    "rounded-md px-2.5 py-1 font-medium transition-colors",
                    hasHeader ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  首行是表头
                </button>
                <button
                  type="button"
                  onClick={() => setHasHeader(false)}
                  className={cn(
                    "rounded-md px-2.5 py-1 font-medium transition-colors",
                    !hasHeader ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  首行是数据
                </button>
              </div>
            )}
            {delimiterIsAuto && input.trim() !== "" && (
              <MetaText>
                {effective === "csv2json" ? `自动认成：${delimiterLabel(delimiter)}` : "输出分隔符：逗号（标准 CSV）"}
              </MetaText>
            )}
          </div>

          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder={'[\n  { "姓名": "芙宁娜", "等级": 90 }\n]\n\n…或者粘 CSV：\n姓名,等级\n芙宁娜,90'}
            spellCheck={false}
            wrap="off"
            className="thin-scroll min-h-[360px] resize-y whitespace-pre font-mono-accent text-xs leading-relaxed md:min-h-[420px]"
          />

          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={detected === "empty" ? "secondary" : "default"}>
              {detected === "empty" ? "等待输入" : detected === "json" ? "检测到：JSON" : "检测到：CSV"}
            </Badge>
            <span className="text-[11px] leading-relaxed text-muted-foreground">
              {detected === "empty"
                ? "JSON 数组对象会转成带表头的 CSV；CSV 会转成对象数组。"
                : detected === "json"
                  ? "看起来是 JSON，会转成 CSV。每一项取所有出现过的键当表头，缺的字段留空。"
                  : "看起来是 CSV，会转成 JSON。字段一律按字符串处理，想变成数字请在 JSON 里改。"}
            </span>
          </div>
        </div>

        {/* 输出 */}
        <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <Label>输出</Label>
              <Badge variant="secondary">{effective === "csv2json" ? "JSON" : "CSV"}</Badge>
              <MetaText>
                {countLines(conversion.output)} 行 · {byteLength(conversion.output)} 字节
              </MetaText>
              {columnCount > 0 && (
                <MetaText>
                  · 共 {dataRowCount} 行 {columnCount} 列
                </MetaText>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ViewTabs
                value={view}
                onChange={setView}
                options={[
                  { value: "table", label: "表格预览", icon: <Table2 className="h-3.5 w-3.5" /> },
                  { value: "text", label: "文本", icon: <Eye className="h-3.5 w-3.5" /> },
                ]}
              />
              <CopyButton text={conversion.output} label="复制" className="h-7 px-2 text-xs" />
            </div>
          </div>

          {conversion.output === "" ? (
            <EmptyPane
              className="min-h-[360px] md:min-h-[420px]"
              icon={<Table2 className="h-8 w-8" />}
              hint={
                conversion.error !== null
                  ? "上面那段还有问题，改好这里就会出现结果。"
                  : "左边粘 JSON 或 CSV，这里会同时给你表格和数据文本。"
              }
              action={
                <Button type="button" variant="outline" size="sm" onClick={loadSample}>
                  <Sparkles className="h-3.5 w-3.5" /> 填入示例看看
                </Button>
              }
            />
          ) : view === "table" ? (
            <div className="space-y-2">
              <DataTable
                rows={conversion.rows}
                hasHeader={conversion.tableHasHeader}
                numericColumns={numericFlags}
                maxRows={20}
              />
              <p className="text-[11px] text-muted-foreground">
                表格画的是前 20 行（数据多的时候不至于卡），完整结果看「文本」那一栏，或者直接复制。数字列会自动右对齐。
              </p>
            </div>
          ) : (
            <pre className="thin-scroll max-h-[560px] min-h-[360px] overflow-auto rounded-xl border border-border bg-background/40 p-4 font-mono-accent text-xs leading-relaxed whitespace-pre select-text md:min-h-[420px]">
              {conversion.output}
            </pre>
          )}

          {conversion.warnings.length > 0 && <WarningList warnings={conversion.warnings} />}
        </div>
      </div>
    </div>
  );
}

