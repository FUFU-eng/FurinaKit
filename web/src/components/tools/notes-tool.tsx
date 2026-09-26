
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/notes-tool.tsx");
import {createPortal} from "react-dom";
import {ShortcutHint} from "@/lib/tool-shortcut";
import {useEscapeDismiss} from "@/lib/use-escape-dismiss";
import { NotesEditor, noteText } from "./notes-editor";
import { Check, PanelLeftClose, PanelLeftOpen } from "lucide-react";
"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Plus, Search, Pin, Paperclip, ExternalLink, Trash2, Save, FileText, ImageIcon, Download, Loader2, Copy } from "lucide-react";
import { Button, Input, Select } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { stageFormData, discardStagedUploads } from "@/lib/native-upload";
import { ensureOutputDirectory } from "@/lib/output-directory";
import { consumePendingFiles } from "@/lib/file-handoff";
interface Asset { id:string; name:string; size:number; mime:string }
interface Note { group?:string;position?:number;id:string;title:string;body:string;created:number;updated:number;revision:number;pinned:boolean;assets:Asset[];attachments?:number }
const rpc=<T,>(action:string,args:Record<string,unknown>={})=>invoke<T>("notes_command",{action,args});
const draftKey=(id:string)=>`furina:note-draft:${id}:${new URLSearchParams(window.location.search).get("window")||"main"}`;
const bytes=(n:number)=>n<1024?`${n} B`:n<1048576?`${(n/1024).toFixed(1)} KiB`:`${(n/1048576).toFixed(1)} MiB`;
function Attachment({asset}:{asset:Asset}) {
  const __locale = __useLanguage();
  const [url,setUrl]=useState("");const {toast}=useToast();
  useEffect(()=>{let alive=true;if(asset.mime.startsWith("image/"))void rpc<{url:string}>("asset-preview",{id:asset.id}).then(v=>{if(alive)setUrl(v.url);}).catch(()=>{});return()=>{alive=false;};},[asset.id,asset.mime]);
  const action=async(save=false)=>{try{if(save)await ensureOutputDirectory();await rpc(save?"asset-save":"asset-open",{id:asset.id});if(save)toast({title:"附件已保存到默认输出目录",variant:"success"});}catch(e){toast({title:"附件操作失败",description:String(e),variant:"error"});}};
  return <div className="group flex min-w-0 items-center gap-2 rounded-xl border border-border bg-background/60 p-2">
    <button title={__ui("打开附件副本")} onClick={()=>void action()} className="flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-primary/10 text-primary">{url?<img src={url} alt={__ui("附件预览")} className="h-full w-full object-cover"/>:asset.mime.startsWith("image/")?<ImageIcon size={17}/>:<FileText size={17}/>}</button>
    <button onClick={()=>void action()} className="min-w-0 flex-1 text-left"><p className="truncate text-xs font-medium" title={asset.name}>{asset.name}</p><p className="text-[10px] text-muted-foreground">{bytes(asset.size)} {__ui("· 本地副本")}</p></button>
    <button className="rounded-lg p-2 hover:bg-muted" title={__ui("导出到默认输出目录")} onClick={()=>void action(true)}><Download size={13}/></button>
  </div>;
}
export function NotesTool() {
  const __locale = __useLanguage();
  const {toast}=useToast();
  const [sidebar,setSidebar]=useState(true),[group,setGroup]=useState("all");
  const dragNote=useRef<string|null>(null);
  const [notes,setNotes]=useState<Note[]>([]),[query,setQuery]=useState(""),[note,setNote]=useState<Note|null>(null);
  const [dirty,setDirty]=useState(false),[saving,setSaving]=useState(false),[attaching,setAttaching]=useState(false),[error,setError]=useState("");
  const [confirmDelete,setConfirmDelete]=useState(false);
  const [copied,setCopied]=useState(false);const copiedTimer=useRef<ReturnType<typeof setTimeout>|null>(null);
  useEffect(()=>{setCopied(false);if(copiedTimer.current)clearTimeout(copiedTimer.current);return()=>{if(copiedTimer.current)clearTimeout(copiedTimer.current);};},[note?.id]);
  const copyNote=async()=>{const copiedId=note?.id;try{await navigator.clipboard.writeText(noteText(note?.body||""));if(!alive.current||current.current?.id!==copiedId)return;setCopied(true);if(copiedTimer.current)clearTimeout(copiedTimer.current);copiedTimer.current=setTimeout(()=>setCopied(false),4000);}catch(e){setError(String(e));}};
  useEscapeDismiss(()=>{if(!saving&&!attaching)setConfirmDelete(false);},confirmDelete,100);
  const [navigating,setNavigating]=useState(false);
  const navigatingRef=useRef(false),attachingRef=useRef(false),saveBlocked=useRef(false);
  const current=useRef<Note|null>(null),dirtyRef=useRef(false),saveLock=useRef<Promise<boolean>|null>(null),alive=useRef(true),generation=useRef(0);
  const input=useRef<HTMLInputElement>(null),queryRef=useRef(query);queryRef.current=query;
  const loadList=useCallback(async()=>{const version=++generation.current;try{const result=await rpc<{notes:Note[]}>("list",{query:queryRef.current});if(alive.current&&generation.current===version)setNotes(result.notes);}catch(e){if(alive.current)setError(String(e));}},[]);
  const setCurrent=(n:Note|null)=>{saveBlocked.current=false;current.current=n;dirtyRef.current=false;setNote(n);setDirty(false);setError("");};
  const save=useCallback(async():Promise<boolean>=>{
    if(saveLock.current) {const ok=await saveLock.current;if(!ok)return false;if(dirtyRef.current)return saveRef.current();return true;}
    const snapshot=current.current;if(!snapshot||!dirtyRef.current)return true;
    setSaving(true);setError("");
    const work=(async()=>{try{
      const saved=await rpc<Note>("save",{...snapshot});
      if(!alive.current)return true;
      if(current.current?.id===saved.id){
        const unchanged=current.current.title===snapshot.title&&current.current.body===snapshot.body&&current.current.pinned===snapshot.pinned;
        const next=unchanged?saved:{...current.current,revision:saved.revision,updated:saved.updated};current.current=next;setNote(next);dirtyRef.current=!unchanged;setDirty(!unchanged);
        if(unchanged)localStorage.removeItem(draftKey(saved.id));
      }await loadList();return true;
    }catch(e){saveBlocked.current=true;if(alive.current)setError(String(e));return false;}finally{saveLock.current=null;if(alive.current)setSaving(false);}})();
    saveLock.current=work;const ok=await work;return ok&&alive.current&&dirtyRef.current?saveRef.current():ok;
  },[loadList]);
  const saveRef=useRef<()=>Promise<boolean>>(save);saveRef.current=save;
  const change=(patch:Partial<Note>)=>{if(!current.current||navigatingRef.current)return;saveBlocked.current=false;const next={...current.current,...patch};current.current=next;dirtyRef.current=true;setNote(next);setDirty(true);setError("");try{localStorage.setItem(draftKey(next.id),JSON.stringify(next));}catch{setError("草稿缓存空间不足，请及时保存");}};
  const select=async(id:string)=>{
    if(navigatingRef.current||attachingRef.current)return;navigatingRef.current=true;setNavigating(true);
    try{if(!await save())return;const loaded=await rpc<Note>("get",{id});if(!alive.current)return;setCurrent(loaded);setConfirmDelete(false);
      const raw=localStorage.getItem(draftKey(id));if(raw){const draft=JSON.parse(raw) as Note;if(draft.id===id&&typeof draft.body==="string"&&typeof draft.title==="string"&&(draft.body!==loaded.body||draft.title!==loaded.title||draft.pinned!==loaded.pinned)){current.current={...loaded,title:draft.title,body:draft.body,pinned:!!draft.pinned};setNote(current.current);dirtyRef.current=true;setDirty(true);saveBlocked.current=true;setError("已恢复此窗口未保存的草稿，请核对后点击保存。");}else localStorage.removeItem(draftKey(id));}
    }catch(e){if(alive.current)setError(String(e));}finally{navigatingRef.current=false;if(alive.current)setNavigating(false);}
  };
  const create=async(fromAttachment=false)=>{if(navigatingRef.current||(!fromAttachment&&attachingRef.current))return;navigatingRef.current=true;setNavigating(true);try{if(!await save())return;const n=await rpc<Note>("save",{title:"",body:"",pinned:false});if(alive.current){setCurrent(n);await loadList();}return n;}catch(e){if(alive.current)setError(String(e));}finally{navigatingRef.current=false;if(alive.current)setNavigating(false);}};
  const attach=async(files:File[])=>{
    if(!files.length)return;if(attachingRef.current||navigatingRef.current){setError("正在保存附件或切换便签，请稍候再添加");return;}attachingRef.current=true;setAttaching(true);setError("");
    try{
      let active=current.current;if(!active){active=await create(true)||null;if(!active)return;}
      if(!await save())return;
      for(const file of files){
        const form=new FormData();form.append("file",file);const staged=await stageFormData(form);
        try{const token=(staged.__files as {uploadToken:string}[])[0].uploadToken;const updated=await rpc<Note>("attach",{id:active.id,token,mime:file.type||"application/octet-stream"});if(alive.current&&current.current?.id===active.id){current.current={...current.current,assets:updated.assets,updated:updated.updated};setNote(current.current);}}
        finally{await discardStagedUploads(staged);}
      }await loadList();toast({title:"附件已复制到本地便签",description:"原文件移动或删除不会影响这份副本",variant:"success"});
    }catch(e){setError(String(e));}finally{attachingRef.current=false;if(alive.current)setAttaching(false);}
  };
  const attachRef=useRef(attach);attachRef.current=attach;
  useEffect(()=>{alive.current=true;void loadList();let off:(()=>void)|undefined;
    void listen("notes-changed",()=>{void loadList();const n=current.current;if(n&&!dirtyRef.current&&!saveLock.current)void rpc<Note>("get",{id:n.id}).then(next=>{if(alive.current&&current.current?.id===n.id&&!dirtyRef.current&&!saveLock.current)setCurrent(next);}).catch(()=>{});}).then(fn=>{if(!alive.current)fn();else off=fn;});
    const inject=(event:Event)=>void attachRef.current((event as CustomEvent<File[]>).detail||[]);window.addEventListener("furinakit:inject-files",inject);
    const pending=consumePendingFiles();if(pending?.length)void attachRef.current(pending);
    return()=>{void saveRef.current();alive.current=false;++generation.current;off?.();window.removeEventListener("furinakit:inject-files",inject);};
  },[loadList]);
  useEffect(()=>{const timer=setTimeout(()=>void loadList(),160);return()=>clearTimeout(timer);},[query,loadList]);
  useEffect(()=>{if(!dirty||saveBlocked.current)return;const timer=setTimeout(()=>void saveRef.current(),800);return()=>clearTimeout(timer);},[note?.title,note?.body,note?.pinned,note?.revision,dirty,error]);
  const remove=async()=>{if(!note||!await save())return;const n=current.current;if(!n)return;try{await rpc("delete",{id:n.id,revision:n.revision});localStorage.removeItem(draftKey(n.id));setCurrent(null);setConfirmDelete(false);await loadList();}catch(e){setError(String(e));}};
  const plain=noteText(note?.body||"");
  const links=Array.from(new Set((plain.match(/https?:\/\/[^\s<>"'）)]+/g)||[]))).slice(0,12);
  const groups=Array.from(new Set(notes.map(n=>n.group||"").filter(Boolean)));
  const visible=notes.filter(n=>group==="all"||group==="pinned"&&n.pinned||n.group===group||group==="ungrouped"&&!n.group).sort((a,b)=>Number(b.pinned)-Number(a.pinned)||(a.position||Number.MAX_SAFE_INTEGER)-(b.position||Number.MAX_SAFE_INTEGER));
  const arrange=async(id:string,targetGroup:string,order?:string[])=>{try{await rpc("arrange",{id,group:targetGroup,order});await loadList();if(current.current?.id===id){current.current={...current.current,group:targetGroup};setNote(current.current);}}catch(e){setError(String(e));}};
  const moveBefore=(target:string)=>{const id=dragNote.current;dragNote.current=null;if(!id||id===target)return;const order=visible.map(n=>n.id).filter(key=>key!==id);order.splice(order.indexOf(target),0,id);void arrange(id,notes.find(n=>n.id===target)?.group||"",order);};
  return <section className="flex min-h-[460px] flex-col gap-3" data-no-folder-import onPaste={e=>{if(e.clipboardData.files.length){e.preventDefault();void attach(Array.from(e.clipboardData.files));}}} onKeyDown={e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="s"){e.preventDefault();void save();}}}>
    <input ref={input} type="file" multiple className="hidden" data-no-folder-import aria-label={__ui("添加便签附件")} disabled={attaching} onChange={e=>{void attach(Array.from(e.currentTarget.files||[]));e.currentTarget.value="";}}/>
    <div className="flex items-center gap-2"><button type="button" className="rounded-xl border border-border p-2.5 hover:bg-muted" title={sidebar?__ui("隐藏便签列表"):__ui("显示便签列表")} aria-label={sidebar?__ui("隐藏便签列表"):__ui("显示便签列表")} onClick={()=>setSidebar(!sidebar)}>{sidebar?<PanelLeftClose size={17}/>:<PanelLeftOpen size={17}/>}</button><div className="relative min-w-0 flex-1"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-muted-foreground"/><Input className="pl-9" placeholder={__ui("搜索便签内容")} value={query} onChange={e=>setQuery(e.target.value)}/></div><button type="button" aria-label={__ui("新建便签")} onClick={()=>void create()} disabled={saving||attaching} className="flex h-11 shrink-0 items-center gap-1.5 rounded-xl border border-amber-500/25 bg-amber-400/20 px-3 text-xs font-semibold text-amber-700 transition-colors hover:bg-amber-400/30 disabled:opacity-40 dark:text-amber-300"><Plus size={16}/>{__ui("新建便签")}</button></div>
    <div className="grid min-h-0 gap-3" style={{gridTemplateColumns:sidebar?"minmax(130px, 28%) minmax(0, 1fr)":"minmax(0, 1fr)"}}>
      {sidebar&&<aside className="min-w-0"><Select aria-label={__ui("筛选便签分组")} className="mb-2 min-w-0 text-xs" value={group} onChange={e=>setGroup(e.target.value)}><option value="all">{__ui("全部便签")}</option><option value="pinned">{__ui("已置顶")}</option><option value="ungrouped">{__ui("未分组")}</option>{groups.map(g=><option key={g} value={g}>{g}</option>)}</Select><nav className="flex max-h-[65vh] flex-col gap-2 overflow-y-auto" aria-label={__ui("便签列表")}>{visible.map(n=><button key={n.id} draggable={!attaching&&!navigating} onDragStart={e=>{dragNote.current=n.id;e.dataTransfer.setData("application/x-furina-note",n.id);e.dataTransfer.effectAllowed="move";}} onDragEnd={()=>{dragNote.current=null;}} onDragOver={e=>{if(dragNote.current)e.preventDefault();}} onDrop={e=>{if(dragNote.current){e.preventDefault();e.stopPropagation();moveBefore(n.id);}}} onClick={()=>void select(n.id)} disabled={attaching} className={`min-w-0 shrink-0 rounded-xl border p-3 text-left transition-colors ${note?.id===n.id?"border-primary/40 bg-primary/10":"border-border bg-card hover:bg-muted"}`}><h3 className="flex items-center gap-1 truncate text-xs font-semibold">{n.pinned&&<Pin size={11}/>}{n.title||__ui("未命名便签")}</h3><p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">{noteText(n.body)||__ui("空白便签")}</p><p className="mt-2 text-[10px] text-muted-foreground">{new Date(n.updated).toLocaleDateString()} {n.attachments?__msg(" · {0}个附件", n.attachments):""}</p></button>)}{!visible.length&&<p className="p-3 text-xs text-muted-foreground">{__ui("暂无便签")}</p>}</nav></aside>}
      <div className="min-w-0 rounded-2xl border border-border bg-card p-4">{note?<>
        <input disabled={navigating} value={note.title} maxLength={200} placeholder={__ui("便签标题")} aria-label={__ui("便签标题")} onChange={e=>change({title:e.target.value})} className="w-full bg-transparent text-base font-semibold outline-none"/>
        <div className="my-3 flex flex-wrap items-center gap-1 border-y border-border/70 py-2"><Button size="sm" variant="ghost" className="h-8 w-8 p-0" title={note.pinned?__ui("取消置顶"):__ui("置顶")} aria-label={note.pinned?__ui("取消置顶"):__ui("置顶")} onClick={()=>change({pinned:!note.pinned})}><Pin size={15}/></Button><Button size="sm" variant="ghost" className="h-8 w-8 p-0" title={__ui("添加附件")} aria-label={__ui("添加附件")} disabled={attaching} onClick={()=>input.current?.click()}>{attaching?<Loader2 size={13} className="animate-spin"/>:<Paperclip size={15}/>}</Button><Button size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label={copied?__ui("已复制"):__ui("复制内容")} title={copied?__ui("已复制"):__ui("复制内容")} onClick={()=>void copyNote()}>{copied?<Check size={15} className="text-emerald-500"/>:<Copy size={14}/>}</Button><Button size="sm" variant="ghost" className="h-8 w-8 p-0" onClick={()=>setConfirmDelete(true)} title={__ui("删除便签")}><Trash2 size={13}/></Button><div className="ml-auto flex min-w-0 items-center gap-1 text-xs"><Select aria-label={__ui("移动便签到分组")} value={note.group||""} onChange={e=>void arrange(note.id,e.target.value)} className="w-24 min-w-0 text-xs [&_button]:h-8 [&_button]:px-2"><option value="">{__ui("未分组")}</option>{Array.from(new Set([...groups,note.group].filter(Boolean))).map(g=><option key={g} value={g}>{g}</option>)}</Select><button type="button" title={__ui("新建分组")} aria-label={__ui("新建分组")} className="rounded-lg px-2 py-1 text-primary hover:bg-primary/10" onClick={()=>{const name=prompt("新分组名称（最多40字）")?.trim().slice(0,40);if(name)void arrange(note.id,name);}}>＋</button></div><Button size="sm" variant="ghost" className="h-8 w-8 p-0" title={saving?__ui("保存中"):__ui("保存便签")} aria-label={__ui("保存便签")} disabled={saving||!dirty} onClick={()=>void save()}>{saving?<Loader2 size={15} className="animate-spin"/>:<Save size={15}/>}</Button></div>

        <NotesEditor value={note.body} onChange={body=>change({body})} disabled={navigating}/>

        {!!links.length&&<div className="mb-3 flex flex-col gap-1">{links.map(link=><button key={link} onClick={()=>void invoke("open_external",{url:link}).catch(e=>setError(String(e)))} className="flex items-center gap-2 truncate text-left text-xs text-primary"><ExternalLink size={12}/><span className="truncate">{link}</span></button>)}</div>}
        {!!note.assets?.length&&<div className="grid gap-2 sm:grid-cols-2">{note.assets.map(asset=><Attachment key={asset.id} asset={asset}/>)}</div>}
        <p className="mt-3 text-[10px] text-muted-foreground">{__ui("文字自动保存 · 图片 / 文档 / 视频以副本保存在本机 · 仅点击链接时打开浏览器")}</p>
        {confirmDelete&&createPortal(<div className="fixed inset-0 z-[250] grid place-items-center bg-black/35 p-5 backdrop-blur-sm"><section role="dialog" aria-modal="true" aria-label={__ui("删除便签")} className="w-full max-w-sm rounded-2xl border border-border bg-card p-6 text-foreground shadow-xl"><h3 className="text-base font-semibold">{__ui("删除这条便签？")}</h3><p className="mt-3 text-sm leading-6 text-muted-foreground">{__ui("便签及其本地附件副本会被移除，原始文件不会被删除。")}</p><div className="mt-5 flex justify-end gap-2"><Button size="sm" variant="outline" autoFocus disabled={saving||attaching} onClick={()=>setConfirmDelete(false)}>{__ui("保留便签")}</Button><Button size="sm" disabled={saving||attaching} onClick={()=>void remove()}>{__ui("确认删除")}</Button></div></section></div>,document.body)}
      </>:<div className="flex min-h-72 flex-col items-center justify-center gap-3 text-center text-muted-foreground"><FileText size={30} strokeWidth={1.3}/><p className="text-sm">{__ui("想法、资料、链接，随手留在这里")}</p><p className="text-xs">{__ui("新建便签，或直接拖入文件、粘贴图片")}</p><Button size="sm" variant="outline" onClick={()=>void create()}><Plus size={13}/>{__ui("写第一条便签")}</Button></div>}</div>
    </div>
    {!new URLSearchParams(location.search).get("window")&&<div className="flex justify-end"><ShortcutHint toolId="notes"/></div>}
    {error&&<div role="alert" className="rounded-xl bg-destructive/10 p-3 text-xs text-destructive">{__msg(error)}{note&&<button className="ml-2 underline" onClick={()=>{if(confirm("重新载入将放弃当前编辑（本地草稿仍保留）。建议先复制内容。")){dirtyRef.current=false;setDirty(false);void rpc<Note>("get",{id:note.id}).then(setCurrent).catch(e=>setError(String(e)));}}}>{__ui("重新载入")}</button>}</div>}
  </section>;
}
