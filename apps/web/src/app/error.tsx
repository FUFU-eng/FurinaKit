"use client";

import { useEffect } from "react";
import { AlertCircle, RotateCcw, Home } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/primitives";

export default function ErrorBoundaryPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 检查是否属于 Webpack/Next.js 动态分块加载缓存失效 (ChunkLoadError)
    if (error.name === "ChunkLoadError" || error.message?.includes("Loading chunk")) {
      window.location.reload();
    }
  }, [error]);

  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center p-6 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive mb-4">
        <AlertCircle className="h-7 w-7" />
      </div>

      <h2 className="text-lg font-bold text-foreground">页面加载遇到了小问题</h2>
      <p className="mt-2 max-w-md text-xs leading-relaxed text-muted-foreground">
        可能是由于软件刚更新、编译资源缓存不一致或网络暂时波动引起。
        {error.message && (
          <span className="mt-2 block font-mono text-[11px] text-muted-foreground/70 bg-muted/40 p-2 rounded-lg break-all">
            {error.message}
          </span>
        )}
      </p>

      <div className="mt-6 flex items-center gap-3">
        <Button onClick={() => reset()} size="sm" className="gap-2">
          <RotateCcw className="h-3.5 w-3.5" />
          重新加载
        </Button>
        <Link href="/">
          <Button variant="outline" size="sm" className="gap-2">
            <Home className="h-3.5 w-3.5" />
            返回首页
          </Button>
        </Link>
      </div>
    </div>
  );
}
