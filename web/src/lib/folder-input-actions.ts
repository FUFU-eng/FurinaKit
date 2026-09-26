import {pickDirectFolder} from './folder-import';
import {acceptsFile} from './pending-file-model';
import {tr,uiMessage} from './language';
/** Delegate folder contents to the existing multi-file input; never recurse or translate filenames. */
export function installFolderInputActions(){
 const entries=new Map<HTMLInputElement,HTMLDivElement>();let queued=false;
 const sync=()=>{queued=false;
  for(const [input,wrapper] of entries){if(!input.isConnected){wrapper.remove();entries.delete(input);}else{const b=wrapper.querySelector('button');const label=tr('导入文件夹 · 仅第一层文件','Import folder · top-level files only');if(b&&b.textContent!==label)b.textContent=label;}}
  for(const input of document.querySelectorAll<HTMLInputElement>('input[type="file"][multiple]')){
   if(entries.has(input)||input.hasAttribute('webkitdirectory')||input.hasAttribute('data-no-folder-import')||input.closest('[data-furinakit-dropzone],[data-dedup-drop],[role="dialog"],[data-no-folder-import]')||input.classList.contains('hidden'))continue;
   const host=input.closest('[data-furinakit-file-field]')||input.parentElement;if(!host)continue;
   const wrapper=document.createElement('div');wrapper.className='my-2 flex items-center gap-2';const button=document.createElement('button');button.type='button';button.className='rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-primary hover:bg-primary/10';button.textContent=tr('导入文件夹 · 仅第一层文件','Import folder · top-level files only');const status=document.createElement('span');status.className='text-xs text-muted-foreground';status.setAttribute('role','status');wrapper.append(button,status);host.append(wrapper);entries.set(input,wrapper);
   button.onclick=async e=>{e.preventDefault();e.stopPropagation();if(input.disabled)return;button.disabled=true;status.textContent='';try{const files=await pickDirectFolder();if(!files.length||!input.isConnected)return;const accepted=files.filter(f=>acceptsFile(f,input.accept));const max=Number(input.dataset.maxFiles)||Infinity;if(accepted.length>max)throw new Error(tr(`共 ${accepted.length} 个支持的文件，超过上限 ${max}，请拆分文件夹`,`The folder contains ${accepted.length} supported files; the limit is ${max}. Split the folder and try again.`));if(!accepted.length)throw new Error(tr('第一层没有支持的文件','No supported files in the top level.'));const transfer=new DataTransfer();accepted.forEach(f=>transfer.items.add(f));input.files=transfer.files;input.dispatchEvent(new Event('change',{bubbles:true}));status.textContent=tr(`已导入 ${accepted.length} 个文件，跳过 ${files.length-accepted.length} 个不支持的文件`,`Imported ${accepted.length} files; skipped ${files.length-accepted.length} unsupported files.`);}catch(e){status.textContent=uiMessage(e instanceof Error?e.message:String(e));}finally{button.disabled=false;}};
  }
 };
 const observer=new MutationObserver(()=>{if(!queued){queued=true;requestAnimationFrame(sync);}});observer.observe(document.body,{childList:true,subtree:true});observer.observe(document.documentElement,{attributes:true,attributeFilter:['lang']});sync();
}
