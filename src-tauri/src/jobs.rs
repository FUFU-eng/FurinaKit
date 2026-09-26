// 任务流水线的 Rust 实现（对应原 Next 版的 lib/file-jobs.ts）
//
// 机制（照抄原实现，格式一字不差，这样 Python 工作进程完全不用改）：
//   <storage>/jobs/<uuid>.json          任务状态
//   <storage>/queue/<毫秒>-<uuid>.json   队列条目，工作进程轮询这个目录取活
//   <storage>/job-index.json            索引
//
// 任务 JSON：{ id, toolId, status, progress, message, createdAt, updatedAt, expiresAt, ... }
// 队列 JSON：{ jobId, toolId, payload, enqueuedAt }
// 状态：pending / processing / completed / failed
//
// 有个坑必须照抄：**终态不能被非终态覆盖**（原代码里叫 wouldResurrectTerminal）。
// 否则进度更新会把已完成的任务拉回 processing，前端就永远转圈、下载按钮永远不出现。

use std::fs;
use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};
use tauri::Manager;

/// 存储根目录：与原 Electron 版保持一致的取法
pub fn storage_dir(app: &tauri::AppHandle) -> PathBuf {
    if crate::upscale_validation::dedicated_build() {
        return crate::upscale_validation::storage_root().clone();
    }
    if let Ok(p) = std::env::var("FURINAKIT_STORAGE_DIR") {
        let p = PathBuf::from(p);
        let _ = fs::create_dir_all(&p);
        return p;
    }
    let p = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."))
        .join("storage");
    let _ = fs::create_dir_all(&p);
    p
}

fn jobs_dir(app: &tauri::AppHandle) -> PathBuf {
    let p = storage_dir(app).join("jobs");
    let _ = fs::create_dir_all(&p);
    p
}

fn queue_dir(app: &tauri::AppHandle) -> PathBuf {
    let p = storage_dir(app).join("queue");
    let _ = fs::create_dir_all(&p);
    p
}

fn uploads_dir(app: &tauri::AppHandle) -> PathBuf {
    let p = storage_dir(app).join("uploads");
    let _ = fs::create_dir_all(&p);
    p
}

fn index_path(app: &tauri::AppHandle) -> PathBuf {
    storage_dir(app).join("job-index.json")
}

/// 任务 id 只允许十六进制与短横（防止路径穿越）
pub fn is_valid_job_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 64
        && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

fn is_terminal(status: &str) -> bool {
    matches!(status, "completed" | "failed" | "cancelled" | "canceled")
}

/// 简化版 uuid v4（避免引第三方库）：用系统时间 + 进程 id + 计数拼出来
fn new_job_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::{SystemTime, UNIX_EPOCH};
    static COUNTER: AtomicU64 = AtomicU64::new(0);
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos() as u64)
        .unwrap_or(0);
    let n = COUNTER.fetch_add(1, Ordering::Relaxed);
    let pid = std::process::id() as u64;
    let a = (nanos >> 32) as u32;
    let b = (nanos & 0xffff_ffff) as u32;
    let c = ((pid << 16) | (n & 0xffff)) as u32;
    let d = (nanos ^ (pid << 24) ^ n) as u32;
    format!("{:08x}-{:04x}-4{:03x}-{:04x}-{:012x}",
            a,
            (b >> 16) as u16,
            (b & 0xfff) as u16,
            ((c >> 16) as u16 & 0x3fff) | 0x8000,
            ((c as u64) << 32 | d as u64) & 0xffff_ffff_ffff)
}

/// 当前时间的 ISO 8601 字符串（与原实现一致，前端按这个解析）
fn now_iso() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    iso_from_unix(secs)
}

