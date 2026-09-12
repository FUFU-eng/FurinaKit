import path from "path";
import {
  convertImage,
  resizeImage,
  compressImage,
  rotateImage,
  flipImage,
  grayscaleImage,
  blurImage,
  watermarkImage,
  stripMetadataImage,
  adjustImage,
  removeWatermark,
} from "./image";
import {
  mergePdfs,
  splitPdf,
  rotatePdf,
  deletePdfPages,
  imagesToPdf,
  pdfPageNumbers,
  pdfWatermark,
  extractPdfText,
  compressPdf,
  unlockPdf,
  organizePdf,
  repairPdf,
} from "./pdf";
import { generateQr, generateHash } from "./utility";
import {
  dnsLookup,
  sslChecker,
  urlParser,
  loremGen,
  cssGradient,
  imageExif,
  svgOptimize,
  asciiArt,
} from "./quick-tools";

export type SyncInput = {
  files: Buffer[];
  filenames: string[];
  fields: Record<string, string>;
};

export type SyncOutput = {
  kind: "file" | "text";
  buffer?: Buffer;
  text?: string;
  filename: string;
  mimeType: string;
};

export type SyncHandler = (input: SyncInput) => Promise<SyncOutput>;

function stem(filename: string | undefined, fallback: string): string {
  if (!filename) return fallback;
  const base = path.basename(filename, path.extname(filename)).replace(/[^a-zA-Z0-9._-]/g, "_");
  return base || fallback;
}

function num(fields: Record<string, string>, id: string, def: number): number {
  const v = Number(fields[id]);
  return Number.isFinite(v) ? v : def;
}

function requireOne(files: Buffer[]): Buffer {
  if (!files[0]) throw new Error("A file is required");
  return files[0];
}

