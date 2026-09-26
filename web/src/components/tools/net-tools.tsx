import { localeTag as __localeTag } from "@/lib/language";
"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/net-tools.tsx");


/**
 * 联网查询类工具的界面：天气查询、公网 IP、手机号归属地、快递单号、域名可用性。
 *
 * 布局选择：
 *   · 天气 —— **模式 B（工作台 4:8）**：左边搜城市，右边是"现在 + 未来 24 小时 + 未来 7 天"。
 *     天气的价值在"接下来会怎样"，所以逐小时与七日预报要占主体。
 *   · 公网 IP / 手机号归属地 —— **模式 A**：输入一个东西、右边出结论卡。简单的输入输出，
 *     但结果本身是"字段化"的（IP/归属地/运营商），所以画成字段卡而不是一段话。
 *   · 快递单号 —— **时间轴**：物流信息天生是时间序列，按时间倒序排成一条时间轴最容易看懂。
 *   · 域名可用性 —— **模式 A + 表格**：结论（能注册/已被注册）+ NS/A 记录与注册局信息。
 *
 * ★ 这几个工具都依赖网络接口，而接口都是**实测能直连**的国内/国际服务（见 src-tauri/src/netquery.rs）。
 *   界面上会明确标出数据来源与查询时间，避免用户把缓存或估算当成实时事实。
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Building2,
  Clock,
  Compass,
  Copy,
  CloudSun,
  Droplets,
  Eraser,
  Globe,
  Gauge,
  Globe2,
  Info,
  Loader2,
  MapPin,
  Package,
  Phone,
  RefreshCw,
  Search,
  ShieldCheck,
  Sparkles,
  Sun,
  Wind,
  XCircle,
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

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  const __locale = __useLanguage();
  return (
    <div className="rounded-xl border border-border/60 bg-secondary/20 px-3 py-2">
      <div className="text-[11px] text-muted-foreground">{__ui(label)}</div>
      <div className={cn("mt-0.5 text-foreground", mono && "font-mono")}>{value || "—"}</div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 工具一：天气查询
// ══════════════════════════════════════════════════════════════════════

interface GeoHit {
  name: string;
  country: string;
  admin: string;
  lat: number;
  lon: number;
  timezone: string;
}

export function WeatherQueryTool() {
  const __locale = __useLanguage();
  const [keyword, setKeyword] = useToolDraft("weather-query", "keyword", "");
  const [hits, setHits] = useState<GeoHit[]>([]);
  const [place, setPlace] = useState<GeoHit | null>(null);
  const [weather, setWeather] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [queriedAt, setQueriedAt] = useState("");

  const doSearch = useCallback(
    async (kw: string) => {
      const q = kw.trim();
      if (!q) {
        setError("请输入城市名，例如 北京、上海、Tokyo");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/net/geocode?name=${encodeURIComponent(q)}`);
        const data = await res.json();
        if (!data.success) throw new Error(data.error || "搜索失败");
        const list: GeoHit[] = data.results || [];
        setHits(list);
        // 只有一个结果，或者第一个结果的名字跟关键词完全一致（例如搜"北京"命中的第一个就是北京）
        // → 直接加载天气，别让用户还要在列表里再点一下
        const exact = list.find((x) => x.name === q);
        if (list.length === 1) {
          await loadWeather(list[0]);
        } else if (exact) {
          await loadWeather(exact);
        }
      } catch (e) {
        setHits([]);
        setError(e instanceof Error ? e.message : "搜索失败");
      } finally {
        setBusy(false);
      }
    },
    [],
  );

  const loadWeather = useCallback(async (hit: GeoHit) => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/net/weather?lat=${hit.lat}&lon=${hit.lon}&timezone=${encodeURIComponent(hit.timezone || "auto")}`,
      );
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "取天气失败");
      setPlace(hit);
      setWeather(data);
      setQueriedAt(new Date().toLocaleString(__localeTag()));
      setHits([]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "取天气失败");
    } finally {
      setBusy(false);
    }
  }, []);

  // 首次进来先给个北京，别让用户对着空页面
  useEffect(() => {
    void doSearch("北京");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cur = (weather?.current || {}) as Record<string, unknown>;
  const hours = (weather?.hours || []) as Array<Record<string, unknown>>;
  const days = (weather?.days || []) as Array<Record<string, unknown>>;

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="thin-scroll space-y-4 lg:col-span-4">
          <SectionCard
            icon={<Search className="h-4 w-4" />}
            title={__ui("搜城市")}
            extra={
              <Button type="button" variant="outline" size="sm" onClick={() => { setKeyword("北京"); void doSearch("北京"); }}>
                <Sparkles className="h-3.5 w-3.5" /> {__ui("北京")}</Button>
            }
          >
            <div className="flex gap-2">
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void doSearch(keyword)}
                placeholder={__ui("北京 / 上海 / Tokyo…")}
                className="text-xs"
              />
              <Button type="button" className="shrink-0 gap-1.5" onClick={() => void doSearch(keyword)} disabled={busy}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                {__ui("查询")}</Button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              {__ui("支持中文、拼音与英文城市名；数据来源为 open-meteo 公开气象接口（无需密钥），国内网络可直接访问。")}</p>

            {hits.length > 0 && (
              <div className="mt-3 space-y-1.5">
                <div className="text-[11.5px] font-medium text-foreground">{__ui("找到")}{hits.length} {__ui("个地点，选一个：")}</div>
                {hits.map((h, i) => (
                  <button
                    key={`${h.name}-${i}`}
                    type="button"
                    onClick={() => void loadWeather(h)}
                    className="flex w-full items-center justify-between rounded-xl border border-border/60 px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-primary/[0.06]"
                  >
                    <span className="min-w-0">
                      <span className="text-[12.5px] font-medium text-foreground">{h.name}</span>
                      <span className="ml-1.5 text-[11px] text-muted-foreground">
                        {h.admin ? `${h.admin} · ` : ""}
                        {h.country}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-[10.5px] text-muted-foreground">
                      {h.lat.toFixed(2)}, {h.lon.toFixed(2)}
                    </span>
                  </button>
                ))}
              </div>
            )}

            {error && <div className="mt-3"><ErrorBar message={__msg(error)} /></div>}
          </SectionCard>

          {place && (
            <SectionCard icon={<MapPin className="h-4 w-4" />} title={__ui("当前地点")}>
              <div className="space-y-1.5 text-[12px]">
                <div className="text-foreground">
                  {place.name}
                  {place.admin && <span className="ml-1.5 text-muted-foreground">{place.admin}</span>}
                  <span className="ml-1.5 text-muted-foreground">{place.country}</span>
                </div>
                <div className="font-mono text-[11px] text-muted-foreground">
                  {place.lat.toFixed(4)}, {place.lon.toFixed(4)} · {place.timezone}
                </div>
                {queriedAt && <div className="text-[11px] text-muted-foreground">{__ui("数据时间：")}{queriedAt}</div>}
              </div>
            </SectionCard>
          )}
        </div>

        <div className="thin-scroll space-y-4 lg:col-span-8">
          {weather && (
            <>
              <SectionCard
                icon={<CloudSun className="h-4 w-4" />}
                title={__msg("现在 · {0}", place?.name || "")}
                extra={
                  <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={() => place && void loadWeather(place)} disabled={busy}>
                    <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} /> {__ui("刷新")}</Button>
                }
              >
                <div className="flex flex-wrap items-center gap-5">
                  <div className="flex items-center gap-3">
                    <span className="text-5xl leading-none">{String(cur.icon || "")}</span>
                    <div>
                      <div className="font-mono text-4xl font-bold text-foreground">
                        {cur.temp !== null && cur.temp !== undefined ? `${Math.round(Number(cur.temp))}°` : "—"}
                      </div>
                      <div className="text-[12.5px] text-muted-foreground">{String(cur.desc || "")}</div>
                    </div>
                  </div>
                  <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-3">
                    <div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-secondary/20 px-3 py-2 text-[11.5px]">
                      <Gauge className="h-3.5 w-3.5 text-primary" />
                      <span className="text-muted-foreground">{__ui("体感")}</span>
                      <span className="ml-auto font-mono text-foreground">
                        {cur.feels !== null && cur.feels !== undefined ? `${Math.round(Number(cur.feels))}°` : "—"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-secondary/20 px-3 py-2 text-[11.5px]">
                      <Droplets className="h-3.5 w-3.5 text-primary" />
                      <span className="text-muted-foreground">{__ui("湿度")}</span>
                      <span className="ml-auto font-mono text-foreground">{String(cur.humidity ?? "—")}%</span>
                    </div>
                    <div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-secondary/20 px-3 py-2 text-[11.5px]">
                      <Wind className="h-3.5 w-3.5 text-primary" />
                      <span className="text-muted-foreground">{__ui("风速")}</span>
                      <span className="ml-auto font-mono text-foreground">{String(cur.wind ?? "—")} km/h</span>
                    </div>
                    <div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-secondary/20 px-3 py-2 text-[11.5px]">
                      <Sun className="h-3.5 w-3.5 text-primary" />
                      <span className="text-muted-foreground">{__ui("气压")}</span>
                      <span className="ml-auto font-mono text-foreground">
                        {cur.pressure !== null && cur.pressure !== undefined ? `${Math.round(Number(cur.pressure))} hPa` : "—"}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-secondary/20 px-3 py-2 text-[11.5px]">
                      <Compass className="h-3.5 w-3.5 text-primary" />
                      <span className="text-muted-foreground">{__ui("风向")}</span>
                      <span className="ml-auto font-mono text-foreground">{String(cur.windDir ?? "—")}°</span>
                    </div>
                    <div className="flex items-center gap-1.5 rounded-lg border border-border/60 bg-secondary/20 px-3 py-2 text-[11.5px]">
                      <Clock className="h-3.5 w-3.5 text-primary" />
                      <span className="text-muted-foreground">{__ui("观测")}</span>
                      <span className="ml-auto font-mono text-foreground">
                        {String(cur.time || "").slice(11, 16) || "—"}
                      </span>
                    </div>
                  </div>
                </div>
              </SectionCard>

              <SectionCard icon={<Clock className="h-4 w-4" />} title={__ui("未来 24 小时")}>
                <div className="thin-scroll -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
                  {hours.map((h, i) => (
                    <div
                      key={i}
                      className={cn(
                        "flex w-[68px] shrink-0 flex-col items-center gap-1 rounded-xl border px-2 py-2.5",
                        i === 0 ? "border-primary/40 bg-primary/[0.07]" : "border-border/60 bg-background/40",
                      )}
                    >
                      <span className="font-mono text-[10.5px] text-muted-foreground">{String(h.time).slice(11, 16)}</span>
                      <span className="text-lg leading-none">{String(h.icon || "")}</span>
                      <span className="font-mono text-[13px] font-semibold text-foreground">
                        {h.temp !== null && h.temp !== undefined ? `${Math.round(Number(h.temp))}°` : "—"}
                      </span>
                      <span className="text-[10px] text-muted-foreground">
                        {h.pop !== null && h.pop !== undefined ? `💧${h.pop}%` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              </SectionCard>

              <SectionCard icon={<CloudSun className="h-4 w-4" />} title={__ui("未来 7 天")}>
                <div className="overflow-hidden rounded-xl border border-border/60">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="bg-muted/60">
                        <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("日期")}</th>
                        <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("天气")}</th>
                        <th className="px-3 py-2 text-right font-semibold text-foreground">{__ui("最高 / 最低")}</th>
                        <th className="px-3 py-2 text-right font-semibold text-foreground">{__ui("降水概率")}</th>
                        <th className="px-3 py-2 text-right font-semibold text-foreground">{__ui("日出 / 日落")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {days.map((d, i) => (
                        <tr key={i} className={cn("border-t border-border/40 even:bg-muted/20", i === 0 && "bg-primary/[0.06]")}>
                          <td className="whitespace-nowrap px-3 py-2 font-mono text-foreground">
                            {String(d.date).slice(5)}
                            {i === 0 && <span className="ml-1.5 text-[10px] text-primary">{__ui("今天")}</span>}
                          </td>
                          <td className="px-3 py-2 text-foreground">
                            <span className="mr-1.5">{String(d.icon || "")}</span>
                            {String(d.desc || "")}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-foreground">
                            {d.max !== null && d.max !== undefined ? Math.round(Number(d.max)) : "—"}° /{" "}
                            <span className="text-muted-foreground">
                              {d.min !== null && d.min !== undefined ? Math.round(Number(d.min)) : "—"}°
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right font-mono text-muted-foreground">
                            {d.pop !== null && d.pop !== undefined ? `${d.pop}%` : "—"}
                          </td>
                          <td className="whitespace-nowrap px-3 py-2 text-right font-mono text-muted-foreground">
                            {String(d.sunrise || "").slice(11, 16) || "—"} / {String(d.sunset || "").slice(11, 16) || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  {__ui("数据来源：open-meteo 公开气象接口（无需密钥）。预报随时间更新，长时间未刷新时请点击上方「刷新」。")}</p>
              </SectionCard>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 工具二：我的公网 IP
// ══════════════════════════════════════════════════════════════════════

export function PublicIpTool() {
  const __locale = __useLanguage();
  const [data, setData] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/net/public-ip");
      const d = await res.json();
      if (!d.success) throw new Error(d.error || "查询失败");
      setData(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : "查询失败");
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="thin-scroll space-y-4 lg:col-span-5">
          <SectionCard
            icon={<Globe className="h-4 w-4" />}
            title={__ui("我的公网 IP")}
            extra={
              <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={() => void load()} disabled={busy}>
                <RefreshCw className={cn("h-3.5 w-3.5", busy && "animate-spin")} /> {__ui("重新查询")}</Button>
            }
          >
            {error ? (
              <ErrorBar message={__msg(error)} />
            ) : !data ? (
              <div className="flex items-center justify-center gap-2 py-12 text-xs text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> {__ui("正在查询…")}</div>
            ) : (
              <>
                <div className="rounded-xl border border-primary/30 bg-primary/[0.07] px-4 py-4">
                  <div className="text-[11.5px] text-muted-foreground">{__ui("公网 IP（")}{String(data.version)}）</div>
                  <div className="mt-1 flex items-center gap-2">
                    <span className="font-mono text-xl font-bold break-all text-primary">{String(data.ip)}</span>
                    <CopyButton value={String(data.ip)} label="" />
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <Field label={__ui("国家")} value={String(data.country || "—")} />
                  <Field label={__ui("省份 / 地区")} value={String(data.region || "—")} />
                  <Field label={__ui("城市")} value={String(data.city || "—")} />
                  <Field label={__ui("运营商")} value={String(data.isp || "—")} />
                </div>
                <div className="mt-3 rounded-xl border border-border/60 bg-secondary/20 p-3">
                  <div className="text-[11.5px] text-muted-foreground">{__ui("原始返回")}</div>
                  <div className="mt-1 font-mono text-[11.5px] break-all text-foreground">{String(data.raw || "")}</div>
                </div>
              </>
            )}
          </SectionCard>
        </div>

        <div className="thin-scroll space-y-4 lg:col-span-7">
          <SectionCard icon={<ShieldCheck className="h-4 w-4" />} title={__ui("这个 IP 意味着什么")}>
            <div className="space-y-2 text-[12px] leading-relaxed text-muted-foreground">
              <p>
                <b className="text-foreground">{__ui("公网 IP 是本机对外访问网络时使用的地址")}</b>{__ui("，网站所记录到的即是该地址， 据此可大致判断所在城市与运营商，但无法定位到具体地址。")}</p>
              <p>
                {__ui("若开启了代理或加速器，此处显示的为")}<b className="text-foreground">{__ui("代理出口的 IP 与位置")}</b>{__ui("， 并非真实所在地，需注意这一点。")}</p>
              <p>
                {__ui("显示 IPv6 表示网络优先使用 IPv6；部分仅支持 IPv4 的服务会改用 IPv4 出口。")}</p>
            </div>
          </SectionCard>

          <SectionCard icon={<Info className="h-4 w-4" />} title={__ui("数据来源与隐私")}>
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              {__ui("查询通过 ipip.net 的公开接口完成，请求由本机直接发出（不经过我们的服务器，也没有服务器）。 换言之：查询请求由本机直接发出，不经过任何第三方中转，对方记录到的同样是本机网络出口。")}</p>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 工具四：快递单号查询
// ══════════════════════════════════════════════════════════════════════

/** 常用快递公司（code 是快递100 认的公司编码） */
const CARRIERS = [
  { code: "shunfeng", name: "顺丰速运" },
  { code: "yuantong", name: "圆通速递" },
  { code: "zhongtong", name: "中通快递" },
  { code: "shentong", name: "申通快递" },
  { code: "yunda", name: "韵达速递" },
  { code: "jd", name: "京东物流" },
  { code: "jtexpress", name: "极兔速递" },
  { code: "youzhengguonei", name: "邮政快递包裹" },
  { code: "ems", name: "EMS" },
  { code: "debangkuaidi", name: "德邦快递" },
  { code: "huitongkuaidi", name: "百世快递" },
  { code: "tiantian", name: "天天快递" },
  { code: "zhaijisong", name: "宅急送" },
  { code: "youshuwuliu", name: "优速快递" },
  { code: "annengwuliu", name: "安能物流" },
  { code: "quanfengkuaidi", name: "全峰快递" },
  { code: "zhongyouwuliu", name: "中邮物流" },
  { code: "suer", name: "速尔快递" },
  { code: "yuefengwuliu", name: "越丰物流" },
  { code: "dhl", name: "DHL" },
  { code: "fedex", name: "FedEx" },
  { code: "ups", name: "UPS" },
  { code: "usps", name: "USPS" },
];

