"use client";

/**
 * 函数图像（二维 + 三维）
 *
 * 功能对照并复刻自 https://graph-function.com/zh-hans/ （2026-09 抓取其 script.min.js 与
 * zh-hans 页面 data-* 文案后逐项对齐），并在其基础上补齐了该站没有的部分：
 *   - 该站有：多函数列表、函数 / 方程(隐函数) 两种类型、定义域限制、显示隐藏、15 色、
 *     X/Y 轴线性与对数切换、滚轮缩放、拖拽平移、轴拖动单轴缩放、回到原点、
 *     网格与刻度、鼠标悬停取点读数、快速示例、函数间互相引用。
 *   - 该站没有（本工具新增）：参数方程、极坐标、分段函数、零点/交点/极值/最值、
 *     数值导数与切线、定积分与面积阴影、渐近线、三维曲面（z=f(x,y) 与参数曲面）、
 *     高度着色、等高线、导出 PNG。
 *
 * 实现约束（与任务 brief 一致）：
 *   1. 零新依赖：二维为手写 Canvas 2D；三维为手写 WebGL1/2（自写顶点与片元着色器）。
 *   2. 表达式求值器自己写（tokenizer + 递归下降），**全程不使用 eval / new Function**。
 *   3. 所有非有限值（1/0、ln(-1)、sqrt(-1)、定义域外、NaN、Infinity）一律断开曲线。
 *
 * 文件结构：
 *   [A] 纯逻辑区（无任何 React/DOM 依赖，可整段抽出来在 Node 里跑单测）
 *   [B] 主题取色 + 二维 Canvas 渲染
 *   [C] 三维矩阵与 WebGL 渲染
 *   [D] 预设、子组件与导出组件 FunctionGraphTool
 */

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle, Check, Copy, Download, Eye, EyeOff, Plus, RotateCcw, Sigma, Trash2,
} from "lucide-react";
import { Badge, Button, Input, Label, Select } from "@/components/ui/primitives";
import { useToolDraft } from "@/lib/use-tool-draft";

/* ============================================================================
 * [A] 纯逻辑区 —— 表达式解析 / 数值分析 / 采样断点
 * 这一段不引用任何 React、DOM 或第三方模块，`math-graph-tools.test.mjs` 会把它整段
 * 抽出来转译后在 Node 里直接跑断言。
 * ========================================================================== */

/** 支持的函数表。min/max 为参数个数（含），log 单参数按常用约定以 10 为底。 */
// FK_PURE_BEGIN —— 以下到 FK_PURE_END 之间是纯逻辑，测试脚本会整段抽出来在 Node 里跑
const FN_TABLE: Record<string, { min: number; max: number; f: (a: number[]) => number }> = {
  sin: { min: 1, max: 1, f: (a) => Math.sin(a[0]) },
  cos: { min: 1, max: 1, f: (a) => Math.cos(a[0]) },
  tan: { min: 1, max: 1, f: (a) => Math.tan(a[0]) },
  asin: { min: 1, max: 1, f: (a) => Math.asin(a[0]) },
  acos: { min: 1, max: 1, f: (a) => Math.acos(a[0]) },
  atan: { min: 1, max: 1, f: (a) => Math.atan(a[0]) },
  sinh: { min: 1, max: 1, f: (a) => Math.sinh(a[0]) },
  cosh: { min: 1, max: 1, f: (a) => Math.cosh(a[0]) },
  tanh: { min: 1, max: 1, f: (a) => Math.tanh(a[0]) },
  asinh: { min: 1, max: 1, f: (a) => Math.asinh(a[0]) },
  acosh: { min: 1, max: 1, f: (a) => Math.acosh(a[0]) },
  atanh: { min: 1, max: 1, f: (a) => Math.atanh(a[0]) },
  exp: { min: 1, max: 1, f: (a) => Math.exp(a[0]) },
  ln: { min: 1, max: 1, f: (a) => Math.log(a[0]) },
  log: { min: 1, max: 2, f: (a) => (a.length === 1 ? Math.log10(a[0]) : Math.log(a[0]) / Math.log(a[1])) },
  log2: { min: 1, max: 1, f: (a) => Math.log2(a[0]) },
  log10: { min: 1, max: 1, f: (a) => Math.log10(a[0]) },
  sqrt: { min: 1, max: 1, f: (a) => Math.sqrt(a[0]) },
  cbrt: { min: 1, max: 1, f: (a) => Math.cbrt(a[0]) },
  abs: { min: 1, max: 1, f: (a) => Math.abs(a[0]) },
  sign: { min: 1, max: 1, f: (a) => Math.sign(a[0]) },
  floor: { min: 1, max: 1, f: (a) => Math.floor(a[0]) },
  ceil: { min: 1, max: 1, f: (a) => Math.ceil(a[0]) },
  round: { min: 1, max: 1, f: (a) => Math.round(a[0]) },
  min: { min: 1, max: Infinity, f: (a) => Math.min(...a) },
  max: { min: 1, max: Infinity, f: (a) => Math.max(...a) },
  mod: { min: 2, max: 2, f: (a) => a[0] - a[1] * Math.floor(a[0] / a[1]) },
  pow: { min: 2, max: 2, f: (a) => Math.pow(a[0], a[1]) },
  atan2: { min: 2, max: 2, f: (a) => Math.atan2(a[0], a[1]) },
  hypot: { min: 1, max: Infinity, f: (a) => Math.hypot(...a) },
};

/** 常量表。π / τ 同时接受符号与英文名。 */
const CONST_TABLE: Record<string, number> = {
  pi: Math.PI, "π": Math.PI, tau: Math.PI * 2, "τ": Math.PI * 2, e: Math.E,
};

/** 分段函数里表示「其余情况」的关键字。 */
const PIECE_ELSE_KEYWORDS = ["otherwise", "else"];

/** 可能出现在表达式里的“变量名”，用于给出比“未知符号”更具体的人话错误。 */
const RESERVED_VARS = ["theta", "θ", "x", "y", "t", "u", "v", "f1", "f2", "f3", "f4", "f5", "f6", "f7", "f8"];

export interface ExprIssue {
  /** 人话错误，例如「第 5 个字符附近多了一个“*”运算符」 */
  message: string;
  /** 出错位置（0 基字符下标，-1 表示与位置无关） */
  position: number;
  /** 带插入符的完整提示，直接丢进界面上那套红色错误条即可 */
  pretty: string;
}

type TokenKind =
  | "num" | "name" | "op" | "lparen" | "rparen" | "comma" | "lbrace" | "rbrace" | "colon" | "eof";

interface Token {
  kind: TokenKind;
  text: string;
  pos: number;
  value?: number;
}

type Ast =
  | { t: "num"; v: number }
  | { t: "var"; name: string; pos: number }
  | { t: "call"; name: string; args: Ast[]; pos: number }
  | { t: "bin"; op: string; l: Ast; r: Ast }
  | { t: "neg"; e: Ast }
  | { t: "piece"; parts: { cond: Ast | null; value: Ast }[] };

export interface CompiledProgram {
  ok: true;
  /** 变量插槽顺序；调用 run(env) 时 env 的下标与之一一对应 */
  vars: string[];
  run: (env: number[]) => number;
  source: string;
}

export interface CompileFailure {
  ok: false;
  issue: ExprIssue;
}

export type CompileResult = CompiledProgram | CompileFailure;

class ExprError extends Error {
  readonly issue: ExprIssue;
  constructor(issue: ExprIssue) {
    super(issue.message);
    this.issue = issue;
  }
}

/** 把「第 N 个字符」+ 原文 + 插入符拼成一段可直接显示的提示。 */
export function formatIssue(message: string, position: number, source: string): string {
  if (position < 0) return message;
  const caret = " ".repeat(Math.max(0, position)) + "^";
  return `${message}\n${source}\n${caret}`;
}

const nameStartRe = /[A-Za-z_\u0370-\u03ff]/;
const namePartRe = /[A-Za-z0-9_\u0370-\u03ff]/;

function knownNames(vars: string[]): string[] {
  const set = new Set<string>();
  for (const k of Object.keys(FN_TABLE)) set.add(k);
  for (const k of Object.keys(CONST_TABLE)) set.add(k);
  for (const k of PIECE_ELSE_KEYWORDS) set.add(k);
  for (const k of vars) set.add(k);
  // 长名优先，保证 log10 不会被拆成 log + 10
  return Array.from(set).sort((a, b) => b.length - a.length || a.localeCompare(b));
}

/**
 * 把一个“不认识的标识符”按已知名字贪心拆开，实现隐式乘法里最容易踩坑的 `xy` / `2xy`。
 * 拆不开返回 null（调用方给出错误）。
 */
function splitIdentifier(raw: string, known: string[]): string[] | null {
  const out: string[] = [];
  let i = 0;
  while (i < raw.length) {
    let matched = "";
    for (const k of known) {
      if (k.length <= raw.length - i && raw.startsWith(k, i)) { matched = k; break; }
    }
    if (!matched) return null;
    out.push(matched);
    i += matched.length;
  }
  return out;
}

/** 词法分析：数字、标识符（含隐式乘法拆分）、运算符、括号、花括号分段语法。 */
function tokenize(source: string, vars: string[]): Token[] {
  const known = knownNames(vars);
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") { i += 1; continue; }
    if (ch >= "0" && ch <= "9" || (ch === "." && source[i + 1] >= "0" && source[i + 1] <= "9")) {
      const start = i;
      while (i < source.length && source[i] >= "0" && source[i] <= "9") i += 1;
      if (source[i] === ".") { i += 1; while (i < source.length && source[i] >= "0" && source[i] <= "9") i += 1; }
      if (source[i] === "e" || source[i] === "E") {
        const save = i;
        let j = i + 1;
        if (source[j] === "+" || source[j] === "-") j += 1;
        if (source[j] >= "0" && source[j] <= "9") {
          i = j;
          while (i < source.length && source[i] >= "0" && source[i] <= "9") i += 1;
        } else {
          i = save;
        }
      }
      const text = source.slice(start, i);
      const value = Number(text);
      if (!Number.isFinite(value)) {
        throw new ExprError({
          message: `第 ${start + 1} 个字符的“${text}”不是一个有效的数字`,
          position: start,
          pretty: formatIssue(`第 ${start + 1} 个字符的“${text}”不是一个有效的数字`, start, source),
        });
      }
      tokens.push({ kind: "num", text, pos: start, value });
      continue;
    }
    if (nameStartRe.test(ch)) {
      const start = i;
      while (i < source.length && namePartRe.test(source[i])) i += 1;
      const raw = source.slice(start, i);
      if (Object.prototype.hasOwnProperty.call(FN_TABLE, raw) || Object.prototype.hasOwnProperty.call(CONST_TABLE, raw) || vars.includes(raw)) {
        tokens.push({ kind: "name", text: raw, pos: start });
      } else {
        const parts = splitIdentifier(raw, known);
        if (parts) {
          let cursor = start;
          for (const p of parts) {
            tokens.push({ kind: "name", text: p, pos: cursor });
            cursor += p.length;
          }
        } else {
          const isReserved = RESERVED_VARS.includes(raw);
          const msg = isReserved
            ? `第 ${start + 1} 个字符的“${raw}”在当前模式里不能当变量用（这里只能用 ${vars.join("、") || "常量"}）`
            : `第 ${start + 1} 个字符的“${raw}”不是认识的函数、常量或变量`;
          throw new ExprError({ message: msg, position: start, pretty: formatIssue(msg, start, source) });
        }
      }
      continue;
    }
    const two = source.slice(i, i + 2);
    if (two === "<=" || two === ">=" || two === "==" || two === "!=") {
      tokens.push({ kind: "op", text: two, pos: i });
      i += 2;
      continue;
    }
    if ("+-*/^%<>=".includes(ch)) {
      tokens.push({ kind: "op", text: ch, pos: i });
      i += 1;
      continue;
    }
    if (ch === "(") { tokens.push({ kind: "lparen", text: ch, pos: i }); i += 1; continue; }
    if (ch === ")") { tokens.push({ kind: "rparen", text: ch, pos: i }); i += 1; continue; }
    if (ch === ",") { tokens.push({ kind: "comma", text: ch, pos: i }); i += 1; continue; }
    if (ch === "{") { tokens.push({ kind: "lbrace", text: ch, pos: i }); i += 1; continue; }
    if (ch === "}") { tokens.push({ kind: "rbrace", text: ch, pos: i }); i += 1; continue; }
    if (ch === ":") { tokens.push({ kind: "colon", text: ch, pos: i }); i += 1; continue; }
    const msg = `第 ${i + 1} 个字符“${ch}”看不懂，请检查是不是打错了`;
    throw new ExprError({ message: msg, position: i, pretty: formatIssue(msg, i, source) });
  }
  tokens.push({ kind: "eof", text: "", pos: source.length });
  return tokens;
}

function isBinaryOp(tok: Token | undefined): boolean {
  return !!tok && tok.kind === "op" && ["+", "-", "*", "/", "^", "%", "<", ">", "<=", ">=", "==", "!="].includes(tok.text);
}

class Parser {
  private i = 0;
  constructor(private readonly tokens: Token[], private readonly source: string) {}

  private peek(offset = 0): Token {
    return this.tokens[Math.min(this.i + offset, this.tokens.length - 1)];
  }

  private next(): Token {
    const t = this.tokens[this.i];
    if (this.i < this.tokens.length - 1) this.i += 1;
    return t;
  }

  private fail(message: string, pos: number): never {
    throw new ExprError({ message, position: pos, pretty: formatIssue(message, pos, this.source) });
  }

  parseTop(): Ast {
    if (this.peek().kind === "eof") this.fail("表达式是空的，先输入一个函数吧", -1);
    const left = this.parseCompare();
    if (this.peek().kind === "op" && this.peek().text === "=") {
      // 隐函数常见的 x^2+y^2=1 写法：等价于 x^2+y^2-1
      this.next();
      const right = this.parseCompare();
      if (this.peek().kind === "op" && this.peek().text === "=") {
        this.fail("一个表达式里只能有一个等号", this.peek().pos);
      }
      if (this.peek().kind !== "eof") {
        this.fail(`第 ${this.peek().pos + 1} 个字符后面的“${this.peek().text}”没看懂`, this.peek().pos);
      }
      return { t: "bin", op: "-", l: left, r: right };
    }
    if (this.peek().kind !== "eof") {
      const bad = this.peek();
      const extra = bad.kind === "rparen"
        ? `第 ${bad.pos + 1} 个字符附近多了一个右括号“)”`
        : bad.kind === "rbrace"
          ? `第 ${bad.pos + 1} 个字符附近多了一个右花括号“}”`
          : `第 ${bad.pos + 1} 个字符附近的“${bad.text}”没看懂`;
      this.fail(extra, bad.pos);
    }
    return left;
  }

  private parseCompare(): Ast {
    let left = this.parseAdd();
    while (this.peek().kind === "op" && ["<", ">", "<=", ">=", "==", "!="].includes(this.peek().text)) {
      const op = this.next();
      const right = this.parseAdd();
      left = { t: "bin", op: op.text, l: left, r: right };
    }
    return left;
  }

  private parseAdd(): Ast {
    let left = this.parseMul();
    while (this.peek().kind === "op" && (this.peek().text === "+" || this.peek().text === "-")) {
      const op = this.next();
      const right = this.parseMul();
      left = { t: "bin", op: op.text, l: left, r: right };
    }
    return left;
  }

  private startsPrimary(tok: Token): boolean {
    return tok.kind === "num" || tok.kind === "name" || tok.kind === "lparen" || tok.kind === "lbrace";
  }

  /** 乘法层同时负责显式 `* / %` 与隐式乘法（2x、3sin(x)、xy、(x+1)(x-1)）。 */
  private parseMul(): Ast {
    let left = this.parseUnary();
    for (;;) {
      const tok = this.peek();
      if (tok.kind === "op" && (tok.text === "*" || tok.text === "/" || tok.text === "%")) {
        this.next();
        const right = this.parseUnary();
        left = { t: "bin", op: tok.text, l: left, r: right };
        continue;
      }
      if (this.startsPrimary(tok)) {
        const right = this.parseUnary();
        left = { t: "bin", op: "*", l: left, r: right };
        continue;
      }
      return left;
    }
  }

  private parseUnary(): Ast {
    const tok = this.peek();
    if (tok.kind === "op" && (tok.text === "-" || tok.text === "+")) {
      this.next();
      const e = this.parseUnary();
      return tok.text === "-" ? { t: "neg", e } : e;
    }
    return this.parsePower();
  }

  private parsePower(): Ast {
    const base = this.parsePrimary();
    const tok = this.peek();
    if (tok.kind === "op" && tok.text === "^") {
      this.next();
      const exp = this.parseUnary();
      return { t: "bin", op: "^", l: base, r: exp };
    }
    return base;
  }

  private parsePrimary(): Ast {
    const tok = this.peek();
    if (tok.kind === "num") { this.next(); return { t: "num", v: tok.value as number }; }
    if (tok.kind === "name") {
      this.next();
      if (PIECE_ELSE_KEYWORDS.includes(tok.text)) {
        this.fail(`第 ${tok.pos + 1} 个字符：“${tok.text}”只能写在分段函数的花括号里，比如 {(x<0): -x, otherwise: x}`, tok.pos);
      }
      if (Object.prototype.hasOwnProperty.call(FN_TABLE, tok.text)) {
        if (this.peek().kind !== "lparen") {
          this.fail(`第 ${tok.pos + 1} 个字符：函数 ${tok.text} 后面要写上括号，比如 ${tok.text}(x)`, tok.pos);
        }
        this.next();
        const args: Ast[] = [];
        if (this.peek().kind !== "rparen") {
          args.push(this.parseCompare());
          while (this.peek().kind === "comma") { this.next(); args.push(this.parseCompare()); }
        }
        const close = this.peek();
        if (close.kind !== "rparen") {
          this.fail(`第 ${close.pos + 1} 个字符这里少了一个右括号“)”`, close.pos);
        }
        this.next();
        const spec = FN_TABLE[tok.text];
        if (args.length < spec.min || args.length > spec.max) {
          const want = spec.max === Infinity ? `至少 ${spec.min}` : spec.min === spec.max ? `${spec.min}` : `${spec.min}~${spec.max}`;
          this.fail(`函数 ${tok.text} 需要 ${want} 个参数，这里给了 ${args.length} 个`, tok.pos);
        }
        return { t: "call", name: tok.text, args, pos: tok.pos };
      }
      if (Object.prototype.hasOwnProperty.call(CONST_TABLE, tok.text)) {
        return { t: "num", v: CONST_TABLE[tok.text] };
      }
      return { t: "var", name: tok.text, pos: tok.pos };
    }
    if (tok.kind === "lparen") {
      this.next();
      const inner = this.parseCompare();
      const close = this.peek();
      if (close.kind !== "rparen") {
        this.fail(`第 ${close.pos + 1} 个字符这里少了一个右括号“)”`, close.pos);
      }
      this.next();
      return inner;
    }
    if (tok.kind === "lbrace") {
      this.next();
      const parts: { cond: Ast | null; value: Ast }[] = [];
      for (;;) {
        if (this.peek().kind === "rbrace") {
          if (parts.length === 0) this.fail("分段函数的花括号里是空的", tok.pos);
          this.next();
          return { t: "piece", parts };
        }
        const head = this.peek();
        if (head.kind === "name" && PIECE_ELSE_KEYWORDS.includes(head.text)) {
          // otherwise: 值 —— 前面所有条件都不成立时使用
          this.next();
          if (this.peek().kind !== "colon") {
            this.fail(`第 ${this.peek().pos + 1} 个字符这里少了一个冒号“:”（写成 otherwise: 值）`, this.peek().pos);
          }
          this.next();
          parts.push({ cond: null, value: this.parseCompare() });
        } else {
          const first = this.parseCompare();
          if (this.peek().kind === "colon") {
            this.next();
            const value = this.parseCompare();
            parts.push({ cond: first, value });
          } else {
            parts.push({ cond: null, value: first });
          }
        }
        if (this.peek().kind === "comma") { this.next(); continue; }
        if (this.peek().kind === "rbrace") { this.next(); return { t: "piece", parts }; }
        const bad = this.peek();
        this.fail(`第 ${bad.pos + 1} 个字符这里少了一个右括号“}”`, bad.pos);
      }
    }
    if (tok.kind === "eof") {
      this.fail("表达式还没写完：这里应该还有一个数或变量", Math.max(0, this.source.length - 1));
    }
    const prev = this.tokens[Math.max(0, this.i - 1)];
    if (isBinaryOp(tok) && isBinaryOp(prev)) {
      this.fail(`第 ${tok.pos + 1} 个字符附近多了一个“${tok.text}”运算符，是不是连着写了两个运算符？`, tok.pos);
    }
    if (isBinaryOp(tok)) {
      this.fail(`第 ${tok.pos + 1} 个字符附近的“${tok.text}”放错位置了：这里需要一个数或变量`, tok.pos);
    }
    if (tok.kind === "rparen") this.fail(`第 ${tok.pos + 1} 个字符附近多了一个右括号“)”`, tok.pos);
    if (tok.kind === "comma") this.fail(`第 ${tok.pos + 1} 个字符附近多了一个逗号“,”`, tok.pos);
    if (tok.kind === "colon") this.fail(`第 ${tok.pos + 1} 个字符附近多了一个冒号“:”`, tok.pos);
    if (tok.kind === "rbrace") this.fail(`第 ${tok.pos + 1} 个字符附近多了一个右花括号“}”`, tok.pos);
    this.fail(`第 ${tok.pos + 1} 个字符附近的内容看不懂`, tok.pos);
  }
}

