//! Explicit user save actions target the configured output directory. Never overwrite by default.
use std::{fs, io::{Read, Write}, path::{Path, PathBuf}};
use tauri::Manager;

pub fn directory(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let settings = crate::api::read_settings_public(app);
    if crate::capture_validation::enabled() {
        return crate::capture_validation::output(settings["outputDir"].as_str());
    }
    let path = match settings["outputDir"].as_str().map(str::trim).filter(|s| !s.is_empty()) {
        Some(dir) => PathBuf::from(dir),
        None => app.path().download_dir().map_err(|e| format!("无法确定默认下载目录：{e}"))?,
    };
    if !path.is_absolute() { return Err("默认输出目录必须是绝对路径，请在设置中重新选择".into()); }
    fs::create_dir_all(&path).map_err(|e| format!("默认输出目录不可用，请在设置中重新选择：{e}"))?;
    fs::canonicalize(&path).map_err(|e| format!("无法访问默认输出目录：{e}"))?;
    Ok(path)
}

#[tauri::command]
pub async fn sync_output_directory(app: tauri::AppHandle, preferred: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move||{
    let preferred=if crate::capture_validation::enabled() {
        preferred.map(|value|crate::capture_validation::output(Some(&value)).map(|p|p.to_string_lossy().into_owned())).transpose()?
    } else { preferred };
    if let Some(dir) = preferred.map(|s| s.trim().to_owned()).filter(|s| !s.is_empty()) {
        let path = PathBuf::from(&dir);
        if !path.is_absolute() || !path.is_dir() { return Err("默认输出目录无效或不存在，请在设置中选择有效文件夹".into()); }
        // Serialize read/modify/write here so rapid settings synchronization cannot lose itself.
        static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
        let _guard = LOCK.lock().map_err(|_| "输出设置暂不可用")?;
        let mut settings = crate::api::read_settings_public(&app);
        if settings["outputDir"].as_str() != Some(dir.as_str()) {
            settings["outputDir"] = serde_json::json!(dir);
            crate::api::write_settings_public(&app, &settings)?;
        }
    }
    directory(&app).map(|p| p.to_string_lossy().into_owned())
    }).await.map_err(|e|e.to_string())?
}

#[tauri::command]
pub fn open_output_directory(app: tauri::AppHandle) -> Result<(), String> {
    let dir = directory(&app)?;
    crate::commands::open_path(app, dir.to_string_lossy().into_owned())
}

