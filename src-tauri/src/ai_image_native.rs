//! AI 扩图 + 黑白上色：Rust 原生实现（替代 Python 扩展里的 outpaint.py / colorize_photo.py / colorize_ai.py）。
//!
//! · 扩图：放大画布 → 新增区域用边缘像素预填 → 掩膜稍微吃进原图 → LaMa 补全 → 原图区域逐像素贴回；
//! · 上色：风格预设 / 参考图（LAB 空间 a、b 通道统计迁移，亮度不变）/ AI（manga-colorization-v2 ONNX，
//!   输入 5 通道 RGB+线稿+提示点，输出 RGB 0~1，最后用原图的亮度通道替换）。

use std::path::{Path, PathBuf};

use image::imageops::FilterType;
use image::RgbImage;
use serde_json::{json, Value};

use crate::matting_native::{load_image, model_in_components, number, progress, results_path, text};

const LAMA: &str = "lama_fp32.onnx";
const MISSING_LAMA: &str = "还没下载「去水印 · 精细模型」，请在本页上方或「设置 → 组件管理」下载后重试（约 198MB）";
const MANGA: &str = "manga-colorize-fp16.onnx";
const MISSING_MANGA: &str = "还没下载「AI 上色」模型，请在本页上方或「设置 → 组件管理」下载后重试（约 58.8MB）";

/// Python str(round(v, n)) 的样子：整数带 “.0”，其余去掉末尾 0
pub(crate) fn py_round(v: f64, digits: i32) -> String {
    let p = 10f64.powi(digits);
    let r = (v * p).round() / p;
    if r.fract() == 0.0 {
        format!("{r:.1}")
    } else {
        let s = format!("{r:.*}", digits as usize);
        s.trim_end_matches('0').trim_end_matches('.').to_string()
    }
}

// ───────────────────────── AI 扩图 ─────────────────────────

/// 目标画布尺寸与原图左上角位置（对齐 outpaint.plan_canvas）
pub(crate) fn plan_canvas(w: usize, h: usize, pads: (f64, f64, f64, f64), ratio: Option<f64>, anchor: &str) -> (usize, usize, usize, usize) {
    let (left, right, top, bottom) = pads;
    if let Some(r) = ratio.filter(|r| *r > 0.0) {
        let cur = w as f64 / h as f64;
        let (nw, nh) = if cur < r { ((h as f64 * r).round() as usize, h) } else { (w, (w as f64 / r).round() as usize) };
        let (pw, ph) = (nw.saturating_sub(w), nh.saturating_sub(h));
        let (ox, oy) = match anchor {
            "top-left" => (0, 0),
            "bottom-right" => (pw, ph),
            _ => (pw / 2, ph / 2),
        };
        return (nw.max(w), nh.max(h), ox, oy);
    }
    let nw = ((w as f64 * (1.0 + left.max(0.0) + right.max(0.0))).round() as usize).max(8);
    let nh = ((h as f64 * (1.0 + top.max(0.0) + bottom.max(0.0))).round() as usize).max(8);
    let ox = ((w as f64 * left.max(0.0)).round() as usize).min(nw.saturating_sub(w));
    let oy = ((h as f64 * top.max(0.0)).round() as usize).min(nh.saturating_sub(h));
    (nw.max(w), nh.max(h), ox, oy)
}

