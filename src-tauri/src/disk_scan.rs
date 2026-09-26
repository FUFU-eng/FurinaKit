//! Bounded, read-only disk inspection. Catalog requests never enumerate files.
//! Deletion is deliberately not implemented and will not be added: after the
//! 2026-09-18 product decision this surface stays read-only for good.
use serde_json::{json, Value};
use std::{collections::BTreeMap, fs, path::{Path, PathBuf}, time::{Instant, UNIX_EPOCH}};

const MAX_ENTRIES: usize = 20_000;
const MAX_DEPTH: usize = 12;
const MAX_RESULTS: usize = 300;

fn roots() -> Vec<Value> {
    let mut out = Vec::new();
    if let Ok(home) = std::env::var("USERPROFILE") {
        if !home.trim().is_empty() {
            for (id, label, folder) in [("downloads", "下载目录", "Downloads"), ("desktop", "桌面", "Desktop"), ("documents", "文档", "Documents"), ("videos", "视频", "Videos")] {
                out.push(json!({"id":id,"label":label,"path":Path::new(&home).join(folder).to_string_lossy()}));
            }
        }
    }
    if let Ok(temp) = std::env::var("TEMP") {
        if !temp.trim().is_empty() { out.push(json!({"id":"temp","label":"用户临时目录","path":temp})); }
    }
    out
}

fn minimum(args: &Value) -> Result<u64, String> {
    let mb = match args.get("minMB") {
        None => 100,
        Some(Value::Number(n)) => n.as_u64().ok_or("体积下限必须是非负整数")?,
        Some(Value::String(s)) if !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit()) => s.parse::<u64>().map_err(|_| "体积下限过大")?,
        _ => return Err("体积下限必须是非负整数".into()),
    };
    if mb > 1_048_576 { return Err("体积下限不能超过 1 TiB".into()); }
    mb.checked_mul(1024 * 1024).ok_or_else(|| "体积下限过大".into())
}

fn is_link(meta: &fs::Metadata) -> bool {
    if meta.file_type().is_symlink() { return true; }
    #[cfg(windows)] {
        use std::os::windows::fs::MetadataExt;
        if meta.file_attributes() & 0x400 != 0 { return true; } // all reparse points, including junctions
    }
    false
}

fn validate_root(root: &Path) -> Result<(), String> {
    if !root.is_absolute() { return Err("请输入本机文件夹的完整绝对路径".into()); }
    #[cfg(windows)]
    if root.to_string_lossy().starts_with("\\\\") { return Err("暂不扫描网络共享或设备路径".into()); }
    for ancestor in root.ancestors() {
        let meta = fs::symlink_metadata(ancestor).map_err(|_| "目录不存在或无法访问")?;
        if is_link(&meta) { return Err("为避免越界，暂不扫描符号链接或联接目录".into()); }
    }
    if !root.is_dir() { return Err("扫描位置必须是文件夹".into()); }
    Ok(())
}

pub fn dispatch(method: &str, args: &Value) -> Result<Value, String> {
    if method != "GET" { return Err("此接口仅提供只读扫描，不提供删除功能；未修改任何文件".into()); }
    // Missing root means catalog only. Never fall back to scanning real personal folders.
    let root = match args.get("root") {
        None => return Ok(json!({"roots":roots(),"files":[],"dirs":[],"scanned":false,"canRecycle":false,"scanTruncated":false,"resultsTruncated":false})),
        Some(Value::String(s)) if !s.trim().is_empty() => PathBuf::from(s.trim()),
        _ => return Err("请明确选择或输入要扫描的文件夹".into()),
    };
    let mode = args.get("mode").and_then(Value::as_str).unwrap_or("files");
    if mode != "files" && mode != "dirs" { return Err("不支持的扫描方式".into()); }
    let min_bytes = minimum(args)?;
    validate_root(&root)?;
    scan(&root, mode, min_bytes, MAX_ENTRIES, MAX_DEPTH)
}

