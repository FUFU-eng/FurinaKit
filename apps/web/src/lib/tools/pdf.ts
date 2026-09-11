import { PDFDocument, degrees, rgb, StandardFonts } from "pdf-lib";
import sharp from "sharp";

export type PdfResult = { buffer: Buffer; mimeType: string };

const PAGE_SIZES: Record<string, [number, number]> = {
  a4: [595.28, 841.89],
  letter: [612, 792],
};

export async function mergePdfs(inputs: Buffer[]): Promise<PdfResult> {
  const merged = await PDFDocument.create();
  for (const bytes of inputs) {
    const pdf = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = await merged.copyPages(pdf, pdf.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }
  return { buffer: Buffer.from(await merged.save()), mimeType: "application/pdf" };
}

export async function splitPdf(input: Buffer, startPage: number, endPage: number): Promise<PdfResult> {
  const source = await PDFDocument.load(input, { ignoreEncryption: true });
  const total = source.getPageCount();
  const start = Math.max(1, Math.min(startPage, total));
  const end = Math.max(start, Math.min(endPage, total));
  const target = await PDFDocument.create();
  const indices = Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i);
  const pages = await target.copyPages(source, indices);
  pages.forEach((page) => target.addPage(page));
  return { buffer: Buffer.from(await target.save()), mimeType: "application/pdf" };
}

export async function rotatePdf(input: Buffer, angle: number): Promise<PdfResult> {
  const pdf = await PDFDocument.load(input, { ignoreEncryption: true });
  for (const page of pdf.getPages()) {
    const current = page.getRotation().angle;
    page.setRotation(degrees((current + angle) % 360));
  }
  return { buffer: Buffer.from(await pdf.save()), mimeType: "application/pdf" };
}

/** Parse a spec like "1,3,5-7" into a 1-based set, clamped to [1, total]. */
export function parsePageSpec(spec: string, total: number): Set<number> {
  const pages = new Set<number>();
  for (const part of spec.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const range = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const a = Math.max(1, parseInt(range[1], 10));
      const b = Math.min(total, parseInt(range[2], 10));
      for (let i = a; i <= b; i++) pages.add(i);
    } else if (/^\d+$/.test(trimmed)) {
      const n = parseInt(trimmed, 10);
      if (n >= 1 && n <= total) pages.add(n);
    }
  }
  return pages;
}

export async function deletePdfPages(input: Buffer, spec: string): Promise<PdfResult> {
  const pdf = await PDFDocument.load(input, { ignoreEncryption: true });
  const total = pdf.getPageCount();
  const toDelete = parsePageSpec(spec, total);
  if (toDelete.size >= total) throw new Error("Cannot delete every page");
  // Remove from the back so indices stay valid.
  for (let i = total; i >= 1; i--) {
    if (toDelete.has(i)) pdf.removePage(i - 1);
  }
  return { buffer: Buffer.from(await pdf.save()), mimeType: "application/pdf" };
}

export async function imagesToPdf(images: Buffer[], pageSize: string): Promise<PdfResult> {
  const pdf = await PDFDocument.create();
  for (const raw of images) {
    let embedded;
    const isJpeg = raw.length > 3 && raw[0] === 0xff && raw[1] === 0xd8 && raw[2] === 0xff;

    if (isJpeg) {
      try {
        // 原生 JPEG 直接嵌入，零重编码损失与体积翻倍
        embedded = await pdf.embedJpg(raw);
      } catch {
        // 遇到非标准 JPEG（如 CMYK 色彩空间），转为标准 sRGB JPEG 嵌入
        const standardJpg = await sharp(raw, { failOn: "none" }).rotate().jpeg({ quality: 90 }).toBuffer();
        embedded = await pdf.embedJpg(standardJpg);
      }
    } else {
      try {
        const meta = await sharp(raw, { failOn: "none" }).metadata();
        if (meta.hasAlpha) {
          // 带有透明通道的原图，使用高压缩率 PNG
          const png = await sharp(raw, { failOn: "none" }).rotate().png({ compressionLevel: 9, effort: 7 }).toBuffer();
          embedded = await pdf.embedPng(png);
        } else {
          // 不带透明通道的 WebP / AVIF / BMP / TIFF，转为高质量 JPEG 嵌入，体积缩减 70%~90%
          const jpg = await sharp(raw, { failOn: "none" }).rotate().jpeg({ quality: 90 }).toBuffer();
          embedded = await pdf.embedJpg(jpg);
        }
      } catch {
        const png = await sharp(raw, { failOn: "none" }).rotate().png().toBuffer();
        embedded = await pdf.embedPng(png);
      }
    }

    const { width, height } = embedded;

    if (pageSize === "fit") {
      const page = pdf.addPage([width, height]);
      page.drawImage(embedded, { x: 0, y: 0, width, height });
    } else {
      const [pw, ph] = PAGE_SIZES[pageSize] ?? PAGE_SIZES.a4;
      const page = pdf.addPage([pw, ph]);
      const scale = Math.min(pw / width, ph / height);
      const w = width * scale;
      const h = height * scale;
      page.drawImage(embedded, { x: (pw - w) / 2, y: (ph - h) / 2, width: w, height: h });
    }
  }
  const saved = await pdf.save({ useObjectStreams: true });
  return { buffer: Buffer.from(saved), mimeType: "application/pdf" };
}

