//! Tauri-owned video jobs: real yt-dlp progress, bounded stalls, isolated outputs.
use std::{fs::{self, File}, io::{BufRead, BufReader}, path::PathBuf, process::{Command, Stdio}, time::{Duration, Instant}};
use serde_json::{json, Value};

fn update(app: &tauri::AppHandle, id: &str, value: Value) {
    if let Some(fields) = value.as_object() { crate::jobs::update_job(app, id, fields.clone()); }
}

#[cfg(windows)] type DownloadChild=crate::worker_process::Child;
#[cfg(not(windows))] type DownloadChild=std::process::Child;
fn terminate(child: &mut DownloadChild) -> Result<(),String> {
    // Owned Job termination on Windows; never a reusable PID/taskkill target.
    child.kill().map_err(|e|format!("Download tree stop unconfirmed: {e}"))?;
    child.wait().map(|_|()).map_err(|e|format!("Download tree stop unconfirmed: {e}"))
}

pub fn start(app: &tauri::AppHandle, tool: &str, args: &Value) -> Result<Value, String> {
    let url = crate::video::extract_url(args["url"].as_str().unwrap_or(""));
    let parsed = url::Url::parse(&url).map_err(|_| "请输入有效的视频链接")?;
    if !matches!(parsed.scheme(), "https" | "http") || parsed.host_str().is_none() {
        return Err("只支持 HTTP 或 HTTPS 视频链接".into());
    }
    let format = args["format"].as_str().unwrap_or("mp4");
    if !["mp4", "mp3", "thumbnail"].contains(&format) { return Err("不支持的下载格式".into()); }
    let quality = args["quality"].as_str().unwrap_or("best");
    if quality != "best" && !quality.parse::<u32>().map(|v| (1..=16384).contains(&v)).unwrap_or(false) {
        return Err("无效画质，请重新解析视频并选择清晰度".into());
    }
    let mut payload = json!({"url":url,"format":format,"quality":quality,"codec":args["codec"].as_str().unwrap_or("h264")});
    payload["engine"] = json!("native-ytdlp");
    let component_lease=crate::api::component_use(app,&["ffmpeg.exe","ffprobe.exe"])?;
    // No Python queue item: there must be exactly one owner of each job.
    let job = crate::jobs::create_local_job(app, tool, payload.clone())?;
    let id = job["id"].as_str().ok_or("任务缺少 id")?.to_string();
    spawn_worker(app, id, payload, std::sync::Arc::new(component_lease));
    Ok(json!({"ok":true,"job":job,"engine":"native-ytdlp"}))
}

/// 暂停后 run() 用这个错误退出；状态已经写成 paused，外层不会再改成「失败」。
const PAUSED: &str = "__FURINAKIT_VIDEO_PAUSED__";
/// yt-dlp 的 B站解析器失效：改用 B站公开接口生成的 info JSON 再下一次。
const BILI_FALLBACK: &str = "__FURINAKIT_BILI_API_FALLBACK__";