fn safe_name(name: &str) -> String {
    let leaf = name.rsplit(['/', '\\']).next().unwrap_or("");
    let clean: String = leaf.chars().map(|c| if c.is_control() || "<>:\"|?*".contains(c) { '_' } else { c }).collect();
    let clean = clean.trim_matches(['.', ' ']);
    if clean.is_empty() { return "结果.bin".into(); }
    let (stem, ext) = match clean.rsplit_once('.') {
        Some((s,e)) if !s.is_empty() && e.chars().count() <= 16 => (s, format!(".{e}")),
        _ => (clean, String::new()),
    };
    let mut stem: String = stem.chars().take(100).collect();
    stem = stem.trim_end_matches(['.', ' ']).to_owned();
    let head = stem.split('.').next().unwrap_or("").to_ascii_uppercase();
    if matches!(head.as_str(), "CON" | "PRN" | "AUX" | "NUL") || (head.len() == 4 && (head.starts_with("COM") || head.starts_with("LPT")) && matches!(head.as_bytes()[3], b'1'..=b'9')) { stem.insert(0,'_'); }
    format!("{stem}{ext}")
}
fn numbered(name: &str, index: usize) -> String {
    if index == 0 { return name.to_owned(); }
    match name.rsplit_once('.') {
        Some((s,e)) => format!("{s} ({index}).{e}"),
        None => format!("{name} ({index})"),
    }
}
pub fn write_to_directory(dir: &Path, name: &str, writer: impl FnOnce(&mut fs::File) -> Result<(), String>) -> Result<PathBuf, String> {
    let dir = fs::canonicalize(dir).map_err(|e| format!("输出目录不可用：{e}"))?;
    if !dir.is_dir() { return Err("输出位置不是文件夹".into()); }
    let temp = dir.join(format!(".fk-export-{}.part", crate::jobs::new_job_id_public()));
    let mut file = fs::OpenOptions::new().create_new(true).write(true).open(&temp).map_err(|e| format!("无法写入输出目录：{e}"))?;
    let written = writer(&mut file).and_then(|_| file.sync_all().map_err(|e| e.to_string()));
    drop(file);
    let result = written.and_then(|_| {
        let name = safe_name(name);
        for index in 0..10000 {
            let destination = dir.join(numbered(&name, index));
            match fs::hard_link(&temp, &destination) {
                Ok(()) => return Ok(destination), // Atomic no-replace publication on NTFS.
                Err(_) if fs::symlink_metadata(&destination).is_ok() => continue,
                Err(_) => {
                    // FAT/exFAT/network shares may not support links. Exclusively create,
                    // never truncate an existing target; remove only this attempt's copy on error.
                    let mut target = match fs::OpenOptions::new().create_new(true).write(true).open(&destination) {
                        Ok(f) => f,
                        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                        Err(e) => return Err(format!("保存失败：{e}")),
                    };
                    let copied = fs::File::open(&temp).and_then(|mut input| std::io::copy(&mut input, &mut target)).and_then(|_| target.sync_all());
                    drop(target);
                    if let Err(e) = copied { let _ = fs::remove_file(&destination); return Err(format!("保存失败：{e}")); }
                    return Ok(destination);
                }
            }
        }
        Err("同名文件过多，请整理输出目录或修改结果文件名".into())
    });
    let _ = fs::remove_file(&temp); // Only the unique staging file created by this call.
    result
}
pub fn copy_to_directory(source: &Path, dir: &Path, name: &str) -> Result<PathBuf, String> {
    let mut input = fs::File::open(source).map_err(|e| format!("结果文件不可用：{e}"))?;
    let meta = input.metadata().map_err(|e| e.to_string())?;
    if !meta.is_file() { return Err("结果不是文件".into()); }
    let expected = meta.len();
    write_to_directory(dir, name, |output| {
        let copied = std::io::copy(&mut (&mut input).take(expected), output).map_err(|e| e.to_string())?;
        if copied != expected || input.metadata().map_err(|e| e.to_string())?.len() != expected { return Err("保存期间结果文件发生变化，请重试".into()); }
        Ok(())
    })
}
pub fn save_file(app: &tauri::AppHandle, source: &Path, name: &str) -> Result<PathBuf, String> { copy_to_directory(source, &directory(app)?, name) }
pub fn save_bytes(app: &tauri::AppHandle, bytes: &[u8], name: &str) -> Result<PathBuf, String> {
    write_to_directory(&directory(app)?, name, |f| f.write_all(bytes).map_err(|e| e.to_string()))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> PathBuf { let p=std::env::temp_dir().join(format!("fk-output-{}",crate::jobs::new_job_id_public()));fs::create_dir_all(&p).unwrap();p }
    #[test]
    fn same_names_preserve_originals_and_clean_parts() {
        let dir=root();let source=dir.join("source.txt");fs::write(&source,b"new result").unwrap();fs::write(dir.join("结果.txt"),b"existing").unwrap();
        let saved=copy_to_directory(&source,&dir,"结果.txt").unwrap();assert_eq!(saved.file_name().unwrap(),"结果 (1).txt");assert_eq!(fs::read(dir.join("结果.txt")).unwrap(),b"existing");assert_eq!(fs::read(&saved).unwrap(),b"new result");
        let alias=copy_to_directory(&source,&dir,"source.txt").unwrap();assert_ne!(alias,fs::canonicalize(&source).unwrap());assert_eq!(fs::read(&source).unwrap(),b"new result");
        assert!(!fs::read_dir(&dir).unwrap().any(|e|e.unwrap().file_name().to_string_lossy().ends_with(".part")));fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn failed_writer_never_publishes_and_keeps_existing() {
        let dir=root();fs::write(dir.join("x.txt"),b"keep").unwrap();
        assert!(write_to_directory(&dir,"x.txt",|f|{f.write_all(b"partial").unwrap();Err("test".into())}).is_err());assert_eq!(fs::read_dir(&dir).unwrap().count(),1);assert_eq!(fs::read(dir.join("x.txt")).unwrap(),b"keep");fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn names_and_concurrent_exports_are_safe() {
        assert_eq!(safe_name("../../CON.txt"),"_CON.txt");assert_eq!(safe_name("x\\a.png"),"a.png");assert!(!safe_name("x:ads").contains(':'));assert_eq!(safe_name(".."),"结果.bin");assert!(safe_name(&format!("{}.png","字".repeat(300))).ends_with(".png"));
        let dir=root();let mut threads=vec![];for n in 0..8 {let d=dir.clone();threads.push(std::thread::spawn(move||write_to_directory(&d,"same.bin",|f|f.write_all(&[n]).map_err(|e|e.to_string())).unwrap()));}
        let paths:std::collections::HashSet<_>=threads.into_iter().map(|t|t.join().unwrap()).collect();assert_eq!(paths.len(),8);assert_eq!(fs::read_dir(&dir).unwrap().count(),8);fs::remove_dir_all(dir).unwrap();
    }
}
