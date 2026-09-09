import { NextResponse } from "next/server";
import { downloadsEnabled } from "@furinakit/shared";
import { getJob } from "@/lib/jobs";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  if (!downloadsEnabled()) {
    return NextResponse.json({ error: "Jobs are disabled on this deployment" }, { status: 404 });
  }
  const { id } = await context.params;
  const job = await getJob(id);

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({ job });
}
