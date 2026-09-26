
import { createUiText as __createUiText, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("lib/pending-files-context.tsx");
import {hasMultipleUploadFields} from "./drop-targets";
import { currentToolAccepts, recommendFiles } from "./file-recommendations";
"use client";

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import { getToolById } from '@furinakit/shared';
import { navigate } from '@/router';
import { acceptsFile, fromFiles, type PendingFileItem } from './pending-file-model';
import { setPendingFiles as setHandoff } from './file-handoff';
export type { PendingFileItem } from './pending-file-model';

interface PendingFilesContextType {
  pendingFiles: PendingFileItem[]; hasReplaced: boolean; isActive: boolean; revision: number;
  setPendingFiles: (files: PendingFileItem[], replaced?: boolean) => void;
  clearPendingFiles: () => void;
  isToolCompatible: (id: string, category?: string) => {compatible:boolean;reason?:string};
}
const empty: PendingFilesContextType = {pendingFiles:[],hasReplaced:false,isActive:false,revision:0,setPendingFiles:()=>{},clearPendingFiles:()=>{},isToolCompatible:()=>({compatible:true})};
const Context = createContext(empty);
/** Synthetic delivery is marked, so it cannot be mistaken for manual replacement. */
export function deliverFiles(input: HTMLInputElement, files: File[]) {
  const dt = new DataTransfer(); files.forEach(f => dt.items.add(f));
  input.files = dt.files;
  const replacement = new CustomEvent('furinakit:replace-input', {detail:files,cancelable:true});
  if (!input.dispatchEvent(replacement)) return; // shared dropzone supplies a replacement (not append) adapter
  const event = new Event('change', {bubbles:true});
  Object.defineProperty(event, 'furinakitDelivery', {value:true});
  input.dispatchEvent(event);
}
export function PendingFilesProvider({children}:{children:React.ReactNode}) {
  const __locale = __useLanguage();
  const [files,setFiles] = useState<PendingFileItem[]>([]);
  const [revision,setRevision] = useState(0);
  const [hasReplaced,setReplaced] = useState(false);
  const current = useRef(files); current.current = files;
  const [manual,setManual] = useState<{files:File[];input?:HTMLInputElement;drop?:{target:EventTarget;x:number;y:number};revision:number}|null>(null);
  const rev = useRef(0);
  const setPendingFiles = useCallback((next:PendingFileItem[], replaced?:boolean) => {
    setReplaced(replaced ?? current.current.length > 0);
    current.current = next; setFiles(next); setRevision(++rev.current); setManual(null);
    setHandoff([]); // never leak old one-shot handoff into a later tool
    // Runtime state only: serialized File objects and stale paths must not revive after exit.
    for (const store of [localStorage,sessionStorage]) {
      store.removeItem('furinakit_pending_files'); store.removeItem('furinakit_has_replaced');
    }
    delete (window as any).__FURINAKIT_PENDING_ITEMS__;
  },[]);
  const clearPendingFiles = useCallback(()=>setPendingFiles([],false),[setPendingFiles]);
  useEffect(()=>{
    // The native layer delivers exactly one DOM event, files before navigation.
    const onPending = (e:Event)=>{
      const detail = (e as CustomEvent).detail;
      if (Array.isArray(detail?.files)) setPendingFiles(detail.files);
    };
    const onTarget = (e:Event)=>{
      const p = (e as CustomEvent).detail || {};
      if (Array.isArray(p.pendingFilesData) && p.pendingFilesData.length) setPendingFiles(p.pendingFilesData);
      if (p.toolId) navigate(`/tools/${encodeURIComponent(p.toolId)}`);
      else if (p.category) navigate(`/?c=${encodeURIComponent(p.category==='video'?'download':p.category)}`);
    };
    const change = (e:Event)=>{
      if(hasMultipleUploadFields())return;
      if ((e as any).furinakitDelivery || !current.current.length) return;
      const input = e.target;
      if (!(input instanceof HTMLInputElement) || input.type !== 'file' || !input.files?.length) return;
      e.stopImmediatePropagation();
      setManual({files:Array.from(input.files),input,revision:rev.current});
    };
    const drop = (e:DragEvent)=>{
      if(e.target instanceof Element&&e.target.closest("[data-dedup-drop]"))return;
      if(hasMultipleUploadFields())return;
      if (!current.current.length || (e as any).furinakitDelivery || !e.dataTransfer?.files.length || !location.pathname.startsWith('/tools/')) return;
      if(!currentToolAccepts(Array.from(e.dataTransfer.files))){e.preventDefault();e.stopImmediatePropagation();recommendFiles(Array.from(e.dataTransfer.files),true);return;}
      e.preventDefault(); e.stopImmediatePropagation();
      const input = (e.target as Element)?.closest?.('[data-furinakit-dropzone]')?.querySelector<HTMLInputElement>('input[type=file]') || document.querySelector<HTMLInputElement>('[data-pending-tool] input[type=file]');
      setManual({files:Array.from(e.dataTransfer.files),input:input || undefined,drop:{target:e.target!,x:e.clientX,y:e.clientY},revision:rev.current});
    };
    window.addEventListener('furinakit:pending-files',onPending);
    window.addEventListener('furinakit:open-target',onTarget);
    window.addEventListener('change',change,true);
    // Must precede the legacy window drop-anywhere handler: it now checks pending mode.
    window.addEventListener('drop',drop,true);
    const initial = (window as any).__FURINAKIT_OPEN_TARGET__;
    if (initial) { delete (window as any).__FURINAKIT_OPEN_TARGET__; onTarget(new CustomEvent('target',{detail:initial})); }
    (window as any).__FURINAKIT_PENDING_READY__ = true;
    return ()=>{
      window.removeEventListener('furinakit:pending-files',onPending);window.removeEventListener('furinakit:open-target',onTarget);
      window.removeEventListener('change',change,true);window.removeEventListener('drop',drop,true);
      delete (window as any).__FURINAKIT_PENDING_READY__;
    };
  },[setPendingFiles]);
  useEffect(()=>{ (window as any).__FURINAKIT_PENDING_ACTIVE__ = files.length > 0; return ()=>{(window as any).__FURINAKIT_PENDING_ACTIVE__=false}; },[files]);
  const chooseManual = (replace:boolean)=>{
    if (!manual || manual.revision !== rev.current) {setManual(null);return;}
    const selected=manual;
    if(replace) {setPendingFiles(fromFiles(selected.files),true); return;}
    clearPendingFiles();
    if(selected.input?.isConnected) deliverFiles(selected.input,selected.files);
    else if(selected.drop){
      const dt=new DataTransfer();selected.files.forEach(f=>dt.items.add(f));
      const event=new DragEvent('drop',{bubbles:true,cancelable:true,dataTransfer:dt,clientX:selected.drop.x,clientY:selected.drop.y});
      Object.defineProperty(event,'furinakitDelivery',{value:true});selected.drop.target.dispatchEvent(event);
    }
  };
  const isToolCompatible=useCallback((id:string)=>{
    const inputs=getToolById(id)?.inputs.filter(i=>i.type==='file') || [];
    const compatible=!files.length || files.some(f=>inputs.some(i=>acceptsFile(f,i.accept)));
    return {compatible,reason:compatible?undefined:'此工具不支持该文件类型'};
  },[files]);
  return <Context.Provider value={{pendingFiles:files,revision,hasReplaced,isActive:!!files.length,setPendingFiles,clearPendingFiles,isToolCompatible}}>
    {children}
    {manual && <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/35 p-6 backdrop-blur-sm" onKeyDown={e=>{if(e.key==='Escape')setManual(null)}}>
      <section role="dialog" aria-modal="true" aria-labelledby="pending-replace-title" className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl">
        <h2 id="pending-replace-title" className="text-base font-semibold">{__ui("如何使用新文件？")}</h2>
        <p className="my-3 text-sm text-muted-foreground">{__ui("已选择")}{manual.files.length} {__ui("个新文件。当前正在使用文件待办模式。")}</p>
        <button autoFocus className="mb-2 w-full rounded-xl bg-primary/10 p-3 text-left text-sm text-primary" onClick={()=>chooseManual(true)}>{__ui("替换目标文件")}<span className="mt-1 block text-xs opacity-70">{__ui("继续待办，之后各工具使用这批新文件")}</span></button>
        <button className="w-full rounded-xl border border-border p-3 text-left text-sm" onClick={()=>chooseManual(false)}>{__ui("退出文件待办模式")}<span className="mt-1 block text-xs text-muted-foreground">{__ui("新文件只用于当前工具")}</span></button>
        <button className="mt-3 w-full p-2 text-sm text-muted-foreground" onClick={()=>{if(manual.input)manual.input.value='';setManual(null)}}>{__ui("取消，保留原目标")}</button>
      </section>
    </div>}
  </Context.Provider>;
}
export const usePendingFiles=()=>useContext(Context);
