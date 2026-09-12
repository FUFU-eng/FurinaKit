import { NextResponse } from "next/server";
import fs from "fs/promises";
import path from "path";
import { getStoragePath } from "@/lib/storage";
import { guardApiRequest } from "@/lib/api-guard";

export const dynamic = "force-dynamic";

interface FeedbackPayload {
  content: string;
  category?: string;
  contact?: string;
  version?: string;
  os?: string;
}

export async function POST(req: Request) {
  const denied = guardApiRequest(req);
  if (denied) return denied;
  try {
    const body: FeedbackPayload = await req.json();
    const content = (body.content || "").trim();

    if (!content) {
      return NextResponse.json(
        { success: false, error: "反馈内容不能为空" },
        { status: 400 }
      );
    }

    const category = body.category || "功能建议";
    const contact = (body.contact || "").trim();
    const version = body.version || "2.0.4";
    const os = body.os || "Windows";
    const now = new Date().toISOString();

    // 1. 无感推送到全球云端建议看板 (ntfy.sh)
    try {
      const topic = "furinakit_feedback_hq";
      const title = `【芙芙工具箱】[${category}] 新建议到达`;
      const message = `${content}\n\n━━━━━━━━━━━━━━━\n🏷️ 类别: ${category}\n📱 联系方式: ${contact || "未填写"}\n💻 环境: ${os} | 版本: v${version}\n⏰ 时间: ${new Date().toLocaleString("zh-CN")}`;

      fetch(`https://ntfy.sh/${topic}`, {
        method: "POST",
        headers: {
          Title: encodeURIComponent(title),
          Priority: "default",
          Tags: "sparkles,speech_balloon",
          Cache: "yes",
        },
        body: message,
      }).catch(() => {});
    } catch {}

    // 2. 本地持久化留底
    try {
      const storagePath = getStoragePath();
      await fs.mkdir(storagePath, { recursive: true });
      const feedbackFile = path.join(storagePath, "feedback_history.json");

      let history: Array<FeedbackPayload & { timestamp: string }> = [];
      try {
        const raw = await fs.readFile(feedbackFile, "utf-8");
        history = JSON.parse(raw);
        if (!Array.isArray(history)) history = [];
      } catch {}

      history.unshift({
        content,
        category,
        contact,
        version,
        os,
        timestamp: now,
      });

      // 仅保留最近 200 条
      if (history.length > 200) history = history.slice(0, 200);

      await fs.writeFile(feedbackFile, JSON.stringify(history, null, 2), "utf-8");
    } catch {}

    return NextResponse.json({
      success: true,
      message: "芙芙已经收到你的宝贵建议啦！会认真评估并持续努力的~",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "提交异常";
    return NextResponse.json(
      { success: false, error: message },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  const denied = guardApiRequest(request);
  if (denied) return denied;
  try {
    const storagePath = getStoragePath();
    const feedbackFile = path.join(storagePath, "feedback_history.json");
    const raw = await fs.readFile(feedbackFile, "utf-8");
    const history = JSON.parse(raw);
    return NextResponse.json({ success: true, history });
  } catch {
    return NextResponse.json({ success: true, history: [] });
  }
}
