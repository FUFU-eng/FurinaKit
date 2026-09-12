"use client";

/**
 * 高等数学运算 —— 符号求导 / 极限 / 积分 / 微分方程 / 级数 / 线性代数 / 复数
 * ============================================================================
 * 核心是一套**自己写的符号运算引擎**（零第三方数学库）：
 *
 *   文本 → 归一化 → 词法分析 → 递归下降语法分析 → 表达式树（AST）
 *        → 化简 / 代入 / 求值 / 符号求导 / 符号积分 / 泰勒展开 / 部分分式 / 方程求解
 *        → 数值兜底（自适应 Simpson、tanh-sinh、RK4、有限差分、QR 迭代…）
 *
 * 一条硬规矩：**宁可说「算不了」，也绝不返回错误答案。**
 *   1. 符号积分的每个结果都会做「数值求导回代」自检（verifyAntiderivative），
 *      自检不过就当没算出来，退回数值解并如实告知；
 *   2. 求极限的符号结果都会用数值逼近（左右两侧 + Richardson 外推）复核，
 *      符号与数值冲突时只展示数值证据并标注「无法确定」；
 *   3. 任何未覆盖的形式统一抛 MathError（中文人话提示），界面原样展示。
 *
 * 文件末尾导出的 `__mathEngineForTest` 是给 Node 单测对拍用的纯函数入口
 * （引擎部分不依赖 React，可被 tsc 转译后在 Node 里直接跑）。
 */

import React, { useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Binary,
  BookOpen,
  Check,
  Copy,
  Eraser,
  Grid3x3,
  Infinity as InfinityIcon,
  Layers,
  Radar,
  Ruler,
  Sigma,
  SlidersHorizontal,
  Sparkles,
  SquareFunction,
  Table2,
  TrendingUp,
  Waves,
} from "lucide-react";
import { Badge, Button, Input, Label, Select, Textarea } from "@/components/ui/primitives";
import { useToolDraft } from "@/lib/use-tool-draft";
import { cn } from "@/lib/utils";

/* ==========================================================================
 * 第 0 部分：基础类型与工具
 * ========================================================================== */

/** 表达式树节点 */
export type Expr =
  | { k: "num"; v: number; n?: number; d?: number }
  | { k: "sym"; n: string }
  | { k: "add"; a: Expr; b: Expr }
  | { k: "mul"; a: Expr; b: Expr }
  | { k: "div"; a: Expr; b: Expr }
  | { k: "pow"; a: Expr; b: Expr }
  | { k: "fn"; n: string; a: Expr; b?: Expr };

/** 数值节点 */
export type NumNode = { k: "num"; v: number; n?: number; d?: number };

/** 引擎里所有可预期的失败都走这里，message 直接就是给用户看的中文 */
export class MathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MathError";
  }
}

function fail(msg: string): never {
  throw new MathError(msg);
}

/* ---------------------------- 精确有理数 ---------------------------- */

/**
 * 把浮点数还原成有理数（连分数展开）。
 * 只在「误差 < 1e-13 且分母 <= 1e6」时才认，避免把用户手写的 0.333333 误判成 1/3。
 */
export function toRational(x: number): [number, number] | null {
  if (!Number.isFinite(x)) return null;
  if (Math.abs(x - Math.round(x)) < 1e-12 * Math.max(1, Math.abs(x))) {
    const r = Math.round(x);
    if (Math.abs(r) <= 1e9) return [r, 1];
    return null;
  }
  const sign = x < 0 ? -1 : 1;
  const v = Math.abs(x);
  let h1 = 1;
  let h0 = 0;
  let k1 = 0;
  let k0 = 1;
  let b = v;
  for (let i = 0; i < 40; i += 1) {
    const a = Math.floor(b);
    const h2 = a * h1 + h0;
    const k2 = a * k1 + k0;
    if (k2 > 1e6 || h2 > 1e9) return null;
    h0 = h1;
    h1 = h2;
    k0 = k1;
    k1 = k2;
    if (Math.abs(h1 / k1 - v) < 1e-13 * Math.max(1, v)) return [sign * h1, k1];
    const frac = b - a;
    if (frac < 1e-15) break;
    b = 1 / frac;
    if (!Number.isFinite(b) || b > 1e15) break;
  }
  return null;
}

function gcdNum(a: number, b: number): number {
  let x = Math.abs(Math.round(a));
  let y = Math.abs(Math.round(b));
  while (y) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x || 1;
}

/** 生成数值节点；能精确表示成分数时把分子分母一起存下来（用于漂亮显示） */
export function num(v: number): NumNode {
  if (!Number.isFinite(v)) fail("计算过程中出现了无穷大或 NaN，请检查输入（例如是否出现了除以 0）");
  const r = toRational(v);
  if (r && r[1] !== 0) {
    const g = gcdNum(r[0], r[1]);
    let n = r[0] / g;
    let d = r[1] / g;
    if (d < 0) {
      n = -n;
      d = -d;
    }
    if (d > 1e6) return { k: "num", v };
    return { k: "num", v, n, d };
  }
  return { k: "num", v };
}

export function sym(name: string): Expr {
  return { k: "sym", n: name };
}

function isNum(e: Expr): e is NumNode {
  return e.k === "num";
}

function isSym(e: Expr, name?: string): e is { k: "sym"; n: string } {
  return e.k === "sym" && (name === undefined || e.n === name);
}

/** 取有理数表示；不是精确有理数就返回 null */
function rat(e: Expr): [number, number] | null {
  if (e.k !== "num") return null;
  if (e.n !== undefined && e.d !== undefined) return [e.n, e.d];
  return [e.v, 1];
}

function ratNum(t: [number, number]): NumNode {
  const [n0, d0] = t;
  if (d0 === 0) fail("除数为 0");
  const g = gcdNum(n0, d0);
  let n = n0 / g;
  let d = d0 / g;
  if (d < 0) {
    n = -n;
    d = -d;
  }
  if (d > 1e6 || Math.abs(n) > 1e9) return num(n / d);
  return { k: "num", v: n / d, n, d };
}

function ratAdd(a: [number, number], b: [number, number]): [number, number] {
  return [a[0] * b[1] + b[0] * a[1], a[1] * b[1]];
}

function ratMul(a: [number, number], b: [number, number]): [number, number] {
  return [a[0] * b[0], a[1] * b[1]];
}

/* ---------------------------- 构造助手 ---------------------------- */

const ZERO: NumNode = { k: "num", v: 0, n: 0, d: 1 };
const ONE: NumNode = { k: "num", v: 1, n: 1, d: 1 };
const MINUS_ONE: NumNode = { k: "num", v: -1, n: -1, d: 1 };

const add = (a: Expr, b: Expr): Expr => ({ k: "add", a, b });
const mul = (a: Expr, b: Expr): Expr => ({ k: "mul", a, b });
const div = (a: Expr, b: Expr): Expr => ({ k: "div", a, b });
const pow = (a: Expr, b: Expr): Expr => ({ k: "pow", a, b });
const fn = (n: string, a: Expr, b?: Expr): Expr => (b ? { k: "fn", n, a, b } : { k: "fn", n, a });
const neg = (a: Expr): Expr => mul(MINUS_ONE, a);
const sub = (a: Expr, b: Expr): Expr => add(a, neg(b));

/* ==========================================================================
 * 第 1 部分：文本归一化 + 词法分析
 * ========================================================================== */

/** 支持的单参数函数白名单（也是「裸写函数名是否需要括号」的判断依据） */
const FN_NAMES = new Set([
  "sin", "cos", "tan", "cot", "sec", "csc",
  "asin", "acos", "atan", "acot", "arcsin", "arccos", "arctan",
  "sinh", "cosh", "tanh", "coth", "asinh", "acosh", "atanh",
  "exp", "ln", "lg", "log", "log10", "log2", "sqrt", "cbrt",
  "abs", "sign", "floor", "ceil", "round", "trunc", "fact", "erf", "gamma",
]);

/** 两个参数的函数 */
const FN2_NAMES = new Set(["log", "max", "min", "root", "mod", "atan2"]);

/** 常量 */
const CONST_NAMES = new Set(["pi", "e", "inf"]);

/** 全角/数学符号 → 半角，让小白用户直接复制粘贴也能用 */
export function normalizeInput(src: string): string {
  const map: Record<string, string> = {
    "（": "(", "）": ")", "，": ",", "、": ",",
    "＋": "+", "－": "-", "—": "-", "–": "-", "−": "-",
    "＊": "*", "／": "/", "＝": "=", "．": ".",
    "＾": "^", "［": "[", "］": "]", "｛": "{", "｝": "}",
    "×": "*", "·": "*", "⋅": "*", "÷": "/",
    "≤": "<=", "≥": ">=", "≠": "!=",
    "∞": "inf", "π": "pi", "θ": "theta", "α": "alpha", "β": "beta",
    "γ": "gamma", "ω": "omega", "λ": "lambda", "μ": "mu", "σ": "sigma",
    "Δ": "Delta", "√": "sqrt", "\u00a0": " ", "\u3000": " ",
  };
  let s = "";
  for (const ch of src) s += map[ch] ?? ch;
  // 上标数字：x² → x^2；sin²x 这种写法有歧义，给出明确提示
  const sup: Record<string, string> = {
    "⁰": "0", "¹": "1", "²": "2", "³": "3", "⁴": "4",
    "⁵": "5", "⁶": "6", "⁷": "7", "⁸": "8", "⁹": "9",
  };
  let out = "";
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (sup[ch]) {
      let j = out.length - 1;
      while (j >= 0 && out[j] === " ") j -= 1;
      const prev = j >= 0 ? out[j] : "";
      if (/[A-Za-z]/.test(prev)) {
        let k = j;
        while (k >= 0 && /[A-Za-z0-9_]/.test(out[k])) k -= 1;
        const word = out.slice(k + 1, j + 1);
        if (FN_NAMES.has(word.toLowerCase())) {
          fail(`「${word}${ch}」这种写法有歧义，请写成 (${word}(x))^${sup[ch]} 这样带括号的形式`);
        }
      }
      out += `^${sup[ch]}`;
    } else {
      out += ch;
    }
  }
  return out;
}

export type Tok =
  | { t: "num"; v: number }
  | { t: "id"; s: string }
  | { t: "op"; s: string };

const OP_CHARS = "+-*/^(),=<>!|%";

/** 词法分析：把文本切成 num / id / op 三类记号 */
export function tokenize(src: string): Tok[] {
  const s = normalizeInput(src);
  const toks: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const ch = s[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i += 1;
      continue;
    }
    if (ch >= "0" && ch <= "9") {
      let j = i;
      while (j < s.length && s[j] >= "0" && s[j] <= "9") j += 1;
      if (s[j] === ".") {
        j += 1;
        while (j < s.length && s[j] >= "0" && s[j] <= "9") j += 1;
      }
      if (s[j] === "e" || s[j] === "E") {
        let k = j + 1;
        if (s[k] === "+" || s[k] === "-") k += 1;
        if (s[k] >= "0" && s[k] <= "9") {
          while (k < s.length && s[k] >= "0" && s[k] <= "9") k += 1;
          j = k;
        }
      }
      const text = s.slice(i, j);
      const v = Number(text);
      if (!Number.isFinite(v)) fail(`数字「${text}」无法识别`);
      toks.push({ t: "num", v });
      i = j;
      continue;
    }
    if (ch === "." && s[i + 1] >= "0" && s[i + 1] <= "9") {
      let j = i + 1;
      while (j < s.length && s[j] >= "0" && s[j] <= "9") j += 1;
      toks.push({ t: "num", v: Number(s.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < s.length && /[A-Za-z0-9_]/.test(s[j])) j += 1;
      toks.push({ t: "id", s: s.slice(i, j) });
      i = j;
      continue;
    }
    if (ch === "*" && s[i + 1] === "*") {
      toks.push({ t: "op", s: "^" });
      i += 2;
      continue;
    }
    if (OP_CHARS.includes(ch)) {
      toks.push({ t: "op", s: ch });
      i += 1;
      continue;
    }
    fail(`表达式里有不认识的字符「${ch}」，只支持数字、变量名、+ - * / ^ ( ) 这些符号`);
  }
  return toks;
}

/* ==========================================================================
 * 第 2 部分：语法分析（递归下降）
 * ========================================================================== */

const FN_ALIAS: Record<string, string> = {
  arcsin: "asin",
  arccos: "acos",
  arctan: "atan",
  log10: "lg",
};

function isReservedWord(name: string): boolean {
  const low = name.toLowerCase();
  return FN_NAMES.has(low) || FN2_NAMES.has(low) || CONST_NAMES.has(low);
}

class Parser {
  toks: Tok[];
  pos = 0;

  constructor(src: string) {
    this.toks = tokenize(src);
    if (this.toks.length === 0) fail("表达式是空的，请先输入一个式子");
  }

  peek(off = 0): Tok | undefined {
    return this.toks[this.pos + off];
  }

  next(): Tok {
    const t = this.toks[this.pos];
    if (!t) fail("表达式不完整，末尾缺少内容");
    this.pos += 1;
    return t;
  }

  eatOp(s: string): boolean {
    const t = this.peek();
    if (t && t.t === "op" && t.s === s) {
      this.pos += 1;
      return true;
    }
    return false;
  }

  expectOp(s: string): void {
    if (!this.eatOp(s)) fail(`表达式里少了一个「${s}」`);
  }

  /** 表达式：加减 */
  parseExpr(): Expr {
    let left = this.parseTerm();
    for (;;) {
      const t = this.peek();
      if (t && t.t === "op" && (t.s === "+" || t.s === "-")) {
        this.pos += 1;
        const right = this.parseTerm();
        left = t.s === "+" ? add(left, right) : sub(left, right);
      } else break;
    }
    return left;
  }

  /** 项：乘除（含隐式乘法 2x / 3(x+1) / (x+1)(x-1)） */
  parseTerm(): Expr {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t && t.t === "op" && (t.s === "*" || t.s === "/")) {
        this.pos += 1;
        const right = this.parseUnary();
        left = t.s === "*" ? mul(left, right) : div(left, right);
        continue;
      }
      // 隐式乘法：只允许「数字 / 右括号」后面紧跟 变量名 / 左括号
      if (t && (t.t === "num" || (t.t === "op" && t.s === "(") || (t.t === "id" && !isReservedWord(t.s)))) {
        if (endsWithOperand(left)) {
          // 「x y」这种两个变量名贴在一起有歧义（xy 会被当成一个变量名）
          if (t.t === "id" && endsWithSymbol(left)) {
            fail(
              `「${printExpr(left)}」和「${t.s}」之间缺少运算符：想表示乘法请写成 ${printExpr(left)}*${t.s}（两个字母连写会被当成一个变量名）`,
            );
          }
          const right = this.parseUnary();
          left = mul(left, right);
          continue;
        }
      }
      break;
    }
    return left;
  }

  /** 一元正负号（-x^2 解析成 -(x^2)，与数学课本一致） */
  parseUnary(): Expr {
    const t = this.peek();
    if (t && t.t === "op" && (t.s === "+" || t.s === "-")) {
      this.pos += 1;
      const operand = this.parseUnary();
      return t.s === "-" ? neg(operand) : operand;
    }
    return this.parsePower();
  }

  /** 幂：右结合，且允许 2^-1 */
  parsePower(): Expr {
    const base = this.parsePostfix();
    if (this.eatOp("^")) {
      const exponent = this.parseUnary();
      return pow(base, exponent);
    }
    return base;
  }

  /** 后缀：阶乘 x! */
  parsePostfix(): Expr {
    const e = this.parseAtom();
    if (this.eatOp("!")) return fn("fact", e);
    return e;
  }

  parseAtom(): Expr {
    const t = this.next();
    if (t.t === "num") return num(t.v);
    if (t.t === "op" && t.s === "(") {
      const inner = this.parseExpr();
      this.expectOp(")");
      return inner;
    }
    if (t.t === "op" && t.s === "|") {
      const inner = this.parseExpr();
      if (!this.eatOp("|")) fail("绝对值符号 | 没有配对");
      return fn("abs", inner);
    }
    if (t.t === "op" && (t.s === "+" || t.s === "-")) {
      const operand = this.parseUnary();
      return t.s === "-" ? neg(operand) : operand;
    }
    if (t.t === "id") {
      const raw = t.s;
      const low = raw.toLowerCase();
      if (low === "pi") return sym("pi");
      if (low === "e" && raw === "e") return sym("e");
      if (low === "inf" || low === "infinity") return sym("inf");
      const name = FN_ALIAS[low] ?? low;
      if (FN_NAMES.has(low)) {
        if (this.eatOp("(")) {
          const args = [this.parseExpr()];
          while (this.eatOp(",")) args.push(this.parseExpr());
          this.expectOp(")");
          if (args.length === 1) return fn(name, args[0]);
          if (args.length === 2 && FN2_NAMES.has(name)) return fn(name, args[0], args[1]);
          fail(`函数 ${raw} 的参数个数不对`);
        }
        // 裸写函数名（sin x）：参数取接下来的一个「幂次单元」，后面紧跟记号就报歧义
        const arg = this.parsePower();
        const nx = this.peek();
        if (nx && (nx.t === "num" || nx.t === "id" || (nx.t === "op" && nx.s === "("))) {
          fail(`函数 ${raw} 的参数有歧义，请用括号写清楚，例如 ${raw}(x+1)`);
        }
        return fn(name, arg);
      }
      if (FN2_NAMES.has(low)) {
        this.expectOp("(");
        const a1 = this.parseExpr();
        this.expectOp(",");
        const a2 = this.parseExpr();
        this.expectOp(")");
        return fn(name, a1, a2);
      }
      return sym(raw);
    }
    fail("表达式里有无法解析的内容");
  }
}

/** 判断一个子表达式「以操作数结尾」（用于隐式乘法判断） */
function endsWithOperand(e: Expr): boolean {
  switch (e.k) {
    case "num":
    case "sym":
    case "fn":
      return true;
    default:
      return endsWithOperand(e.b);
  }
}

/** 判断一个子表达式「以变量名结尾」（用于拒绝 x y 这种歧义写法） */
function endsWithSymbol(e: Expr): boolean {
  switch (e.k) {
    case "sym":
      return true;
    case "num":
    case "fn":
      return false;
    default:
      return endsWithSymbol(e.b);
  }
}

/** 解析入口 */
export function parse(src: string): Expr {
  return new Parser(src).parseExpr();
}

/** 解析并要求整串被消费完（用于方程这类输入） */
export function parseStrict(src: string, what = "表达式"): Expr {
  const p = new Parser(src);
  const e = p.parseExpr();
  if (p.pos !== p.toks.length) fail(`${what}「${src}」里有多余的内容解析不了`);
  return e;
}

/* ==========================================================================
 * 第 3 部分：输出成文本
 * ========================================================================== */

const PREC_ADD = 1;
const PREC_MUL = 2;
const PREC_POW = 3;
const PREC_ATOM = 4;

function fmtNum(n: number): string {
  if (Number.isInteger(n)) return String(n);
  const a = Math.abs(n);
  if (a !== 0 && (a < 1e-4 || a >= 1e6)) return n.toExponential(6);
  return String(Number(n.toPrecision(12)));
}

function numText(e: NumNode): string {
  if (e.n !== undefined && e.d !== undefined && e.d !== 1) {
    return e.n < 0 ? `-${-e.n}/${e.d}` : `${e.n}/${e.d}`;
  }
  return fmtNum(e.v);
}

/** 取相反数（精确有理数不丢分母） */
function negateNumber(e: NumNode): NumNode {
  if (e.n !== undefined && e.d !== undefined) return ratNum([-e.n, e.d]);
  return num(-e.v);
}

function numPrec(e: NumNode): number {
  if (e.d !== undefined && e.d !== 1) return PREC_MUL;
  if (e.v < 0) return PREC_ADD;
  return PREC_ATOM;
}

function precOf(e: Expr): number {
  switch (e.k) {
    case "num":
      return numPrec(e);
    case "add":
      return PREC_ADD;
    case "mul":
    case "div":
      return PREC_MUL;
    case "pow":
      return PREC_POW;
    default:
      return PREC_ATOM;
  }
}

function wrap(e: Expr, minPrec: number): string {
  const s = printExpr(e);
  return precOf(e) < minPrec ? `(${s})` : s;
}

/** 把「数字系数 × 其余部分」拆开（会穿过嵌套的乘法，2·x·y → 2 与 x·y） */
function splitCoef(e: Expr): { coef: NumNode; rest: Expr } {
  const rest: Expr[] = [];
  let coef: [number, number] = [1, 1];
  const walk = (node: Expr): void => {
    if (node.k === "mul") {
      walk(node.a);
      walk(node.b);
      return;
    }
    if (isNum(node)) {
      coef = ratMul(coef, rat(node) ?? [node.v, 1]);
      return;
    }
    rest.push(node);
  };
  walk(e);
  if (rest.length === 0) return { coef: ratNum(coef), rest: ONE };
  return { coef: ratNum(coef), rest: rebuildMul(rest) };
}

/** 表达式 → 纯文本（ASCII 风格，便于复制） */
export function printExpr(e: Expr): string {
  switch (e.k) {
    case "num":
      return numText(e);
    case "sym":
      return e.n === "inf" ? "∞" : e.n;
    case "add": {
      const b = e.b;
      if (isNum(b) && b.v < 0) return `${wrap(e.a, PREC_ADD)} - ${wrap(negateNumber(b), PREC_ADD)}`;
      if (b.k === "mul") {
        const c = splitCoef(b);
        if (c.coef.v < 0) {
          return `${wrap(e.a, PREC_ADD)} - ${wrap(mul(negateNumber(c.coef), c.rest), PREC_ADD)}`;
        }
      }
      return `${wrap(e.a, PREC_ADD)} + ${wrap(b, PREC_MUL)}`;
    }
    case "mul": {
      const { coef, rest } = splitCoef(e);
      const factors: Expr[] = [];
      flattenMul(rest, factors);
      const sign = coef.v < 0 ? "-" : "";
      const absCoef = coef.v < 0 ? negateNumber(coef) : coef;
      const coefIsOne = absCoef.v === 1;
      const coefText = absCoef.d !== undefined && absCoef.d !== 1 ? `(${numText(absCoef)})` : numText(absCoef);
      if (
        factors.length === 1 &&
        !coefIsOne &&
        (factors[0].k === "sym" || factors[0].k === "fn" || factors[0].k === "pow")
      ) {
        return `${sign}${coefText}${wrap(factors[0], PREC_MUL)}`;
      }
      const pieces: string[] = [];
      if (!coefIsOne) pieces.push(coefText);
      for (const f of factors) pieces.push(wrap(f, PREC_MUL));
      if (pieces.length === 0) return numText(coef);
      return sign + pieces.join("*");
    }
    case "div": {
      if (isNum(e.a) && e.a.v < 0) {
        return `-${printExpr({ k: "div", a: negateNumber(e.a), b: e.b })}`;
      }
      return `${wrap(e.a, PREC_MUL)}/${wrap(e.b, PREC_POW)}`;
    }
    case "pow":
      return `${wrap(e.a, PREC_ATOM)}^${wrap(e.b, PREC_ATOM)}`;
    case "fn": {
      if (e.n === "abs") return `abs(${printExpr(e.a)})`;
      if (e.b) return `${e.n}(${printExpr(e.a)}, ${printExpr(e.b)})`;
      return `${e.n}(${printExpr(e.a)})`;
    }
    default:
      return "?";
  }
}

/** 规范键：全括号形式，用于表达式相等判断与去重 */
export function keyOf(e: Expr): string {
  switch (e.k) {
    case "num":
      return `#${numText(e)}`;
    case "sym":
      return e.n;
    case "fn":
      return `${e.n}(${keyOf(e.a)}${e.b ? "," + keyOf(e.b) : ""})`;
    case "add":
      return `(+ ${keyOf(e.a)} ${keyOf(e.b)})`;
    case "mul":
      return `(* ${keyOf(e.a)} ${keyOf(e.b)})`;
    case "div":
      return `(/ ${keyOf(e.a)} ${keyOf(e.b)})`;
    case "pow":
      return `(^ ${keyOf(e.a)} ${keyOf(e.b)})`;
    default:
      return "?";
  }
}

/** 结构相等 */
export function sameExpr(a: Expr, b: Expr): boolean {
  return keyOf(a) === keyOf(b);
}

/* ==========================================================================
 * 第 4 部分：遍历 / 代入 / 求值
 * ========================================================================== */

function children(e: Expr): Expr[] {
  switch (e.k) {
    case "num":
    case "sym":
      return [];
    case "fn":
      return e.b ? [e.a, e.b] : [e.a];
    default:
      return [e.a, e.b];
  }
}

/** 收集自由变量名 */
export function freeVars(e: Expr, out = new Set<string>()): Set<string> {
  if (e.k === "sym") {
    if (e.n !== "pi" && e.n !== "e" && e.n !== "inf") out.add(e.n);
    return out;
  }
  for (const c of children(e)) freeVars(c, out);
  return out;
}

/** 是否含有某个变量 */
export function hasVar(e: Expr, name: string): boolean {
  if (e.k === "sym") return e.n === name;
  for (const c of children(e)) if (hasVar(c, name)) return true;
  return false;
}

/** 与某变量无关 */
export function freeOf(e: Expr, name: string): boolean {
  return !hasVar(e, name);
}

/** 代入：把变量替换成表达式 */
export function subst(e: Expr, name: string, replacement: Expr): Expr {
  if (e.k === "sym") return e.n === name ? replacement : e;
  if (e.k === "num") return e;
  if (e.k === "fn") {
    return { k: "fn", n: e.n, a: subst(e.a, name, replacement), b: e.b ? subst(e.b, name, replacement) : undefined };
  }
  const nk = e.k;
  return { k: nk, a: subst(e.a, name, replacement), b: subst(e.b, name, replacement) } as Expr;
}

/** 同时代入多个变量 */
export function substAll(e: Expr, map: Record<string, Expr>): Expr {
  let r = e;
  for (const [k, v] of Object.entries(map)) r = subst(r, k, v);
  return r;
}

/** 把「某个子表达式」整体换成另一个表达式（换元积分用；按结构匹配） */
export function substExpr(e: Expr, target: Expr, replacement: Expr): Expr {
  if (keyOf(e) === keyOf(target)) return replacement;
  switch (e.k) {
    case "num":
    case "sym":
      return e;
    case "fn":
      return {
        k: "fn",
        n: e.n,
        a: substExpr(e.a, target, replacement),
        b: e.b ? substExpr(e.b, target, replacement) : undefined,
      };
    default:
      return {
        k: e.k,
        a: substExpr(e.a, target, replacement),
        b: substExpr(e.b, target, replacement),
      } as Expr;
  }
}

/* ------------------------------ 函数求值表 ------------------------------ */

function erfApprox(x: number): number {
  // Abramowitz & Stegun 7.1.26
  const s = Math.sign(x);
  const z = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * z);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-z * z);
  return s * y;
}

function gammaApprox(x: number): number {
  if (x < 0.5) return Math.PI / (Math.sin(Math.PI * x) * gammaApprox(1 - x));
  const g = [
    676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  const z = x - 1;
  let a = 0.99999999999980993;
  for (let i = 0; i < g.length; i += 1) a += g[i] / (z + i + 1);
  const t = z + g.length - 0.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, z + 0.5) * Math.exp(-t) * a;
}

const FN1: Record<string, (x: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  cot: (x) => 1 / Math.tan(x),
  sec: (x) => 1 / Math.cos(x),
  csc: (x) => 1 / Math.sin(x),
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  acot: (x) => Math.PI / 2 - Math.atan(x),
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  coth: (x) => 1 / Math.tanh(x),
  asinh: Math.asinh,
  acosh: Math.acosh,
  atanh: Math.atanh,
  exp: Math.exp,
  ln: Math.log,
  lg: Math.log10,
  log2: Math.log2,
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  sign: Math.sign,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  trunc: Math.trunc,
  erf: erfApprox,
  gamma: gammaApprox,
};

function factNum(n: number): number {
  if (n < 0) return NaN;
  if (Number.isInteger(n)) {
    if (n > 170) return Infinity;
    let r = 1;
    for (let i = 2; i <= n; i += 1) r *= i;
    return r;
  }
  return gammaApprox(n + 1);
}

/** 数值求值（变量表里缺变量会抛错） */
export function evalExpr(e: Expr, vars: Record<string, number> = {}): number {
  switch (e.k) {
    case "num":
      return e.v;
    case "sym": {
      if (e.n === "pi") return Math.PI;
      if (e.n === "e") return Math.E;
      if (e.n === "inf") return Infinity;
      const v = vars[e.n];
      if (v === undefined) fail(`变量「${e.n}」没有给值`);
      return v;
    }
    case "add":
      return evalExpr(e.a, vars) + evalExpr(e.b, vars);
    case "mul":
      return evalExpr(e.a, vars) * evalExpr(e.b, vars);
    case "div":
      return evalExpr(e.a, vars) / evalExpr(e.b, vars);
    case "pow":
      return Math.pow(evalExpr(e.a, vars), evalExpr(e.b, vars));
    case "fn": {
      const a = evalExpr(e.a, vars);
      if (e.n === "fact") return factNum(a);
      if (e.b !== undefined) {
        const b = evalExpr(e.b, vars);
        if (e.n === "log") return Math.log(a) / Math.log(b);
        if (e.n === "root") return Math.sign(a) * Math.pow(Math.abs(a), 1 / b);
        if (e.n === "max") return Math.max(a, b);
        if (e.n === "min") return Math.min(a, b);
        if (e.n === "mod") return a % b;
        if (e.n === "atan2") return Math.atan2(a, b);
        fail(`暂不支持的双参数函数 ${e.n}`);
      }
      const f = FN1[e.n];
      if (!f) fail(`暂不支持的函数 ${e.n}(x)`);
      return f(a);
    }
    default:
      return NaN;
  }
}

/* ---------------------- 多项式系数提取（精确） ---------------------- */

/**
 * 把一个表达式看成一元多项式，抽出系数（从 0 次到 n 次）。
 * 不是多项式（含 sin / 分式 / x 在指数上）就返回 null。
 */
export function asPoly(e: Expr, v: string): Expr[] | null {
  switch (e.k) {
    case "num":
      return [e];
    case "sym":
      if (e.n === v) return [ZERO, ONE];
      // 【修正】除 v 之外的字母（含 pi、e）都与 v 无关，应当当作「系数」，和下面 fn / pow
      // 分支的处理保持一致。原实现只认 pi / e、其它字母一律返回 null，于是 x*y 对 y 不是
      // 一次式 —— 一阶线性微分方程 y′ = x·y 因此被漏掉（linearIn 返回 null）。
      return [e];
    case "add": {
      const A = asPoly(e.a, v);
      const B = asPoly(e.b, v);
      if (!A || !B) return null;
      const out: Expr[] = [];
      for (let i = 0; i < Math.max(A.length, B.length); i += 1) out.push(add(A[i] ?? ZERO, B[i] ?? ZERO));
      return out;
    }
    case "mul": {
      const A = asPoly(e.a, v);
      const B = asPoly(e.b, v);
      if (!A || !B) return null;
      const out: Expr[] = new Array(A.length + B.length - 1).fill(ZERO).map(() => ZERO);
      for (let i = 0; i < A.length; i += 1) {
        for (let j = 0; j < B.length; j += 1) out[i + j] = add(out[i + j], mul(A[i], B[j]));
      }
      return out;
    }
    case "div": {
      const A = asPoly(e.a, v);
      const B = asPoly(e.b, v);
      if (!A || !B || B.length !== 1) return null;
      return A.map((c) => div(c, B[0]));
    }
    case "pow": {
      if (isNum(e.b) && Number.isInteger(e.b.v) && e.b.v >= 0 && e.b.v <= 20) {
        const A = asPoly(e.a, v);
        if (!A) return null;
        let out: Expr[] = [ONE];
        for (let i = 0; i < e.b.v; i += 1) {
          const next: Expr[] = new Array(out.length + A.length - 1).fill(ZERO).map(() => ZERO);
          for (let p = 0; p < out.length; p += 1) {
            for (let q = 0; q < A.length; q += 1) next[p + q] = add(next[p + q], mul(out[p], A[q]));
          }
          out = next;
        }
        return out;
      }
      if (freeOf(e, v)) return [e];
      return null;
    }
    case "fn":
      if (freeOf(e, v)) return [e];
      return null;
    default:
      return null;
  }
}

/** 是不是「一定是 0」（含未化简的 add/mul 结构） */
function isDefinitelyZero(e: Expr): boolean {
  switch (e.k) {
    case "num":
      return e.v === 0;
    case "mul":
      return isDefinitelyZero(e.a) || isDefinitelyZero(e.b);
    case "add":
      return isDefinitelyZero(e.a) && isDefinitelyZero(e.b);
    case "div":
      return isDefinitelyZero(e.a);
    default:
      return false;
  }
}

