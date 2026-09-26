// 工具用的 Rust 命令（替代原来 Electron 主进程的那批 IPC）
//
// 思路：**API 名字与参数保持和 Electron 版一致**，前端组件一行不用改。
// 原来的调用长这样（写在 preload 里）：
//     window.furinakit.dedupListImages(dir)
// 现在改成（写在 web/src/bridge.ts 里）：
//     window.furinakit.dedupListImages = (dir) => invoke("dedup_list_images", { dir })
// 两边名字一样，所以 163 个组件不需要动。
//
// 这一批只做「不依赖 Python 内核」的活：选文件夹、扫目录、读文件、移动文件、剪贴板。
// 需要图像/PDF/音视频处理的那些，等内核搬到 Rust 之后再补。

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use tauri::Manager;

const IMAGE_EXTS: [&str; 8] = ["jpg", "jpeg", "png", "webp", "bmp", "gif", "tif", "tiff"];

/// 隐藏子进程的控制台窗口。
///
/// ★ 这是个**必须**做的动作：Windows 上从图形程序（我们这个 exe 是 windows 子系统、
///   没有控制台）启动控制台程序（python.exe / curl / tasklist …）时，系统会**新建一个黑框**。
///   实测就是那个标题为 `E:\FurinaKit\services\worker\` 的黑窗口 ——
///   每次启动软件都会弹一下，用户肯定会看到，属于大忌。
///   Electron 版是靠 spawn 的 `windowsHide: true` 做到的，等价于这里的 CREATE_NO_WINDOW。
pub fn no_window(cmd: &mut std::process::Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    #[cfg(not(windows))]
    {
        let _ = cmd;
    }
}

#[derive(Serialize)]
pub struct FileEntry {
    pub path: String,
    pub name: String,
    pub size: u64,
    pub mtime: u64,
}

#[derive(Serialize)]
pub struct MoveResult {
    pub success: bool,
    pub trash_root: String,
    pub moved: Vec<String>,
    pub moved_sources: Vec<String>,
    pub failed: Vec<String>,
}

fn is_image(p: &Path) -> bool {
    match p.extension().and_then(|e| e.to_str()) {
        Some(e) => IMAGE_EXTS.contains(&e.to_ascii_lowercase().as_str()),
        None => false,
    }
}

/// 弹系统文件夹选择框，返回选中的目录路径
#[tauri::command]
pub async fn dedup_pick_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    tauri::async_runtime::spawn_blocking(move || {
        let picked = app.dialog().file().blocking_pick_folder();
        Ok(picked.map(|p| p.to_string()))
    }).await.map_err(|e|e.to_string())?
}

/// 递归扫目录里的图片（跳过隐藏目录与系统目录，深度限 6 层、上限 2 万张）
#[tauri::command]
pub async fn dedup_list_images(dir: String) -> Result<Vec<FileEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
    let root = PathBuf::from(&dir);
    if !root.is_dir() {
        return Err("文件夹不存在".into());
    }
    fs::read_dir(&root).map_err(|e|format!("无法读取所选目录：{e}"))?;
    let mut out = Vec::new();
    let mut stack = vec![(root.clone(), 0usize)];
    while let Some((cur, depth)) = stack.pop() {
        if depth > 6 || out.len() > 20000 {
            continue;
        }
        let entries = match fs::read_dir(&cur) {
            Ok(e) => e,
            Err(_) => continue,
        };
        for entry in entries.flatten() {
            let path = entry.path();
            let name = entry.file_name().to_string_lossy().to_string();
            let meta = match fs::symlink_metadata(&path) {
                Ok(m) => m,
                Err(_) => continue,
            };
            if dedup_reparse(&meta) {continue;}
            if meta.is_dir() {
                if name == "_重复待删除" || name.starts_with('.') || name == "$RECYCLE.BIN" || name == "System Volume Information" {
                    continue;
                }
                stack.push((path, depth + 1));
            } else if meta.is_file() && is_image(&path) {
                if out.len() >= 20000 {return Err("一次最多分析20000张图片，请缩小目录范围".into());}
                let mtime = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                    .map(|d| d.as_millis() as u64)
                    .unwrap_or(0);
                out.push(FileEntry {
                    path: path.to_string_lossy().to_string(),
                    name,
                    size: meta.len(),
                    mtime,
                });
            }
        }
    }
    out.sort_by(|a, b| b.mtime.cmp(&a.mtime));
    Ok(out)
    }).await.map_err(|e|e.to_string())?
}

