//! One download item backed by two independently verified, reusable model files.
use std::{fs, path::{Path, PathBuf}, sync::{Mutex, OnceLock}, collections::HashMap, time::{Duration, SystemTime}};
use serde_json::{json, Value};
use crate::{api::ComponentInfo, owned_tasks, download_process::OwnedProcess};
pub const ID: &str = "mdx-separation";
pub struct Model { pub file: &'static str, pub size: u64, pub sha: &'static str }
pub const MODELS: &[Model] = &[
    Model { file: "UVR-MDX-NET-Voc_FT.onnx", size: 66_762_490, sha: "534b2070fcc7df514b13ef660dc8cbb328679c2374d04354a5c42bb14ecce111" },
    Model { file: "UVR-MDX-NET-Inst_HQ_3.onnx", size: 66_759_214, sha: "317554b07fe1ea5279a77f2b1520a41ea4b93432560c4ffd08792c30fddf9adc" },
];
pub fn canonical_id(id: &str) -> &str { if matches!(id, "mdx-vocals" | "mdx-instrumental") { ID } else { id } }
pub fn component() -> ComponentInfo {
    ComponentInfo { id: ID.into(), name: "人声与伴奏分离 · 双核心 / Vocal & instrumental pair".into(),
        purpose: "一次下载两种处理核心；复用已校验文件，按所选模式运行，不承诺无损分离 / Two verified models in one download; quality depends on the mix".into(),
        file: ID.into(), size: MODELS.iter().map(|m|m.size).sum(), mirrors: vec![],
        requirement: "CPU 本机推理；总计约 127.3 MiB，首次下载需要联网 / CPU inference; 127.3 MiB download".into(),
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
    info.file_path=if info.downloaded {dir.to_string_lossy().into_owned()} else {String::new()};
}
fn preserve_invalid(path: &Path) -> Result<(), String> {
    if let Ok(meta) = fs::symlink_metadata(path) {
        if !meta.is_file() || meta.file_type().is_symlink() { return Err("模型路径不是普通文件 / Model path is not a regular file".into()); }
        let name=path.file_name().ok_or("模型路径无效")?.to_string_lossy();
        fs::rename(path,path.with_file_name(format!("{name}.invalid-{}",crate::jobs::new_job_id_public()))).map_err(|e|e.to_string())?;
    }
    Ok(())
}
pub fn download(dir: &Path, resources: crate::resource_custody::SharedResource) -> Result<Value, String> {
    let control=owned_tasks::Control { request: std::sync::atomic::AtomicU8::new(0), engine: "component-download".into() };
    for model in MODELS {
        let target=dir.join(model.file); let part=dir.join(format!("{}.part",model.file));
        for path in [&target, &part] {
            if let Ok(meta) = fs::symlink_metadata(path) {
                if !meta.is_file() || meta.file_type().is_symlink() { return Err("模型路径包含链接或目录，未写入 / Refusing linked or non-file model paths".into()); }
            }
        }
        if valid(&target,model,false) { continue; }
        // Never overwrite a pre-existing invalid file; retain it for diagnosis.
        preserve_invalid(&target)?;
        if !valid(&part,model,false) {
            if fs::metadata(&part).map(|m|m.len()>=model.size).unwrap_or(false) { preserve_invalid(&part)?; }
            let mut completed=false; let mut errors=Vec::new();
            for url in [format!("https://www.modelscope.cn/models/pengzhendong/uvr-mdx-net/resolve/master/{}",model.file)].into_iter().chain(["https://gh-proxy.com/https://github.com/", "https://ghproxy.net/https://github.com/", "https://ghfast.top/https://github.com/", "https://github.com/"].iter().map(|prefix|format!("{prefix}TRvlvr/model_repo/releases/download/all_public_uvr_models/{}",model.file))) {
                // url: ModelScope first (fast in mainland China), GitHub relays as fallback.
                let args=vec!["-f".into(),"-sS".into(),"-L".into(),"--ssl-no-revoke".into(),"--proto".into(),"=https".into(),"--proto-redir".into(),"=https".into(),
                    "-C".into(),"-".into(),"--retry".into(),"2".into(),"--connect-timeout".into(),"8".into(),"--speed-limit".into(),"20480".into(),"--speed-time".into(),"30".into(),"--max-time".into(),"3600".into(),
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
        if target.exists() { return Err("模型目标已发生变化，请刷新后重试 / Model destination changed".into()); }
        fs::rename(&part,&target).map_err(|e|e.to_string())?;
    }
    Ok(json!({"ok":true,"message":"双核心已就绪，两个文件 SHA-256 校验通过 / Both model checksums verified"}))
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
    Ok(json!({"ok":true,"message":"已删除双核心组件 / Both model files removed"}))
}
