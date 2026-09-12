"use client";

import React, { useState, useRef, useEffect, useMemo } from "react";
import JSZip from "jszip";
import {
  FileImage,
  FolderArchive,
  Lock,
  Unlock,
  Download,
  CheckCircle2,
  Sparkles,
  Info,
  Archive,
  FileText,
  RotateCw,
} from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { cn, formatBytes } from "@/lib/utils";
import { trackToolUsage } from "@/lib/analytics";

interface HiddenFileInfo {
  name: string;
  size: number;
  type: string;
}

interface FileHideCacheState {
  activeTab: "pack" | "unpack";
  coverFile: File | null;
  coverPreviewUrl: string | null;
  secretFiles: File[];
  packedResultUrl: string | null;
  packedResultName: string;
  packedResultSize: number;
  unpackFile: File | null;
  unpackPreviewUrl: string | null;
  detectedType: string | null;
  extractedFiles: HiddenFileInfo[];
  extractedArchiveBlob: Blob | null;
  extractedArchiveName: string;
}

const fileHideCache: FileHideCacheState = {
  activeTab: "pack",
  coverFile: null,
  coverPreviewUrl: null,
  secretFiles: [],
  packedResultUrl: null,
  packedResultName: "",
  packedResultSize: 0,
  unpackFile: null,
  unpackPreviewUrl: null,
  detectedType: null,
  extractedFiles: [],
  extractedArchiveBlob: null,
  extractedArchiveName: "",
};

