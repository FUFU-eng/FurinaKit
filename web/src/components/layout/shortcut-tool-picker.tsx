import { useFavorites } from "@/lib/use-tool-prefs";
import { Select as RoundedSelect } from "@/components/ui/primitives";

import { createUiText as __createUiText, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/layout/shortcut-tool-picker.tsx");
import {useEffect,useMemo,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {getAvailableTools,CATEGORY_LABELS} from "@furinakit/shared";
import {Search,X,Check} from "lucide-react";
import {getToolIcon} from "@/lib/tool-icons";
export function ShortcutToolPicker({selected,onChoose,onClose}:{selected:string;onChoose:(id:string)=>void;onClose:()=>void}){
  const __locale = __useLanguage();
  const {favorites}=useFavorites();
 const [query,setQuery]=useState("");const [category,setCategory]=useState("");const [index,setIndex]=useState(0);const host=useRef<HTMLDivElement>(null);
 const tools=useMemo(()=>getAvailableTools().filter(t=>!t.comingSoon),[ __locale]);
 const results=tools.filter(t=>(!category||(category==="favorites"?favorites.includes(t.id):t.category===category))&&`${t.name} ${t.description} ${t.id}`.toLowerCase().includes(query.toLowerCase().trim()));
 useEffect(()=>{const previous=document.activeElement as HTMLElement|null;host.current?.querySelector('input')?.focus();return()=>previous?.focus();},[]);
 useEffect(()=>{setIndex(0);},[query,category]);
 return createPortal(<div className="fixed inset-0 z-[250] flex items-center justify-center bg-black/30 p-5 backdrop-blur-sm" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><div ref={host} role="dialog" aria-modal="true" aria-label={__ui("选择快捷工具")} className="flex max-h-[75vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl" onKeyDown={e=>{if((e.target as HTMLElement).closest('[role="listbox"],[aria-haspopup="listbox"]'))return;if(e.key==='Escape'){e.preventDefault();e.stopPropagation();onClose();}if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();const n=Math.max(0,Math.min(results.length-1,index+(e.key==='ArrowDown'?1:-1)));setIndex(n);host.current?.querySelector(`[data-result="${n}"]`)?.scrollIntoView({block:'nearest'});}if(e.key==='Enter'&&e.target instanceof HTMLInputElement&&results[index]){e.preventDefault();onChoose(results[index].id);}if(e.key==='Tab'){const els=Array.from(host.current?.querySelectorAll<HTMLElement>('button,input,select')||[]);const first=els[0],last=els.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}}}>
 <header className="flex items-center gap-3 border-b border-border p-4"><Search size={19} className="text-primary"/><input autoFocus className="min-w-0 flex-1 bg-transparent text-sm outline-none" aria-label={__ui("搜索快捷工具")} placeholder={__ui("搜索工具名称或用途…")} value={query} onChange={e=>setQuery(e.target.value)}/><button aria-label={__ui("关闭工具选择")} onClick={onClose}><X size={18}/></button></header>
 <div className="flex items-center justify-between px-4 py-2 text-xs text-muted-foreground"><RoundedSelect aria-label={__ui("工具分类")} value={category} onChange={e=>setCategory(e.target.value)} className="rounded-lg border border-border bg-background px-2 py-1"><option value="">{__ui("全部分类")}</option><option value="favorites">{__ui("我的收藏")}</option>{Array.from(new Set(tools.map(t=>t.category))).map(c=><option key={c} value={c}>{__ui(CATEGORY_LABELS[c])||c}</option>)}</RoundedSelect><span>{results.length} {__ui("项 · ↑↓ 选择，Enter 确认")}</span></div>
 <div className="overflow-y-auto p-2">{results.map((t,i)=>{const Icon=getToolIcon(t.icon);return <button key={t.id} data-result={i} onMouseEnter={()=>setIndex(i)} onClick={()=>onChoose(t.id)} className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left ${index===i?'bg-primary/10':'hover:bg-secondary'}`}><Icon size={19} className="shrink-0 text-primary"/><span className="min-w-0 flex-1"><span className="block text-sm font-medium">{t.name}</span><span className="block truncate text-xs text-muted-foreground">{__ui(t.description)}</span></span>{selected===t.id&&<Check size={16} className="text-primary"/>}</button>})}{!results.length&&<p className="p-8 text-center text-sm text-muted-foreground">{__ui("没有匹配工具，试试更短的关键词。")}</p>}</div></div></div>,document.body);
}
