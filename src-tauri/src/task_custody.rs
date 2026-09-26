//! Task-level resources: a retained child also retains task completion and scratch.
//! In-process only; this does not provide durable owner-death protection.
use std::sync::Arc;
use crate::resource_custody::{Custody, SharedResource, Tree};
pub struct Scope { resources: SharedResource }
impl Scope {
    pub fn new<G: Send + Sync + 'static>(resources: G) -> Self { Self { resources: Arc::new(resources) } }
    pub fn retain(&self) -> SharedResource { Arc::clone(&self.resources) }
    pub fn own<P: Tree>(&self, process: P) -> Custody<P, SharedResource> { Custody::new(process, self.retain()) }
    /// Inspect only AFTER the synchronous operation has returned. During an active
    /// operation a normal child also retains resources; that is not an error.
    pub fn has_retained_users(&self) -> bool { Arc::strong_count(&self.resources) > 1 }
}
pub struct OnRelease(Option<Box<dyn FnOnce() + Send + Sync>>);
impl OnRelease { pub fn new(f: impl FnOnce() + Send + Sync + 'static) -> Self { Self(Some(Box::new(f))) } }
impl Drop for OnRelease { fn drop(&mut self) { if let Some(f) = self.0.take() { f(); } } }

#[cfg(test)]mod tests {
 use super::*;use std::{sync::{Mutex,atomic::{AtomicBool,Ordering}},time::{Duration,Instant}};
 struct P(Arc<AtomicBool>);impl Tree for P {fn confirm_stopped(&self)->Result<(),String>{if self.0.load(Ordering::SeqCst){Ok(())}else{Err("injected unconfirmed stop".into())}}}
 fn until(mut f:impl FnMut()->bool){let end=Instant::now()+Duration::from_secs(5);while !f(){assert!(Instant::now()<end);std::thread::sleep(Duration::from_millis(10));}}
 fn scope()->(Scope,Arc<AtomicBool>){let finished=Arc::new(AtomicBool::new(false));let flag=finished.clone();(Scope::new(OnRelease::new(move||flag.store(true,Ordering::SeqCst))),finished)}
 #[test]fn normal_scope_finishes_once_without_children(){let(s,f)=scope();assert!(!s.has_retained_users());drop(s);assert!(f.load(Ordering::SeqCst));}
 #[test]fn confirmed_child_does_not_hold_completion(){let(s,f)=scope();let c=s.own(P(Arc::new(AtomicBool::new(true))));assert!(s.has_retained_users());drop(c);assert!(!s.has_retained_users());assert!(!f.load(Ordering::SeqCst));drop(s);assert!(f.load(Ordering::SeqCst));}
 #[test]fn unconfirmed_child_retains_completion_after_caller_returns(){let(s,f)=scope();let gate=Arc::new(AtomicBool::new(false));drop(s.own(P(gate.clone())));assert!(s.has_retained_users());drop(s);assert!(!f.load(Ordering::SeqCst));gate.store(true,Ordering::SeqCst);until(||f.load(Ordering::SeqCst));}
 #[test]fn nested_scratch_scope_delays_outer_completion(){let(s,f)=scope();let order=Arc::new(Mutex::new(Vec::new()));let o=order.clone();let work=Scope::new((OnRelease::new(move||o.lock().unwrap().push("scratch")),s.retain()));let gate=Arc::new(AtomicBool::new(false));drop(work.own(P(gate.clone())));drop(work);drop(s);assert!(order.lock().unwrap().is_empty());assert!(!f.load(Ordering::SeqCst));gate.store(true,Ordering::SeqCst);until(||f.load(Ordering::SeqCst));assert_eq!(*order.lock().unwrap(),["scratch"]);}
 #[test]fn last_of_two_children_controls_completion(){let(s,f)=scope();let a=Arc::new(AtomicBool::new(false));let b=Arc::new(AtomicBool::new(false));drop(s.own(P(a.clone())));drop(s.own(P(b.clone())));drop(s);a.store(true,Ordering::SeqCst);std::thread::sleep(Duration::from_millis(550));assert!(!f.load(Ordering::SeqCst));b.store(true,Ordering::SeqCst);until(||f.load(Ordering::SeqCst));}
 #[test]fn independent_scope_can_finish_while_other_is_retained(){let(a,af)=scope();let(b,bf)=scope();let gate=Arc::new(AtomicBool::new(false));drop(a.own(P(gate.clone())));drop(a);drop(b);assert!(bf.load(Ordering::SeqCst));assert!(!af.load(Ordering::SeqCst));gate.store(true,Ordering::SeqCst);until(||af.load(Ordering::SeqCst));}
}
