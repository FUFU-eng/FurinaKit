//! Opt-in validation capability, not a general host sandbox. Never enabled by production builds.
use std::{path::{Path, PathBuf}, sync::OnceLock};
use serde_json::{json, Value};

struct Context { root: PathBuf, storage: PathBuf, identifier: String, capture_save: bool }
static CONTEXT: OnceLock<Result<Option<Context>, String>> = OnceLock::new();

pub fn dedicated_build() -> bool {
    cfg!(feature = "upscale-validation") && option_env!("CARGO_BIN_NAME") == Some("furinakit-upscale-validation")
}

fn requested(compiled: bool, isolated: bool, scope: Option<&str>) -> Result<bool, String> {
    if !compiled {
        return if scope.is_none() { Ok(false) } else { Err("Validation scope requires the dedicated validation build".into()) };
    }
    if !isolated || scope != Some("upscale") {
        return Err("Validation build requires an isolated profile and FURINAKIT_VALIDATION_SCOPE=upscale".into());
    }
    Ok(true)
}
pub(crate) fn ordinary(path: &Path, directory: bool) -> Result<(), String> {
    let metadata = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    #[cfg(windows)] {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 { return Err("Validation paths must not be reparse points".into()); }
    }
    if metadata.file_type().is_symlink() || (if directory { !metadata.is_dir() } else { !metadata.is_file() }) {
        return Err("Validation path has the wrong type".into());
    }
    Ok(())
}
fn validate_owned(root: &Path, identifier: &str, storage_override: bool) -> Result<Context, String> {
    if storage_override { return Err("Validation storage is pinned; remove FURINAKIT_STORAGE_DIR override".into()); }
    if !root.is_absolute() { return Err("Absolute validation root required".into()); }
    for ancestor in root.ancestors() { ordinary(ancestor, true)?; }
    let marker = root.join(".furinakit-upscale-validation");
    ordinary(&marker, false)?;
    if std::fs::metadata(&marker).map_err(|e| e.to_string())?.len() > 64
        || std::fs::read(&marker).map_err(|e| e.to_string())? != b"upscale-validation-v1\n" {
        return Err("Dedicated upscale validation marker required".into());
    }
    let storage = root.join("storage"); ordinary(&storage, true)?;
    for name in ["uploads", "uploads/incoming", "jobs", "queue", "tmp", "results"] {
        let child = storage.join(name);
        match std::fs::symlink_metadata(&child) {
            Ok(_) => ordinary(&child, true)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
            Err(error) => return Err(error.to_string()),
        }
    }
    Ok(Context { root: root.to_owned(), storage, identifier: identifier.to_owned(), capture_save: false })
}
fn context() -> Result<Option<&'static Context>, String> {
    CONTEXT.get_or_init(|| {
        let identity = crate::launch_identity::current()?;
        let scope = match std::env::var("FURINAKIT_VALIDATION_SCOPE") {
            Ok(value) => Some(value),
            Err(std::env::VarError::NotPresent) => None,
            Err(_) => return Err("Invalid validation scope encoding".into()),
        };
        let capture_save=crate::capture_validation::scope_requested(dedicated_build(),cfg!(feature="capture-save-validation"),identity.isolated,scope.as_deref())?;
        if !capture_save && !requested(dedicated_build(), identity.isolated, scope.as_deref())? { return Ok(None); }
        if !cfg!(windows) { return Err("Upscale validation requires Windows".into()); }
        let root = crate::startup_policy::isolated_root()?.ok_or("Owned isolated root required")?;
        let mut value=validate_owned(root, &identity.identifier, std::env::var_os("FURINAKIT_STORAGE_DIR").is_some())?;
        if capture_save { crate::capture_validation::validate_root(root)?; value.capture_save=true; }
        Ok(Some(value))
    }).as_ref().map(|value| value.as_ref()).map_err(Clone::clone)
}
pub fn validate_startup() -> Result<(), String> { context().map(|_| ()) }
pub fn enabled() -> bool { context().map(|value| value.is_some()).unwrap_or(false) }
pub(crate) fn capture_save_enabled() -> bool { context().map(|v|v.is_some_and(|c|c.capture_save)).unwrap_or(false) }
pub(crate) fn validation_root() -> Result<&'static PathBuf,String> { Ok(&context()?.ok_or("Validation context required")?.root) }
pub fn storage_root() -> &'static PathBuf {
    &context().expect("Validation startup must succeed before file operations").expect("Dedicated validation context required").storage
}
pub fn info() -> Result<Value, String> {
    let c = context()?.ok_or("Validation endpoint is not enabled")?;
    Ok(json!({"scope":if c.capture_save{"capture-save"}else{"upscale"}, "schema":1, "identifier":c.identifier, "root":c.root, "storage":c.storage,
        "pid":std::process::id(), "buildEpoch":env!("FURINAKIT_BUILD_EPOCH"), "ancillaryServices":false,
        "exportAllowed":c.capture_save, "exportRoots":if c.capture_save{crate::capture_validation::roots(&c.root)}else{json!([])}, "desktopCaptureAllowed":false, "productionRelease":false}))
}
pub fn finish(app: &tauri::AppHandle) -> Result<Value, String> {
    context()?.ok_or("Validation endpoint is not enabled")?;
    println!("[upscale-validation] Controlled shutdown requested");
    app.exit(0);
    Ok(json!({"ok":true}))
}
pub fn upload_allowed(name: &str, size: u64) -> bool {
    !name.is_empty() && name.len() <= 200 && !name.chars().any(|c| c.is_control() || "/\\:".contains(c))
        && (1..=128_000_000).contains(&size)
        && [".png", ".jpg", ".jpeg"].iter().any(|suffix| name.to_ascii_lowercase().ends_with(suffix))
}
fn valid_id(value: &str) -> bool { crate::jobs::is_valid_job_id(value) }
fn upload_references(args: &Value) -> bool {
    let Some(obj) = args.as_object() else { return false; };
    if obj.len() != 3 || !obj.contains_key("model") || !obj.contains_key("scale") || !obj.contains_key("__files") { return false; }
    let Some(model) = obj["model"].as_str() else { return false; };
    if model.is_empty() || model.len() > 64 || !model.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-') { return false; }
    let factor = obj["scale"].as_u64().or_else(|| obj["scale"].as_str().and_then(|s| s.parse().ok()));
    if !factor.is_some_and(|n| n <= 4) { return false; }
    let Some(files) = obj["__files"].as_array() else { return false; };
    (1..=50).contains(&files.len()) && files.iter().all(|file| {
        let Some(item) = file.as_object() else { return false; };
        item.len() == 3
            && matches!(item.get("field").and_then(Value::as_str), Some("file" | "files" | "files[]"))
            && item.get("name").and_then(Value::as_str).is_some_and(|name| upload_allowed(name, 1))
            && item.get("uploadToken").and_then(Value::as_str).is_some_and(valid_id)
    })
}
fn scoped_api(path: &str, method: &str, args: &Value) -> bool {
    let Some(obj) = args.as_object() else { return false; };
    match (path, method) {
        ("/api/validation/upscale/info" | "/api/jobs" | "/api/health" | "/api/components", "GET") => obj.is_empty(),
        ("/api/validation/upscale/exit" | "/api/system/scan", "POST") => obj.is_empty(),
        ("/api/tools/image-upscale", "POST" | "PUT") => upload_references(args),
        _ => {
            let Some(rest) = path.strip_prefix("/api/jobs/") else { return false; };
            let (id, action) = rest.split_once('/').unwrap_or((rest, ""));
            if !valid_id(id) { return false; }
            match (action, method) {
                ("", "GET") | ("cancel", "POST") => obj.is_empty(),
                ("download", "GET") => obj.is_empty() || (obj.len() == 1 && (obj.get("preview").and_then(Value::as_str) == Some("1") || obj.get("download").and_then(Value::as_str) == Some("1"))),
                _ => false,
            }
        }
    }
}
fn scoped_command(name: &str) -> bool {
    crate::preview_ipc::command_allowed(true, name)
        || matches!(name, "begin_upload" | "append_upload" | "finish_upload" | "abort_upload")
}
pub fn command_allowed(isolated: bool, name: &str) -> bool {
    if enabled() { scoped_command(name) || (capture_save_enabled() && crate::capture_validation::command_allowed(name)) } else { crate::preview_ipc::command_allowed(isolated, name) }
}
pub fn api_allowed(isolated: bool, path: &str, method: &str, args: &Value) -> bool {
    if enabled() { scoped_api(path, method, args) } else { crate::preview_ipc::api_allowed(isolated, path, method, args) }
}
pub fn authorize_job(app: &tauri::AppHandle, path: &str) -> Result<(), String> {
    if !enabled() { return Ok(()); }
    if let Some(rest) = path.strip_prefix("/api/jobs/") {
        let id = rest.split('/').next().unwrap_or("");
        let job = crate::jobs::read_job_public(app, id).ok_or("Unknown validation job")?;
        if job["toolId"] != "image-upscale" || job["nativeEngine"] != "image" {
            return Err("Job does not belong to the upscale validation capability".into());
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn args() -> Value { json!({"model":"anime-x2","scale":"2","__files":[{"field":"file","name":"fixture.png","uploadToken":"abc-123"}]}) }
    #[test]fn normal_binary_keeps_settings_guard_and_production_policy(){if !dedicated_build(){assert!(!command_allowed(true,"begin_upload"));assert!(!api_allowed(true,"/api/tools/image-upscale","POST",&args()));assert!(command_allowed(false,"future-command"));}}
    #[test]fn production_cannot_enable_the_capability_with_an_environment_flag(){assert_eq!(requested(false,false,None),Ok(false));assert_eq!(requested(false,true,None),Ok(false));assert!(requested(false,true,Some("upscale")).is_err());}
    #[test]fn dedicated_build_cannot_fall_back_to_production(){for isolated in [false,true]{for scope in [None,Some(""),Some("settings"),Some("UPSCALE")]{assert!(requested(true,isolated,scope).is_err());}}assert!(requested(true,false,Some("upscale")).is_err());assert_eq!(requested(true,true,Some("upscale")),Ok(true));}
    #[test]fn only_image_upload_tokens_and_bounded_shapes_are_accepted(){assert!(scoped_api("/api/tools/image-upscale","POST",&args()));let mut x=args();x["__files"][0]["path"]=json!("C:/private.png");assert!(!scoped_api("/api/tools/image-upscale","POST",&x));for k in ["file","files","url","root","destination","outputDir"]{let mut x=args();x[k]=json!("elsewhere");assert!(!scoped_api("/api/tools/image-upscale","POST",&x));}}
    #[test]fn inline_bytes_and_empty_or_large_batches_are_denied(){let mut x=args();x["__files"][0]=json!({"field":"file","name":"x.png","data":"AAAA"});assert!(!upload_references(&x));for n in [0,51]{let mut x=args();x["__files"]=json!(vec![args()["__files"][0].clone();n]);assert!(!upload_references(&x));}}
    #[test]fn removed_models_can_reach_the_real_business_validator_but_paths_cannot(){let mut x=args();x["model"]=json!("anime-x4");x["scale"]=json!(4);assert!(upload_references(&x));x["model"]=json!("../../engine");assert!(!upload_references(&x));}
    #[test]fn job_ids_methods_queries_and_actions_are_exact(){for p in ["/api/jobs/../secret","/api/jobs/abc/cancel/extra","/api/jobs/%61","/api/jobs/abc?x=1"]{assert!(!scoped_api(p,"GET",&json!({})));}assert!(scoped_api("/api/jobs/abc-123","GET",&json!({})));assert!(scoped_api("/api/jobs/abc-123/cancel","POST",&json!({})));assert!(!scoped_api("/api/jobs/abc-123/cancel","GET",&json!({})));assert!(scoped_api("/api/jobs/abc/download","GET",&json!({"preview":"1"})));assert!(!scoped_api("/api/jobs/abc/download","GET",&json!({"path":"elsewhere"})));}
    #[test]fn other_tools_downloads_settings_and_output_paths_stay_denied(){for p in ["/api/worker-extension/download","/api/output-dir","/api/tools/pdf-to-word","/api/settings","/api/transfer","/api/validation/upscale/info/"]{for m in ["GET","POST"]{assert!(!scoped_api(p,m,&json!({})));}}}
    #[test]fn uploads_do_not_enable_export_picker_shell_clipboard_or_updates(){for n in ["begin_upload","append_upload","finish_upload","abort_upload"]{assert!(scoped_command(n));}for n in ["export_upload","save_job_result","save_transfer_result","open_path","open_external","pick_file","clipboard_read","install_update","recorder_start","plugin:fs|read_file"]{assert!(!scoped_command(n));}}
    #[test]fn validation_upload_names_and_sizes_are_bounded(){assert!(upload_allowed("合成.png",16));for name in ["../x.png","C:/x.jpg","x.exe","x.png\0",""]{assert!(!upload_allowed(name,16));}assert!(!upload_allowed("x.png",0));assert!(!upload_allowed("x.png",128_000_001));}
    #[test]fn owned_root_marker_storage_and_override_are_required(){let parent=PathBuf::from(std::env::var_os("FK_UPSCALE_VALIDATION_TEST_ROOT").expect("Explicit isolated test root"));let root=parent.join(uuid::Uuid::new_v4().to_string());std::fs::create_dir_all(&root).unwrap();assert!(validate_owned(&root,"test",false).is_err());std::fs::write(root.join(".furinakit-upscale-validation"),b"upscale-validation-v1\n").unwrap();assert!(validate_owned(&root,"test",false).is_err());std::fs::create_dir(root.join("storage")).unwrap();assert!(validate_owned(&root,"test",true).is_err());let c=validate_owned(&root,"test",false).unwrap();assert_eq!(c.storage,root.join("storage"));std::fs::write(c.storage.join("results"),b"not a directory").unwrap();assert!(validate_owned(&root,"test",false).is_err());assert!(c.storage.join("results").is_file());std::fs::remove_dir_all(root).unwrap();}
}