export function FileHideImageTool() {
  const { toast } = useToast();
  const [activeTab, setActiveTabState] = useState<"pack" | "unpack">(fileHideCache.activeTab);

  // === 制作图种状态 ===
  const [coverFile, setCoverFileState] = useState<File | null>(fileHideCache.coverFile);
  const [coverPreviewUrl, setCoverPreviewUrlState] = useState<string | null>(fileHideCache.coverPreviewUrl);
  const [secretFiles, setSecretFilesState] = useState<File[]>(fileHideCache.secretFiles);
  const [packLoading, setPackLoading] = useState(false);
  const [packedResultUrl, setPackedResultUrlState] = useState<string | null>(fileHideCache.packedResultUrl);
  const [packedResultName, setPackedResultNameState] = useState<string>(fileHideCache.packedResultName);
  const [packedResultSize, setPackedResultSizeState] = useState<number>(fileHideCache.packedResultSize);

  // === 提取图种状态 ===
  const [unpackFile, setUnpackFileState] = useState<File | null>(fileHideCache.unpackFile);
  const [unpackPreviewUrl, setUnpackPreviewUrlState] = useState<string | null>(fileHideCache.unpackPreviewUrl);
  const [unpackLoading, setUnpackLoading] = useState(false);
  const [detectedType, setDetectedTypeState] = useState<string | null>(fileHideCache.detectedType);
  const [extractedFiles, setExtractedFilesState] = useState<HiddenFileInfo[]>(fileHideCache.extractedFiles);
  const [extractedArchiveBlob, setExtractedArchiveBlobState] = useState<Blob | null>(fileHideCache.extractedArchiveBlob);
  const [extractedArchiveName, setExtractedArchiveNameState] = useState<string>(fileHideCache.extractedArchiveName);

  // 提取出的压缩包下载链接。
  // 不能直接在 render 里调用 URL.createObjectURL：那样每次渲染都会新建一个 object URL
  // 且永不释放，而一个解密包动辄几百 MB —— 用户每点一次交互就泄漏一整份数据。
  const extractedArchiveUrl = useMemo(
    () => (extractedArchiveBlob ? URL.createObjectURL(extractedArchiveBlob) : null),
    [extractedArchiveBlob],
  );
  useEffect(() => {
    return () => {
      if (extractedArchiveUrl) URL.revokeObjectURL(extractedArchiveUrl);
    };
  }, [extractedArchiveUrl]);

  const setActiveTab = (tab: "pack" | "unpack") => {
    fileHideCache.activeTab = tab;
    setActiveTabState(tab);
  };
  const setCoverFile = (f: File | null) => {
    fileHideCache.coverFile = f;
    setCoverFileState(f);
  };
  const setCoverPreviewUrl = (url: string | null) => {
    fileHideCache.coverPreviewUrl = url;
    setCoverPreviewUrlState(url);
  };
  const setSecretFiles = (updater: File[] | ((prev: File[]) => File[])) => {
    setSecretFilesState((prev) => {
      const next = typeof updater === "function" ? updater(prev) : updater;
      fileHideCache.secretFiles = next;
      return next;
    });
  };
  const setPackedResultUrl = (url: string | null) => {
    fileHideCache.packedResultUrl = url;
    setPackedResultUrlState(url);
  };
  const setPackedResultName = (name: string) => {
    fileHideCache.packedResultName = name;
    setPackedResultNameState(name);
  };
  const setPackedResultSize = (sz: number) => {
    fileHideCache.packedResultSize = sz;
    setPackedResultSizeState(sz);
  };
  const setUnpackFile = (f: File | null) => {
    fileHideCache.unpackFile = f;
    setUnpackFileState(f);
  };
  const setUnpackPreviewUrl = (url: string | null) => {
    fileHideCache.unpackPreviewUrl = url;
    setUnpackPreviewUrlState(url);
  };
  const setDetectedType = (t: string | null) => {
    fileHideCache.detectedType = t;
    setDetectedTypeState(t);
  };
  const setExtractedFiles = (files: HiddenFileInfo[]) => {
    fileHideCache.extractedFiles = files;
    setExtractedFilesState(files);
  };
  const setExtractedArchiveBlob = (b: Blob | null) => {
    fileHideCache.extractedArchiveBlob = b;
    setExtractedArchiveBlobState(b);
  };
  const setExtractedArchiveName = (n: string) => {
    fileHideCache.extractedArchiveName = n;
    setExtractedArchiveNameState(n);
  };

  const coverInputRef = useRef<HTMLInputElement>(null);
  const secretInputRef = useRef<HTMLInputElement>(null);
  const unpackInputRef = useRef<HTMLInputElement>(null);

  // 处理封面图片选择
  const handleCoverSelect = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    if (!file.type.startsWith("image/")) {
      toast({ title: "请选择有效的图片文件 (JPG/PNG/WEBP)", variant: "error" });
      return;
    }
    setCoverFile(file);
    if (coverPreviewUrl) URL.revokeObjectURL(coverPreviewUrl);
    setCoverPreviewUrl(URL.createObjectURL(file));
    setPackedResultUrl(null);
  };

  // 处理隐写机密文件选择
  const handleSecretSelect = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setSecretFiles(Array.from(files));
    setPackedResultUrl(null);
  };

  // 生成伪装图片（制作图种）
  const handleCreateDisguisedImage = async () => {
    if (!coverFile) {
      toast({ title: "请先选择一张封面图片", variant: "error" });
      return;
    }
    if (secretFiles.length === 0) {
      toast({ title: "请选择需要伪装隐藏的文件", variant: "error" });
      return;
    }

    setPackLoading(true);
    trackToolUsage("file-hide-image");

    try {
      // 1. 读取封面图片二进制
      const coverBuffer = await coverFile.arrayBuffer();

      // 2. 准备需要隐藏的数据流（如果单个且本身就是压缩包，则直接二进制追加；如果是多个文件或普通文件，则先用 JSZip 封装）
      let secretBuffer: ArrayBuffer;
      let defaultExt = ".zip";

      if (
        secretFiles.length === 1 &&
        /\.(zip|rar|7z|tar|gz)$/i.test(secretFiles[0].name)
      ) {
        secretBuffer = await secretFiles[0].arrayBuffer();
        const extMatch = secretFiles[0].name.match(/\.(zip|rar|7z|tar|gz)$/i);
        if (extMatch) defaultExt = extMatch[0].toLowerCase();
      } else {
        const zip = new JSZip();
        for (const file of secretFiles) {
          zip.file(file.name, file);
        }
        secretBuffer = await zip.generateAsync({
          type: "arraybuffer",
          compression: "DEFLATE",
          compressionOptions: { level: 6 },
        });
      }

      // 3. 核心算法：二进制拼接 (image + secret data)
      // 无论 Windows、macOS 还是 Linux，图片查看器遇到 JPG 尾部标志 (FF D9) 或 PNG 尾部 (IEND) 会结束解码，
      // 而解压软件（WinRAR/7-Zip/Bandizip）从文件头开始扫描压缩包特征头，因此两者完全兼容共存！
      const combined = new Uint8Array(coverBuffer.byteLength + secretBuffer.byteLength);
      combined.set(new Uint8Array(coverBuffer), 0);
      combined.set(new Uint8Array(secretBuffer), coverBuffer.byteLength);

      const mimeType = coverFile.type || "image/jpeg";
      const blob = new Blob([combined], { type: mimeType });
      const url = URL.createObjectURL(blob);

      const baseName = coverFile.name.replace(/\.[^.]+$/, "");
      const outputExt = coverFile.name.substring(coverFile.name.lastIndexOf("."));
      const outName = `${baseName}_disguised${outputExt}`;

      setPackedResultUrl(url);
      setPackedResultName(outName);
      setPackedResultSize(combined.byteLength);

      toast({
        title: "文件伪装成功！",
        description: `已成功将 ${secretFiles.length} 个文件伪装隐藏入 ${coverFile.name} 中`,
        variant: "success",
      });
    } catch (err) {
      console.error(err);
      toast({
        title: "伪装处理失败",
        description: err instanceof Error ? err.message : "未知错误",
        variant: "error",
      });
    } finally {
      setPackLoading(false);
    }
  };

  // 处理待解密图种选择
  const handleUnpackSelect = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const file = files[0];
    setUnpackFile(file);
    if (unpackPreviewUrl) URL.revokeObjectURL(unpackPreviewUrl);
    setUnpackPreviewUrl(URL.createObjectURL(file));
    setDetectedType(null);
    setExtractedFiles([]);
    setExtractedArchiveBlob(null);
  };

  // 扫描并提取隐藏文件
  const handleExtractHiddenData = async () => {
    if (!unpackFile) {
      toast({ title: "请选择需要解析的图片文件", variant: "error" });
      return;
    }

    setUnpackLoading(true);
    trackToolUsage("file-hide-image");

    try {
      const buffer = await unpackFile.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      // 搜索主流压缩包标志位
      // ZIP: 0x50 0x4B 0x03 0x04 (PK\x03\x04)
      // RAR: 0x52 0x61 0x72 0x21 0x1A 0x07 (Rar!\x1a\x07)
      // 7-Zip: 0x37 0x7A 0xBC 0xAF 0x27 0x1C (7z\xbc\xaf\x27\x1c)
      let zipOffset = -1;
      let rarOffset = -1;
      let sevenZipOffset = -1;

      for (let i = 0; i < bytes.length - 8; i++) {
        if (
          zipOffset === -1 &&
          bytes[i] === 0x50 &&
          bytes[i + 1] === 0x4b &&
          bytes[i + 2] === 0x03 &&
          bytes[i + 3] === 0x04
        ) {
          zipOffset = i;
        }
        if (
          rarOffset === -1 &&
          bytes[i] === 0x52 &&
          bytes[i + 1] === 0x61 &&
          bytes[i + 2] === 0x72 &&
          bytes[i + 3] === 0x21
        ) {
          rarOffset = i;
        }
        if (
          sevenZipOffset === -1 &&
          bytes[i] === 0x37 &&
          bytes[i + 1] === 0x7a &&
          bytes[i + 2] === 0xbc &&
          bytes[i + 3] === 0xaf
        ) {
          sevenZipOffset = i;
        }
      }

      let payloadOffset = -1;
      let payloadType = "unknown";
      let archiveExt = ".zip";

      if (zipOffset !== -1) {
        payloadOffset = zipOffset;
        payloadType = "ZIP 压缩包";
        archiveExt = ".zip";
      } else if (rarOffset !== -1) {
        payloadOffset = rarOffset;
        payloadType = "RAR 压缩包";
        archiveExt = ".rar";
      } else if (sevenZipOffset !== -1) {
        payloadOffset = sevenZipOffset;
        payloadType = "7-Zip 压缩包";
        archiveExt = ".7z";
      } else {
        // 尝试根据 JPG/PNG 尾标提取
        let eof = -1;
        // JPG 尾标 0xFF 0xD9
        for (let i = bytes.length - 2; i >= 0; i--) {
          if (bytes[i] === 0xff && bytes[i + 1] === 0xd9) {
            eof = i + 2;
            break;
          }
        }
        if (eof !== -1 && eof < bytes.length) {
          payloadOffset = eof;
          payloadType = "未知格式隐藏数据";
          archiveExt = ".bin";
        }
      }

      if (payloadOffset === -1 || payloadOffset >= bytes.length) {
        toast({
          title: "未检测到隐藏文件",
          description: "该图片中似乎没有藏匿压缩包或附加数据，属于普通纯净图片",
          variant: "info",
        });
        setUnpackLoading(false);
        return;
      }

      // 提取隐藏段字节
      const hiddenBytes = bytes.slice(payloadOffset);
      const hiddenBlob = new Blob([hiddenBytes], {
        type: payloadType.includes("ZIP") ? "application/zip" : "application/octet-stream",
      });

      setDetectedType(payloadType);
      const base = unpackFile.name.replace(/\.[^.]+$/, "");
      setExtractedArchiveName(`${base}_extracted${archiveExt}`);
      setExtractedArchiveBlob(hiddenBlob);

      // 若为 ZIP 格式，尝试解析内部文件列表以供用户直接预览查看
      if (payloadType.includes("ZIP")) {
        try {
          const zip = await JSZip.loadAsync(hiddenBytes);
          const list: HiddenFileInfo[] = [];
          zip.forEach((relPath, entry) => {
            if (!entry.dir) {
              const zipEntryData = entry as unknown as { _data?: { uncompressedSize?: number } };
              list.push({
                name: relPath,
                size: zipEntryData._data?.uncompressedSize || 0,
                type: relPath.split(".").pop() || "file",
              });
            }
          });
          setExtractedFiles(list);
        } catch {
          setExtractedFiles([]);
        }
      } else {
        setExtractedFiles([]);
      }

      toast({
        title: `成功检测到隐藏内容 (${payloadType})`,
        description: `隐藏数据大小: ${formatBytes(hiddenBytes.length)}，可直接下载还原`,
        variant: "success",
      });
    } catch (err) {
      console.error(err);
      toast({
        title: "提取失败",
        description: err instanceof Error ? err.message : "无法解析文件",
        variant: "error",
      });
    } finally {
      setUnpackLoading(false);
    }
  };

  // 下载提取出的单个文件
  const handleDownloadSingleExtracted = async (fileName: string) => {
    if (!extractedArchiveBlob) return;
    try {
      const buffer = await extractedArchiveBlob.arrayBuffer();
      const zip = await JSZip.loadAsync(buffer);
      const file = zip.file(fileName);
      if (!file) throw new Error("未找到文件");
      const blob = await file.async("blob");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName.split("/").pop() || fileName;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast({ title: "单文件提取下载失败", variant: "error" });
    }
  };

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      {/* 模式切换：制作图种 / 还原提取 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex rounded-xl bg-muted/60 p-1 border border-border/40">
          <button
            onClick={() => setActiveTab("pack")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg transition-all",
              activeTab === "pack"
                ? "bg-background text-foreground shadow-sm shadow-black/5 font-bold"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Lock className="h-3.5 w-3.5 text-sky-500" />
            制作图种 (伪装)
          </button>
          <button
            onClick={() => setActiveTab("unpack")}
            className={cn(
              "flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-lg transition-all",
              activeTab === "unpack"
                ? "bg-background text-foreground shadow-sm shadow-black/5 font-bold"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Unlock className="h-3.5 w-3.5 text-amber-500" />
            还原提取 (解密)
          </button>
        </div>

        <span className="rounded-full border border-sky-500/20 bg-sky-500/10 px-2.5 py-0.5 text-xs font-medium text-sky-500">
          无损隐写
        </span>
      </div>

      {/* ================= TAB 1: 制作图种 ================= */}
      {activeTab === "pack" && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* 左侧：选择封面图片 */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-sky-500/10 text-sky-500 text-xs font-bold">
                    1
                  </span>
                  选择外表封面图片
                </label>
                {coverFile && (
                  <span className="text-xs text-muted-foreground">
                    {coverFile.name} ({formatBytes(coverFile.size)})
                  </span>
                )}
              </div>

              <div
                onClick={() => coverInputRef.current?.click()}
                className={cn(
                  "relative group flex flex-col items-center justify-center min-h-[220px] rounded-2xl border-2 border-dashed border-border/60 bg-muted/20 hover:bg-muted/30 transition-all cursor-pointer overflow-hidden p-4",
                  coverFile && "border-sky-500/50 bg-sky-500/5"
                )}
              >
                <input
                  ref={coverInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleCoverSelect(e.target.files)}
                />

                {coverPreviewUrl ? (
                  <div className="relative w-full h-full flex flex-col items-center justify-center gap-2">
                    <img
                      src={coverPreviewUrl}
                      alt="Cover Preview"
                      className="max-h-40 rounded-lg object-contain shadow-md border border-border/40"
                    />
                    <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                      点击更换封面图片
                    </span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-center">
                    <div className="h-12 w-12 rounded-2xl bg-sky-500/10 text-sky-500 flex items-center justify-center group-hover:scale-110 transition-transform">
                      <FileImage className="h-6 w-6" />
                    </div>
                    <div className="text-sm font-medium text-foreground">
                      点击或拖拽上传封面图
                    </div>
                    <div className="text-xs text-muted-foreground">
                      支持 JPG、PNG、WEBP 等常见图片格式
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 右侧：选择需要隐藏的文件 */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-semibold text-foreground flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-indigo-500/10 text-indigo-500 text-xs font-bold">
                    2
                  </span>
                  选择需要隐藏的文件
                </label>
                {secretFiles.length > 0 && (
                  <span className="text-xs text-muted-foreground">
                    已选 {secretFiles.length} 个文件 (共{" "}
                    {formatBytes(secretFiles.reduce((acc, f) => acc + f.size, 0))})
                  </span>
                )}
              </div>

              <div
                onClick={() => secretInputRef.current?.click()}
                className={cn(
                  "relative group flex flex-col items-center justify-center min-h-[220px] rounded-2xl border-2 border-dashed border-border/60 bg-muted/20 hover:bg-muted/30 transition-all cursor-pointer overflow-hidden p-4",
                  secretFiles.length > 0 && "border-indigo-500/50 bg-indigo-500/5"
                )}
              >
                <input
                  ref={secretInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => handleSecretSelect(e.target.files)}
                />

                {secretFiles.length > 0 ? (
                  <div className="w-full space-y-2">
                    <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                      {secretFiles.map((file, idx) => (
                        <div
                          key={idx}
                          className="flex items-center justify-between rounded-lg bg-card/80 border border-border/40 px-3 py-1.5 text-xs"
                        >
                          <div className="flex items-center gap-2 truncate">
                            <Archive className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
                            <span className="truncate text-foreground font-medium">
                              {file.name}
                            </span>
                          </div>
                          <span className="text-muted-foreground shrink-0 pl-2">
                            {formatBytes(file.size)}
                          </span>
                        </div>
                      ))}
                    </div>
                    <p className="text-center text-xs text-muted-foreground group-hover:text-foreground transition-colors pt-1">
                      点击重新选择隐藏文件
                    </p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-center">
                    <div className="h-12 w-12 rounded-2xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center group-hover:scale-110 transition-transform">
                      <FolderArchive className="h-6 w-6" />
                    </div>
                    <div className="text-sm font-medium text-foreground">
                      点击或拖拽上传需要伪装隐藏的文件
                    </div>
                    <div className="text-xs text-muted-foreground">
                      支持任意文件、文档、视频或现成的 ZIP / RAR / 7Z 压缩包
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* 操作按钮栏 */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 rounded-2xl border border-border/40 bg-card/60 p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Info className="h-4 w-4 text-sky-500 shrink-0" />
              <span>
                生成后的图片文件具备双重特性：双击它就是正常图片；将后缀改为 <b>.zip</b> 即可解压出隐藏文件！
              </span>
            </div>

            <Button
              onClick={handleCreateDisguisedImage}
              disabled={!coverFile || secretFiles.length === 0 || packLoading}
              className="w-full sm:w-auto px-8 bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-600 hover:to-indigo-700 text-white shadow-md shadow-sky-500/20"
            >
              {packLoading ? (
                <>
                  <RotateCw className="mr-2 h-4 w-4 animate-spin" />
                  正在封包合成...
                </>
              ) : (
                <>
                  <Sparkles className="mr-2 h-4 w-4" />
                  一键生成伪装图片
                </>
              )}
            </Button>
          </div>

          {/* 生成结果展示卡片 */}
          {packedResultUrl && (
            <div className="rounded-2xl border border-sky-500/30 bg-sky-500/5 p-6 backdrop-blur-md animate-in fade-in-50 duration-300">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-6">
                <div className="flex items-center gap-4">
                  <div className="relative h-24 w-24 rounded-xl overflow-hidden border border-border/60 shadow-sm shrink-0 bg-background/80">
                    <img
                      src={packedResultUrl}
                      alt="Disguised Result"
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute top-1 left-1 rounded bg-black/60 px-1 py-0.5 text-[9px] text-white">
                      外表图片
                    </div>
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                      <span className="font-semibold text-foreground">
                        伪装图种已成功生成！
                      </span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      文件名: <span className="font-mono text-foreground">{packedResultName}</span>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      总容量: <span className="font-mono text-foreground">{formatBytes(packedResultSize)}</span> (封面 + 隐藏文件)
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 w-full sm:w-auto">
                  <a
                    href={packedResultUrl}
                    download={packedResultName}
                    className="w-full sm:w-auto"
                  >
                    <Button className="w-full sm:w-auto bg-sky-500 hover:bg-sky-600 text-white shadow-sm">
                      <Download className="mr-2 h-4 w-4" />
                      立即下载伪装图片
                    </Button>
                  </a>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ================= TAB 2: 提取图种 ================= */}
      {activeTab === "unpack" && (
        <div className="space-y-6">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-semibold text-foreground flex items-center gap-2">
                <Unlock className="h-4 w-4 text-amber-500" />
                选择需要提取的图种/伪装图片
              </label>
              {unpackFile && (
                <span className="text-xs text-muted-foreground">
                  {unpackFile.name} ({formatBytes(unpackFile.size)})
                </span>
              )}
            </div>

            <div
              onClick={() => unpackInputRef.current?.click()}
              className={cn(
                "relative group flex flex-col items-center justify-center min-h-[220px] rounded-2xl border-2 border-dashed border-border/60 bg-muted/20 hover:bg-muted/30 transition-all cursor-pointer overflow-hidden p-4",
                unpackFile && "border-amber-500/50 bg-amber-500/5"
              )}
            >
              <input
                ref={unpackInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => handleUnpackSelect(e.target.files)}
              />

              {unpackPreviewUrl ? (
                <div className="relative w-full h-full flex flex-col items-center justify-center gap-2">
                  <img
                    src={unpackPreviewUrl}
                    alt="Unpack Preview"
                    className="max-h-40 rounded-lg object-contain shadow-md border border-border/40"
                  />
                  <span className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">
                    点击更换需解析的图片
                  </span>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 text-center">
                  <div className="h-12 w-12 rounded-2xl bg-amber-500/10 text-amber-500 flex items-center justify-center group-hover:scale-110 transition-transform">
                    <FileImage className="h-6 w-6" />
                  </div>
                  <div className="text-sm font-medium text-foreground">
                    点击或拖拽上传伪装图片
                  </div>
                  <div className="text-xs text-muted-foreground">
                    自动扫描并深度探测图片尾部藏匿的 ZIP / RAR / 7-Zip 数据
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 解析按钮 */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4 rounded-2xl border border-border/40 bg-card/60 p-4">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Info className="h-4 w-4 text-amber-500 shrink-0" />
              <span>
                系统将深度扫描图片二进制流，智能定位压缩文件头，无损提取出藏匿其中的原始文件
              </span>
            </div>

            <Button
              onClick={handleExtractHiddenData}
              disabled={!unpackFile || unpackLoading}
              className="w-full sm:w-auto px-8 bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white shadow-md shadow-amber-500/20"
            >
              {unpackLoading ? (
                <>
                  <RotateCw className="mr-2 h-4 w-4 animate-spin" />
                  正在扫描提取...
                </>
              ) : (
                <>
                  <Unlock className="mr-2 h-4 w-4" />
                  一键解密提取隐藏文件
                </>
              )}
            </Button>
          </div>

          {/* 提取结果卡片 */}
          {detectedType && extractedArchiveBlob && (
            <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-6 backdrop-blur-md animate-in fade-in-50 duration-300 space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-4 border-b border-border/40">
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                    <span className="font-semibold text-foreground">
                      检测并解密出隐藏数据包：{detectedType}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    隐藏内容总大小: <span className="font-mono text-foreground">{formatBytes(extractedArchiveBlob.size)}</span>
                  </div>
                </div>

                <a
                  href={extractedArchiveUrl ?? "#"}
                  download={extractedArchiveName}
                >
                  <Button className="bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm">
                    <Download className="mr-2 h-4 w-4" />
                    下载完整解密包 ({extractedArchiveName})
                  </Button>
                </a>
              </div>

              {/* 如果解析出具体文件列表 */}
              {extractedFiles.length > 0 && (
                <div className="space-y-2">
                  <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    <FileText className="h-4 w-4 text-emerald-500" />
                    压缩包内包含的文件明细 ({extractedFiles.length} 个)：
                  </div>
                  <div className="max-h-48 overflow-y-auto space-y-1 rounded-xl bg-card/60 p-2 border border-border/40">
                    {extractedFiles.map((file, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between rounded-lg bg-background/60 px-3 py-2 text-xs hover:bg-background/80 transition-colors"
                      >
                        <div className="flex items-center gap-2 truncate">
                          <Archive className="h-3.5 w-3.5 text-sky-500 shrink-0" />
                          <span className="font-medium text-foreground truncate">
                            {file.name}
                          </span>
                        </div>
                        <div className="flex items-center gap-3 shrink-0">
                          <span className="text-muted-foreground font-mono">
                            {formatBytes(file.size)}
                          </span>
                          <button
                            onClick={() => handleDownloadSingleExtracted(file.name)}
                            className="text-sky-500 hover:text-sky-600 font-medium hover:underline text-[11px]"
                          >
                            单独提取
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 底部使用小科普卡片 */}
      <div className="rounded-2xl border border-border/30 bg-card/40 p-5 space-y-3">
        <h3 className="text-xs font-semibold text-foreground flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-sky-500" />
          图种技术原理与使用技巧
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-muted-foreground">
          <div className="space-y-1">
            <span className="font-semibold text-foreground">1. 为什么它是正常的图片？</span>
            <p>
              JPG 图片解码器在读到 <code>FF D9</code> 标识时即认为图像数据结束，后续字节被直接忽略，因此无论是微信、QQ 还是浏览器预览都完全正常。
            </p>
          </div>
          <div className="space-y-1">
            <span className="font-semibold text-foreground">2. 如何在电脑上手动解压？</span>
            <p>
              除了使用本工具的“还原提取”功能外，你也可以直接将生成的图片文件后缀名从 <code>.jpg</code> 改为 <code>.zip</code>，然后用 WinRAR 或 7-Zip 直接打开。
            </p>
          </div>
          <div className="space-y-1">
            <span className="font-semibold text-foreground">3. 网络传输注意事项</span>
            <p>
              在社交平台（如微信、微博）发送图种时，请勾选<b>“发送原图”</b>或打包发送，避免平台二次压缩裁剪破坏尾部隐藏数据。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
