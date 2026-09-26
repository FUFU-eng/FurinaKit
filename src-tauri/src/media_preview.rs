//! Read-only, job-scoped media protocol. Never accept a filesystem path from a URL.
use std::{fs::File, io::{Read, Seek, SeekFrom}, path::Path};
use tauri::http::{Request, Response};

const CHUNK: u64 = 1024 * 1024;
const WHOLE_LIMIT: u64 = 32 * 1024 * 1024;

fn mime(path: &Path) -> Option<&'static str> {
    match path.extension()?.to_str()?.to_ascii_lowercase().as_str() {
        "mp4" | "m4v" => Some("video/mp4"), "webm" => Some("video/webm"),
        "mov" => Some("video/quicktime"), "mkv" => Some("video/x-matroska"),
        "mp3" => Some("audio/mpeg"), "wav" => Some("audio/wav"),
        "m4a" => Some("audio/mp4"), "ogg" | "oga" => Some("audio/ogg"),
        "opus" => Some("audio/ogg"), "flac" => Some("audio/flac"),
        "png" => Some("image/png"), "jpg" | "jpeg" => Some("image/jpeg"),
        "webp" => Some("image/webp"), "gif" => Some("image/gif"),
        "bmp" => Some("image/bmp"), "avif" => Some("image/avif"),
        "ico" => Some("image/x-icon"), _ => None,
    }
}

// Single ranges only. Bound even an open-ended range to one MiB, as Tauri's asset protocol does.
fn range(value: &str, len: u64) -> Option<(u64, u64)> {
    let value = value.strip_prefix("bytes=")?;
    if len == 0 || value.contains(',') { return None; }
    let (a, b) = value.split_once('-')?;
    let (start, end) = if a.is_empty() {
        let suffix: u64 = b.parse().ok()?;
        if suffix == 0 { return None; }
        (len.saturating_sub(suffix), len - 1)
    } else {
        let start: u64 = a.parse().ok()?;
        let end = if b.is_empty() { len - 1 } else { b.parse::<u64>().ok()?.min(len - 1) };
        (start, end)
    };
    if start >= len || end < start { return None; }
    Some((start, end.min(start.saturating_add(CHUNK - 1))))
}

fn response(status: u16, body: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder().status(status).header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff").body(body).unwrap()
}

fn thumbnail(file: File, head: bool) -> Response<Vec<u8>> {
    // Serialize large decodes and impose decoder allocation/dimension limits.
    static DECODE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = DECODE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
    let mut reader = match image::ImageReader::new(std::io::BufReader::new(file)).with_guessed_format() {
        Ok(r) => r, Err(_) => return response(415, vec![]),
    };
    let mut limits = image::Limits::default();
    limits.max_alloc = Some(128 * 1024 * 1024);
    limits.max_image_width = Some(16384);
    limits.max_image_height = Some(16384);
    reader.limits(limits);
    let image = match reader.decode() { Ok(i) => i, Err(_) => return response(413, b"Image exceeds safe preview decoder limits".to_vec()) };
    let preview = image.thumbnail(1600, 1600);
    drop(image);
    let mut bytes = std::io::Cursor::new(Vec::new());
    if preview.write_to(&mut bytes, image::ImageFormat::Png).is_err() { return response(500, vec![]); }
    let bytes = bytes.into_inner();
    Response::builder().status(200).header("Content-Type", "image/png")
        .header("Content-Length", bytes.len()).header("Cache-Control", "no-store")
        .header("X-Content-Type-Options", "nosniff").header("X-FurinaKit-Preview", "thumbnail")
        .body(if head { vec![] } else { bytes }).unwrap()
}

fn serve(mut file: File, mime: &str, req: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let len = match file.metadata() { Ok(m) if m.is_file() => m.len(), _ => return response(404, vec![]) };
    let head = req.method() == "HEAD";
    if len > WHOLE_LIMIT && mime.starts_with("image/") && !req.headers().contains_key("Range") {
        return thumbnail(file, head);
    }
    let partial = if head { None } else { req.headers().get("Range") };
    let (start, end, status) = if let Some(header) = partial {
        match header.to_str().ok().and_then(|h| range(h, len)) {
            Some((s,e)) => (s,e,206),
            None => {
                let mut res = response(416, vec![]);
                res.headers_mut().insert("Content-Range", format!("bytes */{len}").parse().unwrap());
                return res;
            }
        }
    } else {
        // A player uses Range; never silently fall back to a multi-GB whole-file read.
        if !head && len > WHOLE_LIMIT { return response(413, b"Range request required for large media".to_vec()); }
        (0, len.saturating_sub(1), 200)
    };
    let count = if len == 0 { 0 } else { end - start + 1 };
    let mut bytes = Vec::new();
    if !head {
        if file.seek(SeekFrom::Start(start)).is_err() || file.take(count).read_to_end(&mut bytes).is_err()
            || bytes.len() as u64 != count { return response(500, vec![]); }
    }
    let mut builder = Response::builder().status(status)
        .header("Content-Type", mime).header("Accept-Ranges", "bytes")
        .header("Content-Length", if head { len } else { count })
        .header("Cache-Control", "no-store").header("X-Content-Type-Options", "nosniff");
    if status == 206 { builder = builder.header("Content-Range", format!("bytes {start}-{end}/{len}")); }
    builder.body(bytes).unwrap()
}