/** 多项式次数（去零后） */
function polyDeg(c: Expr[] | null): number {
  if (!c) return -1;
  let d = c.length - 1;
  while (d >= 0 && isDefinitelyZero(c[d])) d -= 1;
  return d;
}

/* ==========================================================================
 * 第 5 部分：化简
 * ========================================================================== */

function flattenAdd(e: Expr, out: Expr[]): void {
  if (e.k === "add") {
    flattenAdd(e.a, out);
    flattenAdd(e.b, out);
  } else out.push(e);
}

function flattenMul(e: Expr, out: Expr[]): void {
  if (e.k === "mul") {
    flattenMul(e.a, out);
    flattenMul(e.b, out);
  } else out.push(e);
}

function rebuildAdd(terms: Expr[]): Expr {
  const list = terms.filter((t) => !(t.k === "num" && t.v === 0));
  if (list.length === 0) return ZERO;
  if (list.length === 1) return list[0];
  let acc = list[0];
  for (let i = 1; i < list.length; i += 1) acc = add(acc, list[i]);
  return acc;
}

function rebuildMul(factors: Expr[]): Expr {
  const list = factors.filter((f) => !(f.k === "num" && f.v === 1));
  if (list.some((f) => f.k === "num" && f.v === 0)) return ZERO;
  if (list.length === 0) return ONE;
  if (list.length === 1) return list[0];
  let acc = list[0];
  for (let i = 1; i < list.length; i += 1) acc = mul(acc, list[i]);
  return acc;
}

function factorRank(e: Expr): number {
  if (isNum(e)) return 0;
  if (e.k === "sym") return 1;
  if (e.k === "pow" && e.a.k === "sym") return 2;
  if (e.k === "fn") return 3;
  if (e.k === "pow") return 4;
  return 5;
}

function sortFactors(list: Expr[]): Expr[] {
  return [...list].sort((x, y) => {
    const rx = factorRank(x);
    const ry = factorRank(y);
    if (rx !== ry) return rx - ry;
    return keyOf(x) < keyOf(y) ? -1 : keyOf(x) > keyOf(y) ? 1 : 0;
  });
}

/** 该项在「主变量」上的次数（用于把多项式按降幂排列） */
function termDegree(e: Expr, v: string | null): number {
  if (!v) return 0;
  return Math.max(0, polyDeg(asPoly(e, v)));
}

function mainVarOf(e: Expr): string | null {
  const vs = Array.from(freeVars(e)).sort();
  return vs.length ? vs[0] : null;
}

function sortTerms(list: Expr[], v: string | null): Expr[] {
  return [...list].sort((x, y) => {
    const dx = termDegree(x, v);
    const dy = termDegree(y, v);
    if (dx !== dy) return dy - dx;
    // 同次的把正系数项排前面：显示成 x^2 - 3x 而不是 -3x + x^2
    const sx = splitCoef(x).coef.v < 0 ? 1 : 0;
    const sy = splitCoef(y).coef.v < 0 ? 1 : 0;
    if (sx !== sy) return sx - sy;
    return keyOf(x) < keyOf(y) ? -1 : keyOf(x) > keyOf(y) ? 1 : 0;
  });
}

function simplifyAdd(a: Expr, b: Expr): Expr {
  const raw: Expr[] = [];
  flattenAdd(a, raw);
  flattenAdd(b, raw);
  let numeric: [number, number] = [0, 1];
  const order: string[] = [];
  const groups = new Map<string, { coef: [number, number]; rest: Expr }>();
  for (const item of raw) {
    const t = simplify(item);
    if (isNum(t)) {
      numeric = ratAdd(numeric, rat(t) ?? [t.v, 1]);
      continue;
    }
    const { coef, rest } = splitCoef(t);
    const k = keyOf(rest);
    const g = groups.get(k);
    if (g) g.coef = ratAdd(g.coef, rat(coef) ?? [coef.v, 1]);
    else {
      groups.set(k, { coef: rat(coef) ?? [coef.v, 1], rest });
      order.push(k);
    }
  }
  const terms: Expr[] = [];
  for (const k of order) {
    const g = groups.get(k)!;
    if (g.coef[0] === 0) continue;
    const coefExpr = ratNum(g.coef);
    terms.push(isNum(coefExpr) && coefExpr.v === 1 ? g.rest : simplifyMul(coefExpr, g.rest));
  }
  const sorted = sortTerms(terms, mainVarOf(a.k === "num" ? b : a));
  const numPart = numeric[0] !== 0 ? ratNum(numeric) : null;
  if (numPart) sorted.push(numPart);
  return rebuildAdd(sorted);
}

function simplifyMul(a: Expr, b: Expr): Expr {
  const raw: Expr[] = [];
  flattenMul(a, raw);
  flattenMul(b, raw);
  let coef: [number, number] = [1, 1];
  const numerator: Expr[] = [];
  const denominator: Expr[] = [];
  const groupOrder: string[] = [];
  const groups = new Map<string, { base: Expr; exps: Expr[] }>();
  const addGroup = (base: Expr, exp: Expr, negative: boolean) => {
    const k = keyOf(base);
    // 分母里的因子按「负指数」记，这样 x·(1/x) 会自然抵消成 1
    const signedExp = negative ? simplifyMul(exp, MINUS_ONE) : exp;
    const g = groups.get(k);
    if (g) g.exps.push(signedExp);
    else {
      groups.set(k, { base, exps: [signedExp] });
      groupOrder.push(k);
    }
  };
  for (const item of raw) {
    const f = simplify(item);
    if (isNum(f)) {
      coef = ratMul(coef, rat(f) ?? [f.v, 1]);
      continue;
    }
    // 因子本身是「数字 × 东西」：把数字提到最外层，符号更整齐（2x·3y → 6xy）
    if (f.k === "mul" && isNum(f.a)) {
      coef = ratMul(coef, rat(f.a) ?? [f.a.v, 1]);
      addGroup(f.b, ONE, false);
      continue;
    }
    if (f.k === "div") {
      if (isNum(f.a)) {
        coef = ratMul(coef, rat(f.a) ?? [f.a.v, 1]);
        addGroup(f.b, ONE, true);
        continue;
      }
      addGroup(f, ONE, false);
      continue;
    }
    if (f.k === "pow") {
      addGroup(f.a, f.b, false);
      continue;
    }
    addGroup(f, ONE, false);
  }
  for (const k of groupOrder) {
    const g = groups.get(k)!;
    const expSum = simplify(g.exps.reduce((acc, x) => add(acc, x), ZERO));
    if (isNum(expSum) && expSum.v === 0) continue;
    if (isNum(expSum) && expSum.v < 0) {
      denominator.push(expSum.v === -1 ? g.base : simplifyPow(g.base, num(-expSum.v)));
      continue;
    }
    if (isNum(expSum) && expSum.v === 1) numerator.push(g.base);
    else numerator.push(simplifyPow(g.base, expSum));
  }
  const coefNode = ratNum(coef);
  const numList = sortFactors(numerator);
  if (!(isNum(coefNode) && coefNode.v === 1) || numList.length === 0) numList.unshift(coefNode);
  if (denominator.length === 0) return rebuildMul(numList);
  return simplifyDiv(rebuildMul(numList), rebuildMul(sortFactors(denominator)));
}

function simplifyPow(a: Expr, b: Expr): Expr {
  if (isNum(b)) {
    if (b.v === 0) return ONE;
    if (b.v === 1) return a;
    if (b.v < 0) return simplifyDiv(ONE, simplifyPow(a, num(-b.v)));
  }
  if (isNum(a)) {
    if (a.v === 1) return ONE;
    if (a.v === 0 && isNum(b) && b.v > 0) return ZERO;
    if (isNum(b)) {
      if (Number.isInteger(b.v)) {
        const v = Math.pow(a.v, b.v);
        if (Number.isFinite(v)) return num(v);
      } else {
        // 分数指数：只在结果是漂亮有理数时才化成数，否则保留根号（2^(1/2) 不该变成 1.414…）
        const r = b.n !== undefined && b.d !== undefined ? [b.n, b.d] : toRational(b.v);
        if (r && r[1] > 1 && r[1] <= 64) {
          const rootSpec = Math.pow(Math.abs(a.v), 1 / r[1]);
          const rounded = Math.round(rootSpec);
          if (rounded > 0 && Math.abs(rootSpec - rounded) < 1e-9) {
            const sign = a.v < 0 ? (r[1] % 2 === 1 ? -1 : NaN) : 1;
            if (!Number.isNaN(sign) && r[0] > 0) {
              const v = sign * Math.pow(rounded, r[0]);
              if (Number.isFinite(v)) return num(v);
            }
          }
        }
      }
    }
  }
  if (isNum(b) && a.k === "pow" && isNum(a.b) && Number.isInteger(a.b.v) && Number.isInteger(b.v)) {
    return simplifyPow(a.a, num(a.b.v * b.v));
  }
  if (a.k === "sym" && a.n === "e" && b.k === "fn" && b.n === "ln") return b.a;
  if (b.k === "fn" && b.n === "ln" && isSym(a, "e")) return b;
  if (a.k === "pow" && isSym(a.a, "e")) return simplifyPow(a.a, simplify(mul(a.b, b)));
  if (isNum(b) && b.n === 2 && b.d === 1 && a.k === "fn" && a.n === "sqrt") return a.a;
  return { k: "pow", a, b };
}

function simplifyDiv(a: Expr, b: Expr): Expr {
  if (isNum(a) && isNum(b)) {
    if (b.v === 0) fail("分母算出来是 0，无法继续计算（请检查是否输入了除以 0 的式子）");
    if (a.v === 0) return ZERO;
    return num(a.v / b.v);
  }
  if (isNum(a) && a.v === 0) return ZERO;
  if (isNum(b) && b.v === 1) return a;
  if (isNum(b) && b.v === -1) return simplifyMul(a, MINUS_ONE);
  if (sameExpr(a, b)) return ONE;
  if (isNum(b)) return simplifyMul(num(1 / b.v), a);
  // (p/q)/r → p/(q·r)：先合并成一层，才好看清公共因子
  if (a.k === "div") return simplifyDiv(a.a, simplifyMul(a.b, b));
  if (a.k === "pow" && b.k === "pow" && sameExpr(a.a, b.a)) return simplifyPow(a.a, simplify(sub(a.b, b.b)));
  if (a.k === "pow" && sameExpr(a.a, b)) return simplifyPow(a.a, simplify(sub(a.b, ONE)));
  if (b.k === "pow" && sameExpr(b.a, a)) return simplifyPow(a, simplify(sub(ONE, b.b)));
  // 分子分母有完全相同的因子 → 约掉（规模严格变小，所以不会死循环）
  if (a.k === "mul" || b.k === "mul") {
    const aF: Expr[] = [];
    const bF: Expr[] = [];
    flattenMul(a, aF);
    flattenMul(b, bF);
    for (let i = 0; i < aF.length; i += 1) {
      for (let j = 0; j < bF.length; j += 1) {
        if (keyOf(aF[i]) === keyOf(bF[j])) {
          return simplifyDiv(
            rebuildMul(aF.filter((_, k) => k !== i)),
            rebuildMul(bF.filter((_, k) => k !== j)),
          );
        }
      }
    }
  }
  if (b.k === "mul") {
    const { coef, rest } = splitCoef(b);
    if (coef.v !== 1) return simplifyDiv(simplifyDiv(a, coef), rest);
  }
  return { k: "div", a, b };
}

/** 化简入口（自底向上一次；规则只做恒等变形） */
export function simplify(e: Expr): Expr {
  switch (e.k) {
    case "num":
    case "sym":
      return e;
    case "fn": {
      const a = simplify(e.a);
      const b = e.b ? simplify(e.b) : undefined;
      const node: Expr = b ? { k: "fn", n: e.n, a, b } : { k: "fn", n: e.n, a };
      // exp(u) 一律写成 e^u：既是数学惯例，也让 ln(e)、e^(ln x) 这类恒等式自动生效
      if (e.n === "exp" && b === undefined) return simplifyPow(sym("e"), a);
      if (isNum(a) && (b === undefined || isNum(b))) {
        try {
          const v = evalExpr(node);
          if (Number.isFinite(v)) return num(v);
        } catch {
          /* 保留符号形式 */
        }
      }
      // 常量参数的常见恒等式（避免出现 ln(e) 这种没化简的东西）
      if (b === undefined) {
        if (e.n === "ln" && isSym(a, "e")) return ONE;
        if (e.n === "exp" && isNum(a) && a.v === 0) return ONE;
        if ((e.n === "sin" || e.n === "tan" || e.n === "sinh" || e.n === "tanh" || e.n === "asin") && isNum(a) && a.v === 0) {
          return ZERO;
        }
        if ((e.n === "cos" || e.n === "cosh") && isNum(a) && a.v === 0) return ONE;
      }
      return node;
    }
    case "pow":
      return simplifyPow(simplify(e.a), simplify(e.b));
    case "mul":
      return simplifyMul(simplify(e.a), simplify(e.b));
    case "div":
      return simplifyDiv(simplify(e.a), simplify(e.b));
    case "add":
      return simplifyAdd(simplify(e.a), simplify(e.b));
    default:
      return e;
  }
}

/** 多轮化简到不动点（有上限，避免规则互搏） */
export function simplifyDeep(e: Expr, rounds = 3): Expr {
  let cur = simplify(e);
  for (let i = 0; i < rounds; i += 1) {
    const next = simplify(cur);
    if (keyOf(next) === keyOf(cur)) break;
    cur = next;
  }
  return cur;
}

/** 展开（分配律） */
export function expand(e: Expr, budget = 6000): Expr {
  let count = 0;
  const bump = () => {
    count += 1;
    if (count > budget) fail("表达式展开后规模过大，请把式子拆小一点再算");
  };
  const go = (x: Expr): Expr => {
    bump();
    switch (x.k) {
      case "num":
      case "sym":
        return x;
      case "fn":
        return { k: "fn", n: x.n, a: go(x.a), b: x.b ? go(x.b) : undefined };
      case "pow": {
        const a = go(x.a);
        const b = go(x.b);
        if (isNum(b) && Number.isInteger(b.v) && b.v >= 2 && b.v <= 10 && (a.k === "add" || a.k === "mul")) {
          let acc: Expr = a;
          for (let i = 1; i < b.v; i += 1) acc = go({ k: "mul", a: acc, b: a });
          return acc;
        }
        return { k: "pow", a, b };
      }
      case "div":
        return { k: "div", a: go(x.a), b: go(x.b) };
      case "add":
        return { k: "add", a: go(x.a), b: go(x.b) };
      case "mul": {
        const a = go(x.a);
        const b = go(x.b);
        if (a.k === "add" && b.k === "add") {
          return go({ k: "add", a: go({ k: "mul", a: a.a, b }), b: go({ k: "mul", a: a.b, b }) });
        }
        if (a.k === "add") return go({ k: "add", a: { k: "mul", a: a.a, b }, b: { k: "mul", a: a.b, b } });
        if (b.k === "add") return go({ k: "add", a: { k: "mul", a, b: b.a }, b: { k: "mul", a, b: b.b } });
        return { k: "mul", a, b };
      }
      default:
        return x;
    }
  };
  return simplify(go(e));
}

/* ==========================================================================
 * 第 6 部分：数值工具（对拍 / 自检用；与符号算法相互独立）
 * ========================================================================== */

/** 确定性伪随机（同一个种子永远给同一串数，单测可复现） */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 生成若干测试点：避开 0 附近（容易被分母 0 干扰） */
export function samplePoints(
  vars: string[],
  count: number,
  seed = 20240607,
  lo = -3.2,
  hi = 3.4,
): Array<Record<string, number>> {
  const rng = makeRng(seed);
  const out: Array<Record<string, number>> = [];
  const fixed = [0.7, 1.3, -1.7, 2.2, -0.45, 3.1, -2.6, 1.9, -3.0, 0.35, 2.75, -1.15];
  for (let i = 0; i < count; i += 1) {
    const p: Record<string, number> = {};
    for (const v of vars) {
      let val = i < fixed.length ? fixed[i] : lo + (hi - lo) * rng();
      if (Math.abs(val) < 0.15) val += 0.37;
      p[v] = v === "n" || v === "k" || v === "t" ? Math.round(Math.abs(val)) + 1 : val;
    }
    out.push(p);
  }
  return out;
}

export type CompareResult = { ok: boolean; checked: number; maxAbs: number; maxRel: number };

/**
 * 在两个表达式上取同一批点求值并比较（符号等价性的判据）。
 * 两边都有限才计入；至少比较成功 3 个点，且相对误差 < tol 才算通过。
 */
export function compareNumeric(
  a: Expr,
  b: Expr,
  vars: string[],
  points: Array<Record<string, number>>,
  tol = 1e-9,
): CompareResult {
  let checked = 0;
  let maxAbs = 0;
  let maxRel = 0;
  for (const p of points) {
    let va: number;
    let vb: number;
    try {
      va = evalExpr(a, p);
      vb = evalExpr(b, p);
    } catch {
      continue;
    }
    if (!Number.isFinite(va) || !Number.isFinite(vb)) continue;
    checked += 1;
    const abs = Math.abs(va - vb);
    const rel = abs / Math.max(1, Math.abs(va), Math.abs(vb));
    maxAbs = Math.max(maxAbs, abs);
    maxRel = Math.max(maxRel, rel);
  }
  return { ok: checked >= 3 && maxRel <= tol, checked, maxAbs, maxRel };
}

/** 5 点差分求数值导数（O(h⁴)，与符号求导完全独立的一条验证链路） */
export function numericDerivative(
  f: Expr,
  v: string,
  x0: number,
  others: Record<string, number> = {},
  h = 1e-3,
): number {
  const at = (x: number) => evalExpr(f, { ...others, [v]: x });
  return (-at(x0 + 2 * h) + 8 * at(x0 + h) - 8 * at(x0 - h) + at(x0 - 2 * h)) / (12 * h);
}

/** 给表达式里除 v 之外的变量填一组固定的正数（参数化积分/求导自检时用） */
function fillOthers(e: Expr, v: string, given: Record<string, number>): Record<string, number> {
  const others: Record<string, number> = { ...given };
  const extra = new Set<string>();
  freeVars(e, extra);
  extra.delete(v);
  const filler = [1.3, 2.1, 0.7, 3.3, 1.9, 2.7, 0.5, 4.1];
  let idx = 0;
  for (const name of extra) {
    if (others[name] === undefined) {
      others[name] = filler[idx % filler.length];
      idx += 1;
    }
  }
  return others;
}

/** 用数值导数验证「F′ = f」是否成立（积分结果的自动体检） */
export function verifyAntiderivative(
  F: Expr,
  f: Expr,
  v: string,
  othersIn: Record<string, number> = {},
  tol = 1e-6,
): boolean {
  const others = fillOthers(F, v, fillOthers(f, v, othersIn));
  const rng = makeRng(90210);
  let okCount = 0;
  let tried = 0;
  for (let i = 0; i < 18 && okCount < 5; i += 1) {
    const x0 = -2.6 + 5.2 * rng();
    if (Math.abs(x0) < 0.2) continue;
    tried += 1;
    let lhs: number;
    let rhs: number;
    try {
      lhs = numericDerivative(F, v, x0, others);
      rhs = evalExpr(f, { ...others, [v]: x0 });
    } catch {
      continue;
    }
    if (!Number.isFinite(lhs) || !Number.isFinite(rhs)) continue;
    if (Math.abs(lhs - rhs) / Math.max(1, Math.abs(rhs)) <= tol) okCount += 1;
  }
  return tried >= 3 && okCount >= 3;
}

/**
 * 用数值导数验证符号求导结果（求导页的「自检」标记）。
 *
 * 【修正】原来直接把 (d, f) 交给 verifyAntiderivative，而 verifyAntiderivative(F, f) 的语义是
 * 「数值导数(F) ≈ f」—— 也就是把导数当成了原函数。于是它恒为 false（连 d/dx x³ 都通不过，
 * 因为它在比较 (x³)″ 与 x³）。要验证 d = f′，应当数值微分 f、再与 d 比，所以两个参数要对调。
 */
export function verifyDerivative(d: Expr, f: Expr, v: string, tol = 1e-6): boolean {
  return verifyAntiderivative(f, d, v, {}, tol);
}

/* ==========================================================================
 * 第 7 部分：复数与多项式求根
 * ========================================================================== */

export type Cx = { re: number; im: number };
export const cx = (re: number, im = 0): Cx => ({ re, im });
const cAdd = (a: Cx, b: Cx): Cx => ({ re: a.re + b.re, im: a.im + b.im });
const cSub = (a: Cx, b: Cx): Cx => ({ re: a.re - b.re, im: a.im - b.im });
const cMul = (a: Cx, b: Cx): Cx => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re });
const cAbs = (a: Cx): number => Math.hypot(a.re, a.im);
function cDiv(a: Cx, b: Cx): Cx {
  const d = b.re * b.re + b.im * b.im;
  return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d };
}
function cExp(a: Cx): Cx {
  const e = Math.exp(a.re);
  return { re: e * Math.cos(a.im), im: e * Math.sin(a.im) };
}
function cLog(a: Cx): Cx {
  return { re: Math.log(cAbs(a)), im: Math.atan2(a.im, a.re) };
}
function cPow(a: Cx, b: Cx): Cx {
  if (a.re === 0 && a.im === 0) return b.re === 0 && b.im === 0 ? cx(1) : cx(0);
  return cExp(cMul(b, cLog(a)));
}

/** 复数格式化 */
export function fmtCx(z: Cx, digits = 8): string {
  const f = (x: number) => {
    const r = Math.abs(x) < 1e-12 ? 0 : x;
    return String(Number(r.toPrecision(digits)));
  };
  if (Math.abs(z.im) < 1e-12) return f(z.re);
  if (Math.abs(z.re) < 1e-12) return `${f(z.im)}i`;
  return `${f(z.re)} ${z.im < 0 ? "-" : "+"} ${f(Math.abs(z.im))}i`;
}

/**
 * 多项式求根（系数从高次到低次），Durand–Kerner 迭代 + 牛顿抛光。
 */
export function polyRoots(coeffs: number[]): Cx[] {
  const c = [...coeffs];
  while (c.length > 1 && Math.abs(c[0]) < 1e-14) c.shift();
  const n = c.length - 1;
  if (n <= 0) return [];
  const lead = c[0];
  const a = c.map((v) => v / lead);
  if (n === 1) return [cx(-a[1])];
  if (n === 2) {
    const disc = a[1] * a[1] - 4 * a[2];
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      return [cx((-a[1] + s) / 2), cx((-a[1] - s) / 2)];
    }
    const s = Math.sqrt(-disc);
    return [cx(-a[1] / 2, s / 2), cx(-a[1] / 2, -s / 2)];
  }
  const evalP = (z: Cx): Cx => {
    let acc = cx(a[0], 0);
    for (let i = 1; i <= n; i += 1) acc = cAdd(cMul(acc, z), cx(a[i], 0));
    return acc;
  };
  const dEval = (z: Cx): Cx => {
    let acc = cx(n * a[0], 0);
    for (let i = 1; i < n; i += 1) acc = cAdd(cMul(acc, z), cx((n - i) * a[i], 0));
    return acc;
  };
  let roots: Cx[] = [];
  const rad = 1 + Math.max(...a.map((v) => Math.abs(v)));
  for (let i = 0; i < n; i += 1) {
    const ang = (2 * Math.PI * i) / n + 0.4;
    roots.push(cx(rad * Math.cos(ang), rad * Math.sin(ang)));
  }
  for (let iter = 0; iter < 400; iter += 1) {
    let maxDelta = 0;
    const next: Cx[] = [];
    for (let i = 0; i < n; i += 1) {
      let denom = cx(1, 0);
      for (let j = 0; j < n; j += 1) if (j !== i) denom = cMul(denom, cSub(roots[i], roots[j]));
      if (cAbs(denom) < 1e-300) {
        next.push(roots[i]);
        continue;
      }
      const delta = cDiv(evalP(roots[i]), denom);
      maxDelta = Math.max(maxDelta, cAbs(delta));
      next.push(cSub(roots[i], delta));
    }
    roots = next;
    if (maxDelta < 1e-14) break;
  }
  for (let k = 0; k < 3; k += 1) {
    for (let i = 0; i < n; i += 1) {
      const d = dEval(roots[i]);
      if (cAbs(d) > 1e-300) roots[i] = cSub(roots[i], cDiv(evalP(roots[i]), d));
    }
  }
  return roots.map((z) => ({
    re: Math.abs(z.re) < 1e-11 ? 0 : z.re,
    im: Math.abs(z.im) < 1e-11 ? 0 : z.im,
  }));
}

/** 实系数多项式在实轴上的根（排序后返回） */
export function realRoots(coeffs: number[]): number[] {
  return polyRoots(coeffs)
    .filter((z) => Math.abs(z.im) < 1e-9)
    .map((z) => z.re)
    .sort((a, b) => a - b);
}

/* ==========================================================================
 * 第 8 部分：符号求导
 * ========================================================================== */

export type Trace = string[];

function pushTrace(trace: Trace | undefined, line: string): void {
  if (trace && trace.length < 80) trace.push(line);
}

function txt(e: Expr): string {
  return printExpr(simplify(e));
}

/** 各种外函数的导数（链式法则的外层） */
function derivOuter(name: string, u: Expr, trace?: Trace): Expr {
  switch (name) {
    case "sin":
      return fn("cos", u);
    case "cos":
      return neg(fn("sin", u));
    case "tan":
      return div(ONE, pow(fn("cos", u), num(2)));
    case "cot":
      return neg(div(ONE, pow(fn("sin", u), num(2))));
    case "sec":
      return mul(fn("sec", u), fn("tan", u));
    case "csc":
      return neg(mul(fn("csc", u), fn("cot", u)));
    case "asin":
      return div(ONE, fn("sqrt", sub(ONE, pow(u, num(2)))));
    case "acos":
      return neg(div(ONE, fn("sqrt", sub(ONE, pow(u, num(2))))));
    case "atan":
      return div(ONE, add(ONE, pow(u, num(2))));
    case "acot":
      return neg(div(ONE, add(ONE, pow(u, num(2)))));
    case "sinh":
      return fn("cosh", u);
    case "cosh":
      return fn("sinh", u);
    case "tanh":
      return div(ONE, pow(fn("cosh", u), num(2)));
    case "coth":
      return neg(div(ONE, pow(fn("sinh", u), num(2))));
    case "asinh":
      return div(ONE, fn("sqrt", add(pow(u, num(2)), ONE)));
    case "acosh":
      return div(ONE, fn("sqrt", sub(pow(u, num(2)), ONE)));
    case "atanh":
      return div(ONE, sub(ONE, pow(u, num(2))));
    case "exp":
      return fn("exp", u);
    case "ln":
      return div(ONE, u);
    case "lg":
      return div(ONE, mul(u, fn("ln", num(10))));
    case "log2":
      return div(ONE, mul(u, fn("ln", num(2))));
    case "sqrt":
      return div(ONE, mul(num(2), fn("sqrt", u)));
    case "cbrt":
      return div(ONE, mul(num(3), pow(fn("cbrt", u), num(2))));
    case "abs":
      pushTrace(trace, "绝对值求导：|u|′ = sign(u)·u′（x = 0 处不可导）");
      return fn("sign", u);
    case "sign":
    case "floor":
    case "ceil":
    case "round":
    case "trunc":
      pushTrace(trace, `${name}(u) 在跳跃点不可导；除跳跃点外导数处处为 0`);
      return ZERO;
    case "erf":
      return mul(num(2 / Math.sqrt(Math.PI)), fn("exp", neg(pow(u, num(2)))));
    case "fact":
      fail("暂不支持对阶乘求导（阶乘只在非负整数上有定义）");
      break;
    case "gamma":
      fail("暂不支持对 gamma 函数求导");
      break;
    default:
      fail(`暂不支持对函数 ${name}(...) 求导`);
  }
  return ZERO;
}

/** 符号求导核心 */
function diffRec(e: Expr, v: string, trace?: Trace): Expr {
  switch (e.k) {
    case "num":
      return ZERO;
    case "sym":
      return e.n === v ? ONE : ZERO;
    case "add":
      return add(diffRec(e.a, v, trace), diffRec(e.b, v, trace));
    case "mul": {
      pushTrace(trace, `乘积法则 (uv)′ = u′v + uv′：u = ${txt(e.a)}，v = ${txt(e.b)}`);
      return add(mul(diffRec(e.a, v, trace), e.b), mul(e.a, diffRec(e.b, v, trace)));
    }
    case "div": {
      pushTrace(trace, `商法则 (u/v)′ = (u′v − uv′)/v²：u = ${txt(e.a)}，v = ${txt(e.b)}`);
      return div(sub(mul(diffRec(e.a, v, trace), e.b), mul(e.a, diffRec(e.b, v, trace))), pow(e.b, num(2)));
    }
    case "pow": {
      if (freeOf(e.b, v)) {
        pushTrace(trace, `幂函数法则 (u^n)′ = n·u^(n−1)·u′：n = ${txt(e.b)}`);
        return mul(mul(e.b, pow(e.a, sub(e.b, ONE))), diffRec(e.a, v, trace));
      }
      if (freeOf(e.a, v)) {
        if (isSym(e.a, "e")) {
          pushTrace(trace, "以 e 为底的指数函数法则 (e^u)′ = e^u·u′");
          return mul(e, diffRec(e.b, v, trace));
        }
        pushTrace(trace, `指数函数法则 (a^u)′ = a^u·ln(a)·u′：a = ${txt(e.a)}`);
        return mul(mul(e, fn("ln", e.a)), diffRec(e.b, v, trace));
      }
      pushTrace(trace, "幂指函数 u^v 先取对数：u^v = e^(v·ln u)，再按复合函数求导");
      return mul(
        e,
        add(mul(diffRec(e.b, v, trace), fn("ln", e.a)), div(mul(e.b, diffRec(e.a, v, trace)), e.a)),
      );
    }
    case "fn": {
      if (e.b !== undefined) fail(`暂不支持对双参数函数 ${e.n}(a, b) 求导`);
      pushTrace(trace, `链式法则 [f(u)]′ = f′(u)·u′：外层 f = ${e.n}，内层 u = ${txt(e.a)}`);
      return mul(derivOuter(e.n, e.a, trace), diffRec(e.a, v, trace));
    }
    default:
      fail("表达式里有无法求导的结构");
  }
  return ZERO;
}

/** 求导：结果已化简；trace 里是逐步过程（中文） */
export function derivative(e: Expr, v: string, trace?: Trace): Expr {
  return simplifyDeep(diffRec(e, v, trace));
}

/** n 阶导 */
export function nthDerivative(e: Expr, v: string, n: number, trace?: Trace): Expr {
  if (!Number.isInteger(n) || n < 0) fail("导数阶数必须是非负整数");
  if (n > 10) fail("最多支持 10 阶导数");
  let cur = e;
  for (let i = 1; i <= n; i += 1) {
    pushTrace(trace, `第 ${i} 阶导：`);
    cur = derivative(cur, v, trace);
  }
  return cur;
}

/** 偏导 */
export function partial(e: Expr, v: string, order = 1, trace?: Trace): Expr {
  return nthDerivative(e, v, order, trace);
}

/** 混合偏导（按变量顺序连续求导） */
export function mixedPartial(e: Expr, vs: string[], trace?: Trace): Expr {
  let cur = e;
  for (const v of vs) cur = derivative(cur, v, trace);
  return cur;
}

/* ==========================================================================
 * 第 9 部分：符号积分
 * ========================================================================== */

/** e 是不是 v 的一次式：返回 {a, b} 使 e = a·v + b（a、b 与 v 无关，且已化简） */
export function linearIn(e: Expr, v: string): { a: Expr; b: Expr } | null {
  const c = asPoly(e, v);
  if (!c) return null;
  if (polyDeg(c) > 1) return null;
  return { a: simplify(c[1] ?? ZERO), b: simplify(c[0] ?? ZERO) };
}

/** 取数值（先化简；asPoly 给出的系数可能没化简过） */
function numOf(e: Expr | undefined): number | null {
  if (!e) return null;
  if (e.k === "num") return e.v;
  const s = simplify(e);
  return s.k === "num" ? s.v : null;
}

