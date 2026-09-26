//! Optional media engine pair. No download happens without an explicit user action.
use std::{fs, path::{Path, PathBuf}, sync::{Mutex, OnceLock}, collections::HashMap, time::{Duration, SystemTime}};
use serde_json::{json, Value};
use crate::{api::ComponentInfo, owned_tasks, download_process::OwnedProcess};
pub const ID: &str = "ffmpeg";
pub struct Model { pub file: &'static str, pub size: u64, pub sha: &'static str }
pub const MODELS: &[Model] = &[
    Model { file: "ffmpeg.exe", size: 102856192, sha: "72a489eccd008c2ec2c0a5856c5c75bc3d8bbfa90166c4566865c246445e6aa3" },
    Model { file: "ffprobe.exe", size: 102652416, sha: "19202b23c0043f15ad1b7bce2344f406fd52bd6efd8f995ce02e7392a1cec52f" },
];
/// v2.1.0: the pair ships inside the installer (`<install>/tools/engines/ffmpeg/`).
/// It is placed into the components directory on first use (hard link when possible,
/// otherwise a verified copy), so every existing consumer keeps using one location.
pub fn bundled_dir()->Option<PathBuf>{
    let exe=std::env::current_exe().ok()?;let root=exe.parent()?;
    let dir=root.join("tools").join("engines").join("ffmpeg");
    if MODELS.iter().all(|m|fs::metadata(dir.join(m.file)).map(|x|x.is_file()&&x.len()==m.size).unwrap_or(false)){Some(dir)}else{None}
}
pub fn ensure_bundled(dir:&Path){
    static LOCK: OnceLock<Mutex<()>>=OnceLock::new();
    let _guard=LOCK.get_or_init(||Mutex::new(())).lock().unwrap_or_else(|e|e.into_inner());
    let Some(src)=bundled_dir() else { return; };
    if fs::create_dir_all(dir).is_err() { return; }
    for m in MODELS {
        let target=dir.join(m.file);
        if valid(&target,m,true) { continue; }
        // Replaced by the verified bundled copy; an outdated regular file is removed, anything else is kept aside.
        if let Ok(meta)=fs::symlink_metadata(&target) { if !(meta.is_file() && !meta.file_type().is_symlink() && fs::remove_file(&target).is_ok()) { if preserve_invalid(&target).is_err() { return; } } }
        let staging=dir.join(format!("{}.bundled-{}",m.file,std::process::id()));
        let _=fs::remove_file(&staging);
        if fs::hard_link(src.join(m.file),&staging).is_err() && fs::copy(src.join(m.file),&staging).is_err() { let _=fs::remove_file(&staging); return; }
        if !valid(&staging,m,false) || fs::rename(&staging,&target).is_err() { let _=fs::remove_file(&staging); return; }
    }
}
/// Metadata-only preflight; background jobs still verify both pinned hashes before executing.
pub fn pair_present(dir:&Path)->bool{
    ensure_bundled(dir);
    [dir.to_owned(),dir.join("ffmpeg")].iter().any(|root|MODELS.iter().all(|m|fs::symlink_metadata(root.join(m.file)).map(|s|s.is_file()&&!s.file_type().is_symlink()&&s.len()==m.size).unwrap_or(false)))
}
pub fn verified_pair(dir:&Path)->Result<(PathBuf,PathBuf),String>{
    ensure_bundled(dir);
    for root in [dir.to_owned(),dir.join("ffmpeg")]{if MODELS.iter().all(|m|valid(&root.join(m.file),m,false)){return Ok((fs::canonicalize(root.join("ffmpeg.exe")).map_err(|e|e.to_string())?,fs::canonicalize(root.join("ffprobe.exe")).map_err(|e|e.to_string())?));}}
    Err("FFmpeg / FFprobe缺失或SHA-256不符，请在组件管理中重新下载；原文件未删除 / Media engine pair missing or checksum mismatch; existing files preserved".into())
}
pub fn component() -> ComponentInfo {
    ComponentInfo { id: ID.into(), name: "FFmpeg / FFprobe 音视频处理与检测引擎".into(),
        purpose: "转码、压缩、裁剪、提取、录屏与媒体信息检测。已随安装包内置，无需下载。".into(),
        file: "ffmpeg.exe".into(), size: MODELS.iter().map(|m|m.size).sum(), mirrors: vec![],
        requirement: "Windows x64；本地处理，支持可用的硬件编解码；已内置。".into(),
        downloaded: false, downloaded_bytes: 0, file_path: String::new(), busy: false }
}
type Cache = HashMap<PathBuf, (u64, SystemTime, bool)>;
fn cache() -> &'static Mutex<Cache> { static CACHE: OnceLock<Mutex<Cache>>=OnceLock::new(); CACHE.get_or_init(||Mutex::new(HashMap::new())) }
fn valid(path: &Path, model: &Model, cached: bool) -> bool {
    let Ok(meta)=fs::symlink_metadata(path) else { return false; };
    if !meta.is_file() || meta.file_type().is_symlink() || meta.len()!=model.size { return false; }
    let Ok(stamp)=meta.modified() else { return false; };
    if cached {
        if let Some((len,time,result))=cache().lock().unwrap_or_else(|e|e.into_inner()).get(path) {
            if *len==meta.len() && *time==stamp { return *result; }
        }
    }
    let result=owned_tasks::digest(path).map(|h|h==model.sha).unwrap_or(false);
    cache().lock().unwrap_or_else(|e|e.into_inner()).insert(path.to_owned(),(meta.len(),stamp,result));
    result
}
pub fn inspect(info: &mut ComponentInfo, dir: &Path) {
    ensure_bundled(dir);
    info.downloaded=true; info.downloaded_bytes=0;
    for model in MODELS {
        let path=dir.join(model.file);
        let ready=valid(&path,model,true);
        info.downloaded &= ready;
        info.downloaded_bytes += if ready { model.size } else {
            fs::metadata(dir.join(format!("{}.part",model.file))).ok().filter(|m|m.is_file()).map(|m|m.len().min(model.size)).unwrap_or(0)
        };
    }
    info.busy=crate::api::component_busy(&info.id);
    info.file_path=if info.downloaded {dir.join("ffmpeg.exe").to_string_lossy().into_owned()} else {String::new()};
}
fn preserve_invalid(path: &Path) -> Result<(), String> {
    if let Ok(meta) = fs::symlink_metadata(path) {
        if !meta.is_file() || meta.file_type().is_symlink() { return Err("音视频组件路径不是普通文件 / Model path is not a regular file".into()); }
        let name=path.file_name().ok_or("音视频组件路径无效")?.to_string_lossy();
        fs::rename(path,path.with_file_name(format!("{name}.invalid-{}",crate::jobs::new_job_id_public()))).map_err(|e|e.to_string())?;
    }
    Ok(())
}
pub fn download(dir: &Path, resources: crate::resource_custody::SharedResource) -> Result<Value, String> {
    ensure_bundled(dir);
    if MODELS.iter().all(|m|valid(&dir.join(m.file),m,false)) { return Ok(json!({"ok":true,"message":"FFmpeg / FFprobe 已内置并通过 SHA-256 校验"})); }
    let control=owned_tasks::Control { request: std::sync::atomic::AtomicU8::new(0), engine: "component-download".into() };
    for model in MODELS {
        let target=dir.join(model.file); let part=dir.join(format!("{}.part",model.file));
        for path in [&target, &part] {
            if let Ok(meta) = fs::symlink_metadata(path) {
                if !meta.is_file() || meta.file_type().is_symlink() { return Err("音视频组件路径包含链接或目录，未写入 / Refusing linked or non-file model paths".into()); }
            }
        }
        if valid(&target,model,false) { continue; }
        // Never overwrite a pre-existing invalid file; retain it for diagnosis.
        preserve_invalid(&target)?;
        if !valid(&part,model,false) {
            let local_candidates = [
                PathBuf::from("release-assets").join(model.file),
                PathBuf::from(r"E:\FurinaKit-Tauri\release-assets").join(model.file),
                std::env::current_exe().ok().and_then(|e| e.parent().map(|p| p.join("release-assets").join(model.file))).unwrap_or_default(),
                std::env::current_exe().ok().and_then(|e| e.parent().map(|p| p.join(model.file))).unwrap_or_default(),
            ];
            for candidate in &local_candidates {
                if candidate.is_file() && valid(candidate, model, false) {
                    let _ = fs::copy(candidate, &part);
                    break;
                }
            }
        }
        if !valid(&part,model,false) {
            if fs::metadata(&part).map(|m|m.len()>=model.size).unwrap_or(false) { preserve_invalid(&part)?; }
            let mut completed=false; let mut errors=Vec::new();
            for prefix in ["https://gh-proxy.com/https://github.com/", "https://ghproxy.net/https://github.com/", "https://ghfast.top/https://github.com/", "https://github.com/"] {
                let url=format!("{prefix}FUFU-eng/FurinaKit/releases/download/v2.1.0/{}",model.file);
                let args=vec!["--disable".into(),"-f".into(),"-sS".into(),"-L".into(),"--ssl-no-revoke".into(),"--proto".into(),"=https".into(),"--proto-redir".into(),"=https".into(),
                    "-C".into(),"-".into(),"--retry".into(),"2".into(),"--connect-timeout".into(),"8".into(),"--max-time".into(),"3600".into(),
                    "--max-filesize".into(),model.size.to_string(),"-o".into(),part.to_string_lossy().into_owned(),url];
                let result=match OwnedProcess::spawn(&owned_tasks::system_tool("curl.exe")?,&args,dir) {
                    Ok(p) => {
                        let p=crate::resource_custody::Custody::new(p, resources.clone());
                        let outcome=owned_tasks::wait(&p,&control,Duration::from_secs(3650));
                        // Never retry a mirror or mutate partial files under a live old tree.
                        p.after_exit(outcome)?
                    },
                    Err(error) => Err(error),
                };
                if result.is_ok() && valid(&part,model,false) { completed=true; break; }
                errors.push(result.err().unwrap_or_else(||"SHA-256校验失败 / Checksum mismatch".into()));
                if fs::metadata(&part).map(|m|m.len()>=model.size).unwrap_or(false) { preserve_invalid(&part)?; }
            }
            if !completed { return Err(format!("{} 下载失败：{}。已校验的另一个核心与未完成部分均已保留 / Verified files and partial download retained",model.file,errors.join("; "))); }
        }
        // A competing external installation must not be overwritten.
        if target.exists() { return Err("音视频组件目标已发生变化，请刷新后重试 / Model destination changed".into()); }
        fs::rename(&part,&target).map_err(|e|e.to_string())?;
    }
    Ok(json!({"ok":true,"message":"FFmpeg / FFprobe已就绪，两个文件 SHA-256 校验通过 / Both media engine checksums verified"}))
}
pub fn delete(dir: &Path) -> Result<Value, String> {
    for model in MODELS {
        // Explicit user action, fixed model basenames only. Keep .invalid evidence.
        for file in [model.file.to_string(),format!("{}.part",model.file)] {
            let path=dir.join(file);
            if path.is_file() { fs::remove_file(&path).map_err(|e|e.to_string())?; }
            cache().lock().unwrap_or_else(|e|e.into_inner()).remove(&path);
        }
    }
    Ok(json!({"ok":true,"message":"已删除FFmpeg / FFprobe组件 / Both media engines removed"}))
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn optional_media_requires_both_verified_executables(){
        assert_eq!(MODELS.len(),2);assert_eq!(component().size,MODELS.iter().map(|m|m.size).sum::<u64>());
        let dir=std::env::temp_dir().join(format!("fk-media-component-{}",uuid::Uuid::new_v4()));
        fs::create_dir(&dir).unwrap();let mut info=component();inspect(&mut info,&dir);assert!(!info.downloaded);
        fs::write(dir.join("ffmpeg.exe"),b"partial").unwrap();inspect(&mut info,&dir);assert!(!info.downloaded);
        let model=Model{file:"small.fixture",size:3,sha:"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"};
        let path=dir.join(model.file);fs::write(&path,b"abc").unwrap();assert!(valid(&path,&model,false));
        fs::write(&path,b"xyz").unwrap();assert!(!valid(&path,&model,false));fs::remove_dir_all(dir).unwrap();
    }
}
