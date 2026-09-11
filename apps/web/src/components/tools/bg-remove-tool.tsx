"use client";

import { useState, useRef, useCallback, useEffect } from "react";
import { Loader2, Download, Sparkles, RotateCcw, ChevronsLeftRight, Check, AlertCircle } from "lucide-react";
import { Button, Alert, ProgressBar } from "@/components/ui/primitives";
import { FileDropzone } from "@/components/tools/file-dropzone";
import { formatBytes, cn } from "@/lib/utils";
import { useToast } from "@/components/ui/toast";

type BgMode = "transparent" | "white" | "black" | "blue" | "red" | "custom";

const BG_OPTIONS: { id: BgMode; label: string; preview: string }[] = [
  { id: "transparent", label: "透明背景", preview: "repeating-conic-gradient(#aaa 0% 25%, #eee 0% 50%) 0 0 / 10px 10px" },
  { id: "white",       label: "纯白底",   preview: "#ffffff" },
  { id: "black",       label: "纯黑底",   preview: "#000000" },
  { id: "blue",        label: "证件蓝",   preview: "#438edb" },
  { id: "red",         label: "证件红",   preview: "#d92027" },
  { id: "custom",      label: "自定义颜色", preview: "" },
];

async function flattenWithBackground(pngUrl: string, color: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return resolve(pngUrl);
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = reject;
    img.src = pngUrl;
  });
}

// 模块级缓存，确保跨页面跳转不丢失已上传的图片与已处理结果
const bgRemoveCache: {
  files: File[];
  result: { pngUrl: string; name: string; size: number; beforeUrl: string } | null;
  activeJobId: string | null;
  busy: boolean;
  progress: number;
  statusText: string;
} = {
  files: [],
  result: null,
  activeJobId: null,
  busy: false,
  progress: 0,
  statusText: "",
};

