import { useState } from "react";
import { Download } from "lucide-react";
import { downloadJobResult } from "@/lib/job-download";
import { useToast } from "@/components/ui/toast";

/** Companion artifact is selected by a fixed native token, never by a caller-provided path. */
export function OcrTextDownload({ jobId, filename }: { jobId: string; filename?: string | null }) {
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();
  if (!filename) return null;
  return <button type="button" disabled={saving} className="inline-flex items-center gap-1 whitespace-nowrap rounded border border-border px-3 py-2 text-xs text-primary disabled:opacity-50"
    onClick={async e => {
      e.preventDefault(); e.stopPropagation(); setSaving(true);
      try {
        if (await downloadJobResult(jobId, filename, "ocr-text")) toast({ title: "TXT 已保存 / TXT saved", variant: "success" });
      } catch (error) {
        toast({ title: "TXT 保存失败 / Could not save TXT", description: error instanceof Error ? error.message : String(error), variant: "error" });
      } finally { setSaving(false); }
    }}><Download className="h-3.5 w-3.5" />{saving ? "保存中 / Saving…" : "保存 TXT / Save TXT"}</button>;
}
