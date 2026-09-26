"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/json-studio-tool.tsx");


/**
 * JSON 生态工具箱（8 个功能合并在一个页面）
 *
 * 格式化校验 · 生成 Java Bean · 生成 C# 实体 · 生成 Go struct · 生成 Python dataclass ·
 * JSONPath 查询 · JSON 对比 · 转 TOML / INI
 *
 * 数据驱动：每个功能只声明「怎么从 JSON 得到文本」，界面与复制共用一套壳。零依赖零体积。
 */

import { useMemo, useState } from "react";
import { Braces, Check, Copy, Download, Wand2 } from "lucide-react";
import { Button, Input } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useTheme } from "@/components/theme-provider";
import { useToolDraft } from "@/lib/use-tool-draft";
import { cn } from "@/lib/utils";

/* ══════════════════════ 语言转换 ══════════════════════ */

/**
 * 递归收集嵌套对象类型。
 *
 * 只有一层字段是不够用的：真实 JSON 里几乎都有嵌套对象，剥出来单独生成一个类/结构体
 * 才是同类工具的标配做法（否则只能退化成 Map<String,Object>，等于没转）。
 * 数组元素里的对象同样会被收集，命名用「父级名 + 单数化的子键名」。
 */
function collectTypes(
  value: unknown,
  name: string,
  out: { name: string; fields: Record<string, unknown> }[] = [],
  seen = new Set<string>(),
): { name: string; fields: Record<string, unknown> }[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    if (Array.isArray(value) && value.length > 0) collectTypes(value[0], name, out, seen);
    return out;
  }
  const fields = value as Record<string, unknown>;
  if (seen.has(name)) return out;
  seen.add(name);
  out.push({ name, fields });
  for (const [k, v] of Object.entries(fields)) {
    const childName = pascal(k);
    if (v && typeof v === "object") collectTypes(v, childName, out, seen);
  }
  return out;
}

/** 按类型映射把 JSON 值转成目标语言类型名，嵌套对象用收集到的类名 */
function langType(v: unknown, lang: string, keyName: string): string {
  const isObj = v && typeof v === "object" && !Array.isArray(v);
  if (isObj) {
    const cls = pascal(keyName);
    return lang === "go" ? cls : cls;
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return typeOf(v, lang);
    const inner = v[0] && typeof v[0] === "object" && !Array.isArray(v[0])
      ? pascal(keyName) + "Item"
      : typeOf(v[0], lang);
    return lang === "python" ? `List[${inner}]` : lang === "java" ? `List<${inner}>` : lang === "go" ? `[]${inner}` : `List<${inner}>`;
  }
  return typeOf(v, lang);
}



function typeOf(v: unknown, lang: string): string {
  if (v === null || v === undefined) return lang === "python" ? "Optional[Any]" : lang === "java" ? "Object" : lang === "go" ? "interface{}" : "object?";
  if (Array.isArray(v)) {
    const inner = v.length ? typeOf(v[0], lang) : lang === "python" ? "Any" : lang === "java" ? "Object" : lang === "go" ? "interface{}" : "object?";
    return lang === "python" ? `List[${inner}]` : lang === "java" ? `List<${inner}>` : lang === "go" ? `[]${inner}` : `${inner}[]`;
  }
  switch (typeof v) {
    case "string":
      return lang === "python" ? "str" : lang === "java" ? "String" : lang === "go" ? "string" : "string";
    case "number":
      return Number.isInteger(v)
        ? lang === "python" ? "int" : lang === "java" ? "Integer" : lang === "go" ? "int" : "int"
        : lang === "python" ? "float" : lang === "java" ? "Double" : lang === "go" ? "float64" : "double";
    case "boolean":
      return lang === "python" ? "bool" : lang === "java" ? "Boolean" : lang === "go" ? "bool" : "bool";
    default:
      return lang === "python" ? "Dict[str, Any]" : lang === "java" ? "Map<String, Object>" : lang === "go" ? "map[string]interface{}" : "Dictionary<string, object>";
  }
}

