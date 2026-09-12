import { NextResponse } from "next/server";
import { downloadsEnabled } from "@furinakit/shared";
import { listRecentJobs } from "@/lib/jobs";
import { guardApiRequest } from "@/lib/api-guard";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const denied = guardApiRequest(request);
  if (denied) return denied;
  if (!downloadsEnabled()) {
    return NextResponse.json({ jobs: [], disabled: true });
  }
  const jobs = await listRecentJobs(50);
  return NextResponse.json({ jobs });
}
