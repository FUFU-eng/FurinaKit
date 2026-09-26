//! Explicit stdio with atomic Job membership. No spawn-then-assign, root-only kill,
//! reader-thread joins, or waiting for pipe EOF after tree termination.
use std::{fs::File,io::{Read,Write},os::windows::{io::{AsRawHandle,FromRawHandle},process::ExitStatusExt},path::Path,process::{Command,ExitStatus,Output},sync::atomic::{AtomicU64,Ordering},time::{Duration,Instant}};
use crate::{download_process::OwnedProcess,resource_custody::{Custody,SharedResource}};
type Handle=isize;
#[link(name="kernel32")]extern "system" {
 fn CreatePipe(read:*mut Handle,write:*mut Handle,security:*const std::ffi::c_void,size:u32)->i32;
 fn PeekNamedPipe(pipe:Handle,buffer:*mut std::ffi::c_void,size:u32,read:*mut u32,available:*mut u32,left:*mut u32)->i32;
}
fn pipe()->Result<(File,File),String>{
 let(mut r,mut w)=(0,0);
 // NULL security: neither parent end is inheritable. Spawn duplicates ONLY the
 // three selected child endpoints into its explicit HANDLE_LIST.
 if unsafe{CreatePipe(&mut r,&mut w,std::ptr::null(),0)}==0{return Err(format!("Create recorder pipe: {}",std::io::Error::last_os_error()));}
 Ok(unsafe{(File::from_raw_handle(r as _),File::from_raw_handle(w as _))})
}
pub struct PipeReader(File);
impl PipeReader {
 fn drain(&mut self,limit:usize)->Result<Vec<u8>,String>{
  let mut available=0;
  if unsafe{PeekNamedPipe(self.0.as_raw_handle()as isize,std::ptr::null_mut(),0,std::ptr::null_mut(),&mut available,std::ptr::null_mut())}==0 {
   let e=std::io::Error::last_os_error();if matches!(e.raw_os_error(),Some(109|232)){return Ok(Vec::new());}return Err(format!("Read recorder pipe: {e}"));
  }
  let mut bytes=vec![0;usize::min(available as usize,limit)];
  if !bytes.is_empty(){let n=self.0.read(&mut bytes).map_err(|e|e.to_string())?;bytes.truncate(n);}Ok(bytes)
 }
}
pub struct ManagedChild {
 process:Custody<OwnedProcess,SharedResource>,
 stdin:Option<File>, stdout:PipeReader, stderr:Option<PipeReader>, log:Option<File>, log_bytes:usize, progress_line:Vec<u8>,
}
impl ManagedChild {
 /// Command supplies program/args/cwd/env only; stdio and creation flags are explicit.
 /// No env_clear callers: get_envs cannot represent that Command builder setting.
 pub fn spawn(cmd:&Command,log:Option<File>,resources:SharedResource,interactive:bool)->Result<Self,String>{
  let program=std::fs::canonicalize(Path::new(cmd.get_program())).map_err(|e|format!("Recorder executable: {e}"))?;
  let cwd=match cmd.get_current_dir(){Some(p)=>std::fs::canonicalize(p),None=>std::env::current_dir()}.map_err(|e|e.to_string())?;
  let args=cmd.get_args().map(|a|a.to_str().map(str::to_owned).ok_or_else(||"Non-Unicode recorder argument".to_owned())).collect::<Result<Vec<_>,_>>()?;
  let environment=cmd.get_envs().map(|(k,v)|(k.to_owned(),v.map(|v|v.to_owned()))).collect::<Vec<_>>();
  let (input,stdin)=if interactive{let(r,w)=pipe()?;(r,Some(w))}else{(File::open(r"\\.\NUL").map_err(|e|e.to_string())?,None)};
  let (stdout,out_child)=pipe()?;
  let(err_parent,err_child)=pipe()?;let stderr=Some(PipeReader(err_parent));
  let process=Custody::new(OwnedProcess::spawn_with_files(&program,&args,&cwd,&environment,&input,&out_child,&err_child)?,resources);
  Ok(Self{process,stdin,stdout:PipeReader(stdout),stderr,log,log_bytes:0,progress_line:Vec::new()})
 }
 pub fn try_wait(&self)->Result<Option<ExitStatus>,String>{self.process.try_exit().map(|v|v.map(ExitStatus::from_raw))}
 pub fn root_exited(&self)->Result<bool,String>{self.process.root_exit().map(|s|s.is_some())}
 pub fn poll_progress(&mut self,progress:&AtomicU64)->Result<usize,String>{
  let mut drained=0;
  if let Some(log)=self.log.as_mut(){
   let bytes=self.stderr.as_mut().unwrap().drain(65536)?;drained+=bytes.len();
   let remaining=(8*1024*1024usize).saturating_sub(self.log_bytes);
   log.write_all(&bytes[..bytes.len().min(remaining)]).map_err(|e|e.to_string())?;
   self.log_bytes+=bytes.len().min(remaining);
   if bytes.len()>remaining{return Err("Recorder log exceeds 8 MiB; partial log retained".into());}
  }
  let bytes=self.stdout.drain(65536)?;drained+=bytes.len();
  for b in bytes{
   if b==b'\n'{if let Ok(line)=std::str::from_utf8(&self.progress_line){if let Some(n)=line.trim_end_matches('\r').strip_prefix("out_time_us=").and_then(|s|s.parse::<u64>().ok()){progress.store(n,Ordering::Relaxed);}}self.progress_line.clear();}
   else{if self.progress_line.len()>=4096{return Err("Recorder progress line exceeds 4 KiB".into());}self.progress_line.push(b);}
  }Ok(drained)
 }
 pub fn finish(&mut self,progress:&AtomicU64,grace:Duration)->Result<ExitStatus,String>{
  // Exactly one small write into a fresh stdin pipe, then close it. Repeated stop
  // requests never fill the pipe; no unbounded generic stdin writes are exposed.
  if let Some(mut input)=self.stdin.take(){let _=input.write_all(b"q\n");}
  let until=Instant::now()+grace;
  let outcome=(||{loop{
   self.poll_progress(progress)?;
   if let Some(status)=self.try_wait()?{let tail_until=Instant::now()+Duration::from_secs(1);while self.poll_progress(progress)?!=0{if Instant::now()>=tail_until{return Err("Recorder final output drain timed out".into());}}if let Some(log)=self.log.as_mut(){log.flush().map_err(|e|e.to_string())?;}return Ok(status);}
   if Instant::now()>=until{return Err("录制收尾超时；分段与日志保留，不作为完整成品 / Recorder finalization timed out".into());}
   std::thread::sleep(Duration::from_millis(20));
  }})();
  self.process.after_exit(outcome)?
 }
 pub fn capture(cmd:&Command,timeout:Duration,resources:SharedResource)->Result<Output,String>{
  let mut child=Self::spawn(cmd,None,resources,false)?;
  let mut stdout=Vec::new();let mut stderr=Vec::new();let until=Instant::now()+timeout;
  let result=(||{loop{
   let out=child.stdout.drain(65536)?;let err=child.stderr.as_mut().unwrap().drain(65536)?;
   // Overflow is a bounded failure, not a stopped reader that blocks the producer.
   if stdout.len()+out.len()>4*1024*1024||stderr.len()+err.len()>4*1024*1024{return Err("Recorder component output exceeds 4 MiB per stream".into());}
   let empty=out.is_empty()&&err.is_empty();stdout.extend(out);stderr.extend(err);
   if let Some(status)=child.try_wait()?{if empty{
    // Re-read AFTER observing tree exit: the child may have written its final
    // bytes between the initial drain and the exit observation.
    let tail_out=child.stdout.drain(65536)?;let tail_err=child.stderr.as_mut().unwrap().drain(65536)?;
    if tail_out.is_empty()&&tail_err.is_empty(){return Ok(status);}
    if stdout.len()+tail_out.len()>4*1024*1024||stderr.len()+tail_err.len()>4*1024*1024{return Err("Recorder component output exceeds 4 MiB per stream".into());}
    stdout.extend(tail_out);stderr.extend(tail_err);
   }}

   if Instant::now()>=until{return Err(if child.root_exited().unwrap_or(false){"Recorder component timed out after root exit; descendants not confirmed stopped"}else{"音视频组件响应超时 / Recorder component timed out"}.into());}
   std::thread::sleep(Duration::from_millis(2));
  }})();
  let status=child.process.after_exit(result)??;
  Ok(Output{status,stdout,stderr})
 }
}