/** 把 AST 编译成闭包（比每次走 switch 快，且天然杜绝 eval）。 */
function compileAst(node: Ast, slotOf: Record<string, number>): (env: number[]) => number {
  switch (node.t) {
    case "num": {
      const v = node.v;
      return () => v;
    }
    case "var": {
      const idx = slotOf[node.name];
      return (env) => {
        const v = env[idx];
        return typeof v === "number" ? v : NaN;
      };
    }
    case "neg": {
      const e = compileAst(node.e, slotOf);
      return (env) => -e(env);
    }
    case "bin": {
      const l = compileAst(node.l, slotOf);
      const r = compileAst(node.r, slotOf);
      switch (node.op) {
        case "+": return (env) => l(env) + r(env);
        case "-": return (env) => l(env) - r(env);
        case "*": return (env) => l(env) * r(env);
        case "/": return (env) => l(env) / r(env);
        case "%": return (env) => l(env) % r(env);
        case "^": return (env) => Math.pow(l(env), r(env));
        case "<": return (env) => (l(env) < r(env) ? 1 : 0);
        case ">": return (env) => (l(env) > r(env) ? 1 : 0);
        case "<=": return (env) => (l(env) <= r(env) ? 1 : 0);
        case ">=": return (env) => (l(env) >= r(env) ? 1 : 0);
        case "==": return (env) => (l(env) === r(env) ? 1 : 0);
        case "!=": return (env) => (l(env) !== r(env) ? 1 : 0);
        default: return () => NaN;
      }
    }
    case "call": {
      const name = node.name;
      const spec = FN_TABLE[name];
      if (node.args.length === 1) {
        const a0 = compileAst(node.args[0], slotOf);
        const buf = [0];
        return (env) => { buf[0] = a0(env); return spec.f(buf); };
      }
      if (node.args.length === 2 && spec.max === 2) {
        const a0 = compileAst(node.args[0], slotOf);
        const a1 = compileAst(node.args[1], slotOf);
        const buf = [0, 0];
        return (env) => { buf[0] = a0(env); buf[1] = a1(env); return spec.f(buf); };
      }
      const argFns = node.args.map((a) => compileAst(a, slotOf));
      return (env) => {
        const arr = new Array<number>(argFns.length);
        for (let k = 0; k < argFns.length; k += 1) arr[k] = argFns[k](env);
        return spec.f(arr);
      };
    }
    case "piece": {
      const parts = node.parts.map((p) => ({
        cond: p.cond ? compileAst(p.cond, slotOf) : null,
        value: compileAst(p.value, slotOf),
      }));
      return (env) => {
        for (const p of parts) {
          if (p.cond === null) return p.value(env);
          const c = p.cond(env);
          if (Number.isFinite(c) && c !== 0) return p.value(env);
        }
        // 所有分支都不成立：返回 NaN，曲线在这里自然断开（这正是分段函数想要的效果）
        return NaN;
      };
    }
    default:
      return () => NaN;
  }
}

/**
 * 解析并编译一个表达式。
 *
 * 语法要点（界面上也写了同样的提示）：
 *   - 运算符优先级：比较 < 加减 < 乘除取余+隐式乘法 < 一元正负 < 乘方（右结合）。
 *     所以 `-2^2 = -4`、`2^3^2 = 512`、`1/2x = (1/2)*x`。
 *   - 隐式乘法：`2x`、`3sin(x)`、`xy`、`2(x+1)`、`(x+1)(x-1)` 都可直接写。
 *   - 函数名后面必须带括号：写 `sinx` 会提示「函数 sin 后面要写上括号」。
 *   - 分段函数：`{(x<0): -x, (x>=0): x}`，也可用 `otherwise: 值` 或直接以值结尾。
 */
export function compileExpression(source: string, variables: string[]): CompileResult {
  const src = source.trim();
  if (!src) {
    const issue: ExprIssue = { message: "表达式是空的，先输入一个函数吧", position: -1, pretty: "表达式是空的，先输入一个函数吧" };
    return { ok: false, issue };
  }
  try {
    const tokens = tokenize(src, variables);
    const ast = new Parser(tokens, src).parseTop();
    const slotOf: Record<string, number> = {};
    variables.forEach((v, idx) => { slotOf[v] = idx; });
    return { ok: true, vars: [...variables], run: compileAst(ast, slotOf), source: src };
  } catch (e) {
    if (e instanceof ExprError) return { ok: false, issue: e.issue };
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, issue: { message, position: -1, pretty: message } };
  }
}

/** 单变量快捷求值（测试与简单调用用）。 */
export function evalProgram(program: CompiledProgram, values: Record<string, number>): number {
  const env = program.vars.map((v) => (Object.prototype.hasOwnProperty.call(values, v) ? values[v] : NaN));
  return program.run(env);
}

/** 数值导数：中心差分，步长按 |x| 缩放，兼顾大数与小数。 */
export function derivative(fn: (x: number) => number, x: number, h?: number): number {
  const step = h ?? Math.max(1e-7, Math.abs(x) * 1e-7);
  const a = fn(x - step);
  const b = fn(x + step);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return NaN;
  return (b - a) / (2 * step);
}

/* ---------------------------- 采样与断点 ---------------------------- */

export interface SamplePoint { x: number; y: number }
export interface CurvePath { points: SamplePoint[] }

export interface SampleStats {
  /** 因不连续（极点/跳变）主动断开的次数 */
  breaks: number;
  /** 因非有限值（NaN / ±Infinity / 越界）被丢弃的采样点个数 */
  invalid: number;
  /** 相邻采样点之间最大的 |Δy|（世界坐标），用来说明“跳变有多大” */
  maxJump: number;
  /** 最大跳变发生的位置 */
  maxJumpAt: number;
  /** 实际参与绘制的采样点数 */
  points: number;
  /** 分段细化探测被触发（怀疑有断点）的次数 */
  probes: number;
}

export interface SampleResult {
  paths: CurvePath[];
  stats: SampleStats;
}

export interface SampleOptions {
  /** 采样点个数，默认 1600 */
  count?: number;
  /** y 方向“每世界单位对应多少屏幕像素”，用于把跳变换算成像素，默认 1 */
  yScale?: number;
  /** 竖直跳变超过多少像素才开始怀疑不连续，默认 800 */
  jumpPx?: number;
  /** 硬性范围保护，绝对值超过它就丢弃，默认 1e12 */
  maxAbsValue?: number;
  domainMin?: number | null;
  domainMax?: number | null;
  logY?: boolean;
}

export const SAMPLE_DEFAULTS = { count: 1600, jumpPx: 800, maxAbsValue: 1e12, refine: 16, refineRatio: 0.5 };

/**
 * 采样一条曲线并给出「应该断开」的位置。
 *
 * 断点判定（比参照站点更严格：该站只判非有限值，所以 tan(x) 在 π/2 会画出一条穿屏竖线）：
 *   1. 非有限值 / |y| 超界 / 对数坐标下 y<=0 / 超出定义域 —— 直接断开；
 *   2. 相邻两点发生变号、且屏幕竖直跳变超过 jumpPx 像素时，**在区间内再细化 16 个采样点**：
 *      若细化后仍然存在超过“总跳变一半”的单步跳变，说明它是一条不连续的极线（如 tan、1/x）；
 *      若跳变按比例缩小，说明只是很陡的连续函数（如 1000x），照常连线。
 *      这一步专门用来避免把陡峭的连续曲线误判成断点。
 */
export function sampleCurve(
  fn: (x: number) => number,
  xmin: number,
  xmax: number,
  options: SampleOptions = {},
): SampleResult {
  const count = Math.max(2, Math.floor(options.count ?? SAMPLE_DEFAULTS.count));
  const yScale = options.yScale ?? 1;
  const jumpPx = options.jumpPx ?? SAMPLE_DEFAULTS.jumpPx;
  const maxAbsValue = options.maxAbsValue ?? SAMPLE_DEFAULTS.maxAbsValue;
  const dMin = options.domainMin ?? null;
  const dMax = options.domainMax ?? null;
  const logY = options.logY ?? false;

  const stats: SampleStats = { breaks: 0, invalid: 0, maxJump: 0, maxJumpAt: NaN, points: 0, probes: 0 };
  const paths: CurvePath[] = [];
  let current: SamplePoint[] = [];
  /** 真正落盘的曲线段数；断点数 = 段数 - 1 */
  let pushed = 0;
  const push = () => {
    if (current.length >= 2) { paths.push({ points: current }); pushed += 1; }
    current = [];
  };

  const inDomain = (x: number) => (dMin === null || x >= dMin) && (dMax === null || x <= dMax);
  const usable = (y: number): boolean => {
    if (!Number.isFinite(y)) return false;
    if (Math.abs(y) > maxAbsValue) return false;
    if (logY && y <= 0) return false;
    return true;
  };

  const step = (xmax - xmin) / count;
  const raw: number[] = new Array(count + 1).fill(NaN);
  for (let i = 0; i <= count; i += 1) {
    const x = xmin + i * step;
    if (!inDomain(x)) continue;
    let y: number;
    try { y = fn(x); } catch { y = NaN; }
    if (!usable(y)) { stats.invalid += 1; continue; }
    raw[i] = y;
  }

  for (let i = 0; i <= count; i += 1) {
    const x = xmin + i * step;
    const y = raw[i];
    if (!Number.isFinite(y)) { push(); continue; }
    const prevIdx = i - 1;
    const prevY = prevIdx >= 0 ? raw[prevIdx] : NaN;
    if (Number.isFinite(prevY)) {
      const jump = Math.abs(y - prevY);
      if (jump > stats.maxJump) { stats.maxJump = jump; stats.maxJumpAt = x; }
      const signFlip = (y > 0 && prevY < 0) || (y < 0 && prevY > 0);
      if (signFlip && jump * yScale > jumpPx) {
        stats.probes += 1;
        const xa = xmin + prevIdx * step;
        const refine = SAMPLE_DEFAULTS.refine;
        const subStep = (x - xa) / refine;
        let maxSub = 0;
        let subFinite = true;
        let lastY = prevY;
        for (let k = 1; k <= refine; k += 1) {
          const xs = xa + k * subStep;
          let ys: number;
          try { ys = fn(xs); } catch { ys = NaN; }
          if (!usable(ys)) { subFinite = false; break; }
          maxSub = Math.max(maxSub, Math.abs(ys - lastY));
          lastY = ys;
        }
        if (!subFinite || maxSub > jump * SAMPLE_DEFAULTS.refineRatio) {
          // 细化后跳变没有按比例缩小 -> 这是一条极线，抬笔断开
          push();
          continue;
        }
      }
    }
    current.push({ x, y });
    stats.points += 1;
  }
  push();
  // 断点数统一按“抬笔次数”给出：段数 - 1（与是极线、还是非有限值无关）
  stats.breaks = Math.max(0, pushed - 1);
  return { paths, stats };
}

/* ---------------------------- 坐标轴刻度 ---------------------------- */

/** 生成“好看”的刻度：1 / 2 / 5 × 10^k。 */
export function niceTicks(min: number, max: number, target = 10): { ticks: number[]; step: number } {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return { ticks: [], step: 1 };
  const raw = (max - min) / Math.max(1, target);
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const ticks: number[] = [];
  const start = Math.ceil(min / step) * step;
  for (let v = start; v <= max + step * 1e-9; v += step) {
    ticks.push(Math.abs(v) < step * 1e-9 ? 0 : v);
    if (ticks.length > 400) break;
  }
  return { ticks, step };
}

/** 坐标轴刻度文字：避免 0.30000000000000004 这种浮点尾巴。 */
export function formatTick(v: number, step: number): string {
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs >= 1e5 || abs < 1e-4) return v.toExponential(1).replace("e+", "e");
  const decimals = Math.max(0, Math.min(8, Math.ceil(-Math.log10(step)) + 1));
  return Number(v.toFixed(decimals)).toString();
}

/** 读数用：最多 6 位有效数字，去掉多余的 0。 */
export function formatNumber(v: number, digits = 6): string {
  if (!Number.isFinite(v)) return Number.isNaN(v) ? "无定义" : v > 0 ? "+∞" : "−∞";
  if (v === 0) return "0";
  const abs = Math.abs(v);
  if (abs >= 1e6 || abs < 1e-5) return v.toExponential(3);
  return String(Number(v.toPrecision(digits)));
}

/* ---------------------------- 数值分析 ---------------------------- */

export interface RootHit { x: number; y: number }
export interface ExtremumHit { x: number; y: number; kind: "max" | "min"; value: number }
export interface ObliqueAsymptote { m: number; b: number }
export interface AsymptoteResult { vertical: number[]; horizontal: number[]; oblique: ObliqueAsymptote[] }

export interface IntegrateResult { value: number; method: "simpson" | "trapezoid"; ok: boolean; panels: number }

const safeEval = (fn: (x: number) => number, x: number): number => {
  try { return fn(x); } catch { return NaN; }
};

/**
 * 求零点：先扫描变号区间，再二分逼近，最后用 |f(root)| 是否真的趋近 0 来剔除“极线”。
 * 这一步很关键——否则 tan(x) 在 π/2 的变号会被当成零点。
 */
export function findRoots(fn: (x: number) => number, xmin: number, xmax: number, samples = 2000): RootHit[] {
  const hits: RootHit[] = [];
  const step = (xmax - xmin) / samples;
  let prevX = xmin;
  let prevY = safeEval(fn, prevX);
  const accept = (x: number): void => {
    const y = safeEval(fn, x);
    const scale = Math.max(1, Math.abs(prevY));
    if (!Number.isFinite(y) || Math.abs(y) > 1e-6 * scale) return;
    if (hits.length > 0 && Math.abs(hits[hits.length - 1].x - x) < Math.abs(step) * 1e-3) return;
    hits.push({ x, y: 0 });
  };
  if (Number.isFinite(prevY) && prevY === 0) hits.push({ x: prevX, y: 0 });
  for (let i = 1; i <= samples; i += 1) {
    const x = xmin + i * step;
    const y = safeEval(fn, x);
    if (Number.isFinite(prevY) && Number.isFinite(y) && prevY !== 0 && y !== 0 && prevY * y < 0) {
      let a = prevX;
      let b = x;
      let fa = prevY;
      for (let k = 0; k < 200; k += 1) {
        const m = (a + b) / 2;
        const fm = safeEval(fn, m);
        if (!Number.isFinite(fm)) break;
        if (fm === 0) { a = m; b = m; break; }
        if (fa * fm < 0) { b = m; } else { a = m; fa = fm; }
      }
      accept((a + b) / 2);
    } else if (Number.isFinite(y) && y === 0) {
      hits.push({ x, y: 0 });
    }
    prevX = x;
    prevY = y;
  }
  return hits;
}

/** 求两条曲线的交点（对 f - g 求零点）。 */
export function findIntersections(
  f: (x: number) => number,
  g: (x: number) => number,
  xmin: number,
  xmax: number,
  samples = 2000,
): RootHit[] {
  return findRoots((x) => safeEval(f, x) - safeEval(g, x), xmin, xmax, samples);
}

/**
 * 求极值：离散扫描候选点后用黄金分割细化，再回代验证“左右都比它小（大）”，
 * 借此剔除极线附近被误判成极值的采样点。
 */
export function findExtrema(fn: (x: number) => number, xmin: number, xmax: number, samples = 2000): ExtremumHit[] {
  const y = new Array<number>(samples + 1);
  const step = (xmax - xmin) / samples;
  for (let i = 0; i <= samples; i += 1) y[i] = safeEval(fn, xmin + i * step);
  const out: ExtremumHit[] = [];
  const golden = (a: number, b: number, maximize: boolean, iters = 120): number => {
    const phi = (Math.sqrt(5) - 1) / 2;
    let lo = a;
    let hi = b;
    let c = hi - phi * (hi - lo);
    let d = lo + phi * (hi - lo);
    let fc = safeEval(fn, c);
    let fd = safeEval(fn, d);
    for (let i = 0; i < iters; i += 1) {
      const better = maximize ? fc > fd : fc < fd;
      if (better) { hi = d; d = c; fd = fc; c = hi - phi * (hi - lo); fc = safeEval(fn, c); }
      else { lo = c; c = d; fc = fd; d = lo + phi * (hi - lo); fd = safeEval(fn, d); }
    }
    return (lo + hi) / 2;
  };
  for (let i = 1; i < samples; i += 1) {
    const y0 = y[i - 1];
    const y1 = y[i];
    const y2 = y[i + 1];
    if (!Number.isFinite(y0) || !Number.isFinite(y1) || !Number.isFinite(y2)) continue;
    const isMax = y1 > y0 && y1 >= y2;
    const isMin = y1 < y0 && y1 <= y2;
    if (!isMax && !isMin) continue;
    const xx = golden(xmin + (i - 1) * step, xmin + (i + 1) * step, isMax);
    const yy = safeEval(fn, xx);
    if (!Number.isFinite(yy)) continue;
    const h = Math.max(step * 1e-3, Math.abs(xx) * 1e-9);
    const l = safeEval(fn, xx - h);
    const r = safeEval(fn, xx + h);
    if (!Number.isFinite(l) || !Number.isFinite(r)) continue;
    const ok = isMax ? yy >= l && yy >= r : yy <= l && yy <= r;
    if (!ok) continue;
    if (out.length > 0 && Math.abs(out[out.length - 1].x - xx) < step) continue;
    out.push({ x: xx, y: yy, kind: isMax ? "max" : "min", value: yy });
  }
  return out;
}

