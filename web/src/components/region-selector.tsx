import {useEffect,useRef,useState,type PointerEvent} from "react";
import {invoke} from "@tauri-apps/api/core";
import {listen} from "@tauri-apps/api/event";
import {tr,uiMessage,useLanguage} from "@/lib/language";
import "./region-selector.css";
type Rect={x:number;y:number;w:number;h:number};
type Frame={dataUrl:string;width:number;height:number;originX:number;originY:number;windows:{x:number;y:number;width:number;height:number}[]};
export function RegionSelector(){
 const [id,setId]=useState("");
 useEffect(()=>{let ended=false;let off:(()=>void)|undefined;void listen<string>("region-capture-start",e=>{if(!ended)setId(e.payload);}).then(async un=>{if(ended){un();return;}off=un;const current=await invoke<string>("region_capture_current");if(!ended)setId(current);}).catch(console.error);return()=>{ended=true;off?.();};},[]);
 return id?<Selection key={id} id={id}/>:null;
}
function Selection({id}:{id:string}){
 useLanguage();
 const [frame,setFrame]=useState<Frame|null>(null),[error,setError]=useState("");
 const root=useRef<HTMLDivElement>(null),image=useRef<HTMLImageElement>(null),lens=useRef<HTMLCanvasElement>(null),selection=useRef<HTMLDivElement>(null),shade=useRef<HTMLDivElement>(null),sizeLabel=useRef<HTMLSpanElement>(null),loupe=useRef<HTMLDivElement>(null),coords=useRef<HTMLSpanElement>(null),pixel=useRef<HTMLSpanElement>(null);
 const start=useRef<{x:number;y:number;selection:Rect}|null>(null),locked=useRef(false),rect=useRef<Rect|null>(null),point=useRef({x:0,y:0,visible:false}),color=useRef(""),raf=useRef(0),alive=useRef(true),sampling=useRef(false),sampled=useRef("");
 const finish=async(r:Rect|null)=>{if(locked.current)return;locked.current=true;try{const b=image.current?.getBoundingClientRect();await invoke("region_capture_finish",{requestId:id,selection:r&&b?{x:r.x/b.width,y:r.y/b.height,width:r.w/b.width,height:r.h/b.height}:null,error:null});}catch(e){locked.current=false;setError(String(e));}};
 useEffect(()=>{alive.current=true;void invoke<Frame>("region_capture_preview",{requestId:id}).then(async shot=>{const im=new Image();im.src=shot.dataUrl;await im.decode();if(!alive.current)return;rect.current={x:0,y:0,w:shot.width/devicePixelRatio,h:shot.height/devicePixelRatio};setFrame(shot);}).catch(e=>{if(!alive.current)return;setError(String(e));void invoke("region_capture_finish",{requestId:id,selection:null,error:String(e)}).catch(()=>{});});return()=>{alive.current=false;cancelAnimationFrame(raf.current);};},[id]);
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==="Escape"){e.preventDefault();e.stopImmediatePropagation();start.current=null;void finish(null);}else if(e.key==="Enter"&&rect.current){e.preventDefault();void finish(rect.current);}else if(e.ctrlKey&&e.key.toLowerCase()==="c"&&color.current){e.preventDefault();void navigator.clipboard.writeText(color.current).catch(e=>setError(String(e)));}};window.addEventListener("keydown",key,true);return()=>window.removeEventListener("keydown",key,true);},[id]);
 // Only lightweight overlay nodes change during movement. The desktop bitmap never re-renders.
 const paint=()=>{
  raf.current=0;if(!frame||!alive.current)return;
  const r=rect.current,p=point.current;
  if(r&&selection.current){Object.assign(selection.current.style,{transform:`translate3d(${r.x}px,${r.y}px,0)`,width:`${r.w}px`,height:`${r.h}px`,visibility:"visible"});if(sizeLabel.current)sizeLabel.current.textContent=`${Math.round(r.w*devicePixelRatio)} × ${Math.round(r.h*devicePixelRatio)}`;if(shade.current)shade.current.style.clipPath=`polygon(evenodd,0 0,100% 0,100% 100%,0 100%,0 0,${r.x}px ${r.y}px,${r.x}px ${r.y+r.h}px,${r.x+r.w}px ${r.y+r.h}px,${r.x+r.w}px ${r.y}px,${r.x}px ${r.y}px)`;}
  if(!p.visible)return;
  const px=Math.min(frame.width-1,Math.floor(p.x*devicePixelRatio)),py=Math.min(frame.height-1,Math.floor(p.y*devicePixelRatio));
  const ctx=lens.current?.getContext("2d");
  if(ctx&&image.current){ctx.imageSmoothingEnabled=false;ctx.clearRect(0,0,144,112);ctx.drawImage(image.current,px-9,py-7,18,14,0,0,144,112);ctx.strokeStyle="#22c55e";ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(72,0);ctx.lineTo(72,112);ctx.moveTo(0,56);ctx.lineTo(144,56);ctx.stroke();if(loupe.current)Object.assign(loupe.current.style,{visibility:"visible",transform:`translate3d(${Math.max(0,Math.min(innerWidth-156,p.x+24))}px,${Math.max(0,p.y+190>innerHeight?p.y-190:p.y+24)}px,0)`});}
  if(coords.current)coords.current.textContent=`${px+frame.originX}, ${py+frame.originY}`;
  const key=`${px},${py}`;
  if(!sampling.current&&sampled.current!==key){sampling.current=true;sampled.current=key;void invoke<string>("region_capture_pixel",{requestId:id,x:px,y:py}).then(c=>{if(!alive.current)return;color.current=c;if(pixel.current)pixel.current.textContent=c;}).catch(()=>{}).finally(()=>{sampling.current=false;if(alive.current&&!locked.current)schedule();});}
 };
 const schedule=()=>{if(!raf.current)raf.current=requestAnimationFrame(paint);};
 const update=(e:PointerEvent<HTMLDivElement>)=>{
  if(!frame||locked.current)return;const w=frame.width/devicePixelRatio,h=frame.height/devicePixelRatio,x=Math.min(w,Math.max(0,e.clientX)),y=Math.min(h,Math.max(0,e.clientY));point.current={x,y,visible:true};
  const d=start.current;
  if(d&&Math.hypot(x-d.x,y-d.y)>3)rect.current={x:Math.min(x,d.x),y:Math.min(y,d.y),w:Math.abs(x-d.x),h:Math.abs(y-d.y)};
  else if(!d){const px=x*devicePixelRatio+frame.originX,py=y*devicePixelRatio+frame.originY,win=frame.windows.find(b=>px>=b.x&&px<b.x+b.width&&py>=b.y&&py<b.y+b.height);if(win){const left=Math.max(0,(win.x-frame.originX)/devicePixelRatio),top=Math.max(0,(win.y-frame.originY)/devicePixelRatio);rect.current={x:left,y:top,w:Math.min(w,(win.x+win.width-frame.originX)/devicePixelRatio)-left,h:Math.min(h,(win.y+win.height-frame.originY)/devicePixelRatio)-top};}else rect.current={x:0,y:0,w,h};}
  schedule();
 };
 const down=(e:PointerEvent<HTMLDivElement>)=>{if(e.button!==0||!frame||locked.current)return;update(e);if(!rect.current)return;start.current={x:e.clientX,y:e.clientY,selection:rect.current};e.currentTarget.setPointerCapture(e.pointerId);};
 const up=(e:PointerEvent<HTMLDivElement>)=>{const d=start.current;if(!d)return;update(e);start.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);const r=Math.hypot(e.clientX-d.x,e.clientY-d.y)<=3?d.selection:rect.current;if(r&&r.w*devicePixelRatio>=8&&r.h*devicePixelRatio>=8)void finish(r);else setError(tr("选区至少需要8×8像素，请重新框选","Select an area of at least 8 × 8 pixels."));};
 return <div ref={root} tabIndex={-1} className="region-capture" onPointerDown={down} onPointerMove={update} onPointerUp={up} onPointerCancel={()=>{start.current=null;}} onContextMenu={e=>{e.preventDefault();void finish(null);}} style={{position:"fixed",inset:0,overflow:"hidden",cursor:"crosshair",userSelect:"none",touchAction:"none",background:"transparent"}}>
  {frame&&<img ref={image} src={frame.dataUrl} onLoad={()=>{paint();requestAnimationFrame(()=>requestAnimationFrame(()=>{if(alive.current)void invoke("region_capture_ready",{requestId:id}).then(()=>root.current?.focus({preventScroll:true})).catch(e=>setError(String(e)));}));}} draggable={false} alt={tr("框选截图","Select capture area")} style={{position:"absolute",left:0,top:0,width:frame.width/devicePixelRatio,height:frame.height/devicePixelRatio,maxWidth:"none",pointerEvents:"none"}}/>}
  <div ref={shade} style={{position:"absolute",inset:0,background:frame?"#0004":"transparent",pointerEvents:"none"}}/>
  <div ref={selection} style={{position:"absolute",left:0,top:0,visibility:"hidden",border:"1px solid #22c55e",boxSizing:"border-box",pointerEvents:"none",willChange:"transform,width,height"}}><span ref={sizeLabel} style={{position:"absolute",top:4,left:4,background:"#111d",color:"white",borderRadius:4,padding:"3px 6px",fontSize:11,whiteSpace:"nowrap"}}/></div>
  <div ref={loupe} style={{position:"absolute",pointerEvents:"none",left:0,top:0,visibility:"hidden",width:146,overflow:"hidden",borderRadius:10,border:"1px solid #ffffff99",background:"#f8fafc",boxShadow:"0 6px 24px #0004",color:"#334155",fontSize:11,willChange:"transform"}}><canvas ref={lens} width={144} height={112}/><div style={{padding:8,lineHeight:1.7}}>{tr("坐标 ","Position ")}<span ref={coords}/><br/>{tr("色值 ","Color ")}<span ref={pixel}>—</span><br/><span style={{color:"#64748b"}}>{tr("Ctrl+C 复制色值","Ctrl+C to copy color")}</span></div></div>
  {frame&&<div className="region-guide" style={{pointerEvents:"none"}}>{uiMessage(error)||tr("拖动框选，松手即悬浮 · 单击选择窗口 · Enter 截取当前选区 · Esc / 右键取消","Drag and release to capture · Click a window · Enter to capture · Esc / right-click to cancel")}</div>}
 </div>;
}
