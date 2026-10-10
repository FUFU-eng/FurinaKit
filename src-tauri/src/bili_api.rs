//! B站备用解析：yt-dlp 的 BiliBili 解析器失效时（报 "Unable to extract initial state"），
//! 直接调用 B站公开接口拿视频信息和播放地址。
//!
//! 背景：B站对部分视频（常见于手机分享的竖屏 / story 链接、新投稿）给未登录访问返回一个
//! 不带视频数据的空壳网页，yt-dlp 依赖网页里的数据，于是解析失败；但公开接口仍然正常。
//!
//! 做法：把接口结果拼成 yt-dlp 认识的 info JSON。
//!   · 解析：直接用它生成标题 / 时长 / 画质列表；
//!   · 下载：写成文件交给 `yt-dlp --load-info-json`，选画质、合并、转 MP3、断点续传、进度都沿用原流程。
//! 不需要登录、不读浏览器 Cookie；国内站点直连（不走系统代理）。

use serde_json::{json, Value};

const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const REFERER: &str = "https://www.bilibili.com/";

pub fn is_bilibili(url: &str) -> bool {
    let Ok(u) = url::Url::parse(url) else { return false };
    let host = u.host_str().unwrap_or("").to_ascii_lowercase();
    host == "b23.tv" || host.ends_with(".b23.tv") || host == "bilibili.com" || host.ends_with(".bilibili.com")
}

/// yt-dlp 的这类报错说明是它的 B站解析器坏了，而不是网络问题
pub fn ytdlp_extractor_broken(stderr: &str) -> bool {
    let l = stderr.to_ascii_lowercase();
    l.contains("unable to extract initial state") || (l.contains("[bilibili]") && l.contains("unable to extract"))
}

