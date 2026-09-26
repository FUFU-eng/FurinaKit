// 媒体信息 & 网页导出：两条都是"用系统已有的能力"，不引新依赖。
//
// ① 媒体信息：调 ffprobe（与 ffmpeg 同源，应用已在用 ffmpeg 录屏）读容器/流参数。
//    文件路径来自**系统原生文件选择框**（tauri-plugin-dialog，项目已带），
//    所以不需要把整个视频读进内存再传给后端 —— 再大的文件也是瞬间出结果。
//
// ② 网页转图片/PDF：调系统自带的 Edge（或 Chrome）无头模式渲染。
//    这是真浏览器渲染，和网页里看到的一致；比自己在沙箱里拼 HTML 靠谱得多。
//    · PDF 用 `--print-to-pdf`；
//    · 图片用 `--screenshot`，并把窗口高度设得足够大以截到整页
//      （不用 CDP 是因为要额外引 WebSocket 依赖，而本项目坚持能不引就不引）。

use std::path::{Path, PathBuf};
use std::process::Command;

// ══════════════════════════════════════════════════════════════════
// ① ffprobe
// ══════════════════════════════════════════════════════════════════

fn ffprobe_exe() -> Result<PathBuf, String> {
    if let Some(path)=crate::runtime_layout::find_media_tool("ffprobe",&crate::app_root_public()){return Ok(path);}
    if let Some(p) = crate::api::which_on_path("ffprobe.exe") {
        return Ok(p);
    }
    let root = crate::app_root_public();
    for cand in [
        root.join("ffprobe.exe"),
        root.join("tools/engines/ffmpeg/ffprobe.exe"),
        root.join("services").join("worker").join("ffprobe.exe"),
        root.join("resources").join("ffprobe.exe"),
        root.join("tools").join("ffmpeg").join("ffprobe.exe"),
    ] {
        if cand.is_file() {
            return Ok(cand);
        }
    }
    Err("缺少 FFprobe，请前往「设置 - 组件管理」下载 FFmpeg / FFprobe 引擎；下载后无需重启。".into())
}

/// 读媒体文件的完整信息（JSON 原文交给前端渲染，Rust 侧不做解析）
pub fn probe(path: &str) -> Result<String, String> {
    if !Path::new(path).is_absolute() {
        return Err("请输入媒体文件的完整绝对路径".into());
    }
    if !Path::new(path).is_file() {
        return Err(format!("找不到这个文件：{path}"));
    }
    let exe = ffprobe_exe()?;
    let mut cmd = Command::new(exe);
    cmd.args([
        "-v", "quiet",
        "-print_format", "json",
        "-show_format",
        "-show_streams",
        "-show_chapters",
        path,
    ]);
    crate::commands::no_window(&mut cmd);
    let out = cmd.output().map_err(|e| format!("调用 ffprobe 失败：{e}"))?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        return Err(format!(
            "这个文件读不出媒体信息（可能不是音视频/图片，或者文件已损坏）：{}",
            err.trim()
        ));
    }
    let text = String::from_utf8_lossy(&out.stdout).to_string();
    if text.trim().is_empty() {
        return Err("ffprobe 没有返回内容".into());
    }
    Ok(text)
}

// ══════════════════════════════════════════════════════════════════
// ② Edge / Chrome 无头渲染
// ══════════════════════════════════════════════════════════════════

fn browser_exe() -> Result<PathBuf, String> {
    let mut cands: Vec<PathBuf> = Vec::new();
    if let Ok(pf) = std::env::var("ProgramFiles") {
        cands.push(PathBuf::from(&pf).join("Microsoft/Edge/Application/msedge.exe"));
        cands.push(PathBuf::from(&pf).join("Google/Chrome/Application/chrome.exe"));
    }
    if let Ok(pf86) = std::env::var("ProgramFiles(x86)") {
        cands.push(PathBuf::from(&pf86).join("Microsoft/Edge/Application/msedge.exe"));
        cands.push(PathBuf::from(&pf86).join("Google/Chrome/Application/chrome.exe"));
    }
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        cands.push(PathBuf::from(&local).join("Microsoft/Edge/Application/msedge.exe"));
        cands.push(PathBuf::from(&local).join("Google/Chrome/Application/chrome.exe"));
    }
    for c in cands {
        if c.is_file() {
            return Ok(c);
        }
    }
    Err("找不到 Microsoft Edge 或 Chrome。网页转图片/PDF 需要其中之一来渲染（Windows 一般自带 Edge）。".into())
}

