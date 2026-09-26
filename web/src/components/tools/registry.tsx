import {FunctionWorkspace} from "./function-workspace";
import {GeometryWorkspace} from "./geometry-workspace";
import {TextTransformWorkspace,TextOrganizerWorkspace} from "./text-workspaces";
import { RenameWorkspace } from "./rename-workspace";
import { QrWorkspace } from "./qr-workspace";
import { QrGeneratorTool } from "./qr-generator-tool";
import { LoremGenTool } from "./lorem-gen-tool";
import { PaletteWorkspace } from "./palette-workspace";
import {CalendarWorkspace} from "./combined-workspaces";
import {FancyWorkspace} from "./fancy-workspace";
// 鑷姩鐢熸垚锛氭妸鎼繃鏉ョ殑宸ュ叿缁勪欢鐧昏璧锋潵锛堢敱 assemble 鑴氭湰鐢熸垚锛屽嬁鎵嬫敼锛?

import { ToolPreview } from "./_tool-preview";
import { AdvancedMathTool } from "./advanced-math-tools";
import { AiPptDraftTool } from "./ai-ppt-tools";
import { AiConfigPanel, AiPolishTool, AiTranslateTool, AiDocumentTool, AiTableTool } from "./ai-tools";
import { ArchprTool } from "./archpr-tool";
import { AudioTranscribeTool } from "./audio-transcribe-tool";
import { Base64Tool } from "./base64-tool";
import { BeforeAfterSlider } from "./before-after-slider";
import { BgRemoveTool } from "./bg-remove-tool";
import { BgReplaceTool } from "./bg-replace-tool";
import { BpmDetectTool } from "./bpm-detect-tool";
import { AdvancedCalculatorTool } from "./calculator-tool";
import { ChecksumStudioTool } from "./checksum-studio-tool";
import { ClipboardHistoryTool } from "./clipboard-history-tool";
import { ColorConverterTool } from "./color-converter-tool";
import { ColorExtractTool } from "./color-extract-tool";
import { ColorReplaceTool } from "./color-replace-tool";
import { ColorSpaceLabTool } from "./color-space-lab";
import { CopyButton } from "./copy-button";
import { CharsetDetectTool, EncodingRepairTool } from "./encoding-tools";
import { CssStudioTool } from "./css-studio-tool";
import { CssFormatterTool, SqlFormatterTool, CodeMinifyTool, JsonSchemaTool } from "./dev-code-tools";
import { CssGradientTool, SvgOptimizeTool, AsciiArtTool } from "./dev-format-tools";
import { BigFileScanTool } from "./disk-cleanup-tools";
import { EmptyDropzone } from "./dropzone-empty";
import { EncoderStudioTool } from "./encoder-studio-tool";
import { ChineseConverterTool, SpeedTestTool, ColorPaletteTool, MediaTrackerTool } from "./extra-tools";
import { FileDropzone } from "./file-dropzone";
import { FileHideImageTool } from "./file-hide-image-tool";
import { JsonYamlTool, JsonXmlTool, JsonCsvTool } from "./format-convert-tools";
import { PomodoroTool, BusinessCardTool, WordCloudTool, PerlerBeadsTool } from "./fun-tools";
import { FunctionCalculatorTool } from "./function-calculator-tool";
import { GeometryCalculatorTool } from "./geometry-tools";
import { ImageCompressTool } from "./image-compress-tool";
import { ImageCropTool } from "./image-crop-tool";
import { ImageDedupTool } from "./image-dedup-tool";
import { ImageMergeTool } from "./image-merge-tool";
import { ImageObfuscateTool } from "./image-obfuscate-tool";
import { ImageResizeTool } from "./image-resize-tool";
import { ImageSplitTool } from "./image-split-tool";
import { ImageUpscaleTool } from "./image-upscale-tool";
import { ImagesToPdfTool } from "./images-to-pdf-tool";
import { JobProgress } from "./job-progress";
import { JsonFormatterTool } from "./json-formatter-tool";
import { JsonStudioTool } from "./json-studio-tool";
import { JwtDecoderTool } from "./jwt-decoder-tool";
import { LanTransferTool } from "./lan-transfer-tool";
import { BodyFatTool, InterestTool } from "./life-calc-tools";
import { MagnetDownloadTool } from "./magnet-download-tool";
import { MarkdownPreviewTool } from "./markdown-preview-tool";
import { FunctionGraphTool } from "./math-graph-tools";
import { VideoTrimTool, AudioTrimTool, VideoThumbnailTool, CsvExcelTool, MarkdownToPdfTool } from "./media-sheet-tools";
import { MindMapTool } from "./mind-map";
import { NetQueryTool } from "./net-query-tool";
import { DnsLookupTool, SslCheckerTool, UrlParserTool, ImageExifTool } from "./net-query-tools";
import { PdfCropTool } from "./pdf-crop-tool";
import { PdfEditorTool } from "./pdf-editor-tool";
import { PdfToImagesTool } from "./pdf-to-images-tool";
import { RegexTesterTool } from "./regex-tester-tool";
import { FloatingScreenshotTool } from "./floating-screenshot-tool";
import { ScreenRecorderTool } from "./screen-recorder-tool";
import { ScreenshotOcrTool } from "./screenshot-ocr-tool";
import { SignatureDesignerTool } from "./signature-tool";
import { RmbUppercaseTool, LoanCalculatorTool, BmiCalculatorTool, BaseConverterTool, WordCountTool, TextDedupTool, MorseCodeTool, CaesarCipherTool, UuidGeneratorTool, TimestampConverterTool, PasswordGeneratorTool, RandomNumberTool, SimpleCalculatorTool, DateCalculatorTool, NumberSumTool, TextReplaceTool, FullwidthHalfwidthTool, AesEncryptTool, RomanNumeralTool, CrontabGeneratorTool, IncomeTaxCalculatorTool, CreditCardCalculatorTool, EnglishAmountUppercaseTool, NumberEnglishTool, ExchangeRateTool, LunarCalendarTool, TextCompareTool, FancyTextTool, PinyinConverterTool, ShaHashTool, UnicodeConverterTool, GuidGeneratorTool, JsonToTsTool, UserAgentAnalyzerTool, QrDecoderTool, PeriodicTableTool, ImageBase64Tool, CrcChecksumTool, FileHexTool, SpecialSymbolsTool, BatchRenameTool, JsFormatterTool, HtmlFormatterTool, CaseConverterTool, DateConverterTool, IpConverterTool, HttpStatusTool, ScatterChartTool, PieChartTool, LineChartTool, BarChartTool } from "./simple-tools";
import { SortableToolGrid } from "./sortable-grid";
import { AdminNotice, SystemOverviewTool, CpuMemoryTool, GpuDisplayTool, BoardFirmwareTool, StorageHealthTool, NetworkDeviceTool, PowerSensorTool } from "./system-info-tools";
import { TaxCalculatorTool } from "./tax-calculator-tool";
import { TeleprompterTool } from "./teleprompter-tool";
import { TextLinesTool } from "./text-lines-tools";
import { TimeToolboxTool } from "./time-toolbox-tools";
import { ToolModelDownloader } from "./tool-model-downloader";
import { ToolSearch } from "./tool-search";
import { TradeCalculatorTool } from "./trade-calculator-tools";
import { TranslatorTool } from "./translate-tools";
import { TypingTestTool } from "./typing-test-tool";
import { UnitConvertTool } from "./unit-convert-tools";
import { UrlCodecTool } from "./url-codec-tool";
import { VideoDownloadTool } from "./video-download-tool";
import { WatermarkRemoverTool } from "./watermark-remover-tool";
import { WatermarkTool } from "./watermark-tool";

