import { z } from "zod";

export const toolCategories = [
  "image",
  "download",
  "audio",
  "pdf",
  "text",
  "mathcalc",
  "dev",
  "security",
  "utility",
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
  resultMimeType: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  expiresAt: z.string().optional(),
});

export type Job = z.infer<typeof JobSchema>;

export const CATEGORY_LABELS: Record<ToolCategory, string> = {
  image: "图片工具",
  download: "视频工具",
  audio: "音频工具",
  pdf: "PDF 工具",
  text: "文本工具",
  mathcalc: "数理工具",
  dev: "开发工具",
  security: "编码安全",
  utility: "生活办公",
};

export const CATEGORY_DESCRIPTIONS: Record<ToolCategory, string> = {
  image: "图片格式转换、压缩、裁剪、抠图、强化与水印等图像处理",
  download: "网页与各平台视频下载、格式转换、码率压缩与动图制作",
  audio: "音频提取、格式互转、无缝拼接、音量调节与音频倒放",
  pdf: "PDF 与文档互转、合并、拆分、压缩、页面管理与加密解密",
  text: "文字统计与校对、格式互转、排版美化、Markdown 与多语言翻译",
  mathcalc: "科学计算器与高等数学运算、几何图形计算，以及单位、日期与财务计算",
  dev: "代码格式化与压缩、正则与时间戳、JSON/CSV 数据格式互转、域名与网络查询",
  security: "Base64 与 URL 编解码、哈希与校验、对称加密、密码生成与压缩包找回",
  utility: "计时与番茄钟、二维码、跨设备互传、健康与趣味小工具，以及图表、思维导图与设计素材",
};
