export function normalizeOcrLineEndings(text: string) { return text.replace(/\r\n?/g, "\n"); }
export function splitTranslationParagraphs(text: string) {
  return normalizeOcrLineEndings(text).split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
}
export type OcrFormat = "txt" | "md" | "json";
export function checkAbort(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("操作已停止", "AbortError");
}
export function imageBlob(dataUrl: string): Blob {
  const [head, body] = dataUrl.split(",", 2);
  if (!head?.startsWith("data:image/") || !head.endsWith(";base64") || !body) throw new Error("截图数据无效");
  const binary = atob(body), bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: head.slice(5, -7) });
}
function wait(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    checkAbort(signal);
    const abort = () => { clearTimeout(timer); reject(new DOMException("操作已停止", "AbortError")); };
    const timer = setTimeout(() => { signal.removeEventListener("abort", abort); resolve(); }, ms);
    signal.addEventListener("abort", abort, { once: true });
  });
}
/** Read the real UTF-8 artifact. A job's message is a progress summary, NEVER OCR text. */
export async function recognizeScreenshot(blob: Blob, format: OcrFormat, signal: AbortSignal, onProgress: (message: string) => void, strictness = "standard") {
  checkAbort(signal);
  const fd = new FormData(); fd.append("file", blob, "screenshot.png"); fd.append("format", format); fd.append("strictness", strictness);
  const response = await fetch("/api/tools/ocr-image", { method: "POST", body: fd, signal });
  checkAbort(signal);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `创建识别任务失败（HTTP ${response.status}）`);
  const id = data.job?.id;
  if (typeof id !== "string" || !id) throw new Error("识别任务未返回有效编号");
  const path = `/api/jobs/${encodeURIComponent(id)}`;
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    await wait(700, signal);
    const response = await fetch(path, { cache: "no-store", signal });
    checkAbort(signal);
    const data = await response.json();
    checkAbort(signal);
    if (!response.ok) throw new Error(data.error || `读取识别任务失败（HTTP ${response.status}）`);
    const job = data.job ?? data;
    if (job.status === "completed") {
      const output = await fetch(`${path}/download`, { cache: "no-store", signal });
      if (!output.ok) throw new Error(`读取识别结果失败（HTTP ${output.status}），可到任务中心查看产物`);
      const content = normalizeOcrLineEndings((await output.text()).replace(/^\uFEFF/, ""));
      checkAbort(signal);
      if (format === "json") {
        const parsed = JSON.parse(content);
        if (typeof parsed.text !== "string" || !Array.isArray(parsed.lines)) throw new Error("识别结果结构无效");
        return { content: JSON.stringify(parsed, null, 2), plainText: parsed.text as string, message: String(job.message || ""), jobId: id };
      }
      return { content, plainText: content, message: String(job.message || ""), jobId: id };
    }
    if (job.status === "failed") throw new Error(job.error || job.message || "识别失败");
    if (["cancelled", "canceled"].includes(job.status)) throw new Error("识别任务已取消");
    onProgress(`正在本机识别… ${Math.max(0, Math.min(100, Number(job.progress) || 0))}%`);
  }
  throw new Error("识别等待超过 2 分钟；任务可能仍在后台运行，请到任务中心查看，不要重复提交");
}
