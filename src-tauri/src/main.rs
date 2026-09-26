// FurinaKit 桌面外壳（Tauri 版）
//
// 与 Electron 版的关系：这是一次**外壳替换**，不是重写软件。
//   · 前端：继续用现有的 Next 服务（198 个工具界面一行不用改）
//   · 内核：继续用现有的 Python 工作进程（所有工具实现一行不用改）
//   · 替换掉的：Electron 那套 Chromium 内核（约 200MB）→ 系统自带的 WebView2（0 体积）
//
// 所以这个文件的职责只有三件：
//   1. 把 Node（Next 服务）与 Python（工作进程）作为子进程拉起来，退出时收干净
//   2. 等 Next 起来之后，把窗口指向 http://localhost:3001
//   3. 补上桌面能力：托盘、选文件夹、剪贴板（这几项 Tauri 有现成插件）

// Desktop builds must never allocate a console, including development builds.
#![cfg_attr(all(target_os = "windows", not(test)), windows_subsystem = "windows")]

mod ui_language;
mod ai_connection;
#[cfg(windows)]
mod shell_identity;
mod api;
mod legacy_import;
mod runtime_diagnostics;
mod diagnostic_admission;
mod upscale_validation;
mod capture_validation;
mod mdx_components;
mod ffmpeg_components;
mod component_leases;
mod recovery_guard;
mod resource_custody;
mod task_custody;
mod component_root;
mod tts_components;
mod batch_rename;
mod signature_service;
mod upload_stream;
mod artifact_store;
mod atomic_store;
mod job_export;
mod default_output;
mod media_preview;
mod battery;
mod system_info;
mod disk_scan;
mod archpr_runtime;
mod commands;
mod clipboard_history;
mod utility_windows;
mod paste_target;
mod main_window;
mod preview_activation;
mod notes;
mod encoding;
mod feedback;
mod jobs;
mod magnet_info;
mod owned_tasks;
mod speech;
mod magnet_tasks;
// Offline torrent boundary; IPC remains gated until the owned downloader is verified.
#[allow(dead_code)]
mod torrent_meta;
#[cfg(windows)]
#[allow(dead_code)]
mod torrent_hash;
#[cfg(windows)]
#[allow(dead_code)]
mod torrent_integrity;
#[cfg(windows)]
#[allow(dead_code)]
mod download_process;
#[cfg(windows)]
#[allow(dead_code)]
mod download_artifacts;
mod lanserver;
mod media;
mod media_audio;
mod media_native;
mod netquery;
mod netcheck;
mod onnx;
mod matting_native;
mod inpaint_native;
mod ai_image_native;
mod audio_ai_native;
mod svg_native;
mod photo_restore_native;
mod video_native;
mod pdf_native;
mod pdf_crypt;
mod mini_zip;
mod doc_convert;
mod doc_native;
mod ppt_build;
mod tts_native;
mod test_bridge;
mod ppt_native;
mod icon_native;
mod office_native;
mod spotify_native;
mod audio_tags_native;
mod ocr_geometry;
mod ocr_pixels;
mod ocr_engine;
mod ocr_native;
mod pdf_render;
mod pdf_ocr_font;
mod pdf_ocr_layer;
mod pdf_ocr;
mod image_artifacts;
mod image_basic;
mod image_gif;
mod image_parameters;
mod image_process;
mod image_native;
mod upscale_lite;
#[cfg(windows)] mod upscale_native;
#[cfg(windows)] mod upscale_diagnostics;
mod pdf;
mod transfer;
mod translate;
mod webcap;
mod video;
mod video_download;
mod embedded_site;
mod region_capture;
mod capture_suite;
mod capture_layout;
mod capture_hit_region;
mod recorder;
mod recorder_panel;
mod recorder_process;
mod floatball;

use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use std::time::Duration;

#[cfg(not(windows))]
use tauri::menu::{Menu, MenuItem};
#[cfg(not(windows))]
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, RunEvent, WindowEvent};

#[cfg(windows)]
type WorkerChild = crate::worker_process::Child;
#[cfg(not(windows))]
type WorkerChild = Child;

/// 子进程句柄：退出时要把它们收掉，否则会留下孤儿进程占着端口
struct Children {
    node: Option<Child>,

}

/// 应用根目录：开发时是仓库根，打包后在 resources 目录
pub fn app_root_of(_app: &tauri::AppHandle) -> PathBuf {
    app_root()
}

