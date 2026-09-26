//! Local end-to-end test bridge. OFF unless the process is started with the
//! environment variable `FURINAKIT_TEST_BRIDGE=<secret>`; normal users never have it.
//! Binds 127.0.0.1 only and every request must carry `x-t: <secret>`.
//!
//!   POST /upload?name=<file name>   body = raw file bytes  -> {"token": "..."}
//!   POST /api                       body = {"path","method","args"} -> {"ok":true,"data":..}
//!
//! It drives exactly the same `api_call` the WebView uses, so a scripted run exercises
//! the real tool code paths (uploads, jobs, native engines) without clicking the UI.
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{TcpListener, TcpStream};

use serde_json::{json, Value};

const PORT: u16 = 39517;

pub fn start(app: tauri::AppHandle, secret: String) {
    if secret.len() < 16 {
        eprintln!("[FurinaKit] test bridge secret too short; bridge disabled");
        return;
    }
    std::thread::spawn(move || {
        let listener = match TcpListener::bind(("127.0.0.1", PORT)) {
            Ok(l) => l,
            Err(e) => {
                eprintln!("[FurinaKit] test bridge bind failed: {e}");
                return;
            }
        };
        println!("[FurinaKit] test bridge on 127.0.0.1:{PORT}");
        for stream in listener.incoming().flatten() {
            let app = app.clone();
            let secret = secret.clone();
            std::thread::spawn(move || {
                let _ = handle(stream, &app, &secret);
            });
        }
    });
}

fn b64(bytes: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for c in bytes.chunks(3) {
        let n = (c[0] as u32) << 16 | (*c.get(1).unwrap_or(&0) as u32) << 8 | *c.get(2).unwrap_or(&0) as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        out.push(if c.len() > 1 { T[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if c.len() > 2 { T[n as usize & 63] as char } else { '=' });
    }
    out
}

fn pct_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(if b[i] == b'+' { b' ' } else { b[i] });
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn reply(stream: &mut TcpStream, code: u16, body: &Value) -> std::io::Result<()> {
    let text = body.to_string();
    write!(
        stream,
        "HTTP/1.1 {code} X\r\nContent-Type: application/json; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        text.len()
    )?;
    stream.write_all(text.as_bytes())
}

fn handle(mut stream: TcpStream, app: &tauri::AppHandle, secret: &str) -> std::io::Result<()> {
    let mut reader = BufReader::new(stream.try_clone()?);
    let mut line = String::new();
    reader.read_line(&mut line)?;
    let mut parts = line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let target = parts.next().unwrap_or("").to_string();
    let mut len = 0usize;
    let mut token_ok = false;
    loop {
        let mut h = String::new();
        if reader.read_line(&mut h)? == 0 || h == "\r\n" || h == "\n" {
            break;
        }
        let lower = h.to_ascii_lowercase();
        if let Some(v) = lower.strip_prefix("content-length:") {
            len = v.trim().parse().unwrap_or(0);
        }
        if let Some((k, v)) = h.split_once(':') {
            if k.trim().eq_ignore_ascii_case("x-t") && v.trim() == secret {
                token_ok = true;
            }
        }
    }
    if !token_ok {
        return reply(&mut stream, 403, &json!({"ok":false,"error":"forbidden"}));
    }
    if len > 1024 * 1024 * 1024 {
        return reply(&mut stream, 413, &json!({"ok":false,"error":"too large"}));
    }
    let mut body = vec![0u8; len];
    reader.read_exact(&mut body)?;
    let (path, query) = target.split_once('?').unwrap_or((target.as_str(), ""));
    if method != "POST" {
        return reply(&mut stream, 405, &json!({"ok":false,"error":"POST only"}));
    }
    match path {
        "/upload" => {
            let name = query
                .split('&')
                .find_map(|kv| kv.strip_prefix("name="))
                .map(pct_decode)
                .unwrap_or_else(|| "upload.bin".into());
            let app2 = app.clone();
            let result: Result<String, String> = tauri::async_runtime::block_on(async move {
                let token = crate::upload_stream::begin_upload(app2, name, body.len() as u64).await?;
                let mut offset = 0u64;
                for chunk in body.chunks(1024 * 1024) {
                    crate::upload_stream::append_upload(token.clone(), offset, b64(chunk)).await?;
                    offset += chunk.len() as u64;
                }
                crate::upload_stream::finish_upload(token.clone()).await?;
                Ok(token)
            });
            match result {
                Ok(token) => reply(&mut stream, 200, &json!({"ok":true,"token":token})),
                Err(e) => reply(&mut stream, 200, &json!({"ok":false,"error":e})),
            }
        }
        "/api" => {
            let req: Value = serde_json::from_slice(&body).unwrap_or(Value::Null);
            let api_path = req["path"].as_str().unwrap_or("").to_string();
            let api_method = req["method"].as_str().unwrap_or("GET").to_string();
            let args = if req["args"].is_null() { json!({}) } else { req["args"].clone() };
            let app2 = app.clone();
            let result = tauri::async_runtime::block_on(crate::api::api_call(app2, api_path, api_method, args));
            match result {
                Ok(data) => reply(&mut stream, 200, &json!({"ok":true,"data":data})),
                Err(e) => reply(&mut stream, 200, &json!({"ok":false,"error":e})),
            }
        }
        _ => reply(&mut stream, 404, &json!({"ok":false,"error":"unknown"})),
    }
}
