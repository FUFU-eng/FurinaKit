//! Additional opt-in capability for synthetic pinned images and owned export directories.
//! No desktop capture, clipboard, translation, filesystem picker, or shell access is granted.
use std::path::{Component, Path, PathBuf};
use serde_json::{json, Value};

pub(crate) fn scope_requested(dedicated: bool, compiled: bool, isolated: bool, scope: Option<&str>) -> Result<bool, String> {
    if scope != Some("capture-save") { return Ok(false); }
    if !dedicated || !compiled || !isolated {
        return Err("Capture/save validation requires its feature, dedicated bin and isolated profile".into());
    }
    Ok(true)
}
fn ordinary(path: &Path, directory: bool) -> Result<(), String> {
    crate::upscale_validation::ordinary(path, directory)
}
pub(crate) fn validate_root(root: &Path) -> Result<(), String> {
    let marker = root.join(".furinakit-capture-save-validation");
    ordinary(&marker, false)?;
    if std::fs::metadata(&marker).map_err(|e| e.to_string())?.len() > 64
        || std::fs::read(&marker).map_err(|e| e.to_string())? != b"capture-save-validation-v1\n" {
        return Err("Dedicated capture/save validation marker required".into());
    }
    for dir in [root.join("exports"), root.join("exports/a"), root.join("exports/b")] { ordinary(&dir, true)?; }
    Ok(())
}
pub(crate) fn enabled() -> bool { crate::upscale_validation::capture_save_enabled() }
fn normalized(path: &Path) -> Option<String> {
    if !path.is_absolute() || path.components().any(|c| matches!(c, Component::ParentDir | Component::CurDir)) { return None; }
    let mut text = path.to_str()?.replace('/', "\\");
    if text.starts_with(r"\\?\") { text = text[4..].to_owned(); }
    if text.starts_with(r"\\") || text.contains('\0') { return None; }
    Some(text.trim_end_matches('\\').to_ascii_lowercase())
}
fn output_at(root: &Path, preferred: Option<&str>) -> Result<PathBuf, String> {
    let a = root.join("exports/a"); let b = root.join("exports/b");
    let selected = match preferred.map(str::trim).filter(|p| !p.is_empty()) {
        None => a,
        Some(value) => {
            let key = normalized(Path::new(value)).ok_or("Validation output must be an absolute owned directory")?;
            if Some(key.clone()) == normalized(&a) { a }
            else if Some(key) == normalized(&b) { b }
            else { return Err("Validation output is restricted to the two owned export directories".into()); }
        }
    };
    // Inspect only an allowlisted path, never an untrusted supplied destination.
    for ancestor in selected.ancestors() { ordinary(ancestor, true)?; }
    std::fs::canonicalize(selected).map_err(|e| e.to_string())
}
pub(crate) fn output(preferred: Option<&str>) -> Result<PathBuf, String> {
    if !enabled() { return Err("Capture/save capability is not enabled".into()); }
    output_at(crate::upscale_validation::validation_root()?, preferred)
}
pub(crate) fn roots(root: &Path) -> Value {
    json!([root.join("exports/a"), root.join("exports/b")])
}
pub(crate) fn command_allowed(name: &str) -> bool {
    matches!(name, "pin_image" | "shot_get" | "shot_shape" | "shot_window" | "shot_update" | "shot_save" | "shot_action" | "shot_take_action"
        | "get_default_output_dir" | "sync_output_directory" | "export_upload" | "save_job_result")
}
pub(crate) fn shot_action_allowed(action: &str) -> bool { matches!(action, "upscale" | "pending") }
pub(crate) fn shot_window_allowed(action: &str) -> bool { matches!(action, "ready" | "pin" | "unpin" | "close" | "resize" | "edit") }
pub(crate) fn upload_allowed(name: &str, size: u64) -> bool {
    crate::upscale_validation::upload_allowed(name, size)
        || (!name.is_empty() && name.len() <= 200 && !name.chars().any(|c| c.is_control() || "/\\:".contains(c))
            && name.to_ascii_lowercase().ends_with(".zip") && (1..=128_000_000).contains(&size))
}
pub(crate) fn job_export_allowed(job: &Value, artifact: Option<&str>) -> bool {
    job["toolId"] == "image-upscale" && job["nativeEngine"] == "image" && artifact.is_none()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> PathBuf {
        let base = PathBuf::from(std::env::var_os("FK_CAPTURE_VALIDATION_TEST_ROOT").expect("explicit owned fixture root"));
        let p = base.join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(p.join("exports/a")).unwrap(); std::fs::create_dir_all(p.join("exports/b")).unwrap(); p
    }
    #[test] fn scope_requires_all_three_gates() {
        for (dedicated, compiled, isolated) in [(false,true,true),(true,false,true),(true,true,false)] { assert!(scope_requested(dedicated,compiled,isolated,Some("capture-save")).is_err()); }
        assert_eq!(scope_requested(true,true,true,Some("capture-save")),Ok(true));
        assert_eq!(scope_requested(true,true,true,Some("upscale")),Ok(false));
        assert_eq!(scope_requested(false,false,false,None),Ok(false));
    }
    #[test] fn marker_and_existing_outputs_are_mandatory() {
        let p=root();assert!(validate_root(&p).is_err());
        std::fs::write(p.join(".furinakit-capture-save-validation"),b"capture-save-validation-v1\r\n").unwrap();assert!(validate_root(&p).is_err());
        std::fs::write(p.join(".furinakit-capture-save-validation"),b"capture-save-validation-v1\n").unwrap();assert!(validate_root(&p).is_ok());
        std::fs::remove_dir(p.join("exports/b")).unwrap();assert!(validate_root(&p).is_err());std::fs::remove_dir_all(p).unwrap();
    }
    #[test] fn defaults_and_explicit_choices_stay_inside_owned_directories() {
        let p=root();assert_eq!(output_at(&p,None).unwrap(),std::fs::canonicalize(p.join("exports/a")).unwrap());
        assert_eq!(output_at(&p,p.join("exports/b").to_str()).unwrap(),std::fs::canonicalize(p.join("exports/b")).unwrap());
        assert!(output_at(&p,p.join("outside").to_str()).is_err());assert!(!p.join("outside").exists());
        assert!(output_at(&p,Some("relative")).is_err());assert!(output_at(&p,p.join("exports/a/../b").to_str()).is_err());std::fs::remove_dir_all(p).unwrap();
    }
    #[test] fn missing_or_non_directory_output_never_falls_back_or_recreates() {
        let p=root();std::fs::remove_dir(p.join("exports/b")).unwrap();assert!(output_at(&p,p.join("exports/b").to_str()).is_err());assert!(!p.join("exports/b").exists());
        std::fs::write(p.join("exports/b"),b"keep").unwrap();assert!(output_at(&p,p.join("exports/b").to_str()).is_err());assert_eq!(std::fs::read(p.join("exports/b")).unwrap(),b"keep");std::fs::remove_dir_all(p).unwrap();
    }
    #[test] fn capture_clipboard_shell_picker_and_transfer_stay_denied() {
        for name in ["capture_floating","capture_screen","clipboard_read","clipboard_write_image","open_path","open_output_directory","select_directory","pick_file","save_transfer_result","install_update","recorder_start"] { assert!(!command_allowed(name)); }
        for action in ["copy","ocr","translate","unknown"] { assert!(!shot_action_allowed(action)); }
        assert!(!shot_window_allowed("drag"));assert!(shot_window_allowed("close"));assert!(shot_action_allowed("pending"));
    }
    #[test] fn export_only_allows_owned_upscale_jobs_and_small_named_images_or_zip() {
        assert!(job_export_allowed(&json!({"toolId":"image-upscale","nativeEngine":"image"}),None));
        assert!(!job_export_allowed(&json!({"toolId":"image-upscale","nativeEngine":"image"}),Some("ocr-text")));
        assert!(!job_export_allowed(&json!({"toolId":"other","nativeEngine":"image"}),None));
        assert!(upload_allowed("合成.png",100));assert!(upload_allowed("batch.zip",100));
        for n in ["../batch.zip","C:/x.zip","binary.exe","x.zip\0"] {assert!(!upload_allowed(n,100));}assert!(!upload_allowed("x.zip",128_000_001));
    }
}
