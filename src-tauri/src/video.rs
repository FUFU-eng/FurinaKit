// 视频信息解析（对应原版 apps/web/src/app/api/video-info/route.ts）
//
// 「B站视频提取 / 推特视频提取 / 通用视频下载」的第一步都是"解析"：把分享文案里的链接
// 丢给 yt-dlp，拿回标题、封面、时长、可选画质。这里就是把原版那 259 行逻辑搬到 Rust。
//
// 几处关键行为**照原版一模一样**（不然解析结果或报错文案会和原版不一致）：
//   · 分享文案里可能混着文字，先从中"抠出第一个网址"，并去掉结尾的标点；
//   · 国内站点（B站/抖音/优酷…）**直连不走代理**，国外站点才用系统代理
//     （代理地址从注册表 HKCU\...\Internet Settings 读，和原版一样；走代理反而会被反爬）；
//   · yt-dlp 参数：--no-playlist --no-color --no-check-certificates --user-agent <Chrome> --dump-single-json；
//   · 画质选项：高度 ≥360、按高度去重、从高到低排；
//   · 报错要翻译成人话（"该推文未找到视频""被限流""代理没开"……），原版有一整串判断。

use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::Manager;

const DEFAULT_UA: &str =
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/// 国内站点：这些直连，走代理反而可能触发反爬
const DOMESTIC_SITES: [&str; 25] = [
    "bilibili.com", "b23.tv", "douyin.com", "iesdouyin.com", "ixigua.com", "toutiao.com",
    "youku.com", "youku.net", "iqiyi.com", "qiyi.com", "v.qq.com", "qq.com", "weibo.com",
    "weibo.cn", "zhihu.com", "xiaohongshu.com", "xhslink.com", "kuaishou.com", "gifshow.com",
    "mgtv.com", "acfun.cn", "pptv.com", "sohu.com", "tv.sohu.com", "kuaidi100.com",
];

/// 从可能带文字的分享内容里抠出第一个网址（并去掉结尾的标点）
pub fn extract_url(text: &str) -> String {
    let t = text.trim();
    if t.is_empty() {
        return String::new();
    }
    let lower = t.to_lowercase();
    let start = match (lower.find("http://"), lower.find("https://")) {
        (Some(a), Some(b)) => a.min(b),
        (Some(a), None) => a,
        (None, Some(b)) => b,
        (None, None) => return t.to_string(),
    };
    let rest = &t[start..];
    let end = rest.find(char::is_whitespace).unwrap_or(rest.len());
    let mut url = rest[..end].to_string();
    // 去掉结尾的中英文标点（分享文案里常见"链接："后面跟着句号/括号）
    while let Some(c) = url.chars().last() {
        if ".,;:!?）)】」》\"'".contains(c) {
            url.pop();
        } else {
            break;
        }
    }
    url
}

fn is_domestic(url: &str) -> bool {
    let host = url::Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_lowercase()))
        .unwrap_or_default();
    DOMESTIC_SITES
        .iter()
        .any(|s| host == *s || host.ends_with(&format!(".{s}")))
}

/// 读系统代理（注册表），与原版一致；国内站点不用
pub fn system_proxy(url: &str) -> Option<String> {
    if is_domestic(url) {
        return None;
    }
    let mut c1 = Command::new("reg");
    c1.args([
        "query",
        r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
        "/v",
        "ProxyServer",
    ]);
    crate::commands::no_window(&mut c1);
    let out = c1.output().ok()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let server = text
        .lines()
        .find(|l| l.contains("ProxyServer"))
        .and_then(|l| l.split("REG_SZ").nth(1))
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())?;

    // 还要确认代理是开着的
    let mut c2 = Command::new("reg");
    c2.args([
        "query",
        r"HKCU\Software\Microsoft\Windows\CurrentVersion\Internet Settings",
        "/v",
        "ProxyEnable",
    ]);
    crate::commands::no_window(&mut c2);
    let enable = c2.output().ok()?;
    let etext = String::from_utf8_lossy(&enable.stdout);
    let on = etext
        .lines()
        .find(|l| l.contains("ProxyEnable"))
        .map(|l| l.contains("0x1"))
        .unwrap_or(false);
    if !on {
        return None;
    }
    Some(if server.starts_with("http") {
        server
    } else {
        format!("http://{server}")
    })
}

