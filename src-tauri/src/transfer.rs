// 跨设备互传（对应原版 apps/web/src/app/api/transfer/route.ts）
//
// 存储布局与原版**完全一致**，都放在 storage 目录下，所以两版之间甚至能共用同一批文件：
//     <storage>/transfers/metadata.json   { sharedFiles, receivedFiles, clipboardText, receiveDir? }
//     <storage>/transfers/shared/         电脑共享给手机的文件副本
//     <storage>/transfers/received/       默认的"手机→电脑"接收目录（可在界面里改）
//
// 文件条目字段照抄原版（前端 TransferredFile 就是这么用的）：
//     { id, name, size, mimeType, createdAt, path?, downloadUrl? }
//
// ★ 现状说明：桌面上这一侧（选 IP、发文件、剪贴板、看列表）本轮已经实现。
//   手机端由 lanserver.rs 提供带配对码验证的 HTTP 服务。

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::{json, Value};
use tauri::Manager;

/// 互传的 HTTP 服务端口 —— 由局域网服务实际监听的端口决定
/// （3001 被占用时会退到随机端口，所以这里不能写死）
fn lan_port() -> String {
    crate::lanserver::share_port().to_string()
}

fn transfers_root(app: &tauri::AppHandle) -> PathBuf {
    let p = crate::jobs::storage_dir_of(app).join("transfers");
    let _ = fs::create_dir_all(&p);
    p
}

fn dirs(app: &tauri::AppHandle) -> (PathBuf, PathBuf, PathBuf) {
    let root = transfers_root(app);
    let shared = root.join("shared");
    let received = root.join("received");
    let _ = fs::create_dir_all(&shared);
    let _ = fs::create_dir_all(&received);
    (shared, received, root.join("metadata.json"))
}

// A separate OS-held lock survives atomic replacement of metadata.json and is
// released by the OS even when this process exits. All current Rust writers use it.
fn lock_metadata(path: &Path) -> Result<fs::File, String> {
    let lock_path = path.with_extension("lock");
    let started = Instant::now();
    loop {
        let mut options = fs::OpenOptions::new();
        options.create(true).truncate(false).read(true).write(true);
        #[cfg(windows)] {
            use std::os::windows::fs::OpenOptionsExt;
            options.share_mode(0);
        }
        let opened = options.open(&lock_path);
        let locked = opened.and_then(|file| {
            #[cfg(unix)] {
                use std::os::fd::AsRawFd;
                extern "C" { fn flock(fd: i32, operation: i32) -> i32; }
                // LOCK_EX | LOCK_NB. Closing this file releases the lock.
                if unsafe { flock(file.as_raw_fd(), 2 | 4) } != 0 {
                    return Err(std::io::Error::last_os_error());
                }
            }
            Ok(file)
        });
        match locked {
            Ok(file) => return Ok(file),
            Err(e) if e.kind() == std::io::ErrorKind::WouldBlock
                || cfg!(windows) && matches!(e.raw_os_error(), Some(32) | Some(33)) => {
                if started.elapsed() >= Duration::from_secs(10) {
                    return Err("互传记录正在更新，请稍后重试".into());
                }
                std::thread::sleep(Duration::from_millis(10));
            }
            Err(e) => return Err(format!("无法锁定互传记录：{e}")),
        }
    }
}

fn read_metadata(path: &Path) -> Result<Value, String> {
    let raw = match fs::read_to_string(path) {
        Ok(raw) => raw,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound =>
            return Ok(json!({"sharedFiles": [], "receivedFiles": [], "clipboardText": ""})),
        Err(e) => return Err(format!("读取互传记录失败：{e}")),
    };
    let meta: Value = serde_json::from_str(&raw).map_err(|_| "互传记录损坏，已保留原文件，请先恢复记录".to_string())?;
    if !meta.is_object() || ["sharedFiles", "receivedFiles"].iter().any(|key|
        meta.get(*key).map_or(false, |v| !v.is_array())) {
        return Err("互传记录格式无效，已保留原文件".into());
    }
    Ok(meta)
}

fn write_metadata(path: &Path, meta: &Value) -> Result<(), String> {
    let bytes = serde_json::to_vec_pretty(meta).map_err(|e| e.to_string())?;
    crate::atomic_store::write(path, &bytes).map_err(|e| format!("写入互传记录失败：{e}"))
}

