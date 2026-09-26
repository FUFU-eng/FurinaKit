// 图像处理内核（Rust 版）—— 迁移的第一块
//
// 为什么从这块开始：Python 侧体积最大的是 opencv（112MB）与 Pillow（15MB），
// 而它们做的大部分是「缩放 / 压缩 / 转格式 / 裁剪 / 旋转」这类基础操作，
// Rust 的 image crate 全都能干，编译进 exe 只有几百 KB。
//
// 目标：把这些基础操作从「提交给 Python 工作进程」改成「Rust 直接做」，
// 将来所有工具都不再需要 Python 时就能把整个 Python 层删掉（省约 227MB）。
//
// 注意：需要 AI 模型的操作（抠图、去水印、超分、上色）暂时仍走 Python，
// 等 onnxruntime 的 Rust 绑定接上之后再迁。

use std::fs;
use std::path::{Path, PathBuf};

use image::{DynamicImage, GenericImageView, ImageFormat};
use serde_json::{json, Value};
use tauri::Manager;

/// 产物目录：storage/results
fn results_dir(app: &tauri::AppHandle) -> PathBuf {
    let dir = crate::jobs::storage_dir_of(app).join("results");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn ext_of(p: &str) -> String {
    Path::new(p)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase()
}

fn format_for(ext: &str) -> Option<ImageFormat> {
    match ext {
        "jpg" | "jpeg" => Some(ImageFormat::Jpeg),
        "png" => Some(ImageFormat::Png),
        "webp" => Some(ImageFormat::WebP),
        "bmp" => Some(ImageFormat::Bmp),
        "gif" => Some(ImageFormat::Gif),
        "tif" | "tiff" => Some(ImageFormat::Tiff),
        _ => None,
    }
}

/// 读图（支持中文路径：用 read 而不是 image::open，后者在 Windows 上对非 UTF-8 路径不稳）
fn load(path: &str) -> Result<DynamicImage, String> {
    let bytes = fs::read(path).map_err(|e| format!("读不到文件：{e}"))?;
    image::load_from_memory(&bytes).map_err(|e| format!("不是能识别的图片：{e}"))
}

/// 存图（支持指定压缩质量）
fn save(img: &DynamicImage, path: &Path, ext: &str) -> Result<u64, String> {
    save_with_quality(img, path, ext, None)
}

fn save_with_quality(img: &DynamicImage, path: &Path, ext: &str, quality: Option<u8>) -> Result<u64, String> {
    let fmt = format_for(ext).ok_or_else(|| format!("不支持输出成 .{ext}"))?;
    let mut buf: Vec<u8> = Vec::new();
    if fmt == ImageFormat::Jpeg {
        let q = quality.unwrap_or(80).clamp(1, 100);
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, q);
        let rgb = img.to_rgb8();
        encoder
            .encode(rgb.as_raw(), img.width(), img.height(), image::ExtendedColorType::Rgb8)
            .map_err(|e| format!("JPEG 编码失败：{e}"))?;
    } else {
        img.write_to(&mut std::io::Cursor::new(&mut buf), fmt)
            .map_err(|e| format!("编码失败：{e}"))?;
    }
    if let Some(parent) = path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    fs::write(path, &buf).map_err(|e| format!("写文件失败：{e}"))?;
    Ok(buf.len() as u64)
}

fn out_path(app: &tauri::AppHandle, src: &str, suffix: &str, ext: &str) -> PathBuf {
    let stem = Path::new(src)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "output".into());
    results_dir(app).join(format!("{stem}{suffix}.{ext}"))
}

fn pick_input(args: &Value) -> Result<String, String> {
    if let Some(s) = args.get("file").and_then(|v| v.as_str()) {
        if !s.is_empty() {
            return Ok(s.to_string());
        }
    }
    if let Some(arr) = args.get("files").and_then(|v| v.as_array()) {
        if let Some(first) = arr.first().and_then(|v| v.as_str()) {
            return Ok(first.to_string());
        }
    }
    Err("没有指定输入图片".into())
}

