//! 从 2.0.6（Electron 版）升级上来时的一次性数据导入，以及桌面设置（关闭按钮行为 / 开机自启）。
//!
//! 2.0.6 的前端数据（收藏、置顶、最近使用、各工具设置、记账、思维导图、主题……）存在
//! Electron 的 localStorage 里。安装版 2.0.6 的 package name 是 `@furinakit/web`，真实用户的数据在
//! `%APPDATA%\@furinakit\web\Local Storage\leveldb`；早期/开发版用 `%APPDATA%\FurinaKit`，两处都读。源是
//! `http://localhost:3001`。2.1.0 用的是 WebView2，localStorage 在另一个位置，键名却完全相同，
//! 所以这里只读不写：把旧库解析出来交给前端，由前端「只补缺失的键」写进去（不会覆盖任何现有数据）。
//!
//! LevelDB 只需要读：日志文件（*.log，写前日志）+ 表文件（*.ldb/*.sst，块用 snappy 压缩）。
//! 同一个键取序列号最大的那条记录；删除记录会遮住旧值。
use serde_json::{json, Map, Value};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    time::SystemTime,
};
use tauri::Manager;

const LEGACY_ORIGINS: [&str; 2] = ["http://localhost:3001", "http://127.0.0.1:3001"];
const MAX_FILE: u64 = 64 << 20;

fn varint(b: &[u8], i: &mut usize) -> Option<u64> {
    let mut r = 0u64;
    let mut s = 0u32;
    loop {
        let c = *b.get(*i)?;
        *i += 1;
        if s >= 64 {
            return None;
        }
        r |= ((c & 0x7f) as u64) << s;
        s += 7;
        if c < 0x80 {
            return Some(r);
        }
    }
}

fn snappy(b: &[u8]) -> Option<Vec<u8>> {
    let mut i = 0usize;
    let n = varint(b, &mut i)? as usize;
    if n > (MAX_FILE as usize) {
        return None;
    }
    let mut out: Vec<u8> = Vec::with_capacity(n);
    while i < b.len() {
        let t = b[i];
        i += 1;
        if t & 3 == 0 {
            let mut ln = (t >> 2) as usize;
            if ln >= 60 {
                let nb = ln - 59;
                let bytes = b.get(i..i + nb)?;
                ln = 0;
                for (k, x) in bytes.iter().enumerate() {
                    ln |= (*x as usize) << (8 * k);
                }
                i += nb;
            }
            ln += 1;
            out.extend_from_slice(b.get(i..i + ln)?);
            i += ln;
            continue;
        }
        let (ln, off) = match t & 3 {
            1 => {
                let o = (((t as usize) >> 5) << 8) | (*b.get(i)? as usize);
                i += 1;
                ((((t >> 2) & 7) as usize) + 4, o)
            }
            2 => {
                let o = u16::from_le_bytes(b.get(i..i + 2)?.try_into().ok()?) as usize;
                i += 2;
                (((t >> 2) as usize) + 1, o)
            }
            _ => {
                let o = u32::from_le_bytes(b.get(i..i + 4)?.try_into().ok()?) as usize;
                i += 4;
                (((t >> 2) as usize) + 1, o)
            }
        };
        if off == 0 || off > out.len() || out.len() + ln > n {
            return None;
        }
        for _ in 0..ln {
            let c = out[out.len() - off];
            out.push(c);
        }
    }
    (out.len() == n).then_some(out)
}

fn block_entries(blk: &[u8]) -> Vec<(Vec<u8>, Vec<u8>)> {
    let mut v = Vec::new();
    if blk.len() < 4 {
        return v;
    }
    let nre = u32::from_le_bytes([blk[blk.len() - 4], blk[blk.len() - 3], blk[blk.len() - 2], blk[blk.len() - 1]]) as usize;
    let Some(end) = blk.len().checked_sub(4 + 4 * nre) else {
        return v;
    };
    let mut i = 0usize;
    let mut last: Vec<u8> = Vec::new();
    while i < end {
        let Some(sh) = varint(blk, &mut i) else { break };
        let Some(ns) = varint(blk, &mut i) else { break };
        let Some(vl) = varint(blk, &mut i) else { break };
        let (sh, ns, vl) = (sh as usize, ns as usize, vl as usize);
        if sh > last.len() {
            break;
        }
        let Some(delta) = blk.get(i..i + ns) else { break };
        let mut k = last[..sh].to_vec();
        k.extend_from_slice(delta);
        i += ns;
        let Some(val) = blk.get(i..i + vl) else { break };
        i += vl;
        last = k.clone();
        v.push((k, val.to_vec()));
    }
    v
}

