import { RenameWorkspace } from "@/components/tools/rename-workspace";

import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/tool-runner.tsx");
import {resolveToolId,getRawToolById} from "@/shared/tools";
import {AudioPreview} from "./audio-preview";
import {FunctionWorkspace} from "./function-workspace";
import {GeometryWorkspace} from "./geometry-workspace";
import {PdfActionGroup} from "./pdf-action-group";
import {TextTransformWorkspace,TextOrganizerWorkspace} from "./text-workspaces";
import {PDF_EDITOR_TOOL_IDS} from "@/shared/catalog-policy";
import {PdfWorkspace,CalendarWorkspace} from "./combined-workspaces";
import {FancyWorkspace} from "./fancy-workspace";
import {isPendingFile} from '@/lib/pending-origin';
"use client";
import { NotesTool } from "@/components/tools/notes-tool";
import { OpenOutputFolderButton } from "@/components/ui/open-output-folder";

import React, { Component, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { notFound, useRouter } from "next/navigation";
import Link from "next/link";
import { getToolById, CATEGORY_LABELS } from "@furinakit/shared";
import type { Job, OmniTool } from "@furinakit/shared";
import { Download, Loader2, Check, Copy, Play, ArrowLeft, AlertCircle, Sparkles } from "lucide-react";
import { Alert, Button, Input, Label, PasteButton, Select, Textarea } from "@/components/ui/primitives";
import { FileDropzone } from "@/components/tools/file-dropzone";
import { VideoRegionPreview } from "@/components/tools/video-region-preview";
import { videoRegionIssue } from "@/lib/media-input-validation";
import { readVideoDimensions } from "@/lib/video-dimensions";
import { ToolModelDownloader } from "@/components/tools/tool-model-downloader";
import { OfficeRequirementBanner, OFFICE_TOOL_NEEDS } from "@/components/tools/office-requirement-banner";
import { BgReplaceTool } from "@/components/tools/bg-replace-tool";
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
// 2026-09 新增工具
import { CharsetDetectTool, EncodingRepairTool } from "@/components/tools/encoding-tools";
import { CurlToCodeTool, RegexCheatsheetTool, HtmlToMarkdownTool } from "@/components/tools/dev-convert-tools";
import { TimezoneConvertTool, SunriseSunsetTool } from "@/components/tools/time-tools";
import {
  BmrCalculatorTool,
  CalorieDeficitTool,
  RunningPaceTool,
  SleepCycleTool,
} from "@/components/tools/health-tools";
import { FoodCaloriesTool, NutritionFactsTool } from "@/components/tools/food-tools";
import { MortgageCalculatorTool, MortgagePrepayTool, StockPnlTool } from "@/components/tools/finance-tools";
import { ZodiacSignTool, TotpTool } from "@/components/tools/life-tools";
import { LuckyWheelTool, RandomDecisionTool } from "@/components/tools/random-tools";
import { QuoteCardTool } from "@/components/tools/quote-card-tool";
import { LedgerTool, PeriodTrackerTool, DueDateTool } from "@/components/tools/record-tools";
import {
  WeatherQueryTool,
  PublicIpTool,
  PhoneLocationTool,
  ExpressQueryTool,
  DomainCheckTool,
} from "@/components/tools/net-tools";
import { ImageMetadataCleanTool, ImageFilterTool } from "@/components/tools/image-privacy-tools";
import { KinshipTool, SubtitleConvertTool } from "@/components/tools/life-family-tools";
import { BatteryHealthTool } from "@/components/tools/system-battery-tool";
import { MediaInfoTool, WebExportTool } from "@/components/tools/system-media-tools";
import { MemeMakerTool } from "@/components/tools/meme-tool";
import { ScreenshotTranslateTool } from "@/components/tools/translate-tool";
import { ImageCropTool } from "@/components/tools/image-crop-tool";
import { VideoDownloadTool } from "@/components/tools/video-download-tool";
import { TextToSpeechTool } from "@/components/tools/text-to-speech-tool";
import { AudioTranscribeTool } from "@/components/tools/audio-transcribe-tool";
import {
  SystemOverviewTool,
  CpuMemoryTool,
  GpuDisplayTool,
  BoardFirmwareTool,
  StorageHealthTool,
  NetworkDeviceTool,
  PowerSensorTool,
} from "@/components/tools/system-info-tools";
import { TeleprompterTool } from "@/components/tools/teleprompter-tool";
import { TypingTestTool } from "@/components/tools/typing-test-tool";
import { BodyFatTool, InterestTool } from "@/components/tools/life-calc-tools";
import { ColorExtractTool } from "@/components/tools/color-extract-tool";
import { BpmDetectTool } from "@/components/tools/bpm-detect-tool";
import { BigFileScanTool } from "@/components/tools/disk-cleanup-tools";
import { AiPolishTool, AiTranslateTool, AiDocumentTool, AiTableTool } from "@/components/tools/ai-tools";
import { AiPptDraftTool } from "@/components/tools/ai-ppt-tools";
import { ColorSpaceLabTool } from "@/components/tools/color-space-lab";
import { ColorReplaceTool } from "@/components/tools/color-replace-tool";
import { PdfCropTool } from "@/components/tools/pdf-crop-tool";
import { TextLinesTool } from "@/components/tools/text-lines-tools";
import { CssStudioTool } from "@/components/tools/css-studio-tool";
import { EncoderStudioTool } from "@/components/tools/encoder-studio-tool";
import { ChecksumStudioTool } from "@/components/tools/checksum-studio-tool";
import { JsonStudioTool } from "@/components/tools/json-studio-tool";
import { WatermarkRemoverTool } from "@/components/tools/watermark-remover-tool";
import { PdfEditorTool } from "@/components/tools/pdf-editor-tool";
import { ScreenshotOcrTool } from "@/components/tools/screenshot-ocr-tool";
import { FloatingScreenshotTool } from "@/components/tools/floating-screenshot-tool";
import { QrWorkspace } from "@/components/tools/qr-workspace";
import { QrGeneratorTool } from "@/components/tools/qr-generator-tool";
import { LoremGenTool } from "@/components/tools/lorem-gen-tool";
import { ScreenRecorderTool } from "@/components/tools/screen-recorder-tool";
import { ClipboardHistoryTool } from "@/components/tools/clipboard-history-tool";
import { ImageDedupTool } from "@/components/tools/image-dedup-tool";
import { NetQueryTool } from "@/components/tools/net-query-tool";
import { MagnetDownloadTool } from "@/components/tools/magnet-download-tool";
import { ImagesToPdfTool } from "@/components/tools/images-to-pdf-tool";
import { WatermarkTool } from "@/components/tools/watermark-tool";
import { ImageCompressTool } from "@/components/tools/image-compress-tool";
import { ImageMergeTool } from "@/components/tools/image-merge-tool";
import { ImageResizeTool } from "@/components/tools/image-resize-tool";
import { ImageSplitTool } from "@/components/tools/image-split-tool";
import { ImageUpscaleTool } from "@/components/tools/image-upscale-tool";
import { ImageObfuscateTool } from "@/components/tools/image-obfuscate-tool";
import { FileHideImageTool } from "@/components/tools/file-hide-image-tool";
import { TaxCalculatorTool } from "@/components/tools/tax-calculator-tool";
import { FunctionCalculatorTool } from "@/components/tools/function-calculator-tool";
import { LanTransferTool } from "@/components/tools/lan-transfer-tool";
import { trackToolUsage } from "@/lib/analytics";

// 大量纯前端小工具
import {
  RmbUppercaseTool, LoanCalculatorTool, BmiCalculatorTool, BaseConverterTool,
  WordCountTool, TextDedupTool, MorseCodeTool, CaesarCipherTool,
  UuidGeneratorTool, TimestampConverterTool, PasswordGeneratorTool, RandomNumberTool,
  DateCalculatorTool, TextReplaceTool,
  FullwidthHalfwidthTool, AesEncryptTool, RomanNumeralTool, CrontabGeneratorTool,
  CreditCardCalculatorTool,
  EnglishAmountUppercaseTool, NumberEnglishTool, ExchangeRateTool,
  LunarCalendarTool, TextCompareTool,
  FancyTextTool, PinyinConverterTool, ShaHashTool, UnicodeConverterTool, GuidGeneratorTool,
  JsonToTsTool, UserAgentAnalyzerTool, QrDecoderTool, PeriodicTableTool, ImageBase64Tool,
  CrcChecksumTool, FileHexTool, SpecialSymbolsTool,
   MindMapTool,
  JsFormatterTool, HtmlFormatterTool, CaseConverterTool, DateConverterTool,
  IpConverterTool, HttpStatusTool, ScatterChartTool, PieChartTool, LineChartTool, BarChartTool,
} from "@/components/tools/simple-tools";
import {
  ChineseConverterTool, SpeedTestTool, ColorPaletteTool, MediaTrackerTool,
} from "@/components/tools/extra-tools";
import { ArchprTool } from "@/components/tools/archpr-tool";
import { AdvancedCalculatorTool } from "@/components/tools/calculator-tool";
import { SignatureDesignerTool } from "@/components/tools/signature-tool";
import { JsonYamlTool, JsonXmlTool, JsonCsvTool } from "@/components/tools/format-convert-tools";
import { DnsLookupTool, SslCheckerTool, UrlParserTool, ImageExifTool } from "@/components/tools/net-query-tools";
import { CssGradientTool, SvgOptimizeTool, AsciiArtTool } from "@/components/tools/dev-format-tools";
import {
  VideoTrimTool,
  AudioTrimTool,
  VideoThumbnailTool as VideoFrameExtractTool,
  CsvExcelTool,
  MarkdownToPdfTool,
} from "@/components/tools/media-sheet-tools";
import {
  CssFormatterTool,
  SqlFormatterTool,
  CodeMinifyTool,
  JsonSchemaTool,
} from "@/components/tools/dev-code-tools";
import {
  PomodoroTool,
  BusinessCardTool,
  WordCloudTool,
  PerlerBeadsTool,
} from "@/components/tools/fun-tools";
import { GeometryCalculatorTool } from "@/components/tools/geometry-tools";
import { TimeToolboxTool } from "@/components/tools/time-toolbox-tools";
import { FunctionGraphTool } from "@/components/tools/math-graph-tools";
import { HashCalculatorTool } from "./byte-workbench";
import { AdvancedMathTool } from "@/components/tools/advanced-math-tools";
import { TradeCalculatorTool } from "@/components/tools/trade-calculator-tools";
import { UnitConvertTool } from "@/components/tools/unit-convert-tools";
import { TranslatorTool } from "@/components/tools/translate-tools";
import { useRecentTools, loadToolSettings, saveToolSettings } from "@/lib/use-tool-prefs";
import { consumePendingFiles } from "@/lib/file-handoff";
import { useToast } from "@/components/ui/toast";
import { CATEGORY_COLOR } from "@/components/tools/tool-card";
import { getToolIcon } from "@/lib/tool-icons";
import { cn, formatBytes } from "@/lib/utils";

type ToolRunnerProps = { toolId: string };

/** 纯前端工具：id → 自带 UI 的组件 */
const CLIENT_TOOL_COMPONENTS: Record<string, React.ComponentType> = {
  // 2026-09 新增（编码类）
  "charset-detect": CharsetDetectTool,
  "encoding-repair": EncodingRepairTool,
  "curl-to-code": CurlToCodeTool,
  "regex-cheatsheet": RegexCheatsheetTool,
  "html-to-markdown": HtmlToMarkdownTool,
  "timezone-convert": TimezoneConvertTool,
  "sunrise-sunset": SunriseSunsetTool,
  "bmr-calculator": BmrCalculatorTool,
  "calorie-deficit": CalorieDeficitTool,
  "food-calories": FoodCaloriesTool,
  "nutrition-facts": NutritionFactsTool,
  "running-pace": RunningPaceTool,
  "sleep-cycle": SleepCycleTool,
  "mortgage-calculator": MortgageCalculatorTool,
  "mortgage-prepay": MortgagePrepayTool,
  "stock-pnl": StockPnlTool,
  "zodiac-sign": ZodiacSignTool,
  "totp-generator": TotpTool,
  "lucky-wheel": LuckyWheelTool,
  "random-decision": RandomDecisionTool,
  "quote-card": QuoteCardTool,
  "ledger": LedgerTool,
  "period-tracker": PeriodTrackerTool,
  "due-date": DueDateTool,
  "weather-query": WeatherQueryTool,
  "public-ip": PublicIpTool,
  "phone-location": PhoneLocationTool,
  "express-query": ExpressQueryTool,
  "domain-check": DomainCheckTool,
  "image-metadata-clean": ImageMetadataCleanTool,
  "image-filter": ImageFilterTool,
  "kinship": KinshipTool,
  "subtitle-convert": SubtitleConvertTool,
  "battery-health": BatteryHealthTool,
  "media-info": MediaInfoTool,
  "web-export": WebExportTool,
  "meme-maker": MemeMakerTool,
  "screenshot-translate": ScreenshotTranslateTool,
  "json-formatter": JsonFormatterTool,
  "pdf-to-images": PdfToImagesTool,
  "bg-remove": BgRemoveTool,
  "image-crop": ImageCropTool,
  "image-resize": ImageResizeTool,
  "image-split": ImageSplitTool,
  "image-upscale": ImageUpscaleTool,
  "image-obfuscate": ImageObfuscateTool,
  "file-hide-image": FileHideImageTool,
  "url-encode": UrlCodecTool,
  base64: Base64Tool,
  "color-convert": ColorConverterTool,
  "jwt-decode": JwtDecoderTool,
  "regex-tester": RegexTesterTool,
  "markdown-preview": MarkdownPreviewTool,
  // simple-tools
  "rmb-uppercase": RmbUppercaseTool, "loan-calculator": LoanCalculatorTool,
  "bmi-calculator": BmiCalculatorTool, "base-converter": BaseConverterTool,
  "word-count": WordCountTool,
  "text-dedup": TextDedupTool, "morse-code": MorseCodeTool,
  "caesar-cipher": CaesarCipherTool, "uuid-generator": UuidGeneratorTool,
  "timestamp-converter": TimestampConverterTool, "password-generator": PasswordGeneratorTool,
  "random-number": RandomNumberTool, "simple-calculator": AdvancedCalculatorTool,
  "date-calculator": DateCalculatorTool,
  "text-replace": TextReplaceTool, "fullwidth-halfwidth": FullwidthHalfwidthTool,
  "aes-encrypt": AesEncryptTool, "roman-numeral": RomanNumeralTool,
  "crontab-generator": CrontabGeneratorTool,
  "tax-calculator": TaxCalculatorTool,
  "func-calc": FunctionWorkspace,
  "credit-card-calculator": CreditCardCalculatorTool,
  "number-english": NumberEnglishTool,
  "exchange-rate": ExchangeRateTool,
  // geometry-calculator 用新组件（见上方 import），旧版已从 simple-tools 删除
  
  "text-compare": TextCompareTool,
  "fancy-text": FancyTextTool, "pinyin-converter": PinyinConverterTool,
  "sha-hash": ShaHashTool, "unicode-converter": UnicodeConverterTool,
  "guid-generator": GuidGeneratorTool, "json-to-ts": JsonToTsTool,
  "user-agent-analyzer": UserAgentAnalyzerTool, "qr-decoder": QrWorkspace,
  "qr-generator": QrGeneratorTool, "lorem-gen": LoremGenTool, "periodic-table": PeriodicTableTool, "image-base64": ImageBase64Tool,
  "crc-checksum": CrcChecksumTool,
  "file-hex": FileHexTool,
  // stopwatch 已被「时间管理大师」(time-toolbox) 取代，见新组件 import
  "special-symbols": SpecialSymbolsTool,
  // 7 个零散的单位转换工具已整合成「单位换算」，见下方 unit-converter
  "batch-rename": RenameWorkspace,
  "mind-map": MindMapTool,
  // 新增开发/文本/网络工具
  "js-formatter": JsFormatterTool, "html-formatter": HtmlFormatterTool,
  "case-converter": CaseConverterTool, 
  "ip-converter": IpConverterTool, "http-status": HttpStatusTool,
  "scatter-chart": ScatterChartTool, "pie-chart": PieChartTool,
  "line-chart": LineChartTool, "bar-chart": BarChartTool,
  // extra-tools
  "chinese-converter": ChineseConverterTool, "speed-test": SpeedTestTool,
  "color-palette": ColorPaletteTool, "media-tracker": MediaTrackerTool,
  "archpr": ArchprTool,
  "signature-designer": SignatureDesignerTool,
  // 格式转换（纯浏览器本地完成）
  "json-yaml": JsonYamlTool, "json-xml": JsonXmlTool, "json-csv": JsonCsvTool,
  // 开发/网络查询类（各自量身定制的界面：记录卡 / 状态卡 / 部件高亮 / 分块字段表）
  "dns-lookup": DnsLookupTool, "ssl-checker": SslCheckerTool,
  "url-parser": UrlParserTool, "image-exif": ImageExifTool,
  // 开发/生成类（实时预览 / 前后对比 / 边打边出图）
  "css-gradient": CssGradientTool, "svg-optimize": SvgOptimizeTool, "ascii-art": AsciiArtTool,
  // 音视频处理与文档格式转换（本地引擎异步任务）
  "video-trim": VideoTrimTool, "audio-trim": AudioTrimTool, "video-frame-extract": VideoFrameExtractTool,
  "csv-excel": CsvExcelTool, "markdown-to-pdf": MarkdownToPdfTool,
  // 开发/代码处理（纯浏览器本地完成）
  "css-format": CssFormatterTool, "sql-format": SqlFormatterTool,
  "code-minify": CodeMinifyTool, "json-schema-validate": JsonSchemaTool,
  // 趣味与生活小工具（纯浏览器本地完成）
  "pomodoro": PomodoroTool, "business-card": BusinessCardTool,
  "word-cloud": WordCloudTool, "perler-beads": PerlerBeadsTool,
  // 数学与时间（各自量身定制的工作台）
  "geometry-calculator": GeometryWorkspace,
  "function-graph": FunctionGraphTool,
  "advanced-math": AdvancedMathTool,
  "time-toolbox": TimeToolboxTool,

  "unit-converter": UnitConvertTool,
  "translator": TranslatorTool,
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
  const __locale = __useLanguage();
  const originalToolId=toolId;toolId=resolveToolId(toolId);
  const tool = getToolById(toolId);
  if (!tool) notFound();

  useEffect(() => {
    trackToolUsage(toolId);
  }, [toolId]);

  if(toolId==='date-calculator')return <ToolShell tool={tool}><CalendarWorkspace initial={originalToolId}/></ToolShell>;
  if(toolId==='text-transform')return <ToolShell tool={tool}><TextTransformWorkspace initial={originalToolId}/></ToolShell>;
  if(toolId==='fancy-text')return <ToolShell tool={tool}><FancyWorkspace/></ToolShell>;
  // 通用视频下载：内置网页全屏渲染（给网站最大空间）
  if (toolId === "video-download") {
    return (
      <div className="flex flex-col p-4" style={{ height: "calc(100vh - 60px)" }}>
        <VideoDownloadTool toolId={toolId} />
      </div>
    );
  }

  // 系统工具（查看本机硬件与系统信息）
  // 网络查询（四种查询，界面自绘）
  if (toolId === "net-query") {
    return (
      <ToolShell tool={tool}>
        <NetQueryTool />
      </ToolShell>
    );
  }

  // 图片换背景（三套互斥参数，自绘界面按选择只显示该显示的）

  if (toolId === "bg-replace") {

    return (

      <ToolShell tool={tool}>

        <BgReplaceTool />

      </ToolShell>

    );

  }


  // 图片查重（桌面端选文件夹 + 分组网格）
  if (toolId === "image-dedup") {
    return (
      <ToolShell tool={tool}>
        <ImageDedupTool />
      </ToolShell>
    );
  }

  // 剪贴板历史（桌面端独占）
  if (toolId === "notes") return <ToolShell tool={tool}><NotesTool /></ToolShell>;
  if (toolId === "clipboard-history") {
    return (
      <ToolShell tool={tool}>
        <ClipboardHistoryTool />
      </ToolShell>
    );
  }

  // 屏幕录制（桌面端独占）
  if (toolId === "floating-screenshot") {
    return (
      <ToolShell tool={tool}>
        <FloatingScreenshotTool />
      </ToolShell>
    );
  }
  if (toolId === "screen-recorder") {
    return (
      <ToolShell tool={tool}>
        <ScreenRecorderTool />
      </ToolShell>
    );
  }

  // 截图取字（需要在画面上拖框，用独立界面）
  if (toolId === "screenshot-ocr" || toolId === "ocr-image") {
    return (
      <ToolShell tool={tool}>
        <ScreenshotOcrTool />
      </ToolShell>
    );
  }

  // Independent PDF tools; group only merge/split and encrypt/unlock.
  if (toolId === "pdf-merge" || toolId === "pdf-encrypt") return <ToolShell tool={tool}><PdfActionGroup kind={toolId==="pdf-merge"?"pages":"protection"} initial={originalToolId} render={id=><GenericToolRunner tool={getRawToolById(id)!} embedded/>}/></ToolShell>;
  if (toolId === "pdf-editor") return <ToolShell tool={tool}><PdfEditorTool/></ToolShell>;
  if (toolId === "pdf-crop") return <ToolShell tool={tool}><PdfCropTool/></ToolShell>;

  // 图片去水印（在图上直接标注范围）
  if (toolId === "watermark-remove") {
    return (
      <ToolShell tool={tool}>
        <WatermarkRemoverTool />
      </ToolShell>
    );
  }

  // JSON 工具箱
  if (toolId === "json-studio") {
    return (
      <ToolShell tool={tool}>
        <JsonStudioTool />
      </ToolShell>
    );
  }

  // 校验与摘要工具箱
  if (toolId === "checksum-studio") {
    return (
      <ToolShell tool={tool}>
        <ChecksumStudioTool />
      </ToolShell>
    );
  }

  // 编码转换工具箱
  if (toolId === "encoder-studio") {
    return (
      <ToolShell tool={tool}>
        <EncoderStudioTool />
      </ToolShell>
    );
  }

  // CSS 样式生成器工具箱
  if (toolId === "css-studio") {
    return (
      <ToolShell tool={tool}>
        <CssStudioTool />
      </ToolShell>
    );
  }

  // 文本行处理工具箱
  if (toolId === "text-lines") {
    return (
      <ToolShell tool={tool}>
        <TextOrganizerWorkspace />
      </ToolShell>
    );
  }


  if (toolId.startsWith("sys-")) {
    const SysTool = {
      "sys-overview": SystemOverviewTool,
      "sys-cpu-memory": CpuMemoryTool,
      "sys-gpu-display": GpuDisplayTool,
      "sys-board-bios": BoardFirmwareTool,
      "sys-storage": StorageHealthTool,
      "sys-network": NetworkDeviceTool,
      "sys-power": PowerSensorTool,
    }[toolId];
    if (SysTool) {
      return (
        <ToolShell tool={tool}>
          <SysTool />
        </ToolShell>
      );
    }
  }

  // 生活与计算类的小工具（各自独立界面）
  if (toolId === "teleprompter" || toolId === "typing-test" || toolId === "body-fat" ||
      toolId === "interest-calc" || toolId === "color-extract" || toolId === "bpm-detect") {
    const Tool = {
      teleprompter: TeleprompterTool,
      "typing-test": TypingTestTool,
      "body-fat": BodyFatTool,
      "interest-calc": InterestTool,
      "color-extract": ColorExtractTool,
      "bpm-detect": BpmDetectTool,
    }[toolId];
    return (
      <ToolShell tool={tool}>
        <Tool />
      </ToolShell>
    );
  }

  // PDF 页面裁剪：可视化拖框，用独立界面而不是通用表单
  if (toolId === "pdf-crop") {
    return (
      <ToolShell tool={tool}>
        <PdfCropTool />
      </ToolShell>
    );
  }

  // 配色工具
  if (toolId === "color-space-lab" || toolId === "color-replace") {
    const ColorTool = toolId === "color-space-lab" ? ColorSpaceLabTool : ColorReplaceTool;
    return (
      <ToolShell tool={tool}>
        <ColorTool />
      </ToolShell>
    );
  }

  if (toolId === "hash-generator") return <ToolShell tool={tool}><HashCalculatorTool /></ToolShell>;
  // AI 工具（需要 API Key，界面里带配置入口）
  if (toolId === "ai-ppt-draft") {
    const PptAiTool = AiPptDraftTool;
    return (
      <ToolShell tool={tool}>
        <PptAiTool />
      </ToolShell>
    );
  }

  if (toolId === "ai-polish" || toolId === "ai-translate" || toolId === "ai-document" || toolId === "ai-table") {
    const AiTool = {
      "ai-polish": AiPolishTool,
      "ai-translate": AiTranslateTool,
      "ai-document": AiDocumentTool,
      "ai-table": AiTableTool,
    }[toolId];
    return (
      <ToolShell tool={tool}>
        <AiTool />
      </ToolShell>
    );
  }

  // 占用空间排查：只读扫描，不提供删除
  if (toolId === "big-file-scan") {
    return (
      <ToolShell tool={tool}>
        <BigFileScanTool />
      </ToolShell>
    );
  }

  if (toolId === "text-to-speech") return <ToolShell tool={tool}><TextToSpeechTool /></ToolShell>;

  // 本地语音转文字：需要模型下载管理，所以用独立界面而不是通用表单
  if (toolId === "audio-transcribe") {
    return (
      <ToolShell tool={tool}>
        <AudioTranscribeTool />
      </ToolShell>
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

  // 跨设备极速互传：手机免装 App 扫码即传工作台
  if (toolId === "lan-transfer") {
    return (
      <ToolShell tool={tool}>
        <LanTransferTool />
      </ToolShell>
    );
  }

  // 图片强化：Real-ESRGAN 批量超分辨率（最多50张）与实时原图滑动对比
  if (toolId === "anime-upscale") {

    return (

      <ToolShell tool={tool}>

        <ImageUpscaleTool defaultModel="realesrgan-x4plus-anime" />

      </ToolShell>

    );

  }

  if (toolId === "image-upscale") {
    return (
      <ToolShell tool={tool}>
        <ImageUpscaleTool />
      </ToolShell>
    );
  }

  // 图片混淆/反混淆：基于女娲算法与像素级加密混淆
  if (toolId === "image-obfuscate") {
    return (
      <ToolShell tool={tool}>
        <ImageObfuscateTool />
      </ToolShell>
    );
  }

  // 文件伪装为图片：图种隐写与还原提取
  if (toolId === "file-hide-image") {
    return (
      <ToolShell tool={tool}>
        <FileHideImageTool />
      </ToolShell>
    );
  }

  // 综合税金税率计算
  if (toolId === "tax-calculator") {
    return (
      <ToolShell tool={tool}>
        <TaxCalculatorTool />
      </ToolShell>
    );
  }

  // 函数计算
  if (toolId === "func-calc") {
    return (
      <ToolShell tool={tool}>
        <FunctionWorkspace />
      </ToolShell>
    );
  }

  const ClientComponent = CLIENT_TOOL_COMPONENTS[tool.id];
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

/**
 * 按工具缓存「用户还没提交完的输入」。
 *
 * 需求：在工具 A 上传了图片，切到工具 B 再切回 A，A 应该还是离开时的样子；
 * 同时每个工具必须互相独立 —— 切到 B 时不该看到 A 的文件和结果。
 *
 * File 对象无法序列化进 localStorage / sessionStorage，所以这里用模块级缓存：
 * 应用内切换工具、回首页再进来都能恢复；整页刷新（F5）会丢失，这是 File 的固有限制。
 * 只缓存「文件选择」，不缓存运行结果：结果的预览用的是 object URL，
 * 组件卸载时会被释放，缓存下来只会得到一个失效的链接。
 */
type ToolDraft = {
  /**
   * 文件输入按**输入项 id** 分别保存。
   * ★ 以前是一个 files + 一个 multiFiles 打天下，于是「黑白上色」这种有两个文件框的工具，
   *   上传黑白图之后"色彩参考图"那一栏也会跟着显示同一张图（作者实测发现的 bug）。
   */
  filesById: Record<string, File[]>;
  /** 上一次的执行结果（同步工具的产出）。异步工具的产出靠 jobId 恢复，不走这里。 */
  result: SyncResultState | null;
};

/** 只保留最近用过的几个工具，避免长时间使用把文件对象与结果都攥在手里 */
const TOOL_DRAFT_LIMIT = 6;
const toolDraftCache = new Map<string, ToolDraft>();

/**
 * 释放某份草稿里结果所占用 object URL。
 *
 * 结果里 url / beforeUrl 是 URL.createObjectURL 的产物，不释放就会把整份 Blob 钉在内存里。
 * 现在这些链接的「所有权」归草稿缓存：只有确认要被替换或被淘汰时才释放，
 * 这样组件卸载（切到别的工具、回首页）之后链接依然有效，回来时结果还能正常显示与下载。
 */
function releaseDraftResult(draft: ToolDraft | undefined): void {
  if (!draft?.result) return;
  if (draft.result.url) URL.revokeObjectURL(draft.result.url);
  if (draft.result.beforeUrl) URL.revokeObjectURL(draft.result.beforeUrl);
}

function rememberToolDraft(toolId: string, draft: ToolDraft): void {
  const previous = toolDraftCache.get(toolId);

  // 结果被换成新的一份（或清空）时，释放旧结果占用的 URL，避免泄漏
  if (previous?.result && previous.result !== draft.result) {
    releaseDraftResult(previous);
  }

  // 先删再存：让 Map 的迭代顺序等于「最近使用顺序」，便于淘汰最旧的
  toolDraftCache.delete(toolId);
  toolDraftCache.set(toolId, {...draft, filesById:Object.fromEntries(Object.entries(draft.filesById).map(([key,files])=>[key,files.filter(file=>!isPendingFile(file))]))});

  while (toolDraftCache.size > TOOL_DRAFT_LIMIT) {
    const oldest = toolDraftCache.keys().next().value;
    if (oldest === undefined) break;
    releaseDraftResult(toolDraftCache.get(oldest));
    toolDraftCache.delete(oldest);
  }
}

/**
 * 通用表单里「纯文本输入」的草稿（按工具 + 字段名分开存）。
 *
 * 为什么单独用 sessionStorage：File 与 Blob 没法序列化，但文本可以 —— 存一份
 * 就能让用户切走再回来、甚至按 F5 都不丢输入。
 * 为什么内存里再放一份：读起来是同步零成本的，而且能避免大段文本（比如粘贴几十万
 * 字的 JSON）每次按键都写一次 sessionStorage 卡住界面 —— 写盘做了 400ms 防抖。
 */
const TEXT_DRAFT_PREFIX = "furina:textdraft:";
const textDraftMemory = new Map<string, Record<string, string>>();
const textDraftTimers = new Map<string, ReturnType<typeof setTimeout>>();

function readTextDraft(toolId: string): Record<string, string> {
  const cached = textDraftMemory.get(toolId);
  if (cached) return cached;

  let parsed: Record<string, string> = {};
  try {
    const raw = sessionStorage.getItem(TEXT_DRAFT_PREFIX + toolId);
    const obj = raw ? JSON.parse(raw) : null;
    if (obj && typeof obj === "object" && !Array.isArray(obj)) {
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (typeof v === "string") parsed[k] = v;
      }
    }
  } catch {
    parsed = {};
  }
  textDraftMemory.set(toolId, parsed);
  return parsed;
}

function writeTextDraft(toolId: string, fieldId: string, value: string): void {
  const draft = readTextDraft(toolId);
  if (value) draft[fieldId] = value;
  else delete draft[fieldId];

  const key = TEXT_DRAFT_PREFIX + toolId;
  const pending = textDraftTimers.get(key);
  if (pending) clearTimeout(pending);
  textDraftTimers.set(
    key,
    setTimeout(() => {
      textDraftTimers.delete(key);
      try {
        sessionStorage.setItem(key, JSON.stringify(draft));
      } catch {
        /* 存储不可用或被写满时忽略 */
      }
    }, 400),
  );
}

function FormToolShell({tool,embedded,children}:{tool:Tool;embedded:boolean;children:React.ReactNode}){
  const __locale = __useLanguage();return embedded?<div className="space-y-4">{children}</div>:<ToolShell tool={tool}>{children}</ToolShell>;}
function GenericToolRunner({ tool,embedded=false }: { tool: Tool;embedded?:boolean }) {
  const __locale = __useLanguage();
  // 挂载时就要从草稿缓存恢复。
  // 从首页进入工具页时这个组件是「新挂载」的（不是被复用），只靠下面那个
  // 「工具 id 变化」分支是恢复不了的 —— 这个坑是真机点击测试才发现的。
  const [filesById, setFilesById] = useState<Record<string, File[]>>(
    () => toolDraftCache.get(tool.id)?.filesById ?? {},
  );
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SyncResultState | null>(
    () => toolDraftCache.get(tool.id)?.result ?? null,
  );
  const [copied, setCopied] = useState(false);
  const [jobId, setJobId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const sp = new URLSearchParams(window.location.search);
      const qJob = sp.get("jobId");
      if (qJob) return qJob;
      return sessionStorage.getItem(`furina:job:${tool.id}`);
    } catch {
      return null;
    }
  });

  // 工具切换时，在「提交之前」同步装载该工具自己的草稿。
  //
  // 这里必须用渲染期纠正，不能放进 useEffect：同一次提交里下面的写缓存 effect 会先执行，
  // 那时 files 还是上一个工具的值，于是会把「工具 A 的图片」写进「工具 B 的存档」——
  // 这正是「切到 B 却看到 A 的文件与结果」的成因。
  // 同步纠正能保证：渲染出来的内容和即将写回缓存的内容，始终属于同一个工具。
  const [draftToolId, setDraftToolId] = useState(tool.id);
  if (draftToolId !== tool.id) {
    setDraftToolId(tool.id);
    const draft = toolDraftCache.get(tool.id);
    setFilesById(draft?.filesById ?? {});
    // 恢复该工具自己的结果；没有就是空 —— 绝不会看到上一个工具的结果卡片 / 下载按钮
    setResult(draft?.result ?? null);
    // 任务编号按工具从 sessionStorage 恢复（见下面的探测 effect），这里先清掉上一轮的残留
    setJobId(null);
    setError(null);
  }

  // 文件或结果有变化就更新缓存，保证离开这个工具时缓存里是最新的
  useEffect(() => {
    rememberToolDraft(tool.id, { filesById, result });
  }, [tool.id, filesById, result]);

  // 监听 URL searchParams、全局选择事件、并自动探测正在运行中的该工具后台任务
  useEffect(() => {
    if (typeof window === "undefined") return;

    // 1. 检查 URL 参数
    const sp = new URLSearchParams(window.location.search);
    const qJob = sp.get("jobId");
    if (qJob) {
      setJobId(qJob);
      sessionStorage.setItem(`furina:job:${tool.id}`, qJob);
      return;
    }

    // 2. 检查会话存储
    const stored = sessionStorage.getItem(`furina:job:${tool.id}`);
    if (stored) {
      setJobId(stored);
      return;
    }

    // 3. 若未设置任务且该工具为异步任务模式，向后端探测是否有正在处理中的任务
    if (tool.mode === "async") {
      fetch("/api/jobs", { cache: "no-store" })
        .then((r) => r.json())
        .then((data) => {
          if (Array.isArray(data?.jobs)) {
            const active = data.jobs.find(
              (j: { toolId?: string; status?: string; id?: string }) =>
                j.toolId === tool.id &&
                (j.status === "processing" || j.status === "pending" || j.status === "queued")
            );
            if (active?.id) {
              setJobId(active.id);
              sessionStorage.setItem(`furina:job:${tool.id}`, active.id);
            }
          }
        })
        .catch(() => {});
    }

    // 4. 监听悬浮球直接触发的任务选中事件
    const handleSelectJob = (e: Event) => {
      const detail = (e as CustomEvent<{ toolId?: string; jobId?: string }>).detail;
      if (detail?.toolId === tool.id && detail?.jobId) {
        setJobId(detail.jobId);
      }
    };
    window.addEventListener("furinakit:select-job", handleSelectJob);
    return () => window.removeEventListener("furinakit:select-job", handleSelectJob);
  }, [tool.id, tool.mode]);

  useEffect(() => {
    try {
      if (jobId) {
        sessionStorage.setItem(`furina:job:${tool.id}`, jobId);
      } else {
        sessionStorage.removeItem(`furina:job:${tool.id}`);
      }
    } catch {
      /* ignore */
    }
  }, [jobId, tool.id]);
  const [jobConfetti, setJobConfetti] = useState(0);
  const { toast } = useToast();
  const prevJobStatus = useRef<string | null>(null);

  const defaults = useMemo(() => {
    return Object.fromEntries(
      tool.inputs
        .filter((input) => input.defaultValue !== undefined)
        .map((input) => [input.id, String(input.defaultValue)]),
    );
  }, [tool, __locale]);

  const persistIds = useMemo(
    () => new Set(tool.inputs.filter((i) => i.type === "select" || i.type === "number").map((i) => i.id)),
    [tool, __locale],
  );
  const settingsToolRef = useRef<string | null>(null);

  useEffect(() => {
    const saved = loadToolSettings(tool.id);
    const restored = Object.fromEntries(Object.entries(saved).filter(([key]) => persistIds.has(key)));
    // 先铺「记住的选项/数字设置」，再盖上「文本草稿」—— 文本草稿是用户上一次真正输入的内容，优先。
    // 这样选择项/数字仍由原机制记住，而纯文本输入也不会再丢。
    setValues({ ...restored, ...readTextDraft(tool.id) });
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
    // 从别的工具拖文件过来 = 一次新的输入，清掉上一次的结果
    setResult(null);
    setFilesById((prev) => ({ ...prev, [fileInput.id]: fileInput.multiple ? handed : handed.slice(0, 1) }));
  }, [tool.id, tool.inputs]);

  // 注意：结果的 object URL 不在这里释放。
  // 它现在由上面的「按工具草稿缓存」持有 —— 只有这样，用户切到别的工具、回首页再回来时，
  // 结果卡片与下载按钮依然可用。释放时机是「被新结果替换」或「缓存淘汰」，
  // 见 releaseDraftResult()。

  // 预览用的 object URL 必须成对创建/释放。
  // 之前用 useMemo 在每次 files 变化时新建 URL 却从不 revoke：每换一次文件就泄漏
  // 一份已解码的位图，本次会话内不会回收。
  const [beforePreviewUrl, setBeforePreviewUrl] = useState<string | undefined>(undefined);
  // 预览取「第一个文件输入项」的文件（多文件输入项时取第一张）
  const firstFileInputId = tool.inputs.find((i) => i.type === "file")?.id;
  const firstFile = firstFileInputId ? (filesById[firstFileInputId] ?? [])[0] : undefined;
  const firstFileType = firstFile?.type;
  useEffect(() => {
    if (!firstFile || !firstFileType?.startsWith("image/")) {
      setBeforePreviewUrl(undefined);
      return;
    }
    const url = URL.createObjectURL(firstFile);
    setBeforePreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [firstFile, firstFileType]);

  const mergedValues = { ...defaults, ...values };

  /**
   * 通用表单所有输入值的统一写入口：
   * 除了更新界面，还把该字段的值写进「文本草稿」，让用户切走再回来、按 F5 都不丢。
   */
  const updateValue = (fieldId: string, value: string) => {
    setValues((prev) => ({ ...prev, [fieldId]: value }));
    writeTextDraft(tool.id, fieldId, value);
  };

  const jobQuery = useQuery({
    queryKey: ["job", jobId],
    queryFn: () => fetchJob(jobId!),
    enabled: Boolean(jobId),
    refetchInterval: (query) => {
      // 请求出错时必须停止轮询。
      // 否则任务记录过期被清理后，页面会对着同一个必然失败的请求每 1.5 秒轮询一次、
      // 永不停止，而且界面上不显示任何原因，用户只看到一个空白区域。
      if (query.state.error) return false;
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
    /**
     * 这一项现在需不需要填。
     *
     * ★ 原来文件类型输入被无条件当成必填 —— 定义里写 required: false 也没用，
     *   于是黑白上色选了「按风格预设上色（不需要参考图）」仍被拦下来说要传参考图。
     *   另外补了 requiredWhen（条件必填），让「选参考图模式时才要参考图」这种规则能表达出来。
     */
    const isRequiredNow = (input: Tool["inputs"][number]): boolean => {
      if (input.requiredWhen) {
        const actual = mergedValues[input.requiredWhen.field] ?? defaults[input.requiredWhen.field] ?? "";
        if (String(actual) !== String(input.requiredWhen.value)) return false;
        return true;
      }
      return input.required !== false;
    };

    for (const input of tool.inputs) {
      if (input.type === "file") {
        if (!isRequiredNow(input)) continue;
        const list = filesById[input.id] ?? [];
        if (list.length < 1) return `请先添加「${input.label}」`;
        continue;
      }
      if (isRequiredNow(input) && !mergedValues[input.id]?.trim()) {
        return `「${input.label}」不能为空`;
      }
    }
    return null;
  };

  const submitInFlight = useRef(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (submitInFlight.current) return;
    submitInFlight.current = true;
    setLoading(true);
    try {
    setError(null);
    setResult(null);
    setJobId(null);

    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }

    // 视频去水印：自定义区域必须落在画面内 —— 超出范围 FFmpeg 会直接"转换失败"，
    // 与其让人对着失败日志猜，不如提交前用真实分辨率把话说清楚（V30 实测踩过：160×120 视频选 200×20）。
    if (tool.id === "video-watermark-remove" && mergedValues["position"] === "custom") {
      const inputIssue = videoRegionIssue(mergedValues);
      if (inputIssue) { setError(inputIssue); return; }
      const vf = (filesById["file"] ?? [])[0];
      // Browser/OS may leave File.type empty even for a valid local video.
      const dims = vf ? await readVideoDimensions(vf) : null;
      const boundsIssue = videoRegionIssue(mergedValues, dims);
      if (boundsIssue) { setError(boundsIssue); return; }
    }

    const formData = new FormData();
    for (const input of tool.inputs) {
      if (input.type === "file") {
        const list = filesById[input.id] ?? [];
        if (input.multiple) list.forEach((f) => formData.append(input.id, f));
        else if (list[0]) formData.append(input.id, list[0]);
      } else {
        formData.append(input.id, mergedValues[input.id] ?? "");
      }
    }

      const response = await fetch(`/api/tools/${tool.id}`, { method: "POST", body: formData });
      const contentType = response.headers.get("content-type") || "";

      // 无论配置声明为 sync 还是 async，只要后端以 JSON 形式返回任务 ID（异步队列/后台执行），统一转入异步跟踪链路
      if (contentType.includes("application/json") && !response.headers.get("x-result-kind")) {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "请求失败");
        if (data.job?.id) {
          setJobId(data.job.id);
          return;
        }
        if (data.result !== undefined || data.text !== undefined) {
          const textContent = typeof data.result === "string" ? data.result : (data.text || JSON.stringify(data.result, null, 2));
          setResult({
            kind: "text",
            filename: `${tool.id}-result.txt`,
            mimeType: "text/plain",
            text: textContent,
            size: new Blob([textContent]).size,
          });
          toast({ title: "处理完成", description: tool.name, variant: "success" });
          return;
        }
        throw new Error(data.error || "处理失败");
      }

      if (tool.mode === "async") {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "请求失败");
        if (data.job?.id) setJobId(data.job.id);
        else throw new Error("任务未创建");
        return;
      }

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "处理失败");
      }

      const filename = decodeURIComponent(response.headers.get("x-result-filename") || "result");
      const kind = (response.headers.get("x-result-kind") as "file" | "text") || "file";
      const blob = await response.blob();

      // 旧结果的 URL 由草稿缓存负责释放（见 releaseDraftResult），这里只负责创建新的

      if (kind === "text") {
        setResult({ kind: "text", filename, mimeType: contentType, text: await blob.text(), size: blob.size });
      } else {
        const url = URL.createObjectURL(blob);
        const inputImage = firstFileInputId ? (filesById[firstFileInputId] ?? [])[0] : undefined;
        const showCompare =
          inputImage && inputImage.type.startsWith("image/") && contentType.startsWith("image/");
        const beforeUrl = showCompare ? URL.createObjectURL(inputImage) : undefined;
        setResult({
          kind: "file", filename, mimeType: contentType, url, size: blob.size,
          beforeUrl, beforeSize: showCompare ? inputImage.size : undefined,
        });
      }
      toast({ title: "处理完成", description: `${tool.name} · ${formatBytes(blob.size)}`, variant: "success" });
    } catch (err) {
      let message = err instanceof Error ? err.message : "出现未知错误";
      if (message.includes("os error 2") || message.includes("系统找不到指定的文件") || message.includes("Worker startup task failed") || message.includes("Compatible processing runtime missing")) {
        message = "未检测到 Python 扩展组件。该工具需要 Python 运行时支持，请前往「设置 → 组件」下载安装 Python 扩展组件后使用。";
      }
      setError(message);
      toast({ title: "处理失败", description: message, variant: "error" });
    } finally {
      submitInFlight.current = false;
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
    <FormToolShell tool={tool} embedded={embedded}>
      {tool.disclaimer && <Alert>{__ui(tool.disclaimer)}</Alert>}
      {tool.mode === "async" && (
        <Alert>{__ui("该工具由本地服务处理，请确认左下角显示「服务运行中」；文件仅在本机处理，不会上传到外部。")}</Alert>
      )}

      <form onSubmit={handleSubmit} className="space-y-5 rounded-2xl border border-border bg-card p-6">
        {tool.inputs.map((input) => {
          if (input.type === "file") {
            const list = filesById[input.id] ?? [];
            const baseSetter = (next: File[]) => setFilesById((prev) => ({ ...prev, [input.id]: next }));
            // 用户改了输入文件（重新选择、或从列表里移除）之后，上一次的结果就不再对应当前输入，
            // 这里把它清掉。结果本身由「按工具草稿缓存」保存，切到别的工具再回来仍能恢复。
            const setter = (next: File[]) => {
              baseSetter(next);
              setResult(null);
            };
            return (
              <Field key={input.id} label={__ui(input.label)} help={__ui(input.help)}>
                <FileDropzone files={list} onChange={setter} multiple={input.multiple} accept={input.accept ? { "application/x-furinakit-file": input.accept.split(",").map(s => s.trim()).filter(s => s.startsWith(".")), ...Object.fromEntries(input.accept.split(",").map(s => s.trim()).filter(s => s.includes("/")).map(rule => [rule, []])) } : accept} />
                {tool.id === "video-watermark-remove" && input.id === "file" && list[0] && (
                  <VideoRegionPreview file={list[0]} values={mergedValues}
                    onRegion={(fields) => Object.entries(fields).forEach(([key, value]) => updateValue(key, value))} />
                )}
              </Field>
            );
          }
          if (input.type === "select") {
            return (
              <Field key={input.id} label={__ui(input.label)} htmlFor={input.id} help={__ui(input.help)}>
                <Select
                  id={input.id}
                  value={mergedValues[input.id] ?? ""}
                  onChange={(e) => updateValue(input.id, e.target.value)}
                >
                  <option value="" disabled>{__ui("请选择…")}</option>
                  {(input.options ?? []).map((o) => (
                    <option key={o.value} value={o.value}>{__ui(o.label)}</option>
                  ))}
                </Select>
              </Field>
            );
          }
          if (input.type === "number") {
            return (
              <Field key={input.id} label={__ui(input.label)} htmlFor={input.id} help={__ui(input.help)} onFillExample={() => updateValue(input.id, getExampleValue(input, tool.id))}>
                <Input
                  id={input.id} type="number" step={input.step ?? "any"} min={input.min} max={input.max}
                  placeholder={__ui(input.placeholder)}
                  value={mergedValues[input.id] ?? ""}
                  onChange={(e) => updateValue(input.id, e.target.value)}
                />
              </Field>
            );
          }
          if (input.type === "color") {
            const curVal = mergedValues[input.id];
            const hexVal = (typeof curVal === "string" && curVal.trim()) ? curVal : "#ffffff";
            return (
              <Field key={input.id} label={__ui(input.label)} htmlFor={input.id} help={__ui(input.help)} onFillExample={() => updateValue(input.id, "#3b82f6")}>
                <div className="flex items-center gap-3">
                  <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-border">
                    <input
                      id={input.id}
                      type="color"
                      value={hexVal}
                      onChange={(e) => updateValue(input.id, e.target.value)}
                      className="absolute -inset-2 h-[calc(100%+1rem)] w-[calc(100%+1rem)] cursor-pointer border-0 bg-transparent p-0"
                    />
                  </div>
                  <Input
                    type="text"
                    value={curVal ?? ""}
                    placeholder={__ui("#ffffff 或留空保持透明")}
                    onChange={(e) => updateValue(input.id, e.target.value)}
                    className="font-mono text-sm"
                  />
                </div>
              </Field>
            );
          }
          if (input.type === "line") {
            // 单行文本：给"域名""短文本"这类只有一个词的输入用。
            // 与 url 的区别：不会触发浏览器对 <input type="url"> 的格式校验，
            // 所以 example.com 这种不带协议的域名也能正常提交。
            return (
              <Field key={input.id} label={__ui(input.label)} htmlFor={input.id} help={__ui(input.help)} onFillExample={() => updateValue(input.id, getExampleValue(input, tool.id))}>
                <div className="relative w-full">
                  <Input
                    id={input.id}
                    type="text"
                    placeholder={__ui(input.placeholder) ?? __ui("请输入内容")}
                    value={mergedValues[input.id] ?? ""}
                    onChange={(e) => updateValue(input.id, e.target.value)}
                    className="w-full h-12 pr-20 pl-4 rounded-xl text-sm"
                  />
                  <div className="absolute right-3 top-1/2 -translate-y-1/2">
                    <PasteButton onPaste={(text) => updateValue(input.id, text)} />
                  </div>
                </div>
              </Field>
            );
          }
          if (input.type === "text") {
            return (
              <Field key={input.id} label={__ui(input.label)} htmlFor={input.id} help={__ui(input.help)} onFillExample={() => updateValue(input.id, getExampleValue(input, tool.id))}>
                <div className="relative w-full">
                  <Textarea
                    id={input.id}
                    placeholder={__ui(input.placeholder) ?? __ui("输入要转换或计算的文本...")}
                    rows={5}
                    value={mergedValues[input.id] ?? ""}
                    onChange={(e) => updateValue(input.id, e.target.value)}
                    className="w-full min-h-[140px] pr-20 p-4 text-sm leading-relaxed rounded-2xl"
                  />
                  <div className="absolute right-3 top-3">
                    <PasteButton onPaste={(text) => updateValue(input.id, text)} />
                  </div>
                </div>
              </Field>
            );
          }
          return (
            <Field key={input.id} label={__ui(input.label)} htmlFor={input.id} help={__ui(input.help)} onFillExample={() => updateValue(input.id, getExampleValue(input, tool.id))}>
              <div className="relative w-full">
                <Input
                  id={input.id}
                  type={input.type === "url" ? "url" : "text"}
                  placeholder={__ui(input.placeholder) ?? __ui("请输入内容，可直接粘贴文字或链接")}
                  value={mergedValues[input.id] ?? ""}
                  onChange={(e) => updateValue(input.id, e.target.value)}
                  className="w-full h-12 pr-20 pl-4 rounded-xl text-sm"
                />
                <div className="absolute right-2.5 top-1/2 -translate-y-1/2">
                  <PasteButton onPaste={(text) => updateValue(input.id, text)} />
                </div>
              </div>
            </Field>
          );
        })}

        <Button type="submit" size="lg" disabled={loading} className={cn("shrink-0 whitespace-nowrap", loading && "animate-pulse-glow")}>
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          {loading ? __ui("执行中…") : __ui("开始执行")}
        </Button>
      </form>


      {error && tool.mode === "sync" && <Alert variant="destructive">{__msg(error)}</Alert>}

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
              {__ui("处理完成 ·")}{__msg(formatBytes(result.size))}
            </p>
            {result.kind === "text" && (
              <Button type="button" variant="ghost" size="sm" onClick={copyText} className="shrink-0 whitespace-nowrap">
                {copied ? <Check className="h-4 w-4 text-emerald-400" /> : <Copy className="h-4 w-4" />}
                {copied ? __ui("已复制") : __ui("复制")}
              </Button>
            )}
          </div>

          {result.kind === "file" && result.mimeType.startsWith("image/") && (
            <div className="space-y-3">
              {result.beforeUrl ? (
                <>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <figure className="space-y-1.5">
                      <figcaption className="text-[11px] text-muted-foreground">{__ui("处理前")}</figcaption>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={result.beforeUrl} alt={__ui("处理前")} className="w-full rounded-lg border border-border object-contain" />
                    </figure>
                    <figure className="space-y-1.5">
                      <figcaption className="text-[11px] text-primary">{__ui("处理后")}</figcaption>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={result.url} alt={__ui("处理后")} className="w-full rounded-lg border border-primary/40 object-contain" />
                    </figure>
                  </div>
                  {result.beforeSize !== undefined && <SizeComparison before={result.beforeSize} after={result.size} />}
                </>
              ) : (
                <figure className="space-y-1">
                  <figcaption className="text-[11px] text-primary">{__ui("结果预览")}</figcaption>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={result.url} alt={__ui("结果")} className="w-full rounded-lg border border-border" />
                </figure>
              )}
            </div>
          )}

          {result.kind === "file" && result.mimeType.startsWith("audio/") && <AudioPreview src={result.url || ""} name={result.filename} />}

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
            <Download className="h-4 w-4" /> {__ui("下载")}{result.filename}
          </a>
        </motion.div>
      )}

      {tool.mode === "async" && (
        <div className="relative overflow-visible">
          {jobConfetti > 0 && <Confetti key={jobConfetti} />}
          <JobProgress
            job={jobQuery.data ?? null}
            isLoading={loading || jobQuery.isLoading}
            error={
              error ??
              (jobQuery.isError
                ? "任务记录已失效（可能已被自动清理，或本机服务重启过）。请重新提交一次任务。"
                : undefined)
            }
            beforeUrl={beforePreviewUrl}
            beforeName={firstFile?.name}
            beforeSize={firstFile?.size}
            toolId={tool.id}
          />
        </div>
      )}
    </FormToolShell>
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
          <h3 className="text-base font-semibold text-foreground">{__ui("当前工具加载遇到了小异常")}</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {__msg(this.state.error?.message) || __ui("组件执行出错，可尝试点击重试或刷新页面")}
          </p>
          <div className="mt-4 flex justify-center gap-3">
            <Button
              size="sm"
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.reload();
              }}
            >
              {__ui("重新加载")}</Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}


