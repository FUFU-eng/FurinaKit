"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/life-tools.tsx");


/**
 * 生活小工具的自带界面：生肖星座计算、TOTP 验证码生成器。
 *
 * 布局选择：
 *   · 生肖星座 —— **模式 A（转换对照）**：左边填一个出生日期，右边给出结论卡（生肖 + 星座）
 *     与完整对照表。这个工具的用法就是"输一个日期、看懂结论"，所以右侧不只是给答案，
 *     还要把"为什么是这个"（干支、星座日期区间）摆出来。
 *   · TOTP 验证码 —— **模式 B（工作台 4:8）**：左边是密钥/链接输入，右侧是**大号验证码 + 倒计时环**。
 *     用户在这里的动作是"抄一串数字"，所以验证码必须大、必须清楚看到剩余秒数。
 */

import { parseSecret, totp } from "./totp-core";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CalendarDays,
  Cat,
  Copy,
  Eraser,
  Info,
  KeyRound,
  RefreshCw,
  Shield,
  Sparkles,
  Star,
} from "lucide-react";
import { Badge, Button, Input, Label, Select, Textarea } from "@/components/ui/primitives";
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

// ══════════════════════════════════════════════════════════════════════
// 工具一：生肖星座计算
// ══════════════════════════════════════════════════════════════════════

const ZODIAC_ANIMALS = [
  { name: "鼠", branch: "子", trait: "机敏、观察力强、善于应变", years: "2020 · 2008 · 1996 · 1984 · 1972" },
  { name: "牛", branch: "丑", trait: "踏实、有耐心、责任感强", years: "2021 · 2009 · 1997 · 1985 · 1973" },
  { name: "虎", branch: "寅", trait: "果断、有冲劲、不喜欢被约束", years: "2022 · 2010 · 1998 · 1986 · 1974" },
  { name: "兔", branch: "卯", trait: "温和、细腻、讲究分寸", years: "2023 · 2011 · 1999 · 1987 · 1975" },
  { name: "龙", branch: "辰", trait: "自信、目标感强、富有感染力", years: "2024 · 2012 · 2000 · 1988 · 1976" },
  { name: "蛇", branch: "巳", trait: "冷静、洞察力强、思虑周密", years: "2025 · 2013 · 2001 · 1989 · 1977" },
  { name: "马", branch: "午", trait: "热情、行动快、向往自由", years: "2026 · 2014 · 2002 · 1990 · 1978" },
  { name: "羊", branch: "未", trait: "善良、重感情、有审美", years: "2027 · 2015 · 2003 · 1991 · 1979" },
  { name: "猴", branch: "申", trait: "聪明、学习能力强、善于钻研", years: "2028 · 2016 · 2004 · 1992 · 1980" },
  { name: "鸡", branch: "酉", trait: "认真、条理清楚、要求高", years: "2029 · 2017 · 2005 · 1993 · 1981" },
  { name: "狗", branch: "戌", trait: "可靠、讲义气、有底线", years: "2030 · 2018 · 2006 · 1994 · 1982" },
  { name: "猪", branch: "亥", trait: "厚道、随和、懂得享受生活", years: "2031 · 2019 · 2007 · 1995 · 1983" },
];

const GAN = ["甲", "乙", "丙", "丁", "戊", "己", "庚", "辛", "壬", "癸"];
const ZHI = ["子", "丑", "寅", "卯", "辰", "巳", "午", "未", "申", "酉", "戌", "亥"];

