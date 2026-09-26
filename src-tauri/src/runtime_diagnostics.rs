//! Read-only runtime diagnostics. Bundled upscale gets pinned content checks; no engines are executed.
use std::path::{Path,PathBuf};
use serde_json::{json,Value};
fn regular(path:&Path)->bool{std::fs::symlink_metadata(path).map(|m|m.is_file()&&!m.file_type().is_symlink()&&m.len()>0).unwrap_or(false)}
/// Read-only pre-start inspection shares the persistent selection rules with startup.
/// Live app diagnostics use the already pinned root, not a second discovery pass.
pub fn component_location(root:&Path,app_data:&Path,configured:Option<PathBuf>)->Result<PathBuf,String>{
 crate::component_root::peek(root,app_data,configured)
}
fn row(id:&str,zh:&str,en:&str,required:bool,present:bool,component:Option<&str>)->Value{json!({"id":id,"label":zh,"labelEn":en,"required":required,"status":if present{"present"}else{"missing"},"componentId":component,"verification":"file-presence-only"})}
pub fn scan(root:&Path,components:&Path,aria2:Option<&Path>,whisper:Option<&Path>)->Value{
 scan_modes(root,components,aria2,whisper,crate::worker_extension::experimental_enabled(),crate::upscale_extension::enabled())
}
/// Explicit mode is shared by production diagnostics and isolated tests; never taken from UI input.
pub(crate) fn scan_mode(root:&Path,components:&Path,aria2:Option<&Path>,whisper:Option<&Path>,experimental:bool)->Value{scan_modes(root,components,aria2,whisper,experimental,false)}
fn scan_modes(root:&Path,components:&Path,aria2:Option<&Path>,whisper:Option<&Path>,experimental:bool,upscale_experimental:bool)->Value{
 let native=crate::runtime_layout::is_native_base(root);
 // The Windows image-upscale API is unconditionally native, including legacy-layout launches.
 // An old worker or experimental extension must not make this different resource set look ready.
 #[cfg(windows)]
 let bundled=Some(crate::upscale_diagnostics::inspect(root));
 #[cfg(not(windows))]
 let bundled:Option<Value>=None;
 let bundled_verified=bundled.as_ref().map(|v|v["integrityVerified"]==true).unwrap_or(false);
 let legacy_worker=||crate::runtime_layout::worker_root(root,components).filter(|p|(regular(&p.join("services/worker/worker.py"))&&regular(&p.join("services/worker/.venv/Scripts/python.exe")))||(!native&&regular(&p.join("resources/worker/furinakit-worker.exe"))));
 // Keep the same verified generation lease until every presence check completes.
 // Do not consult a legacy worker if the explicitly selected experimental store fails.
 let mut selected=None;let mut selection_error=None;
 let worker=if experimental{match crate::worker_extension::select_mode(root,components,true){
  Ok(value)=>{let path=value.root.clone();selected=Some(value);Some(path)},
  Err(error)=>{selection_error=Some(error);None}
 }}else{legacy_worker()};
 let worker_verified=selected.is_some();
 // A retired Python tree beside a native installation must not count as the active plugin.
 let mut upscale_active=None;let mut upscale_error=None;
 let upscale=if bundled.is_some(){None}else if upscale_experimental{
  match worker.as_ref().ok_or_else(||"Compatible worker unavailable".to_owned()).and_then(|p|crate::upscale_extension::select_mode(components,&p.join("services/worker"),true)){
   Ok(Some(active))=>{let path=active.path.join("services/worker/upscale");upscale_active=Some(active);Some(path)},
   Ok(None)=>{upscale_error=Some("Managed upscale not selected".to_owned());None},
   Err(e)=>{upscale_error=Some(e);None}
  }
 }else{worker.as_ref().map(|p|p.join("services/worker/upscale"))};
 let upscale_engine=if bundled.is_some(){bundled_verified}else{upscale.as_ref().map(|p|regular(&p.join("realesrgan-ncnn-vulkan.exe"))).unwrap_or(false)};
 let upscale_models=if bundled.is_some(){bundled_verified}else{upscale.as_ref().map(|p|p.join("models")).map(|p|std::fs::read_dir(p).map(|entries|entries.flatten().any(|e|e.path().extension().and_then(|x|x.to_str())==Some("param")&&regular(&e.path())&&regular(&e.path().with_extension("bin")))).unwrap_or(false)).unwrap_or(false)};
 let mut media_roots=vec![components.to_owned(),components.join("ffmpeg")];
 if !native{media_roots.extend([root.to_owned(),root.join("tools/engines/ffmpeg"),root.join("services/worker"),root.join("resources")]);}
 let ffmpeg=media_roots.iter().any(|p|regular(&p.join("ffmpeg.exe"))&&regular(&p.join("ffprobe.exe")));
 let aria2=aria2.map(regular).unwrap_or(false);let whisper=whisper.map(regular).unwrap_or(false);
 let mut checks=vec![row("image-worker","原生图片处理核心","Native image worker",native||bundled.is_some(),regular(&root.join("furinakit-image-worker.exe")),None),row("python-worker",if native{"可选共享 Python 工具扩展"}else{"共享 Python 工具工作进程"},"Shared Python tool worker",!native,worker.is_some(),None),row("ffmpeg","FFmpeg / FFprobe 音视频组件","FFmpeg / FFprobe media component",false,ffmpeg,Some("ffmpeg")),row("aria2","Aria2 下载引擎","Aria2 download engine",true,aria2,None),row("whisper","Whisper 语音引擎（模型另装）","Whisper engine (models installed separately)",true,whisper,None),row("upscale-engine","超分辨率引擎","Upscaling engine",bundled.is_some(),upscale_engine,None),row("upscale-models","超分辨率模型文件对","Upscaling model file pairs",bundled.is_some(),upscale_models,None)];
 if experimental{
  checks[1]["verification"]=json!(if worker_verified{"pinned-tree-sha256"}else{"unverified"});
  checks[1]["note"]=json!(if worker_verified{
   "已选择实验共享扩展，内容与固定 SHA-256 清单一致；这不是发行者签名认证，也没有运行引擎或验收工具功能。 / Experimental shared extension matches its pinned content manifest; not publisher authentication, engine execution or tool acceptance.".to_owned()
  }else{
   let missing=matches!(std::fs::symlink_metadata(components.join("python-tools-v2")),Err(ref e) if e.kind()==std::io::ErrorKind::NotFound);
   checks[1]["status"]=json!(if missing{"missing"}else{"unknown"});
   format!("已显式选择实验扩展，但未能验证；不会回退到旧版目录。生产安装入口尚未开放，不会自动下载、删除或修复。 / Experimental extension unavailable; no legacy fallback or automatic install/delete/repair. {}",selection_error.as_deref().unwrap_or("Unknown selection failure").chars().take(1200).collect::<String>())
  });
 }else if native&&worker.is_none(){checks[1]["note"]=json!("原生核心不依赖 Python；需要 Python 的现有工具使用一个按需共享扩展，无需逐个重写。扩展生产安装入口尚未开放，本次不会下载或修复。 / Native core does not require Python. Existing Python tools use one optional shared extension, not individual rewrites. Production extension installation is not yet available; this check does not install or repair it.");}

 if bundled.is_none()&&upscale_experimental{for row in &mut checks[5..=6]{
  row["componentId"]=json!("upscale-ncnn");
  row["verification"]=json!(if upscale_active.is_some(){"pinned-tree-sha256"}else{"unverified"});
  row["note"]=json!(if let Some(e)=&upscale_error{format!("Managed upscale unavailable; no legacy fallback: {}",e.chars().take(1200).collect::<String>())}else{"Managed content verified; engine not executed by diagnostics; not publisher authentication".to_owned()});
 }}
 if let Some(ref bundle)=bundled {
  for row in &mut checks[5..=6] {
   row["status"]=bundle["status"].clone();
   row["componentId"]=bundle["componentId"].clone();
   row["verification"]=bundle["verification"].clone();
   row["note"]=bundle["note"].clone();
  }
 }
 let required_files_present=checks.iter().filter(|r|r["required"]==true).all(|r|r["status"]=="present");
 json!({"ok":true,"schemaVersion":2,"runtime":if native{"native-rust"}else{"legacy-compatible"},"pythonRequired":!native,"checks":checks,"requiredFilesPresent":required_files_present,"verification":if experimental{"file-presence-with-pinned-worker-tree"}else{"file-presence-only"},"workerSelection":if experimental{"experimental-pinned"}else{"legacy"},"workerIntegrityVerified":worker_verified,"upscaleSelection":if bundled.is_some(){"bundled-lite"}else if upscale_experimental{"experimental-pinned"}else{"legacy"},"upscaleIntegrityVerified":if bundled.is_some(){bundled_verified}else{upscale_active.is_some()},"upscaleResourceFilesPresent":bundled.as_ref().map(|v|v["filesPresent"]==true).unwrap_or(upscale_engine&&upscale_models),"upscaleEngineExecuted":false,"upscaleFunctionAccepted":false,"upscalePublisherAuthenticated":false,"enginesExecuted":false,"repaired":false,"purged":0,"dataModified":false,"components":{"worker":worker.is_some(),"ffmpeg":ffmpeg,"aria2c":aria2,"upscaleEngine":upscale_engine,"upscaleModels":upscale_models,"storageCleaned":false}})
}
pub fn health(root:&Path)->Value{let native=crate::runtime_layout::is_native_base(root);json!({"ok":true,"scope":"ipc-reachable-only","runtime":if native{"native-rust"}else{"legacy-compatible"},"pythonRequired":!native,"queue":if native{"native-and-optional-file"}else{"file"},"capabilitiesVerified":false,"message":if native{"原生 Rust IPC 可用；可选组件和各工具能力需分别检查。 / Native Rust IPC reachable; component presence is not feature acceptance."}else{"Rust IPC 可用；旧版工作进程的运行与各工具能力需分别检查。 / Rust IPC reachable; legacy worker execution and capabilities are not verified by this endpoint."}})}
#[cfg(test)]mod tests{
 use super::*;
 struct Temp(PathBuf);impl Temp{fn new()->Self{let base=PathBuf::from(std::env::var_os("FURINAKIT_DIAGNOSTIC_TEST_ROOT").expect("explicit isolated fixture root"));let p=base.join(uuid::Uuid::new_v4().to_string());std::fs::create_dir_all(&p).unwrap();Self(p)}fn put(&self,path:&str,bytes:&[u8]){let p=self.0.join(path);std::fs::create_dir_all(p.parent().unwrap()).unwrap();std::fs::write(p,bytes).unwrap();}}
 impl Drop for Temp{fn drop(&mut self){let _=std::fs::remove_dir_all(&self.0);}}
 fn item<'a>(r:&'a Value,id:&str)->&'a Value{r["checks"].as_array().unwrap().iter().find(|r|r["id"]==id).unwrap()}
 #[test]fn managed_upscale_error_never_reports_legacy_engine_present(){let t=Temp::new();for p in ["services/worker/worker.py","services/worker/.venv/Scripts/python.exe","services/worker/upscale/realesrgan-ncnn-vulkan.exe","services/worker/upscale/models/fixture.param","services/worker/upscale/models/fixture.bin"]{t.put(p,b"presence-only fixture");}let legacy=scan_modes(&t.0,&t.0.join("components"),None,None,false,false);assert_eq!(legacy["components"]["upscaleEngine"],!cfg!(windows));let r=scan_modes(&t.0,&t.0.join("components"),None,None,false,true);assert_eq!(r["components"]["upscaleEngine"],false);assert_eq!(r["upscaleIntegrityVerified"],false);assert_eq!(item(&r,"upscale-engine")["verification"],"unverified");}
 #[test]fn native_missing_python_is_optional_and_stale_legacy_is_ignored(){let t=Temp::new();t.put("FurinaKit-runtime.json",br#"{"runtime":"native-rust","version":"fixture"}"#);t.put("services/worker/worker.py",b"do not execute");t.put("services/worker/.venv/Scripts/python.exe",b"not an executable");t.put("furinakit-image-worker.exe",b"presence fixture");let r=scan(&t.0,&t.0.join("components"),None,None);assert_eq!(r["pythonRequired"],false);assert_eq!(item(&r,"python-worker")["required"],false);assert_eq!(item(&r,"python-worker")["status"],"missing");assert_eq!(item(&r,"image-worker")["status"],"present");assert_eq!(r["requiredFilesPresent"],false);assert_eq!(health(&t.0)["capabilitiesVerified"],false);}
 #[test]fn optional_media_requires_nonempty_pair_and_model_directory_alone_is_not_ready(){let t=Temp::new();t.put("services/worker/worker.py",b"fixture");t.put("services/worker/.venv/Scripts/python.exe",b"fixture");t.put("components/ffmpeg.exe",b"fixture");t.put("services/worker/upscale/models/test.param",b"fixture");let r=scan(&t.0,&t.0.join("components"),None,None);assert_eq!(item(&r,"python-worker")["required"],true);assert_eq!(item(&r,"ffmpeg")["status"],"missing");assert_eq!(item(&r,"upscale-models")["status"],"missing");t.put("components/ffprobe.exe",b"");assert_eq!(item(&scan(&t.0,&t.0.join("components"),None,None),"ffmpeg")["status"],"missing");t.put("components/ffprobe.exe",b"fixture");t.put("services/worker/upscale/models/test.bin",b"fixture");let r=scan(&t.0,&t.0.join("components"),None,None);assert_eq!(item(&r,"ffmpeg")["status"],"present");assert_eq!(item(&r,"upscale-models")["status"],if cfg!(windows){"missing"}else{"present"});assert_eq!(r["verification"],"file-presence-only");}
 #[test]fn scan_and_directory_resolution_never_create_or_delete_user_state(){let t=Temp::new();t.put("data/settings.json",b"synthetic preserved settings");t.put("data/storage/jobs/old.json",b"synthetic preserved history");t.put("data/storage/results/old.txt",b"synthetic preserved output");let components=component_location(&t.0,&t.0.join("data"),None).unwrap();assert!(!components.exists());let r=scan(&t.0,&components,None,None);assert_eq!(r["dataModified"],false);assert_eq!(r["purged"],0);assert_eq!(r["components"]["storageCleaned"],false);assert!(!components.exists());for(name,expected)in[("settings.json",b"synthetic preserved settings".as_slice()),("storage/jobs/old.json",b"synthetic preserved history"),("storage/results/old.txt",b"synthetic preserved output")]{assert_eq!(std::fs::read(t.0.join("data").join(name)).unwrap(),expected);}}

 #[cfg(windows)]
 #[test]fn windows_bundle_is_required_even_when_old_worker_or_experimental_mode_exists(){
  let t=Temp::new();t.put("services/worker/worker.py",b"legacy");t.put("services/worker/.venv/Scripts/python.exe",b"not executed");
  t.put("services/worker/upscale/realesrgan-ncnn-vulkan.exe",b"not the active engine");
  for experimental in [false,true]{let r=scan_modes(&t.0,&t.0.join("components"),None,None,false,experimental);
   assert_eq!(r["upscaleSelection"],"bundled-lite");assert_eq!(r["upscaleIntegrityVerified"],false);
   assert_eq!(r["upscaleResourceFilesPresent"],false);assert_eq!(r["upscaleEngineExecuted"],false);assert_eq!(r["upscaleFunctionAccepted"],false);
   for id in ["image-worker","upscale-engine","upscale-models"]{assert_eq!(item(&r,id)["required"],true);}
   assert_eq!(item(&r,"upscale-engine")["componentId"],"bundled-upscale-lite-v1");assert_eq!(item(&r,"upscale-engine")["status"],"missing");
  }
 }
 #[cfg(windows)]
 #[test]fn present_but_untrusted_bundle_is_unknown_not_healthy(){
  let t=Temp::new();let manifest:Value=serde_json::from_str(crate::upscale_lite::MANIFEST).unwrap();
  for f in manifest["files"].as_array().unwrap(){t.put(&format!("tools/engines/upscale-lite/{}",f["path"].as_str().unwrap()),b"untrusted fixture");}
  let r=scan_modes(&t.0,&t.0.join("components"),None,None,false,false);
  assert_eq!(r["upscaleResourceFilesPresent"],true);assert_eq!(r["upscaleIntegrityVerified"],false);
  for id in ["upscale-engine","upscale-models"]{assert_eq!(item(&r,id)["status"],"unknown");assert_eq!(item(&r,id)["verification"],"unverified");}
  assert_eq!(r["components"]["upscaleEngine"],false);assert_eq!(r["requiredFilesPresent"],false);assert_eq!(r["enginesExecuted"],false);
 }
}