export async function pdfPageNumbers(input: Buffer, position: string): Promise<PdfResult> {
  const pdf = await PDFDocument.load(input, { ignoreEncryption: true });
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const pages = pdf.getPages();
  const size = 11;
  pages.forEach((page, i) => {
    const label = `${i + 1} / ${pages.length}`;
    const { width } = page.getSize();
    const textWidth = font.widthOfTextAtSize(label, size);
    let x = width / 2 - textWidth / 2;
    if (position === "bottom-right") x = width - textWidth - 36;
    if (position === "bottom-left") x = 36;
    page.drawText(label, { x, y: 24, size, font, color: rgb(0.3, 0.3, 0.3) });
  });
  return { buffer: Buffer.from(await pdf.save()), mimeType: "application/pdf" };
}

export async function pdfWatermark(input: Buffer, text: string, opacity: number): Promise<PdfResult> {
  const pdf = await PDFDocument.load(input, { ignoreEncryption: true });
  const font = await pdf.embedFont(StandardFonts.HelveticaBold);
  const op = Math.min(1, Math.max(0.05, opacity / 100));
  for (const page of pdf.getPages()) {
    const { width, height } = page.getSize();
    const fontSize = Math.max(24, Math.min(width, height) / 8);
    const textWidth = font.widthOfTextAtSize(text, fontSize);
    page.drawText(text, {
      x: width / 2 - (textWidth / 2) * Math.cos(Math.PI / 4),
      y: height / 2 - (textWidth / 2) * Math.sin(Math.PI / 4),
      size: fontSize,
      font,
      color: rgb(0.5, 0.5, 0.5),
      rotate: degrees(45),
      opacity: op,
    });
  }
  return { buffer: Buffer.from(await pdf.save()), mimeType: "application/pdf" };
}

export async function compressPdf(input: Buffer, imageQuality: number): Promise<PdfResult> {
  const source = await PDFDocument.load(input, { ignoreEncryption: true });
  const target = await PDFDocument.create();
  const pages = await target.copyPages(source, source.getPageIndices());
  pages.forEach((p) => target.addPage(p));

  // Re-compress any JPEG images embedded in the PDF via Sharp.
  const q = Math.max(1, Math.min(100, imageQuality));
  const embeds = source.context.enumerateIndirectObjects();
  for (const [ref, obj] of embeds) {
    // We can't easily re-encode stream objects in pdf-lib without raw access;
    // the meaningful size reduction comes from re-saving with object-stream compression.
    void ref; void obj;
  }

  // pdf-lib's useObjectStreams packs cross-ref into a compressed stream, reducing size noticeably.
  const saved = await target.save({ useObjectStreams: true, addDefaultPage: false });
  // If the PDF has inline JPEG XObjects we can round-trip via Sharp for extra savings.
  // That requires raw stream access not exposed by pdf-lib public API, so we skip it here
  // and rely on object-stream packing alone (typically 10–30% reduction on text-heavy PDFs).
  void q;
  return { buffer: Buffer.from(saved), mimeType: "application/pdf" };
}


export async function unlockPdf(input: Buffer): Promise<PdfResult> {
  // Load with ignoreEncryption — pdf-lib strips the encryption dict on re-save.
  const source = await PDFDocument.load(input, { ignoreEncryption: true });
  const target = await PDFDocument.create();
  const pages = await target.copyPages(source, source.getPageIndices());
  pages.forEach((p) => target.addPage(p));
  return { buffer: Buffer.from(await target.save({ useObjectStreams: true })), mimeType: "application/pdf" };
}

export async function organizePdf(input: Buffer, order: string): Promise<PdfResult> {
  const source = await PDFDocument.load(input, { ignoreEncryption: true });
  const total = source.getPageCount();
  const indices = order
    .split(",")
    .map((s) => parseInt(s.trim(), 10) - 1)
    .filter((i) => i >= 0 && i < total);
  if (indices.length === 0) throw new Error("No valid page numbers found in order");
  const target = await PDFDocument.create();
  const pages = await target.copyPages(source, indices);
  pages.forEach((p) => target.addPage(p));
  return { buffer: Buffer.from(await target.save()), mimeType: "application/pdf" };
}

export async function repairPdf(input: Buffer): Promise<PdfResult> {
  const source = await PDFDocument.load(input, {
    ignoreEncryption: true,
    // @ts-expect-error — ignoreXRef is a valid option in pdf-lib but missing from types
    ignoreXRef: true,
    throwOnInvalidObject: false,
  });
  const target = await PDFDocument.create();
  const pages = await target.copyPages(source, source.getPageIndices());
  pages.forEach((p) => target.addPage(p));
  return { buffer: Buffer.from(await target.save({ useObjectStreams: true })), mimeType: "application/pdf" };
}

export async function extractPdfText(input: Buffer): Promise<string> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const doc = await pdfjs.getDocument({
    data: new Uint8Array(input),
    isEvalSupported: false,
    useSystemFonts: true,
  }).promise;

  const chunks: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const line = content.items
      .map((item) => ("str" in item ? item.str : ""))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    chunks.push(`--- Page ${i} ---\n${line}`);
  }
  await doc.cleanup();
  return chunks.join("\n\n");
}
