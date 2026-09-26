export type WorkerCatalog = { schema: 1; delivery: string; bundledInBase: false; installerSelectablePayload: false; component: { id: string; downloadAvailable: boolean; status: string; installationState: string; candidateArchiveBytes: number; candidateContentBytes: number } };
export type WorkerOperation = { id: string | null; phase: "idle" | "running" | "cancelling" | "succeeded" | "failed"; kind: "none" | "local-import" | "download"; stage: "none" | "queued" | "manifest" | "archive" | "install" | "done" | "failed"; cancelRequested: boolean; error: string | null };
export type WorkerSnapshot = { enabled: boolean; operation: WorkerOperation };
export function decodeCatalog(data: any): WorkerCatalog {
  const c = data?.component;
  if (data?.schema !== 1 || data.delivery !== "settings-on-demand" || data.bundledInBase !== false || data.installerSelectablePayload !== false || c?.id !== "python-worker-shared" || !["source-not-configured", "source-configured", "invalid-source-policy"].includes(c.status) || c.downloadAvailable !== (c.status === "source-configured") || c.installationState !== "not-checked" || !Number.isSafeInteger(c.candidateArchiveBytes) || c.candidateArchiveBytes <= 0 || !Number.isSafeInteger(c.candidateContentBytes) || c.candidateContentBytes <= 0) throw new Error("组件交付信息未确认 / Invalid component catalog");
  return data;
}
export function decodeSnapshot(data: any): WorkerSnapshot {
  const o = data?.operation;
  if (typeof data?.enabled !== "boolean" || !o || !["idle", "running", "cancelling", "succeeded", "failed"].includes(o.phase) || !["none", "local-import", "download"].includes(o.kind) || !["none", "queued", "manifest", "archive", "install", "done", "failed"].includes(o.stage) || typeof o.cancelRequested !== "boolean" || !(o.error === null || typeof o.error === "string") || !(o.id === null || typeof o.id === "string" && o.id.length > 0) || o.phase !== "idle" && !o.id) throw new Error("任务状态未确认 / Invalid component operation");
  return data;
}
async function request(path: string, body?: unknown): Promise<unknown> {
  const response = await fetch(path, body === undefined ? { cache: "no-store" } : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json();
  if (!response.ok || data?.ok === false) throw new Error(data?.error || "组件请求失败 / Component request failed");
  return data;
}
export const getWorkerCatalog = async () => decodeCatalog(await request("/api/worker-extension/catalog"));
export const getWorkerOperation = async () => decodeSnapshot(await request("/api/worker-extension/download"));
export async function workerDownloadAction(action: "download" | "cancel", id?: string): Promise<WorkerSnapshot> {
  if (action === "cancel" && !id) throw new Error("缺少任务编号 / Missing operation ID");
  return decodeSnapshot(await request("/api/worker-extension/download", action === "download" ? { action, acknowledged: true } : { action, id }));
}
export const operationBusy = (s?: WorkerSnapshot) => s?.operation.phase === "running" || s?.operation.phase === "cancelling";
export function canStartDownload(c: WorkerCatalog | undefined, s: WorkerSnapshot | undefined, confirmed: boolean, pending: boolean, unknown: boolean): boolean {
  return !!c?.component.downloadAvailable && !!s?.enabled && confirmed && !pending && !unknown && !operationBusy(s);
}
