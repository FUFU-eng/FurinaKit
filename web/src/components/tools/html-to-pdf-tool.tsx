import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/html-to-pdf-tool.tsx");

/**
 * HTML 转 PDF / 图片
 *
 * 两种做法：
 *   1. 提取图片合成（默认）：把 HTML 里**内嵌的原图**一张张取出来（data: 图片、网络图片），
 *      跳过缩略图 / 小图标、自动去重，再按网页里的顺序合成 PDF（每页一张、页面=原图大小），
 *      或打包成图片 ZIP。画质与原图一致，不是截图。
 *      典型场景：「图片转 HTML」生成的相册页，想变回 PDF / 图片。
 *   2. 按网页原样导出：交给后端用系统自带的 Edge 无头模式渲染（和「网页转图片 / PDF」同一套），
 *      适合以文字排版为主的普通网页。
 *
 * 全程在本机处理：解析用 DOMParser（不执行网页里的脚本），合成用 pdf-lib / JSZip。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CheckSquare,
  ExternalLink,
  FileArchive,
  FileImage,
  FileText,
  FolderOpen,
  Globe,
  Image as ImageIcon,
  Info,
  Loader2,
  Monitor,
  RefreshCw,
  Square,
  Upload,
} from "lucide-react";
import { Badge, Button, Input, Label, Select } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { isDesktopOutput, openOutputDirectory, reportOutputError, reportOutputSaved, saveOutputBlob } from "@/lib/output-directory";

// ── 提取 ──────────────────────────────────────────────────────────────

/** 「点开看大图」常见的原图属性，按优先级排列；找到就不再要它里面的缩略图。 */
const FULL_ATTRS = [
  "data-full", "data-full-src", "data-original", "data-origin", "data-large", "data-big", "data-hd", "data-highres",
  "data-zoom", "data-zoom-src", "data-raw", "data-image", "data-src", "data-lazy-src", "data-url",
];
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|avif|svg|ico|tiff?)(\?|#|$)/i;
const SMALL_PX = 64;

type Source = { src: string };
type Item = {
  id: number;
  blob: Blob;
  mime: string;
  url: string; // 预览用 object URL
  w: number;
  h: number;
  small: boolean;
};
type Extracted = { items: Item[]; relative: number; failed: number; raw: number };

function isDataImage(s: string) {
  return /^data:image\//i.test(s);
}
function isRemote(s: string) {
  return /^https?:\/\//i.test(s);
}
/** 属性值像不像一张图片：data 图片 / 网络地址 / 带图片后缀的相对路径。 */
function looksLikeImage(v: string) {
  const s = v.trim();
  if (!s) return false;
  if (isDataImage(s)) return true;
  if (/^(javascript:|blob:|#|mailto:)/i.test(s)) return false;
  return IMAGE_EXT.test(s) || (isRemote(s) && !/\.(html?|php|aspx?)(\?|#|$)/i.test(s));
}
/** srcset 里挑最大的那张。
 * 注意 data: 地址本身带逗号（"base64,"），不能简单按逗号切：地址是一段不含空白的字符，后面跟描述符（2x / 800w）。 */
export function bestFromSrcset(srcset: string | null): string | null {
  if (!srcset) return null;
  let best: string | null = null;
  let bestScore = -1;
  let i = 0;
  const s = srcset;
  while (i < s.length) {
    while (i < s.length && /[\s,]/.test(s[i])) i++;
    if (i >= s.length) break;
    let j = i;
    while (j < s.length && !/\s/.test(s[j])) j++;
    let url = s.slice(i, j);
    let desc = "";
    if (url.endsWith(",")) {
      url = url.replace(/,+$/, "");
    } else {
      let k = j;
      while (k < s.length && s[k] !== ",") k++;
      desc = s.slice(j, k).trim();
      j = k;
    }
    i = j;
    if (!url) continue;
    const n = desc ? parseFloat(desc) : 1;
    const score = Number.isFinite(n) ? n : 1;
    if (score > bestScore) {
      best = url;
      bestScore = score;
    }
  }
  return best;
}

/** 按网页里出现的顺序收集图片地址（去重），并数出读不到的相对路径。 */
export function collectImageSources(html: string): { sources: Source[]; relative: number } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const seen = new Set<string>();
  const relSeen = new Set<string>();
  const sources: Source[] = [];
  const covered = new Set<Element>();

  const add = (raw: string | null | undefined) => {
    const s = (raw || "").trim();
    if (!s || /^(javascript:|blob:|#|about:)/i.test(s)) return;
    if (!isDataImage(s) && !isRemote(s)) {
      if (s.startsWith("//")) return add("https:" + s);
      if (IMAGE_EXT.test(s) || /^file:/i.test(s)) relSeen.add(s);
      return;
    }
    if (seen.has(s)) return;
    seen.add(s);
    sources.push({ src: s });
  };
  const cover = (el: Element) => el.querySelectorAll("img, source, image").forEach((c) => covered.add(c));

  const root = doc.body ?? doc.documentElement;
  for (const el of Array.from(root.querySelectorAll("*"))) {
    if (covered.has(el)) continue;
    const tag = el.tagName.toLowerCase();
    if (tag === "script" || tag === "style" || tag === "template" || tag === "noscript") continue;

    // 1) 原图属性（相册常见：<div data-full="原图"><img src="缩略图"></div>）
    const full = FULL_ATTRS.map((a) => el.getAttribute(a)).find((v) => v && looksLikeImage(v));
    if (full) {
      add(full);
      cover(el);
      continue;
    }
    // 2) <a href="原图"><img src="缩略图"></a>
    if (tag === "a") {
      const href = el.getAttribute("href");
      if (href && looksLikeImage(href) && el.querySelector("img")) {
        add(href);
        cover(el);
        continue;
      }
    }
    // 3) 普通图片
    if (tag === "img") {
      add(bestFromSrcset(el.getAttribute("srcset")) || el.getAttribute("src"));
      continue;
    }
    if (tag === "source") {
      const best = bestFromSrcset(el.getAttribute("srcset")) || el.getAttribute("src");
      if (best && looksLikeImage(best)) add(best);
      continue;
    }
    if (tag === "image") {
      add(el.getAttribute("href") || el.getAttribute("xlink:href"));
      continue;
    }
    // 4) 行内样式背景图
    const style = el.getAttribute("style");
    if (style && /url\(/i.test(style)) {
      for (const m of style.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi)) add(m[2]);
    }
  }
  return { sources, relative: relSeen.size };
}

function sniffMime(bytes: Uint8Array, declared: string): string {
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return "image/gif";
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45) return "image/webp";
  if (b[0] === 0x42 && b[1] === 0x4d) return "image/bmp";
  const head = new TextDecoder().decode(b.slice(0, 256)).trimStart().toLowerCase();
  if (head.startsWith("<svg") || (head.startsWith("<?xml") && head.includes("<svg"))) return "image/svg+xml";
  return declared || "application/octet-stream";
}

function dataUriToBlob(uri: string): Blob {
  const comma = uri.indexOf(",");
  if (comma < 0) throw new Error("bad data uri");
  const meta = uri.slice(5, comma);
  const payload = uri.slice(comma + 1);
  const declared = (meta.split(";")[0] || "").toLowerCase();
  let bytes: Uint8Array;
  if (/;base64/i.test(meta)) {
    const bin = atob(payload.replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/"));
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } else {
    bytes = new TextEncoder().encode(decodeURIComponent(payload));
  }
  return new Blob([bytes as BlobPart], { type: sniffMime(bytes, declared) });
}

async function sourceToBlob(src: string): Promise<Blob> {
  if (isDataImage(src)) return dataUriToBlob(src);
  const res = await fetch(src);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const raw = await res.blob();
  const bytes = new Uint8Array(await raw.slice(0, 512).arrayBuffer());
  return new Blob([raw], { type: sniffMime(bytes, raw.type) });
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("图片无法解码"));
    img.src = url;
  });
}

// ── 合成 ──────────────────────────────────────────────────────────────

/** JPEG 的 EXIF 方向（1 = 正常）。手机照片常带这个标记，直接塞进 PDF 会横过来。 */
function jpegOrientation(bytes: Uint8Array): number {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return 1;
  let off = 2;
  while (off + 4 < v.byteLength) {
    const marker = v.getUint16(off);
    const len = v.getUint16(off + 2);
    if (marker === 0xffe1 && off + 10 < v.byteLength && v.getUint32(off + 4) === 0x45786966) {
      const t = off + 10;
      const little = v.getUint16(t) === 0x4949;
      const ifd = t + v.getUint32(t + 4, little);
      if (ifd + 2 > v.byteLength) return 1;
      const count = v.getUint16(ifd, little);
      for (let i = 0; i < count; i++) {
        const e = ifd + 2 + i * 12;
        if (e + 10 > v.byteLength) return 1;
        if (v.getUint16(e, little) === 0x0112) return v.getUint16(e + 8, little) || 1;
      }
      return 1;
    }
    if ((marker & 0xff00) !== 0xff00 || marker === 0xffda) return 1;
    off += 2 + len;
  }
  return 1;
}

async function canvasEncode(item: Item, type: "image/png" | "image/jpeg"): Promise<Uint8Array> {
  const img = await loadImage(item.url);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || item.w;
  canvas.height = img.naturalHeight || item.h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("画布不可用");
  if (type === "image/jpeg") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, type, 0.95));
  if (!blob) throw new Error("图片转换失败");
  return new Uint8Array(await blob.arrayBuffer());
}

const PX_TO_PT = 0.75; // 1 CSS 像素 = 0.75 磅：PDF 按 100% 打开时和网页里一样大
const MAX_PT = 14400; // PDF 单页最大边长

async function buildPdf(items: Item[], title: string, onStep: (i: number) => void): Promise<Blob> {
  const { PDFDocument } = await import("pdf-lib");
  const pdf = await PDFDocument.create();
  pdf.setTitle(title);
  pdf.setCreator("FurinaKit");
  pdf.setProducer("FurinaKit · HTML 转 PDF");
  for (let i = 0; i < items.length; i++) {
    onStep(i + 1);
    const it = items[i];
    const bytes = new Uint8Array(await it.blob.arrayBuffer());
    let embedded;
    if (it.mime === "image/jpeg") {
      embedded = jpegOrientation(bytes) > 1
        ? await pdf.embedJpg(await canvasEncode(it, "image/jpeg"))
        : await pdf.embedJpg(bytes).catch(async () => pdf.embedJpg(await canvasEncode(it, "image/jpeg")));
    } else if (it.mime === "image/png") {
      embedded = await pdf.embedPng(bytes).catch(async () => pdf.embedPng(await canvasEncode(it, "image/png")));
    } else {
      embedded = await pdf.embedPng(await canvasEncode(it, "image/png"));
    }
    let w = it.w * PX_TO_PT;
    let h = it.h * PX_TO_PT;
    const k = Math.min(1, MAX_PT / Math.max(w, h));
    w = Math.max(1, w * k);
    h = Math.max(1, h * k);
    const page = pdf.addPage([w, h]);
    page.drawImage(embedded, { x: 0, y: 0, width: w, height: h });
    await new Promise((r) => setTimeout(r, 0)); // 让界面有机会刷新进度
  }
  const out = await pdf.save();
  return new Blob([out as BlobPart], { type: "application/pdf" });
}

const EXT: Record<string, string> = {
  "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp", "image/bmp": "bmp",
  "image/svg+xml": "svg", "image/avif": "avif", "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico", "image/tiff": "tif",
};
const extOf = (mime: string) => EXT[mime] || "img";

async function buildZip(items: Item[], base: string): Promise<Blob> {
  const JSZip = (await import("jszip")).default;
  const zip = new JSZip();
  const pad = String(items.length).length < 3 ? 3 : String(items.length).length;
  items.forEach((it, i) => zip.file(`${base}_${String(i + 1).padStart(pad, "0")}.${extOf(it.mime)}`, it.blob));
  return zip.generateAsync({ type: "blob", compression: "STORE" });
}

function baseName(name: string) {
  return (name.replace(/\.(html?|xhtml|htm)$/i, "").replace(/[\\/:*?"<>|]+/g, "_").trim() || "网页").slice(0, 80);
}
function humanSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

async function saveBlob(blob: Blob, filename: string): Promise<string | null> {
  if (isDesktopOutput()) {
    const path = (await saveOutputBlob(blob, filename)).replace(/^\\\\\?\\/, "");
    reportOutputSaved(path);
    return path;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
  return null;
}
function openPath(p: string) {
  const w = window as unknown as { furinakit?: { openPath?: (p: string) => Promise<void> } };
  void w.furinakit?.openPath?.(p);
}

// ── 界面 ──────────────────────────────────────────────────────────────

function Card({ icon, title, extra, children, className }: { icon?: React.ReactNode; title?: string; extra?: React.ReactNode; children: React.ReactNode; className?: string }) {
  const __locale = __useLanguage();
  return (
    <div className={cn("rounded-2xl border border-border/70 bg-card/60 p-5 shadow-sm backdrop-blur-md", className)}>
      {(title || extra) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
          <div className="flex items-center gap-2">
            {icon && <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</span>}
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
  return (
    <div className="flex items-start gap-2 rounded-xl border-l-4 border-l-destructive bg-destructive/10 px-4 py-3 text-xs text-destructive">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <span className="leading-relaxed">{__msg(message)}</span>
    </div>
  );
}

const SHOT_PRESETS = [
  { id: "laptop", name: "笔记本屏幕", w: 1366, h: 900 },
  { id: "fhd", name: "全高清", w: 1920, h: 1080 },
  { id: "phone", name: "手机竖屏", w: 414, h: 900 },
  { id: "full", name: "整页（很高）", w: 1440, h: 6000 },
];

type Mode = "extract" | "render";
type Saved = { kind: "pdf" | "zip" | "image" | "png"; path: string | null; size: number; name: string; dir?: string };

export function HtmlToPdfTool() {
  const __locale = __useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [mode, setMode] = useState<Mode>("extract");
  const [dragging, setDragging] = useState(false);

  const [extracting, setExtracting] = useState(false);
  const [data, setData] = useState<Extracted | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [skipSmall, setSkipSmall] = useState(true);

  const [busy, setBusy] = useState<null | "pdf" | "zip" | "rpdf" | "rpng">(null);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<Saved | null>(null);

  const [shotId, setShotId] = useState("full");
  const [waitMs, setWaitMs] = useState("3000");
  const [landscape, setLandscape] = useState(false);
  const [noHeader, setNoHeader] = useState(true);

  // 预览用的 object URL 要及时释放
  const urlsRef = useRef<string[]>([]);
  const releaseUrls = useCallback(() => {
    urlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    urlsRef.current = [];
  }, []);
  useEffect(() => releaseUrls, [releaseUrls]);

  const runId = useRef(0);
  const extract = useCallback(async (f: File) => {
    const my = ++runId.current;
    releaseUrls();
    setExtracting(true);
    setData(null);
    setError(null);
    setSaved(null);
    setProgress(__ui("正在读取网页…"));
    try {
      const html = await f.text();
      const { sources, relative } = collectImageSources(html);
      const items: Item[] = [];
      let failed = 0;
      for (let i = 0; i < sources.length; i++) {
        if (my !== runId.current) return;
        setProgress(`${__ui("正在提取图片")} ${i + 1} / ${sources.length}`);
        try {
          const blob = await sourceToBlob(sources[i].src);
          const url = URL.createObjectURL(blob);
          urlsRef.current.push(url);
          const img = await loadImage(url);
          const w = img.naturalWidth || 1;
          const h = img.naturalHeight || 1;
          items.push({ id: i, blob, mime: blob.type, url, w, h, small: w < SMALL_PX && h < SMALL_PX });
        } catch {
          failed++;
        }
        if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0));
      }
      if (my !== runId.current) return;
      setData({ items, relative, failed, raw: sources.length });
      setSelected(new Set(items.filter((it) => !it.small).map((it) => it.id)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "读取 HTML 失败");
    } finally {
      if (my === runId.current) {
        setExtracting(false);
        setProgress("");
      }
    }
  }, [releaseUrls]);

  const pick = (f: File | undefined | null) => {
    if (!f) return;
    if (!/\.(html?|xhtml)$/i.test(f.name) && f.type !== "text/html") {
      setError("请选择 .html / .htm 网页文件");
      return;
    }
    setFile(f);
    void extract(f);
  };

  const visible = useMemo(() => (data ? data.items.filter((it) => !(skipSmall && it.small)) : []), [data, skipSmall]);
  const chosen = useMemo(() => visible.filter((it) => selected.has(it.id)), [visible, selected]);
  const smallCount = data ? data.items.filter((it) => it.small).length : 0;
  const allOn = visible.length > 0 && chosen.length === visible.length;

  const toggle = (id: number) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAll = () => setSelected(allOn ? new Set() : new Set(visible.map((it) => it.id)));

  const exportExtract = async (kind: "pdf" | "zip") => {
    if (!file || !chosen.length) return;
    setBusy(kind);
    setError(null);
    setSaved(null);
    try {
      const base = baseName(file.name);
      let blob: Blob;
      let name: string;
      let savedKind: Saved["kind"] = kind;
      if (kind === "pdf") {
        blob = await buildPdf(chosen, base, (i) => setProgress(`${__ui("正在合成 PDF")} ${i} / ${chosen.length}`));
        name = `${base}.pdf`;
      } else if (chosen.length === 1) {
        blob = chosen[0].blob;
        name = `${base}.${extOf(chosen[0].mime)}`;
        savedKind = "image";
      } else {
        setProgress(__ui("正在打包图片…"));
        blob = await buildZip(chosen, base);
        name = `${base}_${chosen.length}张图片.zip`;
      }
      setProgress(__ui("正在保存…"));
      const path = await saveBlob(blob, name);
      // 同名文件会自动编号（xxx (1).pdf），显示实际保存的文件名
      setSaved({ kind: savedKind, path, size: blob.size, name: path ? path.split(/[\\/]/).pop() || name : name });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "导出失败";
      setError(msg);
      reportOutputError(msg);
    } finally {
      setBusy(null);
      setProgress("");
    }
  };

  const exportRender = async (kind: "pdf" | "png") => {
    if (!file) return;
    setBusy(kind === "pdf" ? "rpdf" : "rpng");
    setError(null);
    setSaved(null);
    setProgress(__ui("正在用系统自带的浏览器渲染网页，复杂页面可能要十几秒…"));
    try {
      const shot = SHOT_PRESETS.find((s) => s.id === shotId) ?? SHOT_PRESETS[0];
      const form = new FormData();
      form.append("file", file, file.name);
      form.append("waitMs", String(Number(waitMs) || 3000));
      form.append("landscape", String(landscape));
      form.append("noHeader", String(noHeader));
      form.append("width", String(shot.w));
      form.append("height", String(shot.h));
      const res = await fetch(kind === "pdf" ? "/api/webcap/pdf" : "/api/webcap/image", { method: "POST", body: form });
      const d = await res.json();
      if (!d.success) throw new Error(d.error || "导出失败");
      setSaved({ kind, path: d.path, size: d.size || 0, name: String(d.path || "").split(/[\\/]/).pop() || "", dir: d.dir });
    } catch (e) {
      setError(e instanceof Error ? e.message : "导出失败");
    } finally {
      setBusy(null);
      setProgress("");
    }
  };

  const reset = () => {
    runId.current++;
    releaseUrls();
    setFile(null);
    setData(null);
    setSaved(null);
    setError(null);
    setExtracting(false);
    if (inputRef.current) inputRef.current.value = "";
  };

  const working = busy !== null || extracting;

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        {/* ── 左：文件与设置 ── */}
        <div className="thin-scroll space-y-4 lg:col-span-4">
          <Card icon={<Upload className="h-4 w-4" />} title="选择 HTML 文件" extra={file ? (
            <Button type="button" variant="outline" size="sm" onClick={reset} disabled={busy !== null}>
              <RefreshCw className="h-3.5 w-3.5" /> {__ui("换一个")}</Button>
          ) : null}>
            <input ref={inputRef} type="file" accept=".html,.htm,.xhtml,text/html" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
            {file ? (
              <div className="rounded-xl border border-border/60 bg-background/50 px-3.5 py-3">
                <div className="flex items-center gap-2 text-[13px] font-medium text-foreground">
                  <Globe className="h-4 w-4 shrink-0 text-primary" />
                  <span className="truncate" title={file.name}>{file.name}</span>
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">{humanSize(file.size)}</div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => { e.preventDefault(); setDragging(false); pick(e.dataTransfer.files?.[0]); }}
                className={cn(
                  "flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-4 py-9 text-center transition-colors",
                  dragging ? "border-primary bg-primary/5" : "border-border/70 hover:border-primary/60 hover:bg-primary/[0.03]",
                )}
              >
                <FileImage className="h-7 w-7 text-primary" />
                <span className="text-[13px] font-medium text-foreground">{__ui("点击选择，或把 .html 文件拖到这里")}</span>
                <span className="text-[11px] text-muted-foreground">{__ui("一次处理一个网页文件，几十 MB 也没问题")}</span>
              </button>
            )}
          </Card>

          <Card icon={<FileText className="h-4 w-4" />} title="转换方式">
            <div className="grid grid-cols-2 gap-1.5 rounded-xl bg-muted/50 p-1">
              {([
                ["extract", "提取图片合成"],
                ["render", "按网页原样导出"],
              ] as [Mode, string][]).map(([m, label]) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => { setMode(m); setSaved(null); setError(null); }}
                  className={cn(
                    "rounded-lg px-2 py-1.5 text-[12px] font-medium transition-colors",
                    mode === m ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {__msg(label)}
                </button>
              ))}
            </div>

            {mode === "extract" ? (
              <div className="mt-3 space-y-3">
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {__ui("把网页里内嵌的原图一张张取出来（自动跳过缩略图、去重），按网页里的顺序合成 PDF，或打包成图片。画质与原图一致，适合「图片转 HTML」生成的相册页。")}</p>
                <label className="flex items-center gap-2 text-[12px] text-foreground">
                  <input type="checkbox" checked={skipSmall} onChange={(e) => setSkipSmall(e.target.checked)} className="accent-primary" />
                  {__ui("跳过小图标（宽高都小于 64 像素）")}{smallCount > 0 && <span className="text-muted-foreground">（{smallCount}）</span>}
                </label>
                <p className="text-[11px] text-muted-foreground">{__ui("PDF 每页一张图，页面大小就是原图大小，没有白边。")}</p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button type="button" className="flex-1 gap-1.5" onClick={() => void exportExtract("pdf")} disabled={working || !chosen.length}>
                    {busy === "pdf" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                    {__ui("合成 PDF")}</Button>
                  <Button type="button" variant="outline" className="flex-1 gap-1.5" onClick={() => void exportExtract("zip")} disabled={working || !chosen.length}>
                    {busy === "zip" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileArchive className="h-3.5 w-3.5" />}
                    {chosen.length === 1 ? __ui("导出图片") : __ui("导出图片（ZIP）")}</Button>
                </div>
                {file && data && <p className="text-[11px] text-muted-foreground">{__ui("已选")} {chosen.length} / {visible.length} {__ui("张")}</p>}
              </div>
            ) : (
              <div className="mt-3 space-y-3">
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  {__ui("像浏览器「打印成 PDF」一样，把网页按原来的排版整页导出。适合以文字、表格为主的网页。")}</p>
                <div className="space-y-1.5">
                  <Label htmlFor="h2p-size">{__ui("截图尺寸（导出 PNG 用）")}</Label>
                  <Select id="h2p-size" value={shotId} onChange={(e) => setShotId(e.target.value)} className="w-full text-xs">
                    {SHOT_PRESETS.map((s) => (
                      <option key={s.id} value={s.id}>{__msg(s.name)}（{s.w} × {s.h}）</option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="h2p-wait">{__ui("等待加载（毫秒）")}</Label>
                  <Input id="h2p-wait" type="number" value={waitMs} onChange={(e) => setWaitMs(e.target.value)} className="text-xs" />
                </div>
                <label className="flex items-center gap-2 text-[12px] text-foreground">
                  <input type="checkbox" checked={landscape} onChange={(e) => setLandscape(e.target.checked)} className="accent-primary" />
                  {__ui("PDF 横向（默认竖向）")}</label>
                <label className="flex items-center gap-2 text-[12px] text-foreground">
                  <input type="checkbox" checked={noHeader} onChange={(e) => setNoHeader(e.target.checked)} className="accent-primary" />
                  {__ui("去掉页眉页脚（文件名与页码）")}</label>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button type="button" className="flex-1 gap-1.5" onClick={() => void exportRender("pdf")} disabled={working || !file}>
                    {busy === "rpdf" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileText className="h-3.5 w-3.5" />}
                    {__ui("导出 PDF")}</Button>
                  <Button type="button" variant="outline" className="flex-1 gap-1.5" onClick={() => void exportRender("png")} disabled={working || !file}>
                    {busy === "rpng" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
                    {__ui("导出长截图（PNG）")}</Button>
                </div>
              </div>
            )}
            {progress && (
              <p className="mt-3 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> {progress}
              </p>
            )}
            {error && <div className="mt-3"><ErrorBar message={error} /></div>}
          </Card>
        </div>

        {/* ── 右：结果 / 预览 ── */}
        <div className="thin-scroll space-y-4 lg:col-span-8">
          {saved && (
            <div className="rounded-2xl border border-emerald-500/40 bg-emerald-500/[0.07] px-5 py-4">
              <div className="flex items-center gap-2 text-[13px] font-semibold text-foreground">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                {__ui("已导出")} {saved.name}（{humanSize(saved.size)}）
              </div>
              {saved.path && <div className="mt-1.5 break-all font-mono text-[11.5px] text-muted-foreground">{saved.path}</div>}
              {saved.path && (
                <div className="mt-3 flex flex-wrap gap-2">
                  <Button type="button" size="sm" className="gap-1.5" onClick={() => openPath(saved.path!)}>
                    <ExternalLink className="h-3.5 w-3.5" /> {__ui("打开文件")}</Button>
                  <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => (saved.dir ? openPath(saved.dir) : void openOutputDirectory().catch(reportOutputError))}>
                    <FolderOpen className="h-3.5 w-3.5" /> {__ui("打开所在文件夹")}</Button>
                </div>
              )}
            </div>
          )}

          {mode === "extract" ? (
            <Card
              icon={<ImageIcon className="h-4 w-4" />}
              title="网页里的图片"
              extra={visible.length ? (
                <div className="flex items-center gap-2">
                  <Badge variant="secondary">{__ui("共")} {visible.length} {__ui("张")}</Badge>
                  <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={toggleAll} disabled={busy !== null}>
                    {allOn ? <Square className="h-3.5 w-3.5" /> : <CheckSquare className="h-3.5 w-3.5" />}
                    {allOn ? __ui("全不选") : __ui("全选")}</Button>
                </div>
              ) : null}
            >
              {extracting ? (
                <div className="flex flex-col items-center justify-center gap-2 py-16 text-sm text-muted-foreground">
                  <Loader2 className="h-6 w-6 animate-spin text-primary" /> {progress || __ui("正在提取…")}
                </div>
              ) : !file ? (
                <div className="flex flex-col items-center justify-center gap-2.5 py-16 text-center">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><FileImage className="h-5 w-5" /></span>
                  <p className="text-sm font-medium text-foreground">{__ui("选好 HTML 文件后，这里会列出里面的所有图片")}</p>
                  <p className="max-w-md text-xs leading-relaxed text-muted-foreground">{__ui("点图片可以取消/勾选，只把勾选的按顺序合成。")}</p>
                </div>
              ) : visible.length === 0 ? (
                <div className="space-y-2 py-10 text-center">
                  <p className="text-sm font-medium text-foreground">{__ui("这个网页里没有找到可提取的图片")}</p>
                  <p className="mx-auto max-w-md text-xs leading-relaxed text-muted-foreground">
                    {data && data.relative > 0
                      ? __ui("网页里的图片是单独存放的文件（相对路径），只选了网页本身读不到它们。可以改用「按网页原样导出」，或把图片和网页放在一起后用「图片转 PDF」。")
                      : __ui("如果它是以文字为主的普通网页，请切换到「按网页原样导出」。")}
                  </p>
                  <Button type="button" variant="outline" size="sm" onClick={() => setMode("render")}>{__ui("切换到按网页原样导出")}</Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {(data?.failed || data?.relative) ? (
                    <p className="rounded-lg bg-amber-500/10 px-3 py-2 text-[11.5px] leading-relaxed text-amber-700 dark:text-amber-300">
                      {data?.failed ? <>{__ui("有")} {data.failed} {__ui("张图片读取失败（可能是网络图片打不开），已跳过。")}</> : null}
                      {data?.relative ? <>{__ui("另有")} {data.relative} {__ui("张图片是单独存放的文件（相对路径），只选网页读不到，已跳过。")}</> : null}
                    </p>
                  ) : null}
                  <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 xl:grid-cols-5">
                    {visible.map((it, idx) => {
                      const on = selected.has(it.id);
                      const order = on ? chosen.indexOf(it) + 1 : 0;
                      return (
                        <button
                          key={it.id}
                          type="button"
                          onClick={() => toggle(it.id)}
                          disabled={busy !== null}
                          title={`${it.w} × ${it.h} · ${extOf(it.mime).toUpperCase()} · ${humanSize(it.blob.size)}`}
                          className={cn(
                            "group relative overflow-hidden rounded-xl border-2 bg-muted/40 text-left transition-all",
                            on ? "border-primary shadow-sm" : "border-transparent opacity-45 hover:opacity-80",
                          )}
                        >
                          <img src={it.url} alt={`#${idx + 1}`} loading="lazy" className="aspect-square w-full object-cover" />
                          <span className={cn(
                            "absolute left-1.5 top-1.5 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full px-1 text-[10.5px] font-semibold",
                            on ? "bg-primary text-primary-foreground" : "bg-background/80 text-muted-foreground",
                          )}>{on ? order : "—"}</span>
                          <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/65 to-transparent px-1.5 pb-1 pt-4 text-[10px] text-white">
                            {it.w}×{it.h}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </Card>
          ) : (
            !saved && (
              <Card icon={<Monitor className="h-4 w-4" />} title="按网页原样导出">
                <div className="flex flex-col items-center justify-center gap-2.5 py-14 text-center">
                  <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary"><Globe className="h-5 w-5" /></span>
                  <p className="text-sm font-medium text-foreground">{file ? __ui("点左边按钮开始导出") : __ui("先在左边选择 HTML 文件")}</p>
                  <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
                    {__ui("用系统自带的 Edge 在后台把网页渲染一遍再打印成 PDF / 截图，版式和浏览器里看到的一致。文件保存在「下载」文件夹下的 FurinaKit网页导出。")}</p>
                </div>
              </Card>
            )
          )}

          <Card icon={<Info className="h-4 w-4" />} title="说明">
            <ul className="space-y-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
              <li>{__ui("· 「提取图片合成」拿到的是网页里存的原图，不是截图，所以清晰度和原图一样；网页里同一张图的缩略图会自动跳过。")}</li>
              <li>{__ui("· 最适合单文件网页（图片已内嵌在 HTML 里，比如「图片转 HTML」生成的文件）。图片和网页分开存放的，只选网页读不到那些图片。")}</li>
              <li>{__ui("· 网页里的脚本不会被运行，只读取内容，安全放心。")}</li>
              <li>{__ui("· 「按网页原样导出」需要本机装有 Edge 或 Chrome（Windows 自带 Edge）。")}</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default HtmlToPdfTool;