/** 哪些工具可能用到按需下载的模型：用到就在该工具页里直接给下载入口，不必去设置里找 */
const TOOL_MODEL_NEEDS: Record<string, string[]> = {
  "bg-remove": ["isnet-matting"],
  "bg-replace": ["isnet-matting"],
  "id-photo": ["isnet-matting"],
  "precise-matting": ["isnet-matting"],
  "watermark-remove": ["lama-inpaint"],
  "ai-outpaint": ["lama-inpaint"],
  "vocal-separate": ["mdx-separation"],
  "colorize-photo": ["manga-colorize"],
  // ── FFmpeg 核心音视频处理引擎依赖工具 ──
  "screen-recorder": ["ffmpeg"],
  "video-format-convert": ["ffmpeg"],
  "video-compress": ["ffmpeg"],
  "video-trim": ["ffmpeg"],
  "video-to-gif": ["ffmpeg"],
  "video-frame-extract": ["ffmpeg"],
  "video-to-audio": ["ffmpeg"],
  "video-watermark-remove": ["ffmpeg"],
  "audio-format-convert": ["ffmpeg"],
  "audio-trim": ["ffmpeg"],
  "audio-merge": ["ffmpeg"],
  "audio-volume": ["ffmpeg"],
  "audio-reverse": ["ffmpeg"],
  "audio-transcribe": ["ffmpeg"],
  "media-info": ["ffmpeg"],
  "video-download": ["ffmpeg"],
  "bilibili-download": ["ffmpeg"],
  "twitter-download": ["ffmpeg"],
};

