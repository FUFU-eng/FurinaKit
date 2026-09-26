//! Interface-only language preference. Separate from tool data, file names and worker settings.
use std::sync::{atomic::{AtomicBool, Ordering}, Mutex};
use tauri::{Emitter, Manager};
static ENGLISH: AtomicBool = AtomicBool::new(false);
static WRITE: Mutex<()> = Mutex::new(());
const EVENT: &str = "furinakit:language-changed";
pub fn text<'a>(zh: &'a str, en: &'a str) -> &'a str { if ENGLISH.load(Ordering::Acquire) { en } else { zh } }
fn current() -> &'static str { if ENGLISH.load(Ordering::Acquire) { "en" } else { "zh-CN" } }
fn path(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    if let Some(root)=crate::startup_policy::isolated_root()?{return Ok(root.join("profile/interface-language.txt"));}
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join("interface-language.txt"))
}
pub fn initialize(app: &tauri::AppHandle) {
    let en = path(app).ok().and_then(|p| std::fs::read_to_string(p).ok()).is_some_and(|s| s.trim() == "en");
    ENGLISH.store(en, Ordering::Release);
    update_titles(app);
}
fn update_titles(app: &tauri::AppHandle) {
    for (label, window) in app.webview_windows() {
        let title = if label == "main" { text("FurinaKit 芙宁娜工具箱", "FurinaKit") }
            else if label == "float-ball" { text("FurinaKit 悬浮球", "FurinaKit Launcher") }
            else if label == "utility-clipboard" { text("永久剪切板", "Clipboard History") }
            else if label == "utility-notes" { text("便签", "Notes") }
            else if label == "recorder-panel" { text("FurinaKit 录制控制", "FurinaKit Recording Controls") }
            else if label.contains("region") { text("FurinaKit 区域截图", "FurinaKit Region Capture") }
            else if label.starts_with("shot-editor") { text("FurinaKit 图片编辑", "FurinaKit Image Editor") }
            else if label.starts_with("shot-pin") { text("FurinaKit 悬浮截图", "FurinaKit Pinned Screenshot") }
            else { continue };
        let _ = window.set_title(title);
    }
}
#[tauri::command]
pub fn get_ui_language() -> &'static str { current() }
#[tauri::command]
pub fn set_ui_language(app: tauri::AppHandle, language: String) -> Result<(), String> {
    if language != "zh-CN" && language != "en" { return Err("Unsupported interface language".into()); }
    let _guard = WRITE.lock().map_err(|_| "Language preference is busy")?;
    let file = path(&app)?;
    let parent = file.parent().ok_or("Invalid language preference path")?;
    std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    // Persist successfully before changing any visible state. No read/merge of private tool settings.
    crate::atomic_store::write(&file, language.as_bytes())?;
    ENGLISH.store(language == "en", Ordering::Release);
    update_titles(&app);
    #[cfg(windows)]
    crate::shell_identity::refresh_language(&app);
    #[cfg(not(windows))]
    if let Some(tray) = app.tray_by_id("furinakit-main") {
        use tauri::menu::{Menu, MenuItem};
        if let (Ok(show), Ok(quit)) = (
            MenuItem::with_id(&app, "show", text("打开主界面", "Open FurinaKit"), true, None::<&str>),
            MenuItem::with_id(&app, "quit", text("退出 FurinaKit", "Quit FurinaKit"), true, None::<&str>)
        ) {
            if let Ok(menu) = Menu::with_items(&app, &[&show, &quit]) { let _ = tray.set_menu(Some(menu)); }
        }
    }
    app.emit(EVENT, language).map_err(|e| e.to_string())
}
