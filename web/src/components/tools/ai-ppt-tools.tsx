"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage, uiCount as __count } from "@/lib/language";
const __ui = __createUiText("components/tools/ai-ppt-tools.tsx");

import { downloadJobResult } from "@/lib/job-download";

/**
 * AI 生成 PPT 大纲 / AI 生成 PPT 草稿
 *
 * 两个工具共用一套输入与大纲生成逻辑，区别在最后一步：
 *  · 大纲工具：把结构导成 Markdown / TXT / JSON，拿去自己排版；
 *  · 草稿工具：把大纲交给本地引擎直接生成**可编辑的 PPTX**（不是截图，
 *    标题、正文、项目符号、备注都能在 PowerPoint 里继续改）。
 */

import { useCallback, useMemo, useState } from "react";
import {
  AlertCircle, ChevronDown, ChevronRight, Copy, Download, FileText, Layers,
  Loader2, Palette, Presentation, RefreshCw, Sparkles, Wand2,
} from "lucide-react";
import { Button, Input, Select, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useTheme } from "@/components/theme-provider";
import { AiConfigPanel, useAiConfig } from "@/components/tools/ai-tools";
import { cn } from "@/lib/utils";

interface OutlineSlide {
  title?: string;
  points?: string[];
  notes?: string;
}
interface Outline {
  title?: string;
  subtitle?: string;
  slides?: OutlineSlide[];
}

const STYLES = ["商务正式", "教学讲解", "产品发布", "学术汇报", "轻松活泼"];
const THEMES = [
  { id: "business", name: "商务蓝" },
  { id: "fresh", name: "清新绿" },
  { id: "warm", name: "暖橙" },
  { id: "dark", name: "暗夜紫" },
];

function NotConfigured() {
  const __locale = __useLanguage();
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-2.5 rounded-xl border p-4" style={{ borderColor: "rgba(217,119,6,0.4)", background: "rgba(217,119,6,0.08)" }}>
        <AlertCircle size={15} className="mt-0.5 shrink-0" style={{ color: "#d97706" }} />
        <p className="text-[12.5px] leading-relaxed">{__ui("这个工具需要调用 AI 服务，请先填写 API Key。配置只保存在本机，一次配置后所有 AI 工具都能用。")}</p>
      </div>
      <AiConfigPanel compact />
    </div>
  );
}

