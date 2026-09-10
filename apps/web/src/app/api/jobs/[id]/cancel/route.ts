import { NextRequest, NextResponse } from "next/server";
import { cancelJob, getJob } from "@/lib/jobs";
import { cancelMagnetJob } from "@/lib/magnet-downloader";

export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    const job = await getJob(id);
    
    if (!job) {
      return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    }
    
    if (job.toolId === "magnet-download") {
      cancelMagnetJob(id);
    }

    const cancelled = await cancelJob(id);
    return NextResponse.json({ job: cancelled, success: true });
  } catch (err) {
    console.error("[jobs/cancel] error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "取消失败" },
      { status: 500 }
    );
  }
}
