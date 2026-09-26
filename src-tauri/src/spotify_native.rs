//! Spotify 下载器：Rust 原生实现（去 Python 化，无需 Python Worker）
//! 链路架构：
//! 1. 结构化解析 Spotify URL（Track / Album / Playlist / Artist / URI）
//! 2. 借助系统内置 curl 获取 Spotify 公开元数据（oEmbed + Embed 页面结构），自动感知 Windows 系统代理（ProxyServer / 127.0.0.1:7890）
//! 3. 解析标题、艺术家、专辑及高清封面图像 URL，并自动下载暂存封面
//! 4. 调度 FurinaKit 现存的 yt-dlp 引擎执行智能音频源检索（内置 ytsearch 与国内备用源双通道机制）
//! 5. 提取并转码为目标格式（MP3 / FLAC），利用 FFmpeg 将 Spotify 高保真封面图无损嵌入为 attached_pic，并写入标准 ID3v2.3 / Vorbis 标签
//! 6. 全生命周期托付给 Tauri Job 管理器，支持无窗执行（CREATE_NO_WINDOW）与实时进度回传。

use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};
use serde_json::{json, Value};

pub fn supported(tool: &str) -> bool {
    tool == "spotify-download"
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

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SpotifyItemType {
    Track,
    Album,
    Playlist,
    Artist,
    Unknown,
}

#[derive(Debug, Clone)]
pub struct SpotifyParsedUrl {
    pub item_type: SpotifyItemType,
    pub id: String,
    pub original_url: String,
}

pub fn parse_spotify_url(input: &str) -> Result<SpotifyParsedUrl, String> {
    let raw = input.trim();
    if raw.is_empty() {
        return Err("请输入 Spotify 链接".into());
    }

    // Handle URI format: spotify:track:id or spotify:album:id
    if let Some(stripped) = raw.strip_prefix("spotify:") {
        let parts: Vec<&str> = stripped.split(':').collect();
        if parts.len() >= 2 {
            let item_type = match parts[0] {
                "track" => SpotifyItemType::Track,
                "album" => SpotifyItemType::Album,
                "playlist" => SpotifyItemType::Playlist,
                "artist" => SpotifyItemType::Artist,
                _ => SpotifyItemType::Unknown,
            };
            return Ok(SpotifyParsedUrl {
                item_type,
                id: parts[1].to_string(),
                original_url: raw.to_string(),
            });
        }
    }

    // Handle standard URL format: https://open.spotify.com/[intl-.../]track/id?si=...
    let parsed = url::Url::parse(raw).map_err(|_| "无效的 Spotify 链接格式")?;
    let host = parsed.host_str().unwrap_or("");
    if !host.contains("spotify.com") {
        return Err("仅支持 Spotify 平台链接（open.spotify.com）".into());
    }

    let segments: Vec<&str> = parsed.path_segments().map(|s| s.collect()).unwrap_or_default();
    let mut type_idx = None;
    for (i, &seg) in segments.iter().enumerate() {
        if matches!(seg, "track" | "album" | "playlist" | "artist") {
            type_idx = Some(i);
            break;
        }
    }

    if let Some(idx) = type_idx {
        let item_type = match segments[idx] {
            "track" => SpotifyItemType::Track,
            "album" => SpotifyItemType::Album,
            "playlist" => SpotifyItemType::Playlist,
            "artist" => SpotifyItemType::Artist,
            _ => SpotifyItemType::Unknown,
        };
        let id = segments.get(idx + 1).map(|s| s.to_string()).unwrap_or_default();
        return Ok(SpotifyParsedUrl {
            item_type,
            id,
            original_url: raw.to_string(),
        });
    }

    Err("无法识别 Spotify 资源类型（支持 单曲/专辑/歌单/歌手 链接）".into())
}

#[derive(Debug, Clone, Default)]
pub struct SpotifyMetadata {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub cover_url: String,
}

fn curl_fetch(url: &str, proxy: Option<&str>) -> Result<Vec<u8>, String> {
    let mut cmd = Command::new("curl");
    cmd.args(["-fsSL", "--max-time", "12"]);
    if let Some(p) = proxy {
        if !p.is_empty() {
            cmd.args(["--proxy", p]);
        }
    }
    cmd.arg(url);
    crate::commands::no_window(&mut cmd);
    let out = cmd.output().map_err(|e| format!("启动 curl 失败：{e}"))?;
    if !out.status.success() {
        return Err(format!("curl 获取失败: {}", String::from_utf8_lossy(&out.stderr)));
    }
    Ok(out.stdout)
}

pub fn resolve_metadata(parsed: &SpotifyParsedUrl, proxy: Option<&str>) -> SpotifyMetadata {
    let mut meta = SpotifyMetadata::default();
    meta.title = format!("Spotify Track {}", parsed.id);

    // 1. oEmbed 获取标题和封面图
    let encoded_url: String = url::form_urlencoded::byte_serialize(parsed.original_url.as_bytes()).collect();
    let oembed_url = format!("https://open.spotify.com/oembed?url={}", encoded_url);
    if let Ok(bytes) = curl_fetch(&oembed_url, proxy) {
        if let Ok(v) = serde_json::from_slice::<Value>(&bytes) {
            if let Some(t) = v.get("title").and_then(Value::as_str) {
                if !t.is_empty() {
                    meta.title = t.to_string();
                }
            }
            if let Some(cov) = v.get("thumbnail_url").and_then(Value::as_str) {
                if !cov.is_empty() {
                    meta.cover_url = cov.to_string();
                }
            }
        }
    }

    // 2. Embed 页面获取详细艺术家与专辑信息
    let type_str = match parsed.item_type {
        SpotifyItemType::Track => "track",
        SpotifyItemType::Album => "album",
        SpotifyItemType::Playlist => "playlist",
        SpotifyItemType::Artist => "artist",
        _ => "track",
    };
    let embed_url = format!("https://open.spotify.com/embed/{}/{}", type_str, parsed.id);

    if let Ok(bytes) = curl_fetch(&embed_url, proxy) {
        let html = String::from_utf8_lossy(&bytes);
        if let Some(start) = html.find("<script id=\"__NEXT_DATA__\" type=\"application/json\">") {
            let rest = &html[start + 51..];
            if let Some(end) = rest.find("</script>") {
                let json_str = &rest[..end];
                if let Ok(data) = serde_json::from_str::<Value>(json_str) {
                    let entity = &data["props"]["pageProps"]["state"]["data"]["entity"];
                    if let Some(name) = entity.get("name").and_then(Value::as_str) {
                        if !name.is_empty() {
                            meta.title = name.to_string();
                        }
                    }
                    if let Some(artists) = entity.get("artists").and_then(Value::as_array) {
                        let names: Vec<String> = artists
                            .iter()
                            .filter_map(|a| a.get("name").and_then(Value::as_str).map(String::from))
                            .collect();
                        if !names.is_empty() {
                            meta.artist = names.join(", ");
                        }
                    }
                    if let Some(album_name) = entity.get("album").and_then(|alb| alb.get("name")).and_then(Value::as_str) {
                        meta.album = album_name.to_string();
                    }
                }
            }
        }
    }

    meta
}

fn download_audio_stream(
    app: &tauri::AppHandle,
    query: &str,
    out_prefix: &Path,
    format: &str,
    proxy: Option<&str>,
    ctx: &Ctx,
) -> Result<PathBuf, String> {
    let (program, prefix, _worker_guard) = crate::video::ytdlp_command(app)?;
    let root = crate::app_root_of(app);
    let ffmpeg = std::env::var("FURINAKIT_FFMPEG_PATH")
        .ok()
        .map(PathBuf::from)
        .filter(|p| p.is_file())
        .or_else(|| {
            [
                "apps/web/ffmpeg.exe",
                "resources/ffmpeg.exe",
                "services/worker/ffmpeg.exe",
                "ffmpeg.exe",
                "resources/worker/ffmpeg.exe",
            ]
            .iter()
            .map(|p| root.join(p))
            .find(|p| p.is_file())
        });
    let ffmpeg = ffmpeg.or_else(|| crate::runtime_layout::find_media_tool("ffmpeg", &root));

    let search_targets = if proxy.is_some() {
        vec![format!("ytsearch1:{query} audio"), format!("bilisearch1:{query}")]
    } else {
        vec![format!("bilisearch1:{query}"), format!("ytsearch1:{query} audio")]
    };

    let audio_format = if format == "flac" { "flac" } else { "mp3" };
    let mut last_err = String::new();

    for target in search_targets {
        if ctx.cancelled() {
            return Err("任务已取消".into());
        }

        let mut cmd = Command::new(&program);
        cmd.args(&prefix)
            .args([
                "--ignore-config",
                "--no-playlist",
                "--windows-filenames",
                "--no-color",
                "--no-simulate",
                "-f", "bestaudio/best",
                "-x",
                "--audio-format", audio_format,
                "--audio-quality", "0",
                "--socket-timeout", "20",
                "--retries", "2",
                "-o",
            ])
            .arg(format!("{}.%(ext)s", out_prefix.display()));

        if let Some(p) = proxy {
            if !p.is_empty() && !target.starts_with("bilisearch") {
                cmd.args(["--proxy", p]);
            }
        }

        cmd.arg(&target);

        if let Some(ref ffmpeg_path) = ffmpeg {
            if let Some(parent) = ffmpeg_path.parent() {
                cmd.env("PATH", format!("{};{}", parent.display(), std::env::var("PATH").unwrap_or_default()));
            }
        }

        crate::commands::no_window(&mut cmd);
        let out = cmd.output().map_err(|e| format!("执行音频下载引擎失败：{e}"))?;
        if out.status.success() {
            let candidate = out_prefix.with_extension(audio_format);
            if candidate.is_file() {
                return Ok(candidate);
            }
            if let Some(parent) = out_prefix.parent() {
                if let Ok(entries) = fs::read_dir(parent) {
                    for entry in entries.flatten() {
                        let path = entry.path();
                        if path.is_file()
                            && path.to_string_lossy().contains(&out_prefix.file_name().unwrap().to_string_lossy().to_string())
                        {
                            return Ok(path);
                        }
                    }
                }
            }
        } else {
            last_err = String::from_utf8_lossy(&out.stderr).to_string();
        }
    }

    Err(format!(
        "无法下载对应音频源：{}",
        if last_err.is_empty() {
            "所有搜索源均未检索到可用音轨"
        } else {
            &last_err
        }
    ))
}

fn tag_and_finalize(
    app: &tauri::AppHandle,
    input_audio: &Path,
    final_output: &Path,
    meta: &SpotifyMetadata,
    cover_file: Option<&Path>,
    format: &str,
) -> Result<(), String> {
    let root = crate::app_root_of(app);
    let ffmpeg_exe = std::env::var("FURINAKIT_FFMPEG_PATH")
        .ok()
        .map(PathBuf::from)
        .filter(|p| p.is_file())
        .or_else(|| {
            [
                "apps/web/ffmpeg.exe",
                "resources/ffmpeg.exe",
                "services/worker/ffmpeg.exe",
                "ffmpeg.exe",
                "resources/worker/ffmpeg.exe",
            ]
            .iter()
            .map(|p| root.join(p))
            .find(|p| p.is_file())
        })
        .or_else(|| crate::runtime_layout::find_media_tool("ffmpeg", &root))
        .ok_or_else(|| "未找到 ffmpeg.exe 组件".to_string())?;

    let mut cmd = Command::new(&ffmpeg_exe);
    cmd.arg("-y").arg("-i").arg(input_audio);

    let has_cover = cover_file.map(|p| p.is_file()).unwrap_or(false);
    if has_cover {
        cmd.arg("-i").arg(cover_file.unwrap());
        cmd.args(["-map", "0:a", "-map", "1:v"]);
        cmd.args(["-c:a", "copy", "-c:v:0", "copy"]);
        cmd.args(["-disposition:v:0", "attached_pic"]);
    } else {
        cmd.args(["-map", "0:a", "-c:a", "copy"]);
    }

    if format == "mp3" {
        cmd.args(["-id3v2_version", "3", "-write_id3v1", "1"]);
    }

    if !meta.title.is_empty() {
        cmd.args(["-metadata", &format!("title={}", meta.title)]);
    }
    if !meta.artist.is_empty() {
        cmd.args(["-metadata", &format!("artist={}", meta.artist)]);
    }
    if !meta.album.is_empty() {
        cmd.args(["-metadata", &format!("album={}", meta.album)]);
    }

    cmd.arg(final_output);
    crate::commands::no_window(&mut cmd);

    let out = cmd.output().map_err(|e| format!("启动 ffmpeg 封装标签失败：{e}"))?;
    if !out.status.success() {
        return Err(format!("ffmpeg 标签封装失败：{}", String::from_utf8_lossy(&out.stderr)));
    }

    Ok(())
}

fn execute_spotify_download(
    app: &tauri::AppHandle,
    id: &str,
    url: &str,
    format: &str,
) -> Result<(PathBuf, String, String), String> {
    let ctx = Ctx { app, id };
    ctx.progress(5, "正在解析 Spotify 链接与元数据...");

    let parsed = parse_spotify_url(url)?;
    let proxy = crate::video::system_proxy(url);

    let meta = resolve_metadata(&parsed, proxy.as_deref());
    if ctx.cancelled() {
        return Err("任务已取消".into());
    }

    ctx.progress(25, &format!("已获取曲目信息：{} - {}", meta.artist, meta.title));

    // 建立任务专用存储目录
    let dir = crate::jobs::storage_dir_of(app).join("results").join(id);
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    // 下载封面图
    let cover_path = dir.join("cover.jpg");
    let mut has_cover = false;
    if !meta.cover_url.is_empty() {
        if let Ok(cover_bytes) = curl_fetch(&meta.cover_url, proxy.as_deref()) {
            if fs::write(&cover_path, cover_bytes).is_ok() {
                has_cover = true;
            }
        }
    }

    ctx.progress(45, "正在检索音频资源并下载...");
    let search_query = if !meta.artist.is_empty() {
        format!("{} {}", meta.title, meta.artist)
    } else {
        meta.title.clone()
    };

    let temp_audio_prefix = dir.join("temp_audio");
    let downloaded_audio = download_audio_stream(app, &search_query, &temp_audio_prefix, format, proxy.as_deref(), &ctx)?;

    ctx.progress(85, "正在嵌入高清封面与 ID3 标签...");

    let safe_title = meta.title.replace(['/', '\\', ':', '*', '?', '"', '<', '>', '|'], "_");
    let ext = if format == "flac" { "flac" } else { "mp3" };
    let filename = format!("{safe_title}.{ext}");
    let final_output = dir.join(&filename);

    tag_and_finalize(
        app,
        &downloaded_audio,
        &final_output,
        &meta,
        if has_cover { Some(&cover_path) } else { None },
        format,
    )?;

    // 清理中间临时音频与封面
    let _ = fs::remove_file(&downloaded_audio);
    let _ = fs::remove_file(&cover_path);

    ctx.progress(100, "Spotify 下载完成");

    let mime = if format == "flac" { "audio/flac" } else { "audio/mpeg" };
    Ok((final_output, filename, mime.to_string()))
}

pub fn start(app: &tauri::AppHandle, tool: &str, args: &Value) -> Result<Value, String> {
    if !supported(tool) {
        return Err(format!("不支持的工具：{tool}"));
    }

    let url = args["url"].as_str().ok_or("缺少 url 参数")?;
    let format = args["format"].as_str().unwrap_or("mp3");

    let job = crate::jobs::create_local_job(app, tool, args.clone())?;
    let id = job["id"].as_str().ok_or("任务缺少 id")?.to_string();

    let app_handle = app.clone();
    let url_owned = url.to_string();
    let format_owned = format.to_string();
    let id_owned = id.clone();

    std::thread::spawn(move || {
        crate::jobs::update_job(
            &app_handle,
            &id_owned,
            serde_json::Map::from_iter([
                ("status".to_string(), json!("processing")),
                ("progress".to_string(), json!(5)),
                ("message".to_string(), json!("正在启动 Spotify 下载任务...")),
            ]),
        );

        match execute_spotify_download(&app_handle, &id_owned, &url_owned, &format_owned) {
            Ok((path, filename, mime)) => {
                crate::jobs::update_job(
                    &app_handle,
                    &id_owned,
                    serde_json::Map::from_iter([
                        ("status".to_string(), json!("completed")),
                        ("progress".to_string(), json!(100)),
                        ("message".to_string(), json!("Spotify 下载完成")),
                        ("output_file".to_string(), json!(path.to_string_lossy().to_string())),
                        ("filename".to_string(), json!(filename)),
                        ("mime".to_string(), json!(mime)),
                    ]),
                );
            }
            Err(e) => {
                if crate::jobs::read_job_public(&app_handle, &id_owned)
                    .and_then(|j| j.get("status").and_then(Value::as_str).map(|s| s == "processing"))
                    .unwrap_or(false)
                {
                    crate::jobs::update_job(
                        &app_handle,
                        &id_owned,
                        serde_json::Map::from_iter([
                            ("status".to_string(), json!("failed")),
                            ("message".to_string(), json!("Spotify 下载失败")),
                            ("error".to_string(), json!(e)),
                        ]),
                    );
                }
            }
        }
    });

    Ok(json!({"ok": true, "job": job, "engine": "native-spotify"}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_native_spotify_url_parsing() {
        // Track URL
        let parsed = parse_spotify_url("https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT?si=abc").unwrap();
        assert_eq!(parsed.item_type, SpotifyItemType::Track);
        assert_eq!(parsed.id, "4cOdK2wGLETKBW3PvgPWqT");

        // Intl Track URL
        let parsed_intl = parse_spotify_url("https://open.spotify.com/intl-zh/track/1234567890abcdef").unwrap();
        assert_eq!(parsed_intl.item_type, SpotifyItemType::Track);
        assert_eq!(parsed_intl.id, "1234567890abcdef");

        // Playlist URL
        let parsed_playlist = parse_spotify_url("https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M").unwrap();
        assert_eq!(parsed_playlist.item_type, SpotifyItemType::Playlist);
        assert_eq!(parsed_playlist.id, "37i9dQZF1DXcBWIGoYBM5M");

        // Album URL
        let parsed_album = parse_spotify_url("https://open.spotify.com/album/4m2880jivSbbyEGAKfITCa").unwrap();
        assert_eq!(parsed_album.item_type, SpotifyItemType::Album);
        assert_eq!(parsed_album.id, "4m2880jivSbbyEGAKfITCa");

        // Spotify URI
        let parsed_uri = parse_spotify_url("spotify:track:4cOdK2wGLETKBW3PvgPWqT").unwrap();
        assert_eq!(parsed_uri.item_type, SpotifyItemType::Track);
        assert_eq!(parsed_uri.id, "4cOdK2wGLETKBW3PvgPWqT");

        // Invalid host
        assert!(parse_spotify_url("https://example.com/track/123").is_err());
        // Empty
        assert!(parse_spotify_url("").is_err());
    }
}

