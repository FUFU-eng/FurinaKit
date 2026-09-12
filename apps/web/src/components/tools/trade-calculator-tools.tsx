"use client";

/**
 * 进出口贸易计算台
 *
 * 把外贸业务里最常算的五件事放进同一个工作台：
 *   1. 单价与税额：含税 ⇄ 不含税单价、增值税额、价税合计、按总额反推数量；
 *   2. 报价换算：FOB / CFR / CIF 互转（运费 + 保险费 + 投保加成）、佣金（明佣/暗佣）、加价与折扣；
 *   3. 成本与利润：出口退税、退税后出口总成本、换汇成本、盈亏平衡汇率、利润率、保本报价；
 *   4. 进口环节税：关税、消费税（从价 + 从量）、进口环节增值税、进口综合成本；
 *   5. 运费与费用分摊：按数量 / 金额 / 体积 / 重量把一笔总费用摊到多行货物上。
 *
 * 结果的呈现方式统一为「项目 / 计算式 / 金额」三列的分项明细表，可直接复制进报价邮件；
 * 每条公式的出处写在右侧「公式与口径」卡片里。
 *
 * 纯计算逻辑集中在下面的 CORE 区（不引用 React、不涉及 JSX），方便在 Node 里单独跑单测对拍。
 */

import React from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  Coins,
  Copy,
  Check,
  FileText,
  Landmark,
  Plus,
  Receipt,
  RotateCcw,
  Scale,
  Ship,
  Sparkles,
  Trash2,
  TrendingUp,
  type LucideIcon,
} from "lucide-react";
import { Button, Input, Label, Select } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import { useToolDraft } from "@/lib/use-tool-draft";

/* ===== CORE:BEGIN =====
 * 纯计算核心：只依赖 ECMAScript 内建对象，可直接转译后在 Node 里做单元测试。
 * ======================================================================= */

/** 明细表的一行 */
export interface LineItem {
  key: string;
  /** 项目名 */
  label: string;
  /** 计算式（把实际数字代进去，方便用户核对） */
  formula: string;
  /** 数值；null 表示这一项在当前输入下无意义，界面显示破折号 */
  value: number | null;
  /** 单位，如 元 / USD / 件 / % */
  unit: string;
  /** 小数位；不填用界面上的默认金额小数位 */
  digits?: number;
  /** input = 用户填的输入项，calc = 推导项，total = 合计项 */
  kind?: "input" | "calc" | "total";
  /** 是否作为顶部「关键结果」展示 */
  star?: boolean;
  /** 补一句口径说明 */
  note?: string;
}

export type CalcResult =
  | { ok: true; items: LineItem[]; notes: string[] }
  | { ok: false; error: string; /** 只是还没填，不是填错了 */ missing?: boolean };

function fail(error: string): CalcResult {
  return { ok: false, error };
}

function notYet(error: string): CalcResult {
  return { ok: false, error, missing: true };
}

function done(items: LineItem[], notes: string[] = []): CalcResult {
  return { ok: true, items, notes };
}

/**
 * 抹掉二进制浮点毛刺：0.1 + 0.2 = 0.30000000000000004 → 0.3。
 * 用 15 位有效数字，是因为 double 的精度上限是 17 位有效数字，
 * 15 位既能去掉毛刺，又不会伤到正常数值。
 */
export function cleanFloat(value: number): number {
  if (!Number.isFinite(value)) return value;
  return Number(value.toPrecision(15));
}

/**
 * 四舍五入（half-up，远离 0），默认 2 位。
 *
 * 直接 `Math.round(v * 100) / 100` 会踩「1.005 × 100 = 100.49999999999999」这种坑，
 * 结果是 1.00 而用户期望 1.01；所以先 cleanFloat 再缩放、再 cleanFloat、最后才取整。
 */
export function roundHalfUp(value: number, digits = 2): number {
  if (!Number.isFinite(value)) return value;
  const d = Math.max(0, Math.min(15, Math.trunc(digits)));
  const sign = value < 0 ? -1 : 1;
  const factor = Math.pow(10, d);
  const scaled = cleanFloat(cleanFloat(Math.abs(value)) * factor);
  const out = (sign * Math.round(scaled)) / factor;
  return Object.is(out, -0) ? 0 : out;
}

/** 千分位 + 固定小数位；非有限值显示破折号，不会出现 NaN 字样 */
export function formatNumber(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const d = Math.max(0, Math.min(15, Math.trunc(digits)));
  const rounded = roundHalfUp(value, d);
  const negative = rounded < 0;
  const fixed = Math.abs(rounded).toFixed(d);
  const dot = fixed.indexOf(".");
  const intPart = dot === -1 ? fixed : fixed.slice(0, dot);
  const decPart = dot === -1 ? "" : fixed.slice(dot);
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (negative ? "-" : "") + grouped + decPart;
}

/** 带正负号的金额（利润、差额用） */
export function formatSigned(value: number | null | undefined, digits = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  const text = formatNumber(value, digits);
  return value > 0 ? `+${text}` : text;
}

/** 数值展示时的通用简写 */
function n(value: number | null | undefined, digits = 2): string {
  return formatNumber(value, digits);
}

/** 把用户可能带进来的全角数字、千分位逗号、百分号都归一化掉 */
export function normalizeNumericInput(raw: string): string {
  return raw
    .trim()
    .replace(/[\uFF10-\uFF19]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/\uFF0E/g, ".")
    .replace(/[%\uFF05\u2030]/g, "")
    .replace(/[\s,\uFF0C_]/g, "");
}

/** 区间提示里的边界值：整数就不显示 .00 */
function formatBound(value: number, unit: string): string {
  return `${formatNumber(value, 2).replace(/\.00$/, "")}${unit}`;
}

export interface ParseRule {
  label: string;
  /** 必须 > 0（数量、单价、销售额这类做分母或做乘数的量） */
  positive?: boolean;
  min?: number;
  max?: number;
  /** 提示语里跟在数字后面的单位 */
  unit?: string;
  /** 允许负数（本工具里几乎不用，留着以防将来加「亏损」类输入） */
  allowNegative?: boolean;
}

export type ParseResult =
  | { state: "ok"; value: number }
  | { state: "empty" }
  | { state: "error"; message: string };

/**
 * 解析并校验一个数值输入框。
 * 三种结果分得很清楚：ok（合法）/ empty（没填）/ error（填错了，带人话提示）。
 */
export function parseNumberField(raw: string | null | undefined, rule: ParseRule): ParseResult {
  const source = raw === null || raw === undefined ? "" : String(raw);
  const cleaned = normalizeNumericInput(source);
  if (cleaned === "") return { state: "empty" };
  const value = Number(cleaned);
  const unit = rule.unit ?? "";
  if (!Number.isFinite(value)) {
    return { state: "error", message: `${rule.label}要填数字（当前输入「${source.trim()}」）` };
  }
  if (value < 0 && !rule.allowNegative) {
    return { state: "error", message: `${rule.label}不能是负数（当前 ${formatNumber(value, 2)}${unit}）` };
  }
  if (rule.positive && value <= 0) {
    return { state: "error", message: `${rule.label}必须大于 0` };
  }
  if (rule.min !== undefined && value < rule.min) {
    return { state: "error", message: `${rule.label}不能小于 ${formatBound(rule.min, unit)}` };
  }
  if (rule.max !== undefined && value > rule.max) {
    return { state: "error", message: `${rule.label}不能大于 ${formatBound(rule.max, unit)}` };
  }
  return { state: "ok", value };
}

/** 取「填了就用，没填给 null」的便捷函数 */
export function parsedValue(result: ParseResult): number | null {
  return result.state === "ok" ? result.value : null;
}

/** 取「填了就用，没填给兜底值」 */
export function parsedOr(result: ParseResult, fallback: number): number {
  return result.state === "ok" ? result.value : fallback;
}

/** 在明细表里按 key 找一行（测试与界面都要用） */
export function itemByKey(result: CalcResult, key: string): LineItem | null {
  if (!result.ok) return null;
  return result.items.find((item) => item.key === key) ?? null;
}

/* ───────────────────────── 场景 1：单价与税额 ───────────────────────── */

export type UnitPriceMode = "notaxToTax" | "taxToNotax" | "reverseQty";

export interface UnitPriceInput {
  mode: UnitPriceMode;
  /** 不含税单价（元） */
  notaxUnit: number | null;
  /** 含税单价（元） */
  taxUnit: number | null;
  /** 数量 */
  qty: number | null;
  /** 不含税总金额（元），反推数量时使用 */
  totalNotax: number | null;
  /** 增值税率，13 表示 13% */
  vatRatePct: number;
  /** 附加系数（旧版外贸预设里的 1.03 辅料/加价系数），1 表示不加 */
  extraFactor: number;
}

/**
 * 含税 / 不含税单价与税额。
 *
 * 口径依据：《中华人民共和国增值税暂行条例》——销售额为不含税销售额，
 * 含税销售额 = 不含税销售额 × (1 + 税率)，即 不含税 = 含税 ÷ (1 + 税率)。
 * 中国现行一般纳税人税率 13% / 9% / 6%，小规模纳税人征收率 3%（阶段性减按 1%）。
 *
 * 注意与旧版 function-calculator 预设的差别：旧式把「不含税总额 ÷ 单价」得到的**数量**
 * 乘系数后当成「含税单价」输出，量纲是错的；这里把「数量」与「含税单价」拆成两个独立结果，
 * 旧的 1.03 系数保留为可选的「附加系数」（默认 1）。
 */
export function calcUnitPrice(input: UnitPriceInput): CalcResult {
  const rateCoef = 1 + input.vatRatePct / 100;
  const factor = input.extraFactor;
  if (!(rateCoef > 0)) return fail("增值税率填写有误（1 + 税率必须大于 0）");
  if (!(factor > 0)) return fail("附加系数必须大于 0");

  let notaxUnit = input.notaxUnit;
  let taxUnit = input.taxUnit;
  let qty = input.qty;
  let notaxAmount: number;
  const extra = factor === 1 ? "" : ` × ${n(factor, 4)}`;

  if (input.mode === "notaxToTax") {
    if (notaxUnit === null) return notYet("请填写不含税单价（元）");
    if (qty === null) return notYet("请填写数量");
    if (notaxUnit <= 0) return fail("不含税单价必须大于 0");
    if (qty <= 0) return fail("数量必须大于 0");
    notaxAmount = cleanFloat(notaxUnit * qty);
    taxUnit = cleanFloat(notaxUnit * rateCoef * factor);
  } else if (input.mode === "taxToNotax") {
    if (taxUnit === null) return notYet("请填写含税单价（元）");
    if (qty === null) return notYet("请填写数量");
    if (taxUnit <= 0) return fail("含税单价必须大于 0");
    if (qty <= 0) return fail("数量必须大于 0");
    notaxUnit = cleanFloat(taxUnit / (rateCoef * factor));
    notaxAmount = cleanFloat(notaxUnit * qty);
  } else {
    if (input.totalNotax === null) return notYet("请填写不含税总金额（元）");
    if (notaxUnit === null) return notYet("请填写基准（不含税）单价（元）");
    if (input.totalNotax <= 0) return fail("不含税总金额必须大于 0");
    if (notaxUnit <= 0) return fail("基准单价必须大于 0");
    qty = cleanFloat(input.totalNotax / notaxUnit);
    notaxAmount = input.totalNotax;
    taxUnit = cleanFloat(notaxUnit * rateCoef * factor);
  }

  const taxAmount = cleanFloat(notaxAmount * rateCoef * factor);
  const vatAmount = cleanFloat(taxAmount - notaxAmount);
  const unitVat = cleanFloat(taxUnit - notaxUnit);
  const burdenPct = notaxAmount > 0 ? cleanFloat((vatAmount / notaxAmount) * 100) : 0;

  const notes: string[] = [];
  const qtyDigits = input.mode === "reverseQty" ? 4 : 2;
  if (input.mode === "reverseQty") {
    notes.push(
      `数量由「不含税总金额 ÷ 基准单价」反推得到，显示 ${qtyDigits} 位小数；若实际只能整件交货，请按整数数量重算金额。`,
    );
  }
  if (factor !== 1) {
    notes.push(`含税单价上额外乘了附加系数 ${n(factor, 4)}（不是税率），税额也按同系数同步放大。`);
  }
  if (input.mode === "taxToNotax") {
    notes.push("由含税价倒推不含税价用的是除法：「含税 ÷ (1 + 税率)」，不是「含税 × (1 − 税率)」。");
  }

  const items: LineItem[] = [
    {
      key: "qty",
      label: "数量",
      formula: input.mode === "reverseQty" ? `${n(input.totalNotax)} ÷ ${n(notaxUnit)}` : "输入",
      value: qty,
      unit: "件",
      digits: qtyDigits,
      kind: "input",
    },
    {
      key: "notaxUnit",
      label: "不含税单价",
      formula: input.mode === "taxToNotax" ? `${n(input.taxUnit)} ÷ (1 + ${n(input.vatRatePct, 2)}%)${extra}` : "输入",
      value: notaxUnit,
      unit: "元",
      kind: input.mode === "taxToNotax" ? "calc" : "input",
    },
    {
      key: "taxUnit",
      label: "含税单价",
      formula: `${n(notaxUnit)} × (1 + ${n(input.vatRatePct, 2)}%)${extra}`,
      value: taxUnit,
      unit: "元",
      star: true,
    },
    {
      key: "unitVat",
      label: "单件税额",
      formula: `${n(taxUnit)} − ${n(notaxUnit)}`,
      value: unitVat,
      unit: "元",
    },
    {
      key: "notaxAmount",
      label: "不含税金额",
      formula: input.mode === "reverseQty" ? "输入（不含税总金额）" : `${n(notaxUnit)} × ${n(qty, qtyDigits)}`,
      value: notaxAmount,
      unit: "元",
      kind: "total",
    },
    {
      key: "taxAmount",
      label: "价税合计",
      formula: `${n(taxUnit)} × ${n(qty, qtyDigits)}`,
      value: taxAmount,
      unit: "元",
      kind: "total",
      star: true,
    },
    {
      key: "vatAmount",
      label: "增值税额",
      formula: `${n(taxAmount)} − ${n(notaxAmount)}`,
      value: vatAmount,
      unit: "元",
      kind: "total",
      star: true,
      note: factor === 1 ? "也等于 不含税金额 × 税率" : undefined,
    },
    {
      key: "burden",
      label: "综合税负率",
      formula: `${n(vatAmount)} ÷ ${n(notaxAmount)}`,
      value: burdenPct,
      unit: "%",
      digits: 2,
    },
  ];

  return done(items, notes);
}

