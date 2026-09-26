//! A single result resolver for download, save and media streaming.
use std::{fs, path::{Path, PathBuf}};
use serde_json::Value;
#[cfg(test)]
#[path = "artifact_worker_tests.rs"]
mod worker_regressions;
// Validate on every platform using Windows rules, including ADS and aliases.
fn valid_worker_basename(name: &str) -> bool {
    if name.is_empty() || name.len() > 768 || name == "." || name == ".."
        || name.ends_with(['.', ' '])
        || name.chars().any(|c| c.is_control() || "<>:\"/\\|?*".contains(c)) { return false; }
    let head = name.split('.').next().unwrap_or("").to_ascii_uppercase();
    if matches!(head.as_str(), "CON" | "PRN" | "AUX" | "NUL") { return false; }
    if head.len() == 4 && (head.starts_with("COM") || head.starts_with("LPT"))
        && matches!(head.as_bytes()[3], b'1'..=b'9') { return false; }
    true
}
pub fn resolve(root: &Path, job: &Value) -> Option<PathBuf> {
    let id = job.get("id")?.as_str()?;
    if !crate::jobs::is_valid_job_id(id) || job["status"].as_str() != Some("completed") { return None; }
    let root = fs::canonicalize(root).ok()?;
    // Explicit paths remain authoritative, even when malformed or missing. Never
    // fall back from a broken explicit record to another file on disk.
    let path = if let Some(value) = ["resultPath", "outputPath", "result", "output"].iter()
        .find_map(|key| job.get(*key)) {
        let raw = value.as_str().filter(|s| !s.is_empty())?;
        fs::canonicalize(raw).ok()?
    } else {
        // Python worker's _store_result publishes exactly {id}-{safe_name}.
        // This is a single deterministic lookup, NOT a scan or fuzzy ID match.
        let name = job.get("resultFilename")?.as_str()?;
        if !valid_worker_basename(name) { return None; }
        let results = root.join("results");
        if fs::canonicalize(&results).ok()? != results { return None; }
        let candidate = results.join(format!("{id}-{name}"));
        if fs::symlink_metadata(&candidate).ok()?.file_type().is_symlink() { return None; }
        let canonical = fs::canonicalize(&candidate).ok()?;
        if canonical != candidate { return None; }
        canonical
    };
    let relative = path.strip_prefix(&root).ok()?;
    if !matches!(relative.components().next()?.as_os_str().to_str(), Some("results" | "outputs" | "artifacts")) { return None; }
    let meta = fs::metadata(&path).ok()?;
    if !meta.is_file() || meta.len() == 0 || fs::File::open(&path).is_err() { return None; }
    Some(path)
}
/// Fixed PDF OCR sidecar; no arbitrary paths, scans, or fallback to the main PDF.
pub fn resolve_ocr_text(root: &Path, job: &Value) -> Option<PathBuf> {
    if job["toolId"].as_str() != Some("ocr-pdf") || job["nativeEngine"].as_str() != Some("ocr")
        || job["status"].as_str() != Some("completed") { return None; }
    let name = job["textResultFilename"].as_str()?;
    if !name.ends_with("_文字.txt") { return None; }
    resolve(root, &serde_json::json!({"id":job["id"],"status":"completed","resultFilename":name}))
}
/// Only the fixed, job-owned V66 stems; never accept a caller-supplied file path.
pub fn resolve_stem(root: &Path, job: &Value, stem: &str) -> Option<PathBuf> {
    if job["toolId"].as_str() != Some("vocal-separate") || job["audioStems"].as_bool() != Some(true)
        || job["status"].as_str() != Some("completed") { return None; }
    let filename = match stem { "vocals" => "vocals.wav", "instrumental" => "instrumental.wav", _ => return None };
    resolve(root, &serde_json::json!({"id":job["id"], "status":"completed", "resultFilename":filename}))
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn only_completed_explicit_owned_nonempty_files() {
        let root = std::env::temp_dir().join(format!("fk-artifact-test-{}", crate::jobs::new_job_id_public()));
        for sub in ["results", "uploads", "jobs", "outputs", "artifacts"] { fs::create_dir_all(root.join(sub)).unwrap(); }
        let path = root.join("results/result.mp4"); fs::write(&path,b"video").unwrap();
        let mut job = json!({"id":"abc-123", "status":"completed", "resultPath":path});
        assert!(resolve(&root,&job).is_some());
        job["status"]=json!("processing"); assert!(resolve(&root,&job).is_none()); job["status"]=json!("completed");
        job["id"]=json!(""); assert!(resolve(&root,&job).is_none());job["id"]=json!("abc-123");
        for sub in ["uploads", "jobs", ""] { let p=root.join(sub).join("private.txt");fs::write(&p,b"private").unwrap();job["resultPath"]=json!(p);assert!(resolve(&root,&job).is_none()); }
        job["resultPath"]=json!(root.join("results/missing.mp4"));job["outputPath"]=json!(path);assert!(resolve(&root,&job).is_none());
        job["resultPath"]=json!(path);fs::write(&path,b"").unwrap();assert!(resolve(&root,&job).is_none());
        job.as_object_mut().unwrap().remove("resultPath");job.as_object_mut().unwrap().remove("outputPath");fs::write(root.join("results/abc-123.mp4"),b"ambiguous").unwrap();assert!(resolve(&root,&job).is_none());
        fs::remove_dir_all(root).unwrap();
    }
}
