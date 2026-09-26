import { encryptLocalText, decryptLocalText } from "./local-text-crypto";
import { bmiSummary, boundedInteger, passwordList, randomIntegerList, crc32Utf8, ipv4ToInteger, integerToIpv4, loanSummary, creditSummary, caesar, userAgentSummary } from "./simple-safety-core";
import { localeTag as __localeTag } from "@/lib/language";
"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage, uiCount as __count } from "@/lib/language";
const __ui = __createUiText("components/tools/simple-tools.tsx");

import ReactECharts from 'echarts-for-react';
import jsQR from "jsqr";
import { useRef } from 'react';

import { useState, useMemo, useEffect, Dispatch, SetStateAction } from "react";
import { Copy, Check, RefreshCw, BookOpen, Sparkles, Info } from "lucide-react";
import { Button, Input, Label, Select, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";
import { useToolDraft } from "@/lib/use-tool-draft";
import { moneyParts, baseInteger } from "./simple-number-core";
import { jsonToTypeScript } from "./dev-format-core";
import { useFormattedCode } from "./use-formatted-code";

export { MindMapTool } from "./mind-map";
// 通用结果显示组件
function ResultBox({ title, value, mono = true }: { title: string; value: string; mono?: boolean }) {
  const __locale = __useLanguage();
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();
  const copy = () => {
    navigator.clipboard.writeText(value);
    setCopied(true);
    toast({ title: "已复制到剪贴板" });
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <div className="rounded-lg border p-4" style={{ borderColor: "hsl(var(--border))", backgroundColor: "hsl(var(--card))" }}>
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium" style={{ color: "hsl(var(--muted-foreground))" }}>{__ui(title)}</span>
        <button onClick={copy} className="flex items-center gap-1 text-xs transition-colors hover:opacity-80" style={{ color: "hsl(var(--primary))" }}>
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? __ui("已复制") : __ui("复制")}
        </button>
      </div>
      <div className={`whitespace-pre-wrap break-all text-sm ${mono ? "font-mono" : ""}`} style={{ color: "hsl(var(--foreground))" }}>
        {value || "—"}
      </div>
    </div>
  );
}

// 人民币大写转换
export function RmbUppercaseTool() {
  const __locale = __useLanguage();
  const [amount, setAmount] = useToolDraft("rmb-uppercase", "amount", "");
  const result = useMemo(() => {
    if (!amount.trim()) return "";
    let parts: ReturnType<typeof moneyParts>;
    try { parts = moneyParts(amount); }
    catch (error) { return error instanceof Error ? error.message : "无效的金额"; }
    const digits = ["零", "壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];
    const units = ["", "拾", "佰", "仟"];
    const bigUnits = ["", "万", "亿", "万亿"];
    const { intPart, decPart } = parts;
    let result = "";
    if (intPart === 0) result = "零元";
    else {
      let intStr = intPart.toString();
      const groups = [];
      while (intStr.length > 0) {
        groups.unshift(intStr.slice(-4));
        intStr = intStr.slice(0, -4);
      }
      let zeroPending = false; // 中间出现过整组为零，下一组前面需要补“零”
      for (let g = 0; g < groups.length; g++) {
        const group = groups[g];
        let groupStr = "";
        let zeroFlag = false;
        for (let i = 0; i < group.length; i++) {
          const d = parseInt(group[i]);
          const pos = group.length - 1 - i;
          if (d === 0) zeroFlag = true;
          else {
            if (zeroFlag && groupStr) groupStr += "零";
            groupStr += digits[d] + units[pos];
            zeroFlag = false;
          }
        }
        if (groupStr) {
          // 组间补零：非最高位组不足四位（数值小于 1000）或前面有整组为零时，本组前面要补“零”
          const needZero = g > 0 && (Number(group) < 1000 || zeroPending);
          if (needZero && !result.endsWith("零")) result += "零";
          result += groupStr + bigUnits[groups.length - 1 - g];
          zeroPending = false;
        } else if (result) {
          zeroPending = true;
        }
      }
      result += "元";
    }
    if (decPart === 0) result += "整";
    else {
      const jiao = Math.floor(decPart / 10);
      const fen = decPart % 10;
      if (jiao > 0) result += digits[jiao] + "角";
      if (fen > 0) {
        if (jiao === 0) result += "零";
        result += digits[fen] + "分";
      }
    }
    return (parts.negative ? "负" : "") + result;
  }, [amount, __locale]);
  return (
    <div className="space-y-4">
      <div>
        <Label>{__ui("金额（数字）")}</Label>
        <Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={__ui("例如：1234.56")} />
      </div>
      <ResultBox title={__ui("人民币大写")} value={result} mono={false} />
    </div>
  );
}

// 贷款计算器
export function LoanCalculatorTool() {
  const __locale = __useLanguage();
  const [amount, setAmount] = useToolDraft("loan-calculator", "amount", "100");
  const [years, setYears] = useToolDraft("loan-calculator", "years", "30");
  const [rate, setRate] = useToolDraft("loan-calculator", "rate", "4.2");
  const [method, setMethod] = useToolDraft("loan-calculator", "method", "equal");
  const result = useMemo(() => { try { return loanSummary(amount, years, rate, method); } catch (error) { return "错误 / Error: " + (error instanceof Error ? error.message : String(error)); } }, [amount, years, rate, method, __locale]);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div><Label>{__ui("贷款金额（万元）")}</Label><Input value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div><Label>{__ui("贷款年限（年）")}</Label><Input value={years} onChange={(e) => setYears(e.target.value)} /></div>
        <div><Label>{__ui("年利率（%）")}</Label><Input value={rate} onChange={(e) => setRate(e.target.value)} /></div>
        <div><Label>{__ui("还款方式")}</Label><Select value={method} onChange={(e) => setMethod(e.target.value)}><option value="equal">{__ui("等额本息")}</option><option value="principal">{__ui("等额本金")}</option></Select></div>
      </div>
      <ResultBox title={__ui("计算结果")} value={result} mono={false} />
    </div>
  );
}

// BMI计算器
export function BmiCalculatorTool() {
  const __locale = __useLanguage();
  const [height, setHeight] = useToolDraft("bmi-calculator", "height", "170");
  const [weight, setWeight] = useToolDraft("bmi-calculator", "weight", "65");
  const result = useMemo(() => { try { return height.trim() && weight.trim() ? bmiSummary(height, weight) : ""; } catch (error) { return "错误 / Error: " + (error instanceof Error ? error.message : String(error)); } }, [height, weight, __locale]);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div><Label>{__ui("身高（cm）")}</Label><Input value={height} onChange={(e) => setHeight(e.target.value)} /></div>
        <div><Label>{__ui("体重（kg）")}</Label><Input value={weight} onChange={(e) => setWeight(e.target.value)} /></div>
      </div>
      <ResultBox title={__ui("BMI 结果")} value={result} mono={false} />
    </div>
  );
}

// 进制转换器
export function BaseConverterTool() {
  const __locale = __useLanguage();
  const [value, setValue] = useToolDraft("base-converter", "value", "");
  const [from, setFrom] = useToolDraft("base-converter", "from", "10");
  const result = useMemo(() => {
    if (!value) return "";
    try {
      const num = baseInteger(value, Number(from));
      return `二进制：${num.toString(2)}\n八进制：${num.toString(8)}\n十进制：${num.toString(10)}\n十六进制：${num.toString(16).toUpperCase()}`;
    } catch (error) { return error instanceof Error ? error.message : "转换失败"; }
  }, [value, from, __locale]);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div><Label>{__ui("输入数值")}</Label><Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={__ui("输入要转换的数值")} /></div>
        <div><Label>{__ui("原进制")}</Label><Select value={from} onChange={(e) => setFrom(e.target.value)}><option value="2">{__ui("二进制")}</option><option value="8">{__ui("八进制")}</option><option value="10">{__ui("十进制")}</option><option value="16">{__ui("十六进制")}</option></Select></div>
      </div>
      <ResultBox title={__ui("转换结果")} value={result} />
    </div>
  );
}

// 字数统计
export function WordCountTool() {
  const __locale = __useLanguage();
  const [text, setText] = useToolDraft("word-count", "text", "");
  const result = useMemo(() => {
    if (!text) return "";
    const chars = text.length;
    const charsNoSpace = text.replace(/\s/g, "").length;
    const words = text.trim() ? text.trim().split(/\s+/).length : 0;
    const lines = text.split("\n").length;
    const paragraphs = text.trim() ? text.trim().split(/\n\s*\n/).length : 0;
    const chinese = (text.match(/[\u4e00-\u9fa5]/g) || []).length;
    return `总字符数：${chars}\n不含空格字符：${charsNoSpace}\n单词数：${words}\n中文字符：${chinese}\n行数：${lines}\n段落数：${paragraphs}`;
  }, [text, __locale]);
  return (
    <div className="space-y-4">
      <div><Label>{__ui("文本内容")}</Label><Textarea value={text} onChange={(e) => setText(e.target.value)} rows={14} className="min-h-[280px] text-sm leading-relaxed" placeholder={__ui("输入要统计的文本...")} /></div>
      <ResultBox title={__ui("统计结果")} value={result} mono={false} />
    </div>
  );
}

// 文本去重
export function TextDedupTool() {
  const __locale = __useLanguage();
  const [text, setText] = useToolDraft("text-dedup", "text", "");
  const result = useMemo(() => {
    if (!text) return "";
    const lines = text.split("\n");
    const seen = new Set();
    const unique = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (!seen.has(trimmed)) {
        seen.add(trimmed);
        unique.push(line);
      }
    }
    return `原行数：${lines.length}\n去重后：${unique.length}\n删除重复：${lines.length - unique.length}\n\n--- 去重结果 ---\n${unique.join("\n")}`;
  }, [text, __locale]);
  return (
    <div className="space-y-4">
      <div><Label>{__ui("文本内容（每行一条）")}</Label><Textarea value={text} onChange={(e) => setText(e.target.value)} rows={14} className="min-h-[280px] text-sm leading-relaxed" placeholder={__ui("输入要去重的文本，每行一条...")} /></div>
      <ResultBox title={__ui("去重结果")} value={result} />
    </div>
  );
}

// 摩斯电码
const MORSE_MAP: Record<string, string> = {
  A: ".-", B: "-...", C: "-.-.", D: "-..", E: ".", F: "..-.", G: "--.", H: "....",
  I: "..", J: ".---", K: "-.-", L: ".-..", M: "--", N: "-.", O: "---", P: ".--.",
  Q: "--.-", R: ".-.", S: "...", T: "-", U: "..-", V: "...-", W: ".--", X: "-..-",
  Y: "-.--", Z: "--..", "0": "-----", "1": ".----", "2": "..---", "3": "...--",
  "4": "....-", "5": ".....", "6": "-....", "7": "--...", "8": "---..", "9": "----.",
  ".": ".-.-.-", ",": "--..--", "?": "..--..", "'": ".----.", "!": "-.-.--",
  "/": "-..-.", "(": "-.--.", ")": "-.--.-", "&": ".-...", ":": "---...",
  ";": "-.-.-.", "=": "-...-", "+": ".-.-.", "-": "-....-", "_": "..--.-",
  '"': ".-..-.", "$": "...-..-", "@": ".--.-.",
};
const REVERSE_MORSE = Object.fromEntries(Object.entries(MORSE_MAP).map(([k, v]) => [v, k]));

export function MorseCodeTool() {
  const __locale = __useLanguage();
  const [text, setText] = useToolDraft("morse-code", "text", "");
  const [mode, setMode] = useToolDraft("morse-code", "mode", "encode");
  const result = useMemo(() => {
    if (!text) return "";
    if (mode === "encode") {
      return text.toUpperCase().split("").map(c => c === " " ? "/" : MORSE_MAP[c] || c).join(" ");
    } else {
      return text.split(/\s*\/\s*/).map(word => word.trim().split(/\s+/).map(code => REVERSE_MORSE[code] || "?").join("")).join(" ");
    }
  }, [text, mode, __locale]);
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label>{__ui("输入内容")}</Label>
          {text && <button type="button" onClick={() => setText("")} className="text-[11px] text-muted-foreground hover:text-destructive">{__ui("清空")}</button>}
        </div>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          className="min-h-[180px] text-sm font-mono leading-relaxed"
          placeholder={mode === "encode" ? __ui("输入要编码的文本...") : __ui("输入摩斯电码（用空格分隔，/ 分隔单词）...")}
        />
      </div>
      <div><Label>{__ui("转换方向")}</Label><Select value={mode} onChange={(e) => setMode(e.target.value)}><option value="encode">{__ui("文本→摩斯电码")}</option><option value="decode">{__ui("摩斯电码→文本")}</option></Select></div>
      <ResultBox title={__ui("转换结果")} value={result} />
    </div>
  );
}

// 凯撒密码
export function CaesarCipherTool() {
  const __locale = __useLanguage();
  const [text, setText] = useToolDraft("caesar-cipher", "text", "");
  const [shift, setShift] = useToolDraft("caesar-cipher", "shift", "3");
  const [mode, setMode] = useToolDraft("caesar-cipher", "mode", "encrypt");
  const result = useMemo(() => { try { return text ? caesar(text, shift, mode) : ""; } catch (error) { return "错误 / Error: " + (error instanceof Error ? error.message : String(error)); } }, [text, shift, mode, __locale]);
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label>{__ui("输入内容")}</Label>
          {text && <button type="button" onClick={() => setText("")} className="text-[11px] text-muted-foreground hover:text-destructive">{__ui("清空")}</button>}
        </div>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          className="min-h-[180px] text-sm font-mono leading-relaxed"
          placeholder={__ui("输入要加密/解密的文本...")}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div><Label>{__ui("偏移量")}</Label><Input value={shift} onChange={(e) => setShift(e.target.value)} /></div>
        <div><Label>{__ui("模式")}</Label><Select value={mode} onChange={(e) => setMode(e.target.value)}><option value="encrypt">{__ui("加密")}</option><option value="decrypt">{__ui("解密")}</option></Select></div>
      </div>
      <ResultBox title={__ui("结果")} value={result} />
    </div>
  );
}

// UUID生成器
export function UuidGeneratorTool() {
  const __locale = __useLanguage();
  const [count, setCount] = useToolDraft("uuid-generator", "count", "5");
  // 结果是点「生成」才出来的，不随输入自动重算，所以结果本身也要记住
  const [result, setResult] = useToolDraft("uuid-generator", "result", "");
  const generate = () => { try { setResult(Array.from({length: boundedInteger(count, 1, 100, "数量")}, () => crypto.randomUUID()).join("\n")); } catch (error) { setResult("错误 / Error: " + (error instanceof Error ? error.message : String(error))); } };
  return (
    <div className="space-y-4">
      <div className="flex items-end gap-4">
        <div className="flex-1"><Label>{__ui("生成数量（最多100）")}</Label><Input value={count} onChange={(e) => setCount(e.target.value)} /></div>
        <Button onClick={generate}><RefreshCw size={14} className="mr-2" />{__ui("生成")}</Button>
      </div>
      {result && <ResultBox title={__ui("UUID 列表")} value={result} />}
    </div>
  );
}

