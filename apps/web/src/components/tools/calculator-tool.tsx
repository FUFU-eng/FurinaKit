"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Atom,
  Binary,
  Calculator as CalcIcon,
  Check,
  Copy,
  Dices,
  Eraser,
  History,
  PanelRightClose,
  PanelRightOpen,
  ScrollText,
  Sparkles,
  Wand2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Badge, Button, Input } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useToolDraft } from "@/lib/use-tool-draft";

/* ==================== ENGINE BEGIN ====================
 * 下面这一段是「纯逻辑」区：不依赖 React / DOM / 第三方库，也不使用 eval / new Function。
 * 表达式求值是自己写的 tokenizer + 递归下降解析器（语法错误会带出错位置）。
 * 单测脚本会把这一段原文抽出来，用仓库自带 typescript 转译后在 Node 里跑断言。
 * ==================== ENGINE BEGIN-INFO ==================== */

type AngleMode = "DEG" | "RAD" | "GRAD";

/** 计算器的值：数字 / 布尔（比较与逻辑运算）/ 字符串（进制与分数格式化）/ 数字数组（统计函数） */
type CalcValue = number | boolean | string | number[];

/** 带「出错位置」的计算错误：界面会用它把错误指到表达式里的具体字符 */
class CalcError extends Error {
  index: number;
  hint?: string;
  constructor(message: string, index = 0, hint?: string) {
    super(message);
    this.name = "CalcError";
    this.index = index;
    this.hint = hint;
  }
}

/** instanceof 在跨编译目标（watch/生产/HMR）下偶尔会失效，用 name 兜一层 */
function isCalcError(e: unknown): e is CalcError {
  if (e instanceof CalcError) return true;
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { name?: unknown }).name === "CalcError" &&
    typeof (e as { message?: unknown }).message === "string"
  );
}

function toRad(angle: number, mode: AngleMode): number {
  if (mode === "DEG") return (angle * Math.PI) / 180;
  if (mode === "GRAD") return (angle * Math.PI) / 200;
  return angle;
}

function fromRad(rad: number, mode: AngleMode): number {
  if (mode === "DEG") return (rad * 180) / Math.PI;
  if (mode === "GRAD") return (rad * 200) / Math.PI;
  return rad;
}

/** 「30°」这种写法：把「度」换算成当前角度单位下的数值 */
function degreesToMode(deg: number, mode: AngleMode): number {
  if (mode === "DEG") return deg;
  if (mode === "GRAD") return (deg * 10) / 9;
  return (deg * Math.PI) / 180;
}

/* ---------------------------- 显示格式 ---------------------------- */

const DISPLAY_SIG_DIGITS = 12;

/**
 * 显示用的数字格式化。
 *
 * 精度策略（重要）：
 * - **计算过程一律用完整 IEEE-754 双精度**，任何一步都不做四舍五入；
 * - 只在这里对「要显示的那串字」做处理，且规则是确定的：
 *   1. 整数且 |x| < 1e21 原样输出（不丢精度，2^60 也照样显示完整整数）；
 *   2. 其余情况取 12 位有效数字再转回数字，`0.1+0.2` 于是显示 `0.3`，
 *      不会出现 `0.30000000000000004` 这样的浮点毛刺；
 *   3. 界面右上角有「完整精度」开关，随时能看到该双精度值的最短往返表示
 *      （`0.1+0.2` 会显示 `0.30000000000000004`），所以是「显示简化」而不是「精度糊弄」。
 */
function formatNumber(x: number, sig = DISPLAY_SIG_DIGITS): string {
  if (Number.isNaN(x)) return "NaN";
  if (!Number.isFinite(x)) return x > 0 ? "Infinity" : "-Infinity";
  if (x === 0) return "0";
  if (Number.isInteger(x) && Math.abs(x) < 1e21) return String(x);
  const p = Number(x.toPrecision(sig));
  if (!Number.isFinite(p)) return String(x);
  return String(p);
}

/** 完整精度（最短往返表示，可精确还原这个 double） */
function formatFullPrecision(x: number): string {
  if (Number.isNaN(x)) return "NaN";
  if (!Number.isFinite(x)) return x > 0 ? "Infinity" : "-Infinity";
  return String(x);
}

function formatValue(v: CalcValue, opts?: { full?: boolean }): string {
  if (typeof v === "number") return opts?.full ? formatFullPrecision(v) : formatNumber(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "string") return v;
  return `[${v.map((n) => formatNumber(n)).join(", ")}]`;
}

/**
 * 连分数逼近：把小数写成最简分数，用来在界面上给一个「≈ 3/4」这样的提示。
 * 只有当分数与原值相差不超过 1e-12 相对误差、且分母不超过 maxDen 时才返回。
 */
function toFractionString(x: number, maxDen = 100000): string | null {
  if (!Number.isFinite(x) || Number.isInteger(x)) return null;
  const sign = x < 0 ? "-" : "";
  const a = Math.abs(x);
  if (a === 0 || a > 1e15) return null;
  // 标准连分数收敛项
  let h1 = 1;
  let h0 = 0;
  let k1 = 0;
  let k0 = 1;
  let rest = a;
  for (let i = 0; i < 40; i++) {
    const int = Math.floor(rest);
    const h2 = int * h1 + h0;
    const k2 = int * k1 + k0;
    if (k2 > maxDen) return null;
    h0 = h1;
    h1 = h2;
    k0 = k1;
    k1 = k2;
    if (k1 > 1 && Math.abs(h1 / k1 - a) <= Math.abs(a) * 1e-12) return `${sign}${h1}/${k1}`;
    const frac = rest - int;
    if (frac < 1e-15) break;
    rest = 1 / frac;
  }
  return null;
}

/* ------------------------- 人民币大写金额 ------------------------- */
/* 说明：原实现给出的是「欠」前缀与不规范的零，这里按银行支票写法重写，可单测。 */

const RMB_DIGITS = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
const RMB_UNITS = ["", "拾", "佰", "仟"];
const RMB_BIG_UNITS = ["", "万", "亿"];

function rmbSection(section: number): string {
  // section: 0 ~ 9999
  let s = "";
  let zeroPending = false;
  const digits = [Math.floor(section / 1000) % 10, Math.floor(section / 100) % 10, Math.floor(section / 10) % 10, section % 10];
  for (let i = 0; i < 4; i++) {
    const d = digits[i];
    const unit = RMB_UNITS[3 - i];
    if (d === 0) {
      if (s !== "") zeroPending = true;
      continue;
    }
    if (zeroPending) {
      s += "零";
      zeroPending = false;
    }
    s += RMB_DIGITS[d] + unit;
  }
  return s;
}

/**
 * 人民币金额大写。超出 12 位整数（9999.99 亿）或非法值时返回 null（界面不显示这一行）。
 * 例：1234.56 → 壹仟贰佰叁拾肆元伍角陆分；10.05 → 壹拾元零伍分；10001 → 壹万零壹元整。
 */
function numberToRmb(num: number): string | null {
  if (!Number.isFinite(num)) return null;
  if (Math.abs(num) > 999999999999.99) return null;
  let n = Math.round(Math.abs(num) * 100); // 以「分」为整数单位，避免浮点误差
  if (n === 0) return "零元整";
  const fen = n % 10;
  const jiao = Math.floor(n / 10) % 10;
  const yuan = Math.floor(n / 100);
  n = yuan;
  // 四位一节
  const sections: number[] = [];
  while (n > 0) {
    sections.push(n % 10000);
    n = Math.floor(n / 10000);
  }
  let intPart = "";
  for (let i = sections.length - 1; i >= 0; i--) {
    const sec = sections[i];
    if (sec === 0) {
      // 这一节是 0：只有更低位还有非零节时才补一个「零」
      const lowerNonZero = sections.slice(0, i).some((s) => s !== 0);
      if (intPart !== "" && lowerNonZero && !intPart.endsWith("零")) intPart += "零";
      continue;
    }
    // 节内高位为零时，跨节要补一个「零」（如 10001 → 壹万零壹）
    if (intPart !== "" && sec < 1000 && !intPart.endsWith("零")) intPart += "零";
    intPart += rmbSection(sec) + RMB_BIG_UNITS[i];
  }
  intPart = intPart.replace(/零+$/, "");
  // 整数部分为 0（如 0.5）时不写「零元」，直接写「伍角」
  let out = "";
  if (intPart !== "" || yuan > 0) {
    out = (intPart === "" ? "零" : intPart) + "元";
  }
  if (jiao === 0 && fen === 0) {
    out += "整";
  } else if (jiao === 0) {
    out += (yuan > 0 ? "零" : "") + RMB_DIGITS[fen] + "分";
  } else {
    out += RMB_DIGITS[jiao] + "角";
    if (fen !== 0) out += RMB_DIGITS[fen] + "分";
  }
  return (num < 0 ? "负" : "") + out;
}

/* ---------------------------- 常数 ---------------------------- */

const MATH_CONSTANTS: Record<string, number> = {
  pi: Math.PI,
  PI: Math.PI,
  "π": Math.PI,
  e: Math.E,
  E: Math.E,
  tau: Math.PI * 2,
  "τ": Math.PI * 2,
  phi: (1 + Math.sqrt(5)) / 2,
  "φ": (1 + Math.sqrt(5)) / 2,
  LN2: Math.LN2,
  LN10: Math.LN10,
  LOG2E: Math.LOG2E,
  LOG10E: Math.LOG10E,
  SQRT2: Math.SQRT2,
  SQRT1_2: Math.SQRT1_2,
  Infinity: Infinity,
  "∞": Infinity,
  NaN: NaN,
  // 物理常数（原有功能，保持可用）
  c: 299792458,
  h: 6.62607015e-34,
  G: 6.6743e-11,
  g: 9.80665,
  NA: 6.02214076e23,
};

/* ---------------------------- 词法分析 ---------------------------- */

type TokenType = "num" | "name" | "punc" | "end";

interface Token {
  type: TokenType;
  text: string;
  num?: number;
  index: number;
}

/** 全角/排版符号归一化（一律 1:1 字符替换，保证出错位置仍然准确） */
function normalizeExpression(src: string): string {
  return src
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/−/g, "-")
    .replace(/[–—]/g, "-")
    .replace(/（/g, "(")
    .replace(/）/g, ")")
    .replace(/[，、]/g, ",")
    .replace(/＋/g, "+")
    .replace(/－/g, "-")
    .replace(/＊/g, "*")
    .replace(/／/g, "/")
    .replace(/％/g, "%")
    .replace(/！/g, "!")
    .replace(/＾/g, "^")
    .replace(/。/g, ".");
}

const PUNCT = [
  ">>>",
  "<<",
  ">>",
  "^|",
  ">=",
  "<=",
  "==",
  "!=",
  "&&",
  "||",
  "+",
  "-",
  "*",
  "/",
  "^",
  "!",
  "%",
  "(",
  ")",
  "[",
  "]",
  ",",
  "<",
  ">",
  "&",
  "|",
  "~",
  "?",
  ":",
  "=",
  "°",
  "√",
];

const KEYWORD_NAMES = new Set(["mod", "and", "or", "xor", "not", "to", "in"]);

const NUMBER_RE = /^(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?/;

function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }
    // 数字（含 0x / 0b / 0o 与科学计数法）
    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(src[i + 1] ?? ""))) {
      const rest = src.slice(i);
      const based = /^(0[xX][0-9a-fA-F]+|0[bB][01]+|0[oO][0-7]+)/.exec(rest);
      if (based) {
        tokens.push({ type: "num", text: based[0], num: Number(based[0]), index: i });
        i += based[0].length;
        continue;
      }
      const badPrefix = /^0[xXbBoO]/.exec(rest);
      if (badPrefix) throw new CalcError(`${badPrefix[0]} 后面要跟对应的数字`, i, "例如 0xFF、0b1010、0o17");
      const m = NUMBER_RE.exec(rest);
      if (!m) throw new CalcError("数字写法不对", i);
      const after = rest.slice(m[0].length);
      if (/^\.[0-9]/.test(after) || /^[0-9]/.test(after)) {
        throw new CalcError("数字格式不对：一个小数里出现了两个小数点", i, "例如 1.5 是合法的，1.5.2 不是");
      }
      tokens.push({ type: "num", text: m[0], num: Number(m[0]), index: i });
      i += m[0].length;
      continue;
    }
    // 名称：函数 / 常数 / 关键字；同时接受 math.sin(…) 这种带 math. 前缀的写法
    if (/[A-Za-z_πφτ∞]/.test(ch)) {
      let j = i;
      let name = "";
      for (;;) {
        const m = /^(?:[A-Za-z_][A-Za-z0-9_]*|[πφτ∞])/.exec(src.slice(j));
        if (!m) break;
        name += m[0];
        j += m[0].length;
        // math. 前缀：math.sin 视为一个名称
        if (name === "math" && src[j] === "." && /[A-Za-z]/.test(src[j + 1] ?? "")) {
          name += ".";
          j += 1;
          continue;
        }
        break;
      }
      tokens.push({ type: "name", text: name, index: i });
      i = j;
      continue;
    }
    // 运算符 / 括号
    const punc = PUNCT.find((p) => src.startsWith(p, i));
    if (punc) {
      tokens.push({ type: "punc", text: punc, index: i });
      i += punc.length;
      continue;
    }
    throw new CalcError(`不认识的符号「${ch}」`, i, "只支持 + - * / ^ ! % ( ) [ ] , 以及 and/or/xor/mod 这些关键字");
  }
  tokens.push({ type: "end", text: "", index: src.length });
  return tokens;
}

/* ---------------------------- 语法分析 ---------------------------- */

