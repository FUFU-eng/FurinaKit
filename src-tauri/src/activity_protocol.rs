//! Opt-in v2 admission ledger. NOT enabled for existing component callers.
//! Receipt authority depends on the trusted G15/G16 launcher; JSON is not an OS proof.
//! Old/nonparticipating writers do not honor this fence. Never infer safety from PID,
//! a released lock, age, or a v1 `recovered` flag. Do not delete journal/lock files.
#![cfg(windows)]
#[path = "activity_archive.rs"]
pub(crate) mod archive;
#[path = "observed_activity.rs"]
pub(crate) mod observed;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::Read,
    os::windows::fs::{MetadataExt, OpenOptionsExt},
    path::{Path, PathBuf},
};
const MAX: u64 = 128 * 1024;
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum Mode {
    Use,
    Change,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct Record {
    pub version: u32,
    pub activity: String,
    pub resources: Vec<String>,
    pub mode: Mode,
}
pub(crate) fn keys(names: &[&str]) -> Result<Vec<String>, String> {
    if names.is_empty() || names.len() > 64 {
        return Err("INVALID: resource count".into());
    }
    let mut keys = Vec::new();
    for n in names {
        if n.is_empty()
            || n.len() > 1024
            || matches!(*n, "." | "..")
            || n.ends_with(['.', ' '])
            || n.chars()
                .any(|c| c.is_control() || ":/\\<>\"|?*".contains(c))
        {
            return Err("INVALID: resource name".into());
        }
        keys.push(n.to_lowercase());
    }
    keys.sort();
    keys.dedup();
    Ok(keys)
}
impl Record {
    fn validate(&self) -> Result<(), String> {
        if self.version != 2
            || self.activity.len() != 32
            || !self
                .activity
                .bytes()
                .all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
        {
            return Err("INVALID: record identity/version".into());
        }
        let names: Vec<_> = self.resources.iter().map(String::as_str).collect();
        if keys(&names)? != self.resources {
            return Err("INVALID: noncanonical resources".into());
        }
        Ok(())
    }
}
fn ordinary(meta: &fs::Metadata, directory: bool) -> bool {
    meta.file_attributes() & 0x400 == 0
        && !meta.file_type().is_symlink()
        && if directory {
            meta.is_dir()
        } else {
            meta.is_file()
        }
}
fn namespace(ns: &Path) -> Result<(), String> {
    if !ns.is_absolute() || !ordinary(&fs::symlink_metadata(ns).map_err(|e| e.to_string())?, true) {
        return Err("INVALID: namespace".into());
    }
    Ok(())
}
fn read_bytes(path: &Path, limit: u64) -> Result<Option<Vec<u8>>, String> {
    let m = match fs::symlink_metadata(path) {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(e.to_string()),
    };
    if !ordinary(&m, false) || m.len() > limit {
        return Err("INVALID: linked/oversized/non-file journal".into());
    }
    let f = OpenOptions::new()
        .read(true)
        .custom_flags(0x00200000)
        .open(path)
        .map_err(|e| e.to_string())?;
    if !ordinary(&f.metadata().map_err(|e| e.to_string())?, false) {
        return Err("INVALID: journal handle".into());
    }
    let mut data = Vec::new();
    f.take(limit + 1)
        .read_to_end(&mut data)
        .map_err(|e| e.to_string())?;
    if data.len() as u64 > limit {
        return Err("INVALID: oversized journal".into());
    }
    Ok(Some(data))
}
pub(crate) fn read_record(path: &Path) -> Result<Record, String> {
    let data = read_bytes(path, MAX)?.ok_or("INVALID: record disappeared")?;
    let rec: Record =
        serde_json::from_slice(&data).map_err(|e| format!("INVALID: record JSON: {e}"))?;
    rec.validate()?;
    Ok(rec)
}
fn lock(path: &Path, mode: Mode) -> Result<File, String> {
    // Never truncate or unlink a sentinel, including on failure.
    match OpenOptions::new().write(true).create_new(true).open(path) {
        Ok(f) => drop(f),
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => (),
        Err(e) => return Err(e.to_string()),
    }
    let m = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !ordinary(&m, false) || m.len() != 0 {
        return Err("INVALID: lease sentinel".into());
    }
    let mut o = OpenOptions::new();
    o.read(true).custom_flags(0x00200000);
    match mode {
        Mode::Use => {
            o.share_mode(1);
        }
        Mode::Change => {
            o.write(true).share_mode(0);
        }
    }
    let f = o.open(path).map_err(|e| {
        if matches!(e.raw_os_error(), Some(32 | 33)) {
            "BUSY: resource/admission transaction".into()
        } else {
            e.to_string()
        }
    })?;
    let m = f.metadata().map_err(|e| e.to_string())?;
    if !ordinary(&m, false) || m.len() != 0 {
        return Err("INVALID: lease handle".into());
    }
    Ok(f)
}
fn receipt_path(ns: &Path, id: &str) -> PathBuf {
    ns.join(format!("receipt-v2-{id}.json"))
}
pub(crate) fn receipt_complete(ns: &Path, rec: &Record) -> Result<bool, String> {
    rec.validate()?;
    let expected = format!(
        "{{\"version\":1,\"activity\":\"{}\",\"state\":\"job-empty\"}}\n",
        rec.activity
    )
    .into_bytes();
    match read_bytes(&receipt_path(ns, &rec.activity), 256)? {
        None => Ok(false),
        Some(data) if data == expected => Ok(true),
        Some(data) if expected.starts_with(&data) => Ok(false),
        Some(_) => Err("INVALID: foreign completion receipt".into()),
    }
}
fn scan_locked(ns: &Path, resources: &[String], mode: Mode) -> Result<(), String> {
    let mut count = 0usize;
    for entry in fs::read_dir(ns).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let name = entry.file_name();
        let name = name.to_str().ok_or("INVALID: non-Unicode ledger entry")?;
        // Windows aliases must not hide a damaged/case-variant historical record.
        let folded = name.to_ascii_lowercase();
        if !folded.starts_with("activity-") || !folded.ends_with(".json") {
            continue;
        }
        count += 1;
        if count > 4096 {
            return Err("RECOVERY_REQUIRED: ledger needs bounded archival".into());
        }
        if !folded.starts_with("activity-v2-") {
            return Err("RECOVERY_REQUIRED: legacy/unknown activity, no implicit migration".into());
        }
        let rec = read_record(&entry.path())?;
        if name != format!("activity-v2-{}.json", rec.activity) {
            return Err("INVALID: filename/identity mismatch".into());
        }
        let conflict = (mode == Mode::Change || rec.mode == Mode::Change)
            && rec.resources.iter().any(|r| resources.contains(r));
        if conflict && !receipt_complete(ns, &rec)? {
            return Err(format!(
                "RECOVERY_REQUIRED: unresolved activity {}",
                rec.activity
            ));
        }
    }
    Ok(())
}
/// Read-only status check, serialized with v2 publication. It is not a reservation.
pub(crate) fn inspect(ns: &Path, names: &[&str], mode: Mode) -> Result<(), String> {
    namespace(ns)?;
    let resources = keys(names)?;
    let _gate = lock(&ns.join("admission-v2.lease"), Mode::Change)?;
    scan_locked(ns, &resources, mode)
}
pub(crate) struct Reservation {
    pub record: Record,
    pub receipt: File,
    pub leases: Vec<File>,
}
// No Drop journal deletion. Closing handles is NOT a completion assertion.
// The caller must transfer these capabilities to an observer before launching work.
pub(crate) fn reserve(ns: &Path, names: &[&str], mode: Mode) -> Result<Reservation, String> {
    reserve_id(ns, names, mode, &uuid::Uuid::new_v4().simple().to_string())
}
pub(crate) fn reserve_id(
    ns: &Path,
    names: &[&str],
    mode: Mode,
    id: &str,
) -> Result<Reservation, String> {
    namespace(ns)?;
    let rec = Record {
        version: 2,
        activity: id.into(),
        resources: keys(names)?,
        mode,
    };
    rec.validate()?;
    let _gate = lock(&ns.join("admission-v2.lease"), Mode::Change)?;
    let path = ns.join(format!("activity-v2-{id}.json"));
    // Preserve identity even if a receipt was lost after retirement. Never reuse
    // an archived or unlaunched token, and fail closed on metadata errors.
    for prefix in ["activity-v2-", "completed-v2-", "unlaunched-v2-"] {
        match fs::symlink_metadata(ns.join(format!("{prefix}{id}.json"))) {
            Ok(_) => return Err("INVALID: activity identity already used".into()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
            Err(e) => return Err(e.to_string()),
        }
    }
    scan_locked(ns, &rec.resources, mode)?;
    let mut leases = Vec::new();
    for key in &rec.resources {
        leases.push(lock(
            &ns.join(format!("file-{:x}.lease", Sha256::digest(key.as_bytes()))),
            mode,
        )?);
    }
    let rp = receipt_path(ns, id);
    let receipt = OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .open(&rp)
        .map_err(|e| e.to_string())?;
    receipt.sync_all().map_err(|e| e.to_string())?;
    let data = serde_json::to_vec(&rec).map_err(|e| e.to_string())?;
    let tmp = super::pending(&path, &data)?;
    let published = super::publish_new(&tmp, &path);
    // Preserve receipt on publication ambiguity. It can never authorize reuse on its own.
    if let Err(e) = fs::remove_file(&tmp) {
        if e.kind() != std::io::ErrorKind::NotFound {
            eprintln!("Pending v2 staging cleanup: {e}");
        }
    }
    published?;
    Ok(Reservation {
        record: rec,
        receipt,
        leases,
    })
}