/// 不带 AppHandle 的版本（给不方便拿到 handle 的地方用，比如录屏模块）
pub fn app_root_public() -> PathBuf {
    app_root()
}

fn app_root() -> PathBuf {
    match startup_policy::isolated_root(){Ok(Some(root))=>return root.clone(),Ok(None)=>{},Err(error)=>panic!("Test root refused: {error}")}
    if let Ok(dir) = std::env::var("FURINAKIT_ROOT") {
        return PathBuf::from(dir);
    }
    // Prefer the self-contained install even when a legacy Electron resources folder remains.
    if let Ok(exe) = std::env::current_exe() {
        if let Some(root) = exe.parent().and_then(runtime_layout::bundled_root) { return root; }
    }
    #[cfg(debug_assertions)]
    if PathBuf::from("E:\\FurinaKit").is_dir() {
        return PathBuf::from("E:\\FurinaKit");
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            // 打包后：<安装目录>\FurinaKit.exe -> <安装目录>\resources
            let res = dir.join("resources");
            if res.is_dir() {
                return res;
            }
            if dir.join("tools/engines").is_dir() { return dir.to_path_buf(); }
            // 开发时：<仓库>\FurinaKit-Tauri\src-tauri\target\debug\furinakit.exe -> <仓库>
            let mut p = dir.to_path_buf();
            for _ in 0..4 {
                p = p.parent().map(|x| x.to_path_buf()).unwrap_or(p.clone());
            }
            if p.join("apps").is_dir() {
                return p;
            }
        }
    }
    PathBuf::from(".")
}

/// 起 Node 服务（Next 的 `next start`）。
///
/// 照 Electron 版的做法：Electron 可以把自己的二进制当 Node 用（ELECTRON_RUN_AS_NODE=1），
/// 省掉 88MB 的 node.exe；Tauri 没有这个能力，所以必须随包带一个 node 运行时。
/// 顺序：包内 node/node.exe → 系统 node → 报错（不再静默失败）。
fn start_node(root: &PathBuf) -> Option<Child> {
    let web_dir = root.join("apps").join("web");
    if !web_dir.is_dir() {
        eprintln!("[FurinaKit] 找不到前端目录: {}", web_dir.display());
        return None;
    }

    let bundled = root.join("resources").join("node").join("node.exe");
    let node_program = if bundled.is_file() {
        println!("[FurinaKit] 使用包内 Node: {}", bundled.display());
        bundled
    } else {
        println!("[FurinaKit] 使用系统 Node");
        PathBuf::from("node")
    };

    // next 的 CLI 入口：优先 standalone 产物，其次 node_modules 里的 next
    let standalone_server = web_dir.join(".next").join("standalone").join("server.js");
    let next_cli = web_dir
        .join("node_modules")
        .join("next")
        .join("dist")
        .join("bin")
        .join("next");

    let mut cmd = Command::new(&node_program);
    if standalone_server.is_file() {
        println!("[FurinaKit] 启动 standalone 服务");
        cmd.arg(standalone_server);
    } else if next_cli.is_file() {
        println!("[FurinaKit] 启动 next start");
        cmd.arg(next_cli).arg("start").arg("-p").arg("3001");
    } else {
        eprintln!("[FurinaKit] 既没有 standalone 产物也没有 next CLI，Web 服务起不来");
        return None;
    }

    cmd.current_dir(&web_dir)
        .env("PORT", "3001")
        .env("NODE_ENV", "production")
        .stdout(std::process::Stdio::inherit())
        .stderr(std::process::Stdio::inherit());

    match cmd.spawn() {
        Ok(c) => {
            println!("[FurinaKit] Web 服务已启动（pid {}）", c.id());
            Some(c)
        }
        Err(e) => {
            eprintln!("[FurinaKit] Web 服务启动失败: {e}（需要 node 运行时）");
            None
        }
    }
}
/// 起 Python 工作进程（所有工具内核都在它里面）
/// 启动时挂上悬浮球窗口的移动监听（拖动结束后吸附 + 保存坐标）
fn start_float_ball_watcher(app: &tauri::AppHandle) {
    crate::floatball::watch_float_ball_moves(app.clone());
}

mod worker_component_source;
mod worker_delivery;
mod launch_identity;
mod startup_policy;
mod preview_ipc;
mod tts_catalog;
mod component_store;
#[cfg(windows)]mod worker_import;
#[cfg(windows)]mod worker_download;
#[cfg(windows)]mod worker_import_control;
mod worker_extension;
mod upscale_extension;
#[cfg(windows)] mod worker_process;
mod worker_contract;
mod worker_protocol;
mod worker_startup;
mod runtime_layout;
mod install_count;
mod update_integrity;