fn update_metadata<T>(path: &Path, update: impl FnOnce(&mut Value) -> Result<T, String>) -> Result<T, String> {
    let _lock = lock_metadata(path)?;
    let mut meta = read_metadata(path)?;
    let result = update(&mut meta)?;
    write_metadata(path, &meta)?;
    Ok(result)
}

fn load_meta(app: &tauri::AppHandle) -> Result<Value, String> {
    read_metadata(&dirs(app).2)
}

fn save_meta(app: &tauri::AppHandle, meta: &Value) -> Result<(), String> {
    write_metadata(&dirs(app).2, meta)
}

/// 有效的接收目录：界面里改过就用改过的，否则用默认的 received
fn effective_receive_dir(app: &tauri::AppHandle, meta: &Value) -> PathBuf {
    if let Some(d) = meta.get("receiveDir").and_then(|v| v.as_str()) {
        let p = PathBuf::from(d);
        if p.is_dir() {
            return p;
        }
        // 目录被删了/不存在就建一个（原版也是这个行为）
        if fs::create_dir_all(&p).is_ok() {
            return p;
        }
    }
    let (_, received, _) = dirs(app);
    received
}

/// 文件名安全化：只取最后一段，并替换掉 Windows 不接受的字符
fn safe_name(name: &str) -> String {
    let base = name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or("file")
        .chars()
        .map(|c| if "\\/:*?\"<>|".contains(c) { '_' } else { c })
        .collect::<String>();
    if base.trim().is_empty() {
        "file".to_string()
    } else {
        base
    }
}

fn now_iso() -> String {
    // 与 jobs.rs 里同一套手写换算，避免引 chrono
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let mut days = (secs / 86400) as i64;
    let rem = secs % 86400;
    let (h, mi, s) = (rem / 3600, (rem % 3600) / 60, rem % 60);
    let mut year = 1970i64;
    loop {
        let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
        let dy = if leap { 366 } else { 365 };
        if days >= dy {
            days -= dy;
            year += 1;
        } else {
            break;
        }
    }
    let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
    let mdays = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    let mut month = 0usize;
    while month < 12 && days >= mdays[month] {
        days -= mdays[month];
        month += 1;
    }
    format!("{:04}-{:02}-{:02}T{:02}:{:02}:{:02}.000Z", year, month + 1, days + 1, h, mi, s)
}

fn mime_of(name: &str) -> String {
    match Path::new(name).extension().and_then(|e| e.to_str()).map(|s| s.to_lowercase()).as_deref() {
        Some("png") => "image/png",
        Some("jpg") | Some("jpeg") => "image/jpeg",
        Some("gif") => "image/gif",
        Some("webp") => "image/webp",
        Some("pdf") => "application/pdf",
        Some("mp4") => "video/mp4",
        Some("mp3") => "audio/mpeg",
        Some("txt") => "text/plain",
        Some("zip") => "application/zip",
        _ => "application/octet-stream",
    }
    .to_string()
}

// ── 本机 IP ────────────────────────────────────────────────────────────
// 原版用 Node 的 os.networkInterfaces() 列出所有网卡并过滤虚拟网卡。
// Rust 标准库没有这个能力，这里两条腿走路（都不引第三方依赖）：
//   ① 先用一个 UDP socket "连"一下外网地址，拿到系统实际会用的那张网卡的 IP
//      —— 手机连同一个 Wi-Fi 时，要的就是这个地址，而且**不依赖任何外部命令**；
//   ② 再用 PowerShell 列出其余网卡（带中文网卡名），失败就只保留 ①。
// 结果缓存 60 秒：界面每 3 秒轮询一次，不能每次都去起 PowerShell。

static IP_CACHE: Mutex<Option<(Instant, Vec<Value>)>> = Mutex::new(None);

fn primary_ip() -> Option<String> {
    let sock = std::net::UdpSocket::bind("0.0.0.0:0").ok()?;
    // 不会真的发包，只是让系统选出出口网卡
    sock.connect("8.8.8.8:80").ok()?;
    let ip = sock.local_addr().ok()?.ip();
    if ip.is_loopback() {
        None
    } else {
        Some(ip.to_string())
    }
}

