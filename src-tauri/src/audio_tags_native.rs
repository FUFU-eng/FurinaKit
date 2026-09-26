//! MP3 / 音频标签编辑器：纯 Rust + FFmpeg 原生实现（去 Python 化，替代 services/worker/app/tools/audio_tags.py）。
//!
//! 支持直接在音频容器中无损复制音频流（-c:a copy），毫秒级改写 ID3v2/Vorbis/MP4 标签，
//! 并支持嵌入或移除封面图片，原文件一个字节都不动。

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use serde_json::{json, Map, Value};

pub fn supported(tool: &str) -> bool {
    matches!(tool, "audio-tags")
}

struct Ctx<'a> {
    app: &'a tauri::AppHandle,
    id: &'a str,
}

impl<'a> Ctx<'a> {
    fn cancelled(&self) -> bool {
        crate::jobs::read_job_public(self.app, self.id)
            .and_then(|j| j.get("status").and_then(Value::as_str).map(|s| s == "failed"))
            .unwrap_or(false)
    }

    fn progress(&self, percent: u32, msg: &str) {
        crate::matting_native::progress(self.app, self.id, percent, msg);
    }
}

pub fn find_ffmpeg(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    if let Ok(dir) = crate::api::components_dir(app) {
        if let Ok((ff, _)) = crate::ffmpeg_components::verified_pair(&dir) {
            return Ok(ff);
        }
        let c1 = dir.join("ffmpeg.exe");
        if c1.is_file() {
            return Ok(c1);
        }
        let c2 = dir.join("ffmpeg").join("ffmpeg.exe");
        if c2.is_file() {
            return Ok(c2);
        }
    }
    let app_root = crate::app_root_of(app);
    if let Some(ff) = crate::runtime_layout::find_media_tool("ffmpeg", &app_root) {
        return Ok(ff);
    }
    if let Some(path_var) = std::env::var_os("PATH") {
        for p in std::env::split_paths(&path_var) {
            let exe = p.join("ffmpeg.exe");
            if exe.is_file() {
                return Ok(exe);
            }
            let plain = p.join("ffmpeg");
            if plain.is_file() {
                return Ok(plain);
            }
        }
    }
    #[cfg(windows)]
    {
        if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
            let winget_dir = PathBuf::from(local_app_data).join("Microsoft/WinGet/Packages");
            if winget_dir.is_dir() {
                if let Ok(entries) = std::fs::read_dir(&winget_dir) {
                    for entry in entries.flatten() {
                        let name = entry.file_name().to_string_lossy().to_string();
                        if name.starts_with("Gyan.FFmpeg") {
                            let cand = entry.path().join("bin/ffmpeg.exe");
                            if cand.is_file() {
                                return Ok(cand);
                            }
                            if let Ok(sub_entries) = std::fs::read_dir(entry.path()) {
                                for sub in sub_entries.flatten() {
                                    let cand_sub = sub.path().join("bin/ffmpeg.exe");
                                    if cand_sub.is_file() {
                                        return Ok(cand_sub);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }
    Ok(PathBuf::from("ffmpeg"))
}

fn results_path(app: &tauri::AppHandle, id: &str, filename: &str) -> Result<PathBuf, String> {
    let dir = crate::jobs::storage_dir_of(app).join("results");
    fs::create_dir_all(&dir).map_err(|e| format!("创建输出目录失败：{e}"))?;
    Ok(dir.join(format!("{id}-{filename}")))
}

fn mime_for_ext(ext: &str) -> &'static str {
    match ext.to_ascii_lowercase().as_str() {
        "mp3" => "audio/mpeg",
        "flac" => "audio/flac",
        "m4a" | "mp4" => "audio/mp4",
        "ogg" | "oga" => "audio/ogg",
        "opus" => "audio/opus",
        "wav" => "audio/wav",
        "aac" => "audio/aac",
        _ => "application/octet-stream",
    }
}

pub fn modify_tags(
    ffmpeg_bin: &Path,
    input_path: &Path,
    output_path: &Path,
    cover_image: Option<&Path>,
    remove_cover: bool,
    tags: &[(&str, &str)],
) -> Result<(), String> {
    let mut cmd = Command::new(ffmpeg_bin);
    cmd.arg("-hide_banner").arg("-loglevel").arg("error");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }

    cmd.arg("-i").arg(input_path);

    let ext = input_path.extension().and_then(|s| s.to_str()).unwrap_or("mp3").to_ascii_lowercase();

    if remove_cover {
        cmd.arg("-map").arg("0:a");
        cmd.arg("-c:a").arg("copy");
        cmd.arg("-vn");
    } else if let Some(cover) = cover_image {
        cmd.arg("-i").arg(cover);
        cmd.arg("-map").arg("0:a").arg("-map").arg("1:0");
        cmd.arg("-c").arg("copy");
        if ext == "mp3" {
            cmd.arg("-id3v2_version").arg("3");
            cmd.arg("-metadata:s:v").arg("title=Album cover");
            cmd.arg("-metadata:s:v").arg("comment=Cover (front)");
        } else if ext == "m4a" || ext == "mp4" {
            cmd.arg("-disposition:v:0").arg("attached_pic");
        } else {
            cmd.arg("-metadata:s:v").arg("title=Album cover");
        }
    } else {
        cmd.arg("-map").arg("0");
        cmd.arg("-c").arg("copy");
    }

    for (k, v) in tags {
        if !v.trim().is_empty() {
            cmd.arg("-metadata").arg(format!("{k}={v}"));
        }
    }

    cmd.arg("-y").arg(output_path);

    let output = cmd.output().map_err(|e| format!("执行 FFmpeg 失败：{e}"))?;
    if !output.status.success() {
        let err_msg = String::from_utf8_lossy(&output.stderr);
        return Err(format!("FFmpeg 写入标签失败：{}", err_msg.trim()));
    }

    if !output_path.exists() || fs::metadata(output_path).map(|m| m.len()).unwrap_or(0) == 0 {
        return Err("输出音频文件未生成或为空".into());
    }

    Ok(())
}

fn execute(
    ctx: &Ctx<'_>,
    input_path: &Path,
    input_name: &str,
    cover_image: Option<&Path>,
    payload: &Value,
) -> Result<Value, String> {
    ctx.progress(20, "正在解析音频标签参数…");

    let stem = Path::new(input_name).file_stem().and_then(|s| s.to_str()).unwrap_or("audio");
    let ext = Path::new(input_name).extension().and_then(|s| s.to_str()).unwrap_or("mp3");
    let out_filename = format!("{stem}_已改标签.{ext}");
    let target = results_path(ctx.app, ctx.id, &out_filename)?;

    let remove_cover = payload.get("remove_cover").and_then(Value::as_str) == Some("yes");

    let tag_keys = [
        ("title", "title"),
        ("artist", "artist"),
        ("album", "album"),
        ("albumartist", "album_artist"),
        ("date", "date"),
        ("genre", "genre"),
        ("track", "track"),
        ("disc", "disc"),
        ("composer", "composer"),
        ("comment", "comment"),
        ("lyrics", "lyrics"),
    ];

    let mut tags = Vec::new();
    for (ui_key, ffmpeg_key) in tag_keys {
        if let Some(val) = payload.get(ui_key).and_then(Value::as_str) {
            if !val.trim().is_empty() {
                tags.push((ffmpeg_key, val.trim()));
            }
        }
    }

    if tags.is_empty() && !remove_cover && cover_image.is_none() {
        return Err("没有要修改的内容：请至少填写一个标签字段，或选择更换/移除封面".into());
    }

    ctx.progress(50, "正在写入音频标签（无损快速处理中）…");

    let ffmpeg_bin = find_ffmpeg(ctx.app)?;
    modify_tags(
        &ffmpeg_bin,
        input_path,
        &target,
        cover_image,
        remove_cover,
        &tags,
    )?;

    ctx.progress(100, "音频标签修改完成");

    let mime = mime_for_ext(ext);
    Ok(json!({
        "path": target.to_string_lossy(),
        "filename": out_filename,
        "mime": mime,
        "message": "音频标签已成功修改并保存"
    }))
}

pub fn start(app: &tauri::AppHandle, tool: &str, args: &Value) -> Result<Value, String> {
    let tool = tool.to_string();
    let mut payload = args.clone();

    let mut input_audio: Option<PathBuf> = None;
    let mut cover_image: Option<PathBuf> = None;
    let mut audio_name: String = "audio.mp3".to_string();

    if let Some(files) = args.get("__files").and_then(Value::as_array) {
        if files.is_empty() {
            return Err("请选择音频文件 / Select an audio file".into());
        }
        let saved = crate::jobs::save_request_uploads(app, &crate::jobs::new_job_id_public(), files)?;
        for s in saved {
            let field = s.get("field").and_then(Value::as_str).unwrap_or("file");
            let path = s.get("path").and_then(Value::as_str).map(PathBuf::from);
            let name = s.get("name").and_then(Value::as_str).unwrap_or("audio.mp3").to_string();
            if field == "cover_file" {
                cover_image = path;
            } else {
                input_audio = path;
                audio_name = name;
            }
        }
    } else {
        if let Some(f) = args.get("file").or_else(|| args.get("path")).and_then(Value::as_str) {
            let p = PathBuf::from(f);
            audio_name = p.file_name().map(|x| x.to_string_lossy().to_string()).unwrap_or_else(|| "audio.mp3".into());
            input_audio = Some(p);
        }
        if let Some(c) = args.get("cover_file").and_then(Value::as_str) {
            if !c.trim().is_empty() {
                cover_image = Some(PathBuf::from(c.trim()));
            }
        }
    }

    let input_audio = input_audio.ok_or("请选择音频文件 / Select an audio file")?;
    if !input_audio.exists() {
        return Err("找不到音频文件 / Audio file not found".into());
    }

    if let Some(o) = payload.as_object_mut() {
        o.remove("__files");
        o.remove("__path");
        o.remove("__method");
    }

    let job = crate::jobs::create_local_job(app, &tool, payload.clone())?;
    let id = job.get("id").and_then(Value::as_str).ok_or("建任务失败")?.to_string();

    let app_bg = app.clone();
    let id_bg = id.clone();
    let input_audio_bg = input_audio.clone();
    let cover_image_bg = cover_image.clone();
    let audio_name_bg = audio_name.clone();

    std::thread::Builder::new()
        .name("native-audio-tags".into())
        .spawn(move || {
            crate::matting_native::progress(&app_bg, &id_bg, 10, "正在准备音频标签任务…");
            let ctx = Ctx { app: &app_bg, id: &id_bg };
            let result = execute(
                &ctx,
                &input_audio_bg,
                &audio_name_bg,
                cover_image_bg.as_deref(),
                &payload,
            );

            if ctx.cancelled() {
                return;
            }

            let mut m = Map::new();
            match result {
                Ok(r) => {
                    m.insert("status".into(), json!("completed"));
                    m.insert("progress".into(), json!(100));
                    m.insert("message".into(), r.get("message").cloned().unwrap_or(json!("音频标签修改完成")));
                    m.insert("resultPath".into(), r.get("path").cloned().unwrap_or(json!("")));
                    m.insert("resultFilename".into(), r.get("filename").cloned().unwrap_or(json!("")));
                    m.insert("resultMimeType".into(), r.get("mime").cloned().unwrap_or(json!("audio/mpeg")));
                    if let Ok(meta) = std::fs::metadata(r.get("path").and_then(Value::as_str).unwrap_or("")) {
                        m.insert("resultBytes".into(), json!(meta.len()));
                    }
                    m.insert("engine".into(), json!("rust-ffmpeg"));
                }
                Err(e) => {
                    m.insert("status".into(), json!("failed"));
                    m.insert("progress".into(), json!(100));
                    m.insert("message".into(), json!("处理失败"));
                    m.insert("error".into(), json!(e));
                }
            }
            crate::jobs::update_job(&app_bg, &id_bg, m);
        })
        .map_err(|e| format!("启动后台线程失败：{e}"))?;

    let current = crate::jobs::read_job_public(app, &id).unwrap_or(job);
    Ok(json!({ "job": current, "ok": true, "engine": "rust-ffmpeg" }))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn find_test_audio() -> PathBuf {
        let candidates = [
            PathBuf::from("../_verify/fixtures/test_audio.mp3"),
            PathBuf::from("_verify/fixtures/test_audio.mp3"),
            PathBuf::from("E:/FurinaKit-Tauri/_verify/fixtures/test_audio.mp3"),
        ];
        for c in &candidates {
            if c.exists() {
                return c.clone();
            }
        }
        candidates[0].clone()
    }

    fn find_test_cover() -> PathBuf {
        let candidates = [
            PathBuf::from("../_verify/fixtures/fig1.png"),
            PathBuf::from("_verify/fixtures/fig1.png"),
            PathBuf::from("E:/FurinaKit-Tauri/_verify/fixtures/fig1.png"),
        ];
        for c in &candidates {
            if c.exists() {
                return c.clone();
            }
        }
        candidates[0].clone()
    }

    #[test]
    fn test_native_audio_tags_write_and_cover() {
        let audio = find_test_audio();
        let cover = find_test_cover();
        if !audio.exists() {
            eprintln!("test_audio.mp3 not found, skipping");
            return;
        }

        let temp_dir = std::env::temp_dir().join("fk_test_audio_tags");
        let _ = fs::remove_dir_all(&temp_dir);
        let _ = fs::create_dir_all(&temp_dir);

        let out_audio = temp_dir.join("tagged_audio.mp3");

        let ffmpeg = PathBuf::from("ffmpeg");
        let tags = [
            ("title", "测试标题 · 芙宁娜"),
            ("artist", "Furina"),
            ("album", "Fontaine Melodies"),
            ("date", "2026"),
        ];

        let cover_opt = if cover.exists() { Some(cover.as_path()) } else { None };

        let res = modify_tags(
            &ffmpeg,
            &audio,
            &out_audio,
            cover_opt,
            false,
            &tags,
        );

        assert!(res.is_ok(), "modify_tags failed: {:?}", res);
        assert!(out_audio.exists(), "tagged audio must exist");
        assert!(fs::metadata(&out_audio).unwrap().len() > 1000, "Audio size must be > 1000 bytes");

        // Test remove cover
        let out_nocover = temp_dir.join("nocover_audio.mp3");
        let res_nocover = modify_tags(
            &ffmpeg,
            &out_audio,
            &out_nocover,
            None,
            true,
            &[],
        );
        assert!(res_nocover.is_ok(), "remove cover failed: {:?}", res_nocover);
        assert!(out_nocover.exists(), "nocover audio must exist");

        let _ = fs::remove_dir_all(&temp_dir);
    }
}