fn iso_from_unix(secs: u64) -> String {
    // 手写日期换算，避免引 chrono
    let mut days = (secs / 86400) as i64;
    let rem = secs % 86400;
    let (h, mi, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let mut year = 1970i64;
    loop {
        let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
        let dy = if leap { 366 } else { 365 };
        if days >= dy {
            days -= dy;
            year += 1;
        } else {
            break;
        }
    }
    let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    let mdays = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut month = 0usize;
    while month < 12 && days >= mdays[month] {
        days -= mdays[month];
        month += 1;
    }
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.000Z", year, month + 1, days + 1, h, mi, s)
}

fn job_path(app: &tauri::AppHandle, id: &str) -> PathBuf {
    jobs_dir(app).join(format!("{id}.json"))
}

fn read_job(app: &tauri::AppHandle, id: &str) -> Option<Value> {
    if !is_valid_job_id(id) {
        return None;
    }
    let raw = fs::read_to_string(job_path(app, id)).ok()?;
    serde_json::from_str(&raw).ok()
}

fn write_job(app: &tauri::AppHandle, job: &Value) -> Result<(), String> {
    static WRITE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = WRITE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let id = job.get("id").and_then(|v| v.as_str()).ok_or("任务缺少 id")?;
    if !is_valid_job_id(id) { return Err("无效任务编号".into()); }
    let txt = serde_json::to_string(job).map_err(|e| e.to_string())?;
    crate::atomic_store::write(&job_path(app, id), txt.as_bytes()).map_err(|e| format!("写任务文件失败：{e}"))?;
    // 同步索引（只存 id 列表，与原实现的 job-index.json 作用一致）
    let mut idx: Vec<String> = fs::read_to_string(index_path(app))
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<String>>(&s).ok())
        .unwrap_or_default();
    if !idx.iter().any(|x| x == id) {
        idx.push(id.to_string());
        let _ = crate::atomic_store::write(&index_path(app), serde_json::to_string(&idx).unwrap_or_default().as_bytes());
    }
    Ok(())
}

/// 组装一个新建任务的 JSON（create_job 与 create_local_job 共用）
fn build_job(tool_id: &str, payload: Value) -> Result<Value, String> {
    let id = new_job_id();
    let now = now_iso();
    Ok(json!({
        "id": id,
        "toolId": tool_id,
        "status": "pending",
        "progress": 0,
        "message": "已加入队列",
        "createdAt": now,
        "updatedAt": now,
        "expiresAt": now,
        "payload": payload,
    }))
}

/// 创建任务：写任务文件 + 写队列条目（工作进程轮询队列目录取活）
pub fn create_job(app: &tauri::AppHandle, tool_id: &str, payload: Value) -> Result<Value, String> {
    crate::with_ready_worker(app, || {
    let job = build_job(tool_id, payload.clone())?;
    write_job(app, &job)?;

    let now = job["createdAt"].clone();
    let queue_item = json!({
        "jobId": job["id"],
        "toolId": tool_id,
        "payload": payload,
        "enqueuedAt": now,
    });
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let qf = queue_dir(app).join(format!("{ts}-{}.json", job["id"].as_str().unwrap_or("x")));
    if let Err(error) = crate::atomic_store::write(&qf, serde_json::to_string(&queue_item).map_err(|e| e.to_string())?.as_bytes()) {
        let message = format!("写队列文件失败：{error}");
        let mut failed = job.clone();
        failed["status"] = json!("failed");
        failed["message"] = json!(message);
        failed["error"] = json!(message);
        failed["updatedAt"] = json!(now_iso());
        write_job(app, &failed).map_err(|e| format!("{message}；保存失败状态也失败：{e}"))?;
        return Err(message);
    }

    Ok(job)
    })
}

/// 创建「本地任务」：只写任务文件，**不写队列条目**。
///
/// 给「由 Rust 自己执行」的任务用（例如抠图）。区别很重要：
/// 一旦写了队列条目，Python 工作进程就会把它取走 —— 那还是 Python 在干活，
/// 体积一点没省下来，而且两边会抢同一个任务。
pub fn create_local_job(
    app: &tauri::AppHandle,
    tool_id: &str,
    payload: Value,
) -> Result<Value, String> {
    let job = build_job(tool_id, payload)?;
    write_job(app, &job)?;
    Ok(job)
}

/// Owner marker is persisted with the initial record, before any process can be launched.
pub fn create_native_job(app:&tauri::AppHandle,tool:&str,engine:&str,payload:Value)->Result<Value,String>{
    let mut job=build_job(tool,payload)?;job["nativeEngine"]=json!(engine);write_job(app,&job)?;Ok(job)
}