pub(crate) fn outpaint(app: &tauri::AppHandle, id: &str, input: &str, stem: &str, payload: &Value) -> Result<Value, String> {
    let preset = text(payload, "preset", "all25");
    let (pads, ratio_raw): ((f64, f64, f64, f64), String) = match preset {
        "all25" => ((0.25, 0.25, 0.25, 0.25), "none".into()),
        "lr50" => ((0.5, 0.5, 0.0, 0.0), "none".into()),
        "top50" => ((0.0, 0.0, 0.5, 0.0), "none".into()),
        "169" => ((0.0, 0.0, 0.0, 0.0), (16.0f64 / 9.0).to_string()),
        "916" => ((0.0, 0.0, 0.0, 0.0), (9.0f64 / 16.0).to_string()),
        "11" => ((0.0, 0.0, 0.0, 0.0), "1".into()),
        _ => (
            (number(payload, "left", 0.25), number(payload, "right", 0.25), number(payload, "top", 0.25), number(payload, "bottom", 0.25)),
            text(payload, "target_ratio", "none").to_string(),
        ),
    };
    for v in [pads.0, pads.1, pads.2, pads.3] {
        if !v.is_finite() || v > 4.0 {
            return Err("扩展比例需在 0～4 之间（1 表示扩出与原图等宽/等高的一圈）".into());
        }
    }
    let ratio = if matches!(ratio_raw.as_str(), "none" | "" | "0") { None } else { ratio_raw.parse::<f64>().ok().filter(|r| r.is_finite() && *r > 0.0) };
    let anchor = text(payload, "anchor", "center");

    let model = model_in_components(app, &[LAMA]).ok_or(MISSING_LAMA)?;
    let _lease = crate::api::component_use(app, &[LAMA])?;

    let img = load_image(input)?.to_rgb8();
    let (w, h) = (img.width() as usize, img.height() as usize);
    let (nw, nh, ox, oy) = plan_canvas(w, h, pads, ratio, anchor);
    if nw == w && nh == h {
        return Err("扩图比例都是 0，画布没有变大 —— 请把某一边的扩展比例调大一点".into());
    }
    if (nw as u64) * (nh as u64) > 80_000_000 {
        return Err("扩图后的画布太大（超过 8000 万像素），请减小扩展比例或先缩小原图".into());
    }
    progress(app, id, 20, "正在铺设扩展画布…");

    // ① 新画布：原图居中放置，空白处先用边缘像素铺一层
    let src = img.as_raw();
    let mut canvas = vec![0u8; nw * nh * 3];
    for y in 0..h {
        let d = ((oy + y) * nw + ox) * 3;
        canvas[d..d + w * 3].copy_from_slice(&src[y * w * 3..(y + 1) * w * 3]);
    }
    for y in 0..oy {
        let d = (y * nw + ox) * 3;
        canvas[d..d + w * 3].copy_from_slice(&src[0..w * 3]);
    }
    for y in oy + h..nh {
        let d = (y * nw + ox) * 3;
        canvas[d..d + w * 3].copy_from_slice(&src[(h - 1) * w * 3..h * w * 3]);
    }
    for y in 0..nh {
        let row = y * nw * 3;
        let lp = [canvas[row + ox * 3], canvas[row + ox * 3 + 1], canvas[row + ox * 3 + 2]];
        for x in 0..ox {
            canvas[row + x * 3..row + x * 3 + 3].copy_from_slice(&lp);
        }
        let r = ox + w - 1;
        let rp = [canvas[row + r * 3], canvas[row + r * 3 + 1], canvas[row + r * 3 + 2]];
        for x in ox + w..nw {
            canvas[row + x * 3..row + x * 3 + 3].copy_from_slice(&rp);
        }
    }

    // ② 掩膜：只有新扩出来的区域；③ 稍微吃进原图，接缝才自然
    let mut mask = vec![0u8; nw * nh];
    for y in 0..nh {
        for x in 0..nw {
            if y < oy || y >= oy + h || x < ox || x >= ox + w {
                mask[y * nw + x] = 255;
            }
        }
    }
    let blend = ((nw.min(nh) as f64 * 0.012) as usize).max(2);
    let mask = crate::inpaint_native::morph(&mask, nw, nh, blend, true);
    let filled_px = mask.iter().filter(|v| **v != 0).count();
    if filled_px == 0 {
        return Err("没有需要补全的区域".into());
    }

    progress(app, id, 40, "LaMa 正在补全新画面…");
    let canvas_img = RgbImage::from_raw(nw as u32, nh as u32, canvas).ok_or("画布尺寸异常")?;
    let filled = crate::inpaint_native::lama_inpaint(&canvas_img, &mask, &model)?;

    // ④ 原图区域逐像素恢复
    let mut result = filled;
    for y in 0..h {
        for x in 0..w {
            result.put_pixel((ox + x) as u32, (oy + y) as u32, *img.get_pixel(x as u32, y as u32));
        }
    }
    progress(app, id, 90, "正在保存结果…");
    let plain = format!("{stem}_已扩图.png");
    let path = results_path(app, id, &plain)?;
    result.save(&path).map_err(|_| "图片保存失败".to_string())?;

    let ratio_before = w as f64 / h as f64;
    let ratio_after = nw as f64 / nh as f64;
    let filled_ratio = filled_px as f64 / (nw * nh) as f64;
    let message = format!(
        "已扩图：{w}×{h} → {nw}×{nh}（比例 {} → {}，补全 {}%）",
        py_round(ratio_before, 3),
        py_round(ratio_after, 3),
        py_round((filled_ratio * 10000.0).round() / 10000.0 * 100.0, 1)
    );
    Ok(json!({ "path": path.to_string_lossy(), "filename": plain, "mime": "image/png", "message": message,
               "width": nw, "height": nh, "sourceWidth": w, "sourceHeight": h, "offsetX": ox, "offsetY": oy }))
}

