"use client";

import React, { useState, useEffect, useRef, useCallback } from "react";
import QRCode from "qrcode";
import {
  Share2,
  Smartphone,
  Laptop,
  FolderOpen,
  Copy,
  ExternalLink,
  Upload,
  RefreshCw,
  FileIcon,
  Check,
  Trash2,
  Sparkles,
  CheckCircle2,
  Send,
  Loader2,
  Download,
} from "lucide-react";
import { useDropzone } from "react-dropzone";
import { trackToolUsage } from "@/lib/analytics";

interface TransferredFile {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  createdAt: string;
  path?: string;
  downloadUrl?: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export function LanTransferTool() {
  const [ips, setIps] = useState<Array<{ name: string; ip: string }>>([]);
  const [selectedIp, setSelectedIp] = useState<string>("");
  const [port, setPort] = useState<string>("3001");
  const [qrDataUrl, setQrDataUrl] = useState<string>("");

  const [sharedFiles, setSharedFiles] = useState<TransferredFile[]>([]);
  const [receivedFiles, setReceivedFiles] = useState<TransferredFile[]>([]);
  const [clipboardText, setClipboardText] = useState<string>("");
  const [receiveDir, setReceiveDir] = useState<string>("");

  const [clipboardInput, setClipboardInput] = useState<string>("");
  const [copiedLink, setCopiedLink] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSharingFiles, setIsSharingFiles] = useState(false);

  // 记录上一次接收的文件数量，有新文件时提示
  const lastReceivedCountRef = useRef(0);
  const [newFileBadge, setNewFileBadge] = useState<string | null>(null);