fn run_with_fallback(app: &tauri::AppHandle, id: &str, payload: &Value, component_resources: crate::resource_custody::SharedResource) -> Result<(), String> {
    match run(app, id, payload, component_resources.clone(), None) {
        Err(e) if e == BILI_FALLBACK => {
            update(app, id, json!({"progress":6,"message":"B站网页解析失败，改用 B站接口获取视频…"}));
            let url = payload["url"].as_str().ok_or("缺少网址")?;
            let info = crate::bili_api::build_info(url)?;
            let dir = crate::jobs::storage_dir_of(app).join("results").join(id);
            let info_path = dir.join("bili-info.json");
            fs::write(&info_path, serde_json::to_vec(&info).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            let result = run(app, id, payload, component_resources, Some(&info_path));
            let _ = fs::remove_file(&info_path);
            result
        }
        other => other,
    }
}

fn video_job(app: &tauri::AppHandle, id: &str) -> Result<Value, String> {
    let job = crate::jobs::read_job_public(app, id).ok_or("任务不存在")?;
    if job["payload"]["engine"] != "native-ytdlp" { return Err("此任务不支持暂停 / 继续".into()); }
    Ok(job)
}

/// 暂停：标记 pausing，下载线程看到后结束 yt-dlp 进程，.part 断点文件留在任务目录里。
pub fn pause(app: &tauri::AppHandle, id: &str) -> Result<Value, String> {
    let job = video_job(app, id)?;
    if !matches!(job["status"].as_str(), Some("processing" | "pending")) { return Err("只有正在下载的任务可以暂停".into()); }
    let job = crate::jobs::update_job(app, id, json!({"status":"pausing","message":"正在暂停，已下载部分会保留…"}).as_object().cloned().unwrap_or_default()).ok_or("保存暂停状态失败")?;
    Ok(json!({"ok":true,"job":job}))
}

/// 继续：用同一个任务目录重新启动 yt-dlp，它会自动接着 .part 文件下载。
pub fn resume(app: &tauri::AppHandle, id: &str) -> Result<Value, String> {
    let job = video_job(app, id)?;
    if job["status"] != "paused" { return Err("只有已暂停的任务可以继续".into()); }
    let component_lease = crate::api::component_use(app, &["ffmpeg.exe", "ffprobe.exe"])?;
    let job = crate::jobs::update_job(app, id, json!({"status":"processing","message":"正在从断点继续下载…","error":null}).as_object().cloned().unwrap_or_default()).ok_or("保存任务状态失败")?;
    spawn_worker(app, id.to_owned(), job["payload"].clone(), std::sync::Arc::new(component_lease));
    Ok(json!({"ok":true,"job":job}))
}

fn spawn_worker(app: &tauri::AppHandle, id: String, payload: Value, component_resources: crate::resource_custody::SharedResource) {
    let handle = app.clone();
    std::thread::spawn(move || {
        update(&handle, &id, json!({"status":"processing","progress":5,"message":"正在连接视频平台…"}));
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run_with_fallback(&handle, &id, &payload,component_resources.clone())));
        let error = match result { Ok(Ok(())) => None, Ok(Err(e)) if e == PAUSED => None, Ok(Err(e)) => Some(e), Err(_) => Some("下载进程异常，请重试".into()) };
        if let Some(error) = error {
            // Do not replace a cancellation with a misleading failure or completion.
            if crate::jobs::read_job_public(&handle, &id).map(|j| j["status"] == "processing").unwrap_or(false) {
                update(&handle, &id, json!({"status":"failed","message":"下载失败","error":error}));
            }
        }
    });
}

pub(crate) fn format_args(format: &str, quality: &str, codec: &str) -> Vec<String> {
    let mut args: Vec<String> = Vec::new();
    if format == "thumbnail" {
        args.extend(["--skip-download", "--write-thumbnail", "--convert-thumbnails", "jpg"].map(String::from));
    } else if format == "mp3" {
        args.extend(["-f", "bestaudio/best", "-x", "--audio-format", "mp3", "--audio-quality", "0"].map(String::from));
    } else {
        let cap = quality.parse::<u32>().ok().map(|h| format!("[height<={h}]")).unwrap_or_default();
        // Height is the shared frontend/backend contract, NOT a site-specific format ID.
        args.extend(["-f".into(), format!("bestvideo{cap}+bestaudio/best{cap}")]);
        let sort = if codec == "av1" { "res,fps,vcodec:av01:vp9.2:vp9:h265:h264,br" } else { "res,fps,vcodec:h264:h265,br" };
        args.extend(["-S", sort, "--merge-output-format", "mp4", "--remux-video", "mp4"].map(String::from));
    }
    args
}

