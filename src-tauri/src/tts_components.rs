//! V66 shared, opt-in TTS component control.
//! Native download & unpack via curl.exe and tar.exe. 0 Python dependency.
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::Duration,
};

pub(crate) const IDS: [&str; 4] = [
    "tts-sherpa-runtime",
    "tts-kokoro-zh-en",
    "tts-piper-ljspeech",
    "tts-piper-ryan",
];

const SPECS_JSON: &str = include_str!("../tts-component-catalog.json");

#[derive(Default)]
struct State {
    active: HashMap<String, Arc<AtomicBool>>,
    progress: HashMap<String, Value>,
    results: HashMap<String, Value>,
}

fn state() -> &'static Mutex<State> {
    static STATE: OnceLock<Mutex<State>> = OnceLock::new();
    STATE.get_or_init(|| Mutex::new(State::default()))
}

fn write_tts_progress(tts_root: &Path, id: &str, status: &str, received: u64, total: u64) {
    let p = tts_root.join("progress.json");
    let progress_val = json!({
        "id": id,
        "status": status,
        "received": received,
        "total": total
    });
    if let Ok(mut guard) = state().lock() {
        guard.progress.insert(id.to_string(), progress_val.clone());
    }
    let p_ind = tts_root.join(format!("progress_{id}.json"));
    if let Ok(bytes) = serde_json::to_vec(&progress_val) {
        let _ = fs::write(p_ind, &bytes);
    }
    if let Ok(bytes) = serde_json::to_vec(&progress_val) {
        let _ = fs::write(p, bytes);
    }
}

fn collect_regular_files(dir: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
    if let Ok(entries) = fs::read_dir(dir) {
        for entry in entries.flatten() {
            let p = entry.path();
            if let Ok(meta) = fs::symlink_metadata(&p) {
                if meta.is_dir() {
                    collect_regular_files(&p, files)?;
                } else if meta.is_file() {
                    files.push(p);
                }
            }
        }
    }
    Ok(())
}

