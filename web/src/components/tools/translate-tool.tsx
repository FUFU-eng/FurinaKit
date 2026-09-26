"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/translate-tool.tsx");


/**
 * 截图翻译。
 *
 * 三条路子，覆盖日常用法：
 *   ① 截屏 → 自动识别文字 → 翻译（截图取字那套 OCR 直接复用项目已有的 OCR 任务）；
 *   ② 选一张现成的图片 → 仅载入，点击识别/翻译才处理；
 *   ③ 直接粘贴文字 → 只翻译（不经过 OCR）。
 *
 * 翻译用两个免密钥、国内可直连的公开接口（腾讯首选、有道备用，见 src-tauri/src/translate.rs），
 * 用户装上就能用，不需要作者去申请密钥。
 *
 * 布局：**模式 B（5:7）** —— 左边是来源与语言设置，右边上下分别是原文与译文。
 */

import { useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowRightLeft,
  Camera,
  Copy,
  Eraser,
  Image as ImageIcon,
  Languages,
  Loader2,
  ScanText,
  Sparkles,
  Upload,
} from "lucide-react";
import { Badge, Button, Input, Label, Select } from "@/components/ui/primitives";
import { useToolDraft } from "@/lib/use-tool-draft";
import { useCaptureAction } from "@/lib/capture-actions";
import { desktopBridge } from "@/bridge";
import { checkAbort, imageBlob, recognizeScreenshot, splitTranslationParagraphs } from "@/lib/screenshot-ocr";
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

const LANGS = [
  { id: "auto", name: "自动识别" },
  { id: "zh", name: "中文" },
  { id: "en", name: "英语" },
  { id: "ja", name: "日语" },
  { id: "ko", name: "韩语" },
  { id: "fr", name: "法语" },
  { id: "de", name: "德语" },
  { id: "ru", name: "俄语" },
  { id: "es", name: "西班牙语" },
];

const SAMPLE = `The quick brown fox jumps over the lazy dog.
Good tools should be fast, quiet, and never phone home.`;

