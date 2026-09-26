import {useEffect,useRef} from "react";
type Layer={priority:number;close:()=>void};
const layers:Layer[]=[];
function onEscape(e:KeyboardEvent){
 if(e.key!=="Escape"||e.repeat||e.isComposing||e.ctrlKey||e.altKey||e.metaKey||e.defaultPrevented||document.querySelector('[data-shortcut-recording]')||document.fullscreenElement)return;
 const layer=layers.reduce<Layer|undefined>((top,next)=>!top||next.priority>=top.priority?next:top,undefined);
 if(!layer)return;
 // Unknown tool dialogs retain their own Escape handling; do not hide the window underneath.
 if(layer.priority<50&&Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]')).some(d=>d.getClientRects().length))return;
 e.preventDefault();e.stopImmediatePropagation();layer.close();
}
/** Highest-priority visible surface owns one Escape. Recording Escape as a shortcut is untouched. */
export function useEscapeDismiss(close:()=>void,active=true,priority=0){
 const latest=useRef(close);latest.current=close;
 useEffect(()=>{if(!active)return;const layer={priority,close:()=>latest.current()};if(!layers.length)window.addEventListener("keydown",onEscape);layers.push(layer);return()=>{const i=layers.indexOf(layer);if(i>=0)layers.splice(i,1);if(!layers.length)window.removeEventListener("keydown",onEscape);};},[active,priority]);
}