/// 读单张图片的字节（base64），供前端算哈希用；超过 60MB 的不读
#[tauri::command]
pub async fn dedup_read_image(path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
    let p = PathBuf::from(&path);
    if !p.is_file() {
        return Err("文件不存在".into());
    }
    let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
    if meta.len() > 60 * 1024 * 1024 {
        return Err("单张图片超过 60MB，已跳过".into());
    }
    let bytes = fs::read(&p).map_err(|e| e.to_string())?;
    Ok(base64_encode(&bytes))
    }).await.map_err(|e|e.to_string())?
}

fn base64_encode(data: &[u8]) -> String {
    const T: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

/// 把选中的图片移到「_重复待删除」目录（**不直接删除**），保留原有相对结构
#[tauri::command]
pub async fn dedup_move_to_trash(files: Vec<String>, base_dir: String, trash_name: Option<String>) -> Result<MoveResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
    if files.is_empty() {return Err("没有选择任何文件".into());}
    let base=fs::canonicalize(base_dir).map_err(|e|e.to_string())?;
    if !base.is_dir(){return Err("基准目录不存在".into());}
    let name=trash_name.unwrap_or_else(||"_重复待删除".into());
    crate::batch_rename::valid_name(&name)?;
    let trash=base.join(name);
    if let Ok(meta)=fs::symlink_metadata(&trash){if dedup_reparse(&meta)||!meta.is_dir(){return Err("待删除目录不是普通目录".into());}}
    fs::create_dir_all(&trash).map_err(|e|e.to_string())?;
    let mut moved=Vec::new();let mut moved_sources=Vec::new();let mut failed=Vec::new();
    for f in files {
        let attempt=(||->Result<String,String>{
            let original=PathBuf::from(&f);
            let meta=fs::symlink_metadata(&original).map_err(|e|e.to_string())?;
            if !meta.is_file()||dedup_reparse(&meta){return Err("不是普通图片文件".into());}
            let src=fs::canonicalize(&original).map_err(|e|e.to_string())?;
            if src.starts_with(&trash)||!is_image(&src){return Err("不可移动该文件".into());}
            let rel=src.strip_prefix(&base).map_err(|_|"文件不在所选目录内")?;
            let mut parent=trash.clone();
            if let Some(rel_parent)=rel.parent(){for part in rel_parent.components(){parent.push(part);if let Ok(meta)=fs::symlink_metadata(&parent){if dedup_reparse(&meta)||!meta.is_dir(){return Err("目标路径包含链接或不是目录".into());}}fs::create_dir_all(&parent).map_err(|e|e.to_string())?;}}
            let filename=rel.file_name().ok_or("无效文件名")?;
            let dest=parent.join(filename);
            if dest.exists(){return Err("目标已存在，未覆盖；请处理重名文件后重试".into());}
            crate::batch_rename::move_new(&src,&dest)?;
            Ok(dest.to_string_lossy().into_owned())
        })();
        match attempt {Ok(dest)=>{moved.push(dest);moved_sources.push(f);},Err(e)=>failed.push(format!("{f}：{e}"))}
    }
    Ok(MoveResult {success:true,trash_root:trash.to_string_lossy().into_owned(),moved,moved_sources,failed})
    }).await.map_err(|e|e.to_string())?
}

/// 复制文本到剪贴板
#[tauri::command]
pub fn clipboard_write(app: tauri::AppHandle, text: String) -> Result<(), String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard().write_text(text).map_err(|e| e.to_string())
}

