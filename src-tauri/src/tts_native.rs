//! 文字转语音（原生，不再需要 Python 扩展）
//!
//! 三种方式，与原 Python 版行为一致：
//!   sapi  —— Windows 自带系统语音（PowerShell System.Speech），完全离线 → WAV
//!   edge  —— 微软 Edge 在线神经语音（WebSocket，国内可直连）→ MP3
//!   local —— 已下载的 sherpa-onnx 本地模型（Kokoro / Piper），在独立子进程里
//!            通过 C API 调用，DLL 崩溃不会带崩主程序 → WAV
//!
//! 绝不静默替换用户选择的引擎或声线。
use std::io::{Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const EDGE_TOKEN: &str = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const EDGE_HOST: &str = "speech.platform.bing.com";
const EDGE_PATH: &str = "/consumer/speech/synthesize/readaloud";
const EDGE_VERSION: &str = "143.0.3650.75";
const EDGE_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0";

pub struct Output {
    pub path: PathBuf,
    pub mime: &'static str,
    pub ext: &'static str,
}

// ───────────────────────── 公共小工具 ─────────────────────────

pub(crate) fn b64(bytes: &[u8]) -> String {
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

/// 按句读切成 ≤limit 字符的片段（按字符而不是字节），保留所有非空白字符。
pub fn text_chunks(text: &str, limit: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut rest: Vec<char> = text.chars().collect();
    while rest.len() > limit {
        let mut cut = 0;
        for i in (limit / 2..limit).rev() {
            if "。！？.!?;；\n ".contains(rest[i]) {
                cut = i + 1;
                break;
            }
        }
        if cut == 0 {
            cut = limit;
        }
        let part: String = rest[..cut].iter().collect();
        rest.drain(..cut);
        if !part.trim().is_empty() {
            out.push(part);
        }
    }
    let last: String = rest.into_iter().collect();
    if !last.trim().is_empty() {
        out.push(last);
    }
    out
}

fn check_wav(path: &Path) -> Result<(), String> {
    let mut f = std::fs::File::open(path).map_err(|_| "未生成有效 WAV 音频 / No valid WAV audio was generated".to_string())?;
    let mut head = [0u8; 44];
    let n = f.read(&mut head).unwrap_or(0);
    let len = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    if n < 44 || &head[0..4] != b"RIFF" || &head[8..12] != b"WAVE" || len <= 44 {
        return Err("未生成有效 WAV 音频 / No valid WAV audio was generated".into());
    }
    Ok(())
}

fn powershell() -> Result<PathBuf, String> {
    crate::owned_tasks::system_tool("WindowsPowerShell/v1.0/powershell.exe")
}

fn run_ps(script: &str, stdin: &str, timeout: Duration) -> Result<Vec<u8>, String> {
    let utf16: Vec<u8> = script.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
    let mut cmd = std::process::Command::new(powershell()?);
    cmd.args(["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", &b64(&utf16)])
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());
    crate::commands::no_window(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| format!("无法启动 PowerShell：{e}"))?;
    if let Some(mut si) = child.stdin.take() {
        let _ = si.write_all(stdin.as_bytes());
    }
    let mut stdout = child.stdout.take();
    let reader = std::thread::spawn(move || {
        let mut buf = Vec::new();
        if let Some(s) = stdout.as_mut() {
            let _ = s.read_to_end(&mut buf);
        }
        buf
    });
    let start = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let out = reader.join().unwrap_or_default();
                if !status.success() {
                    let mut err = String::new();
                    if let Some(mut e) = child.stderr.take() {
                        let _ = e.read_to_string(&mut err);
                    }
                    let first = err.lines().find(|l| !l.trim().is_empty()).unwrap_or("").trim().to_string();
                    return Err(format!("系统语音失败 / System speech failed{}", if first.is_empty() { String::new() } else { format!("：{first}") }));
                }
                return Ok(out);
            }
            Ok(None) => {
                if start.elapsed() > timeout {
                    let _ = child.kill();
                    return Err("系统语音超时 / System speech timed out".into());
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

// ───────────────────────── SAPI ─────────────────────────

const PS_COMMON: &str = r#"
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName System.Speech
$s = New-Object System.Speech.Synthesis.SpeechSynthesizer
"#;
const PS_LIST: &str = r#"
try {
    $items = @($s.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object {
        @{name=$_.VoiceInfo.Name; label=$_.VoiceInfo.Description; locale=$_.VoiceInfo.Culture.Name; gender=$_.VoiceInfo.Gender.ToString().ToLower()}
    })
    ConvertTo-Json -InputObject $items -Compress -Depth 3
} finally { $s.Dispose() }
"#;
const PS_SYNTH: &str = r#"
try {
    $p = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $available = @($s.GetInstalledVoices() | Where-Object { $_.Enabled -and $_.VoiceInfo.Name -ceq $p.voice })
    if ($available.Count -ne 1) { throw 'Selected SAPI voice is not installed or is disabled' }
    $s.SelectVoice([string]$p.voice)
    if ($s.Voice.Name -cne $p.voice) { throw 'SAPI did not select the requested voice' }
    $s.Rate = [int]$p.rate
    $s.Volume = [int]$p.volume
    $s.SetOutputToWaveFile([string]$p.output)
    $s.Speak([string]$p.text)
    $s.SetOutputToNull()
    @{voice=$s.Voice.Name; ok=$true} | ConvertTo-Json -Compress
} finally { $s.Dispose() }
"#;

pub fn sapi_voices() -> Result<Vec<Value>, String> {
    let out = run_ps(&format!("{PS_COMMON}{PS_LIST}"), "", Duration::from_secs(60))?;
    let text = String::from_utf8_lossy(&out);
    let text = text.trim_start_matches('\u{feff}').trim();
    let v: Value = serde_json::from_str(if text.is_empty() { "[]" } else { text }).map_err(|_| "无法读取系统声线 / Could not read system voices".to_string())?;
    let list = match v {
        Value::Array(a) => a,
        Value::Object(_) => vec![v],
        _ => vec![],
    };
    Ok(list.into_iter().filter(|x| x.get("name").and_then(Value::as_str).is_some_and(|s| !s.is_empty())).collect())
}

fn sapi(text: &str, voice: &str, rate: i32, volume: i32, out: &Path) -> Result<String, String> {
    let voices = sapi_voices()?;
    if voices.is_empty() {
        return Err("本机没有可用的系统声线，请在 Windows 设置 → 时间和语言 → 语音 中添加语音包 / No SAPI voices are installed".into());
    }
    let voice = if voice.is_empty() { voices[0]["name"].as_str().unwrap_or("").to_string() } else { voice.to_string() };
    if !voices.iter().any(|v| v["name"].as_str() == Some(voice.as_str())) {
        return Err("所选系统声线未安装，不会自动替换 / Selected system voice is not installed; no fallback was used".into());
    }
    let sapi_rate = ((rate as f64) / 10.0).round().clamp(-10.0, 10.0) as i32;
    let payload = json!({"text": text, "voice": voice, "rate": sapi_rate, "volume": (100 + volume).clamp(0, 100), "output": out.to_string_lossy()});
    let res = run_ps(&format!("{PS_COMMON}{PS_SYNTH}"), &payload.to_string(), Duration::from_secs(3600))?;
    let text_out = String::from_utf8_lossy(&res);
    let r: Value = serde_json::from_str(text_out.trim_start_matches('\u{feff}').trim()).unwrap_or(Value::Null);
    if r.get("ok").and_then(Value::as_bool) != Some(true) || r.get("voice").and_then(Value::as_str) != Some(voice.as_str()) {
        return Err("系统未应用所选声线 / System did not apply the selected voice".into());
    }
    check_wav(out)?;
    Ok(voice)
}

// ───────────────────────── Edge 在线语音 ─────────────────────────

fn edge_query() -> String {
    let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0);
    let ticks = (now + 11_644_473_600) / 300 * 300 * 10_000_000;
    let gec = format!("{:X}", Sha256::digest(format!("{ticks}{EDGE_TOKEN}").as_bytes()));
    format!("TrustedClientToken={EDGE_TOKEN}&Sec-MS-GEC={gec}&Sec-MS-GEC-Version=1-{EDGE_VERSION}")
}

fn muid() -> String {
    uuid::Uuid::new_v4().simple().to_string().to_uppercase()
}

pub fn edge_voices() -> Result<Vec<Value>, String> {
    let url = format!("https://{EDGE_HOST}{EDGE_PATH}/voices/list?{}", edge_query());
    let curl = crate::owned_tasks::system_tool("curl.exe")?;
    // 先强制 IPv4（部分国内网络 IPv6 线路被重置），失败再让 curl 自己选
    let run = |ipv4: bool| -> Result<std::process::Output, String> {
        let mut cmd = std::process::Command::new(&curl);
        if ipv4 { cmd.arg("-4"); }
        cmd.args([
        "-f", "-sS", "--ssl-no-revoke", "--connect-timeout", "10", "--max-time", "30", "--max-filesize", "4194304",
        "-H", &format!("User-Agent: {EDGE_UA}"), "-H", "Accept-Language: en-US,en;q=0.9", "-H", &format!("Cookie: muid={};", muid()), &url,
    ]);
        crate::commands::no_window(&mut cmd);
        cmd.output().map_err(|e| format!("无法启动 curl：{e}"))
    };
    let mut out = run(true)?;
    if !out.status.success() {
        out = run(false)?;
    }
    if !out.status.success() {
        return Err("在线音色清单获取失败，请检查网络和系统时间 / Could not retrieve online voices".into());
    }
    let data: Value = serde_json::from_slice(&out.stdout).map_err(|_| "在线音色清单格式无效 / Invalid voice list".to_string())?;
    let arr = data.as_array().ok_or("在线音色清单格式无效 / Invalid voice list")?;
    Ok(arr
        .iter()
        .filter_map(|v| {
            let name = v.get("ShortName")?.as_str()?;
            if name.len() < 3 || name.len() > 100 || !name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
                return None;
            }
            Some(json!({
                "name": name,
                "label": v.get("FriendlyName").and_then(Value::as_str).unwrap_or(name),
                "locale": v.get("Locale").and_then(Value::as_str).unwrap_or(""),
                "gender": v.get("Gender").and_then(Value::as_str).unwrap_or(""),
            }))
        })
        .collect())
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;").replace('\'', "&apos;")
}

fn edge_ssml(text: &str, voice: &str, rate: i32, pitch: i32, volume: i32) -> Result<String, String> {
    if voice.len() < 3 || voice.len() > 100 || !voice.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') {
        return Err("在线声线名称无效 / Invalid online voice name".into());
    }
    let parts: Vec<&str> = voice.split('-').collect();
    if parts.len() < 3 {
        return Err("在线声线名称无效 / Invalid online voice name".into());
    }
    let locale = parts[..2].join("-");
    let service_voice = format!("Microsoft Server Speech Text to Speech Voice ({}, {})", parts[..parts.len() - 1].join("-"), parts[parts.len() - 1]);
    Ok(format!(
        "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='{}'><voice name='{}'><prosody pitch='{:+}Hz' rate='{:+}%' volume='{:+}%'>{}</prosody></voice></speak>",
        xml_escape(&locale), xml_escape(&service_voice), pitch, rate, volume, xml_escape(text)
    ))
}