// 时间戳转换器
export function TimestampConverterTool() {
  const __locale = __useLanguage();
  const [value, setValue] = useToolDraft("timestamp-converter", "value", "");
  const [unit, setUnit] = useToolDraft("timestamp-converter", "unit", "s");
  // 「当前时间」必须等挂载之后再算：如果在渲染期调用 Date.now()，服务端渲染出一个时间戳、
  // 客户端首屏又算出一个，两边文本对不上，React 会报水合错误 #418（整页结构被重建）。
  // 这里首屏只渲染一句占位文案，挂载后每秒刷新一次 —— 顺带让时间戳变成「活的」。
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const result = useMemo(() => {
    if (!value) {
      if (now === null) return "正在读取当前时间…";
      return `当前时间戳（秒）：${Math.floor(now / 1000)}\n当前时间戳（毫秒）：${now}\n当前时间：${new Date(now).toLocaleString(__localeTag())}`;
    }
    const num = Number(value);
    if (!isNaN(num)) {
      const ms = unit === "s" ? num * 1000 : num;
      const date = new Date(ms);
      // 非法时间（如 1e20）调用 toISOString() 会抛 RangeError，渲染期执行会导致整页白屏
      if (!Number.isFinite(date.getTime())) return "时间戳超出可表示范围";
      return `时间戳：${value} (${unit === "s" ? "秒" : "毫秒"})\n日期时间：${date.toLocaleString(__localeTag())}\nUTC时间：${date.toUTCString()}\nISO格式：${date.toISOString()}`;
    }
    const date = new Date(value);
    if (!isNaN(date.getTime())) {
      return `日期：${value}\n时间戳（秒）：${Math.floor(date.getTime() / 1000)}\n时间戳（毫秒）：${date.getTime()}`;
    }
    return "无法识别的输入";
  }, [value, unit, now, __locale]);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div><Label>{__ui("时间戳或日期（留空显示当前）")}</Label><Input value={value} onChange={(e) => setValue(e.target.value)} placeholder={__ui("如：1700000000 或 2024-01-01 12:00:00")} /></div>
        <div><Label>{__ui("时间戳单位")}</Label><Select value={unit} onChange={(e) => setUnit(e.target.value)}><option value="s">{__ui("秒")}</option><option value="ms">{__ui("毫秒")}</option></Select></div>
      </div>
      <ResultBox title={__ui("转换结果")} value={result} />
    </div>
  );
}

// 随机密码生成
export function PasswordGeneratorTool() {
  const __locale = __useLanguage();
  const [length, setLength] = useToolDraft("password-generator", "length", "16");
  const [count, setCount] = useToolDraft("password-generator", "count", "5");
  // 结果是点「生成密码」才出来的，不随输入自动重算，所以结果本身也要记住
  const [result, setResult] = useState("");
  const generate = () => { try { setResult(passwordList(length, count)); } catch (error) { setResult("错误 / Error: " + (error instanceof Error ? error.message : String(error))); } };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div><Label>{__ui("密码长度")}</Label><Input value={length} onChange={(e) => setLength(e.target.value)} /></div>
        <div><Label>{__ui("生成数量（最多50）")}</Label><Input value={count} onChange={(e) => setCount(e.target.value)} /></div>
      </div>
      <Button onClick={generate}><RefreshCw size={14} className="mr-2" />{__ui("生成密码")}</Button>
      <p className="text-xs text-muted-foreground">{__ui("安全随机生成；长度1–1024，数量1–50。结果仅保留在本页，离开前请复制。 / Secure random; length 1–1024, count 1–50. Copy before leaving this page.")}</p>
      {result && <ResultBox title={__ui("密码列表")} value={result} />}
    </div>
  );
}

// 随机数生成器
export function RandomNumberTool() {
  const __locale = __useLanguage();
  const [min, setMin] = useToolDraft("random-number", "min", "1");
  const [max, setMax] = useToolDraft("random-number", "max", "100");
  const [count, setCount] = useToolDraft("random-number", "count", "5");
  // 结果是点「生成」才出来的，不随输入自动重算，所以结果本身也要记住
  const [result, setResult] = useToolDraft("random-number", "result", "");
  const generate = () => { try { setResult(randomIntegerList(min, max, count)); } catch (error) { setResult("错误 / Error: " + (error instanceof Error ? error.message : String(error))); } };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <div><Label>{__ui("最小值")}</Label><Input value={min} onChange={(e) => setMin(e.target.value)} /></div>
        <div><Label>{__ui("最大值")}</Label><Input value={max} onChange={(e) => setMax(e.target.value)} /></div>
        <div><Label>{__ui("数量（最多100）")}</Label><Input value={count} onChange={(e) => setCount(e.target.value)} /></div>
      </div>
      <Button onClick={generate}><RefreshCw size={14} className="mr-2" />{__ui("生成")}</Button>
      {result && <ResultBox title={__ui("随机数")} value={result} />}
    </div>
  );
}

// ========== 第二批工具 ==========

// 简易计算器
export function SimpleCalculatorTool() {
  const __locale = __useLanguage();
  // 注意：该组件当前没有被 tool-runner 注册（"simple-calculator" 走的是 AdvancedCalculatorTool），
  // 这里保留它自己的草稿键前缀，避免将来被注册时与计算器工具串台。
  const [expression, setExpression] = useToolDraft("simple-calculator-legacy", "expression", "");
  // 结果是点「计算」才算出来的，不随输入自动重算，所以结果本身也要记住
  const [result, setResult] = useToolDraft("simple-calculator-legacy", "result", "");
  const calc = () => {
    try {
      const sanitized = expression.replace(/[^0-9+\-*/().%\s]/g, "");
      if (!sanitized.trim()) { setResult(""); return; }
      const val = Function(`"use strict"; return (${sanitized})`)();
      setResult(String(val));
    } catch { setResult("表达式错误"); }
  };
  return (
    <div className="space-y-4">
      <div><Label>{__ui("输入表达式")}</Label><Input value={expression} onChange={(e) => { setExpression(e.target.value); }} placeholder={__ui("例如：1+2*3/(4-1)")} /></div>
      <Button onClick={calc}>{__ui("= 计算")}</Button>
      {result && <ResultBox title={__ui("计算结果")} value={result} />}
    </div>
  );
}

// 日期计算器
export function DateCalculatorTool() {
  const __locale = __useLanguage();
  const [date1, setDate1] = useToolDraft("date-calculator", "date1", "");
  const [date2, setDate2] = useToolDraft("date-calculator", "date2", "");
  const [days, setDays] = useToolDraft("date-calculator", "days", "0");
  const result = useMemo(() => {
    if (!date1) return "";
    const d1 = new Date(date1);
    if (isNaN(d1.getTime())) return "日期格式错误";
    if (date2) {
      const d2 = new Date(date2);
      if (isNaN(d2.getTime())) return "结束日期格式错误";
      const diff = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
      return `开始日期：${d1.toLocaleDateString(__localeTag())}\n结束日期：${d2.toLocaleDateString(__localeTag())}\n相差天数：${Math.abs(diff)} 天\n相差周数：${(Math.abs(diff) / 7).toFixed(1)} 周`;
    }
    const d = Number(days) || 0;
    const target = new Date(d1.getTime() + d * 24 * 60 * 60 * 1000);
    return `基准日期：${d1.toLocaleDateString(__localeTag())}\n加减天数：${d} 天\n结果日期：${target.toLocaleDateString(__localeTag())}\n星期：${["日","一","二","三","四","五","六"][target.getDay()]}`;
  }, [date1, date2, days, __locale]);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div><Label>{__ui("开始日期")}</Label><Input type="date" value={date1} onChange={(e) => setDate1(e.target.value)} /></div>
        <div><Label>{__ui("结束日期（留空则计算加减）")}</Label><Input type="date" value={date2} onChange={(e) => setDate2(e.target.value)} /></div>
      </div>
      <div><Label>{__ui("加减天数")}</Label><Input value={days} onChange={(e) => setDays(e.target.value)} /></div>
      {result && <ResultBox title={__ui("计算结果")} value={result} mono={false} />}
    </div>
  );
}

// 数字求和
export function NumberSumTool() {
  const __locale = __useLanguage();
  const [numbers, setNumbers] = useToolDraft("number-sum", "numbers", "");
  const result = useMemo(() => {
    if (!numbers.trim()) return "";
    const nums = numbers.split(/[\n,，\s]+/).map(n => parseFloat(n)).filter(n => !isNaN(n));
    if (nums.length === 0) return "未找到有效数字";
    const sum = nums.reduce((a, b) => a + b, 0);
    // 不能使用 Math.max(...nums)/Math.min(...nums)：长列表会因参数过多抛 RangeError 导致白屏
    const max = nums.reduce((a, b) => (b > a ? b : a), -Infinity);
    const min = nums.reduce((a, b) => (b < a ? b : a), Infinity);
    return `数字个数：${nums.length}\n总和：${sum}\n平均数：${(sum / nums.length).toFixed(4)}\n最大值：${max}\n最小值：${min}`;
  }, [numbers, __locale]);
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label>{__ui("数字序列（每行一个或逗号/空格分隔）")}</Label>
          {numbers && <button type="button" onClick={() => setNumbers("")} className="text-[11px] text-muted-foreground hover:text-destructive">{__ui("清空")}</button>}
        </div>
        <Textarea
          value={numbers}
          onChange={(e) => setNumbers(e.target.value)}
          rows={10}
          className="min-h-[220px] text-sm font-mono leading-relaxed resize-y"
          placeholder="1&#10;2&#10;3&#10;4&#10;5"
        />
      </div>
      {result && <ResultBox title={__ui("统计结果")} value={result} />}
    </div>
  );
}

// 文本替换
export function TextReplaceTool() {
  const __locale = __useLanguage();
  const [text, setText] = useToolDraft("text-replace", "text", "");
  const [find, setFind] = useToolDraft("text-replace", "find", "");
  const [replace, setReplace] = useToolDraft("text-replace", "replace", "");
  const result = useMemo(() => {
    if (!text || !find) return "";
    try {
      const count = (text.match(new RegExp(find.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "g")) || []).length;
      const result = text.split(find).join(replace);
      return `替换次数：${count}\n\n--- 替换结果 ---\n${result}`;
    } catch { return "查找内容格式错误"; }
  }, [text, find, replace, __locale]);
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label>{__ui("原文本")}</Label>
          {text && <button type="button" onClick={() => setText("")} className="text-[11px] text-muted-foreground hover:text-destructive">{__ui("清空")}</button>}
        </div>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          className="min-h-[220px] text-sm leading-relaxed resize-y"
          placeholder={__ui("输入原文本...")}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div><Label>{__ui("查找内容")}</Label><Input value={find} onChange={(e) => setFind(e.target.value)} /></div>
        <div><Label>{__ui("替换为")}</Label><Input value={replace} onChange={(e) => setReplace(e.target.value)} /></div>
      </div>
      {result && <ResultBox title={__ui("替换结果")} value={result} />}
    </div>
  );
}

// 全角半角转换
export function FullwidthHalfwidthTool() {
  const __locale = __useLanguage();
  const [text, setText] = useToolDraft("fullwidth-halfwidth", "text", "");
  const [mode, setMode] = useToolDraft("fullwidth-halfwidth", "mode", "toHalf");
  const result = useMemo(() => {
    if (!text) return "";
    if (mode === "toHalf") {
      return text.split("").map(c => {
        const code = c.charCodeAt(0);
        if (code === 0x3000) return " ";
        if (code >= 0xFF01 && code <= 0xFF5E) return String.fromCharCode(code - 0xFEE0);
        return c;
      }).join("");
    } else {
      return text.split("").map(c => {
        const code = c.charCodeAt(0);
        if (c === " ") return String.fromCharCode(0x3000);
        if (code >= 0x21 && code <= 0x7E) return String.fromCharCode(code + 0xFEE0);
        return c;
      }).join("");
    }
  }, [text, mode, __locale]);
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label>{__ui("文本内容")}</Label>
          {text && <button type="button" onClick={() => setText("")} className="text-[11px] text-muted-foreground hover:text-destructive">{__ui("清空")}</button>}
        </div>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={10}
          className="min-h-[220px] text-sm leading-relaxed resize-y"
          placeholder={__ui("输入要转换的文本...")}
        />
      </div>
      <div><Label>{__ui("转换方向")}</Label><Select value={mode} onChange={(e) => setMode(e.target.value)}><option value="toHalf">{__ui("全角→半角")}</option><option value="toFull">{__ui("半角→全角")}</option></Select></div>
      {result && <ResultBox title={__ui("转换结果")} value={result} />}
    </div>
  );
}

// AES加密解密
export function AesEncryptTool() {
  const __locale = __useLanguage();
  const [text, setText] = useState("");
  const [key, setKey] = useState("");
  const [mode, setMode] = useToolDraft("aes-encrypt", "mode", "encrypt");
  // 结果是点「执行」异步算出来的，不随输入自动重算，所以结果本身也要记住
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const operation = useRef(0);
  useEffect(() => { operation.current++; setResult(""); setError(""); setNotice(""); }, [text, key, mode]);
  useEffect(() => () => { operation.current++; }, []);
  const process = async () => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(""); setResult(""); setNotice("");
    const request = ++operation.current;
    try {
      if (mode === "encrypt") {
        const value = await encryptLocalText(text, key);
        if (request !== operation.current) return;
        setResult(value);
        setNotice("FKG1：AES-256-GCM认证加密；请妥善保存口令。 / Authenticated encryption; keep your passphrase safe.");
      } else if (mode === "decrypt") {
        const value = await decryptLocalText(text, key);
        if (request !== operation.current) return;
        setResult(value.text);
        setNotice(value.legacy ? "兼容解密：旧CBC没有认证，不能证明内容未被篡改。 / Legacy CBC is unauthenticated; integrity cannot be verified." : "FKG1认证校验通过 / FKG1 authentication verified");
      } else throw new Error("不支持的模式 / Unsupported mode");
    } catch (error) { if (request === operation.current) setError("处理失败 / Failed: " + (error instanceof Error ? error.message : String(error))); }
    finally { busyRef.current = false; setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label>{__ui("输入内容")}</Label>
          {text && <button type="button" onClick={() => setText("")} className="text-[11px] text-muted-foreground hover:text-destructive">{__ui("清空")}</button>}
        </div>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          className="min-h-[180px] text-sm font-mono leading-relaxed resize-y"
          placeholder={mode === "encrypt" ? __ui("输入要加密的文本") : __ui("输入Base64密文")}
        />
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div><Label>{__ui("口令（新加密至少12字符） / Passphrase (12+ characters)")}</Label><Input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} /></div>
        <div><Label>{__ui("模式")}</Label><Select value={mode} onChange={(e) => setMode(e.target.value)}><option value="encrypt">{__ui("加密")}</option><option value="decrypt">{__ui("解密")}</option></Select></div>
      </div>
      <Button onClick={process} disabled={busy}>{busy ? __ui("处理中 / Processing") : __ui("执行")}</Button>
      <p className="text-xs text-muted-foreground">{__ui("新密文使用FKG1格式，最多1 MiB；仍可解密旧Base64密文。本页明文、口令和结果不写入草稿，离开前请自行保存。 / New FKG1 format, 1 MiB text limit; legacy Base64 can still be decrypted. Input, passphrase and results are not saved as drafts.")}</p>
      {notice && <p className="text-xs text-muted-foreground">{__ui(notice)}</p>}
      {error && <div className="text-sm" style={{ color: "hsl(var(--destructive))" }}>{__msg(error)}</div>}
      {result && <ResultBox title={mode === "encrypt" ? __ui("密文（FKG1）") : __ui("明文")} value={result} />}
    </div>
  );
}

// 罗马数字转换器（支持古典 1~3999 及 Vinculum 千倍上划线扩展至 3,999,999，双向解析与推导）
function toRomanClassical(num: number): string {
  if (num <= 0) return "";
  const roman = ["M","CM","D","CD","C","XC","L","XL","X","IX","V","IV","I"];
  const values = [1000,900,500,400,100,90,50,40,10,9,5,4,1];
  let res = "", n = num;
  for (let i = 0; i < roman.length; i++) {
    while (n >= values[i]) {
      res += roman[i];
      n -= values[i];
    }
  }
  return res;
}

function addOverline(str: string): string {
  return str.split("").map(c => c + "\u0305").join("");
}

function parseClassicalRoman(romanStr: string): number {
  const map: Record<string, number> = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 };
  let total = 0;
  let prev = 0;
  for (let i = romanStr.length - 1; i >= 0; i--) {
    const ch = romanStr[i];
    const cur = map[ch];
    if (!cur) return -1;
    if (cur < prev) {
      total -= cur;
    } else {
      total += cur;
    }
    prev = cur;
  }
  return total;
}

