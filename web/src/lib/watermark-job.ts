export type WatermarkResult = { jobId: string; filename: string; message: string };

function check(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("已停止等待", "AbortError");
}
function pause(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    check(signal);
    const abort = () => { clearTimeout(timer); reject(new DOMException("已停止等待", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
async function jsonRequest(url: string, signal: AbortSignal, init?: RequestInit) {
  check(signal);
  const response = await fetch(url, { ...init, signal, cache: "no-store" });
  check(signal);
  const data = await response.json();
  check(signal);
  if (!response.ok) throw new Error(data.error || `请求失败（HTTP ${response.status}）`);
  return data;
}
export async function getWatermarkModel(signal: AbortSignal) {
  const data = await jsonRequest("/api/components", signal);
  const model = (Array.isArray(data.components) ? data.components : []).find((c: { id?: string }) => c.id === "lama-inpaint");
  return model?.downloaded && typeof model.filePath === "string" && model.filePath
    ? { ready: true as const, path: model.filePath }
    : { ready: false as const, path: "" };
}

/** This only waits for the owned job. Aborting a view never pretends to cancel worker execution. */
export async function submitWatermarkJob(form: FormData, signal: AbortSignal, onProgress: (text: string) => void): Promise<WatermarkResult> {
  const data = await jsonRequest("/api/tools/watermark-remove", signal, { method: "POST", body: form });
  const jobId = data.job?.id;
  if (typeof jobId !== "string" || !/^[a-f\d-]{1,64}$/i.test(jobId)) throw new Error("未能获取有效任务编号");
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    await pause(800, signal);
    const state = await jsonRequest(`/api/jobs/${encodeURIComponent(jobId)}`, signal);
    const job = state.job;
    if (!job || (job.id && job.id !== jobId)) throw new Error("任务返回的信息不匹配，请到任务中心查看");
    if (job.status === "completed") return { jobId, filename: typeof job.resultFilename === "string" && job.resultFilename ? job.resultFilename : "已去水印.png", message: String(job.message || "处理完成") };
    if (job.status === "failed") throw new Error(job.error || job.message || "处理失败");
    if (["cancelled", "canceled"].includes(job.status)) throw new Error("任务已取消");
    onProgress(`正在处理… ${Math.max(0, Math.min(100, Number(job.progress) || 0))}%`);
  }
  throw new Error("等待超过 2 分钟；任务可能仍在后台处理，请到任务中心查看，避免重复提交");
}