fn install_single(
    tts_root: &Path,
    id: &str,
    spec: &Value,
    cancel: Option<&AtomicBool>,
) -> Result<(), String> {
    let url = spec.get("url").and_then(Value::as_str).ok_or("Missing url")?;
    let expected_size = spec.get("size").and_then(Value::as_u64).ok_or("Missing size")?;
    let expected_sha256 = spec.get("sha256").and_then(Value::as_str).ok_or("Missing sha256")?;

    let archives_dir = tts_root.join("archives");
    fs::create_dir_all(&archives_dir).map_err(|e| e.to_string())?;

    let archive_path = archives_dir.join(format!("{id}.tar.bz2"));
    let part_path = archives_dir.join(format!("{id}.tar.bz2.part"));

    let archive_valid = if archive_path.is_file() {
        fs::metadata(&archive_path).map(|m| m.len() == expected_size).unwrap_or(false)
            && crate::owned_tasks::digest(&archive_path).map(|h| h == expected_sha256).unwrap_or(false)
    } else {
        false
    };

    if !archive_valid {
        if let Ok(meta) = fs::metadata(&part_path) {
            if meta.len() > expected_size {
                let _ = fs::remove_file(&part_path);
            }
        }

        let mut mirrors = Vec::new();
        if url.starts_with("https://github.com/") {
            // Measured from mainland China without a proxy (2026-09): gh-proxy.com is fastest.
            mirrors.push(format!("https://gh-proxy.com/{}", url));
            mirrors.push(format!("https://ghproxy.net/{}", url));
            mirrors.push(format!("https://ghfast.top/{}", url));
        }
        mirrors.push(url.to_string());

        let mut download_ok = false;
        let mut last_err = String::new();

        write_tts_progress(tts_root, id, "downloading", 0, expected_size);

        for mirror_url in mirrors {
            if cancel.is_some_and(|c| c.load(Ordering::SeqCst)) {
                return Err("下载已停止，断点文件已保留 / Download stopped".into());
            }

            let curl_bin = crate::owned_tasks::system_tool("curl.exe")?;
            let mut cmd = std::process::Command::new(&curl_bin);
            cmd.args([
                "-f", "-sS", "-L",
                "--ssl-no-revoke",
                "-C", "-",
                "--retry", "2",
                "--connect-timeout", "8",
                "--speed-limit", "20480", "--speed-time", "30",
                "--max-time", "3600",
                "-o", &part_path.to_string_lossy(),
                &mirror_url,
            ]);
            crate::commands::no_window(&mut cmd);

            let mut child = match cmd.spawn() {
                Ok(c) => c,
                Err(e) => {
                    last_err = format!("启动 curl 失败：{e}");
                    continue;
                }
            };

            let mut child_done = false;
            while !child_done {
                if cancel.is_some_and(|c| c.load(Ordering::SeqCst)) {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err("下载已停止，断点文件已保留 / Download stopped".into());
                }

                if let Ok(meta) = fs::metadata(&part_path) {
                    write_tts_progress(tts_root, id, "downloading", meta.len(), expected_size);
                }

                match child.try_wait() {
                    Ok(Some(status)) => {
                        child_done = true;
                        if !status.success() {
                            last_err = format!("curl 退出状态异常：{status}");
                        }
                    }
                    Ok(None) => {
                        std::thread::sleep(Duration::from_millis(300));
                    }
                    Err(e) => {
                        child_done = true;
                        last_err = format!("等待 curl 异常：{e}");
                    }
                }
            }

            if part_path.is_file() {
                if let Ok(meta) = fs::metadata(&part_path) {
                    if meta.len() == expected_size {
                        write_tts_progress(tts_root, id, "verifying", expected_size, expected_size);
                        if let Ok(hash) = crate::owned_tasks::digest(&part_path) {
                            if hash == expected_sha256 {
                                let _ = fs::rename(&part_path, &archive_path);
                                download_ok = true;
                                break;
                            } else {
                                last_err = "SHA-256 校验不匹配".into();
                                let _ = fs::remove_file(&part_path);
                            }
                        }
                    }
                }
            }
        }

        if !download_ok {
            return Err(format!("下载语音组件失败：{last_err}，请检查网络连接后重试"));
        }
    }

    write_tts_progress(tts_root, id, "extracting", expected_size, expected_size);
    let stage_dir = tts_root.join(format!(".stage-{}", uuid::Uuid::new_v4().simple()));
    if stage_dir.exists() {
        let _ = fs::remove_dir_all(&stage_dir);
    }
    fs::create_dir_all(&stage_dir).map_err(|e| format!("创建解压临时目录失败：{e}"))?;

    let tar_bin = if Path::new(r"C:\Windows\System32\tar.exe").is_file() {
        PathBuf::from(r"C:\Windows\System32\tar.exe")
    } else {
        crate::owned_tasks::system_tool("tar.exe").unwrap_or_else(|_| PathBuf::from("tar.exe"))
    };

    let mut tar_cmd = std::process::Command::new(&tar_bin);
    tar_cmd.args([
        "-xf",
        &archive_path.to_string_lossy(),
        "-C",
        &stage_dir.to_string_lossy(),
    ]);
    crate::commands::no_window(&mut tar_cmd);

    let tar_status = tar_cmd.status().map_err(|e| format!("执行 tar 解压失败：{e}"))?;
    if !tar_status.success() {
        let _ = fs::remove_dir_all(&stage_dir);
        return Err(format!("解压组件压缩包失败（退出码 {tar_status}）"));
    }

    let mut records = Vec::new();
    let mut files_to_scan = Vec::new();
    collect_regular_files(&stage_dir, &mut files_to_scan)?;

    for file_path in &files_to_scan {
        let rel = file_path.strip_prefix(&stage_dir).map_err(|e| e.to_string())?;
        let rel_slash = rel.components()
            .map(|c| c.as_os_str().to_string_lossy().to_string())
            .collect::<Vec<_>>()
            .join("/");
        let size = fs::metadata(file_path).map(|m| m.len()).unwrap_or(0);
        let sha256 = crate::owned_tasks::digest(file_path).unwrap_or_default();
        records.push(json!({
            "path": rel_slash,
            "size": size,
            "sha256": sha256
        }));
    }

    let receipt_json = json!({
        "id": id,
        "archiveSha256": expected_sha256,
        "files": records
    });

    fs::write(
        stage_dir.join("receipt.json"),
        serde_json::to_vec_pretty(&receipt_json).map_err(|e| e.to_string())?,
    ).map_err(|e| format!("写入 receipt.json 失败：{e}"))?;

    let target_dir = tts_root.join(id);
    if target_dir.exists() {
        let _ = fs::remove_dir_all(&target_dir);
    }
    fs::rename(&stage_dir, &target_dir).map_err(|e| format!("移动解压目录失败：{e}"))?;

    let _ = fs::remove_file(&archive_path);

    write_tts_progress(tts_root, id, "completed", expected_size, expected_size);
    Ok(())
}

