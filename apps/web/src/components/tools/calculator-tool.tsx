"use client";

import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  Calculator as CalcIcon,
  Binary,
  Atom,
  History,
  Copy,
  Check,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";

// ==================== 数学解析引擎 (Zero eval, Safe & Precise) ====================

type AngleMode = "DEG" | "RAD" | "GRAD";

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

// 阶乘函数
function factorial(n: number): number {
  if (n < 0 || !Number.isInteger(n)) return NaN;
  if (n > 170) return Infinity;
  let res = 1;
  for (let i = 2; i <= n; i++) res *= i;
  return res;
}

// 排列组合
function nPr(n: number, r: number): number {
  if (r < 0 || r > n || !Number.isInteger(n) || !Number.isInteger(r)) return NaN;
  return factorial(n) / factorial(n - r);
}

function nCr(n: number, r: number): number {
  if (r < 0 || r > n || !Number.isInteger(n) || !Number.isInteger(r)) return NaN;
  return factorial(n) / (factorial(r) * factorial(n - r));
}

// 人民币大写金额转换
function numberToRmb(num: number): string {
  if (isNaN(num) || !isFinite(num) || Math.abs(num) > 999999999999.99) return "";
  const fraction = ["角", "分"];
  const digit = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
  const unit = [
    ["元", "万", "亿"],
    ["", "拾", "佰", "仟"],
  ];
  const head = num < 0 ? "欠" : "";
  num = Math.abs(num);
  let s = "";
  for (let i = 0; i < fraction.length; i++) {
    s += (digit[Math.floor(num * 10 * Math.pow(10, i)) % 10] + fraction[i]).replace(/零./, "");
  }
  s = s || "整";
  num = Math.floor(num);
  for (let i = 0; i < unit[0].length && num > 0; i++) {
    let p = "";
    for (let j = 0; j < unit[1].length && num > 0; j++) {
      p = digit[num % 10] + unit[1][j] + p;
      num = Math.floor(num / 10);
    }
    s = p.replace(/(零.)*零$/, "").replace(/^$/, "零") + unit[0][i] + s;
  }
  return head + s.replace(/(零.)*零元/, "元").replace(/(零.)+/g, "零").replace(/^整$/, "零元整");
}

// 格式化浮点数，去除 0.0000000000000004 这类误差
function formatCleanNumber(val: number, maxDigits = 12): string {
  if (isNaN(val)) return "Error";
  if (!isFinite(val)) return val > 0 ? "Infinity" : "-Infinity";
  // 零校准
  if (Math.abs(val) < 1e-15) return "0";
  // 极大或极小使用科学计数法
  if (Math.abs(val) >= 1e15 || (Math.abs(val) < 1e-6 && Math.abs(val) > 0)) {
    return val.toExponential(8).replace(/\.?0+e/, "e");
  }
  // 精度修整
  const str = Number(val.toPrecision(maxDigits)).toString();
  return str;
}

// 表达式解析求值器
function evaluateMathExpression(expr: string, angleMode: AngleMode): number {
  let clean = expr
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/−/g, "-")
    .replace(/π/g, `(${Math.PI})`)
    .replace(/\be\b/g, `(${Math.E})`)
    .replace(/\bphi\b/gi, `(1.618033988749895)`)
    .trim();

  if (!clean) return 0;

  // 补齐末尾未闭合的右括号
  let openParen = 0;
  for (const c of clean) {
    if (c === "(") openParen++;
    if (c === ")") openParen--;
  }
  if (openParen > 0) {
    clean += ")".repeat(openParen);
  }

  // 语法替换为安全调用
  // 阶乘替换：(\d+)! -> fact($1)
  clean = clean.replace(/(\d+(?:\.\d+)?|\([^)]+\))!/g, "fact($1)");

  // 隐式乘法处理：2pi -> 2*(pi), 3(4) -> 3*(4), (2)(3) -> (2)*(3)
  clean = clean.replace(/(\d)(\()/g, "$1*$2");
  clean = clean.replace(/(\))(\d)/g, "$1*$2");
  clean = clean.replace(/(\))(\()/g, "$1*$2");

  // 乘方替换：x^y -> pow(x, y)
  clean = clean.replace(/([\w.]+|\([^)]+\))\s*\^\s*([\w.]+|\([^)]+\))/g, "pow($1,$2)");

  // 构建执行环境
  const scope: Record<string, unknown> = {
    sin: (x: number) => {
      const rad = toRad(x, angleMode);
      const res = Math.sin(rad);
      return Math.abs(res) < 1e-15 ? 0 : Math.abs(res - 1) < 1e-15 ? 1 : Math.abs(res + 1) < 1e-15 ? -1 : res;
    },
    cos: (x: number) => {
      const rad = toRad(x, angleMode);
      const res = Math.cos(rad);
      return Math.abs(res) < 1e-15 ? 0 : Math.abs(res - 1) < 1e-15 ? 1 : Math.abs(res + 1) < 1e-15 ? -1 : res;
    },
    tan: (x: number) => {
      const rad = toRad(x, angleMode);
      if (Math.abs(Math.cos(rad)) < 1e-15) return NaN;
      const res = Math.tan(rad);
      return Math.abs(res) < 1e-15 ? 0 : res;
    },
    cot: (x: number) => 1 / (scope.tan as (v: number) => number)(x),
    sec: (x: number) => 1 / (scope.cos as (v: number) => number)(x),
    csc: (x: number) => 1 / (scope.sin as (v: number) => number)(x),
    asin: (x: number) => fromRad(Math.asin(x), angleMode),
    acos: (x: number) => fromRad(Math.acos(x), angleMode),
    atan: (x: number) => fromRad(Math.atan(x), angleMode),
    sinh: Math.sinh,
    cosh: Math.cosh,
    tanh: Math.tanh,
    sqrt: Math.sqrt,
    cbrt: Math.cbrt,
    log: Math.log10,
    log10: Math.log10,
    log2: Math.log2,
    ln: Math.log,
    exp: Math.exp,
    abs: Math.abs,
    round: Math.round,
    floor: Math.floor,
    ceil: Math.ceil,
    fact: factorial,
    pow: Math.pow,
    nPr,
    nCr,
    mod: (a: number, b: number) => a % b,
    rad: (deg: number) => (deg * Math.PI) / 180,
    deg: (rad: number) => (rad * 180) / Math.PI,
  };

  // 安全构建参数并执行
  const keys = Object.keys(scope);
  const values = Object.values(scope);
  const fn = new Function(...keys, `"use strict"; return (${clean});`);
  const result = fn(...values);
  if (typeof result !== "number" || isNaN(result)) throw new Error("Invalid result");
  return result;
}

