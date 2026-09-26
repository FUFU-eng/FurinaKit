// 桌面悬浮球后端支持模块
//
// 职责：
//   1. 悬浮球贴边吸附计算与位置持久化（下次启动精准恢复）
//   2. 悬浮球展开/收起时的窗口尺寸与坐标自适应（防出界、内侧自适应展开）
//   3. 悬浮球与主窗口之间的互通唤起（激活前台、传递待办文件与分类）

use std::sync::Mutex;
use std::fs;
use std::path::PathBuf;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, Position, Size, WebviewWindow};

static ORIGIN_BALL_POS: Mutex<Option<(i32, i32)>> = Mutex::new(None);

/// 展开/收起窗格期间临时屏蔽「贴边吸附」的开关。
///
/// 为什么要它：展开窗格会移动并改变窗口尺寸，而监听窗口移动的那套逻辑是用来
/// 判断「用户拖动结束」的。不屏蔽就会把程序自己造成的移动当成用户拖动，
/// 于是自动吸附到屏幕边缘 —— 表现为「关掉窗格后悬浮球跑到别的位置」（实测踩过）。
static SUPPRESS_SNAP: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

/// 悬浮球当前是否处于「展开成窗格」状态。
///
/// ★ 为什么要它：点击穿透只适用于**收起成球**的时候。展开之后光标当然不在球上，
///   若还按「不在球上就穿透」处理，整个窗格都会忽略鼠标事件 —— 点哪都没反应、
///   点屏幕其他地方也收不起来（实测踩过，非常致命）。
static BALL_EXPANDED: std::sync::atomic::AtomicBool =
    std::sync::atomic::AtomicBool::new(false);

