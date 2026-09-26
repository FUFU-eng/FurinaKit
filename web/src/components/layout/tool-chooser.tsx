"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/layout/tool-chooser.tsx");

import { useMemo, useState } from "react";
import { getAvailableTools, CATEGORY_LABELS, type OmniTool } from "@furinakit/shared";
import { Search, X, Check, ChevronLeft, ChevronRight, Heart, Plus } from "lucide-react";
import { getToolIcon } from "@/lib/tool-icons";
import { useFavorites } from "@/lib/use-tool-prefs";
import "./tool-chooser.css";

const common = ["floating-screenshot", "clipboard-history", "notes", "screenshot-ocr", "image-upscale", "image-to-pdf", "screen-recorder", "lan-transfer"];
const aliases: Record<string,string> = {
  notes: "笔记 记事本 备忘录 便条", "clipboard-history": "剪贴板 剪切板 复制 粘贴 历史",
  "floating-screenshot": "截屏 截图 贴图 悬浮截图", "screenshot-ocr": "ocr 识字 文字识别 提取文字 截图取字",
  "image-upscale": "超分辨率 放大 清晰 增强 修复", "image-to-pdf": "图片转pdf 合并照片 pdf",
};
const normalize=(s:string)=>s.normalize("NFKC").toLowerCase().replace(/[\s_\-\/]+/g,"");
const categoryName=(t:OmniTool)=>CATEGORY_LABELS[t.category] || t.category;
export function ToolChooser({selected,onChoose,multiple=false,limit=1,autoFocus=false}:{selected:string[];onChoose:(id:string)=>void;multiple?:boolean;limit?:number;autoFocus?:boolean}) {
  const __locale = __useLanguage();
  const tools=useMemo(()=>getAvailableTools().filter(t=>!t.comingSoon),[ __locale]);
  const {favorites}=useFavorites();
  const [query,setQuery]=useState(""),[category,setCategory]=useState("common"),[page,setPage]=useState(0);
  const categories=useMemo(()=>Array.from(new Set(tools.map(t=>t.category))),[tools, __locale]);
  const results=useMemo(()=>{
    const words=query.trim().split(/\s+/).filter(Boolean).map(normalize);
    const rank=(t:OmniTool)=>normalize(t.name)===normalize(query)?0:normalize(t.name).includes(normalize(query))?1:2;
    return tools.filter(t=>{
      const hay=normalize(`${t.name} ${t.description || ""} ${t.id} ${categoryName(t)} ${aliases[t.id]||""}`);
      if(words.length&&!words.every(word=>hay.includes(word)))return false;
      return category==="all" || category==="common"&&(common.includes(t.id)||favorites.includes(t.id)||selected.includes(t.id)) || category==="favorites"&&favorites.includes(t.id) || category==="selected"&&selected.includes(t.id) || t.category===category;
    }).sort((a,b)=>words.length?rank(a)-rank(b):0);
  },[tools,query,category,favorites,selected, __locale]);
  const pages=Math.max(1,Math.ceil(results.length/18));
  const current=Math.min(page,pages-1);
  const tabs=[{id:"common",name:"常用推荐"},{id:"all",name:"全部工具"},{id:"favorites",name:"我的收藏"},{id:"selected",name:multiple?"已选工具":"当前工具"},...categories.map(id=>({id,name:CATEGORY_LABELS[id]||id}))];
  const changeCategory=(id:string)=>{setCategory(id);setPage(0);};
  return <div className="tool-chooser">
    <div className="tc-search"><Search size={18} aria-hidden="true"/><input autoFocus={autoFocus} value={query} onChange={e=>{setQuery(e.target.value);setCategory("all");setPage(0);}} placeholder={__ui("输入工具名或用途，例如：截图、剪贴板、图片转 PDF")} aria-label={__ui("搜索工具名称或用途")}/>{query&&<button type="button" aria-label={__ui("清空搜索")} onClick={()=>{setQuery("");setPage(0);}}><X size={16}/></button>}</div>
    <div className="tc-layout">
      <nav className="tc-categories" aria-label={__ui("工具分类")}>{tabs.map(tab=><button type="button" key={tab.id} aria-pressed={category===tab.id} onClick={()=>changeCategory(tab.id)}><span>{__ui(tab.name)}</span></button>)}</nav>
      <div className="tc-content">
        <div className="tc-summary"><span>{__ui(tabs.find(t=>t.id===category)?.name)} <b>{results.length}</b></span><span>{multiple?__msg("已选 {0} / {1}", selected.length, limit):__ui("点击工具即可选择")}</span></div>
        {multiple&&selected.length>=limit&&<p className="tc-limit" role="status">{__ui("窗格已满。先在上方移出一个工具，即可添加新工具。")}</p>}
        <div className="tc-results">{results.slice(current*18,(current+1)*18).map(t=>{
          const Icon=getToolIcon(t.icon);const chosen=selected.includes(t.id);const blocked=multiple&&!chosen&&selected.length>=limit;
          return <button type="button" key={t.id} className="tc-tool" aria-pressed={chosen} disabled={blocked} onClick={()=>onChoose(t.id)} title={`${t.name}：${t.description || categoryName(t)}`}>
            <span className="tc-icon"><Icon size={21} strokeWidth={1.7}/></span><span className="tc-info"><strong>{t.name}</strong><span>{__ui(t.description)||__msg(categoryName(t))}</span><small>{__msg(categoryName(t))}</small></span><span className="tc-check" aria-hidden="true">{chosen?<Check size={15}/>:<Plus size={14}/>}</span>
          </button>;
        })}</div>
        {!results.length&&<div className="tc-empty"><Search size={25}/><strong>{category==="favorites"?__ui("还没有收藏工具"):__ui("没有找到匹配工具")}</strong><p>{__ui("试试更短的工具名或用途关键词，也可以浏览全部分类。")}</p><button type="button" onClick={()=>{setQuery("");changeCategory("all");}}>{__ui("浏览全部工具")}</button></div>}
        {pages>1&&<div className="tc-pagination"><button type="button" aria-label={__ui("上一页工具")} disabled={!current} onClick={()=>setPage(current-1)}><ChevronLeft size={16}/>{__ui("上一页")}</button><span>{current+1} / {pages}</span><button type="button" aria-label={__ui("下一页工具")} disabled={current>=pages-1} onClick={()=>setPage(current+1)}>{__ui("下一页")}<ChevronRight size={16}/></button></div>}
      </div>
    </div>
  </div>;
}