fn run(app: &tauri::AppHandle, id: &str, payload: &Value, component_resources:crate::resource_custody::SharedResource, info_file: Option<&std::path::Path>) -> Result<(), String> {
    let root = crate::app_root_of(app);
    let dir = crate::jobs::storage_dir_of(app).join("results").join(id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let (program, prefix, worker_guard) = crate::video::ytdlp_command(app)?;
    let format = payload["format"].as_str().unwrap_or("mp4");
    let quality = payload["quality"].as_str().unwrap_or("best");
    let codec = payload["codec"].as_str().unwrap_or("h264");
    let url = payload["url"].as_str().ok_or("缺少网址")?;
    let ffmpeg = std::env::var("FURINAKIT_FFMPEG_PATH").ok().map(PathBuf::from)
        .filter(|p| p.is_file()).or_else(|| ["apps/web/ffmpeg.exe", "resources/ffmpeg.exe", "services/worker/ffmpeg.exe", "ffmpeg.exe", "resources/worker/ffmpeg.exe"].iter().map(|p| root.join(p)).find(|p| p.is_file()))
        .or_else(|| crate::runtime_layout::find_media_tool("ffmpeg", &root));
    let log_path = dir.join("download.log");
    let log = File::create(&log_path).map_err(|e| e.to_string())?;
    let log_handle = log.try_clone().map_err(|e|e.to_string())?;
    let mut cmd = Command::new(program);
    cmd.args(prefix).args(["--ignore-config", "--no-playlist", "--windows-filenames", "--newline", "--no-color", "--no-simulate",
        // --print enables quiet mode, so --progress MUST be explicit.
        "--progress", "--progress-delta", "0.5", "--progress-template", "download:FK_PROGRESS:%(progress)j",
        "--print", "after_move:FK_FILE:%(filepath)j", "--socket-timeout", "20", "--retries", "3", "--fragment-retries", "3"])
        .arg("-o").arg(dir.join("%(title).100s-%(id)s.%(ext)s"))
        .args(format_args(format, quality, codec))
        // Explicit empty proxy overrides inherited proxy env vars for domestic sites.
        .arg("--proxy").arg(crate::video::system_proxy(url).unwrap_or_default())
        .env("PYTHONIOENCODING", "utf-8").env("PYTHONUTF8", "1")
        .stdin(Stdio::null()).stdout(Stdio::from(log.try_clone().map_err(|e| e.to_string())?))
        .stderr(Stdio::from(log));
    // Options have to precede the -- URL delimiter.
    if let Some(f) = info_file { cmd.arg("--load-info-json").arg(f); } else { cmd.arg("--").arg(url); }
    if let Some(ffmpeg) = ffmpeg {
        cmd.env("PATH", format!("{};{}", ffmpeg.parent().unwrap_or(&root).display(), std::env::var("PATH").unwrap_or_default()));
    }
    crate::commands::no_window(&mut cmd);
    #[cfg(windows)]
    let mut child = crate::worker_process::Child::spawn_command(&cmd,&File::open("NUL").map_err(|e|e.to_string())?,&log_handle,&log_handle,std::sync::Arc::new((worker_guard,component_resources)))?;
    #[cfg(not(windows))]
    let mut child = cmd.spawn().map_err(|e| format!("无法启动下载器：{e}"))?;
    let mut reader = BufReader::new(File::open(&log_path).map_err(|e| match terminate(&mut child) { Ok(())=>e.to_string(), Err(stop)=>format!("{e}; {stop}") })?);
    let started = Instant::now();
    let mut last_output = Instant::now();
    let mut partial = Vec::new();
    let mut final_path: Option<PathBuf> = None;
    let mut tail = Vec::new();
    let mut high_water = 5u64;
    loop {
        let mut bytes = Vec::new();
        loop {
            bytes.clear();
            let n = match reader.read_until(b'\n', &mut bytes) { Ok(n) => n, Err(e) => { terminate(&mut child)?; return Err(e.to_string()); } };
            if n == 0 { break; }
            last_output = Instant::now();
            partial.extend_from_slice(&bytes);
            if partial.len() > 1024 * 1024 { terminate(&mut child)?; return Err("下载器输出异常：单行日志过长".into()); }
            if !partial.ends_with(b"\n") { break; }
            let line = String::from_utf8_lossy(&partial).trim().to_string();
            partial.clear();
            if let Some(raw) = line.strip_prefix("FK_PROGRESS:") {
                if let Ok(p) = serde_json::from_str::<Value>(raw) {
                    let downloaded = p["downloaded_bytes"].as_f64().unwrap_or(0.0);
                    let total = p["total_bytes"].as_f64().or_else(|| p["total_bytes_estimate"].as_f64()).unwrap_or(0.0);
                    let pct = if total > 0.0 { (downloaded / total * 100.0).clamp(0.0,100.0) } else { 0.0 };
                    high_water = high_water.max((10.0 + pct * 0.8) as u64).min(90);
                    let message = if p["status"] == "finished" { "媒体流下载完成，正在准备合并／转换…".into() }
                        else if total > 0.0 { format!("当前媒体流 {pct:.1}% · 已接收 {:.1} MiB", downloaded / 1048576.0) }
                        else { format!("正在下载 · 已接收 {:.1} MiB", downloaded / 1048576.0) };
                    update(app,id,json!({"progress":high_water,"message":message}));
                }
            } else if let Some(raw) = line.strip_prefix("FK_FILE:") {
                if let Ok(p) = serde_json::from_str::<String>(raw) { final_path = Some(PathBuf::from(p)); }
            } else {
                if line.contains("[Merger]") || line.contains("[ExtractAudio]") || line.contains("[VideoRemuxer]") || line.contains("[ThumbnailsConvertor]") {
                    update(app,id,json!({"progress":95,"message":"正在合并／转换媒体文件…"}));
                }
                tail.push(line);
                if tail.len() > 30 { tail.remove(0); }
            }
        }
        let status_now = crate::jobs::read_job_public(app,id).map(|j| j["status"].clone()).unwrap_or(Value::Null);
        if status_now == "failed" {
            terminate(&mut child)?; return Err("已取消".into());
        }
        if status_now == "pausing" {
            terminate(&mut child)?;
            update(app,id,json!({"status":"paused","message":"已暂停，已下载部分已保留，点「继续」接着下载"}));
            return Err(PAUSED.into());
        }
        match child.try_wait() {
            Ok(Some(status)) => {
                // Reopen and inspect the final marker: the process may have written it
                // between our EOF read and try_wait (including without a final newline).
                let all = fs::read_to_string(&log_path).unwrap_or_default();
                for line in all.lines() {
                    if let Some(raw) = line.strip_prefix("FK_FILE:") {
                        if let Ok(p) = serde_json::from_str::<String>(raw) { final_path = Some(PathBuf::from(p)); }
                    }
                }
                if !status.success() {
                    if info_file.is_none() && crate::bili_api::is_bilibili(url) && crate::bili_api::ytdlp_extractor_broken(&all) { return Err(BILI_FALLBACK.into()); }
                    return Err(crate::video::friendly_error(&all));
                }
                break;
            }
            Ok(None) => (),
            Err(e) => { terminate(&mut child)?; return Err(format!("下载器状态读取失败：{e}")); }
        }
        if last_output.elapsed() > Duration::from_secs(180) || started.elapsed() > Duration::from_secs(7200) {
            terminate(&mut child)?;
            return Err("下载长时间无响应，已停止进程。请检查网络后重试".into());
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    let path = if format == "thumbnail" {
        fs::read_dir(&dir).map_err(|e| e.to_string())?.flatten().map(|e| e.path()).find(|p| p.extension().and_then(|s| s.to_str()) == Some("jpg"))
    } else { final_path }.ok_or("下载器退出，但没有生成目标文件")?;
    let path = path.canonicalize().map_err(|_| "下载结果不存在")?;
    let canonical_dir = dir.canonicalize().map_err(|e| e.to_string())?;
    if !path.starts_with(&canonical_dir) || !path.is_file() || fs::metadata(&path).map_err(|e| e.to_string())?.len() == 0 {
        return Err("下载结果无效或不属于当前任务".into());
    }
    let mime = match format { "thumbnail" => "image/jpeg", "mp3" => "audio/mpeg", _ => "video/mp4" };
    update(app,id,json!({"status":"completed","progress":100,"message":"下载完成","resultPath":path.to_string_lossy(),
        "resultFilename":path.file_name().unwrap_or_default().to_string_lossy(),"resultMimeType":mime}));
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn height_is_honored_without_unbounded_fallback() { let a=format_args("mp4","720","h264"); assert!(a.contains(&"bestvideo[height<=720]+bestaudio/best[height<=720]".into())); }
    #[test] fn cover_does_not_download_video() { assert!(format_args("thumbnail","best","h264").contains(&"--skip-download".into())); }
    #[test] fn audio_is_mp3() { assert!(format_args("mp3","best","h264").contains(&"mp3".into())); }
    #[test] fn av1_preference_is_preserved() { assert!(format_args("mp4","best","av1").iter().any(|x| x.contains("vcodec:av01"))); }
}