const CONSTELLATIONS = [
  { name: "摩羯座", start: "12-22", end: "01-19", element: "土象", star: "土星", trait: "务实、有规划、能承担，慢热但可靠" },
  { name: "水瓶座", start: "01-20", end: "02-18", element: "风象", star: "天王星", trait: "独立、有创见、不受成见束缚" },
  { name: "双鱼座", start: "02-19", end: "03-20", element: "水象", star: "海王星", trait: "共情力强、想象力丰富、性情温和" },
  { name: "白羊座", start: "03-21", end: "04-19", element: "火象", star: "火星", trait: "直接、行动力强、敢于挑战" },
  { name: "金牛座", start: "04-20", end: "05-20", element: "土象", star: "金星", trait: "稳健、注重品质、目标坚定" },
  { name: "双子座", start: "05-21", end: "06-21", element: "风象", star: "水星", trait: "反应快、好奇心强、善于沟通" },
  { name: "巨蟹座", start: "06-22", end: "07-22", element: "水象", star: "月亮", trait: "顾家、记忆力强、重视亲近关系" },
  { name: "狮子座", start: "07-23", end: "08-22", element: "火象", star: "太阳", trait: "有担当、重视声誉、善于带领团队" },
  { name: "处女座", start: "08-23", end: "09-22", element: "土象", star: "水星", trait: "细致、严于律己、追求完善" },
  { name: "天秤座", start: "09-23", end: "10-23", element: "风象", star: "金星", trait: "注重平衡、审美好、避免冲突" },
  { name: "天蝎座", start: "10-24", end: "11-22", element: "水象", star: "冥王星", trait: "专注、判断力强、爱憎分明" },
  { name: "射手座", start: "11-23", end: "12-21", element: "火象", star: "木星", trait: "热爱自由、乐观、心胸开阔" },
];

