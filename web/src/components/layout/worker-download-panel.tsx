"use client";
import { useState } from "react";
import { Cpu, Download, Layers, Wrench, Loader2 } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { getToolById } from "@furinakit/shared";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/primitives";
import { tr, useLanguage } from "@/lib/language";
import { getWorkerCatalog, getWorkerOperation, workerDownloadAction, operationBusy, canStartDownload } from "@/lib/worker-download-contract";
export function WorkerDownloadPanel() {
  useLanguage();
  const { colors } = useTheme();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const catalog = useQuery({ queryKey: ["worker-download-catalog"], queryFn: getWorkerCatalog, retry: false, staleTime: 30000 });
  const state = useQuery({ queryKey: ["worker-download-operation"], queryFn: getWorkerOperation, retry: false, refetchInterval: q => operationBusy(q.state.data) ? 1000 : 5000, refetchOnWindowFocus: true });
  const candidate = catalog.data?.component;
  const op = state.data?.operation;
  const busy = operationBusy(state.data);
  const unknown = catalog.isPending || state.isPending || !!catalog.error || !!state.error;
  const act = async (action: "download" | "cancel") => {
    setPending(true); setError("");
    try { await workerDownloadAction(action, op?.id || undefined); if (action === "download") setConfirmed(false); }
    catch (e) { setError(String(e)); }
    finally { await state.refetch(); setPending(false); }
  };
  const stage = op?.stage === "manifest" ? tr("正在下载并校验组件清单", "Downloading and verifying manifest")
    : op?.stage === "archive" ? tr("正在下载并校验组件包", "Downloading and verifying package")
    : op?.stage === "install" ? tr("正在校验解压内容并安装", "Verifying extracted content and installing")
    : tr("任务已受理，等待处理", "Task accepted; waiting for processing");
  const message = state.isPending || state.error ? tr("任务状态未确认；请刷新，不要据此重复下载", "Operation status unknown; refresh rather than resubmitting")
    : op?.phase === "cancelling" ? tr("已请求取消，等待后台任务结束；尚未确认取消完成", "Cancellation requested; waiting for the task, not confirmed complete")
    : busy ? (op?.kind === "local-import" ? tr("同一扩展的本地导入正在进行", "A local import of the same extension is running") : stage)
    : op?.phase === "succeeded" ? tr("本次组件安装成功；工具就绪仍需自检，不代表永久完整性", "This component installation succeeded; diagnostics are still required for tool readiness")
    : op?.phase === "failed" ? tr("本次任务未完成；文件保留，可确认错误后手动重试", "This attempt did not complete; files retained, retry manually after reviewing the error")
    : tr("本次会话尚无任务记录；不代表组件未安装", "No operation in this session; existing installation is not determined");
  return <article id="model-python-worker-shared" tabIndex={-1} className="group min-w-0 scroll-mt-6 rounded-3xl border p-5 transition-all hover:shadow-md hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50" style={{ background: colors.card, borderColor: colors.borderSolid }}>
    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3.5 border-b" style={{ borderColor: colors.border }}>
      <div className="flex items-center gap-3.5 min-w-0">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border shadow-xs bg-sky-500/10 text-sky-500 dark:text-sky-400 border-sky-500/20"><Cpu size={20} /></div>
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2">
          <h3 className="text-[14.5px] font-bold tracking-tight break-words" style={{ color: colors.text }}>{tr("共享 Python 处理扩展", "Shared Python processing extension")}</h3>
          {!catalog.error && candidate && <span title={tr("开发候选下载大小，非安装占用", "Candidate download size, not installed usage")} className="rounded-lg bg-muted/60 border border-border/50 px-2 py-0.5 font-mono text-[11px] font-bold text-foreground/80">{(candidate.candidateArchiveBytes / 1048576).toFixed(0)} MiB</span>}
          <span className="rounded-lg border px-2.5 py-0.5 text-[11px] font-medium" style={{ borderColor: colors.borderSolid, background: colors.bg, color: colors.muted }}>{unknown ? tr("状态待确认", "Status unknown") : busy ? tr("任务进行中", "In progress") : !candidate?.downloadAvailable ? tr("下载源待配置", "Source not configured") : tr("按需下载", "On demand")}</span>
        </div></div>
      </div>
      <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
        <Button type="button" size="sm" className="h-9 gap-1.5 rounded-xl bg-sky-500 px-4 text-xs font-bold text-white hover:bg-sky-400" disabled={!canStartDownload(catalog.data, state.data, true, pending, unknown)} onClick={() => setConfirmOpen(true)}><Download size={14} />{op?.phase === "failed" ? tr("重新下载", "Retry download") : tr("下载组件", "Download component")}</Button>
      </div>
    </div>
    <div className="pt-3"><div className="flex items-center gap-2.5 text-[12.5px] leading-relaxed">
      <span className="inline-flex items-center justify-center shrink-0 rounded-md bg-sky-500/10 text-sky-500 dark:text-sky-400 px-2 py-0.5 text-[11px] font-bold">{tr("实用功能", "Use case")}</span>
      <span className="text-foreground/90 font-medium">{tr("为文档转换等工具提供共享处理环境，用时单独下载，不增加基础安装包体积。", "Shared processing environment for document conversion and other tools. Download separately without increasing the base installer.")}</span>
    </div></div>
    <div className="mt-3.5 pt-3 border-t flex flex-col items-start gap-3" style={{ borderColor: colors.border }}>
      <div className="flex flex-wrap items-start gap-1.5 min-w-0 w-full">
        <span className="text-[11.5px] font-semibold text-muted-foreground shrink-0 flex items-center gap-1"><Wrench size={11} />{tr("涉及工具：", "Tools:")}</span>
        <div className="flex flex-wrap items-center gap-1.5 min-w-0 flex-1 py-0.5" style={{ flexShrink: 1 }}>{["pdf-to-word", "pdf-to-excel", "pdf-to-ppt"].map(id => getToolById(id)).filter(Boolean).map(tool => <span key={tool!.id} className="inline-flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-0.5 text-[11px] font-medium" style={{ borderColor: colors.borderSolid, background: colors.bg, color: colors.text }}><Layers size={10} className="text-sky-400" /><span>{tool!.name}</span></span>)}</div>
      </div>
      <div className="flex items-center gap-1 text-[11.5px] text-amber-500/90 font-medium min-w-0"><Cpu size={12} className="shrink-0 text-amber-500" /><span className="break-words leading-relaxed">{tr("算力：Windows x64 · 需求随工具而异", "Compute: Windows x64 · Requirements vary by tool")}{!catalog.error && candidate && <>{tr("；候选解压内容约 ", "; candidate extracted content ")}{(candidate.candidateContentBytes / 1048576).toFixed(0)} MiB{tr("，另需下载缓存空间", ", plus download cache")}</>}</span></div>
    </div>
    {confirmOpen && <div className="mt-3 rounded-xl border border-border bg-muted/30 p-3 text-xs leading-6">
      <label className="flex items-start gap-2"><input type="checkbox" className="mt-1 accent-primary" checked={confirmed} disabled={pending || busy || unknown} onChange={e => setConfirmed(e.target.checked)} />{tr("确认下载并安装独立组件；失败或取消可能保留缓存，重试会重新下载。", "Confirm installation; failed or cancelled attempts may retain cache. Retry downloads again.")}</label>
      <div className="mt-2 flex flex-wrap gap-2"><Button type="button" size="sm" className="rounded-xl text-xs" disabled={!canStartDownload(catalog.data,state.data,confirmed,pending,unknown)} onClick={() => void act("download")}>{tr("确认下载并安装", "Confirm download and install")}</Button><Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => {setConfirmOpen(false);setConfirmed(false);}}>{tr("收起", "Close")}</Button></div>
    </div>}
    {(busy || op?.phase === "failed" || op?.phase === "succeeded" || !!state.error) && <div className="mt-2.5 rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs leading-6"><p role="status" aria-live="polite">{message}</p>{busy && <Button type="button" size="sm" variant="outline" disabled={pending || !!state.error || state.isPending || !op?.id || !!op.cancelRequested} onClick={() => void act("cancel")}>{tr("请求取消", "Request cancellation")}</Button>}</div>}
    {busy && (
      <div className="mt-2.5 rounded-2xl bg-sky-500/5 dark:bg-sky-500/10 border border-sky-500/25 p-3 space-y-1.5">
        <div className="flex items-center justify-between text-[11.5px] font-medium">
          <span className="flex items-center gap-1.5 text-sky-600 dark:text-sky-400 font-semibold">
            <Loader2 size={13} className="animate-spin text-sky-500" />
            {stage}
          </span>
          <span className="font-mono text-foreground/80 font-bold text-[11px]">
            {op?.stage === "install" ? tr("解压与自检中…", "Installing...") : tr("下载中…", "Downloading...")}
          </span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted/80 border border-border/40">
          <div
            className={`h-full bg-gradient-to-r from-sky-500 to-primary transition-all duration-500 rounded-full ${op?.stage === "manifest" ? "w-1/4" : op?.stage === "archive" ? "w-2/3" : "w-11/12 animate-pulse"}`}
          />
        </div>
      </div>
    )}
    {(error || catalog.error || state.error || op?.error) && <p role="alert" className="mt-2 break-words text-xs text-destructive">{error || String(catalog.error || state.error || op?.error)}</p>}
    <details className="mt-3 text-xs text-muted-foreground"><summary className="w-fit cursor-pointer rounded-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary">{tr("下载与存储说明", "Download and storage details")}</summary>
      <p className="mt-2 leading-6">{tr("仅列出已核对处理入口的部分关联工具，不代表完整依赖清单或功能验收。开发候选大小不等于最终发布大小或磁盘占用。组件不在安装器中附带；不更新应用版本。", "Listed tools are a source-reviewed subset, not complete dependencies or functional acceptance. Candidate sizes are not final release or allocated disk usage. Not bundled; does not update the application version.")}</p>
      <p className="mt-2 leading-6">{!candidate?.downloadAvailable ? tr("尚未配置正式下载源，暂不可下载。", "No release source configured; download unavailable.") : tr("来源已配置，可用性仍以下载校验为准。", "Source configured; availability requires verified transfer.")}{!state.data?.enabled && tr("开发执行尚未启用。", "Development execution is disabled.")}{tr("安装状态未核定，不计入已安装或待下载统计，也不加入批量操作。关闭面板不会取消任务；重启不保留会话记录。", "Installation not determined: excluded from installed/missing counts and batch actions. Closing the panel does not cancel tasks; session records do not survive restart.")}</p>
      <Button type="button" size="sm" variant="outline" className="mt-2 rounded-xl text-xs" disabled={pending} onClick={() => {void catalog.refetch();void state.refetch();}}>{tr("刷新状态", "Refresh status")}</Button>
    </details>
  </article>;
}
