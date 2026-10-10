/**
 * 图片混淆工具的输出编码。
 *
 * 以前不管输入是什么格式，结果一律存成 PNG：一张 300KB 的 JPG 混淆后变成几 MB 的 PNG，
 * 还原后还是几 MB 的 PNG —— 用户看到的就是「混淆再还原，文件变大了」。
 *
 * 现在的做法（默认「自动」）：
 *  - 混淆：仍然输出无损 PNG（有损压缩会破坏像素位置，导致无法完整还原），
 *    但会在 PNG 里写一个小标记，记住原图的格式和体积；
 *  - 还原：读到标记就按原格式输出；原图是 JPG/WebP 时自动挑一个不比原图大的质量。
 *  - 也可以手动指定 PNG / JPG / WebP。
 */
export type ObfuscateOutputFormat = "auto" | "png" | "jpeg" | "webp";
export interface SourceMarker { mime: string; bytes: number }

const MARKER_KEY = "FurinaKitSource";
const PNG_SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];
const LOSSY_QUALITIES = [0.92, 0.86, 0.8, 0.72, 0.64];
const SIZE_TOLERANCE = 1.05;

let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) crc = crcTable[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.length > 33 && PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

export function normalizeMime(mime: string | undefined | null): string {
  const m = String(mime || "").toLowerCase();
  if (m === "image/jpg" || m === "image/pjpeg") return "image/jpeg";
  return m;
}

export function extensionForMime(mime: string): string {
  const m = normalizeMime(mime);
  if (m === "image/jpeg") return "jpg";
  if (m === "image/webp") return "webp";
  return "png";
}

/** 读取我们写进 PNG 的原图信息；不是 PNG 或没有标记时返回 null。只扫描 IDAT 之前的块。 */
export async function readSourceMarker(file: Blob): Promise<SourceMarker | null> {
  try {
    const head = new Uint8Array(await file.slice(0, Math.min(file.size, 256 * 1024)).arrayBuffer());
    if (!isPng(head)) return null;
    const view = new DataView(head.buffer, head.byteOffset, head.byteLength);
    let offset = 8;
    while (offset + 12 <= head.length) {
      const length = view.getUint32(offset);
      const type = String.fromCharCode(...head.subarray(offset + 4, offset + 8));
      if (type === "IDAT" || type === "IEND") return null;
      const end = offset + 12 + length;
      if (end > head.length) return null;
      if (type === "tEXt") {
        const data = head.subarray(offset + 8, offset + 8 + length);
        const zero = data.indexOf(0);
        if (zero > 0 && new TextDecoder("latin1").decode(data.subarray(0, zero)) === MARKER_KEY) {
          const parsed = JSON.parse(new TextDecoder("latin1").decode(data.subarray(zero + 1)));
          const mime = normalizeMime(parsed?.mime);
          const bytes = Number(parsed?.bytes);
          if (/^image\/[a-z0-9.+-]{1,32}$/.test(mime) && Number.isFinite(bytes) && bytes >= 0) return { mime, bytes };
          return null;
        }
      }
      offset = end;
    }
  } catch {
    /* 读不到标记就当没有，按普通图片处理 */
  }
  return null;
}

/** 在 IHDR 之后插入一个 tEXt 块，PNG 像素数据保持不变（仍然是无损的）。 */
export function withSourceMarker(png: Uint8Array, marker: SourceMarker): Uint8Array {
  if (!isPng(png)) return png;
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const ihdrEnd = 8 + 12 + view.getUint32(8);
  const text = new TextEncoder().encode(`${MARKER_KEY}\0${JSON.stringify({ mime: normalizeMime(marker.mime), bytes: Math.round(marker.bytes) })}`);
  const chunk = new Uint8Array(12 + text.length);
  const cv = new DataView(chunk.buffer);
  cv.setUint32(0, text.length);
  chunk.set([116, 69, 88, 116], 4); // "tEXt"
  chunk.set(text, 8);
  cv.setUint32(8 + text.length, crc32(chunk.subarray(4, 8 + text.length)));
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, ihdrEnd), 0);
  out.set(chunk, ihdrEnd);
  out.set(png.subarray(ihdrEnd), ihdrEnd + chunk.length);
  return out;
}

function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error("Canvas 输出 Blob 失败"));
      else if (normalizeMime(blob.type) !== normalizeMime(mime)) reject(new Error(`当前环境不支持输出 ${mime}`));
      else resolve(blob);
    }, mime, quality);
  });
}

export function hasTransparency(data: ImageData): boolean {
  const px = data.data;
  for (let i = 3; i < px.length; i += 4) if (px[i] < 255) return true;
  return false;
}

/** 有损格式：从高到低试几档质量，选第一个不超过「原图体积」的；都超了就用最小的那个。 */
async function encodeLossyWithinBudget(canvas: HTMLCanvasElement, mime: string, budget: number): Promise<Blob> {
  let smallest: Blob | null = null;
  for (const quality of LOSSY_QUALITIES) {
    const blob = await canvasToBlob(canvas, mime, quality);
    if (budget <= 0 || blob.size <= budget * SIZE_TOLERANCE) return blob;
    if (!smallest || blob.size < smallest.size) smallest = blob;
  }
  return smallest!;
}

export interface EncodeOptions {
  format: ObfuscateOutputFormat;
  direction: "scramble" | "restore";
  /** 输入文件本身 */
  input: Blob;
  /** 输入里读到的原图标记（多次混淆时一路保留最初的原图信息） */
  marker: SourceMarker | null;
  transparent: boolean;
}

export async function encodeObfuscateOutput(canvas: HTMLCanvasElement, opts: EncodeOptions): Promise<Blob> {
  const inputMime = normalizeMime(opts.input.type);
  const source: SourceMarker = opts.marker ?? { mime: inputMime || "image/png", bytes: opts.input.size };
  let target: string;
  if (opts.format === "png") target = "image/png";
  else if (opts.format === "jpeg" || opts.format === "webp") target = `image/${opts.format}`;
  else if (opts.direction === "scramble") target = "image/png";
  else target = ["image/jpeg", "image/webp"].includes(source.mime) ? source.mime : "image/png";

  // JPG 没有透明通道，透明图强制用 PNG，避免透明区域变黑。
  if (target === "image/jpeg" && opts.transparent) target = "image/png";

  if (target === "image/png") {
    const png = await canvasToBlob(canvas, "image/png");
    if (opts.direction !== "scramble") return png;
    const marked = withSourceMarker(new Uint8Array(await png.arrayBuffer()), source);
    return new Blob([new Uint8Array(marked)], { type: "image/png" });
  }
  // 还原到原格式：体积尽量不超过原图；手动指定有损格式时用固定高质量。
  if (opts.format === "auto") return encodeLossyWithinBudget(canvas, target, source.bytes);
  return canvasToBlob(canvas, target, 0.92);
}