fn start_worker(app: &tauri::AppHandle, root: &PathBuf) -> Result<worker_startup::Session<WorkerChild>,String> {
    let components=crate::api::components_dir(app)?;
    let selected = crate::worker_extension::select(root, &components)?;
    let root = &selected.root;
    let worker_dir = root.join("services/worker");
    let py = worker_dir.join(".venv/Scripts/python.exe");
    let entry = worker_dir.join("worker.py");
    crate::worker_protocol::queue(&worker_dir)?;
    let upscale=crate::upscale_extension::select(&components,&worker_dir)?;
    // An embedded interpreter runs the same current source and TTS control modes as development.
    // Prefer it over an old frozen Worker left behind by an Electron upgrade.
    let mut cmd = if py.is_file() && entry.is_file() {
        let mut c = Command::new(py); c.args(crate::worker_extension::python_args(vec![entry.to_str().ok_or("Non-Unicode worker entry")?.into()],selected.guard.is_some())); c
    } else {
        eprintln!("[FurinaKit] 内置处理运行时缺失，请重新安装完整版本");
        return Err("兼容处理运行时缺失 / Compatible processing runtime missing".into());
    };
    runtime_layout::configure_worker_tools(&mut cmd, root, &components);
    crate::upscale_extension::configure(&mut cmd,upscale.as_ref())?;
    crate::api::configure_component_leases(app,&mut cmd)?;

    // 关键：告诉工作进程用文件队列、以及队列放在哪 —— 与 Electron 版的做法一致。
    // 不传这两个变量，工作进程会去找 Redis，然后一直取不到活。
    let storage = crate::jobs::storage_dir_of(app);
    worker_contract::configure(&mut cmd, &storage)?;
    let ticket=worker_startup::Ticket::new(&app.path().app_cache_dir().map_err(|e|e.to_string())?.join("worker-startup-v1"),&storage)?;
    ticket.configure(&mut cmd);
    cmd.current_dir(if worker_dir.is_dir() { worker_dir } else { root.to_path_buf() })
        .env("USE_FILE_QUEUE", "1")
        // STORAGE_DIR/PATH and output staging are pinned by worker_contract.
        .env("FURINAKIT_COMPONENTS_DIR", &components)
        .env("JOB_TTL_HOURS", "24")
        // 把自己的 pid 交给工作进程：万一应用崩溃/被强杀，工作进程能自己退出，不留孤儿进程
        .env("FURINAKIT_PARENT_PID", std::process::id().to_string())
        ;

    // W21 诊断增强：将 worker 进程标准输出与错误重定向至 worker.log，支持故障排查且限额滚动
    let worker_log_file = app.path().app_cache_dir().ok().and_then(|d| {
        let _ = std::fs::create_dir_all(&d);
        std::fs::OpenOptions::new().create(true).write(true).truncate(true).open(d.join("worker.log")).ok()
    });
    if let Some(ref f) = worker_log_file {
        if let Ok(f_out) = f.try_clone() {
            cmd.stdout(std::process::Stdio::from(f_out));
        }
        if let Ok(f_err) = f.try_clone() {
            cmd.stderr(std::process::Stdio::from(f_err));
        }
    } else {
        cmd.stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
    }
    // ★ 必须的：不加这个，每次启动软件都会弹一个标题为工作进程目录的黑窗口
    //   （Electron 版靠 spawn 的 windowsHide: true 避免，这里是等价的 CREATE_NO_WINDOW）
    crate::commands::no_window(&mut cmd);

    #[cfg(windows)] {
        let args=cmd.get_args().map(|a|a.to_str().map(str::to_owned).ok_or("Non-Unicode worker argument")).collect::<Result<Vec<_>,_>>()?;
        let env=cmd.get_envs().map(|(k,v)|(k.to_owned(),v.map(|x|x.to_owned()))).collect::<Vec<_>>();
        let owned=crate::download_process::OwnedProcess::spawn_with_environment(std::path::Path::new(cmd.get_program()),&args,cmd.get_current_dir().ok_or("Missing worker cwd")?,&env)?;
        let child=WorkerChild::new(owned,std::sync::Arc::new((selected.guard,upscale)));
        println!("[FurinaKit] 工作进程树已启动（pid {}）",child.id());
        Ok(worker_startup::Session::new(child,ticket))
    }
    #[cfg(not(windows))] {cmd.spawn().map(|child|worker_startup::Session::new(child,ticket)).map_err(|e|format!("Processing engine failed to start: {e}"))}
}

