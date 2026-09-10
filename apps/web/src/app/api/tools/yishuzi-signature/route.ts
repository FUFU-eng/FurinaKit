import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      name = "芙宁娜",
      fontId = "901",
      fontColor = "#0000FF",
      bgColor = "#FFFFFE",
    } = body;

    const trimmedName = (name || "").trim().slice(0, 20);
    if (!trimmedName) {
      return NextResponse.json({ error: "请输入姓名或文字" }, { status: 400 });
    }

    const params = new URLSearchParams();
    params.append("id", trimmedName);
    params.append("zhenbi", "20191123");
    params.append("id2", String(fontId || "901"));
    params.append("id4", "#000000");
    params.append("id5", fontColor || "#0000FF");
    params.append("id6", bgColor || "#FFFFFE");

    const makeRes = await fetch("https://www.yishuzi.com/make.php?file=b13y&page=2309", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": "https://www.yishuzi.com/b/13.htm",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      body: params.toString(),
      signal: AbortSignal.timeout(12000),
    });

    if (!makeRes.ok) {
      return NextResponse.json({ error: "远程签名服务响应异常" }, { status: 502 });
    }

    const data = await makeRes.json();
    const imgUrl = data?.zhenbi?.[0]?.info?.[0];

    if (!imgUrl || typeof imgUrl !== "string") {
      return NextResponse.json({ error: "未能生成签名字形，请重试" }, { status: 500 });
    }

    // 下载生成的图片并转为 base64 数据流，避免客户端跨域与防盗链问题
    const imgRes = await fetch(imgUrl, {
      headers: {
        "Referer": "https://www.yishuzi.com/",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!imgRes.ok) {
      return NextResponse.json({ error: "下载签名字形失败" }, { status: 502 });
    }

    const arrayBuf = await imgRes.arrayBuffer();
    const base64 = Buffer.from(arrayBuf).toString("base64");
    const mime = imgUrl.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
    const dataUrl = `data:${mime};base64,${base64}`;

    return NextResponse.json({
      success: true,
      dataUrl,
      originalUrl: imgUrl,
      name: trimmedName,
      fontId,
    });
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : "一笔签名生成服务暂时不可用，请稍后再试";
    console.error("[yishuzi-signature API Error]:", err);
    return NextResponse.json(
      { error: errorMsg },
      { status: 500 }
    );
  }
}
