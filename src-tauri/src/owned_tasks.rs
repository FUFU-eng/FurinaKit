//! Persistent native task lifecycle. Only handles created by this process may be stopped.
use std::{collections::HashMap,path::{Path,PathBuf},sync::{Arc,Mutex,OnceLock,atomic::{AtomicU8,Ordering}},time::{Duration,Instant},fs,io::Read};
use serde_json::{Value,json};
use tauri::Manager;
use sha2::{Digest,Sha256};
pub struct Control{pub request:AtomicU8,pub engine:String}
fn running()->&'static Mutex<HashMap<String,Arc<Control>>>{static MAP:OnceLock<Mutex<HashMap<String,Arc<Control>>>>=OnceLock::new();MAP.get_or_init(||Mutex::new(HashMap::new()))}
pub fn reserve(id:&str,engine:&str)->Result<Arc<Control>,String>{
    let mut map=running().lock().map_err(|_|"任务状态不可用")?;
    if map.contains_key(id){return Err("任务已经在运行".into());}
    let limit=if matches!(engine,"whisper"|"media"){1}else{3};if map.values().filter(|c|c.engine==engine).count()>=limit{return Err(format!("此引擎最多同时运行{limit}个任务，请先暂停或等待当前任务"));}
    let control=Arc::new(Control{request:AtomicU8::new(0),engine:engine.into()});map.insert(id.into(),control.clone());Ok(control)
}
pub fn progress(app:&tauri::AppHandle,id:&str,control:&Control,data:Value)->Result<(),String>{
    let _map=running().lock().map_err(|_|"任务状态异常")?;
    if control.request.load(Ordering::SeqCst)!=0{return Ok(());}
    crate::jobs::update_job(app,id,data.as_object().cloned().ok_or("任务更新无效")?).ok_or("无法保存任务状态")?;Ok(())
}
pub fn finish(app:&tauri::AppHandle,id:&str,control:&Control,result:Result<Value,String>){
    finish_inner(app,id,control,result,false);
}
fn finish_inner(app:&tauri::AppHandle,id:&str,control:&Control,result:Result<Value,String>,cleanup_confirmed:bool){
    let mut map=running().lock().unwrap_or_else(|e|e.into_inner());
    let request=control.request.load(Ordering::SeqCst);
    let mut state=if request==1{json!({"status":"paused","message":"已暂停，部分文件保留，可继续下载","speed":0})}else if request==2{json!({"status":"cancelled","message":if control.engine=="ocr"{"已取消文字识别 / OCR cancelled"}else if control.engine=="image"{"已取消图片处理 / Image task cancelled"}else if control.engine=="media"{"已取消音视频处理 / Media task cancelled"}else{"已停止自有进程，部分文件保留"},"speed":0})}else{match result{Ok(data)=>data,Err(error)=>json!({"status":"failed","message":"执行失败","error":error,"speed":0})}};
    if cleanup_confirmed { state["processCleanupPending"]=json!(false);state["processCleanupConfirmed"]=json!(true);if request!=0{state["error"]=Value::Null;} }
    if crate::jobs::update_job(app,id,state.as_object().cloned().unwrap_or_default()).is_none(){eprintln!("Unable to persist owned task final state");}
    map.remove(id);
}
pub fn stop(app:&tauri::AppHandle,id:&str,pause:bool)->Result<Value,String>{
    let map=running().lock().map_err(|_|"任务状态不可用")?;
    let control=match map.get(id){Some(control)=>control,None=>{
        let job=crate::jobs::read_job_public(app,id).ok_or("任务不存在")?;
        if !pause&&matches!(job["nativeEngine"].as_str(),Some("aria2"|"whisper"|"ocr"|"image"|"media"))&&matches!(job["status"].as_str(),Some("paused"|"pending")){
            let job=crate::jobs::update_job(app,id,json!({"status":"cancelled","message":"已取消；原文件和断点文件均保留"}).as_object().unwrap().clone()).ok_or("保存取消状态失败")?;return Ok(json!({"ok":true,"job":job}));
        }return Err("此任务没有正在运行的自有进程".into());
    }};
    if pause&&control.engine!="aria2"{return Err("此任务仅支持停止，不支持暂停".into());}
    control.request.fetch_max(if pause{1}else{2},Ordering::SeqCst);
    let job=crate::jobs::update_job(app,id,json!({"status":"stopping","message":if pause{"正在保存断点并暂停…"}else if control.engine=="ocr"{"正在取消文字识别… / Cancelling OCR…"}else if control.engine=="image"{"正在取消图片处理… / Cancelling image task…"}else if control.engine=="media"{"正在取消音视频处理… / Cancelling media task…"}else{"正在停止自有进程…"}}).as_object().unwrap().clone()).ok_or("无法保存停止请求")?;
    Ok(json!({"ok":true,"job":job}))
}
pub fn cancel(app:&tauri::AppHandle,id:&str)->Option<Result<Value,String>>{
    let job=crate::jobs::read_job_public(app,id)?;
    if !matches!(job["nativeEngine"].as_str(),Some("aria2"|"whisper"|"ocr"|"image"|"media")){return None;}
    Some(stop(app,id,false))
}
pub fn recover(app:&tauri::AppHandle){
    for job in crate::jobs::list_native_jobs(app){
        let status=job["status"].as_str().unwrap_or("");
        if !matches!(status,"pending"|"processing"|"running"|"stopping"){continue;}
        let engine=job["nativeEngine"].as_str().unwrap_or("");
        if let Some(id)=job["id"].as_str(){let _=crate::jobs::update_job(app,id,json!({"status":if engine=="aria2"{"paused"}else{"failed"},"message":"上次程序退出时任务中断；未自动联网恢复","error":if engine=="whisper"{"转写中断，请重新提交"}else if engine=="ocr"{"文字识别中断，请重新提交 / OCR interrupted; submit again"}else if engine=="image"{"图片处理中断，请重新提交 / Image task interrupted; submit again"}else if engine=="media"{"音视频处理中断，请重新提交 / Media task interrupted; submit again"}else{""},"speed":0}).as_object().unwrap().clone());}
    }
}
pub fn engine(app:&tauri::AppHandle,name:&str)->Result<PathBuf,String>{
    if name == "ffmpeg" {
        let comp_dir = crate::api::components_dir(app)?;
        crate::ffmpeg_components::ensure_bundled(&comp_dir);
        for candidate in [comp_dir.join("ffmpeg.exe"), comp_dir.join("ffmpeg/ffmpeg.exe")] {
            if candidate.is_file() {
                return fs::canonicalize(candidate).map_err(|e| e.to_string());
            }
        }
        return Err("缺少 FFmpeg 核心引擎，请前往「设置 - 组件管理」下载".into());
    }
    let suffix=match name{"aria2"=>"aria2/aria2c.exe","whisper"=>"whisper/whisper-cli.exe",_=>return Err("未知引擎".into())};
    let mut roots=Vec::new();if let Ok(p)=app.path().resource_dir(){roots.push(p.join("tools/engines"));}if let Ok(p)=std::env::current_exe(){if let Some(dir)=p.parent(){roots.push(dir.join("tools/engines"));}}
    #[cfg(debug_assertions)] roots.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tools/engines"));
    for root in roots{let file=root.join(suffix);if file.is_file(){return fs::canonicalize(file).map_err(|e|e.to_string());}}
    Err(format!("缺少随安装包提供的 {name} 引擎，请使用完整安装包或重新安装"))
}
pub fn system_tool(name:&str)->Result<PathBuf,String>{
    if !["curl.exe","WindowsPowerShell/v1.0/powershell.exe"].contains(&name){return Err("未知系统工具".into());}
    let path=PathBuf::from(std::env::var_os("SystemRoot").ok_or("无法定位Windows目录")?).join("System32").join(name);
    if !path.is_file(){return Err(format!("系统缺少 {name}"));}Ok(path)
}
pub fn wait(process:&crate::download_process::OwnedProcess,control:&Control,timeout:Duration)->Result<(),String>{
    let start=Instant::now();loop{if control.request.load(Ordering::SeqCst)!=0{process.terminate(Duration::from_secs(5))?;return Err("任务已停止".into());}
        if let Some(code)=process.try_exit()?{return if code==0{Ok(())}else{Err(format!("引擎退出码 {code}，请检查输入格式、组件或可用内存"))};}
        if start.elapsed()>timeout{process.terminate(Duration::from_secs(5))?;return Err("执行超过最长等待时间，进程已停止".into());}std::thread::sleep(Duration::from_millis(160));}
}
pub fn digest(path:&Path)->Result<String,String>{let mut file=fs::File::open(path).map_err(|e|e.to_string())?;let mut buffer=vec![0;1024*1024];let mut hash=Sha256::new();loop{let n=file.read(&mut buffer).map_err(|e|e.to_string())?;if n==0{break;}hash.update(&buffer[..n]);}Ok(format!("{:x}",hash.finalize()))}

