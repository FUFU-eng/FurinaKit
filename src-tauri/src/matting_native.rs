//! 换背景 / 精细抠图 / 证件照（以及去水印、老照片修复的任务调度，算法见 inpaint_native.rs / photo_restore_native.rs）：Rust 原生实现（去 Python 化，替代 OpenCV）。
//!
//! 与 Python 版（services/worker/app/tasks.py 的 bg-replace / precise-matting 分支、
//! tools/isnet_matting.py、tools/id_photo.py）逐步对齐：
//!   · 抠图推理复用 `crate::onnx::alpha_from_image`（与 isnet_matting.py 同一套前后处理）；
//!   · 羽化 / 虚化 = OpenCV `GaussianBlur(ksize=2r+1, sigma=0)`：同样的核公式、
//!     同样的 BORDER_REFLECT_101 边界，结果与 OpenCV 最多相差 1 个灰阶（取整差异）；
//!   · 合成 = `img*a + bg*(1-a)` 后截断为 u8（与 numpy `astype(uint8)` 一致）；
//!   · 纯色表沿用 Python 实际输出的颜色（Python 那张表是 BGR，这里换算成 RGB 后保持一致）；
//!   · 读取图片时应用 EXIF 方向（cv2.imdecode 的 IMREAD_COLOR 默认也会这样做）；
//!   · 证件照规格、6 寸相纸排版的选择规则与 id_photo.py 完全相同。

use std::io::Cursor;
use std::path::{Path, PathBuf};

use image::imageops::FilterType;
use image::{DynamicImage, ImageDecoder, ImageReader, Rgb, RgbImage, Rgba, RgbaImage};
use serde_json::{json, Map, Value};

const ISNET: &str = "isnet-general-use.onnx";
const MISSING_ISNET: &str = "还没下载抠图模型。请在本工具页上方或「设置 → 按需下载组件」下载「精细抠图」（推荐）或「快速抠图」模型后重试（约 170MB）";

pub fn supported(tool: &str) -> bool {
    matches!(tool, "bg-replace" | "precise-matting" | "id-photo" | "watermark-remove" | "photo-restore" | "ai-outpaint" | "colorize-photo")
}

// ───────────────────────── 入口：建任务 + 后台线程 ─────────────────────────