fn delete_single(tts_root: &Path, id: &str) -> Result<(), String> {
    if id == "tts-sherpa-runtime" {
        for model_id in ["tts-kokoro-zh-en", "tts-piper-ljspeech", "tts-piper-ryan"] {
            if tts_root.join(model_id).join("receipt.json").is_file() {
                return Err("请先删除依赖此运行库的本地音色 / Remove dependent voice models first".into());
            }
        }
    }
    let target = tts_root.join(id);
    if target.exists() {
        fs::remove_dir_all(&target).map_err(|e| format!("删除失败：{e}"))?;
    }
    let archives_dir = tts_root.join("archives");
    let _ = fs::remove_file(archives_dir.join(format!("{id}.tar.bz2")));
    let _ = fs::remove_file(archives_dir.join(format!("{id}.tar.bz2.part")));
    Ok(())
}

fn voices_native(engine: &str) -> Result<Value, String> {
    // 系统语音：只列本机真实安装的声线（不再返回写死的假列表，避免选了却合成失败）
    // 在线语音：直连微软接口获取完整声线清单；失败时前端回退到内置常用声线
    let voices = match engine {
        "sapi" => crate::tts_native::sapi_voices()?,
        "edge" => crate::tts_native::edge_voices()?,
        _ => return Err("Unknown voice engine".into()),
    };
    Ok(json!({ "ok": true, "voices": voices }))
}

fn run(app: &tauri::AppHandle, action: &str, id: &str, cancel: Option<&AtomicBool>) -> Result<Value, String> {
    let dir = crate::api::components_dir(app)?;
    let tts_root = dir.join("tts-v66");
    fs::create_dir_all(&tts_root).map_err(|e| e.to_string())?;

    match action {
        "download" => {
            let specs: Value = serde_json::from_str(SPECS_JSON).map_err(|e| e.to_string())?;

            if id != "tts-sherpa-runtime" {
                static RUNTIME_MUTEX: OnceLock<Mutex<()>> = OnceLock::new();
                let runtime_installed = tts_root.join("tts-sherpa-runtime").join("receipt.json").is_file();
                if !runtime_installed {
                    let lock = RUNTIME_MUTEX.get_or_init(|| Mutex::new(()));
                    let _guard = lock.lock().unwrap();
                    if !tts_root.join("tts-sherpa-runtime").join("receipt.json").is_file() {
                        if let Some(runtime_spec) = specs.get("tts-sherpa-runtime") {
                            install_single(&tts_root, "tts-sherpa-runtime", runtime_spec, cancel)?;
                        }
                    }
                }
            }

            let spec = specs.get(id).ok_or_else(|| format!("未知语音组件：{id}"))?;
            install_single(&tts_root, id, spec, cancel)?;
            Ok(json!({ "ok": true }))
        }
        "delete" => {
            delete_single(&tts_root, id)?;
            Ok(json!({ "ok": true }))
        }
        "voices" => {
            voices_native(id)
        }
        _ => Err(format!("Unsupported action: {action}")),
    }
}

