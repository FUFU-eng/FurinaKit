"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/lan-transfer-tool.tsx");


import React, { useState, useEffect, useRef, useCallback } from "react";
import QRCode from "qrcode";
import {
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
import { Select } from "@/components/ui/primitives";

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
  const __locale = __useLanguage();
  const [ips, setIps] = useState<Array<{ name: string; ip: string }>>([]);
  const [selectedIp, setSelectedIp] = useState<string>("");
  const [port, setPort] = useState<string>("3001");
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const [lanToken, setLanToken] = useState<string>("");

  const [sharedFiles, setSharedFiles] = useState<TransferredFile[]>([]);
  const [receivedFiles, setReceivedFiles] = useState<TransferredFile[]>([]);
  const [clipboardText, setClipboardText] = useState<string>("");
  const [receiveDir, setReceiveDir] = useState<string>("");

  const [clipboardInput, setClipboardInput] = useState<string>("");
  const [copiedLink, setCopiedLink] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSharingFiles, setIsSharingFiles] = useState(false);

  const [actionError, setActionError] = useState("");
  const [statusError, setStatusError] = useState("");
  const alive = useRef(true);
  const statusSequence = useRef(0);
  const statusAbort = useRef<AbortController | null>(null);
  const shareAbort = useRef<AbortController | null>(null);
  const shareBusy = useRef(false);
  const syncBusy = useRef(false);
  const inputRevision = useRef(0);
  const stagedRevision = useRef(0);
  const badgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      statusSequence.current++;
      statusAbort.current?.abort();
      shareAbort.current?.abort();
      if (badgeTimer.current) clearTimeout(badgeTimer.current);
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  // null is the initial snapshot; a later 0 -> 1 must show a notification too.
  const lastReceivedCountRef = useRef<number | null>(null);
  const [newFileBadge, setNewFileBadge] = useState<string | null>(null);

  const fetchStatus = useCallback(async (automatic = false) => {
    // A slow response must survive timer ticks. Explicit refresh/actions may
    // still supersede it; sequence guards keep their newer result authoritative.
    if (!alive.current || (automatic && statusAbort.current)) return;
    const sequence = ++statusSequence.current;
    statusAbort.current?.abort();
    const controller = new AbortController();
    statusAbort.current = controller;
    const current = () => alive.current && sequence === statusSequence.current;
    setIsRefreshing(true);
    try {
      const res = await fetch("/api/transfer", { signal: controller.signal });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "读取互传状态失败");
      if (!current()) return;
      setStatusError("");
      const nextIps: Array<{ name: string; ip: string }> = Array.isArray(data.ips) ? data.ips : [];
      setIps(nextIps);
      setSelectedIp((selected) => nextIps.some((item) => item.ip === selected)
        ? selected : nextIps[0]?.ip || "");
      setPort(data.port || "3001");
      setSharedFiles(data.sharedFiles || []);
      setReceiveDir(data.receiveDir || "");
      const received: TransferredFile[] = data.receivedFiles || [];
      if (lastReceivedCountRef.current !== null && received.length > lastReceivedCountRef.current) {
        setNewFileBadge(`刚刚收到新文件：${received[0].name}`);
        if (badgeTimer.current) clearTimeout(badgeTimer.current);
        badgeTimer.current = setTimeout(() => { if (alive.current) setNewFileBadge(null); }, 5000);
      }
      lastReceivedCountRef.current = received.length;
      setReceivedFiles(received);
      setClipboardText(data.clipboardText || "");
    } catch (error) {
      if (current() && !controller.signal.aborted) setStatusError(error instanceof Error ? error.message : "读取互传状态失败");
    } finally {
      if (current()) {
        statusAbort.current = null;
        setIsRefreshing(false);
      }
    }
  }, []);

  const requestAction = async (action: string, args: Record<string, string> = {}) => {
    const res = await fetch(`/api/transfer?action=${action}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(args),
    });
    const data = await res.json();
    if (!res.ok || !data.success) throw new Error(data.error || "互传操作失败");
    return data;
  };
  const performAction = async (action: string, args: Record<string, string> = {}) => {
    setActionError("");
    try {
      await requestAction(action, args);
      if (alive.current) void fetchStatus();
    } catch (error) {
      if (alive.current) setActionError(error instanceof Error ? error.message : "互传操作失败");
    }
  };
  const handleChangeReceiveDir = async () => {
    try {
      const selected = window.furinakit?.selectDirectory
        ? await window.furinakit.selectDirectory()
        : window.prompt(__ui("请输入手机上传文件的电脑保存路径："), receiveDir);
      if (alive.current && selected?.trim()) await performAction("set-receive-dir", { receiveDir: selected.trim() });
    } catch (error) {
      if (alive.current) setActionError(error instanceof Error ? error.message : "选择目录失败");
    }
  };

  useEffect(() => {
    trackToolUsage("lan-transfer");
    fetchStatus();
    const timer = setInterval(() => void fetchStatus(true), 3000);
    return () => clearInterval(timer);
  }, [fetchStatus]);

  // 读取本次启动的互传令牌：只有本机界面能读到它，手机必须靠二维码里的令牌才能访问互传接口，
  // 这样即使前端服务监听在整个局域网上，同网段的其它设备也无法调用（含写入与打开文件）。
  useEffect(() => {
    let cancelled = false;
    fetch("/api/lan-token")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d?.token) setLanToken(d.token);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // 生成二维码（带上令牌，扫码即可授权）
  const portalUrl = selectedIp && lanToken
    ? `http://${selectedIp}:${port}/portal/transfer${lanToken ? `?t=${encodeURIComponent(lanToken)}` : ""}`
    : "";

  useEffect(() => {
    let cancelled = false;
    setQrDataUrl("");
    if (portalUrl) {
      QRCode.toDataURL(portalUrl, { width: 180, margin: 1, color: { dark: "#0369a1", light: "#ffffff" } })
        .then((url) => { if (!cancelled) setQrDataUrl(url); })
        .catch(() => { if (!cancelled) setStatusError("生成互传二维码失败，请刷新重试"); });
    }
    return () => { cancelled = true; };
  }, [portalUrl]);

  const handleCopyLink = async () => {
    if (!portalUrl) return;
    try {
      await navigator.clipboard.writeText(portalUrl);
      if (!alive.current) return;
      setCopiedLink(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => { if (alive.current) setCopiedLink(false); }, 2000);
    } catch {
      if (alive.current) setActionError("复制链接失败，请重试");
    }
  };

  const [stagedFiles, setStagedFiles] = useState<File[]>([]);

  const stageFiles = (files: File[]) => {
    stagedRevision.current++;
    setStagedFiles(files);
  };
  const changeClipboardInput = (text: string) => {
    inputRevision.current++;
    setClipboardInput(text);
  };

  // An explicit click authorizes this batch only; a later drop replaces the
  // pending batch and must not be cleared or shared by this older completion.
  const handleShareFiles = async (acceptedFiles: File[]) => {
    if (!alive.current || acceptedFiles.length === 0 || shareBusy.current) return;
    shareBusy.current = true;
    const revision = stagedRevision.current;
    const controller = new AbortController();
    shareAbort.current = controller;
    setIsSharingFiles(true);
    setActionError("");
    try {
      const formData = new FormData();
      acceptedFiles.forEach((file) => formData.append("files", file));
      const res = await fetch("/api/transfer?action=share", { method: "POST", body: formData, signal: controller.signal });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "共享失败");
      if (!alive.current) return;
      if (revision === stagedRevision.current) setStagedFiles([]);
      void fetchStatus();
    } catch (error) {
      if (alive.current && !controller.signal.aborted) setActionError(error instanceof Error ? error.message : "共享失败");
    } finally {
      shareBusy.current = false;
      if (alive.current) setIsSharingFiles(false);
    }
  };
  const { getRootProps, getInputProps, isDragActive } = useDropzone({ onDrop: stageFiles });

  const handleSyncClipboard = async () => {
    if (!alive.current || !clipboardInput.trim() || syncBusy.current) return;
    const text = clipboardInput.trim();
    const revision = inputRevision.current;
    syncBusy.current = true;
    setActionError("");
    try {
      await requestAction("clipboard", { text });
      if (!alive.current) return;
      if (revision === inputRevision.current) setClipboardInput("");
      void fetchStatus();
    } catch (error) {
      if (alive.current) setActionError(error instanceof Error ? error.message : "发送文本失败");
    } finally { syncBusy.current = false; }
  };
  const handleDeleteShared = (id: string) => performAction("delete-shared", { id });
  const handleDeleteReceived = (id: string) => performAction("delete-received", { id });
  const handleOpenFolder = () => performAction("open-folder");
  const handleOpenFile = (path: string) => performAction("open-file", { path });

  return (
    <div className="space-y-6">
      {(actionError || statusError) && <div role="alert" className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{actionError || statusError}</div>}
      {/* 连接操作条与局域网二维码：地址、复制、打开、刷新与扫码入口 */}
      <div className="rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-5 shadow-sm">
        <div className="flex flex-col md:flex-row items-center justify-between gap-6">
          {/* 左侧：IP 选单与快捷操作 */}
          <div className="space-y-3 flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex items-center gap-1.5 rounded-lg border border-border/80 bg-background/80 px-2.5 py-1 text-[12px]">
                {/* whitespace-nowrap + shrink-0：原来"本机 IP:"会被挤成两行（"本机" / "IP:"），很难看 */}
                <span className="shrink-0 whitespace-nowrap text-muted-foreground">{__ui("本机 IP:")}</span>
                <Select
                  value={selectedIp}
                  onChange={(e) => setSelectedIp(e.target.value)}
                  className="bg-transparent font-mono font-semibold text-primary outline-none cursor-pointer"
                >
                  {ips.length === 0 && <option value="">{__ui("（正在获取本机地址…）")}</option>}
                  {ips.map((item, i) => (
                    <option key={i} value={item.ip} className="bg-background text-foreground">
                      {item.name} ({item.ip})
                    </option>
                  ))}
                </Select>
              </div>

              {/* 手机要访问的地址：给足宽度（原来地址为空时这里会缩成一个小方块） */}
              <div
                className="flex min-w-[240px] max-w-[380px] items-center gap-1 rounded-lg border border-border/80 bg-background/80 px-2.5 py-1 text-[12px] font-mono text-foreground/80"
                title={portalUrl || __ui("正在获取本机地址…")}
              >
                <span className="truncate">{portalUrl || __ui("正在获取本机地址…")}</span>
              </div>

              <button
                type="button"
                onClick={handleCopyLink}
                className="inline-flex h-7 items-center gap-1 rounded-lg bg-primary/10 border border-primary/20 px-2.5 text-[11px] font-semibold text-primary hover:bg-primary/20 transition-colors"
              >
                {copiedLink ? <Check size={12} /> : <Copy size={12} />}
                <span>{copiedLink ? __ui("已复制") : __ui("复制链接")}</span>
              </button>

              <a
                href={portalUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex h-7 items-center gap-1 rounded-lg border border-border px-2.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
              >
                <ExternalLink size={12} />
                <span>{__ui("浏览器打开")}</span>
              </a>

              <button
                type="button"
                onClick={() => void fetchStatus()}
                disabled={isRefreshing}
                className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-border text-muted-foreground hover:text-foreground transition-colors"
                title={__ui("刷新状态")}
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
                  alt={__ui("扫码进入手机互传")}
                  className="h-32 w-32 rounded-lg"
                />
              ) : (
                <div className="h-32 w-32 flex items-center justify-center text-[11px] text-muted-foreground">
                  {__ui("生成二维码中...")}</div>
              )}
            </div>
            <span className="mt-1.5 text-[11px] font-medium text-muted-foreground flex items-center gap-1">
              <Smartphone size={12} className="text-primary" />
              {__ui("任意软件扫码即传")}</span>
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
            {__ui("立即在文件夹中查看")}</button>
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
                {__ui("电脑共享给手机的文件")}</h3>
            </div>
            <span className="text-[11px] text-muted-foreground">
              {__ui("共")}{sharedFiles.length} {__ui("项正在共享")}</span>
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
              {__ui("拖拽文件到这里，或点击选取")}</div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {__ui("手机端打开传送门即可实时查看并一键下载到手机相册或文件夹")}</p>
          </div>

          {stagedFiles.length > 0 && <div className="rounded-xl border border-border p-3 space-y-2">
            <p className="text-xs text-muted-foreground">{__ui("已载入")}{stagedFiles.length} {__ui("个文件，尚未共享")}</p>
            {stagedFiles.map((file,i)=><p key={`${file.name}-${i}`} className="truncate text-xs">{file.name}</p>)}
            <button disabled={isSharingFiles} onClick={()=>void handleShareFiles(stagedFiles)} className="rounded-lg bg-primary px-4 py-2 text-xs text-primary-foreground disabled:opacity-50">{__ui("确认共享文件")}</button>
          </div>}
          {/* 剪贴板快速同步 */}
          <div className="space-y-2 pt-1 border-t border-border/60">
            <label className="text-[12px] font-semibold text-foreground flex items-center gap-1.5">
              <Sparkles size={13} className="text-amber-500" />
              <span>{__ui("同步文本 / 网址至手机剪贴板")}</span>
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={clipboardInput}
                onChange={(e) => changeClipboardInput(e.target.value)}
                placeholder={__ui("输入想发送到手机的网址、账号密码或文本...")}
                className="flex-1 bg-muted/40 border border-border/80 rounded-xl px-3 py-2 text-[12px] outline-none focus:border-primary"
              />
              <button
                type="button"
                onClick={handleSyncClipboard}
                className="px-3.5 bg-primary text-primary-foreground font-semibold text-[12px] rounded-xl flex items-center gap-1 hover:opacity-90 active:scale-95 transition-all"
              >
                <Send size={13} />
                <span>{__ui("同步")}</span>
              </button>
            </div>
            {clipboardText && (
              <div className="flex items-center justify-between text-[11px] bg-muted/30 p-2 rounded-lg border border-border/50 text-muted-foreground">
                <span className="truncate max-w-[280px]">{__ui("当前共享:")}{clipboardText}</span>
                <button
                  onClick={() => void performAction("clipboard", { text: "" })}
                  className="text-rose-500 hover:underline shrink-0 ml-2"
                >
                  {__ui("清除")}</button>
              </div>
            )}
          </div>

          {/* 共享文件列表 */}
          <div className="space-y-2">
            <div className="text-[12px] font-semibold text-muted-foreground">
              {__ui("已放入共享池的文件")}</div>
            {sharedFiles.length === 0 ? (
              <div className="py-6 text-center text-[12px] text-muted-foreground border border-dashed border-border/60 rounded-xl">
                {__ui("共享池为空，拖入文件即可开启共享")}</div>
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
                          {__msg(formatBytes(f.size))} · {new Date(f.createdAt).toLocaleTimeString()}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        onClick={() => handleDeleteShared(f.id)}
                        className="p-1.5 text-muted-foreground hover:text-rose-500 transition-colors"
                        title={__ui("移除共享")}
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
                {__ui("从手机接收到的文件")}</h3>
            </div>
            <span className="text-[11px] text-muted-foreground">
              {__ui("共")}{receivedFiles.length} {__ui("项已接收")}</span>
          </div>

          {/* 保存目录设置与快捷打开 */}
          <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-muted/30 border border-border/70 text-[12px]">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <FolderOpen size={14} className="text-amber-500 shrink-0" />
              <span className="text-muted-foreground shrink-0 text-[11px]">{__ui("保存目录:")}</span>
              <span className="font-mono text-foreground text-[11px] truncate select-all" title={receiveDir}>
                {receiveDir || __ui("默认存储目录")}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleChangeReceiveDir}
                className="px-2.5 py-1 rounded-lg border border-border hover:bg-muted text-[11px] font-medium transition-colors"
              >
                {__ui("更改目录")}</button>
              <button
                type="button"
                onClick={handleOpenFolder}
                className="px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/20 text-primary hover:bg-primary/20 text-[11px] font-semibold transition-colors flex items-center gap-1"
              >
                <FolderOpen size={12} />
                <span>{__ui("打开")}</span>
              </button>
            </div>
          </div>

          {/* 接收列表 */}
          {receivedFiles.length === 0 ? (
            <div className="py-14 text-center text-[12px] text-muted-foreground border border-dashed border-border/60 rounded-xl space-y-2">
              <div className="mx-auto h-12 w-12 rounded-full bg-muted/40 flex items-center justify-center text-muted-foreground">
                <Smartphone size={24} />
              </div>
              <div className="font-medium text-foreground">{__ui("暂未收到手机发来的文件")}</div>
              <p className="text-[11px] text-muted-foreground max-w-xs mx-auto">
                {__ui("手机连接同一 Wi-Fi 或热点后，使用任意软件扫描上方二维码，点击“传给电脑”选取照片或文件即可极速传输！")}</p>
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
                        {__msg(formatBytes(f.size))} {__ui("· 接收于")}{new Date(f.createdAt).toLocaleTimeString()}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0">
                    {f.path && (
                      <button
                        onClick={() => handleOpenFile(f.path!)}
                        className="px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/20 text-[11px] font-semibold text-primary hover:bg-primary/20 transition-colors"
                      >
                        {__ui("打开")}</button>
                    )}
                    <a
                      href={`/api/transfer/download?id=${encodeURIComponent(f.id)}&type=received`}
                      download={f.name}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground transition-colors"
                      title={__ui("保存副本")}
                    >
                      <Download size={14} />
                    </a>
                    <button
                      onClick={() => handleDeleteReceived(f.id)}
                      className="p-1.5 rounded-lg text-muted-foreground hover:text-rose-500 transition-colors"
                      title={__ui("删除记录（不会删除磁盘上的文件）")}
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
