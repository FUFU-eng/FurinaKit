
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/recorder-panel.tsx");
import {useEffect,useRef,useState} from 'react';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
import {Pause,Play,Square,GripVertical,X} from 'lucide-react';
export function RecorderPanel(){
  const __locale = __useLanguage();
 const [state,setState]=useState<{state:string;elapsedMs?:number;error?:string}>({state:'starting'}),[panel,setPanel]=useState({countdown:0,preparing:false}),[busy,setBusy]=useState(false),[error,setError]=useState('');const lock=useRef(false);
 useEffect(()=>{let ended=false,timer:ReturnType<typeof setTimeout>,off:(()=>void)|undefined,offCount:(()=>void)|undefined;
  const poll=async()=>{let delay=600;try{const p=await invoke<typeof panel>('recorder_panel_state');if(ended)return;delay=p.preparing?100:600;setPanel(p);if(!p.preparing){const s=await invoke<typeof state>('recorder_status');if(!ended)setState(s);}}catch(e){if(!ended)setError(String(e));}finally{if(!ended)timer=setTimeout(poll,delay);}};
  void listen<number>('recorder-countdown',e=>setPanel({countdown:e.payload,preparing:true})).then(fn=>{if(ended)fn();else offCount=fn;});
  void poll();void invoke('recorder_panel',{action:'ready'});
  void listen('recorder-panel-close',()=>{void invoke('recorder_panel',{action:'return'});}).then(fn=>{if(ended)fn();else off=fn;});
  return()=>{ended=true;clearTimeout(timer);off?.();offCount?.();};
 },[]);
 useEffect(()=>{if(panel.preparing)void invoke('recorder_panel',{action:panel.countdown>0?'countdown-ready':'bar-ready'});},[panel]);
 useEffect(()=>{if(!panel.preparing)return;const key=(e:KeyboardEvent)=>{if(e.key==='Escape')void invoke('recorder_panel',{action:'cancel'});};addEventListener('keydown',key);return()=>removeEventListener('keydown',key);},[panel.preparing]);
 const act=async(name:string)=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{if(name==='stop'){await invoke('recorder_stop');await invoke('recorder_panel',{action:'return'});}else await invoke(`recorder_${name}`);}catch(e){setError(String(e));}finally{lock.current=false;setBusy(false);}};
 if(panel.preparing&&panel.countdown>0)return <main className="flex h-screen flex-col items-center justify-center gap-2 border border-border bg-card text-foreground"><strong className="text-7xl font-semibold tabular-nums text-primary">{panel.countdown}</strong><button onClick={()=>void invoke('recorder_panel',{action:'cancel'})} className="flex items-center gap-1 rounded-lg px-2 py-1 text-xs text-muted-foreground hover:bg-secondary"><X size={12}/>{__ui("取消 · Esc")}</button></main>;
 const title=error||state.error||(panel.preparing?'正在启动':`${state.state==='paused'?'已暂停':'录制中'} · ${Math.floor((state.elapsedMs||0)/1000)} 秒`);
 return <main title={__ui(title)} className="flex h-screen items-center justify-center gap-1 overflow-hidden rounded-lg border border-border bg-card px-1 text-foreground"><button aria-label={__ui("拖动控制条")} onPointerDown={e=>{if(e.button===0)void invoke('recorder_panel',{action:'drag'});}} className="cursor-grab text-muted-foreground"><GripVertical size={14}/></button><button title={state.state==='paused'?__ui("继续录制"):__ui("暂停录制")} aria-label={state.state==='paused'?__ui("继续录制"):__ui("暂停录制")} disabled={busy||panel.preparing||!['recording','paused'].includes(state.state)} onClick={()=>void act(state.state==='paused'?'resume':'pause')} className="rounded-lg p-2 text-primary hover:bg-secondary disabled:opacity-35">{state.state==='paused'?<Play size={18}/>:<Pause size={18}/>}</button><button title={__msg(error)||__ui("停止并保存")} aria-label={__ui("停止并保存")} disabled={busy||panel.preparing||state.state==='idle'} onClick={()=>void act('stop')} className="rounded-lg p-2 text-red-500 hover:bg-red-500/10 disabled:opacity-35"><Square size={18}/></button><span role="status" className="sr-only">{__ui(title)}</span></main>;
}
