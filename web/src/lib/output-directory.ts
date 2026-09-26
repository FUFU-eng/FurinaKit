import { invoke } from "@tauri-apps/api/core";
import { stageFormData, discardStagedUploads } from "./native-upload";

export function isDesktopOutput(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}
/** Migrate the existing Settings value and synchronize before every explicit native save.
 * Invalid/unavailable folders fail visibly: never silently fall back or prompt again. */
export async function ensureOutputDirectory(): Promise<string> {
  if (!isDesktopOutput()) return "";
  let preferred: string | undefined;
  try {
    const value = JSON.parse(localStorage.getItem("furinakit:settings") || "{}").outputDir;
    if (typeof value === "string" && value.trim()) preferred = value.trim();
  } catch { /* Missing legacy settings: use the persisted native/default directory. */ }
  return invoke<string>("sync_output_directory", { preferred });
}
export async function openOutputDirectory(): Promise<void> {
  if (!isDesktopOutput()) throw new Error("打开输出目录仅适用于桌面版");
  await ensureOutputDirectory();
  await invoke("open_output_directory");
}
export async function saveOutputBlob(blob: Blob, filename: string): Promise<string> {
  await ensureOutputDirectory();
  const form = new FormData();
  form.append("file", blob, filename || "结果.bin");
  const staged = await stageFormData(form);
  try {
    const files = staged.__files as { uploadToken: string }[] | undefined;
    const token = files?.[0]?.uploadToken;
    if (!token) throw new Error("结果文件暂存失败");
    return await invoke<string>("export_upload", { token });
  } finally { await discardStagedUploads(staged); }
}
export function reportOutputError(error: unknown): void {
  window.dispatchEvent(new CustomEvent("fk-download-error", {
    detail: typeof error === "string" ? error : error instanceof Error ? error.message : "保存失败，请重试",
  }));
}
export function reportOutputSaved(path?: string): void {
  window.dispatchEvent(new CustomEvent("fk-download-saved", { detail: path || "可点击“打开输出目录”查看结果；同名文件会自动编号。" }));
}

/** Resolve only this application's API URLs; never intercept remote origins or file: URLs. */
export function internalDownloadHref(raw:string):string|null {
  try{const u=new URL(raw,location.href);return u.protocol===location.protocol&&u.host===location.host&&u.pathname.startsWith("/api/")?u.pathname+u.search:null;}catch{return null;}
}

/** Cover client-generated PNG/PDF/text/ZIP downloads, including detached anchors.
 * Capture the Blob synchronously: callers may revoke its object URL immediately after click().
 * Preview object URLs without a download attribute are never exported. */
export function installLocalOutputShim(): void {
  const blobs = new Map<string, Blob>();
  const create = URL.createObjectURL.bind(URL);
  const revoke = URL.revokeObjectURL.bind(URL);
  URL.createObjectURL = object => {
    const url = create(object);
    if (object instanceof Blob) blobs.set(url, object);
    return url;
  };
  URL.revokeObjectURL = url => { blobs.delete(url); revoke(url); };
  const pending = new WeakSet<HTMLAnchorElement>();
  const intercept = (anchor: HTMLAnchorElement): boolean => {
    const href = anchor.getAttribute("href") || "";
    if (!anchor.hasAttribute("download") || !/^(blob:|data:)/i.test(href)) return false;
    if (pending.has(anchor)) return true;
    pending.add(anchor);
    const name = anchor.download || "结果.bin";
    const known = blobs.get(href);
    // Start fetch before returning to a caller which might revoke the URL.
    const body = known ? Promise.resolve(known) : fetch(href).then(response => {
      if (!response.ok) throw new Error(`读取下载内容失败 (${response.status})`);
      return response.blob();
    });
    void body.then(blob => saveOutputBlob(blob, name)).then(reportOutputSaved).catch(reportOutputError).finally(() => pending.delete(anchor));
    return true;
  };
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (intercept(this)) return;
    // Detached /api links also need to reach the bridge's document delegate.
    const internal = internalDownloadHref(this.getAttribute("href") || "")!==null;
    if (internal && !this.isConnected) {
      const hidden = this.hidden;
      this.hidden = true; document.body.appendChild(this);
      try { click.call(this); } finally { this.remove(); this.hidden = hidden; }
    } else click.call(this);
  };
  document.addEventListener("click", event => {
    if (event.defaultPrevented || event.button !== 0) return;
    const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
    if (anchor && intercept(anchor)) event.preventDefault();
  }, true);
}
