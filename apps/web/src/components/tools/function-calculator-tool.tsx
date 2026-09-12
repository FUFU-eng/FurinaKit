"use client";

/**
 * 函数计算器（工具 id：func-calc）
 *
 * 定位：一个真正围绕「函数」的计算工具 —— 选一个现成的函数填参数，或者自己定义 f(x) 做
 * 代入求值 / 生成函数值表 / 复合与反函数 / 分段函数，另外附一个「一列数 → 全部统计量」的统计台。
 *
 * 三块工作区：
 *   1. 函数库  ：左侧分类 + 预置列表，右侧参数输入与结果（复利、贷款、排列组合、阶乘、对数换底…）；
 *   2. 自定义 f(x)：左侧定义（表达式 / 签名 / 自变量与参数），右侧按子模式给出结果
 *                  （代入求值 / 函数值表 / 复合与反函数 / 分段函数），这一块给了更宽的工作区，
 *                  因为它天然是「左边写式子、右边看表」的并排结构；
 *   3. 统计    ：左侧一列数输入，右侧真正的统计量表格（含分位数、两种方差口径）。
 *
 * 表达式求值全部由本文件自己实现（词法 → 递归下降 → AST → 求值），**不使用 eval / new Function**，
 * 因此错误可以给出「第 N 个字符附近……」这种带定位的人话提示，而不是 SyntaxError。
 *
 * 下面 CORE 区（PURE:BEGIN ~ PURE:END）是纯逻辑：不引用 React、不涉及 JSX、不依赖任何第三方库，
 * 可以直接转译后在 Node 里跑单元测试对拍（与仓库里其它工具的做法一致）。
 */

import { useCallback, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BarChart3,
  Check,
  Copy,
  Download,
  Eraser,
  Layers,
  Plus,
  Sigma,
  Sliders,
  Sparkles,
  Table2,
  Trash2,
  Undo2,
  Workflow,
} from "lucide-react";
import { Button, Input, Textarea, Label, Badge } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useToolDraft } from "@/lib/use-tool-draft";
import { trackToolUsage } from "@/lib/analytics";

/* ============================== PURE:BEGIN ==============================
 * 纯计算核心：只依赖 ECMAScript 内建对象。
 * 想跑单测时把这一段原样抽出来转译即可（见报告里的命令）。
 * ====================================================================== */

/** 全工具统一的错误类型：message 一定是人话，pos 是出错字符下标（-1 表示位置未知） */
class CalcError extends Error {
  pos: number;
  constructor(message: string, pos = -1) {
    super(message);
    this.name = "CalcError";
    this.pos = pos;
  }
}

/** 抛出一条带定位的人话错误 */
function fail(message: string, pos = -1): never {
  throw new CalcError(message, pos);
}

/** 出错位置的中文说法（面向用户的文案里统一用它） */
function at(pos: number): string {
  return `第 ${pos + 1} 个字符`;
}

function hasOwn(obj: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

/** 去掉浮点误差（0.30000000000000004 → 0.3），只用于展示与取样点清理 */
function cleanFloat(x: number): number {
  if (!Number.isFinite(x)) return x;
  if (x === 0) return 0; // 负零归一化成 0，免得界面上出现 "-0"
  return Number(x.toPrecision(12));
}

/* ------------------------------ 数字格式化 ------------------------------ */

type NumberFormat = { precision: number; group: boolean };

/** 把数字渲染成人看的文本：最多保留 precision 位小数（去掉多余的尾零）、可选千分位、极小/极大值转科学计数 */
function formatNumber(v: number, fmt: NumberFormat): string {
  if (Number.isNaN(v)) return "不是数";
  if (!Number.isFinite(v)) return v > 0 ? "+∞" : "−∞";
  if (Object.is(v, -0)) v = 0;
  const p = Math.max(0, Math.min(15, Math.floor(fmt.precision)));
  const abs = Math.abs(v);
  // 太大或太小：定点写法会变成一串 0，改用科学计数法
  if (abs !== 0 && (abs >= 1e15 || abs < Math.pow(10, -p) / 2)) {
    let text = v.toExponential(Math.min(10, Math.max(0, p)));
    text = text.replace(/\.?0+e/, "e");
    return text;
  }
  let text = v.toFixed(p);
  if (text.indexOf(".") >= 0) {
    text = text.replace(/0+$/, "");
    text = text.replace(/\.$/, "");
  }
  if (text === "" || text === "-") text = "0";
  if (fmt.group) {
    const neg = text.charAt(0) === "-";
    const body = neg ? text.slice(1) : text;
    const dot = body.indexOf(".");
    const intPart = dot >= 0 ? body.slice(0, dot) : body;
    const rest = dot >= 0 ? body.slice(dot) : "";
    text = (neg ? "-" : "") + intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",") + rest;
  }
  return text;
}

/** 文案里引用一个数字时的简写 */
function numText(v: number): string {
  return formatNumber(v, { precision: 6, group: false });
}

/* ------------------------------ 词法分析 ------------------------------ */

type Tok =
  | { k: "num"; v: number; text: string; pos: number }
  | { k: "name"; text: string; pos: number }
  | { k: "op"; text: string; pos: number };

/** 全角/中文标点统一成半角（都是 1 个字符换 1 个字符，出错位置不会偏） */
const NORMALIZE_MAP: Record<string, string> = {
  "×": "*", "·": "*", "⋅": "*", "＊": "*",
  "÷": "/", "／": "/",
  "−": "-", "–": "-", "—": "-", "－": "-",
  "（": "(", "）": ")", "【": "(", "】": ")", "[": "(", "]": "(",
  "{": "(", "}": "(",
  "，": ",", "、": ",", "；": ";", "：": ":",
  "＋": "+", "％": "%", "＾": "^", "＝": "=", "＜": "<", "＞": ">",
  "　": " ",
};

function normalizeExpr(src: string): string {
  let out = "";
  for (let i = 0; i < src.length; i += 1) {
    const ch = src.charAt(i);
    out += hasOwn(NORMALIZE_MAP, ch) ? NORMALIZE_MAP[ch] : ch;
  }
  return out;
}

function isDigit(ch: string | undefined): boolean {
  return !!ch && ch >= "0" && ch <= "9";
}

function isIdentStart(ch: string | undefined): boolean {
  if (!ch) return false;
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || ch === "π";
}

function isIdentPart(ch: string | undefined): boolean {
  return isIdentStart(ch) || isDigit(ch);
}

const TWO_CHAR_OPS: Record<string, string> = {
  "<=": "<=", ">=": ">=", "==": "=", "!=": "!=", "<>": "!=", "**": "^", "&&": "&&", "||": "||",
};

/** 一行式子 → token 数组。任何看不懂的字符都在这里被拦住，并给出位置。 */
function tokenizeExpression(src: string): Tok[] {
  const input = normalizeExpr(src);
  const out: Tok[] = [];
  let i = 0;
  while (i < input.length) {
    const ch = input.charAt(i);
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i += 1;
      continue;
    }
    // 数字（含小数、科学计数法）
    if (isDigit(ch) || (ch === "." && isDigit(input.charAt(i + 1)))) {
      const start = i;
      while (isDigit(input.charAt(i))) i += 1;
      if (input.charAt(i) === "." && input.charAt(i + 1) !== ".") {
        i += 1;
        while (isDigit(input.charAt(i))) i += 1;
      }
      if (input.charAt(i) === "e" || input.charAt(i) === "E") {
        const n1 = input.charAt(i + 1);
        const n2 = input.charAt(i + 2);
        if (isDigit(n1) || ((n1 === "+" || n1 === "-") && isDigit(n2))) {
          i += 1;
          if (input.charAt(i) === "+" || input.charAt(i) === "-") i += 1;
          while (isDigit(input.charAt(i))) i += 1;
        }
      }
      const text = input.slice(start, i);
      const v = Number(text);
      if (!Number.isFinite(v)) fail(`${at(start)}的数字「${text}」超出了可表示范围`, start);
      out.push({ k: "num", v, text, pos: start });
      continue;
    }
    // 名字（变量 / 函数 / 常量）
    if (isIdentStart(ch)) {
      const start = i;
      while (isIdentPart(input.charAt(i))) i += 1;
      out.push({ k: "name", text: input.slice(start, i), pos: start });
      continue;
    }
    // 区间写法
    if (ch === "." && input.charAt(i + 1) === ".") {
      fail(
        `${at(i)}的「..」是取值列表里的区间写法（例如 1..10），不能写进表达式；表达式里请用具体的数或变量`,
        i,
      );
    }
    const two = input.slice(i, i + 2);
    if (hasOwn(TWO_CHAR_OPS, two)) {
      out.push({ k: "op", text: TWO_CHAR_OPS[two], pos: i });
      i += 2;
      continue;
    }
    if ("+-*/^%(),;:<>=".indexOf(ch) >= 0) {
      out.push({ k: "op", text: ch, pos: i });
      i += 1;
      continue;
    }
    if (ch === ".") {
      fail(`${at(i)}有个多余的「.」，小数点两边要都是数字（例如 0.5）`, i);
    }
    fail(
      `${at(i)}的「${ch}」看不懂：这里可以写数字、变量名、+ - * / ^ % 、括号、逗号和函数名`,
      i,
    );
  }
  return out;
}

/* ------------------------------ 常量与函数 ------------------------------ */

const MATH_CONSTS: Record<string, number> = {
  pi: Math.PI,
  "π": Math.PI,
  e: Math.E,
  tau: Math.PI * 2,
};

type FnDef = {
  /** 允许的参数个数；[-1] 表示「1 个或多个」 */
  arity: number[];
  doc: string;
  fn: (a: number[]) => number;
};

function requireUnitRange(x: number, name: string): number {
  if (x < -1 || x > 1) {
    fail(`${name} 的输入必须在 -1 到 1 之间（它是 sin/cos 的值域），收到 ${numText(x)}`);
  }
  return x;
}

function requirePositiveLog(x: number, name: string): number {
  if (!(x > 0)) fail(`${name} 的真数必须大于 0，收到 ${numText(x)}`);
  return x;
}

const FN_DEFS: Record<string, FnDef> = {
  sin: { arity: [1], doc: "正弦（弧度）", fn: (a) => Math.sin(a[0]) },
  cos: { arity: [1], doc: "余弦（弧度）", fn: (a) => Math.cos(a[0]) },
  tan: {
    arity: [1],
    doc: "正切（弧度）",
    fn: (a) => {
      if (Math.abs(Math.cos(a[0])) < 1e-12) {
        fail("tan 在 π/2 + kπ（也就是 90°、270°…）处没有定义，这个取值正好落在那里");
      }
      return Math.tan(a[0]);
    },
  },
  asin: { arity: [1], doc: "反正弦，返回弧度", fn: (a) => Math.asin(requireUnitRange(a[0], "asin")) },
  acos: { arity: [1], doc: "反余弦，返回弧度", fn: (a) => Math.acos(requireUnitRange(a[0], "acos")) },
  atan: { arity: [1], doc: "反正切，返回弧度", fn: (a) => Math.atan(a[0]) },
  sinh: { arity: [1], doc: "双曲正弦", fn: (a) => Math.sinh(a[0]) },
  cosh: { arity: [1], doc: "双曲余弦", fn: (a) => Math.cosh(a[0]) },
  tanh: { arity: [1], doc: "双曲正切", fn: (a) => Math.tanh(a[0]) },
  asinh: { arity: [1], doc: "反双曲正弦", fn: (a) => Math.asinh(a[0]) },
  acosh: {
    arity: [1],
    doc: "反双曲余弦",
    fn: (a) => {
      if (!(a[0] >= 1)) fail(`acosh 的输入必须不小于 1，收到 ${numText(a[0])}`);
      return Math.acosh(a[0]);
    },
  },
  atanh: {
    arity: [1],
    doc: "反双曲正切",
    fn: (a) => {
      if (!(Math.abs(a[0]) < 1)) fail(`atanh 的输入必须在 -1 到 1 之间（不含端点），收到 ${numText(a[0])}`);
      return Math.atanh(a[0]);
    },
  },
  exp: { arity: [1], doc: "e 的幂", fn: (a) => Math.exp(a[0]) },
  ln: { arity: [1], doc: "自然对数", fn: (a) => Math.log(requirePositiveLog(a[0], "ln")) },
  log: {
    arity: [1, 2],
    doc: "1 个参数时是自然对数，log(x, b) 是以 b 为底的对数",
    fn: (a) => {
      if (a.length === 1) return Math.log(requirePositiveLog(a[0], "log"));
      requirePositiveLog(a[0], "log 的真数");
      if (!(a[1] > 0)) fail(`log 的底数必须大于 0，收到 ${numText(a[1])}`);
      if (Math.abs(a[1] - 1) < 1e-15) fail("log 的底数不能是 1（以 1 为底的对数没有定义）");
      return Math.log(a[0]) / Math.log(a[1]);
    },
  },
  log2: { arity: [1], doc: "以 2 为底的对数", fn: (a) => Math.log2(requirePositiveLog(a[0], "log2")) },
  log10: { arity: [1], doc: "以 10 为底的对数", fn: (a) => Math.log10(requirePositiveLog(a[0], "log10")) },
  sqrt: {
    arity: [1],
    doc: "平方根",
    fn: (a) => {
      if (a[0] < 0) fail(`sqrt 只能对非负数开平方，收到 ${numText(a[0])}（负数在实数范围内没有平方根）`);
      return Math.sqrt(a[0]);
    },
  },
  cbrt: { arity: [1], doc: "立方根（负数也可以）", fn: (a) => Math.cbrt(a[0]) },
  abs: { arity: [1], doc: "绝对值", fn: (a) => Math.abs(a[0]) },
  sign: { arity: [1], doc: "符号（-1 / 0 / 1）", fn: (a) => Math.sign(a[0]) },
  floor: { arity: [1], doc: "向下取整", fn: (a) => Math.floor(a[0]) },
  ceil: { arity: [1], doc: "向上取整", fn: (a) => Math.ceil(a[0]) },
  round: {
    arity: [1, 2],
    doc: "四舍五入，round(x, 位数) 可指定小数位",
    fn: (a) => {
      const half = (x: number) => (x < 0 ? -Math.round(-x) : Math.round(x));
      if (a.length === 1) return half(a[0]);
      const d = a[1];
      if (!Number.isInteger(d) || d < 0 || d > 15) {
        fail(`round 的小数位数要填 0 到 15 之间的整数，收到 ${numText(d)}`);
      }
      const f = Math.pow(10, d);
      return half(a[0] * f) / f;
    },
  },
  min: { arity: [-1], doc: "最小值，可传多个数", fn: (a) => Math.min.apply(null, a) },
  max: { arity: [-1], doc: "最大值，可传多个数", fn: (a) => Math.max.apply(null, a) },
  mod: {
    arity: [2],
    doc: "取余（结果与被除数同号规则：向下取整余数，mod(-7,3)=2）",
    fn: (a) => {
      if (a[1] === 0) fail("mod 的除数是 0，算不出来");
      return a[0] - a[1] * Math.floor(a[0] / a[1]);
    },
  },
  atan2: { arity: [2], doc: "atan2(y, x)，返回该点与 x 轴正向的夹角", fn: (a) => Math.atan2(a[0], a[1]) },
  hypot: { arity: [-1], doc: "勾股长度 √(x²+y²+…)，可传多个数", fn: (a) => Math.hypot.apply(null, a) },
  fact: {
    arity: [1],
    doc: "阶乘 n!",
    fn: (a) => factorialExact(a[0]),
  },
  ncr: { arity: [2], doc: "组合数 C(n, r)", fn: (a) => combination(a[0], a[1]) },
  npr: { arity: [2], doc: "排列数 A(n, r)", fn: (a) => permutation(a[0], a[1]) },
  rad: { arity: [1], doc: "角度转弧度", fn: (a) => (a[0] * Math.PI) / 180 },
  deg: { arity: [1], doc: "弧度转角度", fn: (a) => (a[0] * 180) / Math.PI },
};

/** 名字 → 说明（含 pow，pow 在语法阶段被改写成乘方） */
const FUNC_DOCS: Record<string, string> = (function buildDocs() {
  const out: Record<string, string> = { pow: "乘方，pow(a, b) 等价于 a^b" };
  for (const k of Object.keys(FN_DEFS)) out[k] = FN_DEFS[k].doc;
  return out;
})();

/** 语法速查里展示的函数名清单（顺序固定，便于用户扫读） */
const FUNC_NAME_LIST = [
  "sin", "cos", "tan", "asin", "acos", "atan",
  "sinh", "cosh", "tanh", "asinh", "acosh", "atanh",
  "exp", "ln", "log", "log2", "log10", "sqrt", "cbrt",
  "abs", "sign", "floor", "ceil", "round", "min", "max",
  "mod", "pow", "atan2", "hypot", "fact", "ncr", "npr", "rad", "deg",
];

/* ------------------------------ 组合数学 ------------------------------ */

function factorialExact(n: number): number {
  if (!Number.isFinite(n)) fail("阶乘要填一个数");
  if (!Number.isInteger(n)) fail(`阶乘只对整数有定义，收到 ${numText(n)}`);
  if (n < 0) fail(`阶乘只对非负整数有定义，收到 ${numText(n)}（(-3)! 没有意义）`);
  if (n > 170) fail("阶乘最多算到 170!，再大就超出双精度浮点的表示范围了");
  let r = 1;
  for (let i = 2; i <= n; i += 1) r *= i;
  return r;
}

function combination(n: number, m: number): number {
  if (!Number.isInteger(n) || !Number.isInteger(m)) {
    fail(`组合数 C(n, m) 的 n 与 m 都要是整数，收到 n=${numText(n)}, m=${numText(m)}`);
  }
  if (n < 0 || m < 0) fail("组合数 C(n, m) 的 n 与 m 都要是非负整数");
  if (m > n) fail(`从 ${numText(n)} 个里取 ${numText(m)} 个不成立：必须满足 0 ≤ m ≤ n`);
  const k = Math.min(m, n - m);
  let r = 1;
  for (let i = 1; i <= k; i += 1) r = (r * (n - k + i)) / i;
  return Math.round(r);
}

function permutation(n: number, m: number): number {
  if (!Number.isInteger(n) || !Number.isInteger(m)) {
    fail(`排列数 A(n, m) 的 n 与 m 都要是整数，收到 n=${numText(n)}, m=${numText(m)}`);
  }
  if (n < 0 || m < 0) fail("排列数 A(n, m) 的 n 与 m 都要是非负整数");
  if (m > n) fail(`从 ${numText(n)} 个里取 ${numText(m)} 个排列不成立：必须满足 0 ≤ m ≤ n`);
  let r = 1;
  for (let i = 0; i < m; i += 1) r *= n - i;
  return r;
}

/* ------------------------------ 语法树与解析 ------------------------------ */

type Ast =
  | { t: "num"; v: number }
  | { t: "var"; name: string }
  | { t: "neg"; a: Ast }
  | { t: "bin"; op: string; a: Ast; b: Ast }
  | { t: "call"; name: string; args: Ast[] };

type ParseState = { tokens: Tok[]; i: number; vars: string[] };

