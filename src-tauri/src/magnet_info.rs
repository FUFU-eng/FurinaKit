//! Offline BTIH structure parsing only. This does not resolve peers or metadata.
use serde_json::{json, Value};

pub const DOWNLOAD_UNAVAILABLE: &str = "当前 Tauri 下载任务分发尚未接入磁力引擎；暂不能启动下载。链接解析不代表已获取种子元数据或资源可下载。";

fn btih(raw: &str) -> Result<String, String> {
    if raw.len() == 40 && raw.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Ok(raw.to_ascii_lowercase());
    }
    if raw.len() == 32 {
        let mut acc = 0u32;
        let mut bits = 0;
        let mut bytes = Vec::with_capacity(20);
        for c in raw.bytes() {
            let value = match c.to_ascii_uppercase() {
                b'A'..=b'Z' => c.to_ascii_uppercase() - b'A',
                b'2'..=b'7' => c - b'2' + 26,
                _ => return Err("BTIH 的 Base32 编码只能包含 A–Z 和 2–7".into()),
            };
            acc = (acc << 5) | value as u32;
            bits += 5;
            if bits >= 8 {
                bits -= 8;
                bytes.push((acc >> bits) as u8);
                acc &= (1 << bits) - 1;
            }
        }
        return Ok(bytes.iter().map(|b| format!("{b:02x}")).collect());
    }
    Err("BTIH 必须是 40 位十六进制或 32 位 Base32 编码".into())
}

pub fn parse(args: &Value) -> Result<Value, String> {
    if args.get("__files").is_some() || args.get("torrentPath").is_some() {
        return Err("当前 Tauri 版尚未接入 .torrent 文件解析；请选择磁力链接。种子文件解析与下载仍待实现和验证。".into());
    }
    let raw = args.get("url").or_else(|| args.get("magnet")).and_then(Value::as_str)
        .ok_or("请提供磁力链接")?.trim();
    if raw.len() > 16384 { return Err("磁力链接过长（最多 16 KiB）".into()); }
    if raw.get(..8).map(|v| v.eq_ignore_ascii_case("magnet:?")).unwrap_or(false) == false {
        return Err("请输入以 magnet:? 开头的完整磁力链接".into());
    }
    if raw.chars().any(|c| c.is_control()) || raw.contains('#') {
        return Err("磁力链接不能包含控制字符或未编码的 # 片段".into());
    }
    let query = &raw[8..];
    // form_urlencoded otherwise silently tolerates malformed escapes / invalid UTF-8.
    let q = query.as_bytes();
    let mut i = 0;
    while i < q.len() {
        if q[i] == b'%' {
            if i + 2 >= q.len() || !q[i+1].is_ascii_hexdigit() || !q[i+2].is_ascii_hexdigit() {
                return Err("磁力链接包含无效的百分号编码".into());
            }
            i += 2;
        }
        i += 1;
    }
    let mut hash: Option<String> = None;
    let mut name: Option<String> = None;
    let mut trackers: Vec<String> = Vec::new();
    let mut declared_size: Option<u64> = None;
    let mut has_v2 = false;
    let mut pairs = Vec::new();
    for (k, v) in url::form_urlencoded::parse(query.as_bytes()) {
        if k.contains('\u{fffd}') || v.contains('\u{fffd}') || k.chars().any(char::is_control) || v.chars().any(char::is_control) {
            return Err("磁力参数包含无效 UTF-8 或控制字符".into());
        }
        match k.as_ref() {
            "xt" => {
                if v.get(..9).map(|s| s.eq_ignore_ascii_case("urn:btih:")).unwrap_or(false) {
                    let value = btih(&v[9..])?;
                    if hash.as_ref().map(|h| h != &value).unwrap_or(false) {
                        return Err("链接包含互相冲突的 BTIH，不能确定资源".into());
                    }
                    hash = Some(value.clone());
                    pairs.push((k.to_string(), format!("urn:btih:{value}")));
                    continue;
                }
                has_v2 |= v.get(..9).map(|s| s.eq_ignore_ascii_case("urn:btmh:")).unwrap_or(false);
            }
            "dn" => {
                if v.len() > 4096 { return Err("资源名称过长".into()); }
                if name.is_none() && !v.trim().is_empty() { name = Some(v.to_string()); }
            }
            "tr" => {
                let tracker = url::Url::parse(&v).map_err(|_| "Tracker 地址无效")?;
                if !matches!(tracker.scheme(), "udp" | "http" | "https") || tracker.host_str().is_none()
                    || !tracker.username().is_empty() || tracker.password().is_some() || tracker.fragment().is_some() {
                    return Err("Tracker 仅支持不含用户凭据和片段的 UDP / HTTP / HTTPS 地址".into());
                }
                if !trackers.iter().any(|t| t == v.as_ref()) {
                    if trackers.len() >= 64 { return Err("Tracker 数量过多（最多 64 个）".into()); }
                    trackers.push(v.to_string());
                }
            }
            "xl" => {
                if v.is_empty() || !v.bytes().all(|c| c.is_ascii_digit()) { return Err("xl 必须是非负整数字节数".into()); }
                let size = v.parse::<u64>().map_err(|_| "xl 超出支持范围")?;
                if declared_size.map(|s| s != size).unwrap_or(false) { return Err("链接包含冲突的 xl 大小声明".into()); }
                declared_size = Some(size);
            }
            _ => {}
        }
        pairs.push((k.to_string(), v.to_string()));
    }
    let hash = hash.ok_or(if has_v2 { "当前仅支持 BTIH（v1）；不支持仅含 BTMH 的 v2 磁力链接" } else { "链接缺少有效的 xt=urn:btih: 特征码" })?;
    let query = url::form_urlencoded::Serializer::new(String::new()).extend_pairs(pairs).finish();
    Ok(json!({
        "type": "magnet", "infoHash": hash,
        "name": name.unwrap_or_else(|| "未命名磁力资源".into()),
        "sizeText": declared_size.map(|s| format!("{s} 字节（链接声明，未验证）")).unwrap_or_else(|| "未知（尚未获取元数据）".into()),
        "fileCount": null, "files": [], "trackers": trackers,
        "magnetUri": format!("magnet:?{query}"),
        "metadataResolved": false, "downloadSupported": false,
        "downloadUnavailableReason": DOWNLOAD_UNAVAILABLE,
        "note": "仅离线解析链接结构；未连接 Tracker、DHT 或做种节点，未知文件数量，不保证资源可下载。"
    }))
}
