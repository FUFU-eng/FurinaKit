"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { createUiText as __createUiText, useLanguage as __useLanguage } from "@/lib/language";

const __ui = __createUiText("components/tools/office-requirement-banner.tsx");

type OfficeApp = "word" | "excel" | "powerpoint";

/** 这些工具要借用电脑上已安装的 Microsoft Office 或 WPS 来转换文档 */
export const OFFICE_TOOL_NEEDS: Record<string, OfficeApp> = {
  "word-to-pdf": "word",
  "pdf-to-word": "word",
  "pdf-to-excel": "word",
  "excel-to-pdf": "excel",
  "pdf-to-ppt": "powerpoint",
  "ppt-to-pdf": "powerpoint",
  "ppt-to-images": "powerpoint",
};

const LABEL: Record<OfficeApp, string> = {
  word: "Word（或 WPS 文字）",
  excel: "Excel（或 WPS 表格）",
  powerpoint: "PowerPoint（或 WPS 演示）",
};

export function OfficeRequirementBanner({ toolId }: { toolId: string }) {
  __useLanguage();
  const need = OFFICE_TOOL_NEEDS[toolId];
  const [available, setAvailable] = useState<boolean | null>(null);

  const check = useCallback(async () => {
    try {
      const res = await fetch("/api/office/availability", { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || typeof data !== "object" || data === null) throw new Error();
      setAvailable(Boolean(data[need]));
    } catch {
      setAvailable(null);
    }
  }, [need]);

  useEffect(() => {
    if (need) void check();
  }, [need, check]);

  if (!need || available !== false) return null;

  return (
    <div role="alert" className="rounded-2xl border border-amber-500/40 bg-amber-500/5 p-3.5 dark:bg-amber-500/10">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-500">
            <AlertTriangle size={18} />
          </div>
          <div>
            <h4 className="text-[13px] font-bold text-foreground">{__ui("需要安装 Office 或 WPS")}</h4>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {__ui("这个功能要借用电脑上的")} {__ui(LABEL[need])} {__ui("来转换文档，但这台电脑上没有检测到。请先安装 Microsoft Office 或 WPS Office（免费版即可），装好后点右边的刷新按钮。")}
            </p>
          </div>
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="h-8 w-8 shrink-0 p-0 text-muted-foreground hover:text-foreground"
          onClick={() => void check()}
          title={__ui("重新检测")}
        >
          <RefreshCw size={12} />
        </Button>
      </div>
    </div>
  );
}
