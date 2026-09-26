//! Small shared-content windows. Opening these never raises the main window.
use std::sync::Mutex;
use tauri::{Manager, Emitter};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
static KEYS: Mutex<Vec<(String, Shortcut)>> = Mutex::new(Vec::new());
fn kind_label(kind: &str) -> Result<(&'static str,&'static str),String> {
    match kind { "clipboard"=>Ok(("utility-clipboard",crate::ui_language::text("永久剪切板","Clipboard History"))),"notes"=>Ok(("utility-notes",crate::ui_language::text("便签","Notes"))),_=>Err("未知独立窗口".into()) }
}
#[tauri::command]
pub async fn open_utility_window(app: tauri::AppHandle, kind: String) -> Result<(),String> {
    tauri::async_runtime::spawn_blocking(move || open(&app,&kind)).await.map_err(|e|e.to_string())?
}
pub fn open(app: &tauri::AppHandle, kind: &str) -> Result<(),String> {
    static CREATE:Mutex<()>=Mutex::new(());
    let _guard=CREATE.lock().map_err(|_|"窗口状态异常")?;
    let (label,title)=kind_label(kind)?;
    if kind=="clipboard" { crate::paste_target::register_main(app); remember_paste_target(); }
    if let Some(w)=app.get_webview_window(label) {if kind=="clipboard"{crate::paste_target::panel(app);}w.show().map_err(|e|e.to_string())?;w.unminimize().map_err(|e|e.to_string())?;return w.set_focus().map_err(|e|e.to_string());}
    let w=tauri::WebviewWindowBuilder::new(app,label,tauri::WebviewUrl::App(format!("index.html?window={kind}").into()))
        .title(title).inner_size(590.0,660.0).min_inner_size(370.0,390.0).decorations(false)
        .transparent(true).background_color(tauri::window::Color(0,0,0,0)).always_on_top(true).skip_taskbar(true).visible(false).disable_drag_drop_handler().build().map_err(|e|e.to_string())?;
    if kind=="clipboard"{crate::paste_target::panel(app);}
    let copy=w.clone();
    w.on_window_event(move |e| {if let tauri::WindowEvent::CloseRequested{api,..}=e {api.prevent_close();let _=copy.hide();}});
    Ok(())
}
#[tauri::command]
pub async fn utility_window_action(webview:tauri::Webview,app:tauri::AppHandle,action:String)->Result<(),String>{
    if !["utility-notes","utility-clipboard"].contains(&webview.label()){return Err("仅独立小窗可使用此操作".into());}
    let w=app.get_webview_window(webview.label()).ok_or("窗口已关闭")?;
    match action.as_str(){
        "ready"=>{w.show().map_err(|e|e.to_string())?;w.set_focus().map_err(|e|e.to_string())},
        "settings"=>tauri::async_runtime::spawn_blocking(move||{
            w.hide().map_err(|e|e.to_string())?;
            crate::main_window::reveal(&app)?;
            app.get_webview("main").ok_or("主界面尚未就绪")?.eval("window.dispatchEvent(new CustomEvent('furina:open-settings',{detail:{section:'shortcuts'}}));").map_err(|e|e.to_string())
        }).await.map_err(|e|e.to_string())?,
        "hide"=>w.hide().map_err(|e|e.to_string()),
        "drag"=>w.start_dragging().map_err(|e|e.to_string()),
        "pin"=>w.set_always_on_top(!w.is_always_on_top().map_err(|e|e.to_string())?).map_err(|e|e.to_string()),
        _=>Err("未知窗口操作".into())
    }
}
// Five native global shortcuts. The OS registration is the source of truth, not localStorage.
#[derive(Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all="camelCase")]
pub struct HotkeyBinding { pub id:String, pub tool_id:String, pub key:String }
fn defaults()->Vec<HotkeyBinding>{
    [("main","main","Alt+Q"),("tool1","floating-screenshot","Alt+1"),("tool2","screen-recorder","Alt+2"),("tool3","clipboard-history","Alt+3"),("tool4","notes","Alt+4")]
        .iter().map(|(id,tool,key)|HotkeyBinding{id:(*id).into(),tool_id:(*tool).into(),key:(*key).into()}).collect()
}
static TRANSACTION:Mutex<()>=Mutex::new(());
static PAUSED:std::sync::atomic::AtomicBool=std::sync::atomic::AtomicBool::new(false);
static STATUS:Mutex<Option<String>>=Mutex::new(None);
fn register(app:&tauri::AppHandle,action:&str,key:Shortcut)->Result<(),String>{
    let action=action.to_owned();
    app.global_shortcut().on_shortcut(key,move |app,_,event|{
        if event.state!=ShortcutState::Pressed || PAUSED.load(std::sync::atomic::Ordering::SeqCst){return;}
        if action=="clipboard-history"{crate::paste_target::capture();}
        let app=app.clone();let action=action.clone();
        tauri::async_runtime::spawn(async move {
            let result=if action=="floating-screenshot" {
                match app.get_webview("main") {Some(w)=>crate::capture_suite::capture_floating(app.clone(),w,Some(0)).await.map(|_|()),None=>Err("主窗口尚未就绪".into())}
            } else {
                let a=app.clone();
                tauri::async_runtime::spawn_blocking(move||match action.as_str(){
                    "clipboard-history"=>open(&a,"clipboard"),"notes"=>open(&a,"notes"),
                    _=>crate::floatball::open_main_window_with_target(a,crate::floatball::OpenTargetPayload{category:None,tool_id:if action=="main"{None}else{Some(action)},pending_files:None,pending_files_data:None})
                }).await.map_err(|e|e.to_string()).and_then(|r|r)
            };
            if let Err(error)=result {let _=app.emit("utility-error",error);}
        });
    }).map_err(|e|format!("快捷键 {key} 注册失败，可能被系统或其他程序占用：{e}"))
}
fn configured(app:&tauri::AppHandle)->Vec<HotkeyBinding>{
    let mut bindings:Vec<HotkeyBinding>=serde_json::from_value(crate::api::read_settings_public(app)["globalShortcutsV2"].clone()).unwrap_or_else(|_|defaults());
    // Migrate the former shipped default only; preserve disabled/custom keys.
    if let Some(main)=bindings.iter_mut().find(|b|b.id=="main") {if main.key.eq_ignore_ascii_case("Ctrl+Space"){main.key="Alt+Q".into();}}
    bindings
}
fn apply(app:&tauri::AppHandle,bindings:&[HotkeyBinding])->Result<(),String>{
    if bindings.len()!=5 || bindings.iter().enumerate().any(|(i,b)|b.id!=if i==0{"main".to_string()}else{format!("tool{i}")}) {return Err("必须配置一个主界面和四个工具快捷键".into());}
    let mut next=Vec::new();
    for (i,b) in bindings.iter().enumerate(){
        if (i==0 && b.tool_id!="main") || b.tool_id.is_empty() || !b.tool_id.chars().all(|c|c.is_ascii_alphanumeric()||c=='-'){return Err("工具标识无效".into());}
        let text=b.key.replace(' ',"");if text.is_empty(){continue;}
        let key:Shortcut=text.parse().map_err(|e|format!("不支持的按键 {}：{e}",b.key))?;
        if next.iter().any(|(_,old)|*old==key){return Err("两项不能使用相同快捷键".into());}
        next.push((b.tool_id.clone(),key));
    }
    let mut old=KEYS.lock().map_err(|_|"快捷键状态异常")?;
    if *old==next{return Ok(());}
    for (_,key) in old.iter(){app.global_shortcut().unregister(*key).map_err(|e|e.to_string())?;}
    for (index,(action,key)) in next.iter().enumerate(){
        if let Err(error)=register(app,action,*key){
            for (_,key) in &next[..index]{let _=app.global_shortcut().unregister(*key);}
            let mut failures=Vec::new();
            for (action,key) in old.iter(){if let Err(e)=register(app,action,*key){failures.push(e);}}
            return Err(if failures.is_empty(){format!("{error}；已保留原快捷键")}else{format!("{error}；部分原快捷键恢复失败：{}",failures.join("；"))});
        }
    }
    *old=next;Ok(())
}
pub fn initialize(app:&tauri::AppHandle)->Result<(),String>{
    let _guard=TRANSACTION.lock().map_err(|_|"快捷键状态异常")?;
    let bindings=configured(app);
    let result=apply(app,&bindings);
    if result.is_err(){
        // One occupied tool shortcut must not disable the independently available main shortcut.
        let mut keys=KEYS.lock().map_err(|_|"快捷键状态异常")?;
        let mut errors=Vec::new();
        for b in bindings.iter().filter(|b|!b.key.trim().is_empty()){
            match b.key.replace(' ',"").parse::<Shortcut>(){
                Ok(key)=>{if keys.iter().any(|(_,k)|*k==key){continue;}match register(app,&b.tool_id,key){Ok(())=>keys.push((b.tool_id.clone(),key)),Err(e)=>errors.push(e)}},
                Err(e)=>errors.push(format!("快捷键 {} 无效：{e}",b.key)),
            }
        }
        let message=if errors.is_empty(){None}else{Some(errors.join("；"))};
        *STATUS.lock().map_err(|_|"快捷键状态异常")?=message.clone();
        return message.map_or(Ok(()),Err);
    }
    *STATUS.lock().map_err(|_|"快捷键状态异常")?=None;
    result
}
#[tauri::command]
pub fn get_global_shortcuts(app:tauri::AppHandle)->Result<serde_json::Value,String>{
    let _guard=TRANSACTION.lock().map_err(|_|"快捷键状态异常")?;
    Ok(serde_json::json!({"bindings":configured(&app),"error":STATUS.lock().map_err(|_|"快捷键状态异常")?.clone()}))
}
#[tauri::command]
pub fn save_global_shortcuts(app:tauri::AppHandle,bindings:Vec<HotkeyBinding>)->Result<(),String>{
    let _guard=TRANSACTION.lock().map_err(|_|"快捷键状态异常")?;
    let previous=configured(&app);
    apply(&app,&bindings)?;
    let mut settings=crate::api::read_settings_public(&app);
    settings["globalShortcutsV2"]=serde_json::to_value(&bindings).map_err(|e|e.to_string())?;
    if let Err(error)=crate::api::write_settings_public(&app,&settings){let rollback=apply(&app,&previous);return Err(format!("保存失败：{error}；恢复原设置：{}",if rollback.is_ok(){"成功"}else{"失败，请重新保存"}));}
    *STATUS.lock().map_err(|_|"快捷键状态异常")?=None;
    let _=app.emit("utility-shortcuts-changed",());
    Ok(())
}
#[tauri::command]
pub fn pause_global_shortcuts(app:tauri::AppHandle,paused:bool)->Result<(),String>{
    let _guard=TRANSACTION.lock().map_err(|_|"快捷键状态异常")?;
    if paused {
        PAUSED.store(true,std::sync::atomic::Ordering::SeqCst);
        let mut keys=KEYS.lock().map_err(|_|"快捷键状态异常")?;
        for (_,key) in keys.iter(){app.global_shortcut().unregister(*key).map_err(|e|e.to_string())?;}
        keys.clear();
        Ok(())
    } else {
        let result=apply(&app,&configured(&app));
        PAUSED.store(false,std::sync::atomic::Ordering::SeqCst);
        *STATUS.lock().map_err(|_|"快捷键状态异常")?=result.as_ref().err().cloned();
        result
    }
}