/// 把用户输入整理成浏览器能打开的地址
pub fn normalize_target(input: &str, is_file: bool) -> Result<String, String> {
    let t = input.trim();
    if t.is_empty() {
        return Err(if is_file { "请选择一个 HTML 文件".into() } else { "请填写网址".into() });
    }
    if is_file {
        let p = Path::new(t);
        if !p.is_file() {
            return Err(format!("找不到这个文件：{t}"));
        }
        let s = p.to_string_lossy().replace('\\', "/");
        return Ok(format!("file:///{}", s.trim_start_matches('/')));
    }
    if t.starts_with("http://") || t.starts_with("https://") || t.starts_with("file://") {
        return Ok(t.to_string());
    }
    Ok(format!("https://{t}"))
}


/// 渲染前先探一下"连不连得上"。
///
/// 为什么需要：网址打不开时，无头浏览器会渲染**它自己的错误页**，
/// 照样生成一张"无法访问此网站"的 PDF/PNG，用户拿到会一头雾水。
///
/// 只判"连接层是否成功"（DNS/超时等问题），**不看 HTTP 状态码** ——
/// 有些站点会拒绝非浏览器请求（403/503），但浏览器打开是正常的，那种不能算失败。
pub fn preflight(url: &str) -> Result<(), String> {
    if url.starts_with("file://") {
        return Ok(()); // 本地文件不需要探
    }
    // 只要连上了、拿到任何响应就算通过；http_get 在连接失败时才返回 Err
    match crate::netquery::http_get(url, 8) {
        Ok(_) => Ok(()),
        Err(e) => {
            let low = e.to_lowercase();
            let hint = if low.contains("could not resolve") || low.contains("resolve host") {
                "域名解析不了，检查网址有没有写错"
            } else if low.contains("timed out") || low.contains("timeout") {
                "连接超时，可能这个站国内直连打不开"
            } else if low.contains("refused") {
                "对方拒绝了连接"
            } else {
                "网络不通"
            };
            Err(format!("这个网址打不开（{hint}）。导出用的是真浏览器渲染，网页本身必须能打开才行。"))
        }
    }
}

/// 每次导出用独立的临时浏览器配置目录。
/// 旧实现固定用 %TEMP%\furinakit-headless-profile：上一次的无头进程没退干净或留下锁文件时，
/// Edge 直接以退出码 21（配置目录被占用）结束、不生成任何文件，表现为“网址打不开”（bilibili 实测复现）。
fn temp_profile() -> Result<PathBuf, String> {
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let mut p = std::env::temp_dir();
    p.push(format!("furinakit-headless-{}-{stamp}", std::process::id()));
    std::fs::create_dir_all(&p).map_err(|e| format!("创建临时目录失败：{e}"))?;
    Ok(p)
}

/// 运行无头浏览器：带总超时（防止页面长连接导致永远不退出），结束后删除临时配置目录。
fn run_browser(mut cmd: Command, profile: &Path, wait_ms: u32) -> Result<(Option<i32>, String), String> {
    use std::io::Read;
    cmd.stdout(std::process::Stdio::null()).stderr(std::process::Stdio::piped());
    let mut child = cmd.spawn().map_err(|e| format!("启动浏览器失败：{e}"))?;
    let mut stderr = child.stderr.take();
    let reader = std::thread::spawn(move || { let mut b = String::new(); if let Some(e) = stderr.as_mut() { let _ = e.read_to_string(&mut b); } b });
    let limit = std::time::Duration::from_millis(u64::from(wait_ms) + 60_000);
    let started = std::time::Instant::now();
    let code = loop {
        if let Some(st) = child.try_wait().map_err(|e| e.to_string())? { break st.code(); }
        if started.elapsed() > limit { let _ = child.kill(); let _ = child.wait(); break None; }
        std::thread::sleep(std::time::Duration::from_millis(100));
    };
    let err = reader.join().unwrap_or_default();
    // 浏览器子进程可能稍晚才释放文件，重试几次删除临时目录
    for _ in 0..10 { if std::fs::remove_dir_all(profile).is_ok() || !profile.exists() { break; } std::thread::sleep(std::time::Duration::from_millis(300)); }
    Ok((code, err))
}