fn num(args: &Value, key: &str, dflt: f64) -> f64 {
    args.get(key)
        .and_then(|v| {
            v.as_f64()
                .or_else(|| v.as_str().and_then(|s| s.parse::<f64>().ok()))
        })
        .unwrap_or(dflt)
}

/// 压缩 / 缩小：按最长边限制尺寸 + 按质量重编码
pub fn image_compress(app: &tauri::AppHandle, args: &Value) -> Result<Value, String> {
    let input = pick_input(args)?;
    let img = load(&input)?;
    let (w0, h0) = img.dimensions();

    let max_edge = num(args, "maxWidth", num(args, "maxEdge", 0.0));
    let scale = num(args, "scale", 1.0);
    let quality = num(args, "quality", 80.0).clamp(1.0, 100.0) as u8;
    let mut img = img;

    if max_edge > 0.0 {
        let longest = w0.max(h0) as f64;
        if longest > max_edge {
            let r = max_edge / longest;
            img = img.resize(
                (w0 as f64 * r).round() as u32,
                (h0 as f64 * r).round() as u32,
                image::imageops::FilterType::Lanczos3,
            );
        }
    } else if (scale - 1.0).abs() > 0.001 && scale > 0.0 {
        img = img.resize(
            (w0 as f64 * scale).round().max(1.0) as u32,
            (h0 as f64 * scale).round().max(1.0) as u32,
            image::imageops::FilterType::Lanczos3,
        );
    }

    let mut ext = args.get("format").and_then(|v| v.as_str()).map(|s| s.to_string()).unwrap_or_else(|| ext_of(&input));
    if ext == "jpeg" {
        ext = "jpg".into();
    }
    if format_for(&ext).is_none() {
        ext = "jpg".into();
    }
    let out = out_path(app, &input, "_已压缩", &ext);
    let size = save_with_quality(&img, &out, &ext, Some(quality))?;
    let (w1, h1) = img.dimensions();

    Ok(json!({
        "success": true, "output": out.to_string_lossy(), "filename": out.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        "message": format!("已压缩：{w0}x{h0} → {w1}x{h1}，品质 {quality}%，产出 {:.0} KB", size as f64 / 1024.0),
        "widthBefore": w0, "heightBefore": h0, "width": w1, "height": h1, "bytes": size, "quality": quality,
    }))
}

/// 改尺寸
pub fn image_resize(app: &tauri::AppHandle, args: &Value) -> Result<Value, String> {
    let input = pick_input(args)?;
    let img = load(&input)?;
    let (w0, h0) = img.dimensions();
    let tw = num(args, "width", 0.0);
    let th = num(args, "height", 0.0);
    let keep = args.get("keepRatio").and_then(|v| v.as_bool()).unwrap_or(true);

    let (nw, nh) = if tw > 0.0 && th > 0.0 && !keep {
        (tw as u32, th as u32)
    } else if tw > 0.0 {
        let r = tw / w0 as f64;
        (tw as u32, (h0 as f64 * r).round().max(1.0) as u32)
    } else if th > 0.0 {
        let r = th / h0 as f64;
        ((w0 as f64 * r).round().max(1.0) as u32, th as u32)
    } else {
        return Err("请给出目标宽度或高度".into());
    };

    let resized = img.resize(nw, nh, image::imageops::FilterType::Lanczos3);
    let ext = ext_of(&input);
    let ext = if format_for(&ext).is_some() { ext } else { "png".into() };
    let out = out_path(app, &input, &format!("_{nw}x{nh}"), &ext);
    let size = save(&resized, &out, &ext)?;

    Ok(json!({
        "success": true, "output": out.to_string_lossy(), "filename": out.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        "message": format!("已改尺寸：{w0}x{h0} → {nw}x{nh}"),
        "widthBefore": w0, "heightBefore": h0, "width": nw, "height": nh, "bytes": size,
    }))
}