export { ExpressQueryTool } from "./express-query-tool";

// ══════════════════════════════════════════════════════════════════════
// 工具五：域名可用性查询
// ══════════════════════════════════════════════════════════════════════

const SUFFIXES = [".com", ".cn", ".net", ".org", ".io", ".com.cn", ".xyz", ".top", ".dev", ".app"];

export function DomainCheckTool() {
  const __locale = __useLanguage();
  const [domain, setDomain] = useToolDraft("domain-check", "domain", "");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [batch, setBatch] = useState<Array<Record<string, unknown>>>([]);

  const check = async (name?: string) => {
    const d = (name ?? domain).trim();
    if (!d) {
      setError("请输入域名，例如 furinakit.com");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/net/domain?domain=${encodeURIComponent(d)}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "查询失败");
      setResult(data);
      setBatch((prev) => [data, ...prev.filter((x) => x.domain !== data.domain)].slice(0, 12));
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "查询失败");
    } finally {
      setBusy(false);
    }
  };

  const rdap = (result?.rdap || null) as Record<string, unknown> | null;
  const events = ((rdap?.events || []) as Array<Record<string, unknown>>).filter((e) =>
    ["registration", "expiration", "last changed"].includes(String(e.action)),
  );
  const eventText: Record<string, string> = { registration: "注册时间", expiration: "到期时间", "last changed": "最近变更" };

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="thin-scroll space-y-4 lg:col-span-5">
          <SectionCard
            icon={<Globe2 className="h-4 w-4" />}
            title={__ui("查域名")}
            extra={
              <Button type="button" variant="outline" size="sm" onClick={() => { setDomain("furinakit.com"); void check("furinakit.com"); }}>
                <Sparkles className="h-3.5 w-3.5" /> {__ui("示例")}</Button>
            }
          >
            <div className="flex gap-2">
              <Input
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && void check()}
                placeholder="furinakit.com"
                className="font-mono text-sm"
              />
              <Button type="button" className="shrink-0 gap-1.5" onClick={() => void check()} disabled={busy}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                {__ui("查询")}</Button>
            </div>

            <div className="mt-3">
              <div className="mb-1.5 text-[11.5px] font-medium text-foreground">{__ui("常见后缀快捷查询")}</div>
              <div className="flex flex-wrap gap-1.5">
                {SUFFIXES.map((s) => {
                  const base = (domain.trim() || "furinakit").replace(/\.[a-z.]+$/i, "");
                  return (
                    <button
                      key={s}
                      type="button"
                      onClick={() => { setDomain(base + s); void check(base + s); }}
                      className="rounded-lg border border-border/60 px-2 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                    >
                      {base}
                      {__msg(s)}
                    </button>
                  );
                })}
              </div>
            </div>

            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground">
              {__ui("判断依据是 DNS 里有没有这个域名的 NS 记录（阿里公共 DNS 的 DoH 接口）， .com 域名还会额外查注册局的 RDAP 拿注册与到期时间。")}</p>
          </SectionCard>

          {batch.length > 0 && (
            <SectionCard
              icon={<Clock className="h-4 w-4" />}
              title={__msg("查过的域名（{0}）", batch.length)}
              extra={
                <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={() => setBatch([])}>
                  <Eraser className="h-3.5 w-3.5" /> {__ui("清空")}</Button>
              }
            >
              <div className="space-y-1.5">
                {batch.map((b) => (
                  <div key={String(b.domain)} className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/40 px-2.5 py-1.5">
                    {b.available ? (
                      <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                    ) : (
                      <XCircle className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    )}
                    <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-foreground">{String(b.domain)}</span>
                    <span className={cn("shrink-0 text-[11px]", b.available ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>
                      {b.available ? __ui("可能可注册") : __ui("已被注册")}
                    </span>
                  </div>
                ))}
              </div>
            </SectionCard>
          )}
        </div>

        <div className="thin-scroll space-y-4 lg:col-span-7">
          {error && <ErrorBar message={__msg(error)} />}
          {result ? (
            <>
              <SectionCard
                icon={result.available ? <BadgeCheck className="h-4 w-4" /> : <XCircle className="h-4 w-4" />}
                title={String(result.domain)}
              >
                <div
                  className={cn(
                    "rounded-xl border px-4 py-4",
                    result.available ? "border-emerald-500/30 bg-emerald-500/[0.07]" : "border-border/60 bg-secondary/20",
                  )}
                >
                  <div className={cn("text-xl font-bold", result.available ? "text-emerald-600 dark:text-emerald-400" : "text-foreground")}>
                    {result.available ? __ui("看起来可以注册") : __ui("已经被注册了")}
                  </div>
                  <p className="mt-1.5 text-[12px] leading-relaxed text-muted-foreground">{String(result.note || "")}</p>
                </div>

                {!result.available && (
                  <div className="mt-3">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => {
                        const w = window as unknown as { furinakit?: { openExternal?: (u: string) => Promise<void> } };
                        void w.furinakit?.openExternal?.(`https://www.whois.com/whois/${encodeURIComponent(String(result.domain))}`);
                      }}
                    >
                      <Globe className="h-3.5 w-3.5" /> {__ui("在浏览器里看 whois 详情")}</Button>
                  </div>
                )}
              </SectionCard>

              <SectionCard icon={<Globe className="h-4 w-4" />} title={__ui("DNS 记录")}>
                <div className="space-y-3">
                  <div>
                    <div className="mb-1.5 text-[11.5px] font-medium text-foreground">
                      {__ui("NS 记录（")}{((result.nameservers || []) as string[]).length} {__ui("条）")}</div>
                    {((result.nameservers || []) as string[]).length === 0 ? (
                      <p className="text-[11.5px] text-muted-foreground">{__ui("无 NS 记录，这是判断可能可注册的主要依据。")}</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {((result.nameservers || []) as string[]).map((ns) => (
                          <span key={ns} className="rounded-lg border border-border/60 bg-background/40 px-2 py-1 font-mono text-[11px] text-foreground">
                            {ns}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div>
                    <div className="mb-1.5 text-[11.5px] font-medium text-foreground">
                      {__ui("A 记录（")}{((result.aRecords || []) as string[]).length} {__ui("条）")}</div>
                    {((result.aRecords || []) as string[]).length === 0 ? (
                      <p className="text-[11.5px] text-muted-foreground">{__ui("无 A 记录（可能仅配置了其它类型解析，或尚未投入使用）。")}</p>
                    ) : (
                      <div className="flex flex-wrap gap-1.5">
                        {((result.aRecords || []) as string[]).map((a) => (
                          <span key={a} className="rounded-lg border border-border/60 bg-background/40 px-2 py-1 font-mono text-[11px] text-foreground">
                            {a}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </SectionCard>

              {rdap && (
                <SectionCard icon={<Building2 className="h-4 w-4" />} title={__ui("注册局信息（RDAP）")}>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Field label={__ui("注册商")} value={String(rdap.registrar || "—")} />
                    {events.map((e) => (
                      <Field
                        key={String(e.action)}
                        label={eventText[String(e.action)] || String(e.action)}
                        value={String(e.date || "").slice(0, 10)}
                        mono
                      />
                    ))}
                  </div>
                  {((rdap.status || []) as string[]).length > 0 && (
                    <div className="mt-3">
                      <div className="mb-1.5 text-[11.5px] font-medium text-foreground">{__ui("域名状态")}</div>
                      <div className="flex flex-wrap gap-1.5">
                        {((rdap.status || []) as string[]).map((s) => (
                          <Badge key={s} variant="outline" className="font-mono text-[10.5px] font-normal">
                            {__msg(s)}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </SectionCard>
              )}
            </>
          ) : (
            !error && (
              <SectionCard>
                <div className="flex flex-col items-center justify-center gap-2.5 py-16 text-center">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Globe2 className="h-5 w-5" />
                  </span>
                  <p className="text-sm font-medium text-foreground">{__ui("输入目标域名，查询是否可注册")}</p>
                  <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
                    {__ui("查询 NS 与 A 记录；.com 域名还可查看注册商与到期时间。最终结果以注册商页面为准。")}</p>
                </div>
              </SectionCard>
            )
          )}
        </div>
      </div>
    </div>
  );
}


export function PhoneLocationTool() {
  const __locale = __useLanguage();
  const [number, setNumber] = useToolDraft("phone-location", "number", "");
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [history, setHistory] = useState<Array<Record<string, unknown>>>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const query = async () => {
    const n = number.replace(/\D/g, "");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/net/phone?number=${n}`);
      const d = await res.json();
      if (!d.success) throw new Error(d.error || "查询失败");
      setResult(d);
      setHistory((prev) => [d, ...prev.filter((x) => x.number !== d.number)].slice(0, 12));
    } catch (e) {
      setResult(null);
      setError(e instanceof Error ? e.message : "查询失败");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="thin-scroll space-y-4 lg:col-span-5">
          <SectionCard
            icon={<Phone className="h-4 w-4" />}
            title={__ui("手机号")}
            extra={
              <div className="flex items-center gap-1.5">
                <Button type="button" variant="outline" size="sm" onClick={() => setNumber("13800138000")}>
                  <Sparkles className="h-3.5 w-3.5" /> {__ui("示例")}</Button>
                <Button type="button" variant="ghost" size="sm" className="gap-1.5" onClick={() => { setNumber(""); setResult(null); setError(null); }}>
                  <Eraser className="h-3.5 w-3.5" /> {__ui("清空")}</Button>
              </div>
            }
          >
            <div className="flex gap-2">
              <Input
                value={number}
                onChange={(e) => setNumber(e.target.value.replace(/[^\d]/g, "").slice(0, 11))}
                onKeyDown={(e) => e.key === "Enter" && void query()}
                placeholder={__ui("11 位中国大陆手机号")}
                className="font-mono text-sm tracking-wider"
                maxLength={11}
              />
              <Button type="button" className="shrink-0 gap-1.5" onClick={() => void query()} disabled={busy || number.length !== 11}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                {__ui("查询")}</Button>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              {__ui("号段数据来自 360 手机助手公开查询接口。查询只返回")}<b className="text-foreground">{__ui("号段归属")}</b>{__ui("， 不代表这个号码现在归谁所有、也查不到机主姓名。")}</p>

            {history.length > 0 && (
              <div className="mt-3">
                <div className="mb-1.5 flex items-center justify-between">
                  <span className="text-[11.5px] font-medium text-foreground">{__ui("查过的号段（")}{history.length}）</span>
                  <button type="button" onClick={() => setHistory([])} className="text-[11px] text-muted-foreground hover:text-foreground">
                    {__ui("清空")}</button>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {history.map((h) => (
                    <button
                      key={String(h.number)}
                      type="button"
                      onClick={() => { setNumber(String(h.number)); setResult(h); }}
                      className="rounded-lg border border-border/60 px-2 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                    >
                      {String(h.number).slice(0, 3)}****{String(h.number).slice(7)}
                      <span className="ml-1 font-sans">{String(h.region || "")}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </SectionCard>
        </div>

        <div className="thin-scroll space-y-4 lg:col-span-7">
          {error && <ErrorBar message={__msg(error)} />}
          {result ? (
            <SectionCard
              icon={<MapPin className="h-4 w-4" />}
              title={__ui("归属地")}
              extra={<CopyButton value={`${result.number} 归属地：${result.region} ${result.isp}`} label={__ui("复制结果")} />}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-primary/30 bg-primary/[0.07] px-4 py-3">
                  <div className="text-[11.5px] text-muted-foreground">{__ui("归属地")}</div>
                  <div className="mt-1 text-2xl font-bold text-primary">{String(result.region || "未知")}</div>
                </div>
                <div className="rounded-xl border border-border/60 bg-secondary/20 px-4 py-3">
                  <div className="text-[11.5px] text-muted-foreground">{__ui("运营商")}</div>
                  <div className="mt-1 text-2xl font-bold text-foreground">{String(result.isp || "未知")}</div>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Field label={__ui("号码")} value={String(result.number)} mono />
                <Field label={__ui("号段")} value={`${String(result.segment)}****`} mono />
                <Field label={__ui("前七位")} value={`${String(result.prefix)}****`} mono />
                <Field label={__ui("省份")} value={String(result.province || "—")} />
              </div>
            </SectionCard>
          ) : (
            !error && (
              <SectionCard>
                <div className="flex flex-col items-center justify-center gap-2.5 py-16 text-center">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Phone className="h-5 w-5" />
                  </span>
                  <p className="text-sm font-medium text-foreground">{__ui("输入手机号，查它的号段归属")}</p>
                  <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
                    {__ui("常见用途：判断陌生来电的大致地区，核对号码填写地区是否一致。")}</p>
                </div>
              </SectionCard>
            )
          )}
        </div>
      </div>
    </div>
  );
}