export const COMPONENTS: Record<string, React.ComponentType<any>> = {
  ToolPreview: ToolPreview,
  AdvancedMathTool: AdvancedMathTool,
  AiPptDraftTool: AiPptDraftTool,
  AiConfigPanel: AiConfigPanel,
  AiPolishTool: AiPolishTool,
  AiTranslateTool: AiTranslateTool,
  AiDocumentTool: AiDocumentTool,
  AiTableTool: AiTableTool,
  ArchprTool: ArchprTool,
  AudioTranscribeTool: AudioTranscribeTool,
  Base64Tool: Base64Tool,
  BeforeAfterSlider: BeforeAfterSlider,
  BgRemoveTool: BgRemoveTool,
  BgReplaceTool: BgReplaceTool,
  BpmDetectTool: BpmDetectTool,
  AdvancedCalculatorTool: AdvancedCalculatorTool,
  ChecksumStudioTool: ChecksumStudioTool,
  ClipboardHistoryTool: ClipboardHistoryTool,
  ColorConverterTool: ColorConverterTool,
  ColorExtractTool: ColorExtractTool,
  ColorReplaceTool: ColorReplaceTool,
  ColorSpaceLabTool: ColorSpaceLabTool,
  CopyButton: CopyButton,
  CharsetDetectTool: CharsetDetectTool,
  EncodingRepairTool: EncodingRepairTool,
  CssStudioTool: CssStudioTool,
  CssFormatterTool: CssFormatterTool,
  SqlFormatterTool: SqlFormatterTool,
  CodeMinifyTool: CodeMinifyTool,
  JsonSchemaTool: JsonSchemaTool,
  CssGradientTool: CssGradientTool,
  SvgOptimizeTool: SvgOptimizeTool,
  AsciiArtTool: AsciiArtTool,
  BigFileScanTool: BigFileScanTool,
  EmptyDropzone: EmptyDropzone,
  EncoderStudioTool: EncoderStudioTool,
  ChineseConverterTool: TextTransformWorkspace,
  SpeedTestTool: SpeedTestTool,
  ColorPaletteTool: PaletteWorkspace,
  MediaTrackerTool: MediaTrackerTool,
  FileDropzone: FileDropzone,
  FileHideImageTool: FileHideImageTool,
  JsonYamlTool: JsonYamlTool,
  JsonXmlTool: JsonXmlTool,
  JsonCsvTool: JsonCsvTool,
  PomodoroTool: PomodoroTool,
  BusinessCardTool: BusinessCardTool,
  WordCloudTool: WordCloudTool,
  PerlerBeadsTool: PerlerBeadsTool,
  FunctionCalculatorTool: FunctionWorkspace,
  GeometryCalculatorTool: GeometryWorkspace,
  ImageCompressTool: ImageCompressTool,
  ImageCropTool: ImageCropTool,
  ImageDedupTool: ImageDedupTool,
  ImageMergeTool: ImageMergeTool,
  ImageObfuscateTool: ImageObfuscateTool,
  ImageResizeTool: ImageResizeTool,
  ImageSplitTool: ImageSplitTool,
  ImageUpscaleTool: ImageUpscaleTool,
  ImagesToPdfTool: ImagesToPdfTool,
  ImageToPdfTool: ImagesToPdfTool,
  JobProgress: JobProgress,
  JsonFormatterTool: JsonFormatterTool,
  JsonStudioTool: JsonStudioTool,
  JwtDecoderTool: JwtDecoderTool,
  LanTransferTool: LanTransferTool,
  BodyFatTool: BodyFatTool,
  InterestTool: InterestTool,
  MagnetDownloadTool: MagnetDownloadTool,
  MarkdownPreviewTool: MarkdownPreviewTool,
  FunctionGraphTool: FunctionGraphTool,
  VideoTrimTool: VideoTrimTool,
  AudioTrimTool: AudioTrimTool,
  VideoThumbnailTool: VideoThumbnailTool,
  CsvExcelTool: CsvExcelTool,
  MarkdownToPdfTool: MarkdownToPdfTool,
  MindMapTool: MindMapTool,
  NetQueryTool: NetQueryTool,
  DnsLookupTool: DnsLookupTool,
  SslCheckerTool: SslCheckerTool,
  UrlParserTool: UrlParserTool,
  ImageExifTool: ImageExifTool,
  PdfCropTool: PdfCropTool,
  PdfEditorTool: PdfEditorTool,
  PdfToImagesTool: PdfToImagesTool,
  RegexTesterTool: RegexTesterTool,
  FloatingScreenshotTool: FloatingScreenshotTool,
  ScreenRecorderTool: ScreenRecorderTool,
  ScreenshotOcrTool: ScreenshotOcrTool,
  SignatureDesignerTool: SignatureDesignerTool,
  RmbUppercaseTool: RmbUppercaseTool,
  LoanCalculatorTool: LoanCalculatorTool,
  BmiCalculatorTool: BmiCalculatorTool,
  BaseConverterTool: BaseConverterTool,
  WordCountTool: WordCountTool,
  TextDedupTool: TextDedupTool,
  MorseCodeTool: MorseCodeTool,
  CaesarCipherTool: CaesarCipherTool,
  UuidGeneratorTool: UuidGeneratorTool,
  TimestampConverterTool: TimestampConverterTool,
  PasswordGeneratorTool: PasswordGeneratorTool,
  RandomNumberTool: RandomNumberTool,
  SimpleCalculatorTool: SimpleCalculatorTool,
  DateCalculatorTool: CalendarWorkspace,
  NumberSumTool: NumberSumTool,
  TextReplaceTool: TextReplaceTool,
  FullwidthHalfwidthTool: TextTransformWorkspace,
  AesEncryptTool: AesEncryptTool,
  RomanNumeralTool: RomanNumeralTool,
  CrontabGeneratorTool: CrontabGeneratorTool,
  IncomeTaxCalculatorTool: IncomeTaxCalculatorTool,
  TaxCalculatorTool: TaxCalculatorTool,
  CreditCardCalculatorTool: CreditCardCalculatorTool,
  NumberEnglishTool: NumberEnglishTool,
  ExchangeRateTool: ExchangeRateTool,
  TextCompareTool: TextCompareTool,
  FancyTextTool: FancyWorkspace,
  PinyinConverterTool: TextTransformWorkspace,
  ShaHashTool: ShaHashTool,
  UnicodeConverterTool: UnicodeConverterTool,
  GuidGeneratorTool: GuidGeneratorTool,
  JsonToTsTool: JsonToTsTool,
  UserAgentAnalyzerTool: UserAgentAnalyzerTool,
  QrDecoderTool: QrWorkspace,
  QrGeneratorTool: QrGeneratorTool,
  LoremGenTool: LoremGenTool,
  PeriodicTableTool: PeriodicTableTool,
  ImageBase64Tool: ImageBase64Tool,
  CrcChecksumTool: CrcChecksumTool,
  FileHexTool: FileHexTool,
  SpecialSymbolsTool: SpecialSymbolsTool,
  BatchRenameTool: RenameWorkspace,
  JsFormatterTool: JsFormatterTool,
  HtmlFormatterTool: HtmlFormatterTool,
  CaseConverterTool: TextTransformWorkspace,
  IpConverterTool: IpConverterTool,
  HttpStatusTool: HttpStatusTool,
  ScatterChartTool: ScatterChartTool,
  PieChartTool: PieChartTool,
  LineChartTool: LineChartTool,
  BarChartTool: BarChartTool,
  SortableToolGrid: SortableToolGrid,
  AdminNotice: AdminNotice,
  SystemOverviewTool: SystemOverviewTool,
  CpuMemoryTool: CpuMemoryTool,
  GpuDisplayTool: GpuDisplayTool,
  BoardFirmwareTool: BoardFirmwareTool,
  StorageHealthTool: StorageHealthTool,
  NetworkDeviceTool: NetworkDeviceTool,
  PowerSensorTool: PowerSensorTool,
  TeleprompterTool: TeleprompterTool,
  TextLinesTool: TextOrganizerWorkspace,
  TextTransformTool: TextTransformWorkspace,
  TimeToolboxTool: TimeToolboxTool,
  ToolModelDownloader: ToolModelDownloader,
  ToolSearch: ToolSearch,
  TranslatorTool: TranslatorTool,
  TypingTestTool: TypingTestTool,
  UnitConvertTool: UnitConvertTool,
  UrlCodecTool: UrlCodecTool,
  VideoDownloadTool: VideoDownloadTool,
  WatermarkRemoverTool: WatermarkRemoverTool,
  WatermarkTool: WatermarkTool,
};