pub fn start(app: &tauri::AppHandle, tool: &str, args: &Value) -> Result<Value, String> {
    let tool = tool.to_string();
    let mut payload = args.clone();
    let mut uploads: Vec<Value> = Vec::new();
    if let Some(files) = payload.get("__files").and_then(Value::as_array).cloned() {
        let upload_id = crate::jobs::new_job_id_public();
        uploads = crate::jobs::save_request_uploads(app, &upload_id, &files)?;
    }
    if let Some(o) = payload.as_object_mut() {
        o.remove("__files");
        o.remove("__path");
        o.remove("__method");
    }

    let pick = |field: &str| -> Option<(String, String)> {
        uploads
            .iter()
            .find(|u| u.get("field").and_then(Value::as_str) == Some(field))
            .and_then(|u| {
                let p = u.get("path").and_then(Value::as_str)?.to_string();
                let n = u.get("name").and_then(Value::as_str).unwrap_or("").to_string();
                Some((p, n))
            })
    };
    // 主图：优先上传字段 file；兼容直接给路径的调用方式
    let (input, input_name) = pick("file")
        .or_else(|| {
            // 没有 file 字段时取第一个非背景图上传
            uploads
                .iter()
                .find(|u| u.get("field").and_then(Value::as_str) != Some("bg_image"))
                .and_then(|u| {
                    Some((
                        u.get("path").and_then(Value::as_str)?.to_string(),
                        u.get("name").and_then(Value::as_str).unwrap_or("").to_string(),
                    ))
                })
        })
        .or_else(|| {
            payload
                .get("file")
                .or_else(|| payload.get("path"))
                .and_then(Value::as_str)
                .map(|s| (s.to_string(), String::new()))
        })
        .ok_or("没有收到要处理的图片")?;
    if !Path::new(&input).is_file() {
        return Err(format!("找不到输入图片：{input}"));
    }
    if let Some((bg, _)) = pick("bg_image") {
        payload["bg_image"] = json!(bg);
    }
    if let Some((reference, _)) = pick("reference_file") {
        payload["reference_file"] = json!(reference);
    }
    payload["file"] = json!(input);

    let job = crate::jobs::create_local_job(app, &tool, payload.clone())?;
    let id = job.get("id").and_then(Value::as_str).ok_or("建任务失败")?.to_string();

    let app_bg = app.clone();
    let id_bg = id.clone();
    std::thread::spawn(move || {
        progress(&app_bg, &id_bg, 10, match tool.as_str() {
            "id-photo" => "正在抠人像并换底色…",
            "watermark-remove" => "正在准备去水印…",
            "photo-restore" => "正在读取老照片…",
            "ai-outpaint" => "正在准备扩图…",
            "colorize-photo" => "正在准备上色…",
            _ => "AI 正在分析主体轮廓…",
        });
        let stem = display_stem(&input, &input_name);
        let result = match tool.as_str() {
            "bg-replace" => bg_replace(&app_bg, &id_bg, &input, &stem, &payload),
            "precise-matting" => precise_matting(&app_bg, &id_bg, &input, &stem, &payload),
            "id-photo" => id_photo(&app_bg, &id_bg, &input, &stem, &payload),
            "watermark-remove" => crate::inpaint_native::watermark_remove(&app_bg, &id_bg, &input, &stem, &payload),
            "photo-restore" => crate::photo_restore_native::photo_restore(&app_bg, &id_bg, &input, &stem, &payload),
            "ai-outpaint" => crate::ai_image_native::outpaint(&app_bg, &id_bg, &input, &stem, &payload),
            "colorize-photo" => crate::ai_image_native::colorize(&app_bg, &id_bg, &input, &stem, &payload),
            other => Err(format!("不支持的工具：{other}")),
        };

        // 被取消过就不再写终态（与 bg-remove 分支一致）
        let cancelled = crate::jobs::read_job_public(&app_bg, &id_bg)
            .and_then(|j| j.get("status").and_then(Value::as_str).map(|s| s == "failed"))
            .unwrap_or(false);
        if cancelled {
            return;
        }
        let mut m = Map::new();
        match result {
            Ok(r) => {
                m.insert("status".into(), json!("completed"));
                m.insert("progress".into(), json!(100));
                m.insert("message".into(), r.get("message").cloned().unwrap_or(json!("处理完成")));
                m.insert("resultPath".into(), r.get("path").cloned().unwrap_or(json!("")));
                m.insert("resultFilename".into(), r.get("filename").cloned().unwrap_or(json!("")));
                m.insert("resultMimeType".into(), r.get("mime").cloned().unwrap_or(json!("image/png")));
                if let Some(w) = r.get("width") { m.insert("width".into(), w.clone()); }
                if let Some(h) = r.get("height") { m.insert("height".into(), h.clone()); }
                m.insert("engine".into(), json!(if matches!(tool.as_str(), "watermark-remove" | "photo-restore") { "rust-native" } else { "rust-onnx" }));
            }
            Err(e) => {
                m.insert("status".into(), json!("failed"));
                m.insert("progress".into(), json!(100));
                m.insert("message".into(), json!("处理失败"));
                m.insert("error".into(), json!(e));
            }
        }
        crate::jobs::update_job(&app_bg, &id_bg, m);
    });

    let current = crate::jobs::read_job_public(app, &id).unwrap_or(job);
    Ok(json!({ "job": current, "ok": true, "engine": "rust-onnx" }))
}

pub(crate) fn progress(app: &tauri::AppHandle, id: &str, pct: u32, message: &str) {
    let mut m = Map::new();
    m.insert("status".into(), json!("processing"));
    m.insert("progress".into(), json!(pct));
    m.insert("message".into(), json!(message));
    crate::jobs::update_job(app, id, m);
}

/// 结果文件名里用的主名：优先用户原始文件名，其次落盘文件名去掉 "0000-" 批次前缀
pub(crate) fn display_stem(path: &str, original: &str) -> String {
    let from = |s: &str| Path::new(s).file_stem().map(|x| x.to_string_lossy().to_string());
    if let Some(s) = from(original).filter(|s| !s.is_empty()) {
        return s;
    }
    let s = from(path).unwrap_or_else(|| "output".into());
    let b = s.as_bytes();
    if b.len() > 5 && b[..4].iter().all(u8::is_ascii_digit) && b[4] == b'-' {
        s[5..].to_string()
    } else {
        s
    }
}

// ───────────────────────── 公共小工具 ─────────────────────────

pub(crate) fn number(payload: &Value, key: &str, default: f64) -> f64 {
    match payload.get(key) {
        Some(Value::Number(n)) => n.as_f64().unwrap_or(default),
        Some(Value::String(s)) => s.trim().parse::<f64>().unwrap_or(default),
        _ => default,
    }
}

pub(crate) fn text<'a>(payload: &'a Value, key: &str, default: &'a str) -> &'a str {
    payload.get(key).and_then(Value::as_str).unwrap_or(default)
}