/**
 * 定积分：复合辛普森（n 必须为偶数）。遇到非有限值时退化为梯形法，
 * 并且只在有限值区间上累加，保证 1/x 这类函数也能给出可解释的面积。
 */
export function integrate(fn: (x: number) => number, a: number, b: number, n = 2000): IntegrateResult {
  const panels = n % 2 === 0 ? n : n + 1;
  if (!Number.isFinite(a) || !Number.isFinite(b) || panels < 2) {
    return { value: NaN, method: "simpson", ok: false, panels };
  }
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  const sign = b >= a ? 1 : -1;
  const h = (hi - lo) / panels;
  const vals = new Array<number>(panels + 1);
  let allFinite = true;
  for (let i = 0; i <= panels; i += 1) {
    const v = safeEval(fn, lo + i * h);
    vals[i] = v;
    if (!Number.isFinite(v)) allFinite = false;
  }
  if (allFinite) {
    let sum = vals[0] + vals[panels];
    for (let i = 1; i < panels; i += 1) sum += (i % 2 === 1 ? 4 : 2) * vals[i];
    return { value: (sign * sum * h) / 3, method: "simpson", ok: true, panels };
  }
  let sum = 0;
  let used = 0;
  for (let i = 0; i < panels; i += 1) {
    const y0 = vals[i];
    const y1 = vals[i + 1];
    if (!Number.isFinite(y0) || !Number.isFinite(y1)) continue;
    sum += ((y0 + y1) / 2) * h;
    used += 1;
  }
  return { value: sign * sum, method: "trapezoid", ok: used > 0, panels };
}

/**
 * 渐近线：
 *   - 竖直：在变号且跳变巨大的区间上用 1/f 二分（1/f 的零点就是 f 的极点），再回代验证 |f| 很大；
 *   - 水平：在 x = 1e2…1e6 上考察是否收敛；
 *   - 斜渐近线：先看 f(x)/x 是否收敛得到斜率 m，再看 f(x)-mx 是否收敛得到截距 b。
 */
export function findAsymptotes(fn: (x: number) => number, xmin: number, xmax: number, samples = 2000): AsymptoteResult {
  const vertical: number[] = [];
  const horizontal: number[] = [];
  const oblique: ObliqueAsymptote[] = [];
  const step = (xmax - xmin) / samples;
  const ys = new Array<number>(samples + 1);
  for (let i = 0; i <= samples; i += 1) ys[i] = safeEval(fn, xmin + i * step);

  const absOrZero = (v: number) => (Number.isFinite(v) ? Math.abs(v) : 0);

  /** 在 [x0,x1] 内用黄金分割最大化 |f|，收敛到极点位置。 */
  const locatePole = (x0: number, x1: number): number => {
    const phi = (Math.sqrt(5) - 1) / 2;
    const g = (x: number) => {
      const v = Math.abs(safeEval(fn, x));
      return Number.isFinite(v) ? v : 1e300;
    };
    let lo = x0;
    let hi = x1;
    let c = hi - phi * (hi - lo);
    let d = lo + phi * (hi - lo);
    let fc = g(c);
    let fd = g(d);
    for (let i = 0; i < 200; i += 1) {
      if (fc > fd) { hi = d; d = c; fd = fc; c = hi - phi * (hi - lo); fc = g(c); }
      else { lo = c; c = d; fc = fd; d = lo + phi * (hi - lo); fd = g(d); }
    }
    return (lo + hi) / 2;
  };

  for (let i = 0; i < samples; i += 1) {
    const x0 = xmin + i * step;
    const x1 = x0 + step;
    const y0 = ys[i];
    const y1 = ys[i + 1];
    const fin0 = Number.isFinite(y0);
    const fin1 = Number.isFinite(y1);
    if (fin0 && fin1 && !(y0 * y1 < 0)) continue;
    // 在区间内细采样：连续函数这里 |f| 不会突然比两端大一个数量级，真正的极线会
    let anyFinite = false;
    let maxProbe = 0;
    for (let k = 1; k <= 16; k += 1) {
      const v = Math.abs(safeEval(fn, x0 + ((x1 - x0) * k) / 17));
      if (Number.isFinite(v)) { anyFinite = true; if (v > maxProbe) maxProbe = v; }
    }
    if (!anyFinite) continue;
    const base = Math.max(fin0 ? Math.abs(y0) : 0, fin1 ? Math.abs(y1) : 0, 1);
    if (maxProbe <= base * 10) continue;
    const cand = locatePole(x0, x1);
    // 发散验证：步长缩小 10 倍后 |f| 还要再涨 3 倍以上，才算“越靠近越大”
    const d1 = Math.max(1e-6, Math.abs(step) * 0.25);
    const m1 = Math.max(absOrZero(safeEval(fn, cand - d1)), absOrZero(safeEval(fn, cand + d1)));
    const m2 = Math.max(absOrZero(safeEval(fn, cand - d1 / 10)), absOrZero(safeEval(fn, cand + d1 / 10)));
    if (Number.isFinite(m1) && Number.isFinite(m2) && m2 > 100 && m2 > m1 * 3
      && !vertical.some((v) => Math.abs(v - cand) < step * 10)) {
      vertical.push(cand);
    }
  }
  const converge = (g: (x: number) => number): number | null => {
    const xs = [1e2, 1e3, 1e4, 1e5, 1e6];
    const vs = xs.map(g);
    if (vs.some((v) => !Number.isFinite(v))) return null;
    const d: number[] = [];
    for (let i = 1; i < vs.length; i += 1) d.push(Math.abs(vs[i] - vs[i - 1]));
    const dFirst = d[0];
    const dLast = d[d.length - 1];
    // 相邻差值要按几何速度收敛（x 每乘 10，差值至少缩到 15%），并且最后一跳已经足够小
    const okGeom = dLast <= 0.15 * dFirst;
    const okAbs = dLast <= 1e-5 * Math.max(1, Math.abs(vs[vs.length - 1]));
    if (!(okGeom && okAbs)) return null;
    const last = vs[vs.length - 1];
    // 收敛到 0 附近的极限（如 1/x 的 y=0）受采样终点限制只能算到 ±1e-6 量级，
    // 落在收敛噪声里就归零，避免同一个 y=0 被当成上下两条不同的渐近线
    if (Math.abs(last) <= 10 * dLast) return 0;
    return last;
  };
  for (const dir of [1, -1]) {
    const at = (x: number) => safeEval(fn, dir * x);
    const L = converge(at);
    if (L !== null && Number.isFinite(L)) {
      if (Math.abs(L) < 1e6 && !horizontal.some((v) => Math.abs(v - L) < 1e-6 * Math.max(1, Math.abs(L)))) {
        horizontal.push(L);
      }
      continue;
    }
    const m = converge((x) => at(x) / (dir * x));
    if (m === null || !Number.isFinite(m) || Math.abs(m) < 1e-6) continue;
    const b = converge((x) => at(x) - m * dir * x);
    if (b === null || !Number.isFinite(b)) continue;
    if (!oblique.some((o) => Math.abs(o.m - m) < 1e-4 && Math.abs(o.b - b) < 1e-3)) {
      oblique.push({ m, b });
    }
  }
  return { vertical, horizontal, oblique };
}

/* ---------------------------- Marching Squares（隐函数 / 等高线） ---------------------------- */

export interface Segment { x1: number; y1: number; x2: number; y2: number }

/**
 * Marching Squares：把 F(x,y)=level 的等值线抽成线段。
 * 隐函数 F(x,y)=0 与三维等高线共用这一份实现。
 */
export function marchingSquares(
  f: (x: number, y: number) => number,
  xmin: number,
  xmax: number,
  ymin: number,
  ymax: number,
  res: number,
  level = 0,
): Segment[] {
  const nx = Math.max(2, Math.min(400, Math.floor(res)));
  const ny = nx;
  const dx = (xmax - xmin) / nx;
  const dy = (ymax - ymin) / ny;
  const grid: number[][] = new Array(nx + 1);
  for (let i = 0; i <= nx; i += 1) {
    const col = new Array<number>(ny + 1);
    const x = xmin + i * dx;
    for (let j = 0; j <= ny; j += 1) {
      const v = f(x, ymin + j * dy);
      col[j] = Number.isFinite(v) ? v : NaN;
    }
    grid[i] = col;
  }
  const out: Segment[] = [];
  const interp = (va: number, vb: number) => {
    const d = vb - va;
    if (!Number.isFinite(d) || d === 0) return 0.5;
    const t = (level - va) / d;
    return t < 0 ? 0 : t > 1 ? 1 : t;
  };
  for (let i = 0; i < nx; i += 1) {
    for (let j = 0; j < ny; j += 1) {
      const v00 = grid[i][j];
      const v10 = grid[i + 1][j];
      const v11 = grid[i + 1][j + 1];
      const v01 = grid[i][j + 1];
      if (!Number.isFinite(v00) || !Number.isFinite(v10) || !Number.isFinite(v11) || !Number.isFinite(v01)) continue;
      const x0 = xmin + i * dx;
      const x1 = x0 + dx;
      const y0 = ymin + j * dy;
      const y1 = y0 + dy;
      let idx = 0;
      if (v00 > level) idx |= 1;
      if (v10 > level) idx |= 2;
      if (v11 > level) idx |= 4;
      if (v01 > level) idx |= 8;
      if (idx === 0 || idx === 15) continue;
      const bottom: [number, number] = [x0 + dx * interp(v00, v10), y0];
      const right: [number, number] = [x1, y0 + dy * interp(v10, v11)];
      const top: [number, number] = [x0 + dx * interp(v01, v11), y1];
      const left: [number, number] = [x0, y0 + dy * interp(v00, v01)];
      const push = (a: [number, number], b: [number, number]) => {
        out.push({ x1: a[0], y1: a[1], x2: b[0], y2: b[1] });
      };
      switch (idx) {
        case 1: case 14: push(left, bottom); break;
        case 2: case 13: push(bottom, right); break;
        case 3: case 12: push(left, right); break;
        case 4: case 11: push(right, top); break;
        case 5: {
          const center = (v00 + v10 + v11 + v01) / 4;
          if (center > level) { push(left, top); push(bottom, right); }
          else { push(left, bottom); push(right, top); }
          break;
        }
        case 6: case 9: push(bottom, top); break;
        case 7: case 8: push(left, top); break;
        case 10: {
          const center = (v00 + v10 + v11 + v01) / 4;
          if (center > level) { push(left, bottom); push(right, top); }
          else { push(left, top); push(bottom, right); }
          break;
        }
        default: break;
      }
    }
  }
  return out;
}

// FK_PURE_END
/* ============================================================================
 * [B] 主题取色 + 二维 Canvas 渲染
 * ========================================================================== */

/**
 * 曲线配色。
 *
 * 这一组颜色是「数据色」而不是「界面色」：它标识的是哪条曲线（和导出的 PNG 一样属于
 * 用户内容），必须在浅色 / 深色 / 护眼三套主题下保持同一个含义，所以不能走主题变量
 * （否则同一个函数换个主题就变色了）。取值统一压在 L≈45%~58%、S≈55%~90%，
 * 保证在深色底（L=11%）、白底（L=100%）、护眼底（L=93%）上对比度都够。
 */
export const CURVE_COLORS = [
  "hsl(355 72% 56%)",
  "hsl(145 55% 42%)",
  "hsl(215 85% 58%)",
  "hsl(32 90% 50%)",
  "hsl(280 60% 62%)",
  "hsl(176 62% 40%)",
  "hsl(48 88% 46%)",
  "hsl(320 65% 58%)",
];

export interface ThemePalette {
  card: string;
  foreground: string;
  muted: string;
  border: string;
  primary: string;
  gridHsl: string;
  primaryHsl: string;
  foregroundHsl: string;
  isDark: boolean;
}

const FALLBACK_THEME: ThemePalette = {
  card: "hsl(221, 49%, 10%)",
  foreground: "hsl(210, 40%, 98%)",
  muted: "hsl(217, 20%, 61%)",
  border: "hsl(217, 33%, 17%)",
  primary: "hsl(197, 100%, 71%)",
  gridHsl: "217 33% 17%",
  primaryHsl: "197 100% 71%",
  foregroundHsl: "210 40% 98%",
  isDark: true,
};

/** 把 "217 33% 17%" 变成 canvas 认识的 "hsl(217, 33%, 17%)"。 */
export function hslVar(raw: string, fallback: string): string {
  const v = raw.trim();
  if (!v) return fallback;
  if (/^(#|rgb|hsl|oklch|lab|color\()/i.test(v)) return v;
  return `hsl(${v.replace(/\s+/g, ", ")})`;
}

/** 在同一个 HSL 三元组上叠加透明度，用于面积阴影 / 网格虚线。 */
export function withAlpha(hslTriple: string, alpha: number): string {
  return `hsla(${hslTriple.trim().replace(/\s+/g, ", ")}, ${alpha})`;
}

export function readThemePalette(el: HTMLElement | null): ThemePalette {
  if (!el || typeof window === "undefined") return FALLBACK_THEME;
  const cs = window.getComputedStyle(el);
  const raw = (name: string, fb: string) => cs.getPropertyValue(name).trim() || fb;
  const border = raw("--border", "217 33% 17%");
  const foreground = raw("--foreground", "210 40% 98%");
  const primary = raw("--primary", "197 100% 71%");
  const theme = el.getAttribute("data-theme") || "dark";
  return {
    card: hslVar(raw("--card", "221 49% 10%"), FALLBACK_THEME.card),
    foreground: hslVar(foreground, FALLBACK_THEME.foreground),
    muted: hslVar(raw("--muted-foreground", "217 20% 61%"), FALLBACK_THEME.muted),
    border: hslVar(border, FALLBACK_THEME.border),
    primary: hslVar(primary, FALLBACK_THEME.primary),
    gridHsl: border,
    primaryHsl: primary,
    foregroundHsl: foreground,
    isDark: theme === "dark",
  };
}

/** 主题切换（data-theme 变化）时通知画布重绘。 */
export function useThemeVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const el = document.documentElement;
    const observer = new MutationObserver(() => setVersion((v) => v + 1));
    observer.observe(el, { attributes: true, attributeFilter: ["data-theme", "class", "style"] });
    return () => observer.disconnect();
  }, []);
  return version;
}

/* ---------------------------- 数据类型 ---------------------------- */

export type CurveKind = "explicit" | "implicit" | "parametric" | "polar";

export interface Curve2D {
  id: string;
  kind: CurveKind;
  /** 显函数 y=f(x) / 隐函数 F(x,y)=0 / 极坐标 r(θ) 的表达式 */
  expr: string;
  /** 参数方程的 x(t) 与 y(t) */
  exprX: string;
  exprY: string;
  color: string;
  visible: boolean;
  /** 定义域限制（显函数专用），空串表示不限制 */
  domainMin: string;
  domainMax: string;
}

export interface ViewBounds { xmin: number; xmax: number; ymin: number; ymax: number }

export interface DisplayOpts {
  grid: boolean;
  ticks: boolean;
  xLog: boolean;
  yLog: boolean;
}

export interface AnalysisOpts {
  roots: boolean;
  intersections: boolean;
  extrema: boolean;
  tangent: boolean;
  tangentX: string;
  integral: boolean;
  integralA: string;
  integralB: string;
  asymptotes: boolean;
}

export interface AnalysisData {
  roots: { curve: number; x: number; y: number }[];
  intersections: { a: number; b: number; x: number; y: number }[];
  extrema: { curve: number; x: number; y: number; kind: "max" | "min" }[];
  integral: { curve: number; a: number; b: number; value: number; method: string } | null;
  asymptotes: { curve: number; vertical: number[]; horizontal: number[]; oblique: ObliqueAsymptote[] }[];
  tangent: { curve: number; x0: number; y0: number; slope: number } | null;
  /** 曲线上的采样错误（表达式问题），用于在界面上一次性说清 */
  issues: { curve: number; label: string; message: string }[];
}

export interface HoverPoint { sx: number; sy: number; x: number; y: number; curve: number }

/* ---------------------------- 坐标投影 ---------------------------- */

export interface Projector {
  sx: (x: number) => number;
  sy: (y: number) => number;
  wx: (sx: number) => number;
  wy: (sy: number) => number;
  xLog: boolean;
  yLog: boolean;
  ok: boolean;
}

const LOG_EPS = 1e-12;

export function makeProjector(view: ViewBounds, w: number, h: number, xLog: boolean, yLog: boolean): Projector {
  const x0 = xLog ? Math.log10(Math.max(view.xmin, LOG_EPS)) : view.xmin;
  const x1 = xLog ? Math.log10(Math.max(view.xmax, LOG_EPS)) : view.xmax;
  const y0 = yLog ? Math.log10(Math.max(view.ymin, LOG_EPS)) : view.ymin;
  const y1 = yLog ? Math.log10(Math.max(view.ymax, LOG_EPS)) : view.ymax;
  const xSpan = x1 - x0;
  const ySpan = y1 - y0;
  const ok = Number.isFinite(xSpan) && Number.isFinite(ySpan) && Math.abs(xSpan) > 0 && Math.abs(ySpan) > 0;
  const fx = (x: number) => (xLog ? Math.log10(Math.max(x, LOG_EPS)) : x);
  const fy = (y: number) => (yLog ? Math.log10(Math.max(y, LOG_EPS)) : y);
  return {
    sx: (x) => (ok ? ((fx(x) - x0) / xSpan) * w : NaN),
    sy: (y) => (ok ? h - ((fy(y) - y0) / ySpan) * h : NaN),
    wx: (px) => {
      const t = x0 + (px / w) * xSpan;
      return xLog ? Math.pow(10, t) : t;
    },
    wy: (py) => {
      const t = y0 + ((h - py) / h) * ySpan;
      return yLog ? Math.pow(10, t) : t;
    },
    xLog,
    yLog,
    ok,
  };
}

/* ---------------------------- 二维绘制 ---------------------------- */

export interface DrawCurveScene {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  view: ViewBounds;
  curves: Curve2D[];
  display: DisplayOpts;
  analysis: AnalysisOpts;
  data: AnalysisData | null;
  theme: ThemePalette;
  hover: HoverPoint | null;
  empty: boolean;
  /** 每个函数 id 的采样结果，由调用方缓存后传入（避免重绘时重算） */
  paths: Map<string, { paths: CurvePath[]; segments?: Segment[]; color: string; visible: boolean }>;
}

const FONT_SMALL = "11px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif";
const FONT_TINY = "10px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif";

/** canvas 对超大坐标的处理会变慢甚至出现伪影，统一夹到一个安全范围（内容本来也会被裁掉）。 */
function clampPx(v: number): number {
  return v < -1e5 ? -1e5 : v > 1e5 ? 1e5 : v;
}

