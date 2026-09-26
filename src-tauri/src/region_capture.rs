//! Shared desktop region capture. Full desktop pixels live only in memory;
//! callers receive only the explicitly confirmed crop. No clipboard access.
use std::{sync::{Arc, Mutex, atomic::{AtomicBool, Ordering}, mpsc}, time::Duration};
use image::RgbaImage;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{Emitter, Manager, Window};

const LABEL: &str = "region-capture";
static BUSY: AtomicBool = AtomicBool::new(false);
static SESSION: Mutex<Option<Session>> = Mutex::new(None);

#[derive(Clone, Copy, Serialize)]
struct Bounds { x: i32, y: i32, width: u32, height: u32 }
#[derive(Clone, Copy, Deserialize)]
pub struct Selection { x: f64, y: f64, width: f64, height: f64 }
struct Session {
    id: String,
    frame: Arc<RgbaImage>,
    bounds: Bounds,
    windows: Vec<Bounds>,
    ready: Arc<AtomicBool>,
    reply: mpsc::Sender<Result<Option<Selection>,String>>,
}
struct CaptureGuard;
impl Drop for CaptureGuard { fn drop(&mut self) { BUSY.store(false, Ordering::SeqCst); } }
struct WindowState { win: Window, visible: bool, focused: bool, minimized: bool }
struct Restore { app: tauri::AppHandle, windows: Vec<WindowState> }
impl Drop for Restore {
    fn drop(&mut self) {
        SESSION.lock().unwrap_or_else(|e| e.into_inner()).take();
        if let Some(w) = self.app.get_webview_window(LABEL) { let _ = w.hide(); let _ = w.emit("region-capture-start", ""); }
        for state in &self.windows {
            if state.visible {
                let _ = state.win.show();
                if state.minimized { let _ = state.win.minimize(); }
            }
        }
        for state in &self.windows {
            if state.visible && state.focused && !state.minimized { let _ = state.win.set_focus(); }
        }
    }
}

#[cfg(windows)]
struct DpiScope(isize);
#[cfg(windows)]
#[link(name="user32")]
extern "system" {
    fn GetSystemMetrics(index: i32) -> i32;
    fn SetThreadDpiAwarenessContext(value: isize) -> isize;
}
#[cfg(windows)]
impl DpiScope {
    fn enter() -> Self { Self(unsafe { SetThreadDpiAwarenessContext(-4) }) }
}
#[cfg(windows)]
impl Drop for DpiScope { fn drop(&mut self) { if self.0 != 0 { unsafe { SetThreadDpiAwarenessContext(self.0); } } } }

fn grab() -> Result<(RgbaImage, Bounds), String> {
    #[cfg(windows)]
    {
        let _dpi = DpiScope::enter();
        let (x,y,w,h) = unsafe { (GetSystemMetrics(76),GetSystemMetrics(77),GetSystemMetrics(78),GetSystemMetrics(79)) };
        if w <= 0 || h <= 0 || u64::from(w as u32)*u64::from(h as u32) > 100_000_000 { return Err("屏幕尺寸无效或超过截图上限".into()); }
        let (rgba,width,height) = crate::commands::grab_screen_rgba()?;
        if (width,height)!=(w as u32,h as u32) { return Err("显示器布局发生变化，请重新截图".into()); }
        let image = RgbaImage::from_raw(width,height,rgba).ok_or("无法读取屏幕像素")?;
        return Ok((image,Bounds {x,y,width,height}));
    }
    #[cfg(not(windows))]
    Err("区域截图目前只支持 Windows".into())
}
fn visible_windows()->Vec<Bounds>{
    #[cfg(windows)] unsafe {
        #[repr(C)] struct Rect {l:i32,t:i32,r:i32,b:i32}
        #[link(name="user32")] extern "system" {fn EnumWindows(cb:extern "system" fn(isize,isize)->i32,p:isize)->i32;fn IsWindowVisible(w:isize)->i32;fn IsIconic(w:isize)->i32;fn GetWindowThreadProcessId(w:isize,p:*mut u32)->u32;fn GetWindowRect(w:isize,r:*mut Rect)->i32;}
        #[link(name="dwmapi")] extern "system" {fn DwmGetWindowAttribute(w:isize,a:u32,p:*mut std::ffi::c_void,n:u32)->i32;}
        extern "system" fn each(w:isize,p:isize)->i32{unsafe{
            let mut pid=0;GetWindowThreadProcessId(w,&mut pid);
            if pid==std::process::id()||IsWindowVisible(w)==0||IsIconic(w)!=0{return 1;}
            let mut cloaked=0u32;DwmGetWindowAttribute(w,14,&mut cloaked as *mut _ as *mut _,4);if cloaked!=0{return 1;}
            let mut rect=Rect{l:0,t:0,r:0,b:0};
            if DwmGetWindowAttribute(w,9,&mut rect as *mut _ as *mut _,16)!=0 && GetWindowRect(w,&mut rect)==0{return 1;}
            if rect.r>rect.l&&rect.b>rect.t {(&mut *(p as *mut Vec<Bounds>)).push(Bounds{x:rect.l,y:rect.t,width:(rect.r-rect.l) as u32,height:(rect.b-rect.t) as u32});}1
        }}
        let mut result=Vec::new();EnumWindows(each,&mut result as *mut _ as isize);return result;
    }
    #[cfg(not(windows))] Vec::new()
}

