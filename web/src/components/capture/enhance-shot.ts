import {imageBlob} from "@/lib/screenshot-ocr";
const check=(signal:AbortSignal)=>{if(signal.aborted)throw new DOMException('已取消','AbortError');};
export async function enhanceShot(dataUrl:string,signal:AbortSignal,progress:(s:string)=>void):Promise<string>{
 let jobId='';let completed=false;
 const cancel=()=>{if(jobId&&!completed)void fetch(`/api/jobs/${jobId}/cancel`,{method:'POST'}).catch(()=>{});};
 signal.addEventListener('abort',cancel,{once:true});
 try{
  progress('正在提交本机高清强化…');
  const form=new FormData();form.append('file',new File([imageBlob(dataUrl)],'screenshot.png',{type:'image/png'}));form.append('model','anime-x2');form.append('scale','2');
  // Do not abort the create response: retain the job id so an in-flight cancellation can stop it.
  const response=await fetch('/api/tools/image-upscale',{method:'POST',body:form});const data=await response.json();
  if(!response.ok)throw new Error(data.error||'强化提交失败');jobId=data.id||data.job?.id;if(!jobId)throw new Error('没有返回强化任务编号');
  if(signal.aborted){cancel();check(signal);}
  const deadline=Date.now()+10*60*1000;
  while(Date.now()<deadline){
   check(signal);await new Promise(r=>setTimeout(r,700));check(signal);
   const r=await fetch(`/api/jobs/${jobId}`,{signal,cache:'no-store'});const d=await r.json();if(!r.ok)throw new Error(d.error||'无法读取强化进度');const job=d.job||d;
   if(['failed','cancelled','canceled'].includes(job.status))throw new Error(job.error||'强化任务已停止');
   progress(`${job.message||'正在本机强化'}${Number.isFinite(job.progress)?` · ${Math.round(job.progress)}%`:''}`);
   if(job.status==='completed'){
    completed=true;const result=await fetch(`/api/jobs/${jobId}/download`,{signal});if(!result.ok)throw new Error('强化结果无法读取');const blob=await result.blob();check(signal);
    const image=await createImageBitmap(blob);try{if(image.width*image.height>24000000)throw new Error('强化结果超过贴图像素上限，原截图已保留');const c=document.createElement('canvas');c.width=image.width;c.height=image.height;c.getContext('2d')!.drawImage(image,0,0);return c.toDataURL('image/png');}finally{image.close();}
   }
  }
  cancel();throw new Error('强化等待超时，已请求取消；原截图保留');
 }catch(e){if(!completed)cancel();throw e;}finally{signal.removeEventListener('abort',cancel);}
}
