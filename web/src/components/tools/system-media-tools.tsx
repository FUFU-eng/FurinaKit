import { localeTag as __localeTag } from "@/lib/language";
"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/system-media-tools.tsx");


/**
 * 系统类工具：媒体信息查看器、网页转图片/PDF。
 *
 * 两者的共同点：都靠**系统已有的能力**干活，不引新依赖 ——
 *   · 媒体信息用 ffprobe（与 ffmpeg 同源，应用本来就用 ffmpeg 录屏）；
 *   · 网页导出用系统自带的 Edge（或 Chrome）无头模式，也就是**真浏览器渲染**，
 *     和你在浏览器里看到的一致（比自己在沙箱里拼 HTML 靠谱得多）。
 *
 * 布局：都是 **模式 B（4:8）** —— 左边设置，右边结果。结果区是主角。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { chapterSeconds, formatFrameRate, isImageContainer, normalizeLocalPath, probeDataIssue } from "@/lib/media-info-format";
import {
  AlertTriangle,
  Clock,
  Download,
  ExternalLink,
  FileAudio,
  FileText,
  FileVideo,
  Film,
  Globe,
  Image as ImageIcon,
  Info,
  Layers,
  Loader2,
  Monitor,
  Music,
  Subtitles,
  Sparkles,
  Wand2,
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
    <div className="flex items-start gap-2 rounded-xl border-l-4 border-l-destructive bg-destructive/10 px-4 py-3 text-xs text-destructive">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="leading-relaxed">{__msg(message)}</span>
    </div>
  );
}

const nf = (n: number, digits = 0) =>
  Number.isFinite(n) ? n.toLocaleString(__localeTag(), { maximumFractionDigits: digits }) : "—";

/** 秒 → 1 小时 02 分 03 秒 */
function humanTime(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return "—";
  const s = Math.round(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (h > 0) return `${h} 小时 ${String(m).padStart(2, "0")} 分 ${String(ss).padStart(2, "0")} 秒`;
  if (m > 0) return `${m} 分 ${String(ss).padStart(2, "0")} 秒`;
  return `${ss} 秒`;
}

const humanSize = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${u[i]}`;
};

const fmtBitrate = (v: string | number | undefined) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)} Mbps` : `${Math.round(n / 1000)} kbps`;
};

interface FFStream {
  index: number;
  codec_type?: string;
  codec_name?: string;
  codec_long_name?: string;
  profile?: string;
  width?: number;
  height?: number;
  pix_fmt?: string;
  r_frame_rate?: string;
  avg_frame_rate?: string;
  bit_rate?: string;
  sample_rate?: string;
  channels?: number;
  channel_layout?: string;
  bits_per_raw_sample?: string;
  duration?: string;
  tags?: Record<string, string>;
  disposition?: Record<string, number>;
}

interface FFProbe {
  streams?: FFStream[];
  format?: {
    filename?: string;
    format_name?: string;
    format_long_name?: string;
    duration?: string;
    size?: string;
    bit_rate?: string;
    tags?: Record<string, string>;
  };
  chapters?: Array<{ id?: number; time_base?: string; start?: number; end?: number; start_time?: string; end_time?: string; tags?: Record<string, string> }>;
}

// ══════════════════════════════════════════════════════════════════════
// 工具一：媒体信息查看器
// ══════════════════════════════════════════════════════════════════════

const STREAM_META: Record<string, { label: string; icon: React.ReactNode; tone: string }> = {
  video: { label: "视频流", icon: <FileVideo className="h-3.5 w-3.5" />, tone: "text-primary" },
  image: { label: "图像", icon: <ImageIcon className="h-3.5 w-3.5" />, tone: "text-primary" },
  audio: { label: "音频流", icon: <FileAudio className="h-3.5 w-3.5" />, tone: "text-emerald-600 dark:text-emerald-400" },
  subtitle: { label: "字幕流", icon: <Subtitles className="h-3.5 w-3.5" />, tone: "text-amber-600 dark:text-amber-400" },
  data: { label: "数据流", icon: <Layers className="h-3.5 w-3.5" />, tone: "text-muted-foreground" },
  attachment: { label: "附件", icon: <FileText className="h-3.5 w-3.5" />, tone: "text-muted-foreground" },
};