function parseRomanToNumber(input: string): number | null {
  const str = input.trim().normalize("NFKD").toUpperCase();
  
  // 括号记法：如 (IV)CDLII 或 (XII)D
  const parenMatch = str.match(/^\(([IVXLCDM]+)\)(.*)$/);
  if (parenMatch) {
    const highVal = parseClassicalRoman(parenMatch[1]);
    const lowVal = parenMatch[2] ? parseClassicalRoman(parenMatch[2]) : 0;
    if (highVal > 0 && lowVal >= 0) return highVal * 1000 + lowVal;
  }

  // Unicode 结合上标线上划线：如 I̅V̅CDLII
  if (str.includes("\u0305")) {
    const highChars: string[] = [];
    const lowChars: string[] = [];
    const chars = Array.from(str);
    for (let i = 0; i < chars.length; i++) {
      if (chars[i] === "\u0305") continue;
      if (i + 1 < chars.length && chars[i + 1] === "\u0305") {
        highChars.push(chars[i]);
      } else {
        lowChars.push(chars[i]);
      }
    }
    const highVal = highChars.length > 0 ? parseClassicalRoman(highChars.join("")) : 0;
    const lowVal = lowChars.length > 0 ? parseClassicalRoman(lowChars.join("")) : 0;
    if (highVal > 0 && lowVal >= 0) return highVal * 1000 + lowVal;
  }

  // 标准或宽松（如 MMMMCDLII）
  if (/^[IVXLCDM]+$/.test(str)) {
    const val = parseClassicalRoman(str);
    return val > 0 ? val : null;
  }

  return null;
}

interface RomanBreakdown {
  label: string;
  val: number;
  roman: string;
  explanation: string;
}

function getRomanBreakdown(num: number): RomanBreakdown[] {
  const parts: RomanBreakdown[] = [];
  const hundreds = Math.floor((num % 1000) / 100);
  const tens = Math.floor((num % 100) / 10);
  const ones = num % 10;

  if (num >= 4000) {
    const totalThousands = Math.floor(num / 1000);
    const thRoman = toRomanClassical(totalThousands);
    parts.push({
      label: `千位及以上 (${totalThousands * 1000})`,
      val: totalThousands * 1000,
      roman: `${addOverline(thRoman)} 或 (${thRoman})`,
      explanation: `将 ${totalThousands} 的罗马数 [${thRoman}] 加上划线，乘以 1,000`
    });
  } else if (Math.floor(num / 1000) > 0) {
    const val = Math.floor(num / 1000) * 1000;
    parts.push({
      label: `千位 (${val})`,
      val,
      roman: toRomanClassical(val),
      explanation: `${val / 1000} 个 M (1000)`
    });
  }

  if (hundreds > 0) {
    const val = hundreds * 100;
    parts.push({
      label: `百位 (${val})`,
      val,
      roman: toRomanClassical(val),
      explanation: val === 900 ? "CM (1000 - 100)" : val === 400 ? "CD (500 - 100)" : val >= 500 ? `D (500) + ${hundreds - 5} 个 C (100)` : `${hundreds} 个 C (100)`
    });
  }

  if (tens > 0) {
    const val = tens * 10;
    parts.push({
      label: `十位 (${val})`,
      val,
      roman: toRomanClassical(val),
      explanation: val === 90 ? "XC (100 - 10)" : val === 40 ? "XL (50 - 10)" : val >= 50 ? `L (50) + ${tens - 5} 个 X (10)` : `${tens} 个 X (10)`
    });
  }

  if (ones > 0) {
    parts.push({
      label: `个位 (${ones})`,
      val: ones,
      roman: toRomanClassical(ones),
      explanation: ones === 9 ? "IX (10 - 1)" : ones === 4 ? "IV (5 - 1)" : ones >= 5 ? `V (5) + ${ones - 5} 个 I (1)` : `${ones} 个 I (1)`
    });
  }

  return parts;
}

type RomanParseResult =
  | { success: false; error: string }
  | {
      success: true;
      arabic: number;
      isClassical: boolean;
      standard: string;
      vinculumText: string;
      parenText: string;
      relaxedText: string;
      thRoman: string;
      remRoman: string;
      breakdown: RomanBreakdown[];
    };

