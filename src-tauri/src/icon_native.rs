//! 应用图标生成器：纯 Rust 原生实现（去 Python 化，替代 services/worker/app/tools/icon_gen.py）。
//!
//! 支持从原图生成全套尺寸 PNG（iOS、Android、Windows、Web 规范）、多分辨率 Windows ICO、
//! 矢量占位 SVG 以及中文规范清单 JSON，并直接打包为 ZIP。

use std::fs::{self, File};
use std::io::Write;
use std::path::{Path, PathBuf};
use serde_json::{json, Map, Value};
use image::{imageops::FilterType, DynamicImage, GenericImageView, ImageFormat, RgbaImage};

use crate::matting_native::{number, results_path, text};

pub fn supported(tool: &str) -> bool {
    matches!(tool, "app-icon-generator")
}

const DEFAULT_SIZES: &[u32] = &[16, 24, 32, 48, 64, 96, 128, 180, 192, 256, 512, 1024];

fn size_usage(size: u32) -> &'static str {
    match size {
        16 => "浏览器标签页、通知图标",
        24 => "工具栏、任务栏小图标",
        32 => "Windows 任务栏、桌面小图标",
        48 => "Windows 桌面图标",
        64 => "应用列表、快捷键图标",
        96 => "中等尺寸图标",
        128 => "macOS 图标、商店列表",
        180 => "iOS 主屏（Apple Touch Icon）",
        192 => "Android 主屏（PWA）",
        256 => "Windows 大图标、ICO 上限",
        512 => "PWA 启动图、商店素材",
        1024 => "App Store、高清矢量替代",
        _ => "自定义尺寸",
    }
}

fn base64_encode(data: &[u8]) -> String {
    const CHARSET: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut result = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
        let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
        let triple = (b0 << 16) | (b1 << 8) | b2;

        result.push(CHARSET[((triple >> 18) & 63) as usize] as char);
        result.push(CHARSET[((triple >> 12) & 63) as usize] as char);
        if chunk.len() > 1 {
            result.push(CHARSET[((triple >> 6) & 63) as usize] as char);
        } else {
            result.push('=');
        }
        if chunk.len() > 2 {
            result.push(CHARSET[(triple & 63) as usize] as char);
        } else {
            result.push('=');
        }
    }
    result
}

/// 组装 Windows 多尺寸 ICO（PNG 容器格式）
fn build_ico(png_frames: &[(u32, u32, Vec<u8>)]) -> Vec<u8> {
    let mut out = Vec::new();
    let count = png_frames.len() as u16;
    out.extend_from_slice(&0u16.to_le_bytes()); // Reserved
    out.extend_from_slice(&1u16.to_le_bytes()); // Type: 1 = ICO
    out.extend_from_slice(&count.to_le_bytes()); // Count

    let header_size = 6 + (png_frames.len() * 16) as u32;
    let mut current_offset = header_size;

    for (w, h, png_bytes) in png_frames {
        let width_byte = if *w >= 256 { 0u8 } else { *w as u8 };
        let height_byte = if *h >= 256 { 0u8 } else { *h as u8 };
        out.push(width_byte);
        out.push(height_byte);
        out.push(0); // color count
        out.push(0); // reserved
        out.extend_from_slice(&1u16.to_le_bytes()); // planes
        out.extend_from_slice(&32u16.to_le_bytes()); // bpp
        out.extend_from_slice(&(png_bytes.len() as u32).to_le_bytes());
        out.extend_from_slice(&current_offset.to_le_bytes());
        current_offset += png_bytes.len() as u32;
    }

    for (_, _, png_bytes) in png_frames {
        out.extend_from_slice(png_bytes);
    }
    out
}

