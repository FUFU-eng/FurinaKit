"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2, Download, Images } from "lucide-react";
import { Button, Label, Select, Alert } from "@/components/ui/primitives";
import { FileDropzone } from "@/components/tools/file-dropzone";

// ==========================================================================
// 模块级缓存：离开页面（切到别的工具、回首页）再回来时，恢复选中的 PDF、输出分辨率与结果。
//
// 为什么必须是模块级：File / Blob 无法序列化进 localStorage / sessionStorage，
// 而组件一卸载，useState 里的东西就全没了。做法与 image-compress-tool、
// image-obfuscate-tool、fileHideCache、tool-runner 里的 toolDraftCache 保持一致。
//
// 为什么结果链接也归缓存持有：ZIP 的下载链接是 URL.createObjectURL 的产物，
// 以前每次转换都新建一条、上一条从不释放 —— 转十次就把十份 ZIP 钉在内存里，
// 而且组件卸载时链接既没人释放、也没人保存，切走再回来下载按钮直接失效。
// 现在只在三种情况下释放：
//   ① 那份结果被换成新的一份（用户再点一次「转换为图片」，包括失败时被清掉的那份）
//   ② 用户清空（把结果置空）
//   ③ 缓存条目被淘汰
// 判断依据是「上一份快照里的链接字符串与新一份是否还是同一条」——
// 每次保存都无条件释放等于把正在显示的链接掐断，所以必须比较而不是必释放。
// 恢复时直接复用缓存里的链接字符串，绝不重新 createObjectURL（重建只会白漏一条）。
//
// 关于输入文件：这个工具的输入只有 File 本身，没有属于它的 object URL ——
// 拖拽区（FileDropzone）只对 image/* 自建预览链接、并在自己卸载时释放，
// PDF 显示的只是图标。所以这里只需要保存 File，没有输入链接需要持有或释放。
// ==========================================================================
interface PdfResult {
  blob: Blob;
  url: string;
  name: string;
}

interface PdfCacheEntry {
  files: File[];
  scale: string;
  result: PdfResult | null;
}

const PDF_CACHE_KEY = "pdf-to-images";
/** 最多保留 6 个条目，与 tool-runner 的 TOOL_DRAFT_LIMIT 对齐；本工具只用一个 key，实际只占 1 份 */
const PDF_CACHE_LIMIT = 6;
/** key → 条目，迭代顺序即最近使用顺序（先删再存），便于淘汰最旧的 */
const pdfToImagesCache = new Map<string, PdfCacheEntry>();

const PDF_CACHE_DEFAULTS = {
  scale: "2",
};

/** 恢复输入文件：再拷一份数组，避免运行期的原地改动写进缓存快照 */
function readPdfFiles(): File[] {
  const cached = pdfToImagesCache.get(PDF_CACHE_KEY);
  if (!cached) return [];
  return [...cached.files];
}

/** 恢复输出分辨率 */
function readPdfScale(): string {
  return pdfToImagesCache.get(PDF_CACHE_KEY)?.scale ?? PDF_CACHE_DEFAULTS.scale;
}

/** 恢复结果：直接复用缓存里存的链接字符串，不重新 createObjectURL */
function readPdfResult(): PdfResult | null {
  const cached = pdfToImagesCache.get(PDF_CACHE_KEY);
  return cached?.result ? { ...cached.result } : null;
}

/** 写入缓存前拍一份浅拷贝，把链接字符串冻在保存的那一刻，供下次比较「是否换了新结果」 */
function snapshotPdfEntry(entry: PdfCacheEntry): PdfCacheEntry {
  return {
    ...entry,
    files: [...entry.files],
    result: entry.result ? { ...entry.result } : null,
  };
}

/**
 * 写入缓存：先释放被替换 / 被清掉的结果链接，再按最近使用顺序存入并做上限淘汰。
 * 注意：比较的是「链接字符串」而不是对象引用 —— 上面存进去的是快照拷贝，
 * 拿引用比较会把「没有变」误判成「换了新的」，从而把正在用的链接释放掉。
 */
