//! Opt-in whole-attempt custody. No raw process/reservation escape hatch.
//! Caller supplies verified helper and real task/scratch guards. Guard Drop remains
//! in-process only; this does not recover scratch after owner death or migrate v1.
use super::{Mode, Record, Reservation};
use crate::{
    download_process::{LaunchFailure, ObservedStdio, ObserverConfig, OwnedProcess},
    resource_custody::{Custody, Tree},
};
use std::{
    fs,
    path::{Path, PathBuf},
    sync::atomic::{AtomicBool, Ordering},
    time::Duration,
};

pub(crate) struct Launch<'a> {
    pub namespace: &'a Path,
    pub resources: &'a [&'a str],
    pub mode: Mode,
    pub helper: &'a Path,
    pub program: &'a Path,
    pub args: &'a [String],
    pub cwd: &'a Path,
    pub ready_timeout: Duration,
    pub cancelled: &'a AtomicBool,
    pub stdio: Option<ObservedStdio<'a>>,
}
pub(crate) struct Activity<G: Send + 'static> {
    // Custody drops the process before the reservation and user guards.
    custody: Custody<OwnedProcess, (Reservation, G)>,
    id: String,
}
struct Unlaunched {
    namespace: PathBuf,
    record: Record,
    proof: LaunchFailure,
}
impl Tree for Unlaunched {
    fn confirm_stopped(&self) -> Result<(), String> {
        if self.proof.activity() != self.record.activity {
            return Err("Unlaunched identity mismatch".into());
        }
        super::namespace(&self.namespace)?;
        let _gate = super::lock(&self.namespace.join("admission-v2.lease"), Mode::Change)?;
        let active = self
            .namespace
            .join(format!("activity-v2-{}.json", self.record.activity));
        let archived = self
            .namespace
            .join(format!("unlaunched-v2-{}.json", self.record.activity));
        match fs::symlink_metadata(&active) {
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                if super::read_record(&archived)? == self.record {
                    return Ok(());
                }
                return Err("Unlaunched archive mismatch; retain custody".into());
            }
            Err(e) => return Err(e.to_string()),
            Ok(_) => (),
        }
        if super::read_record(&active)? != self.record {
            return Err("Unlaunched record changed; retain custody".into());
        }
        // Exact owned record only, no replacement and no generic history recovery.
        // Keep the receipt: an unlaunched observer may still hold/write it. Its
        // lease duplicates still prevent admission until it finishes. Also blocks ID reuse.
        super::super::publish_new(&active, &archived)
    }
}
impl<G: Send + 'static> Activity<G> {
    pub(crate) fn launch(plan: Launch<'_>, guards: G) -> Result<Self, String> {
        Self::launch_inner(plan, guards, None)
    }
    /// Codec policy: one worker process plus a Job committed-memory cap. This is
    /// not an RSS or whole-application memory limit. Existing launch stays unlimited.
    pub(crate) fn launch_bounded(
        plan: Launch<'_>,
        guards: G,
        memory: usize,
    ) -> Result<Self, String> {
        Self::launch_inner(plan, guards, Some(memory))
    }
    fn launch_inner(plan: Launch<'_>, guards: G, memory: Option<usize>) -> Result<Self, String> {
        if plan.cancelled.load(Ordering::SeqCst) {
            return Err("Cancelled before reservation".into());
        }
        let reservation = super::reserve(plan.namespace, plan.resources, plan.mode)?;
        let config = ObserverConfig {
            program: plan.helper,
            receipt: &reservation.receipt,
            activity: &reservation.record.activity,
            leases: &reservation.leases,
            ready_timeout: plan.ready_timeout,
        };
        let result = OwnedProcess::spawn_observed_attempt_with_memory(
            plan.program,
            plan.args,
            plan.cwd,
            &config,
            plan.cancelled,
            plan.stdio,
            memory,
        );
        match result {
            Ok(process) => {
                let id = reservation.record.activity.clone();
                let owned = Self {
                    custody: Custody::new(process, (reservation, guards)),
                    id,
                };
                // A cancellation racing successful creation MUST use actual tree
                // confirmation, never the unlaunched archive path.
                if plan.cancelled.load(Ordering::SeqCst) {
                    owned.cancel(Duration::from_secs(5))?;
                    return Err("Cancelled after launch; tree confirmed stopped".into());
                }
                Ok(owned)
            }
            Err(proof) => {
                let original = proof.message().to_owned();
                let pending = Unlaunched {
                    namespace: plan.namespace.to_owned(),
                    record: reservation.record.clone(),
                    proof,
                };
                let custody = Custody::new(pending, (reservation, guards));
                let archived = custody.confirm_stopped();
                // If the gate or I/O is unavailable, Custody retains ALL guards
                // and retries. Thread creation failure deliberately retains them.
                drop(custody);
                match archived {
                    Ok(()) => Err(original),
                    Err(e) => Err(format!(
                        "{original}; unlaunched settlement pending, resources retained: {e}"
                    )),
                }
            }
        }
    }
    pub(crate) fn activity(&self) -> &str {
        &self.id
    }
    pub(crate) fn try_exit(&self) -> Result<Option<u32>, String> {
        self.custody.try_exit()
    }
    pub(crate) fn cancel(&self, budget: Duration) -> Result<(), String> {
        self.custody.terminate(budget)
    }
    #[cfg(test)]
    pub(crate) fn job_policy_for_test(&self) -> Result<(u32, u32, usize), String> {
        self.custody.job_policy_for_test()
    }
    #[cfg(test)]
    pub(crate) fn stop_observer_for_test(&self) -> Result<(), String> {
        self.custody.stop_observer_for_test()
    }
}
