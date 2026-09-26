//! Remember only HWND/PID for explicit main-window or external activation while the clipboard panel is visible.
//! No window titles, input text, clipboard payloads, or persistent history are collected here.
#[cfg(windows)]
mod windows {
    use std::sync::{Mutex,atomic::{AtomicIsize,AtomicBool,Ordering}};
    use tauri::Manager;
    static TARGET:Mutex<Option<(isize,u32,isize)>>=Mutex::new(None);
    static MAIN:AtomicIsize=AtomicIsize::new(0);
    static PANEL:AtomicIsize=AtomicIsize::new(0);
    static STARTED:AtomicBool=AtomicBool::new(false);
    #[repr(C)] struct GuiInfo{cb:u32,flags:u32,active:isize,focus:isize,capture:isize,menu:isize,move_size:isize,caret:isize,rect:[i32;4]}
    #[repr(C)] struct Point{x:i32,y:i32}
    #[repr(C)] struct Message{hwnd:isize,message:u32,wparam:usize,lparam:isize,time:u32,point:Point,private:u32}
    type Callback=unsafe extern "system" fn(isize,u32,isize,i32,i32,u32,u32);
    #[link(name="user32")] extern "system" {
        fn SetWinEventHook(min:u32,max:u32,module:isize,callback:Option<Callback>,pid:u32,thread:u32,flags:u32)->isize;
        fn UnhookWinEvent(hook:isize)->i32;
        fn GetMessageW(message:*mut Message,hwnd:isize,min:u32,max:u32)->i32;
        fn TranslateMessage(message:*const Message)->i32;
        fn DispatchMessageW(message:*const Message)->isize;
        fn GetForegroundWindow()->isize;
        fn GetWindowThreadProcessId(hwnd:isize,pid:*mut u32)->u32;
        fn GetAncestor(hwnd:isize,flags:u32)->isize;
        fn GetClassNameW(hwnd:isize,name:*mut u16,count:i32)->i32;
        fn IsWindowVisible(hwnd:isize)->i32;
        fn IsWindow(hwnd:isize)->i32;
        fn GetGUIThreadInfo(thread:u32,info:*mut GuiInfo)->i32;
    }
    fn record(hwnd:isize){unsafe{
        let root=GetAncestor(hwnd,2);let mut pid=0;
        if root==0||IsWindow(root)==0||IsWindowVisible(root)==0{return;}
        let thread=GetWindowThreadProcessId(root,&mut pid);
        // The panel is never a target; the main window is the only allowed same-process target.
        if pid==0 || root==PANEL.load(Ordering::SeqCst){return;}
        if pid==std::process::id() && root!=MAIN.load(Ordering::SeqCst){if let Ok(mut target)=TARGET.lock(){*target=None;}return;}
        let mut name=[0u16;128];let n=GetClassNameW(root,name.as_mut_ptr(),128).max(0) as usize;
        let class=String::from_utf16_lossy(&name[..n]);
        if ["Progman","WorkerW","Shell_TrayWnd","Shell_SecondaryTrayWnd","#32768"].contains(&class.as_str()){
            if let Ok(mut target)=TARGET.lock(){*target=None;}return;
        }
        let mut info:GuiInfo=std::mem::zeroed();info.cb=std::mem::size_of::<GuiInfo>() as u32;let focus=if GetGUIThreadInfo(thread,&mut info)!=0{info.focus}else{0};
        if let Ok(mut target)=TARGET.lock(){*target=Some((root,pid,focus));}
    }}
    unsafe extern "system" fn foreground(_:isize,_:u32,hwnd:isize,_:i32,_:i32,_:u32,_:u32){
        let panel=PANEL.load(Ordering::SeqCst);
        if panel!=0&&IsWindowVisible(panel)!=0{record(hwnd);}
    }
    pub fn capture(){unsafe{record(GetForegroundWindow());}}
    pub fn register_main(app:&tauri::AppHandle){
        if let Some(w)=app.get_window("main"){if let Ok(hwnd)=w.hwnd(){MAIN.store(hwnd.0 as isize,Ordering::SeqCst);}}
    }
    pub fn panel(app:&tauri::AppHandle){
        if let Some(w)=app.get_webview_window("utility-clipboard") {if let Ok(hwnd)=w.hwnd(){PANEL.store(hwnd.0 as isize,Ordering::SeqCst);}}
        if STARTED.swap(true,Ordering::SeqCst){return;}
        std::thread::spawn(||unsafe{
            // EVENT_SYSTEM_FOREGROUND; delivered on this dedicated message-loop thread.
            let hook=SetWinEventHook(3,3,0,Some(foreground),0,0,0);
            if hook==0{STARTED.store(false,Ordering::SeqCst);eprintln!("Clipboard foreground tracking unavailable");return;}
            let focus_hook=SetWinEventHook(0x8005,0x8005,0,Some(foreground),0,0,0);
            let mut message:Message=std::mem::zeroed();
            while GetMessageW(&mut message,0,0,0)>0 {TranslateMessage(&message);DispatchMessageW(&message);}
            if focus_hook!=0{UnhookWinEvent(focus_hook);}
            UnhookWinEvent(hook);STARTED.store(false,Ordering::SeqCst);
        });
    }
    pub fn snapshot()->Option<(isize,u32,isize)>{TARGET.lock().ok().and_then(|t|*t)}
}
#[cfg(windows)] pub use windows::{capture,panel,snapshot,register_main};
#[cfg(not(windows))] pub fn capture(){}
#[cfg(not(windows))] pub fn panel(_: &tauri::AppHandle){}

#[cfg(not(windows))] pub fn register_main(_: &tauri::AppHandle){}