fn png_url(frame: &RgbaImage) -> Result<String,String> {
    let mut bytes=std::io::Cursor::new(Vec::new());
    image::DynamicImage::ImageRgba8(frame.clone()).write_to(&mut bytes,image::ImageFormat::Png).map_err(|e|e.to_string())?;
    Ok(format!("data:image/png;base64,{}",crate::jobs::b64_encode_public(bytes.get_ref())))
}
fn preview_url(frame: &RgbaImage) -> Result<String,String> {
    let image = image::DynamicImage::ImageRgba8(frame.clone()).into_rgb8();
    let mut bytes = Vec::new();
    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 85).encode_image(&image).map_err(|e|e.to_string())?;
    Ok(format!("data:image/jpeg;base64,{}",crate::jobs::b64_encode_public(&bytes)))
}
pub fn prewarm(app: &tauri::AppHandle) -> Result<(),String> {
    static CREATE: Mutex<()> = Mutex::new(());
    let _lock=CREATE.lock().map_err(|_|"选择器状态异常")?;
    if app.get_webview_window(LABEL).is_some() { return Ok(()); }
    let overlay=tauri::WebviewWindowBuilder::new(app,LABEL,tauri::WebviewUrl::App("index.html?window=region-capture".into()))
        .title(crate::ui_language::text("FurinaKit 区域截图", "FurinaKit Region Capture")).visible(false).decorations(false).resizable(false)
        .inner_size(1.0,1.0).position(-32000.0,-32000.0).transparent(true).background_color(tauri::window::Color(0,0,0,0)).always_on_top(true).skip_taskbar(true).shadow(false).focused(false).build().map_err(|e|e.to_string())?;
    overlay.on_window_event(|event| {
        if matches!(event,tauri::WindowEvent::Destroyed|tauri::WindowEvent::CloseRequested {..}) {
            if let Some(s)=SESSION.lock().unwrap_or_else(|e|e.into_inner()).as_ref() { let _=s.reply.send(Ok(None)); }
        }
    });
    Ok(())
}
#[tauri::command]
pub fn region_capture_current(webview:tauri::Webview) -> Result<String,String> {
    if webview.label()!=LABEL {return Err("仅选择器可读取截图会话".into());}
    Ok(SESSION.lock().unwrap_or_else(|e|e.into_inner()).as_ref().map(|s|s.id.clone()).unwrap_or_default())
}
fn wait_for_hidden_windows(delay: u64) {
    if delay > 0 { std::thread::sleep(Duration::from_millis(delay.min(15000))); }
    #[cfg(windows)] {
        #[link(name="dwmapi")] extern "system" {fn DwmFlush()->i32;}
        // Wait for the compositor to apply hidden windows, rather than an unconditional 220ms.
        if unsafe {DwmFlush()} < 0 {std::thread::sleep(Duration::from_millis(100));}
    }
}
fn crop_rect(s: Selection, width: u32, height: u32) -> Result<(u32,u32,u32,u32),String> {
    if ![s.x,s.y,s.width,s.height].iter().all(|n|n.is_finite()) || s.x<0.0 || s.y<0.0 || s.width<=0.0 || s.height<=0.0 || s.x+s.width>1.000001 || s.y+s.height>1.000001 {
        return Err("选区无效，请重新框选".into());
    }
    let left=(s.x*width as f64).round().clamp(0.0,width as f64) as u32;
    let top=(s.y*height as f64).round().clamp(0.0,height as f64) as u32;
    let right=((s.x+s.width)*width as f64).round().clamp(0.0,width as f64) as u32;
    let bottom=((s.y+s.height)*height as f64).round().clamp(0.0,height as f64) as u32;
    if right.saturating_sub(left)<8 || bottom.saturating_sub(top)<8 { return Err("选区至少需要 8 × 8 像素，不会自动改为截取整屏".into()); }
    Ok((left,top,right-left,bottom-top))
}

