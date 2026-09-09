import Link from "next/link";
import { Button } from "@/components/ui/primitives";

export default function NotFound() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
      <h1 className="text-2xl font-bold text-foreground">未找到该工具</h1>
      <p className="text-muted-foreground">这个工具不存在，或当前暂不可用。</p>
      <Button>
        <Link href="/">返回首页</Link>
      </Button>
    </div>
  );
}
