//! Windows process adapter retaining component resources until the whole Job exits.
//! In-process custody only; default Job kill-on-close is NOT an observer recovery receipt.
use std::{ffi::OsString,fs::File,path::Path,process::{Command,ExitStatus},time::Duration};
use std::os::windows::process::ExitStatusExt;
use crate::{download_process::OwnedProcess,resource_custody::{Custody,SharedResource}};
pub struct Child{inner:Custody<OwnedProcess,SharedResource>}
impl Child{
 pub fn new(process:OwnedProcess,resources:SharedResource)->Self{Self{inner:Custody::new(process,resources)}}
 pub fn id(&self)->u32{self.inner.id()}
 pub fn root_exit(&self)->Result<Option<u32>,String>{self.inner.root_exit()}
 pub fn try_wait(&mut self)->Result<Option<ExitStatus>,String>{self.inner.try_exit().map(|s|s.map(ExitStatus::from_raw))}
 pub fn kill(&mut self)->Result<(),String>{self.inner.terminate(Duration::from_secs(5))}
 pub fn wait(&mut self)->Result<ExitStatus,String>{self.kill()?;self.try_wait()?.ok_or("Process tree stop not confirmed".into())}
 pub fn spawn_command(command:&Command,input:&File,output:&File,error:&File,resources:SharedResource)->Result<Self,String>{
  let program=std::fs::canonicalize(Path::new(command.get_program())).map_err(|e|e.to_string())?;
  let cwd=match command.get_current_dir(){Some(p)=>std::fs::canonicalize(p),None=>std::env::current_dir()}.map_err(|e|e.to_string())?;
  let args=command.get_args().map(|a|a.to_str().map(str::to_owned).ok_or("Non-Unicode worker argument")).collect::<Result<Vec<_>,_>>()?;
  let environment:Vec<(OsString,Option<OsString>)>=command.get_envs().map(|(k,v)|(k.to_owned(),v.map(|x|x.to_owned()))).collect();
  let process=OwnedProcess::spawn_with_files(&program,&args,&cwd,&environment,input,output,error)?;
  Ok(Self::new(process,resources))
 }
}
impl crate::worker_startup::Process for Child{
 fn id(&self)->u32{Child::id(self)}
 fn root_exit(&mut self)->Result<Option<u32>,String>{Child::root_exit(self)}
 fn stop(&mut self)->Result<(),String>{self.kill()}
}
