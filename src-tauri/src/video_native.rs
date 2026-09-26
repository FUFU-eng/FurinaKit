//! 视频格式转换 / 视频压缩 / 视频转 GIF / 视频去水印：Rust 原生实现（去 Python 化）。
//!
//! 这 4 个工具原来走 Python worker（services/worker/app/tools/video_tools.py、video_watermark.py），
//! 但 Python 在其中只负责"拼 ffmpeg 命令行"。这里把同样的参数原样搬到 Rust，
//! 复用组件管理里经过 SHA-256 校验的 ffmpeg.exe / ffprobe.exe（`ffmpeg_components::verified_pair`）。
//!
//! 与 Python 版的对齐：
//!   · 格式转换：original=`-c copy`；high/medium/low = libx264 crf 18/23/28（preset medium/medium/fast）；
//!     mp4/m4v/mov 加 aac 192k，webm 用 libvpx-vp9 + libopus，avi 音频用 mp3。多文件时打包 zip。
//!   · 压缩：high/medium/low = crf 20/26/30；填了目标大小则按 `大小MB*8192/时长` 算码率。
//!     （前端字段是 maxSize，Python 读的是 target_size_mb —— Python 版这个参数其实从没生效，这里两个都认。）
//!   · 转 GIF：palettegen + paletteuse 两步法，调色板失败时退回单步；
//!     （前端字段 startTime，Python 读 start_time —— 同样两个都认。）
//!   · 去水印：delogo / 区域模糊（split→crop→boxblur→overlay）/ 裁边，区域计算规则与 video_watermark.py 相同。
//!
//! 与 Python 版的差异（有意为之）：
//!   · 结果写到任务结果目录（storage/results/<任务id>-<文件名>），不再写到源视频旁边；
//!   · 用 `-progress pipe:1` 报真实百分比；取消任务时会结束 ffmpeg 进程。

use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use serde_json::{json, Map, Value};

use crate::matting_native::{number, results_path, text};

pub fn supported(tool: &str) -> bool {
    matches!(tool, "video-format-convert" | "video-compress" | "video-to-gif" | "video-watermark-remove")
}

const MISSING_FFMPEG: &str = "缺少 FFmpeg / FFprobe 组件，请前往「设置 → 组件管理」下载安装后重试 / Install the FFmpeg / FFprobe component from Settings → Components";

// ───────────────────────── 入口：建任务 + 后台线程 ─────────────────────────