/// 极简 WebSocket 客户端（RFC 6455），只实现本功能需要的部分。
struct Ws {
    s: native_tls::TlsStream<TcpStream>,
}

impl Ws {
    /// 先试 IPv4 再试 IPv6：部分国内网络里该服务的 IPv6 线路会被直接重置（实测 10054），IPv4 直连正常
    fn connect(host: &str, path: &str) -> Result<Ws, String> {
        let mut addrs: Vec<std::net::SocketAddr> = (host, 443).to_socket_addrs().map_err(|e| format!("无法解析 {host}：{e}"))?.collect();
        addrs.sort_by_key(|a| if a.is_ipv4() { 0 } else { 1 });
        addrs.dedup();
        let mut last = "无法解析服务器地址".to_string();
        for addr in addrs.iter().take(6) {
            match Ws::connect_addr(*addr, host, path) {
                Ok(ws) => return Ok(ws),
                Err(e) => last = e,
            }
        }
        Err(last)
    }

    fn connect_addr(addr: std::net::SocketAddr, host: &str, path: &str) -> Result<Ws, String> {
        let tcp = TcpStream::connect_timeout(&addr, Duration::from_secs(15)).map_err(|e| format!("连接在线语音服务失败：{e}"))?;
        tcp.set_read_timeout(Some(Duration::from_secs(60))).ok();
        tcp.set_write_timeout(Some(Duration::from_secs(30))).ok();
        let connector = native_tls::TlsConnector::new().map_err(|e| e.to_string())?;
        let mut s = connector.connect(host, tcp).map_err(|e| format!("TLS 握手失败：{e}"))?;
        let key = b64(uuid::Uuid::new_v4().as_bytes());
        let req = format!(
            "GET {path} HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n\
Origin: chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold\r\nUser-Agent: {EDGE_UA}\r\nPragma: no-cache\r\nCache-Control: no-cache\r\n\
Accept-Language: en-US,en;q=0.9\r\nCookie: muid={};\r\n\r\n",
            muid()
        );
        s.write_all(req.as_bytes()).map_err(|e| e.to_string())?;
        let mut head = Vec::new();
        let mut b = [0u8; 1];
        while !head.ends_with(b"\r\n\r\n") {
            if s.read(&mut b).map_err(|e| format!("在线语音握手失败：{e}"))? == 0 || head.len() > 16384 {
                return Err("在线语音握手失败 / WebSocket handshake failed".into());
            }
            head.push(b[0]);
        }
        let status = String::from_utf8_lossy(&head);
        if !status.starts_with("HTTP/1.1 101") {
            let first = status.lines().next().unwrap_or("").to_string();
            return Err(format!("在线语音服务拒绝连接（{first}），请检查系统时间或稍后重试"));
        }
        Ok(Ws { s })
    }

