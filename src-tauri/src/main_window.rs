//! One recovery path for the main HWND and its local WebView, including multi-WebView mode.
use std::sync::{Mutex,atomic::{AtomicBool,Ordering}};
use tauri::Manager;
static REPAIRING:AtomicBool=AtomicBool::new(false);
static LAST_SIZE:Mutex<Option<(f64,f64)>>=Mutex::new(None);
struct Guard;
impl Drop for Guard{fn drop(&mut self){REPAIRING.store(false,Ordering::SeqCst);}}
pub fn repair(w:&tauri::Window)->Result<(),String>{
    if REPAIRING.swap(true,Ordering::SeqCst){return Ok(());}let _guard=Guard;
    if w.label()!="main"||w.is_minimized().unwrap_or(true)||!w.is_visible().unwrap_or(false){return Ok(());}
    #[cfg(windows)] unsafe {
        #[link(name="user32")] extern "system"{fn IsIconic(hwnd:isize)->i32;}
        if let Ok(hwnd)=w.hwnd(){if IsIconic(hwnd.0 as isize)!=0{return Ok(());}}
    }
    let monitor=w.current_monitor().map_err(|e|e.to_string())?.or(w.primary_monitor().map_err(|e|e.to_string())?).ok_or("找不到显示器")?;
    let dpi=w.scale_factor().map_err(|e|e.to_string())?;
    let work=monitor.work_area();let maxw=work.size.width as f64/dpi;let maxh=work.size.height as f64/dpi;
    let minw=1000.0_f64.min(maxw);let minh=620.0_f64.min(maxh);
    let mut size=w.inner_size().map_err(|e|e.to_string())?;
    if size.width as f64/dpi<minw-2.0||size.height as f64/dpi<minh-2.0{
        let previous=LAST_SIZE.lock().ok().and_then(|s|*s).unwrap_or((1280.0,750.0));
        if w.is_maximized().unwrap_or(false){w.unmaximize().map_err(|e|e.to_string())?;}
        w.set_min_size(Some(tauri::LogicalSize::new(minw,minh))).map_err(|e|e.to_string())?;
        w.set_size(tauri::LogicalSize::new(previous.0.clamp(minw,maxw),previous.1.clamp(minh,maxh))).map_err(|e|e.to_string())?;
        size=w.inner_size().map_err(|e|e.to_string())?;
    }
    let pos=w.outer_position().map_err(|e|e.to_string())?;
    let monitors=w.available_monitors().map_err(|e|e.to_string())?;
    let reachable=monitors.iter().any(|m|{let r=m.work_area();
        let overlap_x=(pos.x as i64+size.width as i64).min(r.position.x as i64+r.size.width as i64)-(pos.x as i64).max(r.position.x as i64);
        let overlap_y=(pos.y as i64+size.height as i64).min(r.position.y as i64+r.size.height as i64)-(pos.y as i64).max(r.position.y as i64);
        overlap_x>=64&&overlap_y>=64
    });
    if !reachable{w.set_position(tauri::PhysicalPosition::new(work.position.x+((work.size.width.saturating_sub(size.width))/2) as i32,work.position.y+((work.size.height.saturating_sub(size.height))/2) as i32)).map_err(|e|e.to_string())?;}
    // add_child disables the single-WebView assumptions. Explicitly repair the main host's bounds.
    if let Some(view)=w.app_handle().get_webview("main"){
        let position=view.position().map_err(|e|e.to_string())?;
        if position.x!=0||position.y!=0{view.set_position(tauri::PhysicalPosition::new(0,0)).map_err(|e|e.to_string())?;}
        let current=view.size().map_err(|e|e.to_string())?;
        if current.width!=size.width||current.height!=size.height{view.set_size(tauri::PhysicalSize::new(size.width,size.height)).map_err(|e|e.to_string())?;}
    }
    if !w.is_maximized().unwrap_or(false)&&size.width as f64/dpi>=minw-2.0&&size.height as f64/dpi>=minh-2.0{
        if let Ok(mut last)=LAST_SIZE.lock(){*last=Some((size.width as f64/dpi,size.height as f64/dpi));}
    }
    Ok(())
}
pub fn reveal(app:&tauri::AppHandle)->Result<(),String>{
    if !crate::startup_policy::current().automatic_reveal{return Err("Automatic activation is disabled for the isolated test profile".into());}
    let w=app.get_window("main").ok_or("主窗口尚未就绪")?;
    // Restore before showing/focusing; never treat Windows' minimized rectangle as normal bounds.
    if w.is_minimized().map_err(|e|e.to_string())?{w.unminimize().map_err(|e|e.to_string())?;}
    w.show().map_err(|e|e.to_string())?;
    schedule(&w);
    w.set_focus().map_err(|e|e.to_string())?;
    if let Some(view)=app.get_webview("main"){view.set_focus().map_err(|e|e.to_string())?;}
    Ok(())
}

// Window callbacks run inside the native dispatcher: never synchronously query/resize WebViews there.
pub fn schedule(w:&tauri::Window){
    static QUEUED:AtomicBool=AtomicBool::new(false);
    if QUEUED.swap(true,Ordering::SeqCst){return;}
    let w=w.clone();tauri::async_runtime::spawn_blocking(move||{
        std::thread::sleep(std::time::Duration::from_millis(35));
        if let Err(e)=repair(&w){eprintln!("Main window recovery: {e}");}
        QUEUED.store(false,Ordering::SeqCst);
    });
}
