import { localeTag as __localeTag } from "@/lib/language";
"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage, uiCount as __count } from "@/lib/language";
const __ui = __createUiText("components/tools/health-tools.tsx");


/**
 * 健康与运动类工具的自带界面：基础代谢、卡路里缺口、跑步配速、睡眠周期。
 *
 * 布局选择：
 *   · 基础代谢 / 卡路里缺口 —— **模式 B（工作台 4:8）**：左边几个参数，右边是"算出来的结论 + 建议"。
 *     这类工具的价值不在数字本身，而在**数字意味着什么**（该吃多少、多久能到目标），
 *     所以右侧给足空间放结论卡与对照表，而不是把结果挤成一行。
 *   · 跑步配速 —— **模式 A（转换对照）**：配速、速度、完赛时间三者本来就是同一个量的不同写法，
 *     改任一个另两个跟着变，左右并排最容易看懂"改了会怎样"；下面再给每公里分段与赛程预测。
 *   · 睡眠周期 —— **模式 C（两端对照）**：一端是"要几点起"，另一端是"该几点睡"，天然对称。
 *
 * 所有公式都写在注释里并标注来源，便于核对；不编造"专家建议"。
 */

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Activity,
  BedDouble,
  CalendarClock,
  Clock,
  Eraser,
  Flame,
  Footprints,
  Gauge,
  HeartPulse,
  Info,
  Moon,
  Sparkles,
  Sun,
  Timer,
  TrendingDown,
  User,
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

// 活动量档位。
// ★ 选项文案必须短：下拉面板宽度与触发器一致，标签过长会被截断成
//   "轻度活动 · 每周运动 1~3 次（×1.3…"（作者反馈过看不到完整文案）。
//   所以 label 只保留档位名与系数，详细说明放到选项下方的提示行，并跟随选中项变化。
const ACTIVITY_LEVELS = [
  { value: 1.2, label: "久坐（×1.2）", hint: "几乎不运动，办公室为主" },
  { value: 1.375, label: "轻度活动（×1.375）", hint: "每周运动 1~3 次" },
  { value: 1.55, label: "中度活动（×1.55）", hint: "每周运动 3~5 次" },
  { value: 1.725, label: "高度活动（×1.725）", hint: "每周运动 6~7 次" },
  { value: 1.9, label: "极高强度（×1.9）", hint: "体力劳动或每天两练" },
];

const num = (v: string) => (v.trim() === "" ? NaN : Number(v));

// ══════════════════════════════════════════════════════════════════════
// 工具一：基础代谢（BMR）与每日消耗（TDEE）
// ══════════════════════════════════════════════════════════════════════