/// 虚拟网卡名（原版 isVirtualAdapter 的同款判断）
fn is_virtual(name: &str) -> bool {
    let l = name.to_lowercase();
    [
        "wsl", "vethernet", "virtual", "vbox", "vmware", "vmnet", "hyper-v", "docker", "tailscale",
        "zerotier", "radmin", "clash", "tun", "tap", "wireguard", "loopback",
    ]
    .iter()
    .any(|k| l.contains(k))
}

fn powershell_ips() -> Vec<Value> {
    let script = "[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;\
        Get-NetIPAddress -AddressFamily IPv4 | \
        Where-Object { $_.IPAddress -ne '127.0.0.1' } | \
        ForEach-Object { \"$($_.IPAddress)|$($_.InterfaceAlias)\" }";
    let mut cmd = std::process::Command::new("powershell");
    cmd.args(["-NoProfile", "-NonInteractive", "-Command", script]);
    crate::commands::no_window(&mut cmd);
    let out = match cmd.output() {
        Ok(o) => o,
        Err(_) => return Vec::new(),
    };
    let text = String::from_utf8_lossy(&out.stdout);
    let mut list = Vec::new();
    for line in text.lines() {
        let line = line.trim();
        let Some((ip, name)) = line.split_once('|') else { continue };
        let ip = ip.trim();
        if ip.is_empty() || ip.starts_with("127.") {
            continue;
        }
        // 代理 TUN 用的保留网段（原版也是这么排除的）
        if ip.starts_with("198.18.") || ip.starts_with("198.19.") {
            continue;
        }
        list.push(json!({ "name": name.trim(), "ip": ip }));
    }
    list
}

pub fn lan_ips() -> Vec<Value> {
    if let Ok(guard) = IP_CACHE.lock() {
        if let Some((at, list)) = guard.as_ref() {
            if at.elapsed() < Duration::from_secs(60) {
                return list.clone();
            }
        }
    }

    let mut list = powershell_ips();
    if let Some(primary) = primary_ip() {
        if !list.iter().any(|v| v.get("ip").and_then(|x| x.as_str()) == Some(primary.as_str())) {
            list.push(json!({ "name": "本机", "ip": primary }));
        }
    }
    // 真实局域网地址排前面，虚拟网卡（WSL/VMware/代理 TUN…）排后面
    list.sort_by_key(|v| {
        let name = v.get("name").and_then(|x| x.as_str()).unwrap_or("");
        let ip = v.get("ip").and_then(|x| x.as_str()).unwrap_or("");
        let good_ip = ip.starts_with("192.168.") || ip.starts_with("10.") || ip.starts_with("172.");
        (!good_ip as u8, is_virtual(name) as u8)
    });
    list.dedup_by(|a, b| a.get("ip") == b.get("ip"));

    if let Ok(mut guard) = IP_CACHE.lock() {
        *guard = Some((Instant::now(), list.clone()));
    }
    list
}

// ── GET：界面轮询的状态 ────────────────────────────────────────────────
pub fn state(app: &tauri::AppHandle) -> Result<Value, String> {
    let meta = load_meta(app)?;
    let receive_dir = effective_receive_dir(app, &meta);
    Ok(json!({
        "success": true,
        "ips": lan_ips(),
        "port": lan_port(),
        "receiveDir": receive_dir.to_string_lossy(),
        "sharedFiles": meta.get("sharedFiles").cloned().unwrap_or(json!([])),
        "receivedFiles": meta.get("receivedFiles").cloned().unwrap_or(json!([])),
        "clipboardText": meta.get("clipboardText").cloned().unwrap_or(json!("")),
    }))
}

