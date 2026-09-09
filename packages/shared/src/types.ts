import { z } from "zod";

export const toolCategories = [
  "image",
  "pdf",
  "download",
  "audio",
  "text",
  "dev",
  "encode",
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

export const toolInputTypes = ["file", "url", "text", "select", "number", "color"] as const;
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
  pdf: "PDF 工具",
  download: "视频工具",
  audio: "音频工具",
  text: "文本办公",
  dev: "开发运维",
  encode: "密码编码",
  utility: "实用生活",
};

export const CATEGORY_DESCRIPTIONS: Record<ToolCategory, string> = {
  image: "图片格式转换、压缩、裁剪、抠图、强化与水印等图像处理",
  pdf: "PDF 与文档互转、合并、拆分、压缩、页面管理与加密解密",
  download: "网页与各平台视频下载、格式转换、码率压缩与动图制作",
  audio: "音频提取、格式互转、无缝拼接、音量调节与音频倒放",
  text: "字数统计、文本对比查重、内容替换、思维导图与数据图表制作",
  dev: "JSON/JS/HTML 格式化、正则测试、JWT 解析、时间戳与网络查询",
  encode: "Base64、URL 编解码、哈希计算、密码生成、对称加解密与进制转换",
  utility: "ARCHPR 压缩包密码恢复、二维码、批量重命名、财务与生活便民计算",
};
