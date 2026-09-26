import { acceptsFile } from "./pending-file-model";

export type ImportRejection = { file: File; errors: readonly { code: string; message: string }[] };
export type ImportOptions = {
  multiple: boolean;
  maxFiles?: number;
  accept?: Record<string, string[]>;
  replace?: boolean;
};

/** Feedback belongs to a concrete selection, not to the lifetime of the dropzone. */
export function sameFileSelection(left: readonly File[], right: readonly File[]): boolean {
  return left.length === right.length && left.every((file, index) => file === right[index]);
}

function names(files: File[]): string {
  const preview = files.slice(0, 3).map(file => `“${file.name}”`).join("、");
  return preview + (files.length > 3 ? `等 ${files.length} 个文件` : "");
}

/** One policy for picker, drag/drop, folder imports and pending-file replacement.
 * Only metadata is inspected here; media decoding/validity belongs to the backend.
 * No artificial size cap or whole-file read is introduced for large videos.
 */
export function resolveFileImport(
  current: File[], incoming: File[], options: ImportOptions, libraryRejections: ImportRejection[] = [],
): { files: File[]; changed: boolean; message: string | null; wrongType: File[] } {
  const rule = Object.entries(options.accept || {}).flatMap(([mime, extensions]) => [mime, ...extensions]).join(",");
  const offered = [...new Set(incoming)];
  const wrongType = offered.filter(file => !acceptsFile(file, rule));
  // Re-evaluate type/count with the shared policy, but never ignore size/read/custom errors.
  const blocked = new Map(libraryRejections.map(item => [item.file,
    item.errors.filter(error => !["file-invalid-type", "too-many-files"].includes(error.code))]));
  const valid = offered.filter(file => acceptsFile(file, rule) && !blocked.get(file)?.length);
  const retained = current.length ? "当前已选文件已保留。" : "未导入文件。";
  const replace = options.replace || !options.multiple;
  const total = valid.length + (replace ? 0 : current.length);
  if ((!options.multiple && valid.length > 1) || (options.maxFiles && total > options.maxFiles)) {
    return { files: current, changed: false, wrongType, message: !options.multiple
      ? `这里只能选择一个文件。${retained}`
      : `总计 ${total} 个文件，超过上限 ${options.maxFiles}；未截断或丢弃文件，请减少后重试。${retained}` };
  }
  const problems: string[] = [];
  if (wrongType.length) problems.push(`${names(wrongType)}格式不受此工具支持，未导入。`);
  for (const file of offered) {
    const errors = blocked.get(file);
    if (!errors?.length || wrongType.includes(file)) continue;
    const reason = errors.some(error => error.code === "file-too-large") ? "超过文件大小上限"
      : errors.some(error => error.code === "file-too-small") ? "小于文件大小下限"
      : errors.map(error => error.message).join("；") || "文件读取失败";
    problems.push(`${names([file])}未导入：${reason}。`);
  }
  if (!valid.length) return { files: current, changed: false, wrongType,
    message: offered.length ? problems.join("") + retained : null };
  const next = replace ? valid : [...current, ...valid];
  return { files: next, changed: true, wrongType,
    message: problems.length ? `已导入 ${valid.length} 个文件；${problems.join("")}` : null };
}