/// 找到 yt-dlp 的调用方式：
/// ① 环境变量指定的独立 exe（打包版那样）② 工作进程 venv 里的 python -m yt_dlp
pub(crate) fn ytdlp_command(app: &tauri::AppHandle) -> Result<(PathBuf, Vec<String>, Option<crate::component_store::Active>), String> {
    if let Ok(p) = std::env::var("FURINAKIT_YTDLP_PATH") {
        let pb = PathBuf::from(&p);
        if pb.is_file() {
            return Ok((pb, Vec::new(), None));
        }
    }
    let root = crate::app_root_of(app);
    let components = crate::api::components_dir(app)?;
    // 安装包内置的 yt-dlp（tools/engines/yt-dlp），全新电脑无需 Python 扩展即可下载视频
    for executable in [components.join("yt-dlp/yt-dlp.exe"), components.join("yt-dlp.exe"), root.join("tools/engines/yt-dlp/yt-dlp.exe")] {
        if executable.is_file() { return Ok((executable, Vec::new(), None)); }
    }
    let worker = crate::worker_extension::select(&root, &components)?;
    let py = worker.root.join("services/worker/.venv/Scripts/python.exe");
    if py.is_file() { return Ok((py, crate::worker_extension::python_args(vec!["-m".into(), "yt_dlp".into()],worker.guard.is_some()), worker.guard)); }
    Err("未安装视频下载引擎 yt-dlp；请导入独立引擎或使用原完整版本。 / The yt-dlp download engine is not installed; import the standalone engine or use the existing full version.".into())
}

/// 把 yt-dlp 的报错翻译成人话（照原版的判断顺序）
pub(crate) fn friendly_error(raw: &str) -> String {
    let l = raw.to_lowercase();
    let hit = |k: &str| l.contains(k);
    if hit("no video could be found in this tweet") || hit("no media found") {
        "该推文中未找到视频或动图（可能仅包含纯文字、静态图片，或推文已被删除/设为仅关注者可见）"
    } else if hit("from a protected account") || hit("protected") {
        "该推文来自私密/上锁账号，无法直接提取"
    } else if hit("rate limit exceeded") || hit("rate-limited") {
        "推特/X 访问频率超限，请稍等片刻后再试"
    } else if hit("http error 404") || hit("not found") {
        "视频或推文不存在，链接可能失效或已被发布者删除"
    } else if hit("http error 403") || hit("forbidden") {
        "访问受限（403），内容可能需登录或已被平台风控保护"
    } else if hit("http error 429") || hit("too many requests") {
        "请求过于频繁被平台限流，请稍后再试"
    } else if hit("http error 412") {
        "视频平台安全验证/反爬机制拦截，请稍后重试"
    } else if hit("timeout") || hit("timed out") {
        "获取视频信息超时，请检查网络连接或科学上网代理是否正常开启"
    } else if hit("10061") || hit("connection refused") || hit("proxyerror") || hit("cannot connect to proxy") {
        "代理连接失败，请确认系统代理/梯子软件已正常开启并在运行"
    } else if hit("private video") || hit("sign in") || hit("login") {
        "该内容为私密内容或需要登录账号后才能查看"
    } else if hit("video unavailable") || hit("removed") {
        "该视频已失效或已被作者删除"
    } else if hit("is not available in your country") || hit("geo-restricted") {
        "该视频受到地区版权限制，请尝试切换代理节点"
    } else if hit("unsupported url") {
        "不支持该链接格式，请确认输入正确的视频或推文链接"
    } else {
        "视频解析失败，请检查链接或网络代理设置"
    }
    .to_string()
}