type Node =
  | { t: "num"; v: number; index: number }
  | { t: "name"; name: string; index: number }
  | { t: "unary"; op: string; a: Node; index: number }
  | { t: "postfix"; op: "!" | "%" | "°"; a: Node; index: number }
  | { t: "binary"; op: string; a: Node; b: Node; index: number }
  | { t: "call"; name: string; args: Node[]; index: number }
  | { t: "array"; items: Node[]; index: number }
  | { t: "cond"; c: Node; a: Node; b: Node; index: number };

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(offset = 0): Token {
    const t = this.tokens[this.pos + offset];
    return t ?? { type: "end", text: "", index: this.tokens[this.tokens.length - 1]?.index ?? 0 };
  }

  private next(): Token {
    const t = this.peek();
    if (t.type !== "end") this.pos++;
    return t;
  }

  parse(): Node {
    const node = this.parseExpression();
    const t = this.peek();
    if (t.type !== "end") {
      throw new CalcError(`这里多了一段内容「${t.text}」`, t.index, "检查是不是漏了运算符，或者括号没配对");
    }
    return node;
  }

  /* 条件表达式 a ? b : c —— 优先级最低 */
  private parseExpression(): Node {
    const cond = this.parseOr();
    if (this.peek().text === "?") {
      const t = this.next();
      const a = this.parseExpression();
      if (this.peek().text !== ":") {
        throw new CalcError("条件表达式缺少「:」", this.peek().index, "写法：判断 ? 成立时的值 : 不成立时的值");
      }
      this.next();
      const b = this.parseExpression();
      return { t: "cond", c: cond, a, b, index: t.index };
    }
    return cond;
  }

  private parseOr(): Node {
    let left = this.parseXor();
    for (;;) {
      const t = this.peek();
      if ((t.type === "name" && t.text === "or") || t.text === "||") {
        this.next();
        const right = this.parseXor();
        left = { t: "binary", op: "or", a: left, b: right, index: t.index };
        continue;
      }
      return left;
    }
  }

  private parseXor(): Node {
    let left = this.parseAnd();
    for (;;) {
      const t = this.peek();
      if ((t.type === "name" && t.text === "xor") || t.text === "^|") {
        this.next();
        const right = this.parseAnd();
        left = { t: "binary", op: "xor", a: left, b: right, index: t.index };
        continue;
      }
      return left;
    }
  }

  private parseAnd(): Node {
    let left = this.parseBitOr();
    for (;;) {
      const t = this.peek();
      if ((t.type === "name" && t.text === "and") || t.text === "&&") {
        this.next();
        const right = this.parseBitOr();
        left = { t: "binary", op: "and", a: left, b: right, index: t.index };
        continue;
      }
      return left;
    }
  }

  private parseBitOr(): Node {
    let left = this.parseBitXor();
    for (;;) {
      const t = this.peek();
      if (t.text === "|") {
        this.next();
        const right = this.parseBitXor();
        left = { t: "binary", op: "|", a: left, b: right, index: t.index };
        continue;
      }
      return left;
    }
  }

  private parseBitXor(): Node {
    let left = this.parseBitAnd();
    for (;;) {
      const t = this.peek();
      if (t.text === "^|") {
        this.next();
        const right = this.parseBitAnd();
        left = { t: "binary", op: "xor", a: left, b: right, index: t.index };
        continue;
      }
      return left;
    }
  }

  private parseBitAnd(): Node {
    let left = this.parseEquality();
    for (;;) {
      const t = this.peek();
      if (t.text === "&") {
        this.next();
        const right = this.parseEquality();
        left = { t: "binary", op: "&", a: left, b: right, index: t.index };
        continue;
      }
      return left;
    }
  }

  private parseEquality(): Node {
    let left = this.parseRelational();
    for (;;) {
      const t = this.peek();
      if (t.text === "==" || t.text === "!=") {
        this.next();
        const right = this.parseRelational();
        left = { t: "binary", op: t.text, a: left, b: right, index: t.index };
        continue;
      }
      return left;
    }
  }

  private parseRelational(): Node {
    let left = this.parseShift();
    for (;;) {
      const t = this.peek();
      if (t.text === "<" || t.text === ">" || t.text === "<=" || t.text === ">=") {
        this.next();
        const right = this.parseShift();
        left = { t: "binary", op: t.text, a: left, b: right, index: t.index };
        continue;
      }
      return left;
    }
  }

  private parseShift(): Node {
    let left = this.parseAdditive();
    for (;;) {
      const t = this.peek();
      if (t.text === "<<" || t.text === ">>" || t.text === ">>>") {
        this.next();
        const right = this.parseAdditive();
        left = { t: "binary", op: t.text, a: left, b: right, index: t.index };
        continue;
      }
      return left;
    }
  }

  private parseAdditive(): Node {
    let left = this.parseMultiplicative();
    for (;;) {
      const t = this.peek();
      if (t.text === "+" || t.text === "-") {
        this.next();
        const right = this.parseMultiplicative();
        left = { t: "binary", op: t.text, a: left, b: right, index: t.index };
        continue;
      }
      return left;
    }
  }

  /** 乘除、求余、以及「省略乘号」的隐式乘法（2π、3(4)、(2)(3)、2sin(30)） */
  private parseMultiplicative(): Node {
    let left = this.parseUnary();
    for (;;) {
      const t = this.peek();
      if (t.text === "*" || t.text === "/" || t.text === ".*" || t.text === "./") {
        this.next();
        const right = this.parseUnary();
        left = { t: "binary", op: t.text === ".*" ? "*" : t.text === "./" ? "/" : t.text, a: left, b: right, index: t.index };
        continue;
      }
      if (t.type === "name" && t.text === "mod") {
        this.next();
        const right = this.parseUnary();
        left = { t: "binary", op: "mod", a: left, b: right, index: t.index };
        continue;
      }
      if (t.type === "name" && (t.text === "to" || t.text === "in")) {
        throw new CalcError("本工具不支持单位换算（to / in）", t.index, "需要换算单位请用「单位换算」工具，这里只做数值计算");
      }
      if (this.startsOperand(t)) {
        const right = this.parseUnary();
        left = { t: "binary", op: "*", a: left, b: right, index: t.index };
        continue;
      }
      return left;
    }
  }

  private startsOperand(t: Token): boolean {
    if (t.type === "num") return true;
    if (t.type === "name") return !KEYWORD_NAMES.has(t.text);
    return t.text === "(" || t.text === "[" || t.text === "√";
  }

  private parseUnary(): Node {
    const t = this.peek();
    if (t.text === "-" || t.text === "+" || t.text === "~") {
      this.next();
      const a = this.parseUnary();
      return { t: "unary", op: t.text, a, index: t.index };
    }
    if (t.type === "name" && t.text === "not") {
      this.next();
      const a = this.parseUnary();
      return { t: "unary", op: "not", a, index: t.index };
    }
    return this.parsePower();
  }

  /** 幂运算：右结合（2^3^2 = 2^(3^2)），且优先级高于一元负号（-2^2 = -(2^2)） */
  private parsePower(): Node {
    const base = this.parsePostfix();
    if (this.peek().text === "^") {
      const t = this.next();
      const exp = this.parseUnary();
      return { t: "binary", op: "^", a: base, b: exp, index: t.index };
    }
    return base;
  }

  private parsePostfix(): Node {
    let node = this.parsePrimary();
    for (;;) {
      const t = this.peek();
      if (t.text === "!" || t.text === "%" || t.text === "°") {
        this.next();
        node = { t: "postfix", op: t.text as "!" | "%" | "°", a: node, index: t.index };
        continue;
      }
      return node;
    }
  }

  private parsePrimary(): Node {
    const t = this.peek();
    if (t.type === "num") {
      this.next();
      return { t: "num", v: t.num ?? 0, index: t.index };
    }
    if (t.type === "name") {
      this.next();
      if (this.peek().text === "(") {
        return { t: "call", name: t.text, args: this.parseArguments(), index: t.index };
      }
      return { t: "name", name: t.text, index: t.index };
    }
    if (t.text === "(") {
      const open = this.next();
      const inner = this.parseExpression();
      if (this.peek().text !== ")") {
        throw new CalcError("括号不匹配：这个左括号没有对应的右括号", open.index, "把 ( 补成一对，或者删掉它");
      }
      this.next();
      return inner;
    }
    if (t.text === ")") {
      throw new CalcError("多了一个右括号「)」", t.index, "删掉它，或者在前面补一个 (");
    }
    if (t.text === "[") {
      const open = this.next();
      const items: Node[] = [];
      if (this.peek().text !== "]") {
        for (;;) {
          items.push(this.parseExpression());
          const nt = this.peek();
          if (nt.text === ",") {
            this.next();
            continue;
          }
          break;
        }
      }
      if (this.peek().text !== "]") {
        throw new CalcError("方括号没有闭合", open.index, "统计函数用 [1, 2, 3] 这样的数组写法");
      }
      this.next();
      return { t: "array", items, index: open.index };
    }
    if (t.text === "√") {
      this.next();
      const a = this.parseUnary();
      return { t: "call", name: "sqrt", args: [a], index: t.index };
    }
    if (t.type === "end") {
      throw new CalcError("算式还没写完：末尾缺少一个数或函数名", t.index, "例如 2+ 后面要再跟一个数");
    }
    throw new CalcError(`这里不应该出现「${t.text}」`, t.index, "检查一下运算符左右是不是都缺了数");
  }

  private parseArguments(): Node[] {
    this.next(); // 吃掉 "("
    const args: Node[] = [];
    if (this.peek().text === ")") {
      this.next();
      return args;
    }
    for (;;) {
      args.push(this.parseExpression());
      const t = this.peek();
      if (t.text === ",") {
        this.next();
        continue;
      }
      if (t.text === ")") {
        this.next();
        return args;
      }
      throw new CalcError("函数参数之间要用英文逗号「,」隔开", t.index);
    }
  }
}

/* ---------------------------- 数学函数 ---------------------------- */

function factorialFn(n: number): number {
  if (!Number.isInteger(n) || n < 0) return NaN;
  if (n > 170) return Infinity;
  let res = 1;
  for (let i = 2; i <= n; i++) res *= i;
  return res;
}

/** Lanczos 近似的 Gamma 函数（mathjs 的 gamma 也是这套，误差 ~1e-14 相对） */
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];

function gammaFn(z: number): number {
  if (Number.isNaN(z)) return NaN;
  if (Number.isInteger(z) && z <= 0) return NaN;
  if (z < 0.5) return Math.PI / (Math.sin(Math.PI * z) * gammaFn(1 - z));
  const x = z - 1;
  let a = LANCZOS[0];
  for (let i = 1; i < 9; i++) a += LANCZOS[i] / (x + i);
  const t = x + 7.5;
  return Math.sqrt(2 * Math.PI) * Math.pow(t, x + 0.5) * Math.exp(-t) * a;
}

/** 四舍五入（远离零方向，与计算器/十进制语义一致，而不是 Math.round 的 -0.5 → -0） */
function roundHalfAway(x: number, digits = 0): number {
  if (!Number.isFinite(x)) return x;
  const f = Math.pow(10, digits);
  if (!Number.isFinite(f) || f === 0) return x;
  const scaled = Number((x * f).toPrecision(15)); // 去掉乘法引入的 1 ulp 毛刺（2.675*100 = 267.49999999999997）
  if (!Number.isFinite(scaled)) return x;
  const r = Math.sign(scaled) * Math.round(Math.abs(scaled));
  return r / f;
}

/** mathjs 语义的 mod：结果符号跟随除数（mod(8,-3) = -1） */
function modFn(a: number, b: number): number {
  if (b === 0) return NaN;
  return ((a % b) + b) % b;
}

function combinationsFn(n: number, k: number): number {
  if (!Number.isInteger(n) || !Number.isInteger(k) || n < 0 || k < 0) return NaN;
  if (k > n) return 0;
  const kk = Math.min(k, n - k);
  let res = 1;
  for (let i = 1; i <= kk; i++) res = (res * (n - kk + i)) / i;
  return roundHalfAway(res, 0);
}

function permutationsFn(n: number, k: number): number {
  if (!Number.isInteger(n) || !Number.isInteger(k) || n < 0 || k < 0) return NaN;
  if (k > n) return 0;
  let res = 1;
  for (let i = 0; i < k; i++) res *= n - i;
  return res;
}

function gcd2(a: number, b: number): number {
  let x = Math.abs(Math.trunc(a));
  let y = Math.abs(Math.trunc(b));
  while (y) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

function gcdMany(list: number[]): number {
  return list.reduce((acc, v) => gcd2(acc, v), 0);
}

function lcm2(a: number, b: number): number {
  const g = gcd2(a, b);
  if (g === 0) return 0;
  return Math.abs(Math.trunc(a) * Math.trunc(b)) / g;
}

function lcmMany(list: number[]): number {
  return list.reduce((acc, v) => lcm2(acc, v), 1);
}

function medianOf(nums: number[]): number {
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  if (s.length % 2 === 1) return s[mid];
  return (s[mid - 1] + s[mid]) / 2;
}

function modeOf(nums: number[]): number {
  const count = new Map<number, number>();
  let best = nums[0];
  let bestCount = 0;
  for (const n of nums) {
    const c = (count.get(n) ?? 0) + 1;
    count.set(n, c);
    if (c > bestCount) {
      bestCount = c;
      best = n;
    }
  }
  return best;
}

function varianceOf(nums: number[], unbiased = false): number {
  const n = nums.length;
  if (n === 0) return NaN;
  const mean = nums.reduce((a, b) => a + b, 0) / n;
  const sum = nums.reduce((a, b) => a + (b - mean) * (b - mean), 0);
  return sum / (unbiased ? Math.max(1, n - 1) : n);
}

/* ---------------------------- 求值 ---------------------------- */

interface EvalContext {
  angle: AngleMode;
  /** 上一次「=」的完整精度结果（表达式里的 Ans） */
  ans?: number;
  /** 记忆体（表达式里的 M） */
  memory?: number;
  hasMemory?: boolean;
}

/** 与角度单位相关的三角/反三角函数（输入按当前单位换算成弧度） */
const ANGLE_FN: Record<string, (rad: number) => number> = {
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  sec: (x) => 1 / Math.cos(x),
  csc: (x) => 1 / Math.sin(x),
  cot: (x) => 1 / Math.tan(x),
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  asec: (x) => Math.acos(1 / x),
  acsc: (x) => Math.asin(1 / x),
  acot: (x) => Math.atan(1 / x),
};

const ANGLE_OUT = new Set(["asin", "acos", "atan", "asec", "acsc", "acot"]);

/** 与角度无关的一元函数 */
const PLAIN_FN: Record<string, (x: number) => number> = {
  sinh: Math.sinh,
  cosh: Math.cosh,
  tanh: Math.tanh,
  sech: (x) => 1 / Math.cosh(x),
  csch: (x) => 1 / Math.sinh(x),
  coth: (x) => 1 / Math.tanh(x),
  asinh: Math.asinh,
  acosh: Math.acosh,
  atanh: Math.atanh,
  asech: (x) => Math.acosh(1 / x),
  acsch: (x) => Math.asinh(1 / x),
  acoth: (x) => Math.atanh(1 / x),
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  square: (x) => x * x,
  cube: (x) => x * x * x,
  exp: Math.exp,
  expm1: Math.expm1,
  log2: Math.log2,
  log10: Math.log10,
  log1p: Math.log1p,
  abs: Math.abs,
  sign: Math.sign,
  floor: Math.floor,
  ceil: Math.ceil,
  fix: Math.trunc,
  trunc: Math.trunc,
  gamma: gammaFn,
  lgamma: (x) => Math.log(Math.abs(gammaFn(x))),
  deg: (x) => (x * 180) / Math.PI,
  rad: (x) => (x * Math.PI) / 180,
  toDeg: (x) => (x * 180) / Math.PI,
  toRad: (x) => (x * Math.PI) / 180,
};

/** 函数名集合（用于「这是函数，后面要跟括号」的友好提示） */
const FUNCTION_NAMES = new Set<string>([
  ...Object.keys(ANGLE_FN),
  ...Object.keys(PLAIN_FN),
  "ln",
  "log",
  "pow",
  "nthRoot",
  "hypot",
  "atan2",
  "round",
  "mod",
  "factorial",
  "combinations",
  "permutations",
  "combinationsWithRep",
  "multinomial",
  "gcd",
  "lcm",
  "random",
  "randomInt",
  "pickRandom",
  "sum",
  "mean",
  "median",
  "mode",
  "prod",
  "min",
  "max",
  "count",
  "std",
  "variance",
  "mad",
  "cumsum",
  "bin",
  "hex",
  "oct",
  "format",
  "toFraction",
  "rmb",
  "bitAnd",
  "bitOr",
  "bitXor",
  "bitNot",
  "leftShift",
  "rightArithShift",
  "rightLogShift",
  "and",
  "or",
  "xor",
  "not",
]);

function numArg(v: CalcValue, fname: string, index: number): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") throw new CalcError(`${fname}() 需要数字参数，不能是 true/false`, index);
  if (typeof v === "string") throw new CalcError(`${fname}() 需要数字参数，不能是文字`, index);
  throw new CalcError(`${fname}() 需要单个数字参数，不能是数组`, index);
}

