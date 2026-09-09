import { NextResponse } from "next/server";
import { downloadsEnabled } from "@furinakit/shared";
import { cleanupExpiredFiles } from "@/lib/storage";

export const runtime = "nodejs";

export async function POST() {
  if (!downloadsEnabled()) {
    return NextResponse.json({ ok: true, skipped: true });
  }
  await cleanupExpiredFiles();
  return NextResponse.json({ ok: true });
}