    fn send(&mut self, opcode: u8, payload: &[u8]) -> Result<(), String> {
        let mut frame = vec![0x80 | opcode];
        let n = payload.len();
        if n < 126 {
            frame.push(0x80 | n as u8);
        } else if n < 65536 {
            frame.push(0x80 | 126);
            frame.extend_from_slice(&(n as u16).to_be_bytes());
        } else {
            frame.push(0x80 | 127);
            frame.extend_from_slice(&(n as u64).to_be_bytes());
        }
        let mask: [u8; 4] = uuid::Uuid::new_v4().as_bytes()[..4].try_into().unwrap();
        frame.extend_from_slice(&mask);
        frame.extend(payload.iter().enumerate().map(|(i, b)| b ^ mask[i % 4]));
        self.s.write_all(&frame).map_err(|e| e.to_string())
    }

    fn read_exact(&mut self, n: usize) -> Result<Vec<u8>, String> {
        let mut buf = vec![0u8; n];
        self.s.read_exact(&mut buf).map_err(|e| format!("在线语音连接中断：{e}"))?;
        Ok(buf)
    }

    /// 返回 (opcode, payload)；自动应答 ping、拼接分片。
    fn recv(&mut self) -> Result<(u8, Vec<u8>), String> {
        let mut msg_op = 0u8;
        let mut data = Vec::new();
        loop {
            let h = self.read_exact(2)?;
            let fin = h[0] & 0x80 != 0;
            let op = h[0] & 0x0f;
            let masked = h[1] & 0x80 != 0;
            let mut len = (h[1] & 0x7f) as u64;
            if len == 126 {
                let e = self.read_exact(2)?;
                len = u16::from_be_bytes([e[0], e[1]]) as u64;
            } else if len == 127 {
                let e = self.read_exact(8)?;
                len = u64::from_be_bytes(e.try_into().unwrap());
            }
            if len > 8 * 1024 * 1024 {
                return Err("在线语音帧过大 / Oversized frame".into());
            }
            let mask = if masked { Some(self.read_exact(4)?) } else { None };
            let mut payload = self.read_exact(len as usize)?;
            if let Some(m) = mask {
                for (i, b) in payload.iter_mut().enumerate() {
                    *b ^= m[i % 4];
                }
            }
            match op {
                0x9 => {
                    self.send(0xA, &payload)?;
                    continue;
                }
                0xA => continue,
                0x8 => return Ok((0x8, payload)),
                0x0 => data.extend_from_slice(&payload),
                _ => {
                    msg_op = op;
                    data = payload;
                }
            }
            if fin {
                return Ok((msg_op, data));
            }
        }
    }
}

