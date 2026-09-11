"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Upload,
  Download,
  Smartphone,
  Laptop,
  CheckCircle2,
  Copy,
  RefreshCw,
  FileIcon,
  Sparkles,
  Send,
  Loader2,
  Check,
} from "lucide-react";

interface TransferredFile {
  id: string;
  name: string;
  size: number;
  mimeType: string;
  createdAt: string;
  downloadUrl?: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export default function MobileTransferPortal() {
  const [activeTab, setActiveTab] = useState<"upload" | "download">("upload");
  const [sharedFiles, setSharedFiles] = useState<TransferredFile[]>([]);
  const [clipboardText, setClipboardText] = useState("");
  const [isRefreshing, setIsRefreshing] = useState(false);

  // 上传相关状态
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadSuccessCount, setUploadSuccessCount] = useState(0);
  const [uploadProgress, setUploadProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 发送文本给电脑
  const [inputText, setInputText] = useState("");
  const [textSending, setTextSending] = useState(false);
  const [textSentSuccess, setTextSentSuccess] = useState(false);

  // 复制反馈
  const [copied, setCopied] = useState(false);

  // 拉取电脑共享状态
  const fetchStatus = async () => {
    setIsRefreshing(true);
    try {
      const res = await fetch("/api/transfer");
      const data = await res.json();
      if (data.success) {
        setSharedFiles(data.sharedFiles || []);
        setClipboardText(data.clipboardText || "");
      }
    } catch {}
    finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    const timer = setInterval(fetchStatus, 5000);
    return () => clearInterval(timer);
  }, []);

