"use client";

import React, { Component, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { notFound, useRouter } from "next/navigation";
import Link from "next/link";
import { getToolById, CATEGORY_LABELS } from "@furinakit/shared";
import type { Job, OmniTool } from "@furinakit/shared";
import { Download, Loader2, Check, Copy, Play, ArrowLeft, AlertCircle } from "lucide-react";
import { Alert, Button, Input, Label, PasteButton, Select, Textarea } from "@/components/ui/primitives";
import { FileDropzone } from "@/components/tools/file-dropzone";
import { JobProgress } from "@/components/tools/job-progress";
import { Confetti } from "@/components/ui/confetti";
// 原始专用客户端组件
import { JsonFormatterTool } from "@/components/tools/json-formatter-tool";
import { PdfToImagesTool } from "@/components/tools/pdf-to-images-tool";
import { BgRemoveTool } from "@/components/tools/bg-remove-tool";
import { UrlCodecTool } from "@/components/tools/url-codec-tool";
import { Base64Tool } from "@/components/tools/base64-tool";
import { ColorConverterTool } from "@/components/tools/color-converter-tool";
import { JwtDecoderTool } from "@/components/tools/jwt-decoder-tool";
import { RegexTesterTool } from "@/components/tools/regex-tester-tool";
import { MarkdownPreviewTool } from "@/components/tools/markdown-preview-tool";
import { ImageCropTool } from "@/components/tools/image-crop-tool";
import { VideoDownloadTool } from "@/components/tools/video-download-tool";
import { MagnetDownloadTool } from "@/components/tools/magnet-download-tool";
import { ImagesToPdfTool } from "@/components/tools/images-to-pdf-tool";
import { WatermarkTool } from "@/components/tools/watermark-tool";
import { ImageCompressTool } from "@/components/tools/image-compress-tool";
import { ImageMergeTool } from "@/components/tools/image-merge-tool";
import { ImageResizeTool } from "@/components/tools/image-resize-tool";
import { ImageSplitTool } from "@/components/tools/image-split-tool";
// 大量纯前端小工具
import {
  RmbUppercaseTool, LoanCalculatorTool, BmiCalculatorTool, BaseConverterTool,
  ByteConverterTool, WordCountTool, TextDedupTool, MorseCodeTool, CaesarCipherTool,
  UuidGeneratorTool, TimestampConverterTool, PasswordGeneratorTool, RandomNumberTool,
  DateCalculatorTool, NumberSumTool, LengthConverterTool,
  TimeConverterTool, AreaConverterTool, WeightConverterTool, TextReplaceTool,
  FullwidthHalfwidthTool, AesEncryptTool, RomanNumeralTool, CrontabGeneratorTool,
  IncomeTaxCalculatorTool, TaxCalculatorTool, CreditCardCalculatorTool,
  EnglishAmountUppercaseTool, NumberEnglishTool, ExchangeRateTool, GeometryCalculatorTool,
  VolumeConverterTool, LunarCalendarTool, TextCompareTool,
  FancyTextTool, PinyinConverterTool, ShaHashTool, UnicodeConverterTool, GuidGeneratorTool,
  JsonToTsTool, UserAgentAnalyzerTool, QrDecoderTool, PeriodicTableTool, ImageBase64Tool,
  CrcChecksumTool, FileHexTool, StopwatchTool, SpecialSymbolsTool,
  UnitConverterTool, BatchRenameTool, MindMapTool,
  JsFormatterTool, HtmlFormatterTool, CaseConverterTool, DateConverterTool,
  IpConverterTool, HttpStatusTool, ScatterChartTool, PieChartTool, LineChartTool, BarChartTool,
} from "@/components/tools/simple-tools";
import {
  ChineseConverterTool, SpeedTestTool, ColorPaletteTool, MediaTrackerTool,
} from "@/components/tools/extra-tools";
import { ArchprTool } from "@/components/tools/archpr-tool";
import { AdvancedCalculatorTool } from "@/components/tools/calculator-tool";
import { SignatureDesignerTool } from "@/components/tools/signature-tool";
import { useRecentTools, loadToolSettings, saveToolSettings } from "@/lib/use-tool-prefs";
import { consumePendingFiles } from "@/lib/file-handoff";
import { useToast } from "@/components/ui/toast";
import { CATEGORY_COLOR } from "@/components/tools/tool-card";
import { cn, formatBytes } from "@/lib/utils";

type ToolRunnerProps = { toolId: string };

/** 纯前端工具：id → 自带 UI 的组件 */
const CLIENT_TOOL_COMPONENTS: Record<string, React.ComponentType> = {
  "json-formatter": JsonFormatterTool,
  "pdf-to-images": PdfToImagesTool,
  "bg-remove": BgRemoveTool,
  "image-crop": ImageCropTool,
  "image-resize": ImageResizeTool,
  "image-split": ImageSplitTool,
  "url-encode": UrlCodecTool,
  base64: Base64Tool,
  "color-convert": ColorConverterTool,
  "jwt-decode": JwtDecoderTool,
  "regex-tester": RegexTesterTool,
  "markdown-preview": MarkdownPreviewTool,
  // simple-tools
  "rmb-uppercase": RmbUppercaseTool, "loan-calculator": LoanCalculatorTool,
  "bmi-calculator": BmiCalculatorTool, "base-converter": BaseConverterTool,
  "byte-converter": ByteConverterTool, "word-count": WordCountTool,
  "text-dedup": TextDedupTool, "morse-code": MorseCodeTool,
  "caesar-cipher": CaesarCipherTool, "uuid-generator": UuidGeneratorTool,
  "timestamp-converter": TimestampConverterTool, "password-generator": PasswordGeneratorTool,
  "random-number": RandomNumberTool, "simple-calculator": AdvancedCalculatorTool,
  "date-calculator": DateCalculatorTool, "number-sum": NumberSumTool,
  "length-converter": LengthConverterTool, "time-converter": TimeConverterTool,
  "area-converter": AreaConverterTool, "weight-converter": WeightConverterTool,
  "text-replace": TextReplaceTool, "fullwidth-halfwidth": FullwidthHalfwidthTool,
  "aes-encrypt": AesEncryptTool, "roman-numeral": RomanNumeralTool,
  "crontab-generator": CrontabGeneratorTool, "income-tax-calculator": IncomeTaxCalculatorTool,
  "tax-calculator": TaxCalculatorTool, "credit-card-calculator": CreditCardCalculatorTool,
  "english-amount-uppercase": EnglishAmountUppercaseTool, "number-english": NumberEnglishTool,
  "exchange-rate": ExchangeRateTool, "geometry-calculator": GeometryCalculatorTool,
  "volume-converter": VolumeConverterTool, "lunar-calendar": LunarCalendarTool,
  "text-compare": TextCompareTool,
  "fancy-text": FancyTextTool, "pinyin-converter": PinyinConverterTool,
  "sha-hash": ShaHashTool, "unicode-converter": UnicodeConverterTool,
  "guid-generator": GuidGeneratorTool, "json-to-ts": JsonToTsTool,
  "user-agent-analyzer": UserAgentAnalyzerTool, "qr-decoder": QrDecoderTool,
  "periodic-table": PeriodicTableTool, "image-base64": ImageBase64Tool,
  "crc-checksum": CrcChecksumTool, "file-hex": FileHexTool, "stopwatch": StopwatchTool,
  "special-symbols": SpecialSymbolsTool,
  "unit-converter": UnitConverterTool, "batch-rename": BatchRenameTool,
  "mind-map": MindMapTool,
  // 新增开发/文本/网络工具
  "js-formatter": JsFormatterTool, "html-formatter": HtmlFormatterTool,
  "case-converter": CaseConverterTool, "date-converter": DateConverterTool,
  "ip-converter": IpConverterTool, "http-status": HttpStatusTool,
  "scatter-chart": ScatterChartTool, "pie-chart": PieChartTool,
  "line-chart": LineChartTool, "bar-chart": BarChartTool,
  // extra-tools
  "chinese-converter": ChineseConverterTool, "speed-test": SpeedTestTool,
  "color-palette": ColorPaletteTool, "media-tracker": MediaTrackerTool,
  "archpr": ArchprTool,
  "signature-designer": SignatureDesignerTool,
};

type SyncResultState = {
  kind: "file" | "text";
  filename: string;
  mimeType: string;
  url?: string;
  text?: string;
  size: number;
  beforeUrl?: string;
  beforeSize?: number;
};

async function fetchJob(id: string): Promise<Job> {
  const response = await fetch(`/api/jobs/${id}`, { cache: "no-store" });
  if (!response.ok) throw new Error("获取任务失败");
  const data = await response.json();
  return data.job;
}

/** 根据工具推断文件选择器接受的类型 */
function acceptFor(tool: OmniTool): Record<string, string[]> | undefined {
  // 图片转PDF工具虽然在pdf分类，但需要接受图片文件
  if (tool.id === "images-to-pdf" || tool.id === "image-to-pdf") {
    return { "image/*": [".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".tiff", ".tif", ".bmp", ".svg"] };
  }
  // Office文档转PDF工具虽然在pdf分类，但需要接受对应Office文档
  if (tool.id === "word-to-pdf") {
    return { "application/msword": [".doc"], "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"] };
  }
  if (tool.id === "excel-to-pdf") {
    return { "application/vnd.ms-excel": [".xls"], "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] };
  }
  if (tool.id === "ppt-to-pdf") {
    return { "application/vnd.ms-powerpoint": [".ppt"], "application/vnd.openxmlformats-officedocument.presentationml.presentation": [".pptx"] };
  }
  if (tool.category === "pdf") return { "application/pdf": [".pdf"] };
  if (tool.category === "image") {
    return { "image/*": [".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".tiff", ".tif", ".bmp", ".svg"] };
  }
  if (tool.category === "audio") return { "audio/*": [".mp3", ".wav", ".flac", ".aac", ".m4a", ".ogg", ".opus"], "video/*": [".mp4", ".mov", ".mkv", ".avi", ".webm"] };
  if (tool.category === "download") return { "video/*": [".mp4", ".mov", ".mkv", ".avi", ".webm", ".flv"], "audio/*": [] };
  return undefined;
}

export function ToolRunner({ toolId }: ToolRunnerProps) {
  const tool = getToolById(toolId);
  if (!tool) notFound();

  // 通用视频下载：内置网页全屏渲染（给网站最大空间）
  if (toolId === "video-download") {
    return (
      <div className="flex flex-col p-4" style={{ height: "calc(100vh - 60px)" }}>
        <VideoDownloadTool toolId={toolId} />
      </div>
    );
  }

  // B站/推特视频提取：使用统一的 ToolShell 包装（带面包屑、标题卡片与居中舒适宽度）
  if (toolId === "bilibili-download" || toolId === "twitter-download") {
    return (
      <ToolShell tool={tool}>
        <VideoDownloadTool toolId={toolId} />
      </ToolShell>
    );
  }

  // 磁力种子下载：内置 aria2c 高速引擎与 Tracker 加速工作台
  if (toolId === "magnet-download") {
    return (
      <ToolShell tool={tool}>
        <MagnetDownloadTool />
      </ToolShell>
    );
  }

  // 图片转 PDF：图 3 风格工作台（横竖版/图像尺寸自适应、性能保护模式、队列管理）
  if (toolId === "images-to-pdf" || toolId === "image-to-pdf") {
    return (
      <ToolShell tool={tool}>
        <ImagesToPdfTool />
      </ToolShell>
    );
  }

  // 图片与 PDF 加水印：所见即所得的实时拖拽预览工作台
  if (toolId === "image-watermark" || toolId === "pdf-watermark") {
    return (
      <ToolShell tool={tool}>
        <WatermarkTool toolId={toolId} />
      </ToolShell>
    );
  }

  // 图片压缩：画质对比、体积节省率与放大镜
  if (toolId === "image-compress") {
    return (
      <ToolShell tool={tool}>
        <ImageCompressTool />
      </ToolShell>
    );
  }

  // 多图拼接：纵向长图、横向拼接与宫格排版实时画布
  if (toolId === "image-merge") {
    return (
      <ToolShell tool={tool}>
        <ImageMergeTool />
      </ToolShell>
    );
  }

  // 图片改尺寸：按比例缩放/固定尺寸/长短边/跳过小图 (docsmall 风格)
  if (toolId === "image-resize") {
    return (
      <ToolShell tool={tool}>
        <ImageResizeTool />
      </ToolShell>
    );
  }

  // 图片分割：九宫格/四宫格/网格切图与实时预览 (docsmall 风格)
  if (toolId === "image-split") {
    return (
      <ToolShell tool={tool}>
        <ImageSplitTool />
      </ToolShell>
    );
  }

  const ClientComponent = tool.clientSide ? CLIENT_TOOL_COMPONENTS[tool.id] : undefined;
  if (ClientComponent) {
    return (
      <ToolShell tool={tool}>
        <ClientComponent />
      </ToolShell>
    );
  }

  return <GenericToolRunner tool={tool} />;
}

type Tool = NonNullable<ReturnType<typeof getToolById>>;

function GenericToolRunner({ tool }: { tool: Tool }) {
  const [files, setFiles] = useState<File[]>([]);
  const [multiFiles, setMultiFiles] = useState<File[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SyncResultState | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [jobConfetti, setJobConfetti] = useState(0);
  const lastUrl = useRef<string | null>(null);
  const lastBeforeUrl = useRef<string | null>(null);
  const { toast } = useToast();
  const prevJobStatus = useRef<string | null>(null);

  const defaults = useMemo(() => {
    return Object.fromEntries(
      tool.inputs
        .filter((input) => input.defaultValue !== undefined)
        .map((input) => [input.id, String(input.defaultValue)]),
    );
  }, [tool]);

  const persistIds = useMemo(
    () => new Set(tool.inputs.filter((i) => i.type === "select" || i.type === "number").map((i) => i.id)),
    [tool],
  );
  const settingsToolRef = useRef<string | null>(null);

  useEffect(() => {
    const saved = loadToolSettings(tool.id);
    const restored = Object.fromEntries(Object.entries(saved).filter(([key]) => persistIds.has(key)));
    setValues(restored);
    settingsToolRef.current = tool.id;
  }, [tool.id, persistIds]);

  useEffect(() => {
    if (settingsToolRef.current !== tool.id) return;
    const toSave = Object.fromEntries(Object.entries(values).filter(([key]) => persistIds.has(key)));
    saveToolSettings(tool.id, toSave);
  }, [values, persistIds, tool.id]);

  useEffect(() => {
    const handed = consumePendingFiles();
    if (handed.length === 0) return;
    const fileInput = tool.inputs.find((i) => i.type === "file");
    if (!fileInput) return;
    if (fileInput.multiple) setMultiFiles(handed);
    else setFiles(handed.slice(0, 1));
  }, [tool.id, tool.inputs]);

  useEffect(() => {
    return () => {
      if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);
      if (lastBeforeUrl.current) URL.revokeObjectURL(lastBeforeUrl.current);
    };
  }, []);

  const beforePreviewUrl = useMemo(() => {
    if (files[0] && files[0].type.startsWith("image/")) {
      return URL.createObjectURL(files[0]);
    }
    return undefined;
  }, [files]);

  const mergedValues = { ...defaults, ...values };

  const jobQuery = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => fetchJob(jobId!),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "completed" || status === "failed" ? false : 1500;
    },
  });

  useEffect(() => {
    const status = jobQuery.data?.status;
    if (!status || status === prevJobStatus.current) return;
    if (status === "completed" && prevJobStatus.current) {
      toast({ title: "处理完成", description: `「${tool.name}」已完成`, variant: "success" });
      setJobConfetti((n) => n + 1);
    } else if (status === "failed" && prevJobStatus.current) {
      toast({ title: "任务失败", description: jobQuery.data?.error ?? "本地服务返回了错误", variant: "error" });
    }
    prevJobStatus.current = status;
  }, [jobQuery.data?.status, jobQuery.data?.error, tool.name, toast]);

  const validate = (): string | null => {
    for (const input of tool.inputs) {
      if (input.type === "file") {
        const list = input.multiple ? multiFiles : files;
        if (list.length < 1) return `请先添加「${input.label}」`;
        continue;
      }
      if (input.required !== false && !mergedValues[input.id]?.trim()) {
        return `「${input.label}」不能为空`;
      }
    }
    return null;
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    setResult(null);
    setJobId(null);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    setLoading(true);
    const formData = new FormData();
    for (const input of tool.inputs) {
      if (input.type === "file") {
        if (input.multiple) multiFiles.forEach((f) => formData.append(input.id, f));
        else if (files[0]) formData.append(input.id, files[0]);
      } else {
        formData.append(input.id, mergedValues[input.id] ?? "");
      }
    }

    try {
      const response = await fetch(`/api/tools/${tool.id}`, { method: "POST", body: formData });
      const contentType = response.headers.get("content-type") || "";

      if (tool.mode === "async") {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "请求失败");
        if (data.job?.id) setJobId(data.job.id);
        else throw new Error("任务未创建");
        return;
      }

      if (!response.ok || contentType.includes("application/json")) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "处理失败");
      }

      const filename = decodeURIComponent(response.headers.get("x-result-filename") || "result");
      const kind = (response.headers.get("x-result-kind") as "file" | "text") || "file";
      const blob = await response.blob();

      if (lastUrl.current) URL.revokeObjectURL(lastUrl.current);

      if (kind === "text") {
        setResult({ kind: "text", filename, mimeType: contentType, text: await blob.text(), size: blob.size });
      } else {
        const url = URL.createObjectURL(blob);
        lastUrl.current = url;
        const inputImage = files[0];
        const showCompare =
          inputImage && inputImage.type.startsWith("image/") && contentType.startsWith("image/");
        if (lastBeforeUrl.current) URL.revokeObjectURL(lastBeforeUrl.current);
        const beforeUrl = showCompare ? URL.createObjectURL(inputImage) : undefined;
        lastBeforeUrl.current = beforeUrl ?? null;
        setResult({
          kind: "file", filename, mimeType: contentType, url, size: blob.size,
          beforeUrl, beforeSize: showCompare ? inputImage.size : undefined,
        });
      }
      toast({ title: "处理完成", description: `${tool.name} · ${formatBytes(blob.size)}`, variant: "success" });
    } catch (err) {
      const message = err instanceof Error ? err.message : "出现未知错误";
      setError(message);
      toast({ title: "处理失败", description: message, variant: "error" });
    } finally {
      setLoading(false);
    }
  };

  const copyText = async () => {
    if (!result?.text) return;
    await navigator.clipboard.writeText(result.text);
    setCopied(true);
    toast({ title: "已复制到剪贴板", variant: "success", duration: 1500 });
    setTimeout(() => setCopied(false), 1500);
  };

  const accept = acceptFor(tool);

  return (
    <ToolShell tool={tool}>
      {tool.disclaimer && <Alert>{tool.disclaimer}</Alert>}
      {tool.mode === "async" && (
        <Alert>该工具由本地服务处理，请确认左下角显示「服务运行中」；文件仅在本机处理，不会上传到外部。</Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl border border-border bg-card p-6">
        {tool.inputs.map((input) => {
          if (input.type === "file") {
            const list = input.multiple ? multiFiles : files;
            const setter = input.multiple ? setMultiFiles : setFiles;
            return (
              <Field key={input.id} label={input.label} help={input.help}>
                <FileDropzone files={list} onChange={setter} multiple={input.multiple} accept={input.accept ? undefined : accept} />
              </Field>
            );
          }
          if (input.type === "select") {
            return (
              <Field key={input.id} label={input.label} htmlFor={input.id} help={input.help}>
                <Select
                  id={input.id}
                  value={mergedValues[input.id] ?? ""}
                  onChange={(e) => setValues((p) => ({ ...p, [input.id]: e.target.value }))}
                >
                  <option value="" disabled>请选择…</option>
                  {(input.options ?? []).map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </Select>
              </Field>
            );
          }
          if (input.type === "number") {
            return (
              <Field key={input.id} label={input.label} htmlFor={input.id} help={input.help}>
                <Input
                  id={input.id} type="number" step={input.step ?? "any"} min={input.min} max={input.max}
                  placeholder={input.placeholder}
                  value={mergedValues[input.id] ?? ""}
                  onChange={(e) => setValues((p) => ({ ...p, [input.id]: e.target.value }))}
                />
              </Field>
            );
          }
          if (input.type === "color") {
            return (
              <Field key={input.id} label={input.label} htmlFor={input.id} help={input.help}>
                <div className="flex items-center gap-3">
                  <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-border">
                    <input
                      id={input.id}
                      type="color"
                      value={mergedValues[input.id] ?? "#ffffff"}
                      onChange={(e) => setValues((p) => ({ ...p, [input.id]: e.target.value }))}
                      className="absolute -inset-2 h-[calc(100%+1rem)] w-[calc(100%+1rem)] cursor-pointer border-0 bg-transparent p-0"
                    />
                  </div>
                  <Input
                    type="text"
                    value={mergedValues[input.id] ?? "#ffffff"}
                    onChange={(e) => setValues((p) => ({ ...p, [input.id]: e.target.value }))}
                    className="font-mono text-sm"
                  />
                </div>
              </Field>
            );
          }
          if (input.type === "text") {
            return (
              <Field key={input.id} label={input.label} htmlFor={input.id} help={input.help}>
                <div className="relative w-full">
                  <Textarea
                    id={input.id}
                    placeholder={input.placeholder ?? "输入要转换或计算的文本..."}
                    rows={5}
                    value={mergedValues[input.id] ?? ""}
                    onChange={(e) => setValues((p) => ({ ...p, [input.id]: e.target.value }))}
                    className="w-full min-h-[140px] pr-20 p-4 text-sm leading-relaxed rounded-2xl"
                  />
                  <div className="absolute right-3 top-3">
                    <PasteButton onPaste={(text) => setValues((p) => ({ ...p, [input.id]: text }))} />
                  </div>
                </div>
              </Field>
            );
          }
          return (
            <Field key={input.id} label={input.label} htmlFor={input.id} help={input.help}>
              <div className="relative w-full">
                <Input
                  id={input.id}
                  type={input.type === "url" ? "url" : "text"}
                  placeholder={input.placeholder ?? "请输入内容，可直接粘贴文字或链接"}
                  value={mergedValues[input.id] ?? ""}
                  onChange={(e) => setValues((p) => ({ ...p, [input.id]: e.target.value }))}
                  className="w-full h-12 pr-20 pl-4 rounded-xl text-sm"
                />
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                  <PasteButton onPaste={(text) => setValues((p) => ({ ...p, [input.id]: text }))} />
                </div>
              </div>
            </Field>
          );
        })}

        <Button type="submit" size="lg" disabled={loading} className={cn("shrink-0 whitespace-nowrap", loading && "animate-pulse-glow")}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {loading ? "执行中…" : "开始执行"}
        </Button>
      </form>

      {error && tool.mode === "sync" && <Alert variant="destructive">{error}</Alert>}

      {result && (
        <motion.div
          initial={{ opacity: 0, y: 12, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: "spring", stiffness: 320, damping: 26 }}
          className="relative space-y-4 overflow-visible rounded-2xl border border-success/30 bg-card p-5"
        >
          <Confetti />
          <div className="flex items-center justify-between">
            <p className="flex items-center gap-1.5 text-xs font-semibold text-success">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-success/15">
                <Check className="h-3 w-3" />
              </span>
              处理完成 · {formatBytes(result.size)}
            </p>
            {result.kind === "text" && (
              <Button type="button" variant="ghost" size="sm" onClick={copyText} className="shrink-0 whitespace-nowrap">
                {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                {copied ? "已复制" : "复制"}
              </Button>
            )}
          </div>

          {result.kind === "file" && result.mimeType.startsWith("image/") && (
            <div className="space-y-3">
              {result.beforeUrl ? (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <figure className="space-y-1.5">
                      <figcaption className="text-[11px] text-muted-foreground">处理前</figcaption>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={result.beforeUrl} alt="处理前" className="w-full rounded-lg border border-border object-contain" />
                    </figure>
                    <figure className="space-y-1.5">
                      <figcaption className="text-[11px] text-primary">处理后</figcaption>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={result.url} alt="处理后" className="w-full rounded-lg border border-primary/40 object-contain" />
                    </figure>
                  </div>
                  {result.beforeSize !== undefined && <SizeComparison before={result.beforeSize} after={result.size} />}
                </>
              ) : (
                <figure className="space-y-1">
                  <figcaption className="text-[11px] text-primary">结果预览</figcaption>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={result.url} alt="结果" className="w-full rounded-lg border border-border" />
                </figure>
              )}
            </div>
          )}

          {result.kind === "text" && (
            <pre className="thin-scroll max-h-[360px] overflow-auto rounded-lg border border-border bg-background p-4 font-mono-accent text-xs leading-relaxed">
              {result.text}
            </pre>
          )}

          <a
            href={result.kind === "text" ? `data:${result.mimeType},${encodeURIComponent(result.text || "")}` : result.url}
            download={result.filename}
            className="sheen relative inline-flex h-11 items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground transition-all hover:brightness-110 active:scale-[0.98]"
          >
            <Download className="h-4 w-4" /> 下载 {result.filename}
          </a>
        </motion.div>
      )}

      {tool.mode === "async" && (
        <div className="relative overflow-visible">
          {jobConfetti > 0 && <Confetti key={jobConfetti} />}
          <JobProgress
            job={jobQuery.data ?? null}
            isLoading={loading || jobQuery.isLoading}
            error={error}
            beforeUrl={beforePreviewUrl}
            beforeName={files[0]?.name}
            beforeSize={files[0]?.size}
            toolId={tool.id}
          />
        </div>
      )}
    </ToolShell>
  );
}

class ToolErrorBoundary extends Component<
  { children: React.ReactNode },
  { hasError: boolean; error: Error | null }
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[ToolErrorBoundary] 工具运行异常:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded-2xl border border-destructive/20 bg-card p-8 text-center shadow-xs">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-destructive/10 text-destructive">
            <AlertCircle className="h-6 w-6" />
          </div>
          <h3 className="text-base font-semibold text-foreground">当前工具加载遇到了小异常</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {this.state.error?.message || "组件执行出错，可尝试点击重试或刷新页面"}
          </p>
          <div className="mt-4 flex justify-center gap-3">
            <Button
              size="sm"
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
            >
              重新加载
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

function ToolShell({ tool, children }: { tool: Tool; children: React.ReactNode }) {
  const router = useRouter();
  const accent = CATEGORY_COLOR[tool.category] ?? "#0ea5e9";
  const { recordTool } = useRecentTools();

  useEffect(() => {
    recordTool(tool.id);
  }, [tool.id, recordTool]);

  const handleBack = () => {
    try {
      sessionStorage.setItem("furina:restore_scroll", "1");
      const lastListUrl = sessionStorage.getItem("furina:last_list_url");
      if (lastListUrl && !lastListUrl.startsWith("/tools/")) {
        router.push(lastListUrl);
        return;
      }
    } catch {
      /* ignore */
    }
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push(`/?c=${tool.category}`);
    }
  };

  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mx-auto max-w-[1200px] space-y-5 p-6 lg:p-8">
      {/* 面包屑：返回 + 首页 / 分类 / 工具 */}
      <nav className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <button
          onClick={handleBack}
          title="返回上一级（自动回到原浏览位置）"
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-card transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </button>
        <Link href="/" className="rounded px-1 hover:text-foreground">首页</Link>
        <span className="opacity-50">/</span>
        <Link href={`/?c=${tool.category}`} className="rounded px-1 hover:text-foreground" style={{ color: accent }}>
          {CATEGORY_LABELS[tool.category]}
        </Link>
        <span className="opacity-50">/</span>
        <span className="text-foreground/70">{tool.name}</span>
      </nav>

      {/* 紧凑标题卡片 */}
      <div className="flex items-center gap-3.5 rounded-2xl border border-border bg-card px-5 py-4">
        <span className="h-9 w-1.5 shrink-0 rounded-full" style={{ background: accent }} />
        <div className="min-w-0">
          <h1 className="text-[18px] font-bold leading-tight tracking-tight">{tool.name}</h1>
          <p className="mt-0.5 truncate text-[13px] text-muted-foreground">{tool.description}</p>
        </div>
      </div>

      <ToolErrorBoundary>
        {children}
      </ToolErrorBoundary>
    </motion.div>
  );
}

function SizeComparison({ before, after }: { before: number; after: number }) {
  const delta = before > 0 ? ((after - before) / before) * 100 : 0;
  const smaller = after < before;
  const pct = before > 0 ? Math.min(100, (after / before) * 100) : 100;
  return (
    <div className="rounded-lg border border-border bg-background/60 p-3">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{formatBytes(before)} · 处理前</span>
        <span className={cn("font-semibold", smaller ? "text-success" : delta === 0 ? "text-muted-foreground" : "text-amber-400")}>
          {delta === 0 ? "无变化" : `${smaller ? "−" : "+"}${Math.abs(delta).toFixed(0)}%`}
        </span>
        <span className="text-foreground">{formatBytes(after)} · 处理后</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div className={cn("h-full rounded-full transition-all duration-700", smaller ? "bg-success" : "bg-amber-400")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Field({
  label, htmlFor, help, children,
}: {
  label: string;
  htmlFor?: string;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {help && <p className="text-[11px] leading-relaxed text-muted-foreground/80">{help}</p>}
    </div>
  );
}