pub fn catalog(app: &tauri::AppHandle) -> Result<Value, String> {
    let mut result = crate::tts_catalog::catalog(&crate::api::components_dir(app)?)?;
    let guard = state().lock().map_err(|_| "TTS state is unavailable")?;
    let active_ids: Vec<String> = guard.active.keys().cloned().collect();
    result["activeIds"] = json!(active_ids);
    result["activeId"] = active_ids.first().map(|id| json!(id)).unwrap_or(Value::Null);
    result["operations"] = json!(guard.results);
    result["progressMap"] = json!(guard.progress);

    if let Some(comps) = result["components"].as_array_mut() {
        for comp in comps {
            let cid_opt = comp.get("id").and_then(Value::as_str).map(|s| s.to_string());
            if let Some(cid) = cid_opt {
                let is_active = guard.active.contains_key(&cid);
                let prog_opt = guard.progress.get(&cid).cloned();
                comp["active"] = json!(is_active);
                if let Some(p) = prog_opt {
                    comp["progress"] = p;
                } else if is_active {
                    let total = comp.get("size").and_then(Value::as_u64).unwrap_or(0);
                    comp["progress"] = json!({
                        "id": cid,
                        "status": "downloading",
                        "received": 0,
                        "total": total
                    });
                }
            }
        }
    }

    if guard.active.is_empty() {
        result["progress"] = json!({});
    } else if let Some(first_id) = active_ids.first() {
        if let Some(p) = guard.progress.get(first_id) {
            result["progress"] = p.clone();
        }
    }
    Ok(result)
}

pub fn voices(app: &tauri::AppHandle, engine: &str) -> Result<Value, String> {
    if !matches!(engine, "sapi" | "edge") {
        return Err("Unknown voice engine".into());
    }
    run(app, "voices", engine, None)
}

pub fn action(app: &tauri::AppHandle, id: &str, action: &str) -> Result<Value, String> {
    if !IDS.contains(&id) {
        return Err("未知语音组件 / Unknown TTS component".into());
    }
    if action == "stop" {
        let guard = state().lock().map_err(|_| "TTS state is unavailable")?;
        if let Some(flag) = guard.active.get(id) {
            flag.store(true, Ordering::SeqCst);
            return Ok(json!({ "ok": true }));
        }
        return Err("没有此组件的活动下载 / No active download for this component".into());
    }
    if !matches!(action, "download" | "delete") {
        return Err("Unsupported TTS action".into());
    }
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut guard = state().lock().map_err(|_| "TTS state is unavailable")?;
        if guard.active.contains_key(id) {
            return Err("此组件正在下载或处理中，请稍候 / This component is already being processed".into());
        }
        guard.active.insert(id.to_string(), cancel.clone());
        guard.results.insert(
            id.into(),
            json!({ "status": if action == "download" { "downloading" } else { "deleting" } }),
        );
    }

    let owned_app = app.clone();
    let id_str = id.to_owned();
    let action_str = action.to_owned();
    let failed_id = id_str.clone();
    let spawned = std::thread::Builder::new()
        .name(format!("tts-control-{id}"))
        .spawn(move || {
            let outcome = run(&owned_app, &action_str, &id_str, Some(&cancel));
            let mut guard = state().lock().unwrap_or_else(|e| e.into_inner());
            guard.active.remove(&id_str);
            guard.progress.remove(&id_str);
            guard.results.insert(
                id_str,
                match outcome {
                    Ok(_) => json!({ "status": "completed" }),
                    Err(error) => json!({ "status": "error", "error": error }),
                },
            );
        });

    if let Err(error) = spawned {
        let message = format!("无法启动语音组件操作 / Cannot start TTS component operation: {error}");
        let mut guard = state().lock().unwrap_or_else(|e| e.into_inner());
        guard.active.remove(&failed_id);
        guard.progress.remove(&failed_id);
        guard.results.insert(failed_id, json!({ "status": "error", "error": message }));
        return Err(message);
    }

    Ok(json!({ "ok": true }))
}
