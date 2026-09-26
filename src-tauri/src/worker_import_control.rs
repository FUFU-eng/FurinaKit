//! Session-scoped, opt-in offline import control. Not a download or recovery journal.
use std::{fs::File,io::Read,path::{Path,PathBuf},sync::{Arc,Mutex,OnceLock,atomic::{AtomicBool,Ordering}}};
use serde::Serialize;
use sha2::{Digest,Sha256};
const PIN:&str="50ca47cabddf65f24f77475343a87dc8c7a181d877d7b0d378de7a4e95f5e156";
#[derive(Clone,Serialize,Debug)]
#[serde(rename_all="camelCase")]
pub struct Status { pub id:Option<String>, pub phase:String, pub kind:String, pub stage:String, pub cancel_requested:bool, pub error:Option<String> }
struct Operation { status:Status, cancel:Arc<AtomicBool> }
#[derive(Default)]
pub(crate) struct Controller { operation:Mutex<Option<Operation>> }
impl Controller {
 pub fn status(&self)->Result<Status,String>{let lock=self.operation.lock().map_err(|_|"Import state unavailable")?;Ok(lock.as_ref().map(|o|o.status.clone()).unwrap_or(Status{id:None,phase:"idle".into(),kind:"none".into(),stage:"none".into(),cancel_requested:false,error:None}))}
 fn reserve(&self)->Result<(String,Arc<AtomicBool>),String>{self.reserve_kind("local-import")}
 fn reserve_kind(&self,kind:&str)->Result<(String,Arc<AtomicBool>),String>{
  let mut lock=self.operation.lock().map_err(|_|"Import state unavailable")?;
  if lock.as_ref().is_some_and(|o|matches!(o.status.phase.as_str(),"running"|"cancelling")){return Err("已有安装任务；请查看状态，不要重复提交 / Import already running".into());}
  let id=uuid::Uuid::new_v4().to_string();let cancel=Arc::new(AtomicBool::new(false));
  *lock=Some(Operation{status:Status{id:Some(id.clone()),phase:"running".into(),kind:kind.into(),stage:"queued".into(),cancel_requested:false,error:None},cancel:cancel.clone()});Ok((id,cancel))
 }
 pub fn cancel(&self,id:&str)->Result<Status,String>{
  let mut lock=self.operation.lock().map_err(|_|"Import state unavailable")?;let o=lock.as_mut().ok_or("No import operation")?;
  if o.status.id.as_deref()!=Some(id){return Err("Stale import operation ID".into());}
  if matches!(o.status.phase.as_str(),"running"|"cancelling"){o.cancel.store(true,Ordering::Release);o.status.cancel_requested=true;o.status.phase="cancelling".into();}
  Ok(o.status.clone())
 }
 fn finish(&self,id:&str,result:Result<(),String>){
  if let Ok(mut lock)=self.operation.lock(){if let Some(o)=lock.as_mut(){if o.status.id.as_deref()==Some(id){match result{Ok(())=>{o.status.phase="succeeded".into();o.status.stage="done".into();o.status.error=None;},Err(e)=>{o.status.phase="failed".into();o.status.stage="failed".into();o.status.error=Some(e);}}}}}
 }
 fn launch(self:&Arc<Self>,work:impl FnOnce(&AtomicBool)->Result<(),String>+Send+'static)->Result<Status,String>{self.launch_kind("local-import",move|cancel,progress|{progress("install");work(cancel)})}
 fn update_stage(&self,id:&str,stage:&str){
  if !["manifest","archive","install"].contains(&stage){return;}
  if let Ok(mut lock)=self.operation.lock(){if let Some(o)=lock.as_mut(){if o.status.id.as_deref()==Some(id)&&matches!(o.status.phase.as_str(),"running"|"cancelling"){o.status.stage=stage.into();}}}
 }
 fn launch_kind(self:&Arc<Self>,kind:&str,work:impl FnOnce(&AtomicBool,&dyn Fn(&str))->Result<(),String>+Send+'static)->Result<Status,String>{
  let(id,cancel)=self.reserve_kind(kind)?;let owner=self.clone();let worker_id=id.clone();
  let accepted=Status{id:Some(id.clone()),phase:"running".into(),kind:kind.into(),stage:"queued".into(),cancel_requested:false,error:None};
  if let Err(e)=std::thread::Builder::new().name("worker-component-operation".into()).spawn(move||{
   // Unwind builds retain a truthful failure; abort builds/process death have no recovery claim.
   let result=std::panic::catch_unwind(std::panic::AssertUnwindSafe(||work(&cancel,&|stage|owner.update_stage(&worker_id,stage)))).unwrap_or_else(|_|Err("Import task panicked; retained files require inspection".into()));
   owner.finish(&worker_id,result);
  }){let message=format!("Cannot start import task: {e}");self.finish(&id,Err(message.clone()));return Err(message);}
  Ok(accepted)
 }
 pub fn start_download(self:&Arc<Self>,components:PathBuf,sources:crate::worker_component_source::Sources)->Result<Status,String>{
  if !components.is_absolute(){return Err("Absolute pinned component root required".into());}
  self.launch_kind("download",move|cancel,progress|crate::worker_download::install_from_https_progress(&components,&sources.manifest_urls,&sources.archive_urls,cancel,progress).map(|_|()))
 }
 pub fn start(self:&Arc<Self>,components:PathBuf,archive:PathBuf,manifest:PathBuf)->Result<Status,String>{
  if !components.is_absolute()||!archive.is_absolute()||!manifest.is_absolute(){return Err("Absolute paths required".into());}
  self.launch(move|cancel|{
   if cancel.load(Ordering::Acquire){return Err("Import cancelled before reading files".into());}
   let bytes=manifest_bytes(&manifest)?;
   if cancel.load(Ordering::Acquire){return Err("Import cancelled before opening store".into());}
   // Destination is supplied ONLY by the startup-pinned component root, never IPC arguments.
   let destination=components.join("python-tools-v2");
   let store=match std::fs::symlink_metadata(&destination){Ok(_)=>crate::component_store::Store::open(&destination)?,Err(e)if e.kind()==std::io::ErrorKind::NotFound=>crate::component_store::Store::create(&destination)?,Err(e)=>return Err(e.to_string())};
   crate::worker_import::install_experimental(&store,&archive,&bytes,cancel).map(|_|())
  })
 }
}
fn manifest_bytes(path:&Path)->Result<Vec<u8>,String>{
 use std::os::windows::fs::{MetadataExt,OpenOptionsExt};
 let file=File::options().read(true).share_mode(1).custom_flags(0x00200000).open(path).map_err(|e|e.to_string())?;
 let meta=file.metadata().map_err(|e|e.to_string())?;
 if !meta.is_file()||meta.file_attributes()&0x400!=0||meta.len()>12_000_000{return Err("Invalid manifest file".into());}
 let mut bytes=Vec::new();file.take(12_000_001).read_to_end(&mut bytes).map_err(|e|e.to_string())?;
 if bytes.len()>12_000_000||format!("{:x}",Sha256::digest(&bytes))!=PIN{return Err("仅接受当前内置哈希对应的清单 / Manifest not approved by compiled policy".into());}Ok(bytes)
}
pub fn controller()->&'static Arc<Controller>{static INSTANCE:OnceLock<Arc<Controller>>=OnceLock::new();INSTANCE.get_or_init(||Arc::new(Controller::default()))}
#[cfg(test)]#[path="worker_import_control_tests.rs"]mod tests;

/// Shared request contract tested without a desktop window. `components` comes from
/// the host's pinned root; JSON never controls the destination or trust hashes.
pub fn dispatch(method:&str,args:&serde_json::Value,enabled:bool,components:Result<PathBuf,String>)->Result<serde_json::Value,String>{dispatch_using(controller(),method,args,enabled,components)}
fn dispatch_using(control:&Arc<Controller>,method:&str,args:&serde_json::Value,enabled:bool,components:Result<PathBuf,String>)->Result<serde_json::Value,String>{
 use serde_json::json;
 if method=="GET"{return Ok(json!({"enabled":enabled,"operation":control.status()?}));}
 if method!="POST"{return Err("Unsupported import method".into());}
 if !enabled{return Err("Experimental worker store is disabled; no import performed".into());}
 let operation=match args.get("action").and_then(|v|v.as_str()).unwrap_or(""){
  "start"=>{
   if args.get("acknowledged").and_then(|v|v.as_bool())!=Some(true){return Err("Explicit local import confirmation required".into());}
   let archive=PathBuf::from(args.get("archive").and_then(|v|v.as_str()).ok_or("Archive path required")?);
   let manifest=PathBuf::from(args.get("manifest").and_then(|v|v.as_str()).ok_or("Manifest path required")?);
   control.start(components?,archive,manifest)?
  },
  "cancel"=>control.cancel(args.get("id").and_then(|v|v.as_str()).ok_or("Operation ID required")?)?,
  _=>return Err("Unknown import action".into()),
 };
 Ok(json!({"enabled":enabled,"operation":operation}))
}
#[derive(serde::Deserialize)]#[serde(tag="action",deny_unknown_fields)]
enum DownloadAction{
 #[serde(rename="download")]Download{acknowledged:bool},
 #[serde(rename="cancel")]Cancel{id:String},
}
pub fn dispatch_download(method:&str,args:&serde_json::Value,enabled:bool,components:Result<PathBuf,String>)->Result<serde_json::Value,String>{
 let sources=if method=="POST"&&args.get("action").and_then(|v|v.as_str())==Some("download"){crate::worker_component_source::configured()?}else{None};
 dispatch_download_using(controller(),method,args,enabled,components,sources,|control,root,sources|control.start_download(root,sources))
}
fn dispatch_download_using(control:&Arc<Controller>,method:&str,args:&serde_json::Value,enabled:bool,components:Result<PathBuf,String>,sources:Option<crate::worker_component_source::Sources>,start:impl FnOnce(&Arc<Controller>,PathBuf,crate::worker_component_source::Sources)->Result<Status,String>)->Result<serde_json::Value,String>{
 use serde_json::json;
 if method=="GET"{return Ok(json!({"enabled":enabled,"operation":control.status()?}));}
 if method!="POST"{return Err("Unsupported component download method".into());}
 if !enabled{return Err("Experimental component execution is disabled; no download started".into());}
 let operation=match serde_json::from_value::<DownloadAction>(args.clone()).map_err(|e|format!("Invalid component action: {e}"))?{
  DownloadAction::Download{acknowledged}=>{
   if !acknowledged{return Err("Explicit component download confirmation required".into());}
   if let Some(sources) = sources {
    start(control,components?,sources)?
   } else if let Some((archive, manifest)) = crate::worker_delivery::local_worker_sources() {
    control.start(components?, archive, manifest)?
   } else {
    return Err("Approved component sources not configured".into());
   }
  },
  DownloadAction::Cancel{id}=>control.cancel(&id)?,
 };
 Ok(json!({"enabled":enabled,"operation":operation}))
}
#[cfg(test)]#[path="worker_download_control_tests.rs"]mod download_tests;