// ── POST：界面上的各种操作 ─────────────────────────────────────────────
pub fn action(
    app: &tauri::AppHandle,
    action: &str,
    args: &Value,
    uploads: &[Value],
) -> Result<Value, String> {
    let _lock = lock_metadata(&dirs(app).2)?;
    let mut meta = load_meta(app)?;

    match action {
        // 电脑端把文件共享给手机：**复制**一份到共享目录（原版也是复制，不动原文件）
        "share" => {
            if uploads.is_empty() {
                return Err("没有收到要共享的文件".into());
            }
            let (shared_dir, _, _) = dirs(app);
            let mut list = meta.get("sharedFiles").cloned().unwrap_or(json!([]));
            let arr = list.as_array_mut().ok_or("sharedFiles 不是数组")?;
            for upload in uploads {
                let name = upload["name"].as_str().ok_or("共享文件缺少名称")?;
                let source = upload["path"].as_str().ok_or("共享文件缺少上传路径")?;
                let safe = safe_name(name);
                let id = crate::jobs::new_job_id_public();
                let path = shared_dir.join(format!("{id}-{safe}"));
                let size = fs::copy(source, &path).map_err(|e| format!("保存共享文件失败：{e}"))?;
                arr.insert(
                    0,
                    json!({
                        "id": id,
                        "name": safe,
                        "size": size,
                        "mimeType": mime_of(&safe),
                        "createdAt": now_iso(),
                        "path": path.to_string_lossy(),
                        "downloadUrl": format!("/api/transfer/download?id={id}&type=shared"),
                    }),
                );
            }
            meta["sharedFiles"] = list;
            save_meta(app, &meta)?;
            Ok(json!({ "success": true }))
        }

        // 电脑端把一段文本同步给手机（界面右侧会显示）
        "clipboard" => {
            let text = args.get("text").and_then(|v| v.as_str()).unwrap_or("");
            meta["clipboardText"] = json!(text);
            save_meta(app, &meta)?;
            Ok(json!({ "success": true }))
        }

        // 从共享列表移除（连同共享目录里的副本一起删）
        "delete-shared" => {
            let id = args.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let mut list = meta.get("sharedFiles").cloned().unwrap_or(json!([]));
            if let Some(arr) = list.as_array_mut() {
                if let Some(pos) = arr.iter().position(|f| f.get("id").and_then(|v| v.as_str()) == Some(id)) {
                    if let Some(p) = arr[pos].get("path").and_then(|v| v.as_str()) {
                        let _ = fs::remove_file(p);
                    }
                    arr.remove(pos);
                }
            }
            meta["sharedFiles"] = list;
            save_meta(app, &meta)?;
            Ok(json!({ "success": true }))
        }

        // 只移除"已接收"列表里的记录，**不删磁盘上的文件**（原版注释里也是这个约定）
        "delete-received" => {
            let id = args.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let mut list = meta.get("receivedFiles").cloned().unwrap_or(json!([]));
            if let Some(arr) = list.as_array_mut() {
                arr.retain(|f| f.get("id").and_then(|v| v.as_str()) != Some(id));
            }
            meta["receivedFiles"] = list;
            save_meta(app, &meta)?;
            Ok(json!({ "success": true }))
        }

        // 改手机的接收目录
        "set-receive-dir" => {
            let dir = args.get("receiveDir").and_then(|v| v.as_str()).unwrap_or("");
            if dir.is_empty() {
                return Err("没有指定目录".into());
            }
            let p = PathBuf::from(dir);
            fs::create_dir_all(&p).map_err(|e| format!("这个目录用不了：{e}"))?;
            meta["receiveDir"] = json!(dir);
            save_meta(app, &meta)?;
            Ok(json!({ "success": true, "receiveDir": dir }))
        }

        "open-folder" => {
            let dir = effective_receive_dir(app, &meta);
            crate::commands::open_path(app.clone(), dir.to_string_lossy().to_string())?;
            Ok(json!({ "success": true }))
        }

        "open-file" => {
            let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            if path.is_empty() {
                return Err("没有指定文件".into());
            }
            crate::commands::open_path(app.clone(), path.to_string())?;
            Ok(json!({ "success": true }))
        }

        other => Err(format!("不支持的互传操作：{other}")),
    }
}

/// 取共享/接收文件的磁盘路径（给 /api/transfer/download 用）
pub fn artifact_path(app: &tauri::AppHandle, id: &str, kind: &str) -> Option<(PathBuf, String)> {
    if id.is_empty() || !matches!(kind, "shared" | "received") { return None; }
    let meta = load_meta(app).ok()?;
    let key = if kind == "received" { "receivedFiles" } else { "sharedFiles" };
    for f in meta.get(key)?.as_array()? {
        if f.get("id").and_then(|v| v.as_str()) == Some(id) {
            let name = f.get("name").and_then(|v| v.as_str()).unwrap_or("file").to_string();
            let p = PathBuf::from(f.get("path").and_then(|v| v.as_str())?);
            if p.is_file() {
                return Some((p, name));
            }
        }
    }
    None
}

// ── 给局域网服务（lanserver.rs）用的公开包装 ──────────────────────────