/// 给图像施加平滑圆角（带抗锯齿渐变）
fn apply_rounded_corners(img: &mut RgbaImage, radius_percent: f64) {
    let (w, h) = img.dimensions();
    let min_dim = w.min(h);
    let r = ((min_dim as f64) * (radius_percent.clamp(0.0, 50.0) / 100.0)).round() as i32;
    if r <= 0 {
        return;
    }

    let r_f = r as f64;
    let r_sq = r_f * r_f;
    for y in 0..h as i32 {
        for x in 0..w as i32 {
            let dx = if x < r {
                r - 1 - x
            } else if x >= (w as i32 - r) {
                x - (w as i32 - r)
            } else {
                -1
            };

            let dy = if y < r {
                r - 1 - y
            } else if y >= (h as i32 - r) {
                y - (h as i32 - r)
            } else {
                -1
            };

            if dx >= 0 && dy >= 0 {
                let dist_sq = (dx * dx + dy * dy) as f64;
                if dist_sq > r_sq {
                    img.get_pixel_mut(x as u32, y as u32)[3] = 0;
                } else if dist_sq > (r_f - 1.0).powi(2) {
                    let dist = dist_sq.sqrt();
                    let alpha_factor = (r_f - dist).clamp(0.0, 1.0);
                    let p = img.get_pixel_mut(x as u32, y as u32);
                    p[3] = ((p[3] as f64) * alpha_factor).round() as u8;
                }
            }
        }
    }
}

/// 填充底色（如应用商店不接受透明背景时填底色）
fn apply_background(img: &mut RgbaImage, hex: &str) {
    let clean = hex.trim_start_matches('#');
    if clean.len() != 6 {
        return;
    }
    if let (Ok(r), Ok(g), Ok(b)) = (
        u8::from_str_radix(&clean[0..2], 16),
        u8::from_str_radix(&clean[2..4], 16),
        u8::from_str_radix(&clean[4..6], 16),
    ) {
        for pixel in img.pixels_mut() {
            let a = pixel[3] as f64 / 255.0;
            if a < 1.0 {
                pixel[0] = ((pixel[0] as f64 * a) + (r as f64 * (1.0 - a))).round() as u8;
                pixel[1] = ((pixel[1] as f64 * a) + (g as f64 * (1.0 - a))).round() as u8;
                pixel[2] = ((pixel[2] as f64 * a) + (b as f64 * (1.0 - a))).round() as u8;
                pixel[3] = 255;
            }
        }
    }
}

