
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/floating-screenshot-tool.tsx");
import { useRef, useState } from "react";
import { Select } from "@/components/ui/primitives";
import { invoke } from "@tauri-apps/api/core";
import {
  Camera,
  Copy,
  ScanText,
  Languages,
  Sparkles,
  Pencil,
  ListPlus,
} from "lucide-react";
export function FloatingScreenshotTool() {
  const __locale = __useLanguage();
  const [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [delay, setDelay] = useState(0);
  const running = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  const capture = async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setMessage("请框选需要的区域，Enter 确认；Esc / 右键取消。");
    try {
      const r = await invoke<{ cancelled?: boolean }>("capture_floating", {
        delayMs: delay * 1000,
      });
      setMessage(
        r.cancelled
          ? "已取消，未创建贴图。"
          : "截图已悬浮在桌面，可拖动、缩放，或使用贴图下方的六个动作。",
      );
    } catch (e) {
      setMessage(String(e));
    } finally {
      running.current = false;
      setBusy(false);
    }
  };
  const pin = async (file: File | undefined) => {
    if (!file || running.current) return;
    running.current = true;
    setBusy(true);
    try {
      if (file.size > 32 * 1024 * 1024) throw new Error("图片超过 32 MiB");
      const data = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(new Error("图片读取失败"));
        r.readAsDataURL(file);
      });
      await invoke("pin_image", { dataUrl: data });
      setMessage("图片已悬浮，未自动执行识别、翻译或强化。");
    } catch (e) {
      setMessage(String(e));
    } finally {
      running.current = false;
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };
  return (
    <section className="rounded-2xl border border-border bg-card p-6">
      <div className="mb-4 flex items-center gap-3">
        <Camera className="text-primary" />
        <h2 className="text-lg font-semibold">{__ui("让截图留在手边")}</h2>
      </div>
      <p className="mb-5 text-sm leading-7 text-muted-foreground">
        {__ui("直接框选桌面区域，确认后生成独立置顶贴图。原始像素保留，拖动标题栏移动贴图，拖动边框调整显示大小。")}</p>
      <div className="flex flex-wrap items-center gap-3">
        <button
          disabled={busy}
          onClick={() => void capture()}
          className="rounded-xl bg-primary px-5 py-3 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {busy ? __ui("正在截图…") : __ui("框选并悬浮")}
        </button>
        <label className="text-sm">
          {__ui("延时")}{" "}
          <Select
            value={delay}
            disabled={busy}
            onChange={(e) => setDelay(Number(e.target.value))}
            className="inline-block w-auto ml-2"
            triggerClassName="h-10 rounded-xl px-3 inline-flex w-auto min-w-28 text-sm"
          >
            <option value={0}>{__ui("立即")}</option>
            <option value={3}>{__ui("3 秒")}</option>
            <option value={5}>{__ui("5 秒")}</option>
          </Select>
        </label>
        <input
          ref={input}
          type="file"
          accept="image/png"
          data-pending-ignore
          hidden
          onChange={(e) => void pin(e.target.files?.[0])}
        />
        <button
          disabled={busy}
          className="rounded-xl border px-4 py-3 text-sm"
          onClick={() => input.current?.click()}
        >
          {__ui("导入 PNG 贴图")}</button>
      </div>
      <p role="status" className="my-4 text-sm text-muted-foreground">
        {__msg(message)}
      </p>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {[
          [Copy, "复制", "写入系统剪贴板"],
          [ScanText, "取字", "打开截图取字并自动识别"],
          [Languages, "翻译", "识别后发送文字到翻译服务"],
          [Sparkles, "强化", "打开高清强化并处理这张截图"],
          [Pencil, "编辑", "独立窗口：裁剪、旋转、文字、涂鸦"],
          [ListPlus, "加入待办", "追加 / 替换 / 取消，等待手动操作"],
        ].map(([Icon, title, desc]) => {
          const I = Icon as typeof Camera;
          return (
            <div key={String(title)} className="rounded-xl border p-4">
              <I size={18} className="mb-3 text-primary" />
              <h3 className="text-sm font-medium">{__msg(String(title))}</h3>
              <p className="mt-1 text-xs leading-6 text-muted-foreground">
                {__msg(String(desc))}
              </p>
            </div>
          );
        })}
      </div>
      <p className="mt-5 text-xs text-muted-foreground">
        {__ui("贴图仅在本次运行中保留；需要长期保存请使用“另存 PNG”。截图取字在本机运行；翻译会发送识别文字到在线服务。")}</p>
    </section>
  );
}