fn frame_headers(raw: &str) -> std::collections::HashMap<String, String> {
    raw.split("\r\n")
        .filter_map(|l| l.split_once(':'))
        .map(|(k, v)| (k.trim().to_ascii_lowercase(), v.trim().to_string()))
        .collect()
}

fn edge_timestamp() -> String {
    // 形如 "Thu Sep 25 2026 08:00:00 GMT+0000 (Coordinated Universal Time)"
    let secs = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) as i64;
    let days = secs.div_euclid(86400);
    let rem = secs.rem_euclid(86400);
    // civil-from-days (Howard Hinnant)
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    let wd = ["Thu", "Fri", "Sat", "Sun", "Mon", "Tue", "Wed"][days.rem_euclid(7) as usize];
    let mon = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][(m - 1) as usize];
    format!("{wd} {mon} {d:02} {y} {:02}:{:02}:{:02} GMT+0000 (Coordinated Universal Time)", rem / 3600, rem % 3600 / 60, rem % 60)
}

fn edge_segment(text: &str, voice: &str, rate: i32, pitch: i32, volume: i32) -> Result<Vec<u8>, String> {
    let path = format!("{EDGE_PATH}/edge/v1?{}&ConnectionId={}", edge_query(), uuid::Uuid::new_v4().simple());
    let mut ws = Ws::connect(EDGE_HOST, &path)?;
    let request_id = uuid::Uuid::new_v4().simple().to_string();
    let stamp = edge_timestamp();
    let config = r#"{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}"#;
    ws.send(0x1, format!("X-Timestamp:{stamp}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n{config}").as_bytes())?;
    ws.send(
        0x1,
        format!("X-RequestId:{request_id}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:{stamp}Z\r\nPath:ssml\r\n\r\n{}", edge_ssml(text, voice, rate, pitch, volume)?).as_bytes(),
    )?;
    let mut audio = Vec::new();
    let deadline = Instant::now() + Duration::from_secs(240);
    loop {
        if Instant::now() > deadline {
            return Err("在线合成超时 / Online synthesis timed out".into());
        }
        let (op, data) = ws.recv()?;
        match op {
            0x2 => {
                if data.len() < 2 {
                    return Err("在线服务返回了不完整帧 / Truncated online audio frame".into());
                }
                let size = u16::from_be_bytes([data[0], data[1]]) as usize;
                if size > data.len() - 2 {
                    return Err("在线服务帧头无效 / Invalid online frame header".into());
                }
                let meta = frame_headers(&String::from_utf8_lossy(&data[2..2 + size]));
                if meta.get("path").map(|s| s.to_ascii_lowercase()) != Some("audio".into()) {
                    continue;
                }
                let payload = &data[2 + size..];
                if !payload.is_empty() {
                    let ct = meta.get("content-type").map(|s| s.split(';').next().unwrap_or("").to_ascii_lowercase()).unwrap_or_default();
                    if ct != "audio/mpeg" {
                        return Err("在线音频格式不匹配 / Unexpected online audio format".into());
                    }
                    audio.extend_from_slice(payload);
                    if audio.len() > 24 * 1024 * 1024 {
                        return Err("在线音频分段超出大小限制".into());
                    }
                }
            }
            0x1 => {
                let t = String::from_utf8_lossy(&data);
                let header = t.split("\r\n\r\n").next().unwrap_or("");
                let meta = frame_headers(header);
                if meta.get("path").map(|s| s.to_ascii_lowercase()) == Some("turn.end".into()) {
                    break;
                }
            }
            0x8 => return Err("在线语音服务提前关闭了连接，请稍后重试或检查系统时间".into()),
            _ => {}
        }
    }
    let _ = ws.send(0x8, &[0x03, 0xE8]);
    if audio.len() < 100 {
        return Err("在线服务未返回完整音频 / Online service returned no complete audio".into());
    }
    Ok(audio)
}

fn edge(text: &str, voice: &str, rate: i32, pitch: i32, volume: i32, out: &Path, cancelled: &dyn Fn() -> bool, progress: &dyn Fn(u32)) -> Result<(), String> {
    let chunks = text_chunks(text, 500);
    let mut file = std::fs::File::create(out).map_err(|e| e.to_string())?;
    let mut written = 0usize;
    for (i, seg) in chunks.iter().enumerate() {
        if cancelled() {
            return Err("任务已停止".into());
        }
        let mut last = String::new();
        let mut ok = None;
        for attempt in 0..3 {
            match edge_segment(seg, voice, rate, pitch, volume) {
                Ok(a) => {
                    ok = Some(a);
                    break;
                }
                Err(e) => {
                    last = e;
                    std::thread::sleep(Duration::from_secs(1 + 2 * attempt));
                }
            }
        }
        let audio = ok.ok_or_else(|| format!("在线合成失败（已重试 3 次）：{last}。可改用「系统语音」离线合成"))?;
        file.write_all(&audio).map_err(|e| e.to_string())?;
        written += audio.len();
        if written > 128 * 1024 * 1024 {
            return Err("语音结果过大，请缩短文本".into());
        }
        progress(20 + (70 * (i + 1) / chunks.len()) as u32);
    }
    Ok(())
}

// ───────────────────────── 本地模型（sherpa-onnx） ─────────────────────────