// The persistent clipboard panel tracks explicit external activation, not just hotkey opens.
fn remember_paste_target(){crate::paste_target::capture();}
pub fn paste_to_target(app:&tauri::AppHandle)->Result<(),String>{
    #[cfg(target_os="windows")] unsafe {
        #[repr(C)] #[derive(Clone,Copy)] struct Key{vk:u16,scan:u16,flags:u32,time:u32,extra:usize}
        #[repr(C)] union Data{key:Key,padding:[usize;4]}
        #[repr(C)] struct Input{kind:u32,data:Data}
        #[link(name="user32")] extern "system"{fn GetWindowThreadProcessId(w:isize,p:*mut u32)->u32;fn IsWindow(w:isize)->i32;fn SetForegroundWindow(w:isize)->i32;fn GetForegroundWindow()->isize;fn SendInput(n:u32,p:*const Input,size:i32)->u32;fn GetAsyncKeyState(k:i32)->i16;}
        let (target,expected_pid,focus)=crate::paste_target::snapshot().unwrap_or((0,0,0));
        let mut pid=0;GetWindowThreadProcessId(target,&mut pid);
        if target==0||IsWindow(target)==0||pid!=expected_pid{return Err("尚未记录到有效的目标输入窗口。内容已复制；保持剪切板打开，点击目标输入框后再点击条目。".into());}
        // Keep the clipboard visible. Only transfer input focus to the validated external target.
        SetForegroundWindow(target);
        for _ in 0..20 {if GetForegroundWindow()==target&&[0x10,0x11,0x12,0x5B,0x5C].iter().all(|k|GetAsyncKeyState(*k)>=0){break;}std::thread::sleep(std::time::Duration::from_millis(15));}
        if GetForegroundWindow()!=target || [0x10,0x11,0x12,0x5B,0x5C].iter().any(|k|GetAsyncKeyState(*k)<0){
            if let Some(w)=app.get_webview_window("utility-clipboard"){let _=w.show();let _=w.set_focus();}
            return Err("系统未允许切回原输入窗口，或修饰键尚未松开。内容已复制，可手动粘贴。".into());
        }
        // Restore the previously focused browser/native child, not merely the top-level HWND.
        if focus!=0 && IsWindow(focus)!=0 {
            #[link(name="user32")] extern "system"{fn GetAncestor(w:isize,flags:u32)->isize;fn AttachThreadInput(a:u32,b:u32,attach:i32)->i32;fn SetFocus(w:isize)->isize;}
            #[link(name="kernel32")] extern "system"{fn GetCurrentThreadId()->u32;}
            if GetAncestor(focus,2)==target {let mut child_pid=0;let thread=GetWindowThreadProcessId(focus,&mut child_pid);let own=GetCurrentThreadId();let attached=own!=thread&&AttachThreadInput(own,thread,1)!=0;if own==thread||attached{SetFocus(focus);}if attached{AttachThreadInput(own,thread,0);}}
        }
        if GetForegroundWindow()!=target{return Err("输入焦点已改变，未发送粘贴；内容已复制。".into());}
        let input=|vk,flags|Input{kind:1,data:Data{key:Key{vk,scan:0,flags,time:0,extra:0}}};
        let keys=[input(0x11,0),input(0x56,0),input(0x56,2),input(0x11,2)];
        if SendInput(4,keys.as_ptr(),std::mem::size_of::<Input>() as i32)!=4{let releases=[input(0x56,2),input(0x11,2)];SendInput(2,releases.as_ptr(),std::mem::size_of::<Input>() as i32);if let Some(w)=app.get_webview_window("utility-clipboard"){let _=w.show();let _=w.set_focus();}return Err("系统阻止了粘贴输入（可能目标程序权限更高），内容已复制，可手动粘贴。".into());}
        return Ok(());
    }
    #[cfg(not(target_os="windows"))] {let _=app;Err("此平台请手动粘贴".into())}
}
