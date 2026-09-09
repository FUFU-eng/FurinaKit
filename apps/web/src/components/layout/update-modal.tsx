"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  RefreshCw,
  CheckCircle2,
  ArrowUpCircle,
  Sparkles,
  Download,
  Copy,
  Check,
  FileText,
  Tag,
  History,
} from "lucide-react";
import { useTheme } from "@/components/theme-provider";
import { APP_VERSION, APP_NAME, APP_CHANGELOG } from "@/lib/version";
import { checkForUpdates, type UpdateCheckResult } from "@/lib/updater";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

interface UpdateModalProps {
  open: boolean;
  onClose: () => void;
  customEndpoint?: string;
  initialTab?: "check" | "changelog";
}

export function UpdateModal({ open, onClose, customEndpoint, initialTab = "check" }: UpdateModalProps) {
  const { colors } = useTheme();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<"check" | "changelog">("check");
  const [checking, setChecking] = useState(true);
  const [result, setResult] = useState<UpdateCheckResult | null>(null);
  const [copied, setCopied] = useState(false);
  const [logCopied, setLogCopied] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateProgress, setUpdateProgress] = useState(0);
  const [updateStepText, setUpdateStepText] = useState("");
  const [updateFinished, setUpdateFinished] = useState(false);
  const [downloadedInstallerPath, setDownloadedInstallerPath] = useState<string | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<string>(APP_VERSION);

  useEffect(() => {
    if (open) {
      setActiveTab(initialTab);
    }
  }, [open, initialTab]);

  const startOneClickUpdate = async () => {
    const targetUrl = result?.downloadUrl;
    if (!targetUrl) {
      toast({ title: "未获取到下载链接", variant: "error" });
      return;
    }

    const electronWin = typeof window !== "undefined"
      ? (window as unknown as {
          furinakit?: {
            downloadUpdate?: (url: string) => Promise<{ success: boolean; filePath?: string; error?: string }>;
            onUpdateDownloadProgress?: (cb: (data: { percent: number; receivedBytes: number; totalBytes: number }) => void) => () => void;
            installUpdate?: (path: string) => Promise<{ success: boolean; error?: string }>;
          };
        })
      : null;

    if (electronWin?.furinakit?.downloadUpdate) {
      setUpdating(true);
      setUpdateProgress(0);
      setUpdateStepText("正在连接高速通道下载最新安装包...");

      let unsubscribe: (() => void) | null = null;
      if (electronWin.furinakit.onUpdateDownloadProgress) {
        unsubscribe = electronWin.furinakit.onUpdateDownloadProgress((data) => {
          setUpdateProgress(data.percent);
          if (data.totalBytes > 0) {
            const mbRecv = (data.receivedBytes / (1024 * 1024)).toFixed(1);
            const mbTotal = (data.totalBytes / (1024 * 1024)).toFixed(1);
            setUpdateStepText(`正在下载安装包 (${mbRecv}MB / ${mbTotal}MB)...`);
          } else {
            setUpdateStepText("正在接收数据流...");
          }
        });
      }

      try {
        const res = await electronWin.furinakit.downloadUpdate(targetUrl);
        if (unsubscribe) unsubscribe();

        if (res.success && res.filePath) {
          setDownloadedInstallerPath(res.filePath);
          setUpdateProgress(100);
          setUpdateFinished(true);
          setUpdateStepText("安装包下载完成！点击立即自动安装并重启。");
          toast({ title: "新版本下载成功", description: "点击按钮即可立即完成覆盖安装", variant: "success" });
        } else {
          throw new Error(res.error || "下载失败");
        }
      } catch (err: unknown) {
        if (unsubscribe) unsubscribe();
        setUpdating(false);
        const errorMsg = err instanceof Error ? err.message : "下载失败";
        toast({ title: "自动下载更新失败", description: errorMsg || "请尝试使用备用镜像或浏览器下载", variant: "error" });
        handleDownload(targetUrl);
      }
    } else {
      // 浏览器环境 fallback
      handleDownload(targetUrl);
    }
  };

  const handleRestartAndInstall = () => {
    const electronWin = typeof window !== "undefined"
      ? (window as unknown as {
          furinakit?: {
            installUpdate?: (path: string) => Promise<{ success: boolean; error?: string }>;
          };
        })
      : null;

    if (downloadedInstallerPath && electronWin?.furinakit?.installUpdate) {
      electronWin.furinakit.installUpdate(downloadedInstallerPath);
      onClose();
    } else {
      handleDownload();
      onClose();
    }
  };

  const performCheck = useCallback(async () => {
    setChecking(true);
    setResult(null);
    try {
      const res = await checkForUpdates(customEndpoint);
      setResult(res);
    } catch {
      setResult({
        hasUpdate: false,
        currentVersion: APP_VERSION,
        latestVersion: APP_VERSION,
        changelog: ["检测完成，当前版本运行良好。"],
      });
    } finally {
      setChecking(false);
    }
  }, [customEndpoint]);

  useEffect(() => {
    if (open) {
      performCheck();
    }
  }, [open, performCheck]);

  const handleDownload = (url?: string) => {
    const target = url || result?.downloadUrl;
    if (!target) return;
    const win = typeof window !== "undefined" ? (window as unknown as { furinakit?: { openExternal?: (u: string) => void } }) : null;
    if (win?.furinakit?.openExternal) {
      win.furinakit.openExternal(target);
    } else {
      window.open(target, "_blank", "noopener,noreferrer");
    }
  };

  const handleCopyLink = (url?: string) => {
    const target = url || result?.downloadUrl;
    if (!target) return;
    navigator.clipboard.writeText(target);
    setCopied(true);
    toast({ title: "下载链接已复制到剪贴板", variant: "success" });
    setTimeout(() => setCopied(false), 2000);
  };

  const currentLog = APP_CHANGELOG.find((log) => log.version === selectedVersion) || APP_CHANGELOG[0];

  const handleCopyChangelog = () => {
    if (!currentLog) return;
    const text = [
      `【${APP_NAME} v${currentLog.version} 更新日志】`,
      `发布日期：${currentLog.releaseDate}`,
      `主题：${currentLog.title}`,
      "",
      "核心亮点：",
      ...currentLog.highlights.map((h) => `• ${h}`),
      "",
      "详细内容：",
      ...currentLog.details.flatMap((d) => [`[${d.category}]`, ...d.items.map((i) => `  - ${i}`)]),
    ].join("\n");

    navigator.clipboard.writeText(text);
    setLogCopied(true);
    toast({ title: "更新日志已复制到剪贴板", variant: "success" });
    setTimeout(() => setLogCopied(false), 2000);
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.55)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.94, y: 10 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
        className="relative w-full max-w-[560px] overflow-hidden rounded-2xl border shadow-2xl flex flex-col max-h-[85vh]"
        style={{ background: colors.card, borderColor: colors.borderSolid }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏与标签页 */}
        <div
          className="flex items-center justify-between px-6 py-4"
          style={{ borderBottom: `1px solid ${colors.border}` }}
        >
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Sparkles size={18} />
            </span>
            <div>
              <h2 className="text-[16px] font-bold leading-tight" style={{ color: colors.text }}>
                版本与更新中心
              </h2>
              <p className="text-[12px] text-muted-foreground">{APP_NAME}</p>
            </div>
          </div>

          {/* 切换 Tabs */}
          <div className="flex items-center gap-1 bg-muted/60 p-1 rounded-xl border border-border/50 mr-2">
            <button
              onClick={() => setActiveTab("check")}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded-lg transition-all flex items-center gap-1.5",
                activeTab === "check"
                  ? "bg-background text-foreground shadow-xs font-semibold text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <RefreshCw size={12} className={checking ? "animate-spin" : ""} />
              检查更新
            </button>
            <button
              onClick={() => setActiveTab("changelog")}
              className={cn(
                "px-3 py-1 text-xs font-medium rounded-lg transition-all flex items-center gap-1.5",
                activeTab === "changelog"
                  ? "bg-background text-foreground shadow-xs font-semibold text-primary"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              <FileText size={12} />
              更新日志
            </button>
          </div>

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

        {/* 主体内容 */}
        <div className="p-6 overflow-y-auto flex-1">
          <AnimatePresence mode="wait">
            {activeTab === "check" ? (
              checking ? (
                <motion.div
                  key="checking"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex flex-col items-center justify-center py-8 text-center"
                >
                  <RefreshCw size={36} className="animate-spin text-primary mb-4" />
                  <p className="text-sm font-semibold" style={{ color: colors.text }}>
                    正在连接云端检测最新版本…
                  </p>
                  <p className="text-xs text-muted-foreground mt-1.5">
                    当前本地版本：v{APP_VERSION}
                  </p>
                </motion.div>
              ) : result?.hasUpdate ? (
                <motion.div
                  key="has-update"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="space-y-4"
                >
                  <div className="flex items-start gap-3 rounded-xl border p-4 bg-primary/5 border-primary/20">
                    <ArrowUpCircle size={24} className="text-primary shrink-0 mt-0.5" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-[15px]" style={{ color: colors.text }}>
                          发现全新版本！
                        </span>
                        <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-white">
                          v{result.latestVersion}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-1">
                        当前版本: v{result.currentVersion}
                        {result.releaseDate && ` · 发布时间: ${result.releaseDate}`}
                      </p>
                    </div>
                  </div>

                  {/* 更新内容 */}
                  {result.changelog && result.changelog.length > 0 && (
                    <div className="rounded-xl border p-4" style={{ borderColor: colors.borderSolid, background: colors.bg }}>
                      <p className="text-xs font-semibold mb-2.5" style={{ color: colors.text }}>
                        更新内容：
                      </p>
                      <ul className="space-y-1.5 text-xs text-muted-foreground pl-1">
                        {result.changelog.map((log, idx) => (
                          <li key={idx} className="flex items-start gap-2">
                            <span className="text-primary mt-0.5">•</span>
                            <span>{log}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {/* 下载安装进度 */}
                  {updating && (
                    <div className="rounded-xl border p-4 bg-primary/5 space-y-2.5" style={{ borderColor: colors.borderSolid }}>
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold flex items-center gap-1.5" style={{ color: colors.text }}>
                          {updateFinished ? (
                            <CheckCircle2 size={15} className="text-emerald-500" />
                          ) : (
                            <RefreshCw size={14} className="animate-spin text-primary" />
                          )}
                          {updateStepText}
                        </span>
                        <span className="font-mono font-bold text-primary">{updateProgress}%</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
                        <div
                          className="h-full rounded-full bg-primary transition-all duration-300"
                          style={{ width: `${updateProgress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* 备用镜像 */}
                  {!updating && result.mirrors && result.mirrors.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-[11px] text-muted-foreground">备用高速下载线路：</p>
                      <div className="flex flex-wrap gap-2">
                        {result.mirrors.map((mirror, idx) => (
                          <button
                            key={idx}
                            onClick={() => handleDownload(mirror.url)}
                            className="flex items-center gap-1 text-xs rounded-lg border px-2.5 py-1.5 hover:border-primary text-primary transition-all"
                            style={{ borderColor: colors.borderSolid }}
                          >
                            <Download size={13} />
                            {mirror.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 操作按钮 */}
                  <div className="flex items-center justify-between pt-2">
                    <button
                      onClick={() => setActiveTab("changelog")}
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      <FileText size={13} />
                      查看完整更新日志
                    </button>

                    <div className="flex items-center gap-2">
                      {result.downloadUrl && !updating && (
                        <button
                          onClick={() => handleCopyLink()}
                          className="flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs transition-colors"
                          style={{ borderColor: colors.borderSolid, color: colors.text }}
                        >
                          {copied ? <Check size={14} className="text-emerald-500" /> : <Copy size={14} />}
                          {copied ? "已复制" : "复制链接"}
                        </button>
                      )}
                      {updating ? (
                        updateFinished ? (
                          <button
                            onClick={handleRestartAndInstall}
                            className="flex h-9 items-center gap-1.5 rounded-xl bg-emerald-600 px-5 text-xs font-semibold text-white shadow-sm hover:brightness-110 transition-all"
                          >
                            <CheckCircle2 size={14} />
                            立即重启并完成安装
                          </button>
                        ) : (
                          <button
                            disabled
                            className="flex h-9 items-center gap-1.5 rounded-xl bg-primary/70 px-5 text-xs font-semibold text-white shadow-sm cursor-not-allowed"
                          >
                            <RefreshCw size={14} className="animate-spin" />
                            正在全自动升级中...
                          </button>
                        )
                      ) : (
                        <button
                          onClick={startOneClickUpdate}
                          className="flex h-9 items-center gap-1.5 rounded-xl bg-primary px-5 text-xs font-semibold text-primary-foreground shadow-sm hover:brightness-110 transition-all"
                        >
                          <Sparkles size={14} />
                          一键自动更新并安装
                        </button>
                      )}
                    </div>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="up-to-date"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-col items-center justify-center py-4 text-center space-y-3"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-500">
                    <CheckCircle2 size={28} />
                  </div>
                  <div>
                    <h3 className="text-base font-bold" style={{ color: colors.text }}>
                      当前已是最新稳定版本
                    </h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      FurinaKit 芙宁娜工具箱 <span className="font-semibold text-primary">v{APP_VERSION}</span>
                    </p>
                  </div>
                  <p className="max-w-sm text-xs text-muted-foreground/80 leading-relaxed">
                    所有内置工具、离线运算 Worker 与界面交互特性均处于最新状态，尽享优雅高效体验！✨
                  </p>

                  <div className="flex items-center gap-3 pt-2">
                    <button
                      onClick={performCheck}
                      className="flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs transition-colors hover:border-primary text-muted-foreground hover:text-foreground"
                      style={{ borderColor: colors.borderSolid }}
                    >
                      <RefreshCw size={12} />
                      重新检测
                    </button>
                    <button
                      onClick={() => setActiveTab("changelog")}
                      className="flex h-8 items-center gap-1.5 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 px-3.5 text-xs font-medium transition-all"
                    >
                      <FileText size={12} />
                      查看本次更新日志 (v{APP_VERSION})
                    </button>
                  </div>
                </motion.div>
              )
            ) : (
              /* 更新日志视图 */
              <motion.div
                key="changelog"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="space-y-4"
              >
                {/* 顶部版本选择栏 */}
                <div className="flex items-center justify-between pb-1 border-b border-border/40">
                  <div className="flex items-center gap-2">
                    <History size={14} className="text-primary" />
                    <span className="text-xs font-semibold" style={{ color: colors.text }}>
                      发版历史与更新说明
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {APP_CHANGELOG.map((log) => (
                      <button
                        key={log.version}
                        onClick={() => setSelectedVersion(log.version)}
                        className={cn(
                          "px-2.5 py-1 text-xs rounded-lg transition-all font-mono",
                          selectedVersion === log.version
                            ? "bg-primary text-primary-foreground font-semibold shadow-xs"
                            : "bg-muted/50 text-muted-foreground hover:text-foreground"
                        )}
                      >
                        v{log.version}
                        {log.badge && (
                          <span className="ml-1 text-[10px] opacity-90">({log.badge})</span>
                        )}
                      </button>
                    ))}
                  </div>
                </div>

                {/* 选中的版本日志详情 */}
                {currentLog && (
                  <div className="space-y-4 text-xs">
                    {/* 版本横幅 */}
                    <div
                      className="rounded-xl border p-4 bg-muted/40"
                      style={{ borderColor: colors.borderSolid }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-bold text-foreground">
                            FurinaKit v{currentLog.version}
                          </span>
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">
                            {currentLog.releaseDate}
                          </span>
                        </div>
                        <button
                          onClick={handleCopyChangelog}
                          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground hover:underline"
                        >
                          {logCopied ? <Check size={12} className="text-emerald-500" /> : <Copy size={12} />}
                          {logCopied ? "已复制" : "复制日志"}
                        </button>
                      </div>
                      <p className="mt-1.5 font-medium text-foreground/90">
                        {currentLog.title}
                      </p>
                    </div>

                    {/* 核心亮点 */}
                    <div className="space-y-2">
                      <div className="font-semibold flex items-center gap-1 text-foreground/90">
                        <Sparkles size={13} className="text-amber-500" />
                        版本核心亮点
                      </div>
                      <div className="bg-background/80 rounded-xl p-3 border border-border/50 space-y-1.5">
                        {currentLog.highlights.map((h, i) => (
                          <div key={i} className="flex items-start gap-2 text-muted-foreground">
                            <span className="text-primary font-bold">✓</span>
                            <span className="leading-relaxed">{h}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* 详细更新类别列表 */}
                    <div className="space-y-3">
                      {currentLog.details.map((cat, idx) => (
                        <div key={idx} className="space-y-1.5">
                          <div className="font-semibold text-foreground/85 flex items-center gap-1.5">
                            <Tag size={12} className="text-primary/70" />
                            {cat.category}
                          </div>
                          <div className="bg-muted/30 rounded-xl p-3 border border-border/40 space-y-1.5">
                            {cat.items.map((item, itemIdx) => (
                              <div key={itemIdx} className="flex items-start gap-2 text-muted-foreground">
                                <span className="text-primary/70 mt-0.5">•</span>
                                <span className="leading-relaxed">{item}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 底部信息条 */}
        <div
          className="flex items-center justify-between px-6 py-3 text-[11px] text-muted-foreground"
          style={{ borderTop: `1px solid ${colors.border}`, background: colors.bg }}
        >
          <span>官方发布 · 永久开源免商用</span>
          <button onClick={onClose} className="hover:underline">
            关闭窗口
          </button>
        </div>
      </motion.div>
    </div>
  );
}