function numArgs(values: CalcValue[], fname: string, index: number): number[] {
  return values.map((v) => numArg(v, fname, index));
}

/** 统计类函数：既接受 mean(1,2,3)，也接受 mean([1,2,3]) */
function flatNumbers(values: CalcValue[], fname: string, index: number): number[] {
  const out: number[] = [];
  for (const v of values) {
    if (typeof v === "number") out.push(v);
    else if (Array.isArray(v)) out.push(...v);
    else throw new CalcError(`${fname}() 需要数字或数字数组`, index);
  }
  if (out.length === 0) throw new CalcError(`${fname}() 至少需要一个数字`, index);
  return out;
}

function intOf(v: number, fname: string, index: number): number {
  if (!Number.isInteger(v)) throw new CalcError(`${fname}() 只支持整数`, index);
  return v;
}

function toInt32(x: number): number {
  if (!Number.isFinite(x)) return 0;
  return x | 0; // JS 的 32 位有符号截断，与 mathjs 的按位运算一致
}

function requireArgs(values: CalcValue[], fname: string, index: number, min: number, max: number): void {
  if (values.length < min || values.length > max) {
    const expect = min === max ? `${min} 个` : `${min} ~ ${max} 个`;
    throw new CalcError(`${fname}() 需要 ${expect}参数，现在给了 ${values.length} 个`, index);
  }
}

function callFunction(name: string, values: CalcValue[], ctx: EvalContext, index: number): CalcValue {
  const fn = name.startsWith("math.") ? name.slice(5) : name;

  // ---- 与角度单位相关 ----
  if (fn in ANGLE_FN) {
    requireArgs(values, fn, index, 1, 1);
    const raw = numArg(values[0], fn, index);
    const x = ANGLE_OUT.has(fn) ? raw : toRad(raw, ctx.angle);
    const out = ANGLE_FN[fn](x);
    if (Number.isNaN(out)) {
      throw new CalcError(`${fn}(${formatNumber(raw)}) 超出了定义域`, index, "反三角函数的输入要在 -1 ~ 1 之间");
    }
    return ANGLE_OUT.has(fn) ? fromRad(out, ctx.angle) : out;
  }

  // ---- 其他一元函数 ----
  if (fn in PLAIN_FN) {
    requireArgs(values, fn, index, 1, 1);
    return PLAIN_FN[fn](numArg(values[0], fn, index));
  }

  switch (fn) {
    case "ln":
      requireArgs(values, "ln", index, 1, 1);
      return Math.log(numArg(values[0], "ln", index));
    case "log": {
      // log(x) 是常用对数（与键盘上的 log 键一致），log(x, b) 是对数换底
      requireArgs(values, "log", index, 1, 2);
      const x = numArg(values[0], "log", index);
      if (values.length === 1) return Math.log10(x);
      return Math.log(x) / Math.log(numArg(values[1], "log", index));
    }
    case "pow":
      requireArgs(values, "pow", index, 2, 2);
      return Math.pow(numArg(values[0], "pow", index), numArg(values[1], "pow", index));
    case "nthRoot": {
      requireArgs(values, "nthRoot", index, 1, 2);
      const x = numArg(values[0], "nthRoot", index);
      const n = values.length === 2 ? numArg(values[1], "nthRoot", index) : 2;
      if (n === 0) return NaN;
      if (x < 0 && Number.isInteger(n) && n % 2 === 1) return -Math.pow(-x, 1 / n);
      return Math.pow(x, 1 / n);
    }
    case "hypot": {
      requireArgs(values, "hypot", index, 1, 64);
      return Math.hypot(...numArgs(values, "hypot", index));
    }
    case "atan2": {
      requireArgs(values, "atan2", index, 2, 2);
      const y = numArg(values[0], "atan2", index);
      const x = numArg(values[1], "atan2", index);
      // 与其它反三角函数一致：输入按当前角度单位解释，输出也按当前单位
      return fromRad(Math.atan2(toRad(y, ctx.angle), toRad(x, ctx.angle)), ctx.angle);
    }
    case "round": {
      requireArgs(values, "round", index, 1, 2);
      const x = numArg(values[0], "round", index);
      const d = values.length === 2 ? intOf(numArg(values[1], "round", index), "round", index) : 0;
      return roundHalfAway(x, d);
    }
    case "mod":
      requireArgs(values, "mod", index, 2, 2);
      return modFn(numArg(values[0], "mod", index), numArg(values[1], "mod", index));
    case "factorial": {
      requireArgs(values, "factorial", index, 1, 1);
      const n = numArg(values[0], "factorial", index);
      if (!Number.isInteger(n) || n < 0) {
        throw new CalcError("阶乘只支持非负整数", index, "非整数的阶乘请用 gamma(x + 1)");
      }
      return factorialFn(n);
    }
    case "combinations":
      requireArgs(values, "combinations", index, 2, 2);
      return combinationsFn(
        intOf(numArg(values[0], "combinations", index), "combinations", index),
        intOf(numArg(values[1], "combinations", index), "combinations", index)
      );
    case "permutations": {
      requireArgs(values, "permutations", index, 1, 2);
      const n = intOf(numArg(values[0], "permutations", index), "permutations", index);
      const k = values.length === 2 ? intOf(numArg(values[1], "permutations", index), "permutations", index) : n;
      return permutationsFn(n, k);
    }
    case "combinationsWithRep": {
      requireArgs(values, "combinationsWithRep", index, 2, 2);
      const n = intOf(numArg(values[0], "combinationsWithRep", index), "combinationsWithRep", index);
      const k = intOf(numArg(values[1], "combinationsWithRep", index), "combinationsWithRep", index);
      return combinationsFn(n + k - 1, k);
    }
    case "multinomial": {
      const nums = flatNumbers(values, "multinomial", index).map((v) => intOf(v, "multinomial", index));
      const total = nums.reduce((a, b) => a + b, 0);
      let res = factorialFn(total);
      for (const v of nums) res /= factorialFn(v);
      return roundHalfAway(res, 0);
    }
    case "gcd": {
      const nums = flatNumbers(values, "gcd", index).map((v) => intOf(v, "gcd", index));
      return gcdMany(nums);
    }
    case "lcm": {
      const nums = flatNumbers(values, "lcm", index).map((v) => intOf(v, "lcm", index));
      return lcmMany(nums);
    }
    case "random": {
      requireArgs(values, "random", index, 0, 2);
      if (values.length === 0) return Math.random();
      const a = numArg(values[0], "random", index);
      const b = values.length === 2 ? numArg(values[1], "random", index) : 0;
      const lo = Math.min(a, values.length === 2 ? b : 0);
      const hi = Math.max(a, values.length === 2 ? b : 1);
      return lo + Math.random() * (hi - lo);
    }
    case "randomInt": {
      requireArgs(values, "randomInt", index, 0, 2);
      const lo = values.length === 0 ? 0 : intOf(numArg(values[0], "randomInt", index), "randomInt", index);
      const hi = values.length <= 1 ? 1 : intOf(numArg(values[1], "randomInt", index), "randomInt", index);
      const min = Math.min(lo, hi);
      const max = Math.max(lo, hi);
      return min + Math.floor(Math.random() * (max - min + 1)); // mathjs：含两端
    }
    case "pickRandom": {
      requireArgs(values, "pickRandom", index, 1, 1);
      const arr = values[0];
      if (!Array.isArray(arr) || arr.length === 0) {
        throw new CalcError("pickRandom() 需要一个非空数组", index, "例如 pickRandom([1, 2, 3])");
      }
      return arr[Math.floor(Math.random() * arr.length)];
    }
    case "sum":
      return flatNumbers(values, "sum", index).reduce((a, b) => a + b, 0);
    case "prod":
      return flatNumbers(values, "prod", index).reduce((a, b) => a * b, 1);
    case "mean": {
      const nums = flatNumbers(values, "mean", index);
      return nums.reduce((a, b) => a + b, 0) / nums.length;
    }
    case "median":
      return medianOf(flatNumbers(values, "median", index));
    case "mode":
      return modeOf(flatNumbers(values, "mode", index));
    case "min":
      return Math.min(...flatNumbers(values, "min", index));
    case "max":
      return Math.max(...flatNumbers(values, "max", index));
    case "count":
      return flatNumbers(values, "count", index).length;
    case "std":
      return Math.sqrt(varianceOf(flatNumbers(values, "std", index)));
    case "variance":
      return varianceOf(flatNumbers(values, "variance", index));
    case "mad": {
      const nums = flatNumbers(values, "mad", index);
      const med = medianOf(nums);
      return medianOf(nums.map((v) => Math.abs(v - med)));
    }
    case "cumsum": {
      const nums = flatNumbers(values, "cumsum", index);
      let acc = 0;
      return nums.map((v) => (acc += v));
    }
    case "bin": {
      requireArgs(values, "bin", index, 1, 1);
      const x = intOf(numArg(values[0], "bin", index), "bin", index);
      return (x < 0 ? "-" : "") + "0b" + Math.abs(x).toString(2);
    }
    case "hex": {
      requireArgs(values, "hex", index, 1, 1);
      const x = intOf(numArg(values[0], "hex", index), "hex", index);
      return (x < 0 ? "-" : "") + "0x" + Math.abs(x).toString(16);
    }
    case "oct": {
      requireArgs(values, "oct", index, 1, 1);
      const x = intOf(numArg(values[0], "oct", index), "oct", index);
      return (x < 0 ? "-" : "") + "0o" + Math.abs(x).toString(8);
    }
    case "format": {
      requireArgs(values, "format", index, 1, 2);
      const x = numArg(values[0], "format", index);
      const d = values.length === 2 ? intOf(numArg(values[1], "format", index), "format", index) : DISPLAY_SIG_DIGITS;
      if (d <= 0 || d > 17) throw new CalcError("format() 的有效位数要在 1 ~ 17 之间", index);
      return formatNumber(x, d);
    }
    case "toFraction": {
      requireArgs(values, "toFraction", index, 1, 1);
      const f = toFractionString(numArg(values[0], "toFraction", index));
      if (!f) throw new CalcError("这个数没法用简单分数表示", index);
      return f;
    }
    case "rmb": {
      requireArgs(values, "rmb", index, 1, 1);
      const s = numberToRmb(numArg(values[0], "rmb", index));
      if (!s) throw new CalcError("金额超出可转换范围（最大 9999.99 亿）", index);
      return s;
    }
    case "bitAnd":
      requireArgs(values, "bitAnd", index, 2, 2);
      return toInt32(numArg(values[0], fn, index)) & toInt32(numArg(values[1], fn, index));
    case "bitOr":
      requireArgs(values, "bitOr", index, 2, 2);
      return toInt32(numArg(values[0], fn, index)) | toInt32(numArg(values[1], fn, index));
    case "bitXor":
      requireArgs(values, "bitXor", index, 2, 2);
      return toInt32(numArg(values[0], fn, index)) ^ toInt32(numArg(values[1], fn, index));
    case "bitNot":
      requireArgs(values, "bitNot", index, 1, 1);
      return ~toInt32(numArg(values[0], fn, index));
    case "leftShift":
      requireArgs(values, "leftShift", index, 2, 2);
      return toInt32(numArg(values[0], fn, index)) << toInt32(numArg(values[1], fn, index));
    case "rightArithShift":
      requireArgs(values, "rightArithShift", index, 2, 2);
      return toInt32(numArg(values[0], fn, index)) >> toInt32(numArg(values[1], fn, index));
    case "rightLogShift":
      requireArgs(values, "rightLogShift", index, 2, 2);
      return toInt32(numArg(values[0], fn, index)) >>> toInt32(numArg(values[1], fn, index));
    case "and":
    case "or":
    case "xor":
    case "not": {
      const needs = fn === "not" ? 1 : 2;
      requireArgs(values, fn, index, needs, needs);
      const bools = values.map((v) => {
        if (typeof v !== "boolean") throw new CalcError(`${fn}() 只能用于 true / false`, index);
        return v;
      });
      if (fn === "not") return !bools[0];
      if (fn === "and") return bools[0] && bools[1];
      if (fn === "or") return bools[0] || bools[1];
      return bools[0] !== bools[1];
    }
    default:
      throw new CalcError(`不认识的函数「${fn}」`, index, "右侧「函数」面板里有全部可用函数，点一下即可插入");
  }
}