  // 获取状态与 IP
  const fetchStatus = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch("/api/transfer");
      const data = await res.json();
      if (data.success) {
        setIps(data.ips || []);
        if (data.ips && data.ips.length > 0 && !selectedIp) {
          setSelectedIp(data.ips[0].ip);
        }
        setPort(data.port || "3001");
        setSharedFiles(data.sharedFiles || []);
        if (data.receiveDir) {
          setReceiveDir(data.receiveDir);
        }

        const newReceived: TransferredFile[] = data.receivedFiles || [];
        if (lastReceivedCountRef.current > 0 && newReceived.length > lastReceivedCountRef.current) {
          const newest = newReceived[0];
          setNewFileBadge(`刚刚收到新文件：${newest.name}`);
          setTimeout(() => setNewFileBadge(null), 5000);
        }
        lastReceivedCountRef.current = newReceived.length;
        setReceivedFiles(newReceived);

        setClipboardText(data.clipboardText || "");
      }
    } catch {}
    finally {
      setIsRefreshing(false);
    }
  }, [selectedIp]);

  // 更改手机上传文件的电脑保存路径
  const handleChangeReceiveDir = async () => {
    if (typeof window !== "undefined" && window.furinakit?.selectDirectory) {
      const selected = await window.furinakit.selectDirectory();
      if (selected) {
        await fetch("/api/transfer?action=set-receive-dir", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ receiveDir: selected }),
        });
        fetchStatus();
      }
    } else {
      const dir = window.prompt("请输入手机上传文件的电脑保存路径：", receiveDir);
      if (dir && dir.trim()) {
        await fetch("/api/transfer?action=set-receive-dir", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ receiveDir: dir.trim() }),
        });
        fetchStatus();
      }
    }
  };

  useEffect(() => {
    trackToolUsage("lan-transfer");
    fetchStatus();
    const timer = setInterval(fetchStatus, 3000);
    return () => clearInterval(timer);
  }, [fetchStatus]);

  // 生成二维码
  const portalUrl = selectedIp ? `http://${selectedIp}:${port}/portal/transfer` : "";

  useEffect(() => {
    if (portalUrl) {
      QRCode.toDataURL(portalUrl, {
        width: 180,
        margin: 1,
        color: {
          dark: "#0369a1",
          light: "#ffffff",
        },
      })
        .then((url) => setQrDataUrl(url))
        .catch(() => {});
    }
  }, [portalUrl]);

  // 复制链接
  const handleCopyLink = () => {
    if (!portalUrl) return;
    navigator.clipboard.writeText(portalUrl);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  };

  // 电脑端添加共享文件
  const handleShareFiles = async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;
    setIsSharingFiles(true);
    const formData = new FormData();
    acceptedFiles.forEach((file) => formData.append("files", file));

    try {
      const res = await fetch("/api/transfer?action=share", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.success) {
        fetchStatus();
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "共享失败";
      alert(message);
    } finally {
      setIsSharingFiles(false);
    }
  };

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop: handleShareFiles,
  });

  // 电脑端同步剪贴板文本
  const handleSyncClipboard = async () => {
    if (!clipboardInput.trim()) return;
    try {
      await fetch("/api/transfer?action=clipboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: clipboardInput.trim() }),
      });
      setClipboardInput("");
      fetchStatus();
    } catch {}
  };

  // 电脑端删除共享文件
  const handleDeleteShared = async (id: string) => {
    try {
      await fetch("/api/transfer?action=delete-shared", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      fetchStatus();
    } catch {}
  };

  // 电脑端删除已接收记录
  const handleDeleteReceived = async (id: string) => {
    try {
      await fetch("/api/transfer?action=delete-received", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      fetchStatus();
    } catch {}
  };

  // 打开接收文件夹
  const handleOpenFolder = async () => {
    try {
      await fetch("/api/transfer?action=open-folder", { method: "POST" });
    } catch {}
  };

  // 打开特定文件
  const handleOpenFile = async (path: string) => {
    try {
      await fetch("/api/transfer?action=open-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path }),
      });
    } catch {}
  };

  return (
    <div className="space-y-6">
      {/* 顶部横幅与局域网二维码连接卡 */}
      <div className="rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-5 shadow-sm">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          {/* 左侧：说明与 IP 切换 */}
          <div className="space-y-3 flex-1 min-w-0">
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/20 text-primary">
                <Share2 size={22} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-[17px] font-bold text-foreground">
                    跨设备互传
                  </h2>
                  <span className="rounded-full bg-emerald-500/10 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                    连接同一 Wi-Fi 或手机热点 · 手机免装 App
                  </span>
                </div>
                <p className="text-[12px] text-muted-foreground mt-0.5">
                  手机无需安装任何 App，只要连接同一 Wi-Fi 或手机热点，任意软件扫码即可极速双向互通！
                </p>
              </div>
            </div>

            {/* IP 选单与快捷操作 */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <div className="flex items-center gap-1.5 rounded-lg border border-border/80 bg-background/80 px-2.5 py-1 text-[12px]">
                <span className="text-muted-foreground">本机 IP:</span>
                <select
                  value={selectedIp}
                  onChange={(e) => setSelectedIp(e.target.value)}
                  className="bg-transparent font-mono font-semibold text-primary outline-none cursor-pointer"
                >
                  {ips.map((item, i) => (
                    <option key={i} value={item.ip} className="bg-background text-foreground">
                      {item.name} ({item.ip})
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex items-center gap-1 rounded-lg border border-border/80 bg-background/80 px-2.5 py-1 text-[12px] font-mono text-muted-foreground truncate max-w-[280px]">
                <span className="truncate">{portalUrl}</span>
              </div>

              <button
                type="button"
                onClick={handleCopyLink}
                className="inline-flex h-7 items-center gap-1 rounded-lg bg-primary/10 border border-primary/20 px-2.5 text-[11px] font-semibold text-primary hover:bg-primary/20 transition-colors"
              >
                {copiedLink ? <Check size={12} /> : <Copy size={12} />}
                <span>{copiedLink ? "已复制" : "复制链接"}</span>
              </button>

              <a
                href={portalUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-7 items-center gap-1 rounded-lg border border-border px-2.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <ExternalLink size={12} />
                <span>浏览器打开</span>
              </a>

              <button
                type="button"
                onClick={fetchStatus}
                disabled={isRefreshing}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors"
                title="刷新状态"
              >
                <RefreshCw size={12} className={isRefreshing ? "animate-spin text-primary" : ""} />
              </button>
            </div>
          </div>

          {/* 右侧：精美二维码 */}
          <div className="flex flex-col items-center shrink-0">
            <div className="p-2 rounded-xl bg-white shadow-md border border-border/60">
              {qrDataUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={qrDataUrl}
                  alt="扫码进入手机互传"
                  className="h-32 w-32 rounded-lg"
                />
              ) : (
                <div className="h-32 w-32 flex items-center justify-center text-[11px] text-muted-foreground">
                  生成二维码中...
                </div>
              )}
            </div>
            <span className="mt-1.5 text-[11px] font-medium text-muted-foreground flex items-center gap-1">
              <Smartphone size={12} className="text-primary" />
              任意软件扫码即传
            </span>
          </div>
        </div>
      </div>

      {/* 实时新文件浮动提示 */}
      {newFileBadge && (
        <div className="flex items-center justify-between rounded-xl bg-emerald-500/15 border border-emerald-500/30 p-3 text-[13px] text-emerald-600 dark:text-emerald-400 shadow-sm animate-bounce">
          <div className="flex items-center gap-2">
            <CheckCircle2 size={16} />
            <span>{newFileBadge}</span>
          </div>
          <button
            onClick={handleOpenFolder}
            className="text-[12px] underline font-semibold hover:opacity-80"
          >
            立即在文件夹中查看
          </button>
        </div>
      )}

      {/* 双栏区域：左侧 电脑发手机，右侧 手机发电脑 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* 左栏：共享给手机 (PC -> Phone) */}
        <div className="rounded-2xl border border-border/70 bg-card p-5 space-y-4 shadow-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Laptop size={18} className="text-primary" />
              <h3 className="text-[14px] font-bold text-foreground">
                电脑共享给手机的文件
              </h3>
            </div>
            <span className="text-[11px] text-muted-foreground">
              共 {sharedFiles.length} 项正在共享
            </span>
          </div>

          {/* 拖放区域 */}
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-xl p-5 text-center transition-all cursor-pointer ${
              isDragActive
                ? "border-primary bg-primary/10"
                : "border-border/80 bg-muted/20 hover:border-primary/50 hover:bg-muted/40"
            }`}
          >
            <input {...getInputProps()} />
            <div className="mx-auto h-10 w-10 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              {isSharingFiles ? (
                <Loader2 size={20} className="animate-spin" />
              ) : (
                <Upload size={20} />
              )}
            </div>
            <div className="mt-2 text-[13px] font-semibold text-foreground">
              拖拽文件到这里，或点击选取
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              手机端打开传送门即可实时查看并一键下载到手机相册或文件夹
            </p>
          </div>

          {/* 剪贴板快速同步 */}
          <div className="space-y-2 pt-1 border-t border-border/60">
            <label className="text-[12px] font-semibold text-foreground flex items-center gap-1.5">
              <Sparkles size={13} className="text-amber-500" />
              <span>同步文本 / 网址至手机剪贴板</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={clipboardInput}
                onChange={(e) => setClipboardInput(e.target.value)}
                placeholder="输入想发送到手机的网址、账号密码或文本..."
                className="flex-1 bg-muted/40 border border-border/80 rounded-xl px-3 py-2 text-[12px] outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={handleSyncClipboard}
                className="px-3.5 bg-primary text-primary-foreground font-semibold text-[12px] rounded-xl flex items-center gap-1 hover:opacity-90 active:scale-95 transition-all"
              >
                <Send size={13} />
                <span>同步</span>
              </button>
            </div>
            {clipboardText && (
              <div className="flex items-center justify-between text-[11px] bg-muted/30 p-2 rounded-lg border border-border/50 text-muted-foreground">
                <span className="truncate max-w-[280px]">当前共享: {clipboardText}</span>
                <button
                  onClick={() => {
                    fetch("/api/transfer?action=clipboard", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ text: "" }),
                    }).then(fetchStatus);
                  }}
                  className="text-rose-500 hover:underline shrink-0 ml-2"
                >
                  清除
                </button>
              </div>
            )}
          </div>

          {/* 共享文件列表 */}
          <div className="space-y-2">
            <div className="text-[12px] font-semibold text-muted-foreground">
              已放入共享池的文件
            </div>
            {sharedFiles.length === 0 ? (
              <div className="py-6 text-center text-[12px] text-muted-foreground border border-dashed border-border/60 rounded-xl">
                共享池为空，拖入文件即可开启共享
              </div>
            ) : (
              <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                {sharedFiles.map((f) => (
                  <div
                    key={f.id}
                    className="flex items-center justify-between p-2.5 rounded-xl border border-border/60 bg-card/60 text-[12px]"
                  >
                    <div className="flex items-center gap-2 truncate min-w-0 pr-2">
                      <FileIcon size={16} className="text-primary shrink-0" />
                      <div className="truncate">
                        <div className="font-medium text-foreground truncate">{f.name}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">
                          {formatBytes(f.size)} · {new Date(f.createdAt).toLocaleTimeString()}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => handleDeleteShared(f.id)}
                        className="p-1.5 text-muted-foreground hover:text-rose-500 transition-colors"
                        title="移除共享"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 右栏：从手机接收的文件 (Phone -> PC) */}
        <div className="rounded-2xl border border-border/70 bg-card p-5 space-y-4 shadow-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Smartphone size={18} className="text-emerald-500" />
              <h3 className="text-[14px] font-bold text-foreground">
                从手机接收到的文件
              </h3>
            </div>
            <span className="text-[11px] text-muted-foreground">
              共 {receivedFiles.length} 项已接收
            </span>
          </div>

          {/* 保存目录设置与快捷打开 */}
          <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-muted/30 border border-border/70 text-[12px]">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <FolderOpen size={14} className="text-amber-500 shrink-0" />
              <span className="text-muted-foreground shrink-0 text-[11px]">保存目录:</span>
              <span className="font-mono text-foreground text-[11px] truncate select-all" title={receiveDir}>
                {receiveDir || "默认存储目录"}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleChangeReceiveDir}
                className="px-2.5 py-1 rounded-lg border border-border hover:bg-muted text-[11px] font-medium transition-colors"
              >
                更改目录
              </button>
              <button
                type="button"
                onClick={handleOpenFolder}
                className="px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 text-[11px] font-semibold transition-colors flex items-center gap-1"
              >
                <FolderOpen size={12} />
                <span>打开</span>
              </button>
            </div>
          </div>

          {/* 接收列表 */}
          {receivedFiles.length === 0 ? (
            <div className="py-14 text-center text-[12px] text-muted-foreground border border-dashed border-border/60 rounded-xl space-y-2">
              <div className="mx-auto h-12 w-12 rounded-full bg-muted/40 flex items-center justify-center text-muted-foreground">
                <Smartphone size={24} />
              </div>
              <div className="font-medium text-foreground">暂未收到手机发来的文件</div>
              <p className="text-[11px] text-muted-foreground max-w-xs mx-auto">
                手机连接同一 Wi-Fi 或热点后，使用任意软件扫描上方二维码，点击“传给电脑”选取照片或文件即可极速传输！
              </p>
            </div>
          ) : (
            <div className="max-h-96 overflow-y-auto space-y-2 pr-1">
              {receivedFiles.map((f) => (
                <div
                  key={f.id}
                  className="flex items-center justify-between p-3 rounded-xl border border-border/60 bg-muted/20 text-[12px] hover:bg-muted/40 transition-colors"
                >
                  <div className="flex items-center gap-2.5 truncate min-w-0 pr-2">
                    <div className="h-8 w-8 rounded-lg bg-emerald-500/10 text-emerald-500 flex items-center justify-center shrink-0">
                      <FileIcon size={16} />
                    </div>
                    <div className="truncate min-w-0">
                      <div className="font-semibold text-foreground truncate">{f.name}</div>
                      <div className="text-[10px] text-muted-foreground font-mono">
                        {formatBytes(f.size)} · 接收于 {new Date(f.createdAt).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {f.path && (
                      <button
                        onClick={() => handleOpenFile(f.path!)}
                        className="px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/20 text-[11px] font-semibold text-primary hover:bg-primary/20 transition-colors"
                      >
                        打开
                      </button>
                    )}
                    <a
                      href={`/api/transfer/download?id=${encodeURIComponent(f.name)}&type=received`}
                      download={f.name}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground transition-colors"
                      title="保存副本"
                    >
                      <Download size={14} />
                    </a>
                    <button
                      onClick={() => handleDeleteReceived(f.id)}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-rose-500 transition-colors"
                      title="删除记录"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
