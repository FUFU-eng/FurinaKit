import { localeTag as __localeTag } from "@/lib/language";
"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/system-info-tools.tsx");


import { normalizeSystemInfo } from "@/lib/system-info-format";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, AlertCircle, Battery, BatteryCharging, Check, Copy, Cpu, HardDrive, ShieldAlert, ShieldCheck,
  Loader2, MemoryStick, Monitor, Network, RefreshCw, Server, Thermometer, Wifi,
} from "lucide-react";
import { Button, ProgressBar } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

/* ────────────────────────── 通用零件 ────────────────────────── */

function useInfo<T = Record<string, unknown>>(section: string, refreshMs = 0) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);
  const tick = useRef(0);
  const inFlight = useRef(false);

  const load = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    try {
      const res = await fetch(`/api/system/info?section=${section}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "读取失败");
      if (!json.data || typeof json.data !== "object" || Array.isArray(json.data)) {
        throw new Error("硬件接口未返回有效数据，请检查桌面服务版本");
      }
      setData((json.format === "cim-v1" ? normalizeSystemInfo(section, json.data) : json.data) as T);
      setError("");
      setUpdatedAt(new Date());
    } catch (err) {
      setError(err instanceof Error ? err.message : "读取失败");
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }, [section]);

  useEffect(() => {
    void load();
    if (!refreshMs) return;
    const timer = setInterval(() => {
      tick.current += 1;
      void load();
    }, refreshMs);
    return () => clearInterval(timer);
  }, [load, refreshMs]);

  return { data, error, loading, updatedAt, reload: load };
}

/**
 * 管理员权限提示。
 *
 * 有几项信息只有提权后才读得到：安全启动的固件实测值、TPM 规范版本、
 * 固态硬盘的磨损度/通电时间/读写错误计数，以及系统级缓存的清理。
 * 未提权时在这里提示，并提供一键以管理员身份重启（会弹出 Windows 的 UAC 确认框）。
 */
export function AdminNotice({ compact = false }: { compact?: boolean }) {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [available, setAvailable] = useState(true);

  useEffect(() => {
    const api = (window as unknown as { furinakit?: { isElevated?: () => Promise<boolean>; relaunchAsAdmin?: () => Promise<unknown> } }).furinakit;
    if (!api?.relaunchAsAdmin) setAvailable(false);
  }, []);

  const elevate = async () => {
    const api = (window as unknown as { furinakit?: { relaunchAsAdmin?: () => Promise<{ success?: boolean; error?: string }> } }).furinakit;
    if (!api?.relaunchAsAdmin) return;
    setBusy(true);
    try {
      const r = await api.relaunchAsAdmin();
      if (r && r.success === false && r.error) {
        toast({ title: "无法提权", description: r.error, variant: "error" });
      } else {
        toast({
          title: "正在以管理员身份重启",
          description: "请在 Windows 弹出的窗口里点「是」，软件会自动重新打开",
          variant: "info",
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="flex flex-wrap items-start gap-3 rounded-xl border p-4"
      style={{ borderColor: `${colors.gold}66`, background: `${colors.gold}12` }}
    >
      <ShieldAlert size={16} className="mt-0.5 shrink-0" style={{ color: colors.gold }} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium" style={{ color: colors.text }}>
          {__ui("部分信息需要管理员权限")}</p>
        <p className="mt-1 text-[11.5px] leading-relaxed" style={{ color: colors.muted }}>
          {compact
            ? __ui("系统临时文件、Windows 更新缓存等系统级缓存的体积统计与清理，需要管理员权限才能完成。")
            : __ui("以管理员身份运行后，才能读取安全启动的固件实测值、TPM 规范版本，以及固态硬盘的磨损度、通电时间与读写错误计数。")}
        </p>
      </div>
      {available && (
        <Button size="sm" variant="outline" className="shrink-0 gap-1.5" onClick={() => void elevate()} disabled={busy}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
          {__ui("以管理员身份重启")}</Button>
      )}
    </div>
  );
}

function Card({
  title,
  icon: Icon,
  children,
  action,
  className,
}: {
  title?: string;
  icon?: React.ComponentType<{ size?: number; className?: string }>;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  return (
    <section
      className={cn("rounded-2xl border p-5", className)}
      style={{ borderColor: colors.borderSolid, background: colors.card }}
    >
      {title && (
        <header className="mb-3.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {Icon && <Icon size={15} className="shrink-0" />}
            <h2 className="text-[14px] font-semibold" style={{ color: colors.text }}>{__ui(title)}</h2>
          </div>
          {__msg(action)}
        </header>
      )}
      {children}
    </section>
  );
}

function Row({ label, value, mono, tone }: { label: string; value: React.ReactNode; mono?: boolean; tone?: string }) {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  return (
    <div className="flex items-start justify-between gap-4 border-b py-2 last:border-0" style={{ borderColor: colors.border }}>
      <span className="shrink-0 text-[12.5px]" style={{ color: colors.muted }}>{__ui(label)}</span>
      <span
        className={cn("min-w-0 break-all text-right text-[13px]", mono && "font-mono text-[12.5px]")}
        style={{ color: tone ?? colors.text }}
      >
        {value ?? "—"}
      </span>
    </div>
  );
}

function Stat({ label, value, unit, tone }: { label: string; value: React.ReactNode; unit?: string; tone?: string }) {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  return (
    <div className="rounded-xl border px-3.5 py-3" style={{ borderColor: colors.borderSolid, background: colors.bg }}>
      <p className="text-[11.5px]" style={{ color: colors.muted }}>{__ui(label)}</p>
      <p className="mt-1 text-[19px] font-semibold leading-none" style={{ color: tone ?? colors.text }}>
        {value}
        {unit && <span className="ml-1 text-[12px] font-normal" style={{ color: colors.muted }}>{__msg(unit)}</span>}
      </p>
    </div>
  );
}

function Bar({ label, value, text }: { label?: string; value: number; text?: string }) {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  const v = Math.max(0, Math.min(100, Math.round(value)));
  const tone = v >= 90 ? colors.red : v >= 70 ? colors.gold : colors.green;
  return (
    <div>
      {(label || text) && (
        <div className="mb-1 flex items-center justify-between text-[11.5px]" style={{ color: colors.muted }}>
          <span className="truncate">{__ui(label)}</span>
          <span className="shrink-0">{text ?? `${v}%`}</span>
        </div>
      )}
      <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: colors.btnHover }}>
        <div className="h-full rounded-full transition-all duration-500" style={{ width: `${v}%`, background: tone }} />
      </div>
    </div>
  );
}

function Shell({
  section,
  title,
  icon: Icon,
  refreshMs = 0,
  children,
}: {
  section: string;
  title: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  refreshMs?: number;
  children: (data: Record<string, unknown>) => React.ReactNode;
}) {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  const { toast } = useToast();
  const { data, error, loading, updatedAt, reload } = useInfo(section, refreshMs);
  const [busy, setBusy] = useState(false);

  // 整块信息导出成文本，方便贴给售后或截图归档
  const report = useMemo(() => {
    if (!data) return "";
    const lines: string[] = [`【${title}】FurinaKit 导出`, `导出时间：${new Date().toLocaleString(__localeTag())}`, ""];
    const walk = (obj: unknown, prefix = "") => {
      if (obj === null || obj === undefined) return;
      if (Array.isArray(obj)) {
        obj.forEach((item, i) => {
          if (typeof item === "object" && item !== null) {
            lines.push(`${prefix}[${i + 1}]`);
            walk(item, prefix + "  ");
          } else lines.push(`${prefix}${item}`);
        });
        return;
      }
      if (typeof obj === "object") {
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          if (v === null || v === undefined || v === "") continue;
          if (typeof v === "object") {
            lines.push(`${prefix}${k}:`);
            walk(v, prefix + "  ");
          } else lines.push(`${prefix}${k}: ${v}`);
        }
        return;
      }
      lines.push(`${prefix}${obj}`);
    };
    walk(data);
    return lines.join("\n");
  }, [data, title, __locale]);

  const copyReport = async () => {
    try {
      await navigator.clipboard.writeText(report);
      toast({ title: "已复制完整信息", description: "可以直接粘贴给他人查看", variant: "success" });
    } catch {
      toast({ title: "复制失败", description: "请手动选中文字后复制", variant: "error" });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-[12px]" style={{ color: colors.muted }}>
          <Icon size={14} />
          <span>{__ui(title)}</span>
          {refreshMs > 0 && (
            <span className="flex items-center gap-1">
              <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full" style={{ background: colors.green }} />
              {__ui("实时刷新")}</span>
          )}
          {updatedAt && <span>· {updatedAt.toLocaleTimeString(__localeTag())}</span>}
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="gap-1.5"
            disabled={busy || loading}
            onClick={async () => {
              setBusy(true);
              await reload();
              setBusy(false);
            }}
          >
            {busy ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
            {__ui("刷新")}</Button>
          <Button size="sm" variant="outline" className="gap-1.5" onClick={copyReport} disabled={!data}>
            <Copy size={13} /> {__ui("复制信息")}</Button>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3.5">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <p className="text-[12.5px] text-destructive">{__msg(error)}</p>
        </div>
      )}

      {data?.elevated === false && <AdminNotice />}

      {loading && !data && (
        <div className="flex items-center justify-center gap-2 py-16 text-[13px]" style={{ color: colors.muted }}>
          <Loader2 size={16} className="animate-spin" /> {__ui("正在离线检测中……")}</div>
      )}

      {data && children(data)}
    </div>
  );
}

const s = (v: unknown, fallback = "—") => (v === null || v === undefined || v === "" ? fallback : String(v));
const n = (v: unknown, digits = 1) => (v === null || v === undefined ? "—" : Number(v).toFixed(digits));

/* ────────────────────────── 1. 设备概况 ────────────────────────── */

export function SystemOverviewTool() {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  return (
    <Shell section="overview" title={__ui("设备概况")} icon={Server}>
      {(d) => (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={__ui("操作系统")} value={s(d.osName).replace("Microsoft ", "")} />
            <Stat label={__ui("内存总量")} value={s(d.totalMemoryGB)} unit="GB" />
            <Stat label={__ui("处理器核心")} value={s(d.cpuCores)} unit={__msg("核 {0} 线程", s(d.cpuThreads))} />
            <Stat label={__ui("已运行")} value={s(d.uptimeText)} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title={__ui("系统")} icon={Server}>
              <Row label={__ui("系统版本")} value={`${s(d.osName)} (${s(d.osBuild)})`} />
              <Row label={__ui("系统架构")} value={s(d.osArch)} />
              <Row label={__ui("激活状态")} value={s(d.activatedText)} tone={s(d.activatedText) === "已激活" ? colors.green : colors.gold} />
              <Row label={__ui("计算机名")} value={s(d.hostname)} mono />
              <Row label={__ui("品牌型号")} value={`${s(d.manufacturer)} ${s(d.model)}`} />
              <Row label={__ui("显示器数量")} value={s(d.monitorCount)} />
            </Card>
            <Card title={__ui("硬件摘要")} icon={Cpu}>
              <Row label={__ui("处理器")} value={s(d.cpuName)} />
              <Row label={__ui("显卡")} value={s(d.gpuNames)} />
              <Row label={__ui("内存")} value={`${s(d.totalMemoryGB)} GB（可用 ${s(d.freeMemoryGB)} GB）`} />
              <Row label={__ui("磁盘")} value={`${s(d.diskCount)} 块 / 共 ${s(d.diskTotalGB)} GB`} />
              <Row label={__ui("上次开机")} value={d.lastBoot ? new Date(String(d.lastBoot)).toLocaleString(__localeTag()) : "—"} />
            </Card>
          </div>
          <Card>
            <p className="text-[11.5px] leading-relaxed" style={{ color: colors.muted }}>
              {__ui("以上信息全部在本机读取，不会上传到任何服务器。点击右上角「复制信息」可导出完整文本。")}</p>
          </Card>
        </div>
      )}
    </Shell>
  );
}

/* ────────────────────────── 2. 处理器与内存 ────────────────────────── */

export function CpuMemoryTool() {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  return (
    <Shell section="cpu" title={__ui("处理器与内存")} icon={Cpu} refreshMs={2000}>
      {(d) => {
        const coreUsage = Array.isArray(d.coreUsage) ? (d.coreUsage as number[]) : [];
        return (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label={__ui("处理器占用")} value={s(d.usageTotal, "0")} unit="%" tone={Number(d.usageTotal) > 85 ? colors.red : undefined} />
              <Stat label={__ui("内存占用")} value={n(d.memUsage)} unit="%" />
              <Stat label={__ui("已用内存")} value={s(d.usedMemGB)} unit={`GB / ${s(d.totalMemGB)} GB`} />
              <Stat label={__ui("当前频率")} value={s(d.curClock)} unit="MHz" />
            </div>

            <Card title={s(d.name)} icon={Cpu}>
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="flex flex-col gap-3">
                  <Bar label={__ui("处理器总占用")} value={Number(d.usageTotal) || 0} />
                  <Bar
                    label={__msg("内存 {0} / {1} GB", s(d.usedMemGB), s(d.totalMemGB))}
                    value={Number(d.memUsage) || 0}
                  />
                  <Bar
                    label={__msg("提交内存 {0} / {1} GB", s(d.commitUsedGB), s(d.commitLimitGB))}
                    value={
                      Number(d.commitLimitGB)
                        ? (Number(d.commitUsedGB) / Number(d.commitLimitGB)) * 100
                        : 0
                    }
                  />
                </div>
                <div>
                  <p className="mb-2 text-[11.5px]" style={{ color: colors.muted }}>
                    {__ui("各核心占用（")}{coreUsage.length} {__ui("个逻辑核心）")}</p>
                  <div className="flex flex-wrap gap-1">
                    {coreUsage.map((v, i) => {
                      const val = Number(v) || 0;
                      const tone = val >= 90 ? colors.red : val >= 70 ? colors.gold : colors.green;
                      return (
                        <div
                          key={i}
                          title={__msg("核心 {0}: {1}%", i, val)}
                          className="h-6 w-6 rounded-md transition-colors"
                          style={{
                            background: colors.btnHover,
                            boxShadow: `inset 0 -${Math.max(2, (val / 100) * 24)}px 0 ${tone}`,
                          }}
                        />
                      );
                    })}
                  </div>
                </div>
              </div>
              <div className="mt-4 grid gap-x-8 sm:grid-cols-2">
                <Row label={__ui("制造商")} value={s(d.manufacturer)} />
                <Row label={__ui("插槽")} value={s(d.socket)} />
                <Row label={__ui("核心 / 线程")} value={`${s(d.cores)} 核 / ${s(d.threads)} 线程`} />
                <Row label={__ui("最大频率")} value={`${s(d.maxClock)} MHz`} />
                <Row label={__ui("二级缓存")} value={s(d.l2Text)} />
                <Row label={__ui("三级缓存")} value={s(d.l3Text)} />
                <Row label={__ui("固件虚拟化")} value={d.virt === true ? "已开启" : d.virt === false ? "未开启" : "—"} />
              </div>
            </Card>

            <Card title={__msg("内存条（{0} 条 / 共 {1} 个插槽）", Array.isArray(d.sticks) ? (d.sticks as unknown[]).length : 0, s(d.slots))} icon={MemoryStick}>
              <div className="flex flex-col gap-2.5">
                {(Array.isArray(d.sticks) ? (d.sticks as Record<string, unknown>[]) : []).map((m, i) => (
                  <div
                    key={i}
                    className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl border px-3.5 py-2.5"
                    style={{ borderColor: colors.borderSolid }}
                  >
                    <span className="text-[13px] font-medium" style={{ color: colors.text }}>
                      {s(m.capacityGB)} GB
                    </span>
                    <span className="text-[12px]" style={{ color: colors.muted }}>{s(m.typeText)}</span>
                    <span className="text-[12px]" style={{ color: colors.muted }}>{s(m.speedMHz)} MHz</span>
                    <span className="text-[12px]" style={{ color: colors.muted }}>{s(m.slot)}</span>
                    <span className="min-w-0 flex-1 truncate text-right font-mono text-[11.5px]" style={{ color: colors.muted }}>
                      {s(m.part)} {s(m.maker) !== "Unknown" ? `· ${s(m.maker)}` : ""}
                    </span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        );
      }}
    </Shell>
  );
}

/* ────────────────────────── 3. 显卡与显示器 ────────────────────────── */

export function GpuDisplayTool() {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  return (
    <Shell section="gpu" title={__ui("显卡与显示器")} icon={Monitor} refreshMs={2000}>
      {(d) => {
        const gpus = Array.isArray(d.gpus) ? (d.gpus as Record<string, unknown>[]) : [];
        const monitors = Array.isArray(d.monitors) ? (d.monitors as Record<string, unknown>[]) : [];
        return (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <Stat label={__ui("显卡数量")} value={gpus.length} unit={__ui("个")} />
              <Stat label={__ui("显示器")} value={monitors.length} unit={__ui("台")} />
              <Stat label={__ui("3D 引擎占用")} value={s(d.gpuLoad, "0")} unit="%" />
            </div>
            {gpus.map((g, i) => (
              <Card key={i} title={s(g.name)} icon={Monitor}>
                <div className="grid gap-x-8 sm:grid-cols-2">
                  <Row label={__ui("显存")} value={`${s(g.vramGB)} GB ${s(g.vramNote, "")}`} />
                  <Row label={__ui("驱动版本")} value={s(g.driver)} mono />
                  <Row label={__ui("驱动日期")} value={g.driverDate ? new Date(String(g.driverDate)).toLocaleDateString(__localeTag()) : "—"} />
                  <Row label={__ui("当前分辨率")} value={s(g.resolution)} />
                  <Row label={__ui("刷新率")} value={g.refresh ? `${s(g.refresh)} Hz` : "—"} />
                  <Row label={__ui("色深")} value={g.bits ? `${s(g.bits)} 位` : "—"} />
                  <Row label={__ui("图形处理器")} value={s(g.processor)} />
                </div>
              </Card>
            ))}
            {monitors.length > 0 && (
              <Card title={__ui("显示器")} icon={Monitor}>
                <div className="flex flex-col gap-2.5">
                  {monitors.map((m, i) => (
                    <div key={i} className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-xl border px-3.5 py-2.5" style={{ borderColor: colors.borderSolid }}>
                      <span className="text-[13px] font-medium" style={{ color: colors.text }}>{__ui("显示器")}{i + 1}</span>
                      <span className="text-[12px]" style={{ color: colors.muted }}>{s(m.maker)} {s(m.name)}</span>
                      {m.sizeInch ? <span className="text-[12px]" style={{ color: colors.muted }}>{__ui("约")}{s(m.sizeInch)} {__ui("英寸")}</span> : null}
                      {m.year ? <span className="text-[12px]" style={{ color: colors.muted }}>{s(m.year)} {__ui("年生产")}</span> : null}
                    </div>
                  ))}
                </div>
              </Card>
            )}
            <Card>
              <p className="text-[11.5px] leading-relaxed" style={{ color: colors.muted }}>
                {__ui("WMI 提供的显存容量上限为 4GB，超过时显示的数字可能偏小，以显卡驱动面板为准。")}</p>
            </Card>
          </div>
        );
      }}
    </Shell>
  );
}

/* ────────────────────────── 4. 主板与固件 ────────────────────────── */

export function BoardFirmwareTool() {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  return (
    <Shell section="board" title={__ui("主板与固件")} icon={Server}>
      {(d) => (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={__ui("固件类型")} value={s(d.firmwareTypeText)} />
            <Stat label={__ui("安全启动")} value={s(d.secureBootText)} tone={s(d.secureBootText) === "已开启" ? colors.green : colors.gold} />
            <Stat label="TPM" value={s(d.tpmName) ? "已启用" : "未检测到"} tone={s(d.tpmName) ? colors.green : colors.gold} />
            <Stat label={__ui("虚拟化")} value={d.hypervisorPresent === true ? "运行中" : "未启用"} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <Card title={__ui("主板")} icon={Server}>
              <Row label={__ui("制造商")} value={s(d.boardMaker)} />
              <Row label={__ui("型号")} value={s(d.boardProduct)} />
              <Row label={__ui("版本")} value={s(d.boardVersion)} />
              <Row label={__ui("序列号")} value={s(d.boardSerial)} mono />
            </Card>
            <Card title={__ui("BIOS / 固件")} icon={Server}>
              <Row label={__ui("厂商")} value={s(d.biosVendor)} />
              <Row label={__ui("版本")} value={s(d.biosVersion)} mono />
              <Row label={__ui("发布日期")} value={s(d.biosDateText)} />
              <Row label={__ui("固件类型")} value={s(d.firmwareTypeText)} />
            </Card>
            <Card title={__ui("安全特性")} icon={Check}>
              <Row label={__ui("安全启动")} value={s(d.secureBootText)} tone={s(d.secureBootText) === "已开启" ? colors.green : colors.gold} />
              <Row label={__ui("可信平台模块")} value={s(d.tpmText)} />
              <Row label={__ui("虚拟化（Hyper-V）")} value={d.hypervisorPresent === true ? "已启用" : "未启用"} />
              <Row label={__ui("系统类型")} value={s(d.systemType)} />
            </Card>
            <Card title={__ui("网络身份")} icon={Network}>
              <Row label={__ui("工作组")} value={s(d.workgroup)} />
              <Row label={__ui("域")} value={s(d.domain)} />
            </Card>
          </div>
        </div>
      )}
    </Shell>
  );
}

/* ────────────────────────── 5. 硬盘健康 ────────────────────────── */

export function StorageHealthTool() {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  return (
    <Shell section="storage" title={__ui("硬盘健康")} icon={HardDrive}>
      {(d) => {
        const disks = Array.isArray(d.disks) ? (d.disks as Record<string, unknown>[]) : [];
        const volumes = Array.isArray(d.volumes) ? (d.volumes as Record<string, unknown>[]) : [];
        const totalGB = volumes.reduce((sum, v) => sum + (Number(v.sizeGB) || 0), 0);
        const freeGB = volumes.reduce((sum, v) => sum + (Number(v.freeGB) || 0), 0);
        return (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label={__ui("物理磁盘")} value={disks.length} unit={__ui("块")} />
              <Stat label={__ui("分区")} value={s(d.partitionCount)} unit={__ui("个")} />
              <Stat label={__ui("总容量")} value={totalGB.toFixed(0)} unit="GB" />
              <Stat
                label={__ui("可用空间")}
                value={freeGB.toFixed(0)}
                unit="GB"
                tone={freeGB < 30 ? colors.red : undefined}
              />
            </div>
            {disks.map((disk, i) => (
              <Card
                key={i}
                title={s(disk.friendlyName)}
                icon={HardDrive}
                action={
                  <span
                    className="flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[11.5px] font-medium"
                    style={{
                      background: s(disk.healthText) === "正常" ? `${colors.green}1a` : `${colors.gold}1a`,
                      color: s(disk.healthText) === "正常" ? colors.green : colors.gold,
                    }}
                  >
                    <Check size={12} /> {s(disk.healthText)}
                  </span>
                }
              >
                <div className="grid gap-x-8 sm:grid-cols-2">
                  <Row label={__ui("容量")} value={`${s(disk.sizeGB)} GB`} />
                  <Row label={__ui("介质类型")} value={s(disk.mediaText)} />
                  <Row label={__ui("接口总线")} value={s(disk.busText)} />
                  <Row label={__ui("转速")} value={s(disk.rpmText)} />
                  <Row label={__ui("固件版本")} value={s(disk.firmware)} mono />
                  <Row label={__ui("序列号")} value={s(disk.serial)} mono />
                </div>
              </Card>
            ))}
            <Card title={__ui("分区与卷")} icon={HardDrive}>
              <div className="flex flex-col gap-3.5">
                {volumes.map((v, i) => (
                  <Bar
                    key={i}
                    label={`${s(v.letter)} ${s(v.label, "")} ${s(v.fs, "")} · ${s(v.sizeGB)} GB`}
                    value={Number(v.usedPercent) || 0}
                    text={`已用 ${s(v.usedPercent)}%（剩余 ${s(v.freeGB)} GB）`}
                  />
                ))}
              </div>
            </Card>
            <Card>
              <p className="text-[11.5px] leading-relaxed" style={{ color: colors.muted }}>
                {s(d.wearNote)}{__ui("。固态硬盘的磨损度、通电时间与写入量属于 SMART 明细，普通权限下系统不开放读取。")}</p>
            </Card>
          </div>
        );
      }}
    </Shell>
  );
}

/* ────────────────────────── 6. 网络适配器 ────────────────────────── */

export function NetworkDeviceTool() {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  return (
    <Shell section="network" title={__ui("网络适配器")} icon={Network} refreshMs={3000}>
      {(d) => {
        const adapters = Array.isArray(d.adapters) ? (d.adapters as Record<string, unknown>[]) : [];
        const configs = Array.isArray(d.configs) ? (d.configs as Record<string, unknown>[]) : [];
        const wifi = d.wifi as Record<string, string> | null;
        const signal = Number(String(wifi?.signal || "").replace("%", ""));
        return (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat label={__ui("网卡数量")} value={adapters.length} unit={__ui("个")} />
              <Stat label={__ui("已连接")} value={adapters.filter((a) => s(a.statusText) === "已连接").length} unit={__ui("个")} />
              {wifi?.ssid ? (
                <>
                  <Stat label={__ui("当前 Wi-Fi")} value={s(wifi.ssid)} />
                  <Stat
                    label={__ui("信号强度")}
                    value={s(wifi.signal)}
                    tone={signal < 40 ? colors.red : signal < 65 ? colors.gold : colors.green}
                  />
                </>
              ) : (
                <Stat label={__ui("主机名")} value={s(d.hostname)} />
              )}
            </div>

            {configs.map((c, i) => (
              <Card key={i} title={__msg("{0} 的连接", s(c.alias))} icon={Wifi}>
                <div className="grid gap-x-8 sm:grid-cols-2">
                  <Row label={__ui("IPv4 地址")} value={`${s(c.ipv4)} / ${s(c.prefix)}`} mono />
                  <Row label={__ui("默认网关")} value={s(c.gateway)} mono />
                  <Row label={__ui("DNS 服务器")} value={s(c.dns)} mono />
                  <Row label={__ui("主机名")} value={s(d.hostname)} mono />
                </div>
              </Card>
            ))}

            {wifi?.ssid && (
              <Card title={__ui("无线网络详情")} icon={Wifi}>
                <div className="grid gap-x-8 sm:grid-cols-2">
                  <Row label={__ui("网络名称 (SSID)")} value={s(wifi.ssid)} />
                  <Row label={__ui("接入点 (BSSID)")} value={s(wifi.bssid)} mono />
                  <Row label={__ui("信号强度")} value={s(wifi.signal)} />
                  <Row label={__ui("无线电类型")} value={s(wifi.radio)} />
                  <Row label={__ui("信道")} value={s(wifi.channel)} />
                </div>
                <div className="mt-3">
                  <Bar value={signal} />
                </div>
              </Card>
            )}

            <Card title={__ui("全部网络适配器")} icon={Network}>
              <div className="flex flex-col gap-2.5">
                {adapters.map((a, i) => (
                  <div
                    key={i}
                    className="flex flex-wrap items-center gap-x-5 gap-y-1 rounded-xl border px-3.5 py-2.5"
                    style={{ borderColor: colors.borderSolid }}
                  >
                    <span className="text-[13px] font-medium" style={{ color: colors.text }}>{s(a.name)}</span>
                    <span
                      className="rounded-md px-2 py-0.5 text-[11px]"
                      style={{
                        background: s(a.statusText) === "已连接" ? `${colors.green}1a` : colors.btnHover,
                        color: s(a.statusText) === "已连接" ? colors.green : colors.muted,
                      }}
                    >
                      {__msg(s(a.statusText))}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-[12px]" style={{ color: colors.muted }}>{s(a.desc)}</span>
                    <span className="font-mono text-[11.5px]" style={{ color: colors.muted }}>{s(a.mac)}</span>
                    <span className="text-[12px]" style={{ color: colors.muted }}>{s(a.speed)}</span>
                  </div>
                ))}
              </div>
            </Card>
          </div>
        );
      }}
    </Shell>
  );
}

/* ────────────────────────── 7. 电源与温度 ────────────────────────── */

export function PowerSensorTool() {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  return (
    <Shell section="power" title={__ui("电源与温度")} icon={Battery} refreshMs={3000}>
      {(d) => {
        const charge = Number(d.charge) || 0;
        const thermal = Array.isArray(d.thermal) ? (d.thermal as number[]) : [];
        const hasBattery = d.hasBattery === true;
        return (
          <div className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Stat
                label={hasBattery ? __ui("电池电量") : __ui("供电方式")}
                value={hasBattery ? `${charge}%` : "交流电"}
                tone={hasBattery && charge < 20 ? colors.red : undefined}
              />
              <Stat label={__ui("供电状态")} value={d.powerOnline === true ? "已接通电源" : hasBattery ? "使用电池" : "—"} />
              <Stat label={__ui("电源方案")} value={s(d.schemeText)} />
              <Stat label={__ui("系统已运行")} value={s(d.uptime)} />
            </div>

            {hasBattery && (
              <Card title={__ui("电池")} icon={d.powerOnline === true ? BatteryCharging : Battery}>
                <div className="flex items-center gap-6">
                  <div className="relative flex h-24 w-24 shrink-0 items-center justify-center">
                    <svg viewBox="0 0 100 100" className="h-24 w-24 -rotate-90">
                      <circle cx="50" cy="50" r="42" fill="none" stroke={colors.btnHover} strokeWidth="10" />
                      <circle
                        cx="50"
                        cy="50"
                        r="42"
                        fill="none"
                        stroke={charge < 20 ? colors.red : charge < 50 ? colors.gold : colors.green}
                        strokeWidth="10"
                        strokeLinecap="round"
                        strokeDasharray={`${(charge / 100) * 264} 264`}
                        className="transition-all duration-700"
                      />
                    </svg>
                    <span className="absolute text-[20px] font-semibold" style={{ color: colors.text }}>{charge}%</span>
                  </div>
                  <div className="min-w-0 flex-1">
                    <Row label={__ui("电池名称")} value={s(d.batteryName)} />
                    <Row label={__ui("当前状态")} value={s(d.statusText)} />
                    <Row label={__ui("满电容量")} value={s(d.fullChargeText)} />
                  </div>
                </div>
              </Card>
            )}

            <Card title={__ui("温度传感器")} icon={Thermometer}>
              {thermal.length > 0 ? (
                <div className="flex flex-col gap-3">
                  {thermal.map((t, i) => (
                    <Bar
                      key={i}
                      label={__msg("传感器 {0}", i + 1)}
                      value={(Number(t) / 100) * 100}
                      text={`${t} °C`}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-[12.5px]" style={{ color: colors.muted }}>{s(d.thermalNote)}</p>
              )}
            </Card>

            <Card title={__ui("处理器负载")} icon={Activity}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Stat label={__ui("逻辑处理器")} value={s(d.logicalCpus)} unit={__ui("个")} />
                <Stat label={__ui("平均负载")} value={n(d.cpuLoad, 2)} />
              </div>
              <p className="mt-3 text-[11.5px]" style={{ color: colors.muted }}>{s(d.fanNote)}</p>
            </Card>
          </div>
        );
      }}
    </Shell>
  );
}
