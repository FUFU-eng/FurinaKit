"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/tool-model-downloader.tsx");

import { useCallback, useEffect, useState, useRef } from "react";
import { AlertCircle, Check, Settings2, RefreshCw, Download, Loader2, HardDrive } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { openModelSettings } from "@/lib/model-settings-navigation";

interface ModelStatus {
  id: string;
  name: string;
  size: number;
  purpose: string;
  downloaded: boolean;
  downloaded_bytes?: number;
  filePath?: string;
  busy?: boolean;
}

/** A single metadata source for every model-dependent generic tool. Directly downloadable in place. */
export function ToolModelDownloader({ ids }: { ids: string[] }) {
  const __locale = __useLanguage();
  const epoch = useRef(0);
  const key = ids.join("|");
  const [items, setItems] = useState<ModelStatus[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [downloadMsg, setDownloadMsg] = useState<string>("");

  const reload = useCallback(async () => {
    const request = ++epoch.current;
    try {
      const response = await fetch("/api/components", { cache: "no-store" });
      const data = await response.json();
      if (!response.ok || !Array.isArray(data.components)) {
        throw new Error(data.error || __ui("无法读取模型目录"));
      }
      if (request !== epoch.current) return;
      const wanted = key.split("|");
      setItems(data.components.filter((m: ModelStatus) => wanted.includes(m.id)));
      setError("");
    } catch (e) {
      if (request === epoch.current) {
        setError(e instanceof Error ? e.message : __ui("模型状态未知"));
      }
    } finally {
      if (request === epoch.current) setLoaded(true);
    }
  }, [key]);

  useEffect(() => {
    void reload();
    const refresh = () => void reload();
    window.addEventListener("furina:components-changed", refresh);
    const timer = setInterval(refresh, 3000);
    return () => {
      epoch.current++;
      clearInterval(timer);
      window.removeEventListener("furina:components-changed", refresh);
    };
  }, [reload]);

  useEffect(() => {
    if (!downloadingId) return;
    const timer = setInterval(() => void reload(), 800);
    return () => clearInterval(timer);
  }, [downloadingId, reload]);

  const handleDownload = async (id: string) => {
    setDownloadingId(id);
    setDownloadMsg(__ui("正在下载并配置引擎…"));
    try {
      const res = await fetch("/api/components", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action: "download" }),
      });
      const data = await res.json();
      if (!data.ok) {
        throw new Error(data.message || __ui("下载失败，请检查网络"));
      }
      await reload();
      window.dispatchEvent(new CustomEvent("furina:components-changed"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : __ui("下载异常");
      setError(msg);
    } finally {
      setDownloadingId(null);
      setDownloadMsg("");
    }
  };

  const activeItems = items.filter((item) => ids.includes(item.id));
  const hasMissing = activeItems.some((item) => !item.downloaded || !item.filePath);

  if (!loaded && activeItems.length === 0) {
    return null;
  }

  return (
    <div
      className={`rounded-2xl border transition-all p-3.5 ${
        hasMissing
          ? "border-amber-500/40 bg-amber-500/5 dark:bg-amber-500/10"
          : "border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-500/10"
      }`}
    >
      <div className="flex items-center justify-between gap-2 pb-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold">
          <HardDrive size={14} className={hasMissing ? "text-amber-500" : "text-emerald-500"} />
          <span>{hasMissing ? __ui("此工具依赖以下运行组件/引擎") : __ui("运行引擎已就绪")}</span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
          onClick={() => void reload()}
          aria-label={__ui("刷新状态")}
        >
          <RefreshCw size={11} />
        </Button>
      </div>

      {error ? (
        <p role="alert" className="text-xs text-destructive py-1">
          {__msg(error)}
        </p>
      ) : null}

      <div className="space-y-2">
        {activeItems.map((item) => {
          const ready = item.downloaded && !!item.filePath;
          const isDownloading = downloadingId === item.id;

          return (
            <div
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-background/80 px-3 py-2 border border-border/60 text-xs"
            >
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <span className={ready ? "text-emerald-500 shrink-0" : "text-amber-500 shrink-0"}>
                  {ready ? <Check size={14} strokeWidth={2.5} /> : <AlertCircle size={14} />}
                </span>
                <span className="font-medium text-foreground truncate" title={item.purpose}>
                  {item.name}
                </span>
                <span className="text-[11px] font-mono text-muted-foreground shrink-0">
                  ({(item.size / 1048576).toFixed(0)} MB)
                </span>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {ready ? (
                  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-2.5 py-1 rounded-md">
                    <Check size={12} strokeWidth={2.5} />
                    {__ui("引擎已下载")}
                  </span>
                ) : (
                  <Button
                    size="sm"
                    className="h-7.5 px-3 text-[11.5px] font-medium bg-sky-500 hover:bg-sky-400 text-white rounded-lg gap-1 shadow-xs"
                    disabled={isDownloading}
                    onClick={() => void handleDownload(item.id)}
                  >
                    {isDownloading ? (
                      <>
                        <Loader2 size={12} className="animate-spin" />
                        {__ui("正在下载…")}
                      </>
                    ) : (
                      <>
                        <Download size={12} />
                        {__ui("下载引擎")}
                      </>
                    )}
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
                  onClick={() => openModelSettings(item.id)}
                  title={__ui("在设置中管理此组件")}
                >
                  <Settings2 size={11} />
                  {__ui("管理")}
                </Button>
              </div>

              {/* 实时进度条 */}
              {(isDownloading || (!ready && (item.downloaded_bytes ?? 0) > 0 && isDownloading)) && (
                <div className="w-full mt-2 pt-2 border-t border-border/40 space-y-1">
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span className="flex items-center gap-1 text-sky-500 font-semibold">
                      <Loader2 size={11} className="animate-spin" />
                      {__ui("下载进度")}
                    </span>
                    <span className="font-mono">
                      {((item.downloaded_bytes || 0) / 1048576).toFixed(1)} MB / {(item.size / 1048576).toFixed(1)} MB ({item.size > 0 ? Math.min(100, Math.round(((item.downloaded_bytes || 0) / item.size) * 100)) : 0}%)
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted border border-border/40">
                    <div className="h-full bg-sky-500 transition-all duration-300 rounded-full" style={{ width: `${Math.max(item.size > 0 ? Math.min(100, Math.round(((item.downloaded_bytes || 0) / item.size) * 100)) : 0, 3)}%` }} />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {downloadMsg ? (
        <p className="mt-2 text-[11px] text-sky-500 flex items-center gap-1.5">
          <Loader2 size={12} className="animate-spin shrink-0" />
          {downloadMsg}
        </p>
      ) : null}
    </div>
  );
}
