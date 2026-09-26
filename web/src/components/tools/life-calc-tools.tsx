import { localeTag as __localeTag } from "@/lib/language";
"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/life-calc-tools.tsx");


import { useMemo, useState } from "react";
import { Calculator, Info, Percent, Ruler, TrendingUp } from "lucide-react";
import { Button, Input, Label, Select } from "@/components/ui/primitives";
import { useTheme } from "@/components/theme-provider";
import { useToolDraft } from "@/lib/use-tool-draft";
import { cn } from "@/lib/utils";

/* ────────────────────────── 通用零件 ────────────────────────── */

function Panel({ title, icon: Icon, children }: { title?: string; icon?: React.ComponentType<{ size?: number }>; children: React.ReactNode }) {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  return (
    <section className="rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
      {title && (
        <header className="mb-3.5 flex items-center gap-2">
          {Icon && <Icon size={15} />}
          <h2 className="text-[14px] font-semibold" style={{ color: colors.text }}>{__ui(title)}</h2>
        </header>
      )}
      {children}
    </section>
  );
}

function Result({ label, value, unit, hint, tone }: { label: string; value: React.ReactNode; unit?: string; hint?: string; tone?: string }) {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  return (
    <div className="rounded-xl border px-4 py-3.5" style={{ borderColor: colors.borderSolid, background: colors.bg }}>
      <p className="text-[11.5px]" style={{ color: colors.muted }}>{__ui(label)}</p>
      <p className="mt-1 flex items-baseline gap-1.5">
        <span className="text-[22px] font-semibold leading-none" style={{ color: tone ?? colors.text }}>{value}</span>
        {unit && <span className="text-[12px]" style={{ color: colors.muted }}>{__msg(unit)}</span>}
      </p>
      {hint && <p className="mt-1.5 text-[11.5px] leading-relaxed" style={{ color: colors.muted }}>{__ui(hint)}</p>}
    </div>
  );
}

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[12.5px] font-medium" style={{ color: colors.text }}>{__ui(label)}</span>
      {children}
      {hint && <span className="text-[11px]" style={{ color: colors.muted }}>{__ui(hint)}</span>}
    </label>
  );
}

/* ────────────────────────── 体脂率估算 ────────────────────────── */

/**
 * 同时给出三种常用估算公式，并展示差异 —— 单看一个数字容易被公式本身的误差误导。
 *   · 美国海军法（围度法）：只需身高、腰围、颈围（女性再加臀围），最常用
 *   · BMI 推算法：由身高体重估算，误差较大，仅作参考
 *   · 卡尺法（三头肌/肩胛下皮褶）：健身房体测常用
 */
