//! Windows handle-anchored private output directories and verified artifact capabilities.
//! No shared-directory scanning, reparse following, hard-linked payloads or path exports.
//! Not an ACL sandbox against administrators or malicious same-user code. Callers must
//! stop the owned downloader before sealing and keep control/log files OUTSIDE payloads.
use crate::{torrent_integrity, torrent_meta};
use std::{
    collections::{BTreeMap, BTreeSet},
    ffi::c_void,
    fs::File,
    io::{Read, Seek, SeekFrom, Write},
    os::windows::io::{AsRawHandle, FromRawHandle},
    path::{Component, Path, PathBuf, Prefix},
};
type Result<T> = std::result::Result<T, String>;
type Handle = isize;
const READ_ACCESS: u32 = 0x00120089;
const DIR_ACCESS: u32 = READ_ACCESS | 0x20;
const REPARSE: u32 = 0x400;
const DIRECTORY: u32 = 0x10;
const MAX_FILES: usize = 2048;
const MAX_DIRS: usize = 4096;
#[repr(C)]
struct UnicodeString {
    len: u16,
    max_len: u16,
    buffer: *mut u16,
}
#[repr(C)]
struct ObjectAttributes {
    len: u32,
    root: Handle,
    name: *mut UnicodeString,
    attributes: u32,
    security: *mut c_void,
    qos: *mut c_void,
}
#[repr(C)]
#[derive(Default)]
struct IoStatus {
    status: usize,
    information: usize,
}
#[repr(C)]
#[derive(Default)]
struct FileInfo {
    attributes: u32,
    creation: [u32; 2],
    access: [u32; 2],
    write: [u32; 2],
    volume: u32,
    size_high: u32,
    size_low: u32,
    links: u32,
    index_high: u32,
    index_low: u32,
}
#[link(name = "ntdll")]
extern "system" {
    fn NtCreateFile(
        out: *mut Handle,
        access: u32,
        attributes: *mut ObjectAttributes,
        io: *mut IoStatus,
        allocation: *const i64,
        file_attributes: u32,
        share: u32,
        disposition: u32,
        options: u32,
        ea: *const c_void,
        ea_len: u32,
    ) -> i32;
    fn RtlNtStatusToDosError(status: i32) -> u32;
}
#[link(name = "kernel32")]
extern "system" {
    fn CreateFileW(
        name: *const u16,
        access: u32,
        share: u32,
        security: *const c_void,
        disposition: u32,
        flags: u32,
        template: Handle,
    ) -> Handle;
    fn GetFileInformationByHandle(handle: Handle, info: *mut FileInfo) -> i32;
    fn GetFileInformationByHandleEx(
        handle: Handle,
        class: i32,
        info: *mut c_void,
        size: u32,
    ) -> i32;
}
fn handle(file: &File) -> Handle {
    file.as_raw_handle() as Handle
}
fn os_error(op: &str) -> String {
    format!("{op}: {}", std::io::Error::last_os_error())
}
fn component(name: &str) -> Result<()> {
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.encode_utf16().count() > 255
        || name.chars().any(|c| c.is_control() || "\\/:".contains(c))
    {
        return Err("Unsafe relative component".into());
    }
    Ok(())
}
fn information(file: &File) -> Result<FileInfo> {
    let mut info = FileInfo::default();
    if unsafe { GetFileInformationByHandle(handle(file), &mut info) } == 0 {
        return Err(os_error("Inspect opened artifact handle"));
    }
    if info.attributes & REPARSE != 0 {
        return Err("Reparse point is not an artifact".into());
    }
    Ok(info)
}
fn relative(
    parent: &File,
    name: &str,
    directory: bool,
    create_new: bool,
    share: u32,
) -> Result<File> {
    component(name)?;
    let mut chars: Vec<u16> = name.encode_utf16().collect();
    let mut name = UnicodeString {
        len: (chars.len() * 2) as u16,
        max_len: (chars.len() * 2) as u16,
        buffer: chars.as_mut_ptr(),
    };
    // Case-insensitive object lookup, but never traverse any reparse point.
    let mut attrs = ObjectAttributes {
        len: std::mem::size_of::<ObjectAttributes>() as u32,
        root: handle(parent),
        name: &mut name,
        attributes: 0x40 | 0x1000,
        security: std::ptr::null_mut(),
        qos: std::ptr::null_mut(),
    };
    let mut io = IoStatus::default();
    let mut raw = 0isize;
    let status = unsafe {
        NtCreateFile(
            &mut raw,
            if directory { DIR_ACCESS } else { READ_ACCESS },
            &mut attrs,
            &mut io,
            std::ptr::null(),
            if directory { DIRECTORY } else { 0 },
            share,
            if create_new { 2 } else { 1 },
            0x20 | 0x00200000 | if directory { 1 } else { 0x40 },
            std::ptr::null(),
            0,
        )
    };
    if status < 0 {
        return Err(format!(
            "Open relative artifact: {}",
            std::io::Error::from_raw_os_error(unsafe { RtlNtStatusToDosError(status) } as i32)
        ));
    }
    let file = unsafe { File::from_raw_handle(raw as *mut c_void) };
    let info = information(&file)?;
    if (info.attributes & DIRECTORY != 0) != directory {
        return Err("Artifact type mismatch".into());
    }
    if !directory && info.links != 1 {
        return Err("Hard-linked payload rejected".into());
    }
    Ok(file)
}
/// Open each local-drive path component relative to a previously verified directory.
/// Ancestors deny deletion/rename; only task payload directories additionally deny write
/// handles. These guards do not modify ACLs or user files.
fn anchor(path: &Path) -> Result<Vec<File>> {
    let mut components = path.components();
    let drive = match components.next() {
        Some(Component::Prefix(p)) => match p.kind() {
            Prefix::Disk(d) | Prefix::VerbatimDisk(d) => d,
            _ => return Err("Only local drive output paths are supported".into()),
        },
        _ => return Err("Absolute local drive path required".into()),
    };
    if !matches!(components.next(), Some(Component::RootDir)) {
        return Err("Absolute rooted path required".into());
    }
    let root = format!("\\\\?\\{}:\\", drive as char);
    let mut wide: Vec<u16> = root.encode_utf16().collect();
    wide.push(0);
    let raw = unsafe {
        CreateFileW(
            wide.as_ptr(),
            DIR_ACCESS,
            3,
            std::ptr::null(),
            3,
            0x02000000 | 0x00200000,
            0,
        )
    };
    if raw == -1 {
        return Err(os_error("Open drive anchor"));
    }
    let root = unsafe { File::from_raw_handle(raw as *mut c_void) };
    information(&root)?;
    let mut handles = vec![root];
    for part in components {
        let name = match part {
            Component::Normal(s) => s.to_str().ok_or("Unsupported directory encoding")?,
            _ => return Err("Relative navigation in output path".into()),
        };
        handles.push(relative(handles.last().unwrap(), name, true, false, 3)?);
    }
    Ok(handles)
}
pub struct OutputDirectory {
    path: PathBuf,
    _parents: Vec<File>,
    root: File,
}
impl OutputDirectory {
    /// Atomically FILE_CREATE a fresh task directory; NEVER reuse an existing directory.
    /// Parent must already exist. IDs are generated by the task owner, not torrent names.
    pub fn create(parent: &Path, id: &str) -> Result<Self> {
        if id.is_empty() || id.len() > 64 || !id.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-')
        {
            return Err("Invalid output task ID".into());
        }
        let parents = anchor(parent)?;
        let name = format!("job-{id}");
        // Downloader needs directory write sharing for its own atomic progress-file renames.
        // No DELETE sharing: the directory identity cannot be replaced.
        let root = relative(parents.last().unwrap(), &name, true, true, 3)?;
        Ok(Self {
            path: parent.join(&name),
            _parents: parents,
            root,
        })
    }
    pub fn path(&self) -> &Path {
        &self.path
    }
    /// Synchronously freeze the expected files and directories, hash them, then retain
    /// the SAME read handles for serving. Reopening returned path strings is prohibited.
    pub fn seal(
        mut self,
        torrent: &[u8],
        expected_info_hash: &str,
        mut cancelled: impl FnMut() -> bool,
    ) -> Result<SealedArtifacts> {
        let meta = torrent_meta::parse(torrent)?;
        if torrent_integrity::info_hash(&meta)? != expected_info_hash {
            return Err("Info hash changed before artifact sealing".into());
        }
        if meta.files.len() > MAX_FILES {
            return Err("Sealed artifact handle limit (2048 files)".into());
        }
        // Transition from writable download directory to frozen metadata only AFTER
        // the caller has confirmed the downloader stopped. Never exempt aria2 leftovers
        // from the manifest to work around filesystem sharing failures.
        let original = information(&self.root)?;
        let name = self
            .path
            .file_name()
            .and_then(|s| s.to_str())
            .ok_or("Invalid task directory name")?;
        let frozen = relative(
            self._parents.last().ok_or("Missing directory anchor")?,
            name,
            true,
            false,
            1,
        )?;
        let current = information(&frozen)?;
        if (original.volume, original.index_high, original.index_low)
            != (current.volume, current.index_high, current.index_low)
        {
            return Err("Output directory identity changed".into());
        }
        self.root = frozen;
        let mut expected_files = BTreeMap::new();
        let mut expected_dirs = BTreeSet::new();
        for f in &meta.files {
            let key = f.path.join("/").to_ascii_lowercase();
            expected_files.insert(key, f.length);
            for n in 1..f.path.len() {
                expected_dirs.insert(f.path[..n].join("/").to_ascii_lowercase());
            }
        }
        if expected_dirs.len() > MAX_DIRS {
            return Err("Output directory count limit".into());
        }
        let mut files = BTreeMap::new();
        let mut guards = Vec::new();
        let mut found_dirs = BTreeSet::new();
        walk(
            &self.root,
            "",
            &expected_files,
            &expected_dirs,
            &mut files,
            &mut guards,
            &mut found_dirs,
            &mut cancelled,
        )?;
        if files.len() != expected_files.len() || found_dirs != expected_dirs {
            return Err("Missing manifest files or directories".into());
        }
        let verified = torrent_integrity::verify(
            &meta,
            |f| {
                let key = f.path.join("/").to_ascii_lowercase();
                let file = files
                    .get(&key)
                    .ok_or("Missing pinned artifact")?
                    .try_clone()
                    .map_err(|e| e.to_string())?;
                Ok(Box::new(file) as Box<dyn Read>)
            },
            &mut cancelled,
        )?;
        if cancelled() {
            return Err("Artifact sealing cancelled".into());
        }
        let mut entries = Vec::new();
        for f in meta.files {
            let key = f.path.join("/").to_ascii_lowercase();
            let mut file = files.remove(&key).ok_or("Missing verified handle")?;
            file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
            entries.push(SealedFile {
                relative: f.path.join("/"),
                length: f.length,
                file,
            });
        }
        Ok(SealedArtifacts {
            info_hash: expected_info_hash.into(),
            verified,
            entries,
            _directories: guards,
            _owner: self,
        })
    }
}
fn directory_entries(dir: &File) -> Result<Vec<(String, u32)>> {
    let mut buffer = vec![0u64; 8192];
    let mut first = true;
    let mut result = Vec::new();
    loop {
        let ok = unsafe {
            GetFileInformationByHandleEx(
                handle(dir),
                if first { 11 } else { 10 },
                buffer.as_mut_ptr().cast(),
                (buffer.len() * 8) as u32,
            )
        };
        first = false;
        if ok == 0 {
            let error = std::io::Error::last_os_error();
            if error.raw_os_error() == Some(18) {
                break;
            }
            return Err(format!("Enumerate pinned directory: {error}"));
        }
        let bytes =
            unsafe { std::slice::from_raw_parts(buffer.as_ptr().cast::<u8>(), buffer.len() * 8) };
        let mut offset = 0;
        loop {
            let row = bytes
                .get(offset..)
                .ok_or("Malformed directory enumeration offset")?;
            if row.len() < 104 {
                return Err("Truncated directory enumeration".into());
            }
            let get = |n| u32::from_le_bytes(row[n..n + 4].try_into().unwrap());
            let next = get(0) as usize;
            let attrs = get(56);
            let length = get(60) as usize;
            if length % 2 != 0 || length > 510 || 104 + length > row.len() {
                return Err("Invalid directory name length".into());
            }
            let chars: Vec<u16> = row[104..104 + length]
                .chunks_exact(2)
                .map(|b| u16::from_le_bytes([b[0], b[1]]))
                .collect();
            let name = String::from_utf16(&chars).map_err(|_| "Invalid UTF-16 output filename")?;
            if name != "." && name != ".." {
                component(&name)?;
                result.push((name, attrs));
                if result.len() > MAX_FILES + MAX_DIRS {
                    return Err("Directory enumeration limit".into());
                }
            }
            if next == 0 {
                break;
            }
            if next < 104 + length || next % 8 != 0 || next > row.len() {
                return Err("Invalid next directory record".into());
            }
            offset += next;
        }
    }
    Ok(result)
}
fn walk(
    dir: &File,
    prefix: &str,
    expected: &BTreeMap<String, u64>,
    expected_dirs: &BTreeSet<String>,
    files: &mut BTreeMap<String, File>,
    guards: &mut Vec<File>,
    found_dirs: &mut BTreeSet<String>,
    cancelled: &mut impl FnMut() -> bool,
) -> Result<()> {
    if cancelled() {
        return Err("Artifact sealing cancelled".into());
    }
    for (name, attributes) in directory_entries(dir)? {
        if cancelled() {
            return Err("Artifact sealing cancelled".into());
        }
        if attributes & REPARSE != 0 {
            return Err("Reparse entry rejected".into());
        }
        let key = if prefix.is_empty() {
            name.to_ascii_lowercase()
        } else {
            format!("{prefix}/{}", name.to_ascii_lowercase())
        };
        if attributes & DIRECTORY != 0 {
            if !expected_dirs.contains(&key) || !found_dirs.insert(key.clone()) {
                return Err("Unexpected or duplicate output directory".into());
            }
            let child = relative(dir, &name, true, false, 1)?;
            walk(
                &child,
                &key,
                expected,
                expected_dirs,
                files,
                guards,
                found_dirs,
                cancelled,
            )?;
            guards.push(child);
        } else {
            let length = *expected
                .get(&key)
                .ok_or("Unexpected output file (not in manifest)")?;
            let file = relative(dir, &name, false, false, 1)?;
            if file.metadata().map_err(|e| e.to_string())?.len() != length {
                return Err("Artifact length differs from manifest".into());
            }
            if files.insert(key, file).is_some() {
                return Err("Duplicate output file".into());
            }
        }
    }
    Ok(())
}
struct SealedFile {
    relative: String,
    length: u64,
    file: File,
}
pub struct SealedArtifacts {
    pub info_hash: String,
    pub verified: torrent_integrity::Verified,
    entries: Vec<SealedFile>,
    _directories: Vec<File>,
    _owner: OutputDirectory,
}
impl SealedArtifacts {
    pub fn manifest(&self) -> Vec<(&str, u64)> {
        self.entries
            .iter()
            .map(|e| (e.relative.as_str(), e.length))
            .collect()
    }
    /// Copy only from a retained verified handle; caller controls destination separately.
    pub fn copy_file(
        &mut self,
        index: usize,
        writer: &mut impl Write,
        mut cancelled: impl FnMut() -> bool,
    ) -> Result<u64> {
        let entry = self
            .entries
            .get_mut(index)
            .ok_or("Invalid artifact index")?;
        entry
            .file
            .seek(SeekFrom::Start(0))
            .map_err(|e| e.to_string())?;
        let mut left = entry.length;
        let mut buffer = [0u8; 65536];
        while left > 0 {
            if cancelled() {
                return Err("Artifact copy cancelled".into());
            }
            let take = left.min(buffer.len() as u64) as usize;
            let n = entry
                .file
                .read(&mut buffer[..take])
                .map_err(|e| e.to_string())?;
            if n == 0 {
                return Err("Pinned artifact truncated".into());
            }
            writer.write_all(&buffer[..n]).map_err(|e| e.to_string())?;
            left -= n as u64;
        }
        if cancelled() {
            return Err("Artifact copy cancelled".into());
        }
        Ok(entry.length)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_layouts() {
        assert_eq!(std::mem::size_of::<FileInfo>(), 52);
        if cfg!(target_pointer_width = "64") {
            assert_eq!(std::mem::size_of::<UnicodeString>(), 16);
            assert_eq!(std::mem::size_of::<ObjectAttributes>(), 48);
            assert_eq!(std::mem::size_of::<IoStatus>(), 16);
        }
    }
    #[test]
    fn relative_name_rules() {
        for name in ["", ".", "..", "../a", "a/b", "a\\b", "C:x", "a\0b"] {
            assert!(component(name).is_err());
        }
        assert!(component("中文.bin").is_ok());
    }
    #[test]
    fn reject_nonlocal_paths() {
        for p in [
            "relative",
            "C:relative",
            r"\\server\share\x",
            r"\\?\GLOBALROOT\Device\x",
        ] {
            assert!(anchor(Path::new(p)).is_err());
        }
    }
}