/* ───────────────────────── 场景 2：报价换算 ───────────────────────── */

export type QuoteBase = "fob" | "cfr" | "cif";
export type MarkupMode = "coef" | "rate";
export type CommissionType = "none" | "explicit" | "hidden";

export interface QuoteInput {
  /** 你手上那个价是哪个条件 */
  base: QuoteBase;
  /** 基础报价金额（美元） */
  amount: number | null;
  /** 国际运费（美元） */
  freight: number;
  /** 保险费率，0.8 表示 0.8% */
  insuranceRatePct: number;
  /** 投保加成的表达口径：coef = 直接给系数（110 表示 110%）；rate = 给加成率（10 表示加成 10%） */
  markupMode: MarkupMode;
  /** 投保加成数值，含义随 markupMode 变化 */
  markupValue: number;
  commissionType: CommissionType;
  /** 佣金率，5 表示 5% */
  commissionPct: number;
  /** 报价加价率，作用在基础报价上 */
  markupUpPct: number;
  /** 折扣率，作用在基础报价上 */
  discountPct: number;
}

/**
 * FOB / CFR / CIF 互转 + 佣金 + 加价折扣。
 *
 * 口径依据（国际贸易惯例 / Incoterms）：
 *   CFR = FOB + 国际运费
 *   保险金额 = CIF × 投保加成（惯例为发票金额的 110%）
 *   保险费  = 保险金额 × 保险费率 = CIF × 投保加成 × 保险费率
 *   由 CIF = CFR + 保险费 反解：CIF = (FOB + 运费) ÷ (1 − 投保加成 × 保险费率)
 *
 * ⚠️ 这里有个常见陷阱：分母里用的是「投保加成**系数**」（110% → 1.1），
 *    不是「加成**率**」（10% → 0.1）。两者差的正是那个 1：
 *    系数 = 1 + 加成率。界面把两种口径都留了口子，避免用户填 10 还是 110 全靠猜。
 *
 * 佣金（明佣 / 暗佣）按最终成交价（发票金额）计算：
 *   净价 = 含佣价 × (1 − 佣金率) ⇒ 含佣价 = 净价 ÷ (1 − 佣金率)
 *   明佣与暗佣的**金额完全一样**，区别只在报价单/发票上是否明示。
 */
export function calcQuote(input: QuoteInput): CalcResult {
  if (input.amount === null) return notYet("请填写基础报价金额（美元）");
  if (input.amount <= 0) return fail("基础报价金额必须大于 0");
  if (input.freight < 0) return fail("国际运费不能是负数");
  if (input.insuranceRatePct < 0) return fail("保险费率不能是负数");
  if (input.markupValue < 0) return fail("投保加成不能是负数");
  if (input.commissionPct < 0) return fail("佣金率不能是负数");
  if (input.commissionPct >= 100) return fail("佣金率必须小于 100%");
  if (input.discountPct < 0) return fail("折扣率不能是负数");
  if (input.discountPct >= 100) return fail("折扣率不能等于或大于 100%，否则报价会变成 0");

  const coefPct = input.markupMode === "coef" ? input.markupValue : 100 + input.markupValue;
  const coef = coefPct / 100;
  const insRate = input.insuranceRatePct / 100;
  const denom = 1 - coef * insRate;
  if (!(denom > 1e-9)) {
    return fail(
      `投保加成 ${n(coefPct, 2)}% × 保险费率 ${n(input.insuranceRatePct, 4)}% 已经不小于 100%，CIF 价无解。请确认保险费率填的是百分数本身（0.8 表示 0.8%，不是 80%）。`,
    );
  }

  const baseAmount = input.amount;
  const adjustedBase = cleanFloat(baseAmount * (1 + input.markupUpPct / 100) * (1 - input.discountPct / 100));
  if (!(adjustedBase > 0)) return fail("加价与折扣之后的基础报价变成 0 了，请检查加价率与折扣率");

  const freight = cleanFloat(input.freight);
  let fob: number;
  let cfr: number;
  let cif: number;
  if (input.base === "fob") {
    fob = adjustedBase;
    cfr = cleanFloat(fob + freight);
    cif = cleanFloat(cfr / denom);
  } else if (input.base === "cfr") {
    cfr = adjustedBase;
    fob = cleanFloat(cfr - freight);
    cif = cleanFloat(cfr / denom);
  } else {
    cif = adjustedBase;
    cfr = cleanFloat(cif * denom);
    fob = cleanFloat(cfr - freight);
  }
  if (fob <= 0) {
    return fail("扣掉国际运费后 FOB 价小于等于 0，说明运费相对报价过高（或基础条件选错了），请检查输入。");
  }

  const insurance = cleanFloat(cif - cfr);
  const insuredAmount = cleanFloat(cif * coef);
  const commissionRate = input.commissionType === "none" ? 0 : input.commissionPct / 100;
  const netByBase = input.base === "fob" ? fob : input.base === "cfr" ? cfr : cif;
  const finalQuote = commissionRate > 0 ? cleanFloat(netByBase / (1 - commissionRate)) : netByBase;
  const commission = cleanFloat(finalQuote - netByBase);
  const netIncome = cleanFloat(finalQuote - commission);
  const baseLabel = input.base === "fob" ? "FOB" : input.base === "cfr" ? "CFR" : "CIF";

  const notes: string[] = [
    `分母里的「投保加成」是系数：${n(coefPct, 2)}% 表示保险金额按 CIF 价的 ${n(coefPct, 2)}% 投保（惯例 110%）。`,
    "佣金按最终成交价计算：含佣价 = 净价 ÷ (1 − 佣金率)。",
  ];
  if (input.commissionType === "hidden") {
    notes.push("暗佣与明佣金额完全一致，区别只是佣金不在报价单/发票上显示。");
  }
  if (input.base !== "fob" && freight > 0) {
    notes.push("由较高条件倒推较低条件时，运费是减项；运费高于该条件价时结果会失真，已做拦截。");
  }

  const items: LineItem[] = [
    {
      key: "baseAmount",
      label: `基础报价（${baseLabel}）`,
      formula: "输入",
      value: baseAmount,
      unit: "USD",
      kind: "input",
    },
  ];
  if (input.markupUpPct !== 0 || input.discountPct !== 0) {
    items.push({
      key: "adjustedBase",
      label: "调整后基础报价",
      formula: `${n(baseAmount)} × (1 + ${n(input.markupUpPct, 2)}%) × (1 − ${n(input.discountPct, 2)}%)`,
      value: adjustedBase,
      unit: "USD",
      note: "加价与折扣先作用在你填的那个价上，再往下换算",
    });
    if (input.discountPct !== 0) {
      items.push({
        key: "discountAmount",
        label: "折扣金额",
        formula: `${n(baseAmount)} × (1 + ${n(input.markupUpPct, 2)}%) × ${n(input.discountPct, 2)}%`,
        value: cleanFloat(baseAmount * (1 + input.markupUpPct / 100) * (input.discountPct / 100)),
        unit: "USD",
      });
    }
  }
  items.push(
    {
      key: "fob",
      label: "FOB 净价",
      formula:
        input.base === "fob"
          ? "输入"
          : input.base === "cfr"
            ? `${n(cfr)} − ${n(freight)}`
            : `${n(cif)} × (1 − ${n(coefPct, 2)}% × ${n(input.insuranceRatePct, 4)}%) − ${n(freight)}`,
      value: fob,
      unit: "USD",
      star: true,
    },
    { key: "freight", label: "国际运费", formula: "输入", value: freight, unit: "USD", kind: "input" },
    {
      key: "cfr",
      label: "CFR 净价",
      formula: `${n(fob)} + ${n(freight)}`,
      value: cfr,
      unit: "USD",
    },
    {
      key: "insuranceRate",
      label: "保险费率",
      formula: "输入",
      value: input.insuranceRatePct,
      unit: "%",
      digits: 4,
      kind: "input",
    },
    {
      key: "insuredAmount",
      label: "保险金额",
      formula: `${n(cif)} × ${n(coefPct, 2)}%`,
      value: insuredAmount,
      unit: "USD",
      note: "保险金额 = CIF 价 × 投保加成系数",
    },
    {
      key: "insurance",
      label: "保险费",
      formula: `${n(insuredAmount)} × ${n(input.insuranceRatePct, 4)}%`,
      value: insurance,
      unit: "USD",
      note: "保险费 = CIF × 投保加成 × 保险费率",
    },
    {
      key: "cif",
      label: "CIF 净价",
      formula: `(${n(fob)} + ${n(freight)}) ÷ (1 − ${n(coefPct, 2)}% × ${n(input.insuranceRatePct, 4)}%)`,
      value: cif,
      unit: "USD",
      star: true,
    },
    {
      key: "commissionRate",
      label: "佣金率",
      formula: input.commissionType === "none" ? "无佣金" : "输入",
      value: commissionRate * 100,
      unit: "%",
      digits: 2,
      kind: "input",
    },
    {
      key: "finalQuote",
      label:
        input.commissionType === "none"
          ? `最终报价（${baseLabel}）`
          : `最终报价（${baseLabel} 含${input.commissionType === "explicit" ? "明" : "暗"}佣）`,
      formula: commissionRate > 0 ? `${n(netByBase)} ÷ (1 − ${n(commissionRate * 100, 2)}%)` : "等于净价（未设佣金）",
      value: finalQuote,
      unit: "USD",
      kind: "total",
      star: true,
    },
    {
      key: "commission",
      label: "佣金额",
      formula: `${n(finalQuote)} × ${n(commissionRate * 100, 2)}%`,
      value: commission,
      unit: "USD",
    },
    {
      key: "netIncome",
      label: "卖方净收入",
      formula: `${n(finalQuote)} − ${n(commission)}`,
      value: netIncome,
      unit: "USD",
      kind: "total",
    },
  );

  return done(items, notes);
}