/** 画一次完整的二维场景。所有颜色都来自主题变量，曲线色除外（那是数据色）。 */
export function drawGraph2D(scene: DrawCurveScene): void {
  const { ctx, width: w, height: h, view, display, theme, hover } = scene;
  ctx.save();
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = theme.card;
  ctx.fillRect(0, 0, w, h);

  const proj = makeProjector(view, w, h, display.xLog, display.yLog);
  if (!proj.ok) { ctx.restore(); return; }

  const xAxisY = proj.sy(display.yLog ? 1 : 0);
  const yAxisX = proj.sx(display.xLog ? 1 : 0);

  if (display.grid) {
    ctx.strokeStyle = theme.border;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.75;
    ctx.beginPath();
    const xt = niceTicks(view.xmin, view.xmax, Math.max(4, Math.round(w / 90)));
    const yt = niceTicks(view.ymin, view.ymax, Math.max(4, Math.round(h / 70)));
    for (const t of xt.ticks) {
      const px = Math.round(proj.sx(t)) + 0.5;
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
    }
    for (const t of yt.ticks) {
      const py = Math.round(proj.sy(t)) + 0.5;
      ctx.moveTo(0, py);
      ctx.lineTo(w, py);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  if (display.ticks) {
    ctx.font = FONT_TINY;
    ctx.fillStyle = theme.muted;
    const xt = niceTicks(view.xmin, view.xmax, Math.max(4, Math.round(w / 90)));
    const yt = niceTicks(view.ymin, view.ymax, Math.max(4, Math.round(h / 70)));
    const baseY = Math.min(h - 4, Math.max(12, xAxisY + 12));
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    for (const t of xt.ticks) {
      if (t === 0) continue;
      const px = proj.sx(t);
      if (px < 18 || px > w - 18) continue;
      ctx.fillText(formatTick(t, xt.step), px, baseY);
    }
    const baseX = Math.min(w - 6, Math.max(14, yAxisX - 6));
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (const t of yt.ticks) {
      if (t === 0) continue;
      const py = proj.sy(t);
      if (py < 12 || py > h - 12) continue;
      ctx.fillText(formatTick(t, yt.step), baseX, py);
    }
  }

  // 坐标轴
  ctx.strokeStyle = theme.muted;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  if (xAxisY >= -1 && xAxisY <= h + 1) {
    ctx.moveTo(0, Math.round(xAxisY) + 0.5);
    ctx.lineTo(w, Math.round(xAxisY) + 0.5);
  }
  if (yAxisX >= -1 && yAxisX <= w + 1) {
    ctx.moveTo(Math.round(yAxisX) + 0.5, 0);
    ctx.lineTo(Math.round(yAxisX) + 0.5, h);
  }
  ctx.stroke();

  // 轴名
  ctx.font = FONT_SMALL;
  ctx.fillStyle = theme.muted;
  ctx.textAlign = "right";
  ctx.textBaseline = "bottom";
  ctx.fillText("x", w - 6, Math.min(h - 2, Math.max(14, xAxisY - 4)));
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText("y", Math.min(w - 12, Math.max(6, yAxisX + 6)), 4);

  if (display.xLog || display.yLog) {
    ctx.font = FONT_TINY;
    ctx.fillStyle = theme.muted;
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText([display.xLog ? "X 轴对数" : "", display.yLog ? "Y 轴对数" : ""].filter(Boolean).join(" · ") + "（只画正值部分）", 6, 4);
  }

  // 渐近线（先画，压在曲线下面）
  if (scene.data && scene.analysis.asymptotes) {
    for (const a of scene.data.asymptotes) {
      ctx.save();
      ctx.strokeStyle = theme.muted;
      ctx.globalAlpha = 0.8;
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      for (const v of a.vertical) {
        const px = proj.sx(v);
        if (Number.isFinite(px) && px > -2000 && px < w + 2000) { ctx.moveTo(px, 0); ctx.lineTo(px, h); }
      }
      for (const v of a.horizontal) {
        const py = proj.sy(v);
        if (Number.isFinite(py) && py > -2000 && py < h + 2000) { ctx.moveTo(0, py); ctx.lineTo(w, py); }
      }
      for (const o of a.oblique) {
        const x1 = view.xmin;
        const x2 = view.xmax;
        const p1 = proj.sy(o.m * x1 + o.b);
        const p2 = proj.sy(o.m * x2 + o.b);
        if (Number.isFinite(p1) && Number.isFinite(p2)) { ctx.moveTo(proj.sx(x1), p1); ctx.lineTo(proj.sx(x2), p2); }
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  // 定积分面积阴影
  if (scene.data && scene.data.integral && scene.analysis.integral) {
    const integ = scene.data.integral;
    const entry = scene.paths.get(scene.curves[integ.curve]?.id ?? "");
    ctx.save();
    ctx.fillStyle = withAlpha(theme.primaryHsl, 0.22);
    ctx.beginPath();
    const a = Math.min(integ.a, integ.b);
    const b = Math.max(integ.a, integ.b);
    let started = false;
    if (entry) {
      for (const path of entry.paths) {
        for (const p of path.points) {
          if (p.x < a || p.x > b) continue;
          const px = proj.sx(p.x);
          const py = proj.sy(p.y);
          if (!Number.isFinite(px) || !Number.isFinite(py) || Math.abs(py) > 1e6) continue;
          if (!started) { ctx.moveTo(px, proj.sy(0)); ctx.lineTo(px, py); started = true; } else { ctx.lineTo(px, py); }
        }
      }
    }
    if (started) {
      ctx.lineTo(proj.sx(b), proj.sy(0));
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  // 曲线
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  for (const c of scene.curves) {
    if (!c.visible) continue;
    const entry = scene.paths.get(c.id);
    if (!entry) continue;
    ctx.strokeStyle = c.color;
    ctx.lineWidth = 2;
    if (entry.segments && entry.segments.length > 0) {
      // 隐函数：marching squares 产生的线段一次性放进同一条路径，只 stroke 一次
      ctx.beginPath();
      for (const s of entry.segments) {
        const x1 = proj.sx(s.x1);
        const y1 = proj.sy(s.y1);
        const x2 = proj.sx(s.x2);
        const y2 = proj.sy(s.y2);
        if (!Number.isFinite(x1) || !Number.isFinite(y1) || !Number.isFinite(x2) || !Number.isFinite(y2)) continue;
        ctx.moveTo(clampPx(x1), clampPx(y1));
        ctx.lineTo(clampPx(x2), clampPx(y2));
      }
      ctx.stroke();
      continue;
    }
    for (const path of entry.paths) {
      ctx.beginPath();
      let started = false;
      for (const p of path.points) {
        const px = proj.sx(p.x);
        const py = proj.sy(p.y);
        if (!Number.isFinite(px) || !Number.isFinite(py)) { started = false; continue; }
        const cx = clampPx(px);
        const cy = clampPx(py);
        if (!started) { ctx.moveTo(cx, cy); started = true; } else { ctx.lineTo(cx, cy); }
      }
      ctx.stroke();
    }
  }

  // 切线
  if (scene.data && scene.data.tangent && scene.analysis.tangent) {
    const t = scene.data.tangent;
    ctx.save();
    ctx.strokeStyle = theme.primary;
    ctx.lineWidth = 1.6;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    const yA = t.slope * (view.xmin - t.x0) + t.y0;
    const yB = t.slope * (view.xmax - t.x0) + t.y0;
    ctx.moveTo(proj.sx(view.xmin), proj.sy(yA));
    ctx.lineTo(proj.sx(view.xmax), proj.sy(yB));
    ctx.stroke();
    ctx.restore();
    markPoint(ctx, proj.sx(t.x0), proj.sy(t.y0), theme.primary, 3.6, theme.card);
  }

  // 零点 / 交点 / 极值标记
  if (scene.data) {
    if (scene.analysis.roots) {
      for (const r of scene.data.roots) markPoint(ctx, proj.sx(r.x), proj.sy(r.y), theme.primary, 3.2, theme.card);
    }
    if (scene.analysis.intersections) {
      for (const r of scene.data.intersections) markPoint(ctx, proj.sx(r.x), proj.sy(r.y), theme.foreground, 3.2, theme.card);
    }
    if (scene.analysis.extrema) {
      for (const e of scene.data.extrema) {
        markSquare(ctx, proj.sx(e.x), proj.sy(e.y), e.kind === "max" ? theme.primary : theme.muted, 3.2, theme.card);
      }
    }
  }

  // 悬停取点
  if (hover) markPoint(ctx, hover.sx, hover.sy, theme.foreground, 4, theme.card);

  // 空状态引导
  if (scene.empty) {
    ctx.font = "13px ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif";
    ctx.fillStyle = theme.muted;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("左栏还没有可画的函数，点「填入示例」看看效果", w / 2, h / 2);
  }
  ctx.restore();
}

function markPoint(ctx: CanvasRenderingContext2D, px: number, py: number, color: string, r: number, ring: string): void {
  if (!Number.isFinite(px) || !Number.isFinite(py)) return;
  if (Math.abs(px) > 1e5 || Math.abs(py) > 1e5) return;
  ctx.save();
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = ring;
  ctx.stroke();
  ctx.restore();
}

function markSquare(ctx: CanvasRenderingContext2D, px: number, py: number, color: string, r: number, ring: string): void {
  if (!Number.isFinite(px) || !Number.isFinite(py)) return;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(px, py - r);
  ctx.lineTo(px + r, py);
  ctx.lineTo(px, py + r);
  ctx.lineTo(px - r, py);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = ring;
  ctx.stroke();
  ctx.restore();
}

/* ============================================================================
 * [C] 三维：矩阵、几何构建、手写 WebGL 渲染
 *
 * 选 WebGL 而不是「2D canvas 投影 + 画家算法」的原因（报告里也写了）：
 * 1440×900 下 96×96 的曲面是 9216 个四边形；2D canvas 每帧要排序 + 填充近万个
 * 路径，实测只有个位数帧率。WebGL 把几何一次性传到显存后，旋转只需要更新一个
 * MVP 矩阵 uniform，CPU 每帧几乎零开销，因此拖动时能稳稳超过 30fps。
 * 万一环境拿不到 WebGL 上下文，会退化成 2D canvas 的线框投影（带深度排序），
 * 保证功能不会整个不可用。
 * ========================================================================== */

export type Mat4 = Float32Array;

export function mat4Identity(): Mat4 {
  const m = new Float32Array(16);
  m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
  return m;
}

export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c += 1) {
    for (let r = 0; r < 4; r += 1) {
      out[c * 4 + r] =
        a[r] * b[c * 4] +
        a[4 + r] * b[c * 4 + 1] +
        a[8 + r] * b[c * 4 + 2] +
        a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

export function mat4Perspective(fovY: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

export function mat4LookAt(eye: number[], center: number[], up: number[]): Mat4 {
  let zx = eye[0] - center[0];
  let zy = eye[1] - center[1];
  let zz = eye[2] - center[2];
  let len = Math.hypot(zx, zy, zz) || 1;
  zx /= len; zy /= len; zz /= len;
  let xx = up[1] * zz - up[2] * zy;
  let xy = up[2] * zx - up[0] * zz;
  let xz = up[0] * zy - up[1] * zx;
  len = Math.hypot(xx, xy, xz) || 1;
  xx /= len; xy /= len; xz /= len;
  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  const m = new Float32Array(16);
  m[0] = xx; m[1] = yx; m[2] = zx; m[3] = 0;
  m[4] = xy; m[5] = yy; m[6] = zy; m[7] = 0;
  m[8] = xz; m[9] = yz; m[10] = zz; m[11] = 0;
  m[12] = -(xx * eye[0] + xy * eye[1] + xz * eye[2]);
  m[13] = -(yx * eye[0] + yy * eye[1] + yz * eye[2]);
  m[14] = -(zx * eye[0] + zy * eye[1] + zz * eye[2]);
  m[15] = 1;
  return m;
}

export interface Camera3D {
  yaw: number;
  pitch: number;
  distance: number;
  target: [number, number, number];
}

export function cameraEye(cam: Camera3D): [number, number, number] {
  const cp = Math.cos(cam.pitch);
  return [
    cam.target[0] + cam.distance * cp * Math.sin(cam.yaw),
    cam.target[1] + cam.distance * Math.sin(cam.pitch),
    cam.target[2] + cam.distance * cp * Math.cos(cam.yaw),
  ];
}

/** HSL -> RGB（分量 0~1）。三维高度着色需要浮点 RGB，因此不能用 CSS 颜色字符串。 */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 1) + 1) % 1;
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const conv = (t0: number) => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [conv(hue + 1 / 3), conv(hue), conv(hue - 1 / 3)];
}

/** 高度配色：低处偏蓝、高处偏红，和主流数学软件的“热力图”观感一致。 */
export function heightRamp(t: number): [number, number, number] {
  const u = Math.min(1, Math.max(0, Number.isFinite(t) ? t : 0));
  return hslToRgb((235 - 235 * u) / 360, 0.7, 0.56);
}

export interface SurfaceGeometry {
  /** 交错顶点数据：[px,py,pz, nx,ny,nz, r,g,b] × vertexCount */
  vertices: Float32Array;
  vertexCount: number;
  /** 网格线顶点（每两个一组） */
  lineVertices: Float32Array;
  lineCount: number;
  /** 等高线顶点（每两个一组） */
  contourVertices: Float32Array;
  contourCount: number;
  center: [number, number, number];
  radius: number;
  /** 该次采样中有效的网格单元比例，用于在界面上提示“表达式在这个范围内几乎无定义” */
  validRatio: number;
}

export interface SurfaceBuildSpec {
  grid: number;
  /** 返回世界坐标（y 轴向上），无定义时返回 null */
  point: (u: number, v: number) => [number, number, number] | null;
  /** 着色用的标量场，默认取世界坐标 y */
  heightAt?: (u: number, v: number) => number;
  wireStride?: number;
  /**
   * 等高线。levels 直接给定层级；也可以只给 autoCount，由构建器在算完高度范围后
   * 自动均匀铺开（避免为了知道范围而把整张网格算两遍）。
   */
  contour?: { levels?: number[]; autoCount?: number; field: (u: number, v: number) => number } | null;
}

/**
 * 把参数化的曲面采样成三角面片。
 *
 * 关键点：缓冲区大小由网格数决定、与表达式无关，所以**顶点总数恒定**；
 * 无定义的单元会被写成一串退化三角形（6 个顶点重合），GPU 直接丢弃，
 * 这样拖动时不需要重新分配显存，也不会因为 NaN 而崩溃。
 */
export function buildSurfaceGeometry(spec: SurfaceBuildSpec): SurfaceGeometry {
  const n = Math.max(8, Math.min(240, Math.floor(spec.grid)));
  const stride = Math.max(1, Math.floor(spec.wireStride ?? Math.max(1, Math.round(n / 24))));
  const nodes = n + 1;
  const pts = new Float32Array(nodes * nodes * 3);
  const valid = new Uint8Array(nodes * nodes);
  const heights = new Float32Array(nodes * nodes);
  let hMin = Infinity;
  let hMax = -Infinity;
  let validNodes = 0;
  for (let i = 0; i < nodes; i += 1) {
    const u = i / n;
    for (let j = 0; j < nodes; j += 1) {
      const v = j / n;
      const idx = i * nodes + j;
      let p: [number, number, number] | null = null;
      try { p = spec.point(u, v); } catch { p = null; }
      if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1]) || !Number.isFinite(p[2])) continue;
      pts[idx * 3] = p[0];
      pts[idx * 3 + 1] = p[1];
      pts[idx * 3 + 2] = p[2];
      valid[idx] = 1;
      validNodes += 1;
      let h = p[1];
      if (spec.heightAt) {
        try {
          const hh = spec.heightAt(u, v);
          if (Number.isFinite(hh)) h = hh;
        } catch { /* 保持默认高度 */ }
      }
      heights[idx] = h;
      if (h < hMin) hMin = h;
      if (h > hMax) hMax = h;
    }
  }
  if (!Number.isFinite(hMin) || !Number.isFinite(hMax)) { hMin = 0; hMax = 1; }
  const hSpan = hMax - hMin || 1;

  // 每个节点的法向：相邻节点差分的叉积
  const normals = new Float32Array(nodes * nodes * 3);
  const at = (i: number, j: number) => {
    const ii = Math.max(0, Math.min(nodes - 1, i));
    const jj = Math.max(0, Math.min(nodes - 1, j));
    return ii * nodes + jj;
  };
  for (let i = 0; i < nodes; i += 1) {
    for (let j = 0; j < nodes; j += 1) {
      const idx = i * nodes + j;
      if (!valid[idx]) { normals[idx * 3 + 1] = 1; continue; }
      const i0 = at(i - 1, j);
      const i1 = at(i + 1, j);
      const j0 = at(i, j - 1);
      const j1 = at(i, j + 1);
      const du = valid[i1] ? i1 : i0;
      const dv = valid[j1] ? j1 : j0;
      const du0 = du === i1 && valid[i0] ? i0 : idx;
      const dv0 = dv === j1 && valid[j0] ? j0 : idx;
      const ax = pts[du * 3] - pts[du0 * 3];
      const ay = pts[du * 3 + 1] - pts[du0 * 3 + 1];
      const az = pts[du * 3 + 2] - pts[du0 * 3 + 2];
      const bx = pts[dv * 3] - pts[dv0 * 3];
      const by = pts[dv * 3 + 1] - pts[dv0 * 3 + 1];
      const bz = pts[dv * 3 + 2] - pts[dv0 * 3 + 2];
      let nx = ay * bz - az * by;
      let ny = az * bx - ax * bz;
      let nz = ax * by - ay * bx;
      const len = Math.hypot(nx, ny, nz);
      if (!Number.isFinite(len) || len < 1e-12) { nx = 0; ny = 1; nz = 0; }
      else { nx /= len; ny /= len; nz /= len; }
      normals[idx * 3] = nx;
      normals[idx * 3 + 1] = ny;
      normals[idx * 3 + 2] = nz;
    }
  }

  const cells = n * n;
  const vertices = new Float32Array(cells * 6 * 9);
  let w = 0;
  let validCells = 0;
  const emit = (idx: number, degenerate: boolean) => {
    if (degenerate) {
      for (let k = 0; k < 9; k += 1) vertices[w + k] = 0;
    } else {
      const c = heightRamp((heights[idx] - hMin) / hSpan);
      vertices[w] = pts[idx * 3];
      vertices[w + 1] = pts[idx * 3 + 1];
      vertices[w + 2] = pts[idx * 3 + 2];
      vertices[w + 3] = normals[idx * 3];
      vertices[w + 4] = normals[idx * 3 + 1];
      vertices[w + 5] = normals[idx * 3 + 2];
      vertices[w + 6] = c[0];
      vertices[w + 7] = c[1];
      vertices[w + 8] = c[2];
    }
    w += 9;
  };
  for (let i = 0; i < n; i += 1) {
    for (let j = 0; j < n; j += 1) {
      const a = i * nodes + j;
      const b = (i + 1) * nodes + j;
      const c = (i + 1) * nodes + j + 1;
      const d = i * nodes + j + 1;
      const good = valid[a] && valid[b] && valid[c] && valid[d];
      if (good) validCells += 1;
      // 两个三角形：a-b-c、a-c-d（退化时 6 个顶点重合 -> 面积 0，不会被光栅化）
      emit(a, !good);
      emit(b, !good);
      emit(c, !good);
      emit(a, !good);
      emit(c, !good);
      emit(d, !good);
    }
  }

  // 网格线
  const lineSegs: number[] = [];
  for (let i = 0; i < nodes; i += stride) {
    for (let j = 0; j < nodes; j += stride) {
      const idx = i * nodes + j;
      if (!valid[idx]) continue;
      const rightI = Math.min(nodes - 1, i + stride);
      const downJ = Math.min(nodes - 1, j + stride);
      const r = rightI * nodes + j;
      const d = i * nodes + downJ;
      if (valid[r]) lineSegs.push(pts[idx * 3], pts[idx * 3 + 1], pts[idx * 3 + 2], pts[r * 3], pts[r * 3 + 1], pts[r * 3 + 2]);
      if (valid[d]) lineSegs.push(pts[idx * 3], pts[idx * 3 + 1], pts[idx * 3 + 2], pts[d * 3], pts[d * 3 + 1], pts[d * 3 + 2]);
    }
  }

  // 等高线：在参数平面上做 marching squares，再回代到曲面点上
  const contourSegs: number[] = [];
  const contourSpec = spec.contour;
  if (contourSpec) {
    let levels = contourSpec.levels && contourSpec.levels.length > 0 ? contourSpec.levels : null;
    if (!levels) {
      const autoCount = Math.max(1, Math.min(30, contourSpec.autoCount ?? 8));
      levels = [];
      for (let k = 1; k <= autoCount; k += 1) levels.push(hMin + (hSpan * k) / (autoCount + 1));
    }
    const field = contourSpec.field;
    for (const level of levels) {
      const segs = marchingSquares((u, v) => field(u, v), 0, 1, 0, 1, n, level);
      for (const s of segs) {
        const p1 = spec.point(s.x1, s.y1);
        const p2 = spec.point(s.x2, s.y2);
        if (!p1 || !p2) continue;
        if (!Number.isFinite(p1[0]) || !Number.isFinite(p2[0])) continue;
        contourSegs.push(p1[0], p1[1], p1[2], p2[0], p2[1], p2[2]);
      }
    }
  }

  let cx = 0; let cy = 0; let cz = 0;
  let minX = Infinity; let minY = Infinity; let minZ = Infinity;
  let maxX = -Infinity; let maxY = -Infinity; let maxZ = -Infinity;
  for (let idx = 0; idx < nodes * nodes; idx += 1) {
    if (!valid[idx]) continue;
    const x = pts[idx * 3]; const y = pts[idx * 3 + 1]; const z = pts[idx * 3 + 2];
    cx += x; cy += y; cz += z;
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const count = Math.max(1, validNodes);
  cx /= count; cy /= count; cz /= count;
  const radius = Number.isFinite(minX)
    ? Math.max(1e-3, Math.hypot(maxX - minX, maxY - minY, maxZ - minZ) / 2)
    : 1;

  return {
    vertices,
    vertexCount: cells * 6,
    lineVertices: new Float32Array(lineSegs),
    lineCount: lineSegs.length / 3,
    contourVertices: new Float32Array(contourSegs),
    contourCount: contourSegs.length / 3,
    center: [cx, cy, cz],
    radius,
    validRatio: cells > 0 ? validCells / cells : 0,
  };
}

/* ---------------------------- WebGL 渲染器 ---------------------------- */

const SURFACE_VS = `
attribute vec3 aPos;
attribute vec3 aNormal;
attribute vec3 aColor;
uniform mat4 uMVP;
uniform mat3 uNormalMat;
varying vec3 vNormal;
varying vec3 vColor;
void main() {
  vNormal = uNormalMat * aNormal;
  vColor = aColor;
  gl_Position = uMVP * vec4(aPos, 1.0);
}`;

const SURFACE_FS = `
precision mediump float;
varying vec3 vNormal;
varying vec3 vColor;
uniform vec3 uLightDir;
uniform float uAmbient;
void main() {
  vec3 n = normalize(vNormal);
  vec3 l = normalize(uLightDir);
  float d = abs(dot(n, l));
  vec3 h = normalize(l + vec3(0.0, 0.0, 1.0));
  float spec = pow(abs(dot(n, h)), 20.0) * 0.22;
  vec3 col = vColor * (uAmbient + (1.0 - uAmbient) * d) + vec3(spec);
  gl_FragColor = vec4(col, 1.0);
}`;

const LINE_VS = `
attribute vec3 aPos;
uniform mat4 uMVP;
void main() { gl_Position = uMVP * vec4(aPos, 1.0); }`;

const LINE_FS = `
precision mediump float;
uniform vec4 uColor;
void main() { gl_FragColor = uColor; }`;

function compileShader(gl: WebGLRenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

function linkProgram(gl: WebGLRenderingContext, vsSrc: string, fsSrc: string): WebGLProgram | null {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    gl.deleteProgram(prog);
    return null;
  }
  return prog;
}

export interface Render3DColors {
  background: string;
  line: string;
  contour: string;
  ambient: number;
}

export class SurfaceRenderer {
  private gl: WebGLRenderingContext;

  private surfaceProgram: WebGLProgram;

  private lineProgram: WebGLProgram;

  private vertexBuffer: WebGLBuffer;

  private lineBuffer: WebGLBuffer;

  private contourBuffer: WebGLBuffer;

  private vertexCount = 0;

  private lineCount = 0;

  private contourCount = 0;

  private aPosSurface: number;

  private aNormal: number;

  private aColor: number;

  private aPosLine: number;

  private aPosContour: number;

  private uMVPSurface: WebGLUniformLocation | null;

  private uNormalMat: WebGLUniformLocation | null;

  private uLightDir: WebGLUniformLocation | null;

  private uAmbient: WebGLUniformLocation | null;

  private uMVPLine: WebGLUniformLocation | null;

  private uColorLine: WebGLUniformLocation | null;

  private uMVPContour: WebGLUniformLocation | null;

  private uColorContour: WebGLUniformLocation | null;

  constructor(gl: WebGLRenderingContext) {
    this.gl = gl;
    const surface = linkProgram(gl, SURFACE_VS, SURFACE_FS);
    const line = linkProgram(gl, LINE_VS, LINE_FS);
    if (!surface || !line) throw new Error("着色器编译失败");
    this.surfaceProgram = surface;
    this.lineProgram = line;
    const vb = gl.createBuffer();
    const lb = gl.createBuffer();
    const cb = gl.createBuffer();
    if (!vb || !lb || !cb) throw new Error("无法创建 WebGL 缓冲区");
    this.vertexBuffer = vb;
    this.lineBuffer = lb;
    this.contourBuffer = cb;
    this.aPosSurface = gl.getAttribLocation(surface, "aPos");
    this.aNormal = gl.getAttribLocation(surface, "aNormal");
    this.aColor = gl.getAttribLocation(surface, "aColor");
    this.aPosLine = gl.getAttribLocation(line, "aPos");
    this.aPosContour = gl.getAttribLocation(line, "aPos");
    this.uMVPSurface = gl.getUniformLocation(surface, "uMVP");
    this.uNormalMat = gl.getUniformLocation(surface, "uNormalMat");
    this.uLightDir = gl.getUniformLocation(surface, "uLightDir");
    this.uAmbient = gl.getUniformLocation(surface, "uAmbient");
    this.uMVPLine = gl.getUniformLocation(line, "uMVP");
    this.uColorLine = gl.getUniformLocation(line, "uColor");
    this.uMVPContour = gl.getUniformLocation(line, "uMVP");
    this.uColorContour = gl.getUniformLocation(line, "uColor");
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
  }

  setGeometry(geo: SurfaceGeometry): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, geo.vertices, gl.STATIC_DRAW);
    this.vertexCount = geo.vertexCount;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, geo.lineVertices, gl.STATIC_DRAW);
    this.lineCount = geo.lineCount;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.contourBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, geo.contourVertices, gl.STATIC_DRAW);
    this.contourCount = geo.contourCount;
  }

  render(mvp: Mat4, viewMat: Mat4, colors: Render3DColors, showWire: boolean, showContour: boolean): void {
    const gl = this.gl;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    const bg = parseCssColor(colors.background);
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    if (this.vertexCount > 0) {
      gl.useProgram(this.surfaceProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
      const stride = 9 * 4;
      gl.enableVertexAttribArray(this.aPosSurface);
      gl.vertexAttribPointer(this.aPosSurface, 3, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(this.aNormal);
      gl.vertexAttribPointer(this.aNormal, 3, gl.FLOAT, false, stride, 3 * 4);
      gl.enableVertexAttribArray(this.aColor);
      gl.vertexAttribPointer(this.aColor, 3, gl.FLOAT, false, stride, 6 * 4);
      gl.uniformMatrix4fv(this.uMVPSurface, false, mvp);
      const nm = new Float32Array([
        viewMat[0], viewMat[1], viewMat[2],
        viewMat[4], viewMat[5], viewMat[6],
        viewMat[8], viewMat[9], viewMat[10],
      ]);
      gl.uniformMatrix3fv(this.uNormalMat, false, nm);
      gl.uniform3f(this.uLightDir, 0.45, 0.72, 0.53);
      gl.uniform1f(this.uAmbient, colors.ambient);
      // 面片整体往后推一点，保证网格线与等高线不会被自身遮挡
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(1.2, 1.2);
      gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
      gl.disable(gl.POLYGON_OFFSET_FILL);
    }

    if (showWire && this.lineCount > 0) {
      const c = parseCssColor(colors.line);
      gl.useProgram(this.lineProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.lineBuffer);
      gl.enableVertexAttribArray(this.aPosLine);
      gl.vertexAttribPointer(this.aPosLine, 3, gl.FLOAT, false, 0, 0);
      gl.uniformMatrix4fv(this.uMVPLine, false, mvp);
      gl.uniform4f(this.uColorLine, c[0], c[1], c[2], 0.42);
      gl.drawArrays(gl.LINES, 0, this.lineCount);
    }

    if (showContour && this.contourCount > 0) {
      const c = parseCssColor(colors.contour);
      gl.useProgram(this.lineProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.contourBuffer);
      gl.enableVertexAttribArray(this.aPosContour);
      gl.vertexAttribPointer(this.aPosContour, 3, gl.FLOAT, false, 0, 0);
      gl.uniformMatrix4fv(this.uMVPContour, false, mvp);
      gl.uniform4f(this.uColorContour, c[0], c[1], c[2], 0.9);
      gl.drawArrays(gl.LINES, 0, this.contourCount);
    }
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteBuffer(this.vertexBuffer);
    gl.deleteBuffer(this.lineBuffer);
    gl.deleteBuffer(this.contourBuffer);
    gl.deleteProgram(this.surfaceProgram);
    gl.deleteProgram(this.lineProgram);
  }
}

/** 把 CSS 颜色字符串解析成 0~1 的 RGB，供 WebGL 的 clearColor / uniform 使用。 */
export function parseCssColor(css: string): [number, number, number] {
  const s = css.trim().toLowerCase();
  const hslMatch = s.match(/^hsla?\(\s*([\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/);
  if (hslMatch) return hslToRgb(Number(hslMatch[1]) / 360, Number(hslMatch[2]) / 100, Number(hslMatch[3]) / 100);
  const rgbMatch = s.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/);
  if (rgbMatch) return [Number(rgbMatch[1]) / 255, Number(rgbMatch[2]) / 255, Number(rgbMatch[3]) / 255];
  return [0.08, 0.1, 0.14];
}

/**
 * 没有 WebGL 时的退化渲染：把网格线投影到 2D canvas，按深度从远到近画，越远越淡。
 * 观感不如 WebGL，但保证「三维」在任何环境下都还能用。
 */
export function drawSurfaceFallback(
  ctx: CanvasRenderingContext2D,
  geo: SurfaceGeometry,
  cam: Camera3D,
  w: number,
  h: number,
  theme: ThemePalette,
): number {
  ctx.save();
  ctx.fillStyle = theme.card;
  ctx.fillRect(0, 0, w, h);
  const aspect = w / Math.max(1, h);
  const mvp = mat4Multiply(
    mat4Perspective(Math.PI / 4, aspect, Math.max(0.01, cam.distance * 0.01), cam.distance * 20 + geo.radius * 10),
    mat4LookAt(cameraEye(cam), cam.target, [0, 1, 0]),
  );
  const project = (x: number, y: number, z: number): [number, number, number] => {
    const cx = mvp[0] * x + mvp[4] * y + mvp[8] * z + mvp[12];
    const cy = mvp[1] * x + mvp[5] * y + mvp[9] * z + mvp[13];
    const cw = mvp[3] * x + mvp[7] * y + mvp[11] * z + mvp[15];
    if (Math.abs(cw) < 1e-9) return [NaN, NaN, NaN];
    return [((cx / cw) * 0.5 + 0.5) * w, (0.5 - (cy / cw) * 0.5) * h, cw];
  };
  const count = geo.lineCount / 2;
  const segs: { x1: number; y1: number; x2: number; y2: number; d: number }[] = [];
  for (let i = 0; i < count; i += 1) {
    const o = i * 6;
    const p1 = project(geo.lineVertices[o], geo.lineVertices[o + 1], geo.lineVertices[o + 2]);
    const p2 = project(geo.lineVertices[o + 3], geo.lineVertices[o + 4], geo.lineVertices[o + 5]);
    if (!Number.isFinite(p1[0]) || !Number.isFinite(p2[0])) continue;
    segs.push({ x1: p1[0], y1: p1[1], x2: p2[0], y2: p2[1], d: (p1[2] + p2[2]) / 2 });
    if (segs.length > 20000) break;
  }
  segs.sort((a, b) => b.d - a.d);
  const dMin = segs.length > 0 ? segs[segs.length - 1].d : 0;
  const dMax = segs.length > 0 ? segs[0].d : 1;
  const span = dMax - dMin || 1;
  for (const s of segs) {
    const t = 1 - (s.d - dMin) / span;
    ctx.globalAlpha = 0.18 + 0.72 * t;
    ctx.strokeStyle = theme.foreground;
    ctx.lineWidth = 0.7 + t * 0.8;
    ctx.beginPath();
    ctx.moveTo(s.x1, s.y1);
    ctx.lineTo(s.x2, s.y2);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.font = FONT_TINY;
  ctx.fillStyle = theme.muted;
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText("当前环境没有可用的 WebGL，已退化为线框预览", 8, h - 6);
  ctx.restore();
  return segs.length;
}

/* ============================================================================
 * [D] 预设、子组件、导出主组件
 * ========================================================================== */

const TOOL_ID = "function-graph";
const TWO_PI = Math.PI * 2;

export const DEFAULT_VIEW: ViewBounds = { xmin: -8, xmax: 8, ymin: -5, ymax: 5 };
export const DEFAULT_DISPLAY: DisplayOpts = { grid: true, ticks: true, xLog: false, yLog: false };
export const DEFAULT_ANALYSIS: AnalysisOpts = {
  roots: false, intersections: false, extrema: false, tangent: false, tangentX: "1",
  integral: false, integralA: "0", integralB: "3.14159", asymptotes: false,
};

export function makeCurve(index: number, patch: Partial<Curve2D> = {}): Curve2D {
  return {
    id: `c${index}-${Math.random().toString(36).slice(2, 7)}`,
    kind: "explicit",
    expr: "",
    exprX: "",
    exprY: "",
    color: CURVE_COLORS[index % CURVE_COLORS.length],
    visible: true,
    domainMin: "",
    domainMax: "",
    ...patch,
  };
}

const INITIAL_CURVES: Curve2D[] = [
  makeCurve(0, { expr: "x^2 - 4" }),
  makeCurve(1, { expr: "sin(x)", color: CURVE_COLORS[2] }),
];

export type Surface3DKind = "z" | "param";

export interface Surface3DState {
  kind: Surface3DKind;
  z: string;
  px: string;
  py: string;
  pz: string;
  xmin: string;
  xmax: string;
  ymin: string;
  ymax: string;
  uMin: string;
  uMax: string;
  vMin: string;
  vMax: string;
  grid: number;
  wire: boolean;
  contour: boolean;
  contourCount: number;
}

export const DEFAULT_SURFACE: Surface3DState = {
  kind: "z",
  z: "sin(x) * cos(y)",
  px: "sin(u) * cos(v)",
  py: "sin(u) * sin(v)",
  pz: "cos(u)",
  xmin: "-6",
  xmax: "6",
  ymin: "-6",
  ymax: "6",
  uMin: "0",
  uMax: "3.14159",
  vMin: "0",
  vMax: "6.28319",
  grid: 96,
  wire: true,
  contour: false,
  contourCount: 8,
};

interface Preset2D {
  name: string;
  curves: { kind: CurveKind; expr?: string; exprX?: string; exprY?: string; domainMin?: string; domainMax?: string }[];
  view?: ViewBounds;
  analysis?: Partial<AnalysisOpts>;
}

const PRESETS_2D: Preset2D[] = [
  {
    name: "二次 / 三角 / 双曲线",
    curves: [{ kind: "explicit", expr: "x^2 - 4" }, { kind: "explicit", expr: "sin(x)" }, { kind: "explicit", expr: "1/x" }],
    view: { xmin: -8, xmax: 8, ymin: -5, ymax: 5 },
    analysis: { roots: true, extrema: true, asymptotes: true },
  },
  {
    name: "隐函数：圆与叶形线",
    curves: [{ kind: "implicit", expr: "x^2 + y^2 = 1" }, { kind: "implicit", expr: "x^3 + y^3 = 3*x*y" }],
    view: { xmin: -2.5, xmax: 2.5, ymin: -2.5, ymax: 2.5 },
    analysis: {},
  },
  {
    name: "参数方程：利萨如曲线",
    curves: [{ kind: "parametric", exprX: "3*sin(3*t)", exprY: "3*sin(4*t)", domainMin: "0", domainMax: "6.28319" }],
    view: { xmin: -4, xmax: 4, ymin: -4, ymax: 4 },
    analysis: {},
  },
  {
    name: "极坐标：三叶玫瑰",
    curves: [{ kind: "polar", expr: "3*cos(3*theta)", domainMin: "0", domainMax: "3.14159" }],
    view: { xmin: -4, xmax: 4, ymin: -3, ymax: 3 },
    analysis: {},
  },
  {
    name: "分段函数",
    curves: [
      { kind: "explicit", expr: "{(x < -1): 1, (x <= 1): x^2, otherwise: 1}" },
      { kind: "explicit", expr: "abs(x) + sign(x) * 0.6" },
    ],
    view: { xmin: -4, xmax: 4, ymin: -2, ymax: 4 },
    analysis: { roots: true, extrema: true },
  },
  {
    name: "定积分与切线",
    curves: [{ kind: "explicit", expr: "sin(x)" }, { kind: "explicit", expr: "x^2 / 4 - 1" }],
    view: { xmin: -1, xmax: 7, ymin: -2, ymax: 3 },
    analysis: { integral: true, integralA: "0", integralB: "3.14159", tangent: true, tangentX: "1", roots: true },
  },
  {
    name: "渐近线：双曲线与正切",
    curves: [{ kind: "explicit", expr: "(x^2 + 1) / x" }, { kind: "explicit", expr: "tan(x)", domainMin: "-4.5", domainMax: "4.5" }],
    view: { xmin: -8, xmax: 8, ymin: -8, ymax: 8 },
    analysis: { asymptotes: true, roots: true },
  },
];

interface Preset3D {
  name: string;
  patch: Partial<Surface3DState>;
}

const PRESETS_3D: Preset3D[] = [
  { name: "z = sin(x)·cos(y)", patch: { kind: "z", z: "sin(x) * cos(y)", xmin: "-6", xmax: "6", ymin: "-6", ymax: "6", contour: true } },
  { name: "马鞍面 x²−y²", patch: { kind: "z", z: "x^2 - y^2", xmin: "-3", xmax: "3", ymin: "-3", ymax: "3", contour: true } },
  { name: "抛物面 x²+y²", patch: { kind: "z", z: "x^2 + y^2", xmin: "-3", xmax: "3", ymin: "-3", ymax: "3", contour: true } },
  { name: "墨西哥帽", patch: { kind: "z", z: "sin(sqrt(x^2 + y^2) * 3) / (sqrt(x^2 + y^2) * 3 + 0.4)", xmin: "-4", xmax: "4", ymin: "-4", ymax: "4", contour: false } },
  { name: "球面（参数）", patch: { kind: "param", px: "sin(u) * cos(v)", py: "sin(u) * sin(v)", pz: "cos(u)", uMin: "0", uMax: "3.14159", vMin: "0", vMax: "6.28319" } },
  { name: "环面（参数）", patch: { kind: "param", px: "(2 + cos(v)) * cos(u)", py: "(2 + cos(v)) * sin(u)", pz: "sin(v)", uMin: "0", uMax: "6.28319", vMin: "0", vMax: "6.28319" } },
  { name: "螺旋面（参数）", patch: { kind: "param", px: "u * cos(v)", py: "u * sin(v)", pz: "v", uMin: "0", uMax: "2", vMin: "0", vMax: "12.5664" } },
];

function num(text: string, fallback: number): number {
  const v = Number(text);
  return Number.isFinite(v) ? v : fallback;
}

interface CompiledCurve {
  curve: Curve2D;
  error: string | null;
  /** 显函数 y=f(x) 或极坐标 r(θ) */
  f?: (x: number) => number;
  /** 隐函数 F(x,y) */
  fxy?: (x: number, y: number) => number;
  /** 参数方程 */
  fx?: (t: number) => number;
  fy?: (t: number) => number;
}

/** 把一条曲线配置编译成可调用的函数；失败时把解析器的人话错误带出来。 */
export function compileCurve(c: Curve2D): CompiledCurve {
  if (c.kind === "implicit") {
    const p = compileExpression(c.expr, ["x", "y"]);
    if (!p.ok) return { curve: c, error: p.issue.message };
    return { curve: c, error: null, fxy: (x, y) => p.run([x, y]) };
  }
  if (c.kind === "parametric") {
    const px = compileExpression(c.exprX, ["t"]);
    if (!px.ok) return { curve: c, error: `x(t)：${px.issue.message}` };
    const py = compileExpression(c.exprY, ["t"]);
    if (!py.ok) return { curve: c, error: `y(t)：${py.issue.message}` };
    return { curve: c, error: null, fx: (t) => px.run([t]), fy: (t) => py.run([t]) };
  }
  if (c.kind === "polar") {
    const p = compileExpression(c.expr, ["theta", "θ"]);
    if (!p.ok) return { curve: c, error: p.issue.message };
    return { curve: c, error: null, f: (theta) => p.run([theta, theta]) };
  }
  const p = compileExpression(c.expr, ["x"]);
  if (!p.ok) return { curve: c, error: p.issue.message };
  return { curve: c, error: null, f: (x) => p.run([x]) };
}

interface CurveDrawEntry {
  paths: CurvePath[];
  segments?: Segment[];
  color: string;
  visible: boolean;
}

/** 参数方程 / 极坐标的采样：世界坐标跳变超过视图跨度 4 倍就断开。 */
function sampleTrace(
  fx: (t: number) => number,
  fy: (t: number) => number,
  tmin: number,
  tmax: number,
  count: number,
  span: number,
): { paths: CurvePath[]; breaks: number } {
  const paths: CurvePath[] = [];
  let cur: SamplePoint[] = [];
  let breaks = 0;
  let prev: SamplePoint | null = null;
  const push = () => { if (cur.length >= 2) paths.push({ points: cur }); cur = []; };
  for (let i = 0; i <= count; i += 1) {
    const t = tmin + (i * (tmax - tmin)) / count;
    let x = NaN;
    let y = NaN;
    try { x = fx(t); y = fy(t); } catch { /* 保持 NaN，下面会断开 */ }
    if (!Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1e12 || Math.abs(y) > 1e12) {
      push();
      prev = null;
      continue;
    }
    if (prev && (Math.abs(x - prev.x) > span * 4 || Math.abs(y - prev.y) > span * 4)) {
      breaks += 1;
      push();
    }
    cur.push({ x, y });
    prev = { x, y };
  }
  push();
  return { paths, breaks };
}

function zoomView(view: ViewBounds, display: DisplayOpts, wx: number, wy: number, fx: number, fy: number): ViewBounds {
  const axis = (min: number, max: number, center: number, factor: number, isLog: boolean) => {
    if (isLog) {
      const c = Math.log10(Math.max(center, 1e-9));
      const a = Math.log10(Math.max(min, 1e-9));
      const b = Math.log10(Math.max(max, 1e-9));
      return [Math.pow(10, c + (a - c) * factor), Math.pow(10, c + (b - c) * factor)] as const;
    }
    return [center + (min - center) * factor, center + (max - center) * factor] as const;
  };
  const xr = axis(view.xmin, view.xmax, wx, fx, display.xLog);
  const yr = axis(view.ymin, view.ymax, wy, fy, display.yLog);
  return { xmin: xr[0], xmax: xr[1], ymin: yr[0], ymax: yr[1] };
}

/**
 * 平移视图。传入的是**像素位移**而不是世界位移：对数轴下世界坐标的差没有意义，
 * 必须按「跨度比例」换算。
 */
function panView(view: ViewBounds, display: DisplayOpts, dpx: number, dpy: number, w: number, h: number): ViewBounds {
  const axis = (min: number, max: number, dp: number, size: number, isLog: boolean) => {
    const t = dp / Math.max(1, size);
    if (isLog) {
      const lo = Math.log10(Math.max(min, 1e-9));
      const hi = Math.log10(Math.max(max, 1e-9));
      const f = Math.pow(10, t * (hi - lo));
      return [min * f, max * f] as const;
    }
    const shift = t * (max - min);
    return [min + shift, max + shift] as const;
  };
  const xr = axis(view.xmin, view.xmax, dpx, w, display.xLog);
  const yr = axis(view.ymin, view.ymax, dpy, h, display.yLog);
  return { xmin: xr[0], xmax: xr[1], ymin: yr[0], ymax: yr[1] };
}

/* ---------------------------- 二维画布 ---------------------------- */

interface Canvas2DProps {
  curves: Curve2D[];
  compiled: CompiledCurve[];
  view: ViewBounds;
  onViewChange: (v: ViewBounds) => void;
  display: DisplayOpts;
  analysis: AnalysisOpts;
  data: AnalysisData | null;
  theme: ThemePalette;
  themeVersion: number;
}

function Canvas2D({ curves, compiled, view, onViewChange, display, analysis, data, theme, themeVersion }: Canvas2DProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<HoverPoint | null>(null);
  const dragRef = useRef<{ mode: "pan" | "scaleX" | "scaleY"; px: number; py: number; view: ViewBounds } | null>(null);
  const entryRef = useRef<Map<string, CurveDrawEntry>>(new Map());

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setSize({ w: Math.max(120, Math.round(rect.width)), h: Math.max(120, Math.round(rect.height)) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const dpr = typeof window === "undefined" ? 1 : Math.min(2, window.devicePixelRatio || 1);
  const sampleCount = Math.min(2200, Math.max(600, Math.round(size.w * dpr)));

  // 采样：只在表达式 / 视图 / 画布尺寸变化时重算（不是每帧重算）
  const entries = useMemo(() => {
    const map = new Map<string, CurveDrawEntry>();
    if (size.w === 0) return map;
    const span = Math.max(view.xmax - view.xmin, view.ymax - view.ymin);
    const yScale = size.h / Math.max(1e-9, Math.abs(view.ymax - view.ymin));
    for (const cc of compiled) {
      const c = cc.curve;
      if (cc.error) { map.set(c.id, { paths: [], color: c.color, visible: false }); continue; }
      if (c.kind === "implicit") {
        if (!cc.fxy) continue;
        const res = Math.max(48, Math.min(180, Math.round(size.w / 7)));
        const segs = marchingSquares(cc.fxy, view.xmin, view.xmax, view.ymin, view.ymax, res, 0);
        map.set(c.id, { paths: [], segments: segs, color: c.color, visible: c.visible });
        continue;
      }
      if (c.kind === "parametric") {
        if (!cc.fx || !cc.fy) continue;
        const t0 = c.domainMin.trim() === "" ? 0 : num(c.domainMin, 0);
        const t1 = c.domainMax.trim() === "" ? TWO_PI : num(c.domainMax, TWO_PI);
        const res = sampleTrace(cc.fx, cc.fy, t0, t1, sampleCount, span);
        map.set(c.id, { paths: res.paths, color: c.color, visible: c.visible });
        continue;
      }
      if (c.kind === "polar") {
        if (!cc.f) continue;
        const t0 = c.domainMin.trim() === "" ? 0 : num(c.domainMin, 0);
        const t1 = c.domainMax.trim() === "" ? TWO_PI : num(c.domainMax, TWO_PI);
        const res = sampleTrace(
          (t) => {
            const r = (cc.f as (t: number) => number)(t);
            return r * Math.cos(t);
          },
          (t) => {
            const r = (cc.f as (t: number) => number)(t);
            return r * Math.sin(t);
          },
          t0, t1, sampleCount, span,
        );
        map.set(c.id, { paths: res.paths, color: c.color, visible: c.visible });
        continue;
      }
      if (!cc.f) continue;
      const lo = c.domainMin.trim() === "" ? view.xmin : Math.max(view.xmin, num(c.domainMin, view.xmin));
      const hi = c.domainMax.trim() === "" ? view.xmax : Math.min(view.xmax, num(c.domainMax, view.xmax));
      if (!(hi > lo)) { map.set(c.id, { paths: [], color: c.color, visible: false }); continue; }
      const res = sampleCurve(cc.f, lo, hi, { count: sampleCount, yScale, logY: display.yLog });
      map.set(c.id, { paths: res.paths, color: c.color, visible: c.visible });
    }
    return map;
  }, [compiled, view, size.w, size.h, display.yLog, sampleCount]);

  entryRef.current = entries;

  // 绘制：合并到一帧里，避免敲一个字符就全量重绘（搭配 useDeferredValue 使用）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0) return;
    const t0 = performance.now();
    const wantW = Math.round(size.w * dpr);
    const wantH = Math.round(size.h * dpr);
    if (canvas.width !== wantW || canvas.height !== wantH) {
      canvas.width = wantW;
      canvas.height = wantH;
    }
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawGraph2D({
      ctx,
      width: size.w,
      height: size.h,
      view,
      curves,
      display,
      analysis,
      data,
      theme,
      hover,
      empty: curves.length === 0,
      paths: entries,
    });
    const ms = performance.now() - t0;
    const w = window as unknown as Record<string, unknown>;
    const perf = (w.__fkGraph2D as { draws: number; lastMs: number; maxMs: number } | undefined) ?? { draws: 0, lastMs: 0, maxMs: 0 };
    perf.draws += 1;
    perf.lastMs = ms;
    perf.maxMs = Math.max(perf.maxMs, ms);
    w.__fkGraph2D = perf;
  }, [entries, curves, view, display, analysis, data, theme, themeVersion, size.w, size.h, dpr, hover]);

  // 滚轮缩放（必须用非 passive 的原生监听，否则 preventDefault 无效）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const proj = makeProjector(view, size.w, size.h, display.xLog, display.yLog);
      const wx = proj.wx(e.clientX - rect.left);
      const wy = proj.wy(e.clientY - rect.top);
      const factor = Math.exp(e.deltaY * 0.0012);
      onViewChange(zoomView(view, display, wx, wy, factor, factor));
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [view, display, size.w, size.h, onViewChange]);

  const pointerPos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { px: e.clientX - rect.left, py: e.clientY - rect.top, rect };
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { px, py } = pointerPos(e);
    const proj = makeProjector(view, size.w, size.h, display.xLog, display.yLog);
    const axisX = proj.sx(display.xLog ? 1 : 0);
    const axisY = proj.sy(display.yLog ? 1 : 0);
    let mode: "pan" | "scaleX" | "scaleY" = "pan";
    if (Math.abs(py - axisY) <= 22 && Math.abs(py - axisY) < Math.abs(px - axisX)) mode = "scaleX";
    else if (Math.abs(px - axisX) <= 22) mode = "scaleY";
    dragRef.current = { mode, px, py, view };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 合成事件没有真实指针，忽略 */ }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const { px, py } = pointerPos(e);
    const drag = dragRef.current;
    if (drag) {
      const proj = makeProjector(drag.view, size.w, size.h, display.xLog, display.yLog);
      if (drag.mode === "pan") {
        onViewChange(panView(drag.view, display, drag.px - px, drag.py - py, size.w, size.h));
      } else {
        const delta = drag.mode === "scaleX" ? px - drag.px : py - drag.py;
        const factor = Math.exp(delta * 0.004);
        const anchorX = drag.mode === "scaleX" ? proj.wx(drag.px) : (drag.view.xmin + drag.view.xmax) / 2;
        const anchorY = drag.mode === "scaleY" ? proj.wy(drag.py) : (drag.view.ymin + drag.view.ymax) / 2;
        onViewChange(drag.mode === "scaleX"
          ? zoomView(drag.view, display, anchorX, anchorY, factor, 1)
          : zoomView(drag.view, display, anchorX, anchorY, 1, factor));
      }
      return;
    }
    // 悬停取点：在采样点上找最近的屏幕点
    let best: HoverPoint | null = null;
    let bestD2 = 14 * 14;
    const proj = makeProjector(view, size.w, size.h, display.xLog, display.yLog);
    for (const c of curves) {
      if (!c.visible) continue;
      const entry = entries.get(c.id);
      if (!entry) continue;
      for (const path of entry.paths) {
        for (let i = 0; i < path.points.length; i += 1) {
          const p = path.points[i];
          const sx = proj.sx(p.x);
          const sy = proj.sy(p.y);
          if (!Number.isFinite(sx) || !Number.isFinite(sy)) continue;
          const d2 = (sx - px) ** 2 + (sy - py) ** 2;
          if (d2 < bestD2) { bestD2 = d2; best = { sx, sy, x: p.x, y: p.y, curve: curves.indexOf(c) }; }
          if (i > 4000) break;
        }
      }
    }
    setHover(best);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* 忽略 */ }
  };

  const hoverCurve = hover ? curves[hover.curve] : null;

  return (
    <div
      ref={wrapRef}
      className="relative h-[min(66vh,620px)] w-full touch-none select-none"
    >
      <canvas
        ref={canvasRef}
        data-graph2d="1"
        className="h-full w-full cursor-crosshair rounded-xl"
        style={{ touchAction: "none" }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={() => { setHover(null); dragRef.current = null; }}
        onDoubleClick={() => onViewChange(DEFAULT_VIEW)}
      />
      {hoverCurve && hover && (
        <div
          className="pointer-events-none absolute rounded-lg border border-border/70 bg-card/95 px-2.5 py-1.5 font-mono-accent text-[11px] leading-relaxed text-foreground shadow-sm backdrop-blur"
          style={{
            left: Math.min(Math.max(8, hover.sx + 12), Math.max(8, size.w - 168)),
            top: Math.min(Math.max(8, hover.sy - 46), Math.max(8, size.h - 44)),
          }}
        >
          <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ background: hoverCurve.color }} />
          <span className="text-muted-foreground">
            {hoverCurve.kind === "polar" ? "θ" : hoverCurve.kind === "parametric" ? "t" : "x"} = {formatNumber(hover.x)}
          </span>
          <br />
          <span className="text-muted-foreground">
            {hoverCurve.kind === "parametric" ? "y" : "f"} = {formatNumber(hover.y)}
          </span>
        </div>
      )}
    </div>
  );
}