export const SYNC_HANDLERS: Record<string, SyncHandler> = {
  // ── image ──
  "image-convert": async ({ files, filenames, fields }) => {
    const r = await convertImage(requireOne(files), fields.format ?? "webp", num(fields, "quality", 90));
    return { kind: "file", buffer: r.buffer, filename: `${stem(filenames[0], "image")}.${r.ext}`, mimeType: r.mimeType };
  },
  "image-resize": async ({ files, filenames, fields }) => {
    const w = num(fields, "width", 800);
    const h = num(fields, "height", 600);
    const r = await resizeImage(requireOne(files), w, h, fields.mode ?? "fit");
    return { kind: "file", buffer: r.buffer, filename: `${stem(filenames[0], "image")}-${w}x${h}.${r.ext}`, mimeType: r.mimeType };
  },
  "image-compress": async ({ files, filenames, fields }) => {
    const r = await compressImage(requireOne(files), num(fields, "quality", 75));
    return { kind: "file", buffer: r.buffer, filename: `${stem(filenames[0], "image")}-compressed.${r.ext}`, mimeType: r.mimeType };
  },
  // image-crop is now a client-side tool (interactive canvas crop) — no server handler.
  "image-rotate": async ({ files, filenames, fields }) => {
    const r = await rotateImage(requireOne(files), num(fields, "angle", 90));
    return { kind: "file", buffer: r.buffer, filename: `${stem(filenames[0], "image")}-rotated.${r.ext}`, mimeType: r.mimeType };
  },
  "image-flip": async ({ files, filenames, fields }) => {
    const r = await flipImage(requireOne(files), fields.direction ?? "horizontal");
    return { kind: "file", buffer: r.buffer, filename: `${stem(filenames[0], "image")}-flipped.${r.ext}`, mimeType: r.mimeType };
  },
  "image-grayscale": async ({ files, filenames }) => {
    const r = await grayscaleImage(requireOne(files));
    return { kind: "file", buffer: r.buffer, filename: `${stem(filenames[0], "image")}-gray.${r.ext}`, mimeType: r.mimeType };
  },
  "image-blur": async ({ files, filenames, fields }) => {
    const r = await blurImage(requireOne(files), num(fields, "sigma", 8));
    return { kind: "file", buffer: r.buffer, filename: `${stem(filenames[0], "image")}-blurred.${r.ext}`, mimeType: r.mimeType };
  },
  "image-watermark": async ({ files, filenames, fields }) => {
    const text = (fields.text ?? "").trim();
    if (!text) throw new Error("Watermark text is required");
    const r = await watermarkImage(requireOne(files), text, fields.position ?? "bottom-right", num(fields, "opacity", 50));
    return { kind: "file", buffer: r.buffer, filename: `${stem(filenames[0], "image")}-watermarked.${r.ext}`, mimeType: r.mimeType };
  },
  "image-strip-metadata": async ({ files, filenames }) => {
    const r = await stripMetadataImage(requireOne(files));
    return { kind: "file", buffer: r.buffer, filename: `${stem(filenames[0], "image")}-clean.${r.ext}`, mimeType: r.mimeType };
  },
  "watermark-remove": async ({ files, filenames, fields }) => {
    const r = await removeWatermark(
      requireOne(files),
      num(fields, "left", 0),
      num(fields, "top", 0),
      num(fields, "width", 200),
      num(fields, "height", 80),
    );
    return { kind: "file", buffer: r.buffer, filename: `${stem(filenames[0], "image")}-clean.${r.ext}`, mimeType: r.mimeType };
  },
  "image-adjust": async ({ files, filenames, fields }) => {
    const r = await adjustImage(
      requireOne(files),
      num(fields, "brightness", 1),
      num(fields, "saturation", 1),
      num(fields, "hue", 0),
    );
    return { kind: "file", buffer: r.buffer, filename: `${stem(filenames[0], "image")}-adjusted.${r.ext}`, mimeType: r.mimeType };
  },

  // ── pdf ──
  "pdf-merge": async ({ files }) => {
    if (files.length < 2) throw new Error("At least two PDF files are required");
    const r = await mergePdfs(files);
    return { kind: "file", buffer: r.buffer, filename: "merged.pdf", mimeType: r.mimeType };
  },
  "pdf-split": async ({ files, filenames, fields }) => {
    const r = await splitPdf(requireOne(files), num(fields, "startPage", 1), num(fields, "endPage", 1));
    return { kind: "file", buffer: r.buffer, filename: `${stem(filenames[0], "document")}-pages.pdf`, mimeType: r.mimeType };
  },
  "pdf-rotate": async ({ files, filenames, fields }) => {
    const r = await rotatePdf(requireOne(files), num(fields, "angle", 90));
    return { kind: "file", buffer: r.buffer, filename: `${stem(filenames[0], "document")}-rotated.pdf`, mimeType: r.mimeType };
  },
  "pdf-delete-pages": async ({ files, filenames, fields }) => {
    const spec = (fields.pages ?? "").trim();
    if (!spec) throw new Error("Specify pages to delete, e.g. 1,3,5-7");
    const r = await deletePdfPages(requireOne(files), spec);
    return { kind: "file", buffer: r.buffer, filename: `${stem(filenames[0], "document")}-edited.pdf`, mimeType: r.mimeType };
  },
  "images-to-pdf": async ({ files, fields }) => {
    if (files.length < 1) throw new Error("At least one image is required");
    const r = await imagesToPdf(files, fields.pageSize ?? "fit");
    return { kind: "file", buffer: r.buffer, filename: "images.pdf", mimeType: r.mimeType };
  },
  "pdf-page-numbers": async ({ files, filenames, fields }) => {
    const r = await pdfPageNumbers(requireOne(files), fields.position ?? "bottom-center");
    return { kind: "file", buffer: r.buffer, filename: `${stem(filenames[0], "document")}-numbered.pdf`, mimeType: r.mimeType };
  },
  "pdf-watermark": async ({ files, filenames, fields }) => {
    const text = (fields.text ?? "").trim();
    if (!text) throw new Error("Watermark text is required");
    const r = await pdfWatermark(requireOne(files), text, num(fields, "opacity", 20));
    return { kind: "file", buffer: r.buffer, filename: `${stem(filenames[0], "document")}-watermarked.pdf`, mimeType: r.mimeType };
  },
  "pdf-extract-text": async ({ files, filenames }) => {
    const text = await extractPdfText(requireOne(files));
    return { kind: "text", text, filename: `${stem(filenames[0], "document")}.txt`, mimeType: "text/plain; charset=utf-8" };
  },
  "pdf-compress": async ({ files, filenames, fields }) => {
    const r = await compressPdf(requireOne(files), num(fields, "imageQuality", 70));
    return { kind: "file", buffer: r.buffer, filename: `${stem(filenames[0], "document")}-compressed.pdf`, mimeType: r.mimeType };
  },
  "pdf-unlock": async ({ files, filenames }) => {
    const r = await unlockPdf(requireOne(files));
    return { kind: "file", buffer: r.buffer, filename: `${stem(filenames[0], "document")}-unlocked.pdf`, mimeType: r.mimeType };
  },
  "pdf-organize": async ({ files, filenames, fields }) => {
    const order = (fields.order ?? "").trim();
    if (!order) throw new Error("Specify a page order, e.g. 3,1,2,4");
    const r = await organizePdf(requireOne(files), order);
    return { kind: "file", buffer: r.buffer, filename: `${stem(filenames[0], "document")}-organized.pdf`, mimeType: r.mimeType };
  },
  "pdf-repair": async ({ files, filenames }) => {
    const r = await repairPdf(requireOne(files));
    return { kind: "file", buffer: r.buffer, filename: `${stem(filenames[0], "document")}-repaired.pdf`, mimeType: r.mimeType };
  },

  // ── utility ──
  "qr-generator": async ({ fields }) => {
    const text = (fields.text ?? "").trim();
    if (!text) throw new Error("Text or URL is required");
    const r = await generateQr(text, num(fields, "size", 512), fields.ecc ?? "M");
    if (r.kind !== "file") throw new Error("QR generation failed");
    return { kind: "file", buffer: r.buffer, filename: "qr-code.png", mimeType: r.mimeType };
  },
  "hash-generator": async ({ fields }) => {
    const text = fields.text ?? "";
    if (!text) throw new Error("Input text is required");
    const r = generateHash(text, fields.algorithm ?? "sha256");
    if (r.kind !== "text") throw new Error("Hash generation failed");
    return { kind: "text", text: r.text, filename: "hash.txt", mimeType: "text/plain; charset=utf-8" };
  },

  // ── 开发/网络查询类（实现在 quick-tools.ts，界面走通用表单）──
  "dns-lookup": dnsLookup,
  "ssl-checker": sslChecker,
  "url-parser": urlParser,
  "lorem-gen": loremGen,
  "css-gradient": cssGradient,
  "image-exif": imageExif,
  "svg-optimize": svgOptimize,
  "ascii-art": asciiArt,
};
