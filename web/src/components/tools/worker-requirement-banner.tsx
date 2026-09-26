"use client";

import { useEffect, useState, useCallback } from "react";
import { Check, Download, Settings2, RefreshCw, Cpu } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { createUiText as __createUiText, useLanguage as __useLanguage } from "@/lib/language";
import type { OmniTool } from "@furinakit/shared";

const __ui = __createUiText("components/tools/worker-requirement-banner.tsx");

export const WORKER_DEPENDENT_TOOL_IDS = new Set([
  "ai-outpaint",
  "colorize-photo",
  "audio-denoise",
  "vocal-separate",
]);

interface WorkerCatalogResponse {
  schema?: number;
  component?: {
    id: string;
    name: string;
    installed?: boolean;
    downloadAvailable?: boolean;
    candidateArchiveBytes?: number;
    candidateContentBytes?: number;
    status?: string;
  };
}

export function WorkerRequirementBanner({ tool }: { tool: OmniTool }) {
  __useLanguage();
  const [loading, setLoading] = useState(true);
  const [installed, setInstalled] = useState<boolean | null>(null);
  const [, setError] = useState<string | null>(null);

  const checkStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/worker-extension/catalog", { cache: "no-store" });
      if (!res.ok) throw new Error("无法读取组件状态");
      const data: WorkerCatalogResponse = await res.json();
      setInstalled(Boolean(data.component?.installed));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "状态检查异常");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void checkStatus();
    const handler = () => void checkStatus();
    window.addEventListener("furina:components-changed", handler);
    return () => window.removeEventListener("furina:components-changed", handler);
  }, [checkStatus]);

  if (loading && installed === null) {
    return null;
  }

  const navigateToDownload = () => {
    if (typeof window !== "undefined") {
      window.location.href = "/settings?tab=components#model-python-worker-shared";
    }
  };

  if (installed) {
    return (
      <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-500/10 px-4 py-2.5 transition-all">
        <div className="flex items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-medium">
            <Check size={14} strokeWidth={2.5} />
            <span>{__ui("运行扩展已就绪（共享 Python 处理环境）")}</span>
          </div>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={navigateToDownload}
          >
            <Settings2 size={11} className="mr-1" />
            {__ui("管理组件")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-amber-500/40 bg-amber-500/5 dark:bg-amber-500/10 p-3.5 transition-all">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start sm:items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-500 dark:text-amber-400">
            <Cpu size={18} />
          </div>
          <div>
            <h4 className="text-[13px] font-bold text-foreground flex items-center gap-2">
              <span>{__ui("此工具依赖「共享 Python 处理扩展」组件")}</span>
              <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-medium text-amber-600 dark:text-amber-400">
                {__ui("尚未安装")}
              </span>
            </h4>
            <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">
              {__ui("AI 深度学习等进阶功能需要该共享扩展环境提供模型推理支持。请在设置中完成组件安装后即可正常使用。")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
          <Button
            size="sm"
            className="h-8 gap-1.5 rounded-xl bg-sky-500 px-3.5 text-xs font-bold text-white hover:bg-sky-400 shadow-xs active:scale-95"
            onClick={navigateToDownload}
          >
            <Download size={13} />
            {__ui("前往设置中心安装")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8 w-8 p-0 text-muted-foreground hover:text-foreground"
            onClick={() => void checkStatus()}
            title={__ui("刷新状态")}
          >
            <RefreshCw size={12} />
          </Button>
        </div>
      </div>
    </div>
  );
}
