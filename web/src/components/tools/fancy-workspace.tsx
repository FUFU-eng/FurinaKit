
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/fancy-workspace.tsx");
import {useState} from 'react';
import {Textarea,Input,Button} from '@/components/ui/primitives';
const latin='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
const run=(start:number,n:number)=>Array.from({length:n},(_,i)=>String.fromCodePoint(start+i)).join('');
const transform=(text:string,target:string)=>{const map=Array.from(target);return Array.from(text,c=>{const i=latin.indexOf(c);return i<0?c:map[i]||c;}).join('');};
const styles=[
 {name:'数学粗体',category:'字母',map:run(0x1d400,26)+run(0x1d41a,26)+run(0x1d7ce,10)},
 {name:'无衬线粗体',category:'字母',map:run(0x1d5d4,26)+run(0x1d5ee,26)+run(0x1d7ec,10)},
 {name:'粗斜体',category:'字母',map:run(0x1d468,26)+run(0x1d482,26)},
 {name:'等宽字母',category:'字母',map:run(0x1d670,26)+run(0x1d68a,26)+run(0x1d7f6,10)},
 {name:'双线体',category:'字母',map:'𝔸𝔹ℂ𝔻𝔼𝔽𝔾ℍ𝕀𝕁𝕂𝕃𝕄ℕ𝕆ℙℚℝ𝕊𝕋𝕌𝕍𝕎𝕏𝕐ℤ'+run(0x1d552,26)+run(0x1d7d8,10)},
 {name:'粗花体',category:'字母',map:run(0x1d4d0,26)+run(0x1d4ea,26)},
 {name:'哥特粗体',category:'字母',map:run(0x1d56c,26)+run(0x1d586,26)},
 {name:'圆圈字母',category:'字母',map:run(0x24b6,26)+run(0x24d0,26)+'⓪①②③④⑤⑥⑦⑧⑨'},
 {name:'全角字母',category:'字母',map:run(0xff21,26)+run(0xff41,26)+run(0xff10,10)},
 {name:'删除线',category:'修饰',fn:(s:string)=>Array.from(s,c=>/\s/.test(c)?c:c+'\u0336').join('')},
 {name:'下划线',category:'修饰',fn:(s:string)=>Array.from(s,c=>/\s/.test(c)?c:c+'\u0332').join('')},
 {name:'字母间隔',category:'修饰',fn:(s:string)=>Array.from(s).join(' ')},
 {name:'星光标题',category:'装饰',fn:(s:string)=>`✦ ${s} ✦`},
 {name:'花边标题',category:'装饰',fn:(s:string)=>`꧁ ${s} ꧂`},
 {name:'书名题签',category:'装饰',fn:(s:string)=>`『 ${s} 』`},
 {name:'轻柔小花',category:'装饰',fn:(s:string)=>`❀ ${s} ❀`},
 {name:'舞台标题',category:'装饰',fn:(s:string)=>`─── ${s} ───`},
 {name:'便笺边框',category:'装饰',fn:(s:string)=>`╭──────────╮\n  ${s}\n╰──────────╯`},
];
export function FancyWorkspace(){
  const __locale = __useLanguage();const [text,setText]=useState('FurinaKit 2026 芙宁娜'),[category,setCategory]=useState('全部'),[query,setQuery]=useState(''),[status,setStatus]=useState('');const list=styles.filter(s=>(category==='全部'||s.category===category)&&s.name.includes(query));const copy=async(s:string)=>{try{await navigator.clipboard.writeText(s);setStatus('已复制，可粘贴到支持Unicode的应用');}catch(e){setStatus(`复制失败：${String(e)}`);}};return <div className="space-y-5"><header><h2 className="text-lg font-semibold">{__ui("花体文字工作台")}</h2><p className="mt-1 text-xs leading-5 text-muted-foreground">{__ui("18种字母样式、文字修饰与标题装饰。字母花体只替换拉丁字母/数字，中文保留；不伪称改变中文字体。")}</p></header><section className="rounded-2xl border border-border bg-card p-4"><Textarea aria-label={__ui("待转换文字")} value={text} onChange={e=>setText(e.target.value)} className="h-28 text-base"/><div className="mt-3 flex flex-wrap items-center gap-2">{['全部','字母','修饰','装饰'].map(c=><button key={c} onClick={()=>setCategory(c)} className={`rounded-lg px-3 py-2 text-xs ${category===c?'bg-primary text-primary-foreground':'bg-muted text-muted-foreground'}`}>{__ui(c)}</button>)}<Input aria-label={__ui("搜索花体样式")} value={query} onChange={e=>setQuery(e.target.value)} placeholder={__ui("搜索样式")} className="ml-auto w-40"/><Button size="sm" variant="ghost" onClick={()=>setText('')}>{__ui("清空")}</Button></div></section><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{list.map(s=>{const value=s.map?transform(text,s.map):s.fn!(text);return <article key={s.name} className="min-w-0 rounded-xl border border-border bg-card p-4"><div className="mb-3 flex justify-between text-xs"><span className="font-semibold">{__ui(s.name)}</span><button className="text-primary" onClick={()=>copy(value)}>{__ui("复制")}</button></div><p className="max-h-28 min-h-16 overflow-auto whitespace-pre-wrap break-all text-lg leading-8">{value||__ui("等待输入")}</p></article>;})}</div><p role="status" className="text-xs text-primary">{__msg(status)}</p><p className="text-xs leading-5 text-muted-foreground">{__ui("这些是Unicode字符，不是字体文件。部分平台、字体或搜索系统可能无法完整显示；密码、链接和重要标识不建议使用装饰字符。")}</p></div>;}