function evalNode(node: Node, ctx: EvalContext): CalcValue {
  switch (node.t) {
    case "num":
      return node.v;
    case "array":
      return node.items.map((n) => numArg(evalNode(n, ctx), "数组", node.index));
    case "name": {
      const name = node.name.startsWith("math.") ? node.name.slice(5) : node.name;
      if (name === "Ans" || name === "ans" || name === "ANS") {
        if (ctx.ans === undefined) {
          throw new CalcError("还没有可用的「Ans」（上次结果）", node.index, "先算一次按 = ，之后就能用 Ans 继续算");
        }
        return ctx.ans;
      }
      if (name === "M") {
        if (!ctx.hasMemory) {
          throw new CalcError("记忆体里还没有值", node.index, "先按 MS 或 M+ 存一个数，再用 M 参与计算");
        }
        return ctx.memory ?? 0;
      }
      if (name === "true") return true;
      if (name === "false") return false;
      if (Object.prototype.hasOwnProperty.call(MATH_CONSTANTS, name)) return MATH_CONSTANTS[name];
      if (FUNCTION_NAMES.has(name)) {
        throw new CalcError(`「${name}」是函数，后面要跟一对括号`, node.index, `例如 ${name}(2)`);
      }
      throw new CalcError(`不认识的名称「${name}」`, node.index, "右侧「函数」面板可以查到全部可用的函数与常数");
    }
    case "unary": {
      const v = evalNode(node.a, ctx);
      if (node.op === "not") {
        if (typeof v !== "boolean") throw new CalcError("not 只能用于 true / false", node.index);
        return !v;
      }
      const x = numArg(v, node.op === "~" ? "~" : "一元运算符", node.index);
      if (node.op === "-") return -x;
      if (node.op === "+") return x;
      return ~toInt32(x);
    }
    case "postfix": {
      const v = evalNode(node.a, ctx);
      const x = numArg(v, node.op === "!" ? "阶乘" : "百分比", node.index);
      if (node.op === "!") {
        if (!Number.isInteger(x) || x < 0) {
          throw new CalcError("阶乘只支持非负整数", node.index, "非整数的阶乘请用 gamma(x + 1)");
        }
        return factorialFn(x);
      }
      if (node.op === "%") return x / 100;
      return degreesToMode(x, ctx.angle); // °
    }
    case "cond": {
      const c = evalNode(node.c, ctx);
      if (typeof c !== "boolean") throw new CalcError("条件表达式的判断部分要是 true / false", node.index);
      return c ? evalNode(node.a, ctx) : evalNode(node.b, ctx);
    }
    case "call":
      return callFunction(node.name, node.args.map((a) => evalNode(a, ctx)), ctx, node.index);
    case "binary": {
      // 百分比加法/减法：100 + 3% = 103、100 - 3% = 97（与 math.js 一致，符合「加三个点」的直觉）
      if ((node.op === "+" || node.op === "-") && node.b.t === "postfix" && node.b.op === "%") {
        const left = numArg(evalNode(node.a, ctx), node.op, node.index);
        const right = numArg(evalNode(node.b.a, ctx), node.op, node.b.index);
        return node.op === "+" ? left + (left * right) / 100 : left - (left * right) / 100;
      }
      const a = evalNode(node.a, ctx);
      const b = evalNode(node.b, ctx);
      if (node.op === "&" || node.op === "|" || node.op === "<<" || node.op === ">>" || node.op === ">>>") {
        const x = toInt32(numArg(a, node.op, node.index));
        const y = toInt32(numArg(b, node.op, node.index));
        if (node.op === "&") return x & y;
        if (node.op === "|") return x | y;
        if (node.op === "<<") return x << y;
        if (node.op === ">>") return x >> y;
        return x >>> y;
      }
      if (node.op === "and" || node.op === "or" || node.op === "xor") {
        if (typeof a !== "boolean" || typeof b !== "boolean") {
          throw new CalcError(`${node.op} 只能用于 true / false`, node.index);
        }
        if (node.op === "and") return a && b;
        if (node.op === "or") return a || b;
        return a !== b;
      }
      if (node.op === "==" || node.op === "!=" || node.op === "<" || node.op === ">" || node.op === "<=" || node.op === ">=") {
        const sa = formatValue(a);
        const sb = formatValue(b);
        if (typeof a !== typeof b) {
          if (node.op === "==") return false;
          if (node.op === "!=") return true;
          throw new CalcError("不同类型不能比较大小", node.index);
        }
        if (typeof a === "string" && typeof b === "string") {
          if (node.op === "==") return a === b;
          if (node.op === "!=") return a !== b;
          return node.op === "<" ? sa < sb : node.op === ">" ? sa > sb : node.op === "<=" ? sa <= sb : sa >= sb;
        }
        const x = numArg(a, "比较", node.index);
        const y = numArg(b, "比较", node.index);
        if (node.op === "==") return x === y;
        if (node.op === "!=") return x !== y;
        if (node.op === "<") return x < y;
        if (node.op === ">") return x > y;
        if (node.op === "<=") return x <= y;
        return x >= y;
      }
      const x = numArg(a, node.op, node.index);
      const y = numArg(b, node.op, node.index);
      switch (node.op) {
        case "+":
          return x + y;
        case "-":
          return x - y;
        case "*":
          return x * y;
        case "/":
          return x / y;
        case "^":
          return Math.pow(x, y);
        case "mod":
          return modFn(x, y);
        default:
          throw new CalcError(`不支持的运算符「${node.op}」`, node.index);
      }
    }
    default:
      throw new CalcError("算式解析出错", 0);
  }
}

/** 求值入口：出错一律抛 CalcError（带 index，供界面定位） */
function evaluateExpression(src: string, ctx: EvalContext): CalcValue {
  const normalized = normalizeExpression(src);
  if (normalized.trim() === "") throw new CalcError("还没有输入算式", 0);
  const tokens = tokenize(normalized);
  const ast = new Parser(tokens).parse();
  return evalNode(ast, ctx);
}

/* ------------------ 程序员模式：BigInt 位运算核心 ------------------ */

type BitLength = 8 | 16 | 32 | 64;

function bigMask(bits: BitLength | number): bigint {
  return (BigInt(1) << BigInt(bits)) - BigInt(1);
}

/** 按位宽截断（无符号语义存储） */
function bigClamp(v: bigint, bits: BitLength | number): bigint {
  const m = bigMask(bits);
  return ((v % (m + BigInt(1))) + (m + BigInt(1))) % (m + BigInt(1));
}

/** 把「无符号存储值」解释成有符号值（补码） */
function bigAsSigned(v: bigint, bits: BitLength | number): bigint {
  const clamped = bigClamp(v, bits);
  const signBit = BigInt(1) << BigInt(bits - 1);
  if ((clamped & signBit) !== BigInt(0)) return clamped - (bigMask(bits) + BigInt(1));
  return clamped;
}

/** 把有符号值写回「无符号存储值」 */
function bigFromSigned(v: bigint, bits: BitLength | number): bigint {
  return bigClamp(v, bits);
}

/** 算术右移：负数按补码符号位填充（-8 >> 1 = -4） */
function bigShiftRight(v: bigint, bits: BitLength | number, n: bigint, signed: boolean): bigint {
  const shift = n < BigInt(0) ? BigInt(0) : n;
  if (signed) return bigFromSigned(bigAsSigned(v, bits) >> shift, bits);
  return bigClamp(bigClamp(v, bits) >> shift, bits);
}

/** 逻辑右移：高位一律补 0（无符号语义） */
function bigShiftRightLogical(v: bigint, bits: BitLength | number, n: bigint): bigint {
  const shift = n < BigInt(0) ? BigInt(0) : n;
  if (shift >= BigInt(bits)) return BigInt(0);
  return bigClamp(bigClamp(v, bits) >> shift, bits);
}

/** 左移：超出位宽的高位丢弃（溢出回绕） */
function bigShiftLeft(v: bigint, bits: BitLength | number, n: bigint): bigint {
  const shift = n < BigInt(0) ? BigInt(0) : n;
  return bigClamp(bigClamp(v, bits) << shift, bits);
}

/** 循环左移 */
function bigRotateLeft(v: bigint, bits: BitLength | number, n: bigint): bigint {
  const width = BigInt(bits);
  const shift = ((n % width) + width) % width;
  if (shift === BigInt(0)) return bigClamp(v, bits);
  const x = bigClamp(v, bits);
  return bigClamp((x << shift) | (x >> (width - shift)), bits);
}

/** 循环右移 */
function bigRotateRight(v: bigint, bits: BitLength | number, n: bigint): bigint {
  const width = BigInt(bits);
  const shift = ((n % width) + width) % width;
  if (shift === BigInt(0)) return bigClamp(v, bits);
  const x = bigClamp(v, bits);
  return bigClamp((x >> shift) | (x << (width - shift)), bits);
}

/** 按当前进制把字符串解析成 BigInt（不用 Number 中转，64 位不丢精度） */
function parseBigInRadix(text: string, radix: number): bigint {
  const negative = text.startsWith("-");
  const digits = (negative ? text.slice(1) : text) || "0";
  let value: bigint;
  if (radix === 16) value = BigInt(`0x${digits}`);
  else if (radix === 2) value = BigInt(`0b${digits}`);
  else if (radix === 8) value = BigInt(`0o${digits}`);
  else value = BigInt(digits);
  return negative ? -value : value;
}

/* ==================== ENGINE END ==================== */

/* ------------------------- 工具需要的静态数据 ------------------------- */

type CalcMode = "scientific" | "programmer" | "standard";
type RadixMode = "HEX" | "DEC" | "OCT" | "BIN";
type ProgBitOp = "AND" | "OR" | "XOR";

interface HistoryItem {
  id: string;
  expr: string;
  result: string;
  time: string;
  mode: CalcMode;
  angle: AngleMode;
}

const RADIX_OF: Record<RadixMode, number> = { HEX: 16, DEC: 10, OCT: 8, BIN: 2 };

const CONSTANT_REFERENCE: Array<{ insert: string; label: string; desc: string }> = [
  { insert: "π", label: "π 圆周率", desc: "3.141592653589793" },
  { insert: "e", label: "e 自然常数", desc: "2.718281828459045" },
  { insert: "τ", label: "τ 圆周常数", desc: "2π = 6.283185307179586" },
  { insert: "φ", label: "φ 黄金分割比", desc: "(1+√5)/2 = 1.618033988749895" },
  { insert: "LN2", label: "LN2", desc: "2 的自然对数" },
  { insert: "LN10", label: "LN10", desc: "10 的自然对数" },
  { insert: "LOG2E", label: "LOG2E", desc: "e 的以 2 为底对数" },
  { insert: "LOG10E", label: "LOG10E", desc: "e 的以 10 为底对数" },
  { insert: "SQRT2", label: "SQRT2", desc: "√2" },
  { insert: "SQRT1_2", label: "SQRT1_2", desc: "√(1/2)" },
  { insert: "Infinity", label: "Infinity 无穷大", desc: "浮点数上溢的值" },
  { insert: "c", label: "c 真空光速", desc: "299792458 m/s" },
  { insert: "h", label: "h 普朗克常数", desc: "6.62607015e-34 J·s" },
  { insert: "G", label: "G 引力常数", desc: "6.6743e-11 m³/(kg·s²)" },
  { insert: "g", label: "g 重力加速度", desc: "9.80665 m/s²" },
  { insert: "NA", label: "NA 阿伏伽德罗常数", desc: "6.02214076e23 mol⁻¹" },
  { insert: "Ans", label: "Ans 上次结果", desc: "上一次按 = 的完整精度结果" },
  { insert: "M", label: "M 记忆体", desc: "MS / M+ / M- 存进去的值" },
];