// 宸ュ叿 id 鈫?缁勪欢锛氭寜"缁勪欢鍚嶆垨鏂囦欢鍚嶉噷鍖呭惈宸ュ叿鍏抽敭瀛?鏉ュ尮閰嶏紙鎼繃鏉ョ殑缁勪欢鍛藉悕鍩烘湰璺熷伐鍏?id 瀵瑰緱涓婏級
export function findComponent(toolId: string): React.ComponentType<any> | undefined {
  if (toolId === "image-to-pdf" || toolId === "images-to-pdf") {
    return COMPONENTS.ImagesToPdfTool;
  }
  const key = toolId.replace(/-/g, "").toLowerCase();
  for (const [name, comp] of Object.entries(COMPONENTS)) {
    const n = name.replace(/-/g, "").toLowerCase();
    if (n.startsWith(key) || n.includes(key)) return comp;
  }
  // Plural/singular fallback (e.g. image -> images or images -> image)
  const altKey = key.startsWith("image") && !key.startsWith("images")
    ? "images" + key.slice(5)
    : key.startsWith("images")
    ? "image" + key.slice(6)
    : key;
  if (altKey !== key) {
    for (const [name, comp] of Object.entries(COMPONENTS)) {
      const n = name.replace(/-/g, "").toLowerCase();
      if (n.startsWith(altKey) || n.includes(altKey)) return comp;
    }
  }
  return undefined;
}