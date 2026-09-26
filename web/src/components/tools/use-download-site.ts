import { useEffect, useRef, type RefObject } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

// Serialize mount/unmount calls, including React StrictMode remounts.
let pending: Promise<unknown> = Promise.resolve();
function enqueue(args: Record<string, unknown>) {
  const task = pending.catch(() => {}).then(() => invoke("sync_download_site", args));
  pending = task.catch(() => {});
  return task;
}
export function useDownloadSite(container: RefObject<HTMLDivElement | null>, revision: number, dark: boolean, onLoad: () => void, onError: () => void) {
  const native = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
  const callbacks=useRef({onLoad,onError});callbacks.current={onLoad,onError};
  const lastRevision=useRef(-1);
  useEffect(() => {
    if(!native || !container.current)return;
    let alive=true,previous="",refresh=lastRevision.current!==revision;
    const hide={visible:false,x:0,y:0,width:1,height:1,dark,refresh:false};
    const update=() => {
      const el=container.current;if(!alive||!el)return;
      const r=el.getBoundingClientRect();
      const x=Math.max(0,r.left+1),y=Math.max(0,r.top+1);
      const width=Math.max(1,Math.min(innerWidth,r.right-1)-x),height=Math.max(1,Math.min(innerHeight,r.bottom-1)-y);
      const dialogs=[...document.querySelectorAll<HTMLElement>('[role="dialog"],[aria-modal="true"],div[class*="fixed"][class*="inset-0"]')];
      const covered=dialogs.some(d=>{const b=d.getBoundingClientRect();return b.width>0&&b.height>0&&getComputedStyle(d).visibility!=="hidden"&&b.left<x+width&&b.right>x&&b.top<y+height&&b.bottom>y});
      const top=document.elementFromPoint(x+width/2,y+height/2);
      const visible=document.visibilityState!=="hidden"&&r.width>2&&r.height>2&&!covered&&!!top&&(top===el||el.contains(top));
      const args={visible,x,y,width,height,dark,refresh:visible&&refresh};
      const key=JSON.stringify(args);if(key===previous)return;previous=key;
      if(visible){refresh=false;lastRevision.current=revision;}
      void enqueue(args).catch(()=>{if(alive)callbacks.current.onError()});
    };
    const listener=listen("download-site-loaded",()=>{if(alive)callbacks.current.onLoad()});
    void listener.catch(()=>{if(alive)callbacks.current.onError()});
    const observer=new ResizeObserver(update);observer.observe(container.current);
    const mutations=new MutationObserver(update);mutations.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:["class","style","aria-hidden"]});
    window.addEventListener("resize",update);window.addEventListener("scroll",update,true);document.addEventListener("visibilitychange",update);
    update();
    return()=>{alive=false;observer.disconnect();mutations.disconnect();window.removeEventListener("resize",update);window.removeEventListener("scroll",update,true);document.removeEventListener("visibilitychange",update);void listener.then(off=>off()).catch(()=>{});void enqueue(hide).catch(()=>{})};
  },[native,container,revision,dark]);
  return native;
}