/// Retain the recording slot on ANY unconfirmed exit, including query failure.
/// A successful result alone is not permission to release a session's child.
pub fn finish_slot<P,R>(slot:&mut Option<P>,finish:impl FnOnce(&mut P)->Result<R,String>,confirmed:impl FnOnce(&P)->bool)->Result<Option<R>,String>{
 let Some(child)=slot.as_mut()else{return Ok(None);};let outcome=finish(child);
 if !confirmed(child){return Err(outcome.err().unwrap_or_else(||"Recorder exit unconfirmed; session retained".into()));}
 slot.take();outcome.map(Some)
}
#[cfg(test)]mod slot_tests{
 use super::*;
 #[test]fn successful_confirmed_exit_releases_slot(){let mut p=Some(1);assert_eq!(finish_slot(&mut p,|_|Ok(7),|_|true),Ok(Some(7)));assert!(p.is_none());}
 #[test]fn failed_but_confirmed_exit_releases_slot(){let mut p=Some(1);assert!(finish_slot::<_,()>(&mut p,|_|Err("failed".into()),|_|true).is_err());assert!(p.is_none());}
 #[test]fn failed_unknown_exit_retains_slot_for_retry(){let mut p=Some(1);assert!(finish_slot::<_,()>(&mut p,|_|Err("unknown".into()),|_|false).is_err());assert_eq!(p,Some(1));assert!(finish_slot(&mut p,|_|Ok(()),|_|true).is_ok());assert!(p.is_none());}
 #[test]fn success_without_exit_confirmation_is_not_accepted(){let mut p=Some(1);assert!(finish_slot(&mut p,|_|Ok(()),|_|false).unwrap_err().contains("unconfirmed"));assert_eq!(p,Some(1));}
 #[test]fn empty_slot_does_not_run_callbacks(){let mut p:Option<()>=None;assert_eq!(finish_slot::<_,()>(&mut p,|_|panic!("finish"),|_|panic!("query")),Ok(None));}
}