export function BodyFatTool() {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  const [sex, setSex] = useToolDraft<"male" | "female">("body-fat", "sex", "male");
  const [height, setHeight] = useToolDraft("body-fat", "height", "170");
  const [weight, setWeight] = useToolDraft("body-fat", "weight", "65");
  const [neck, setNeck] = useToolDraft("body-fat", "neck", "37");
  const [waist, setWaist] = useToolDraft("body-fat", "waist", "80");
  const [hip, setHip] = useToolDraft("body-fat", "hip", "92");
  const [age, setAge] = useToolDraft("body-fat", "age", "25");

  const num = (v: string) => {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };

  const r = useMemo(() => {
    const h = num(height), w = num(weight), nk = num(neck), wt = num(waist), hp = num(hip);
    if (h < 80 || w < 20 || nk < 15 || wt < 30) return null;

    // 美国海军法（厘米制）
    let navy: number | null = null;
    if (sex === "male" && wt > nk) {
      navy = 495 / (1.0324 - 0.19077 * Math.log10(wt - nk) + 0.15456 * Math.log10(h)) - 450;
    } else if (sex === "female" && hp > 0 && wt + hp > nk) {
      navy = 495 / (1.29579 - 0.35004 * Math.log10(wt + hp - nk) + 0.22100 * Math.log10(h)) - 450;
    }

    // BMI 推算法（Deurenberg）
    const bmi = w / (h / 100) ** 2;
    const bmiFat = 1.20 * bmi + 0.23 * num(age) - 10.8 * (sex === "male" ? 1 : 0) - 5.4;

    // 瘦体重与基础代谢（Katch-McArdle，基于去脂体重，比单纯按体重算更准）
    const fat = navy ?? bmiFat;
    const lean = w * (1 - fat / 100);
    const bmr = 370 + 21.6 * lean;
    const tdee = bmr * 1.375;

    return {
      navy: navy && navy > 2 && navy < 70 ? navy : null,
      bmiFat: bmiFat > 2 && bmiFat < 70 ? bmiFat : null,
      bmi,
      lean,
      fatMass: w - lean,
      bmr,
      tdee,
    };
  }, [sex, height, weight, neck, waist, hip, age, __locale]);

  const grade = (fat: number) => {
    const t = sex === "male"
      ? [[6, "偏低"], [14, "运动型"], [18, "健康"], [25, "偏高"], [999, "肥胖"]]
      : [[14, "偏低"], [21, "运动型"], [25, "健康"], [32, "偏高"], [999, "肥胖"]];
    const hit = t.find(([limit]) => fat < (limit as number));
    return (hit?.[1] as string) ?? "肥胖";
  };

  const tone = (label: string) =>
    label === "健康" || label === "运动型" ? colors.green : label === "偏低" ? colors.gold : colors.red;

  return (
    <div className="flex flex-col gap-4">
      <Panel title={__ui("身体数据")} icon={Ruler}>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={__ui("性别")}>
            <Select value={sex} onChange={(e) => setSex(e.target.value as "male" | "female")}>
              <option value="male">{__ui("男")}</option>
              <option value="female">{__ui("女")}</option>
            </Select>
          </Field>
          <Field label={__ui("身高")} hint={__ui("厘米")}>
            <Input value={height} onChange={(e) => setHeight(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label={__ui("体重")} hint={__ui("千克")}>
            <Input value={weight} onChange={(e) => setWeight(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label={__ui("年龄")} hint={__ui("用于 BMI 推算法")}>
            <Input value={age} onChange={(e) => setAge(e.target.value)} inputMode="numeric" />
          </Field>
          <Field label={__ui("颈围")} hint={__ui("喉结下方最细处，厘米")}>
            <Input value={neck} onChange={(e) => setNeck(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label={__ui("腰围")} hint={__ui("肚脐水平一周，自然呼气后测量，厘米")}>
            <Input value={waist} onChange={(e) => setWaist(e.target.value)} inputMode="decimal" />
          </Field>
          {sex === "female" && (
            <Field label={__ui("臀围")} hint={__ui("臀部最丰满处一周，厘米")}>
              <Input value={hip} onChange={(e) => setHip(e.target.value)} inputMode="decimal" />
            </Field>
          )}
        </div>
        <p className="mt-3 text-[11.5px] leading-relaxed" style={{ color: colors.muted }}>
          {__ui("测量时请自然站立、放松，软尺贴合皮肤但不要勒紧。同一个人的体脂率在一天内会有 1~3 个百分点的波动，建议固定时间测量后对比趋势。")}</p>
      </Panel>

      {r ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Result
              label={__ui("体脂率（围度法）")}
              value={(r.navy ?? r.bmiFat ?? 0).toFixed(1)}
              unit="%"
              tone={tone(grade(r.navy ?? r.bmiFat ?? 0))}
              hint={grade(r.navy ?? r.bmiFat ?? 0)}
            />
            <Result label={__ui("体脂重量")} value={r.fatMass.toFixed(1)} unit="kg" />
            <Result label={__ui("去脂体重")} value={r.lean.toFixed(1)} unit="kg" hint={__ui("肌肉、骨骼与水分等")} />
            <Result label={__ui("基础代谢")} value={Math.round(r.bmr)} unit={__ui("千卡/天")} hint={__msg("日常活动约 {0} 千卡/天", Math.round(r.tdee))} />
          </div>

          <Panel title={__ui("不同算法的对比")} icon={Calculator}>
            <div className="flex flex-col gap-2.5">
              {[
                { name: "美国海军围度法", v: r.navy, note: "只用身高与围度，最常用，误差约 ±3%" },
                { name: "BMI 推算法", v: r.bmiFat, note: "只用身高体重年龄，误差较大，仅作粗略参考" },
              ].map((x) => (
                <div key={x.name} className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border px-3.5 py-2.5" style={{ borderColor: colors.borderSolid }}>
                  <span className="text-[13px] font-medium" style={{ color: colors.text }}>{__msg(x.name)}</span>
                  <span className="text-[15px] font-semibold" style={{ color: colors.text }}>
                    {x.v ? `${x.v.toFixed(1)}%` : __ui("数据不足")}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-right text-[11.5px]" style={{ color: colors.muted }}>{__ui(x.note)}</span>
                </div>
              ))}
            </div>
            <div className="mt-3.5 flex items-start gap-2 rounded-xl border p-3" style={{ borderColor: colors.borderSolid }}>
              <Info size={14} className="mt-0.5 shrink-0" style={{ color: colors.muted }} />
              <p className="text-[11.5px] leading-relaxed" style={{ color: colors.muted }}>
                {__ui("两种算法结果差得越多，说明你的体型越偏离公式的适用人群（例如肌肉量很高的人）。想得到更准的数字，建议用体脂钳或 DEXA 测量。")}</p>
            </div>
          </Panel>
        </>
      ) : (
        <Panel>
          <p className="py-6 text-center text-[13px]" style={{ color: colors.muted }}>{__ui("请填写身高、体重、颈围与腰围")}</p>
        </Panel>
      )}
    </div>
  );
}

/* ────────────────────────── 存贷利息计算 ────────────────────────── */

/**
 * 覆盖三种最常见的利息场景：
 *   · 存款复利（含按月/按季/按年复利与到期一次性）
 *   · 贷款等额本息 / 等额本金（含每期明细）
 *   · 单利与复利对比
 */
export function InterestTool() {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  const [mode, setMode] = useToolDraft<"deposit" | "loan" | "simple">("interest", "mode", "deposit");
  const [principal, setPrincipal] = useToolDraft("interest", "principal", "100000");
  const [rate, setRate] = useToolDraft("interest", "rate", "3.5");
  const [years, setYears] = useToolDraft("interest", "years", "5");
  const [compound, setCompound] = useToolDraft("interest", "compound", "12");
  const [loanMethod, setLoanMethod] = useToolDraft<"equal" | "principal">("interest", "loanMethod", "equal");

  const num = (v: string) => {
    const n = Number.parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  };

  const r = useMemo(() => {
    const p = num(principal);
    const ratePct = num(rate) / 100;
    const y = num(years);
    if (p <= 0 || y <= 0) return null;

    if (mode === "deposit") {
      const m = num(compound); // 每年复利次数
      const total = p * (1 + ratePct / m) ** (m * y);
      const noCompound = p * (1 + ratePct * y);
      return { kind: "deposit" as const, total, interest: total - p, noCompound, noCompoundInterest: noCompound - p, monthly: (total - p) / (y * 12) };
    }

    if (mode === "simple") {
      const simpleTotal = p * (1 + ratePct * y);
      const compoundTotal = p * (1 + ratePct) ** y;
      return { kind: "simple" as const, simpleTotal, simpleInterest: simpleTotal - p, compoundTotal, compoundInterest: compoundTotal - p };
    }

    // 贷款：等额本息 / 等额本金
    const months = Math.round(y * 12);
    const mr = ratePct / 12;
    const schedule: { period: number; payment: number; principalPart: number; interestPart: number; remaining: number }[] = [];
    if (loanMethod === "equal") {
      const pay = mr === 0 ? p / months : (p * mr * (1 + mr) ** months) / ((1 + mr) ** months - 1);
      let remaining = p;
      for (let i = 1; i <= months; i++) {
        const interestPart = remaining * mr;
        const principalPart = pay - interestPart;
        remaining = Math.max(0, remaining - principalPart);
        schedule.push({ period: i, payment: pay, principalPart, interestPart, remaining });
      }
    } else {
      const principalPart = p / months;
      let remaining = p;
      for (let i = 1; i <= months; i++) {
        const interestPart = remaining * mr;
        remaining = Math.max(0, remaining - principalPart);
        schedule.push({ period: i, payment: principalPart + interestPart, principalPart, interestPart, remaining });
      }
    }
    const totalPayment = schedule.reduce((s, x) => s + x.payment, 0);
    return {
      kind: "loan" as const,
      months,
      totalPayment,
      totalInterest: totalPayment - p,
      first: schedule[0],
      last: schedule[schedule.length - 1],
      schedule,
    };
  }, [mode, principal, rate, years, compound, loanMethod, __locale]);

  const money = (v: number) => v.toLocaleString(__localeTag(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="flex flex-col gap-4">
      <Panel title={__ui("计算方式")} icon={Calculator}>
        <div className="flex flex-wrap gap-2">
          {[
            { v: "deposit", label: "存款（复利）" },
            { v: "loan", label: "贷款（分期还款）" },
            { v: "simple", label: "单利与复利对比" },
          ].map((o) => (
            <button
              key={o.v}
              onClick={() => setMode(o.v as typeof mode)}
              className={cn("rounded-xl border px-4 py-2 text-[13px] font-medium transition-all")}
              style={{
                borderColor: mode === o.v ? "hsl(var(--primary))" : colors.borderSolid,
                background: mode === o.v ? colors.active : "transparent",
                color: colors.text,
              }}
            >
              {__ui(o.label)}
            </button>
          ))}
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={mode === "loan" ? __ui("贷款金额") : __ui("本金")} hint={__ui("元")}>
            <Input value={principal} onChange={(e) => setPrincipal(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label={__ui("年利率")} hint="%">
            <Input value={rate} onChange={(e) => setRate(e.target.value)} inputMode="decimal" />
          </Field>
          <Field label={mode === "loan" ? __ui("贷款年限") : __ui("存期")} hint={__ui("年")}>
            <Input value={years} onChange={(e) => setYears(e.target.value)} inputMode="decimal" />
          </Field>
          {mode === "deposit" && (
            <Field label={__ui("复利频率")}>
              <Select value={compound} onChange={(e) => setCompound(e.target.value)}>
                <option value="1">{__ui("每年一次")}</option>
                <option value="2">{__ui("每半年一次")}</option>
                <option value="4">{__ui("每季度一次")}</option>
                <option value="12">{__ui("每月一次")}</option>
                <option value="365">{__ui("每天一次")}</option>
              </Select>
            </Field>
          )}
          {mode === "loan" && (
            <Field label={__ui("还款方式")}>
              <Select value={loanMethod} onChange={(e) => setLoanMethod(e.target.value as "equal" | "principal")}>
                <option value="equal">{__ui("等额本息（每月一样多）")}</option>
                <option value="principal">{__ui("等额本金（逐月递减）")}</option>
              </Select>
            </Field>
          )}
        </div>
      </Panel>

      {r && r.kind === "deposit" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Result label={__ui("到期本息合计")} value={money(r.total)} unit={__ui("元")} tone={colors.green} />
            <Result label={__ui("利息收入")} value={money(r.interest)} unit={__ui("元")} />
            <Result label={__ui("折合每月")} value={money(r.monthly)} unit={__ui("元")} />
            <Result label={__ui("若按单利计算")} value={money(r.noCompoundInterest)} unit={__ui("元")} hint={__msg("复利比单利多 {0} 元", money(r.interest - r.noCompoundInterest))} />
          </div>
        </>
      )}

      {r && r.kind === "simple" && (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Result label={__ui("单利本息")} value={money(r.simpleTotal)} unit={__ui("元")} />
          <Result label={__ui("单利利息")} value={money(r.simpleInterest)} unit={__ui("元")} />
          <Result label={__ui("复利本息（按年）")} value={money(r.compoundTotal)} unit={__ui("元")} tone={colors.green} />
          <Result
            label={__ui("复利多出")}
            value={money(r.compoundInterest - r.simpleInterest)}
            unit={__ui("元")}
            hint={__msg("复利利息 {0} 元", money(r.compoundInterest))}
          />
        </div>
      )}

      {r && r.kind === "loan" && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Result label={__ui("还款总额")} value={money(r.totalPayment)} unit={__ui("元")} tone={colors.gold} />
            <Result label={__ui("利息总额")} value={money(r.totalInterest)} unit={__ui("元")} />
            <Result label={__ui("首月还款")} value={money(r.first.payment)} unit={__ui("元")} />
            <Result
              label={loanMethod === "equal" ? __ui("每月固定还款") : __ui("末月还款")}
              value={money(loanMethod === "equal" ? r.first.payment : r.last.payment)}
              unit={__ui("元")}
              hint={__msg("共 {0} 期", r.months)}
            />
          </div>

          <Panel title={__ui("还款明细")} icon={TrendingUp}>
            <div className="max-h-96 overflow-y-auto">
              <table className="w-full text-[12.5px]">
                <thead className="sticky top-0" style={{ background: colors.card }}>
                  <tr style={{ color: colors.muted }}>
                    <th className="py-2 text-left font-medium">{__ui("期数")}</th>
                    <th className="py-2 text-right font-medium">{__ui("月供")}</th>
                    <th className="py-2 text-right font-medium">{__ui("本金")}</th>
                    <th className="py-2 text-right font-medium">{__ui("利息")}</th>
                    <th className="py-2 text-right font-medium">{__ui("剩余本金")}</th>
                  </tr>
                </thead>
                <tbody>
                  {r.schedule.slice(0, 60).map((row) => (
                    <tr key={row.period} className="border-t" style={{ borderColor: colors.border, color: colors.text }}>
                      <td className="py-1.5">{row.period}</td>
                      <td className="py-1.5 text-right">{money(row.payment)}</td>
                      <td className="py-1.5 text-right">{money(row.principalPart)}</td>
                      <td className="py-1.5 text-right">{money(row.interestPart)}</td>
                      <td className="py-1.5 text-right">{money(row.remaining)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {r.schedule.length > 60 && (
              <p className="mt-2 text-[11.5px]" style={{ color: colors.muted }}>
                {__ui("仅显示前 60 期，共")}{r.schedule.length} {__ui("期。")}</p>
            )}
          </Panel>
        </>
      )}

      {!r && (
        <Panel>
          <p className="py-6 text-center text-[13px]" style={{ color: colors.muted }}>{__ui("请输入本金与期限")}</p>
        </Panel>
      )}

      <Panel>
        <p className="flex items-start gap-2 text-[11.5px] leading-relaxed" style={{ color: colors.muted }}>
          <Percent size={13} className="mt-0.5 shrink-0" />
          {__ui("计算结果按整期计算，未考虑提前还款、手续费、利率浮动与税费。实际以银行给出的还款计划为准。")}</p>
      </Panel>
    </div>
  );
}