/* ───────────────────────── 场景 3：出口成本与利润 ───────────────────────── */

export interface ExportCostInput {
  /** 出口销售额（美元，FOB 净收入口径） */
  exportUsd: number | null;
  /** 银行结汇汇率（人民币 / 美元） */
  rate: number;
  /** 国内含税采购总额（元） */
  costWithTax: number | null;
  /** 进项增值税率，13 表示 13% */
  vatRatePct: number;
  /** 出口退税率，13 表示 13% */
  rebateRatePct: number;
  /** 国内费用：内陆运费、报关、银行费用等（元） */
  domesticFee: number;
  /** 目标成本利润率，用于算目标报价 */
  targetMarginPct: number;
}

/**
 * 出口成本、退税、换汇成本与利润。
 *
 * 口径依据：
 *   外贸企业出口实行「免退税」办法，应退税额 = 增值税专用发票**不含税**金额 × 退税率；
 *   不含税采购额 = 含税采购额 ÷ (1 + 征税率)——这是「价税分离」，不是「含税 × (1 − 税率)」。
 *   出口总成本（退税后）= 含税采购额 − 出口退税 + 国内费用。
 *   换汇成本 = 出口总成本（人民币）÷ 外汇净收入（美元）；
 *   由于收入 = 销售额 × 汇率，令利润为 0 可解出 汇率 = 出口总成本 ÷ 销售额，
 *   所以「盈亏平衡汇率」在数值上恒等于「换汇成本」，界面把这一点显式标出来。
 */
export function calcExportCost(input: ExportCostInput): CalcResult {
  if (input.costWithTax === null) return notYet("请填写国内含税采购总额（元）");
  if (input.exportUsd === null) return notYet("请填写出口销售额（美元）");
  if (input.costWithTax <= 0) return fail("国内含税采购总额必须大于 0");
  if (input.exportUsd <= 0) return fail("出口销售额必须大于 0（换汇成本要用它做分母）");
  if (input.rate <= 0) return fail("结汇汇率必须大于 0");
  if (input.vatRatePct < 0 || input.rebateRatePct < 0) return fail("税率不能是负数");
  if (input.rebateRatePct > input.vatRatePct) {
    return fail(
      `退税率（${n(input.rebateRatePct, 2)}%）不能高于征税率（${n(input.vatRatePct, 2)}%），请检查这两个税率。`,
    );
  }
  if (input.domesticFee < 0) return fail("国内费用不能是负数");

  const notaxCost = cleanFloat(input.costWithTax / (1 + input.vatRatePct / 100));
  const rebate = cleanFloat(notaxCost * (input.rebateRatePct / 100));
  const unrecoverable = cleanFloat(notaxCost * ((input.vatRatePct - input.rebateRatePct) / 100));
  const totalCost = cleanFloat(input.costWithTax - rebate + input.domesticFee);
  const revenue = cleanFloat(input.exportUsd * input.rate);
  const profit = cleanFloat(revenue - totalCost);
  const exchangeCost = cleanFloat(totalCost / input.exportUsd);
  const perUsdProfit = cleanFloat(input.rate - exchangeCost);
  const costMarginPct = totalCost > 0 ? cleanFloat((profit / totalCost) * 100) : null;
  const salesMarginPct = revenue > 0 ? cleanFloat((profit / revenue) * 100) : null;
  const profitUsd = cleanFloat(profit / input.rate);
  const breakevenQuote = cleanFloat(totalCost / input.rate);
  const targetQuote = cleanFloat((totalCost * (1 + input.targetMarginPct / 100)) / input.rate);

  const notes: string[] = [
    "不含税采购额用的是价税分离公式：含税 ÷ (1 + 征税率)。",
    "盈亏平衡汇率与换汇成本是同一个数（收入 = 成本 时的汇率），低于当前结汇汇率才有利润。",
  ];
  if (unrecoverable > 0) {
    notes.push(
      `征税率 ${n(input.vatRatePct, 2)}% 高于退税率 ${n(input.rebateRatePct, 2)}%，差额对应的进项税 ${n(unrecoverable)} 元不给退，已经留在成本里。`,
    );
  }

  const items: LineItem[] = [
    {
      key: "costWithTax",
      label: "国内含税采购总额",
      formula: "输入",
      value: input.costWithTax,
      unit: "元",
      kind: "input",
    },
    {
      key: "vatRate",
      label: "进项增值税率",
      formula: "输入",
      value: input.vatRatePct,
      unit: "%",
      kind: "input",
    },
    {
      key: "notaxCost",
      label: "不含税采购额",
      formula: `${n(input.costWithTax)} ÷ (1 + ${n(input.vatRatePct, 2)}%)`,
      value: notaxCost,
      unit: "元",
    },
    {
      key: "rebateRate",
      label: "出口退税率",
      formula: "输入",
      value: input.rebateRatePct,
      unit: "%",
      kind: "input",
    },
    {
      key: "rebate",
      label: "出口退税",
      formula: `${n(notaxCost)} × ${n(input.rebateRatePct, 2)}%`,
      value: rebate,
      unit: "元",
      star: true,
      note: "应退税额 = 不含税采购额 × 退税率",
    },
    {
      key: "unrecoverable",
      label: "不可退税部分",
      formula: `${n(notaxCost)} × (${n(input.vatRatePct, 2)}% − ${n(input.rebateRatePct, 2)}%)`,
      value: unrecoverable,
      unit: "元",
      note: "征退税率的差额，进项里退不回来的部分，实际留在成本中",
    },
    {
      key: "domesticFee",
      label: "国内费用",
      formula: "输入",
      value: input.domesticFee,
      unit: "元",
      kind: "input",
    },
    {
      key: "totalCost",
      label: "出口总成本（退税后）",
      formula: `${n(input.costWithTax)} − ${n(rebate)} + ${n(input.domesticFee)}`,
      value: totalCost,
      unit: "元",
      kind: "total",
      star: true,
    },
    {
      key: "exportUsd",
      label: "出口销售额",
      formula: "输入",
      value: input.exportUsd,
      unit: "USD",
      kind: "input",
    },
    { key: "rate", label: "结汇汇率", formula: "输入", value: input.rate, unit: "CNY/USD", digits: 4, kind: "input" },
    {
      key: "revenue",
      label: "结汇收入",
      formula: `${n(input.exportUsd)} × ${n(input.rate, 4)}`,
      value: revenue,
      unit: "元",
    },
    {
      key: "profit",
      label: "出口利润",
      formula: `${n(revenue)} − ${n(totalCost)}`,
      value: profit,
      unit: "元",
      kind: "total",
      star: true,
    },
    {
      key: "exchangeCost",
      label: "换汇成本",
      formula: `${n(totalCost)} ÷ ${n(input.exportUsd)}`,
      value: exchangeCost,
      unit: "元/USD",
      digits: 4,
      star: true,
      note: "每换回 1 美元所花的退税后人民币总成本",
    },
    {
      key: "perUsdProfit",
      label: "每美元利润",
      formula: `${n(input.rate, 4)} − ${n(exchangeCost, 4)}`,
      value: perUsdProfit,
      unit: "元/USD",
      digits: 4,
    },
    {
      key: "breakevenRate",
      label: "盈亏平衡汇率",
      formula: `${n(totalCost)} ÷ ${n(input.exportUsd)}`,
      value: exchangeCost,
      unit: "CNY/USD",
      digits: 4,
      note: "数值上恒等于换汇成本：收入 = 成本 时的汇率",
    },
    {
      key: "profitUsd",
      label: "折合美元利润",
      formula: `${n(profit)} ÷ ${n(input.rate, 4)}`,
      value: profitUsd,
      unit: "USD",
    },
    {
      key: "costMargin",
      label: "成本利润率",
      formula: `${n(profit)} ÷ ${n(totalCost)}`,
      value: costMarginPct,
      unit: "%",
      digits: 2,
      note: "利润 ÷ 出口总成本（退税后）",
    },
    {
      key: "salesMargin",
      label: "销售利润率",
      formula: `${n(profit)} ÷ ${n(revenue)}`,
      value: salesMarginPct,
      unit: "%",
      digits: 2,
      note: "利润 ÷ 结汇收入",
    },
    {
      key: "breakevenQuote",
      label: "保本 FOB 报价",
      formula: `${n(totalCost)} ÷ ${n(input.rate, 4)}`,
      value: breakevenQuote,
      unit: "USD",
      note: "利润为 0 时的美元报价；低于它就亏",
    },
    {
      key: "targetQuote",
      label: `目标利润率 ${n(input.targetMarginPct, 2)}% 的报价`,
      formula: `${n(totalCost)} × (1 + ${n(input.targetMarginPct, 2)}%) ÷ ${n(input.rate, 4)}`,
      value: targetQuote,
      unit: "USD",
    },
  ];

  return done(items, notes);
}

/* ───────────────────────── 场景 4：进口环节税 ───────────────────────── */

export interface ImportTaxInput {
  /** 关税完税价格（CIF 人民币价） */
  cifRmb: number | null;
  /** 进口关税税率，8 表示 8% */
  tariffPct: number;
  /** 消费税比例税率，0 表示不涉消费税 */
  excisePct: number;
  /** 从量消费税：每单位税额（元） */
  exciseUnitRmb: number;
  /** 数量（用于从量消费税与单件成本） */
  qty: number;
  /** 进口环节增值税率，13 表示 13% */
  vatRatePct: number;
  /** 港杂费与其他费用（元） */
  portFee: number;
}

/**
 * 进口环节税与进口综合成本。
 *
 * 口径依据：
 *   《进出口关税条例》：从价关税 = 关税完税价格 × 关税税率。
 *   《消费税暂行条例》：实行从价定率的，组成计税价格 = (关税完税价格 + 关税) ÷ (1 − 消费税比例税率)；
 *     实行复合计税的，组成计税价格 = (关税完税价格 + 关税 + 从量消费税) ÷ (1 − 消费税比例税率)。
 *   《增值税暂行条例》第十四条：进口环节组成计税价格 = 关税完税价格 + 关税 + 消费税，
 *     应纳增值税 = 组成计税价格 × 增值税税率。
 *   注意增值税的计税依据里**包含消费税**（因为消费税是价内税）。
 *
 *   中国现行税率参考：进口环节增值税 13%（部分民生商品 9%）；进口关税按 HS 编码，
 *   最惠国税率差异很大（2024 年关税总水平约 7.3%），默认值只作示例，请按实际商品改。
 */