/// 读剪贴板文本
#[tauri::command]
pub fn clipboard_read(app: tauri::AppHandle) -> Result<String, String> {
    use tauri_plugin_clipboard_manager::ClipboardExt;
    app.clipboard().read_text().map_err(|e| e.to_string())
}

/// 把一张 PNG（base64）写进剪贴板 —— 「艺术与电子签名」那个"复制图片"用的
#[tauri::command]
pub async fn clipboard_write_image(_app: tauri::AppHandle, data: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move||{
        let bytes=crate::jobs::b64_decode_public(&data);
        crate::clipboard_history::write_png(&bytes)
    }).await.map_err(|e|e.to_string())?
}

/// 应用根目录（前端有时要用）
#[tauri::command]
pub fn app_root_path(app: tauri::AppHandle) -> String {
    crate::app_root_of(&app).to_string_lossy().to_string()
}

// ══════════════════════════════════════════════════════════════════════
// 窗口与桌面能力
//
// 这批对应 Electron 主进程里那几个 IPC（preload 暴露成 window.furinakit.*）。
// 界面上那三个最小化/最大化/关闭按钮、以及"打开输出目录""用浏览器打开"都靠它们。
// 用自定义命令而不是插件的 JS 接口：插件 JS 接口要配 capabilities 白名单，
// 自定义命令不用，而且和这个文件里其它命令风格一致。
// ══════════════════════════════════════════════════════════════════════

/// 最小化窗口
#[tauri::command]
pub async fn window_minimize(window: tauri::Window) -> Result<(), String> {
    window.minimize().map_err(|e| e.to_string())
}

/// 最大化 / 还原，返回操作后的最大化状态
#[tauri::command]
pub async fn window_toggle_maximize(window: tauri::Window) -> Result<bool, String> {
    let now = window.is_maximized().map_err(|e| e.to_string())?;
    if now {
        window.unmaximize().map_err(|e| e.to_string())?;
    } else {
        window.maximize().map_err(|e| e.to_string())?;
    }
    if window.label()=="main"{crate::main_window::schedule(&window);}
    window.is_maximized().map_err(|e| e.to_string())
}

/// 当前是否最大化（界面用它决定显示"最大化"还是"还原"图标）
#[tauri::command]
pub async fn window_is_maximized(window: tauri::Window) -> Result<bool, String> {
    window.is_maximized().map_err(|e| e.to_string())
}

/// 关闭窗口 = 收进托盘（与 Electron 版一致：不真的退出，托盘里还能打开）
#[tauri::command]
pub async fn window_hide(window: tauri::Window) -> Result<(), String> {
    window.hide().map_err(|e| e.to_string())
}

/// Match both native and WebView backing surfaces to the actual page theme.
#[tauri::command]
pub async fn set_window_theme(window: tauri::Window, webview: tauri::Webview, theme: String) -> Result<(), String> {
    let (t, color) = match theme.as_str() {
        "light" => (tauri::Theme::Light, tauri::window::Color(241, 245, 249, 255)),
        "eye-care" => (tauri::Theme::Light, tauri::window::Color(244, 239, 230, 255)),
        "dark" => (tauri::Theme::Dark, tauri::window::Color(21, 21, 23, 255)),
        _ => return Err("未知主题".into()),
    };
    // Never make transparent floating/capture windows opaque.
    if window.label() == "main" {
        window.set_background_color(Some(color)).map_err(|e| e.to_string())?;
        webview.set_background_color(Some(color)).map_err(|e| e.to_string())?;
    }
    window.set_theme(Some(t)).map_err(|e| e.to_string())
}

static MAIN_REVEALED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
pub fn reveal_main_once(window: &tauri::Window) -> Result<(), String> {
    use std::sync::atomic::Ordering;
    if window.label() != "main" || MAIN_REVEALED.swap(true, Ordering::SeqCst) { return Ok(()); }
    if let Err(e) = crate::main_window::reveal(window.app_handle()) {
        MAIN_REVEALED.store(false, Ordering::SeqCst);
        return Err(e.to_string());
    }
    Ok(())
}
#[tauri::command]
pub fn window_frontend_ready(window: tauri::Window) -> Result<(), String> {
    reveal_main_once(&window)
}