/* ---------------------------- 三维画布 ---------------------------- */

interface Canvas3DProps {
  surface: Surface3DState;
  camera: { yaw: number; pitch: number; distance: number };
  onCameraCommit: (c: { yaw: number; pitch: number; distance: number }) => void;
  theme: ThemePalette;
  themeVersion: number;
  onStats: (s: { vertexCount: number; lineCount: number; validRatio: number; buildMs: number }) => void;
}

function Canvas3D({ surface, camera, onCameraCommit, theme, themeVersion, onStats }: Canvas3DProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<SurfaceRenderer | null>(null);
  const glRef = useRef<WebGLRenderingContext | null>(null);
  const geoRef = useRef<SurfaceGeometry | null>(null);
  const camRef = useRef<Camera3D>({ ...camera, target: [0, 0, 0] });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [fallback, setFallback] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const dragRef = useRef<{ mode: "rotate" | "pan"; px: number; py: number } | null>(null);
  const rafRef = useRef(0);
  const deferredSurface = useDeferredValue(surface);

  const programs = useMemo<{ z: CompiledProgram | null; px: CompiledProgram | null; py: CompiledProgram | null; pz: CompiledProgram | null }>(() => {
    const build = (src: string, vars: string[]): CompiledProgram | null => {
      const p = compileExpression(src, vars);
      return p.ok ? p : null;
    };
    if (deferredSurface.kind === "z") {
      return { z: build(deferredSurface.z, ["x", "y"]), px: null, py: null, pz: null };
    }
    return {
      z: null,
      px: build(deferredSurface.px, ["u", "v"]),
      py: build(deferredSurface.py, ["u", "v"]),
      pz: build(deferredSurface.pz, ["u", "v"]),
    };
  }, [deferredSurface]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const update = () => {
      const rect = el.getBoundingClientRect();
      setSize({ w: Math.max(120, Math.round(rect.width)), h: Math.max(120, Math.round(rect.height)) });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // 初始化 WebGL（失败则退化到 2D 线框）
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const opts: WebGLContextAttributes = { antialias: true, alpha: false, preserveDrawingBuffer: true };
    const gl = (canvas.getContext("webgl2", opts) || canvas.getContext("webgl", opts)) as unknown as WebGLRenderingContext | null;
    if (!gl) { setFallback(true); return; }
    try {
      rendererRef.current = new SurfaceRenderer(gl);
      glRef.current = gl;
      setFallback(false);
    } catch (e) {
      setFallback(true);
      setNotice(e instanceof Error ? e.message : "WebGL 初始化失败");
    }
    return () => {
      rendererRef.current?.dispose();
      rendererRef.current = null;
      glRef.current = null;
    };
  }, []);

  // 构建几何（这一步比较重，所以放在 useDeferredValue 之后再算）
  const geometry = useMemo(() => {
    const t0 = performance.now();
    const g = deferredSurface.grid;
    const build = (spec: SurfaceBuildSpec): SurfaceGeometry | null => {
      try { return buildSurfaceGeometry(spec); } catch { return null; }
    };
    let geo: SurfaceGeometry | null = null;
    if (deferredSurface.kind === "z") {
      const p = programs.z;
      if (!p) return null;
      const x0 = num(deferredSurface.xmin, -6);
      const x1 = num(deferredSurface.xmax, 6);
      const y0 = num(deferredSurface.ymin, -6);
      const y1 = num(deferredSurface.ymax, 6);
      const f = (x: number, y: number) => p.run([x, y]);
      geo = build({
        grid: g,
        point: (u, v) => {
          const x = x0 + u * (x1 - x0);
          const y = y0 + v * (y1 - y0);
          const z = f(x, y);
          if (!Number.isFinite(z)) return null;
          return [x, z, y];
        },
        wireStride: Math.max(1, Math.round(g / 24)),
        // 等高线的层级交给构建器按实际高度范围铺开，省掉“先算一遍范围”的二次构建
        contour: deferredSurface.contour
          ? { autoCount: deferredSurface.contourCount, field: (u, v) => f(x0 + u * (x1 - x0), y0 + v * (y1 - y0)) }
          : null,
      });
    } else {
      const px = programs.px;
      const py = programs.py;
      const pz = programs.pz;
      if (px && py && pz) {
        const u0 = num(deferredSurface.uMin, 0);
        const u1 = num(deferredSurface.uMax, Math.PI);
        const v0 = num(deferredSurface.vMin, 0);
        const v1 = num(deferredSurface.vMax, TWO_PI);
        geo = build({
          grid: g,
          point: (u, v) => {
            const uu = u0 + u * (u1 - u0);
            const vv = v0 + v * (v1 - v0);
            const X = px.run([uu, vv]);
            const Y = py.run([uu, vv]);
            const Z = pz.run([uu, vv]);
            if (!Number.isFinite(X) || !Number.isFinite(Y) || !Number.isFinite(Z)) return null;
            // 数学习惯 z 轴朝上，这里换到 y 轴向上的世界坐标
            return [X, Z, Y];
          },
          wireStride: Math.max(1, Math.round(g / 24)),
          contour: deferredSurface.contour
            ? {
              autoCount: deferredSurface.contourCount,
              field: (u, v) => pz.run([u0 + u * (u1 - u0), v0 + v * (v1 - v0)]),
            }
            : null,
        });
      }
    }
    if (geo) {
      geoRef.current = geo;
      rendererRef.current?.setGeometry(geo);
      onStats({ vertexCount: geo.vertexCount, lineCount: geo.lineCount, validRatio: geo.validRatio, buildMs: performance.now() - t0 });
    }
    return geo;
    // onStats 是稳定引用（父组件 useCallback），这里可以安全忽略
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferredSurface, programs]);

  const renderFrame = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w === 0) return;
    const geo = geoRef.current;
    const cam = { ...camRef.current, target: (geo?.center ?? [0, 0, 0]) as [number, number, number] };
    const radius = geo?.radius ?? 4;
    const t0 = performance.now();
    if (fallback || !rendererRef.current || !geo) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const dpr2 = Math.min(2, window.devicePixelRatio || 1);
        canvas.width = Math.round(size.w * dpr2);
        canvas.height = Math.round(size.h * dpr2);
        ctx.setTransform(dpr2, 0, 0, dpr2, 0, 0);
        if (geo) drawSurfaceFallback(ctx, geo, cam, size.w, size.h, theme);
        else { ctx.fillStyle = theme.card; ctx.fillRect(0, 0, size.w, size.h); }
      }
    } else {
      const dpr2 = Math.min(2, window.devicePixelRatio || 1);
      const wantW = Math.round(size.w * dpr2);
      const wantH = Math.round(size.h * dpr2);
      if (canvas.width !== wantW || canvas.height !== wantH) { canvas.width = wantW; canvas.height = wantH; }
      const eye = cameraEye(cam);
      const near = Math.max(0.01, cam.distance * 0.01);
      const far = cam.distance * 20 + radius * 20;
      const proj = mat4Perspective(Math.PI / 4, size.w / Math.max(1, size.h), near, far);
      const viewM = mat4LookAt(eye, cam.target, [0, 1, 0]);
      const mvp = mat4Multiply(proj, viewM);
      rendererRef.current.render(mvp, viewM, {
        background: theme.card,
        line: theme.foreground,
        contour: theme.primary,
        ambient: theme.isDark ? 0.42 : 0.55,
      }, surface.wire, surface.contour);
    }
    const ms = performance.now() - t0;
    const w = window as unknown as Record<string, unknown>;
    const perf = (w.__fkGraph3D as { frames: number; lastMs: number; maxMs: number; totalMs: number } | undefined)
      ?? { frames: 0, lastMs: 0, maxMs: 0, totalMs: 0 };
    perf.frames += 1;
    perf.lastMs = ms;
    perf.maxMs = Math.max(perf.maxMs, ms);
    perf.totalMs += ms;
    w.__fkGraph3D = perf;
  }, [size.w, size.h, theme, fallback, surface.wire, surface.contour]);

  const scheduleRender = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      renderFrame();
    });
  }, [renderFrame]);

  // 外部（主题 / 几何 / 尺寸 / 开关）变化时重绘
  useEffect(() => { scheduleRender(); }, [scheduleRender, geometry, themeVersion, camera]);
  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current); }, []);

  // 外部传入的相机（例如持久化的草稿）同步到本地引用
  useEffect(() => {
    if (!dragRef.current) camRef.current = { ...camera, target: camRef.current.target };
  }, [camera]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    dragRef.current = { mode: e.shiftKey || e.button === 2 ? "pan" : "rotate", px: e.clientX, py: e.clientY };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* 合成事件没有真实指针，忽略 */ }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.px;
    const dy = e.clientY - drag.py;
    drag.px = e.clientX;
    drag.py = e.clientY;
    const cam = camRef.current;
    if (drag.mode === "rotate") {
      const yaw = cam.yaw - dx * 0.008;
      const pitch = Math.max(-1.45, Math.min(1.45, cam.pitch + dy * 0.008));
      camRef.current = { ...cam, yaw, pitch };
    } else {
      const geo = geoRef.current;
      const scale = (geo?.radius ?? 4) * 0.0025 * cam.distance * 0.6;
      const sinY = Math.sin(cam.yaw);
      const cosY = Math.cos(cam.yaw);
      camRef.current = {
        ...cam,
        target: [
          cam.target[0] - (dx * cosY - dy * sinY * 0.4) * scale,
          cam.target[1] + dy * scale,
          cam.target[2] + (dx * sinY + dy * cosY * 0.4) * scale,
        ],
      };
    }
    scheduleRender();
  };

  const onPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragRef.current) onCameraCommit({ ...camRef.current });
    dragRef.current = null;
    try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* 忽略 */ }
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const cam = camRef.current;
      const factor = Math.exp(e.deltaY * 0.0012);
      camRef.current = { ...cam, distance: Math.max(0.4, Math.min(400, cam.distance * factor)) };
      scheduleRender();
      onCameraCommit({ ...camRef.current });
    };
    canvas.addEventListener("wheel", onWheel, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheel);
  }, [scheduleRender, onCameraCommit]);

  const errorText = useMemo(() => {
    if (surface.kind === "z") {
      const p = compileExpression(surface.z, ["x", "y"]);
      return p.ok ? null : p.issue.message;
    }
    for (const [label, src] of [["x(u,v)", surface.px], ["y(u,v)", surface.py], ["z(u,v)", surface.pz]] as const) {
      const p = compileExpression(src, ["u", "v"]);
      if (!p.ok) return `${label}：${p.issue.message}`;
    }
    return null;
  }, [surface]);

  const resetCamera = () => {
    const next = { yaw: -0.7, pitch: 0.42, distance: 3.2 * (geoRef.current?.radius ?? 4) };
    camRef.current = { ...next, target: camRef.current.target };
    onCameraCommit(next);
    scheduleRender();
  };

  return (
    <div ref={wrapRef} className="relative h-[min(66vh,620px)] w-full touch-none select-none">
      <canvas
        ref={canvasRef}
        data-graph3d="1"
        className="h-full w-full cursor-grab rounded-xl active:cursor-grabbing"
        style={{ touchAction: "none" }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => { dragRef.current = null; }}
        onContextMenu={(e) => e.preventDefault()}
      />
      <div className="absolute bottom-2 left-2 flex items-center gap-1.5">
        <Button variant="outline" size="sm" className="h-7 px-2 text-[11px]" onClick={resetCamera}>
          <RotateCcw className="h-3.5 w-3.5" />复位视角
        </Button>
        {fallback && <Badge variant="secondary">已退化为线框</Badge>}
      </div>
      {errorText && (
        <div className="absolute left-2 right-2 top-2 flex items-center gap-2 rounded-xl border-l-4 border-l-destructive bg-destructive/10 px-3 py-2 font-mono text-xs text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />{errorText}
        </div>
      )}
      {notice && (
        <div className="absolute left-2 top-2"><Badge variant="secondary">{notice}</Badge></div>
      )}
    </div>
  );
}

