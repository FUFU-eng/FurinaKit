//! Narrow test-profile startup restrictions, NOT a complete command/filesystem sandbox.
use std::{path::{Path,PathBuf,Component},sync::OnceLock};
#[derive(Clone,Copy,Debug,PartialEq,Eq)]
pub struct Policy{pub ancillary:bool,pub warm_worker:bool,pub automatic_reveal:bool,pub tray:bool,pub close_to_tray:bool}
impl Policy{pub fn for_isolated(isolated:bool)->Self{Self{ancillary:!isolated,warm_worker:!isolated,automatic_reveal:!isolated,tray:!isolated,close_to_tray:!isolated}}}
pub fn current()->Policy{Policy::for_isolated(crate::launch_identity::current().map(|i|i.isolated).unwrap_or(true))}
fn ordinary(path:&Path)->Result<std::fs::Metadata,String>{
 let m=std::fs::symlink_metadata(path).map_err(|e|format!("Cannot inspect isolated path {}: {e}",path.display()))?;
 #[cfg(windows)]{use std::os::windows::fs::MetadataExt;if m.file_attributes()&0x400!=0{return Err("Isolated path must not use reparse points".into());}}
 if m.file_type().is_symlink(){return Err("Isolated path must not use symbolic links".into());}Ok(m)
}
fn validate(root:Option<PathBuf>,identifier:&str,configured_components:Option<PathBuf>)->Result<PathBuf,String>{
 let root=root.ok_or("Test profile requires an explicit owned FURINAKIT_ROOT; daily fallback prohibited")?;
 if !root.is_absolute()||root.components().any(|c|matches!(c,Component::ParentDir|Component::CurDir)){return Err("Isolated root must be absolute and normalized".into());}
 if !ordinary(&root)?.is_dir(){return Err("Isolated root must be an existing directory".into());}
 for ancestor in root.ancestors(){ordinary(ancestor)?;}
 let marker=root.join(".furinakit-isolated-profile");let m=ordinary(&marker)?;
 if !m.is_file()||m.len()>128{return Err("Invalid isolated profile marker".into());}
 let expected=format!("{identifier}\n");if std::fs::read(&marker).map_err(|e|e.to_string())?!=expected.as_bytes(){return Err("Root marker does not match the isolated identity".into());}
 if let Some(p)=configured_components{if p!=root.join("components"){return Err("Test component override must stay at the owned root/components".into());}}
 for child in ["components","webview","profile"]{let p=root.join(child);if p.exists(){if !ordinary(&p)?.is_dir(){return Err("Isolated child location must be a directory".into());}}else if std::fs::symlink_metadata(&p).is_ok(){return Err("Isolated child location is an invalid link".into());}}
 std::fs::canonicalize(root).map_err(|e|e.to_string())
}
pub fn isolated_root()->Result<Option<&'static PathBuf>,String>{
 static ROOT:OnceLock<Result<Option<PathBuf>,String>>=OnceLock::new();
 ROOT.get_or_init(||{
  let identity=crate::launch_identity::current()?;
  if !identity.isolated{return Ok(None);}
  validate(std::env::var_os("FURINAKIT_ROOT").map(PathBuf::from),&identity.identifier,std::env::var_os("FURINAKIT_COMPONENTS_DIR").map(PathBuf::from)).map(Some)
 }).as_ref().map(|p|p.as_ref()).map_err(Clone::clone)
}
#[cfg(test)]mod tests{
 use super::*;
 fn fixture()->PathBuf{let parent=PathBuf::from(std::env::var_os("FK_G46_ROOT").expect("Explicit retained fixture root required"));assert!(parent.is_absolute()&&parent.is_dir());let p=parent.join(uuid::Uuid::new_v4().simple().to_string());std::fs::create_dir(&p).unwrap();p}
 fn mark(p:&Path,id:&str){std::fs::write(p.join(".furinakit-isolated-profile"),format!("{id}\n")).unwrap();}
 #[test]fn production_keeps_existing_service_policy(){let p=Policy::for_isolated(false);assert!(p.ancillary&&p.warm_worker&&p.automatic_reveal&&p.tray&&p.close_to_tray);}
 #[test]fn test_profile_disables_services_warmup_focus_and_tray(){let p=Policy::for_isolated(true);assert!(!p.ancillary&&!p.warm_worker&&!p.automatic_reveal&&!p.tray&&!p.close_to_tray);}
 #[test]fn absent_or_relative_root_never_uses_daily_fallback(){assert!(validate(None,"com.furinakit.test.g46",None).is_err());assert!(validate(Some("relative".into()),"com.furinakit.test.g46",None).is_err());}
 #[test]fn missing_marker_rejected_without_creating_one(){let p=fixture();assert!(validate(Some(p.clone()),"com.furinakit.test.g46",None).is_err());assert!(!p.join(".furinakit-isolated-profile").exists());}
 #[test]fn wrong_profile_marker_rejected(){let p=fixture();mark(&p,"com.furinakit.desktop");assert!(validate(Some(p),"com.furinakit.test.g46",None).is_err());}
 #[test]fn exact_marker_admits_only_own_existing_root(){let p=fixture();mark(&p,"com.furinakit.test.g46");assert_eq!(validate(Some(p.clone()),"com.furinakit.test.g46",None).unwrap(),std::fs::canonicalize(p).unwrap());}
 #[test]fn parent_segments_rejected(){let p=fixture();mark(&p,"com.furinakit.test.g46");assert!(validate(Some(p.join("other/..")),"com.furinakit.test.g46",None).is_err());}
 #[test]fn component_override_cannot_escape(){let p=fixture();mark(&p,"com.furinakit.test.g46");assert!(validate(Some(p.clone()),"com.furinakit.test.g46",Some(p.join("unrelated"))).is_err());assert!(validate(Some(p.clone()),"com.furinakit.test.g46",Some(p.join("components"))).is_ok());}
 #[test]fn marker_directory_and_oversized_marker_rejected(){let p=fixture();std::fs::create_dir(p.join(".furinakit-isolated-profile")).unwrap();assert!(validate(Some(p),"com.furinakit.test.g46",None).is_err());let p=fixture();std::fs::write(p.join(".furinakit-isolated-profile"),vec![b'a';129]).unwrap();assert!(validate(Some(p),"com.furinakit.test.g46",None).is_err());}
 #[test]fn child_file_rejected_without_deletion(){for child in ["components","webview","profile"]{let p=fixture();mark(&p,"com.furinakit.test.g46");std::fs::write(p.join(child),b"retained").unwrap();assert!(validate(Some(p.clone()),"com.furinakit.test.g46",None).is_err());assert_eq!(std::fs::read(p.join(child)).unwrap(),b"retained");}}
 #[cfg(windows)]#[test]fn real_owned_junction_root_rejected(){use std::os::windows::process::CommandExt;let p=fixture();let target=p.join("target");std::fs::create_dir(&target).unwrap();mark(&target,"com.furinakit.test.g46");let link=p.join("junction");let result=std::process::Command::new("cmd.exe").args(["/D","/C","mklink","/J"]).arg(&link).arg(&target).creation_flags(0x08000000).output().unwrap();assert!(result.status.success(),"{}",String::from_utf8_lossy(&result.stderr));assert!(validate(Some(link),"com.furinakit.test.g46",None).is_err());}
}