/// Blocking API threads only; the shared production hub owns readiness/publication ordering.
pub(crate) fn with_ready_worker<T>(app:&tauri::AppHandle,publish:impl FnOnce()->Result<T,String>)->Result<T,String>{
    app.state::<worker_startup::Hub<WorkerChild>>().publish(||start_worker(app,&app_root_of(app)),publish)
}

/// 等 Next 服务起来（最多 40 秒），起来了再让窗口加载，避免白屏
fn wait_for_server(port: u16, timeout_secs: u64) -> bool {
    let addr = format!("127.0.0.1:{port}");
    let deadline = std::time::Instant::now() + Duration::from_secs(timeout_secs);
    while std::time::Instant::now() < deadline {
        if std::net::TcpStream::connect_timeout(
            &addr.parse().unwrap(),
            Duration::from_millis(600),
        )
        .is_ok()
        {
            return true;
        }
        std::thread::sleep(Duration::from_millis(500));
    }
    false
}

#[tauri::command]
fn app_is_ready() -> bool {
    true
}

#[tauri::command]
fn preview_activate_main(app: tauri::AppHandle) -> Result<(), String> {
    let isolated = !startup_policy::current().ancillary;
    if !preview_activation::manual_activation_allowed(
        isolated,
        std::env::var("FURINAKIT_ALLOW_MANUAL_REVEAL").ok().as_deref(),
    ) {
        return Err("Manual activation requires the isolated profile and FURINAKIT_ALLOW_MANUAL_REVEAL=1".into());
    }
    // Explicit preview display is separate from automatic activation, which stays disabled.
    // Do not force foreground focus away from the user's current application.
    let window=app.get_window("main").ok_or("Preview main window is not ready")?;
    if window.is_minimized().map_err(|e|e.to_string())?{window.unminimize().map_err(|e|e.to_string())?;}
    window.show().map_err(|e|e.to_string())?;
    main_window::schedule(&window);
    Ok(())
}

/// 无界面（CLI）模式：只用于验证与排查，不启动窗口、不拉子进程。
///
/// 存在的理由：抠图这类推理的**正确性**必须逐像素比对（跟 Python 侧比 alpha），
/// 而这件事得在没有界面的情况下跑，且走的必须是真正的生产代码路径（`onnx.rs`）。
/// 打包后是 windows 子系统、没有控制台，所以结果统一写进 JSON 文件。
///
///   furinakit.exe --onnx-alpha <图片> <模型.onnx> <输出.raw|-> [结果.json]
///   furinakit.exe --onnx-describe <模型.onnx> [结果.json]
fn run_cli(argv: &[String]) -> Option<i32> {
    let mode = argv.get(1).map(|s| s.as_str())?;

    let write_json = |out: &Option<String>, v: &serde_json::Value| {
        if let Some(p) = out {
            let _ = std::fs::write(p, serde_json::to_string_pretty(v).unwrap_or_default());
        }
        println!("{v}");
    };

    match mode {
        // 本地神经语音：子进程加载 sherpa-onnx 运行库合成（崩溃不影响主程序）
        "--tts-render" => Some(tts_native::render_cli(argv.get(2)?)),
        "--onnx-describe" => {
            let model = argv.get(2)?;
            let out = argv.get(3).cloned();
            match onnx::describe(model) {
                Ok(v) => {
                    write_json(&out, &v);
                    Some(0)
                }
                Err(e) => {
                    write_json(&out, &serde_json::json!({ "loaded": false, "error": e }));
                    Some(1)
                }
            }
        }
        "--onnx-alpha" => {
            let image = argv.get(2)?;
            let model = argv.get(3)?;
            let raw_out = argv.get(4).cloned();
            let json_out = argv.get(5).cloned();

            let started = std::time::Instant::now();
            let bytes = match std::fs::read(image) {
                Ok(b) => b,
                Err(e) => {
                    write_json(&json_out, &serde_json::json!({ "ok": false, "error": format!("读不到图片：{e}") }));
                    return Some(1);
                }
            };
            let img = match image::load_from_memory(&bytes) {
                Ok(i) => i,
                Err(e) => {
                    write_json(&json_out, &serde_json::json!({ "ok": false, "error": format!("不是能识别的图片：{e}") }));
                    return Some(1);
                }
            };
            let (w, h) = (img.width(), img.height());
            let fallback = onnx::fallback_size_for(std::path::Path::new(model));
            match onnx::alpha_from_image(&img, model, fallback) {
                Ok(alpha) => {
                    let sum: u64 = alpha.iter().map(|v| *v as u64).sum();
                    let mn = alpha.iter().copied().min().unwrap_or(0);
                    let mx = alpha.iter().copied().max().unwrap_or(0);
                    let cx = ((h / 2) * w + w / 2) as usize;
                    let center = alpha.get(cx).copied().unwrap_or(0);
                    if let Some(p) = raw_out.as_deref() {
                        if p != "-" {
                            let _ = std::fs::write(p, &alpha);
                        }
                    }
                    let v = serde_json::json!({
                        "ok": true,
                        "engine": "rust-onnx",
                        "image": image,
                        "model": model,
                        "width": w, "height": h,
                        "bytes": alpha.len(),
                        "min": mn, "max": mx,
                        "mean": if alpha.is_empty() { 0.0 } else { sum as f64 / alpha.len() as f64 },
                        "center": center,
                        "ms": started.elapsed().as_millis() as u64,
                    });
                    write_json(&json_out, &v);
                    Some(0)
                }
                Err(e) => {
                    write_json(&json_out, &serde_json::json!({ "ok": false, "error": e }));
                    Some(1)
                }
            }
        }
        _ => None,
    }
}

