import { localeTag as __localeTag } from "@/lib/language";
"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/time-tools.tsx");


/**
 * 时间类工具的自带界面：时区时间转换、日出日落时间计算。
 *
 * 布局选择：
 *   · 时区时间转换 —— **模式 A（转换对照）**：一端输入时间与所在时区，另一端是一张"各城市对照表"。
 *     它的产出天生就是表格式的（同一时刻在不同地方分别是几点），所以结果必须画成表格，
 *     并且把"日期是不是跨了一天"标出来 —— 这是跨时区沟通最容易踩的坑。
 *   · 日出日落 —— **模式 B（工作台 4:8）**：左边参数（日期、经纬度、城市预设），
 *     右侧给一条"一天的太阳轨迹条"和各项时间。太阳运动本身是连续的，用一条横向时间轴表现最直观。
 */

import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Building2,
  CalendarDays,
  Clock,
  Eraser,
  Globe2,
  MapPin,
  Moon,
  Search,
  Sparkles,
  Sun,
  Sunrise,
  Sunset,
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
// 工具一：时区时间转换
// ══════════════════════════════════════════════════════════════════════

const ZONES: Array<{ id: string; city: string; label: string }> = [
  { id: "Asia/Shanghai", city: "北京", label: "中国标准时间" },
  { id: "Asia/Hong_Kong", city: "香港", label: "香港时间" },
  { id: "Asia/Taipei", city: "台北", label: "台北时间" },
  { id: "Asia/Tokyo", city: "东京", label: "日本标准时间" },
  { id: "Asia/Seoul", city: "首尔", label: "韩国标准时间" },
  { id: "Asia/Singapore", city: "新加坡", label: "新加坡时间" },
  { id: "Asia/Bangkok", city: "曼谷", label: "中南半岛时间" },
  { id: "Asia/Kolkata", city: "新德里", label: "印度标准时间" },
  { id: "Asia/Dubai", city: "迪拜", label: "海湾标准时间" },
  { id: "Europe/Moscow", city: "莫斯科", label: "莫斯科时间" },
  { id: "Europe/Berlin", city: "柏林", label: "中欧时间" },
  { id: "Europe/Paris", city: "巴黎", label: "中欧时间" },
  { id: "Europe/London", city: "伦敦", label: "格林尼治时间" },
  { id: "America/New_York", city: "纽约", label: "美国东部时间" },
  { id: "America/Chicago", city: "芝加哥", label: "美国中部时间" },
  { id: "America/Denver", city: "丹佛", label: "美国山地时间" },
  { id: "America/Los_Angeles", city: "洛杉矶", label: "美国太平洋时间" },
  { id: "America/Sao_Paulo", city: "圣保罗", label: "巴西时间" },
  { id: "Australia/Sydney", city: "悉尼", label: "澳大利亚东部时间" },
  { id: "Pacific/Auckland", city: "奥克兰", label: "新西兰时间" },
  { id: "UTC", city: "UTC", label: "协调世界时" },
];

/** 把"某时区的当地年月日时分"换算成 UTC 毫秒（不依赖第三方库） */
function zonedTimeToUtc(y: number, mo: number, d: number, h: number, mi: number, timeZone: string): number {
  // 先按 UTC 造一个候选，再看它在目标时区显示成什么，按差值修正两次（足以覆盖 DST）
  let guess = Date.UTC(y, mo - 1, d, h, mi, 0);
  for (let i = 0; i < 2; i++) {
    const shown = new Date(guess).toLocaleString("sv-SE", { timeZone, hour12: false });
    const [datePart, timePart] = shown.split(" ");
    const [sy, smo, sd] = datePart.split("-").map(Number);
    const [sh, smi, ss = 0] = timePart.split(":").map(Number);
    const shownUtc = Date.UTC(sy, smo - 1, sd, sh, smi, ss);
    const wantUtc = Date.UTC(y, mo - 1, d, h, mi, 0);
    guess += wantUtc - shownUtc;
  }
  return guess;
}

function zoneParts(ms: number, timeZone: string) {
  const fmt = new Intl.DateTimeFormat(__localeTag(), {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  });
  const parts = fmt.formatToParts(new Date(ms));
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    time: `${get("hour")}:${get("minute")}`,
    weekday: get("weekday"),
    hour: Number(get("hour")),
  };
}