fn read_block(f: &[u8], off: usize, size: usize) -> Option<Vec<u8>> {
    let raw = f.get(off..off.checked_add(size)?.checked_add(1)?)?;
    let data = &raw[..size];
    if raw[size] == 1 {
        snappy(data)
    } else {
        Some(data.to_vec())
    }
}

type Best = HashMap<Vec<u8>, (u64, u8, Vec<u8>)>;

fn keep(best: &mut Best, k: Vec<u8>, seq: u64, typ: u8, v: Vec<u8>) {
    match best.get(&k) {
        Some((s, _, _)) if *s >= seq => {}
        _ => {
            best.insert(k, (seq, typ, v));
        }
    }
}

fn read_table(f: &[u8], best: &mut Best) -> Option<()> {
    if f.len() < 48 {
        return None;
    }
    let ft = &f[f.len() - 48..];
    if u64::from_le_bytes(ft[40..48].try_into().ok()?) != 0xdb4775248b80fb57 {
        return None;
    }
    let mut i = 0usize;
    varint(ft, &mut i)?;
    varint(ft, &mut i)?;
    let io = varint(ft, &mut i)? as usize;
    let isz = varint(ft, &mut i)? as usize;
    for (_, handle) in block_entries(&read_block(f, io, isz)?) {
        let mut j = 0usize;
        let Some(o) = varint(&handle, &mut j) else { continue };
        let Some(s) = varint(&handle, &mut j) else { continue };
        let Some(blk) = read_block(f, o as usize, s as usize) else { continue };
        for (k, v) in block_entries(&blk) {
            if k.len() < 8 {
                continue;
            }
            let (uk, tr) = k.split_at(k.len() - 8);
            let tr = u64::from_le_bytes(tr.try_into().ok()?);
            keep(best, uk.to_vec(), tr >> 8, (tr & 0xff) as u8, v);
        }
    }
    Some(())
}

fn apply_batch(r: &[u8], best: &mut Best) {
    if r.len() < 12 {
        return;
    }
    let seq = u64::from_le_bytes(r[0..8].try_into().unwrap_or([0; 8]));
    let cnt = u32::from_le_bytes(r[8..12].try_into().unwrap_or([0; 4]));
    let mut j = 12usize;
    for n in 0..cnt as u64 {
        let Some(&tag) = r.get(j) else { return };
        j += 1;
        let Some(kl) = varint(r, &mut j) else { return };
        let Some(k) = r.get(j..j + kl as usize) else { return };
        let k = k.to_vec();
        j += kl as usize;
        let v = if tag == 1 {
            let Some(vl) = varint(r, &mut j) else { return };
            let Some(v) = r.get(j..j + vl as usize) else { return };
            j += vl as usize;
            v.to_vec()
        } else {
            Vec::new()
        };
        keep(best, k, seq + n, tag, v);
    }
}

fn read_log(f: &[u8], best: &mut Best) {
    const BLOCK: usize = 32768;
    let mut i = 0usize;
    let mut buf: Vec<u8> = Vec::new();
    while i + 7 <= f.len() {
        let rem = BLOCK - (i % BLOCK);
        if rem < 7 {
            i += rem;
            continue;
        }
        let ln = u16::from_le_bytes([f[i + 4], f[i + 5]]) as usize;
        let typ = f[i + 6];
        if typ == 0 && ln == 0 {
            i += rem;
            continue;
        }
        let Some(data) = f.get(i + 7..i + 7 + ln) else { break };
        i += 7 + ln;
        match typ {
            1 => apply_batch(data, best),
            2 => buf = data.to_vec(),
            3 => buf.extend_from_slice(data),
            4 => {
                buf.extend_from_slice(data);
                let whole = std::mem::take(&mut buf);
                apply_batch(&whole, best);
            }
            _ => {}
        }
    }
}

fn decode(b: &[u8]) -> Option<String> {
    match b.first()? {
        0 => {
            let rest = &b[1..];
            if rest.len() % 2 != 0 {
                return None;
            }
            let units: Vec<u16> = rest.chunks(2).map(|c| u16::from_le_bytes([c[0], c[1]])).collect();
            String::from_utf16(&units).ok()
        }
        1 => Some(b[1..].iter().map(|&c| c as char).collect()),
        _ => None,
    }
}

