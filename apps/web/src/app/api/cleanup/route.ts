import { NextResponse } from "next/server";
import { downloadsEnabled } from "@furinakit/shared";
import { cleanupExpiredFiles } from "@/lib/storage";
import { guardApiRequest } from "@/lib/api-guard";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const denied = guardApiRequest(request);
  if (denied) return denied;
  if (!downloadsEnabled()) {
    return NextResponse.json({ ok: true, skipped: true });
  }
  await cleanupExpiredFiles();
  return NextResponse.json({ ok: true });
}