/** 取某时区在某时刻的 UTC 偏移（分钟） */
function offsetMinutes(ms: number, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(new Date(ms));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value || 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return Math.round((asUtc - ms) / 60000);
}

function offsetText(min: number) {
  const sign = min >= 0 ? "+" : "-";
  const abs = Math.abs(min);
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

export function TimezoneConvertTool() {
  const __locale = __useLanguage();
  const localZone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai", [ __locale]);
  const [mode, setMode] = useToolDraft<"now" | "custom">("timezone-convert", "mode", "now");
  const [dateStr, setDateStr] = useToolDraft("timezone-convert", "date", new Date().toISOString().slice(0, 10));
  const [timeStr, setTimeStr] = useToolDraft("timezone-convert", "time", new Date().toTimeString().slice(0, 5));
  const [sourceZone, setSourceZone] = useToolDraft("timezone-convert", "sourceZone", localZone);
  const [filter, setFilter] = useState("");

  const error = useMemo(() => {
    if (mode === "custom" && !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return "日期格式应为 2026-09-15 这样";
    if (mode === "custom" && !/^\d{1,2}:\d{2}$/.test(timeStr)) return "时间格式应为 14:30 这样";
    return "";
  }, [mode, dateStr, timeStr, __locale]);

  const baseMs = useMemo(() => {
    if (mode === "now") return Date.now();
    const [y, mo, d] = dateStr.split("-").map(Number);
    const [h, mi] = timeStr.split(":").map(Number);
    if (!y || !mo || !d) return Date.now();
    return zonedTimeToUtc(y, mo, d, h || 0, mi || 0, sourceZone);
  }, [mode, dateStr, timeStr, sourceZone, __locale]);

  const sourceParts = zoneParts(baseMs, sourceZone);
  const sourceOffset = offsetMinutes(baseMs, sourceZone);

  const rows = useMemo(() => {
    const list = ZONES.filter((z) => !filter.trim() || z.city.includes(filter.trim()) || z.id.includes(filter.trim()));
    return list.map((z) => {
      const p = zoneParts(baseMs, z.id);
      const off = offsetMinutes(baseMs, z.id);
      return { ...z, ...p, off, diff: off - sourceOffset };
    });
  }, [baseMs, sourceOffset, filter, __locale]);

  const summaryText = useMemo(
    () =>
      `【${sourceParts.date} ${sourceParts.time}（${sourceZone}）】\n` +
      rows.map((r) => `${r.city.padEnd(6, "　")} ${r.date} ${r.time}  ${offsetText(r.off)}`).join("\n"),
    [sourceParts, rows, sourceZone, __locale],
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        {/* 左：输入 */}
        <div className="thin-scroll space-y-4 lg:col-span-4">
          <SectionCard
            icon={<Clock className="h-4 w-4" />}
            title={__ui("时间与所在时区")}
            extra={
              <div className="flex items-center gap-1.5">
                <Button type="button" variant="outline" size="sm" onClick={() => setMode("now")}>
                  <Sparkles className="h-3.5 w-3.5" /> {__ui("用现在时间")}</Button>
              </div>
            }
          >
            <div className="mb-3 flex gap-1.5 rounded-xl border border-border/60 bg-secondary/30 p-1">
              {[
                { id: "now" as const, label: "此刻" },
                { id: "custom" as const, label: "指定时间" },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setMode(tab.id)}
                  className={cn(
                    "flex-1 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                    mode === tab.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {__ui(tab.label)}
                </button>
              ))}
            </div>

            {mode === "custom" && (
              <div className="mb-3 grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="tz-date">{__ui("日期")}</Label>
                  <Input id="tz-date" type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} className="text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="tz-time">{__ui("时间")}</Label>
                  <Input id="tz-time" type="time" value={timeStr} onChange={(e) => setTimeStr(e.target.value)} className="text-xs" />
                </div>
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="tz-source">{__ui("这个时间是哪个时区的")}</Label>
              {/* 选项只写城市名：下拉面板宽度与触发器一致，写「北京（Asia/Shanghai）」会被截断 */}
              <Select id="tz-source" value={sourceZone} onChange={(e) => setSourceZone(e.target.value)} className="w-full">
                {ZONES.map((z) => (
                  <option key={z.id} value={z.id}>
                    {z.city}
                  </option>
                ))}
              </Select>
              <p className="text-[11px] text-muted-foreground">
                {__ui("当前选择：")}{sourceZone}
                {sourceZone === localZone ? __ui("（本机时区）") : ""}
              </p>
            </div>

            {error && <div className="mt-3"><ErrorBar message={__msg(error)} /></div>}

            <div className="mt-3 rounded-xl border border-primary/25 bg-primary/[0.06] p-3">
              <div className="text-[11px] text-muted-foreground">{__ui("换算基准（UTC 时刻）")}</div>
              <div className="mt-1 font-mono text-sm text-foreground">
                {new Date(baseMs).toISOString().replace("T", " ").slice(0, 16)} UTC
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                {__ui("来源：")}{sourceParts.date} {sourceParts.time}（{sourceParts.weekday}） {offsetText(sourceOffset)}
              </div>
            </div>
          </SectionCard>
        </div>

        {/* 右：对照表 */}
        <div className="thin-scroll space-y-4 lg:col-span-8">
          <SectionCard
            icon={<Globe2 className="h-4 w-4" />}
            title={__msg("各地对照（{0} 个城市）", rows.length)}
            extra={
              <div className="flex items-center gap-2">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder={__ui("筛城市")}
                    className="h-8 w-28 pl-7 text-[11.5px]"
                  />
                </div>
                <CopyButton value={summaryText} label={__ui("复制对照表")} />
              </div>
            }
          >
            <div className="overflow-hidden rounded-xl border border-border/70">
              <table className="w-full border-collapse text-xs">
                <thead>
                  <tr className="bg-muted/60">
                    <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("城市")}</th>
                    <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("日期")}</th>
                    <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("时间")}</th>
                    <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("星期")}</th>
                    <th className="px-3 py-2 text-right font-semibold text-foreground">{__ui("时差")}</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    const dayShift =
                      r.date > sourceParts.date ? 1 : r.date < sourceParts.date ? -1 : 0;
                    const isSource = r.id === sourceZone;
                    return (
                      <tr
                        key={r.id}
                        className={cn("border-t border-border/40", isSource && "bg-primary/[0.07]")}
                      >
                        <td className="px-3 py-2">
                          <span className="font-medium text-foreground">{r.city}</span>
                          <span className="ml-1.5 text-[10.5px] text-muted-foreground">{__ui(r.label)}</span>
                        </td>
                        <td className="px-3 py-2 font-mono text-muted-foreground">
                          {r.date}
                          {dayShift !== 0 && (
                            <span className={cn("ml-1.5 rounded px-1 text-[10px]", dayShift > 0 ? "bg-emerald-500/15 text-emerald-500" : "bg-amber-500/15 text-amber-600")}>
                              {dayShift > 0 ? __ui("+1 天") : __ui("−1 天")}
                            </span>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono text-sm font-semibold text-foreground">{r.time}</td>
                        <td className="px-3 py-2 text-muted-foreground">{r.weekday}</td>
                        <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                          {r.diff === 0 ? __ui("同一时刻") : __msg("{0}{1} 小时", r.diff > 0 ? "+" : "", (r.diff / 60).toFixed(r.diff % 60 === 0 ? 0 : 1))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              {__ui("标注「±1 天」表示该时区已为次日或前一日，跨时区约会议时需特别注意。夏令时已按各时区规则自动处理。")}</p>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 工具二：日出日落时间计算
// ══════════════════════════════════════════════════════════════════════

const CITIES: Array<{ name: string; lat: number; lon: number; zone: string }> = [
  { name: "北京", lat: 39.9042, lon: 116.4074, zone: "Asia/Shanghai" },
  { name: "上海", lat: 31.2304, lon: 121.4737, zone: "Asia/Shanghai" },
  { name: "广州", lat: 23.1291, lon: 113.2644, zone: "Asia/Shanghai" },
  { name: "深圳", lat: 22.5431, lon: 114.0579, zone: "Asia/Shanghai" },
  { name: "成都", lat: 30.5728, lon: 104.0668, zone: "Asia/Shanghai" },
  { name: "杭州", lat: 30.2741, lon: 120.1551, zone: "Asia/Shanghai" },
  { name: "西安", lat: 34.3416, lon: 108.9398, zone: "Asia/Shanghai" },
  { name: "武汉", lat: 30.5928, lon: 114.3055, zone: "Asia/Shanghai" },
  { name: "重庆", lat: 29.563, lon: 106.5516, zone: "Asia/Shanghai" },
  { name: "哈尔滨", lat: 45.8038, lon: 126.5349, zone: "Asia/Shanghai" },
  { name: "乌鲁木齐", lat: 43.8256, lon: 87.6168, zone: "Asia/Shanghai" },
  { name: "拉萨", lat: 29.65, lon: 91.1, zone: "Asia/Shanghai" },
  { name: "三亚", lat: 18.2528, lon: 109.5119, zone: "Asia/Shanghai" },
  { name: "香港", lat: 22.3193, lon: 114.1694, zone: "Asia/Hong_Kong" },
  { name: "台北", lat: 25.033, lon: 121.5654, zone: "Asia/Taipei" },
  { name: "东京", lat: 35.6762, lon: 139.6503, zone: "Asia/Tokyo" },
  { name: "首尔", lat: 37.5665, lon: 126.978, zone: "Asia/Seoul" },
  { name: "新加坡", lat: 1.3521, lon: 103.8198, zone: "Asia/Singapore" },
  { name: "悉尼", lat: -33.8688, lon: 151.2093, zone: "Australia/Sydney" },
  { name: "伦敦", lat: 51.5074, lon: -0.1278, zone: "Europe/London" },
  { name: "巴黎", lat: 48.8566, lon: 2.3522, zone: "Europe/Paris" },
  { name: "纽约", lat: 40.7128, lon: -74.006, zone: "America/New_York" },
  { name: "洛杉矶", lat: 34.0522, lon: -118.2437, zone: "America/Los_Angeles" },
  { name: "莫斯科", lat: 55.7558, lon: 37.6173, zone: "Europe/Moscow" },
  { name: "迪拜", lat: 25.2048, lon: 55.2708, zone: "Asia/Dubai" },
  { name: "开罗", lat: 30.0444, lon: 31.2357, zone: "Africa/Cairo" },
  { name: "里约热内卢", lat: -22.9068, lon: -43.1729, zone: "America/Sao_Paulo" },
  { name: "雷克雅未克", lat: 64.1466, lon: -21.9426, zone: "Atlantic/Reykjavik" },
  { name: "南极中山站", lat: -69.3733, lon: 76.3719, zone: "Antarctica/Syowa" },
];

const RAD = Math.PI / 180;

/** 时区 ID → 中文短名（下拉框很窄，长 ID 会被截断） */
const ZONE_LABELS: Record<string, string> = {
  "Asia/Shanghai": "北京时间",
  "Asia/Hong_Kong": "香港时间",
  "Asia/Taipei": "台北时间",
  "Asia/Tokyo": "东京时间",
  "Asia/Seoul": "首尔时间",
  "Asia/Singapore": "新加坡时间",
  "Australia/Sydney": "悉尼时间",
  "Europe/London": "伦敦时间",
  "Europe/Paris": "巴黎时间",
  "Europe/Moscow": "莫斯科时间",
  "Asia/Dubai": "迪拜时间",
  "Africa/Cairo": "开罗时间",
  "America/New_York": "纽约时间",
  "America/Los_Angeles": "洛杉矶时间",
  "America/Sao_Paulo": "圣保罗时间",
  "Atlantic/Reykjavik": "雷克雅未克",
  "Antarctica/Syowa": "中山站时间",
  UTC: "协调世界时",
};

/** NOAA 太阳位置算法：返回当天的日出/日落/正午/昼长（单位：分钟，UTC） */
function sunTimes(date: Date, lat: number, lon: number) {
  const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const doy = Math.floor((start - Date.UTC(date.getUTCFullYear(), 0, 0)) / 86400000);
  const g = ((2 * Math.PI) / 365) * (doy - 1 + 0.5);

  const eqtime =
    229.18 *
    (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl =
    0.006918 -
    0.399912 * Math.cos(g) +
    0.070257 * Math.sin(g) -
    0.006758 * Math.cos(2 * g) +
    0.000907 * Math.sin(2 * g) -
    0.002697 * Math.cos(3 * g) +
    0.00148 * Math.sin(3 * g);

  const zenith = (deg: number) => {
    const cosH =
      Math.cos(deg * RAD) / (Math.cos(lat * RAD) * Math.cos(decl)) - Math.tan(lat * RAD) * Math.tan(decl);
    if (cosH > 1 || cosH < -1) return null; // 极昼 / 极夜
    // 返回**度**（下面用 4 分钟/度 换算成时间）。★ 这里曾经乘过一次 4，导致昼长算成 4 倍（北京 9 月出了 50 小时）
    return Math.acos(cosH) / RAD;
  };

  const riseSet = (deg: number) => {
    const ha = zenith(deg);
    if (ha === null) return { polar: true as const, rise: null, set: null };
    return {
      polar: false as const,
      rise: 720 - 4 * (lon + ha) - eqtime,
      set: 720 - 4 * (lon - ha) - eqtime,
    };
  };

  const main = riseSet(90.833); // 日面边缘 + 大气折射
  const civil = riseSet(96); // 民用晨昏蒙影

  return { eqtime, decl, main, civil };
}

/** 把 UTC 分钟换算成某时区的"当天第几分钟"（处理跨天） */
function toLocalMinutes(utcMinutes: number, ms: number, timeZone: string) {
  const off = offsetMinutes(ms, timeZone);
  let m = utcMinutes + off;
  let dayShift = 0;
  while (m < 0) {
    m += 1440;
    dayShift -= 1;
  }
  while (m >= 1440) {
    m -= 1440;
    dayShift += 1;
  }
  return { minutes: m, dayShift };
}

function fmtMinutes(m: number) {
  const h = Math.floor(m / 60);
  const mi = Math.round(m % 60);
  return `${String(h === 24 ? 0 : h).padStart(2, "0")}:${String(mi === 60 ? 0 : mi).padStart(2, "0")}`;
}

export function SunriseSunsetTool() {
  const __locale = __useLanguage();
  const [dateStr, setDateStr] = useToolDraft("sunrise-sunset", "date", new Date().toISOString().slice(0, 10));
  const [cityName, setCityName] = useToolDraft("sunrise-sunset", "city", "北京");
  const [lat, setLat] = useToolDraft("sunrise-sunset", "lat", 39.9042);
  const [lon, setLon] = useToolDraft("sunrise-sunset", "lon", 116.4074);
  const [zone, setZone] = useToolDraft("sunrise-sunset", "zone", "Asia/Shanghai");

  const city = useMemo(() => CITIES.find((c) => c.name === cityName), [cityName, __locale]);

  const pickCity = (name: string) => {
    const c = CITIES.find((x) => x.name === name);
    if (!c) return;
    setCityName(c.name);
    setLat(c.lat);
    setLon(c.lon);
    setZone(c.zone);
  };

  const result = useMemo(() => {
    const [y, mo, d] = dateStr.split("-").map(Number);
    if (!y || !mo || !d) return { error: "请选择日期" as string, data: null };
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return { error: "纬度要在 -90~90，经度要在 -180~180", data: null };

    const date = new Date(Date.UTC(y, mo - 1, d, 12));
    const base = zonedTimeToUtc(y, mo, d, 12, 0, zone);
    const { main, civil } = sunTimes(date, lat, lon);

    const conv = (utcMin: number) => {
      const { minutes, dayShift } = toLocalMinutes(utcMin, base, zone);
      return { text: fmtMinutes(minutes), minutes, dayShift };
    };

    if (main.polar) {
      // 判断是极昼还是极夜：看当天正午太阳高度角
      const g = ((2 * Math.PI) / 365) * (Math.floor((Date.UTC(y, mo - 1, d) - Date.UTC(y, 0, 0)) / 86400000) - 0.5);
      const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
      const altitude = 90 - Math.abs(lat - decl / RAD);
      return { error: "", data: { polar: altitude > 0 ? "极昼" : "极夜", altitude, sunrise: null, sunset: null, noon: null, dayLength: null, dawn: null, dusk: null } };
    }

    const sunrise = conv(main.rise!);
    const sunset = conv(main.set!);
    const noon = conv((main.rise! + main.set!) / 2);
    const dawn = civil.polar ? null : conv(civil.rise!);
    const dusk = civil.polar ? null : conv(civil.set!);
    const dayLength = main.set! - main.rise!;
    const altitude = 90 - Math.abs(lat - (0.006918 - 0.399912 * Math.cos(((2 * Math.PI) / 365) * (Math.floor((Date.UTC(y, mo - 1, d) - Date.UTC(y, 0, 0)) / 86400000) - 0.5)) + 0.070257 * Math.sin(((2 * Math.PI) / 365) * (Math.floor((Date.UTC(y, mo - 1, d) - Date.UTC(y, 0, 0)) / 86400000) - 0.5))) / RAD);

    return {
      error: "",
      data: {
        polar: null as string | null,
        altitude,
        sunrise,
        sunset,
        noon,
        dawn,
        dusk,
        dayLength,
      },
    };
  }, [dateStr, lat, lon, zone, __locale]);

  const d = result.data;

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        {/* 左：参数 */}
        <div className="thin-scroll space-y-4 lg:col-span-4">
          <SectionCard
            icon={<MapPin className="h-4 w-4" />}
            title={__ui("地点与日期")}
            extra={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  pickCity("北京");
                  setDateStr(new Date().toISOString().slice(0, 10));
                }}
              >
                <Sparkles className="h-3.5 w-3.5" /> {__ui("填入示例")}</Button>
            }
          >
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="ss-city">{__ui("城市（选一个自动填经纬度）")}</Label>
                <Select id="ss-city" value={cityName} onChange={(e) => pickCity(e.target.value)} className="w-full">
                  <option value="">{__ui("— 自定义 —")}</option>
                  {CITIES.map((c) => (
                    <option key={c.name} value={c.name}>
                      {__ui(c.name)}
                    </option>
                  ))}
                </Select>
                {city && (
                  <p className="text-[11px] text-muted-foreground">
                    {__ui("已按「")}{__ui(city.name)}{__ui("」填入经纬度，也可在下方手动修改。")}</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ss-lat">{__ui("纬度")}</Label>
                  <Input
                    id="ss-lat"
                    type="number"
                    step="0.0001"
                    value={String(lat)}
                    onChange={(e) => {
                      setLat(Number(e.target.value));
                      setCityName("");
                    }}
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ss-lon">{__ui("经度")}</Label>
                  <Input
                    id="ss-lon"
                    type="number"
                    step="0.0001"
                    value={String(lon)}
                    onChange={(e) => {
                      setLon(Number(e.target.value));
                      setCityName("");
                    }}
                    className="text-xs"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="ss-date">{__ui("日期")}</Label>
                  <Input id="ss-date" type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} className="text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ss-zone">{__ui("时区")}</Label>
                  {/* 选项用中文短名：这里两列布局、宽度只有 ~128px，
                      直接用 America/Los_Angeles 这种 ID 会被截断（实测 143px 放不下）。
                      完整时区 ID 放在下方的说明行里。 */}
                  <Select id="ss-zone" value={zone} onChange={(e) => setZone(e.target.value)} className="text-xs">
                    {[...new Set(CITIES.map((c) => c.zone)), "UTC"].map((z) => (
                      <option key={z} value={z}>
                        {__ui(ZONE_LABELS[z]) || z}
                      </option>
                    ))}
                  </Select>
                  <p className="text-[10.5px] leading-relaxed text-muted-foreground">{zone}</p>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    const today = new Date();
                    setDateStr(today.toISOString().slice(0, 10));
                  }}
                >
                  <CalendarDays className="h-3.5 w-3.5" /> {__ui("回到今天")}</Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    pickCity("北京");
                    setDateStr(new Date().toISOString().slice(0, 10));
                  }}
                >
                  <Eraser className="h-3.5 w-3.5" /> {__ui("重置")}</Button>
              </div>
            </div>
          </SectionCard>

          <SectionCard icon={<Sun className="h-4 w-4" />} title={__ui("算法说明")}>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {__ui("使用 NOAA 太阳位置算法，考虑太阳赤纬、时差方程与大气折射（日面边缘取 −0.833°）， 与常见天文台数据一般相差 1 分钟以内。夏令时按所选时区自动处理。")}</p>
          </SectionCard>
        </div>

        {/* 右：结果 */}
        <div className="thin-scroll space-y-4 lg:col-span-8">
          {result.error ? (
            <ErrorBar message={__msg(result.error)} />
          ) : d?.polar ? (
            <SectionCard icon={<Moon className="h-4 w-4" />} title={__ui("当天")}>
              <div className="flex flex-col items-center gap-2 py-10">
                <span className="text-2xl font-bold text-primary">{d.polar}</span>
                <p className="max-w-md text-center text-xs leading-relaxed text-muted-foreground">
                  {__ui("这一天太阳在当地不会升起（或不会落下），常见于极圈以内的城市。 正午太阳高度角约")}{d.altitude?.toFixed(1)}°。
                </p>
              </div>
            </SectionCard>
          ) : d ? (
            <>
              <SectionCard icon={<Sunrise className="h-4 w-4" />} title={__ui("关键时间")}>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {[
                    { label: "日出", value: d.sunrise?.text, icon: <Sunrise className="h-4 w-4" /> },
                    { label: "正午", value: d.noon?.text, icon: <Sun className="h-4 w-4" /> },
                    { label: "日落", value: d.sunset?.text, icon: <Sunset className="h-4 w-4" /> },
                    { label: "民用晨光始", value: d.dawn?.text || "—", icon: <Sunrise className="h-4 w-4" /> },
                    { label: "民用暮光终", value: d.dusk?.text || "—", icon: <Moon className="h-4 w-4" /> },
                    {
                      label: "昼长",
                      value: d.dayLength ? `${Math.floor(d.dayLength / 60)} 小时 ${Math.round(d.dayLength % 60)} 分` : "—",
                      icon: <Clock className="h-4 w-4" />,
                    },
                  ].map((item) => (
                    <div key={item.label} className="rounded-xl border border-border/60 bg-secondary/20 px-3 py-2.5">
                      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span className="text-primary">{item.icon}</span>
                        {__ui(item.label)}
                      </div>
                      <div className="mt-1 font-mono text-lg font-semibold text-foreground">{item.value || "—"}</div>
                    </div>
                  ))}
                </div>
              </SectionCard>

              {/* 一天的太阳轨迹条 */}
              <SectionCard icon={<Sun className="h-4 w-4" />} title={__ui("一天的日照分布")}>
                {d.sunrise && d.sunset && d.dawn && d.dusk && d.dayLength ? (
                  <>
                    {/* 底色就是黑夜，上面叠一条白天 —— 这样两端（午夜前后）自然都是夜色，
                        不用分别画左右两段（之前只画了左边，右半边看着是空的） */}
                    <div className="relative h-9 w-full overflow-hidden rounded-xl border border-border/60 bg-secondary/50">
                      <div
                        className="absolute inset-y-0 bg-gradient-to-r from-amber-400/70 via-primary/70 to-amber-400/70"
                        style={{
                          left: `${(d.sunrise.minutes / 1440) * 100}%`,
                          width: `${(d.dayLength / 1440) * 100}%`,
                        }}
                      />
                      {/* 刻度（每 6 小时） */}
                      {[0, 6, 12, 18, 24].map((h) => (
                        <div key={h} className="absolute inset-y-0 border-l border-border/40" style={{ left: `${(h / 24) * 100}%` }}>
                          <span className="absolute -bottom-0.5 left-0.5 text-[9px] text-muted-foreground">{h}:00</span>
                        </div>
                      ))}
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11.5px] text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <span className="h-2.5 w-5 rounded bg-gradient-to-r from-amber-400/70 to-primary/70" /> {__ui("白天（")}{__msg(d.sunrise.text)} – {__msg(d.sunset.text)}）
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="h-2.5 w-5 rounded bg-secondary/70" /> {__ui("黑夜")}</span>
                      <span>{__ui("正午太阳高度角约")}{d.altitude?.toFixed(1)}°</span>
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-muted-foreground">{__ui("这一天没有完整的日出日落数据（极昼/极夜）。")}</p>
                )}
              </SectionCard>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