/// 读图并应用 EXIF 方向（对齐 cv2.imdecode(IMREAD_COLOR)）
pub(crate) fn load_image(path: &str) -> Result<DynamicImage, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("读不到图片：{e}"))?;
    let reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|e| format!("无法读取图片：{e}"))?;
    let mut decoder = reader.into_decoder().map_err(|_| "无法读取图片".to_string())?;
    let orientation = decoder.orientation().ok();
    let mut img = DynamicImage::from_decoder(decoder).map_err(|_| "无法读取图片".to_string())?;
    if let Some(o) = orientation {
        img.apply_orientation(o);
    }
    Ok(img)
}

pub(crate) fn model_in_components(app: &tauri::AppHandle, names: &[&str]) -> Option<PathBuf> {
    let dir = crate::api::components_dir(app).ok()?;
    names.iter().map(|n| dir.join(n)).find(|p| p.is_file())
}

/// 推理得到 0~255 alpha（与 isnet_matting.alpha_with_model 一致），持有组件租约
fn alpha_for(app: &tauri::AppHandle, img: &DynamicImage, model: &Path) -> Result<Vec<u8>, String> {
    let filename = model.file_name().and_then(|s| s.to_str()).ok_or("Invalid model filename")?;
    let _lease = crate::api::component_use(app, &[filename])?;
    let fallback = crate::onnx::fallback_size_for(model);
    crate::onnx::alpha_from_image(img, &model.to_string_lossy(), fallback)
}

pub(crate) fn results_path(app: &tauri::AppHandle, id: &str, plain: &str) -> Result<PathBuf, String> {
    let dir = crate::jobs::storage_dir_of(app).join("results");
    std::fs::create_dir_all(&dir).map_err(|e| format!("建结果目录失败：{e}"))?;
    Ok(dir.join(format!("{id}-{plain}")))
}

/// Python 实际输出的颜色（原表是 BGR，这里已换算为 RGB，保持输出不变）
fn palette_rgb(name: &str) -> Option<[u8; 3]> {
    match name {
        "white" => Some([255, 255, 255]),
        "blue" => Some([55, 68, 219]),
        "red" => Some([237, 28, 36]),
        "black" => Some([0, 0, 0]),
        "green" => Some([76, 175, 80]),
        "gray" => Some([200, 200, 200]),
        _ => None,
    }
}

// ───────────────────────── 高斯模糊（对齐 OpenCV） ─────────────────────────

/// cv2.getGaussianKernel(n, sigma<=0)：n≤7 用固定表，否则 sigma = 0.3*((n-1)*0.5-1)+0.8
fn gaussian_kernel(n: usize) -> Vec<f32> {
    match n {
        1 => return vec![1.0],
        3 => return vec![0.25, 0.5, 0.25],
        5 => return vec![0.0625, 0.25, 0.375, 0.25, 0.0625],
        7 => return vec![0.03125, 0.109375, 0.21875, 0.28125, 0.21875, 0.109375, 0.03125],
        _ => {}
    }
    let sigma = 0.3 * ((n as f64 - 1.0) * 0.5 - 1.0) + 0.8;
    let scale = -0.5 / (sigma * sigma);
    let c = (n as f64 - 1.0) * 0.5;
    let raw: Vec<f64> = (0..n).map(|i| { let x = i as f64 - c; (scale * x * x).exp() }).collect();
    let sum: f64 = raw.iter().sum();
    raw.into_iter().map(|v| (v / sum) as f32).collect()
}

/// BORDER_REFLECT_101：…3 2 1 | 0 1 2 3 … n-1 | n-2 n-3 …
fn reflect101(mut i: isize, len: usize) -> usize {
    if len == 1 {
        return 0;
    }
    let n = len as isize;
    let period = 2 * (n - 1);
    i = i.rem_euclid(period);
    if i >= n { (period - i) as usize } else { i as usize }
}

