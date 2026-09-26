
import { createUiText as __createUiText, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/notes-editor.tsx");
import {useLayoutEffect,useRef} from "react";
import {Bold,Italic,List,ListOrdered,ListTodo} from "lucide-react";
const marker="<!--furina-rich-v1-->";
function clean(html:string){
  const doc=new DOMParser().parseFromString(html,"text/html");
  const allowed=new Set(["P","DIV","BR","B","STRONG","I","EM","U","SPAN","FONT","OL","UL","LI","INPUT"]);
  const walk=(node:Node):Node=>{
    if(node.nodeType===Node.TEXT_NODE)return document.createTextNode(node.textContent||"");
    if(!(node instanceof Element))return document.createTextNode("");
    if(["SCRIPT","STYLE","IFRAME","OBJECT"].includes(node.tagName))return document.createTextNode("");
    const el=document.createElement(allowed.has(node.tagName)?node.tagName.toLowerCase():"span");
    if(node.tagName==="INPUT"){el.setAttribute("type","checkbox");if(node.hasAttribute("checked"))el.setAttribute("checked","");}
    const color=(node as HTMLElement).style?.color||node.getAttribute("color");
    if(color && CSS.supports("color",color))el.style.color=color;
    if(node.tagName!=="INPUT")node.childNodes.forEach(c=>el.appendChild(walk(c)));
    return el;
  };
  const root=document.createElement("div");doc.body.childNodes.forEach(n=>root.appendChild(walk(n)));return root.innerHTML;
}
export function noteText(value:string){if(!value.startsWith(marker))return value;const doc=new DOMParser().parseFromString(value.slice(marker.length),"text/html");return doc.body.textContent||"";}
export function NotesEditor({value,onChange,disabled}:{value:string;onChange:(s:string)=>void;disabled:boolean}){
  const __locale = __useLanguage();
  const editor=useRef<HTMLDivElement>(null),last=useRef<string|null>(null),selection=useRef<Range|null>(null);
  useLayoutEffect(()=>{if(!editor.current||value===last.current)return;if(value.startsWith(marker))editor.current.innerHTML=clean(value.slice(marker.length));else editor.current.innerText=value;last.current=value;},[value]);
  const update=()=>{if(!editor.current)return;const next=marker+clean(editor.current.innerHTML);last.current=next;onChange(next);};
  const remember=()=>{const s=window.getSelection();if(s?.rangeCount&&editor.current?.contains(s.anchorNode))selection.current=s.getRangeAt(0).cloneRange();};
  const command=(name:string,arg?:string)=>{if(disabled)return;editor.current?.focus();if(selection.current){const s=window.getSelection();s?.removeAllRanges();s?.addRange(selection.current);}document.execCommand(name,false,arg);remember();update();};
  return <div className="note-rich-editor"><div className="mb-3 flex flex-wrap items-center gap-1 rounded-xl border border-border bg-background/50 p-1.5" role="toolbar" aria-label={__ui("便签文字格式")}>
    {[[ListOrdered,"有序列表","insertOrderedList"],[List,"无序列表","insertUnorderedList"],[ListTodo,"待办清单","checklist"],[Bold,"加粗","bold"],[Italic,"斜体","italic"]].map(([Icon,label,cmd])=>{const I=Icon as typeof Bold;return <button key={String(cmd)} type="button" disabled={disabled} title={String(label)} aria-label={String(label)} onMouseDown={e=>e.preventDefault()} onClick={()=>command(String(cmd)==="checklist"?"insertHTML":String(cmd),String(cmd)==="checklist"?'<div><input type="checkbox"> 待办事项</div>':undefined)} className="rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"><I size={21} strokeWidth={String(cmd)==="insertOrderedList"?2.5:1.8}/></button>;})}
    <label title={__ui("文字颜色")} className="ml-1 flex items-center gap-2 border-l border-border pl-3 text-xs text-muted-foreground">{__ui("字色")}<input aria-label={__ui("文字颜色")} type="color" defaultValue="#0284c7" disabled={disabled} onFocus={remember} onChange={e=>command("foreColor",e.target.value)} className="h-6 w-7 cursor-pointer bg-transparent"/></label>
  </div><div ref={editor} contentEditable={!disabled} suppressContentEditableWarning role="textbox" aria-multiline="true" aria-label={__ui("便签内容")} onInput={()=>{remember();update();}} onKeyUp={remember} onMouseUp={remember} onClick={e=>{if(e.target instanceof HTMLInputElement){e.target.toggleAttribute("checked",e.target.checked);update();}}} onPaste={e=>{if(e.clipboardData.files.length)return;e.preventDefault();command("insertText",e.clipboardData.getData("text/plain"));}} className="min-h-64 w-full break-words bg-transparent text-sm leading-7 outline-none [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6 [&_input]:mr-2"/></div>;
}
