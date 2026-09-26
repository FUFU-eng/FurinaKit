import { tr, useLanguage } from "@/lib/language";
import { useJobPreviewUrl } from "@/lib/use-job-preview";
import { AudioPreview } from "./audio-preview";
export function SeparatedAudioPreview({ jobId }: { jobId: string }) {
  useLanguage();
  const vocals = useJobPreviewUrl(jobId, "vocals");
  const instrumental = useJobPreviewUrl(jobId, "instrumental");
  return <div className="grid min-w-0 gap-3 lg:grid-cols-2">
    <AudioPreview src={vocals} name={tr("人声", "Vocals")} />
    <AudioPreview src={instrumental} name={tr("伴奏", "Instrumental")} />
    <p className="text-xs text-muted-foreground lg:col-span-2">{tr("试听文件仅在任务缓存中。点击下方下载结果，才会把两条 WAV 保存为 ZIP。", "Previews remain in the job cache. Use the download button below to save both WAV tracks as a ZIP.")}</p>
  </div>;
}