pub fn start(app: &tauri::AppHandle, tool: &str, args: &Value) -> Result<Value, String> {
    let tool = tool.to_string();
    let dir = crate::api::components_dir(app)?;
    if !crate::ffmpeg_components::pair_present(&dir) {
        return Err(MISSING_FFMPEG.into());
    }
    let lease = crate::api::component_use(app, &["ffmpeg.exe", "ffprobe.exe"])?;

    let mut payload = args.clone();
    let inputs: Vec<(PathBuf, String)> = if let Some(files) = args.get("__files").and_then(Value::as_array) {
        if files.is_empty() || files.len() > 100 {
            return Err("每批请选择 1–100 个文件 / Select 1–100 files".into());
        }
        let saved = crate::jobs::save_request_uploads(app, &crate::jobs::new_job_id_public(), files)?;
        saved
            .iter()
            .map(|s| {
                let p = s.get("path").and_then(Value::as_str).ok_or("缺少上传的视频")?;
                let n = s.get("name").and_then(Value::as_str).unwrap_or("video").to_string();
                Ok((PathBuf::from(p), n))
            })
            .collect::<Result<_, String>>()?
    } else {
        let list: Vec<String> = if let Some(arr) = args.get("files").and_then(Value::as_array) {
            arr.iter().filter_map(Value::as_str).map(str::to_string).collect()
        } else {
            args.get("file")
                .or_else(|| args.get("path"))
                .and_then(Value::as_str)
                .map(|s| vec![s.to_string()])
                .unwrap_or_default()
        };
        list.into_iter()
            .map(|s| {
                let p = PathBuf::from(&s);
                let n = p.file_name().map(|x| x.to_string_lossy().to_string()).unwrap_or_else(|| "video".into());
                (p, n)
            })
            .collect()
    };
    if inputs.is_empty() {
        return Err("请选择视频文件 / Select a video file".into());
    }
    for (p, _) in &inputs {
        let m = std::fs::metadata(p).map_err(|e| format!("找不到视频：{e}"))?;
        if !m.is_file() || m.len() == 0 {
            return Err("视频文件为空或不存在 / Video file is empty or missing".into());
        }
    }
    if let Some(o) = payload.as_object_mut() {
        o.remove("__files");
        o.remove("__path");
        o.remove("__method");
        o.insert("files".into(), json!(inputs.iter().map(|(p, _)| p.to_string_lossy()).collect::<Vec<_>>()));
    }

    let job = crate::jobs::create_local_job(app, &tool, payload.clone())?;
    let id = job.get("id").and_then(Value::as_str).ok_or("建任务失败")?.to_string();

    let app_bg = app.clone();
    let id_bg = id.clone();
    std::thread::Builder::new()
        .name("native-video".into())
        .spawn(move || {
            let _lease = lease;
            crate::matting_native::progress(&app_bg, &id_bg, 3, "正在校验 FFmpeg 组件…");
            let ctx = Ctx { app: &app_bg, id: &id_bg };
            let result = crate::ffmpeg_components::verified_pair(&dir).and_then(|(ff, fp)| {
                let eng = Engine { ffmpeg: ff, ffprobe: fp };
                match tool.as_str() {
                    "video-format-convert" => format_convert(&ctx, &eng, &inputs, &payload),
                    "video-compress" => compress(&ctx, &eng, &inputs[0], &payload),
                    "video-to-gif" => to_gif(&ctx, &eng, &inputs[0], &payload),
                    "video-watermark-remove" => watermark_remove(&ctx, &eng, &inputs[0], &payload),
                    other => Err(format!("不支持的工具：{other}")),
                }
            });
            if ctx.cancelled() {
                return;
            }
            let mut m = Map::new();
            match result {
                Ok(r) => {
                    m.insert("status".into(), json!("completed"));
                    m.insert("progress".into(), json!(100));
                    m.insert("message".into(), r.get("message").cloned().unwrap_or(json!("视频处理完成")));
                    m.insert("resultPath".into(), r.get("path").cloned().unwrap_or(json!("")));
                    m.insert("resultFilename".into(), r.get("filename").cloned().unwrap_or(json!("")));
                    m.insert("resultMimeType".into(), r.get("mime").cloned().unwrap_or(json!("video/mp4")));
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
        .map_err(|e| format!("无法启动视频任务：{e}"))?;

    let current = crate::jobs::read_job_public(app, &id).unwrap_or(job);
    Ok(json!({ "job": current, "ok": true, "engine": "rust-ffmpeg" }))
}

// ───────────────────────── 任务上下文 / ffmpeg 调用 ─────────────────────────

struct Ctx<'a> {
    app: &'a tauri::AppHandle,
    id: &'a str,
}

impl Ctx<'_> {
    /// 用户取消 = 任务被标成 failed（与 matting_native 的约定一致）
    fn cancelled(&self) -> bool {
        crate::jobs::read_job_public(self.app, self.id)
            .and_then(|j| j.get("status").and_then(Value::as_str).map(|s| s == "failed"))
            .unwrap_or(false)
    }
    fn progress(&self, pct: u32, msg: &str) {
        crate::matting_native::progress(self.app, self.id, pct, msg);
    }
}

struct Engine {
    ffmpeg: PathBuf,
    ffprobe: PathBuf,
}

fn command(exe: &Path) -> Command {
    let mut c = Command::new(exe);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        c.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    c
}

#[derive(Debug, Clone, Copy, Default)]
struct Probe {
    width: u32,
    height: u32,
    duration: f64,
}

impl Engine {
    fn probe(&self, path: &Path) -> Result<Probe, String> {
        let out = command(&self.ffprobe)
            .args(["-v", "quiet", "-print_format", "json", "-show_streams", "-show_format"])
            .arg(path)
            .stdin(Stdio::null())
            .output()
            .map_err(|e| format!("无法启动 ffprobe：{e}"))?;
        if !out.status.success() {
            return Err("这个视频读不出信息（可能不是视频文件，或已损坏）".into());
        }
        let data: Value = serde_json::from_slice(&out.stdout).map_err(|e| format!("解析视频信息失败：{e}"))?;
        let mut p = Probe::default();
        if let Some(streams) = data.get("streams").and_then(Value::as_array) {
            if let Some(v) = streams.iter().find(|s| s.get("codec_type").and_then(Value::as_str) == Some("video")) {
                p.width = v.get("width").and_then(Value::as_u64).unwrap_or(0) as u32;
                p.height = v.get("height").and_then(Value::as_u64).unwrap_or(0) as u32;
            }
        }
        p.duration = data
            .pointer("/format/duration")
            .and_then(|d| d.as_str().and_then(|s| s.parse().ok()).or_else(|| d.as_f64()))
            .unwrap_or(0.0);
        Ok(p)
    }

    /// 运行 ffmpeg；`-progress pipe:1` 换算成 [lo, hi] 区间的进度；取消时结束进程。
    fn run(&self, ctx: &Ctx, args: &[String], duration: f64, lo: u32, hi: u32, label: &str) -> Result<(), String> {
        let mut child: Child = command(&self.ffmpeg)
            .args(["-hide_banner", "-nostdin", "-nostats", "-progress", "pipe:1"])
            .args(args)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("无法启动 ffmpeg：{e}"))?;

        // stderr 单独线程收集（只留最后一段，用于报错）
        let mut stderr = child.stderr.take().ok_or("ffmpeg 无 stderr")?;
        let err_thread = std::thread::spawn(move || {
            let mut buf = Vec::new();
            let _ = stderr.read_to_end(&mut buf);
            let s = String::from_utf8_lossy(&buf).to_string();
            let tail: String = s.chars().rev().take(1500).collect::<Vec<_>>().into_iter().rev().collect();
            tail
        });

        // stdout 进度解析放到线程里，主线程负责轮询取消
        let stdout = child.stdout.take().ok_or("ffmpeg 无 stdout")?;
        let (tx, rx) = std::sync::mpsc::channel::<f64>();
        let out_thread = std::thread::spawn(move || {
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                if let Some(v) = line.strip_prefix("out_time_us=").or_else(|| line.strip_prefix("out_time_ms=")) {
                    if let Ok(us) = v.trim().parse::<f64>() {
                        let _ = tx.send(us / 1_000_000.0);
                    }
                }
            }
        });

        let mut last_pct = lo;
        let mut ticks = 0u32;
        let status = loop {
            if let Some(st) = child.try_wait().map_err(|e| e.to_string())? {
                break st;
            }
            let mut latest = None;
            while let Ok(t) = rx.try_recv() {
                latest = Some(t);
            }
            if let (Some(t), true) = (latest, duration > 0.0) {
                let frac = (t / duration).clamp(0.0, 1.0);
                let pct = lo + ((hi - lo) as f64 * frac) as u32;
                if pct > last_pct {
                    last_pct = pct;
                    ctx.progress(pct, &format!("{label} {:.0}%", frac * 100.0));
                }
            }
            ticks += 1;
            if ticks % 4 == 0 && ctx.cancelled() {
                let _ = child.kill();
                let _ = child.wait();
                let _ = out_thread.join();
                let _ = err_thread.join();
                return Err("任务已取消".into());
            }
            std::thread::sleep(Duration::from_millis(250));
        };
        let _ = out_thread.join();
        let tail = err_thread.join().unwrap_or_default();
        if !status.success() {
            let short = tail.split_whitespace().collect::<Vec<_>>().join(" ");
            let short: String = short.chars().rev().take(260).collect::<Vec<_>>().into_iter().rev().collect();
            return Err(format!("FFmpeg 处理失败：{}", if short.is_empty() { "ffmpeg 返回了错误".to_string() } else { short }));
        }
        Ok(())
    }
}