/// Rust 原生同步工具的「即完任务」：建本地任务记录（不进队列）并直接写完成态。
/// 给 pdf / image 这类 Rust 内联完成的工具用 —— 前端通用表单的契约是
/// "建任务 → 拿 job 号轮询 → /api/jobs/<id>/download 下载"，直接回裸结果
/// 界面只会得到"任务未创建"。
pub fn complete_local_job(
    app: &tauri::AppHandle,
    tool: &str,
    payload: &Value,
    result: &Value,
) -> Result<Value, String> {
    // Synchronous work has already finished. Validate first, then publish one final record.
    // Never leave a pending job or report success after a failed completion write.
    let job = build_completed_local_job(tool, payload, result)?;
    write_job(app, &job)?;
    Ok(job)
}

fn build_completed_local_job(tool: &str, payload: &Value, result: &Value) -> Result<Value, String> {
    let mut job = build_job(tool, payload.clone())?;
    let mut m = Map::new();
    m.insert("status".into(), json!("completed"));
    m.insert("progress".into(), json!(100));
    let output = result.get("output").and_then(|v| v.as_str()).unwrap_or("");
    if output.is_empty() {
        if !matches!(tool, "pdf-info" | "image-info") {
            return Err("处理未生成产物文件，请检查输入文件后重试".into());
        }
        // 信息型结果（pdf-info / image-info 这类没有产物文件的）：把要点写进 message
        let msg = if let (Some(w), Some(h)) = (
            result.get("width").and_then(|v| v.as_u64()),
            result.get("height").and_then(|v| v.as_u64()),
        ) {
            format!(
                "宽 {w} × 高 {h}{}",
                result
                    .get("format")
                    .and_then(|v| v.as_str())
                    .map(|f| format!(" · {f}"))
                    .unwrap_or_default()
            )
        } else {
            result
                .get("message")
                .and_then(|v| v.as_str())
                .unwrap_or("完成")
                .to_string()
        };
        m.insert("message".into(), json!(msg));
    } else {
        let path = std::path::PathBuf::from(output);
        let name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_default();
        let metadata = fs::File::open(&path)
            .and_then(|file| file.metadata())
            .map_err(|e| format!("无法读取处理产物：{e}"))?;
        if !metadata.is_file() || metadata.len() == 0 {
            return Err("处理产物不是有效的非空文件，请重试".into());
        }
        let size = metadata.len();
        m.insert(
            "message".into(),
            result.get("message").cloned().unwrap_or(json!("完成")),
        );
        m.insert("resultPath".into(), json!(output));
        m.insert("resultFilename".into(), json!(name));
        m.insert("resultMimeType".into(), json!(mime_by_ext(&path)));
        m.insert("resultBytes".into(), json!(size));
        m.insert("engine".into(), json!("rust"));
    }
    job.as_object_mut().ok_or("任务记录格式无效")?.extend(m);
    Ok(job)
}

#[cfg(test)]
mod completed_local_tests {
    use super::*;
    #[test]
    fn output_required_except_information_tools() {
        for tool in ["pdf-info", "image-info"] {
            let job = build_completed_local_job(tool, &json!({}), &json!({"width":160,"height":120})).unwrap();
            assert_eq!(job["status"], "completed");
        }
        assert!(build_completed_local_job("image-resize", &json!({}), &json!({})).is_err());
    }
    #[test]
    fn missing_empty_directory_and_readable_result() {
        let root = std::env::temp_dir().join(format!("fk-completed-test-{}", new_job_id()));
        fs::create_dir(&root).unwrap();
        let file = root.join("public.png");
        let build = |p: &Path| build_completed_local_job("image-resize", &json!({}), &json!({"output":p.to_string_lossy()}));
        assert!(build(&file).is_err());
        assert!(build(&root).is_err());
        fs::write(&file, b"").unwrap();
        assert!(build(&file).is_err());
        fs::write(&file, b"fixture").unwrap();
        let job = build(&file).unwrap();
        assert_eq!(job["status"], "completed");
        assert_eq!(job["resultBytes"], 7);
        assert_eq!(job["resultFilename"], "public.png");
        fs::remove_dir_all(root).unwrap(); // Only this test's newly-created fixture tree.
    }
}

