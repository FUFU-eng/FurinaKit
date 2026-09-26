//! Per-launch queue-readiness challenge. Not model readiness or source authentication.
use std::{fs,io::Read,path::{Path,PathBuf},process::Command,time::{Duration,Instant,SystemTime}};
use serde_json::Value;
pub const STARTUP_TIMEOUT:Duration=Duration::from_secs(120);
pub struct Ticket { directory:PathBuf, nonce:String, storage:PathBuf, started:Instant, deadline:SystemTime, timeout:Duration }
impl Ticket {
 pub fn new(cache:&Path,storage:&Path)->Result<Self,String>{Self::with_timeout(cache,storage,STARTUP_TIMEOUT)}
 pub(crate) fn with_timeout(cache:&Path,storage:&Path,timeout:Duration)->Result<Self,String>{
  if !cache.is_absolute()||!storage.is_absolute()||timeout.is_zero()||timeout>STARTUP_TIMEOUT{return Err("Invalid worker startup scope".into());}
  let storage=fs::canonicalize(storage).map_err(|e|e.to_string())?;
  storage.to_str().ok_or("Non-Unicode worker storage cannot be represented by readiness JSON")?;
  fs::create_dir_all(cache).map_err(|e|e.to_string())?;
  let nonce=uuid::Uuid::new_v4().simple().to_string();let directory=cache.join(&nonce);
  fs::create_dir(&directory).map_err(|e|e.to_string())?;
  let directory=fs::canonicalize(directory).map_err(|e|e.to_string())?;
  Ok(Self{directory,nonce,storage,started:Instant::now(),deadline:SystemTime::now()+timeout,timeout})
 }
 pub fn generation(&self)->&str{&self.nonce}
 pub fn configure(&self,cmd:&mut Command){cmd.env("FURINAKIT_WORKER_READY_FILE",self.directory.join("ready.json")).env("FURINAKIT_WORKER_READY_NONCE",&self.nonce);}
 fn receipt(&self)->PathBuf{self.directory.join("ready.json")}
 pub fn poll(&self,pid:u32)->Result<bool,String>{
  let path=self.receipt();
  let meta=match fs::symlink_metadata(&path){Ok(m)=>m,Err(e)if e.kind()==std::io::ErrorKind::NotFound=>{
   return if self.started.elapsed()>=self.timeout{Err("处理引擎启动超时；任务未提交 / Processing engine startup timed out; no task queued".into())}else{Ok(false)};
  },Err(e)=>return Err(format!("Cannot inspect worker readiness: {e}"))};
  #[cfg(windows)] {use std::os::windows::fs::MetadataExt;if meta.file_attributes()&0x400!=0{return Err("Linked worker readiness receipt rejected".into());}}
  if !meta.is_file()||meta.file_type().is_symlink()||meta.len()>4096{return Err("Invalid worker readiness receipt".into());}
  if meta.modified().map_err(|e|e.to_string())?>self.deadline{return Err("Late worker readiness receipt; no task queued".into());}
  let mut data=Vec::new();fs::File::open(path).map_err(|e|e.to_string())?.take(4097).read_to_end(&mut data).map_err(|e|e.to_string())?;
  if data.len()>4096{return Err("Oversized worker readiness receipt".into());}
  let v:Value=serde_json::from_slice(&data).map_err(|_|"Malformed worker readiness receipt")?;
  if v["schema"]!=1||v["leaseProtocol"]!=1||v["fileQueue"]!=true||v["pid"].as_u64()!=Some(pid as u64)||v["nonce"].as_str()!=Some(self.nonce.as_str())||v["storage"].as_str()!=self.storage.to_str(){return Err("处理引擎就绪协议不匹配；任务未提交 / Worker readiness contract mismatch; no task queued".into());}
  Ok(true)
 }
}
impl Drop for Ticket{fn drop(&mut self){for name in ["ready.json","ready.tmp"]{let _=fs::remove_file(self.directory.join(name));}let _=fs::remove_dir(&self.directory);}}
pub trait Process {
 fn id(&self)->u32;
 fn root_exit(&mut self)->Result<Option<u32>,String>;
 fn stop(&mut self)->Result<(),String>;
}
#[cfg(windows)] impl Process for crate::download_process::OwnedProcess {
 fn id(&self)->u32{self.id()}
 fn root_exit(&mut self)->Result<Option<u32>,String>{crate::download_process::OwnedProcess::root_exit(self)}
 fn stop(&mut self)->Result<(),String>{self.terminate(Duration::from_secs(5))}
}
#[cfg(not(windows))] impl Process for std::process::Child {
 fn id(&self)->u32{self.id()}
 fn root_exit(&mut self)->Result<Option<u32>,String>{self.try_wait().map(|s|s.map(|s|s.code().unwrap_or(-1)as u32)).map_err(|e|e.to_string())}
 fn stop(&mut self)->Result<(),String>{self.kill().map_err(|e|e.to_string())?;self.wait().map_err(|e|e.to_string())?;Ok(())}
}
pub struct Session<P:Process>{process:P,ticket:Ticket,ready:bool,failure:Option<String>}
impl<P:Process> Session<P>{
 pub fn new(process:P,ticket:Ticket)->Self{Self{process,ticket,ready:false,failure:None}}
 pub fn generation(&self)->&str{self.ticket.generation()}
 pub fn poll(&mut self)->Result<bool,String>{
  if let Some(e)=&self.failure{return Err(e.clone());}
  let result=(||{
   if let Some(code)=self.process.root_exit()?{return Err(format!("处理引擎已退出（{code}）；任务未提交 / Processing engine exited; no task queued"));}
   if !self.ready{self.ready=self.ticket.poll(self.process.id())?;}
   Ok(self.ready)
  })();
  if let Err(e)=&result{self.failure=Some(e.clone());}result
 }
 pub fn stop(&mut self)->Result<(),String>{self.process.stop()}
}
struct Slot<P:Process>{session:Option<Session<P>>,closing:bool}
/// Shared by actual Tauri submission and tests. Waits release the mutex; publication
/// stays inside the final generation/closing/ready check, so shutdown cannot interleave.
pub struct Hub<P:Process>{slot:std::sync::Mutex<Slot<P>>}
impl<P:Process> Hub<P>{
 pub fn new()->Self{Self{slot:std::sync::Mutex::new(Slot{session:None,closing:false})}}
 pub fn warm(&self,factory:impl FnOnce()->Result<Session<P>,String>)->Result<String,String>{
  let mut slot=self.slot.lock().map_err(|_|"Processing engine state unavailable")?;
  if slot.closing{return Err("应用正在退出；任务未提交 / Application is closing; no task queued".into());}
  if slot.session.is_none(){slot.session=Some(factory()?);}
  Ok(slot.session.as_ref().ok_or("Worker disappeared")?.generation().to_owned())
 }
 pub fn publish<T>(&self,factory:impl FnOnce()->Result<Session<P>,String>,publish:impl FnOnce()->Result<T,String>)->Result<T,String>{
  let generation=self.warm(factory)?;
  loop{
   {
    let mut slot=self.slot.lock().map_err(|_|"Processing engine state unavailable")?;
    if slot.closing{return Err("Application is closing; no task queued".into());}
    let session=slot.session.as_mut().ok_or("Worker stopped while starting; retry explicitly")?;
    if session.generation()!=generation{return Err("Worker generation changed; retry explicitly".into());}
    match session.poll(){
     Ok(true)=>return publish(),
     Ok(false)=>{},
     Err(error)=>match session.stop(){
      Ok(())=>{slot.session=None;return Err(error);},
      Err(stop)=>return Err(format!("{error}; worker tree stop unconfirmed: {stop}")),
     }
    }
   }
   std::thread::sleep(Duration::from_millis(50));
  }
 }
 pub fn shutdown(&self)->Result<(),String>{
  let mut slot=self.slot.lock().map_err(|_|"Processing engine state unavailable")?;
  slot.closing=true;
  if let Some(session)=slot.session.as_mut(){session.stop()?;}
  slot.session=None;Ok(())
 }
}

