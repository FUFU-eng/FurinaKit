"use client";
import React, { useState } from "react";
import { X, CheckCircle2, Loader2, AlertTriangle, CircleHelp } from "lucide-react";
import { useLanguage } from "@/lib/language";
import { useEscapeDismiss } from "@/lib/use-escape-dismiss";
import { requestDiagnostics, type DiagnosticReport } from "@/shared/runtime-diagnostics";

interface RepairModalProps { open: boolean; onClose: () => void; }
export function RepairModal({ open, onClose }: RepairModalProps) {
  const language = useLanguage();
  const text = (zh: string, en: string) => language === "en" ? en : zh;
  const [phase, setPhase] = useState<"confirm" | "scanning" | "finished" | "error">("confirm");
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [error, setError] = useState("");
  const close = () => { if (phase === "scanning") return; setPhase("confirm"); setReport(null); setError(""); onClose(); };
  useEscapeDismiss(close, open, 100);
  if (!open) return null;
  const scan = async () => {
    setReport(null); setError(""); setPhase("scanning");
    try { setReport(await requestDiagnostics()); setPhase("finished"); }
    catch (error) { setError(error instanceof Error ? error.message : text("自检失败；没有确认任何修复。", "Diagnostics failed; no repair verified.")); setPhase("error"); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.65)", backdropFilter: "blur(5px)" }} onClick={close}>
      <div role="dialog" aria-modal="true" aria-label={text("环境自检与修复", "Environment diagnostics and repair")} aria-busy={phase === "scanning"} className="relative w-full max-w-[540px] max-h-[85vh] overflow-y-auto rounded-2xl border border-white/10 bg-[#1c2026] p-6 text-white shadow-2xl" onClick={event => event.stopPropagation()}>
        {phase !== "scanning" && <button type="button" onClick={close} aria-label={text("关闭", "Close")} className="absolute top-4 right-4 flex h-7 w-7 items-center justify-center rounded-lg text-white/50 hover:bg-white/10"><X size={18} /></button>}
        {phase === "confirm" && <div className="space-y-5">
          <h3 className="text-[17px] font-bold">{text("环境自检", "Environment diagnostics")}</h3>
          <p className="text-sm leading-relaxed text-white/70">{text("检查当前运行方式和必需、可选组件文件是否存在。本次仅只读检查：不会删除历史、设置、结果或缓存，不会自动下载、安装或修复，也不会运行引擎。", "Check the current runtime and the presence of required and optional component files. This read-only check does not delete history, settings, results or caches, download or install components, repair files, or run engines.")}</p>
          <p className="text-xs text-white/50">{text("一般项目检查文件存在；内置动漫 2x/3x 和显式选择的实验 Python 扩展额外校验固定内容清单，但不代表发行者认证、Vulkan 可用或功能验收。可选组件未安装不表示原生核心损坏。", "Most checks inspect file presence. Bundled anime 2x/3x and explicitly selected experimental Python extensions also receive pinned content verification, not publisher authentication, Vulkan readiness or functional acceptance. Missing optional components do not mean the native core is damaged.")}</p>
          <div className="flex justify-end gap-3"><button type="button" onClick={close} className="h-10 rounded-xl bg-white/10 px-5">{text("取消", "Cancel")}</button><button type="button" onClick={scan} className="h-10 rounded-xl bg-[#ffd027] px-5 font-bold text-neutral-900">{text("开始自检", "Run diagnostics")}</button></div>
        </div>}
        {phase === "scanning" && <div className="space-y-5 py-5" role="status"><div className="flex items-center gap-3"><Loader2 size={25} className="animate-spin text-[#ffd027]" /><h3 className="font-bold">{text("正在读取本机组件状态…", "Reading local component status…")}</h3></div><p className="text-sm text-white/60">{text("只读检查，不修改文件。最多等待 30 秒。", "Read-only check; files are not modified. Waiting up to 30 seconds.")}</p><div className="h-2 rounded-full bg-white/10 overflow-hidden"><div className="h-full w-1/3 animate-pulse bg-[#ffd027]" /></div></div>}
        {phase === "error" && <div className="space-y-5" role="alert"><div className="flex items-center gap-3 text-amber-300"><AlertTriangle size={24} /><h3 className="font-bold">{text("自检未完成", "Diagnostics did not complete")}</h3></div><p className="break-words text-sm text-white/70">{error}</p><p className="text-xs text-white/50">{text("不能据此判断环境健康；没有确认任何修复。", "Environment health cannot be inferred from this result; no repair was verified.")}</p><div className="flex justify-end gap-3"><button type="button" onClick={close} className="h-10 rounded-xl bg-white/10 px-5">{text("关闭", "Close")}</button><button type="button" onClick={scan} className="h-10 rounded-xl bg-[#ffd027] px-5 font-bold text-neutral-900">{text("重试", "Retry")}</button></div></div>}
        {phase === "finished" && report && <div className="space-y-4">
          <h3 className="pr-8 text-[17px] font-bold">{text("只读自检完成", "Read-only diagnostics completed")}</h3>
          <p className="text-sm text-white/70" role="status">{report.unknown > 0 ? text("部分检查结果未知，请查看下方详情。", "Some checks are unknown; review the details below.") : report.missingRequired > 0 ? text("发现必需文件缺失。请保留数据并使用可信安装包修复。", "Required files are missing. Preserve your data and use a trusted installer to repair the installation.") : text("已发现必需文件。尚未运行引擎或验证工具功能。", "Required files were found. Engines and tool functionality have not been tested.")}</p>
          <p className="text-xs text-white/50">{report.runtime === "native-rust" ? text("当前：原生 Rust；核心不要求 Python。", "Runtime: native Rust; the core does not require Python.") : text("当前：旧版兼容运行方式。", "Runtime: legacy-compatible.")}</p>
          <div className="rounded-xl border border-white/10 bg-black/20 px-3 divide-y divide-white/5">
            {report.rows.map(row => <div key={row.id} className="py-3 text-xs">
              <div className="flex items-start justify-between gap-4"><span className="text-white/80">{language === "en" ? row.labelEn : row.label}<span className="block mt-1 text-white/40">{row.required === true ? text("必需文件", "Required files") : row.required === false ? text("可选组件", "Optional component") : text("要求未知", "Requirement unknown")}</span></span>
                <span className={`flex shrink-0 items-center gap-1 ${row.status === "present" ? "text-emerald-400" : row.status === "missing" && row.required === true ? "text-red-300" : "text-amber-300"}`}>
                  {row.status === "present" ? <CheckCircle2 size={13} /> : row.status === "missing" ? <AlertTriangle size={13} /> : <CircleHelp size={13} />}
                  {row.status === "present" ? text("已发现文件", "Files found") : row.status === "missing" ? row.required === true ? text("缺失", "Missing") : text("未发现", "Not found") : text("未验证", "Unknown")}
                </span></div>
              {row.status === "missing" && row.componentId === "ffmpeg" && <p className="mt-2 text-white/50">{text("需要音视频功能时，可在「设置 → 组件管理」主动下载安装。", "Install this component from Settings → Components when media features are needed.")}</p>}
              {row.note && <p className="mt-2 text-white/50 break-words">{row.note}</p>}
            </div>)}
          </div>
          <p className="text-xs leading-relaxed text-white/50">{text("本次没有删除、下载、安装或修复任何文件。内置超分和明确标注的实验扩展检查固定内容，其余项目检查文件存在；均不代表发行者认证、引擎执行或完整功能验收通过。", "No files were deleted, downloaded, installed or repaired. Bundled upscaling and explicitly marked experimental extensions receive pinned content verification; other checks inspect file presence. Neither verifies publisher authenticity, engine execution or full functionality.")}</p>
          <div className="flex justify-end"><button type="button" onClick={close} className="h-10 rounded-xl bg-[#ffd027] px-6 font-bold text-neutral-900">{text("完成", "Done")}</button></div>
        </div>}
      </div>
    </div>
  );
}