fn s(v: &str) -> String {
    v.to_string()
}

fn p(path: &Path) -> String {
    path.to_string_lossy().to_string()
}

fn stem_of(path: &Path, name: &str) -> String {
    let from = |x: &Path| x.file_stem().map(|s| s.to_string_lossy().to_string()).filter(|s| !s.is_empty());
    from(Path::new(name)).or_else(|| from(path)).unwrap_or_else(|| "video".into())
}

/// 输出文件已存在时先删掉（结果目录里以任务 id 为前缀，正常不会冲突）
fn fresh(path: &Path) -> Result<(), String> {
    if path.exists() {
        std::fs::remove_file(path).map_err(|e| format!("无法覆盖旧结果：{e}"))?;
    }
    Ok(())
}

fn ensure_output(path: &Path) -> Result<(), String> {
    match std::fs::metadata(path) {
        Ok(m) if m.is_file() && m.len() > 0 => Ok(()),
        _ => Err("输出文件未生成".into()),
    }
}

fn done(path: &Path, filename: &str, mime: &str, message: String) -> Value {
    json!({ "path": p(path), "filename": filename, "mime": mime, "message": message })
}

// ───────────────────────── 格式转换 ─────────────────────────

pub(crate) fn convert_args(input: &Path, output: &Path, format: &str, quality: &str) -> Vec<String> {
    let mut a = vec![s("-y"), s("-i"), p(input)];
    if format == "webm" {
        // WebM 单独处理：旧实现先塞 libx264 参数再用 libvpx-vp9 覆盖，VP9 落在默认 good/cpu-used=0~1
        // 且没有 -b:v 0，编码极慢。改为 realtime + 行多线程，按质量档选 CRF 与速度档。
        let (crf, cpu) = match quality { "high" | "original" => ("31", "5"), "low" => ("40", "8"), _ => ("35", "7") };
        a.extend([
            s("-c:v"), s("libvpx-vp9"), s("-crf"), s(crf), s("-b:v"), s("0"),
            s("-deadline"), s("realtime"), s("-cpu-used"), s(cpu), s("-row-mt"), s("1"),
            s("-tile-columns"), s("2"), s("-threads"), s("0"), s("-pix_fmt"), s("yuv420p"),
            s("-c:a"), s("libopus"), s("-b:a"), s("128k"),
        ]);
        a.push(p(output));
        return a;
    }
    match quality {
        "original" => a.extend([s("-c"), s("copy")]),
        "high" => a.extend([s("-c:v"), s("libx264"), s("-crf"), s("18"), s("-preset"), s("medium")]),
        "medium" => a.extend([s("-c:v"), s("libx264"), s("-crf"), s("23"), s("-preset"), s("medium")]),
        "low" => a.extend([s("-c:v"), s("libx264"), s("-crf"), s("28"), s("-preset"), s("fast")]),
        _ => {}
    }
    match format {
        "mp4" | "m4v" | "mov" => a.extend([s("-c:a"), s("aac"), s("-b:a"), s("192k")]),
        "webm" => a.extend([s("-c:v"), s("libvpx-vp9"), s("-c:a"), s("libopus")]),
        "avi" => a.extend([s("-c:a"), s("mp3")]),
        _ => {}
    }
    a.push(p(output));
    a
}

