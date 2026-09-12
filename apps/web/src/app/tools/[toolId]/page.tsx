import { notFound } from "next/navigation";
import { getToolById, downloadsEnabled } from "@furinakit/shared";
import { ToolRunner } from "@/components/tools/tool-runner";

type ToolPageProps = {
  params: Promise<{ toolId: string }>;
};

export default async function ToolPage({ params }: ToolPageProps) {
  const { toolId } = await params;
  const tool = getToolById(toolId);

  if (!tool || tool.comingSoon || (tool.selfHostOnly && !downloadsEnabled())) {
    notFound();
  }

  // key={toolId}：让每个工具都当作「全新组件」挂载，而不是复用同一个组件只换内容。
  // 复用的话，上一个工具残留在组件内部的状态有可能漏到下一个工具里
  // （用户之前看到「工具 B 的页面上出现工具 A 的结果」就是这个原因）。
  // 加了 key 之后每个工具天然隔离；而「切走再回来内容还在」由 tool-runner 里的
  // 按工具草稿缓存（toolDraftCache / useToolDraft）负责，不依赖组件复用。
  return <ToolRunner key={toolId} toolId={toolId} />;
}