const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const camel = (s: string) => s.replace(/[_-](\w)/g, (_, c: string) => c.toUpperCase());
const pascal = (s: string) => upperFirst(camel(s));
const snake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/-/g, "_").toLowerCase();

function toJava(obj: Record<string, unknown>, root = "Root"): string {
  const types = collectTypes(obj, upperFirst(root));
  const lines: string[] = ["import java.util.List;", "import java.util.Map;", ""];
  for (const t of types) {
    lines.push(`public class ${t.name} {`);
    for (const [k, v] of Object.entries(t.fields)) lines.push(`    private ${langType(v, "java", k)} ${camel(k)};`);
    lines.push("");
    for (const [k, v] of Object.entries(t.fields)) {
      const type = langType(v, "java", k);
      const name = upperFirst(camel(k));
      lines.push(`    public ${type} get${name}() { return ${camel(k)}; }`);
      lines.push(`    public void set${name}(${type} value) { this.${camel(k)} = value; }`);
    }
    lines.push("}", "");
  }
  return lines.join("\n").trimEnd();
}

function toCsharp(obj: Record<string, unknown>, root = "Root"): string {
  const types = collectTypes(obj, upperFirst(root));
  const lines: string[] = ["using System.Collections.Generic;", ""];
  for (const t of types) {
    lines.push(`public class ${t.name}`, "{");
    for (const [k, v] of Object.entries(t.fields)) lines.push(`    public ${langType(v, "csharp", k)} ${pascal(k)} { get; set; }`);
    lines.push("}", "");
  }
  return lines.join("\n").trimEnd();
}

function toGo(obj: Record<string, unknown>, root = "Root"): string {
  const types = collectTypes(obj, upperFirst(root));
  const lines: string[] = [];
  for (const t of types) {
    lines.push(`type ${t.name} struct {`);
    for (const [k, v] of Object.entries(t.fields)) lines.push(`\t${pascal(k)} ${langType(v, "go", k)} \`json:"${k}"\``);
    lines.push("}", "");
  }
  return lines.join("\n").trimEnd();
}

function toPython(obj: Record<string, unknown>, root = "Root"): string {
  const types = collectTypes(obj, upperFirst(root));
  const lines: string[] = ["from dataclasses import dataclass", "from typing import Any, List, Optional, Dict", ""];
  for (const t of types) {
    lines.push("", "@dataclass", `class ${t.name}:`);
    const entries = Object.entries(t.fields);
    if (entries.length === 0) lines.push("    pass");
    for (const [k, v] of entries) {
      const type = langType(v, "python", k);
      // 只有值确实为 null 的字段才标 Optional；一律套 Optional 会让类型失去意义
      lines.push(v === null ? `    ${snake(k)}: Optional[${type}] = None` : `    ${snake(k)}: ${type}`);
    }
  }
  return lines.join("\n").trimEnd();
}

/* ══════════════════════ 其他功能 ══════════════════════ */

/** 极简 JSONPath：支持 $.a.b、$.a[0]、$.a[*].b */
function jsonPath(data: unknown, path: string): unknown[] {
  const clean = path.trim().replace(/^\$/, "");
  const tokens = clean.match(/\.[^.[\]]+|\[[^\]]*\]/g) ?? [];
  let cur: unknown[] = [data];
  for (const raw of tokens) {
    const next: unknown[] = [];
    const isIndex = raw.startsWith("[");
    const key = isIndex ? raw.slice(1, -1) : raw.slice(1);
    for (const item of cur) {
      if (isIndex) {
        if (Array.isArray(item)) {
          if (key === "*") next.push(...item);
          else {
            const idx = Number(key);
            if (Number.isInteger(idx) && idx >= 0 && idx < item.length) next.push(item[idx]);
          }
        }
      } else if (item && typeof item === "object") {
        const rec = item as Record<string, unknown>;
        if (key === "*") next.push(...Object.values(rec));
        else if (key in rec) next.push(rec[key]);
      }
    }
    cur = next;
  }
  return cur;
}

