//! Compatibility preflight, NOT authenticity verification or proof of live worker readiness.
//! Never execute an unknown/frozen worker to ask whether it understands a new CLI flag.
use std::{fs,io::Read,path::Path};
use sha2::{Digest,Sha256};
const ENTRY:(&str,&str)=("worker.py","17deefb720f24994ea401d811e1992895229858f6a1a2f8b921b3b06cb8039a5");
const TASKS:(&str,&str)=("app/tasks.py","960b8e21a744afa7e26c7ad0a7ef909a340500bb319358f9efed5e9b417e4c14");
const LEASES:(&str,&str)=("app/component_leases.py","28100291db21e1526985747ad41b1bac44461eb8a06f5f102bb0209fbe31f602");
const TTS:(&str,&str)=("app/tools/tts_components.py","b19bd2f87455172f79e93be69d565383774856d850f3406a983db0c1b502bf3e");
const READY:(&str,&str)=("app/worker_ready.py","442c28d07bb2a071c37b9ef0b5f139d053ba525719856ad212fd070f0ea2e13c");
const OWNED:(&str,&str)=("app/owned_process.py","e476f6a2630ff6db3b71729b038ddb2237825c4cf284732d5395be6037c611c9");
const CUSTODY:(&str,&str)=("app/task_processes.py","0205cd0253ccafef7e626b95fdee952e32917aa580e11ccfc72a0c7af478c550");
fn verify(worker:&Path,specs:&[(&str,&str)])->Result<(),String>{
 for (name,want) in specs {
  let check=(||->Result<(),String>{
   let path=worker.join(name);let meta=fs::symlink_metadata(&path).map_err(|e|e.to_string())?;
   #[cfg(windows)] {use std::os::windows::fs::MetadataExt;if meta.file_attributes()&0x400!=0{return Err("Reparse-point source".into());}}
   if !meta.is_file()||meta.file_type().is_symlink()||meta.len()>2*1024*1024{return Err("Invalid protocol source".into());}
   let mut data=Vec::new();fs::File::open(path).map_err(|e|e.to_string())?.take(2*1024*1024+1).read_to_end(&mut data).map_err(|e|e.to_string())?;
   if data.len()>2*1024*1024||format!("{:x}",Sha256::digest(&data))!=*want{return Err("Protocol source fingerprint differs".into());}
   Ok(())
  })();
  if check.is_err(){return Err(format!("处理扩展版本不兼容（{name}）；未启动引擎、未提交任务，已有文件保留。请安装兼容本版本的处理扩展。 / Incompatible processing extension ({name}); engine not started and no task queued. Existing files retained. Install a compatible extension."));}
 }
 Ok(())
}
pub(crate) fn upscale(worker:&Path)->Result<(),String>{verify(worker,&[
 ("app/tools/image_upscale.py","5e9c84cd750c46172c764955c54a571d03365a06eaf133e513f4e741c4c2ad10"),
 ("app/tools/upscale_component.py","7dfeae980e55fd668691d70feca5a093216116eadfe0c8d761fa7fd87e6ecc74")])}
pub(crate) fn queue(worker:&Path)->Result<(),String>{verify(worker,&[ENTRY,TASKS,LEASES,READY,OWNED,CUSTODY])}
pub(crate) fn tts_control(worker:&Path)->Result<(),String>{verify(worker,&[ENTRY,TTS])}
#[cfg(test)] mod tests{
 use super::*;
 fn fixture(name:&str)->std::path::PathBuf{let root=std::path::PathBuf::from(std::env::var_os("FK_PROTOCOL_TEST_ROOT").unwrap()).join(name);fs::create_dir(&root).unwrap();root}
 fn seed(root:&Path){
  let source=std::path::PathBuf::from(std::env::var_os("FK_PROTOCOL_SOURCE").unwrap());
  for(name,_)in[ENTRY,TASKS,LEASES,TTS,READY,OWNED,CUSTODY]{let p=root.join(name);fs::create_dir_all(p.parent().unwrap()).unwrap();fs::copy(source.join(name),p).unwrap();}
 }
 #[test]fn current_source_matches_reviewed_protocol(){let r=fixture("current");seed(&r);queue(&r).unwrap();tts_control(&r).unwrap();}
 #[test]fn frozen_only_is_rejected_without_launch(){let r=fixture("frozen");fs::write(r.join("furinakit-worker.exe"),b"synthetic non executable").unwrap();assert!(queue(&r).is_err());assert!(tts_control(&r).is_err());assert_eq!(fs::read_dir(r).unwrap().count(),1);}
 #[test]fn old_or_altered_entry_cannot_receive_control_flag(){let r=fixture("old");seed(&r);fs::write(r.join("worker.py"),b"# old entry without isolated CLI").unwrap();assert!(queue(&r).is_err());assert!(tts_control(&r).is_err());}
 #[test]fn missing_or_changed_lease_cannot_silently_degrade(){let r=fixture("lease");seed(&r);fs::remove_file(r.join(LEASES.0)).unwrap();assert!(queue(&r).is_err());fs::write(r.join(LEASES.0),b"# no lease").unwrap();assert!(queue(&r).is_err());}
 #[test]fn missing_task_wrapper_is_incompatible(){let r=fixture("tasks");seed(&r);fs::write(r.join(TASKS.0),b"# old dispatcher").unwrap();assert!(queue(&r).is_err());}
 #[test]fn readiness_publisher_is_required_only_for_queue(){let r=fixture("ready-source");seed(&r);fs::remove_file(r.join(READY.0)).unwrap();assert!(queue(&r).is_err());tts_control(&r).unwrap();fs::write(r.join(READY.0),b"# wrong publisher").unwrap();assert!(queue(&r).is_err());}
 #[test]fn control_and_queue_contracts_are_separate(){let r=fixture("control");seed(&r);fs::write(r.join(TTS.0),b"# old control").unwrap();assert!(tts_control(&r).is_err());queue(&r).unwrap();}
 #[test]fn incompatible_sources_and_models_are_not_rewritten(){let r=fixture("preserve");seed(&r);fs::write(r.join("model.onnx"),b"synthetic model").unwrap();fs::write(r.join(ENTRY.0),b"old").unwrap();assert!(queue(&r).is_err());assert_eq!(fs::read(r.join(ENTRY.0)).unwrap(),b"old");assert_eq!(fs::read(r.join("model.onnx")).unwrap(),b"synthetic model");}
 #[test]fn task_custody_sources_are_required_only_for_queue(){
  for spec in [OWNED,CUSTODY]{let r=fixture(if spec.0==OWNED.0{"owned-source"}else{"custody-source"});seed(&r);fs::remove_file(r.join(spec.0)).unwrap();assert!(queue(&r).is_err());tts_control(&r).unwrap();fs::write(r.join(spec.0),b"# old custody").unwrap();assert!(queue(&r).is_err());}
 }
 #[test]fn oversized_source_is_rejected(){let r=fixture("large");seed(&r);fs::File::create(r.join(ENTRY.0)).unwrap().set_len(2*1024*1024+1).unwrap();assert!(queue(&r).is_err());}
}
