//! Pin legacy Python worker staging to the native job store, never Electron settings.
use std::{fs, path::Path, process::Command};

pub fn configure(cmd: &mut Command, storage: &Path) -> Result<(), String> {
    fs::create_dir_all(storage.join("results")).map_err(|e| e.to_string())?;
    let storage = fs::canonicalize(storage).map_err(|e| e.to_string())?;
    let results = storage.join("results");
    // storage_paths.py consults Electron outputDir BEFORE the environment default.
    // Give it a dedicated non-secret projection instead of a user's settings file.
    // Results are internal staging; native Save As still chooses the final destination.
    let settings = storage.join("native-worker-settings.json");
    crate::atomic_store::write(&settings, &serde_json::to_vec(&serde_json::json!({"outputDir":results}))
        .map_err(|e| e.to_string())?)?;
    cmd.env("STORAGE_DIR", &storage)
        .env("STORAGE_PATH", &storage)
        .env("FURINAKIT_SETTINGS_FILE", settings)
        .env("FURINAKIT_DEFAULT_OUTPUT_DIR", results);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn environment_and_settings_use_same_owned_staging() {
        let root=std::env::temp_dir().join(format!("fk-worker-env-{}",crate::jobs::new_job_id_public()));
        let mut cmd=Command::new("unused-no-process-started");
        configure(&mut cmd,&root).unwrap();
        let canonical=fs::canonicalize(&root).unwrap();
        let vars:std::collections::HashMap<_,_>=cmd.get_envs().map(|(k,v)|(k.to_string_lossy().to_string(),v.unwrap().to_string_lossy().to_string())).collect();
        assert_eq!(vars["STORAGE_DIR"],vars["STORAGE_PATH"]);
        assert_eq!(Path::new(&vars["STORAGE_PATH"]),canonical);
        let projection:serde_json::Value=serde_json::from_slice(&fs::read(&vars["FURINAKIT_SETTINGS_FILE"]).unwrap()).unwrap();
        assert_eq!(projection.as_object().unwrap().len(),1);
        assert_eq!(projection["outputDir"].as_str().unwrap(),vars["FURINAKIT_DEFAULT_OUTPUT_DIR"]);
        assert_eq!(Path::new(projection["outputDir"].as_str().unwrap()),canonical.join("results"));
        // Safe to call again on restart; no read of real user settings.
        configure(&mut cmd,&root).unwrap();
        fs::remove_dir_all(root).unwrap();
    }
}
