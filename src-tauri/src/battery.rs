// 电池健康：读取 Windows 自带的电池报告。
//
// 实现思路（刻意做得很薄）：
//   1. 调用系统自带的 `powercfg /batteryreport /output <临时文件> /xml`（普通用户权限即可，不需要管理员）；
//   2. 把 XML 原文交回前端，由前端解析。
//
// 为什么把解析放前端：这份 XML 是 Windows 机器生成的，结构固定；
// 为它引一个 XML 库不值得（本项目一直坚持能不引依赖就不引）。
// 前端用字符串/属性扫描就够，而且解析失败也能给出明确提示。
//
// 数据来源说明：`powercfg` 是本机系统命令，报告只写到本机临时文件，读完即删，不联网。

use std::io::Read;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn report_xml() -> Result<String, String> {
    // 临时文件名带时间戳，避免多次调用互相覆盖
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or(0);
    let mut path: PathBuf = std::env::temp_dir();
    path.push(format!("furinakit-battery-{stamp}.xml"));

    let mut cmd = std::process::Command::new("powercfg");
    cmd.args([
        "/batteryreport",
        "/output",
        &path.to_string_lossy(),
        "/xml",
    ]);
    crate::commands::no_window(&mut cmd);
    let out = cmd
        .output()
        .map_err(|e| format!("调用 powercfg 失败：{e}（这个工具依赖 Windows 自带的电源管理命令）"))?;

    if !path.exists() {
        let stderr = String::from_utf8_lossy(&out.stderr);
        let stdout = String::from_utf8_lossy(&out.stdout);
        // 台式机没有电池时，powercfg 会直接报错 —— 这时候给一句人话
        let msg = format!("{stdout}{stderr}");
        if msg.contains("没有") || msg.contains("No battery") || msg.contains("无法") {
            return Err("这台设备没有检测到电池（台式机通常如此），因此没有电池健康数据。".into());
        }
        return Err(format!("系统没有生成电池报告：{}", msg.trim()));
    }

    let mut text = String::new();
    {
        let mut f = std::fs::File::open(&path).map_err(|e| format!("读取电池报告失败：{e}"))?;
        let mut buf = Vec::new();
        f.read_to_end(&mut buf).map_err(|e| format!("读取电池报告失败：{e}"))?;
        // 报告是 UTF-8；个别系统会给 UTF-16 带 BOM，这里简单兼容一下
        text = if buf.starts_with(&[0xFF, 0xFE]) {
            let u16s: Vec<u16> = buf[2..]
                .chunks_exact(2)
                .map(|c| u16::from_le_bytes([c[0], c[1]]))
                .collect();
            String::from_utf16_lossy(&u16s)
        } else {
            let start = if buf.starts_with(&[0xEF, 0xBB, 0xBF]) { 3 } else { 0 };
            String::from_utf8_lossy(&buf[start..]).to_string()
        };
    }
    let _ = std::fs::remove_file(&path); // 读完即删，别在用户机器上留垃圾

    if text.trim().is_empty() {
        return Err("电池报告是空的，可能这台设备没有电池。".into());
    }
    Ok(text)
}