export function ToolShell({ tool, children }: { tool: Tool; children: React.ReactNode }) {
  const __locale = __useLanguage();
  const router = useRouter();
  const accent = CATEGORY_COLOR[tool.category] ?? "#0ea5e9";
  const ToolIcon = getToolIcon(tool.icon);
  const { recordTool } = useRecentTools();

  useEffect(() => {
    recordTool(tool.id);
  }, [tool.id, recordTool]);

  const handleBack = () => {
    try {
      sessionStorage.setItem("furina:restore_scroll", "1");
      const lastListUrl = window.history.state?.toolReturnTo || sessionStorage.getItem("furina:last_list_url");
      if (typeof lastListUrl === "string" && /^\/(?:\?|$|favorites(?:\?|$)|jobs(?:\?|$))/.test(lastListUrl)) {
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
    <motion.div initial={false} className="mx-auto max-w-[1200px] space-y-4 px-6 pb-6 pt-3 lg:px-8 lg:pb-8 lg:pt-3.5">
      {TOOL_MODEL_NEEDS[tool.id] ? <ToolModelDownloader ids={TOOL_MODEL_NEEDS[tool.id]} /> : null}
      {OFFICE_TOOL_NEEDS[tool.id] ? <OfficeRequirementBanner toolId={tool.id} /> : null}
      {/* 页面头：左边面包屑，右边工具名牌。
          名牌结构跟首页板块标题一致（一行标题 + 一行说明），只是整块右对齐：
          · 文字在内、图标在外贴最右，两行都靠右对齐，形成一条干净的右侧竖线；
          · 底色「左透明 → 右分类色」横向渐变，左边缘完全融进背景，不像一个方块贴上去；
          · 图标沿用首页工具卡片的语言（圆角方块 + 分类色低透明底 + 同色描边）。 */}
      <div className="flex flex-wrap items-center gap-3">
        <nav className="flex shrink-0 items-center gap-1.5 text-[12px] text-muted-foreground">
          <button
            onClick={handleBack}
            title={__ui("返回上一级（自动回到原浏览位置）")}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-card transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
          </button>
          <Link href="/" className="rounded px-1 hover:text-foreground">{__ui("首页")}</Link>
          <span className="opacity-50">/</span>
          <Link href={`/?c=${tool.category}`} className="rounded px-1 hover:text-foreground" style={{ color: accent }}>
            {__ui(CATEGORY_LABELS[tool.category])}
          </Link>
        </nav>
        <OpenOutputFolderButton />

        <div
          className="ml-auto flex shrink-0 items-center gap-2.5 rounded-2xl py-1 pl-10 pr-3"
          style={{ background: `linear-gradient(90deg, transparent 0%, ${accent}10 45%, ${accent}1c 100%)` }}
        >
          <h1 className="whitespace-nowrap text-[15px] font-semibold leading-tight tracking-tight">
            {tool.name}
          </h1>
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border"
            style={{ color: accent, background: `${accent}14`, borderColor: `${accent}33` }}
          >
            <ToolIcon className="h-4 w-4" strokeWidth={1.8} />
          </span>
        </div>
      </div>

      <ToolErrorBoundary>
        {children}
      </ToolErrorBoundary>
    </motion.div>
  );
}

function SizeComparison({ before, after }: { before: number; after: number }) {
  const __locale = __useLanguage();
  const delta = before > 0 ? ((after - before) / before) * 100 : 0;
  const smaller = after < before;
  const pct = before > 0 ? Math.min(100, (after / before) * 100) : 100;
  return (
    <div className="rounded-lg border border-border bg-background/60 p-3">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{__msg(formatBytes(before))} {__ui("· 处理前")}</span>
        <span className={cn("font-semibold", smaller ? "text-success" : delta === 0 ? "text-muted-foreground" : "text-amber-400")}>
          {delta === 0 ? __ui("无变化") : `${smaller ? "−" : "+"}${Math.abs(delta).toFixed(0)}%`}
        </span>
        <span className="text-foreground">{__msg(formatBytes(after))} {__ui("· 处理后")}</span>
      </div>
      <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
        <div className={cn("h-full rounded-full transition-all duration-700", smaller ? "bg-success" : "bg-amber-400")} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}


function getExampleValue(input: any, toolId?: string): string {
  if (input.example !== undefined && input.example !== null && String(input.example).trim()) {
    return String(input.example);
  }
  const ph = String(input.placeholder || "");
  const match = ph.match(/(?:例如|例|e\.g\.|eg)[:：]?\s*([^\s,，。]+)/i);
  if (match && match[1]) {
    return match[1].trim();
  }
  if (input.type === "number") {
    if (input.default !== undefined) return String(input.default);
    if (input.min !== undefined && input.max !== undefined) {
      return String(Math.round((Number(input.min) + Number(input.max)) / 2));
    }
    if (input.min !== undefined && Number(input.min) > 0) return String(input.min);
    return "10";
  }
  if (input.type === "color") return "#3b82f6";
  if (input.type === "url" || (input.type === "text" && ph.includes("http"))) {
    if (ph.includes("bilibili") || (toolId && toolId.includes("bilibili"))) {
      return "https://www.bilibili.com/video/BV1GJ411x7h7";
    }
    if (ph.includes("x.com") || ph.includes("twitter") || (toolId && toolId.includes("twitter"))) {
      return "https://x.com/OpenAI/status/1758192957386342735";
    }
    if (ph.includes("github") || (toolId && toolId.includes("github"))) {
      return "https://github.com/tauri-apps/tauri";
    }
    return "https://example.com";
  }
  const id = String(input.id || "").toLowerCase();
  const tid = String(toolId || "").toLowerCase();
  if (input.type === "line") {
    if (id.includes("domain") || id.includes("host") || id.includes("url")) return "example.com";
    if (id.includes("ip")) return "192.168.1.1";
    if (id.includes("port")) return "8080";
    if (id.includes("cron")) return "0 0 * * *";
    if (id.includes("regex") || id.includes("pattern")) return "^[a-zA-Z0-9_-]+$";
    return "FurinaKit-Demo";
  }
  if (id.includes("json") || tid.includes("json")) {
    return '{\n  "name": "FurinaKit",\n  "version": "2.1.0",\n  "desc": "纯净本地工具箱",\n  "tags": ["desktop", "tauri", "tools"]\n}';
  }
  if (id.includes("sql") || tid.includes("sql")) {
    return "SELECT id, title, created_at FROM articles WHERE status = 'published' ORDER BY created_at DESC LIMIT 10;";
  }
  if (id.includes("css") || tid.includes("css")) {
    return ".furina-card { display: flex; align-items: center; border-radius: 12px; padding: 16px; background: rgba(255, 255, 255, 0.05); }";
  }
  if (id.includes("html") || tid.includes("html") || id.includes("xml")) {
    return '<div class="furina-box">\n  <h1>芙芙工具箱</h1>\n  <p>纯净、高效的本地工具生态</p>\n</div>';
  }
  if (id.includes("markdown") || id.includes("md") || tid.includes("markdown")) {
    return "# 芙芙工具箱 2.1.0\n\n- 原生架构\n- 本地隐私\n- 极致性能\n\n> 一切为了更舒适的数字生活体验。";
  }
  if (id.includes("regex") || tid.includes("regex")) {
    return "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}";
  }
  if (id.includes("jwt") || tid.includes("jwt")) {
    return "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkZ1cmluYUtpdCIsImlhdCI6MTUxNjIzOTAyMn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
  }
  if (id.includes("cron") || tid.includes("cron")) {
    return "*/15 * * * *";
  }
  if (id.includes("base64") || tid.includes("base64")) {
    return "Hello, FurinaKit! 芙芙工具箱 2.1.0";
  }
  if (id.includes("diff") || tid.includes("diff") || tid.includes("compare")) {
    return "芙芙工具箱 2.1.0 发布说明：\n全面升级原生渲染架构，启动更快，内存占用降低 70%！";
  }
  return "芙芙工具箱（FurinaKit）—— 全能、轻量、纯净、无广告的本地工具箱！";
}
function Field({
  label, htmlFor, help, children, onFillExample,
}: {
  label: string;
  htmlFor?: string;
  help?: string;
  children: React.ReactNode;
  onFillExample?: () => void;
}) {
  const __locale = __useLanguage();
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={htmlFor}>{__ui(label)}</Label>
        {onFillExample && (
          <button
            type="button"
            onClick={onFillExample}
            className="inline-flex items-center gap-1 text-[11px] font-medium text-primary/80 hover:text-primary transition-colors cursor-pointer select-none"
            title="一键填入测试示例"
          >
            <Sparkles className="h-3 w-3" />
            <span>{__ui("填入示例")}</span>
          </button>
        )}
      </div>
      {children}
      {help && <p className="text-[11px] leading-relaxed text-muted-foreground/80">{__ui(help)}</p>}
    </div>
  );
}
