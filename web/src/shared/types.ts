import { tr } from "@/lib/language";

import { createUiText as __createUiText } from "@/lib/language";
const __ui = __createUiText("shared/types.ts");
import { z } from "zod";

export const toolCategories = [
  "image",
  "download",
  "audio",
  "pdf",
  "utility",
  "text",
  "mathcalc",
  "dev",
  "security",
  "hardware",
  "ai",
] as const;

export type ToolCategory = (typeof toolCategories)[number];

export const jobStatuses = [
  "pending",
  "processing",
  "completed",
  "failed",
] as const;

export type JobStatus = (typeof jobStatuses)[number];

export const toolInputTypes = ["file", "url", "text", "line", "select", "number", "color"] as const;
export type ToolInputType = (typeof toolInputTypes)[number];

export const ToolInputSchema = z.object({
  id: z.string(),
  type: z.enum(toolInputTypes),
  label: z.string(),
  placeholder: z.string().optional(),
  required: z.boolean().default(true),
  multiple: z.boolean().optional(),
  accept: z.string().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  help: z.string().optional(),
  options: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  defaultValue: z.union([z.string(), z.number()]).optional(),
  /**
   * 条件必填：只有当另一个字段等于指定值时，这一项才必填。
   * 例：黑白上色的「彩色参考图」只有在「上色方式 = 参考图」时才必填。
   */
  requiredWhen: z.object({ field: z.string(), value: z.string() }).optional(),
});

export type ToolInput = z.infer<typeof ToolInputSchema>;

export const OmniToolSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.enum(toolCategories),
  mode: z.enum(["sync", "async"]),
  icon: z.string(),
  inputs: z.array(ToolInputSchema),
  disclaimer: z.string().optional(),
  comingSoon: z.boolean().optional(),
  /** Async tools that require the self-hosted Python worker; hidden on Vercel. */
  selfHostOnly: z.boolean().optional(),
  /** Memory-hungry worker tools (e.g. rembg AI models); hidden on low-RAM self-host deployments. */
  heavyWorkerOnly: z.boolean().optional(),
  /** Runs entirely in the browser (no API round-trip), e.g. pdf-to-images. */
  clientSide: z.boolean().optional(),
  /** Short tagline shown on the tool card / runner header. */
  badge: z.string().optional(),
  /** 二级子分类（主要用于“其他工具”板块内部的分组）。 */
  subcategory: z.string().optional(),
});

export type OmniTool = z.infer<typeof OmniToolSchema>;

export const CreateJobSchema = z.object({
  toolId: z.string(),
  payload: z.record(z.unknown()),
});

export type CreateJobRequest = z.infer<typeof CreateJobSchema>;

export const JobSchema = z.object({
  id: z.string(),
  toolId: z.string(),
  status: z.enum(jobStatuses),
  progress: z.number().min(0).max(100),
  message: z.string().optional(),
  error: z.string().optional(),
  resultFilename: z.string().optional(),
  textResultFilename: z.string().nullable().optional(),
  resultMimeType: z.string().optional(),
  audioStems: z.boolean().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  expiresAt: z.string().optional(),
});

export type Job = z.infer<typeof JobSchema>;

export const CATEGORY_LABELS: Record<ToolCategory, string> = {
  get "image"() { return __ui("图片工具"); },
  get "download"() { return __ui("视频工具"); },
  get "audio"() { return __ui("音频工具"); },
  get "pdf"() { return __ui("文档工具"); },
  get "utility"() { return __ui("生活办公"); },
  get "text"() { return __ui("文本工具"); },
  get "mathcalc"() { return __ui("数理计算"); },
  get "dev"() { return __ui("开发工具"); },
  get "security"() { return __ui("编码安全"); },
  get "hardware"() { return __ui("系统工具"); },
  get "ai"() { return __ui("AI 工具"); },
};

export const CATEGORY_DESCRIPTIONS: Record<ToolCategory, string> = {
  get "image"() { return __ui("图片格式转换、压缩、裁剪、抠图、强化与水印等图像处理"); },
  get "download"() { return __ui("网页与各平台视频下载、格式转换、码率压缩与动图制作"); },
  get "audio"() { return __ui("音频提取、格式互转、无缝拼接、音量调节与音频倒放"); },
  get "pdf"() { return __ui("PDF 与文档互转、合并、拆分、压缩、页面管理与加密解密"); },
  get "utility"() { return tr("跨设备互传、批量重命名、思维导图、便签、创意设计与生活办公", "Cross-device transfer, batch renaming, mind maps, notes, creative design and everyday utilities"); },
  get "text"() { return __ui("文字统计与校对、格式互转、排版美化、Markdown 与多语言翻译"); },
  get "mathcalc"() { return __ui("科学与函数计算、高等数学、几何、图表、单位及财务计算"); },
  get "dev"() { return __ui("代码格式化与压缩、正则与时间戳、JSON/CSV 数据格式互转、域名与网络查询"); },
  get "hardware"() { return tr("设备概况、硬件与系统诊断、磁盘占用只读排查", "Device overview, hardware and system diagnostics, and read-only disk usage inspection"); },
  get "ai"() { return __ui("调用你配置的模型服务做文字润色、翻译、文档与表格生成"); },
  get "security"() { return __ui("Base64 与 URL 编解码、哈希与校验、对称加密、密码生成与压缩包找回"); },
};
