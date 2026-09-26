"use client";
import { createUiText as __createUiText, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/watermark-model-notice.tsx");

import { useEffect, useState } from "react";
import { Download, CheckCircle2, RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useTheme } from "@/components/theme-provider";
import { getWatermarkModel } from "@/lib/watermark-job";
import { openModelSettings } from "@/lib/model-settings-navigation";
export function WatermarkModelNotice() {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  const [status, setStatus] = useState<"checking" | "ready" | "missing" | "error">("checking");
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const ctrl = new AbortController(); setStatus("checking");
    getWatermarkModel(ctrl.signal).then(model => { if (!ctrl.signal.aborted) setStatus(model.ready ? "ready" : "missing"); }).catch(() => { if (!ctrl.signal.aborted) setStatus("error"); });
    return () => ctrl.abort();
  }, [version]);
  useEffect(() => {
    const refresh = () => setVersion(n => n + 1);
    window.addEventListener("furina:components-changed", refresh);
    window.addEventListener("focus", refresh);
    return () => { window.removeEventListener("furina:components-changed", refresh); window.removeEventListener("focus", refresh); };
  }, []);
  return <div className="mt-3 rounded-xl border p-3" style={{ borderColor: colors.borderSolid, background: colors.bg }}>
    <p role="status" className="flex items-center gap-2 text-xs font-medium" style={{ color: colors.text }}>
      {status === 'checking' ? <Loader2 size={13} className="animate-spin" /> : status === 'ready' ? <CheckCircle2 size={13} style={{ color: colors.green }} /> : <Download size={13} />}
      {status === 'checking' ? __ui("正在检查 LaMa 模型…") : status === 'ready' ? __ui("LaMa 模型已下载") : status === 'error' ? __ui("暂时无法读取模型状态") : __ui("精细修复需要 LaMa 模型")}
    </p>
    <p className="mt-1.5 text-[11px] leading-5" style={{ color: colors.muted }}>{status === 'ready' ? __ui("模型已在本机，无需再次下载；处理无需联网，图片不会上传。") : status === 'missing' ? __ui("首次下载约 194 MiB，需要联网；下载完成后在本机处理。也可先用无需模型的内置修补。") : status === 'checking' ? __ui("正在核对本机模型文件，请稍候。") : __ui("未能确认本机模型状态，请刷新或在设置中检查；不会自动下载。")}</p>
    <div className="mt-2 flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={() => openModelSettings('lama-inpaint')}><Download size={12} />{status === 'ready' ? __ui("管理模型") : status === 'missing' ? __ui("下载模型") : __ui("查看模型设置")}</Button><Button size="sm" variant="ghost" aria-label={__ui("刷新模型状态")} disabled={status === 'checking'} onClick={() => setVersion(n => n + 1)}><RefreshCw size={12} /></Button></div>
  </div>;
}
