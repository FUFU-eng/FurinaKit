//! Bounded disk-to-disk result export to Settings output directory, with no file bytes over IPC.
use std::{fs, io::{Read, Write}, path::Path};
pub(crate) fn copy_result(source: &Path, destination: &Path) -> Result<(), String> {
    let source = fs::canonicalize(source).map_err(|e| format!("结果文件不可用：{e}"))?;
    if fs::canonicalize(destination).ok().as_deref() == Some(source.as_path()) { return Err("不能覆盖原始结果，请选择其他位置".into()); }
    let parent = destination.parent().ok_or("保存位置无效")?;
    let temporary = parent.join(format!(".furinakit-save-{}.part",crate::jobs::new_job_id_public()));
    let mut input = fs::File::open(&source).map_err(|e| format!("打开结果失败：{e}"))?;
    let expected = input.metadata().map_err(|e| e.to_string())?.len();
    let mut output = fs::OpenOptions::new().create_new(true).write(true).open(&temporary).map_err(|e| format!("创建保存文件失败：{e}"))?;
    let result = (|| {
        let mut buffer = vec![0u8; 1024 * 1024];
        let mut copied = 0u64;
        loop { let count=input.read(&mut buffer).map_err(|e| e.to_string())?; if count==0 {break;} output.write_all(&buffer[..count]).map_err(|e| e.to_string())?;copied+=count as u64; }
        if copied != expected { return Err("复制过程中结果文件发生变化，请重试".to_string()); }
        output.sync_all().map_err(|e| e.to_string())?;
        Ok(())
    })();
    drop(output);
    let result = result.and_then(|_| fs::rename(&temporary,destination).map_err(|e| format!("保存文件失败：{e}")));
    // Only remove the unique temporary copy created above, never source or destination.
    if result.is_err() { let _=fs::remove_file(&temporary); }
    result
}
#[tauri::command]
pub async fn save_job_result(app: tauri::AppHandle, job_id: String, filename: String, artifact: Option<String>) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let job = crate::jobs::read_job_public(&app,&job_id).ok_or("找不到任务")?;
        if crate::capture_validation::enabled() && !crate::capture_validation::job_export_allowed(&job,artifact.as_deref()) {
            return Err("Only owned upscale results may be exported in this validation scope".into());
        }
        let (source, key) = match artifact.as_deref() {
            None => (crate::jobs::job_artifact(&app,&job), "resultFilename"),
            Some("ocr-text") => (crate::artifact_store::resolve_ocr_text(&crate::jobs::storage_dir_of(&app),&job), "textResultFilename"),
            _ => return Err("未知结果类型 / Unknown artifact".into()),
        };
        let source = source.ok_or("任务尚未完成或结果文件不可用")?;
        let filename = if filename.trim().is_empty() { job[key].as_str().unwrap_or("result.bin").to_string() } else { filename };
        let destination=crate::default_output::save_file(&app, &source, &filename)?;
        let meta=fs::metadata(&destination).map_err(|e|format!("无法确认保存结果：{e}"))?;
        if !meta.is_file()||meta.len()==0{return Err("保存结果为空或不可读".into());}
        Ok(plain_path(&destination))
    }).await.map_err(|e| e.to_string())?
}
/// 去掉 Windows 扩展路径前缀（\\?\），避免提示里显示成 "\\?\C:\..."，也便于交给外部程序打开。
pub(crate) fn plain_path(p: &std::path::Path) -> String {
    let raw = p.to_string_lossy();
    if let Some(rest) = raw.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = raw.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        raw.into_owned()
    }
}

