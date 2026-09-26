//! Read-only TTS inventory. No Python, process launch, network, directory creation or model loading.
use std::{fs,path::{Path,PathBuf},io::Read};
use serde_json::{json,Value};
const SPECS:&str=include_str!("../tts-component-catalog.json");
const MAX_RECEIPT:u64=8*1024*1024;
fn safe(path:&Path)->Result<(),String>{
 if !path.is_absolute(){return Err("Absolute component root required".into());}
 for p in path.ancestors(){match fs::symlink_metadata(p){
  Ok(m)=>{
   #[cfg(windows)]{use std::os::windows::fs::MetadataExt;if m.file_attributes()&0x400!=0{return Err("Linked component paths are not allowed".into());}}
   if m.file_type().is_symlink()||!(m.is_dir()||m.is_file()){return Err("Unsafe component path type".into());}
  },Err(e) if e.kind()==std::io::ErrorKind::NotFound=>{},Err(e)=>return Err(e.to_string())
 }}Ok(())
}
fn relative(path:&str)->Result<PathBuf,String>{
 if path.is_empty()||path.contains(['\\',':'])||path.chars().any(|c|c.is_control()){return Err("Unsafe receipt path".into());}
 for part in path.split('/'){
  let stem=part.split('.').next().unwrap_or("").to_ascii_lowercase();
  if part.is_empty()||matches!(part,"."|"..")||part.ends_with(['.',' '])||matches!(stem.as_str(),"con"|"prn"|"aux"|"nul")||((stem.starts_with("com")||stem.starts_with("lpt"))&&stem.len()==4&&matches!(stem.as_bytes()[3],b'1'..=b'9')){return Err("Unsafe receipt path".into());}
 }Ok(PathBuf::from(path))
}
fn files(root:&Path,result:&mut Vec<PathBuf>,depth:usize,count:&mut usize)->Result<(),String>{
 if depth>64{return Err("Component directory depth limit exceeded".into());}
 for entry in fs::read_dir(root).map_err(|e|e.to_string())?{
  let p=entry.map_err(|e|e.to_string())?.path();safe(&p)?;
  let m=fs::symlink_metadata(&p).map_err(|e|e.to_string())?;
  *count+=1;
  if *count>100_000{return Err("Component inventory limit exceeded".into());}
  if m.is_dir(){files(&p,result,depth+1,count)?;}else if p.file_name().and_then(|s|s.to_str())!=Some("receipt.json"){result.push(p);}
 }Ok(())
}
fn layout(folder:&Path,family:&str)->Result<(),String>{
 let mut paths=vec![];files(folder,&mut paths,0,&mut 0)?;
 let one=|name:&str|->Result<(),String>{if paths.iter().filter(|p|p.file_name().and_then(|s|s.to_str())==Some(name)).count()==1{Ok(())}else{Err(format!("Missing or ambiguous component file: {name}"))}};
 if family=="runtime"{return one("sherpa-onnx-c-api.dll");}
 let models:Vec<_>=paths.iter().filter(|p|p.extension().and_then(|s|s.to_str())==Some("onnx")).collect();
 let quantized=models.iter().filter(|p|p.file_name().unwrap().to_string_lossy().contains("int8")).count();
 if (if quantized>0{quantized}else{models.len()})!=1{return Err("Cannot locate unique model".into());}
 one("tokens.txt")?;one("phontab")?;
 if family=="kokoro"{for name in ["voices.bin","lexicon-zh.txt","lexicon-us-en.txt"]{one(name)?;}}
 Ok(())
}
fn installed(root:&Path,id:&str,spec:&Value)->Result<Option<u64>,String>{
 let folder=root.join(id);safe(&folder)?;let receipt=folder.join("receipt.json");safe(&receipt)?;
 let meta=match fs::metadata(&receipt){Ok(m)=>m,Err(e) if e.kind()==std::io::ErrorKind::NotFound=>return Ok(None),Err(e)=>return Err(e.to_string())};
 if !meta.is_file()||meta.len()>MAX_RECEIPT{return Ok(None);}
 let mut bytes=vec![];fs::File::open(&receipt).map_err(|e|e.to_string())?.take(MAX_RECEIPT+1).read_to_end(&mut bytes).map_err(|e|e.to_string())?;
 if bytes.len() as u64>MAX_RECEIPT{return Ok(None);}
 let data:Value=match serde_json::from_slice(&bytes){Ok(v)=>v,Err(_)=>return Ok(None)};
 if data.get("id").and_then(Value::as_str)!=Some(id)||data.get("archiveSha256")!=spec.get("sha256"){return Ok(None);}
 let Some(entries)=data.get("files").and_then(Value::as_array).filter(|a|!a.is_empty())else{return Ok(None);};
 let mut sum=0u64;let mut seen=std::collections::HashSet::new();
 for e in entries{
  let Some(rel)=e.get("path").and_then(Value::as_str)else{return Ok(None);};
  if !seen.insert(rel){return Ok(None);}
  let p=folder.join(relative(rel)?);safe(&p)?;
  let Some(size)=e.get("size").and_then(Value::as_u64)else{return Ok(None);};
  let m=match fs::metadata(p){Ok(v)=>v,Err(_)=>return Ok(None)};
  if !m.is_file()||m.len()!=size{return Ok(None);}
  sum=sum.checked_add(size).ok_or("Inventory byte overflow")?;
 }
 layout(&folder,spec["family"].as_str().ok_or("Invalid compiled family")?)?;Ok(Some(sum))
}
pub fn catalog(base:&Path)->Result<Value,String>{
 let root=base.join("tts-v66");safe(&root)?;
 let specs:Value=serde_json::from_str(SPECS).map_err(|e|e.to_string())?;
 let specs=specs.as_object().ok_or("Invalid compiled TTS catalog")?;let mut rows=vec![];
 for id in ["tts-sherpa-runtime","tts-kokoro-zh-en","tts-piper-ljspeech","tts-piper-ryan"]{
  let mut row=specs.get(id).ok_or("Missing compiled TTS component")?.clone();
  let (bytes,error)=match installed(&root,id,&row){Ok(v)=>(v,String::new()),Err(e)=>(None,e)};
  row["id"]=json!(id);row["downloaded"]=json!(bytes.is_some());row["installedBytes"]=json!(bytes.unwrap_or(0));row["error"]=json!(error);rows.push(row);
 }
 let mut progress=json!({});let p=root.join("progress.json");
 if safe(&p).is_ok() {
  if let Ok(m)=fs::metadata(&p) {
   if m.is_file()&&m.len()<16384 {
    if let Ok(f)=fs::File::open(&p) {
     let mut b=vec![];
     if f.take(16384).read_to_end(&mut b).is_ok()&&b.len()<16384 {
      if let Ok(v)=serde_json::from_slice::<Value>(&b) {if v.is_object(){progress=v;}}
     }
    }
   }
  }
 }
 Ok(json!({"ok":true,"components":rows,"progress":progress}))
}
#[cfg(test)]mod tests{
 use super::*;
 fn root()->PathBuf{let p=PathBuf::from(std::env::var_os("FK_G47_ROOT").expect("owned fixture root")).join(uuid::Uuid::new_v4().simple().to_string());fs::create_dir(&p).unwrap();p}
 fn write_runtime(p:&Path)->PathBuf{let f=p.join("tts-v66").join("tts-sherpa-runtime");fs::create_dir_all(&f).unwrap();fs::write(f.join("sherpa-onnx-c-api.dll"),b"fixture").unwrap();let s:Value=serde_json::from_str(SPECS).unwrap();fs::write(f.join("receipt.json"),serde_json::to_vec(&json!({"id":"tts-sherpa-runtime","archiveSha256":s["tts-sherpa-runtime"]["sha256"],"files":[{"path":"sherpa-onnx-c-api.dll","size":7,"sha256":"not-a-deep-hash"}]})).unwrap()).unwrap();f}
 #[test]fn empty_catalog_needs_no_worker_and_creates_nothing(){let p=root();let v=catalog(&p).unwrap();assert_eq!(v["components"].as_array().unwrap().len(),4);assert!(v["components"].as_array().unwrap().iter().all(|v|v["downloaded"]==false));assert_eq!(fs::read_dir(p).unwrap().count(),0);}
 #[test]fn metadata_preserves_noncommercial_warning_and_pins(){let v=catalog(&root()).unwrap();let rows=v["components"].as_array().unwrap();assert!(rows[3]["licenseNoteEn"].as_str().unwrap().contains("non-commercial"));assert_eq!(rows[0]["size"],24805859u64);assert_eq!(rows[1]["speakers"],103);assert!(rows.iter().all(|r|r["sha256"].as_str().unwrap().len()==64));}
 #[test]fn matching_runtime_receipt_is_size_inventory_not_deep_integrity(){let p=root();write_runtime(&p);let v=catalog(&p).unwrap();assert_eq!(v["components"][0]["downloaded"],true);assert_eq!(v["components"][0]["installedBytes"],7);}
 #[test]fn missing_and_wrong_sized_files_are_not_ready(){let p=root();let f=write_runtime(&p);fs::write(f.join("sherpa-onnx-c-api.dll"),b"short").unwrap();assert_eq!(catalog(&p).unwrap()["components"][0]["downloaded"],false);}
 #[test]fn forged_layout_is_not_trusted(){let p=root();let f=write_runtime(&p);fs::rename(f.join("sherpa-onnx-c-api.dll"),f.join("other.dll")).unwrap();let mut d:Value=serde_json::from_slice(&fs::read(f.join("receipt.json")).unwrap()).unwrap();d["files"][0]["path"]=json!("other.dll");d["layout"]=json!({"dll":"other.dll"});fs::write(f.join("receipt.json"),serde_json::to_vec(&d).unwrap()).unwrap();assert_eq!(catalog(&p).unwrap()["components"][0]["downloaded"],false);}
 #[test]fn receipt_traversal_and_reserved_paths_rejected(){for s in ["../outside","/root","a\\b","C:/outside","a//b","CON.txt","a/../b","a.","a ","nul"]{assert!(relative(s).is_err(),"{s}");}assert!(relative("目录/模型.onnx").is_ok());}
 #[test]fn invalid_receipt_and_wrong_pin_are_not_ready(){let p=root();let f=write_runtime(&p);fs::write(f.join("receipt.json"),b"bad json").unwrap();assert_eq!(catalog(&p).unwrap()["components"][0]["downloaded"],false);let f=write_runtime(&p);let mut d:Value=serde_json::from_slice(&fs::read(f.join("receipt.json")).unwrap()).unwrap();d["archiveSha256"]=json!("wrong");fs::write(f.join("receipt.json"),serde_json::to_vec(&d).unwrap()).unwrap();assert_eq!(catalog(&p).unwrap()["components"][0]["downloaded"],false);}
 #[test]fn progress_is_bounded_and_object_only(){let p=root();fs::create_dir(p.join("tts-v66")).unwrap();fs::write(p.join("tts-v66/progress.json"),b"[]").unwrap();assert_eq!(catalog(&p).unwrap()["progress"],json!({}));fs::write(p.join("tts-v66/progress.json"),b"{\"status\":\"downloading\"}").unwrap();assert_eq!(catalog(&p).unwrap()["progress"]["status"],"downloading");}
 #[test]fn models_require_real_layout_not_receipt_paths(){for id in ["tts-piper-ljspeech","tts-kokoro-zh-en"]{let p=root();let f=p.join("tts-v66").join(id);fs::create_dir_all(&f).unwrap();let mut names=vec!["model.int8.onnx","tokens.txt","phontab"];if id.contains("kokoro"){names.extend(["voices.bin","lexicon-zh.txt","lexicon-us-en.txt"]);}let mut entries=vec![];for n in names{fs::write(f.join(n),b"abc").unwrap();entries.push(json!({"path":n,"size":3,"sha256":"fixture"}));}let specs:Value=serde_json::from_str(SPECS).unwrap();fs::write(f.join("receipt.json"),serde_json::to_vec(&json!({"id":id,"archiveSha256":specs[id]["sha256"],"files":entries})).unwrap()).unwrap();let v=catalog(&p).unwrap();assert!(v["components"].as_array().unwrap().iter().any(|r|r["id"]==id&&r["downloaded"]==true));fs::remove_file(f.join("phontab")).unwrap();assert!(catalog(&p).unwrap()["components"].as_array().unwrap().iter().any(|r|r["id"]==id&&r["downloaded"]==false));}}
 #[test]fn excessive_depth_refused_before_directory_read(){assert!(files(Path::new("nonexistent"),&mut vec![],65,&mut 0).is_err());}
 #[cfg(windows)]#[test]fn linked_component_folder_is_not_ready(){use std::os::windows::process::CommandExt;let p=root();let f=write_runtime(&p);let target=p.join("retained-target");fs::rename(&f,&target).unwrap();let out=std::process::Command::new("cmd.exe").args(["/D","/C","mklink","/J"]).arg(&f).arg(&target).creation_flags(0x08000000).output().unwrap();assert!(out.status.success(),"{}",String::from_utf8_lossy(&out.stderr));let v=catalog(&p).unwrap();assert_eq!(v["components"][0]["downloaded"],false);assert!(!v["components"][0]["error"].as_str().unwrap().is_empty());}
 #[test]#[ignore="Owned fixture differential output only"]fn export_catalog_comparison(){use std::io::Write;let base=PathBuf::from(std::env::var_os("FK_G47_ROOT").unwrap());let mut rows=vec![];for entry in fs::read_dir(base).unwrap(){let p=entry.unwrap().path();if p.is_dir(){rows.push(json!({"root":p,"catalog":catalog(&p).unwrap()}));}}let output=PathBuf::from(std::env::var_os("FK_G47_COMPARE_OUTPUT").unwrap());let mut f=fs::OpenOptions::new().write(true).create_new(true).open(output).unwrap();f.write_all(&serde_json::to_vec(&rows).unwrap()).unwrap();}

}