/** 结构差异对比：给出路径、类型与两侧取值 */
function diffJson(a: unknown, b: unknown, path = "$"): string[] {
  const out: string[] = [];
  const ta = a === null ? "null" : Array.isArray(a) ? "array" : typeof a;
  const tb = b === null ? "null" : Array.isArray(b) ? "array" : typeof b;
  if (ta !== tb) {
    out.push(`${path}：类型不同（${ta} → ${tb}）`);
    return out;
  }
  if (ta === "object") {
    const ra = a as Record<string, unknown>;
    const rb = b as Record<string, unknown>;
    const keys = new Set([...Object.keys(ra), ...Object.keys(rb)]);
    for (const k of keys) {
      if (!(k in ra)) out.push(`${path}.${k}：仅在右侧存在（${JSON.stringify(rb[k])}）`);
      else if (!(k in rb)) out.push(`${path}.${k}：仅在左侧存在（${JSON.stringify(ra[k])}）`);
      else out.push(...diffJson(ra[k], rb[k], `${path}.${k}`));
    }
    return out;
  }
  if (ta === "array") {
    const aa = a as unknown[];
    const ab = b as unknown[];
    if (aa.length !== ab.length) out.push(`${path}：数组长度不同（${aa.length} → ${ab.length}）`);
    const n = Math.min(aa.length, ab.length);
    for (let i = 0; i < n; i++) out.push(...diffJson(aa[i], ab[i], `${path}[${i}]`));
    return out;
  }
  if (a !== b) out.push(`${path}：${JSON.stringify(a)} → ${JSON.stringify(b)}`);
  return out;
}

/** JSON → TOML（支持一层嵌套与数组）*/
function toToml(value: unknown): string {
  const lines: string[] = [];
  const fmt = (v: unknown): string => {
    if (typeof v === "string") return JSON.stringify(v);
    if (v === null) return '""';
    if (Array.isArray(v)) return `[${v.map(fmt).join(", ")}]`;
    if (typeof v === "object") return JSON.stringify(v);
    return String(v);
  };
  const walk = (obj: Record<string, unknown>, prefix: string) => {
    const nested: [string, Record<string, unknown>][] = [];
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === "object" && !Array.isArray(v)) nested.push([k, v as Record<string, unknown>]);
      else lines.push(`${k} = ${fmt(v)}`);
    }
    for (const [k, v] of nested) {
      lines.push("", `[${prefix}${k}]`);
      walk(v, `${prefix}${k}.`);
    }
  };
  if (value && typeof value === "object" && !Array.isArray(value)) walk(value as Record<string, unknown>, "");
  else lines.push(`value = ${fmt(value)}`);
  return lines.join("\n");
}

/** JSON → INI（一层嵌套作为 [section]）*/
function toIni(value: unknown): string {
  const lines: string[] = [];
  const fmt = (v: unknown): string => (typeof v === "string" ? v : Array.isArray(v) ? v.join(",") : JSON.stringify(v));
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const obj = value as Record<string, unknown>;
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === "object" && !Array.isArray(v)) continue;
      lines.push(`${k}=${fmt(v)}`);
    }
    for (const [k, v] of Object.entries(obj)) {
      if (v && typeof v === "object" && !Array.isArray(v)) {
        lines.push("", `[${k}]`);
        for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) lines.push(`${k2}=${fmt(v2)}`);
      }
    }
  } else {
    lines.push(`value=${fmt(value)}`);
  }
  return lines.join("\n");
}

/* ══════════════════════ 功能清单 ══════════════════════ */

type Feature = {
  id: string;
  name: string;
  hint: string;
  needsSecond?: boolean;
  needsPath?: boolean;
  run: (parsed: unknown, second: unknown, path: string) => string;
};