const ANTIDERIV: Record<string, (u: Expr) => Expr | null> = {
  sin: (u) => neg(fn("cos", u)),
  cos: (u) => fn("sin", u),
  tan: (u) => neg(fn("ln", fn("abs", fn("cos", u)))),
  cot: (u) => fn("ln", fn("abs", fn("sin", u))),
  sec: (u) => fn("ln", fn("abs", add(fn("sec", u), fn("tan", u)))),
  csc: (u) => neg(fn("ln", fn("abs", add(fn("csc", u), fn("cot", u))))),
  exp: (u) => fn("exp", u),
  sinh: (u) => fn("cosh", u),
  cosh: (u) => fn("sinh", u),
  tanh: (u) => fn("ln", fn("cosh", u)),
  coth: (u) => fn("ln", fn("abs", fn("sinh", u))),
  ln: (u) => sub(mul(u, fn("ln", u)), u),
  lg: (u) => div(sub(mul(u, fn("ln", u)), u), fn("ln", num(10))),
  sqrt: (u) => mul(div(num(2), num(3)), pow(u, div(num(3), num(2)))),
  cbrt: (u) => mul(div(num(3), num(4)), pow(u, div(num(4), num(3)))),
  abs: (u) => div(mul(u, fn("abs", u)), num(2)),
  asin: (u) => add(mul(u, fn("asin", u)), fn("sqrt", sub(ONE, pow(u, num(2))))),
  acos: (u) => sub(mul(u, fn("acos", u)), fn("sqrt", sub(ONE, pow(u, num(2))))),
  atan: (u) => sub(mul(u, fn("atan", u)), div(fn("ln", add(ONE, pow(u, num(2)))), num(2))),
  sign: () => null,
  floor: () => null,
  ceil: () => null,
  round: () => null,
  trunc: () => null,
  fact: () => null,
  gamma: () => null,
  erf: () => null,
};

/** ∫ u^n du */
function integratePower(u: Expr, nIn: Expr, trace: Trace): Expr | null {
  const n = simplify(nIn);
  if (freeOf(n, "__u") === false) return null;
  if (isNum(n) && n.v === -1) {
    pushTrace(trace, "幂函数特例：∫u⁻¹du = ln|u|");
    return fn("ln", fn("abs", u));
  }
  pushTrace(trace, `幂函数公式：∫u^n du = u^(n+1)/(n+1)，其中 n = ${txt(n)}`);
  return div(pow(u, add(n, ONE)), add(n, ONE));
}

/** ∫ sinⁿu du / ∫ cosⁿu du（整数 n ≥ 0，用递推公式） */
function integrateSinCosPower(name: "sin" | "cos", u: Expr, n: number, trace: Trace): Expr | null {
  if (!Number.isInteger(n) || n < 0) return null;
  if (n === 0) return u;
  if (n === 1) return name === "sin" ? neg(fn("cos", u)) : fn("sin", u);
  const nE = num(n);
  if (name === "sin") {
    pushTrace(trace, "正弦幂递推公式：∫sinⁿu du = −sinⁿ⁻¹u·cos u/n + (n−1)/n·∫sinⁿ⁻²u du");
    const rest = integrateSinCosPower("sin", u, n - 2, trace);
    if (!rest) return null;
    return add(neg(div(mul(pow(fn("sin", u), sub(nE, ONE)), fn("cos", u)), nE)), mul(div(sub(nE, ONE), nE), rest));
  }
  pushTrace(trace, "余弦幂递推公式：∫cosⁿu du = cosⁿ⁻¹u·sin u/n + (n−1)/n·∫cosⁿ⁻²u du");
  const rest = integrateSinCosPower("cos", u, n - 2, trace);
  if (!rest) return null;
  return add(div(mul(pow(fn("cos", u), sub(nE, ONE)), fn("sin", u)), nE), mul(div(sub(nE, ONE), nE), rest));
}

/** 收集表达式里所有「含 v 的子表达式」（作为换元候选 u） */
function collectSubExprs(e: Expr, v: string, out: Expr[]): void {
  if (freeOf(e, v)) return;
  if (e.k !== "sym" && e.k !== "num") {
    if (out.length < 40 && !out.some((x) => keyOf(x) === keyOf(e))) out.push(e);
  }
  for (const c of children(e)) collectSubExprs(c, v, out);
}

/** 换元积分：找 g(x) 使 f = h(g)·g′ */
function integrateBySubstitution(f: Expr, v: string, trace: Trace, depth: number): Expr | null {
  if (depth > 3) return null;
  const cands: Expr[] = [];
  collectSubExprs(f, v, cands);
  const U = sym("__u");
  for (const g of cands) {
    if (keyOf(g) === keyOf(f)) continue;
    let gp: Expr;
    try {
      gp = derivative(g, v);
    } catch {
      continue;
    }
    if (isNum(gp) && gp.v === 0) continue;
    const ratio = simplifyDiv(f, gp);
    const inU = simplify(substExpr(ratio, g, U));
    if (hasVar(inU, v)) continue;
    const inner = integrateRec(inU, "__u", trace, depth + 1);
    if (!inner) continue;
    pushTrace(trace, `换元积分：令 u = ${txt(g)}，du = ${txt(gp)} d${v}，原式化为 ∫${txt(inU)} du`);
    return simplify(subst(inner, "__u", g));
  }
  return null;
}

const LIATE: Array<{ test: (e: Expr) => boolean; rank: number }> = [
  {
    test: (e) =>
      e.k === "fn" && (e.n === "ln" || e.n === "lg" || e.n === "log2" || e.n === "asin" || e.n === "acos" || e.n === "atan"),
    rank: 0,
  },
  { test: (e) => e.k === "pow" && isNum(e.b), rank: 1 },
  { test: (e) => e.k === "sym" || (e.k === "pow" && !isNum(e.b)), rank: 1 },
  { test: (e) => e.k === "fn", rank: 2 },
  { test: (e) => e.k === "pow" && isSym(e.a, "e"), rank: 3 },
];

function liateRank(e: Expr): number {
  for (const r of LIATE) if (r.test(e)) return r.rank;
  return 2;
}

/** 分部积分：∫u dv = uv − ∫v du */
function integrateByParts(f: Expr, v: string, trace: Trace, depth: number): Expr | null {
  if (depth > 4) return null;
  const factors: Expr[] = [];
  flattenMul(f, factors);
  if (factors.length === 0) return null;
  if (factors.length === 1 && f.k !== "fn") return null;
  const order = factors.map((x, i) => ({ x, i, r: liateRank(x) })).sort((a, b) => (a.r !== b.r ? a.r - b.r : a.i - b.i));
  for (let pick = 0; pick < Math.min(order.length, 3); pick += 1) {
    const chosen = order[pick];
    const u = chosen.x;
    if (freeOf(u, v)) continue;
    const dvFactors = factors.filter((_, i) => i !== chosen.i);
    const dv = dvFactors.length === 0 ? ONE : rebuildMul(dvFactors);
    let V: Expr | null = null;
    try {
      V = integrateRec(dv, v, trace, depth + 1);
    } catch {
      V = null;
    }
    if (!V) continue;
    const du = derivative(u, v);
    const restInt = integrateRec(simplifyMul(V, du), v, trace, depth + 1);
    if (!restInt) continue;
    pushTrace(trace, `分部积分 ∫u·dv = u·v − ∫v·du：取 u = ${txt(u)}，dv = ${txt(dv)}，则 v = ${txt(V)}`);
    return sub(simplifyMul(u, V), restInt);
  }
  return null;
}

/* --------------------------- 多项式与部分分式 --------------------------- */

/** 多项式长除法（降幂系数） */
function polyDivNum(p: number[], q: number[]): { quo: number[]; rem: number[] } {
  const rem = [...p];
  const dq = q.length - 1;
  const quo = new Array(Math.max(1, rem.length - dq)).fill(0);
  for (let i = 0; i + dq < rem.length; i += 1) {
    const coef = rem[i] / q[0];
    quo[i] = coef;
    for (let j = 0; j <= dq; j += 1) rem[i + j] -= coef * q[j];
  }
  return { quo, rem: polyTrim(rem) };
}

/** 综合除法：除以 (x − r) */
function deflate(c: number[], r: number): number[] {
  const out: number[] = [c[0]];
  for (let i = 1; i < c.length - 1; i += 1) out.push(c[i] + r * out[i - 1]);
  return out;
}

function polyEvalNum(c: number[], x: number): number {
  let acc = 0;
  for (const k of c) acc = acc * x + k;
  return acc;
}

function polyMulNum(a: number[], b: number[]): number[] {
  const out = new Array(a.length + b.length - 1).fill(0);
  for (let i = 0; i < a.length; i += 1) for (let j = 0; j < b.length; j += 1) out[i + j] += a[i] * b[j];
  return out;
}

function polyPowNum(a: number[], m: number): number[] {
  let out = [1];
  for (let i = 0; i < m; i += 1) out = polyMulNum(out, a);
  return out;
}

function polyTrim(c: number[]): number[] {
  const out = [...c];
  while (out.length > 1 && Math.abs(out[0]) < 1e-12) out.shift();
  return out;
}

function polyMonic(c: number[]): number[] {
  return c.map((v) => v / c[0]);
}

/** 有理根定理：把多项式分解成一次因子（含重数）+ 剩余部分 */
function factorRationalRoots(cIn: number[]): { roots: Array<{ r: number; m: number }>; rest: number[] } {
  let c = polyMonic(polyTrim(cIn));
  const roots: Array<{ r: number; m: number }> = [];
  for (let guard = 0; guard < 20; guard += 1) {
    if (c.length <= 1) break;
    if (Math.abs(c[c.length - 1]) < 1e-12) {
      let m = 0;
      while (c.length > 1 && Math.abs(c[c.length - 1]) < 1e-12) {
        c = c.slice(0, c.length - 1);
        m += 1;
      }
      roots.push({ r: 0, m });
      continue;
    }
    let found: number | null = null;
    outer: for (let q = 1; q <= 12; q += 1) {
      for (let p = 1; p <= 64; p += 1) {
        for (const s of [1, -1]) {
          const cand = (s * p) / q;
          if (Math.abs(polyEvalNum(c, cand)) < 1e-9) {
            found = cand;
            break outer;
          }
        }
      }
    }
    if (found === null) break;
    let m = 0;
    while (c.length > 1 && Math.abs(polyEvalNum(c, found)) < 1e-9) {
      c = polyTrim(deflate(c, found));
      m += 1;
    }
    roots.push({ r: found, m });
  }
  return { roots, rest: c };
}

/** 解线性方程组（高斯消元 + 部分主元） */
export function solveLinearSystem(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col += 1) {
    let piv = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    const tmp = M[col];
    M[col] = M[piv];
    M[piv] = tmp;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      if (f === 0) continue;
      for (let k = col; k <= n; k += 1) M[r][k] -= f * M[col][k];
    }
  }
  return M.map((row, i) => row[n] / M[i][i]);
}

/** 有理函数积分（多项式长除法 + 部分分式） */
function integrateRational(f: Expr, v: string, trace: Trace, depth: number): Expr | null {
  let numE: Expr;
  let denE: Expr;
  if (f.k === "div") {
    numE = f.a;
    denE = f.b;
  } else if (f.k === "pow" && isNum(f.b) && Number.isInteger(f.b.v) && f.b.v < 0) {
    numE = ONE;
    denE = simplifyPow(f.a, num(-f.b.v));
  } else {
    return null;
  }
  const cp = asPoly(numE, v);
  const cq = asPoly(denE, v);
  if (!cp || !cq) return null;
  const dp = polyDeg(cp);
  const dq = polyDeg(cq);
  if (dq < 1 || dp < 0 || dq > 8) return null;
  const np: number[] = [];
  for (let i = dp; i >= 0; i -= 1) {
    const val = numOf(cp[i]);
    if (val === null) return null;
    np.push(val);
  }
  const nq: number[] = [];
  for (let i = dq; i >= 0; i -= 1) {
    const val = numOf(cq[i]);
    if (val === null) return null;
    nq.push(val);
  }
  let out: Expr = ZERO;
  const { quo, rem } = polyDivNum(np, nq);
  if (quo.some((x) => Math.abs(x) > 1e-12)) {
    pushTrace(trace, "假分式先做多项式长除法，拆成「多项式 + 真分式」");
    let quoExpr: Expr = ZERO;
    for (let i = 0; i < quo.length; i += 1) {
      const power = quo.length - 1 - i;
      if (Math.abs(quo[i]) < 1e-12) continue;
      quoExpr = add(quoExpr, mul(num(quo[i]), pow(sym(v), num(power))));
    }
    const qInt = integrateRec(quoExpr, v, trace, depth + 1);
    if (!qInt) return null;
    out = qInt;
  }
  if (rem.every((x) => Math.abs(x) < 1e-12)) return out;
  const { roots, rest } = factorRationalRoots(nq);
  const restDeg = rest.length - 1;
  if (restDeg > 2) return null;
  const factors: Array<{ coeffs: number[]; mult: number; kind: "linear" | "quadratic"; root?: number }> = [];
  for (const r of roots) factors.push({ coeffs: [1, -r.r], mult: r.m, kind: "linear", root: r.r });
  if (restDeg === 2) factors.push({ coeffs: polyMonic(rest), mult: 1, kind: "quadratic" });
  else if (restDeg === 1) factors.push({ coeffs: polyMonic(rest), mult: 1, kind: "linear", root: -rest[1] / rest[0] });
  if (factors.length === 0) return null;
  const unknowns: Array<{ fi: number; power: number; sub: "a" | "b" }> = [];
  factors.forEach((fac, fi) => {
    for (let j = 1; j <= fac.mult; j += 1) {
      if (fac.kind === "linear") unknowns.push({ fi, power: j, sub: "a" });
      else {
        unknowns.push({ fi, power: j, sub: "a" });
        unknowns.push({ fi, power: j, sub: "b" });
      }
    }
  });
  const U = unknowns.length;
  if (U === 0 || U > 12) return null;
  const D = factors.reduce((acc, fac) => polyMulNum(acc, polyPowNum(fac.coeffs, fac.mult)), [1]);
  if (D.length !== nq.length) return null;
  const columns: number[][] = unknowns.map((uk) => {
    const fac = factors[uk.fi];
    let cof = polyPowNum(fac.coeffs, fac.mult - uk.power);
    factors.forEach((other, oi) => {
      if (oi !== uk.fi) cof = polyMulNum(cof, polyPowNum(other.coeffs, other.mult));
    });
    if (fac.kind === "quadratic" && uk.sub === "a") cof = polyMulNum(cof, [1, 0]);
    return cof;
  });
  const len = Math.max(D.length, ...columns.map((c) => c.length));
  const pad = (c: number[]): number[] => {
    const out = new Array(len).fill(0);
    const off = len - c.length;
    for (let i = 0; i < c.length; i += 1) out[off + i] = c[i];
    return out;
  };
  const A: number[][] = [];
  const bb: number[] = [];
  const remPad = pad(rem);
  // 用「最低次」的 U 个系数列方程（和部分分式的教科书做法一致，数值上也最稳）
  for (let row = 0; row < U; row += 1) {
    const idx = len - 1 - row;
    A.push(columns.map((c) => pad(c)[idx]));
    bb.push(remPad[idx]);
  }
  const sol = solveLinearSystem(A, bb);
  if (!sol) return null;
  const check = new Array(len).fill(0);
  columns.forEach((c, i) => {
    const cp2 = pad(c);
    for (let k = 0; k < len; k += 1) check[k] += cp2[k] * sol[i];
  });
  for (let k = 0; k < len; k += 1) {
    if (Math.abs(check[k] - remPad[k]) > 1e-6 * Math.max(1, Math.abs(remPad[k]))) return null;
  }
  pushTrace(
    trace,
    `部分分式分解：分母 = ${factors
      .map((x) => (x.kind === "linear" ? `(x − ${Number(x.root!.toPrecision(6))})^${x.mult}` : "一个二次不可约因式"))
      .join(" · ")}`,
  );
  for (let i = 0; i < unknowns.length; i += 1) {
    const uk = unknowns[i];
    const coef = sol[i];
    if (Math.abs(coef) < 1e-12) continue;
    const fac = factors[uk.fi];
    if (fac.kind === "linear") {
      const r = fac.root!;
      if (uk.power === 1) {
        out = add(out, mul(num(coef), fn("ln", fn("abs", sub(sym(v), num(r))))));
      } else {
        const p = 1 - uk.power;
        out = add(out, mul(div(num(coef), num(p)), pow(sub(sym(v), num(r)), num(p))));
      }
    } else {
      const bq = fac.coeffs[1];
      const cq2 = fac.coeffs[2];
      if (uk.sub === "a") {
        out = add(
          out,
          mul(div(num(coef), num(2)), fn("ln", fn("abs", add(pow(sym(v), num(2)), add(mul(num(bq), sym(v)), num(cq2)))))),
        );
      } else {
        const disc = 4 * cq2 - bq * bq;
        if (disc <= 0) return null;
        const s = Math.sqrt(disc);
        out = add(out, mul(div(num(2 * coef), num(s)), fn("atan", div(add(mul(num(2), sym(v)), num(bq)), num(s)))));
      }
    }
  }
  return simplifyDeep(out);
}

/* --------------------------- 二次型 / 根号型公式 --------------------------- */

/** 把二次分母整理成 c2·(w² + k)，其中 w = v + shift */
function completeSquare(den: Expr, v: string): { c2: number; k: number; shift: number } | null {
  const c = asPoly(den, v);
  if (!c || polyDeg(c) !== 2) return null;
  const c0 = numOf(c[0]);
  const c1 = numOf(c[1]);
  const c2 = numOf(c[2]);
  if (c0 === null || c1 === null || c2 === null || c2 === 0) return null;
  const shift = c1 / (2 * c2);
  return { c2, k: c0 / c2 - shift * shift, shift };
}

/** ∫du/(u²+k) */
function pickAtanOrLn(w: Expr, k: number, trace: Trace): Expr | null {
  if (k > 1e-12) {
    const s = Math.sqrt(k);
    pushTrace(trace, `二次型公式：∫du/(u²+a²) = (1/a)·atan(u/a)，这里 a = ${Number(s.toPrecision(8))}`);
    return mul(div(ONE, num(s)), fn("atan", div(w, num(s))));
  }
  if (k < -1e-12) {
    const s = Math.sqrt(-k);
    pushTrace(trace, `二次型公式：∫du/(u²−a²) = (1/2a)·ln|(u−a)/(u+a)|，这里 a = ${Number(s.toPrecision(8))}`);
    return mul(div(ONE, num(2 * s)), fn("ln", fn("abs", div(sub(w, num(s)), add(w, num(s))))));
  }
  pushTrace(trace, "二次型公式：∫du/u² = −1/u");
  return neg(div(ONE, w));
}

/** 处理 1/(二次式)、1/√(二次式) 这类经典形式 */
function integrateQuadraticForm(f: Expr, v: string, trace: Trace): Expr | null {
  let numE: Expr | null = null;
  let denE: Expr | null = null;
  if (f.k === "div") {
    numE = f.a;
    denE = f.b;
  } else if (f.k === "pow" && isNum(f.b) && Math.abs(f.b.v + 1) < 1e-12) {
    numE = ONE;
    denE = f.a;
  }
  if (!numE || !denE) return null;
  // 情形 A/B：分母是二次多项式
  if (denE.k !== "fn") {
    const cs = completeSquare(denE, v);
    if (cs) {
      const w = add(sym(v), num(cs.shift));
      const nn = numOf(numE);
      if (nn !== null) {
        const core = pickAtanOrLn(w, cs.k, trace);
        if (core) return simplifyDeep(mul(div(num(nn), num(cs.c2)), core));
      }
      const cp = asPoly(numE, v);
      if (cp && polyDeg(cp) === 1) {
        const A = numOf(cp[1]);
        const B = numOf(cp[0]);
        if (A !== null && B !== null) {
          const first = mul(div(num(A), num(2 * cs.c2)), fn("ln", fn("abs", denE)));
          const core = pickAtanOrLn(w, cs.k, trace);
          if (core) {
            pushTrace(trace, "分子拆成「分母导数的一半 + 常数」：分别得到 ln 项与 atan（或 ln）项");
            const second = mul(div(num(B - A * cs.shift), num(cs.c2)), core);
            return simplifyDeep(add(first, second));
          }
        }
      }
      return null;
    }
  }
  // 情形 C：1/√(二次式)
  if (denE.k === "fn" && denE.n === "sqrt" && isNum(numE) && numE.v !== 0) {
    const cs = completeSquare(denE.a, v);
    if (!cs || Math.abs(Math.abs(cs.c2) - 1) > 1e-9) return null;
    const w = add(sym(v), num(cs.shift));
    if (cs.c2 > 0) {
      if (cs.k > 1e-12) {
        const s = Math.sqrt(cs.k);
        pushTrace(trace, `含根号公式：∫du/√(u²+a²) = ln|u + √(u²+a²)|，a = ${Number(s.toPrecision(8))}`);
      } else {
        pushTrace(trace, "含根号公式：∫du/√(u²−a²) = ln|u + √(u²−a²)|");
      }
      const F = fn("ln", fn("abs", add(w, fn("sqrt", add(pow(w, num(2)), num(cs.k))))));
      return simplifyDeep(mul(numE, F));
    }
    if (cs.k < -1e-12) {
      const s = Math.sqrt(-cs.k);
      pushTrace(trace, `含根号公式：∫du/√(a²−u²) = asin(u/a)，a = ${Number(s.toPrecision(8))}`);
      return simplifyDeep(mul(numE, fn("asin", div(w, num(s)))));
    }
  }
  return null;
}

/* ------------------------------ 主积分递归 ------------------------------ */

function integrateTable(f: Expr, v: string, trace: Trace, depth: number): Expr | null {
  // 单个变量：∫x dx = x²/2
  if (f.k === "sym" && f.n === v) {
    pushTrace(trace, "幂函数公式：∫x dx = x²/2");
    return div(pow(sym(v), num(2)), num(2));
  }
  // sec²/csc²/tan²/cot²（线性内层）
  if (f.k === "pow" && isNum(f.b) && f.b.v === 2 && f.a.k === "fn") {
    const inner = f.a.a;
    const lin = linearIn(inner, v);
    if (lin && !(isNum(lin.a) && lin.a.v === 0)) {
      const u = sym("__u");
      let F: Expr | null = null;
      if (f.a.n === "sec") {
        pushTrace(trace, "基本积分表：∫sec²u du = tan u");
        F = fn("tan", u);
      } else if (f.a.n === "csc") {
        pushTrace(trace, "基本积分表：∫csc²u du = −cot u");
        F = neg(fn("cot", u));
      } else if (f.a.n === "tan") {
        pushTrace(trace, "用 tan²u = sec²u − 1 降幂：∫tan²u du = tan u − u");
        F = sub(fn("tan", u), u);
      } else if (f.a.n === "cot") {
        pushTrace(trace, "用 cot²u = csc²u − 1 降幂：∫cot²u du = −cot u − u");
        F = sub(neg(fn("cot", u)), u);
      }
      if (F) return simplifyDiv(subst(F, "__u", inner), lin.a);
    }
  }
  if (f.k === "fn" && f.b === undefined) {
    const table = ANTIDERIV[f.n];
    if (!table) return null;
    const lin = linearIn(f.a, v);
    if (lin && !(isNum(lin.a) && lin.a.v === 0)) {
      const F = table(sym("__u"));
      if (F) {
        pushTrace(trace, `查基本积分表：∫${f.n}(u) du，其中 u = ${txt(f.a)}；再按 u = a·${v}+b 反代并除以 a = ${txt(lin.a)}`);
        return simplifyDiv(subst(F, "__u", f.a), lin.a);
      }
    }
    return null;
  }
  if (f.k === "pow") {
    if (freeOf(f.b, v)) {
      const lin = linearIn(f.a, v);
      if (lin && !(isNum(lin.a) && lin.a.v === 0)) {
        const F = integratePower(sym("__u"), f.b, trace);
        if (F) return simplifyDiv(subst(F, "__u", f.a), lin.a);
      }
    }
    if (isSym(f.a, "e")) {
      const lin = linearIn(f.b, v);
      if (lin && !(isNum(lin.a) && lin.a.v === 0)) {
        pushTrace(trace, "指数函数积分公式：∫e^u du = e^u");
        return simplifyDiv(simplifyPow(f.a, f.b), lin.a);
      }
    }
    if (freeOf(f.a, v) && !isNum(f.a)) {
      const lin = linearIn(f.b, v);
      if (lin && !(isNum(lin.a) && lin.a.v === 0)) {
        pushTrace(trace, "一般指数函数积分公式：∫a^u du = a^u / ln a");
        return simplifyDiv(simplifyDiv(simplifyPow(f.a, f.b), fn("ln", f.a)), lin.a);
      }
    }
    if (f.a.k === "fn" && (f.a.n === "sin" || f.a.n === "cos") && isNum(f.b) && Number.isInteger(f.b.v) && f.b.v >= 2) {
      const lin = linearIn(f.a.a, v);
      if (lin && !(isNum(lin.a) && lin.a.v === 0)) {
        const F = integrateSinCosPower(f.a.n, sym("__u"), f.b.v, trace);
        if (F) return simplifyDiv(subst(F, "__u", f.a.a), lin.a);
      }
    }
  }
  // 分式：c/(u^n)、c/(a·v+b)
  if (f.k === "div" && isNum(f.a) && f.a.v !== 0) {
    const den = f.b;
    const lin = linearIn(den, v);
    if (lin && !(isNum(lin.a) && lin.a.v === 0) && freeOf(lin.a, v) && freeOf(lin.b, v)) {
      pushTrace(trace, `分式积分：∫c/(a·${v}+b) d${v} = (c/a)·ln|a·${v}+b|`);
      return simplifyMul(f.a, simplifyDiv(fn("ln", fn("abs", den)), lin.a));
    }
    if (den.k === "pow" && freeOf(den.b, v)) {
      const lin2 = linearIn(den.a, v);
      if (lin2 && !(isNum(lin2.a) && lin2.a.v === 0)) {
        const F = integratePower(sym("__u"), neg(den.b), trace);
        if (F) return simplifyMul(f.a, simplifyDiv(subst(F, "__u", den.a), lin2.a));
      }
    }
  }
  return null;
}

function integrateRec(f: Expr, v: string, trace: Trace, depth: number): Expr | null {
  if (depth > 6) return null;
  const g = simplify(f);
  if (freeOf(g, v)) {
    pushTrace(trace, `被积函数与 ${v} 无关：∫${txt(g)} d${v} = ${txt(g)}·${v}`);
    return mul(g, sym(v));
  }
  if (g.k === "add") {
    const A = integrateRec(g.a, v, trace, depth + 1);
    if (!A) return null;
    const B = integrateRec(g.b, v, trace, depth + 1);
    if (!B) return null;
    pushTrace(trace, "积分线性性质：∫(f + g) = ∫f + ∫g");
    return add(A, B);
  }
  if (g.k === "mul") {
    const factors: Expr[] = [];
    flattenMul(g, factors);
    const consts = factors.filter((x) => freeOf(x, v));
    const vars = factors.filter((x) => !freeOf(x, v));
    if (consts.length > 0 && vars.length > 0) {
      const C = rebuildMul(consts);
      const R = integrateRec(rebuildMul(vars), v, trace, depth + 1);
      if (R) {
        pushTrace(trace, `把与 ${v} 无关的因子 ${txt(C)} 提到积分号外`);
        return simplifyMul(C, R);
      }
    }
    const t = integrateTable(g, v, trace, depth);
    if (t) return t;
    const sub = integrateBySubstitution(g, v, trace, depth);
    if (sub) return sub;
    const parts = integrateByParts(g, v, trace, depth);
    if (parts) return parts;
    let ex: Expr = g;
    try {
      ex = expand(g);
    } catch {
      ex = g;
    }
    if (keyOf(ex) !== keyOf(g)) {
      const R = integrateRec(ex, v, trace, depth + 1);
      if (R) {
        pushTrace(trace, "先把乘积展开成多项式，再逐项积分");
        return R;
      }
    }
    return null;
  }
  if (g.k === "div" || (g.k === "pow" && isNum(g.b) && g.b.v < 0)) {
    const t = integrateTable(g, v, trace, depth);
    if (t) return t;
    const quad = integrateQuadraticForm(g, v, trace);
    if (quad) return quad;
    const sub = integrateBySubstitution(g, v, trace, depth);
    if (sub) return sub;
    const rat = integrateRational(g, v, trace, depth);
    if (rat) return rat;
    return null;
  }
  const t = integrateTable(g, v, trace, depth);
  if (t) return t;
  const quad = integrateQuadraticForm(g, v, trace);
  if (quad) return quad;
  const sub = integrateBySubstitution(g, v, trace, depth);
  if (sub) return sub;
  return null;
}

export type IndefiniteResult = { F: Expr | null; verified: boolean };

/** 原始积分（不做自检；供单测与调试使用） */
export function integrateRaw(f: Expr, v: string, trace: Trace = []): Expr | null {
  return integrateRec(f, v, trace, 0);
}

/**
 * 不定积分：算完一定做「数值求导回代」自检，不过就当没算出来（宁可不支持，也不给错）。
 */
export function integrateIndefinite(f: Expr, v: string, trace: Trace = []): IndefiniteResult {
  let F: Expr | null = null;
  try {
    F = integrateRec(f, v, trace, 0);
  } catch (err) {
    if (err instanceof MathError) pushTrace(trace, `积分过程中止：${err.message}`);
    F = null;
  }
  if (!F) return { F: null, verified: false };
  const Fs = simplifyDeep(F);
  if (!verifyAntiderivative(Fs, simplify(f), v)) return { F: null, verified: false };
  pushTrace(trace, "自检：把结果求导回代，与原被积函数逐点做数值比较 → 通过 ✓");
  return { F: Fs, verified: true };
}

/* ==========================================================================
 * 第 10 部分：数值积分（自适应 Simpson / tanh-sinh / 高斯-勒让德）
 * ========================================================================== */

export type Fn1 = (x: number) => number;

function simpsonRule(f: Fn1, a: number, b: number): number {
  const m = (a + b) / 2;
  return ((b - a) / 6) * (f(a) + 4 * f(m) + f(b));
}

function adaptiveSimpsonRec(f: Fn1, a: number, b: number, whole: number, eps: number, depth: number): number {
  const m = (a + b) / 2;
  const left = simpsonRule(f, a, m);
  const right = simpsonRule(f, m, b);
  const delta = left + right - whole;
  if (depth <= 0 || Math.abs(delta) <= 15 * eps) return left + right + delta / 15;
  return adaptiveSimpsonRec(f, a, m, left, eps / 2, depth - 1) + adaptiveSimpsonRec(f, m, b, right, eps / 2, depth - 1);
}

/** 自适应复合 Simpson（光滑函数上的主力） */
export function adaptiveSimpson(f: Fn1, a: number, b: number, tol = 1e-11, maxDepth = 50): number {
  if (a === b) return 0;
  const s = Math.sign(b - a);
  const lo = s > 0 ? a : b;
  const hi = s > 0 ? b : a;
  const val = adaptiveSimpsonRec(f, lo, hi, simpsonRule(f, lo, hi), tol, maxDepth);
  return s > 0 ? val : -val;
}

/** tanh-sinh（双指数）积分：两端可以带奇性，例如 ∫₀¹ 1/√x dx */
export function tanhSinh(f: Fn1, a: number, b: number, level = 7): number {
  const c = (a + b) / 2;
  const d = (b - a) / 2;
  const h = Math.pow(2, -level);
  const K = Math.ceil(5.2 / h);
  let sum = 0;
  for (let k = -K; k <= K; k += 1) {
    const t = k * h;
    let x: number;
    let w: number;
    try {
      const u = (Math.PI / 2) * Math.sinh(t);
      const cu = Math.cosh(u);
      w = ((Math.PI / 2) * Math.cosh(t)) / (cu * cu);
      x = Math.tanh(u);
    } catch {
      continue;
    }
    if (!Number.isFinite(x) || !Number.isFinite(w) || w === 0) continue;
    let val: number;
    try {
      val = f(c + d * x) * w;
    } catch {
      continue;
    }
    if (!Number.isFinite(val)) continue;
    sum += k === -K || k === K ? val / 2 : val;
  }
  return sum * d * h;
}

/** 高斯-勒让德（n 点）：另一条完全独立的数值积分链路，用于交叉核对 */
export function gaussLegendre(f: Fn1, a: number, b: number, n = 40): number {
  const m = Math.floor((n + 1) / 2);
  let sum = 0;
  for (let i = 0; i < m; i += 1) {
    let x = Math.cos((Math.PI * (i + 0.75)) / (n + 0.5));
    let dp = 0;
    for (let it = 0; it < 100; it += 1) {
      let p0 = 1;
      let p1 = x;
      for (let j = 2; j <= n; j += 1) {
        const p2 = ((2 * j - 1) * x * p1 - (j - 1) * p0) / j;
        p0 = p1;
        p1 = p2;
      }
      dp = (n * (x * p1 - p0)) / (x * x - 1);
      const dx = p1 / dp;
      x -= dx;
      if (Math.abs(dx) < 1e-15) break;
    }
    const w = 2 / ((1 - x * x) * dp * dp);
    const mid = (a + b) / 2;
    const half = (b - a) / 2;
    const vp = f(mid + half * x);
    const vm = f(mid - half * x);
    if (Math.abs(x) < 1e-14) {
      if (Number.isFinite(vp)) sum += w * vp;
    } else {
      if (Number.isFinite(vp)) sum += w * vp;
      if (Number.isFinite(vm)) sum += w * vm;
    }
  }
  return ((b - a) / 2) * sum;
}

