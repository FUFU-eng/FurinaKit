import { NextResponse } from "next/server";
import { downloadsEnabled } from "@furinakit/shared";
import { listRecentJobs } from "@/lib/jobs";

export const runtime = "nodejs";

export async function GET() {
  if (!downloadsEnabled()) {
    return NextResponse.json({ jobs: [], disabled: true });
  }
  const jobs = await listRecentJobs(50);
  return NextResponse.json({ jobs });
}