export function BmrCalculatorTool() {
  const __locale = __useLanguage();
  const [gender, setGender] = useToolDraft<"male" | "female">("bmr-calculator", "gender", "male");
  const [age, setAge] = useToolDraft("bmr-calculator", "age", "28");
  const [height, setHeight] = useToolDraft("bmr-calculator", "height", "170");
  const [weight, setWeight] = useToolDraft("bmr-calculator", "weight", "65");
  const [activity, setActivity] = useToolDraft("bmr-calculator", "activity", 1.375);

  const result = useMemo(() => {
    const a = num(age);
    const h = num(height);
    const w = num(weight);
    if (![a, h, w].every((x) => Number.isFinite(x))) return { error: "年龄、身高、体重都要填数字" as string, data: null };
    if (a < 10 || a > 100) return { error: "年龄请填 10~100 之间", data: null };
    if (h < 100 || h > 250) return { error: "身高请填 100~250 厘米之间", data: null };
    if (w < 25 || w > 300) return { error: "体重请填 25~300 公斤之间", data: null };

    // Mifflin-St Jeor（目前公认最准的估算式）
    const mifflin = 10 * w + 6.25 * h - 5 * a + (gender === "male" ? 5 : -161);
    // Harris-Benedict 修订版（做参考）
    const harris = gender === "male" ? 88.362 + 13.397 * w + 4.799 * h - 5.677 * a : 447.593 + 9.247 * w + 3.098 * h - 4.33 * a;
    const bmr = mifflin;
    const tdee = bmr * activity;
    const bmi = w / Math.pow(h / 100, 2);
    const bmiText = bmi < 18.5 ? "偏瘦" : bmi < 24 ? "正常" : bmi < 28 ? "偏胖" : "肥胖";
    const idealLow = 18.5 * Math.pow(h / 100, 2);
    const idealHigh = 23.9 * Math.pow(h / 100, 2);

    return {
      error: "",
      data: {
        mifflin,
        harris,
        bmr,
        tdee,
        bmi,
        bmiText,
        idealLow,
        idealHigh,
        protein: w * 1.6, // 普通健身人群常用 1.6 g/kg
        water: w * 35, // 常见建议 35 ml/kg
      },
    };
  }, [gender, age, height, weight, activity, __locale]);

  const d = result.data;
  const level = ACTIVITY_LEVELS.find((l) => l.value === activity);

  const copyText = d
    ? `基础代谢（BMR）：${Math.round(d.bmr)} 千卡/天\n每日总消耗（TDEE）：${Math.round(d.tdee)} 千卡/天\n减脂参考：${Math.round(d.tdee * 0.8)} 千卡/天\n增肌参考：${Math.round(d.tdee * 1.15)} 千卡/天`
    : "";

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="thin-scroll space-y-4 lg:col-span-4">
          <SectionCard
            icon={<User className="h-4 w-4" />}
            title={__ui("基本信息")}
            extra={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setGender("male");
                  setAge("28");
                  setHeight("170");
                  setWeight("65");
                  setActivity(1.375);
                }}
              >
                <Sparkles className="h-3.5 w-3.5" /> {__ui("填入示例")}</Button>
            }
          >
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>{__ui("性别")}</Label>
                <div className="flex gap-1.5 rounded-xl border border-border/60 bg-secondary/30 p-1">
                  {[
                    { id: "male" as const, label: "男" },
                    { id: "female" as const, label: "女" },
                  ].map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setGender(g.id)}
                      className={cn(
                        "flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                        gender === g.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {__ui(g.label)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="bmr-age">{__ui("年龄")}</Label>
                  <Input id="bmr-age" type="number" value={age} onChange={(e) => setAge(e.target.value)} className="text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bmr-height">{__ui("身高 cm")}</Label>
                  <Input id="bmr-height" type="number" value={height} onChange={(e) => setHeight(e.target.value)} className="text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bmr-weight">{__ui("体重 kg")}</Label>
                  <Input id="bmr-weight" type="number" value={weight} onChange={(e) => setWeight(e.target.value)} className="text-xs" />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="bmr-activity">{__ui("日常活动量")}</Label>
                <Select
                  id="bmr-activity"
                  value={String(activity)}
                  onChange={(e) => setActivity(Number(e.target.value))}
                  className="w-full"
                >
                  {ACTIVITY_LEVELS.map((l) => (
                    <option key={l.value} value={l.value}>
                      {__ui(l.label)}
                    </option>
                  ))}
                </Select>
                {level ? (
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {__ui(level.hint)}{__ui("；每日总消耗 = 基础代谢 ×")}{level.value}
                  </p>
                ) : null}
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    setAge("");
                    setHeight("");
                    setWeight("");
                  }}
                >
                  <Eraser className="h-3.5 w-3.5" /> {__ui("清空")}</Button>
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
                icon={<Flame className="h-4 w-4" />}
                title={__ui("你的每日消耗")}
                extra={<CopyButton value={copyText} label={__ui("复制结论")} />}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-primary/25 bg-primary/[0.06] px-4 py-3">
                    <div className="text-[11.5px] text-muted-foreground">{__ui("基础代谢 BMR（躺着不动也要消耗）")}</div>
                    <div className="mt-1 font-mono text-2xl font-bold text-primary">
                      {Math.round(d.bmr)} <span className="text-sm font-normal">{__ui("千卡/天")}</span>
                    </div>
                  </div>
                  <div className="rounded-xl border border-primary/25 bg-primary/[0.06] px-4 py-3">
                    <div className="text-[11.5px] text-muted-foreground">
                      {__ui("每日总消耗 TDEE（含")}{__ui(level?.label) || __ui("日常活动")}）
                    </div>
                    <div className="mt-1 font-mono text-2xl font-bold text-primary">
                      {Math.round(d.tdee)} <span className="text-sm font-normal">{__ui("千卡/天")}</span>
                    </div>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 text-[11.5px]">
                  <div className="rounded-lg border border-border/60 bg-secondary/20 px-3 py-2">
                    <div className="text-muted-foreground">{__ui("减脂（−20%）")}</div>
                    <div className="mt-0.5 font-mono text-foreground">{Math.round(d.tdee * 0.8)} {__ui("千卡")}</div>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-secondary/20 px-3 py-2">
                    <div className="text-muted-foreground">{__ui("维持体重")}</div>
                    <div className="mt-0.5 font-mono text-foreground">{Math.round(d.tdee)} {__ui("千卡")}</div>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-secondary/20 px-3 py-2">
                    <div className="text-muted-foreground">{__ui("增肌（+15%）")}</div>
                    <div className="mt-0.5 font-mono text-foreground">{Math.round(d.tdee * 1.15)} {__ui("千卡")}</div>
                  </div>
                </div>
              </SectionCard>

              <SectionCard icon={<HeartPulse className="h-4 w-4" />} title={__ui("身体数据参考")}>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-border/60 bg-secondary/20 px-3 py-2.5">
                    <div className="text-[11px] text-muted-foreground">BMI</div>
                    <div className="mt-0.5 font-mono text-lg font-semibold text-foreground">{d.bmi.toFixed(1)}</div>
                    <Badge variant="outline" className="mt-1">
                      {d.bmiText}
                    </Badge>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-secondary/20 px-3 py-2.5">
                    <div className="text-[11px] text-muted-foreground">{__ui("理想体重区间")}</div>
                    <div className="mt-0.5 font-mono text-lg font-semibold text-foreground">
                      {d.idealLow.toFixed(0)}–{d.idealHigh.toFixed(0)}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{__ui("公斤（按 BMI 18.5–23.9）")}</div>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-secondary/20 px-3 py-2.5">
                    <div className="text-[11px] text-muted-foreground">{__ui("每日蛋白 / 饮水参考")}</div>
                    <div className="mt-0.5 font-mono text-lg font-semibold text-foreground">
                      {Math.round(d.protein)} g / {Math.round(d.water / 100) / 10} L
                    </div>
                    <div className="text-[11px] text-muted-foreground">{__ui("普通健身人群水平")}</div>
                  </div>
                </div>

                <div className="mt-3 rounded-xl border border-border/60 bg-background/40 p-3">
                  <div className="mb-1.5 flex items-center gap-1.5 text-[11.5px] font-medium text-foreground">
                    <Info className="h-3.5 w-3.5 text-primary" /> {__ui("两种公式对照")}</div>
                  <table className="w-full text-[11.5px]">
                    <tbody>
                      <tr className="border-b border-border/40">
                        <td className="py-1.5 text-muted-foreground">{__ui("Mifflin-St Jeor（本工具采用）")}</td>
                        <td className="py-1.5 text-right font-mono text-foreground">{Math.round(d.mifflin)} {__ui("千卡")}</td>
                      </tr>
                      <tr>
                        <td className="py-1.5 text-muted-foreground">{__ui("Harris-Benedict 修订版（参考）")}</td>
                        <td className="py-1.5 text-right font-mono text-foreground">{Math.round(d.harris)} {__ui("千卡")}</td>
                      </tr>
                    </tbody>
                  </table>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">
                    {__ui("两者均为估算公式，个体差异可达 ±10%。以体重变化反推最为准确：连续两周在相同时间称重，按每周体重变化 ×7700 千卡 反算。")}</p>
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
// 工具二：卡路里缺口计算
// ══════════════════════════════════════════════════════════════════════

