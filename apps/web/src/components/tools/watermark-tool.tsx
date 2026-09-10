"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion } from "framer-motion";
import {
  Upload, Download, RefreshCw, CheckCircle2, XCircle,
  Loader2, Move, Droplet, Eye, RotateCw, FileText, FolderOpen
} from "lucide-react";
import { Button, Input, Select, Label } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { Confetti } from "@/components/ui/confetti";
import { cn } from "@/lib/utils";

interface WatermarkToolProps {
  toolId: string; // "image-watermark" | "pdf-watermark"
}

interface JobState {
  id: string;
  status: "pending" | "processing" | "completed" | "failed";
  progress: number;
  message: string;
  resultFilename?: string;
  error?: string;
}

const PRESET_POSITIONS: Record<string, { x: number; y: number; label: string }> = {
  "center": { x: 50, y: 50, label: "居中" },
  "top-left": { x: 15, y: 15, label: "左上角" },
  "top-center": { x: 50, y: 15, label: "顶部居中" },
  "top-right": { x: 85, y: 15, label: "右上角" },
  "bottom-left": { x: 15, y: 85, label: "左下角" },
  "bottom-center": { x: 50, y: 85, label: "底部居中" },
  "bottom-right": { x: 85, y: 85, label: "右下角" },
};