pub fn load_meta_public(app: &tauri::AppHandle) -> Result<Value, String> {
    load_meta(app)
}

pub fn mime_of_public(name: &str) -> String {
    mime_of(name)
}

/// Atomically reserve a NEW destination; even concurrent uploads and suffix
/// exhaustion must never truncate an existing user file.
fn reserve_received(dir: &Path, raw_name: &str) -> Result<(PathBuf, fs::File), String> {
    let safe = safe_name(raw_name);
    let stem = Path::new(&safe).file_stem().unwrap_or_default().to_string_lossy();
    let ext = Path::new(&safe).extension().unwrap_or_default().to_string_lossy();
    for i in 0..1000 {
        let name = if i == 0 { safe.clone() } else if ext.is_empty() {
            format!("{stem} ({i})")
        } else { format!("{stem} ({i}).{ext}") };
        let path = dir.join(name);
        match fs::OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => return Ok((path, file)),
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("创建接收文件失败：{e}")),
        }
    }
    Err("同名文件过多，请更换文件名后重试；已有文件未被覆盖".into())
}

/// Bounded byte transport shared by LAN upload/download. A truncated request
/// fails instead of being published as a complete received file.
pub(crate) fn copy_exact(reader: &mut impl Read, writer: &mut impl Write, expected: u64) -> std::io::Result<()> {
    let mut buffer = vec![0u8; 1024 * 1024];
    let mut remaining = expected;
    while remaining > 0 {
        let limit = remaining.min(buffer.len() as u64) as usize;
        let count = reader.read(&mut buffer[..limit])?;
        if count == 0 { return Err(std::io::Error::new(std::io::ErrorKind::UnexpectedEof, "传输数据不完整")); }
        writer.write_all(&buffer[..count])?;
        remaining -= count as u64;
    }
    Ok(())
}

fn receive_into(meta_path: &Path, dir: &Path, raw_name: &str, input: &mut impl Read, length: u64) -> Result<String, String> {
    let (path, mut file) = reserve_received(dir, raw_name)?;
    let copied = copy_exact(input, &mut file, length).and_then(|_| file.sync_all()).map_err(|e| format!("接收失败：{e}"));
    drop(file);
    let name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
    // Do NOT hold the record lock while waiting for a slow phone/network.
    // Reload the latest record after the copy, merging concurrent changes.
    let result = copied.and_then(|_| update_metadata(meta_path, |meta| {
        if meta.get("receivedFiles").is_none() { meta["receivedFiles"] = json!([]); }
        let arr = meta["receivedFiles"].as_array_mut().ok_or("receivedFiles 不是数组")?;
        let id = crate::jobs::new_job_id_public();
        arr.insert(0, json!({"id": id, "name": name, "size": length,
            "mimeType": mime_of(&name), "createdAt": now_iso(), "path": path.to_string_lossy(),
            "downloadUrl": format!("/api/transfer/download?id={id}&type=received")}));
        Ok(())
    }));
    if result.is_err() {
        // This path was exclusively created by this call; never remove existing files.
        let _ = fs::remove_file(&path);
    }
    result.map(|_| name)
}

