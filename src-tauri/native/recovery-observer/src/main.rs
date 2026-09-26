//! Handle-only Windows process-tree observer, not a service or PID-based killer.
//! Prototype helper: production admission/restart integration is deliberately absent.
#![cfg_attr(windows, windows_subsystem = "windows")]
#[cfg(not(windows))]
fn main() {
    eprintln!("Windows required");
    std::process::exit(2);
}
#[cfg(windows)]
mod win {
    use std::{
        collections::HashSet,
        ffi::c_void,
        fs::File,
        io::{Seek, SeekFrom, Write},
        os::windows::io::{FromRawHandle, RawHandle},
        time::Duration,
    };
    type Handle = isize;
    #[repr(C)]
    #[derive(Default)]
    struct Accounting {
        times: [i64; 4],
        faults: u32,
        total: u32,
        active: u32,
        terminated: u32,
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn QueryInformationJobObject(
            job: Handle,
            class: i32,
            info: *mut c_void,
            len: u32,
            returned: *mut u32,
        ) -> i32;
        fn TerminateJobObject(job: Handle, code: u32) -> i32;
        fn WaitForSingleObject(handle: Handle, ms: u32) -> u32;
        fn SetEvent(handle: Handle) -> i32;
        fn ResetEvent(handle: Handle) -> i32;
        fn CloseHandle(handle: Handle) -> i32;
        fn GetProcessId(handle: Handle) -> u32;
        fn GetCurrentProcessId() -> u32;
        fn GetFileType(handle: Handle) -> u32;
        fn GetHandleInformation(handle: Handle, flags: *mut u32) -> i32;
        fn SetHandleInformation(handle: Handle, mask: u32, flags: u32) -> i32;
    }
    struct Owned(Handle);
    impl Drop for Owned {
        fn drop(&mut self) {
            unsafe {
                CloseHandle(self.0);
            }
        }
    }
    fn err(label: &str) -> String {
        format!("{label}: {}", std::io::Error::last_os_error())
    }
    fn active(job: Handle) -> Result<u32, String> {
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
            return Err(err("Query Job"));
        }
        Ok(a.active)
    }
    fn signalled(h: Handle) -> Result<bool, String> {
        match unsafe { WaitForSingleObject(h, 0) } {
            0 => Ok(true),
            258 => Ok(false),
            _ => Err(err("Wait handle")),
        }
    }
    fn event(h: Handle) -> Result<(), String> {
        // Validate event object type; none is allowed to start signalled.
        if signalled(h)? {
            return Err("Event must initially be nonsignalled".into());
        }
        if unsafe { ResetEvent(h) } == 0 {
            return Err(err("Validate event"));
        }
        Ok(())
    }
    pub fn run() -> Result<(), String> {
        let args: Vec<_> = std::env::args().skip(1).collect();
        // owner/job/ready/stop/done/receipt/lease-handle-list/activity-token
        if args.len() != 8 {
            return Err("Expected eight inherited-handle protocol arguments".into());
        }
        let token = &args[7];
        if token.len() != 32 || !token.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err("Invalid activity token".into());
        }
        let mut raw: Vec<Handle> = args[..6]
            .iter()
            .map(|a| {
                a.parse::<Handle>()
                    .map_err(|_| "Invalid handle".to_string())
            })
            .collect::<Result<_, _>>()?;
        let leases: Vec<Handle> = args[6]
            .split(',')
            .map(|a| {
                a.parse::<Handle>()
                    .map_err(|_| "Invalid lease handle".to_string())
            })
            .collect::<Result<_, _>>()?;
        if leases.is_empty() || leases.len() > 64 {
            return Err("Invalid lease count".into());
        }
        raw.extend(leases);
        let mut unique = HashSet::new();
        if raw.iter().any(|h| *h <= 0 || !unique.insert(*h)) {
            return Err("Invalid or duplicate inherited handles".into());
        }
        // After structural validation, own exactly the supplied handles and prevent
        // further inheritance. The observer never creates child processes.
        let handles: Vec<Owned> = raw.into_iter().map(Owned).collect();
        for h in &handles {
            let mut flags = 0;
            if unsafe { GetHandleInformation(h.0, &mut flags) } == 0 {
                return Err(err("Invalid inherited handle"));
            }
            if unsafe { SetHandleInformation(h.0, 1, 0) } == 0 {
                return Err(err("Clear inheritance"));
            }
        }
        let owner = handles[0].0;
        let job = handles[1].0;
        let ready = handles[2].0;
        let stop = handles[3].0;
        let done = handles[4].0;
        let pid = unsafe { GetProcessId(owner) };
        if pid == 0 || pid == unsafe { GetCurrentProcessId() } {
            return Err("Invalid owner process handle".into());
        }
        // Query permission is not enough: the owner capability must also be waitable.
        signalled(owner)?;
        // Before READY the registered Job MUST be empty. Host must wait for READY
        // before atomically launching any worker into it.
        if active(job)? != 0 {
            return Err("Job must be empty before observer readiness".into());
        }
        event(ready)?;
        event(stop)?;
        event(done)?;
        if handles[5..]
            .iter()
            .any(|h| unsafe { GetFileType(h.0) } != 1)
        {
            return Err("Receipt and lease handles must be disk files".into());
        }
        // Move receipt ownership to File; remaining guards retain Job + leases.
        let mut handles = handles;
        let receipt_raw = handles.remove(5);
        let mut receipt = unsafe { File::from_raw_handle(receipt_raw.0 as RawHandle) };
        std::mem::forget(receipt_raw);
        if receipt.metadata().map_err(|e| e.to_string())?.len() != 0 {
            return Err("Receipt must be new and empty".into());
        }
        if unsafe { SetEvent(ready) } == 0 {
            return Err(err("Publish ready"));
        }
        // No exit/RAII release on an uncertain observation after READY. Keep the
        // exact borrowed resource objects alive, retrying rather than guessing.
        let mut stopping = false;
        loop {
            if !stopping {
                match (signalled(owner), signalled(stop)) {
                    (Ok(true), _) | (_, Ok(true)) => stopping = true,
                    (Ok(false), Ok(false)) => (),
                    _ => {
                        // A failed wait does NOT prove admission closed. Stop the
                        // existing tree defensively, but keep all resources and do
                        // NOT emit a receipt until a real owner/STOP signal arrives.
                        unsafe {
                            TerminateJobObject(job, 0xc000013a);
                        }
                        std::thread::sleep(Duration::from_millis(25));
                        continue;
                    }
                }
            }
            if stopping {
                // Caller must close spawn admission BEFORE requesting stop. Owner
                // death itself closes admission; root exit alone does not trigger it.
                unsafe {
                    TerminateJobObject(job, 0xc000013a);
                }
                if matches!(active(job), Ok(0)) {
                    let proof = format!(
                        "{{\"version\":1,\"activity\":\"{token}\",\"state\":\"job-empty\"}}\n"
                    );
                    let written = receipt
                        .seek(SeekFrom::Start(0))
                        .and_then(|_| receipt.write_all(proof.as_bytes()))
                        .and_then(|_| receipt.set_len(proof.len() as u64))
                        .and_then(|_| receipt.sync_all());
                    // The preopened receipt is flushed BEFORE DONE and lease drop.
                    // A torn/empty receipt is NOT evidence of completion.
                    if written.is_ok() && unsafe { SetEvent(done) } != 0 {
                        return Ok(());
                    }
                }
            }
            std::thread::sleep(Duration::from_millis(25));
        }
    }
}
#[cfg(windows)]
fn main() {
    if let Err(e) = win::run() {
        eprintln!("{e}");
        std::process::exit(2);
    }
}
