import { getAvailableTools, getToolById } from "@furinakit/shared";
import { acceptsFile, fileKind, type PendingFileItem } from "./pending-file-model";
type FileLike=Pick<PendingFileItem,"name"|"type">;
const preferred:Record<string,string[]>={
 image:["image-format-convert","image-compress","image-resize","image-crop","bg-remove"],
 pdf:["pdf-editor","pdf-to-word","pdf-to-images","ocr-pdf"],
 audio:["audio-format-convert","audio-trim","audio-volume","audio-merge","audio-transcribe"],
 video:["video-format-convert","video-compress","video-to-audio","video-to-gif","video-trim"],
 office:["word-to-pdf","excel-to-pdf","ppt-to-pdf"],
};
export function recommendationCategory(file:FileLike){const kind=fileKind(file);return kind==="video"?"download":kind==="office"?"pdf":kind==="other"?"utility":kind;}
export function recommendationsFor(file:FileLike|undefined){
 if(!file)return [];
 const order=preferred[fileKind(file)]||[];
 const tools=getAvailableTools().filter(t=>t.inputs.some(i=>i.type==="file"&&acceptsFile(file,i.accept)));
 return tools.sort((a,b)=>{
  const rank=(t:typeof a)=>{const n=order.indexOf(t.id);return n>=0?n:t.category===recommendationCategory(file)?50:100;};
  return rank(a)-rank(b);
 }).slice(0,5);
}
export function currentToolAccepts(files:FileLike[]){
 const id=decodeURIComponent(location.pathname.split("/tools/")[1]||"");
 const inputs=getToolById(id)?.inputs.filter(i=>i.type==="file")||[];
 return files.every(f=>inputs.some(i=>acceptsFile(f,i.accept)));
}
export function recommendFiles(files:File[],unsupported=location.pathname.startsWith("/tools/")){
 window.dispatchEvent(new CustomEvent("furinakit:recommend-files",{detail:{files,unsupported}}));
}