/// 对交错排列的 u8 缓冲（channels 通道）做可分离高斯模糊，ksize = 2*radius+1
fn gaussian_blur_u8(data: &[u8], w: usize, h: usize, channels: usize, ksize: usize) -> Vec<u8> {
    if ksize <= 1 || w == 0 || h == 0 {
        return data.to_vec();
    }
    let k = gaussian_kernel(ksize);
    let r = (ksize / 2) as isize;
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(1, 16);

    // 水平方向 → f32
    let mut tmp = vec![0f32; w * h * channels];
    let xs: Vec<Vec<usize>> = (0..w)
        .map(|x| (0..ksize).map(|t| reflect101(x as isize + t as isize - r, w)).collect())
        .collect();
    let rows_per = h.div_ceil(threads);
    std::thread::scope(|s| {
        for (ci, chunk) in tmp.chunks_mut(rows_per * w * channels).enumerate() {
            let xs = &xs;
            let k = &k;
            s.spawn(move || {
                let y0 = ci * rows_per;
                for (ry, row) in chunk.chunks_mut(w * channels).enumerate() {
                    let src = &data[(y0 + ry) * w * channels..(y0 + ry + 1) * w * channels];
                    for x in 0..w {
                        for c in 0..channels {
                            let mut acc = 0f32;
                            for (t, &sx) in xs[x].iter().enumerate() {
                                acc += k[t] * src[sx * channels + c] as f32;
                            }
                            row[x * channels + c] = acc;
                        }
                    }
                }
            });
        }
    });

    // 垂直方向 → u8（四舍五入 + 饱和，对齐 saturate_cast）
    let mut out = vec![0u8; w * h * channels];
    let ys: Vec<Vec<usize>> = (0..h)
        .map(|y| (0..ksize).map(|t| reflect101(y as isize + t as isize - r, h)).collect())
        .collect();
    std::thread::scope(|s| {
        for (ci, chunk) in out.chunks_mut(rows_per * w * channels).enumerate() {
            let ys = &ys;
            let k = &k;
            let tmp = &tmp;
            s.spawn(move || {
                let y0 = ci * rows_per;
                for (ry, row) in chunk.chunks_mut(w * channels).enumerate() {
                    let y = y0 + ry;
                    for i in 0..w * channels {
                        let mut acc = 0f32;
                        for (t, &sy) in ys[y].iter().enumerate() {
                            acc += k[t] * tmp[sy * w * channels + i];
                        }
                        row[i] = acc.round().clamp(0.0, 255.0) as u8;
                    }
                }
            });
        }
    });
    out
}

fn feather_alpha(alpha: Vec<u8>, w: u32, h: u32, feather: i64) -> Vec<u8> {
    if feather > 0 {
        gaussian_blur_u8(&alpha, w as usize, h as usize, 1, (feather * 2 + 1) as usize)
    } else {
        alpha
    }
}

/// out = fg*a + bg*(1-a)，截断为 u8
fn blend(fg: &RgbImage, bg: &[u8], alpha: &[u8]) -> RgbImage {
    let (w, h) = fg.dimensions();
    let mut out = RgbImage::new(w, h);
    for (i, (p, o)) in fg.pixels().zip(out.pixels_mut()).enumerate() {
        let a = alpha[i] as f32 / 255.0;
        let b = &bg[i * 3..i * 3 + 3];
        *o = Rgb([
            (p[0] as f32 * a + b[0] as f32 * (1.0 - a)) as u8,
            (p[1] as f32 * a + b[1] as f32 * (1.0 - a)) as u8,
            (p[2] as f32 * a + b[2] as f32 * (1.0 - a)) as u8,
        ]);
    }
    out
}

fn solid(w: u32, h: u32, c: [u8; 3]) -> Vec<u8> {
    let mut v = Vec::with_capacity((w * h * 3) as usize);
    for _ in 0..(w as usize * h as usize) {
        v.extend_from_slice(&c);
    }
    v
}

// ───────────────────────── 图片换背景 ─────────────────────────

fn bg_replace(app: &tauri::AppHandle, id: &str, input: &str, stem: &str, payload: &Value) -> Result<Value, String> {
    let model = model_in_components(app, &[ISNET, "u2net.onnx", "u2net_human_seg.onnx"]).ok_or(MISSING_ISNET)?;
    let img = load_image(input)?;
    let mode = text(payload, "mode", "color").to_string();

    let bg_img = if mode == "image" {
        let bp = payload.get("bg_image").and_then(Value::as_str).unwrap_or("");
        if bp.is_empty() || !Path::new(bp).is_file() {
            return Err("选择了「使用背景图」但没有上传背景图".into());
        }
        Some(load_image(bp).map_err(|_| "背景图无法读取".to_string())?)
    } else {
        None
    };

    progress(app, id, 30, "AI 正在分析主体轮廓…");
    let alpha = alpha_for(app, &img, &model)?;
    let rgb = img.to_rgb8();
    let (w, h) = rgb.dimensions();

    progress(app, id, 75, "正在合成新背景…");
    let blur = if mode == "blur" { number(payload, "blur", 20.0) as i64 } else { 0 };
    let out = compose_bg_replace(&rgb, alpha, payload, bg_img.as_ref());
    let plain = format!("{stem}_换背景.png");
    let path = results_path(app, id, &plain)?;
    out.save(&path).map_err(|_| "结果保存失败".to_string())?;
    let message = match mode.as_str() {
        "image" => "已换成上传的背景图".to_string(),
        "blur" => format!("已虚化原背景（模糊 {blur}）"),
        _ => "已换成纯色背景".to_string(),
    };
    Ok(json!({ "path": path.to_string_lossy(), "filename": plain, "mime": "image/png",
               "message": message, "width": w, "height": h }))
}

