//! One non-abortable diagnostics scan per application process, admitted BEFORE
//! scheduling blocking IO. UI timeout does not release a still-running scan.
use std::sync::atomic::{AtomicBool,Ordering};
static BUSY:AtomicBool=AtomicBool::new(false);
pub struct Admission { _private:() }
pub fn begin()->Result<Admission,String>{
 BUSY.compare_exchange(false,true,Ordering::AcqRel,Ordering::Acquire)
  .map(|_|Admission{_private:()})
  .map_err(|_|"已有自检进行中，请稍后重试 / Diagnostics already running; retry later".into())
}
impl Drop for Admission{fn drop(&mut self){BUSY.store(false,Ordering::Release);}}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn admission_precedes_work_and_releases_on_drop(){let a=begin().unwrap();assert!(begin().is_err());drop(a);drop(begin().unwrap());}
 #[test]fn moving_to_blocking_thread_keeps_admission(){let a=begin().unwrap();let(t,r)=std::sync::mpsc::channel();let thread=std::thread::spawn(move||{let _a=a;r.recv().unwrap();});assert!(begin().is_err());t.send(()).unwrap();thread.join().unwrap();drop(begin().unwrap());}
 #[test]fn error_return_releases_admission(){fn work()->Result<(),String>{let _a=begin()?;Err("synthetic IO failure".into())}assert!(work().is_err());drop(begin().unwrap());}
 #[test]fn racing_requests_admit_exactly_one(){use std::sync::{Arc,Barrier,atomic::AtomicUsize};let barrier=Arc::new(Barrier::new(8));let winners=Arc::new(AtomicUsize::new(0));let mut threads=Vec::new();for _ in 0..8{let(b,w)=(barrier.clone(),winners.clone());threads.push(std::thread::spawn(move||{b.wait();let admission=begin().ok();if admission.is_some(){w.fetch_add(1,Ordering::SeqCst);}b.wait();drop(admission);}));}for t in threads{t.join().unwrap();}assert_eq!(winners.load(Ordering::SeqCst),1);drop(begin().unwrap());}
}