export function RomanNumeralTool() {
  const __locale = __useLanguage();
  const [value, setValue] = useToolDraft("roman-numeral", "value", "4452");
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const { toast } = useToast();

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    toast({ title: `已复制：${text}` });
    setTimeout(() => setCopiedKey(null), 1500);
  };

  const parsedData = useMemo<RomanParseResult | null>(() => {
    const trimmed = value.trim();
    if (!trimmed) return null;

    // 1. 阿拉伯数字输入
    if (/^-?\d+$/.test(trimmed)) {
      const num = parseInt(trimmed, 10);
      if (num <= 0) {
        return { success: false, error: "罗马数字体系中没有 0 和负数的概念，请输入大于 0 的正整数。" };
      }
      if (num > 3999999) {
        return { success: false, error: "输入的数字超过 3,999,999，已超出常规罗马数字表达上限。" };
      }

      if (num <= 3999) {
        const standard = toRomanClassical(num);
        return {
          success: true,
          arabic: num,
          isClassical: true,
          standard,
          vinculumText: standard,
          parenText: standard,
          relaxedText: standard,
          thRoman: "",
          remRoman: standard,
          breakdown: getRomanBreakdown(num)
        };
      } else {
        const thousands = Math.floor(num / 1000);
        const remainder = num % 1000;
        const thRoman = toRomanClassical(thousands);
        const remRoman = remainder > 0 ? toRomanClassical(remainder) : "";
        const vinculumText = addOverline(thRoman) + remRoman;
        const parenText = `(${thRoman})${remRoman}`;
        const relaxedText = num < 10000 ? "M".repeat(thousands) + remRoman : "";

        return {
          success: true,
          arabic: num,
          isClassical: false,
          standard: vinculumText,
          vinculumText,
          parenText,
          relaxedText,
          thRoman,
          remRoman,
          breakdown: getRomanBreakdown(num)
        };
      }
    }

    // 2. 罗马数字输入
    const num = parseRomanToNumber(trimmed);
    if (num !== null) {
      if (num <= 3999) {
        const standard = toRomanClassical(num);
        return {
          success: true,
          arabic: num,
          isClassical: true,
          standard,
          vinculumText: standard,
          parenText: standard,
          relaxedText: standard,
          thRoman: "",
          remRoman: standard,
          breakdown: getRomanBreakdown(num)
        };
      } else {
        const thousands = Math.floor(num / 1000);
        const remainder = num % 1000;
        const thRoman = toRomanClassical(thousands);
        const remRoman = remainder > 0 ? toRomanClassical(remainder) : "";
        const vinculumText = addOverline(thRoman) + remRoman;
        const parenText = `(${thRoman})${remRoman}`;
        const relaxedText = num < 10000 ? "M".repeat(thousands) + remRoman : "";

        return {
          success: true,
          arabic: num,
          isClassical: false,
          standard: vinculumText,
          vinculumText,
          parenText,
          relaxedText,
          thRoman,
          remRoman,
          breakdown: getRomanBreakdown(num)
        };
      }
    }

    return { success: false, error: "请输入合法的阿拉伯数字（1 ~ 3,999,999）或有效的罗马数字（如 MMXXIV、4452、(IV)CDLII）" };
  }, [value, __locale]);

  const presets = [
    { label: "4452 (大数范例)", val: "4452" },
    { label: "2026 (当前年份)", val: "2026" },
    { label: "3999 (古典上限)", val: "3999" },
    { label: "4000 (上划线起步)", val: "4000" },
    { label: "12500 (多位大数)", val: "12500" },
    { label: "MMXXIV (罗马输入)", val: "MMXXIV" },
    { label: "(IV)CDLII (括号法)", val: "(IV)CDLII" }
  ];

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="font-semibold text-sm">{__ui("输入数字或罗马数字")}</Label>
          <span className="text-xs text-muted-foreground">{__ui("已支持 1 ~ 3,999,999 大数双向转换")}</span>
        </div>
        <Input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={__ui("例如：4452、2026、MMXXIV、(IV)CDLII")}
          className="text-base font-mono h-11"
        />
        {/* 快捷填入 */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1">
          <span className="text-xs text-muted-foreground mr-1 flex items-center gap-1">
            <Sparkles size={12} className="text-primary" /> {__ui("快速填入：")}</span>
          {presets.map((p) => (
            <button
              key={p.val}
              type="button"
              onClick={() => setValue(p.val)}
              className="text-xs px-2.5 py-1 rounded-md border border-border/60 bg-muted/30 hover:bg-primary/10 hover:border-primary/40 hover:text-primary transition-all font-mono"
            >
              {__ui(p.label)}
            </button>
          ))}
        </div>
      </div>

      {/* 结果展示区 */}
      {parsedData && (
        <div className="space-y-4">
          {!parsedData.success ? (
            <div className="p-4 rounded-xl border border-destructive/30 bg-destructive/10 text-destructive text-sm flex items-start gap-2">
              <Info size={18} className="shrink-0 mt-0.5" />
              <span>{__msg(parsedData.error)}</span>
            </div>
          ) : (
            <div className="space-y-4">
              {/* 主转换结果卡片 */}
              <div
                className="rounded-xl border p-5 space-y-4 shadow-sm"
                style={{ borderColor: "hsl(var(--border))", backgroundColor: "hsl(var(--card))" }}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-primary/15 text-primary">
                      {parsedData.isClassical ? __ui("古典标准罗马数字 (1-3999)") : __ui("Vinculum 上划线乘千规范 (大数扩展)")}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {__ui("阿拉伯数字：")}<strong className="font-mono text-foreground">{parsedData.arabic.toLocaleString()}</strong>
                    </span>
                  </div>
                </div>

                {/* 核心字形视觉展示 */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 rounded-lg bg-muted/25 border border-border/40">
                  <div>
                    <div className="text-xs text-muted-foreground mb-1 font-medium">
                      {parsedData.isClassical ? __ui("标准罗马数字：") : __ui("标准上划线记法（千位横线乘 1000）：")}
                    </div>
                    {parsedData.thRoman ? (
                      <div className="flex items-baseline gap-1 font-mono font-bold text-2xl sm:text-3xl text-primary tracking-wide select-all">
                        <span className="border-t-2 border-primary pt-0.5 inline-block leading-tight">
                          {parsedData.thRoman}
                        </span>
                        <span>{parsedData.remRoman}</span>
                      </div>
                    ) : (
                      <div className="font-mono font-bold text-2xl sm:text-3xl text-primary tracking-wide select-all">
                        {parsedData.standard}
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      onClick={() => handleCopy(parsedData.vinculumText, "vinculum")}
                      className="px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-card hover:bg-muted transition-colors flex items-center gap-1.5 shadow-sm"
                    >
                      {copiedKey === "vinculum" ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
                      {__ui("复制上划线字符")}</button>
                    {parsedData.parenText !== parsedData.standard && (
                      <button
                        onClick={() => handleCopy(parsedData.parenText, "paren")}
                        className="px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-card hover:bg-muted transition-colors flex items-center gap-1.5 shadow-sm"
                      >
                        {copiedKey === "paren" ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
                        {__ui("复制纯文本 (")}{parsedData.parenText})
                      </button>
                    )}
                    {parsedData.relaxedText && parsedData.relaxedText !== parsedData.standard && (
                      <button
                        onClick={() => handleCopy(parsedData.relaxedText, "relaxed")}
                        className="px-3 py-1.5 text-xs font-medium rounded-md border border-border bg-card hover:bg-muted transition-colors flex items-center gap-1.5 shadow-sm"
                      >
                        {copiedKey === "relaxed" ? <Check size={13} className="text-green-500" /> : <Copy size={13} />}
                        {__ui("复制连续 M 记法 (")}{parsedData.relaxedText})
                      </button>
                    )}
                  </div>
                </div>

                {/* 格式对比行（大数模式下展示多种表示方式） */}
                {!parsedData.isClassical && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 text-xs">
                    <div className="p-3 rounded-lg border border-border/50 bg-background/50">
                      <div className="text-muted-foreground font-medium mb-1">{__ui("Vinculum 上划线（学术标准）")}</div>
                      <div className="font-mono text-sm font-semibold text-foreground flex items-baseline gap-0.5">
                        <span className="border-t-2 border-foreground leading-none">{parsedData.thRoman}</span>
                        <span>{parsedData.remRoman}</span>
                      </div>
                    </div>
                    <div className="p-3 rounded-lg border border-border/50 bg-background/50">
                      <div className="text-muted-foreground font-medium mb-1">{__ui("括号记法（纯文本无障碍输入）")}</div>
                      <div className="font-mono text-sm font-semibold text-foreground">{parsedData.parenText}</div>
                    </div>
                    <div className="p-3 rounded-lg border border-border/50 bg-background/50">
                      <div className="text-muted-foreground font-medium mb-1">{__ui("宽松多 M 记法（部分现代系统）")}</div>
                      <div className="font-mono text-sm font-semibold text-foreground">
                        {parsedData.relaxedText || __ui("不适用（超过 9,999）")}
                      </div>
                    </div>
                  </div>
                )}

                {/* 逐位拆解与推导 */}
                {parsedData.breakdown && parsedData.breakdown.length > 0 && (
                  <div className="space-y-2 pt-2">
                    <div className="text-xs font-semibold text-muted-foreground flex items-center gap-1">
                      <span>{__ui("数位拆解与推导过程")}</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {parsedData.breakdown.map((item, idx) => (
                        <div key={idx} className="p-2.5 rounded-lg border border-border/40 bg-muted/20 text-xs space-y-1">
                          <div className="flex items-center justify-between font-mono font-semibold">
                            <span className="text-foreground">{__ui(item.label)}</span>
                            <span className="text-primary font-bold">{item.roman}</span>
                          </div>
                          <p className="text-muted-foreground leading-relaxed">{item.explanation}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 罗马数字规则与科普卡片 */}
      <div className="rounded-xl border border-border/70 bg-card/60 p-4 sm:p-5 space-y-4">
        <div className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <BookOpen size={16} className="text-primary" />
          <span>{__ui("知识科普：为什么古典罗马数字通常只支持 1-3999？")}</span>
        </div>

        <div className="text-xs text-muted-foreground space-y-3 leading-relaxed">
          <div className="p-3 rounded-lg bg-muted/40 border border-border/40 space-y-1.5">
            <div className="font-semibold text-foreground">{__ui("1. 古典规则约束：无 5000 独立单字母，且单个符号最多连写 3 次")}</div>
            <p>
              {__ui("古典罗马数字的基础单字符号只有 7 个：")}<code className="px-1 py-0.5 bg-muted rounded font-mono">I (1)</code>、
              <code className="px-1 py-0.5 bg-muted rounded font-mono">V (5)</code>、
              <code className="px-1 py-0.5 bg-muted rounded font-mono">X (10)</code>、
              <code className="px-1 py-0.5 bg-muted rounded font-mono">L (50)</code>、
              <code className="px-1 py-0.5 bg-muted rounded font-mono">C (100)</code>、
              <code className="px-1 py-0.5 bg-muted rounded font-mono">D (500)</code>、
              <code className="px-1 py-0.5 bg-muted rounded font-mono">M (1000)</code>。
            </p>
            <p>
              {__ui("在标准减法法则中，任何基础符号")}<strong>{__ui("最多只能连续出现 3 次")}</strong>{__ui("（如 3 为 III，但 4 必须写成 IV 而不能是 IIII；3000 为 MMM，但 4000")}<strong>{__ui("不能写成 MMMM")}</strong>{__ui("）。 因为缺少一个代表 5000 的独立单字母（无法用类似 5000-1000 的形式表达 4000），所以在纯单字母体系中，最大合法数字就是：")}<br />
              <strong className="text-foreground font-mono">3999 = MMM (3000) + CM (900) + XC (90) + IX (9) = MMMCMXCIX</strong>。
            </p>
          </div>

          <div className="p-3 rounded-lg bg-muted/40 border border-border/40 space-y-1.5">
            <div className="font-semibold text-foreground">{__ui("2. 历史上与现代如何表达 4000 及以上的大数？（Vinculum 上划线法）")}</div>
            <p>
              {__ui("古罗马人在处理超过 3999 的数字时，引入了")}<strong>{__ui("Vinculum（千倍横线）记法")}</strong>{__ui("：在罗马数字上方画一条横线（如")}<span className="border-t border-foreground font-mono font-bold px-0.5">V</span>{__ui("），代表将该数值")}<strong>{__ui("乘以 1,000 倍")}</strong>。
            </p>
            <p>
              {__ui("例如：您刚才输入的")}<strong className="text-foreground font-mono">4452</strong>{__ui("，4000 写作")}<span className="border-t border-foreground font-mono font-bold px-0.5">IV</span>{__ui("（(5-1) × 1000 = 4000），加上 452（CDLII），完整写作")}<span className="border-t border-foreground font-mono font-bold px-0.5">IV</span><span className="font-mono font-bold">CDLII</span>{__ui("。在计算机纯文本中通常也可以用括号形式写作")}<strong className="text-foreground font-mono">(IV)CDLII</strong> {__ui("或宽松形式")}<strong className="text-foreground font-mono">MMMMCDLII</strong>。
            </p>
          </div>
        </div>

        {/* 符号对照表速查 */}
        <div className="space-y-2">
          <div className="text-xs font-semibold text-foreground">{__ui("罗马数字基础与扩展符号对照表")}</div>
          <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-7 gap-1.5 text-center text-xs font-mono">
            <div className="p-2 rounded border border-border/50 bg-background/50">
              <div className="text-primary font-bold text-sm">I</div>
              <div className="text-muted-foreground text-[11px]">1</div>
            </div>
            <div className="p-2 rounded border border-border/50 bg-background/50">
              <div className="text-primary font-bold text-sm">V</div>
              <div className="text-muted-foreground text-[11px]">5</div>
            </div>
            <div className="p-2 rounded border border-border/50 bg-background/50">
              <div className="text-primary font-bold text-sm">X</div>
              <div className="text-muted-foreground text-[11px]">10</div>
            </div>
            <div className="p-2 rounded border border-border/50 bg-background/50">
              <div className="text-primary font-bold text-sm">L</div>
              <div className="text-muted-foreground text-[11px]">50</div>
            </div>
            <div className="p-2 rounded border border-border/50 bg-background/50">
              <div className="text-primary font-bold text-sm">C</div>
              <div className="text-muted-foreground text-[11px]">100</div>
            </div>
            <div className="p-2 rounded border border-border/50 bg-background/50">
              <div className="text-primary font-bold text-sm">D</div>
              <div className="text-muted-foreground text-[11px]">500</div>
            </div>
            <div className="p-2 rounded border border-border/50 bg-background/50">
              <div className="text-primary font-bold text-sm">M</div>
              <div className="text-muted-foreground text-[11px]">1,000</div>
            </div>
            <div className="p-2 rounded border border-border/50 bg-background/50">
              <div className="text-primary font-bold text-sm border-t border-primary inline-block">V</div>
              <div className="text-muted-foreground text-[11px]">5,000</div>
            </div>
            <div className="p-2 rounded border border-border/50 bg-background/50">
              <div className="text-primary font-bold text-sm border-t border-primary inline-block">X</div>
              <div className="text-muted-foreground text-[11px]">10,000</div>
            </div>
            <div className="p-2 rounded border border-border/50 bg-background/50">
              <div className="text-primary font-bold text-sm border-t border-primary inline-block">L</div>
              <div className="text-muted-foreground text-[11px]">50,000</div>
            </div>
            <div className="p-2 rounded border border-border/50 bg-background/50">
              <div className="text-primary font-bold text-sm border-t border-primary inline-block">C</div>
              <div className="text-muted-foreground text-[11px]">100,000</div>
            </div>
            <div className="p-2 rounded border border-border/50 bg-background/50">
              <div className="text-primary font-bold text-sm border-t border-primary inline-block">D</div>
              <div className="text-muted-foreground text-[11px]">500,000</div>
            </div>
            <div className="p-2 rounded border border-border/50 bg-background/50 col-span-2 sm:col-span-2 md:col-span-2">
              <div className="text-primary font-bold text-sm border-t border-primary inline-block">M</div>
              <div className="text-muted-foreground text-[11px]">1,000,000</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Crontab生成器
export function CrontabGeneratorTool() {
  const __locale = __useLanguage();
  const [minute, setMinute] = useToolDraft("crontab-generator", "minute", "*");
  const [hour, setHour] = useToolDraft("crontab-generator", "hour", "*");
  const [day, setDay] = useToolDraft("crontab-generator", "day", "*");
  const [month, setMonth] = useToolDraft("crontab-generator", "month", "*");
  const [weekday, setWeekday] = useToolDraft("crontab-generator", "weekday", "*");
  const result = useMemo(() => {
    const expr = `${minute} ${hour} ${day} ${month} ${weekday}`;
    const labels = ["分钟", "小时", "日", "月", "星期"];
    const vals = [minute, hour, day, month, weekday];
    let desc = vals.every(v => v === "*") ? "每分钟执行" : "";
    if (!desc) {
      const parts = vals.map((v, i) => v !== "*" ? `${labels[i]}=${v}` : null).filter(Boolean);
      desc = `每${parts.join("，")}执行`;
    }
    return `Crontab 表达式：\n${expr}\n\n说明：\n${desc}\n\n字段说明：\n分钟 (0-59)：${minute}\n小时 (0-23)：${hour}\n日 (1-31)：${day}\n月 (1-12)：${month}\n星期 (0-6，0=周日)：${weekday}`;
  }, [minute, hour, day, month, weekday, __locale]);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-5 gap-2">
        {[["分钟", minute, setMinute], ["小时", hour, setHour], ["日", day, setDay], ["月", month, setMonth], ["星期", weekday, setWeekday]].map((item) => {
          const label = item[0] as string;
          const val = item[1] as string;
          const setter = item[2] as Dispatch<SetStateAction<string>>;
          return (
          <div key={label}><Label>{__ui(label)}</Label><Input value={val} onChange={(e) => setter(e.target.value)} /></div>
          );
        })}
      </div>
      {result && <ResultBox title={__ui("Crontab 表达式")} value={result} />}
    </div>
  );
}

// ========== 第三批工具 ==========

// 个人所得税计算器
export function IncomeTaxCalculatorTool() {
  const __locale = __useLanguage();
  const [salary, setSalary] = useToolDraft("income-tax-calculator", "salary", "10000");
  const [social, setSocial] = useToolDraft("income-tax-calculator", "social", "0");
  const [special, setSpecial] = useToolDraft("income-tax-calculator", "special", "0");
  const result = useMemo(() => {
    const s = Number(salary) || 0;
    const so = Number(social) || 0;
    const sp = Number(special) || 0;
    const taxable = Math.max(0, s - so - sp - 5000);
    const brackets = [
      { max: 3000, rate: 0.03, deduct: 0 },
      { max: 12000, rate: 0.10, deduct: 210 },
      { max: 25000, rate: 0.20, deduct: 1410 },
      { max: 35000, rate: 0.25, deduct: 2660 },
      { max: 55000, rate: 0.30, deduct: 4410 },
      { max: 80000, rate: 0.35, deduct: 7160 },
      { max: Infinity, rate: 0.45, deduct: 15160 },
    ];
    let tax = 0;
    for (const b of brackets) {
      if (taxable <= b.max) { tax = taxable * b.rate - b.deduct; break; }
    }
    tax = Math.max(0, Math.round(tax * 100) / 100);
    const afterTax = s - so - tax;
    return `税前工资：${s.toFixed(2)} 元\n五险一金：${so.toFixed(2)} 元\n专项附加扣除：${sp.toFixed(2)} 元\n起征点：5000 元\n应纳税所得额：${taxable.toFixed(2)} 元\n应缴个税：${tax.toFixed(2)} 元\n税后工资：${afterTax.toFixed(2)} 元`;
  }, [salary, social, special, __locale]);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <div><Label>{__ui("税前工资（元）")}</Label><Input value={salary} onChange={(e) => setSalary(e.target.value)} /></div>
        <div><Label>{__ui("五险一金（元）")}</Label><Input value={social} onChange={(e) => setSocial(e.target.value)} /></div>
        <div><Label>{__ui("专项附加扣除（元）")}</Label><Input value={special} onChange={(e) => setSpecial(e.target.value)} /></div>
      </div>
      {result && <ResultBox title={__ui("计算结果")} value={result} mono={false} />}
    </div>
  );
}

// 税金税率计算器
export function TaxCalculatorTool() {
  const __locale = __useLanguage();
  // 注意：组件注册表里的 "tax-calculator" 指向 components/tools/tax-calculator-tool.tsx
  // （那个组件自带模块级参数缓存），这里用独立的 legacy 前缀，避免两边串台。
  const [amount, setAmount] = useToolDraft("tax-calculator-legacy", "amount", "10000");
  const [rate, setRate] = useToolDraft("tax-calculator-legacy", "rate", "13");
  const [type, setType] = useToolDraft("tax-calculator-legacy", "type", "withTax");
  const result = useMemo(() => {
    const a = Number(amount) || 0;
    const r = Number(rate) / 100;
    if (type === "withTax") {
      const without = a / (1 + r);
      const tax = a - without;
      return `含税金额：${a.toFixed(2)} 元\n税率：${rate}%\n不含税金额：${without.toFixed(2)} 元\n税额：${tax.toFixed(2)} 元`;
    } else {
      const tax = a * r;
      const withTax = a + tax;
      return `不含税金额：${a.toFixed(2)} 元\n税率：${rate}%\n税额：${tax.toFixed(2)} 元\n含税金额：${withTax.toFixed(2)} 元`;
    }
  }, [amount, rate, type, __locale]);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <div><Label>{__ui("金额")}</Label><Input value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div><Label>{__ui("税率（%）")}</Label><Input value={rate} onChange={(e) => setRate(e.target.value)} /></div>
        <div><Label>{__ui("金额类型")}</Label><Select value={type} onChange={(e) => setType(e.target.value)}><option value="withTax">{__ui("含税金额")}</option><option value="withoutTax">{__ui("不含税金额")}</option></Select></div>
      </div>
      {result && <ResultBox title={__ui("计算结果")} value={result} mono={false} />}
    </div>
  );
}

// 信用卡分期计算器
export function CreditCardCalculatorTool() {
  const __locale = __useLanguage();
  const [amount, setAmount] = useToolDraft("credit-card-calculator", "amount", "10000");
  const [periods, setPeriods] = useToolDraft("credit-card-calculator", "periods", "12");
  const [feeRate, setFeeRate] = useToolDraft("credit-card-calculator", "feeRate", "7.2");
  const result = useMemo(() => { try { return creditSummary(amount, periods, feeRate); } catch (error) { return "错误 / Error: " + (error instanceof Error ? error.message : String(error)); } }, [amount, periods, feeRate, __locale]);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <div><Label>{__ui("分期金额（元）")}</Label><Input value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div><Label>{__ui("分期期数")}</Label><Input value={periods} onChange={(e) => setPeriods(e.target.value)} /></div>
        <div><Label>{__ui("手续费率（%）")}</Label><Input value={feeRate} onChange={(e) => setFeeRate(e.target.value)} /></div>
      </div>
      {result && <ResultBox title={__ui("计算结果")} value={result} mono={false} />}
    </div>
  );
}

// 英文金额大写
function numberToWords(num: number): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  if (num === 0) return "Zero";
  let result = "";
  if (Math.floor(num / 1000000000) > 0) { result += numberToWords(Math.floor(num / 1000000000)) + " Billion "; num %= 1000000000; }
  if (Math.floor(num / 1000000) > 0) { result += numberToWords(Math.floor(num / 1000000)) + " Million "; num %= 1000000; }
  if (Math.floor(num / 1000) > 0) { result += numberToWords(Math.floor(num / 1000)) + " Thousand "; num %= 1000; }
  if (Math.floor(num / 100) > 0) { result += ones[Math.floor(num / 100)] + " Hundred "; num %= 100; }
  if (num > 0) {
    if (num < 20) result += ones[num];
    else { result += tens[Math.floor(num / 10)]; if (num % 10 > 0) result += "-" + ones[num % 10]; }
  }
  return result.trim();
}
export function EnglishAmountUppercaseTool() {
  const __locale = __useLanguage();
  const [amount, setAmount] = useToolDraft("english-amount-uppercase", "amount", "1234.56");
  const result = useMemo(() => {
    const num = Number(amount);
    if (isNaN(num)) return "";
    const intPart = Math.floor(Math.abs(num));
    const decPart = Math.round((Math.abs(num) - intPart) * 100);
    let result = numberToWords(intPart) + " Dollars";
    if (decPart > 0) result += " and " + numberToWords(decPart) + " Cents";
    return (num < 0 ? "Negative " : "") + result.toUpperCase();
  }, [amount, __locale]);
  return (
    <div className="space-y-4">
      <div><Label>{__ui("金额")}</Label><Input value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
      {result && <ResultBox title={__ui("英文大写")} value={result} mono={false} />}
    </div>
  );
}

// 数字英文转换
export function NumberEnglishTool() {
  const __locale = __useLanguage();
  const [number, setNumber] = useToolDraft("number-english", "number", "1234");
  const result = useMemo(() => { try { return numberToWords(Math.abs(boundedInteger(number, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, "整数"))) + (Number(number) < 0 ? " (Negative)" : ""); } catch (error) { return "错误 / Error: " + (error instanceof Error ? error.message : String(error)); } }, [number, __locale]);
  return (
    <div className="space-y-4">
      <div><Label>{__ui("数字")}</Label><Input value={number} onChange={(e) => setNumber(e.target.value)} /></div>
      {result && <ResultBox title={__ui("英文")} value={result} mono={false} />}
    </div>
  );
}

// 汇率换算器
export function ExchangeRateTool() {
  const __locale = __useLanguage();
  const [amount, setAmount] = useToolDraft("exchange-rate", "amount", "100");
  const [from, setFrom] = useToolDraft("exchange-rate", "from", "CNY");
  const [to, setTo] = useToolDraft("exchange-rate", "to", "USD");
  const rates: Record<string, number> = { CNY: 1, USD: 7.25, EUR: 7.85, JPY: 0.048, GBP: 9.15, HKD: 0.93 };
  const result = useMemo(() => {
    const a = Number(amount) || 0;
    const cny = a * (rates[from] || 1);
    const target = cny / (rates[to] || 1);
    return `${a} ${from} = ${target.toFixed(4)} ${to}\n\n参考汇率（相对人民币）：\n${Object.entries(rates).map(([k, v]) => `${k}: 1${k} = ${v} CNY`).join("\n")}\n\n注：汇率为参考值，实际以银行为准`;
  }, [amount, from, to, __locale]);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-4">
        <div><Label>{__ui("金额")}</Label><Input value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div><Label>{__ui("原货币")}</Label><Select value={from} onChange={(e) => setFrom(e.target.value)}>{Object.keys(rates).map(k => <option key={k} value={k}>{k}</option>)}</Select></div>
        <div><Label>{__ui("目标货币")}</Label><Select value={to} onChange={(e) => setTo(e.target.value)}>{Object.keys(rates).map(k => <option key={k} value={k}>{k}</option>)}</Select></div>
      </div>
      {result && <ResultBox title={__ui("换算结果")} value={result} />}
    </div>
  );
}

// 农历数据表（1900-2100），每年一个16位整数：
// 高4位=闰月月份(0=无闰月)，中间12位=各月大小(1=大月30天,0=小月29天)，低4位=闰月大小
const LUNAR_INFO = [
  0x04bd8,0x04ae0,0x0a570,0x054d5,0x0d260,0x0d950,0x16554,0x056a0,0x09ad0,0x055d2,
  0x04ae0,0x0a5b6,0x0a4d0,0x0d250,0x1d255,0x0b540,0x0d6a0,0x0ada2,0x095b0,0x14977,
  0x04970,0x0a4b0,0x0b4b5,0x06a50,0x06d40,0x1ab54,0x02b60,0x09570,0x052f2,0x04970,
  0x06566,0x0d4a0,0x0ea50,0x06e95,0x05ad0,0x02b60,0x186e3,0x092e0,0x1c8d7,0x0c950,
  0x0d4a0,0x1d8a6,0x0b550,0x056a0,0x1a5b4,0x025d0,0x092d0,0x0d2b2,0x0a950,0x0b557,
  0x06ca0,0x0b550,0x15355,0x04da0,0x0a5b0,0x14573,0x052b0,0x0a9a8,0x0e950,0x06aa0,
  0x0aea6,0x0ab50,0x04b60,0x0aae4,0x0a570,0x05260,0x0f263,0x0d950,0x05b57,0x056a0,
  0x096d0,0x04dd5,0x04ad0,0x0a4d0,0x0d4d4,0x0d250,0x0d558,0x0b540,0x0b6a0,0x195a6,
  0x095b0,0x049b0,0x0a974,0x0a4b0,0x0b27a,0x06a50,0x06d40,0x0af46,0x0ab60,0x09570,
  0x04af5,0x04970,0x064b0,0x074a3,0x0ea50,0x06b58,0x055c0,0x0ab60,0x096d5,0x092e0,
  0x0c960,0x0d954,0x0d4a0,0x0da50,0x07552,0x056a0,0x0abb7,0x025d0,0x092d0,0x0cab5,
  0x0a950,0x0b4a0,0x0baa4,0x0ad50,0x055d9,0x04ba0,0x0a5b0,0x15176,0x052b0,0x0a930,
  0x07954,0x06aa0,0x0ad50,0x05b52,0x04b60,0x0a6e6,0x0a4e0,0x0d260,0x0ea65,0x0d530,
  0x05aa0,0x076a3,0x096d0,0x04afb,0x04ad0,0x0a4d0,0x1d0b6,0x0d250,0x0d520,0x0dd45,
  0x0b5a0,0x056d0,0x055b2,0x049b0,0x0a577,0x0a4b0,0x0aa50,0x1b255,0x06d20,0x0ada0,
  0x14b63,0x09370,0x049f8,0x04970,0x064b0,0x168a6,0x0ea50,0x06b20,0x1a6c4,0x0aae0,
  0x0a2e0,0x0d2e3,0x0c960,0x0d557,0x0d4a0,0x0da50,0x05d55,0x056a0,0x0a6d0,0x055d4,
  0x052d0,0x0a9b8,0x0a950,0x0b4a0,0x0b6a6,0x0ad50,0x055a0,0x0aba4,0x0a5b0,0x052b0,
  0x0b273,0x06930,0x07337,0x06aa0,0x0ad50,0x14b55,0x04b60,0x0a570,0x054e4,0x0d160,
  0x0e968,0x0d520,0x0daa0,0x16aa6,0x056d0,0x04ae0,0x0a9d4,0x0a2d0,0x0d150,0x0f252,
  0x0d520
];

function lunarYearDays(y: number): number {
  let sum = 348;
  for (let i = 0x8000; i > 0x8; i >>= 1) sum += (LUNAR_INFO[y - 1900] & i) ? 1 : 0;
  return sum + leapDays(y);
}
function leapMonth(y: number): number { return LUNAR_INFO[y - 1900] & 0xf; }
function leapDays(y: number): number {
  if (leapMonth(y)) return (LUNAR_INFO[y - 1900] & 0x10000) ? 30 : 29;
  return 0;
}
function monthDays(y: number, m: number): number { return (LUNAR_INFO[y - 1900] & (0x10000 >> m)) ? 30 : 29; }

function solarToLunar(y: number, m: number, d: number): { year: number; month: number; day: number; isLeap: boolean } {
  const baseDate = new Date(1900, 0, 31);
  const objDate = new Date(y, m - 1, d);
  let offset = Math.floor((objDate.getTime() - baseDate.getTime()) / 86400000);
  let i, temp = 0;
  for (i = 1900; i < 2101 && offset > 0; i++) { temp = lunarYearDays(i); offset -= temp; }
  if (offset < 0) { offset += temp; i--; }
  const year = i;
  const leap = leapMonth(i);
  let isLeap = false;
  for (i = 1; i < 13 && offset > 0; i++) {
    if (leap > 0 && i === leap + 1 && !isLeap) { --i; isLeap = true; temp = leapDays(year); }
    else { temp = monthDays(year, i); }
    if (isLeap && i === leap + 1) isLeap = false;
    offset -= temp;
  }
  if (offset === 0 && leap > 0 && i === leap + 1) {
    if (isLeap) { isLeap = false; } else { isLeap = true; --i; }
  }
  if (offset < 0) { offset += temp; --i; }
  return { year, month: i, day: offset + 1, isLeap };
}

const GAN = ["甲","乙","丙","丁","戊","己","庚","辛","壬","癸"];
const ZHI = ["子","丑","寅","卯","辰","巳","午","未","申","酉","戌","亥"];
const ZODIAC = ["鼠","牛","虎","兔","龙","蛇","马","羊","猴","鸡","狗","猪"];
const LUNAR_MONTHS = ["正","二","三","四","五","六","七","八","九","十","冬","腊"];
const LUNAR_DAYS = ["初一","初二","初三","初四","初五","初六","初七","初八","初九","初十","十一","十二","十三","十四","十五","十六","十七","十八","十九","二十","廿一","廿二","廿三","廿四","廿五","廿六","廿七","廿八","廿九","三十"];

// 公历农历转换器
export function LunarCalendarTool() {
  const __locale = __useLanguage();
  const [date, setDate] = useToolDraft("lunar-calendar", "date", "");
  const result = useMemo(() => {
    const d = date ? new Date(date) : new Date();
    if (isNaN(d.getTime())) return "日期格式错误";
    const lunar = solarToLunar(d.getFullYear(), d.getMonth() + 1, d.getDate());
    const ganZhiYear = GAN[(lunar.year - 4) % 10] + ZHI[(lunar.year - 4) % 12];
    const zodiac = ZODIAC[(lunar.year - 4) % 12];
    const monthStr = (lunar.isLeap ? "闰" : "") + LUNAR_MONTHS[lunar.month - 1] + "月";
    const dayStr = LUNAR_DAYS[lunar.day - 1];
    return `公历：${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日\n农历：${ganZhiYear}年（${zodiac}年）${monthStr}${dayStr}\n农历年份：${lunar.year}年`;
  }, [date, __locale]);
  return (
    <div className="space-y-4">
      <div><Label>{__ui("公历日期（留空则为今天）")}</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
      {result && <ResultBox title={__ui("农历信息")} value={result} mono={false} />}
    </div>
  );
}


// 文本对比（可视化专业 Diff 视图）
export function TextCompareTool() {
  const __locale = __useLanguage();
  const [text1, setText1] = useToolDraft("text-compare", "text1", "const name = 'Furina';\nconsole.log('Hello', name);\nconst version = '2.0.0';");
  const [text2, setText2] = useToolDraft("text-compare", "text2", "const name = 'Furina';\nconsole.log('Bonjour', name);\nconst version = '2.0.1';\nconst isUpdated = true;");
  const [copied, setCopied] = useState(false);
  const [layout, setLayout] = useToolDraft<"split" | "stacked">("text-compare", "layout", "split");
  const [wrap, setWrap] = useToolDraft("text-compare", "wrap", true);
  const { toast } = useToast();

  const diffResult = useMemo(() => {
    const lines1 = text1 ? text1.split("\n") : [];
    const lines2 = text2 ? text2.split("\n") : [];
    const maxLen = Math.max(lines1.length, lines2.length);

    let sameCount = 0;
    let diffCount = 0;

    const rows: Array<{
      lineNum: number;
      left: string | null;
      right: string | null;
      type: "same" | "diff" | "left-only" | "right-only";
    }> = [];

    for (let i = 0; i < maxLen; i++) {
      const l1 = i < lines1.length ? lines1[i] : null;
      const l2 = i < lines2.length ? lines2[i] : null;

      if (l1 === l2) {
        sameCount++;
        rows.push({ lineNum: i + 1, left: l1, right: l2, type: "same" });
      } else if (l1 !== null && l2 !== null) {
        diffCount++;
        rows.push({ lineNum: i + 1, left: l1, right: l2, type: "diff" });
      } else if (l1 !== null) {
        diffCount++;
        rows.push({ lineNum: i + 1, left: l1, right: null, type: "left-only" });
      } else {
        diffCount++;
        rows.push({ lineNum: i + 1, left: null, right: l2, type: "right-only" });
      }
    }

    return { rows, sameCount, diffCount, totalLines: maxLen };
  }, [text1, text2, __locale]);

  const handleSwap = () => {
    const t = text1;
    setText1(text2);
    setText2(t);
  };

  const handleCopyDiff = () => {
    const lines = diffResult.rows
      .filter((r) => r.type !== "same")
      .map((r) => `行 ${r.lineNum}:\n- ${r.left ?? ""}\n+ ${r.right ?? ""}`)
      .join("\n\n");
    navigator.clipboard.writeText(lines);
    setCopied(true);
    toast({ title: "差异文本已复制" });
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-5">
      {/* 顶部状态与操作栏 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-3.5 shadow-xs">
        <div className="flex flex-wrap items-center gap-2.5 text-xs">
          <span className="font-semibold text-foreground">{__ui("比对概览：")}</span>
          <span className="rounded-full bg-muted px-2.5 py-0.5 font-mono text-muted-foreground">
            {__ui("总行数:")}{diffResult.totalLines}
          </span>
          <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
            {__ui("相同:")}{__count(diffResult.sameCount, "行")} </span>
          <span className="rounded-full bg-destructive/15 px-2.5 py-0.5 font-mono text-destructive font-semibold">
            {__ui("差异:")}{diffResult.diffCount} {__ui("处")}</span>
        </div>

        <div className="flex items-center gap-2">
          {/* 排版布局切换 */}
          <div className="flex rounded-lg border border-border bg-secondary/50 p-0.5">
            <button
              type="button"
              onClick={() => setLayout("split")}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                layout === "split" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {__ui("左右双栏")}</button>
            <button
              type="button"
              onClick={() => setLayout("stacked")}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                layout === "stacked" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {__ui("上下通宽")}</button>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={() => setWrap(!wrap)}
            className="h-7 text-xs"
            title={__ui("切换代码/长句是否自动换行")}
          >
            {wrap ? __ui("换行开启") : __ui("单行横滚")}
          </Button>

          <Button variant="outline" size="sm" onClick={handleSwap} className="h-7 text-xs">
            {__ui("交换左右")}</Button>
          <Button variant="outline" size="sm" onClick={handleCopyDiff} className="h-7 text-xs">
            {copied ? __ui("已复制差异") : __ui("复制差异")}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setText1(""); setText2(""); }} className="h-7 text-xs text-muted-foreground hover:text-destructive">
            {__ui("清空全部")}</Button>
        </div>
      </div>

      {/* 左右 / 上下输入框（超大视窗，拒绝拥挤） */}
      <div className={cn("gap-4", layout === "split" ? "grid grid-cols-1 md:grid-cols-2" : "flex flex-col")}>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <Label className="text-xs font-semibold text-muted-foreground">{__ui("原文本（文本 1）")}</Label>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground font-mono">{__count(text1 ? text1.split("\n").length : 0, "行")} </span>
              {text1 && (
                <button onClick={() => setText1("")} className="text-[11px] text-muted-foreground hover:text-destructive">
                  {__ui("清空")}</button>
              )}
            </div>
          </div>
          <Textarea
            value={text1}
            onChange={(e) => setText1(e.target.value)}
            placeholder={__ui("粘贴原文本内容...")}
            rows={12}
            className={cn(
              "min-h-[280px] md:min-h-[340px] font-mono text-[13px] leading-relaxed thin-scroll resize-y",
              wrap ? "whitespace-pre-wrap" : "whitespace-pre overflow-x-auto"
            )}
          />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs">
            <Label className="text-xs font-semibold text-primary">{__ui("待对比文本（文本 2）")}</Label>
            <div className="flex items-center gap-2">
              <span className="text-[11px] text-muted-foreground font-mono">{__count(text2 ? text2.split("\n").length : 0, "行")} </span>
              {text2 && (
                <button onClick={() => setText2("")} className="text-[11px] text-muted-foreground hover:text-destructive">
                  {__ui("清空")}</button>
              )}
            </div>
          </div>
          <Textarea
            value={text2}
            onChange={(e) => setText2(e.target.value)}
            placeholder={__ui("粘贴待对比文本内容...")}
            rows={12}
            className={cn(
              "min-h-[280px] md:min-h-[340px] font-mono text-[13px] leading-relaxed thin-scroll resize-y",
              wrap ? "whitespace-pre-wrap" : "whitespace-pre overflow-x-auto"
            )}
          />
        </div>
      </div>

      {/* 可视化 Diff 逐行对比视图 */}
      <div className="rounded-xl border border-border bg-card overflow-hidden shadow-xs">
        <div className="flex items-center justify-between px-4 py-2.5 bg-muted/40 border-b border-border text-xs font-semibold">
          <span className="text-foreground">{__ui("可视化差异双栏对齐预览")}</span>
          <div className="flex items-center gap-3 text-[11px] text-muted-foreground font-normal">
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-destructive/70 inline-block" /> {__ui("红色原版/删除")}</span>
            <span className="flex items-center gap-1">
              <span className="h-2 w-2 rounded-full bg-emerald-500 inline-block" /> {__ui("绿色新版/变动")}</span>
          </div>
        </div>

        <div className="max-h-96 overflow-y-auto font-mono text-xs thin-scroll divide-y divide-border/40">
          {diffResult.rows.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">{__ui("请输入文本以展开差异比对")}</div>
          ) : (
            diffResult.rows.map((row) => {
              const isDiff = row.type !== "same";
              return (
                <div
                  key={row.lineNum}
                  className={cn(
                    "grid grid-cols-12 text-[11px] py-1 transition-colors",
                    isDiff ? "bg-amber-500/5 dark:bg-amber-500/10" : "hover:bg-muted/30"
                  )}
                >
                  <div className="col-span-1 text-center text-muted-foreground/60 select-none py-0.5">
                    {row.lineNum}
                  </div>

                  <div
                    className={cn(
                      "col-span-5 px-3 py-0.5 border-r border-border/50 truncate overflow-x-auto whitespace-pre",
                      row.type === "diff" || row.type === "left-only"
                        ? "bg-destructive/15 text-destructive dark:text-red-300 font-medium"
                        : "text-muted-foreground"
                    )}
                  >
                    {row.left !== null ? row.left : <span className="opacity-20 select-none">···</span>}
                  </div>

                  <div className="col-span-1 text-center py-0.5 font-bold select-none">
                    {row.type === "same" ? (
                      <span className="text-muted-foreground/40">=</span>
                    ) : row.type === "diff" ? (
                      <span className="text-amber-500">≠</span>
                    ) : row.type === "left-only" ? (
                      <span className="text-destructive">-</span>
                    ) : (
                      <span className="text-emerald-500">+</span>
                    )}
                  </div>

                  <div
                    className={cn(
                      "col-span-5 px-3 py-0.5 truncate overflow-x-auto whitespace-pre",
                      row.type === "diff" || row.type === "right-only"
                        ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-medium"
                        : "text-foreground"
                    )}
                  >
                    {row.right !== null ? row.right : <span className="opacity-20 select-none">···</span>}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

// 花体文字转换
export function FancyTextTool() {
  const __locale = __useLanguage();
  const [text, setText] = useToolDraft("fancy-text", "text", "Hello World");
  const result = useMemo(() => {
    if (!text) return "";
    // 用 Array.from 按 code point 分割，避免代理对（surrogate pair）按码元索引错位
    const styleMaps: Record<string, { from: string; to: string[] }> = {
      "粗体": { from: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", to: Array.from("𝐀𝐁𝐂𝐃𝐄𝐅𝐆𝐇𝐈𝐉𝐊𝐋𝐌𝐍𝐎𝐏𝐐𝐑𝐒𝐓𝐔𝐕𝐖𝐗𝐘𝐙𝐚𝐛𝐜𝐝𝐞𝐟𝐠𝐡𝐢𝐣𝐤𝐥𝐦𝐧𝐨𝐩𝐪𝐫𝐬𝐭𝐮𝐯𝐰𝐱𝐲𝐳𝟎𝟏𝟐𝟑𝟒𝟓𝟔𝟕𝟖𝟗") },
      "斜体": { from: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz", to: Array.from("𝐴𝐵𝐶𝐷𝐸𝐹𝐺𝐻𝐼𝐽𝐾𝐿𝑀𝑁𝑂𝑃𝑄𝑅𝑆𝑇𝑈𝑉𝑊𝑋𝑌𝑍𝑎𝑏𝑐𝑑𝑒𝑓𝑔ℎ𝑖𝑗𝑘𝑙𝑚𝑛𝑜𝑝𝑞𝑟𝑠𝑡𝑢𝑣𝑤𝑥𝑦𝑧") },
      "手写体": { from: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz", to: Array.from("𝒜ℬ𝒞𝒟ℰℱ𝒢ℋℐ𝒥𝒦ℒℳ𝒩𝒪𝒫𝒬ℛ𝒮𝒯𝒰𝒱𝒲𝒳𝒴𝒵𝒶𝒷𝒸𝒹ℯ𝒻ℊ𝒽𝒾𝒿𝓀𝓁𝓂𝓃ℴ𝓅𝓆𝓇𝓈𝓉𝓊𝓋𝓌𝓍𝓎𝓏") },
      "圆圈": { from: "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", to: Array.from("ⒶⒷⒸⒹⒺⒻⒼⒽⒾⒿⓀⓁⓂⓃⓄⓅⓆⓇⓈⓉⓊⓋⓌⓍⓎⓏⓐⓑⓒⓓⓔⓕⓖⓗⓘⓙⓚⓛⓜⓝⓞⓟⓠⓡⓢⓣⓤⓥⓦⓧⓨⓩ⓪①②③④⑤⑥⑦⑧⑨") },
    };
    const chars = Array.from(text);
    return Object.entries(styleMaps).map(([name, map]) => {
      const converted = chars.map((c) => {
        const idx = map.from.indexOf(c);
        return idx >= 0 && idx < map.to.length ? map.to[idx] : c;
      }).join("");
      return `${name}：${converted}`;
    }).join("\n\n");
  }, [text, __locale]);
  return (
    <div className="space-y-4">
      <div><Label>{__ui("输入文字")}</Label><Input value={text} onChange={(e) => setText(e.target.value)} /></div>
      {result && <ResultBox title={__ui("花体样式")} value={result} mono={false} />}
    </div>
  );
}

// 拼音转换（简化版，常用字）
const pinyinMap: Record<string, string> = { "你":"nǐ","好":"hǎo","世":"shì","界":"jiè","中":"zhōng","国":"guó","人":"rén","民":"mín","大":"dà","小":"xiǎo","上":"shàng","下":"xià","左":"zuǒ","右":"yòu","前":"qián","后":"hòu","天":"tiān","地":"dì","日":"rì","月":"yuè","水":"shuǐ","火":"huǒ","山":"shān","石":"shí","田":"tián","土":"tǔ","木":"mù","林":"lín","森":"sēn","花":"huā","草":"cǎo","树":"shù","叶":"yè","风":"fēng","雨":"yǔ","雪":"xuě","云":"yún","雷":"léi","电":"diàn","春":"chūn","夏":"xià","秋":"qiū","冬":"dōng","爱":"ài","恨":"hèn","喜":"xǐ","怒":"nù","哀":"āi","乐":"lè","哭":"kū","笑":"xiào","说":"shuō","听":"tīng","看":"kàn","读":"dú","写":"xiě","学":"xué","习":"xí","工":"gōng","作":"zuò","生":"shēng","活":"huó","家":"jiā","我":"wǒ","他":"tā","她":"tā","它":"tā","们":"men","的":"de","是":"shì","不":"bù","有":"yǒu","无":"wú","在":"zài","和":"hé","与":"yǔ","或":"huò","者":"zhě","也":"yě","都":"dōu","就":"jiù","才":"cái","已":"yǐ","经":"jīng","将":"jiāng","要":"yào","会":"huì","能":"néng","可":"kě","以":"yǐ","这":"zhè","那":"nà","些":"xiē","么":"me","什":"shén","怎":"zěn","如":"rú","果":"guǒ","因":"yīn","为":"wèi","所":"suǒ","但":"dàn","而":"ér","且":"qiě","并":"bìng" };
export function PinyinConverterTool() {
  const __locale = __useLanguage();
  const [text, setText] = useToolDraft("pinyin-converter", "text", "你好世界");
  const result = useMemo(() => {
    if (!text) return "";
    return text.split("").map(c => pinyinMap[c] || c).join(" ");
  }, [text, __locale]);
  return (
    <div className="space-y-4">
      <div><Label>{__ui("汉字")}</Label><Input value={text} onChange={(e) => setText(e.target.value)} /></div>
      {result && <ResultBox title={__ui("拼音")} value={result} mono={false} />}
      <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{__ui("注：当前为常用字简化版，完整拼音需要拼音库支持")}</p>
    </div>
  );
}

// SHA哈希
export function ShaHashTool() {
  const __locale = __useLanguage();
  const [text, setText] = useToolDraft("sha-hash", "text", "");
  // 哈希是点「计算哈希」异步算出来的，不随输入自动重算，所以结果本身也要记住
  const [result, setResult] = useToolDraft("sha-hash", "result", "");
  const calc = async () => {
    if (!text) { setResult(""); return; }
    const enc = new TextEncoder().encode(text);
    const algorithms = ["SHA-1", "SHA-256", "SHA-384", "SHA-512"];
    const results = await Promise.all(algorithms.map(async (alg) => {
      const hash = await crypto.subtle.digest(alg, enc);
      return `${alg}: ${Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, "0")).join("")}`;
    }));
    setResult(results.join("\n\n"));
  };
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label>{__ui("输入文本")}</Label>
          {text && <button type="button" onClick={() => setText("")} className="text-[11px] text-muted-foreground hover:text-destructive">{__ui("清空")}</button>}
        </div>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          className="min-h-[160px] text-sm leading-relaxed resize-y"
          placeholder={__ui("输入要计算哈希的文本...")}
        />
      </div>
      <Button onClick={calc}>{__ui("计算哈希")}</Button>
      {result && <ResultBox title={__ui("哈希结果")} value={result} />}
    </div>
  );
}

// Unicode转换
export function UnicodeConverterTool() {
  const __locale = __useLanguage();
  const [text, setText] = useToolDraft("unicode-converter", "text", "");
  const [mode, setMode] = useToolDraft("unicode-converter", "mode", "encode");
  const result = useMemo(() => {
    if (!text) return "";
    if (mode === "encode") {
      return text.split("").map(c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`).join("");
    } else {
      try { return text.replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))); }
      catch { return "Unicode格式错误"; }
    }
  }, [text, mode, __locale]);
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label>{__ui("输入内容")}</Label>
          {text && <button type="button" onClick={() => setText("")} className="text-[11px] text-muted-foreground hover:text-destructive">{__ui("清空")}</button>}
        </div>
        <Textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          className="min-h-[180px] text-sm font-mono leading-relaxed resize-y"
          placeholder={__ui("输入中文或 \\\\uXXXX 编码...")}
        />
      </div>
      <div><Label>{__ui("模式")}</Label><Select value={mode} onChange={(e) => setMode(e.target.value)}><option value="encode">{__ui("中文→Unicode")}</option><option value="decode">{__ui("Unicode→中文")}</option></Select></div>
      {result && <ResultBox title={__ui("转换结果")} value={result} />}
    </div>
  );
}

// GUID生成
export function GuidGeneratorTool() {
  const __locale = __useLanguage();
  const [count, setCount] = useToolDraft("guid-generator", "count", "5");
  // 结果是点「生成」才出来的，不随输入自动重算，所以结果本身也要记住
  const [result, setResult] = useToolDraft("guid-generator", "result", "");
  const generate = () => { try { setResult(Array.from({length: boundedInteger(count, 1, 100, "数量")}, () => crypto.randomUUID().toUpperCase()).join("\n")); } catch (error) { setResult("错误 / Error: " + (error instanceof Error ? error.message : String(error))); } };
  return (
    <div className="space-y-4">
      <div className="flex items-end gap-4">
        <div className="flex-1"><Label>{__ui("生成数量（最多100）")}</Label><Input value={count} onChange={(e) => setCount(e.target.value)} /></div>
        <Button onClick={generate}><RefreshCw size={14} className="mr-2" />{__ui("生成")}</Button>
      </div>
      {result && <ResultBox title={__ui("GUID 列表")} value={result} />}
    </div>
  );
}

// JSON转TS
export function JsonToTsTool() {
  const __locale = __useLanguage();
  const [json, setJson] = useToolDraft("json-to-ts", "json", "{\"name\":\"test\",\"age\":18}");
  const result = useMemo(() => {
    if (!json.trim()) return "";
    try {
      return jsonToTypeScript(json);
    } catch (e) { return "JSON格式错误：" + (e as Error).message; }
  }, [json, __locale]);
  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label>{__ui("JSON 文本")}</Label>
          {json && <button type="button" onClick={() => setJson("")} className="text-[11px] text-muted-foreground hover:text-destructive">{__ui("清空")}</button>}
        </div>
        <Textarea
          value={json}
          onChange={(e) => setJson(e.target.value)}
          rows={12}
          className="min-h-[280px] md:min-h-[340px] text-xs font-mono-accent leading-relaxed resize-y whitespace-pre"
        />
      </div>
      {result && <ResultBox title="TypeScript Interface" value={result} />}
    </div>
  );
}

// User Agent分析
export function UserAgentAnalyzerTool() {
  const __locale = __useLanguage();
  const [ua, setUa] = useToolDraft("user-agent-analyzer", "ua", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");
  const result = useMemo(() => ua ? userAgentSummary(ua) : "", [ua, __locale]);
  return (
    <div className="space-y-4">
      <div>
        <Label>User Agent</Label>
        <Textarea
          value={ua}
          onChange={(e) => setUa(e.target.value)}
          rows={5}
          className="min-h-[120px] text-xs font-mono leading-relaxed resize-y"
        />
      </div>
      {result && <ResultBox title={__ui("分析结果")} value={result} mono={false} />}
    </div>
  );
}

/** 图片根本读不出来（例如把文本文件改名成 .png）时的固定提示 */
const QR_IMAGE_READ_ERROR = "无法读取该图片";

// 二维码解码器
export function QrDecoderTool() {
  const __locale = __useLanguage();
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    setError(""); setResult("");
    const file = e.target.files?.[0];
    if (!file) return;
    // 这条临时链接只用来把图片喂给 canvas 解码（解码结果是文本，界面不显示这张图），
    // 所以它由「本次处理」自己持有：不管成功还是失败，都在 finally 里用完即释放，
    // 不参与任何缓存 —— 既不留给下一次，也不会释放界面上正在显示的东西。
    const objectUrl = URL.createObjectURL(file);
    try {
      const img = new Image();
      // 必须先挂 onerror 再设 src：以前只等 onload，用户把文本文件改名成 .png 丢进来时
      // 这个 Promise 永远不会 settle —— 界面既不报错也没有任何提示，只能刷新页面才能恢复。
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error(QR_IMAGE_READ_ERROR));
        img.src = objectUrl;
      });
      const canvas = document.createElement("canvas");
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQRDecode(imageData.data, imageData.width, imageData.height);
      if (code) setResult(code);
      else setError("未能识别二维码，请确保图片清晰");
    } catch (err) {
      const message = err instanceof Error ? err.message : "";
      setError(message === QR_IMAGE_READ_ERROR ? QR_IMAGE_READ_ERROR : "处理失败：" + (message || "未知错误"));
    } finally {
      // 释放时机：本次解码结束（成功或失败）后立刻释放这条链接，恰好一次
      URL.revokeObjectURL(objectUrl);
    }
  };
  return (
    <div className="space-y-4">
      <div><Label>{__ui("上传二维码图片")}</Label><input type="file" accept="image/*" onChange={handleFile} className="w-full" /></div>
      {error && <div className="text-sm" style={{ color: "hsl(var(--destructive))" }}>{__msg(error)}</div>}
      {result && <ResultBox title={__ui("二维码内容")} value={result} />}
    </div>
  );
}

// 二维码解码（使用 jsQR 库）
function jsQRDecode(data: Uint8ClampedArray, width: number, height: number): string | null {
  try {
    const code = jsQR(data, width, height, {
      inversionAttempts: "attemptBoth",
    });
    return code ? code.data : null;
  } catch {
    return null;
  }
}

// 元素周期表
export function PeriodicTableTool() {
  const __locale = __useLanguage();
  const elements = [
    { n: 1, s: "H", name: "氢", mass: 1.008 }, { n: 2, s: "He", name: "氦", mass: 4.003 },
    { n: 3, s: "Li", name: "锂", mass: 6.941 }, { n: 4, s: "Be", name: "铍", mass: 9.012 },
    { n: 5, s: "B", name: "硼", mass: 10.81 }, { n: 6, s: "C", name: "碳", mass: 12.01 },
    { n: 7, s: "N", name: "氮", mass: 14.01 }, { n: 8, s: "O", name: "氧", mass: 16.00 },
    { n: 9, s: "F", name: "氟", mass: 19.00 }, { n: 10, s: "Ne", name: "氖", mass: 20.18 },
    { n: 11, s: "Na", name: "钠", mass: 22.99 }, { n: 12, s: "Mg", name: "镁", mass: 24.31 },
    { n: 13, s: "Al", name: "铝", mass: 26.98 }, { n: 14, s: "Si", name: "硅", mass: 28.09 },
    { n: 15, s: "P", name: "磷", mass: 30.97 }, { n: 16, s: "S", name: "硫", mass: 32.07 },
    { n: 17, s: "Cl", name: "氯", mass: 35.45 }, { n: 18, s: "Ar", name: "氩", mass: 39.95 },
    { n: 19, s: "K", name: "钾", mass: 39.10 }, { n: 20, s: "Ca", name: "钙", mass: 40.08 },
    { n: 21, s: "Sc", name: "钪", mass: 44.96 }, { n: 22, s: "Ti", name: "钛", mass: 47.87 },
    { n: 23, s: "V", name: "钒", mass: 50.94 }, { n: 24, s: "Cr", name: "铬", mass: 52.00 },
    { n: 25, s: "Mn", name: "锰", mass: 54.94 }, { n: 26, s: "Fe", name: "铁", mass: 55.85 },
    { n: 27, s: "Co", name: "钴", mass: 58.93 }, { n: 28, s: "Ni", name: "镍", mass: 58.69 },
    { n: 29, s: "Cu", name: "铜", mass: 63.55 }, { n: 30, s: "Zn", name: "锌", mass: 65.38 },
    { n: 31, s: "Ga", name: "镓", mass: 69.72 }, { n: 32, s: "Ge", name: "锗", mass: 72.63 },
    { n: 33, s: "As", name: "砷", mass: 74.92 }, { n: 34, s: "Se", name: "硒", mass: 78.96 },
    { n: 35, s: "Br", name: "溴", mass: 79.90 }, { n: 36, s: "Kr", name: "氪", mass: 83.80 },
    { n: 37, s: "Rb", name: "铷", mass: 85.47 }, { n: 38, s: "Sr", name: "锶", mass: 87.62 },
    { n: 39, s: "Y", name: "钇", mass: 88.91 }, { n: 40, s: "Zr", name: "锆", mass: 91.22 },
    { n: 41, s: "Nb", name: "铌", mass: 92.91 }, { n: 42, s: "Mo", name: "钼", mass: 95.95 },
    { n: 43, s: "Tc", name: "锝", mass: 98.00 }, { n: 44, s: "Ru", name: "钌", mass: 101.1 },
    { n: 45, s: "Rh", name: "铑", mass: 102.9 }, { n: 46, s: "Pd", name: "钯", mass: 106.4 },
    { n: 47, s: "Ag", name: "银", mass: 107.9 }, { n: 48, s: "Cd", name: "镉", mass: 112.4 },
    { n: 49, s: "In", name: "铟", mass: 114.8 }, { n: 50, s: "Sn", name: "锡", mass: 118.7 },
    { n: 51, s: "Sb", name: "锑", mass: 121.8 }, { n: 52, s: "Te", name: "碲", mass: 127.6 },
    { n: 53, s: "I", name: "碘", mass: 126.9 }, { n: 54, s: "Xe", name: "氙", mass: 131.3 },
    { n: 55, s: "Cs", name: "铯", mass: 132.9 }, { n: 56, s: "Ba", name: "钡", mass: 137.3 },
    { n: 57, s: "La", name: "镧", mass: 138.9 }, { n: 58, s: "Ce", name: "铈", mass: 140.1 },
    { n: 59, s: "Pr", name: "镨", mass: 140.9 }, { n: 60, s: "Nd", name: "钕", mass: 144.2 },
    { n: 61, s: "Pm", name: "钷", mass: 145.0 }, { n: 62, s: "Sm", name: "钐", mass: 150.4 },
    { n: 63, s: "Eu", name: "铕", mass: 152.0 }, { n: 64, s: "Gd", name: "钆", mass: 157.3 },
    { n: 65, s: "Tb", name: "铽", mass: 158.9 }, { n: 66, s: "Dy", name: "镝", mass: 162.5 },
    { n: 67, s: "Ho", name: "钬", mass: 164.9 }, { n: 68, s: "Er", name: "铒", mass: 167.3 },
    { n: 69, s: "Tm", name: "铥", mass: 168.9 }, { n: 70, s: "Yb", name: "镱", mass: 173.0 },
    { n: 71, s: "Lu", name: "镥", mass: 175.0 }, { n: 72, s: "Hf", name: "铪", mass: 178.5 },
    { n: 73, s: "Ta", name: "钽", mass: 180.9 }, { n: 74, s: "W", name: "钨", mass: 183.8 },
    { n: 75, s: "Re", name: "铼", mass: 186.2 }, { n: 76, s: "Os", name: "锇", mass: 190.2 },
    { n: 77, s: "Ir", name: "铱", mass: 192.2 }, { n: 78, s: "Pt", name: "铂", mass: 195.1 },
    { n: 79, s: "Au", name: "金", mass: 197.0 }, { n: 80, s: "Hg", name: "汞", mass: 200.6 },
    { n: 81, s: "Tl", name: "铊", mass: 204.4 }, { n: 82, s: "Pb", name: "铅", mass: 207.2 },
    { n: 83, s: "Bi", name: "铋", mass: 209.0 }, { n: 84, s: "Po", name: "钋", mass: 209.0 },
    { n: 85, s: "At", name: "砹", mass: 210.0 }, { n: 86, s: "Rn", name: "氡", mass: 222.0 },
    { n: 87, s: "Fr", name: "钫", mass: 223.0 }, { n: 88, s: "Ra", name: "镭", mass: 226.0 },
    { n: 89, s: "Ac", name: "锕", mass: 227.0 }, { n: 90, s: "Th", name: "钍", mass: 232.0 },
    { n: 91, s: "Pa", name: "镤", mass: 231.0 }, { n: 92, s: "U", name: "铀", mass: 238.0 },
    { n: 93, s: "Np", name: "镎", mass: 237.0 }, { n: 94, s: "Pu", name: "钚", mass: 244.0 },
    { n: 95, s: "Am", name: "镅", mass: 243.0 }, { n: 96, s: "Cm", name: "锔", mass: 247.0 },
    { n: 97, s: "Bk", name: "锫", mass: 247.0 }, { n: 98, s: "Cf", name: "锎", mass: 251.0 },
    { n: 99, s: "Es", name: "锿", mass: 252.0 }, { n: 100, s: "Fm", name: "镄", mass: 257.0 },
    { n: 101, s: "Md", name: "钔", mass: 258.0 }, { n: 102, s: "No", name: "锘", mass: 259.0 },
    { n: 103, s: "Lr", name: "铹", mass: 262.0 }, { n: 104, s: "Rf", name: "𬬻", mass: 267.0 },
    { n: 105, s: "Db", name: "𬭊", mass: 268.0 }, { n: 106, s: "Sg", name: "𬭳", mass: 269.0 },
    { n: 107, s: "Bh", name: "𬭛", mass: 270.0 }, { n: 108, s: "Hs", name: "𬭶", mass: 269.0 },
    { n: 109, s: "Mt", name: "鿏", mass: 278.0 }, { n: 110, s: "Ds", name: "𫟼", mass: 281.0 },
    { n: 111, s: "Rg", name: "𬬭", mass: 282.0 }, { n: 112, s: "Cn", name: "鿔", mass: 285.0 },
    { n: 113, s: "Nh", name: "鿭", mass: 286.0 }, { n: 114, s: "Fl", name: "𫓧", mass: 289.0 },
    { n: 115, s: "Mc", name: "镆", mass: 290.0 }, { n: 116, s: "Lv", name: "𫟷", mass: 293.0 },
    { n: 117, s: "Ts", name: "鿬", mass: 294.0 }, { n: 118, s: "Og", name: "鿫", mass: 294.0 },
  ];
  const [selected, setSelected] = useState<typeof elements[0] | null>(null);
  return (
    <div className="space-y-4">
      <p className="text-xs" style={{ color: "hsl(var(--muted-foreground))" }}>{__ui("点击元素查看详情（共118个元素）")}</p>
      <div className="grid grid-cols-5 gap-2 sm:grid-cols-10">
        {elements.map(el => (
          <button
            key={el.n}
            onClick={() => setSelected(el)}
            className="rounded-lg border p-2 text-center transition-all hover:scale-105"
            style={{
              borderColor: selected?.n === el.n ? "hsl(var(--primary))" : "hsl(var(--border))",
              backgroundColor: selected?.n === el.n ? "hsl(var(--accent))" : "hsl(var(--card))",
            }}
          >
            <div className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>{el.n}</div>
            <div className="text-sm font-bold" style={{ color: "hsl(var(--foreground))" }}>{el.s}</div>
            <div className="text-[10px]" style={{ color: "hsl(var(--muted-foreground))" }}>{__msg(el.name)}</div>
          </button>
        ))}
      </div>
      {selected && (
        <div className="rounded-lg border p-4" style={{ borderColor: "hsl(var(--border))", backgroundColor: "hsl(var(--card))" }}>
          <h4 className="text-lg font-bold" style={{ color: "hsl(var(--primary))" }}>{__msg(selected.name)} ({selected.s})</h4>
          <p className="mt-2 text-sm" style={{ color: "hsl(var(--foreground))" }}>{__ui("原子序数：")}{selected.n}</p>
          <p className="text-sm" style={{ color: "hsl(var(--foreground))" }}>{__ui("相对原子质量：")}{selected.mass}</p>
        </div>
      )}
    </div>
  );
}

// ========== 第四批工具 ==========

// 图片Base64转换
export {ImageBase64Workbench as ImageBase64Tool} from "./byte-workbench";

// CRC32校验
function crc32(str: string): number { return crc32Utf8(str); }
export function CrcChecksumTool() {
  const __locale = __useLanguage();
  const [text, setText] = useToolDraft("crc-checksum", "text", "");
  const result = useMemo(() => {
    if (!text) return "";
    const crc = crc32(text);
    return `CRC32（十进制）：${crc}\nCRC32（十六进制）：0x${crc.toString(16).toUpperCase().padStart(8, "0")}\n输入长度：${text.length} 字符，${new TextEncoder().encode(text).length} UTF-8 字节`;
  }, [text, __locale]);
  return (
    <div className="space-y-4">
      <div><Label>{__ui("输入文本")}</Label><Textarea value={text} onChange={(e) => setText(e.target.value)} rows={4} /></div>
      {result && <ResultBox title={__ui("CRC32 校验值")} value={result} />}
    </div>
  );
}

// 文件HEX值
export {FileHexWorkbench as FileHexTool} from "./byte-workbench";

// 特殊符号
export function SpecialSymbolsTool() {
  const __locale = __useLanguage();
  const categories = [
    { name: "箭头", symbols: ["←", "→", "↑", "↓", "↔", "↕", "⇐", "⇒", "⇑", "⇓", "➔", "➙", "➛", "➜", "➝", "➞", "➟", "➠", "➡", "➢"] },
    { name: "星星", symbols: ["★", "☆", "✦", "✧", "✩", "✪", "✫", "✬", "✭", "✮", "✯", "✰", "⋆", "＊", "✱", "✲", "✳", "✴", "✵", "✶"] },
    { name: "心形", symbols: ["♥", "♡", "❣", "❤", "❥", "❦", "❧", "💕", "💖", "💗", "💘", "💝", "💞", "💟", "💔", "💓", "💐", "🌹", "🌷", "🌻"] },
    { name: "音乐", symbols: ["♪", "♫", "♬", "♩", "♭", "♮", "♯", "🎵", "🎶", "🎷", "🎸", "🎹", "🎺", "🎻", "🥁", "🎤", "🎧", "🎼", "🎙", "🎚"] },
    { name: "天气", symbols: ["☀", "☁", "☂", "☃", "❄", "❅", "❆", "🌞", "🌝", "🌛", "🌜", "🌚", "🌑", "🌒", "🌓", "🌔", "🌕", "🌖", "🌗", "🌘"] },
    { name: "数学", symbols: ["±", "×", "÷", "≠", "≈", "≤", "≥", "∞", "∑", "∏", "∫", "∮", "∂", "∇", "√", "∛", "∜", "∠", "⊥", "∥"] },
    { name: "货币", symbols: ["¥", "$", "€", "£", "¢", "₤", "₣", "₧", "₱", "₹", "₩", "₪", "₫", "฿", "₭", "₮", "₯", "₰", "₲", "₳"] },
    { name: "标点", symbols: ["【", "】", "《", "》", "〈", "〉", "「", "」", "『", "』", "﹁", "﹂", "﹃", "﹄", "〔", "〕", "〖", "〗", "〘", "〙"] },
  ];
  const [copied, setCopied] = useState("");
  const copy = (s: string) => {
    navigator.clipboard.writeText(s);
    setCopied(s);
    setTimeout(() => setCopied(""), 1000);
  };
  return (
    <div className="space-y-4">
      {copied && <div className="text-sm" style={{ color: "hsl(var(--success))" }}>{__ui("已复制：")}{copied}</div>}
      {categories.map(cat => (
        <div key={cat.name}>
          <h4 className="text-sm font-bold mb-2" style={{ color: "hsl(var(--primary))" }}>{__msg(cat.name)}</h4>
          <div className="flex flex-wrap gap-2">
            {cat.symbols.map((s, i) => (
              <button key={i} onClick={() => copy(s)} className="w-10 h-10 rounded-lg border text-lg transition-all hover:scale-110" style={{ borderColor: "hsl(var(--border))", backgroundColor: "hsl(var(--card))", color: "hsl(var(--foreground))" }}>{s}</button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}


// 批量重命名工具
export function BatchRenameTool() {
  const __locale = __useLanguage();
  const [files, setFiles] = useState<string[]>([]);
  const [pattern, setPattern] = useToolDraft("batch-rename", "pattern", "");
  // 起始序号也用同一套草稿机制：number 类型原样存回，切走再回来不会掉回 1
  const [startNum, setStartNum] = useToolDraft("batch-rename", "startNum", 1);
  const [findText, setFindText] = useToolDraft("batch-rename", "findText", "");
  const [replaceText, setReplaceText] = useToolDraft("batch-rename", "replaceText", "");
  const [prefix, setPrefix] = useToolDraft("batch-rename", "prefix", "");
  const [suffix, setSuffix] = useToolDraft("batch-rename", "suffix", "");
  const [caseMode, setCaseMode] = useToolDraft("batch-rename", "caseMode", "none");

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (fileList) {
      setFiles(Array.from(fileList).map((f) => f.name));
    }
  };

  const getNewName = (oldName: string, index: number): string => {
    const dotIndex = oldName.lastIndexOf(".");
    const name = dotIndex > 0 ? oldName.substring(0, dotIndex) : oldName;
    const ext = dotIndex > 0 ? oldName.substring(dotIndex) : "";

    let newName = name;

    // 查找替换
    if (findText) {
      newName = newName.split(findText).join(replaceText);
    }

    // 序号模式（全局替换所有出现的 {n} 和 {name}）
    if (pattern) {
      newName = pattern.split("{n}").join(String(startNum + index)).split("{name}").join(newName);
    }

    // 前后缀
    newName = prefix + newName + suffix;

    // 大小写
    if (caseMode === "upper") newName = newName.toUpperCase();
    if (caseMode === "lower") newName = newName.toLowerCase();

    return newName + ext;
  };

  const copyAll = () => {
    const result = files.map((f, i) => `${f} → ${getNewName(f, i)}`).join("\n");
    navigator.clipboard.writeText(result);
  };

  return (
    <div className="space-y-4">
      <div>
        <Label>{__ui("选择文件")}</Label>
        <input type="file" multiple onChange={handleFileSelect} className="mt-1 block w-full text-sm" style={{ color: "hsl(var(--foreground))" }} />
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label>{__ui("命名模板（")}{"{n}"}{__ui("=序号，")}{"{name}"}{__ui("=原名）")}</Label>
          <Input value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder={__ui("例如: photo_{n}")} />
        </div>
        <div>
          <Label>{__ui("起始序号")}</Label>
          <Input type="number" value={startNum} onChange={(e) => setStartNum(Number(e.target.value))} />
        </div>
        <div>
          <Label>{__ui("查找")}</Label>
          <Input value={findText} onChange={(e) => setFindText(e.target.value)} placeholder={__ui("要替换的文字")} />
        </div>
        <div>
          <Label>{__ui("替换为")}</Label>
          <Input value={replaceText} onChange={(e) => setReplaceText(e.target.value)} placeholder={__ui("替换后的文字")} />
        </div>
        <div>
          <Label>{__ui("前缀")}</Label>
          <Input value={prefix} onChange={(e) => setPrefix(e.target.value)} placeholder={__ui("文件名前缀")} />
        </div>
        <div>
          <Label>{__ui("后缀")}</Label>
          <Input value={suffix} onChange={(e) => setSuffix(e.target.value)} placeholder={__ui("文件名后缀")} />
        </div>
        <div>
          <Label>{__ui("大小写")}</Label>
          <Select value={caseMode} onChange={(e) => setCaseMode(e.target.value)}>
            <option value="none">{__ui("不变")}</option>
            <option value="upper">{__ui("全部大写")}</option>
            <option value="lower">{__ui("全部小写")}</option>
          </Select>
        </div>
      </div>

      {files.length > 0 && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium" style={{ color: "hsl(var(--foreground))" }}>{__ui("预览（共")}{files.length} {__ui("个文件）")}</span>
            <Button onClick={copyAll} size="sm">{__ui("复制全部")}</Button>
          </div>
          <div className="max-h-64 space-y-1 overflow-auto rounded-lg border p-3" style={{ borderColor: "hsl(var(--border))", backgroundColor: "hsl(var(--card))" }}>
            {files.map((f, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span style={{ color: "hsl(var(--muted-foreground))" }}>{f}</span>
                <span style={{ color: "hsl(var(--primary))" }}>→</span>
                <span style={{ color: "hsl(var(--success))" }}>{getNewName(f, i)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}




// ========== JavaScript 格式化（双栏实时格式化预览） ==========
export function JsFormatterTool() {
  const __locale = __useLanguage();
  const [input, setInput] = useToolDraft("js-formatter", "input", "function calculateTotal(items, taxRate) {let sum=0;for(let i=0;i<items.length;i++){sum+=items[i].price*items[i].quantity;}const tax=sum*taxRate;return{subtotal:sum,tax:tax,total:sum+tax};}\nconsole.log(calculateTotal([{price:100,quantity:2}],0.08));");
  const { output, error: formatError } = useFormattedCode(input, "js");
  const [copied, setCopied] = useState(false);
  const [layout, setLayout] = useToolDraft<"split" | "stacked">("js-formatter", "layout", "split");
  const { toast } = useToast();


  const copy = () => {
    if (!output) return;
    navigator.clipboard.writeText(output);
    setCopied(true);
    toast({ title: "已复制格式化后的 JS 代码" });
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-4">
      {formatError && <div role="alert" className="text-xs text-destructive whitespace-pre-wrap">{__msg(formatError)}</div>}
      {/* 顶部工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-border bg-card p-3 shadow-xs">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-foreground">{__ui("视图布局：")}</span>
          <div className="flex rounded-lg border border-border bg-secondary/50 p-0.5">
            <button
              type="button"
              onClick={() => setLayout("split")}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                layout === "split" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {__ui("左右并排")}</button>
            <button
              type="button"
              onClick={() => setLayout("stacked")}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                layout === "stacked" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {__ui("上下全宽（大视窗）")}</button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {input && (
            <Button variant="ghost" size="sm" onClick={() => setInput("")} className="h-7 text-xs text-muted-foreground hover:text-destructive">
              {__ui("清空源码")}</Button>
          )}
          <Button variant="outline" size="sm" onClick={copy} disabled={!output} className="h-7 text-xs gap-1.5">
            {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
            <span>{copied ? __ui("已复制代码") : __ui("复制代码")}</span>
          </Button>
        </div>
      </div>

      {/* 编辑器区域 */}
      <div className={cn("gap-4", layout === "split" ? "grid grid-cols-1 md:grid-cols-2" : "flex flex-col")}>
        <div className="space-y-2">
          <Label className="text-xs font-semibold text-muted-foreground">{__ui("JavaScript 源码输入")}</Label>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={__ui("粘贴待排版的 JavaScript 代码...")}
            className="min-h-[380px] md:min-h-[440px] font-mono text-[13px] leading-relaxed thin-scroll resize-y whitespace-pre overflow-x-auto"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-semibold text-primary">{__ui("实时排版高亮预览")}</Label>
          <pre className="min-h-[380px] md:min-h-[440px] overflow-auto rounded-xl border border-border bg-card p-4 font-mono text-[13px] thin-scroll leading-relaxed text-foreground select-text whitespace-pre">
            {output || __ui("// 等待输入 JavaScript 代码...")}
          </pre>
        </div>
      </div>
    </div>
  );
}

// ========== HTML 格式化（双栏实时格式化预览） ==========
export function HtmlFormatterTool() {
  const __locale = __useLanguage();
  const [input, setInput] = useToolDraft("html-formatter", "input", "<div class=\"furina-card\"><header><h1>FurinaKit</h1><p>Elegant Toolkit</p></header><main><section><ul><li>Feature A</li><li>Feature B</li></ul></section></main></div>");
  const { output, error: formatError } = useFormattedCode(input, "html");
  const [copied, setCopied] = useState(false);
  const [layout, setLayout] = useToolDraft<"split" | "stacked">("html-formatter", "layout", "split");
  const { toast } = useToast();


  const copy = () => {
    if (!output) return;
    navigator.clipboard.writeText(output);
    setCopied(true);
    toast({ title: "已复制格式化后的 HTML 代码" });
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="space-y-4">
      {formatError && <div role="alert" className="text-xs text-destructive whitespace-pre-wrap">{__msg(formatError)}</div>}
      {/* 顶部工具栏 */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-border bg-card p-3 shadow-xs">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-foreground">{__ui("视图布局：")}</span>
          <div className="flex rounded-lg border border-border bg-secondary/50 p-0.5">
            <button
              type="button"
              onClick={() => setLayout("split")}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                layout === "split" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {__ui("左右并排")}</button>
            <button
              type="button"
              onClick={() => setLayout("stacked")}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs font-medium transition-all",
                layout === "stacked" ? "bg-background text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              )}
            >
              {__ui("上下全宽（大视窗）")}</button>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {input && (
            <Button variant="ghost" size="sm" onClick={() => setInput("")} className="h-7 text-xs text-muted-foreground hover:text-destructive">
              {__ui("清空源码")}</Button>
          )}
          <Button variant="outline" size="sm" onClick={copy} disabled={!output} className="h-7 text-xs gap-1.5">
            {copied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
            <span>{copied ? __ui("已复制代码") : __ui("复制代码")}</span>
          </Button>
        </div>
      </div>

      {/* 编辑器区域 */}
      <div className={cn("gap-4", layout === "split" ? "grid grid-cols-1 md:grid-cols-2" : "flex flex-col")}>
        <div className="space-y-2">
          <Label className="text-xs font-semibold text-muted-foreground">{__ui("HTML 源码输入")}</Label>
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={__ui("粘贴待排版的 HTML 代码...")}
            className="min-h-[380px] md:min-h-[440px] font-mono text-[13px] leading-relaxed thin-scroll resize-y whitespace-pre overflow-x-auto"
          />
        </div>

        <div className="space-y-2">
          <Label className="text-xs font-semibold text-primary">{__ui("实时排版高亮预览")}</Label>
          <pre className="min-h-[380px] md:min-h-[440px] overflow-auto rounded-xl border border-border bg-card p-4 font-mono text-[13px] thin-scroll leading-relaxed text-foreground select-text whitespace-pre">
            {output || __ui("<!-- 等待输入 HTML 代码... -->")}
          </pre>
        </div>
      </div>
    </div>
  );
}

// ========== 大小写转换 ==========
export function CaseConverterTool() {
  const __locale = __useLanguage();
  const [input, setInput] = useToolDraft("case-converter", "input", "");

  const toUpper = () => setInput(input.toUpperCase());
  const toLower = () => setInput(input.toLowerCase());
  const toTitle = () => setInput(input.replace(/\w\S*/g, txt => txt.charAt(0).toUpperCase() + txt.substr(1).toLowerCase()));
  const toggleCase = () => setInput(input.split("").map(c => c === c.toUpperCase() ? c.toLowerCase() : c.toUpperCase()).join(""));

  return (
    <div className="space-y-4">
      <Textarea value={input} onChange={(e) => setInput(e.target.value)} placeholder={__ui("输入文本...")} className="min-h-[240px] text-sm leading-relaxed" />
      <div className="flex flex-wrap gap-2">
        <Button onClick={toUpper}>{__ui("全部大写")}</Button>
        <Button onClick={toLower}>{__ui("全部小写")}</Button>
        <Button onClick={toTitle}>{__ui("首字母大写")}</Button>
        <Button onClick={toggleCase}>{__ui("大小写反转")}</Button>
      </div>
      <div className="text-sm text-muted-foreground">{__ui("字符数:")}{input.length} {__ui("| 单词数:")}{input.trim() ? input.trim().split(/\s+/).length : 0}</div>
    </div>
  );
}

// ========== 日期转换 ==========
export function DateConverterTool() {
  const __locale = __useLanguage();
  const [timestamp, setTimestamp] = useToolDraft("date-converter", "timestamp", String(Math.floor(Date.now() / 1000)));
  const [dateStr, setDateStr] = useToolDraft("date-converter", "dateStr", "");

  const tsToDate = () => {
    const ts = parseInt(timestamp);
    if (isNaN(ts)) return;
    const d = new Date(ts * 1000);
    // 超大时间戳会得到 Invalid Date，直接展示可读提示而不是 "Invalid Date"
    if (!Number.isFinite(d.getTime())) { setDateStr("时间戳超出可表示范围"); return; }
    setDateStr(d.toLocaleString(__localeTag(), { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }));
  };

  const dateToTs = () => {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return;
    setTimestamp(String(Math.floor(d.getTime() / 1000)));
  };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>{__ui("时间戳（秒）")}</Label>
        <div className="flex gap-2">
          <Input value={timestamp} onChange={(e) => setTimestamp(e.target.value)} />
          <Button onClick={tsToDate}>{__ui("转日期")}</Button>
        </div>
      </div>
      <div className="space-y-2">
        <Label>{__ui("日期时间")}</Label>
        <div className="flex gap-2">
          <Input value={dateStr} onChange={(e) => setDateStr(e.target.value)} placeholder="2024-01-01 12:00:00" />
          <Button onClick={dateToTs}>{__ui("转时间戳")}</Button>
        </div>
      </div>
    </div>
  );
}

// ========== IP 转换 ==========
export function IpConverterTool() {
  const __locale = __useLanguage();
  const [ip, setIp] = useToolDraft("ip-converter", "ip", "192.168.1.1");
  const [num, setNum] = useToolDraft("ip-converter", "num", "");

  const ipToNum = () => { try { setNum(ipv4ToInteger(ip)); } catch (error) { setNum("错误 / Error: " + (error instanceof Error ? error.message : String(error))); } };

  const numToIp = () => { try { setIp(integerToIpv4(num)); } catch (error) { setIp("错误 / Error: " + (error instanceof Error ? error.message : String(error))); } };

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>{__ui("IP 地址")}</Label>
        <div className="flex gap-2">
          <Input value={ip} onChange={(e) => setIp(e.target.value)} />
          <Button onClick={ipToNum}>{__ui("转数字")}</Button>
        </div>
      </div>
      <div className="space-y-2">
        <Label>{__ui("数字")}</Label>
        <div className="flex gap-2">
          <Input value={num} onChange={(e) => setNum(e.target.value)} />
          <Button onClick={numToIp}>{__ui("转 IP")}</Button>
        </div>
      </div>
    </div>
  );
}

// ========== HTTP 状态查询 ==========
export function HttpStatusTool() {
  const __locale = __useLanguage();
  const [code, setCode] = useToolDraft("http-status", "code", "200");
  const statusMap: Record<string, { name: string; desc: string; category: string }> = {
    "100": { name: "Continue", desc: "继续", category: "信息响应" },
    "101": { name: "Switching Protocols", desc: "切换协议", category: "信息响应" },
    "200": { name: "OK", desc: "请求成功", category: "成功" },
    "201": { name: "Created", desc: "已创建", category: "成功" },
    "204": { name: "No Content", desc: "无内容", category: "成功" },
    "301": { name: "Moved Permanently", desc: "永久重定向", category: "重定向" },
    "302": { name: "Found", desc: "临时重定向", category: "重定向" },
    "304": { name: "Not Modified", desc: "未修改", category: "重定向" },
    "400": { name: "Bad Request", desc: "请求错误", category: "客户端错误" },
    "401": { name: "Unauthorized", desc: "未授权", category: "客户端错误" },
    "403": { name: "Forbidden", desc: "禁止访问", category: "客户端错误" },
    "404": { name: "Not Found", desc: "未找到", category: "客户端错误" },
    "405": { name: "Method Not Allowed", desc: "方法不允许", category: "客户端错误" },
    "429": { name: "Too Many Requests", desc: "请求过多", category: "客户端错误" },
    "500": { name: "Internal Server Error", desc: "服务器内部错误", category: "服务器错误" },
    "502": { name: "Bad Gateway", desc: "网关错误", category: "服务器错误" },
    "503": { name: "Service Unavailable", desc: "服务不可用", category: "服务器错误" },
    "504": { name: "Gateway Timeout", desc: "网关超时", category: "服务器错误" },
  };

  const result = statusMap[code];

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>{__ui("HTTP 状态码")}</Label>
        <Input value={code} onChange={(e) => setCode(e.target.value)} placeholder={__ui("输入状态码，如 200")} />
      </div>
      {result ? (
        <div className="rounded-xl border p-4" style={{ background: "var(--card)" }}>
          <div className="flex items-center gap-3">
            <span className="text-2xl font-bold">{code}</span>
            <div>
              <div className="font-semibold">{__msg(result.name)}</div>
              <div className="text-sm text-muted-foreground">{__ui(result.desc)}</div>
            </div>
          </div>
          <div className="mt-2 text-xs text-muted-foreground">{__ui("分类:")}{result.category}</div>
        </div>
      ) : (
        <div className="rounded-lg border p-3 text-sm" style={{ borderColor: "hsl(var(--border))", color: "hsl(var(--muted-foreground))" }}>{__ui("未找到该状态码的信息")}</div>
      )}
      <div className="grid grid-cols-3 gap-2 text-xs">
        {Object.entries(statusMap).slice(0, 9).map(([k, v]) => (
          <button key={k} onClick={() => setCode(k)} className="rounded border p-2 text-left hover:bg-accent">
            <div className="font-mono font-bold">{k}</div>
            <div className="text-muted-foreground">{__ui(v.desc)}</div>
          </button>
        ))}
      </div>
    </div>
  );
}


// ==================== 图表工具 ====================

function ChartTool({ title, chartType }: { title: string; chartType: "scatter" | "pie" | "line" | "bar" }) {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  // 草稿键由 chartType 推出，与 tool-runner 的工具 id 一致（scatter-chart / pie-chart / line-chart / bar-chart）
  const [data, setData] = useToolDraft(`${chartType}-chart`, "data", "");
  // 图表是点「生成图表」才算出来的，所以生成好的 option 也一起记住，切回来时图表还在
  const [options, setOptions] = useToolDraft<Record<string, unknown> | null>(`${chartType}-chart`, "options", null);
  const chartRef = useRef<ReactECharts>(null);

  const generateChart = () => {
    if (!data.trim()) return;

    const lines = data.trim().split("\n");
    const labels: string[] = [];
    const values: number[] = [];

    lines.forEach((line) => {
      const parts = line.split(/[,，\t\s]+/);
      if (parts.length >= 2) {
        const num = parseFloat(parts[1]);
        if (!isNaN(num)) {
          labels.push(parts[0]);
          values.push(num);
        }
      }
    });

    if (labels.length === 0 || values.length === 0) return;

    const textStyle = { color: colors.text };
    const axisLine = { lineStyle: { color: colors.borderSolid } };
    const splitLine = { lineStyle: { color: colors.border } };

    const option: Record<string, unknown> = {
      backgroundColor: "transparent",
      textStyle,
      tooltip: { trigger: chartType === "pie" ? "item" : "axis" },
      grid: { left: "3%", right: "4%", bottom: "3%", containLabel: true },
    };

    if (chartType === "pie") {
      option.series = [
        {
          type: "pie",
          radius: ["40%", "70%"],
          avoidLabelOverlap: false,
          itemStyle: { borderRadius: 10, borderColor: colors.card, borderWidth: 2 },
          label: { show: true, color: colors.text },
          data: labels.map((label, i) => ({ name: label, value: values[i] })),
        },
      ];
    } else {
      option.xAxis = { type: "category", data: labels, axisLine, axisLabel: textStyle };
      option.yAxis = { type: "value", axisLine, splitLine, axisLabel: textStyle };
      option.series = [
        {
          type: chartType,
          data: values,
          itemStyle: {
            color: {
              type: "linear",
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: "#60a5fa" },
                { offset: 1, color: "#3b82f6" },
              ],
            },
            borderRadius: chartType === "bar" ? [6, 6, 0, 0] : 0,
          },
          areaStyle: chartType === "line" ? {
            color: {
              type: "linear",
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(96, 165, 250, 0.4)" },
                { offset: 1, color: "rgba(96, 165, 250, 0.05)" },
              ],
            },
          } : undefined,
          smooth: chartType === "line",
          symbolSize: chartType === "scatter" ? 12 : 8,
        },
      ];
    }

    setOptions(option);
  };

  const exportChart = () => {
    if (!chartRef.current) return;
    const instance = chartRef.current.getEchartsInstance();
    const url = instance.getDataURL({
      type: "png",
      pixelRatio: 2,
      backgroundColor: colors.card,
    });
    const link = document.createElement("a");
    link.download = `${title}_${Date.now()}.png`;
    link.href = url;
    link.click();
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="mb-2 block text-[13px] font-medium" style={{ color: colors.text }}>
          {__ui("数据输入（每行一个数据，格式：名称,数值）")}</label>
        <textarea
          value={data}
          onChange={(e) => setData(e.target.value)}
          placeholder={__ui("示例：\n苹果,120\n香蕉,80\n橙子,95\n葡萄,60")}
          className="h-32 w-full resize-none rounded-xl border p-3 font-mono text-[13px] outline-none transition-colors"
          style={{ background: colors.bg, borderColor: colors.borderSolid, color: colors.text }}
          onFocus={(e) => (e.currentTarget.style.borderColor = colors.gold)}
          onBlur={(e) => (e.currentTarget.style.borderColor = colors.borderSolid)}
        />
      </div>
      <button
        onClick={generateChart}
        className="flex h-10 items-center gap-2 rounded-xl px-5 text-[14px] font-medium transition-all hover:opacity-90"
        style={{ background: colors.gold, color: colors.onGold }}
      >
        {__ui("生成图表")}</button>
      {options && (
        <div className="rounded-xl border p-4" style={{ background: colors.card, borderColor: colors.borderSolid }}>
          <div className="mb-3 flex items-center justify-between">
            <span className="text-[13px] font-medium" style={{ color: colors.text }}>{__ui("图表预览")}</span>
            <button
              onClick={exportChart}
              className="flex h-8 items-center gap-1.5 rounded-lg px-3 text-[12px] font-medium transition-all hover:opacity-80"
              style={{ background: colors.gold, color: colors.onGold }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              {__ui("导出图片")}</button>
          </div>
          <ReactECharts ref={chartRef} option={options} style={{ height: "400px", width: "100%" }} />
        </div>
      )}
    </div>
  );
}

export function ScatterChartTool() {
  const __locale = __useLanguage();
  return <ChartTool title={__ui("散点图")} chartType="scatter" />;
}

export function PieChartTool() {
  const __locale = __useLanguage();
  return <ChartTool title={__ui("饼图")} chartType="pie" />;
}

export function LineChartTool() {
  const __locale = __useLanguage();
  return <ChartTool title={__ui("折线图")} chartType="line" />;
}

export function BarChartTool() {
  const __locale = __useLanguage();
  return <ChartTool title={__ui("柱状图")} chartType="bar" />;
}