// ───────────────────────── LAB / HSV（OpenCV 8 位约定） ─────────────────────────

fn srgb_to_linear(v: f32) -> f32 {
    if v <= 0.04045 { v / 12.92 } else { ((v + 0.055) / 1.055).powf(2.4) }
}

fn linear_to_srgb(v: f32) -> f32 {
    if v <= 0.003_130_8 { v * 12.92 } else { 1.055 * v.powf(1.0 / 2.4) - 0.055 }
}

fn lab_f(t: f32) -> f32 {
    if t > 0.008_856 { t.cbrt() } else { 7.787 * t + 16.0 / 116.0 }
}

/// RGB u8 → LAB（L∈0..255 = L*·255/100，a、b 加 128；与 cv2.COLOR_BGR2LAB 8 位输出同口径），保留小数
pub(crate) fn rgb_to_lab(p: [u8; 3]) -> [f32; 3] {
    let r = srgb_to_linear(p[0] as f32 / 255.0);
    let g = srgb_to_linear(p[1] as f32 / 255.0);
    let b = srgb_to_linear(p[2] as f32 / 255.0);
    let x = (0.412_453 * r + 0.357_580 * g + 0.180_423 * b) / 0.950_456;
    let y = 0.212_671 * r + 0.715_160 * g + 0.072_169 * b;
    let z = (0.019_334 * r + 0.119_193 * g + 0.950_227 * b) / 1.088_754;
    let (fx, fy, fz) = (lab_f(x), lab_f(y), lab_f(z));
    let l = if y > 0.008_856 { 116.0 * fy - 16.0 } else { 903.3 * y };
    [l * 255.0 / 100.0, 500.0 * (fx - fy) + 128.0, 200.0 * (fy - fz) + 128.0]
}

/// 8 位 LAB → RGB u8
pub(crate) fn lab_to_rgb(lab: [f32; 3]) -> [u8; 3] {
    let l = lab[0] * 100.0 / 255.0;
    let a = lab[1] - 128.0;
    let b = lab[2] - 128.0;
    let fy = (l + 16.0) / 116.0;
    let fx = fy + a / 500.0;
    let fz = fy - b / 200.0;
    let inv = |f: f32| if f > 0.206_893 { f * f * f } else { (f - 16.0 / 116.0) / 7.787 };
    let y = if l > 8.0 { fy * fy * fy } else { l / 903.3 };
    let x = inv(fx) * 0.950_456;
    let z = inv(fz) * 1.088_754;
    let r = 3.240_479 * x - 1.537_150 * y - 0.498_535 * z;
    let g = -0.969_256 * x + 1.875_992 * y + 0.041_556 * z;
    let bb = 0.055_648 * x - 0.204_043 * y + 1.057_311 * z;
    let to = |v: f32| (linear_to_srgb(v.clamp(0.0, 1.0)) * 255.0).round().clamp(0.0, 255.0) as u8;
    [to(r), to(g), to(bb)]
}

/// 8 位 LAB 图（已四舍五入到 0..255，与 cv2 输出一致）
fn lab_u8(img: &RgbImage) -> Vec<[f32; 3]> {
    img.pixels()
        .map(|p| {
            let l = rgb_to_lab(p.0);
            [l[0].round().clamp(0.0, 255.0), l[1].round().clamp(0.0, 255.0), l[2].round().clamp(0.0, 255.0)]
        })
        .collect()
}

fn from_lab(lab: &[[f32; 3]], w: u32, h: u32) -> RgbImage {
    let mut out = RgbImage::new(w, h);
    for (p, l) in out.pixels_mut().zip(lab) {
        // numpy: clip(0,255).astype(uint8) —— 截断取整
        let q = [l[0].clamp(0.0, 255.0).trunc(), l[1].clamp(0.0, 255.0).trunc(), l[2].clamp(0.0, 255.0).trunc()];
        p.0 = lab_to_rgb(q);
    }
    out
}