/** 从一段 token 里找出所有自由变量名（函数名、常量名不算） */
function detectVarNames(tokens: Tok[]): string[] {
  const names: string[] = [];
  const push = (n: string) => {
    if (n.length === 0) return;
    if (names.indexOf(n) < 0) names.push(n);
  };
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (t.k !== "name") continue;
    const lower = t.text.toLowerCase();
    const next = tokens[i + 1];
    const isCall = !!next && next.k === "op" && next.text === "(";
    if (isCall && hasOwn(FUNC_DOCS, lower)) continue;
    if (hasOwn(MATH_CONSTS, lower)) continue;
    if (t.text.length === 1) {
      push(t.text);
      continue;
    }
    // 多字母名字：拆成单字母的隐式乘法（xy → x、y），想用多字母变量名请在签名里声明
    const chars = t.text.split("");
    let ok = true;
    for (const c of chars) if (!isIdentStart(c)) ok = false;
    if (!ok) continue;
    for (const c of chars) push(c);
  }
  return names;
}

/** 把 "xy" 按已声明的变量名拆成 ["x","y"]；拆不动就返回 null */
function splitVarName(name: string, vars: string[]): string[] | null {
  if (vars.length === 0) return null;
  const sorted = vars.slice().sort((a, b) => b.length - a.length);
  const out: string[] = [];
  let i = 0;
  while (i < name.length) {
    let matched = "";
    for (const v of sorted) {
      if (v.length > 0 && name.startsWith(v, i)) {
        matched = v;
        break;
      }
    }
    if (!matched) return null;
    out.push(matched);
    i += matched.length;
  }
  return out.length >= 2 ? out : null;
}

function parseTokens(tokens: Tok[], vars: string[]): Ast {
  if (tokens.length === 0) fail("表达式是空的，先写一个式子，例如 x^2 + 1");
  const st: ParseState = { tokens, i: 0, vars };
  const ast = parseSum(st);
  if (st.i < tokens.length) {
    const t = st.tokens[st.i];
    const text = t.k === "num" ? t.text : t.text;
    if (t.k === "op" && t.text === ")") fail(`${at(t.pos)}有个多余的右括号「)」`, t.pos);
    if (t.k === "op" && t.text === ",") {
      fail(`${at(t.pos)}有个多余的逗号「,」：逗号只用来分隔函数参数（例如 max(1, 2)）或取值列表`, t.pos);
    }
    if (t.k === "op" && t.text === ";") {
      fail(`${at(t.pos)}有个多余的分号「;」：分号只用来分隔签名里的自变量与参数（例如 f(x; a)）`, t.pos);
    }
    if (t.k === "op" && t.text === ":") {
      fail(`${at(t.pos)}有个多余的冒号「:」：冒号只用来写区间步长（1..10:2）或分段条件`, t.pos);
    }
    if (t.k === "op" && ["<", ">", "<=", ">=", "=", "!=", "&&", "||"].indexOf(t.text) >= 0) {
      fail(
        `${at(t.pos)}的「${t.text}」只能用在分段函数的条件里，表达式里不能用比较/逻辑运算符`,
        t.pos,
      );
    }
    fail(`${at(t.pos)}附近多了一个「${text}」，检查一下是不是漏了运算符或括号`, t.pos);
  }
  return ast;
}

function parseSum(st: ParseState): Ast {
  let left = parseProduct(st);
  for (;;) {
    const t = st.tokens[st.i];
    if (t && t.k === "op" && (t.text === "+" || t.text === "-")) {
      st.i += 1;
      const right = parseProduct(st);
      left = { t: "bin", op: t.text, a: left, b: right };
      continue;
    }
    return left;
  }
}

function parseProduct(st: ParseState): Ast {
  let left = parseUnary(st);
  for (;;) {
    const t = st.tokens[st.i];
    if (!t) return left;
    if (t.k === "op" && (t.text === "*" || t.text === "/" || t.text === "%")) {
      st.i += 1;
      const right = parseUnary(st);
      left = { t: "bin", op: t.text, a: left, b: right };
      continue;
    }
    // 隐式乘法：2x、3sin(x)、xy、2(x+1)、(x+1)(x-1)
    if (t.k === "num" || t.k === "name" || (t.k === "op" && t.text === "(")) {
      const prev = st.tokens[st.i - 1];
      // 两个数字紧挨着（1.2.3）几乎一定是漏了运算符，直接点出来而不是悄悄相乘
      if (prev && prev.k === "num" && t.k === "num" && prev.pos + prev.text.length === t.pos) {
        fail(
          `${at(t.pos)}：「${prev.text}」和「${t.text}」两个数字挨在一起了，中间需要一个运算符（千分位逗号也要去掉）`,
          t.pos,
        );
      }
      const right = parseUnary(st);
      left = { t: "bin", op: "*", a: left, b: right };
      continue;
    }
    return left;
  }
}

function parseUnary(st: ParseState): Ast {
  const t = st.tokens[st.i];
  if (t && t.k === "op" && (t.text === "-" || t.text === "+")) {
    st.i += 1;
    const a = parseUnary(st);
    return t.text === "-" ? { t: "neg", a } : a;
  }
  return parsePower(st);
}

function parsePower(st: ParseState): Ast {
  const base = parseAtom(st);
  const t = st.tokens[st.i];
  if (t && t.k === "op" && t.text === "^") {
    st.i += 1;
    const exp = parseUnary(st);
    return { t: "bin", op: "^", a: base, b: exp };
  }
  return base;
}

function parseAtom(st: ParseState): Ast {
  const t = st.tokens[st.i];
  if (!t) fail("表达式结尾还缺一个数（最后一个运算符后面什么都没有）");
  if (t.k === "num") {
    st.i += 1;
    return { t: "num", v: t.v };
  }
  if (t.k === "op" && t.text === "(") {
    st.i += 1;
    const inner = parseSum(st);
    const close = st.tokens[st.i];
    if (!close || close.k !== "op" || close.text !== ")") {
      fail(`${at(t.pos)}的左括号「(」没有找到配对的右括号「)」`, t.pos);
    }
    st.i += 1;
    return inner;
  }
  if (t.k === "op") {
    if (t.text === ",") fail(`${at(t.pos)}有个多余的逗号「,」（逗号用来分隔函数参数）`, t.pos);
    if (t.text === ";") fail(`${at(t.pos)}的分号「;」放错了位置（分号用来分隔签名里的自变量与参数）`, t.pos);
    if (t.text === ":") fail(`${at(t.pos)}的冒号「:」放错了位置（冒号用来写区间步长或分段条件）`, t.pos);
    fail(`${at(t.pos)}附近有个多余的运算符「${t.text}」`, t.pos);
  }
  return parseName(st, t);
}

function parseName(st: ParseState, t: { text: string; pos: number }): Ast {
  const lower = t.text.toLowerCase();
  // 1) 已声明的变量名（区分大小写）优先
  if (st.vars.indexOf(t.text) >= 0) {
    st.i += 1;
    return { t: "var", name: t.text };
  }
  // 2) 常量
  if (hasOwn(MATH_CONSTS, lower)) {
    st.i += 1;
    return { t: "num", v: MATH_CONSTS[lower] };
  }
  // 3) 函数（必须跟括号）
  if (hasOwn(FUNC_DOCS, lower)) {
    const nxt = st.tokens[st.i + 1];
    if (!nxt || nxt.k !== "op" || nxt.text !== "(") {
      fail(`${at(t.pos)}的「${t.text}」是函数名，后面要跟一对括号，例如 ${lower}(x)`, t.pos);
    }
    st.i += 2;
    const args: Ast[] = [];
    const first = st.tokens[st.i];
    if (first && first.k === "op" && first.text === ")") {
      st.i += 1;
    } else {
      for (;;) {
        args.push(parseSum(st));
        const sep = st.tokens[st.i];
        if (!sep) {
          fail(`${at(t.pos)}的函数 ${lower}( 少了配对的右括号「)」`, t.pos);
        }
        if (sep.k === "op" && (sep.text === "," || sep.text === ";")) {
          st.i += 1;
          continue;
        }
        if (sep.k === "op" && sep.text === ")") {
          st.i += 1;
          break;
        }
        fail(`${at(sep.pos)}附近：函数 ${lower} 的参数之间要用「,」分隔，并以「)」结束`, sep.pos);
      }
    }
    if (lower === "pow") {
      if (args.length !== 2) {
        fail(`${at(t.pos)}的 pow 需要 2 个参数（底数与指数），现在给了 ${args.length} 个`, t.pos);
      }
      return { t: "bin", op: "^", a: args[0], b: args[1] };
    }
    const def = FN_DEFS[lower];
    const variadic = def.arity.indexOf(-1) >= 0;
    if (!variadic && def.arity.indexOf(args.length) < 0) {
      const want = def.arity.map((n) => String(n)).join(" 或 ");
      fail(`${at(t.pos)}的 ${lower} 需要 ${want} 个参数，现在给了 ${args.length} 个`, t.pos);
    }
    if (variadic && args.length === 0) {
      fail(`${at(t.pos)}的 ${lower} 至少要给 1 个参数`, t.pos);
    }
    return { t: "call", name: lower, args };
  }
  // 4) 多字母名字后面直接跟括号：几乎一定是函数名打错了，明确点出来
  const after = st.tokens[st.i + 1];
  if (after && after.k === "op" && after.text === "(" && t.text.length > 1) {
    fail(
      `${at(t.pos)}的「${t.text}」不认识：它不是本工具支持的函数名（可用的函数名见左边的速查表）；` +
        `如果它是一个多字母的变量，请先在签名里声明（例如 f(${t.text})）`,
      t.pos,
    );
  }
  // 5) 多字母名字按已声明变量拆成隐式乘法
  const parts = splitVarName(t.text, st.vars);
  if (parts) {
    st.i += 1;
    let node: Ast = { t: "var", name: parts[0] };
    for (let k = 1; k < parts.length; k += 1) {
      node = { t: "bin", op: "*", a: node, b: { t: "var", name: parts[k] } };
    }
    return node;
  }
  // 6) 实在不认识的标识符
  fail(
    `${at(t.pos)}的「${t.text}」不认识：它既不是已声明的变量，也不是本工具支持的函数名。` +
      `如果它是参数，请在签名里写出来（例如 f(x; ${t.text})）再到参数区填值`,
    t.pos,
  );
}

/* ------------------------------ 函数定义解析 ------------------------------ */

type Signature = { name?: string; vars: string[]; params: string[] };

function splitNameList(src: string): string[] | null {
  const trimmed = src.trim();
  if (trimmed.length === 0) return [];
  const parts = trimmed.split(",");
  const out: string[] = [];
  for (const raw of parts) {
    const name = raw.trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return null;
    if (out.indexOf(name) < 0) out.push(name);
  }
  return out;
}

/** 解析签名：f(x; a, b) / (x; a, b) / x; a, b 都接受 */
function parseSignature(src: string): Signature | null {
  let body = src.trim();
  if (body.length === 0) return null;
  let name: string | undefined;
  const m = /^([A-Za-z_][A-Za-z0-9_]*)?\s*\(([\s\S]*)\)$/.exec(body);
  if (m) {
    name = m[1] || undefined;
    body = m[2];
  }
  const groups = body.split(";");
  if (groups.length > 2) return null;
  const vars = splitNameList(groups[0]);
  const params = groups.length > 1 ? splitNameList(groups[1]) : [];
  if (vars === null || params === null) return null;
  if (vars.length === 0) return null;
  return { name, vars, params };
}

type HeaderInfo = { name?: string; vars: string[]; params: string[]; body: string; headerText: string };

/**
 * 允许整行粘贴 "y = 2x + 1" 这种写法时，只有这些「一眼就是结果」的名字才当作输出名剥掉。
 * 其它名字（例如 "x = 3"）不剥，让它落到「= 不能出现在表达式里」的提示上，避免把
 * 用户想表达的约束悄悄当成恒等函数。
 */
const OUTPUT_NAMES = ["y", "f", "g", "h", "ans", "out", "result", "value"];

/** 允许用户把 "f(x) = x^2 + 1"、"y = 2x + 1" 整行贴进来，这里把头部剥掉 */
function stripFunctionHeader(src: string): HeaderInfo {
  const s = src;
  const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)?\s*\(([^()]*)\)\s*=\s*([\s\S]+)$/.exec(s);
  if (m) {
    const groups = m[2].split(";");
    if (groups.length <= 2) {
      const vars = splitNameList(groups[0]);
      const params = groups.length > 1 ? splitNameList(groups[1]) : [];
      if (vars && params && vars.length > 0) {
        const body = m[3];
        return {
          name: m[1] || undefined,
          vars,
          params,
          body,
          headerText: s.slice(0, s.length - body.length),
        };
      }
    }
  }
  const m2 = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*([\s\S]+)$/.exec(s);
  if (m2 && OUTPUT_NAMES.indexOf(m2[1].toLowerCase()) >= 0) {
    const body = m2[2];
    return { name: m2[1], vars: [], params: [], body, headerText: s.slice(0, s.length - body.length) };
  }
  return { vars: [], params: [], body: s, headerText: "" };
}

type CompiledExpression = { ast: Ast; vars: string[]; params: string[]; body: string; headerText: string };

/**
 * 把一段式子编译成 AST。
 * declared 为 null 时自动识别自变量（多字母名字按单字母隐式乘拆开）。
 */
function compileExpression(src: string, declared: Signature | null): CompiledExpression {
  const header = stripFunctionHeader(src);
  const body = header.body;
  const tokens = tokenizeExpression(body);
  const fromHeader = header.vars.length > 0 ? { vars: header.vars, params: header.params } : null;
  const sig = fromHeader || declared;
  const vars = sig ? sig.vars : detectVarNames(tokens);
  const params = sig ? sig.params : [];
  const all: string[] = [];
  for (const n of vars.concat(params)) if (all.indexOf(n) < 0) all.push(n);
  const ast = parseTokens(tokens, all);
  return { ast, vars, params, body, headerText: header.headerText };
}

/* ------------------------------ 求值 ------------------------------ */

/**
 * 负底数的实数次方。
 * JS 的 Math.pow(-8, 1/3) 是 NaN，但数学上 (-8)^(1/3) = -2（奇次方根有实数解）。
 * 这里把指数写成 p/q（q 是不超过 64 的奇数）时按实数根计算；真正没有实数结果的
 * 情况（例如 (-2)^0.5）返回 NaN，由调用方报人话错误。
 */
function realPower(base: number, exp: number): number {
  if (base >= 0 || Number.isInteger(exp)) return Math.pow(base, exp);
  for (let q = 3; q <= 64; q += 2) {
    const p = exp * q;
    if (Math.abs(p - Math.round(p)) < 1e-9) {
      const sign = Math.abs(Math.round(p)) % 2 === 0 ? 1 : -1;
      return sign * Math.pow(Math.abs(base), exp);
    }
  }
  return NaN;
}

function applyBinOp(op: string, a: number, b: number): number {
  switch (op) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "*":
      return a * b;
    case "/":
      if (b === 0) fail(`分母算出来是 0，除法没有意义（${numText(a)} ÷ 0）`);
      return a / b;
    case "%":
      if (b === 0) fail("取余运算的除数是 0，算不出来");
      return a - b * Math.floor(a / b);
    case "^":
      if (a === 0 && b < 0) fail("0 的负数次方没有意义（等于除以 0）");
      if (a < 0 && !Number.isInteger(b)) {
        const r = realPower(a, b);
        if (Number.isNaN(r)) {
          fail(`负数的非整数次方在实数范围内没有意义：(${numText(a)})^${numText(b)}（只有奇次方根才有实数解，例如 (-8)^(1/3) = -2）`);
        }
        return r;
      }
      return Math.pow(a, b);
    default:
      return fail(`不支持的运算符「${op}」`);
  }
}

function evalAst(ast: Ast, env: Record<string, number>): number {
  switch (ast.t) {
    case "num":
      return ast.v;
    case "var": {
      const v = env[ast.name];
      if (typeof v !== "number" || Number.isNaN(v)) {
        fail(`变量「${ast.name}」还没有取值，请在输入框里填一个数`);
      }
      return v;
    }
    case "neg":
      return -evalAst(ast.a, env);
    case "bin":
      return applyBinOp(ast.op, evalAst(ast.a, env), evalAst(ast.b, env));
    case "call": {
      const vals = ast.args.map((x) => evalAst(x, env));
      const def = FN_DEFS[ast.name];
      if (!def) fail(`不支持的函数「${ast.name}」`);
      return def.fn(vals);
    }
    default:
      return fail("表达式结构有问题，无法求值");
  }
}

/** 结果必须是有限实数，否则给出人话提示（而不是让 NaN / Infinity 流到界面上） */
function checkFinite(v: number, label = "结果"): number {
  if (Number.isNaN(v)) fail(`${label}不是实数（出现了 0÷0、负数开偶次方这类情况）`);
  if (!Number.isFinite(v)) fail(`${label}超出可计算范围（数量级太大，双精度浮点表示不了）`);
  return v;
}

/** 常量算式（取值列表里的 "2*pi" 这种），不允许出现变量 */
function evalConstant(src: string): number {
  const tokens = tokenizeExpression(src);
  const ast = parseTokens(tokens, []);
  return checkFinite(evalAst(ast, {}), "这个数");
}

/* ------------------------------ 表达式打印与化简 ------------------------------ */

const OP_PREC: Record<string, number> = { "+": 1, "-": 1, "*": 2, "/": 2, "%": 2, "^": 4 };

function precOf(ast: Ast): number {
  if (ast.t === "bin") return OP_PREC[ast.op];
  if (ast.t === "neg") return 3;
  return 5;
}

function numLiteral(v: number): string {
  if (Number.isInteger(v) && Math.abs(v) < 1e15) return String(v);
  return String(cleanFloat(v));
}

/** AST → 式子文本（带回正确括号的还原打印，用于展示「符号结果」与「代入过程」） */
function formatAst(ast: Ast, parentPrec = 0): string {
  if (ast.t === "num") return numLiteral(ast.v);
  if (ast.t === "var") return ast.name;
  if (ast.t === "call") return `${ast.name}(${ast.args.map((x) => formatAst(x, 0)).join(", ")})`;
  if (ast.t === "neg") {
    const inner = formatAst(ast.a, 4);
    const text = `-${inner}`;
    return precOf(ast) < parentPrec ? `(${text})` : text;
  }
  const p = OP_PREC[ast.op];
  // 负数字面量：a + (−5) 写成 a − 5、a − (−5) 写成 a + 5、乘除法里的负数加括号，
  // 目的是让「代入过程」读起来像数学式子，而不是一堆连着符号的数字。
  if ((ast.op === "+" || ast.op === "-") && ast.b.t === "num" && ast.b.v < 0) {
    const sign = ast.op === "+" ? "-" : "+";
    const text = `${formatAst(ast.a, p)} ${sign} ${numLiteral(-ast.b.v)}`;
    return p < parentPrec ? `(${text})` : text;
  }
  const negNumNeedsParen = (node: Ast) =>
    node.t === "num" && node.v < 0 && (ast.op === "*" || ast.op === "/" || ast.op === "%");
  const leftNeeds =
    precOf(ast.a) < p || (ast.op === "^" && precOf(ast.a) <= p) || negNumNeedsParen(ast.a);
  const rightNeeds =
    precOf(ast.b) < p ||
    ((ast.op === "-" || ast.op === "/" || ast.op === "%") && precOf(ast.b) <= p) ||
    negNumNeedsParen(ast.b);
  const text = `${leftNeeds ? `(${formatAst(ast.a, 0)})` : formatAst(ast.a, p)} ${ast.op} ${
    rightNeeds ? `(${formatAst(ast.b, 0)})` : formatAst(ast.b, p)
  }`;
  return p < parentPrec ? `(${text})` : text;
}