export function calcImportTax(input: ImportTaxInput): CalcResult {
  if (input.cifRmb === null) return notYet("请填写关税完税价格（CIF 人民币价）");
  if (input.cifRmb <= 0) return fail("关税完税价格必须大于 0");
  if (input.tariffPct < 0 || input.tariffPct > 100) return fail("进口关税税率必须在 0% ~ 100% 之间");
  if (input.excisePct < 0 || input.excisePct >= 100) {
    return fail("消费税比例税率必须大于等于 0% 且小于 100%（等于 100% 时组成计税价格无解）");
  }
  if (input.exciseUnitRmb < 0) return fail("从量消费税单位税额不能是负数");
  if (input.qty <= 0) return fail("数量必须大于 0（用于从量消费税与单件成本）");
  if (input.vatRatePct < 0 || input.vatRatePct > 100) return fail("进口环节增值税率必须在 0% ~ 100% 之间");
  if (input.portFee < 0) return fail("港杂费不能是负数");

  const tariff = cleanFloat(input.cifRmb * (input.tariffPct / 100));
  const exciseSpecific = cleanFloat(input.qty * input.exciseUnitRmb);
  const exciseBase = cleanFloat((input.cifRmb + tariff + exciseSpecific) / (1 - input.excisePct / 100));
  const exciseAdValorem = cleanFloat(exciseBase * (input.excisePct / 100));
  const exciseTotal = cleanFloat(exciseAdValorem + exciseSpecific);
  const vatBase = cleanFloat(input.cifRmb + tariff + exciseTotal);
  const vat = cleanFloat(vatBase * (input.vatRatePct / 100));
  const landedCost = cleanFloat(input.cifRmb + tariff + exciseTotal + vat + input.portFee);
  const deductibleCost = cleanFloat(landedCost - vat);
  const unitCost = cleanFloat(landedCost / input.qty);
  const taxBurdenPct = cleanFloat(((tariff + exciseTotal + vat) / input.cifRmb) * 100);

  const notes: string[] = [
    "进口环节增值税的计税依据里包含消费税——消费税是价内税，先算出消费税再加进增值税的基数。",
    "取得海关进口增值税专用缴款书后，进口环节增值税一般可以抵扣，所以另给一列「可抵扣口径成本」。",
  ];
  if (input.excisePct === 0 && input.exciseUnitRmb === 0) {
    notes.push("当前没有填消费税；如果该商品不属于消费税应税消费品，这是正常的。");
  }
  if (input.qty === 1 && input.exciseUnitRmb === 0) {
    notes.push("数量留空时按 1 计，只影响从量消费税与单件综合成本。");
  }

  const items: LineItem[] = [
    { key: "cif", label: "关税完税价格（CIF）", formula: "输入", value: input.cifRmb, unit: "元", kind: "input" },
    { key: "tariffRate", label: "进口关税税率", formula: "输入", value: input.tariffPct, unit: "%", kind: "input" },
    {
      key: "tariff",
      label: "进口关税",
      formula: `${n(input.cifRmb)} × ${n(input.tariffPct, 2)}%`,
      value: tariff,
      unit: "元",
      star: true,
    },
    { key: "exciseRate", label: "消费税比例税率", formula: "输入", value: input.excisePct, unit: "%", kind: "input" },
    {
      key: "exciseSpecific",
      label: "从量消费税",
      formula: `${n(input.qty, 0)} × ${n(input.exciseUnitRmb, 2)}`,
      value: exciseSpecific,
      unit: "元",
      note: "从量/复合计税的商品（如成品油、卷烟）才有这一项",
    },
    {
      key: "exciseBase",
      label: "消费税组成计税价格",
      formula: `(${n(input.cifRmb)} + ${n(tariff)} + ${n(exciseSpecific)}) ÷ (1 − ${n(input.excisePct, 2)}%)`,
      value: exciseBase,
      unit: "元",
    },
    {
      key: "exciseAdValorem",
      label: "从价消费税",
      formula: `${n(exciseBase)} × ${n(input.excisePct, 2)}%`,
      value: exciseAdValorem,
      unit: "元",
      star: input.excisePct > 0,
    },
    {
      key: "exciseTotal",
      label: "消费税合计",
      formula: `${n(exciseAdValorem)} + ${n(exciseSpecific)}`,
      value: exciseTotal,
      unit: "元",
    },
    { key: "vatRate", label: "进口环节增值税率", formula: "输入", value: input.vatRatePct, unit: "%", kind: "input" },
    {
      key: "vatBase",
      label: "增值税组成计税价格",
      formula: `${n(input.cifRmb)} + ${n(tariff)} + ${n(exciseTotal)}`,
      value: vatBase,
      unit: "元",
    },
    {
      key: "vat",
      label: "进口环节增值税",
      formula: `${n(vatBase)} × ${n(input.vatRatePct, 2)}%`,
      value: vat,
      unit: "元",
      star: true,
    },
    { key: "portFee", label: "港杂费与其他费用", formula: "输入", value: input.portFee, unit: "元", kind: "input" },
    {
      key: "landedCost",
      label: "进口综合成本（含税）",
      formula: `${n(input.cifRmb)} + ${n(tariff)} + ${n(exciseTotal)} + ${n(vat)} + ${n(input.portFee)}`,
      value: landedCost,
      unit: "元",
      kind: "total",
      star: true,
    },
    {
      key: "deductibleCost",
      label: "可抵扣口径成本",
      formula: `${n(landedCost)} − ${n(vat)}`,
      value: deductibleCost,
      unit: "元",
      note: "增值税可抵扣时，真正的进货成本要扣掉进口环节增值税",
    },
    {
      key: "unitCost",
      label: "单件综合成本",
      formula: `${n(landedCost)} ÷ ${n(input.qty, 0)}`,
      value: unitCost,
      unit: "元/件",
    },
    {
      key: "taxBurden",
      label: "综合税负率（对完税价格）",
      formula: `(${n(tariff)} + ${n(exciseTotal)} + ${n(vat)}) ÷ ${n(input.cifRmb)}`,
      value: taxBurdenPct,
      unit: "%",
      digits: 2,
    },
  ];

  return done(items, notes);
}

/* ───────────────────────── 场景 5：运费与费用分摊 ───────────────────────── */

export type AllocBasis = "qty" | "amount" | "volume" | "weight";

export const ALLOC_BASIS_LABEL: Record<AllocBasis, string> = {
  qty: "数量",
  amount: "金额",
  volume: "体积",
  weight: "重量",
};

export const ALLOC_BASIS_UNIT: Record<AllocBasis, string> = {
  qty: "件",
  amount: "元",
  volume: "m³",
  weight: "kg",
};

export interface AllocRow {
  name: string;
  qty: string;
  amount: string;
  volume: string;
  weight: string;
}

export interface AllocInputRow {
  name: string;
  qty: number | null;
  amount: number | null;
  volume: number | null;
  weight: number | null;
}

/**
 * 把一笔总费用按数量 / 金额 / 体积 / 重量分摊到多行货物上。
 *
 * 口径：
 *   某行权重 = 该行在所选中口径下的数值（数量或金额或体积或重量）
 *   分摊金额 = 总费用 × (该行权重 ÷ 权重合计)
 *   单件分摊 = 分摊金额 ÷ 该行数量
 *   按数量口径时，所有行的单件分摊必然相等，等于 总费用 ÷ 总数量（这是自检点）。
 */
export function calcAllocation(rows: AllocInputRow[], basis: AllocBasis, totalFee: number): CalcResult {
  if (rows.length === 0) return notYet("请在左侧至少填一行货物明细");
  if (!(totalFee > 0)) return fail("总费用必须大于 0（要摊的就是它）");

  const basisUnit = ALLOC_BASIS_UNIT[basis];
  const weights = rows.map((row) => row[basis]);
  for (let i = 0; i < rows.length; i += 1) {
    const value = weights[i];
    const name = rows[i].name.trim() === "" ? `第 ${i + 1} 行` : rows[i].name.trim();
    if (value === null) {
      return fail(`「${name}」的${ALLOC_BASIS_LABEL[basis]}还没填，按${ALLOC_BASIS_LABEL[basis]}分摊时每一行都要有值。`);
    }
    if (!(value > 0)) {
      return fail(`「${name}」的${ALLOC_BASIS_LABEL[basis]}必须大于 0（当前 ${n(value, 2)}${basisUnit}）。`);
    }
  }

  const totalWeight = cleanFloat(weights.reduce<number>((sum, value) => sum + (value as number), 0));
  if (!(totalWeight > 0)) return fail(`按${ALLOC_BASIS_LABEL[basis]}分摊时，基数合计必须大于 0。`);

  const totalQty = cleanFloat(
    rows.reduce<number>((sum, row) => sum + (row.qty !== null && row.qty > 0 ? row.qty : 0), 0),
  );

  const items: LineItem[] = [
    { key: "totalFee", label: "待分摊总费用", formula: "输入", value: totalFee, unit: "元", kind: "input" },
    {
      key: "basis",
      label: "分摊口径",
      formula: `按${ALLOC_BASIS_LABEL[basis]}`,
      value: null,
      unit: "",
      kind: "input",
      note: "分摊基数 = 每一行在该口径下的数值",
    },
    {
      key: "totalWeight",
      label: `分摊基数合计（${ALLOC_BASIS_LABEL[basis]}）`,
      formula: weights.map((value) => n(value, 2)).join(" + "),
      value: totalWeight,
      unit: basisUnit,
    },
    {
      key: "avgUnitFee",
      label: "平均单件分摊（按总数量）",
      formula: totalQty > 0 ? `${n(totalFee)} ÷ ${n(totalQty, 2)}` : "未填数量",
      value: totalQty > 0 ? cleanFloat(totalFee / totalQty) : null,
      unit: "元/件",
      star: true,
    },
  ];

  rows.forEach((row, index) => {
    const weight = weights[index] as number;
    const share = cleanFloat(weight / totalWeight);
    const fee = cleanFloat(totalFee * share);
    const name = row.name.trim() === "" ? `第 ${index + 1} 行` : row.name.trim();
    const qty = row.qty !== null && row.qty > 0 ? row.qty : null;
    items.push({
      key: `share:${index}`,
      label: `${name} · 分摊占比`,
      formula: `${n(weight, 2)} ÷ ${n(totalWeight, 2)}`,
      value: cleanFloat(share * 100),
      unit: "%",
      digits: 2,
      kind: "calc",
    });
    items.push({
      key: `fee:${index}`,
      label: `${name} · 应摊费用`,
      formula: `${n(totalFee)} × ${n(share * 100, 4)}%`,
      value: fee,
      unit: "元",
      kind: "calc",
    });
    items.push({
      key: `unit:${index}`,
      label: `${name} · 单件分摊`,
      formula: qty !== null ? `${n(fee)} ÷ ${n(qty, 2)}` : "该行未填数量",
      value: qty !== null ? cleanFloat(fee / qty) : null,
      unit: "元/件",
      kind: "calc",
    });
  });

  const notes: string[] = [
    "占比按各行权重除以权重合计计算，四舍五入后各行占比之和可能与被除的总额差 0.01%，属正常。",
  ];
  if (basis === "qty") {
    notes.push("按数量分摊时每行的单件分摊应该完全相同——如果不一样，说明有些行没填数量。");
  }
  if (totalQty === 0) {
    notes.push("所有行的数量都空着，所以算不出单件分摊；补上数量即可。");
  }

  return done(items, notes);
}

/* ───────────────────────── 报价单汇总 ───────────────────────── */

export interface SummarySection {
  title: string;
  items: LineItem[];
  /** 该场景没能算出结果时的原因，界面上要说明为什么缺了一段 */
  skipped?: string;
}

/** 把各场景的明细拼成一张可直接贴进邮件的文本报价单 */
export function summaryToText(
  sections: SummarySection[],
  opts?: { digits?: number; stamp?: string },
): string {
  const digits = opts?.digits ?? 2;
  const lines: string[] = ["进出口贸易分项明细"];
  if (opts?.stamp) lines.push(`生成时间：${opts.stamp}`);
  for (const section of sections) {
    lines.push("", `【${section.title}】`);
    if (section.items.length === 0) {
      lines.push(`· （未计算：${section.skipped ?? "缺少输入"}）`);
      continue;
    }
    for (const item of section.items) {
      const value = item.value === null ? "—" : `${formatNumber(item.value, item.digits ?? digits)}${item.unit}`;
      lines.push(`· ${item.label}：${value}${item.formula && item.formula !== "输入" ? `（${item.formula}）` : ""}`);
    }
  }
  return lines.join("\n");
}

/* ===== CORE:END ===== */

/* ───────────────────────────── 界面 ───────────────────────────── */

const TOOL_ID = "trade-calculator";

type ScenarioId = "unit-price" | "quote" | "cost" | "import" | "freight" | "summary";

interface ScenarioMeta {
  id: ScenarioId;
  label: string;
  icon: LucideIcon;
  /** 空状态里的一句引导 */
  hint: string;
}

const SCENARIOS: ScenarioMeta[] = [
  {
    id: "unit-price",
    label: "单价与税额",
    icon: Receipt,
    hint: "填「不含税单价 + 数量 + 增值税率」，得到含税单价、增值税额与价税合计；也可以反过来由含税价倒推。",
  },
  {
    id: "quote",
    label: "报价换算",
    icon: Ship,
    hint: "填你手上那个价（FOB / CFR / CIF 任选）+ 运费与保险费率，换算出另外两个条件价，并可叠加佣金。",
  },
  {
    id: "cost",
    label: "成本与利润",
    icon: TrendingUp,
    hint: "填采购含税总额、退税率、出口美元销售额与汇率，得到退税、出口总成本、换汇成本与利润率。",
  },
  {
    id: "import",
    label: "进口环节税",
    icon: Landmark,
    hint: "填关税完税价格（CIF 人民币价）与关税率，得到关税、消费税、进口环节增值税与进口综合成本。",
  },
  {
    id: "freight",
    label: "运费分摊",
    icon: Scale,
    hint: "填一笔总费用和几行货物的数量/金额/体积/重量，按选定口径摊到每一行。",
  },
  {
    id: "summary",
    label: "报价单汇总",
    icon: FileText,
    hint: "前面几个场景填过的内容会自动汇总到这里，可一键复制成报价邮件用的文本。",
  },
];

