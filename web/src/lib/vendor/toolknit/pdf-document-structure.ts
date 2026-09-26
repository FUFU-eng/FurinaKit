// @ts-nocheck
// ToolKnit Desktop v2.3.1. Copyright 2026 ToolKnit contributors. Apache-2.0.
// Source unchanged except this TypeScript compatibility header.
import { PDFName } from 'pdf-lib';

function widgetAnnotationKeys(document) {
  const keys = new Set();
  for (const page of document.getPages()) {
    const annotations = page.node.Annots();
    if (!annotations) continue;
    for (let index = 0; index < annotations.size(); index++) {
      const reference = annotations.get(index);
      const annotation = document.context.lookup(reference);
      if (String(annotation?.get?.(PDFName.of('Subtype'))) === '/Widget') {
        keys.add(String(reference));
      }
    }
  }
  return keys;
}

function removeWidgetAnnotations(document, knownWidgetKeys) {
  let removed = false;
  for (const page of document.getPages()) {
    const annotations = page.node.Annots();
    if (!annotations) continue;
    for (let index = annotations.size() - 1; index >= 0; index--) {
      const annotation = document.context.lookup(annotations.get(index));
      const subtype = annotation?.get?.(PDFName.of('Subtype'));
      const referenceKey = String(annotations.get(index));
      if (annotation && String(subtype) !== '/Widget' && !knownWidgetKeys.has(referenceKey)) continue;
      annotations.remove(index);
      removed = true;
    }
    if (annotations.size() === 0) page.node.delete(PDFName.of('Annots'));
  }
  return removed;
}

export function flattenPdfFormForPageCopy(document) {
  const form = document?.getForm?.();
  const hasFields = Boolean(form && form.getFields().length > 0);
  const widgetKeys = widgetAnnotationKeys(document);
  if (hasFields) {
    // Page copying cannot carry the source AcroForm field tree safely. Keep the
    // existing widget appearances as page content and remove orphan controls.
    form.flatten({ updateFieldAppearances: false });
  }
  return removeWidgetAnnotations(document, widgetKeys) || hasFields;
}