/** 轻度化简：常量折叠 + 加减乘除的单位元，用来让符号结果好看一点 */
function simplify(ast: Ast): Ast {
  switch (ast.t) {
    case "num":
    case "var":
      return ast;
    case "neg": {
      const a = simplify(ast.a);
      if (a.t === "num") return { t: "num", v: -a.v };
      if (a.t === "neg") return a.a;
      return { t: "neg", a };
    }
    case "call":
      return { t: "call", name: ast.name, args: ast.args.map(simplify) };
    case "bin": {
      const a = simplify(ast.a);
      const b = simplify(ast.b);
      if (a.t === "num" && b.t === "num") {
        // 除法不折叠：1/3 折叠成 0.333… 之后，符号结果里会看不出这是三分之一
        if (ast.op !== "/" && ast.op !== "%") {
          const val = applyBinOp(ast.op, a.v, b.v);
          if (Number.isFinite(val)) return { t: "num", v: cleanFloat(val) };
        }
        return { t: "bin", op: ast.op, a, b };
      }
      if (ast.op === "+") {
        if (a.t === "num" && a.v === 0) return b;
        if (b.t === "num" && b.v === 0) return a;
      }
      if (ast.op === "-" && b.t === "num" && b.v === 0) return a;
      if (ast.op === "*") {
        if ((a.t === "num" && a.v === 0) || (b.t === "num" && b.v === 0)) return { t: "num", v: 0 };
        if (a.t === "num" && a.v === 1) return b;
        if (b.t === "num" && b.v === 1) return a;
      }
      if (ast.op === "/") {
        if (b.t === "num" && b.v === 1) return a;
      }
      if (ast.op === "^") {
        if (b.t === "num" && b.v === 1) return a;
        if (b.t === "num" && b.v === 0) return { t: "num", v: 1 };
      }
      return { t: "bin", op: ast.op, a, b };
    }
    default:
      return ast;
  }
}

function containsVar(ast: Ast, name: string): boolean {
  if (ast.t === "var") return ast.name === name;
  if (ast.t === "num") return false;
  if (ast.t === "neg") return containsVar(ast.a, name);
  if (ast.t === "bin") return containsVar(ast.a, name) || containsVar(ast.b, name);
  return ast.args.some((x) => containsVar(x, name));
}

function collectVarNames(ast: Ast, into: string[] = []): string[] {
  if (ast.t === "var") {
    if (into.indexOf(ast.name) < 0) into.push(ast.name);
  } else if (ast.t === "neg") {
    collectVarNames(ast.a, into);
  } else if (ast.t === "bin") {
    collectVarNames(ast.a, into);
    collectVarNames(ast.b, into);
  } else if (ast.t === "call") {
    for (const x of ast.args) collectVarNames(x, into);
  }
  return into;
}

function substituteVar(ast: Ast, name: string, repl: Ast): Ast {
  if (ast.t === "num") return ast;
  if (ast.t === "var") return ast.name === name ? repl : ast;
  if (ast.t === "neg") return { t: "neg", a: substituteVar(ast.a, name, repl) };
  if (ast.t === "bin") {
    return {
      t: "bin",
      op: ast.op,
      a: substituteVar(ast.a, name, repl),
      b: substituteVar(ast.b, name, repl),
    };
  }
  return { t: "call", name: ast.name, args: ast.args.map((x) => substituteVar(x, name, repl)) };
}

function renameVar(ast: Ast, from: string, to: string): Ast {
  return substituteVar(ast, from, { t: "var", name: to });
}

/** 把环境里的取值代进去（用于展示 "f(2) = 2^2 + 1 = 5" 这种过程） */
function substituteValues(ast: Ast, env: Record<string, number>): Ast {
  if (ast.t === "var") {
    const v = env[ast.name];
    return typeof v === "number" ? { t: "num", v } : ast;
  }
  if (ast.t === "num") return ast;
  if (ast.t === "neg") return { t: "neg", a: substituteValues(ast.a, env) };
  if (ast.t === "bin") {
    return {
      t: "bin",
      op: ast.op,
      a: substituteValues(ast.a, env),
      b: substituteValues(ast.b, env),
    };
  }
  return { t: "call", name: ast.name, args: ast.args.map((x) => substituteValues(x, env)) };
}

/* ------------------------------ 取值列表与值表 ------------------------------ */

const MAX_POINTS = 2000;
const MAX_TABLE_ROWS = 500;

/** 解析一个自变量的取值："3"、"1,2,3"、"1..10"、"1..10:2"、"10..1"、"0..1:0.25"、"0..2*pi" */
function parseValueList(src: string): number[] {
  const raw = src.trim();
  if (raw.length === 0) fail("请填写取值，例如 1..10、0, 0.5, 1、-3..3");
  const cleaned = raw.replace(/，/g, ",").replace(/、/g, ",").replace(/；/g, ",");
  const parts = cleaned
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) fail("取值是空的，请填写例如 1..10 或 1, 2, 3");
  const out: number[] = [];
  for (const part of parts) {
    if (part.indexOf("..") >= 0) {
      const ci = part.indexOf(":");
      const rangePart = ci >= 0 ? part.slice(0, ci) : part;
      const stepPart = ci >= 0 ? part.slice(ci + 1) : "";
      const di = rangePart.indexOf("..");
      const aStr = rangePart.slice(0, di).trim();
      const bStr = rangePart.slice(di + 2).trim();
      if (aStr.length === 0 || bStr.length === 0) {
        fail(`区间写法不完整：「${part}」，正确写法是 起点..终点（例如 1..10），要指定步长写 1..10:2`);
      }
      let a: number;
      let b: number;
      try {
        a = evalConstant(aStr);
        b = evalConstant(bStr);
      } catch (e) {
        fail(`区间「${part}」的两端要是能算出来的数：${errMessage(e)}`);
      }
      let step = 1;
      if (stepPart.trim().length > 0) {
        try {
          step = evalConstant(stepPart);
        } catch (e) {
          fail(`区间「${part}」的步长不对：${errMessage(e)}`);
        }
      }
      if (!Number.isFinite(step) || step === 0) fail(`区间「${part}」的步长不能是 0`);
      const absStep = Math.abs(step);
      const count = Math.floor(Math.abs(b - a) / absStep + 1e-9) + 1;
      if (count > MAX_POINTS) {
        fail(
          `区间「${part}」一共 ${count} 个点，超过 ${MAX_POINTS} 个上限；请把区间缩小或把步长调大（例如 ${numText(a)}..${numText(b)}:${numText(absStep * Math.ceil(count / MAX_POINTS))}）`,
        );
      }
      const dir = b >= a ? 1 : -1;
      for (let k = 0; k < count; k += 1) out.push(cleanFloat(a + dir * absStep * k));
    } else {
      try {
        out.push(evalConstant(part));
      } catch (e) {
        fail(`取值「${part}」不对：${errMessage(e)}`);
      }
    }
  }
  if (out.length > MAX_POINTS) {
    fail(`一共 ${out.length} 个取值，超过 ${MAX_POINTS} 个上限，请减少取值数量`);
  }
  return out;
}

type TableRow = { args: number[]; value: number | null; error: string };
type TableData = { varNames: string[]; rows: TableRow[]; okCount: number; errorCount: number };

/** 笛卡尔积形式的函数值表；单点出错只标注该行，不影响整张表 */
function buildValueTable(
  varNames: string[],
  lists: number[][],
  evaluate: (args: number[]) => number,
  maxRows = MAX_TABLE_ROWS,
): TableData {
  let total = 1;
  for (const l of lists) total *= l.length;
  if (total > maxRows) {
    fail(
      `这些取值组合起来有 ${total} 行，超过 ${maxRows} 行上限；请缩小取值范围或减少自变量个数`,
    );
  }
  const rows: TableRow[] = [];
  const idx = new Array(varNames.length).fill(0);
  let okCount = 0;
  let errorCount = 0;
  for (let n = 0; n < total; n += 1) {
    const args = idx.map((p, k) => lists[k][p]);
    let value: number | null = null;
    let error = "";
    try {
      value = checkFinite(evaluate(args));
      okCount += 1;
    } catch (e) {
      value = null;
      error = errMessage(e);
      errorCount += 1;
    }
    rows.push({ args, value, error });
    for (let k = varNames.length - 1; k >= 0; k -= 1) {
      idx[k] += 1;
      if (idx[k] < lists[k].length) break;
      idx[k] = 0;
    }
  }
  return { varNames, rows, okCount, errorCount };
}

function errMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}

function errPos(e: unknown): number {
  if (e instanceof CalcError) return e.pos;
  return -1;
}

/* ------------------------------ 复合与反函数 ------------------------------ */

type InverseResult = { ok: true; expr: Ast; notes: string[] } | { ok: false; reason: string };

const INV_PLACEHOLDER = "\u0001y";

const INVERSE_FN: Record<string, string> = {
  sin: "asin", cos: "acos", tan: "atan",
  asin: "sin", acos: "cos", atan: "tan",
  sinh: "asinh", cosh: "acosh", tanh: "atanh",
  asinh: "sinh", acosh: "cosh", atanh: "tanh",
};

/** 把 f(x) 的 AST 反解成 f⁻¹(y) 的 AST；只在目标变量「恰好出现一次」时成立 */
function invertAst(ast: Ast, target: string, notes: string[]): Ast | null {
  if (ast.t === "var") {
    return ast.name === target ? { t: "var", name: INV_PLACEHOLDER } : null;
  }
  if (ast.t === "num") return null;
  if (ast.t === "neg") {
    const inner = invertAst(ast.a, target, notes);
    if (!inner) return null;
    return { t: "neg", a: inner };
  }
  if (ast.t === "call") {
    if (ast.args.length !== 1) return null;
    const arg = ast.args[0];
    if (!containsVar(arg, target)) return null;
    const inner = invertAst(arg, target, notes);
    if (!inner) return null;
    const ph: Ast = { t: "var", name: INV_PLACEHOLDER };
    const name = ast.name;
    if (name === "exp" || name === "ln" || name === "log") {
      if (name === "exp") {
        const back = { t: "call", name: "ln", args: [ph] } as Ast;
        notes.push("f 里有 e 的幂，反函数里出现了对数：要求 y > 0");
        return substituteVar(inner, INV_PLACEHOLDER, back);
      }
      const back = { t: "call", name: "exp", args: [ph] } as Ast;
      notes.push("f 里有对数，反函数里出现了 e 的幂（指数函数对任意 y 都有定义）");
      return substituteVar(inner, INV_PLACEHOLDER, back);
    }
    if (name === "log2" || name === "log10") {
      const base = name === "log2" ? 2 : 10;
      const back: Ast = { t: "bin", op: "^", a: { t: "num", v: base }, b: ph };
      notes.push(`f 里是以 ${base} 为底的对数，反函数要求 y 的取值范围是全体实数（值域），自变量 x > 0`);
      return substituteVar(inner, INV_PLACEHOLDER, back);
    }
    if (name === "sqrt") {
      notes.push("f 里有平方根，反函数只对应 f 的「非负那一支」（x ≥ 0），取值时请注意");
      return substituteVar(inner, INV_PLACEHOLDER, { t: "bin", op: "^", a: ph, b: { t: "num", v: 2 } });
    }
    if (name === "cbrt") {
      notes.push("f 里有立方根，反函数是三次方（对全体实数都成立）");
      return substituteVar(inner, INV_PLACEHOLDER, { t: "bin", op: "^", a: ph, b: { t: "num", v: 3 } });
    }
    if (name === "rad" || name === "deg") {
      const other = name === "rad" ? "deg" : "rad";
      notes.push("f 里有角度/弧度换算，反函数里做了逆换算");
      return substituteVar(inner, INV_PLACEHOLDER, { t: "call", name: other, args: [ph] });
    }
    const back = INVERSE_FN[name];
    if (!back) return null;
    if (name === "sin" || name === "cos" || name === "tan" || name === "asin" || name === "acos" || name === "atan") {
      notes.push("三角函数不是单调的，反函数只给出主值区间里的那一个解（方程本身一般有多个解）");
    }
    return substituteVar(inner, INV_PLACEHOLDER, { t: "call", name: back, args: [ph] });
  }
  // 二元运算
  const a = ast.a;
  const b = ast.b;
  const inA = containsVar(a, target);
  const inB = containsVar(b, target);
  if (inA && inB) return null;
  if (!inA && !inB) return null;
  const ph: Ast = { t: "var", name: INV_PLACEHOLDER };
  const inner = invertAst(inA ? a : b, target, notes);
  if (!inner) return null;
  const other = inA ? b : a;
  switch (ast.op) {
    case "+":
      return substituteVar(inner, INV_PLACEHOLDER, { t: "bin", op: "-", a: ph, b: other });
    case "-":
      return substituteVar(
        inner,
        INV_PLACEHOLDER,
        inA ? { t: "bin", op: "+", a: ph, b: other } : { t: "bin", op: "-", a: other, b: ph },
      );
    case "*":
      return substituteVar(inner, INV_PLACEHOLDER, { t: "bin", op: "/", a: ph, b: other });
    case "/":
      if (inA) {
        return substituteVar(inner, INV_PLACEHOLDER, { t: "bin", op: "*", a: ph, b: other });
      }
      notes.push("f 的分母里含自变量，反函数里自变量出现在分母，注意 y ≠ 0");
      return substituteVar(inner, INV_PLACEHOLDER, { t: "bin", op: "/", a: other, b: ph });
    case "^":
      if (inB) {
        notes.push("f 的指数里含自变量，反函数里用到了对数：要求底数 > 0 且 ≠ 1，且 y > 0");
        return substituteVar(inner, INV_PLACEHOLDER, {
          t: "bin",
          op: "/",
          a: { t: "call", name: "ln", args: [ph] },
          b: { t: "call", name: "ln", args: [other] },
        });
      }
      if (other.t === "num" && Number.isInteger(other.v) && Math.abs(other.v) % 2 === 0) {
        notes.push("f 是偶次方，不单调：反函数只取「非负那一支」（x ≥ 0）");
      }
      return substituteVar(inner, INV_PLACEHOLDER, {
        t: "bin",
        op: "^",
        a: ph,
        b: { t: "bin", op: "/", a: { t: "num", v: 1 }, b: other },
      });
    default:
      return null;
  }
}

/** 符号求反函数：返回 f⁻¹(y) 的 AST */
function symbolicInverse(ast: Ast, target: string, outName = "y"): InverseResult {
  if (!containsVar(ast, target)) {
    return { ok: false, reason: `式子里没有出现自变量「${target}」，无法求反函数` };
  }
  const notes: string[] = [];
  const inv = invertAst(ast, target, notes);
  if (!inv) {
    return {
      ok: false,
      reason:
        "这个式子没法一步步剥出反函数（自变量出现了多次，或者用了绝对值 / 取整 / 阶乘这类不可逆的运算），已改用数值解法",
    };
  }
  return { ok: true, expr: renameVar(simplify(inv), INV_PLACEHOLDER, outName), notes };
}

/** 数值求反函数：先在区间上扫描找到变号子区间，再二分到 1e-12 */
function numericInverse(
  f: (x: number) => number,
  y: number,
  lo: number,
  hi: number,
  samples = 400,
): number[] {
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) fail("区间的两端要填具体的数");
  if (hi <= lo) fail(`区间的右端要大于左端（现在是 ${numText(lo)} 到 ${numText(hi)}）`);
  const tol = 1e-9;
  const safe = (x: number): number | null => {
    try {
      const v = f(x);
      return Number.isFinite(v) ? v : null;
    } catch {
      return null;
    }
  };
  const roots: number[] = [];
  const step = (hi - lo) / samples;
  let prevX = lo;
  let prevV = safe(lo);
  if (prevV !== null && Math.abs(prevV - y) < tol) roots.push(lo);
  for (let i = 1; i <= samples; i += 1) {
    const x = i === samples ? hi : lo + step * i;
    const v = safe(x);
    if (v !== null && prevV !== null) {
      const d0 = prevV - y;
      const d1 = v - y;
      if (d0 === 0) roots.push(prevX);
      else if (d0 * d1 < 0) {
        let a = prevX;
        let b = x;
        let fa = d0;
        for (let k = 0; k < 200; k += 1) {
          const mid = (a + b) / 2;
          const fm = safe(mid);
          if (fm === null) break;
          const dm = fm - y;
          if (dm === 0) {
            a = mid;
            b = mid;
            break;
          }
          if (fa * dm < 0) {
            b = mid;
          } else {
            a = mid;
            fa = dm;
          }
        }
        const root = (a + b) / 2;
        const check = safe(root);
        if (check !== null && Math.abs(check - y) < Math.max(tol, Math.abs(y) * 1e-7)) roots.push(root);
      }
    }
    prevX = x;
    prevV = v;
  }
  if (prevV !== null && Math.abs(prevV - y) < tol) roots.push(hi);
  const uniq: number[] = [];
  for (const r of roots.sort((p, q) => p - q)) {
    if (uniq.length === 0 || Math.abs(r - uniq[uniq.length - 1]) > 1e-6) uniq.push(r);
  }
  return uniq.slice(0, 8);
}

/** 复合：outer 里的 outerVar 用 inner 整体替换（调用方需先确认没有重名冲突） */
function composeAst(inner: Ast, outer: Ast, outerVar: string): Ast {
  return simplify(substituteVar(outer, outerVar, inner));
}

/* ------------------------------ 分段函数 ------------------------------ */

type CmpOp = "<" | "<=" | ">" | ">=" | "=" | "!=";

type CondAst =
  | { t: "cmp"; op: CmpOp; a: Ast; b: Ast }
  | { t: "and"; items: CondAst[] }
  | { t: "or"; items: CondAst[] };

type PieceRuleInput = { cond: string; expr: string };
type CompiledRule = { condAst: CondAst; ast: Ast; condText: string; exprText: string };
type CompiledPiecewise = { rules: CompiledRule[]; vars: string[] };

const CMP_OPS = ["<=", ">=", "!=", "=", "<", ">"];

function parseCondition(tokens: Tok[], vars: string[]): CondAst {
  if (tokens.length === 0) fail("条件是空的，例如 x < 0");
  const segments: Tok[][] = [];
  const joins: string[] = [];
  let current: Tok[] = [];
  for (const t of tokens) {
    if (t.k === "op" && (t.text === "&&" || t.text === "||")) {
      segments.push(current);
      joins.push(t.text);
      current = [];
      continue;
    }
    if (t.k === "name" && (t.text.toLowerCase() === "and" || t.text.toLowerCase() === "or")) {
      segments.push(current);
      joins.push(t.text.toLowerCase() === "and" ? "&&" : "||");
      current = [];
      continue;
    }
    current.push(t);
  }
  segments.push(current);
  const items: CondAst[] = segments.map((seg) => parseComparison(seg, vars));
  if (items.length === 1) return items[0];
  const allAnd = joins.every((j) => j === "&&");
  return { t: allAnd ? "and" : "or", items };
}