pub fn update_origin_pos(x: i32, y: i32) {
    if let Ok(mut g) = ORIGIN_BALL_POS.lock() {
        *g = Some((x, y));
    }
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct FloatBallPosition {
    pub x: i32,
    pub y: i32,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct OpenTargetPayload {
    pub category: Option<String>,
    #[serde(alias = "tool_id")]
    pub tool_id: Option<String>,
    #[serde(alias = "pending_files")]
    pub pending_files: Option<Vec<String>>,
    #[serde(alias = "pending_files_data")]
    pub pending_files_data: Option<serde_json::Value>,
}

fn config_path(app: &AppHandle) -> PathBuf {
    let base = app
        .path()
        .app_config_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let _ = fs::create_dir_all(&base);
    base.join("floatball_pos.json")
}

/// 保存悬浮球坐标
#[tauri::command]
pub fn save_float_ball_pos(app: AppHandle, x: i32, y: i32) -> Result<(), String> {
    update_origin_pos(x, y);
    let p = config_path(&app);
    let data = FloatBallPosition { x, y };
    if let Ok(json) = serde_json::to_string(&data) {
        let _ = fs::write(p, json);
    }
    Ok(())
}

/// 读取悬浮球坐标
#[tauri::command]
pub fn load_float_ball_pos(app: AppHandle) -> Result<Option<FloatBallPosition>, String> {
    let p = config_path(&app);
    if p.is_file() {
        if let Ok(text) = fs::read_to_string(p) {
            if let Ok(pos) = serde_json::from_str::<FloatBallPosition>(&text) {
                update_origin_pos(pos.x, pos.y);
                return Ok(Some(pos));
            }
        }
    }
    Ok(None)
}

static CLOAK_GEN: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
/// 窗口当前是否处于隐身（cloak）状态
static CLOAKED: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// DWMWA_CLOAK：让窗口暂时不参与桌面合成（看不见），但窗口本身仍然可见、不改焦点。
#[cfg(target_os = "windows")]
fn cloak_float_ball(hwnd: isize, on: bool) {
    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmSetWindowAttribute(hwnd: isize, attr: u32, value: *const core::ffi::c_void, size: u32) -> i32;
    }
    let v: i32 = if on { 1 } else { 0 };
    CLOAKED.store(on, std::sync::atomic::Ordering::SeqCst);
    unsafe { DwmSetWindowAttribute(hwnd, 13, &v as *const i32 as *const core::ffi::c_void, 4); }
}

/// 「定格替身」：窗口改尺寸的那一瞬间，WebView 的新画面总比窗口慢几十毫秒才上屏，
/// 所以球会先消失 / 闪到别处再回来。这里在改尺寸前把屏幕上球所在的那一小块原样截下来，
/// 用一个置顶、鼠标穿透、不抢焦点的小窗盖在原处；等新画面画好再撤掉。用户看到的球始终不动。
#[cfg(target_os = "windows")]
mod ghost {
    use std::sync::atomic::{AtomicIsize, AtomicU64, Ordering};
    static GHOST: AtomicIsize = AtomicIsize::new(0);
    static GEN: AtomicU64 = AtomicU64::new(0);
    #[repr(C)]
    struct WndClassExW {
        cb_size: u32,
        style: u32,
        wnd_proc: unsafe extern "system" fn(isize, u32, usize, isize) -> isize,
        cls_extra: i32,
        wnd_extra: i32,
        instance: isize,
        icon: isize,
        cursor: isize,
        background: isize,
        menu_name: *const u16,
        class_name: *const u16,
        icon_sm: isize,
    }
    #[repr(C)]
    struct Pt { x: i32, y: i32 }
    #[repr(C)]
    struct Sz { cx: i32, cy: i32 }
    #[repr(C)]
    struct Blend { op: u8, flags: u8, alpha: u8, format: u8 }
    #[link(name = "user32")]
    extern "system" {
        fn RegisterClassExW(c: *const WndClassExW) -> u16;
        fn CreateWindowExW(ex: u32, cls: *const u16, name: *const u16, style: u32, x: i32, y: i32, w: i32, h: i32,
            parent: isize, menu: isize, inst: isize, param: *mut core::ffi::c_void) -> isize;
        fn DefWindowProcW(h: isize, m: u32, w: usize, l: isize) -> isize;
        fn GetDC(h: isize) -> isize;
        fn ReleaseDC(h: isize, dc: isize) -> i32;
        fn UpdateLayeredWindow(h: isize, dst: isize, pt: *const Pt, sz: *const Sz, src: isize, src_pt: *const Pt,
            key: u32, blend: *const Blend, flags: u32) -> i32;
        fn SetWindowPos(h: isize, after: isize, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
        fn ShowWindowAsync(h: isize, cmd: i32) -> i32;
    }
    #[link(name = "gdi32")]
    extern "system" {
        fn CreateCompatibleDC(dc: isize) -> isize;
        fn CreateCompatibleBitmap(dc: isize, w: i32, h: i32) -> isize;
        fn SelectObject(dc: isize, o: isize) -> isize;
        fn BitBlt(d: isize, x: i32, y: i32, w: i32, h: i32, s: isize, sx: i32, sy: i32, rop: u32) -> i32;
        fn DeleteDC(dc: isize) -> i32;
        fn DeleteObject(o: isize) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GetModuleHandleW(name: *const u16) -> isize;
    }
    #[link(name = "dwmapi")]
    extern "system" {
        fn DwmFlush() -> i32;
    }
    unsafe extern "system" fn wnd_proc(h: isize, m: u32, w: usize, l: isize) -> isize {
        DefWindowProcW(h, m, w, l)
    }
    fn wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }
    /// 替身窗口只建一次（在调用它的主线程上，主线程有消息循环）。
    fn ensure() -> isize {
        let cur = GHOST.load(Ordering::SeqCst);
        if cur != 0 {
            return cur;
        }
        unsafe {
            let inst = GetModuleHandleW(std::ptr::null());
            let cls = wide("FurinaKitBallGhost");
            let wc = WndClassExW {
                cb_size: std::mem::size_of::<WndClassExW>() as u32,
                style: 0,
                wnd_proc,
                cls_extra: 0,
                wnd_extra: 0,
                instance: inst,
                icon: 0,
                cursor: 0,
                background: 0,
                menu_name: std::ptr::null(),
                class_name: cls.as_ptr(),
                icon_sm: 0,
            };
            RegisterClassExW(&wc);
            let title = wide("");
            // WS_EX_LAYERED | WS_EX_TRANSPARENT | WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE ; WS_POPUP
            let h = CreateWindowExW(0x0008_0000 | 0x20 | 0x80 | 0x08 | 0x0800_0000, cls.as_ptr(), title.as_ptr(),
                0x8000_0000, 0, 0, 1, 1, 0, 0, inst, std::ptr::null_mut());
            GHOST.store(h, Ordering::SeqCst);
            h
        }
    }
    /// 把屏幕 (x,y,w,h)（物理像素）这一块原样定格并盖在最上层；最多盖 900ms，之后自动撤掉。
    pub fn show(x: i32, y: i32, w: i32, h: i32) {
        if w <= 0 || h <= 0 {
            return;
        }
        let g = ensure();
        if g == 0 {
            return;
        }
        unsafe {
            let scr = GetDC(0);
            let mem = CreateCompatibleDC(scr);
            let bmp = CreateCompatibleBitmap(scr, w, h);
            let old = SelectObject(mem, bmp);
            // SRCCOPY | CAPTUREBLT：取合成后的桌面画面（含悬浮球这类透明置顶窗口）
            BitBlt(mem, 0, 0, w, h, scr, x, y, 0x00CC_0020 | 0x4000_0000);
            let pt = Pt { x, y };
            let sz = Sz { cx: w, cy: h };
            let src = Pt { x: 0, y: 0 };
            let bf = Blend { op: 0, flags: 0, alpha: 255, format: 0 };
            UpdateLayeredWindow(g, scr, &pt, &sz, mem, &src, 0, &bf, 2);
            SelectObject(mem, old);
            DeleteObject(bmp);
            DeleteDC(mem);
            ReleaseDC(0, scr);
            // HWND_TOPMOST，SWP_NOACTIVATE | SWP_SHOWWINDOW：放到置顶层最上面（盖住悬浮球）
            SetWindowPos(g, -1, x, y, w, h, 0x0010 | 0x0040);
            // 等替身真正上屏，再去动悬浮球窗口
            DwmFlush();
        }
        let gen = GEN.fetch_add(1, Ordering::SeqCst) + 1;
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(900));
            if GEN.load(Ordering::SeqCst) == gen {
                unsafe { ShowWindowAsync(g, 0); }
            }
        });
    }
    /// 悬浮球新画面已上屏：等一次合成再撤替身（先显示真球、再撤替身，中间不会空一帧）。
    pub fn hide() {
        let g = GHOST.load(Ordering::SeqCst);
        if g == 0 {
            return;
        }
        GEN.fetch_add(1, Ordering::SeqCst);
        unsafe {
            DwmFlush();
            ShowWindowAsync(g, 0);
        }
    }
}

