/** Use the encoded Blob's MIME, not controls that may have changed since encoding. */
export function imageResultExtension(blob: Blob, originalName: string): string {
  const formats: Record<string, string> = {
    "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png", "image/x-png": "png",
    "image/webp": "webp", "image/gif": "gif", "image/bmp": "bmp", "image/x-ms-bmp": "bmp",
    "image/tiff": "tiff", "image/avif": "avif", "image/svg+xml": "svg",
    "image/x-icon": "ico", "image/vnd.microsoft.icon": "ico",
  };
  const mime = blob.type.split(";")[0].trim().toLowerCase();
  if (Object.prototype.hasOwnProperty.call(formats, mime)) return formats[mime];
  // Unmodified originals may have no MIME. Keep their suffix rather than guessing PNG.
  const dot = originalName.lastIndexOf(".");
  const suffix = dot > 0 ? originalName.slice(dot + 1).toLowerCase() : "";
  return /^[a-z0-9]{1,10}$/.test(suffix) ? suffix : "";
}

/** Stable numbered basenames prevent JSZip replacement and extraction path/name hazards. */
export function batchImageName(index: number, filename: string): string {
  let clean = (filename.split(/[\\/]/).pop() || "image")
    .replace(/[\x00-\x1f\x7f<>:"|?*]/g, "_").replace(/[. ]+$/g, "");
  if (!clean || clean === "." || clean === "..") clean = "image";
  const dot = clean.lastIndexOf(".");
  const suffix = dot > 0 && /^[a-z0-9]{1,10}$/i.test(clean.slice(dot + 1)) ? clean.slice(dot) : "";
  const stem = suffix ? clean.slice(0, -suffix.length) : clean;
  return `${String(index + 1).padStart(4, "0")}-${Array.from(stem).slice(0, 100).join("")}${suffix}`;
}
