//! Default-off managed upscale selection. Pins describe one audited local fixture, not a release signature.
//! Active is retained with the worker process tree, conservatively blocking deactivation while idle too.
use std::{path::{Path,PathBuf},process::Command};
use crate::component_store::{Active,Kind,Store};
pub const TREE_PIN:&str="33612d96eea3312f853288898f8483b6f3bddc8b1860f7675368cc7be8ed21d8";
pub const TREE:&[u8]=include_bytes!("upscale_tree_g52.json");
pub const DIRECTORY:&str="upscale-ncnn-v1";
pub fn enabled()->bool{std::env::var_os("FURINAKIT_EXPERIMENTAL_UPSCALE_STORE").as_deref()==Some(std::ffi::OsStr::new("1"))}
pub fn select(components:&Path,worker:&Path)->Result<Option<Active>,String>{select_mode(components,worker,enabled())}
pub fn select_mode(components:&Path,worker:&Path,experimental:bool)->Result<Option<Active>,String>{
 if !experimental{return Ok(None);}
 #[cfg(not(windows))] return Err("Managed upscale currently requires Windows".into());
 #[cfg(windows)] {
  crate::worker_protocol::upscale(worker)?;
  let store=Store::open_kind(&components.join(DIRECTORY),Kind::Upscale)?;
  Ok(Some(store.acquire(TREE,TREE_PIN)?))
 }
}
// Python G51 accepts ordinary disk paths, not verbatim/UNC paths. Only strip the
// canonical Windows verbatim DISK prefix; never reinterpret UNC or device paths.
fn python_root(path:&Path)->Result<PathBuf,String>{
 let s=path.to_str().ok_or("Non-Unicode upscale root")?;
 #[cfg(windows)] {
  let s=s.strip_prefix(r"\\?\").unwrap_or(s);
  let b=s.as_bytes();
  if b.len()<3||!b[0].is_ascii_alphabetic()||b[1]!=b':'||b[2]!=b'\\'{return Err("Local disk upscale root required".into());}
  return Ok(PathBuf::from(s));
 }
 #[cfg(not(windows))] {if !path.is_absolute(){return Err("Absolute upscale root required".into());}Ok(PathBuf::from(s))}
}
pub fn configure(cmd:&mut Command,active:Option<&Active>)->Result<(),String>{
 // Never pass through an arbitrary development root inherited by the desktop app.
 cmd.env_remove("FURINAKIT_EXPERIMENTAL_UPSCALE").env_remove("FURINAKIT_EXPERIMENTAL_UPSCALE_ROOT");
 if let Some(active)=active{cmd.env("FURINAKIT_EXPERIMENTAL_UPSCALE","1").env("FURINAKIT_EXPERIMENTAL_UPSCALE_ROOT",python_root(&active.path)?);}
 Ok(())
}
#[cfg(windows)]
pub fn install_local(components:&Path,archive:&Path,cancel:&std::sync::atomic::AtomicBool)->Result<PathBuf,String>{
 use std::sync::atomic::Ordering;
 if cancel.load(Ordering::Acquire){return Err("Import cancelled before store creation".into());}
 if !components.is_absolute(){return Err("Absolute startup-pinned component root required".into());}
 let destination=components.join(DIRECTORY);
 let store=match std::fs::symlink_metadata(&destination){
  Ok(_)=>Store::open_kind(&destination,Kind::Upscale)?,
  Err(e)if e.kind()==std::io::ErrorKind::NotFound=>Store::create_kind(&destination,Kind::Upscale)?,
  Err(e)=>return Err(e.to_string()),
 };
 crate::worker_import::install_policy(&store,archive,TREE,
  "0732d621b05b18bb071d9d66253523228b1c3ad9e7cc1bc20c28d38dbdd89952",TREE_PIN,cancel,||{})
}
#[cfg(all(test,windows))] #[path="upscale_extension_tests.rs"] mod tests;