/// 展开后前端确认新尺寸已画好，再把悬浮球窗口显示出来（解除 DWM 隐身）。
#[tauri::command]
pub fn reveal_float_ball(app: AppHandle) -> Result<(), String> {
    CLOAK_GEN.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
    #[cfg(target_os = "windows")]
    {
        if let Some(win) = app.get_webview_window("float-ball") {
            // WebView 在隐身期间不出新画面：第一次调用只取消隐身（替身继续盖着），
            // 前端等真窗口画好后再调一次，这时才撤替身。替身最多 900ms 也会自己撤。
            if CLOAKED.load(std::sync::atomic::Ordering::SeqCst) {
                if let Ok(hwnd) = win.hwnd() { cloak_float_ball(hwnd.0 as isize, false); }
                return Ok(());
            }
        }
        ghost::hide();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = &app;
    }
    Ok(())
}

/// 展开 / 收起悬浮球窗口
/// 当收起时：窗口大小恢复为球体尺寸（50x50）并精准回到原位，100% 杜绝坐标漂移；
/// 当展开时：检测当前屏幕边界，根据悬浮球原位向内侧方向扩大窗口，防出界并实现就地螺旋展开。
/// plan_only=true：只算出展开方向/锚点并返回，不动窗口。前端先按这个方向摆好球（小窗里左 10 与右 10 是同一位置），
/// 画好一帧后再真正展开 —— 否则窗口先变大、球还按旧布局画在大窗左上角，会闪到左上角一下。
#[tauri::command]
pub fn set_float_ball_expanded(
    app: AppHandle,
    expanded: bool,
    ball_screen_x: i32,
    ball_screen_y: i32,
    palette_width: u32,
    palette_height: u32,
    plan_only: Option<bool>,
) -> Result<serde_json::Value, String> {
    let win: WebviewWindow = app
        .get_webview_window("float-ball")
        .ok_or_else(|| "未找到悬浮球窗口".to_string())?;

    use std::sync::atomic::Ordering;
    let monitor = win.current_monitor().map_err(|e| e.to_string())?;
    let scale = win.scale_factor().map_err(|e| e.to_string())?;
    let compact = (64.0 * scale).round() as u32;
    let current = win.outer_position().map_err(|e| e.to_string())?;
    let size = win.outer_size().map_err(|e| e.to_string())?;
    let is_compact = size.width <= compact + 1;
    if is_compact { update_origin_pos(current.x, current.y); }
    let origin = ORIGIN_BALL_POS.lock().map_err(|e| e.to_string())?.unwrap_or((current.x,current.y));
    // Collapse to the real 64px drop target, not a large click-through backing HWND.
    SUPPRESS_SNAP.store(true, Ordering::SeqCst);
    let (mut wx,mut wy) = (current.x,current.y);
    let mut left=false; let mut up=false;
    if !expanded {
        wx = origin.0;
        wy = origin.1;
        #[cfg(target_os = "windows")]
        {
            if let Ok(hwnd) = win.hwnd() {
                #[link(name = "user32")]
                extern "system" {
                    fn SetWindowPos(hwnd: isize, insert_after: isize, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
                }
                // 收起：此刻面板已缩回成球、球就画在原位。先把这一块定格盖住，再缩窗；
                // 前端画好小窗后调用 reveal_float_ball 撤掉替身（最多 900ms 自动撤）。
                if !is_compact { ghost::show(wx, wy, compact as i32, compact as i32); }
                unsafe {
                    // SWP_NOZORDER (0x0004) | SWP_NOACTIVATE (0x0010)
                    SetWindowPos(hwnd.0 as isize, 0, wx, wy, compact as i32, compact as i32, 0x0004 | 0x0010);
                }
                // 收起时一定解除隐身（防止展开后极快收起、隐身还没解除）
                CLOAK_GEN.fetch_add(1, Ordering::SeqCst);
                cloak_float_ball(hwnd.0 as isize, false);
            } else {
                let _ = win.set_size(Size::Physical(PhysicalSize{width:compact,height:compact}));
                let _ = win.set_position(Position::Physical(PhysicalPosition{x:wx,y:wy}));
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = win.set_size(Size::Physical(PhysicalSize{width:compact,height:compact}));
            let _ = win.set_position(Position::Physical(PhysicalPosition{x:wx,y:wy}));
        }
        BALL_EXPANDED.store(false, Ordering::SeqCst);
        win.set_ignore_cursor_events(false).map_err(|e|e.to_string())?;
    } else {
        let (sx,sy,sw,sh) = monitor.as_ref().map(|m| {
            let r=m.work_area(); (r.position.x,r.position.y,r.size.width as i32,r.size.height as i32)
        }).unwrap_or((0,0,1920,1080));
        let pw=((palette_width.clamp(64,640) as f64)*scale).round() as i32;
        let ph=((palette_height.clamp(64,640) as f64)*scale).round() as i32;
        left=origin.0-sx+compact as i32/2>sw/2;
        up=origin.1-sy+compact as i32/2>sh/2;
        wx=if left {origin.0+compact as i32-pw} else {origin.0};
        wy=if up {origin.1+compact as i32-ph} else {origin.1};
        wx=wx.clamp(sx,(sx+sw-pw).max(sx));wy=wy.clamp(sy,(sy+sh-ph).max(sy));
        if plan_only == Some(true) {
            SUPPRESS_SNAP.store(false, Ordering::SeqCst);
            return Ok(serde_json::json!({"directionX":if left {"left"}else{"right"},"directionY":if up {"up"}else{"down"},
                "anchorX":(origin.0-wx) as f64/scale+32.0,"anchorY":(origin.1-wy) as f64/scale+32.0,
                "winX":wx,"winY":wy,"scale":scale,"planned":true}));
        }
        #[cfg(target_os = "windows")]
        {
            if let Ok(hwnd) = win.hwnd() {
                #[link(name = "user32")]
                extern "system" {
                    fn SetWindowPos(hwnd: isize, insert_after: isize, x: i32, y: i32, cx: i32, cy: i32, flags: u32) -> i32;
                }
                // 先让 DWM 把窗口"隐身"（不改可见性、不抢焦点），再放大；前端在新尺寸画好后调用
                // reveal_float_ball 解除。这样放大那一帧不会把小窗旧画面贴在大窗左上角。
                // 先把球所在的一块定格盖住（隐身期间用户看到的就是它），再隐身、放大
                if is_compact { ghost::show(origin.0, origin.1, compact as i32, compact as i32); }
                cloak_float_ball(hwnd.0 as isize, true);
                let gen = CLOAK_GEN.fetch_add(1, Ordering::SeqCst) + 1;
                let raw = hwnd.0 as isize;
                std::thread::spawn(move || {
                    // 保险：前端万一没来得及解除，700ms 后自动显示，绝不会让球"消失"
                    std::thread::sleep(std::time::Duration::from_millis(700));
                    if CLOAK_GEN.load(Ordering::SeqCst) == gen { cloak_float_ball(raw, false); }
                });
                unsafe {
                    SetWindowPos(hwnd.0 as isize, 0, wx, wy, pw, ph, 0x0004 | 0x0010);
                }
            } else {
                let _ = win.set_size(Size::Physical(PhysicalSize{width:pw as u32,height:ph as u32}));
                let _ = win.set_position(Position::Physical(PhysicalPosition{x:wx,y:wy}));
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = win.set_size(Size::Physical(PhysicalSize{width:pw as u32,height:ph as u32}));
            let _ = win.set_position(Position::Physical(PhysicalPosition{x:wx,y:wy}));
        }
        BALL_EXPANDED.store(true, Ordering::SeqCst);
        win.set_ignore_cursor_events(false).map_err(|e|e.to_string())?;
        win.set_focus().map_err(|e|e.to_string())?;
    }
    SUPPRESS_SNAP.store(false, Ordering::SeqCst);
    Ok(serde_json::json!({"directionX":if left {"left"}else{"right"},"directionY":if up {"up"}else{"down"},
        "anchorX":(origin.0-wx) as f64/scale+32.0,"anchorY":(origin.1-wy) as f64/scale+32.0,
        "winX":wx,"winY":wy,"scale":scale}))
}


/// 监听悬浮球窗口的移动：停手 200ms 后做贴边吸附 + 保存坐标。
///
/// 为什么需要它：拖动现在交给**系统原生拖动**（start_dragging）后，前端收不到 mouseup，
/// 所以"拖动结束"这件事只能从窗口的移动事件推断 —— 一段时间没再移动，就认为松手了。
///
/// 实现上用「最后一次移动时刻 + 一个是否已有等待线程」的标记：
/// 拖动中会收到大量移动事件，只让第一个事件起一个等待线程，其余只更新时间戳，
/// 等时间戳静默超过 200ms，那个线程再去做吸附与保存。
pub fn watch_float_ball_moves(app: AppHandle) {
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;

    let Some(win) = app.get_webview_window("float-ball") else {
        return;
    };
    let app2 = app.clone();
    let last_move = Arc::new(parking_lot::Mutex::new(std::time::Instant::now()));
    let waiting = Arc::new(AtomicBool::new(false));
    let last_move2 = last_move.clone();
    let waiting2 = waiting.clone();

    let drop_app=app.clone();
    win.on_webview_event(move |event| {
        if let tauri::WebviewEvent::DragDrop(drop) = event {
            let payload = match drop {
                tauri::DragDropEvent::Enter { paths, .. } => serde_json::json!({"type":"enter","paths":paths}),
                tauri::DragDropEvent::Over { .. } => serde_json::json!({"type":"over"}),
                tauri::DragDropEvent::Drop { paths, .. } => serde_json::json!({"type":"drop","paths":paths}),
                _ => serde_json::json!({"type":"leave"}),
            };
            if let Some(w)=drop_app.get_webview_window("float-ball") {
                let _=w.eval(format!("(()=>{{const d={payload};if(window.__FURINAKIT_BALL_DROP_READY__)window.dispatchEvent(new CustomEvent('furinakit:native-drop',{{detail:d}}));else if(d.type==='drop')window.__FURINAKIT_BALL_DROP__=d;}})();"));
            }
            return;
        }
    });
    win.on_window_event(move |event| {
        // ★ 点屏幕任何地方都能关窗格：点到窗格外时悬浮球窗口会失去焦点，
        //   展开状态下收到失焦就通知前端收起（前端窗口内部的遮罩只能管到窗口范围内，
        //   窗口之外的桌面点击它收不到，所以必须靠失焦）。
        if let tauri::WindowEvent::Focused(false) = event {
            if BALL_EXPANDED.load(std::sync::atomic::Ordering::SeqCst) {
                if let Some(w)=app2.get_webview_window("float-ball") {
                    let _=w.eval("window.dispatchEvent(new Event('furinakit:ball-blur'));");
                }
            }
            return;
        }

        if !matches!(event, tauri::WindowEvent::Moved(_)) {
            return;
        }
        // 展开/收起窗格造成的移动不算「用户拖动」
        if SUPPRESS_SNAP.load(std::sync::atomic::Ordering::SeqCst) {
            return;
        }
        if BALL_EXPANDED.load(Ordering::SeqCst) { return; }
        if let Some(w)=app2.get_webview_window("float-ball") {
            let scale=w.scale_factor().unwrap_or(1.0);
            if w.outer_size().map(|s|s.width as f64 > 65.0*scale).unwrap_or(true) {return;}
        }
        *last_move2.lock() = std::time::Instant::now();

        // 已经有一个线程在等就只更新时间戳
        if waiting2.swap(true, Ordering::SeqCst) {
            return;
        }
        let app3 = app2.clone();
        let last_move3 = last_move.clone();
        let waiting3 = waiting2.clone();
        std::thread::spawn(move || {
            loop {
                std::thread::sleep(std::time::Duration::from_millis(80));
                let idle_ms = last_move3.lock().elapsed().as_millis();
                if idle_ms >= 200 {
                    break;
                }
            }
            if let Some(w) = app3.get_webview_window("float-ball") {
                if let Ok(pos) = w.outer_position() {
                    if !BALL_EXPANDED.load(Ordering::SeqCst) && w.outer_size().map(|s|s.width as f64 <= 65.0*w.scale_factor().unwrap_or(1.0)).unwrap_or(false) {
                        let _ = snap_float_ball_to_edge(app3.clone(), pos.x, pos.y, 0);
                    }
                }
            }
            waiting3.store(false, Ordering::SeqCst);
        });
    });
}

/// Move the actual HWND, independently of Windows' "show window contents while dragging" setting.
/// The cursor is sampled natively; no WebView pointer-move IPC queue and no OS outline loop.
#[tauri::command]
pub async fn start_float_ball_dragging(app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
            #[repr(C)]
            struct Point { x: i32, y: i32 }
            #[link(name = "user32")]
            extern "system" {
                fn GetAsyncKeyState(key: i32) -> i16;
                fn GetCursorPos(point: *mut Point) -> i32;
                fn SetThreadDpiAwarenessContext(context: isize) -> isize;
            }
            let win=app.get_webview_window("float-ball").ok_or("未找到悬浮球窗口")?;
            let pos=win.outer_position().map_err(|e|e.to_string())?;
            let previous=unsafe { SetThreadDpiAwarenessContext(-4) };
            let mut start=Point{x:0,y:0};
            if unsafe { GetCursorPos(&mut start) } == 0 {
                unsafe { SetThreadDpiAwarenessContext(previous); }
                return Err("无法读取鼠标位置".into());
            }
            SUPPRESS_SNAP.store(true,std::sync::atomic::Ordering::SeqCst);
            let _=win.set_ignore_cursor_events(false);
            let began=std::time::Instant::now();
            let mut last=(pos.x,pos.y);
            let result=(|| -> Result<(),String> {
                while unsafe { GetAsyncKeyState(1) } < 0 && began.elapsed().as_secs()<60 {
                    let mut cursor=Point{x:0,y:0};
                    if unsafe { GetCursorPos(&mut cursor) } == 0 { break; }
                    let next=(pos.x+cursor.x-start.x,pos.y+cursor.y-start.y);
                    if next!=last {
                        win.set_position(Position::Physical(PhysicalPosition{x:next.0,y:next.1})).map_err(|e|e.to_string())?;
                        update_origin_pos(next.0,next.1);
                        last=next;
                    }
                    std::thread::sleep(std::time::Duration::from_millis(8));
                }
                Ok(())
            })();
            unsafe { SetThreadDpiAwarenessContext(previous); }
            SUPPRESS_SNAP.store(false,std::sync::atomic::Ordering::SeqCst);
            result?;
            snap_float_ball_to_edge(app,last.0,last.1,0)?;
            Ok(())
        }).await.map_err(|e|e.to_string())?
    }
    #[cfg(not(target_os = "windows"))]
    {
        let win=app.get_webview_window("float-ball").ok_or("未找到悬浮球窗口")?;
        win.start_dragging().map_err(|e|e.to_string())
    }
}