fn curl(args: &[&str]) -> Result<String, String> {
    let exe = crate::owned_tasks::system_tool("curl.exe").unwrap_or_else(|_| "curl".into());
    let mut cmd = std::process::Command::new(exe);
    cmd.args(["-sS", "--compressed", "--noproxy", "*", "--max-time", "20", "-A", UA, "-e", REFERER]).args(args);
    crate::commands::no_window(&mut cmd);
    let out = cmd.output().map_err(|e| format!("调用 curl 失败：{e}"))?;
    if !out.status.success() {
        return Err(format!("连接 B站失败：{}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

fn api(url: &str) -> Result<Value, String> {
    let v: Value = serde_json::from_str(&curl(&[url])?).map_err(|_| "B站接口返回内容异常，请稍后重试".to_string())?;
    let code = v["code"].as_i64().unwrap_or(-1);
    if code != 0 {
        let msg = v["message"].as_str().unwrap_or("");
        return Err(match code {
            -404 | 62002 | 62004 => "该视频不存在或已被删除".to_string(),
            -403 | 62012 => "该视频需要登录或仅部分用户可见，暂时无法解析".to_string(),
            -412 | -352 => "B站安全验证拦截了请求，请稍后再试".to_string(),
            _ => format!("B站接口报错（{code}）：{msg}"),
        });
    }
    Ok(v["data"].clone())
}

/// 从链接里取 BV 号 / av 号和分P（b23.tv 短链先跟随跳转拿到真实地址）
pub(crate) fn video_ref(url: &str) -> Result<(String, u64), String> {
    let mut real = url.to_string();
    if url::Url::parse(url).ok().and_then(|u| u.host_str().map(|h| h.to_ascii_lowercase())).map(|h| h.ends_with("b23.tv")).unwrap_or(false) {
        real = curl(&["-L", "-o", "NUL", "-w", "%{url_effective}", url])?.trim().to_string();
    }
    let page = url::Url::parse(&real).ok()
        .and_then(|u| u.query_pairs().find(|(k, _)| k == "p").and_then(|(_, v)| v.parse::<u64>().ok()))
        .unwrap_or(1).max(1);
    let path = url::Url::parse(&real).map(|u| u.path().to_string()).unwrap_or_else(|_| real.clone());
    let key = |s: &str, i: usize| -> String { s[i..].chars().take_while(|c| c.is_ascii_alphanumeric()).collect() };
    if let Some(i) = path.find("BV").or_else(|| path.find("bv")) {
        let id = key(&path, i + 2);
        if id.len() == 10 { return Ok((format!("bvid=BV{id}"), page)); }
    }
    let lower = path.to_ascii_lowercase();
    if let Some(i) = lower.find("/av") {
        let n: String = lower[i + 3..].chars().take_while(|c| c.is_ascii_digit()).collect();
        if !n.is_empty() { return Ok((format!("aid={n}"), page)); }
    }
    Err("没能从链接里识别出 B站视频编号（BV 号），请复制视频页面的完整链接".into())
}

fn codec_name(codecid: i64, codecs: &str) -> String {
    if !codecs.is_empty() { return codecs.to_string(); }
    match codecid { 12 => "hev1", 13 => "av01", _ => "avc1" }.to_string()
}

/// 生成 yt-dlp 兼容的 info JSON
pub fn build_info(url: &str) -> Result<Value, String> {
    let (id_query, page) = video_ref(url)?;
    let view = api(&format!("https://api.bilibili.com/x/web-interface/view?{id_query}"))?;
    let bvid = view["bvid"].as_str().unwrap_or("").to_string();
    let pages = view["pages"].as_array().cloned().unwrap_or_default();
    let part = pages.iter().find(|p| p["page"].as_u64() == Some(page)).or_else(|| pages.first()).cloned().unwrap_or(Value::Null);
    let cid = part["cid"].as_i64().or_else(|| view["cid"].as_i64()).ok_or("B站没有返回视频分P信息")?;
    let mut title = view["title"].as_str().unwrap_or("bilibili").to_string();
    if pages.len() > 1 {
        if let Some(name) = part["part"].as_str().filter(|s| !s.is_empty()) { title = format!("{title} P{page} {name}"); }
    }
    let duration = part["duration"].as_f64().or_else(|| view["duration"].as_f64());
    let play = api(&format!(
        "https://api.bilibili.com/x/player/playurl?bvid={bvid}&cid={cid}&qn=127&fnval=4048&fnver=0&fourk=1&try_look=1"))?;

    let headers = json!({"User-Agent": UA, "Referer": REFERER});
    let mut formats: Vec<Value> = Vec::new();
    let stream_url = |s: &Value| s["baseUrl"].as_str().or_else(|| s["base_url"].as_str()).unwrap_or("").to_string();
    if let Some(videos) = play["dash"]["video"].as_array() {
        for v in videos {
            let u = stream_url(v);
            if u.is_empty() { continue; }
            let fps = v["frameRate"].as_str().and_then(|f| f.parse::<f64>().ok());
            formats.push(json!({
                "format_id": format!("{}-{}", v["id"].as_i64().unwrap_or(0), v["codecid"].as_i64().unwrap_or(7)),
                "url": u, "ext": "mp4", "protocol": "https",
                "width": v["width"], "height": v["height"], "fps": fps,
                "vcodec": codec_name(v["codecid"].as_i64().unwrap_or(7), v["codecs"].as_str().unwrap_or("")),
                "acodec": "none", "tbr": v["bandwidth"].as_f64().map(|b| b / 1000.0),
                "http_headers": headers,
            }));
        }
    }
    let mut audios: Vec<Value> = play["dash"]["audio"].as_array().cloned().unwrap_or_default();
    if let Some(flac) = play["dash"]["flac"]["audio"].as_object() { audios.push(Value::Object(flac.clone())); }
    for a in audios {
        let u = stream_url(&a);
        if u.is_empty() { continue; }
        formats.push(json!({
            "format_id": format!("a{}", a["id"].as_i64().unwrap_or(0)),
            "url": u, "ext": "m4a", "protocol": "https",
            "vcodec": "none", "acodec": a["codecs"].as_str().filter(|s| !s.is_empty()).unwrap_or("mp4a.40.2"),
            "abr": a["bandwidth"].as_f64().map(|b| b / 1000.0), "tbr": a["bandwidth"].as_f64().map(|b| b / 1000.0),
            "http_headers": headers,
        }));
    }
    // 老视频可能只有整段 flv/mp4（durl）
    if formats.is_empty() {
        if let Some(d) = play["durl"].as_array().and_then(|d| d.first()) {
            let q = play["quality"].as_i64().unwrap_or(0);
            let height = match q { 127 => 4320, 126 | 125 | 120 => 2160, 116 | 112 | 80 => 1080, 74 | 64 => 720, 32 => 480, _ => 360 };
            formats.push(json!({"format_id": format!("{q}"), "url": d["url"], "ext": play["format"].as_str().map(|f| if f.contains("mp4") { "mp4" } else { "flv" }).unwrap_or("flv"),
                "height": height, "http_headers": headers}));
        }
    }
    if formats.is_empty() { return Err("B站没有返回可下载的视频流（可能是付费 / 会员专享内容）".into()); }
    let pic = view["pic"].as_str().unwrap_or("").replacen("http://", "https://", 1);
    let id = if pages.len() > 1 { format!("{bvid}_p{page}") } else { bvid.clone() };
    let mut webpage = format!("https://www.bilibili.com/video/{bvid}/");
    if pages.len() > 1 { webpage.push_str(&format!("?p={page}")); }
    Ok(json!({
        "_type": "video", "id": id, "title": title, "fulltitle": title,
        "extractor": "BiliBili", "extractor_key": "BiliBili",
        "webpage_url": webpage, "original_url": url, "webpage_url_basename": bvid, "webpage_url_domain": "bilibili.com",
        "duration": duration, "thumbnail": if pic.is_empty() { Value::Null } else { json!(pic) },
        "thumbnails": if pic.is_empty() { json!([]) } else { json!([{"url": pic, "id": "0"}]) },
        "uploader": view["owner"]["name"], "uploader_id": view["owner"]["mid"].as_i64().map(|m| m.to_string()),
        "description": view["desc"], "timestamp": view["pubdate"],
        "formats": formats, "http_headers": headers,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn detects_hosts() {
        assert!(is_bilibili("https://b23.tv/2rjxeW7"));
        assert!(is_bilibili("https://m.bilibili.com/video/BV1UbpP6EELq"));
        assert!(!is_bilibili("https://notbilibili.com/x"));
    }
    #[test] fn reads_story_url() {
        let (q, p) = video_ref("https://www.bilibili.com/video/BV1UbpP6EELq?-Arouter=story&is_story_h5=true&p=2&share_medium=android").unwrap();
        assert_eq!(q, "bvid=BV1UbpP6EELq"); assert_eq!(p, 2);
        assert_eq!(video_ref("https://www.bilibili.com/video/av170001/").unwrap().0, "aid=170001");
    }
    #[test] fn detects_broken_extractor() {
        assert!(ytdlp_extractor_broken("ERROR: [BiliBili] 1UbpP6EELq: Unable to extract initial state; please report"));
        assert!(!ytdlp_extractor_broken("ERROR: HTTP Error 404"));
    }
}
