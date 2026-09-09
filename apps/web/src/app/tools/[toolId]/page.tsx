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

  return <ToolRunner toolId={toolId} />;
}
