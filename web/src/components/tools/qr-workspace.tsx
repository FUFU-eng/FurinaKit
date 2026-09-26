import { uiMessage as __msg } from "@/lib/language";
import { useEffect, useRef, useState, useCallback } from "react";
import {
  Upload,
  ScanLine,
  Copy,
  Check,
  Download,
  ExternalLink,
  QrCode,
  Trash2,
  RefreshCw,
  Loader2,
  AlertCircle,
  FileText,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { tr, useLanguage } from "@/lib/language";
import { saveOutputBlob, reportOutputSaved } from "@/lib/output-directory";
import { cn } from "@/lib/utils";

type Point = { x: number; y: number };
type Result = { text: string; points: Point[] };

export function QrWorkspace() {
  useLanguage();
  const { toast } = useToast();
  const input = useRef<HTMLInputElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const worker = useRef<Worker | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [error, setError] = useState("");
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [region, setRegion] = useState<{ a: Point; b: Point } | null>(null);
  const drag = useRef<Point | null>(null);

  const stop = useCallback(() => {
    worker.current?.terminate();
    worker.current = null;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => {
    setReady(false);
    setResults([]);
    setRegion(null);
    setError("");
    if (!file) {
      setUrl("");
      return;
    }
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => {
      URL.revokeObjectURL(u);
      stop();
    };
  }, [file, stop]);

  useEffect(() => () => stop(), [stop]);

  const choose = (f?: File) => {
    if (!f) return;
    if (f.size > 30 * 1024 * 1024) {
      setError(tr("请选择30 MiB以内的图片。", "Choose an image no larger than 30 MiB."));
      return;
    }
    stop();
    setBusy(false);
    setError("");
    setFile(f);
  };

  // 全局粘贴监听：在页面任何位置按 Ctrl+V 均可载入剪贴板图片
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const f = item.getAsFile();
          if (f) {
            e.preventDefault();
            choose(f);
            break;
          }
        }
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, []);

  const decode = useCallback((overrideImg?: HTMLImageElement, customRegion?: { a: Point; b: Point } | null) => {
    const img = overrideImg || image.current;
    if (!img) return;
    stop();
    setBusy(true);
    setError("");
    setResults([]);

    try {
      const currentRegion = customRegion !== undefined ? customRegion : region;
      let x = 0,
        y = 0,
        w = img.naturalWidth || img.width,
        h = img.naturalHeight || img.height;

      if (!w || !h) {
        setBusy(false);
        return;
      }

      if (w * h > 40_000_000) {
        throw new Error(tr("图片超过4000万像素，请先缩小图片。", "Image exceeds 40 megapixels. Resize it first."));
      }

      if (currentRegion) {
        x = Math.min(currentRegion.a.x, currentRegion.b.x) * w;
        y = Math.min(currentRegion.a.y, currentRegion.b.y) * h;
        w *= Math.abs(currentRegion.a.x - currentRegion.b.x);
        h *= Math.abs(currentRegion.a.y - currentRegion.b.y);
      }

      if (w < 16 || h < 16) {
        throw new Error(tr("选区太小，请重新框选。", "Selection is too small. Select a larger region."));
      }

      const scale = Math.min(1, 2200 / Math.max(w, h));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(w * scale));
      canvas.height = Math.max(1, Math.round(h * scale));

      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) throw new Error(tr("无法创建图像画布", "Unable to create an image canvas"));

      ctx.fillStyle = "#FFFFFF";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, x, y, w, h, 0, 0, canvas.width, canvas.height);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);

      const nw = img.naturalWidth || img.width;
      const nh = img.naturalHeight || img.height;

      const run = new Worker(new URL("./qr-decode.worker.ts", import.meta.url), { type: "module" });
      worker.current = run;

      run.onmessage = (e) => {
        const value = e.data as { results?: Result[]; error?: string };
        stop();
        setBusy(false);
        if (value.error) {
          setError(tr("解码失败，请尝试裁剪或更清晰的图片。", "Decoding failed. Try cropping or a clearer image."));
          return;
        }
        const found = value.results || [];
        setResults(
          found.map((r) => ({
            ...r,
            points: r.points.map((p) => ({
              x: (x + (p.x / canvas.width) * w) / nw,
              y: (y + (p.y / canvas.height) * h) / nh,
            })),
          }))
        );
        if (!found.length) {
          setError(
            tr(
              "未能识别到二维码。可尝试在图片上拖拽框选二维码区域后点击“重新识别”。",
              "No QR code found. Try dragging to select the QR area and retry."
            )
          );
        }
      };

      run.onerror = () => {
        stop();
        setBusy(false);
        setError(tr("二维码解码器遇到异常，请重试", "QR decoder encountered an error"));
      };

      timer.current = setTimeout(() => {
        stop();
        setBusy(false);
        setError(tr("解码超时，请缩小选区或换用较小图片。", "Decoding timed out. Select a smaller region and retry."));
      }, 15000);

      run.postMessage(
        {
          pixels: data.data.buffer,
          width: canvas.width,
          height: canvas.height,
        },
        [data.data.buffer]
      );
    } catch (e) {
      stop();
      setBusy(false);
      setError(String(e));
    }
  }, [region, stop]);

  const point = (e: React.PointerEvent) => {
    const r = image.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    };
  };

  const copy = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIdx(index);
      toast({ title: tr("已复制内容到剪贴板", "Copied to clipboard"), variant: "success" });
      setTimeout(() => setCopiedIdx(null), 2000);
    } catch (e) {
      setError(tr("复制失败：", "Copy failed: ") + String(e));
    }
  };

  const exportText = async () => {
    try {
      const content = results
        .map((r, i) => `=== QR Code #${i + 1} ===\n${r.text}`)
        .join("\n\n");
      const path = await saveOutputBlob(
        new Blob([content], { type: "text/plain;charset=utf-8" }),
        `qr-decode-${Date.now()}.txt`
      );
      reportOutputSaved(path);
      toast({ title: tr("已保存导出文件", "Exported successfully"), description: path, variant: "success" });
    } catch (e) {
      setError(String(e));
    }
  };

  const safeUrl = (text: string) => {
    try {
      const u = new URL(text.trim());
      return ["http:", "https:"].includes(u.protocol) ? u.href : null;
    } catch {
      return null;
    }
  };

  return (
    <div className="space-y-6">
      {/* 隐藏式原生文件上传 */}
      <input
        ref={input}
        hidden
        type="file"
        accept="image/png,image/jpeg,image/webp,image/bmp,image/gif"
        onChange={(e) => {
          choose(e.target.files?.[0]);
          e.target.value = "";
        }}
      />

      {/* 主工作区 */}
      {!file ? (
        /* 空状态：精美上传拖拽卡片 */
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragging(true);
          }}
          onDragLeave={() => setIsDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragging(false);
            choose(e.dataTransfer.files[0]);
          }}
          onClick={() => input.current?.click()}
          className={cn(
            "group relative flex min-h-[340px] cursor-pointer flex-col items-center justify-center rounded-3xl border-2 border-dashed p-8 text-center transition-all",
            isDragging
              ? "border-primary bg-primary/5 scale-[0.99]"
              : "border-border bg-card/60 hover:border-primary/50 hover:bg-card hover:shadow-lg"
          )}
        >
          <div className="flex h-20 w-20 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-primary shadow-sm transition-transform group-hover:scale-110">
            <QrCode size={40} strokeWidth={1.8} />
          </div>

          <h3 className="mt-5 text-lg font-bold text-foreground">
            {tr("上传或拖拽二维码图片", "Upload or drag QR code image")}
          </h3>
          <p className="mt-1.5 max-w-md text-xs leading-relaxed text-muted-foreground">
            {tr(
              "支持常见 PNG / JPG / WebP 等图片；可直接按 Ctrl+V 粘贴系统剪贴板截图。",
              "Supports PNG / JPG / WebP; press Ctrl+V to paste screenshot from clipboard."
            )}
          </p>

          <Button
            size="lg"
            className="mt-6 gap-2 rounded-xl shadow-sm"
            onClick={(e) => {
              e.stopPropagation();
              input.current?.click();
            }}
          >
            <Upload size={16} />
            {tr("选择本地图片", "Select Image")}
          </Button>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-4 text-[11px] text-muted-foreground/80">
            <span className="flex items-center gap-1.5">
              <ShieldCheck size={14} className="text-emerald-500" />
              {tr("纯本地离线解析，隐私安全", "Local offline, 100% private")}
            </span>
            <span>•</span>
            <span className="flex items-center gap-1.5">
              <Sparkles size={14} className="text-sky-500" />
              {tr("支持同图多码识别", "Multi-code detection")}
            </span>
            <span>•</span>
            <span className="flex items-center gap-1.5">
              <ScanLine size={14} className="text-amber-500" />
              {tr("可拖拽局部框选精准定位", "Interactive crop selection")}
            </span>
          </div>
        </div>
      ) : (
        /* 已选择图片：双栏/并列工作台 */
        <div className="space-y-5">
          {/* 顶部操作控制条 */}
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-3.5 shadow-xs">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <QrCode size={18} />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-foreground truncate max-w-xs sm:max-w-md">
                  {file.name}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  {(file.size / 1024).toFixed(1)} KB · {region ? tr("已框选局部区域", "Region selected") : tr("全图识别模式", "Full image")}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => input.current?.click()}
                className="gap-1.5"
              >
                <Upload size={14} />
                {tr("换一张图", "Change Image")}
              </Button>

              <Button
                size="sm"
                disabled={!ready || busy}
                onClick={() => decode()}
                className="gap-1.5"
              >
                {busy ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
                {busy ? tr("正在识别…", "Decoding…") : tr("重新识别", "Re-decode")}
              </Button>

              {region && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setRegion(null);
                    decode(undefined, null);
                  }}
                  className="gap-1.5 text-muted-foreground"
                >
                  {tr("清除选区", "Clear selection")}
                </Button>
              )}

              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  stop();
                  setFile(null);
                  setUrl("");
                  setResults([]);
                  setError("");
                }}
                className="gap-1.5 text-destructive hover:bg-destructive/10"
              >
                <Trash2 size={14} />
                {tr("清空", "Clear")}
              </Button>
            </div>
          </div>

          {/* 错误提示 */}
          {error && (
            <div className="flex items-start gap-2.5 rounded-2xl border border-destructive/20 bg-destructive/10 p-4 text-xs text-destructive">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <div className="leading-relaxed">{error}</div>
            </div>
          )}

          {/* 图像与识别结果布局 */}
          <div className="grid gap-5 lg:grid-cols-12">
            {/* 左侧：图像预览与框选区域 */}
            <div className="lg:col-span-6 space-y-2">
              <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                <span>{tr("图片画面（可鼠标拖拽框选二维码）", "Preview (drag to select)")}</span>
                {results.length > 0 && (
                  <span className="text-emerald-600 font-medium">
                    {tr(`已标记 ${results.length} 处二维码`, `${results.length} code(s) marked`)}
                  </span>
                )}
              </div>

              <div className="relative flex min-h-[260px] items-center justify-center overflow-hidden rounded-2xl border border-border bg-muted/20 p-2">
                <div
                  className="relative inline-block max-w-full touch-none select-none"
                  onPointerDown={(e) => {
                    if (!ready || busy) return;
                    e.currentTarget.setPointerCapture(e.pointerId);
                    drag.current = point(e);
                    setRegion({ a: drag.current, b: drag.current });
                  }}
                  onPointerMove={(e) => {
                    if (drag.current) setRegion({ a: drag.current, b: point(e) });
                  }}
                  onPointerUp={(e) => {
                    if (drag.current) {
                      const b = point(e);
                      const a = drag.current;
                      const hasArea = Math.abs(a.x - b.x) >= 0.01 && Math.abs(a.y - b.y) >= 0.01;
                      const nextReg = hasArea ? { a, b } : null;
                      setRegion(nextReg);
                      drag.current = null;
                      if (nextReg) {
                        decode(undefined, nextReg);
                      }
                    }
                  }}
                  onPointerCancel={() => {
                    drag.current = null;
                    setRegion(null);
                  }}
                >
                  <img
                    ref={image}
                    src={url}
                    alt={file.name}
                    draggable={false}
                    className="block max-h-[460px] max-w-full rounded-xl object-contain shadow-xs"
                    onLoad={(e) => {
                      setReady(true);
                      decode(e.currentTarget);
                    }}
                    onError={() => {
                      setReady(false);
                      setError(tr("无法读取图片，请换用PNG或JPEG格式。", "Unable to read image. Try PNG or JPEG."));
                    }}
                  />

                  {/* 绘制选区与识别结果标记 */}
                  <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 1 1" preserveAspectRatio="none">
                    {region && (
                      <rect
                        x={Math.min(region.a.x, region.b.x)}
                        y={Math.min(region.a.y, region.b.y)}
                        width={Math.abs(region.a.x - region.b.x)}
                        height={Math.abs(region.a.y - region.b.y)}
                        fill="#0ea5e925"
                        stroke="#0ea5e9"
                        strokeWidth="0.005"
                        strokeDasharray="0.01 0.005"
                      />
                    )}
                    {results.map((r, i) => (
                      <polygon
                        key={i}
                        points={r.points.map((p) => `${p.x},${p.y}`).join(" ")}
                        fill="#10b98122"
                        stroke="#10b981"
                        strokeWidth="0.006"
                      />
                    ))}
                  </svg>
                </div>
              </div>
            </div>

            {/* 右侧：识别结果展示卡片 */}
            <div className="lg:col-span-6 space-y-3">
              <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
                <span>
                  {results.length > 0
                    ? tr(`识别成功 · 共 ${results.length} 个结果`, `Found ${results.length} code(s)`)
                    : tr("解析结果", "Decode Results")}
                </span>

                {results.length > 0 && (
                  <Button size="sm" variant="outline" onClick={exportText} className="h-7 text-xs gap-1.5">
                    <Download size={13} />
                    {tr("导出 TXT", "Export TXT")}
                  </Button>
                )}
              </div>

              {busy ? (
                <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-border bg-card p-6 text-center">
                  <Loader2 size={32} className="animate-spin text-primary" />
                  <p className="mt-3 text-xs font-semibold text-foreground">
                    {tr("正在本地离线识别二维码…", "Decoding QR codes locally…")}
                  </p>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    {tr("多级增强算法尝试中，请稍候", "Trying enhancement passes…")}
                  </p>
                </div>
              ) : results.length > 0 ? (
                <div className="space-y-3 max-h-[490px] overflow-y-auto pr-1">
                  {results.map((r, i) => {
                    const isLink = safeUrl(r.text);
                    return (
                      <article
                        key={i}
                        className="rounded-2xl border border-border bg-card p-4 shadow-xs space-y-3 transition-all hover:border-primary/30"
                      >
                        <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-2.5">
                          <div className="flex items-center gap-2">
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary font-mono">
                              {i + 1}
                            </span>
                            <span className="text-xs font-bold text-foreground">
                              {isLink ? tr("网址链接", "URL Link") : tr("文本内容", "Text Content")}
                            </span>
                          </div>

                          <div className="flex items-center gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => copy(r.text, i)}
                              className="h-7 text-xs gap-1.5"
                            >
                              {copiedIdx === i ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                              {copiedIdx === i ? tr("已复制", "Copied") : tr("复制", "Copy")}
                            </Button>

                            {isLink && (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => {
                                  const href = safeUrl(r.text);
                                  if (href) {
                                    const bridge = (window as any).furinakit;
                                    if (bridge?.openExternal) {
                                      void bridge.openExternal(href).catch((e: unknown) => setError(String(e)));
                                    } else {
                                      window.open(href, "_blank", "noopener,noreferrer");
                                    }
                                  }
                                }}
                                className="h-7 text-xs gap-1.5 text-primary hover:text-primary"
                              >
                                <ExternalLink size={12} />
                                {tr("打开", "Open")}
                              </Button>
                            )}
                          </div>
                        </div>

                        {/* 内容显示框 */}
                        <div className="rounded-xl border border-border/60 bg-muted/30 p-3 font-mono text-xs leading-relaxed break-all select-text max-h-48 overflow-y-auto">
                          {r.text || (
                            <span className="italic text-muted-foreground">
                              {tr("二维码没有可显示的文本（可能是二进制内容）", "No displayable text (binary data)")}
                            </span>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-dashed border-border bg-card/40 p-6 text-center text-muted-foreground">
                  <FileText size={32} className="opacity-40" />
                  <p className="mt-3 text-xs font-medium">
                    {tr("暂无识别结果", "No decoded result yet")}
                  </p>
                  <p className="mt-1 text-[11px] max-w-xs">
                    {tr("若图像较复杂或有反光，可在左侧图片上拖动鼠标框选局部二维码", "If image is complex, drag to select the QR area on preview")}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