/** 两个工具共用的输入表单 */
function OutlineForm({
  topic, setTopic, materials, setMaterials, audience, setAudience,
  slideCount, setSlideCount, style, setStyle, onGenerate, busy, error, colors,
}: {
  topic: string;
  setTopic: (v: string) => void;
  materials: string;
  setMaterials: (v: string) => void;
  audience: string;
  setAudience: (v: string) => void;
  slideCount: string;
  setSlideCount: (v: string) => void;
  style: string;
  setStyle: (v: string) => void;
  onGenerate: () => void;
  busy: boolean;
  error: string;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const __locale = __useLanguage();
  return (
    <section className="rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
      <header className="mb-3.5 flex items-center gap-2">
        <Sparkles size={16} />
        <h2 className="text-[14px] font-semibold" style={{ color: colors.text }}>{__ui("演示主题")}</h2>
      </header>
      <div className="grid gap-3.5 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-[12.5px] font-medium" style={{ color: colors.text }}>{__ui("要讲什么")}</span>
          <Textarea
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            rows={2}
            placeholder={__ui("例如：给部门同事汇报 2.1.0 版本新增的工具；或者：给客户介绍我们的售后流程")}
          />
        </label>
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-[12.5px] font-medium" style={{ color: colors.text }}>{__ui("可参考的资料 / 必须讲到的要点（可选）")}</span>
          <Textarea
            value={materials}
            onChange={(e) => setMaterials(e.target.value)}
            rows={4}
            placeholder={__ui("把已有的资料、数据、要点粘进来，AI 会据此组织内容，不会凭空编")}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium" style={{ color: colors.text }}>{__ui("内容页数")}</span>
          <Select value={slideCount} onChange={(e) => setSlideCount(e.target.value)}>
            {["5", "8", "10", "12", "15", "20"].map((n) => (
              <option key={n} value={n}>{__count(n, "页")} </option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[12.5px] font-medium" style={{ color: colors.text }}>{__ui("风格")}</span>
          <Select value={style} onChange={(e) => setStyle(e.target.value)}>
            {STYLES.map((s) => (
              <option key={s} value={s}>{__msg(s)}</option>
            ))}
          </Select>
        </label>
        <label className="flex flex-col gap-1.5 sm:col-span-2">
          <span className="text-[12.5px] font-medium" style={{ color: colors.text }}>{__ui("听众（可选）")}</span>
          <Input value={audience} onChange={(e) => setAudience(e.target.value)} placeholder={__ui("例如：完全不了解这块业务的领导、新入职同事")} />
        </label>
      </div>
      <div className="mt-4">
        <Button className="gap-2" onClick={onGenerate} disabled={busy || !topic.trim()}>
          {busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
          {busy ? __ui("正在生成大纲…") : __ui("生成大纲")}
        </Button>
      </div>
      {error && (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-[12.5px] text-destructive">
          <AlertCircle size={14} className="mt-0.5 shrink-0" /> {__msg(error)}
        </p>
      )}
    </section>
  );
}

/** 大纲展示（可逐页展开，也能直接改文字） */
function OutlineView({
  outline,
  onChange,
  colors,
}: {
  outline: Outline;
  onChange: (o: Outline) => void;
  colors: ReturnType<typeof useTheme>["colors"];
}) {
  const __locale = __useLanguage();
  const [open, setOpen] = useState<number[]>([0]);
  const slides = outline.slides ?? [];

  const updateSlide = (i: number, patch: Partial<OutlineSlide>) => {
    const next = slides.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
    onChange({ ...outline, slides: next });
  };

  return (
    <section className="rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Layers size={15} />
          <h2 className="text-[14px] font-semibold" style={{ color: colors.text }}>{__ui("大纲")}</h2>
          <span className="text-[11.5px]" style={{ color: colors.muted }}>
            {slides.length} {__ui("页内容 · 可直接修改文字")}</span>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5"
          onClick={() => setOpen(open.length === slides.length ? [] : slides.map((_, i) => i))}
        >
          {open.length === slides.length ? __ui("全部收起") : __ui("全部展开")}
        </Button>
      </header>

      <div className="mb-3 rounded-xl border p-3.5" style={{ borderColor: colors.borderSolid, background: colors.bg }}>
        <input
          value={outline.title ?? ""}
          onChange={(e) => onChange({ ...outline, title: e.target.value })}
          className="w-full bg-transparent text-[16px] font-bold focus:outline-none"
          style={{ color: colors.text }}
        />
        <input
          value={outline.subtitle ?? ""}
          onChange={(e) => onChange({ ...outline, subtitle: e.target.value })}
          className="mt-1 w-full bg-transparent text-[12.5px] focus:outline-none"
          style={{ color: colors.muted }}
          placeholder={__ui("副标题（可选）")}
        />
      </div>

      <div className="flex flex-col gap-2">
        {slides.map((s, i) => {
          const expanded = open.includes(i);
          return (
            <div key={i} className="rounded-xl border" style={{ borderColor: colors.borderSolid }}>
              <button
                onClick={() => setOpen((o) => (o.includes(i) ? o.filter((x) => x !== i) : [...o, i]))}
                className="flex w-full items-center gap-2 px-3.5 py-2.5 text-left"
              >
                {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                <span className="w-7 shrink-0 font-mono text-[12px]" style={{ color: colors.muted }}>{String(i + 1).padStart(2, "0")}</span>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium" style={{ color: colors.text }}>{s.title}</span>
                <span className="shrink-0 text-[11px]" style={{ color: colors.muted }}>{(s.points ?? []).length} {__ui("条要点")}</span>
              </button>
              {expanded && (
                <div className="border-t px-3.5 py-3" style={{ borderColor: colors.borderSolid }}>
                  <input
                    value={s.title ?? ""}
                    onChange={(e) => updateSlide(i, { title: e.target.value })}
                    className="mb-2 w-full rounded-lg border px-2.5 py-1.5 text-[13px] font-medium focus:outline-none"
                    style={{ borderColor: colors.borderSolid, background: colors.bg, color: colors.text }}
                  />
                  <textarea
                    value={(s.points ?? []).join("\n")}
                    onChange={(e) => updateSlide(i, { points: e.target.value.split("\n") })}
                    rows={Math.max(3, (s.points ?? []).length)}
                    className="w-full resize-y rounded-lg border px-2.5 py-1.5 text-[12.5px] leading-relaxed focus:outline-none"
                    style={{ borderColor: colors.borderSolid, background: colors.bg, color: colors.text }}
                    placeholder={__ui("每行一条要点；以 - 开头的会作为二级要点")}
                  />
                  <textarea
                    value={s.notes ?? ""}
                    onChange={(e) => updateSlide(i, { notes: e.target.value })}
                    rows={2}
                    className="mt-2 w-full resize-y rounded-lg border px-2.5 py-1.5 text-[12px] focus:outline-none"
                    style={{ borderColor: colors.borderSolid, background: colors.bg, color: colors.muted }}
                    placeholder={__ui("演讲者备注（会写进 PPT 的备注区）")}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** 共用的生成逻辑 */
function useOutlineGeneration() {
  const [outline, setOutline] = useState<Outline | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [topic, setTopic] = useState("");
  const [materials, setMaterials] = useState("");
  const [audience, setAudience] = useState("");
  const [slideCount, setSlideCount] = useState("8");
  const [style, setStyle] = useState(STYLES[0]);

  const generate = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/ai/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "ppt_outline", topic, materials, audience, slideCount: Number(slideCount), style }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "生成失败");
      setOutline(data.outline as Outline);
    } catch (err) {
      setError(err instanceof Error ? err.message : "生成失败");
    } finally {
      setBusy(false);
    }
  }, [topic, materials, audience, slideCount, style]);

  return { outline, setOutline, busy, error, topic, setTopic, materials, setMaterials, audience, setAudience, slideCount, setSlideCount, style, setStyle, generate };
}

function toMarkdown(o: Outline): string {
  const lines: string[] = [`# ${o.title ?? ""}`, "", o.subtitle ? `> ${o.subtitle}` : "", ""];
  (o.slides ?? []).forEach((s, i) => {
    lines.push(`## ${i + 1}. ${s.title ?? ""}`, "");
    (s.points ?? []).forEach((p) => {
      const sub = p.trim().startsWith("-") || p.trim().startsWith("•");
      lines.push(sub ? `  - ${p.replace(/^[-•\s]+/, "")}` : `- ${p}`);
    });
    lines.push("");
    if (s.notes) lines.push(`> 备注：${s.notes}`, "");
  });
  return lines.join("\n");
}

function download(name: string, content: string, mime = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* 单一PPT入口：生成/编辑大纲并导出可编辑PPTX。 */

export function AiPptDraftTool() {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  const { toast } = useToast();
  const { config } = useAiConfig();
  const g = useOutlineGeneration();
  const [themeId, setThemeId] = useState("business");
  const [withToc, setWithToc] = useState(true);
  const [building, setBuilding] = useState(false);
  const [progress, setProgress] = useState("");

  const build = useCallback(async () => {
    if (!g.outline) return;
    setBuilding(true);
    setProgress("正在排版…");
    try {
      const res = await fetch("/api/ppt/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outline: g.outline, theme: themeId, with_toc: withToc }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "创建任务失败");
      const jobId = data.job?.id;
      if (!jobId) throw new Error("未取得PPT任务编号");
      for (let i = 0; i < 120; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const j = await (await fetch(`/api/jobs/${jobId}`, { cache: "no-store" })).json();
        const st = j.job?.status;
        if (st === "completed") {
          setProgress("");
          toast({ title: "已生成可编辑的 PPTX", description: j.job.resultFilename, variant: "success" });
          if (!await downloadJobResult(jobId, j.job.resultFilename || "演示文稿.pptx")) throw new Error("PPT已生成，但保存未完成，请从任务记录重新保存");
          return;
        }
        if (st === "failed") throw new Error(j.job?.error || "生成失败");
        setProgress(`正在排版… ${j.job?.progress ?? 0}%`);
      }
      throw new Error("生成超时");
    } catch (err) {
      toast({ title: "生成失败", description: err instanceof Error ? err.message : "", variant: "error" });
      setProgress("");
    } finally {
      setBuilding(false);
    }
  }, [g.outline, themeId, withToc, toast]);

  const slideTotal = useMemo(() => (g.outline?.slides?.length ?? 0) + (withToc && (g.outline?.slides?.length ?? 0)>1 ? 3 : 2), [g.outline, withToc, __locale]);

  if (config && !config.hasKey) return <NotConfigured />;

  return (
    <div className="flex flex-col gap-4">
      <OutlineForm {...g} colors={colors} onGenerate={() => void g.generate()} />

      {g.outline && (
        <>
          <section className="rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
            <header className="mb-3 flex items-center gap-2">
              <Palette size={15} />
              <h2 className="text-[14px] font-semibold" style={{ color: colors.text }}>{__ui("排版设置")}</h2>
            </header>
            <div className="flex flex-wrap items-end gap-4">
              <div className="flex flex-col gap-2">
                <span className="text-[12.5px] font-medium" style={{ color: colors.text }}>{__ui("配色主题")}</span>
                <div className="flex gap-2">
                  {THEMES.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => setThemeId(t.id)}
                      className="rounded-xl border px-3 py-1.5 text-[12.5px] transition-all"
                      style={{
                        borderColor: themeId === t.id ? "hsl(var(--primary))" : colors.borderSolid,
                        background: themeId === t.id ? colors.active : "transparent",
                        color: colors.text,
                      }}
                    >
                      {__msg(t.name)}
                    </button>
                  ))}
                </div>
              </div>
              <label className="flex cursor-pointer items-center gap-2">
                <input type="checkbox" checked={withToc} onChange={(e) => setWithToc(e.target.checked)} className="h-4 w-4" />
                <span className="text-[12.5px]" style={{ color: colors.text }}>{__ui("自动生成目录页")}</span>
              </label>
              <div className="ml-auto flex items-center gap-3">
                <span className="text-[12px]" style={{ color: colors.muted }}>{__ui("预计")}{__count(slideTotal, "页")} </span>
                <Button className="gap-2" onClick={() => void build()} disabled={building}>
                  {building ? <Loader2 size={14} className="animate-spin" /> : <Presentation size={14} />}
                  {building ? progress || __ui("正在生成…") : __ui("生成可编辑 PPTX")}
                </Button>
              </div>
            </div>
            <p className="mt-3 flex items-start gap-1.5 text-[11.5px]" style={{ color: colors.muted }}>
              <FileText size={12} className="mt-0.5 shrink-0" />
              {__ui("生成的是真正的 PPT：标题、正文、项目符号与备注都是可编辑文本框，可以继续换字体、调配色、增删条目。")}</p>
          </section>

          <OutlineView outline={g.outline} onChange={g.setOutline} colors={colors} />
        </>
      )}
    </div>
  );
}
