import {useEffect} from "react";
import {invoke} from "@tauri-apps/api/core";
import {listen} from "@tauri-apps/api/event";
import {useToast} from "@/components/ui/toast";
export function UtilityShortcuts(){
  const {toast}=useToast();
  useEffect(()=>{
    let alive=true;let unlisten:(()=>void)|undefined;
    void listen<string>("utility-error",e=>toast({title:"快捷键操作失败",description:e.payload,variant:"error"})).then(fn=>{if(alive)unlisten=fn;else fn();});
    void invoke<{error?:string}>("get_global_shortcuts").then(r=>{if(alive&&r.error)toast({title:"快捷键未全部生效",description:r.error,variant:"error"});});
    return()=>{alive=false;unlisten?.();};
  },[toast]);return null;
}