/** 把 Expr 包成数值函数 */
export function fnOf(e: Expr, v: string, others: Record<string, number> = {}): Fn1 {
  return (x: number) => evalExpr(e, { ...others, [v]: x });
}

export type NumericIntegral = { value: number; converged: boolean; method: string; singularities: number[] };

/** 找出区间内部让被积函数爆掉的点（端点奇性交给 tanh-sinh） */
function findInteriorSingularities(f: Fn1, a: number, b: number): number[] {
  const N = 1000;
  const xs: number[] = [];
  const vs: number[] = [];
  for (let i = 0; i <= N; i += 1) {
    const x = a + ((b - a) * i) / N;
    xs.push(x);
    let v: number;
    try {
      v = f(x);
    } catch {
      v = NaN;
    }
    vs.push(Number.isFinite(v) ? Math.abs(v) : Infinity);
  }
  const found: number[] = [];
  for (let i = 1; i < N; i += 1) {
    if (vs[i] > 1e10) {
      let lo = xs[i - 1];
      let hi = xs[i + 1];
      for (let k = 0; k < 70; k += 1) {
        const mid = (lo + hi) / 2;
        let vm: number;
        try {
          vm = f(mid);
        } catch {
          vm = NaN;
        }
        if (!Number.isFinite(vm) || Math.abs(vm) > 1e10) hi = mid;
        else lo = mid;
      }
      const pos = (lo + hi) / 2;
      if (pos > a + (b - a) * 1e-6 && pos < b - (b - a) * 1e-6) found.push(pos);
    }
  }
  const merged: number[] = [];
  for (const p of found) {
    if (merged.length === 0 || Math.abs(p - merged[merged.length - 1]) > (b - a) * 1e-3) merged.push(p);
  }
  return merged;
}

/** 某点是否能算出有限值（端点奇性检测用） */
function finiteAt(f: Fn1, x: number): boolean {
  try {
    return Number.isFinite(f(x));
  } catch {
    return false;
  }
}

/**
 * 定积分 / 反常积分的数值计算。
 * 端点奇性与无穷区间先做变量替换，再用 tanh-sinh；收敛性靠两层加密对比判断。
 */
export function integrateNumeric(f: Fn1, a: number, b: number, label = "数值积分"): NumericIntegral {
  const run = (g: Fn1, lo: number, hi: number, singular: boolean): { value: number; converged: boolean } => {
    const v1 = singular ? tanhSinh(g, lo, hi, 6) : adaptiveSimpson(g, lo, hi);
    const v2 = singular ? tanhSinh(g, lo, hi, 8) : adaptiveSimpson(g, lo, hi, 1e-13);
    const scale = Math.max(1, Math.abs(v2));
    const converged = Number.isFinite(v1) && Number.isFinite(v2) && Math.abs(v1 - v2) / scale < 1e-7;
    return { value: v2, converged };
  };
  if (!Number.isFinite(a) || !Number.isFinite(b)) {
    let g: Fn1;
    let lo = 0;
    let hi = 1;
    if (a === -Infinity && b === Infinity) {
      g = (t) => f(t / (1 - t * t)) * ((1 + t * t) / Math.pow(1 - t * t, 2));
      lo = -1;
      hi = 1;
    } else if (b === Infinity) {
      g = (t) => f(a + t / (1 - t)) / Math.pow(1 - t, 2);
    } else {
      g = (t) => f(b - t / (1 - t)) / Math.pow(1 - t, 2);
    }
    const r = run(g, lo, hi, true);
    return {
      value: r.value,
      converged: r.converged,
      method: `${label}：无穷区间先换元到有限区间，再用 tanh-sinh（双指数）求积`,
      singularities: [],
    };
  }
  const sing = findInteriorSingularities(f, a, b);
  if (sing.length === 0) {
    // 【修正】端点奇性也要判：自适应 Simpson 的端点求值一定会取到 a 与 b，
    // 只要 f(a) 或 f(b) 是 ∞（例如 ∫₀¹ 1/√x dx，f(0) = ∞），整个结果就被污染成 NaN。
    // 而 tanh-sinh 本来就是「两端可以带奇性」的方法（见上面 tanhSinh 的注释），
    // 所以这里检测到端点不可求值时就切到 tanh-sinh。
    const endpointBad = !finiteAt(f, a) || !finiteAt(f, b);
    const r = run(f, a, b, endpointBad);
    return {
      value: r.value,
      converged: r.converged,
      method: endpointBad
        ? `${label}：端点处函数发散，改用 tanh-sinh（双指数）求积`
        : `${label}：自适应复合 Simpson（区间内未发现奇点）`,
      singularities: [],
    };
  }
  const pts = [a, ...sing, b];
  let total = 0;
  let converged = true;
  for (let i = 0; i + 1 < pts.length; i += 1) {
    if (pts[i + 1] - pts[i] <= 0) continue;
    const r = run(f, pts[i], pts[i + 1], true);
    if (!Number.isFinite(r.value) || Math.abs(r.value) > 1e12) {
      converged = false;
      break;
    }
    if (!r.converged) converged = false;
    total += r.value;
  }
  return {
    value: total,
    converged,
    method: `${label}：检测到 ${sing.length} 个奇点（${sing.map((x) => Number(x.toPrecision(6))).join("、")}），按奇点分段后用 tanh-sinh 求积`,
    singularities: sing,
  };
}

/** 二重积分（迭代高斯-勒让德） */
export function doubleIntegral(
  f: Expr,
  vx: string,
  vy: string,
  xa: number,
  xb: number,
  ya: number,
  yb: number,
  n = 28,
): number {
  const inner = (y: number): number => gaussLegendre((x) => evalExpr(f, { [vx]: x, [vy]: y }), xa, xb, n);
  return gaussLegendre(inner, ya, yb, n);
}

/* ==========================================================================
 * 第 11 部分：极限（洛必达 + 泰勒展开 + 数值逼近复核）
 * ========================================================================== */

/** 把幂指函数 a^b（指数含变量）改写成 e^(b·ln a)，便于求极限 */
function toExpForm(e: Expr, v: string): Expr {
  switch (e.k) {
    case "num":
    case "sym":
      return e;
    case "fn":
      return { k: "fn", n: e.n, a: toExpForm(e.a, v), b: e.b ? toExpForm(e.b, v) : undefined };
    case "pow": {
      const a = toExpForm(e.a, v);
      const b = toExpForm(e.b, v);
      if (hasVar(b, v)) return fn("exp", mul(b, fn("ln", a)));
      return { k: "pow", a, b };
    }
    default:
      return { k: e.k, a: toExpForm(e.a, v), b: toExpForm(e.b, v) } as Expr;
  }
}

/** 直接把某个点代进去求值；算不出（NaN/无穷/报错）就返回 null */
function valueAt(e: Expr, v: string, a: number, others: Record<string, number> = {}): number | null {
  try {
    const val = evalExpr(e, { ...others, [v]: a });
    return Number.isFinite(val) ? val : null;
  } catch {
    return null;
  }
}

/** 泰勒系数的数值：f(a), f′(a)/1!, f″(a)/2!, … */
function seriesCoeffs(
  f: Expr,
  v: string,
  a: number,
  n: number,
  others: Record<string, number>,
): number[] | null {
  const out: number[] = [];
  let cur = f;
  let fact = 1;
  for (let k = 0; k <= n; k += 1) {
    if (k > 0) {
      try {
        cur = simplifyDeep(derivative(cur, v));
      } catch {
        return null;
      }
      fact *= k;
    }
    const val = valueAt(cur, v, a, others);
    if (val === null) return null;
    out.push(val / fact);
  }
  return out;
}

/** 找最低阶非零项的阶数 */
function leadingOrder(c: number[], tol = 1e-9): number {
  const scale = Math.max(...c.map((x) => Math.abs(x)), 1);
  for (let i = 0; i < c.length; i += 1) if (Math.abs(c[i]) > tol * scale) return i;
  return -1;
}

/** 用泰勒展开比较分子分母的最低阶项（0/0、∞/∞ 都适用） */
function seriesLimitRatio(
  numE: Expr,
  den: Expr,
  v: string,
  a: number,
  trace: Trace,
  others: Record<string, number> = {},
): { value: Expr; method: string } | null {
  const cn = seriesCoeffs(numE, v, a, 8, others);
  const cd = seriesCoeffs(den, v, a, 8, others);
  if (!cn || !cd) return null;
  const kn = leadingOrder(cn);
  const kd = leadingOrder(cd);
  if (kn < 0 || kd < 0) return null;
  pushTrace(
    trace,
    `泰勒展开到 8 阶：分子最低非零项是 ${v}^${kn}（系数 ${Number(cn[kn].toPrecision(8))}），` +
      `分母最低非零项是 ${v}^${kd}（系数 ${Number(cd[kd].toPrecision(8))}）`,
  );
  if (kn > kd) {
    pushTrace(trace, "分子阶数更高 → 极限为 0");
    return { value: ZERO, method: "泰勒展开（比较最低阶项）" };
  }
  if (kn < kd) return null; // 趋于无穷，交给数值证据判断符号
  return { value: num(cn[kn] / cd[kd]), method: "泰勒展开（比较最低阶项）" };
}

export type LimitPoint = number | "inf" | "-inf";

export type LimitSide = { value: number | null; settled: boolean; samples: Array<{ x: number; fx: number }> };

/** 单侧数值逼近（Richardson 外推），与符号方法互相独立 */
export function numericLimitSide(
  f: Expr,
  v: string,
  point: LimitPoint,
  side: 1 | -1,
  others: Record<string, number> = {},
): LimitSide {
  const samples: Array<{ x: number; fx: number }> = [];
  const vals: number[] = [];
  const n = 14;
  for (let i = 0; i < n; i += 1) {
    const h = 0.1 * Math.pow(2, -i);
    const x = point === "inf" ? side / h : point === "-inf" ? side / h : point + side * h;
    const fx = valueAt(f, v, x, others);
    samples.push({ x, fx: fx === null ? NaN : fx });
    if (fx !== null) vals.push(fx);
  }
  if (vals.length < 4) return { value: null, settled: false, samples };
  // Richardson：h → 0，消去 h、h²、h³… 各阶（原始网点是 2 倍加密，所以用 2^j 因子）
  let cur = vals.slice(-8);
  for (let j = 1; j < 6 && cur.length > 1; j += 1) {
    const p = Math.pow(2, j);
    const next: number[] = [];
    for (let k = 0; k + 1 < cur.length; k += 1) next.push((p * cur[k + 1] - cur[k]) / (p - 1));
    cur = next;
  }
  const value = cur[0];
  if (!Number.isFinite(value)) return { value: null, settled: false, samples };
  const prev = vals[vals.length - 2];
  const rough = Math.abs(vals[vals.length - 1] - prev);
  const settled = rough < 1e-3 * Math.max(1, Math.abs(value)) || Math.abs(value) > 1e6;
  return { value, settled, samples };
}

export type LimitResult = {
  exists: boolean;
  value: Expr | null;
  numericLeft: number | null;
  numericRight: number | null;
  uncertain: boolean;
  method: string;
  steps: Trace;
  table: Array<{ h: number; xLeft: number; fxLeft: number; xRight: number; fxRight: number }>;
};

/** 符号求极限（内部：有限点） */
function limitCore(
  f: Expr,
  v: string,
  a: number,
  trace: Trace,
  others: Record<string, number>,
  depth: number,
): { value: Expr | null; method: string } {
  if (depth > 3) return { value: null, method: "" };
  // 1) 直接代入
  const direct = valueAt(f, v, a, others);
  if (direct !== null) {
    pushTrace(trace, `直接代入：函数在 ${v} → ${a} 处连续，直接算出 ${Number(direct.toPrecision(10))}`);
    return { value: num(direct), method: "直接代入（连续函数）" };
  }
  // 2) 幂指函数：a^b → e^(b·ln a)，把 1^∞ / 0^0 / ∞^0 变成指数上的 0·∞
  const expForm = toExpForm(f, v);
  if (keyOf(expForm) !== keyOf(f) && expForm.k === "fn" && expForm.n === "exp") {
    const inner = expForm.a;
    pushTrace(trace, `幂指函数先取对数：原式 = e^(${txt(inner)})，只需先求指数部分的极限`);
    const r = limitCore(inner, v, a, trace, others, depth + 1);
    if (r.value) {
      return { value: simplify(fn("exp", r.value)), method: `幂指函数化为 e^u 后求极限（${r.method}）` };
    }
  }
  // 3) 0·∞ 型：把含变量的因子搬到分母
  if (f.k === "mul") {
    const factors: Expr[] = [];
    flattenMul(f, factors);
    for (let i = 0; i < factors.length; i += 1) {
      if (!hasVar(factors[i], v)) continue;
      const rest = rebuildMul(factors.filter((_, k) => k !== i));
      const asRatio = div(rest, div(ONE, factors[i]));
      pushTrace(trace, `0·∞ 型：把因子 ${txt(factors[i])} 移到分母，化成 ${txt(asRatio)} 再用洛必达/泰勒`);
      const r = limitCore(asRatio, v, a, trace, others, depth + 1);
      if (r.value) return { value: r.value, method: `把 0·∞ 化成商式后求极限（${r.method}）` };
    }
  }
  // 4) 商式：洛必达 + 泰勒
  if (f.k === "div") {
    let p = f.a;
    let q = f.b;
    for (let i = 0; i < 5; i += 1) {
      const r0 = seriesLimitRatio(p, q, v, a, trace, others);
      if (r0) return r0;
      const pv = valueAt(p, v, a, others);
      const qv = valueAt(q, v, a, others);
      const isIndeterminate =
        (pv === null || Math.abs(pv) < 1e-14) && (qv === null || Math.abs(qv) < 1e-14) ? true : pv === null || qv === null;
      if (!isIndeterminate && pv !== null && qv !== null && Math.abs(qv) > 1e-14) {
        return { value: num(pv / qv), method: "分子分母分别求极限后相除" };
      }
      pushTrace(trace, `洛必达法则第 ${i + 1} 次：分子分母分别对 ${v} 求导`);
      try {
        p = simplifyDeep(derivative(p, v));
        q = simplifyDeep(derivative(q, v));
      } catch {
        return { value: null, method: "" };
      }
      const rr = limitCore(simplifyDiv(p, q), v, a, trace, others, depth + 1);
      if (rr.value) return { value: rr.value, method: `洛必达法则（用了 ${i + 1} 次）` };
    }
    return { value: null, method: "" };
  }
  // 5) 加减结构：拆开看
  if (f.k === "add") {
    const A = limitCore(f.a, v, a, trace, others, depth + 1);
    const B = limitCore(f.b, v, a, trace, others, depth + 1);
    if (A.value && B.value) {
      return { value: simplify(add(A.value, B.value)), method: `${A.method} / ${B.method}` };
    }
  }
  return { value: null, method: "" };
}

/** 求极限（对外入口）：符号 + 数值双通道，不一致时如实标注「无法确定」 */
export function computeLimit(
  f: Expr,
  v: string,
  point: LimitPoint,
  trace: Trace = [],
  othersIn: Record<string, number> = {},
): LimitResult {
  const others = fillOthers(f, v, othersIn);
  const left = numericLimitSide(f, v, point, -1, others);
  const right = numericLimitSide(f, v, point, 1, others);
  // 符号部分：无穷远点先做 x = ±1/t 换元
  let symExpr: Expr | null = null;
  let method = "";
  const t = "__t";
  try {
    if (point === "inf" || point === "-inf") {
      // 这里的 sym( ) 是 AST 构造函数（造一个变量节点），不是上面那个局部变量
      const sub = point === "inf" ? div(ONE, sym(t)) : neg(div(ONE, sym(t)));
      const g = simplify(subst(f, v, sub));
      pushTrace(trace, `无穷远点换元：令 ${v} = ${point === "inf" ? "1/t" : "−1/t"}，化为 t → 0⁺ 的极限`);
      const r = limitCore(g, t, 0, trace, others, 0);
      symExpr = r.value;
      method = r.method ? `无穷远点换元 + ${r.method}` : "";
    } else {
      const r = limitCore(f, v, point, trace, others, 0);
      symExpr = r.value;
      method = r.method;
    }
  } catch (err) {
    if (err instanceof MathError) pushTrace(trace, `符号分析中止：${err.message}`);
    symExpr = null;
  }
  const nl = left.value;
  const nr = right.value;
  const both = nl !== null && nr !== null;
  const sameSide = both && Math.abs(nl - nr) <= 1e-6 * Math.max(1, Math.abs(nl), Math.abs(nr));
  let symOk = false;
  if (symExpr && isNum(symExpr) && both) {
    const target = sameSide ? (nl + nr) / 2 : NaN;
    symOk = Number.isFinite(target) && Math.abs(symExpr.v - target) <= 1e-6 * Math.max(1, Math.abs(target));
  } else if (symExpr && !isNum(symExpr)) {
    symOk = true; // e、π 这类符号结果不做数值比对
  }
  const exists = sameSide && (nl === null || Math.abs(nl) < 1e12 || !left.settled === false);
  const table = left.samples.map((s, i) => ({
    h: 0.1 * Math.pow(2, -i),
    xLeft: s.x,
    fxLeft: s.fx,
    xRight: right.samples[i]?.x ?? NaN,
    fxRight: right.samples[i]?.fx ?? NaN,
  }));
  if (!sameSide && both) {
    pushTrace(trace, "左右两侧数列收敛到不同的值 → 该点极限不存在（只存在单侧极限）");
    return {
      exists: false,
      value: null,
      numericLeft: nl,
      numericRight: nr,
      uncertain: false,
      method: method || "数值逼近",
      steps: trace,
      table,
    };
  }
  if (!symExpr) {
    return {
      exists: both && left.settled && right.settled,
      value: null,
      numericLeft: nl,
      numericRight: nr,
      uncertain: true,
      method: method || "数值逼近（未能给出符号结果）",
      steps: trace,
      table,
    };
  }
  return {
    exists: both ? left.settled && right.settled : true,
    value: symExpr,
    numericLeft: nl,
    numericRight: nr,
    uncertain: !symOk && isNum(symExpr),
    method: method || "符号推导",
    steps: trace,
    table,
  };
}

/* ==========================================================================
 * 第 12 部分：级数、泰勒展开、傅里叶系数
 * ========================================================================== */

export type TaylorTerm = { order: number; coeff: Expr; term: Expr };

/** 泰勒展开：返回各项（从 0 阶开始）到 n 阶 */
export function taylorSeries(f: Expr, v: string, a: Expr, n: number, trace: Trace = []): TaylorTerm[] {
  if (n < 0 || n > 12) fail("泰勒展开阶数请取 0 ~ 12");
  const out: TaylorTerm[] = [];
  let cur = f;
  let fact = 1;
  for (let k = 0; k <= n; k += 1) {
    if (k > 0) {
      cur = simplifyDeep(derivative(cur, v));
      fact *= k;
    }
    const at = simplify(subst(cur, v, a));
    const coeff = simplifyDiv(at, num(fact));
    if (!(isNum(coeff) && coeff.v === 0) || out.length > 0) {
      const delta = sub(sym(v), a);
      const term = k === 0 ? coeff : k === 1 ? mul(coeff, delta) : mul(coeff, pow(delta, num(k)));
      out.push({ order: k, coeff, term: simplify(term) });
    }
  }
  if (out.length) {
    pushTrace(trace, `逐阶求导得到 ${n} 阶泰勒系数：f⁽ᵏ⁾(a)/k!（k = 0…${n}）`);
  }
  return out;
}

/** 求和表达式 Σ_{k=from}^{to} f(k)（to = Infinity 时用数值加速） */
export function seriesSum(
  term: Expr,
  k: string,
  from: number,
  to: number | "inf",
  trace: Trace = [],
): { value: Expr; numeric?: number; converged: boolean; method: string } {
  const evalAt = (n: number): number | null => valueAt(term, k, n);
  if (to !== "inf") {
    let acc = 0;
    for (let n = from; n <= to; n += 1) {
      const v = evalAt(n);
      if (v === null) fail(`第 ${n} 项算不出来，请检查通项是否对整数有定义`);
      acc += v;
    }
    pushTrace(trace, `逐项相加：从 ${k} = ${from} 加到 ${to}，共 ${to - from + 1} 项`);
    return { value: num(acc), numeric: acc, converged: true, method: "有限项直接求和" };
  }
  // 无穷级数：先看是不是几何级数
  const a0 = evalAt(from);
  const a1 = evalAt(from + 1);
  const a2 = evalAt(from + 2);
  if (a0 !== null && a1 !== null && a2 !== null && Math.abs(a0) > 1e-14) {
    const r1 = a1 / a0;
    const r2 = a2 / a1;
    if (Math.abs(r1 - r2) < 1e-10) {
      if (Math.abs(r1) < 1) {
        pushTrace(trace, `识别为几何级数，公比 q = ${Number(r1.toPrecision(10))}，|q| < 1 → 收敛`);
        return { value: num(a0 / (1 - r1)), numeric: a0 / (1 - r1), converged: true, method: "几何级数求和公式" };
      }
      pushTrace(trace, `识别为几何级数，公比 q = ${Number(r1.toPrecision(10))}，|q| ≥ 1 → 发散`);
      return { value: div(num(a0), sub(ONE, num(r1))), converged: false, method: "几何级数（|q| ≥ 1，发散）" };
    }
  }
  // 部分和 + Richardson 外推
  const partials: number[] = [];
  let acc = 0;
  for (let n = from; n <= from + 400; n += 1) {
    const v = evalAt(n);
    if (v === null) break;
    acc += v;
    if (n >= from + 20) partials.push(acc);
  }
  const last = partials[partials.length - 1];
  const prev = partials[partials.length - 2];
  const converged = Number.isFinite(last) && Math.abs(last - prev) < 1e-9 * Math.max(1, Math.abs(last));
  pushTrace(trace, `数值部分和（前 400 项）：S${partials.length + 20} = ${Number(last.toPrecision(12))}`);
  return {
    value: num(last),
    numeric: last,
    converged,
    method: converged ? "数值部分和（已稳定）" : "数值部分和（仍在变化 → 可能发散或收敛很慢）",
  };
}

/** 收敛性判别（对 Σ a_n 给出判据结论） */
export function seriesConvergence(
  term: Expr,
  k: string,
  from: number,
  trace: Trace = [],
): { verdict: string; detail: string } {
  const at = (n: number) => valueAt(term, k, n);
  const a1 = at(from);
  const a2 = at(from + 1);
  if (a1 === null || a2 === null) return { verdict: "无法判断", detail: "通项在整数点算不出数值，暂时给不出判别结论" };
  const absAt = (n: number): number | null => {
    const v = at(n);
    return v === null ? null : Math.abs(v);
  };
  const an = absAt(from + 200) ?? 0;
  const an1 = absAt(from + 201) ?? 0;
  const a400 = absAt(from + 400);
  const a401 = absAt(from + 401);
  const sameSign =
    Math.sign(at(from + 20) ?? 0) === Math.sign(at(from + 200) ?? 0) &&
    Math.sign(at(from + 200) ?? 0) === Math.sign(at(from + 400) ?? 0) &&
    Math.sign(at(from + 200) ?? 0) !== 0;
  if (an1 > 0 && an > 0) {
    const ratio = an1 / an;
    if (ratio <= 0.95) {
      pushTrace(trace, `比值判别法：lim |a(n+1)/a(n)| ≈ ${Number(ratio.toPrecision(6))} < 1 → 绝对收敛`);
      return { verdict: "收敛（绝对收敛）", detail: `比值判别法：|a(n+1)/a(n)| ≈ ${Number(ratio.toPrecision(6))} < 1` };
    }
    if (ratio >= 1.05) {
      pushTrace(trace, `比值判别法：lim |a(n+1)/a(n)| ≈ ${Number(ratio.toPrecision(6))} > 1 → 发散`);
      return { verdict: "发散", detail: `比值判别法：|a(n+1)/a(n)| ≈ ${Number(ratio.toPrecision(6))} > 1` };
    }
    // 【修正】比值落在 1 附近时，原来的实现用「ratio < 1 − 1e-9」下结论，于是调和级数
    // Σ1/k（n = 200 处比值 = 200/201 ≈ 0.995 < 1）被判成「绝对收敛」—— 一个错误答案。
    // 有限 n 上的比值永远给不出极限为 1 的判据，所以这里换一条等价但可判的途径：
    // 对 p 级数型通项，广义指数 p = lim n·ln(a(n)/a(n+1)) 是有限数，p ≤ 1 发散、p > 1 收敛。
    // 只有在两个不同的 n 上算出的 p 稳定（单调靠拢、彼此相差 < 2%）时才采信；
    // 带对数修正的通项（如 1/(n·ln n)）估计值会单调偏离，此时如实返回「未判定」。
    if (sameSign && a400 !== null && a401 !== null && a400 > 0 && a401 > 0) {
      const p1 = (from + 200) * Math.log(an / an1);
      const p2 = (from + 400) * Math.log(a400 / a401);
      const stable = Number.isFinite(p1) && Number.isFinite(p2) && p2 >= p1 - 1e-3 && Math.abs(p2 - p1) <= 0.02 * Math.max(1, p2);
      if (stable && p2 <= 1 - 0.02) {
        pushTrace(trace, `与 p 级数比较：由比值推得指数 p ≈ ${Number(p2.toPrecision(6))} ≤ 1 → 与 Σ1/n 同阶或更慢 → 发散`);
        return { verdict: "发散", detail: `p 判别法：由比值推得 p ≈ ${Number(p2.toPrecision(6))} ≤ 1 → 发散` };
      }
      if (stable && p2 >= 1 + 0.02) {
        pushTrace(trace, `与 p 级数比较：由比值推得指数 p ≈ ${Number(p2.toPrecision(6))} > 1 → 绝对收敛`);
        return { verdict: "收敛（绝对收敛）", detail: `p 判别法：由比值推得 p ≈ ${Number(p2.toPrecision(6))} > 1 → 绝对收敛` };
      }
    }
  }
  // 【修正】「通项是否趋于 0」原来用固定阈值 an > 1e-6：收敛很慢的级数（例如交错级数
  // (−1)^k/k，a(200) = 0.005）会被判成「通项不趋于 0 → 发散」，同样是把收敛判成发散。
  // 正确的观察是「通项还在明显衰减吗」——拿远处的项与更远处的项比，而不是与固定常数比。
  const early = absAt(from + 20) ?? Math.abs(a1);
  const late = absAt(from + 400) ?? an;
  const decaying = Number.isFinite(early) && Number.isFinite(late) && early > 0 && late < early / 2;
  if (!decaying && an > 1e-9) {
    return {
      verdict: "发散",
      detail: `通项不趋于 0（a(${from + 20}) ≈ ${Number(early.toPrecision(6))}，a(${from + 400}) ≈ ${Number(
        late.toPrecision(6),
      )}）→ 由必要条件知级数发散`,
    };
  }
  if (Math.abs(a1 + a2) < Math.abs(a1) && Math.abs(a1) > 0) {
    // 交错级数
    const dec = Math.abs(at(from + 200) ?? 0) < Math.abs(a1);
    if (dec) {
      pushTrace(trace, "莱布尼茨判别法：通项绝对值单调递减且趋于 0 → 交错级数收敛");
      return { verdict: "收敛（条件收敛）", detail: "莱布尼茨判别法：交错级数且通项绝对值递减趋于 0" };
    }
  }
  // 同号级数：与调和级数做极限比较（n·a(n) 稳定在一个正数 ⟹ a(n) 与 1/n 同阶 ⟹ 发散）。
  // 这是严格判据，专门兜住 p 判别法没覆盖到的同号情形。
  if (sameSign) {
    const p1 = (from + 200) * Math.abs(at(from + 200) ?? 0);
    const p2 = (from + 400) * Math.abs(at(from + 400) ?? 0);
    if (p1 > 1e-9 && p2 > 1e-9 && Math.abs(p2 - p1) <= 0.1 * Math.max(p1, p2)) {
      pushTrace(trace, `与调和级数比较：n·a(n) ≈ ${Number(p1.toPrecision(6))} 基本不变 → 与 Σ1/n 同阶 → 发散`);
      return {
        verdict: "发散",
        detail: `极限比较判别法：n·a(n) ≈ ${Number(p1.toPrecision(6))} 稳定在正数，与 Σ1/n 同阶 → 发散`,
      };
    }
  }
  return { verdict: "可能收敛（未判定）", detail: "比值判别法失效（极限为 1），建议用 p 判别法或比较判别法人工判断" };
}

/** 傅里叶级数系数（周期 2L，数值积分得到） */
export function fourierCoeffs(
  f: Expr,
  v: string,
  L: number,
  nMax: number,
): { a0: number; an: number[]; bn: number[] } {
  const fn = fnOf(f, v);
  const an: number[] = [0];
  const bn: number[] = [0];
  const a0 = (1 / L) * gaussLegendre(fn, -L, L, 60);
  for (let n = 1; n <= nMax; n += 1) {
    const w = (n * Math.PI) / L;
    an.push(
      (1 / L) * gaussLegendre((x) => fn(x) * Math.cos(w * x), -L, L, 80),
    );
    bn.push(
      (1 / L) * gaussLegendre((x) => fn(x) * Math.sin(w * x), -L, L, 80),
    );
  }
  return { a0, an, bn };
}

/* ==========================================================================
 * 第 13 部分：矩阵 / 线性方程组 / 向量 / 复数
 * ========================================================================== */

export type Matrix = number[][];

export function matMul(A: Matrix, B: Matrix): Matrix {
  const n = A.length;
  const m = B[0].length;
  const k = B.length;
  const out: Matrix = [];
  for (let i = 0; i < n; i += 1) {
    const row: number[] = [];
    for (let j = 0; j < m; j += 1) {
      let s = 0;
      for (let t = 0; t < k; t += 1) s += A[i][t] * B[t][j];
      row.push(s);
    }
    out.push(row);
  }
  return out;
}

export function matDet(A: Matrix): number {
  const n = A.length;
  const M = A.map((r) => [...r]);
  let det = 1;
  for (let col = 0; col < n; col += 1) {
    let piv = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-14) return 0;
    if (piv !== col) {
      const t = M[piv];
      M[piv] = M[col];
      M[col] = t;
      det = -det;
    }
    det *= M[col][col];
    for (let r = col + 1; r < n; r += 1) {
      const f = M[r][col] / M[col][col];
      for (let c = col; c < n; c += 1) M[r][c] -= f * M[col][c];
    }
  }
  return det;
}

export function matInverse(A: Matrix): Matrix | null {
  const n = A.length;
  const M = A.map((r, i) => [...r, ...Array.from({ length: n }, (_, j) => (i === j ? 1 : 0))]);
  for (let col = 0; col < n; col += 1) {
    let piv = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    const t = M[piv];
    M[piv] = M[col];
    M[col] = t;
    const p = M[col][col];
    for (let c = 0; c < 2 * n; c += 1) M[col][c] /= p;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const f = M[r][col];
      if (f === 0) continue;
      for (let c = 0; c < 2 * n; c += 1) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row) => row.slice(n));
}

export function matRank(A: Matrix): number {
  const M = A.map((r) => [...r]);
  const rows = M.length;
  const cols = M[0].length;
  let rank = 0;
  for (let col = 0; col < cols && rank < rows; col += 1) {
    let piv = rank;
    for (let r = rank + 1; r < rows; r += 1) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) continue;
    const t = M[piv];
    M[piv] = M[rank];
    M[rank] = t;
    for (let r = 0; r < rows; r += 1) {
      if (r === rank) continue;
      const f = M[r][col] / M[rank][col];
      for (let c = col; c < cols; c += 1) M[r][c] -= f * M[rank][c];
    }
    rank += 1;
  }
  return rank;
}

/** 特征值：用 Faddeev–LeVerrier 求特征多项式系数，再对多项式求根 */
export function matEigenvalues(A: Matrix): Cx[] {
  const n = A.length;
  if (n === 1) return [cx(A[0][0])];
  if (n === 2) {
    const tr = A[0][0] + A[1][1];
    const det = A[0][0] * A[1][1] - A[0][1] * A[1][0];
    const disc = tr * tr - 4 * det;
    if (disc >= 0) {
      const s = Math.sqrt(disc);
      return [cx((tr + s) / 2), cx((tr - s) / 2)];
    }
    const s = Math.sqrt(-disc);
    return [cx(tr / 2, s / 2), cx(tr / 2, -s / 2)];
  }
  // Faddeev–LeVerrier：p(λ) = λ^n + c1 λ^(n-1) + … + cn
  const I: Matrix = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  let M: Matrix = I.map((r) => [...r]);
  const coeffs: number[] = [1];
  for (let k = 1; k <= n; k += 1) {
    const AM = matMul(A, M);
    const trace = AM.reduce((s, row, i) => s + row[i], 0);
    const ck = -trace / k;
    coeffs.push(ck);
    M = AM.map((row, i) => row.map((val, j) => val + (i === j ? ck : 0)));
  }
  return polyRoots(coeffs);
}