#[cfg(test)] mod hub_tests{
 use super::*;use std::sync::{Arc,Mutex,atomic::{AtomicUsize,Ordering}};
 struct Fake{exited:Arc<Mutex<Option<u32>>>,stop_fail:bool,polls:Arc<AtomicUsize>}
 impl Process for Fake{fn id(&self)->u32{42}fn root_exit(&mut self)->Result<Option<u32>,String>{{self.polls.fetch_add(1,Ordering::SeqCst);Ok(*self.exited.lock().unwrap())}}fn stop(&mut self)->Result<(),String>{if self.stop_fail{return Err("synthetic stop failure".into());}*self.exited.lock().unwrap()=Some(0);Ok(())}}
 fn session(name:&str,timeout:Duration,ready:bool,stop_fail:bool)->Session<Fake>{let root=PathBuf::from(std::env::var_os("FK_READY_TEST_ROOT").unwrap()).join(name);fs::create_dir(&root).unwrap();let storage=root.join("storage");fs::create_dir(&storage).unwrap();let t=Ticket::with_timeout(&root.join("cache"),&storage,timeout).unwrap();if ready{publish_receipt(&t);}
 Session::new(Fake{exited:Arc::new(Mutex::new(None)),stop_fail,polls:Arc::new(AtomicUsize::new(0))},t)}
 fn publish_receipt(t:&Ticket){fs::write(t.receipt(),serde_json::to_vec(&serde_json::json!({"schema":1,"nonce":t.nonce,"pid":42,"leaseProtocol":1,"fileQueue":true,"storage":t.storage})).unwrap()).unwrap();}
 #[test]fn callback_never_runs_on_timeout_then_explicit_retry_can_publish(){let hub=Hub::new();let calls=AtomicUsize::new(0);assert!(hub.publish(||Ok(session("hub-timeout",Duration::from_millis(20),false,false)),||{calls.fetch_add(1,Ordering::SeqCst);Ok(())}).is_err());assert_eq!(calls.load(Ordering::SeqCst),0);hub.publish(||Ok(session("hub-retry",Duration::from_secs(5),true,false)),||{calls.fetch_add(1,Ordering::SeqCst);Ok(())}).unwrap();assert_eq!(calls.load(Ordering::SeqCst),1);hub.shutdown().unwrap();}
 #[test]fn shutdown_releases_a_waiter_without_creating_or_publishing_another_session(){let hub=Arc::new(Hub::new());hub.warm(||Ok(session("hub-closing",Duration::from_secs(5),false,false))).unwrap();let cloned=hub.clone();let t=std::thread::spawn(move||cloned.publish(||panic!("Unexpected restart"),||->Result<(),String>{panic!("Published while closing")}));hub.shutdown().unwrap();assert!(t.join().unwrap().is_err());assert!(hub.warm(||panic!("Restart after shutdown")).is_err());}
 #[test]fn unconfirmed_stop_retains_failed_generation(){let hub=Hub::new();hub.warm(||Ok(session("hub-stop",Duration::from_secs(5),true,true))).unwrap();let generation;{let guard=hub.slot.lock().unwrap();let s=guard.session.as_ref().unwrap();generation=s.generation().to_owned();*s.process.exited.lock().unwrap()=Some(7);}
 assert!(hub.publish(||panic!("Unexpected start"),||Ok(())).unwrap_err().contains("stop unconfirmed"));assert_eq!(hub.warm(||panic!("Replaced unsafe tree")).unwrap(),generation);assert!(hub.shutdown().is_err());assert!(hub.warm(||panic!("Restart after stop failure")).is_err());}
 #[test]fn simultaneous_callers_start_one_session_and_each_publish_once(){let hub=Arc::new(Hub::new());let starts=Arc::new(AtomicUsize::new(0));let publications=Arc::new(AtomicUsize::new(0));let barrier=Arc::new(std::sync::Barrier::new(9));let mut threads=Vec::new();for _ in 0..8{let(h,s,p,b)=(hub.clone(),starts.clone(),publications.clone(),barrier.clone());threads.push(std::thread::spawn(move||{b.wait();h.publish(||{s.fetch_add(1,Ordering::SeqCst);Ok(session("hub-concurrent",Duration::from_secs(5),true,false))},||{p.fetch_add(1,Ordering::SeqCst);Ok(())}).unwrap();}));}barrier.wait();for t in threads{t.join().unwrap();}assert_eq!(starts.load(Ordering::SeqCst),1);assert_eq!(publications.load(Ordering::SeqCst),8);hub.shutdown().unwrap();}
 #[test]fn no_mutex_is_held_while_waiting_for_a_receipt(){let hub=Arc::new(Hub::new());hub.warm(||Ok(session("hub-unlocked",Duration::from_secs(5),false,false))).unwrap();let polls=hub.slot.lock().unwrap().session.as_ref().unwrap().process.polls.clone();let(h,started)=(hub.clone(),Arc::new(std::sync::Barrier::new(2)));let b=started.clone();let thread=std::thread::spawn(move||{b.wait();h.publish(||panic!("Unexpected restart"),||Ok(19))});started.wait();let observed=Instant::now()+Duration::from_secs(2);while polls.load(Ordering::SeqCst)==0{assert!(Instant::now()<observed);std::thread::sleep(Duration::from_millis(5));}let until=Instant::now()+Duration::from_secs(2);loop{if let Ok(guard)=hub.slot.try_lock(){publish_receipt(&guard.session.as_ref().unwrap().ticket);break;}assert!(Instant::now()<until);std::thread::sleep(Duration::from_millis(10));}assert_eq!(thread.join().unwrap().unwrap(),19);hub.shutdown().unwrap();}
 #[test]fn callback_error_does_not_falsely_mark_worker_dead(){let hub=Hub::new();let id=hub.warm(||Ok(session("hub-publication-error",Duration::from_secs(5),true,false))).unwrap();let result:Result<(),String>=hub.publish(||panic!(),||Err("synthetic filesystem failure".into()));assert!(result.is_err());assert_eq!(hub.warm(||panic!()).unwrap(),id);hub.publish(||panic!(),||Ok(())).unwrap();hub.shutdown().unwrap();}
 #[test]fn old_waiter_cannot_publish_into_replacement_generation(){let hub=Arc::new(Hub::new());hub.warm(||Ok(session("hub-old",Duration::from_secs(5),false,false))).unwrap();let polls=hub.slot.lock().unwrap().session.as_ref().unwrap().process.polls.clone();let h=hub.clone();let waiter=std::thread::spawn(move||h.publish(||panic!("Unexpected restart"),||->Result<(),String>{panic!("Old request replayed")}));let until=Instant::now()+Duration::from_secs(2);while polls.load(Ordering::SeqCst)==0{assert!(Instant::now()<until);std::thread::sleep(Duration::from_millis(5));}
 // Model the atomic replacement after another caller drained a failed generation.
 {let mut slot=hub.slot.lock().unwrap();slot.session.as_mut().unwrap().stop().unwrap();slot.session=Some(session("hub-replaced",Duration::from_secs(5),true,false));}
 assert!(waiter.join().unwrap().unwrap_err().contains("generation changed"));hub.publish(||panic!(),||Ok(())).unwrap();hub.shutdown().unwrap();}
}

