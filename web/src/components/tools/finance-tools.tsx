import { localeTag as __localeTag } from "@/lib/language";
"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/finance-tools.tsx");


/**
 * 财务计算类工具的自带界面：房贷/车贷计算器、房贷提前还款对比、股票成本盈亏。
 *
 * 布局选择：
 *   · 房贷/车贷计算器 —— **模式 B（工作台 4:8）**：左边参数（金额、利率、期限、还款方式），
 *     右边是"月供/总利息"的结论 + 完整还款计划表。贷款的核心问题是"总共要还多少利息"，
 *     所以计划表必须以真正的表格给出（前期利息占比变化是用户最关心的一件事）。
 *   · 提前还款对比 —— **模式 A（转换对照）**：左边"不提前还"，右边"提前还"，中间/下方给节省明细。
 *     这是一个纯粹的"两种方案对比"问题，并排才看得清差别。
 *   · 股票成本盈亏 —— **模式 D（表格）**：分批买入卖出记录逐行列出，下方汇总成本价与盈亏。
 *
 * 所有公式都写在注释里，随时可核对；利率一律按"年利率"输入、按月计息。
 * 结果仅作参考，实际以银行/券商的账单为准。
 */

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Banknote,
  Calculator,
  Car,
  Coins,
  Eraser,
  Home,
  Info,
  LineChart,
  Minus,
  Plus,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Trash2,
} from "lucide-react";
import { Badge, Button, Input, Label, Select } from "@/components/ui/primitives";
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