export function ZodiacSignTool() {
  const __locale = __useLanguage();
  const [dateStr, setDateStr] = useToolDraft("zodiac-sign", "date", "1996-08-15");

  const result = useMemo(() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim());
    if (!m) return { error: "请选择出生日期" as string, data: null };
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    if (year < 1900 || year > 2100) return { error: "年份请填 1900~2100 之间", data: null };
    const d = new Date(year, month - 1, day);
    if (d.getMonth() !== month - 1 || d.getDate() !== day) return { error: "这个日期不存在，检查一下月和日", data: null };

    // 生肖：以立春为界是严格说法，这里按更常用的"农历年"近似 —— 用公历年对 12 取模
    // （2008 鼠年：2008 % 12 = 4 → 索引 0。下面用 (year - 4) % 12 对齐）
    const zodiacIndex = ((year - 4) % 12 + 12) % 12;
    const animal = ZODIAC_ANIMALS[zodiacIndex];
    // 干支纪年：公元 4 年为甲子年
    const ganIndex = ((year - 4) % 10 + 10) % 10;
    const zhiIndex = ((year - 4) % 12 + 12) % 12;

    // 星座：按"月-日"区间判断（摩羯跨年单独处理）
    const mmdd = month * 100 + day;
    const constellation =
      CONSTELLATIONS.find((c) => {
        const s = Number(c.start.replace("-", ""));
        const e = Number(c.end.replace("-", ""));
        return s <= e ? mmdd >= s && mmdd <= e : mmdd >= s || mmdd <= e;
      }) || CONSTELLATIONS[0];

    // 周岁（按今天算）
    const now = new Date();
    let age = now.getFullYear() - year;
    if (now.getMonth() + 1 < month || (now.getMonth() + 1 === month && now.getDate() < day)) age -= 1;

    return {
      error: "",
      data: {
        year,
        month,
        day,
        animal,
        ganzhi: `${GAN[ganIndex]}${ZHI[zhiIndex]}`,
        constellation,
        age,
        weekdays: ["日", "一", "二", "三", "四", "五", "六"][d.getDay()],
      },
    };
  }, [dateStr, __locale]);

  const d = result.data;
  const copyText = d
    ? `${d.year} 年 ${d.month} 月 ${d.day} 日（${d.ganzhi}年）\n生肖：${d.animal.name}\n星座：${d.constellation.name}（${d.constellation.start.replace("-", "/")} – ${d.constellation.end.replace("-", "/")}）\n周岁：${d.age} 岁`
    : "";

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="thin-scroll space-y-4 lg:col-span-4">
          <SectionCard
            icon={<CalendarDays className="h-4 w-4" />}
            title={__ui("出生日期")}
            extra={
              <Button type="button" variant="outline" size="sm" onClick={() => setDateStr("1996-08-15")}>
                <Sparkles className="h-3.5 w-3.5" /> {__ui("填入示例")}</Button>
            }
          >
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="zs-date">{__ui("选日期")}</Label>
                <Input id="zs-date" type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} className="text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="zs-text">{__ui("或直接输入（1996-08-15）")}</Label>
                <Input
                  id="zs-text"
                  value={dateStr}
                  onChange={(e) => setDateStr(e.target.value)}
                  placeholder="1996-08-15"
                  className="font-mono text-xs"
                />
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1.5"
                onClick={() => setDateStr("")}
              >
                <Eraser className="h-3.5 w-3.5" /> {__ui("清空")}</Button>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {__ui("生肖按公历年份计算（严格以立春为界，春节前后出生者可能存在差异）。")}</p>
            </div>
          </SectionCard>
        </div>

        <div className="thin-scroll space-y-4 lg:col-span-8">
          {result.error ? (
            <ErrorBar message={__msg(result.error)} />
          ) : d ? (
            <>
              <SectionCard
                icon={<Star className="h-4 w-4" />}
                title={__ui("结果")}
                extra={<CopyButton value={copyText} label={__ui("复制结果")} />}
              >
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-primary/30 bg-primary/[0.07] px-4 py-3">
                    <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                      <Cat className="h-3.5 w-3.5" />
                      {__ui("生肖（")}{d.ganzhi}{__ui("年）")}</div>
                    <div className="mt-1 text-3xl font-bold text-primary">{__ui(d.animal.name)}</div>
                    <div className="mt-1 text-[11.5px] text-muted-foreground">{d.animal.trait}</div>
                  </div>
                  <div className="rounded-xl border border-primary/30 bg-primary/[0.07] px-4 py-3">
                    <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
                      <Star className="h-3.5 w-3.5" />
                      {__ui("星座")}</div>
                    <div className="mt-1 text-3xl font-bold text-primary">{__ui(d.constellation.name)}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5">
                      <Badge variant="outline">{d.constellation.element}</Badge>
                      <Badge variant="outline">{__ui("守护星")}{d.constellation.star}</Badge>
                    </div>
                    <div className="mt-1 text-[11.5px] text-muted-foreground">{d.constellation.trait}</div>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-3 gap-2 text-[11.5px]">
                  <div className="rounded-lg border border-border/60 bg-secondary/20 px-3 py-2">
                    <div className="text-muted-foreground">{__ui("出生星期")}</div>
                    <div className="mt-0.5 text-foreground">{__ui("星期")}{d.weekdays}</div>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-secondary/20 px-3 py-2">
                    <div className="text-muted-foreground">{__ui("周岁")}</div>
                    <div className="mt-0.5 font-mono text-foreground">{d.age} {__ui("岁")}</div>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-secondary/20 px-3 py-2">
                    <div className="text-muted-foreground">{__ui("星座区间")}</div>
                    <div className="mt-0.5 font-mono text-foreground">
                      {d.constellation.start.replace("-", "/")} – {d.constellation.end.replace("-", "/")}
                    </div>
                  </div>
                </div>
              </SectionCard>

              <SectionCard icon={<Cat className="h-4 w-4" />} title={__ui("十二生肖对照")}>
                <div className="overflow-hidden rounded-xl border border-border/60">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="bg-muted/60">
                        <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("生肖")}</th>
                        <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("地支")}</th>
                        <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("近年份")}</th>
                        <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("性格倾向")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ZODIAC_ANIMALS.map((a) => (
                        <tr
                          key={a.name}
                          className={cn("border-t border-border/40 even:bg-muted/20", a.name === d.animal.name && "bg-primary/[0.08]")}
                        >
                          <td className="px-3 py-1.5 font-medium text-foreground">
                            {__ui(a.name)}
                            {a.name === d.animal.name && <span className="ml-1 text-[10px] text-primary">{__ui("← 你的")}</span>}
                          </td>
                          <td className="px-3 py-1.5 text-muted-foreground">{a.branch}</td>
                          <td className="px-3 py-1.5 font-mono text-muted-foreground">{a.years}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{a.trait}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </SectionCard>

              <SectionCard icon={<Star className="h-4 w-4" />} title={__ui("十二星座日期与守护星")}>
                <div className="overflow-hidden rounded-xl border border-border/60">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="bg-muted/60">
                        <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("星座")}</th>
                        <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("日期")}</th>
                        <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("属性")}</th>
                        <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("守护星")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {CONSTELLATIONS.map((c) => (
                        <tr
                          key={c.name}
                          className={cn("border-t border-border/40 even:bg-muted/20", c.name === d.constellation.name && "bg-primary/[0.08]")}
                        >
                          <td className="px-3 py-1.5 font-medium text-foreground">
                            {__ui(c.name)}
                            {c.name === d.constellation.name && <span className="ml-1 text-[10px] text-primary">{__ui("← 你的")}</span>}
                          </td>
                          <td className="px-3 py-1.5 font-mono text-muted-foreground">
                            {c.start.replace("-", "/")} – {c.end.replace("-", "/")}
                          </td>
                          <td className="px-3 py-1.5 text-muted-foreground">{c.element}</td>
                          <td className="px-3 py-1.5 text-muted-foreground">{c.star}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  {__ui("星座按公历日期划分；临近交界日（如 8/23）不同资料可能相差一天，属正常现象。")}</p>
              </SectionCard>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 工具二：TOTP 验证码生成器
// ══════════════════════════════════════════════════════════════════════

export function TotpTool() {
  const __locale = __useLanguage();
  const [secret, setSecret] = useToolDraft("totp", "secret", "JBSWY3DPEHPK3PXP");
  const [code, setCode] = useState("");
  const [remaining, setRemaining] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const secretRef = useRef(secret);
  secretRef.current = secret;

  const config = useMemo(() => parseSecret(secret), [secret, __locale]);
  const valid = !("error" in config);

  useEffect(() => {
    let cancelled = false;
    let generation = 0;
    setCode("");
    setCopied(false);
    setCopyError(null);
    const tick = async () => {
      const current = ++generation;
      if (!valid) {
        setCode("");
        setError("error" in config ? config.error : null);
        return;
      }
      try {
        const now = Date.now();
        const next = await totp(config, now);
        if (cancelled || current !== generation) return;
        setCode(next);
        setError(null);
        setRemaining(config.period - Math.floor((now / 1000) % config.period));
      } catch (e) {
        if (!cancelled && current === generation) { setCode(""); setError(e instanceof Error ? e.message : "计算失败"); }
      }
    };
    void tick();
    timerRef.current = window.setInterval(() => void tick(), 1000);
    return () => {
      cancelled = true;
      if (timerRef.current) window.clearInterval(timerRef.current);
    };
  }, [config, valid]);

  const copyCode = async () => {
    if (!valid || !code || error) return;
    const requestedSecret = secret;
    try {
      // Recalculate at click time instead of copying a potentially expired displayed code.
      const fresh = await totp(config);
      if (secretRef.current !== requestedSecret) return;
      await navigator.clipboard.writeText(fresh);
      if (secretRef.current !== requestedSecret) return;
      setCopyError(null);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      setCopied(false);
      setCopyError("复制失败，请检查剪贴板权限后重试");
    }
  };

  const period = valid ? config.period : 30;
  const progress = remaining / period;

  return (
    <div className="space-y-4">
      {copyError && <p role="alert" className="text-sm text-destructive">{__msg(copyError)}</p>}
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="thin-scroll space-y-4 lg:col-span-5">
          <SectionCard
            icon={<KeyRound className="h-4 w-4" />}
            title={__ui("密钥")}
            extra={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  setSecret(
                    "otpauth://totp/FurinaKit:demo@example.com?secret=JBSWY3DPEHPK3PXP&issuer=FurinaKit&period=30&digits=6",
                  )
                }
              >
                <Sparkles className="h-3.5 w-3.5" /> {__ui("填入示例")}</Button>
            }
          >
            <Textarea
              value={secret}
              onChange={(e) => setSecret(e.target.value)}
              placeholder={__ui("粘贴 otpauth://totp/... 链接；也可以直接填 Base32 密钥（如 JBSWY3DPEHPK3PXP）")}
              className="min-h-[110px] font-mono text-[11.5px] leading-relaxed"
              spellCheck={false}
              maxLength={8192}
            />
            <div className="mt-2 flex items-center gap-2">
              <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={() => setSecret("")}>
                <Eraser className="h-3.5 w-3.5" /> {__ui("清空")}</Button>
            </div>

            {valid && (
              <div className="mt-3 space-y-1.5 rounded-xl border border-border/60 bg-background/40 p-3 text-[11.5px]">
                {config.issuer && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{__ui("服务")}</span>
                    <span className="text-foreground">{config.issuer}</span>
                  </div>
                )}
                {config.account && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">{__ui("账号")}</span>
                    <span className="truncate text-foreground">{config.account}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{__ui("位数 / 周期 / 算法")}</span>
                  <span className="font-mono text-foreground">
                    {config.digits} {__ui("位 ·")}{config.period} {__ui("秒 ·")}{config.algorithm}
                  </span>
                </div>
              </div>
            )}

            <div className="mt-3 flex items-start gap-2 rounded-xl border border-border/60 bg-secondary/20 p-3">
              <Shield className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {__ui("全部计算都在本机完成，密钥不会上传到任何地方。但请注意：")}<b className="text-foreground">{__ui("密钥等同于账号的第二把钥匙")}</b>{__ui("， 别截图发给别人。支持6–8位、1–86400秒及SHA-1/256/512；链接参数会严格校验。")}</p>
            </div>
          </SectionCard>
        </div>

        <div className="thin-scroll space-y-4 lg:col-span-7">
          {error ? (
            <ErrorBar message={__msg(error)} />
          ) : (
            <SectionCard
              icon={<Shield className="h-4 w-4" />}
              title={__ui("当前验证码")}
              extra={
                <Button type="button" variant="ghost" size="sm" className="gap-1.5" disabled={!valid || !code || !!error} onClick={() => void copyCode()}>
                  {copied ? <Info className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? __ui("已复制") : __ui("复制验证码")}
                </Button>
              }
            >
              <div className="flex flex-col items-center gap-4 py-4">
                <div className="flex items-center gap-1.5">
                  {code.split("").map((ch, i) => (
                    <span
                      key={i}
                      className="flex h-16 w-12 items-center justify-center rounded-xl border border-primary/30 bg-primary/[0.07] font-mono text-3xl font-bold text-primary"
                    >
                      {ch}
                    </span>
                  ))}
                </div>

                <div className="flex w-full max-w-xs flex-col items-center gap-1.5">
                  <div className="flex items-center gap-2 text-[12px] text-muted-foreground">
                    <RefreshCw className={cn("h-3.5 w-3.5", remaining <= 5 && "animate-spin text-destructive")} />
                    {remaining} {__ui("秒后刷新")}</div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className={cn("h-full rounded-full transition-all duration-1000", remaining <= 5 ? "bg-destructive" : "bg-primary")}
                      style={{ width: `${Math.max(0, Math.min(100, progress * 100))}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="rounded-xl border border-border/60 bg-background/40 p-3">
                <div className="mb-1 flex items-center gap-1.5 text-[11.5px] font-medium text-foreground">
                  <Info className="h-3.5 w-3.5 text-primary" /> {__ui("怎么用")}</div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {__ui("在需要二次验证的地方（网站、App）把它当作动态口令填入即可。 验证码每")}{period} {__ui("秒更新一次。")}<b className="text-foreground">{__ui("剩余时间少于 5 秒时建议等待下一个验证码")}</b>{__ui("， 以免提交时已失效。")}</p>
              </div>
            </SectionCard>
          )}

          <SectionCard icon={<KeyRound className="h-4 w-4" />} title={__ui("这些密钥从哪来")}>
            <p className="text-[12px] leading-relaxed text-muted-foreground">
              {__ui("开启两步验证时，网站通常会给你一个二维码，二维码里就是一条")}<code className="font-mono text-foreground">otpauth://</code> {__ui("链接。 使用任意二维码识别工具读出该链接后粘贴到左侧即可。手工录入时注意：")}<b className="text-foreground">{__ui("密钥只含 A–Z 与 2–7")}</b>{__ui("（Base32），看不清楚的大写字母 O 与数字 0 通常不存在于其中。")}</p>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