export function WatermarkTool({ toolId }: WatermarkToolProps) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [text, setText] = useState("FurinaKit");
  const [fontSize, setFontSize] = useState(36);
  const [opacity, setOpacity] = useState(50);
  const [color, setColor] = useState("#ffffff");
  const [angle, setAngle] = useState(0);
  const [positionKey, setPositionKey] = useState("center");
  const [posPercent, setPosPercent] = useState<{ x: number; y: number }>({ x: 50, y: 50 });
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  const [isDragging, setIsDragging] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [job, setJob] = useState<JobState | null>(null);

  const previewBoxRef = useRef<HTMLDivElement>(null);
  const imgContainerRef = useRef<HTMLDivElement>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const { toast } = useToast();
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);

  // 清理预览 Object URL
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, [previewUrl]);

  // 当选择预设位置时更新坐标
  const handlePresetChange = (val: string) => {
    setPositionKey(val);
    if (PRESET_POSITIONS[val]) {
      setPosPercent({ x: PRESET_POSITIONS[val].x, y: PRESET_POSITIONS[val].y });
    }
  };

  // 处理文件上传
  const handleFileChange = (selectedFile: File) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setFile(selectedFile);
    setJob(null);
    setNaturalSize({ width: 0, height: 0 });

    if (selectedFile.type.startsWith("image/")) {
      const url = URL.createObjectURL(selectedFile);
      setPreviewUrl(url);
      const img = new Image();
      img.onload = () => {
        setNaturalSize({ width: img.naturalWidth, height: img.naturalHeight });
      };
      img.src = url;
    } else {
      // PDF 文件或无直接预览，采用白底纸张衬底
      setPreviewUrl(null);
    }
  };

  // 鼠标拖拽水印位置
  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const target = imgContainerRef.current || previewBoxRef.current;
      if (!target) return;
      const rect = target.getBoundingClientRect();
      const rawX = ((e.clientX - rect.left) / rect.width) * 100;
      const rawY = ((e.clientY - rect.top) / rect.height) * 100;

      const clampedX = Math.max(2, Math.min(98, Math.round(rawX)));
      const clampedY = Math.max(2, Math.min(98, Math.round(rawY)));

      setPosPercent({ x: clampedX, y: clampedY });
      setPositionKey("custom");
    };

    const handleMouseUp = () => {
      setIsDragging(false);
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [isDragging]);

  // 开始执行加水印
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!file) {
      toast({ title: "请先上传文件", variant: "error" });
      return;
    }

    setSubmitting(true);
    setJob(null);

    try {
      // 计算真正的所见即所得字体尺寸：
      // 如果原图是 10240x4320，但在屏幕预览中只有 600px，用户看到的 36px 对应原图比例需要等比例放大，
      // 保证在原图输出结果上所占面积比例与预览画面 100% 一致！
      let actualFontSize = fontSize;
      if (imgRef.current && naturalSize.width > 0) {
        const renderedWidth = imgRef.current.getBoundingClientRect().width;
        if (renderedWidth > 0) {
          const scale = naturalSize.width / renderedWidth;
          actualFontSize = Math.max(12, Math.round(fontSize * scale));
        }
      }

      const formData = new FormData();
      formData.append("file", file);
      formData.append("text", text);
      formData.append("position", positionKey);
      formData.append("x_percent", String(posPercent.x));
      formData.append("y_percent", String(posPercent.y));
      formData.append("x", String(posPercent.x));
      formData.append("y", String(posPercent.y));
      formData.append("font_size", String(actualFontSize));
      formData.append("actual_font_size", String(actualFontSize));
      formData.append("fontSize", String(actualFontSize));
      formData.append("size", String(actualFontSize));
      formData.append("opacity", String(toolId === "pdf-watermark" ? opacity / 100 : opacity));
      formData.append("color", color);
      formData.append("rotate", String(angle));
      formData.append("angle", String(angle));
      formData.append("rotation", String(angle));

      const res = await fetch(`/api/tools/${toolId}`, {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "创建任务失败");

      setJob({
        id: data.job.id,
        status: "pending",
        progress: 10,
        message: "正在添加水印...",
      });

      pollJobStatus(data.job.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "提交失败";
      toast({ title: "处理失败", description: msg, variant: "error" });
    } finally {
      setSubmitting(false);
    }
  };

  const pollJobStatus = async (jobId: string) => {
    const poll = async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}`);
        const data = await res.json();
        if (res.ok && data.job) {
          setJob({
            id: data.job.id,
            status: data.job.status,
            progress: data.job.progress || 0,
            message: data.job.message || "处理中...",
            resultFilename: data.job.resultFilename,
            error: data.job.error,
          });

          if (data.job.status === "completed") {
            toast({ title: "水印添加完成", variant: "success" });
            return;
          }
          if (data.job.status === "failed") {
            toast({ title: "处理失败", description: data.job.error, variant: "error" });
            return;
          }
        }
        pollTimerRef.current = setTimeout(poll, 1200);
      } catch {
        pollTimerRef.current = setTimeout(poll, 2000);
      }
    };
    poll();
  };

  const [downloading, setDownloading] = useState(false);

  const handleDownload = async () => {
    if (!job?.id || !job.resultFilename) return;
    try {
      setDownloading(true);
      const res = await fetch(`/api/jobs/${job.id}/download?download=1`);
      if (!res.ok) throw new Error("下载失败");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = job.resultFilename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
      toast({ title: "已保存到本地", description: job.resultFilename, variant: "success" });
    } catch (err) {
      toast({
        title: "下载失败",
        description: err instanceof Error ? err.message : "请重试",
        variant: "error",
      });
    } finally {
      setDownloading(false);
    }
  };

  const handleOpenFolder = async () => {
    try {
      // 优先尝试 Electron 原生 openPath
      const win = typeof window !== "undefined" ? (window as unknown as { furinakit?: { openPath?: (p: string) => Promise<{ success?: boolean }> } }) : null;
      if (win?.furinakit?.openPath) {
        // 先获取当前输出目录
        const dirRes = await fetch("/api/output-dir");
        const dirData = await dirRes.json();
        if (dirData?.outputDir) {
          const res = await win.furinakit.openPath(dirData.outputDir);
          if (res?.success) {
            toast({ title: "已在资源管理器中打开输出目录", variant: "success" });
            return;
          }
        }
      }

      // 服务端兜底触发打开文件夹
      const res = await fetch("/api/output-dir", { method: "POST" });
      const data = await res.json();
      if (data?.outputDir) {
        toast({ title: "已打开保存目录", description: data.outputDir, variant: "success" });
      } else {
        toast({ title: "未能打开目录", description: "请前往设置中查看输出目录位置", variant: "error" });
      }
    } catch (err) {
      toast({ title: "打开目录失败", description: String(err), variant: "error" });
    }
  };

  const isPdf = toolId === "pdf-watermark";

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* 左侧：参数控制面板 */}
        <div className="lg:col-span-5 space-y-4 rounded-2xl border border-border bg-card p-5 shadow-xs">
          {/* 上传文件 */}
          <div className="space-y-2">
            <Label>{isPdf ? "选择 PDF 文件" : "选择图片文件"}</Label>
            <label className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-secondary/30 p-4 hover:bg-secondary/60 hover:border-primary/40 cursor-pointer transition-all">
              <Upload className="h-5 w-5 text-muted-foreground mb-1" />
              <span className="text-xs font-medium text-foreground truncate max-w-[200px]">
                {file ? file.name : isPdf ? "点击选择 PDF 文件" : "点击选择图片文件"}
              </span>
              <span className="text-[10px] text-muted-foreground mt-0.5">
                {file ? `${(file.size / 1024).toFixed(1)} KB` : "支持直接替换文件"}
              </span>
              <input
                type="file"
                accept={isPdf ? ".pdf" : "image/*"}
                onChange={(e) => e.target.files?.[0] && handleFileChange(e.target.files[0])}
                className="hidden"
              />
            </label>
          </div>

          {/* 水印文字 */}
          <div className="space-y-2">
            <Label>水印文字</Label>
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="输入水印文本内容..."
              className="h-10 text-sm"
            />
          </div>

          {/* 水印预设位置联动 */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>水印位置</Label>
              <span className="text-[11px] text-primary flex items-center gap-1 font-medium">
                <Move className="h-3 w-3" /> 可在右侧预览图中直接拖动
              </span>
            </div>
            <Select value={positionKey} onChange={(e) => handlePresetChange(e.target.value)}>
              <option value="center">居中 (Center)</option>
              <option value="top-left">左上角 (Top Left)</option>
              <option value="top-center">顶部居中 (Top Center)</option>
              <option value="top-right">右上角 (Top Right)</option>
              <option value="bottom-left">左下角 (Bottom Left)</option>
              <option value="bottom-center">底部居中 (Bottom Center)</option>
              <option value="bottom-right">右下角 (Bottom Right)</option>
              {positionKey === "custom" && <option value="custom">自定义位置 (拖拽设置中)</option>}
            </Select>
          </div>

          {/* 字体大小 & 透明度 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>字体大小</Label>
                <span className="text-xs font-mono text-muted-foreground">{fontSize}px</span>
              </div>
              <input
                type="range"
                min={12}
                max={96}
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                className="w-full h-2 rounded-lg bg-secondary accent-primary cursor-pointer"
              />
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>透明度</Label>
                <span className="text-xs font-mono text-muted-foreground">{opacity}%</span>
              </div>
              <input
                type="range"
                min={5}
                max={100}
                value={opacity}
                onChange={(e) => setOpacity(Number(e.target.value))}
                className="w-full h-2 rounded-lg bg-secondary accent-primary cursor-pointer"
              />
            </div>
          </div>

          {/* 文字颜色 & 旋转角度 */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>文字颜色</Label>
              <div className="flex items-center gap-2">
                <label className="relative flex h-9 w-10 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-border bg-card p-1 shadow-xs hover:border-primary/50 transition-all overflow-hidden">
                  <span
                    className="h-full w-full rounded-md border border-black/10 shadow-xs"
                    style={{ backgroundColor: color }}
                  />
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                  />
                </label>
                <Input
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="h-9 text-xs font-mono flex-1 uppercase"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>旋转角度</Label>
                <span className="text-xs font-mono text-muted-foreground">{angle}°</span>
              </div>
              <input
                type="range"
                min={-90}
                max={90}
                value={angle}
                onChange={(e) => setAngle(Number(e.target.value))}
                className="w-full h-2 rounded-lg bg-secondary accent-primary cursor-pointer"
              />
            </div>
          </div>

          <Button
            type="button"
            onClick={handleSubmit}
            disabled={!file || submitting}
            className="w-full h-11 font-medium mt-2 gap-2"
          >
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Droplet className="h-4 w-4" />}
            <span>{submitting ? "正在生成..." : "开始添加水印"}</span>
          </Button>
        </div>

        {/* 右侧：所见即所得的交互式画布视口 */}
        <div className="lg:col-span-7 space-y-3">
          <div className="flex items-center justify-between px-1">
            <span className="text-sm font-semibold text-foreground flex items-center gap-1.5">
              <Eye className="h-4 w-4 text-primary" />
              实时预览画布（按住水印文字可任意拖拽）
            </span>
            <span className="text-xs text-muted-foreground font-mono">
              坐标: X:{posPercent.x}% Y:{posPercent.y}% · 角度:{angle}°
            </span>
          </div>

          {/* 可视化拖拽画布容器 */}
          <div
            ref={previewBoxRef}
            className="relative w-full aspect-[4/3] rounded-2xl border-2 border-border bg-card/60 overflow-hidden shadow-inner flex items-center justify-center select-none"
            style={{
              backgroundImage:
                "radial-gradient(circle, hsl(var(--border) / 0.5) 1px, transparent 1px)",
              backgroundSize: "20px 20px",
            }}
          >
            {/* 底图与贴合水印 */}
            {previewUrl ? (
              <div
                ref={imgContainerRef}
                className="relative inline-flex max-h-full max-w-full items-center justify-center select-none"
              >
                <img
                  ref={imgRef}
                  src={previewUrl}
                  alt="底图预览"
                  className="max-h-full max-w-full object-contain pointer-events-none rounded"
                />
                {/* 贴合在底图之上的可拖拽水印浮层 */}
                {text && (
                  <div
                    onMouseDown={handleMouseDown}
                    style={{
                      position: "absolute",
                      left: `${posPercent.x}%`,
                      top: `${posPercent.y}%`,
                      transform: `translate(-50%, -50%) rotate(${angle}deg)`,
                      color: color,
                      opacity: opacity / 100,
                      fontSize: `${fontSize}px`,
                      cursor: isDragging ? "grabbing" : "grab",
                      textShadow:
                        color.toLowerCase() === "#ffffff"
                          ? "0 1px 3px rgba(0,0,0,0.6)"
                          : "0 1px 3px rgba(255,255,255,0.6)",
                    }}
                    className={cn(
                      "font-bold whitespace-nowrap px-3 py-1.5 rounded-lg transition-shadow border border-dashed",
                      isDragging
                        ? "border-primary ring-2 ring-primary/40 shadow-lg scale-105"
                        : "border-transparent hover:border-primary/50 hover:bg-black/10"
                    )}
                  >
                    {text}
                  </div>
                )}
              </div>
            ) : isPdf ? (
              <div
                ref={imgContainerRef}
                className="relative w-[68%] aspect-[1/1.414] rounded-lg border border-border bg-card shadow-md flex flex-col items-center justify-center text-center p-6 select-none"
              >
                <FileText className="h-14 w-14 text-muted-foreground/40 mb-3 pointer-events-none" />
                <p className="text-sm font-semibold text-foreground pointer-events-none">
                  {file ? file.name : "PDF 文档预览衬底"}
                </p>
                <p className="text-xs text-muted-foreground mt-1 pointer-events-none">
                  文字水印将渲染在每一页的相同相对坐标位置
                </p>
                {/* PDF 衬底之上的水印浮层 */}
                {text && (
                  <div
                    onMouseDown={handleMouseDown}
                    style={{
                      position: "absolute",
                      left: `${posPercent.x}%`,
                      top: `${posPercent.y}%`,
                      transform: `translate(-50%, -50%) rotate(${angle}deg)`,
                      color: color,
                      opacity: opacity / 100,
                      fontSize: `${fontSize}px`,
                      cursor: isDragging ? "grabbing" : "grab",
                      textShadow:
                        color.toLowerCase() === "#ffffff"
                          ? "0 1px 3px rgba(0,0,0,0.6)"
                          : "0 1px 3px rgba(255,255,255,0.6)",
                    }}
                    className={cn(
                      "font-bold whitespace-nowrap px-3 py-1.5 rounded-lg transition-shadow border border-dashed",
                      isDragging
                        ? "border-primary ring-2 ring-primary/40 shadow-lg scale-105"
                        : "border-transparent hover:border-primary/50 hover:bg-black/10"
                    )}
                  >
                    {text}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center text-muted-foreground pointer-events-none">
                <Upload className="h-10 w-10 mb-2 opacity-30" />
                <p className="text-xs">左侧上传图片后，此处显示真实底图</p>
              </div>
            )}

            {/* 辅助对齐标线提示 */}
            <div className="absolute bottom-2 right-2 text-[10px] text-muted-foreground/60 bg-card/80 px-2 py-0.5 rounded pointer-events-none">
              所见即所得像素级同步
            </div>
          </div>
        </div>
      </div>

      {/* 结果卡片 */}
      {job && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className={cn(
            "space-y-4 rounded-2xl border p-5 shadow-sm",
            job.status === "completed"
              ? "border-success/30 bg-success/5"
              : job.status === "failed"
              ? "border-destructive/30 bg-destructive/5"
              : "border-border bg-card"
          )}
        >
          {job.status === "completed" && <Confetti />}

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              {job.status === "completed" ? (
                <CheckCircle2 className="h-5 w-5 text-success" />
              ) : job.status === "failed" ? (
                <XCircle className="h-5 w-5 text-destructive" />
              ) : (
                <Loader2 className="h-5 w-5 animate-spin text-primary" />
              )}
              <span className="font-semibold text-sm text-foreground">
                {job.status === "completed"
                  ? "水印添加完成"
                  : job.status === "failed"
                  ? "处理失败"
                  : "正在处理中..."}
              </span>
            </div>
            <span className="font-mono text-xs text-muted-foreground">{job.progress}%</span>
          </div>

          {job.status !== "completed" && job.status !== "failed" && (
            <div className="h-2 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${job.progress}%` }}
              />
            </div>
          )}

          <p className="text-xs text-muted-foreground">{job.message}</p>

          {job.error && <p className="text-xs text-destructive">{job.error}</p>}

          {job.status === "completed" && job.resultFilename && (
            <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border">
              <span className="text-xs font-medium text-foreground truncate max-w-[240px]">
                生成文件：{job.resultFilename}
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleOpenFolder}
                  className="gap-1.5 text-xs h-9"
                  title="在资源管理器中打开保存目录"
                >
                  <FolderOpen className="h-4 w-4" />
                  <span>打开保存文件夹</span>
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleDownload}
                  disabled={downloading}
                  className="gap-1.5 text-xs h-9 px-4"
                >
                  {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  <span>{downloading ? "保存中..." : "保存到本地"}</span>
                </Button>
              </div>
            </div>
          )}
        </motion.div>
      )}
    </div>
  );
}
