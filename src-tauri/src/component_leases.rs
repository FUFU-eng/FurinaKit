//! Cooperative Windows component leases, separate from model files and download status.
//! Shared readers / exclusive mutators in the same app-cache lease store. Kernel handles
//! release on process death. Never delete lock files (unlinking would split the lock domain).
//! Old clients/external writers do not participate. This is not executable integrity checking.
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    path::{Path, PathBuf},
};
#[derive(Clone, Copy, Debug)]
pub enum Mode {
    Use,
    Change,
}
#[derive(Debug)]
pub struct Lease {
    _handles: Vec<File>,
    activity: Option<PathBuf>,
}
fn keys(files: &[&str]) -> Result<Vec<String>, String> {
    if files.is_empty() || files.len() > 64 {
        return Err("Invalid component lease set".into());
    }
    let mut out = Vec::new();
    for file in files {
        if file.is_empty()
            || file.len() > 1024
            || file
                .chars()
                .any(|c| c.is_control() || ":/\\<>\"|?*".contains(c))
            || file.ends_with(['.', ' '])
            || matches!(*file, "." | "..")
        {
            return Err("Invalid component lease filename".into());
        }
        out.push(file.to_lowercase());
    }
    out.sort();
    out.dedup();
    Ok(out)
}
fn sentinel(key: &str) -> String {
    format!("file-{:x}.lease", Sha256::digest(key.as_bytes()))
}
fn ordinary(meta: &fs::Metadata, directory: bool) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return false;
        }
    }
    !meta.file_type().is_symlink()
        && if directory {
            meta.is_dir()
        } else {
            meta.is_file() && meta.len() == 0
        }
}
pub(crate) fn namespace(store: &Path, root: &Path) -> Result<std::path::PathBuf, String> {
    let root = fs::canonicalize(root).map_err(|e| format!("Component root: {e}"))?;
    if !root.is_dir() {
        return Err("Component root is not a directory".into());
    }
    // Windows paths are case-insensitive in the supported component layout.
    let key = format!(
        "{:x}",
        Sha256::digest(root.to_string_lossy().to_lowercase().as_bytes())
    );
    fs::create_dir_all(store).map_err(|e| format!("Component lease store: {e}"))?;
    if !ordinary(
        &fs::symlink_metadata(store).map_err(|e| e.to_string())?,
        true,
    ) {
        return Err("Refusing linked component lease store".into());
    }
    let directory = store.join(key);
    match fs::create_dir(&directory) {
        Ok(()) => (),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => (),
        Err(e) => return Err(e.to_string()),
    }
    if !ordinary(
        &fs::symlink_metadata(&directory).map_err(|e| e.to_string())?,
        true,
    ) {
        return Err("Refusing linked component lease namespace".into());
    }
    Ok(directory)
}
/// Nonblocking, all-or-nothing acquisition. A failed multi-file request drops its prefix.
/// The component root is only resolved, never created or modified here.
pub fn acquire(store: &Path, root: &Path, files: &[&str], mode: Mode) -> Result<Lease, String> {
    let keys = keys(files)?;
    #[cfg(not(windows))]
    {
        let _ = (store, root, keys, mode);
        return Err("Component leases require Windows".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        let directory = namespace(store, root)?;
        let mut handles = Vec::new();
        for key in &keys {
            let path = directory.join(sentinel(&key));
            // Creation is exclusive and never truncates an existing sentinel.
            if let Err(e) = fs::symlink_metadata(&path) {
                if e.kind() != std::io::ErrorKind::NotFound {
                    return Err(e.to_string());
                }
                match OpenOptions::new().write(true).create_new(true).open(&path) {
                    Ok(file) => drop(file),
                    Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => (),
                    Err(e) => return Err(e.to_string()),
                }
            }
            if !ordinary(
                &fs::symlink_metadata(&path).map_err(|e| e.to_string())?,
                false,
            ) {
                return Err("Refusing nonempty, linked or non-file component lease".into());
            }
            let mut options = OpenOptions::new();
            options.read(true).custom_flags(0x00200000); // OPEN_REPARSE_POINT
            match mode {
                Mode::Use => {
                    options.share_mode(1);
                }
                Mode::Change => {
                    options.write(true).share_mode(0);
                }
            }
            let handle=options.open(&path).map_err(|e| {
                if matches!(e.raw_os_error(),Some(32|33)) {
                    format!("组件正在使用或变更，请等待任务真正结束后重试 / Component busy (in use or changing): {key}")
                } else {format!("Component lease {key}: {e}")}
            })?;
            if !ordinary(&handle.metadata().map_err(|e| e.to_string())?, false) {
                return Err("Invalid component lease handle".into());
            }
            handles.push(handle);
        }
        let id = uuid::Uuid::new_v4();
        let activity = directory.join(format!("activity-{}-{id}.json", std::process::id()));
        let resources = keys.clone();
        crate::recovery_guard::begin(
            &activity,
            &format!("{}-{id}", std::process::id()),
            &resources,
        )
        .map_err(|error| format!("Cannot publish component activity: {error}"))?;
        Ok(Lease {
            _handles: handles,
            activity: Some(activity),
        })
    }
}
impl Drop for Lease {
    fn drop(&mut self) {
        if let Some(path) = self.activity.take() {
            if let Err(error) = crate::recovery_guard::finish(&path) {
                eprintln!(
                    "Component activity cleanup pending ({}): {error}",
                    path.display()
                );
            }
        }
    }
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use std::{
        path::PathBuf,
        process::{Child, Command, Stdio},
        time::{Duration, Instant},
    };
    fn fixture(name: &str) -> (PathBuf, PathBuf) {
        let base = PathBuf::from(
            std::env::var_os("FURINAKIT_LEASE_TEST_ROOT")
                .expect("explicit isolated test root required"),
        )
        .join(name);
        fs::create_dir(&base).expect("exclusive test fixture (do not reuse old run)");
        let root = base.join("components");
        fs::create_dir(&root).unwrap();
        (base.join("leases"), root)
    }
    fn busy(r: Result<Lease, String>) {
        assert!(r.unwrap_err().contains("Component busy"));
    }
    #[test]
    fn shared_readers_block_mutation_until_last_drop() {
        let (s, r) = fixture("shared");
        let a = acquire(&s, &r, &["ffmpeg.exe"], Mode::Use).unwrap();
        let b = acquire(&s, &r, &["FFMPEG.EXE"], Mode::Use).unwrap();
        busy(acquire(&s, &r, &["ffmpeg.exe"], Mode::Change));
        drop(a);
        busy(acquire(&s, &r, &["ffmpeg.exe"], Mode::Change));
        drop(b);
        assert!(acquire(&s, &r, &["ffmpeg.exe"], Mode::Change).is_ok());
    }
    #[test]
    fn mutation_blocks_both_modes() {
        let (s, r) = fixture("exclusive");
        let a = acquire(&s, &r, &["ffprobe.exe"], Mode::Change).unwrap();
        busy(acquire(&s, &r, &["ffprobe.exe"], Mode::Use));
        busy(acquire(&s, &r, &["ffprobe.exe"], Mode::Change));
        drop(a);
        assert!(acquire(&s, &r, &["ffprobe.exe"], Mode::Use).is_ok());
    }
    #[test]
    fn distinct_resources_and_roots_do_not_block() {
        let (s, r) = fixture("independent");
        let a = acquire(&s, &r, &["a.bin"], Mode::Change).unwrap();
        let b = acquire(&s, &r, &["模型.bin"], Mode::Use).unwrap();
        let r2 = r.parent().unwrap().join("components2");
        fs::create_dir(&r2).unwrap();
        assert!(acquire(&s, &r2, &["a.bin"], Mode::Change).is_ok());
        drop((a, b));
    }
    #[test]
    fn partial_multifile_failure_releases_prefix() {
        let (s, r) = fixture("rollback");
        let b = acquire(&s, &r, &["b.bin"], Mode::Change).unwrap();
        busy(acquire(&s, &r, &["b.bin", "a.bin", "A.BIN"], Mode::Use));
        assert!(acquire(&s, &r, &["a.bin"], Mode::Change).is_ok());
        drop(b);
        assert!(acquire(&s, &r, &["b.bin", "a.bin", "A.BIN"], Mode::Change).is_ok());
    }
    #[test]
    fn invalid_names_have_no_filesystem_side_effect() {
        let (s, r) = fixture("invalid");
        for f in [
            "", "../x", "a/b", "a\\b", "..", ".", "a:stream", "a ", "*", "\0",
        ] {
            assert!(acquire(&s, &r, &[f], Mode::Use).is_err());
        }
        assert!(acquire(&s, &r, &[], Mode::Use).is_err());
        assert!(!s.exists());
    }
    #[test]
    fn foreign_sentinel_is_not_overwritten() {
        let (s, r) = fixture("foreign");
        let d = namespace(&s, &r).unwrap();
        let p = d.join(sentinel("a.bin"));
        fs::write(&p, b"retain this evidence").unwrap();
        assert!(acquire(&s, &r, &["a.bin"], Mode::Change).is_err());
        assert_eq!(fs::read(&p).unwrap(), b"retain this evidence");
        fs::create_dir(d.join(sentinel("b.bin"))).unwrap();
        assert!(acquire(&s, &r, &["b.bin"], Mode::Use).is_err());
    }
    #[test]
    fn model_directory_remains_untouched_and_alias_root_matches() {
        let (s, r) = fixture("untouched");
        fs::write(r.join("a.bin"), b"synthetic model, not an executable").unwrap();
        let a = acquire(&s, &r, &["a.bin"], Mode::Use).unwrap();
        busy(acquire(&s, &r.join("."), &["a.bin"], Mode::Change));
        assert_eq!(fs::read_dir(&r).unwrap().count(), 1);
        assert_eq!(
            fs::read(r.join("a.bin")).unwrap(),
            b"synthetic model, not an executable"
        );
        drop(a);
    }
    #[test]
    fn simultaneous_first_readers_do_not_conflict() {
        let (s, r) = fixture("simultaneous-first-readers");
        for round in 0..32 {
            let key = format!("new-{round}.bin");
            let barrier = std::sync::Barrier::new(8);
            std::thread::scope(|scope| {
                let handles: Vec<_> = (0..8)
                    .map(|_| {
                        scope.spawn(|| {
                            barrier.wait();
                            let lease = acquire(&s, &r, &[&key], Mode::Use);
                            barrier.wait();
                            lease
                        })
                    })
                    .collect();
                for handle in handles {
                    assert!(
                        handle.join().unwrap().is_ok(),
                        "initial shared acquisition must not spuriously conflict"
                    );
                }
            });
        }
    }

    fn python_cross(name: &str, mode: &str, kill: bool) {
        let (s, r) = fixture(name);
        let ns = namespace(&s, &r).unwrap();
        let ready = r.parent().unwrap().join("ready");
        let release = r.parent().unwrap().join("release");
        let mut child = ChildGuard(
            Command::new(
                std::env::var_os("FURINAKIT_LEASE_PYTHON")
                    .expect("explicit Python test interpreter"),
            )
            .arg("-B")
            .arg(std::env::var_os("FURINAKIT_LEASE_PY_CHILD").unwrap())
            .env("PYTHONUTF8", "1")
            .env("FK_LEASE_PY_NAMESPACE", ns)
            .env("FK_LEASE_CHILD_READY", &ready)
            .env("FK_LEASE_CHILD_RELEASE", &release)
            .env("FK_LEASE_CHILD_MODE", mode)
            .stdout(Stdio::null())
            .stderr(Stdio::inherit())
            .spawn()
            .unwrap(),
        );
        let end = Instant::now() + Duration::from_secs(10);
        while !ready.exists() {
            assert!(
                child.0.try_wait().unwrap().is_none(),
                "Python child failed before ready"
            );
            assert!(Instant::now() < end);
            std::thread::sleep(Duration::from_millis(20));
        }
        busy(acquire(&s, &r, &["模型.bin"], Mode::Change));
        if mode == "change" {
            busy(acquire(&s, &r, &["模型.bin"], Mode::Use));
        } else {
            assert!(acquire(&s, &r, &["模型.bin"], Mode::Use).is_ok());
        }
        if kill {
            child.0.kill().unwrap();
            child.0.wait().unwrap();
        } else {
            fs::write(release, b"finish").unwrap();
            loop {
                if let Some(status) = child.0.try_wait().unwrap() {
                    assert!(status.success());
                    break;
                }
                assert!(Instant::now() < end);
                std::thread::sleep(Duration::from_millis(20));
            }
        }
        assert!(acquire(&s, &r, &["模型.bin"], Mode::Change).is_ok());
    }
    #[test]
    fn python_reader_blocks_rust_change() {
        python_cross("python-reader", "use", false);
    }
    #[test]
    fn python_writer_blocks_rust_reader_and_writer() {
        python_cross("python-writer", "change", false);
    }
    #[test]
    fn killed_python_owner_releases_lease() {
        python_cross("python-killed", "change", true);
    }

    fn python_rejected_by_rust(name: &str, mode: Mode) {
        let (s, r) = fixture(name);
        let _lease = acquire(&s, &r, &["模型.bin"], mode).unwrap();
        let status = Command::new(std::env::var_os("FURINAKIT_LEASE_PYTHON").unwrap())
            .arg("-B")
            .arg(std::env::var_os("FURINAKIT_LEASE_PY_ATTEMPT").unwrap())
            .env("PYTHONUTF8", "1")
            .env("FK_LEASE_PY_NAMESPACE", namespace(&s, &r).unwrap())
            .env(
                "FK_LEASE_CHILD_MODE",
                if matches!(mode, Mode::Change) {
                    "use"
                } else {
                    "change"
                },
            )
            .status()
            .unwrap();
        assert!(status.success());
    }
    #[test]
    fn rust_reader_blocks_python_change() {
        python_rejected_by_rust("rust-reader", Mode::Use);
    }
    #[test]
    fn rust_writer_blocks_python_use() {
        python_rejected_by_rust("rust-writer", Mode::Change);
    }

    struct ChildGuard(Child);
    impl Drop for ChildGuard {
        fn drop(&mut self) {
            let _ = self.0.kill();
            let _ = self.0.wait();
        }
    }
    fn cross(name: &str, mode: &str, kill: bool) {
        let (s, r) = fixture(name);
        let ready = r.parent().unwrap().join("ready");
        let release = r.parent().unwrap().join("release");
        let mut child = ChildGuard(
            Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "component_leases::tests::child_holder",
                    "--ignored",
                    "--nocapture",
                ])
                .env("FK_LEASE_CHILD_STORE", &s)
                .env("FK_LEASE_CHILD_ROOT", &r)
                .env("FK_LEASE_CHILD_READY", &ready)
                .env("FK_LEASE_CHILD_RELEASE", &release)
                .env("FK_LEASE_CHILD_MODE", mode)
                .stdout(Stdio::null())
                .stderr(Stdio::inherit())
                .spawn()
                .unwrap(),
        );
        let end = Instant::now() + Duration::from_secs(10);
        while !ready.exists() {
            assert!(
                child.0.try_wait().unwrap().is_none(),
                "child failed before ready"
            );
            assert!(Instant::now() < end);
            std::thread::sleep(Duration::from_millis(20));
        }
        busy(acquire(&s, &r, &["a.bin"], Mode::Change));
        if mode == "change" {
            busy(acquire(&s, &r, &["a.bin"], Mode::Use));
        } else {
            assert!(acquire(&s, &r, &["a.bin"], Mode::Use).is_ok());
        }
        if kill {
            child.0.kill().unwrap();
            child.0.wait().unwrap();
        } else {
            fs::write(release, b"finish").unwrap();
            loop {
                if let Some(status) = child.0.try_wait().unwrap() {
                    assert!(status.success());
                    break;
                }
                assert!(Instant::now() < end);
                std::thread::sleep(Duration::from_millis(20));
            }
        }
        assert!(acquire(&s, &r, &["a.bin"], Mode::Change).is_ok());
    }
    #[test]
    fn cross_process_reader_normal_exit() {
        cross("child-reader", "use", false);
    }
    #[test]
    fn cross_process_writer_normal_exit() {
        cross("child-writer", "change", false);
    }
    #[test]
    fn killed_owner_does_not_leave_stale_busy() {
        cross("child-killed", "change", true);
    }
    #[test]
    #[ignore = "child helper invoked by cross-process parent tests"]
    fn child_holder() {
        let s = PathBuf::from(std::env::var_os("FK_LEASE_CHILD_STORE").unwrap());
        let r = PathBuf::from(std::env::var_os("FK_LEASE_CHILD_ROOT").unwrap());
        let ready = PathBuf::from(std::env::var_os("FK_LEASE_CHILD_READY").unwrap());
        let release = PathBuf::from(std::env::var_os("FK_LEASE_CHILD_RELEASE").unwrap());
        let mode = if std::env::var("FK_LEASE_CHILD_MODE").unwrap() == "change" {
            Mode::Change
        } else {
            Mode::Use
        };
        let _lease = acquire(&s, &r, &["a.bin"], mode).unwrap();
        fs::write(ready, b"ready").unwrap();
        let end = Instant::now() + Duration::from_secs(15);
        while !release.exists() {
            assert!(Instant::now() < end);
            std::thread::sleep(Duration::from_millis(20));
        }
    }
}
