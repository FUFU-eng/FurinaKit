//! Relocatable runtime and optional media engines. Never require a developer checkout.
use std::{path::{Path,PathBuf},process::Command};
static COMPONENTS: crate::component_root::RootState = crate::component_root::RootState::new();
pub fn initialize_components_dir(root:&Path,data:&Path,configured:Option<PathBuf>)->Result<PathBuf,String>{COMPONENTS.initialize(root,data,configured)}
pub fn registered_components_dir()->Result<PathBuf,String>{COMPONENTS.get()}
pub fn bundled_root(executable_dir:&Path)->Option<PathBuf>{
    [executable_dir.to_path_buf(),executable_dir.join("resources")].into_iter().find(|root|
        manifest(root).is_some())
}
/// Read only a small, recognized application manifest; a filename alone is not a runtime contract.
fn manifest(root: &Path) -> Option<serde_json::Value> {
    let path = root.join("FurinaKit-runtime.json");
    if std::fs::metadata(&path).ok()?.len() > 64 * 1024 { return None; }
    let value: serde_json::Value = serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
    let runtime = value.get("runtime")?.as_str()?;
    if !matches!(runtime, "native-rust" | "embedded-python-3.14.2") { return None; }
    value.get("version")?.as_str()?;
    Some(value)
}
pub fn is_native_base(root: &Path) -> bool {
    manifest(root).and_then(|v| v.get("runtime").and_then(|r| r.as_str()).map(|r| r == "native-rust")).unwrap_or(false)
}
/// A native installation must never accidentally execute an obsolete worker left by an upgrade.
/// Optional Python tools have an explicit, separate component root; no system Python discovery.
pub fn worker_root(root: &Path, components: &Path) -> Option<PathBuf> {
    let has_worker = |p: &Path| p.join("services/worker/worker.py").is_file()
        && p.join("services/worker/.venv/Scripts/python.exe").is_file();
    let plugin = components.join("python-tools");
    if is_native_base(root) {
        return has_worker(&plugin).then_some(plugin);
    }
    if has_worker(root) || root.join("resources/worker/furinakit-worker.exe").is_file() {
        Some(root.to_owned())
    } else { has_worker(&plugin).then_some(plugin) }
}
fn media_candidates(root:&Path,components:Option<&Path>,name:&str)->Vec<PathBuf>{
    if !matches!(name,"ffmpeg"|"ffprobe"){return vec![];}
    let mut dirs=Vec::new();
    if let Some(dir)=components{dirs.push(dir.to_owned());dirs.push(dir.join("ffmpeg"));}
    dirs.extend([root.to_owned(),root.join("tools/engines/ffmpeg"),root.join("services/worker"),root.join("resources"),root.join("components")]);
    dirs.into_iter().map(|dir|dir.join(format!("{name}.exe"))).collect()
}
pub fn find_media_tool(name:&str,root:&Path)->Option<PathBuf>{
    let components=registered_components_dir().ok()?;
    media_candidates(root,Some(&components),name).into_iter().find(|path|path.is_file())
}
pub fn configure_worker_tools(command:&mut Command,root:&Path,components:&Path){
    let mut paths=vec![components.to_owned(),components.join("ffmpeg")];
    for name in ["ffmpeg","ffprobe"]{
        if let Some(path)=media_candidates(root,Some(components),name).into_iter().find(|path|path.is_file()){
            command.env(format!("FURINAKIT_{}_PATH",name.to_uppercase()),&path);
            command.env(format!("{}_PATH",name.to_uppercase()),&path);
            if let Some(parent)=path.parent(){if !paths.iter().any(|p|p==parent){paths.push(parent.to_owned());}}
        }
    }
    paths.extend(std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default()));
    if let Ok(path)=std::env::join_paths(paths){command.env("PATH",path);}
    command.env("FURINAKIT_COMPONENTS_DIR",components).env("PYTHONUTF8","1").env("PYTHONNOUSERSITE","1");
}
#[cfg(test)]
mod tests{
    use super::*;
    #[test] fn packaged_root_wins_over_leftover_electron_resources(){
        let root=std::env::temp_dir().join(format!("fk-layout-{}",uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("resources/worker")).unwrap();
        assert!(bundled_root(&root).is_none());
        std::fs::create_dir_all(root.join("services/worker/.venv/Scripts")).unwrap();
        std::fs::write(root.join("FurinaKit-runtime.json"), br#"{"version":"2.1.0","runtime":"native-rust"}"#).unwrap();
        assert_eq!(bundled_root(&root),Some(root.clone()));
        std::fs::remove_dir_all(root).unwrap();
    }
    #[test] fn downloaded_media_precedes_legacy_engines_and_survives_restartless_install(){
        let root=std::env::temp_dir().join(format!("fk-media-layout-{}",uuid::Uuid::new_v4()));
        let components=root.join("profile-components");std::fs::create_dir_all(&components).unwrap();
        let candidates=media_candidates(&root,Some(&components),"ffmpeg");
        assert_eq!(candidates[0],components.join("ffmpeg.exe"));
        assert!(candidates.iter().all(|p|!p.exists()));
        let mut command=Command::new("fixture.exe");configure_worker_tools(&mut command,&root,&components);
        let path=command.get_envs().find(|(key,_)|*key=="PATH").unwrap().1.unwrap();
        assert_eq!(std::env::split_paths(path).next().unwrap(),components);
        std::fs::write(components.join("ffmpeg.exe"),b"fixture").unwrap();
        assert_eq!(candidates.into_iter().find(|p|p.is_file()),Some(components.join("ffmpeg.exe")));
        assert!(media_candidates(&root,Some(&components),"../unexpected").is_empty());
        std::fs::remove_dir_all(root).unwrap();
    }
}