/* ---------------------------- 小控件 ---------------------------- */

function ToggleChip({ on, onClick, children, title }: { on: boolean; onClick: () => void; children: React.ReactNode; title?: string }) {
  return (
    <Button
      variant="outline"
      size="sm"
      title={title}
      className={on ? "h-8 border-primary/50 bg-primary/10 px-2.5 text-[11px] text-primary" : "h-8 px-2.5 text-[11px]"}
      onClick={onClick}
    >
      {on && <Check className="h-3.5 w-3.5" />}
      {children}
    </Button>
  );
}

function ResultRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/40 py-1.5 last:border-b-0">
      <span className="shrink-0 text-[11px] text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-right font-mono-accent text-[11px] text-foreground">{children}</span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

export function describeCurve(c: Curve2D): string {
  if (c.kind === "implicit") return `${c.expr} = 0`;
  if (c.kind === "parametric") return `x(t) = ${c.exprX}, y(t) = ${c.exprY}`;
  if (c.kind === "polar") return `r(θ) = ${c.expr}`;
  return `y = ${c.expr}`;
}

function curvePlaceholder(kind: CurveKind): string {
  if (kind === "implicit") return "例如 x^2 + y^2 = 1";
  if (kind === "polar") return "例如 3*cos(3*theta)";
  return "例如 x^2 - 4、sin(x)、{(x<0): -x, (x>=0): x}";
}

