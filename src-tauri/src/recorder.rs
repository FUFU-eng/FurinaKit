//! Native recording session owner. No browser/Electron capture or synthetic progress.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    fs,
    
    path::{Path, PathBuf},
    process::Command,
    sync::{
        atomic::{AtomicU64, AtomicBool, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};

#[derive(Clone, Deserialize, Serialize)]
#[serde(tag = "mode", rename_all = "lowercase")]
pub enum Source {
    Window {
        hwnd: u64,
    },
    Region {
        x: i32,
        y: i32,
        width: u32,
        height: u32,
    },
}
#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    source: Source,
    fps: u32,
    quality: String,
    draw_cursor: bool,
    audio: Option<String>,
    #[serde(default="default_backend")]
    capture_backend: String,
}
fn default_backend()->String{"gdi".into()}
static DXGI:AtomicBool=AtomicBool::new(false);
static STARTING:AtomicBool=AtomicBool::new(false);
struct StartGuard;
impl Drop for StartGuard{fn drop(&mut self){STARTING.store(false,Ordering::SeqCst);}}
struct ProgressWatch {
    last: u64,
    changed: Instant,
}
impl ProgressWatch {
    fn new(now: Instant) -> Self { Self { last: 0, changed: now } }
    fn observe(&mut self, progress: u64, now: Instant) -> Duration {
        if progress != self.last { self.last = progress; self.changed = now; }
        now.saturating_duration_since(self.changed)
    }
}
fn progress_timeout(progress: u64, starting: Duration, stalled: Duration) -> Option<&'static str> {
    if progress == 0 && starting >= Duration::from_secs(12) {
        Some("编码器启动 12 秒仍无有效视频进度；分段与日志已保留")
    } else if progress > 0 && stalled >= Duration::from_secs(20) {
        Some("编码器连续 20 秒没有新视频进度，正在请求停止当前分段；请检查磁盘、窗口和录音设备后重新录制")
    } else { None }
}
struct Session {
    id: String,
    config: Config,
    size: (u32, u32),
    dir: PathBuf,
    child: Option<crate::recorder_process::ManagedChild>,
    _engine_leases: Vec<Arc<crate::component_leases::Lease>>,
    segments: Vec<PathBuf>,
    segment_index: u32,
    progress: Arc<AtomicU64>,
    elapsed: u64,
    segment_started: Instant,
    progress_watch: ProgressWatch,
    message: String,
    error: Option<String>,
}
static LEASE_STORE: std::sync::OnceLock<PathBuf> = std::sync::OnceLock::new();
pub fn initialize(app:&tauri::AppHandle)->Result<(),String>{
    use tauri::Manager;
    let store=app.path().app_cache_dir().map_err(|e|e.to_string())?.join("component-leases-v1");
    if let Some(old)=LEASE_STORE.get(){return if old==&store{Ok(())}else{Err("Recorder lease store already fixed".into())};}
    LEASE_STORE.set(store).map_err(|_|"Recorder lease store initialization raced".to_owned())
}
fn engine_lease(program:&std::ffi::OsStr)->Result<Arc<crate::component_leases::Lease>,String>{
    let path=fs::canonicalize(Path::new(program)).map_err(|e|format!("Recorder engine: {e}"))?;
    let parent=path.parent().ok_or("Recorder engine parent missing")?;
    let key=path.file_name().and_then(|s|s.to_str()).ok_or("Non-Unicode recorder engine name")?;
    let store=LEASE_STORE.get().ok_or("Recorder lease store is not initialized")?;
    Ok(Arc::new(crate::component_leases::acquire(store,parent,&[key],crate::component_leases::Mode::Use)?))
}
static SESSION: Mutex<Option<Session>> = Mutex::new(None);
static LAST: Mutex<Option<Value>> = Mutex::new(None);
static AUDIO: Mutex<Vec<String>> = Mutex::new(Vec::new());
fn local(w: &tauri::Webview) -> Result<(), String> {
    if ["main","recorder-panel"].contains(&w.label()) {
        Ok(())
    } else {
        Err("录屏操作仅供本地主窗口调用".into())
    }
}
fn executable_candidates(root: &Path, name: &str) -> Vec<PathBuf> {
    ["", "apps/web", "resources", "services/worker", "resources/worker", "components"]
        .iter().map(|sub| root.join(sub).join(format!("{name}.exe"))).collect()
}
fn executable(name: &str) -> Result<PathBuf, String> {
    if let Some(path)=crate::runtime_layout::find_media_tool(name,&crate::app_root_public()){return Ok(path);}
    for key in [format!("FURINAKIT_{}_PATH", name.to_uppercase()), format!("{}_PATH", name.to_uppercase())] {
        if let Some(value) = std::env::var_os(&key).filter(|v| !v.is_empty()) {
            let path = PathBuf::from(value);
            return if path.is_file() { Ok(path) } else { Err(format!("{key} 指定的程序不存在，请检查音视频组件配置")) };
        }
    }
    if name == "ffprobe" {
        for key in ["FURINAKIT_FFMPEG_PATH", "FFMPEG_PATH"] {
            if let Some(path) = std::env::var_os(key).map(PathBuf::from).and_then(|p| p.parent().map(|p| p.join("ffprobe.exe"))) {
                if path.is_file() { return Ok(path); }
            }
        }
    }
    let root = crate::app_root_public();
    executable_candidates(&root, name).into_iter().find(|p| p.is_file())
        .or_else(|| {
            let mut candidates = Vec::new();
            if let Ok(path) = std::env::var("LOCALAPPDATA") {
                candidates.push(PathBuf::from(&path).join("com.furinakit.desktop").join("components").join(format!("{name}.exe")));
                candidates.push(PathBuf::from(&path).join("FurinaKit").join("components").join(format!("{name}.exe")));
            }
            if let Ok(path) = std::env::var("APPDATA") {
                candidates.push(PathBuf::from(&path).join("com.furinakit.desktop").join("components").join(format!("{name}.exe")));
                candidates.push(PathBuf::from(&path).join("FurinaKit").join("components").join(format!("{name}.exe")));
            }
            candidates.into_iter().find(|p| p.is_file())
        })
        .ok_or_else(|| format!("找不到 {name}：请前往「设置 - 组件管理」下载，或设置环境变量"))
}
#[cfg(test)]
mod executable_location_tests {
    use super::*;
    #[test]
    fn includes_electron_development_and_packaged_layouts() {
        let root = Path::new("fixture-root");
        for name in ["ffmpeg", "ffprobe"] {
            let candidates = executable_candidates(root, name);
            for sub in ["", "apps/web", "resources", "services/worker", "resources/worker"] {
                assert!(candidates.contains(&root.join(sub).join(format!("{name}.exe"))));
            }
            assert_eq!(candidates.len(), 6);
        }
    }
}
#[cfg(windows)]
mod win {
    use super::*;
    #[repr(C)]
    #[derive(Default)]
    struct Rect {
        left: i32,
        top: i32,
        right: i32,
        bottom: i32,
    }
    #[link(name = "user32")]
    extern "system" {
        fn EnumWindows(cb: extern "system" fn(isize, isize) -> i32, param: isize) -> i32;
        fn IsWindowVisible(h: isize) -> i32;
        fn IsIconic(h: isize) -> i32;
        fn GetWindowTextW(h: isize, text: *mut u16, max: i32) -> i32;
        fn GetClientRect(h: isize, r: *mut Rect) -> i32;
        fn GetWindowThreadProcessId(h: isize, pid: *mut u32) -> u32;
        fn GetSystemMetrics(index: i32) -> i32;
        fn SetThreadDpiAwarenessContext(ctx: isize) -> isize;
    }
    struct Dpi(isize);
    impl Dpi {
        fn enter() -> Self {
            Self(unsafe { SetThreadDpiAwarenessContext(-4) })
        }
    }
    impl Drop for Dpi {
        fn drop(&mut self) {
            if self.0 != 0 {
                unsafe {
                    SetThreadDpiAwarenessContext(self.0);
                }
            }
        }
    }
    pub fn bounds() -> (i32, i32, u32, u32) {
        let _dpi = Dpi::enter();
        unsafe {
            (
                GetSystemMetrics(76),
                GetSystemMetrics(77),
                GetSystemMetrics(78).max(0) as u32,
                GetSystemMetrics(79).max(0) as u32,
            )
        }
    }
    pub fn dimensions(hwnd: u64) -> Result<(u32, u32), String> {
        let _dpi = Dpi::enter();
        let h = hwnd as isize;
        let mut r = Rect::default();
        unsafe {
            if hwnd == 0
                || IsWindowVisible(h) == 0
                || IsIconic(h) != 0
                || GetClientRect(h, &mut r) == 0
            {
                return Err("目标窗口不可见、已最小化或已关闭".into());
            }
        }
        let w = r.right - r.left;
        let h = r.bottom - r.top;
        if w < 8 || h < 8 {
            return Err("目标窗口太小".into());
        }
        Ok((w as u32, h as u32))
    }
    extern "system" fn collect(h: isize, param: isize) -> i32 {
        let rows = unsafe { &mut *(param as *mut Vec<Value>) };
        let mut pid = 0;
        unsafe {
            GetWindowThreadProcessId(h, &mut pid);
        }
        if pid == std::process::id() {
            return 1;
        }
        if let Ok((w, ht)) = dimensions(h as u64) {
            let mut title = [0u16; 512];
            let n = unsafe { GetWindowTextW(h, title.as_mut_ptr(), 512) };
            if n > 0 {
                rows.push(json!({"hwnd":h as u64,"title":String::from_utf16_lossy(&title[..n as usize]),"width":w,"height":ht}));
            }
        }
        1
    }
    pub fn single_monitor()->bool{unsafe{GetSystemMetrics(80)==1}}
    pub fn windows() -> Vec<Value> {
        let _dpi = Dpi::enter();
        let mut rows = Vec::new();
        unsafe {
            EnumWindows(collect, &mut rows as *mut Vec<Value> as isize);
        }
        rows
    }
}
#[cfg(not(windows))]
mod win {
    use super::*;
    pub fn bounds() -> (i32, i32, u32, u32) {
        (0, 0, 0, 0)
    }
    pub fn single_monitor()->bool{false}
    pub fn windows() -> Vec<Value> {
        vec![]
    }
    pub fn dimensions(_: u64) -> Result<(u32, u32), String> {
        Err("录屏仅支持 Windows".into())
    }
}
fn check_region(
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    b: (i32, i32, u32, u32),
) -> Result<(u32, u32), String> {
    if w < 8 || h < 8 || u64::from(w) * u64::from(h) > 33_177_600 {
        return Err("录制区域至少 8×8，最多 3320 万像素".into());
    }
    if i64::from(x) < i64::from(b.0)
        || i64::from(y) < i64::from(b.1)
        || i64::from(x) + i64::from(w) > i64::from(b.0) + i64::from(b.2)
        || i64::from(y) + i64::from(h) > i64::from(b.1) + i64::from(b.3)
    {
        return Err("录制区域已超出当前显示器布局，请重新选择".into());
    }
    Ok((w, h))
}
fn dimensions(s: &Source) -> Result<(u32, u32), String> {
    match s {
        Source::Window { hwnd } => win::dimensions(*hwnd),
        Source::Region {
            x,
            y,
            width,
            height,
        } => check_region(*x, *y, *width, *height, win::bounds()),
    }
}
fn validate(c: &Config) -> Result<u32, String> {
    if ![15, 24, 30, 60].contains(&c.fps) {
        return Err("帧率须为 15、24、30 或 60".into());
    }
    match c.quality.as_str() {
        "high" => Ok(18),
        "balanced" => Ok(23),
        "small" => Ok(28),
        _ => Err("无效画质".into()),
    }
}
fn args(c: &Config, crf: u32) -> Vec<String> {
    let video_filter=if c.capture_backend=="dxgi"{"hwdownload,format=bgra,scale=in_range=pc:out_range=tv:out_color_matrix=bt709,pad=ceil(iw/2)*2:ceil(ih/2)*2"}else{"scale=in_range=pc:out_range=tv:out_color_matrix=bt709,pad=ceil(iw/2)*2:ceil(ih/2)*2"};
    let mut a = vec![
        "-hide_banner",
        "-loglevel",
        "warning",
        "-n",
        "-thread_queue_size",
        "512",
        "-f",
        "gdigrab",
        "-framerate",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect::<Vec<_>>();
    a.push(c.fps.to_string());
    a.extend([
        "-draw_mouse".into(),
        if c.draw_cursor { "1" } else { "0" }.into(),
    ]);
    match c.source {
        Source::Window { hwnd } => a.extend(["-i".into(), format!("hwnd={hwnd}")]),
        Source::Region {
            x,
            y,
            width,
            height,
        } => a.extend([
            "-offset_x".into(),
            x.to_string(),
            "-offset_y".into(),
            y.to_string(),
            "-video_size".into(),
            format!("{width}x{height}"),
            "-i".into(),
            "desktop".into(),
        ]),
    }
    if c.capture_backend=="dxgi" {
        if let Source::Region{x,y,width,height}=c.source{
            let origin=win::bounds();
            a=vec!["-hide_banner".into(),"-loglevel".into(),"warning".into(),"-n".into(),"-thread_queue_size".into(),"512".into(),"-f".into(),"lavfi".into(),"-i".into(),
                format!("ddagrab=output_idx=0:framerate={}:draw_mouse={}:video_size={}x{}:offset_x={}:offset_y={}",c.fps,if c.draw_cursor{1}else{0},width,height,x-origin.0,y-origin.1)];
        }
    }
    if let Some(ref name) = c.audio {
        a.extend([
            "-thread_queue_size".into(),
            "512".into(),
            "-f".into(),
            "dshow".into(),
            "-i".into(),
            format!("audio={name}"),
        ]);
    }
    a.extend(
        [
            "-map",
            "0:v:0",
            "-vf",
            video_filter,
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
        ]
        .into_iter()
        .map(str::to_owned),
    );
    a.push(crf.to_string());
    a.extend(
        [
            "-pix_fmt",
            "yuv420p",
            "-color_range", "tv",
            "-colorspace", "bt709",
            "-color_primaries", "bt709",
            "-color_trc", "iec61966-2-1",
            "-movflags",
            "+faststart",
            "-progress",
            "pipe:1",
            "-stats_period",
            "0.5",
        ]
        .into_iter()
        .map(str::to_owned),
    );
    if c.audio.is_some() {
        a.extend(
            [
                "-map", "1:a:0", "-c:a", "aac", "-b:a", "160k", "-ar", "48000", "-ac", "2",
            ]
            .into_iter()
            .map(str::to_owned),
        );
    } else {
        a.push("-an".into());
    }
    a
}
fn bounded_output(cmd: Command, timeout: Duration) -> Result<std::process::Output, String> {
    let lease=engine_lease(cmd.get_program())?;
    crate::recorder_process::ManagedChild::capture(&cmd,timeout,lease)
}

fn audio_devices() -> Result<Vec<String>, String> {
    let mut c = Command::new(executable("ffmpeg")?);
    c.args([
        "-hide_banner",
        "-list_devices",
        "true",
        "-f",
        "dshow",
        "-i",
        "dummy",
    ]);
    let out = bounded_output(c, Duration::from_secs(8))?;
    Ok(parse_audio(&String::from_utf8_lossy(&out.stderr)))
}
fn parse_audio(text: &str) -> Vec<String> {
    let mut result = Vec::new();
    for line in text.lines().filter(|s| s.trim_end().ends_with("(audio)")) {
        if let Some((_, rest)) = line.split_once('"') {
            if let Some((name, _)) = rest.rsplit_once('"') {
                if !name.is_empty()
                    && !name.contains(['\r', '\n', '"', ':'])
                    && !result.contains(&name.to_owned())
                {
                    result.push(name.to_owned());
                }
            }
        }
    }
    result
}
fn probe(path: &Path) -> Result<(), String> {
    let mut c = Command::new(executable("ffprobe")?);
    c.args([
        "-v",
        "error",
        "-select_streams",
        "v:0",
        "-show_entries",
        "stream=codec_name,width,height:format=duration",
        "-of",
        "json",
    ])
    .arg(path);
    let out = bounded_output(c, Duration::from_secs(15))?;
    if !out.status.success() {
        return Err("录制文件校验失败，原分段已保留".into());
    }
    let v: Value = serde_json::from_slice(&out.stdout).map_err(|_| "录制文件信息无效")?;
    if v["streams"][0]["width"].as_u64().unwrap_or(0) == 0
        || v["format"]["duration"]
            .as_str()
            .and_then(|v| v.parse::<f64>().ok())
            .unwrap_or(0.0)
            <= 0.0
    {
        return Err("没有录到有效画面；请至少录制一秒后停止".into());
    }
    Ok(())
}
fn start_segment(s: &mut Session) -> Result<(), String> {
    if dimensions(&s.config.source)? != s.size {
        return Err("目标窗口尺寸已改变，请结束当前录制并重新开始".into());
    }
    let crf = validate(&s.config)?;
    let index = s.segment_index;
    s.segment_index += 1;
    let path = s.dir.join(format!("segment-{index:04}.mp4"));
    let log = s.dir.join(format!("segment-{index:04}.log"));
    let mut cmd = Command::new(executable("ffmpeg")?);
    cmd.args(args(&s.config, crf)).arg(&path);
    let lease=engine_lease(cmd.get_program())?;
    let log=fs::OpenOptions::new().write(true).create_new(true).open(&log).map_err(|e|e.to_string())?;
    let child=crate::recorder_process::ManagedChild::spawn(&cmd,Some(log),lease,true)?;
    s.progress = Arc::new(AtomicU64::new(0));
    s.segment_started = Instant::now();
    s.progress_watch = ProgressWatch::new(s.segment_started);
    s.child = Some(child);
    s.message = "正在录制（计时来自编码器）".into();
    Ok(())
}
fn finish_segment(s: &mut Session) -> Result<(), String> {
    let progress=&s.progress;
    let Some(status)=crate::recorder_process::finish_slot(&mut s.child,
        |child|child.finish(progress,Duration::from_secs(10)),
        |child|matches!(child.try_wait(),Ok(Some(_))))? else{return Ok(());};
    let n = s.segment_index - 1;
    let path = s.dir.join(format!("segment-{n:04}.mp4"));
    if !status.success() {
        return Err(format!(
            "编码器退出失败；检查录制目录中的 segment-{n:04}.log"
        ));
    }
    probe(&path)?;
    s.segments.push(path);
    s.elapsed += s.progress.swap(0, Ordering::Relaxed);
    Ok(())
}
fn phase(child: bool, error: bool, progress: u64) -> &'static str {
    if error {
        "error"
    } else if !child {
        "paused"
    } else if progress == 0 {
        "starting"
    } else {
        "recording"
    }
}
fn snapshot() -> Value {
    let guard = SESSION.lock().unwrap_or_else(|e| e.into_inner());
    if let Some(s) = guard.as_ref() {
        json!({"state":phase(s.child.is_some(),s.error.is_some(),s.progress.load(Ordering::Relaxed)),"id":s.id,"config":s.config,"elapsedMs":(s.elapsed+s.progress.load(Ordering::Relaxed))/1000,"message":s.message,"error":s.error,"directory":s.dir.to_string_lossy()})
    } else {
        json!({"state":"idle","last":LAST.lock().unwrap_or_else(|e|e.into_inner()).clone()})
    }
}
fn dxgi_available()->bool{
    if !win::single_monitor(){return false;}
    let Ok(exe)=executable("ffmpeg") else{return false;};
    let mut cmd=Command::new(exe);cmd.args(["-hide_banner","-filters"]);
    bounded_output(cmd,Duration::from_secs(5)).map(|o|String::from_utf8_lossy(&o.stdout).lines().any(|line|line.split_whitespace().any(|word|word=="ddagrab"))).unwrap_or(false)
}
#[tauri::command]
pub async fn recorder_sources(webview: tauri::Webview) -> Result<Value, String> {
    local(&webview)?;
    tauri::async_runtime::spawn_blocking(||{
        let windows=win::windows();let (audio,warning)=match audio_devices(){Ok(v)=>(v,None),Err(e)=>(vec![],Some(e))};
        *AUDIO.lock().map_err(|_|"设备状态异常")?=audio.clone();
        let dxgi=dxgi_available();DXGI.store(dxgi,Ordering::SeqCst);let b=win::bounds();
        Ok(json!({"desktop":{"x":b.0,"y":b.1,"width":b.2,"height":b.3},"windows":windows,"audio":audio,"warning":warning,"dxgi":dxgi,"ffmpeg":executable("ffmpeg").is_ok(),"ffprobe":executable("ffprobe").is_ok()}))
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn recorder_start(webview: tauri::Webview, app:tauri::AppHandle, config: Config, countdown_seconds:Option<u8>) -> Result<Value, String> {
    local(&webview)?;
    tauri::async_runtime::spawn_blocking(move || {
        if STARTING.swap(true,Ordering::SeqCst){return Err("录屏正在准备，请勿重复开始".into());}let _starting=StartGuard;
        validate(&config)?;
        let seconds=countdown_seconds.unwrap_or(3);if seconds!=0&&seconds!=3{return Err("倒计时只支持立即或3秒".into());}
        if config.capture_backend!="gdi"&&config.capture_backend!="dxgi"{return Err("未知采集方式".into());}
        if config.capture_backend=="dxgi"&&(!DXGI.load(Ordering::SeqCst)||!win::single_monitor()||!matches!(config.source,Source::Region{..})){return Err("此画面暂不支持DXGI，请刷新设备或选择兼容采集".into());}
        let engine_leases=["ffmpeg","ffprobe"].iter().map(|name|engine_lease(executable(name)?.as_os_str())).collect::<Result<Vec<_>,String>>()?;
        let size = dimensions(&config.source)?;
        if u64::from(size.0) * u64::from(size.1) > 33_177_600 {
            return Err("窗口超过最大录制尺寸".into());
        }
        if let Some(ref name) = config.audio {
            if !AUDIO.lock().map_err(|_| "设备状态异常")?.contains(name) {
                return Err("录音设备已变化，请刷新设备后重试".into());
            }
        }
        if SESSION.lock().map_err(|_|"录制状态异常")?.is_some(){return Err("已有录制或暂停中的会话，请先结束".into());}
        if let Err(e)=crate::recorder_panel::prepare(&app,seconds){let _=crate::recorder_panel::return_main(&app);return Err(e);}
        let mut guard = SESSION.lock().map_err(|_| "录制状态异常")?;
        let id = crate::jobs::new_job_id_public();
        let dir = crate::app_root_public().join("data/recordings").join(&id);
        if let Err(e)=fs::create_dir_all(&dir){drop(guard);let _=crate::recorder_panel::return_main(&app);return Err(e.to_string());}
        let mut s = Session {
            id,
            config,
            size,
            dir,
            child: None,
            _engine_leases: engine_leases,
            segments: vec![],
            segment_index: 0,
            progress: Arc::new(AtomicU64::new(0)),
            elapsed: 0,
            segment_started: Instant::now(),
            progress_watch: ProgressWatch::new(Instant::now()),
            message: String::new(),
            error: None,
        };
        if let Err(e)=start_segment(&mut s){drop(guard);let _=crate::recorder_panel::return_main(&app);return Err(e);}
        *guard = Some(s);
        drop(guard);
        if let Err(e)=crate::recorder_panel::started(&app){let _=crate::recorder_panel::return_main(&app);eprintln!("Recording controls: {e}");}
        Ok(snapshot())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn recorder_status(webview: tauri::Webview) -> Result<Value, String> {
    local(&webview)?;
    tauri::async_runtime::spawn_blocking(|| Ok(snapshot()))
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn recorder_pause(webview: tauri::Webview) -> Result<Value, String> {
    local(&webview)?;
    tauri::async_runtime::spawn_blocking(|| {
        let mut g = SESSION.lock().map_err(|_| "录制状态异常")?;
        let s = g.as_mut().ok_or("没有录制会话")?;
        if let Err(e) = finish_segment(s) {
            s.error = Some(e.clone());
            return Err(e);
        }
        s.message = "已暂停，已完成分段保留在录制目录".into();
        drop(g);
        Ok(snapshot())
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn recorder_resume(webview: tauri::Webview) -> Result<Value, String> {
    local(&webview)?;
    tauri::async_runtime::spawn_blocking(|| {
        let mut g = SESSION.lock().map_err(|_| "录制状态异常")?;
        let s = g.as_mut().ok_or("没有录制会话")?;
        if s.error.is_some() {
            return Err("当前会话失败，请结束并检查分段".into());
        }
        if s.child.is_some() {
            return Err("已经在录制".into());
        }
        start_segment(s)?;
        drop(g);
        Ok(snapshot())
    })
    .await
    .map_err(|e| e.to_string())?
}
fn merge_segments(dir: &Path, segments: &[PathBuf], output: &Path) -> Result<(), String> {
    if segments.is_empty() {
        return Err("没有有效录制分段".into());
    }
    if output.exists() {
        return Err("成品路径已存在，不覆盖已有录制".into());
    }
    if segments.len() == 1 {
        fs::copy(&segments[0], &output).map_err(|e| e.to_string())?;
    } else {
        let list = dir.join("concat.txt");
        let lines = segments
            .iter()
            .map(|p| format!("file '{}'\n", p.file_name().unwrap().to_string_lossy()))
            .collect::<String>();
        fs::write(&list, lines).map_err(|e| e.to_string())?;
        let mut c = Command::new(executable("ffmpeg")?);
        c.args([
            "-hide_banner",
            "-loglevel",
            "error",
            "-n",
            "-f",
            "concat",
            "-safe",
            "1",
            "-i",
        ])
        .arg(&list)
        .args(["-c", "copy", "-movflags", "+faststart"])
        .arg(&output);
        let out = bounded_output(c, Duration::from_secs(120))?;
        if !out.status.success() {
            return Err("分段合并失败，所有原分段已保留".into());
        }
    }
    probe(&output)?;
    Ok(())
}
fn stop() -> Result<Value, String> {
    let mut guard = SESSION.lock().map_err(|_| "录制状态异常")?;
    let mut s = guard.take().ok_or("没有录制会话")?;
    let result = (|| {
        finish_segment(&mut s)?;
        if let Some(ref error) = s.error {
            return Err(error.clone());
        }
        if s.segments.is_empty() {
            return Err("没有有效录制分段".into());
        }
        let output = s.dir.join("recording.mp4");
        merge_segments(&s.dir, &s.segments, &output)?;
        Ok(
            json!({"path":output.to_string_lossy(),"directory":s.dir.to_string_lossy(),"bytes":fs::metadata(&output).map_err(|e|e.to_string())?.len(),"segments":s.segments.len(),"success":true}),
        )
    })();
    let final_result = match &result {
        Ok(v) => v.clone(),
        Err(e) => json!({"success":false,"error":e,"directory":s.dir.to_string_lossy()}),
    };
    *LAST.lock().unwrap_or_else(|e| e.into_inner()) = Some(final_result);
    if s.child.is_some(){
        s.error=Some(result.as_ref().err().cloned().unwrap_or_else(||"Recorder exit unconfirmed".into()));
        s.message="退出未确认，保留会话和资源；可重试停止 / Exit unconfirmed; session and resources retained".into();
        *guard=Some(s);
    }
    drop(guard);
    result
}
#[tauri::command]
pub async fn recorder_stop(webview: tauri::Webview) -> Result<Value, String> {
    local(&webview)?;
    tauri::async_runtime::spawn_blocking(stop)
        .await
        .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn recorder_play(webview:tauri::Webview,app:tauri::AppHandle)->Result<(),String>{
    local(&webview)?;
    let path=LAST.lock().map_err(|_|"成品状态异常")?.as_ref().filter(|v|v["success"]==true).and_then(|v|v["path"].as_str()).map(PathBuf::from).ok_or("没有可播放的录制成品")?;
    if !path.is_file()||path.extension().and_then(|e|e.to_str())!=Some("mp4"){return Err("录制文件不存在或格式无效".into());}
    tauri::async_runtime::spawn_blocking(move||{
        use tauri_plugin_shell::ShellExt;
        app.shell().open(path.to_string_lossy().into_owned(),None).map_err(|e|format!("无法调用默认播放器，请检查MP4文件关联：{e}"))
    }).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn recorder_save_as(
    webview: tauri::Webview,
    app: tauri::AppHandle,
) -> Result<bool, String> {
    local(&webview)?;
    let source = LAST
        .lock()
        .map_err(|_| "录制状态异常")?
        .as_ref()
        .and_then(|v| v["path"].as_str())
        .map(PathBuf::from)
        .ok_or("没有可保存的录制成品")?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::default_output::save_file(&app, &source, "录屏.mp4")?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}
pub fn watch() {
    std::thread::spawn(|| loop {
        std::thread::sleep(Duration::from_millis(750));
        let mut g = SESSION.lock().unwrap_or_else(|e| e.into_inner());
        let Some(s) = g.as_mut() else {
            continue;
        };
        if s.child.is_none() {
            continue;
        }
        let source_changed = (s.config.capture_backend=="dxgi"&&!win::single_monitor()) || dimensions(&s.config.source)
            .map(|size| size != s.size)
            .unwrap_or(true);
        let child_state = {let child=s.child.as_mut().unwrap();child.poll_progress(&s.progress).and_then(|_|child.root_exited())};
        let exited = matches!(&child_state, Ok(true));
        let process_error = child_state.is_err();
        let progress = s.progress.load(Ordering::Relaxed);
        let stalled = s.progress_watch.observe(progress, Instant::now());
        let timeout = progress_timeout(progress, s.segment_started.elapsed(), stalled);
        if source_changed || exited || process_error || timeout.is_some() {
            let reason = if process_error {
                "无法读取编码器进程状态，正在请求停止；分段与日志保留"
            } else if exited {
                "编码器已提前退出，请查看录制目录日志"
            } else if source_changed {
                "目标窗口/区域变化，正在请求暂停，请保持原窗口尺寸后继续"
            } else {
                timeout.unwrap()
            };
            if let Err(e) = finish_segment(s) {
                s.error = Some(format!("{reason}；{e}"));
            } else if exited || process_error || timeout.is_some() {
                s.error = Some(reason.into());
            }
            s.message = reason.into();
        }
    });
}
pub fn shutdown() {
    let active = SESSION.lock().map(|g| g.is_some()).unwrap_or(false);
    if active {
        let _ = stop();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn distinguishes_startup_from_mid_recording_stall() {
        assert!(progress_timeout(0,Duration::from_secs(11),Duration::from_secs(11)).is_none());
        assert!(progress_timeout(0,Duration::from_secs(12),Duration::from_secs(12)).unwrap().contains("启动"));
        assert!(progress_timeout(1,Duration::from_secs(100),Duration::from_secs(19)).is_none());
        assert!(progress_timeout(1,Duration::from_secs(100),Duration::from_secs(20)).unwrap().contains("没有新视频进度"));
    }
    #[test]
    fn changed_progress_resets_stall_timer_and_new_segment_resets_watch() {
        let start=Instant::now(); let mut watch=ProgressWatch::new(start);
        assert_eq!(watch.observe(10,start+Duration::from_secs(5)),Duration::ZERO);
        assert_eq!(watch.observe(10,start+Duration::from_secs(24)),Duration::from_secs(19));
        assert_eq!(watch.observe(20,start+Duration::from_secs(25)),Duration::ZERO);
        watch=ProgressWatch::new(start+Duration::from_secs(100));
        assert_eq!(watch.observe(0,start+Duration::from_secs(101)),Duration::from_secs(1));
    }
    fn config() -> Config {
        Config {
            source: Source::Region {
                x: -1920,
                y: 0,
                width: 1281,
                height: 721,
            },
            fps: 30,
            quality: "balanced".into(),
            draw_cursor: true,
            audio: None,
            capture_backend: "gdi".into(),
        }
    }
    #[test]
    fn region_supports_negative_monitor_origin() {
        assert_eq!(
            check_region(-1920, 0, 1281, 721, (-1920, 0, 4480, 1600)).unwrap(),
            (1281, 721)
        );
    }
    #[test]
    fn invalid_region_rejected() {
        assert!(check_region(0, 0, 7, 8, (0, 0, 2560, 1600)).is_err());
        assert!(check_region(2500, 0, 100, 100, (0, 0, 2560, 1600)).is_err());
    }
    #[test]
    fn no_silent_framerate_clamping() {
        let mut c = config();
        c.fps = 31;
        assert!(validate(&c).is_err());
    }
    #[test]
    fn odd_size_is_padded_not_cropped() {
        for backend in ["gdi", "dxgi"] {
            let mut config = config(); config.capture_backend = backend.into();
            let arguments = args(&config, 23);
            let filter = arguments.windows(2).find(|pair| pair[0] == "-vf").expect("video filter");
            assert!(filter[1].split(',').any(|stage| stage == "pad=ceil(iw/2)*2:ceil(ih/2)*2"));
            assert!(!filter[1].contains("crop="));
        }
    }
    #[test]
    fn silent_default_does_not_open_audio_device() {
        let a = args(&config(), 23);
        assert!(a.contains(&"-an".into()));
        assert!(!a.contains(&"dshow".into()));
    }
    #[test]
    fn hwnd_does_not_fall_back_to_desktop() {
        let mut c = config();
        c.source = Source::Window { hwnd: 12345 };
        let a = args(&c, 23);
        assert!(a.contains(&"hwnd=12345".into()));
        assert!(!a.contains(&"desktop".into()));
    }
    #[test]
    fn audio_names_are_bounded_and_not_video() {
        assert_eq!(
            parse_audio(
                "[dshow] \"Mic\" (audio)\n[dshow] \"Camera\" (video)\n[dshow] \"Mic\" (audio)"
            ),
            vec!["Mic"]
        );
    }
    #[test]
    fn audio_is_only_added_explicitly() {
        let mut c = config();
        c.audio = Some("Test microphone".into());
        assert!(args(&c, 23).contains(&"audio=Test microphone".into()));
    }
    #[test]
    fn starting_is_not_claimed_as_recording() {
        assert_eq!(phase(true, false, 0), "starting");
        assert_eq!(phase(true, false, 1), "recording");
        assert_eq!(phase(false, false, 1), "paused");
        assert_eq!(phase(true, true, 1), "error");
    }
    #[test]
    #[ignore = "Opt-in synthetic media only; set FURINAKIT_RECORDER_MEDIA_TEST_DIR to a new verification directory"]
    fn synthetic_segment_merge_and_probe() {
        let root = PathBuf::from(
            std::env::var("FURINAKIT_RECORDER_MEDIA_TEST_DIR")
                .expect("explicit fixture directory required"),
        );
        assert!(
            !root.exists(),
            "refuse to overwrite an existing fixture directory"
        );
        fs::create_dir_all(&root).unwrap();
        LEASE_STORE.set(root.join("lease-store")).expect("unique synthetic recorder lease store");
        for audio in [false, true] {
            let dir = root.join(if audio { "tone" } else { "silent" });
            fs::create_dir(&dir).unwrap();
            let mut segments = Vec::new();
            for (i, color) in ["red", "blue"].iter().enumerate() {
                let path = dir.join(format!("segment-{i:04}.mp4"));
                let mut cmd = Command::new(executable("ffmpeg").unwrap());
                cmd.args([
                    "-hide_banner",
                    "-loglevel",
                    "error",
                    "-n",
                    "-f",
                    "lavfi",
                    "-i",
                ])
                .arg(format!("color=c={color}:s=320x180:r=15:d=1"));
                if audio {
                    cmd.args([
                        "-f",
                        "lavfi",
                        "-i",
                        "sine=frequency=440:sample_rate=48000:duration=1",
                        "-c:a",
                        "aac",
                        "-ac",
                        "2",
                    ]);
                }
                cmd.args([
                    "-c:v",
                    "libx264",
                    "-pix_fmt",
                    "yuv420p",
                    "-t",
                    "1",
                    "-movflags",
                    "+faststart",
                ])
                .arg(&path);
                let result = bounded_output(cmd, Duration::from_secs(30)).unwrap();
                assert!(
                    result.status.success(),
                    "{}",
                    String::from_utf8_lossy(&result.stderr)
                );
                probe(&path).unwrap();
                segments.push(path);
            }
            let output = dir.join("recording.mp4");
            merge_segments(&dir, &segments, &output).unwrap();
            assert!(
                segments.iter().all(|p| p.is_file()),
                "original segments must survive"
            );
            assert!(
                merge_segments(&dir, &segments, &output).is_err(),
                "do not overwrite output"
            );
            let mut cmd = Command::new(executable("ffprobe").unwrap());
            cmd.args([
                "-v",
                "error",
                "-show_streams",
                "-show_format",
                "-of",
                "json",
            ])
            .arg(&output);
            let result = bounded_output(cmd, Duration::from_secs(15)).unwrap();
            let metadata: Value = serde_json::from_slice(&result.stdout).unwrap();
            let streams = metadata["streams"].as_array().unwrap();
            assert_eq!(
                streams
                    .iter()
                    .filter(|s| s["codec_type"] == "audio")
                    .count(),
                if audio { 1 } else { 0 }
            );
            let video = streams.iter().find(|s| s["codec_type"] == "video").unwrap();
            assert_eq!(video["width"], 320);
            assert_eq!(video["height"], 180);
            assert_eq!(video["nb_frames"], "30");
            let duration: f64 = metadata["format"]["duration"]
                .as_str()
                .unwrap()
                .parse()
                .unwrap();
            assert!((duration - 2.0).abs() < 0.12);
            fs::write(
                dir.join("verified.json"),
                serde_json::to_vec_pretty(&metadata).unwrap(),
            )
            .unwrap();
        }
        println!(
            "Synthetic lavfi only; no desktop/window/microphone capture. {}",
            root.display()
        );
    }
}
