"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/net-query-tool.tsx");


/**
 * 网络查询（IP 归属地 / Whois / 短链展开 / ICP 备案）
 *
 * 这个工具**需要联网** —— 界面上如实标注，不做「本地处理」的暗示。
 * 查不到时给出具体原因，绝不返回猜测的结果。
 * ICP 备案依赖第三方公共接口，本机实测连不上，所以失败时提供工信部官方查询入口，
 * 而不是留一个永远转圈的按钮。
 */

import { useState } from "react";
import { AlertTriangle, Check, Copy, Globe, Link2, Loader2, Search, Server, ShieldQuestion } from "lucide-react";
import { Button, Input } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

type Mode = "ip" | "whois" | "shortlink" | "icp";

const MODES: { id: Mode; label: string; hint: string; placeholder: string; icon: typeof Globe }[] = [
  { id: "ip", label: "IP 归属地", hint: "查某个 IP 的国家、地区、运营商与 ASN", placeholder: "例如 8.8.8.8 或 114.114.114.114", icon: Globe },
  { id: "whois", label: "域名 Whois", hint: "查域名的注册商、注册与到期时间、域名服务器", placeholder: "例如 github.com", icon: Server },
  { id: "shortlink", label: "短链展开", hint: "把短链逐跳展开，看清最终会跳到哪个地址", placeholder: "例如 https://b23.tv/xxxxxxx", icon: Link2 },
  { id: "icp", label: "ICP 备案", hint: "查域名的主办单位与备案号（依赖第三方接口）", placeholder: "例如 qq.com", icon: ShieldQuestion },
];

type Result = Record<string, unknown> & { ok: boolean; error?: string; kind?: string };

const FIELD_LABEL: Record<string, string> = {
  ip: "IP 地址", country: "国家/地区", region: "省份/州", city: "城市", isp: "运营商", org: "机构",
  asn: "ASN", timezone: "时区", location: "经纬度", source: "数据来源",
  domain: "域名", server: "Whois 服务器", registrar: "注册商", createdDate: "注册时间",
  expiryDate: "到期时间", updatedDate: "更新时间", registrant: "注册人/机构", rawLines: "原始行数",
  finalUrl: "最终地址", hops: "跳转次数", wasShortened: "是否经过缩短", path: "路径",
  unitName: "主办单位", nature: "单位性质", icpCode: "备案号", siteName: "网站名称", updatedAt: "更新时间",
  proxy: "是否代理", hosting: "机房托管", mobile: "移动网络",
};

const HIDDEN = new Set(["ok", "kind", "type", "error", "raw", "chain", "nameServers", "status"]);

/** 字段值 → 可读文本。数组逐项拼接、布尔转「是/否」、嵌套对象兜底 JSON 化 ——
 *  以前 String(嵌套对象) 直接渲染成 "[object Object]"（IP 归属地页就这样翻车）。 */
function fmtValue(v: unknown): string {
  if (Array.isArray(v)) return v.map((x) => fmtValue(x)).join("、");
  if (v === true) return "是";
  if (v === false) return "否";
  if (v !== null && v !== undefined && typeof v === "object") {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v ?? "");
}