pub fn handle(app: &tauri::AppHandle, req: Request<Vec<u8>>) -> Response<Vec<u8>> {
    if req.method() != "GET" && req.method() != "HEAD" { return response(405, vec![]); }
    let raw_path = req.uri().path().trim_start_matches('/');
    // convertFileSrc encodes a supplied slash. Decode ONLY that delimiter, never arbitrary paths.
    let decoded = raw_path.replace("%2F", "/").replace("%2f", "/");
    let path = decoded.as_str();
    let (id, stem) = path.split_once('/').map(|(id,stem)|(id,Some(stem))).unwrap_or((path,None));
    if !crate::jobs::is_valid_job_id(id) { return response(400, vec![]); }
    let job = match crate::jobs::read_job_public(app, id) { Some(j) => j, None => return response(404, vec![]) };
    if job["status"].as_str() != Some("completed") { return response(409, vec![]); }
    let artifact = match stem {
        Some(stem) => crate::artifact_store::resolve_stem(&crate::jobs::storage_dir_of(app), &job, stem),
        None => crate::jobs::job_artifact(app, &job),
    };
    let path = match artifact { Some(p) => p, None => return response(404, vec![]) };
    let content_type = match mime(&path) { Some(m) => m, None => return response(415, vec![]) };
    match File::open(path) { Ok(file) => serve(file, content_type, &req), Err(_) => response(404, vec![]) }
}

#[cfg(test)]
#[path = "worker_artifact_integration.rs"]
mod worker_integration;

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn large_image_get_has_bounded_thumbnail_not_permanent_413() {
        let path = std::env::temp_dir().join(format!("fk-thumb-{}.bmp", crate::jobs::new_job_id_public()));
        let image = image::RgbImage::from_pixel(6000, 2000, image::Rgb([25, 75, 125]));
        image.save(&path).unwrap(); drop(image);
        assert!(std::fs::metadata(&path).unwrap().len() > WHOLE_LIMIT);
        let req = Request::builder().method("GET").body(vec![]).unwrap();
        let res = serve(File::open(&path).unwrap(), "image/bmp", &req);
        assert_eq!(res.status(), 200); assert_eq!(res.headers()["X-FurinaKit-Preview"], "thumbnail");
        let decoded = image::load_from_memory(res.body()).unwrap();
        assert_eq!(decoded.width(), 1600); assert!(decoded.height() <= 1600);
        assert!(res.body().len() < WHOLE_LIMIT as usize);
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn ranges() {
        assert_eq!(range("bytes=0-9", 100), Some((0,9)));
        assert_eq!(range("bytes=90-", 100), Some((90,99)));
        assert_eq!(range("bytes=-10", 100), Some((90,99)));
        assert_eq!(range("bytes=90-1000", 100), Some((90,99)));
        assert_eq!(range("bytes=0-", 5_000_000_000), Some((0,CHUNK-1)));
        for bad in ["bytes=100-", "bytes=10-9", "bytes=-0", "bytes=0-1,4-5", "bytes=a-b", "other=0-9", "bytes=18446744073709551616-"] {
            assert_eq!(range(bad,100), None, "{bad}");
        }
        assert_eq!(range("bytes=0-", 0), None);
    }
    #[test]
    fn media_types() {
        assert_eq!(mime(Path::new("中文.MP4")), Some("video/mp4"));
        assert_eq!(mime(Path::new("report.html")), None);
        assert_eq!(mime(Path::new("script.svg")), None);
    }

    #[test]
    fn large_file_responses() {
        use std::io::Write;
        let path = std::env::temp_dir().join(format!("fk-preview-{}.mp4", crate::jobs::new_job_id_public()));
        let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&path).unwrap();
        file.set_len(64 * 1024 * 1024).unwrap();
        file.seek(SeekFrom::Start(50 * 1024 * 1024)).unwrap();
        file.write_all(b"seek-marker").unwrap();
        drop(file);
        let request = |method: &str, r: Option<&str>| {
            let mut b = Request::builder().method(method);
            if let Some(r) = r { b = b.header("Range", r); }
            b.body(Vec::new()).unwrap()
        };
        let first = serve(File::open(&path).unwrap(), "video/mp4", &request("GET", Some("bytes=0-")));
        assert_eq!(first.status(), 206);
        assert_eq!(first.body().len(), CHUNK as usize);
        assert_eq!(first.headers()["Content-Range"], "bytes 0-1048575/67108864");
        let seek = serve(File::open(&path).unwrap(), "video/mp4", &request("GET", Some("bytes=52428800-52428810")));
        assert_eq!(seek.body(), b"seek-marker");
        let head = serve(File::open(&path).unwrap(), "video/mp4", &request("HEAD", None));
        assert_eq!(head.status(), 200); assert!(head.body().is_empty());
        assert_eq!(head.headers()["Content-Length"], "67108864");
        let invalid = serve(File::open(&path).unwrap(), "video/mp4", &request("GET", Some("bytes=67108864-")));
        assert_eq!(invalid.status(), 416);
        assert_eq!(invalid.headers()["Content-Range"], "bytes */67108864");
        assert_eq!(serve(File::open(&path).unwrap(), "video/mp4", &request("GET", None)).status(), 413);
        std::fs::remove_file(path).unwrap(); // Only this test's freshly-created fixture.
    }
}