fn find_files(root: &Path, out: &mut Vec<PathBuf>, depth: usize) {
    if depth > 12 {
        return;
    }
    if let Ok(rd) = std::fs::read_dir(root) {
        for e in rd.flatten() {
            let p = e.path();
            if p.is_dir() {
                find_files(&p, out, depth + 1);
            } else {
                out.push(p);
            }
        }
    }
}

fn unique(paths: &[PathBuf], name: &str) -> Result<PathBuf, String> {
    let m: Vec<&PathBuf> = paths.iter().filter(|p| p.file_name().and_then(|s| s.to_str()) == Some(name)).collect();
    if m.len() == 1 {
        Ok(m[0].clone())
    } else {
        Err(format!("语音模型文件缺失或不唯一：{name}，请在设置中重新下载该模型"))
    }
}

fn local(app_components: &Path, text: &str, voice: &str, rate: i32, volume: i32, out: &Path) -> Result<(), String> {
    let (id, speaker) = voice.rsplit_once(':').ok_or("请选择本地模型及说话人 / Select an offline model and speaker")?;
    if !crate::tts_components::IDS.contains(&id) || id == "tts-sherpa-runtime" {
        return Err("本地声线无效 / Invalid offline voice".into());
    }
    let sid: i32 = speaker.parse().map_err(|_| "说话人编号无效 / Invalid speaker ID")?;
    let root = app_components.join("tts-v66");
    let runtime = root.join("tts-sherpa-runtime");
    let model = root.join(id);
    if !runtime.join("receipt.json").is_file() || !model.join("receipt.json").is_file() {
        return Err("请先在设置 → 组件管理中下载所选语音模型（会同时下载运行库）".into());
    }
    let mut rt_files = Vec::new();
    find_files(&runtime, &mut rt_files, 0);
    let dll = unique(&rt_files, "sherpa-onnx-c-api.dll")?;
    let mut files = Vec::new();
    find_files(&model, &mut files, 0);
    let onnx: Vec<&PathBuf> = files.iter().filter(|p| p.extension().and_then(|s| s.to_str()) == Some("onnx")).collect();
    let int8: Vec<&&PathBuf> = onnx.iter().filter(|p| p.file_name().unwrap().to_string_lossy().contains("int8")).collect();
    let model_file = if int8.len() == 1 { (*int8[0]).clone() } else if onnx.len() == 1 { onnx[0].clone() } else { return Err("无法定位语音模型文件，请重新下载".into()) };
    let tokens = unique(&files, "tokens.txt")?;
    let data_dir = unique(&files, "phontab")?.parent().map(Path::to_path_buf).ok_or("模型数据目录无效")?;
    let kokoro = id == "tts-kokoro-zh-en";
    let mut req = json!({
        "dll": dll, "family": if kokoro { "kokoro" } else { "vits" }, "model": model_file, "tokens": tokens, "data_dir": data_dir,
        "text": text, "sid": sid, "speed": 1.0 + (rate.clamp(-50, 50) as f64) / 100.0, "gain": (1.0 + volume as f64 / 100.0).clamp(0.0, 1.0),
        "output": out,
    });
    if kokoro {
        req["voices"] = json!(unique(&files, "voices.bin")?);
        req["lexicon"] = json!([unique(&files, "lexicon-us-en.txt")?, unique(&files, "lexicon-zh.txt")?]);
        let rules: Vec<PathBuf> = ["date-zh.fst", "number-zh.fst", "phone-zh.fst"].iter().filter_map(|n| unique(&files, n).ok()).collect();
        req["rules"] = json!(rules);
    }
    let dir = out.parent().ok_or("输出目录无效")?;
    let req_path = dir.join(format!("tts-request-{}.json", uuid::Uuid::new_v4().simple()));
    let reply = req_path.with_extension("result.json");
    req["reply"] = json!(reply);
    std::fs::write(&req_path, req.to_string()).map_err(|e| e.to_string())?;
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let mut cmd = std::process::Command::new(exe);
    cmd.arg("--tts-render").arg(&req_path).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    crate::commands::no_window(&mut cmd);
    let result = (|| {
        let mut child = cmd.spawn().map_err(|e| format!("无法启动本地语音进程：{e}"))?;
        let start = Instant::now();
        let status = loop {
            if let Some(s) = child.try_wait().map_err(|e| e.to_string())? {
                break s;
            }
            if start.elapsed() > Duration::from_secs(3600) {
                let _ = child.kill();
                return Err("本地合成超时，请缩短文本".to_string());
            }
            std::thread::sleep(Duration::from_millis(150));
        };
        let r: Value = std::fs::read(&reply).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or(Value::Null);
        if r.get("ok").and_then(Value::as_bool) == Some(true) && status.success() {
            Ok(())
        } else {
            Err(r.get("error").and_then(Value::as_str).map(str::to_string).unwrap_or_else(|| "本地语音进程失败，请检查组件完整性及可用内存".into()))
        }
    })();
    let _ = std::fs::remove_file(&req_path);
    let _ = std::fs::remove_file(&reply);
    result?;
    check_wav(out)
}