pub fn generate_icons(
    src_path: &Path,
    output_zip: &Path,
    sizes: &[u32],
    rounded: f64,
    background: &str,
) -> Result<usize, String> {
    let mut dyn_img = image::open(src_path).map_err(|e| format!("无法读取图片: {e}"))?;

    // 1. 统一居中裁切成正方形
    let (orig_w, orig_h) = dyn_img.dimensions();
    if orig_w != orig_h {
        let side = orig_w.min(orig_h);
        let left = (orig_w - side) / 2;
        let top = (orig_h - side) / 2;
        dyn_img = dyn_img.crop_imm(left, top, side, side);
    }

    let mut rgba = dyn_img.to_rgba8();

    // 2. 圆角处理
    if rounded > 0.0 {
        apply_rounded_corners(&mut rgba, rounded);
    }

    // 3. 垫底色
    if !background.trim().is_empty() {
        apply_background(&mut rgba, background);
    }

    let base_img = DynamicImage::ImageRgba8(rgba);

    // 临时目录保存各产物
    let parent = output_zip.parent().unwrap_or_else(|| Path::new("."));
    let temp_scratch = parent.join(format!("scratch-icon-{}", uuid::Uuid::new_v4().simple()));
    let png_dir = temp_scratch.join("png");
    fs::create_dir_all(&png_dir).map_err(|e| e.to_string())?;

    let mut entries_for_zip: Vec<(String, PathBuf)> = Vec::new();
    let mut manifest_items = Vec::new();
    let mut ico_frames = Vec::new();

    let mut size_list: Vec<u32> = sizes.to_vec();
    if size_list.is_empty() {
        size_list = DEFAULT_SIZES.to_vec();
    }
    size_list.sort_unstable();
    size_list.dedup();

    for &sz in &size_list {
        if sz < 8 || sz > 4096 {
            continue;
        }
        let resized = base_img.resize_exact(sz, sz, FilterType::Lanczos3);
        let file_name = format!("icon-{sz}.png");
        let png_path = temp_scratch.join(&file_name);

        let mut buf = Vec::new();
        resized
            .write_to(&mut std::io::Cursor::new(&mut buf), ImageFormat::Png)
            .map_err(|e| format!("生成 PNG 失败: {e}"))?;

        fs::write(&png_path, &buf).map_err(|e| e.to_string())?;
        entries_for_zip.push((file_name.clone(), png_path));

        manifest_items.push(json!({
            "size": sz,
            "file": file_name,
            "bytes": buf.len(),
            "usage": size_usage(sz),
        }));

        if sz <= 256 {
            ico_frames.push((sz, sz, buf));
        }
    }

    // 4. 生成多分辨率 Windows ICO
    if !ico_frames.is_empty() {
        let ico_bytes = build_ico(&ico_frames);
        let ico_path = temp_scratch.join("icon.ico");
        fs::write(&ico_path, ico_bytes).map_err(|e| e.to_string())?;
        entries_for_zip.push(("icon.ico".to_string(), ico_path));
    }

    // 5. 生成 512x512 矢量包装 SVG
    let svg_sz = if size_list.contains(&512) {
        512
    } else {
        *size_list.last().unwrap_or(&512)
    };
    let svg_resized = base_img.resize_exact(svg_sz, svg_sz, FilterType::Lanczos3);
    let mut svg_buf = Vec::new();
    if svg_resized
        .write_to(&mut std::io::Cursor::new(&mut svg_buf), ImageFormat::Png)
        .is_ok()
    {
        let b64 = base64_encode(&svg_buf);
        let svg_content = format!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="{svg_sz}" height="{svg_sz}" viewBox="0 0 {svg_sz} {svg_sz}">
  <image width="{svg_sz}" height="{svg_sz}" href="data:image/png;base64,{b64}"/>
</svg>
"#
        );
        let svg_path = temp_scratch.join("icon.svg");
        fs::write(&svg_path, svg_content.as_bytes()).map_err(|e| e.to_string())?;
        entries_for_zip.push(("icon.svg".to_string(), svg_path));
    }

    // 6. 生成 图标清单.json
    let manifest = json!({
        "源文件": src_path.file_name().and_then(|s| s.to_str()).unwrap_or(""),
        "原始尺寸": format!("{orig_w}x{orig_h}"),
        "生成尺寸数": manifest_items.len(),
        "圆角百分比": rounded,
        "底色": if background.is_empty() { "保持透明" } else { background },
        "文件明细": manifest_items,
        "常见尺寸用途": {
            "16": size_usage(16),
            "24": size_usage(24),
            "32": size_usage(32),
            "48": size_usage(48),
            "64": size_usage(64),
            "96": size_usage(96),
            "128": size_usage(128),
            "180": size_usage(180),
            "192": size_usage(192),
            "256": size_usage(256),
            "512": size_usage(512),
            "1024": size_usage(1024),
        }
    });
    let manifest_path = temp_scratch.join("图标清单.json");
    fs::write(&manifest_path, serde_json::to_string_pretty(&manifest).unwrap_or_default().as_bytes())
        .map_err(|e| e.to_string())?;
    entries_for_zip.push(("图标清单.json".to_string(), manifest_path));

    // 7. 打包为 ZIP 归档
    crate::image_artifacts::zip(&entries_for_zip, output_zip, &|| Ok(()))?;

    let total_count = entries_for_zip.len();
    let _ = fs::remove_dir_all(&temp_scratch);

    Ok(total_count)
}

// ───────────────────────── 入口：建任务 + 后台线程 ─────────────────────────

