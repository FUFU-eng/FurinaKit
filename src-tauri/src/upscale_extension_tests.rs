use super::*;
use std::{fs,sync::atomic::AtomicBool};
use sha2::{Digest,Sha256};
fn root(name:&str)->PathBuf{let p=PathBuf::from(std::env::var_os("FK_G52_ROOT").unwrap()).join(name);fs::create_dir(&p).unwrap();p}
fn source()->PathBuf{PathBuf::from(std::env::var_os("FK_PROTOCOL_SOURCE").unwrap())}
#[test]fn disabled_never_reads_missing_roots(){assert!(select_mode(Path::new("missing"),Path::new("missing"),false).unwrap().is_none());}
#[test]fn compiled_tree_pin_matches_and_is_upscale(){assert_eq!(format!("{:x}",Sha256::digest(TREE)),TREE_PIN);let m:crate::component_store::Manifest=serde_json::from_slice(TREE).unwrap();assert_eq!(m.component,"upscale-ncnn");assert_eq!(m.files.len(),283);}
#[test]fn stores_cannot_be_opened_as_the_other_component(){let p=root("owner");let u=p.join("u");Store::create_kind(&u,Kind::Upscale).unwrap();assert!(Store::open(&u).is_err());let w=p.join("w");Store::create(&w).unwrap();assert!(Store::open_kind(&w,Kind::Upscale).is_err());}
#[test]fn upscale_manifest_cannot_enter_worker_store(){let p=root("wrong-manifest");let s=Store::create(&p.join("store")).unwrap();assert!(s.begin_import(TREE,TREE_PIN).is_err());assert_eq!(fs::read_dir(p.join("store/staging")).unwrap().count(),0);}
#[test]fn pre_cancel_creates_nothing(){let p=root("cancel");assert!(install_local(&p,&p.join("missing.zip"),&AtomicBool::new(true)).is_err());assert_eq!(fs::read_dir(p).unwrap().count(),0);}
#[test]fn old_worker_is_rejected_before_component_selection(){let p=root("old-worker");assert!(select_mode(&p,&p,true).err().unwrap().contains("Incompatible"));assert_eq!(fs::read_dir(p).unwrap().count(),0);}
#[test]fn current_worker_protocol_admitted(){crate::worker_protocol::upscale(&source()).unwrap();}
#[test]fn default_configuration_removes_unmanaged_override(){let mut cmd=Command::new("never-executed");cmd.env("FURINAKIT_EXPERIMENTAL_UPSCALE_ROOT","untrusted").env("FURINAKIT_EXPERIMENTAL_UPSCALE","1");configure(&mut cmd,None).unwrap();let env:Vec<_>=cmd.get_envs().collect();assert!(env.iter().any(|(k,v)|*k=="FURINAKIT_EXPERIMENTAL_UPSCALE_ROOT"&&v.is_none()));assert!(env.iter().any(|(k,v)|*k=="FURINAKIT_EXPERIMENTAL_UPSCALE"&&v.is_none()));}
#[test]fn only_disk_verbatim_prefix_can_be_normalized(){assert_eq!(python_root(Path::new(r"\\?\E:\fixture")).unwrap(),PathBuf::from(r"E:\fixture"));for path in [r"\\?\UNC\host\share",r"\\.\device",r"relative",r"\\host\share"]{assert!(python_root(Path::new(path)).is_err());}}
#[test]fn typed_store_lifetime_and_rollback(){let p=root("lifetime");let s=Store::create_kind(&p.join("store"),Kind::Upscale).unwrap();let stage=s.staging_directory().unwrap();fs::write(stage.join("test"),b"synthetic").unwrap();let bytes=serde_json::to_vec(&serde_json::json!({"schema":1,"component":"upscale-ncnn","files":[{"path":"test","bytes":9,"sha256":format!("{:x}",Sha256::digest(b"synthetic"))}]})).unwrap();let pin=format!("{:x}",Sha256::digest(&bytes));s.install(&stage,&bytes,&pin).unwrap();let a=s.acquire(&bytes,&pin).unwrap();assert!(s.deactivate().is_err());drop(a);s.deactivate().unwrap();s.rollback(&bytes,&pin).unwrap();assert!(s.acquire(&bytes,&pin).is_ok());}
#[test]#[ignore="Explicit real G50 import and managed-resource inference in fresh isolated directory"]
fn real_import_and_inference(){
 let p=root("real");let archive=PathBuf::from(std::env::var_os("FK_G52_ARCHIVE").unwrap());
 let installed=install_local(&p,&archive,&AtomicBool::new(false)).unwrap();
 let active=select_mode(&p,&source(),true).unwrap().unwrap();assert_eq!(active.path,installed);
 let store=Store::open_kind(&p.join(DIRECTORY),Kind::Upscale).unwrap();assert!(store.deactivate().is_err());
 let py=PathBuf::from(std::env::var_os("FK_G52_PYTHON").unwrap());
 let script=r#"import sys,json
from pathlib import Path
sys.path.insert(0,sys.argv[1])
from PIL import Image
from app.tools.image_upscale import upscale_image
p=Path(sys.argv[2]); image=p/'managed-alpha.png'; Image.new('RGBA',(24,16),(32,64,128,127)).save(image)
out,_=upscale_image(str(image),'anime-x2',2)
with Image.open(out) as result:
 assert result.size==(48,32) and result.mode=='RGBA'
 assert result.getchannel('A').getextrema()==(127,127)
 (p/'inference.json').write_text(json.dumps({'passed':True,'dimensions':list(result.size),'alpha':127}),encoding='utf8')
"#;
 let mut cmd=Command::new(&py);cmd.args(["-B","-c",script]);cmd.arg(source()).arg(&p);configure(&mut cmd,Some(&active)).unwrap();
 let args:Vec<String>=cmd.get_args().map(|a|a.to_str().unwrap().to_owned()).collect();let env:Vec<_>=cmd.get_envs().map(|(k,v)|(k.to_owned(),v.map(|v|v.to_owned()))).collect();
 let owned=crate::download_process::OwnedProcess::spawn_with_environment(&py,&args,&p,&env).unwrap();
 let process=crate::resource_custody::Custody::new(owned,active);
 assert!(store.deactivate().is_err());let start=std::time::Instant::now();
 loop{if let Some(code)=process.try_exit().unwrap(){assert_eq!(code,0);break;}assert!(start.elapsed()<std::time::Duration::from_secs(120));std::thread::sleep(std::time::Duration::from_millis(25));}
 process.after_exit(Ok::<(),String>(())).unwrap().unwrap();assert!(store.deactivate().is_err());drop(process);
 let result:serde_json::Value=serde_json::from_slice(&fs::read(p.join("inference.json")).unwrap()).unwrap();assert_eq!(result["passed"],true);
 store.deactivate().unwrap();store.rollback(TREE,TREE_PIN).unwrap();drop(select_mode(&p,&source(),true).unwrap());
 assert!(install_local(&p,&archive,&AtomicBool::new(false)).is_err());
 println!("G52_NATIVE_IMPORT_SELECTION_INFERENCE_LIFETIME_ROLLBACK_PASS");
}