/// Visible catalog count comes from the SAME build-time catalog as the frontend.
/// Installed applications must not guess from a developer checkout or an obsolete fixed count.
#[tauri::command]
fn count_tools() -> usize {
    let source = include_str!("../../web/src/shared/catalog-policy.ts");
    source.split_once("export const CATALOG:")
        .and_then(|(_, tail)| tail.split_once('='))
        .and_then(|(_, tail)| tail.split_once("};"))
        .and_then(|(body, _)| serde_json::from_str::<std::collections::HashMap<String, Vec<String>>>(&format!("{}}}", body.trim())).ok())
        .map(|catalog| catalog.values().map(Vec::len).sum()).unwrap_or(0)
}
#[cfg(test)]
mod release_catalog_tests {
    #[test] fn installed_count_matches_v210_catalog() { assert_eq!(super::count_tools(), 229); }
}

fn main() {
    if let Err(error)=upscale_validation::validate_startup(){eprintln!("Validation startup refused: {error}");std::process::exit(2);}
    // 无界面模式（验证/排查用）：命中就直接退出，不启动窗口
    let argv: Vec<String> = std::env::args().collect();
    if let Some(code) = run_cli(&argv) {
        std::process::exit(code);
    }

    let identity=match launch_identity::current(){Ok(value)=>value,Err(error)=>{eprintln!("{error}");return;}};

    let isolated_root=match startup_policy::isolated_root(){Ok(root)=>root,Err(error)=>{eprintln!("{error}");return;}};

    #[cfg(windows)]
    let _instance_guard=match shell_identity::acquire(){
        Ok(Some(guard))=>guard,
        Ok(None)=>return,
        Err(error)=>{if identity.isolated{eprintln!("{error}");}else{shell_identity::show_error(&error);}return;}
    };

    let mut context = tauri::generate_context!();
    context.config_mut().identifier = identity.identifier.clone();
    if let Some(root)=isolated_root {
        context.config_mut().app.windows.retain(|w|w.label=="main");
        for window in &mut context.config_mut().app.windows {window.visible=false;window.focus=false;window.data_directory=Some(root.join("webview"));}
        // Restrict only the validation profile. Production keeps its existing csp: null path.
        context.config_mut().app.security.csp = Some(tauri::utils::config::Csp::Policy(
            "default-src 'self'; base-uri 'none'; object-src 'none'; frame-src 'none'; form-action 'self'; connect-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; script-src 'self' 'wasm-unsafe-eval'".into()
        ));
    }
    let builder=tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol("fkmedia", |ctx, request, responder| {
            if !startup_policy::current().ancillary{responder.respond(tauri::http::Response::builder().status(403).body(Vec::<u8>::new()).unwrap());return;}
            let app = ctx.app_handle().clone();
            tauri::async_runtime::spawn_blocking(move || {
                responder.respond(media_preview::handle(&app, request));
            });
        })
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if !startup_policy::current().automatic_reveal{return;}
            println!("[FurinaKit] 第二实例被调用，唤醒主窗口");
            let _=main_window::reveal(app);
        }))
        .manage(Mutex::new(Children { node: None }))
        .manage(worker_startup::Hub::<WorkerChild>::new())
        ;
    let builder=if startup_policy::current().ancillary {builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
    }else{builder};
    builder
        .invoke_handler(|invoke| {
            if !upscale_validation::command_allowed(!startup_policy::current().ancillary,invoke.message.command()){invoke.resolver.reject("Command unavailable in isolated validation");return true;}
            let handler: fn(tauri::ipc::Invoke<tauri::Wry>) -> bool = tauri::generate_handler![
            ui_language::get_ui_language,
            ui_language::set_ui_language,
            batch_rename::rename_scan,
            batch_rename::rename_preview,
            batch_rename::rename_commit,
            signature_service::generate_signature,
            upload_stream::begin_upload,
            job_export::save_job_result,
            job_export::open_job_result,
            job_export::save_transfer_result,
            upload_stream::append_upload,
            upload_stream::finish_upload,
            upload_stream::abort_upload,
            embedded_site::sync_download_site,
            app_is_ready,
            count_tools,
            commands::dedup_pick_folder,
            commands::dedup_list_images,
            commands::dedup_read_image,
            commands::dedup_move_to_trash,
            clipboard_history::clip_list,
            clipboard_history::clip_licenses,
            clipboard_history::clip_settings,
            clipboard_history::clip_configure,
            clipboard_history::clip_restore,
            clipboard_history::clip_delete,
            clipboard_history::clip_pin,
            clipboard_history::clip_set_retention,
            clipboard_history::clip_details,
            clipboard_history::clip_image_preview,
            clipboard_history::clip_dismiss_warning,
            commands::clipboard_write,
            commands::clipboard_read,
            commands::clipboard_write_image,
            commands::window_minimize,
            commands::window_toggle_maximize,
            commands::window_is_maximized,
            commands::window_hide,
            preview_activate_main,
            commands::set_window_theme,
            commands::window_frontend_ready,
            commands::open_path,
            commands::app_root_path,
            commands::open_external,
            commands::launch_archpr,
            commands::open_archpr_dir,
            commands::capture_screen,
            recorder_panel::recorder_panel,
            recorder_panel::recorder_panel_state,
            recorder::recorder_play,
            recorder::recorder_sources,
            recorder::recorder_start,
            recorder::recorder_status,
            recorder::recorder_pause,
            recorder::recorder_resume,
            recorder::recorder_stop,
            recorder::recorder_save_as,
            capture_suite::capture_floating,
            capture_suite::pin_image,
            capture_suite::shot_get,
            capture_suite::shot_shape,
            capture_suite::shot_window,
            capture_suite::shot_update,
            capture_suite::shot_save,
            capture_suite::shot_action,
            capture_suite::shot_take_action,
            region_capture::capture_region,
            region_capture::region_capture_preview,
            region_capture::region_capture_pixel,
            region_capture::region_capture_current,
            region_capture::region_capture_ready,
            region_capture::region_capture_finish,
            commands::download_update,
            commands::install_update,
            commands::select_directory,
            commands::get_default_output_dir,
            commands::read_file_data_url,
            utility_windows::open_utility_window,
            utility_windows::utility_window_action,
            utility_windows::get_global_shortcuts,
            utility_windows::save_global_shortcuts,
            utility_windows::pause_global_shortcuts,
            notes::notes_command,
            default_output::sync_output_directory,
            default_output::open_output_directory,
            upload_stream::export_upload,
            api::api_call,
            api::get_build_info,
            install_count::telemetry_enabled,
            legacy_import::legacy_local_storage,
            legacy_import::apply_desktop_settings,
            commands::application_updates_allowed,
            commands::pick_file,
            commands::pick_save_path,
            floatball::save_float_ball_pos,
            floatball::load_float_ball_pos,
            floatball::set_float_ball_expanded,
            floatball::reveal_float_ball,
            floatball::snap_float_ball_to_edge,
            floatball::open_main_window_with_target,
            floatball::set_float_ball_visible,
            floatball::float_ball_menu_action,
            floatball::set_float_ball_size,
            floatball::get_float_ball_position,
            floatball::start_float_ball_dragging,
            floatball::push_pending_files_to_main,
            floatball::sync_float_ball_preferences,
            floatball::pending_file_info,
            floatball::read_pending_file_chunk,
            floatball::move_float_ball,
        ];
            handler(invoke)
        })
        .setup(|app| {
            let policy=startup_policy::current();
            ui_language::initialize(app.handle());
            // Pin once before workers, commands or model consumers. Keep component failure
            // visible to their APIs while allowing unrelated core tools/settings to start.
            let component_data=app.path().app_data_dir().map_err(|e|e.to_string());
            println!("[FurinaKit] component_data: {:?}", component_data);
            let selection=component_data.and_then(|data|runtime_layout::initialize_components_dir(
                &app_root_of(app.handle()),&data,startup_policy::isolated_root()?.map(|root|root.join("components")).or_else(||std::env::var_os("FURINAKIT_COMPONENTS_DIR").map(PathBuf::from))));
            println!("[FurinaKit] selection: {:?}", selection);
            if let Err(error)=&selection{eprintln!("[FurinaKit] Component location unavailable: {error}");}
            #[cfg(windows)]
            shell_identity::confirm_primary(app.handle());
            // Reconcile only our own persisted metadata; never resume networking at launch.
            if policy.ancillary {owned_tasks::recover(app.handle());}
            let root = app_root();
            println!("[FurinaKit] 应用根目录: {}", root.display());
            // 打印构建时间：一眼确认跑的是哪一版（旧进程没关时尤其重要）
            println!(
                "[FurinaKit] 构建时间 {} （版本 {}）",
                env!("FURINAKIT_BUILD_TIME"),
                env!("CARGO_PKG_VERSION")
            );

            if policy.ancillary {
            // 恢复悬浮球初始位置或初始化到靠右位置
            if let Some(fb) = app.get_webview_window("float-ball") {
                if let Ok(Some(pos)) = floatball::load_float_ball_pos(app.handle().clone()) {
                    let _ = fb.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x: pos.x, y: pos.y }));
                } else if let Ok(Some(m)) = fb.current_monitor() {
                    let sw = m.size().width as i32;
                    let sh = m.size().height as i32;
                    let sx = m.position().x;
                    let sy = m.position().y;
                    let default_x = sx + sw - 100;
                    let default_y = sy + (sh * 3 / 5);
                    floatball::update_origin_pos(default_x, default_y);
                    let _ = fb.set_position(tauri::Position::Physical(tauri::PhysicalPosition { x: default_x, y: default_y }));
                }
            }

            // 悬浮球拖动结束后要吸附并保存坐标：拖动交给系统原生拖动后前端收不到 mouseup，
            // 只能从窗口移动事件推断"松手了"，所以这里挂上监听。
            clipboard_history::start(app.handle().clone());
            let utilities=app.handle().clone();
            tauri::async_runtime::spawn_blocking(move || {if let Err(error)=utility_windows::initialize(&utilities){eprintln!("Utility shortcut registration: {error}");}});
            if let Err(e)=recorder::initialize(app.handle()){eprintln!("Recorder lease initialization failed: {e}");}
            recorder::watch();
            let capture_app=app.handle().clone();
            tauri::async_runtime::spawn_blocking(move || { let _=region_capture::prewarm(&capture_app); });
            start_float_ball_watcher(app.handle());
            // uTools 同款：光标不在球上时让窗口忽略鼠标事件，球周围点得穿
            crate::floatball::watch_ball_hit_area(app.handle().clone());
            } // Test profiles do not start clipboard/hotkey/recorder/capture/float-ball services.

            // B 方案：前端已改为静态文件，由 Tauri 自己加载，不再需要 Node 服务。
            // 工作进程（工具内核）暂时保留，等内核迁到 Rust 后再去掉。
            let node: Option<Child> = None;
            // Native-base never starts a Python process on the UI startup path.
            if policy.warm_worker && !runtime_layout::is_native_base(&root) {
                let _=app.state::<worker_startup::Hub<WorkerChild>>().warm(||start_worker(app.handle(),&root)).map_err(|e|eprintln!("[FurinaKit] {e}"));
            }
            if policy.ancillary {install_count::start(app.handle());}
            {
                let state = app.state::<Mutex<Children>>();
                let mut c = state.lock().unwrap();
                c.node = node;
            }

            // 静态前端由 tauri.conf.json 的 frontendDist 自动加载，这里不需要再导航
            println!("[FurinaKit] 前端为静态文件，无需启动 Web 服务");

            // Reveal after the frontend has applied its theme and committed a frame.
            // A one-shot fallback keeps a broken frontend reachable from the taskbar.
            if policy.automatic_reveal {
            let ready_app = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_secs(10));
                if let Some(w) = ready_app.get_window("main") {
                    let _ = commands::reveal_main_once(&w);
                }
            });

            }

            // 内置 FFmpeg：首次启动时放进组件目录（后台进行，不阻塞界面）
            {
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    if let Ok(dir) = crate::api::components_dir(&handle) { ffmpeg_components::ensure_bundled(&dir); }
                });
            }
            // 自动化测试通道：只有带 FURINAKIT_TEST_BRIDGE 环境变量启动时才开启（普通用户永远不会开）
            if let Ok(secret) = std::env::var("FURINAKIT_TEST_BRIDGE") {
                test_bridge::start(app.handle().clone(), secret);
            }

            // 跨设备互传的局域网服务（手机扫码后连的就是它）
            if policy.ancillary {
            match lanserver::start(app.handle().clone()) {
                Ok(port) => println!("[FurinaKit] 互传服务端口 {port}"),
                Err(e) => eprintln!("[FurinaKit] 互传服务启动失败：{e}"),
            }
            }

            #[cfg(windows)]
            {
                if let Some(w)=app.get_window("main"){shell_identity::apply_window_icons(&w);}
                if policy.tray {shell_identity::install_tray(app.handle()).map_err(std::io::Error::other)?;}
            }
            #[cfg(not(windows))]
            if policy.tray {
            // 托盘：显示/隐藏 + 退出
            let show = MenuItem::with_id(app, "show", ui_language::text("打开主界面", "Open FurinaKit"), true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", ui_language::text("退出 FurinaKit", "Quit FurinaKit"), true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            let _tray = TrayIconBuilder::with_id("furinakit-main")
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        let _=main_window::reveal(app);
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .build(app)?;

            }

            Ok(())
        })
        .on_page_load(|webview, payload| {
            // 页面加载完成 → 显示窗口（与 Electron 版的 did-finish-load 对应）
            if startup_policy::current().ancillary && matches!(payload.event(), tauri::webview::PageLoadEvent::Finished) && webview.label() == "float-ball" {
                if floatball::is_float_ball_enabled(&webview.app_handle()) {
                    let _ = webview.window().show();
                }
            }
        })
        .on_window_event(|window, event| {
            if window.label()=="main" && (matches!(event,WindowEvent::Focused(true)|WindowEvent::ScaleFactorChanged{..}) || matches!(event,WindowEvent::Resized(size) if size.width>0&&size.height>0)) {
                main_window::schedule(window);
            }
            #[cfg(windows)]
            if matches!(event, WindowEvent::ScaleFactorChanged { .. }) {
                shell_identity::apply_window_icons(window);
            }
            // 关窗口不退出，收进托盘（与 Electron 版一致）
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Temporary capture/editor windows must really close, not leak into the tray.
                if startup_policy::current().close_to_tray && ["main", "float-ball"].contains(&window.label()) {
                    api.prevent_close();
                    // 设置里选了「关闭窗口时：直接退出」→ 真退出（与 2.0.6 一致）
                    if window.label() == "main" && legacy_import::close_action_quit(window.app_handle()) {
                        window.app_handle().exit(0);
                    } else {
                        let _ = window.hide();
                    }
                }
            }
        })
        .build(context)
        .expect("Tauri 启动失败")
        .run(|app_handle, event| {
            #[cfg(windows)]
            if matches!(event, RunEvent::Exit) {shell_identity::cleanup(app_handle);}
            if let RunEvent::ExitRequested { .. } | RunEvent::Exit = event {
                if startup_policy::current().ancillary {recorder::shutdown();}
                // 退出时把两个子进程收干净，避免留下孤儿进程占着 3001 端口
                let state = app_handle.state::<Mutex<Children>>();
                let mut c = state.lock().unwrap();
                if let Err(e)=app_handle.state::<worker_startup::Hub<WorkerChild>>().shutdown(){eprintln!("[FurinaKit] Worker shutdown unconfirmed: {e}");}
                // Node remains a separate legacy frontend handle; worker hub is already closing.
                if let Some(mut ch) = c.node.take() {
                    let _ = ch.kill();
                    let _ = ch.wait();
                }
                println!("[FurinaKit] 退出清理请求已处理");
            }
        });
}
