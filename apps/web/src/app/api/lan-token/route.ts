import { NextResponse } from "next/server";
import { guardApiRequest, getLanToken } from "@/lib/api-guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 把本次启动的局域网互传令牌交给界面，用于生成带令牌的二维码。
 *
 * 这个接口刻意不开放给局域网：guardApiRequest 默认只放行「本机 + 同源」的请求，
 * 所以只有 FurinaKit 自己的界面能读到它；用户浏览器里的恶意网页会因跨站被拒。
 */
export async function GET(request: Request) {
  const denied = guardApiRequest(request);
  if (denied) return denied;
  return NextResponse.json({ token: getLanToken() });
}