/// 换背景的合成部分（不含推理），与 Python compose_background 对齐
pub(crate) fn compose_bg_replace(rgb: &RgbImage, alpha: Vec<u8>, payload: &Value, bg_img: Option<&DynamicImage>) -> RgbImage {
    let (w, h) = rgb.dimensions();
    let mode = text(payload, "mode", "color");
    let color = palette_rgb(text(payload, "color", "white")).unwrap_or([255, 255, 255]);
    let blur = if mode == "blur" { number(payload, "blur", 20.0) as i64 } else { 0 };
    let feather = number(payload, "feather", 0.0) as i64;
    let alpha = feather_alpha(alpha, w, h, feather);

    let background: Vec<u8> = if let Some(bg) = bg_img {
        // 等比放大到覆盖整张画布，再居中裁切（与 Python compose_background 一致）
        let bg = bg.to_rgb8();
        let (bw, bh) = bg.dimensions();
        let scale = (w as f64 / bw as f64).max(h as f64 / bh as f64);
        let nw = ((bw as f64 * scale) as u32).max(1);
        let nh = ((bh as f64 * scale) as u32).max(1);
        let resized = image::imageops::resize(&bg, nw, nh, FilterType::Triangle);
        let x0 = nw.saturating_sub(w) / 2;
        let y0 = nh.saturating_sub(h) / 2;
        let mut v = vec![0u8; (w * h * 3) as usize];
        for y in 0..h.min(nh - y0) {
            for x in 0..w.min(nw - x0) {
                let p = resized.get_pixel(x0 + x, y0 + y);
                let i = ((y * w + x) * 3) as usize;
                v[i..i + 3].copy_from_slice(&p.0);
            }
        }
        v
    } else if blur > 0 {
        gaussian_blur_u8(rgb.as_raw(), w as usize, h as usize, 3, (blur * 2 + 1) as usize)
    } else if mode != "image" && mode != "blur" {
        solid(w, h, color)
    } else {
        vec![0u8; (w * h * 3) as usize]
    };
    blend(rgb, &background, &alpha)
}

// ───────────────────────── 精细抠图 ─────────────────────────

fn precise_matting(app: &tauri::AppHandle, id: &str, input: &str, stem: &str, payload: &Value) -> Result<Value, String> {
    let model = model_in_components(app, &[ISNET, "u2net.onnx", "u2net_human_seg.onnx"]).ok_or(MISSING_ISNET)?;
    let img = load_image(input)?;
    let bg = text(payload, "background", "transparent").to_string();

    progress(app, id, 30, "AI 正在分析主体轮廓…");
    let alpha = alpha_for(app, &img, &model)?;
    let rgb = img.to_rgb8();
    let (w, h) = rgb.dimensions();
    progress(app, id, 80, "正在输出结果…");
    let plain = if bg == "transparent" { format!("{stem}_已抠图.png") } else { format!("{stem}_换底.png") };
    let path = results_path(app, id, &plain)?;
    compose_precise(&rgb, alpha, payload).save(&path).map_err(|_| "结果保存失败".to_string())?;
    let message = if bg == "transparent" { "已抠出透明背景 PNG".to_string() } else { format!("已抠图并换成{bg}底") };
    Ok(json!({ "path": path.to_string_lossy(), "filename": plain, "mime": "image/png",
               "message": message, "width": w, "height": h }))
}

/// 精细抠图的输出部分（不含推理）：透明 PNG 或纯色底
pub(crate) fn compose_precise(rgb: &RgbImage, alpha: Vec<u8>, payload: &Value) -> DynamicImage {
    let (w, h) = rgb.dimensions();
    let bg = text(payload, "background", "transparent");
    // Python 这张表没有 gray：给 gray 时同样按透明输出
    let color = if bg == "gray" { None } else { palette_rgb(bg) };
    let feather = number(payload, "feather", 0.0) as i64;
    let alpha = feather_alpha(alpha, w, h, feather);
    match color {
        None => {
            let mut out = RgbaImage::new(w, h);
            for (i, (p, o)) in rgb.pixels().zip(out.pixels_mut()).enumerate() {
                *o = Rgba([p[0], p[1], p[2], alpha[i]]);
            }
            DynamicImage::ImageRgba8(out)
        }
        Some(c) => DynamicImage::ImageRgb8(blend(rgb, &solid(w, h, c), &alpha)),
    }
}