/** 实对称/一般矩阵的 QR 迭代（这里只用于给出实特征值的近似交叉核对） */
export function qrEigenvaluesReal(A: Matrix, iterations = 200): number[] {
  let M = A.map((r) => [...r]);
  const n = M.length;
  for (let it = 0; it < iterations; it += 1) {
    // Gram–Schmidt QR
    const Q: Matrix = Array.from({ length: n }, () => new Array(n).fill(0));
    const R: Matrix = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let j = 0; j < n; j += 1) {
      const v = M.map((row) => row[j]);
      for (let i = 0; i < j; i += 1) {
        let s = 0;
        for (let k = 0; k < n; k += 1) s += Q[k][i] * M[k][j];
        R[i][j] = s;
        for (let k = 0; k < n; k += 1) v[k] -= s * Q[k][i];
      }
      const norm = Math.hypot(...v);
      R[j][j] = norm;
      for (let k = 0; k < n; k += 1) Q[k][j] = norm === 0 ? 0 : v[k] / norm;
    }
    M = matMul(R, Q);
  }
  return Array.from({ length: n }, (_, i) => M[i][i]).sort((a, b) => a - b);
}

/** 线性方程组 Ax = b（高斯消元） */
export function solveLinear(A: Matrix, b: number[]): { x: number[] | null; note: string } {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col += 1) {
    let piv = col;
    for (let r = col + 1; r < n; r += 1) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) {
      return { x: null, note: "系数矩阵奇异（行列式为 0），方程组没有唯一解" };
    }
    const t = M[piv];
    M[piv] = M[col];
    M[col] = t;
    for (let r = 0; r < n; r += 1) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c += 1) M[r][c] -= f * M[col][c];
    }
  }
  return { x: M.map((row, i) => row[n] / M[i][i]), note: "唯一解" };
}

/* ------------------------------ 向量运算 ------------------------------ */

export function vecDot(a: number[], b: number[]): number {
  return a.reduce((s, x, i) => s + x * (b[i] ?? 0), 0);
}

export function vecCross(a: number[], b: number[]): number[] | null {
  if (a.length !== 3 || b.length !== 3) return null;
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function vecNorm(a: number[]): number {
  return Math.hypot(...a);
}

export function vecAngle(a: number[], b: number[]): number | null {
  const na = vecNorm(a);
  const nb = vecNorm(b);
  if (na === 0 || nb === 0) return null;
  const c = Math.min(1, Math.max(-1, vecDot(a, b) / (na * nb)));
  return Math.acos(c);
}

/** 复数表达式求值（复用同一套 parser：把 i 当虚数单位） */
export function evalComplex(src: string, vars: Record<string, Cx> = {}): Cx {
  const e = parse(src);
  const go = (x: Expr): Cx => {
    switch (x.k) {
      case "num":
        return cx(x.v);
      case "sym": {
        if (x.n === "i") return cx(0, 1);
        if (x.n === "pi") return cx(Math.PI);
        if (x.n === "e") return cx(Math.E);
        const v = vars[x.n];
        if (!v) fail(`复数表达式里的「${x.n}」没有给值`);
        return v;
      }
      case "add":
        return cAdd(go(x.a), go(x.b));
      case "mul":
        return cMul(go(x.a), go(x.b));
      case "div":
        return cDiv(go(x.a), go(x.b));
      case "pow":
        return cPow(go(x.a), go(x.b));
      case "fn": {
        const a = go(x.a);
        switch (x.n) {
          case "exp":
            return cExp(a);
          case "ln":
            return cLog(a);
          case "sqrt":
            return cPow(a, cx(0.5));
          case "sin":
            return { re: Math.sin(a.re) * Math.cosh(a.im), im: Math.cos(a.re) * Math.sinh(a.im) };
          case "cos":
            return { re: Math.cos(a.re) * Math.cosh(a.im), im: -Math.sin(a.re) * Math.sinh(a.im) };
          case "tan": {
            const s = { re: Math.sin(a.re) * Math.cosh(a.im), im: Math.cos(a.re) * Math.sinh(a.im) };
            const c = { re: Math.cos(a.re) * Math.cosh(a.im), im: -Math.sin(a.re) * Math.sinh(a.im) };
            return cDiv(s, c);
          }
          case "abs":
            return cx(cAbs(a));
          case "conj":
            return cx(a.re, -a.im);
          default:
            fail(`复数运算暂不支持函数 ${x.n}`);
        }
        break;
      }
      default:
        fail("复数表达式里有无法解析的结构");
    }
    return cx(0);
  };
  return go(e);
}

/** 复数的 n 次方根（主值分支给出全部 n 个根） */
export function complexRoots(src: string, n: number): Cx[] {
  const z = evalComplex(src);
  const r = Math.pow(cAbs(z), 1 / n);
  const theta = Math.atan2(z.im, z.re);
  const out: Cx[] = [];
  for (let k = 0; k < n; k += 1) {
    const ang = (theta + 2 * Math.PI * k) / n;
    out.push({ re: r * Math.cos(ang), im: r * Math.sin(ang) });
  }
  return out;
}

/* ==========================================================================
 * 第 14 部分：常微分方程（一阶 y′ = f(x, y) / 二阶常系数线性方程）
 *
 * 说明：文件头部的模块注释里写了「数值兜底（… RK4 …）」，但引擎正文直到第 13 部分
 * 结束都没有实现任何一步常微分方程求解器（全文检索 Runge / Euler / 微分方程 只命中注释）。
 * 界面要求里「微分方程（含数值解）」是必须覆盖的一类运算，所以在**不改动任何既有引擎代码**
 * 的前提下，用引擎已有的 parse / evalExpr / derivative / integrateIndefinite / linearIn
 * 这一套原语，在这里把这一部分补上：
 *   - 符号解：一阶线性（积分因子）、一阶可分离变量（化隐式解）、二阶常系数齐次（特征根）；
 *   - 数值解：经典四阶 Runge–Kutta（一阶）与二阶系统降阶后的 RK4，另用 h 与 h/2 两次
 *     求解的差作为误差估计，绝不在没把握时声称收敛。
 * ========================================================================== */

export type OdePoint = { x: number; y: number };
export type OdeSystemPoint = { x: number; y: number; dy: number };

/** 一阶方程 y′ = f(x, y) 的经典四阶 Runge–Kutta 数值解 */
export function rk4Solve(
  rhs: Expr,
  xName: string,
  yName: string,
  x0: number,
  y0: number,
  xEnd: number,
  steps: number,
): OdePoint[] {
  if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(xEnd)) fail("初值与求解终点都必须是有限的数字");
  if (!Number.isInteger(steps) || steps < 2 || steps > 20000) fail("数值步数请取 2 ~ 20000 之间的整数");
  const g = (x: number, y: number): number => evalExpr(rhs, { [xName]: x, [yName]: y });
  const h = (xEnd - x0) / steps;
  let x = x0;
  let y = y0;
  const out: OdePoint[] = [{ x, y }];
  for (let i = 0; i < steps; i += 1) {
    let k1: number;
    let k2: number;
    let k3: number;
    let k4: number;
    try {
      k1 = g(x, y);
      k2 = g(x + h / 2, y + (h / 2) * k1);
      k3 = g(x + h / 2, y + (h / 2) * k2);
      k4 = g(x + h, y + h * k3);
    } catch (err) {
      throw new MathError(
        `数值解在第 ${i + 1} 步算不下去了：${err instanceof MathError ? err.message : "右端函数在该点没有定义"}`,
      );
    }
    y += (h / 6) * (k1 + 2 * k2 + 2 * k3 + k4);
    x += h;
    if (!Number.isFinite(y) || !Number.isFinite(x)) {
      fail(`数值解在第 ${i + 1} 步发散（解变成了无穷大），请把求解区间缩短或换个初值`);
    }
    out.push({ x, y });
  }
  return out;
}

/** 二阶方程 y″ + p·y′ + q·y = 0 降阶成方程组后的 RK4 数值解 */
export function rk4SecondOrder(
  p: number,
  q: number,
  x0: number,
  y0: number,
  dy0: number,
  xEnd: number,
  steps: number,
): OdeSystemPoint[] {
  if (!Number.isFinite(x0) || !Number.isFinite(y0) || !Number.isFinite(dy0) || !Number.isFinite(xEnd)) {
    fail("初值与求解终点都必须是有限的数字");
  }
  if (!Number.isInteger(steps) || steps < 2 || steps > 20000) fail("数值步数请取 2 ~ 20000 之间的整数");
  const acc = (y: number, dy: number): number => -(p * dy + q * y);
  const h = (xEnd - x0) / steps;
  let x = x0;
  let y = y0;
  let dy = dy0;
  const out: OdeSystemPoint[] = [{ x, y, dy }];
  for (let i = 0; i < steps; i += 1) {
    const a1 = dy;
    const b1 = acc(y, dy);
    const a2 = dy + (h / 2) * b1;
    const b2 = acc(y + (h / 2) * a1, dy + (h / 2) * b1);
    const a3 = dy + (h / 2) * b2;
    const b3 = acc(y + (h / 2) * a2, dy + (h / 2) * b2);
    const a4 = dy + h * b3;
    const b4 = acc(y + h * a3, dy + h * b3);
    y += (h / 6) * (a1 + 2 * a2 + 2 * a3 + a4);
    dy += (h / 6) * (b1 + 2 * b2 + 2 * b3 + b4);
    x += h;
    if (!Number.isFinite(y) || !Number.isFinite(dy)) fail(`数值解在第 ${i + 1} 步发散，请缩短求解区间`);
    out.push({ x, y, dy });
  }
  return out;
}

export type OdeSymbolic = { expr: Expr; steps: string[]; note: string };

/** 一阶线性 y′ = a(x)·y + b(x)：积分因子法求符号解；不是这个形式就返回 null */
export function solveFirstOrderLinear(
  rhs: Expr,
  x: string,
  y: string,
  x0: number,
  y0: number,
  steps: string[],
): OdeSymbolic | null {
  const lin = linearIn(rhs, y);
  if (!lin) return null;
  const A = integrateIndefinite(lin.a, x, []);
  if (!A.F) return null;
  const aF = simplifyDeep(A.F);
  const mu = mkPow(sym("e"), mkNeg(aF));
  const integrand = simplifyDeep(mkMul(lin.b, mu));
  const J = integrateIndefinite(integrand, x, []);
  if (!J.F) return null;
  const jF = simplifyDeep(J.F);
  let j0: number;
  let a0: number;
  try {
    j0 = evalExpr(jF, { [x]: x0 });
    a0 = evalExpr(aF, { [x]: x0 });
  } catch {
    return null;
  }
  if (!Number.isFinite(j0) || !Number.isFinite(a0)) return null;
  const c0 = y0 * Math.exp(-a0) - j0;
  const expr = simplifyDeep(mkMul(mkPow(sym("e"), aF), mkAdd(num(c0), jF)));
  steps.push(
    `识别为一阶线性方程：${y}′ = a(${x})·${y} + b(${x})，其中 a = ${printExpr(simplifyDeep(lin.a))}，b = ${printExpr(simplifyDeep(lin.b))}`,
  );
  steps.push(`积分因子 μ(${x}) = e^(−∫a d${x})，其中 ∫a d${x} = ${printExpr(aF)}`);
  steps.push(`通解公式：${y} = e^(∫a d${x})·(C + ∫b·μ d${x})，这里 ∫b·μ d${x} = ${printExpr(jF)}`);
  steps.push(`代入初值 ${y}(${fmt(x0)}) = ${fmt(y0)} 定出常数 C = ${fmt(c0)}`);
  return { expr, steps, note: "一阶线性方程（积分因子法）" };
}

export type OdeSeparable = { H: Expr; G: Expr; hText: string; gText: string; steps: string[] };

/**
 * 一阶可分离变量 y′ = g(x)·h(y)：先在网格上验证「真的能分离」，再对 1/h 与 g 分别求原函数。
 * 只给隐式解 H(y) − H(y₀) = G(x) − G(x₀)（不硬凑显式解，凑不出来就说凑不出来）。
 */
export function solveFirstOrderSeparable(
  rhs: Expr,
  x: string,
  y: string,
  x0: number,
  y0: number,
  steps: string[],
): OdeSeparable | null {
  const fv = (xx: number, yy: number): number | null => {
    try {
      const val = evalExpr(rhs, { [x]: xx, [y]: yy });
      return Number.isFinite(val) ? val : null;
    } catch {
      return null;
    }
  };
  const f11 = fv(1, 1);
  if (f11 === null || f11 === 0) return null;
  const xs = [1.7, 2.3, -1.4, 0.6];
  const ys = [1.3, 2.7, -2.1];
  for (const xx of xs) {
    for (const yy of ys) {
      const direct = fv(xx, yy);
      const gx = fv(xx, 1);
      const hy = fv(1, yy);
      if (direct === null || gx === null || hy === null) return null;
      const expect = (gx * hy) / f11;
      if (Math.abs(direct - expect) > 1e-7 * Math.max(1, Math.abs(direct), Math.abs(expect))) return null;
    }
  }
  const g = simplifyDeep(subst(rhs, y, num(1)));
  const h = simplifyDeep(mkDiv(subst(rhs, x, num(1)), num(f11)));
  const Hg = integrateIndefinite(g, x, []);
  const Hh = integrateIndefinite(mkDiv(num(1), h), y, []);
  if (!Hg.F || !Hh.F) return null;
  steps.push(`识别为可分离变量方程：右端 = g(${x})·h(${y})，其中 g(${x}) = ${printExpr(g)}，h(${y}) = ${printExpr(h)}`);
  steps.push(`分离变量：d${y}/h(${y}) = g(${x})d${x}，两边积分`);
  steps.push(`∫d${y}/h(${y}) = ${printExpr(simplifyDeep(Hh.F))}`);
  steps.push(`∫g(${x})d${x} = ${printExpr(simplifyDeep(Hg.F))}`);
  steps.push(`代入初值得到隐式解：H(${y}) − H(${fmt(y0)}) = G(${x}) − G(${fmt(x0)})（这一形式未必能解出显式 y）`);
  return { H: simplifyDeep(Hh.F), G: simplifyDeep(Hg.F), hText: printExpr(h), gText: printExpr(g), steps };
}

export type SecondOrderSolution = {
  kind: "real-distinct" | "repeated" | "complex";
  r1: number;
  r2: number;
  alpha: number;
  beta: number;
  c1: number;
  c2: number;
  expr: Expr;
  steps: string[];
  at: (x: number) => number;
};

/** 二阶常系数齐次线性方程 y″ + p·y′ + q·y = 0（特征根法 + 初值定常数） */
export function solveSecondOrderConstant(
  p: number,
  q: number,
  xName: string,
  x0: number,
  y0: number,
  dy0: number,
): SecondOrderSolution {
  const xv = sym(xName);
  const t = mkSub(xv, num(x0));
  const disc = p * p - 4 * q;
  const tol = 1e-12 * Math.max(1, p * p, Math.abs(4 * q));
  const steps: string[] = [];
  steps.push(`特征方程 r² + ${fmt(p)}r + ${fmt(q)} = 0，判别式 Δ = p² − 4q = ${fmt(disc)}`);
  if (disc > tol) {
    const s = Math.sqrt(disc);
    const r1 = (-p + s) / 2;
    const r2 = (-p - s) / 2;
    const c1 = (dy0 - r2 * y0) / (r1 - r2);
    const c2 = y0 - c1;
    steps.push(`Δ > 0：两个不同实根 r₁ = ${fmt(r1)}，r₂ = ${fmt(r2)}`);
    steps.push(`通解 y = C₁·e^(r₁(x−x₀)) + C₂·e^(r₂(x−x₀))`);
    steps.push(`代入 y(x₀) = ${fmt(y0)}、y′(x₀) = ${fmt(dy0)}，解得 C₁ = ${fmt(c1)}，C₂ = ${fmt(c2)}`);
    const expr = simplifyDeep(
      mkAdd(
        mkMul(num(c1), mkPow(sym("e"), mkMul(num(r1), t))),
        mkMul(num(c2), mkPow(sym("e"), mkMul(num(r2), t))),
      ),
    );
    const at = (x: number) => c1 * Math.exp(r1 * (x - x0)) + c2 * Math.exp(r2 * (x - x0));
    return { kind: "real-distinct", r1, r2, alpha: 0, beta: 0, c1, c2, expr, steps, at };
  }
  if (Math.abs(disc) <= tol) {
    const r = -p / 2;
    const c1 = y0;
    const c2 = dy0 - r * y0;
    steps.push(`Δ = 0：二重实根 r = ${fmt(r)}`);
    steps.push(`通解 y = (C₁ + C₂·(x−x₀))·e^(r(x−x₀))`);
    steps.push(`代入初值解得 C₁ = ${fmt(c1)}，C₂ = ${fmt(c2)}`);
    const expr = simplifyDeep(mkMul(mkAdd(num(c1), mkMul(num(c2), t)), mkPow(sym("e"), mkMul(num(r), t))));
    const at = (x: number) => (c1 + c2 * (x - x0)) * Math.exp(r * (x - x0));
    return { kind: "repeated", r1: r, r2: r, alpha: r, beta: 0, c1, c2, expr, steps, at };
  }
  const alpha = -p / 2;
  const beta = Math.sqrt(-disc) / 2;
  const c1 = y0;
  const c2 = (dy0 - alpha * y0) / beta;
  steps.push(`Δ < 0：一对共轭复根 r = ${fmt(alpha)} ± ${fmt(beta)}i`);
  steps.push(`通解 y = e^(α(x−x₀))·(C₁·cos(β(x−x₀)) + C₂·sin(β(x−x₀)))，α = ${fmt(alpha)}，β = ${fmt(beta)}`);
  steps.push(`代入初值解得 C₁ = ${fmt(c1)}，C₂ = ${fmt(c2)}`);
  const expr = simplifyDeep(
    mkMul(
      mkPow(sym("e"), mkMul(num(alpha), t)),
      mkAdd(mkMul(num(c1), mkFn("cos", mkMul(num(beta), t))), mkMul(num(c2), mkFn("sin", mkMul(num(beta), t)))),
    ),
  );
  const at = (x: number) =>
    Math.exp(alpha * (x - x0)) * (c1 * Math.cos(beta * (x - x0)) + c2 * Math.sin(beta * (x - x0)));
  return { kind: "complex", r1: alpha, r2: beta, alpha, beta, c1, c2, expr, steps, at };
}

/* ==========================================================================
 * 第 15 部分：界面 —— 通用工具（数字/表达式的输入解析、结果数据结构、漂亮排版）
 * ========================================================================== */

const ADV_MATH_TOOL_ID = "advanced-math";

const SUP_MAP: Record<string, string> = {
  "0": "⁰",
  "1": "¹",
  "2": "²",
  "3": "³",
  "4": "⁴",
  "5": "⁵",
  "6": "⁶",
  "7": "⁷",
  "8": "⁸",
  "9": "⁹",
  "-": "⁻",
  "+": "⁺",
};

/** 把引擎输出的 ASCII 式子排成数学写法（只用于展示；复制仍然给 ASCII） */
export function prettify(src: string): string {
  if (!src) return src;
  return src
    .replace(/\^(-?\d+)/g, (_m, d: string) =>
      Array.from(d)
        .map((c) => SUP_MAP[c] ?? c)
        .join(""),
    )
    .replace(/sqrt\(/g, "√(")
    .replace(/\*/g, "·");
}

/* ------------------------------ 展示精度（全局显示设置） ------------------------------ */

/**
 * 显示精度是纯展示设置，run 函数里到处都在调 fmt()，把它做成模块级变量比逐层传参干净得多。
 * 组件在每次点击计算前写入，计算本身只发生在点击之后，所以读到的一定是当前值。
 */
let displayDigits = 10;

function setDisplayDigits(n: number): void {
  displayDigits = Math.min(15, Math.max(3, Math.round(n)));
}

/** 数字格式化：整数直接给，小数按有效数字，极大/极小用科学计数 */
function fmt(x: number, digits = displayDigits): string {
  if (Number.isNaN(x)) return "无定义";
  if (x === Infinity) return "+∞";
  if (x === -Infinity) return "−∞";
  if (Object.is(x, -0)) return "0";
  if (Number.isInteger(x) && Math.abs(x) < 1e15) return String(x);
  const a = Math.abs(x);
  if (a !== 0 && (a < 1e-5 || a >= 1e7)) return x.toExponential(6);
  return String(Number(x.toPrecision(digits)));
}

/** 简单有理数（a/b）在展示时排成上下两行 */
function splitFraction(text: string): [string, string] | null {
  const m = /^(-?)([^\s/+\-]+)\/([^\s/+\-]+)$/.exec(text);
  if (!m) return null;
  return [`${m[1]}${m[2]}`, m[3]];
}

/** 角度（弧度 → 度），只在展示夹角时用 */
function fmtDeg(rad: number, digits = 10): string {
  return `${fmt((rad * 180) / Math.PI, digits)}°`;
}

const RESERVED_NAMES = new Set([
  "pi", "e", "inf", "sin", "cos", "tan", "cot", "sec", "csc", "asin", "acos", "atan", "acot",
  "sinh", "cosh", "tanh", "coth", "asinh", "acosh", "atanh", "ln", "lg", "log", "log2", "log10",
  "sqrt", "cbrt", "abs", "sign", "floor", "ceil", "round", "trunc", "exp", "erf", "gamma", "fact",
  "max", "min", "mod", "atan2", "root", "arcsin", "arccos", "arctan",
]);

function parseUser(src: string, what = "表达式"): Expr {
  const s = src.trim();
  if (!s) fail(`请先填写${what}`);
  return parseStrict(s, what);
}

function parseVar(src: string, what = "自变量"): string {
  const s = src.trim();
  if (!s) fail(`请先填写${what}的名字（例如 x）`);
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(s)) fail(`${what}只能是一个名字（例如 x、t），不能写成式子`);
  if (RESERVED_NAMES.has(s.toLowerCase())) fail(`「${s}」是内置函数或常数名，不能当作${what}`);
  return s;
}

function parseNum(src: string, what: string): number {
  const s = src.trim().replace(/[（）()\s]/g, "");
  if (!s) fail(`请先填写${what}`);
  if (s === "inf" || s === "+inf" || s === "∞" || s === "+∞") return Infinity;
  if (s === "-inf" || s === "-∞") return -Infinity;
  const direct = Number(s);
  if (Number.isFinite(direct)) return direct;
  // 允许写算式，例如 2*pi、pi/2、1e-3
  try {
    const val = evalExpr(parseStrict(s, what));
    if (Number.isFinite(val)) return val;
  } catch {
    /* 落到下面的报错 */
  }
  fail(`${what}「${src}」不是有效数字（可以填 -1、0.5、2*pi 这类算式）`);
}

function parseIntIn(src: string, what: string, lo: number, hi: number): number {
  const raw = src.trim();
  if (!raw) fail(`请先填写${what}`);
  const v = Number(raw);
  if (!Number.isInteger(v)) fail(`${what}必须是整数`);
  if (v < lo || v > hi) fail(`${what}请取 ${lo} ~ ${hi} 之间的整数`);
  return v;
}

/** 上/下限、展开点这类"可以是式子"的位置：返回表达式（pi、2*pi、e 都支持） */
function parseBound(src: string, what: string): Expr {
  return parseUser(src, what);
}

function parseNumberList(src: string, what: string): number[] {
  const parts = src.split(/[,，\s;；]+/).filter(Boolean);
  if (!parts.length) fail(`请先填写${what}`);
  return parts.map((p) => {
    const v = Number(p);
    if (!Number.isFinite(v)) fail(`${what}里的「${p}」不是有效数字`);
    return v;
  });
}

function parseMatrix(src: string, what: string, max = 8): Matrix {
  const rows = src
    .split(/[\n;；]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!rows.length) fail(`请先填写${what}`);
  const m = rows.map((r) => parseNumberList(r, what));
  const w = m[0].length;
  if (m.some((r) => r.length !== w)) fail(`${what}每一行的元素个数要一样（现在每行要求 ${w} 个）`);
  if (m.length > max || w > max) fail(`${what}最多支持 ${max}×${max}`);
  return m;
}

/* -------- 结果数据结构：界面按同一套结构渲染，缺什么就如实显示什么 -------- */

type ExtraRow = {
  label: string;
  value?: string;
  matrix?: string[][];
  mono?: boolean;
  icon?: "check" | "warn" | "trend";
};

type MathTable = { title: string; head: string[]; rows: string[][] };

type CalcResult = {
  status: "ok" | "unsupported" | "error";
  op?: string;
  headline?: string;
  headlineNote?: string;
  message?: string;
  extras: ExtraRow[];
  steps: string[];
  numeric: ExtraRow[];
  notes: string[];
  table?: MathTable;
  chart?: {
    title: string;
    lines: Array<{ label: string; kind: "primary" | "muted"; points: Array<{ x: number; y: number }> }>;
  };
  copy: string;
};

function emptyResult(): CalcResult {
  return { status: "error", message: "", extras: [], steps: [], numeric: [], notes: [], copy: "" };
}

/** 引擎抛出的 MathError 本来就是中文人话，直接展示；其他异常兜一句人话 */
function guard(fn: () => CalcResult): CalcResult {
  try {
    return fn();
  } catch (err) {
    const message =
      err instanceof MathError
        ? err.message
        : err instanceof Error && err.message
          ? `计算中断：${err.message}`
          : "计算中断：输入里可能有超出支持范围的内容，请检查一下格式";
    return { ...emptyResult(), message };
  }
}

function unsupported(message: string, rest: Partial<CalcResult> = {}): CalcResult {
  return { status: "unsupported", message, extras: [], steps: [], numeric: [], notes: [], copy: "", ...rest };
}

/* -------- 与符号算法相互独立的数值佐证 -------- */

const EVIDENCE_XS = [0.4, 1.1, -0.7, 2.3];

/** 用有限差分反复求导（独立于符号求导的一条链路），h 随阶数放大以压低舍入误差 */
function numericNthDerivative(f: Expr, v: string, n: number, x0: number): number {
  const base = (x: number): number => evalExpr(f, { [v]: x });
  const go = (order: number, x: number): number => {
    if (order === 0) return base(x);
    const h = order === 1 ? 1e-3 : 1e-2;
    return (go(order - 1, x + h) - go(order - 1, x - h)) / (2 * h);
  };
  return go(n, x0);
}

/** 一阶（或低阶）符号导数与数值差分的最大偏差 */
function derivativeDeviation(d: Expr, f: Expr, v: string, order: number): ExtraRow {
  if (order > 3) {
    return { label: "数值佐证", value: `阶数 ${order} 太高，有限差分的舍入误差会淹没结果，这里不给数值对拍`, icon: "warn" };
  }
  let worst = 0;
  let checked = 0;
  for (const x0 of EVIDENCE_XS) {
    try {
      const sym = evalExpr(d, { [v]: x0 });
      const num = order === 1 ? numericDerivative(f, v, x0) : numericNthDerivative(f, v, order, x0);
      if (!Number.isFinite(sym) || !Number.isFinite(num)) continue;
      checked += 1;
      worst = Math.max(worst, Math.abs(sym - num));
    } catch {
      /* 该点无定义，跳过 */
    }
  }
  if (checked === 0) {
    return { label: "数值佐证", value: "选的点上函数都算不出有限值，做不了数值对拍", icon: "warn" };
  }
  const tol = order === 1 ? 1e-7 : order === 2 ? 1e-4 : 1e-2;
  return {
    label: `符号结果 vs ${order === 1 ? "5 点差分" : "差分递推"}（${checked} 个点）`,
    value: worst <= tol ? `最大偏差 ${fmt(worst, 3)}（一致）` : `最大偏差 ${fmt(worst, 3)}（偏大，请留意）`,
    icon: worst <= tol ? "check" : "warn",
  };
}

/** 隐函数 F(x,y)=0 的数值斜率：先数值解出 y(x)，再中心差分（完全独立于符号推导） */
function implicitSlopeNumeric(
  F: Expr,
  xName: string,
  yName: string,
  x0: number,
  yGuess = 0,
): { y0: number; slope: number } | null {
  const val = (xx: number, yy: number): number => evalExpr(F, { [xName]: xx, [yName]: yy });
  const solveY = (xx: number, guess: number): number | null => {
    let yy = guess;
    for (let i = 0; i < 120; i += 1) {
      const f0 = val(xx, yy);
      if (!Number.isFinite(f0)) return null;
      const h = 1e-7;
      const d = (val(xx, yy + h) - val(xx, yy - h)) / (2 * h);
      if (!Number.isFinite(d) || Math.abs(d) < 1e-12) return null;
      const stepLen = f0 / d;
      yy -= stepLen;
      if (Math.abs(stepLen) < 1e-13) break;
    }
    return Math.abs(val(xx, yy)) < 1e-6 * Math.max(1, Math.abs(yy)) ? yy : null;
  };
  // 牛顿法对初值敏感（例如 x²+y²=1 在 y=0 处 ∂F/∂y = 0），所以换几个起点依次试
  const guesses = [yGuess, 0, 1, -1, 0.5, -0.5, 2, -2, 3, -3, 5, -5, 0.25, -0.25];
  let y0: number | null = null;
  for (const g of guesses) {
    const found = solveY(x0, g);
    if (found !== null) {
      y0 = found;
      break;
    }
  }
  if (y0 === null) return null;
  const h = 1e-5;
  const yp = solveY(x0 + h, y0);
  const ym = solveY(x0 - h, y0);
  if (yp === null || ym === null) return null;
  return { y0, slope: (yp - ym) / (2 * h) };
}

/* -------- AST 构造小工具（引擎里同名的构造函数没有导出，这里就地补几个） -------- */

const mkAdd = (a: Expr, b: Expr): Expr => ({ k: "add", a, b });
const mkMul = (a: Expr, b: Expr): Expr => ({ k: "mul", a, b });
const mkDiv = (a: Expr, b: Expr): Expr => ({ k: "div", a, b });
const mkPow = (a: Expr, b: Expr): Expr => ({ k: "pow", a, b });
const mkNeg = (a: Expr): Expr => ({ k: "mul", a: num(-1), b: a });
const mkSub = (a: Expr, b: Expr): Expr => mkAdd(a, mkNeg(b));
const mkFn = (n: string, a: Expr): Expr => ({ k: "fn", n, a });

function sumExprs(list: Expr[]): Expr {
  if (list.length === 0) return num(0);
  return list.reduce((acc, e) => mkAdd(acc, e));
}

/** 多个变量的混合差分（各变量上依次做中心差分；与符号偏导完全独立） */
function numericMixedPartial(f: Expr, vars: string[], orders: number[], point: Record<string, number>): number {
  const base = (env: Record<string, number>): number => evalExpr(f, env);
  const apply = (idx: number, env: Record<string, number>): number => {
    if (idx >= vars.length) return base(env);
    const name = vars[idx];
    const order = orders[idx];
    const h = 1e-2;
    const op = (k: number, e: Record<string, number>): number => {
      if (k === 0) return apply(idx + 1, e);
      return (
        (op(k - 1, { ...e, [name]: (e[name] ?? 0) + h }) - op(k - 1, { ...e, [name]: (e[name] ?? 0) - h })) / (2 * h)
      );
    };
    return op(order, env);
  };
  return apply(0, { ...point });
}

function parseLimitPoint(src: string): LimitPoint {
  const s = src.trim().toLowerCase().replace(/[（）()\s]/g, "").replace(/∞/g, "inf");
  if (!s) fail("请填写极限点，例如 0、1、-2，或者 inf（正无穷）、-inf（负无穷）");
  if (s === "inf" || s === "+inf" || s === "infinity" || s === "+infinity") return "inf";
  if (s === "-inf" || s === "-infinity") return "-inf";
  const v = Number(s);
  if (!Number.isFinite(v)) fail(`极限点「${src}」看不懂：请填数字（0、1、-2）或 inf / -inf`);
  return v;
}

/* -------------------------------- 输入字段 -------------------------------- */

type Fields = {
  mode: string;
  expr: string;
  v: string;
  vs: string;
  n: string;
  a: string;
  b: string;
  from: string;
  to: string;
  p: string;
  q: string;
  x0: string;
  y0: string;
  dy0: string;
  matA: string;
  matB: string;
  vecA: string;
  vecB: string;
  z: string;
};