/// HSV 的 S 通道平均值（0..255）
pub(crate) fn mean_saturation(img: &RgbImage) -> f64 {
    let n = (img.width() as f64 * img.height() as f64).max(1.0);
    let sum: f64 = img
        .pixels()
        .map(|p| {
            let mx = p.0.iter().copied().max().unwrap_or(0) as f64;
            let mn = p.0.iter().copied().min().unwrap_or(0) as f64;
            if mx <= 0.0 { 0.0 } else { ((mx - mn) * 255.0 / mx).round() }
        })
        .sum();
    sum / n
}

fn is_grayscale(img: &RgbImage) -> bool {
    let n = (img.width() as f64 * img.height() as f64).max(1.0);
    let (mut bg, mut gr, mut br) = (0f64, 0f64, 0f64);
    for p in img.pixels() {
        let [r, g, b] = p.0.map(|v| v as i32);
        bg += (b - g).abs() as f64;
        gr += (g - r).abs() as f64;
        br += (b - r).abs() as f64;
    }
    (bg / n).max(gr / n).max(br / n) < 6.0
}

fn mean_std(v: impl Iterator<Item = f32> + Clone) -> (f64, f64) {
    let (mut n, mut s) = (0f64, 0f64);
    for x in v.clone() {
        n += 1.0;
        s += x as f64;
    }
    let m = if n > 0.0 { s / n } else { 0.0 };
    let var = if n > 0.0 { v.map(|x| (x as f64 - m).powi(2)).sum::<f64>() / n } else { 0.0 };
    (m, var.sqrt())
}

fn style_preset(style: &str) -> Option<(&'static str, (f64, f64), (f64, f64))> {
    Some(match style {
        "portrait" => ("人像（偏暖，肤色自然）", (150.0, 7.0), (150.0, 9.0)),
        "landscape" => ("风景（蓝天绿地，色彩通透）", (126.0, 9.0), (140.0, 13.0)),
        "indoor" => ("室内（暖光，柔和）", (134.0, 5.0), (146.0, 8.0)),
        "vintage" => ("复古（低饱和偏黄）", (134.0, 4.0), (142.0, 6.0)),
        "neutral" => ("自然（接近真实，克制）", (128.0, 5.0), (130.0, 6.0)),
        _ => return None,
    })
}

fn colorize_style(img: &RgbImage, style: &str, strength: f64) -> Result<(RgbImage, String), String> {
    let (label, a, b) = style_preset(style).ok_or_else(|| format!("没有「{style}」这个风格，可选：portrait、landscape、indoor、vintage、neutral"))?;
    let lab = lab_u8(img);
    let (lm, ls) = mean_std(lab.iter().map(|p| p[0]));
    let ls = ls.max(1.0);
    let out: Vec<[f32; 3]> = lab
        .iter()
        .map(|p| {
            let lum = (p[0] as f64 - lm) / ls;
            let ma = a.0 + lum * a.1 * 0.8;
            let mb = b.0 + lum * b.1 * 0.8;
            [p[0], (p[1] as f64 * (1.0 - strength) + ma * strength) as f32, (p[2] as f64 * (1.0 - strength) + mb * strength) as f32]
        })
        .collect();
    Ok((from_lab(&out, img.width(), img.height()), label.to_string()))
}

fn colorize_reference(img: &RgbImage, reference: &RgbImage, strength: f64) -> RgbImage {
    let src = lab_u8(img);
    let rf = lab_u8(reference);
    let mut out = src.clone();
    for c in 1..3 {
        let (sm, ss) = mean_std(src.iter().map(|p| p[c]));
        let (rm, rs) = mean_std(rf.iter().map(|p| p[c]));
        let ss = if ss == 0.0 { 1.0 } else { ss };
        let rs = if rs == 0.0 { 1.0 } else { rs };
        for (o, s) in out.iter_mut().zip(&src) {
            let mapped = (s[c] as f64 - sm) / ss * rs + rm;
            o[c] = (s[c] as f64 * (1.0 - strength) + mapped * strength) as f32;
        }
    }
    from_lab(&out, img.width(), img.height())
}

