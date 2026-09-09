"use client";

import { useState } from "react";
import { Loader2, Download, Images } from "lucide-react";
import { Button, Label, Select, Alert } from "@/components/ui/primitives";
import { FileDropzone } from "@/components/tools/file-dropzone";

async function renderPdfToZip(file: File, scale: number, onProgress: (p: string) => void): Promise<Blob> {
  const pdfjs = await import("pdfjs-dist");
  // Worker is served same-origin from /public (copied by scripts/copy-pdf-worker.mjs).
  // Nothing — not even the worker script — is fetched from a third party.
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();

  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;

  for (let i = 1; i <= doc.numPages; i++) {
    onProgress(`正在渲染第 ${i} / ${doc.numPages} 页…`);
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("当前环境不支持 Canvas");

    const task = page.render({ canvasContext: ctx, viewport });
    // Guard against a stalled rasterization (e.g. a throttled background tab) so
    // the UI never spins forever.
    let timer: ReturnType<typeof setTimeout>;
    await Promise.race([
      task.promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          task.cancel();
          reject(new Error(`第 ${i} 页渲染超时，请降低分辨率或保持窗口在前台。`));
        }, 60_000);
      }),
    ]).finally(() => clearTimeout(timer));

    const blob: Blob = await new Promise((resolve, reject) =>
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("页面渲染失败"))), "image/png"),
    );
    zip.file(`page-${String(i).padStart(3, "0")}.png`, blob);
    canvas.width = canvas.height = 0;
  }

  await doc.cleanup();
  onProgress("正在打包 ZIP…");
  return zip.generateAsync({ type: "blob" });
}

export function PdfToImagesTool() {
  const [files, setFiles] = useState<File[]>([]);
  const [scale, setScale] = useState("2");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ url: string; name: string } | null>(null);

  const run = async () => {
    setError(null);
    setResult(null);
    if (!files[0]) {
      setError("请先添加 PDF 文件。");
      return;
    }
    setBusy(true);
    try {
      const blob = await renderPdfToZip(files[0], Number(scale), setStatus);
      const name = files[0].name.replace(/\.pdf$/i, "") + "-images.zip";
      setResult({ url: URL.createObjectURL(blob), name });
    } catch (err) {
      setError(err instanceof Error ? err.message : "PDF 转换失败");
    } finally {
      setBusy(false);
      setStatus("");
    }
  };

  return (
    <div className="space-y-5">
      <Alert>全程在本机处理，PDF 不会上传到任何服务器。</Alert>

      <div className="space-y-2">
        <Label>PDF 文件</Label>
        <FileDropzone files={files} onChange={setFiles} accept={{ "application/pdf": [".pdf"] }} />
      </div>

      <div className="space-y-2">
        <Label htmlFor="scale">输出分辨率</Label>
        <Select id="scale" value={scale} onChange={(e) => setScale(e.target.value)}>
          <option value="1">标准（1×）</option>
          <option value="2">高清（2×）</option>
          <option value="3">超清（3×）</option>
        </Select>
      </div>

      <Button type="button" onClick={run} disabled={busy}>
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Images className="h-4 w-4" />}
        {busy ? "转换中…" : "转换为图片"}
      </Button>

      {busy && status && (
        <p className="font-mono-accent text-xs uppercase tracking-widest text-muted-foreground">{status}</p>
      )}
      {error && <Alert variant="destructive">{error}</Alert>}

      {result && (
        <div className="space-y-3 border border-border bg-card p-5 animate-fade-in-up">
          <p className="text-sm text-muted-foreground">图片已生成，点击下载 ZIP 压缩包。</p>
          <a
            href={result.url}
            download={result.name}
            className="inline-flex h-10 items-center justify-center gap-2 bg-primary px-4 font-mono-accent text-xs font-semibold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <Download className="h-4 w-4" /> 下载 ZIP
          </a>
        </div>
      )}
    </div>
  );
}