// sherpa-onnx v1.13.8 C API（与官方 c-api.h 字段顺序一致）
mod ffi {
    use std::os::raw::{c_char, c_float, c_int};
    #[repr(C)]
    pub struct Vits { pub model: *const c_char, pub lexicon: *const c_char, pub tokens: *const c_char, pub data_dir: *const c_char, pub noise_scale: c_float, pub noise_scale_w: c_float, pub length_scale: c_float, pub dict_dir: *const c_char }
    #[repr(C)]
    pub struct Matcha { pub acoustic_model: *const c_char, pub vocoder: *const c_char, pub lexicon: *const c_char, pub tokens: *const c_char, pub data_dir: *const c_char, pub noise_scale: c_float, pub length_scale: c_float, pub dict_dir: *const c_char }
    #[repr(C)]
    pub struct Kokoro { pub model: *const c_char, pub voices: *const c_char, pub tokens: *const c_char, pub data_dir: *const c_char, pub length_scale: c_float, pub dict_dir: *const c_char, pub lexicon: *const c_char, pub lang: *const c_char }
    #[repr(C)]
    pub struct Kitten { pub model: *const c_char, pub voices: *const c_char, pub tokens: *const c_char, pub data_dir: *const c_char, pub length_scale: c_float }
    #[repr(C)]
    pub struct Zipvoice { pub tokens: *const c_char, pub encoder: *const c_char, pub decoder: *const c_char, pub vocoder: *const c_char, pub data_dir: *const c_char, pub lexicon: *const c_char, pub feat_scale: c_float, pub t_shift: c_float, pub target_rms: c_float, pub guidance_scale: c_float }
    #[repr(C)]
    pub struct Pocket { pub lm_flow: *const c_char, pub lm_main: *const c_char, pub encoder: *const c_char, pub decoder: *const c_char, pub text_conditioner: *const c_char, pub vocab_json: *const c_char, pub token_scores_json: *const c_char, pub voice_embedding_cache_capacity: c_int }
    #[repr(C)]
    pub struct Supertonic { pub duration_predictor: *const c_char, pub text_encoder: *const c_char, pub vector_estimator: *const c_char, pub vocoder: *const c_char, pub tts_json: *const c_char, pub unicode_indexer: *const c_char, pub voice_style: *const c_char }
    #[repr(C)]
    pub struct ModelConfig { pub vits: Vits, pub num_threads: c_int, pub debug: c_int, pub provider: *const c_char, pub matcha: Matcha, pub kokoro: Kokoro, pub kitten: Kitten, pub zipvoice: Zipvoice, pub pocket: Pocket, pub supertonic: Supertonic }
    #[repr(C)]
    pub struct Config { pub model: ModelConfig, pub rule_fsts: *const c_char, pub max_num_sentences: c_int, pub rule_fars: *const c_char, pub silence_scale: c_float }
    #[repr(C)]
    pub struct Audio { pub samples: *const c_float, pub n: c_int, pub sample_rate: c_int }
}

#[cfg(windows)]
fn short_path(p: &Path) -> String {
    use std::os::windows::ffi::OsStrExt;
    // 组件目录是规范化后的 `\\?\E:\...` 形式；sherpa-onnx / espeak-ng 打不开这种路径，
    // 会直接返回空引擎（“本地语音引擎无法加载组件”）。传给引擎前一律去掉前缀。
    let p = PathBuf::from(plain_path(&p.to_string_lossy()));
    let p = p.as_path();
    let s = p.to_string_lossy().to_string();
    if s.is_ascii() {
        return s;
    }
    let wide: Vec<u16> = p.as_os_str().encode_wide().chain(std::iter::once(0)).collect();
    let mut buf = vec![0u16; 1024];
    let n = unsafe { windows::Win32::Storage::FileSystem::GetShortPathNameW(windows::core::PCWSTR(wide.as_ptr()), Some(&mut buf)) } as usize;
    if n > 0 && n < buf.len() {
        let short = plain_path(&String::from_utf16_lossy(&buf[..n]));
        if short.is_ascii() {
            return short;
        }
    }
    s
}
#[cfg(not(windows))]
fn short_path(p: &Path) -> String {
    plain_path(&p.to_string_lossy())
}

/// `\\?\E:\a` → `E:\a`，`\\?\UNC\srv\share` → `\\srv\share`；其它原样返回。
fn plain_path(s: &str) -> String {
    if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        s.to_string()
    }
}

fn write_wav_header(f: &mut std::fs::File, sample_rate: u32, frames: u32) -> std::io::Result<()> {
    use std::io::Seek;
    let data_len = frames * 2;
    f.seek(std::io::SeekFrom::Start(0))?;
    let mut h = Vec::with_capacity(44);
    h.extend_from_slice(b"RIFF");
    h.extend_from_slice(&(36 + data_len).to_le_bytes());
    h.extend_from_slice(b"WAVEfmt ");
    h.extend_from_slice(&16u32.to_le_bytes());
    h.extend_from_slice(&1u16.to_le_bytes());
    h.extend_from_slice(&1u16.to_le_bytes());
    h.extend_from_slice(&sample_rate.to_le_bytes());
    h.extend_from_slice(&(sample_rate * 2).to_le_bytes());
    h.extend_from_slice(&2u16.to_le_bytes());
    h.extend_from_slice(&16u16.to_le_bytes());
    h.extend_from_slice(b"data");
    h.extend_from_slice(&data_len.to_le_bytes());
    f.write_all(&h)
}

