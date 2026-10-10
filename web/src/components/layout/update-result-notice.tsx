"use client";
/**
 * 静默自动更新的结果提示（启动时检查一次）。
 *  - 更新成功：右下角提示「已更新到 x.y.z」。
 *  - 更新没成功：显示一个小卡片，可以「手动安装」（打开普通安装向导）或忽略。
 * 结果由后端 take_update_result 读取一次后即删除，不会重复提示。
 */
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useToast } from "@/components/ui/toast";

type UpdateResult =
  | { status: "none" }
  | { status: "updated"; from: string; to: string }
  | { status: "failed"; from: string; installer: string | null };

export function UpdateResultNotice() {
  const { toast } = useToast();
  const [failed, setFailed] = useState<{ installer: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    invoke<UpdateResult>("take_update_result")
      .then((result) => {
        if (!alive || !result) return;
        if (result.status === "updated") {
          toast({ title: "已自动更新完成", description: `FurinaKit 已从 v${result.from} 更新到 v${result.to}`, variant: "success" });
        } else if (result.status === "failed") {
          setFailed({ installer: result.installer });
        }
      })
      .catch(() => { /* 浏览器预览或隔离测试环境没有这个命令，忽略 */ });
    return () => { alive = false; };
  }, [toast]);

  if (!failed) return null;

  const manualInstall = async () => {
    if (!failed.installer) return;
    setBusy(true);
    try {
      await invoke("install_update_interactive", { path: failed.installer });
    } catch (e) {
      setBusy(false);
      toast({ title: "无法打开安装程序", description: e instanceof Error ? e.message : String(e), variant: "error" });
    }
  };

  return (
    <div
      role="alert"
      className="fixed bottom-5 right-5 z-[9999] w-[340px] rounded-2xl border border-amber-500/40 bg-background/95 p-4 text-sm shadow-xl backdrop-blur"
    >
      <p className="font-semibold text-foreground">自动更新没有完成</p>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        {failed.installer
          ? "新版本安装包已经下载好了，但后台安装没有成功（可能被安全软件拦截）。可以点「手动安装」打开安装向导完成更新。"
          : "后台安装没有成功，安装包也找不到了。请到「设置 → 检查更新」重新下载。"}
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          className="rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted"
          onClick={() => setFailed(null)}
        >
          以后再说
        </button>
        {failed.installer && (
          <button
            type="button"
            disabled={busy}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            onClick={() => void manualInstall()}
          >
            {busy ? "正在打开…" : "手动安装"}
          </button>
        )}
      </div>
    </div>
  );
}