export function CalorieDeficitTool() {
  const __locale = __useLanguage();
  const [gender, setGender] = useToolDraft<"male" | "female">("calorie-deficit", "gender", "male");
  const [age, setAge] = useToolDraft("calorie-deficit", "age", "28");
  const [height, setHeight] = useToolDraft("calorie-deficit", "height", "170");
  const [weight, setWeight] = useToolDraft("calorie-deficit", "weight", "70");
  const [target, setTarget] = useToolDraft("calorie-deficit", "target", "65");
  const [weeks, setWeeks] = useToolDraft("calorie-deficit", "weeks", "10");
  const [activity, setActivity] = useToolDraft("calorie-deficit", "activity", 1.375);

  const result = useMemo(() => {
    const a = num(age), h = num(height), w = num(weight), t = num(target), wk = num(weeks);
    if (![a, h, w, t, wk].every((x) => Number.isFinite(x))) return { error: "请把各项都填成数字", data: null, warn: [] as string[] };
    if (a < 10 || a > 100) return { error: "年龄请填 10~100 之间", data: null, warn: [] };
    if (h < 100 || h > 250) return { error: "身高请填 100~250 厘米之间", data: null, warn: [] };
    if (w < 25 || w > 300) return { error: "当前体重请填 25~300 公斤之间", data: null, warn: [] };
    if (t < 25 || t > 300) return { error: "目标体重请填 25~300 公斤之间", data: null, warn: [] };
    if (wk < 1 || wk > 104) return { error: "周期请填 1~104 周（最多两年）", data: null, warn: [] };

    const bmr = 10 * w + 6.25 * h - 5 * a + (gender === "male" ? 5 : -161);
    const tdee = bmr * activity;
    const totalChange = (t - w) * 7700; // 1 公斤脂肪约 7700 千卡
    const dailyDelta = totalChange / (wk * 7); // 正=需要盈余，负=需要缺口
    const dailyIntake = tdee + dailyDelta;
    const weeklyChange = (t - w) / wk;
    const endDate = new Date(Date.now() + wk * 7 * 86400000);

    const warn: string[] = [];
    if (dailyIntake < (gender === "male" ? 1500 : 1200)) {
      warn.push(
        `目标摄入 ${Math.round(dailyIntake)} 千卡已经低于健康下限（${gender === "male" ? "男 1500" : "女 1200"} 千卡），建议把周期拉长。`,
      );
    }
    if (Math.abs(weeklyChange) > w * 0.01) {
      warn.push(
        `计划每周变化 ${Math.abs(weeklyChange).toFixed(2)} 公斤，超过体重的 1%（约 ${(w * 0.01).toFixed(2)} 公斤/周）。减重速度过快易造成肌肉流失，建议延长周期。`,
      );
    }
    if (t > w && weeklyChange > 0.5) warn.push("增重速度超过每周 0.5 公斤时，增加部分以脂肪为主，建议放缓。");

    return {
      error: "",
      data: { bmr, tdee, dailyDelta, dailyIntake, weeklyChange, endDate, totalChange, weeks: wk },
      warn,
    };
  }, [gender, age, height, weight, target, weeks, activity, __locale]);

  const d = result.data;

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="thin-scroll space-y-4 lg:col-span-4">
          <SectionCard
            icon={<TrendingDown className="h-4 w-4" />}
            title={__ui("身体与目标")}
            extra={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setGender("male");
                  setAge("28");
                  setHeight("170");
                  setWeight("70");
                  setTarget("65");
                  setWeeks("10");
                  setActivity(1.375);
                }}
              >
                <Sparkles className="h-3.5 w-3.5" /> {__ui("填入示例")}</Button>
            }
          >
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>{__ui("性别")}</Label>
                <div className="flex gap-1.5 rounded-xl border border-border/60 bg-secondary/30 p-1">
                  {[
                    { id: "male" as const, label: "男" },
                    { id: "female" as const, label: "女" },
                  ].map((g) => (
                    <button
                      key={g.id}
                      type="button"
                      onClick={() => setGender(g.id)}
                      className={cn(
                        "flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                        gender === g.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {__ui(g.label)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cd-age">{__ui("年龄")}</Label>
                  <Input id="cd-age" type="number" value={age} onChange={(e) => setAge(e.target.value)} className="text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cd-height">{__ui("身高")}</Label>
                  <Input id="cd-height" type="number" value={height} onChange={(e) => setHeight(e.target.value)} className="text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cd-weight">{__ui("现在 kg")}</Label>
                  <Input id="cd-weight" type="number" value={weight} onChange={(e) => setWeight(e.target.value)} className="text-xs" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="cd-target">{__ui("目标 kg")}</Label>
                  <Input id="cd-target" type="number" value={target} onChange={(e) => setTarget(e.target.value)} className="text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="cd-weeks">{__ui("周期（周）")}</Label>
                  <Input id="cd-weeks" type="number" value={weeks} onChange={(e) => setWeeks(e.target.value)} className="text-xs" />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="cd-activity">{__ui("日常活动量")}</Label>
                <Select id="cd-activity" value={String(activity)} onChange={(e) => setActivity(Number(e.target.value))} className="w-full">
                  {ACTIVITY_LEVELS.map((l) => (
                    <option key={l.value} value={l.value}>
                      {__ui(l.label)}
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  setAge("");
                  setHeight("");
                  setWeight("");
                  setTarget("");
                  setWeeks("");
                }}
              >
                <Eraser className="h-3.5 w-3.5" /> {__ui("清空")}</Button>
            </div>
          </SectionCard>
        </div>

        <div className="thin-scroll space-y-4 lg:col-span-8">
          {result.error ? (
            <ErrorBar message={__msg(result.error)} />
          ) : d ? (
            <>
              {result.warn && result.warn.length > 0 && (
                <div className="space-y-2">
                  {result.warn.map((wnt, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-2 rounded-xl border-l-4 border-l-amber-500 bg-amber-500/10 px-4 py-3 text-[12px] leading-relaxed text-foreground"
                    >
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                      <span>{wnt}</span>
                    </div>
                  ))}
                </div>
              )}

              <SectionCard icon={<Flame className="h-4 w-4" />} title={__ui("每天该吃多少")}>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-border/60 bg-secondary/20 px-4 py-3">
                    <div className="text-[11.5px] text-muted-foreground">{__ui("每日总消耗 TDEE")}</div>
                    <div className="mt-1 font-mono text-xl font-bold text-foreground">{Math.round(d.tdee)}</div>
                    <div className="text-[11px] text-muted-foreground">{__ui("千卡")}</div>
                  </div>
                  <div
                    className={cn(
                      "rounded-xl border px-4 py-3",
                      d.dailyDelta < 0 ? "border-emerald-500/30 bg-emerald-500/[0.07]" : "border-primary/25 bg-primary/[0.06]",
                    )}
                  >
                    <div className="text-[11.5px] text-muted-foreground">{d.dailyDelta < 0 ? __ui("每日缺口") : __ui("每日盈余")}</div>
                    <div className="mt-1 font-mono text-xl font-bold text-foreground">{Math.abs(Math.round(d.dailyDelta))}</div>
                    <div className="text-[11px] text-muted-foreground">{__ui("千卡")}</div>
                  </div>
                  <div className="rounded-xl border border-primary/30 bg-primary/[0.08] px-4 py-3">
                    <div className="text-[11.5px] text-muted-foreground">{__ui("建议每日摄入")}</div>
                    <div className="mt-1 font-mono text-xl font-bold text-primary">{Math.round(d.dailyIntake)}</div>
                    <div className="text-[11px] text-muted-foreground">{__ui("千卡")}</div>
                  </div>
                </div>

                <div className="mt-3 rounded-xl border border-border/60 bg-background/40 p-3 text-[12px] leading-relaxed">
                  <div className="mb-1 flex items-center gap-1.5 font-medium text-foreground">
                    <CalendarClock className="h-3.5 w-3.5 text-primary" /> {__ui("按这个计划")}</div>
                  <p className="text-muted-foreground">
                    {__ui("每周变化")}<b className="font-mono text-foreground">{Math.abs(d.weeklyChange).toFixed(2)} {__ui("公斤")}</b>
                    （{d.weeklyChange < 0 ? __ui("减少") : __ui("增加")}），
                    <b className="font-mono text-foreground">{d.weeks}</b> {__ui("周后约达到目标， 预计日期")}<b className="text-foreground">{d.endDate.toLocaleDateString(__localeTag())}</b>。
                  </p>
                  <p className="mt-1.5 text-[11px] text-muted-foreground">
                    {__ui("换算依据：1 公斤体重变化约 7700 千卡。这是理论值，实际会因水分、肌肉变化而波动。")}</p>
                </div>
              </SectionCard>

              <SectionCard icon={<Activity className="h-4 w-4" />} title={__ui("缺口怎么来：吃少一点，或动多一点")}>
                <div className="overflow-hidden rounded-xl border border-border/60">
                  <table className="w-full border-collapse text-xs">
                    <tbody>
                      {[
                        { name: "少喝一瓶含糖饮料（500ml）", kcal: 210 },
                        { name: "少吃一碗白米饭", kcal: 230 },
                        { name: "快走 1 小时（约 6 km）", kcal: 280 },
                        { name: "慢跑 30 分钟", kcal: 300 },
                        { name: "跳绳 20 分钟", kcal: 250 },
                        { name: "骑自行车 45 分钟（休闲）", kcal: 260 },
                      ].map((item, i) => (
                        <tr key={item.name} className={cn("border-t border-border/40", i === 0 && "border-t-0", "even:bg-muted/20")}>
                          <td className="px-3 py-2 text-foreground">{__ui(item.name)}</td>
                          <td className="px-3 py-2 text-right font-mono text-muted-foreground">{__ui("约")}{item.kcal} {__ui("千卡")}</td>
                          <td className="px-3 py-2 text-right text-muted-foreground">
                            {__ui("约占目标的")}{Math.round((item.kcal / Math.max(1, Math.abs(d.dailyDelta))) * 100)}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  {__ui("热耗为估算值，随体重与运动强度变化，无需精确到个位。")}</p>
              </SectionCard>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 工具三：跑步配速计算
// ══════════════════════════════════════════════════════════════════════

const RACE_DISTANCES = [
  { name: "5 公里", km: 5 },
  { name: "10 公里", km: 10 },
  { name: "半程马拉松", km: 21.0975 },
  { name: "全程马拉松", km: 42.195 },
];

function paceText(secondsPerKm: number) {
  const m = Math.floor(secondsPerKm / 60);
  const s = Math.round(secondsPerKm % 60);
  return `${m}'${String(s).padStart(2, "0")}"`;
}
function hms(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.round(totalSeconds % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}
function parseTime(text: string): number | null {
  const parts = text.trim().split(":").map((x) => Number(x));
  if (parts.some((x) => !Number.isFinite(x))) return null;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 1) return parts[0] * 60;
  return null;
}

export function RunningPaceTool() {
  const __locale = __useLanguage();
  const [distance, setDistance] = useToolDraft("running-pace", "distance", "10");
  const [time, setTime] = useToolDraft("running-pace", "time", "50:00");
  const [unit, setUnit] = useToolDraft<"km" | "mi">("running-pace", "unit", "km");

  const result = useMemo(() => {
    const km = num(distance);
    const seconds = parseTime(time);
    if (!Number.isFinite(km) || km <= 0) return { error: "距离请填一个大于 0 的数字（公里）", data: null };
    if (seconds === null || seconds <= 0) return { error: "时间格式不对，按 50:00 或 1:45:30 这样填", data: null };

    const perKm = seconds / km;
    const speedKmh = 3600 / perKm;
    const perMile = perKm * 1.609344;
    const speedMph = speedKmh / 1.609344;

    // Riegel 公式：T2 = T1 × (D2/D1)^1.06，用来估算其它距离的完赛时间
    const predictions = RACE_DISTANCES.map((r) => ({
      ...r,
      seconds: seconds * Math.pow(r.km / km, 1.06),
      pace: (seconds * Math.pow(r.km / km, 1.06)) / r.km,
    }));

    // 每公里分段（最多列 12 段，超出只给汇总）
    const splits = Array.from({ length: Math.min(12, Math.ceil(km)) }, (_, i) => ({
      index: i + 1,
      cumulative: Math.round(perKm * (i + 1)),
    }));

    return { error: "", data: { km, seconds, perKm, speedKmh, perMile, speedMph, predictions, splits, more: Math.max(0, Math.ceil(km) - 12) } };
  }, [distance, time, __locale]);

  const d = result.data;
  const isMi = unit === "mi";

  const copyText = d
    ? `距离 ${d.km} 公里　用时 ${hms(d.seconds)}\n配速 ${paceText(d.perKm)}/km（${paceText(d.perMile)}/mi）\n速度 ${d.speedKmh.toFixed(2)} km/h`
    : "";

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="thin-scroll space-y-4 lg:col-span-4">
          <SectionCard
            icon={<Footprints className="h-4 w-4" />}
            title={__ui("距离与时间")}
            extra={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setDistance("10");
                  setTime("50:00");
                }}
              >
                <Sparkles className="h-3.5 w-3.5" /> {__ui("填入示例")}</Button>
            }
          >
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {RACE_DISTANCES.map((r) => (
                  <button
                    key={r.name}
                    type="button"
                    onClick={() => setDistance(String(r.km))}
                    className={cn(
                      "rounded-lg px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                      Number(distance) === r.km ? "bg-primary text-primary-foreground" : "bg-secondary/40 text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {__ui(r.name)}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="rp-distance">{__ui("距离（公里）")}</Label>
                  <Input id="rp-distance" type="number" step="0.01" value={distance} onChange={(e) => setDistance(e.target.value)} className="text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rp-time">{__ui("用时（时:分:秒）")}</Label>
                  <Input id="rp-time" value={time} onChange={(e) => setTime(e.target.value)} placeholder="50:00" className="font-mono text-xs" />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>{__ui("配速用哪种单位显示")}</Label>
                <div className="flex gap-1.5 rounded-xl border border-border/60 bg-secondary/30 p-1">
                  {[
                    { id: "km" as const, label: "每公里" },
                    { id: "mi" as const, label: "每英里" },
                  ].map((u) => (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => setUnit(u.id)}
                      className={cn(
                        "flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                        unit === u.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                      )}
                    >
                      {__ui(u.label)}
                    </button>
                  ))}
                </div>
              </div>

              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5"
                onClick={() => {
                  setDistance("");
                  setTime("");
                }}
              >
                <Eraser className="h-3.5 w-3.5" /> {__ui("清空")}</Button>
            </div>
          </SectionCard>
        </div>

        <div className="thin-scroll space-y-4 lg:col-span-8">
          {result.error ? (
            <ErrorBar message={__msg(result.error)} />
          ) : d ? (
            <>
              <SectionCard
                icon={<Gauge className="h-4 w-4" />}
                title={__ui("配速与速度")}
                extra={<CopyButton value={copyText} label={__ui("复制结果")} />}
              >
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-primary/30 bg-primary/[0.07] px-4 py-3">
                    <div className="text-[11.5px] text-muted-foreground">{__ui("配速")}</div>
                    <div className="mt-1 font-mono text-2xl font-bold text-primary">
                      {isMi ? paceText(d.perMile) : paceText(d.perKm)}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{__ui("每")}{isMi ? __ui("英里") : __ui("公里")}</div>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-secondary/20 px-4 py-3">
                    <div className="text-[11.5px] text-muted-foreground">{__ui("速度")}</div>
                    <div className="mt-1 font-mono text-2xl font-bold text-foreground">
                      {(isMi ? d.speedMph : d.speedKmh).toFixed(2)}
                    </div>
                    <div className="text-[11px] text-muted-foreground">{isMi ? __ui("英里") : __ui("公里")}{__ui("/小时")}</div>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-secondary/20 px-4 py-3">
                    <div className="text-[11.5px] text-muted-foreground">{__ui("另一种写法")}</div>
                    <div className="mt-1 font-mono text-lg font-semibold text-foreground">
                      {isMi ? `${paceText(d.perKm)}/km` : `${paceText(d.perMile)}/mi`}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {isMi ? d.speedKmh.toFixed(2) + " km/h" : d.speedMph.toFixed(2) + " mph"}
                    </div>
                  </div>
                </div>
              </SectionCard>

              <SectionCard icon={<Timer className="h-4 w-4" />} title={__ui("每公里分段（匀速策略）")}>
                <div className="overflow-hidden rounded-xl border border-border/60">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="bg-muted/60">
                        <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("公里")}</th>
                        <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("单段用时")}</th>
                        <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("累计")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.splits.map((s) => (
                        <tr key={s.index} className="border-t border-border/40 even:bg-muted/20">
                          <td className="px-3 py-1.5 text-foreground">{__ui("第")}{s.index} {__ui("公里")}</td>
                          <td className="px-3 py-1.5 font-mono text-muted-foreground">{hms(d.perKm)}</td>
                          <td className="px-3 py-1.5 font-mono text-muted-foreground">{hms(s.cumulative)}</td>
                        </tr>
                      ))}
                      {d.more > 0 && (
                        <tr className="border-t border-border/40">
                          <td colSpan={3} className="px-3 py-2 text-[11px] text-muted-foreground">
                            {__ui("后面还有")}{d.more} {__ui("公里，每公里同样是")}{hms(d.perKm)}
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </SectionCard>

              <SectionCard icon={<Activity className="h-4 w-4" />} title={__ui("按这个配速，其它赛程能跑多少")}>
                <div className="overflow-hidden rounded-xl border border-border/60">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="bg-muted/60">
                        <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("赛程")}</th>
                        <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("预计完赛")}</th>
                        <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("对应配速")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.predictions.map((p) => (
                        <tr key={p.name} className={cn("border-t border-border/40 even:bg-muted/20", Math.abs(p.km - d.km) < 0.01 && "bg-primary/[0.07]")}>
                          <td className="px-3 py-2 font-medium text-foreground">{__ui(p.name)}</td>
                          <td className="px-3 py-2 font-mono text-foreground">{hms(p.seconds)}</td>
                          <td className="px-3 py-2 font-mono text-muted-foreground">{paceText(p.pace)}/km</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  {__ui("用 Riegel 公式（T₂ = T₁ × (D₂/D₁)^1.06）外推，距离越长误差越大，只作参考。")}</p>
              </SectionCard>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 工具四：睡眠周期计算
// ══════════════════════════════════════════════════════════════════════

const SLEEP_ADVICE = [
  { group: "青少年（14–17 岁）", hours: "8–10 小时" },
  { group: "成年人（18–64 岁）", hours: "7–9 小时" },
  { group: "老年人（65 岁以上）", hours: "7–8 小时" },
];

function minutesToClock(total: number) {
  let m = total % 1440;
  if (m < 0) m += 1440;
  const h = Math.floor(m / 60);
  const mi = Math.round(m % 60);
  return `${String(h).padStart(2, "0")}:${String(mi === 60 ? 0 : mi).padStart(2, "0")}`;
}

export function SleepCycleTool() {
  const __locale = __useLanguage();
  const [mode, setMode] = useToolDraft<"wake" | "sleep">("sleep-cycle", "mode", "wake");
  const [wakeTime, setWakeTime] = useToolDraft("sleep-cycle", "wakeTime", "07:00");
  const [sleepTime, setSleepTime] = useToolDraft("sleep-cycle", "sleepTime", "23:30");
  const [fallAsleep, setFallAsleep] = useToolDraft("sleep-cycle", "fallAsleep", "15");

  const result = useMemo(() => {
    const toMin = (t: string) => {
      const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
      if (!m) return null;
      const h = Number(m[1]), mi = Number(m[2]);
      if (h > 23 || mi > 59) return null;
      return h * 60 + mi;
    };
    const buffer = num(fallAsleep);
    if (!Number.isFinite(buffer) || buffer < 0 || buffer > 120) return { error: "入睡耗时请填 0~120 分钟", cycles: [] };

    const anchor = mode === "wake" ? toMin(wakeTime) : toMin(sleepTime);
    if (anchor === null) return { error: "时间格式应为 07:00 这样", cycles: [] };

    // 一个周期约 90 分钟；入睡耗时要从躺下时间里扣掉
    const cycles = [3, 4, 5, 6].map((n) => {
      const span = n * 90 + buffer;
      const clock = mode === "wake" ? anchor - span : anchor + span;
      return {
        n,
        clock: minutesToClock(clock),
        sleepHours: n * 1.5,
        crossesDay: mode === "wake" ? anchor - span < 0 : anchor + span >= 1440,
      };
    });
    return { error: "", cycles };
  }, [mode, wakeTime, sleepTime, fallAsleep, __locale]);

  const best = result.cycles.find((c) => c.n === 5);

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        {/* 左：我要几点起 */}
        <div className="thin-scroll space-y-4 lg:col-span-6">
          <SectionCard
            icon={<Sun className="h-4 w-4" />}
            title={__ui("我要几点起床")}
            extra={
              <Button type="button" variant="outline" size="sm" onClick={() => { setMode("wake"); setWakeTime("07:00"); setFallAsleep("15"); }}>
                <Sparkles className="h-3.5 w-3.5" /> {__ui("填入示例")}</Button>
            }
          >
            <button
              type="button"
              onClick={() => setMode("wake")}
              className={cn(
                "mb-3 w-full rounded-xl border px-3 py-2 text-left text-[12px] transition-colors",
                mode === "wake" ? "border-primary/50 bg-primary/[0.07] text-foreground" : "border-border/60 text-muted-foreground hover:bg-muted",
              )}
            >
              {mode === "wake" ? "✓ " : ""}{__ui("按起床时间倒推该几点睡")}</button>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="sc-wake">{__ui("起床时间")}</Label>
                <Input id="sc-wake" type="time" value={wakeTime} onChange={(e) => { setWakeTime(e.target.value); setMode("wake"); }} className="text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sc-fall">{__ui("入睡需要（分钟）")}</Label>
                <Input id="sc-fall" type="number" value={fallAsleep} onChange={(e) => setFallAsleep(e.target.value)} className="text-xs" />
              </div>
            </div>

            {mode === "wake" && !result.error && (
              <div className="mt-3 space-y-2">
                {result.cycles.map((c) => (
                  <div
                    key={c.n}
                    className={cn(
                      "flex items-center justify-between rounded-xl border px-3 py-2",
                      c.n === 5 ? "border-primary/45 bg-primary/[0.07]" : "border-border/60 bg-background/40",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-lg font-semibold text-foreground">{c.clock}</span>
                      {c.crossesDay && <Badge variant="secondary">{__ui("前一天")}</Badge>}
                      {c.n === 5 && <Badge variant="outline" className="text-primary">{__ui("推荐")}</Badge>}
                    </div>
                    <span className="text-[11.5px] text-muted-foreground">
                      {c.n} {__ui("个周期 · 睡约")}{__count(c.sleepHours, "小时")} </span>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        {/* 右：我现在睡 */}
        <div className="thin-scroll space-y-4 lg:col-span-6">
          <SectionCard icon={<Moon className="h-4 w-4" />} title={__ui("我现在就睡")}>
            <button
              type="button"
              onClick={() => setMode("sleep")}
              className={cn(
                "mb-3 w-full rounded-xl border px-3 py-2 text-left text-[12px] transition-colors",
                mode === "sleep" ? "border-primary/50 bg-primary/[0.07] text-foreground" : "border-border/60 text-muted-foreground hover:bg-muted",
              )}
            >
              {mode === "sleep" ? "✓ " : ""}{__ui("按入睡时间推算该几点起")}</button>
            <div className="space-y-1.5">
              <Label htmlFor="sc-sleep">{__ui("打算几点躺下")}</Label>
              <Input id="sc-sleep" type="time" value={sleepTime} onChange={(e) => { setSleepTime(e.target.value); setMode("sleep"); }} className="text-xs" />
            </div>

            {mode === "sleep" && !result.error && (
              <div className="mt-3 space-y-2">
                {result.cycles.map((c) => (
                  <div
                    key={c.n}
                    className={cn(
                      "flex items-center justify-between rounded-xl border px-3 py-2",
                      c.n === 5 ? "border-primary/45 bg-primary/[0.07]" : "border-border/60 bg-background/40",
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-lg font-semibold text-foreground">{c.clock}</span>
                      {c.crossesDay && <Badge variant="secondary">{__ui("次日")}</Badge>}
                      {c.n === 5 && <Badge variant="outline" className="text-primary">{__ui("推荐")}</Badge>}
                    </div>
                    <span className="text-[11.5px] text-muted-foreground">
                      {c.n} {__ui("个周期 · 睡约")}{__count(c.sleepHours, "小时")} </span>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>

          {result.error ? (
            <ErrorBar message={__msg(result.error)} />
          ) : (
            <SectionCard icon={<Info className="h-4 w-4" />} title={__ui("为什么按 90 分钟算")}>
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                {__ui("一个睡眠周期约 90 分钟，依次经历浅睡、深睡与快速眼动（做梦）阶段。")}<b className="text-foreground">{__ui("在周期末尾醒来")}</b>{__ui("通常比在深睡中途被闹钟叫醒要清醒得多， 所以推荐时间是\"整周期数 + 入睡耗时\"。")}{best ? __msg("你选的是 5 个周期（约 {0} 小时），属于成年人常见范围。", best.sleepHours) : ""}
              </p>
              <div className="mt-3 overflow-hidden rounded-xl border border-border/60">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-muted/60">
                      <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("人群")}</th>
                      <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("建议睡眠时长")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {SLEEP_ADVICE.map((s) => (
                      <tr key={s.group} className="border-t border-border/40 even:bg-muted/20">
                        <td className="px-3 py-1.5 text-foreground">{__ui(s.group)}</td>
                        <td className="px-3 py-1.5 font-mono text-muted-foreground">{s.hours}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                {__ui("时长范围参考美国国家睡眠基金会（NSF）的公开建议。")}</p>
            </SectionCard>
          )}
        </div>
      </div>
    </div>
  );
}
