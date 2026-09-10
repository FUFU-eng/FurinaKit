"use client";

import { useState, useEffect, useCallback } from "react";
import { X, FolderOpen, Power, Check, Sparkles, RefreshCw, ArrowUpCircle, LogOut, FileText } from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { APP_VERSION, APP_NAME } from "@/lib/version";
import { UpdateModal } from "@/components/layout/update-modal";
import { checkForUpdates } from "@/lib/updater";
import { cn } from "@/lib/utils";

interface Settings {
  autoStart: boolean;
  outputDir: string;
  closeAction?: "tray" | "quit";
}

const DEFAULT_SETTINGS: Settings = {
  autoStart: false,
  outputDir: process.env.FURINAKIT_DEFAULT_OUTPUT_DIR || "",
  closeAction: "tray",
};

const STORAGE_KEY = "furinakit:settings";

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { colors } = useTheme();
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [saved, setSaved] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [updateTab, setUpdateTab] = useState<"check" | "changelog">("check");
  const [hasUpdate, setHasUpdate] = useState(false);

  // 加载设置
  useEffect(() => {
    if (open) {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          setSettings({ ...DEFAULT_SETTINGS, ...JSON.parse(raw) });
        }
      } catch {
        /* ignore */
      }
      setSaved(false);
      checkForUpdates()
        .then((res) => {
          setHasUpdate(res.hasUpdate);
        })
        .catch(() => {});
    }
  }, [open]);

  const updateSetting = useCallback((key: keyof Settings, value: string | boolean) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setSaved(false);
  }, []);

  const handleApply = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
      setSaved(true);
      // 通知 worker 更新输出目录（如果有 IPC 的话）
      if (typeof window !== "undefined" && window.furinakit?.applySettings) {
        window.furinakit.applySettings(settings as unknown as Record<string, unknown>);
      }
      setTimeout(() => setSaved(false), 2000);
    } catch {
      /* ignore */
    }
  }, [settings]);

  const handleSelectDir = useCallback(
    (key: keyof Settings) => {
      // 调用 Electron 的文件夹选择对话框
      if (typeof window !== "undefined" && window.furinakit?.selectDirectory) {
        window.furinakit
          .selectDirectory()
          .then((dir: string | null) => {
            if (dir) updateSetting(key, dir);
          })
          .catch(() => {});
      } else {
        // 浏览器环境下用 prompt 模拟
        const dir = prompt("请输入目录路径:", settings[key] as string);
        if (dir !== null) updateSetting(key, dir);
      }
    },
    [settings, updateSetting]
  );

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: "rgba(0,0,0,0.5)", backdropFilter: "blur(4px)" }}
      onClick={onClose}
    >
      <div
        className="relative w-[580px] max-w-[92vw] rounded-2xl border shadow-2xl"
        style={{ background: colors.card, borderColor: colors.borderSolid }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: `1px solid ${colors.border}` }}
        >
          <h2 className="text-[17px] font-bold" style={{ color: colors.text }}>
            设置
          </h2>
          <button
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg transition-colors"
            style={{ color: colors.muted }}
            onMouseEnter={(e) => (e.currentTarget.style.background = colors.dropdownHover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = "transparent")}
          >
            <X size={18} />
          </button>
        </div>

        {/* 内容区 */}
        <div className="max-h-[60vh] overflow-y-auto px-6 py-5">
          {/* 常用设置 */}
          <div className="mb-6">
            <h3 className="mb-3 text-[13px] font-semibold" style={{ color: colors.muted }}>
              常用设置
            </h3>
            <div className="flex items-center justify-between rounded-xl px-4 py-3" style={{ background: colors.bg }}>
              <div className="flex items-center gap-3">
                <Power size={18} style={{ color: colors.gold }} />
                <span className="text-[14px]" style={{ color: colors.text }}>
                  开机自启
                </span>
              </div>
              <button
                onClick={() => updateSetting("autoStart", !settings.autoStart)}
                className="relative h-6 w-11 shrink-0 overflow-hidden rounded-full transition-colors"
                style={{ background: settings.autoStart ? colors.gold : colors.mutedDark }}
              >
                <span
                  className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-200"
                  style={{ 
                    transform: settings.autoStart ? "translateX(22px)" : "translateX(2px)",
                    left: 0,
                  }}
                />
              </button>
            </div>

            {/* 关闭主窗口时动作 */}
            <div className="mt-3 flex items-center justify-between rounded-xl px-4 py-3" style={{ background: colors.bg }}>
              <div className="flex items-center gap-3">
                <LogOut size={18} style={{ color: colors.gold }} />
                <div>
                  <div className="text-[14px]" style={{ color: colors.text }}>
                    关闭主窗口时
                  </div>
                  <div className="text-[12px]" style={{ color: colors.muted }}>
                    {settings.closeAction === "quit" ? "彻底退出软件，完全释放所有后台服务与内存" : "最小化到系统托盘，保持后台待命"}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 rounded-lg p-1" style={{ background: colors.card, border: `1px solid ${colors.borderSolid}` }}>
                <button
                  type="button"
                  onClick={() => updateSetting("closeAction", "tray")}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[12px] font-medium transition-all",
                    settings.closeAction !== "quit" ? "shadow-sm" : ""
                  )}
                  style={{
                    background: settings.closeAction !== "quit" ? colors.gold : "transparent",
                    color: settings.closeAction !== "quit" ? "#fff" : colors.muted,
                  }}
                >
                  最小化到托盘
                </button>
                <button
                  type="button"
                  onClick={() => updateSetting("closeAction", "quit")}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-[12px] font-medium transition-all",
                    settings.closeAction === "quit" ? "shadow-sm" : ""
                  )}
                  style={{
                    background: settings.closeAction === "quit" ? colors.gold : "transparent",
                    color: settings.closeAction === "quit" ? "#fff" : colors.muted,
                  }}
                >
                  直接彻底退出
                </button>
              </div>
            </div>
          </div>

          {/* 输出目录 */}
          <div>
            <h3 className="mb-3 text-[13px] font-semibold" style={{ color: colors.muted }}>
              输出目录
            </h3>
            <div className="flex items-center gap-3">
              <input
                type="text"
                value={settings.outputDir}
                onChange={(e) => updateSetting("outputDir", e.target.value)}
                placeholder="请选择输出目录"
                className="flex-1 rounded-lg border px-3 py-2 text-[13px] outline-none transition-colors"
                style={{
                  background: colors.bg,
                  borderColor: colors.borderSolid,
                  color: colors.text,
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = colors.gold)}
                onBlur={(e) => (e.currentTarget.style.borderColor = colors.borderSolid)}
              />
              <button
                onClick={() => handleSelectDir("outputDir")}
                className="flex h-9 shrink-0 items-center gap-1.5 rounded-lg border px-3 text-[13px] transition-all"
                style={{
                  background: colors.card,
                  borderColor: colors.borderSolid,
                  color: colors.text,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = colors.dropdownHover;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = colors.card;
                }}
              >
                <FolderOpen size={15} />
                选择
              </button>
            </div>
          </div>

          {/* 关于与版本 */}
          <div className="mt-6 pt-5" style={{ borderTop: `1px solid ${colors.border}` }}>
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-[13px] font-semibold" style={{ color: colors.muted }}>
                关于与版本
              </h3>
              {hasUpdate && (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary">
                  <span className="relative flex h-1.5 w-1.5">
                    <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75" />
                    <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-primary" />
                  </span>
                  发现新版本
                </span>
              )}
            </div>

            <div
              className={cn(
                "rounded-2xl border p-4 transition-all duration-200",
                hasUpdate
                  ? "border-primary/40 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent shadow-[0_4px_20px_rgba(217,119,6,0.08)] dark:shadow-[0_4px_20px_rgba(56,189,248,0.1)]"
                  : "border-border/60"
              )}
              style={{
                background: hasUpdate ? undefined : colors.bg,
                borderColor: hasUpdate ? undefined : colors.borderSolid,
              }}
            >
              <div className="flex items-center justify-between gap-4">
                {/* 左侧：图标与版本信息 */}
                <div className="flex items-center gap-3.5 min-w-0">
                  <div
                    className={cn(
                      "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl shadow-xs transition-transform",
                      hasUpdate
                        ? "bg-primary text-primary-foreground shadow-sm shadow-primary/20"
                        : "bg-primary/10 text-primary"
                    )}
                  >
                    {hasUpdate ? <ArrowUpCircle size={22} className="animate-pulse" /> : <Sparkles size={20} />}
                  </div>

                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-bold tracking-tight whitespace-nowrap" style={{ color: colors.text }}>
                        {APP_NAME}
                      </span>
                      <span className="inline-flex items-center rounded-md border border-primary/20 bg-primary/10 px-2 py-0.5 text-[11px] font-mono font-semibold text-primary shrink-0 whitespace-nowrap">
                        v{APP_VERSION}
                      </span>
                    </div>
                    <p className="mt-0.5 text-[12px] text-muted-foreground whitespace-nowrap truncate">
                      {hasUpdate ? "云端有新的功能与体验改进可用" : "当前已是最新稳定版本，运行良好"}
                    </p>
                  </div>
                </div>

                {/* 右侧：操作按钮组 */}
                <div className="flex items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setUpdateTab("changelog");
                      setUpdateOpen(true);
                    }}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[12px] font-medium transition-all hover:border-primary text-muted-foreground hover:text-foreground shrink-0 whitespace-nowrap"
                    style={{ borderColor: colors.borderSolid }}
                  >
                    <FileText size={13} className="shrink-0" />
                    更新日志
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUpdateTab("check");
                      setUpdateOpen(true);
                    }}
                    className={cn(
                      "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3.5 text-[12px] font-medium transition-all shrink-0 whitespace-nowrap",
                      hasUpdate
                        ? "bg-primary text-primary-foreground border-primary shadow-xs hover:brightness-105 active:scale-95 font-semibold"
                        : "hover:border-primary text-primary hover:bg-primary/5"
                    )}
                    style={{ borderColor: hasUpdate ? undefined : colors.borderSolid }}
                  >
                    <RefreshCw size={13} className={cn("shrink-0", hasUpdate ? "animate-spin-slow" : "")} />
                    {hasUpdate ? "查看新版" : "检查更新"}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 底部按钮 */}
        <div
          className="flex items-center justify-end gap-3 px-6 py-4"
          style={{ borderTop: `1px solid ${colors.border}` }}
        >
          {saved && (
            <span className="flex items-center gap-1.5 text-[13px]" style={{ color: colors.green }}>
              <Check size={15} />
              已保存
            </span>
          )}
          <button
            onClick={handleApply}
            className="flex h-10 items-center gap-2 rounded-xl px-5 text-[14px] font-medium text-white transition-all hover:opacity-90"
            style={{ background: colors.gold }}
          >
            全部应用
          </button>
        </div>
      </div>

      <UpdateModal open={updateOpen} onClose={() => setUpdateOpen(false)} initialTab={updateTab} />
    </div>
  );
}