const yuan = (n: number) =>
  n.toLocaleString(__localeTag(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const wan = (n: number) => (n / 10000).toLocaleString(__localeTag(), { maximumFractionDigits: 2 });

/** 等额本息：月供 M = P·r·(1+r)^n / ((1+r)^n − 1) */
function equalInstallment(principal: number, monthlyRate: number, months: number) {
  if (monthlyRate === 0) return principal / months;
  const pow = Math.pow(1 + monthlyRate, months);
  return (principal * monthlyRate * pow) / (pow - 1);
}

/** 等额本息还款计划（返回每月本金/利息/余额） */
function equalInstallmentSchedule(principal: number, monthlyRate: number, months: number) {
  const m = equalInstallment(principal, monthlyRate, months);
  let balance = principal;
  const rows: Array<{ month: number; payment: number; interest: number; principalPart: number; balance: number }> = [];
  for (let i = 1; i <= months; i++) {
    const interest = balance * monthlyRate;
    const principalPart = m - interest;
    balance = Math.max(0, balance - principalPart);
    rows.push({ month: i, payment: m, interest, principalPart, balance });
  }
  return { monthly: m, rows };
}

/** 等额本金还款计划：每月本金相同，利息按剩余本金算 */
function equalPrincipalSchedule(principal: number, monthlyRate: number, months: number) {
  const principalPart = principal / months;
  let balance = principal;
  const rows: Array<{ month: number; payment: number; interest: number; principalPart: number; balance: number }> = [];
  for (let i = 1; i <= months; i++) {
    const interest = balance * monthlyRate;
    balance = Math.max(0, balance - principalPart);
    rows.push({ month: i, payment: principalPart + interest, interest, principalPart, balance });
  }
  return { monthly: rows[0]?.payment || 0, rows };
}

// ══════════════════════════════════════════════════════════════════════
// 工具一：房贷 / 车贷计算器
// ══════════════════════════════════════════════════════════════════════

export function MortgageCalculatorTool() {
  const __locale = __useLanguage();
  const [mode, setMode] = useToolDraft<"house" | "car">("mortgage-calculator", "mode", "house");
  // 房贷
  const [totalPrice, setTotalPrice] = useToolDraft("mortgage-calculator", "totalPrice", "200");
  const [downPercent, setDownPercent] = useToolDraft("mortgage-calculator", "downPercent", "30");
  const [years, setYears] = useToolDraft("mortgage-calculator", "years", "30");
  const [method, setMethod] = useToolDraft<"equal" | "principal">("mortgage-calculator", "method", "equal");
  const [useFund, setUseFund] = useToolDraft("mortgage-calculator", "useFund", false);
  const [fundAmount, setFundAmount] = useToolDraft("mortgage-calculator", "fundAmount", "60");
  const [fundRate, setFundRate] = useToolDraft("mortgage-calculator", "fundRate", "2.85");
  const [rate, setRate] = useToolDraft("mortgage-calculator", "rate", "3.1");
  // 车贷
  const [carPrice, setCarPrice] = useToolDraft("mortgage-calculator", "carPrice", "15");
  const [carDown, setCarDown] = useToolDraft("mortgage-calculator", "carDown", "30");
  const [carYears, setCarYears] = useToolDraft("mortgage-calculator", "carYears", "3");
  const [carRate, setCarRate] = useToolDraft("mortgage-calculator", "carRate", "4.5");
  const [insurance, setInsurance] = useToolDraft("mortgage-calculator", "insurance", "0.6");

  const result = useMemo(() => {
    if (mode === "house") {
      const price = Number(totalPrice) * 10000;
      const down = price * (Number(downPercent) / 100);
      const loan = price - down;
      const months = Number(years) * 12;
      const r = Number(rate) / 100 / 12;
      if (!(price > 0)) return { error: "总价要大于 0" as string, data: null };
      if (!(loan > 0)) return { error: "首付比例太高，没有可贷金额", data: null };
      if (!(months > 0)) return { error: "贷款年限要大于 0", data: null };

      // 组合贷：拆成"公积金 + 商贷"两部分分别计算
      const fundLoan = useFund ? Math.min(Number(fundAmount) * 10000, loan) : 0;
      const commercialLoan = loan - fundLoan;
      const fundR = Number(fundRate) / 100 / 12;

      const calc = (p: number, monthlyRate: number) =>
        method === "equal" ? equalInstallmentSchedule(p, monthlyRate, months) : equalPrincipalSchedule(p, monthlyRate, months);

      const commercial = calc(commercialLoan, r);
      const fund = fundLoan > 0 ? calc(fundLoan, fundR) : null;

      const rows: Array<{ month: number; payment: number; interest: number; principalPart: number; balance: number }> = [];
      for (let i = 0; i < months; i++) {
        const c = commercial.rows[i];
        const f = fund?.rows[i];
        rows.push({
          month: i + 1,
          payment: (c?.payment || 0) + (f?.payment || 0),
          interest: (c?.interest || 0) + (f?.interest || 0),
          principalPart: (c?.principalPart || 0) + (f?.principalPart || 0),
          balance: (c?.balance || 0) + (f?.balance || 0),
        });
      }
      const totalInterest = rows.reduce((s, x) => s + x.interest, 0);
      const firstPayment = rows[0]?.payment || 0;
      const lastPayment = rows[rows.length - 1]?.payment || 0;

      return {
        error: "",
        data: {
          kind: "house" as const,
          price,
          down,
          loan,
          fundLoan,
          commercialLoan,
          months,
          totalInterest,
          totalPayment: loan + totalInterest,
          firstPayment,
          lastPayment,
          rows,
          monthlyDecrease: method === "principal" ? commercial.rows[0].principalPart * r + (fund ? fund.rows[0].principalPart * fundR : 0) : 0,
        },
      };
    }

    // 车贷
    const price = Number(carPrice) * 10000;
    const down = price * (Number(carDown) / 100);
    const loan = price - down;
    const months = Number(carYears) * 12;
    const r = Number(carRate) / 100 / 12;
    if (!(price > 0)) return { error: "车价要大于 0", data: null };
    if (!(loan > 0)) return { error: "首付比例太高，没有可贷金额", data: null };

    const { monthly, rows } = equalInstallmentSchedule(loan, r, months);
    const totalInterest = rows.reduce((s, x) => s + x.interest, 0);
    // 落地估算：购置税（新能源免税已不适用全额，这里按 10% 估）+ 保险 + 上牌
    const purchaseTax = price / 1.13 * 0.1;
    const insuranceFee = Number(insurance) * 10000;
    const plateFee = 500;

    return {
      error: "",
      data: {
        kind: "car" as const,
        price,
        down,
        loan,
        months,
        monthly,
        totalInterest,
        totalPayment: loan + totalInterest,
        purchaseTax,
        insuranceFee,
        plateFee,
        landing: price + purchaseTax + insuranceFee + plateFee,
        rows,
      },
    };
  }, [mode, totalPrice, downPercent, years, method, useFund, fundAmount, fundRate, rate, carPrice, carDown, carYears, carRate, insurance, __locale]);

  const d = result.data;

  const copyText = useMemo(() => {
    if (!d) return "";
    if (d.kind === "house") {
      return (
        `房屋总价 ${wan(d.price)} 万，首付 ${wan(d.down)} 万，贷款 ${wan(d.loan)} 万\n` +
        (d.fundLoan > 0 ? `其中公积金 ${wan(d.fundLoan)} 万 / 商贷 ${wan(d.commercialLoan)} 万\n` : "") +
        `期限 ${d.months} 期（${d.months / 12} 年），${method === "equal" ? "等额本息" : "等额本金"}\n` +
        `首月月供 ${yuan(d.firstPayment)} 元，末月 ${yuan(d.lastPayment)} 元\n` +
        `利息合计 ${yuan(d.totalInterest)} 元（${wan(d.totalInterest)} 万）\n` +
        `本息合计 ${yuan(d.totalPayment)} 元`
      );
    }
    return (
      `车价 ${wan(d.price)} 万，首付 ${wan(d.down)} 万，贷款 ${wan(d.loan)} 万\n` +
      `月供 ${yuan(d.monthly)} 元 × ${d.months} 期\n` +
      `利息合计 ${yuan(d.totalInterest)} 元\n` +
      `购置税约 ${yuan(d.purchaseTax)} 元，保险约 ${yuan(d.insuranceFee)} 元\n` +
      `落地总价估算 ${yuan(d.landing)} 元`
    );
  }, [d, method, __locale]);

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="thin-scroll space-y-4 lg:col-span-4">
          <SectionCard
            icon={mode === "house" ? <Home className="h-4 w-4" /> : <Car className="h-4 w-4" />}
            title={mode === "house" ? __ui("房子与贷款") : __ui("车价与贷款")}
            extra={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setTotalPrice("200");
                  setDownPercent("30");
                  setYears("30");
                  setRate("3.1");
                  setUseFund(false);
                  setCarPrice("15");
                  setCarDown("30");
                  setCarYears("3");
                  setCarRate("4.5");
                }}
              >
                <Sparkles className="h-3.5 w-3.5" /> {__ui("填入示例")}</Button>
            }
          >
            <div className="mb-3 flex gap-1.5 rounded-xl border border-border/60 bg-secondary/30 p-1">
              {[
                { id: "house" as const, label: "房贷", icon: <Home className="h-3.5 w-3.5" /> },
                { id: "car" as const, label: "车贷", icon: <Car className="h-3.5 w-3.5" /> },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setMode(tab.id)}
                  className={cn(
                    "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                    mode === tab.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {tab.icon}
                  {__ui(tab.label)}
                </button>
              ))}
            </div>

            {mode === "house" ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="mc-price">{__ui("房屋总价（万元）")}</Label>
                    <Input id="mc-price" type="number" value={totalPrice} onChange={(e) => setTotalPrice(e.target.value)} className="text-xs" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="mc-down">{__ui("首付比例（%）")}</Label>
                    <Input id="mc-down" type="number" value={downPercent} onChange={(e) => setDownPercent(e.target.value)} className="text-xs" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="mc-years">{__ui("贷款年限")}</Label>
                    <Select id="mc-years" value={years} onChange={(e) => setYears(e.target.value)} className="w-full text-xs">
                      {[5, 10, 15, 20, 25, 30].map((y) => (
                        <option key={y} value={y}>
                          {y} {__ui("年")}</option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="mc-rate">{__ui("商贷年利率（%）")}</Label>
                    <Input id="mc-rate" type="number" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} className="text-xs" />
                  </div>
                </div>

                <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-border/60 bg-background/40 px-3 py-2">
                  <input type="checkbox" checked={useFund} onChange={(e) => setUseFund(e.target.checked)} className="accent-primary" />
                  <span className="text-xs text-foreground">{__ui("使用公积金组合贷")}</span>
                </label>

                {useFund && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="mc-fund">{__ui("公积金贷款（万元）")}</Label>
                      <Input id="mc-fund" type="number" value={fundAmount} onChange={(e) => setFundAmount(e.target.value)} className="text-xs" />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="mc-fundrate">{__ui("公积金利率（%）")}</Label>
                      <Input id="mc-fundrate" type="number" step="0.01" value={fundRate} onChange={(e) => setFundRate(e.target.value)} className="text-xs" />
                    </div>
                  </div>
                )}

                <div className="space-y-1.5">
                  <Label>{__ui("还款方式")}</Label>
                  <div className="flex gap-1.5 rounded-xl border border-border/60 bg-secondary/30 p-1">
                    {[
                      { id: "equal" as const, label: "等额本息", hint: "每月一样多" },
                      { id: "principal" as const, label: "等额本金", hint: "每月递减" },
                    ].map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setMethod(m.id)}
                        className={cn(
                          "flex-1 rounded-lg px-2 py-1.5 text-[11.5px] font-medium transition-colors",
                          method === m.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                        )}
                      >
                        {__ui(m.label)}
                        <span className="ml-1 opacity-70">{__ui(m.hint)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="mc-carprice">{__ui("车价（万元）")}</Label>
                    <Input id="mc-carprice" type="number" value={carPrice} onChange={(e) => setCarPrice(e.target.value)} className="text-xs" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="mc-cardown">{__ui("首付（%）")}</Label>
                    <Input id="mc-cardown" type="number" value={carDown} onChange={(e) => setCarDown(e.target.value)} className="text-xs" />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="mc-caryears">{__ui("年限")}</Label>
                    <Select id="mc-caryears" value={carYears} onChange={(e) => setCarYears(e.target.value)} className="w-full text-xs">
                      {[1, 2, 3, 4, 5].map((y) => (
                        <option key={y} value={y}>
                          {y} {__ui("年")}</option>
                      ))}
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="mc-carrate">{__ui("年利率 %")}</Label>
                    <Input id="mc-carrate" type="number" step="0.01" value={carRate} onChange={(e) => setCarRate(e.target.value)} className="text-xs" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="mc-ins">{__ui("保险（万）")}</Label>
                    <Input id="mc-ins" type="number" step="0.1" value={insurance} onChange={(e) => setInsurance(e.target.value)} className="text-xs" />
                  </div>
                </div>
              </div>
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              {__ui("利率按年利率填写（如 3.1 表示 3.1%），按月计息、按月还款。")}</p>
          </SectionCard>
        </div>

        <div className="thin-scroll space-y-4 lg:col-span-8">
          {result.error ? (
            <ErrorBar message={__msg(result.error)} />
          ) : d ? (
            <>
              <SectionCard
                icon={<Calculator className="h-4 w-4" />}
                title={d.kind === "house" ? __ui("月供与利息") : __ui("月供与落地价")}
                extra={<CopyButton value={copyText} label={__ui("复制结果")} />}
              >
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-primary/30 bg-primary/[0.07] px-4 py-3">
                    <div className="text-[11.5px] text-muted-foreground">
                      {d.kind === "house" && method === "principal" ? __ui("首月月供") : __ui("每月月供")}
                    </div>
                    <div className="mt-1 font-mono text-2xl font-bold text-primary">
                      {d.kind === "house" ? yuan(d.firstPayment) : yuan(d.monthly)}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {__ui("元")}{d.kind === "house" && method === "principal" ? __msg("（末月 {0}）", yuan(d.lastPayment)) : ""}
                    </div>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-secondary/20 px-4 py-3">
                    <div className="text-[11.5px] text-muted-foreground">{__ui("利息合计")}</div>
                    <div className="mt-1 font-mono text-2xl font-bold text-foreground">{wan(d.totalInterest)}</div>
                    <div className="text-[11px] text-muted-foreground">{__ui("万元（")}{yuan(d.totalInterest)} {__ui("元）")}</div>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-secondary/20 px-4 py-3">
                    <div className="text-[11.5px] text-muted-foreground">
                      {d.kind === "house" ? __ui("本息合计") : __ui("落地总价估算")}
                    </div>
                    <div className="mt-1 font-mono text-2xl font-bold text-foreground">
                      {wan(d.kind === "house" ? d.totalPayment : d.landing)}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{__ui("万元")}</div>
                  </div>
                </div>

                {d.kind === "house" && d.fundLoan > 0 && (
                  <div className="mt-3 rounded-xl border border-border/60 bg-background/40 p-3 text-[12px]">
                    <div className="mb-1.5 font-medium text-foreground">{__ui("组合贷拆分")}</div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="text-muted-foreground">
                        {__ui("公积金贷款")}<b className="font-mono text-foreground">{wan(d.fundLoan)} {__ui("万")}</b>{__ui("（年利率")}{fundRate}%）
                      </div>
                      <div className="text-muted-foreground">
                        {__ui("商业贷款")}<b className="font-mono text-foreground">{wan(d.commercialLoan)} {__ui("万")}</b>{__ui("（年利率")}{rate}%）
                      </div>
                    </div>
                  </div>
                )}

                {d.kind === "car" && (
                  <div className="mt-3 rounded-xl border border-border/60 bg-background/40 p-3">
                    <div className="mb-1.5 text-[12px] font-medium text-foreground">{__ui("落地价估算")}</div>
                    <table className="w-full text-[11.5px]">
                      <tbody>
                        {[
                          { k: "车价", v: d.price },
                          { k: "购置税（约车价/1.13×10%）", v: d.purchaseTax },
                          { k: "保险（按填写）", v: d.insuranceFee },
                          { k: "上牌等杂费", v: d.plateFee },
                        ].map((row) => (
                          <tr key={row.k} className="border-b border-border/40 last:border-0">
                            <td className="py-1.5 text-muted-foreground">{__msg(row.k)}</td>
                            <td className="py-1.5 text-right font-mono text-foreground">{yuan(row.v)} {__ui("元")}</td>
                          </tr>
                        ))}
                        <tr>
                          <td className="pt-2 font-medium text-foreground">{__ui("合计")}</td>
                          <td className="pt-2 text-right font-mono font-semibold text-primary">{yuan(d.landing)} {__ui("元")}</td>
                        </tr>
                      </tbody>
                    </table>
                    <p className="mt-1.5 text-[11px] text-muted-foreground">
                      {__ui("购置税、保险因地区与车型差别很大，这里只给量级参考；新能源车购置税政策另计。")}</p>
                  </div>
                )}
              </SectionCard>

              <SectionCard icon={<LineChart className="h-4 w-4" />} title={__msg("还款计划（共 {0} 期）", d.months)}>
                <div className="thin-scroll max-h-[420px] overflow-auto rounded-xl border border-border/60">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
                        <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("期数")}</th>
                        <th className="px-3 py-2 text-right font-semibold text-foreground">{__ui("月供")}</th>
                        <th className="px-3 py-2 text-right font-semibold text-foreground">{__ui("其中利息")}</th>
                        <th className="px-3 py-2 text-right font-semibold text-foreground">{__ui("其中本金")}</th>
                        <th className="px-3 py-2 text-right font-semibold text-foreground">{__ui("剩余本金")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.rows.slice(0, 24).map((row) => (
                        <tr key={row.month} className="border-t border-border/40 even:bg-muted/20">
                          <td className="px-3 py-1.5 text-foreground">{__ui("第")}{row.month} {__ui("期")}</td>
                          <td className="px-3 py-1.5 text-right font-mono text-foreground">{yuan(row.payment)}</td>
                          <td className="px-3 py-1.5 text-right font-mono text-amber-600 dark:text-amber-500">{yuan(row.interest)}</td>
                          <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{yuan(row.principalPart)}</td>
                          <td className="px-3 py-1.5 text-right font-mono text-muted-foreground">{yuan(row.balance)}</td>
                        </tr>
                      ))}
                      {d.rows.length > 24 && (
                        <tr className="border-t border-border/40">
                          <td colSpan={5} className="px-3 py-2 text-[11px] text-muted-foreground">
                            {__ui("中间省略")}{d.rows.length - 24} {__ui("期……")}</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  {__ui("前几期利息占比最高（等额本息尤为明显），这也是提前还款越早、节省利息越多的原因；具体金额可用「房贷提前还款对比」计算。")}</p>
              </SectionCard>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 工具二：房贷提前还款对比
// ══════════════════════════════════════════════════════════════════════

export function MortgagePrepayTool() {
  const __locale = __useLanguage();
  const [balance, setBalance] = useToolDraft("mortgage-prepay", "balance", "120");
  const [leftMonths, setLeftMonths] = useToolDraft("mortgage-prepay", "leftMonths", "300");
  const [rate, setRate] = useToolDraft("mortgage-prepay", "rate", "3.1");
  const [prepay, setPrepay] = useToolDraft("mortgage-prepay", "prepay", "20");
  const [mode, setMode] = useToolDraft<"shorten" | "reduce">("mortgage-prepay", "mode", "shorten");
  const [penaltyRate, setPenaltyRate] = useToolDraft("mortgage-prepay", "penaltyRate", "0");

  const result = useMemo(() => {
    const P = Number(balance) * 10000;
    const n = Number(leftMonths);
    const r = Number(rate) / 100 / 12;
    const extra = Number(prepay) * 10000;
    if (!(P > 0) || !(n > 0)) return { error: "剩余本金与剩余期数都要大于 0", data: null };
    if (extra <= 0) return { error: "提前还款金额要大于 0", data: null };
    if (extra >= P) return { error: "提前还款金额不应超过剩余本金（等于全额结清）", data: null };

    // 现状：按等额本息继续还
    const before = equalInstallmentSchedule(P, r, n);
    const beforeInterest = before.rows.reduce((s, x) => s + x.interest, 0);
    const monthly = before.monthly;

    // 提前还款后剩余本金
    const newPrincipal = P - extra;
    const penalty = extra * (Number(penaltyRate) / 100);

    let afterInterest = 0;
    let newMonths = n;
    let newMonthly = monthly;

    if (mode === "shorten") {
      // 月供不变、缩短期限：n' = −ln(1 − P'·r/M) / ln(1+r)
      if (r === 0) {
        newMonths = Math.ceil(newPrincipal / monthly);
      } else {
        const x = 1 - (newPrincipal * r) / monthly;
        newMonths = x > 0 ? Math.ceil(-Math.log(x) / Math.log(1 + r)) : 1;
      }
      const after = equalInstallmentSchedule(newPrincipal, r, newMonths);
      afterInterest = after.rows.reduce((s, x) => s + x.interest, 0);
      newMonthly = monthly;
    } else {
      // 期限不变、减少月供
      newMonths = n;
      newMonthly = equalInstallment(newPrincipal, r, n);
      const after = equalInstallmentSchedule(newPrincipal, r, n);
      afterInterest = after.rows.reduce((s, x) => s + x.interest, 0);
    }

    return {
      error: "",
      data: {
        P,
        n,
        r,
        extra,
        monthly,
        beforeInterest,
        newPrincipal,
        newMonths,
        newMonthly,
        afterInterest,
        saved: beforeInterest - afterInterest,
        penalty,
        netSaved: beforeInterest - afterInterest - penalty,
      },
    };
  }, [balance, leftMonths, rate, prepay, mode, penaltyRate, __locale]);

  const d = result.data;

  const copyText = d
    ? `提前还款 ${wan(d.extra)} 万元（${mode === "shorten" ? "缩短期限" : "减少月供"}）\n` +
      `不提前还：利息合计 ${wan(d.beforeInterest)} 万（剩 ${d.n} 期，月供 ${yuan(d.monthly)}）\n` +
      `提前还后：利息合计 ${wan(d.afterInterest)} 万（剩 ${d.newMonths} 期，月供 ${yuan(d.newMonthly)}）\n` +
      `节省利息 ${wan(d.saved)} 万${d.penalty > 0 ? `，扣违约金 ${yuan(d.penalty)} 元后净省 ${wan(d.netSaved)} 万` : ""}`
    : "";

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="thin-scroll space-y-4 lg:col-span-4">
          <SectionCard
            icon={<Banknote className="h-4 w-4" />}
            title={__ui("当前贷款情况")}
            extra={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setBalance("120");
                  setLeftMonths("300");
                  setRate("3.1");
                  setPrepay("20");
                  setMode("shorten");
                  setPenaltyRate("0");
                }}
              >
                <Sparkles className="h-3.5 w-3.5" /> {__ui("填入示例")}</Button>
            }
          >
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="mp-balance">{__ui("剩余本金（万元）")}</Label>
                  <Input id="mp-balance" type="number" value={balance} onChange={(e) => setBalance(e.target.value)} className="text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mp-months">{__ui("剩余期数")}</Label>
                  <Input id="mp-months" type="number" value={leftMonths} onChange={(e) => setLeftMonths(e.target.value)} className="text-xs" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="mp-rate">{__ui("年利率（%）")}</Label>
                  <Input id="mp-rate" type="number" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} className="text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="mp-prepay">{__ui("打算提前还（万元）")}</Label>
                  <Input id="mp-prepay" type="number" value={prepay} onChange={(e) => setPrepay(e.target.value)} className="text-xs" />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>{__ui("提前还款方式")}</Label>
                <div className="space-y-1.5">
                  {[
                    { id: "shorten" as const, label: "缩短期限", hint: "月供不变，早点还完（省息更多）" },
                    { id: "reduce" as const, label: "减少月供", hint: "期限不变，每月压力小" },
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setMode(m.id)}
                      className={cn(
                        "w-full rounded-xl border px-3 py-2 text-left transition-colors",
                        mode === m.id ? "border-primary/50 bg-primary/[0.07]" : "border-border/60 hover:bg-muted/50",
                      )}
                    >
                      <div className="text-[12px] font-medium text-foreground">
                        {mode === m.id ? "✓ " : ""}
                        {__ui(m.label)}
                      </div>
                      <div className="text-[11px] text-muted-foreground">{__ui(m.hint)}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="mp-penalty">{__ui("违约金比例（% ，没有就填 0）")}</Label>
                <Input id="mp-penalty" type="number" step="0.1" value={penaltyRate} onChange={(e) => setPenaltyRate(e.target.value)} className="text-xs" />
              </div>
            </div>
          </SectionCard>
        </div>

        <div className="thin-scroll space-y-4 lg:col-span-8">
          {result.error ? (
            <ErrorBar message={__msg(result.error)} />
          ) : d ? (
            <>
              <SectionCard
                icon={<Coins className="h-4 w-4" />}
                title={__ui("能省多少")}
                extra={<CopyButton value={copyText} label={__ui("复制结论")} />}
              >
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/[0.07] px-4 py-3">
                    <div className="text-[11.5px] text-muted-foreground">{__ui("节省利息")}</div>
                    <div className="mt-1 font-mono text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                      {wan(d.saved)}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{__ui("万元")}</div>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-secondary/20 px-4 py-3">
                    <div className="text-[11.5px] text-muted-foreground">{__ui("违约金")}</div>
                    <div className="mt-1 font-mono text-2xl font-bold text-foreground">{d.penalty > 0 ? yuan(d.penalty) : "0.00"}</div>
                    <div className="text-[11px] text-muted-foreground">{__ui("元")}</div>
                  </div>
                  <div className="rounded-xl border border-primary/30 bg-primary/[0.07] px-4 py-3">
                    <div className="text-[11.5px] text-muted-foreground">{__ui("扣掉违约金后净省")}</div>
                    <div className="mt-1 font-mono text-2xl font-bold text-primary">{wan(d.netSaved)}</div>
                    <div className="text-[11px] text-muted-foreground">{__ui("万元")}</div>
                  </div>
                </div>
              </SectionCard>

              <SectionCard icon={<TrendingDown className="h-4 w-4" />} title={__ui("两种做法逐项对照")}>
                <div className="overflow-hidden rounded-xl border border-border/60">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="bg-muted/60">
                        <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("项目")}</th>
                        <th className="px-3 py-2 text-right font-semibold text-foreground">{__ui("不提前还")}</th>
                        <th className="px-3 py-2 text-right font-semibold text-foreground">{__ui("提前还")}{wan(d.extra)} {__ui("万")}</th>
                        <th className="px-3 py-2 text-right font-semibold text-foreground">{__ui("差别")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[
                        { k: "剩余期数", a: `${d.n} 期`, b: `${d.newMonths} 期`, diff: `少 ${d.n - d.newMonths} 期` },
                        { k: "每月月供", a: yuan(d.monthly), b: yuan(d.newMonthly), diff: d.newMonthly < d.monthly ? `少 ${yuan(d.monthly - d.newMonthly)}` : "不变" },
                        { k: "利息合计", a: `${wan(d.beforeInterest)} 万`, b: `${wan(d.afterInterest)} 万`, diff: `省 ${wan(d.saved)} 万` },
                        {
                          k: "本息合计",
                          a: `${wan(d.beforeInterest + d.P)} 万`,
                          b: `${wan(d.afterInterest + d.newPrincipal + d.extra)} 万`,
                          diff: `省 ${wan(d.saved)} 万`,
                        },
                      ].map((row, i) => (
                        <tr key={row.k} className={cn("border-t border-border/40 even:bg-muted/20", i === 0 && "border-t-0")}>
                          <td className="px-3 py-2 text-foreground">{__msg(row.k)}</td>
                          <td className="px-3 py-2 text-right font-mono text-muted-foreground">{row.a}</td>
                          <td className="px-3 py-2 text-right font-mono text-foreground">{row.b}</td>
                          <td className="px-3 py-2 text-right font-mono text-emerald-600 dark:text-emerald-400">{row.diff}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="mt-3 rounded-xl border border-border/60 bg-background/40 p-3">
                  <div className="mb-1 flex items-center gap-1.5 text-[11.5px] font-medium text-foreground">
                    <Info className="h-3.5 w-3.5 text-primary" /> {__ui("怎么选")}</div>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {__ui("「缩短期限」保留月供、直接砍掉后面的期数，省的利息明显更多，适合月供没压力的人； 「减少月供」把期限留着、每月轻松些，适合现金流紧的人。 另外：如果手上的钱理财收益能稳定高于贷款利率，那提前还未必划算 —— 这里的结论只算利息账。")}</p>
                </div>
              </SectionCard>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 工具三：股票成本盈亏
// ══════════════════════════════════════════════════════════════════════

interface TradeRow {
  id: number;
  side: "buy" | "sell";
  price: string;
  shares: string;
  feeRate: string;
}

export function StockPnlTool() {
  const __locale = __useLanguage();
  const [rows, setRows] = useState<TradeRow[]>([
    { id: 1, side: "buy", price: "10.00", shares: "1000", feeRate: "0.025" },
    { id: 2, side: "buy", price: "9.00", shares: "1000", feeRate: "0.025" },
  ]);
  const [marketPrice, setMarketPrice] = useToolDraft("stock-pnl", "marketPrice", "10.50");
  const [stampRate, setStampRate] = useToolDraft("stock-pnl", "stampRate", "0.05");
  const [minFee, setMinFee] = useToolDraft("stock-pnl", "minFee", "5");

  const nextId = () => Math.max(0, ...rows.map((r) => r.id)) + 1;

  const result = useMemo(() => {
    let shares = 0;
    let cost = 0; // 含费用的总成本
    let realized = 0; // 已实现盈亏
    let totalFee = 0;

    for (const r of rows) {
      const price = Number(r.price);
      const qty = Number(r.shares);
      if (!(price > 0) || !(qty > 0)) continue;
      const amount = price * qty;
      const commission = Math.max(Number(minFee) || 0, (amount * (Number(r.feeRate) || 0)) / 100);
      const stamp = r.side === "sell" ? (amount * (Number(stampRate) || 0)) / 100 : 0;
      const fee = commission + stamp;
      totalFee += fee;

      if (r.side === "buy") {
        shares += qty;
        cost += amount + fee;
      } else {
        const avg = shares > 0 ? cost / shares : 0;
        const sellShares = Math.min(qty, shares);
        realized += (price - avg) * sellShares - fee;
        cost -= avg * sellShares;
        shares -= sellShares;
      }
    }

    const avgCost = shares > 0 ? cost / shares : 0;
    const market = Number(marketPrice) || 0;
    const marketValue = shares * market;
    const floatPnl = marketValue - cost;
    const floatPct = cost > 0 ? (floatPnl / cost) * 100 : 0;
    const totalPnl = floatPnl + realized;
    // 保本价：把卖出要交的费也算进去
    const breakEven = shares > 0 ? (cost + Math.max(Number(minFee) || 0, (shares * market * ((Number(stampRate) || 0) / 100 + 0.00025)))) / shares : 0;

    return { shares, cost, avgCost, realized, floatPnl, floatPct, marketValue, totalPnl, totalFee, breakEven };
  }, [rows, marketPrice, stampRate, minFee, __locale]);

  const copyText = `持仓 ${result.shares} 股，成本价 ${result.avgCost.toFixed(3)} 元/股\n现价后市值 ${yuan(result.marketValue)} 元\n浮动盈亏 ${yuan(result.floatPnl)} 元（${result.floatPct.toFixed(2)}%）\n已实现盈亏 ${yuan(result.realized)} 元\n合计 ${yuan(result.totalPnl)} 元`;

  const update = (id: number, patch: Partial<TradeRow>) => setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="thin-scroll space-y-4 lg:col-span-7">
          <SectionCard
            icon={<LineChart className="h-4 w-4" />}
            title={__msg("买卖记录（{0} 笔）", rows.length)}
            extra={
              <div className="flex items-center gap-1.5">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() =>
                    setRows((prev) => [...prev, { id: nextId(), side: "buy", price: "", shares: "", feeRate: "0.025" }])
                  }
                >
                  <Plus className="h-3.5 w-3.5" /> {__ui("加一笔")}</Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1.5"
                  onClick={() =>
                    setRows([
                      { id: 1, side: "buy", price: "10.00", shares: "1000", feeRate: "0.025" },
                      { id: 2, side: "buy", price: "9.00", shares: "1000", feeRate: "0.025" },
                    ])
                  }
                >
                  <Eraser className="h-3.5 w-3.5" /> {__ui("重置示例")}</Button>
              </div>
            }
          >
            <div className="space-y-2">
              {rows.map((r) => (
                <div key={r.id} className="grid grid-cols-12 items-end gap-2 rounded-xl border border-border/60 bg-background/40 p-2.5">
                  <div className="col-span-3 space-y-1">
                    <Label className="text-[10.5px]">{__ui("方向")}</Label>
                    <Select
                      value={r.side}
                      onChange={(e) => update(r.id, { side: e.target.value as "buy" | "sell" })}
                      className="w-full text-[11.5px]"
                    >
                      <option value="buy">{__ui("买入")}</option>
                      <option value="sell">{__ui("卖出")}</option>
                    </Select>
                  </div>
                  <div className="col-span-3 space-y-1">
                    <Label className="text-[10.5px]">{__ui("价格")}</Label>
                    <Input value={r.price} onChange={(e) => update(r.id, { price: e.target.value })} className="text-[11.5px]" />
                  </div>
                  <div className="col-span-3 space-y-1">
                    <Label className="text-[10.5px]">{__ui("股数")}</Label>
                    <Input value={r.shares} onChange={(e) => update(r.id, { shares: e.target.value })} className="text-[11.5px]" />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-[10.5px]">{__ui("佣金 %")}</Label>
                    <Input value={r.feeRate} onChange={(e) => update(r.id, { feeRate: e.target.value })} className="text-[11.5px]" />
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <button
                      type="button"
                      onClick={() => setRows((prev) => prev.filter((x) => x.id !== r.id))}
                      className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      aria-label={__ui("删除这笔")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="mt-3 grid grid-cols-3 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="sp-market">{__ui("当前价")}</Label>
                <Input id="sp-market" type="number" step="0.01" value={marketPrice} onChange={(e) => setMarketPrice(e.target.value)} className="text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sp-stamp">{__ui("印花税 %（卖出）")}</Label>
                <Input id="sp-stamp" type="number" step="0.01" value={stampRate} onChange={(e) => setStampRate(e.target.value)} className="text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sp-minfee">{__ui("最低佣金（元）")}</Label>
                <Input id="sp-minfee" type="number" value={minFee} onChange={(e) => setMinFee(e.target.value)} className="text-xs" />
              </div>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              {__ui("默认佣金万分之 2.5、最低 5 元，印花税千分之 0.5（卖出单边）。券商资费不同，按自己的改。")}</p>
          </SectionCard>
        </div>

        <div className="thin-scroll space-y-4 lg:col-span-5">
          <SectionCard icon={<Coins className="h-4 w-4" />} title={__ui("持仓与盈亏")} extra={<CopyButton value={copyText} label={__ui("复制结果")} />}>
            <div className="grid gap-3 sm:grid-cols-2">
              <div
                className={cn(
                  "rounded-xl border px-4 py-3",
                  result.totalPnl >= 0 ? "border-emerald-500/30 bg-emerald-500/[0.07]" : "border-destructive/30 bg-destructive/[0.07]",
                )}
              >
                <div className="text-[11.5px] text-muted-foreground">{__ui("合计盈亏")}</div>
                <div
                  className={cn(
                    "mt-1 flex items-center gap-1.5 font-mono text-2xl font-bold",
                    result.totalPnl >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive",
                  )}
                >
                  {result.totalPnl >= 0 ? <TrendingUp className="h-5 w-5" /> : <TrendingDown className="h-5 w-5" />}
                  {yuan(result.totalPnl)}
                </div>
                <div className="text-[11px] text-muted-foreground">{__ui("元")}</div>
              </div>
              <div className="rounded-xl border border-border/60 bg-secondary/20 px-4 py-3">
                <div className="text-[11.5px] text-muted-foreground">{__ui("浮动盈亏")}</div>
                <div className="mt-1 font-mono text-xl font-bold text-foreground">{yuan(result.floatPnl)}</div>
                <div className={cn("text-[11px]", result.floatPct >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive")}>
                  {result.floatPct >= 0 ? "+" : ""}
                  {result.floatPct.toFixed(2)}%
                </div>
              </div>
            </div>

            <div className="mt-3 overflow-hidden rounded-xl border border-border/60">
              <table className="w-full border-collapse text-xs">
                <tbody>
                  {[
                    { k: "持仓股数", v: `${result.shares} 股` },
                    { k: "摊薄成本价", v: `${result.avgCost.toFixed(3)} 元` },
                    { k: "持仓成本（含费用）", v: `${yuan(result.cost)} 元` },
                    { k: "当前市值", v: `${yuan(result.marketValue)} 元` },
                    { k: "已实现盈亏", v: `${yuan(result.realized)} 元` },
                    { k: "累计手续费", v: `${yuan(result.totalFee)} 元` },
                    { k: "保本价（估算）", v: `${result.breakEven.toFixed(3)} 元` },
                  ].map((row, i) => (
                    <tr key={row.k} className={cn("border-t border-border/40 even:bg-muted/20", i === 0 && "border-t-0")}>
                      <td className="px-3 py-1.5 text-muted-foreground">{__msg(row.k)}</td>
                      <td className="px-3 py-1.5 text-right font-mono text-foreground">{row.v}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              {__ui("摊薄成本 = 累计买入金额与费用 ÷ 现有股数；卖出时按当时的摊薄成本结转已实现盈亏。 保本价按\"现价卖出并扣费后不亏\"估算，实际以券商账单为准。")}</p>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