/// 移动悬浮球窗口位置
#[tauri::command]
pub fn move_float_ball(app: AppHandle, x: i32, y: i32) -> Result<(), String> {
    update_origin_pos(x, y);
    if let Some(win) = app.get_webview_window("float-ball") {
        let _ = win.set_position(Position::Physical(PhysicalPosition { x, y }));
    }
    Ok(())
}

/// 贴边吸附计算
#[tauri::command]
pub fn snap_float_ball_to_edge(
    app: AppHandle,
    current_x: i32,
    current_y: i32,
    snap_threshold: i32,
) -> Result<FloatBallPosition, String> {
    let win = app
        .get_webview_window("float-ball")
        .ok_or_else(|| "未找到悬浮球窗口".to_string())?;

    let monitor = win.current_monitor().map_err(|e| e.to_string())?;
    let scale = monitor.as_ref().map(|m| m.scale_factor()).unwrap_or(1.0);
    // 与收起尺寸保持一致（球 46px + 涟漪余量 10px = 56px），否则吸附后位置会差一点
    let ball_physical_size = (64.0 * scale).round() as i32;
    let threshold = if snap_threshold > 0 { ((snap_threshold as f64) * scale).round() as i32 } else { 0 };

    let mut target_x = current_x;
    let mut target_y = current_y;

    if let Some(ref m) = monitor {
        let r=m.work_area();
        let sx = r.position.x;
        let sy = r.position.y;
        let sw = r.size.width as i32;
        let sh = r.size.height as i32;

        // 贴左边缘
        if (target_x - sx).abs() < threshold {
            target_x = sx;
        }
        // 贴右边缘
        else if (sx + sw - (target_x + ball_physical_size)).abs() < threshold {
            target_x = sx + sw - ball_physical_size;
        }

        // 垂直防出界
        target_y = target_y.clamp(sy, (sy + sh - ball_physical_size).max(sy));
        target_x = target_x.clamp(sx, (sx + sw - ball_physical_size).max(sx));
    }

    update_origin_pos(target_x, target_y);
    let _ = win.set_position(Position::Physical(PhysicalPosition {
        x: target_x,
        y: target_y,
    }));

    let _ = save_float_ball_pos(app, target_x, target_y);

    Ok(FloatBallPosition {
        x: target_x,
        y: target_y,
    })
}


