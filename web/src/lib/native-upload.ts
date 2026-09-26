import { invoke } from "@tauri-apps/api/core";

const CHUNK_BYTES = 1024 * 1024;
type UploadRef = { field: string; name: string; uploadToken: string };
function checkAbort(signal?: AbortSignal | null) {
  if (signal?.aborted) throw signal.reason ?? new DOMException("请求已取消", "AbortError");
}
function encode(bytes: Uint8Array): string {
  let text = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    text += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(text);
}
export async function discardStagedUploads(args: Record<string, unknown>): Promise<void> {
  const files = Array.isArray(args.__files) ? args.__files as UploadRef[] : [];
  await Promise.all(files.filter(f => typeof f.uploadToken === "string").map(f =>
    invoke("abort_upload", { token: f.uploadToken }).catch(() => undefined)));
}
/** Stage files one bounded chunk at a time. The final API request contains references, not file bytes. */
export async function stageFormData(form: FormData, signal?: AbortSignal | null): Promise<Record<string, unknown>> {
  const fields: Record<string, unknown> = {};
  const files: UploadRef[] = [];
  try {
    for (const [field, value] of form.entries()) {
      checkAbort(signal);
      if (typeof value === "string") { fields[field] = value; continue; }
      const name = value instanceof File && value.name ? value.name : `${field}.bin`;
      const token = await invoke<string>("begin_upload", { name, size: value.size });
      files.push({ field, name, uploadToken: token });
      for (let offset = 0; offset < value.size; offset += CHUNK_BYTES) {
        checkAbort(signal);
        const bytes = new Uint8Array(await value.slice(offset, offset + CHUNK_BYTES).arrayBuffer());
        checkAbort(signal);
        await invoke("append_upload", { token, offset, data: encode(bytes) });
      }
      checkAbort(signal);
      await invoke("finish_upload", { token });
    }
    checkAbort(signal);
    if (files.length) fields.__files = files;
    return fields;
  } catch (error) {
    await discardStagedUploads({ __files: files });
    throw error;
  }
}