const FUNCTION_REFERENCE: Array<{ insert: string; label: string; group: string }> = [
  { insert: "sin(", label: "sin 正弦", group: "三角与反三角" },
  { insert: "cos(", label: "cos 余弦", group: "三角与反三角" },
  { insert: "tan(", label: "tan 正切", group: "三角与反三角" },
  { insert: "sec(", label: "sec 正割", group: "三角与反三角" },
  { insert: "csc(", label: "csc 余割", group: "三角与反三角" },
  { insert: "cot(", label: "cot 余切", group: "三角与反三角" },
  { insert: "asin(", label: "asin 反正弦", group: "三角与反三角" },
  { insert: "acos(", label: "acos 反余弦", group: "三角与反三角" },
  { insert: "atan(", label: "atan 反正切", group: "三角与反三角" },
  { insert: "asec(", label: "asec 反正割", group: "三角与反三角" },
  { insert: "acsc(", label: "acsc 反余割", group: "三角与反三角" },
  { insert: "acot(", label: "acot 反余切", group: "三角与反三角" },
  { insert: "atan2(y, x)", label: "atan2 双参数反正切", group: "三角与反三角" },
  { insert: "sinh(", label: "sinh 双曲正弦", group: "双曲函数" },
  { insert: "cosh(", label: "cosh 双曲余弦", group: "双曲函数" },
  { insert: "tanh(", label: "tanh 双曲正切", group: "双曲函数" },
  { insert: "sech(", label: "sech 双曲正割", group: "双曲函数" },
  { insert: "csch(", label: "csch 双曲余割", group: "双曲函数" },
  { insert: "coth(", label: "coth 双曲余切", group: "双曲函数" },
  { insert: "asinh(", label: "asinh 反双曲正弦", group: "双曲函数" },
  { insert: "acosh(", label: "acosh 反双曲余弦", group: "双曲函数" },
  { insert: "atanh(", label: "atanh 反双曲正切", group: "双曲函数" },
  { insert: "sqrt(", label: "sqrt 平方根", group: "幂与根" },
  { insert: "cbrt(", label: "cbrt 立方根", group: "幂与根" },
  { insert: "nthRoot(x, n)", label: "nthRoot n 次方根", group: "幂与根" },
  { insert: "pow(x, y)", label: "pow 幂（等同于 x^y）", group: "幂与根" },
  { insert: "square(", label: "square 平方", group: "幂与根" },
  { insert: "cube(", label: "cube 立方", group: "幂与根" },
  { insert: "hypot(", label: "hypot 斜边 √(a²+b²+…)", group: "幂与根" },
  { insert: "abs(", label: "abs 绝对值", group: "幂与根" },
  { insert: "ln(", label: "ln 自然对数", group: "对数与指数" },
  { insert: "log(", label: "log 常用对数（10 为底）", group: "对数与指数" },
  { insert: "log(x, b)", label: "log(x, b) 以 b 为底的对数", group: "对数与指数" },
  { insert: "log2(", label: "log2 以 2 为底", group: "对数与指数" },
  { insert: "log10(", label: "log10 以 10 为底", group: "对数与指数" },
  { insert: "log1p(", label: "log1p ln(1+x)，小数值更精确", group: "对数与指数" },
  { insert: "exp(", label: "exp e 的 x 次方", group: "对数与指数" },
  { insert: "expm1(", label: "expm1 e^x - 1，小数值更精确", group: "对数与指数" },
  { insert: "round(x, n)", label: "round 四舍五入（远离零）", group: "取整与符号" },
  { insert: "floor(", label: "floor 向下取整", group: "取整与符号" },
  { insert: "ceil(", label: "ceil 向上取整", group: "取整与符号" },
  { insert: "fix(", label: "fix 向零取整", group: "取整与符号" },
  { insert: "sign(", label: "sign 符号（-1 / 0 / 1）", group: "取整与符号" },
  { insert: "mod(x, y)", label: "mod 求余（符号跟随除数）", group: "取整与符号" },
  { insert: "factorial(", label: "factorial 阶乘（也可写 5!）", group: "阶乘与组合" },
  { insert: "gamma(", label: "gamma Γ 函数", group: "阶乘与组合" },
  { insert: "lgamma(", label: "lgamma ln|Γ(x)|", group: "阶乘与组合" },
  { insert: "combinations(n, k)", label: "combinations 组合数 C(n,k)", group: "阶乘与组合" },
  { insert: "permutations(n, k)", label: "permutations 排列数 P(n,k)", group: "阶乘与组合" },
  { insert: "combinationsWithRep(n, k)", label: "combinationsWithRep 可重复组合", group: "阶乘与组合" },
  { insert: "multinomial(", label: "multinomial 多项式系数", group: "阶乘与组合" },
  { insert: "gcd(", label: "gcd 最大公约数", group: "数论" },
  { insert: "lcm(", label: "lcm 最小公倍数", group: "数论" },
  { insert: "sum(", label: "sum 求和", group: "统计" },
  { insert: "mean(", label: "mean 平均值", group: "统计" },
  { insert: "median(", label: "median 中位数", group: "统计" },
  { insert: "mode(", label: "mode 众数", group: "统计" },
  { insert: "min(", label: "min 最小值", group: "统计" },
  { insert: "max(", label: "max 最大值", group: "统计" },
  { insert: "prod(", label: "prod 连乘", group: "统计" },
  { insert: "count(", label: "count 元素个数", group: "统计" },
  { insert: "std(", label: "std 标准差（总体）", group: "统计" },
  { insert: "variance(", label: "variance 方差（总体）", group: "统计" },
  { insert: "mad(", label: "mad 绝对偏差中位数", group: "统计" },
  { insert: "cumsum(", label: "cumsum 累计和", group: "统计" },
  { insert: "random()", label: "random 0~1 随机数", group: "随机" },
  { insert: "randomInt(1, 100)", label: "randomInt 区间随机整数", group: "随机" },
  { insert: "pickRandom([1, 2, 3])", label: "pickRandom 数组里随机取一个", group: "随机" },
  { insert: "bin(", label: "bin 转二进制文本", group: "进制与格式化" },
  { insert: "oct(", label: "oct 转八进制文本", group: "进制与格式化" },
  { insert: "hex(", label: "hex 转十六进制文本", group: "进制与格式化" },
  { insert: "format(x, n)", label: "format 保留 n 位有效数字", group: "进制与格式化" },
  { insert: "toFraction(", label: "toFraction 转分数文本", group: "进制与格式化" },
  { insert: "rmb(", label: "rmb 转人民币大写", group: "进制与格式化" },
  { insert: "bitAnd(", label: "bitAnd 按位与（也可写 &）", group: "位运算" },
  { insert: "bitOr(", label: "bitOr 按位或（也可写 |）", group: "位运算" },
  { insert: "bitXor(", label: "bitXor 按位异或", group: "位运算" },
  { insert: "bitNot(", label: "bitNot 按位取反（也可写 ~）", group: "位运算" },
  { insert: "leftShift(x, n)", label: "leftShift 左移（也可写 <<）", group: "位运算" },
  { insert: "rightArithShift(x, n)", label: "rightArithShift 算术右移（>>）", group: "位运算" },
  { insert: "rightLogShift(x, n)", label: "rightLogShift 逻辑右移（>>>）", group: "位运算" },
  { insert: "and", label: "and 逻辑与（true/false）", group: "逻辑与比较" },
  { insert: "or", label: "or 逻辑或", group: "逻辑与比较" },
  { insert: "xor", label: "xor 逻辑异或", group: "逻辑与比较" },
  { insert: "not ", label: "not 逻辑非", group: "逻辑与比较" },
  { insert: "1 < 2", label: "比较：< > <= >= == !=", group: "逻辑与比较" },
  { insert: "a ? b : c", label: "条件表达式（把 a 换成判断）", group: "逻辑与比较" },
];

const EXAMPLES: Record<CalcMode, string> = {
  scientific: "sin(30) + log(1000) + 2^10",
  programmer: "0xFF & 0x0F",
  standard: "100 + 3% - 20%",
};

/* ==================== 组件 ==================== */

const DRAFT_KEY = "simple-calculator";
const LEGACY_HISTORY_KEY = "furina:calc_history";
const EXPR_INPUT_ID = "fk-calc-expression";

/** 表达式输入框（用 id 取，避免给 primitives 的 Input 传 ref 时的类型问题） */
function exprInput(): HTMLInputElement | null {
  if (typeof document === "undefined") return null;
  return document.getElementById(EXPR_INPUT_ID) as HTMLInputElement | null;
}

