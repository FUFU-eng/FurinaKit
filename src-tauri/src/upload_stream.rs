//! Bounded IPC uploads. Tokens refer only to files created by this process, never caller paths.
use std::{collections::HashMap, fs::{self, File}, io::Write, path::{Path, PathBuf}, sync::{Mutex, OnceLock}, time::{Duration, Instant}};
use serde_json::{json, Value};
const CHUNK: usize = 1024 * 1024;
struct Upload { file: Option<File>, path: PathBuf, root: PathBuf, name: String, size: u64, written: u64, touched: Instant, claimed: bool }
impl Drop for Upload {
    fn drop(&mut self) {
        self.file.take();
        // Only our newly-created temporary copy, never the selected original file.
        if !self.claimed { let _ = fs::remove_file(&self.path); }
    }
}
fn uploads() -> &'static Mutex<HashMap<String, Upload>> {
    static STORE: OnceLock<Mutex<HashMap<String, Upload>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(HashMap::new()))
}
fn decode_chunk(data: &str) -> Result<Vec<u8>, String> {
    if data.len() > ((CHUNK + 2) / 3) * 4 || data.len() % 4 != 0 { return Err("上传分块大小或编码无效".into()); }
    let pad = data.bytes().rev().take_while(|c| *c == b'=').count();
    if pad > 2 || !data.as_bytes()[..data.len()-pad].iter().all(|c| c.is_ascii_alphanumeric() || *c == b'+' || *c == b'/') {
        return Err("上传分块编码无效".into());
    }
    let bytes = crate::jobs::b64_decode_public(data);
    if bytes.len() > CHUNK || bytes.len() != data.len()/4*3-pad { return Err("上传分块长度无效".into()); }
    Ok(bytes)
}
fn begin_at(root: &Path, name: String, size: u64) -> Result<String, String> {
    if name.len() > 1024 { return Err("文件名过长".into()); }
    let mut store = uploads().lock().map_err(|_| "上传状态不可用")?;
    store.retain(|_, u| u.touched.elapsed() < Duration::from_secs(3600));
    if store.len() >= 4096 { return Err("待处理上传过多，请完成当前任务后重试".into()); }
    let token = crate::jobs::new_job_id_public();
    let dir = root.join("uploads").join("incoming");
    fs::create_dir_all(&dir).map_err(|e| format!("创建上传目录失败：{e}"))?;
    let path = dir.join(format!("{token}.part"));
    let file = fs::OpenOptions::new().write(true).create_new(true).open(&path).map_err(|e| format!("创建上传文件失败：{e}"))?;
    store.insert(token.clone(), Upload { file: Some(file), path, root: root.to_path_buf(), name, size, written: 0, touched: Instant::now(), claimed: false });
    Ok(token)
}
fn append(token: &str, offset: u64, data: &str) -> Result<(), String> {
    let bytes = decode_chunk(data)?;
    if bytes.is_empty() { return Err("上传分块不能为空".into()); }
    let mut store = uploads().lock().map_err(|_| "上传状态不可用")?;
    let u = store.get_mut(token).ok_or("上传已取消或过期")?;
    if offset != u.written || bytes.len() as u64 > u.size.saturating_sub(u.written) { return Err("上传分块顺序或文件大小不匹配".into()); }
    u.file.as_mut().ok_or("上传已结束")?.write_all(&bytes).map_err(|e| format!("写入上传文件失败：{e}"))?;
    u.written += bytes.len() as u64;
    u.touched = Instant::now();
    Ok(())
}
fn finish(token: &str) -> Result<(), String> {
    let mut store = uploads().lock().map_err(|_| "上传状态不可用")?;
    let u = store.get_mut(token).ok_or("上传已取消或过期")?;
    if u.written != u.size { return Err("文件尚未上传完整".into()); }
    if let Some(file) = u.file.as_mut() {
        file.flush().map_err(|e| e.to_string())?;
        if file.metadata().map_err(|e| e.to_string())?.len() != u.size { return Err("上传文件实际长度不匹配".into()); }
    }
    u.file.take();
    u.touched = Instant::now();
    Ok(())
}
fn disk_name(name: &str) -> String {
    let leaf = name.rsplit(['/', '\\']).next().unwrap_or("upload.bin");
    let safe: String = leaf.chars().map(|c| if c.is_control() || "\\/:*?\"<>|".contains(c) { '_' } else { c }).collect();
    let (stem, extension) = match safe.rsplit_once('.') {
        Some((stem, ext)) if !ext.is_empty() && ext.len() <= 16 && ext.bytes().all(|c| c.is_ascii_alphanumeric()) => (stem, ext),
        _ => (safe.as_str(), "bin"),
    };
    let stem: String = stem.chars().take(80).collect();
    format!("file-{}.{}", stem.trim_end_matches(['.', ' ']), extension)
}
pub fn claim(app: &tauri::AppHandle, token: &str, job_id: &str, field: &str) -> Result<Value, String> {
    claim_at(&crate::jobs::storage_dir(app), token, job_id, field)
}
fn claim_at(root: &Path, token: &str, job_id: &str, field: &str) -> Result<Value, String> {
    if !crate::jobs::is_valid_job_id(job_id) { return Err("无效任务编号".into()); }
    let mut store = uploads().lock().map_err(|_| "上传状态不可用")?;
    let u = store.get(token).ok_or("上传文件不存在或已使用")?;
    if u.file.is_some() || u.written != u.size || u.root != root { return Err("上传尚未完成或归属不匹配".into()); }
    let mut u = store.remove(token).unwrap();
    drop(store);
    let dir = root.join("uploads").join(job_id).join(token);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let target = dir.join(disk_name(&u.name));
    if target.exists() { return Err("上传目标已经存在".into()); }
    fs::rename(&u.path, &target).map_err(|e| format!("接收上传文件失败：{e}"))?;
    u.claimed = true;
    Ok(json!({"field":field,"name":u.name,"path":target.to_string_lossy(),"size":u.size}))
}
#[tauri::command]
pub async fn begin_upload(app: tauri::AppHandle, name: String, size: u64) -> Result<String, String> {
    let validation_upload=if crate::capture_validation::enabled(){crate::capture_validation::upload_allowed(&name,size)}else{crate::upscale_validation::upload_allowed(&name,size)};
    if crate::upscale_validation::enabled() && !validation_upload {
        return Err("Validation uploads must be bounded PNG/JPEG files".into());
    }
    begin_at(&crate::jobs::storage_dir(&app), name, size)
}
#[tauri::command]
pub async fn append_upload(token: String, offset: u64, data: String) -> Result<(), String> { append(&token, offset, &data) }
#[tauri::command]
pub async fn finish_upload(token: String) -> Result<(), String> { finish(&token) }
#[tauri::command]
pub async fn abort_upload(token: String) -> Result<(), String> {
    uploads().lock().map_err(|_| "上传状态不可用")?.remove(&token);
    Ok(())
}

