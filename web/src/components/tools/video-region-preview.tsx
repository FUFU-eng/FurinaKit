"use client";
import { createUiText as __createUiText, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/video-region-preview.tsx");


import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/primitives";

/** File-backed object URLs allow local seek without reading the whole file into JS. */
export function VideoRegionPreview({ file, values, onRegion }: {
  file: File;
  values: Record<string, string>;
  onRegion: (fields: Record<string, string>) => void;
}) {
  const __locale = __useLanguage();
  const video = useRef<HTMLVideoElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [source, setSource] = useState<{ file: File; url: string } | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [drawing, setDrawing] = useState(false);
  const [failed, setFailed] = useState(false);
  const [draft, setDraft] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  useEffect(() => {
    setSize({ w: 0, h: 0 }); setFailed(false); setDrawing(false); setDraft(null); start.current = null;
    const url = URL.createObjectURL(file);
    setSource({ file, url });
    return () => URL.revokeObjectURL(url);
  }, [file]);
  const src = source?.file === file ? source.url : undefined;
  const region = draft ?? (values.position === "custom" ? {
    x: Number(values.rectX), y: Number(values.rectY), w: Number(values.rectW), h: Number(values.rectH),
  } : null);
  const visible = region && Object.values(region).every(Number.isFinite) && region.w > 0 && region.h > 0 && size.w > 0 && size.h > 0;
  const point = (e: React.PointerEvent<HTMLDivElement>) => {
    const bounds = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(size.w, Math.round((e.clientX - bounds.left) / bounds.width * size.w))),
      y: Math.max(0, Math.min(size.h, Math.round((e.clientY - bounds.top) / bounds.height * size.h))),
    };
  };
  const selection = (e: React.PointerEvent<HTMLDivElement>) => {
    const a = start.current;
    if (!a) return null;
    const b = point(e);
    return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(a.x - b.x), h: Math.abs(a.y - b.y) };
  };
  return (
    <section className="space-y-2 rounded-xl border border-border p-3" aria-label={__ui("视频区域预览")}>
      <p className="text-xs text-muted-foreground">{__ui("先播放并拖动进度条找到水印画面，再暂停框选。框选会填写下方自定义区域；也可直接用数字微调。")}</p>
      <div className="relative mx-auto max-w-2xl overflow-hidden rounded-lg bg-black">
        <video ref={video} src={src} controls={!drawing} preload="metadata" className="block h-auto w-full"
          onLoadedMetadata={(e) => setSize({ w: e.currentTarget.videoWidth, h: e.currentTarget.videoHeight })}
          onError={() => { setFailed(true); setDrawing(false); }} />
        {visible && <div className="pointer-events-none absolute border-2 border-amber-400 bg-amber-400/20" style={{
          left: `${region.x / size.w * 100}%`, top: `${region.y / size.h * 100}%`,
          width: `${region.w / size.w * 100}%`, height: `${region.h / size.h * 100}%`,
        }} />}
        {drawing && <div className="absolute inset-0 touch-none cursor-crosshair" aria-label={__ui("拖动框选水印区域")}
          onPointerDown={(e) => { if (e.button !== 0) return; e.preventDefault(); e.currentTarget.setPointerCapture(e.pointerId); start.current = point(e); setDraft(null); }}
          onPointerMove={(e) => { const next = selection(e); if (next) setDraft(next); }}
          onPointerUp={(e) => {
            const next = selection(e); start.current = null;
            if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
            if (next && next.w >= 2 && next.h >= 2) {
              onRegion({ position: "custom", rectX: String(next.x), rectY: String(next.y), rectW: String(next.w), rectH: String(next.h) });
              setDrawing(false);
            }
            setDraft(null);
          }}
          onPointerCancel={() => { start.current = null; setDraft(null); }} />}
      </div>
      <div className="flex items-center gap-3">
        <Button type="button" variant="outline" size="sm" disabled={!src || !size.w || failed}
          onClick={() => { video.current?.pause(); setDrawing(!drawing); setDraft(null); start.current = null; }}>
          {drawing ? __ui("退出框选，继续播放") : __ui("暂停并框选水印")}
        </Button>
        {size.w > 0 && <span className="text-xs text-muted-foreground">{size.w} × {size.h} {__ui("· 原始像素坐标")}</span>}
      </div>
      {failed && <p role="alert" className="text-xs text-destructive">{__ui("当前视频编码无法在播放器中预览。请先转换为浏览器支持的 MP4（H.264）后再进行可视框选。")}</p>}
    </section>
  );
}