/// 常见产物扩展名 → MIME（本模块自用的小映射，避免反向依赖 api.rs）
fn mime_by_ext(p: &std::path::Path) -> String {
    match p
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
        .as_str()
    {
        "pdf" => "application/pdf",
        "zip" => "application/zip",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "tif" | "tiff" => "image/tiff",
        "ico" => "image/x-icon",
        "svg" => "image/svg+xml",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "mp4" | "m4v" => "video/mp4",
        "webm" => "video/webm",
        "mkv" => "video/x-matroska",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
    .to_string()
}

/// 更新任务（照抄原实现的防覆盖规则）
pub fn update_job(app: &tauri::AppHandle, id: &str, updates: Map<String, Value>) -> Option<Value> {
    static UPDATE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = UPDATE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let existing = read_job(app, id)?;
    let old_status = existing.get("status").and_then(|v| v.as_str()).unwrap_or("");
    // Terminal jobs are immutable: delayed progress/completion must not revive cancellation.
    if is_terminal(old_status) { return Some(existing); }
    let mut obj = existing.as_object().cloned().unwrap_or_default();
    for (k, v) in updates {
        obj.insert(k, v);
    }
    obj.insert("updatedAt".into(), json!(now_iso()));
    let updated = Value::Object(obj);
    write_job(app, &updated).ok()?;
    Some(updated)
}

/// Remove only a settled owned download's record. Never touch downloaded files or resume data.
pub fn forget_magnet_job(app:&tauri::AppHandle,id:&str)->Result<(),String>{
    if !is_valid_job_id(id){return Err("任务编号无效".into());}
    let job=read_job(app,id).ok_or("任务不存在")?;
    if job["nativeEngine"]!="aria2" || !is_terminal(job["status"].as_str().unwrap_or("")){return Err("请先取消任务，等待停止后再删除记录".into());}
    fs::remove_file(jobs_dir(app).join(format!("{id}.json"))).map_err(|e|e.to_string())
}

/// 列出任务（新的在前）
pub fn list_jobs(app: &tauri::AppHandle) -> Vec<Value> {
    let mut out: Vec<Value> = Vec::new();
    if let Ok(entries) = fs::read_dir(jobs_dir(app)) {
        for e in entries.flatten() {
            if e.path().extension().and_then(|x| x.to_str()) != Some("json") {
                continue;
            }
            if let Ok(raw) = fs::read_to_string(e.path()) {
                if let Ok(v) = serde_json::from_str::<Value>(&raw) {
                    if v.get("id").is_some() {
                        out.push(v);
                    }
                }
            }
        }
    }
    out.sort_by(|a, b| {
        let ka = a.get("createdAt").and_then(|v| v.as_str()).unwrap_or("");
        let kb = b.get("createdAt").and_then(|v| v.as_str()).unwrap_or("");
        kb.cmp(ka)
    });
    out.truncate(200);
    out
}

/// 取消任务：把队列里还没被取走的条目删掉，并把任务标成 failed
pub fn cancel_job(app: &tauri::AppHandle, id: &str) -> Result<Value, String> {
    if let Some(result)=crate::owned_tasks::cancel(app,id) { return result; }
    if !is_valid_job_id(id) {
        return Err("任务号不合法".into());
    }
    let mut removed = 0;
    if let Ok(entries) = fs::read_dir(queue_dir(app)) {
        for e in entries.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            if name.ends_with(&format!("-{id}.json")) {
                if fs::remove_file(e.path()).is_ok() {
                    removed += 1;
                }
            }
        }
    }
    let mut m = Map::new();
    m.insert("status".into(), json!("failed"));
    m.insert("message".into(), json!("已取消"));
    if removed == 0 {
        m.insert("message".into(), json!("已取消（任务可能已在处理中）"));
    }
    match update_job(app, id, m) {
        Some(j) => Ok(json!({ "ok": true, "job": j, "removedFromQueue": removed })),
        None => Err("找不到这个任务".into()),
    }
}

/// Resolve only completed, explicit, readable artifacts in the owned output store.
pub fn job_artifact(app: &tauri::AppHandle, job: &Value) -> Option<PathBuf> {
    crate::artifact_store::resolve(&storage_dir(app), job)
}

