//! Windows shell identity: fail-closed launch gate, DPI-sized icons and one GUID tray icon.
//! All HWND / tray lifecycle operations run on the Tauri UI thread. No Explorer restarts.
#![cfg(windows)]
use std::{ffi::c_void, mem::size_of, ptr, sync::Mutex, time::Duration};
use tauri::Manager;
use sha2::{Digest,Sha256};
use std::{cell::Cell,path::PathBuf};
type Handle = isize;
#[repr(C)]
#[derive(Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
struct Guid { a:u32, b:u16, c:u16, d:[u8;8] }
// Windows binds unsigned GUID icons to the executable path. Keep identity stable for
// restart/update at the SAME path, and migrate only our own previous GUID when paths move.
const GUID_NAMESPACE:u32=0x7d27c541;
fn tray_guid()->Guid{
    let path=std::env::current_exe().unwrap_or_default().to_string_lossy().replace('/',"\\").to_lowercase();
    let hash=Sha256::digest(path.as_bytes());
    Guid{a:GUID_NAMESPACE,b:u16::from_le_bytes([hash[0],hash[1]]),c:u16::from_le_bytes([hash[2],hash[3]]),d:hash[4..12].try_into().unwrap()}
}
static ICONS:Mutex<Vec<(i32,Handle)>>=Mutex::new(Vec::new());
const WM_TRAY:u32=0x8000+53;
const WM_USERDATA:i32=-21;
#[repr(C)]
struct Point{x:i32,y:i32}
#[repr(C)]
struct CopyData{tag:usize,bytes:u32,data:*const c_void}
#[repr(C)]
struct WindowClass{
    style:u32,proc:Option<unsafe extern "system" fn(Handle,u32,usize,isize)->isize>,
    class_extra:i32,window_extra:i32,instance:Handle,icon:Handle,cursor:Handle,background:Handle,
    menu:*const u16,name:*const u16,
}
#[repr(C)]
struct NotifyIcon{
    size:u32,window:Handle,id:u32,flags:u32,message:u32,icon:Handle,tip:[u16;128],
    state:u32,state_mask:u32,info:[u16;256],version:u32,title:[u16;64],info_flags:u32,
    guid:Guid,balloon_icon:Handle,
}
#[link(name="kernel32")]
extern "system" {
    fn OpenMutexW(access:u32,inherit:i32,name:*const u16)->Handle;
    fn GetLastError()->u32;
    fn CloseHandle(handle:Handle)->i32;
    fn GetModuleHandleW(name:*const u16)->Handle;
    fn GetCurrentProcessId()->u32;
}
#[link(name="user32")]
extern "system" {
    fn FindWindowW(class:*const u16,name:*const u16)->Handle;
    fn SendMessageTimeoutW(window:Handle,msg:u32,w:usize,l:isize,flags:u32,timeout:u32,result:*mut usize)->isize;
    fn SendMessageW(window:Handle,msg:u32,w:usize,l:isize)->isize;
    fn MessageBoxW(window:Handle,text:*const u16,title:*const u16,kind:u32)->i32;
    fn LoadImageW(instance:Handle,name:*const u16,kind:u32,width:i32,height:i32,flags:u32)->Handle;
    fn GetDpiForWindow(window:Handle)->u32;
    fn GetWindowThreadProcessId(window:Handle,process:*mut u32)->u32;
    fn GetSystemMetricsForDpi(index:i32,dpi:u32)->i32;
    fn RegisterClassW(class:*const WindowClass)->u16;
    fn RegisterWindowMessageW(name:*const u16)->u32;
    fn CreateWindowExW(ex:u32,class:*const u16,title:*const u16,style:u32,x:i32,y:i32,width:i32,height:i32,parent:Handle,menu:Handle,instance:Handle,param:*const c_void)->Handle;
    fn DefWindowProcW(window:Handle,msg:u32,w:usize,l:isize)->isize;
    fn SetWindowLongPtrW(window:Handle,index:i32,value:isize)->isize;
    fn GetWindowLongPtrW(window:Handle,index:i32)->isize;
    fn DestroyWindow(window:Handle)->i32;
    fn CreatePopupMenu()->Handle;
    fn AppendMenuW(menu:Handle,flags:u32,id:usize,text:*const u16)->i32;
    fn DestroyMenu(menu:Handle)->i32;
    fn GetCursorPos(point:*mut Point)->i32;
    fn SetForegroundWindow(window:Handle)->i32;
    fn TrackPopupMenu(menu:Handle,flags:u32,x:i32,y:i32,reserved:i32,window:Handle,rect:*const c_void)->u32;
    fn PostMessageW(window:Handle,msg:u32,w:usize,l:isize)->i32;
    fn ChangeWindowMessageFilterEx(window:Handle,message:u32,action:u32,filter:*mut c_void)->i32;
}
#[link(name="shell32")]
extern "system" {
    fn Shell_NotifyIconW(action:u32,data:*const NotifyIcon)->i32;
    fn SetCurrentProcessExplicitAppUserModelID(id:*const u16)->i32;
}
fn wide(s:&str)->Vec<u16>{s.encode_utf16().chain(Some(0)).collect()}
pub type InstanceGuard=crate::launch_identity::MutexGuard;
fn notify_existing(){
    // Interoperate with the existing Tauri plugin used by V51/V52. Startup may not have
    // created its IPC window yet; wait a bounded time but NEVER continue as a second app.
    let class=wide("com.furinakit.desktop-sic");let title=wide("com.furinakit.desktop-siw");
    for _ in 0..60 {
        let window=unsafe{FindWindowW(class.as_ptr(),title.as_ptr())};
        if window!=0 {
            let bytes=b"|furinakit\0";
            let data=CopyData{tag:1542,bytes:bytes.len() as u32,data:bytes.as_ptr().cast()};
            let mut result=0;
            if unsafe{SendMessageTimeoutW(window,0x004a,0,&data as *const _ as isize,0x0002,1500,&mut result)}!=0{return;}
            break;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
    unsafe{MessageBoxW(0,wide("FurinaKit 已在运行或正在启动。切换新版前请先从旧版托盘退出。\n\nFurinaKit is already running or starting. Exit the older build from its system tray before opening another version. A second instance will not be started.").as_ptr(),wide("FurinaKit").as_ptr(),0x40);}
}
pub fn acquire()->Result<Option<InstanceGuard>,String>{
    let identity=crate::launch_identity::current()?;
    let guard=match crate::launch_identity::acquire(identity)?{
        crate::launch_identity::Admission::Primary(guard)=>guard,
        crate::launch_identity::Admission::Existing=>{
            if !identity.isolated{notify_existing();}else{eprintln!("Test-profile instance already exists; no window activation");}
            return Ok(None);
        }
    };
    unsafe {
        // Test-profile admission must never open, notify or activate the daily instance.
        if !identity.isolated {
            let legacy=OpenMutexW(0x00100000,0,wide("com.furinakit.desktop-sim").as_ptr());
            let legacy_error=GetLastError();
            if legacy!=0 {CloseHandle(legacy);notify_existing();drop(guard);return Ok(None);}
            if legacy_error==5 {drop(guard);return Err("检测到不同权限的已有实例，请从原实例退出后再打开".into());}
        }
        let _=SetCurrentProcessExplicitAppUserModelID(wide(&identity.identifier).as_ptr());
        Ok(Some(guard))
    }
}
/// Close the remaining old/new simultaneous-start race in the upstream plugin.
/// This runs immediately after plugin setup, before workers, hotkeys, or a tray exist.
fn instance_window_names(identifier:&str)->(String,String){
    (format!("{identifier}-sic"),format!("{identifier}-siw"))
}
#[cfg(test)] mod identity_tests{
    #[test] fn instance_identity_follows_the_active_profile(){
        assert_eq!(super::instance_window_names("com.furinakit.desktop"),("com.furinakit.desktop-sic".into(),"com.furinakit.desktop-siw".into()));
        assert_eq!(super::instance_window_names("com.furinakit.test.release-clean"),("com.furinakit.test.release-clean-sic".into(),"com.furinakit.test.release-clean-siw".into()));
    }
}
pub fn confirm_primary(app:&tauri::AppHandle){
    unsafe {
        let (class,title)=instance_window_names(&app.config().identifier);
        let hwnd=FindWindowW(wide(&class).as_ptr(),wide(&title).as_ptr());
        let mut pid=0;
        if hwnd!=0 {GetWindowThreadProcessId(hwnd,&mut pid);}
        if pid!=GetCurrentProcessId(){
            if !crate::launch_identity::current().map(|i|i.isolated).unwrap_or(true){notify_existing();}
            else{eprintln!("Test-profile primary confirmation failed; no window activation");}
            app.cleanup_before_exit();std::process::exit(0);
        }
    }
}
pub fn show_error(error:&str){unsafe{MessageBoxW(0,wide(error).as_ptr(),wide("FurinaKit").as_ptr(),0x10);}}
unsafe fn icon_for(size:i32)->Handle{
    // No LR_SHARED: its cache can select a different size. Cache our own exact-size
    // handles for the process lifetime; Windows frees USER objects on process teardown.
    let size=size.clamp(16,256);
    let Ok(mut cache)=ICONS.lock() else{return 0;};
    if let Some((_,icon))=cache.iter().find(|(n,_)|*n==size){return *icon;}
    let icon=LoadImageW(GetModuleHandleW(ptr::null()),32512usize as *const u16,1,size,size,0);
    if icon!=0 {cache.push((size,icon));}
    icon
}
pub fn apply_window_icons(window:&tauri::Window){
    let Ok(hwnd)=window.hwnd() else{return;};
    unsafe {
        let hwnd=hwnd.0 as isize;let dpi=GetDpiForWindow(hwnd).max(96);
        for (kind,metric) in [(0,49),(1,11)] {
            let icon=icon_for(GetSystemMetricsForDpi(metric,dpi));
            if icon!=0 {SendMessageW(hwnd,0x0080,kind,icon);}
        }
    }
}
struct TrayData{app:tauri::AppHandle,taskbar_created:u32,registered:Cell<bool>,guid:Guid,journal:PathBuf}
struct TrayState(Mutex<Handle>);
unsafe fn notify_data(hwnd:Handle,guid:Guid)->NotifyIcon{
    let mut data:NotifyIcon=std::mem::zeroed();data.size=size_of::<NotifyIcon>() as u32;
    data.window=hwnd;data.id=1;data.guid=guid;data.flags=0x20; // NIF_GUID
    data
}
unsafe fn remove_icon(hwnd:Handle,guid:Guid){let data=notify_data(hwnd,guid);Shell_NotifyIconW(2,&data);}
unsafe fn put_icon(hwnd:Handle,state:&TrayData,recreate:bool){
    let taskbar=FindWindowW(wide("Shell_TrayWnd").as_ptr(),ptr::null());
    let dpi=GetDpiForWindow(taskbar).max(96);
    let mut data=notify_data(hwnd,state.guid);
    data.flags|=1|2|4;data.message=WM_TRAY;data.icon=icon_for(GetSystemMetricsForDpi(49,dpi));
    let tip=wide(crate::ui_language::text("FurinaKit 芙宁娜工具箱", "FurinaKit"));data.tip[..tip.len().min(128)].copy_from_slice(&tip[..tip.len().min(128)]);
    if data.icon==0 {eprintln!("FurinaKit tray icon resource unavailable");return;}
    if recreate || !state.registered.get() {
        // Delete only our known GUID (including an own crash remnant), never other apps.
        remove_icon(hwnd,state.guid);
        state.registered.set(Shell_NotifyIconW(0,&data)!=0);
    } else if Shell_NotifyIconW(1,&data)==0 {
        remove_icon(hwnd,state.guid);state.registered.set(Shell_NotifyIconW(0,&data)!=0);
    }
    if state.registered.get(){
        if let Some(parent)=state.journal.parent(){let _=std::fs::create_dir_all(parent);}
        if let Ok(text)=serde_json::to_string(&state.guid){let _=std::fs::write(&state.journal,text);}
    }
    if !state.registered.get() {eprintln!("FurinaKit tray unavailable; waiting for Explorer TaskbarCreated");}
}
fn reveal(app:&tauri::AppHandle){let _=crate::main_window::reveal(app);}
unsafe extern "system" fn tray_proc(hwnd:Handle,msg:u32,w:usize,l:isize)->isize{
    let raw=GetWindowLongPtrW(hwnd,WM_USERDATA) as *mut TrayData;
    if raw.is_null(){return DefWindowProcW(hwnd,msg,w,l);}
    if msg==0x0002 { // WM_DESTROY
        SetWindowLongPtrW(hwnd,WM_USERDATA,0);remove_icon(hwnd,(*raw).guid);drop(Box::from_raw(raw));return 0;
    }
    let data=&*raw;
    if msg==data.taskbar_created {put_icon(hwnd,data,true);return 0;}
    if [0x001a,0x007e,0x02e0].contains(&msg){put_icon(hwnd,data,false);}
    if msg==WM_TRAY {
        let app=data.app.clone(); // no borrowed TrayData across the nested menu message loop
        match l as u32 {
            0x0202|0x0203=>reveal(&app), // left click/double click
            0x0205|0x007b=>{
                let menu=CreatePopupMenu();if menu==0{return 0;}
                AppendMenuW(menu,0,1,wide(crate::ui_language::text("打开主界面", "Open FurinaKit")).as_ptr());
                AppendMenuW(menu,0x800,0,ptr::null());
                AppendMenuW(menu,0,2,wide(crate::ui_language::text("退出 FurinaKit", "Quit FurinaKit")).as_ptr());
                let mut point=Point{x:0,y:0};GetCursorPos(&mut point);SetForegroundWindow(hwnd);
                let selection=TrackPopupMenu(menu,0x0100|0x0002,point.x,point.y,0,hwnd,ptr::null());
                DestroyMenu(menu);PostMessageW(hwnd,0,0,0);
                if selection==1 {reveal(&app);}else if selection==2 {app.exit(0);}
            },_=>{}
        }
        return 0;
    }
    DefWindowProcW(hwnd,msg,w,l)
}
pub fn refresh_language(app:&tauri::AppHandle) {
    if let Some(state)=app.try_state::<TrayState>() {
        if let Ok(hwnd)=state.0.lock() {
            if *hwnd!=0 { unsafe { PostMessageW(*hwnd,0x001a,0,0); } }
        }
    }
}
pub fn install_tray(app:&tauri::AppHandle)->Result<(),String>{
    // setup and all future reinitialization paths share this one native window.
    if app.try_state::<TrayState>().is_none() {app.manage(TrayState(Mutex::new(0)));}
    let state=app.state::<TrayState>();let mut existing=state.0.lock().map_err(|_|"托盘状态异常")?;
    if *existing!=0{return Ok(());}
    let journal=app.path().app_config_dir().map_err(|e|e.to_string())?.join("shell-tray-identity-v1.json");
    unsafe {
        let class_name=wide("FurinaKit.StableTray.v1");let instance=GetModuleHandleW(ptr::null());
        let class=WindowClass{style:0,proc:Some(tray_proc),class_extra:0,window_extra:0,instance,icon:0,cursor:0,background:0,menu:ptr::null(),name:class_name.as_ptr()};
        if RegisterClassW(&class)==0 && GetLastError()!=1410{return Err("注册托盘窗口失败".into());}
        // Hidden top-level tool window, not HWND_MESSAGE: must receive TaskbarCreated.
        let hwnd=CreateWindowExW(0x80|0x08000000,class_name.as_ptr(),class_name.as_ptr(),0,0,0,0,0,0,0,instance,ptr::null());
        if hwnd==0{return Err("创建托盘窗口失败".into());}
        let taskbar_created=RegisterWindowMessageW(wide("TaskbarCreated").as_ptr());
        if taskbar_created==0{DestroyWindow(hwnd);return Err("注册托盘恢复消息失败".into());}
        ChangeWindowMessageFilterEx(hwnd,taskbar_created,1,ptr::null_mut());
        let guid=tray_guid();
        if let Ok(text)=std::fs::read_to_string(&journal){
            if let Ok(previous)=serde_json::from_str::<Guid>(&text){
                if previous.a==GUID_NAMESPACE && previous!=guid {remove_icon(hwnd,previous);}
            }
        }
        let raw=Box::into_raw(Box::new(TrayData{app:app.clone(),taskbar_created,registered:Cell::new(false),guid,journal}));
        SetWindowLongPtrW(hwnd,WM_USERDATA,raw as isize);*existing=hwnd;
        put_icon(hwnd,&*raw,true);
    }
    Ok(())
}
pub fn cleanup(app:&tauri::AppHandle){
    if let Some(state)=app.try_state::<TrayState>(){
        if let Ok(mut window)=state.0.lock(){if *window!=0{unsafe{DestroyWindow(*window);}*window=0;}}
    }
}