function parseComparison(tokens: Tok[], vars: string[]): CondAst {
  const positions: { idx: number; op: string; pos: number }[] = [];
  tokens.forEach((t, idx) => {
    if (t.k === "op" && CMP_OPS.indexOf(t.text) >= 0) positions.push({ idx, op: t.text, pos: t.pos });
  });
  if (positions.length === 0) {
    fail("条件里要写一个比较，例如 x < 0、x >= 1；只有等式/不等式才能判断该用哪一段");
  }
  if (positions.length > 1) {
    fail(`${at(positions[1].pos)}多了一个比较运算符「${positions[1].op}」：一段条件里只能有一个比较`);
  }
  const p = positions[0];
  const leftTokens = tokens.slice(0, p.idx);
  const rightTokens = tokens.slice(p.idx + 1);
  if (leftTokens.length === 0) fail(`${at(p.pos)}的比较运算符左边没有东西`);
  if (rightTokens.length === 0) fail(`${at(p.pos)}的比较运算符右边没有东西`);
  const a = parseTokens(leftTokens, vars);
  const b = parseTokens(rightTokens, vars);
  return { t: "cmp", op: p.op as CmpOp, a, b };
}

function compilePiecewiseRules(rules: PieceRuleInput[]): CompiledPiecewise {
  const usable = rules.filter((r) => r.cond.trim().length > 0 || r.expr.trim().length > 0);
  if (usable.length === 0) fail("请至少写一段，例如条件 x < 0、表达式 -x");
  const varNames: string[] = [];
  const parsed = usable.map((r, i) => {
    if (r.cond.trim().length === 0) fail(`第 ${i + 1} 段还没有写条件`);
    if (r.expr.trim().length === 0) fail(`第 ${i + 1} 段还没有写表达式`);
    const condTokens = tokenizeExpression(r.cond);
    const exprTokens = tokenizeExpression(r.expr);
    for (const list of [condTokens, exprTokens]) {
      for (const n of detectVarNames(list)) if (varNames.indexOf(n) < 0) varNames.push(n);
    }
    return { condTokens, exprTokens, condText: r.cond, exprText: r.expr };
  });
  const compiled = parsed.map((p, i) => {
    try {
      return {
        condAst: parseCondition(p.condTokens, varNames),
        ast: parseTokens(p.exprTokens, varNames),
        condText: p.condText,
        exprText: p.exprText,
      };
    } catch (e) {
      fail(`第 ${i + 1} 段有问题：${errMessage(e)}`);
    }
  });
  return { rules: compiled, vars: varNames };
}

function evalCondition(cond: CondAst, env: Record<string, number>): boolean {
  if (cond.t === "cmp") {
    const a = evalAst(cond.a, env);
    const b = evalAst(cond.b, env);
    switch (cond.op) {
      case "<":
        return a < b;
      case "<=":
        return a <= b;
      case ">":
        return a > b;
      case ">=":
        return a >= b;
      case "=":
        return a === b;
      default:
        return a !== b;
    }
  }
  if (cond.t === "and") return cond.items.every((x) => evalCondition(x, env));
  return cond.items.some((x) => evalCondition(x, env));
}

function piecewiseMatches(compiled: CompiledPiecewise, env: Record<string, number>): number[] {
  const hits: number[] = [];
  compiled.rules.forEach((r, i) => {
    try {
      if (evalCondition(r.condAst, env)) hits.push(i);
    } catch {
      /* 条件本身算不出来时按「不匹配」处理 */
    }
  });
  return hits;
}

/** 分段求值：返回函数值与命中的段号（0 起），一段都没命中时给出人话错误 */
function evalPiecewise(
  compiled: CompiledPiecewise,
  env: Record<string, number>,
): { value: number; index: number } {
  for (let i = 0; i < compiled.rules.length; i += 1) {
    const r = compiled.rules[i];
    if (evalCondition(r.condAst, env)) {
      return { value: checkFinite(evalAst(r.ast, env)), index: i };
    }
  }
  const argText = compiled.vars.map((v) => `${v} = ${numText(env[v])}`).join(", ");
  fail(`当前取值（${argText}）没有落在任何一段的条件里，函数在那里没有定义`);
}

type Breakpoint = { value: number; ruleIndexes: number[]; condTexts: string[] };

/**
 * 找出形如 "x < 0" 的分段点（比较的一边是自变量、另一边是常数）。
 * 多个条件给出同一个点时合并成一条，避免同一句提示重复好几遍。
 */
function collectBreakpoints(compiled: CompiledPiecewise): Breakpoint[] {
  const out: Breakpoint[] = [];
  const add = (value: number, ruleIndex: number, condText: string) => {
    for (const item of out) {
      if (Math.abs(item.value - value) < 1e-12) {
        if (item.ruleIndexes.indexOf(ruleIndex) < 0) item.ruleIndexes.push(ruleIndex);
        if (item.condTexts.indexOf(condText) < 0) item.condTexts.push(condText);
        return;
      }
    }
    out.push({ value, ruleIndexes: [ruleIndex], condTexts: [condText] });
  };
  const visit = (cond: CondAst, ruleIndex: number, condText: string) => {
    if (cond.t === "and" || cond.t === "or") {
      for (const item of cond.items) visit(item, ruleIndex, condText);
      return;
    }
    const { a, b } = cond;
    const aVar = a.t === "var" && !containsAnyVar(b);
    const bVar = b.t === "var" && !containsAnyVar(a);
    const target = aVar ? a : bVar ? b : null;
    const other = aVar ? b : bVar ? a : null;
    if (!target || !other) return;
    try {
      add(checkFinite(evalAst(other, {})), ruleIndex, condText);
    } catch {
      /* 常数算不出来就不当作分段点 */
    }
  };
  compiled.rules.forEach((r, i) => visit(r.condAst, i, r.condText));
  return out.sort((p, q) => p.value - q.value);
}

function containsAnyVar(ast: Ast): boolean {
  return collectVarNames(ast).length > 0;
}

/** 分段点上的覆盖情况提示：没人覆盖 / 多段重叠 / 归属明确 */
function analyzeBreakpoints(compiled: CompiledPiecewise, points: Breakpoint[]): string[] {
  const notes: string[] = [];
  if (points.length === 0) {
    notes.push("没有发现形如「x < 常数」的分段点，无法自动定位分界位置；可以用下面的值表逐点观察。");
    return notes;
  }
  for (const p of points) {
    const env: Record<string, number> = {};
    for (const v of compiled.vars) env[v] = 0;
    const target = compiled.vars[0];
    if (!target) continue;
    env[target] = p.value;
    const from = `来自第 ${p.ruleIndexes.map((i) => i + 1).join("、")} 段的条件「${p.condTexts.join("」「")}」`;
    const hits = piecewiseMatches(compiled, env);
    const list = hits.map((i) => `第 ${i + 1} 段`).join("、");
    if (hits.length === 0) {
      notes.push(
        `分段点 ${target} = ${numText(p.value)}：这里没有任何一段的条件成立，函数在这一点没有定义（${from}）。`,
      );
    } else if (hits.length > 1) {
      notes.push(
        `分段点 ${target} = ${numText(p.value)}：有 ${hits.length} 段同时成立（${list}），本工具按「先写先生效」取第 ${hits[0] + 1} 段。`,
      );
    } else {
      notes.push(
        `分段点 ${target} = ${numText(p.value)}：由${list}接管（${from}），端点归属已经明确。`,
      );
    }
  }
  return notes;
}

/* ------------------------------ 定义域 / 值域提示 ------------------------------ */

function domainNotes(ast: Ast, target: string): string[] {
  const notes: string[] = [];
  const walk = (node: Ast) => {
    if (node.t === "neg") {
      walk(node.a);
      return;
    }
    if (node.t === "bin") {
      if (node.op === "/" && containsVar(node.b, target)) {
        notes.push(`分母里含 ${target}，要求分母 ≠ 0：${formatAst(node.b)} ≠ 0`);
      }
      if (node.op === "^" && containsVar(node.b, target) && containsVar(node.a, target)) {
        notes.push(`${target} 同时出现在底数和指数里，定义域需要逐点判断，无法自动给出区间`);
      }
      if (node.op === "^" && containsVar(node.b, target)) {
        notes.push(`指数里含 ${target}，底数需要大于 0（或者 ${target} 只取让底数为正的整数）`);
      }
      walk(node.a);
      walk(node.b);
      return;
    }
    if (node.t === "call") {
      const arg = node.args[0];
      const hasTarget = node.args.some((x) => containsVar(x, target));
      if (hasTarget && arg) {
        if (node.name === "sqrt") notes.push(`平方根里含 ${target}，要求被开方数 ≥ 0：${formatAst(arg)} ≥ 0`);
        if (node.name === "ln" || node.name === "log" || node.name === "log2" || node.name === "log10") {
          notes.push(`对数里含 ${target}，要求真数 > 0：${formatAst(arg)} > 0`);
        }
        if (node.name === "tan") notes.push(`tan 里含 ${target}，要求 ${target} ≠ π/2 + kπ（也就是 90° 的奇数倍）`);
        if (node.name === "asin" || node.name === "acos") {
          notes.push(`反三角函数里含 ${target}，要求 ${formatAst(arg)} 落在 −1 到 1 之间`);
        }
        if (node.name === "fact") notes.push(`阶乘里含 ${target}，要求 ${formatAst(arg)} 是非负整数`);
        if (node.name === "acosh") notes.push(`acosh 里含 ${target}，要求 ${formatAst(arg)} ≥ 1`);
        if (node.name === "atanh") notes.push(`atanh 里含 ${target}，要求 |${formatAst(arg)}| < 1`);
        if (node.name === "floor" || node.name === "ceil" || node.name === "round" || node.name === "sign") {
          notes.push(`含取整/符号运算，函数值是跳变的（不是连续曲线）`);
        }
        if (node.name === "abs") notes.push(`含绝对值，函数在折点两侧的走势不同，可能不是单调的`);
      }
      for (const x of node.args) walk(x);
      return;
    }
  };
  walk(ast);
  const unique: string[] = [];
  for (const n of notes) if (unique.indexOf(n) < 0) unique.push(n);
  return unique;
}

/** 多项式系数提取（次数 ≤ 4），失败返回 null */
function polyCoeffs(ast: Ast, target: string, maxDeg = 4): number[] | null {
  const zeroPad = (arr: number[], len: number) => {
    const out = arr.slice();
    while (out.length < len) out.push(0);
    return out;
  };
  const add = (a: number[], b: number[], sign: number) => {
    const len = Math.max(a.length, b.length);
    const A = zeroPad(a, len);
    const B = zeroPad(b, len);
    return A.map((v, i) => v + sign * B[i]);
  };
  const mul = (a: number[], b: number[]) => {
    const out = new Array(a.length + b.length - 1).fill(0);
    for (let i = 0; i < a.length; i += 1) for (let j = 0; j < b.length; j += 1) out[i + j] += a[i] * b[j];
    return out;
  };
  const rec = (node: Ast): number[] | null => {
    switch (node.t) {
      case "num":
        return [node.v];
      case "var":
        return node.name === target ? [0, 1] : null;
      case "neg": {
        const a = rec(node.a);
        return a ? a.map((v) => -v) : null;
      }
      case "call":
        return null;
      case "bin": {
        const a = rec(node.a);
        const b = rec(node.b);
        if (node.op === "^" && node.b.t === "num") {
          if (!a) return null;
          const e = node.b.v;
          if (!Number.isInteger(e) || e < 0) return null;
          let acc = [1];
          for (let i = 0; i < e; i += 1) {
            acc = mul(acc, a);
            if (acc.length - 1 > maxDeg) return null;
          }
          return acc;
        }
        if (!a || !b) return null;
        if (node.op === "+") return add(a, b, 1);
        if (node.op === "-") return add(a, b, -1);
        if (node.op === "*") {
          const m = mul(a, b);
          return m.length - 1 > maxDeg ? null : m;
        }
        if (node.op === "/") {
          if (b.length !== 1 || b[0] === 0) return null;
          return a.map((v) => v / b[0]);
        }
        return null;
      }
      default:
        return null;
    }
  };
  try {
    const coeffs = rec(ast);
    if (!coeffs) return null;
    return coeffs;
  } catch {
    return null;
  }
}

function rangeHint(ast: Ast, target: string): { text: string; exact: boolean } {
  const c = polyCoeffs(ast, target);
  if (c) {
    const deg = c.length - 1;
    if (deg <= 0) return { text: `函数值是常数 ${numText(c[0])}，值域就是 {${numText(c[0])}}`, exact: true };
    if (deg === 1) {
      if (c[1] === 0) return { text: `函数值恒为常数 ${numText(c[0])}`, exact: true };
      return { text: "一次函数：自变量取遍实数时函数值也取遍全体实数，值域是 (−∞, +∞)", exact: true };
    }
    if (deg === 2) {
      const a = c[2];
      const b = c[1];
      const k0 = c[0];
      const vx = -b / (2 * a);
      const vy = a * vx * vx + b * vx + k0;
      if (a > 0) {
        return {
          text: `二次函数开口向上，最小值在 ${target} = ${numText(cleanFloat(vx))} 处取得 ${numText(cleanFloat(vy))}，值域是 [${numText(cleanFloat(vy))}, +∞)`,
          exact: true,
        };
      }
      return {
        text: `二次函数开口向下，最大值在 ${target} = ${numText(cleanFloat(vx))} 处取得 ${numText(cleanFloat(vy))}，值域是 (−∞, ${numText(cleanFloat(vy))}]`,
        exact: true,
      };
    }
    if (deg === 3 && c[3] !== 0) {
      return { text: "三次函数（奇次多项式）：自变量取遍实数时函数值取遍全体实数，值域是 (−∞, +∞)", exact: true };
    }
  }
  return {
    text: "无法自动判断值域（本工具只对一次 / 二次 / 三次多项式给出精确结论；含分式、根式、对数的函数请用值表观察取样范围内的取值范围）",
    exact: false,
  };
}

/* ------------------------------ 统计 ------------------------------ */

type StatItem = { key: string; label: string; note: string; value: number | null; text?: string };

function parseNumberList(src: string): number[] {
  const cleaned = src.replace(/[，、；;\t]/g, ",").replace(/\s+/g, ",");
  const parts = cleaned
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  if (parts.length === 0) fail("请先输入一列数字，用逗号、空格或换行分隔（例如 12, 15, 9, 22）");
  const out: number[] = [];
  const bad: string[] = [];
  for (const part of parts) {
    if (/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(part)) {
      out.push(Number(part));
    } else {
      bad.push(part);
    }
  }
  if (bad.length > 0) {
    const shown = bad
      .slice(0, 3)
      .map((s) => `「${s}」`)
      .join("、");
    fail(
      `有 ${bad.length} 项不是数字：${shown}${bad.length > 3 ? " 等" : ""}。只接受数字，用逗号、空格或换行分隔`,
    );
  }
  return out;
}

/** 分位数：线性插值法（与 Excel PERCENTILE.INC 一致） */
function quantile(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 0) fail("没有数据，算不出分位数");
  if (n === 1) return sorted[0];
  const clamped = Math.max(0, Math.min(1, p));
  const h = (n - 1) * clamped;
  const lo = Math.floor(h);
  const hi = Math.ceil(h);
  const frac = h - lo;
  return sorted[lo] + frac * (sorted[hi] - sorted[lo]);
}

function computeStats(values: number[], opts: { quantileP: number }): StatItem[] {
  const n = values.length;
  if (n === 0) return [];
  const sorted = values.slice().sort((a, b) => a - b);
  let sum = 0;
  for (const v of sorted) sum += v;
  const mean = sum / n;
  const min = sorted[0];
  const max = sorted[n - 1];
  let ss = 0;
  let sqSum = 0;
  for (const v of sorted) {
    ss += (v - mean) * (v - mean);
    sqSum += v * v;
  }
  const varPop = ss / n;
  const varSample = n > 1 ? ss / (n - 1) : null;
  const sdPop = Math.sqrt(varPop);
  const sdSample = varSample === null ? null : Math.sqrt(varSample);
  const se = sdSample === null ? null : sdSample / Math.sqrt(n);
  const cv = sdSample !== null && mean !== 0 ? (sdSample / Math.abs(mean)) * 100 : null;
  const rms = Math.sqrt(sqSum / n);
  const freq = new Map<number, number>();
  for (const v of sorted) freq.set(v, (freq.get(v) ?? 0) + 1);
  let maxFreq = 0;
  freq.forEach((c) => {
    if (c > maxFreq) maxFreq = c;
  });
  const modes: number[] = [];
  if (maxFreq >= 2) {
    for (const v of sorted) if (freq.get(v) === maxFreq && modes.indexOf(v) < 0) modes.push(v);
  }
  const geometric = min > 0 ? Math.exp(sorted.reduce((acc, v) => acc + Math.log(v), 0) / n) : null;
  const p = Math.max(0, Math.min(100, opts.quantileP));
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const pp = quantile(sorted, p / 100);
  const items: StatItem[] = [
    { key: "count", label: "计数 n", note: "一共几个数", value: n },
    { key: "sum", label: "求和 Σx", note: "所有数相加", value: sum },
    { key: "mean", label: "平均值 x̄", note: "Σx ÷ n", value: mean },
    { key: "median", label: "中位数", note: "排序后正中间的数（偶数个取中间两个的平均）", value: quantile(sorted, 0.5) },
    {
      key: "mode",
      label: "众数",
      note: "出现次数最多的数，可能有多个",
      value: null,
      text: modes.length > 0 ? modes.map((v) => numText(v)).join("、") : "没有众数（每个数都只出现一次）",
    },
    { key: "min", label: "最小值", note: "排序后的第一个", value: min },
    { key: "max", label: "最大值", note: "排序后的最后一个", value: max },
    { key: "range", label: "极差", note: "最大值 − 最小值", value: max - min },
    { key: "varPop", label: "总体方差 σ²", note: "÷ n，数据本身就是全部时用它", value: varPop },
    {
      key: "varSample",
      label: "样本方差 s²",
      note: "÷ (n−1)，用样本来估计总体时用它",
      value: varSample,
      text: varSample === null ? "样本只有 1 个，样本方差无定义" : undefined,
    },
    { key: "sdPop", label: "总体标准差 σ", note: "总体方差的平方根", value: sdPop },
    {
      key: "sdSample",
      label: "样本标准差 s",
      note: "样本方差的平方根",
      value: sdSample,
      text: sdSample === null ? "样本只有 1 个，样本标准差无定义" : undefined,
    },
    {
      key: "se",
      label: "标准误 SE",
      note: "s ÷ √n，衡量平均值的抽样误差",
      value: se,
      text: se === null ? "样本只有 1 个，标准误无定义" : undefined,
    },
    {
      key: "cv",
      label: "变异系数 CV",
      note: "s ÷ |x̄| × 100%，衡量相对波动",
      value: cv,
      text: cv === null ? "平均值为 0 或样本只有 1 个，变异系数无定义" : undefined,
    },
    { key: "q1", label: "第一四分位 Q1", note: "25% 分位数（线性插值）", value: q1 },
    { key: "q3", label: "第三四分位 Q3", note: "75% 分位数（线性插值）", value: q3 },
    { key: "iqr", label: "四分位距 IQR", note: "Q3 − Q1，常用作箱线图的箱体高度", value: q3 - q1 },
    { key: "quantileP", label: `自定义分位数 P${numText(p)}`, note: "按上面填的百分位 p 计算（线性插值）", value: pp },
    {
      key: "geo",
      label: "几何平均数",
      note: "n 个数的连乘积开 n 次方，适合增长率；有负数或 0 时无定义",
      value: geometric,
      text: geometric === null ? "数据里有 0 或负数，几何平均数无定义" : undefined,
    },
    { key: "rms", label: "均方根 RMS", note: "√(Σx² ÷ n)", value: rms },
    { key: "sumSq", label: "平方和 Σx²", note: "所有数的平方相加", value: sqSum },
  ];
  return items;
}