  // 手机文件选择
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const files = Array.from(e.target.files);
      setSelectedFiles((prev) => [...prev, ...files]);
      setUploadSuccessCount(0);
    }
  };

  // 执行上传
  const handleStartUpload = async () => {
    if (selectedFiles.length === 0) return;
    setUploading(true);
    setUploadProgress(10);

    const formData = new FormData();
    selectedFiles.forEach((file) => {
      formData.append("files", file);
    });

    try {
      setUploadProgress(45);
      const res = await fetch("/api/transfer?action=upload", {
        method: "POST",
        body: formData,
      });
      const data = await res.json();
      if (data.success) {
        setUploadProgress(100);
        setUploadSuccessCount(selectedFiles.length);
        setSelectedFiles([]);
        if (fileInputRef.current) fileInputRef.current.value = "";
        fetchStatus();
      } else {
        alert(`上传失败: ${data.error || "未知错误"}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "网络异常";
      alert(`上传出错: ${message}`);
    } finally {
      setUploading(false);
      setTimeout(() => setUploadProgress(0), 1000);
    }
  };

  // 手机发送文本给电脑
  const handleSendText = async () => {
    if (!inputText.trim()) return;
    setTextSending(true);
    try {
      const res = await fetch("/api/transfer?action=clipboard", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: inputText.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setTextSentSuccess(true);
        setInputText("");
        fetchStatus();
        setTimeout(() => setTextSentSuccess(false), 2000);
      }
    } catch {
      alert("发送失败，请检查网络");
    } finally {
      setTextSending(false);
    }
  };

  const handleCopyClipboard = async () => {
    if (!clipboardText) return;
    try {
      await navigator.clipboard.writeText(clipboardText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      alert("复制失败，请长按文本手动复制");
    }
  };

  return (
    <div className="min-h-screen bg-neutral-950 text-neutral-100 font-sans p-4 max-w-lg mx-auto flex flex-col">
      {/* 顶部标题栏 */}
      <header className="flex items-center justify-between py-3 border-b border-neutral-800">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-xl bg-sky-500/20 text-sky-400 flex items-center justify-center font-bold">
            <Smartphone size={20} />
          </div>
          <div>
            <div className="flex items-center gap-1.5">
              <h1 className="text-[16px] font-bold text-neutral-100">FurinaKit 手机传送门</h1>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 font-semibold">
                免装 App
              </span>
            </div>
            <p className="text-[11px] text-neutral-400">连接同一 Wi-Fi 或热点 · 双向秒传照片与文件</p>
          </div>
        </div>
        <button
          onClick={fetchStatus}
          disabled={isRefreshing}
          className="h-8 w-8 rounded-lg bg-neutral-900 border border-neutral-800 flex items-center justify-center text-neutral-400 active:scale-95"
        >
          <RefreshCw size={14} className={isRefreshing ? "animate-spin text-sky-400" : ""} />
        </button>
      </header>

      {/* 切换选项卡 */}
      <div className="grid grid-cols-2 gap-2 mt-4 p-1 rounded-xl bg-neutral-900 border border-neutral-800">
        <button
          onClick={() => setActiveTab("upload")}
          className={`py-2.5 text-[13px] font-semibold rounded-lg transition-all flex items-center justify-center gap-2 ${
            activeTab === "upload"
              ? "bg-sky-600 text-white shadow-sm"
              : "text-neutral-400 hover:text-neutral-200"
          }`}
        >
          <Upload size={16} />
          <span>传给电脑</span>
        </button>
        <button
          onClick={() => setActiveTab("download")}
          className={`py-2.5 text-[13px] font-semibold rounded-lg transition-all flex items-center justify-center gap-2 ${
            activeTab === "download"
              ? "bg-sky-600 text-white shadow-sm"
              : "text-neutral-400 hover:text-neutral-200"
          }`}
        >
          <Download size={16} />
          <span>从电脑下载 ({sharedFiles.length})</span>
        </button>
      </div>

      {/* 选项卡 1：手机传给电脑 */}
      {activeTab === "upload" && (
        <div className="mt-4 space-y-4 flex-1">
          {/* 大按键选取区域 */}
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-sky-500/40 rounded-2xl p-6 text-center bg-sky-500/5 hover:bg-sky-500/10 active:scale-[0.99] transition-all cursor-pointer"
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={handleFileChange}
              className="hidden"
            />
            <div className="mx-auto h-12 w-12 rounded-full bg-sky-500/20 text-sky-400 flex items-center justify-center">
              <Upload size={24} />
            </div>
            <div className="mt-3 text-[14px] font-bold text-neutral-100">
              点击选取文件 / 照片 / 视频
            </div>
            <p className="mt-1 text-[11px] text-neutral-400">
              支持多选，通过家庭 Wi-Fi 极速直连电脑，不耗手机移动流量
            </p>
          </div>

          {/* 成功反馈 */}
          {uploadSuccessCount > 0 && (
            <div className="p-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-400 flex items-center gap-2 text-[12px]">
              <CheckCircle2 size={16} />
              <span>成功传输 {uploadSuccessCount} 个文件至电脑！</span>
            </div>
          )}

          {/* 待上传队列 */}
          {selectedFiles.length > 0 && (
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-3 space-y-2">
              <div className="flex items-center justify-between text-[12px] text-neutral-400 font-medium">
                <span>待发送文件 ({selectedFiles.length})</span>
                <button
                  onClick={() => setSelectedFiles([])}
                  className="text-rose-400 hover:underline"
                >
                  清空
                </button>
              </div>

              <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1">
                {selectedFiles.map((f, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between text-[12px] bg-neutral-950/80 p-2 rounded-lg border border-neutral-800/80"
                  >
                    <div className="flex items-center gap-2 truncate max-w-[220px]">
                      <FileIcon size={14} className="text-sky-400 shrink-0" />
                      <span className="truncate text-neutral-200">{f.name}</span>
                    </div>
                    <span className="text-[11px] text-neutral-500 font-mono">
                      {formatBytes(f.size)}
                    </span>
                  </div>
                ))}
              </div>

              {uploadProgress > 0 && (
                <div className="w-full bg-neutral-800 h-1.5 rounded-full overflow-hidden mt-2">
                  <div
                    className="bg-sky-500 h-full transition-all duration-300"
                    style={{ width: `${uploadProgress}%` }}
                  />
                </div>
              )}

              <button
                onClick={handleStartUpload}
                disabled={uploading}
                className="w-full mt-2 py-2.5 bg-sky-500 hover:bg-sky-600 disabled:opacity-50 text-white font-bold text-[13px] rounded-xl flex items-center justify-center gap-2 active:scale-98 transition-all"
              >
                {uploading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    <span>正在飞速传送中...</span>
                  </>
                ) : (
                  <>
                    <Send size={15} />
                    <span>立即发送到电脑</span>
                  </>
                )}
              </button>
            </div>
          )}

          {/* 手机传文字给电脑 */}
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-3.5 space-y-2">
            <div className="flex items-center gap-1.5 text-[12px] font-semibold text-neutral-300">
              <Laptop size={14} className="text-sky-400" />
              <span>发送文本 / 网址到电脑剪贴板</span>
            </div>
            <div className="flex gap-2">
              <input
                type="text"
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="粘贴手机上的链接、验证码或文本..."
                className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-[12px] text-neutral-200 outline-none focus:border-sky-500"
              />
              <button
                onClick={handleSendText}
                disabled={textSending || !inputText.trim()}
                className="px-4 bg-neutral-800 hover:bg-neutral-700 disabled:opacity-40 text-neutral-200 text-[12px] font-semibold rounded-lg shrink-0 flex items-center gap-1"
              >
                {textSentSuccess ? <Check size={14} className="text-emerald-400" /> : <Send size={13} />}
                <span>{textSentSuccess ? "已送达" : "发送"}</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 选项卡 2：从电脑下载 */}
      {activeTab === "download" && (
        <div className="mt-4 space-y-4 flex-1">
          {/* 剪贴板同步卡片 */}
          {clipboardText && (
            <div className="p-3.5 rounded-xl border border-sky-500/30 bg-sky-500/10 space-y-2">
              <div className="flex items-center justify-between text-[11px] text-sky-400 font-semibold">
                <span className="flex items-center gap-1">
                  <Sparkles size={12} />
                  电脑端共享的剪贴板文本
                </span>
                <button
                  onClick={handleCopyClipboard}
                  className="flex items-center gap-1 text-[11px] text-neutral-200 bg-sky-600/30 hover:bg-sky-600/50 px-2 py-0.5 rounded"
                >
                  {copied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />}
                  <span>{copied ? "已复制" : "复制"}</span>
                </button>
              </div>
              <p className="text-[13px] text-neutral-200 break-all select-all font-mono bg-neutral-950/60 p-2 rounded-lg">
                {clipboardText}
              </p>
            </div>
          )}

          {/* 电脑共享文件列表 */}
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-3 space-y-2">
            <div className="flex items-center justify-between text-[12px] text-neutral-400 font-medium">
              <span>电脑正在共享的文件</span>
              <span>共 {sharedFiles.length} 项</span>
            </div>

            {sharedFiles.length === 0 ? (
              <div className="py-12 text-center text-[12px] text-neutral-500 space-y-2">
                <div className="mx-auto h-10 w-10 rounded-full bg-neutral-800 flex items-center justify-center text-neutral-600">
                  <Laptop size={20} />
                </div>
                <div>电脑端尚未共享文件</div>
                <p className="text-[11px] text-neutral-600">
                  在电脑 FurinaKit 窗口中拖入文件即可在此实时显示并下载
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                {sharedFiles.map((file) => (
                  <div
                    key={file.id}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-neutral-950 border border-neutral-800"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 pr-2">
                      <div className="h-8 w-8 rounded-lg bg-sky-500/10 text-sky-400 flex items-center justify-center shrink-0">
                        <FileIcon size={16} />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[13px] font-medium text-neutral-200 truncate">
                          {file.name}
                        </div>
                        <div className="text-[10px] text-neutral-500 font-mono">
                          {formatBytes(file.size)}
                        </div>
                      </div>
                    </div>
                    <a
                      href={`/api/transfer/download?id=${encodeURIComponent(file.name)}&type=shared`}
                      download={file.name}
                      className="px-3.5 py-1.5 bg-sky-500 hover:bg-sky-600 active:scale-95 text-white font-semibold text-[12px] rounded-lg shrink-0 flex items-center gap-1.5 transition-all"
                    >
                      <Download size={13} />
                      <span>下载</span>
                    </a>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 底部信息 */}
      <footer className="mt-8 pt-4 border-t border-neutral-900 text-center text-[11px] text-neutral-500">
        FurinaKit · 极速局域网点对点互传 · 数据不经过任何外网服务器
      </footer>
    </div>
  );
}