interface FormulaNote {
  expr: string;
  note: string;
}

const FORMULA_NOTES: Record<Exclude<ScenarioId, "summary">, FormulaNote[]> = {
  "unit-price": [
    { expr: "含税单价 = 不含税单价 × (1 + 增值税率)", note: "增值税暂行条例：销售额为不含税销售额，含税销售额 = 不含税 × (1 + 税率)。" },
    { expr: "不含税单价 = 含税单价 ÷ (1 + 增值税率)", note: "倒推用除法，不是「含税 × (1 − 税率)」，后者会算少。" },
    { expr: "增值税额 = 不含税金额 × 增值税率", note: "对同一次交易，税额也等于「价税合计 − 不含税金额」。" },
    { expr: "数量 = 不含税总金额 ÷ 不含税单价", note: "反推数量；除不尽时优先按实际整数数量重算金额。" },
    { expr: "现行税率", note: "一般纳税人：13%（多数货物）/ 9%（农产品、交通运输等）/ 6%（现代服务）；小规模纳税人征收率 3%，阶段性减按 1%。出口货物适用零税率并按规定退税。" },
    { expr: "附加系数", note: "旧版外贸预设里的 1.03（辅料/加价系数）作为可选系数保留，默认 1；它不是税率，会同时放大税额。" },
  ],
  quote: [
    { expr: "CFR = FOB + 国际运费", note: "Incoterms：CFR 比 FOB 多承担海运费，不含保险。" },
    { expr: "保险金额 = CIF × 投保加成", note: "惯例按发票金额加成 10% 投保，即保险金额 = CIF × 110%。" },
    { expr: "保险费 = 保险金额 × 保险费率 = CIF × 投保加成 × 保险费率", note: "这是把保险算进价格后的自洽写法。" },
    { expr: "CIF = (FOB + 运费) ÷ (1 − 投保加成 × 保险费率)", note: "由 CIF = CFR + 保险费 反解得到。分母里的「投保加成」是系数（110% → 1.1）；如果按加成率 10% 填，系数就是 1 + 10%。" },
    { expr: "含佣价 = 净价 ÷ (1 − 佣金率)", note: "佣金按最终成交价（发票金额）计收，所以净价 = 含佣价 × (1 − 佣金率)。" },
    { expr: "明佣 / 暗佣", note: "金额完全相同，区别只在佣金是否在报价单、发票上明示——暗佣由卖方事后另付。" },
    { expr: "加价与折扣", note: "先作用在你填的基础报价上，再换算三个条件价，避免口径来回打架。" },
  ],
  cost: [
    { expr: "不含税采购额 = 含税采购额 ÷ (1 + 征税率)", note: "价税分离公式，退税基数就是它。" },
    { expr: "出口退税 = 不含税采购额 × 退税率", note: "外贸企业出口实行免退税办法，应退税额 = 增值税专用发票不含税金额 × 退税率。" },
    { expr: "出口总成本（退税后）= 含税采购额 − 出口退税 + 国内费用", note: "国内费用含内陆运费、报关、商检、银行费用等。" },
    { expr: "换汇成本 = 出口总成本 ÷ 外汇净收入（美元）", note: "每换回 1 美元花掉多少人民币；低于结汇汇率才赚钱。" },
    { expr: "盈亏平衡汇率 = 出口总成本 ÷ 出口销售额", note: "令收入 = 成本解出的汇率，数值上恒等于换汇成本。" },
    { expr: "成本利润率 = 利润 ÷ 出口总成本；销售利润率 = 利润 ÷ 结汇收入", note: "分母不同结论不同，报价谈判时要说清用的是哪一个。" },
    { expr: "保本 FOB 报价 = 出口总成本 ÷ 汇率", note: "低于它的美元报价就是亏本接单。" },
  ],
  import: [
    { expr: "进口关税 = 关税完税价格 × 关税税率", note: "从价关税；完税价格通常就是 CIF 价。" },
    { expr: "消费税组成计税价格 = (完税价格 + 关税 + 从量消费税) ÷ (1 − 消费税比例税率)", note: "消费税是价内税，所以要除以 (1 − 税率) 把它还原进价格。" },
    { expr: "从价消费税 = 组成计税价格 × 消费税比例税率；复合计税再加从量部分", note: "成品油等从量计征，卷烟等复合计征。" },
    { expr: "进口环节增值税 = (完税价格 + 关税 + 消费税) × 增值税率", note: "增值税暂行条例第十四条；计税依据里含消费税。" },
    { expr: "进口综合成本 = 完税价格 + 关税 + 消费税 + 增值税 + 港杂费", note: "取得海关缴款书后增值税一般可抵扣，故另列「可抵扣口径成本」。" },
    { expr: "现行税率参考", note: "进口环节增值税 13%（部分民生商品 9%）；关税按 HS 编码，最惠国税率差异很大（2024 年关税总水平约 7.3%），默认值仅示例。" },
  ],
  freight: [
    { expr: "分摊基数 = 各行在所选口径下的数值合计", note: "口径可选数量、金额、体积、重量——按金额摊适合高价值货，按体积/重量摊适合泡货重货。" },
    { expr: "应摊费用 = 总费用 × (该行基数 ÷ 基数合计)", note: "占比四舍五入后各行相加可能有 0.01 的尾差。" },
    { expr: "单件分摊 = 应摊费用 ÷ 该行数量", note: "按数量分摊时各行单件分摊必然相等，可用来自检。" },
    { expr: "反推单件成本", note: "已知总运费时，平均单件分摊 = 总费用 ÷ 总数量，就是「反推」的那一项。" },
  ],
};

/** 行明细的初始态：一行空的，等用户填或点「填入示例」 */
const EMPTY_ALLOC_ROW: AllocRow = { name: "", qty: "", amount: "", volume: "", weight: "" };

const SAMPLE_ALLOC_ROWS: AllocRow[] = [
  { name: "A 型保温杯", qty: "1000", amount: "20000", volume: "2", weight: "180" },
  { name: "B 型保温壶", qty: "2000", amount: "30000", volume: "3", weight: "420" },
  { name: "C 型旅行壶", qty: "3000", amount: "50000", volume: "5", weight: "700" },
];

const MONEY_DIGITS_OPTIONS = [
  { value: "0", label: "0 位" },
  { value: "2", label: "2 位" },
  { value: "3", label: "3 位" },
  { value: "4", label: "4 位" },
];

const RATE_DIGITS_OPTIONS = [
  { value: "4", label: "4 位" },
  { value: "5", label: "5 位" },
  { value: "6", label: "6 位" },
];

const VAT_RATE_OPTIONS = [
  { value: "13", label: "13%（多数货物）" },
  { value: "9", label: "9%（农产品、交通运输等）" },
  { value: "6", label: "6%（现代服务）" },
  { value: "3", label: "3%（小规模征收率）" },
  { value: "1", label: "1%（小规模减按）" },
];