export function MediaInfoTool() {
  const __locale = __useLanguage();
  const [path, setPath] = useState<string | null>(null);
  const [data, setData] = useState<FFProbe | null>(null);
  const [manualPath, setManualPath] = useState("");
  const reading = useRef(false);
  const mounted = useRef(true);
  const [stage, setStage] = useState<"selecting" | "reading" | null>(null);
  const busy = stage !== null;
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const probeSelected = useCallback(async (selected: string) => {
    setStage("reading");
    setError(null);
    setData(null);
    setPath(selected);
    const res = await fetch(`/api/media/probe?path=${encodeURIComponent(selected)}`);
    const d = await res.json();
    if (!res.ok || !d.success) throw new Error(d.error || "读取失败");
    const parsed: unknown = JSON.parse(d.json);
    const issue = probeDataIssue(parsed);
    if (issue) throw new Error(issue);
    if (mounted.current) setData(parsed as FFProbe);
  }, []);

  const load = useCallback(async (input: string) => {
    const selected = normalizeLocalPath(input);
    if (!selected) { setError("请选择文件或输入完整路径"); return; }
    if (reading.current) return;
    reading.current = true;
    setManualPath(selected);
    try { await probeSelected(selected); }
    catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "读取失败"); }
    finally { reading.current = false; if (mounted.current) setStage(null); }
  }, [probeSelected]);

  const pick = useCallback(async () => {
    if (reading.current) return;
    reading.current = true;
    setStage("selecting");
    setError(null);
    try {
      const w = window as unknown as { furinakit?: { pickFile?: (ext: string[]) => Promise<string | null> } };
      if (!w.furinakit?.pickFile) throw new Error("系统文件框不可用，请使用下方完整路径入口");
      const p = await w.furinakit.pickFile([
        "mp4", "mkv", "mov", "avi", "webm", "flv", "wmv", "ts", "m4v",
        "mp3", "flac", "wav", "aac", "m4a", "ogg", "opus", "wma",
        "jpg", "jpeg", "png", "webp", "gif", "bmp", "tiff", "heic",
      ]);
      if (p && mounted.current) { const selected = normalizeLocalPath(p); setManualPath(selected); await probeSelected(selected); }
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "读取失败"); }
    finally { reading.current = false; if (mounted.current) setStage(null); }
  }, [probeSelected]);

  const fmt = data?.format;
  const streams = data?.streams ?? [];
  const imageContainer = isImageContainer(fmt?.format_name);
  const groups = useMemo(() => {
    const g: Record<string, FFStream[]> = Object.create(null);
    for (const s of streams) {
      const t = imageContainer && s.codec_type === "video" ? "image" : s.codec_type || "data";
      (g[t] ||= []).push(s);
    }
    return g;
  }, [streams, imageContainer, __locale]);

  const duration = Number(fmt?.duration) || 0;
  const size = Number(fmt?.size) || 0;
  const overall = Number(fmt?.bit_rate) || 0;

  const fileName = path ? path.split(/[\\/]/).pop() : "";

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="thin-scroll space-y-4 lg:col-span-4">
          <SectionCard
            icon={<Film className="h-4 w-4" />}
            title={__ui("选择文件")}
            extra={
              <Button type="button" variant="outline" size="sm" onClick={() => void pick()} disabled={busy}>
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : __ui("选择文件")}
              </Button>
            }
          >
            <button
              type="button"
              onClick={() => void pick()}
              disabled={busy}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-primary/35 bg-primary/[0.06] p-6 text-center transition-colors hover:border-primary/60 hover:bg-primary/10"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <Film className="h-5 w-5" />
              </span>
              <span className="text-xs font-semibold text-foreground">
                {stage === "selecting" ? __ui("等待选择文件…") : busy ? __ui("正在读取…") : __ui("点击选择视频 / 音频 / 图片")}
              </span>
              <span className="text-[11px] text-muted-foreground">
                {__ui("用系统文件框选择，支持批量之外的常见格式；信息读取在本机完成")}</span>
            </button>
            <div className="mt-3 space-y-2 border-t border-border/60 pt-3">
              <Label htmlFor="media-local-path">{__ui("或输入本机文件的完整路径")}</Label>
              <Input
                id="media-local-path"
                aria-label={__ui("媒体文件完整路径")}
                value={manualPath}
                onChange={(e) => { setManualPath(e.target.value); setError(null); }}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void load(manualPath); } }}
                placeholder={__ui("例如 E:\\视频\\示例.mp4")}
                disabled={busy}
              />
              <Button type="button" variant="outline" size="sm" onClick={() => void load(manualPath)} disabled={busy || !manualPath.trim()}>
                {__ui("读取路径")}</Button>
              <p className="text-[11px] text-muted-foreground">{__ui("两种入口均在本机读取，不会上传文件。路径入口无需切换到系统文件框。")}</p>
            </div>
            {path && (
              <div className="mt-3 rounded-xl border border-border/60 bg-secondary/20 px-3 py-2">
                <div className="text-[11px] text-muted-foreground">{__ui("当前结果对应文件")}</div>
                <div className="mt-0.5 break-all font-mono text-[11.5px] text-foreground">{fileName}</div>
              </div>
            )}
            {error && <div className="mt-3"><ErrorBar message={__msg(error)} /></div>}
          </SectionCard>

          {fmt && (
            <SectionCard icon={<Info className="h-4 w-4" />} title={__ui("容器信息")}>
              <div className="grid grid-cols-2 gap-2 lg:grid-cols-1">
                {[
                  { label: "封装格式", value: fmt.format_long_name || fmt.format_name || "—" },
                  { label: "文件大小", value: humanSize(size) },
                  { label: "总时长", value: humanTime(duration) },
                  { label: "总码率", value: fmtBitrate(overall) },
                ].map((f) => (
                  <div key={f.label} className="rounded-xl border border-border/60 bg-secondary/20 px-3 py-2">
                    <div className="text-[11px] text-muted-foreground">{__ui(f.label)}</div>
                    <div className="mt-0.5 truncate font-mono text-[12.5px] text-foreground" title={f.value}>
                      {f.value}
                    </div>
                  </div>
                ))}
              </div>
              {fmt.tags && Object.keys(fmt.tags).length > 0 && (
                <div className="mt-3">
                  <div className="mb-1.5 text-[11.5px] font-medium text-foreground">{__ui("文件标签")}</div>
                  <div className="space-y-1">
                    {Object.entries(fmt.tags)
                      .slice(0, 12)
                      .map(([k, v]) => (
                        <div key={k} className="flex gap-2 text-[11.5px]">
                          <span className="w-24 shrink-0 text-muted-foreground">{k}</span>
                          <span className="min-w-0 flex-1 break-all font-mono text-foreground">{v}</span>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </SectionCard>
          )}
        </div>

        <div className="thin-scroll space-y-4 lg:col-span-8">
          {data ? (
            <>
              <SectionCard
                icon={<Layers className="h-4 w-4" />}
                title={__msg("流信息（共 {0} 个）", streams.length)}
                extra={
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(groups).map(([type, list]) => (
                      <Badge key={type} variant="outline" className="font-normal">
                        {(__ui(STREAM_META[type]?.label) ?? type)} × {list.length}
                      </Badge>
                    ))}
                  </div>
                }
              >
                {streams.length === 0 ? (
                  <p className="py-6 text-center text-xs text-muted-foreground">{__ui("没有读到流信息")}</p>
                ) : (
                  <div className="space-y-3">
                    {Object.entries(groups).map(([type, list]) => (
                      <div key={type} className="overflow-hidden rounded-xl border border-border/60">
                        <div
                          className={cn(
                            "flex items-center gap-2 bg-muted/50 px-3 py-2 text-[12px] font-semibold",
                            STREAM_META[type]?.tone ?? "text-foreground",
                          )}
                        >
                          {STREAM_META[type]?.icon}
                          {__ui(STREAM_META[type]?.label) ?? type}
                        </div>
                        <div className="divide-y divide-border/50">
                            {list.map((s) => {
                              const fps = imageContainer ? null : formatFrameRate(s.avg_frame_rate, s.r_frame_rate);
                              const rows: Array<[string, string]> = [
                                ["编号", `#${s.index}`],
                                ["编码", `${s.codec_name ?? "—"}${s.profile ? `（${s.profile}）` : ""}`],
                              ];
                              if (s.codec_type === "video") {
                                rows.push(["分辨率", s.width && s.height ? `${s.width} × ${s.height}` : "—"]);
                                if (fps) rows.push(["帧率", `${fps} fps`]);
                                if (s.pix_fmt) rows.push(["像素格式", s.pix_fmt]);
                              }
                              if (s.codec_type === "audio") {
                                if (s.sample_rate) rows.push(["采样率", `${nf(Number(s.sample_rate))} Hz`]);
                                if (s.channels) rows.push(["声道", `${s.channels}（${s.channel_layout || "—"}）`]);
                              }
                              if (s.bit_rate) rows.push(["码率", fmtBitrate(s.bit_rate)]);
                              if (s.duration) rows.push(["时长", humanTime(Number(s.duration))]);
                              if (s.tags?.language) rows.push(["语言", s.tags.language]);
                              if (s.tags?.title) rows.push(["标题", s.tags.title]);
                              return (
                                <dl key={s.index} data-media-stream={s.index} className="grid grid-cols-2 gap-2 p-3 xl:grid-cols-3">
                                  {rows.map(([k, v]) => (
                                    <div key={k} className="min-w-0 rounded-lg bg-secondary/30 px-3 py-2">
                                      <dt className="text-[11px] text-muted-foreground">{k}</dt>
                                      <dd className="mt-1 break-words font-mono text-xs text-foreground">{v}</dd>
                                    </div>
                                  ))}
                                </dl>
                              );
                            })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </SectionCard>

              {data.chapters && data.chapters.length > 0 && (
                <SectionCard icon={<Clock className="h-4 w-4" />} title={__msg("章节（{0} 段）", data.chapters.length)}>
                  <div className="overflow-hidden rounded-xl border border-border/60">
                    <table className="w-full border-collapse text-xs">
                      <thead>
                        <tr className="bg-muted/60">
                          <th className="px-3 py-2 text-left font-semibold text-foreground">#</th>
                          <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("标题")}</th>
                          <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("起始")}</th>
                          <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("结束")}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.chapters.map((c, i) => (
                          <tr key={i} className="border-t border-border/40 even:bg-muted/20">
                            <td className="px-3 py-1.5 text-muted-foreground">{i + 1}</td>
                            <td className="px-3 py-1.5 text-foreground">{c.tags?.title ?? "—"}</td>
                            <td className="px-3 py-1.5 font-mono text-muted-foreground">{chapterSeconds(c, "start") === null ? "—" : humanTime(chapterSeconds(c, "start")!)}</td>
                            <td className="px-3 py-1.5 font-mono text-muted-foreground">{chapterSeconds(c, "end") === null ? "—" : humanTime(chapterSeconds(c, "end")!)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </SectionCard>
              )}
            </>
          ) : (
            <SectionCard>
              <div className="flex flex-col items-center justify-center gap-2.5 py-20 text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Film className="h-5 w-5" />
                </span>
                <p role="status" className="text-sm font-medium text-foreground">{stage === "selecting" ? __ui("等待系统文件选择完成…") : busy ? __ui("正在读取媒体头信息…") : __ui("选一个文件，看清它的内部结构")}</p>
                <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
                  {__ui("会列出容器格式、总时长与码率，以及每条流的编码、分辨率、帧率、采样率、声道、语言与章节。")}</p>
              </div>
            </SectionCard>
          )}

          <SectionCard icon={<Info className="h-4 w-4" />} title={__ui("说明")}>
            <ul className="space-y-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
              <li>{__ui("· 数据由本机的")}<b className="text-foreground">ffprobe</b> {__ui("读取（与录屏用的 ffmpeg 同源）， 因此拿到的是**真实参数**，不是按文件名猜的。")}</li>
              <li>{__ui("· 用来判断「这个视频到底是不是 1080p」「音频是不是真无损」「字幕是内挂还是外挂」这类问题。")}</li>
              <li>{__ui("· 常见格式都支持：MP4 / MKV / MOV / AVI / WebM / MP3 / FLAC / WAV / M4A，以及 JPG / PNG 等图片。")}</li>
              <li>{__ui("· 只读文件本身，不改动、不上传。")}</li>
            </ul>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 工具二：网页转图片 / PDF
// ══════════════════════════════════════════════════════════════════════

const SIZE_PRESETS = [
  { id: "laptop", name: "笔记本屏幕", w: 1366, h: 900 },
  { id: "fhd", name: "全高清", w: 1920, h: 1080 },
  { id: "phone", name: "手机竖屏", w: 414, h: 900 },
  { id: "full", name: "整页（很高）", w: 1440, h: 6000 },
];

export function WebExportTool() {
  const __locale = __useLanguage();
  const [url, setUrl] = useToolDraft("web-export", "url", "");
  const [sizeId, setSizeId] = useToolDraft("web-export", "sizeId", "laptop");
  const [landscape, setLandscape] = useState(false);
  const [noHeader, setNoHeader] = useState(true);
  const [waitMs, setWaitMs] = useToolDraft("web-export", "waitMs", "6000");
  const [busy, setBusy] = useState<"png" | "pdf" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ path: string; dir: string; size: number; kind: string } | null>(null);

  const size = SIZE_PRESETS.find((s) => s.id === sizeId) ?? SIZE_PRESETS[0];

  const openPath = (p: string) => {
    const w = window as unknown as { furinakit?: { openPath?: (p: string) => Promise<void> } };
    void w.furinakit?.openPath?.(p);
  };

  const run = async (kind: "png" | "pdf") => {
    if (!url.trim()) {
      setError("请先填写网址");
      return;
    }
    setBusy(kind);
    setError(null);
    setResult(null);
    try {
      const res = await fetch(kind === "png" ? "/api/webcap/image" : "/api/webcap/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          isFile: false,
          width: size.w,
          height: size.h,
          landscape,
          noHeader,
          waitMs: Number(waitMs) || 6000,
        }),
      });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || "生成失败");
      setResult({ path: d.path, dir: d.dir, size: d.size, kind });
    } catch (e) {
      setError(e instanceof Error ? e.message : "生成失败");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="thin-scroll space-y-4 lg:col-span-5">
          <SectionCard
            icon={<Globe className="h-4 w-4" />}
            title={__ui("网址")}
            extra={
              <Button type="button" variant="outline" size="sm" onClick={() => setUrl("https://www.bing.com")}>
                <Sparkles className="h-3.5 w-3.5" /> {__ui("示例")}</Button>
            }
          >
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder={__ui("https://example.com 或 example.com")}
              className="text-xs"
            />
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              {__ui("没写 http/https 会自动按 https 处理。网页需要本机能打开（不需要代理也能访问的站最稳）。")}</p>
          </SectionCard>

          <SectionCard icon={<Monitor className="h-4 w-4" />} title={__ui("导出设置")}>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="we-size">{__ui("图片尺寸（截图用）")}</Label>
                <Select id="we-size" value={sizeId} onChange={(e) => setSizeId(e.target.value)} className="w-full text-xs">
                  {SIZE_PRESETS.map((s) => (
                    <option key={s.id} value={s.id}>
                      {__msg(s.name)}
                    </option>
                  ))}
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  {__ui("当前")}{size.w} × {size.h}{__ui("。「整页」用很高的窗口，能把长页面一次截全。")}</p>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="we-wait">{__ui("等待加载（毫秒）")}</Label>
                <Input id="we-wait" type="number" value={waitMs} onChange={(e) => setWaitMs(e.target.value)} className="text-xs" />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {__ui("页面有图片/脚本时要多等一会儿再截，否则可能截到空白。常用 6000，慢站可以调到 15000。")}</p>
              </div>

              <label className="flex items-center gap-2 text-[12px] text-foreground">
                <input type="checkbox" checked={landscape} onChange={(e) => setLandscape(e.target.checked)} className="accent-primary" />
                {__ui("PDF 横向（默认竖向）")}</label>
              <label className="flex items-center gap-2 text-[12px] text-foreground">
                <input type="checkbox" checked={noHeader} onChange={(e) => setNoHeader(e.target.checked)} className="accent-primary" />
                {__ui("去掉页眉页脚（网址与页码）")}</label>

              <div className="flex flex-wrap gap-2 pt-1">
                <Button type="button" className="flex-1 gap-1.5" onClick={() => void run("png")} disabled={busy !== null}>
                  {busy === "png" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
                  {__ui("导出图片（PNG）")}</Button>
                <Button type="button" variant="outline" className="flex-1 gap-1.5" onClick={() => void run("pdf")} disabled={busy !== null}>
                  {busy === "pdf" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                  {__ui("导出 PDF")}</Button>
              </div>
              {busy && (
                <p className="text-[11px] text-muted-foreground">
                  {__ui("正在用系统自带的浏览器渲染并导出，页面复杂时可能要十几秒…")}</p>
              )}
              {error && <ErrorBar message={__msg(error)} />}
            </div>
          </SectionCard>
        </div>

        <div className="thin-scroll space-y-4 lg:col-span-7">
          <SectionCard
            icon={<Download className="h-4 w-4" />}
            title={__ui("导出结果")}
            extra={result ? <CopyButton value={result.path} label={__ui("复制路径")} /> : null}
          >
            {result ? (
              <div className="space-y-3">
                <div className="rounded-xl border border-emerald-500/40 bg-emerald-500/[0.07] px-4 py-3">
                  <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
                    <Wand2 className="h-4 w-4 text-emerald-500" />
                    {__ui("已导出")}{result.kind === "png" ? __ui("图片") : " PDF"}（{humanSize(result.size)}）
                  </div>
                  <div className="mt-1.5 break-all font-mono text-[11.5px] text-muted-foreground">{result.path}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" className="gap-1.5" onClick={() => openPath(result.path)}>
                    <ExternalLink className="h-3.5 w-3.5" /> {__ui("打开文件")}</Button>
                  <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => openPath(result.dir)}>
                    <Layers className="h-3.5 w-3.5" /> {__ui("打开所在文件夹")}</Button>
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {__ui("文件已保存到「下载」文件夹下的")}<b className="text-foreground">{__ui("FurinaKit网页导出")}</b>{__ui("，可以直接从那里取用。")}</p>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2.5 py-16 text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Globe className="h-5 w-5" />
                </span>
                <p className="text-sm font-medium text-foreground">{__ui("填上网址，点左边按钮开始导出")}</p>
                <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
                  {__ui("导出的是真浏览器渲染的结果：用系统自带的 Edge 渲染页面，和你在浏览器里看到的版式一致。")}</p>
              </div>
            )}
          </SectionCard>

          <SectionCard icon={<Info className="h-4 w-4" />} title={__ui("原理与限制")}>
            <ul className="space-y-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
              <li>
                {__ui("· 渲染用的是系统自带的 Microsoft Edge（找不到时用 Chrome）的\"无头模式\"， 也就是把浏览器静默地在后台跑一遍，再截图 / 打印成 PDF —— 这和商业工具的做法是一样的。")}</li>
              <li>{__ui("· 因此：")}<b className="text-foreground">{__ui("需要本机能打开这个网页")}</b>{__ui("。打不开的站（要登录、要代理的）这里同样打不开。")}</li>
              <li>{__ui("· 有些网站的图片是滚动时才加载的，截图可能缺图 —— 把「等待加载」调大一些会好很多。")}</li>
              <li>{__ui("· 导出会临时启动一个后台浏览器进程，结束后会自动关闭；不影响你正在用的浏览器。")}</li>
            </ul>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