/// 把待办文件推给主窗口（写 localStorage + 派发 furinakit:pending-files）。
///
/// ★ 为什么这件事必须由 Rust 来做：待办状态存在 localStorage、靠 storage 事件同步，
///   但悬浮球窗口和主窗口是**两个独立 WebView**，storage 事件跨不过去。
///   由这边直接 eval 进主窗口最可靠（原代码已有同样手法，只是拖文件时没调用 —— 实测踩过）。
/// File delivery is a single, ordered transaction. No duplicate Tauri event + eval + storage paths.
#[tauri::command]
pub fn push_pending_files_to_main(app: AppHandle, files_data: serde_json::Value) -> Result<(), String> {
    // A child browser makes get_webview_window("main") return None; the main webview still exists.
    let main=app.get_webview("main").ok_or("未找到主窗口页面")?;
    let detail=serde_json::json!({"files":files_data});
    main.eval(format!("if(window.__FURINAKIT_PENDING_ACTIVE__)window.dispatchEvent(new CustomEvent('furinakit:pending-files',{{detail:{detail}}}));")).map_err(|e|e.to_string())
}
#[tauri::command]
pub fn open_main_window_with_target(app: AppHandle, payload: OpenTargetPayload) -> Result<(), String> {
    // A child browser makes get_webview_window("main") return None; the main webview still exists.
    let main=app.get_webview("main").ok_or("未找到主窗口页面")?;
    let json=serde_json::to_string(&payload).map_err(|e|e.to_string())?;
    main.eval(format!("(()=>{{const p={json};if(window.__FURINAKIT_PENDING_READY__)window.dispatchEvent(new CustomEvent('furinakit:open-target',{{detail:p}}));else window.__FURINAKIT_OPEN_TARGET__=p;}})();")).map_err(|e|e.to_string())?;
    crate::main_window::reveal(&app)
}
#[tauri::command]
pub fn sync_float_ball_preferences(app:AppHandle, prefs:serde_json::Value)->Result<(),String>{
    let win=app.get_webview_window("float-ball").ok_or("未找到悬浮球窗口")?;
    win.eval(format!("(()=>{{const p={prefs};for(const [k,v] of Object.entries(p))localStorage.setItem(k,String(v));window.dispatchEvent(new CustomEvent('furinakit:ball-prefs',{{detail:p}}));}})();")).map_err(|e|e.to_string())
}