#[cfg(test)] mod tests{
 use super::*;use serde_json::json;
 fn fixture(name:&str,timeout:Duration)->Ticket{let p=PathBuf::from(std::env::var_os("FK_READY_TEST_ROOT").unwrap()).join(name);fs::create_dir(&p).unwrap();fs::create_dir(p.join("storage")).unwrap();Ticket::with_timeout(&p.join("cache"),&p.join("storage"),timeout).unwrap()}
 fn normal(name:&str)->Ticket{fixture(name,Duration::from_secs(5))}
 fn value(t:&Ticket,pid:u32)->Value{json!({"schema":1,"nonce":t.nonce,"pid":pid,"leaseProtocol":1,"fileQueue":true,"storage":t.storage})}
 fn reply(t:&Ticket,v:Value){fs::write(t.receipt(),serde_json::to_vec(&v).unwrap()).unwrap();}
 #[test]fn pending_does_not_create_queue_or_job(){let t=normal("pending");assert!(!t.poll(12).unwrap());assert!(!t.storage.join("queue").exists());assert!(!t.storage.join("jobs").exists());}
 #[test]fn valid_receipt_matches_this_launch(){let t=normal("valid");reply(&t,value(&t,12));assert!(t.poll(12).unwrap());}
 #[test]fn stale_nonce_is_rejected(){let t=normal("nonce");let mut v=value(&t,12);v["nonce"]=json!("00000000000000000000000000000000");reply(&t,v);assert!(t.poll(12).is_err());}
 #[test]fn wrong_pid_protocol_store_and_queue_are_rejected(){for (i,key)in["pid","schema","leaseProtocol","fileQueue","storage"].iter().enumerate(){let t=normal(&format!("wrong-{i}"));let mut v=value(&t,12);v[key]=Value::Null;reply(&t,v);assert!(t.poll(12).is_err(),"{key}");}}
 #[test]fn malformed_oversized_and_directory_receipts_fail_closed(){for i in 0..3{let t=normal(&format!("bad-{i}"));match i{0=>fs::write(t.receipt(),b"{").unwrap(),1=>fs::write(t.receipt(),vec![b'x';4097]).unwrap(),_=>fs::create_dir(t.receipt()).unwrap()};assert!(t.poll(12).is_err());}}
 #[test]fn missing_receipt_expires(){let t=fixture("timeout",Duration::from_millis(20));std::thread::sleep(Duration::from_millis(40));assert!(t.poll(12).unwrap_err().contains("timed out"));}
 #[test]fn late_receipt_is_not_startup_success(){let t=fixture("late",Duration::from_millis(20));std::thread::sleep(Duration::from_millis(50));reply(&t,value(&t,12));assert!(t.poll(12).unwrap_err().contains("Late"));}
 #[test]fn promptly_published_receipt_can_be_read_after_idle(){let t=fixture("idle",Duration::from_millis(500));reply(&t,value(&t,12));std::thread::sleep(Duration::from_millis(550));assert!(t.poll(12).unwrap());}
 #[test]fn each_retry_uses_a_fresh_challenge(){let a=normal("gen-a");let b=normal("gen-b");assert_ne!(a.generation(),b.generation());reply(&b,value(&a,12));assert!(b.poll(12).is_err());}
 #[test]fn cleanup_never_recursively_deletes_unknown_files(){let t=normal("cleanup");let p=t.directory.clone();fs::write(p.join("retain.txt"),b"synthetic preserved").unwrap();reply(&t,value(&t,12));drop(t);assert_eq!(fs::read(p.join("retain.txt")).unwrap(),b"synthetic preserved");assert!(!p.join("ready.json").exists());}
 struct Fake{exit:Option<u32>,stop_error:bool}
 impl Process for Fake{fn id(&self)->u32{12}fn root_exit(&mut self)->Result<Option<u32>,String>{Ok(self.exit)}fn stop(&mut self)->Result<(),String>{if self.stop_error{Err("synthetic stop not confirmed".into())}else{self.exit=Some(0);Ok(())}}}
 #[test]fn ready_receipt_does_not_resurrect_dead_root(){let t=normal("dead");reply(&t,value(&t,12));let mut s=Session::new(Fake{exit:Some(7),stop_error:false},t);assert!(s.poll().is_err());}
 #[test]fn session_error_is_sticky_and_stop_failure_is_reported(){let t=normal("sticky");reply(&t,json!({}));let mut s=Session::new(Fake{exit:None,stop_error:true},t);assert!(s.poll().is_err());reply(&s.ticket,value(&s.ticket,12));assert!(s.poll().is_err());assert!(s.stop().is_err());}
 #[test]fn cached_readiness_still_checks_process_liveness(){let t=normal("cached");reply(&t,value(&t,12));let mut s=Session::new(Fake{exit:None,stop_error:false},t);assert!(s.poll().unwrap());fs::remove_file(s.ticket.receipt()).unwrap();assert!(s.poll().unwrap());s.process.exit=Some(0);assert!(s.poll().is_err());}
}
