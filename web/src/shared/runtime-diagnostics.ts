/** Read-only diagnostics. Presence, pinned integrity, engine execution and acceptance are distinct. */
export type DiagnosticStatus = "present" | "missing" | "unknown";
export interface DiagnosticRow { id: string; label: string; labelEn: string; required: boolean | null; status: DiagnosticStatus; componentId: string | null; note: string; }
export interface DiagnosticReport { runtime: "native-rust" | "legacy-compatible"; rows: DiagnosticRow[]; requiredPresent: boolean; missingRequired: number; missingOptional: number; unknown: number; workerTreeVerified: boolean; bundledUpscaleVerified: boolean; }
const EXPECTED = ["image-worker", "python-worker", "ffmpeg", "aria2", "whisper", "upscale-engine", "upscale-models"];
const message = "自检响应不完整或不兼容；未确认任何修复。 / Incomplete or incompatible diagnostics response; no repair verified.";
function record(value: unknown): Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
export function parseDiagnostics(value: unknown): DiagnosticReport {
  const data = record(value);
  if (data.ok !== true || data.schemaVersion !== 2 || (typeof data.runtime !== "string" || !["native-rust", "legacy-compatible"].includes(data.runtime)) || (typeof data.verification !== "string" || !["file-presence-only", "file-presence-with-pinned-worker-tree"].includes(data.verification)) || data.dataModified !== false || data.repaired !== false || data.enginesExecuted !== false || data.purged !== 0 || !Array.isArray(data.checks) || data.checks.length > 32) throw new Error(message);
  const ids = new Set<string>();
  const rows: DiagnosticRow[] = data.checks.map((value: unknown) => {
    const item = record(value);
    if (typeof item.id !== "string" || item.id.length > 80 || ids.has(item.id) || typeof item.label !== "string" || typeof item.labelEn !== "string" || item.label.length > 200 || item.labelEn.length > 200) throw new Error(message);
    ids.add(item.id);
    return { id: item.id, label: item.label, labelEn: item.labelEn, required: typeof item.required === "boolean" ? item.required : null,
      status: item.status === "present" || item.status === "missing" ? item.status : "unknown", componentId: typeof item.componentId === "string" ? item.componentId : null, note: typeof item.note === "string" ? item.note.slice(0, 2000) : "" };
  });
  if (!EXPECTED.every(id => ids.has(id))) throw new Error(message);
  // Requiredness is a contract, not a truthy default supplied by a partial response.
  for (const id of ["aria2", "whisper", data.runtime === "native-rust" ? "image-worker" : "python-worker"]) if (rows.find(row => row.id === id)?.required !== true) throw new Error(message);
  const worker = rows.find(row => row.id === "python-worker")!;
  const workerRecord = record(data.checks.find((value: unknown) => record(value).id === "python-worker"));
  const experimental = data.verification === "file-presence-with-pinned-worker-tree";
  if (experimental) {
    if (data.workerSelection !== "experimental-pinned" || typeof data.workerIntegrityVerified !== "boolean" || (worker.status === "present") !== data.workerIntegrityVerified || workerRecord.verification !== (data.workerIntegrityVerified ? "pinned-tree-sha256" : "unverified")) throw new Error(message);
  } else if (data.workerIntegrityVerified === true || (data.workerSelection !== undefined && data.workerSelection !== "legacy")) throw new Error(message);
  if (data.upscaleSelection !== undefined && (typeof data.upscaleSelection !== "string" || !["legacy", "experimental-pinned", "bundled-lite"].includes(data.upscaleSelection))) throw new Error(message);
  const bundled = data.upscaleSelection === "bundled-lite";
  if (bundled) {
    if (typeof data.upscaleIntegrityVerified !== "boolean" || typeof data.upscaleResourceFilesPresent !== "boolean"
      || data.upscaleEngineExecuted !== false || data.upscaleFunctionAccepted !== false || data.upscalePublisherAuthenticated !== false) throw new Error(message);
    if (rows.find(row => row.id === "image-worker")?.required !== true) throw new Error(message);
    for (const id of ["upscale-engine", "upscale-models"]) {
      const row = rows.find(value => value.id === id)!;
      const raw = record(data.checks.find((value: unknown) => record(value).id === id));
      if (row.required !== true || row.componentId !== "bundled-upscale-lite-v1"
        || (row.status === "present") !== data.upscaleIntegrityVerified
        || raw.verification !== (data.upscaleIntegrityVerified ? "pinned-sha256" : "unverified")) throw new Error(message);
    }
    if (data.upscaleIntegrityVerified && !data.upscaleResourceFilesPresent) throw new Error(message);
  }
  const required = rows.filter(row => row.required === true);
  return { runtime: data.runtime as DiagnosticReport["runtime"], rows, workerTreeVerified: experimental && data.workerIntegrityVerified === true, bundledUpscaleVerified: bundled && data.upscaleIntegrityVerified === true, requiredPresent: required.length > 0 && required.every(row => row.status === "present") && rows.every(row => row.required !== null), missingRequired: required.filter(row => row.status === "missing").length, missingOptional: rows.filter(row => row.required === false && row.status === "missing").length, unknown: rows.filter(row => row.status === "unknown" || row.required === null).length };
}
export async function requestDiagnostics(fetcher: typeof fetch = fetch, timeoutMs = 30_000): Promise<DiagnosticReport> {
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // The native fetch bridge might not support abort; race still bounds the UI's waiting time.
    const result = await Promise.race([
      (async () => { const response = await fetcher("/api/system/scan", { method: "POST", signal: controller.signal }); if (!response.ok) throw new Error(`自检请求失败 / Diagnostics request failed: HTTP ${response.status}`); return parseDiagnostics(await response.json()); })(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error("自检超时，未确认修复。 / Diagnostics timed out; no repair verified.")); }, timeoutMs); }),
    ]);
    return result;
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
