/**
 * In-memory handoff for files dragged onto the app from anywhere (GlobalDrop).
 * File objects can't be serialized into the URL or sessionStorage, so we stash
 * them in a module singleton and let the destination tool consume them on mount.
 */

let pending: File[] = [];

export function setPendingFiles(files: File[]): void {
  pending = files;
}

export function consumePendingFiles(): File[] {
  const files = pending;
  pending = [];
  return files;
}