const EMPTY_FIELDS: Fields = {
  mode: "",
  expr: "",
  v: "",
  vs: "",
  n: "",
  a: "",
  b: "",
  from: "",
  to: "",
  p: "",
  q: "",
  x0: "",
  y0: "",
  dy0: "",
  matA: "",
  matB: "",
  vecA: "",
  vecB: "",
  z: "",
};

/* ==========================================================================
 * 第 16 部分：各运算的求解函数（每个都返回统一的 CalcResult）
 * ========================================================================== */

/* ------------------------------ 求导 ------------------------------ */

export function runDerivative(f: Fields): CalcResult {
  return guard(() => {
    if (f.mode === "implicit") {
      const raw = f.expr.trim();
      if (!raw) fail("请先填写隐函数方程，例如 x^2+y^2-1 或 x^2+y^2=1");
      const eq = raw.indexOf("=");
      if (eq >= 0 && raw.indexOf("=", eq + 1) >= 0) fail("方程里只能有一个等号");
      const F =
        eq >= 0
          ? parseStrict(`${raw.slice(0, eq)}-(${raw.slice(eq + 1)})`, "隐函数方程")
          : parseStrict(raw, "隐函数方程");
      const x = parseVar(f.v, "自变量");
      const y = parseVar(f.vs, "因变量");
      const steps: string[] = [];
      steps.push(`把方程整理成 F(${x}, ${y}) = ${printExpr(simplifyDeep(F))} = 0`);
      const Fx = simplifyDeep(partial(F, x));
      const Fy = simplifyDeep(partial(F, y));
      steps.push(`对 ${x} 求偏导：F_${x} = ${printExpr(Fx)}`);
      steps.push(`对 ${y} 求偏导：F_${y} = ${printExpr(Fy)}`);
      if (sameExpr(Fy, num(0))) {
        return unsupported(
          `F 对 ${y} 的偏导恒等于 0（这个方程里其实没有 ${y}），隐函数求导公式 d${y}/d${x} = −F_${x}/F_${y} 在这里没法用。`,
          { steps },
        );
      }
      steps.push(`代入公式：d${y}/d${x} = −F_${x} / F_${y}`);
      const slope = simplifyDeep(mkDiv(mkNeg(Fx), Fy));
      const numeric: ExtraRow[] = [];
      const notes: string[] = [];
      const x0 = Number((f.a.trim() || "0.5").replace(/\s/g, ""));
      if (Number.isFinite(x0)) {
        const chk = implicitSlopeNumeric(F, x, y, x0);
        if (chk) {
          numeric.push({ label: `在 ${x} = ${fmt(x0)} 处数值解出的 ${y}`, value: fmt(chk.y0) });
          numeric.push({ label: "该点的数值斜率（隐式求导 + 中心差分）", value: fmt(chk.slope) });
          let sym: number | null = null;
          try {
            sym = evalExpr(slope, { [x]: x0, [y]: chk.y0 });
          } catch {
            sym = null;
          }
          numeric.push(
            sym === null
              ? { label: "符号斜率代值", value: "把数值点代进符号式子时算不出有限值", icon: "warn" }
              : {
                  label: "符号斜率与数值斜率的差",
                  value: fmt(Math.abs(sym - chk.slope), 4),
                  icon: Math.abs(sym - chk.slope) < 1e-4 ? "check" : "warn",
                },
          );
        } else {
          numeric.push({
            label: "数值佐证",
            value: `在 ${x} = ${fmt(x0)} 附近没能数值解出满足方程的 ${y}，这次跳过数值对拍`,
            icon: "warn",
          });
        }
      }
      notes.push(`斜率表达式在 F_${y} = 0 的点上不成立（那些点要单独讨论）。`);
      return {
        status: "ok",
        op: `d${y}/d${x}`,
        headline: printExpr(slope),
        headlineNote: `由 F(${x}, ${y}) = 0 确定的隐函数`,
        extras: [
          { label: `F_${x}`, value: printExpr(Fx), mono: true },
          { label: `F_${y}`, value: printExpr(Fy), mono: true },
        ],
        steps,
        numeric,
        notes,
        copy: `d${y}/d${x} = ${printExpr(slope)}   [F_${x} = ${printExpr(Fx)}, F_${y} = ${printExpr(Fy)}]`,
      };
    }

    const e = parseUser(f.expr);
    const steps: string[] = [];
    const notes: string[] = [];

    if (f.mode === "partial") {
      const names = f.vs.split(/[,，\s]+/).filter(Boolean);
      if (!names.length) fail("请填写求偏导的变量顺序，例如 x,x,y（从左到右依次求导）");
      const vars = names.map((s) => parseVar(s, "变量"));
      const counts = new Map<string, number>();
      for (const name of vars) counts.set(name, (counts.get(name) ?? 0) + 1);
      steps.push(`对 ${vars.join(" → ")} 依次求偏导（顺序影响记号，不影响结果）`);
      const d = simplifyDeep(mixedPartial(e, vars, steps));
      const opText = `∂^${vars.length}/(${vars.map((s) => `∂${s}`).join("")})`;
      const numeric: ExtraRow[] = [];
      const point: Record<string, number> = {};
      const pointText: string[] = [];
      vars.forEach((name, i) => {
        if (point[name] !== undefined) return;
        const val = [0.6, 1.3, 0.9, 1.7, 0.4, 2.1][i % 6];
        point[name] = val;
        pointText.push(`${name} = ${fmt(val)}`);
      });
      const orderList = vars.map((name) => counts.get(name) ?? 1);
      try {
        const sym = evalExpr(d, point);
        const num = numericMixedPartial(e, vars, orderList, point);
        if (Number.isFinite(sym) && Number.isFinite(num)) {
          const diff = Math.abs(sym - num);
          numeric.push({
            label: `在 ${pointText.join("、")} 处：符号结果 vs 多元差分`,
            value: `${fmt(sym)} vs ${fmt(num)}（差 ${fmt(diff, 4)}）`,
            icon: diff < 1e-3 ? "check" : "warn",
          });
        } else {
          numeric.push({ label: "数值佐证", value: "这些点上有无穷或不定的值，跳过对拍", icon: "warn" });
        }
      } catch {
        numeric.push({ label: "数值佐证", value: "差分求值失败（该点可能无定义），跳过对拍", icon: "warn" });
      }
      if (d.k === "num" && d.v === 0) notes.push("结果是 0：说明被求导的式子里其实不含这些变量。");
      return {
        status: "ok",
        op: opText,
        headline: printExpr(d),
        headlineNote: `对 ${vars.join("、")} 的 ${vars.length} 阶混合偏导`,
        extras: [],
        steps,
        numeric,
        notes,
        copy: `${opText} [${printExpr(e)}] = ${printExpr(d)}`,
      };
    }

    const v = parseVar(f.v);
    const order = f.mode === "nth" ? parseIntIn(f.n, "导数阶数", 1, 10) : 1;
    if (!hasVar(e, v)) notes.push(`式子里没有出现「${v}」，引擎把它当常数处理，所以结果是 0。`);
    const d = order === 1 ? derivative(e, v, steps) : nthDerivative(e, v, order, steps);
    const numeric: ExtraRow[] = [derivativeDeviation(d, e, v, order)];
    const extras: ExtraRow[] = [];
    if (order > 1) {
      extras.push({ label: "被求导的函数", value: printExpr(simplifyDeep(e)), mono: true });
      let cur = e;
      for (let i = 1; i < order; i += 1) {
        cur = derivative(cur, v);
        extras.push({ label: `${i} 阶导`, value: printExpr(simplifyDeep(cur)), mono: true });
      }
    }
    return {
      status: "ok",
      op: order === 1 ? `d/d${v}` : `d^${order}/d${v}^${order}`,
      headline: printExpr(d),
      headlineNote: order === 1 ? `对 ${v} 的一阶导数` : `对 ${v} 的 ${order} 阶导数`,
      extras,
      steps,
      numeric,
      notes,
      copy: `${order === 1 ? `d/d${v}` : `d^${order}/d${v}^${order}`} [${printExpr(e)}] = ${printExpr(d)}`,
    };
  });
}

/* ------------------------------ 极限 ------------------------------ */

export function runLimit(f: Fields): CalcResult {
  return guard(() => {
    const e = parseUser(f.expr);
    const v = parseVar(f.v);
    const point = parseLimitPoint(f.a);
    const pointText = point === "inf" ? "+∞" : point === "-inf" ? "−∞" : fmt(point);
    const otherVars = Array.from(freeVars(e)).filter((name) => name !== v);
    const notes: string[] = [];
    if (otherVars.length) {
      notes.push(
        `式子里还有别的字母 ${otherVars.join("、")}：符号推导会把它们当参数，但数值逼近必须给具体数字（引擎临时填了一组固定值），所以数值那几行只对这些固定值成立。`,
      );
    }
    const trace: Trace = [];
    const r = computeLimit(e, v, point, trace);
    const table: MathTable = {
      title: "数值逼近取样（h = 0.1·2⁻ᵏ，左右两侧各自取样）",
      head: ["k", "h", "x（左）", "f(x)（左）", "x（右）", "f(x)（右）"],
      rows: r.table.map((row, i) => [
        String(i),
        fmt(row.h, 3),
        fmt(row.xLeft, 6),
        fmt(row.fxLeft, 8),
        fmt(row.xRight, 6),
        fmt(row.fxRight, 8),
      ]),
    };
    const numeric: ExtraRow[] = [
      {
        label: "左侧数值逼近（Richardson 外推）",
        value: r.numericLeft === null ? "有效取样点不足，算不出来" : fmt(r.numericLeft),
        icon: r.numericLeft === null ? "warn" : undefined,
      },
      {
        label: "右侧数值逼近（Richardson 外推）",
        value: r.numericRight === null ? "有效取样点不足，算不出来" : fmt(r.numericRight),
        icon: r.numericRight === null ? "warn" : undefined,
      },
      { label: "符号方法", value: r.method || "（没有给出符号方法说明）", mono: true },
    ];

    if (f.mode === "left" || f.mode === "right") {
      const side: 1 | -1 = f.mode === "left" ? -1 : 1;
      const label = side === -1 ? "左极限" : "右极限";
      const sideText = side === -1 ? `${v} → ${pointText}⁻` : `${v} → ${pointText}⁺`;
      const s = numericLimitSide(e, v, point, side, {});
      if (s.value === null) {
        return unsupported(
          `${sideText} 的${label}：数值逼近取不到足够的有效点（函数在这个方向上可能完全没定义），所以算不了。`,
          { steps: trace, numeric, notes, table },
        );
      }
      // 发散判定：不能只看外推出来的那个数（Richardson 对发散序列会给出无意义的有限值），
      // 还要看取样值本身是不是随 h → 0 一路膨胀。
      const mags = s.samples.map((p) => Math.abs(p.fx)).filter((m) => Number.isFinite(m));
      const growing =
        mags.length >= 6 && mags[mags.length - 1] > 1e3 && mags[mags.length - 1] > 20 * mags[0];
      const lastSample = [...s.samples].reverse().find((p) => Number.isFinite(p.fx));
      const diverges = Math.abs(s.value) > 1e6 || growing;
      const sign = lastSample ? Math.sign(lastSample.fx) : Math.sign(s.value);
      const headline = diverges ? (sign >= 0 ? "+∞（数值发散）" : "−∞（数值发散）") : fmt(s.value);
      const extras: ExtraRow[] = [
        { label: "另一侧的数值逼近（对照用）", value: side === -1 ? fmt(r.numericRight ?? NaN) : fmt(r.numericLeft ?? NaN) },
      ];
      if (r.value !== null) {
        extras.push({ label: "双侧符号结果（如果两侧相等就是它）", value: printExpr(r.value), mono: true });
      }
      if (!s.settled) {
        notes.push("数值序列还没稳定下来（相邻取样点之间仍相差较大），这个数字只能当近似参考。");
      }
      if (diverges) {
        notes.push("函数在这一侧随取样点加密而不断变大，数值上是发散的（不收敛到有限值），所以这里写的 ±∞ 是「发散方向」而不是一个数。");
      }
      return {
        status: "ok",
        op: `lim ${v}→${pointText}${side === -1 ? "⁻" : "⁺"}`,
        headline,
        headlineNote: `${sideText} 的${label}（数值逼近${s.settled ? "，已趋于稳定" : "，尚未稳定"}）`,
        extras,
        steps: trace,
        numeric,
        notes,
        copy: `${label} ${v}→${pointText}${side === -1 ? "-" : "+"} [${printExpr(e)}] ≈ ${fmt(s.value)}`,
        table,
      };
    }

    if (r.value !== null && !r.uncertain) {
      return {
        status: "ok",
        op: `lim ${v}→${pointText}`,
        headline: printExpr(r.value),
        headlineNote: `符号推导与数值逼近一致（${r.method}）`,
        extras: [{ label: "采用的方法", value: r.method, mono: true }],
        steps: trace,
        numeric,
        notes,
        copy: `lim ${v}→${pointText} [${printExpr(e)}] = ${printExpr(r.value)}`,
        table,
      };
    }
    if (r.value !== null && r.uncertain) {
      return unsupported(
        `符号推导得到 ${printExpr(r.value)}，但数值逼近给出左侧 ${fmt(r.numericLeft ?? NaN)}、右侧 ${fmt(r.numericRight ?? NaN)}，两者对不上，所以这个结果**无法确定**，请以数值证据为准或换一种写法再算。`,
        { steps: trace, numeric, notes, table, extras: [{ label: "符号结果（未采信）", value: printExpr(r.value), mono: true, icon: "warn" }] },
      );
    }
    const both = r.numericLeft !== null && r.numericRight !== null;
    if (both && Math.abs((r.numericLeft as number) - (r.numericRight as number)) > 1e-4 * Math.max(1, Math.abs(r.numericLeft as number))) {
      return unsupported(
        `这个极限不存在：左右两侧的数值逼近分别收敛到 ${fmt(r.numericLeft as number)} 和 ${fmt(r.numericRight as number)}，不相等（只存在单侧极限，可以切到「左极限 / 右极限」看单侧值）。`,
        { steps: trace, numeric, notes, table },
      );
    }
    if (both) {
      // 左右两侧的数值逼近已经一致，只是引擎没能给出符号结果（例如 (x²+3x)/(2x²−1) 在无穷远处）。
      // 这时给出数值结果并明确标注「只有数值证据」，比笼统说一句「算不了」更有用，也没有夸大。
      const avg = ((r.numericLeft as number) + (r.numericRight as number)) / 2;
      return {
        status: "ok",
        op: `lim ${v}→${pointText}`,
        headline: fmt(avg),
        headlineNote: "只有数值证据：左右两侧的数值逼近一致且已稳定，但引擎没给出符号结果",
        extras: [{ label: "符号部分", value: r.method || "没有给出符号方法", icon: "warn" }],
        steps: trace,
        numeric,
        notes: [...notes, "这个数字来自数值逼近（Richardson 外推），没有符号推导背书。"],
        table,
        copy: `lim ${v}→${pointText} [${printExpr(e)}] ≈ ${fmt(avg)}  (numeric only)`,
      };
    }
    return unsupported(
      `没能给出符号结果，数值逼近也不够稳定（${r.method}），所以算不了。常见原因：函数在这一点附近剧烈振荡、出现 0/0 之外的复杂未定式，或者式子里还有没给值的参数。`,
      { steps: trace, numeric, notes, table },
    );
  });
}

/* ------------------------------ 积分 ------------------------------ */

/** 把原函数在端点处取值：有限端点用代入，无穷端点用求极限 */
function antiderivativeAt(F: Expr, v: string, bound: Expr): { expr: Expr | null; value: number | null; how: string } {
  let numBound: number;
  try {
    numBound = evalExpr(bound);
  } catch {
    return { expr: null, value: null, how: "端点算不出数值" };
  }
  if (Number.isFinite(numBound)) {
    const at = simplifyDeep(subst(F, v, bound));
    let val: number | null = null;
    try {
      const raw = evalExpr(at);
      if (Number.isFinite(raw)) val = raw;
    } catch {
      val = null;
    }
    return { expr: at, value: val, how: "端点代入" };
  }
  const point: LimitPoint = numBound > 0 ? "inf" : "-inf";
  const rr = computeLimit(F, v, point, []);
  if (rr.value === null || rr.uncertain) return { expr: null, value: null, how: `端点 ${point === "inf" ? "+∞" : "−∞"} 处原函数的极限没能确定` };
  let val: number | null = null;
  try {
    const raw = evalExpr(rr.value);
    if (Number.isFinite(raw)) val = raw;
  } catch {
    val = null;
  }
  return { expr: rr.value, value: val, how: `端点 ${point === "inf" ? "+∞" : "−∞"} 用极限求得` };
}

export /** 把 π、e 这两个常数折叠成数值节点（只为拿到一个干净的数值形式，不影响符号推导） */
function foldConstants(e: Expr): Expr {
  switch (e.k) {
    case "num":
      return e;
    case "sym":
      if (e.n === "pi") return num(Math.PI);
      if (e.n === "e") return num(Math.E);
      return e;
    case "fn":
      return { k: "fn", n: e.n, a: foldConstants(e.a), b: e.b ? foldConstants(e.b) : undefined };
    case "add":
      return { k: "add", a: foldConstants(e.a), b: foldConstants(e.b) };
    case "mul":
      return { k: "mul", a: foldConstants(e.a), b: foldConstants(e.b) };
    case "div":
      return { k: "div", a: foldConstants(e.a), b: foldConstants(e.b) };
    case "pow":
      return { k: "pow", a: foldConstants(e.a), b: foldConstants(e.b) };
    default:
      return e;
  }
}

