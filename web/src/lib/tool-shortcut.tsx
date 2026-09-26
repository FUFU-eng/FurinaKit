
import { createUiText as __createUiText, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("lib/tool-shortcut.tsx");
import {useEffect,useState} from "react";
import {invoke} from "@tauri-apps/api/core";
import {listen} from "@tauri-apps/api/event";
export function ShortcutHint({toolId}:{toolId:string}){
  const __locale = __useLanguage();
 const [label,setLabel]=useState("读取快捷键…");
 useEffect(()=>{let alive=true;let off:(()=>void)|undefined;let revision=0;
 const refresh=()=>{const token=++revision;void invoke<{bindings:{toolId:string;key:string}[];error?:string}>("get_global_shortcuts").then(r=>{if(alive&&token===revision)setLabel(r.error?"快捷键注册异常，请检查设置":r.bindings.filter(b=>b.toolId===toolId&&b.key).map(b=>b.key.replace(/Super/g,"Win")).join(" / ")||"未设置快捷键");}).catch(()=>{if(alive)setLabel("快捷键暂不可用");});};
 void listen("utility-shortcuts-changed",refresh).then(fn=>{if(alive){off=fn;refresh();}else fn();}).catch(refresh);refresh();window.addEventListener("focus",refresh);
 return()=>{alive=false;off?.();window.removeEventListener("focus",refresh);};},[toolId]);
 return <span className="ml-auto text-right text-[11px] text-muted-foreground" title={__ui("在设置 → 快捷键中修改")}>{__ui("快捷键 ·")}<span className="font-medium tabular-nums">{__ui(label)}</span></span>;
}