export function ScreenshotTranslateTool() {
  const __locale = __useLanguage();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [sourceText, setSourceText] = useState("");
  const [result, setResult] = useState<{ provider: string; translations: string[] } | null>(null);
  const [busy, setBusy] = useState<null | "capture" | "ocr" | "translate">(null);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useToolDraft("screenshot-translate", "from", "auto");
  const [to, setTo] = useToolDraft("screenshot-translate", "to", "zh");
  const [delay, setDelay] = useToolDraft("screenshot-translate", "delay", "0");
  const fileRef = useRef<HTMLInputElement>(null);
  const image = useRef<Blob | null>(null);
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  useEffect(() => () => { if (imageUrl?.startsWith("blob:")) URL.revokeObjectURL(imageUrl); }, [imageUrl]);

  const perform = async (task: (signal: AbortSignal) => Promise<void>) => {
    if (operation.current) return;
    const ctrl = new AbortController(); operation.current = ctrl; setError(null);
    try { await task(ctrl.signal); }
    catch (e) { if (!ctrl.signal.aborted) { setError(e instanceof Error ? e.message : String(e)); setStatus(""); } }
    finally { if (!ctrl.signal.aborted) setBusy(null); if (operation.current === ctrl) operation.current = null; }
  };
  const translateText = async (texts: string[], signal: AbortSignal) => {
    const clean = texts.map((t) => t.trim()).filter(Boolean);
    if (!clean.length) throw new Error("没有要翻译的内容");
    setBusy("translate"); setResult(null); setStatus("正在翻译识别原文…");
    const response = await fetch("/api/translate", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ texts: clean, from, to }), signal,
    });
    const data = await response.json(); checkAbort(signal);
    if (!response.ok || !data.success) throw new Error(data.error || `翻译失败（HTTP ${response.status}）`);
    if (!Array.isArray(data.translations) || data.translations.length !== clean.length || data.translations.some((t: unknown) => typeof t !== "string" || !t.trim())) throw new Error("翻译服务返回的段落不完整，请重试；不会把空译文显示为成功");
    setResult({ provider: String(data.provider || "翻译服务"), translations: data.translations });
    setStatus(`翻译完成 · ${clean.length} 段 · ${data.provider || "翻译服务"}`);
  };
  const runOcr = async (blob: Blob, signal: AbortSignal, autoTranslate: boolean) => {
    setBusy("ocr"); setResult(null); setSourceText(""); setStatus("正在本机识别图片中的文字…");
    const result = await recognizeScreenshot(blob, "md", signal, setStatus); checkAbort(signal);
    setSourceText(result.plainText);
    if (!result.plainText.trim()) { setStatus("没有识别到文字，请扩大选区或提高原文字号后重试；未发起翻译"); return; }
    setStatus(`识别完成，共 ${result.plainText.length} 个字；请核对原文`);
    if (autoTranslate) await translateText(splitTranslationParagraphs(result.plainText), signal);
  };
  useCaptureAction('screenshot-translate',shot => perform(async signal => {
    const blob=imageBlob(shot.dataUrl);image.current=blob;setImageUrl(shot.dataUrl);
    await runOcr(blob,signal,true);
  }));
  const capture = () => perform(async (signal) => {
    const delayMs = Number(delay);
    if (!Number.isFinite(delayMs) || delayMs < 0 || delayMs > 15000) throw new Error("截屏延时须为 0～15000 毫秒");
    setBusy("capture"); setStatus(delayMs ? `${delayMs / 1000} 秒后进入桌面框选…` : "在桌面拖动框选，Enter 确认；Esc / 右键取消");
    const shot = await desktopBridge().captureRegion(Math.round(delayMs)); checkAbort(signal);
    if (shot.cancelled) { setStatus("已取消截图，原图、原文和译文均保留"); return; }
    if (!shot.success || !shot.dataUrl) throw new Error(shot.error || "区域截图没有返回图片");
    const blob = imageBlob(shot.dataUrl); image.current = blob; setImageUrl(shot.dataUrl);
    await runOcr(blob, signal, true);
  });
  const pickImage = (file: File | null | undefined) => {
    if (!file || operation.current) return;
    if (!/\.(png|jpe?g|webp|bmp|tiff?|gif)$/i.test(file.name)) { setError("此工具不支持该文件类型。"); return; }
    image.current = file; setImageUrl(URL.createObjectURL(file)); setSourceText(""); setResult(null); setError(null);
    setStatus("图片已载入，尚未识别或发送翻译。请点击“识别此图”或“识别并翻译”。");
  };
  const translate = (texts: string[]) => perform((signal) => translateText(texts, signal));
  const recognizeLoaded = (autoTranslate: boolean) => perform(async (signal) => {
    if (!image.current) throw new Error("请先选择图片");
    await runOcr(image.current, signal, autoTranslate);
  });
  const clear = () => {
    if (operation.current) return;
    image.current = null; setImageUrl(null); setSourceText(""); setResult(null); setStatus(""); setError(null);
  };

  const swap = () => {
    const f = from === "auto" ? "en" : from;
    setFrom(to);
    setTo(f);
    setResult(null);
  };

  const translated = result ? result.translations.join("\n\n") : "";

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="thin-scroll space-y-4 lg:col-span-5">
          <SectionCard
            icon={<Languages className="h-4 w-4" />}
            title={__ui("翻译方向")}
            extra={
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={swap} disabled={busy !== null}>
                <ArrowRightLeft className="h-3.5 w-3.5" /> {__ui("换个方向")}</Button>
            }
          >
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="st-from">{__ui("原文语言")}</Label>
                <Select id="st-from" value={from} disabled={busy !== null} onChange={(e) => { setFrom(e.target.value); setResult(null); }} className="w-full text-xs">
                  {LANGS.map((l) => (
                    <option key={l.id} value={l.id}>
                      {__msg(l.name)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="st-to">{__ui("译文语言")}</Label>
                <Select id="st-to" value={to} disabled={busy !== null} onChange={(e) => { setTo(e.target.value); setResult(null); }} className="w-full text-xs">
                  {LANGS.filter((l) => l.id !== "auto").map((l) => (
                    <option key={l.id} value={l.id}>
                      {__msg(l.name)}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
              {__ui("截图与取字在本机完成。点击“翻译”类按钮会将识别文字发往腾讯翻译，失败时尝试有道；请勿翻译密码等敏感内容。公开服务无需密钥，但可用性由服务方决定。")}</p>
          </SectionCard>

          <SectionCard
            icon={<ScanText className="h-4 w-4" />}
            title={__ui("从哪里取文字")}
            extra={
              imageUrl || sourceText ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1.5"
                  onClick={clear}
                  disabled={busy !== null}
                >
                  <Eraser className="h-3.5 w-3.5" /> {__ui("清空")}</Button>
              ) : null
            }
          >
            <div className="grid grid-cols-2 gap-2">
              <Button type="button" className="gap-1.5" onClick={() => void capture()} disabled={busy !== null}>
                {busy === "ocr" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
                {__ui("框选截图并翻译")}</Button>
              <Button type="button" variant="outline" className="gap-1.5" onClick={() => fileRef.current?.click()} disabled={busy !== null}>
                <ImageIcon className="h-3.5 w-3.5" /> {__ui("选一张图")}</Button>
            </div>
            <div data-furinakit-file-field className="mt-2">
              <input
                ref={fileRef}
                type="file"
                accept=".png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff,.gif"
                disabled={busy !== null}
                className="hidden"
                onChange={(e) => {
                  void pickImage(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy !== null}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-border/60 bg-muted/20 p-3 text-center transition-colors hover:border-primary/50 hover:bg-muted/30"
              >
                <Upload className="h-4 w-4 shrink-0 text-primary" />
                <span className="text-[11.5px] font-medium text-foreground">{__ui("也可以把图片拖到这里（仅载入）")}</span>
              </button>
            </div>
            <div className="mt-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <Label htmlFor="st-delay" className="shrink-0">{__ui("截屏延时")}</Label>
                <Input id="st-delay" type="number" min="0" max="15000" step="100" disabled={busy !== null} value={delay} onChange={(e) => setDelay(e.target.value)} className="h-9 w-28 text-xs" />
                <span className="text-xs text-muted-foreground">{__ui("毫秒")}</span>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">{__ui("最多 15 秒；等待时可切换要截图的窗口。")}</p>
            </div>
            {imageUrl && (
              <div className="mt-3 space-y-2">
                <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void recognizeLoaded(false)}>{__ui("识别此图")}</Button><Button size="sm" disabled={busy !== null} onClick={() => void recognizeLoaded(true)}>{__ui("识别并翻译")}</Button></div>
                <img src={imageUrl} alt={__ui("待识别图片或已确认的截图区域")} className="max-h-[240px] w-full rounded-xl border border-border/60 object-contain" />
              </div>
            )}
          </SectionCard>
        </div>

        <div className="thin-scroll space-y-4 lg:col-span-7">
          <SectionCard
            icon={<ScanText className="h-4 w-4" />}
            title={__ui("识别到的原文")}
            extra={
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => { setSourceText(SAMPLE); setResult(null); }} disabled={busy !== null}>
                  <Sparkles className="h-3.5 w-3.5" /> {__ui("填入示例")}</Button>
                <Button
                  type="button"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => void translate(splitTranslationParagraphs(sourceText))}
                  disabled={busy !== null || !sourceText.trim()}
                >
                  {busy === "translate" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Languages className="h-3.5 w-3.5" />}
                  {__ui("翻译")}</Button>
              </div>
            }
          >
            <textarea
              value={sourceText}
              disabled={busy !== null}
              onChange={(e) => { setSourceText(e.target.value); setResult(null); }}
              placeholder={__ui("框选确认或主动识别图片后会在这里显示原文；也可以直接在这里粘贴要翻译的文字（按空行分段，每段单独翻译）")}
              className="thin-scroll h-40 w-full resize-y rounded-xl border border-border/60 bg-background/60 p-3 text-[12.5px] leading-relaxed text-foreground outline-none focus:ring-2 focus:ring-primary/30"
            />
            {status && (
              <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {__msg(status)}
              </p>
            )}
            {error && (
              <div role="alert" className="mt-3 flex items-start gap-2 rounded-xl border-l-4 border-l-destructive bg-destructive/10 px-4 py-2.5 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="leading-relaxed">{__msg(error)}</span>
              </div>
            )}
          </SectionCard>

          <SectionCard
            icon={<Languages className="h-4 w-4" />}
            title={__ui("译文")}
            extra={
              result ? (
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className="font-normal text-primary">
                    {result.provider}
                  </Badge>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => { void navigator.clipboard.writeText(translated).then(() => setStatus("已复制译文"), () => setError("复制失败，请选中译文后手动复制")); }}
                  >
                    <Copy className="h-3.5 w-3.5" /> {__ui("复制译文")}</Button>
                </div>
              ) : null
            }
          >
            {result ? (
              <textarea
                readOnly
                value={translated}
                className="thin-scroll h-40 w-full resize-y rounded-xl border border-border/60 bg-background/60 p-3 text-[12.5px] leading-relaxed text-foreground outline-none"
              />
            ) : (
              <div className="flex flex-col items-center justify-center gap-2.5 py-12 text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Languages className="h-5 w-5" />
                </span>
                <p className="text-sm font-medium text-foreground">{__ui("截屏 / 选图识别，或直接粘贴文字")}</p>
                <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
                  {__ui("取字读取真实文本产物，而不是任务状态提示。译文会标明服务来源，请核对专有名词、数字与段落是否完整。")}</p>
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
