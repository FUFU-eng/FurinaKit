//! Windows 10+ owned process tree. A Job List attribute assigns the kill-on-close job
//! AT process creation, avoiding spawn-then-assign and suspended-orphan race windows.
//! No PID-based taskkill, inherited application handles, shell expansion, or breakaway permission.
//! Only three explicit stdio handles are inherited; default calls retain independent NUL streams.
use std::{
    ffi::c_void,
    path::Path,
    time::{Duration, Instant},
};
#[path = "observer_client.rs"]
mod observer_client;
pub use observer_client::Config as ObserverConfig;
type Handle = isize;
#[repr(C)]
struct SecurityAttributes {
    length: u32,
    descriptor: *mut c_void,
    inherit: i32,
}
#[repr(C)]
#[derive(Default)]
struct BasicLimits {
    process_time: i64,
    job_time: i64,
    flags: u32,
    min_working_set: usize,
    max_working_set: usize,
    active_processes: u32,
    affinity: usize,
    priority: u32,
    scheduling: u32,
}
#[repr(C)]
#[derive(Default)]
struct IoCounters {
    read_ops: u64,
    write_ops: u64,
    other_ops: u64,
    read_bytes: u64,
    write_bytes: u64,
    other_bytes: u64,
}
#[repr(C)]
#[derive(Default)]
struct ExtendedLimits {
    basic: BasicLimits,
    io: IoCounters,
    process_memory: usize,
    job_memory: usize,
    peak_process_memory: usize,
    peak_job_memory: usize,
}
#[repr(C)]
#[derive(Default)]
struct Accounting {
    user_time: i64,
    kernel_time: i64,
    period_user_time: i64,
    period_kernel_time: i64,
    page_faults: u32,
    total_processes: u32,
    active_processes: u32,
    terminated_processes: u32,
}
#[repr(C)]
struct StartupInfo {
    cb: u32,
    reserved: *mut u16,
    desktop: *mut u16,
    title: *mut u16,
    x: u32,
    y: u32,
    x_size: u32,
    y_size: u32,
    x_chars: u32,
    y_chars: u32,
    fill: u32,
    flags: u32,
    show: u16,
    reserved_size: u16,
    reserved2: *mut u8,
    stdin: Handle,
    stdout: Handle,
    stderr: Handle,
}
#[repr(C)]
struct StartupInfoEx {
    startup: StartupInfo,
    attributes: *mut c_void,
}
#[repr(C)]
#[derive(Default)]
struct ProcessInfo {
    process: Handle,
    thread: Handle,
    pid: u32,
    tid: u32,
}
#[link(name = "kernel32")]
extern "system" {
    fn DuplicateHandle(
        source_process: Handle,
        source: Handle,
        target_process: Handle,
        target: *mut Handle,
        access: u32,
        inherit: i32,
        options: u32,
    ) -> i32;
    fn CreateFileW(
        path: *const u16,
        access: u32,
        share: u32,
        security: *const c_void,
        disposition: u32,
        flags: u32,
        template: Handle,
    ) -> Handle;
    fn CreateJobObjectW(attributes: *const c_void, name: *const u16) -> Handle;
    fn SetInformationJobObject(job: Handle, class: i32, info: *const c_void, size: u32) -> i32;
    fn QueryInformationJobObject(
        job: Handle,
        class: i32,
        info: *mut c_void,
        size: u32,
        returned: *mut u32,
    ) -> i32;
    fn TerminateJobObject(job: Handle, code: u32) -> i32;
    fn CloseHandle(handle: Handle) -> i32;
    fn InitializeProcThreadAttributeList(
        list: *mut c_void,
        count: u32,
        flags: u32,
        size: *mut usize,
    ) -> i32;
    fn UpdateProcThreadAttribute(
        list: *mut c_void,
        flags: u32,
        attribute: usize,
        value: *mut c_void,
        size: usize,
        previous: *mut c_void,
        returned: *mut usize,
    ) -> i32;
    fn DeleteProcThreadAttributeList(list: *mut c_void);
    fn CreateProcessW(
        application: *const u16,
        command: *mut u16,
        process_security: *const c_void,
        thread_security: *const c_void,
        inherit: i32,
        flags: u32,
        environment: *const c_void,
        cwd: *const u16,
        startup: *const StartupInfo,
        info: *mut ProcessInfo,
    ) -> i32;
    fn GetExitCodeProcess(process: Handle, code: *mut u32) -> i32;
    fn WaitForSingleObject(handle: Handle, millis: u32) -> u32;
}
struct OwnedHandle(Handle);
impl Drop for OwnedHandle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}
struct Attributes {
    words: Vec<usize>,
}
impl Attributes {
    fn new(job: &mut Handle, stdio: &mut [Handle; 3]) -> Result<Self, String> {
        let mut size = 0usize;
        unsafe {
            InitializeProcThreadAttributeList(std::ptr::null_mut(), 2, 0, &mut size);
        }
        if size == 0 || size > 1024 * 1024 {
            return Err("Unexpected process attribute-list size".into());
        }
        let mut words =
            vec![0usize; (size + std::mem::size_of::<usize>() - 1) / std::mem::size_of::<usize>()];
        if unsafe { InitializeProcThreadAttributeList(words.as_mut_ptr().cast(), 2, 0, &mut size) }
            == 0
        {
            return Err(error("Initialize job attribute"));
        }
        let mut list = Self { words };
        if unsafe {
            UpdateProcThreadAttribute(
                list.ptr(),
                0,
                0x0002000d,
                job as *mut _ as *mut c_void,
                std::mem::size_of::<Handle>(),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        } == 0
        {
            return Err(error("Set atomic job list (Windows 10+ required)"));
        }
        // PROC_THREAD_ATTRIBUTE_HANDLE_LIST: never inherit unrelated application handles.
        if unsafe {
            UpdateProcThreadAttribute(
                list.ptr(),
                0,
                0x00020002,
                stdio.as_mut_ptr().cast(),
                std::mem::size_of_val(stdio),
                std::ptr::null_mut(),
                std::ptr::null_mut(),
            )
        } == 0
        {
            return Err(error("Set explicit stdio handle list"));
        }
        Ok(list)
    }
    fn ptr(&mut self) -> *mut c_void {
        self.words.as_mut_ptr().cast()
    }
}
impl Drop for Attributes {
    fn drop(&mut self) {
        unsafe {
            DeleteProcThreadAttributeList(self.ptr());
        }
    }
}
fn error(op: &str) -> String {
    format!("{op}: {}", std::io::Error::last_os_error())
}
fn wide(s: &std::ffi::OsStr) -> Result<Vec<u16>, String> {
    use std::os::windows::ffi::OsStrExt;
    let mut w: Vec<u16> = s.encode_wide().collect();
    if w.contains(&0) {
        return Err("NUL in process argument".into());
    }
    w.push(0);
    Ok(w)
}
/// CRT quoting: backslashes preceding a quote or closing delimiter are doubled.
fn quote(arg: &str) -> Result<String, String> {
    if arg.contains('\0') {
        return Err("NUL in process argument".into());
    }
    let mut result = String::from("\"");
    let mut slashes = 0;
    for c in arg.chars() {
        if c == '\\' {
            slashes += 1;
            continue;
        }
        if c == '\"' {
            result.extend(std::iter::repeat('\\').take(slashes * 2 + 1));
        } else {
            result.extend(std::iter::repeat('\\').take(slashes));
        }
        slashes = 0;
        result.push(c);
    }
    result.extend(std::iter::repeat('\\').take(slashes * 2));
    result.push('"');
    Ok(result)
}
/// Windows environment names use ordinal, case-insensitive comparison, not locale folding.
fn env_compare(a: &[u16], b: &[u16]) -> std::cmp::Ordering {
    #[link(name = "kernel32")]
    extern "system" {
        fn CompareStringOrdinal(
            a: *const u16,
            an: i32,
            b: *const u16,
            bn: i32,
            ignore_case: i32,
        ) -> i32;
    }
    match unsafe { CompareStringOrdinal(a.as_ptr(), a.len() as i32, b.as_ptr(), b.len() as i32, 1) }
    {
        1 => std::cmp::Ordering::Less,
        2 => std::cmp::Ordering::Equal,
        3 => std::cmp::Ordering::Greater,
        _ => a.cmp(b),
    }
}
fn environment_block(
    inherited: impl IntoIterator<Item = (std::ffi::OsString, std::ffi::OsString)>,
    overrides: &[(std::ffi::OsString, Option<std::ffi::OsString>)],
) -> Result<Vec<u16>, String> {
    use std::os::windows::ffi::OsStrExt;
    let units = |s: &std::ffi::OsStr| -> Result<Vec<u16>, String> {
        let v: Vec<u16> = s.encode_wide().collect();
        if v.contains(&0) || v.len() > 1_048_576 {
            return Err("Invalid process environment field".into());
        }
        Ok(v)
    };
    let mut vars: Vec<(Vec<u16>, Vec<u16>)> = Vec::new();
    let mut insert = |key: &std::ffi::OsStr,
                      val: Option<&std::ffi::OsStr>,
                      explicit: bool|
     -> Result<(), String> {
        let key = units(key)?;
        if key.is_empty() || (explicit && key.contains(&(b'=' as u16))) {
            return Err("Invalid process environment name".into());
        }
        let value = val.map(units).transpose()?;
        if let Some(i) = vars.iter().position(|(k, _)| env_compare(k, &key).is_eq()) {
            vars.remove(i);
        }
        if let Some(value) = value {
            vars.push((key, value));
        }
        Ok(())
    };
    for (k, v) in inherited {
        insert(&k, Some(&v), false)?;
    }
    for (k, v) in overrides {
        insert(k, v.as_deref(), true)?;
    }
    vars.sort_by(|a, b| env_compare(&a.0, &b.0));
    let mut result = Vec::new();
    for (k, v) in vars {
        result.extend(k);
        result.push(b'=' as u16);
        result.extend(v);
        result.push(0);
        if result.len() > 1_048_576 {
            return Err("Process environment exceeds safe bound".into());
        }
    }
    result.push(0);
    if result.len() == 1 {
        result.push(0);
    }
    Ok(result)
}

/// Borrowed explicit stdio for the whole-attempt launcher. No ownership escapes.
pub(crate) struct ObservedStdio<'a> {
    pub overrides: &'a [(std::ffi::OsString, Option<std::ffi::OsString>)],
    pub stdin: &'a std::fs::File,
    pub stdout: &'a std::fs::File,
    pub stderr: &'a std::fs::File,
}
/// Constructible only by the single-root launch attempt on an Err path. Every
/// fallible operation precedes successful CreateProcessW; after success the path
/// immediately returns OwnedProcess. This is NOT proof for an arbitrary prior Job.
pub(crate) struct LaunchFailure {
    activity: String,
    message: String,
}
impl LaunchFailure {
    pub(crate) fn activity(&self) -> &str {
        &self.activity
    }
    pub(crate) fn message(&self) -> &str {
        &self.message
    }
}
fn validate_codec_memory(memory: Option<usize>) -> Result<(), String> {
    if let Some(bytes) = memory {
        if bytes < 16 * 1024 * 1024 || bytes as u64 > 4 * 1024 * 1024 * 1024 {
            return Err("Invalid codec committed-memory budget".into());
        }
    }
    Ok(())
}

