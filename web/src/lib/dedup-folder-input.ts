import {tr} from './language';
export async function droppedImages(entries:FileSystemEntry[],fallback:File[]):Promise<File[]> {
 const result:File[]=[];let visited=0;
 const walk=async(entry:FileSystemEntry,depth:number)=>{
  if(++visited>50000)throw new Error(tr('目录条目超过50000，请缩小范围。','The folder contains more than 50,000 entries. Choose a smaller folder.'));
  if(entry.name.startsWith('.')||['_重复待删除','$RECYCLE.BIN','System Volume Information'].includes(entry.name))return;
  if(entry.isFile){if(!/\.(png|jpe?g|webp|bmp|gif|tiff?|avif)$/i.test(entry.name))return;const file=await new Promise<File>((resolve,reject)=>(entry as FileSystemFileEntry).file(resolve,reject));Object.defineProperty(file,'dedupRelative',{value:entry.fullPath});result.push(file);if(result.length>20000)throw new Error(tr('一次最多分析20000张图片。','Select no more than 20,000 images.'));}
  else if(entry.isDirectory&&depth<=6){const reader=(entry as FileSystemDirectoryEntry).createReader();for(;;){const part=await new Promise<FileSystemEntry[]>((resolve,reject)=>reader.readEntries(resolve,reject));if(!part.length)break;for(const child of part)await walk(child,depth+1);}}
 };
 if(entries.length){for(const entry of entries)await walk(entry,0);}else result.push(...fallback.filter(f=>/\.(png|jpe?g|webp|bmp|gif|tiff?|avif)$/i.test(f.name)));
 return result;
}
export function fileBase64(file:File):Promise<string>{return new Promise((resolve,reject)=>{if(file.size>60*1024*1024){reject(new Error(tr('图片超过60 MiB。','Image exceeds 60 MiB.')));return;}const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file);});}