/** 参数区的字段外壳 */
function Field({
  label,
  unit,
  hint,
  children,
}: {
  label: string;
  unit?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Label>{label}</Label>
        {unit ? <span className="font-mono-accent text-[10px] text-muted-foreground">{unit}</span> : null}
      </div>
      {children}
      {hint ? <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

/** 统一的错误提示（与全站其它工具同款） */
function ErrorNote({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border-l-4 border-l-destructive bg-destructive/10 px-4 py-3 font-mono text-xs text-destructive">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      {message}
    </div>
  );
}

function CopyButton({ text, label = "复制明细" }: { text: string; label?: string }) {
  const [state, setState] = React.useState<"idle" | "done" | "fail">("idle");
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("done");
    } catch {
      setState("fail");
    }
    setTimeout(() => setState("idle"), 1800);
  };
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={copy}
      disabled={text.trim() === "" || state === "fail"}
    >
      {state === "done" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {state === "fail" ? "请手动复制" : state === "done" ? "已复制" : label}
    </Button>
  );
}

/** 关键结果条 */
function KeyStrip({ items, digits }: { items: LineItem[]; digits: number }) {
  if (items.length === 0) return null;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
      {items.map((item) => (
        <div key={item.key} className="rounded-xl border border-primary/20 bg-primary/[0.06] px-3.5 py-3">
          <div className="text-[11px] leading-tight text-muted-foreground">{item.label}</div>
          <div className="mt-1 font-mono-accent text-[15px] font-semibold leading-tight text-foreground">
            {formatNumber(item.value, item.digits ?? digits)}
            {item.unit ? <span className="ml-1 text-[11px] font-normal text-muted-foreground">{item.unit}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

/** 明细表：项目 / 计算式 / 金额，金额右对齐 */
function DetailTable({
  title,
  items,
  digits,
  actions,
  sections,
}: {
  title: string;
  items?: LineItem[];
  digits: number;
  actions?: React.ReactNode;
  sections?: SummarySection[];
}) {
  const isEmpty = sections ? sections.every((section) => section.items.length === 0) : (items ?? []).length === 0;

  const renderRow = (item: LineItem) => (
    <tr key={item.key} className="border-t border-border/40 even:bg-muted/20">
      <td className="px-5 py-2 align-top">
        <span className={cn("text-xs", item.star ? "font-medium text-primary" : "text-foreground")}>{item.label}</span>
        {item.note ? (
          <span className="mt-0.5 block text-[10px] leading-relaxed text-muted-foreground">{item.note}</span>
        ) : null}
      </td>
      <td className="px-3 py-2 align-top">
        <span className="font-mono-accent text-[11px] leading-relaxed text-muted-foreground">{item.formula}</span>
      </td>
      <td className="whitespace-nowrap px-5 py-2 text-right align-top">
        {item.value === null ? (
          <span className="text-muted-foreground">—</span>
        ) : (
          <>
            <span className="font-mono-accent text-xs tabular-nums text-foreground">
              {formatNumber(item.value, item.digits ?? digits)}
            </span>
            {item.unit ? <span className="ml-1 text-[10px] text-muted-foreground">{item.unit}</span> : null}
          </>
        )}
      </td>
    </tr>
  );

  return (
    <div className="overflow-hidden rounded-2xl border border-border/70 bg-card/60 shadow-xs backdrop-blur-md">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 px-5 py-3">
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {actions}
      </div>
      {isEmpty ? (
        <p className="px-5 py-6 text-center text-xs text-muted-foreground">还没有可显示的分项，先填左侧参数。</p>
      ) : (
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full border-collapse text-left">
            <thead>
              <tr className="font-mono-accent text-[10px] uppercase tracking-widest text-muted-foreground">
                <th className="px-5 py-2.5 font-medium">项目</th>
                <th className="px-3 py-2.5 font-medium">计算式</th>
                <th className="px-5 py-2.5 text-right font-medium">金额</th>
              </tr>
            </thead>
            <tbody>
              {sections
                ? sections.map((section) => (
                    <React.Fragment key={section.title}>
                      <tr className="border-t border-border/40 bg-muted/30">
                        <td colSpan={3} className="px-5 py-2 text-[11px] font-semibold text-foreground">
                          {section.title}
                          {section.items.length === 0 ? (
                            <span className="ml-2 font-normal text-muted-foreground">
                              未计算：{section.skipped ?? "缺少输入"}
                            </span>
                          ) : null}
                        </td>
                      </tr>
                      {section.items.map(renderRow)}
                    </React.Fragment>
                  ))
                : (items ?? []).map(renderRow)}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** 「公式与口径」卡片 */
function FormulaCard({ notes, extra }: { notes: FormulaNote[]; extra?: string[] }) {
  return (
    <div className="space-y-3 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-xs backdrop-blur-md">
      <h3 className="text-sm font-semibold text-foreground">公式与口径</h3>
      <ul className="space-y-2.5">
        {notes.map((note) => (
          <li key={note.expr} className="space-y-0.5">
            <div className="font-mono-accent text-[11px] leading-relaxed text-primary">{note.expr}</div>
            <div className="text-[11px] leading-relaxed text-muted-foreground">{note.note}</div>
          </li>
        ))}
      </ul>
      {extra && extra.length > 0 ? (
        <div className="space-y-1.5 border-t border-border/40 pt-3">
          {extra.map((line) => (
            <p key={line} className="text-[11px] leading-relaxed text-muted-foreground">
              · {line}
            </p>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** 空状态引导 */
function EmptyGuide({ hint, onFill }: { hint: string; onFill: () => void }) {
  return (
    <div className="rounded-2xl border border-dashed border-border/70 bg-card/40 p-8 text-center">
      <Sparkles className="mx-auto h-5 w-5 text-primary" />
      <p className="mt-3 text-sm text-foreground">左侧还空着</p>
      <p className="mx-auto mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">{hint}</p>
      <Button type="button" size="sm" className="mt-4" onClick={onFill}>
        <Sparkles className="h-3.5 w-3.5" />
        填入示例
      </Button>
    </div>
  );
}

function AllocRowEditor({
  rows,
  onChange,
}: {
  rows: AllocRow[];
  onChange: (rows: AllocRow[]) => void;
}) {
  const patch = (index: number, key: keyof AllocRow, value: string) => {
    onChange(rows.map((row, i) => (i === index ? { ...row, [key]: value } : row)));
  };
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <Label>货物明细行</Label>
        <div className="flex gap-1.5">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onChange([...rows, { ...EMPTY_ALLOC_ROW }])}
          >
            <Plus className="h-3.5 w-3.5" />
            加一行
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={rows.length === 0}
            onClick={() => onChange(rows.slice(0, -1))}
          >
            <Trash2 className="h-3.5 w-3.5" />
            删末行
          </Button>
        </div>
      </div>
      {rows.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">还没有明细行，点「加一行」或顶部的「填入示例」。</p>
      ) : (
        <div className="space-y-3">
          {rows.map((row, index) => (
            <div key={index} className="space-y-2 rounded-xl border border-border/50 bg-background/40 p-3">
              <div className="flex items-center gap-2">
                <span className="font-mono-accent text-[10px] text-muted-foreground">#{index + 1}</span>
                <Input
                  className="h-9"
                  value={row.name}
                  placeholder="品名（可不填）"
                  onChange={(event) => patch(index, "name", event.target.value)}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input
                  className="h-9"
                  inputMode="decimal"
                  value={row.qty}
                  placeholder="数量 件"
                  onChange={(event) => patch(index, "qty", event.target.value)}
                />
                <Input
                  className="h-9"
                  inputMode="decimal"
                  value={row.amount}
                  placeholder="金额 元"
                  onChange={(event) => patch(index, "amount", event.target.value)}
                />
                <Input
                  className="h-9"
                  inputMode="decimal"
                  value={row.volume}
                  placeholder="体积 m³"
                  onChange={(event) => patch(index, "volume", event.target.value)}
                />
                <Input
                  className="h-9"
                  inputMode="decimal"
                  value={row.weight}
                  placeholder="重量 kg"
                  onChange={(event) => patch(index, "weight", event.target.value)}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TradeCalculatorTool() {
  const { toast } = useToast();

  // ── 选项与显示 ──
  const [tab, setTab] = useToolDraft<ScenarioId>(TOOL_ID, "tab", "unit-price");
  const [digitsRaw, setDigitsRaw] = useToolDraft(TOOL_ID, "digits", "2");
  const [rateDigitsRaw, setRateDigitsRaw] = useToolDraft(TOOL_ID, "rateDigits", "4");
  const digits = Number(digitsRaw) || 2;
  const rateDigits = Number(rateDigitsRaw) || 4;

  // ── 场景 1：单价与税额 ──
  const [upMode, setUpMode] = useToolDraft<UnitPriceMode>(TOOL_ID, "upMode", "notaxToTax");
  const [upNotaxUnit, setUpNotaxUnit] = useToolDraft(TOOL_ID, "upNotaxUnit", "");
  const [upTaxUnit, setUpTaxUnit] = useToolDraft(TOOL_ID, "upTaxUnit", "");
  const [upQty, setUpQty] = useToolDraft(TOOL_ID, "upQty", "");
  const [upTotalNotax, setUpTotalNotax] = useToolDraft(TOOL_ID, "upTotalNotax", "");
  const [upVatRate, setUpVatRate] = useToolDraft(TOOL_ID, "upVatRate", "13");
  const [upFactor, setUpFactor] = useToolDraft(TOOL_ID, "upFactor", "1");

  // ── 场景 2：报价换算 ──
  const [qBase, setQBase] = useToolDraft<QuoteBase>(TOOL_ID, "qBase", "fob");
  const [qAmount, setQAmount] = useToolDraft(TOOL_ID, "qAmount", "");
  const [qFreight, setQFreight] = useToolDraft(TOOL_ID, "qFreight", "0");
  const [qInsRate, setQInsRate] = useToolDraft(TOOL_ID, "qInsRate", "0.8");
  const [qMarkupMode, setQMarkupMode] = useToolDraft<MarkupMode>(TOOL_ID, "qMarkupMode", "coef");
  const [qMarkup, setQMarkup] = useToolDraft(TOOL_ID, "qMarkup", "110");
  const [qCommissionType, setQCommissionType] = useToolDraft<CommissionType>(TOOL_ID, "qCommissionType", "none");
  const [qCommission, setQCommission] = useToolDraft(TOOL_ID, "qCommission", "0");
  const [qMarkupUp, setQMarkupUp] = useToolDraft(TOOL_ID, "qMarkupUp", "0");
  const [qDiscount, setQDiscount] = useToolDraft(TOOL_ID, "qDiscount", "0");

  // ── 场景 3：成本与利润 ──
  const [cExportUsd, setCExportUsd] = useToolDraft(TOOL_ID, "cExportUsd", "");
  const [cRate, setCRate] = useToolDraft(TOOL_ID, "cRate", "7.25");
  const [cCostWithTax, setCCostWithTax] = useToolDraft(TOOL_ID, "cCostWithTax", "");
  const [cVatRate, setCVatRate] = useToolDraft(TOOL_ID, "cVatRate", "13");
  const [cRebateRate, setCRebateRate] = useToolDraft(TOOL_ID, "cRebateRate", "13");
  const [cDomesticFee, setCDomesticFee] = useToolDraft(TOOL_ID, "cDomesticFee", "0");
  const [cTargetMargin, setCTargetMargin] = useToolDraft(TOOL_ID, "cTargetMargin", "10");

  // ── 场景 4：进口环节税 ──
  const [iCif, setICif] = useToolDraft(TOOL_ID, "iCif", "");
  const [iTariffRate, setITariffRate] = useToolDraft(TOOL_ID, "iTariffRate", "8");
  const [iExciseRate, setIExciseRate] = useToolDraft(TOOL_ID, "iExciseRate", "0");
  const [iExciseUnit, setIExciseUnit] = useToolDraft(TOOL_ID, "iExciseUnit", "0");
  const [iQty, setIQty] = useToolDraft(TOOL_ID, "iQty", "");
  const [iVatRate, setIVatRate] = useToolDraft(TOOL_ID, "iVatRate", "13");
  const [iPortFee, setIPortFee] = useToolDraft(TOOL_ID, "iPortFee", "0");

  // ── 场景 5：运费分摊 ──
  const [aFee, setAFee] = useToolDraft(TOOL_ID, "aFee", "");
  const [aBasis, setABasis] = useToolDraft<AllocBasis>(TOOL_ID, "aBasis", "qty");
  const [aRows, setARows] = useToolDraft<AllocRow[]>(TOOL_ID, "aRows", [{ ...EMPTY_ALLOC_ROW }]);

  /* ── 解析与校验 ── */
  const upNotaxUnitP = parseNumberField(upNotaxUnit, { label: "不含税单价", positive: true, unit: "元" });
  const upTaxUnitP = parseNumberField(upTaxUnit, { label: "含税单价", positive: true, unit: "元" });
  const upQtyP = parseNumberField(upQty, { label: "数量", positive: true });
  const upTotalNotaxP = parseNumberField(upTotalNotax, { label: "不含税总金额", positive: true, unit: "元" });
  const upVatRateP = parseNumberField(upVatRate, { label: "增值税率", min: 0, max: 100, unit: "%" });
  const upFactorP = parseNumberField(upFactor, { label: "附加系数", positive: true });

  const qAmountP = parseNumberField(qAmount, { label: "基础报价金额", positive: true, unit: "USD" });
  const qFreightP = parseNumberField(qFreight, { label: "国际运费", min: 0, unit: "USD" });
  const qInsRateP = parseNumberField(qInsRate, { label: "保险费率", min: 0, max: 100, unit: "%" });
  const qMarkupP = parseNumberField(qMarkup, {
    label: qMarkupMode === "coef" ? "投保加成系数" : "投保加成率",
    min: 0,
    max: 1000,
    unit: "%",
  });
  const qCommissionP = parseNumberField(qCommission, { label: "佣金率", min: 0, max: 99, unit: "%" });
  const qMarkupUpP = parseNumberField(qMarkupUp, { label: "报价加价率", min: 0, max: 1000, unit: "%" });
  const qDiscountP = parseNumberField(qDiscount, { label: "折扣率", min: 0, max: 99.99, unit: "%" });

  const cExportUsdP = parseNumberField(cExportUsd, { label: "出口销售额", positive: true, unit: "USD" });
  const cRateP = parseNumberField(cRate, { label: "结汇汇率", positive: true, unit: "CNY/USD" });
  const cCostWithTaxP = parseNumberField(cCostWithTax, { label: "国内含税采购总额", positive: true, unit: "元" });
  const cVatRateP = parseNumberField(cVatRate, { label: "进项增值税率", min: 0, max: 100, unit: "%" });
  const cRebateRateP = parseNumberField(cRebateRate, { label: "出口退税率", min: 0, max: 100, unit: "%" });
  const cDomesticFeeP = parseNumberField(cDomesticFee, { label: "国内费用", min: 0, unit: "元" });
  const cTargetMarginP = parseNumberField(cTargetMargin, { label: "目标利润率", min: 0, max: 1000, unit: "%" });

  const iCifP = parseNumberField(iCif, { label: "关税完税价格", positive: true, unit: "元" });
  const iTariffRateP = parseNumberField(iTariffRate, { label: "进口关税税率", min: 0, max: 100, unit: "%" });
  const iExciseRateP = parseNumberField(iExciseRate, { label: "消费税比例税率", min: 0, max: 99.99, unit: "%" });
  const iExciseUnitP = parseNumberField(iExciseUnit, { label: "从量消费税单位税额", min: 0, unit: "元" });
  const iQtyP = parseNumberField(iQty, { label: "数量", positive: true });
  const iVatRateP = parseNumberField(iVatRate, { label: "进口环节增值税率", min: 0, max: 100, unit: "%" });
  const iPortFeeP = parseNumberField(iPortFee, { label: "港杂费", min: 0, unit: "元" });

  const aFeeP = parseNumberField(aFee, { label: "总费用", positive: true, unit: "元" });

  const allocInputRows: AllocInputRow[] = aRows
    .filter(
      (row) =>
        row.name.trim() !== "" ||
        row.qty.trim() !== "" ||
        row.amount.trim() !== "" ||
        row.volume.trim() !== "" ||
        row.weight.trim() !== "",
    )
    .map((row) => ({
      name: row.name,
      qty: parsedValue(parseNumberField(row.qty, { label: "数量", min: 0 })),
      amount: parsedValue(parseNumberField(row.amount, { label: "金额", min: 0 })),
      volume: parsedValue(parseNumberField(row.volume, { label: "体积", min: 0 })),
      weight: parsedValue(parseNumberField(row.weight, { label: "重量", min: 0 })),
    }));
  const allocRowErrors: string[] = [];
  aRows.forEach((row, index) => {
    const label = row.name.trim() === "" ? `第 ${index + 1} 行` : `「${row.name.trim()}」`;
    (["qty", "amount", "volume", "weight"] as const).forEach((key) => {
      const raw = row[key];
      if (raw.trim() === "") return;
      const parsed = parseNumberField(raw, { label: `${label}的${ALLOC_BASIS_LABEL[key]}`, min: 0 });
      if (parsed.state === "error") allocRowErrors.push(parsed.message);
    });
  });

  /* ── 五个场景的计算（每次都算，汇总页要用） ── */
  const unitPriceResult = calcUnitPrice({
    mode: upMode,
    notaxUnit: parsedValue(upNotaxUnitP),
    taxUnit: parsedValue(upTaxUnitP),
    qty: parsedValue(upQtyP),
    totalNotax: parsedValue(upTotalNotaxP),
    vatRatePct: parsedOr(upVatRateP, 13),
    extraFactor: parsedOr(upFactorP, 1),
  });
  const quoteResult = calcQuote({
    base: qBase,
    amount: parsedValue(qAmountP),
    freight: parsedOr(qFreightP, 0),
    insuranceRatePct: parsedOr(qInsRateP, 0.8),
    markupMode: qMarkupMode,
    markupValue: parsedOr(qMarkupP, qMarkupMode === "coef" ? 110 : 10),
    commissionType: qCommissionType,
    commissionPct: parsedOr(qCommissionP, 0),
    markupUpPct: parsedOr(qMarkupUpP, 0),
    discountPct: parsedOr(qDiscountP, 0),
  });
  const costResult = calcExportCost({
    exportUsd: parsedValue(cExportUsdP),
    rate: parsedOr(cRateP, 0),
    costWithTax: parsedValue(cCostWithTaxP),
    vatRatePct: parsedOr(cVatRateP, 13),
    rebateRatePct: parsedOr(cRebateRateP, 13),
    domesticFee: parsedOr(cDomesticFeeP, 0),
    targetMarginPct: parsedOr(cTargetMarginP, 0),
  });
  const importResult = calcImportTax({
    cifRmb: parsedValue(iCifP),
    tariffPct: parsedOr(iTariffRateP, 0),
    excisePct: parsedOr(iExciseRateP, 0),
    exciseUnitRmb: parsedOr(iExciseUnitP, 0),
    qty: parsedOr(iQtyP, 1),
    vatRatePct: parsedOr(iVatRateP, 13),
    portFee: parsedOr(iPortFeeP, 0),
  });
  const allocResult = calcAllocation(allocInputRows, aBasis, parsedOr(aFeeP, 0));

  const scenarioResult: Record<Exclude<ScenarioId, "summary">, CalcResult> = {
    "unit-price": unitPriceResult,
    quote: quoteResult,
    cost: costResult,
    import: importResult,
    freight: allocResult,
  };

  /** 把一组解析结果里「填错了」的提示抽出来（没填的不算错） */
  const messagesOf = (list: ParseResult[]): string[] =>
    list.flatMap((result) => (result.state === "error" ? [result.message] : []));

  /** 当前场景自己的解析错误（比计算错误优先显示，因为它是「填错了」而不是「还没填」） */
  const parseErrors: Record<Exclude<ScenarioId, "summary">, string[]> = {
    "unit-price": messagesOf([upNotaxUnitP, upTaxUnitP, upQtyP, upTotalNotaxP, upVatRateP, upFactorP]),
    quote: messagesOf([qAmountP, qFreightP, qInsRateP, qMarkupP, qCommissionP, qMarkupUpP, qDiscountP]),
    cost: messagesOf([cExportUsdP, cRateP, cCostWithTaxP, cVatRateP, cRebateRateP, cDomesticFeeP, cTargetMarginP]),
    import: messagesOf([iCifP, iTariffRateP, iExciseRateP, iExciseUnitP, iQtyP, iVatRateP, iPortFeeP]),
    freight: [...messagesOf([aFeeP]), ...allocRowErrors],
  };

  /* ── 汇总 ── */
  const summarySections: SummarySection[] = (
    ["unit-price", "quote", "cost", "import", "freight"] as const
  ).map((id) => {
    const meta = SCENARIOS.find((s) => s.id === id)!;
    const result = scenarioResult[id];
    if (result.ok) return { title: meta.label, items: result.items };
    return { title: meta.label, items: [], skipped: result.error };
  });

  const activeMeta = SCENARIOS.find((s) => s.id === tab) ?? SCENARIOS[0];
  const activeId = activeMeta.id;

  const currentResult: CalcResult | null = activeId === "summary" ? null : scenarioResult[activeId];
  const currentParseError: string | null =
    activeId === "summary" ? null : (parseErrors[activeId][0] ?? null);
  const currentNotes: string[] =
    activeId === "summary" || !currentResult || !currentResult.ok ? [] : currentResult.notes;
  const currentItems: LineItem[] = currentResult && currentResult.ok ? currentResult.items : [];
  const starItems = currentItems.filter((item) => item.star).slice(0, 4);
  const showGuide =
    activeId !== "summary" && !currentParseError && currentResult !== null && !currentResult.ok && currentResult.missing;
  const currentError =
    activeId === "summary" || !currentResult || currentResult.ok || currentResult.missing ? null : currentResult.error;

  /* ── 操作 ── */
  const fillSample = (id: ScenarioId) => {
    if (id === "unit-price") {
      setUpMode("notaxToTax");
      setUpNotaxUnit("25");
      setUpQty("4000");
      setUpVatRate("13");
      setUpFactor("1");
      setUpTotalNotax("100000");
    } else if (id === "quote") {
      setQBase("fob");
      setQAmount("50000");
      setQFreight("3500");
      setQInsRate("0.8");
      setQMarkupMode("coef");
      setQMarkup("110");
      setQCommissionType("explicit");
      setQCommission("5");
      setQMarkupUp("0");
      setQDiscount("0");
    } else if (id === "cost") {
      setCExportUsd("20000");
      setCRate("7.25");
      setCCostWithTax("113000");
      setCVatRate("13");
      setCRebateRate("13");
      setCDomesticFee("5000");
      setCTargetMargin("10");
    } else if (id === "import") {
      setICif("1000000");
      setITariffRate("10");
      setIExciseRate("0");
      setIExciseUnit("0");
      setIQty("1");
      setIVatRate("13");
      setIPortFee("2000");
    } else if (id === "freight") {
      setAFee("6000");
      setABasis("qty");
      setARows(SAMPLE_ALLOC_ROWS.map((row) => ({ ...row })));
    } else {
      // 汇总页：把五个场景一次填满，方便直接看整张报价单
      fillSample("unit-price");
      fillSample("quote");
      fillSample("cost");
      fillSample("import");
      fillSample("freight");
    }
    toast({ title: "已填入示例数据", description: "可以直接改数字看结果变化", variant: "info" });
  };

  const clearAll = () => {
    setTab("unit-price");
    setUpMode("notaxToTax");
    setUpNotaxUnit("");
    setUpTaxUnit("");
    setUpQty("");
    setUpTotalNotax("");
    setUpVatRate("13");
    setUpFactor("1");
    setQBase("fob");
    setQAmount("");
    setQFreight("0");
    setQInsRate("0.8");
    setQMarkupMode("coef");
    setQMarkup("110");
    setQCommissionType("none");
    setQCommission("0");
    setQMarkupUp("0");
    setQDiscount("0");
    setCExportUsd("");
    setCRate("7.25");
    setCCostWithTax("");
    setCVatRate("13");
    setCRebateRate("13");
    setCDomesticFee("0");
    setCTargetMargin("10");
    setICif("");
    setITariffRate("8");
    setIExciseRate("0");
    setIExciseUnit("0");
    setIQty("");
    setIVatRate("13");
    setIPortFee("0");
    setAFee("");
    setABasis("qty");
    setARows([{ ...EMPTY_ALLOC_ROW }]);
    toast({ title: "已清空", description: "所有场景回到初始状态", variant: "info" });
  };

  const copyText = summaryToText(summarySections, {
    digits,
    stamp: new Date().toLocaleString("zh-CN", { hour12: false }),
  });

  const unitModeLabel: Record<UnitPriceMode, string> = {
    notaxToTax: "不含税 → 含税",
    taxToNotax: "含税 → 不含税",
    reverseQty: "总额 + 单价 → 数量",
  };

  return (
    <div className="space-y-5">
      {/* 顶部操作条：只有控件，没有工具名与描述 */}
      <div className="rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span className="flex items-center gap-1.5 text-xs font-medium text-foreground">
            <ArrowLeftRight className="h-3.5 w-3.5 text-primary" />
            出口 / 进口双向核算
          </span>
          <span className="text-[11px] text-muted-foreground">
            金额统一千分位显示，税额与成本按现行税率默认值起算，可随时改
          </span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5">
              <Label className="whitespace-nowrap">金额小数位</Label>
              <Select
                className="w-[92px]"
                value={digitsRaw}
                onChange={(event) => setDigitsRaw(event.target.value)}
              >
                {MONEY_DIGITS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </span>
            <span className="flex items-center gap-1.5">
              <Label className="whitespace-nowrap">汇率小数位</Label>
              <Select
                className="w-[92px]"
                value={rateDigitsRaw}
                onChange={(event) => setRateDigitsRaw(event.target.value)}
              >
                {RATE_DIGITS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </span>
            <Button type="button" size="sm" onClick={() => fillSample(activeId)}>
              <Sparkles className="h-3.5 w-3.5" />
              填入示例
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={clearAll}>
              <RotateCcw className="h-3.5 w-3.5" />
              清空
            </Button>
          </div>
        </div>

        <div className="thin-scroll mt-3 flex gap-1.5 overflow-x-auto pb-0.5">
          {SCENARIOS.map((scenario) => {
            const Icon = scenario.icon;
            const active = scenario.id === activeId;
            const result = scenario.id === "summary" ? null : scenarioResult[scenario.id];
            return (
              <button
                key={scenario.id}
                type="button"
                onClick={() => setTab(scenario.id)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-1.5 text-xs transition-colors",
                  active
                    ? "border-primary/40 bg-primary/15 font-medium text-primary"
                    : "border-border/60 bg-card/60 text-muted-foreground hover:border-border hover:text-foreground",
                )}
              >
                <Icon className="h-3.5 w-3.5" />
                {scenario.label}
                {result && result.ok ? (
                  <span className="font-mono-accent text-[10px] text-primary/80">
                    {result.items.length}
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-12">
        {/* 左：参数 */}
        <div className="space-y-4 lg:col-span-4">
          <div className="space-y-4 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-xs backdrop-blur-md">
            <h3 className="text-sm font-semibold text-foreground">{activeMeta.label}</h3>

            {activeId === "unit-price" ? (
              <div className="space-y-4">
                <Field label="换算方向">
                  <Select value={upMode} onChange={(event) => setUpMode(event.target.value as UnitPriceMode)}>
                    {(Object.keys(unitModeLabel) as UnitPriceMode[]).map((mode) => (
                      <option key={mode} value={mode}>
                        {unitModeLabel[mode]}
                      </option>
                    ))}
                  </Select>
                </Field>
                {upMode === "notaxToTax" ? (
                  <Field label="不含税单价" unit="元">
                    <Input
                      inputMode="decimal"
                      value={upNotaxUnit}
                      placeholder="例如 25"
                      onChange={(event) => setUpNotaxUnit(event.target.value)}
                    />
                  </Field>
                ) : null}
                {upMode === "taxToNotax" ? (
                  <Field label="含税单价" unit="元">
                    <Input
                      inputMode="decimal"
                      value={upTaxUnit}
                      placeholder="例如 28.25"
                      onChange={(event) => setUpTaxUnit(event.target.value)}
                    />
                  </Field>
                ) : null}
                {upMode === "reverseQty" ? (
                  <Field label="不含税总金额" unit="元" hint="用它除以基准单价，反推数量">
                    <Input
                      inputMode="decimal"
                      value={upTotalNotax}
                      placeholder="例如 100000"
                      onChange={(event) => setUpTotalNotax(event.target.value)}
                    />
                  </Field>
                ) : null}
                <Field
                  label={upMode === "reverseQty" ? "基准不含税单价" : "数量"}
                  unit={upMode === "reverseQty" ? "元" : "件"}
                >
                  <Input
                    inputMode="decimal"
                    value={upMode === "reverseQty" ? upNotaxUnit : upQty}
                    placeholder={upMode === "reverseQty" ? "例如 25" : "例如 4000"}
                    onChange={(event) =>
                      upMode === "reverseQty" ? setUpNotaxUnit(event.target.value) : setUpQty(event.target.value)
                    }
                  />
                </Field>
                <Field label="增值税率" unit="%">
                  <Select value={upVatRate} onChange={(event) => setUpVatRate(event.target.value)}>
                    {VAT_RATE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                    <option value={upVatRate}>{upVatRate && !["13", "9", "6", "3", "1"].includes(upVatRate) ? `自定义 ${upVatRate}%` : "自定义"}</option>
                  </Select>
                </Field>
                <Field label="自定义增值税率" unit="%" hint="选中上面「自定义」后在这里填，例如 13">
                  <Input
                    inputMode="decimal"
                    value={upVatRate}
                    placeholder="例如 13"
                    onChange={(event) => setUpVatRate(event.target.value)}
                  />
                </Field>
                <Field label="报价附加系数" hint="旧版外贸预设里的 1.03（辅料/加价系数）填在这里，默认 1 表示不加">
                  <Input
                    inputMode="decimal"
                    value={upFactor}
                    placeholder="例如 1.03"
                    onChange={(event) => setUpFactor(event.target.value)}
                  />
                </Field>
              </div>
            ) : null}

            {activeId === "quote" ? (
              <div className="space-y-4">
                <Field label="你手上的是哪个价">
                  <Select value={qBase} onChange={(event) => setQBase(event.target.value as QuoteBase)}>
                    <option value="fob">FOB 离岸价（不含运保费）</option>
                    <option value="cfr">CFR 成本加运费（含运费不含保险）</option>
                    <option value="cif">CIF 到岸价（含运费与保险）</option>
                  </Select>
                </Field>
                <Field label="基础报价金额" unit="USD">
                  <Input
                    inputMode="decimal"
                    value={qAmount}
                    placeholder="例如 50000"
                    onChange={(event) => setQAmount(event.target.value)}
                  />
                </Field>
                <Field label="国际运费" unit="USD">
                  <Input
                    inputMode="decimal"
                    value={qFreight}
                    placeholder="例如 3500"
                    onChange={(event) => setQFreight(event.target.value)}
                  />
                </Field>
                <Field label="保险费率" unit="%" hint="0.8 表示 0.8%（千分之八），不要填成 8">
                  <Input
                    inputMode="decimal"
                    value={qInsRate}
                    placeholder="例如 0.8"
                    onChange={(event) => setQInsRate(event.target.value)}
                  />
                </Field>
                <Field label="投保加成怎么表达">
                  <Select
                    value={qMarkupMode}
                    onChange={(event) => setQMarkupMode(event.target.value as MarkupMode)}
                  >
                    <option value="coef">直接给系数（惯例 110%）</option>
                    <option value="rate">给加成率（惯例加成 10%）</option>
                  </Select>
                </Field>
                <Field
                  label={qMarkupMode === "coef" ? "投保加成系数" : "投保加成率"}
                  unit="%"
                  hint="CIF 公式的分母里用的是系数：系数 = 1 + 加成率"
                >
                  <Input
                    inputMode="decimal"
                    value={qMarkup}
                    placeholder={qMarkupMode === "coef" ? "例如 110" : "例如 10"}
                    onChange={(event) => setQMarkup(event.target.value)}
                  />
                </Field>
                <Field label="佣金">
                  <Select
                    value={qCommissionType}
                    onChange={(event) => setQCommissionType(event.target.value as CommissionType)}
                  >
                    <option value="none">无佣金</option>
                    <option value="explicit">明佣（在报价单/发票上明示）</option>
                    <option value="hidden">暗佣（不在发票上显示）</option>
                  </Select>
                </Field>
                <Field label="佣金率" unit="%" hint="佣金按最终成交价计收">
                  <Input
                    inputMode="decimal"
                    value={qCommission}
                    placeholder="例如 5"
                    onChange={(event) => setQCommission(event.target.value)}
                  />
                </Field>
                <Field label="报价加价率" unit="%" hint="作用在你填的基础报价上">
                  <Input
                    inputMode="decimal"
                    value={qMarkupUp}
                    placeholder="例如 0"
                    onChange={(event) => setQMarkupUp(event.target.value)}
                  />
                </Field>
                <Field label="折扣率" unit="%">
                  <Input
                    inputMode="decimal"
                    value={qDiscount}
                    placeholder="例如 0"
                    onChange={(event) => setQDiscount(event.target.value)}
                  />
                </Field>
              </div>
            ) : null}

            {activeId === "cost" ? (
              <div className="space-y-4">
                <Field label="国内含税采购总额" unit="元">
                  <Input
                    inputMode="decimal"
                    value={cCostWithTax}
                    placeholder="例如 113000"
                    onChange={(event) => setCCostWithTax(event.target.value)}
                  />
                </Field>
                <Field label="进项增值税率" unit="%">
                  <Select value={cVatRate} onChange={(event) => setCVatRate(event.target.value)}>
                    {VAT_RATE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="出口退税率" unit="%" hint="不能高于征税率；多数商品与征税率同为 13%">
                  <Select value={cRebateRate} onChange={(event) => setCRebateRate(event.target.value)}>
                    {VAT_RATE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="国内费用" unit="元" hint="内陆运费、报关、商检、银行费用等">
                  <Input
                    inputMode="decimal"
                    value={cDomesticFee}
                    placeholder="例如 5000"
                    onChange={(event) => setCDomesticFee(event.target.value)}
                  />
                </Field>
                <Field label="出口销售额" unit="USD" hint="FOB 净收入口径">
                  <Input
                    inputMode="decimal"
                    value={cExportUsd}
                    placeholder="例如 20000"
                    onChange={(event) => setCExportUsd(event.target.value)}
                  />
                </Field>
                <Field label="结汇汇率" unit="CNY/USD">
                  <Input
                    inputMode="decimal"
                    value={cRate}
                    placeholder="例如 7.25"
                    onChange={(event) => setCRate(event.target.value)}
                  />
                </Field>
                <Field label="目标成本利润率" unit="%" hint="用来算「目标报价」那一行">
                  <Input
                    inputMode="decimal"
                    value={cTargetMargin}
                    placeholder="例如 10"
                    onChange={(event) => setCTargetMargin(event.target.value)}
                  />
                </Field>
              </div>
            ) : null}

            {activeId === "import" ? (
              <div className="space-y-4">
                <Field label="关税完税价格（CIF）" unit="元" hint="人民币口径，通常就是 CIF 成交价折人民币">
                  <Input
                    inputMode="decimal"
                    value={iCif}
                    placeholder="例如 1000000"
                    onChange={(event) => setICif(event.target.value)}
                  />
                </Field>
                <Field label="进口关税税率" unit="%" hint="按 HS 编码确定，最惠国税率差异很大">
                  <Input
                    inputMode="decimal"
                    value={iTariffRate}
                    placeholder="例如 8"
                    onChange={(event) => setITariffRate(event.target.value)}
                  />
                </Field>
                <Field label="消费税比例税率" unit="%" hint="不属于消费税应税消费品就填 0">
                  <Input
                    inputMode="decimal"
                    value={iExciseRate}
                    placeholder="例如 0"
                    onChange={(event) => setIExciseRate(event.target.value)}
                  />
                </Field>
                <Field label="从量消费税单位税额" unit="元/单位" hint="从量或复合计税的商品才填，如成品油、卷烟">
                  <Input
                    inputMode="decimal"
                    value={iExciseUnit}
                    placeholder="例如 0"
                    onChange={(event) => setIExciseUnit(event.target.value)}
                  />
                </Field>
                <Field label="数量" hint="留空按 1 计，只影响从量消费税与单件综合成本">
                  <Input
                    inputMode="decimal"
                    value={iQty}
                    placeholder="例如 1"
                    onChange={(event) => setIQty(event.target.value)}
                  />
                </Field>
                <Field label="进口环节增值税率" unit="%">
                  <Select value={iVatRate} onChange={(event) => setIVatRate(event.target.value)}>
                    <option value="13">13%（多数货物）</option>
                    <option value="9">9%（部分民生商品）</option>
                  </Select>
                </Field>
                <Field label="港杂费与其他费用" unit="元" hint="港口费、报关代理、内陆运输等">
                  <Input
                    inputMode="decimal"
                    value={iPortFee}
                    placeholder="例如 2000"
                    onChange={(event) => setIPortFee(event.target.value)}
                  />
                </Field>
              </div>
            ) : null}

            {activeId === "freight" ? (
              <div className="space-y-4">
                <Field label="待分摊总费用" unit="元" hint="一票货的运费、港杂、报关等合计">
                  <Input
                    inputMode="decimal"
                    value={aFee}
                    placeholder="例如 6000"
                    onChange={(event) => setAFee(event.target.value)}
                  />
                </Field>
                <Field label="分摊口径">
                  <Select value={aBasis} onChange={(event) => setABasis(event.target.value as AllocBasis)}>
                    <option value="qty">按数量（件数）</option>
                    <option value="amount">按金额（货值）</option>
                    <option value="volume">按体积（m³）</option>
                    <option value="weight">按重量（kg）</option>
                  </Select>
                </Field>
                <AllocRowEditor rows={aRows} onChange={setARows} />
              </div>
            ) : null}

            {activeId === "summary" ? (
              <div className="space-y-3">
                <p className="text-xs leading-relaxed text-muted-foreground">
                  汇总会自动收录前面五个场景已经算出的所有分项，不需要在这里填东西。
                </p>
                <Button type="button" variant="outline" size="sm" onClick={() => fillSample("summary")}>
                  <Sparkles className="h-3.5 w-3.5" />
                  五个场景都填上示例
                </Button>
                <ul className="space-y-1.5 border-t border-border/40 pt-3">
                  {summarySections.map((section) => (
                    <li key={section.title} className="flex items-center gap-2 text-[11px] text-muted-foreground">
                      {section.items.length > 0 ? (
                        <Check className="h-3.5 w-3.5 text-success" />
                      ) : (
                        <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                      <span className="text-foreground">{section.title}</span>
                      <span className="ml-auto">
                        {section.items.length > 0 ? `${section.items.length} 项` : "未计算"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>

        {/* 右：结果 */}
        <div className="space-y-4 lg:col-span-8">
          {activeId === "summary" ? (
            <>
              <DetailTable
                title="报价单分项明细"
                digits={digits}
                sections={summarySections}
                actions={<CopyButton text={copyText} label="复制报价单文本" />}
              />
              <FormulaCard
                notes={[
                  { expr: "汇总口径", note: "只收录已经算出结果的场景；没填的场景会在对应小节里标出原因，不会用 0 占位。" },
                  { expr: "复制出来的文本", note: "每行是「项目：金额（计算式）」，可直接贴进报价邮件，数字全部经过四舍五入处理。" },
                ]}
              />
            </>
          ) : (
            <>
              {currentParseError ? <ErrorNote message={currentParseError} /> : null}
              {!currentParseError && currentError ? <ErrorNote message={currentError} /> : null}
              {showGuide ? <EmptyGuide hint={activeMeta.hint} onFill={() => fillSample(activeId)} /> : null}

              {currentItems.length > 0 ? (
                <>
                  <KeyStrip items={starItems} digits={digits} />
                  <DetailTable
                    title="分项明细"
                    items={currentItems}
                    digits={digits}
                    actions={
                      <CopyButton
                        text={summaryToText([{ title: activeMeta.label, items: currentItems }], { digits })}
                        label="复制本页明细"
                      />
                    }
                  />
                  {activeId === "cost" ? (
                    <p className="text-[11px] leading-relaxed text-muted-foreground">
                      汇率小数位当前为 {rateDigits} 位；换汇成本与每美元利润固定按 4 位显示，便于和银行牌价对齐。
                    </p>
                  ) : null}
                  <FormulaCard
                    notes={FORMULA_NOTES[activeId]}
                    extra={currentNotes}
                  />
                </>
              ) : null}

              {!currentItems.length && !showGuide && !currentParseError && !currentError ? (
                <EmptyGuide hint={activeMeta.hint} onFill={() => fillSample(activeId)} />
              ) : null}
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/70 bg-card/40 px-5 py-3 text-[11px] text-muted-foreground">
        <Coins className="h-3.5 w-3.5 text-primary" />
        <span>默认税率取中国现行常见值（增值税 13% / 9% / 6%、小规模征收率 3% 与减按 1%），关税与消费税按商品而定，请以实际政策与 HS 编码为准。</span>
      </div>
    </div>
  );
}