#[tauri::command]
pub async fn capture_region(app: tauri::AppHandle, webview: tauri::Webview, delay_ms: Option<u64>) -> Result<Value,String> {
    if !["main","float-ball"].contains(&webview.label()) { return Err("此窗口不能发起截图".into()); }
    if BUSY.compare_exchange(false,true,Ordering::SeqCst,Ordering::SeqCst).is_err() { return Err("已有区域截图正在进行，请完成或取消后重试".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let _busy=CaptureGuard;
        let began=std::time::Instant::now();
        prewarm(&app)?;
        let mut restore=Restore { app:app.clone(),windows:Vec::new() };
        for (label, win) in app.windows() {
            if label == "main" || label == "float-ball" || label.starts_with("shot-pin-") || label.starts_with("shot-edit-") {
                let visible=win.is_visible().map_err(|e|e.to_string())? && !win.is_minimized().unwrap_or(false);
                let focused=win.is_focused().unwrap_or(false);
                let minimized=win.is_minimized().unwrap_or(false);
                restore.windows.push(WindowState {win,visible,focused,minimized});
            }
        }
        for state in &restore.windows { if state.visible { state.win.hide().map_err(|e|e.to_string())?; } }
        wait_for_hidden_windows(delay_ms.unwrap_or(0));
        let (frame,bounds)=grab()?;
        let frame=Arc::new(frame);
        let (tx,rx)=mpsc::channel();
        let ready=Arc::new(AtomicBool::new(false));
        let id=crate::jobs::new_job_id_public();
        *SESSION.lock().unwrap_or_else(|e|e.into_inner())=Some(Session {id:id.clone(),frame:frame.clone(),bounds,windows:visible_windows(),ready:ready.clone(),reply:tx.clone()});
        let overlay=app.get_webview_window(LABEL).ok_or("选择器不可用")?;
        overlay.set_position(tauri::PhysicalPosition::new(bounds.x,bounds.y)).map_err(|e|e.to_string())?;
        overlay.set_size(tauri::PhysicalSize::new(bounds.width,bounds.height)).map_err(|e|e.to_string())?;
        eprintln!("Capture frame prepared in {} ms",began.elapsed().as_millis());
        overlay.emit("region-capture-start", &id).map_err(|e|e.to_string())?;
        // Escape is a native session-level cancel, including the initial fullscreen selection.
        // This only samples Escape while our selector is visible; no global key hook or logging.
        let waiting=std::time::Instant::now();
        let selection = loop {
            #[cfg(windows)] {
                #[link(name="user32")] extern "system" {fn GetAsyncKeyState(key:i32)->i16;}
                if ready.load(Ordering::SeqCst) && overlay.is_visible().unwrap_or(false) && unsafe{GetAsyncKeyState(0x1B)}<0 {break None;}
            }
            match rx.recv_timeout(Duration::from_millis(25)) {
                Ok(result)=>break result?,
                Err(mpsc::RecvTimeoutError::Disconnected)=>return Err("截图会话已断开".into()),
                Err(mpsc::RecvTimeoutError::Timeout)=>{
                    if !ready.load(Ordering::SeqCst)&&waiting.elapsed()>Duration::from_secs(15){return Err("区域选择器未能及时启动，已恢复原窗口，请重试".into());}
                    if waiting.elapsed()>Duration::from_secs(180){return Err("区域截图等待超时，已恢复原窗口；请重试".into());}
                }
            }
        };
        let Some(selection)=selection else { return Ok(json!({"success":false,"cancelled":true})); };
        let (x,y,w,h)=crop_rect(selection,bounds.width,bounds.height)?;
        let crop=image::imageops::crop_imm(frame.as_ref(),x,y,w,h).to_image();
        let data_url=png_url(&crop)?;
        Ok(json!({"success":true,"cancelled":false,"dataUrl":data_url,"width":w,"height":h,
            "region":{"x":bounds.x as i64+x as i64,"y":bounds.y as i64+y as i64,"width":w,"height":h},"requestId":id}))
    }).await.map_err(|e| { BUSY.store(false,Ordering::SeqCst);format!("区域截图异常：{e}") })?
}

