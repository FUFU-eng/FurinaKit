// 跨设备互传的**局域网服务**（手机端要连的就是它）
//
// ── 为什么需要 ────────────────────────────────────────────────────────────
// 互传的"手机→电脑"部分，手机得能访问电脑上的一个网页。原版是 Next 自带的服务
// （3001 端口）；Tauri 版没有 HTTP 服务，所以之前二维码里的地址是打不开的。
// 这个文件就是那个服务：极简的 HTTP/1.1 实现，**不引任何第三方依赖**。
//
// ── 安全 ──────────────────────────────────────────────────────────────────
// 服务监听在局域网上（0.0.0.0），所以每个请求都必须带配对码 `t=<token>`
// （就是二维码里那串，只有本机界面能看到）。没带或不对一律拒绝 ——
// 这样即使同网段有别的人扫到端口，也读不到、更写不进任何文件。
//
// ── 接口 ──────────────────────────────────────────────────────────────────
//   GET  /portal/transfer?t=…                     手机端页面
//   GET  /api/transfer?action=state&t=…           状态（共享文件列表 + 电脑剪贴板）
//   GET  /api/transfer?action=download&id=…&t=…   下载电脑共享的文件
//   POST /api/transfer?action=upload&name=…&t=…   手机上传文件（请求体就是文件字节）
//   POST /api/transfer?action=clipboard&t=…       把手机上的一段文本发到电脑剪贴板
//
// 上传没用 multipart：请求体直接就是文件字节，文件名放在查询串里 ——
// 我们自己写的手机页面配合这个约定即可，省掉一大坨 multipart 解析（也少一堆出错点）。

use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};
use std::sync::OnceLock;
use std::time::Duration;

use serde_json::{json, Value};
use tauri::Manager;

/// 服务实际监听的端口（二维码里显示的就是它）
static ACTUAL_PORT: OnceLock<u16> = OnceLock::new();

/// 首选端口：与原版一致
const PREFERRED_PORT: u16 = 3001;

pub fn port() -> u16 {
    *ACTUAL_PORT.get().unwrap_or(&PREFERRED_PORT)
}

/// 请求体上限（暂定 2GB，与原版"上传不限大小"的取向一致，但要防止无限流）
const MAX_BODY: u64 = 2 * 1024 * 1024 * 1024;

/// 起服务（在 setup 里调一次）。返回实际端口。
pub fn start(app: tauri::AppHandle) -> Result<u16, String> {
    // 先确保有一个配对码（二维码里带的就是它）
    ensure_token(&app);

    let listener = TcpListener::bind(("0.0.0.0", PREFERRED_PORT))
        .or_else(|_| TcpListener::bind(("0.0.0.0", 0)))
        .map_err(|e| format!("监听端口失败：{e}"))?;
    let port = listener
        .local_addr()
        .map_err(|e| e.to_string())?
        .port();
    let _ = ACTUAL_PORT.set(port);

    std::thread::spawn(move || {
        for stream in listener.incoming() {
            match stream {
                Ok(s) => {
                    let a = app.clone();
                    // 每个请求一个线程：手机一次会并发几个请求（页面 + 轮询 + 上传）
                    std::thread::spawn(move || {
                        let _ = handle(s, &a);
                    });
                }
                Err(_) => continue,
            }
        }
    });

    println!("[FurinaKit] 互传服务已监听 0.0.0.0:{port}");
    Ok(port)
}

/// 配对码：没有就生成一个 6 位数并落盘（与 /api/lan-token 用的是同一个设置项）
fn ensure_token(app: &tauri::AppHandle) -> String {
    let mut st = crate::api::read_settings_public(app);
    if let Some(t) = st.get("lanToken").and_then(|v| v.as_str()) {
        if !t.is_empty() {
            return t.to_string();
        }
    }
    let t = crate::api::new_lan_token();
    st["lanToken"] = json!(t);
    let _ = crate::api::write_settings_public(app, &st);
    t
}

