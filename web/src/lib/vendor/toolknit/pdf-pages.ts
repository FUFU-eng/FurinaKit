// @ts-nocheck
// Adapted subset of ToolKnit Desktop v2.3.1, Copyright 2026 ToolKnit contributors.
// Apache-2.0; see docs/third-party/toolknit-{LICENSE,NOTICE}.txt.
// Modification: page assembly subset only; removed unrelated text/encryption imports.
import {PDFDocument,degrees} from "pdf-lib";
import {flattenPdfFormForPageCopy} from "./pdf-document-structure";
export const PDF_EDITOR_LIMITS = Object.freeze({
  maxInputBytes: 150 * 1024 * 1024,
  maxPages: 500,
  maxMergeFiles: 25,
  maxMergeTotalBytes: 150 * 1024 * 1024
});

export function assertPdfEditorFile(name, size, limits = PDF_EDITOR_LIMITS) {
  if (!/\.pdf$/i.test(String(name || ''))) {
    throw new Error('A PDF file is required');
  }
  if (!Number.isSafeInteger(size) || size < 1) {
    throw new Error('Invalid PDF file size');
  }
  if (size > limits.maxInputBytes) {
    throw new Error(`PDF input exceeds the ${Math.floor(limits.maxInputBytes / 1024 / 1024)}MB editor limit`);
  }
}

export function assertPdfEditorPageCount(count, limits = PDF_EDITOR_LIMITS) {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new Error('PDF has no pages');
  }
  if (count > limits.maxPages) {
    throw new Error(`PDF input exceeds the ${limits.maxPages}-page editor limit`);
  }
}

export function assertPdfEditorMergeSelection(sources, totalBytes, limits = PDF_EDITOR_LIMITS) {
  if (!Array.isArray(sources) || sources.length < 1) {
    throw new Error('No PDF source is available');
  }
  if (sources.length > limits.maxMergeFiles) {
    throw new Error(`PDF editor accepts at most ${limits.maxMergeFiles} files at a time`);
  }
  if (!Number.isSafeInteger(totalBytes) || totalBytes < 0) {
    throw new Error('Invalid PDF source size');
  }
  if (totalBytes > limits.maxMergeTotalBytes) {
    throw new Error(`PDF inputs exceed the ${Math.floor(limits.maxMergeTotalBytes / 1024 / 1024)}MB merge limit`);
  }
}

export function normalizePageRotation(value) {
  const number = Number(value) || 0;
  return ((number % 360) + 360) % 360;
}

export function resolvePdfPageRotation(sourceRotation, editRotation = 0) {
  return normalizePageRotation(
    normalizePageRotation(sourceRotation) + normalizePageRotation(editRotation)
  );
}

export function sanitizePdfBaseName(sourceName) {
  const baseName = String(sourceName || 'document.pdf')
    .split(/[\\/]/)
    .pop()
    .replace(/\.pdf$/i, '')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim() || 'document';
  return baseName;
}

export function buildPdfName(sourceName, suffix) {
  return `${sanitizePdfBaseName(sourceName)}_${String(suffix || 'edited')}.pdf`;
}

async function loadPdfLibDocument(bytes) {
  return PDFDocument.load(bytes.slice());
}

async function loadInPlaceAssemblyTarget(sources, pages) {
  if (sources.length !== 1 || !sources[0]?.bytes?.length) return null;
  if (!pages.every((pageRef, index) => (
    pageRef?.sourceIndex === 0
    && pageRef.pageIndex === index
  ))) return null;
  const document = await loadPdfLibDocument(sources[0].bytes);
  return document.getPageCount() === pages.length ? document : null;
}

/**
 * Assemble an ordered page list into a single PDF document.
 *
 * @param {object} params
 * @param {Array<{ name: string, bytes: Uint8Array }>} params.sources
 * @param {Array<{ sourceIndex: number, pageIndex: number, rotation: number }>} params.pages
 * @param {boolean} [params.useObjectStreams]
 * @param {(info: { done: number, total: number }) => void} [params.onProgress]
 * @returns {Promise<Uint8Array>}
 */
export async function assemblePdf({ sources, pages, useObjectStreams = true, onProgress }) {
  if (!Array.isArray(sources) || !Array.isArray(pages) || pages.length === 0) {
    throw new Error('No PDF pages are available to assemble');
  }

  const inPlaceOutput = await loadInPlaceAssemblyTarget(sources, pages);
  if (inPlaceOutput) {
    for (let index = 0; index < pages.length; index++) {
      const page = inPlaceOutput.getPage(index);
      page.setRotation(degrees(
        page.getRotation().angle + normalizePageRotation(pages[index].rotation)
      ));
      onProgress?.({ done: index + 1, total: pages.length });
    }
    return inPlaceOutput.save({ useObjectStreams });
  }

  const output = await PDFDocument.create();
  const sourceCache = new Map();

  for (let index = 0; index < pages.length; index++) {
    const pageRef = pages[index];
    const source = sources[pageRef.sourceIndex];
    if (!source?.bytes?.length) {
      throw new Error(`Missing PDF data for source index ${pageRef.sourceIndex}`);
    }
    if (!Number.isInteger(pageRef.pageIndex) || pageRef.pageIndex < 0) {
      throw new Error(`Invalid page index for source index ${pageRef.sourceIndex}`);
    }

    let sourceDoc = sourceCache.get(pageRef.sourceIndex);
    if (!sourceDoc) {
      sourceDoc = await loadPdfLibDocument(source.bytes);
      flattenPdfFormForPageCopy(sourceDoc);
      sourceCache.set(pageRef.sourceIndex, sourceDoc);
    }
    if (pageRef.pageIndex >= sourceDoc.getPageCount()) {
      throw new Error(`Page ${pageRef.pageIndex + 1} is outside source index ${pageRef.sourceIndex}`);
    }

    const [copiedPage] = await output.copyPages(sourceDoc, [pageRef.pageIndex]);
    copiedPage.setRotation(degrees(
      copiedPage.getRotation().angle + normalizePageRotation(pageRef.rotation)
    ));
    output.addPage(copiedPage);
    onProgress?.({ done: index + 1, total: pages.length });
  }

  return output.save({ useObjectStreams });
}