const FEATURES: Feature[] = [
  { id: "format", name: "格式化与校验", hint: "缩进美化并检查语法，出错时给出具体位置", run: (p) => JSON.stringify(p, null, 2) },
  { id: "minify", name: "压缩", hint: "去掉所有空白，便于塞进配置或传输", run: (p) => JSON.stringify(p) },
  { id: "java", name: "转 Java Bean", hint: "生成字段、getter 与 setter，类型自动推断", run: (p) => toJava((p ?? {}) as Record<string, unknown>) },
  { id: "csharp", name: "转 C# 实体", hint: "生成带 get/set 的属性类", run: (p) => toCsharp((p ?? {}) as Record<string, unknown>) },
  { id: "go", name: "转 Go struct", hint: "带 json tag，字段名自动转大驼峰", run: (p) => toGo((p ?? {}) as Record<string, unknown>) },
  { id: "python", name: "转 Python dataclass", hint: "字段名自动转下划线，类型带注解", run: (p) => toPython((p ?? {}) as Record<string, unknown>) },
  { id: "path", name: "JSONPath 查询", hint: "支持 $.a.b、$.a[0]、$.a[*].b 这类写法", needsPath: true, run: (p, _s, path) => JSON.stringify(jsonPath(p, path || "$"), null, 2) },
  { id: "diff", name: "JSON 对比", hint: "逐字段给出差异：类型变了、只在一边有、值不同", needsSecond: true, run: (p, s) => {
      const list = diffJson(p, s, "$");
      return list.length ? list.join("\n") : "两个 JSON 完全一致";
    } },
  { id: "toml", name: "转 TOML", hint: "嵌套对象转成 [section]，适合配置文件", run: (p) => toToml(p) },
  { id: "ini", name: "转 INI", hint: "一层嵌套转成 [section]，简单直白", run: (p) => toIni(p) },
];

/* ══════════════════════ 界面 ══════════════════════ */