fn current_token(app: &tauri::AppHandle) -> String {
    crate::api::read_settings_public(app)
        .get("lanToken")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

// ── 极简 HTTP ──────────────────────────────────────────────────────────

struct Request {
    method: String,
    path: String,
    query: Vec<(String, String)>,
    content_length: usize,
}

impl Request {
    fn arg(&self, key: &str) -> String {
        self.query
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.clone())
            .unwrap_or_default()
    }
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hex = std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or("");
                match u8::from_str_radix(hex, 16) {
                    Ok(b) => {
                        out.push(b);
                        i += 3;
                    }
                    Err(_) => {
                        out.push(bytes[i]);
                        i += 1;
                    }
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

fn send_response(
    stream: &mut TcpStream,
    status: u16,
    reason: &str,
    content_type: &str,
    body: &[u8],
    extra_headers: &[(&str, String)],
) -> std::io::Result<()> {
    let mut head = format!(
        "HTTP/1.1 {status} {reason}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\n\
         Cache-Control: no-store\r\nConnection: close\r\n",
        body.len()
    );
    for (k, v) in extra_headers {
        head.push_str(&format!("{k}: {v}\r\n"));
    }
    head.push_str("\r\n");
    stream.write_all(head.as_bytes())?;
    stream.write_all(body)?;
    stream.flush()
}

/// Open and validate before sending HTTP 200. Never turn a read failure into
/// a successful empty download; stream with a fixed-size buffer.
fn send_file(stream: &mut TcpStream, path: &std::path::Path, name: &str) -> std::io::Result<()> {
    let opened = std::fs::File::open(path).and_then(|file| {
        let meta = file.metadata()?;
        if !meta.is_file() { return Err(std::io::Error::new(std::io::ErrorKind::InvalidInput, "不是普通文件")); }
        Ok((file, meta.len()))
    });
    let (mut file, length) = match opened {
        Ok(value) => value,
        Err(_) => return send_json(stream, 404, "Not Found", json!({"success": false, "error": "文件不可用，未开始下载"})),
    };
    let mime = crate::transfer::mime_of_public(name);
    let head = format!("HTTP/1.1 200 OK\r\nContent-Type: {mime}\r\nContent-Length: {length}\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Disposition: attachment; filename*=UTF-8''{}\r\n\r\n", urlencode(name));
    stream.write_all(head.as_bytes())?;
    crate::transfer::copy_exact(&mut file, stream, length)?;
    stream.flush()
}

fn send_json(stream: &mut TcpStream, status: u16, reason: &str, v: Value) -> std::io::Result<()> {
    send_response(
        stream,
        status,
        reason,
        "application/json; charset=utf-8",
        v.to_string().as_bytes(),
        &[],
    )
}

fn handle(mut stream: TcpStream, app: &tauri::AppHandle) -> std::io::Result<()> {
    let _ = stream.set_read_timeout(Some(Duration::from_secs(120)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(120)));

    let mut reader = BufReader::new(stream.try_clone()?);

    // 请求行
    let mut line = String::new();
    if reader.read_line(&mut line)? == 0 {
        return Ok(());
    }
    let mut parts = line.trim().split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let target = parts.next().unwrap_or("/").to_string();

    // 头（W12 加固：设置最大头部行数与单行安全上限，防范慢连接与超长头耗尽资源）
    use std::io::Read;
    let mut content_length = 0usize;
    let mut header_lines = 0;
    loop {
        header_lines += 1;
        if header_lines > 64 {
            let _ = send_json(&mut stream, 431, "Request Header Fields Too Large", json!({ "error": "请求头过多" }));
            return Ok(());
        }
        let mut h = String::new();
        if reader.by_ref().take(4096).read_line(&mut h)? == 0 {
            break;
        }
        let h = h.trim();
        if h.is_empty() {
            break;
        }
        if let Some((k, v)) = h.split_once(':') {
            if k.eq_ignore_ascii_case("content-length") {
                content_length = v.trim().parse().unwrap_or(0);
            }
        }
    }
    if content_length as u64 > MAX_BODY {
        let _ = send_json(&mut stream, 413, "Payload Too Large", json!({ "error": "请求体超出允许大小限制" }));
        return Ok(());
    }

    // 拆路径与查询串
    let (path, query_str) = match target.split_once('?') {
        Some((p, q)) => (p.to_string(), q.to_string()),
        None => (target.clone(), String::new()),
    };
    let mut query = Vec::new();
    for pair in query_str.split('&').filter(|s| !s.is_empty()) {
        let (k, v) = pair.split_once('=').unwrap_or((pair, ""));
        query.push((percent_decode(k), percent_decode(v)));
    }

    let req = Request { method: method.clone(), path: path.clone(), query, content_length };

    // ── 配对码校验（页面本身也校验，避免同网段的人随便打开）──
    let token = current_token(app);
    let given = req.arg("t");
    if given != token || token.is_empty() {
        return send_json(&mut stream, 403, "Forbidden", json!({ "success": false, "error": "token" }));
    }

    // ── 路由 ──
    if req.path == "/portal/transfer" {
        let html = include_str!("portal_transfer.html");
        return send_response(&mut stream, 200, "OK", "text/html; charset=utf-8", html.as_bytes(), &[]);
    }

    if req.path == "/api/transfer" {
        let action = req.arg("action");
        // 没有 action 的 GET 也当成读状态（兼容写法）
        let action = if action.is_empty() && req.method == "GET" { "state".to_string() } else { action };

        match action.as_str() {
            "state" => {
                let meta = match crate::transfer::load_meta_public(app) {
                    Ok(meta) => meta,
                    Err(e) => return send_json(&mut stream, 500, "Internal Server Error", json!({"success": false, "error": e})),
                };
                return send_json(
                    &mut stream,
                    200,
                    "OK",
                    json!({
                        "success": true,
                        "sharedFiles": meta.get("sharedFiles").cloned().unwrap_or(json!([])),
                        // 手机自己传过的文件也回给它（页面暂不使用，便于以后做"我刚传了什么"）
                        "receivedFiles": meta.get("receivedFiles").cloned().unwrap_or(json!([])),
                        "clipboardText": meta.get("clipboardText").cloned().unwrap_or(json!("")),
                        "port": port(),
                    }),
                );
            }

            "download" => {
                let id = req.arg("id");
                let kind = {
                    let k = req.arg("type");
                    if k.is_empty() { "shared".to_string() } else { k }
                };
                match crate::transfer::artifact_path(app, &id, &kind) {
                    Some((p, name)) => {
                        return send_file(&mut stream, &p, &name);
                    }
                    None => {
                        return send_json(&mut stream, 404, "Not Found", json!({ "success": false, "error": "找不到这个文件" }))
                    }
                }
            }

            "upload" => {
                if req.content_length as u64 > MAX_BODY {
                    return send_json(&mut stream, 413, "Payload Too Large", json!({ "success": false, "error": "文件太大" }));
                }
                let name = {
                    let n = req.arg("name");
                    if n.is_empty() { "手机传的文件".to_string() } else { n }
                };
                match crate::transfer::receive_stream(app, &name, &mut reader, req.content_length as u64) {
                    Ok(saved) => {
                        return send_json(&mut stream, 200, "OK", json!({ "success": true, "name": saved }));
                    }
                    Err(e) => {
                        return send_json(&mut stream, 500, "Internal Server Error", json!({ "success": false, "error": e }));
                    }
                }
            }

            // 手机发一段文字到电脑剪贴板
            "clipboard" => {
                if req.content_length > 1024 * 1024 {
                    return send_json(&mut stream, 413, "Payload Too Large", json!({"success": false, "error": "文本超过 1 MiB 限制"}));
                }
                let mut body = vec![0u8; req.content_length];
                if req.content_length > 0 {
                    reader.read_exact(&mut body)?;
                }
                let text = String::from_utf8_lossy(&body).to_string();
                // Both failures must be reported; never return success after ignored I/O.
                {
                    use tauri_plugin_clipboard_manager::ClipboardExt;
                    if let Err(e) = app.clipboard().write_text(text.clone()) {
                        return send_json(&mut stream, 500, "Internal Server Error", json!({"success": false, "error": format!("写入剪贴板失败：{e}")}));
                    }
                }
                match crate::transfer::action(app, "clipboard", &json!({"text": text}), &[]) {
                    Ok(result) => return send_json(&mut stream, 200, "OK", result),
                    Err(e) => return send_json(&mut stream, 500, "Internal Server Error", json!({"success": false, "error": format!("系统剪贴板已更新，但保存互传记录失败：{e}")})),
                }
            }

            other => {
                return send_json(&mut stream, 400, "Bad Request", json!({ "success": false, "error": format!("不支持的操作：{other}") }))
            }
        }
    }

    send_json(&mut stream, 404, "Not Found", json!({ "success": false, "error": "not found" }))
}

/// 给 Content-Disposition 用的最小百分号编码（中文文件名必须编码）
fn urlencode(s: &str) -> String {
    let mut out = String::new();
    for b in s.as_bytes() {
        match *b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => out.push(*b as char),
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

/// 供界面显示：当前服务地址（局域网 IP + 端口）
pub fn share_port() -> u16 {
    port()
}
#[cfg(test)]
mod tests {
    use super::*;
    fn roundtrip(path: std::path::PathBuf, name: String) -> Vec<u8> {
        let listener=TcpListener::bind("127.0.0.1:0").unwrap();let address=listener.local_addr().unwrap();
        let server=std::thread::spawn(move || {let (mut socket,_)=listener.accept().unwrap();send_file(&mut socket,&path,&name).unwrap();});
        let mut client=TcpStream::connect(address).unwrap();client.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
        let mut bytes=Vec::new();client.read_to_end(&mut bytes).unwrap();server.join().unwrap();bytes
    }
    #[test]
    fn file_download_streams_real_bytes_with_exact_length() {
        let root=std::env::temp_dir().join(format!("fk-lan-v45-{}",crate::jobs::new_job_id_public()));std::fs::create_dir(&root).unwrap();
        let path=root.join("public.bin");let data:Vec<u8>=(0..(3*1024*1024+17)).map(|i|(i%251)as u8).collect();std::fs::write(&path,&data).unwrap();
        let raw=roundtrip(path,"公开.bin".into());let boundary=raw.windows(4).position(|w|w==b"\r\n\r\n").unwrap()+4;
        let head=String::from_utf8_lossy(&raw[..boundary]);assert!(head.starts_with("HTTP/1.1 200 OK"));assert!(head.contains(&format!("Content-Length: {}",data.len())));assert!(head.contains("%E5%85%AC%E5%BC%80.bin"));
        assert_eq!(&raw[boundary..],data.as_slice());std::fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn missing_file_does_not_return_successful_empty_download() {
        let root=std::env::temp_dir().join(format!("fk-lan-v45-{}",crate::jobs::new_job_id_public()));std::fs::create_dir(&root).unwrap();
        let raw=roundtrip(root.join("missing.bin"),"missing.bin".into());assert!(raw.starts_with(b"HTTP/1.1 404 Not Found"));std::fs::remove_dir_all(root).unwrap();
    }
}