/// cv2.cvtColor(BGR2GRAY) + adaptiveThreshold(MEAN_C, BINARY, 9, 6)
fn line_art(small: &[u8], w: usize, h: usize) -> Vec<f32> {
    let gray: Vec<i32> = (0..w * h)
        .map(|i| ((small[i * 3] as f32 * 0.299 + small[i * 3 + 1] as f32 * 0.587 + small[i * 3 + 2] as f32 * 0.114).round()) as i32)
        .collect();
    let r = 4isize;
    let clampi = |v: isize, n: usize| v.clamp(0, n as isize - 1) as usize;
    // 横向盒滤波 → 纵向（边界复制）
    let mut tmp = vec![0i32; w * h];
    for y in 0..h {
        for x in 0..w {
            let mut s = 0;
            for d in -r..=r {
                s += gray[y * w + clampi(x as isize + d, w)];
            }
            tmp[y * w + x] = s;
        }
    }
    let mut out = vec![0f32; w * h];
    for y in 0..h {
        for x in 0..w {
            let mut s = 0;
            for d in -r..=r {
                s += tmp[clampi(y as isize + d, h) * w + x];
            }
            let mean = (s as f64 / 81.0).round() as i32;
            out[y * w + x] = if gray[y * w + x] > mean - 6 { 1.0 } else { 0.0 };
        }
    }
    out
}

fn colorize_ai(img: &RgbImage, model: &Path) -> Result<RgbImage, String> {
    use ort::session::builder::GraphOptimizationLevel;
    use ort::session::Session;
    use ort::value::{Tensor, ValueType};

    let mut session = Session::builder()
        .map_err(|e| format!("初始化 ONNX Runtime 失败：{e}"))?
        .with_optimization_level(GraphOptimizationLevel::All)
        .map_err(|e| format!("设置图优化级别失败：{e}"))?
        .commit_from_file(model)
        .map_err(|e| format!("加载 AI 上色模型失败：{e}"))?;
    let (mut th, mut tw) = (512usize, 512usize);
    let mut input_name = None;
    for spec in session.inputs() {
        if input_name.is_none() {
            input_name = Some(spec.name().to_string());
        }
        if let ValueType::Tensor { shape, .. } = spec.dtype() {
            if shape.len() == 4 && shape[2] > 0 && shape[3] > 0 {
                th = shape[2] as usize;
                tw = shape[3] as usize;
            }
        }
    }
    let input_name = input_name.ok_or("AI 上色模型没有输入")?;
    let (w0, h0) = (img.width() as usize, img.height() as usize);
    let small = crate::inpaint_native::resize_area_rgb(img, tw, th);
    let line = line_art(&small, tw, th);
    let plane = tw * th;
    let mut x = vec![0f32; 5 * plane];
    for i in 0..plane {
        for c in 0..3 {
            x[c * plane + i] = small[i * 3 + c] as f32 / 255.0;
        }
        x[3 * plane + i] = line[i];
    }
    let t = Tensor::from_array(([1usize, 5, th, tw], x)).map_err(|e| format!("构造输入张量失败：{e}"))?;
    let outputs = session.run(ort::inputs![input_name.as_str() => t]).map_err(|e| format!("AI 上色推理失败：{e}"))?;
    let (mut dims, raw): (Vec<usize>, Vec<f32>) = {
        let value = outputs.iter().next().map(|(_, v)| v).ok_or("模型没有输出")?;
        let (shape, data) = value.try_extract_tensor::<f32>().map_err(|e| format!("读取输出失败：{e}"))?;
        (shape.iter().map(|d| *d as usize).collect(), data.to_vec())
    };
    while dims.len() > 3 {
        dims.remove(0);
    }
    if dims.len() != 3 {
        return Err(format!("不认识的输出形状：{dims:?}"));
    }
    let (oh, ow, chw) = if dims[0] == 3 { (dims[1], dims[2], true) } else { (dims[0], dims[1], false) };
    if raw.len() < oh * ow * 3 {
        return Err("输出数据与形状对不上".into());
    }
    let mx = raw.iter().copied().filter(|v| v.is_finite()).fold(f32::MIN, f32::max);
    let scale = if mx <= 1.5 { 1.0 } else { 1.0 / 255.0 };
    let mut rgb = vec![0u8; oh * ow * 3];
    for i in 0..oh * ow {
        for c in 0..3 {
            let v = if chw { raw[c * oh * ow + i] } else { raw[i * 3 + c] };
            let v = if v.is_finite() { (v * scale).clamp(0.0, 1.0) } else { 0.0 };
            rgb[i * 3 + c] = (v * 255.0) as u8;
        }
    }
    let mut colored = RgbImage::from_raw(ow as u32, oh as u32, rgb).ok_or("输出尺寸异常")?;
    if (ow, oh) != (w0, h0) {
        colored = image::imageops::resize(&colored, w0 as u32, h0 as u32, FilterType::Lanczos3);
    }
    // 亮度用原图的 L 通道，只借用模型给出的颜色
    let lc = lab_u8(&colored);
    let lo = lab_u8(img);
    let merged: Vec<[f32; 3]> = lc.iter().zip(&lo).map(|(c, o)| [o[0], c[1], c[2]]).collect();
    Ok(from_lab(&merged, w0 as u32, h0 as u32))
}