// ───────────────────────── 证件照 ─────────────────────────

const DPI: f64 = 300.0;

fn mm_to_px(mm: f64) -> u32 {
    (mm / 25.4 * DPI).round() as u32
}

fn spec(key: &str) -> Option<(f64, f64, &'static str)> {
    Some(match key {
        "one" => (25.0, 35.0, "一寸（25×35mm）"),
        "one-big" => (33.0, 48.0, "大一寸（33×48mm）"),
        "one-small" => (22.0, 32.0, "小一寸（22×32mm）"),
        "two" => (35.0, 49.0, "二寸（35×49mm）"),
        "two-small" => (35.0, 45.0, "小二寸（35×45mm）"),
        "two-big" => (35.0, 53.0, "大二寸（35×53mm）"),
        "passport" => (33.0, 48.0, "护照（33×48mm）"),
        _ => return None,
    })
}

fn id_bg(key: &str) -> Option<([u8; 3], &'static str)> {
    Some(match key {
        "white" => ([255, 255, 255], "白底"),
        "blue" => ([67, 142, 219], "蓝底"),
        "red" => ([214, 58, 58], "红底"),
        "gray" => ([221, 221, 221], "灰底"),
        _ => return None,
    })
}

fn truthy(v: Option<&Value>) -> bool {
    match v {
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().map(|x| x != 0.0).unwrap_or(false),
        Some(Value::String(s)) => matches!(s.trim().to_lowercase().as_str(), "yes" | "true" | "1" | "8"),
        _ => false,
    }
}

fn id_photo(app: &tauri::AppHandle, id: &str, input: &str, stem: &str, payload: &Value) -> Result<Value, String> {
    let model = model_in_components(app, &[ISNET, "u2net.onnx", "u2net_human_seg.onnx"])
        .ok_or("还没下载抠图模型。请先在「图片换背景」工具页上方（或设置里的「按需下载组件」）下载后重试")?;
    let img = load_image(input).map_err(|_| "这张图片读不出来（可能格式不对或文件损坏）".to_string())?;

    progress(app, id, 25, "正在抠人像并换底色…");
    let alpha = alpha_for(app, &img, &model)?;
    let rgb = img.to_rgb8();
    progress(app, id, 70, "正在按规格输出…");
    let (out, label) = compose_id_photo(&rgb, alpha, payload)?;
    let plain = format!("{stem}_证件照.jpg");
    let path = results_path(app, id, &plain)?;
    {
        let file = std::fs::File::create(&path).map_err(|e| format!("保存失败：{e}"))?;
        let mut writer = std::io::BufWriter::new(file);
        let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut writer, 95);
        enc.set_pixel_density(image::codecs::jpeg::PixelDensity::dpi(300));
        enc.encode_image(&out).map_err(|e| format!("保存失败：{e}"))?;
    }
    let (ow, oh) = out.dimensions();
    Ok(json!({ "path": path.to_string_lossy(), "filename": plain, "mime": "image/jpeg",
               "message": format!("{label} · {ow}×{oh} 像素"), "width": ow, "height": oh }))
}