export function NetQueryTool() {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>("ip");
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const active = MODES.find((m) => m.id === mode)!;

  const run = async () => {
    const q = query.trim();
    if (!q) {
      toast({ title: "请输入要查询的内容", variant: "info" });
      return;
    }
    setBusy(true);
    setResult(null);
    const t0 = Date.now();
    try {
      const r = await fetch("/api/net-query", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, query: q }),
      });
      const d = (await r.json()) as Result;
      setResult(d);
      setElapsed(Date.now() - t0);
      if (!d.ok) toast({ title: "没有查到结果", description: d.error, variant: "error" });
    } catch (err) {
      setResult({ ok: false, error: err instanceof Error ? err.message : "请求失败" });
      toast({ title: "查询失败", description: "网络不可用或接口无响应", variant: "error" });
    } finally {
      setBusy(false);
    }
  };

  const copyAll = async () => {
    if (!result) return;
    const lines = Object.entries(result)
      .filter(([k, v]) => !HIDDEN.has(k) && v !== "" && v != null)
      .map(([k, v]) => `${FIELD_LABEL[k] ?? k}：${fmtValue(v)}`);
    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      toast({ title: "已复制查询结果", variant: "success" });
    } catch {
      toast({ title: "复制失败", variant: "error" });
    }
  };

  const fields = result && result.ok
    ? Object.entries(result).filter(([k, v]) => !HIDDEN.has(k) && v !== "" && v != null && !(Array.isArray(v) && v.length === 0))
    : [];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid items-start gap-4 xl:grid-cols-[1fr_340px]">
        {/* 左：查询与结果 */}
        <section className="min-w-0 rounded-2xl border p-4" style={{ borderColor: colors.borderSolid, background: colors.card }}>
          <header className="mb-3 flex flex-wrap items-center gap-2">
            {MODES.map((m) => {
              const Icon = m.icon;
              const on = m.id === mode;
              return (
                <Button
                  key={m.id}
                  size="sm"
                  variant={on ? "default" : "outline"}
                  className="gap-1.5"
                  onClick={() => {
                    setMode(m.id);
                    setResult(null);
                    setQuery("");
                  }}
                >
                  <Icon size={13} /> {__ui(m.label)}
                </Button>
              );
            })}
          </header>

          <div className="flex flex-wrap items-center gap-2.5">
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && void run()}
              placeholder={__ui(active.placeholder)}
              className="min-w-0 flex-1"
            />
            <Button className="gap-2" onClick={() => void run()} disabled={busy}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />} {__ui("查询")}</Button>
          </div>
          <p className="mt-2 text-[11.5px]" style={{ color: colors.muted }}>{__ui(active.hint)}</p>

          <div className="mt-4">
            {busy && (
              <div className="flex h-40 items-center justify-center gap-2 text-[12.5px]" style={{ color: colors.muted }}>
                <Loader2 size={15} className="animate-spin" /> {__ui("正在查询…")}</div>
            )}

            {!busy && !result && (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-primary/40 bg-primary/[0.04] py-14">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                  <Globe className="h-5 w-5" />
                </span>
                <p className="text-[13px] font-semibold" style={{ color: colors.text }}>{__ui("输入内容后点「查询」")}</p>
                <p className="text-[11.5px]" style={{ color: colors.muted }}>{__ui("结果里每一项都会标明数据来源")}</p>
              </div>
            )}

            {!busy && result && !result.ok && (
              <div className="rounded-xl border p-4" style={{ borderColor: `${colors.gold}66`, background: `${colors.gold}12` }}>
                <p className="flex items-center gap-2 text-[12.5px] font-medium" style={{ color: colors.text }}>
                  <AlertTriangle size={14} style={{ color: colors.gold }} /> {__ui("没有查到结果")}</p>
                <p className="mt-1.5 text-[12px] leading-relaxed" style={{ color: colors.muted }}>{__msg(result.error)}</p>
                {mode === "icp" && (
                  <a
                    href="https://beian.miit.gov.cn/"
                    target="_blank"
                    rel="noreferrer"
                    className="mt-3 inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12px] font-medium"
                    style={{ borderColor: colors.borderSolid, color: colors.text }}
                  >
                    <Link2 size={12} /> {__ui("打开工信部备案系统自行查询")}</a>
                )}
              </div>
            )}

            {!busy && result && result.ok && (
              <div className="rounded-xl border p-4" style={{ borderColor: colors.borderSolid, background: colors.bg }}>
                <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <span className="flex items-center gap-2 text-[12.5px] font-medium" style={{ color: colors.green }}>
                    <Check size={13} /> {__ui("查询成功")}<span className="text-[11px] font-normal" style={{ color: colors.muted }}>{__ui("耗时")}{elapsed} ms</span>
                  </span>
                  <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void copyAll()}>
                    <Copy size={12} /> {__ui("复制结果")}</Button>
                </header>

                <dl className="flex flex-col gap-0">
                  {fields.map(([k, v]) => (
                    <div key={k} className="flex items-start justify-between gap-3 border-b py-2 last:border-b-0" style={{ borderColor: colors.borderSolid }}>
                      <dt className="shrink-0 text-[12px]" style={{ color: colors.muted }}>{__ui(FIELD_LABEL[k]) ?? k}</dt>
                      <dd className="min-w-0 break-all text-right text-[12.5px]" style={{ color: colors.text }}>
                        {fmtValue(v)}
                      </dd>
                    </div>
                  ))}
                </dl>

                {Array.isArray(result.chain) && (result.chain as { url: string; status: number }[]).length > 0 && (
                  <div className="mt-3">
                    <p className="mb-1.5 text-[12px] font-medium" style={{ color: colors.muted }}>{__ui("跳转链路")}</p>
                    <ol className="flex flex-col gap-1">
                      {(result.chain as { url: string; status: number }[]).map((c, i) => (
                        <li key={i} className="flex items-start gap-2 text-[11.5px]" style={{ color: colors.text }}>
                          <span className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10.5px]" style={{ background: colors.active, color: colors.muted }}>
                            {__msg(c.status)}
                          </span>
                          <span className="min-w-0 break-all">{c.url}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* 右：说明 */}
        <div className="flex min-w-0 flex-col gap-4 overscroll-contain xl:sticky xl:top-4 xl:max-h-[calc(100vh-190px)] xl:overflow-y-auto xl:pr-1">
          <section className="rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
            <h3 className="mb-2.5 flex items-center gap-1.5 text-[12.5px] font-semibold" style={{ color: colors.text }}>
              <AlertTriangle size={13} style={{ color: colors.gold }} /> {__ui("此工具需要联网")}</h3>
            <p className="text-[11.5px] leading-relaxed" style={{ color: colors.muted }}>
              {__ui("查询内容会发到对应的公共服务上。断网或接口不能用时，页面会直接说明原因，不会编一个结果给你。")}</p>
          </section>

          <section className="rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
            <h3 className="mb-2.5 text-[12.5px] font-semibold" style={{ color: colors.muted }}>{__ui("四种查询能做什么")}</h3>
            <ul className="flex flex-col gap-2 text-[11.5px] leading-relaxed" style={{ color: colors.muted }}>
              {MODES.map((m) => (
                <li key={m.id}>
                  <strong style={{ color: colors.text }}>{__ui(m.label)}</strong>：{__ui(m.hint)}
                </li>
              ))}
            </ul>
            <p className={cn("mt-3 text-[11px] leading-relaxed")} style={{ color: colors.muted }}>
              {__ui("备案查询依赖第三方接口，稳定性无法保证；查不到时会给出工信部官方查询入口。")}</p>
          </section>
        </div>
      </div>
    </div>
  );
}
