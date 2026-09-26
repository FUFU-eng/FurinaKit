/** Only identity tags: never retain files in a global strong-reference cache. */
const injected = new WeakSet<File>();
export function markPendingFile(file: File) { injected.add(file); }
export function isPendingFile(file: File) { return injected.has(file); }
