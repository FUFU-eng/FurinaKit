//! Publish complete JSON records only; .part files are invisible to queue consumers.
use std::{fs, io::Write, path::Path};
pub fn write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path.parent().ok_or("存储路径无效")?;
    let temporary = parent.join(format!(".fk-{}.part",crate::jobs::new_job_id_public()));
    let mut file=fs::OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|e| e.to_string())?;
    let result=file.write_all(bytes).and_then(|_| file.sync_all()).map_err(|e| e.to_string());
    drop(file);
    let result=result.and_then(|_| fs::rename(&temporary,path).map_err(|e| e.to_string()));
    // Only this call's unique unpublished temporary file, not existing records/user files.
    if result.is_err() { let _=fs::remove_file(&temporary); }
    result
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn replace_record_and_failure_preserve_existing_data() {
        let root=std::env::temp_dir().join(format!("fk-atomic-test-{}",crate::jobs::new_job_id_public()));fs::create_dir(&root).unwrap();let path=root.join("job.json");write(&path,b"{\"n\":1}").unwrap();write(&path,b"{\"n\":2}").unwrap();assert_eq!(fs::read(&path).unwrap(),b"{\"n\":2}");
        let directory=root.join("occupied");fs::create_dir(&directory).unwrap();fs::write(directory.join("keep"),b"keep").unwrap();assert!(write(&directory,b"bad").is_err());assert_eq!(fs::read(directory.join("keep")).unwrap(),b"keep");assert_eq!(fs::read_dir(&root).unwrap().count(),2);fs::remove_dir_all(root).unwrap();
    }
}
