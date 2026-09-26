import { useEffect, useRef, useState } from "react";
import { tr, useLanguage } from "@/lib/language";

const AUDIO_EXT = /\.(mp3|wav|wave|flac|aac|m4a|ogg|oga|opus|aiff?|wma|amr|ape|alac)$/i;
const VIDEO_EXT = /\.(mp4|m4v|mov|mkv|avi|webm|flv|wmv|mpeg|mpg|ts|m2ts)$/i;
export function hasAudioPreview(file: File): boolean {
  return /^(audio|video)\//.test(file.type) || AUDIO_EXT.test(file.name) || VIDEO_EXT.test(file.name);
}

/** No upload, autoplay or output-directory write. One audition plays at a time. */
export function AudioPreview({ src, name, input = false }: { src: string; name?: string; input?: boolean }) {
  useLanguage();
  const player = useRef<HTMLAudioElement>(null);
  const [failureCode, setFailureCode] = useState(0);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  useEffect(() => {
    const element = player.current;
    const stopOther = (event: Event) => {
      if ((event as CustomEvent).detail !== element) element?.pause();
    };
    window.addEventListener("furinakit:audio-preview-play", stopOther);
    return () => {
      window.removeEventListener("furinakit:audio-preview-play", stopOther);
      element?.pause();
    };
  }, [src]);
  return (
    <div className="w-full min-w-0 space-y-2 rounded-xl border border-border bg-secondary/20 p-3">
      <p className="break-words text-xs text-muted-foreground">
        {input ? tr("输入试听", "Input preview") : tr("结果试听 · 确认后再手动保存", "Result preview · save manually when ready")}
        {name ? ` · ${name}` : ""}
      </p>
      {src && <audio key={src} ref={player} src={src} controls preload="metadata" className="h-10 w-full min-w-0"
        aria-label={input ? tr("试听输入音频", "Preview input audio") : tr("试听输出音频", "Preview output audio")}
        onPlay={() => window.dispatchEvent(new CustomEvent("furinakit:audio-preview-play", { detail: player.current }))}
        onLoadedMetadata={() => {setFailedSource(null);setFailureCode(0);}}
        onError={() => {setFailedSource(src);setFailureCode(player.current?.error?.code || 0);}} />}
      {!src && <p role="status" className="text-xs text-muted-foreground">{tr("正在准备试听地址…", "Preparing preview…")}</p>}
      {src && failedSource === src && <div role="status" className="space-y-2 text-xs text-muted-foreground"><p>{failureCode === 2
        ? tr("试听文件读取失败，请重新加载。任务缓存被清理后需要重新处理。", "Could not read the preview. Reload it; if the job cache was removed, process the audio again.")
        : tr("试听加载失败：文件地址或音频编码不可用。可重试加载，或手动保存后播放。", "Preview unavailable: the file URL or audio encoding could not be loaded. Retry, or save manually to play elsewhere.")}</p><button type="button" className="rounded-lg border border-border px-3 py-1.5 text-foreground hover:bg-muted" onClick={()=>{setFailedSource(null);setFailureCode(0);player.current?.load();}}>{tr("重新加载试听", "Reload preview")}</button></div>}

    </div>
  );
}

export function InputAudioPreview({ file }: { file: File | null | undefined }) {
  const [owned, setOwned] = useState<{ file: File; url: string } | null>(null);
  useEffect(() => {
    if (!file || !hasAudioPreview(file)) { setOwned(null); return; }
    const url = URL.createObjectURL(file);
    setOwned({ file, url });
    return () => URL.revokeObjectURL(url);
  }, [file]);
  if (!file || !hasAudioPreview(file) || owned?.file !== file) return null;
  return <AudioPreview src={owned.url} name={file.name} input />;
}
