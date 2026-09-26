"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/system-battery-tool.tsx");


/**
 * 系统类工具：电池健康详情。
 *
 * 数据来源：Windows 自带的 `powercfg /batteryreport /xml`（普通权限即可，不需要管理员）。
 * Rust 侧只负责把报告 XML 取回来，解析放在这里 —— 这份 XML 是系统机器生成的、结构固定，
 * 为它引一个 XML 库不划算。
 *
 * 布局：**模式 A'（结论卡 + 分块表格/图表）**。
 *   最上面是"健康度"结论（这是用户唯一真正关心的数），下面依次是电池信息、续航估算、
 *   容量变化历史（折线）与最近用电记录。参考的是 Windows 自带报告与 BatteryInfoView 的组织方式。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BatteryCharging,
  BatteryFull,
  BatteryLow,
  BatteryMedium,
  Clock,
  Cpu,
  Gauge,
  Info,
  Loader2,
  RefreshCw,
  ShieldCheck,
  TrendingDown,
} from "lucide-react";
import { Badge, Button } from "@/components/ui/primitives";
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

// ── XML 解析（属性扫描，够用且不引依赖）───────────────────────────────

const attr = (xml: string, name: string): string => {
  const m = xml.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1] : "";
};
const tag = (xml: string, name: string): string => {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`));
  return m ? m[1].trim() : "";
};
const num = (v: string): number => {
  const n = Number(String(v).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? n : 0;
};

/** ISO 8601 时长（PT1H9M40S / P14DT4H19M5S）→ 中文可读 */
function humanDuration(iso: string): string {
  if (!iso) return "—";
  const m = iso.match(/^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  if (!m) return iso;
  const [, d, h, mi, s] = m;
  const parts: string[] = [];
  if (Number(d)) parts.push(`${Number(d)} 天`);
  if (Number(h)) parts.push(`${Number(h)} 小时`);
  if (Number(mi)) parts.push(`${Number(mi)} 分`);
  if (!parts.length && Number(s)) parts.push(`${Math.round(Number(s))} 秒`);
  return parts.length ? parts.join(" ") : "不到 1 分钟";
}

interface BatteryData {
  system: { name: string; manufacturer: string; product: string; bios: string; osBuild: string; scanTime: string };
  battery: {
    manufacturer: string;
    serial: string;
    chemistry: string;
    design: number;
    full: number;
    cycles: number;
    date: string;
  } | null;
  runtime: { designActive: string; designCs: string; fullActive: string; fullCs: string };
  history: Array<{ start: string; end: string; design: number; full: number; cycles: number }>;
  usage: Array<{ time: string; ac: boolean; type: string; charge: number; full: number }>;
}

function parseReport(xml: string): BatteryData {
  const sys = tag(xml, "SystemInformation");
  const batt = tag(xml, "Batteries");
  const batteryBlock = tag(batt, "Battery");
  const rt = tag(xml, "RuntimeEstimates");
  const designBlock = tag(rt, "DesignCapacity");
  const fullBlock = tag(rt, "FullChargeCapacity");

  const design = num(tag(batteryBlock, "DesignCapacity"));
  const full = num(tag(batteryBlock, "FullChargeCapacity"));

  const history: BatteryData["history"] = [];
  const histBlock = tag(xml, "History");
  for (const m of histBlock.matchAll(/<HistoryEntry\b([^>]*)\/>/g)) {
    const a = m[1];
    history.push({
      start: attr(a, "LocalStartDate") || attr(a, "StartDate"),
      end: attr(a, "LocalEndDate") || attr(a, "EndDate"),
      design: num(attr(a, "DesignCapacity")),
      full: num(attr(a, "FullChargeCapacity")),
      cycles: num(attr(a, "CycleCount")),
    });
  }

  const usage: BatteryData["usage"] = [];
  const usageBlock = tag(xml, "RecentUsage");
  for (const m of usageBlock.matchAll(/<UsageEntry\b([^>]*)\/>/g)) {
    const a = m[1];
    usage.push({
      time: attr(a, "LocalTimestamp") || attr(a, "Timestamp"),
      ac: attr(a, "Ac") === "1",
      type: attr(a, "EntryType"),
      charge: num(attr(a, "ChargeCapacity")),
      full: num(attr(a, "FullChargeCapacity")),
    });
  }

  return {
    system: {
      name: tag(sys, "ComputerName"),
      manufacturer: tag(sys, "SystemManufacturer"),
      product: tag(sys, "SystemProductName"),
      bios: `${tag(sys, "BIOSVersion")} ${tag(sys, "BIOSDate")}`.trim(),
      osBuild: tag(sys, "OSBuild"),
      scanTime: tag(xml, "LocalScanTime") || tag(xml, "ScanTime"),
    },
    battery: design > 0 || full > 0
      ? {
          manufacturer: tag(batteryBlock, "Manufacturer"),
          serial: tag(batteryBlock, "SerialNumber"),
          chemistry: tag(batteryBlock, "Chemistry"),
          design,
          full,
          cycles: num(tag(batteryBlock, "CycleCount")),
          date: tag(batteryBlock, "ManufactureDate"),
        }
      : null,
    runtime: {
      designActive: tag(designBlock, "ActiveRuntime"),
      designCs: tag(designBlock, "ConnectedStandbyRuntime"),
      fullActive: tag(fullBlock, "ActiveRuntime"),
      fullCs: tag(fullBlock, "ConnectedStandbyRuntime"),
    },
    history,
    usage,
  };
}

// ══════════════════════════════════════════════════════════════════════
// 工具：电池健康详情
// ══════════════════════════════════════════════════════════════════════

export function BatteryHealthTool() {
  const __locale = __useLanguage();
  const [xml, setXml] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/battery");
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "读取电池报告失败");
      setXml(data.xml as string);
    } catch (e) {
      setXml(null);
      setError(e instanceof Error ? e.message : "读取电池报告失败");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const data = useMemo(() => (xml ? parseReport(xml) : null), [xml, __locale]);

  const health = data?.battery && data.battery.design > 0 ? (data.battery.full / data.battery.design) * 100 : null;
  const verdict =
    health === null
      ? null
      : health >= 90
        ? { text: "状态良好", tone: "good", desc: "满充容量接近设计容量，电池损耗很小。" }
        : health >= 80
          ? { text: "有一定损耗", tone: "warn", desc: "容量已下降一成左右，续航会比新机短一些，属于正常使用痕迹。" }
          : health >= 60
            ? { text: "损耗明显", tone: "warn", desc: "容量下降较多，续航明显缩短；可以考虑更换电池。" }
            : { text: "建议更换", tone: "bad", desc: "容量已大幅衰减，续航会明显不足，建议更换电池。" };

  const HistoryIcon = health === null ? BatteryFull : health >= 90 ? BatteryFull : health >= 60 ? BatteryMedium : BatteryLow;

  // 容量历史折线：用满充容量相对设计容量的比例
  const chart = useMemo(() => {
    if (!data || data.history.length === 0) return null;
    const pts = data.history
      .filter((h) => h.design > 0 && h.full > 0)
      .map((h) => ({ date: h.start.slice(0, 10), pct: (h.full / h.design) * 100 }));
    if (pts.length < 2) return null;
    const w = 640;
    const h = 140;
    const min = Math.min(...pts.map((p) => p.pct), 80);
    const max = 100;
    const x = (i: number) => (i / (pts.length - 1)) * (w - 40) + 30;
    const y = (pct: number) => h - 24 - ((pct - min) / Math.max(1, max - min)) * (h - 44);
    return {
      w,
      h,
      pts,
      path: pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.pct).toFixed(1)}`).join(" "),
      x,
      y,
      min,
      max,
    };
  }, [data, __locale]);

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="thin-scroll space-y-4 lg:col-span-7">
          <SectionCard
            icon={<HistoryIcon className="h-4 w-4" />}
            title={__ui("电池健康度")}
            extra={
              <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={() => void load()} disabled={busy}>
                <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} /> {__ui("重新检测")}</Button>
            }
          >
            {busy && !data ? (
              <div className="flex items-center justify-center gap-2 py-14 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> {__ui("正在读取系统电池报告…")}</div>
            ) : error ? (
              <ErrorBar message={__msg(error)} />
            ) : data && !data.battery ? (
              <div className="flex flex-col items-center gap-2 py-12 text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <BatteryFull className="h-5 w-5" />
                </span>
                <p className="text-sm font-medium text-foreground">{__ui("这台设备没有电池")}</p>
                <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
                  {__ui("系统报告里没有电池信息，台式机接入市电使用时属于正常情况。")}</p>
              </div>
            ) : data && health !== null && verdict ? (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-5 rounded-xl border border-primary/30 bg-primary/[0.07] px-5 py-4">
                  <div>
                    <div className="text-[11.5px] text-muted-foreground">{__ui("健康度（满充容量 ÷ 设计容量）")}</div>
                    <div className="mt-1 font-mono text-4xl font-bold text-primary">{health.toFixed(1)}%</div>
                  </div>
                  <div className="min-w-[160px] flex-1">
                    <div className="flex items-center gap-2">
                      <Badge
                        variant="outline"
                        className={cn(
                          "font-normal",
                          verdict.tone === "good" && "border-emerald-500/40 text-emerald-600 dark:text-emerald-400",
                          verdict.tone === "warn" && "border-amber-500/40 text-amber-600 dark:text-amber-400",
                          verdict.tone === "bad" && "border-destructive/40 text-destructive",
                        )}
                      >
                        {__msg(verdict.text)}
                      </Badge>
                    </div>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{__ui(verdict.desc)}</p>
                  </div>
                </div>

                <div className="h-3 w-full overflow-hidden rounded-full bg-secondary">
                  <div
                    className={cn(
                      "h-full rounded-full",
                      verdict.tone === "good" ? "bg-emerald-500" : verdict.tone === "warn" ? "bg-amber-500" : "bg-destructive",
                    )}
                    style={{ width: `${Math.max(2, Math.min(100, health))}%` }}
                  />
                </div>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    { label: "设计容量", value: `${data.battery!.design} mWh` },
                    { label: "当前满充容量", value: `${data.battery!.full} mWh` },
                    { label: "容量差额", value: `${data.battery!.design - data.battery!.full} mWh` },
                    { label: "充电循环次数", value: `${data.battery!.cycles} 次` },
                  ].map((f) => (
                    <div key={f.label} className="rounded-xl border border-border/60 bg-secondary/20 px-3 py-2">
                      <div className="text-[11px] text-muted-foreground">{__ui(f.label)}</div>
                      <div className="mt-0.5 font-mono text-[13px] font-semibold text-foreground">{f.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </SectionCard>

          {chart && (
            <SectionCard icon={<TrendingDown className="h-4 w-4" />} title={__ui("容量变化历史")}>
              <svg viewBox={`0 0 ${chart.w} ${chart.h}`} className="h-40 w-full">
                {/* 网格与刻度 */}
                {[100, 90, 80, 70].filter((v) => v >= chart.min).map((v) => (
                  <g key={v}>
                    <line x1={30} x2={chart.w - 10} y1={chart.y(v)} y2={chart.y(v)} stroke="currentColor" className="text-border" strokeWidth="1" />
                    <text x={4} y={chart.y(v) + 4} className="fill-current text-[9px] text-muted-foreground">
                      {v}%
                    </text>
                  </g>
                ))}
                <path d={chart.path} fill="none" stroke="currentColor" className="text-primary" strokeWidth="2" />
                {chart.pts.map((p, i) => (
                  <circle key={i} cx={chart.x(i)} cy={chart.y(p.pct)} r="3" className="fill-primary" />
                ))}
                <text x={30} y={chart.h - 6} className="fill-current text-[9px] text-muted-foreground">
                  {chart.pts[0].date}
                </text>
                <text x={chart.w - 60} y={chart.h - 6} className="fill-current text-[9px] text-muted-foreground">
                  {chart.pts[chart.pts.length - 1].date}
                </text>
              </svg>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                {__ui("每段记录对应系统报告里的一次统计周期，纵轴是「满充容量 ÷ 设计容量」。曲线走低说明电池在自然衰减； 数值长期不变说明这一段时间里电池状态没有明显变化。")}</p>
            </SectionCard>
          )}

          {data && data.usage.length > 0 && (
            <SectionCard
              icon={<Clock className="h-4 w-4" />}
              title={__ui("最近用电记录")}
              extra={<span className="text-[11px] text-muted-foreground">{__ui("共")}{data.usage.length} {__ui("条，显示最近 12 条")}</span>}
            >
              <div className="overflow-hidden rounded-xl border border-border/60">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="bg-muted/60">
                      <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("时间")}</th>
                      <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("供电")}</th>
                      <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("状态")}</th>
                      <th className="px-3 py-2 text-right font-semibold text-foreground">{__ui("电量")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.usage.slice(-12).reverse().map((u, i) => (
                      <tr key={i} className="border-t border-border/40 even:bg-muted/20">
                        <td className="whitespace-nowrap px-3 py-1.5 font-mono text-[11.5px] text-muted-foreground">
                          {u.time.replace("T", " ")}
                        </td>
                        <td className="px-3 py-1.5 text-foreground">{u.ac ? __ui("交流电源") : __ui("电池")}</td>
                        <td className="px-3 py-1.5 text-muted-foreground">{u.type === "Active" ? __ui("使用中") : __ui("待机")}</td>
                        <td className="px-3 py-1.5 text-right font-mono text-foreground">
                          {u.charge > 0 && u.full > 0 ? `${Math.round((u.charge / u.full) * 100)}%` : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </SectionCard>
          )}
        </div>

        <div className="thin-scroll space-y-4 lg:col-span-5">
          {data?.battery && (
            <SectionCard icon={<Cpu className="h-4 w-4" />} title={__ui("电池信息")}>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { label: "制造商", value: data.battery.manufacturer || "—" },
                  { label: "化学类型", value: data.battery.chemistry || "—" },
                  { label: "序列号", value: data.battery.serial || "—" },
                  { label: "生产日期", value: data.battery.date || "—" },
                ].map((f) => (
                  <div key={f.label} className="rounded-xl border border-border/60 bg-secondary/20 px-3 py-2">
                    <div className="text-[11px] text-muted-foreground">{__ui(f.label)}</div>
                    <div className="mt-0.5 truncate font-mono text-[12.5px] text-foreground">{f.value}</div>
                  </div>
                ))}
              </div>
              {data.system.product && (
                <p className="mt-3 text-[11.5px] leading-relaxed text-muted-foreground">
                  {__ui("设备：")}{data.system.manufacturer} {data.system.product}
                  {data.system.osBuild && __msg(" · 系统版本 {0}", data.system.osBuild)}
                </p>
              )}
            </SectionCard>
          )}

          {data?.battery && (
            <SectionCard icon={<Gauge className="h-4 w-4" />} title={__ui("续航估算")}>
              <div className="space-y-2">
                <div className="rounded-xl border border-border/60 bg-secondary/20 px-3 py-2.5">
                  <div className="text-[11.5px] text-muted-foreground">{__ui("按当前满充容量，满电可持续使用约")}</div>
                  <div className="mt-0.5 text-lg font-semibold text-foreground">{humanDuration(data.runtime.fullActive)}</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {__ui("待机（连接待机）约")}{humanDuration(data.runtime.fullCs)}
                  </div>
                </div>
                {data.runtime.designActive !== data.runtime.fullActive && (
                  <div className="rounded-xl border border-border/60 bg-secondary/20 px-3 py-2.5">
                    <div className="text-[11.5px] text-muted-foreground">{__ui("若是全新电池（设计容量），可约为")}</div>
                    <div className="mt-0.5 text-lg font-semibold text-muted-foreground">{humanDuration(data.runtime.designActive)}</div>
                  </div>
                )}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                {__ui("这是系统按最近的使用情况推算的值，会随亮度、后台程序、外接设备变化，仅供大致参考。")}</p>
            </SectionCard>
          )}

          <SectionCard icon={<ShieldCheck className="h-4 w-4" />} title={__ui("数据来源与说明")}>
            <ul className="space-y-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
              <li>
                {__ui("· 数据来自 Windows 自带的电源管理命令")}<b className="text-foreground">powercfg</b> {__ui("生成的电池报告， 与系统「电源和电池」里看到的是同一份，")}<b className="text-foreground">{__ui("不需要管理员权限")}</b>。
              </li>
              <li>
                · <b className="text-foreground">{__ui("健康度 = 当前满充容量 ÷ 设计容量")}</b>{__ui("。新电池两者接近（100% 左右）， 随着使用会缓慢下降；这也是各家电池检测工具通用的算法。")}</li>
              <li>{__ui("· 报告只写入本机临时文件、读完即删，不会上传到任何地方。")}</li>
              <li>{__ui("· 循环次数由电池固件上报，部分机型的固件不上报，这时会显示 0。")}</li>
              {data?.system.scanTime && <li>{__ui("· 本次检测时间：")}{data.system.scanTime.replace("T", " ")}</li>}
            </ul>
          </SectionCard>
        </div>
      </div>

      {busy && data && (
        <div className="flex items-center gap-2 text-[11.5px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" /> {__ui("正在重新读取系统电池报告…")}</div>
      )}
    </div>
  );
}
