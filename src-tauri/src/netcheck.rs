// 网络诊断三件套（DNS 查询 / SSL 证书检查 / whois）——Rust 原生实现。
//
// 背景：这三个工具在桌面版一直没有可用后端（worker 没有对应处理器，Rust 路由
// 直接拒绝），界面上点"查询"只会失败。这里补齐，全部是只读查询：
//   · dns-lookup / ssl-checker：一次 PowerShell（-EncodedCommand，避开引号与编码坑）
     //   拿到全部记录类型 / 完整证书链。输出的文本格式严格对齐前端
     //   net-query-tools.tsx 里的 parseDnsReport / parseSslReport（那些解析器本来就是
     //   按网页版同款报告格式写的）。
//   · whois：43 端口的纯 TCP 文本协议，std::net 就能做；跟随最多 3 台服务器
//     （iana 根 → 注册局 → 注册商），常见字段顺手解析成界面认识的键名。

use std::collections::{BTreeSet, HashSet};
use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;

use serde_json::{json, Value};

/// 把 PowerShell 脚本以 UTF-16LE Base64 传给 powershell.exe（-EncodedCommand）。
/// 好处：中文、引号、括号全都不用转义，输出按 UTF-8 收。
fn run_powershell(script: &str) -> Result<String, String> {
    // 注意：不能在末尾追加 NUL——PowerShell 会把它当成一条命令 `_x0000_` 执行失败，
    // 退出码变 1，导致明明查到了结果却被当成失败（DNS/SSL 工具一直报空错误的根因）。
    let utf16: Vec<u8> = script
        .encode_utf16()
        .flat_map(|w| w.to_le_bytes().to_vec())
        .collect();
    let enc = crate::jobs::b64_encode_public(&utf16);
    let mut cmd = std::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-EncodedCommand", &enc]);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW：不弹黑色控制台窗口
    }
    let out = cmd
        .output()
        .map_err(|e| format!("无法启动 PowerShell：{e}"))?;
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    // 报告脚本会自己写出完整报告；只要有正文就用，个别记录类型查询失败不影响整体。
    if !stdout.trim_matches(|c: char| c.is_whitespace() || c == '\0').is_empty() {
        return Ok(stdout);
    }
    let err = String::from_utf8_lossy(&out.stderr)
        .trim_matches(|c: char| c.is_whitespace() || c == '\0')
        .to_string();
    Err(if err.is_empty() { "查询没有返回结果，请检查网络后重试".to_string() } else { err })
}

/// 域名校验：只放行主机名（不带协议、路径、空格），避免把用户输入拼进脚本出幺蛾子。
fn clean_host(raw: &str) -> Result<String, String> {
    let s = raw
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches('/');
    if s.is_empty() {
        return Err("请输入要查询的域名，例如 example.com".into());
    }
    let host = s.split(':').next().unwrap_or("");
    let ok = !host.is_empty()
        && host.len() <= 253
        && host
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '.' || c == '_')
        && host.contains('.');
    if !ok {
        return Err(format!("这看起来不是域名：{s}（不用带 http://，直接填域名即可）"));
    }
    Ok(host.to_string())
}

// ───────────────────────────── DNS 查询报告 ─────────────────────────────

