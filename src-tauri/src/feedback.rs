// 意见反馈 与 作者回复（对应原版 apps/web/src/app/api/feedback/route.ts）
//
// ── 用户提交 ──────────────────────────────────────────────────────────────
// 原版是"无感推送"：POST 到 ntfy.sh 的频道 `furinakit_feedback_hq`，作者手机/电脑上订阅这个频道
// 就能实时看到；同时在本机留一份底（最近 200 条）。
// 这里**保持同一套做法**（作者现成的「抓取留言.mjs → 留言归档」流程一行都不用改）。
//
// ★ 新增：把 ntfy 返回的**消息 id 当配对码回给用户**（例如 hDgTtSFU9fzx）。
//   作者在留言里看到的 id 就是这个，于是"回复"就有了天然的对钥匙 —— 见下面 replies()。
//
// ── 作者回复 ──────────────────────────────────────────────────────────────
// 作者把回复写进 `replies.json` 放到他已有的 GitHub 仓库 `furinakit/releases`（更新检测用的
// 就是同一个仓库），应用从 jsDelivr / raw.githubusercontent 取回（多个镜像依次重试，与
// lib/version.ts 里版本检查的做法一致）。
//
//   replies.json 格式：
//   {
//     "updatedAt": "2026-09-15T10:00:00Z",
//     "replies": {
//       "hDgTtSFU9fzx": { "text": "这个想法很好，已经排进计划啦！", "status": "已采纳", "at": "2026-09-15" }
//     }
//   }
//
// 生成这个文件的工具：`E:\FurinaKit-Tauri\_author\回复编辑器.html`（把留言归档文件拖进去、
// 逐条写回复、点导出即可）。

use std::path::PathBuf;

use serde_json::{json, Value};
use tauri::Manager;

/// ntfy 频道名（与原版一致，作者那边订阅的就是它）
const NTFY_TOPIC: &str = "furinakit_feedback_hq";

/// 回复文件的镜像 —— **顺序是按"无代理直连能否通"实测排的**（见 _verify/net_reach.py）：
///   jsDelivr 通 ✓ ｜ ghfast.top 通 ✓ ｜ raw.githubusercontent 这台机器通、用户那边通常不通 ｜
///   ghproxy.net 已实测超时，放最后当兜底。
/// 用户绝大多数没有代理，所以这里的顺序很关键。
const REPLY_MIRRORS: [&str; 5] = [
    "https://cdn.jsdelivr.net/gh/furinakit/releases@main/replies.json",
    "https://ghfast.top/https://raw.githubusercontent.com/furinakit/releases/main/replies.json",
    "https://raw.githubusercontent.com/furinakit/releases/main/replies.json",
    "https://cdn.jsdelivr.net/gh/FUFU-eng/FurinaKit@main/replies.json",
    "https://ghproxy.net/https://raw.githubusercontent.com/furinakit/releases/main/replies.json",
];

/// 回复文件缓存：作者不会每分钟改一次，而用户可能会连着点几次「查询」。
/// 缓存 3 分钟，省掉重复的网络往返（也避免查询按钮转圈太久）。
static REPLIES_CACHE: std::sync::Mutex<Option<(std::time::Instant, String)>> =
    std::sync::Mutex::new(None);

/// 用系统 curl 发一个 POST（body 走临时文件，避免中文经命令行传递被编码搞坏）
fn curl_post(url: &str, content_type: &str, body: &[u8]) -> Result<String, String> {
    let tmp = std::env::temp_dir().join(format!("furinakit-post-{}.bin", crate::jobs::new_job_id_public()));
    std::fs::write(&tmp, body).map_err(|e| format!("写临时文件失败：{e}"))?;
    let mut cmd = std::process::Command::new("curl");
    cmd.args([
        "-f",
        "-sS",
        "-X",
        "POST",
        "-H",
        &format!("Content-Type: {content_type}"),
        "--data-binary",
        &format!("@{}", tmp.to_string_lossy()),
        "--max-time",
        "30",
        url,
    ]);
    crate::commands::no_window(&mut cmd);
    let out = cmd.output();
    let _ = std::fs::remove_file(&tmp);
    let out = out.map_err(|e| format!("调用 curl 失败：{e}"))?;
    if !out.status.success() {
        return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
    }
    Ok(String::from_utf8_lossy(&out.stdout).to_string())
}