pub fn start(app: &tauri::AppHandle, tool: &str, args: &Value) -> Result<Value, String> {
    let tool = tool.to_string();
    let mut payload = args.clone();

    let inputs: Vec<(PathBuf, String)> = if let Some(files) = args.get("__files").and_then(Value::as_array) {
        if files.is_empty() {
            return Err("请上传原图 / Select an image".into());
        }
        let saved = crate::jobs::save_request_uploads(app, &crate::jobs::new_job_id_public(), files)?;
        saved
            .iter()
            .map(|s| {
                let p = s.get("path").and_then(Value::as_str).ok_or("缺少上传的图片文件")?;
                let n = s.get("name").and_then(Value::as_str).unwrap_or("icon.png").to_string();
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
                let n = p.file_name().map(|x| x.to_string_lossy().to_string()).unwrap_or_else(|| "icon.png".into());
                (p, n)
            })
            .collect()
    };

    if inputs.is_empty() {
        return Err("请选择图标源图片 / Select an image file".into());
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
        .name("native-icon-gen".into())
        .spawn(move || {
            crate::matting_native::progress(&app_bg, &id_bg, 10, "正在解析图标源图片…");

            let rounded = number(&payload, "rounded", 0.0);
            let background = text(&payload, "background", "");
            let sizes_opt = payload.get("sizes").and_then(Value::as_array).map(|arr| {
                arr.iter().filter_map(Value::as_u64).map(|u| u as u32).collect::<Vec<_>>()
            });
            let sizes = sizes_opt.as_deref().unwrap_or(DEFAULT_SIZES);

            let stem = Path::new(&inputs[0].1).file_stem().and_then(|s| s.to_str()).unwrap_or("app_icon");
            let out_name = format!("{stem}_全套图标.zip");
            let out_zip = match results_path(&app_bg, &id_bg, &out_name) {
                Ok(p) => p,
                Err(e) => {
                    let mut m = Map::new();
                    m.insert("status".into(), json!("failed"));
                    m.insert("error".into(), json!(e));
                    crate::jobs::update_job(&app_bg, &id_bg, m);
                    return;
                }
            };

            crate::matting_native::progress(&app_bg, &id_bg, 40, "正在生成各平台尺寸 PNG、ICO 与 SVG…");
            let result = generate_icons(&inputs[0].0, &out_zip, sizes, rounded, background);

            let mut m = Map::new();
            match result {
                Ok(count) => {
                    m.insert("status".into(), json!("completed"));
                    m.insert("progress".into(), json!(100));
                    m.insert("message".into(), json!(format!("成功生成 {} 个规格图标文件并打包", count)));
                    m.insert("resultPath".into(), json!(out_zip.to_string_lossy()));
                    m.insert("resultFilename".into(), json!(out_name));
                    m.insert("resultMimeType".into(), json!("application/zip"));
                    if let Ok(meta) = fs::metadata(&out_zip) {
                        m.insert("resultBytes".into(), json!(meta.len()));
                    }
                    m.insert("engine".into(), json!("rust-native"));
                }
                Err(e) => {
                    m.insert("status".into(), json!("failed"));
                    m.insert("progress".into(), json!(100));
                    m.insert("message".into(), json!("图标生成失败"));
                    m.insert("error".into(), json!(e));
                }
            }
            crate::jobs::update_job(&app_bg, &id_bg, m);
        })
        .map_err(|e| format!("启动后台线程失败：{e}"))?;

    let current = crate::jobs::read_job_public(app, &id).unwrap_or(job);
    Ok(json!({ "job": current, "ok": true, "engine": "rust-native" }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_native_app_icon_generation() {
        let root = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).parent().unwrap().to_path_buf();
        let sample = root.join("src-tauri/icons/icon.png");
        assert!(sample.exists(), "icon.png must exist");

        let temp_dir = std::env::temp_dir().join("fk_test_icon_gen");
        let _ = fs::remove_dir_all(&temp_dir);
        let _ = fs::create_dir_all(&temp_dir);

        let out_zip = temp_dir.join("test_icons.zip");
        let count = generate_icons(&sample, &out_zip, &[16, 32, 64, 128, 256, 512], 20.0, "#FFFFFF").unwrap();

        assert!(count >= 8, "Expected at least 8 artifacts (6 pngs + ico + svg + manifest), got {}", count);
        assert!(out_zip.exists(), "ZIP archive must exist");
        let zip_len = fs::metadata(&out_zip).unwrap().len();
        assert!(zip_len > 1000, "ZIP size must be > 1000 bytes, got {}", zip_len);

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
