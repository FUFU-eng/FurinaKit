//! Activity journal primitives, NOT an implemented crash-recovery fence.
//! Records alone cannot prove that a process tree stopped. A future guardian must
//! retain authoritative Job ownership, serialize recovery against publication and
//! component mutation, and supply Job-empty evidence. No PID/time-based recovery.
//! File contents are flushed before publication; this is not a power-loss guarantee.
#[path = "activity_protocol.rs"]
pub(crate) mod protocol;
use serde::{Deserialize, Serialize};
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};

const MAX_RECORD_BYTES: u64 = 128 * 1024;
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub(crate) struct Activity {
    pub version: u32,
    pub owner: String,
    pub resources: Vec<String>,
    pub state: String,
    pub started_ms: u128,
}
fn validate(a: &Activity) -> Result<(), String> {
    if a.version != 1
        || !matches!(a.state.as_str(), "active" | "recovered")
        || a.owner.trim().is_empty()
        || a.owner.len() > 256
        || a.owner.chars().any(char::is_control)
        || a.resources.is_empty()
        || a.resources.len() > 64
        || a.resources
            .iter()
            .any(|r| r.is_empty() || r.len() > 1024 || r.chars().any(char::is_control))
    {
        return Err("Invalid or unsupported activity journal".into());
    }
    Ok(())
}
fn ordinary(meta: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 {
            return false;
        }
    }
    meta.is_file() && !meta.file_type().is_symlink()
}
/// Each writer owns its own exclusive temporary file; never truncate a sibling.
fn pending(path: &Path, data: &[u8]) -> Result<PathBuf, String> {
    if data.len() as u64 > MAX_RECORD_BYTES {
        return Err("Activity journal exceeds size limit".into());
    }
    let parent = path.parent().ok_or("Activity path has no parent")?;
    let tmp = parent.join(format!(".activity-{}.pending", uuid::Uuid::new_v4()));
    let mut f = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&tmp)
        .map_err(|e| format!("Create activity staging file: {e}"))?;
    let written = f.write_all(data).and_then(|_| f.sync_all());
    drop(f);
    if let Err(e) = written {
        let _ = fs::remove_file(&tmp);
        return Err(format!("Flush activity journal: {e}"));
    }
    Ok(tmp)
}
/// Windows rename with NO replace flag; supports filesystems without hard links.
/// Both names are in the same directory, so no copy-across-volume fallback occurs.
#[cfg(windows)]
fn publish_new(from: &Path, to: &Path) -> Result<(), String> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(from: *const u16, to: *const u16, flags: u32) -> i32;
    }
    let wide = |p: &Path| -> Result<Vec<u16>, String> {
        let mut w: Vec<u16> = p.as_os_str().encode_wide().collect();
        if w.contains(&0) {
            return Err("NUL in journal path".into());
        }
        w.push(0);
        Ok(w)
    };
    let f = wide(from)?;
    let t = wide(to)?;
    // WRITE_THROUGH, deliberately NOT REPLACE_EXISTING or COPY_ALLOWED.
    if unsafe { MoveFileExW(f.as_ptr(), t.as_ptr(), 8) } == 0 {
        return Err(format!(
            "Publish activity without replacement: {}",
            std::io::Error::last_os_error()
        ));
    }
    Ok(())
}
#[cfg(not(windows))]
fn publish_new(from: &Path, to: &Path) -> Result<(), String> {
    fs::hard_link(from, to).map_err(|e| format!("Publish activity without replacement: {e}"))
}
pub(crate) fn begin(path: &Path, owner: &str, resources: &[String]) -> Result<Activity, String> {
    let a = Activity {
        version: 1,
        owner: owner.into(),
        resources: resources.to_vec(),
        state: "active".into(),
        started_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| e.to_string())?
            .as_millis(),
    };
    validate(&a)?;
    fs::create_dir_all(path.parent().ok_or("Activity path has no parent")?)
        .map_err(|e| e.to_string())?;
    let data = serde_json::to_vec(&a).map_err(|e| e.to_string())?;
    let tmp = pending(path, &data)?;
    let published = publish_new(&tmp, path);
    if let Err(e) = fs::remove_file(&tmp) {
        if e.kind() != std::io::ErrorKind::NotFound {
            eprintln!("Activity staging cleanup pending ({}): {e}", tmp.display());
        }
    }
    published?;
    Ok(a)
}
pub(crate) fn read(path: &Path) -> Result<Option<Activity>, String> {
    let meta = match fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    if !ordinary(&meta) || meta.len() > MAX_RECORD_BYTES {
        return Err("Refusing linked, non-file or oversized activity journal".into());
    }
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(windows)]
    {
        use std::os::windows::fs::OpenOptionsExt;
        options.custom_flags(0x00200000); // OPEN_REPARSE_POINT, do not follow replacement links.
    }
    let file: File = options.open(path).map_err(|e| e.to_string())?;
    if !ordinary(&file.metadata().map_err(|e| e.to_string())?) {
        return Err("Invalid activity journal handle".into());
    }
    let mut bytes = Vec::new();
    file.take(MAX_RECORD_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() as u64 > MAX_RECORD_BYTES {
        return Err("Activity journal exceeds size limit".into());
    }
    let a: Activity =
        serde_json::from_slice(&bytes).map_err(|e| format!("Invalid activity journal: {e}"))?;
    validate(&a)?;
    Ok(Some(a))
}
/// The caller must hold lifecycle exclusion AND independently prove this exact
/// activity's Job is empty. This boolean is not an OS proof or a guardian protocol.
pub(crate) fn recover(path: &Path, confirmed_empty: bool) -> Result<bool, String> {
    if !confirmed_empty {
        return Err("Refusing recovery before Job-empty confirmation".into());
    }
    match read(path)? {
        Some(mut a) if a.state == "active" => {
            a.state = "recovered".into();
            let data = serde_json::to_vec(&a).map_err(|e| e.to_string())?;
            let tmp = pending(path, &data)?;
            let replaced = fs::rename(&tmp, path);
            if replaced.is_err() {
                let _ = fs::remove_file(&tmp);
            }
            replaced.map_err(|e| e.to_string())?;
            Ok(true)
        }
        _ => Ok(false),
    }
}
/// Only the owner of this unique record may finish it during normal lease Drop.
pub(crate) fn finish(path: &Path) -> Result<(), String> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
/// Dormant integration helper. The callback is not implemented Job ownership.
/// Unknown/malformed records cause an error rather than being declared safe.
pub(crate) fn recover_directory(
    dir: &Path,
    job_empty: &dyn Fn(&str) -> bool,
) -> Result<usize, String> {
    let entries = match fs::read_dir(dir) {
        Ok(e) => e,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(0),
        Err(e) => return Err(e.to_string()),
    };
    let mut recovered = 0;
    for entry in entries {
        let path = entry.map_err(|e| e.to_string())?.path();
        if path.extension().and_then(|x| x.to_str()) != Some("json")
            || !path
                .file_name()
                .and_then(|x| x.to_str())
                .unwrap_or("")
                .starts_with("activity-")
        {
            continue;
        }
        if let Some(a) = read(&path)? {
            if a.state == "active" && job_empty(&a.owner) && recover(&path, true)? {
                recovered += 1;
            }
        }
    }
    Ok(recovered)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn p(n: &str) -> PathBuf {
        std::env::temp_dir().join(format!("furinakit-g15-{n}-{}", std::process::id()))
    }
    #[test]
    fn atomic_lifecycle() {
        let x = p("lifecycle");
        let _ = finish(&x);
        let a = begin(&x, "owner-1", &["ffmpeg.exe".into()]).unwrap();
        assert_eq!(read(&x).unwrap(), Some(a));
        assert!(recover(&x, false).is_err());
        assert!(recover(&x, true).unwrap());
        assert_eq!(read(&x).unwrap().unwrap().state, "recovered");
        finish(&x).unwrap();
        assert!(read(&x).unwrap().is_none());
    }
    #[test]
    fn invalid_input_has_no_journal() {
        let x = p("invalid");
        let _ = finish(&x);
        assert!(begin(&x, "", &[]).is_err());
        assert!(!x.exists());
    }
}