#[cfg(windows)]
fn render(req: &Value) -> Result<(), String> {
    use std::ffi::CString;
    use windows::core::PCWSTR;
    use windows::Win32::System::LibraryLoader::{GetProcAddress, LoadLibraryExW, LOAD_WITH_ALTERED_SEARCH_PATH};
    let s = |k: &str| req.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    let c = |v: String| CString::new(v).map_err(|_| "路径包含无效字符".to_string());
    let dll = PathBuf::from(s("dll"));
    let wide: Vec<u16> = dll.to_string_lossy().encode_utf16().chain(std::iter::once(0)).collect();
    let lib = unsafe { LoadLibraryExW(PCWSTR(wide.as_ptr()), None, LOAD_WITH_ALTERED_SEARCH_PATH) }.map_err(|e| format!("无法加载本地语音运行库：{e}"))?;
    macro_rules! sym {
        ($name:literal, $t:ty) => {{
            let p = unsafe { GetProcAddress(lib, windows::core::PCSTR(concat!($name, "\0").as_ptr())) }.ok_or(concat!("运行库缺少函数 ", $name))?;
            unsafe { std::mem::transmute::<unsafe extern "system" fn() -> isize, $t>(p) }
        }};
    }
    type Create = unsafe extern "C" fn(*const ffi::Config) -> *mut std::ffi::c_void;
    type Destroy = unsafe extern "C" fn(*mut std::ffi::c_void);
    type NumSpk = unsafe extern "C" fn(*mut std::ffi::c_void) -> i32;
    type Generate = unsafe extern "C" fn(*mut std::ffi::c_void, *const std::os::raw::c_char, i32, f32) -> *const ffi::Audio;
    type Free = unsafe extern "C" fn(*const ffi::Audio);
    let create: Create = sym!("SherpaOnnxCreateOfflineTts", Create);
    let destroy: Destroy = sym!("SherpaOnnxDestroyOfflineTts", Destroy);
    let num_spk: NumSpk = sym!("SherpaOnnxOfflineTtsNumSpeakers", NumSpk);
    let generate: Generate = sym!("SherpaOnnxOfflineTtsGenerate", Generate);
    let free: Free = sym!("SherpaOnnxDestroyOfflineTtsGeneratedAudio", Free);

    let kokoro = s("family") == "kokoro";
    let model = c(short_path(Path::new(&s("model"))))?;
    let tokens = c(short_path(Path::new(&s("tokens"))))?;
    let data_dir = c(short_path(Path::new(&s("data_dir"))))?;
    let voices = c(short_path(Path::new(&s("voices"))))?;
    let join = |k: &str| -> String { req.get(k).and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_str).map(|p| short_path(Path::new(p))).collect::<Vec<_>>().join(",")).unwrap_or_default() };
    let lexicon = c(join("lexicon"))?;
    let rules = c(join("rules"))?;
    let empty = c(String::new())?;
    let cpu = c("cpu".into())?;
    let e = empty.as_ptr();
    let mut cfg: ffi::Config = unsafe { std::mem::zeroed() };
    cfg.model.num_threads = 2;
    cfg.model.provider = cpu.as_ptr();
    cfg.max_num_sentences = 2;
    cfg.silence_scale = 1.0;
    cfg.rule_fsts = e;
    cfg.rule_fars = e;
    if kokoro {
        cfg.model.kokoro = ffi::Kokoro { model: model.as_ptr(), voices: voices.as_ptr(), tokens: tokens.as_ptr(), data_dir: data_dir.as_ptr(), length_scale: 1.0, dict_dir: e, lexicon: lexicon.as_ptr(), lang: e };
        cfg.rule_fsts = rules.as_ptr();
    } else {
        cfg.model.vits = ffi::Vits { model: model.as_ptr(), lexicon: e, tokens: tokens.as_ptr(), data_dir: data_dir.as_ptr(), noise_scale: 0.667, noise_scale_w: 0.8, length_scale: 1.0, dict_dir: e };
    }
    let tts = unsafe { create(&cfg) };
    if tts.is_null() {
        return Err("本地语音引擎无法加载组件 / Offline TTS could not load its components".into());
    }
    let result = (|| {
        let sid = req.get("sid").and_then(Value::as_i64).unwrap_or(0) as i32;
        if sid < 0 || sid >= unsafe { num_spk(tts) } {
            return Err("模型实际说话人编号不匹配 / Speaker ID does not match the installed model".to_string());
        }
        let speed = req.get("speed").and_then(Value::as_f64).unwrap_or(1.0) as f32;
        let gain = req.get("gain").and_then(Value::as_f64).unwrap_or(1.0) as f32;
        let mut f = std::fs::File::create(s("output")).map_err(|e| e.to_string())?;
        f.write_all(&[0u8; 44]).map_err(|e| e.to_string())?;
        let mut rate: Option<i32> = None;
        let mut frames: u64 = 0;
        for chunk in text_chunks(&s("text"), 500) {
            let t = c(chunk)?;
            let audio = unsafe { generate(tts, t.as_ptr(), sid, speed) };
            if audio.is_null() {
                return Err("本地模型未生成音频 / Offline model returned no audio".into());
            }
            let r = (|| {
                let a = unsafe { &*audio };
                if a.samples.is_null() || !(8000..=96000).contains(&a.sample_rate) || a.n <= 0 || a.n as i64 > a.sample_rate as i64 * 600 {
                    return Err("模型返回的音频无效 / Invalid audio from model".to_string());
                }
                if rate.is_some_and(|r| r != a.sample_rate) {
                    return Err("音频采样率不一致".to_string());
                }
                rate = Some(a.sample_rate);
                let samples = unsafe { std::slice::from_raw_parts(a.samples, a.n as usize) };
                let mut pcm = Vec::with_capacity(samples.len() * 2);
                for &v in samples {
                    let v = v * gain;
                    if !v.is_finite() {
                        return Err("模型产生了无效采样".to_string());
                    }
                    pcm.extend_from_slice(&((v.clamp(-1.0, 1.0) * 32767.0) as i16).to_le_bytes());
                }
                f.write_all(&pcm).map_err(|e| e.to_string())?;
                frames += samples.len() as u64;
                Ok(())
            })();
            unsafe { free(audio) };
            r?;
            if frames > rate.unwrap_or(24000) as u64 * 3600 {
                return Err("音频长度超过一小时".into());
            }
        }
        write_wav_header(&mut f, rate.unwrap_or(24000) as u32, frames as u32).map_err(|e| e.to_string())
    })();
    unsafe { destroy(tts) };
    result
}
#[cfg(not(windows))]
fn render(_req: &Value) -> Result<(), String> {
    Err("本地语音需要 Windows".into())
}

