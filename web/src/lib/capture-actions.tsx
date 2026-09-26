
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("lib/capture-actions.tsx");
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { navigate, usePathname } from "@/router";
import { usePendingFiles } from "./pending-files-context";
import { fromFiles } from "./pending-file-model";
import { imageBlob } from "./screenshot-ocr";

export interface CaptureAction {
  requestId: string;
  action: "ocr" | "translate" | "upscale" | "pending";
  dataUrl: string;
  width: number;
  height: number;
}
const targets = {
  ocr: "screenshot-ocr",
  translate: "screenshot-translate",
  upscale: "image-upscale",
  pending: "",
};
const Context = createContext<{
  active: CaptureAction | null;
  claim: (id: string) => boolean;
  clear: () => void;
  reportError: (error: unknown) => void;
}>({
  active: null,
  claim: () => false,
  clear: () => {},
  reportError: () => {},
});
export function CaptureActionsProvider({ children }: { children: ReactNode }) {
  const __locale = __useLanguage();
  const [active, setActive] = useState<CaptureAction | null>(null);
  const [incoming, setIncoming] = useState<CaptureAction | null>(null);
  const [error, setError] = useState("");
  const reportError = useCallback(
    (e: unknown) => setError(`截图动作执行失败：${String(e)}`),
    [],
  );
  const pathname = usePathname();
  const { pendingFiles, setPendingFiles } = usePendingFiles();
  const claimed = useRef<string | null>(null);
  const claim = useCallback((id: string) => {
    if (claimed.current === id) return false;
    claimed.current = id;
    return true;
  }, []);
  const addPending = (shot: CaptureAction, append: boolean) => {
    try {
      const file = new File(
        [imageBlob(shot.dataUrl)],
        `截图-${shot.requestId}.png`,
        { type: "image/png" },
      );
      setPendingFiles([...(append ? pendingFiles : []), ...fromFiles([file])]);
      setIncoming(null);
      setActive(null);
      navigate("/?c=image");
    } catch (e) {
      setError(String(e));
    }
  };
  const receive = useRef((shot: CaptureAction) => {});
  receive.current = (shot) => {
    if (shot.action === "pending") {
      setIncoming(shot);
      return;
    }
    setIncoming(null);
    setActive(shot);
    navigate(`/tools/${targets[shot.action]}`);
  };
  useEffect(() => {
    let disposed = false,
      unlisten: (() => void) | undefined;
    // One take at a time; do not consume before a StrictMode probe effect is cleaned up.
    let running = false,
      again = false;
    const drain = async () => {
      if (disposed) return;
      if (running) {
        again = true;
        return;
      }
      running = true;
      try {
        do {
          again = false;
          const action = await invoke<CaptureAction | null>("shot_take_action");
          if (action) receive.current(action);
        } while (again && !disposed);
      } catch (e) {
        if (!disposed) setError(`接收截图失败：${String(e)}`);
      } finally {
        running = false;
      }
    };
    const timer = setTimeout(() => {
      void listen("capture-action-ready", () => void drain())
        .then((un) => {
          if (disposed) un();
          else {
            unlisten = un;
            void drain();
          }
        })
        .catch((e) => setError(String(e)));
    }, 0);
    return () => {
      disposed = true;
      clearTimeout(timer);
      unlisten?.();
    };
  }, []);
  useEffect(() => {
    if (active && pathname !== `/tools/${targets[active.action]}`)
      // Navigation notifies useSyncExternalStore before a newly queued action commits.
      // A stale cleanup for the previous request must never erase that next request.
      setActive((current) =>
        current?.requestId === active.requestId ? null : current,
      );
  }, [pathname, active]);
  useEffect(() => {
    if (incoming && !pendingFiles.length) addPending(incoming, false);
  }, [incoming, pendingFiles.length]);
  return (
    <Context.Provider
      value={{ active, claim, clear: () => setActive(null), reportError }}
    >
      {children}
      {error && (
        <div
          role="alert"
          className="fixed bottom-5 right-5 z-[230] max-w-md rounded-xl border bg-card p-4 text-sm"
        >
          {__msg(error)}
          <button className="ml-3 underline" onClick={() => setError("")}>
            {__ui("关闭")}</button>
        </div>
      )}
      {incoming && pendingFiles.length > 0 && (
        <div
          className="fixed inset-0 z-[220] grid place-items-center bg-black/50 p-6"
          onKeyDown={(e) => {
            if (e.key === "Escape") setIncoming(null);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="capture-pending-title"
            className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-xl"
          >
            <h2 id="capture-pending-title" className="text-lg font-semibold">
              {__ui("如何加入这张截图？")}</h2>
            <p className="my-4 text-sm text-muted-foreground">
              {__ui("待办中已有")}{pendingFiles.length}{" "}
              {__ui("个文件。加入后只载入图片工具，等待你的操作，不自动处理。")}</p>
            <div className="flex flex-wrap gap-3">
              <button
                autoFocus
                className="rounded-lg bg-primary px-4 py-2 text-primary-foreground"
                onClick={() => addPending(incoming, true)}
              >
                {__ui("追加")}</button>
              <button
                className="rounded-lg border px-4 py-2"
                onClick={() => addPending(incoming, false)}
              >
                {__ui("替换")}</button>
              <button
                className="rounded-lg border px-4 py-2"
                onClick={() => setIncoming(null)}
              >
                {__ui("取消")}</button>
            </div>
          </section>
        </div>
      )}
    </Context.Provider>
  );
}
export function useCaptureState() {
  return useContext(Context);
}
/** Explicit action only. Ordinary files/pending events never pass through this hook. */
export function useCaptureAction(
  toolId: string,
  handler: (action: CaptureAction) => void | Promise<void>,
) {
  const { active, claim, reportError } = useCaptureState();
  const callback = useRef(handler);
  callback.current = handler;
  useEffect(() => {
    if (!active || targets[active.action] !== toolId) return;
    const timer = setTimeout(() => {
      if (claim(active.requestId))
        void Promise.resolve()
          .then(() => callback.current(active))
          .catch(reportError);
    }, 0);
    return () => clearTimeout(timer);
  }, [active, claim, toolId, reportError]);
}