/// 用系统 curl 取一个 URL 的文本。
/// 取不到时**再用系统代理试一次** —— 这两个镜像站在国内有时直连会被重置。
fn curl_get(url: &str) -> Result<String, String> {
    let try_once = |proxy: Option<&str>| -> Result<String, String> {
        let mut cmd = std::process::Command::new("curl");
        cmd.args(["-sS", "-L", "--max-time", "20"]);
        if let Some(p) = proxy {
            cmd.args(["--proxy", p]);
        }
        cmd.arg(url);
        crate::commands::no_window(&mut cmd);
        let out = cmd.output().map_err(|e| format!("调用 curl 失败：{e}"))?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    };

    match try_once(None) {
        Ok(s) => Ok(s),
        Err(first) => match crate::video::system_proxy(url) {
            Some(p) => try_once(Some(&p)).map_err(|_| first),
            None => Err(first),
        },
    }
}

fn feedback_file(app: &tauri::AppHandle) -> PathBuf {
    crate::jobs::storage_dir_of(app).join("feedback_history.json")
}

/// Unix 秒 → 北京时间字符串（作者与用户都在国内，统一按 UTC+8 显示）
fn fmt_datetime_cn(secs: u64) -> String {
    let secs = secs + 8 * 3600;
    let mut d = (secs / 86400) as i64;
    let rem = secs % 86400;
    let (h, mi, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let mut y = 1970i64;
    loop {
        let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
        let dy = if leap { 366 } else { 365 };
        if d >= dy {
            d -= dy;
            y += 1;
        } else {
            break;
        }
    }
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let mdays = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut m = 0usize;
    while m < 12 && d >= mdays[m] {
        d -= mdays[m];
        m += 1;
    }
    format!("{y}/{month:02}/{day:02} {h:02}:{mi:02}:{s:02}", month = m + 1, day = d + 1)
}

/// 提交反馈：推 ntfy + 本地留底；返回给用户一个"查询码"（就是 ntfy 的消息 id）
pub fn submit(app: &tauri::AppHandle, body: &Value) -> Result<Value, String> {
    let content = body.get("content").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    if content.is_empty() {
        return Err("反馈内容不能为空".into());
    }
    let category = body.get("category").and_then(|v| v.as_str()).unwrap_or("功能建议").to_string();
    let contact = body.get("contact").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    let version = body.get("version").and_then(|v| v.as_str()).unwrap_or("").to_string();
    let os = body.get("os").and_then(|v| v.as_str()).unwrap_or("Windows").to_string();

    let incoming=body.get("__files").and_then(Value::as_array).cloned().unwrap_or_default();
    if incoming.len()>4{return Err("反馈最多附加4张图片".into());}
    let batch=crate::jobs::new_job_id_public();
    let folder=crate::jobs::storage_dir_of(app).join("feedback-attachments").join(&batch);
    let mut attachments:Vec<Value>=Vec::new();
    let mut claimed=Vec::new();
    let prepared=(||->Result<(),String>{
    for (index,file) in incoming.iter().enumerate(){
        let token=file["uploadToken"].as_str().ok_or("图片缺少上传令牌")?;
        let saved=crate::upload_stream::claim(app,token,&batch,"image")?;
        let source=PathBuf::from(saved["path"].as_str().ok_or("无法接收反馈图片")?);
        claimed.push(source.clone());
        if saved["size"].as_u64().unwrap_or(u64::MAX)>4*1024*1024 {let _=std::fs::remove_file(&source);return Err("反馈图片每张不能超过4 MiB".into());}
        let bytes=std::fs::read(&source).map_err(|e|e.to_string())?;
        let format=image::guess_format(&bytes).map_err(|_|"反馈附件必须是有效图片")?;
        if !matches!(format,image::ImageFormat::Png|image::ImageFormat::Jpeg|image::ImageFormat::WebP){return Err("反馈支持PNG、JPEG或WEBP图片".into());}
        let ext=match format{image::ImageFormat::Png=>"png",image::ImageFormat::WebP=>"webp",_=>"jpg"};
        std::fs::create_dir_all(&folder).map_err(|e|e.to_string())?;
        let name=format!("feedback-{}.{}",index+1,ext);let target=folder.join(&name);
        std::fs::rename(&source,&target).map_err(|e|e.to_string())?;
        attachments.push(json!({"name":name,"path":target.to_string_lossy(),"mime":format!("image/{}",if ext=="jpg"{"jpeg"}else{ext})}));
    }
    Ok(())})();
    if let Err(error)=prepared { for source in claimed { let _=std::fs::remove_file(source); } let _=std::fs::remove_dir_all(&folder);return Err(error); }
    let now_local = {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        fmt_datetime_cn(now)
    };

    // ① 推到 ntfy（用 JSON 发布接口：中文全部走请求体，不经命令行，编码不会被搞坏）
    let message = format!(
        "{content}\n\n━━━━━━━━━━━━━━━\n🏷️ 类别: {category}\n📱 联系方式: {}\n💻 环境: {os} | 版本: v{version}\n⏰ 时间: {now_local}",
        if contact.is_empty() { "未填写".to_string() } else { contact.clone() }
    );
    let payload = json!({
        "topic": NTFY_TOPIC,
        "title": format!("【芙芙工具箱】[{category}] 新建议到达"),
        "message": message,
        "tags": ["sparkles", "speech_balloon"],
        "priority": 3,
        "cache": "yes",
    });

    let mut message_id = String::new();
    let mut push_error = String::new();
    match curl_post("https://ntfy.sh/", "application/json", payload.to_string().as_bytes()) {
        Ok(resp) => {
            if let Ok(v) = serde_json::from_str::<Value>(&resp) {
                message_id = v.get("id").and_then(|x| x.as_str()).unwrap_or("").to_string();
            }
        }
        Err(e) => push_error = e,
    }

    let mut attachment_errors:Vec<String>=Vec::new();
    if !message_id.is_empty(){
        for (index,attachment) in attachments.iter_mut().enumerate(){
            let send=(||->Result<Value,String>{
                let bytes=std::fs::read(attachment["path"].as_str().ok_or("图片留底失败")?).map_err(|e|e.to_string())?;
                let mut url=url::Url::parse(&format!("https://ntfy.sh/{NTFY_TOPIC}")).map_err(|e|e.to_string())?;
                url.query_pairs_mut().append_pair("filename",attachment["name"].as_str().unwrap_or("feedback.jpg")).append_pair("title",&format!("Feedback {message_id} image {}",index+1));
                let response=curl_post(url.as_str(),attachment["mime"].as_str().unwrap_or("image/jpeg"),&bytes)?;
                let value:Value=serde_json::from_str(&response).map_err(|e|e.to_string())?;
                if value["attachment"]["url"].as_str().is_none(){return Err("服务未确认图片附件".into());}Ok(value)
            })();
            match send{Ok(value)=>attachment["remoteUrl"]=value["attachment"]["url"].clone(),Err(error)=>{attachment["error"]=json!(error);attachment_errors.push(format!("第{}张图片：{}",index+1,error));}}
        }
    }
    // ② 本地留底（最近 200 条）—— 推送失败也要留底，作者不至于完全收不到
    static HISTORY_LOCK:std::sync::Mutex<()>=std::sync::Mutex::new(());
    let _history=HISTORY_LOCK.lock().unwrap_or_else(|e|e.into_inner());
    let file = feedback_file(app);
    let mut history: Vec<Value> = std::fs::read_to_string(&file)
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<Value>>(&s).ok())
        .unwrap_or_default();
    history.insert(
        0,
        json!({
            "content": content, "category": category, "contact": contact,
            "version": version, "os": os, "timestamp": now_local,
            "code": message_id, "attachments":attachments,
        }),
    );
    history.truncate(200);
    let backup_error=serde_json::to_vec_pretty(&history).map_err(|e|e.to_string()).and_then(|bytes|crate::atomic_store::write(&file,&bytes)).err();

    if message_id.is_empty() {
        if push_error.is_empty(){push_error="反馈服务未确认收到，请稍后重试".into();}
        // 没拿到 id 通常是网络问题 —— 明确告诉用户，别让他以为一切正常
        return Err(format!("{}；尚未收到反馈服务回执：{push_error}。请检查后再操作，避免重复提交。",if backup_error.is_none(){"建议已在本机留底".to_string()}else{format!("本地历史也未能保存：{}",backup_error.as_deref().unwrap_or("未知错误"))}));
    }

    Ok(json!({
        "success": true,
        "message": "芙芙已经收到你的宝贵建议啦！会认真评估并持续努力的~",
        "code": message_id,
        "localBackupError":backup_error,
        "attachmentErrors":attachment_errors,
        "attachmentCount":attachments.len(),
    }))
}

