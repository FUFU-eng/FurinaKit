//! Read-only inspection of the exact resource set used by the Windows upscale route.
//! No engine execution, driver probe, download, repair, or publisher-authentication claim.
use std::{path::Path, time::{Duration, Instant}};
use serde_json::{json, Value};

fn report(status: &str, files_present: bool, verified: bool, note: String) -> Value {
    json!({
        "status": status, "filesPresent": files_present, "integrityVerified": verified,
        "verification": if verified { "pinned-sha256" } else { "unverified" },
        "componentId": "bundled-upscale-lite-v1", "models": ["anime-x2", "anime-x3"],
        "engineExecuted": false, "functionAccepted": false, "publisherAuthenticated": false,
        "note": note
    })
}

fn ordinary(path: &Path, directory: bool) -> Result<(), (&'static str, String)> {
    use std::os::windows::fs::MetadataExt;
    let metadata = std::fs::symlink_metadata(path).map_err(|error| {
        (if error.kind() == std::io::ErrorKind::NotFound { "missing" } else { "unknown" }, error.to_string())
    })?;
    if metadata.file_attributes() & 0x400 != 0 || metadata.file_type().is_symlink()
        || (if directory { !metadata.is_dir() } else { !metadata.is_file() || metadata.len() == 0 }) {
        return Err(("unknown", "Linked, empty, or nonordinary bundled resource rejected".into()));
    }
    Ok(())
}

pub(crate) fn inspect(app_root: &Path) -> Value {
    let root = app_root.join("tools/engines/upscale-lite");
    let failure = |status: &str, present: bool, error: String| report(status, present, false, format!(
        "内置动漫 2x/3x 资源缺失或未通过校验，请修复安装；不会回退旧 worker。未运行引擎或验证 Vulkan。 / Bundled anime 2x/3x unavailable; no legacy-worker fallback, engine execution or Vulkan verification. {}",
        error.chars().take(1000).collect::<String>()
    ));
    if !root.is_absolute() { return failure("unknown", false, "Absolute bundled root required".into()); }
    // Validate ancestors before checking child paths, so a junction is not treated as a bundle.
    for directory in root.ancestors() {
        if let Err((status, error)) = ordinary(directory, true) { return failure(status, false, error); }
    }
    if let Err((status, error)) = ordinary(&root.join("models"), true) { return failure(status, false, error); }
    let manifest: Value = match serde_json::from_str(crate::upscale_lite::MANIFEST) {
        Ok(value) => value,
        Err(error) => return failure("unknown", false, error.to_string()),
    };
    let Some(files) = manifest["files"].as_array() else {
        return failure("unknown", false, "Invalid compiled resource manifest".into());
    };
    for file in files {
        let Some(relative) = file["path"].as_str() else {
            return failure("unknown", false, "Missing compiled resource path".into());
        };
        if let Err((status, error)) = ordinary(&root.join(relative), false) {
            return failure(status, false, format!("{relative}: {error}"));
        }
    }
    let started = Instant::now();
    let check = || if started.elapsed() > Duration::from_secs(10) {
        Err("Bundled resource verification timed out".into())
    } else { Ok(()) };
    match crate::upscale_lite::acquire(app_root, &check) {
        Ok(assets) => {
            drop(assets); // Diagnostics must not keep a resource lease after returning.
            report("present", true, true, "内置动漫 2x/3x 的 5 个资源已匹配固定 SHA-256；未执行引擎，未验证 Vulkan、图像效果或 GUI，不是发行者签名认证。 / Five bundled resources match pinned SHA-256; engine, Vulkan, image quality and GUI are not tested; not publisher authentication.".into())
        }
        Err(error) => failure("unknown", true, error),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            let base = PathBuf::from(std::env::var_os("FURINAKIT_DIAGNOSTIC_TEST_ROOT").expect("explicit isolated fixture root"));
            let path = base.join(uuid::Uuid::new_v4().to_string());
            std::fs::create_dir_all(&path).unwrap();
            Self(path)
        }
        fn put(&self, relative: &str, bytes: &[u8]) {
            let path = self.0.join(relative);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, bytes).unwrap();
        }
    }
    impl Drop for Temp { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }

    #[test]
    fn missing_bundle_is_not_created_or_reported_ready() {
        let t = Temp::new(); let r = inspect(&t.0);
        assert_eq!(r["status"], "missing"); assert_eq!(r["integrityVerified"], false);
        assert_eq!(r["engineExecuted"], false); assert_eq!(r["functionAccepted"], false);
        assert!(!t.0.join("tools").exists());
    }
    #[test]
    fn old_worker_resource_does_not_satisfy_current_route() {
        let t = Temp::new(); t.put("services/worker/upscale/realesrgan-ncnn-vulkan.exe", b"not executed");
        assert_eq!(inspect(&t.0)["status"], "missing");
    }
    #[test]
    fn non_directory_resource_root_is_unknown() {
        let t = Temp::new(); t.put("tools/engines/upscale-lite", b"not a directory");
        let r = inspect(&t.0); assert_eq!(r["status"], "unknown"); assert_eq!(r["integrityVerified"], false);
    }
    #[test]
    fn mere_file_presence_never_means_verified() {
        let t = Temp::new(); let manifest: Value = serde_json::from_str(crate::upscale_lite::MANIFEST).unwrap();
        for f in manifest["files"].as_array().unwrap() { t.put(&format!("tools/engines/upscale-lite/{}", f["path"].as_str().unwrap()), b"untrusted fixture"); }
        let r = inspect(&t.0); assert_eq!(r["filesPresent"], true); assert_eq!(r["integrityVerified"], false); assert_eq!(r["status"], "unknown");
    }
    #[test]
    fn relative_root_fails_closed() { assert_eq!(inspect(Path::new("relative-fixture"))["status"], "unknown"); }

    #[test]
    #[ignore = "Requires explicit pinned bundled-resource fixture; never downloads resources"]
    fn real_bundle_verified_then_corruption_rejected_without_execution() {
        let source = PathBuf::from(std::env::var_os("FK_UPSCALE_DIAGNOSTIC_SOURCE").expect("explicit pinned source root"));
        let t = Temp::new(); let manifest: Value = serde_json::from_str(crate::upscale_lite::MANIFEST).unwrap();
        for f in manifest["files"].as_array().unwrap() {
            let relative = format!("tools/engines/upscale-lite/{}", f["path"].as_str().unwrap());
            t.put(&relative, &std::fs::read(source.join(&relative)).unwrap());
        }
        let r = inspect(&t.0); assert_eq!(r["status"], "present"); assert_eq!(r["integrityVerified"], true);
        assert_eq!(r["engineExecuted"], false); assert_eq!(r["functionAccepted"], false); assert_eq!(r["publisherAuthenticated"], false);
        let model = t.0.join("tools/engines/upscale-lite/models/realesr-animevideov3-x2.param");
        let mut bytes = std::fs::read(&model).unwrap(); bytes[0] ^= 1; std::fs::write(&model, bytes).unwrap();
        let bad = inspect(&t.0); assert_eq!(bad["filesPresent"], true); assert_eq!(bad["integrityVerified"], false); assert_eq!(bad["status"], "unknown");
        std::fs::remove_file(model).unwrap(); assert_eq!(inspect(&t.0)["status"], "missing");
    }
}
