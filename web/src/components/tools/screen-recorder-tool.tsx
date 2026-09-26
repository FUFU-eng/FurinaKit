
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/screen-recorder-tool.tsx");
import {Select} from "@/components/ui/primitives";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ensureOutputDirectory } from "@/lib/output-directory";
import {
  Circle,
  Square,
  Pause,
  Play,
  RefreshCw,
  Monitor,
  Mic,
  FolderOpen,
  Download,
} from "lucide-react";
import { desktopBridge } from "@/bridge";
interface Region {
  x: number;
  y: number;
  width: number;
  height: number;
}
interface WindowSource {
  hwnd: number;
  title: string;
  width: number;
  height: number;
}
interface Sources {
  desktop:Region;
  windows: WindowSource[];
  audio: string[];
  warning?: string;
  dxgi?:boolean;
  ffmpeg: boolean;
  ffprobe: boolean;
}
interface RecordingResult {
  success: boolean;
  path?: string;
  directory: string;
  bytes?: number;
  segments?: number;
  error?: string;
}
interface Status {
  state: "idle" | "starting" | "recording" | "paused" | "error";
  config?: {
    source: { mode: "window"; hwnd: number } | ({ mode: "region" } & Region);
    fps: number;
    quality: string;
    drawCursor: boolean;
    audio: string | null;
  };
  elapsedMs?: number;
  message?: string;
  error?: string;
  directory?: string;
  last?: RecordingResult | null;
}
const elapsed = (ms = 0) => {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 3600)
    .toString()
    .padStart(2, "0")}:${Math.floor((s / 60) % 60)
    .toString()
    .padStart(2, "0")}:${(s % 60).toString().padStart(2, "0")}`;
};
export function ScreenRecorderTool() {
  const __locale = __useLanguage();
  const [sources, setSources] = useState<Sources | null>(null),
    [mode, setMode] = useState<"window" | "region" | "screen">("region"),
    [hwnd, setHwnd] = useState(""),
    [region, setRegion] = useState<Region | null>(null);
  const [fps, setFps] = useState(30),
    [quality, setQuality] = useState("balanced"),
    [cursor, setCursor] = useState(true),
    [audio, setAudio] = useState("");
  const [countdownSeconds,setCountdownSeconds]=useState(3),[captureBackend,setCaptureBackend]=useState("auto");
  const [status, setStatus] = useState<Status>({ state: "idle" }),
    [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const running = useRef(false),
    alive = useRef(true),
    loadId = useRef(0),
    statusId = useRef(0);
  const [statusError, setStatusError] = useState("");
  const active = status.state !== "idle",
    disabled = active || !!busy;
  const refresh = async () => {
    const token = ++loadId.current;
    try {
      const s = await invoke<Sources>("recorder_sources");
      if (alive.current && loadId.current === token) {
        setSources(s);
        setError("");
      }
    } catch (e) {
      if (alive.current && loadId.current === token) setError(String(e));
    }
  };
  useEffect(() => {
    alive.current = true;
    void invoke("recorder_panel",{action:"warm"}).catch(e=>{if(alive.current)setError(String(e));});
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const token = statusId.current;
      try {
        const s = await invoke<Status>("recorder_status");
        if (!stopped && token === statusId.current && !running.current) {
          setStatus(s);
          setStatusError("");
          if (s.config && s.state !== "idle") {
            setMode(s.config.source.mode);
            setFps(s.config.fps);
            setQuality(s.config.quality);
            setCursor(s.config.drawCursor);
            setAudio(s.config.audio || "");
            if (s.config.source.mode === "window")
              setHwnd(String(s.config.source.hwnd));
            else setRegion(s.config.source);
          }
        }
      } catch (e) {
        if (!stopped && token === statusId.current && !running.current) setStatusError(`无法读取录制状态：${String(e)}`);
      } finally {
        if (!stopped) timer = setTimeout(poll, 800);
      }
    };
    const initial = setTimeout(() => {
      void refresh();
      void poll();
    }, 0);
    const handleCompChanged = () => { void refresh(); };
    window.addEventListener("furina:components-changed", handleCompChanged);
    return () => {
      alive.current = false;
      loadId.current += 1;
      statusId.current += 1;
      stopped = true;
      clearTimeout(initial);
      clearTimeout(timer);
      window.removeEventListener("furina:components-changed", handleCompChanged);
    };
  }, []);
  const perform = async (label: string, fn: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    statusId.current += 1;
    setBusy(label);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      if (alive.current) setError(String(e));
    } finally {
      statusId.current += 1;
      running.current = false;
      if (alive.current) {
        setBusy("");
      }
    }
  };
  const selectRegion = () =>
    perform("选择区域", async () => {
      const r = await desktopBridge().captureRegion();
      if (!alive.current) return;
      if (r.cancelled) {
        setNotice("已取消框选，原区域未改变。");
        return;
      }
      if (!r.success || !r.region) throw new Error("区域选择未返回坐标");
      setRegion(r.region);
    });
  const start = () =>
    perform("开始录制", async () => {
      if (!sources?.ffmpeg || !sources?.ffprobe) throw new Error("录屏组件未就绪，请刷新设备并检查 FFmpeg / FFprobe");
      if (mode === "window" && (!hwnd || !sources.windows.some(w => String(w.hwnd) === hwnd))) throw new Error("请选择仍在设备列表中的录制窗口");
      if (mode === "region" && !region) throw new Error("请先框选要录制的区域");
      await ensureOutputDirectory();
      const config = {
        source:
          mode === "window"
            ? { mode, hwnd: Number(hwnd) }
            : { mode:"region", ...(mode==="screen"?sources.desktop:region!) },
        fps,
        quality,
        drawCursor: cursor,
        audio: audio || null,
        captureBackend: captureBackend!=="gdi"&&sources.dxgi&&mode!=="window"?"dxgi":"gdi",
      };
      const s = await invoke<Status>("recorder_start", { config,countdownSeconds });if (alive.current) setStatus(s);
    });
  const control = (name: "pause" | "resume" | "stop") =>
    perform(
      { pause: "暂停录制", resume: "继续录制", stop: "正在封装 MP4，请稍候" }[
        name
      ],
      async () => {
        if (name === "stop") {
          const result = await invoke<RecordingResult>("recorder_stop");
          await invoke("recorder_panel",{action:"return"});
          if (!alive.current) return;
          if (!result.success) throw new Error(result.error || "录制未生成有效成品");
          const next = await invoke<Status>("recorder_status");
          if (!alive.current) return;
          setStatus(next);
          setNotice(
            "录制结束，已校验 MP4 视频流。请打开播放并核对画面与声音。",
          );
        } else {
          const next = await invoke<Status>(`recorder_${name}`);
          if (alive.current) setStatus(next);
        }
      },
    );
  const open = (path: string | undefined) => {
    if (!path) return;
    void perform("打开文件", async () => {
      const r = await desktopBridge().openPath(path);
      if (!r.success) throw new Error(r.error || "无法打开文件");
    });
  };
  const field="rounded-xl border border-border bg-background px-3 py-2 text-sm disabled:opacity-50";
  return <div className="mx-auto max-w-4xl space-y-5">
    <section className="overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
      <header className="flex items-center justify-between gap-4 border-b border-border px-6 py-5"><div className="flex items-center gap-3"><span className="rounded-2xl bg-primary/10 p-3 text-primary"><Monitor size={24}/></span><div><h2 className="text-xl font-semibold">{__ui("屏幕录制")}</h2><p className="mt-1 text-xs text-muted-foreground">{__ui("选好画面，开始记录。停止后查看和保存 MP4。")}</p></div></div><button title={__ui("刷新窗口和录音设备")} disabled={disabled} onClick={()=>void refresh()} className={field}><RefreshCw size={17}/></button></header>
      <div className="space-y-5 p-6">
       {!active?<>
        <div className="grid grid-cols-3 gap-3">{([{id:'region',name:'区域录制',desc:'拖动框选需要的画面'},{id:'screen',name:'整个桌面',desc:'包含当前全部显示器'},{id:'window',name:'指定窗口',desc:'只录制选中的窗口'}] as const).map(m=><button key={m.id} disabled={disabled} onClick={()=>setMode(m.id)} aria-pressed={mode===m.id} className={`rounded-2xl border p-4 text-left transition-colors ${mode===m.id?'border-primary bg-primary/5':'border-border hover:bg-secondary/50'}`}><Monitor size={21} className={mode===m.id?'text-primary':'text-muted-foreground'}/><strong className="mt-3 block text-sm">{__msg(m.name)}</strong><span className="mt-1 block text-xs text-muted-foreground">{__ui(m.desc)}</span></button>)}</div>
        <div className="flex min-h-36 flex-col items-center justify-center gap-3 rounded-2xl border border-dashed border-border bg-background/50 px-5 py-6">
         {mode==='region'?<><button disabled={disabled} onClick={()=>void selectRegion()} className="rounded-xl bg-primary px-5 py-2.5 text-sm font-medium text-primary-foreground">{region?__ui("重新框选区域"):__ui("框选录制区域")}</button><p className="text-xs text-muted-foreground">{region?__msg("已选择 {0} × {1} 像素", region.width, region.height):__ui("拖动选择，松手确认；Esc 取消")}</p></>:mode==='window'?<><label htmlFor="record-window" className="text-sm">{__ui("选择要录制的窗口")}</label><Select id="record-window" className="w-full max-w-lg" disabled={disabled} value={hwnd} onChange={e=>setHwnd(e.target.value)}><option value="">{__ui("请选择窗口")}</option>{sources?.windows.map(w=><option key={w.hwnd} value={w.hwnd}>{w.title} · {w.width}×{w.height}</option>)}</Select></>:<><Monitor size={34} className="text-primary"/><strong className="text-sm">{sources?.desktop?`${sources.desktop.width} × ${sources.desktop.height}`:__ui("正在读取显示器")}</strong><p className="text-xs text-muted-foreground">{__ui("请先收起私人内容，录制将包含桌面所有窗口。")}</p></>}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl bg-secondary/40 p-4"><label className="flex items-center gap-2 text-sm"><Mic size={17}/><Select aria-label={__ui("录音设备")} className="w-auto min-w-36" disabled={disabled} value={audio} onChange={e=>setAudio(e.target.value)}><option value="">{__ui("不录音")}</option>{sources?.audio.map(a=><option key={a}>{a}</option>)}</Select></label><label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={cursor} disabled={disabled} onChange={e=>setCursor(e.target.checked)}/>{__ui("显示鼠标指针")}</label></div>
        <div className="flex flex-wrap items-center gap-3 text-sm"><span className="text-muted-foreground">{__ui("开始方式")}</span><div className="inline-flex rounded-xl border border-border bg-background p-1">{[3,0].map(n=><button key={n} disabled={disabled} aria-pressed={countdownSeconds===n} onClick={()=>setCountdownSeconds(n)} className={`rounded-lg px-4 py-2 text-sm ${countdownSeconds===n?'bg-primary text-primary-foreground':'text-muted-foreground hover:bg-secondary'}`}>{n?__ui("3 秒倒计时"):__ui("立即录制")}</button>)}</div><span className="text-xs text-muted-foreground">{__ui("开始后自动隐藏工具页，停止后返回。")}</span></div>
        <details className="rounded-xl border border-border px-4 py-3"><summary className="cursor-pointer text-sm text-muted-foreground">{__ui("画质与录制说明 ·")}{fps} FPS</summary><div className="mt-4 flex flex-wrap gap-4"><label className="text-xs">{__ui("帧率")}<Select className="w-auto min-w-36" disabled={disabled} value={fps} onChange={e=>setFps(+e.target.value)}>{[15,24,30,60].map(n=><option key={n} value={n}>{n} FPS</option>)}</Select></label><label className="text-xs">{__ui("画质")}<Select className="w-auto min-w-36" disabled={disabled} value={quality} onChange={e=>setQuality(e.target.value)}><option value="balanced">{__ui("平衡 · 推荐")}</option><option value="high">{__ui("高画质")}</option><option value="small">{__ui("小体积")}</option></Select></label></div><div className="mt-3 flex items-center gap-3 text-xs"><span>{__ui("采集方式")}</span><Select className="max-w-xs" value={captureBackend} disabled={disabled} onChange={e=>setCaptureBackend(e.target.value)}><option value="auto">{__ui("自动 · 优先 DXGI 桌面复制")}</option><option value="gdi">{__ui("兼容 · Windows GDI")}</option></Select></div><p className="mt-3 text-xs leading-6 text-muted-foreground">{sources?.dxgi&&mode!=="window"&&captureBackend!=="gdi"?__ui("使用 DXGI 桌面复制，避免持续 GDI 抓屏引起的指针闪烁；若启动失败可切换兼容采集。"):__ui("当前使用 GDI 兼容采集；若指针闪烁，可先取消“显示鼠标指针”。DXGI 目前用于支持该组件的单显示器区域/桌面录制。")} {__ui("受保护或部分 GPU 窗口可能黑屏。指定窗口最小化、关闭或改变尺寸会暂停/报错，不会自动退回全屏。系统声音需选择立体声混音或虚拟回环设备；不会自动打开麦克风。暂停分段保留，停止时合并 MP4。")}</p></details>
       </>:<div className="rounded-2xl bg-primary/5 p-8 text-center"><span className="inline-flex items-center gap-2 text-sm text-primary"><span className="h-2 w-2 rounded-full bg-red-500"/>{status.state==='paused'?__ui("已暂停"):status.state==='recording'?__ui("正在录制"):status.state==='error'?__ui("录制异常"):__ui("正在启动")}</span><p className="my-5 font-mono text-5xl tabular-nums">{elapsed(status.elapsedMs)}</p><p className="text-xs text-muted-foreground">{__msg(status.message)||__ui("可切换工具，原生会话会继续录制。")}</p><button className={field+' mt-5'} onClick={()=>void perform('打开控制条',async()=>{await invoke('recorder_panel',{action:'open'});})}>{__ui("显示悬浮控制条")}</button></div>}
       <div className="flex items-center justify-center gap-3 border-t border-border pt-5">{!active?<button className="flex items-center gap-2 rounded-xl bg-primary px-8 py-3 font-medium text-primary-foreground disabled:opacity-40" disabled={!!busy||!sources?.ffmpeg||!sources?.ffprobe||(mode==='region'?!region:mode==='window'?!hwnd:!sources?.desktop)} onClick={()=>void start()}><Circle size={17}/>{__ui("开始录制")}</button>:<><button className={field} disabled={!!busy||!['recording','paused'].includes(status.state)} onClick={()=>void control(status.state==='paused'?'resume':'pause')}>{status.state==='paused'?<Play size={17}/>:<Pause size={17}/>}</button><button className="flex items-center gap-2 rounded-xl bg-red-500 px-6 py-3 text-white disabled:opacity-50" disabled={!!busy} onClick={()=>void control('stop')}><Square size={16}/>{__ui("结束并保存")}</button></>}</div>
       {(error||status.error||statusError)&&<p role="alert" className="rounded-xl bg-destructive/10 p-3 text-sm text-destructive">{__msg(error)||__msg(status.error)||statusError}</p>}{notice&&<p role="status" className="text-center text-sm text-primary">{__msg(notice)}</p>}{busy&&<p role="status" className="text-center text-xs text-muted-foreground">{busy}</p>}{sources&&(!sources.ffmpeg||!sources.ffprobe)&&<p className="text-sm text-destructive">{__ui("缺少 FFmpeg / FFprobe，请检查音视频组件。")}</p>}{sources?.warning&&<p className="text-xs text-muted-foreground">{__msg(sources.warning)}</p>}
      </div>
    </section>
    {status.last&&<section className="rounded-2xl border border-border bg-card p-5"><h3 className="font-semibold">{status.last.success?__ui("录制已保存"):__ui("录制未完整完成，分段已保留")}</h3><p className="my-3 break-all text-xs text-muted-foreground">{status.last.path||status.last.directory}{status.last.bytes?` · ${(status.last.bytes/1048576).toFixed(1)} MB`:''}</p>{status.last.error&&<p className="mb-3 text-sm text-destructive">{__msg(status.last.error)}</p>}<div className="flex flex-wrap gap-2">{status.last.success&&<><button className={field+' flex items-center gap-2'} onClick={()=>void perform("打开播放器",async()=>{await invoke("recorder_play");})}><Play size={15}/>{__ui("播放视频")}</button><button disabled={!!busy} className={field+' flex items-center gap-2'} onClick={()=>void perform('另存视频',async()=>{await ensureOutputDirectory();const ok=await invoke<boolean>('recorder_save_as');setNotice(ok?'视频已另存到输出目录':'未另存，原成品保留');})}><Download size={15}/>{__ui("另存到输出目录")}</button></>}<button className={field+' flex items-center gap-2'} onClick={()=>open(status.last?.directory)}><FolderOpen size={15}/>{__ui("打开所在目录")}</button></div></section>}
  </div>;
}
