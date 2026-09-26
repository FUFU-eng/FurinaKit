"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/ui/toast.tsx");


import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import { Check, X, Info, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { enqueueToast, makeToast, type ToastEntry, type ToastInput, type ToastVariant } from "@/lib/toast-policy";

type ToastContextValue = {
  toast: (input: ToastInput) => void;
  dismiss: (id: number) => void;
  dismissScope: (scope: string) => void;
};
const ToastContext = createContext<ToastContextValue | null>(null);
export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within <ToastProvider>");
  return ctx;
}
/** Prevent stale results from one tool obscuring the next tool or its newer result. */
export function useScopedToast(scope: string) {
  const context = useToast();
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; context.dismissScope(scope); };
  }, [scope, context.dismissScope]);
  const toast = useCallback((input: ToastInput) => {
    if (alive.current) context.toast({ ...input, scope });
  }, [context.toast, scope]);
  return useMemo(() => ({ ...context, toast }), [context, toast]);
}
const variantStyles: Record<ToastVariant, { ring: string; icon: ReactNode }> = {
  success: { ring: "border-success/40 shadow-[0_18px_40px_-22px_hsl(var(--success)/0.6)]", icon: <Check className="h-4 w-4 text-success" /> },
  error: { ring: "border-destructive/40 shadow-[0_18px_40px_-22px_hsl(var(--destructive)/0.6)]", icon: <AlertTriangle className="h-4 w-4 text-destructive" /> },
  warning: { ring: "border-amber-500/40 shadow-[0_18px_40px_-22px_rgb(245_158_11/0.6)]", icon: <AlertTriangle className="h-4 w-4 text-amber-500" /> },
  info: { ring: "border-primary/40 shadow-[0_18px_40px_-22px_hsl(var(--primary)/0.6)]", icon: <Info className="h-4 w-4 text-primary" /> },
};

export function ToastProvider({ children }: { children: ReactNode }) {
  const __locale = __useLanguage();
  const [toasts, setToasts] = useState<ToastEntry[]>([]);
  const [mounted, setMounted] = useState(false);
  const current = useRef<ToastEntry[]>([]);
  const timers = useRef(new Map<number, number>());
  const counter = useRef(0);
  const alive = useRef(true);
  const clearTimer = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.current.delete(id);
  }, []);
  const commit = useCallback((next: ToastEntry[]) => {
    current.current = next;
    setToasts(next);
  }, []);
  useEffect(() => {
    alive.current = true;
    setMounted(true);
    return () => {
      alive.current = false;
      for (const timer of timers.current.values()) window.clearTimeout(timer);
      timers.current.clear();
      current.current = [];
    };
  }, []);
  const dismiss = useCallback((id: number) => {
    clearTimer(id);
    commit(current.current.filter((t) => t.id !== id));
  }, [clearTimer, commit]);
  const dismissScope = useCallback((scope: string) => {
    const removed = current.current.filter((t) => t.scope === scope);
    if (!removed.length) return;
    removed.forEach((t) => clearTimer(t.id));
    commit(current.current.filter((t) => t.scope !== scope));
  }, [clearTimer, commit]);
  const toast = useCallback((input: ToastInput) => {
    if (!alive.current) return;
    const nextToast = makeToast(input, ++counter.current);
    const next = enqueueToast(current.current, nextToast);
    const retained = new Set(next.map((t) => t.id));
    current.current.filter((t) => !retained.has(t.id)).forEach((t) => clearTimer(t.id));
    commit(next);
    if (nextToast.duration > 0) timers.current.set(nextToast.id, window.setTimeout(() => dismiss(nextToast.id), nextToast.duration));
  }, [clearTimer, commit, dismiss]);
  // Keep context stable: showing a toast must not force every tool to re-render.
  useEffect(() => {
    const onDownloadError = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      toast({ title: "下载失败", description: typeof detail === "string" ? detail : "请重试", variant: "error", scope: "download" });
    };
    const onSaved = (event: Event) => {
      const detail = (event as CustomEvent<unknown>).detail;
      toast({ title: "已保存到默认输出目录", description: typeof detail === "string" ? detail : undefined, variant: "success", scope: "download" });
    };
    window.addEventListener("fk-download-error", onDownloadError);
    window.addEventListener("fk-download-saved", onSaved);
    return () => { window.removeEventListener("fk-download-error", onDownloadError); window.removeEventListener("fk-download-saved", onSaved); };
  }, [toast]);
  const context = useMemo(() => ({ toast, dismiss, dismissScope }), [toast, dismiss, dismissScope, __locale]);
  return (
    <ToastContext.Provider value={context}>
      {children}
      {mounted && createPortal(
        <div className="pointer-events-none fixed right-4 top-20 z-[1000] flex w-[calc(100vw-2rem)] max-w-sm flex-col gap-2.5" data-toast-viewport>
          <AnimatePresence initial={false} mode="popLayout">
            {toasts.map((t) => (
              <motion.div key={t.id} layout initial={{ opacity: 0, y: -12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, x: 30, scale: 0.98 }} transition={{ type: "spring", stiffness: 380, damping: 32 }}
                role={t.variant === "error" || t.variant === "warning" ? "alert" : "status"}
                aria-atomic="true" data-toast-scope={t.scope}
                className={cn("glass pointer-events-auto flex items-start gap-3 rounded-lg border bg-card/95 p-3.5 pr-9", variantStyles[t.variant].ring)}>
                <span className="mt-0.5 shrink-0" aria-hidden="true">{variantStyles[t.variant].icon}</span>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 break-words text-sm font-medium leading-snug text-foreground" title={__msg(t.title)}>{__msg(t.title)}</p>
                  {t.description && <p className="mt-0.5 line-clamp-3 break-words text-xs leading-relaxed text-muted-foreground" title={__msg(t.description)}>{__msg(t.description)}</p>}
                </div>
                <button type="button" onClick={() => dismiss(t.id)} className="absolute right-2.5 top-2.5 rounded text-muted-foreground/60 transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary" aria-label={__ui("关闭提示")}><X className="h-3.5 w-3.5" /></button>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>, document.body)}
    </ToastContext.Provider>
  );
}