/// 保存前端上传的文件（FormData 里的文件），返回 { 字段名: 落盘路径 }
pub fn save_request_uploads(app: &tauri::AppHandle, job_id: &str, files: &[Value]) -> Result<Vec<Value>, String> {
    let mut saved = Vec::with_capacity(files.len());
    for file in files {
        let field = file.get("field").and_then(Value::as_str).unwrap_or("file");
        if let Some(token) = file.get("uploadToken").and_then(Value::as_str) {
            saved.push(crate::upload_stream::claim(app, token, job_id, field)?);
        } else {
            // Compatibility for small legacy callers; never accept an unbounded inline file.
            let data = file.get("data").and_then(Value::as_str).ok_or("上传文件缺少内容")?;
            if data.len() > 6 * 1024 * 1024 { return Err("文件较大，请使用分块上传后重试".into()); }
            let name = file.get("name").and_then(Value::as_str).unwrap_or("upload.bin");
            saved.extend(save_uploads(app, job_id, &[(field.to_string(), name.to_string(), b64_decode_public(data))])?);
        }
    }
    Ok(saved)
}

/// Save small legacy uploads. Desktop FormData now uses upload_stream instead.
pub fn save_uploads(app: &tauri::AppHandle, job_id: &str, files: &[(String, String, Vec<u8>)]) -> Result<Vec<Value>, String> {
    if !is_valid_job_id(job_id) { return Err("无效的任务编号".into()); }
    let dir = uploads_dir(app).join(job_id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    save_upload_batch(&dir, files)
}

fn save_upload_batch(parent: &Path, files: &[(String, String, Vec<u8>)]) -> Result<Vec<Value>, String> {
    use std::io::Write;
    // A fresh batch namespace also isolates retries of the same job.
    let dir = parent.join(new_job_id());
    fs::create_dir(&dir).map_err(|e| format!("创建上传批次失败：{e}"))?;
    let mut out = Vec::new();
    for (index, (field, name, bytes)) in files.iter().enumerate() {
        // 文件名只取最后一段，防止路径穿越
        let safe: String = name
            .rsplit(['/', '\\'])
            .next()
            .unwrap_or("upload.bin")
            .chars()
            .map(|c| if "\\/:*?\"<>|".contains(c) { '_' } else { c })
            .collect();
        let disk_name: String = safe.chars().take(180)
            .map(|c| if c.is_control() { '_' } else { c }).collect();
        let disk_name = disk_name.trim_end_matches(['.', ' ']);
        // Prefix prevents Windows reserved basenames; index prevents case-fold/sanitization collisions.
        let path = dir.join(format!("{index:04}-{}", if disk_name.is_empty() { "upload.bin" } else { disk_name }));
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&path)
            .map_err(|e| format!("创建上传文件失败：{e}"))?;
        file.write_all(bytes).map_err(|e| format!("保存上传文件失败：{e}"))?;
        out.push(json!({
            "field": field,
            "name": safe,
            "path": path.to_string_lossy(),
            "size": bytes.len(),
        }));
    }
    Ok(out)
}

/// 清理过期任务（超过 expiresAt 的终态任务连同文件一起删）
#[cfg(test)]
mod upload_collision_tests {
    use super::*;
    #[test]
    fn same_names_and_retry_are_independent() {
        let root = std::env::temp_dir().join(format!("fk-upload-test-{}", new_job_id()));
        fs::create_dir(&root).unwrap();
        let files = vec![
            ("file".into(), "clip.mp4".into(), b"first".to_vec()),
            ("file".into(), "clip.mp4".into(), b"second".to_vec()),
            ("file".into(), "CLIP.MP4".into(), b"third".to_vec()),
            ("file".into(), "../CON.txt".into(), b"reserved".to_vec()),
            ("file".into(), "..".into(), b"dot".to_vec()),
        ];
        let a = save_upload_batch(&root, &files).unwrap();
        let b = save_upload_batch(&root, &files).unwrap();
        for (i, item) in a.iter().enumerate() {
            let path = PathBuf::from(item["path"].as_str().unwrap());
            assert!(path.starts_with(&root));
            assert_eq!(fs::read(path).unwrap(), files[i].2);
            assert_ne!(item["path"], b[i]["path"]);
        }
        assert_eq!(a[0]["name"], "clip.mp4");
        fs::remove_dir_all(root).unwrap(); // Only this test's freshly-created fixture tree.
    }
}