/* ------------------------------ CSV / TSV ------------------------------ */

function toDelimited(header: string[], rows: string[][], sep: string): string {
  const esc = (s: string) => {
    const needQuote = s.indexOf(sep) >= 0 || s.indexOf('"') >= 0 || s.indexOf("\n") >= 0;
    return needQuote ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [header, ...rows].map((r) => r.map(esc).join(sep)).join("\n");
}

/* ------------------------------ 预置函数库 ------------------------------ */

type PresetStep = { label: string; expr: string; value: number | null; unit?: string };
type PresetResult = { value: number | null; unit?: string; error?: string; steps: PresetStep[]; notes: string[] };
type PresetParam = { id: string; name: string; defaultValue: string; unit?: string; hint?: string };
type PresetCategory = "finance" | "math";

type PresetDef = {
  id: string;
  name: string;
  category: PresetCategory;
  formulaStr: string;
  desc: string;
  params: PresetParam[];
  run: (v: Record<string, number>) => PresetResult;
};

function requirePositive(v: number, label: string): number {
  if (!Number.isFinite(v)) fail(`${label}要填一个数`);
  if (!(v > 0)) fail(`${label}必须大于 0，现在是 ${numText(v)}`);
  return v;
}

function requireNonNegative(v: number, label: string): number {
  if (!Number.isFinite(v)) fail(`${label}要填一个数`);
  if (v < 0) fail(`${label}不能是负数，现在是 ${numText(v)}`);
  return v;
}

const PRESET_FUNCTIONS: PresetDef[] = [
  /* ───────── 财税与金融 ───────── */
  {
    id: "finance_compound_fv",
    name: "复利终值 FV",
    category: "finance",
    formulaStr: "FV = PV × (1 + r)^n",
    desc: "一笔本金按固定年化收益率复利计息 n 期后的本息合计，即把「利滚利」算到底。",
    params: [
      { id: "pv", name: "初始本金 PV", defaultValue: "100000", unit: "元" },
      { id: "r", name: "年化收益率 r", defaultValue: "0.05", hint: "填小数，5% 填 0.05" },
      { id: "n", name: "投资期数 n", defaultValue: "10", unit: "年" },
    ],
    run: (v) => {
      const pv = requireNonNegative(v.pv, "初始本金");
      requirePositive(v.n, "投资期数");
      const growth = Math.pow(1 + v.r, v.n);
      checkFinite(growth, "增长倍数");
      const fv = checkFinite(pv * growth);
      return {
        value: fv,
        unit: "元",
        steps: [
          { label: "初始本金 PV", expr: "输入", value: pv, unit: "元" },
          { label: "每期增长系数 1 + r", expr: `1 + ${numText(v.r)}`, value: 1 + v.r },
          { label: "增长倍数 (1 + r)^n", expr: `(${numText(1 + v.r)})^${numText(v.n)}`, value: growth },
          { label: "终值 FV", expr: "PV × (1 + r)^n", value: fv, unit: "元" },
        ],
        notes: [`累计利息 = FV − PV = ${numText(cleanFloat(fv - pv))} 元`, "按年复利、期间不再追加本金；收益率请填小数（5% → 0.05）"],
      };
    },
  },
  {
    id: "finance_compound_pv",
    name: "复利现值 PV",
    category: "finance",
    formulaStr: "PV = FV / (1 + r)^n",
    desc: "把未来第 n 期的一笔钱按折现率折算成今天的价值，用来比较不同时间点的金额。",
    params: [
      { id: "fv", name: "未来终值 FV", defaultValue: "200000", unit: "元" },
      { id: "r", name: "折现率 r", defaultValue: "0.04", hint: "填小数，4% 填 0.04" },
      { id: "n", name: "折现期数 n", defaultValue: "5", unit: "年" },
    ],
    run: (v) => {
      requirePositive(v.fv, "未来终值");
      requirePositive(v.n, "折现期数");
      if (1 + v.r <= 0) fail(`折现率不能小于等于 -100%，现在是 ${numText(v.r)}`);
      const discount = Math.pow(1 + v.r, v.n);
      checkFinite(discount, "折现系数");
      const pv = checkFinite(v.fv / discount);
      return {
        value: pv,
        unit: "元",
        steps: [
          { label: "未来终值 FV", expr: "输入", value: v.fv, unit: "元" },
          { label: "折现系数 (1 + r)^n", expr: `(${numText(1 + v.r)})^${numText(v.n)}`, value: discount },
          { label: "现值 PV", expr: "FV ÷ (1 + r)^n", value: pv, unit: "元" },
        ],
        notes: [`折现损失（FV − PV）= ${numText(cleanFloat(v.fv - pv))} 元，代表这段时间的资金时间价值`],
      };
    },
  },
  {
    id: "finance_annuity_fv",
    name: "定投终值（年金终值）",
    category: "finance",
    formulaStr: "FV = PMT × [(1 + r)^n − 1] / r",
    desc: "每期固定投入一笔钱、按固定收益率复利累积 n 期后的总金额，即定投的到期金额。",
    params: [
      { id: "pmt", name: "每期投入 PMT", defaultValue: "2000", unit: "元" },
      { id: "r", name: "每期收益率 r", defaultValue: "0.004", hint: "按月定投填月利率，例如 0.004" },
      { id: "n", name: "投入期数 n", defaultValue: "120", unit: "期" },
    ],
    run: (v) => {
      requirePositive(v.pmt, "每期投入");
      requirePositive(v.n, "投入期数");
      if (1 + v.r <= 0) fail("每期收益率不能小于等于 -100%");
      const growth = Math.pow(1 + v.r, v.n);
      const principal = v.pmt * v.n;
      let fv: number;
      if (v.r === 0) {
        fv = principal;
      } else {
        fv = checkFinite((v.pmt * (growth - 1)) / v.r);
      }
      return {
        value: fv,
        unit: "元",
        steps: [
          { label: "每期投入 PMT", expr: "输入", value: v.pmt, unit: "元" },
          { label: "投入本金合计", expr: `PMT × n = ${numText(v.pmt)} × ${numText(v.n)}`, value: principal, unit: "元" },
          { label: "增长倍数 (1 + r)^n", expr: `(${numText(1 + v.r)})^${numText(v.n)}`, value: growth },
          { label: "终值 FV", expr: "PMT × [(1 + r)^n − 1] ÷ r", value: fv, unit: "元" },
        ],
        notes: [
          `收益部分 = FV − 本金 = ${numText(cleanFloat(fv - principal))} 元`,
          v.r === 0 ? "收益率填的是 0，结果就是本金合计（没有收益）" : "假定每期期末投入、期末结息",
        ],
      };
    },
  },
  {
    id: "finance_cagr",
    name: "复合年均增长率 CAGR",
    category: "finance",
    formulaStr: "CAGR = (期末值 / 期初值)^(1 / n) − 1",
    desc: "把多期的起伏抹平成一个几何平均年增长率，用来比较不同长度区间的增长快慢。",
    params: [
      { id: "start_val", name: "期初价值", defaultValue: "500000", unit: "元" },
      { id: "end_val", name: "期末价值", defaultValue: "1200000", unit: "元" },
      { id: "years", name: "跨越年数 n", defaultValue: "5", unit: "年" },
    ],
    run: (v) => {
      requirePositive(v.start_val, "期初价值");
      requireNonNegative(v.end_val, "期末价值");
      requirePositive(v.years, "跨越年数");
      const ratio = v.end_val / v.start_val;
      const growth = Math.pow(ratio, 1 / v.years);
      const cagr = (growth - 1) * 100;
      return {
        value: cagr,
        unit: "%",
        steps: [
          { label: "期末 / 期初", expr: `${numText(v.end_val)} ÷ ${numText(v.start_val)}`, value: ratio },
          { label: "年均增长倍数", expr: `${numText(ratio)}^(1 ÷ ${numText(v.years)})`, value: growth },
          { label: "CAGR", expr: "(年均增长倍数 − 1) × 100%", value: cagr, unit: "%" },
        ],
        notes: [`CAGR 是几何平均，不等于各年增长率的算术平均；总增长 ${numText(cleanFloat((ratio - 1) * 100))}%`],
      };
    },
  },
  {
    id: "finance_pmt",
    name: "等额本息月供 PMT",
    category: "finance",
    formulaStr: "PMT = P × r × (1+r)^n / [(1+r)^n − 1]",
    desc: "贷款按等额本息还款时每期要还的固定金额（本金 + 利息），房贷车贷最常用。",
    params: [
      { id: "loan", name: "贷款金额 P", defaultValue: "1000000", unit: "元" },
      { id: "annual_rate", name: "年利率", defaultValue: "0.038", hint: "填小数，3.8% 填 0.038" },
      { id: "months", name: "还款期数 n", defaultValue: "360", unit: "月" },
    ],
    run: (v) => {
      requirePositive(v.loan, "贷款金额");
      requirePositive(v.months, "还款期数");
      const mr = v.annual_rate / 12;
      const pow = Math.pow(1 + mr, v.months);
      checkFinite(pow, "计息系数");
      const pmt = mr === 0 ? v.loan / v.months : (v.loan * mr * pow) / (pow - 1);
      checkFinite(pmt, "每期还款额");
      const total = pmt * v.months;
      return {
        value: pmt,
        unit: "元",
        steps: [
          { label: "月利率 r", expr: "年利率 ÷ 12", value: mr },
          { label: "计息系数 (1 + r)^n", expr: `(${numText(1 + mr)})^${numText(v.months)}`, value: pow },
          { label: "每期还款额 PMT", expr: "P × r × (1+r)^n ÷ [(1+r)^n − 1]", value: pmt, unit: "元" },
          { label: "还款总额", expr: `PMT × n = ${numText(pmt)} × ${numText(v.months)}`, value: total, unit: "元" },
        ],
        notes: [`总利息 = 还款总额 − 本金 = ${numText(cleanFloat(total - v.loan))} 元`, "等额本息每期还款额相同，前期利息占比高、后期本金占比高"],
      };
    },
  },

  /* ───────── 工程与数学 ───────── */
  {
    id: "math_quadratic",
    name: "一元二次方程求根与顶点",
    category: "math",
    formulaStr: "x = (−b ± √(b² − 4ac)) / (2a)，顶点 x = −b / (2a)",
    desc: "解 ax² + bx + c = 0，给出判别式、两个根、顶点坐标与对称轴，a = 0 时按一次方程处理。",
    params: [
      { id: "a", name: "二次项系数 a", defaultValue: "1" },
      { id: "b", name: "一次项系数 b", defaultValue: "-5" },
      { id: "c", name: "常数项 c", defaultValue: "6" },
    ],
    run: (v) => {
      const { a, b, c } = v;
      if (a === 0) {
        if (b === 0) {
          return {
            value: null,
            error: c === 0 ? "a 与 b 都是 0：任意 x 都满足方程（恒等式）" : "a 与 b 都是 0 而 c ≠ 0：方程无解",
            steps: [{ label: "方程", expr: `${numText(c)} = 0`, value: null }],
            notes: [],
          };
        }
        const root = -c / b;
        return {
          value: root,
          steps: [
            { label: "二次项系数为 0", expr: "a = 0，退化成一次方程 bx + c = 0", value: null },
            { label: "唯一解", expr: `x = −c ÷ b = −(${numText(c)}) ÷ ${numText(b)}`, value: root },
          ],
          notes: ["a = 0 时这不是二次方程，按一次方程求解"],
        };
      }
      const delta = b * b - 4 * a * c;
      const bSq = b < 0 ? `(${numText(b)})²` : `${numText(b)}²`;
      const vertexX = -b / (2 * a);
      const vertexY = a * vertexX * vertexX + b * vertexX + c;
      const axis = `x = ${numText(cleanFloat(vertexX))}`;
      const vertex = `(${numText(cleanFloat(vertexX))}, ${numText(cleanFloat(vertexY))})`;
      if (delta < 0) {
        const re = -b / (2 * a);
        const im = Math.sqrt(-delta) / (2 * a);
        return {
          value: null,
          error: `判别式 Δ = ${numText(cleanFloat(delta))} < 0，方程在实数范围内没有根`,
          steps: [
            { label: "判别式 Δ", expr: `b² − 4ac = ${bSq} − 4×${numText(a)}×${numText(c)}`, value: cleanFloat(delta) },
            { label: "顶点", expr: "(−b / 2a, 代入求值)", value: null },
          ],
          notes: [
            `抛物线顶点是 ${vertex}，对称轴 ${axis}，整条曲线都在 x 轴${a > 0 ? "上方（函数值恒正）" : "下方（函数值恒负）"}`,
            `如果允许复数，两个根是 ${numText(cleanFloat(re))} ± ${numText(cleanFloat(Math.abs(im)))}i`,
          ],
        };
      }
      const sqrtDelta = Math.sqrt(delta);
      const x1 = (-b + sqrtDelta) / (2 * a);
      const x2 = (-b - sqrtDelta) / (2 * a);
      const hi = Math.max(x1, x2);
      const lo = Math.min(x1, x2);
      const steps: PresetStep[] = [
        { label: "判别式 Δ", expr: `b² − 4ac = ${bSq} − 4×${numText(a)}×${numText(c)}`, value: cleanFloat(delta) },
        { label: "较大的根 x₁", expr: "(−b + √Δ) ÷ 2a", value: cleanFloat(hi) },
        { label: "较小的根 x₂", expr: "(−b − √Δ) ÷ 2a", value: cleanFloat(lo) },
        { label: "顶点", expr: "(−b / 2a, −Δ / 4a)", value: null, unit: vertex },
        { label: "对称轴", expr: "x = −b / 2a", value: null, unit: axis },
      ];
      return {
        value: cleanFloat(hi),
        steps,
        notes: [
          delta === 0 ? "Δ = 0：两个根重合，方程只有一个实数根（重根）" : `判别式 Δ > 0，有两个不同的实数根`,
          a > 0 ? "开口向上，顶点是最小值点" : "开口向下，顶点是最大值点",
          `两根之和 = −b/a = ${numText(cleanFloat(-b / a))}，两根之积 = c/a = ${numText(cleanFloat(c / a))}（韦达定理）`,
        ],
      };
    },
  },
  {
    id: "math_permutation",
    name: "排列数 A(n, m)",
    category: "math",
    formulaStr: "A(n, m) = n! / (n − m)!",
    desc: "从 n 个不同元素里按顺序取出 m 个的排法数量（顺序不同算不同）。",
    params: [
      { id: "n", name: "总元素数 n", defaultValue: "7" },
      { id: "m", name: "取出元素数 m", defaultValue: "3" },
    ],
    run: (v) => {
      const n = v.n;
      const m = v.m;
      const res = permutation(n, m);
      checkFinite(res, "排列数");
      return {
        value: res,
        steps: [
          { label: "总元素数 n", expr: "输入", value: n },
          { label: "取出个数 m", expr: "输入", value: m },
          { label: "A(n, m)", expr: `n! ÷ (n − m)! = ${numText(n)}! ÷ ${numText(n - m)}!`, value: res },
        ],
        notes: ["顺序不同算不同排法；如果顺序不重要请改用组合数 C(n, m)"],
      };
    },
  },
  {
    id: "math_combination",
    name: "组合数 C(n, m)",
    category: "math",
    formulaStr: "C(n, m) = n! / [m! × (n − m)!]",
    desc: "从 n 个不同元素里取出 m 个的组合数量（顺序不同算同一种）。",
    params: [
      { id: "n", name: "总元素数 n", defaultValue: "10" },
      { id: "m", name: "取出元素数 m", defaultValue: "4" },
    ],
    run: (v) => {
      const res = combination(v.n, v.m);
      checkFinite(res, "组合数");
      return {
        value: res,
        steps: [
          { label: "总元素数 n", expr: "输入", value: v.n },
          { label: "取出个数 m", expr: "输入", value: v.m },
          { label: "C(n, m)", expr: `n! ÷ [m! × (n − m)!] = ${numText(v.n)}! ÷ [${numText(v.m)}! × ${numText(v.n - v.m)}!]`, value: res },
          { label: "排列数 A(n, m)", expr: "C(n, m) × m!", value: permutation(v.n, v.m) },
        ],
        notes: ["组合数是对称的：C(n, m) = C(n, n − m)"],
      };
    },
  },
  {
    id: "math_factorial",
    name: "阶乘 n!",
    category: "math",
    formulaStr: "n! = 1 × 2 × 3 × … × n（0! = 1）",
    desc: "连乘到 n 的阶乘值，用来核算排列组合与概率里的分母。",
    params: [{ id: "n", name: "整数 n", defaultValue: "10", hint: "0 到 170 之间" }],
    run: (v) => {
      const res = factorialExact(v.n);
      checkFinite(res, "阶乘");
      return {
        value: res,
        steps: [
          { label: "n", expr: "输入", value: v.n },
          { label: "阶乘 n!", expr: v.n <= 1 ? "0! = 1! = 1（约定）" : `1 × 2 × … × ${numText(v.n)}`, value: res },
        ],
        notes: ["阶乘增长很快：170! 已经接近双精度浮点能表示的上限"],
      };
    },
  },
  {
    id: "math_log_base",
    name: "任意底对数 log_b(x)",
    category: "math",
    formulaStr: "log_b(x) = ln(x) / ln(b)",
    desc: "换底公式求任意底数的对数，例如以 2 为底、以 1.05 为底这类不常见的底。",
    params: [
      { id: "x", name: "真数 x", defaultValue: "1000" },
      { id: "b", name: "底数 b", defaultValue: "2" },
    ],
    run: (v) => {
      requirePositive(v.x, "真数 x");
      requirePositive(v.b, "底数 b");
      if (Math.abs(v.b - 1) < 1e-15) fail("底数不能是 1（以 1 为底的对数没有定义）");
      const lnx = Math.log(v.x);
      const lnb = Math.log(v.b);
      const res = lnx / lnb;
      return {
        value: res,
        unit: `（以 ${numText(v.b)} 为底）`,
        steps: [
          { label: "ln(x)", expr: `ln(${numText(v.x)})`, value: lnx },
          { label: "ln(b)", expr: `ln(${numText(v.b)})`, value: lnb },
          { label: "log_b(x)", expr: "ln(x) ÷ ln(b)", value: res },
        ],
        notes: [`反过来验算：${numText(v.b)}^${numText(cleanFloat(res))} ≈ ${numText(v.x)}`, "真数必须大于 0，底数必须大于 0 且不等于 1"],
      };
    },
  },
];

/* ============================== PURE:END ============================== */

/* ------------------------------ 界面里用到的小控件 ------------------------------ */

const PRECISION_CHOICES = [0, 2, 4, 6, 8, 10];

function SegmentedButton({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-lg px-3 py-1.5 text-xs font-medium transition-all",
        active
          ? "bg-background text-foreground shadow-xs font-semibold"
          : "text-muted-foreground hover:text-foreground",
        className,
      )}
    >
      {children}
    </button>
  );
}