/// 在资源管理器里显示（目录就打开它，文件则选中它）
#[tauri::command]
pub fn open_path(app: tauri::AppHandle, path: String) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;
    let p = PathBuf::from(&path);
    if !p.exists() {
        return Err(format!("路径不存在：{path}"));
    }
    #[cfg(windows)]
    {
        let mut cmd = std::process::Command::new("explorer");
        if p.is_dir() {
            cmd.arg(&p);
        } else {
            cmd.arg(format!("/select,{}", p.to_string_lossy()));
        }
        no_window(&mut cmd);
        let _ = cmd.spawn().map_err(|e| format!("打开失败：{e}"))?;
        return Ok(());
    }
    #[cfg(not(windows))]
    {
        app.shell()
            .open(path, None)
            .map_err(|e| format!("打开目录失败：{e}"))
    }
}

// ══════════════════════════════════════════════════════════════════════
// 在线更新（下载安装包 → 启动安装程序）
//
// ★ 关键点：**用户绝大多数没有代理**。作者的 version.json 里给国内用户准备的镜像是
//   ghproxy.net，但 2026-09 实测它已经超时不通了，而 GitHub 官方直链普通用户又连不上
//   —— 两条路都走不通就等于"更新功能对用户失效"。
//   所以这里下载时**自动把所有可用的国内镜像都试一遍**（ghfast.top 实测能通，排最前），
//   哪个通用哪个。作者以后改 version.json 也不用担心镜像失效。
// ══════════════════════════════════════════════════════════════════════

/// 给定一个下载地址，列出可以依次尝试的候选（原地址 + 国内镜像）
fn download_candidates(url: &str) -> Vec<String> {
    let mut list = vec![url.to_string()];
    let looks_github = url.contains("github.com/") || url.contains("raw.githubusercontent.com");
    if looks_github {
        // 实测顺序：ghfast.top 通 → ghproxy.net（已挂，兜底）→ gh-proxy.com
        for prefix in ["https://ghfast.top/", "https://gh-proxy.com/", "https://ghproxy.net/"] {
            list.push(format!("{prefix}{url}"));
        }
    }
    list
}

/// 取远端文件大小（失败就返回 0，进度条会退化成"不确定"）
fn remote_size(url: &str) -> u64 {
    let mut cmd = std::process::Command::new("curl");
    cmd.args(["-sIL", "--ssl-no-revoke", "--max-time", "20", url]);
    no_window(&mut cmd);
    let Ok(out) = cmd.output() else { return 0 };
    let text = String::from_utf8_lossy(&out.stdout);
    // 取最后一个 content-length（重定向后才是真实大小）
    text.lines()
        .filter(|l| l.to_lowercase().starts_with("content-length:"))
        .filter_map(|l| l.split(':').nth(1)?.trim().parse::<u64>().ok())
        .last()
        .unwrap_or(0)
}