/// Consume only this process's finished upload token. No caller-supplied filesystem paths.
#[tauri::command]
pub async fn export_upload(app: tauri::AppHandle, token: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let root = crate::jobs::storage_dir(&app);
        let mut store = uploads().lock().map_err(|_| "上传状态不可用")?;
        let u = store.get(&token).ok_or("下载内容已取消或过期")?;
        if u.file.is_some() || u.written != u.size || u.root != root { return Err("下载内容尚未就绪或归属不匹配".into()); }
        let u = store.remove(&token).ok_or("下载内容已使用")?;
        drop(store);
        let path = crate::default_output::save_file(&app, &u.path, &u.name)?;
        // u remains unclaimed: Drop removes only its owned staging copy, on success or error.
        Ok(path.to_string_lossy().into_owned())
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> PathBuf { let p=std::env::temp_dir().join(format!("fk-stream-test-{}",crate::jobs::new_job_id_public()));fs::create_dir(&p).unwrap();p }
    #[test]
    fn ordered_stream_claim_and_duplicate_names() {
        let root=root();let id=crate::jobs::new_job_id_public();let a=begin_at(&root,"same.mp4".into(),5).unwrap();
        assert!(finish(&a).is_err());assert!(append(&a,1,"YWJj").is_err());append(&a,0,"YWJj").unwrap();
        assert!(append(&a,3,"ZGVm").is_err());append(&a,3,"ZGU=").unwrap();finish(&a).unwrap();
        let one=claim_at(&root,&a,&id,"file").unwrap();assert_eq!(fs::read(one["path"].as_str().unwrap()).unwrap(),b"abcde");assert!(claim_at(&root,&a,&id,"file").is_err());
        let b=begin_at(&root,"same.mp4".into(),0).unwrap();finish(&b).unwrap();let two=claim_at(&root,&b,&id,"file").unwrap();assert_ne!(one["path"],two["path"]);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn bounded_chunks_and_abandoned_copy() {
        assert!(decode_chunk("====").is_err());assert!(decode_chunk("a?==").is_err());assert!(decode_chunk(&"A".repeat(((CHUNK+2)/3)*4+4)).is_err());
        let root=root();let token=begin_at(&root,"x.bin".into(),1).unwrap();let path=uploads().lock().unwrap()[&token].path.clone();uploads().lock().unwrap().remove(&token);assert!(!path.exists());fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn larger_than_preview_limit_streams_without_whole_file_buffer() {
        use std::io::Read;
        let root=root();let n=34u64;let token=begin_at(&root,"large.mp4".into(),n*CHUNK as u64).unwrap();let chunk=vec![0x5a;CHUNK];let encoded=crate::jobs::b64_encode_public(&chunk);
        for i in 0..n { append(&token,i*CHUNK as u64,&encoded).unwrap(); }finish(&token).unwrap();let saved=claim_at(&root,&token,&crate::jobs::new_job_id_public(),"file").unwrap();let mut file=File::open(saved["path"].as_str().unwrap()).unwrap();let mut buf=vec![0;CHUNK];for _ in 0..n {file.read_exact(&mut buf).unwrap();assert_eq!(buf,chunk);}assert_eq!(file.metadata().unwrap().len(),n*CHUNK as u64);drop(file);fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn names_cannot_escape_or_lose_long_filename_extension() {
        assert_eq!(disk_name("../CON.mp4"),"file-CON.mp4");assert!(disk_name(&format!("{}.mp4","长".repeat(200))).ends_with(".mp4"));assert!(!disk_name("../../a/b.png").contains('/'));
    }
}