pub(crate) fn video_mime(ext: &str) -> &'static str {
    match ext {
        "mp4" => "video/mp4",
        "avi" => "video/x-msvideo",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "webm" => "video/webm",
        "flv" => "video/x-flv",
        "wmv" => "video/x-ms-wmv",
        "m4v" => "video/x-m4v",
        "gif" => "image/gif",
        _ => "application/octet-stream",
    }
}

fn clean_format(v: &str) -> Result<String, String> {
    let f = v.trim().trim_start_matches('.').to_ascii_lowercase();
    if matches!(f.as_str(), "mp4" | "avi" | "mov" | "mkv" | "webm" | "flv" | "wmv" | "m4v") {
        Ok(f)
    } else {
        Err(format!("不支持的目标格式：{v}"))
    }
}

fn format_convert(ctx: &Ctx, eng: &Engine, inputs: &[(PathBuf, String)], payload: &Value) -> Result<Value, String> {
    let format = clean_format(text(payload, "format", "mp4"))?;
    let quality = text(payload, "quality", "high");
    let mime = video_mime(&format);

    if inputs.len() == 1 {
        let (input, name) = &inputs[0];
        let filename = format!("{}_converted.{format}", stem_of(input, name));
        let out = results_path(ctx.app, ctx.id, &filename)?;
        fresh(&out)?;
        let dur = eng.probe(input).map(|p| p.duration).unwrap_or(0.0);
        ctx.progress(8, "处理中...");
        eng.run(ctx, &convert_args(input, &out, &format, quality), dur, 8, 96, "转换中")?;
        ensure_output(&out)?;
        return Ok(done(&out, &filename, mime, "视频处理完成".into()));
    }

    // 多文件：逐个转换到临时目录，最后打包 zip（与 Python 版一致：单个失败不影响其它）
    let storage = crate::jobs::storage_dir_of(ctx.app);
    let scratch = crate::image_artifacts::Scratch::create(&storage.join("tmp"), &format!("video-{}", ctx.id))?;
    let total = inputs.len();
    let mut entries: Vec<(String, PathBuf)> = Vec::new();
    let mut failures: Vec<String> = Vec::new();
    for (idx, (input, name)) in inputs.iter().enumerate() {
        if ctx.cancelled() {
            return Err("任务已取消".into());
        }
        let lo = 5 + (idx * 85 / total) as u32;
        let hi = 5 + ((idx + 1) * 85 / total) as u32;
        ctx.progress(lo, &format!("处理中 {}/{}", idx + 1, total));
        let mut filename = format!("{}_converted.{format}", stem_of(input, name));
        if entries.iter().any(|(n, _)| *n == filename) {
            filename = format!("{}_converted_{}.{format}", stem_of(input, name), idx + 1);
        }
        let out = scratch.0.join(format!("{idx:04}.{format}"));
        let dur = eng.probe(input).map(|p| p.duration).unwrap_or(0.0);
        match eng
            .run(ctx, &convert_args(input, &out, &format, quality), dur, lo, hi, &format!("第 {}/{} 个", idx + 1, total))
            .and_then(|_| ensure_output(&out))
        {
            Ok(()) => entries.push((filename, out)),
            Err(e) if e == "任务已取消" => return Err(e),
            Err(e) => failures.push(format!("{name}：{e}")),
        }
    }
    if entries.is_empty() {
        return Err(format!("所有文件处理失败。{}", failures.first().cloned().unwrap_or_default()));
    }
    ctx.progress(93, "正在打包结果…");
    let archive = results_path(ctx.app, ctx.id, "batch_result.zip")?;
    fresh(&archive)?;
    crate::image_artifacts::zip(&entries, &archive, &|| if ctx.cancelled() { Err("任务已取消".into()) } else { Ok(()) })?;
    let mut msg = format!("批量处理完成，共 {} 个文件", entries.len());
    if !failures.is_empty() {
        msg.push_str(&format!("，失败 {} 个（{}）", failures.len(), failures.join("；")));
    }
    Ok(done(&archive, "batch_result.zip", "application/zip", msg))
}

