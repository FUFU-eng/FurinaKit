"use client";
import { createUiText as __createUiText, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/embedded-video-downloader.tsx");


import { useEffect, useState, useRef } from "react";
import { AlertCircle, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

import { useDownloadSite } from "./use-download-site";

const DOWNLOAD_SITE = "https://dy.kukutool.com/";

/** A normal DOM iframe keeps application dialogs above the third-party page. */
export function EmbeddedVideoDownloader() {
  const __locale = __useLanguage();
  const { theme } = useTheme();
  const { toast } = useToast();
  const [darkFilter, setDarkFilter] = useState(true);
  const [revision, setRevision] = useState(0);
  const container=useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "loaded" | "slow" | "error">("loading");

  const native=useDownloadSite(container,revision,theme === "dark" && darkFilter,()=>setState("loaded"),()=>setState("error"));

  useEffect(() => {
    // A cross-origin iframe's load event cannot prove that the service is usable.
    // Timeout offers a fallback, rather than falsely reporting a successful load.
    const timer = window.setTimeout(() => setState(s => s === "loading" ? "slow" : s), 15000);
    return () => window.clearTimeout(timer);
  }, [revision]);

  const refresh = () => {
    setState("loading");
    setRevision(n => n + 1);
  };
  const openExternal = async () => {
    try {
      const bridge = (window as any).furinakit;
      if (bridge?.openExternal) await bridge.openExternal(DOWNLOAD_SITE);
      else window.open(DOWNLOAD_SITE, "_blank", "noopener,noreferrer");
    } catch {
      toast({ title: "无法打开浏览器", description: "请稍后重试", variant: "error" });
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border bg-card px-3.5 py-2.5 shadow-xs">
        <div className="flex min-w-0 items-center gap-2">
          <span className="text-sm font-semibold text-foreground">{__ui("通用视频下载")}</span>
          <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">dy.kukutool.com</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {theme === "dark" && (
            <button type="button" onClick={() => setDarkFilter(v => !v)} aria-pressed={darkFilter}
              className={cn("rounded-lg border px-2.5 py-1 text-xs transition-colors", darkFilter ? "border-primary/40 bg-primary/10 text-primary" : "border-border text-muted-foreground")}
              title={__ui("切换网页深色滤镜适配")}>{darkFilter ? __ui("深色适配已开启") : __ui("深色适配已关闭")}</button>
          )}
          <button type="button" onClick={refresh} title={__ui("刷新网页")} aria-label={__ui("刷新网页")} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><RefreshCw className="h-4 w-4" /></button>
          <button type="button" onClick={openExternal} title={__ui("在系统浏览器中打开")} aria-label={__ui("在系统浏览器中打开")} className="rounded-lg p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"><ExternalLink className="h-4 w-4" /></button>
        </div>
      </div>
      {(state === "slow" || state === "error") && (
        <div role="status" className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-foreground">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>{state === "error" ? __ui("网页加载失败。") : __ui("网页加载较慢。")}{__ui("若页面空白或下载无响应，可刷新或在系统浏览器中打开。")}</span>
          <button type="button" className="underline underline-offset-2" onClick={openExternal}>{__ui("打开浏览器")}</button>
        </div>
      )}
      <div ref={container} className="relative min-h-0 flex-1 overflow-hidden rounded-2xl border border-border bg-card">
        {state === "loading" && <div role="status" className="pointer-events-none absolute left-1/2 top-3 z-10 flex -translate-x-1/2 items-center gap-2 rounded-full border border-border bg-card/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm"><Loader2 className="h-4 w-4 animate-spin" />{__ui("正在加载网页…")}</div>}
        {!native && <iframe key={revision} src={DOWNLOAD_SITE} title={__ui("酷酷工具视频下载")}
          className="block h-full w-full border-0"
          sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox"
          allow="clipboard-write; fullscreen" referrerPolicy="strict-origin-when-cross-origin"
          onLoad={() => setState("loaded")} onError={() => setState("error")}
          style={{ filter: theme === "dark" && darkFilter ? "invert(0.9) hue-rotate(180deg)" : "none" }} />}
      </div>
    </div>
  );
}