fn fail_detail(code: Option<i32>, err: &str) -> String {
    let last = err.lines().filter(|l| !l.trim().is_empty() && !l.contains(":ERROR:")).last().unwrap_or("").trim().to_string();
    match code {
        None => "（渲染超时，已终止浏览器；可把「等待加载」调小后重试）".into(),
        Some(21) => "（浏览器配置目录被占用，请稍后重试）".into(),
        Some(c) if c != 0 => format!("（浏览器退出码 {c}）{last}"),
        _ => last,
    }
}

fn base_cmd(profile: &Path) -> Result<Command, String> {
    let exe = browser_exe()?;
    let mut cmd = Command::new(exe);
    cmd.arg("--headless=new");
    cmd.arg("--disable-gpu");
    cmd.arg("--no-first-run");
    cmd.arg("--no-default-browser-check");
    cmd.arg("--hide-scrollbars");
    cmd.arg(format!("--user-data-dir={}", profile.to_string_lossy()));
    crate::commands::no_window(&mut cmd);
    Ok(cmd)
}

/// 生成 PDF（浏览器自带的 --print-to-pdf，A4 或横向）
pub fn print_to_pdf(url: &str, out_pdf: &Path, landscape: bool, no_header: bool, wait_ms: u32) -> Result<(), String> {
    preflight(url)?;
    let profile = temp_profile()?;
    let mut cmd = base_cmd(&profile)?;
    cmd.arg(format!("--print-to-pdf={}", out_pdf.to_string_lossy()));
    if no_header {
        cmd.arg("--no-pdf-header-footer");
    }
    if landscape {
        cmd.arg("--landscape");
    }
    cmd.arg(format!("--virtual-time-budget={wait_ms}"));
    cmd.arg(url);
    let (code, err) = run_browser(cmd, &profile, wait_ms)?;
    if !out_pdf.is_file() {
        return Err(format!("没能生成 PDF：网址可能打不开、或页面一直没加载完。{}", fail_detail(code, &err)));
    }
    Ok(())
}

/// 生成图片。整页时把窗口高度设得足够大（Edge 的 --screenshot 只截窗口大小）。
pub fn screenshot(url: &str, out_png: &Path, width: u32, height: u32, wait_ms: u32) -> Result<(), String> {
    preflight(url)?;
    let profile = temp_profile()?;
    let mut cmd = base_cmd(&profile)?;
    cmd.arg(format!("--screenshot={}", out_png.to_string_lossy()));
    cmd.arg(format!("--window-size={width},{height}"));
    cmd.arg(format!("--virtual-time-budget={wait_ms}"));
    cmd.arg(url);
    let (code, err) = run_browser(cmd, &profile, wait_ms)?;
    if !out_png.is_file() {
        return Err(format!("没能生成图片：网址可能打不开、或页面一直没加载完。{}", fail_detail(code, &err)));
    }
    Ok(())
}

/// 导出目录：用户"下载"文件夹下的 FurinaKit网页导出。
/// 写成真实文件并返回路径，比把整份文件 base64 传回前端省事也省内存
/// （与本应用其它工具的"打开输出文件夹"体验一致）。
pub fn export_dir() -> PathBuf {
    let base = std::env::var("USERPROFILE")
        .map(PathBuf::from)
        .unwrap_or_else(|_| std::env::temp_dir());
    let dir = base.join("Downloads").join("FurinaKit网页导出");
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// 给导出文件起一个不重名的路径
pub fn export_path(ext: &str) -> PathBuf {
    let stamp = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    export_dir().join(format!("网页导出-{stamp}.{ext}"))
}