pub(crate) fn colorize(app: &tauri::AppHandle, id: &str, input: &str, stem: &str, payload: &Value) -> Result<Value, String> {
    let mode = text(payload, "mode", "style").to_string();
    let strength = number(payload, "strength", 1.0).clamp(0.0, 1.0);
    let img = load_image(input)?.to_rgb8();
    progress(app, id, 30, "正在上色…");
    let (out, detail) = match mode.as_str() {
        "ai" => {
            let model: PathBuf = model_in_components(app, &[MANGA]).ok_or(MISSING_MANGA)?;
            let _lease = crate::api::component_use(app, &[MANGA])?;
            progress(app, id, 40, "AI 正在推理颜色…");
            (colorize_ai(&img, &model)?, "AI 上色（模型推理）".to_string())
        }
        "reference" => {
            let rp = payload.get("reference_file").and_then(Value::as_str).filter(|s| !s.is_empty() && Path::new(s).is_file()).ok_or("参考图上色需要选择一张彩色参考图")?;
            let rf = load_image(rp)?.to_rgb8();
            if is_grayscale(&rf) {
                return Err("参考图本身也是黑白的，无法提供色彩，请换一张有明显颜色的图片".into());
            }
            (colorize_reference(&img, &rf, strength), "参考图色彩迁移".to_string())
        }
        "style" => colorize_style(&img, text(payload, "style", "portrait"), strength)?,
        other => return Err(format!("不支持的上色方式「{other}」")),
    };
    progress(app, id, 90, "正在保存结果…");
    let plain = format!("{stem}_已上色.png");
    let path = results_path(app, id, &plain)?;
    out.save(&path).map_err(|_| "图片保存失败".to_string())?;
    let message = format!("{detail}：平均饱和度 {} → {}", py_round(mean_saturation(&img), 2), py_round(mean_saturation(&out), 2));
    Ok(json!({ "path": path.to_string_lossy(), "filename": plain, "mime": "image/png", "message": message,
               "width": out.width(), "height": out.height(), "mode": mode }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lab_roundtrip() {
        for p in [[0u8, 0, 0], [255, 255, 255], [200, 30, 60], [12, 180, 90], [128, 128, 128]] {
            let back = lab_to_rgb(rgb_to_lab(p));
            for c in 0..3 {
                assert!((back[c] as i32 - p[c] as i32).abs() <= 1, "{p:?} -> {back:?}");
            }
        }
        // 灰色：a、b ≈ 128
        let g = rgb_to_lab([128, 128, 128]);
        assert!((g[1] - 128.0).abs() < 0.5 && (g[2] - 128.0).abs() < 0.5);
    }

    #[test]
    fn canvas_plan() {
        assert_eq!(plan_canvas(100, 200, (0.0, 0.0, 0.0, 0.0), Some(16.0 / 9.0), "center"), (356, 200, 128, 0));
        assert_eq!(plan_canvas(100, 100, (0.25, 0.25, 0.25, 0.25), None, "center"), (150, 150, 25, 25));
        assert_eq!(plan_canvas(100, 100, (0.0, 0.0, 0.5, 0.0), None, "center"), (100, 150, 0, 50));
        assert_eq!(py_round(1.7777, 3), "1.778");
        assert_eq!(py_round(1.0, 3), "1.0");
    }

    #[test]
    fn style_colors_gray() {
        let img = RgbImage::from_fn(32, 32, |x, y| image::Rgb([((x + y) * 4) as u8; 3]));
        assert!(is_grayscale(&img));
        let (out, _) = colorize_style(&img, "portrait", 1.0).unwrap();
        assert!(mean_saturation(&out) > mean_saturation(&img) + 5.0);
    }
}
