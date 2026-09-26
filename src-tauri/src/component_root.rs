//! Stable, per-profile component location. Selection is persisted separately from user
//! settings and pinned per process. Inspection never creates or repairs directories.
use std::{fs, io::{Read,Write}, path::{Path,PathBuf}, sync::OnceLock};
use serde_json::json;
const RECORD:&str="component-location-v1.json";
const MAX_RECORD:u64=16*1024;
fn configured(value:Option<PathBuf>)->Option<PathBuf>{value.filter(|p|!p.as_os_str().to_string_lossy().trim().is_empty())}
fn absolute(path:PathBuf)->Result<PathBuf,String>{
    if !path.is_absolute(){return Err("组件目录必须是绝对路径 / Component directory must be an absolute path".into());}
    Ok(path)
}
fn ordinary(meta:&fs::Metadata)->bool{
    #[cfg(windows)] {use std::os::windows::fs::MetadataExt;if meta.file_attributes()&0x400!=0{return false;}}
    meta.is_file()&&!meta.file_type().is_symlink()&&meta.len()<=MAX_RECORD
}
fn saved(data:&Path)->Result<Option<PathBuf>,String>{
    let path=data.join(RECORD);
    let meta=match fs::symlink_metadata(&path){Ok(m)=>m,Err(e)if e.kind()==std::io::ErrorKind::NotFound=>return Ok(None),Err(e)=>return Err(format!("Cannot inspect component location record: {e}"))};
    if !ordinary(&meta){return Err("组件位置记录不是受支持的普通文件，原记录保留 / Invalid component location record; preserved".into());}
    let mut options=fs::OpenOptions::new();options.read(true);
    #[cfg(windows)]{use std::os::windows::fs::OpenOptionsExt;options.custom_flags(0x00200000);}
    let file=options.open(&path).map_err(|e|e.to_string())?;
    if !ordinary(&file.metadata().map_err(|e|e.to_string())?){return Err("Component location record changed".into());}
    let mut bytes=Vec::new();file.take(MAX_RECORD+1).read_to_end(&mut bytes).map_err(|e|e.to_string())?;
    if bytes.len()as u64>MAX_RECORD{return Err("Component location record exceeds size limit".into());}
    let v:serde_json::Value=serde_json::from_slice(&bytes).map_err(|_|"组件位置记录损坏，未回退到其他目录 / Component location record is corrupt; no fallback")?;
    if v["schemaVersion"].as_u64()!=Some(1){return Err("Unsupported component location record version; preserved".into());}
    let p=v["path"].as_str().ok_or("Invalid component location path; preserved")?;
    absolute(PathBuf::from(p)).map(Some)
}
/// Priority: nonblank explicit override, saved choice, original legacy ONNX detection,
/// then app-data/components. Existence changes never override a saved selection.
pub fn peek(root:&Path,data:&Path,override_path:Option<PathBuf>)->Result<PathBuf,String>{
    if let Some(path)=configured(override_path){return absolute(path);}
    if let Some(path)=saved(data)?{return Ok(path);}
    let shared=root.join("apps/web/components");
    let legacy=fs::read_dir(&shared).map(|entries|entries.flatten().any(|e|e.path().extension().and_then(|x|x.to_str())==Some("onnx")&&e.path().is_file())).unwrap_or(false);
    absolute(if legacy{shared}else{data.join("components")})
}
fn prepare(path:&Path)->Result<PathBuf,String>{
    fs::create_dir_all(path).map_err(|e|format!("无法准备组件目录 / Cannot prepare component directory: {e}"))?;
    fs::canonicalize(path).map_err(|e|e.to_string())
}
/// Explicit startup-only initialization, not called by diagnostics. Publish a complete
/// first-choice record via a no-replace hard link; concurrent starters use the winner.
/// Unsupported filesystems fail closed instead of overwriting a competing record.
pub fn initialize(root:&Path,data:&Path,override_path:Option<PathBuf>)->Result<PathBuf,String>{
    let explicit=configured(override_path);
    let selected=peek(root,data,explicit.clone())?;
    let selected=prepare(&selected)?;
    if explicit.is_some(){return Ok(selected);}
    if let Some(existing)=saved(data)?{return prepare(&existing);}
    fs::create_dir_all(data).map_err(|e|e.to_string())?;
    let temp=data.join(format!(".component-location-{}.part",uuid::Uuid::new_v4()));
    let path_text=selected.to_str().ok_or("Component location cannot be represented as Unicode")?;
    let bytes=serde_json::to_vec(&json!({"schemaVersion":1,"path":path_text})).map_err(|e|e.to_string())?;
    let mut file=fs::OpenOptions::new().write(true).create_new(true).open(&temp).map_err(|e|e.to_string())?;
    let complete=file.write_all(&bytes).and_then(|_|file.sync_all());drop(file);
    let publish=complete.and_then(|_|fs::hard_link(&temp,data.join(RECORD)));
    // Only this call's unique unpublished name; never remove an existing record/model.
    let _=fs::remove_file(&temp);
    match publish {
        Ok(())=>Ok(selected),
        Err(e)if e.kind()==std::io::ErrorKind::AlreadyExists=>prepare(&saved(data)?.ok_or("Component location winner disappeared; retry after restart")?),
        Err(e)=>Err(format!("无法安全固定组件目录，未替换旧记录 / Cannot publish component location safely: {e}")),
    }
}
pub struct RootState(OnceLock<Result<PathBuf,String>>);
impl RootState{
    pub const fn new()->Self{Self(OnceLock::new())}
    pub fn initialize(&self,root:&Path,data:&Path,config:Option<PathBuf>)->Result<PathBuf,String>{self.0.get_or_init(||initialize(root,data,config)).clone()}
    pub fn get(&self)->Result<PathBuf,String>{self.0.get().cloned().unwrap_or_else(||Err("组件目录尚未初始化 / Component location is not initialized".into()))}
}
#[cfg(test)]mod tests{
 use super::*;
 fn fixture(name:&str)->(PathBuf,PathBuf){let p=PathBuf::from(std::env::var_os("FURINAKIT_ROOT_TEST_DIR").expect("explicit synthetic fixture directory required")).join(name);fs::create_dir(&p).expect("exclusive fixture; do not reuse");(p.join("app"),p.join("profile"))}
 fn put(p:&Path,b:&[u8]){fs::create_dir_all(p.parent().unwrap()).unwrap();fs::write(p,b).unwrap();}
 #[test]fn inspection_has_no_side_effects(){let(r,d)=fixture("readonly");assert_eq!(peek(&r,&d,None).unwrap(),d.join("components"));assert!(!d.exists());assert!(!r.exists());}
 #[test]fn blank_override_is_absent(){let(r,d)=fixture("blank");for p in [""," ","\t"]{assert_eq!(peek(&r,&d,Some(p.into())).unwrap(),d.join("components"));}assert!(!d.exists());}
 #[test]fn shared_choice_survives_last_onnx_removal_and_restart(){let(r,d)=fixture("shared");let f=r.join("apps/web/components/test.onnx");put(&f,b"synthetic");let first=initialize(&r,&d,None).unwrap();let record=fs::read(d.join(RECORD)).unwrap();fs::rename(&f,f.with_extension("invalid")).unwrap();assert_eq!(peek(&r,&d,None).unwrap(),first);assert_eq!(initialize(&r,&d,None).unwrap(),first);assert_eq!(fs::read(d.join(RECORD)).unwrap(),record);assert!(!d.join("components").exists());}
 #[test]fn new_shared_model_does_not_redirect_existing_profile(){let(r,d)=fixture("profile");let first=initialize(&r,&d,None).unwrap();put(&r.join("apps/web/components/new.onnx"),b"not executable");assert_eq!(initialize(&r,&d,None).unwrap(),first);}
 #[test]fn override_does_not_replace_saved_default(){let(r,d)=fixture("override");let first=initialize(&r,&d,None).unwrap();let bytes=fs::read(d.join(RECORD)).unwrap();let custom=d.join("explicit");assert_eq!(initialize(&r,&d,Some(custom.clone())).unwrap(),fs::canonicalize(custom).unwrap());assert_eq!(fs::read(d.join(RECORD)).unwrap(),bytes);assert_eq!(initialize(&r,&d,None).unwrap(),first);}
 #[test]fn relative_override_fails_without_writes(){let(r,d)=fixture("relative");assert!(initialize(&r,&d,Some("models".into())).is_err());assert!(!d.exists());}
 #[test]fn corrupt_record_preserved_and_explicit_override_can_recover(){let(r,d)=fixture("corrupt");put(&d.join(RECORD),b"{broken");assert!(peek(&r,&d,None).is_err());assert!(initialize(&r,&d,None).is_err());assert!(!d.join("components").exists());assert!(initialize(&r,&d,Some(d.join("recovery"))).is_ok());assert_eq!(fs::read(d.join(RECORD)).unwrap(),b"{broken");}
 #[test]fn invalid_record_variants_fail_closed(){let(r,d)=fixture("invalid");for(i,b)in [b"{}".to_vec(),br#"{"schemaVersion":2,"path":"anything"}"#.to_vec(),br#"{"schemaVersion":1,"path":"relative"}"#.to_vec(),vec![b' ';MAX_RECORD as usize+1]].into_iter().enumerate(){let data=d.join(i.to_string());put(&data.join(RECORD),&b);assert!(initialize(&r,&data,None).is_err());assert_eq!(fs::read(data.join(RECORD)).unwrap(),b);}let data=d.join("directory");fs::create_dir_all(data.join(RECORD)).unwrap();assert!(initialize(&r,&data,None).is_err());}
 #[test]fn occupied_selected_path_is_not_deleted(){let(r,d)=fixture("occupied");let path=d.join("occupied-file");put(&path,b"preserve");put(&d.join(RECORD),serde_json::to_string(&json!({"schemaVersion":1,"path":path})).unwrap().as_bytes());assert!(initialize(&r,&d,None).is_err());assert_eq!(fs::read(path).unwrap(),b"preserve");}
 #[test]fn simultaneous_initialization_keeps_complete_first_record(){let(r,d)=fixture("concurrent");let barrier=std::sync::Barrier::new(12);std::thread::scope(|scope|{let hs:Vec<_>=(0..12).map(|_|scope.spawn(||{barrier.wait();initialize(&r,&d,None)})).collect();let expected=hs.into_iter().map(|h|h.join().unwrap().unwrap()).collect::<Vec<_>>();assert!(expected.iter().all(|p|p==&expected[0]));});assert!(saved(&d).unwrap().is_some());assert_eq!(fs::read_dir(&d).unwrap().count(),2);}
 #[test]fn process_pin_does_not_follow_new_override_or_marker(){let(r,d)=fixture("pin");let state=RootState::new();assert!(state.get().is_err());let first=state.initialize(&r,&d,None).unwrap();assert_eq!(state.initialize(&r,&d,Some(d.join("other"))).unwrap(),first);fs::write(d.join(RECORD),b"broken after pin").unwrap();assert_eq!(state.get().unwrap(),first);assert!(RootState::new().initialize(&r,&d,None).is_err());}
 #[test]fn initialization_error_stays_visible_without_fallback(){let(r,d)=fixture("error-pin");let state=RootState::new();assert!(state.initialize(&r,&d,Some("relative".into())).is_err());assert!(state.initialize(&r,&d,Some(d.join("other"))).is_err());assert!(state.get().is_err());assert!(!d.exists());}
 #[test]fn unrelated_settings_history_and_models_preserved(){let(r,d)=fixture("preserved");for p in ["settings.json","storage/jobs/synthetic.json","components/keep.bin"]{put(&d.join(p),b"synthetic preserved data");}initialize(&r,&d,None).unwrap();for p in ["settings.json","storage/jobs/synthetic.json","components/keep.bin"]{assert_eq!(fs::read(d.join(p)).unwrap(),b"synthetic preserved data");}}
}
