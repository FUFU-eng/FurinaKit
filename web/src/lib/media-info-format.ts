/** Pure display/input policy; no filesystem access or business-handler calls. */
export function normalizeLocalPath(input: string): string {
  let value = input.trim();
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"'))
    || (value.startsWith("'") && value.endsWith("'")))) value = value.slice(1, -1).trim();
  return value;
}
function ratio(raw: string | undefined): number | null {
  if (!raw?.trim()) return null;
  const parts = raw.trim().split("/");
  if (parts.length > 2 || parts.some((s) => !s.trim())) return null;
  const numerator = Number(parts[0]), denominator = parts.length === 2 ? Number(parts[1]) : 1;
  const value = numerator / denominator;
  return Number.isFinite(numerator) && Number.isFinite(denominator) && numerator > 0
    && denominator > 0 && Number.isFinite(value) && value > 0 ? value : null;
}
export function formatFrameRate(average?: string, fallback?: string): string | null {
  const value = ratio(average) ?? ratio(fallback);
  if (value === null) return null;
  // Trim only the fractional part: the former >=100 branch turned 120 into 12.
  if (value < 1) return Number(value.toPrecision(4)).toString();
  const fixed = value.toFixed(3);
  return fixed.includes(".") ? fixed.replace(/0+$/, "").replace(/\.$/, "") : fixed;
}
export interface ChapterTime {
  time_base?: string;
  start?: number;
  end?: number;
  start_time?: string;
  end_time?: string;
}
export function chapterSeconds(chapter: ChapterTime, edge: "start" | "end"): number | null {
  const explicit = chapter[edge === "start" ? "start_time" : "end_time"];
  if (explicit !== undefined && explicit.trim() !== "") {
    const n = Number(explicit);
    if (Number.isFinite(n) && n >= 0) return n;
  }
  const ticks = chapter[edge], scale = ratio(chapter.time_base);
  if (ticks === undefined || !Number.isFinite(ticks) || ticks < 0 || scale === null) return null;
  const seconds = ticks * scale;
  return Number.isFinite(seconds) ? seconds : null;
}
export function isImageContainer(name?: string): boolean {
  return !!name && name.split(",").some((s) => ["png_pipe", "jpeg_pipe", "bmp_pipe", "tiff_pipe", "webp_pipe", "jpegls_pipe", "j2k_pipe"].includes(s.trim()));
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
function fieldsValid(value: Record<string, unknown>, strings: string[], numbers: string[]): boolean {
  if (strings.some((k) => value[k] !== undefined && typeof value[k] !== "string")) return false;
  if (numbers.some((k) => value[k] !== undefined && (typeof value[k] !== "number" || !Number.isFinite(value[k])))) return false;
  return value.tags === undefined || (record(value.tags) && Object.values(value.tags).every((v) => typeof v === "string"));
}
/** Reject malformed responses before React renders their values as children. */
export function probeDataIssue(value: unknown): string | null {
  if (!record(value) || !Array.isArray(value.streams)) return "媒体探测返回格式无效";
  if (value.streams.length > 512) return "媒体包含超过 512 个流，超出当前界面上限，请使用 ffprobe 导出完整信息";
  for (const stream of value.streams) {
    if (!record(stream) || !fieldsValid(stream,
      ["codec_type", "codec_name", "profile", "pix_fmt", "avg_frame_rate", "r_frame_rate", "sample_rate", "bit_rate", "duration", "channel_layout"],
      ["index", "width", "height", "channels"])) return "媒体流信息格式无效";
  }
  if (value.format !== undefined && (!record(value.format) || !fieldsValid(value.format,
    ["format_name", "format_long_name", "duration", "size", "bit_rate", "filename"], []))) return "媒体容器信息格式无效";
  if (value.chapters !== undefined) {
    if (!Array.isArray(value.chapters) || value.chapters.length > 4096) return "章节信息无效或超出当前界面上限";
    for (const chapter of value.chapters) if (!record(chapter) || !fieldsValid(chapter,
      ["time_base", "start_time", "end_time"], ["id", "start", "end"])) return "章节信息格式无效";
  }
  return null;
}