#[tauri::command]
pub async fn region_capture_preview(webview: tauri::Webview, request_id: String) -> Result<Value,String> {
    if webview.label()!=LABEL {return Err("截图预览仅供选择器读取".into());}
    let (frame,bounds,windows)={let guard=SESSION.lock().unwrap_or_else(|e|e.into_inner());let s=guard.as_ref().filter(|s|s.id==request_id).ok_or("截图已结束")?;(s.frame.clone(),s.bounds,s.windows.clone())};
    tauri::async_runtime::spawn_blocking(move || Ok(json!({"dataUrl":preview_url(&frame)?,"width":bounds.width,"height":bounds.height,"originX":bounds.x,"originY":bounds.y,"windows":windows})))
        .await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub fn region_capture_pixel(webview:tauri::Webview,request_id:String,x:u32,y:u32)->Result<String,String>{
    if webview.label()!=LABEL{return Err("仅选择器可读取像素".into());}
    let guard=SESSION.lock().map_err(|_|"截图状态异常")?;let s=guard.as_ref().filter(|s|s.id==request_id).ok_or("截图已结束")?;
    let p=s.frame.get_pixel_checked(x,y).ok_or("像素超出范围")?;
    Ok(format!("#{:02X}{:02X}{:02X}",p[0],p[1],p[2]))
}
#[tauri::command]
pub fn region_capture_ready(webview: tauri::Webview, app:tauri::AppHandle, request_id:String) -> Result<(),String> {
    if webview.label()!=LABEL {return Err("仅区域选择器可调用".into());}
    let guard=SESSION.lock().unwrap_or_else(|e|e.into_inner());
    let s=guard.as_ref().filter(|s|s.id==request_id).ok_or("截图已结束")?;
    let b=s.bounds; let ready=s.ready.clone(); drop(guard);
    let w=app.get_webview_window(LABEL).ok_or("选择器已关闭")?;
    let _=b; // Geometry was set before publishing the session; do not resize again on ready.
    w.set_title(crate::ui_language::text("FurinaKit 区域截图", "FurinaKit Region Capture")).map_err(|e|e.to_string())?;
    w.show().map_err(|e|e.to_string())?;
    ready.store(true,Ordering::SeqCst);
    w.set_focus().map_err(|e|e.to_string())?;
    app.get_webview(LABEL).ok_or("选择器页面已关闭")?.set_focus().map_err(|e|e.to_string())
}
#[tauri::command]
pub fn region_capture_finish(webview:tauri::Webview, request_id:String, selection:Option<Selection>, error:Option<String>) -> Result<(),String> {
    if webview.label()!=LABEL {return Err("仅区域选择器可确认截图".into());}
    let mut guard=SESSION.lock().unwrap_or_else(|e|e.into_inner());
    let s=guard.as_ref().filter(|s|s.id==request_id).ok_or("截图已结束")?;
    if let Some(rect)=selection {crop_rect(rect,s.bounds.width,s.bounds.height)?;}
    s.reply.send(if let Some(message)=error {Err(message)} else {Ok(selection)}).map_err(|_|"截图已结束".to_string())?;
    // One-shot: a second confirm/cancel can never complete another capture request.
    guard.take();
    Ok(())
}

#[cfg(test)]
mod tests {
 use super::*;
 #[test] fn native_pixels_are_preserved(){assert_eq!(crop_rect(Selection{x:0.125,y:0.25,width:0.5,height:0.5},2560,1600).unwrap(),(320,400,1280,800));}
 #[test] fn tiny_selection_never_falls_back_to_fullscreen(){assert!(crop_rect(Selection{x:0.1,y:0.1,width:0.001,height:0.001},2560,1600).is_err());}
 #[test] fn invalid_numbers_are_rejected(){assert!(crop_rect(Selection{x:f64::NAN,y:0.0,width:0.5,height:0.5},100,100).is_err());}
 #[test] fn out_of_bounds_is_rejected(){assert!(crop_rect(Selection{x:0.8,y:0.0,width:0.5,height:0.5},100,100).is_err());}
 #[test] fn full_desktop_requires_explicit_selection(){assert_eq!(crop_rect(Selection{x:0.0,y:0.0,width:1.0,height:1.0},3840,1080).unwrap(),(0,0,3840,1080));}
 #[test] fn rounded_edges_have_no_gap(){assert_eq!(crop_rect(Selection{x:1.0/3.0,y:0.0,width:2.0/3.0,height:1.0},300,200).unwrap(),(100,0,200,200));}
}
