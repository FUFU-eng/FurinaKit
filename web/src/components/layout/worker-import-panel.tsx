"use client";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/primitives";
import { tr, useLanguage } from "@/lib/language";

type Operation = { id: string | null; phase: "idle" | "running" | "cancelling" | "succeeded" | "failed"; cancelRequested: boolean; error: string | null };
type Snapshot = { enabled: boolean; operation: Operation };
async function request(body?: unknown): Promise<Snapshot> {
  const response = await fetch("/api/worker-extension/import", body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok || data.ok === false || typeof data.enabled !== "boolean" || !data.operation || !["idle", "running", "cancelling", "succeeded", "failed"].includes(data.operation.phase)) throw new Error(data.error || "无法确认安装状态 / Import status unavailable");
  return data;
}
export function WorkerImportPanel() {
  useLanguage();
  const [archive, setArchive] = useState("");
  const [manifest, setManifest] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const query = useQuery({ queryKey: ["worker-offline-import"], queryFn: () => request(), retry: false, refetchInterval: q => q.state.data?.enabled === false ? false : 2000, refetchOnWindowFocus: true });
  const op = query.data?.operation;
  const busy = op?.phase === "running" || op?.phase === "cancelling";
  const unavailable = query.isPending || !!query.error;
  const act = async (body: unknown) => {
    setPending(true); setError("");
    try { await request(body); } catch (e) { setError(String(e)); }
    finally { await query.refetch(); setPending(false); }
  };
  const pick = async (kind: "archive" | "manifest") => {
    setError("");
    try {
      const selected = await invoke<string | null>("pick_file", { extensions: [kind === "archive" ? "zip" : "json"] });
      if (typeof selected === "string") { (kind === "archive" ? setArchive : setManifest)(selected); setConfirmed(false); }
    } catch (e) { setError(String(e)); }
  };
  // The development opt-in is a backend gate, not a checkbox that can bypass trust.
  if (query.data?.enabled === false && !query.error) return null;
  const label = op?.phase === "succeeded" ? tr("本次导入成功；工具功能就绪请运行自检", "This import succeeded; run diagnostics to check tool readiness")
    : op?.phase === "failed" ? tr("本次导入未完成；保留现场，不自动重试", "Import did not complete; retained files will not be retried automatically")
    : op?.phase === "cancelling" ? tr("已请求取消，等待安装任务结束；尚未确认取消", "Cancellation requested; waiting for the task, not yet confirmed")
    : op?.phase === "running" ? tr("正在校验、解压与提交，请勿重复安装", "Verifying, extracting and committing; do not submit again")
    : tr("本次应用会话尚无安装记录；不代表组件未安装", "No import record in this app session; existing installation status is unknown");
  return <details className="text-sm text-muted-foreground"><summary>{tr("开发验证入口（非普通下载流程）", "Developer verification (not the download workflow)")}</summary><section className="rounded-2xl border border-amber-500/30 p-5 space-y-3" aria-label={tr("离线处理扩展", "Offline processing extension")}>
    <h3 className="font-semibold">{tr("处理扩展 · 实验性本地导入", "Processing extension · Experimental local import")}</h3>
    <p className="text-sm text-muted-foreground">{tr("仅接受内置哈希对应的已审核 ZIP 与清单。不会下载、调用系统 Python、替换旧版本或自动删除文件；哈希不是发布者签名。此扩展不计入上方模型统计与批量操作。", "Only the audited ZIP and manifest matching compiled hashes are accepted. No download, system Python, overwrite or automatic deletion. Hashes are not publisher signatures. This extension is excluded from the model totals and batch actions above.")}</p>
    <div className="flex flex-wrap gap-2">
      <Button variant="outline" disabled={pending || busy || unavailable} onClick={() => void pick("archive")}>{tr("选择组件 ZIP", "Choose component ZIP")}</Button>
      <Button variant="outline" disabled={pending || busy || unavailable} onClick={() => void pick("manifest")}>{tr("选择校验清单", "Choose manifest")}</Button>
    </div>
    <p className="text-xs break-all select-all">ZIP: {archive || "—"}<br />JSON: {manifest || "—"}</p>
    <label className="flex gap-2 text-sm"><input type="checkbox" checked={confirmed} disabled={pending || busy} onChange={e => setConfirmed(e.target.checked)} />{tr("我确认导入上述本地文件；失败/取消可能保留暂存数据，重启后本次会话记录不保留。", "I confirm these local files. Failure/cancellation may retain staging data; this operation record does not survive app restart.")}</label>
    <div className="flex flex-wrap gap-2">
      <Button disabled={pending || busy || unavailable || !query.data?.enabled || !archive || !manifest || !confirmed} onClick={() => void act({ action: "start", archive, manifest, acknowledged: true })}>{tr("校验并导入", "Verify and import")}</Button>
      <Button variant="outline" disabled={pending || unavailable || !busy || !op?.id || op?.cancelRequested} onClick={() => void act({ action: "cancel", id: op?.id })}>{tr("请求取消", "Request cancellation")}</Button>
      <Button variant="outline" disabled={pending} onClick={() => void query.refetch()}>{tr("刷新状态", "Refresh status")}</Button>
    </div>
    <p role="status" aria-live="polite" className="text-sm">{unavailable ? tr("状态未确认；请刷新，勿据此重复安装", "Status unknown; refresh rather than resubmitting") : label}</p>
    {(error || query.error || op?.error) && <p role="alert" className="text-sm text-rose-500 break-words">{error || String(query.error || op?.error)}</p>}
    <p className="text-xs text-muted-foreground">{tr("需为组件内容另留 256 MiB 余量；空间检查不是预占。取消若晚于提交边界，仍可能导入成功。关闭此面板不会取消任务；重启后请用自检核实，不将空白记录视为失败。", "Allow 256 MiB headroom beyond payload; space is checked, not reserved. Cancellation after the commit boundary may still succeed. Closing this panel does not cancel the task. After restart, use diagnostics; an empty record does not prove failure.")}</p>
  </section></details>;
}
