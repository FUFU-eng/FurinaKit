import { Select as RoundedSelect } from "@/components/ui/primitives";
"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage, uiCount as __count } from "@/lib/language";
const __ui = __createUiText("components/tools/pdf-editor-tool.tsx");

import {tr} from "@/lib/language";
import {useEffect,useRef,useState} from 'react';
import {PDFDocument} from 'pdf-lib';
import type {PDFDocumentProxy} from 'pdfjs-dist';
import {Button,Input} from '@/components/ui/primitives';
import {EmptyDropzone} from './dropzone-empty';
import {saveOutputBlob,reportOutputSaved,openOutputDirectory} from '@/lib/output-directory';
import {assemblePdf,assertPdfEditorFile,assertPdfEditorPageCount,assertPdfEditorMergeSelection} from '@/lib/vendor/toolknit/pdf-pages';
import {consumePendingFiles} from '@/lib/file-handoff';
import {Undo2,Redo2,RotateCw,Copy,Trash2,Plus,Download,FileUp,ZoomIn,ZoomOut} from 'lucide-react';
type Page={id:string;sourceIndex:number;pageIndex:number;rotation:number};
type Source={name:string;bytes:Uint8Array;doc:PDFDocumentProxy};
const uid=()=>crypto.randomUUID();
function PageCanvas({page,sources,large=false,zoom=1}:{page:Page;sources:Source[];large?:boolean;zoom?:number}){
  const __locale = __useLanguage();
 const source=sources[page.sourceIndex];const canvas=useRef<HTMLCanvasElement>(null),host=useRef<HTMLDivElement>(null);const [error,setError]=useState('');
 useEffect(()=>{let ended=false,task:{cancel:()=>void}|undefined,started=false;
  const render=async()=>{if(started)return;started=true;setError('');try{const p=await source.doc.getPage(page.pageIndex+1);if(ended||!canvas.current)return;const rotation=(p.rotate+page.rotation)%360;const unit=p.getViewport({scale:1,rotation});const scale=(large?Math.min(1.5,620/unit.width)*zoom:115/Math.max(unit.width,unit.height));const ratio=Math.min(devicePixelRatio||1,1.5,4096/(unit.width*scale),4096/(unit.height*scale));const view=p.getViewport({scale:scale*ratio,rotation});const c=canvas.current;c.width=Math.ceil(view.width);c.height=Math.ceil(view.height);c.style.width=`${view.width/ratio}px`;c.style.height=`${view.height/ratio}px`;const ctx=c.getContext('2d');if(!ctx)throw new Error('无法创建预览画布');const t=p.render({canvasContext:ctx,viewport:view});task=t;await t.promise;}catch(e){if(!ended)setError(String(e));}};
  const observer=new IntersectionObserver(rows=>{if(rows.some(r=>r.isIntersecting))void render();},{rootMargin:'200px'});if(host.current)observer.observe(host.current);if(large)void render();return()=>{ended=true;observer.disconnect();task?.cancel();};
 },[page.id,page.rotation,source,large,zoom]);
 return <div ref={host} className="flex min-h-28 items-center justify-center"><canvas ref={canvas} className="bg-white shadow-sm"/>{error&&<p role="alert" className="max-w-xs text-xs text-destructive">{__msg(error)}</p>}</div>;
}
export function PdfEditorTool({active=true}:{active?:boolean}={}){
  const __locale = __useLanguage();
 const activeRef=useRef(active);activeRef.current=active;
 const [sources,setSources]=useState<Source[]>([]),[pages,setPages]=useState<Page[]>([]),[selected,setSelected]=useState<string[]>([]),[current,setCurrent]=useState(''),[past,setPast]=useState<Page[][]>([]),[future,setFuture]=useState<Page[][]>([]),[busy,setBusy]=useState(false),[message,setMessage]=useState('选择PDF开始编辑；每次操作会立即更新预览'),[error,setError]=useState(''),[zoom,setZoom]=useState(1),[destination,setDestination]=useState('1'),[range,setRange]=useState(''),[copies,setCopies]=useState('1'),[blankSize,setBlankSize]=useState('same');
 const input=useRef<HTMLInputElement>(null),append=useRef<HTMLInputElement>(null),drag=useRef(''),lock=useRef(false),alive=useRef(true),sourceRef=useRef<Source[]>([]);sourceRef.current=sources;
 const act=async(fn:()=>Promise<void>)=>{if(lock.current)return;lock.current=true;setBusy(true);setError('');try{await fn();}catch(e){if(alive.current)setError(e instanceof Error?e.message:String(e));}finally{lock.current=false;if(alive.current)setBusy(false);}};
 const load=async(file:File,add=false)=>act(async()=>{
  assertPdfEditorFile(file.name,file.size);const bytes=new Uint8Array(await file.arrayBuffer());
  assertPdfEditorMergeSelection([...(add?sources:[]),{name:file.name}],(add?sources.reduce((n,s)=>n+s.bytes.length,0):0)+bytes.length);
  const pdfjs=await import('pdfjs-dist');pdfjs.GlobalWorkerOptions.workerSrc='/pdf.worker.min.mjs';const task=pdfjs.getDocument({data:bytes.slice()});let doc:PDFDocumentProxy;try{doc=await task.promise;}catch(e){void task.destroy();throw e;}
  try{assertPdfEditorPageCount((add?pages.length:0)+doc.numPages);}catch(e){void doc.destroy();throw e;}
  if(!alive.current){void doc.destroy();return;}
  const sourceIndex=add?sources.length:0;const extra=Array.from({length:doc.numPages},(_,pageIndex)=>({id:uid(),sourceIndex,pageIndex,rotation:0}));
  if(add){setSources([...sources,{name:file.name,bytes,doc}]);commit([...pages,...extra],`已追加 ${extra.length} 页`);}
  else{for(const old of sourceRef.current)void old.doc.destroy();setSources([{name:file.name,bytes,doc}]);setPages(extra);setPast([]);setFuture([]);setSelected([extra[0].id]);setCurrent(extra[0].id);setMessage(`已加载 ${extra.length} 页`);}
 });
 useEffect(()=>{alive.current=true;const receive=(e:Event)=>{if(!activeRef.current)return;const f=(e as CustomEvent<File[]>).detail?.[0];if(f)void load(f);};window.addEventListener('furinakit:inject-files',receive);const pending=consumePendingFiles();if(pending?.length)void load(pending[0]);return()=>{alive.current=false;window.removeEventListener('furinakit:inject-files',receive);for(const s of sourceRef.current)void s.doc.destroy();};},[]);
 const commit=(next:Page[],label:string)=>{if(!next.length){setError('至少保留一页，不能删除全部页面');return;}if(next.length>500){setError('最多保留500页');return;}setPast(p=>[...p,pages].slice(-40));setFuture([]);setPages(next);setSelected(ids=>ids.filter(id=>next.some(p=>p.id===id)));if(!next.some(p=>p.id===current))setCurrent(next[0].id);setMessage(label);setError('');};
 const undo=()=>{if(!past.length||busy)return;const p=past[past.length-1];setFuture(f=>[pages,...f]);setPast(past.slice(0,-1));setPages(p);setSelected([]);setCurrent(p[0].id);setMessage('已撤销，预览已恢复');};
 const redo=()=>{if(!future.length||busy)return;const p=future[0];setPast(h=>[...h,pages]);setFuture(future.slice(1));setPages(p);setSelected([]);setCurrent(p[0].id);setMessage('已重做，预览已更新');};
 const chosen=()=>selected.length?selected:[current];
 const reorder=(id:string,to:number)=>{const next=pages.filter(p=>p.id!==id),p=pages.find(p=>p.id===id);if(!p)return;next.splice(Math.max(0,Math.min(next.length,to)),0,p);commit(next,'页面顺序已更新');};
 const blank=()=>act(async()=>{const s=pages.find(p=>p.id===current)||pages[0];const original=await sources[s.sourceIndex].doc.getPage(s.pageIndex+1);const view=original.getViewport({scale:1,rotation:(original.rotate+s.rotation)%360});const doc=await PDFDocument.create();doc.addPage(blankSize==='a4'?[595.28,841.89]:[view.width,view.height]);const bytes=await doc.save();const pdfjs=await import('pdfjs-dist');const proxy=await pdfjs.getDocument({data:bytes.slice()}).promise;if(!alive.current){void proxy.destroy();return;}const p={id:uid(),sourceIndex:sources.length,pageIndex:0,rotation:0};setSources([...sources,{name:'空白页',bytes,doc:proxy}]);const next=[...pages];next.splice(pages.indexOf(s)+1,0,p);commit(next,'已在当前页后插入空白页');setCurrent(p.id);setSelected([p.id]);});
 const save=(onlySelected=false)=>act(async()=>{const list=onlySelected?pages.filter(p=>selected.includes(p.id)):pages;if(!list.length)throw new Error('没有可导出的页面');setMessage('正在组装并保存PDF…');const bytes=await assemblePdf({sources,pages:list,onProgress:({done,total}:{done:number;total:number})=>{if(alive.current)setMessage(`正在导出 ${done}/${total} 页`);}});const path=await saveOutputBlob(new Blob([new Uint8Array(bytes)],{type:'application/pdf'}),`${sources[0].name.replace(/\.pdf$/i,'')}-${onlySelected?'选页':'编辑'}.pdf`);reportOutputSaved(path);if(alive.current)setMessage(`已保存：${path}`);});
 const page=pages.find(p=>p.id===current)||pages[0];
 return <div className="space-y-3" onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&!(e.target as HTMLElement).closest('input,textarea')){if(e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?redo():undo();}if(e.key.toLowerCase()==='y'){e.preventDefault();redo();}}}}>
  <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
   <span data-furinakit-file-field><input ref={input} type="file" accept=".pdf" hidden disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(f)void load(f);e.target.value='';}}/><Button variant="outline" size="sm" disabled={busy} onClick={()=>input.current?.click()}><FileUp size={14}/>{pages.length?__ui("换文件"):__ui("打开PDF")}</Button></span>
   <Button variant="outline" size="sm" disabled={busy||!past.length} onClick={undo}><Undo2 size={14}/>{__ui("撤销")}</Button><Button variant="outline" size="sm" disabled={busy||!future.length} onClick={redo}><Redo2 size={14}/>{__ui("重做")}</Button>
   <span className="mr-auto text-xs text-muted-foreground">{pages.length?__msg("{0} 页 · 已选 {1} 页", pages.length, selected.length):__ui("本机处理 · 不上传文件")}</span>
   <Button size="sm" disabled={busy||!pages.length} onClick={()=>void save()}><Download size={14}/>{busy?__ui("处理中…"):__ui("导出PDF")}</Button><Button size="sm" variant="outline" onClick={()=>void openOutputDirectory().catch(e=>setError(String(e)))}>{__ui("打开输出目录")}</Button>
  </div>
  <p role="status" className="break-all rounded-lg bg-primary/5 px-3 py-2 text-xs text-primary">{__msg(message)}</p>{error&&<p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{__msg(error)}</p>}
  {!pages.length?<EmptyDropzone title={__ui("打开PDF，立即预览与编辑")} subtitle={__ui("页面排序、复制、删除、旋转、插页、追加；撤销/重做与选页导出")} accept=".pdf" onFiles={files=>{if(files[0])void load(files[0]);}}/>:<>
   <div className="flex flex-wrap gap-2 rounded-xl border border-border bg-card p-3">
    <Button size="sm" variant="outline" disabled={busy} onClick={()=>setSelected(pages.map(p=>p.id))}>{__ui("全选")}</Button><Button size="sm" variant="ghost" onClick={()=>setSelected([])}>{__ui("清除选择")}</Button>
    <Button size="sm" variant="outline" disabled={busy} onClick={()=>{const ids=chosen();commit(pages.map(p=>ids.includes(p.id)?{...p,rotation:(p.rotation+90)%360}:p),'已旋转90°，右侧预览与导出同步');}}><RotateCw size={14}/>{__ui("旋转")}</Button>
    <Button size="sm" variant="outline" disabled={busy} onClick={()=>{const n=Number(copies);if(!Number.isInteger(n)||n<1||n>50){setError('复制份数应为1—50的整数');return;}const ids=chosen();if(pages.length+ids.length*n>500){setError('复制后超过500页限制');return;}commit(pages.flatMap(p=>ids.includes(p.id)?[p,...Array.from({length:n},()=>({...p,id:uid()}))]:[p]),`已为选中页面各增加 ${n} 份副本`);}}><Copy size={14}/>{__ui("复制")}</Button>
    <Button size="sm" variant="outline" disabled={busy} onClick={()=>{const ids=chosen();commit(pages.filter(p=>!ids.includes(p.id)),'已删除选中页面，可撤销');}}><Trash2 size={14}/>{__ui("删除")}</Button>
    <Button size="sm" variant="outline" disabled={busy||pages.length>=500} onClick={()=>void blank()}><Plus size={14}/>{__ui("插空白页")}</Button>
    <span data-furinakit-file-field><input ref={append} type="file" accept=".pdf" hidden disabled={busy} onChange={e=>{const f=e.target.files?.[0];if(f)void load(f,true);e.target.value='';}}/><Button size="sm" variant="outline" disabled={busy} onClick={()=>append.current?.click()}>{__ui("追加PDF")}</Button></span>
    <Button size="sm" variant="outline" disabled={busy} onClick={()=>commit([...pages].reverse(),'已倒序全部页面')}>{__ui("倒序")}</Button>
    <Button size="sm" variant="outline" disabled={busy||!selected.length} onClick={()=>void save(true)}>{__ui("导出选中页")}</Button>
   </div>
   <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground"><label className="flex items-center gap-2">{__ui("每页增加副本")}<Input type="number" min={1} max={50} value={copies} disabled={busy} onChange={e=>setCopies(e.target.value)} className="h-8 w-16"/></label><label className="flex items-center gap-2">{__ui("空白页尺寸")}<RoundedSelect aria-label={__ui("空白页尺寸")} value={blankSize} disabled={busy} onChange={e=>setBlankSize(e.target.value)} className="rounded border border-border bg-card p-2"><option value="same">{__ui("与当前页相同")}</option><option value="a4">{__ui("A4竖向")}</option></RoundedSelect></label></div>
   <div className="flex flex-wrap items-center gap-2 rounded-lg bg-muted/40 p-3"><label htmlFor="pdf-page-range" className="text-xs">{__ui("按页码选择")}</label><Input id="pdf-page-range" placeholder={__ui("例如 1-3,5,8")} value={range} onChange={e=>setRange(e.target.value)} className="h-8 w-44"/><Button size="sm" variant="outline" disabled={busy} onClick={()=>{try{const ids=new Set<string>();for(const piece of range.split(/[,，]/)){const m=piece.trim().match(/^(\d+)(?:\s*-\s*(\d+))?$/);if(!m)throw new Error('页码格式应为1-3,5');const a=Number(m[1]),b=Number(m[2]||m[1]);if(a<1||b<a||b>pages.length)throw new Error('页码超出当前文档范围');for(let i=a;i<=b;i++)ids.add(pages[i-1].id);}setSelected([...ids]);setCurrent([...ids][0]);setError('');setMessage(`已选择 ${ids.size} 页，可旋转、复制、删除或选页导出`);}catch(e){setError(String(e));}}}>{__ui("选择页码")}</Button></div>
   <div className="grid gap-4 lg:grid-cols-[minmax(220px,1fr)_minmax(0,2fr)]">
    <section className="rounded-xl border border-border bg-card p-3"><div className="mb-3 flex items-center gap-2 text-xs"><span>{__ui("当前页移到")}</span><Input type="number" min={1} max={pages.length} value={destination} onChange={e=>setDestination(e.target.value)} className="h-8 w-16"/><Button size="sm" variant="outline" disabled={busy} onClick={()=>{const n=Number(destination);if(!Number.isInteger(n)||n<1||n>pages.length){setError('请输入有效页码');return;}reorder(page.id,n-1);}}>{__ui("移动")}</Button></div><p className="mb-3 text-xs text-muted-foreground">{__ui("拖动缩略图排序；点击预览，Ctrl/⌘点击多选。")}</p><div className="grid max-h-[65vh] grid-cols-2 gap-3 overflow-y-auto p-1">{pages.map((p,i)=><button key={p.id} disabled={busy} draggable={!busy} onDragStart={e=>{drag.current=p.id;e.dataTransfer.setData('application/x-furinakit-pdf-page',p.id);}} onDragOver={e=>{if(drag.current)e.preventDefault();}} onDrop={e=>{if(!drag.current)return;e.preventDefault();e.stopPropagation();reorder(drag.current,i);drag.current='';}} onDragEnd={()=>{drag.current='';}} onClick={e=>{setCurrent(p.id);setSelected(ids=>e.ctrlKey||e.metaKey?ids.includes(p.id)?ids.filter(x=>x!==p.id):[...ids,p.id]:[p.id]);}} className={`relative overflow-hidden rounded-lg border-2 p-2 transition-colors ${selected.includes(p.id)?'border-primary bg-primary/5':p.id===current?'border-primary/50':'border-border'}`}><PageCanvas key={`${p.id}-${p.rotation}`} page={p} sources={sources}/><span className="mt-2 block text-xs">{__ui("第")}{__count(i+1, "页")} {p.rotation?` · ↻${p.rotation}°`:''}</span></button>)}</div></section>
    <section className="min-w-0 rounded-xl border border-border bg-card"><header className="flex items-center justify-between gap-2 border-b border-border p-3"><span className="truncate text-xs">{__ui("实时预览 · 第")}{pages.indexOf(page)+1} {__ui("页 ·")}{sources[page.sourceIndex].name}</span><div className="flex shrink-0 items-center gap-1"><button title={__ui("缩小")} onClick={()=>setZoom(z=>Math.max(.5,z-.25))}><ZoomOut size={17}/></button><span className="w-12 text-center text-xs">{Math.round(zoom*100)}%</span><button title={__ui("放大")} onClick={()=>setZoom(z=>Math.min(3,z+.25))}><ZoomIn size={17}/></button></div></header><div className="max-h-[70vh] overflow-auto bg-secondary/40 p-5"><PageCanvas key={`${page.id}-${page.rotation}-${zoom}`} page={page} sources={sources} large zoom={zoom}/></div></section>
   </div>
   <p className="text-xs leading-5 text-muted-foreground">{tr("原文件不改动。当前为页面级编辑，不是扫描件OCR或原文排版编辑。重排/复制跨文档页面时，表单外观保留但可能不再交互，数字签名需重新签署。","Original files are preserved. This organizes pages, not scanned OCR or original text layout. Cross-document copying may flatten form interactions; digital signatures must be applied again.")}</p>
  </>}
 </div>;
}