/// 下载更新安装包；一边下一边把进度发给界面
#[tauri::command]
pub fn download_update(app: tauri::AppHandle, url: String, sha256: Option<String>) -> Result<serde_json::Value, String> {
    if !application_updates_allowed(){return Err("Application updates are disabled in the isolated test profile".into());}
    use tauri::Emitter;
    if url.trim().is_empty() {
        return Err("下载链接为空".into());
    }
    let temp_dir = std::env::temp_dir();
    let target = temp_dir.join("FurinaKit-Setup-Update.exe");
    let _ = fs::remove_file(&target);

    let mut last_err = String::new();
    for candidate in download_candidates(url.trim()) {
        let total = remote_size(&candidate);
        let mut cmd = std::process::Command::new("curl");
        cmd.args([
            "-sS",
            "-L",
            "--ssl-no-revoke",
            "--fail",
            "--max-time",
            "3600",
            "-o",
            &target.to_string_lossy(),
            &candidate,
        ]);
        no_window(&mut cmd);
        let mut child = match cmd.spawn() {
            Ok(c) => c,
            Err(e) => {
                last_err = format!("启动下载失败：{e}");
                continue;
            }
        };

        // A file larger than 1 KB is NOT evidence of a successful download.
        let mut transfer_ok = false;
        loop {
            match child.try_wait() {
                Ok(Some(status)) => { transfer_ok = status.success(); break; },
                Ok(None) => {
                    let got = fs::metadata(&target).map(|m| m.len()).unwrap_or(0);
                    let percent = if total > 0 {
                        ((got as f64 / total as f64) * 100.0).min(99.0) as u32
                    } else {
                        0
                    };
                    let _ = app.emit(
                        "update-download-progress",
                        serde_json::json!({ "percent": percent, "receivedBytes": got, "totalBytes": total }),
                    );
                    std::thread::sleep(std::time::Duration::from_millis(300));
                }
                Err(e) => {
                    last_err = format!("等待下载失败：{e}");
                    let _ = child.kill(); let _ = child.wait();
                    break;
                }
            }
        }

        let ok = transfer_ok && crate::update_integrity::validate(&target, total, sha256.as_deref()).is_ok();
        if ok {
            let _ = app.emit(
                "update-download-progress",
                serde_json::json!({ "percent": 100, "receivedBytes": fs::metadata(&target).map(|m| m.len()).unwrap_or(0),
                                    "totalBytes": fs::metadata(&target).map(|m| m.len()).unwrap_or(0) }),
            );
            return Ok(serde_json::json!({
                "success": true,
                "filePath": target.to_string_lossy(),
                "size": fs::metadata(&target).map(|m| m.len()).unwrap_or(0),
            }));
        }
        last_err = format!("这个下载源不行：{candidate}");
        let _ = fs::remove_file(&target);
    }

    Err(if last_err.is_empty() {
        "下载失败，请检查网络".to_string()
    } else {
        format!("下载失败（所有镜像都试过了）：{last_err}")
    })
}

/// 启动刚下好的安装程序，然后退出本程序（让安装程序接管）
#[tauri::command]
pub fn install_update(app: tauri::AppHandle, path: String) -> Result<serde_json::Value, String> {
    if !application_updates_allowed(){return Err("Application updates are disabled in the isolated test profile".into());}
    let p = std::path::PathBuf::from(&path);
    if !p.is_file() {
        return Err("没找到下载好的安装包，请重新下载".into());
    }
    let mut cmd = std::process::Command::new(&p);
    if let Some(dir) = p.parent() {
        cmd.current_dir(dir);
    }
    // 安装程序要**可见**（用户要看到安装界面、点下一步），所以这里不加 no_window
    cmd.spawn().map_err(|e| format!("启动安装程序失败：{e}"))?;

    let handle = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(800));
        handle.exit(0);
    });
    Ok(serde_json::json!({ "success": true }))
}

/// 读取待办文件（用于悬浮球拖拽文件流转到对应工具中）
#[tauri::command]
pub fn read_file_data_url(path: String) -> Result<serde_json::Value, String> {
    let p = PathBuf::from(&path);
    if !p.is_file() {
        return Err("文件不存在或无法访问".into());
    }
    let meta = fs::metadata(&p).map_err(|e| e.to_string())?;
    if meta.len() > 300 * 1024 * 1024 {
        return Err("待办文件超过 300MB，请在该工具中直接选择".into());
    }
    let bytes = fs::read(&p).map_err(|e| format!("读取文件失败：{e}"))?;
    let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
    let mime = match ext.as_str() {
        "jpg" | "jpeg" => "image/jpeg",
        "png" => "image/png",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "mp4" => "video/mp4",
        "mkv" => "video/x-matroska",
        "mov" => "video/quicktime",
        "avi" => "video/x-msvideo",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    };
    let b64 = crate::jobs::b64_encode_public(&bytes);
    Ok(serde_json::json!({
        "success": true,
        "name": p.file_name().and_then(|n| n.to_str()).unwrap_or("file.bin"),
        "size": bytes.len(),
        "mime": mime,
        "dataUrl": format!("data:{mime};base64,{b64}"),
        "path": path,
    }))
}