// ───────────────────────── 压缩 ─────────────────────────

pub(crate) fn compress_args(input: &Path, output: &Path, quality: &str, target_mb: f64, duration: f64) -> Vec<String> {
    let mut a = vec![s("-y"), s("-i"), p(input)];
    if target_mb > 0.0 && duration > 0.0 {
        let kbps = ((target_mb * 8192.0) / duration) as i64;
        let kbps = kbps.max(1);
        a.extend([
            s("-c:v"), s("libx264"),
            s("-b:v"), format!("{kbps}k"),
            s("-maxrate"), format!("{kbps}k"),
            s("-bufsize"), format!("{}k", kbps * 2),
            s("-c:a"), s("aac"), s("-b:a"), s("128k"),
        ]);
    } else {
        // 目标大小没填，或拿不到时长 → 质量模式（Python 版拿不到时长时按 medium）
        let q = if target_mb > 0.0 { "medium" } else { quality };
        match q {
            "high" => a.extend([s("-c:v"), s("libx264"), s("-crf"), s("20"), s("-preset"), s("medium")]),
            "low" => a.extend([s("-c:v"), s("libx264"), s("-crf"), s("30"), s("-preset"), s("fast")]),
            _ => a.extend([s("-c:v"), s("libx264"), s("-crf"), s("26"), s("-preset"), s("medium")]),
        }
        a.extend([s("-c:a"), s("aac"), s("-b:a"), s("128k")]);
    }
    a.push(p(output));
    a
}

fn compress(ctx: &Ctx, eng: &Engine, input: &(PathBuf, String), payload: &Value) -> Result<Value, String> {
    let (input, name) = input;
    let quality = text(payload, "quality", "medium");
    let target = {
        let a = number(payload, "maxSize", 0.0);
        if a > 0.0 { a } else { number(payload, "target_size_mb", 0.0) }
    };
    let filename = format!("{}_compressed.mp4", stem_of(input, name));
    let out = results_path(ctx.app, ctx.id, &filename)?;
    fresh(&out)?;
    let dur = eng.probe(input).map(|p| p.duration).unwrap_or(0.0);
    ctx.progress(8, "处理中...");
    eng.run(ctx, &compress_args(input, &out, quality, target, dur), dur, 8, 96, "压缩中")?;
    ensure_output(&out)?;
    let before = std::fs::metadata(input).map(|m| m.len()).unwrap_or(0);
    let after = std::fs::metadata(&out).map(|m| m.len()).unwrap_or(0);
    let msg = if before > 0 {
        format!("视频处理完成 · {:.1} MB → {:.1} MB", before as f64 / 1048576.0, after as f64 / 1048576.0)
    } else {
        "视频处理完成".into()
    };
    Ok(done(&out, &filename, "video/mp4", msg))
}

// ───────────────────────── 转 GIF ─────────────────────────

fn fmt_num(v: f64) -> String {
    // 对齐 Python 的 str(float)：整数也带 .0，ffmpeg 两种都接受
    if v.fract() == 0.0 { format!("{v:.1}") } else { format!("{v}") }
}

pub(crate) fn gif_args(input: &Path, palette: &Path, output: &Path, start: f64, dur: f64, width: i64, fps: i64) -> (Vec<String>, Vec<String>, Vec<String>) {
    let head = vec![s("-y"), s("-ss"), fmt_num(start), s("-t"), fmt_num(dur), s("-i"), p(input)];
    let mut step1 = head.clone();
    step1.extend([s("-vf"), format!("fps={fps},scale={width}:-1:flags=lanczos,palettegen"), p(palette)]);
    let mut step2 = head.clone();
    step2.extend([s("-i"), p(palette), s("-lavfi"), format!("fps={fps},scale={width}:-1:flags=lanczos[x];[x][1:v]paletteuse"), p(output)]);
    let mut single = head;
    single.extend([s("-vf"), format!("fps={fps},scale={width}:-1:flags=lanczos"), p(output)]);
    (step1, step2, single)
}