export function AdvancedCalculatorTool() {
  const { toast } = useToast();

  const [calcMode, setCalcMode] = useToolDraft<CalcMode>(DRAFT_KEY, "calcMode", "scientific");
  const [angleMode, setAngleMode] = useToolDraft<AngleMode>(DRAFT_KEY, "angleMode", "DEG");
  const [expression, setExpression] = useToolDraft<string>(DRAFT_KEY, "expression", "");
  const [history, setHistory] = useToolDraft<HistoryItem[]>(DRAFT_KEY, "history", []);
  const [sidePanel, setSidePanel] = useToolDraft<"history" | "constants" | "functions" | "none">(
    DRAFT_KEY,
    "sidePanel",
    "history"
  );
  const [bitLength, setBitLength] = useToolDraft<number>(DRAFT_KEY, "bitLength", 64);
  const [isSigned, setIsSigned] = useToolDraft<boolean>(DRAFT_KEY, "isSigned", true);
  const [memory, setMemory] = useToolDraft<number>(DRAFT_KEY, "memory", 0);
  const [progText, setProgText] = useToolDraft<string>(DRAFT_KEY, "progValue", "0");
  const [progRadix, setProgRadix] = useToolDraft<RadixMode>(DRAFT_KEY, "progRadix", "DEC");
  const [showBits, setShowBits] = useToolDraft<boolean>(DRAFT_KEY, "showBits", true);

  // 非持久化的临时状态
  const [is2nd, setIs2nd] = useState(false);
  const [isHyp, setIsHyp] = useState(false);
  const [fullPrecision, setFullPrecision] = useState(false);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [ansValue, setAnsValue] = useState<number | undefined>(undefined);
  const [justEvaluated, setJustEvaluated] = useState(false);
  const [lastResult, setLastResult] = useState<CalcValue | null>(null);
  const [lastGoodText, setLastGoodText] = useState("0");
  const [progPendingOp, setProgPendingOp] = useState<ProgBitOp | null>(null);
  const [progPendingLeft, setProgPendingLeft] = useState<bigint | null>(null);
  const [progFreshEntry, setProgFreshEntry] = useState(false);
  const [fnQuery, setFnQuery] = useState("");
  const [fnGroup, setFnGroup] = useState<string>("全部");

  const migrated = useRef(false);

  const bits = (bitLength === 8 ? 8 : bitLength === 16 ? 16 : bitLength === 32 ? 32 : 64) as BitLength;
  const signed = isSigned;

  /* ---- 老版本历史记录迁移（localStorage: furina:calc_history） ---- */
  useEffect(() => {
    if (migrated.current) return;
    migrated.current = true;
    if (history.length > 0) return;
    try {
      const raw = window.localStorage.getItem(LEGACY_HISTORY_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed) || parsed.length === 0) return;
      const items: HistoryItem[] = (parsed as Array<Record<string, unknown>>)
        .filter((it) => typeof it?.expr === "string" && typeof it?.result === "string")
        .slice(0, 50)
        .map((it, i) => ({
          id: `legacy-${i}-${String(it.id ?? i)}`,
          expr: String(it.expr),
          result: String(it.result),
          time: typeof it.time === "string" ? it.time : "",
          mode: (typeof it.mode === "string" ? it.mode : "scientific") as CalcMode,
          angle: "DEG",
        }));
      if (items.length > 0) setHistory(items);
    } catch {
      /* 老数据坏了就忽略 */
    }
  }, [history.length, setHistory]);

  /* ---- 表达式实时求值（预览 + 错误定位） ---- */
  const live = useMemo(() => {
    if (calcMode === "programmer") return { ok: false as const, error: null as CalcError | null, value: null as CalcValue | null };
    const trimmed = expression.trim();
    if (trimmed === "") return { ok: false as const, error: null as CalcError | null, value: null as CalcValue | null };
    try {
      const value = evaluateExpression(trimmed, {
        angle: angleMode,
        ans: ansValue,
        memory,
        hasMemory: memory !== 0,
      });
      return { ok: true as const, error: null as CalcError | null, value };
    } catch (e) {
      const err = isCalcError(e) ? e : new CalcError(e instanceof Error ? e.message : "算式无法计算", 0);
      return { ok: false as const, error: err, value: null as CalcValue | null };
    }
  }, [expression, angleMode, ansValue, memory, calcMode]);

  useEffect(() => {
    if (live.ok && live.value !== null) setLastGoodText(formatValue(live.value));
  }, [live]);

  /* ---- 程序员模式的进制视图 ---- */
  const progVal = useMemo(() => {
    try {
      const v = BigInt(progText || "0");
      return bigClamp(v, bits);
    } catch {
      return BigInt(0);
    }
  }, [progText, bits]);

  const setProg = useCallback(
    (v: bigint) => {
      setProgText(bigClamp(v, bits).toString(10));
    },
    [bits, setProgText]
  );

  const progViews = useMemo(() => {
    const clamped = bigClamp(progVal, bits);
    const hex = clamped.toString(16).toUpperCase().padStart(bits / 4, "0");
    const binRaw = clamped.toString(2).padStart(bits, "0");
    const bin = binRaw.replace(/(.{4})/g, "$1 ").trim();
    const dec = signed ? bigAsSigned(clamped, bits).toString(10) : clamped.toString(10);
    const oct = clamped.toString(8);
    return { hex, bin, binRaw, dec, oct };
  }, [progVal, bits, signed]);

  const activeRadixText = useCallback(
    (r: RadixMode): string => {
      if (r === "HEX") return progViews.hex;
      if (r === "BIN") return progViews.binRaw;
      if (r === "OCT") return progViews.oct;
      return progViews.dec;
    },
    [progViews]
  );

  /* ---- 复制 ---- */
  const copyText = useCallback(
    (text: string, key: string, label = "已复制") => {
      const done = () => {
        setCopiedKey(key);
        toast({ title: label, description: text.length > 60 ? `${text.slice(0, 60)}…` : text, variant: "success", duration: 1600 });
        window.setTimeout(() => setCopiedKey((prev) => (prev === key ? null : prev)), 1500);
      };
      const fallback = () => {
        try {
          const ta = document.createElement("textarea");
          ta.value = text;
          ta.style.position = "fixed";
          ta.style.opacity = "0";
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
          done();
        } catch {
          toast({ title: "复制失败", description: "浏览器拒绝了剪贴板访问，请手动选中复制", variant: "error" });
        }
      };
      try {
        const p = navigator.clipboard?.writeText(text);
        if (p && typeof p.then === "function") p.then(done).catch(fallback);
        else fallback();
      } catch {
        fallback();
      }
    },
    [toast]
  );

  /* ---- 输入：插入 token ---- */
  const insertToken = useCallback(
    (tok: string) => {
      setExpression((prev) => {
        let base = prev;
        if (justEvaluated) {
          // 刚按过 =：以「Ans（完整精度）+ 运算符」继续算，否则重新开一个算式
          const isOperator = /^[-+*/^%!<>=&|)]/.test(tok);
          base = isOperator ? "Ans" : "";
        }
        if (base === "" && /^[+\-*/^%!<>=&|]/.test(tok)) base = "Ans";
        return base + tok;
      });
      setJustEvaluated(false);
    },
    [justEvaluated, setExpression]
  );

  const handleClear = useCallback(() => {
    setExpression("");
    setLastResult(null);
    setLastGoodText("0");
    setJustEvaluated(false);
    if (calcMode === "programmer") {
      setProg(BigInt(0));
      setProgPendingOp(null);
      setProgPendingLeft(null);
      setProgFreshEntry(false);
    }
  }, [calcMode, setExpression, setProg]);

  /* ---- 求值（= / Enter） ---- */
  const handleExecute = useCallback(() => {
    if (calcMode === "programmer") {
      if (progPendingOp !== null && progPendingLeft !== null) {
        const left = progPendingLeft;
        const right = bigClamp(progVal, bits);
        let result: bigint;
        if (progPendingOp === "AND") result = left & right;
        else if (progPendingOp === "OR") result = left | right;
        else result = left ^ right;
        setProg(result);
        setProgPendingOp(null);
        setProgPendingLeft(null);
        setProgFreshEntry(false);
      }
      return;
    }
    const trimmed = expression.trim();
    if (trimmed === "") {
      toast({ title: "还没有算式", description: "先输入要计算的表达式，例如 2+3*4", variant: "info" });
      return;
    }
    try {
      const value = evaluateExpression(trimmed, { angle: angleMode, ans: ansValue, memory, hasMemory: memory !== 0 });
      const text = formatValue(value);
      setLastResult(value);
      setLastGoodText(text);
      if (typeof value === "number") setAnsValue(value);
      setJustEvaluated(true);
      const item: HistoryItem = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        expr: trimmed,
        result: text,
        time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        mode: calcMode,
        angle: angleMode,
      };
      setHistory((prev) => [item, ...prev].slice(0, 50));
    } catch (e) {
      const err = isCalcError(e) ? e : new CalcError("算式无法计算", 0);
      toast({ title: "算不出来", description: err.message, variant: "error" });
    }
  }, [calcMode, expression, angleMode, ansValue, memory, progPendingOp, progPendingLeft, progVal, bits, setProg, setHistory, toast]);

  /* ---- 退格 ---- */
  const handleBackspace = useCallback(() => {
    setJustEvaluated(false);
    if (calcMode === "programmer") {
      const text = activeRadixText(progRadix);
      const next = text.length > 1 ? text.slice(0, -1) : "0";
      try {
        setProg(parseBigInRadix(next, RADIX_OF[progRadix]));
      } catch {
        setProg(BigInt(0));
      }
      return;
    }
    setExpression((prev) => prev.slice(0, -1));
  }, [calcMode, progRadix, activeRadixText, setExpression, setProg]);

  /* ---- 程序员模式按键 ---- */
  const progDigit = useCallback(
    (digit: string) => {
      const base = BigInt(RADIX_OF[progRadix]);
      const digitValue = BigInt(parseInt(digit, 16));
      const current = progFreshEntry ? BigInt(0) : bigClamp(progVal, bits);
      setProg(current * base + digitValue);
      if (progFreshEntry) setProgFreshEntry(false);
    },
    [progRadix, progFreshEntry, progVal, bits, setProg]
  );

  const progBitOp = useCallback(
    (op: ProgBitOp) => {
      setProgPendingLeft(bigClamp(progVal, bits));
      setProgPendingOp(op);
      setProgFreshEntry(true);
    },
    [progVal, bits]
  );

  /** 程序员模式下直接在输入框里打字：只保留当前进制合法的字符，再整体重新解析 */
  const handleProgInput = useCallback(
    (raw: string) => {
      const base = RADIX_OF[progRadix];
      const cleaned = raw
        .toUpperCase()
        .split("")
        .filter((ch) => /^[0-9A-F]$/.test(ch) && parseInt(ch, 16) < base)
        .join("");
      if (cleaned === "") {
        setProg(BigInt(0));
        setProgFreshEntry(false);
        return;
      }
      try {
        setProg(parseBigInRadix(cleaned, base));
      } catch {
        setProg(BigInt(0));
      }
      setProgFreshEntry(false);
    },
    [progRadix, setProg]
  );

  const toggleBit = useCallback(
    (bit: number) => {
      setProg(progVal ^ (BigInt(1) << BigInt(bit)));
    },
    [progVal, setProg]
  );

  /* ---- 记忆体 ---- */
  const handleMemory = useCallback(
    (action: "MC" | "MR" | "M+" | "M-" | "MS") => {
      const current = (() => {
        if (calcMode === "programmer") return Number(bigAsSigned(bigClamp(progVal, bits), bits));
        if (live.ok && typeof live.value === "number") return live.value;
        if (lastResult !== null && typeof lastResult === "number") return lastResult;
        return 0;
      })();
      if (action === "MC") {
        setMemory(0);
        toast({ title: "已清空记忆体", variant: "info" });
        return;
      }
      if (action === "MR") {
        if (memory === 0) {
          toast({ title: "记忆体是空的", description: "先按 MS 或 M+ 存一个数", variant: "error" });
          return;
        }
        insertToken("M");
        setJustEvaluated(false);
        toast({ title: "已插入 M", description: `M = ${formatNumber(memory)}`, variant: "info" });
        return;
      }
      if (action === "MS") {
        setMemory(current);
        toast({ title: "已存入记忆体", description: formatNumber(current), variant: "success" });
        return;
      }
      if (action === "M+") {
        setMemory(memory + current);
        toast({ title: "记忆累加", description: `M = ${formatNumber(memory + current)}`, variant: "success" });
        return;
      }
      setMemory(memory - current);
      toast({ title: "记忆递减", description: `M = ${formatNumber(memory - current)}`, variant: "success" });
    },
    [calcMode, progVal, bits, live, lastResult, memory, insertToken, setMemory, toast]
  );

  /* ---- 键盘 ---- */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // 绝不碰带修饰键的组合（Ctrl+空格 是全站搜索、Ctrl+C 是复制）
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isField = tag === "INPUT" || tag === "TEXTAREA" || target?.isContentEditable === true;
      // 输入框一律交给浏览器原生编辑：表达式框的 Enter / Esc 由它自己的 onKeyDown 处理
      // （这里再处理一次会导致「按一次回车算两次」），其它输入框（如函数搜索）完全不抢。
      if (isField) return;

      const key = e.key;
      if (key === "Enter" || key === "=") {
        e.preventDefault();
        handleExecute();
        return;
      }
      if (key === "Escape") {
        e.preventDefault();
        exprInput()?.blur();
        handleClear();
        return;
      }
      if (isField) return; // 输入框里其余按键交给浏览器原生编辑（打字、退格、方向键）
      if (key === "Backspace" || key === "Delete") {
        e.preventDefault();
        handleBackspace();
        return;
      }
      if (calcMode === "programmer") {
        const upper = key.toUpperCase();
        if (/^[0-9A-F]$/.test(upper)) {
          const base = RADIX_OF[progRadix];
          if (parseInt(upper, 16) < base) {
            e.preventDefault();
            progDigit(upper);
          }
        }
        return;
      }
      if (/^[0-9]$/.test(key) || "+-*/^%().!".includes(key)) {
        e.preventDefault();
        insertToken(key);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleExecute, handleClear, handleBackspace, insertToken, progDigit, calcMode, progRadix]);

  // 进入工具时把光标放进表达式输入框，用户可以直接敲数字
  useEffect(() => {
    const t = window.setTimeout(() => exprInput()?.focus(), 60);
    return () => window.clearTimeout(t);
  }, []);

  /* ---- 显示用派生值 ---- */
  const bigText = useMemo(() => {
    if (calcMode === "programmer") {
      if (progRadix === "HEX") return `0x${progViews.hex}`;
      if (progRadix === "BIN") return progViews.bin;
      if (progRadix === "OCT") return `0o${progViews.oct}`;
      return progViews.dec;
    }
    if (justEvaluated && lastResult !== null) return formatValue(lastResult, { full: fullPrecision });
    if (live.ok && live.value !== null) return formatValue(live.value, { full: fullPrecision });
    // 算式写到一半（比如刚敲了「2+」）时保留上一个有效预览，避免数字突然跳成 0
    if (expression.trim() !== "") return lastGoodText;
    // 输入框为空：AC 之后就该是 0（Ans 仍然留着给「Ans+1」这种连算用）
    return "0";
  }, [calcMode, progRadix, progViews, justEvaluated, lastResult, live, expression, fullPrecision, lastGoodText]);

  const error = calcMode === "programmer" ? null : live.error;

  /** 当前屏幕上的那个数（分数 / 人民币 / 完整精度 都基于它，只算一次） */
  const currentNumber = useMemo<number | null>(() => {
    if (calcMode === "programmer") return null;
    if (justEvaluated && typeof lastResult === "number") return lastResult;
    if (live.ok && typeof live.value === "number") return live.value;
    return null;
  }, [calcMode, justEvaluated, lastResult, live]);

  const fractionText = useMemo(
    () => (currentNumber === null ? null : toFractionString(currentNumber)),
    [currentNumber]
  );

  const rmbText = useMemo(
    () => (currentNumber === null ? null : numberToRmb(currentNumber)),
    [currentNumber]
  );

  const exactText = useMemo(() => {
    if (currentNumber === null) return null;
    const shown = formatNumber(currentNumber);
    const exact = formatFullPrecision(currentNumber);
    return exact !== shown ? exact : null;
  }, [currentNumber]);

  const nanHint = currentNumber !== null && Number.isNaN(currentNumber);

  const bigFontClass = useMemo(() => {
    const len = bigText.length;
    if (len <= 9) return "text-4xl sm:text-5xl";
    if (len <= 15) return "text-3xl sm:text-4xl";
    if (len <= 24) return "text-2xl sm:text-3xl";
    return "text-xl sm:text-2xl";
  }, [bigText]);

  const fnGroups = useMemo(() => {
    const groups = Array.from(new Set(FUNCTION_REFERENCE.map((f) => f.group)));
    return ["全部", ...groups];
  }, []);

  const filteredFns = useMemo(() => {
    const q = fnQuery.trim().toLowerCase();
    return FUNCTION_REFERENCE.filter((f) => {
      if (fnGroup !== "全部" && f.group !== fnGroup) return false;
      if (q === "" ) return true;
      return f.label.toLowerCase().includes(q) || f.insert.toLowerCase().includes(q) || f.group.toLowerCase().includes(q);
    });
  }, [fnQuery, fnGroup]);

  const sideOpen = sidePanel !== "none";

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-4 lg:p-5">
      {/* ── 顶部操作条：模式 / 角度或字长 / 体面按钮（不放工具名与描述） ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1 rounded-xl border border-border/70 bg-card p-1 shadow-xs">
          {([
            { key: "scientific" as CalcMode, label: "科学计算", icon: Atom },
            { key: "programmer" as CalcMode, label: "程序员", icon: Binary },
            { key: "standard" as CalcMode, label: "标准日常", icon: CalcIcon },
          ]).map((m) => (
            <Button
              key={m.key}
              size="sm"
              variant={calcMode === m.key ? "default" : "ghost"}
              className="h-8 gap-1.5 px-3 text-xs"
              onClick={() => setCalcMode(m.key)}
            >
              <m.icon className="h-3.5 w-3.5" />
              {m.label}
            </Button>
          ))}
        </div>

        {calcMode === "scientific" && (
          <>
            <div className="flex items-center gap-1 rounded-xl border border-border/70 bg-card p-1 shadow-xs">
              {(["DEG", "RAD", "GRAD"] as AngleMode[]).map((m) => (
                <Button
                  key={m}
                  size="sm"
                  variant={angleMode === m ? "secondary" : "ghost"}
                  className={cn("h-8 px-2.5 font-mono text-[11px]", angleMode === m && "font-bold text-primary")}
                  onClick={() => setAngleMode(m)}
                  title={m === "DEG" ? "角度制：sin(30) = 0.5" : m === "RAD" ? "弧度制" : "百分度制（400 度 = 360°）"}
                >
                  {m}
                </Button>
              ))}
            </div>
            <Button
              size="sm"
              variant={is2nd ? "default" : "outline"}
              className="h-8 px-3 text-xs font-semibold"
              onClick={() => setIs2nd(!is2nd)}
              title="第二功能：sin → sin⁻¹、√ → ∛、log → 10ˣ"
            >
              2nd
            </Button>
            <Button
              size="sm"
              variant={isHyp ? "default" : "outline"}
              className="h-8 px-3 text-xs font-semibold"
              onClick={() => setIsHyp(!isHyp)}
              title="双曲函数：sin → sinh"
            >
              hyp
            </Button>
          </>
        )}

        {calcMode === "programmer" && (
          <>
            <div className="flex items-center gap-1 rounded-xl border border-border/70 bg-card p-1 shadow-xs">
              {([
                { bits: 64, label: "QWORD" },
                { bits: 32, label: "DWORD" },
                { bits: 16, label: "WORD" },
                { bits: 8, label: "BYTE" },
              ] as Array<{ bits: number; label: string }>).map((b) => (
                <Button
                  key={b.bits}
                  size="sm"
                  variant={bitLength === b.bits ? "secondary" : "ghost"}
                  className={cn("h-8 px-2.5 font-mono text-[11px]", bitLength === b.bits && "font-bold text-primary")}
                  onClick={() => {
                    setBitLength(b.bits);
                    setProgPendingOp(null);
                    setProgPendingLeft(null);
                    setProgFreshEntry(false);
                  }}
                >
                  {b.label}
                </Button>
              ))}
            </div>
            <Button
              size="sm"
              variant={isSigned ? "secondary" : "outline"}
              className="h-8 gap-1.5 text-xs"
              onClick={() => setIsSigned(!isSigned)}
              title="切换十进制读数的有符号 / 无符号解释"
            >
              {isSigned ? "有符号" : "无符号"}
            </Button>
          </>
        )}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {calcMode !== "programmer" && (
            <Button
              size="sm"
              variant={fullPrecision ? "default" : "outline"}
              className="h-8 gap-1.5 text-xs"
              onClick={() => setFullPrecision(!fullPrecision)}
              title="显示该双精度数的完整精度（不做任何显示简化）"
            >
              <ScrollText className="h-3.5 w-3.5" />
              完整精度
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            onClick={() => {
              if (calcMode === "programmer") {
                setProgText(BigInt("0xF0F0").toString(10));
                setProgRadix("HEX");
              } else {
                setExpression(EXAMPLES[calcMode]);
              }
              setJustEvaluated(false);
            }}
          >
            <Wand2 className="h-3.5 w-3.5" />
            填入示例
          </Button>
          <Button size="sm" variant="outline" className="h-8 gap-1.5 text-xs" onClick={handleClear}>
            <Eraser className="h-3.5 w-3.5" />
            清空
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-8 gap-1.5 text-xs"
            onClick={() => copyText(calcMode === "programmer" ? activeRadixText(progRadix) : bigText, "main", "已复制当前数值")}
          >
            {copiedKey === "main" ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
            复制结果
          </Button>
          <Button
            size="sm"
            variant={sideOpen ? "secondary" : "outline"}
            className="h-8 gap-1.5 text-xs"
            onClick={() => setSidePanel(sideOpen ? "none" : "history")}
          >
            {sideOpen ? <PanelRightClose className="h-3.5 w-3.5" /> : <PanelRightOpen className="h-3.5 w-3.5" />}
            侧栏
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        {/* ── 主区：显示屏 + 键盘 ── */}
        <div className={cn("flex flex-col gap-4", sideOpen ? "lg:col-span-9" : "lg:col-span-12")}>
          {/* 显示屏 */}
          <div className="relative overflow-hidden rounded-2xl border border-border/70 bg-card/60 p-3.5 shadow-sm backdrop-blur-md sm:p-4">
            <div className="rounded-xl border border-primary/20 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent px-3 py-2.5">
              <Input
                id={EXPR_INPUT_ID}
                value={calcMode === "programmer" ? activeRadixText(progRadix) : expression}
                onChange={(e) => {
                  if (calcMode === "programmer") {
                    handleProgInput(e.target.value);
                    return;
                  }
                  setExpression(e.target.value);
                  setJustEvaluated(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleExecute();
                  } else if (e.key === "Escape") {
                    e.preventDefault();
                    e.currentTarget.blur();
                    handleClear();
                  }
                }}
                spellCheck={false}
                autoComplete="off"
                inputMode={calcMode === "programmer" ? "text" : "text"}
                placeholder={
                  calcMode === "programmer"
                    ? `按 ${progRadix} 输入数字，或点下方按键`
                    : "直接输入算式，例如 sin(30)+2^10，回车求值"
                }
                aria-label={calcMode === "programmer" ? "当前进制数值输入框" : "算式输入框"}
                data-testid="calc-input"
                className="h-11 border-0 bg-transparent px-0 font-mono text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
              />
            </div>

            {/* 结果大屏 */}
            <div className="mt-2 flex items-end justify-end gap-2 overflow-x-auto thin-scroll">
              <span
                data-testid="calc-result"
                className={cn(
                  "font-mono-accent font-extrabold leading-tight tracking-tight text-foreground select-text",
                  bigFontClass,
                  error && "text-muted-foreground/70"
                )}
              >
                {bigText}
              </span>
            </div>

            {/* 辅助读数行 */}
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-muted-foreground">
              {fractionText && <Badge variant="secondary">≈ {fractionText}</Badge>}
              {rmbText && <span className="truncate">{rmbText}</span>}
              {fullPrecision && exactText && <Badge variant="outline">完整精度已开</Badge>}
              {!fullPrecision && exactText && <span className="font-mono">显示已简化（可切「完整精度」）</span>}
              {nanHint && (
                <span className="text-destructive">
                  结果是 NaN：常见原因是负数开平方、对非正数取对数，或者 0÷0
                </span>
              )}
              {calcMode === "scientific" && is2nd && <Badge variant="secondary">2nd 反函数</Badge>}
              {calcMode === "scientific" && isHyp && <Badge variant="secondary">hyp 双曲</Badge>}
              {calcMode !== "programmer" && justEvaluated && ansValue !== undefined && (
                <Badge variant="outline" title="接着按运算符会用这个完整精度值继续算">
                  Ans = {formatNumber(ansValue)}
                </Badge>
              )}
              <span className="ml-auto font-mono uppercase tracking-wide">
                {calcMode === "programmer" ? `${bitLength} 位 · ${signed ? "有符号" : "无符号"}` : `Mode ${angleMode}`}
                {memory !== 0 && " · M"}
              </span>
            </div>

            {/* 程序员模式：四进制同步显示（点一行即切换输入进制） */}
            {calcMode === "programmer" && (
              <div className="mt-3 space-y-1.5 border-t border-border/60 pt-3 font-mono text-xs">
                {([
                  { key: "HEX" as RadixMode, label: "HEX", value: `0x${progViews.hex}` },
                  { key: "DEC" as RadixMode, label: "DEC", value: progViews.dec },
                  { key: "OCT" as RadixMode, label: "OCT", value: `0o${progViews.oct}` },
                  { key: "BIN" as RadixMode, label: "BIN", value: progViews.bin },
                ]).map((row) => (
                  <button
                    key={row.key}
                    type="button"
                    onClick={() => {
                      setProgRadix(row.key);
                      setProgPendingOp(null);
                      setProgPendingLeft(null);
                      setProgFreshEntry(false);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 rounded-lg px-2 py-1 text-left transition-colors",
                      progRadix === row.key ? "bg-primary/15 font-bold text-primary" : "text-muted-foreground hover:bg-muted/40"
                    )}
                  >
                    <span className="text-[11px] font-semibold">{row.label}</span>
                    <span className="truncate tracking-wider">{row.value}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 错误提示（统一样式，带出错位置） */}
          {error && (
            <div className="flex items-start gap-2 rounded-xl border-l-4 border-l-destructive bg-destructive/10 px-4 py-3 font-mono text-xs text-destructive">
              <AlertTriangle className="h-4 w-4 shrink-0" />
              <div className="min-w-0 flex-1 space-y-1">
                <div className="break-words">{error.message}</div>
                <div className="overflow-x-auto thin-scroll whitespace-pre text-[11px] opacity-80">
                  {expression}
                  {"\n"}
                  {" ".repeat(Math.max(0, Math.min(error.index, expression.length)))}^ 位置 {error.index + 1}
                </div>
                {error.hint && <div className="text-[11px] opacity-80">{error.hint}</div>}
              </div>
            </div>
          )}

          {/* 程序员模式：位翻转图（可收起） */}
          {calcMode === "programmer" && (
            <div className="rounded-2xl border border-border/70 bg-card p-3 shadow-xs">
              <div className="mb-2 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span className="font-semibold text-foreground">二进制点阵（点任意一位翻转）</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono">
                    Bit 0 ~ {bitLength - 1} · {signed ? "补码" : "无符号"}
                  </span>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setShowBits(!showBits)}>
                    {showBits ? "收起" : "展开"}
                  </Button>
                </div>
              </div>
              {showBits && (
                <div className="space-y-1.5">
                  {Array.from({ length: bitLength / 16 }, (_, row) => {
                    const start = bitLength - 1 - row * 16;
                    return (
                      <div key={start} className="flex items-center gap-1 font-mono text-[11px]">
                        <span className="w-14 shrink-0 text-[10px] text-muted-foreground">
                          {start}..{start - 15}
                        </span>
                        <div className="flex flex-1 justify-between gap-0.5">
                          {Array.from({ length: 16 }, (_, i) => {
                            const bit = start - i;
                            const isSet = (progVal & (BigInt(1) << BigInt(bit))) !== BigInt(0);
                            return (
                              <button
                                key={bit}
                                type="button"
                                onClick={() => toggleBit(bit)}
                                title={`Bit ${bit}`}
                                className={cn(
                                  "flex h-7 flex-1 items-center justify-center rounded font-semibold transition-all",
                                  isSet
                                    ? "bg-primary text-primary-foreground shadow-xs"
                                    : "bg-muted/40 text-muted-foreground hover:bg-secondary hover:text-foreground"
                                )}
                              >
                                {isSet ? "1" : "0"}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── 键盘 ── */}
          {calcMode === "scientific" && (
            <div className="space-y-2">
              <div className="grid grid-cols-5 gap-2 select-none">
                <KeyButton onClick={() => insertToken(hypNames("sin", is2nd, isHyp))} variant="fn">
                  {hypLabel("sin", is2nd, isHyp)}
                </KeyButton>
                <KeyButton onClick={() => insertToken(hypNames("cos", is2nd, isHyp))} variant="fn">
                  {hypLabel("cos", is2nd, isHyp)}
                </KeyButton>
                <KeyButton onClick={() => insertToken(hypNames("tan", is2nd, isHyp))} variant="fn">
                  {hypLabel("tan", is2nd, isHyp)}
                </KeyButton>
                <KeyButton onClick={handleClear} variant="danger">
                  AC
                </KeyButton>
                <KeyButton onClick={handleBackspace} variant="action">
                  ⌫
                </KeyButton>

                <KeyButton onClick={() => insertToken("π")} variant="fn">
                  π
                </KeyButton>
                <KeyButton onClick={() => insertToken("e")} variant="fn">
                  e
                </KeyButton>
                <KeyButton onClick={() => insertToken("(")} variant="fn">
                  (
                </KeyButton>
                <KeyButton onClick={() => insertToken(")")} variant="fn">
                  )
                </KeyButton>
                <KeyButton onClick={() => insertToken("/")} variant="op">
                  ÷
                </KeyButton>

                <KeyButton onClick={() => insertToken(is2nd ? "cbrt(" : "sqrt(")} variant="fn">
                  {is2nd ? "∛x" : "√x"}
                </KeyButton>
                <KeyButton onClick={() => insertToken("7")} variant="num">
                  7
                </KeyButton>
                <KeyButton onClick={() => insertToken("8")} variant="num">
                  8
                </KeyButton>
                <KeyButton onClick={() => insertToken("9")} variant="num">
                  9
                </KeyButton>
                <KeyButton onClick={() => insertToken("*")} variant="op">
                  ×
                </KeyButton>

                <KeyButton onClick={() => insertToken(is2nd ? "^3" : "^2")} variant="fn">
                  {is2nd ? "x³" : "x²"}
                </KeyButton>
                <KeyButton onClick={() => insertToken("4")} variant="num">
                  4
                </KeyButton>
                <KeyButton onClick={() => insertToken("5")} variant="num">
                  5
                </KeyButton>
                <KeyButton onClick={() => insertToken("6")} variant="num">
                  6
                </KeyButton>
                <KeyButton onClick={() => insertToken("-")} variant="op">
                  −
                </KeyButton>

                <KeyButton onClick={() => insertToken("^")} variant="fn">
                  xʸ
                </KeyButton>
                <KeyButton onClick={() => insertToken("1")} variant="num">
                  1
                </KeyButton>
                <KeyButton onClick={() => insertToken("2")} variant="num">
                  2
                </KeyButton>
                <KeyButton onClick={() => insertToken("3")} variant="num">
                  3
                </KeyButton>
                <KeyButton onClick={() => insertToken("+")} variant="op">
                  +
                </KeyButton>

                <KeyButton onClick={() => insertToken(is2nd ? "10^" : "log(")} variant="fn">
                  {is2nd ? "10ˣ" : "log"}
                </KeyButton>
                <KeyButton onClick={() => insertToken(is2nd ? "exp(" : "ln(")} variant="fn">
                  {is2nd ? "eˣ" : "ln"}
                </KeyButton>
                <KeyButton onClick={() => insertToken("0")} variant="num">
                  0
                </KeyButton>
                <KeyButton onClick={() => insertToken(".")} variant="num">
                  .
                </KeyButton>
                <KeyButton onClick={handleExecute} variant="primary">
                  =
                </KeyButton>

                <KeyButton onClick={() => insertToken("!")} variant="fn" size="sm">
                  n!
                </KeyButton>
                <KeyButton onClick={() => insertToken("abs(")} variant="fn" size="sm">
                  |x|
                </KeyButton>
                <KeyButton onClick={() => insertToken("%")} variant="fn" size="sm">
                  % 百分比
                </KeyButton>
                <KeyButton onClick={() => insertToken("nPr(")} variant="fn" size="sm">
                  nPr
                </KeyButton>
                <KeyButton onClick={() => insertToken("nCr(")} variant="fn" size="sm">
                  nCr
                </KeyButton>

                <KeyButton onClick={() => insertToken(isHyp ? "sech(" : is2nd ? "asec(" : "sec(")} variant="fn" size="sm">
                  {isHyp ? "sech" : is2nd ? "sec⁻¹" : "sec"}
                </KeyButton>
                <KeyButton onClick={() => insertToken(isHyp ? "csch(" : is2nd ? "acsc(" : "csc(")} variant="fn" size="sm">
                  {isHyp ? "csch" : is2nd ? "csc⁻¹" : "csc"}
                </KeyButton>
                <KeyButton onClick={() => insertToken(isHyp ? "coth(" : is2nd ? "acot(" : "cot(")} variant="fn" size="sm">
                  {isHyp ? "coth" : is2nd ? "cot⁻¹" : "cot"}
                </KeyButton>
                <KeyButton onClick={() => insertToken("τ")} variant="fn" size="sm">
                  τ
                </KeyButton>
                <KeyButton onClick={() => insertToken("mod(")} variant="fn" size="sm">
                  mod
                </KeyButton>

                <KeyButton onClick={() => insertToken("gcd(")} variant="fn" size="sm">
                  gcd
                </KeyButton>
                <KeyButton onClick={() => insertToken("lcm(")} variant="fn" size="sm">
                  lcm
                </KeyButton>
                <KeyButton onClick={() => insertToken("round(")} variant="fn" size="sm">
                  round
                </KeyButton>
                <KeyButton onClick={() => insertToken("mean(")} variant="fn" size="sm">
                  mean
                </KeyButton>
                <KeyButton onClick={() => insertToken("randomInt(1, 100)")} variant="fn" size="sm">
                  <Dices className="h-3.5 w-3.5" />
                </KeyButton>
              </div>
            </div>
          )}

          {calcMode === "programmer" && (
            <div className="grid grid-cols-6 gap-2 select-none">
              <KeyButton onClick={() => setProg(~progVal)} variant="fn">
                NOT
              </KeyButton>
              <KeyButton onClick={() => setProg(bigShiftLeft(progVal, bits, BigInt(1)))} variant="fn">
                Lsh ≪
              </KeyButton>
              <KeyButton onClick={() => setProg(bigShiftRight(progVal, bits, BigInt(1), signed))} variant="fn">
                Rsh ≫
              </KeyButton>
              <KeyButton onClick={() => setProg(bigShiftRightLogical(progVal, bits, BigInt(1)))} variant="fn">
                Rsh ≫≫
              </KeyButton>
              <KeyButton onClick={() => setProg(bigRotateLeft(progVal, bits, BigInt(1)))} variant="fn">
                RoL ↺
              </KeyButton>
              <KeyButton onClick={() => setProg(bigRotateRight(progVal, bits, BigInt(1)))} variant="fn">
                RoR ↻
              </KeyButton>

              <KeyButton onClick={handleClear} variant="danger">
                AC
              </KeyButton>
              <KeyButton onClick={handleBackspace} variant="action">
                ⌫
              </KeyButton>
              <KeyButton onClick={() => setProg(bigFromSigned(-bigAsSigned(progVal, bits), bits))} variant="fn">
                ±
              </KeyButton>
              <KeyButton onClick={() => progBitOp("AND")} variant="op">
                AND
              </KeyButton>
              <KeyButton onClick={() => progBitOp("OR")} variant="op">
                OR
              </KeyButton>
              <KeyButton onClick={() => progBitOp("XOR")} variant="op">
                XOR
              </KeyButton>

              {(["A", "B", "7", "8", "9"] as const).map((d) => (
                <KeyButton
                  key={d}
                  onClick={() => progDigit(d)}
                  disabled={parseInt(d, 16) >= RADIX_OF[progRadix]}
                  variant={parseInt(d, 16) >= RADIX_OF[progRadix] ? "disabled" : progRadix === "HEX" && /[A-F]/.test(d) ? "fn" : "num"}
                >
                  {d}
                </KeyButton>
              ))}
              <KeyButton onClick={() => progDigit("C")} variant={RADIX_OF[progRadix] === 16 ? "fn" : "disabled"} disabled={RADIX_OF[progRadix] !== 16}>
                C
              </KeyButton>

              {(["D", "E", "F", "4", "5", "6"] as const).map((d) => (
                <KeyButton
                  key={d}
                  onClick={() => progDigit(d)}
                  disabled={parseInt(d, 16) >= RADIX_OF[progRadix]}
                  variant={parseInt(d, 16) >= RADIX_OF[progRadix] ? "disabled" : /[A-F]/.test(d) ? "fn" : "num"}
                >
                  {d}
                </KeyButton>
              ))}

              {(["1", "2", "3"] as const).map((d) => (
                <KeyButton key={d} onClick={() => progDigit(d)} variant="num">
                  {d}
                </KeyButton>
              ))}
              <KeyButton onClick={() => copyText(`0x${progViews.hex}`, "hex", "已复制十六进制")} variant="action">
                {copiedKey === "hex" ? <Check className="h-3.5 w-3.5" /> : "复制 HEX"}
              </KeyButton>
              <KeyButton onClick={() => copyText(progViews.binRaw, "bin", "已复制二进制")} variant="action">
                {copiedKey === "bin" ? <Check className="h-3.5 w-3.5" /> : "复制 BIN"}
              </KeyButton>
              <KeyButton onClick={() => copyText(progViews.dec, "dec", "已复制十进制")} variant="action">
                {copiedKey === "dec" ? <Check className="h-3.5 w-3.5" /> : "复制 DEC"}
              </KeyButton>

              <KeyButton onClick={() => progDigit("0")} variant="num" colSpan={2}>
                0
              </KeyButton>
              <KeyButton onClick={() => copyText(`0o${progViews.oct}`, "oct", "已复制八进制")} variant="action">
                {copiedKey === "oct" ? <Check className="h-3.5 w-3.5" /> : "复制 OCT"}
              </KeyButton>
              <KeyButton onClick={handleExecute} variant="primary" colSpan={3}>
                =
              </KeyButton>
            </div>
          )}

          {calcMode === "standard" && (
            <div className="space-y-2">
              <div className="grid grid-cols-5 gap-2">
                <KeyButton onClick={() => handleMemory("MC")} disabled={memory === 0} variant="fn" size="sm">
                  MC
                </KeyButton>
                <KeyButton onClick={() => handleMemory("MR")} disabled={memory === 0} variant="fn" size="sm">
                  MR
                </KeyButton>
                <KeyButton onClick={() => handleMemory("M+")} variant="fn" size="sm">
                  M+
                </KeyButton>
                <KeyButton onClick={() => handleMemory("M-")} variant="fn" size="sm">
                  M-
                </KeyButton>
                <KeyButton onClick={() => handleMemory("MS")} variant="fn" size="sm">
                  MS
                </KeyButton>
              </div>

              <div className="grid grid-cols-4 gap-2 select-none">
                <KeyButton onClick={() => insertToken("sqrt(")} variant="fn">
                  √x
                </KeyButton>
                <KeyButton onClick={() => insertToken("^2")} variant="fn">
                  x²
                </KeyButton>
                <KeyButton onClick={() => insertToken("1/(")} variant="fn">
                  1/x
                </KeyButton>
                <KeyButton onClick={() => insertToken("^")} variant="fn">
                  xʸ
                </KeyButton>

                <KeyButton onClick={handleClear} variant="danger">
                  C
                </KeyButton>
                <KeyButton onClick={handleBackspace} variant="action">
                  ⌫
                </KeyButton>
                <KeyButton onClick={() => insertToken("%")} variant="fn">
                  %
                </KeyButton>
                <KeyButton onClick={() => insertToken("/")} variant="op">
                  ÷
                </KeyButton>

                <KeyButton onClick={() => insertToken("7")} variant="num">
                  7
                </KeyButton>
                <KeyButton onClick={() => insertToken("8")} variant="num">
                  8
                </KeyButton>
                <KeyButton onClick={() => insertToken("9")} variant="num">
                  9
                </KeyButton>
                <KeyButton onClick={() => insertToken("*")} variant="op">
                  ×
                </KeyButton>

                <KeyButton onClick={() => insertToken("4")} variant="num">
                  4
                </KeyButton>
                <KeyButton onClick={() => insertToken("5")} variant="num">
                  5
                </KeyButton>
                <KeyButton onClick={() => insertToken("6")} variant="num">
                  6
                </KeyButton>
                <KeyButton onClick={() => insertToken("-")} variant="op">
                  −
                </KeyButton>

                <KeyButton onClick={() => insertToken("1")} variant="num">
                  1
                </KeyButton>
                <KeyButton onClick={() => insertToken("2")} variant="num">
                  2
                </KeyButton>
                <KeyButton onClick={() => insertToken("3")} variant="num">
                  3
                </KeyButton>
                <KeyButton onClick={() => insertToken("+")} variant="op">
                  +
                </KeyButton>

                <KeyButton
                  onClick={() =>
                    setExpression((prev) => {
                      const t = prev.trim();
                      if (t === "") return "-";
                      if (t.startsWith("-(") && t.endsWith(")")) return t.slice(2, -1);
                      if (/^-?\d*\.?\d+$/.test(t)) return t.startsWith("-") ? t.slice(1) : `-${t}`;
                      return `-(${t})`;
                    })
                  }
                  variant="fn"
                >
                  ±
                </KeyButton>
                <KeyButton onClick={() => insertToken("0")} variant="num">
                  0
                </KeyButton>
                <KeyButton onClick={() => insertToken(".")} variant="num">
                  .
                </KeyButton>
                <KeyButton onClick={handleExecute} variant="primary">
                  =
                </KeyButton>
              </div>
            </div>
          )}
        </div>

        {/* ── 右侧栏：历史 / 常数 / 函数 ── */}
        {sideOpen && (
          <aside className="flex flex-col gap-3 rounded-2xl border border-border/70 bg-card p-4 shadow-sm lg:col-span-3">
            <div className="flex items-center gap-1 rounded-xl border border-border/70 bg-background/40 p-1">
              {([
                { key: "history" as const, label: "历史", icon: History },
                { key: "constants" as const, label: "常数", icon: Sparkles },
                { key: "functions" as const, label: "函数", icon: ScrollText },
              ]).map((t) => (
                <Button
                  key={t.key}
                  size="sm"
                  variant={sidePanel === t.key ? "secondary" : "ghost"}
                  className={cn("h-8 flex-1 gap-1 px-2 text-[11px]", sidePanel === t.key && "font-bold text-primary")}
                  onClick={() => setSidePanel(t.key)}
                >
                  <t.icon className="h-3.5 w-3.5" />
                  {t.label}
                </Button>
              ))}
            </div>

            {sidePanel === "history" && (
              <div className="flex min-h-0 flex-1 flex-col">
                <div className="mb-2 flex items-center justify-between border-b border-border/60 pb-2">
                  <span className="text-xs font-semibold text-foreground">计算历史（{history.length}）</span>
                  {history.length > 0 && (
                    <Button size="sm" variant="ghost" className="h-6 px-2 text-[11px]" onClick={() => setHistory([])}>
                      清空
                    </Button>
                  )}
                </div>
                <div className="max-h-[520px] space-y-2 overflow-y-auto thin-scroll pr-1">
                  {history.length === 0 ? (
                    <div className="space-y-2 rounded-xl border border-dashed border-border/70 px-3 py-6 text-center text-[11px] text-muted-foreground">
                      <div>还没有计算记录。</div>
                      <div>输入算式后按 Enter 或 =，结果会留在这里，点一下就能填回输入框。</div>
                    </div>
                  ) : (
                    history.map((item) => (
                      <div
                        key={item.id}
                        className="group flex cursor-pointer flex-col gap-1 rounded-xl border border-border/50 bg-background/40 p-2.5 transition-all hover:border-primary/50"
                        onClick={() => {
                          setExpression(item.expr);
                          setJustEvaluated(false);
                          if (item.angle) setAngleMode(item.angle);
                        }}
                        title="点击填回输入框"
                      >
                        <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                          <span className="truncate font-mono">{item.expr} =</span>
                          <span className="shrink-0">{item.time}</span>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate font-mono text-sm font-bold text-foreground transition-colors group-hover:text-primary">
                            {item.result}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              copyText(item.result, `h-${item.id}`, "已复制历史结果");
                            }}
                            className="rounded p-1 text-muted-foreground opacity-0 transition-all hover:bg-secondary group-hover:opacity-100"
                            title="复制结果"
                          >
                            {copiedKey === `h-${item.id}` ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {sidePanel === "constants" && (
              <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto thin-scroll pr-1">
                {CONSTANT_REFERENCE.map((c) => (
                  <button
                    key={c.insert}
                    type="button"
                    onClick={() => insertToken(c.insert)}
                    className="flex w-full items-center justify-between gap-2 rounded-lg border border-border/40 bg-background/40 p-2 text-left transition-colors hover:border-primary/40 hover:bg-primary/10"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-xs font-semibold text-foreground">{c.label}</div>
                      <div className="truncate text-[10.5px] text-muted-foreground">{c.desc}</div>
                    </div>
                    <span className="shrink-0 rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] font-bold text-primary">
                      + 插入
                    </span>
                  </button>
                ))}
              </div>
            )}

            {sidePanel === "functions" && (
              <div className="flex min-h-0 flex-1 flex-col gap-2">
                <Input
                  value={fnQuery}
                  onChange={(e) => setFnQuery(e.target.value)}
                  placeholder="搜索函数名或说明…"
                  className="h-9 font-mono text-xs"
                  spellCheck={false}
                  aria-label="函数搜索"
                />
                <div className="flex flex-wrap gap-1">
                  {fnGroups.map((g) => (
                    <button
                      key={g}
                      type="button"
                      onClick={() => setFnGroup(g)}
                      className={cn(
                        "rounded-full border px-2 py-0.5 text-[10.5px] transition-colors",
                        fnGroup === g
                          ? "border-primary/40 bg-primary/15 font-semibold text-primary"
                          : "border-border/60 text-muted-foreground hover:bg-secondary"
                      )}
                    >
                      {g}
                    </button>
                  ))}
                </div>
                <div className="max-h-[460px] min-h-0 flex-1 space-y-1 overflow-y-auto thin-scroll pr-1">
                  {filteredFns.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-border/70 px-3 py-6 text-center text-[11px] text-muted-foreground">
                      没有匹配的函数，换个关键词试试。
                    </div>
                  ) : (
                    filteredFns.map((f) => (
                      <button
                        key={`${f.group}-${f.insert}`}
                        type="button"
                        onClick={() => insertToken(f.insert)}
                        className="flex w-full items-center justify-between gap-2 rounded-lg border border-border/40 bg-background/40 px-2 py-1.5 text-left transition-colors hover:border-primary/40 hover:bg-primary/10"
                      >
                        <span className="truncate text-[11px] text-foreground">{f.label}</span>
                        <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{f.group}</span>
                      </button>
                    ))
                  )}
                </div>
                <div className="border-t border-border/60 pt-2 text-[10.5px] leading-relaxed text-muted-foreground">
                  省略乘号也行：2π、3(4)、2sin(30)；百分号按通用算法：100+3% = 103；<code className="font-mono">[1,2,3]</code> 是数组，
                  可以喂给统计函数。
                </div>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}

/** 三角键在不同二级状态下的函数名与显示名 */
function hypNames(base: "sin" | "cos" | "tan", is2nd: boolean, isHyp: boolean): string {
  if (is2nd && isHyp) return `a${base}h(`;
  if (isHyp) return `${base}h(`;
  if (is2nd) return `a${base}(`;
  return `${base}(`;
}

function hypLabel(base: "sin" | "cos" | "tan", is2nd: boolean, isHyp: boolean): string {
  if (is2nd && isHyp) return `${base}h⁻¹`;
  if (isHyp) return `${base}h`;
  if (is2nd) return `${base}⁻¹`;
  return base;
}

/** 键盘按键：大键位、按用途配色，只走主题变量 */
function KeyButton({
  children,
  onClick,
  variant = "num",
  colSpan = 1,
  size = "default",
  disabled = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  variant?: "num" | "op" | "fn" | "primary" | "danger" | "action" | "disabled";
  colSpan?: number;
  size?: "default" | "sm";
  disabled?: boolean;
}) {
  const spanClass = colSpan === 6 ? "col-span-6" : colSpan === 3 ? "col-span-3" : colSpan === 2 ? "col-span-2" : "";
  const isDisabled = disabled || variant === "disabled";
  const variantClass = isDisabled
    ? "border-transparent bg-muted/20 text-muted-foreground opacity-40"
    : variant === "num"
      ? "border-border bg-card font-semibold text-foreground hover:border-primary/40 hover:bg-secondary"
      : variant === "op"
        ? "border-primary/20 bg-primary/10 font-bold text-primary hover:bg-primary/20"
        : variant === "fn"
          ? "border-border/70 bg-secondary/70 font-medium text-secondary-foreground hover:bg-secondary"
          : variant === "primary"
            ? "border-primary bg-primary font-bold text-primary-foreground shadow-sm hover:brightness-110"
            : variant === "danger"
              ? "border-destructive/20 bg-destructive/15 font-bold text-destructive hover:bg-destructive/25"
              : "border-border bg-secondary font-medium text-foreground hover:bg-muted";

  return (
    <Button
      type="button"
      size="lg"
      variant="ghost"
      onClick={onClick}
      disabled={isDisabled}
      className={cn(
        spanClass,
        "rounded-xl border tracking-wide shadow-xs transition-all duration-150 active:scale-95",
        // 键位统一 48px：既够大够顺手，又能让「标准日常」整块键盘在一屏内显示完（不用滚动）
        size === "sm" ? "h-10 px-1 text-[11.5px]" : "h-12 px-1 text-sm sm:text-base",
        variantClass
      )}
    >
      {children}
    </Button>
  );
}