/// 证件照的合成与排版部分（不含推理），返回图片与说明文字
pub(crate) fn compose_id_photo(rgb: &RgbImage, alpha: Vec<u8>, payload: &Value) -> Result<(RgbImage, String), String> {
    let (w, h) = rgb.dimensions();
    let spec_key = text(payload, "spec", "one");
    let (w_mm, h_mm, spec_label) = spec(spec_key).or_else(|| spec("one")).unwrap();
    let (bg_rgb, bg_label) = id_bg(text(payload, "bg", "white")).or_else(|| id_bg("white")).unwrap();
    let layout = truthy(payload.get("layout"));
    // Python：int(opts.get("feather", 2) or 0) —— 前端不传时默认 2
    let feather = match payload.get("feather") {
        None | Some(Value::Null) => 2,
        Some(_) => number(payload, "feather", 0.0) as i64,
    };
    let (out_w, out_h) = (mm_to_px(w_mm), mm_to_px(h_mm));
    let alpha = feather_alpha(alpha, w, h, feather);
    if !alpha.iter().any(|&a| a > 24) {
        return Err("没能识别人像，请换一张背景清晰的照片".into());
    }

    let merged = blend(rgb, &solid(w, h, bg_rgb), &alpha);
    let single = image::imageops::resize(&merged, out_w, out_h, FilterType::Lanczos3);

    let mut layout_count = 1;
    let out: RgbImage = if layout {
        // 横向 6 寸相纸；两种朝向都试，不缩小冲印尺寸（与 id_photo.py 相同的选择规则）
        let (sheet_w, sheet_h) = (mm_to_px(152.0), mm_to_px(102.0));
        let margin = mm_to_px(3.0);
        let mut best: Option<(u32, bool, u32, u32, bool)> = None;
        for rotated in [false, true] {
            let (tw, th) = if rotated { (out_h, out_w) } else { (out_w, out_h) };
            for cols in 1..=8u32 {
                for rows in 1..=8u32 {
                    let count = cols * rows;
                    if count > 8 {
                        continue;
                    }
                    if cols * tw + (cols + 1) * margin <= sheet_w && rows * th + (rows + 1) * margin <= sheet_h {
                        let cand = (count, !rotated, cols, rows, rotated);
                        if best.map_or(true, |b| cand > b) {
                            best = Some(cand);
                        }
                    }
                }
            }
        }
        let (count, _, cols, rows, rotated) = best.ok_or("此规格无法放入6寸相纸，请选择单张输出")?;
        layout_count = count;
        let tile = if rotated { image::imageops::rotate270(&single) } else { single.clone() };
        let (tw, th) = tile.dimensions();
        let gx = (sheet_w - cols * tw) / (cols + 1);
        let gy = (sheet_h - rows * th) / (rows + 1);
        let mut sheet = RgbImage::from_pixel(sheet_w, sheet_h, Rgb([255, 255, 255]));
        let line = Rgb([200, 200, 200]);
        for row in 0..rows {
            for col in 0..cols {
                let x = gx * (col + 1) + tw * col;
                let y = gy * (row + 1) + th * row;
                image::imageops::replace(&mut sheet, &tile, x as i64, y as i64);
                // PIL rectangle((x-1,y-1,x+tw,y+th), outline=...)，坐标含端点
                let (x0, y0, x1, y1) = (x as i64 - 1, y as i64 - 1, (x + tw) as i64, (y + th) as i64);
                let mut put = |px: i64, py: i64| {
                    if px >= 0 && py >= 0 && (px as u32) < sheet_w && (py as u32) < sheet_h {
                        sheet.put_pixel(px as u32, py as u32, line);
                    }
                };
                for px in x0..=x1 { put(px, y0); put(px, y1); }
                for py in y0..=y1 { put(x0, py); put(x1, py); }
            }
        }
        sheet
    } else {
        single
    };

    let label = if layout {
        format!("{spec_label} · 6寸相纸排版{layout_count}张 · {bg_label}")
    } else {
        format!("{spec_label} · 保留原构图 · {bg_label}")
    };
    Ok((out, label))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reflect101_matches_opencv() {
        let v: Vec<usize> = (-3..8).map(|i| reflect101(i, 5)).collect();
        assert_eq!(v, vec![3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1]);
        assert_eq!(reflect101(-7, 1), 0);
    }

    #[test]
    fn gaussian_kernel_sums_to_one_and_matches_small_tables() {
        assert_eq!(gaussian_kernel(5), vec![0.0625, 0.25, 0.375, 0.25, 0.0625]);
        for n in [9usize, 21, 41, 81] {
            let s: f32 = gaussian_kernel(n).iter().sum();
            assert!((s - 1.0).abs() < 1e-4, "{n}: {s}");
        }
    }

    #[test]
    fn blur_keeps_constant_image() {
        let data = vec![77u8; 13 * 7 * 3];
        assert_eq!(gaussian_blur_u8(&data, 13, 7, 3, 21), data);
    }

    #[test]
    fn id_photo_sizes_and_layout() {
        assert_eq!((mm_to_px(25.0), mm_to_px(35.0)), (295, 413));
        assert_eq!((mm_to_px(35.0), mm_to_px(49.0)), (413, 579));
    }

    #[test]
    fn stem_strips_batch_prefix() {
        assert_eq!(display_stem(r"C:\x\0000-照片.jpg", ""), "照片");
        assert_eq!(display_stem(r"C:\x\0000-a.jpg", "原图.png"), "原图");
    }

    /// 新旧对比：读取旧版（Python+OpenCV）用同一份 alpha 生成的参考图，逐像素比较。
    /// 需要先运行 py_reference.py；设置 FK_MATTING_CMP=<输出目录> 后执行 --ignored。
    #[test]
    #[ignore = "needs Python reference outputs"]
    fn compare_with_python_reference() {
        let Some(dir) = std::env::var_os("FK_MATTING_CMP") else { return; };
        let dir = std::path::PathBuf::from(dir);
        let rgb = image::open(dir.join("input_rgb.png")).unwrap().to_rgb8();
        let bg = image::open(dir.join("bg_rgb.png")).unwrap();
        let alpha = image::open(dir.join("py_alpha.png")).unwrap().to_luma8().into_raw();
        let cases: Vec<Value> = serde_json::from_slice(&std::fs::read(dir.join("cases.json")).unwrap()).unwrap();
        for case in cases {
            let name = case["name"].as_str().unwrap();
            let payload = &case["payload"];
            let ours: DynamicImage = match case["kind"].as_str().unwrap() {
                "replace" => {
                    let bgi = if payload["mode"] == "image" { Some(&bg) } else { None };
                    DynamicImage::ImageRgb8(compose_bg_replace(&rgb, alpha.clone(), payload, bgi))
                }
                "precise" => compose_precise(&rgb, alpha.clone(), payload),
                _ => DynamicImage::ImageRgb8(compose_id_photo(&rgb, alpha.clone(), payload).unwrap().0),
            };
            ours.save(dir.join(format!("rs_{name}.png"))).unwrap();
            let theirs = image::open(dir.join(format!("py_{name}.png"))).unwrap();
            let (a, b) = if ours.color().has_alpha() {
                (ours.to_rgba8().into_raw(), theirs.to_rgba8().into_raw())
            } else {
                (ours.to_rgb8().into_raw(), theirs.to_rgb8().into_raw())
            };
            assert_eq!((ours.width(), ours.height()), (theirs.width(), theirs.height()), "{name} size");
            let mut sum = 0u64; let mut max = 0u8; let mut over2 = 0usize; let mut over8 = 0usize;
            for (x, y) in a.iter().zip(b.iter()) {
                let d = x.abs_diff(*y);
                sum += d as u64; max = max.max(d);
                if d > 2 { over2 += 1; }
                if d > 8 { over8 += 1; }
            }
            let n = a.len() as f64;
            let mse: f64 = a.iter().zip(b.iter()).map(|(x, y)| { let d = *x as f64 - *y as f64; d * d }).sum::<f64>() / n;
            let psnr = if mse == 0.0 { f64::INFINITY } else { 10.0 * (255.0f64 * 255.0 / mse).log10() };
            println!("CMP {name} {}x{} mean={:.4} max={} over2={:.4}% over8={:.4}% psnr={:.2}",
                ours.width(), ours.height(), sum as f64 / n, max, over2 as f64 * 100.0 / n, over8 as f64 * 100.0 / n, psnr);
        }
    }

    /// 推理对比：Rust 版 ISNet 推理得到的 alpha 与 Python 版 py_alpha.png 比较。
    /// FK_MATTING_CMP=<输出目录>，FK_MATTING_MODEL=<isnet onnx 路径>。
    #[test]
    #[ignore = "needs model + Python reference outputs"]
    fn compare_alpha_with_python_reference() {
        let (Some(dir), Some(model)) = (std::env::var_os("FK_MATTING_CMP"), std::env::var_os("FK_MATTING_MODEL")) else { return; };
        let dir = std::path::PathBuf::from(dir);
        let model = std::path::PathBuf::from(model);
        let img = image::open(dir.join("input_rgb.png")).unwrap();
        let t = std::time::Instant::now();
        let fallback = crate::onnx::fallback_size_for(&model);
        let ours = crate::onnx::alpha_from_image(&img, &model.to_string_lossy(), fallback).unwrap();
        let ms = t.elapsed().as_millis();
        let theirs = image::open(dir.join("py_alpha.png")).unwrap().to_luma8().into_raw();
        assert_eq!(ours.len(), theirs.len());
        image::GrayImage::from_raw(img.width(), img.height(), ours.clone()).unwrap().save(dir.join("rs_alpha.png")).unwrap();
        let n = ours.len() as f64;
        let mut sum = 0u64; let mut max = 0u8; let mut over2 = 0usize; let mut over8 = 0usize; let mut flip = 0usize;
        for (a, b) in ours.iter().zip(theirs.iter()) {
            let d = a.abs_diff(*b);
            sum += d as u64; max = max.max(d);
            if d > 2 { over2 += 1; }
            if d > 8 { over8 += 1; }
            if (*a >= 128) != (*b >= 128) { flip += 1; }
        }
        println!("CMP alpha {}x{} mean={:.4} max={} over2={:.4}% over8={:.4}% fg_flip={:.4}% infer={}ms",
            img.width(), img.height(), sum as f64 / n, max, over2 as f64 * 100.0 / n, over8 as f64 * 100.0 / n, flip as f64 * 100.0 / n, ms);
        assert!(flip as f64 / n < 0.005, "foreground mask differs too much");
    }
}