/* ============================================================================
 * [E] 主组件
 * ========================================================================== */

export function FunctionGraphTool() {
  const [mode, setMode] = useToolDraft<"2d" | "3d">(TOOL_ID, "mode", "2d");
  const [curves, setCurves] = useToolDraft<Curve2D[]>(TOOL_ID, "curves", INITIAL_CURVES);
  const [view, setView] = useToolDraft<ViewBounds>(TOOL_ID, "view", DEFAULT_VIEW);
  const [display, setDisplay] = useToolDraft<DisplayOpts>(TOOL_ID, "display", DEFAULT_DISPLAY);
  const [analysis, setAnalysis] = useToolDraft<AnalysisOpts>(TOOL_ID, "analysis", DEFAULT_ANALYSIS);
  const [surface, setSurface] = useToolDraft<Surface3DState>(TOOL_ID, "surface", DEFAULT_SURFACE);
  const [camera, setCamera] = useToolDraft<{ yaw: number; pitch: number; distance: number }>(TOOL_ID, "camera", { yaw: -0.7, pitch: 0.42, distance: 12 });
  const [stats3d, setStats3d] = useState({ vertexCount: 0, lineCount: 0, validRatio: 0, buildMs: 0 });
  const [flashMessage, setFlashMessage] = useState<string | null>(null);

  const themeVersion = useThemeVersion();
  const theme = useMemo(
    () => readThemePalette(typeof document === "undefined" ? null : document.documentElement),
    // themeVersion 变化代表 data-theme 被改写，必须重新取色
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [themeVersion],
  );

  useEffect(() => {
    if (!flashMessage) return;
    const timer = setTimeout(() => setFlashMessage(null), 1800);
    return () => clearTimeout(timer);
  }, [flashMessage]);

  // 输入框保持即时响应，采样与绘制跟着 React 的“低优先级”一起延后，避免每敲一键就全量重算
  const deferredCurves = useDeferredValue(curves);
  const compiled = useMemo(() => deferredCurves.map(compileCurve), [deferredCurves]);

  const patchCurve = useCallback((id: string, patch: Partial<Curve2D>) => {
    setCurves((prev) => prev.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }, [setCurves]);

  const removeCurve = useCallback((id: string) => {
    setCurves((prev) => prev.filter((c) => c.id !== id));
  }, [setCurves]);

  const addCurve = useCallback(() => {
    setCurves((prev) => [...prev, makeCurve(prev.length, { expr: prev.length === 0 ? "x^2 - 4" : "sin(x)" })]);
  }, [setCurves]);

  const patchSurface = useCallback((patch: Partial<Surface3DState>) => {
    setSurface((prev) => ({ ...prev, ...patch }));
  }, [setSurface]);

  const patchAnalysis = useCallback((patch: Partial<AnalysisOpts>) => {
    setAnalysis((prev) => ({ ...prev, ...patch }));
  }, [setAnalysis]);

  const patchDisplay = useCallback((patch: Partial<DisplayOpts>) => {
    setDisplay((prev) => {
      const next = { ...prev, ...patch };
      // 切到对数轴时如果当前视图含非正值，直接给一段合理的正区间（参照站点同样的处理）
      if (patch.xLog === true && (view.xmin <= 0 || view.xmax <= 0)) {
        setView((v) => ({ ...v, xmin: 0.1, xmax: 100 }));
      }
      if (patch.yLog === true && (view.ymin <= 0 || view.ymax <= 0)) {
        setView((v) => ({ ...v, ymin: 0.1, ymax: 100 }));
      }
      return next;
    });
  }, [setDisplay, setView, view.xmin, view.xmax, view.ymin, view.ymax]);

  /* -------------------------- 分析计算 -------------------------- */

  const analysisData = useMemo<AnalysisData>(() => {
    const issues = compiled
      .map((c, i) => ({ curve: i, label: describeCurve(c.curve), message: c.error ?? "" }))
      .filter((x) => x.message !== "");
    const empty: AnalysisData = { roots: [], intersections: [], extrema: [], integral: null, asymptotes: [], tangent: null, issues };
    if (mode !== "2d") return empty;

    const usable = compiled
      .map((c, i) => ({ c, i }))
      .filter((x) => x.c.curve.visible && x.c.error === null && x.c.curve.kind === "explicit" && typeof x.c.f === "function");

    const roots: AnalysisData["roots"] = [];
    if (analysis.roots) {
      for (const { c, i } of usable) {
        const f = c.f as (x: number) => number;
        const hits = findRoots(f, view.xmin, view.xmax, 1600);
        for (const h of hits.slice(0, 60)) roots.push({ curve: i, x: h.x, y: 0 });
      }
    }

    const intersections: AnalysisData["intersections"] = [];
    if (analysis.intersections) {
      for (let a = 0; a < usable.length; a += 1) {
        for (let b = a + 1; b < usable.length; b += 1) {
          const fa = usable[a].c.f as (x: number) => number;
          const fb = usable[b].c.f as (x: number) => number;
          for (const h of findIntersections(fa, fb, view.xmin, view.xmax, 1600).slice(0, 40)) {
            intersections.push({ a: usable[a].i, b: usable[b].i, x: h.x, y: fa(h.x) });
          }
        }
      }
    }

    const extrema: AnalysisData["extrema"] = [];
    if (analysis.extrema) {
      for (const { c, i } of usable) {
        const f = c.f as (x: number) => number;
        for (const e of findExtrema(f, view.xmin, view.xmax, 1600).slice(0, 40)) {
          extrema.push({ curve: i, x: e.x, y: e.value, kind: e.kind });
        }
      }
    }

    let integral: AnalysisData["integral"] = null;
    if (analysis.integral && usable.length > 0) {
      const target = usable[0];
      const a = num(analysis.integralA, 0);
      const b = num(analysis.integralB, 1);
      const res = integrate(target.c.f as (x: number) => number, a, b, 2000);
      integral = { curve: target.i, a, b, value: res.value, method: res.method === "simpson" ? "辛普森法" : "梯形法（区间内有不可求值的点）" };
    }

    const asymptotes: AnalysisData["asymptotes"] = [];
    if (analysis.asymptotes) {
      for (const { c, i } of usable) {
        const res = findAsymptotes(c.f as (x: number) => number, view.xmin, view.xmax, 1600);
        if (res.vertical.length || res.horizontal.length || res.oblique.length) {
          asymptotes.push({ curve: i, ...res });
        }
      }
    }

    let tangent: AnalysisData["tangent"] = null;
    if (analysis.tangent && usable.length > 0) {
      const target = usable[0];
      const f = target.c.f as (x: number) => number;
      const x0 = num(analysis.tangentX, 1);
      const y0 = f(x0);
      if (Number.isFinite(y0)) tangent = { curve: target.i, x0, y0, slope: derivative(f, x0) };
    }

    return { roots, intersections, extrema, integral, asymptotes, tangent, issues };
  }, [compiled, analysis, view.xmin, view.xmax, mode]);

  /* -------------------------- 顶部操作 -------------------------- */

  const applyPreset2D = useCallback((preset: Preset2D) => {
    setCurves(preset.curves.map((p, i) => makeCurve(i, {
      kind: p.kind,
      expr: p.expr ?? "",
      exprX: p.exprX ?? "",
      exprY: p.exprY ?? "",
      domainMin: p.domainMin ?? "",
      domainMax: p.domainMax ?? "",
    })));
    if (preset.view) setView(preset.view);
    setDisplay({ ...DEFAULT_DISPLAY, ...(preset.view && (preset.view.xmin <= 0 || preset.view.ymin <= 0) ? { xLog: false, yLog: false } : {}) });
    patchAnalysis({ ...DEFAULT_ANALYSIS, ...(preset.analysis ?? {}) });
    setFlashMessage(`已填入示例：${preset.name}`);
  }, [setCurves, setView, setDisplay, patchAnalysis]);

  const applyPreset3D = useCallback((preset: Preset3D) => {
    patchSurface(preset.patch);
    setFlashMessage(`已填入示例：${preset.name}`);
  }, [patchSurface]);

  const fillExample = useCallback(() => {
    if (mode === "2d") applyPreset2D(PRESETS_2D[0]);
    else applyPreset3D(PRESETS_3D[0]);
  }, [mode, applyPreset2D, applyPreset3D]);

  const clearAll = useCallback(() => {
    if (mode === "2d") {
      setCurves([]);
      setView(DEFAULT_VIEW);
      setDisplay(DEFAULT_DISPLAY);
      setAnalysis(DEFAULT_ANALYSIS);
      setFlashMessage("已清空全部函数");
    } else {
      setSurface(DEFAULT_SURFACE);
      setFlashMessage("已恢复默认曲面设置");
    }
  }, [mode, setCurves, setView, setDisplay, setAnalysis, setSurface]);

  const copyExpressions = useCallback(async () => {
    const text = mode === "2d"
      ? curves.filter((c) => c.visible).map(describeCurve).join("\n")
      : surface.kind === "z"
        ? `z = ${surface.z}`
        : `x = ${surface.px}\ny = ${surface.py}\nz = ${surface.pz}`;
    if (!text.trim()) { setFlashMessage("还没有可复制的函数式"); return; }
    try {
      await navigator.clipboard.writeText(text);
      setFlashMessage("已复制当前函数式");
    } catch {
      setFlashMessage("浏览器拒绝了剪贴板访问，请手动选中复制");
    }
  }, [mode, curves, surface]);

  const exportPng = useCallback(() => {
    const selector = mode === "2d" ? "canvas[data-graph2d]" : "canvas[data-graph3d]";
    const canvas = document.querySelector<HTMLCanvasElement>(selector);
    if (!canvas) { setFlashMessage("找不到画布，无法导出"); return; }
    try {
      const url = canvas.toDataURL("image/png");
      const a = document.createElement("a");
      a.href = url;
      a.download = `function-graph-${mode}-${Date.now()}.png`;
      a.click();
      setFlashMessage("已导出 PNG");
    } catch {
      setFlashMessage("导出失败，请改用系统截图");
    }
  }, [mode]);

  const on3DStats = useCallback((s: { vertexCount: number; lineCount: number; validRatio: number; buildMs: number }) => {
    setStats3d(s);
  }, []);

  /* -------------------------- 渲染 -------------------------- */

  const visibleCount = curves.filter((c) => c.visible).length;
  const issueCount = analysisData.issues.length;

  return (
    <div className="space-y-5">
      {/* 顶部操作条：只放控件，不放工具名与描述 */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-3 py-2.5">
        <div className="flex items-center gap-1 rounded-xl border border-border/60 bg-card/60 p-0.5">
          <Button variant={mode === "2d" ? "default" : "ghost"} size="sm" onClick={() => setMode("2d")}>
            二维图像
          </Button>
          <Button variant={mode === "3d" ? "default" : "ghost"} size="sm" onClick={() => setMode("3d")}>
            三维曲面
          </Button>
        </div>
        <span className="text-[11px] text-muted-foreground">
          {mode === "2d" ? `${visibleCount} 条可见曲线 · 滚轮缩放 / 拖拽平移 / 拖坐标轴单轴缩放 / 双击复位` : `拖拽旋转 · 滚轮缩放 · Shift+拖拽平移`}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {flashMessage && <Badge variant="success">{flashMessage}</Badge>}
          <Button variant="outline" size="sm" onClick={fillExample}>填入示例</Button>
          <Button variant="outline" size="sm" onClick={clearAll}><Trash2 className="h-3.5 w-3.5" />清空</Button>
          <Button variant="outline" size="sm" onClick={copyExpressions}><Copy className="h-3.5 w-3.5" />复制函数式</Button>
          <Button variant="outline" size="sm" onClick={exportPng}><Download className="h-3.5 w-3.5" />导出 PNG</Button>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-5">
        {/* 左栏：函数列表 + 参数 */}
        <div className="col-span-12 space-y-4 xl:col-span-4">
          {mode === "2d" ? (
            <>
              <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-4">
                <div className="flex items-center justify-between">
                  <Label>函数列表</Label>
                  <Badge variant="secondary">{curves.length} 条</Badge>
                </div>
                {curves.length === 0 && (
                  <p className="rounded-xl border border-dashed border-border/70 px-3 py-4 text-center text-[11px] text-muted-foreground">
                    还没有函数。点下面的「添加函数」，或直接点顶部的「填入示例」。
                  </p>
                )}
                {curves.map((c, index) => {
                  const cc = compiled[index];
                  const isTrace = c.kind === "parametric" || c.kind === "polar";
                  return (
                    <div key={c.id} className="space-y-2 rounded-xl border border-border/50 bg-background/40 p-3">
                      <div className="flex items-center gap-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 shrink-0 p-0"
                          title="点击切换颜色"
                          onClick={() => patchCurve(c.id, { color: CURVE_COLORS[(CURVE_COLORS.indexOf(c.color) + 1) % CURVE_COLORS.length] })}
                        >
                          <span className="h-3.5 w-3.5 rounded-full border border-border/60" style={{ background: c.color }} />
                        </Button>
                        <Select
                          value={c.kind}
                          className="min-w-0 flex-1"
                          onChange={(e) => patchCurve(c.id, { kind: e.target.value as CurveKind })}
                        >
                          <option value="explicit">显函数 y = f(x)</option>
                          <option value="implicit">隐函数 F(x, y) = 0</option>
                          <option value="parametric">参数方程 x(t), y(t)</option>
                          <option value="polar">极坐标 r(θ)</option>
                        </Select>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 shrink-0 p-0"
                          title={c.visible ? "隐藏这条曲线" : "显示这条曲线"}
                          onClick={() => patchCurve(c.id, { visible: !c.visible })}
                        >
                          {c.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 shrink-0 p-0"
                          title="删除这条曲线"
                          onClick={() => removeCurve(c.id)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>

                      {c.kind === "parametric" ? (
                        <div className="space-y-2">
                          <Input
                            className="h-9 font-mono-accent text-xs"
                            value={c.exprX}
                            placeholder="x(t) 例如 3*sin(3*t)"
                            onChange={(e) => patchCurve(c.id, { exprX: e.target.value })}
                          />
                          <Input
                            className="h-9 font-mono-accent text-xs"
                            value={c.exprY}
                            placeholder="y(t) 例如 3*sin(4*t)"
                            onChange={(e) => patchCurve(c.id, { exprY: e.target.value })}
                          />
                        </div>
                      ) : (
                        <Input
                          className="h-9 font-mono-accent text-xs"
                          value={c.expr}
                          placeholder={curvePlaceholder(c.kind)}
                          onChange={(e) => patchCurve(c.id, { expr: e.target.value })}
                        />
                      )}

                      <div className="flex items-center gap-2">
                        <span className="shrink-0 text-[11px] text-muted-foreground">
                          {c.kind === "parametric" ? "t 范围" : c.kind === "polar" ? "θ 范围" : "定义域"}
                        </span>
                        <Input
                          className="h-8 font-mono-accent text-[11px]"
                          value={c.domainMin}
                          placeholder={isTrace ? "0" : "最小值"}
                          onChange={(e) => patchCurve(c.id, { domainMin: e.target.value })}
                        />
                        <Input
                          className="h-8 font-mono-accent text-[11px]"
                          value={c.domainMax}
                          placeholder={isTrace ? "2π" : "最大值"}
                          onChange={(e) => patchCurve(c.id, { domainMax: e.target.value })}
                        />
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 shrink-0 px-2 text-[11px]"
                          title="恢复默认范围"
                          onClick={() => patchCurve(c.id, { domainMin: "", domainMax: "" })}
                        >
                          重置
                        </Button>
                      </div>

                      {cc && cc.error && (
                        <div className="flex items-start gap-2 rounded-xl border-l-4 border-l-destructive bg-destructive/10 px-3 py-2 font-mono text-[11px] leading-relaxed text-destructive">
                          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                          <span className="whitespace-pre-wrap break-all">{cc.error}</span>
                        </div>
                      )}
                    </div>
                  );
                })}
                <Button variant="outline" size="sm" className="w-full" onClick={addCurve}>
                  <Plus className="h-3.5 w-3.5" />添加函数
                </Button>
              </div>

              <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-4">
                <Label>快速示例</Label>
                <div className="flex flex-wrap gap-1.5">
                  {PRESETS_2D.map((p) => (
                    <ToggleChip key={p.name} on={false} onClick={() => applyPreset2D(p)}>{p.name}</ToggleChip>
                  ))}
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-4">
                <div className="flex items-center justify-between">
                  <Label>曲面设置</Label>
                  <Badge variant="secondary">{surface.grid} × {surface.grid}</Badge>
                </div>
                <Field label="曲面类型">
                  <Select value={surface.kind} onChange={(e) => patchSurface({ kind: e.target.value as Surface3DKind })}>
                    <option value="z">显式曲面 z = f(x, y)</option>
                    <option value="param">参数曲面 x(u,v), y(u,v), z(u,v)</option>
                  </Select>
                </Field>

                {surface.kind === "z" ? (
                  <>
                    <Field label="z = f(x, y)">
                      <Input
                        className="h-9 font-mono-accent text-xs"
                        value={surface.z}
                        placeholder="例如 sin(x) * cos(y)"
                        onChange={(e) => patchSurface({ z: e.target.value })}
                      />
                    </Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="x 最小"><Input className="h-8 font-mono-accent text-[11px]" value={surface.xmin} onChange={(e) => patchSurface({ xmin: e.target.value })} /></Field>
                      <Field label="x 最大"><Input className="h-8 font-mono-accent text-[11px]" value={surface.xmax} onChange={(e) => patchSurface({ xmax: e.target.value })} /></Field>
                      <Field label="y 最小"><Input className="h-8 font-mono-accent text-[11px]" value={surface.ymin} onChange={(e) => patchSurface({ ymin: e.target.value })} /></Field>
                      <Field label="y 最大"><Input className="h-8 font-mono-accent text-[11px]" value={surface.ymax} onChange={(e) => patchSurface({ ymax: e.target.value })} /></Field>
                    </div>
                  </>
                ) : (
                  <>
                    <Field label="x(u, v)"><Input className="h-9 font-mono-accent text-xs" value={surface.px} onChange={(e) => patchSurface({ px: e.target.value })} /></Field>
                    <Field label="y(u, v)"><Input className="h-9 font-mono-accent text-xs" value={surface.py} onChange={(e) => patchSurface({ py: e.target.value })} /></Field>
                    <Field label="z(u, v)"><Input className="h-9 font-mono-accent text-xs" value={surface.pz} onChange={(e) => patchSurface({ pz: e.target.value })} /></Field>
                    <div className="grid grid-cols-2 gap-2">
                      <Field label="u 最小"><Input className="h-8 font-mono-accent text-[11px]" value={surface.uMin} onChange={(e) => patchSurface({ uMin: e.target.value })} /></Field>
                      <Field label="u 最大"><Input className="h-8 font-mono-accent text-[11px]" value={surface.uMax} onChange={(e) => patchSurface({ uMax: e.target.value })} /></Field>
                      <Field label="v 最小"><Input className="h-8 font-mono-accent text-[11px]" value={surface.vMin} onChange={(e) => patchSurface({ vMin: e.target.value })} /></Field>
                      <Field label="v 最大"><Input className="h-8 font-mono-accent text-[11px]" value={surface.vMax} onChange={(e) => patchSurface({ vMax: e.target.value })} /></Field>
                    </div>
                  </>
                )}
              </div>

              <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-4">
                <Label>渲染选项</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="网格精度">
                    <Select value={String(surface.grid)} onChange={(e) => patchSurface({ grid: Number(e.target.value) })}>
                      <option value="56">低 56 × 56</option>
                      <option value="96">中 96 × 96</option>
                      <option value="144">高 144 × 144</option>
                    </Select>
                  </Field>
                  <Field label="等高线条数">
                    <Input
                      className="h-11 font-mono-accent text-xs"
                      type="number"
                      min={2}
                      max={24}
                      value={surface.contourCount}
                      onChange={(e) => patchSurface({ contourCount: Math.max(2, Math.min(24, Number(e.target.value) || 8)) })}
                    />
                  </Field>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <ToggleChip on={surface.wire} onClick={() => patchSurface({ wire: !surface.wire })}>网格线</ToggleChip>
                  <ToggleChip on={surface.contour} onClick={() => patchSurface({ contour: !surface.contour })}>等高线</ToggleChip>
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground/80">
                  高度着色默认开启：颜色随高度从蓝到红过渡。曲面几何只在表达式或范围变化时重建，旋转缩放只更新相机矩阵，所以拖动时不会因为重算顶点而卡。
                </p>
              </div>

              <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-4">
                <Label>曲面示例</Label>
                <div className="flex flex-wrap gap-1.5">
                  {PRESETS_3D.map((p) => (
                    <ToggleChip key={p.name} on={false} onClick={() => applyPreset3D(p)}>{p.name}</ToggleChip>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* 右栏：画布 + 读数 */}
        <div className="col-span-12 space-y-4 xl:col-span-8">
          <div className="rounded-2xl border border-border/70 bg-card p-2 shadow-xs">
            {mode === "2d" ? (
              <Canvas2D
                curves={deferredCurves}
                compiled={compiled}
                view={view}
                onViewChange={setView}
                display={display}
                analysis={analysis}
                data={analysisData}
                theme={theme}
                themeVersion={themeVersion}
              />
            ) : (
              <Canvas3D
                surface={surface}
                camera={camera}
                onCameraCommit={setCamera}
                theme={theme}
                themeVersion={themeVersion}
                onStats={on3DStats}
              />
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-2xl border border-border/70 bg-card px-4 py-3 text-[11px] text-muted-foreground">
            {mode === "2d" ? (
              <>
                <span>视图 x ∈ [{formatNumber(view.xmin)}, {formatNumber(view.xmax)}]，y ∈ [{formatNumber(view.ymin)}, {formatNumber(view.ymax)}]</span>
                <span>{display.xLog ? "X 轴对数" : "X 轴线性"} / {display.yLog ? "Y 轴对数" : "Y 轴线性"}</span>
                {issueCount > 0 && <span className="text-destructive">{issueCount} 条表达式有错误</span>}
              </>
            ) : (
              <>
                <span>{stats3d.vertexCount.toLocaleString()} 个顶点 · {stats3d.lineCount.toLocaleString()} 个网格线段</span>
                <span>有效面片 {Math.round(stats3d.validRatio * 100)}%</span>
                <span>几何构建 {stats3d.buildMs.toFixed(1)} ms</span>
              </>
            )}
          </div>

          {mode === "2d" && (
            <div className="grid grid-cols-12 gap-4">
              <div className="col-span-12 space-y-3 rounded-2xl border border-border/70 bg-card p-4 lg:col-span-6">
                <div className="flex items-center justify-between">
                  <Label>坐标系</Label>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <Field label="X 轴">
                    <Select
                      value={display.xLog ? "log" : "linear"}
                      onChange={(e) => patchDisplay({ xLog: e.target.value === "log" })}
                    >
                      <option value="linear">线性</option>
                      <option value="log">对数（只画正值）</option>
                    </Select>
                  </Field>
                  <Field label="Y 轴">
                    <Select
                      value={display.yLog ? "log" : "linear"}
                      onChange={(e) => patchDisplay({ yLog: e.target.value === "log" })}
                    >
                      <option value="linear">线性</option>
                      <option value="log">对数（只画正值）</option>
                    </Select>
                  </Field>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <ToggleChip on={display.grid} onClick={() => patchDisplay({ grid: !display.grid })}>网格</ToggleChip>
                  <ToggleChip on={display.ticks} onClick={() => patchDisplay({ ticks: !display.ticks })}>刻度</ToggleChip>
                  <Button variant="outline" size="sm" className="h-8 px-2.5 text-[11px]" onClick={() => setView(DEFAULT_VIEW)}>
                    <RotateCcw className="h-3.5 w-3.5" />回到原点
                  </Button>
                </div>
              </div>

              <div className="col-span-12 space-y-3 rounded-2xl border border-border/70 bg-card p-4 lg:col-span-6">
                <Label>分析</Label>
                <div className="flex flex-wrap gap-1.5">
                  <ToggleChip on={analysis.roots} onClick={() => patchAnalysis({ roots: !analysis.roots })}>零点</ToggleChip>
                  <ToggleChip on={analysis.intersections} onClick={() => patchAnalysis({ intersections: !analysis.intersections })}>交点</ToggleChip>
                  <ToggleChip on={analysis.extrema} onClick={() => patchAnalysis({ extrema: !analysis.extrema })}>极值</ToggleChip>
                  <ToggleChip on={analysis.tangent} onClick={() => patchAnalysis({ tangent: !analysis.tangent })}>切线</ToggleChip>
                  <ToggleChip on={analysis.integral} onClick={() => patchAnalysis({ integral: !analysis.integral })}>定积分</ToggleChip>
                  <ToggleChip on={analysis.asymptotes} onClick={() => patchAnalysis({ asymptotes: !analysis.asymptotes })}>渐近线</ToggleChip>
                </div>
                {analysis.tangent && (
                  <Field label="切线切点 x₀">
                    <Input
                      className="h-9 font-mono-accent text-xs"
                      value={analysis.tangentX}
                      onChange={(e) => patchAnalysis({ tangentX: e.target.value })}
                    />
                  </Field>
                )}
                {analysis.integral && (
                  <div className="grid grid-cols-2 gap-2">
                    <Field label="积分下限 a">
                      <Input
                        className="h-9 font-mono-accent text-xs"
                        value={analysis.integralA}
                        onChange={(e) => patchAnalysis({ integralA: e.target.value })}
                      />
                    </Field>
                    <Field label="积分上限 b">
                      <Input
                        className="h-9 font-mono-accent text-xs"
                        value={analysis.integralB}
                        onChange={(e) => patchAnalysis({ integralB: e.target.value })}
                      />
                    </Field>
                  </div>
                )}
                <p className="text-[11px] leading-relaxed text-muted-foreground/80">
                  分析与切线都作用在**第一条可见的显函数**上；交点则遍历全部可见曲线两两求交。
                </p>
              </div>
            </div>
          )}

          {mode === "2d" && (
            <div className="space-y-1 rounded-2xl border border-border/70 bg-card p-4">
              <div className="flex items-center gap-2 pb-1">
                <Sigma className="h-3.5 w-3.5 text-primary" />
                <Label>分析结果</Label>
              </div>
              {analysisData.issues.length > 0 && (
                <ResultRow label="表达式错误">
                  {analysisData.issues.map((i) => `${i.label}：${i.message}`).join("；")}
                </ResultRow>
              )}
              {analysis.roots && (
                <ResultRow label="零点">
                  {analysisData.roots.length === 0
                    ? "当前视图内没有找到零点"
                    : analysisData.roots.slice(0, 12).map((r) => `x = ${formatNumber(r.x)}`).join("，") + (analysisData.roots.length > 12 ? ` …共 ${analysisData.roots.length} 个` : "")}
                </ResultRow>
              )}
              {analysis.intersections && (
                <ResultRow label="交点">
                  {analysisData.intersections.length === 0
                    ? "当前视图内没有找到交点"
                    : analysisData.intersections.slice(0, 10).map((r) => `(${formatNumber(r.x)}, ${formatNumber(r.y)})`).join("，") + (analysisData.intersections.length > 10 ? ` …共 ${analysisData.intersections.length} 个` : "")}
                </ResultRow>
              )}
              {analysis.extrema && (
                <ResultRow label="极值">
                  {analysisData.extrema.length === 0
                    ? "当前视图内没有找到极值"
                    : analysisData.extrema.slice(0, 10).map((e) => `${e.kind === "max" ? "极大" : "极小"} (${formatNumber(e.x)}, ${formatNumber(e.y)})`).join("，") + (analysisData.extrema.length > 10 ? ` …共 ${analysisData.extrema.length} 个` : "")}
                </ResultRow>
              )}
              {analysis.integral && (
                <ResultRow label="定积分">
                  {analysisData.integral
                    ? `∫ 从 ${formatNumber(analysisData.integral.a)} 到 ${formatNumber(analysisData.integral.b)} ≈ ${formatNumber(analysisData.integral.value, 10)}（${analysisData.integral.method}）`
                    : "第一条可见曲线暂时不可求值"}
                </ResultRow>
              )}
              {analysis.tangent && (
                <ResultRow label="切线与导数">
                  {analysisData.tangent
                    ? `x₀ = ${formatNumber(analysisData.tangent.x0)}，f(x₀) = ${formatNumber(analysisData.tangent.y0)}，f′(x₀) = ${formatNumber(analysisData.tangent.slope)}`
                    : "第一条可见曲线暂时不可求导"}
                </ResultRow>
              )}
              {analysis.asymptotes && (
                <ResultRow label="渐近线">
                  {analysisData.asymptotes.length === 0
                    ? "没有检测到渐近线"
                    : analysisData.asymptotes.map((a) => {
                      const parts: string[] = [];
                      if (a.vertical.length) parts.push(`竖直 ${a.vertical.map((v) => `x = ${formatNumber(v)}`).join("、")}`);
                      if (a.horizontal.length) parts.push(`水平 ${a.horizontal.map((v) => `y = ${formatNumber(v)}`).join("、")}`);
                      if (a.oblique.length) parts.push(`斜 ${a.oblique.map((o) => `y = ${formatNumber(o.m)}x ${o.b >= 0 ? "+" : "−"} ${formatNumber(Math.abs(o.b))}`).join("、")}`);
                      return parts.join("；");
                    }).join(" | ")}
                </ResultRow>
              )}
              {!analysis.roots && !analysis.intersections && !analysis.extrema && !analysis.integral && !analysis.tangent && !analysis.asymptotes && (
                <p className="py-2 text-[11px] text-muted-foreground">打开左侧「分析」里的开关后，这里会列出零点、交点、极值、定积分、切线与渐近线的结果。</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default FunctionGraphTool;