pub fn receive_stream(app: &tauri::AppHandle, name: &str, input: &mut impl Read, length: u64) -> Result<String, String> {
    let meta = load_meta(app)?;
    let dir = effective_receive_dir(app, &meta);
    receive_into(&dirs(app).2, &dir, name, input, length)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> PathBuf {
        let p = std::env::temp_dir().join(format!("fk-transfer-v45-{}", crate::jobs::new_job_id_public()));
        fs::create_dir(&p).unwrap(); p
    }
    #[test]
    fn same_name_exhaustion_never_overwrites_original() {
        let p = root();
        fs::write(p.join("photo.txt"), b"original").unwrap();
        for i in 1..1000 { fs::write(p.join(format!("photo ({i}).txt")), b"keep").unwrap(); }
        assert!(reserve_received(&p, "photo.txt").is_err());
        assert_eq!(fs::read(p.join("photo.txt")).unwrap(), b"original");
        assert_eq!(fs::read_dir(&p).unwrap().count(), 1000);
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn concurrent_same_names_reserve_distinct_files() {
        let p = root();
        let workers: Vec<_> = (0..12).map(|i| { let p=p.clone(); std::thread::spawn(move || {
            let (path, mut f) = reserve_received(&p, "同名.txt").unwrap();
            f.write_all(&[i]).unwrap(); path
        }) }).collect();
        let paths: std::collections::HashSet<_> = workers.into_iter().map(|t| t.join().unwrap()).collect();
        assert_eq!(paths.len(),12);
        assert_eq!(fs::read_dir(&p).unwrap().count(),12);
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn truncated_upload_preserves_previous_file_and_record() {
        let p=root();let meta=p.join("metadata.json");let dir=p.join("received");fs::create_dir(&dir).unwrap();
        fs::write(dir.join("x.txt"),b"keep").unwrap();
        write_metadata(&meta,&json!({"sharedFiles":[],"receivedFiles":[],"clipboardText":"public fixture"})).unwrap();
        let before=fs::read(&meta).unwrap();
        assert!(receive_into(&meta,&dir,"x.txt",&mut &b"short"[..],20).is_err());
        assert_eq!(fs::read(dir.join("x.txt")).unwrap(),b"keep");
        assert_eq!(fs::read_dir(&dir).unwrap().count(),1);
        assert_eq!(fs::read(&meta).unwrap(),before);
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn corrupt_record_is_not_replaced_by_empty_state() {
        let p=root();let meta=p.join("metadata.json");let dir=p.join("received");fs::create_dir(&dir).unwrap();
        fs::write(&meta,b"{broken").unwrap();
        assert!(update_metadata(&meta,|m|{m["clipboardText"]=json!("new");Ok(())}).is_err());
        assert!(receive_into(&meta,&dir,"public.txt",&mut &b"public"[..],6).is_err());
        assert_eq!(fs::read(&meta).unwrap(),b"{broken");
        assert_eq!(fs::read_dir(&dir).unwrap().count(),0);
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn completed_receives_merge_concurrently_with_other_metadata_changes() {
        let p=root();let meta=p.join("metadata.json");let dir=p.join("received");fs::create_dir(&dir).unwrap();
        let workers: Vec<_>=(0..8).map(|i| {let m=meta.clone();let d=dir.clone();std::thread::spawn(move ||{
            receive_into(&m,&d,"public.bin",&mut std::io::Cursor::new(vec![i; 20000]),20000).unwrap();
            update_metadata(&m,|v|{v[format!("flag{i}")]=json!(true);Ok(())}).unwrap();
        })}).collect();
        for w in workers {w.join().unwrap();}
        let state=read_metadata(&meta).unwrap();
        assert_eq!(state["receivedFiles"].as_array().unwrap().len(),8);
        for i in 0..8 {assert_eq!(state[format!("flag{i}")],true);}
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn copy_uses_bounded_reads_and_stops_at_declared_length() {
        struct Input { left:usize, maximum:usize }
        impl Read for Input {fn read(&mut self,b:&mut [u8])->std::io::Result<usize>{
            assert!(b.len()<=1024*1024); self.maximum=self.maximum.max(b.len());
            let n=self.left.min(b.len());b[..n].fill(91);self.left-=n;Ok(n)
        }}
        let size=34*1024*1024+7; let mut input=Input{left:size+13,maximum:0};
        copy_exact(&mut input,&mut std::io::sink(),size as u64).unwrap();
        assert_eq!(input.left,13);assert_eq!(input.maximum,1024*1024);
    }
    #[test]
    fn metadata_child_process() {
        let Some(path)=std::env::var_os("FK_V45_META_TEST") else {return};
        let path=PathBuf::from(path);
        assert!(path.parent().unwrap().file_name().unwrap().to_string_lossy().starts_with("fk-transfer-v45-"));
        for _ in 0..30 {
            update_metadata(&path,|v|{let n=v["count"].as_u64().unwrap_or(0);v["count"]=json!(n+1);Ok(())}).unwrap();
        }
    }
    #[test]
    fn separate_processes_do_not_lose_record_updates() {
        let p=root(); let meta=p.join("metadata.json");
        let mut children=Vec::new();
        for _ in 0..3 {
            children.push(std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact","transfer::tests::metadata_child_process","--nocapture"])
                .env("FK_V45_META_TEST",&meta).spawn().unwrap());
        }
        for mut child in children {assert!(child.wait().unwrap().success());}
        assert_eq!(read_metadata(&meta).unwrap()["count"],90);
        fs::remove_dir_all(p).unwrap();
    }
}