/// 取悬浮球窗口当前的**物理**位置。
///
/// ★ 拖动必须用它：网页里的 screenX/screenY 是逻辑像素（受系统缩放影响），
///   而窗口位置是物理像素。作者机器缩放 1.5×，直接用逻辑位移去挪窗口，
///   球就会比鼠标慢三分之一、越拖越远（实测踩过）。
#[tauri::command]
pub fn get_float_ball_position(app: AppHandle) -> Result<serde_json::Value, String> {
    let Some(win) = app.get_webview_window("float-ball") else {
        return Ok(serde_json::json!({ "x": 0, "y": 0 }));
    };
    let p = win.outer_position().map_err(|e| e.to_string())?;
    let scale = win
        .current_monitor()
        .ok()
        .flatten()
        .map(|m| m.scale_factor())
        .unwrap_or(1.0);
    Ok(serde_json::json!({ "x": p.x, "y": p.y, "scale": scale }))
}

/// 按逻辑像素设置悬浮球窗口大小，**保持左上角不动**。
///
/// 用途：拖文件悬停到球上时把窗口临时撑大，好让球放大并显示提示
/// （收起时窗口只有 56×56，球想放大就会被裁掉）。
#[tauri::command]
pub fn set_float_ball_size(app: AppHandle, size: u32) -> Result<(), String> {
    let Some(win) = app.get_webview_window("float-ball") else {
        return Ok(());
    };
    let scale = win
        .current_monitor()
        .ok()
        .flatten()
        .map(|m| m.scale_factor())
        .unwrap_or(1.0);
    let px = ((size as f64) * scale).round() as u32;
    // 先记住当前位置，改尺寸后再放回去，避免 Windows 把窗口往右下"撑"
    let pos = win.outer_position().ok();
    let _ = win.set_size(Size::Physical(PhysicalSize { width: px, height: px }));
    if let Some(p) = pos {
        let _ = win.set_position(Position::Physical(PhysicalPosition { x: p.x, y: p.y }));
    }
    Ok(())
}