/// origin → (key → value)
fn read_local_storage(dir: &Path) -> HashMap<String, HashMap<String, String>> {
    let mut best: Best = HashMap::new();
    let mut files: Vec<PathBuf> = fs::read_dir(dir)
        .map(|rd| rd.filter_map(|e| e.ok().map(|e| e.path())).collect())
        .unwrap_or_default();
    files.sort();
    for p in files.iter() {
        let ext = p.extension().and_then(|e| e.to_str()).unwrap_or("").to_ascii_lowercase();
        if !matches!(ext.as_str(), "ldb" | "sst" | "log") {
            continue;
        }
        if fs::metadata(p).map(|m| m.len() > MAX_FILE).unwrap_or(true) {
            continue;
        }
        let Ok(bytes) = fs::read(p) else { continue };
        if ext == "log" {
            read_log(&bytes, &mut best);
        } else {
            let _ = read_table(&bytes, &mut best);
        }
    }
    let mut out: HashMap<String, HashMap<String, String>> = HashMap::new();
    for (k, (_, typ, v)) in best {
        if typ != 1 || k.first() != Some(&b'_') {
            continue;
        }
        let Some(pos) = k.iter().position(|&c| c == 0) else { continue };
        let origin = String::from_utf8_lossy(&k[1..pos]).to_string();
        let (Some(key), Some(val)) = (decode(&k[pos + 1..]), decode(&v)) else { continue };
        out.entry(origin).or_default().insert(key, val);
    }
    out
}

fn wanted(key: &str) -> bool {
    key.starts_with("furina") && key.len() < 200
}

fn roaming(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok()?.parent().map(Path::to_path_buf)
}

fn newest_mtime(dir: &Path) -> Option<SystemTime> {
    fs::read_dir(dir)
        .ok()?
        .flatten()
        .filter_map(|e| e.metadata().ok()?.modified().ok())
        .max()
}

/// 2.0.6 可能的 userData 目录：安装版 `@furinakit\web`，早期/开发版 `FurinaKit`。
/// 最近用过的排前面（它的键优先），另一处只用来补缺。
fn legacy_roots(base: &Path) -> Vec<PathBuf> {
    let mut roots: Vec<(Option<SystemTime>, PathBuf)> = [base.join("@furinakit").join("web"), base.join("FurinaKit")]
        .into_iter()
        .filter(|r| r.is_dir())
        .map(|r| (newest_mtime(&r.join("Local Storage").join("leveldb")), r))
        .collect();
    roots.sort_by(|a, b| b.0.cmp(&a.0));
    roots.into_iter().map(|(_, r)| r).collect()
}

/// 前端首次启动时调用：返回 2.0.6 留下的 localStorage 条目（只读，不改旧数据）。
#[tauri::command]
pub fn legacy_local_storage(app: tauri::AppHandle) -> Result<Value, String> {
    let Some(base) = roaming(&app) else {
        return Ok(json!({ "found": false }));
    };
    let mut items = Map::new();
    let mut settings: Option<Value> = None;
    let mut found = false;
    let mut sources: Vec<String> = Vec::new();
    for root in legacy_roots(&base) {
        if settings.is_none() {
            settings = fs::read(root.join("furinakit-settings.json"))
                .ok()
                .and_then(|b| serde_json::from_slice::<Value>(&b).ok());
        }
        let dir = root.join("Local Storage").join("leveldb");
        if !dir.is_dir() {
            continue;
        }
        found = true;
        sources.push(root.to_string_lossy().into_owned());
        let all = read_local_storage(&dir);
        for origin in LEGACY_ORIGINS {
            if let Some(m) = all.get(origin) {
                for (k, v) in m {
                    if wanted(k) && !items.contains_key(k) {
                        items.insert(k.clone(), Value::String(v.clone()));
                    }
                }
            }
        }
    }
    Ok(json!({ "found": found || settings.is_some(), "items": items, "settings": settings, "sources": sources }))
}

fn desktop_settings_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    app.path().app_data_dir().ok().map(|d| d.join("desktop-settings-v1.json"))
}

fn read_desktop_settings(app: &tauri::AppHandle) -> Map<String, Value> {
    desktop_settings_path(app)
        .and_then(|p| fs::read(p).ok())
        .and_then(|b| serde_json::from_slice::<Value>(&b).ok())
        .and_then(|v| v.as_object().cloned())
        .unwrap_or_default()
}

/// 设置里选了「关闭窗口时：直接退出」
pub fn close_action_quit(app: &tauri::AppHandle) -> bool {
    read_desktop_settings(app).get("closeAction").and_then(|v| v.as_str()) == Some("quit")
}

