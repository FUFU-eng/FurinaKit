"use client";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Job } from "@furinakit/shared";
import { Loader2, Play, RefreshCw, Settings2 } from "lucide-react";
import { Button, Select, Textarea } from "@/components/ui/primitives";
import { JobProgress } from "./job-progress";
import { TtsModelsPanel } from "./tts-models-panel";
import { tr, uiMessage, useLanguage } from "@/lib/language";
import { ttsRequest, useTtsComponents } from "@/lib/tts-models";
import { openModelSettings } from "@/lib/model-settings-navigation";

type Engine = "sapi" | "edge" | "local";
type Voice = { name: string; label: string; locale: string; gender?: string };
const JOB_KEY = "furina:job:text-to-speech";
const DRAFT_KEY = "furina:textdraft:text-to-speech";
const EDGE_VOICES: Voice[] = [
  ["zh-CN-XiaoxiaoNeural", "zh-CN"], ["zh-CN-XiaoyiNeural", "zh-CN"],
  ["zh-CN-YunxiNeural", "zh-CN"], ["zh-CN-YunyangNeural", "zh-CN"],
  ["zh-CN-YunjianNeural", "zh-CN"], ["zh-TW-HsiaoChenNeural", "zh-TW"],
  ["zh-HK-HiuGaaiNeural", "zh-HK"], ["en-US-JennyNeural", "en-US"],
  ["en-US-GuyNeural", "en-US"],
].map(([name, locale]) => ({ name, label: name, locale }));
function readDraft(): Record<string, string> {
  try { const data = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || "{}"); return data && typeof data === "object" && !Array.isArray(data) ? data : {}; } catch { return {}; }
}
function rememberedJob() {
  try { return new URLSearchParams(window.location.search).get("jobId") || sessionStorage.getItem(JOB_KEY); } catch { return null; }
}
export function TextToSpeechTool() {
  useLanguage();
  const client = useQueryClient();
  const [draft] = useState(readDraft);
  const [text, setText] = useState(typeof draft.text === "string" ? draft.text : "");
  // The initial engine stays offline. Merely opening this tool sends no text or
  // voice-list request to a network service.
  const [engine, setEngine] = useState<Engine>("sapi");
  const [sapiVoice, setSapiVoice] = useState("");
  const [edgeVoice, setEdgeVoice] = useState("zh-CN-XiaoxiaoNeural");
  const [modelId, setModelId] = useState("tts-kokoro-zh-en");
  const [speaker, setSpeaker] = useState(3);
  const [rate, setRate] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [volume, setVolume] = useState(100);
  const [jobId, setJobId] = useState<string | null>(rememberedJob);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const submitLock = useRef(false);
  const mounted = useRef(true);
  const draftRef = useRef(text);
  draftRef.current = text;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...readDraft(), text: draftRef.current })); } catch { /* Session storage is optional. */ } }; }, []);
  useEffect(() => { const timer = setTimeout(() => { try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ ...readDraft(), text })); } catch { /* Keep the in-memory draft. */ } }, 400); return () => clearTimeout(timer); }, [text]);
  useEffect(() => {
    const select = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string; jobId?: string; toolId?: string }>).detail;
      if (detail?.toolId === "text-to-speech" && (detail.jobId || detail.id)) setJobId(detail.jobId || detail.id || null);
    };
    window.addEventListener("furinakit:select-job", select);
    return () => window.removeEventListener("furinakit:select-job", select);
  }, []);
  useEffect(() => { if (jobId) { try { sessionStorage.setItem(JOB_KEY, jobId); } catch { /* Optional session storage. */ } } }, [jobId]);
  const system = useQuery<{ ok: boolean; voices: Voice[] }>({ queryKey: ["tts-voices", "sapi"], queryFn: () => ttsRequest("/api/tts/voices?engine=sapi"), enabled: engine === "sapi", staleTime: 60000, retry: false, refetchOnWindowFocus: false });
  const online = useQuery<{ ok: boolean; voices: Voice[] }>({ queryKey: ["tts-voices", "edge"], queryFn: () => ttsRequest("/api/tts/voices?engine=edge"), enabled: false, retry: false });
  const components = useTtsComponents(engine === "local");
  const models = components.data?.components.filter(x => x.kind === "model") || [];
  const model = models.find(x => x.id === modelId);
  const runtimeReady = components.data?.components.find(x => x.id === "tts-sherpa-runtime")?.downloaded === true;
  const systemVoices = system.data?.voices || [];
  const chosenSapi = sapiVoice || systemVoices[0]?.name || "";
  const onlineVoices = online.data?.voices || EDGE_VOICES;
  const jobQuery = useQuery<Job>({ queryKey: ["tts-job", jobId], enabled: Boolean(jobId), retry: 1, refetchOnWindowFocus: false,
    queryFn: async () => { const data = await ttsRequest<{ job: Job }>(`/api/jobs/${encodeURIComponent(jobId!)}`); if (data.job?.id !== jobId || data.job.toolId !== "text-to-speech") throw new Error(tr("任务记录不属于文字转语音", "This job is not a text-to-speech job")); return data.job; },
    refetchInterval: query => query.state.error || ["completed", "failed", "cancelled", "canceled"].includes(query.state.data?.status || "") ? false : 1500 });
  const job = jobQuery.data || null;
  const running = submitting || Boolean(jobId && jobQuery.error && !job) || Boolean(job && ["pending", "queued", "processing", "stopping"].includes(job.status)) || Boolean(jobId && !job && !jobQuery.error);
  const usableVoice = engine === "sapi" ? systemVoices.some(v => v.name === chosenSapi) : engine === "edge" ? onlineVoices.some(v => v.name === edgeVoice) : Boolean(model?.downloaded && runtimeReady && !components.data?.activeId && speaker >= 0 && speaker < (model?.speakers || 0));
  async function submit() {
    if (submitLock.current || running || !usableVoice || !text.trim()) return;
    submitLock.current = true; setSubmitting(true); setError("");
    try {
      const form = new FormData();
      const values = { text, engine, voice: engine === "sapi" ? chosenSapi : engine === "edge" ? edgeVoice : `${modelId}:${speaker}`, rate: String(rate), pitch: String(engine === "edge" ? pitch : 0), volume: String(volume - 100) };
      for (const [key, value] of Object.entries(values)) form.append(key, value);
      const response = await fetch("/api/tools/text-to-speech", { method: "POST", body: form });
      const data = await response.json();
      if (!response.ok || !data.job?.id) throw new Error(data.error || tr("未创建语音任务", "Speech job was not created"));
      try { sessionStorage.setItem(JOB_KEY, data.job.id); } catch { /* The task still remains in task history. */ }
      client.setQueryData(["tts-job", data.job.id], data.job);
      window.dispatchEvent(new Event("furinakit:jobs-updated"));
      if (mounted.current) setJobId(data.job.id);
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : String(e)); }
    finally { submitLock.current = false; if (mounted.current) setSubmitting(false); }
  }
  return <div className="min-w-0 space-y-4">
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <h2 className="text-base font-semibold">{tr("选择合成方式", "Choose a speech engine")}</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-3">
        {([ ["sapi", tr("系统语音", "System speech"), tr("完全离线 · 无需模型下载", "Fully offline · No model download")], ["edge", tr("Edge 在线神经语音", "Edge online neural speech"), tr("需要联网 · 文本发送至微软服务", "Online · Text is sent to Microsoft")], ["local", tr("本地神经语音", "Local neural speech"), tr("模型按需下载 · 下载后离线合成", "Download a model once · Synthesize offline")] ] as const).map(([id, title, note]) => <button key={id} type="button" disabled={running} aria-pressed={engine === id} onClick={() => { setEngine(id); if (id === "sapi") setRate(Math.round(rate / 10) * 10); setError(""); }} className={`min-w-0 rounded-xl border p-4 text-left transition-colors disabled:opacity-60 ${engine === id ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"}`}><span className="block break-words text-sm font-medium">{title}</span><span className="mt-2 block text-xs leading-5 text-muted-foreground">{note}</span></button>)}
      </div>
      <div className="mt-5 space-y-3">
        {engine === "sapi" && <>
          <label className="block text-xs font-medium">{tr("本机实际可用声线", "Voices installed on this computer")}<Select className="mt-2" disabled={running || system.isFetching} value={chosenSapi} onChange={e => setSapiVoice(e.target.value)}>{!systemVoices.length && <option value="">{tr("没有可用声线", "No voices available")}</option>}{sapiVoice && !systemVoices.some(v => v.name === sapiVoice) && <option value={sapiVoice}>{tr("不可用：", "Unavailable: ")}{sapiVoice}</option>}{systemVoices.map(v => <option key={v.name} value={v.name}>{v.name} · {v.locale}</option>)}</Select></label>
          <Button type="button" size="sm" variant="outline" disabled={running || system.isFetching} onClick={() => void system.refetch()}><RefreshCw size={13}/>{tr("重新枚举系统声线", "Refresh installed voices")}</Button>
          {system.isFetching && <p className="text-xs text-muted-foreground">{tr("正在读取系统声线…", "Reading installed voices…")}</p>}
          {system.error && <p role="alert" className="break-words text-xs text-destructive">{uiMessage(system.error.message)}</p>}
          <p className="text-xs leading-6 text-muted-foreground">{tr("只列出 Windows 已安装并启用的 SAPI 声线。若未安装，请在 Windows 语言设置添加语音包；在线 Neural 声线不会冒充系统声线，选择失败也不会偷偷换声线。", "Only installed, enabled SAPI voices appear here. Add a speech language pack in Windows settings if none are available. Online Neural voices are not system voices, and a failed selection never silently falls back.")}</p>
        </>}
        {engine === "edge" && <>
          <label className="block text-xs font-medium">{tr("在线声线", "Online voice")}<Select className="mt-2" disabled={running} value={edgeVoice} onChange={e => setEdgeVoice(e.target.value)}>{!onlineVoices.some(v => v.name === edgeVoice) && <option value={edgeVoice}>{tr("不可用：", "Unavailable: ")}{edgeVoice}</option>}{onlineVoices.map(v => <option key={v.name} value={v.name}>{v.label} · {v.locale}</option>)}</Select></label>
          <Button type="button" size="sm" variant="outline" disabled={running || online.isFetching} onClick={() => void online.refetch()}><RefreshCw size={13}/>{tr("联网刷新全部声线", "Refresh all voices online")}</Button>
          {online.error && <p role="alert" className="break-words text-xs text-destructive">{uiMessage(online.error.message)}</p>}
          <p className="text-xs leading-6 text-muted-foreground">{tr("只有点击在线合成才会上传此处文本。预置声线可直接选用；刷新声线只取目录、不发送文本。接口受网络、代理、系统时间和微软服务变动影响，失败时明确报错，不自动改为离线合成。", "Your text is sent only when you click online synthesis. Preset voices can be used directly; refreshing fetches only the voice catalog. Network, proxy, system clock or Microsoft service changes may affect availability. Errors are shown without switching engines.")}</p>
        </>}
        {engine === "local" && <>
          <div className="grid gap-3 sm:grid-cols-2"><label className="block text-xs font-medium">{tr("本地模型", "Offline model")}<Select className="mt-2" value={modelId} disabled={running} onChange={e => { setModelId(e.target.value); setSpeaker(models.find(x => x.id === e.target.value)?.defaultSpeaker || 0); }}>{!models.length && <option value={modelId}>Kokoro 1.1 · INT8</option>}{models.map(m => <option key={m.id} value={m.id}>{m.name} · {m.downloaded ? tr("已安装", "Installed") : tr("待下载", "Download required")}</option>)}</Select></label><label className="block text-xs font-medium">{tr("模型说话人", "Model speaker")}<Select className="mt-2" disabled={running || !model} value={speaker} onChange={e => setSpeaker(Number(e.target.value))}>{Array.from({ length: model?.speakers || 0 }, (_, sid) => <option key={sid} value={sid}>{model?.family !== "kokoro" ? tr("默认英语声线", "Default English voice") : sid < 3 ? ["af_maple", "af_sol", "bf_vale"][sid] : sid < 58 ? tr("中文女声", "Chinese female") : tr("中文男声", "Chinese male")} · ID {sid}</option>)}</Select></label></div>
          <Button type="button" variant="outline" size="sm" onClick={() => openModelSettings(modelId)}><Settings2 size={13}/>{tr("在设置中管理同一组件", "Manage these components in Settings")}</Button>
          {!usableVoice && <p className="text-xs text-muted-foreground">{tr("请在下方下载所选模型，运行库会自动补齐。下载完成前不会伪装成已可用。", "Download the selected model below; its shared runtime is included automatically. It becomes usable only after installation completes.")}</p>}
          {model?.family === "vits" && <p className="text-xs text-muted-foreground">{tr("此模型仅支持英语；中文或中英混读请选择 Kokoro。", "This model supports English only. Choose Kokoro for Chinese or mixed Chinese/English.")}</p>}
        </>}
      </div>
    </section>
    <section className="rounded-2xl border border-border bg-card p-4 sm:p-5">
      <label htmlFor="tts-text" className="text-sm font-semibold">{tr("朗读文本", "Text to read")}</label>
      <Textarea id="tts-text" className="mt-3 min-h-[200px]" value={text} maxLength={20000} disabled={running} onChange={e => setText(e.target.value)} placeholder={tr("输入或粘贴要朗读的文本…", "Enter or paste the text to read…")}/>
      <p className="mt-2 text-right text-xs text-muted-foreground">{text.length.toLocaleString()} / 20,000</p>
      <fieldset disabled={running} className="mt-4 grid gap-4 sm:grid-cols-3">
        <label className="text-xs">{tr("语速", "Rate")} · {engine === "sapi" ? `${Math.round(rate / 10)} ${tr("档", "steps")}` : `${rate > 0 ? "+" : ""}${rate}%`}<input className="mt-3 block w-full accent-primary" type="range" min={-50} max={50} step={engine === "sapi" ? 10 : 1} value={rate} onChange={e => setRate(Number(e.target.value))}/></label>
        <label className="text-xs">{tr("音量", "Volume")} · {volume}%<input className="mt-3 block w-full accent-primary" type="range" min={0} max={100} step={1} value={volume} onChange={e => setVolume(Number(e.target.value))}/></label>
        {engine === "edge" ? <label className="text-xs">{tr("音调", "Pitch")} · {pitch > 0 ? "+" : ""}{pitch} Hz<input className="mt-3 block w-full accent-primary" type="range" min={-50} max={50} step={1} value={pitch} onChange={e => setPitch(Number(e.target.value))}/></label> : <p className="text-xs leading-6 text-muted-foreground">{tr("此离线引擎不提供音调偏移。输出为真正的 WAV，不再将 WAV 冒充 MP3。", "This offline engine does not offer pitch shifting. Output is a real WAV file, never WAV bytes mislabeled as MP3.")}</p>}
      </fieldset>
      <div className="mt-5 flex flex-wrap items-center gap-3"><Button type="button" disabled={running || !text.trim() || !usableVoice || text.length > 20000} onClick={() => void submit()}>{running ? <Loader2 size={16} className="animate-spin"/> : <Play size={16}/>} {engine === "edge" ? tr("在线合成并预览", "Synthesize online and preview") : tr("离线合成并预览", "Synthesize offline and preview")}</Button><p className="text-xs leading-5 text-muted-foreground">{tr("结果先试听，点击保存后才写入你的输出目录。", "Preview first. Your output folder is written only when you choose Save.")}</p></div>
      {error && <p role="alert" className="mt-3 break-words text-sm text-destructive">{uiMessage(error)}</p>}
    </section>
    {jobQuery.error && <div role="alert" className="rounded-xl border border-destructive/30 p-4 text-sm"><p className="break-words">{uiMessage(jobQuery.error.message)}</p><p className="mt-1 text-xs text-muted-foreground">{tr("状态读取失败不等于任务已停止；重试或到任务列表查看，避免重复提交。", "A status error does not mean the job stopped. Retry or check Tasks before submitting again.")}</p><Button type="button" size="sm" variant="outline" className="mt-2" onClick={() => void jobQuery.refetch()}>{tr("重试读取状态", "Retry job status")}</Button><Button type="button" size="sm" variant="outline" className="ml-2 mt-2" onClick={() => { if (window.confirm(tr("仅解除当前页面的任务关联，不会停止后台任务。请先确认任务列表，是否继续？", "Detach this page without stopping the background job? Check Tasks first to avoid duplicate work."))) { setJobId(null); try { sessionStorage.removeItem(JOB_KEY); } catch { /* Optional session storage. */ } } }}>{tr("解除页面关联", "Detach this page")}</Button></div>}
    <JobProgress job={job} isLoading={submitting || jobQuery.isFetching && !job} toolId="text-to-speech"/>
    {engine === "local" && <TtsModelsPanel compact/>}
  </div>;
}
