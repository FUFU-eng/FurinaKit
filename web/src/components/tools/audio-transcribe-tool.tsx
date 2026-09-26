"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/audio-transcribe-tool.tsx");


import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertCircle, CheckCircle2, Download, FileAudio, FileText, Loader2, Mic,
  Sparkles, Subtitles, Trash2, Upload, Copy, HardDriveDownload,
} from "lucide-react";
import { Button, ProgressBar, Select } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";
import { InputAudioPreview } from "./audio-preview";
import { openModelSettings } from "@/lib/model-settings-navigation";
import { saveOutputBlob, openOutputDirectory } from "@/lib/output-directory";

interface ModelRow {
  id: string;
  label: string;
  size: number;
  note: string;
  recommended?: boolean;
  downloaded: boolean;
  download: { status: "downloading" | "done" | "error"; received: number; total: number; error: string | null; mirror?: string | null } | null;
}

interface JobRow {
  id: string;
  status: string;
  progress: number;
  message?: string;
  error?: string;
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(0)} MB`;

export function AudioTranscribeTool() {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  const { toast } = useToast();

  const [ready, setReady] = useState<boolean | null>(null);
  const [models, setModels] = useState<ModelRow[]>([]);
  const [modelId, setModelId] = useState("base");
  const [language, setLanguage] = useState("auto");
  const [output, setOutput] = useState("txt");
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [job, setJob] = useState<JobRow | null>(null);
  const [text, setText] = useState("");
  const [hasSrt, setHasSrt] = useState(false);
  const [error, setError] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const mounted=useRef(false);
  const submitLock=useRef(false);
  const jobEpoch=useRef(0);
  const modelsLoading=useRef(false);
  const [submitting,setSubmitting]=useState(false);
  const [engineError,setEngineError]=useState("");
  const [saving,setSaving]=useState(false);
  const loadModels=useCallback(async()=>{
    if(modelsLoading.current)return;modelsLoading.current=true;
    try{const response=await fetch("/api/whisper/models",{cache:"no-store"});const data=await response.json();if(!response.ok)throw new Error(data.error||"无法读取模型状态");if(!mounted.current)return;setReady(data.ready===true);setEngineError(data.error||"");setModels(Array.isArray(data.models)?data.models:[]);}catch(e){if(mounted.current){setReady(false);setEngineError(e instanceof Error?e.message:"无法确认组件状态");}}finally{modelsLoading.current=false;}
  },[]);
  useEffect(()=>{mounted.current=true;void loadModels();const timer=setInterval(()=>void loadModels(),1500);return()=>{mounted.current=false;clearInterval(timer);};},[loadModels]);
  useEffect(()=>{let current=true;const epoch=jobEpoch.current;let id:string|null=null;try{id=new URLSearchParams(window.location.search).get("jobId")||localStorage.getItem("furina:last-whisper-job");}catch{}if(id&&/^[a-f0-9-]{1,64}$/i.test(id)){void fetch(`/api/jobs/${id}`).then(r=>r.json()).then(data=>{if(current&&jobEpoch.current===epoch&&data.job?.nativeEngine==="whisper")setJob(data.job);}).catch(()=>{});}return()=>{current=false;};},[]);
  const startDownload=async(id:string)=>{try{const response=await fetch("/api/whisper/download",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({model:id})});const data=await response.json();if(!response.ok||data.ok!==true)throw new Error(data.error||"无法下载模型");if(mounted.current){await loadModels();toast({title:"模型下载已开始",description:"需要联网；支持断点续传，下载后会校验SHA-256。",variant:"info"});}}catch(e){if(mounted.current)toast({title:"下载失败",description:e instanceof Error?e.message:"",variant:"error"});}};
  const startTranscribe=async()=>{
    if(submitLock.current)return;
    if(!file){setError("请先选择音频或视频文件");return;}
    if(!ready||!models.find(m=>m.id===modelId)?.downloaded){setError("请先下载所选模型，并确认内置引擎可用");return;}
    jobEpoch.current++;submitLock.current=true;setSubmitting(true);setError("");setText("");setHasSrt(false);
    try{const form=new FormData();form.append("file",file);form.append("model",modelId);form.append("language",language);form.append("output",output);const response=await fetch("/api/tools/audio-transcribe",{method:"POST",body:form});const data=await response.json();if(!response.ok||!data.job?.id)throw new Error(data.error||"创建任务失败");try{localStorage.setItem("furina:last-whisper-job",data.job.id);}catch{}window.dispatchEvent(new Event("furinakit:jobs-updated"));if(mounted.current)setJob(data.job);}catch(e){if(mounted.current)setError(e instanceof Error?e.message:"创建任务失败");}finally{submitLock.current=false;if(mounted.current)setSubmitting(false);}
  };
  useEffect(()=>{
    if(!job?.id)return;
    const id=job.id;let current=true;let timer:ReturnType<typeof setTimeout>|undefined;let failures=0;const abort=new AbortController();
    const poll=async()=>{try{const response=await fetch(`/api/jobs/${id}`,{cache:"no-store",signal:abort.signal});const data=await response.json();if(!response.ok||data.job?.id!==id)throw new Error(data.error||"任务状态不可用");if(!current)return;const next=data.job as JobRow;setJob(next);failures=0;
      if(next.status==="completed"){const response=await fetch(`/api/whisper/result?job=${id}`,{cache:"no-store",signal:abort.signal});const data=await response.json();if(!current)return;if(!response.ok)throw new Error(data.error||"读取实际转写结果失败");setText(typeof data.text==="string"?data.text:"");setHasSrt(data.hasSrt===true);window.dispatchEvent(new Event("furinakit:jobs-updated"));return;}
      if(["failed","cancelled","canceled"].includes(next.status)){setError(next.error||next.message||"转写已停止");return;}
    }catch(e){if(!current)return;failures++;if(failures>=5){setError(`状态读取失败：${e instanceof Error?e.message:"未知错误"}。可重新打开工具恢复查看；不会把未知状态当作完成。`);return;}}
    if(current)timer=setTimeout(()=>void poll(),1100);};void poll();return()=>{current=false;abort.abort();if(timer)clearTimeout(timer);};
  },[job?.id]);
  const stopTranscribe=async()=>{if(!job)return;try{const response=await fetch(`/api/jobs/${job.id}/cancel`,{method:"POST"});const data=await response.json();if(!response.ok)throw new Error(data.error||"停止失败");if(mounted.current&&data.job)setJob(data.job);}catch(e){setError(e instanceof Error?e.message:"停止失败");}};
  const saveText=async()=>{if(saving)return;setSaving(true);try{const path=await saveOutputBlob(new Blob([text],{type:"text/plain;charset=utf-8"}),"语音转写.txt");toast({title:"已保存至默认输出目录",description:path,variant:"success"});}catch(e){toast({title:"保存失败",description:e instanceof Error?e.message:"",variant:"error"});}finally{if(mounted.current)setSaving(false);}};
  const running=submitting||!!job&&["pending","processing","queued","stopping"].includes(job.status);
  const finished=Boolean(text);
  const pickFile=(f:File|null|undefined)=>{if(f&&!running){setFile(f);setError("");}};

  return (
    <div className="flex flex-col gap-4">
      {/* 程序本体缺失时的提示（正常安装包都会带上） */}
      {ready === false && (
        <div className="flex items-start gap-2.5 rounded-xl border border-destructive/30 bg-destructive/5 p-4">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          <div className="text-[13px] text-destructive">
            <p className="font-medium">{__ui("缺少语音识别组件")}</p>
            <p className="mt-1 opacity-90">{engineError || __ui("未找到随包提供的语音识别程序或FFmpeg，请使用完整包。")}</p>
          </div>
        </div>
      )}

      {/* 为什么第一次要下载模型 */}
      <div
        className="flex items-start gap-2.5 rounded-xl border p-4"
        style={{ borderColor: colors.borderSolid, background: colors.card }}
      >
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0" style={{ color: colors.gold }} />
        <p className="text-[12.5px] leading-relaxed" style={{ color: colors.muted }}>
          {__ui("语音识别在本机离线运行，")}<span style={{ color: colors.text }}>{__ui("音频不会上传到任何服务器")}</span>{__ui("。 语音模型不随安装包分发，首次下载需要联网（镜像 / Hugging Face），之后可离线使用。任选一个模型即可，无需全部下载。")}<button type="button" className="ml-1 font-medium text-primary underline underline-offset-2" onClick={()=>openModelSettings(`whisper-${modelId}`)}>{__ui("设置 → 组件与模型")}</button>
        </p>
      </div>

      {/* 第一步：模型 */}
      <section className="rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
        <header className="mb-3.5 flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg text-[12px] font-bold" style={{ background: colors.btnHover, color: colors.text }}>1</span>
          <h2 className="text-[14.5px] font-semibold" style={{ color: colors.text }}>{__ui("选择语音模型")}</h2>
          <span className="text-[12px]" style={{ color: colors.muted }}>{__ui("不同模型侧重速度、内存与准确率，普通CPU建议先选Base")}</span>
        </header>

        <div className="flex flex-col gap-2">
          {models.map((m) => {
            const dl = m.download;
            const pct = dl && dl.total > 0 ? Math.min(100, Math.round((dl.received / dl.total) * 100)) : 0;
            const isCurrent = modelId === m.id;
            return (
              <div
                key={m.id}
                onClick={() => setModelId(m.id)}
                className={cn(
                  "flex cursor-pointer flex-wrap items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-all",
                  isCurrent ? "border-primary" : "hover:border-primary/50",
                )}
                style={{ background: isCurrent ? colors.active : "transparent", borderColor: isCurrent ? undefined : colors.borderSolid }}
              >
                <span
                  className={cn("h-3.5 w-3.5 shrink-0 rounded-full border-2 transition-colors")}
                  style={{ borderColor: isCurrent ? "hsl(var(--primary))" : colors.borderSolid, background: isCurrent ? "hsl(var(--primary))" : "transparent" }}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[13.5px] font-medium" style={{ color: colors.text }}>{__ui(m.label)}</span>
                    <span className="text-[11.5px]" style={{ color: colors.muted }}>{mb(m.size)}</span>
                    {m.recommended && (
                      <span className="rounded-md px-1.5 py-0.5 text-[10.5px] font-medium" style={{ background: `${colors.gold}22`, color: colors.gold }}>{__ui("推荐")}</span>
                    )}
                    {m.downloaded && (
                      <span className="flex items-center gap-1 text-[11.5px]" style={{ color: colors.green }}>
                        <CheckCircle2 size={12} /> {__ui("已下载")}</span>
                    )}
                  </div>
                  <p className="mt-0.5 truncate text-[11.5px]" style={{ color: colors.muted }}>{__ui(m.note)}</p>
                  {!m.downloaded && dl && dl.status === "downloading" && (
                    <div className="mt-2 flex items-center gap-2">
                      <ProgressBar value={pct} />
                      <span className="shrink-0 text-[11px]" style={{ color: colors.muted }}>{pct}%</span>
                    </div>
                  )}
                  {!m.downloaded && dl?.status === "error" && (
                    <p className="mt-1.5 text-[11.5px] text-destructive">{__msg(dl.error)}</p>
                  )}
                </div>
                {!m.downloaded && dl?.status !== "downloading" && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0 gap-1.5"
                    onClick={(e) => {
                      e.stopPropagation();
                      void startDownload(m.id);
                    }}
                  >
                    <HardDriveDownload size={13} /> {__ui("下载")}</Button>
                )}
                {!m.downloaded && dl?.status === "downloading" && <Loader2 size={15} className="shrink-0 animate-spin" style={{ color: colors.muted }} />}
              </div>
            );
          })}
        </div>
      </section>

      {/* 第二步：文件与选项 */}
      <section className="rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
        <header className="mb-3.5 flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-lg text-[12px] font-bold" style={{ background: colors.btnHover, color: colors.text }}>2</span>
          <h2 className="text-[14.5px] font-semibold" style={{ color: colors.text }}>{__ui("选择要转写的文件")}</h2>
        </header>

        <div
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            pickFile(e.dataTransfer.files?.[0]);
          }}
          className={cn(
            // 与其它工具的上传区统一：2 像素主题色描边 + 淡主题色底
            // （原来是 1 像素、颜色用 borderSolid 的虚线框，在浅色主题下几乎看不见）
            "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-primary/35 bg-primary/[0.06] py-8 transition-all",
            dragging ? "border-primary bg-primary/15 ring-4 ring-primary/20" : "hover:border-primary/60 hover:bg-primary/10",
          )}
        >
          <input
            ref={inputRef}
            disabled={running}
            type="file"
            accept="audio/*,video/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.wma,.mp4,.mkv,.mov,.avi,.flv,.wmv"
            className="hidden"
            onChange={(e) => pickFile(e.target.files?.[0])}
          />
          {file ? (
            <>
              <FileAudio size={26} style={{ color: colors.blue }} />
              <p className="max-w-[80%] truncate text-[13.5px] font-medium" style={{ color: colors.text }}>{file.name}</p>
              <p className="text-[11.5px]" style={{ color: colors.muted }}>
                {(file.size / 1024 / 1024).toFixed(1)} {__ui("MB · 点击可重新选择文件")}</p>
            </>
          ) : (
            <>
              <Upload size={26} style={{ color: colors.muted }} />
              <p className="text-[13.5px] font-medium" style={{ color: colors.text }}>{__ui("点击选择文件，或将文件拖拽至此")}</p>
              <p className="text-[11.5px]" style={{ color: colors.muted }}>{__ui("支持常见音频格式，以及 MP4 / MKV 等视频格式")}</p>
            </>
          )}
        </div>

      {file && <InputAudioPreview file={file} />}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium" style={{ color: colors.text }}>{__ui("语言")}</span>
            <Select value={language} onChange={(e) => setLanguage(e.target.value)}>
              <option value="auto">{__ui("自动识别")}</option>
              <option value="zh">{__ui("中文")}</option>
              <option value="en">{__ui("英语")}</option>
              <option value="ja">{__ui("日语")}</option>
              <option value="ko">{__ui("韩语")}</option>
              <option value="yue">{__ui("粤语")}</option>
              <option value="fr">{__ui("法语")}</option>
              <option value="de">{__ui("德语")}</option>
              <option value="es">{__ui("西班牙语")}</option>
              <option value="ru">{__ui("俄语")}</option>
            </Select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium" style={{ color: colors.text }}>{__ui("输出格式")}</span>
            <Select value={output} onChange={(e) => setOutput(e.target.value)}>
              <option value="txt">{__ui("纯文本 TXT")}</option>
              <option value="srt">{__ui("字幕 SRT（带时间轴）")}</option>
              <option value="both">{__ui("两者都要")}</option>
            </Select>
          </label>
        </div>

        {error && (
          <div className="mt-3.5 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
            <p className="text-[12.5px] text-destructive">{__msg(error)}</p>
          </div>
        )}

        <div className="mt-4 flex items-center gap-3">
          <Button onClick={() => void startTranscribe()} disabled={running || !file || ready!==true || !models.find(m=>m.id===modelId)?.downloaded} className="gap-2">
            {running ? <Loader2 size={15} className="animate-spin" /> : <Mic size={15} />}
            {running ? __ui("正在识别…") : __ui("开始识别")}
          </Button>
          {running&&job&&<Button variant="outline" size="sm" disabled={job.status==="stopping"} onClick={()=>void stopTranscribe()}>{__ui("停止转写")}</Button>}
          {file && !running && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5"
              onClick={() => {
                setFile(null);
                setText("");
                jobEpoch.current++;try{localStorage.removeItem("furina:last-whisper-job");}catch{}setJob(null);
                setError("");
              }}
            >
              <Trash2 size={13} /> {__ui("清空")}</Button>
          )}
        </div>

        {running && job && (
          <div className="mt-4">
            <div className="mb-1.5 flex items-center justify-between text-[12px]" style={{ color: colors.muted }}>
              <span>{__msg(job.message) || __ui("正在处理…")}</span>
              <span>{job.progress}%</span>
            </div>
            <ProgressBar value={job.progress} />
          </div>
        )}
      </section>

      {/* 结果 */}
      {finished && (
        <motion.section
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl border p-5"
          style={{ borderColor: colors.borderSolid, background: colors.card }}
        >
          <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <FileText size={16} style={{ color: colors.green }} />
              <h2 className="text-[14.5px] font-semibold" style={{ color: colors.text }}>{__ui("识别结果")}</h2>
              <span className="text-[12px]" style={{ color: colors.muted }}>{text.length} {__ui("字")}</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(text);
                    toast({ title: "已复制全文", variant: "success" });
                  } catch {
                    toast({ title: "复制失败，请手动选中文本后复制", variant: "error" });
                  }
                }}
              >
                <Copy size={13} /> {__ui("复制")}</Button>
              {job && (
                <>
                  <Button size="sm" variant="outline" className="gap-1.5" disabled={saving} onClick={()=>void saveText()}><Download size={13}/> {__ui("保存TXT")}</Button>
                  <Button size="sm" variant="ghost" onClick={()=>void openOutputDirectory().catch(e=>toast({title:"打开目录失败",description:String(e),variant:"error"}))}>{__ui("打开输出目录")}</Button>
                  {hasSrt && (
                    <a href={`/api/whisper/result?job=${job.id}&download=srt`} download>
                      <Button size="sm" variant="outline" className="gap-1.5"><Subtitles size={13} /> SRT</Button>
                    </a>
                  )}
                </>
              )}
            </div>
          </header>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            className="h-72 w-full resize-y rounded-xl border p-3.5 text-[13px] leading-relaxed focus:outline-none"
            style={{ borderColor: colors.borderSolid, background: colors.bg, color: colors.text }}
          />
          <p className="mt-2 text-[11.5px]" style={{ color: colors.muted }}>
            {__ui("结果可编辑；保存TXT会包含修改。SRT保留原始识别时间轴。所有导出使用默认输出目录，不覆盖同名文件。")}</p>
        </motion.section>
      )}
    </div>
  );
}