export function JsonStudioTool() {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  const { toast } = useToast();
  const [activeId, setActiveId] = useState(FEATURES[0].id);
  const [input, setInput] = useToolDraft("json-studio", "input", "");
  const [second, setSecond] = useState("");
  const [path, setPath] = useState("$");
  const active = FEATURES.find((f) => f.id === activeId)!;

  const { output, error } = useMemo(() => {
    if (!input.trim()) return { output: "", error: "" };
    try {
      const parsed = JSON.parse(input);
      let secondParsed: unknown = null;
      if (active.needsSecond) {
        if (!second.trim()) return { output: "", error: "请把第二个 JSON 粘贴到右侧再对比" };
        secondParsed = JSON.parse(second);
      }
      return { output: active.run(parsed, secondParsed, path), error: "" };
    } catch (err) {
      const msg = err instanceof Error ? err.message : "解析失败";
      // 把 "position 123" 换算成行列，方便定位
      const m = /position (\d+)/.exec(msg);
      let where = "";
      if (m) {
        const pos = Number(m[1]);
        const before = input.slice(0, pos);
        const line = before.split("\n").length;
        const col = pos - before.lastIndexOf("\n");
        where = `（第 ${line} 行，第 ${col} 列）`;
      }
      return { output: "", error: `JSON 格式有误${where}：${msg}` };
    }
  }, [input, second, path, active, __locale]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(output);
      toast({ title: "已复制结果", variant: "success" });
    } catch {
      toast({ title: "复制失败", variant: "error" });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border p-4" style={{ borderColor: colors.borderSolid, background: colors.card }}>
        <div className="flex flex-wrap gap-2">
          {FEATURES.map((f) => {
            const on = f.id === activeId;
            return (
              <button
                key={f.id}
                onClick={() => setActiveId(f.id)}
                className="rounded-xl border px-3 py-1.5 text-[12.5px] font-medium transition-all"
                style={{ borderColor: on ? "hsl(var(--primary))" : colors.borderSolid, background: on ? colors.active : "transparent", color: colors.text }}
              >
                {__msg(f.name)}
              </button>
            );
          })}
        </div>
        <p className="mt-2.5 flex items-center gap-1.5 text-[11.5px]" style={{ color: colors.muted }}>
          <Wand2 size={12} /> {__ui(active.hint)}
        </p>
      </section>

      {active.needsPath && (
        <section className="rounded-2xl border p-4" style={{ borderColor: colors.borderSolid, background: colors.card }}>
          <label className="flex flex-wrap items-center gap-3">
            <span className="text-[12.5px] font-medium" style={{ color: colors.muted }}>{__ui("JSONPath 表达式")}</span>
            <Input value={path} onChange={(e) => setPath(e.target.value)} placeholder="$.data.list[0].name" className="w-72 font-mono text-[12.5px]" />
            <span className="text-[11.5px]" style={{ color: colors.muted }}>{__ui("示例：$.user.name、$.items[0]、$.items[*].id")}</span>
          </label>
        </section>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="flex min-w-0 flex-col rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
          <header className="mb-2.5 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-[13.5px] font-semibold" style={{ color: colors.text }}>
              <Braces size={15} /> {active.needsSecond ? __ui("第一个 JSON") : __ui("JSON 输入")}
            </h2>
            <Button size="sm" variant="ghost" onClick={() => setInput("")}>{__ui("清空")}</Button>
          </header>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={__ui("把 JSON 粘进来，例如\n{\n  \"name\": \"FurinaKit\",\n  \"version\": \"2.1.0\",\n  \"tools\": 182\n}")}
            className="h-64 w-full resize-y rounded-xl border p-3.5 font-mono text-[12.5px] leading-relaxed focus:outline-none"
            style={{ borderColor: colors.borderSolid, background: colors.bg, color: colors.text }}
          />
          {active.needsSecond && (
            <>
              <span className="mt-3 text-[12px] font-medium" style={{ color: colors.muted }}>{__ui("第二个 JSON（用于对比）")}</span>
              <textarea
                value={second}
                onChange={(e) => setSecond(e.target.value)}
                placeholder={__ui("把要对比的另一份 JSON 粘到这里")}
                className="mt-1.5 h-32 w-full resize-y rounded-xl border p-3.5 font-mono text-[12.5px] leading-relaxed focus:outline-none"
                style={{ borderColor: colors.borderSolid, background: colors.bg, color: colors.text }}
              />
            </>
          )}
        </section>

        <section className="flex min-w-0 flex-col rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
          <header className="mb-2.5 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-[13.5px] font-semibold" style={{ color: colors.text }}>
              <Check size={15} /> {__msg(active.name)} {__ui("结果")}</h2>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void copy()} disabled={!output}>
                <Copy size={13} /> {__ui("复制")}</Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={!output}
                onClick={() => {
                  const ext = ["java", "csharp", "go", "python"].includes(active.id) ? (active.id === "java" ? "java" : active.id === "csharp" ? "cs" : active.id === "go" ? "go" : "py") : active.id === "toml" ? "toml" : active.id === "ini" ? "ini" : "json";
                  const blob = new Blob([output], { type: "text/plain;charset=utf-8" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `json-result.${ext}`;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 4000);
                }}
              >
                <Download size={13} /> {__ui("下载")}</Button>
            </div>
          </header>
          <textarea
            value={output}
            readOnly
            placeholder={__ui("结果会显示在这里")}
            className="h-64 w-full resize-y rounded-xl border p-3.5 font-mono text-[12.5px] leading-relaxed focus:outline-none"
            style={{ borderColor: colors.borderSolid, background: colors.bg, color: colors.text }}
          />
          {error && (
            <p className={cn("mt-2.5 rounded-xl border p-3 text-[12px] leading-relaxed")} style={{ borderColor: `${colors.red}55`, color: colors.red, background: `${colors.red}0f` }}>
              {__msg(error)}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