/// Serialize record removal against native completion/progress and resume reservations.
pub fn forget_magnet(app:&tauri::AppHandle,id:&str)->Result<Value,String>{
    let map=running().lock().map_err(|_|"任务状态不可用")?;
    if map.contains_key(id){return Err("任务仍在停止中，请稍后再删除".into());}
    crate::jobs::forget_magnet_job(app,id)?;
    Ok(json!({"ok":true}))
}

/// Holds the reservation and final-state callback until every retained child is gone.
/// A cleanup timeout may return from the task thread, but must not announce cancellation.
pub type ScopedOutcome = Arc<Mutex<Option<Result<Value, String>>>>;
pub fn resource_scope(app: &tauri::AppHandle, id: &str, control: &Arc<Control>, lease: crate::component_leases::Lease) -> (crate::task_custody::Scope, ScopedOutcome) {
    let outcome: ScopedOutcome = Arc::new(Mutex::new(None));
    let result = outcome.clone(); let app=app.clone(); let id=id.to_owned(); let control=control.clone();
    let finished=crate::task_custody::OnRelease::new(move || {
        let final_result=result.lock().unwrap_or_else(|e|e.into_inner()).take().unwrap_or_else(||Err("任务执行线程异常结束 / Task execution ended without a result".into()));
        finish_inner(&app,&id,&control,final_result,true);
    });
    (crate::task_custody::Scope::new((lease,finished)),outcome)
}
pub fn finish_scoped(app:&tauri::AppHandle,id:&str,result:Result<Value,String>,scope:crate::task_custody::Scope,outcome:ScopedOutcome) {
    let error=result.as_ref().err().cloned();
    *outcome.lock().unwrap_or_else(|e|e.into_inner())=Some(result);
    if scope.has_retained_users() {
        // Our own scope prevents the final callback racing ahead of this write.
        let _map=running().lock().unwrap_or_else(|e|e.into_inner());
        let state=json!({"status":"stopping","message":"辅助进程退出尚未确认，资源及任务占位仍保留 / Process-tree exit unconfirmed; resources and task slot retained","error":error,"processCleanupPending":true,"processCleanupConfirmed":false,"speed":0});
        if crate::jobs::update_job(app,id,state.as_object().unwrap().clone()).is_none(){eprintln!("Unable to persist pending process cleanup");}
    }
    drop(scope); // The last retained scope, possibly a reaper, publishes the final state.
}