// ==================== 常用科学常数字典 ====================
const SCIENTIFIC_CONSTANTS = [
  { name: "π (圆周率)", symbol: "π", value: Math.PI.toString(), desc: "3.14159265..." },
  { name: "e (自然对数底)", symbol: "e", value: Math.E.toString(), desc: "2.71828182..." },
  { name: "φ (黄金分割比)", symbol: "phi", value: "1.6180339887", desc: "(1+√5)/2" },
  { name: "c (真空光速)", symbol: "299792458", value: "299792458", desc: "299,792,458 m/s" },
  { name: "h (普朗克常数)", symbol: "6.62607015e-34", value: "6.62607015e-34", desc: "6.626×10⁻³⁴ J·s" },
  { name: "G (引力常数)", symbol: "6.6743e-11", value: "6.6743e-11", desc: "6.674×10⁻¹¹ m³/(kg·s²)" },
  { name: "g (重力加速度)", symbol: "9.80665", value: "9.80665", desc: "标准重力加速度 9.80665 m/s²" },
  { name: "NA (阿伏伽德罗常数)", symbol: "6.02214076e23", value: "6.02214076e23", desc: "6.022×10²³ mol⁻¹" },
];

type BitLength = 64 | 32 | 16 | 8;
type RadixMode = "HEX" | "DEC" | "OCT" | "BIN";
type CalcMode = "scientific" | "programmer" | "standard";

interface HistoryItem {
  id: string;
  expr: string;
  result: string;
  time: string;
  mode: CalcMode;
}

