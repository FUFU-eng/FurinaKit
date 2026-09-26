
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/float-ball/float-ball-app.tsx");
import {publicToolId} from "@/shared/catalog-policy";
import { recommendationsFor, recommendationCategory } from "@/lib/file-recommendations";
import {invoke} from '@tauri-apps/api/core';
import {desktopBridge} from '@/bridge';
"use client";
import React, {useCallback, useEffect, useRef, useState} from 'react';
import {flushSync} from 'react-dom';
import {motion, animate, useMotionValue, useTransform, useAnimationControls, type MotionValue} from 'framer-motion';
import {Camera,Video,Sparkles,Wifi,FileText,Layers,ArrowRight,X,FileImage,Scissors,Eraser,SplitSquareVertical,Music,Share2,Home,Settings,EyeOff} from 'lucide-react';
import {getToolById,getAvailableTools} from '@furinakit/shared';
import {getToolIcon} from '@/lib/tool-icons';
import {fileKind,groupFiles,KIND_NAMES,type FileKind,type PendingFileItem} from '@/lib/pending-file-model';
import './float-ball.css';
interface ToolItem {
  id: string;
  name: string;
  desc: string;
  category: string;
  icon: React.ComponentType<{ className?: string; size?: number; strokeWidth?: number }>;
  color: string;
}


export const DEFAULT_TOOL_IDS = [
  "floating-screenshot",
  "screen-recorder",
  "clipboard-history",
  "notes",
];

const CATEGORY_GRADIENTS: Record<string, string> = {
  image: "from-cyan-400 to-blue-500",
  video: "from-blue-500 to-indigo-600",
  download: "from-blue-500 to-indigo-600",
  audio: "from-purple-400 to-indigo-600",
  pdf: "from-amber-400 to-orange-500",
  utility: "from-teal-400 to-emerald-500",
  ai: "from-purple-400 to-pink-500",
  dev: "from-emerald-400 to-teal-600",
  text: "from-sky-400 to-indigo-500",
  mathcalc: "from-amber-400 to-rose-500",
  security: "from-indigo-400 to-cyan-500",
  hardware: "from-slate-400 to-zinc-600",
};

export function resolveToolItem(id: string): ToolItem {
  const cleanId = publicToolId(id);
  const tool = getToolById(cleanId);
  const category = tool?.category || "utility";
  return {
    id: cleanId,
    get name() {
      return getToolById(cleanId)?.name || cleanId;
    },
    get desc() {
      const toolDesc = getToolById(cleanId)?.description;
      return toolDesc ? (toolDesc.length > 20 ? toolDesc.slice(0, 18) + "..." : toolDesc) : __ui("点击即可直接调用");
    },
    category,
    icon: (tool ? getToolIcon(tool.icon || tool.id) : getToolIcon(cleanId)) as unknown as React.ComponentType<{ className?: string; size?: number; strokeWidth?: number }>,
    color: cleanId === 'notes' ? 'from-amber-400 to-orange-500' : cleanId === 'clipboard-history' ? 'from-cyan-400 to-teal-500' : CATEGORY_GRADIENTS[category] || 'from-cyan-400 to-blue-500',
  };
}

export const ALL_CONFIGURABLE_TOOLS: ToolItem[] = getAvailableTools().map(t => resolveToolItem(t.id));

export const TOOL_FILL_IDS=[...DEFAULT_TOOL_IDS,'bg-remove','image-compress','pdf-editor','video-compress','audio-format-convert'];
export function getGridCount():number {
  const value=Number(localStorage.getItem('furinakit_floatball_grid')||4);
  return [4,6,9].includes(value)?value:4;
}
export function getCustomTools(): ToolItem[] {
  const count=getGridCount();
  let ids:string[]=[];
  try {const raw=JSON.parse(localStorage.getItem('furinakit_floatball_tools')||'[]');if(Array.isArray(raw))ids=raw;}catch{}
  if(JSON.stringify(ids)===JSON.stringify(["screenshot-ocr","screen-recorder","image-upscale","lan-transfer"]))ids=[...DEFAULT_TOOL_IDS];
  const valid=[...new Set([...ids,...TOOL_FILL_IDS].map(publicToolId))].filter(id=>typeof id==='string'&&getToolById(id));
  return valid.slice(0,count).map(resolveToolItem);
}