/// 转格式
pub fn image_convert(app: &tauri::AppHandle, args: &Value) -> Result<Value, String> {
    let input = pick_input(args)?;
    let img = load(&input)?;
    let mut to = args
        .get("to")
        .or_else(|| args.get("format"))
        .and_then(|v| v.as_str())
        .unwrap_or("png")
        .trim_start_matches('.')
        .to_ascii_lowercase();
    if to == "jpeg" {
        to = "jpg".into();
    }
    if format_for(&to).is_none() {
        return Err(format!("不支持转成 .{to}"));
    }
    let out = out_path(app, &input, "_已转换", &to);
    let size = save(&img, &out, &to)?;
    Ok(json!({
        "success": true, "output": out.to_string_lossy(), "filename": out.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        "message": format!("已转成 .{to}，{:.0} KB", size as f64 / 1024.0),
        "bytes": size,
    }))
}

/// 裁剪（四边像素）
pub fn image_crop(app: &tauri::AppHandle, args: &Value) -> Result<Value, String> {
    let input = pick_input(args)?;
    let img = load(&input)?;
    let (w, h) = img.dimensions();
    let l = num(args, "left", 0.0).max(0.0) as u32;
    let t = num(args, "top", 0.0).max(0.0) as u32;
    let r = num(args, "right", 0.0).max(0.0) as u32;
    let b = num(args, "bottom", 0.0).max(0.0) as u32;
    if l + r >= w || t + b >= h {
        return Err("裁掉的边距比图片本身还大".into());
    }
    let cropped = img.crop_imm(l, t, w - l - r, h - t - b);
    let ext = ext_of(&input);
    let ext = if format_for(&ext).is_some() { ext } else { "png".into() };
    let out = out_path(app, &input, "_已裁剪", &ext);
    let size = save(&cropped, &out, &ext)?;
    let (cw, ch) = cropped.dimensions();
    Ok(json!({
        "success": true, "output": out.to_string_lossy(), "filename": out.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        "message": format!("已裁剪：{w}x{h} → {cw}x{ch}"),
        "width": cw, "height": ch, "bytes": size,
    }))
}

/// 旋转 / 翻转
pub fn image_rotate(app: &tauri::AppHandle, args: &Value) -> Result<Value, String> {
    let input = pick_input(args)?;
    let img = load(&input)?;
    let angle = num(args, "angle", 90.0);
    let flip = args.get("flip").and_then(|v| v.as_str()).unwrap_or("");
    let out_img = match flip {
        "h" => img.fliph(),
        "v" => img.flipv(),
        _ => match (angle as i64).rem_euclid(360) {
            90 => img.rotate90(),
            180 => img.rotate180(),
            270 => img.rotate270(),
            _ => img,
        },
    };
    let ext = ext_of(&input);
    let ext = if format_for(&ext).is_some() { ext } else { "png".into() };
    let out = out_path(app, &input, "_已旋转", &ext);
    let size = save(&out_img, &out, &ext)?;
    let (w, h) = out_img.dimensions();
    Ok(json!({
        "success": true, "output": out.to_string_lossy(), "filename": out.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        "message": format!("处理完成：{w}x{h}"),
        "width": w, "height": h, "bytes": size,
    }))
}

/// 图片格式与基本信息（前端要用）
pub fn image_info(args: &Value) -> Result<Value, String> {
    let input = pick_input(args)?;
    let img = load(&input)?;
    let (w, h) = img.dimensions();
    let meta = fs::metadata(&input).map_err(|e| e.to_string())?;
    Ok(json!({
        "width": w, "height": h,
        "bytes": meta.len(),
        "format": ext_of(&input),
        "color": match img {
            DynamicImage::ImageRgb8(_) => "rgb8",
            DynamicImage::ImageRgba8(_) => "rgba8",
            DynamicImage::ImageLuma8(_) => "gray8",
            _ => "other",
        },
    }))
}
