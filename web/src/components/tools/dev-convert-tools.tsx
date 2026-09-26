"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage, uiCount as __count } from "@/lib/language";
const __ui = __createUiText("components/tools/dev-convert-tools.tsx");


/**
 * 开发者实用工具的自带界面：cURL 转代码、正则速查表、HTML 转 Markdown。
 *
 * 布局选择（依据《新工具UI规范》第二部分）：
 *   · cURL 转代码 —— **模式 A（转换对照）**：左边贴 curl 命令，右边是生成出来的代码。
 *     这是最典型的"输入与输出同等重要、需要互相对照"的转换，A 模式就是为它这种任务准备的。
 *     上方还有一条解析摘要（方法 / 地址 / 请求头 / 请求体），让用户能核对"我这条命令被读对了吗"。
 *   · 正则速查表 —— **目录 + 内容 + 试一下（组合布局）**：左侧是可搜索的分类目录，
 *     右侧是条目（点一下就能复制，或一键送进下面的测试框）。速查表的核心是"找得快、拿得走"，
 *     所以不做花哨排版，条目就是短表格；底部再给一个小测试框，看到就想试的冲动不用忍着。
 *   · HTML 转 Markdown —— **模式 A**：左边 HTML，右边 Markdown 成品，并排对照。
 */

import { useEffect, useCallback, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  BookMarked,
  Check,
  Code2,
  Copy,
  Download,
  Eraser,
  FileCode2,
  Loader2,
  Play,
  Search,
  Sparkles,
  Terminal,
  Wand2,
} from "lucide-react";
import { Badge, Button, Input, Label, Textarea } from "@/components/ui/primitives";
import { CopyButton } from "./copy-button";
import { useToolDraft } from "@/lib/use-tool-draft";
import { cn } from "@/lib/utils";

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