/// 用系统默认浏览器打开链接
#[tauri::command]
pub fn open_external(app: tauri::AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_shell::ShellExt;
    app.shell()
        .open(url, None)
        .map_err(|e| format!("打开链接失败：{e}"))
}

// ══════════════════════════════════════════════════════════════════════
// 压缩包密码恢复（ARCHPR）：原版是调外部 exe，这里同样调外部 exe
// ══════════════════════════════════════════════════════════════════════

/// Only packaged resource layouts are accepted. Never fall back to the author's machine.
fn archpr_candidates(app: &tauri::AppHandle) -> Vec<PathBuf> {
    let mut list = Vec::new();
    if let Ok(dir) = app.path().resource_dir() {
        list.push(dir.join("tools/archpr/ARCHPR.exe"));
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            list.push(dir.join("tools/archpr/ARCHPR.exe"));
            list.push(dir.join("resources/tools/archpr/ARCHPR.exe"));
        }
    }
    #[cfg(debug_assertions)]
    list.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tools/archpr/ARCHPR.exe"));
    list.dedup();
    list
}

/// Spawn alone is not success: verify dependencies and observe the child main window.
#[tauri::command]
pub async fn launch_archpr(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let p = archpr_candidates(&app).into_iter().find(|p| p.is_file())
        .ok_or("内置 ARCHPR.exe 缺失。请重新安装完整的 FurinaKit 安装包，无需单独安装该工具。")?;
    tauri::async_runtime::spawn_blocking(move || {
        let pid = crate::archpr_runtime::launch(&p)?;
        Ok(serde_json::json!({
            "success": true, "path": p.to_string_lossy(), "pid": pid,
            "message": "已确认 ARCHPR 主窗口打开；未授权的新电脑使用其试用版，功能限制以 ARCHPR 提示为准。",
        }))
    }).await.map_err(|e| format!("启动检查任务失败：{e}"))?
}

#[tauri::command]
pub fn open_archpr_dir(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let p = archpr_candidates(&app).into_iter().find(|p| p.is_file())
        .ok_or("内置压缩包恢复组件缺失，请重新安装完整安装包。")?;
    let dir = p.parent().ok_or("内置组件路径无效")?;
    open_path(app, dir.to_string_lossy().to_string())
        .map(|_| serde_json::json!({ "success": true, "dir": dir.to_string_lossy() }))
}

// ══════════════════════════════════════════════════════════════════════
// 截屏（截图取字用）
//
// 原版 Electron 用 desktopCapturer；Tauri 没有这个能力，这里直接用 Windows 自带的
// GDI（BitBlt）抓整个虚拟屏幕 —— **不加任何第三方依赖**，也不需要额外权限。
// 返回 data URL，与原版给前端的形状一致（{ success, dataUrl }）。
// ══════════════════════════════════════════════════════════════════════

#[cfg(windows)]
mod gdi {
    use std::ffi::c_void;

    #[repr(C)]
    #[derive(Default, Clone, Copy)]
    pub struct BitmapInfoHeader {
        pub size: u32,
        pub width: i32,
        pub height: i32,
        pub planes: u16,
        pub bit_count: u16,
        pub compression: u32,
        pub size_image: u32,
        pub x_pels: i32,
        pub y_pels: i32,
        pub clr_used: u32,
        pub clr_important: u32,
    }

    #[repr(C)]
    #[derive(Default, Clone, Copy)]
    pub struct BitmapInfo {
        pub header: BitmapInfoHeader,
        pub colors: [u32; 3],
    }

    #[link(name = "user32")]
    extern "system" {
        pub fn GetDC(hwnd: *mut c_void) -> *mut c_void;
        pub fn ReleaseDC(hwnd: *mut c_void, hdc: *mut c_void) -> i32;
        pub fn GetSystemMetrics(index: i32) -> i32;
    }

