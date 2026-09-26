
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/layout/shortcut-settings.tsx");
import { useEscapeDismiss } from "@/lib/use-escape-dismiss";
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getAvailableTools } from "@furinakit/shared";
import { Keyboard, RotateCcw, Check, X } from "lucide-react";
import { ShortcutToolPicker } from "./shortcut-tool-picker";
import { getToolIcon } from "@/lib/tool-icons";
import { ChevronDown } from "lucide-react";

type Binding = {id:string;toolId:string;key:string};
const defaults:Binding[] = [
  {id:"main",toolId:"main",key:"Alt+Q"},
  {id:"tool1",toolId:"floating-screenshot",key:"Alt+1"},
  {id:"tool2",toolId:"screen-recorder",key:"Alt+2"},
  {id:"tool3",toolId:"clipboard-history",key:"Alt+3"},
  {id:"tool4",toolId:"notes",key:"Alt+4"},
];
function keyName(e:KeyboardEvent){
  if (["Control","Alt","Shift","Meta"].includes(e.key)) return null;
  const key = /^Key[A-Z]$/.test(e.code) ? e.code.slice(3) : /^Digit[0-9]$/.test(e.code) ? e.code.slice(5) : e.code || e.key;
  return [e.ctrlKey&&"Ctrl",e.altKey&&"Alt",e.shiftKey&&"Shift",e.metaKey&&"Super",key].filter(Boolean).join("+");
}
export function ShortcutSettings(){
  const __locale = __useLanguage();
  const [choosing,setChoosing]=useState<string|null>(null);
  const [bindings,setBindings]=useState<Binding[]>(defaults);
  useEscapeDismiss(()=>setChoosing(null),choosing!==null,70);
  const [recording,setRecording]=useState<string|null>(null);
  const [busy,setBusy]=useState(false);
  const [loaded,setLoaded]=useState(false);
  const [error,setError]=useState("");
  const [saved,setSaved]=useState(false);
  const lock=useRef(false);
  const tools=getAvailableTools();
  useEffect(()=>{let alive=true;invoke<{bindings:Binding[];error?:string}>("get_global_shortcuts").then(r=>{if(alive){setBindings(r.bindings);setError(r.error||"");setLoaded(true);}}).catch(e=>{if(alive)setError(String(e));});return()=>{alive=false;void invoke("pause_global_shortcuts",{paused:false});};},[]);
  const persist=async(next:Binding[])=>{
    if(lock.current)return;lock.current=true;setBusy(true);setSaved(false);setError("");
    try{await invoke("save_global_shortcuts",{bindings:next});setBindings(next);setSaved(true);}
    catch(e){setError(String(e));}
    finally{lock.current=false;setBusy(false);}
  };
  useEffect(()=>{
    if(!recording)return;
    const capture=(e:KeyboardEvent)=>{
      e.preventDefault();e.stopImmediatePropagation();if(e.repeat)return;
      const key=keyName(e);if(!key)return;
      setRecording(null);
      void persist(bindings.map(b=>b.id===recording?{...b,key}:b)).finally(()=>invoke("pause_global_shortcuts",{paused:false}));
    };
    const blur=()=>{setRecording(null);void invoke("pause_global_shortcuts",{paused:false}).catch(e=>setError(String(e)));};
    window.addEventListener("keydown",capture,true);
    window.addEventListener("blur",blur);
    return()=>{window.removeEventListener("keydown",capture,true);window.removeEventListener("blur",blur);};
  },[recording,bindings]);
  const stop=()=>{setRecording(null);void invoke("pause_global_shortcuts",{paused:false});};
  return <section className="rounded-2xl border border-border bg-card p-5 shadow-sm" {...(recording?{"data-shortcut-recording":"true"}:{})}>
    <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
      <div><h3 className="flex items-center gap-2 text-base font-semibold"><Keyboard size={18} className="text-sky-500"/>{__ui("全局快捷键")}</h3><p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{__ui("点击按键后直接录入，单键、功能键或组合键均可。保存后在后台也能使用。")}</p></div>
      <button disabled={busy||!loaded||!!recording} onClick={()=>void persist(defaults)} className="flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-40"><RotateCcw size={13}/>{__ui("恢复默认")}</button>
    </header>
    <div className="divide-y divide-border">
      {bindings.map((binding,index)=><div key={binding.id} className="flex flex-wrap items-center gap-3 py-4">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-secondary text-xs text-muted-foreground">{index===0?__ui("主"):index}</span>
        <div className="min-w-[180px] flex-1">{index===0?<span className="text-sm font-medium">{__ui("呼出主界面")}</span>:<button type="button" aria-label={__msg("选择工具 {0}", index)} aria-expanded={choosing===binding.id} disabled={!loaded||busy||!!recording} onClick={()=>setChoosing(choosing===binding.id?null:binding.id)} className="flex w-full items-center gap-3 rounded-xl border border-border bg-background/50 px-3 py-3 text-left text-sm transition-colors hover:border-sky-400 disabled:opacity-50">{(()=>{const t=tools.find(t=>t.id===binding.toolId);const Icon=getToolIcon(t?.icon||"Wrench");return <><span className="rounded-lg bg-sky-500/10 p-2 text-sky-500"><Icon size={17}/></span><span className="min-w-0 flex-1"><span className="block font-medium">{t?.name||binding.toolId}</span><span className="mt-0.5 block text-[11px] text-muted-foreground">{__ui("点击更换工具")}</span></span><ChevronDown size={15}/></>;})()}</button>}</div>
        <button disabled={!loaded||busy||!!recording} onClick={async()=>{try{await invoke("pause_global_shortcuts",{paused:true});setRecording(binding.id);setSaved(false);}catch(e){setError(String(e));}}} className="min-w-[150px] rounded-xl border border-border bg-secondary/50 px-4 py-2.5 text-sm font-mono text-sky-500 disabled:opacity-60">{recording===binding.id?__ui("请按下按键…"):binding.key?binding.key.split("+").join(" + "):__ui("未设置")}</button>
        {recording===binding.id?<button onClick={stop} className="text-xs text-muted-foreground">{__ui("取消录入")}</button>:<button aria-label={__ui("清除快捷键")} disabled={!loaded||busy||!!recording} onClick={()=>void persist(bindings.map(b=>b.id===binding.id?{...b,key:""}:b))} className="rounded-lg p-2 text-muted-foreground hover:bg-secondary disabled:opacity-40"><X size={15}/></button>}

      </div>)}
    </div>
    {choosing&&<ShortcutToolPicker selected={bindings.find(b=>b.id===choosing)?.toolId||""} onClose={()=>setChoosing(null)} onChoose={id=>{const chosen=choosing;setChoosing(null);void persist(bindings.map(b=>b.id===chosen?{...b,toolId:id}:b));}}/>}
    <p className="mt-4 text-xs leading-relaxed text-muted-foreground">{__ui("单键会占用对应的全局按键，请按习惯选择。系统保留或其他程序已占用的按键会明确提示，保存失败不覆盖原配置。录入 Esc、Delete 也有效；取消请点击按钮。")}</p>
    {error&&<p role="alert" className="mt-3 rounded-xl bg-red-500/10 p-3 text-sm text-red-500">{__msg(error)}</p>}
    {saved&&!error&&<p role="status" className="mt-3 flex items-center gap-1.5 text-xs text-emerald-500"><Check size={14}/>{__ui("已保存并注册到系统")}</p>}
  </section>;
}