#[cfg(windows)]
fn set_autostart(on: bool) -> Result<(), String> {
    const RUN: &str = r"HKCU\Software\Microsoft\Windows\CurrentVersion\Run";
    let reg = |args: &[&str]| -> bool {
        let mut c = std::process::Command::new("reg");
        c.args(args);
        crate::commands::no_window(&mut c);
        c.output().map(|o| o.status.success()).unwrap_or(false)
    };
    // 2.0.6（Electron）登记的名字是 furinakit.desktop.app / com.furinakit.app；统一换成 FurinaKit，
    // 避免开机启动两次。只删指向已安装 FurinaKit.exe 的项（开发环境里指向 electron.exe 的不动）。
    for legacy in ["furinakit.desktop.app", "com.furinakit.app"] {
        let mut q = std::process::Command::new("reg");
        q.args(["query", RUN, "/v", legacy]);
        crate::commands::no_window(&mut q);
        let points_to_app = q
            .output()
            .map(|o| o.status.success() && String::from_utf8_lossy(&o.stdout).to_ascii_lowercase().contains("furinakit.exe"))
            .unwrap_or(false);
        if points_to_app {
            let _ = reg(&["delete", RUN, "/v", legacy, "/f"]);
        }
    }
    if on {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let exe = exe.to_string_lossy().to_string();
        let exe = exe.strip_prefix(r"\\?\").unwrap_or(&exe).to_string();
        let data = format!("\"{exe}\"");
        if reg(&["add", RUN, "/v", "FurinaKit", "/t", "REG_SZ", "/d", &data, "/f"]) {
            Ok(())
        } else {
            Err("写入开机自启失败 / Could not enable launch at startup".into())
        }
    } else {
        let _ = reg(&["delete", RUN, "/v", "FurinaKit", "/f"]);
        Ok(())
    }
}

#[cfg(not(windows))]
fn set_autostart(_on: bool) -> Result<(), String> {
    Ok(())
}

/// 设置页每次改动都会调用（boot=true 时只同步「关闭按钮行为」，不动开机自启）。
#[tauri::command]
pub fn apply_desktop_settings(app: tauri::AppHandle, settings: Value, boot: Option<bool>) -> Result<Value, String> {
    let Some(path) = desktop_settings_path(&app) else {
        return Err("settings path unavailable".into());
    };
    let mut cur = read_desktop_settings(&app);
    let mut changed = false;
    if let Some(c) = settings.get("closeAction").and_then(|v| v.as_str()) {
        if (c == "quit" || c == "tray") && cur.get("closeAction").and_then(|v| v.as_str()) != Some(c) {
            cur.insert("closeAction".into(), Value::String(c.into()));
            changed = true;
        }
    }
    let mut autostart = Value::Null;
    if !boot.unwrap_or(false) {
        if let Some(a) = settings.get("autoStart").and_then(|v| v.as_bool()) {
            autostart = match set_autostart(a) {
                Ok(()) => json!(true),
                Err(e) => json!(e),
            };
            cur.insert("autoStart".into(), Value::Bool(a));
            changed = true;
        }
    }
    if changed {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let bytes = serde_json::to_vec_pretty(&Value::Object(cur)).map_err(|e| e.to_string())?;
        crate::atomic_store::write(&path, &bytes)?;
    }
    Ok(json!({ "success": true, "autoStart": autostart }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snappy_literal_and_copy() {
        // "abcabcabc": len 9, literal "abc", copy len 6 offset 3
        let enc = [9u8, 0x08, b'a', b'b', b'c', 0x09, 0x03];
        assert_eq!(snappy(&enc).unwrap(), b"abcabcabc");
    }

    #[test]
    fn decodes_chromium_string_prefixes() {
        assert_eq!(decode(&[1, b'd', b'a', b'r', b'k']).unwrap(), "dark");
        assert_eq!(decode(&[0, 0x2d, 0x4e]).unwrap(), "中");
    }

    #[test]
    fn log_batch_put_then_delete() {
        let mut best: Best = HashMap::new();
        let mut rec = Vec::new();
        rec.extend_from_slice(&5u64.to_le_bytes());
        rec.extend_from_slice(&2u32.to_le_bytes());
        rec.extend_from_slice(&[1, 1, b'k', 1, b'v']);
        rec.extend_from_slice(&[0, 1, b'k']);
        apply_batch(&rec, &mut best);
        assert_eq!(best.get(&b"k".to_vec()).unwrap().1, 0);
    }
}
