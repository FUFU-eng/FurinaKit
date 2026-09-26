"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/watermark-result-preview.tsx");

import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Download, Loader2, RefreshCw, ZoomIn, Minimize2 } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/primitives";
import { useJobPreviewUrl } from "@/lib/use-job-preview";
import { downloadJobResult } from "@/lib/job-download";
import type { WatermarkResult } from "@/lib/watermark-job";

function PreviewPane({ jobId, originalUrl, retry }: { jobId: string; originalUrl: string; retry: () => void }) {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  const url = useJobPreviewUrl(jobId);
  const [mode, setMode] = useState<"result" | "original" | "compare">("result");
  const [split, setSplit] = useState(50);
  const [actualSize, setActualSize] = useState<{ w: number; h: number } | null>(null);
  const [actualPixels, setActualPixels] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (actualSize || failed) return;
    const timer = setTimeout(() => setFailed(true), 12000);
    return () => clearTimeout(timer);
  }, [actualSize, failed]);
  const ready = !!actualSize && !failed;
  return <>
    <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
      <div role="group" aria-label={__ui("预览方式")} className="inline-flex rounded-xl border p-1" style={{ borderColor: colors.borderSolid, background: colors.bg }}>
        {([['result', '处理结果'], ['original', '原图'], ['compare', '滑动对比']] as const).map(([value, label]) =>
          <button key={value} type="button" aria-pressed={mode === value} disabled={!ready && value !== 'original'} onClick={() => setMode(value)} className="rounded-lg px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-40" style={{ background: mode === value ? colors.card : 'transparent', color: mode === value ? colors.text : colors.muted }}>{__ui(label)}</button>)}
      </div>
      <Button size="sm" variant="ghost" disabled={!ready} onClick={() => setActualPixels(v => !v)}>
        {actualPixels ? <Minimize2 size={13} /> : <ZoomIn size={13} />}{actualPixels ? __ui("适应窗口") : __ui("100% 查看细节")}
      </Button>
    </div>
    <div className="max-h-[65vh] min-h-48 overflow-auto rounded-xl border p-3" style={{ background: colors.bg, borderColor: colors.borderSolid }}>
      {failed && mode !== 'original' ? <div role="alert" className="flex min-h-48 flex-col items-center justify-center gap-3 text-center">
        <p className="text-sm" style={{ color: colors.text }}>{__ui("结果已生成，暂时无法显示预览")}</p>
        <p className="text-xs" style={{ color: colors.muted }}>{__ui("可以重新加载，或保存原始结果后查看；无需再次去水印。")}</p>
        <Button size="sm" variant="outline" onClick={retry}><RefreshCw size={13} />{__ui("重新加载预览")}</Button>
      </div> : <>
        {!ready && mode !== 'original' && <div role="status" className="flex h-48 items-center justify-center gap-2 text-xs" style={{ color: colors.muted }}><Loader2 size={16} className="animate-spin" />{__ui("正在载入处理结果…")}</div>}
        <div className="relative mx-auto overflow-hidden rounded-lg" style={{ width: actualPixels && actualSize ? actualSize.w : undefined, maxWidth: actualPixels ? 'none' : '100%' }}>
          {url && <img src={url} alt={__ui("去水印处理结果")} draggable={false} onLoad={e => { setActualSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight }); setFailed(false); }} onError={() => setFailed(true)} className="block h-auto w-full" style={{ visibility: mode === 'original' || !ready ? 'hidden' : 'visible', maxHeight: !actualSize ? 0 : undefined }} />}
          {(mode === 'original' || mode === 'compare') && <img src={originalUrl} alt={__ui("未处理的原图")} draggable={false} className={actualSize ? 'absolute inset-0 h-full w-full object-contain' : 'block h-auto w-full'} style={{ clipPath: mode === 'compare' ? `inset(0 ${100 - split}% 0 0)` : undefined }} />}
          {ready && mode === 'compare' && <>
            <span className="pointer-events-none absolute inset-y-0 w-0.5 bg-white shadow" style={{ left: `${split}%` }} />
            <span className="pointer-events-none absolute left-3 top-3 rounded-md bg-black/60 px-2 py-1 text-[11px] text-white">{__ui("原图")}</span>
            <span className="pointer-events-none absolute right-3 top-3 rounded-md bg-black/60 px-2 py-1 text-[11px] text-white">{__ui("处理后")}</span>
          </>}
        </div>
      </>}
    </div>
    {ready && mode === 'compare' && <label className="mt-3 flex items-center gap-3 text-xs" style={{ color: colors.muted }}>
      <span className="shrink-0">{__ui("原图")}</span><input aria-label={__ui("原图显示比例")} type="range" min={0} max={100} value={split} onChange={e => setSplit(Number(e.target.value))} className="min-w-0 flex-1 accent-primary" /><span className="shrink-0">{__ui("处理后")}</span>
    </label>}
    <p className="mt-2 text-[11px] leading-5" style={{ color: colors.muted }}>{__ui("预览不会覆盖原图。超大图片可能显示缩略预览，保存的仍是原始分辨率产物。")}</p>
  </>;
}

export function WatermarkResultPreview({ result, originalUrl, busy }: { result: WatermarkResult; originalUrl: string; busy: boolean }) {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  const { toast } = useToast();
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const save = async () => {
    if (savingRef.current) return;
    savingRef.current = true; setSaving(true);
    try {
      const saved = await downloadJobResult(result.jobId, result.filename);
      if (saved && alive.current) toast({ title: "去水印结果已保存到默认输出目录", variant: "success" });
    } catch (e) {
      if (alive.current) toast({ title: "保存失败", description: e instanceof Error ? e.message : String(e), variant: "error" });
    } finally { savingRef.current = false; if (alive.current) setSaving(false); }
  };
  return <section className="rounded-2xl border p-4" aria-label={__ui("去水印效果预览")} style={{ borderColor: colors.borderSolid, background: colors.card }}>
    <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0"><h3 className="flex items-center gap-2 text-sm font-semibold" style={{ color: colors.text }}><CheckCircle2 size={16} style={{ color: colors.green }} />{busy ? __ui("上次处理结果 · 新结果生成中") : __ui("去水印效果")}</h3><p className="mt-1 text-xs" style={{ color: colors.muted }}>{__msg(result.message)} {__ui("· 先查看效果，满意后再保存")}</p></div>
      <Button className="gap-1.5" disabled={saving} onClick={() => void save()}>{saving ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}{saving ? __ui("正在保存…") : __ui("保存处理结果")}</Button>
    </header>
    <PreviewPane key={`${result.jobId}-${attempt}`} jobId={result.jobId} originalUrl={originalUrl} retry={() => setAttempt(n => n + 1)} />
  </section>;
}
