/** A cancel acknowledgement is not completion: keep observing the owned job until terminal. */
export const isUpscaleCancelledStatus = (status: unknown): boolean =>
  status === "cancelled" || status === "canceled";

export const isUpscaleTerminalStatus = (status: unknown): boolean =>
  status === "completed" || status === "failed" || isUpscaleCancelledStatus(status);

export class UpscaleJobCancelledError extends Error {
  constructor() {
    super("任务已取消");
    this.name = "UpscaleJobCancelledError";
  }
}

export interface UpscaleJobWaitOptions {
  isCancelled: () => boolean;
  fetcher?: typeof fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  timeoutMs?: number;
  requestTimeoutMs?: number;
  pollIntervalMs?: number;
}

/** The caller must retain the create response/job ID, including when cancelled during submission. */
export async function waitForUpscaleJob(jobId: string, options: UpscaleJobWaitOptions): Promise<Blob> {
  if (typeof jobId !== "string" || !jobId.trim()) throw new Error("未能获取到任务编号");
  const fetcher = options.fetcher ?? fetch;
  const sleep = options.sleep ?? (milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)));
  const now = options.now ?? Date.now;
  const deadline = now() + (options.timeoutMs ?? 10 * 60 * 1000);
  const interval = options.pollIntervalMs ?? 1000;
  const requestTimeout = options.requestTimeoutMs ?? 15000;
  const url = `/api/jobs/${encodeURIComponent(jobId)}`;
  let terminal = false;
  let cancelAcknowledged = false;
  let cancelAttempts = 0;

  // The IPC fetch adapter may not honour AbortSignal. Race the whole response/body
  // operation as well; late reads cannot create an object URL or publish a UI result.
  async function bounded<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error("任务响应超时，请在任务中心确认状态 / Job response timed out; check Tasks"));
        controller.abort();
      }, requestTimeout);
    });
    try {
      return await Promise.race([operation(controller.signal), timeout]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async function requestCancellation(): Promise<void> {
    if (cancelAcknowledged || cancelAttempts >= 3) return;
    cancelAttempts++;
    try {
      const accepted = await bounded(async signal => {
        const response = await fetcher(`${url}/cancel`, { method: "POST", signal });
        return response.ok;
      });
      cancelAcknowledged = accepted;
    } catch {
      // A failed POST must not be reported as cancellation. Retry a bounded number
      // of times while continuing to observe the job's actual terminal state.
    }
  }

  try {
    while (now() < deadline) {
      if (options.isCancelled()) await requestCancellation();
      const job = await bounded(async signal => {
        const response = await fetcher(url, { cache: "no-store", signal });
        if (!response.ok) throw new Error(`无法读取强化任务 (${response.status}) / Cannot read upscale job`);
        const data = await response.json();
        const value = data?.job ?? data;
        if (!value || typeof value.status !== "string") throw new Error("强化任务状态无效 / Invalid upscale job state");
        return value as { status: string; error?: string };
      });
      terminal = isUpscaleTerminalStatus(job.status);
      if (isUpscaleCancelledStatus(job.status)) throw new UpscaleJobCancelledError();
      if (job.status === "failed") throw new Error(job.error || "超分计算失败");
      if (job.status === "completed") {
        if (options.isCancelled()) throw new UpscaleJobCancelledError();
        const blob = await bounded(async signal => {
          const response = await fetcher(`${url}/download`, { signal });
          if (!response.ok) throw new Error("下载超分结果失败");
          return response.blob();
        });
        if (options.isCancelled()) throw new UpscaleJobCancelledError();
        return blob;
      }
      await sleep(Math.min(interval, Math.max(0, deadline - now())));
    }
    throw new Error("强化等待超时，已尝试取消；请在任务中心确认状态 / Upscale timed out; cancellation attempted, check Tasks");
  } catch (error) {
    if (!terminal) await requestCancellation();
    throw error;
  }
}
