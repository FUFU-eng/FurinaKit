
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/utility-window.tsx");
import {ShortcutHint} from "@/lib/tool-shortcut";
"use client";
import { useEscapeDismiss } from "@/lib/use-escape-dismiss";
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Pin, X, Layers, StickyNote, GripHorizontal } from "lucide-react";
import { ClipboardHistoryTool } from "@/components/tools/clipboard-history-tool";
import { NotesTool } from "@/components/tools/notes-tool";
export function UtilityWindow({kind}:{kind:"clipboard"|"notes"}) {
  const __locale = __useLanguage();
  const [pinned,setPinned]=useState(true),[error,setError]=useState("");
  const action=async(action:string)=>{try{await invoke("utility_window_action",{action});if(action==="pin")setPinned(v=>!v);}catch(e){setError(String(e));}};
  useEscapeDismiss(()=>void action("hide"),true,0);
  useEffect(()=>{document.documentElement.dataset.utilityWindow="true";const frame=requestAnimationFrame(()=>void action("ready"));return()=>{delete document.documentElement.dataset.utilityWindow;cancelAnimationFrame(frame);};},[]);
  const Icon=kind==="clipboard"?Layers:StickyNote;
  return <main className="flex h-screen flex-col overflow-hidden rounded-xl border border-border bg-background text-foreground">
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-card/80 px-4" onPointerDown={e=>{if(e.button===0&&!(e.target as HTMLElement).closest("button"))void action("drag");}}>
      <span className="rounded-lg bg-primary/10 p-1.5 text-primary"><Icon size={15}/></span><h1 className="text-sm font-semibold">{kind==="clipboard"?__ui("永久剪切板"):__ui("便签")}</h1><GripHorizontal size={13} className="ml-auto text-muted-foreground"/>
      <button className={`rounded-lg p-2 hover:bg-muted ${pinned?"text-primary":"text-muted-foreground"}`} title={pinned?__ui("取消置顶"):__ui("置顶窗口")} onClick={()=>void action("pin")}><Pin size={13}/></button><button className="rounded-lg p-2 text-muted-foreground hover:bg-muted" title={__ui("隐藏窗口（内容保留）")} onClick={()=>void action("hide")}><X size={15}/></button>
    </header>
    <div className="min-h-0 flex-1 overflow-y-auto p-3">{kind==="clipboard"?<ClipboardHistoryTool compact/>:<NotesTool/>}{error&&<p role="alert" className="mt-2 text-xs text-destructive">{__msg(error)}</p>}</div>
    <footer className="flex h-7 shrink-0 items-center justify-between border-t border-border px-4 text-[10px] text-muted-foreground"><span>{__ui("仅存本机 · 与主界面实时共享")}</span><span className="flex items-center gap-2"><ShortcutHint toolId={kind==="notes"?"notes":"clipboard-history"}/><button type="button" onClick={()=>void action("settings")} className="rounded px-1.5 py-0.5 text-primary hover:bg-primary/10" title={__ui("打开设置中的快捷键设置")}>{__ui("修改")}</button></span></footer>
  </main>;
}
