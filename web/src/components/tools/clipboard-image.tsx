
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/clipboard-image.tsx");
import {useEffect,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {invoke} from "@tauri-apps/api/core";
import {ZoomIn,X,Check,ArrowLeft} from "lucide-react";
import {useEscapeDismiss} from "@/lib/use-escape-dismiss";
export function ClipboardImage({id,thumbnail}:{id:string;thumbnail:string}){
  const __locale = __useLanguage();
 const [hover,setHover]=useState<{left:number;top:number}|null>(null),[preview,setPreview]=useState(""),[open,setOpen]=useState(false),[full,setFull]=useState(""),[error,setError]=useState(""),[zoom,setZoom]=useState(false);
 const timer=useRef<ReturnType<typeof setTimeout>|null>(null);
 useEffect(()=>()=>{if(timer.current)clearTimeout(timer.current);},[]);
 useEffect(()=>{if(!hover||preview)return;let alive=true;void invoke<string>("clip_image_preview",{id,full:false}).then(s=>{if(alive)setPreview(s);}).catch(()=>{});return()=>{alive=false;};},[!!hover,id]);
 useEffect(()=>{if(!open)return;let alive=true;setError("");setZoom(false);void invoke<string>("clip_image_preview",{id,full:true}).then(s=>{if(alive)setFull(s);}).catch(e=>{if(alive)setError(String(e));});return()=>{alive=false;setFull("");};},[open,id]);
 useEscapeDismiss(()=>setOpen(false),open,150);
 const leave=()=>{if(timer.current)clearTimeout(timer.current);setHover(null);};
 return <><button type="button" className="group relative shrink-0 rounded-xl border border-border bg-muted/40 p-1" title={__ui("点击打开图片")} aria-label={__ui("打开剪贴板图片")} onMouseEnter={e=>{const r=e.currentTarget.getBoundingClientRect();timer.current=setTimeout(()=>setHover({left:Math.max(12,Math.min(r.right+12,window.innerWidth-372)),top:Math.max(12,Math.min(r.top,window.innerHeight-350))}),180);}} onMouseLeave={leave} onClick={e=>{e.stopPropagation();leave();setOpen(true);}}><img alt={__ui("剪贴板图片缩略图")} src={thumbnail} className="max-h-28 w-24 rounded-lg object-contain"/><span className="absolute right-1 top-1 rounded-md border border-border bg-card/95 p-1 text-muted-foreground shadow-sm"><ZoomIn size={13}/></span></button>
 {hover&&!open&&createPortal(<div className="pointer-events-none fixed z-[240] rounded-2xl border border-border bg-card p-2 shadow-xl" style={{...hover,width:"min(360px,calc(100vw - 24px))"}}><img src={preview||thumbnail} alt={__ui("图片放大预览")} className="max-h-[min(300px,60vh)] w-full rounded-xl object-contain"/><p className="px-2 pt-2 text-[11px] text-muted-foreground">{__ui("点击缩略图查看原图")}</p></div>,document.body)}
 {open&&createPortal(<div className="fixed inset-0 z-[260] flex flex-col bg-background/95 p-4 backdrop-blur-md" role="dialog" aria-modal="true" aria-label={__ui("剪贴板原图预览")}><header className="mb-3 flex items-center gap-3"><button type="button" aria-label={__ui("返回剪贴板列表")} className="flex items-center gap-1.5 rounded-xl border border-border px-3 py-2 text-xs text-foreground hover:bg-muted" onClick={()=>setOpen(false)}><ArrowLeft size={16}/>{__ui("返回")}</button><h3 className="text-sm font-semibold text-foreground">{__ui("图片预览")}</h3><button className="ml-auto rounded-xl border border-border px-3 py-2 text-xs text-foreground hover:bg-muted" onClick={()=>setZoom(!zoom)}>{zoom?<Check size={14} className="mr-1 inline"/>:<ZoomIn size={14} className="mr-1 inline"/>}{zoom?__ui("适应窗口"):__ui("实际大小")}</button><button aria-label={__ui("关闭图片预览")} className="rounded-xl p-2 text-muted-foreground hover:bg-muted" onClick={()=>setOpen(false)}><X size={20}/></button></header><div className="grid min-h-0 flex-1 place-items-center overflow-auto rounded-2xl border border-border bg-muted/30"><img src={full||preview||thumbnail} alt={__ui("剪贴板原图")} style={zoom?{maxWidth:"none"}:{maxWidth:"100%",maxHeight:"calc(100vh - 120px)",objectFit:"contain"}}/></div><p className="mt-2 text-xs text-muted-foreground" role="status">{__msg(error)||(!full?__ui("正在读取原图…"):__ui("Esc 关闭预览 · 图片仅在本机读取"))}</p></div>,document.body)}
 </>;
}
