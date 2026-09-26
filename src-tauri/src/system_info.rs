//! Read-only Windows CIM queries. Scripts are compiled-in and never accept user code.
use serde_json::Value;
use std::{collections::HashMap, io::Read, process::{Command, Stdio}, sync::{Mutex, OnceLock}, time::{Duration, Instant}};

fn script(section: &str) -> Result<&'static str, String> {
    match section {
        "overview" => Ok(include_str!("system_info/overview.ps1")),
        "cpu" => Ok(include_str!("system_info/cpu.ps1")),
        "gpu" => Ok(include_str!("system_info/gpu.ps1")),
        "board" => Ok(include_str!("system_info/board.ps1")),
        "storage" => Ok(include_str!("system_info/storage.ps1")),
        "network" => Ok(include_str!("system_info/network.ps1")),
        "power" => Ok(include_str!("system_info/power.ps1")),
        _ => Err("不支持的硬件信息分区".into()),
    }
}

pub fn query(section: &str) -> Result<Value, String> {
    let text = script(section)?;
    if !cfg!(windows) { return Err("硬件信息查询目前仅支持 Windows".into()); }
    // Serialize/coalesce refreshes; the UI polls every 2s, a CIM query may take longer.
    type Cache = HashMap<String, (Instant, Value)>;
    static CACHE: OnceLock<Mutex<Cache>> = OnceLock::new();
    let mut cache = CACHE.get_or_init(|| Mutex::new(HashMap::new())).lock()
        .map_err(|_| "硬件信息缓存不可用，请重试".to_string())?;
    if let Some((at, value)) = cache.get(section) {
        if at.elapsed() < Duration::from_secs(5) { return Ok(value.clone()); }
    }
    let code = format!("[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);$ErrorActionPreference='SilentlyContinue';$ProgressPreference='SilentlyContinue';{text}");
    let mut cmd = Command::new("powershell.exe");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", &code])
        .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::null());
    crate::commands::no_window(&mut cmd);
    let mut child = cmd.spawn().map_err(|_| "无法启动 Windows 硬件查询".to_string())?;
    let stdout = child.stdout.take().ok_or("无法读取硬件查询输出")?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout.take(8 * 1024 * 1024).read_to_end(&mut bytes).map(|_| bytes)
    });
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if start.elapsed() < Duration::from_secs(30) => std::thread::sleep(Duration::from_millis(40)),
            other => {
                let _ = child.kill(); let _ = child.wait();
                return Err(if other.is_err() { "硬件查询进程异常" } else { "硬件查询超时，请重试" }.into());
            }
        }
    };
    let bytes = reader.join().map_err(|_| "硬件查询输出线程异常")?
        .map_err(|_| "读取硬件查询输出失败")?;
    if !status.success() { return Err("Windows 硬件查询失败，请检查系统服务".into()); }
    let text = std::str::from_utf8(&bytes).map_err(|_| "硬件信息编码异常")?.trim_start_matches('\u{feff}').trim();
    let data: Value = serde_json::from_str(text).map_err(|_| "Windows 未返回有效的硬件信息".to_string())?;
    if !data.as_object().is_some_and(|o| !o.is_empty()) { return Err("Windows 返回的硬件信息为空".into()); }
    cache.insert(section.into(), (Instant::now(), data.clone()));
    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn only_known_read_only_sections() {
        for id in ["overview", "cpu", "gpu", "board", "storage", "network", "power"] {
            assert!(script(id).unwrap().contains("ConvertTo-Json"));
        }
        for id in ["", "CPU", "overview; Remove-Item", "../storage"] { assert!(script(id).is_err()); }
    }
}