function rememberPdfEntry(key: string, entry: PdfCacheEntry): void {
  const previous = pdfToImagesCache.get(key);

  if (previous?.result) {
    // 结果被置空（清空）或换成新的一条时才释放；链接字符串没变就一律不动
    if (previous.result.url !== entry.result?.url) {
      URL.revokeObjectURL(previous.result.url);
    }
  }

  // 先删再存：让 Map 的迭代顺序等于「最近使用顺序」
  pdfToImagesCache.delete(key);
  pdfToImagesCache.set(key, snapshotPdfEntry(entry));

  while (pdfToImagesCache.size > PDF_CACHE_LIMIT) {
    const oldestKey = pdfToImagesCache.keys().next().value;
    if (oldestKey === undefined) break;
    const oldest = pdfToImagesCache.get(oldestKey);
    if (oldest?.result) URL.revokeObjectURL(oldest.result.url);
    pdfToImagesCache.delete(oldestKey);
  }
}

/**
 * 一次转换的中断控制块。
 * 用户切走（组件卸载）时靠它把还在跑的活停下来：不再渲染后续页面、取消正在栅格化的
 * 渲染任务、并清掉尚未触发的超时定时器 —— 否则人已经走了，后台还在整本 PDF 地渲染。
 */
type RenderControl = {
  cancelled: boolean;
  /** 本轮转换登记在案的超时定时器，卸载 / 结束时统一清掉 */
  timers: Set<ReturnType<typeof setTimeout>>;
  /** 当前正在栅格化的页面任务，卸载时取消 */
  renderTask: { cancel: () => void } | null;
};

/** 已经离开这个工具就立刻中断；抛出的错误由 run() 按「已取消」吞掉，不会显示给用户 */
function throwIfCancelled(control?: RenderControl): void {
  if (control?.cancelled) throw new Error("PDF 转换已取消");
}

async function renderPdfToZip(
  file: File,
  scale: number,
  onProgress: (p: string) => void,
  control?: RenderControl,
): Promise<Blob> {
  const pdfjs = await import("pdfjs-dist");
  // Worker is served same-origin from /public (copied by scripts/copy-pdf-worker.mjs).
  // Nothing — not even the worker script — is fetched from a third party.
  pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";

  const { default: JSZip } = await import("jszip");
  const zip = new JSZip();

  throwIfCancelled(control);
  const data = new Uint8Array(await file.arrayBuffer());
  throwIfCancelled(control);
  const doc = await pdfjs.getDocument({ data }).promise;
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      throwIfCancelled(control);
      onProgress(`正在渲染第 ${i} / ${doc.numPages} 页…`);
      const page = await doc.getPage(i);
      throwIfCancelled(control);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("当前环境不支持 Canvas");

      const task = page.render({ canvasContext: ctx, viewport });
      if (control) control.renderTask = task;
      // Guard against a stalled rasterization (e.g. a throttled background tab) so
      // the UI never spins forever.
      // 这个超时同时登记进 control：组件卸载时能立刻清掉，不留一个还在跑的定时器。
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        const t = setTimeout(() => {
          task.cancel();
          reject(new Error(`第 ${i} 页渲染超时，请降低分辨率或保持窗口在前台。`));
        }, 60_000);
        timer = t;
        control?.timers.add(t);
      });
      try {
        await Promise.race([task.promise, timeout]);
      } finally {
        if (timer !== undefined) {
          clearTimeout(timer);
          control?.timers.delete(timer);
        }
        if (control) control.renderTask = null;
      }

      // 渲染期间被取消（用户已经切走）时不要再把这一页塞进压缩包
      throwIfCancelled(control);

      // toBlob 的回调里 blob 为 null（例如画布尺寸异常）时明确报错，
      // 不能让这个 Promise 永远悬着 —— 否则界面会一直停在「转换中…」。
      const blob: Blob = await new Promise((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("页面渲染失败"))), "image/png"),
      );
      zip.file(`page-${String(i).padStart(3, "0")}.png`, blob);
      canvas.width = canvas.height = 0;
    }

    throwIfCancelled(control);
    await doc.cleanup();
    onProgress("正在打包 ZIP…");
    return await zip.generateAsync({ type: "blob" });
  } catch (err) {
    // 失败或被取消时同样把 pdf.js 的文档资源放掉：不然 worker 侧会一直攥着整份 PDF，
    // 用户已经切走了，这份文件还要在内存里留很久。
    if (control?.cancelled) {
      try {
        await doc.destroy();
      } catch {
        /* 文档已销毁 / worker 已退出时忽略 */
      }
    }
    throw err;
  }
}

