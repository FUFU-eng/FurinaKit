import { invoke } from "@tauri-apps/api/core";
import { ensureOutputDirectory,reportOutputSaved } from "./output-directory";
/** Native saves use Settings output directory; errors propagate without a fallback picker. */
export async function downloadJobResult(jobId: string, filename: string, artifact?: "ocr-text"): Promise<boolean> {
  if (!jobId) throw new Error("任务编号为空");
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    await ensureOutputDirectory();
    const receipt=await invoke<string>("save_job_result", { jobId, filename, artifact: artifact ?? null });
    if(typeof receipt!=="string"||!receipt)throw new Error("保存操作未返回有效文件路径，请重试");
    reportOutputSaved(receipt);
    return true;
  }
  if (artifact) throw new Error("附属文字请在桌面版保存 / Save companion text in the desktop app");
  const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/download`, { cache: "no-store" });
  if (!response.ok) throw new Error(`下载结果失败 (${response.status})`);
  const blob = await response.blob();
  if (!blob.size || /(?:text\/html|application\/json)/i.test(blob.type)) {
    throw new Error("下载结果为空或不是有效文件");
  }
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename || "处理结果.png";
  document.body.appendChild(anchor);
  try { anchor.click(); }
  finally {
    anchor.remove();
    // WebView needs time to consume the Blob after starting the download.
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return true;
}
