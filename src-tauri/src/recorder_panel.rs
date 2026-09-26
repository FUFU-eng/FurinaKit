//! Small local recording controls; native countdown keeps running while the tool page is hidden.
use tauri::{Manager,Emitter};
use std::{sync::atomic::{AtomicBool,AtomicU8,Ordering},time::{Instant,Duration}};
static READY:AtomicBool=AtomicBool::new(false);
static CANCEL:AtomicBool=AtomicBool::new(false);
static PREPARING:AtomicBool=AtomicBool::new(false);
static PAINTED:AtomicU8=AtomicU8::new(255);
static COUNT:AtomicU8=AtomicU8::new(0);
fn window(app:&tauri::AppHandle)->Result<tauri::WebviewWindow,String>{
 static CREATE:std::sync::Mutex<()>=std::sync::Mutex::new(());let _guard=CREATE.lock().map_err(|_|"控制条创建状态异常")?;
 if let Some(w)=app.get_webview_window("recorder-panel"){return Ok(w);}
 READY.store(false,Ordering::SeqCst);
 let w=tauri::WebviewWindowBuilder::new(app,"recorder-panel",tauri::WebviewUrl::App("index.html?window=recorder-panel".into()))
  .title(crate::ui_language::text("FurinaKit 录制控制", "FurinaKit Recording Controls")).inner_size(112.0,44.0).decorations(false).resizable(false).always_on_top(true).skip_taskbar(true).visible(false).focused(false).build().map_err(|e|e.to_string())?;
 let copy=w.clone();w.on_window_event(move|event|{if let tauri::WindowEvent::CloseRequested{api,..}=event{api.prevent_close();if PREPARING.load(Ordering::SeqCst){CANCEL.store(true,Ordering::SeqCst);}else{let _=copy.emit("recorder-panel-close",());}}});
 #[cfg(windows)] unsafe{
  #[link(name="user32")] extern "system"{fn SetWindowDisplayAffinity(w:isize,affinity:u32)->i32;}
  if let Ok(hwnd)=w.hwnd(){if SetWindowDisplayAffinity(hwnd.0 as isize,0x11)==0{let _=w.destroy();return Err("系统无法从录屏中排除控制条，未开始录制".into());}}
 }
 Ok(w)
}
fn layout(w:&tauri::WebviewWindow,countdown:bool)->Result<(),String>{
 let m=w.current_monitor().map_err(|e|e.to_string())?.or(w.primary_monitor().map_err(|e|e.to_string())?).ok_or("找不到显示器")?;
 let dpi=m.scale_factor();let area=m.work_area();let (width,height)=if countdown{(176.0,176.0)}else{(112.0,44.0)};
 w.set_size(tauri::LogicalSize::new(width,height)).map_err(|e|e.to_string())?;
 let x=area.position.x+((area.size.width as f64-width*dpi)/2.0) as i32;
 let y=area.position.y+if countdown{((area.size.height as f64-height*dpi)/2.0) as i32}else{(12.0*dpi) as i32};
 w.set_position(tauri::PhysicalPosition::new(x,y)).map_err(|e|e.to_string())
}
pub fn return_main(app:&tauri::AppHandle)->Result<(),String>{
 CANCEL.store(true,Ordering::SeqCst);PREPARING.store(false,Ordering::SeqCst);COUNT.store(0,Ordering::SeqCst);
 if let Some(w)=app.get_webview_window("recorder-panel"){let _=w.hide();}
 crate::floatball::open_main_window_with_target(app.clone(),crate::floatball::OpenTargetPayload{category:None,tool_id:Some("screen-recorder".into()),pending_files:None,pending_files_data:None})
}
pub fn prepare(app:&tauri::AppHandle,seconds:u8)->Result<(),String>{
 PAINTED.store(255,Ordering::SeqCst);CANCEL.store(false,Ordering::SeqCst);PREPARING.store(true,Ordering::SeqCst);COUNT.store(seconds,Ordering::SeqCst);
 let w=window(app)?;layout(&w,seconds>0)?;
 let deadline=Instant::now()+Duration::from_secs(10);
 while !READY.load(Ordering::SeqCst)||PAINTED.load(Ordering::SeqCst)!=seconds{if CANCEL.load(Ordering::SeqCst){return Err("已取消录屏准备".into());}if Instant::now()>deadline{return Err("录制控制界面未能就绪，未开始录制".into());}std::thread::sleep(Duration::from_millis(25));}
 if let Some(main)=app.get_window("main"){main.hide().map_err(|e|e.to_string())?;}
 w.show().map_err(|e|e.to_string())?;
 if seconds>0{w.set_focus().map_err(|e|e.to_string())?;}
 for n in (1..=seconds).rev(){
  COUNT.store(n,Ordering::SeqCst);let _=w.emit("recorder-countdown",n);
  let until=Instant::now()+Duration::from_secs(1);
  while Instant::now()<until{if CANCEL.load(Ordering::SeqCst){return Err("已取消录屏倒计时".into());}std::thread::sleep(Duration::from_millis(20));}
 }
 if CANCEL.load(Ordering::SeqCst){return Err("已取消录屏倒计时".into());}
 w.hide().map_err(|e|e.to_string())?;
 if seconds>0{PAINTED.store(255,Ordering::SeqCst);}COUNT.store(0,Ordering::SeqCst);layout(&w,false)?;let _=w.emit("recorder-countdown",0u8);
 let until=Instant::now()+Duration::from_secs(5);
 while PAINTED.load(Ordering::SeqCst)!=0{if CANCEL.load(Ordering::SeqCst){return Err("已取消录制".into());}if Instant::now()>until{return Err("迷你控制条未就绪，未开始录制".into());}std::thread::sleep(Duration::from_millis(20));}
 #[cfg(windows)] unsafe{#[link(name="dwmapi")] extern "system"{fn DwmFlush()->i32;}DwmFlush();}
 Ok(())
}
pub fn started(app:&tauri::AppHandle)->Result<(),String>{PREPARING.store(false,Ordering::SeqCst);window(app)?.show().map_err(|e|e.to_string())}
#[tauri::command]
pub fn recorder_panel_state(webview:tauri::Webview)->Result<serde_json::Value,String>{
 if webview.label()!="recorder-panel"{return Err("仅录制控制条可读".into());}
 Ok(serde_json::json!({"countdown":COUNT.load(Ordering::SeqCst),"preparing":PREPARING.load(Ordering::SeqCst)}))
}
#[tauri::command]
pub async fn recorder_panel(app:tauri::AppHandle,webview:tauri::Webview,action:String)->Result<(),String>{
 if !["main","recorder-panel"].contains(&webview.label()){return Err("仅本地录屏界面可用".into());}
 match action.as_str(){
  "countdown-ready"=>{PAINTED.store(3,Ordering::SeqCst);Ok(())},
  "bar-ready"=>{PAINTED.store(0,Ordering::SeqCst);Ok(())},
  "ready"=>{READY.store(true,Ordering::SeqCst);Ok(())},
  "cancel"=>{if PREPARING.load(Ordering::SeqCst){CANCEL.store(true,Ordering::SeqCst);}Ok(())},
  "drag"=>app.get_webview_window("recorder-panel").ok_or("控制条已关闭")?.start_dragging().map_err(|e|e.to_string()),
  "return"=>tauri::async_runtime::spawn_blocking(move||return_main(&app)).await.map_err(|e|e.to_string())?,
  "warm"=>tauri::async_runtime::spawn_blocking(move||window(&app).map(|_|())).await.map_err(|e|e.to_string())?,
  "open"=>tauri::async_runtime::spawn_blocking(move||{let w=window(&app)?;layout(&w,false)?;w.show().map_err(|e|e.to_string())?;if let Some(main)=app.get_window("main"){main.hide().map_err(|e|e.to_string())?;}Ok(())}).await.map_err(|e|e.to_string())?,
  _=>Err("未知录制控制条操作".into())
 }
}
