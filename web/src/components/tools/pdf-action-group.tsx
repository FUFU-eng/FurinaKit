import {useState,type ReactNode} from "react";
import {tr,useLanguage} from "@/lib/language";
export function PdfActionGroup({kind,initial,render}:{kind:"pages"|"protection";initial:string;render:(id:string)=>ReactNode}){
 useLanguage();
 const ids=kind==="pages"?["pdf-merge","pdf-split"]:["pdf-encrypt","pdf-unlock"];
 const [active,setActive]=useState(ids.includes(initial)?initial:ids[0]);
 const labels:Record<string,string>={"pdf-merge":tr("合并 PDF","Merge PDFs"),"pdf-split":tr("分割 PDF","Split PDF"),"pdf-encrypt":tr("加密 PDF","Encrypt PDF"),"pdf-unlock":tr("解锁 PDF","Unlock PDF")};
 return <div className="space-y-5"><div role="tablist" aria-label={tr("处理方式","Operation")} className="flex flex-wrap gap-2 rounded-2xl border border-border bg-card p-2">{ids.map(id=><button key={id} type="button" role="tab" aria-selected={active===id} onClick={()=>setActive(id)} className={`min-h-11 flex-1 rounded-xl px-5 py-3 text-sm font-semibold ${active===id?'bg-primary text-primary-foreground shadow-sm':'text-muted-foreground hover:bg-muted'}`}>{labels[id]}</button>)}</div><p className="text-xs leading-5 text-muted-foreground">{tr("两种操作各自保留已选文件与参数。所有结果另存到输出目录，不覆盖原文件。","Each operation retains its selected files and settings. Results are saved separately; original files are not overwritten.")}</p>{ids.map(id=><section role="tabpanel" key={id} hidden={active!==id}><fieldset disabled={active!==id}>{render(id)}</fieldset></section>)}</div>;
}