pub struct OwnedProcess {
    process: OwnedHandle,
    job: OwnedHandle,
    pid: u32,
    observer: Option<observer_client::Session>,
}
impl OwnedProcess {
    /// Program/cwd must be absolute. No shell, no executable PATH search.
    pub fn spawn(program: &Path, args: &[String], cwd: &Path) -> Result<Self, String> {
        Self::spawn_inner(program, args, cwd, None, None, None, None)
    }
    /// Optional stricter policy for codec processes: one process and a Job committed-memory cap.
    /// Existing downloader calls retain their original unlimited-memory descendant policy.
    pub fn spawn_bounded(
        program: &Path,
        args: &[String],
        cwd: &Path,
        memory: usize,
    ) -> Result<Self, String> {
        Self::spawn_inner(program, args, cwd, Some(memory), None, None, None)
    }
    /// Inherits environment with case-insensitive overrides/removals; only independent NUL stdio handles are inherited.
    pub fn spawn_with_environment(
        program: &Path,
        args: &[String],
        cwd: &Path,
        overrides: &[(std::ffi::OsString, Option<std::ffi::OsString>)],
    ) -> Result<Self, String> {
        let environment = environment_block(std::env::vars_os(), overrides)?;
        Self::spawn_inner(program, args, cwd, None, Some(&environment), None, None)
    }
    /// Borrowed files stay non-inheritable. Independent temporary duplicates are
    /// inherited ONLY through HANDLE_LIST, with Job membership set at creation.
    pub fn spawn_with_files(
        program: &Path,
        args: &[String],
        cwd: &Path,
        overrides: &[(std::ffi::OsString, Option<std::ffi::OsString>)],
        stdin: &std::fs::File,
        stdout: &std::fs::File,
        stderr: &std::fs::File,
    ) -> Result<Self, String> {
        Self::spawn_with_files_inner(
            program, args, cwd, overrides, stdin, stdout, stderr, None, None,
        )
    }
    /// Explicit observed variant preserving the original File stdio/environment contract.
    pub fn spawn_observed_with_files(
        program: &Path,
        args: &[String],
        cwd: &Path,
        overrides: &[(std::ffi::OsString, Option<std::ffi::OsString>)],
        stdin: &std::fs::File,
        stdout: &std::fs::File,
        stderr: &std::fs::File,
        config: &ObserverConfig<'_>,
    ) -> Result<Self, String> {
        Self::spawn_with_files_inner(
            program,
            args,
            cwd,
            overrides,
            stdin,
            stdout,
            stderr,
            Some(config),
            None,
        )
    }
    fn spawn_with_files_inner(
        program: &Path,
        args: &[String],
        cwd: &Path,
        overrides: &[(std::ffi::OsString, Option<std::ffi::OsString>)],
        stdin: &std::fs::File,
        stdout: &std::fs::File,
        stderr: &std::fs::File,
        observation: Option<&ObserverConfig<'_>>,
        memory: Option<usize>,
    ) -> Result<Self, String> {
        validate_codec_memory(memory)?;
        use std::os::windows::io::AsRawHandle;
        let duplicate = |file: &std::fs::File| -> Result<OwnedHandle, String> {
            let mut raw = 0;
            if unsafe { DuplicateHandle(-1, file.as_raw_handle() as isize, -1, &mut raw, 0, 1, 2) }
                == 0
            {
                return Err(error("Duplicate explicit stdio"));
            }
            Ok(OwnedHandle(raw))
        };
        let handles = [duplicate(stdin)?, duplicate(stdout)?, duplicate(stderr)?];
        let raw = [handles[0].0, handles[1].0, handles[2].0];
        let environment = environment_block(std::env::vars_os(), overrides)?;
        Self::spawn_inner(
            program,
            args,
            cwd,
            memory,
            Some(&environment),
            Some(&raw),
            observation,
        )
    }
    /// Experimental explicit observer path; not enabled by environment or existing callers.
    /// Single root admission: observer READY precedes atomic worker creation.
    /// Caller must also retain its persistent activity/scratch guards until confirmed exit.
    pub fn spawn_observed(
        program: &Path,
        args: &[String],
        cwd: &Path,
        config: &ObserverConfig<'_>,
    ) -> Result<Self, String> {
        Self::spawn_inner(program, args, cwd, None, None, None, Some(config))
    }
    pub(crate) fn spawn_observed_attempt(
        program: &Path,
        args: &[String],
        cwd: &Path,
        config: &ObserverConfig<'_>,
        cancelled: &std::sync::atomic::AtomicBool,
        stdio: Option<ObservedStdio<'_>>,
    ) -> Result<Self, LaunchFailure> {
        Self::spawn_observed_attempt_with_memory(program, args, cwd, config, cancelled, stdio, None)
    }
    /// Optional codec policy uses the same kernel limits as legacy spawn_bounded.
    /// Guardian is NOT a member of the worker Job, including with the one-process cap.
    /// Err still means no worker was successfully created; do not add fallible
    /// post-CreateProcess work without redesigning the LaunchFailure capability.
    pub(crate) fn spawn_observed_attempt_with_memory(
        program: &Path,
        args: &[String],
        cwd: &Path,
        config: &ObserverConfig<'_>,
        cancelled: &std::sync::atomic::AtomicBool,
        stdio: Option<ObservedStdio<'_>>,
        memory: Option<usize>,
    ) -> Result<Self, LaunchFailure> {
        let result = if cancelled.load(std::sync::atomic::Ordering::SeqCst) {
            Err("Cancelled before worker creation".into())
        } else if let Some(files) = stdio {
            Self::spawn_with_files_inner(
                program,
                args,
                cwd,
                files.overrides,
                files.stdin,
                files.stdout,
                files.stderr,
                Some(config),
                memory,
            )
        } else {
            Self::spawn_inner(program, args, cwd, memory, None, None, Some(config))
        };
        result.map_err(|message| LaunchFailure {
            activity: config.activity.to_owned(),
            message,
        })
    }
    // G28 diagnostic helpers: compiled only in tests, never the installed application.
    #[cfg(test)]
    pub(crate) fn bounded_files_for_test(program:&Path,args:&[String],cwd:&Path,memory:usize,stdout:&std::fs::File,stderr:&std::fs::File)->Result<Self,String>{
        let input=std::fs::File::open("NUL").map_err(|e|e.to_string())?;
        Self::spawn_with_files_inner(program,args,cwd,&[],&input,stdout,stderr,None,Some(memory))
    }
    #[cfg(test)]
    pub(crate) fn memory_peaks_for_test(&self)->Result<(usize,usize),String>{
        let mut limits=ExtendedLimits::default();
        if unsafe{QueryInformationJobObject(self.job.0,9,(&mut limits as *mut ExtendedLimits).cast(),std::mem::size_of_val(&limits)as u32,std::ptr::null_mut())}==0{return Err(error("Query codec memory peaks"));}
        Ok((limits.peak_process_memory,limits.peak_job_memory))
    }
    #[cfg(test)]
    pub(crate) fn job_policy_for_test(&self) -> Result<(u32, u32, usize), String> {
        let mut limits = ExtendedLimits::default();
        if unsafe {
            QueryInformationJobObject(
                self.job.0,
                9,
                (&mut limits as *mut ExtendedLimits).cast(),
                std::mem::size_of_val(&limits) as u32,
                std::ptr::null_mut(),
            )
        } == 0
        {
            return Err(error("Query actual worker Job policy"));
        }
        Ok((
            limits.basic.flags,
            limits.basic.active_processes,
            limits.job_memory,
        ))
    }
    fn spawn_inner(
        program: &Path,
        args: &[String],
        cwd: &Path,
        memory: Option<usize>,
        environment: Option<&[u16]>,
        stdio: Option<&[Handle; 3]>,
        observation: Option<&ObserverConfig<'_>>,
    ) -> Result<Self, String> {
        validate_codec_memory(memory)?;
        if !program.is_absolute() || !cwd.is_absolute() {
            return Err("Absolute program and cwd required".into());
        }
        let program_text = program.to_str().ok_or("Non-Unicode executable path")?;
        let mut parts = vec![quote(program_text)?];
        for arg in args {
            parts.push(quote(arg)?);
        }
        let mut command = wide(std::ffi::OsStr::new(&parts.join(" ")))?;
        if command.len() > 32767 {
            return Err("Windows command line too long".into());
        }
        let application = wide(program.as_os_str())?;
        let cwd = wide(cwd.as_os_str())?;
        let raw = unsafe { CreateJobObjectW(std::ptr::null(), std::ptr::null()) };
        if raw == 0 {
            return Err(error("Create owned download job"));
        }
        let job = OwnedHandle(raw);
        let mut limits = ExtendedLimits::default();
        limits.basic.flags = 0x2000;
        if let Some(bytes) = memory {
            limits.basic.flags |= 0x200 | 0x8;
            limits.job_memory = bytes;
            limits.basic.active_processes = 1;
        }
        if unsafe {
            SetInformationJobObject(
                raw,
                9,
                &limits as *const _ as *const c_void,
                std::mem::size_of_val(&limits) as u32,
            )
        } == 0
        {
            return Err(error("Set kill-on-close"));
        }
        // Explicit valid stdio preserves Command::stdin/stdout/stderr(Stdio::null()).
        // Without it Windows may supply console/pipe input and a Python read can hang.
        let nul_name = wide(std::ffi::OsStr::new(r"\\.\NUL"))?;
        let security = SecurityAttributes {
            length: std::mem::size_of::<SecurityAttributes>() as u32,
            descriptor: std::ptr::null_mut(),
            inherit: 1,
        };
        let open_nul = |access| -> Result<OwnedHandle, String> {
            let raw = unsafe {
                CreateFileW(
                    nul_name.as_ptr(),
                    access,
                    3,
                    (&security as *const SecurityAttributes).cast(),
                    3,
                    0x80,
                    0,
                )
            };
            if raw == -1 || raw == 0 {
                return Err(error("Open owned NUL stdio"));
            }
            Ok(OwnedHandle(raw))
        };
        // Independent handles: closing stdin/stdout must not invalidate another stream.
        let nul = if stdio.is_none() {
            Some([
                open_nul(0x80000000)?,
                open_nul(0x40000000)?,
                open_nul(0x40000000)?,
            ])
        } else {
            None
        };
        let mut job_value = job.0;
        let mut stdio_value = match stdio {
            Some(handles) => *handles,
            None => {
                let n = nul.as_ref().unwrap();
                [n[0].0, n[1].0, n[2].0]
            }
        };
        let mut attributes = Attributes::new(&mut job_value, &mut stdio_value)?;
        let mut startup: StartupInfoEx = unsafe { std::mem::zeroed() };
        startup.startup.cb = std::mem::size_of::<StartupInfoEx>() as u32;
        startup.attributes = attributes.ptr();
        startup.startup.flags = 0x100; // STARTF_USESTDHANDLES
        startup.startup.stdin = stdio_value[0];
        startup.startup.stdout = stdio_value[1];
        startup.startup.stderr = stdio_value[2];
        let observer = observation
            .map(|config| observer_client::Session::start(job.0, config))
            .transpose()?;
        if let Some(ref observer) = observer {
            observer.ensure_alive()?;
        }
        let mut info = ProcessInfo::default();
        if unsafe {
            CreateProcessW(
                application.as_ptr(),
                command.as_mut_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                1, // Only the explicit stdio handle-list entries can be inherited.
                0x08000000 | 0x00080000 | if environment.is_some() { 0x400 } else { 0 },
                environment.map_or(std::ptr::null(), |block| block.as_ptr().cast()),
                cwd.as_ptr(),
                &startup.startup,
                &mut info,
            )
        } == 0
        {
            return Err(error("Create job-bound download process"));
        }
        let _thread = OwnedHandle(info.thread);
        Ok(Self {
            process: OwnedHandle(info.process),
            job,
            pid: info.pid,
            observer,
        })
    }
    #[cfg(test)]
    pub(crate) fn stop_observer_for_test(&self) -> Result<(), String> {
        self.observer
            .as_ref()
            .ok_or("No test observer")?
            .stop_observer_for_test()
    }
    pub fn id(&self) -> u32 {
        self.pid
    }
    fn active(&self) -> Result<u32, String> {
        let mut info = Accounting::default();
        if unsafe {
            QueryInformationJobObject(
                self.job.0,
                1,
                &mut info as *mut _ as *mut c_void,
                std::mem::size_of_val(&info) as u32,
                std::ptr::null_mut(),
            )
        } == 0
        {
            return Err(error("Query owned process tree"));
        }
        Ok(info.active_processes)
    }
    /// Guardian-facing observation: true only when the owned Job has no active
    /// process. This does not infer liveness from a PID or from the root alone.
    pub fn job_empty(&self) -> Result<bool, String> {
        Ok(self.active()? == 0)
    }
    /// None while ANY owned descendant remains active, even if the main process exited.
    pub fn try_exit(&self) -> Result<Option<u32>, String> {
        if self.active()? != 0 {
            if let Some(observer) = &self.observer {
                if let Err(e) = observer.ensure_alive() {
                    unsafe {
                        TerminateJobObject(self.job.0, 0xc000013a);
                    }
                    return Err(e);
                }
            }
            return Ok(None);
        }
        let exit = self.root_exit()?;
        if exit.is_some() {
            if let Some(observer) = &self.observer {
                if !observer.poll_closed()? {
                    return Ok(None);
                }
            }
        }
        Ok(exit)
    }
    /// Root liveness only. A dead queue consumer must not receive more jobs even
    /// when its descendants remain alive. Never use this to release resource leases.
    pub fn root_exit(&self) -> Result<Option<u32>, String> {
        // ActiveProcesses and process signalling are separate OS observations. Do not
        // confuse a transient STILL_ACTIVE (259) with a final exit code.
        match unsafe { WaitForSingleObject(self.process.0, 0) } {
            0 => {}
            258 => return Ok(None),
            _ => return Err(error("Wait for owned process exit")),
        }
        let mut code = 0;
        if unsafe { GetExitCodeProcess(self.process.0, &mut code) } == 0 {
            return Err(error("Read owned process exit"));
        }
        Ok(Some(code))
    }
    /// Confirm only after the Job is empty AND the main process handle is signalled.
    pub fn terminate(&self, timeout: Duration) -> Result<(), String> {
        if self.try_exit()?.is_some() {
            return Ok(());
        }
        if self.active()? != 0 && unsafe { TerminateJobObject(self.job.0, 0xc000013a) } == 0 {
            return Err(error("Terminate owned process tree"));
        }
        let until = Instant::now() + timeout;
        loop {
            if self.try_exit()?.is_some() {
                return Ok(());
            }
            if Instant::now() >= until {
                return Err("Owned processes have not confirmed termination".into());
            }
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}
impl Drop for OwnedProcess {
    fn drop(&mut self) {
        let _ = self.terminate(Duration::from_secs(5)); /* Closing job still enforces kill-on-close. */
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn structure_sizes_x64() {
        if cfg!(target_pointer_width = "64") {
            assert_eq!(std::mem::size_of::<SecurityAttributes>(), 24);
            assert_eq!(std::mem::size_of::<StartupInfo>(), 104);
            assert_eq!(std::mem::size_of::<StartupInfoEx>(), 112);
            assert_eq!(std::mem::size_of::<ExtendedLimits>(), 144);
            assert_eq!(std::mem::size_of::<Accounting>(), 48);
        }
    }
    #[test]
    fn rejects_relative_and_nul() {
        assert!(OwnedProcess::spawn(Path::new("x.exe"), &[], Path::new(".")).is_err());
        assert!(quote("a\0b").is_err());
    }
    #[test]
    fn argument_quote_roundtrip() {
        #[link(name = "shell32")]
        extern "system" {
            fn CommandLineToArgvW(line: *const u16, count: *mut i32) -> *mut *mut u16;
        }
        #[link(name = "kernel32")]
        extern "system" {
            fn LocalFree(memory: *mut c_void) -> *mut c_void;
        }
        let args = [
            "",
            "a b",
            "a\"b",
            "\\",
            "a\\\"b",
            "C:\\文件夹\\",
            "a&b;$(x)",
        ];
        for arg in args {
            let line = wide(std::ffi::OsStr::new(&format!(
                "test.exe {}",
                quote(arg).unwrap()
            )))
            .unwrap();
            let mut count = 0;
            let p = unsafe { CommandLineToArgvW(line.as_ptr(), &mut count) };
            assert!(!p.is_null());
            assert_eq!(count, 2);
            let s = unsafe { *p.add(1) };
            let mut len = 0;
            while unsafe { *s.add(len) } != 0 {
                len += 1;
            }
            let actual = String::from_utf16(unsafe { std::slice::from_raw_parts(s, len) }).unwrap();
            unsafe {
                LocalFree(p.cast());
            }
            assert_eq!(actual, arg);
        }
    }

    #[test]
    #[ignore = "Requires explicitly configured pinned public FFmpeg fixture; not a default application test"]
    fn bounded_codec_job_limits_are_actually_set() {
        let root = std::path::PathBuf::from(std::env::var_os("FURINAKIT_MEDIA_ENGINES").unwrap());
        let cwd = std::path::PathBuf::from(std::env::var_os("FURINAKIT_MEDIA_TEST_ROOT").unwrap());
        std::fs::create_dir_all(&cwd).unwrap();
        let p = OwnedProcess::spawn_bounded(
            &root.join("ffmpeg.exe"),
            &["-version".into()],
            &cwd,
            512 * 1024 * 1024,
        )
        .unwrap();
        let mut limits = ExtendedLimits::default();
        assert_ne!(
            unsafe {
                QueryInformationJobObject(
                    p.job.0,
                    9,
                    &mut limits as *mut _ as *mut c_void,
                    std::mem::size_of_val(&limits) as u32,
                    std::ptr::null_mut(),
                )
            },
            0
        );
        assert_eq!(limits.basic.flags & 0x2208, 0x2208);
        assert_eq!(limits.job_memory, 512 * 1024 * 1024);
        assert_eq!(limits.basic.active_processes, 1);
        p.terminate(Duration::from_secs(5)).unwrap();
        assert!(OwnedProcess::spawn_bounded(&root.join("ffmpeg.exe"), &[], &cwd, 1).is_err());
    }
}
#[cfg(test)]
mod environment_tests {
    use super::*;
    use std::ffi::OsString;
    fn os(s: &str) -> OsString {
        s.into()
    }
    fn pairs(block: Vec<u16>) -> Vec<String> {
        block
            .split(|c| *c == 0)
            .filter(|s| !s.is_empty())
            .map(|s| String::from_utf16(s).unwrap())
            .collect()
    }
    #[test]
    fn empty_environment_has_double_nul() {
        assert_eq!(environment_block([], &[]).unwrap(), vec![0, 0]);
    }
    #[test]
    fn case_insensitive_override_remove_and_unicode_values() {
        let b = environment_block(
            [
                (os("Path"), os("old")),
                (os("REMOVE"), os("old")),
                (os("z"), os("keep")),
            ],
            &[(os("PATH"), Some(os("中文 &;\\"))), (os("remove"), None)],
        )
        .unwrap();
        assert_eq!(pairs(b), vec!["PATH=中文 &;\\", "z=keep"]);
    }
    #[test]
    fn invalid_explicit_name_and_nul_are_rejected() {
        for k in ["", "BAD=KEY", "BAD\0KEY"] {
            assert!(environment_block([], &[(os(k), Some(os("x")))]).is_err());
        }
        assert!(environment_block([], &[(os("KEY"), Some(os("x\0y")))]).is_err());
    }
    #[test]
    fn empty_values_and_inherited_drive_entries_are_preserved() {
        let b = environment_block(
            [(os("=C:"), os("C:\\test"))],
            &[(os("EMPTY"), Some(os("")))],
        )
        .unwrap();
        assert_eq!(pairs(b), vec!["=C:=C:\\test", "EMPTY="]);
    }
}
