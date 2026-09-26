import {Select as RoundedSelect} from "@/components/ui/primitives";
import {tr} from "@/lib/language";

import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/capture/pinned-shot.tsx");
import {ImageEditor,type EditorHandle} from "./image-editor";
import {enhanceShot} from "./enhance-shot";
import { useEscapeDismiss } from "@/lib/use-escape-dismiss";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { ensureOutputDirectory } from "@/lib/output-directory";
import { listen } from "@tauri-apps/api/event";
import { imageBlob, recognizeScreenshot } from "@/lib/screenshot-ocr";
import {
  Copy,
  ScanText,
  Languages,
  Sparkles,
  Undo2,
  ListPlus,
  X,
  Download,
  GripVertical, Pin, PinOff,
} from "lucide-react";
import "./pinned-shot.css";
interface Shot {
  pinned: boolean;
  dataUrl: string;
  width: number;
  height: number;
  layout: { imageWidth: number; imageHeight: number; dockLeft: boolean };
}
const actions = [
  ["copy", "复制", Copy, "复制原始图片到系统剪贴板"],
  ["ocr", "取字", ScanText, "在原图上选择并复制识别文字；再点切回原图"],
  ["translate", "翻译", Languages, "仅文字发送到在线翻译，在原图位置显示译文"],
  ["upscale", "强化", Sparkles, "在当前贴图原位进行本机2倍高清强化"],
  ["pending", "加入待办", ListPlus, "放入图片待办，不自动处理"],
] as const;
export function PinnedShot() {
  const __locale = __useLanguage();
  const id = new URLSearchParams(location.search).get("shotId") || "";
  const [shot, setShot] = useState<Shot | null>(null),
    [busy, setBusy] = useState(false),
    [status, setStatus] = useState(""),
    [error, setError] = useState(false);
  useEscapeDismiss(()=>{operation.current?.abort();void invoke("shot_window",{id,operation:"close"}).catch(e=>{setError(true);setStatus(String(e));});},true,0);
  const editor=useRef<EditorHandle|null>(null);
  const [pinned,setPinned]=useState(true);
  const [toolbar,setToolbar]=useState<HTMLDivElement|null>(null),[moving,setMoving]=useState(true),[epoch,setEpoch]=useState(0);
  const [before,setBefore]=useState<string|null>(null),[compare,setCompare]=useState(50);
  const resize=useRef<{x:number;y:number;w:number;h:number;edge:string;appliedW:number;appliedH:number}|null>(null);
  const [dragging,setDragging]=useState(false);
  const [overlay,setOverlay]=useState<"none"|"ocr"|"translation">("none");
  const [lines,setLines]=useState<{text:string;box:number[];translated?:string}[]>([]);
  const [targetLanguage,setTargetLanguage]=useState("zh");
  const operation=useRef<AbortController|null>(null);
  const root = useRef<HTMLElement>(null);
  const guard = useRef(false),
    alive = useRef(true);
  const rpc = <T,>(name: string, args: Record<string, unknown> = {}) =>
    invoke<T>(name, { id, ...args });
  const lastShape=useRef("");
  const syncShape = useCallback(async () => {
    const areas = [
      ...(root.current?.querySelectorAll(
        ".shot-image,.shot-rail,.shot-toast,.shot-resize,.capture-modal",
      ) || []),
    ]
      .filter(el=>getComputedStyle(el).visibility!=="hidden")
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      })
      .filter((r) => r.width > 0 && r.height > 0);
    // SetWindowRgn can itself emit resize. Do not resubmit an identical native region.
    const signature=JSON.stringify(areas.map(r=>({...r,x:Math.round(r.x*100)/100,y:Math.round(r.y*100)/100})))+":"+devicePixelRatio;
    if(areas.length&&lastShape.current!==signature){
      lastShape.current=signature;
      try{await invoke("shot_shape",{id,areas});}catch(e){if(lastShape.current===signature)lastShape.current="";throw e;}
    }
  }, [id]);
  useEffect(() => {
    let frame = 0;
    const sync = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(
        () =>
          void syncShape().catch((e) => {
            console.debug("Pin hit region update deferred",e);
          }),
      );
    };
    sync();
    const observer=new MutationObserver(sync);if(root.current)observer.observe(root.current,{childList:true,subtree:true});
    addEventListener("resize", sync);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      removeEventListener("resize", sync);
    };
  }, [shot, status, dragging, toolbar, moving, before, syncShape]);
  useEffect(() => {
    alive.current = true;
    let disposed = false,
      off: (() => void) | undefined,
      revision = 0;
    const load = async () => {
      const token = ++revision;
      try {
        const s = await rpc<Shot>("shot_get");
        const image = new Image();
        image.src = s.dataUrl;
        await image.decode();
        if (disposed || token !== revision) return;
        setLines([]);setOverlay("none");
        setShot(s);setPinned(s.pinned);
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            if (!disposed && token === revision)
              void syncShape()
                .then(() => rpc("shot_window", { operation: "ready" }))
                .catch((e) => {
                  if (disposed) return;
                  console.debug("Pin hit region fallback",e);
                  // Keep the close/error controls reachable if the native shape cannot be applied.
                  void rpc("shot_window", { operation: "ready" }).catch(
                    () => {},
                  );
                });
          }),
        );
      } catch (e) {
        if (!disposed) {
          setError(true);
          setStatus(String(e));
          void rpc("shot_window", { operation: "ready" }).catch(() => {});
        }
      }
    };
    void listen("shot-updated", () => void load())
      .then((un) => {
        if (disposed) un();
        else off = un;
      })
      .catch((e) => {
        if (!disposed) {
          setError(true);
          setStatus(`无法监听贴图更新：${String(e)}`);
        }
      });
    void load();
    return () => {
      disposed = true;
      alive.current = false;
      operation.current?.abort();
      off?.();
    };
  }, [id]);
  useEffect(() => {
    if (!status || error) return;
    const timer = setTimeout(() => setStatus(""), 3500);
    return () => clearTimeout(timer);
  }, [status, error]);
  useEffect(()=>{let ended=false;let off:(()=>void)|undefined;void listen<boolean>("shot-drag-state",e=>{if(!ended)setDragging(e.payload);}).then(fn=>{if(ended)fn();else off=fn;}).catch(e=>{setError(true);setStatus(String(e));});return()=>{ended=true;off?.();};},[]);
  useEffect(()=>{let ended=false,off:(()=>void)|undefined;void listen<Shot["layout"]>("shot-layout",e=>{if(!ended)setShot(s=>s?{...s,layout:e.payload}:s);}).then(fn=>{if(ended)fn();else off=fn;});return()=>{ended=true;off?.();};},[]);
  const resizeQueue=useRef<{r:NonNullable<typeof resize.current>;w:number;h:number}|null>(null),resizing=useRef(false);
  const flushResize=async()=>{
    if(resizing.current)return;resizing.current=true;
    try{while(resizeQueue.current){const q=resizeQueue.current;resizeQueue.current=null;
      await rpc("shot_window",{operation:"resize",displayWidth:q.w,displayHeight:q.h,offsetX:q.r.edge.includes("w")?q.r.appliedW-q.w:0,offsetY:q.r.edge.includes("n")?q.r.appliedH-q.h:0});q.r.appliedW=q.w;q.r.appliedH=q.h;
    }}catch(e){resizeQueue.current=null;if(alive.current){setError(true);setStatus(String(e));}}finally{resizing.current=false;}
  };
  const resizeMove=(e:PointerEvent<HTMLElement>)=>{const r=resize.current;if(!r)return;e.preventDefault();e.stopPropagation();const dx=e.screenX-r.x,dy=e.screenY-r.y;const w=Math.max(48,r.w+(r.edge.includes("w")?-dx:r.edge.includes("e")?dx:0)),h=Math.max(48,r.h+(r.edge.includes("n")?-dy:r.edge.includes("s")?dy:0));resizeQueue.current={r,w,h};void flushResize();};
  const recognize=async(translate:boolean)=>{
    if(!shot)return;
    const currentShot=await rpc<Shot>("shot_get");
    if(!translate&&lines.length){setOverlay(mode=>mode==="ocr"?"none":"ocr");return;}
    if(translate&&overlay==="translation"){setOverlay("none");return;}
    if(translate&&!confirm(__ui("翻译会将识别出的文字发送到在线翻译服务（腾讯/有道），不会上传图片。是否继续？")))return;
    const ctrl=new AbortController();operation.current=ctrl;
    try{
      let parsed=lines;
      if(!parsed.length){
        setStatus("正在本机识别，可稍后在原图位置选择文字…");
        const result=await recognizeScreenshot(imageBlob(currentShot.dataUrl),"json",ctrl.signal,message=>{if(!ctrl.signal.aborted&&alive.current)setStatus(message);});
        if(ctrl.signal.aborted)return;
        const data=JSON.parse(result.content);
        parsed=(Array.isArray(data.lines)?data.lines:[]).filter((line:any)=>typeof line.text==="string"&&Array.isArray(line.box)&&line.box.length===4&&line.box.every((n:unknown)=>typeof n==="number"&&Number.isFinite(n))).map((line:any)=>({text:line.text,box:[Math.max(0,line.box[0]),Math.max(0,line.box[1]),Math.min(currentShot.width,line.box[2]),Math.min(currentShot.height,line.box[3])]})).filter((line:any)=>line.box[2]>line.box[0]&&line.box[3]>line.box[1]);
        if(!parsed.length){setStatus("没有识别到可定位文字，请使用更清晰的图片");return;}
        setLines(parsed);
      }
      if(translate){
        setStatus("正在翻译识别文字…");const translated:typeof parsed=[];
        // Bounded batches preserve line-to-box correspondence, including duplicate strings.
        for(let start=0;start<parsed.length;start+=20){const batch=parsed.slice(start,start+20);const response=await fetch("/api/translate",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({texts:batch.map(line=>line.text),from:"auto",to:targetLanguage}),signal:ctrl.signal});const data=await response.json();if(!response.ok||!Array.isArray(data.translations)||data.translations.length!==batch.length)throw new Error(data.error||"翻译返回内容不完整");translated.push(...batch.map((line,index)=>({...line,translated:String(data.translations[index])})));}
        if(ctrl.signal.aborted)return;setLines(translated);setOverlay("translation");setStatus("译文已覆盖到原图位置，可直接选中复制；再点翻译显示原图");
      }else{setOverlay("ocr");setStatus("在图中文字上拖动选择并复制；空白处或按住 Alt 拖动贴图");}
    }catch(error){if(!ctrl.signal.aborted)throw error;}finally{if(operation.current===ctrl)operation.current=null;}
  };
  const act = async (action: string) => {
    if(action==="close"){operation.current?.abort();await rpc("shot_window",{operation:"close"}).catch(()=>{});return;}
    if (guard.current) return;
    guard.current = true;
    setBusy(true);
    setError(false);
    try {
      if(action==="pin"){await rpc("shot_window",{operation:pinned?"unpin":"pin"});setPinned(!pinned);setStatus(tr(pinned?"已取消置顶":"截图已置顶",pinned?"Always on top disabled":"Screenshot pinned on top"));return;}
      if(editor.current&&!before){const data=editor.current.data();if(data&&data!==shot?.dataUrl)await rpc("shot_update",{dataUrl:data});}
      if(action==="restore"&&before){await rpc("shot_update",{dataUrl:before});setBefore(null);setEpoch(v=>v+1);setStatus("已还原强化前的截图");return;}
      if(action==="upscale"){
        if(before)throw new Error("已展示强化结果；如需重新强化，请先还原");
        const source=editor.current?.data()||shot?.dataUrl;if(!source)return;
        const ctrl=new AbortController();operation.current=ctrl;
        const result=await enhanceShot(source,ctrl.signal,message=>{if(alive.current&&!ctrl.signal.aborted)setStatus(message);});
        if(ctrl.signal.aborted||!alive.current)return;
        await rpc("shot_update",{dataUrl:result});setBefore(source);setCompare(50);setEpoch(v=>v+1);operation.current=null;setStatus("强化完成 · 拖动分隔线比较原图与结果");return;
      }
      if (action === "ocr" || action === "translate") { await recognize(action === "translate"); return; }
      if (action === "edit" || action === "close")
        await rpc("shot_window", { operation: action });
      else if (action === "save") {
        await ensureOutputDirectory();
        const ok = await rpc<boolean>("shot_save");
        if (alive.current) setStatus(ok ? "PNG 已保存到默认输出目录" : "未保存");
        return;
      } else await rpc("shot_action", { action });
      if (alive.current)
        setStatus(
          action === "copy"
            ? "已复制原图"
            : action === "edit"
              ? "已打开独立编辑器"
              : action === "close"
                ? ""
                : "已送入对应工具，贴图仍保留",
        );
    } catch (e) {
      if (alive.current && !(e instanceof DOMException&&e.name==="AbortError")) {
        setError(true);
        setStatus(String(e));
      }
    } finally {
      guard.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const drag = (e: PointerEvent<HTMLElement>) => {
    if ((!moving && e.currentTarget.tagName==="FIGURE") || (e.target as HTMLElement).closest("button,input,textarea,.shot-resize,.capture-modal") || e.button !== 0 || ((e.target as HTMLElement).closest(".shot-text") && !e.altKey)) return;
    e.preventDefault(); setDragging(true);
    void rpc("shot_window", { operation: "drag" }).catch((e) => {
      setDragging(false);
      setError(true);
      setStatus(String(e));
    });
  };
  return (
    <main
      ref={root}
      className={`shot-float ${dragging ? "is-dragging" : ""} ${shot?.layout?.dockLeft ? "dock-left" : ""} ${!shot || shot.layout.imageWidth < 160 ? "compact-toast" : ""}`}
      aria-label={__ui("悬浮截图")}
    >
      <figure
        className="shot-image"
        style={
          shot
            ? { width: shot.layout.imageWidth, height: shot.layout.imageHeight }
            : undefined
        }
        onPointerDown={drag}
        title={__ui("按住图片拖动贴图")}
        aria-label={__ui("可拖动的截图")}
      >
        {shot && (before?<><img src={shot.dataUrl} alt={__ui("强化后的截图")}/><img className="shot-before" src={before} alt={__ui("强化前")} style={{clipPath:`inset(0 ${100-compare}% 0 0)`}}/><div className="shot-split" style={{left:`${compare}%`}}/><input className="shot-compare" type="range" aria-label={__ui("原图与强化结果滑动对比")} min={0} max={100} value={compare} onChange={e=>setCompare(+e.target.value)}/><span className="shot-compare-label">{__ui("原图 ↔ 强化")}</span></>:<ImageEditor key={epoch} inline locked={busy} toolbar={toolbar} onReady={h=>{editor.current=h;}} onMode={setMoving}/>)}
        {shot&&!busy&&["n","ne","e","se","s","sw","w","nw"].map(edge=><span key={edge} className={`shot-resize resize-${edge}`} role="separator" aria-label={__msg("缩放截图 {0}", edge)} onPointerDown={e=>{e.stopPropagation();e.preventDefault();resize.current={x:e.screenX,y:e.screenY,w:shot.layout.imageWidth,h:shot.layout.imageHeight,edge,appliedW:shot.layout.imageWidth,appliedH:shot.layout.imageHeight};e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={resizeMove} onPointerUp={e=>{resizeMove(e);resize.current=null;if(e.currentTarget.hasPointerCapture(e.pointerId))e.currentTarget.releasePointerCapture(e.pointerId);}} onPointerCancel={()=>{resize.current=null;}}/>)}
        {shot&&overlay!=="none"&&lines.map((line,index)=><span key={index} className={`shot-text ${overlay==="translation"?"translated":""}`} title={overlay==="translation"?line.translated:line.text} style={{left:`${line.box[0]/shot.width*100}%`,top:`${line.box[1]/shot.height*100}%`,width:`${(line.box[2]-line.box[0])/shot.width*100}%`,height:`${(line.box[3]-line.box[1])/shot.height*100}%`,fontSize:Math.max(8,(line.box[3]-line.box[1])*shot.layout.imageHeight/shot.height*.8)}}>{overlay==="translation"?line.translated:line.text}</span>)}
      </figure>
      <aside className="shot-rail" aria-label={__ui("截图操作工具条")}>
        <header className="shot-rail-head" onPointerDown={drag}>
          <GripVertical size={13} aria-hidden="true" />
          <span>
            {shot ? (
              <>
                {shot.width} × {shot.height}
                <small>{__ui("原始像素")}</small>
              </>
            ) : (
              __ui("正在载入")
            )}
          </span>
        </header>
        <RoundedSelect aria-label={__ui("译文语言")} title={__ui("翻译目标语言")} className="shot-language" value={targetLanguage} disabled={busy} onChange={e=>{setTargetLanguage(e.target.value);if(overlay==="translation")setOverlay("none");}}><option value="zh">{__ui("译为中文")}</option><option value="en">{__ui("译为英文")}</option><option value="ja">{__ui("译为日文")}</option><option value="ko">{__ui("译为韩文")}</option></RoundedSelect>
        <div ref={setToolbar} className="shot-editor-slot" style={before?{display:"none"}:undefined}/>
        {before&&<button onClick={()=>void act("restore")} disabled={busy}><Undo2 size={16}/>{__ui("还原强化前")}</button>}
        <nav aria-label={__ui("截图动作")}>
          <button type="button" aria-pressed={pinned} disabled={busy||!shot} title={tr(pinned?"取消置顶":"置顶截图",pinned?"Disable always on top":"Keep screenshot on top")} onClick={()=>void act("pin")}>{pinned?<Pin size={16}/>:<PinOff size={16}/>}<span>{tr(pinned?"已置顶":"置顶",pinned?"Pinned":"Pin")}</span></button>
          {actions.map(([action, label, Icon, title]) => (
            <button
              key={action}
              title={__ui(title)}
              disabled={busy || !shot}
              onClick={() => void act(action)}
            >
              <Icon size={16} strokeWidth={1.65} />
              <span>{__ui(label)}</span>
            </button>
          ))}
        </nav>
        <footer>
          <button
            title={__ui("保存 PNG 到默认输出目录")}
            aria-label={__ui("保存 PNG")}
            disabled={busy || !shot}
            onClick={() => void act("save")}
          >
            <Download size={15} />
          </button>
          <i />
          <button
            title={__ui("关闭这张贴图")}
            aria-label={__ui("关闭贴图")}
            onClick={() => void act("close")}
          >
            <X size={16} />
          </button>
        </footer>
      </aside>
      {status && (
        <div
          className={`shot-toast ${error ? "is-error" : ""}`}
          role={error ? "alert" : "status"}
        >
          <span>{__msg(status)}</span>
          {error && (
            <button aria-label={__ui("关闭提示")} onClick={() => setStatus("")}>
              <X size={12} />
            </button>
          )}
        </div>
      )}
    </main>
  );
}
