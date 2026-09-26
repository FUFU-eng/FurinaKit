//! Fixed bundled NCNN 2x/3x policy. Never downloads, searches PATH, or starts Python.
use std::{path::{Path,PathBuf},fs::File,io::{Read,Seek,SeekFrom},time::{Duration,Instant}};
use serde_json::{Value,json};
use sha2::{Sha256,Digest};
pub const MANIFEST:&str=include_str!("../upscale-lite-manifest.json");
pub fn scale(args:&Value)->Result<u32,String>{
 let n=match args.get("model").and_then(Value::as_str).unwrap_or("anime-x2"){"anime-x2"=>2,"anime-x3"=>3,_=>return Err("仅支持内置动漫2倍和3倍，请重新选择模型 / Only anime-x2 and anime-x3 are supported".into())};
 if let Some(v)=args.get("scale") {if v.as_u64().or_else(||v.as_str().and_then(|s|s.parse().ok()))!=Some(n as u64){return Err("模型与倍率不匹配 / Model and scale mismatch".into());}}
 Ok(n)
}
pub struct Assets{pub root:PathBuf,_files:Vec<File>}
#[cfg(windows)]
fn ncnn_path(path:&Path)->Result<String,String>{
 let raw=path.to_str().ok_or("NCNN path is not valid Unicode")?;
 if let Some(rest)=raw.strip_prefix(r"\\?\UNC\"){Ok(format!(r"\\{rest}"))}
 else if let Some(rest)=raw.strip_prefix(r"\\?\"){Ok(rest.to_owned())}
 else{Ok(raw.to_owned())}
}
#[cfg(windows)]
fn ordinary(p:&Path,dir:bool)->Result<(),String>{
 use std::os::windows::fs::MetadataExt;
 let m=std::fs::symlink_metadata(p).map_err(|e|format!("内置超分资源缺失，请修复安装 / Missing bundled upscale resource: {e}"))?;
 if m.file_attributes()&0x400!=0||if dir{!m.is_dir()}else{!m.is_file()}{return Err("Linked/nonordinary upscale resource rejected".into());}Ok(())
}
#[cfg(windows)]
pub fn acquire(app_root:&Path,check:&dyn Fn()->Result<(),String>)->Result<Assets,String>{
 use std::os::windows::fs::OpenOptionsExt;
 let root=app_root.join("tools/engines/upscale-lite");
 if !root.is_absolute(){return Err("Absolute bundled root required".into());}
 for p in root.ancestors(){ordinary(p,true)?;}ordinary(&root.join("models"),true)?;
 let spec:Value=serde_json::from_str(MANIFEST).map_err(|e|e.to_string())?;let mut files=Vec::new();
 for item in spec["files"].as_array().ok_or("Invalid compiled upscale manifest")?{
  check()?;let path=root.join(item["path"].as_str().ok_or("Missing compiled path")?);ordinary(&path,false)?;
  let mut f=File::options().read(true).share_mode(1).custom_flags(0x00200000).open(&path).map_err(|e|e.to_string())?;
  if f.metadata().map_err(|e|e.to_string())?.len()!=item["bytes"].as_u64().ok_or("Missing size")?{return Err("Bundled upscale size mismatch; repair installation".into());}
  let mut hash=Sha256::new();let mut b=[0u8;65536];loop{check()?;let n=f.read(&mut b).map_err(|e|e.to_string())?;if n==0{break;}hash.update(&b[..n]);}
  if Some(format!("{:x}",hash.finalize()).as_str())!=item["sha256"].as_str(){return Err("Bundled upscale SHA-256 mismatch; repair installation".into());}
  f.seek(SeekFrom::Start(0)).map_err(|e|e.to_string())?;files.push(f);
 }
 Ok(Assets{root:std::fs::canonicalize(root).map_err(|e|e.to_string())?,_files:files})
}
#[cfg(windows)]
pub fn process(assets:&Assets,worker:&Path,input:&Path,output:&Path,scale:u32,work:&Path,check:&dyn Fn()->Result<(),String>,scope:&crate::task_custody::Scope)->Result<Value,String>{
 if !matches!(scale,2|3){return Err("Unsupported upscale factor".into());}check()?;
 let rgb=work.join("rgb.png");let rendered=work.join("rendered.png");
 let prepared=crate::image_process::execute(worker,&json!({"protocol":1,"tool":"upscale-prepare","args":{"scale":scale},"input":input,"output":rgb}),check)?;
 let args=vec!["-i".into(),ncnn_path(&rgb)?,"-o".into(),ncnn_path(&rendered)?,"-n".into(),"realesr-animevideov3".into(),"-s".into(),scale.to_string(),"-t".into(),"128".into(),"-m".into(),ncnn_path(&assets.root.join("models"))?];
 check()?;
 let process=scope.own(crate::download_process::OwnedProcess::spawn_bounded(&assets.root.join("realesrgan-ncnn-vulkan.exe"),&args,&assets.root,1024*1024*1024)?);
 let started=Instant::now();let outcome=(||loop{
  check()?;if started.elapsed()>Duration::from_secs(300){return Err("超分超时 / Upscale timed out".into());}
  if let Some(code)=process.try_exit()?{return if code==0{Ok(())}else{Err(format!("超分引擎退出码 {code}，请检查 Vulkan 显卡驱动 / Check Vulkan graphics driver"))};}
  std::thread::sleep(Duration::from_millis(30));
 })();
 process.after_exit(outcome)??;drop(process);check()?;
 let mut info=crate::image_process::execute(worker,&json!({"protocol":1,"tool":"upscale-finish","args":{"scale":scale},"input":rendered,"output":output}),check)?;
 info["warning"]=prepared["warning"].clone();info["engine"]=json!("bundled-ncnn-native");Ok(info)
}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn accepts_only_matching_lite_models(){for(n,m)in[(2,"anime-x2"),(3,"anime-x3")]{assert_eq!(scale(&json!({"model":m,"scale":n})).unwrap(),n);assert_eq!(scale(&json!({"model":m,"scale":n.to_string()})).unwrap(),n);}}
 #[test]fn removed_models_and_mismatches_rejected(){for m in["anime-x4","real-x4","realesrgan-x4plus-anime","../../engine"]{assert!(scale(&json!({"model":m})).is_err());}for n in[0,1,3,4]{assert!(scale(&json!({"model":"anime-x2","scale":n})).is_err());}}
 #[test]fn exact_five_file_policy(){let v:Value=serde_json::from_str(MANIFEST).unwrap();let f=v["files"].as_array().unwrap();assert_eq!(f.len(),5);assert_eq!(f.iter().map(|f|f["bytes"].as_u64().unwrap()).sum::<u64>(),8662490);assert!(!MANIFEST.contains("x4"));}
 #[test]fn ncnn_paths_remove_windows_verbatim_prefix(){assert_eq!(ncnn_path(Path::new(r"\\?\E:\models")),Ok(r"E:\models".into()));assert_eq!(ncnn_path(Path::new(r"\\?\UNC\server\share\models")),Ok(r"\\server\share\models".into()));assert_eq!(ncnn_path(Path::new(r"E:\plain")),Ok(r"E:\plain".into()));}
}
