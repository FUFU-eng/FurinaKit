import { Select as RoundedSelect } from "@/components/ui/primitives";

import { tr, createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/combined-workspaces.tsx");
import {useEffect,useState,type ReactNode} from 'react';
import {DateCalculatorTool,LunarCalendarTool,DateConverterTool} from './simple-tools';
import {getToolById} from '@/shared/tools';
const pdfOptions=['pdf-editor','pdf-merge','pdf-split','pdf-content-edit','pdf-crop','pdf-watermark','pdf-page-numbers','pdf-compress','pdf-extract-images','pdf-encrypt','pdf-unlock'];
export function PdfWorkspace({initial,renderTool}:{initial:string;renderTool:(id:string,active:boolean)=>ReactNode}){
  const __locale = __useLanguage();
 const normalized=pdfOptions.includes(initial)?initial:'pdf-editor';const [active,setActive]=useState(normalized),[opened,setOpened]=useState([normalized]);
 useEffect(()=>{setActive(normalized);setOpened(ids=>ids.includes(normalized)?ids:[...ids,normalized]);},[normalized]);
 const select=(id:string)=>{setActive(id);setOpened(ids=>ids.includes(id)?ids:[...ids,id]);};
 return <div className="space-y-4"><header className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-card p-4"><div><h2 className="text-lg font-semibold">{__ui("PDF 文档工作台")}</h2><p className="mt-1 text-xs text-muted-foreground">{__ui("页面编排、文字插图、裁剪、标记与保护，集中在一个入口")}</p></div><RoundedSelect aria-label={__ui("PDF处理功能")} className="rounded-xl border border-border bg-background px-3 py-2 text-sm" value={active} onChange={e=>select(e.target.value)}>{pdfOptions.map(id=><option key={id} value={id}>{id==='pdf-editor'?__ui("页面编排与即时预览"):getToolById(id)?.name||id}</option>)}</RoundedSelect></header>{active!=='pdf-editor'&&<p className="rounded-lg bg-primary/5 p-3 text-xs leading-5 text-muted-foreground">{__ui("高级处理面板需选择待处理文件。要继续处理已编排的内容，请先从页面工作台导出，再在此选入；切换面板会保留当前会话中的页面编排状态。")}</p>}{opened.filter(id=>id===active||id==='pdf-editor').map(id=><div key={id} hidden={active!==id}>{renderTool(id,id===active)}</div>)}</div>;
}
export function CalendarWorkspace({initial='date-calculator'}:{initial?:string}){
  const __locale = __useLanguage();const key=initial==='lunar-calendar'?'lunar':initial==='date-converter'?'format':'calculate';const [tab,setTab]=useState(key);useEffect(()=>setTab(key),[key]);return <div className="space-y-5"><header><h2 className="text-lg font-semibold">{tr("日期与日历", "Dates & Calendar")}</h2><p className="mt-1 text-xs text-muted-foreground">{tr("日期差与年龄、公历农历、日期时间格式转换，一个入口完成", "Date difference and age, Gregorian and lunar calendar, date and time format conversion, completed with one entrance")}</p></header><nav className="flex flex-wrap gap-2 rounded-xl bg-muted p-1">{[['calculate',tr('日期计算', 'Date Calculation')],['lunar',tr('公历 / 农历', 'Solar / Lunar')],['format',tr('日期格式转换', 'Date Format')]].map(([id,name])=><button key={id} onClick={()=>setTab(id)} className={`rounded-lg px-4 py-2 text-sm ${tab===id?'bg-card text-primary shadow-sm':'text-muted-foreground'}`}>{name}</button>)}</nav><section className="rounded-2xl border border-border bg-card p-5">{tab==='calculate'?<DateCalculatorTool/>:tab==='lunar'?<LunarCalendarTool/>:<DateConverterTool/>}</section></div>;}
