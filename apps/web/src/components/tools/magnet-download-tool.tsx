"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Download,
  Magnet,
  FolderOpen,
  ClipboardPaste,
  Trash2,
  Loader2,
  CheckCircle2,
  XCircle,
  Copy,
  Check,
  Zap,
  Files,
  HardDrive,
  ArrowDownCircle,
  FileUp,
  Sparkles,
  RefreshCw,
  AlertCircle,
  Film,
  FileBox,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";
import type { MagnetTorrentInfo } from "@/app/api/magnet-info/route";

interface JobState {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress: number;
  message: string;
  resultFilename?: string;
  error?: string;
}

export function MagnetDownloadTool() {
  const [url, setUrl] = useState("");
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [resourceInfo, setResourceInfo] = useState<MagnetTorrentInfo | null>(null);
  const [showAllFiles, setShowAllFiles] = useState(false);
  const [copiedHash, setCopiedHash] = useState(false);
  const [job, setJob] = useState<JobState | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const { toast } = useToast();

  // 复制 Hash
  const handleCopyHash = () => {
    if (!resourceInfo?.infoHash) return;
    navigator.clipboard.writeText(resourceInfo.infoHash);
    setCopiedHash(true);
    toast({ title: "已复制特征码 (BTIH)", variant: "success" });
    setTimeout(() => setCopiedHash(false), 2000);
  };

  // 一键粘贴
  const handlePaste = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        setUrl(text.trim());
        toast({ title: "已从剪贴板粘贴", variant: "success" });
      }
    } catch {
      toast({ title: "无法读取剪贴板，请手动粘贴", variant: "error" });
    }
  };

  // 清空
  const handleClear = () => {
    setUrl("");
    setParseError(null);
    setResourceInfo(null);
    setJob(null);
  };

  // 解析磁力链接或种子
  const handleParse = async (overrideUrl?: string) => {
    const targetUrl = (overrideUrl !== undefined ? overrideUrl : url).trim();
    if (!targetUrl) {
      toast({ title: "请输入磁力链接或上传种子文件", variant: "error" });
      return;
    }

    setParsing(true);
    setParseError(null);
    setResourceInfo(null);
    setJob(null);

    try {
      const res = await fetch("/api/magnet-info", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: targetUrl }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "解析失败，请检查链接是否正确");
      }

      setResourceInfo(data);
      toast({ title: "磁力资源解析成功", description: data.name, variant: "success" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "解析失败";
      setParseError(msg);
      toast({ title: "解析失败", description: msg, variant: "error" });
    } finally {
      setParsing(false);
    }
  };

  // 处理 .torrent 文件选择或拖拽上传
  const handleTorrentUpload = async (file: File) => {
    if (!file.name.toLowerCase().endsWith(".torrent")) {
      toast({ title: "请选择以 .torrent 结尾的种子文件", variant: "error" });
      return;
    }

    setParsing(true);
    setParseError(null);
    setResourceInfo(null);
    setJob(null);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/magnet-info", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "种子文件解析失败");
      }

      setResourceInfo(data);
      setUrl(data.magnetUri || file.name);
      toast({ title: "种子文件解析成功", description: data.name, variant: "success" });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "种子解析失败";
      setParseError(msg);
      toast({ title: "解析失败", description: msg, variant: "error" });
    } finally {
      setParsing(false);
    }
  };

  // 开始高速下载
  const handleStartDownload = async () => {
    if (!resourceInfo) return;

    try {
      const formData = new FormData();
      formData.append("url", resourceInfo.magnetUri || url);
      if (resourceInfo.torrentPath) {
        formData.append("torrentPath", resourceInfo.torrentPath);
      }

      const res = await fetch("/api/tools/magnet-download", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "创建下载任务失败");
      }

      setJob({
        id: data.job.id,
        status: "pending",
        progress: 0,
        message: "已创建下载任务，正在调度 aria2 引擎...",
      });
      try {
        sessionStorage.setItem("furina:job:magnet-download", data.job.id);
      } catch {}

      // 触发全局任务球更新
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("furinakit:jobs-updated"));
      }

      toast({ title: "下载任务已启动", description: resourceInfo.name, variant: "success" });

      // 开始轮询任务状态
      pollJobStatus(data.job.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "下载失败";
      toast({ title: "启动失败", description: msg, variant: "error" });
    }
  };

  // 取消下载任务
  const handleCancelDownload = async () => {
    if (!job?.id) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/jobs/${job.id}/cancel`, { method: "POST" });
      if (res.ok) {
        setJob((prev) => (prev ? { ...prev, status: "failed", error: "用户已取消下载" } : null));
        toast({ title: "已取消下载任务", variant: "info" });
        if (typeof window !== "undefined") {
          window.dispatchEvent(new Event("furinakit:jobs-updated"));
        }
      }
    } catch {
      toast({ title: "取消任务失败", variant: "error" });
    } finally {
      setCancelling(false);
    }
  };

  // 轮询任务状态
  const pollJobStatus = useCallback((jobId: string) => {
    try {
      sessionStorage.setItem("furina:job:magnet-download", jobId);
    } catch {}

    let timer: NodeJS.Timeout;

    const poll = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`, { cache: "no-store" });
        const data = await res.json();

        if (res.ok && data.job) {
          const currentJob = data.job;
          setJob({
            id: currentJob.id,
            status: currentJob.status,
            progress: currentJob.progress || 0,
            message: currentJob.message || "下载中...",
            resultFilename: currentJob.resultFilename,
            error: currentJob.error,
          });

          if (currentJob.status === "completed") {
            toast({
              title: "磁力资源下载完成！",
              description: currentJob.resultFilename || "文件已存入输出目录",
              variant: "success",
            });
            if (typeof window !== "undefined") {
              window.dispatchEvent(new Event("furinakit:jobs-updated"));
            }
            return;
          }

          if (currentJob.status === "failed") {
            toast({
              title: "下载未完成",
              description: currentJob.error || "下载遇到异常",
              variant: "error",
            });
            if (typeof window !== "undefined") {
              window.dispatchEvent(new Event("furinakit:jobs-updated"));
            }
            return;
          }
        }

        timer = setTimeout(poll, 1200);
      } catch {
        timer = setTimeout(poll, 2500);
      }
    };

    poll();
    return () => clearTimeout(timer);
  }, [toast]);

  // 页面挂载时自动恢复进行中的磁力任务
  useEffect(() => {
    let unmounted = false;
    const restore = async () => {
      let jId: string | null = null;
      if (typeof window !== "undefined") {
        const sp = new URLSearchParams(window.location.search);
        jId = sp.get("jobId") || sessionStorage.getItem("furina:job:magnet-download");
      }
      if (!jId) {
        try {
          const r = await fetch("/api/jobs", { cache: "no-store" });
          const data = await r.json();
          const running = data?.jobs?.find(
            (j: { toolId?: string; status?: string; id?: string }) =>
              j.toolId === "magnet-download" &&
              (j.status === "processing" || j.status === "pending" || j.status === "queued")
          );
          if (running?.id) jId = running.id;
        } catch {}
      }
      if (!jId || unmounted) return;
      pollJobStatus(jId);
    };

    restore();

    const handleSelectJob = (e: Event) => {
      const detail = (e as CustomEvent<{ toolId?: string; jobId?: string }>).detail;
      if (detail?.toolId === "magnet-download" && detail?.jobId) {
        pollJobStatus(detail.jobId);
      }
    };
    window.addEventListener("furinakit:select-job", handleSelectJob);
    return () => {
      unmounted = true;
      window.removeEventListener("furinakit:select-job", handleSelectJob);
    };
  }, [pollJobStatus]);

  // 打开保存输出目录
  const handleOpenFolder = async () => {
    try {
      const win = typeof window !== "undefined" ? (window as any).furinakit : null;
      if (win?.openPath) {
        const dirRes = await fetch("/api/output-dir");
        const dirData = await dirRes.json();
        if (dirData?.outputDir) {
          win.openPath(dirData.outputDir);
          return;
        }
      }
      await fetch("/api/output-dir", { method: "POST" });
      toast({ title: "已在资源管理器中打开输出目录", variant: "success" });
    } catch {
      toast({ title: "打开目录失败", variant: "error" });
    }
  };

  // 保存单文件下载到本地
  const handleDownloadFile = async () => {
    if (!job?.id || !job.resultFilename) return;
    try {
      const res = await fetch(`/api/jobs/${job.id}/download?download=1`);
      if (!res.ok) throw new Error("获取文件流失败");
      const blob = await res.blob();
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = job.resultFilename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(blobUrl), 4000);
      toast({ title: "保存开始", description: job.resultFilename, variant: "success" });
    } catch {
      toast({ title: "下载文件失败，请尝试直接在保存目录查看", variant: "error" });
    }
  };

  return (
    <div className="space-y-6">
      {/* 隐藏的本地种子文件输入框 */}
      <input
        ref={fileInputRef}
        type="file"
        accept=".torrent"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleTorrentUpload(file);
          e.target.value = "";
        }}
      />

      {/* 1. 磁力/种子输入面板 */}
      <div
        className={cn(
          "relative space-y-4 rounded-2xl border border-border/80 bg-card/60 p-5 shadow-xs backdrop-blur-xl transition-all",
          isDragOver && "border-primary ring-2 ring-primary/20 bg-primary/5"
        )}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          const file = e.dataTransfer.files?.[0];
          if (file) {
            handleTorrentUpload(file);
          } else {
            const text = e.dataTransfer.getData("text");
            if (text) {
              setUrl(text.trim());
              handleParse(text.trim());
            }
          }
        }}
      >
        {/* 工具栏头部 */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Magnet className="h-5 w-5 text-primary" />
            <h2 className="text-base font-semibold text-foreground">磁力链接与 BT 种子</h2>
            <span className="flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-medium text-emerald-600 dark:text-emerald-400 border border-emerald-500/20">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
              优质 Tracker 自动加速
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => fileInputRef.current?.click()}
              className="flex items-center gap-1 rounded-lg border border-border/70 bg-background/80 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              title="上传本地 .torrent 种子文件"
            >
              <FileUp className="h-3.5 w-3.5 text-primary" />
              <span>选择种子</span>
            </button>
            <button
              onClick={handlePaste}
              className="flex items-center gap-1 rounded-lg border border-border/70 bg-background/80 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground"
              title="一键粘贴剪贴板内容"
            >
              <ClipboardPaste className="h-3.5 w-3.5" />
              <span>粘贴</span>
            </button>
            <button
              onClick={handleClear}
              className="flex items-center gap-1 rounded-lg border border-border/70 bg-background/80 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
              title="清空输入"
            >
              <Trash2 className="h-3.5 w-3.5" />
              <span>清空</span>
            </button>
          </div>
        </div>

        {/* 文本输入框 */}
        <div className="relative">
          <textarea
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              if (parseError) setParseError(null);
            }}
            placeholder="粘贴磁力链接 (magnet:?xt=urn:btih:...)，或直接将 .torrent 种子文件拖拽至此处"
            rows={3}
            className="w-full resize-none rounded-xl border border-border/80 bg-background/60 p-3.5 text-sm text-foreground placeholder:text-muted-foreground/60 focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>

        {/* 解析操作行 */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span>支持 40位 Hex / 32位 Base32 特征码与全部标准 BT 种子</span>
          </div>

          <Button
            onClick={() => handleParse()}
            disabled={parsing || !url.trim()}
            className="min-w-[120px] shadow-sm"
          >
            {parsing ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                正在解析...
              </>
            ) : (
              <>
                <Zap className="h-4 w-4 mr-1.5" />
                解析资源
              </>
            )}
          </Button>
        </div>

        {/* 解析错误提示 */}
        {parseError && (
          <motion.div
            initial={{ opacity: 0, y: -5 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
          >
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{parseError}</span>
          </motion.div>
        )}
      </div>

      {/* 2. 资源详情卡片 (先给出视频/资源信息) */}
      <AnimatePresence>
        {resourceInfo && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-4 rounded-2xl border border-primary/20 bg-card/80 p-5 shadow-sm backdrop-blur-xl"
          >
            {/* 卡片头部 */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3 min-w-0">
                <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary border border-primary/20">
                  {resourceInfo.name.toLowerCase().match(/\.(mp4|mkv|avi|mov|wmv|flv)$/) ? (
                    <Film className="h-6 w-6" />
                  ) : (
                    <FileBox className="h-6 w-6" />
                  )}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary border border-primary/20">
                      {resourceInfo.type === "torrent" ? "BT 种子文件" : "磁力链接"}
                    </span>
                    <span className="text-xs text-muted-foreground">已完成预校验</span>
                  </div>
                  <h3 className="mt-1 text-base font-bold text-foreground line-clamp-2 break-all">
                    {resourceInfo.name}
                  </h3>
                </div>
              </div>

              {/* 开始高速下载主按钮 */}
              <div className="shrink-0">
                <Button
                  onClick={handleStartDownload}
                  disabled={job?.status === "processing" || job?.status === "pending"}
                  size="lg"
                  className="w-full sm:w-auto px-6 font-semibold shadow-md bg-gradient-to-r from-primary to-cyan-500 hover:from-primary/90 hover:to-cyan-600 text-white"
                >
                  <Download className="h-4 w-4 mr-1.5" />
                  {job?.status === "processing" || job?.status === "pending"
                    ? "正在下载中..."
                    : "开始高速下载"}
                </Button>
              </div>
            </div>

            {/* 关键属性指标栏 */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-border/70 bg-background/50 p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <HardDrive className="h-3.5 w-3.5 text-primary" />
                  <span>资源总大小</span>
                </div>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {resourceInfo.sizeText}
                </p>
              </div>

              <div className="rounded-xl border border-border/70 bg-background/50 p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Files className="h-3.5 w-3.5 text-primary" />
                  <span>文件总数</span>
                </div>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {resourceInfo.fileCount > 0 ? `${resourceInfo.fileCount} 个文件` : "单文件资源"}
                </p>
              </div>

              <div className="rounded-xl border border-border/70 bg-background/50 p-3">
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Zap className="h-3.5 w-3.5 text-amber-500" />
                  <span>加速 Trackers</span>
                </div>
                <p className="mt-1 text-sm font-semibold text-foreground">
                  {resourceInfo.trackers.length > 0
                    ? `${resourceInfo.trackers.length} 个服务器`
                    : "已注入公共池"}
                </p>
              </div>

              <div className="rounded-xl border border-border/70 bg-background/50 p-3">
                <div className="flex items-center justify-between text-xs text-muted-foreground">
                  <div className="flex items-center gap-1">
                    <Magnet className="h-3.5 w-3.5 text-primary" />
                    <span>特征码 BTIH</span>
                  </div>
                  <button
                    onClick={handleCopyHash}
                    className="flex items-center text-[10px] text-primary hover:underline"
                    title="复制 BTIH"
                  >
                    {copiedHash ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
                  </button>
                </div>
                <p className="mt-1 font-mono text-xs font-medium text-foreground truncate" title={resourceInfo.infoHash}>
                  {resourceInfo.infoHash.slice(0, 14)}...
                </p>
              </div>
            </div>

            {/* 文件清单展开预览（若是多文件种子） */}
            {resourceInfo.files && resourceInfo.files.length > 1 && (
              <div className="rounded-xl border border-border/60 bg-background/40 p-3 text-xs">
                <div
                  className="flex cursor-pointer items-center justify-between text-muted-foreground hover:text-foreground"
                  onClick={() => setShowAllFiles(!showAllFiles)}
                >
                  <span className="font-medium">
                    包含文件清单 ({resourceInfo.files.length} 项)
                  </span>
                  <div className="flex items-center gap-1 text-[11px] text-primary">
                    <span>{showAllFiles ? "收起" : "展开查看"}</span>
                    {showAllFiles ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                  </div>
                </div>

                {showAllFiles && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="mt-2.5 max-h-48 overflow-y-auto space-y-1.5 pr-1"
                  >
                    {resourceInfo.files.map((file, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between rounded-lg bg-card/60 px-2.5 py-1.5 border border-border/40"
                      >
                        <span className="truncate pr-2 text-foreground font-mono text-[11px]" title={file.path}>
                          {file.path}
                        </span>
                        <span className="shrink-0 text-muted-foreground">{file.sizeText}</span>
                      </div>
                    ))}
                  </motion.div>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 3. 实时下载控制台面板 */}
      <AnimatePresence>
        {job && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className={cn(
              "space-y-4 rounded-2xl border p-5 backdrop-blur-xl shadow-sm transition-all",
              job.status === "completed"
                ? "border-emerald-500/30 bg-emerald-500/5 dark:bg-emerald-950/10"
                : job.status === "failed"
                ? "border-destructive/30 bg-destructive/5 dark:bg-destructive/10"
                : "border-primary/20 bg-card/70"
            )}
          >
            {/* 状态顶栏 */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                {job.status === "completed" ? (
                  <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                ) : job.status === "failed" ? (
                  <XCircle className="h-5 w-5 text-destructive" />
                ) : (
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                )}
                <span className="text-sm font-semibold text-foreground">
                  {job.status === "completed"
                    ? "磁力下载完成"
                    : job.status === "failed"
                    ? "下载遇到错误"
                    : "高速下载进行中"}
                </span>
              </div>

              <div className="flex items-center gap-3">
                <span className="font-mono text-base font-bold text-primary">
                  {job.progress}%
                </span>
                {job.status === "processing" && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCancelDownload}
                    disabled={cancelling}
                    className="h-7 text-xs text-destructive hover:bg-destructive/10 hover:border-destructive/40"
                  >
                    {cancelling ? "取消中..." : "取消下载"}
                  </Button>
                )}
              </div>
            </div>

            {/* 渐变流光进度条 */}
            {job.status !== "completed" && job.status !== "failed" && (
              <div className="h-2.5 w-full overflow-hidden rounded-full bg-muted/60">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-primary via-cyan-400 to-blue-500 transition-all duration-300 shadow-xs"
                  style={{ width: `${Math.max(job.progress, 2)}%` }}
                />
              </div>
            )}

            {/* 状态详情与速度数据 */}
            <div className="rounded-xl border border-border/60 bg-background/50 p-3.5 font-mono text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <ArrowDownCircle className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="text-foreground break-all">{job.message}</span>
              </div>
              {job.error && (
                <p className="mt-2 text-destructive font-sans font-medium">{job.error}</p>
              )}
            </div>

            {/* 下载完成操作按键 */}
            {job.status === "completed" && (
              <div className="flex flex-wrap items-center gap-3 pt-1">
                {job.resultFilename && (
                  <Button onClick={handleDownloadFile} className="flex-1 font-medium shadow-xs">
                    <Download className="h-4 w-4 mr-1.5" />
                    保存文件
                  </Button>
                )}
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleOpenFolder}
                  className="flex-1 font-medium gap-1.5"
                  title="在资源管理器中定位"
                >
                  <FolderOpen className="h-4 w-4 text-primary" />
                  <span>打开保存目录</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setJob(null);
                    setResourceInfo(null);
                    setUrl("");
                  }}
                  className="text-xs"
                >
                  <RefreshCw className="h-3.5 w-3.5 mr-1" />
                  下载下一个
                </Button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
