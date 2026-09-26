"use client";
import { createUiText as __createUiText, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/ui/open-output-folder.tsx");

import { useState } from "react";
import { FolderOpen, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { isDesktopOutput, openOutputDirectory } from "@/lib/output-directory";
export function OpenOutputFolderButton() {
  const __locale = __useLanguage();
  const [busy, setBusy] = useState(false);
  const { toast } = useToast();
  if (!isDesktopOutput()) return null;
  return <Button size="sm" variant="outline" className="gap-2 border-sky-500/35 bg-sky-500/10 px-4 text-sm font-medium text-sky-600 shadow-sm hover:bg-sky-500/20" disabled={busy} title={__ui("保存和下载会直接写入设置中的默认输出目录；同名文件自动编号")} onClick={() => {
    setBusy(true);
    void openOutputDirectory().catch(error => toast({ title: "无法打开输出目录", description: String(error), variant: "error" })).finally(() => setBusy(false));
  }}>{busy ? <Loader2 size={16} className="animate-spin" /> : <FolderOpen size={16} />}{__ui("打开输出目录")}</Button>;
}
