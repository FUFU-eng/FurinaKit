
import { createUiText as __createUiText, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("pages/not-found.tsx");
import Link from "next/link";
import { Button } from "@/components/ui/primitives";

export default function NotFound() {
  const __locale = __useLanguage();
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center gap-4 text-center">
      <h1 className="text-2xl font-bold text-foreground">{__ui("未找到该工具")}</h1>
      <p className="text-muted-foreground">{__ui("这个工具不存在，或当前暂不可用。")}</p>
      <Button>
        <Link href="/">{__ui("返回首页")}</Link>
      </Button>
    </div>
  );
}