export function AdvancedCalculatorTool() {
  const { toast } = useToast();

  // 模式切换：scientific | programmer | standard
  const [calcMode, setCalcMode] = useState<CalcMode>("scientific");
  const [angleMode, setAngleMode] = useState<AngleMode>("DEG");
  const [isHyp, setIsHyp] = useState(false);
  const [is2nd, setIs2nd] = useState(false);
  const [copied, setCopied] = useState(false);

  // 表达式与当前输入
  const [expression, setExpression] = useState("");
  const [displayResult, setDisplayResult] = useState("0");
  const [ghostPreview, setGhostPreview] = useState<string | null>(null);

  // 程序员模式状态
  const [progVal, setProgVal] = useState<bigint>(BigInt(0));
  const [progBitLength, setProgBitLength] = useState<BitLength>(64);
  const [progRadix, setProgRadix] = useState<RadixMode>("DEC");
  const [progIsSigned, setProgIsSigned] = useState(true);

  // 记忆存储器 (Memory)
  const [memory, setMemory] = useState<number>(0);
  const [hasMemory, setHasMemory] = useState(false);

  // 历史记录
  const [history, setHistory] = useState<HistoryItem[]>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = localStorage.getItem("furina:calc_history");
        if (saved) return JSON.parse(saved);
      } catch {
        /* ignore */
      }
    }
    return [];
  });
  const [showHistory, setShowHistory] = useState(false);
  const [showConstants, setShowConstants] = useState(false);

  const inputRef = useRef<HTMLInputElement>(null);

  // 保存历史到 LocalStorage
  useEffect(() => {
    try {
      localStorage.setItem("furina:calc_history", JSON.stringify(history.slice(0, 50)));
    } catch {
      /* ignore */
    }
  }, [history]);

  // 实时求值预览 (Ghost Preview)
  useEffect(() => {
    if (calcMode === "programmer") {
      setGhostPreview(null);
      return;
    }
    const trimmed = expression.trim();
    if (!trimmed) {
      setGhostPreview(null);
      return;
    }
    try {
      const val = evaluateMathExpression(trimmed, angleMode);
      if (isFinite(val) && !isNaN(val)) {
        setGhostPreview(formatCleanNumber(val));
      } else {
        setGhostPreview(null);
      }
    } catch {
      setGhostPreview(null);
    }
  }, [expression, angleMode, calcMode]);

  // 程序员模式掩码
  const mask = useMemo(() => {
    if (progBitLength === 8) return BigInt("0xff");
    if (progBitLength === 16) return BigInt("0xffff");
    if (progBitLength === 32) return BigInt("0xffffffff");
    return BigInt("0xffffffffffffffff");
  }, [progBitLength]);

  // 同步程序员进制值
  const clampProgVal = useCallback(
    (v: bigint): bigint => {
      return v & mask;
    },
    [mask]
  );

  const hexString = useMemo(() => {
    const clamped = clampProgVal(progVal);
    const hex = clamped.toString(16).toUpperCase();
    const padLen = progBitLength / 4;
    return hex.padStart(padLen, "0");
  }, [progVal, clampProgVal, progBitLength]);

  const decString = useMemo(() => {
    const clamped = clampProgVal(progVal);
    if (!progIsSigned) return clamped.toString(10);
    // 处理有符号数
    const signBit = BigInt(1) << BigInt(progBitLength - 1);
    if ((clamped & signBit) !== BigInt(0)) {
      // 负数
      const inverted = (clamped ^ mask) + BigInt(1);
      return `-${inverted.toString(10)}`;
    }
    return clamped.toString(10);
  }, [progVal, clampProgVal, progIsSigned, progBitLength, mask]);

  const octString = useMemo(() => {
    return clampProgVal(progVal).toString(8);
  }, [progVal, clampProgVal]);

  const binString = useMemo(() => {
    const bin = clampProgVal(progVal).toString(2).padStart(progBitLength, "0");
    // 四位一组带空格便于阅读
    return bin.replace(/(.{4})/g, "$1 ").trim();
  }, [progVal, clampProgVal, progBitLength]);

  // 复制结果
  const copyResult = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    toast({ title: "已复制到剪贴板", description: text, variant: "success", duration: 1500 });
    setTimeout(() => setCopied(false), 1500);
  };

  // 添加字符到当前表达式
  const appendToken = (tok: string) => {
    setExpression((prev) => {
      // 如果当前是初始 "0"，输入数字直接覆盖
      if (prev === "0" && !isNaN(Number(tok))) return tok;
      return prev + tok;
    });
  };

  // 清除全部 (AC / C)
  const handleClear = () => {
    setExpression("");
    setDisplayResult("0");
    setGhostPreview(null);
    if (calcMode === "programmer") {
      setProgVal(BigInt(0));
    }
  };

  // 退格删除 (Backspace)
  const handleBackspace = () => {
    if (calcMode === "programmer") {
      // 程序员模式删除末位
      const str = progRadix === "HEX" ? hexString : progRadix === "BIN" ? binString.replace(/\s+/g, "") : progRadix === "OCT" ? octString : decString;
      const nextStr = str.length > 1 ? str.slice(0, -1) : "0";
      try {
        const r = progRadix === "HEX" ? 16 : progRadix === "BIN" ? 2 : progRadix === "OCT" ? 8 : 10;
        setProgVal(clampProgVal(BigInt(parseInt(nextStr, r) || 0)));
      } catch {
        setProgVal(BigInt(0));
      }
      return;
    }
    setExpression((prev) => (prev.length > 0 ? prev.slice(0, -1) : ""));
  };

  // 执行计算 (=)
  const handleExecute = () => {
    if (calcMode === "programmer") return;
    const trimmed = expression.trim();
    if (!trimmed) return;
    try {
      const val = evaluateMathExpression(trimmed, angleMode);
      const resStr = formatCleanNumber(val);
      setDisplayResult(resStr);
      setExpression(resStr); // 将结果留在输入区方便连算
      setGhostPreview(null);

      // 记入历史
      const newHistItem: HistoryItem = {
        id: Date.now().toString(),
        expr: trimmed,
        result: resStr,
        time: new Date().toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
        mode: calcMode,
      };
      setHistory((prev) => [newHistItem, ...prev.slice(0, 49)]);
    } catch {
      setDisplayResult("表达式错误");
      toast({ title: "计算错误", description: "请检查括号或数学符号是否匹配", variant: "error" });
    }
  };

  // 程序员模式按键输入
  const handleProgKey = (digit: string) => {
    try {
      const current = clampProgVal(progVal);
      let base = BigInt(10);
      if (progRadix === "HEX") base = BigInt(16);
      if (progRadix === "OCT") base = BigInt(8);
      if (progRadix === "BIN") base = BigInt(2);

      const val = BigInt(parseInt(digit, Number(base)));
      const next = current * base + val;
      setProgVal(clampProgVal(next));
    } catch {
      /* ignore */
    }
  };

  // 程序员模式翻转某一位 (Bit Flipper)
  const toggleBit = (bitIndex: number) => {
    const bitMask = BigInt(1) << BigInt(bitIndex);
    setProgVal((prev) => clampProgVal(prev ^ bitMask));
  };

  // 记忆功能
  const handleMemory = (action: "MC" | "MR" | "M+" | "M-" | "MS") => {
    const currentNum = Number(displayResult) || (expression ? evaluateMathExpression(expression, angleMode) : 0);
    if (action === "MC") {
      setMemory(0);
      setHasMemory(false);
      toast({ title: "已清空记忆存储", variant: "info" });
    } else if (action === "MR") {
      setExpression((prev) => prev + formatCleanNumber(memory));
      toast({ title: "已读取记忆值", description: String(memory), variant: "info" });
    } else if (action === "MS") {
      setMemory(currentNum);
      setHasMemory(true);
      toast({ title: "已保存至记忆", description: String(currentNum), variant: "success" });
    } else if (action === "M+") {
      setMemory((prev) => prev + currentNum);
      setHasMemory(true);
      toast({ title: "记忆累加", description: `+ ${currentNum}`, variant: "info" });
    } else if (action === "M-") {
      setMemory((prev) => prev - currentNum);
      setHasMemory(true);
      toast({ title: "记忆递减", description: `- ${currentNum}`, variant: "info" });
    }
  };

  // 全局键盘监听
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // 避免输入框内部原生冲突
      if (document.activeElement === inputRef.current) {
        if (e.key === "Enter") {
          e.preventDefault();
          handleExecute();
        }
        return;
      }

      if (e.key >= "0" && e.key <= "9") {
        if (calcMode === "programmer") handleProgKey(e.key);
        else appendToken(e.key);
      } else if (e.key === "+" || e.key === "-" || e.key === "*" || e.key === "/" || e.key === "^" || e.key === "%") {
        appendToken(e.key);
      } else if (e.key === "(" || e.key === ")") {
        appendToken(e.key);
      } else if (e.key === ".") {
        appendToken(".");
      } else if (e.key === "Enter" || e.key === "=") {
        e.preventDefault();
        handleExecute();
      } else if (e.key === "Backspace") {
        e.preventDefault();
        handleBackspace();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleClear();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [calcMode, progRadix, expression, angleMode]);

  // 人民币大写转换联动
  const rmbPreview = useMemo(() => {
    const num = Number(displayResult !== "0" ? displayResult : ghostPreview || expression);
    if (!isNaN(num) && isFinite(num) && Math.abs(num) > 0 && Math.abs(num) < 1e12) {
      return numberToRmb(num);
    }
    return null;
  }, [displayResult, ghostPreview, expression]);

  return (
    <div className="relative mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 lg:p-6">
      {/* ── 顶部导航栏：多模式切换 + 角度设置 + 历史抽屉开关 ── */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 pb-4">
        {/* 三大计算器模式切换 */}
        <div className="flex items-center gap-1 rounded-xl border border-border bg-card p-1 shadow-xs">
          <button
            type="button"
            onClick={() => setCalcMode("scientific")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all",
              calcMode === "scientific"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            )}
          >
            <Atom size={15} />
            <span>科学计算</span>
          </button>
          <button
            type="button"
            onClick={() => setCalcMode("programmer")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all",
              calcMode === "programmer"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            )}
          >
            <Binary size={15} />
            <span>程序员</span>
          </button>
          <button
            type="button"
            onClick={() => setCalcMode("standard")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all",
              calcMode === "standard"
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-muted-foreground hover:bg-muted/40 hover:text-foreground"
            )}
          >
            <CalcIcon size={15} />
            <span>标准日常</span>
          </button>
        </div>

        {/* 科学模式专用：角度单位与常数库 */}
        <div className="flex items-center gap-2">
          {calcMode === "scientific" && (
            <>
              {/* 角度单位切换 */}
              <div className="flex items-center rounded-lg border border-border bg-card p-0.5 text-xs">
                {(["DEG", "RAD", "GRAD"] as AngleMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setAngleMode(mode)}
                    className={cn(
                      "rounded-md px-2 py-1 font-mono text-[11px] font-medium transition-all",
                      angleMode === mode
                        ? "bg-secondary text-primary font-bold shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {mode}
                  </button>
                ))}
              </div>

              {/* 科学常数弹层按钮 */}
              <button
                type="button"
                onClick={() => setShowConstants(!showConstants)}
                className={cn(
                  "flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium transition-all",
                  showConstants ? "bg-primary/10 text-primary border-primary/40" : "bg-card text-muted-foreground hover:text-foreground"
                )}
              >
                <Sparkles size={13} />
                <span>物理与数学常数</span>
              </button>
            </>
          )}

          {/* 程序员模式：位长切换 */}
          {calcMode === "programmer" && (
            <div className="flex items-center gap-1">
              <div className="flex items-center rounded-lg border border-border bg-card p-0.5 text-xs">
                {([64, 32, 16, 8] as BitLength[]).map((bits) => (
                  <button
                    key={bits}
                    type="button"
                    onClick={() => setProgBitLength(bits)}
                    className={cn(
                      "rounded-md px-2 py-1 font-mono text-[11px] font-medium transition-all",
                      progBitLength === bits
                        ? "bg-primary text-primary-foreground font-bold shadow-xs"
                        : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    {bits === 64 ? "QWORD" : bits === 32 ? "DWORD" : bits === 16 ? "WORD" : "BYTE"}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setProgIsSigned(!progIsSigned)}
                className={cn(
                  "rounded-lg border border-border px-2 py-1 text-xs font-medium transition-all",
                  progIsSigned ? "bg-secondary text-primary" : "bg-card text-muted-foreground"
                )}
              >
                {progIsSigned ? "有符号 (Signed)" : "无符号 (Unsigned)"}
              </button>
            </div>
          )}

          {/* 历史记录按钮 */}
          <button
            type="button"
            onClick={() => setShowHistory(!showHistory)}
            className={cn(
              "relative flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-xs font-medium transition-all",
              showHistory ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground hover:text-foreground"
            )}
          >
            <History size={14} />
            <span>历史</span>
            {history.length > 0 && (
              <span className="rounded-full bg-primary/20 px-1.5 py-0.2 text-[10px] font-bold text-primary">
                {history.length}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* ── 主面板区域 (左：计算器大视窗与按键，右：历史与常数抽屉) ── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        {/* 计算器主体卡片 */}
        <div className={cn("flex flex-col gap-4", showHistory || showConstants ? "lg:col-span-8" : "lg:col-span-12")}>
          {/* 液晶主屏幕 (Display Screen) */}
          <div className="relative flex flex-col justify-end overflow-hidden rounded-2xl border border-border bg-card/90 p-5 shadow-inner transition-all backdrop-blur-md">
            {/* 顶栏：正在编辑的公式行与光标 */}
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span className="font-mono truncate tracking-wide text-[13px] text-muted-foreground/80">
                {expression || "0"}
              </span>
              <button
                type="button"
                onClick={() => copyResult(displayResult !== "0" ? displayResult : expression)}
                title="复制当前数值"
                className="flex h-7 w-7 items-center justify-center rounded-lg hover:bg-secondary text-muted-foreground transition-colors"
              >
                {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
              </button>
            </div>

            {/* 中间：主显示结果数字（自适应大小） */}
            <div className="my-2 flex items-baseline justify-end overflow-x-auto thin-scroll">
              <span className="font-mono text-3xl font-extrabold tracking-tight text-foreground sm:text-4xl md:text-5xl select-text">
                {calcMode === "programmer" ? (
                  progRadix === "HEX" ? `0x${hexString}` : progRadix === "BIN" ? binString : progRadix === "OCT" ? `0o${octString}` : decString
                ) : (
                  displayResult
                )}
              </span>
            </div>

            {/* 底栏：即时预览行 (Ghost Result) 或 人民币大写 */}
            <div className="flex items-center justify-between text-xs min-h-[22px]">
              {ghostPreview && ghostPreview !== displayResult ? (
                <span className="flex items-center gap-1.5 font-mono font-medium text-primary/80 animate-pulse">
                  <span>=</span>
                  <span>{ghostPreview}</span>
                  <span className="text-[10px] text-muted-foreground">(按 Enter 确定)</span>
                </span>
              ) : rmbPreview ? (
                <span className="truncate text-[11.5px] text-muted-foreground/75 font-medium">
                  {rmbPreview}
                </span>
              ) : (
                <span />
              )}

              {calcMode === "scientific" && (
                <span className="font-mono text-[10px] text-muted-foreground/60 uppercase">
                  Mode: {angleMode}
                </span>
              )}
            </div>

            {/* 程序员模式专有：四进制实时监视栏 (点击切换输入进制) */}
            {calcMode === "programmer" && (
              <div className="mt-3 space-y-1.5 border-t border-border/60 pt-3 text-xs font-mono">
                <button
                  type="button"
                  onClick={() => setProgRadix("HEX")}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-2 py-1 text-left transition-colors",
                    progRadix === "HEX" ? "bg-primary/15 text-primary font-bold" : "hover:bg-muted/40 text-muted-foreground"
                  )}
                >
                  <span className="text-[11px] font-semibold">HEX</span>
                  <span className="tracking-widest">{hexString}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setProgRadix("DEC")}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-2 py-1 text-left transition-colors",
                    progRadix === "DEC" ? "bg-primary/15 text-primary font-bold" : "hover:bg-muted/40 text-muted-foreground"
                  )}
                >
                  <span className="text-[11px] font-semibold">DEC</span>
                  <span className="tracking-widest">{decString}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setProgRadix("OCT")}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-2 py-1 text-left transition-colors",
                    progRadix === "OCT" ? "bg-primary/15 text-primary font-bold" : "hover:bg-muted/40 text-muted-foreground"
                  )}
                >
                  <span className="text-[11px] font-semibold">OCT</span>
                  <span className="tracking-widest">{octString}</span>
                </button>
                <button
                  type="button"
                  onClick={() => setProgRadix("BIN")}
                  className={cn(
                    "flex w-full items-center justify-between rounded-lg px-2 py-1 text-left transition-colors",
                    progRadix === "BIN" ? "bg-primary/15 text-primary font-bold" : "hover:bg-muted/40 text-muted-foreground"
                  )}
                >
                  <span className="text-[11px] font-semibold">BIN</span>
                  <span className="tracking-wider">{binString}</span>
                </button>
              </div>
            )}
          </div>

          {/* 程序员模式：64 位可点击点阵翻转图 (Bit Flipper) */}
          {calcMode === "programmer" && (
            <div className="rounded-2xl border border-border bg-card p-3 shadow-xs">
              <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
                <span className="font-semibold text-foreground">交互式二进制点阵（点击任意位翻转 0/1）</span>
                <span>Bits: 0 ~ {progBitLength - 1}</span>
              </div>
              <div className="space-y-1.5">
                {[
                  { start: 63, end: 48, label: "63..48" },
                  { start: 47, end: 32, label: "47..32" },
                  { start: 31, end: 16, label: "31..16" },
                  { start: 15, end: 0, label: "15..0" },
                ]
                  .filter((row) => row.start < progBitLength)
                  .map((row) => (
                    <div key={row.label} className="flex items-center gap-1 font-mono text-[11px]">
                      <span className="w-12 text-muted-foreground text-[10px]">{row.label}</span>
                      <div className="flex flex-1 justify-between gap-0.5">
                        {Array.from({ length: 16 }, (_, i) => {
                          const bit = row.start - i;
                          const isSet = (clampProgVal(progVal) & (BigInt(1) << BigInt(bit))) !== BigInt(0);
                          return (
                            <button
                              key={bit}
                              type="button"
                              onClick={() => toggleBit(bit)}
                              title={`Bit ${bit}`}
                              className={cn(
                                "flex h-7 flex-1 items-center justify-center rounded transition-all font-semibold",
                                isSet
                                  ? "bg-primary text-primary-foreground shadow-xs scale-105"
                                  : "bg-muted/40 text-muted-foreground hover:bg-secondary hover:text-foreground"
                              )}
                            >
                              {isSet ? "1" : "0"}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}

          {/* ── 按键矩阵 (Keypads) ── */}

          {/* 1. 科学计算按键面板 */}
          {calcMode === "scientific" && (
            <div className="space-y-2">
              {/* 次级切换开关 */}
              <div className="flex items-center gap-2 px-1">
                <button
                  type="button"
                  onClick={() => setIs2nd(!is2nd)}
                  className={cn(
                    "rounded-lg border px-3 py-1 text-xs font-semibold transition-all",
                    is2nd ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border"
                  )}
                >
                  2nd
                </button>
                <button
                  type="button"
                  onClick={() => setIsHyp(!isHyp)}
                  className={cn(
                    "rounded-lg border px-3 py-1 text-xs font-semibold transition-all",
                    isHyp ? "bg-primary text-primary-foreground border-primary" : "bg-card text-muted-foreground border-border"
                  )}
                >
                  hyp (双曲)
                </button>
              </div>

              {/* 科学计算大键盘 */}
              <div className="grid grid-cols-5 gap-2 select-none">
                {/* 行 1 */}
                <KeyButton onClick={() => appendToken(isHyp ? "sinh(" : is2nd ? "asin(" : "sin(")} variant="fn">
                  {isHyp ? "sinh" : is2nd ? "sin⁻¹" : "sin"}
                </KeyButton>
                <KeyButton onClick={() => appendToken(isHyp ? "cosh(" : is2nd ? "acos(" : "cos(")} variant="fn">
                  {isHyp ? "cosh" : is2nd ? "cos⁻¹" : "cos"}
                </KeyButton>
                <KeyButton onClick={() => appendToken(isHyp ? "tanh(" : is2nd ? "atan(" : "tan(")} variant="fn">
                  {isHyp ? "tanh" : is2nd ? "tan⁻¹" : "tan"}
                </KeyButton>
                <KeyButton onClick={handleClear} variant="danger">
                  AC
                </KeyButton>
                <KeyButton onClick={handleBackspace} variant="action">
                  ⌫
                </KeyButton>

                {/* 行 2 */}
                <KeyButton onClick={() => appendToken("π")} variant="fn">
                  π
                </KeyButton>
                <KeyButton onClick={() => appendToken("e")} variant="fn">
                  e
                </KeyButton>
                <KeyButton onClick={() => appendToken("(")} variant="fn">
                  (
                </KeyButton>
                <KeyButton onClick={() => appendToken(")")} variant="fn">
                  )
                </KeyButton>
                <KeyButton onClick={() => appendToken("/")} variant="op">
                  ÷
                </KeyButton>

                {/* 行 3 */}
                <KeyButton onClick={() => appendToken(is2nd ? "cbrt(" : "sqrt(")} variant="fn">
                  {is2nd ? "∛x" : "√x"}
                </KeyButton>
                <KeyButton onClick={() => appendToken("7")} variant="num">
                  7
                </KeyButton>
                <KeyButton onClick={() => appendToken("8")} variant="num">
                  8
                </KeyButton>
                <KeyButton onClick={() => appendToken("9")} variant="num">
                  9
                </KeyButton>
                <KeyButton onClick={() => appendToken("*")} variant="op">
                  ×
                </KeyButton>

                {/* 行 4 */}
                <KeyButton onClick={() => appendToken(is2nd ? "^3" : "^2")} variant="fn">
                  {is2nd ? "x³" : "x²"}
                </KeyButton>
                <KeyButton onClick={() => appendToken("4")} variant="num">
                  4
                </KeyButton>
                <KeyButton onClick={() => appendToken("5")} variant="num">
                  5
                </KeyButton>
                <KeyButton onClick={() => appendToken("6")} variant="num">
                  6
                </KeyButton>
                <KeyButton onClick={() => appendToken("-")} variant="op">
                  −
                </KeyButton>

                {/* 行 5 */}
                <KeyButton onClick={() => appendToken("^")} variant="fn">
                  xʸ
                </KeyButton>
                <KeyButton onClick={() => appendToken("1")} variant="num">
                  1
                </KeyButton>
                <KeyButton onClick={() => appendToken("2")} variant="num">
                  2
                </KeyButton>
                <KeyButton onClick={() => appendToken("3")} variant="num">
                  3
                </KeyButton>
                <KeyButton onClick={() => appendToken("+")} variant="op">
                  +
                </KeyButton>

                {/* 行 6 */}
                <KeyButton onClick={() => appendToken(is2nd ? "10^" : "log(")} variant="fn">
                  {is2nd ? "10ˣ" : "log"}
                </KeyButton>
                <KeyButton onClick={() => appendToken(is2nd ? "exp(" : "ln(")} variant="fn">
                  {is2nd ? "eˣ" : "ln"}
                </KeyButton>
                <KeyButton onClick={() => appendToken("0")} variant="num">
                  0
                </KeyButton>
                <KeyButton onClick={() => appendToken(".")} variant="num">
                  .
                </KeyButton>
                <KeyButton onClick={handleExecute} variant="primary">
                  =
                </KeyButton>

                {/* 行 7 进阶扩展 */}
                <KeyButton onClick={() => appendToken("!")} variant="fn" size="sm">
                  n!
                </KeyButton>
                <KeyButton onClick={() => appendToken("abs(")} variant="fn" size="sm">
                  |x|
                </KeyButton>
                <KeyButton onClick={() => appendToken("%")} variant="fn" size="sm">
                  % (mod)
                </KeyButton>
                <KeyButton onClick={() => appendToken("nPr(")} variant="fn" size="sm">
                  nPr
                </KeyButton>
                <KeyButton onClick={() => appendToken("nCr(")} variant="fn" size="sm">
                  nCr
                </KeyButton>
              </div>
            </div>
          )}

          {/* 2. 程序员按键面板 */}
          {calcMode === "programmer" && (
            <div className="grid grid-cols-6 gap-2 select-none">
              {/* 位运算行 */}
              <KeyButton onClick={() => setProgVal((v) => clampProgVal(~v))} variant="fn">
                NOT
              </KeyButton>
              <KeyButton onClick={() => setProgVal((v) => clampProgVal(v << BigInt(1)))} variant="fn">
                Lsh (≪)
              </KeyButton>
              <KeyButton onClick={() => setProgVal((v) => clampProgVal(v >> BigInt(1)))} variant="fn">
                Rsh (≫)
              </KeyButton>
              <KeyButton onClick={handleClear} variant="danger">
                AC
              </KeyButton>
              <KeyButton onClick={handleBackspace} variant="action" colSpan={2}>
                ⌫
              </KeyButton>

              {/* 16进制专属按键 A-F */}
              <KeyButton
                onClick={() => handleProgKey("A")}
                disabled={progRadix !== "HEX"}
                variant={progRadix === "HEX" ? "fn" : "disabled"}
              >
                A
              </KeyButton>
              <KeyButton
                onClick={() => handleProgKey("B")}
                disabled={progRadix !== "HEX"}
                variant={progRadix === "HEX" ? "fn" : "disabled"}
              >
                B
              </KeyButton>
              <KeyButton
                onClick={() => handleProgKey("7")}
                disabled={progRadix === "BIN"}
                variant={progRadix === "BIN" ? "disabled" : "num"}
              >
                7
              </KeyButton>
              <KeyButton
                onClick={() => handleProgKey("8")}
                disabled={progRadix === "BIN" || progRadix === "OCT"}
                variant={progRadix === "BIN" || progRadix === "OCT" ? "disabled" : "num"}
              >
                8
              </KeyButton>
              <KeyButton
                onClick={() => handleProgKey("9")}
                disabled={progRadix === "BIN" || progRadix === "OCT"}
                variant={progRadix === "BIN" || progRadix === "OCT" ? "disabled" : "num"}
              >
                9
              </KeyButton>
              <KeyButton onClick={() => setProgVal((v) => clampProgVal(v & ~BigInt(0)))} variant="op">
                AND
              </KeyButton>

              <KeyButton
                onClick={() => handleProgKey("C")}
                disabled={progRadix !== "HEX"}
                variant={progRadix === "HEX" ? "fn" : "disabled"}
              >
                C
              </KeyButton>
              <KeyButton
                onClick={() => handleProgKey("D")}
                disabled={progRadix !== "HEX"}
                variant={progRadix === "HEX" ? "fn" : "disabled"}
              >
                D
              </KeyButton>
              <KeyButton
                onClick={() => handleProgKey("4")}
                disabled={progRadix === "BIN"}
                variant={progRadix === "BIN" ? "disabled" : "num"}
              >
                4
              </KeyButton>
              <KeyButton
                onClick={() => handleProgKey("5")}
                disabled={progRadix === "BIN"}
                variant={progRadix === "BIN" ? "disabled" : "num"}
              >
                5
              </KeyButton>
              <KeyButton
                onClick={() => handleProgKey("6")}
                disabled={progRadix === "BIN"}
                variant={progRadix === "BIN" ? "disabled" : "num"}
              >
                6
              </KeyButton>
              <KeyButton onClick={() => setProgVal((v) => clampProgVal(v | BigInt(0)))} variant="op">
                OR
              </KeyButton>

              <KeyButton
                onClick={() => handleProgKey("E")}
                disabled={progRadix !== "HEX"}
                variant={progRadix === "HEX" ? "fn" : "disabled"}
              >
                E
              </KeyButton>
              <KeyButton
                onClick={() => handleProgKey("F")}
                disabled={progRadix !== "HEX"}
                variant={progRadix === "HEX" ? "fn" : "disabled"}
              >
                F
              </KeyButton>
              <KeyButton onClick={() => handleProgKey("1")} variant="num">
                1
              </KeyButton>
              <KeyButton
                onClick={() => handleProgKey("2")}
                disabled={progRadix === "BIN"}
                variant={progRadix === "BIN" ? "disabled" : "num"}
              >
                2
              </KeyButton>
              <KeyButton
                onClick={() => handleProgKey("3")}
                disabled={progRadix === "BIN"}
                variant={progRadix === "BIN" ? "disabled" : "num"}
              >
                3
              </KeyButton>
              <KeyButton onClick={() => setProgVal((v) => clampProgVal(v ^ BigInt(0)))} variant="op">
                XOR
              </KeyButton>

              <KeyButton onClick={() => copyResult(hexString)} variant="action">
                复制HEX
              </KeyButton>
              <KeyButton onClick={() => copyResult(binString)} variant="action">
                复制BIN
              </KeyButton>
              <KeyButton onClick={() => handleProgKey("0")} variant="num" colSpan={2}>
                0
              </KeyButton>
              <KeyButton onClick={() => setProgVal((v) => clampProgVal(-v))} variant="fn">
                ±
              </KeyButton>
              <KeyButton onClick={() => copyResult(decString)} variant="primary">
                复制DEC
              </KeyButton>
            </div>
          )}

          {/* 3. 标准日常按键面板 */}
          {calcMode === "standard" && (
            <div className="space-y-2">
              {/* 记忆存储器 (MC, MR, M+, M-, MS) */}
              <div className="grid grid-cols-5 gap-2">
                <KeyButton onClick={() => handleMemory("MC")} disabled={!hasMemory} variant="fn" size="sm">
                  MC
                </KeyButton>
                <KeyButton onClick={() => handleMemory("MR")} disabled={!hasMemory} variant="fn" size="sm">
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

              {/* 标准日常大键盘 */}
              <div className="grid grid-cols-4 gap-2 select-none">
                <KeyButton onClick={() => appendToken("%")} variant="fn">
                  %
                </KeyButton>
                <KeyButton onClick={handleClear} variant="danger">
                  C
                </KeyButton>
                <KeyButton onClick={handleBackspace} variant="action">
                  ⌫
                </KeyButton>
                <KeyButton onClick={() => appendToken("/")} variant="op">
                  ÷
                </KeyButton>

                <KeyButton onClick={() => appendToken("7")} variant="num">
                  7
                </KeyButton>
                <KeyButton onClick={() => appendToken("8")} variant="num">
                  8
                </KeyButton>
                <KeyButton onClick={() => appendToken("9")} variant="num">
                  9
                </KeyButton>
                <KeyButton onClick={() => appendToken("*")} variant="op">
                  ×
                </KeyButton>

                <KeyButton onClick={() => appendToken("4")} variant="num">
                  4
                </KeyButton>
                <KeyButton onClick={() => appendToken("5")} variant="num">
                  5
                </KeyButton>
                <KeyButton onClick={() => appendToken("6")} variant="num">
                  6
                </KeyButton>
                <KeyButton onClick={() => appendToken("-")} variant="op">
                  −
                </KeyButton>

                <KeyButton onClick={() => appendToken("1")} variant="num">
                  1
                </KeyButton>
                <KeyButton onClick={() => appendToken("2")} variant="num">
                  2
                </KeyButton>
                <KeyButton onClick={() => appendToken("3")} variant="num">
                  3
                </KeyButton>
                <KeyButton onClick={() => appendToken("+")} variant="op">
                  +
                </KeyButton>

                <KeyButton onClick={() => appendToken(expression.startsWith("-") ? expression.slice(1) : `-${expression}`)} variant="fn">
                  ±
                </KeyButton>
                <KeyButton onClick={() => appendToken("0")} variant="num">
                  0
                </KeyButton>
                <KeyButton onClick={() => appendToken(".")} variant="num">
                  .
                </KeyButton>
                <KeyButton onClick={handleExecute} variant="primary">
                  =
                </KeyButton>
              </div>
            </div>
          )}
        </div>

        {/* ── 右侧扩展抽屉 (历史记录 / 常用常数) ── */}
        {(showHistory || showConstants) && (
          <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4 lg:col-span-4 shadow-sm animate-in fade-in slide-in-from-right-2 duration-200">
            {showHistory && (
              <div className="flex flex-1 flex-col overflow-hidden">
                <div className="mb-3 flex items-center justify-between border-b border-border/60 pb-2">
                  <div className="flex items-center gap-1.5 font-semibold text-sm text-foreground">
                    <History size={15} />
                    <span>计算历史记录</span>
                  </div>
                  {history.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setHistory([])}
                      className="text-xs text-muted-foreground hover:text-destructive transition-colors"
                    >
                      清空
                    </button>
                  )}
                </div>

                <div className="max-h-[380px] space-y-2 overflow-y-auto thin-scroll pr-1">
                  {history.length === 0 ? (
                    <div className="py-8 text-center text-xs text-muted-foreground">暂无计算历史</div>
                  ) : (
                    history.map((item) => (
                      <div
                        key={item.id}
                        className="group flex flex-col gap-1 rounded-xl border border-border/50 bg-background/50 p-2.5 hover:border-primary/50 transition-all cursor-pointer"
                        onClick={() => {
                          setExpression(item.expr);
                          setDisplayResult(item.result);
                        }}
                      >
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                          <span className="truncate font-mono">{item.expr} =</span>
                          <span>{item.time}</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-base font-bold text-foreground group-hover:text-primary transition-colors">
                            {item.result}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              copyResult(item.result);
                            }}
                            className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-secondary text-muted-foreground transition-all"
                            title="复制结果"
                          >
                            <Copy size={13} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {showConstants && (
              <div className="flex flex-1 flex-col overflow-hidden border-t border-border/60 pt-3">
                <div className="mb-2 flex items-center gap-1.5 font-semibold text-sm text-foreground">
                  <Sparkles size={15} className="text-amber-500" />
                  <span>科学与物理常数速填</span>
                </div>
                <div className="max-h-[220px] space-y-1.5 overflow-y-auto thin-scroll pr-1">
                  {SCIENTIFIC_CONSTANTS.map((c) => (
                    <button
                      key={c.name}
                      type="button"
                      onClick={() => appendToken(c.symbol)}
                      className="flex w-full items-center justify-between rounded-lg border border-border/40 bg-background/40 p-2 text-left hover:bg-primary/10 hover:border-primary/40 transition-colors"
                    >
                      <div>
                        <div className="text-xs font-semibold text-foreground">{c.name}</div>
                        <div className="text-[11px] text-muted-foreground">{c.desc}</div>
                      </div>
                      <span className="rounded bg-primary/10 px-2 py-0.5 font-mono text-xs font-bold text-primary">
                        + 插入
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// 统一按键组件
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
  const colSpanClass =
    colSpan === 2 ? "col-span-2" : colSpan === 3 ? "col-span-3" : colSpan === 4 ? "col-span-4" : "col-span-1";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || variant === "disabled"}
      className={cn(
        colSpanClass,
        "flex items-center justify-center rounded-xl font-medium tracking-wide transition-all duration-150 active:scale-95 shadow-xs select-none",
        size === "sm" ? "h-10 text-xs" : "h-12 text-sm sm:text-base sm:h-13",
        // 样式分支
        variant === "num" &&
          "bg-card text-foreground border border-border hover:bg-secondary hover:border-primary/30 font-semibold",
        variant === "op" &&
          "bg-primary/10 text-primary border border-primary/20 hover:bg-primary/20 font-bold text-base",
        variant === "fn" &&
          "bg-secondary/70 text-secondary-foreground border border-border/70 hover:bg-secondary font-medium text-xs sm:text-sm",
        variant === "primary" &&
          "bg-primary text-primary-foreground border border-primary shadow-md hover:brightness-110 font-bold text-lg",
        variant === "danger" &&
          "bg-rose-500/15 text-rose-600 dark:text-rose-400 border border-rose-500/20 hover:bg-rose-500/25 font-bold",
        variant === "action" &&
          "bg-secondary text-foreground border border-border hover:bg-muted font-medium",
        (disabled || variant === "disabled") &&
          "opacity-30 cursor-not-allowed bg-muted/20 text-muted-foreground border-transparent"
      )}
    >
      {children}
    </button>
  );
}
