"use client";

import { useEffect, useState } from "react";
import { convertFileSrc, isTauri } from "@tauri-apps/api/core";

// Keep in sync with the native preview limit; downloads are not previews.
const MAX_PREVIEW_BYTES = 32 * 1024 * 1024;

/** Desktop media uses a read-only job protocol with Range support, not base64 IPC. */
export function useJobPreviewUrl(jobId: string | null | undefined, stem?: "vocals" | "instrumental"): string {
  const [preview, setPreview] = useState<{ jobId: string; url: string } | null>(null);

  const key = jobId ? `${jobId}${stem ? `/${stem}` : ""}` : "";
  useEffect(() => {
    setPreview(null);
    if (!jobId) return;
    if (isTauri()) {
      setPreview({ jobId: key, url: `${convertFileSrc(jobId, "fkmedia")}${stem ? `/${stem}` : ""}` });
      return;
    }
    // Stem streaming is a desktop job-scoped protocol; never treat a ZIP as audio.
    if (stem) return;
    const controller = new AbortController();
    let alive = true;
    let objectUrl = "";
    (async () => {
      try {
        const res = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/download?preview=1`, {
          cache: "no-store",
          signal: controller.signal,
        });
        // The desktop invoke may finish even after abort; always check ownership.
        if (!alive || !res.ok) return;
        if (Number(res.headers.get("Content-Length")) > MAX_PREVIEW_BYTES) return;
        const blob = await res.blob();
        if (!alive || !blob.size || blob.size > MAX_PREVIEW_BYTES) return;
        objectUrl = URL.createObjectURL(blob);
        setPreview({ jobId: key, url: objectUrl });
      } catch {
        // The caller keeps the download action available when preview is unavailable.
      }
    })();
    return () => {
      alive = false;
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [jobId, key, stem]);

  // Do not expose the previous job's URL even during the render before cleanup.
  return preview && preview.jobId === key ? preview.url : "";
}