    #[link(name = "gdi32")]
    extern "system" {
        pub fn CreateCompatibleDC(hdc: *mut c_void) -> *mut c_void;
        pub fn CreateCompatibleBitmap(hdc: *mut c_void, w: i32, h: i32) -> *mut c_void;
        pub fn SelectObject(hdc: *mut c_void, obj: *mut c_void) -> *mut c_void;
        pub fn BitBlt(
            dst: *mut c_void,
            x: i32,
            y: i32,
            w: i32,
            h: i32,
            src: *mut c_void,
            sx: i32,
            sy: i32,
            rop: u32,
        ) -> i32;
        pub fn GetDIBits(
            hdc: *mut c_void,
            hbm: *mut c_void,
            start: u32,
            lines: u32,
            bits: *mut c_void,
            bmi: *mut BitmapInfo,
            usage: u32,
        ) -> i32;
        pub fn DeleteObject(obj: *mut c_void) -> i32;
        pub fn DeleteDC(hdc: *mut c_void) -> i32;
    }
}

/// 抓取整个（可能是多屏的）桌面，返回 RGBA 像素与尺寸
#[cfg(windows)]
pub(crate) fn grab_screen_rgba() -> Result<(Vec<u8>, u32, u32), String> {
    use gdi::*;
    const SM_XVIRTUALSCREEN: i32 = 76;
    const SM_YVIRTUALSCREEN: i32 = 77;
    const SM_CXVIRTUALSCREEN: i32 = 78;
    const SM_CYVIRTUALSCREEN: i32 = 79;
    const SRCCOPY: u32 = 0x00CC_0020;
    const CAPTUREBLT: u32 = 0x4000_0000;
    const DIB_RGB_COLORS: u32 = 0;

    unsafe {
        let x = GetSystemMetrics(SM_XVIRTUALSCREEN);
        let y = GetSystemMetrics(SM_YVIRTUALSCREEN);
        let w = GetSystemMetrics(SM_CXVIRTUALSCREEN);
        let h = GetSystemMetrics(SM_CYVIRTUALSCREEN);
        if w <= 0 || h <= 0 || (w as u64) * (h as u64) > 100_000_000 {
            return Err("拿不到屏幕尺寸".into());
        }

        let screen_dc = GetDC(std::ptr::null_mut());
        if screen_dc.is_null() {
            return Err("GetDC 失败".into());
        }
        let mem_dc = CreateCompatibleDC(screen_dc);
        if mem_dc.is_null() { ReleaseDC(std::ptr::null_mut(), screen_dc); return Err("CreateCompatibleDC 失败".into()); }
        let bitmap = CreateCompatibleBitmap(screen_dc, w, h);
        if bitmap.is_null() { DeleteDC(mem_dc); ReleaseDC(std::ptr::null_mut(), screen_dc); return Err("CreateCompatibleBitmap 失败".into()); }
        let old = SelectObject(mem_dc, bitmap);
        if old.is_null() || old as isize == -1 { DeleteObject(bitmap); DeleteDC(mem_dc); ReleaseDC(std::ptr::null_mut(), screen_dc); return Err("SelectObject 失败".into()); }

        // CAPTUREBLT 让分层窗口（部分播放器/覆盖层）也能被抓到；若显卡驱动不支持则回退普通 SRCCOPY
        let ok = BitBlt(mem_dc, 0, 0, w, h, screen_dc, x, y, SRCCOPY | CAPTUREBLT) != 0
            || BitBlt(mem_dc, 0, 0, w, h, screen_dc, x, y, SRCCOPY) != 0;
        if !ok {
            SelectObject(mem_dc, old);
            DeleteObject(bitmap);
            DeleteDC(mem_dc);
            ReleaseDC(std::ptr::null_mut(), screen_dc);
            return Err("BitBlt 抓屏失败".into());
        }

        let mut bmi = BitmapInfo::default();
        bmi.header.size = std::mem::size_of::<BitmapInfoHeader>() as u32;
        bmi.header.width = w;
        bmi.header.height = -h; // 负数 = 自上而下，省得再翻转
        bmi.header.planes = 1;
        bmi.header.bit_count = 32;
        bmi.header.compression = 0; // BI_RGB

        let mut buf = vec![0u8; (w as usize) * (h as usize) * 4];
        // GetDIBits requires the bitmap NOT to be selected in any device context.
        SelectObject(mem_dc, old);
        let lines = GetDIBits(
            mem_dc,
            bitmap,
            0,
            h as u32,
            buf.as_mut_ptr() as *mut std::ffi::c_void,
            &mut bmi,
            DIB_RGB_COLORS,
        );

        DeleteObject(bitmap);
        DeleteDC(mem_dc);
        ReleaseDC(std::ptr::null_mut(), screen_dc);

        if lines != h {
            return Err("GetDIBits 读取像素失败".into());
        }

        // GDI 给的是 BGRA，转成 RGBA
        for px in buf.chunks_mut(4) {
            px.swap(0, 2);
            px[3] = 255;
        }
        Ok((buf, w as u32, h as u32))
    }
}