/// ntfy 专属频道名：作者的监控页把回复发到这里（topic 里带查询码，别人看不到别人的回复）
fn reply_topic(code: &str) -> String {
    // 查询码只允许字母数字与短横，防止有人塞奇怪的东西进 URL
    let safe: String = code
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || *c == '-' || *c == '_')
        .take(64)
        .collect();
    format!("furinakit_reply_{safe}")
}

/// 从 ntfy 读这个查询码的回复（返回最后一条）
fn reply_from_ntfy(code: &str) -> Option<Value> {
    let topic = reply_topic(code);
    let url = format!("https://ntfy.sh/{topic}/json?poll=1&since=all");
    let text = curl_get(&url).ok()?;
    // ntfy 返回的是一行一个 JSON 对象
    let mut last: Option<Value> = None;
    for line in text.lines() {
        let line = line.trim();
        if !line.starts_with('{') {
            continue;
        }
        let Ok(v) = serde_json::from_str::<Value>(line) else { continue };
        if v.get("event").and_then(|e| e.as_str()) != Some("message") {
            continue;
        }
        last = Some(v);
    }
    let v = last?;
    let body = v.get("message").and_then(|m| m.as_str()).unwrap_or("").to_string();
    if body.trim().is_empty() {
        return None;
    }
    let status = v.get("title").and_then(|m| m.as_str()).unwrap_or("").to_string();
    let at = v
        .get("time")
        .and_then(|t| t.as_i64())
        .map(|t| fmt_datetime_cn(t.max(0) as u64))
        .unwrap_or_default();
    Some(json!({
        "success": true, "found": true, "code": code,
        "text": body,
        "status": status,
        "at": at,
        "source": "ntfy",
    }))
}