/// `FurinaKit.exe --tts-render <request.json>`（独立子进程）
pub fn render_cli(request: &str) -> i32 {
    let req: Value = match std::fs::read(request).ok().and_then(|b| serde_json::from_slice(&b).ok()) {
        Some(v) => v,
        None => return 2,
    };
    let reply = req.get("reply").and_then(Value::as_str).unwrap_or("").to_string();
    let result = std::panic::catch_unwind(|| render(&req)).unwrap_or_else(|_| Err("本地语音内部错误".into()));
    let body = match &result {
        Ok(()) => json!({"ok": true}),
        Err(e) => json!({"ok": false, "error": e.chars().take(1500).collect::<String>()}),
    };
    if !reply.is_empty() {
        let _ = std::fs::write(&reply, body.to_string());
    }
    if result.is_ok() { 0 } else { 1 }
}

// ───────────────────────── 统一入口 ─────────────────────────

pub fn synthesize(
    components: &Path,
    p: &Value,
    out_dir: &dyn Fn(&str) -> Result<PathBuf, String>,
    cancelled: &dyn Fn() -> bool,
    progress: &dyn Fn(u32),
) -> Result<(Output, String), String> {
    let get = |k: &str| p.get(k).map(|v| match v { Value::String(s) => s.clone(), other => other.to_string() }).unwrap_or_default();
    let num = |k: &str| get(k).trim().parse::<f64>().unwrap_or(0.0).round() as i32;
    let text = get("text").trim().to_string();
    let count = text.chars().count();
    if count == 0 || count > 20000 {
        return Err("请输入 1–20000 字的朗读文本 / Enter 1–20000 characters".into());
    }
    if text.chars().any(|c| (c as u32) < 32 && !"\n\r\t".contains(c)) {
        return Err("文本包含不支持的控制字符".into());
    }
    let engine = { let e = get("engine"); if e.is_empty() { "sapi".to_string() } else { e } };
    let (rate, pitch, volume) = (num("rate"), num("pitch"), num("volume"));
    if !(-50..=50).contains(&rate) || !(-50..=50).contains(&pitch) || !(-100..=100).contains(&volume) {
        return Err("语速、音调或音量超出范围".into());
    }
    if engine != "edge" && (pitch != 0 || volume > 0) {
        return Err("离线引擎不支持音调偏移或音量增益".into());
    }
    let voice = get("voice");
    progress(20);
    match engine.as_str() {
        "sapi" => {
            let path = out_dir("语音.wav")?;
            let used = sapi(&text, &voice, rate, volume, &path)?;
            Ok((Output { path, mime: "audio/wav", ext: "wav" }, format!("合成完成（系统语音 · {used}），可先试听再保存")))
        }
        "edge" => {
            let voice = if voice.is_empty() { "zh-CN-XiaoxiaoNeural".to_string() } else { voice };
            let path = out_dir("语音.mp3")?;
            edge(&text, &voice, rate, pitch, volume, &path, cancelled, progress)?;
            Ok((Output { path, mime: "audio/mpeg", ext: "mp3" }, format!("合成完成（在线语音 · {voice}），可先试听再保存")))
        }
        "local" => {
            let path = out_dir("语音.wav")?;
            local(components, &text, &voice, rate, volume, &path)?;
            Ok((Output { path, mime: "audio/wav", ext: "wav" }, "合成完成（本地模型），可先试听再保存".into()))
        }
        _ => Err("不支持的语音引擎 / Unsupported speech engine".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn plain_path_strips_verbatim_prefix() {
        assert_eq!(super::plain_path(r"\\?\E:\Roaming\x\tokens.txt"), r"E:\Roaming\x\tokens.txt");
        assert_eq!(super::plain_path(r"\\?\UNC\srv\share\m.onnx"), r"\\srv\share\m.onnx");
        assert_eq!(super::plain_path(r"E:\a\b"), r"E:\a\b");
    }

    #[test]
    fn chunks_keep_text() {
        let t = "你好。".repeat(400);
        let c = text_chunks(&t, 500);
        assert!(c.iter().all(|s| s.chars().count() <= 500));
        assert_eq!(c.concat(), t);
    }
    #[test]
    fn ssml_escapes() {
        let s = edge_ssml("a<b>&'\"", "zh-CN-XiaoxiaoNeural", 10, -5, 0).unwrap();
        assert!(s.contains("a&lt;b&gt;&amp;&apos;&quot;"));
        assert!(s.contains("Microsoft Server Speech Text to Speech Voice (zh-CN, XiaoxiaoNeural)"));
        assert!(s.contains("pitch='-5Hz' rate='+10%' volume='+0%'"));
    }
    #[test]
    fn timestamp_shape() {
        let t = edge_timestamp();
        assert!(t.ends_with("GMT+0000 (Coordinated Universal Time)"));
    }
}