function EmptyPane({ icon, title, hint }: { icon: React.ReactNode; title: string; hint: string }) {
  const __locale = __useLanguage();
  return (
    <div className="flex flex-col items-center justify-center gap-2.5 py-16 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">{icon}</span>
      <p className="text-sm font-medium text-foreground">{__ui(title)}</p>
      <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">{__ui(hint)}</p>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 工具一：cURL 转代码
// ══════════════════════════════════════════════════════════════════════

interface ParsedCurl {
  method: string;
  explicitMethod: boolean;
  url: string;
  headers: Array<{ name: string; value: string }>;
  /** Distinguish -d '' from a request without a body. */
  hasData: boolean;
  data: string;
  forms: Array<{ name: string; value: string; isFile: boolean }>;
  auth?: { user: string; pass: string };
  insecure: boolean;
  compressed: boolean;
  followRedirects: boolean;
}

/** Parse a literal POSIX/Bash-style curl command, never execute shell expressions. */
function parseCurl(input: string): ParsedCurl {
  const text = input.trim();
  if (text.includes("\0")) throw new Error("curl 命令不能包含 NUL 字符");
  const tokens: string[] = [];
  let cur = "";
  let started = false;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote === "'") {
      if (ch === "'") quote = null;
      else cur += ch;
      continue;
    }
    if (ch === "\\") {
      if (i + 1 >= text.length) throw new Error("curl 命令末尾存在未完成的反斜杠转义");
      const next = text[i + 1];
      // A continuation removes both bytes; inside single quotes it is literal.
      if (next === "\n" || (next === "\r" && text[i + 2] === "\n")) {
        i += next === "\r" ? 2 : 1;
      } else if (!quote || /[\\"$`]/.test(next)) {
        cur += next;
        started = true;
        i++;
      } else {
        // In double quotes, Bash preserves backslashes before ordinary letters.
        cur += ch;
      }
      continue;
    }
    if (ch === "`" || (ch === "$" && /[A-Za-z0-9_{('"?@*#$!\-]/.test(text[i + 1] || "")))
      throw new Error("暂不支持变量、命令替换或 ANSI-C 引号；请粘贴字面值，并用单引号保护其中的 $ 和反引号");
    if (quote === '"') {
      if (ch === '"') quote = null;
      else cur += ch;
      continue;
    }
    if (ch === "'" || ch === '"') {
      quote = ch;
      started = true;
    } else if (/\s/.test(ch)) {
      if ((ch === "\n" || ch === "\r") && text.slice(i).trim()) throw new Error("只支持一条 shell 命令；跨行参数请使用反斜杠续行");
      if (started) tokens.push(cur);
      cur = "";
      started = false;
    } else if (/[;|&<>]/.test(ch)) {
      throw new Error("只支持单条 curl 命令，不支持管道、重定向或 shell 控制符；URL 中的 & 请放在引号内");
    } else if (ch === "~" && !started) {
      throw new Error("暂不支持 shell 波浪号路径展开，请提供字面值");
    } else if (ch === "#" && !started) {
      throw new Error("暂不支持 shell 注释，请移除注释后转换");
    } else {
      cur += ch;
      started = true;
    }
  }
  if (quote) throw new Error("curl 命令中的引号未闭合");
  if (started) tokens.push(cur);
  if (tokens[0] !== "curl") throw new Error("这不是一条受支持的 curl 命令（应当以 curl 开头，采用 POSIX/Bash 引号）");

  const out: ParsedCurl = {
    method: "", explicitMethod: false, url: "", headers: [], hasData: false,
    data: "", forms: [], insecure: false, compressed: false, followRedirects: false,
  };
  const dataParts: string[] = [];
  let useGet = false;
  let useHead = false;
  let endOptions = false;
  const valueOptions = new Set(["-X", "--request", "-H", "--header", "-d", "--data", "--data-raw", "--data-binary", "--data-urlencode", "-F", "--form", "-u", "--user", "--url", "-A", "--user-agent", "-e", "--referer", "-b", "--cookie"]);
  const flagOptions = new Set(["-k", "--insecure", "--compressed", "-L", "--location", "-I", "--head", "-G", "--get", "-s", "--silent", "-S", "--show-error", "-v", "--verbose", "--no-progress-meter"]);
  const addUrl = (url: string) => {
    if (out.url) throw new Error("暂不支持多个请求地址，请一次转换一条请求");
    if (!/^https?:\/\//i.test(url) || /[\s\x00-\x1f\x7f]/.test(url)) throw new Error("请求地址必须是有效的 http:// 或 https:// URL，不能包含空白或控制字符");
    const suffix = url.replace(/^https?:\/\/[^/?#]*/i, "");
    if (/[{}\[\]]/.test(suffix)) throw new Error("暂不支持 curl 的 URL 范围展开，请使用单个地址并编码字面括号");
    try { new URL(url); } catch { throw new Error("请求地址不是有效的 HTTP URL"); }
    out.url = url;
  };
  const encode = (value: string) => encodeURIComponent(value).replace(/%20/g, "+").replace(/[!'()*]/g, ch => "%" + ch.charCodeAt(0).toString(16).toUpperCase());

  for (let i = 1; i < tokens.length; i++) {
    let option = tokens[i];
    if (!endOptions && option === "--") { endOptions = true; continue; }
    if (endOptions || !option.startsWith("-")) { addUrl(option); continue; }
    if (option.startsWith("--") && option.includes("="))
      throw new Error("当前解析器暂不支持 --选项=值，请用空格分隔长选项和值");
    let attached: string | undefined;
    if (!option.startsWith("--") && option.length > 2) {
      const first = option.slice(0, 2);
      if (valueOptions.has(first)) attached = option.slice(2);
      else if (flagOptions.has(first)) tokens.splice(i + 1, 0, "-" + option.slice(2));
      else throw new Error(`暂不支持 curl 参数：${option}`);
      option = first;
    }
    if (!valueOptions.has(option) && !flagOptions.has(option)) throw new Error(`暂不支持 curl 参数：${option}`);
    let value = "";
    if (valueOptions.has(option)) {
      if (attached !== undefined) value = attached;
      else {
        if (i + 1 >= tokens.length) throw new Error(`curl 参数 ${option} 缺少值`);
        value = tokens[++i];
      }
    }
    if (["-A", "--user-agent", "-e", "--referer", "-b", "--cookie"].includes(option) && /[\r\n]/.test(value)) throw new Error("请求头选项不能包含换行");
    if (option === "-X" || option === "--request") {
      if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(value)) throw new Error("HTTP 请求方法为空或包含非法字符");
      if (value !== value.toUpperCase()) throw new Error("当前生成器只支持大写 HTTP 方法，不会静默改写方法大小写");
      out.method = value;
      out.explicitMethod = true;
    } else if (option === "--url") addUrl(value);
    else if (option === "-H" || option === "--header") {
      if (value.startsWith("@")) throw new Error("暂不支持 -H @文件读取，请直接填写请求头");
      const colon = value.indexOf(":");
      const name = value.slice(0, colon).trim();
      const headerValue = value.slice(colon + 1).trim();
      if (colon <= 0 || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[\r\n]/.test(value)) throw new Error("请求头必须是合法的名称: 值，不能含换行");
      if (!headerValue) throw new Error("暂不支持删除默认请求头或空请求头语法，请使用非空的名称: 值");
      out.headers.push({ name, value: headerValue });
    } else if (["-d", "--data", "--data-raw", "--data-binary", "--data-urlencode"].includes(option)) {
      out.hasData = true;
      if (option === "--data-urlencode") {
        const equal = value.indexOf("=");
        if (equal >= 0) dataParts.push((equal > 0 ? value.slice(0, equal + 1) : "") + encode(value.slice(equal + 1)));
        else if (value.includes("@")) throw new Error("暂不支持 --data-urlencode 的 @文件读取，请提供字面内容");
        else dataParts.push(encode(value));
      } else {
        if (option !== "--data-raw" && value.startsWith("@")) throw new Error("暂不支持 --data/--data-binary 的 @文件或标准输入读取；--data-raw @文本才是字面值");
        dataParts.push(value);
      }
    } else if (option === "-F" || option === "--form") {
      const equal = value.indexOf("=");
      if (equal <= 0) throw new Error("-F 必须采用 名称=值 或 名称=@文件路径");
      const fieldValue = value.slice(equal + 1);
      if (fieldValue.startsWith("<") || /;(?:type|filename|headers)=/u.test(fieldValue) || (fieldValue.startsWith("@") && /[,;]|^@-?$/.test(fieldValue)))
        throw new Error("暂不支持复杂 -F 参数、<file、多个文件或标准输入；请使用普通字段或单个 @文件路径");
      out.forms.push({ name: value.slice(0, equal), value: fieldValue, isFile: fieldValue.startsWith("@") });
    } else if (option === "-u" || option === "--user") {
      const colon = value.indexOf(":");
      if (colon < 0) throw new Error("不支持交互式密码提示，请显式提供 用户名:密码（密码可以为空）");
      out.auth = { user: value.slice(0, colon), pass: value.slice(colon + 1) };
    } else if (option === "-A" || option === "--user-agent") out.headers.push({ name: "User-Agent", value });
    else if (option === "-e" || option === "--referer") {
      if (value.endsWith(";auto")) throw new Error("暂不支持自动 Referer，请提供字面地址");
      out.headers.push({ name: "Referer", value });
    } else if (option === "-b" || option === "--cookie") {
      if (!value.includes("=")) throw new Error("暂不支持 Cookie 文件或 Cookie 引擎，只支持名称=值形式的字面 Cookie");
      out.headers.push({ name: "Cookie", value });
    } else if (option === "-k" || option === "--insecure") out.insecure = true;
    else if (option === "--compressed") out.compressed = true;
    else if (option === "-L" || option === "--location") out.followRedirects = true;
    else if (option === "-I" || option === "--head") useHead = true;
    else if (option === "-G" || option === "--get") useGet = true;
    // Remaining explicitly listed flags affect curl console output only.
  }
  if (!out.url) throw new Error("没找到 HTTP 请求地址");
  if (out.forms.length && (out.hasData || useGet || useHead)) throw new Error("暂不支持 -F 与 --data/-G/-I 混用，请拆分请求");
  if (useHead && out.hasData && !useGet) throw new Error("-I 与请求体不兼容，请移除请求体或 -I");
  if (useHead && out.explicitMethod && out.method !== "HEAD") throw new Error("暂不支持 -I 与非 HEAD 自定义方法混用");
  out.data = dataParts.reduce((body, part) => body ? body + "&" + part : part, "");
  if (useGet) {
    if (out.data) {
      if (/[#\s\x00-\x1f\x7f]/.test(out.data)) throw new Error("-G 查询含有未编码的 #、空白或控制字符，请使用 --data-urlencode 编码");
      const hash = out.url.indexOf("#");
      const base = hash < 0 ? out.url : out.url.slice(0, hash);
      // curl normalizes percent escapes only in the newly appended query.
      const query = out.data.replace(/%[0-9a-fA-F]{2}/g, escape => escape.toLowerCase());
      out.url = base + (base.includes("?") ? "&" : "?") + query + (hash < 0 ? "" : out.url.slice(hash));
    }
    out.data = "";
    out.hasData = false;
  }
  if (!out.explicitMethod) out.method = useHead ? "HEAD" : (out.hasData || out.forms.length ? "POST" : "GET");
  if (out.followRedirects && out.explicitMethod && !["GET", "HEAD"].includes(out.method))
    throw new Error("暂不支持 -L 与自定义非 GET/HEAD 方法组合；各客户端的重定向方法语义不同，请手动处理跳转");
  return out;
}

/** 把请求体按 JSON / 表单分别处理 */
function bodyInfo(p: ParsedCurl) {
  if (p.forms.length) return { kind: "form" as const, value: p.forms };
  if (!p.hasData) return { kind: "none" as const, value: null };
  const trimmed = p.data.trim();
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    return { kind: "json" as const, value: trimmed };
  }
  // a=b&c=d 这种当表单
  if (/^[^=&]+=[^&]*(&[^=&]+=[^&]*)*$/.test(trimmed)) {
    return {
      kind: "querystring" as const,
      value: Array.from(new URLSearchParams(trimmed), ([name, value]) => ({ name, value })),
    };
  }
  return { kind: "text" as const, value: p.data };
}

const LANGS = [
  { id: "python", label: "Python (requests)" },
  { id: "javascript", label: "JavaScript (fetch)" },
  { id: "node", label: "Node.js (axios)" },
  { id: "go", label: "Go" },
  { id: "php", label: "PHP" },
  { id: "java", label: "Java (11+)" },
  { id: "csharp", label: "C# (.NET 6+)" },
  { id: "powershell", label: "PowerShell (7+)" },
  { id: "rust", label: "Rust (reqwest)" },
] as const;

function pyStr(s: string) {
  return JSON.stringify(s); // Python accepts JSON's quoted-string escapes, including newlines.
}
function jsStr(s: string) {
  return JSON.stringify(s);
}

function generate(p: ParsedCurl, lang: string): string {
  const b = bodyInfo(p);

  switch (lang) {
    case "python": {
      const headers = p.headers.filter(h => !(b.kind === "form" && h.name.toLowerCase() === "content-type"));
      if (p.hasData && !headers.some(h => h.name.toLowerCase() === "content-type"))
        headers.push({ name: "Content-Type", value: "application/x-www-form-urlencoded" });
      const kw: string[] = [];
      if (headers.length) kw.push("    headers={\n" + headers.map(h => `        ${pyStr(h.name)}: ${pyStr(h.value)},`).join("\n") + "\n    },");
      if (p.auth) kw.push(`    auth=(${pyStr(p.auth.user)}, ${pyStr(p.auth.pass)}),`);
      if (b.kind === "form") {
        kw.push("    files=[\n" + p.forms.map(f => {
          if (f.isFile && /;|^@-$/u.test(f.value)) throw new Error("Python 转换暂不支持文件的 ;type/filename 参数或标准输入，请改用普通文件路径");
          const value = f.isFile ? `stack.enter_context(open(${pyStr(f.value.slice(1))}, "rb"))` : `(None, ${pyStr(f.value)})`;
          return `        (${pyStr(f.name)}, ${value}),`;
        }).join("\n") + "\n    ],");
      } else if (b.kind !== "none") {
        // Send original UTF-8 bytes: true/null stay valid JSON and repeated form fields survive.
        kw.push(`    data=${pyStr(p.data)}.encode("utf-8"),`);
      }
      if (p.insecure) kw.push("    verify=False,");
      kw.push(`    allow_redirects=${p.followRedirects ? "True" : "False"},`);
      kw.push("    timeout=30,");
      const call = `response = requests.request(\n    ${pyStr(p.method)}, ${pyStr(p.url)},\n${kw.join("\n")}\n)`;
      return "import requests\nfrom contextlib import ExitStack\n\nwith ExitStack() as stack:\n" +
        call.split("\n").map(line => "    " + line).join("\n") +
        "\n\nprint(response.status_code)\nprint(response.text)";
    }
    case "javascript": {
      if (p.insecure) throw new Error("浏览器 fetch 不支持跳过 TLS 证书校验，请移除 -k 或选择 Node.js");
      if (p.forms.some(f => f.isFile)) throw new Error("浏览器不能按本地路径读取 -F 文件；请使用文件选择器提供 File，或选择 Node.js 输出");
      if ((p.hasData || p.forms.length) && /^(GET|HEAD)$/.test(p.method)) throw new Error("浏览器 fetch 不支持 GET/HEAD 请求体，请选择其他输出语言");
      const headers = p.headers.filter(h => !(b.kind === "form" && h.name.toLowerCase() === "content-type"));
      if (p.hasData && !headers.some(h => h.name.toLowerCase() === "content-type"))
        headers.push({ name: "Content-Type", value: "application/x-www-form-urlencoded" });
      const hs = headers.map(h => `    ${jsStr(h.name)}: ${jsStr(h.value)},`);
      if (p.auth) hs.push(`    "Authorization": "Basic " + btoa(Array.from(new TextEncoder().encode(${jsStr(p.auth.user + ":" + p.auth.pass)}), byte => String.fromCharCode(byte)).join("")),`);
      const opts = [`  method: ${jsStr(p.method)},`, `  redirect: ${jsStr(p.followRedirects ? "follow" : "manual")},`, "  signal: AbortSignal.timeout(30000),"];
      if (hs.length) opts.push(`  headers: {\n${hs.join("\n")}\n  },`);
      let setup = "// 浏览器受 CORS 和禁用请求头规则限制；跨域手动重定向可能返回 opaque 响应。\n";
      if (b.kind === "form") {
        setup += "const form = new FormData();\n" + p.forms.map(f => `form.append(${jsStr(f.name)}, ${jsStr(f.value)});`).join("\n") + "\n";
        opts.push("  body: form,");
      } else if (b.kind !== "none") opts.push(`  body: ${jsStr(p.data)},`);
      return setup + `const response = await fetch(${jsStr(p.url)}, {\n${opts.join("\n")}\n});\n\nconst text = await response.text();\nconsole.log(response.status, text);`;
    }
    case "node": {
      const headers = p.headers.filter(h => !(b.kind === "form" && h.name.toLowerCase() === "content-type"));
      if (p.hasData && !headers.some(h => h.name.toLowerCase() === "content-type"))
        headers.push({ name: "Content-Type", value: "application/x-www-form-urlencoded" });
      const hs = headers.map(h => `    ${jsStr(h.name)}: ${jsStr(h.value)},`);
      if (p.auth) hs.push(`    "Authorization": "Basic " + Buffer.from(${jsStr(p.auth.user + ":" + p.auth.pass)}, "utf8").toString("base64"),`);
      let setup = '// Node.js 20+; dependency: axios. Multipart files are buffered in memory.\nimport axios from "axios";\n';
      if (p.insecure) setup += 'import https from "node:https";\n';
      if (p.forms.some(f => f.isFile)) setup += 'import { readFile } from "node:fs/promises";\n';
      if (b.kind === "form") {
        setup += "\nconst form = new FormData();\n";
        for (const f of p.forms) {
          if (f.isFile) {
            if (/;|^@-$/u.test(f.value)) throw new Error("Node.js 转换暂不支持文件的 ;type/filename 参数或标准输入，请改用普通文件路径");
            const filePath = f.value.slice(1);
            const fileName = filePath.split(/[\\/]/).pop() || "upload.bin";
            setup += `form.append(${jsStr(f.name)}, new Blob([await readFile(${jsStr(filePath)})], { type: "application/octet-stream" }), ${jsStr(fileName)});\n`;
          } else setup += `form.append(${jsStr(f.name)}, ${jsStr(f.value)});\n`;
        }
      }
      const cfg = [`  method: ${jsStr(p.method)},`, `  url: ${jsStr(p.url)},`, `  maxRedirects: ${p.followRedirects ? 20 : 0},`, "  timeout: 30000,", "  validateStatus: () => true,"];
      if (p.insecure) cfg.push("  // 警告：仅在明确需要 -k 时关闭证书校验。", "  httpsAgent: new https.Agent({ rejectUnauthorized: false }),");
      if (hs.length) cfg.push(`  headers: {\n${hs.join("\n")}\n  },`);
      if (b.kind === "form") cfg.push("  data: form,");
      else if (b.kind !== "none") cfg.push(`  data: Buffer.from(${jsStr(p.data)}, "utf8"),`);
      return setup + `\nconst response = await axios({\n${cfg.join("\n")}\n});\n\nconsole.log(response.status, response.data);`;
    }
    case "go": {
      const imports = ["net/http", "io", "fmt", "time"];
      const headers = p.headers.filter(h => !(b.kind === "form" && h.name.toLowerCase() === "content-type"));
      if (p.hasData && !headers.some(h => h.name.toLowerCase() === "content-type"))
        headers.push({ name: "Content-Type", value: "application/x-www-form-urlencoded" });
      let setup = "\tvar requestBody io.Reader\n";
      if (b.kind === "form") {
        imports.push("bytes", "mime/multipart");
        if (p.forms.some(f => f.isFile)) imports.push("os");
        setup += "\t// Multipart is buffered in memory; use streaming for very large uploads.\n\tvar payload bytes.Buffer\n\twriter := multipart.NewWriter(&payload)\n";
        for (const f of p.forms) {
          if ((f.isFile && /;|^@-$/u.test(f.value)) || (!f.isFile && (f.value.startsWith("<") || /;(?:type|filename|headers)=/u.test(f.value))))
            throw new Error("Go 转换暂不支持 -F 的文件参数、<file 或标准输入，请使用普通字段或 @文件路径");
          if (f.isFile) {
            const filePath = f.value.slice(1);
            const fileName = filePath.split(/[\\/]/).pop() || "upload.bin";
            setup += `\t{\n\t\tpart, err := writer.CreateFormFile(${jsStr(f.name)}, ${jsStr(fileName)})\n\t\tif err != nil { panic(err) }\n` +
              `\t\tfile, err := os.Open(${jsStr(filePath)})\n\t\tif err != nil { panic(err) }\n` +
              "\t\t_, copyErr := io.Copy(part, file)\n\t\tcloseErr := file.Close()\n\t\tif copyErr != nil { panic(copyErr) }\n\t\tif closeErr != nil { panic(closeErr) }\n\t}\n";
          } else {
            setup += `\tif err := writer.WriteField(${jsStr(f.name)}, ${jsStr(f.value)}); err != nil { panic(err) }\n`;
          }
        }
        setup += "\tif err := writer.Close(); err != nil { panic(err) }\n\trequestBody = &payload\n";
      } else if (b.kind !== "none") {
        imports.push("strings");
        setup += `\trequestBody = strings.NewReader(${jsStr(p.data)})\n`;
      }
      let clientSetup = "\tclient := &http.Client{Timeout: 30 * time.Second}\n";
      clientSetup += p.followRedirects
        ? '\tclient.CheckRedirect = func(req *http.Request, via []*http.Request) error {\n\t\tif len(via) >= 20 { return fmt.Errorf("stopped after 20 redirects") }\n\t\treturn nil\n\t}\n'
        : "\tclient.CheckRedirect = func(req *http.Request, via []*http.Request) error { return http.ErrUseLastResponse }\n";
      if (p.insecure) {
        imports.push("crypto/tls");
        clientSetup += "\t// Explicit curl -k only: disables certificate verification.\n\ttransport := http.DefaultTransport.(*http.Transport).Clone()\n\ttransport.TLSClientConfig = &tls.Config{InsecureSkipVerify: true}\n\tclient.Transport = transport\n";
      }
      return "package main\n\nimport (\n" + imports.map(name => `\t${jsStr(name)}`).join("\n") + "\n)\n\nfunc main() {\n" + setup +
        `\treq, err := http.NewRequest(${jsStr(p.method)}, ${jsStr(p.url)}, requestBody)\n\tif err != nil { panic(err) }\n` +
        headers.map(h => h.name.toLowerCase() === "host"
          ? `\treq.Host = ${jsStr(h.value)}\n`
          : `\treq.Header.Add(${jsStr(h.name)}, ${jsStr(h.value)})\n`).join("") +
        (b.kind === "form" ? '\treq.Header.Set("Content-Type", writer.FormDataContentType())\n' : "") +
        (p.auth ? `\treq.SetBasicAuth(${jsStr(p.auth.user)}, ${jsStr(p.auth.pass)})\n` : "") + clientSetup +
        "\tresp, err := client.Do(req)\n\tif err != nil { panic(err) }\n\tdefer resp.Body.Close()\n\tbody, err := io.ReadAll(resp.Body)\n\tif err != nil { panic(err) }\n\tfmt.Println(resp.Status)\n\tfmt.Println(string(body))\n}";
    }
    case "php": {
      // PHP double quotes interpolate $variables and do not understand JSON's \u escapes.
      const phpStr = (s: string) => "'" + s.replace(/\\/g, "\\\\").replace(/'/g, "\\'") + "'";
      const headers = p.headers.filter(h => !(b.kind === "form" && h.name.toLowerCase() === "content-type"));
      if (p.hasData && !headers.some(h => h.name.toLowerCase() === "content-type"))
        headers.push({ name: "Content-Type", value: "application/x-www-form-urlencoded" });
      let setup = "";
      if (b.kind === "form") {
        setup = '// Buffer multipart explicitly to preserve repeated fields; not intended for very large uploads.\n$boundary = "FurinaKit-" . bin2hex(random_bytes(16));\n$payload = "";\n';
        const quoted = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "%0D").replace(/\n/g, "%0A");
        for (const f of p.forms) {
          if ((f.isFile && /;|^@-$/u.test(f.value)) || (!f.isFile && (f.value.startsWith("<") || /;(?:type|filename|headers)=/u.test(f.value))))
            throw new Error("PHP 转换暂不支持 -F 的文件参数、<file 或标准输入，请使用普通字段或 @文件路径");
          const filePath = f.value.slice(1);
          const fileName = filePath.split(/[\\/]/).pop() || "upload.bin";
          const disposition = `Content-Disposition: form-data; name="${quoted(f.name)}"` + (f.isFile ? `; filename="${quoted(fileName)}"` : "");
          const partHeader = "\r\n" + disposition + (f.isFile ? "\r\nContent-Type: application/octet-stream" : "") + "\r\n\r\n";
          setup += `$payload .= "--" . $boundary . ${phpStr(partHeader)};\n`;
          if (f.isFile) {
            setup += `$bytes = file_get_contents(${phpStr(filePath)});\nif ($bytes === false) { throw new RuntimeException("Could not read multipart file"); }\n$payload .= $bytes;\n`;
          } else setup += `$payload .= ${phpStr(f.value)};\n`;
          setup += '$payload .= "\\r\\n";\n';
        }
        setup += '$payload .= "--" . $boundary . "--\\r\\n";\n';
      } else if (b.kind !== "none") setup = `$payload = ${phpStr(p.data)};\n`;
      const hs = headers.map(h => `        ${phpStr(`${h.name}: ${h.value}`)},`);
      if (b.kind === "form") hs.push('        "Content-Type: multipart/form-data; boundary=" . $boundary,');
      const options = [
        `    CURLOPT_URL => ${phpStr(p.url)},`,
        "    CURLOPT_RETURNTRANSFER => true,",
        `    CURLOPT_FOLLOWLOCATION => ${p.followRedirects ? "true" : "false"},`,
        "    CURLOPT_MAXREDIRS => 20,",
        "    CURLOPT_TIMEOUT => 30,",
      ];
      if (hs.length) options.push(`    CURLOPT_HTTPHEADER => [\n${hs.join("\n")}\n    ],`);
      if (p.auth) options.push(`    CURLOPT_USERPWD => ${phpStr(p.auth.user + ":" + p.auth.pass)},`);
      if (p.insecure) options.push("    // Explicit curl -k only: disables certificate verification.", "    CURLOPT_SSL_VERIFYPEER => false,", "    CURLOPT_SSL_VERIFYHOST => 0,");
      if (p.compressed) options.push('    CURLOPT_ENCODING => "",');
      if (b.kind !== "none") options.push("    CURLOPT_POSTFIELDS => $payload,");
      if (p.method === "HEAD") options.push("    CURLOPT_NOBODY => true,");
      if (p.explicitMethod) options.push(`    CURLOPT_CUSTOMREQUEST => ${phpStr(p.method)},`);
      return '<?php\n// Requires PHP 7+ and ext-curl.\n' + setup +
        '$ch = curl_init();\nif ($ch === false) { throw new RuntimeException("curl_init failed"); }\ntry {\n' +
        `    if (!curl_setopt_array($ch, [\n${options.join("\n")}\n    ])) { throw new RuntimeException("curl_setopt_array failed"); }\n` +
        '    $response = curl_exec($ch);\n    if ($response === false) { throw new RuntimeException(curl_error($ch)); }\n' +
        '    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);\n    echo $status . "\\n" . $response;\n} finally {\n    curl_close($ch);\n}';
    }
    case "java": {
      if (p.insecure) throw new Error("Java 输出暂不支持 -k；不会静默忽略证书校验选项，请选择其他语言或移除该选项");
      if (p.compressed) throw new Error("Java 输出暂不支持 --compressed 自动解压，请选择其他语言或移除该选项");
      // Keep --data bytes intact; multipart fields/files must not become "[object Object]".
      let setup = `        String body = ${JSON.stringify(p.data)};\n`;
      let publisher = b.kind === "none" ? "HttpRequest.BodyPublishers.noBody()" : "HttpRequest.BodyPublishers.ofString(body)";
      let contentType = p.hasData && !p.headers.some(h => h.name.toLowerCase() === "content-type")
        ? '            .header("Content-Type", "application/x-www-form-urlencoded")\n' : "";
      if (b.kind === "form") {
        setup = `        String boundary = "FurinaKit-" + java.util.UUID.randomUUID();\n` +
          `        // This compact example buffers the multipart body; use streaming for very large uploads.\n` +
          `        var multipart = new java.io.ByteArrayOutputStream();\n`;
        const quoted = (text: string) => text.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r/g, "%0D").replace(/\n/g, "%0A");
        for (const field of p.forms) {
          if (field.isFile && /;|^@-$/u.test(field.value)) throw new Error("Java 转换暂不支持文件的 ;type/filename 参数或标准输入，请改用普通文件路径");
          const filePath = field.value.slice(1);
          const fileName = filePath.split(/[\\/]/).pop() || "upload.bin";
          const disposition = `Content-Disposition: form-data; name="${quoted(field.name)}"` +
            (field.isFile ? `; filename="${quoted(fileName)}"` : "");
          const header = "\r\n" + disposition + (field.isFile ? "\r\nContent-Type: application/octet-stream" : "") + "\r\n\r\n";
          setup += `        multipart.write(("--" + boundary + ${JSON.stringify(header)}).getBytes(java.nio.charset.StandardCharsets.UTF_8));\n`;
          setup += field.isFile
            ? `        java.nio.file.Files.copy(java.nio.file.Path.of(${JSON.stringify(filePath)}), multipart);\n`
            : `        multipart.write(${JSON.stringify(field.value)}.getBytes(java.nio.charset.StandardCharsets.UTF_8));\n`;
          setup += `        multipart.write("\\r\\n".getBytes(java.nio.charset.StandardCharsets.UTF_8));\n`;
        }
        setup += `        multipart.write(("--" + boundary + "--\\r\\n").getBytes(java.nio.charset.StandardCharsets.UTF_8));\n`;
        publisher = "HttpRequest.BodyPublishers.ofByteArray(multipart.toByteArray())";
        contentType = `            .header("Content-Type", "multipart/form-data; boundary=" + boundary)\n`;
      }
      const clientSetup = `        HttpClient client = HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).connectTimeout(Duration.ofSeconds(30)).build();\n`;
      const send = p.followRedirects
        ? clientSetup + `        HttpRequest current = builder.build();\n        HttpResponse<String> response;\n` +
          `        for (int hops = 0; ; hops++) {\n` +
          `            response = client.send(current, HttpResponse.BodyHandlers.ofString());\n` +
          `            int status = response.statusCode();\n` +
          `            String location = response.headers().firstValue("location").orElse(null);\n` +
          `            if (location == null || !(status == 301 || status == 302 || status == 303 || status == 307 || status == 308)) break;\n` +
          `            if (hops >= 20) throw new java.io.IOException("Stopped after 20 redirects");\n` +
          `            URI nextUri = current.uri().resolve(location);\n` +
          `            if (nextUri.getHost() == null || !("http".equalsIgnoreCase(nextUri.getScheme()) || "https".equalsIgnoreCase(nextUri.getScheme()))) throw new java.io.IOException("Redirect must use HTTP(S)");\n` +
          `            boolean toGet = (status == 303 && !current.method().equals("HEAD")) || ((status == 301 || status == 302) && current.method().equals("POST"));\n` +
          `            URI previous = current.uri();\n` +
          `            int previousPort = previous.getPort() < 0 ? ("https".equalsIgnoreCase(previous.getScheme()) ? 443 : 80) : previous.getPort();\n` +
          `            int nextPort = nextUri.getPort() < 0 ? ("https".equalsIgnoreCase(nextUri.getScheme()) ? 443 : 80) : nextUri.getPort();\n` +
          `            boolean sameOrigin = previous.getScheme().equalsIgnoreCase(nextUri.getScheme()) && previous.getHost().equalsIgnoreCase(nextUri.getHost()) && previousPort == nextPort;\n` +
          `            HttpRequest.Builder redirected = HttpRequest.newBuilder(nextUri).timeout(Duration.ofSeconds(30));\n` +
          `            for (var entry : current.headers().map().entrySet()) {\n` +
          `                String name = entry.getKey();\n` +
          `                if (!sameOrigin && (name.equalsIgnoreCase("Authorization") || name.equalsIgnoreCase("Proxy-Authorization") || name.equalsIgnoreCase("Cookie"))) continue;\n` +
          `                if (toGet && (name.equalsIgnoreCase("Content-Length") || name.equalsIgnoreCase("Transfer-Encoding")${p.headers.some(h => h.name.toLowerCase() === "content-type") ? "" : ' || name.equalsIgnoreCase("Content-Type")'})) continue;\n` +
          `                for (String value : entry.getValue()) redirected.header(name, value);\n` +
          `            }\n` +
          `            current = redirected.method(toGet ? "GET" : current.method(), toGet ? HttpRequest.BodyPublishers.noBody() : current.bodyPublisher().orElse(HttpRequest.BodyPublishers.noBody())).build();\n` +
          `        }\n`
        : clientSetup + `        HttpResponse<String> response = client.send(builder.build(), HttpResponse.BodyHandlers.ofString());\n`;
      return (
        `import java.net.URI;\nimport java.net.http.*;\nimport java.time.Duration;\n\npublic class Main {\n` +
        `    public static void main(String[] args) throws Exception {\n` + setup + "\n" +
        `        HttpRequest.Builder builder = HttpRequest.newBuilder()\n            .uri(URI.create(${JSON.stringify(p.url)}))\n` +
        `            .timeout(Duration.ofSeconds(30))\n` +
        p.headers.filter(h => !(b.kind === "form" && h.name.toLowerCase() === "content-type"))
          .map((h) => `            .header(${JSON.stringify(h.name)}, ${JSON.stringify(h.value)})\n`).join("") + contentType +
        (p.auth ? `            .header("Authorization", "Basic " + java.util.Base64.getEncoder().encodeToString((${JSON.stringify(`${p.auth.user}:${p.auth.pass}`)}).getBytes(java.nio.charset.StandardCharsets.UTF_8)))\n` : "") +
        `            .method(${JSON.stringify(p.method)}, ${publisher});\n` +
        "\n" + send +
        `        System.out.println(response.statusCode());\n        System.out.println(response.body());\n    }\n}`
      );
    }
    case "csharp": {
      const headers = p.headers.filter(h => !(b.kind === "form" && h.name.toLowerCase() === "content-type"));
      if (p.hasData && !headers.some(h => h.name.toLowerCase() === "content-type"))
        headers.push({ name: "Content-Type", value: "application/x-www-form-urlencoded" });
      const lines = [
        "// .NET 6+; no third-party packages. Multipart files are buffered in memory.",
        "using System;", "using System.IO;", "using System.Net;", "using System.Net.Http;", "using System.Net.Http.Headers;", "using System.Text;", "using System.Threading.Tasks;", "",
        "class Program {", "    static async Task Main() {",
        "        using var handler = new HttpClientHandler {",
        `            AllowAutoRedirect = ${p.followRedirects},`,
        "            MaxAutomaticRedirections = 20,", "            UseCookies = false,",
        `            AutomaticDecompression = ${p.compressed ? "DecompressionMethods.GZip | DecompressionMethods.Deflate | DecompressionMethods.Brotli" : "DecompressionMethods.None"}`,
        "        };",
      ];
      if (p.insecure) lines.push("        // Explicit curl -k only; never disables validation globally.", "        handler.ServerCertificateCustomValidationCallback = HttpClientHandler.DangerousAcceptAnyServerCertificateValidator;");
      lines.push("        using var client = new HttpClient(handler) { Timeout = TimeSpan.FromSeconds(30) };", `        using var request = new HttpRequestMessage(new HttpMethod(${jsStr(p.method)}), ${jsStr(p.url)});`);
      if (b.kind === "form") {
        lines.push("        var form = new MultipartFormDataContent();", "        request.Content = form;");
        p.forms.forEach((f, i) => {
          if ((f.isFile && /;|^@-$/u.test(f.value)) || (!f.isFile && (f.value.startsWith("<") || /;(?:type|filename|headers)=/u.test(f.value))))
            throw new Error("C# 转换暂不支持 -F 的文件参数、<file 或标准输入，请使用普通字段或 @文件路径");
          if (f.isFile) {
            const filePath = f.value.slice(1);
            const fileName = filePath.split(/[\\/]/).pop() || "upload.bin";
            lines.push(`        var part${i} = new ByteArrayContent(File.ReadAllBytes(${jsStr(filePath)}));`, `        part${i}.Headers.ContentType = new MediaTypeHeaderValue("application/octet-stream");`, `        form.Add(part${i}, ${jsStr(f.name)}, ${jsStr(fileName)});`);
          } else lines.push(`        form.Add(new ByteArrayContent(Encoding.UTF8.GetBytes(${jsStr(f.value)})), ${jsStr(f.name)});`);
        });
      } else if (b.kind !== "none") lines.push(`        request.Content = new ByteArrayContent(Encoding.UTF8.GetBytes(${jsStr(p.data)}));`);
      for (const h of headers) {
        lines.push(`        if (!request.Headers.TryAddWithoutValidation(${jsStr(h.name)}, ${jsStr(h.value)})) {`,
          "            request.Content ??= new ByteArrayContent(Array.Empty<byte>());",
          `            if (!request.Content.Headers.TryAddWithoutValidation(${jsStr(h.name)}, ${jsStr(h.value)})) throw new InvalidOperationException("Unsupported HTTP header");`, "        }");
      }
      if (p.auth) lines.push(`        request.Headers.Authorization = new AuthenticationHeaderValue("Basic", Convert.ToBase64String(Encoding.UTF8.GetBytes(${jsStr(p.auth.user + ":" + p.auth.pass)})));`);
      lines.push("        using var response = await client.SendAsync(request);", "        Console.WriteLine((int)response.StatusCode);", "        Console.WriteLine(await response.Content.ReadAsStringAsync());", "    }", "}");
      return lines.join("\n");
    }
    case "powershell": {
      // PowerShell also treats U+2018..U+201B as single-quote delimiters.
      const psStr = (s: string) => "'" + s.replace(/['\u2018-\u201b]/g, ch => ch + ch) + "'";
      const headers = p.headers.filter(h => !(b.kind === "form" && h.name.toLowerCase() === "content-type"));
      if (p.hasData && !headers.some(h => h.name.toLowerCase() === "content-type"))
        headers.push({ name: "Content-Type", value: "application/x-www-form-urlencoded" });
      const lines = [
        "#Requires -Version 7.0", "# PowerShell 7+, using built-in .NET HttpClient. Multipart files are buffered in memory.",
        "$ErrorActionPreference = 'Stop'", "Add-Type -AssemblyName System.Net.Http",
        "$handler = [System.Net.Http.HttpClientHandler]::new()", "$client = $null", "$request = $null", "$response = $null", "try {",
        `    $handler.AllowAutoRedirect = $${p.followRedirects}`,
        "    $handler.MaxAutomaticRedirections = 20", "    $handler.UseCookies = $false",
        `    $handler.AutomaticDecompression = ${p.compressed ? "[System.Net.DecompressionMethods]::GZip -bor [System.Net.DecompressionMethods]::Deflate -bor [System.Net.DecompressionMethods]::Brotli" : "[System.Net.DecompressionMethods]::None"}`,
      ];
      if (p.insecure) lines.push("    # Explicit curl -k only; no global callback or trust-store change.", "    $handler.ServerCertificateCustomValidationCallback = [System.Net.Http.HttpClientHandler]::DangerousAcceptAnyServerCertificateValidator");
      lines.push("    $client = [System.Net.Http.HttpClient]::new($handler)", "    $client.Timeout = [TimeSpan]::FromSeconds(30)", `    $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::new(${psStr(p.method)}), ${psStr(p.url)})`);
      if (b.kind === "form") {
        lines.push("    $form = [System.Net.Http.MultipartFormDataContent]::new()", "    $request.Content = $form");
        p.forms.forEach((f, i) => {
          if ((f.isFile && /;|^@-$/u.test(f.value)) || (!f.isFile && (f.value.startsWith("<") || /;(?:type|filename|headers)=/u.test(f.value))))
            throw new Error("PowerShell 转换暂不支持 -F 的文件参数、<file 或标准输入，请使用普通字段或 @文件路径");
          if (f.isFile) {
            const filePath = f.value.slice(1);
            const fileName = filePath.split(/[\\/]/).pop() || "upload.bin";
            lines.push(`    $part${i} = [System.Net.Http.ByteArrayContent]::new([System.IO.File]::ReadAllBytes(${psStr(filePath)}))`, `    $part${i}.Headers.ContentType = [System.Net.Http.Headers.MediaTypeHeaderValue]::new('application/octet-stream')`, `    $form.Add($part${i}, ${psStr(f.name)}, ${psStr(fileName)})`);
          } else lines.push(`    $form.Add([System.Net.Http.ByteArrayContent]::new([System.Text.Encoding]::UTF8.GetBytes(${psStr(f.value)})), ${psStr(f.name)})`);
        });
      } else if (b.kind !== "none") lines.push(`    $request.Content = [System.Net.Http.ByteArrayContent]::new([System.Text.Encoding]::UTF8.GetBytes(${psStr(p.data)}))`);
      for (const h of headers) lines.push(
        `    if (-not $request.Headers.TryAddWithoutValidation(${psStr(h.name)}, ${psStr(h.value)})) {`,
        "        if ($null -eq $request.Content) { $request.Content = [System.Net.Http.ByteArrayContent]::new([byte[]]::new(0)) }",
        `        if (-not $request.Content.Headers.TryAddWithoutValidation(${psStr(h.name)}, ${psStr(h.value)})) { throw 'Unsupported HTTP header' }`, "    }");
      if (p.auth) lines.push(`    $request.Headers.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new('Basic', [Convert]::ToBase64String([System.Text.Encoding]::UTF8.GetBytes(${psStr(p.auth.user + ":" + p.auth.pass)})))`);
      lines.push("    $response = $client.SendAsync($request).GetAwaiter().GetResult()", "    [Console]::WriteLine([int]$response.StatusCode)", "    [Console]::WriteLine($response.Content.ReadAsStringAsync().GetAwaiter().GetResult())", "} finally {", "    if ($null -ne $response) { $response.Dispose() }", "    if ($null -ne $request) { $request.Dispose() }", "    if ($null -ne $client) { $client.Dispose() }", "    $handler.Dispose()", "}");
      return lines.join("\n");
    }
    case "rust": {
      // Rust does not accept JSON's \uXXXX, \b or \f string escapes.
      const rustStr = (s: string) => {
        let result = '"';
        for (const ch of s) {
          const code = ch.codePointAt(0)!;
          if (code >= 0xd800 && code <= 0xdfff) throw new Error("Rust 输出不支持未配对的 Unicode 代理项");
          if (ch === '"') result += '\\"';
          else if (ch === "\\") result += "\\\\";
          else if (ch === "\n") result += "\\n";
          else if (ch === "\r") result += "\\r";
          else if (ch === "\t") result += "\\t";
          else if (code < 0x20 || code === 0x7f) result += `\\u{${code.toString(16)}}`;
          else result += ch;
        }
        return result + '"';
      };
      const headers = p.headers.filter(h => !(b.kind === "form" && h.name.toLowerCase() === "content-type"));
      if (p.hasData && !headers.some(h => h.name.toLowerCase() === "content-type"))
        headers.push({ name: "Content-Type", value: "application/x-www-form-urlencoded" });
      const lines = [
        "// Cargo.toml [dependencies] (use a current stable Rust toolchain):",
        '// reqwest = { version = "0.12", default-features = false, features = ["rustls-tls", "multipart", "gzip", "brotli", "deflate"] }',
        '// tokio = { version = "1", features = ["macros", "rt-multi-thread"] }',
        "// Multipart files are buffered in memory.",
        "use reqwest::Client;", "", "#[tokio::main]", "async fn main() -> Result<(), Box<dyn std::error::Error>> {",
        "    let client = Client::builder()",
        "        .timeout(std::time::Duration::from_secs(30))",
        `        .redirect(reqwest::redirect::Policy::${p.followRedirects ? "limited(20)" : "none()"})`,
        `        .gzip(${p.compressed}).brotli(${p.compressed}).deflate(${p.compressed})`,
      ];
      if (p.insecure) lines.push("        // Explicit curl -k only; certificate verification remains enabled otherwise.", "        .danger_accept_invalid_certs(true)");
      lines.push("        .build()?;");
      if (b.kind === "form") {
        let form = "    let form = reqwest::multipart::Form::new()";
        for (const f of p.forms) {
          if ((f.isFile && /;|^@-$/u.test(f.value)) || (!f.isFile && (f.value.startsWith("<") || /;(?:type|filename|headers)=/u.test(f.value))))
            throw new Error("Rust 转换暂不支持 -F 的文件参数、<file 或标准输入，请使用普通字段或 @文件路径");
          if (f.isFile) {
            const filePath = f.value.slice(1);
            const fileName = filePath.split(/[\\/]/).pop() || "upload.bin";
            form += `\n        .part(${rustStr(f.name)}, reqwest::multipart::Part::bytes(std::fs::read(${rustStr(filePath)})?).file_name(${rustStr(fileName)}).mime_str("application/octet-stream")?)`;
          } else form += `\n        .text(${rustStr(f.name)}, ${rustStr(f.value)})`;
        }
        lines.push(form + ";");
      }
      lines.push("    let response = client", `        .request(reqwest::Method::from_bytes(${rustStr(p.method)}.as_bytes())?, ${rustStr(p.url)})`);
      headers.forEach(h => lines.push(`        .header(${rustStr(h.name)}, ${rustStr(h.value)})`));
      if (p.auth) lines.push(`        .basic_auth(${rustStr(p.auth.user)}, Some(${rustStr(p.auth.pass)}))`);
      if (b.kind === "form") lines.push("        .multipart(form)");
      else if (b.kind !== "none") lines.push(`        .body(${rustStr(p.data)})`);
      lines.push("        .send().await?;", '    println!("{}", response.status());', '    println!("{}", response.text().await?);', "    Ok(())", "}");
      return lines.join("\n");
    }
    default:
      return "";
  }
}

export function CurlToCodeTool() {
  const __locale = __useLanguage();
  const [input, setInput] = useToolDraft("curl-to-code", "input", "");
  const [lang, setLang] = useToolDraft("curl-to-code", "lang", "python");
  const [error, setError] = useState<string | null>(null);

  const parsed = useMemo(() => {
    if (!input.trim()) return null;
    try {
      return parseCurl(input);
    } catch {
      return null;
    }
  }, [input, __locale]);

  const code = useMemo(() => {
    if (!parsed) return "";
    try {
      return generate(parsed, lang);
    } catch (e) {
      return `// 生成失败：${e instanceof Error ? e.message : String(e)}`;
    }
  }, [parsed, lang, __locale]);

  const run = () => {
    setError(null);
    try {
      if (!input.trim()) throw new Error("请先粘贴一条 curl 命令");
      parseCurl(input);
    } catch (e) {
      setError(e instanceof Error ? e.message : "解析失败");
    }
  };

  const sample = () => {
    setInput(
      `curl 'https://api.example.com/v1/users?page=2' \\\n` +
        `  -H 'accept: application/json' \\\n` +
        `  -H 'content-type: application/json' \\\n` +
        `  -H 'authorization: Bearer eyJhbGciOiJIUzI1NiJ9.demo' \\\n` +
        `  --data-raw '{"name":"芙宁娜","role":"admin","active":true}'`,
    );
    setError(null);
  };

  const clearAll = () => {
    setInput("");
    setError(null);
  };

  const b = parsed ? bodyInfo(parsed) : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        {/* 左：curl 命令 */}
        <div className="thin-scroll space-y-4 lg:col-span-5">
          <SectionCard
            icon={<Terminal className="h-4 w-4" />}
            title={__ui("粘贴 curl 命令")}
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
              onBlur={run}
              placeholder={
                "curl 'https://api.example.com/users' \\\n  -H 'content-type: application/json' \\\n  --data-raw '{\"name\":\"furina\"}'"
              }
              className="min-h-[220px] font-mono text-[11.5px] leading-relaxed"
              spellCheck={false}
            />
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              {__ui("仅解析单条 POSIX/Bash 字面命令，不执行 shell。支持 -H / -d / -G / --data-urlencode / -F 等；--data 的 @文件读取暂不支持。")}</p>
          </SectionCard>

          {parsed && (
            <SectionCard icon={<Search className="h-4 w-4" />} title={__ui("解析结果（核对一下有没有读错）")}>
              <div className="space-y-2 text-xs">
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="text-primary">
                    {parsed.method}
                  </Badge>
                  <span className="min-w-0 flex-1 truncate font-mono text-foreground">{parsed.url}</span>
                </div>
                {parsed.headers.length > 0 && (
                  <div className="rounded-lg border border-border/60 bg-background/40 p-2">
                    <div className="mb-1 text-[11px] text-muted-foreground">{__ui("请求头（")}{parsed.headers.length}）</div>
                    {parsed.headers.map((h) => (
                      <div key={h.name} className="truncate font-mono text-[11px]">
                        <span className="text-muted-foreground">{h.name}:</span> <span className="text-foreground">{h.value}</span>
                      </div>
                    ))}
                  </div>
                )}
                {b && b.kind !== "none" && (
                  <div className="rounded-lg border border-border/60 bg-background/40 p-2">
                    <div className="mb-1 text-[11px] text-muted-foreground">
                      {__ui("请求体（")}{b.kind === "json" ? "JSON" : b.kind === "form" ? __ui("表单文件") : b.kind === "querystring" ? __ui("表单") : __ui("文本")}）
                    </div>
                    <pre className="thin-scroll max-h-32 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] text-foreground">
                      {b.kind === "json" || b.kind === "text"
                        ? String(b.value)
                        : (b.value as Array<{ name: string; value: string }>).map((f) => `${f.name}=${f.value}`).join("\n")}
                    </pre>
                  </div>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {parsed.auth && <Badge variant="secondary">{__ui("带账号密码")}</Badge>}
                  {parsed.insecure && <Badge variant="secondary">{__ui("忽略证书校验")}</Badge>}
                  {parsed.followRedirects && <Badge variant="secondary">{__ui("跟随跳转")}</Badge>}
                  {parsed.compressed && <Badge variant="secondary">{__ui("压缩传输")}</Badge>}
                </div>
              </div>
            </SectionCard>
          )}
        </div>

        {/* 右：生成的代码 */}
        <div className="thin-scroll space-y-4 lg:col-span-7">
          {error && <ErrorBar message={__msg(error)} />}

          <SectionCard
            icon={<Code2 className="h-4 w-4" />}
            title={__ui("生成代码")}
            extra={code ? <CopyButton value={code} label={__ui("复制代码")} /> : undefined}
          >
            <div className="mb-3 flex flex-wrap gap-1.5">
              {LANGS.map((l) => (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => setLang(l.id)}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                    lang === l.id ? "bg-primary text-primary-foreground" : "bg-secondary/40 text-muted-foreground hover:bg-muted",
                  )}
                >
                  {__ui(l.label)}
                </button>
              ))}
            </div>

            {!parsed || !code ? (
              <EmptyPane
                icon={<Terminal className="h-5 w-5" />}
                title={__ui("在左侧粘贴 curl 命令，此处生成对应代码")}
                hint={__ui("从浏览器开发者工具里「Copy as cURL」，粘过来就能直接转成 9 种语言的请求代码。")}
              />
            ) : (
              <pre className="thin-scroll max-h-[420px] overflow-auto rounded-xl border border-border/60 bg-background/60 p-3 font-mono text-[11.5px] leading-relaxed text-foreground">
                {code}
              </pre>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 工具二：正则速查表
// ══════════════════════════════════════════════════════════════════════

interface RegexEntry {
  pattern: string;
  desc: string;
  example?: string;
}

const REGEX_GROUPS: Array<{ id: string; title: string; items: RegexEntry[] }> = [
  {
    id: "class",
    title: "字符类",
    items: [
      { pattern: ".", desc: "任意一个字符（默认不含换行）", example: "a.c 匹配 abc、a c" },
      { pattern: "\\d", desc: "一个数字，等价 [0-9]", example: "\\d{3} 匹配 123" },
      { pattern: "\\D", desc: "一个非数字", example: "\\D 匹配 a、空格" },
      { pattern: "\\w", desc: "字母、数字或下划线，等价 [A-Za-z0-9_]", example: "\\w+ 匹配 hello_1" },
      { pattern: "\\W", desc: "非字母数字下划线", example: "\\W 匹配 @、空格" },
      { pattern: "\\s", desc: "空白字符（空格、Tab、换行）", example: "a\\sb 匹配 a b" },
      { pattern: "\\S", desc: "非空白字符", example: "\\S+ 匹配一整段非空文本" },
      { pattern: "[abc]", desc: "方括号里的任意一个字符", example: "[aeiou] 匹配元音" },
      { pattern: "[^abc]", desc: "不在方括号里的任意字符", example: "[^0-9] 匹配非数字" },
      { pattern: "[a-z]", desc: "区间：小写字母", example: "[a-zA-Z0-9] 匹配字母数字" },
      { pattern: "[\\u4e00-\\u9fa5]", desc: "常用汉字区间", example: "匹配「你好」" },
    ],
  },
  {
    id: "quant",
    title: "量词",
    items: [
      { pattern: "*", desc: "前一项出现 0 次或多次", example: "ab* 匹配 a、ab、abbb" },
      { pattern: "+", desc: "前一项出现 1 次或多次", example: "ab+ 匹配 ab、abbb（不匹配 a）" },
      { pattern: "?", desc: "前一项出现 0 次或 1 次", example: "colou?r 匹配 color、colour" },
      { pattern: "{n}", desc: "恰好 n 次", example: "\\d{6} 匹配 6 位数字" },
      { pattern: "{n,}", desc: "至少 n 次", example: "\\d{2,} 匹配 2 位以上数字" },
      { pattern: "{n,m}", desc: "n 到 m 次", example: "\\d{1,3} 匹配 1~3 位数字" },
      { pattern: "*?", desc: "懒惰匹配：尽量少地匹配", example: "<.+?> 只匹配到第一个 >" },
      { pattern: "+?", desc: "懒惰的 +", example: "\".+?\" 匹配最短的引号内容" },
    ],
  },
  {
    id: "anchor",
    title: "位置与边界",
    items: [
      { pattern: "^", desc: "字符串/行的开头", example: "^Hello 只匹配行首的 Hello" },
      { pattern: "$", desc: "字符串/行的结尾", example: "world$ 只匹配行尾的 world" },
      { pattern: "\\b", desc: "单词边界", example: "\\bcat\\b 匹配单独的 cat" },
      { pattern: "\\B", desc: "非单词边界", example: "\\Bcat 匹配 scat 里的 cat" },
    ],
  },
  {
    id: "group",
    title: "分组与引用",
    items: [
      { pattern: "( )", desc: "捕获分组，可用 $1/$2 取用", example: "(\\d{4})-(\\d{2}) 取年月" },
      { pattern: "(?: )", desc: "非捕获分组：只分组不占编号", example: "(?:ab)+ 匹配 ababab" },
      { pattern: "(?<name> )", desc: "具名分组", example: "(?<year>\\d{4}) 用 $<year> 取" },
      { pattern: "\\1", desc: "反向引用第 1 个分组", example: "(\\w)\\1 匹配 aa、bb" },
      { pattern: "\\k<name>", desc: "反向引用具名分组", example: "(?<c>\\w)\\k<c>" },
      { pattern: "|", desc: "或", example: "cat|dog 匹配 cat 或 dog" },
    ],
  },
  {
    id: "assert",
    title: "断言（零宽）",
    items: [
      { pattern: "(?= )", desc: "后面必须是：前瞻", example: "\\d+(?=元) 匹配「100元」里的 100" },
      { pattern: "(?! )", desc: "后面不能是：否定前瞻", example: "\\d+(?!元) 后面不是元的数字" },
      { pattern: "(?<= )", desc: "前面必须是：后顾", example: "(?<=\\$)\\d+ 匹配 $100 里的 100" },
      { pattern: "(?<! )", desc: "前面不能是：否定后顾", example: "(?<!\\$)\\d+ 前面不是 $ 的数字" },
    ],
  },
  {
    id: "flag",
    title: "标志（写在小尾巴上）",
    items: [
      { pattern: "g", desc: "全局匹配：找所有，不只是一处", example: "/\\d/g" },
      { pattern: "i", desc: "忽略大小写", example: "/hello/i 匹配 Hello" },
      { pattern: "m", desc: "多行：让 ^ $ 匹配每一行", example: "/^\\w+/m" },
      { pattern: "s", desc: "让 . 也能匹配换行", example: "/a.b/s" },
      { pattern: "u", desc: "Unicode 模式：正确处理 emoji 与生僻字", example: "/\\p{Script=Han}/u" },
      { pattern: "$1 $&", desc: "替换时：分组内容 / 整个匹配", example: "把 (\\d+) 替换成 ￥$1" },
    ],
  },
  {
    id: "common",
    title: "常用模式（直接抄）",
    items: [
      { pattern: "1[3-9]\\d{9}", desc: "中国大陆手机号", example: "13812345678" },
      { pattern: "[\\w.+-]+@[\\w-]+\\.[\\w.]+", desc: "邮箱地址", example: "me@example.com" },
      { pattern: "[1-9]\\d{5}(18|19|20)\\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\\d|3[01])\\d{3}[\\dXx]", desc: "身份证号（18 位）" },
      { pattern: "https?://[^\\s\"'<>]+", desc: "网址", example: "https://furinakit.com/a?b=1" },
      { pattern: "((25[0-5]|2[0-4]\\d|1?\\d?\\d)\\.){3}(25[0-5]|2[0-4]\\d|1?\\d?\\d)", desc: "IPv4 地址", example: "192.168.1.1" },
      { pattern: "\\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\\d|3[01])", desc: "日期 YYYY-MM-DD", example: "2026-09-15" },
      { pattern: "([01]\\d|2[0-3]):[0-5]\\d(:[0-5]\\d)?", desc: "时间 HH:MM(:SS)", example: "23:59:59" },
      { pattern: "[\\u4e00-\\u9fa5]+", desc: "一段连续中文", example: "你好世界" },
      { pattern: "#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\\b", desc: "十六进制颜色", example: "#c67710" },
      { pattern: "\\d{6}", desc: "6 位数字（验证码 / 邮编）", example: "100000" },
      { pattern: "(?=.*[a-z])(?=.*[A-Z])(?=.*\\d).{8,}", desc: "密码：含大小写与数字、8 位以上" },
      { pattern: "\\$\\d+(?:\\.\\d{2})?", desc: "金额（美元写法）", example: "$19.99" },
      { pattern: "\\b\\w+@\\w+\\.\\w+\\b", desc: "最简邮箱（宽松）" },
      { pattern: "^\\s*$", desc: "空行（只有空白）" },
    ],
  },
];

export function RegexCheatsheetTool() {
  const __locale = __useLanguage();
 const [keyword,setKeyword]=useToolDraft('regex-cheatsheet','keyword','');
 const [group,setGroup]=useToolDraft('regex-cheatsheet','group','class');
 const [testPattern,setTestPattern]=useToolDraft('regex-cheatsheet','testPattern','(\\d{4})-(\\d{2})-(\\d{2})');
 const [testFlags,setTestFlags]=useToolDraft('regex-cheatsheet','testFlags','g');
 const [testText,setTestText]=useToolDraft('regex-cheatsheet','testText','发布日期：2026-09-15，更新于 2026-09-20。');
 const [result,setResult]=useState<{matches:Array<{text:string;index:number;groups:string[]}>;error:string;limited:boolean}>({matches:[],error:'',limited:false});
 const [running,setRunning]=useState(false);
 const [page,setPage]=useState(0);
 useEffect(()=>{setPage(0);},[keyword,group]);
 useEffect(()=>{
  if(!testPattern){setResult({matches:[],error:'',limited:false});setRunning(false);return;}
  setRunning(true);setResult({matches:[],error:'',limited:false});let worker:Worker|undefined,deadline:ReturnType<typeof setTimeout>|undefined;
  const timer=setTimeout(()=>{try{worker=new Worker(new URL('../../lib/regex-preview.worker.ts',import.meta.url),{type:'module'});deadline=setTimeout(()=>{worker?.terminate();setRunning(false);setResult({matches:[],error:'表达式执行超时，请缩短文本或简化嵌套量词。',limited:false});},1200);worker.onmessage=e=>{clearTimeout(deadline);setResult(e.data);setRunning(false);worker?.terminate();};worker.onerror=()=>{clearTimeout(deadline);setRunning(false);setResult({matches:[],error:'正则执行线程不可用',limited:false});worker?.terminate();};worker.postMessage({pattern:testPattern,flags:testFlags,text:testText});}catch(e){setRunning(false);setResult({matches:[],error:String(e),limited:false});}},180);
  return()=>{clearTimeout(timer);clearTimeout(deadline);worker?.terminate();};
 },[testPattern,testFlags,testText]);
 const kw=keyword.trim().toLowerCase();
 const entries=REGEX_GROUPS.filter(g=>kw||group==='all'||g.id===group).flatMap(g=>g.items.map(it=>({...it,category:g.title,groupId:g.id}))).filter(it=>!kw||`${it.pattern} ${it.desc} ${it.example||''} ${it.category}`.toLowerCase().includes(kw));
 const useEntry=(it:RegexEntry & {groupId:string})=>{if(it.groupId==='flag'){if(/^[gimsuy]$/.test(it.pattern))setTestFlags(Array.from(new Set(testFlags+it.pattern)).join(''));return;}setTestPattern(it.pattern);};
 const count=Math.max(1,Math.ceil(entries.length/8));const activePage=Math.min(page,count-1);
 return <div className="space-y-4">
  <header className="flex items-center gap-3"><div className="rounded-xl bg-primary/10 p-3 text-primary"><BookMarked size={23}/></div><div><h2 className="text-lg font-semibold">{__ui("正则速查工作台")}</h2><p className="mt-1 text-xs text-muted-foreground">{__ui("按分类查语法，点击条目送入右侧验证。使用 JavaScript 正则引擎。")}</p></div></header>
  <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
   <section className="min-w-0 rounded-2xl border border-border bg-card p-4">
    <div className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground"/><Input aria-label={__ui("搜索正则语法")} value={keyword} onChange={e=>setKeyword(e.target.value)} placeholder={__ui("搜索语法、用途或示例…")} className="pl-9"/></div>
    <nav aria-label={__ui("正则分类")} className="my-3 flex flex-wrap gap-1.5">{[{id:'all',title:'全部'},...REGEX_GROUPS].map(g=><button key={g.id} onClick={()=>{setGroup(g.id);setKeyword('');}} className={cn('rounded-lg px-3 py-1.5 text-xs transition-colors',!kw&&group===g.id?'bg-primary text-primary-foreground':'bg-muted/60 text-muted-foreground hover:text-foreground')}>{__msg(g.title)}</button>)}</nav>
    <div className="h-[390px] overflow-y-auto pr-1">{entries.slice(activePage*8,activePage*8+8).map((it,i)=><article key={`${it.category}-${it.pattern}-${i}`} className="mb-2 rounded-xl border border-border/70 p-3 hover:border-primary/40"><div className="flex items-start justify-between gap-2"><button onClick={()=>useEntry(it)} className="min-w-0 text-left"><code className="break-all text-sm font-semibold text-primary">{it.pattern}</code><p className="mt-1 text-xs leading-5">{__ui(it.desc)}</p></button><div className="flex shrink-0 items-center gap-1"><CopyButton value={it.pattern}/><button title={__ui("填入表达式或启用标志")} disabled={it.pattern==='$1 $&'} onClick={()=>useEntry(it)} className="rounded-lg bg-primary/10 p-2 text-primary"><Play size={13}/></button></div></div>{it.example&&<p className="mt-1 break-all text-[11px] leading-5 text-muted-foreground">{it.example}</p>}</article>)}{!entries.length&&<p className="py-20 text-center text-sm text-muted-foreground">{__ui("没有找到条目，试试其他关键词")}</p>}</div>
    <footer className="mt-3 flex items-center justify-between border-t border-border pt-3 text-xs text-muted-foreground"><span>{entries.length} {__ui("条 ·")}{activePage+1} / {__count(count, "页")} </span><div className="flex gap-1"><Button variant="ghost" size="sm" disabled={activePage===0} onClick={()=>setPage(activePage-1)}>{__ui("上一页")}</Button><Button variant="ghost" size="sm" disabled={activePage+1>=count} onClick={()=>setPage(activePage+1)}>{__ui("下一页")}</Button></div></footer>
   </section>
   <section className="min-w-0 rounded-2xl border border-border bg-card p-4"><div className="mb-4 flex items-center justify-between"><h3 className="text-sm font-semibold">{__ui("即时验证")}</h3><span className="rounded-full bg-primary/10 px-2 py-1 text-[11px] text-primary">{running?__ui("计算中…"):__msg("{0} 个匹配", result.matches.length)}</span></div><label className="text-xs text-muted-foreground" htmlFor="regex-pattern">{__ui("表达式（不含两端斜杠）")}</label><Input id="regex-pattern" value={testPattern} onChange={e=>setTestPattern(e.target.value)} className="mt-1 font-mono text-sm" spellCheck={false}/><div className="my-3 flex flex-wrap gap-2">{[['g','全部匹配'],['i','忽略大小写'],['m','多行'],['s','跨行点号'],['u','Unicode'],['y','粘连']].map(([flag,label])=><label key={flag} title={__ui(label)} className="flex cursor-pointer items-center gap-1 rounded-md bg-muted/60 px-2 py-1 text-xs"><input type="checkbox" checked={testFlags.includes(flag)} onChange={e=>setTestFlags(e.target.checked?Array.from(new Set(testFlags+flag)).join(''):testFlags.split(flag).join(''))}/>{flag}</label>)}</div><label htmlFor="regex-sample" className="text-xs text-muted-foreground">{__ui("测试文本")}</label><Textarea id="regex-sample" value={testText} onChange={e=>setTestText(e.target.value)} className="mt-1 h-32 resize-y text-sm"/><div className="my-3 flex items-center justify-between text-xs"><span className="text-muted-foreground">{__ui("匹配与捕获组 · UTF-16 索引")}</span><CopyButton value={result.matches.map(m=>m.text).join('\n')} label={__ui("复制匹配")}/></div><div className="h-48 overflow-auto rounded-xl bg-muted/40 p-3">{result.error?<p role="alert" className="break-all text-xs text-destructive">{__msg(result.error)}</p>:result.matches.length?result.matches.map((m,i)=><div key={i} className="mb-2 rounded-lg bg-card p-2 text-xs"><div className="flex gap-2"><span className="text-muted-foreground">#{i+1} @{m.index}</span><code className="min-w-0 whitespace-pre-wrap break-all text-primary">{m.text||__ui("（空匹配）")}</code></div>{m.groups.map((g,j)=><p key={j} className="mt-1 break-all text-muted-foreground">${j+1} = {g||__ui("（空）")}</p>)}</div>):<p className="py-12 text-center text-xs text-muted-foreground">{running?__ui("正在匹配…"):__ui("暂无匹配结果")}</p>}</div><p className="mt-3 text-[11px] leading-5 text-muted-foreground">{result.limited?__ui("结果已截断，最多显示200项。"):__ui("正则在独立线程执行，超时会自动停止。")} {__ui("语法片段需补充匹配对象；常用模式不代替完整业务校验。")}</p></section>
  </div>
 </div>;
}

// ══════════════════════════════════════════════════════════════════════
// 工具三：HTML 转 Markdown
// ══════════════════════════════════════════════════════════════════════

/** 把 HTML 转成 Markdown。覆盖常见标签，够日常写文档 / 搬内容用。 */
function htmlToMarkdown(html: string, opts: { keepTable: boolean; keepImage: boolean }): string {
  if (typeof window === "undefined") return "";
  const doc = new DOMParser().parseFromString(`<div id="fk-root">${html}</div>`, "text/html");
  const root = doc.getElementById("fk-root");
  if (!root) return "";

  const walk = (node: Node, listDepth = 0): string => {
    if (node.nodeType === 3) {
      // 文本：压缩连续空白（HTML 里换行缩进不算内容）
      return (node.textContent || "").replace(/\s+/g, " ");
    }
    if (node.nodeType !== 1) return "";
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();

    // 这些标签的内容直接丢弃
    if (["script", "style", "noscript", "iframe", "svg", "head"].includes(tag)) return "";

    const inner = () => Array.from(el.childNodes).map((c) => walk(c, listDepth)).join("");
    const tight = (s: string) => s.replace(/\s+/g, " ").trim();

    switch (tag) {
      case "br":
        return "  \n";
      case "hr":
        return "\n\n---\n\n";
      case "h1":
      case "h2":
      case "h3":
      case "h4":
      case "h5":
      case "h6": {
        const level = Number(tag[1]);
        return `\n\n${"#".repeat(level)} ${tight(inner())}\n\n`;
      }
      case "p":
        return `\n\n${tight(inner())}\n\n`;
      case "strong":
      case "b":
        return `**${tight(inner())}**`;
      case "em":
      case "i":
        return `*${tight(inner())}*`;
      case "del":
      case "s":
      case "strike":
        return `~~${tight(inner())}~~`;
      case "mark":
        return `==${tight(inner())}==`;
      case "sup":
        return `^${tight(inner())}`;
      case "sub":
        return `~${tight(inner())}`;
      case "code": {
        // 块级代码在 pre 里处理，这里只处理行内
        const text = el.textContent || "";
        if (el.closest("pre")) return text;
        return text.includes("`") ? `\`\`${text}\`\`` : `\`${text}\``;
      }
      case "pre": {
        const codeEl = el.querySelector("code");
        const text = (codeEl?.textContent ?? el.textContent ?? "").replace(/^\n+|\n+$/g, "");
        const langMatch = codeEl?.className?.match(/language-([\w+-]+)/);
        const lang = langMatch ? langMatch[1] : "";
        return `\n\n\`\`\`${lang}\n${text}\n\`\`\`\n\n`;
      }
      case "blockquote": {
        const body = tight(inner()).replace(/\n{3,}/g, "\n\n");
        return `\n\n${body
          .split("\n")
          .map((l) => (l.trim() ? `> ${l.trim()}` : ">"))
          .join("\n")}\n\n`;
      }
      case "a": {
        const href = el.getAttribute("href") || "";
        const text = tight(inner()) || href;
        if (!href || href.startsWith("javascript:")) return text;
        return `[${text}](${href})`;
      }
      case "img": {
        if (!opts.keepImage) return "";
        const src = el.getAttribute("src") || "";
        const alt = el.getAttribute("alt") || "";
        return src ? `![${alt}](${src})` : "";
      }
      case "ul":
      case "ol": {
        const ordered = tag === "ol";
        const items = Array.from(el.children).filter((c) => c.tagName.toLowerCase() === "li");
        const lines: string[] = [];
        items.forEach((li, i) => {
          // 一个 li 里的内容分两拨：行内文字（压成一行）与嵌套列表（要单独缩进成多行）
          const inlineParts: string[] = [];
          const nested: string[] = [];
          Array.from(li.childNodes).forEach((child) => {
            const childTag = child.nodeType === 1 ? (child as HTMLElement).tagName.toLowerCase() : "";
            // 注意用「只去掉首尾空行」而不是 trim()：trim 会把子项前面的缩进一起吃掉，
            // 结果嵌套列表会歪（踩过：- 压缩 跑到顶格，- 抠图 却缩进了）
            if (childTag === "ul" || childTag === "ol") nested.push(walk(child, listDepth + 1).replace(/^\n+|\n+$/g, ""));
            else inlineParts.push(walk(child, listDepth + 1));
          });
          const body = tight(inlineParts.join(""));
          lines.push(`${"  ".repeat(listDepth)}${ordered ? `${i + 1}.` : "-"} ${body}`.trimEnd());
          if (nested.length) lines.push(nested.join("\n"));
        });
        return `\n\n${lines.join("\n")}\n\n`;
      }
      case "li":
        return tight(inner());
      case "table": {
        if (!opts.keepTable) return `\n\n${tight(inner())}\n\n`;
        const rows = Array.from(el.querySelectorAll("tr"));
        if (rows.length === 0) return "";
        const cells = rows.map((tr) =>
          Array.from(tr.querySelectorAll("th,td")).map((td) => tight(td.textContent || "").replace(/\|/g, "\\|")),
        );
        const head = cells[0];
        const body = cells.slice(1);
        const sep = head.map(() => "---");
        const render = (row: string[]) => `| ${row.join(" | ")} |`;
        return `\n\n${render(head)}\n${render(sep)}\n${body.map(render).join("\n")}\n\n`;
      }
      case "div":
      case "section":
      case "article":
      case "main":
      case "header":
      case "footer":
      case "nav":
      case "aside":
      case "figure":
        return `\n${inner()}\n`;
      case "figcaption":
        return `\n*${tight(inner())}*\n`;
      default:
        return inner();
    }
  };

  let md = walk(root);
  // 收拾空行与首尾空白
  md = md.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/^\s+|\s+$/g, "");
  return md;
}

export function HtmlToMarkdownTool() {
  const __locale = __useLanguage();
  const [input, setInput] = useToolDraft("html-to-markdown", "input", "");
  const [keepTable, setKeepTable] = useToolDraft("html-to-markdown", "keepTable", true);
  const [keepImage, setKeepImage] = useToolDraft("html-to-markdown", "keepImage", true);
  const fileRef = useRef<HTMLInputElement>(null);

  const output = useMemo(() => {
    if (!input.trim()) return "";
    try {
      return htmlToMarkdown(input, { keepTable, keepImage });
    } catch {
      return "";
    }
  }, [input, keepTable, keepImage, __locale]);

  const download = () => {
    if (!output) return;
    const blob = new Blob([output], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "转换结果.md";
    document.body.appendChild(a);
    // ★ 游离的 <a> 直接 click() 在 WebView2 里会被忽略（点了没反应）——
    //   必须挂到 DOM 上再点，点完移除（通用结果卡那边用的是页面里的真链接，所以正常）
    document.body.appendChild(a);
    document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 1000);
    setTimeout(() => a.remove(), 1000);
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  };

  const sample = () => {
    setInput(
      `<h2>芙宁娜工具箱</h2>\n<p>这是一个 <strong>本地运行</strong> 的工具箱，共 <em>198</em> 个工具。</p>\n<ul>\n  <li>图片处理\n    <ul><li>压缩</li><li>抠图</li></ul>\n  </li>\n  <li>文档转换</li>\n</ul>\n<blockquote>所有处理都在本机完成，文件不上传。</blockquote>\n<pre><code class="language-js">console.log("hello");</code></pre>\n<table><tr><th>工具</th><th>数量</th></tr><tr><td>图片</td><td>30</td></tr></table>`,
    );
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="thin-scroll space-y-4 lg:col-span-6">
          <SectionCard
            icon={<FileCode2 className="h-4 w-4" />}
            title={__ui("粘贴 HTML")}
            extra={
              <div className="flex items-center gap-1.5">
                <input
                  ref={fileRef}
                  type="file"
                  accept=".html,.htm,.txt"
                  className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void f.text().then(setInput);
                    e.target.value = "";
                  }}
                />
                <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
                  {__ui("打开文件")}</Button>
                <Button type="button" variant="outline" size="sm" onClick={sample}>
                  <Sparkles className="h-3.5 w-3.5" /> {__ui("填入示例")}</Button>
                <Button type="button" variant="ghost" size="sm" onClick={() => setInput("")}>
                  <Eraser className="h-3.5 w-3.5" /> {__ui("清空")}</Button>
              </div>
            }
          >
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={__ui("把网页源码（右键「查看网页源代码」里的内容）粘进来，或直接打开 .html 文件")}
              className="min-h-[320px] font-mono text-[11.5px] leading-relaxed"
              spellCheck={false}
            />
          </SectionCard>
        </div>

        <div className="thin-scroll space-y-4 lg:col-span-6">
          <SectionCard
            icon={<Code2 className="h-4 w-4" />}
            title={__ui("Markdown 成品")}
            extra={
              output ? (
                <div className="flex items-center gap-1.5">
                  <CopyButton value={output} label={__ui("复制")} />
                  <Button type="button" variant="ghost" size="sm" onClick={download}>
                    <Download className="h-3.5 w-3.5" /> {__ui("存成 .md")}</Button>
                </div>
              ) : undefined
            }
          >
            <div className="mb-3 flex flex-wrap items-center gap-3 text-[11.5px]">
              <label className="flex cursor-pointer items-center gap-1.5 text-muted-foreground">
                <input type="checkbox" checked={keepTable} onChange={(e) => setKeepTable(e.target.checked)} className="accent-primary" />
                {__ui("表格转成 Markdown 表格")}</label>
              <label className="flex cursor-pointer items-center gap-1.5 text-muted-foreground">
                <input type="checkbox" checked={keepImage} onChange={(e) => setKeepImage(e.target.checked)} className="accent-primary" />
                {__ui("保留图片")}</label>
            </div>

            {!output ? (
              <EmptyPane
                icon={<FileCode2 className="h-5 w-5" />}
                title={__ui("在左侧粘贴 HTML，此处生成 Markdown")}
                hint={__ui("标题、列表、链接、图片、引用、代码块、表格都会转成对应的 Markdown 写法。")}
              />
            ) : (
              <pre className="thin-scroll max-h-[380px] overflow-auto whitespace-pre-wrap break-words rounded-xl border border-border/60 bg-background/60 p-3 font-mono text-[11.5px] leading-relaxed text-foreground">
                {output}
              </pre>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