/// 本机反馈历史（作者本机排查时用）
pub fn history(app: &tauri::AppHandle) -> Value {
    let list: Vec<Value> = std::fs::read_to_string(feedback_file(app))
        .ok()
        .and_then(|s| serde_json::from_str::<Vec<Value>>(&s).ok())
        .unwrap_or_default();
    json!({ "success": true, "history": list })
}

/// 查一条回复。三个来源，按"新鲜度"依次找：
///   ① 本机 replies.json（作者调试/预览用）
///   ② **ntfy 的专属回复频道** `furinakit_reply_<查询码>` —— 作者在监控页点一下"回复"就发到这里，
///      用户那边几乎立刻能查到（这是最方便的一条路，作者不用碰 GitHub）
///   ③ replies.json 镜像（jsDelivr 等）—— **长期保存**用，因为 ntfy 的缓存默认只留 12 小时
pub fn replies(app: &tauri::AppHandle, code: &str) -> Result<Value, String> {
    let code = code.trim();
    if code.is_empty() {
        return Err("请先填写查询码".into());
    }

    // ② 先看 ntfy 专属频道
    if let Some(v) = reply_from_ntfy(code) {
        return Ok(v);
    }

    // ① 本机优先：作者把 replies.json 放在**程序根目录或 exe 旁边**即可就地调试/预览
    let mut raw_opt: Option<String> = None;
    let mut local_candidates = vec![crate::app_root_of(app).join("replies.json")];
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            local_candidates.push(dir.join("replies.json"));
        }
    }
    for p in local_candidates {
        if p.is_file() {
            if let Ok(s) = std::fs::read_to_string(&p) {
                raw_opt = Some(s);
                break;
            }
        }
    }

    let mut last_err = String::new();
    if raw_opt.is_none() {
        // 内存缓存（3 分钟）
        if let Ok(guard) = REPLIES_CACHE.lock() {
            if let Some((at, text)) = guard.as_ref() {
                if at.elapsed() < std::time::Duration::from_secs(180) {
                    raw_opt = Some(text.clone());
                }
            }
        }
    }
    if raw_opt.is_none() {
        for url in REPLY_MIRRORS {
            match curl_get(url) {
                Ok(s) if s.trim_start().starts_with('{') => {
                    if let Ok(mut guard) = REPLIES_CACHE.lock() {
                        *guard = Some((std::time::Instant::now(), s.clone()));
                    }
                    raw_opt = Some(s);
                    break;
                }
                Ok(_) => last_err = "作者还没有发布回复文件".into(),
                Err(e) => last_err = format!("取回复文件失败（网络问题）：{e}"),
            }
        }
    }

    let Some(raw) = raw_opt else {
        return Ok(json!({
            "success": true, "found": false,
            "note": if last_err.is_empty() { "暂时读不到回复文件".to_string() } else { last_err },
        }));
    };
    let v: Value = serde_json::from_str(&raw).map_err(|e| format!("回复文件格式不对：{e}"))?;
    let entry = v.get("replies").and_then(|r| r.get(code)).cloned();
    match entry {
        Some(e) => Ok(json!({
            "success": true, "found": true, "code": code,
            "text": e.get("text").and_then(|x| x.as_str()).unwrap_or(""),
            "status": e.get("status").and_then(|x| x.as_str()).unwrap_or(""),
            "at": e.get("at").and_then(|x| x.as_str()).unwrap_or(""),
            "updatedAt": v.get("updatedAt").and_then(|x| x.as_str()).unwrap_or(""),
        })),
        None => Ok(json!({
            "success": true, "found": false,
            "note": "作者还没有回复这条留言（也可能还没更新回复文件）",
            "updatedAt": v.get("updatedAt").and_then(|x| x.as_str()).unwrap_or(""),
        })),
    }
}
