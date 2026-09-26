/** Snapshot WebKit entries during drop; enumerate only direct children, never recurse. */
export function dropEntries(data:DataTransfer|null){return Array.from(data?.items||[]).map(i=>i.webkitGetAsEntry()).filter((e):e is FileSystemEntry=>!!e);}
export async function directFiles(entries:FileSystemEntry[]):Promise<File[]>{
  const files:File[]=[];
  const read=(e:FileSystemEntry)=>new Promise<File>((resolve,reject)=>(e as FileSystemFileEntry).file(resolve,reject));
  for(const entry of entries){
    if(entry.isFile)files.push(await read(entry));
    else if(entry.isDirectory){const reader=(entry as FileSystemDirectoryEntry).createReader();for(;;){const chunk=await new Promise<FileSystemEntry[]>((resolve,reject)=>reader.readEntries(resolve,reject));if(!chunk.length)break;for(const child of chunk){if(child.isFile)files.push(await read(child));}if(files.length>10000)throw new Error("一次最多导入10000个文件，请拆分文件夹。");}}
  }
  return files.sort((a,b)=>a.name.localeCompare(b.name,undefined,{numeric:true}));
}
export function pickDirectFolder():Promise<File[]>{return new Promise(resolve=>{
  const input=document.createElement("input");input.type="file";input.multiple=true;input.setAttribute("webkitdirectory","");
  input.onchange=()=>resolve(Array.from(input.files||[]).filter(f=>f.webkitRelativePath.split("/").length===2));input.oncancel=()=>resolve([]);input.click();
});}