/// 清理过期任务（超过 expiresAt 的终态任务连同文件一起删）
pub fn purge_expired(app: &tauri::AppHandle, keep_hours: i64) -> usize {
    let _ = keep_hours;
    let mut n = 0;
    let now = std::time::SystemTime::now();
    if let Ok(entries) = fs::read_dir(jobs_dir(app)) {
        for e in entries.flatten() {
            let p = e.path();
            if p.extension().and_then(|x| x.to_str()) != Some("json") {
                continue;
            }
            let stale = e
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| now.duration_since(t).ok())
                .map(|d| d.as_secs() > 24 * 3600)
                .unwrap_or(false);
            if stale {
                // 只删终态的，处理中的不碰
                let terminal = fs::read_to_string(&p)
                    .ok()
                    .and_then(|s| serde_json::from_str::<Value>(&s).ok())
                    .map(|v| v["nativeEngine"] != "aria2" && is_terminal(v.get("status").and_then(|x| x.as_str()).unwrap_or("")))
                    .unwrap_or(false);
                if terminal && fs::remove_file(&p).is_ok() {
                    n += 1;
                }
            }
        }
    }
    n
}

/// 给 api.rs 用：把 storage 路径暴露出去
pub fn list_native_jobs(app: &tauri::AppHandle) -> Vec<Value> {
    let mut list=Vec::new();
    if let Ok(entries)=fs::read_dir(jobs_dir(app)) { for entry in entries.flatten() {
        let path=entry.path();if path.extension().and_then(|s|s.to_str())!=Some("json") { continue; }
        if let Some(id)=path.file_stem().and_then(|s|s.to_str()).filter(|id|is_valid_job_id(id)) { if let Some(job)=read_job(app,id) { if matches!(job["nativeEngine"].as_str(),Some("aria2"|"whisper"|"ocr"|"image"|"media")) { list.push(job); } } }
    } }
    list.sort_by(|a,b|b["createdAt"].as_str().cmp(&a["createdAt"].as_str()));list
}

pub fn storage_dir_of(app: &tauri::AppHandle) -> PathBuf {
    storage_dir(app)
}

/// 供 Path 相关代码消除未使用告警
#[allow(dead_code)]
fn _touch(p: &Path) -> bool {
    p.exists()
}


// ── 给 api.rs 用的公开包装 / 工具函数 ──

pub fn read_job_public(app: &tauri::AppHandle, id: &str) -> Option<Value> {
    read_job(app, id)
}

pub fn new_job_id_public() -> String {
    new_job_id()
}

/// 极简 base64 编码。
///
/// 为什么需要：Tauri 的命令只能回 JSON，而前端的产物下载是
/// `fetch(...).then(r => r.blob())`，要的是**真二进制**。
/// 拦截层约定：Rust 回 `{ "__binary": { data, name, mime } }`，
/// 由 fetch-bridge 解回 Blob。
///
/// 注意代价：base64 有约 1/3 的体积膨胀，几十 MB 的产物会占几百 MB 内存。
/// 抠图这种几百 KB~几 MB 的图完全没问题；以后要传超大文件，
/// 应该改用 Tauri 的 asset 协议而不是这条路。
pub fn b64_encode_public(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            out.push(T[((n >> 6) & 63) as usize] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(T[(n & 63) as usize] as char);
        } else {
            out.push('=');
        }
    }
    out
}

/// 极简 base64 解码（前端上传的文件以 base64 传过来）
pub fn b64_decode_public(s: &str) -> Vec<u8> {
    let clean: Vec<u8> = s.bytes().filter(|b| !b"\r\n \t".contains(b)).collect();
    let val = |c: u8| -> i16 {
        match c {
            b'A'..=b'Z' => (c - b'A') as i16,
            b'a'..=b'z' => (c - b'a') as i16 + 26,
            b'0'..=b'9' => (c - b'0') as i16 + 52,
            b'+' => 62,
            b'/' => 63,
            _ => -1,
        }
    };
    let mut out = Vec::with_capacity(clean.len() / 4 * 3);
    for chunk in clean.chunks(4) {
        let mut n: u32 = 0;
        let mut pad = 0;
        for (i, &c) in chunk.iter().enumerate() {
            let v = val(c);
            if v < 0 {
                pad += 1;
                continue;
            }
            n |= (v as u32) << (18 - 6 * i);
        }
        out.push((n >> 16) as u8);
        if chunk.len() > 2 && pad < 2 {
            out.push((n >> 8) as u8);
        }
        if chunk.len() > 3 && pad < 1 {
            out.push(n as u8);
        }
    }
    out
}
