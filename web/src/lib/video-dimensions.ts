/** Probe only metadata; always release the decoder, timer, and object URL. */
export function readVideoDimensions(file: File): Promise<{ w: number; h: number } | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.preload = "metadata";
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      const dimensions = ok && video.videoWidth > 0 && video.videoHeight > 0
        ? { w: video.videoWidth, h: video.videoHeight } : null;
      window.clearTimeout(timer);
      video.onloadedmetadata = null;
      video.onerror = null;
      video.pause();
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      resolve(dimensions);
    };
    const timer = window.setTimeout(() => finish(false), 4000);
    video.onloadedmetadata = () => finish(true);
    video.onerror = () => finish(false);
    video.src = url;
  });
}
