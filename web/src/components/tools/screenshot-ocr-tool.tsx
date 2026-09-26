"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/screenshot-ocr-tool.tsx");

import { useCaptureAction, type CaptureAction } from "@/lib/capture-actions";
import { useEffect, useRef, useState } from "react";
import { Copy, Download, Loader2, ScanText, Scissors, MonitorUp, Timer } from "lucide-react";
import { Button, Select } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useTheme } from "@/components/theme-provider";
import { desktopBridge } from "@/bridge";
import { checkAbort, imageBlob, recognizeScreenshot, type OcrFormat } from "@/lib/screenshot-ocr";
import { EmptyDropzone } from "@/components/tools/dropzone-empty";
import { consumePendingFiles } from "@/lib/file-handoff";

export function ScreenshotOcrTool() {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  const { toast } = useToast();
  const [imageUrl, setImageUrl] = useState("");
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState<"capture" | "ocr" | null>(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [delay, setDelay] = useState(0);
  const [format, setFormat] = useState<OcrFormat>("txt");
  const [resultFormat, setResultFormat] = useState<OcrFormat>("txt");
  const [strictness, setStrictness] = useState("standard");
  const inputVersion = useRef(0);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => { operation.current?.abort(); ++inputVersion.current; }, []);
  const loadFiles = async (files: File[]) => {
    const file = files[0]; if (!file) return;
    const version = ++inputVersion.current;
    operation.current?.abort(); operation.current = null; setBusy(null); setError("");
    if (file.size > 50 * 1024 * 1024) { setError("图片请控制在50 MiB以内"); return; }
    try {
      const dataUrl = await new Promise<string>((resolve,reject) => { const reader = new FileReader(); reader.onload=()=>resolve(String(reader.result)); reader.onerror=()=>reject(new Error("读取图片失败")); reader.readAsDataURL(file); });
      const image = new Image(); image.src = dataUrl; await image.decode();
      if (version !== inputVersion.current) return;
      setImageUrl(dataUrl); setSize({w:image.naturalWidth,h:image.naturalHeight}); setText(""); setStatus("图片已载入，点击识别文字");
    } catch (e) { if (version === inputVersion.current) setError(`图片无法载入：${String(e)}`); }
  };
  useEffect(() => {
    const inject = (e:Event) => { void loadFiles((e as CustomEvent<File[]>).detail || []); };
    const pending = consumePendingFiles(); if (pending?.length) void loadFiles(pending);
    window.addEventListener("furinakit:inject-files",inject);
    return () => window.removeEventListener("furinakit:inject-files",inject);
  }, []);
  const run = async (capture: boolean, supplied?: CaptureAction) => {
    if (operation.current) return;
    const ctrl = new AbortController(); operation.current = ctrl;
    setError("");
    try {
      let source = supplied?.dataUrl || imageUrl;
      if(supplied){setImageUrl(source);setSize({w:supplied.width,h:supplied.height});setText("");}
      if (capture) {
        setBusy("capture"); setStatus(delay ? `${delay} 秒后进入桌面框选；Esc 可取消` : "请在桌面拖动框选，再按 Enter 或点击完成");
        const result = await desktopBridge().captureRegion(delay * 1000);
        checkAbort(ctrl.signal);
        if (result.cancelled) { setStatus("已取消截图，原图和原结果已保留"); return; }
        if (!result.success || !result.dataUrl) throw new Error(result.error || "区域截图未返回图片");
        source = result.dataUrl; setImageUrl(source); setSize({ w: result.width!, h: result.height! }); setText("");
      }
      if (!source) throw new Error("请先上传图片或框选截图");
      setBusy("ocr"); setStatus("正在识别确认区域内的文字…");
      const result = await recognizeScreenshot(imageBlob(source), format, ctrl.signal, setStatus, strictness);
      checkAbort(ctrl.signal);
      setText(result.content); setResultFormat(format);
      setStatus(result.plainText.trim() ? `${result.message || "识别完成"} · 本机识别` : "没有识别到文字，请扩大选区或提高原文显示字号后重试");
    } catch (e) {
      if (!ctrl.signal.aborted) { setError(e instanceof Error ? e.message : String(e)); setStatus(""); }
    } finally {
      if (!ctrl.signal.aborted) setBusy(null);
      if (operation.current === ctrl) operation.current = null;
    }
  };
  useCaptureAction("screenshot-ocr", shot => run(false,shot));
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); toast({ title: "已复制文字", variant: "success" }); }
    catch { toast({ title: "复制失败，请选择结果文字后手动复制", variant: "error" }); }
  };
  const save = () => {
    const mime = resultFormat === "json" ? "application/json" : "text/plain";
    const url = URL.createObjectURL(new Blob([text], { type: `${mime};charset=utf-8` }));
    const a = document.createElement("a"); a.href = url; a.download = `图片取字-${Date.now()}.${resultFormat}`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  };
  const card = { borderColor: colors.borderSolid, background: colors.card };
  return <div className="flex flex-col gap-4" onPaste={e => { const files = Array.from(e.clipboardData.files).filter(f=>f.type.startsWith("image/")); if (files.length) {e.preventDefault();void loadFiles(files);} }}>
    <EmptyDropzone title={imageUrl ? __ui("重新输入图片：点击选择或拖入") : __ui("上传图片、拖入或粘贴，也可以直接截图")} subtitle={__ui("本机识别 · 与截图取字使用同一流程")} hint="PNG / JPG / WEBP / BMP" accept="image/*" onFiles={files => void loadFiles(files)} />
    <section className="rounded-2xl border p-4" style={card}>
      <div className="flex flex-wrap items-center gap-2.5">
        <Button className="gap-2" onClick={() => void run(true)} disabled={busy !== null}>
          {busy === "capture" ? <Loader2 size={14} className="animate-spin" /> : <MonitorUp size={14} />}
          {busy === "capture" ? __ui("等待桌面框选…") : imageUrl ? __ui("重新框选并取字") : __ui("框选截图并取字")}
        </Button>
        <Button variant="outline" className="gap-1.5" onClick={() => void run(false)} disabled={busy !== null || !imageUrl}>
          {busy === "ocr" ? <Loader2 size={14} className="animate-spin" /> : <ScanText size={14} />} {__ui("识别文字")}</Button>
        <label className="flex shrink-0 items-center gap-2 whitespace-nowrap text-xs text-muted-foreground">{__ui("输出格式")}<Select aria-label={__ui("输出格式")} value={format} onChange={(e) => setFormat(e.target.value as OcrFormat)} disabled={busy !== null} className="w-36 [&>button]:h-10 [&>button]:rounded-lg [&>button]:px-3 [&>button]:text-xs">
            <option value="txt">{__ui("纯文本 TXT")}</option><option value="md">{__ui("保留段落 Markdown")}</option><option value="json">{__ui("坐标与置信度 JSON")}</option>
          </Select>
        </label>
        <Select aria-label={__ui("识别严格度")} value={strictness} onChange={e=>setStrictness(e.target.value)} disabled={busy!==null}><option value="standard">{__ui("标准识别")}</option><option value="strict">{__ui("严格识别")}</option></Select>
        <div className="flex items-center gap-1.5 rounded-lg border border-border/60 px-2 py-1">
          <Timer size={13} className="text-muted-foreground" /><span className="text-xs text-muted-foreground">{__ui("延时")}</span>
          {[0, 3, 5].map((seconds) => <button key={seconds} type="button" disabled={busy !== null} onClick={() => setDelay(seconds)} className={`rounded-md px-2 py-1 text-xs ${delay === seconds ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"}`}>{seconds === 0 ? __ui("立即") : __msg("{0} 秒", seconds)}</button>)}
        </div>
      </div>
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{__ui("在桌面直接框选 → 可拖动选区与边角调整 → Enter 确认并取字。Esc / 右键取消，不会默认识别整屏。")}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{__ui("截图与 OCR 均在本机完成；保持原始像素，不用在缩小的整屏预览里再次框选。")}</p>
      {status && <p role="status" className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">{busy && <Loader2 size={13} className="animate-spin" />}{__msg(status)}</p>}
      {error && <p role="alert" className="mt-3 rounded-lg bg-destructive/10 p-3 text-xs text-destructive">{__msg(error)}</p>}
    </section>
    {imageUrl ? <div className="grid items-start gap-4 xl:grid-cols-2">
      <section className="min-w-0 rounded-2xl border p-4" style={card}>
        <header className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs"><span className="font-medium">{__ui("已确认的截图区域")}</span><span className="text-muted-foreground">{size?.w} × {size?.h} {__ui("像素 · 原始分辨率")}</span></header>
        <div className="max-h-[55vh] overflow-auto rounded-xl bg-muted/20"><img src={imageUrl} alt={__ui("已确认区域，只有这部分送入识别")} className="mx-auto h-auto max-w-full" /></div>
        <p className="mt-3 text-[11px] text-muted-foreground">{__ui("如需更换区域，使用上方“重新框选并取字”；取消会保留当前结果。")}</p>
      </section>
      <section className="min-w-0 rounded-2xl border p-4" style={card}>
        <header className="mb-3 flex items-center justify-between gap-2"><h2 className="text-sm font-semibold">{__ui("识别结果")}</h2><div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => void copy()} disabled={!text || busy !== null}><Copy size={12} /> {__ui("复制")}</Button>
          <Button size="sm" variant="outline" onClick={save} disabled={!text || busy !== null}><Download size={12} /> {__ui("保存 .")}{resultFormat}</Button>
        </div></header>
        <textarea aria-label={__ui("识别结果")} value={text} disabled={busy !== null} onChange={(e) => setText(e.target.value)} placeholder={busy ? __ui("正在识别选区…") : __ui("识别结果可直接编辑；小字、复杂背景请核对后使用")} className="thin-scroll h-80 w-full resize-y rounded-xl border p-3.5 text-[13px] leading-7 focus:outline-none" style={{ borderColor: colors.borderSolid, background: colors.bg, color: colors.text }} />
      </section>
    </div> : <section className="flex flex-col items-center gap-3 rounded-2xl border border-dashed p-12 text-center" style={card}>
      <Scissors size={28} className="text-primary" /><h2 className="text-sm font-medium">{__ui("只取需要的区域，不必截下整个桌面")}</h2><p className="max-w-lg text-xs leading-6 text-muted-foreground">{__ui("点击“框选截图并取字”，工具箱和悬浮球会暂时隐藏。框选你想识别的文字，确认后回到这里查看、编辑或导出。")}</p>
    </section>}
  </div>;
}