const VIEW_W=320, VIEW_H=384;
type Layout={anchorX:number;anchorY:number;directionX:string;directionY:string};
const COMPACT:Layout={anchorX:32,anchorY:32,directionX:'right',directionY:'down'};
const ease: [number,number,number,number]=[0.22,0.7,0.18,1];
const nextFrame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
/**
 * 窗口隐身期间等新尺寸的画面真正上屏。实测 WebView 的画面比原生窗口变化晚约 70ms 才显示出来，
 * 所以：先等尺寸生效，再等两帧（隐身时 rAF 可能暂停，最多等 120ms），再多留 90ms 余量。
 */
async function settleHidden(expectedWidth:number){
  const start=performance.now();
  while(Math.abs(window.innerWidth-expectedWidth)>2&&performance.now()-start<250)await sleep(8);
  await Promise.race([nextFrame().then(nextFrame),sleep(120)]);
}
/** WebView 新画面比 rAF 晚一点才真正上屏（实测约 70ms），撤替身前多留一点余量。 */
const PRESENT_LAG_MS=80;
/** 等窗口真正换成目标尺寸、并且新尺寸下至少画出一帧（最多等 300ms）。 */
async function settleViewport(expectedWidth:number){
  const start=performance.now();
  while(Math.abs(window.innerWidth-expectedWidth)>2&&performance.now()-start<300)await nextFrame();
  await nextFrame();await nextFrame();
}
function SpiralTile({tool,index,p,layout,top,left,columns,onSelect,disabled}:{tool:ToolItem;index:number;p:MotionValue<number>;layout:Layout;top:number;left:number;columns:number;onSelect:()=>void;disabled:boolean}) {
  const __locale = __useLanguage();
  const col=index%columns,row=Math.floor(index/columns);
  const endX=left+8+col*(columns===3?94:106),endY=top+row*78;
  const sx=layout.anchorX+(col?7:-7)-47,sy=layout.anchorY+(row%2?7:-7)-35;
  const x=useTransform(p,v=>sx+(endX-sx)*v+Math.sin(Math.PI*v)*(col?-22:22));
  const y=useTransform(p,v=>sy+(endY-sy)*v+Math.sin(Math.PI*v)*(col?18:-18));
  const scale=useTransform(p,[0,.15,1],[.085,.16,1]);
  const rotate=useTransform(p,v=>Math.sin(Math.PI*v)*(col?24:-24));
  const alpha=useTransform(p,[0,.035,.8,1],[0,1,1,1]);
  const content=useTransform(p,[0,.55,1],[0,0,1]);
  const displayName = tool.id === 'more-tools' ? __ui('更多工具') : (getToolById(tool.id)?.name || tool.name);
  return <motion.button className="fb-tile" style={{x,y,scale,rotate,opacity:alpha,width:columns===3?92:104}} disabled={disabled} onClick={onSelect} aria-label={displayName}>
    <motion.span className="fb-tile-inner" style={{opacity:content}}><tool.icon size={22} strokeWidth={1.65}/><span>{displayName}</span></motion.span>
  </motion.button>;
}
export function FloatBallApp(){
  const __locale = __useLanguage();
  const p=useMotionValue(0);
  const [layout,setLayout]=useState<Layout>(COMPACT);
  const layoutRef=useRef(layout);layoutRef.current=layout;
  const [prepared,setPrepared]=useState(false);const preparedRef=useRef(false);
  const [open,setOpen]=useState(false);const desired=useRef(false);
  const [hidden,setHidden]=useState(true);
  const bootStarted=useRef(false);
  const [dragOver,setDragOver]=useState(false);
  // 球自身的可见度：窗口改尺寸那一刻球必须是隐藏的（否则 WebView 旧画面会把球画到错误位置，看起来是跳一下、闪一下）
  const ballVis=useMotionValue(1);
  const hoverQuietUntil=useRef(0);
  const imgControls=useAnimationControls();
  const [files,setFiles]=useState<PendingFileItem[]>([]);
  const [kind,setKind]=useState<FileKind>('image');
  const [custom,setCustom]=useState(getCustomTools);
  useEffect(()=>{
    setCustom(getCustomTools());
  },[__locale]);
  const [reduceMotion,setReduceMotion]=useState(false);
  const [opacity,setOpacity]=useState(.85);
  const [error,setError]=useState('');
  const [menu,setMenu]=useState(false);
  const dropFocusUntil=useRef(0);
  const operation=useRef(0);const animation=useRef<ReturnType<typeof animate>|null>(null);
  const busy=useRef(false);const alive=useRef(true);
  const prefs=useCallback(()=>{
    setCustom(getCustomTools());setReduceMotion(localStorage.getItem('furinakit_floatball_reduce_motion')==='true');
    const n=Number(localStorage.getItem('furinakit_floatball_opacity')||85);
    setOpacity(Number.isFinite(n)?Math.max(.5,Math.min(1,n/100)):.85);
  },[]);
  const transition=useCallback(async(next:boolean,incoming?:PendingFileItem[],contextMenu=false)=>{
    if(incoming?.length){setFiles(incoming);setKind(fileKind(incoming[0]));setMenu(false);
      // A new batch replaces an existing global pending session immediately, but does not open the main window.
      void desktopBridge().pushPendingFilesToMain(incoming).catch(e=>setError(String(e)));
    }
    else if(next && !desired.current){setFiles([]);setMenu(contextMenu);prefs();}
    desired.current=next;++operation.current;
    animation.current?.stop();
    if(busy.current)return;
    let needReveal=false;
    try {
      if(next){
        if(busy.current)return; // latest desired state is applied after native preparation
        busy.current=true;
        if(!preparedRef.current){
          ballVis.stop();ballVis.set(1);
          // 1) 先按展开方向摆好球：小窗（64px）里左 10 与右 10、上 10 与下 10 是同一个位置，所以这一步肉眼无变化；
          const plan=await desktopBridge().planFloatBallExpand(VIEW_W,VIEW_H) as Layout;
          if(!alive.current)return;
          if(plan?.anchorX!=null){layoutRef.current=plan;flushSync(()=>setLayout(plan));}
        }
        // 2) 再真正把窗口变大：Rust 放大前先把窗口隐身，下面等新画面上屏后再显示（见 settleHidden），
        //    所以放大那一帧看不到"小窗旧画面贴在大窗左上角"的残影
        const result=await desktopBridge().setFloatBallExpanded(true,0,0,VIEW_W,VIEW_H) as Layout;
        if(!alive.current)return;
        if(result?.anchorX!=null){layoutRef.current=result;flushSync(()=>setLayout(result));}
        needReveal=true;
        preparedRef.current=true;setPrepared(true);setHidden(false);busy.current=false;
      }
      const completionToken=operation.current;
      const goal=desired.current?1:0;
      setOpen(desired.current);
      // 收起时球不再先藏起来：面板完整缩回成球（球就画在原位），再由 Rust 定格替身盖住、缩窗、撤替身
      const duration=localStorage.getItem('furinakit_floatball_reduce_motion')==='true' ? .12 : .38;
      // 展开：先在隐身状态下等新尺寸生效，再开始面板动画，过约一个"上屏延迟"后解除隐身，
      // 这样用户看到的第一帧就是面板刚从球的位置长出来（不空等、也不会一出现就是大面板）
      if(needReveal){
        // 展开：窗口在隐身中变大，用户看到的是 Rust 盖上的定格替身。等新尺寸画好（此时 p=0，
        // 球画在原位，和替身一模一样），先显示真窗口、撤替身，再开始长出面板 —— 球全程不动、不闪。
        await settleHidden(VIEW_W);
        // 第一次：取消隐身（替身还盖着）；WebView 这时才开始出画面，等它真正上屏后第二次：撤替身
        await desktopBridge().revealFloatBall().catch(()=>{});
        await nextFrame();await nextFrame();await sleep(PRESENT_LAG_MS);
        await desktopBridge().revealFloatBall().catch(()=>{});
        if(!alive.current||completionToken!==operation.current)return;
      }
      animation.current=animate(p,goal,{duration:duration*Math.max(.35,Math.abs(goal-p.get())),ease});
      await animation.current;
      if(!alive.current || completionToken!==operation.current)return;
      if(!desired.current){
        // 收起：面板已完整缩回成球。等这一帧真正上屏，Rust 才能把"球在原位"定格成替身
        await nextFrame();await nextFrame();await sleep(PRESENT_LAG_MS+20);
        if(!alive.current || completionToken!==operation.current || desired.current)return;
        await desktopBridge().setFloatBallExpanded(false,0,0,0,0);
        preparedRef.current=false;
        flushSync(()=>{setLayout(COMPACT);setPrepared(false);setHidden(false);setMenu(false);});
        ballVis.stop();ballVis.set(1);
        await settleViewport(64);
        await sleep(PRESENT_LAG_MS);
        // 小窗新画面已上屏，撤掉替身（替身最多 900ms 也会自己撤）
        await desktopBridge().revealFloatBall().catch(()=>{});
        if(!alive.current || completionToken!==operation.current)return;
        // 球重新出现在鼠标下面时不要当成"悬停"去晃动
        hoverQuietUntil.current=Date.now()+450;
      }
    }catch(e){busy.current=false;setHidden(false);setError(String(e));desired.current=false;setOpen(false);p.set(0);ballVis.set(1);void desktopBridge().revealFloatBall().catch(()=>{});}
  },[p,prefs,ballVis]);
  useEffect(()=>{
    alive.current=true;prefs();
    if(!bootStarted.current){
      bootStarted.current=true;
      void desktopBridge().setFloatBallExpanded(false,0,0,0,0).catch(e=>setError(String(e))).finally(()=>{if(alive.current)setHidden(false)});
    }
    const onBlur=()=>{if(Date.now()<dropFocusUntil.current)return;if(desired.current)void transition(false)};
    const onKey=(e:KeyboardEvent)=>{if(e.key==='Escape')void transition(false)};
    const onPrefs=(e:Event)=>{
      const data=(e as CustomEvent).detail;
      if(data)for(const [key,value] of Object.entries(data))localStorage.setItem(key,String(value));
      prefs();
    };
    const native=(e:Event)=>{
      const data=(e as CustomEvent).detail;
      if(data?.type==='enter'||data?.type==='over')setDragOver(true);
      else setDragOver(false);
      if(data?.type==='drop' && Array.isArray(data.paths)){
        dropFocusUntil.current=Date.now()+900;
        const items:PendingFileItem[]=data.paths.map((path:string)=>({path,name:path.split(/[\\/]/).pop()||path,type:''}));
        if(items.length)void transition(true,items);
      }
    };
    window.addEventListener('furinakit:ball-blur',onBlur);
    window.addEventListener('blur',onBlur);
    window.addEventListener('keydown',onKey);
    window.addEventListener('storage',prefs);
    window.addEventListener('furinakit:ball-prefs',onPrefs);
    window.addEventListener('furinakit:native-drop',native);
    (window as any).__FURINAKIT_BALL_DROP_READY__=true;
    if((window as any).__FURINAKIT_BALL_DROP__){native(new CustomEvent('drop',{detail:(window as any).__FURINAKIT_BALL_DROP__}));delete (window as any).__FURINAKIT_BALL_DROP__;}
    return ()=>{delete (window as any).__FURINAKIT_BALL_DROP_READY__;alive.current=false;animation.current?.stop();window.removeEventListener('furinakit:ball-blur',onBlur);window.removeEventListener('blur',onBlur);window.removeEventListener('keydown',onKey);window.removeEventListener('storage',prefs);window.removeEventListener('furinakit:ball-prefs',onPrefs);window.removeEventListener('furinakit:native-drop',native)};
  },[prefs,transition]);
  useEffect(()=>{
    void imgControls.start(dragOver?{rotate:0,y:0,scale:1.10}:{rotate:0,y:0,scale:1},{duration:reduceMotion?0:.3,ease:[.22,.61,.36,1]});
  },[dragOver,reduceMotion,imgControls]);
  const pointer=useRef<{x:number;y:number;dragging:boolean}|null>(null);
  const pointerMove=async(e:React.PointerEvent)=>{
    const start=pointer.current;
    if(!start||start.dragging||Math.hypot(e.screenX-start.x,e.screenY-start.y)<4)return;
    start.dragging=true;setDragOver(false);
    try{
      if(preparedRef.current){
        await desktopBridge().setFloatBallExpanded(false,0,0,0,0);
        setLayout(COMPACT);setPrepared(false);setHidden(false);preparedRef.current=false;ballVis.stop();ballVis.set(1);
      }
      (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
      await desktopBridge().startFloatBallDragging();
    }catch(err){setError(String(err));setHidden(false)}finally{pointer.current=null}
  };
  const launch=async(tool?:ToolItem)=>{
    try{
      if(tool?.id==='more-tools')tool=undefined;
      if(tool?.id==='floating-screenshot') {
        // Collapse immediately: do not put the 380ms decorative animation on the capture path.
        ++operation.current;desired.current=false;animation.current?.stop();p.set(0);
        flushSync(()=>{setOpen(false);setHidden(true)});
        await desktopBridge().setFloatBallExpanded(false,0,0,0,0);
        preparedRef.current=false;
        ballVis.stop();ballVis.set(1);
        flushSync(()=>{setLayout(COMPACT);setPrepared(false);setHidden(false);setMenu(false)});
        await invoke('capture_floating',{delayMs:0});return;
      }
      await transition(false);
      if(tool?.id==='clipboard-history'||(tool?.id==='notes'&&!files.length)){await invoke('open_utility_window',{kind:tool.id==='notes'?'notes':'clipboard'});return;}
      const auto=localStorage.getItem('furinakit_floatball_auto_handoff')!=='false';
      await desktopBridge().openMainWindowWithTarget({toolId:tool?.id,category:tool?.category || (kind==='video'?'download':kind==='office'?'utility':kind==='other'?'utility':kind),pendingFilesData:auto&&files.length?files:undefined});
      setFiles([]);
    }catch(e){setError(String(e))}
  };
  const groups=groupFiles(files);
  const activeFile=groups.find(g=>g.kind===kind)?.files[0];
  const recommendations=recommendationsFor(activeFile).map(t=>resolveToolItem(t.id));
  const moreTool:ToolItem={id:'more-tools',get name(){return __ui('更多工具');},get desc(){return __ui('前往相关分类');},category:activeFile?recommendationCategory(activeFile):'utility',icon:ArrowRight,color:'from-slate-400 to-sky-500'};
  const batchIds=new Set(['image-upscale','image-compress','pdf-merge','lan-transfer']);
  const multi=(groups.find(g=>g.kind===kind)?.files.length || 0)>1;
  const tools=files.length?[...(multi?[...recommendations].sort((a,b)=>Number(batchIds.has(b.id))-Number(batchIds.has(a.id))):recommendations),moreTool]:custom;
  const columns=tools.length>4?3:2;
  const rows=Math.ceil(tools.length/columns);
  const panelW=menu?204:columns===3?296:228;
  const panelX=layout.directionX==='left'?VIEW_W-panelW-12:12;
  const panelH=menu?196:64+rows*78+(files.length?35:0);
  const panelY=layout.directionY==='up'?VIEW_H-panelH-12:12;
  const tileTop=panelY+52+(files.length?30:0);
  const panelScale=useTransform(p,[0,1],[.04,1]);
  const panelOpacity=useTransform(p,[0,.2,1],[0,.15,1]);
  const sphereFade=useTransform(p,[0,.18,.45,1],[1,.65,0,0]);
  const sphereOpacity=useTransform([sphereFade,ballVis],([a,b])=>(a as number)*(b as number));
  const sphereScale=useTransform(ballVis,[0,1],[.82,1]);
  const textOpacity=useTransform(p,[0,.65,1],[0,0,1]);
  const onHtmlDrop=async(e:React.DragEvent)=>{
    e.preventDefault();setDragOver(false);dropFocusUntil.current=Date.now()+900;
    // Browser fallback only. Native Tauri drops provide real paths without copying media to base64.
    const list=Array.from(e.dataTransfer.files);
    if(!list.length)return;
    if(list.some(f=>f.size>32*1024*1024)){setError('请从文件资源管理器拖入大文件，以保留真实路径');return;}
    try{
      const items:PendingFileItem[]=[];
      for(const file of list){const dataUrl=await new Promise<string>((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result));r.onerror=()=>reject(r.error);r.readAsDataURL(file)});items.push({name:file.name,type:file.type,size:file.size,dataUrl});}
      void transition(true,items);
    }catch{setError('文件读取失败，请重新拖入')}
  };
  return <div className="fb-root" data-reduced={reduceMotion} data-phase={hidden?'preparing':open?'open':'closed'} onDragOver={e=>{e.preventDefault();setDragOver(true)}} onDragLeave={e=>{if(!e.relatedTarget)setDragOver(false)}} onDrop={onHtmlDrop}>
    {open && <div className="fb-backdrop" onPointerDown={()=>void transition(false)}/>}
    {!hidden && <>
      <motion.div className="fb-sphere" style={{
        ...(layout.directionX === 'left' ? { right: 10 } : { left: 10 }),
        ...(layout.directionY === 'up' ? { bottom: 10 } : { top: 10 }),
        opacity: sphereOpacity,
        scale: sphereScale,
        pointerEvents: open ? 'none' : 'auto'
      }}
        onPointerEnter={()=>{
          if(pointer.current||open||reduceMotion||dragOver||Date.now()<hoverQuietUntil.current)return;
          const sign=Math.random()<.5?-1:1;
          // 同一个 <img> 上重放晃动动画；以前靠改 key 重新挂载图片，会闪一下
          void imgControls.start({rotate:[0,sign*7,sign*-2,0],y:[0,-1.5,0,0],scale:1,transition:{duration:.62,ease:[.22,.61,.36,1]}});
        }}
        onPointerDown={e=>{if(e.button!==0)return;e.currentTarget.setPointerCapture(e.pointerId);pointer.current={x:e.screenX,y:e.screenY,dragging:false}}}
        onPointerMove={pointerMove} onPointerUp={e=>{const start=pointer.current;pointer.current=null;if(start&&!start.dragging)void transition(true);e.currentTarget.releasePointerCapture?.(e.pointerId)}}
        onContextMenu={e=>{e.preventDefault();void transition(true,undefined,true)}} role="button" tabIndex={0} aria-label={__ui("展开常用工具")} onKeyDown={e=>{if(e.key==='Enter'||e.key===' ')void transition(true)}}>
        {dragOver&&<span className="fb-water-field" aria-hidden="true">{[0,1,2].map(i=><span key={i} className="fb-ripple" style={{animationDelay:`${-i*.6}s`}}/>)}</span>}
        <motion.img src="/float-ball.png" alt="FurinaKit" draggable={false} animate={imgControls}/>

      </motion.div>
      {prepared && <>
        <motion.div className="fb-panel" style={{left:panelX,width:panelW,top:panelY,height:panelH,opacity:panelOpacity,scale:panelScale,transformOrigin:`${layout.anchorX-panelX}px ${layout.anchorY-panelY}px`,backgroundColor:`rgba(14,29,47,${opacity})`}}/>
        <motion.header className="fb-header" style={{left:panelX+16,width:panelW-32,top:panelY+12,opacity:textOpacity,pointerEvents:open?'auto':'none'}}>
          <span><span className="fb-dot"/>{menu?'FurinaKit':files.length?__ui("文件工作台"):__ui("常用工具")}<small>{files.length?__msg("{0} 个文件", files.length): __ui("触手可及")}</small></span>
          <button onClick={()=>void transition(false)} aria-label={__ui("收起")}><X size={15}/></button>
        </motion.header>
        {!!files.length&&<motion.div className="fb-tabs" style={{left:panelX+12,width:panelW-24,top:panelY+48,opacity:textOpacity,pointerEvents:open?'auto':'none'}}>{groups.map(g=><button key={g.kind} className={kind===g.kind?'active':''} onClick={()=>setKind(g.kind)}>{__ui(KIND_NAMES[g.kind])} <span>{g.files.length}</span></button>)}</motion.div>}
        {!menu&&tools.map((tool,i)=><SpiralTile key={`${tool.id}-${i}`} tool={tool} index={i} p={p} layout={layout} top={tileTop} left={panelX} columns={columns} disabled={!open} onSelect={()=>void launch(tool)}/>)}
        {menu&&<motion.div className="fb-menu" style={{left:panelX+12,width:panelW-24,top:panelY+48,opacity:textOpacity,pointerEvents:open?'auto':'none'}}>{[{id:'open',name:__ui('打开主界面'),icon:Home},{id:'settings',name:__ui('悬浮球设置'),icon:Settings},{id:'hide',name:__ui('隐藏悬浮球'),icon:EyeOff}].map(item=><button key={item.id} onClick={async()=>{await transition(false);await desktopBridge().floatBallMenuAction(item.id)}}><item.icon size={17}/>{item.name}</button>)}</motion.div>}

      </>}
      {error&&<div role="alert" className="fb-error" onClick={()=>setError('')}>{__msg(error)}</div>}
    </>}
  </div>;
}