/** 尝试把表达式算成一个有限数值 */
function tryNumeric(e: Expr): number | null {
  try {
    const v = evalExpr(e);
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

export function runIntegral(f: Fields): CalcResult {
  return guard(() => {
    const e = parseUser(f.expr);
    const steps: string[] = [];

    if (f.mode === "double") {
      const x = parseVar(f.v, "第一个变量");
      const y = parseVar(f.vs, "第二个变量");
      const xa = parseNum(f.a, `${x} 的下限`);
      const xb = parseNum(f.b, `${x} 的上限`);
      const ya = parseNum(f.from, `${y} 的下限`);
      const yb = parseNum(f.to, `${y} 的上限`);
      if (![xa, xb, ya, yb].every(Number.isFinite)) fail("二重积分目前只支持有限矩形区域");
      if (xb <= xa || yb <= ya) fail("每个方向的上限都要大于下限");
      const v1 = doubleIntegral(e, x, y, xa, xb, ya, yb, 28);
      const v2 = doubleIntegral(e, x, y, xa, xb, ya, yb, 48);
      const diff = Math.abs(v1 - v2);
      steps.push(`矩形区域：[${fmt(xa)}, ${fmt(xb)}] × [${fmt(ya)}, ${fmt(yb)}]`);
      steps.push("先用「迭代高斯–勒让德求积」把二重积分化成两次一重积分，再分别做数值求积");
      return {
        status: "ok",
        op: `∬ f d${x}d${y}`,
        headline: fmt(v1),
        headlineNote: "数值结果（迭代高斯–勒让德，28 点）",
        extras: [
          { label: "换 48 点再算一次", value: fmt(v2), mono: true },
          {
            label: "两次结果的差",
            value: fmt(diff, 4),
            icon: diff < 1e-8 ? "check" : diff < 1e-5 ? "trend" : "warn",
          },
        ],
        steps,
        numeric: [],
        notes: diff < 1e-8 ? [] : ["两种精度的结果有可见差异，这个数只能当近似值。"],
        copy: `∫∫ [${printExpr(e)}] d${x}d${y} over [${fmt(xa)},${fmt(xb)}]×[${fmt(ya)},${fmt(yb)}] ≈ ${fmt(v1)}`,
      };
    }

    const v = parseVar(f.v);

    if (f.mode === "indefinite") {
      const ind = integrateIndefinite(e, v, steps);
      const selfCheck: ExtraRow[] = [];
      if (!ind.F) {
        return unsupported(
          "这个不定积分没算出来：引擎没找到初等原函数，或者找到了但「求导回代」自检没通过，所以宁可不给答案。可以改用「定积分 / 数值积分」拿到具体区间上的数值。",
          { steps },
        );
      }
      const F = ind.F;
      let worst = 0;
      let checked = 0;
      for (const x0 of EVIDENCE_XS) {
        try {
          const lhs = numericDerivative(F, v, x0);
          const rhs = evalExpr(e, { [v]: x0 });
          if (Number.isFinite(lhs) && Number.isFinite(rhs)) {
            checked += 1;
            worst = Math.max(worst, Math.abs(lhs - rhs) / Math.max(1, Math.abs(rhs)));
          }
        } catch {
          /* 跳过无定义的点 */
        }
      }
      selfCheck.push(
        checked === 0
          ? { label: "自检", value: "选的点上都算不出有限值，没能做数值回代", icon: "warn" }
          : {
              label: `求导回代自检（${checked} 个点）`,
              value: `最大相对偏差 ${fmt(worst, 3)}`,
              icon: worst < 1e-6 ? "check" : "warn",
            },
      );
      return {
        status: "ok",
        op: `∫ f d${v}`,
        headline: `${printExpr(F)} + C`,
        headlineNote: "不定积分（已通过求导回代自检）",
        extras: selfCheck,
        steps,
        numeric: [],
        notes: ["不定积分的常数 C 由具体条件决定，这里没有条件可代，所以留着。"],
        copy: `∫ [${printExpr(e)}] d${v} = ${printExpr(F)} + C`,
      };
    }

    const aExpr = parseBound(f.a, "积分下限");
    const bExpr = parseBound(f.b, "积分上限");
    const aNum = evalExpr(aExpr);
    const bNum = evalExpr(bExpr);
    const fn = fnOf(e, v);
    const numRes = integrateNumeric(fn, aNum, bNum, "定积分");

    if (f.mode === "numeric") {
      const numeric: ExtraRow[] = [
        { label: "使用的方法", value: numRes.method },
        {
          label: "收敛性",
          value: numRes.converged ? "两种加密方式的结果一致，可认为已收敛" : "加密后结果仍在变化 → 没有把握，只能当参考",
          icon: numRes.converged ? "check" : "warn",
        },
      ];
      if (numRes.singularities.length) {
        numeric.push({ label: "区间内检测到的奇点", value: numRes.singularities.map((s) => fmt(s, 6)).join("、") });
      }
      // 高斯–勒让德不能处理端点奇性（它的节点不会落在端点上，结果会偏），
      // 所以只在两端都能算出有限值、区间内也没有奇点时才拿它做交叉核对，
      // 否则会显示一个"偏差很大"的假警报。
      const endsFinite = Number.isFinite(viaTry(() => fn(aNum))) && Number.isFinite(viaTry(() => fn(bNum)));
      if (Number.isFinite(aNum) && Number.isFinite(bNum) && bNum > aNum && endsFinite && numRes.singularities.length === 0) {
        const cross = gaussLegendre(fn, aNum, bNum, 40);
        numeric.push({
          label: "另一条独立链路（40 点高斯–勒让德）",
          value: fmt(cross),
          icon: Math.abs(cross - numRes.value) < 1e-6 * Math.max(1, Math.abs(numRes.value)) ? "check" : "warn",
        });
      }
      steps.push(numRes.method);
      if (!numRes.converged) {
        return unsupported(
          "数值积分没有收敛：把区间加密一倍后结果仍在变化，所以这个数不能当作答案。可以试试缩短区间、避开奇点，或改用符号积分。",
          { steps, numeric, extras: [{ label: "未收敛的数值结果（仅供参考）", value: fmt(numRes.value), icon: "warn" }] },
        );
      }
      return {
        status: "ok",
        op: `∫[${fmt(aNum)}→${fmt(bNum)}]`,
        headline: fmt(numRes.value),
        headlineNote: "数值积分结果",
        extras: [],
        steps,
        numeric,
        notes: [],
        copy: `∫ from ${printExpr(aExpr)} to ${printExpr(bExpr)} [${printExpr(e)}] d${v} ≈ ${fmt(numRes.value)}`,
      };
    }

    // 定积分：先试符号（牛顿–莱布尼茨），再拿数值积分当独立佐证
    const ind = integrateIndefinite(e, v, steps);
    const numeric: ExtraRow[] = [];
    let exactExpr: Expr | null = null;
    let exactVal: number | null = null;
    let exactHow = "";
    if (ind.F) {
      const hi = antiderivativeAt(ind.F, v, bExpr);
      const lo = antiderivativeAt(ind.F, v, aExpr);
      if (hi.expr && lo.expr) {
        const combined = simplifyDeep(mkSub(hi.expr, lo.expr));
        let val: number | null = null;
        try {
          const raw = evalExpr(combined);
          if (Number.isFinite(raw)) val = raw;
        } catch {
          val = null;
        }
        exactExpr = combined;
        exactVal = val;
        exactHow = `F(${printExpr(bExpr)}) − F(${printExpr(aExpr)})（${hi.how}、${lo.how}）`;
      } else if (!hi.expr) {
        steps.push(`上限那一端没能定出原函数的值：${hi.how}`);
      } else if (!lo.expr) {
        steps.push(`下限那一端没能定出原函数的值：${lo.how}`);
      }
    } else {
      steps.push("没有找到初等原函数（或自检未通过），所以不走牛顿–莱布尼茨公式");
    }
    numeric.push({
      label: "数值积分（独立于符号推导）",
      value: fmt(numRes.value),
      icon: numRes.converged ? "check" : "warn",
    });
    numeric.push({
      label: "收敛性",
      value: numRes.converged ? "已收敛" : "加密后仍在变化 → 只能当参考",
      icon: numRes.converged ? "check" : "warn",
    });

    if (exactExpr && exactVal !== null) {
      const diff = Math.abs(exactVal - numRes.value);
      numeric.push({
        label: "符号值与数值值的差",
        value: fmt(diff, 4),
        icon: diff < 1e-6 * Math.max(1, Math.abs(exactVal)) ? "check" : "warn",
      });
      // 符号形式里如果还留着 π、e（例如 "-cos(pi) + 1"），折叠成数值再化简，
      // 拿到的往往是干净的结果（2）；原来的符号形式仍然作为一行"符号形式"保留。
      const folded = simplifyDeep(foldConstants(exactExpr));
      const foldedNum = folded.k === "num" ? folded.v : tryNumeric(folded);
      const plainFolded = printExpr(folded);
      const pretty = folded.k === "num" ? plainFolded : printExpr(exactExpr);
      const useNumeric = folded.k === "num" && plainFolded !== printExpr(exactExpr);
      const extras: ExtraRow[] = useNumeric
        ? [{ label: "符号形式（未代值）", value: printExpr(exactExpr), mono: true }]
        : [];
      if (!useNumeric && foldedNum !== null && !sameExpr(folded, exactExpr)) {
        extras.push({ label: "折叠 π / e 之后约等于", value: fmt(foldedNum, 12), mono: true });
      }
      return {
        status: "ok",
        op: `∫[${printExpr(aExpr)}→${printExpr(bExpr)}]`,
        headline: pretty,
        headlineNote: `牛顿–莱布尼茨公式：${exactHow}`,
        extras,
        steps,
        numeric,
        notes: Number.isFinite(aNum) && Number.isFinite(bNum) ? [] : ["无穷区间上的反常积分是用端点极限算出来的。"],
        copy: `∫ from ${printExpr(aExpr)} to ${printExpr(bExpr)} [${printExpr(e)}] d${v} = ${printExpr(exactExpr)}  (≈ ${fmt(exactVal)})`,
      };
    }
    if (exactExpr && exactVal === null) {
      return {
        status: "ok",
        op: `∫[${printExpr(aExpr)}→${printExpr(bExpr)}]`,
        headline: printExpr(exactExpr),
        headlineNote: "符号形式（代不出有限数值，可能是含参数的表达式）",
        extras: [],
        steps,
        numeric,
        notes: ["符号结果是含参数的形式，没有具体数值可对拍。"],
        copy: `∫ from ${printExpr(aExpr)} to ${printExpr(bExpr)} [${printExpr(e)}] d${v} = ${printExpr(exactExpr)}`,
      };
    }
    if (!numRes.converged) {
      return unsupported(
        "符号方法没给出原函数，数值积分又没有收敛，所以这个积分算不了。可以试试缩小积分区间或检查被积函数在区间内是否有奇点。",
        { steps, numeric },
      );
    }
    return {
      status: "ok",
      op: `∫[${printExpr(aExpr)}→${printExpr(bExpr)}]`,
      headline: fmt(numRes.value),
      headlineNote: "没有初等原函数（或自检未通过），只给出数值结果",
      extras: [],
      steps,
      numeric,
      notes: ["符号部分没算出来，这个数是数值积分的结果；它已经用两种加密方式交叉核对过。"],
      copy: `∫ from ${printExpr(aExpr)} to ${printExpr(bExpr)} [${printExpr(e)}] d${v} ≈ ${fmt(numRes.value)}`,
    };
  });
}

/** 求值时吞掉异常，返回 NaN（只用于显示层的小判断） */
function viaTry(fn: () => number): number {
  try {
    return fn();
  } catch {
    return NaN;
  }
}

/* ------------------------------ 泰勒与级数 ------------------------------ */

export function runSeries(f: Fields): CalcResult {
  return guard(() => {
    if (f.mode === "taylor") {
      const e = parseUser(f.expr);
      const v = parseVar(f.v);
      const aE = parseBound(f.a, "展开点");
      const n = parseIntIn(f.n, "展开阶数", 0, 12);
      const steps: string[] = [];
      const terms = taylorSeries(e, v, aE, n, steps);
      if (!terms.length) {
        return unsupported(`在 ${v} = ${printExpr(aE)} 处展开的各阶导数全是 0（或者算不出来），所以没有项可以展示。`, { steps });
      }
      const poly = sumExprs(terms.map((t) => t.term));
      let aNum: number | null = null;
      try {
        const raw = evalExpr(aE);
        if (Number.isFinite(raw)) aNum = raw;
      } catch {
        aNum = null;
      }
      const numeric: ExtraRow[] = [];
      if (aNum !== null) {
        let worst = 0;
        let worstAt = 0;
        let checked = 0;
        for (const dlt of [0.05, 0.1, 0.3, 0.6]) {
          try {
            const x = aNum + dlt;
            const p = evalExpr(poly, { [v]: x });
            const fv = evalExpr(e, { [v]: x });
            if (Number.isFinite(p) && Number.isFinite(fv)) {
              checked += 1;
              const dd = Math.abs(p - fv);
              if (dd > worst) {
                worst = dd;
                worstAt = dlt;
              }
            }
          } catch {
            /* 该点无定义 */
          }
        }
        if (checked) {
          numeric.push({
            label: "把多项式与原函数在展开点右侧 0.05/0.1/0.3/0.6 处对比",
            value: `最大偏差 ${fmt(worst, 4)}（出现在偏移 ${fmt(worstAt, 2)} 处）`,
            icon: worst < 1e-3 ? "check" : "trend",
          });
        } else {
          numeric.push({ label: "数值佐证", value: "展开点附近取不到有限值，跳过对拍", icon: "warn" });
        }
      }
      const table: MathTable = {
        title: "各阶系数 f⁽ᵏ⁾(a)/k!",
        head: ["k", "系数", "对应的项"],
        rows: terms.map((t) => [String(t.order), printExpr(t.coeff), printExpr(t.term)]),
      };
      steps.push(`把这一串项相加就得到 ${n} 阶泰勒多项式（余项不在这里给）`);
      return {
        status: "ok",
        op: `T${n}(${v})`,
        headline: printExpr(poly),
        headlineNote: `在 ${v} = ${printExpr(aE)} 处的 ${n} 阶泰勒多项式`,
        extras: [],
        steps,
        numeric,
        notes: terms.length - 1 < n ? [`从 ${terms.length - 1} 阶开始后面各项系数都是 0，所以式子到这里就结束了。`] : [],
        copy: `T${n}(${v}) = ${printExpr(poly)}   (expand at ${printExpr(aE)})`,
        table,
      };
    }

    if (f.mode === "sum") {
      const term = parseUser(f.expr, "通项");
      const k = parseVar(f.v, "求和指标");
      const from = parseIntIn(f.from, "起始项", -1000, 20000);
      const toRaw = f.to.trim().toLowerCase().replace(/∞/g, "inf");
      const infinite = toRaw === "inf" || toRaw === "+inf";
      const to = infinite ? "inf" : parseIntIn(f.to, "结束项", -1000, 20000);
      if (to !== "inf" && to < from) fail("结束项不能小于起始项");
      const steps: string[] = [];
      const r = seriesSum(term, k, from, to, steps);
      const numeric: ExtraRow[] = [];
      const conv = to === "inf" ? seriesConvergence(term, k, from, steps) : null;
      if (conv) {
        numeric.push({
          label: "收敛性判别",
          value: `${conv.verdict} —— ${conv.detail}`,
          icon: conv.verdict.startsWith("收敛") ? "check" : conv.verdict === "发散" ? "warn" : "trend",
        });
      }
      const numericText = r.numeric !== undefined ? fmt(r.numeric) : "（没有数值形式）";
      numeric.push({ label: "数值（部分和 / 公式值）", value: numericText });
      if (!r.converged) {
        // 「收敛但部分和还没稳定」和「发散」要说清楚，不能笼统一句"没收敛"
        const why = conv && conv.verdict.startsWith("收敛")
          ? `这个级数本身是收敛的（${conv.detail}），但用有限项部分和算出来的值还没稳定到能给一个确定的数（收敛较慢），所以这里不报数值。`
          : conv && conv.verdict === "发散"
            ? `这个级数发散（${conv.detail}），不存在"和"，所以没有可给的数值；下面是部分和，只能当参考。`
            : `这个级数没有收敛到稳定值（${r.method}），所以不存在一个确定的"和"；下面是部分和，只能当参考。`;
        return unsupported(why, {
          steps,
          numeric,
          extras: [{ label: "部分和（不可当作答案）", value: numericText, icon: "warn" }],
        });
      }
      return {
        status: "ok",
        op: `Σ ${k}=${from}${to === "inf" ? "…∞" : `…${to}`}`,
        headline: r.numeric !== undefined && to === "inf" ? numericText : printExpr(r.value),
        headlineNote: r.method,
        extras: [],
        steps,
        numeric,
        notes:
          to === "inf" && r.method.includes("部分和")
            ? ["这里的值来自数值部分和（前若干项相加并判断是否稳定），不是闭式公式。"]
            : [],
        copy: `Σ from ${k}=${from} to ${to === "inf" ? "inf" : to} (${printExpr(term)}) = ${printExpr(r.value)}  (≈ ${numericText})`,
      };
    }

    if (f.mode === "conv") {
      const term = parseUser(f.expr, "通项");
      const k = parseVar(f.v, "求和指标");
      const from = parseIntIn(f.from, "起始项", -1000, 20000);
      const steps: string[] = [];
      const conv = seriesConvergence(term, k, from, steps);
      if (conv.verdict === "无法判断") {
        return unsupported(`${conv.detail}`, { steps });
      }
      return {
        status: "ok",
        op: `Σ a_${k}`,
        headline: conv.verdict,
        headlineNote: conv.detail,
        extras: [],
        steps,
        numeric: [],
        notes: conv.verdict.includes("未判定") ? ["判据失效，只能给出倾向性结论，不能当作严格证明。"] : [],
        copy: `Σ a_${k} (from ${k}=${from}, a=${printExpr(term)}): ${conv.verdict} —— ${conv.detail}`,
      };
    }

    // 傅里叶系数
    const e = parseUser(f.expr);
    const v = parseVar(f.v);
    const nMax = parseIntIn(f.n, "项数", 1, 12);
    const L = parseNum(f.a, "半周期 L");
    if (!(L > 0)) fail("半周期 L 必须是正数");
    const steps: string[] = [];
    const c = fourierCoeffs(e, v, L, nMax);
    steps.push(`把 f 看成周期 2L = ${fmt(2 * L)} 的函数，用数值积分（高斯–勒让德）算系数`);
    steps.push("a₀ = (1/L)∫₋ᴸᴸ f dx；aₙ = (1/L)∫₋ᴸᴸ f·cos(nπx/L) dx；bₙ = (1/L)∫₋ᴸᴸ f·sin(nπx/L) dx");
    steps.push(`级数形式：f(x) ≈ a₀/2 + Σ [aₙ·cos(nπx/L) + bₙ·sin(nπx/L)]，n = 1…${nMax}`);
    const table: MathTable = {
      title: "傅里叶系数（数值积分得到）",
      head: ["n", "aₙ", "bₙ"],
      rows: Array.from({ length: nMax + 1 }, (_, n) => [String(n), fmt(c.an[n] ?? 0, 8), fmt(c.bn[n] ?? 0, 8)]),
    };
    let worst = 0;
    let checked = 0;
    for (const x of [-L * 0.7, -L * 0.3, L * 0.25, L * 0.8]) {
      let approx = c.a0 / 2;
      for (let n = 1; n <= nMax; n += 1) {
        const w = (n * Math.PI) / L;
        approx += (c.an[n] ?? 0) * Math.cos(w * x) + (c.bn[n] ?? 0) * Math.sin(w * x);
      }
      try {
        const fv = evalExpr(e, { [v]: x });
        if (Number.isFinite(fv) && Number.isFinite(approx)) {
          checked += 1;
          worst = Math.max(worst, Math.abs(approx - fv));
        }
      } catch {
        /* 跳过 */
      }
    }
    const numeric: ExtraRow[] = [
      {
        label: `用截断级数重建 f（${checked} 个点）`,
        value: checked ? `最大偏差 ${fmt(worst, 4)}（项数越多越小）` : "取不到有限值，没能重建",
        icon: checked && worst < 0.5 ? "check" : "trend",
      },
    ];
    return {
      status: "ok",
      op: `Fourier(n ≤ ${nMax})`,
      headline: `a₀ = ${fmt(c.a0, 8)}`,
      headlineNote: `半周期 L = ${fmt(L)}，展开到 ${nMax} 次谐波`,
      extras: [],
      steps,
      numeric,
      notes: ["傅里叶系数是数值积分出来的，不是闭式公式，所以有小的数值误差。"],
      copy: `Fourier of ${printExpr(e)} on [-${fmt(L)}, ${fmt(L)}]: a0=${fmt(c.a0, 8)}, an=[${c.an
        .slice(1)
        .map((x) => fmt(x, 6))
        .join(", ")}], bn=[${c.bn
        .slice(1)
        .map((x) => fmt(x, 6))
        .join(", ")}]`,
      table,
    };
  });
}

/* ------------------------------ 微分方程 ------------------------------ */

function sampleRows(points: Array<{ x: number; y: number }>, count = 9): number[] {
  const idxs: number[] = [];
  for (let i = 0; i < count; i += 1) {
    idxs.push(Math.round((i * (points.length - 1)) / (count - 1)));
  }
  return Array.from(new Set(idxs));
}

export function runOde(f: Fields): CalcResult {
  return guard(() => {
    if (f.mode === "second") {
      const p = parseNum(f.p, "y′ 的系数 p");
      const q = parseNum(f.q, "y 的系数 q");
      const x = parseVar(f.v, "自变量");
      const x0 = parseNum(f.x0, "初值点 x₀");
      const y0 = parseNum(f.y0, "初值 y(x₀)");
      const dy0 = parseNum(f.dy0, "初值 y′(x₀)");
      const xEnd = parseNum(f.b, "求解终点");
      if (xEnd === x0) fail("求解终点不能等于初值点");
      const sol = solveSecondOrderConstant(p, q, x, x0, y0, dy0);
      const rk = rk4SecondOrder(p, q, x0, y0, dy0, xEnd, 800);
      const rk2 = rk4SecondOrder(p, q, x0, y0, dy0, xEnd, 3200);
      const errEst = Math.abs(rk[rk.length - 1].y - rk2[rk2.length - 1].y);
      let worst = 0;
      for (const pt of rk) worst = Math.max(worst, Math.abs(sol.at(pt.x) - pt.y));
      const rows = sampleRows(rk.map((pt) => ({ x: pt.x, y: pt.y })));
      const table: MathTable = {
        title: "数值解（四阶 Runge–Kutta，800 步）与符号解的对比",
        head: ["x", "RK4 数值解 y", "符号解 y", "|差|"],
        rows: rows.map((i) => {
          const pt = rk[i];
          const symVal = sol.at(pt.x);
          return [fmt(pt.x, 6), fmt(pt.y, 8), fmt(symVal, 8), fmt(Math.abs(symVal - pt.y), 4)];
        }),
      };
      const kindText =
        sol.kind === "real-distinct" ? "两个不同实根" : sol.kind === "repeated" ? "二重实根" : "一对共轭复根";
      // 方程写法：系数为 0 的项不写出来（y″ + 0y′ + 1y = 0 → y″ + y = 0）
      const eqTerms: string[] = ["y″"];
      if (p !== 0) eqTerms.push(`${p === 1 ? "" : p === -1 ? "−" : fmt(p)}y′`);
      if (q !== 0) eqTerms.push(`${q === 1 ? "" : q === -1 ? "−" : fmt(q)}y`);
      const eqText = `${eqTerms.join(" + ").replace(/\+ −/g, "− ")} = 0`;
      return {
        status: "ok",
        op: eqText,
        headline: printExpr(sol.expr),
        headlineNote: `符号解（特征根法：${kindText}）：y(${fmt(x0)}) = ${fmt(y0)}，y′(${fmt(x0)}) = ${fmt(dy0)}`,
        extras: [
          { label: "特征根", value: sol.kind === "complex" ? `${fmt(sol.alpha)} ± ${fmt(sol.beta)}i` : `${fmt(sol.r1)}、${fmt(sol.r2)}` },
          { label: "常数", value: `C₁ = ${fmt(sol.c1)}，C₂ = ${fmt(sol.c2)}` },
          {
            label: `数值解在 ${x} = ${fmt(xEnd)} 的值`,
            value: fmt(rk[rk.length - 1].y),
          },
        ],
        steps: sol.steps,
        numeric: [
          {
            label: "符号解 与 RK4 数值解的最大偏差（全程取样）",
            value: fmt(worst, 4),
            icon: worst < 1e-4 ? "check" : "warn",
          },
          { label: "把步数加密 4 倍后数值解的变化（误差估计）", value: fmt(errEst, 4), icon: errEst < 1e-4 ? "check" : "trend" },
        ],
        notes: [],
        copy: `y'' + ${fmt(p)}y' + ${fmt(q)}y = 0, y(${fmt(x0)})=${fmt(y0)}, y'(${fmt(x0)})=${fmt(dy0)}  =>  y = ${printExpr(
          sol.expr,
        )}`,
        table,
        chart: {
          title: "符号解（实线）与 RK4 数值解（虚线）",
          lines: [
            { label: "符号解", kind: "primary", points: rk.map((pt) => ({ x: pt.x, y: sol.at(pt.x) })) },
            { label: "RK4 数值解", kind: "muted", points: rk.map((pt) => ({ x: pt.x, y: pt.y })) },
          ],
        },
      };
    }

    const rhs = parseUser(f.expr, "方程右端 f(x, y)");
    const x = parseVar(f.v, "自变量");
    const y = parseVar(f.vs, "未知函数名");
    const x0 = parseNum(f.x0, "初值点 x₀");
    const y0 = parseNum(f.y0, "初值 y(x₀)");
    const xEnd = parseNum(f.b, "求解终点");
    if (xEnd === x0) fail("求解终点不能等于初值点");
    const extra = Array.from(freeVars(rhs)).filter((name) => name !== x && name !== y);
    if (extra.length) fail(`方程右端还有别的字母「${extra.join("、")}」，请先换成具体数字（一阶方程求解目前只认识 ${x} 和 ${y}）`);
    const steps: string[] = [];
    steps.push(`一阶方程 ${y}′ = ${printExpr(simplifyDeep(rhs))}，初值 ${y}(${fmt(x0)}) = ${fmt(y0)}，求解到 ${x} = ${fmt(xEnd)}`);
    const rk = rk4Solve(rhs, x, y, x0, y0, xEnd, 400);
    const rk2 = rk4Solve(rhs, x, y, x0, y0, xEnd, 1600);
    const errEst = Math.abs(rk[rk.length - 1].y - rk2[rk2.length - 1].y);
    steps.push("数值解用经典四阶 Runge–Kutta 逐点推进（400 步），另用 1600 步再算一遍做误差估计");
    const symSteps: string[] = [];
    const lin = solveFirstOrderLinear(rhs, x, y, x0, y0, symSteps);
    const sep = lin ? null : solveFirstOrderSeparable(rhs, x, y, x0, y0, symSteps);
    const numeric: ExtraRow[] = [
      { label: `数值解在 ${x} = ${fmt(xEnd)} 处的值（400 步）`, value: fmt(rk[rk.length - 1].y) },
      { label: "把步数加密 4 倍后的变化（误差估计）", value: fmt(errEst, 4), icon: errEst < 1e-5 ? "check" : errEst < 1e-2 ? "trend" : "warn" },
    ];
    const rows = sampleRows(rk);
    const tableRows = rows.map((i) => {
      const pt = rk[i];
      const symVal = lin ? safeEval(lin.expr, x, pt.x) : null;
      return [fmt(pt.x, 6), fmt(pt.y, 8), symVal === null ? "—" : fmt(symVal, 8), symVal === null ? "—" : fmt(Math.abs(symVal - pt.y), 4)];
    });
    const table: MathTable = {
      title: "数值解（四阶 Runge–Kutta，400 步）",
      head: ["x", "RK4 y", "符号解 y", "|差|"],
      rows: tableRows,
    };
    const chartLines: NonNullable<CalcResult["chart"]>["lines"] = [
      { label: "RK4 数值解", kind: "primary", points: rk.map((pt) => ({ x: pt.x, y: pt.y })) },
    ];
    if (lin) chartLines.push({ label: "符号解", kind: "muted", points: rk.map((pt) => ({ x: pt.x, y: safeEval(lin.expr, x, pt.x) ?? NaN })) });

    if (lin) {
      let worst = 0;
      for (const pt of rk) {
        const sv = safeEval(lin.expr, x, pt.x);
        if (sv !== null) worst = Math.max(worst, Math.abs(sv - pt.y));
      }
      numeric.push({
        label: "符号解 与 RK4 数值解的最大偏差",
        value: fmt(worst, 4),
        icon: worst < 1e-4 ? "check" : "warn",
      });
      return {
        status: "ok",
        op: `${y}′ = f(${x}, ${y})`,
        headline: printExpr(lin.expr),
        headlineNote: `符号解（${lin.note}），已代入初值 ${y}(${fmt(x0)}) = ${fmt(y0)}`,
        extras: [
          { label: `数值解在 ${x} = ${fmt(xEnd)} 处的值`, value: fmt(rk[rk.length - 1].y) },
          { label: "同一个数值解，多留几位", value: fmt(rk[rk.length - 1].y, 12) },
        ],
        steps: [...symSteps, ...steps],
        numeric,
        notes: [],
        copy: `${y}' = ${printExpr(rhs)}, ${y}(${fmt(x0)}) = ${fmt(y0)}  =>  ${y} = ${printExpr(lin.expr)}`,
        table,
        chart: { title: "解曲线", lines: chartLines },
      };
    }

    if (sep) {
      const h0 = safeEval(sep.H, y, y0);
      const g0 = safeEval(sep.G, x, x0);
      let worst = 0;
      let used = 0;
      if (h0 !== null && g0 !== null) {
        for (const pt of rk) {
          const hv = safeEval(sep.H, y, pt.y);
          const gv = safeEval(sep.G, x, pt.x);
          if (hv === null || gv === null) continue;
          used += 1;
          worst = Math.max(worst, Math.abs(hv - h0 - (gv - g0)));
        }
      }
      return {
        status: "ok",
        op: `${y}′ = g(${x})·h(${y})`,
        headline: `H(${y}) − H(${fmt(y0)}) = G(${x}) − G(${fmt(x0)})`,
        headlineNote: `隐式解（可分离变量法）：H(${y}) = ${printExpr(sep.H)}，G(${x}) = ${printExpr(sep.G)}`,
        extras: [
          { label: "数值解在求解终点的值", value: fmt(rk[rk.length - 1].y) },
          {
            label: "把数值解代进隐式解的残差",
            value: used ? `最大残差 ${fmt(worst, 4)}（${used} 个点）` : "代不进去（表达式中途无定义）",
            icon: used && worst < 1e-5 ? "check" : "warn",
          },
        ],
        steps: [...symSteps, ...steps],
        numeric,
        notes: [
          "这个形式的方程解出来的是隐式关系，不一定能把 y 单独解出来；要看具体的 y 值请用下面的数值解。",
        ],
        copy: `H(y) - H(${fmt(y0)}) = G(x) - G(${fmt(x0)}),  H(y) = ${printExpr(sep.H)}, G(x) = ${printExpr(
          sep.G,
        )},  numeric y(${fmt(xEnd)}) ≈ ${fmt(rk[rk.length - 1].y)}`,
        table,
        chart: { title: "解曲线（数值解）", lines: chartLines },
      };
    }

    return {
      status: "ok",
      op: `${y}′ = f(${x}, ${y})`,
      headline: fmt(rk[rk.length - 1].y),
      headlineNote: `数值解在 ${x} = ${fmt(xEnd)} 处的值（四阶 Runge–Kutta，400 步）`,
      extras: [
        { label: "符号解", value: "这个形式没覆盖：右端既不是关于未知函数的一次式，也不能分离变量，所以只给数值解", icon: "warn" },
      ],
      steps,
      numeric,
      notes: ["符号解只覆盖「一阶线性」和「可分离变量」两类形式；这里是数值解，误差估计见上。"],
      copy: `${y}' = ${printExpr(rhs)}, ${y}(${fmt(x0)}) = ${fmt(y0)}, numeric (RK4) ${y}(${fmt(xEnd)}) ≈ ${fmt(
        rk[rk.length - 1].y,
      )}`,
      table,
      chart: { title: "解曲线（数值解）", lines: chartLines },
    };
  });
}

function safeEval(e: Expr, name: string, at: number): number | null {
  try {
    const v = evalExpr(e, { [name]: at });
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/* ------------------------------ 矩阵与线性方程组 ------------------------------ */

function mulCx(a: Cx, b: Cx): Cx {
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}

function addCx(a: Cx, b: Cx): Cx {
  return { re: a.re + b.re, im: a.im + b.im };
}

function sumCx(list: Cx[]): Cx {
  return list.reduce((acc, z) => addCx(acc, z), { re: 0, im: 0 });
}

function prodCx(list: Cx[]): Cx {
  return list.reduce((acc, z) => mulCx(acc, z), { re: 1, im: 0 });
}

function polyEvalCx(coeffs: number[], z: Cx): Cx {
  let acc: Cx = { re: 0, im: 0 };
  for (const c of coeffs) acc = addCx(mulCx(acc, z), { re: c, im: 0 });
  return acc;
}

export function runMatrix(f: Fields): CalcResult {
  return guard(() => {
    if (f.mode === "mul") {
      const A = parseMatrix(f.matA, "矩阵 A");
      const B = parseMatrix(f.matB, "矩阵 B");
      if (A[0].length !== B.length) fail(`A 的列数（${A[0].length}）必须等于 B 的行数（${B.length}）才能相乘`);
      const C = matMul(A, B);
      return {
        status: "ok",
        op: "A · B",
        headline: "",
        headlineNote: `结果是 ${C.length}×${C[0].length} 矩阵`,
        extras: [{ label: "A · B", matrix: C.map((r) => r.map((v) => fmt(v, 8))) }],
        steps: ["按「行 × 列」逐项求和：C(ij) = Σ A(ik)·B(kj)"],
        numeric: [],
        notes: [],
        copy: `A*B = [[${C.map((r) => r.map((v) => fmt(v, 8)).join(", ")).join("], [")}]]`,
      };
    }

    const A = parseMatrix(f.matA, "矩阵 A");
    const isSquare = A.length === A[0].length;

    if (f.mode === "solve") {
      const b = parseNumberList(f.vecB, "右端向量 b");
      if (b.length !== A.length) fail(`b 的元素个数（${b.length}）要等于 A 的行数（${A.length}）`);
      const res = solveLinear(A, b);
      const steps: string[] = ["用高斯消元（列主元）把增广矩阵化成阶梯形，再回代求出唯一解"];
      const extras: ExtraRow[] = [];
      if (isSquare) {
        steps.push(`先看行列式：det(A) = ${fmt(matDet(A))}（为 0 就没有唯一解）`);
        extras.push({ label: "det(A)", value: fmt(matDet(A)) });
      }
      if (!res.x) {
        return unsupported(`这个方程组没有唯一解：${res.note}。`, { steps, extras });
      }
      const x = res.x;
      const resid = A.map((row, i) => Math.abs(row.reduce((acc, v, j) => acc + v * x[j], 0) - b[i]));
      const maxResid = Math.max(...resid);
      extras.push({ label: "解向量 x", matrix: x.map((v) => [fmt(v, 10)]) });
      extras.push({ label: "状态", value: res.note, icon: "check" });
      return {
        status: "ok",
        op: "A x = b",
        headline: `x = (${x.map((v) => fmt(v, 8)).join(", ")})`,
        headlineNote: `高斯消元得到${res.note}`,
        extras,
        steps,
        numeric: [
          {
            label: "把解代回：max |A·x − b|",
            value: fmt(maxResid, 4),
            icon: maxResid < 1e-8 ? "check" : "warn",
          },
        ],
        notes: [],
        copy: `x = (${x.map((v) => fmt(v, 10)).join(", ")})   [max |Ax-b| = ${fmt(maxResid, 4)}]`,
      };
    }

    if (!isSquare) fail("行列式、逆矩阵、特征值都只对方阵有意义，请检查 A 是不是方阵");
    const n = A.length;
    const det = matDet(A);
    const rank = matRank(A);
    const inv = matInverse(A);
    const eig = matEigenvalues(A);
    const extras: ExtraRow[] = [
      { label: "阶数", value: `${n} × ${n}` },
      { label: "行列式 det(A)", value: fmt(det) },
      { label: "秩 rank(A)", value: String(rank) },
    ];
    if (inv) {
      extras.push({ label: "逆矩阵 A⁻¹", matrix: inv.map((r) => r.map((v) => fmt(v, 8))) });
    } else {
      extras.push({ label: "逆矩阵", value: "不存在：行列式为 0，矩阵奇异（不可逆）", icon: "warn" });
    }
    extras.push({ label: "特征值（含复数）", value: eig.map((z) => fmtCx(z, 8)).join("，") });
    const trace = A.reduce((s, row, i) => s + row[i], 0);
    const sumEig = sumCx(eig);
    const prodEig = prodCx(eig);
    const numeric: ExtraRow[] = [
      {
        label: "Σ特征值 与 迹 tr(A)",
        value: `${fmtCx(sumEig, 8)} vs ${fmt(trace, 8)}（差 ${fmt(Math.abs(sumEig.re - trace) + Math.abs(sumEig.im), 4)}）`,
        icon: Math.abs(sumEig.re - trace) + Math.abs(sumEig.im) < 1e-6 ? "check" : "warn",
      },
      {
        label: "Π特征值 与 det(A)",
        value: `${fmtCx(prodEig, 8)} vs ${fmt(det, 8)}（差 ${fmt(Math.abs(prodEig.re - det) + Math.abs(prodEig.im), 4)}）`,
        icon: Math.abs(prodEig.re - det) + Math.abs(prodEig.im) < 1e-6 ? "check" : "warn",
      },
    ];
    if (inv) {
      const prod = matMul(A, inv);
      let worst = 0;
      for (let i = 0; i < n; i += 1) {
        for (let j = 0; j < n; j += 1) worst = Math.max(worst, Math.abs(prod[i][j] - (i === j ? 1 : 0)));
      }
      numeric.push({
        label: "A·A⁻¹ 与单位矩阵的最大偏差",
        value: fmt(worst, 4),
        icon: worst < 1e-8 ? "check" : "warn",
      });
    }
    numeric.push({
      label: "QR 迭代给出的实特征值（独立核对）",
      value: qrEigenvaluesReal(A).map((v) => fmt(v, 6)).join("、"),
    });
    const steps: string[] = [
      "行列式与秩：高斯消元（列主元）化阶梯形，对角线乘积即行列式，非零行数即秩",
      "逆矩阵：对 [A | I] 做高斯–若尔当消元，右半边就是 A⁻¹（主元小于 1e-12 时判为奇异）",
      "特征值：先用 Faddeev–LeVerrier 递推求出特征多项式系数，再对多项式求根（Durand–Kerner + 牛顿抛光）",
    ];
    if (Math.abs(det) < 1e-12) steps.push("det(A) ≈ 0 → A 不可逆，特征值里必有一个是 0");
    return {
      status: "ok",
      op: `det / rank / A⁻¹ / λ (${n}×${n})`,
      headline: "",
      headlineNote: `${n} 阶方阵的完整分析`,
      extras,
      steps,
      numeric,
      notes: eig.some((z) => Math.abs(z.im) > 1e-9)
        ? ["特征值里出现了复数，说明这个实矩阵在实数范围内不能对角化。"]
        : [],
      copy: `det = ${fmt(det)}, rank = ${rank}, eigenvalues = [${eig
        .map((z) => fmtCx(z, 8))
        .join(", ")}]${inv ? `, inverse = [[${inv.map((r) => r.map((v) => fmt(v, 8)).join(", ")).join("], [")}]]` : ", inverse: none"}`,
    };
  });
}

/* ------------------------------ 向量 ------------------------------ */

export function runVector(f: Fields): CalcResult {
  return guard(() => {
    const a = parseNumberList(f.vecA, "向量 a");
    const b = parseNumberList(f.vecB, "向量 b");
    const notes: string[] = [];
    if (a.length !== b.length) {
      notes.push(
        `两个向量长度不同（${a.length} 维 vs ${b.length} 维）：点积按对应位置相乘、短的一方缺的分量按 0 处理；夹角需要同维度才有意义。`,
      );
    }
    const dot = vecDot(a, b);
    const na = vecNorm(a);
    const nb = vecNorm(b);
    const cross = vecCross(a, b);
    const angle = vecAngle(a, b);
    const extras: ExtraRow[] = [
      { label: "a · b", value: fmt(dot) },
      { label: "|a|", value: fmt(na, 8) },
      { label: "|b|", value: fmt(nb, 8) },
    ];
    if (cross) {
      extras.push({ label: "a × b", value: `(${cross.map((v) => fmt(v, 8)).join(", ")})` });
      extras.push({ label: "|a × b|", value: fmt(vecNorm(cross), 8) });
    } else {
      extras.push({
        label: "a × b",
        value: `算不了：叉积只在两个三维向量之间有定义（现在 a 是 ${a.length} 维、b 是 ${b.length} 维）`,
        icon: "warn",
      });
    }
    if (angle === null) {
      extras.push({ label: "夹角", value: "算不了：有向量是零向量（或者两个向量维度不同），夹角没有定义", icon: "warn" });
    } else {
      extras.push({ label: "夹角", value: `${fmt(angle, 8)} rad = ${fmtDeg(angle, 6)}` });
    }
    if (na > 0) extras.push({ label: "a 的单位向量", value: `(${a.map((v) => fmt(v / na, 8)).join(", ")})` });
    if (nb > 0 && a.length === b.length) {
      const proj = dot / (nb * nb);
      extras.push({ label: "a 在 b 上的投影向量", value: `(${b.map((v) => fmt(proj * v, 8)).join(", ")})` });
      extras.push({ label: "a 在 b 方向上的投影长度", value: fmt(dot / nb, 8) });
    }
    const numeric: ExtraRow[] = [];
    if (cross) {
      const lhs = dot * dot + vecNorm(cross) * vecNorm(cross);
      const rhs = na * na * nb * nb;
      numeric.push({
        label: "拉格朗日恒等式 |a×b|² + (a·b)² = |a|²|b|²",
        value: `${fmt(lhs, 8)} vs ${fmt(rhs, 8)}（差 ${fmt(Math.abs(lhs - rhs), 4)}）`,
        icon: Math.abs(lhs - rhs) < 1e-8 * Math.max(1, rhs) ? "check" : "warn",
      });
    }
    numeric.push({
      label: "正交性检查 a · b",
      value: Math.abs(dot) < 1e-12 ? "≈ 0，两个向量正交" : `= ${fmt(dot, 8)}（不正交）`,
      icon: Math.abs(dot) < 1e-12 ? "check" : undefined,
    });
    const steps = [
      "点积：a · b = Σ aᵢbᵢ",
      "叉积（仅三维）：a × b = (a₂b₃ − a₃b₂, a₃b₁ − a₁b₃, a₁b₂ − a₂b₁)",
      "夹角：cos θ = (a · b) / (|a|·|b|)",
    ];
    return {
      status: "ok",
      op: "a · b / a × b / θ",
      headline: cross ? `a × b = (${cross.map((v) => fmt(v, 6)).join(", ")})` : `a · b = ${fmt(dot)}`,
      headlineNote:
        a.length === b.length
          ? `${a.length} 维向量运算（a·b = ${fmt(dot)}${angle === null ? "" : `，夹角 ${fmtDeg(angle, 4)}`}）`
          : "两个向量维度不同，请留意下面的说明",
      extras,
      steps,
      numeric,
      notes,
      copy: `a=(${a.join(", ")}), b=(${b.join(", ")}): a.b=${fmt(dot)}, |a|=${fmt(na, 8)}, |b|=${fmt(nb, 8)}${
        cross ? `, axb=(${cross.map((v) => fmt(v, 8)).join(", ")})` : ", axb: n/a"
      }${angle === null ? ", angle: n/a" : `, angle=${fmt(angle, 8)} rad`}`,
    };
  });
}

/* ------------------------------ 复数 ------------------------------ */

export function runComplex(f: Fields): CalcResult {
  return guard(() => {
    if (f.mode === "roots") {
      const n = parseIntIn(f.n, "开方次数", 1, 12);
      const z = evalComplex(f.z);
      if (Math.hypot(z.re, z.im) < 1e-14) fail("0 的 n 次方根就是 0 本身（n 个重根），这里没有别的分支可列");
      const roots = complexRoots(f.z, n);
      const steps = [
        `把 ${f.z.trim()} 写成极坐标：z = r·(cos θ + i·sin θ)`,
        `r = |z| = ${fmt(Math.hypot(z.re, z.im), 10)}，θ = arg z = ${fmt(Math.atan2(z.im, z.re), 10)} rad`,
        `n 次方根公式：z_k = r^(1/n)·(cos((θ + 2kπ)/n) + i·sin((θ + 2kπ)/n))，k = 0…${n - 1}`,
      ];
      let worst = 0;
      for (const w of roots) {
        const powered = powIntCx(w, n);
        worst = Math.max(worst, Math.hypot(powered.re - z.re, powered.im - z.im));
      }
      return {
        status: "ok",
        op: `${n}√z`,
        headline: roots.map((w) => fmtCx(w, 8)).join("，"),
        headlineNote: `共 ${n} 个根（主值分支给出全部 n 个）`,
        extras: roots.map((w, i) => ({
          label: `第 ${i + 1} 个根（k = ${i}）`,
          value: `${fmtCx(w, 10)}　|w| = ${fmt(Math.hypot(w.re, w.im), 8)}`,
          mono: true,
        })),
        steps,
        numeric: [
          {
            label: `把每个根取 ${n} 次方，与原数比较`,
            value: `最大偏差 ${fmt(worst, 4)}`,
            icon: worst < 1e-8 ? "check" : "warn",
          },
        ],
        notes: [],
        copy: `roots of ${f.z.trim()}: ${roots.map((w) => fmtCx(w, 10)).join(" | ")}`,
      };
    }

    if (f.mode === "poly") {
      const coeffs = parseNumberList(f.vecA, "系数（从高次到低次）");
      if (coeffs.length < 2) fail("至少给两个系数（例如 1 0 -1 表示 x² − 1）");
      const roots = polyRoots(coeffs);
      const steps = [
        `多项式按降幂排列，系数个数 ${coeffs.length} → 次数 n = ${coeffs.length - 1}`,
        "先用 Durand–Kerner 同时迭代所有根，再用牛顿法抛光；这里的复根也一并给出",
      ];
      const residuals = roots.map((z) => {
        const c = polyEvalCx(coeffs, z);
        return Math.hypot(c.re, c.im);
      });
      const worst = roots.length ? Math.max(...residuals) : 0;
      return {
        status: "ok",
        op: "p(z) = 0",
        headline: roots.length ? roots.map((z) => fmtCx(z, 8)).join("，") : "（没有根）",
        headlineNote: `系数：${coeffs.map((c) => fmt(c, 8)).join("、")}`,
        extras: roots.map((z, i) => ({
          label: `根 ${i + 1}`,
          value: `${fmtCx(z, 10)}　|z| = ${fmt(Math.hypot(z.re, z.im), 8)}　arg = ${fmt(Math.atan2(z.im, z.re), 8)} rad`,
          mono: true,
        })),
        steps,
        numeric: [
          {
            label: "把每个根代回多项式，看 |p(z)|",
            value: `最大 |p(z)| = ${fmt(worst, 4)}`,
            icon: worst < 1e-6 ? "check" : "warn",
          },
        ],
        notes: ["求根是数值迭代，重根附近可能有小的误差。"],
        copy: `roots of ${coeffs.join(" ")}: ${roots.map((z) => fmtCx(z, 10)).join(" | ")}`,
      };
    }

    const z = evalComplex(f.z);
    const r = Math.hypot(z.re, z.im);
    const theta = Math.atan2(z.im, z.re);
    const extras: ExtraRow[] = [
      { label: "实部 Re z", value: fmt(z.re, 10) },
      { label: "虚部 Im z", value: fmt(z.im, 10) },
      { label: "模 |z|", value: fmt(r, 10) },
      { label: "辐角 arg z", value: `${fmt(theta, 10)} rad = ${fmtDeg(theta, 8)}` },
      { label: "共轭 z̄", value: fmtCx({ re: z.re, im: -z.im }, 10), mono: true },
      { label: "三角形式", value: `${fmt(r, 8)}·(cos ${fmt(theta, 8)} + i·sin ${fmt(theta, 8)})` },
      { label: "指数形式", value: `${fmt(r, 8)}·e^(i·${fmt(theta, 8)})` },
    ];
    const prod = mulCx(z, { re: z.re, im: -z.im });
    const steps = [
      "复数表达式用同一套解析器求值，字母 i 当作虚数单位",
      "模：|z| = √(Re² + Im²)；辐角：arg z = atan2(Im, Re)",
      "z·z̄ = |z|²（用来做数值自检）",
    ];
    return {
      status: "ok",
      op: "z = a + bi",
      headline: fmtCx(z, 10),
      headlineNote: `|z| = ${fmt(r, 8)}，arg z = ${fmt(theta, 8)} rad`,
      extras,
      steps,
      numeric: [
        {
          label: "z·z̄ 与 |z|² 的差",
          value: `${fmt(prod.re, 8)} vs ${fmt(r * r, 8)}（差 ${fmt(Math.abs(prod.re - r * r) + Math.abs(prod.im), 4)}）`,
          icon: Math.abs(prod.re - r * r) + Math.abs(prod.im) < 1e-10 ? "check" : "warn",
        },
      ],
      notes: [],
      copy: `${f.z.trim()} = ${fmtCx(z, 10)}   |z| = ${fmt(r, 10)}, arg = ${fmt(theta, 10)} rad`,
    };
  });
}

/** 整数次复数幂（复根验证用） */
function powIntCx(a: Cx, n: number): Cx {
  let acc: Cx = { re: 1, im: 0 };
  for (let i = 0; i < n; i += 1) acc = mulCx(acc, a);
  return acc;
}

/* ==========================================================================
 * 第 17 部分：界面骨架
 *
 * 布局依据：这个工具有 8 类互不相干的运算，每类都有自己的参数表与结果形态（表达式 / 矩阵 /
 * 数值表 / 解曲线），用户一次只做一件事 —— 属于「一个工作台 + 多个互斥任务」（规范里的模式 B）。
 * 选**左侧竖排列表**而不是顶部标签页：8 个中文分类横排在小屏必然要截断或换行，
 * 而结果区要放长公式、需要尽可能宽的横向空间，竖排列正好把宽度让给结果。
 * 小屏（<lg）自动退化成一条可横向滑动的标签条，不占垂直空间。
 * ========================================================================== */

type FieldSpec = {
  key: keyof Fields;
  label: string;
  placeholder: string;
  hint?: string;
  wide?: boolean;
  multiline?: boolean;
};

type ModeSpec = {
  id: string;
  label: string;
  fields: FieldSpec[];
  example: Partial<Fields>;
};

type OpSpec = {
  id: string;
  label: string;
  hint: string;
  icon: React.ComponentType<{ className?: string }>;
  defaults: Partial<Fields>;
  modes: ModeSpec[];
  run: (f: Fields) => CalcResult;
};

const F_EXPR = (placeholder: string, wide = true): FieldSpec => ({ key: "expr", label: "表达式", placeholder, wide });
const F_VAR: FieldSpec = { key: "v", label: "自变量", placeholder: "x", hint: "字母即可" };

const OPS: OpSpec[] = [
  {
    id: "derivative",
    label: "求导",
    hint: "支持一阶 / 高阶 / 偏导 / 隐函数，过程按乘积法则、商法则、链式法则逐条列出",
    icon: SquareFunction,
    defaults: { v: "x", vs: "y", n: "2", a: "0.5" },
    modes: [
      {
        id: "first",
        label: "一阶导数",
        fields: [F_EXPR("例如 x^3*sin(x)、e^x*cos(x)"), F_VAR],
        example: { expr: "e^x*cos(x)", v: "x" },
      },
      {
        id: "nth",
        label: "高阶导数",
        fields: [F_EXPR("例如 x^5"), F_VAR, { key: "n", label: "阶数", placeholder: "3", hint: "1 ~ 10" }],
        example: { expr: "x^5", v: "x", n: "3" },
      },
      {
        id: "partial",
        label: "偏导数",
        fields: [
          F_EXPR("例如 x^2*y^3"),
          { key: "vs", label: "求导变量序列", placeholder: "x,y", hint: "逗号分隔，从左到右依次求导" },
        ],
        example: { expr: "x^2*y^3", vs: "x,y" },
      },
      {
        id: "implicit",
        label: "隐函数求导",
        fields: [
          { key: "expr", label: "方程 F(x, y) = 0", placeholder: "例如 x^2+y^2-1 或 x^2+y^2=1", wide: true },
          { key: "v", label: "自变量", placeholder: "x" },
          { key: "vs", label: "因变量", placeholder: "y" },
          { key: "a", label: "数值对拍用的点 x₀", placeholder: "0.5", hint: "可选" },
        ],
        example: { expr: "x^2+y^2-1", v: "x", vs: "y", a: "0.5" },
      },
    ],
    run: runDerivative,
  },
  {
    id: "limit",
    label: "极限",
    hint: "符号部分用洛必达 / 泰勒展开，数值部分用左右两侧取样 + Richardson 外推，两边互相复核",
    icon: InfinityIcon,
    defaults: { v: "x", a: "0" },
    modes: [
      {
        id: "both",
        label: "双侧极限",
        fields: [F_EXPR("例如 sin(x)/x"), F_VAR, { key: "a", label: "极限点", placeholder: "0", hint: "数字或 inf / -inf" }],
        example: { expr: "sin(x)/x", v: "x", a: "0" },
      },
      {
        id: "left",
        label: "左极限",
        fields: [F_EXPR("例如 1/x"), F_VAR, { key: "a", label: "极限点", placeholder: "0" }],
        example: { expr: "1/x", v: "x", a: "0" },
      },
      {
        id: "right",
        label: "右极限",
        fields: [F_EXPR("例如 1/x"), F_VAR, { key: "a", label: "极限点", placeholder: "0" }],
        example: { expr: "1/x", v: "x", a: "0" },
      },
      {
        id: "inf",
        label: "无穷远",
        fields: [F_EXPR("例如 (1+1/x)^x"), F_VAR, { key: "a", label: "极限点", placeholder: "inf" }],
        example: { expr: "(1+1/x)^x", v: "x", a: "inf" },
      },
    ],
    run: runLimit,
  },
  {
    id: "integral",
    label: "积分",
    hint: "不定积分会做「求导回代」自检，定积分同时给符号值与独立数值值，反常积分先换元再 tanh-sinh",
    icon: Ruler,
    defaults: { v: "x", vs: "y", a: "0", b: "1", from: "0", to: "1" },
    modes: [
      {
        id: "indefinite",
        label: "不定积分",
        fields: [F_EXPR("例如 x*e^x"), F_VAR],
        example: { expr: "x*e^x", v: "x" },
      },
      {
        id: "definite",
        label: "定积分",
        fields: [
          F_EXPR("例如 sin(x)"),
          F_VAR,
          { key: "a", label: "下限", placeholder: "0", hint: "可写 pi、2*pi" },
          { key: "b", label: "上限", placeholder: "pi" },
        ],
        example: { expr: "sin(x)", v: "x", a: "0", b: "pi" },
      },
      {
        id: "numeric",
        label: "数值 / 反常积分",
        fields: [
          F_EXPR("例如 1/sqrt(x)、e^(-x^2)"),
          F_VAR,
          { key: "a", label: "下限", placeholder: "0", hint: "可写 -inf" },
          { key: "b", label: "上限", placeholder: "inf" },
        ],
        example: { expr: "1/sqrt(x)", v: "x", a: "0", b: "1" },
      },
      {
        id: "double",
        label: "二重积分",
        fields: [
          F_EXPR("例如 x*y"),
          { key: "v", label: "第一个变量", placeholder: "x" },
          { key: "vs", label: "第二个变量", placeholder: "y" },
          { key: "a", label: "x 下限", placeholder: "0" },
          { key: "b", label: "x 上限", placeholder: "1" },
          { key: "from", label: "y 下限", placeholder: "0" },
          { key: "to", label: "y 上限", placeholder: "2" },
        ],
        example: { expr: "x*y", v: "x", vs: "y", a: "0", b: "1", from: "0", to: "2" },
      },
    ],
    run: runIntegral,
  },
  {
    id: "series",
    label: "泰勒与级数",
    hint: "泰勒展开给出逐阶系数，幂级数求和会先判别敛散性，收敛不了就不给「和」",
    icon: Sigma,
    defaults: { v: "x", a: "0", n: "7", from: "1", to: "inf" },
    modes: [
      {
        id: "taylor",
        label: "泰勒展开",
        fields: [
          F_EXPR("例如 sin(x)、e^x"),
          F_VAR,
          { key: "a", label: "展开点", placeholder: "0", hint: "可写 pi" },
          { key: "n", label: "阶数", placeholder: "7", hint: "0 ~ 12" },
        ],
        example: { expr: "sin(x)", v: "x", a: "0", n: "7" },
      },
      {
        id: "sum",
        label: "幂级数求和",
        fields: [
          F_EXPR("通项，例如 1/2^k、1/k^2"),
          { key: "v", label: "求和指标", placeholder: "k" },
          { key: "from", label: "起始项", placeholder: "0" },
          { key: "to", label: "结束项", placeholder: "inf", hint: "inf 表示无穷级数" },
        ],
        example: { expr: "1/2^k", v: "k", from: "0", to: "inf" },
      },
      {
        id: "conv",
        label: "敛散性判别",
        fields: [
          F_EXPR("通项，例如 1/k"),
          { key: "v", label: "求和指标", placeholder: "k" },
          { key: "from", label: "起始项", placeholder: "1" },
        ],
        example: { expr: "1/k^2", v: "k", from: "1" },
      },
      {
        id: "fourier",
        label: "傅里叶系数",
        fields: [
          F_EXPR("例如 x、abs(x)"),
          F_VAR,
          { key: "a", label: "半周期 L", placeholder: "pi" },
          { key: "n", label: "谐波项数", placeholder: "5", hint: "1 ~ 12" },
        ],
        example: { expr: "x", v: "x", a: "pi", n: "5" },
      },
    ],
    run: runSeries,
  },
  {
    id: "ode",
    label: "微分方程",
    hint: "一阶线性 / 可分离变量给符号解，其余形式给四阶 Runge–Kutta 数值解并附误差估计",
    icon: Waves,
    defaults: { v: "x", vs: "y", x0: "0", y0: "1", dy0: "1", b: "1", p: "0", q: "1" },
    modes: [
      {
        id: "first",
        label: "一阶 y′ = f(x, y)",
        fields: [
          { key: "expr", label: "右端 f(x, y)", placeholder: "例如 y、x*y、y^2", wide: true },
          { key: "v", label: "自变量", placeholder: "x" },
          { key: "vs", label: "未知函数", placeholder: "y" },
          { key: "x0", label: "初值点 x₀", placeholder: "0" },
          { key: "y0", label: "初值 y(x₀)", placeholder: "1" },
          { key: "b", label: "求解到 x =", placeholder: "1" },
        ],
        example: { expr: "y", v: "x", vs: "y", x0: "0", y0: "1", b: "1" },
      },
      {
        id: "second",
        label: "二阶常系数",
        fields: [
          { key: "p", label: "y′ 的系数 p", placeholder: "0" },
          { key: "q", label: "y 的系数 q", placeholder: "1" },
          { key: "v", label: "自变量", placeholder: "x" },
          { key: "x0", label: "初值点 x₀", placeholder: "0" },
          { key: "y0", label: "初值 y(x₀)", placeholder: "0" },
          { key: "dy0", label: "初值 y′(x₀)", placeholder: "1" },
          { key: "b", label: "求解到 x =", placeholder: "2*pi" },
        ],
        example: { p: "0", q: "1", v: "x", x0: "0", y0: "0", dy0: "1", b: "2*pi" },
      },
    ],
    run: runOde,
  },
  {
    id: "matrix",
    label: "矩阵与方程组",
    hint: "行列式 / 秩 / 逆 / 特征值，特征值用特征多项式求根，另有 QR 迭代结果交叉核对",
    icon: Grid3x3,
    defaults: {},
    modes: [
      {
        id: "calc",
        label: "矩阵分析",
        fields: [
          {
            key: "matA",
            label: "矩阵 A",
            placeholder: "每行一行，元素用空格或逗号分隔",
            hint: "例如 1 2 3 / 0 1 4 / 5 6 0",
            wide: true,
            multiline: true,
          },
        ],
        example: { matA: "1 2 3\n0 1 4\n5 6 0" },
      },
      {
        id: "solve",
        label: "解方程组 Ax = b",
        fields: [
          { key: "matA", label: "系数矩阵 A", placeholder: "每行一行", wide: true, multiline: true },
          { key: "vecB", label: "右端向量 b", placeholder: "例如 1 2 3" },
        ],
        example: { matA: "1 2 3\n0 1 4\n5 6 0", vecB: "1 2 3" },
      },
      {
        id: "mul",
        label: "矩阵乘法 A·B",
        fields: [
          { key: "matA", label: "矩阵 A", placeholder: "每行一行", multiline: true },
          { key: "matB", label: "矩阵 B", placeholder: "每行一行", multiline: true },
        ],
        example: { matA: "1 2\n3 4", matB: "5 6\n7 8" },
      },
    ],
    run: runMatrix,
  },
  {
    id: "vector",
    label: "向量运算",
    hint: "点积、叉积、模长、夹角、投影，并用拉格朗日恒等式交叉验证",
    icon: Radar,
    defaults: {},
    modes: [
      {
        id: "calc",
        label: "两个向量",
        fields: [
          { key: "vecA", label: "向量 a", placeholder: "1 2 3" },
          { key: "vecB", label: "向量 b", placeholder: "4 5 6" },
        ],
        example: { vecA: "1 2 3", vecB: "4 5 6" },
      },
    ],
    run: runVector,
  },
  {
    id: "complex",
    label: "复数运算",
    hint: "复数表达式求值、n 次方根、多项式求根，每个结果都代回原式检验",
    icon: Binary,
    defaults: { n: "3" },
    modes: [
      {
        id: "eval",
        label: "表达式求值",
        fields: [{ key: "z", label: "复数表达式", placeholder: "例如 (1+i)^8、sqrt(-4)", wide: true }],
        example: { z: "(1+i)^8" },
      },
      {
        id: "roots",
        label: "n 次方根",
        fields: [
          { key: "z", label: "被开方数", placeholder: "例如 1+i", wide: true },
          { key: "n", label: "次数 n", placeholder: "3", hint: "1 ~ 12" },
        ],
        example: { z: "1+i", n: "3" },
      },
      {
        id: "poly",
        label: "多项式求根",
        fields: [
          {
            key: "vecA",
            label: "系数（高次 → 低次）",
            placeholder: "例如 1 0 0 -1 表示 x³ − 1",
            wide: true,
          },
        ],
        example: { vecA: "1 0 0 -1" },
      },
    ],
    run: runComplex,
  },
];

/* ------------------------------ 小展示组件 ------------------------------ */

/** 把式子排好看：上标、·、√，以及单层的 a/b 分数排成上下两行 */
function MathText({ text, className }: { text: string; className?: string }) {
  const pretty = prettify(text);
  const frac = splitFraction(pretty);
  if (frac) {
    return (
      <span className={cn("inline-flex flex-col items-center align-middle text-[0.9em] leading-[1.08]", className)}>
        <span className="px-1">{frac[0]}</span>
        <span className="w-full self-stretch border-t border-current" />
        <span className="px-1">{frac[1]}</span>
      </span>
    );
  }
  return <span className={cn("font-mono-accent", className)}>{pretty}</span>;
}

function ExtraIcon({ icon }: { icon: ExtraRow["icon"] }) {
  if (icon === "check") return <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-primary" />;
  if (icon === "warn") return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />;
  if (icon === "trend") return <TrendingUp className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />;
  return null;
}

function MatrixGrid({ rows }: { rows: string[][] }) {
  return (
    <div className="thin-scroll mt-1 overflow-x-auto rounded-xl border border-border/60 bg-background/40">
      <table className="w-full border-collapse text-right">
        <tbody className="font-mono-accent text-xs">
          {rows.map((row, i) => (
            <tr key={i} className={i % 2 === 1 ? "bg-muted/30" : ""}>
              {row.map((cell, j) => (
                <td key={j} className="whitespace-nowrap px-3 py-1.5">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DataTable({ table }: { table: MathTable }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Table2 className="h-3.5 w-3.5" />
        {table.title}
      </div>
      <div className="thin-scroll overflow-x-auto rounded-xl border border-border/60">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="bg-muted/40 text-[11px] text-muted-foreground">
              {table.head.map((h) => (
                <th key={h} className="whitespace-nowrap border-b border-border/50 px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="font-mono-accent text-xs">
            {table.rows.map((row, i) => (
              <tr key={i} className={i % 2 === 1 ? "bg-muted/20" : ""}>
                {row.map((cell, j) => (
                  <td key={j} className="whitespace-nowrap px-3 py-1.5">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** 解曲线：只用主题色（stroke-primary / stroke-muted-foreground），不写死颜色 */
function CurvePlot({ chart }: { chart: NonNullable<CalcResult["chart"]> }) {
  const W = 660;
  const H = 220;
  const PAD = 34;
  const lines = chart.lines.map((l) => ({ ...l, points: l.points.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y)) }));
  const all = lines.flatMap((l) => l.points);
  if (all.length < 2) return null;
  let xMin = Math.min(...all.map((p) => p.x));
  let xMax = Math.max(...all.map((p) => p.x));
  let yMin = Math.min(...all.map((p) => p.y));
  let yMax = Math.max(...all.map((p) => p.y));
  if (xMax - xMin < 1e-12) xMax = xMin + 1;
  if (yMax - yMin < 1e-12) {
    yMin -= 1;
    yMax += 1;
  }
  const xPad = (xMax - xMin) * 0.04;
  const yPad = (yMax - yMin) * 0.08;
  xMin -= xPad;
  xMax += xPad;
  yMin -= yPad;
  yMax += yPad;
  const px = (x: number): number => PAD + ((x - xMin) / (xMax - xMin)) * (W - 2 * PAD);
  const py = (y: number): number => H - PAD - ((y - yMin) / (yMax - yMin)) * (H - 2 * PAD);
  const ticksY = [0, 0.25, 0.5, 0.75, 1];
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
        <Table2 className="h-3.5 w-3.5" />
        {chart.title}
        {lines.map((l) => (
          <span key={l.label} className="inline-flex items-center gap-1">
            <span
              className={cn(
                "inline-block h-0.5 w-4 rounded-full",
                l.kind === "primary" ? "bg-primary" : "bg-muted-foreground/70",
              )}
            />
            {l.label}
          </span>
        ))}
      </div>
      <div className="rounded-xl border border-border/60 bg-background/40 p-2">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={chart.title}>
          {ticksY.map((t) => (
            <line
              key={`gy-${t}`}
              x1={PAD}
              x2={W - PAD}
              y1={PAD + t * (H - 2 * PAD)}
              y2={PAD + t * (H - 2 * PAD)}
              className="stroke-border/50"
              strokeWidth={1}
            />
          ))}
          {yMin < 0 && yMax > 0 && (
            <line x1={PAD} x2={W - PAD} y1={py(0)} y2={py(0)} className="stroke-border" strokeWidth={1.2} />
          )}
          <line x1={PAD} x2={PAD} y1={PAD} y2={H - PAD} className="stroke-border" strokeWidth={1.2} />
          {lines.map((l) => (
            <polyline
              key={l.label}
              fill="none"
              className={l.kind === "primary" ? "stroke-primary" : "stroke-muted-foreground"}
              strokeWidth={l.kind === "primary" ? 2 : 1.6}
              strokeDasharray={l.kind === "primary" ? undefined : "5 3"}
              points={l.points.map((p) => `${px(p.x).toFixed(2)},${py(p.y).toFixed(2)}`).join(" ")}
            />
          ))}
          <text x={PAD} y={H - 12} className="fill-muted-foreground text-[10px]">
            {fmt(xMin, 4)}
          </text>
          <text x={W - PAD} y={H - 12} textAnchor="end" className="fill-muted-foreground text-[10px]">
            {fmt(xMax, 4)}
          </text>
          <text x={4} y={PAD + 4} className="fill-muted-foreground text-[10px]">
            {fmt(yMax, 4)}
          </text>
          <text x={4} y={H - PAD} className="fill-muted-foreground text-[10px]">
            {fmt(yMin, 4)}
          </text>
        </svg>
      </div>
    </div>
  );
}

/* ------------------------------ 结果卡 ------------------------------ */

function CopyResultButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copy = () => {
    const done = () => {
      setCopied(true);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => setCopied(false), 1500);
    };
    try {
      void navigator.clipboard.writeText(text).then(done, () => {
        // 剪贴板不可用（例如没有权限）时退回到老办法
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand("copy");
          done();
        } catch {
          /* 复制失败就不显示"已复制" */
        }
        document.body.removeChild(ta);
      });
    } catch {
      /* 忽略 */
    }
  };
  return (
    <Button variant="outline" size="sm" onClick={copy} disabled={!text}>
      {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "已复制" : "复制"}
    </Button>
  );
}

function ResultView({ r }: { r: CalcResult }) {
  const hasBody =
    r.extras.length > 0 || r.steps.length > 0 || r.numeric.length > 0 || r.notes.length > 0 || Boolean(r.table) || Boolean(r.chart);
  return (
    <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
      <div className="flex flex-wrap items-center gap-2">
        <BadgeCheck className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium text-foreground">结果</span>
        {r.status === "ok" && r.op && <Badge variant="secondary">{r.op}</Badge>}
        {r.status === "ok" && <Badge variant="success">已完成</Badge>}
        {r.status === "unsupported" && <Badge variant="outline">这一项算不了</Badge>}
        {r.status === "error" && <Badge variant="outline">输入有问题</Badge>}
        <div className="ml-auto">
          <CopyResultButton text={r.copy} />
        </div>
      </div>

      {r.status === "ok" && r.headline && (
        <div className="rounded-xl border border-border/50 bg-background/40 px-4 py-3">
          {r.op && <div className="text-[11px] text-muted-foreground">{r.op}</div>}
          <div className="mt-1 text-lg leading-relaxed text-foreground">
            <MathText text={r.headline} />
          </div>
          {r.headlineNote && <div className="mt-1.5 text-xs text-muted-foreground">{r.headlineNote}</div>}
        </div>
      )}

      {r.status === "ok" && !r.headline && r.headlineNote && (
        <div className="rounded-xl border border-border/50 bg-background/40 px-4 py-3 text-xs text-muted-foreground">
          {r.headlineNote}
        </div>
      )}

      {r.status === "unsupported" && (
        <div className="flex items-start gap-2 rounded-xl border-l-4 border-l-primary/60 bg-primary/[0.06] px-4 py-3 text-xs leading-relaxed text-muted-foreground">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <span>{r.message}</span>
        </div>
      )}

      {r.status === "error" && (
        <div className="flex items-center gap-2 rounded-xl border-l-4 border-l-destructive bg-destructive/10 px-4 py-3 font-mono text-xs text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          {r.message}
        </div>
      )}

      {r.extras.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {r.extras.map((row, i) => (
            <div
              key={`${row.label}-${i}`}
              className={cn(
                "rounded-xl border border-border/50 bg-background/40 px-3 py-2",
                row.matrix ? "sm:col-span-2" : "",
              )}
            >
              <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                <ExtraIcon icon={row.icon} />
                <span>{row.label}</span>
              </div>
              {row.value !== undefined && (
                <div className={cn("mt-0.5 break-words text-xs text-foreground", row.mono && "font-mono-accent")}>
                  {row.mono ? <MathText text={row.value} /> : row.value}
                </div>
              )}
              {row.matrix && <MatrixGrid rows={row.matrix} />}
            </div>
          ))}
        </div>
      )}

      {hasBody && r.notes.length > 0 && (
        <div className="space-y-1.5 rounded-xl border border-border/50 bg-muted/30 px-4 py-3">
          {r.notes.map((n, i) => (
            <div key={i} className="flex items-start gap-2 text-xs leading-relaxed text-muted-foreground">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              <span>{n}</span>
            </div>
          ))}
        </div>
      )}

      {r.numeric.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Activity className="h-3.5 w-3.5" />
            数值佐证
          </div>
          <div className="divide-y divide-border/40 rounded-xl border border-border/50 bg-background/40">
            {r.numeric.map((row, i) => (
              <div key={`${row.label}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                <ExtraIcon icon={row.icon} />
                <span className="text-xs text-muted-foreground">{row.label}</span>
                {row.value !== undefined && (
                  <span className="ml-auto font-mono-accent text-xs text-foreground">{row.value}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {r.steps.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
            <Layers className="h-3.5 w-3.5" />
            分步过程（引擎输出的推导轨迹，共 {r.steps.length} 条）
          </div>
          <ol className="space-y-1.5 rounded-xl border border-border/50 bg-background/40 px-3 py-3">
            {r.steps.map((s, i) => (
              <li key={i} className="flex items-start gap-2">
                <ArrowRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary/70" />
                <span className="break-words font-mono-accent text-xs leading-relaxed text-foreground">{s}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {r.table && <DataTable table={r.table} />}
      {r.chart && <CurvePlot chart={r.chart} />}
    </div>
  );
}

/* ------------------------------ 主组件 ------------------------------ */

type AllFields = Record<string, Fields>;

function buildInitial(): AllFields {
  const out: AllFields = {};
  for (const op of OPS) {
    out[op.id] = { ...EMPTY_FIELDS, mode: op.modes[0].id, ...op.defaults };
  }
  return out;
}

function withDefaults(f: Fields, patch: Partial<Fields>): Fields {
  const next: Fields = { ...f };
  for (const [k, v] of Object.entries(patch)) {
    if (v !== undefined) next[k as keyof Fields] = v;
  }
  return next;
}

export function AdvancedMathTool() {
  const [tab, setTab] = useToolDraft<string>(ADV_MATH_TOOL_ID, "op", OPS[0].id);
  const [digits, setDigits] = useToolDraft<string>(ADV_MATH_TOOL_ID, "digits", "10");
  const [allFields, setAllFields] = useToolDraft<AllFields>(ADV_MATH_TOOL_ID, "fields", buildInitial());
  const [results, setResults] = useState<Record<string, CalcResult | null>>({});

  const op = useMemo(() => OPS.find((o) => o.id === tab) ?? OPS[0], [tab]);
  const stored = allFields[op.id] ?? {};
  const mode = op.modes.find((m) => m.id === stored.mode) ?? op.modes[0];
  const fields: Fields = { ...EMPTY_FIELDS, ...op.defaults, ...stored, mode: mode.id };

  const patchField = (key: keyof Fields, value: string) => {
    setAllFields((prev) => {
      const cur = prev[op.id] ?? { ...EMPTY_FIELDS };
      const next: Fields = { ...cur, [key]: value };
      return { ...prev, [op.id]: next };
    });
    setResults((prev) => ({ ...prev, [op.id]: null }));
  };

  const switchMode = (modeId: string) => {
    setAllFields((prev) => {
      const cur = prev[op.id] ?? { ...EMPTY_FIELDS };
      const next: Fields = { ...cur, mode: modeId };
      return { ...prev, [op.id]: next };
    });
    setResults((prev) => ({ ...prev, [op.id]: null }));
  };

  const calculate = (override?: Fields) => {
    const input = override ?? fields;
    setDisplayDigits(Number(digits) || 10);
    const next = guard(() => op.run(input));
    setResults((prev) => ({ ...prev, [op.id]: next }));
  };

  const applyExample = () => {
    const next = withDefaults({ ...EMPTY_FIELDS }, { ...op.defaults, ...mode.example });
    next.mode = mode.id;
    setAllFields((prev) => ({ ...prev, [op.id]: next }));
    calculate(next);
  };

  const clearCurrent = () => {
    const next: Fields = { ...EMPTY_FIELDS, ...op.defaults, mode: mode.id };
    setAllFields((prev) => ({ ...prev, [op.id]: next }));
    setResults((prev) => ({ ...prev, [op.id]: null }));
  };

  const result = results[op.id] ?? null;

  return (
    <div className="space-y-5">
      {/* 顶部操作条：只放控件与一句说明，不重复工具名 / 描述 */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-3 py-2.5">
        <Badge variant="default">
          <BadgeCheck className="h-3 w-3" />
          符号引擎自研，零第三方数学库
        </Badge>
        <span className="text-[11px] text-muted-foreground">
          每个结果都配一条独立的数值链路做复核；算不出来的会写明原因，不给没有把握的答案。
        </span>
        <div className="ml-auto flex items-center gap-2">
          <Label className="whitespace-nowrap">显示精度</Label>
          <Select value={digits} className="w-24" onChange={(e) => setDigits(e.target.value)}>
            <option value="6">6 位</option>
            <option value="8">8 位</option>
            <option value="10">10 位</option>
            <option value="12">12 位</option>
          </Select>
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-12">
        {/* 左：运算类型（小屏变成可横滑的标签条） */}
        <nav className="flex gap-1.5 overflow-x-auto pb-1 lg:col-span-3 lg:flex-col lg:overflow-visible lg:pb-0">
          {OPS.map((o) => {
            const active = o.id === op.id;
            const Icon = o.icon;
            return (
              <Button
                key={o.id}
                variant={active ? "default" : "ghost"}
                size="sm"
                className={cn("shrink-0 justify-start gap-2 lg:w-full", !active && "text-muted-foreground")}
                onClick={() => setTab(o.id)}
              >
                <Icon className="h-3.5 w-3.5" />
                <span className="truncate">{o.label}</span>
                {results[o.id] ? (
                  <Check className={cn("ml-auto h-3.5 w-3.5", active ? "opacity-80" : "text-primary")} />
                ) : null}
              </Button>
            );
          })}
        </nav>

        {/* 右：参数 + 结果 */}
        <div className="space-y-5 lg:col-span-9">
          <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
            <div className="flex flex-wrap items-center gap-2">
              <SlidersHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
              <Label>参数</Label>
              <div className="ml-auto flex flex-wrap gap-1 rounded-xl border border-border/60 bg-muted/30 p-0.5">
                {op.modes.map((m) => (
                  <Button
                    key={m.id}
                    variant={m.id === mode.id ? "secondary" : "ghost"}
                    size="sm"
                    onClick={() => switchMode(m.id)}
                  >
                    {m.label}
                  </Button>
                ))}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {mode.fields.map((spec) => (
                <div key={spec.key} className={cn("space-y-1.5", spec.wide && "sm:col-span-2 xl:col-span-3")}>
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <Label>{spec.label}</Label>
                    {spec.hint && <span className="text-[10px] text-muted-foreground">{spec.hint}</span>}
                  </div>
                  {spec.multiline ? (
                    <Textarea
                      className="min-h-[84px] font-mono-accent text-xs"
                      value={fields[spec.key]}
                      placeholder={spec.placeholder}
                      onChange={(e) => patchField(spec.key, e.target.value)}
                    />
                  ) : (
                    <Input
                      className="h-9 font-mono-accent text-xs"
                      value={fields[spec.key]}
                      placeholder={spec.placeholder}
                      onChange={(e) => patchField(spec.key, e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") calculate();
                      }}
                    />
                  )}
                </div>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-border/40 pt-4">
              <Button size="sm" onClick={() => calculate()}>
                <SquareFunction className="h-3.5 w-3.5" />
                开始计算
              </Button>
              <Button variant="outline" size="sm" onClick={applyExample}>
                <Sparkles className="h-3.5 w-3.5" />
                填入示例
              </Button>
              <Button variant="ghost" size="sm" onClick={clearCurrent}>
                <Eraser className="h-3.5 w-3.5" />
                清空
              </Button>
              <span className="text-[11px] text-muted-foreground">{op.hint}</span>
            </div>
          </div>

          {result ? (
            <ResultView r={result} />
          ) : (
            <div className="rounded-2xl border border-dashed border-border/70 bg-card/40 p-8 text-center">
              <BookOpen className="mx-auto h-5 w-5 text-muted-foreground" />
              <p className="mt-2 text-sm text-foreground">还没有结果</p>
              <p className="mt-1 text-xs text-muted-foreground">
                填好参数后点「开始计算」；不知道填什么就点「填入示例」，会自动填一组数据并立刻算一遍。
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