function ErrorLine({ message, pos, source }: { message: string; pos: number; source: string }) {
  const caretPos = pos >= 0 ? pos : -1;
  return (
    <div className="flex items-start gap-2 rounded-xl border-l-4 border-l-destructive bg-destructive/10 px-4 py-3 font-mono text-xs text-destructive">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 space-y-1">
        <div className="break-words">{message}</div>
        {caretPos >= 0 && source.length > 0 ? (
          <div className="thin-scroll overflow-x-auto whitespace-pre text-[11px] leading-4 opacity-80">
            {source}
            {"\n"}
            {`${" ".repeat(Math.max(0, caretPos))}^`}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** 结果数字 + 复制按钮（三个工作区共用同一套观感） */
function ResultBox({
  caption,
  text,
  onCopy,
  note,
}: {
  caption: string;
  text: string;
  onCopy: () => void;
  note?: string;
}) {
  return (
    <div className="flex flex-col gap-4 rounded-xl border border-primary/20 bg-primary/[0.07] p-5 sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <div className="text-xs text-muted-foreground">{caption}</div>
        <div className="mt-1 break-all font-mono text-3xl font-extrabold tracking-tight text-primary tabular-nums">
          {text}
        </div>
        {note ? <div className="mt-1 text-[11px] text-muted-foreground">{note}</div> : null}
      </div>
      <Button onClick={onCopy} className="shrink-0">
        <Copy className="h-4 w-4" />
        复制结果
      </Button>
    </div>
  );
}

/** 明细表：表头 + 斑马纹（结果「像成品」的关键） */
function DataTable({
  columns,
  rows,
  align = [],
}: {
  columns: string[];
  rows: (string | { text: string; muted?: boolean })[][];
  align?: ("left" | "right")[];
}) {
  return (
    <div className="thin-scroll max-h-[420px] overflow-auto rounded-xl border border-border/60">
      <table className="w-full border-collapse text-xs">
        <thead className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
          <tr>
            {columns.map((c, i) => (
              <th
                key={c + i}
                className={cn(
                  "whitespace-nowrap border-b border-border/60 px-3 py-2 font-semibold text-foreground",
                  (align[i] ?? "left") === "right" ? "text-right" : "text-left",
                )}
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="font-mono-accent">
          {rows.map((row, ri) => (
            <tr key={ri} className={ri % 2 === 1 ? "bg-muted/30" : undefined}>
              {row.map((cell, ci) => {
                const isObj = typeof cell !== "string";
                const text = isObj ? cell.text : cell;
                const muted = isObj ? !!cell.muted : false;
                return (
                  <td
                    key={ci}
                    className={cn(
                      "whitespace-nowrap border-b border-border/30 px-3 py-1.5 tabular-nums",
                      (align[ci] ?? "left") === "right" ? "text-right" : "text-left",
                      muted ? "text-destructive/80" : "text-foreground",
                    )}
                  >
                    {text}
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

/* ------------------------------ 主组件 ------------------------------ */

type TopTab = "library" | "custom" | "stats";
type CustomMode = "eval" | "table" | "compose" | "piecewise";

const DEFAULT_PIECEWISE_RULES: PieceRuleInput[] = [
  { cond: "x < 0", expr: "-x" },
  { cond: "x >= 0", expr: "x^2" },
];

export function FunctionCalculatorTool() {
  const { toast } = useToast();

  /* ---------- 全局显示设置 ---------- */
  const [tab, setTab] = useToolDraft<TopTab>("func-calc", "tab", "library");
  const [precision, setPrecision] = useToolDraft<number>("func-calc", "precision", 6);
  const [group, setGroup] = useToolDraft<boolean>("func-calc", "grouping", true);
  const fmt = useMemo<NumberFormat>(() => ({ precision, group }), [precision, group]);
  const show = (v: number | null) => (v === null ? "—" : formatNumber(v, fmt));

  const [copiedKey, setCopiedKey] = useState<string>("");

  /* ---------- 函数库 ---------- */
  const [libCategory, setLibCategory] = useToolDraft<"all" | PresetCategory>("func-calc", "libCategory", "all");
  const [libFuncId, setLibFuncId] = useToolDraft<string>("func-calc", "libFuncId", "finance_compound_fv");
  const [libParams, setLibParams] = useToolDraft<Record<string, string>>("func-calc", "libParams", {});

  /* ---------- 自定义 f(x) ---------- */
  const [cxMode, setCxMode] = useToolDraft<CustomMode>("func-calc", "cxMode", "eval");
  const [cxSource, setCxSource] = useToolDraft<string>("func-calc", "cxSource", "a*x^2 + b*x + c");
  const [cxSig, setCxSig] = useToolDraft<string>("func-calc", "cxSig", "f(x; a, b, c)");
  const [cxRoles, setCxRoles] = useToolDraft<Record<string, "var" | "param">>("func-calc", "cxRoles", {});
  const [cxValues, setCxValues] = useToolDraft<Record<string, string>>("func-calc", "cxValues", {});
  const [pwRules, setPwRules] = useToolDraft<PieceRuleInput[]>("func-calc", "pwRules", DEFAULT_PIECEWISE_RULES);
  const [cgSource, setCgSource] = useToolDraft<string>("func-calc", "cgSource", "x + 1");
  const [invY, setInvY] = useToolDraft<string>("func-calc", "invY", "9");
  const [invLo, setInvLo] = useToolDraft<string>("func-calc", "invLo", "-5");
  const [invHi, setInvHi] = useToolDraft<string>("func-calc", "invHi", "5");

  /* ---------- 统计 ---------- */
  const [statsInput, setStatsInput] = useToolDraft<string>(
    "func-calc",
    "statsInput",
    "12, 15, 9, 22, 15, 18, 30, 15, 24, 11",
  );
  const [statsP, setStatsP] = useToolDraft<string>("func-calc", "statsP", "90");

  /* ---------- 复制 ---------- */
  const copyText = (text: string, key: string, title = "已复制") => {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      navigator.clipboard.writeText(text).catch(() => {
        /* 剪贴板不可用时静默失败，下面仍给 toast 提示 */
      });
    }
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey(""), 1600);
    toast({ title, variant: "success" });
  };

  /* ============================ 函数库计算 ============================ */
  const currentPreset = useMemo(
    () => PRESET_FUNCTIONS.find((f) => f.id === libFuncId) || PRESET_FUNCTIONS[0],
    [libFuncId],
  );

  const presetParamValues = useMemo(() => {
    const out: Record<string, number> = {};
    for (const p of currentPreset.params) {
      const raw = libParams[p.id] !== undefined ? libParams[p.id] : p.defaultValue;
      out[p.id] = Number(raw);
    }
    return out;
  }, [currentPreset, libParams]);

  const presetResult = useMemo<PresetResult>(() => {
    try {
      return currentPreset.run(presetParamValues);
    } catch (e) {
      return { value: null, error: errMessage(e), steps: [], notes: [] };
    }
  }, [currentPreset, presetParamValues]);

  const filteredPresets = useMemo(
    () => PRESET_FUNCTIONS.filter((f) => libCategory === "all" || f.category === libCategory),
    [libCategory],
  );

  /* ============================ 自定义函数计算 ============================ */
  const cxSignature = useMemo<Signature | null>(() => {
    try {
      return parseSignature(cxSig);
    } catch {
      return null;
    }
  }, [cxSig]);

  const cxCompiled = useMemo<
    | { ok: true; ast: Ast; vars: string[]; params: string[]; body: string; headerText: string }
    | { ok: false; message: string; pos: number; body: string }
  >(() => {
    try {
      const c = compileExpression(cxSource, cxSignature);
      return { ok: true, ...c };
    } catch (e) {
      return {
        ok: false,
        message: errMessage(e),
        pos: errPos(e),
        body: stripFunctionHeader(cxSource).body,
      };
    }
  }, [cxSource, cxSignature]);

  const cxNames = useMemo(() => {
    if (!cxCompiled.ok) return [] as string[];
    const all: string[] = [];
    for (const n of cxCompiled.vars.concat(cxCompiled.params)) if (all.indexOf(n) < 0) all.push(n);
    return all;
  }, [cxCompiled]);

  const cxVarNames = useMemo(
    () => cxNames.filter((n) => (cxRoles[n] ?? (cxCompiled.ok && cxCompiled.params.indexOf(n) >= 0 ? "param" : "var")) === "var"),
    [cxNames, cxRoles, cxCompiled],
  );
  const cxParamNames = useMemo(
    () => cxNames.filter((n) => (cxRoles[n] ?? (cxCompiled.ok && cxCompiled.params.indexOf(n) >= 0 ? "param" : "var")) === "param"),
    [cxNames, cxRoles, cxCompiled],
  );

  const valueOf = useCallback(
    (name: string, role: "var" | "param"): string => {
      const stored = cxValues[name];
      if (stored !== undefined && stored !== "") return stored;
      return role === "var" ? "1..5" : "1";
    },
    [cxValues],
  );

  const cxParams = useMemo(() => {
    const env: Record<string, number> = {};
    const problems: string[] = [];
    for (const n of cxParamNames) {
      const raw = valueOf(n, "param").trim();
      const v = Number(raw);
      if (raw.length === 0 || !Number.isFinite(v)) {
        problems.push(`参数「${n}」要填一个数，现在填的是「${raw}」`);
      } else {
        env[n] = v;
      }
    }
    return { env, problems };
  }, [cxParamNames, valueOf]);

  const cxLists = useMemo(() => {
    const out: { name: string; ok: boolean; values: number[]; message: string }[] = [];
    for (const n of cxVarNames) {
      try {
        out.push({ name: n, ok: true, values: parseValueList(valueOf(n, "var")), message: "" });
      } catch (e) {
        out.push({ name: n, ok: false, values: [], message: errMessage(e) });
      }
    }
    return out;
  }, [cxVarNames, valueOf]);

  /** 自定义函数的求值器（自变量按顺序传入） */
  const cxEvaluator = useMemo<((args: number[]) => number) | null>(() => {
    if (!cxCompiled.ok) return null;
    if (cxParams.problems.length > 0) return null;
    if (cxLists.some((l) => !l.ok)) return null;
    const ast = cxCompiled.ast;
    const paramEnv = cxParams.env;
    return (args: number[]) => {
      const env: Record<string, number> = {};
      for (const k of Object.keys(paramEnv)) env[k] = paramEnv[k];
      cxVarNames.forEach((n, i) => {
        env[n] = args[i];
      });
      return checkFinite(evalAst(ast, env));
    };
  }, [cxCompiled, cxParams, cxLists, cxVarNames]);

  const cxTable = useMemo<{ ok: true; data: TableData } | { ok: false; message: string }>(() => {
    if (!cxEvaluator) return { ok: false, message: "" };
    try {
      return { ok: true, data: buildValueTable(cxVarNames, cxLists.map((l) => l.values), cxEvaluator) };
    } catch (e) {
      return { ok: false, message: errMessage(e) };
    }
  }, [cxEvaluator, cxVarNames, cxLists]);

  const cxDomain = useMemo(() => {
    if (!cxCompiled.ok || cxVarNames.length === 0) return [] as string[];
    return domainNotes(cxCompiled.ast, cxVarNames[0]);
  }, [cxCompiled, cxVarNames]);

  const cxRange = useMemo(() => {
    if (!cxCompiled.ok || cxVarNames.length !== 1) return null;
    // 参数已经填了值的话，先把它们代进去再判断值域：
    // 这样 a*x^2 + b*x + c 在 a、b、c 填好之后就能给出精确值域，而不是「无法自动判断」。
    const ast =
      cxParams.problems.length === 0 ? substituteValues(cxCompiled.ast, cxParams.env) : cxCompiled.ast;
    return rangeHint(ast, cxVarNames[0]);
  }, [cxCompiled, cxVarNames, cxParams]);

  /** 代入求值的过程文本：f(2) = 2^2 + 1 = 5 */
  const cxEvalDetail = useMemo(() => {
    if (!cxCompiled.ok) return [] as { argText: string; process: string; value: number | null; error: string }[];
    if (!cxTable.ok) return [];
    return cxTable.data.rows.slice(0, 20).map((row) => {
      const env: Record<string, number> = {};
      for (const k of Object.keys(cxParams.env)) env[k] = cxParams.env[k];
      cxVarNames.forEach((n, i) => {
        env[n] = row.args[i];
      });
      const argText = cxVarNames
        .map((n, i) => `${n} = ${numText(row.args[i])}`)
        .join(", ");
      let process = "";
      if (row.value !== null) {
        process = formatAst(substituteValues(cxCompiled.ast, env));
      }
      return { argText, process, value: row.value, error: row.error };
    });
  }, [cxCompiled, cxTable, cxParams, cxVarNames]);

  /* ---------- 复合 ---------- */
  const cgCompiled = useMemo<
    { ok: true; ast: Ast; vars: string[] } | { ok: false; message: string; pos: number; body: string }
  >(() => {
    try {
      const c = compileExpression(cgSource, null);
      return { ok: true, ast: c.ast, vars: c.vars };
    } catch (e) {
      return { ok: false, message: errMessage(e), pos: errPos(e), body: stripFunctionHeader(cgSource).body };
    }
  }, [cgSource]);

  const cgComposite = useMemo<
    | { ok: true; ast: Ast; text: string }
    | { ok: false; message: string }
  >(() => {
    if (!cxCompiled.ok) return { ok: false, message: "先把左边的 f(x) 写对再来做复合" };
    if (!cgCompiled.ok) return { ok: false, message: "内层函数 g(x) 还没写对" };
    if (cxVarNames.length !== 1) {
      return { ok: false, message: "复合函数目前只支持单自变量的 f（左边现在有 " + cxVarNames.length + " 个自变量）" };
    }
    const paramNames = cxParamNames;
    for (const name of cgCompiled.vars) {
      if (paramNames.indexOf(name) >= 0) {
        return {
          ok: false,
          message: `名字冲突：f 的参数「${name}」在内层 g(x) 里也出现了，两者含义不同，请给其中一个换个名字`,
        };
      }
      if (cxVarNames.indexOf(name) < 0) {
        return {
          ok: false,
          message: `内层 g 里出现了 f 没有的自变量「${name}」，复合之后它仍然是自由的，请改成只用 ${cxVarNames.join("、")}`,
        };
      }
    }
    const ast = composeAst(cgCompiled.ast, cxCompiled.ast, cxVarNames[0]);
    return { ok: true, ast, text: formatAst(ast) };
  }, [cxCompiled, cgCompiled, cxVarNames, cxParamNames]);

  const cgEvaluator = useMemo<((args: number[]) => number) | null>(() => {
    if (!cgComposite.ok) return null;
    if (cxParams.problems.length > 0) return null;
    if (cxLists.some((l) => !l.ok)) return null;
    const ast = cgComposite.ast;
    const paramEnv = cxParams.env;
    return (args: number[]) => {
      const env: Record<string, number> = {};
      for (const k of Object.keys(paramEnv)) env[k] = paramEnv[k];
      cxVarNames.forEach((n, i) => {
        env[n] = args[i];
      });
      return checkFinite(evalAst(ast, env));
    };
  }, [cgComposite, cxParams, cxLists, cxVarNames]);

  const cgTable = useMemo<{ ok: true; data: TableData } | { ok: false; message: string }>(() => {
    if (!cgEvaluator) return { ok: false, message: "" };
    try {
      return { ok: true, data: buildValueTable(cxVarNames, cxLists.map((l) => l.values), cgEvaluator) };
    } catch (e) {
      return { ok: false, message: errMessage(e) };
    }
  }, [cgEvaluator, cxVarNames, cxLists]);

  /* ---------- 反函数 ---------- */
  const inverseAz = useMemo(() => {
    if (!cxCompiled.ok || cxVarNames.length !== 1) return null;
    return symbolicInverse(cxCompiled.ast, cxVarNames[0], "y");
  }, [cxCompiled, cxVarNames]);

  const inverseTable = useMemo(() => {
    if (!cxEvaluator || !inverseAz || !inverseAz.ok || cxVarNames.length !== 1) return null;
    const varName = cxVarNames[0];
    const invAst = renameVar(inverseAz.expr, "y", "\u0002inv");
    const samples = (() => {
      try {
        return parseValueList(invY);
      } catch {
        return [] as number[];
      }
    })();
    const rows = samples.map((y) => {
      const env: Record<string, number> = { "\u0002inv": y };
      try {
        const x = checkFinite(evalAst(invAst, env), "反函数值");
        const back = cxEvaluator([x]);
        return { y, x, back, err: Math.abs(back - y) };
      } catch (e) {
        return { y, x: null as number | null, back: null as number | null, err: null as number | null, error: errMessage(e) };
      }
    });
    const errs = rows.map((r) => r.err).filter((v): v is number => typeof v === "number");
    return { varName, rows: rows as (typeof rows[0] & { error?: string })[], maxErr: errs.length ? Math.max.apply(null, errs) : null };
  }, [cxEvaluator, inverseAz, cxVarNames, invY]);

  const numericInverseResult = useMemo(() => {
    if (!cxEvaluator || cxVarNames.length !== 1) return null;
    if (inverseAz && inverseAz.ok) return null;
    let y: number;
    let lo: number;
    let hi: number;
    try {
      y = evalConstant(invY.split(",")[0] || "0");
      lo = evalConstant(invLo);
      hi = evalConstant(invHi);
    } catch (e) {
      return { error: errMessage(e), solutions: [] as number[], y: 0 };
    }
    try {
      const solutions = numericInverse((x) => cxEvaluator([x]), y, lo, hi);
      return { error: "", solutions, y };
    } catch (e) {
      return { error: errMessage(e), solutions: [] as number[], y };
    }
  }, [cxEvaluator, cxVarNames, inverseAz, invY, invLo, invHi]);

  /* ---------- 分段函数 ---------- */
  const pwCompiled = useMemo<
    { ok: true; compiled: CompiledPiecewise } | { ok: false; message: string }
  >(() => {
    try {
      return { ok: true, compiled: compilePiecewiseRules(pwRules) };
    } catch (e) {
      return { ok: false, message: errMessage(e) };
    }
  }, [pwRules]);

  const pwBreakpoints = useMemo(() => {
    if (!pwCompiled.ok) return { points: [] as ReturnType<typeof collectBreakpoints>, notes: [] as string[] };
    const points = collectBreakpoints(pwCompiled.compiled);
    return { points, notes: analyzeBreakpoints(pwCompiled.compiled, points) };
  }, [pwCompiled]);

  const pwVarNames = useMemo(
    () => (pwCompiled.ok ? pwCompiled.compiled.vars : []),
    [pwCompiled],
  );

  const pwLists = useMemo(() => {
    const out: { name: string; ok: boolean; values: number[]; message: string }[] = [];
    for (const n of pwVarNames) {
      try {
        out.push({ name: n, ok: true, values: parseValueList(valueOf(n, "var")), message: "" });
      } catch (e) {
        out.push({ name: n, ok: false, values: [], message: errMessage(e) });
      }
    }
    return out;
  }, [pwVarNames, valueOf]);

  const pwTable = useMemo<
    { ok: true; data: TableData & { hits: number[] } } | { ok: false; message: string }
  >(() => {
    if (!pwCompiled.ok) return { ok: false, message: "" };
    if (pwLists.some((l) => !l.ok)) return { ok: false, message: "" };
    if (pwVarNames.length === 0) return { ok: false, message: "" };
    const compiled = pwCompiled.compiled;
    const hits: number[] = compiled.rules.map(() => 0);
    try {
      const data = buildValueTable(pwVarNames, pwLists.map((l) => l.values), (args) => {
        const env: Record<string, number> = {};
        pwVarNames.forEach((n, i) => {
          env[n] = args[i];
        });
        const r = evalPiecewise(compiled, env);
        hits[r.index] += 1;
        return r.value;
      });
      return { ok: true, data: { ...data, hits } };
    } catch (e) {
      return { ok: false, message: errMessage(e) };
    }
  }, [pwCompiled, pwLists, pwVarNames]);

  /* ---------- 统计 ---------- */
  const statsValues = useMemo<
    { ok: true; values: number[] } | { ok: false; message: string }
  >(() => {
    try {
      return { ok: true, values: parseNumberList(statsInput) };
    } catch (e) {
      return { ok: false, message: errMessage(e) };
    }
  }, [statsInput]);

  const statsPValue = useMemo(() => {
    const v = Number(statsP);
    return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 90;
  }, [statsP]);

  const statsItems = useMemo(() => {
    if (!statsValues.ok) return [] as StatItem[];
    return computeStats(statsValues.values, { quantileP: statsPValue });
  }, [statsValues, statsPValue]);

  /* ============================ 渲染 ============================ */

  const tabs: { id: TopTab; label: string; icon: ReactNode }[] = [
    { id: "library", label: "函数库", icon: <Sigma className="h-3.5 w-3.5" /> },
    { id: "custom", label: "自定义 f(x)", icon: <Sparkles className="h-3.5 w-3.5" /> },
    { id: "stats", label: "统计", icon: <BarChart3 className="h-3.5 w-3.5" /> },
  ];

  const presetCopyText = `${currentPreset.name}：${
    presetResult.value === null ? presetResult.error || "无结果" : show(presetResult.value)
  }${presetResult.value !== null && presetResult.unit && presetResult.unit.length <= 2 ? presetResult.unit : ""}`;

  const tableColumns = cxTable.ok && cxVarNames.length > 0
    ? cxVarNames.concat([`f(${cxVarNames.join(", ")})`])
    : [];

  const tableRows: string[][] = cxTable.ok
    ? cxTable.data.rows.map((r) =>
        r.args.map((a) => show(a)).concat([r.value === null ? r.error || "算不出" : show(r.value)]),
      )
    : [];

  const tableCsv =
    tableColumns.length > 0 ? toDelimited(tableColumns, tableRows, ",") : "";
  const tableTsv =
    tableColumns.length > 0 ? toDelimited(tableColumns, tableRows, "\t") : "";

  const downloadCsv = (text: string, filename: string) => {
    try {
      const blob = new Blob([`\uFEFF${text}`], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.setTimeout(() => URL.revokeObjectURL(url), 1500);
      toast({ title: "已导出 CSV", variant: "success" });
    } catch {
      toast({ title: "导出失败，可以改用「复制 CSV」", variant: "error" });
    }
  };

  const resetLibParams = () => {
    setLibParams({});
    toast({ title: "已恢复默认参数", variant: "info" });
  };

  const fillCustomExample = () => {
    setCxSource("a*x^2 + b*x + c");
    setCxSig("f(x; a, b, c)");
    setCxRoles({ a: "param", b: "param", c: "param" });
    setCxValues({ x: "1..5", a: "1", b: "-5", c: "6" });
    toast({ title: "已填入示例：二次函数 f(x) = x² − 5x + 6", variant: "success" });
  };

  const clearCustom = () => {
    setCxSource("");
    setCxSig("");
    setCxRoles({});
    setCxValues({});
    toast({ title: "已清空函数定义", variant: "info" });
  };

  return (
    <div className={cn("mx-auto space-y-6", tab === "custom" ? "max-w-[1140px]" : "max-w-5xl")}>
      {/* ---------- 顶部：工作区切换 + 显示设置 ---------- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-xl border border-border/40 bg-muted/60 p-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => {
                setTab(t.id);
                trackToolUsage("func-calc");
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-4 py-2 text-xs font-semibold transition-all",
                tab === t.id
                  ? "bg-background font-bold text-foreground shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 rounded-xl border border-border/40 bg-muted/50 p-1">
            <span className="px-1.5 text-[11px] font-medium text-muted-foreground">小数位</span>
            {PRECISION_CHOICES.map((p) => (
              <SegmentedButton key={p} active={precision === p} onClick={() => setPrecision(p)}>
                {p}
              </SegmentedButton>
            ))}
            <input
              type="number"
              min={0}
              max={15}
              value={precision}
              onChange={(e) => setPrecision(Math.max(0, Math.min(15, Number(e.target.value) || 0)))}
              className="ml-0.5 w-12 rounded-md border border-border/60 bg-background/90 px-1 py-0.5 text-center font-mono text-xs text-foreground"
              title="自定义小数位数（0 - 15）"
            />
          </div>
          <button
            type="button"
            onClick={() => setGroup(!group)}
            className={cn(
              "rounded-xl border px-3 py-2 text-xs font-medium transition-all",
              group
                ? "border-primary/30 bg-primary/10 text-primary"
                : "border-border/40 bg-muted/50 text-muted-foreground hover:text-foreground",
            )}
            title="给整数部分加千分位分隔符"
          >
            千分位 {group ? "开" : "关"}
          </button>
        </div>
      </div>

      {/* ===================== 一、函数库 ===================== */}
      {tab === "library" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-3">
            <div className="flex items-center gap-1 rounded-xl border border-border/40 bg-muted/40 p-1 text-xs">
              {[
                { id: "all", name: "全部" },
                { id: "finance", name: "财税与金融" },
                { id: "math", name: "工程与数学" },
              ].map((c) => (
                <SegmentedButton
                  key={c.id}
                  active={libCategory === c.id}
                  onClick={() => {
                    setLibCategory(c.id as "all" | PresetCategory);
                  }}
                  className="flex-1 text-center"
                >
                  {c.name}
                </SegmentedButton>
              ))}
            </div>

            <div className="thin-scroll max-h-[520px] space-y-2 overflow-y-auto pr-1">
              {filteredPresets.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => {
                    setLibFuncId(f.id);
                    setLibParams({});
                  }}
                  className={cn(
                    "w-full space-y-1 rounded-xl border p-3 text-left transition-all",
                    libFuncId === f.id
                      ? "border-primary/50 bg-primary/10 shadow-xs"
                      : "border-border/40 bg-card/60 hover:bg-card/80",
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-foreground">{f.name}</span>
                    <span className="shrink-0 rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                      {f.category === "finance" ? "金融" : "数学"}
                    </span>
                  </div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">{f.formulaStr}</div>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-6 rounded-2xl border border-border/70 bg-card/60 p-6 shadow-sm backdrop-blur-md lg:col-span-2">
            <div className="space-y-3">
              <div className="rounded-xl border border-border/40 bg-muted/30 p-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-foreground">{currentPreset.name}</h3>
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm" onClick={resetLibParams}>
                      <Undo2 className="h-3.5 w-3.5" />
                      恢复默认
                    </Button>
                  </div>
                </div>
                <div className="mt-2 select-all rounded-lg border border-border/50 bg-background/80 p-2.5 font-mono text-xs text-foreground">
                  {currentPreset.formulaStr}
                </div>
                <p className="pt-2 text-xs leading-relaxed text-muted-foreground">{currentPreset.desc}</p>
              </div>

              <div className="space-y-3">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                  <Sliders className="h-3.5 w-3.5 text-primary" />
                  参数输入
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  {currentPreset.params.map((p) => (
                    <div key={p.id} className="space-y-1.5">
                      <Label className="flex justify-between">
                        <span>{p.name}</span>
                        {p.unit ? <span className="text-[10px]">{p.unit}</span> : null}
                      </Label>
                      <Input
                        type="number"
                        className="font-mono"
                        value={libParams[p.id] !== undefined ? libParams[p.id] : p.defaultValue}
                        onChange={(e) => setLibParams((prev) => ({ ...prev, [p.id]: e.target.value }))}
                      />
                      {p.hint ? <div className="text-[10px] text-muted-foreground">{p.hint}</div> : null}
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {presetResult.error ? (
              <ErrorLine message={presetResult.error} pos={-1} source="" />
            ) : null}

            <div className="space-y-4">
              <ResultBox
                caption={`${currentPreset.name} 的结果${presetResult.unit && presetResult.unit.length <= 2 ? `（${presetResult.unit}）` : ""}${
                  presetResult.unit && presetResult.unit.length > 2 ? ` ${presetResult.unit}` : ""
                }`}
                text={presetResult.value === null ? "无实数结果" : show(presetResult.value)}
                note={`小数位 ${precision}${group ? "，整数部分带千分位" : ""}`}
                onCopy={() => copyText(presetCopyText, "preset", "结果已复制")}
              />

              {presetResult.steps.length > 0 ? (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-foreground">计算过程</div>
                  <DataTable
                    columns={["项目", "计算式", "数值"]}
                    align={["left", "left", "right"]}
                    rows={presetResult.steps.map((s) => [
                      s.label,
                      s.expr,
                      s.value === null ? (s.unit ?? "—") : `${show(s.value)}${s.unit && s.unit.length <= 2 ? s.unit : ""}`,
                    ])}
                  />
                </div>
              ) : null}

              {presetResult.notes.length > 0 ? (
                <ul className="space-y-1 text-xs leading-relaxed text-muted-foreground">
                  {presetResult.notes.map((n, i) => (
                    <li key={i} className="flex gap-1.5">
                      <span className="text-primary">·</span>
                      <span>{n}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {/* ===================== 二、自定义 f(x) ===================== */}
      {tab === "custom" && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap rounded-xl border border-border/40 bg-muted/50 p-1">
              {[
                { id: "eval", label: "代入求值", icon: <Sigma className="h-3.5 w-3.5" /> },
                { id: "table", label: "函数值表", icon: <Table2 className="h-3.5 w-3.5" /> },
                { id: "compose", label: "复合与反函数", icon: <Workflow className="h-3.5 w-3.5" /> },
                { id: "piecewise", label: "分段函数", icon: <Layers className="h-3.5 w-3.5" /> },
              ].map((m) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => {
                    setCxMode(m.id as CustomMode);
                    trackToolUsage("func-calc");
                  }}
                  className={cn(
                    "flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-xs font-medium transition-all",
                    cxMode === m.id
                      ? "bg-background font-semibold text-foreground shadow-xs"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {m.icon}
                  {m.label}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={cxMode === "piecewise" ? () => setPwRules(DEFAULT_PIECEWISE_RULES) : fillCustomExample}>
                <Sparkles className="h-3.5 w-3.5" />
                填入示例
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={
                  cxMode === "piecewise"
                    ? () => {
                        setPwRules([{ cond: "x < 0", expr: "" }]);
                        toast({ title: "已清空分段定义", variant: "info" });
                      }
                    : clearCustom
                }
              >
                <Eraser className="h-3.5 w-3.5" />
                清空
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
            {/* ----- 左：定义 ----- */}
            <div className="space-y-5 lg:col-span-5">
              {cxMode === "piecewise" ? (
                <div className="space-y-4 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-sm backdrop-blur-md">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-foreground">分段定义</span>
                    <span className="text-[11px] text-muted-foreground">从上往下第一个成立的条件生效</span>
                  </div>
                  <div className="space-y-3">
                    {pwRules.map((rule, idx) => (
                      <div key={idx} className="space-y-2 rounded-xl border border-border/50 bg-muted/25 p-3">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-foreground">第 {idx + 1} 段</span>
                          <button
                            type="button"
                            onClick={() => setPwRules(pwRules.filter((_, i) => i !== idx))}
                            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                            title="删除这一段"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <Input
                          className="font-mono text-xs"
                          placeholder="条件，例如 x < 0"
                          value={rule.cond}
                          onChange={(e) =>
                            setPwRules(pwRules.map((r, i) => (i === idx ? { ...r, cond: e.target.value } : r)))
                          }
                        />
                        <Input
                          className="font-mono text-xs"
                          placeholder="表达式，例如 -x"
                          value={rule.expr}
                          onChange={(e) =>
                            setPwRules(pwRules.map((r, i) => (i === idx ? { ...r, expr: e.target.value } : r)))
                          }
                        />
                      </div>
                    ))}
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setPwRules(pwRules.concat([{ cond: "", expr: "" }]))}>
                    <Plus className="h-3.5 w-3.5" />
                    添加一段
                  </Button>

                  {!pwCompiled.ok && pwCompiled.message ? (
                    <ErrorLine message={pwCompiled.message} pos={-1} source="" />
                  ) : null}

                  {pwVarNames.length > 0 ? (
                    <div className="space-y-2 border-t border-border/40 pt-3">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                        <Sliders className="h-3.5 w-3.5 text-primary" />
                        自变量取值（可写 1..10、1..10:2、-3, 0, 3）
                      </div>
                      {pwVarNames.map((n) => (
                        <div key={n} className="flex items-center gap-2">
                          <span className="w-10 shrink-0 font-mono text-xs text-foreground">{n} =</span>
                          <Input
                            className="font-mono text-xs"
                            value={valueOf(n, "var")}
                            onChange={(e) => setCxValues({ ...cxValues, [n]: e.target.value })}
                          />
                        </div>
                      ))}
                      {pwLists
                        .filter((l) => !l.ok)
                        .map((l) => (
                          <ErrorLine key={l.name} message={`${l.name} 的取值：${l.message}`} pos={-1} source="" />
                        ))}
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="space-y-4 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-sm backdrop-blur-md">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-foreground">函数定义</span>
                    <span className="text-[11px] text-muted-foreground">f(x) = … 可以一起写进来</span>
                  </div>
                  <Textarea
                    className="min-h-[88px] font-mono text-sm"
                    value={cxSource}
                    spellCheck={false}
                    placeholder="例如 a*x^2 + b*x + c，或者 f(x; a, b, c) = a*x^2 + b*x + c"
                    onChange={(e) => setCxSource(e.target.value)}
                  />
                  <div className="space-y-1.5">
                    <Label>签名（可选，用来声明自变量与参数）</Label>
                    <Input
                      className="font-mono text-xs"
                      value={cxSig}
                      spellCheck={false}
                      placeholder="例如 f(x; a, b)"
                      onChange={(e) => setCxSig(e.target.value)}
                    />
                    <div className="text-[10px] leading-relaxed text-muted-foreground">
                      分号前面是自变量、后面是参数。不写签名时，式子里出现的名字会全部当成自变量；
                      多字母名字按单字母的隐式乘法处理（xy 就是 x×y）。
                    </div>
                  </div>

                  {!cxCompiled.ok && cxCompiled.message ? (
                    <ErrorLine message={cxCompiled.message} pos={cxCompiled.pos} source={cxCompiled.body} />
                  ) : null}

                  {cxCompiled.ok && cxNames.length > 0 ? (
                    <div className="space-y-3 border-t border-border/40 pt-3">
                      <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                        <Sliders className="h-3.5 w-3.5 text-primary" />
                        识别到 {cxNames.length} 个名字，点标签可以切换它的角色
                      </div>
                      <div className="space-y-2">
                        {cxNames.map((n) => {
                          const role =
                            cxRoles[n] ?? (cxCompiled.params.indexOf(n) >= 0 ? "param" : "var");
                          return (
                            <div key={n} className="flex items-center gap-2">
                              <div className="flex shrink-0 rounded-lg border border-border/50 bg-muted/40 p-0.5">
                                <button
                                  type="button"
                                  onClick={() => setCxRoles({ ...cxRoles, [n]: "var" })}
                                  className={cn(
                                    "rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-all",
                                    role === "var"
                                      ? "bg-background text-foreground shadow-xs"
                                      : "text-muted-foreground",
                                  )}
                                >
                                  自变量
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setCxRoles({ ...cxRoles, [n]: "param" })}
                                  className={cn(
                                    "rounded-md px-1.5 py-0.5 text-[10px] font-medium transition-all",
                                    role === "param"
                                      ? "bg-background text-foreground shadow-xs"
                                      : "text-muted-foreground",
                                  )}
                                >
                                  参数
                                </button>
                              </div>
                              <span className="w-8 shrink-0 font-mono text-xs text-foreground">{n} =</span>
                              <Input
                                className="font-mono text-xs"
                                value={valueOf(n, role)}
                                spellCheck={false}
                                onChange={(e) => setCxValues({ ...cxValues, [n]: e.target.value })}
                              />
                            </div>
                          );
                        })}
                      </div>
                      <div className="text-[10px] leading-relaxed text-muted-foreground">
                        自变量可以填多个点或区间：1..5、-3..3:0.5、10..1（倒序）、0, 0.5, 1；参数只能填一个数。
                      </div>
                      {cxParams.problems.length > 0
                        ? cxParams.problems.map((p) => <ErrorLine key={p} message={p} pos={-1} source="" />)
                        : null}
                      {cxLists
                        .filter((l) => !l.ok)
                        .map((l) => (
                          <ErrorLine key={l.name} message={`${l.name} 的取值：${l.message}`} pos={-1} source="" />
                        ))}
                    </div>
                  ) : null}

                  {(cxDomain.length > 0 || cxRange) && cxCompiled.ok ? (
                    <div className="space-y-2 border-t border-border/40 pt-3">
                      <div className="text-xs font-semibold text-foreground">定义域与值域提示</div>
                      <ul className="space-y-1 text-[11px] leading-relaxed text-muted-foreground">
                        {cxDomain.length === 0 ? (
                          <li className="flex gap-1.5">
                            <span className="text-primary">·</span>
                            <span>
                              式子里没有分式、根号、对数、三角函数这类会限制取值的地方，{cxVarNames[0] ?? "自变量"} 可以取任意实数。
                            </span>
                          </li>
                        ) : (
                          cxDomain.map((n, i) => (
                            <li key={i} className="flex gap-1.5">
                              <span className="text-primary">·</span>
                              <span>{n}</span>
                            </li>
                          ))
                        )}
                        {cxRange ? (
                          <li className="flex gap-1.5">
                            <span className="text-primary">·</span>
                            <span>
                              {cxRange.text}
                              {cxRange.exact ? "" : "（这是如实说明，不是没算）"}
                            </span>
                          </li>
                        ) : null}
                      </ul>
                    </div>
                  ) : null}
                </div>
              )}

              <div className="space-y-2 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-sm">
                <div className="text-xs font-semibold text-foreground">支持的写法</div>
                <div className="font-mono text-[11px] leading-relaxed text-muted-foreground">
                  + − × ÷ ^ % 幂用 ^（2^3^2 = 512，右结合）；一元负号比幂低（-2^2 = -4）
                </div>
                <div className="font-mono text-[11px] leading-relaxed text-muted-foreground">
                  隐式乘法：2x、3sin(x)、xy、2(x+1) 都行（1/2x 按 (1/2)·x 处理，要 1/(2x) 请加括号）
                </div>
                <div className="font-mono text-[11px] leading-relaxed text-muted-foreground">
                  常量：pi π e tau ｜ log(x) 是自然对数，log(x, b) 是任意底，log10 / log2 是常用底
                </div>
                <div className="break-words font-mono text-[11px] leading-relaxed text-muted-foreground">
                  函数：{FUNC_NAME_LIST.join(" ")}
                </div>
              </div>
            </div>

            {/* ----- 右：结果 ----- */}
            <div className="space-y-5 lg:col-span-7">
              {/* 代入求值 */}
              {cxMode === "eval" && (
                <div className="space-y-4 rounded-2xl border border-border/70 bg-card/60 p-6 shadow-sm backdrop-blur-md">
                  {cxEvaluator && cxTable.ok ? (
                    cxTable.data.rows.length === 1 ? (
                      <>
                        <ResultBox
                          caption={`f(${cxTable.data.rows[0].args.map((a, i) => `${cxVarNames[i]} = ${numText(a)}`).join(", ")})`}
                          text={cxTable.data.rows[0].value === null ? "算不出来" : show(cxTable.data.rows[0].value)}
                          note={`小数位 ${precision}`}
                          onCopy={() =>
                            copyText(
                              `${cxTable.data.rows[0].value === null ? cxTable.data.rows[0].error : show(cxTable.data.rows[0].value)}`,
                              "cx-eval",
                              "函数值已复制",
                            )
                          }
                        />
                        {cxTable.data.rows[0].value === null && cxTable.data.rows[0].error ? (
                          <ErrorLine message={cxTable.data.rows[0].error} pos={-1} source="" />
                        ) : null}
                      </>
                    ) : (
                      <div className="space-y-3">
                        <div className="text-xs text-muted-foreground">
                          一共 {cxTable.data.rows.length} 个取值点，其中 {cxTable.data.okCount} 个算出了函数值
                          {cxTable.data.errorCount > 0 ? `，${cxTable.data.errorCount} 个点没有定义（表里已标注原因）` : ""}。
                        </div>
                        <DataTable
                          columns={cxVarNames.concat([`f(${cxVarNames.join(", ")})`])}
                          align={cxVarNames.map(() => "right" as const).concat(["right"])}
                          rows={cxTable.data.rows.map((r) =>
                            r.args
                              .map((a): string | { text: string } => show(a))
                              .concat([r.value === null ? { text: r.error || "算不出" } : show(r.value)]),
                          )}
                        />
                      </div>
                    )
                  ) : (
                    <div className="rounded-xl border border-border/50 bg-muted/25 p-5 text-xs text-muted-foreground">
                      把左边的函数定义写对，再给自变量填上取值，这里会立刻给出函数值。
                    </div>
                  )}

                  {cxEvalDetail.length > 0 && cxEvalDetail.length <= 8 ? (
                    <div className="space-y-2">
                      <div className="text-xs font-semibold text-foreground">代入过程</div>
                      <div className="space-y-1.5">
                        {cxEvalDetail.map((d, i) => (
                          <div
                            key={i}
                            className="select-all rounded-lg border border-border/40 bg-background/70 px-3 py-2 font-mono text-[11px] leading-relaxed text-foreground"
                          >
                            {d.value === null
                              ? `f(${d.argText}) → ${d.error}`
                              : `f(${d.argText}) = ${d.process} = ${show(d.value)}`}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </div>
              )}

              {/* 函数值表 */}
              {cxMode === "table" && (
                <div className="space-y-4 rounded-2xl border border-border/70 bg-card/60 p-6 shadow-sm backdrop-blur-md">
                  {cxTable.ok && cxTable.data.rows.length > 0 ? (
                    <>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs text-muted-foreground">
                          共 {cxTable.data.rows.length} 行
                          {cxTable.data.errorCount > 0
                            ? `，其中 ${cxTable.data.errorCount} 行落在定义域之外（已标注原因）`
                            : "，全部算出结果"}
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => copyText(tableTsv, "cx-tsv", "表格已复制（制表符分隔，可直接粘进 Excel）")}
                          >
                            {copiedKey === "cx-tsv" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                            复制表格
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => copyText(tableCsv, "cx-csv", "CSV 已复制")}>
                            <Copy className="h-3.5 w-3.5" />
                            复制 CSV
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => downloadCsv(tableCsv, "函数值表.csv")}>
                            <Download className="h-3.5 w-3.5" />
                            导出 CSV
                          </Button>
                        </div>
                      </div>
                      <DataTable
                        columns={tableColumns}
                        align={tableColumns.map(() => "right" as const)}
                        rows={cxTable.data.rows.map((r) =>
                          r.args
                            .map((a): string | { text: string } => show(a))
                            .concat([r.value === null ? { text: r.error || "算不出" } : show(r.value)]),
                        )}
                      />
                      <div className="text-[11px] leading-relaxed text-muted-foreground">
                        表格上限 {MAX_TABLE_ROWS} 行；多自变量时按笛卡尔积展开。导出的是 CSV 文本（UTF-8 带 BOM，Excel 直接打开不乱码）。
                      </div>
                    </>
                  ) : (
                    <div className="rounded-xl border border-border/50 bg-muted/25 p-5 text-xs text-muted-foreground">
                      {cxTable.ok ? "还没有取值，请给自变量填上区间，例如 1..10。" : cxTable.message || "把左边的函数定义写对，这里会生成函数值表。"}
                    </div>
                  )}
                </div>
              )}

              {/* 复合与反函数 */}
              {cxMode === "compose" && (
                <div className="space-y-5">
                  <div className="space-y-4 rounded-2xl border border-border/70 bg-card/60 p-6 shadow-sm backdrop-blur-md">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <Workflow className="h-3.5 w-3.5 text-primary" />
                      复合函数 f(g(x))
                    </div>
                    <div className="space-y-1.5">
                      <Label>内层 g(x) 的表达式</Label>
                      <Input
                        className="font-mono text-sm"
                        value={cgSource}
                        spellCheck={false}
                        placeholder="例如 x + 1"
                        onChange={(e) => setCgSource(e.target.value)}
                      />
                    </div>
                    {!cgCompiled.ok && cgCompiled.message ? (
                      <ErrorLine message={cgCompiled.message} pos={cgCompiled.pos} source={cgCompiled.body} />
                    ) : null}

                    {cgComposite.ok ? (
                      <>
                        <div className="space-y-2">
                          <div className="text-xs font-semibold text-foreground">符号结果</div>
                          <div className="select-all break-words rounded-lg border border-border/50 bg-background/80 p-3 font-mono text-xs leading-relaxed text-foreground">
                            f(g({cxVarNames[0]})) = {cgComposite.text}
                          </div>
                        </div>
                        {cgTable.ok && cgTable.data.rows.length > 0 ? (
                          <div className="space-y-2">
                            <div className="text-xs font-semibold text-foreground">复合后的函数值</div>
                            <DataTable
                              columns={cxVarNames.concat([`f(g(${cxVarNames.join(", ")}))`])}
                              align={cxVarNames.map(() => "right" as const).concat(["right"])}
                              rows={cgTable.data.rows
                                .slice(0, 50)
                                .map((r) =>
                                  r.args
                                    .map((a): string | { text: string } => show(a))
                                    .concat([r.value === null ? { text: r.error || "算不出" } : show(r.value)]),
                                )}
                            />
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <div className="rounded-xl border border-destructive/25 bg-destructive/10 px-4 py-3 text-xs text-destructive">
                        {cgComposite.message}
                      </div>
                    )}
                  </div>

                  <div className="space-y-4 rounded-2xl border border-border/70 bg-card/60 p-6 shadow-sm backdrop-blur-md">
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                      <Undo2 className="h-3.5 w-3.5 text-primary" />
                      反函数 f⁻¹
                    </div>
                    {inverseAz === null ? (
                      <div className="rounded-xl border border-border/50 bg-muted/25 p-4 text-xs text-muted-foreground">
                        反函数只对单自变量的 f 有意义，请先把左边的自变量收敛到一个。
                      </div>
                    ) : inverseAz.ok ? (
                      <>
                        <div className="flex items-center gap-2">
                          <Badge variant="success">符号解</Badge>
                          <span className="text-[11px] text-muted-foreground">由表达式逐层解出，不是数值近似</span>
                        </div>
                        <div className="select-all break-words rounded-lg border border-border/50 bg-background/80 p-3 font-mono text-xs leading-relaxed text-foreground">
                          f⁻¹(y) = {formatAst(inverseAz.expr)}
                        </div>
                        <div className="space-y-1.5">
                          <Label>代入检验的 y 值（可写多个或区间）</Label>
                          <Input
                            className="font-mono text-xs"
                            value={invY}
                            spellCheck={false}
                            onChange={(e) => setInvY(e.target.value)}
                          />
                        </div>
                        {inverseTable ? (
                          <>
                            <DataTable
                              columns={["y", "f⁻¹(y) = x", "f(x) 回代", "误差 |f(x) − y|"]}
                              align={["right", "right", "right", "right"]}
                              rows={inverseTable.rows.map((r) =>
                                r.x === null
                                  ? [show(r.y), { text: r.error || "算不出" }, "—", "—"]
                                  : [show(r.y), show(r.x), show(r.back), show(r.err)],
                              )}
                            />
                            {inverseTable.maxErr !== null ? (
                              <div className="text-[11px] text-muted-foreground">
                                回代最大误差 {inverseTable.maxErr < 1e-12 ? "小于 1e-12" : numText(inverseTable.maxErr)}
                                （把 f⁻¹ 的值代回 f 得到的数与原 y 的差，用来验证反函数解对了）
                              </div>
                            ) : null}
                          </>
                        ) : null}
                        {inverseAz.notes.map((n, i) => (
                          <div key={i} className="text-[11px] leading-relaxed text-muted-foreground">
                            · {n}
                          </div>
                        ))}
                      </>
                    ) : (
                      <div className="space-y-3">
                        <div className="flex items-center gap-2">
                          <Badge variant="secondary">数值解</Badge>
                          <span className="text-[11px] text-muted-foreground">
                            符号解不出来，下面用的是二分法数值求解，结果是近似值
                          </span>
                        </div>
                        <div className="rounded-xl border border-border/50 bg-muted/25 p-3 text-[11px] leading-relaxed text-muted-foreground">
                          {inverseAz.reason}
                        </div>
                        <div className="grid grid-cols-3 gap-3">
                          <div className="space-y-1.5">
                            <Label>目标函数值 y</Label>
                            <Input
                              className="font-mono text-xs"
                              value={invY}
                              spellCheck={false}
                              onChange={(e) => setInvY(e.target.value)}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>搜索区间起点</Label>
                            <Input
                              className="font-mono text-xs"
                              value={invLo}
                              spellCheck={false}
                              onChange={(e) => setInvLo(e.target.value)}
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label>搜索区间终点</Label>
                            <Input
                              className="font-mono text-xs"
                              value={invHi}
                              spellCheck={false}
                              onChange={(e) => setInvHi(e.target.value)}
                            />
                          </div>
                        </div>
                        {numericInverseResult ? (
                          numericInverseResult.error ? (
                            <ErrorLine message={numericInverseResult.error} pos={-1} source="" />
                          ) : numericInverseResult.solutions.length === 0 ? (
                            <div className="rounded-xl border border-border/50 bg-muted/25 p-4 text-xs text-muted-foreground">
                              在 [{invLo}, {invHi}] 里没有找到使 f(x) = {show(numericInverseResult.y)} 的解；可以换一个区间或换一个 y 再试。
                            </div>
                          ) : (
                            <DataTable
                              columns={["序号", "x（数值解）", "f(x) 回代", "误差"]}
                              align={["right", "right", "right", "right"]}
                              rows={numericInverseResult.solutions.map((x, i) => {
                                let back: number | null = null;
                                try {
                                  back = cxEvaluator ? cxEvaluator([x]) : null;
                                } catch {
                                  back = null;
                                }
                                return [
                                  String(i + 1),
                                  show(x),
                                  show(back),
                                  back === null ? "—" : show(Math.abs(back - numericInverseResult.y)),
                                ];
                              })}
                            />
                          )
                        ) : null}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* 分段函数 */}
              {cxMode === "piecewise" && (
                <div className="space-y-5">
                  <div className="space-y-3 rounded-2xl border border-border/70 bg-card/60 p-6 shadow-sm backdrop-blur-md">
                    <div className="text-xs font-semibold text-foreground">分段点提示</div>
                    {pwBreakpoints.notes.length === 0 ? (
                      <div className="text-xs text-muted-foreground">还没有可分析的分段点。</div>
                    ) : (
                      <ul className="space-y-1.5 text-[11px] leading-relaxed text-muted-foreground">
                        {pwBreakpoints.notes.map((n, i) => (
                          <li key={i} className="flex gap-1.5">
                            <span className="text-primary">·</span>
                            <span>{n}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                    {pwTable.ok && pwVarNames.length > 0 ? (
                      <DataTable
                        columns={["段号", "条件", "表达式", "本次取值命中行数"]}
                        align={["left", "left", "left", "right"]}
                        rows={pwRules.map((r, i) => [
                          `第 ${i + 1} 段`,
                          r.cond || "—",
                          r.expr || "—",
                          String(pwTable.data.hits[i] ?? 0),
                        ])}
                      />
                    ) : null}
                  </div>

                  {pwTable.ok && pwVarNames.length > 0 ? (
                    <div className="space-y-3 rounded-2xl border border-border/70 bg-card/60 p-6 shadow-sm backdrop-blur-md">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs text-muted-foreground">
                          共 {pwTable.data.rows.length} 行，{pwTable.data.okCount} 行落在某一段里
                          {pwTable.data.errorCount > 0 ? `，${pwTable.data.errorCount} 行没有任何一段覆盖` : ""}
                        </div>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              copyText(
                                toDelimited(
                                  pwVarNames.concat(["f"]),
                                  pwTable.data.rows.map((r) =>
                                    r.args
                                      .map((a) => show(a))
                                      .concat([r.value === null ? r.error || "无定义" : show(r.value)]),
                                  ),
                                  "\t",
                                ),
                                "pw-tsv",
                                "表格已复制",
                              )
                            }
                          >
                            {copiedKey === "pw-tsv" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                            复制表格
                          </Button>
                        </div>
                      </div>
                      <DataTable
                        columns={pwVarNames.concat(["f(分段)"])}
                        align={pwVarNames.map(() => "right" as const).concat(["right"])}
                        rows={pwTable.data.rows
                          .slice(0, MAX_TABLE_ROWS)
                          .map((r) =>
                            r.args
                              .map((a): string | { text: string } => show(a))
                              .concat([r.value === null ? { text: r.error || "无定义" } : show(r.value)]),
                          )}
                      />
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-border/70 bg-card/60 p-6 text-xs text-muted-foreground shadow-sm">
                      {pwTable.ok ? "还没有取值，请给自变量填上区间。" : pwTable.message || "把左边的分段定义写对，这里会给出函数值与值表。"}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ===================== 三、统计 ===================== */}
      {tab === "stats" && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          <div className="space-y-5 lg:col-span-4">
            <div className="space-y-3 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-sm backdrop-blur-md">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-foreground">一列数字</span>
                <span className="text-[11px] text-muted-foreground">逗号、空格、换行都可以分隔</span>
              </div>
              <Textarea
                className="min-h-[200px] font-mono text-sm"
                value={statsInput}
                spellCheck={false}
                placeholder="12, 15, 9, 22, 15"
                onChange={(e) => setStatsInput(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setStatsInput("12, 15, 9, 22, 15, 18, 30, 15, 24, 11")}
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  填入示例
                </Button>
                <Button variant="outline" size="sm" onClick={() => setStatsInput("")}>
                  <Eraser className="h-3.5 w-3.5" />
                  清空
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    copyText(
                      statsItems
                        .map((it) => `${it.label}\t${it.text !== undefined ? it.text : show(it.value)}`)
                        .join("\n"),
                      "stats",
                      "统计结果已复制",
                    )
                  }
                >
                  {copiedKey === "stats" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  复制全部
                </Button>
              </div>
              <div className="space-y-1.5 border-t border-border/40 pt-3">
                <Label>自定义分位数 P（百分位，0 - 100）</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    className="w-24 font-mono text-xs"
                    value={statsP}
                    onChange={(e) => setStatsP(e.target.value)}
                  />
                  <div className="flex gap-1">
                    {[10, 25, 50, 90, 95, 99].map((p) => (
                      <SegmentedButton key={p} active={statsP === String(p)} onClick={() => setStatsP(String(p))}>
                        P{p}
                      </SegmentedButton>
                    ))}
                  </div>
                </div>
                <div className="text-[10px] leading-relaxed text-muted-foreground">
                  分位数用线性插值法（与 Excel 的 PERCENTILE.INC 一致），Q1 / 中位数 / Q3 同样按这个方法计算。
                </div>
              </div>
              {!statsValues.ok ? <ErrorLine message={statsValues.message} pos={-1} source="" /> : null}
              {statsValues.ok ? (
                <div className="text-[11px] text-muted-foreground">
                  已识别 {statsValues.values.length} 个数，最小 {show(Math.min.apply(null, statsValues.values))}，最大{" "}
                  {show(Math.max.apply(null, statsValues.values))}
                </div>
              ) : null}
            </div>
          </div>

          <div className="space-y-4 lg:col-span-8">
            {statsItems.length > 0 ? (
              <div className="space-y-3 rounded-2xl border border-border/70 bg-card/60 p-6 shadow-sm backdrop-blur-md">
                <div className="text-xs font-semibold text-foreground">
                  {statsItems.length} 项统计量
                </div>
                <DataTable
                  columns={["统计量", "说明", "数值"]}
                  align={["left", "left", "right"]}
                  rows={statsItems.map((it) => [
                    it.label,
                    { text: it.note, muted: false },
                    it.text !== undefined ? it.text : show(it.value),
                  ])}
                />
              </div>
            ) : (
              <div className="rounded-2xl border border-border/70 bg-card/60 p-6 text-xs text-muted-foreground shadow-sm">
                在左边输入一列数字（例如 12, 15, 9, 22），这里会给出计数、求和、平均、中位数、众数、两种口径的方差与标准差、四分位数与自定义分位数等全部统计量。
              </div>
            )}
          </div>
        </div>
      )}

      {/* 底部一行小字：说明本工具的计算口径，不重复工具名与描述 */}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
        <BarChart3 className="h-3.5 w-3.5" />
        全部计算在本机完成，表达式由内置解析器求值（不使用 eval），结果按上面选的小数位显示。
      </div>
    </div>
  );
}
