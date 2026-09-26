export type ToastVariant = "success" | "error" | "info" | "warning";
export interface ToastInput {
  title: string;
  description?: string;
  variant?: ToastVariant;
  duration?: number;
  /** A tool/action scope replaces its own stale message, not another tool's alert. */
  scope?: string;
}
export interface ToastEntry {
  id: number;
  title: string;
  description?: string;
  variant: ToastVariant;
  duration: number;
  scope?: string;
}
/** 顶部悬浮提示同时可见的上限：条数越多堆得越高，越容易遮挡右上角控件。 */
export const MAX_VISIBLE_TOASTS = 2;
export function makeToast(input: ToastInput, id: number): ToastEntry {
  const variants: readonly string[] = ["success", "error", "info", "warning"];
  const variant = variants.includes(input.variant ?? "") ? input.variant! : "info";
  const duration = typeof input.duration === "number" && Number.isFinite(input.duration)
    ? Math.max(0, Math.min(120_000, input.duration))
    : variant === "error" || variant === "warning" ? 3600 : 2400;
  return {
    id,
    title: String(input.title || "操作提示").slice(0, 240),
    description: input.description ? String(input.description).slice(0, 1600) : undefined,
    variant,
    duration,
    scope: input.scope,
  };
}
export function enqueueToast(previous: ToastEntry[], next: ToastEntry): ToastEntry[] {
  const retained = previous.filter((t) => {
    if (next.scope && t.scope === next.scope) return false;
    return !(t.scope === next.scope && t.title === next.title
      && t.description === next.description && t.variant === next.variant);
  });
  return [...retained, next].slice(-MAX_VISIBLE_TOASTS);
}