fn to_gif(ctx: &Ctx, eng: &Engine, input: &(PathBuf, String), payload: &Value) -> Result<Value, String> {
    let (input, name) = input;
    let pick = |a: &str, b: &str, d: f64| {
        let v = number(payload, a, f64::NAN);
        if v.is_finite() { v } else { number(payload, b, d) }
    };
    let start = pick("startTime", "start_time", 0.0).max(0.0);
    let dur = pick("duration", "duration", 5.0);
    let dur = if dur > 0.0 { dur } else { 5.0 };
    let width = (pick("width", "width", 480.0) as i64).clamp(16, 4096);
    let fps = (pick("fps", "fps", 15.0) as i64).clamp(1, 60);

    let filename = format!("{}.gif", stem_of(input, name));
    let out = results_path(ctx.app, ctx.id, &filename)?;
    fresh(&out)?;
    let palette = results_path(ctx.app, ctx.id, "palette.png")?;
    let _ = std::fs::remove_file(&palette);
    let (step1, step2, single) = gif_args(input, &palette, &out, start, dur, width, fps);

    ctx.progress(10, "生成调色板中...");
    let palette_ok = eng.run(ctx, &step1, dur, 10, 40, "生成调色板中").is_ok() && palette.is_file();
    if ctx.cancelled() {
        let _ = std::fs::remove_file(&palette);
        return Err("任务已取消".into());
    }
    ctx.progress(40, "生成 GIF 中...");
    let args = if palette_ok { &step2 } else { &single };
    // 最多试 2 次（沿用 Python 版对偶发 DLL 初始化失败的处理）
    let mut result = eng.run(ctx, args, dur, 40, 96, "生成 GIF 中");
    if result.is_err() && !ctx.cancelled() {
        std::thread::sleep(Duration::from_secs(1));
        let _ = std::fs::remove_file(&out);
        result = eng.run(ctx, args, dur, 40, 96, "生成 GIF 中");
    }
    let _ = std::fs::remove_file(&palette);
    result?;
    ensure_output(&out)?;
    Ok(done(&out, &filename, "image/gif", "视频处理完成".into()))
}

// ───────────────────────── 去水印 ─────────────────────────

/// 与 video_watermark._region 相同：返回 (x, y, w, h)，保证在画面内且四周各留 1 像素
pub(crate) fn watermark_region(payload: &Value, w: i64, h: i64) -> (i64, i64, i64, i64) {
    let preset = text(payload, "position", "bottom-right");
    let frac = match preset {
        "top-left" => (0.0, 0.0),
        "top-right" => (0.66, 0.0),
        "bottom-left" => (0.0, 0.84),
        "bottom-right" => (0.66, 0.84),
        "bottom-center" => (0.3, 0.86),
        "top-center" => (0.3, 0.02),
        _ => (0.66, 0.84),
    };
    let int = |k: &str| number(payload, k, 0.0) as i64;
    let mut rw = int("rectW");
    let mut rh = int("rectH");
    let (mut rx, mut ry) = if preset == "custom" {
        (int("rectX"), int("rectY"))
    } else {
        ((w as f64 * frac.0) as i64, (h as f64 * frac.1) as i64)
    };
    if rw <= 0 {
        rw = 40.max((w as f64 * 0.3) as i64);
    }
    if rh <= 0 {
        rh = 24.max((h as f64 * 0.12) as i64);
    }
    // 与 Python 的 max(a, min(b, c)) 顺序一致（先 min 后 max）
    rx = 1.max(rx.min(w - rw - 1));
    ry = 1.max(ry.min(h - rh - 1));
    rw = 4.max(rw.min(w - rx - 1));
    rh = 4.max(rh.min(h - ry - 1));
    (rx, ry, rw, rh)
}

pub(crate) fn watermark_args(input: &Path, output: &Path, mode: &str, position: &str, w: i64, h: i64, r: (i64, i64, i64, i64)) -> Vec<String> {
    let (rx, ry, rw, rh) = r;
    let mut a = vec![s("-y"), s("-i"), p(input)];
    let enc = [s("-c:v"), s("libx264"), s("-preset"), s("veryfast"), s("-crf"), s("20"), s("-c:a"), s("copy"), s("-movflags"), s("+faststart")];
    match mode {
        "crop" => {
            let vf = match position {
                "bottom-right" | "bottom-left" | "bottom-center" => {
                    let cut = h - ry;
                    format!("crop={w}:{}:0:0", 16.max(h - cut))
                }
                "top-right" | "top-left" | "top-center" => {
                    let cut = ry + rh;
                    format!("crop={w}:{}:0:{cut}", 16.max(h - cut))
                }
                _ => format!("crop={}:{h}:0:0", 16.max(rx)),
            };
            a.extend([s("-vf"), vf]);
            a.extend(enc);
        }
        "blur" => {
            let vf = format!(
                "[0:v]split=2[base][tmp];[tmp]crop={rw}:{rh}:{rx}:{ry},boxblur=10:2[blurred];[base][blurred]overlay={rx}:{ry}[out]"
            );
            a.extend([s("-filter_complex"), vf, s("-map"), s("[out]"), s("-map"), s("0:a?")]);
            a.extend(enc);
        }
        _ => {
            a.extend([s("-vf"), format!("delogo=x={rx}:y={ry}:w={rw}:h={rh}")]);
            a.extend(enc);
        }
    }
    a.push(p(output));
    a
}