pub fn dns_report(domain_raw: &str) -> Result<String, String> {
    let domain = clean_host(domain_raw)?;
    // 脚本里用 %DOMAIN% 占位再替换，避免 format! 对花括号的双写地狱。
    let script = r#"
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
$d='%DOMAIN%'
Write-Output 'DNS 查询报告'
Write-Output ('域名：' + $d)
Write-Output ('查询时间：' + (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz'))
Write-Output '查询方式：Resolve-DnsName（系统解析器）'
function Show($title, $type, $pick) {
  Write-Output ''
  Write-Output ('【' + $title + '】')
  $rows = @(Resolve-DnsName -Name $d -Type $type -ErrorAction SilentlyContinue)
  $vals = @()
  foreach ($r in $rows) { $v = & $pick $r; if ($v) { $vals += $v } }
  if ($vals.Count -eq 0) { Write-Output '  未查询到' }
  else { foreach ($v in $vals) { Write-Output ('  ' + $v) } }
}
Show 'A 记录（IPv4 地址）' 'A' {param($r) $r.IPAddress}
Show 'AAAA 记录（IPv6 地址）' 'AAAA' {param($r) $r.IPAddress}
Show 'CNAME 记录（别名）' 'CNAME' {param($r) $r.NameHost}
Show 'MX 记录（邮件服务器）' 'MX' {param($r) if($r.MailExchange){ [string]$r.Preference + ' ' + $r.MailExchange }}
Show 'NS 记录（域名服务器）' 'NS' {param($r) $r.NameHost}
Show 'TXT 记录（文本）' 'TXT' {param($r) if($r.Strings){ ($r.Strings -join '') }}
"#
    .replace("%DOMAIN%", &domain);
    let text = run_powershell(&script)?;
    if !text.contains("域名") {
        return Err("DNS 查询没有返回结果，请检查域名与网络后重试".into());
    }
    Ok(text)
}

// ───────────────────────────── SSL 证书检查报告 ─────────────────────────────

pub fn ssl_report(domain_raw: &str) -> Result<String, String> {
    let s = domain_raw
        .trim()
        .trim_start_matches("https://")
        .trim_start_matches("http://")
        .trim_end_matches('/');
    if s.is_empty() {
        return Err("请输入要检查的域名，例如 www.baidu.com".into());
    }
    // 支持 host:port（界面占位文本就是这么提示的）
    let (host, port) = match s.rsplit_once(':') {
        Some((h, p)) if !h.is_empty() && !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()) => {
            (h.to_string(), p.to_string())
        }
        _ => (s.to_string(), "443".to_string()),
    };
    if !host.contains('.') {
        return Err(format!("这看起来不是域名：{s}"));
    }
    let script = r#"
[Console]::OutputEncoding=[System.Text.Encoding]::UTF8
$hostName='%HOST%'
$port=%PORT%
$script:errNotes=@()
$tcp=New-Object System.Net.Sockets.TcpClient
try { $tcp.Connect($hostName,[int]$port) } catch {
  Write-Output 'SSL 证书检查报告'
  Write-Output ('域名：' + $hostName + ':' + $port)
  Write-Output ('状态：不受信任（无法建立连接：' + $_.Exception.Message + '）')
  exit
}
$cb={ param($s,$c,$ch,$e) if($e -ne [System.Net.Security.SslPolicyErrors]::None){ $script:errNotes += $e.ToString() }; return $true }
$ssl=New-Object System.Net.Security.SslStream($tcp.GetStream(),$false,$cb)
try { $ssl.AuthenticateAsClient($hostName) } catch {
  Write-Output 'SSL 证书检查报告'
  Write-Output ('域名：' + $hostName + ':' + $port)
  Write-Output ('状态：不受信任（TLS 握手失败：' + $_.Exception.Message + '）')
  $tcp.Close(); exit
}
$cert=New-Object System.Security.Cryptography.X509Certificates.X509Certificate2($ssl.RemoteCertificate)
$now=Get-Date
$days=[int]($cert.NotAfter - $now).TotalDays
$expired = ($cert.NotAfter -lt $now)
$notYet = ($cert.NotBefore -gt $now)
$chain=New-Object System.Security.Cryptography.X509Certificates.X509Chain
$chain.ChainPolicy.RevocationMode=[System.Security.Cryptography.X509Certificates.X509RevocationMode]::NoCheck
$null=$chain.Build($cert)
$trustOk = ($script:errNotes.Count -eq 0) -and ($chain.ChainStatus.Count -eq 0)
$status = ''
if(-not $trustOk){
  $reason = (($script:errNotes + @($chain.ChainStatus | ForEach-Object { $_.StatusInformation })) -join '；')
  $status = '不受信任（' + $reason + '）'
} elseif($expired){
  $status = '已过期（已过期 ' + [string][int](-$days) + ' 天）'
} elseif($notYet){
  $status = '不受信任（证书尚未生效）'
} else {
  $status = '有效（剩余 ' + [string]$days + ' 天）'
}
Write-Output 'SSL 证书检查报告'
Write-Output ('域名：' + $hostName + ':' + $port)
Write-Output ('状态：' + $status)
Write-Output '──────────────────────────'
Write-Output ('颁发者：' + $cert.Issuer)
Write-Output ('全称：' + $cert.Subject)
Write-Output ('序列号：' + $cert.SerialNumber)
try {
  $h=[BitConverter]::ToString($cert.GetCertHash('SHA256')).Replace('-','').ToLower()
  Write-Output ('指纹（SHA-256）：' + $h)
} catch {
  Write-Output ('指纹（SHA-1）：' + $cert.GetCertHashString())
}
Write-Output ('有效期：' + $cert.NotBefore.ToString('yyyy-MM-dd HH:mm') + ' 至 ' + $cert.NotAfter.ToString('yyyy-MM-dd HH:mm'))
if($trustOk){ Write-Output '证书链是否可验证：通过（系统信任）' }
else { Write-Output ('证书链是否可验证：未通过（' + (($script:errNotes + @($chain.ChainStatus | ForEach-Object { $_.StatusInformation })) -join '；') + '）') }
$san = @($cert.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.17' })
$dns = @()
if($san.Count -gt 0){
  $items = @($san[0].Format(0) -split ',' | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne '' })
  $dns = @($items | ForEach-Object { $_ -replace '^DNS Name=','' } | Where-Object { $_ -ne '' })
}
if($dns.Count -gt 0){
  Write-Output ('SAN 域名（共 ' + $dns.Count + ' 个）：')
  foreach($n in $dns){ Write-Output ('  ' + $n) }
} else {
  Write-Output 'SAN 域名（共 0 个）：'
  Write-Output '  （证书未声明 SAN 扩展）'
}
if(@($chain.ChainElements).Count -gt 1){
  Write-Output ('签发链上一级：' + $chain.ChainElements[1].Certificate.Subject)
} else {
  Write-Output '签发链上一级：（无上级，根证书或自签名）'
}
Write-Output ('剩余天数：' + $days + ' 天')
if($expired){ Write-Output '是否已过期：是' } else { Write-Output '是否已过期：否' }
$tcp.Close()
"#
    .replace("%HOST%", &host)
    .replace("%PORT%", &port);
    let text = run_powershell(&script)?;
    if !text.contains("状态") {
        return Err("证书检查没有返回结果，请检查域名与网络后重试".into());
    }
    Ok(text)
}

// ───────────────────────────── whois（TCP 43） ─────────────────────────────

fn whois_query(server: &str, domain: &str) -> Result<String, String> {
    let addr = if server.contains(':') {
        server.to_string()
    } else {
        format!("{server}:43")
    };
    let mut stream = TcpStream::connect(&addr)
        .map_err(|e| format!("连不上 whois 服务器 {server}：{e}"))?;
    let _ = stream.set_read_timeout(Some(Duration::from_secs(15)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(15)));
    stream
        .write_all(format!("{domain}\r\n").as_bytes())
        .map_err(|e| format!("发送 whois 查询失败：{e}"))?;
    let mut buf = Vec::new();
    stream
        .read_to_end(&mut buf)
        .map_err(|e| format!("读取 whois 响应失败：{e}"))?;
    let text = String::from_utf8_lossy(&buf).to_string();
    if text.trim().is_empty() {
        return Err(format!("{server} 没有返回任何内容"));
    }
    Ok(text)
}

/// 从 whois 响应里按「键: 值」找第一条命中的字段（键比较不区分大小写）
fn whois_field(text: &str, keys: &[&str]) -> Option<String> {
    for line in text.lines() {
        let lower = line.to_ascii_lowercase();
        let key = lower.split(':').next().unwrap_or("").trim();
        if keys.contains(&key) {
            if let Some(pos) = line.find(':') {
                let v = line[pos + 1..].trim().to_string();
                if !v.is_empty() {
                    return Some(v);
                }
            }
        }
    }
    None
}

pub fn whois_lookup(domain_raw: &str) -> Result<Value, String> {
    let domain = clean_host(domain_raw)?;
    let mut server = "whois.iana.org".to_string();
    let mut text = String::new();
    let mut seen: HashSet<String> = HashSet::new();
    for _ in 0..3 {
        if !seen.insert(server.clone()) {
            break;
        }
        let next_text = match whois_query(&server, &domain) {
            Ok(t) => t,
            // 引导链后段连不上（注册商 whois 常见限流/拒连）就用手上已有的数据，
            // 只有第一跳都失败才算真失败。
            Err(_) if !text.is_empty() => break,
            Err(e) => return Err(e),
        };
        text = next_text;
        // 顺藤摸瓜：响应里若指向更具体的 whois 服务器（iana 根 → 注册局 → 注册商），跟过去
        let next = whois_field(&text, &["refer", "registrar whois server", "whois server", "whois"])
            .filter(|v| {
                !v.is_empty() && v.contains('.') && !v.contains(' ') && !v.eq_ignore_ascii_case(&domain)
            })
            .map(|v| v.trim_end_matches('.').to_string());
        match next {
            Some(n) if n != server => server = n,
            _ => break,
        }
    }
    let registrar = whois_field(&text, &["registrar", "sponsoring registrar"]);
    let created = whois_field(
        &text,
        &["creation date", "created date", "created on", "registered on", "registration time", "created"],
    );
    let expiry = whois_field(
        &text,
        &[
            "registry expiry date",
            "expiry date",
            "expiration date",
            "expire date",
            "paid-till",
            "expires on",
        ],
    );
    let updated = whois_field(&text, &["updated date", "changed", "last updated"]);
    let registrant = whois_field(
        &text,
        &["registrant organization", "registrant name", "registrant", "organization", "orgname"],
    );
    let name_servers: Vec<String> = text
        .lines()
        .filter(|l| {
            let lower = l.trim().to_ascii_lowercase();
            lower.starts_with("name server:") || lower.starts_with("nserver:")
        })
        .filter_map(|l| l.split_once(':').map(|(_, v)| v.trim().to_lowercase()))
        .filter(|s| !s.is_empty())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect();

    let mut resp = serde_json::Map::new();
    resp.insert("ok".into(), json!(true));
    resp.insert("type".into(), json!("whois"));
    resp.insert("domain".into(), json!(domain));
    resp.insert("server".into(), json!(server));
    if let Some(v) = registrar {
        resp.insert("registrar".into(), json!(v));
    }
    if let Some(v) = created {
        resp.insert("createdDate".into(), json!(v));
    }
    if let Some(v) = expiry {
        resp.insert("expiryDate".into(), json!(v));
    }
    if let Some(v) = updated {
        resp.insert("updatedDate".into(), json!(v));
    }
    if let Some(v) = registrant {
        resp.insert("registrant".into(), json!(v));
    }
    if !name_servers.is_empty() {
        resp.insert("nameServers".into(), json!(name_servers));
    }
    resp.insert("rawLines".into(), json!(text.lines().count()));
    Ok(Value::Object(resp))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clean_host_rejects_garbage() {
        assert!(clean_host("example.com").is_ok());
        assert!(clean_host("https://example.com/").is_ok());
        assert!(clean_host("").is_err());
        assert!(clean_host("not a domain").is_err());
        assert!(clean_host("no-dot").is_err());
    }

    #[test]
    fn whois_field_finds_keys_case_insensitive() {
        let text = "Domain Name: EXAMPLE.COM\r\nRegistrar: Example Registrar, Inc.\r\nName Server: NS1.EXAMPLE.COM\r\n";
        assert_eq!(
            whois_field(text, &["registrar"]).as_deref(),
            Some("Example Registrar, Inc.")
        );
        assert_eq!(whois_field(text, &["registrar url"]), None);
    }
}