/// 让悬浮球"只是个球"：光标不在球上时，窗口忽略鼠标事件（点击穿透到下层），
/// 只有光标落进球体范围时才接管鼠标。
///
/// 这是 uTools 用的同一套办法（它在 Electron 里调 setIgnoreMouseEvents）。
/// Tauri 自带 set_ignore_cursor_events 与 cursor_position，所以不用引入任何新依赖。
///
/// 为什么要轮询：窗口一旦"忽略鼠标事件"就收不到 mousemove 了，只能由这边主动看光标位置。
/// 40ms 一次，开销可以忽略；展开成窗格期间不做（那时候整块窗口都要能点）。
pub fn watch_ball_hit_area(app: AppHandle) {
    use std::sync::atomic::Ordering;

    std::thread::spawn(move || {
        let mut ignoring = false;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(40));
            let Some(win) = app.get_webview_window("float-ball") else {
                continue;
            };
            // ★ 展开成窗格时，窗口必须完整可点（否则窗格点不动、点外面也收不起来）；
            //   展开/收起的动画期间同样保持可点。
            if BALL_EXPANDED.load(Ordering::SeqCst) || SUPPRESS_SNAP.load(Ordering::SeqCst) {
                let _ = win.set_ignore_cursor_events(false);
                ignoring = false;
                continue;
            }
            let (Ok(cursor), Ok(pos), Ok(size)) =
                (win.cursor_position(), win.outer_position(), win.outer_size())
            else {
                continue;
            };
            // Never toggle WS_EX_TRANSPARENT on the compact drop target. Explorer/OLE
            // chooses its target before the 40ms cursor poll and otherwise drops through it.
            let dpi=win.scale_factor().unwrap_or(1.0);
            if size.width as f64 <= 65.0*dpi {
                let _=win.set_ignore_cursor_events(false);
                ignoring=false;
                continue;
            }
            let scale = win
                .current_monitor()
                .ok()
                .flatten()
                .map(|m| m.scale_factor())
                .unwrap_or(1.0);

            // 球体在窗口里的位置：前端给球留了 10px 边距（逻辑像素），换算成物理像素
            let pad = (10.0 * scale).round() as i32;
            let ball = (44.0 * scale).round() as i32;
            let origin=if size.width as f64 <= 65.0*scale {(pos.x,pos.y)} else {ORIGIN_BALL_POS.lock().ok().and_then(|g|*g).unwrap_or((pos.x,pos.y))};
            let left = origin.0 + pad;
            let top = origin.1 + pad;
            let right = left + ball;
            let bottom = top + ball;

            // 用圆形判定而不是矩形：球是圆的，四个角不该吃掉点击
            let cx = (left + right) as f64 / 2.0;
            let cy = (top + bottom) as f64 / 2.0;
            let r = ball as f64 / 2.0 + 2.0; // 稍微放宽 2px，点击更友好
            let inside = {
                let dx = cursor.x - cx;
                let dy = cursor.y - cy;
                dx * dx + dy * dy <= r * r
            } && size.width > 0;

            if inside == ignoring {
                // 状态需要翻转：在球上 → 接管；不在球上 → 穿透
                let _ = win.set_ignore_cursor_events(!inside);
                ignoring = !inside;
            }
        }
    });
}

