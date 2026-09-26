
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("pages/tool-page.tsx");
import {useCaptureState} from '@/lib/capture-actions';
import {markPendingFile} from '@/lib/pending-origin';
"use client";
import { useEffect, useRef, useState } from 'react';
import { notFound } from 'next/navigation';
import { getToolById, downloadsEnabled } from '@furinakit/shared';
import { ToolRunner } from '@/components/tools/tool-runner';
import { deliverFiles, usePendingFiles } from '@/lib/pending-files-context';
import { acceptsFile, loadPendingFile, type PendingFileItem } from '@/lib/pending-file-model';

export default function ToolPage({toolId}:{toolId:string}) {
  const __locale = __useLanguage();
  const tool=getToolById(toolId);
  const {active:captureAction,clear:clearCapture}=useCaptureState();
  const {pendingFiles,revision}=usePendingFiles();
  const root=useRef<HTMLDivElement>(null);
  const [status,setStatus]=useState('');
  const [selection,setSelection]=useState<{input:HTMLInputElement;items:PendingFileItem[];token:number}|null>(null);
  const generation=useRef(0);
  const lastActiveRevision=useRef(revision);
  if(pendingFiles.length) lastActiveRevision.current=revision;
  const [choice,setChoice]=useState<PendingFileItem|null>(null);
  useEffect(()=>{setChoice(null)},[revision,toolId]);
  useEffect(()=>{
    const token=++generation.current;
    setSelection(null);setStatus('');
    if(!pendingFiles.length || captureAction) return;
    let stopped=false; let timer:ReturnType<typeof setTimeout>; let started=false;
    const valid=()=>!stopped && generation.current===token;
    const inject=async(input:HTMLInputElement,items:PendingFileItem[])=>{
      const max=Number(input.dataset.maxFiles);
      if(Number.isFinite(max)&&max>0) items=items.slice(0,max);
      started=true;setStatus('正在载入待办文件…');
      try {
        // Sequential decoding avoids simultaneous base64 copies of every large media file.
        const files:File[]=[];
        for(const item of items){files.push(await loadPendingFile(item,valid));if(!valid())return;}
        if(!valid() || !input.isConnected)return;
        files.forEach(markPendingFile);
        deliverFiles(input,files);
        setStatus(`已载入 ${files.length} 个文件${pendingFiles.length>items.length?` · 另 ${pendingFiles.length-items.length} 个保留在待办中`:''}`);
      } catch(e) {if(valid())setStatus(e instanceof Error?e.message:'文件载入失败，请重新拖入');}
    };
    const discover=()=>{
      if(started || !valid())return;
      const inputs=Array.from(root.current?.querySelectorAll<HTMLInputElement>('input[type=file]:not([disabled]):not([data-pending-ignore])') || []).filter(input=>!input.matches(':disabled')&&!input.closest('[hidden]'));
      if(!inputs.length)return;
      const metadata=tool?.inputs.filter(i=>i.type==='file') || [];
      const candidates=inputs.map((input,index)=>({input,items:pendingFiles.filter(f=>acceptsFile(f,input.accept || metadata[index]?.accept || ''))}));
      const match=candidates.find(c=>c.items.length>0);
      if(!match){started=true;setStatus('此工具不支持该文件类型');return;}
      if(!match.input.multiple && match.items.length>1){
        const picked=choice && match.items.includes(choice) ? choice:null;
        if(picked)void inject(match.input,[picked]);
        else {started=true;setStatus(`此工具一次接收一个文件，请选择（共 ${match.items.length} 个可用）`);setSelection({...match,token});}
      }else void inject(match.input,match.items);
    };
    const observer=new MutationObserver(discover);
    if(root.current)observer.observe(root.current,{childList:true,subtree:true,attributes:true,attributeFilter:['type','accept','disabled']});
    discover();
    timer=setTimeout(()=>{if(valid()&&!started){setStatus('此工具不支持该文件类型');started=true;}},2500);
    return ()=>{stopped=true;observer.disconnect();clearTimeout(timer)};
  },[toolId,tool,revision,pendingFiles,choice,captureAction]);
  if(!tool || tool.comingSoon || (tool.selfHostOnly&&!downloadsEnabled()))notFound();
  return <div ref={root} data-pending-tool={toolId}>
    {captureAction && <div role="status" className="mb-3 rounded-xl border border-primary/25 bg-primary/5 px-4 py-3 text-sm">{__ui("当前处理来自悬浮截图的图片，原待办未替换。")}<button className="ml-3 underline" onClick={clearCapture}>{__ui("结束截图联动")}{pendingFiles.length?__ui("，恢复待办"):""}</button></div>}
    {!!pendingFiles.length && status && <div role="status" className="mb-3 rounded-xl border border-border bg-secondary/40 px-4 py-2.5 text-sm text-muted-foreground">{__msg(status)}</div>}
    {selection && <div className="mb-4 max-h-52 overflow-auto rounded-xl border border-border bg-card p-2" aria-label={__ui("选择待办文件")}>
      {selection.items.map((item,i)=><button key={`${item.path||item.name}-${i}`} className="block w-full truncate rounded-lg px-3 py-2 text-left text-sm hover:bg-primary/10" onClick={()=>{setSelection(null);setChoice(item)}}>{item.name}</button>)}
    </div>}
    <ToolRunner key={captureAction?`${toolId}:shot:${captureAction.requestId}`:`${toolId}:${lastActiveRevision.current}:ordinary`} toolId={toolId}/>
  </div>;
}
