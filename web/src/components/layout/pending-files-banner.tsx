"use client";
import { createUiText as __createUiText, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/layout/pending-files-banner.tsx");

import {useState} from 'react';
import {motion,AnimatePresence} from 'framer-motion';
import {Pin,X,ChevronDown,File} from 'lucide-react';
import {usePendingFiles} from '@/lib/pending-files-context';
import {groupFiles,KIND_NAMES} from '@/lib/pending-file-model';
import './pending-files-banner.css';

export function PendingFilesBanner(){
  const __locale = __useLanguage();
  const {pendingFiles,hasReplaced,isActive,clearPendingFiles}=usePendingFiles();
  const [details,setDetails]=useState(false);
  const summary=pendingFiles.length===1?pendingFiles[0].name:groupFiles(pendingFiles).map(g=>`${KIND_NAMES[g.kind]} ${g.files.length}`).join(' · ');
  return <AnimatePresence>{isActive&&<motion.aside key="pending" initial={{opacity:0,y:-6}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-6}} transition={{duration:.18}} className="pending-notice" aria-label={__ui("文件待办状态")}>
    <div className="pending-notice-main">
      <span className="pending-notice-emblem" aria-hidden="true"><Pin size={18} strokeWidth={1.7}/></span>
      <button onClick={()=>setDetails(!details)} className="pending-notice-toggle" aria-expanded={details} aria-controls="pending-notice-details">
        <span className="pending-notice-heading">{__ui("文件待办中")}<span className="pending-notice-count">{pendingFiles.length} {__ui("个")}</span><ChevronDown size={13} className={details?'is-open':''}/></span>
        <span className="pending-notice-summary" title={summary}>{hasReplaced&&<span className="pending-notice-replaced">{__ui("已替换 ·")}</span>}{summary}</span>
      </button>
      <button onClick={clearPendingFiles} className="pending-notice-close" aria-label={__ui("关闭文件待办模式")} title={__ui("关闭待办，不再自动载入文件")}><X size={16}/></button>
    </div>
    {details&&<div id="pending-notice-details" className="pending-notice-details"><p className="pending-notice-hint">{__ui("切换工具会继续使用这批目标文件。")}</p><ul>{pendingFiles.map((f,i)=><li key={`${f.path||f.name}-${i}`} title={f.path||f.name}><File size={14} aria-hidden="true"/><span>{f.name}</span></li>)}</ul></div>}
  </motion.aside>}</AnimatePresence>;
}