#[cfg(not(windows))]
pub(crate) fn grab_screen_rgba() -> Result<(Vec<u8>, u32, u32), String> {
    Err("截屏目前只支持 Windows".into())
}

/// Compatibility entry: screenshots now always require explicit desktop region confirmation.
#[tauri::command]
pub async fn capture_screen(app: tauri::AppHandle, webview:tauri::Webview, delay_ms: Option<u64>) -> Result<serde_json::Value, String> {
    crate::region_capture::capture_region(app, webview, delay_ms).await
}


/// 选文件夹（通用版；图片查重用的是另一条 dedup_pick_folder）
#[tauri::command]
pub async fn select_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    tauri::async_runtime::spawn_blocking(move || {
        let picked = app.dialog().file().blocking_pick_folder();
        Ok(picked.map(|p| p.to_string()))
    }).await.map_err(|e|e.to_string())?
}

/// 获取系统默认输出目录（优先用户 Downloads，次选 Desktop）
#[tauri::command]
pub async fn get_default_output_dir(app: tauri::AppHandle) -> Result<String, String> {
    crate::default_output::directory(&app).map(|p| p.to_string_lossy().into_owned())
}


/// 弹系统原生「选择文件」框，返回选中文件的**真实路径**。
///
/// 用途：需要真实路径才能干活的工具 —— 读媒体信息（ffprobe）、读写音频标签（mutagen）、
/// 用浏览器打开本地 HTML 等。网页里的 `<input type=file>` 拿不到路径，所以走原生对话框。
///
/// `extensions` 传扩展名清单（不带点），传空数组表示不过滤。
#[tauri::command]
pub async fn pick_file(app: tauri::AppHandle, extensions: Vec<String>) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let mut b = app.dialog().file();
    if !extensions.is_empty() {
        let refs: Vec<&str> = extensions.iter().map(|s| s.as_str()).collect();
        b = b.add_filter("支持的文件", &refs);
    }
    let picked = b.blocking_pick_file();
    Ok(picked.map(|p| p.to_string()))
}

/// 弹系统原生「保存文件」框，返回目标路径
#[tauri::command]
pub async fn pick_save_path(app: tauri::AppHandle, default_name: String) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    let picked = app.dialog().file().set_file_name(&default_name).blocking_save_file();
    Ok(picked.map(|p| p.to_string()))
}

#[derive(Deserialize)]
pub struct Nothing;
fn dedup_reparse(meta:&fs::Metadata)->bool {
    #[cfg(windows)] {use std::os::windows::fs::MetadataExt;meta.file_attributes() & 0x400 != 0}
    #[cfg(not(windows))] {meta.file_type().is_symlink()}
}

#[tauri::command]
pub fn application_updates_allowed()->bool{crate::startup_policy::current().ancillary}
