//! Keep resources with an owned process tree until termination is CONFIRMED.
//! This is in-process custody, not an owner-death journal or crash isolation.
//! The resource must already be held before spawn; wrap immediately after spawn.
use std::{ops::Deref, sync::{Arc, Mutex}, time::Duration};

pub type SharedResource = Arc<dyn Send + Sync>;
const STOP_BUDGET: Duration = Duration::from_secs(5);
const RETRY_DELAY: Duration = Duration::from_millis(250);

/// Ok means the entire tree is empty and the root has signalled, not root exit alone.
/// Implementations must not panic; release builds abort rather than isolate panics.
pub(crate) trait Tree: Send + 'static {
    fn confirm_stopped(&self) -> Result<(), String>;
}
impl Tree for crate::download_process::OwnedProcess {
    fn confirm_stopped(&self) -> Result<(), String> { self.terminate(STOP_BUDGET) }
}
// Declaration order is intentional: release process handles BEFORE resources.
struct Bundle<P, G> { process: P, _resources: G }
type Held<P, G> = Arc<Mutex<Option<Bundle<P, G>>>>;
type Task = Box<dyn FnOnce() + Send + 'static>;

pub(crate) struct Custody<P: Tree, G: Send + 'static> { inner: Option<Bundle<P, G>> }
impl<P: Tree, G: Send + 'static> Custody<P, G> {
    pub fn new(process: P, resources: G) -> Self { Self { inner: Some(Bundle { process, _resources: resources }) } }
    /// Required before retrying another mirror, renaming partial output or reporting stop.
    /// Failure does NOT relinquish custody. Drop will retain the tree and resources.
    pub fn confirm_stopped(&self) -> Result<(), String> { self.deref().confirm_stopped() }
    /// Outer Err means exit is unconfirmed: callers must abort the entire operation.
    /// Inner Err is an ordinary, confirmed-exited attempt failure and may be retried.
    pub fn after_exit<T>(&self, outcome: Result<T, String>) -> Result<Result<T, String>, String> {
        self.confirm_stopped().map_err(|e| format!("辅助进程尚未确认退出，组件资源仍保留 / Process-tree exit unconfirmed; resources retained: {e}"))?;
        Ok(outcome)
    }
}
impl<P: Tree, G: Send + 'static> Deref for Custody<P, G> {
    type Target = P;
    fn deref(&self) -> &P { &self.inner.as_ref().expect("live custody").process }
}
fn handoff<P: Tree, G: Send + 'static>(bundle: Bundle<P, G>, spawn: impl FnOnce(Task) -> std::io::Result<()>) -> Result<(), Held<P, G>> {
    let held = Arc::new(Mutex::new(Some(bundle)));
    let worker = Arc::clone(&held);
    let task: Task = Box::new(move || {
        let bundle = worker.lock().unwrap_or_else(|e| e.into_inner()).take();
        if let Some(bundle) = bundle {
            // No mutex is held during OS waits. Never infer success from elapsed time.
            while bundle.process.confirm_stopped().is_err() { std::thread::sleep(RETRY_DELAY); }
            drop(bundle);
        }
    });
    if spawn(task).is_err() { Err(held) } else { Ok(()) }
}
impl<P: Tree, G: Send + 'static> Drop for Custody<P, G> {
    fn drop(&mut self) {
        let Some(bundle) = self.inner.take() else { return; };
        if bundle.process.confirm_stopped().is_ok() { drop(bundle); return; }
        let result = handoff(bundle, |task| std::thread::Builder::new().name("resource-custody".into()).spawn(task).map(|_| ()));
        if let Err(stranded) = result {
            // Thread creation failed: retaining until host exit is safer than dropping
            // an unconfirmed tree's lease. No unsafe pointers, no unlocked fallback.
            // Closing the host still invokes its Job kill-on-close OS guarantee.
            std::mem::forget(stranded);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
    use std::time::Instant;
    struct Process { ready: Arc<AtomicBool>, calls: Arc<AtomicUsize>, order: Arc<Mutex<Vec<&'static str>>> }
    impl Tree for Process {
        fn confirm_stopped(&self) -> Result<(), String> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            if self.ready.load(Ordering::SeqCst) { Ok(()) } else { Err("injected unconfirmed stop".into()) }
        }
    }
    impl Drop for Process { fn drop(&mut self) { self.order.lock().unwrap().push("process"); } }
    struct Guard(Arc<Mutex<Vec<&'static str>>>);
    impl Drop for Guard { fn drop(&mut self) { self.0.lock().unwrap().push("resource"); } }
    fn fixture(ready: bool) -> (Custody<Process, Guard>, Arc<AtomicBool>, Arc<AtomicUsize>, Arc<Mutex<Vec<&'static str>>>) {
        let ready=Arc::new(AtomicBool::new(ready)); let calls=Arc::new(AtomicUsize::new(0)); let order=Arc::new(Mutex::new(Vec::new()));
        (Custody::new(Process { ready: ready.clone(), calls: calls.clone(), order: order.clone() }, Guard(order.clone())),ready,calls,order)
    }
    fn until(mut f: impl FnMut() -> bool) { let end=Instant::now()+Duration::from_secs(5); while !f() { assert!(Instant::now()<end); std::thread::sleep(Duration::from_millis(10)); } }
    #[test] fn confirmed_drop_orders_tree_before_guard() { let(c,_,calls,order)=fixture(true);drop(c);assert_eq!(*order.lock().unwrap(),["process","resource"]);assert_eq!(calls.load(Ordering::SeqCst),1); }
    #[test] fn explicit_failed_confirmation_does_not_release() { let(c,gate,_,order)=fixture(false);assert!(c.confirm_stopped().is_err());assert!(order.lock().unwrap().is_empty());gate.store(true,Ordering::SeqCst);drop(c);assert_eq!(*order.lock().unwrap(),["process","resource"]); }
    #[test] fn repeated_failure_retains_until_confirmation() { let(c,gate,calls,order)=fixture(false);drop(c);until(||calls.load(Ordering::SeqCst)>=3);assert!(order.lock().unwrap().is_empty());gate.store(true,Ordering::SeqCst);until(||order.lock().unwrap().len()==2);assert_eq!(*order.lock().unwrap(),["process","resource"]); }
    #[test] fn independent_custody_cannot_release_failed_tree() { let(a,gate,_,order)=fixture(false);let(b,_,_,other)=fixture(true);drop(a);drop(b);assert_eq!(other.lock().unwrap().len(),2);assert!(order.lock().unwrap().is_empty());gate.store(true,Ordering::SeqCst);until(||order.lock().unwrap().len()==2); }
    #[test] fn rejected_thread_creation_returns_resources_still_held() {
        let(mut c,gate,_,order)=fixture(false);let held=handoff(c.inner.take().unwrap(),|_|Err(std::io::Error::other("injected thread creation failure"))).err().unwrap();drop(c);assert!(order.lock().unwrap().is_empty());
        // Production forgets this held Arc. Test recovers it after confirmation so no
        // process, lease or deliberately stranded allocation escapes the test.
        gate.store(true,Ordering::SeqCst);let bundle=held.lock().unwrap().take().unwrap();bundle.process.confirm_stopped().unwrap();drop(bundle);assert_eq!(*order.lock().unwrap(),["process","resource"]);
    }
    #[test] fn confirmed_operation_result_is_preserved() {
        let(c,_,_,_)=fixture(true);assert_eq!(c.after_exit(Ok(17)),Ok(Ok(17)));
    }
    #[test] fn ordinary_failure_may_retry_only_after_confirmation() {
        let(c,_,_,_)=fixture(true);assert_eq!(c.after_exit::<()>(Err("mirror failed".into())),Ok(Err("mirror failed".into())));
    }
    #[test] fn unknown_exit_prevents_retry_and_publication_callback() {
        let(c,gate,_,order)=fixture(false);let mut retry=false;
        let result=(||->Result<(),String>{let attempt=c.after_exit::<()>(Err("mirror failed".into()))?;if attempt.is_err(){retry=true;}Ok(())})();
        assert!(result.unwrap_err().contains("exit unconfirmed"));assert!(!retry);assert!(order.lock().unwrap().is_empty());gate.store(true,Ordering::SeqCst);drop(c);
    }
    #[test] fn accepted_handoff_executes_once() {
        let(mut c,_,calls,order)=fixture(true);assert!(handoff(c.inner.take().unwrap(),|task|{task();Ok(())}).is_ok());drop(c);assert_eq!(calls.load(Ordering::SeqCst),1);assert_eq!(*order.lock().unwrap(),["process","resource"]);
    }
}