fn watermark_remove(ctx: &Ctx, eng: &Engine, input: &(PathBuf, String), payload: &Value) -> Result<Value, String> {
    let (input, name) = input;
    ctx.progress(10, "正在读取视频信息…");
    let before = eng.probe(input)?;
    if before.width == 0 || before.height == 0 {
        return Err("这个文件里没有视频画面".into());
    }
    let mode = text(payload, "mode", "delogo");
    let mode = if matches!(mode, "delogo" | "blur" | "crop") { mode } else { "delogo" };
    let position = text(payload, "position", "bottom-right");
    let (w, h) = (before.width as i64, before.height as i64);
    let region = watermark_region(payload, w, h);

    // Python 版保留原扩展名，但编码固定是 libx264 + 复制音频；webm/wmv/flv 等容器装不下，统一改为 mp4
    let src_ext = input.extension().map(|e| e.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    let ext = if matches!(src_ext.as_str(), "mp4" | "mov" | "mkv" | "m4v") { src_ext } else { "mp4".to_string() };
    let filename = format!("{}_去水印.{ext}", stem_of(input, name));
    let out = results_path(ctx.app, ctx.id, &filename)?;
    fresh(&out)?;
    ctx.progress(15, "正在处理水印区域（视频越长时间越久）…");
    eng.run(ctx, &watermark_args(input, &out, mode, position, w, h, region), before.duration, 15, 95, "正在处理水印区域")?;
    ensure_output(&out)?;
    let after = eng.probe(&out)?;
    let label = match mode {
        "blur" => "区域模糊",
        "crop" => "裁掉边缘",
        _ => "delogo 插值覆盖",
    };
    let msg = format!("完成（{label}）· {}×{} → {}×{}", before.width, before.height, after.width, after.height);
    Ok(done(&out, &filename, video_mime(&ext), msg))
}

// ───────────────────────── 测试 ─────────────────────────

#[cfg(test)]
mod video_native_tests {
    use super::*;

    fn v(j: &str) -> Value {
        serde_json::from_str(j).unwrap()
    }

    #[test]
    fn convert_args_match_python() {
        let a = convert_args(Path::new("in.mov"), Path::new("out.webm"), "webm", "medium");
        assert_eq!(a.join(" "), "-y -i in.mov -c:v libvpx-vp9 -crf 35 -b:v 0 -deadline realtime -cpu-used 7 -row-mt 1 -tile-columns 2 -threads 0 -pix_fmt yuv420p -c:a libopus -b:a 128k out.webm");
        let a = convert_args(Path::new("in.mkv"), Path::new("o.mp4"), "mp4", "original");
        assert_eq!(a.join(" "), "-y -i in.mkv -c copy -c:a aac -b:a 192k o.mp4");
        let a = convert_args(Path::new("i"), Path::new("o.avi"), "avi", "low");
        assert_eq!(a.join(" "), "-y -i i -c:v libx264 -crf 28 -preset fast -c:a mp3 o.avi");
    }

    #[test]
    fn compress_args_match_python() {
        let a = compress_args(Path::new("i"), Path::new("o"), "high", 0.0, 10.0);
        assert_eq!(a.join(" "), "-y -i i -c:v libx264 -crf 20 -preset medium -c:a aac -b:a 128k o");
        let a = compress_args(Path::new("i"), Path::new("o"), "low", 10.0, 100.0);
        assert_eq!(a.join(" "), "-y -i i -c:v libx264 -b:v 819k -maxrate 819k -bufsize 1638k -c:a aac -b:a 128k o");
        let a = compress_args(Path::new("i"), Path::new("o"), "low", 10.0, 0.0);
        assert!(a.join(" ").contains("-crf 26"));
    }

    #[test]
    fn gif_args_match_python() {
        let (a, b, c) = gif_args(Path::new("i"), Path::new("pal.png"), Path::new("o.gif"), 0.0, 5.0, 480, 15);
        assert_eq!(a.join(" "), "-y -ss 0.0 -t 5.0 -i i -vf fps=15,scale=480:-1:flags=lanczos,palettegen pal.png");
        assert_eq!(b.join(" "), "-y -ss 0.0 -t 5.0 -i i -i pal.png -lavfi fps=15,scale=480:-1:flags=lanczos[x];[x][1:v]paletteuse o.gif");
        assert_eq!(c.join(" "), "-y -ss 0.0 -t 5.0 -i i -vf fps=15,scale=480:-1:flags=lanczos o.gif");
    }

    #[test]
    fn watermark_region_matches_python() {
        // 手算自 video_watermark._region
        assert_eq!(watermark_region(&v(r#"{}"#), 1920, 1080), (1267, 907, 576, 129));
        assert_eq!(watermark_region(&v(r#"{"position":"top-left"}"#), 1280, 720), (1, 1, 384, 86));
        assert_eq!(
            watermark_region(&v(r#"{"position":"custom","rectX":5000,"rectY":10,"rectW":200,"rectH":50}"#), 640, 360),
            (439, 10, 200, 50)
        );
        assert_eq!(watermark_region(&v(r#"{"position":"bottom-center","rectW":"100"}"#), 100, 100), (1, 75, 98, 24));
    }

    #[test]
    fn watermark_args_modes() {
        let r = (1267, 907, 576, 129);
        let d = watermark_args(Path::new("i"), Path::new("o"), "delogo", "bottom-right", 1920, 1080, r).join(" ");
        assert!(d.contains("delogo=x=1267:y=907:w=576:h=129"));
        let c = watermark_args(Path::new("i"), Path::new("o"), "crop", "bottom-right", 1920, 1080, r).join(" ");
        assert!(c.contains("crop=1920:907:0:0"));
        let t = watermark_args(Path::new("i"), Path::new("o"), "crop", "top-left", 1280, 720, (1, 1, 384, 86)).join(" ");
        assert!(t.contains("crop=1280:633:0:87"));
        let b = watermark_args(Path::new("i"), Path::new("o"), "blur", "bottom-right", 1920, 1080, r).join(" ");
        assert!(b.contains("[tmp]crop=576:129:1267:907,boxblur=10:2[blurred];[base][blurred]overlay=1267:907[out]"));
        assert!(b.contains("-map 0:a?"));
    }

    /// 真机端到端：FK_VIDEO_TEST=<视频路径> FK_FFMPEG_DIR=<组件目录>
    #[test]
    #[ignore]
    fn end_to_end_with_real_ffmpeg() {
        let (Ok(video), Ok(dir)) = (std::env::var("FK_VIDEO_TEST"), std::env::var("FK_FFMPEG_DIR")) else { return };
        let dir = PathBuf::from(dir);
        let eng = Engine { ffmpeg: dir.join("ffmpeg.exe"), ffprobe: dir.join("ffprobe.exe") };
        let input = PathBuf::from(&video);
        let pr = eng.probe(&input).unwrap();
        println!("probe {:?}", pr);
        let tmp = std::env::temp_dir().join("fk-video-native-test");
        let _ = std::fs::create_dir_all(&tmp);
        let run = |args: Vec<String>| {
            let st = command(&eng.ffmpeg).args(["-hide_banner", "-v", "error"]).args(&args).stdin(Stdio::null()).status().unwrap();
            assert!(st.success(), "ffmpeg failed: {}", args.join(" "));
        };
        let o1 = tmp.join("conv.mkv");
        run(convert_args(&input, &o1, "mkv", "low"));
        let o2 = tmp.join("comp.mp4");
        run(compress_args(&input, &o2, "medium", 0.0, pr.duration));
        let (a, b, _) = gif_args(&input, &tmp.join("pal.png"), &tmp.join("o.gif"), 0.0, 2.0, 240, 10);
        run(a);
        run(b);
        let region = watermark_region(&json!({}), pr.width as i64, pr.height as i64);
        for mode in ["delogo", "blur", "crop"] {
            let o = tmp.join(format!("wm-{mode}.mp4"));
            run(watermark_args(&input, &o, mode, "bottom-right", pr.width as i64, pr.height as i64, region));
            let q = eng.probe(&o).unwrap();
            println!("{mode}: {}x{} {:.2}s", q.width, q.height, q.duration);
            assert!(q.width > 0 && q.duration > 0.0);
        }
        for f in ["conv.mkv", "comp.mp4", "o.gif"] {
            let m = std::fs::metadata(tmp.join(f)).unwrap();
            println!("{f}: {} bytes", m.len());
            assert!(m.len() > 0);
        }
    }
}