/// 解析视频信息
pub fn info(app: &tauri::AppHandle, raw_url: &str) -> Result<Value, String> {
    let _component_lease=crate::api::component_use(app,&["ffmpeg.exe","ffprobe.exe"])?;
    let url = extract_url(raw_url);
    if url.is_empty() {
        return Err("请提供视频链接".into());
    }
    let (program, mut args, worker_guard) = ytdlp_command(app)?;

    args.push(url.clone());
    args.extend(
        [
            "--no-playlist",
            "--no-color",
            "--ignore-config",
            "--socket-timeout",
            "20",
            "--retries",
            "2",
            "--user-agent",
            DEFAULT_UA,
            "--dump-single-json",
        ]
        .iter()
        .map(|s| s.to_string()),
    );
    args.push("--proxy".into());
    args.push(system_proxy(&url).unwrap_or_default());

    // yt-dlp 的 JSON 可能有好几 MB —— 直接走管道有塞满缓冲区导致死锁的风险，
    // 所以先落到临时文件，等进程结束再读。
    let tmp = std::env::temp_dir().join(format!("furinakit-ytdlp-{}.json", crate::jobs::new_job_id_public()));
    let stdout_file = std::fs::File::create(&tmp).map_err(|e| format!("建临时文件失败：{e}"))?;
    let stderr_file = tmp.with_extension("err");

    let output_handle = stdout_file.try_clone().map_err(|e|e.to_string())?;
    let error_handle = std::fs::File::create(&stderr_file).map_err(|e|e.to_string())?;
    let mut cmd = Command::new(&program);
    cmd.args(&args)
        .stdout(Stdio::from(stdout_file))
        .stderr(Stdio::from(error_handle.try_clone().map_err(|e|e.to_string())?));
    crate::commands::no_window(&mut cmd);

    #[cfg(windows)]
    let mut child = crate::worker_process::Child::spawn_command(&cmd,&std::fs::File::open("NUL").map_err(|e|e.to_string())?,&output_handle,&error_handle,std::sync::Arc::new((worker_guard,_component_lease)))?;
    #[cfg(not(windows))]
    let mut child = cmd.spawn().map_err(|e| format!("启动 yt-dlp 失败：{e}"))?;

    // 最多等 60 秒（原版也是 60s 超时）
    let deadline = Instant::now() + Duration::from_secs(60);
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break Some(s),
            Ok(None) => {
                if Instant::now() > deadline {
                    child.kill().map_err(|e|format!("Video metadata tree stop unconfirmed: {e}"))?;
                    child.wait().map_err(|e|format!("Video metadata tree stop unconfirmed: {e}"))?;
                    break None;
                }
                std::thread::sleep(Duration::from_millis(120));
            }
            Err(e) => return Err(format!("等待 yt-dlp 失败：{e}")),
        }
    };

    let stdout = std::fs::read_to_string(&tmp).unwrap_or_default();
    let stderr = std::fs::read_to_string(&stderr_file).unwrap_or_default();
    let _ = std::fs::remove_file(&tmp);
    let _ = std::fs::remove_file(&stderr_file);

    if status.is_none() {
        return Err("获取视频信息超时（超过 60 秒），请检查网络或代理".into());
    }
    if !status.map(|s| s.success()).unwrap_or(false) || stdout.trim().is_empty() {
        // yt-dlp 把真正的错误写在 stderr
        return Err(friendly_error(&stderr));
    }

    let info: Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("解析 yt-dlp 的输出失败：{e}"))?;

    // 画质选项：高度 ≥360、按高度去重、从高到低（与原版一致）
    let mut qualities: Vec<Value> = Vec::new();
    let mut seen: Vec<i64> = Vec::new();
    if let Some(formats) = info.get("formats").and_then(|v| v.as_array()) {
        for fmt in formats {
            let Some(h) = fmt.get("height").and_then(|v| v.as_i64()) else { continue };
            if h < 360 || seen.contains(&h) {
                continue;
            }
            seen.push(h);
            qualities.push(json!({
                "height": h,
                "label": format!("{h}p"),
                "format_id": fmt.get("format_id").and_then(|v| v.as_str()).unwrap_or(""),
            }));
        }
    }
    qualities.sort_by(|a, b| {
        b.get("height").and_then(|v| v.as_i64()).unwrap_or(0)
            .cmp(&a.get("height").and_then(|v| v.as_i64()).unwrap_or(0))
    });

    let duration = info.get("duration").and_then(|v| v.as_f64());
    let duration_text = duration
        .map(|d| {
            let m = (d / 60.0).floor() as i64;
            let s = (d % 60.0).floor() as i64;
            format!("{m}:{s:02}")
        })
        .unwrap_or_default();

    Ok(json!({
        "title": info.get("title").and_then(|v| v.as_str()).unwrap_or("未知标题"),
        "duration": duration,
        "durationText": duration_text,
        "thumbnail": info.get("thumbnail").and_then(|v| v.as_str()),
        "uploader": info.get("uploader").and_then(|v| v.as_str()),
        "qualities": qualities,
        "url": url,
    }))
}
