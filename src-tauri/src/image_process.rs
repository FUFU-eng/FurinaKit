//! Bounded native image subprocess. No shell, no Python, no catch_unwind isolation claim.
use std::{path::Path,process::{Child,Command,Stdio},io::{Read,Write},time::{Duration,Instant}};
use serde_json::{Value,json};
#[cfg(windows)]
mod platform {
 use std::{os::windows::io::AsRawHandle,process::Child};
 use windows::{core::PCWSTR,Win32::{Foundation::{HANDLE,CloseHandle},System::JobObjects::*}};
 pub struct Job(HANDLE);
 impl Job {
  pub fn new(bytes:usize)->Result<Self,String>{
   // SAFETY: unnamed non-inheritable job; all handles remain owned by this guard.
   let h=unsafe{CreateJobObjectW(None,PCWSTR::null())}.map_err(|e|format!("Cannot create image resource job: {e}"))?;
   let job=Self(h);let mut limits=JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
   limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_PROCESS_MEMORY|JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE|JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
   limits.BasicLimitInformation.ActiveProcessLimit=1;limits.ProcessMemoryLimit=bytes;
   // SAFETY: correct Windows SDK layout, live handle, valid input buffer for synchronous call.
   unsafe{SetInformationJobObject(h,JobObjectExtendedLimitInformation,(&limits as *const JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),std::mem::size_of_val(&limits)as u32)}.map_err(|e|format!("Cannot enforce image resource limits: {e}"))?;
   Ok(job)
  }
  pub fn assign(&self,child:&Child)->Result<(),String>{
   // SAFETY: borrowed child process handle lives throughout assignment; worker is blocked on stdin.
   unsafe{AssignProcessToJobObject(self.0,HANDLE(child.as_raw_handle()))}.map_err(|e|format!("Cannot isolate image worker: {e}"))
  }
  pub fn peak(&self)->Result<usize,String>{let mut info=JOBOBJECT_EXTENDED_LIMIT_INFORMATION::default();
   // SAFETY: correct-sized writable SDK POD and live owned job.
   unsafe{QueryInformationJobObject(Some(self.0),JobObjectExtendedLimitInformation,(&mut info as *mut JOBOBJECT_EXTENDED_LIMIT_INFORMATION).cast(),std::mem::size_of_val(&info)as u32,None)}.map_err(|e|e.to_string())?;Ok(info.PeakProcessMemoryUsed)
  }
 }
 impl Drop for Job{fn drop(&mut self){unsafe{let _=CloseHandle(self.0);}}}
}
#[cfg(not(windows))]
mod platform {
 pub struct Job;
 impl Job{pub fn new(_:usize)->Result<Self,String>{Err("Bounded image subprocess currently requires Windows Job Objects".into())}pub fn assign(&self,_:&std::process::Child)->Result<(),String>{Err("Unsupported process isolation".into())}pub fn peak(&self)->Result<usize,String>{Err("Unsupported process accounting".into())}}
}
struct Running {child:Child,job:platform::Job}
impl Drop for Running {fn drop(&mut self){let _=self.child.kill();let _=self.child.wait();}}
pub fn execute(executable:&Path,request:&Value,check:&dyn Fn()->Result<(),String>)->Result<Value,String>{
 execute_with_limits(executable,request,check,1024*1024*1024,Duration::from_secs(300))
}
/// Explicit limits are internal API, never taken from a frontend request.
pub fn execute_with_limits(executable:&Path,request:&Value,check:&dyn Fn()->Result<(),String>,memory:usize,timeout:Duration)->Result<Value,String>{
 check()?;if !(32*1024*1024..=2*1024*1024*1024).contains(&memory)||timeout.is_zero()||timeout>Duration::from_secs(300){return Err("Invalid image process budget".into());}
 let data=serde_json::to_vec(request).map_err(|e|e.to_string())?;if data.len()>65536{return Err("Image request exceeds 64 KiB".into());}
 if !executable.is_file(){return Err("原生图片组件缺失，请修复安装 / Native image worker missing; repair installation".into());}
 let job=platform::Job::new(memory)?;let mut command=Command::new(executable);
 command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
 if let Some(parent)=executable.parent(){command.current_dir(parent);}
 #[cfg(windows)]{use std::os::windows::process::CommandExt;command.creation_flags(0x08000000);}
 let child=command.spawn().map_err(|e|format!("图片组件启动失败 / Cannot start native image worker: {e}"))?;
 let mut guard=Running{child,job};guard.job.assign(&guard.child)?;
 // Assignment succeeds before any request reaches a codec. No unbounded fallback.
 let mut stdin=guard.child.stdin.take().ok_or("Worker stdin unavailable")?;
 let stdout=guard.child.stdout.take().ok_or("Worker stdout unavailable")?;
 let writer=std::thread::Builder::new().name("image-request".into()).spawn(move||stdin.write_all(&data)).map_err(|e|e.to_string())?;
 let reader=std::thread::Builder::new().name("image-response".into()).spawn(move||{let mut b=Vec::new();stdout.take(65537).read_to_end(&mut b).map(|_|b)}).map_err(|e|e.to_string())?;
 let started=Instant::now();let status=(||loop{
  check()?;if started.elapsed()>=timeout{return Err("图片处理超时，工作进程已终止 / Image worker timed out".to_string());}
  if let Some(status)=guard.child.try_wait().map_err(|e|e.to_string())?{return Ok(status);}
  std::thread::sleep(Duration::from_millis(25));
 })();
 let peak=guard.job.peak();drop(guard); // kill/wait on cancel, timeout, exit or error; closes the entire job
 let write=writer.join().map_err(|_|"Image request writer failed");
 let read=reader.join().map_err(|_|"Image response reader failed");
 let status=status?;if !status.success(){return Err(format!("图片工作进程异常退出（内存预算 {} MiB），输入未修改 / Image worker failed: {status}",memory/1024/1024));}
 write?.map_err(|e|e.to_string())?;let bytes=read?.map_err(|e|e.to_string())?;
 if bytes.len()>65536{return Err("Image worker response exceeded limit".into());}
 let response:Value=serde_json::from_slice(&bytes).map_err(|_|"Invalid image worker response")?;
 if response["protocol"]!=1{return Err("Incompatible image worker response".into());}
 if response["ok"]!=true{return Err(response["error"].as_str().unwrap_or("Image worker failed").to_owned());}
 let mut result=response["result"].clone();if !result.is_object(){return Err("Invalid image worker result".into());}
 result["workerMemoryLimitBytes"]=json!(memory);result["workerPeakMemoryBytes"]=json!(peak?);result["isolatedWorker"]=json!(true);check()?;Ok(result)
}
