//! First-party native child webview for the download site; remote content gets no local bridge.
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{Manager, Emitter};
const LABEL: &str = "video-download-site";
const SITE: &str = "https://dy.kukutool.com/";
static DARK: AtomicBool = AtomicBool::new(false);
static LOCK: tauri::async_runtime::Mutex<()> = tauri::async_runtime::Mutex::const_new(());
fn theme(view: &tauri::Webview) {
    let filter = if DARK.load(Ordering::Relaxed) { "invert(0.9) hue-rotate(180deg)" } else { "none" };
    let _ = view.eval(format!("if(document.documentElement)document.documentElement.style.filter={};", serde_json::to_string(filter).unwrap()));
}
#[tauri::command]
pub async fn sync_download_site(app: tauri::AppHandle, webview: tauri::Webview, visible: bool, x: f64, y: f64, width: f64, height: f64, dark: bool, refresh: bool) -> Result<(), String> {
    if webview.label() != "main" { return Err("仅主窗口可管理下载网站".into()); }
    let _lock = LOCK.lock().await;
    DARK.store(dark, Ordering::Relaxed);
    if !visible {
        if let Some(v)=app.get_webview(LABEL) { v.hide().map_err(|e|e.to_string())?; }
        return Ok(());
    }
    if ![x,y,width,height].iter().all(|v|v.is_finite()) || x<0.0 || y<0.0 || width<1.0 || height<1.0 || width>20000.0 || height>20000.0 { return Err("无效的网站显示区域".into()); }
    let existing=app.get_webview(LABEL);
    let view=if let Some(view)=existing { view } else {
        let handle=app.clone();
        let escape_app=app.clone();
        let builder=tauri::webview::WebviewBuilder::new(LABEL,tauri::WebviewUrl::External(SITE.parse().unwrap()))
            // Narrow UI-only signal; remote content still receives no local command bridge.
            .initialization_script(r#"document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!e.repeat&&!e.isComposing&&!e.ctrlKey&&!e.altKey&&!e.metaKey&&!document.fullscreenElement){e.preventDefault();e.stopPropagation();location.href='furinakit-ui://escape';}},true);"#)
            .on_navigation(move |url| {
                if url.as_str()=="furinakit-ui://escape" {
                    if let Some(main)=escape_app.get_webview("main") {let _=main.eval("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}));");}
                    return false;
                }
                url.scheme()=="https" && url.host_str()==Some("dy.kukutool.com")
            })
            .on_new_window(move |url,_| {
                if matches!(url.scheme(),"https"|"http") { let _=crate::commands::open_external(handle.clone(),url.to_string()); }
                tauri::webview::NewWindowResponse::Deny
            })
            .on_page_load(|view,payload| {
                if payload.event()==tauri::webview::PageLoadEvent::Finished {
                    theme(&view);
                    let _=view.app_handle().emit_to("main","download-site-loaded",());
                }
            });
        app.get_window("main").ok_or("主窗口不存在")?.add_child(builder,tauri::LogicalPosition::new(x,y),tauri::LogicalSize::new(width,height)).map_err(|e|e.to_string())?
    };
    view.set_bounds(tauri::Rect {position:tauri::LogicalPosition::new(x,y).into(),size:tauri::LogicalSize::new(width,height).into()}).map_err(|e|e.to_string())?;
    theme(&view);
    if refresh {view.navigate(SITE.parse().unwrap()).map_err(|e|e.to_string())?;}
    view.show().map_err(|e|e.to_string())
}