export function PdfToImagesTool() {
  // 挂载时从模块级缓存恢复：切到别的工具 / 回首页再回来，选中的 PDF、分辨率与结果都还在。
  // 结果的链接直接复用缓存里的那一条，绝不重新 createObjectURL。
  const [files, setFiles] = useState<File[]>(() => readPdfFiles());
  const [scale, setScale] = useState<string>(() => readPdfScale());
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PdfResult | null>(() => readPdfResult());

  /** 本轮转换的控制块；卸载时用它取消渲染、清掉超时定时器 */
  const controlRef = useRef<RenderControl | null>(null);

  // 输入 / 参数 / 结果有变化就写回缓存，保证离开这个工具时缓存里是最新的。
  // 链接的释放由 rememberPdfEntry 判定（链接字符串换了才释放），所以这里不会误伤正在用的链接。
  useEffect(() => {
    rememberPdfEntry(PDF_CACHE_KEY, { files, scale, result });
  }, [files, scale, result]);

  // 卸载（切到别的工具 / 回首页）时不释放结果链接 —— 它归缓存持有，回来时下载按钮照样能用。
  // 但必须把还在跑的转换停掉：清掉未触发的超时定时器、取消正在栅格化的渲染任务。
  useEffect(() => {
    return () => {
      const control = controlRef.current;
      if (!control) return;
      control.cancelled = true;
      control.timers.forEach((t) => clearTimeout(t));
      control.timers.clear();
      control.renderTask?.cancel();
      control.renderTask = null;
    };
  }, []);

  const run = async () => {
    setError(null);
    // 先把上一次的结果置空：写回缓存时会把旧链接释放掉（见 rememberPdfEntry），
    // 所以反复转换不会把上一份 ZIP 一直钉在内存里；旧链接此前也只有它在用。
    setResult(null);
    const pdf = files[0];
    if (!pdf) {
      setError("请先添加 PDF 文件。");
      return;
    }
    // 每一轮转换用一份新的控制块：卸载时靠它中断本轮
    const control: RenderControl = { cancelled: false, timers: new Set(), renderTask: null };
    controlRef.current = control;
    setBusy(true);
    try {
      const blob = await renderPdfToZip(
        pdf,
        Number(scale),
        (p) => {
          if (!control.cancelled) setStatus(p);
        },
        control,
      );
      // 已经离开这个工具：不新建链接（新链接没有任何人持有，只会泄漏），也不用改界面状态
      if (control.cancelled) return;
      const name = pdf.name.replace(/\.pdf$/i, "") + "-images.zip";
      setResult({ blob, url: URL.createObjectURL(blob), name });
    } catch (err) {
      if (control.cancelled) return;
      setError(err instanceof Error ? err.message : "PDF 转换失败");
    } finally {
      if (!control.cancelled) {
        setBusy(false);
        setStatus("");
      }
      control.timers.forEach((t) => clearTimeout(t));
      control.timers.clear();
      if (controlRef.current === control) controlRef.current = null;
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