/// 悬浮球右键菜单的动作。
///
/// 全部复用现成通路：
///   · 打开主界面 → 显示并聚焦主窗口（托盘那个 show 是同一件事）
///   · 打开设置   → 主窗口监听的是 furina:open-settings 事件（app-shell 里注册的），
///                  所以这里往主窗口派发这个事件即可，不用另造一套开关
///   · 隐藏悬浮球 → 除了隐藏窗口，还要把偏好写进主窗口的 localStorage，
///                  否则下次启动又冒出来（设置页读的就是 furinakit_floatball_enabled）
///   · 退出       → app.exit(0)（和托盘退出一致，退出时会回收子进程）
#[tauri::command]
pub fn float_ball_menu_action(app: AppHandle, action: String) -> Result<(), String> {
    match action.as_str() {
        "open" | "settings" => {
            if let Some(main) = app.get_webview("main") {
                crate::main_window::reveal(&app)?;
                if action == "settings" {
                    // 等主窗口把事件监听挂上再派发（主窗口可能刚被唤醒或正在加载）
                    std::thread::sleep(std::time::Duration::from_millis(120));
                    let _ = main.eval(
                        "window.dispatchEvent(new CustomEvent('furina:open-settings',{detail:{section:'floatball'}}));",
                    );
                }
            }
        }
        "hide" => {
            save_float_ball_enabled_state(&app, false);
            if let Some(main) = app.get_webview("main") {
                let _ = main.eval(
                    "(function(){ try { localStorage.setItem('furinakit_floatball_enabled','false'); } catch(e){} })();",
                );
            }
            if let Some(win) = app.get_webview_window("float-ball") {
                let _ = win.hide();
            }
        }
        "quit" => {
            app.exit(0);
        }
        other => return Err(format!("未知的菜单动作：{other}")),
    }
    Ok(())
}

/// 显隐悬浮球窗口
fn floatball_enabled_path(app: &AppHandle) -> PathBuf {
    let base = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let _ = fs::create_dir_all(&base);
    base.join("floatball_enabled.json")
}

pub fn is_float_ball_enabled(app: &AppHandle) -> bool {
    let p = floatball_enabled_path(app);
    if p.is_file() {
        if let Ok(text) = fs::read_to_string(p) {
            if let Ok(enabled) = serde_json::from_str::<bool>(&text) {
                return enabled;
            }
        }
    }
    true
}

pub fn save_float_ball_enabled_state(app: &AppHandle, enabled: bool) {
    let p = floatball_enabled_path(app);
    let _ = fs::write(p, if enabled { "true" } else { "false" });
}

#[tauri::command]
pub fn set_float_ball_visible(app: AppHandle, visible: bool) -> Result<(), String> {
    save_float_ball_enabled_state(&app, visible);
    if let Some(win) = app.get_webview_window("float-ball") {
        if visible {
            let _ = win.show();
        } else {
            let _ = win.hide();
        }
    }
    Ok(())
}

/// Bounded binary reads avoid the old 300 MB / base64 handoff ceiling.
#[tauri::command]
pub fn pending_file_info(path: String) -> Result<serde_json::Value,String> {
    let meta=fs::metadata(&path).map_err(|e|format!("无法读取文件：{e}"))?;
    if !meta.is_file(){return Err("不支持文件夹，请选择文件".into());}
    let modified=meta.modified().ok().and_then(|t|t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d|d.as_millis());
    Ok(serde_json::json!({"size":meta.len(),"modified":modified}))
}
#[tauri::command]
pub async fn read_pending_file_chunk(path:String, offset:u64, length:usize)->Result<tauri::ipc::Response,String>{
    tauri::async_runtime::spawn_blocking(move || {
        use std::io::{Read,Seek,SeekFrom};
        let mut f=fs::File::open(path).map_err(|e|e.to_string())?;
        if !f.metadata().map_err(|e|e.to_string())?.is_file(){return Err("不支持文件夹".into());}
        f.seek(SeekFrom::Start(offset)).map_err(|e|e.to_string())?;
        let mut bytes=Vec::with_capacity(length.min(4*1024*1024));
        f.take(length.min(4*1024*1024) as u64).read_to_end(&mut bytes).map_err(|e|e.to_string())?;
        Ok(tauri::ipc::Response::new(bytes))
    }).await.map_err(|e|e.to_string())?
}