export function BgRemoveTool() {
  const { toast } = useToast();
  const [files, setFilesState] = useState<File[]>(bgRemoveCache.files);
  const [busy, setBusyState] = useState(bgRemoveCache.busy);
  const [progress, setProgressState] = useState(bgRemoveCache.progress);
  const [statusText, setStatusTextState] = useState(bgRemoveCache.statusText);
  const [error, setError] = useState<string | null>(null);
  const [result, setResultState] = useState<{
    pngUrl: string;
    name: string;
    size: number;
    beforeUrl: string;
  } | null>(bgRemoveCache.result);
  const [bgMode, setBgMode] = useState<BgMode>("transparent");
  const [customColor, setCustomColor] = useState("#3b82f6");
  const [sliderX, setSliderX] = useState(50);
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const activeJobIdRef = useRef<string | null>(bgRemoveCache.activeJobId);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  const setFiles = (f: File[] | ((prev: File[]) => File[])) => {
    setFilesState((prev) => {
      const next = typeof f === "function" ? f(prev) : f;
      bgRemoveCache.files = next;
      return next;
    });
  };

  const setBusy = (b: boolean) => {
    bgRemoveCache.busy = b;
    setBusyState(b);
  };

  const setProgress = (p: number) => {
    bgRemoveCache.progress = p;
    setProgressState(p);
  };

  const setStatusText = (t: string) => {
    bgRemoveCache.statusText = t;
    setStatusTextState(t);
  };

  const setResult = (r: { pngUrl: string; name: string; size: number; beforeUrl: string } | null) => {
    bgRemoveCache.result = r;
    setResultState(r);
  };

  // 轮询与恢复后台任务
  const pollJob = useCallback(async (jobId: string, beforeUrl?: string) => {
    activeJobIdRef.current = jobId;
    bgRemoveCache.activeJobId = jobId;
    try {
      sessionStorage.setItem("furina:job:bg-remove", jobId);
    } catch {}

    let pollCount = 0;
    const check = async (): Promise<void> => {
      pollCount++;
      try {
        const statusRes = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        if (!statusRes.ok) return;
        const resData = await statusRes.json();
        const jobObj = resData.job || resData;

        if (jobObj.status === "completed") {
          setProgress(100);
          setStatusText("正在生成超清透明图…");

          const dlRes = await fetch(`/api/jobs/${jobId}/download`, { cache: "no-store" });
          if (!dlRes.ok) throw new Error("下载抠图结果失败");
          const blob = await dlRes.blob();
          const pngUrl = URL.createObjectURL(blob);
          const name = jobObj.resultFilename || "removed-bg.png";

          setResult({
            pngUrl,
            name,
            size: blob.size,
            beforeUrl: beforeUrl || bgRemoveCache.result?.beforeUrl || pngUrl,
          });
          setSliderX(50);
          setBusy(false);
          setStatusText("");
          window.dispatchEvent(new CustomEvent("furinakit:jobs-updated"));
          toast({ title: "AI 抠图完成！", variant: "success" });
          return;
        } else if (jobObj.status === "failed") {
          setBusy(false);
          setStatusText("");
          window.dispatchEvent(new CustomEvent("furinakit:jobs-updated"));
          setError(jobObj.error || "抠图处理失败");
          toast({ title: "抠图处理失败", description: jobObj.error, variant: "error" });
          return;
        } else {
          setBusy(true);
          const currentPct = Math.min(95, Math.max(30, (jobObj.progress?.percent || 40) + pollCount * 3));
          setProgress(currentPct);
          setStatusText(jobObj.progress?.message || `AI 运算处理中 (${currentPct}%)…`);
          pollTimerRef.current = setTimeout(check, 800);
        }
      } catch {
        pollTimerRef.current = setTimeout(check, 1500);
      }
    };
    await check();
  }, [toast]);

  // 页面挂载时自动恢复正在进行中的任务
  useEffect(() => {
    let unmounted = false;
    const restore = async () => {
      let jId: string | null = null;
      if (typeof window !== "undefined") {
        const sp = new URLSearchParams(window.location.search);
        jId = sp.get("jobId") || sessionStorage.getItem("furina:job:bg-remove");
      }
      if (!jId && bgRemoveCache.activeJobId) {
        jId = bgRemoveCache.activeJobId;
      }
      if (!jId) {
        try {
          const r = await fetch("/api/jobs", { cache: "no-store" });
          const data = await r.json();
          const running = data?.jobs?.find(
            (j: { toolId?: string; status?: string; id?: string }) =>
              j.toolId === "bg-remove" &&
              (j.status === "processing" || j.status === "pending" || j.status === "queued")
          );
          if (running?.id) jId = running.id;
        } catch {}
      }
      if (!jId || unmounted) return;
      pollJob(jId);
    };

    restore();

    const handleSelectJob = (e: Event) => {
      const detail = (e as CustomEvent<{ toolId?: string; jobId?: string }>).detail;
      if (detail?.toolId === "bg-remove" && detail?.jobId) {
        pollJob(detail.jobId);
      }
    };
    window.addEventListener("furinakit:select-job", handleSelectJob);
    return () => {
      unmounted = true;
      window.removeEventListener("furinakit:select-job", handleSelectJob);
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [pollJob]);

  const previewUrl = files[0] ? URL.createObjectURL(files[0]) : null;

  // 滑块对比控制
  const getSliderX = useCallback((e: MouseEvent | TouchEvent | React.MouseEvent | React.TouchEvent) => {
    if (!containerRef.current) return 50;
    const rect = containerRef.current.getBoundingClientRect();
    const clientX = "touches" in e ? e.touches[0].clientX : (e as React.MouseEvent).clientX;
    return Math.min(100, Math.max(0, ((clientX - rect.left) / rect.width) * 100));
  }, []);

  const onMouseDown = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    e.preventDefault();
    setIsDragging(true);
    setSliderX(getSliderX(e));
  }, [getSliderX]);

  useEffect(() => {
    if (!isDragging) return;
    const move = (e: MouseEvent | TouchEvent) => setSliderX(getSliderX(e));
    const up = () => setIsDragging(false);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    window.addEventListener("touchmove", move, { passive: true });
    window.addEventListener("touchend", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
    };
  }, [isDragging, getSliderX]);

  const run = async () => {
    setError(null);
    setResult(null);
    setProgress(0);
    if (!files[0]) {
      setError("请先选择一张图片");
      return;
    }
    setBusy(true);
    const beforeUrl = URL.createObjectURL(files[0]);

    try {
      setStatusText("正在提交任务至 AI 服务…");
      setProgress(15);

      const formData = new FormData();
      formData.append("file", files[0]);
      formData.append("model", "u2net");

      // 提交至后台任务调度器 (悬浮球会立即捕获并展示进行中任务)
      const res = await fetch("/api/tools/bg-remove", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "创建抠图任务失败，请确认后台服务已启动");
      }

      const { job } = await res.json();
      if (!job || !job.id) {
        throw new Error("未能获取有效的任务编号");
      }

      activeJobIdRef.current = job.id;
      bgRemoveCache.activeJobId = job.id;
      try {
        sessionStorage.setItem("furina:job:bg-remove", job.id);
      } catch {}
      window.dispatchEvent(new CustomEvent("furinakit:jobs-updated"));
      setStatusText("AI 智能主体分析与轮廓提取中…");
      setProgress(40);

      await pollJob(job.id, beforeUrl);
    } catch (err) {
      URL.revokeObjectURL(beforeUrl);
      const msg = err instanceof Error ? err.message : "自动抠图失败";
      setError(msg);
      toast({ title: "处理失败", description: msg, variant: "error" });
      setBusy(false);
    } finally {
      setStatusText("");
    }
  };

  const reset = () => {
    setFiles([]);
    setResult(null);
    setError(null);
    setProgress(0);
  };

  const handleDownload = async () => {
    if (!result) return;
    let src = result.pngUrl;
    if (bgMode !== "transparent") {
      const color =
        bgMode === "white"
          ? "#ffffff"
          : bgMode === "black"
          ? "#000000"
          : bgMode === "blue"
          ? "#438edb"
          : bgMode === "red"
          ? "#d92027"
          : customColor;
      src = await flattenWithBackground(result.pngUrl, color);
    }
    const a = document.createElement("a");
    a.href = src;
    a.download = bgMode === "transparent" ? result.name : result.name.replace("-nobg", `-${bgMode}`);
    a.click();
  };

  const bgForPreview =
    bgMode === "transparent"
      ? "repeating-conic-gradient(#bbb 0% 25%, #f4f4f5 0% 50%) 0 0 / 16px 16px"
      : bgMode === "white"
      ? "#ffffff"
      : bgMode === "black"
      ? "#09090b"
      : bgMode === "blue"
      ? "#438edb"
      : bgMode === "red"
      ? "#d92027"
      : customColor;

  return (
    <div className="space-y-5 max-w-5xl mx-auto">
      {/* 顶部标题与提示 */}
      <div className="rounded-2xl border border-border bg-card p-5 shadow-xs flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="text-base font-bold text-foreground flex items-center gap-2">
            <Sparkles size={18} className="text-primary" />
            AI 一键抠图、移除图片背景
          </h2>
          <p className="text-xs text-muted-foreground mt-1">
            基于领先的深度学习 AI 模型，精准识别并保留人像、商品、素材等主体元素，支持在线比对与底色自由切换
          </p>
        </div>
        {result && (
          <Button variant="outline" size="sm" onClick={reset} className="gap-1.5 text-xs">
            <RotateCcw size={13} /> 上传新图
          </Button>
        )}
      </div>

      {!result && (
        <div className="space-y-4">
          <FileDropzone
            files={files}
            onChange={setFiles}
            accept={{ "image/*": [".png", ".jpg", ".jpeg", ".webp"] }}
          />

          {/* 缩略图与处理中状态 */}
          {files[0] && previewUrl && (
            <div className="relative rounded-2xl border border-border overflow-hidden bg-muted/40 p-4 flex flex-col items-center justify-center min-h-[280px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewUrl}
                alt="preview"
                className={cn("max-h-72 max-w-full object-contain rounded-xl transition-all", busy && "opacity-40 blur-xs")}
              />

              {busy && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/70 backdrop-blur-sm p-6">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Loader2 className="h-6 w-6 animate-spin" />
                  </div>
                  <p className="text-sm font-semibold text-foreground">{statusText}</p>
                  <div className="w-full max-w-xs space-y-1.5">
                    <ProgressBar value={progress} />
                    <p className="text-center text-xs text-muted-foreground font-mono">{progress}%</p>
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="flex items-center gap-3 pt-2">
            <Button type="button" onClick={run} disabled={busy || !files[0]} className="gap-2 px-6">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {busy ? "AI 抠图中…" : "开始自动抠图"}
            </Button>
            {files[0] && !busy && (
              <Button variant="ghost" size="sm" onClick={reset} className="text-muted-foreground text-xs">
                清空文件
              </Button>
            )}
          </div>
        </div>
      )}

      {error && (
        <Alert variant="destructive" className="flex items-center gap-2">
          <AlertCircle size={16} />
          <span>{error}</span>
        </Alert>
      )}

      {/* 结果对比面板 */}
      {result && (
        <div className="space-y-6">
          {/* 背景填充切换栏 */}
          <div className="rounded-2xl border border-border bg-card p-4 shadow-xs space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-xs font-bold text-foreground">背景底色切换</span>
              <span className="text-xs text-emerald-600 dark:text-emerald-400 font-medium flex items-center gap-1">
                <Check size={14} /> 抠图完成 · {formatBytes(result.size)}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {BG_OPTIONS.map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setBgMode(opt.id)}
                  className={cn(
                    "flex items-center gap-2 rounded-xl border px-3 py-1.5 text-xs font-medium transition-all",
                    bgMode === opt.id
                      ? "border-primary bg-primary/10 text-primary shadow-xs"
                      : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                  )}
                >
                  {opt.id !== "custom" && (
                    <span
                      className="h-3.5 w-3.5 rounded-full border border-black/10 shadow-xs"
                      style={{ background: opt.preview }}
                    />
                  )}
                  {opt.label}
                </button>
              ))}

              {bgMode === "custom" && (
                <div className="flex items-center gap-1.5 ml-1">
                  <input
                    type="color"
                    value={customColor}
                    onChange={(e) => setCustomColor(e.target.value)}
                    className="h-8 w-10 cursor-pointer rounded-lg border border-border bg-transparent p-0.5"
                    title="选择自定义背景颜色"
                  />
                  <span className="text-xs font-mono text-muted-foreground">{customColor}</span>
                </div>
              )}
            </div>
          </div>

          {/* 前后效果比对滑块大视口 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground px-1">
              <span className="flex items-center gap-1.5 font-medium text-foreground">
                <ChevronsLeftRight size={14} className="text-primary" />
                左右拖动滑块，对比抠图前后细节
              </span>
              <span>左侧：抠图后主体 · 右侧：原始图片</span>
            </div>

            <div
              ref={containerRef}
              className="relative min-h-[380px] max-h-[580px] w-full rounded-2xl border border-border overflow-hidden select-none cursor-col-resize shadow-md"
              style={{ background: bgForPreview }}
              onMouseDown={onMouseDown}
              onTouchStart={onMouseDown}
            >
              {/* 抠图后（底层） */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={result.pngUrl}
                alt="抠图结果"
                className="w-full h-full object-contain block max-h-[580px]"
                draggable={false}
              />

              {/* 原图（上层，向右裁切） */}
              <div
                className="absolute inset-0 pointer-events-none"
                style={{ clipPath: `inset(0 0 0 ${sliderX}%)` }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={result.beforeUrl}
                  alt="原始图片"
                  className="w-full h-full object-contain block max-h-[580px] bg-background/20"
                  draggable={false}
                />
              </div>

              {/* 中缝中轴分割线 */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_12px_rgba(0,0,0,0.8)] pointer-events-none"
                style={{ left: `${sliderX}%`, transform: "translateX(-50%)" }}
              >
                {/* 中间圆形滑块手柄 */}
                <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex h-8 w-8 items-center justify-center rounded-full bg-white shadow-xl border border-gray-200">
                  <ChevronsLeftRight className="h-4 w-4 text-slate-800" />
                </div>
              </div>

              {/* 左右指示浮标 */}
              <span className="absolute bottom-3 left-3 rounded-lg bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur-xs pointer-events-none">
                抠图主体
              </span>
              <span className="absolute bottom-3 right-3 rounded-lg bg-black/60 px-2 py-0.5 text-[11px] font-semibold text-white backdrop-blur-xs pointer-events-none">
                原始原图
              </span>
            </div>
          </div>

          {/* 底部下载栏 */}
          <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
            <Button variant="outline" onClick={reset} className="gap-2 text-xs">
              <RotateCcw size={14} /> 重新上传图片
            </Button>

            <Button onClick={handleDownload} className="gap-2 px-8 font-semibold shadow-md">
              <Download size={16} />
              下载
              {bgMode === "transparent"
                ? "无损透明 PNG 图片"
                : `（${bgMode === "custom" ? customColor : BG_OPTIONS.find((b) => b.id === bgMode)?.label}）`}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

