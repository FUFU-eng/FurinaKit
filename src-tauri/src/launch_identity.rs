//! Startup identity only. A test profile is NOT a filesystem/network/UI sandbox.
//! Resolve once before any shell mutex, notification or Tauri context is created.
use std::{ffi::OsString,sync::OnceLock};
#[derive(Clone,Debug,PartialEq,Eq)]
pub struct Identity{pub identifier:String,pub mutex:String,pub isolated:bool}
pub fn parse(profile:Option<OsString>)->Result<Identity,String>{
 match profile{
  None=>Ok(Identity{identifier:"com.furinakit.desktop".into(),mutex:"Local\\FurinaKit.Desktop.Shell.Singleton.v1".into(),isolated:false}),
  Some(raw)=>{
   let value=raw.into_string().map_err(|_|"Invalid test profile encoding")?;
   if value.is_empty()||value.len()>48||!value.bytes().all(|c|c.is_ascii_alphanumeric()||c==b'-'){return Err("Invalid isolated test profile; startup refused".into());}
   // Windows app-data paths are case-insensitive: mutex and app ID must agree.
   let value=value.to_ascii_lowercase();
   Ok(Identity{identifier:format!("com.furinakit.test.{value}"),mutex:format!("Local\\FurinaKit.Test.{value}.Shell.Singleton.v1"),isolated:true})
  }
 }
}
pub fn current()->Result<&'static Identity,String>{static ID:OnceLock<Result<Identity,String>>=OnceLock::new();ID.get_or_init(||parse(std::env::var_os("FURINAKIT_TEST_PROFILE"))).as_ref().map_err(Clone::clone)}
#[cfg(windows)]mod native{
 use super::Identity;
 #[link(name="kernel32")]extern "system"{
  fn CreateMutexW(attributes:*const std::ffi::c_void,owner:i32,name:*const u16)->isize;
  fn GetLastError()->u32;
  fn CloseHandle(handle:isize)->i32;
 }
 pub struct MutexGuard(isize);
 impl Drop for MutexGuard{fn drop(&mut self){unsafe{CloseHandle(self.0);}}}
 pub enum Admission{Primary(MutexGuard),Existing}
 pub fn acquire(identity:&Identity)->Result<Admission,String>{
  let name:Vec<u16>=identity.mutex.encode_utf16().chain(Some(0)).collect();
  let handle=unsafe{CreateMutexW(std::ptr::null(),0,name.as_ptr())};let error=unsafe{GetLastError()};
  if handle==0{return Err(format!("Cannot establish shell singleton (Windows {error}); startup refused"));}
  if error==183{unsafe{CloseHandle(handle);}return Ok(Admission::Existing);}
  Ok(Admission::Primary(MutexGuard(handle)))
 }
}
#[cfg(windows)]pub use native::{acquire,Admission,MutexGuard};
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn production_identity_is_unchanged(){let i=parse(None).unwrap();assert!(!i.isolated);assert_eq!(i.identifier,"com.furinakit.desktop");assert_eq!(i.mutex,"Local\\FurinaKit.Desktop.Shell.Singleton.v1");}
 #[test]fn profile_changes_both_names(){let p=parse(Some("g39-fixture".into())).unwrap();let d=parse(None).unwrap();assert!(p.isolated);assert_ne!(p.identifier,d.identifier);assert_ne!(p.mutex,d.mutex);}
 #[test]fn case_aliases_share_identity_and_mutex(){assert_eq!(parse(Some("G39-Test".into())).unwrap(),parse(Some("g39-test".into())).unwrap());}
 #[test]fn malformed_profiles_fail_closed(){for p in ["","../daily","a/b","a\\b","a.b","a_b","with space","中文","x\0y"]{assert!(parse(Some(p.into())).is_err(),"{p:?}");}assert!(parse(Some("a".repeat(49).into())).is_err());}
 #[test]fn length_boundary(){assert!(parse(Some("a".repeat(48).into())).is_ok());}
 #[cfg(windows)]#[test]fn non_unicode_environment_cannot_fall_back_to_production(){use std::os::windows::ffi::OsStringExt;assert!(parse(Some(OsString::from_wide(&[0xd800]))).is_err());}
 #[cfg(windows)]fn unique()->Identity{parse(Some(format!("g39-{}",uuid::Uuid::new_v4().simple()).into())).unwrap()}
 #[cfg(windows)]#[test]fn own_native_mutex_rejects_duplicate_and_releases(){let i=unique();let first=match acquire(&i).unwrap(){Admission::Primary(g)=>g,_=>panic!("fresh namespace occupied")};assert!(matches!(acquire(&i).unwrap(),Admission::Existing));drop(first);assert!(matches!(acquire(&i).unwrap(),Admission::Primary(_)));}
 #[cfg(windows)]#[test]fn separate_test_profiles_do_not_block_each_other(){let a=unique();let b=unique();let ga=acquire(&a).unwrap();let gb=acquire(&b).unwrap();assert!(matches!(ga,Admission::Primary(_)));assert!(matches!(gb,Admission::Primary(_)));}
 #[cfg(windows)]#[test]fn native_mutex_blocks_owned_child_process(){use std::os::windows::process::CommandExt;let i=unique();let profile=i.identifier.strip_prefix("com.furinakit.test.").unwrap();let _guard=acquire(&i).unwrap();let status=std::process::Command::new(std::env::current_exe().unwrap()).args(["--exact","launch_identity::tests::child_mutex_helper","--ignored","--nocapture"]).env("FK_G39_CHILD_PROFILE",profile).creation_flags(0x08000000).status().unwrap();assert!(status.success());}
 #[cfg(windows)]#[test]#[ignore="Owned helper only; never use daily mutex"]fn child_mutex_helper(){let p=std::env::var("FK_G39_CHILD_PROFILE").unwrap();assert!(p.starts_with("g39-"));let i=parse(Some(p.into())).unwrap();assert!(matches!(acquire(&i).unwrap(),Admission::Existing));}
}