fn scan(root: &Path, mode: &str, min_bytes: u64, max_entries: usize, max_depth: usize) -> Result<Value, String> {
    let start = Instant::now();
    let mut stack = vec![(root.to_path_buf(), 0usize, None::<PathBuf>)];
    let mut files = Vec::new();
    let mut groups: BTreeMap<PathBuf, (u64, u64)> = BTreeMap::new();
    let (mut visited, mut skipped) = (0usize, 0usize);
    let mut scan_truncated = false;
    'walk: while let Some((dir, depth, group)) = stack.pop() {
        let entries = match fs::read_dir(&dir) {
            Ok(v) => v,
            Err(_) if depth == 0 => return Err("无法读取所选文件夹".into()),
            Err(_) => { skipped += 1; continue; }
        };
        for entry in entries {
            if visited >= max_entries || start.elapsed().as_secs() >= 15 { scan_truncated = true; break 'walk; }
            visited += 1;
            let entry = match entry { Ok(v) => v, Err(_) => { skipped += 1; continue; } };
            let path = entry.path();
            let meta = match fs::symlink_metadata(&path) { Ok(v) => v, Err(_) => { skipped += 1; continue; } };
            if is_link(&meta) { skipped += 1; continue; }
            if meta.is_dir() {
                if depth >= max_depth { scan_truncated = true; continue; }
                let g = group.clone().or_else(|| Some(path.clone()));
                if let Some(ref p) = g { groups.entry(p.clone()).or_default(); }
                stack.push((path, depth + 1, g));
            } else if meta.is_file() {
                if let Some(ref g) = group { let v = groups.entry(g.clone()).or_default(); v.0 = v.0.saturating_add(meta.len()); v.1 += 1; }
                if mode == "files" && meta.len() >= min_bytes {
                    let modified = meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map(|d| d.as_millis() as u64);
                    files.push(json!({"path":path.to_string_lossy(),"name":entry.file_name().to_string_lossy(),"sizeBytes":meta.len(),"modified":modified,"kind":path.extension().map(|s|s.to_string_lossy().to_lowercase()).unwrap_or_default()}));
                }
            }
        }
    }
    files.sort_by(|a,b| b["sizeBytes"].as_u64().cmp(&a["sizeBytes"].as_u64()).then_with(||a["path"].as_str().cmp(&b["path"].as_str())));
    let mut dirs: Vec<Value> = if mode == "dirs" { groups.into_iter().map(|(p,(size,count))|json!({"path":p.to_string_lossy(),"name":p.file_name().map(|s|s.to_string_lossy()).unwrap_or_default(),"sizeBytes":size,"fileCount":count})).collect() } else { vec![] };
    dirs.sort_by(|a,b| b["sizeBytes"].as_u64().cmp(&a["sizeBytes"].as_u64()).then_with(||a["path"].as_str().cmp(&b["path"].as_str())));
    let result_count = if mode == "files" { files.len() } else { dirs.len() };
    let results_truncated = result_count > MAX_RESULTS;
    files.truncate(MAX_RESULTS); dirs.truncate(MAX_RESULTS);
    Ok(json!({"files":files,"dirs":dirs,"scanned":true,"root":root.to_string_lossy(),"mode":mode,"minBytes":min_bytes,"visitedEntries":visited,"skippedEntries":skipped,"scanTruncated":scan_truncated,"resultsTruncated":results_truncated,"resultCount":result_count,"canRecycle":false,"maxDepth":max_depth,"maxEntries":max_entries,"maxResults":MAX_RESULTS}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    static N: AtomicUsize = AtomicUsize::new(0);
    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self { let p=std::env::temp_dir().join(format!("furinakit-v33-scan-{}-{}",std::process::id(),N.fetch_add(1,Ordering::SeqCst)));fs::create_dir(&p).unwrap();Self(p) }
        fn file(&self,name:&str,len:u64) { let p=self.0.join(name);fs::create_dir_all(p.parent().unwrap()).unwrap();fs::File::create(p).unwrap().set_len(len).unwrap(); }
    }
    impl Drop for Fixture { fn drop(&mut self) { let _=fs::remove_dir_all(&self.0); } }
    #[test] fn catalog_never_scans() { let v=dispatch("GET",&json!({})).unwrap();assert_eq!(v["scanned"],false);assert_eq!(v["files"],json!([]));assert_eq!(v["canRecycle"],false); }
    #[test] fn empty_and_relative_roots_rejected() { for p in ["", "relative/path"] { assert!(dispatch("GET",&json!({"root":p})).is_err()); } }
    #[test] fn strict_threshold() { for v in [json!("10abc"),json!("-1"),json!(-1),json!(1.2),json!(""),json!("18446744073709551615")] { assert!(minimum(&json!({"minMB":v})).is_err()); } assert_eq!(minimum(&json!({"minMB":"10"})).unwrap(),10*1024*1024); }
    #[test] fn file_fields_threshold_and_sort() { let f=Fixture::new();f.file("small.bin",2);f.file("nested/large.bin",12*1024*1024);let v=dispatch("GET",&json!({"root":f.0,"minMB":"10"})).unwrap();assert_eq!(v["files"].as_array().unwrap().len(),1);assert_eq!(v["files"][0]["name"],"large.bin");assert_eq!(v["files"][0]["sizeBytes"],12*1024*1024);assert!(v["files"][0]["modified"].is_number());assert!(!v["scanTruncated"].as_bool().unwrap()); }
    #[test] fn directory_mode_aggregates_without_threshold() { let f=Fixture::new();f.file("alpha/1.bin",7);f.file("alpha/nested/2.bin",9);f.file("beta/3.bin",2);let v=dispatch("GET",&json!({"root":f.0,"mode":"dirs"})).unwrap();assert_eq!(v["dirs"][0]["name"],"alpha");assert_eq!(v["dirs"][0]["sizeBytes"],16);assert_eq!(v["dirs"][0]["fileCount"],2);assert_eq!(v["files"],json!([])); }
    #[test] fn methods_and_modes_rejected_without_mutation() { let f=Fixture::new();f.file("keep.bin",5);for m in ["POST","DELETE","PUT"] { assert!(dispatch(m,&json!({"root":f.0,"paths":[f.0.join("keep.bin")]})).is_err()); }assert_eq!(fs::metadata(f.0.join("keep.bin")).unwrap().len(),5);assert!(dispatch("GET",&json!({"root":f.0,"mode":"unknown"})).is_err()); }
    #[test] fn missing_and_file_roots_rejected() { let f=Fixture::new();f.file("file.bin",1);for root in [f.0.join("missing"),f.0.join("file.bin")] { assert!(dispatch("GET",&json!({"root":root})).is_err()); } }
    #[test] fn bounded_walk_is_reported() { let f=Fixture::new();f.file("a.bin",1);f.file("b.bin",1);let v=scan(&f.0,"files",0,1,12).unwrap();assert_eq!(v["scanTruncated"],true);assert_eq!(v["visitedEntries"],1); }
    #[test] fn bounded_depth_is_reported() { let f=Fixture::new();f.file("nested/deep.bin",5);let v=scan(&f.0,"files",0,100,0).unwrap();assert_eq!(v["scanTruncated"],true);assert_eq!(v["files"],json!([])); }
    #[cfg(unix)]
    #[test] fn symlink_escape_is_skipped() { use std::os::unix::fs::symlink;let f=Fixture::new();let outside=Fixture::new();outside.file("private.bin",99);symlink(&outside.0,f.0.join("link")).unwrap();let v=dispatch("GET",&json!({"root":f.0,"minMB":0})).unwrap();assert_eq!(v["files"],json!([]));assert_eq!(v["skippedEntries"],1);assert!(dispatch("GET",&json!({"root":f.0.join("link")})).is_err()); }
}
