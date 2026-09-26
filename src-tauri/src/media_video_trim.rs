//! Video trimming with owned engines and explicit codec/container fallback.
use serde_json::{json, Value};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    time::Duration,
};
const EXTENSIONS: &[&str] = &[
    "mp4", "m4v", "mov", "mkv", "webm", "avi", "flv", "wmv", "ts",
];
#[derive(Clone, Copy)]
pub(crate) struct Options {
    time: super::trim::Options,
    mp4: bool,
}
impl Options {
    pub(crate) fn parse(args: &Value) -> Result<Self, String> {
        let value = args
            .get("container")
            .and_then(Value::as_str)
            .unwrap_or("same")
            .trim();
        if value.len() > 32 {
            return Err("Video container option is too long".into());
        }
        Ok(Self {
            time: super::trim::Options::parse(args)?,
            mp4: value.trim_start_matches('.').eq_ignore_ascii_case("mp4"),
        })
    }
    fn filename(self, name: &str, index: usize, single: bool) -> String {
        let ext = Path::new(name)
            .extension()
            .and_then(|v| v.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let ext = if self.mp4 || !EXTENSIONS.contains(&ext.as_str()) {
            "mp4"
        } else {
            &ext
        };
        let safe = super::output_name(name, index, ext);
        let suffix = format!(".{ext}");
        let stem = safe.strip_suffix(&suffix).unwrap_or(&safe);
        let stem = if single {
            stem.strip_prefix("001_").unwrap_or(stem)
        } else {
            stem
        };
        format!("{stem}-trimmed.{ext}")
    }
    fn range(self, duration: Option<f64>) -> Result<(Option<f64>, bool), String> {
        let known = duration.filter(|d| *d > 0.0);
        if known.map(|d| self.time.start >= d - 0.01).unwrap_or(false) {
            return Err("开始时间超出视频长度 / Trim start exceeds video duration".into());
        }
        let clamped = matches!((self.time.end,known),(Some(e),Some(d))if e>d);
        let end = match (self.time.end, known) {
            (Some(e), Some(d)) => Some(e.min(d)),
            (e, _) => e,
        };
        Ok((end.map(|e| (e - self.time.start).max(0.05)), clamped))
    }
}
pub(crate) fn mime(ext: &str) -> &'static str {
    match ext {
        "m4v" => "video/x-m4v",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        "webm" => "video/webm",
        "avi" => "video/x-msvideo",
        "flv" => "video/x-flv",
        "wmv" => "video/x-ms-wmv",
        "ts" => "video/mp2t",
        _ => "video/mp4",
    }
}
struct Info {
    index: u64,
    codec: String,
    width: u64,
    height: u64,
    duration: Option<f64>,
    audio: Vec<String>,
    frame_interval: Option<f64>,
}
fn probe(
    program: &Path,
    input: &Path,
    out: &Path,
    check: &dyn Fn() -> Result<(), String>,
    scope: &crate::task_custody::Scope,
) -> Result<Info, String> {
    fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(out)
        .map_err(|e| e.to_string())?;
    let args=vec!["-v".into(),"error".into(),"-protocol_whitelist".into(),"file,pipe".into(),"-show_entries".into(),"stream=index,codec_type,codec_name,width,height,duration,avg_frame_rate,r_frame_rate:stream_disposition=attached_pic:stream_tags=DURATION:format=duration".into(),"-of".into(),"json".into(),"-o".into(),super::argument(out)?,super::argument(input)?];
    super::command(
        program,
        &args,
        out.parent().ok_or("Missing video probe directory")?,
        Duration::from_secs(30),
        None,
        check,
        scope,
    )?;
    let mut bytes = Vec::new();
    fs::File::open(out)
        .map_err(|e| e.to_string())?
        .take(65537)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > 65536 {
        return Err("Video probe exceeds 64 KiB".into());
    }
    let v: Value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
    let streams = v["streams"].as_array().ok_or("Missing video streams")?;
    let video = streams
        .iter()
        .find(|s| {
            s["codec_type"] == "video"
                && s["disposition"]["attached_pic"].as_u64().unwrap_or(0) == 0
        })
        .ok_or("文件没有视频画面，封面不算视频 / No video picture; attached cover is not video")?;
    let width = video["width"].as_u64().unwrap_or(0);
    let height = video["height"].as_u64().unwrap_or(0);
    let codec = video["codec_name"].as_str().unwrap_or("").to_string();
    if width == 0 || height == 0 || codec.is_empty() {
        return Err("Invalid video dimensions or codec".into());
    }
    Ok(Info {
        index: video["index"].as_u64().ok_or("Missing video index")?,
        codec,
        width,
        height,
        duration: super::numeric(&v["format"]["duration"])
            .or_else(|| super::numeric(&video["duration"]))
            .or_else(|| super::timestamp(&video["tags"]["DURATION"])),
        frame_interval: frame_interval(&video["avg_frame_rate"])
            .or_else(|| frame_interval(&video["r_frame_rate"])),
        audio: streams
            .iter()
            .filter(|s| s["codec_type"] == "audio")
            .map(|s| s["codec_name"].as_str().unwrap_or("").to_owned())
            .collect(),
    })
}
fn frame_interval(value: &Value) -> Option<f64> {
    let (n, d) = value.as_str()?.split_once('/')?;
    let n = n.parse::<f64>().ok()?;
    let d = d.parse::<f64>().ok()?;
    if n > 0.0 && d > 0.0 && (d / n).is_finite() {
        Some(d / n)
    } else {
        None
    }
}
fn encoder(ext: &str) -> Vec<String> {
    let args: &[&str] = if ext == "webm" {
        &[
            "-c:v",
            "libvpx-vp9",
            "-crf",
            "32",
            "-b:v",
            "0",
            "-cpu-used",
            "2",
            "-deadline",
            "good",
            "-c:a",
            "libopus",
            "-b:a",
            "128k",
        ]
    } else {
        &[
            "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-c:a",
            "aac", "-b:a", "192k",
        ]
    };
    args.iter().map(|v| v.to_string()).collect()
}
fn verify(
    program: &Path,
    out: &Path,
    sidecar: &Path,
    source: &Info,
    length: Option<f64>,
    precise: bool,
    check: &dyn Fn() -> Result<(), String>,
    scope: &crate::task_custody::Scope,
) -> Result<(u64, Info), String> {
    let bytes = fs::metadata(out).map_err(|e| e.to_string())?.len();
    if bytes <= 64 || bytes >= super::MAX_OUTPUT - 1_000_000 {
        return Err("Invalid video output or byte budget reached".into());
    }
    let info = probe(program, out, sidecar, check, scope)?;
    let duration = info
        .duration
        .filter(|d| *d > if precise { 0.0 } else { 0.05 })
        .ok_or("Video output has no valid duration")?;
    if precise {
        if let Some(want) = length {
            let tolerance = 0.25f64
                .max(info.frame_interval.unwrap_or(0.5) + 0.15)
                .max(want * 0.02);
            if (duration - want).abs() > tolerance {
                return Err(format!(
                    "Precise video duration mismatch: {want:.3}s -> {duration:.3}s"
                ));
            }
        }
    }
    if !precise {
        if let Some(want) = length {
            if (duration - want).abs() > 2.0f64.max(0.6 * want) {
                return Err("Stream-copy duration failed verification".into());
            }
        }
        if info.codec != source.codec || info.audio != source.audio {
            return Err("Stream-copy codecs changed".into());
        }
    }
    if info.audio.len() != source.audio.len() || info.audio.iter().any(|s| s.is_empty()) {
        return Err("Video trim lost an audio track".into());
    }
    Ok((bytes, info))
}
pub(crate) fn run(
    ffmpeg: &Path,
    ffprobe: &Path,
    input: &Path,
    output: &Path,
    opt: Options,
    check: &dyn Fn() -> Result<(), String>,
    scope: &crate::task_custody::Scope,
) -> Result<(PathBuf, Value), String> {
    check()?;
    let meta = fs::metadata(input).map_err(|e| e.to_string())?;
    if !meta.is_file() || meta.len() == 0 || meta.len() > 64 * 1024 * 1024 * 1024 {
        return Err("Invalid or oversized video input".into());
    }
    let alternative = output.with_extension("mp4");
    if fs::symlink_metadata(output).is_ok()
        || (!opt.mp4 && alternative != output && fs::symlink_metadata(&alternative).is_ok())
    {
        return Err("Refusing to overwrite existing video output or fallback".into());
    }
    let dir = output.parent().ok_or("Missing video output directory")?;
    let source = probe(ffprobe, input, &dir.join("video-input.json"), check, scope)?;
    let (length, clamped) = opt.range(source.duration)?;
    let mut target = output.to_owned();
    let mut precise = opt.time.precise;
    let mut reasons = Vec::<String>::new();
    let mut container_fallback = false;
    for attempt in 0..3 {
        check()?;
        let ext = target.extension().and_then(|s| s.to_str()).unwrap_or("mp4");
        let budget = super::budget::video(source.width, source.height, precise, ext == "webm")?;
        let mut args: Vec<String> = vec![
            "-v".into(),
            "error".into(),
            "-nostdin".into(),
            "-n".into(),
            "-max_alloc".into(),
            budget.allocation.to_string(),
            "-threads".into(),
            "2".into(),
            "-filter_threads".into(),
            "2".into(),
            "-protocol_whitelist".into(),
            "file,pipe".into(),
            "-ss".into(),
            format!("{:.3}", opt.time.start),
        ];
        if let Some(length) = length {
            args.extend(["-t".into(), format!("{length:.3}")]);
        }
        args.extend([
            "-i".into(),
            super::argument(input)?,
            "-map".into(),
            format!("0:{}", source.index),
            "-map".into(),
            "0:a?".into(),
        ]);
        if precise {
            args.extend(encoder(ext));
        } else {
            args.extend([
                "-c".into(),
                "copy".into(),
                "-avoid_negative_ts".into(),
                "make_zero".into(),
            ]);
        }
        if matches!(ext, "mp4" | "m4v" | "mov") {
            args.extend(["-movflags".into(), "+faststart".into()]);
        }
        args.extend([
            "-threads".into(),
            "2".into(),
            "-fs".into(),
            super::MAX_OUTPUT.to_string(),
            super::argument(&target)?,
        ]);
        let result = super::command_budget(
            ffmpeg,
            &args,
            dir,
            Duration::from_secs(900),
            Some(&target),
            check,
            scope,
            budget.memory,
        )
        .and_then(|_| {
            verify(
                ffprobe,
                &target,
                &dir.join(format!("video-output-{attempt}.json")),
                &source,
                if precise {
                    length.or_else(|| source.duration.map(|d| (d - opt.time.start).max(0.05)))
                } else {
                    length
                },
                precise,
                check,
                scope,
            )
        });
        match result {
            Ok((bytes, actual)) => {
                check()?;
                let mut warning = if precise {
                    "精确裁剪为有损重编码，非WebM输出8位YUV420；不保证HDR/色彩元数据等价。 / Precise trim is lossy; non-WebM output is 8-bit YUV420; HDR/color metadata parity is not guaranteed.".to_string()
                } else {
                    "快速流复制保留编码，切点对齐关键帧而非精确时间。 / Stream copy preserves codecs; cuts align to keyframes, not exact timestamps.".into()
                };
                if !reasons.is_empty() {
                    warning.push_str(" 先前尝试失败，已安全回退重编码。 / Previous attempt failed; used re-encoding fallback.");
                }
                if container_fallback {
                    warning.push_str(" 容器已回退MP4。 / Container fell back to MP4.");
                }
                if clamped {
                    warning.push_str(" 结束时间已裁到源结尾。 / End clamped to source duration.");
                }
                warning.push_str(&format!(" 输出容器 / Output container: {ext}."));
                let detail = json!({"bytes":bytes,"format":ext,"videoCodec":actual.codec,"width":actual.width,"height":actual.height,"audioCodecs":actual.audio,"duration":actual.duration,"sourceDuration":source.duration,"mode":if precise{"precise"}else{"fast"},"streamCopied":!precise,"endClamped":clamped,"containerFallback":container_fallback,"fallbackReasons":reasons,"warning":warning,"operation":"video-trim","engine":"rust-ffmpeg-owned","memoryBudgetBytes":budget.memory,"maxAllocationBytes":budget.allocation});
                return Ok((target, detail));
            }
            Err(error) => {
                if scope.has_retained_users() {
                    return Err(error);
                }
                check()?;
                let retry = !precise || (!opt.mp4 && ext != "mp4");
                if !retry {
                    return Err(error);
                }
                match fs::remove_file(&target) {
                    Ok(()) => (),
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => (),
                    Err(e) => return Err(e.to_string()),
                }
                reasons.push(error);
                if precise {
                    target = alternative.clone();
                    container_fallback = true;
                }
                precise = true;
            }
        }
    }
    Err("Video trim attempts exhausted".into())
}
pub(crate) fn process(
    ffmpeg: &Path,
    ffprobe: &Path,
    inputs: &[(PathBuf, String)],
    work: &Path,
    opt: Options,
    check: &dyn Fn() -> Result<(), String>,
    progress: &dyn Fn(usize, usize) -> Result<(), String>,
    scope: &crate::task_custody::Scope,
) -> Result<super::Batch, String> {
    if inputs.is_empty() || inputs.len() > 100 {
        return Err("Select 1–100 video files".into());
    }
    let mut batch = super::Batch {
        entries: vec![],
        details: vec![],
        failures: 0,
    };
    let mut total = 0u64;
    for (index, (input, name)) in inputs.iter().enumerate() {
        check()?;
        progress(index, inputs.len())?;
        let dir = work.join(format!("file-{index:03}"));
        fs::create_dir(&dir).map_err(|e| e.to_string())?;
        let target = dir.join(opt.filename(name, index, inputs.len() == 1));
        let result = (|| {
            let input = fs::canonicalize(input).map_err(|e| e.to_string())?;
            run(ffmpeg, ffprobe, &input, &target, opt, check, scope)
        })();
        match result {
            Ok((path, mut detail)) => {
                let bytes = detail["bytes"].as_u64().ok_or("Missing video byte count")?;
                if total + bytes > 1_950_000_000 {
                    return Err("Batch videos exceed 1.95 GB budget".into());
                }
                total += bytes;
                let name_out = path
                    .file_name()
                    .and_then(|s| s.to_str())
                    .ok_or("Invalid video result name")?
                    .to_string();
                let source_ext = Path::new(name)
                    .extension()
                    .and_then(|v| v.to_str())
                    .unwrap_or("")
                    .to_ascii_lowercase();
                detail["requestedContainer"] = json!(if opt.mp4 { "mp4" } else { "same" });
                detail["sourceExtension"] = json!(source_ext);
                if detail["format"].as_str() != Some(source_ext.as_str()) {
                    if let Some(w) = detail["warning"].as_str() {
                        detail["warning"]=json!(format!("{w} 输出扩展与源文件不同，已采用可用容器。 / Output extension differs from source; a supported container was used."));
                    }
                }
                detail["success"] = json!(true);
                detail["inputName"] = json!(name);
                detail["filename"] = json!(name_out);
                batch.details.push(detail);
                batch.entries.push((name_out, path));
            }
            Err(error) => {
                if scope.has_retained_users() {
                    return Err(error);
                }
                check()?;
                if inputs.len() == 1 {
                    return Err(error);
                }
                batch.failures += 1;
                batch
                    .details
                    .push(json!({"success":false,"inputName":name,"error":error}));
            }
        }
    }
    check()?;
    if batch.entries.is_empty() {
        return Err("All video files failed; no output published".into());
    }
    Ok(batch)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn modes_containers_ranges_and_names() {
        for ext in EXTENSIONS {
            let o = Options::parse(&json!({})).unwrap();
            assert_eq!(
                o.filename(&format!("中文.{ext}"), 0, true),
                format!("中文-trimmed.{ext}")
            );
        }
        let o = Options::parse(&json!({"container":".MP4","start":1,"end":99})).unwrap();
        assert_eq!(o.filename("file.WEBM", 0, true), "file-trimmed.mp4");
        assert_eq!(o.range(Some(3.0)).unwrap(), (Some(2.0), true));
        assert!(o.range(Some(1.0)).is_err());
        assert_eq!(
            Options::parse(&json!({}))
                .unwrap()
                .filename("a.mpg", 0, true),
            "a-trimmed.mp4"
        );
        assert!(Options::parse(&json!({"start":-1})).is_err());
        assert!(Options::parse(&json!({"container":"x".repeat(33)})).is_err());
    }
}