/// 「浏览器中打开」：把任务结果复制到临时预览目录，用 Edge 打开（没有 Edge 时用系统默认程序）。
/// 旧实现是 <a target=_blank href="/api/jobs/..">，在桌面 WebView 里只会被当成下载，根本打不开。
#[tauri::command]
pub async fn open_job_result(app: tauri::AppHandle, job_id: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let job = crate::jobs::read_job_public(&app, &job_id).ok_or("找不到任务")?;
        let source = crate::jobs::job_artifact(&app, &job).ok_or("任务尚未完成或结果文件不可用")?;
        let name = job["resultFilename"].as_str().unwrap_or("result.pdf");
        let safe: String = name
            .chars()
            .map(|c| if matches!(c, '<' | '>' | ':' | '"' | '/' | '\\' | '|' | '?' | '*') || c.is_control() { '_' } else { c })
            .collect();
        let dir = std::env::temp_dir().join("FurinaKit-preview").join(job_id.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').collect::<String>());
        fs::create_dir_all(&dir).map_err(|e| format!("创建预览目录失败：{e}"))?;
        let target = dir.join(if safe.trim().is_empty() { "result.pdf".to_string() } else { safe });
        fs::copy(&source, &target).map_err(|e| format!("复制预览文件失败：{e}"))?;
        let path = plain_path(&target);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let url = format!("file:///{}", path.replace('\\', "/").replace(' ', "%20").replace('#', "%23"));
            // start 会按 App Paths 查找 msedge；找不到再退回系统默认关联程序
            let edge = std::process::Command::new("cmd")
                .args(["/C", "start", "", "msedge", &url])
                .creation_flags(0x0800_0000)
                .status();
            if !matches!(edge, Ok(s) if s.success()) {
                std::process::Command::new("explorer")
                    .arg(&path)
                    .creation_flags(0x0800_0000)
                    .spawn()
                    .map_err(|e| format!("打开失败：{e}"))?;
            }
        }
        #[cfg(not(windows))]
        {
            let _ = std::process::Command::new("xdg-open").arg(&path).spawn();
        }
        Ok(path)
    })
    .await
    .map_err(|e| e.to_string())?
}
/// Receive only a transfer record ID/kind, never an arbitrary source/destination path.
#[tauri::command]
pub async fn save_transfer_result(app: tauri::AppHandle, file_id: String, kind: String) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let (source, filename) = crate::transfer::artifact_path(&app, &file_id, &kind).ok_or("找不到互传文件或文件已移除")?;
        crate::default_output::save_file(&app, &source, &filename)?;
        Ok(true)
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn alias_and_failed_source_preserve_existing_files() {
        let root=std::env::temp_dir().join(format!("fk-save-alias-{}",crate::jobs::new_job_id_public()));
        fs::create_dir(&root).unwrap();
        let source=root.join("source.mp4"); let dest=root.join("existing.mp4");
        fs::write(&source,b"recording").unwrap(); fs::write(&dest,b"keep existing").unwrap();
        assert!(copy_result(&source,&root.join(".").join("source.mp4")).is_err());
        assert_eq!(fs::read(&source).unwrap(),b"recording");
        assert!(copy_result(&root.join("missing.mp4"),&dest).is_err());
        assert_eq!(fs::read(&dest).unwrap(),b"keep existing");
        assert_eq!(fs::read_dir(&root).unwrap().count(),2);
        fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn export_overwrites_only_selected_destination_and_preserves_source() {
        let root=std::env::temp_dir().join(format!("fk-save-test-{}",crate::jobs::new_job_id_public()));fs::create_dir(&root).unwrap();let src=root.join("src.mp4");let dst=root.join("dst.mp4");fs::write(&src,b"result data").unwrap();fs::write(&dst,b"old").unwrap();let canonical=fs::canonicalize(&src).unwrap();
        copy_result(&canonical,&dst).unwrap();assert_eq!(fs::read(&dst).unwrap(),b"result data");assert!(copy_result(&canonical,&src).is_err());assert_eq!(fs::read(&src).unwrap(),b"result data");assert!(copy_result(&canonical,&root.join("missing/out")).is_err());assert_eq!(fs::read_dir(&root).unwrap().count(),2);fs::remove_dir_all(root).unwrap();
    }
}
