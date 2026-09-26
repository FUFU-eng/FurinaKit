"use client";

import type { OmniTool, ToolCategory } from "@furinakit/shared";
import { ToolShell } from "@/components/tools/tool-runner";

/**
 * 开发期预览壳（仅用于新工具接入工具表之前的自查，不属于产品功能）。
 *
 * 新工具在写进 `packages/shared/src/tools.ts` 之前是没有 `/tools/<id>` 路由的，
 * 但「工具长什么样」必须在**真实的外壳上下文里**才判断得准（面包屑 + 标题卡 +
 * 内容区宽度都要对得上）。所以这里直接复用真实的外壳 `ToolShell`，
 * 只把工具元数据喂给它，让组件摆在和上线后一模一样的位置上。
 *
 * 正式接入后请删除对应的 `src/app/preview-xxx/` 临时路由。
 */
export function ToolPreview({
  id,
  name,
  description,
  category,
  icon = "Sparkles",
  children,
}: {
  id: string;
  name: string;
  description: string;
  category: ToolCategory;
  icon?: string;
  children: React.ReactNode;
}) {
  const tool: OmniTool = {
    id,
    name,
    description,
    category,
    mode: "sync",
    icon,
    inputs: [],
    clientSide: true,
  };
  return <ToolShell tool={tool}>{children}</ToolShell>;
}
