//! Explicit opt-in Rust launcher for the recovery observer. No PATH discovery,
//! service, PID reopening, global flags, or default feature activation.
//! Only used by OwnedProcess's single-root creation path. Persistent journal
//! admission and simultaneous host/observer loss recovery are NOT implemented here.
use super::{
    error, quote, wide, Accounting, Attributes, CreateProcessW, DuplicateHandle, Handle,
    InitializeProcThreadAttributeList, OwnedHandle, ProcessInfo, QueryInformationJobObject,
    StartupInfoEx, TerminateJobObject, UpdateProcThreadAttribute, WaitForSingleObject,
};
use std::{
    ffi::c_void,
    fs::File,
    io::{Read, Seek, SeekFrom, Write},
    os::windows::io::AsRawHandle,
    path::Path,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};

#[link(name = "kernel32")]
extern "system" {
    fn CreateEventW(security: *const c_void, manual: i32, initial: i32, name: *const u16)
        -> Handle;
    fn SetEvent(event: Handle) -> i32;
    fn TerminateProcess(process: Handle, code: u32) -> i32;
}
/// Caller-provided, verified helper and exclusive receipt. This does NOT discover
/// or trust an executable from environment variables. Leases must be held already.
pub struct Config<'a> {
    pub program: &'a Path,
    pub receipt: &'a File,
    pub activity: &'a str,
    pub leases: &'a [File],
    pub ready_timeout: Duration,
}
fn duplicate(h: Handle, inherit: bool, access: Option<u32>) -> Result<OwnedHandle, String> {
    let mut out = 0;
    if unsafe {
        DuplicateHandle(
            -1,
            h,
            -1,
            &mut out,
            access.unwrap_or(0),
            i32::from(inherit),
            if access.is_some() { 0 } else { 2 },
        )
    } == 0
    {
        return Err(error("Duplicate observer capability"));
    }
    Ok(OwnedHandle(out))
}
fn event() -> Result<OwnedHandle, String> {
    let h = unsafe { CreateEventW(std::ptr::null(), 1, 0, std::ptr::null()) };
    if h == 0 {
        return Err(error("Create observer event"));
    }
    Ok(OwnedHandle(h))
}
fn signalled(h: Handle) -> Result<bool, String> {
    match unsafe { WaitForSingleObject(h, 0) } {
        0 => Ok(true),
        258 => Ok(false),
        _ => Err(error("Observe owned handle")),
    }
}
fn empty(job: Handle) -> Result<bool, String> {
    let mut a = Accounting::default();
    if unsafe {
        QueryInformationJobObject(
            job,
            1,
            (&mut a as *mut Accounting).cast(),
            std::mem::size_of::<Accounting>() as u32,
            std::ptr::null_mut(),
        )
    } == 0
    {
        return Err(error("Query observer Job"));
    }
    Ok(a.active_processes == 0)
}
impl Attributes {
    fn inherit_only(handles: &mut [Handle]) -> Result<Self, String> {
        let mut size = 0;
        unsafe {
            InitializeProcThreadAttributeList(std::ptr::null_mut(), 1, 0, &mut size);
        }
        if size == 0 || size > 1024 * 1024 {
            return Err("Invalid observer attribute size".into());
        }
        let mut words =
            vec![0usize; (size + std::mem::size_of::<usize>() - 1) / std::mem::size_of::<usize>()];
        if unsafe { InitializeProcThreadAttributeList(words.as_mut_ptr().cast(), 1, 0, &mut size) }
            == 0
        {
            return Err(error("Create observer attributes"));
        }
        let mut list = Self { words };
        if unsafe {
            UpdateProcThreadAttribute(
                list.ptr(),
                0,
                0x20002,
                handles.as_mut_ptr().cast(),
                std::mem::size_of_val(handles),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        } == 0
        {
            return Err(error("Observer HANDLE_LIST"));
        }
        Ok(list)
    }
}
// Keep exact Job + resource object handles even if the caller drops after an
// unconfirmed stop. The observer itself has independent duplicates of both.
struct Bundle {
    process: OwnedHandle,
    job: OwnedHandle,
    stop: OwnedHandle,
    _done: OwnedHandle,
    receipt: Mutex<File>,
    token: String,
    _leases: Vec<File>,
}
impl Bundle {
    fn poll_closed(&self) -> Result<bool, String> {
        // Single-root admission is closed: this is only called after creation
        // returned/failed, never while another thread may add a root to the Job.
        if !signalled(self.process.0)? {
            if unsafe { SetEvent(self.stop.0) } == 0 {
                return Err(error("Request observer stop"));
            }
            return Ok(false);
        }
        if !empty(self.job.0)? {
            if unsafe { TerminateJobObject(self.job.0, 0xc000013a) } == 0 {
                return Err(error("Stop tree after observer loss"));
            }
            return Ok(false);
        }
        // Observer has exited and Job is empty. A still-live owner can complete
        // the SAME receipt using its exact Job capability, never by PID/name.
        // No observer writer remains; serialize concurrent host wait/kill calls.
        let expected = format!(
            "{{\"version\":1,\"activity\":\"{}\",\"state\":\"job-empty\"}}\n",
            self.token
        );
        let mut file = self.receipt.lock().unwrap_or_else(|e| e.into_inner());
        file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        (&mut *file)
            .take(1025)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes == expected.as_bytes() {
            return Ok(true);
        }
        // Empty/torn prefix from this exact observer is repairable only with the
        // still-held empty Job. Unknown/foreign content is never overwritten.
        if !expected.as_bytes().starts_with(&bytes) {
            return Err("Observer receipt identity/content mismatch; resources retained".into());
        }
        file.seek(SeekFrom::Start(0))
            .and_then(|_| file.write_all(expected.as_bytes()))
            .and_then(|_| file.set_len(expected.len() as u64))
            .and_then(|_| file.sync_all())
            .map_err(|e| format!("Cannot persist Job completion; resources retained: {e}"))?;
        Ok(true)
    }
}
pub(super) struct Session {
    bundle: Option<Arc<Bundle>>,
}
impl Session {
    pub(super) fn start(job: Handle, config: &Config<'_>) -> Result<Self, String> {
        if !config.program.is_absolute()
            || !config.program.is_file()
            || config.leases.is_empty()
            || config.leases.len() > 64
            || config.activity.len() != 32
            || !config.activity.bytes().all(|b| b.is_ascii_hexdigit())
            || config.ready_timeout.is_zero()
            || config.ready_timeout > Duration::from_secs(10)
        {
            return Err("Invalid explicit observer configuration".into());
        }
        let meta = config.receipt.metadata().map_err(|e| e.to_string())?;
        if !meta.is_file() || meta.len() != 0 {
            return Err("Observer requires a new empty disk receipt".into());
        }
        if !empty(job)? {
            return Err("Observer must be ready before any worker exists".into());
        }
        let mut receipt = config.receipt.try_clone().map_err(|e| e.to_string())?;
        // A write-only File::create would let the observer write but prevent the
        // host from verifying/recovering completion. Reject both missing rights
        // BEFORE starting the observer or any worker. The receipt is empty here.
        receipt
            .seek(SeekFrom::Start(0))
            .map_err(|e| format!("Receipt must be seekable: {e}"))?;
        let mut byte = [0u8; 1];
        if receipt
            .read(&mut byte)
            .map_err(|e| format!("Receipt must be readable: {e}"))?
            != 0
        {
            return Err("Receipt changed before admission".into());
        }
        receipt
            .set_len(0)
            .and_then(|_| receipt.sync_all())
            .map_err(|e| format!("Receipt must be writable and flushable: {e}"))?;
        let leases = config
            .leases
            .iter()
            .map(|f| {
                if !f.metadata().map_err(|e| e.to_string())?.is_file() {
                    return Err("Observer lease is not a disk file".into());
                }
                f.try_clone().map_err(|e| e.to_string())
            })
            .collect::<Result<Vec<_>, String>>()?;
        let held_job = duplicate(job, false, Some(0x000c))?; // QUERY | TERMINATE, no assignment capability.
        let ready = event()?;
        let stop = event()?;
        let done = event()?;
        let mut inherited = vec![
            duplicate(-1, true, Some(0x101000))?,
            duplicate(job, true, Some(0x000c))?,
            duplicate(ready.0, true, None)?,
            duplicate(stop.0, true, None)?,
            duplicate(done.0, true, None)?,
            duplicate(receipt.as_raw_handle() as Handle, true, None)?,
        ];
        for f in &leases {
            inherited.push(duplicate(f.as_raw_handle() as Handle, true, None)?);
        }
        let mut args = inherited[..6]
            .iter()
            .map(|h| h.0.to_string())
            .collect::<Vec<_>>();
        args.push(
            inherited[6..]
                .iter()
                .map(|h| h.0.to_string())
                .collect::<Vec<_>>()
                .join(","),
        );
        args.push(config.activity.to_string());
        let text = config.program.to_str().ok_or("Non-Unicode observer path")?;
        let mut parts = vec![quote(text)?];
        for a in args {
            parts.push(quote(&a)?);
        }
        let mut command = wide(std::ffi::OsStr::new(&parts.join(" ")))?;
        if command.len() > 32767 {
            return Err("Observer command exceeds Windows limit".into());
        }
        let application = wide(config.program.as_os_str())?;
        let cwd = wide(
            config
                .program
                .parent()
                .ok_or("Observer has no parent")?
                .as_os_str(),
        )?;
        let mut raws = inherited.iter().map(|h| h.0).collect::<Vec<_>>();
        let mut attr = Attributes::inherit_only(&mut raws)?;
        let mut si: StartupInfoEx = unsafe { std::mem::zeroed() };
        si.startup.cb = std::mem::size_of::<StartupInfoEx>() as u32;
        si.attributes = attr.ptr();
        let mut pi = ProcessInfo::default();
        // NO JOB_LIST for observer: putting it in the worker Job would kill the guardian.
        if unsafe {
            CreateProcessW(
                application.as_ptr(),
                command.as_mut_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                1,
                0x08000000 | 0x00080000,
                std::ptr::null(),
                cwd.as_ptr(),
                &si.startup,
                &mut pi,
            )
        } == 0
        {
            return Err(error("Create independent observer"));
        }
        let _thread = OwnedHandle(pi.thread);
        let session = Self {
            bundle: Some(Arc::new(Bundle {
                process: OwnedHandle(pi.process),
                job: held_job,
                stop,
                _done: done,
                receipt: Mutex::new(receipt),
                token: config.activity.to_string(),
                _leases: leases,
            })),
        };
        drop(inherited);
        let end = Instant::now() + config.ready_timeout;
        let ready_result = (|| loop {
            session.ensure_alive()?;
            if signalled(ready.0)? {
                return Ok(());
            }
            if Instant::now() >= end {
                return Err("Observer READY timed out; worker was not launched".into());
            }
            std::thread::sleep(Duration::from_millis(10));
        })();
        if let Err(e) = ready_result {
            // No worker has been created; stop only the exact child we own.
            unsafe {
                TerminateProcess(session.bundle.as_ref().unwrap().process.0, 2);
            }
            return Err(e); // Session Drop keeps capabilities until verified cleanup.
        }
        Ok(session)
    }
    pub(super) fn ensure_alive(&self) -> Result<(), String> {
        if signalled(self.bundle.as_ref().unwrap().process.0)? {
            Err("Observer exited unexpectedly; task must stop".into())
        } else {
            Ok(())
        }
    }
    pub(super) fn poll_closed(&self) -> Result<bool, String> {
        self.bundle.as_ref().unwrap().poll_closed()
    }
    #[cfg(test)]
    pub(super) fn stop_observer_for_test(&self) -> Result<(), String> {
        let h = self.bundle.as_ref().unwrap().process.0;
        if unsafe { TerminateProcess(h, 77) } == 0 {
            return Err(error("Injected observer exit"));
        }
        if unsafe { WaitForSingleObject(h, 1000) } != 0 {
            return Err(error("Wait injected observer exit"));
        }
        Ok(())
    }
}
impl Drop for Session {
    fn drop(&mut self) {
        let Some(b) = self.bundle.take() else {
            return;
        };
        if matches!(b.poll_closed(), Ok(true)) {
            return;
        }
        let retained = Arc::clone(&b);
        let spawn = std::thread::Builder::new()
            .name("observer-custody".into())
            .spawn(move || {
                while !matches!(retained.poll_closed(), Ok(true)) {
                    std::thread::sleep(Duration::from_millis(100));
                }
            });
        if spawn.is_err() {
            std::mem::forget(b);
        } // Never release uncertain resources on thread creation failure.
    }
}
