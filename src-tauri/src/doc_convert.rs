//! 原先依赖 Python 的几个非 AI 工具的纯 Rust 实现（核心纯函数，不依赖 Tauri，便于单测）：
//!   pdf-reorder / pdf-crop / pdf-unlock / pdf-encrypt / image-watermark / csv-excel / markdown-to-pdf(HTML 排版部分)
//! 任务调度与进度见 doc_native.rs。

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use lopdf::{Document, Object, ObjectId};
use serde_json::Value;

// ═════════════════════════════ PDF 公共 ═════════════════════════════

fn obj_f64(o: &Object) -> Option<f64> {
    match o {
        Object::Integer(n) => Some(*n as f64),
        Object::Real(n) => Some(*n as f64),
        _ => None,
    }
}

fn resolve(doc: &Document, o: &Object) -> Object {
    match o {
        Object::Reference(r) => doc.get_object(*r).cloned().unwrap_or(Object::Null),
        x => x.clone(),
    }
}

fn inherited(doc: &Document, page: ObjectId, key: &[u8]) -> Option<Object> {
    let mut cur = Some(page);
    let mut guard = 0;
    while let Some(id) = cur {
        guard += 1;
        if guard > 64 {
            break;
        }
        let Ok(Object::Dictionary(d)) = doc.get_object(id) else { break };
        if let Ok(v) = d.get(key) {
            return Some(resolve(doc, v));
        }
        cur = d.get(b"Parent").ok().and_then(|p| p.as_reference().ok());
    }
    None
}

fn rect_of(doc: &Document, o: &Object) -> Option<[f64; 4]> {
    if let Object::Array(a) = resolve(doc, o) {
        if a.len() == 4 {
            let v: Vec<f64> = a.iter().filter_map(|x| obj_f64(&resolve(doc, x))).collect();
            if v.len() == 4 {
                let r = [v[0].min(v[2]), v[1].min(v[3]), v[0].max(v[2]), v[1].max(v[3])];
                if r[2] - r[0] > 0.5 && r[3] - r[1] > 0.5 {
                    return Some(r);
                }
            }
        }
    }
    None
}

/// 可见区域 = CropBox ∩ MediaBox（与 pdf.js / Acrobat 一致）
fn visible_box(doc: &Document, page: ObjectId) -> [f64; 4] {
    let media = inherited(doc, page, b"MediaBox").and_then(|o| rect_of(doc, &o)).unwrap_or([0.0, 0.0, 595.0, 842.0]);
    match inherited(doc, page, b"CropBox").and_then(|o| rect_of(doc, &o)) {
        Some(c) => {
            let r = [c[0].max(media[0]), c[1].max(media[1]), c[2].min(media[2]), c[3].min(media[3])];
            if r[2] - r[0] > 0.5 && r[3] - r[1] > 0.5 {
                r
            } else {
                media
            }
        }
        None => media,
    }
}

fn rotation(doc: &Document, page: ObjectId) -> i64 {
    inherited(doc, page, b"Rotate").and_then(|o| o.as_i64().ok()).map(|r| r.rem_euclid(360)).unwrap_or(0)
}

fn load_plain(input: &Path) -> Result<Document, String> {
    let (doc, encrypted, _) = crate::pdf_crypt::load_decrypted(input, "").map_err(|e| {
        if e.contains("需要提供密码") || e.contains("密码错误") {
            "这个 PDF 设置了打开密码，请先用「解锁 PDF」输入密码解锁后再处理".to_string()
        } else {
            e
        }
    })?;
    let _ = encrypted;
    Ok(doc)
}

fn save_doc(doc: &mut Document, output: &Path) -> Result<(), String> {
    if let Some(parent) = output.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    doc.save(output).map_err(|e| format!("写出 PDF 失败：{e}"))?;
    Ok(())
}

/// 解析 "1-3,5,7-9" 形式的页码（从 1 开始），保持书写顺序，允许重复
pub fn parse_page_list(spec: &str, total: usize) -> Result<Vec<usize>, String> {
    let mut out = Vec::new();
    let norm = spec.replace(['，', '、', ';', '；', ' '], ",").replace(['～', '~', '—', '–'], "-");
    for part in norm.split(',') {
        let part = part.trim();
        if part.is_empty() {
            continue;
        }
        if let Some((a, b)) = part.split_once('-') {
            let a: usize = a.trim().parse().map_err(|_| format!("页码写法不对：「{part}」"))?;
            let b: usize = if b.trim().is_empty() { total } else { b.trim().parse().map_err(|_| format!("页码写法不对：「{part}」"))? };
            if a == 0 || b == 0 || a > total || b > total {
                return Err(format!("页码超出范围：「{part}」（共 {total} 页）"));
            }
            if a <= b {
                out.extend(a..=b);
            } else {
                out.extend((b..=a).rev());
            }
        } else {
            let n: usize = part.parse().map_err(|_| format!("页码写法不对：「{part}」"))?;
            if n == 0 || n > total {
                return Err(format!("页码超出范围：{n}（共 {total} 页）"));
            }
            out.push(n);
        }
    }
    Ok(out)
}

/// 删除不可达对象（lopdf 自带的 prune_objects 是 O(n²)，大文件很慢）
fn prune_fast(doc: &mut Document) {
    let mut seen: HashSet<ObjectId> = HashSet::new();
    let mut stack: Vec<ObjectId> = Vec::new();
    fn collect(o: &Object, stack: &mut Vec<ObjectId>) {
        match o {
            Object::Reference(r) => stack.push(*r),
            Object::Array(a) => a.iter().for_each(|x| collect(x, stack)),
            Object::Dictionary(d) => d.iter().for_each(|(_, v)| collect(v, stack)),
            Object::Stream(s) => s.dict.iter().for_each(|(_, v)| collect(v, stack)),
            _ => {}
        }
    }
    for (_, v) in doc.trailer.iter() {
        collect(v, &mut stack);
    }
    while let Some(id) = stack.pop() {
        if !seen.insert(id) {
            continue;
        }
        if let Some(o) = doc.objects.get(&id) {
            collect(o, &mut stack);
        }
    }
    doc.objects.retain(|id, _| seen.contains(id));
}

// ═════════════════════════════ pdf-reorder ═════════════════════════════

pub fn pdf_reorder(input: &Path, output: &Path, order: &str) -> Result<String, String> {
    let mut doc = load_plain(input)?;
    let pages = doc.get_pages();
    let total = pages.len();
    if total == 0 {
        return Err("这个 PDF 没有页面".into());
    }
    let list = parse_page_list(order, total)?;
    if list.is_empty() {
        return Err(format!("请填写新的页面顺序，例如 3,1,2（共 {total} 页）"));
    }
    let root_id = doc.trailer.get(b"Root").and_then(|o| o.as_reference()).map_err(|_| "PDF 缺少目录对象")?;
    let pages_id = match doc.get_object(root_id) {
        Ok(Object::Dictionary(c)) => c.get(b"Pages").and_then(|o| o.as_reference()).map_err(|_| "PDF 缺少页面树")?,
        _ => return Err("PDF 目录对象无效".into()),
    };

    // 把会被继承的属性落到每一页上，然后把页面树拍平
    let mut used: HashSet<ObjectId> = HashSet::new();
    let mut kids: Vec<Object> = Vec::with_capacity(list.len());
    for n in &list {
        let src = pages[&(*n as u32)];
        let mut dict = match doc.get_object(src) {
            Ok(Object::Dictionary(d)) => d.clone(),
            _ => return Err(format!("第 {n} 页对象无效")),
        };
        for key in [&b"Resources"[..], b"MediaBox", b"CropBox", b"Rotate"] {
            if dict.get(key).is_err() {
                if let Some(v) = inherited(&doc, src, key) {
                    dict.set(key.to_vec(), v);
                }
            }
        }
        dict.set("Parent", Object::Reference(pages_id));
        let id = if used.insert(src) {
            doc.objects.insert(src, Object::Dictionary(dict));
            src
        } else {
            // 重复出现的页面：复制一份页面字典（内容流与资源共享，不增加体积）
            dict.remove(b"Annots"); // 注释对象带 /P 反向引用，复制页面上不再保留
            doc.add_object(Object::Dictionary(dict))
        };
        kids.push(Object::Reference(id));
    }
    let count = kids.len() as i64;
    if let Ok(Object::Dictionary(p)) = doc.get_object_mut(pages_id) {
        p.set("Kids", Object::Array(kids));
        p.set("Count", count);
        p.remove(b"Parent");
    }
    prune_fast(&mut doc);
    save_doc(&mut doc, output)?;
    let moved = if list.len() == total && list.iter().copied().collect::<HashSet<_>>().len() == total {
        format!("已按新顺序重排 {total} 页")
    } else {
        format!("已生成新 PDF：{} 页（原 {total} 页，按你填写的顺序取页）", list.len())
    };
    Ok(moved)
}

// ═════════════════════════════ pdf-crop ═════════════════════════════

#[derive(Clone, Copy, Default, Debug)]
pub struct Margins {
    pub top: f64,
    pub bottom: f64,
    pub left: f64,
    pub right: f64,
}

impl Margins {
    fn from_value(v: &Value) -> Margins {
        let g = |k: &str| -> f64 {
            match v.get(k) {
                Some(Value::Number(n)) => n.as_f64().unwrap_or(0.0),
                Some(Value::String(s)) => s.trim().parse().unwrap_or(0.0),
                _ => 0.0,
            }
            .max(0.0)
        };
        Margins { top: g("top"), bottom: g("bottom"), left: g("left"), right: g("right") }
    }
    fn is_zero(&self) -> bool {
        self.top == 0.0 && self.bottom == 0.0 && self.left == 0.0 && self.right == 0.0
    }
}

/// 页面裁剪：只改 CropBox，不重新渲染、不损失清晰度，文字仍可选中。
/// 边距按**看到的方向**（已考虑 /Rotate）理解，与前端 pdf.js 预览一致。
/// `per_page`：页号(从 1 开始) → 边距；`default`：其余页面使用的边距；unit：mm | percent
pub fn pdf_crop(
    input: &Path,
    output: &Path,
    per_page: &HashMap<usize, Margins>,
    default: Option<(Margins, Option<HashSet<usize>>)>,
    unit: &str,
) -> Result<String, String> {
    let mut doc = load_plain(input)?;
    let pages = doc.get_pages();
    let total = pages.len();
    let mm = 72.0 / 25.4;
    let mut applied = 0usize;
    let mut sizes: Vec<String> = Vec::new();

    for (&num, &pid) in pages.iter() {
        let n = num as usize;
        let m = match per_page.get(&n) {
            Some(m) => *m,
            None => match &default {
                Some((m, None)) => *m,
                Some((m, Some(set))) if set.contains(&n) => *m,
                _ => continue,
            },
        };
        if m.is_zero() {
            continue;
        }
        let b = visible_box(&doc, pid);
        let rot = rotation(&doc, pid);
        // 看到的宽高
        let (vw, vh) = if rot == 90 || rot == 270 { (b[3] - b[1], b[2] - b[0]) } else { (b[2] - b[0], b[3] - b[1]) };
        let (t, bo, l, r) = if unit == "percent" {
            let c = |x: f64| x.clamp(0.0, 45.0) / 100.0;
            (vh * c(m.top), vh * c(m.bottom), vw * c(m.left), vw * c(m.right))
        } else {
            (m.top * mm, m.bottom * mm, m.left * mm, m.right * mm)
        };
        // 视觉方向 → 未旋转坐标（PDF y 轴向上）
        let (dx0, dy0, dx1, dy1) = match rot {
            90 => (t, l, bo, r),   // 上←左边(x0)、右←上边(y1)、下←右边(x1)、左←下边(y0)
            180 => (r, t, l, bo),
            270 => (bo, r, t, l),
            _ => (l, bo, r, t),
        };
        let nb = [b[0] + dx0, b[1] + dy0, b[2] - dx1, b[3] - dy1];
        if nb[2] - nb[0] < 10.0 || nb[3] - nb[1] < 10.0 {
            continue;
        }
        let arr = Object::Array(nb.iter().map(|v| Object::Real(((*v * 1000.0).round() / 1000.0) as f32)).collect());
        if let Ok(Object::Dictionary(d)) = doc.get_object_mut(pid) {
            d.set("CropBox", arr.clone());
            // 打印/导出时部分软件看 TrimBox/ArtBox，这里一并收紧，避免被忽略
            if d.get(b"TrimBox").is_ok() {
                d.set("TrimBox", arr.clone());
            }
            if d.get(b"ArtBox").is_ok() {
                d.set("ArtBox", arr);
            }
        }
        applied += 1;
        if sizes.len() < 3 {
            let (w, h) = if rot == 90 || rot == 270 { (nb[3] - nb[1], nb[2] - nb[0]) } else { (nb[2] - nb[0], nb[3] - nb[1]) };
            sizes.push(format!("第{n}页 {:.1}×{:.1}mm", w / mm, h / mm));
        }
    }
    if applied == 0 {
        return Err("没有需要裁剪的页面（四个边距都是 0，或者裁剪范围过大）".into());
    }
    save_doc(&mut doc, output)?;
    let more = if applied > sizes.len() { " …" } else { "" };
    Ok(format!("已裁剪 {applied}/{total} 页（{}{more}），矢量无损、文字可选", sizes.join("，")))
}

// ═════════════════════════════ pdf-unlock / pdf-encrypt ═════════════════════════════

pub fn pdf_unlock(input: &Path, output: &Path, password: &str) -> Result<String, String> {
    let (mut doc, was_encrypted, as_owner) = crate::pdf_crypt::load_decrypted(input, password)?;
    save_doc(&mut doc, output)?;
    Ok(if !was_encrypted {
        "这个 PDF 本来就没有加密，已原样另存一份".into()
    } else if password.is_empty() {
        "已移除权限限制（这个 PDF 没有打开密码，只有编辑/打印/复制限制）".into()
    } else if as_owner {
        "已用所有者密码解锁，密码与全部限制都已移除".into()
    } else {
        "已解锁，密码与全部限制都已移除".into()
    })
}

pub fn pdf_encrypt(input: &Path, output: &Path, user_pw: &str, owner_pw: &str) -> Result<String, String> {
    if user_pw.is_empty() && owner_pw.is_empty() {
        return Err("请至少设置一个密码（打开密码或权限密码）".into());
    }
    let (mut doc, was_encrypted, _) = crate::pdf_crypt::load_decrypted(input, "").map_err(|e| {
        if e.contains("密码") {
            "这个 PDF 已经有打开密码了，请先用「解锁 PDF」解锁后再重新加密".to_string()
        } else {
            e
        }
    })?;
    let perms = crate::pdf_crypt::Permissions {
        print: true,
        print_high: true,
        copy: true,
        annotate: true,
        fill_forms: true,
        modify: false,
        assemble: false,
    };
    crate::pdf_crypt::encrypt_document(&mut doc, user_pw, owner_pw, &perms)?;
    save_doc(&mut doc, output)?;
    let mut msg = if user_pw.is_empty() {
        "已加密（AES-256）：打开不需要密码，但编辑/重组页面需要权限密码".to_string()
    } else {
        "已加密（AES-256）：打开需要输入密码".to_string()
    };
    if was_encrypted {
        msg.push_str("；原文件的旧权限限制已替换");
    }
    Ok(msg)
}

// ═════════════════════════════ image-watermark ═════════════════════════════

pub struct WatermarkParams {
    pub position: String,
    pub font_px: u32,
    pub opacity: f32, // 0~100
    pub color: [u8; 3],
    pub rotate_deg: f32, // 顺时针（与 CSS rotate 一致）
    pub x_percent: f32,
    pub y_percent: f32,
}

pub fn parse_hex_color(s: &str) -> [u8; 3] {
    let h = s.trim().trim_start_matches('#');
    let h: String = if h.len() == 3 { h.chars().flat_map(|c| [c, c]).collect() } else { h.to_string() };
    if h.len() >= 6 {
        let p = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).ok();
        if let (Some(r), Some(g), Some(b)) = (p(0), p(2), p(4)) {
            return [r, g, b];
        }
    }
    [255, 255, 255]
}

/// 读取图片并按 EXIF 方向摆正（浏览器预览会自动摆正，这里保持一致）
pub fn open_oriented(path: &Path) -> Result<image::DynamicImage, String> {
    use image::ImageDecoder;
    let reader = image::ImageReader::open(path)
        .map_err(|e| format!("无法打开图片：{e}"))?
        .with_guessed_format()
        .map_err(|e| format!("无法识别图片格式：{e}"))?;
    let mut dec = reader.into_decoder().map_err(|e| format!("无法解码图片：{e}"))?;
    let orient = dec.orientation().unwrap_or(image::metadata::Orientation::NoTransforms);
    let mut img = image::DynamicImage::from_decoder(dec).map_err(|e| format!("无法解码图片：{e}"))?;
    img.apply_orientation(orient);
    Ok(img)
}

/// 取透明遮罩的紧包围盒
fn tight_mask(mask: &image::GrayAlphaImage) -> image::GrayImage {
    let (w, h) = mask.dimensions();
    let (mut x0, mut y0, mut x1, mut y1) = (w, h, 0u32, 0u32);
    for (x, y, p) in mask.enumerate_pixels() {
        if p[1] > 8 {
            x0 = x0.min(x);
            y0 = y0.min(y);
            x1 = x1.max(x);
            y1 = y1.max(y);
        }
    }
    if x1 < x0 || y1 < y0 {
        return image::GrayImage::new(1, 1);
    }
    image::GrayImage::from_fn(x1 - x0 + 1, y1 - y0 + 1, |x, y| image::Luma([mask.get_pixel(x0 + x, y0 + y)[1]]))
}

/// 双线性旋转（顺时针 deg），画布扩展到能容下旋转后的内容
fn rotate_mask(m: &image::GrayImage, deg: f32) -> image::GrayImage {
    if deg.rem_euclid(360.0).abs() < 0.01 {
        return m.clone();
    }
    let (w, h) = (m.width() as f32, m.height() as f32);
    let t = deg.to_radians();
    let (s, c) = t.sin_cos();
    let nw = (w * c.abs() + h * s.abs()).ceil() as u32 + 2;
    let nh = (w * s.abs() + h * c.abs()).ceil() as u32 + 2;
    let (cx, cy) = (w / 2.0, h / 2.0);
    let (ncx, ncy) = (nw as f32 / 2.0, nh as f32 / 2.0);
    image::GrayImage::from_fn(nw, nh, |x, y| {
        // 反向映射：屏幕坐标 y 向下，顺时针旋转 t 的逆变换
        let dx = x as f32 + 0.5 - ncx;
        let dy = y as f32 + 0.5 - ncy;
        let sx = dx * c + dy * s + cx - 0.5;
        let sy = -dx * s + dy * c + cy - 0.5;
        let x0 = sx.floor();
        let y0 = sy.floor();
        let fx = sx - x0;
        let fy = sy - y0;
        let px = |xx: f32, yy: f32| -> f32 {
            if xx < 0.0 || yy < 0.0 || xx >= w || yy >= h {
                0.0
            } else {
                m.get_pixel(xx as u32, yy as u32)[0] as f32
            }
        };
        let v = px(x0, y0) * (1.0 - fx) * (1.0 - fy)
            + px(x0 + 1.0, y0) * fx * (1.0 - fy)
            + px(x0, y0 + 1.0) * (1.0 - fx) * fy
            + px(x0 + 1.0, y0 + 1.0) * fx * fy;
        image::Luma([v.round().clamp(0.0, 255.0) as u8])
    })
}

/// 把文字遮罩（GDI+ 渲染的灰度+透明）按参数合成到图片上
pub fn apply_image_watermark(img: &mut image::RgbaImage, text_mask: &image::GrayAlphaImage, p: &WatermarkParams) {
    let (iw, ih) = (img.width() as f32, img.height() as f32);
    let glyph = tight_mask(text_mask);
    let (tw, th) = (glyph.width() as f32, glyph.height() as f32);
    // 文字（未旋转）中心点
    let (cx, cy) = if p.x_percent >= 0.0 && p.y_percent >= 0.0 {
        (iw * p.x_percent / 100.0, ih * p.y_percent / 100.0)
    } else {
        let margin = (iw.min(ih) * 0.03).max(20.0);
        let (x, y) = match p.position.as_str() {
            "top-left" => (margin, margin),
            "top-center" | "top" => ((iw - tw) / 2.0, margin),
            "top-right" => (iw - tw - margin, margin),
            "center" | "middle" => ((iw - tw) / 2.0, (ih - th) / 2.0),
            "bottom-left" => (margin, ih - th - margin),
            "bottom-center" | "bottom" => ((iw - tw) / 2.0, ih - th - margin),
            "left" | "center-left" => (margin, (ih - th) / 2.0),
            "right" | "center-right" => (iw - tw - margin, (ih - th) / 2.0),
            _ => (iw - tw - margin, ih - th - margin),
        };
        (x + tw / 2.0, y + th / 2.0)
    };
    let layer = rotate_mask(&glyph, p.rotate_deg);
    let ox = (cx - layer.width() as f32 / 2.0).round() as i64;
    let oy = (cy - layer.height() as f32 / 2.0).round() as i64;
    let op = (p.opacity / 100.0).clamp(0.0, 1.0);
    let [r, g, b] = p.color;
    for (lx, ly, a) in layer.enumerate_pixels() {
        if a[0] == 0 {
            continue;
        }
        let x = ox + lx as i64;
        let y = oy + ly as i64;
        if x < 0 || y < 0 || x >= img.width() as i64 || y >= img.height() as i64 {
            continue;
        }
        let sa = a[0] as f32 / 255.0 * op;
        let dst = img.get_pixel_mut(x as u32, y as u32);
        let da = dst[3] as f32 / 255.0;
        let oa = sa + da * (1.0 - sa);
        if oa <= 0.0 {
            continue;
        }
        let mix = |s: u8, d: u8| -> u8 { ((s as f32 * sa + d as f32 * da * (1.0 - sa)) / oa).round().clamp(0.0, 255.0) as u8 };
        *dst = image::Rgba([mix(r, dst[0]), mix(g, dst[1]), mix(b, dst[2]), (oa * 255.0).round() as u8]);
    }
}

fn flatten_white(img: &image::RgbaImage) -> image::RgbImage {
    image::RgbImage::from_fn(img.width(), img.height(), |x, y| {
        let p = img.get_pixel(x, y);
        let a = p[3] as f32 / 255.0;
        let f = |c: u8| (c as f32 * a + 255.0 * (1.0 - a)).round() as u8;
        image::Rgb([f(p[0]), f(p[1]), f(p[2])])
    })
}

/// 按扩展名写出真实格式；不支持的格式退化为 PNG。返回 (实际路径, MIME)
pub fn save_by_ext(img: &image::RgbaImage, out: &Path) -> Result<(PathBuf, &'static str), String> {
    let ext = out.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let write = |path: &Path| -> Result<&'static str, String> {
        let f = std::fs::File::create(path).map_err(|e| format!("写出图片失败：{e}"))?;
        let mut w = std::io::BufWriter::new(f);
        let r = match ext.as_str() {
            "jpg" | "jpeg" | "jfif" => {
                let rgb = flatten_white(img);
                image::codecs::jpeg::JpegEncoder::new_with_quality(&mut w, 95).encode_image(&rgb).map(|_| "image/jpeg")
            }
            "bmp" => flatten_white(img).write_to(&mut w, image::ImageFormat::Bmp).map(|_| "image/bmp"),
            "webp" => img.write_to(&mut w, image::ImageFormat::WebP).map(|_| "image/webp"),
            "gif" => img.write_to(&mut w, image::ImageFormat::Gif).map(|_| "image/gif"),
            "tif" | "tiff" => img.write_to(&mut w, image::ImageFormat::Tiff).map(|_| "image/tiff"),
            "ico" => img.write_to(&mut w, image::ImageFormat::Ico).map(|_| "image/x-icon"),
            _ => img.write_to(&mut w, image::ImageFormat::Png).map(|_| "image/png"),
        };
        r.map_err(|e| e.to_string())
    };
    let known = matches!(ext.as_str(), "jpg" | "jpeg" | "jfif" | "bmp" | "webp" | "gif" | "tif" | "tiff" | "ico" | "png");
    if known {
        match write(out) {
            Ok(m) => return Ok((out.to_path_buf(), m)),
            Err(_) if ext != "png" => {}
            Err(e) => return Err(format!("写出图片失败：{e}")),
        }
        let _ = std::fs::remove_file(out);
    }
    let png = out.with_extension("png");
    let f = std::fs::File::create(&png).map_err(|e| format!("写出图片失败：{e}"))?;
    img.write_to(&mut std::io::BufWriter::new(f), image::ImageFormat::Png).map_err(|e| format!("写出图片失败：{e}"))?;
    Ok((png, "image/png"))
}

// ═════════════════════════════ csv-excel ═════════════════════════════

pub const MAX_CSV_BYTES: u64 = 100 * 1024 * 1024;
pub const MAX_CSV_ROWS: usize = 100_000;
pub const MAX_XLSX_ROWS: usize = 1_000_000;
const MAX_COLUMNS: usize = 16384;

pub fn decode_text_bytes(data: &[u8]) -> (String, &'static str) {
    if let Some(rest) = data.strip_prefix(b"\xEF\xBB\xBF") {
        return (String::from_utf8_lossy(rest).to_string(), "UTF-8（BOM）");
    }
    if data.starts_with(b"\xFF\xFE") || data.starts_with(b"\xFE\xFF") {
        let le = data[0] == 0xFF;
        let units: Vec<u16> = data[2..]
            .chunks_exact(2)
            .map(|c| if le { u16::from_le_bytes([c[0], c[1]]) } else { u16::from_be_bytes([c[0], c[1]]) })
            .collect();
        return (String::from_utf16_lossy(&units), "UTF-16");
    }
    if let Ok(s) = std::str::from_utf8(data) {
        return (s.to_string(), "UTF-8");
    }
    let (s, _, bad) = encoding_rs::GB18030.decode(data);
    if !bad {
        return (s.to_string(), "GB18030（兼容 GBK）");
    }
    (String::from_utf8_lossy(data).to_string(), "UTF-8（部分字符无法识别）")
}

/// RFC 4180 CSV 解析（支持引号、转义引号、字段内换行）
pub fn parse_csv(text: &str, delim: char, max_rows: usize) -> Result<Vec<Vec<String>>, String> {
    let mut rows: Vec<Vec<String>> = Vec::new();
    let mut row: Vec<String> = Vec::new();
    let mut field = String::new();
    let mut in_q = false;
    let mut chars = text.chars().peekable();
    let mut any = false;
    while let Some(c) = chars.next() {
        if in_q {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    field.push('"');
                    chars.next();
                } else {
                    in_q = false;
                }
            } else {
                field.push(c);
            }
            continue;
        }
        match c {
            '"' if field.is_empty() => {
                in_q = true;
                any = true;
            }
            c if c == delim => {
                row.push(std::mem::take(&mut field));
                any = true;
            }
            '\r' | '\n' => {
                if c == '\r' && chars.peek() == Some(&'\n') {
                    chars.next();
                }
                if any || !field.is_empty() || !row.is_empty() {
                    row.push(std::mem::take(&mut field));
                    rows.push(std::mem::take(&mut row));
                    if rows.len() > max_rows {
                        return Err(format!("CSV 超过 {max_rows} 行上限，请拆分后再转换"));
                    }
                }
                any = false;
            }
            _ => {
                field.push(c);
                any = true;
            }
        }
    }
    if any || !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }
    if rows.len() > max_rows {
        return Err(format!("CSV 超过 {max_rows} 行上限，请拆分后再转换"));
    }
    Ok(rows)
}

pub fn detect_delimiter(text: &str) -> char {
    let lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).take(20).collect();
    if lines.is_empty() {
        return ',';
    }
    let sample = lines.join("\n");
    let mut best: Option<(char, f64, usize)> = None;
    for d in [',', ';', '\t', '|'] {
        let Ok(rows) = parse_csv(&sample, d, 1000) else { continue };
        let counts: Vec<usize> = rows.iter().filter(|r| !r.is_empty()).map(|r| r.len()).collect();
        if counts.is_empty() {
            continue;
        }
        let mut freq: HashMap<usize, usize> = HashMap::new();
        for c in &counts {
            *freq.entry(*c).or_default() += 1;
        }
        let (&top, &n) = freq.iter().max_by(|a, b| a.1.cmp(b.1).then(a.0.cmp(b.0))).unwrap();
        if top < 2 {
            continue;
        }
        let cons = n as f64 / counts.len() as f64;
        if best.map(|(_, bc, bt)| (cons, top) > (bc, bt)).unwrap_or(true) {
            best = Some((d, cons, top));
        }
    }
    best.map(|b| b.0).unwrap_or(',')
}

pub fn normalize_delimiter(v: &str) -> Result<Option<char>, String> {
    let low = v.trim().to_lowercase();
    if matches!(low.as_str(), "" | "auto" | "自动" | "自动探测") && v != " " && v != "\t" {
        return Ok(None);
    }
    Ok(Some(match low.as_str() {
        "tab" | "\\t" | "制表符" => '\t',
        "comma" | "逗号" => ',',
        "semicolon" | "分号" => ';',
        "pipe" | "竖线" => '|',
        "space" | "空格" => ' ',
        _ => {
            let mut it = v.chars();
            match (it.next(), it.next()) {
                (Some(c), None) => c,
                _ => return Err(format!("分隔符只能是单个字符（例如 , ; 或 Tab），收到的是「{v}」")),
            }
        }
    }))
}

pub fn parse_has_header(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => true,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().map(|x| x != 0.0).unwrap_or(true),
        Some(Value::String(s)) => {
            !matches!(s.trim().to_lowercase().as_str(), "false" | "0" | "no" | "n" | "off" | "f" | "否" | "无" | "无表头")
        }
        _ => true,
    }
}

enum Cell {
    Empty,
    Num(String),
    Text(String),
}

/// CSV 文本 → 单元格：普通数字写成真数字；前导 0 编号、超过 15 位的长数字保持文本
fn to_cell(raw: &str) -> Cell {
    let s = raw.trim();
    if s.is_empty() {
        return Cell::Empty;
    }
    let body = s.strip_prefix(['+', '-']).unwrap_or(s);
    if body.is_empty() {
        return Cell::Text(raw.to_string());
    }
    let b = body.as_bytes();
    if b.len() > 1 && b[0] == b'0' && b[1].is_ascii_digit() {
        return Cell::Text(raw.to_string());
    }
    if b.iter().all(|c| c.is_ascii_digit()) {
        if b.len() > 15 {
            return Cell::Text(raw.to_string());
        }
        return Cell::Num(s.trim_start_matches('+').to_string());
    }
    // 小数 / 科学计数法
    let (mant, exp) = match body.find(['e', 'E']) {
        Some(i) => (&body[..i], Some(&body[i + 1..])),
        None => (body, None),
    };
    let mant_ok = {
        let parts: Vec<&str> = mant.split('.').collect();
        match parts.as_slice() {
            [a] => !a.is_empty() && a.bytes().all(|c| c.is_ascii_digit()),
            [a, c] => (!a.is_empty() || !c.is_empty()) && a.bytes().all(|x| x.is_ascii_digit()) && c.bytes().all(|x| x.is_ascii_digit()) && !c.is_empty(),
            _ => false,
        }
    };
    let exp_ok = exp.map(|e| {
        let e = e.strip_prefix(['+', '-']).unwrap_or(e);
        !e.is_empty() && e.bytes().all(|c| c.is_ascii_digit())
    });
    if mant_ok && exp_ok != Some(false) {
        if mant.replace('.', "").len() > 15 {
            return Cell::Text(raw.to_string());
        }
        if let Ok(v) = s.parse::<f64>() {
            if v.is_finite() {
                return Cell::Num(format!("{v}"));
            }
        }
    }
    Cell::Text(raw.to_string())
}

fn display_width(s: &str) -> usize {
    s.chars()
        .map(|ch| if ('\u{2e80}'..='\u{9fff}').contains(&ch) || ('\u{f900}'..='\u{faff}').contains(&ch) || ('\u{ff00}'..='\u{ffef}').contains(&ch) { 2 } else { 1 })
        .sum()
}

fn xml_escape(s: &str) -> String {
    let mut o = String::with_capacity(s.len() + 8);
    for c in s.chars() {
        match c {
            '&' => o.push_str("&amp;"),
            '<' => o.push_str("&lt;"),
            '>' => o.push_str("&gt;"),
            '"' => o.push_str("&quot;"),
            '\t' | '\n' | '\r' => o.push(c),
            c if (c as u32) < 0x20 || c == '\u{FFFE}' || c == '\u{FFFF}' => {}
            c => o.push(c),
        }
    }
    o
}

fn col_letter(mut n: usize) -> String {
    let mut s = Vec::new();
    n += 1;
    while n > 0 {
        let r = (n - 1) % 26;
        s.push(b'A' + r as u8);
        n = (n - 1) / 26;
    }
    s.reverse();
    String::from_utf8(s).unwrap()
}

pub fn safe_sheet_title(t: &str) -> Option<String> {
    let s: String = t.trim().chars().map(|c| if "[]:*?/\\".contains(c) { '_' } else { c }).take(31).collect();
    let s = s.trim().to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

pub fn csv_to_xlsx(
    src: &Path,
    out: &Path,
    sheet: Option<&str>,
    delimiter: &str,
    has_header: bool,
) -> Result<String, String> {
    let meta = std::fs::metadata(src).map_err(|e| format!("读取文件失败：{e}"))?;
    if meta.len() > MAX_CSV_BYTES {
        return Err(format!("CSV 文件太大（{:.1} MB），超过 100 MB 上限", meta.len() as f64 / 1048576.0));
    }
    let data = std::fs::read(src).map_err(|e| format!("读取文件失败：{e}"))?;
    let (text, encoding) = decode_text_bytes(&data);
    if text.trim().is_empty() {
        return Err("CSV 文件是空的".into());
    }
    let delim = match normalize_delimiter(delimiter)? {
        Some(d) => d,
        None => detect_delimiter(&text),
    };
    let rows = parse_csv(&text, delim, MAX_CSV_ROWS + 1)?;
    let col_count = rows.iter().map(|r| r.len()).max().unwrap_or(0);
    if col_count == 0 {
        return Err("CSV 里没有任何数据".into());
    }
    if col_count > MAX_COLUMNS {
        return Err(format!("列数 {col_count} 超过 Excel 上限 {MAX_COLUMNS}"));
    }
    let title = sheet.and_then(safe_sheet_title).unwrap_or_else(|| "Sheet1".into());

    let mut widths = vec![0usize; col_count];
    let mut sheet_rows = String::with_capacity(text.len() * 2);
    let write_row = |r_index: usize, cells: Vec<(usize, Cell, bool)>, sheet_rows: &mut String, widths: &mut Vec<usize>| {
        if cells.is_empty() {
            return;
        }
        sheet_rows.push_str(&format!("<row r=\"{r_index}\">"));
        for (c, cell, bold) in cells {
            let rf = format!("{}{r_index}", col_letter(c));
            let style = if bold { " s=\"1\"" } else { "" };
            match cell {
                Cell::Empty => {}
                Cell::Num(n) => {
                    widths[c] = widths[c].max(n.len());
                    sheet_rows.push_str(&format!("<c r=\"{rf}\"{style}><v>{n}</v></c>"));
                }
                Cell::Text(t) => {
                    widths[c] = widths[c].max(display_width(&t));
                    let t: String = t.chars().take(32767).collect();
                    // 内联字符串永远不会被当成公式，天然防 CSV 注入
                    sheet_rows.push_str(&format!(
                        "<c r=\"{rf}\" t=\"inlineStr\"{style}><is><t xml:space=\"preserve\">{}</t></is></c>",
                        xml_escape(&t)
                    ));
                }
            }
        }
        sheet_rows.push_str("</row>");
    };

    let mut r_index = 1usize;
    let data_rows: &[Vec<String>] = if has_header && !rows.is_empty() {
        let header = &rows[0];
        let cells: Vec<(usize, Cell, bool)> = (0..col_count)
            .map(|c| {
                let raw = header.get(c).map(|s| s.trim().to_string()).unwrap_or_default();
                let mut label = if raw.is_empty() { format!("列{}", c + 1) } else { raw };
                if label.chars().count() > 200 {
                    label = label.chars().take(200).collect::<String>() + "…";
                }
                (c, Cell::Text(label), true)
            })
            .collect();
        write_row(1, cells, &mut sheet_rows, &mut widths);
        r_index = 2;
        &rows[1..]
    } else {
        &rows[..]
    };
    if data_rows.len() > MAX_CSV_ROWS {
        return Err(format!("CSV 超过 {MAX_CSV_ROWS} 行上限，请拆分后再转换"));
    }
    for row in data_rows {
        let cells: Vec<(usize, Cell, bool)> = row
            .iter()
            .enumerate()
            .filter_map(|(c, raw)| match to_cell(raw) {
                Cell::Empty => None,
                x => Some((c, x, false)),
            })
            .collect();
        write_row(r_index, cells, &mut sheet_rows, &mut widths);
        r_index += 1;
    }

    let cols: String = widths
        .iter()
        .enumerate()
        .map(|(i, w)| format!("<col min=\"{0}\" max=\"{0}\" width=\"{1:.1}\" customWidth=\"1\"/>", i + 1, ((*w + 2) as f64).clamp(8.0, 60.0)))
        .collect();
    let pane = if has_header {
        "<sheetViews><sheetView workbookViewId=\"0\"><pane ySplit=\"1\" topLeftCell=\"A2\" activePane=\"bottomLeft\" state=\"frozen\"/><selection pane=\"bottomLeft\" activeCell=\"A2\" sqref=\"A2\"/></sheetView></sheetViews>"
    } else {
        "<sheetViews><sheetView workbookViewId=\"0\"/></sheetViews>"
    };
    let last_row = (r_index - 1).max(1);
    let sheet_xml = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<worksheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><dimension ref=\"A1:{}{}\"/>{pane}<sheetFormatPr defaultRowHeight=\"15\"/><cols>{cols}</cols><sheetData>{sheet_rows}</sheetData></worksheet>",
        col_letter(col_count - 1),
        last_row
    );
    let workbook = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<workbook xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\" xmlns:r=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships\"><bookViews><workbookView/></bookViews><sheets><sheet name=\"{}\" sheetId=\"1\" r:id=\"rId1\"/></sheets></workbook>",
        xml_escape(&title)
    );
    let styles = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<styleSheet xmlns=\"http://schemas.openxmlformats.org/spreadsheetml/2006/main\"><fonts count=\"2\"><font><sz val=\"11\"/><name val=\"Calibri\"/><family val=\"2\"/></font><font><b/><sz val=\"11\"/><name val=\"Calibri\"/><family val=\"2\"/></font></fonts><fills count=\"2\"><fill><patternFill patternType=\"none\"/></fill><fill><patternFill patternType=\"gray125\"/></fill></fills><borders count=\"1\"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count=\"1\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\"/></cellStyleXfs><cellXfs count=\"2\"><xf numFmtId=\"0\" fontId=\"0\" fillId=\"0\" borderId=\"0\" xfId=\"0\"/><xf numFmtId=\"0\" fontId=\"1\" fillId=\"0\" borderId=\"0\" xfId=\"0\" applyFont=\"1\"/></cellXfs><cellStyles count=\"1\"><cellStyle name=\"Normal\" xfId=\"0\" builtinId=\"0\"/></cellStyles></styleSheet>";
    let content_types = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\"><Default Extension=\"rels\" ContentType=\"application/vnd.openxmlformats-package.relationships+xml\"/><Default Extension=\"xml\" ContentType=\"application/xml\"/><Override PartName=\"/xl/workbook.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml\"/><Override PartName=\"/xl/worksheets/sheet1.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml\"/><Override PartName=\"/xl/styles.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml\"/><Override PartName=\"/docProps/app.xml\" ContentType=\"application/vnd.openxmlformats-officedocument.extended-properties+xml\"/></Types>";
    let rels = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument\" Target=\"xl/workbook.xml\"/><Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties\" Target=\"docProps/app.xml\"/></Relationships>";
    let wb_rels = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Relationships xmlns=\"http://schemas.openxmlformats.org/package/2006/relationships\"><Relationship Id=\"rId1\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet\" Target=\"worksheets/sheet1.xml\"/><Relationship Id=\"rId2\" Type=\"http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles\" Target=\"styles.xml\"/></Relationships>";
    let app = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n<Properties xmlns=\"http://schemas.openxmlformats.org/officeDocument/2006/extended-properties\"><Application>FurinaKit</Application></Properties>";

    let mut z = crate::mini_zip::ZipWriter::new();
    z.add("[Content_Types].xml", content_types.as_bytes())?;
    z.add("_rels/.rels", rels.as_bytes())?;
    z.add("docProps/app.xml", app.as_bytes())?;
    z.add("xl/workbook.xml", workbook.as_bytes())?;
    z.add("xl/_rels/workbook.xml.rels", wb_rels.as_bytes())?;
    z.add("xl/styles.xml", styles.as_bytes())?;
    z.add("xl/worksheets/sheet1.xml", sheet_xml.as_bytes())?;
    if let Some(p) = out.parent() {
        let _ = std::fs::create_dir_all(p);
    }
    std::fs::write(out, z.finish()).map_err(|e| format!("写出 xlsx 失败：{e}"))?;

    let label = match delim {
        ',' => "逗号".to_string(),
        ';' => "分号".to_string(),
        '\t' => "Tab".to_string(),
        '|' => "竖线".to_string(),
        ' ' => "空格".to_string(),
        c => format!("「{c}」"),
    };
    Ok(format!(
        "已转换为 Excel（{} 行数据 × {col_count} 列；{}；识别编码 {encoding}，分隔符 {label}）",
        data_rows.len(),
        if has_header { "首行作表头" } else { "首行按普通数据" }
    ))
}

// ── 极简 XML 扫描（只为读 xlsx，不追求通用）──

struct Tag<'a> {
    name: &'a str,
    attrs: &'a str,
    closing: bool,
    self_closing: bool,
    start: usize,
    end: usize,
}

fn next_tag(s: &str, from: usize) -> Option<Tag<'_>> {
    let b = s.as_bytes();
    let mut i = from;
    loop {
        let lt = i + s.get(i..)?.find('<')?;
        if s[lt..].starts_with("<?") {
            i = lt + s[lt..].find("?>")? + 2;
            continue;
        }
        if s[lt..].starts_with("<!--") {
            i = lt + s[lt..].find("-->")? + 3;
            continue;
        }
        if s[lt..].starts_with("<![CDATA[") || s[lt..].starts_with("<!") {
            i = lt + s[lt..].find('>')? + 1;
            continue;
        }
        let gt = lt + s[lt..].find('>')?;
        let closing = b.get(lt + 1) == Some(&b'/');
        let inner_start = if closing { lt + 2 } else { lt + 1 };
        let self_closing = b[gt - 1] == b'/';
        let inner_end = if self_closing { gt - 1 } else { gt };
        let inner = &s[inner_start..inner_end];
        let (name, attrs) = match inner.find(|c: char| c.is_whitespace()) {
            Some(p) => (&inner[..p], &inner[p..]),
            None => (inner, ""),
        };
        // 去掉命名空间前缀（x:c → c）
        let name = name.rsplit(':').next().unwrap_or(name);
        return Some(Tag { name, attrs, closing, self_closing, start: lt, end: gt + 1 });
    }
}

fn attr(attrs: &str, key: &str) -> Option<String> {
    let mut i = 0;
    while let Some(p) = attrs[i..].find(key) {
        let at = i + p;
        let before_ok = at == 0 || attrs.as_bytes()[at - 1].is_ascii_whitespace() || attrs.as_bytes()[at - 1] == b':';
        let rest = &attrs[at + key.len()..];
        let rest_t = rest.trim_start();
        if before_ok && rest_t.starts_with('=') {
            let v = rest_t[1..].trim_start();
            let q = v.chars().next()?;
            if q == '"' || q == '\'' {
                let end = v[1..].find(q)?;
                return Some(xml_unescape(&v[1..1 + end]));
            }
        }
        i = at + key.len();
    }
    None
}

fn xml_unescape(s: &str) -> String {
    if !s.contains('&') {
        return s.to_string();
    }
    let mut o = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(p) = rest.find('&') {
        o.push_str(&rest[..p]);
        let r = &rest[p..];
        if let Some(semi) = r.find(';') {
            let ent = &r[1..semi];
            let ch = match ent {
                "amp" => Some('&'),
                "lt" => Some('<'),
                "gt" => Some('>'),
                "quot" => Some('"'),
                "apos" => Some('\''),
                e if e.starts_with("#x") || e.starts_with("#X") => u32::from_str_radix(&e[2..], 16).ok().and_then(char::from_u32),
                e if e.starts_with('#') => e[1..].parse().ok().and_then(char::from_u32),
                _ => None,
            };
            if let Some(c) = ch {
                o.push(c);
                rest = &r[semi + 1..];
                continue;
            }
        }
        o.push('&');
        rest = &r[1..];
    }
    o.push_str(rest);
    o
}

/// 提取某元素内所有 <t> 的文字（跳过 <rPh> 注音）
fn collect_t(s: &str, from: usize, until_tag: &str) -> (String, usize) {
    let mut out = String::new();
    let mut i = from;
    let mut in_rph = 0;
    while let Some(t) = next_tag(s, i) {
        if t.closing && t.name == until_tag {
            return (out, t.end);
        }
        if t.name == "rPh" && !t.self_closing {
            in_rph += if t.closing { -1 } else { 1 };
        }
        if !t.closing && !t.self_closing && t.name == "t" {
            if let Some(e) = s[t.end..].find("</") {
                if in_rph == 0 {
                    out.push_str(&xml_unescape(&s[t.end..t.end + e]));
                }
                i = t.end + e;
                continue;
            }
        }
        i = t.end;
    }
    (out, s.len())
}

fn col_index(r: &str) -> Option<usize> {
    let mut n = 0usize;
    let mut any = false;
    for c in r.chars() {
        if c.is_ascii_alphabetic() {
            n = n * 26 + (c.to_ascii_uppercase() as usize - 'A' as usize + 1);
            any = true;
        } else {
            break;
        }
    }
    if any {
        Some(n - 1)
    } else {
        None
    }
}

fn is_date_format(code: &str) -> bool {
    // 去掉引号/方括号里的内容与转义字符后，看有没有 y m d h s
    let mut clean = String::new();
    let mut q = false;
    let mut br = false;
    let mut esc = false;
    for c in code.chars() {
        if esc {
            esc = false;
            continue;
        }
        match c {
            '\\' => esc = true,
            '"' => q = !q,
            '[' if !q => br = true,
            ']' if !q => br = false,
            _ if q || br => {}
            _ => clean.push(c.to_ascii_lowercase()),
        }
    }
    if clean.contains("general") {
        return false;
    }
    clean.contains(['y', 'd', 'h', 's']) || (clean.contains('m') && !clean.contains('0') && !clean.contains('#'))
}

fn civil_from_days(z: i64) -> (i64, u32, u32) {
    let z = z + 719468;
    let era = if z >= 0 { z } else { z - 146096 } / 146097;
    let doe = z - era * 146097;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = (doy - (153 * mp + 2) / 5 + 1) as u32;
    let m = if mp < 10 { mp + 3 } else { mp - 9 } as u32;
    (if m <= 2 { y + 1 } else { y }, m, d)
}

fn excel_date(v: f64, date1904: bool, has_date_part: bool) -> String {
    let total_secs = (v * 86400.0).round() as i64;
    let days = total_secs.div_euclid(86400);
    let secs = total_secs.rem_euclid(86400);
    let (hh, mm, ss) = (secs / 3600, secs % 3600 / 60, secs % 60);
    if !has_date_part || (v < 1.0 && v >= 0.0 && !date1904 && days == 0) {
        return format!("{hh:02}:{mm:02}:{ss:02}");
    }
    // 1900 日期系统：序号 60 是不存在的 1900-02-29（Lotus 兼容 bug）
    let unix_days = if date1904 {
        days - 24107
    } else if days < 61 {
        days - 25568
    } else {
        days - 25569
    };
    let (y, m, d) = civil_from_days(unix_days);
    if secs == 0 {
        format!("{y:04}-{m:02}-{d:02}")
    } else {
        format!("{y:04}-{m:02}-{d:02} {hh:02}:{mm:02}:{ss:02}")
    }
}

fn fmt_number(v: f64) -> String {
    if v.fract() == 0.0 && v.abs() < 1e15 {
        format!("{}", v as i64)
    } else {
        format!("{v}")
    }
}

fn csv_quote(s: &str) -> String {
    if s.contains([',', '"', '\r', '\n']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

fn resolve_target(base: &str, target: &str) -> String {
    if let Some(t) = target.strip_prefix('/') {
        return t.to_string();
    }
    let mut parts: Vec<&str> = base.split('/').filter(|s| !s.is_empty()).collect();
    for seg in target.split('/') {
        match seg {
            ".." => {
                parts.pop();
            }
            "." | "" => {}
            s => parts.push(s),
        }
    }
    parts.join("/")
}

pub fn xlsx_to_csv(src: &Path, out: &Path, sheet: Option<&str>, has_header: bool) -> Result<String, String> {
    let data = std::fs::read(src).map_err(|e| format!("读取文件失败：{e}"))?;
    let name = src.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let bad = || format!("无法读取 Excel 文件：{name}（请确认它是 .xlsx / .xlsm 格式，老的 .xls 需要先另存为 .xlsx）");
    if data.starts_with(&[0xD0, 0xCF, 0x11, 0xE0]) {
        return Err(format!("{name} 是老的 .xls 格式（或被加密的 xlsx），请先在 Excel/WPS 里另存为 .xlsx 再转换"));
    }
    let zip = crate::mini_zip::ZipReader::new(&data).map_err(|_| bad())?;
    let wb = String::from_utf8(zip.read("xl/workbook.xml").map_err(|_| bad())?).map_err(|_| bad())?;
    let date1904 = wb.contains("date1904=\"1\"") || wb.contains("date1904=\"true\"");

    // 工作表列表
    let mut sheets: Vec<(String, String)> = Vec::new(); // (名称, r:id)
    let mut i = 0;
    while let Some(t) = next_tag(&wb, i) {
        if !t.closing && t.name == "sheet" {
            let nm = attr(t.attrs, "name").unwrap_or_default();
            let rid = attr(t.attrs, "r:id").or_else(|| attr(t.attrs, "id")).unwrap_or_default();
            sheets.push((nm, rid));
        }
        i = t.end;
    }
    if sheets.is_empty() {
        return Err("这个 Excel 文件里没有任何工作表".into());
    }
    let names: Vec<String> = sheets.iter().map(|s| s.0.clone()).collect();
    let wanted = sheet.map(|s| s.trim().to_string()).unwrap_or_default();
    let chosen = if wanted.is_empty() {
        &sheets[0]
    } else {
        let safe = safe_sheet_title(&wanted).unwrap_or_default();
        sheets
            .iter()
            .find(|s| s.0 == wanted)
            .or_else(|| sheets.iter().find(|s| s.0 == safe))
            .or_else(|| sheets.iter().find(|s| s.0.eq_ignore_ascii_case(&wanted)))
            .ok_or_else(|| format!("找不到工作表「{wanted}」，这个文件里的工作表有：{}", names.join("、")))?
    };
    let rels = String::from_utf8_lossy(&zip.read("xl/_rels/workbook.xml.rels").unwrap_or_default()).to_string();
    let mut target = String::new();
    let mut i = 0;
    while let Some(t) = next_tag(&rels, i) {
        if !t.closing && t.name == "Relationship" && attr(t.attrs, "Id").as_deref() == Some(chosen.1.as_str()) {
            target = attr(t.attrs, "Target").unwrap_or_default();
            break;
        }
        i = t.end;
    }
    let sheet_path = if target.is_empty() { "xl/worksheets/sheet1.xml".to_string() } else { resolve_target("xl", &target) };

    // 共享字符串
    let mut shared: Vec<String> = Vec::new();
    if let Ok(ss) = zip.read("xl/sharedStrings.xml") {
        let ss = String::from_utf8_lossy(&ss).to_string();
        let mut i = 0;
        while let Some(t) = next_tag(&ss, i) {
            if !t.closing && t.name == "si" {
                if t.self_closing {
                    shared.push(String::new());
                    i = t.end;
                    continue;
                }
                let (text, end) = collect_t(&ss, t.end, "si");
                shared.push(text);
                i = end;
                continue;
            }
            i = t.end;
        }
    }

    // 样式：哪些 cellXfs 是日期格式
    let mut date_styles: Vec<(bool, bool)> = Vec::new(); // (是日期/时间, 含日期部分)
    if let Ok(st) = zip.read("xl/styles.xml") {
        let st = String::from_utf8_lossy(&st).to_string();
        let mut custom: HashMap<u32, String> = HashMap::new();
        let mut i = 0;
        let mut in_xfs = false;
        while let Some(t) = next_tag(&st, i) {
            match (t.name, t.closing) {
                ("numFmt", false) => {
                    if let (Some(id), Some(code)) = (attr(t.attrs, "numFmtId"), attr(t.attrs, "formatCode")) {
                        if let Ok(id) = id.parse() {
                            custom.insert(id, code);
                        }
                    }
                }
                ("cellXfs", false) => in_xfs = !t.self_closing,
                ("cellXfs", true) => in_xfs = false,
                ("xf", false) if in_xfs => {
                    let id: u32 = attr(t.attrs, "numFmtId").and_then(|v| v.parse().ok()).unwrap_or(0);
                    let entry = match id {
                        14..=17 | 22 | 27..=36 | 50..=58 => (true, true),
                        18..=21 | 45..=47 => (true, false),
                        _ => match custom.get(&id) {
                            Some(code) if is_date_format(code) => {
                                let c = code.to_lowercase();
                                (true, c.contains('y') || c.contains('d') || (c.contains('m') && !c.contains('h') && !c.contains('s')))
                            }
                            _ => (false, false),
                        },
                    };
                    date_styles.push(entry);
                }
                _ => {}
            }
            i = t.end;
        }
    }

    let sx = zip.read(&sheet_path).map_err(|_| bad())?;
    let sx = String::from_utf8_lossy(&sx).to_string();
    let mut out_text = String::from("\u{FEFF}");
    let mut row_count = 0usize;
    let mut cur_row = 0usize; // 已写出的行号
    let mut i = 0;
    let mut any_content = false;
    while let Some(t) = next_tag(&sx, i) {
        if t.closing || t.name != "row" {
            i = t.end;
            continue;
        }
        let rnum: usize = attr(t.attrs, "r").and_then(|v| v.parse().ok()).unwrap_or(cur_row + 1);
        // 补空行
        while cur_row + 1 < rnum {
            cur_row += 1;
            row_count += 1;
            out_text.push_str("\r\n");
        }
        if row_count > MAX_XLSX_ROWS {
            return Err(format!("工作表「{}」行数超过 {MAX_XLSX_ROWS} 行，无法导出为 CSV", chosen.0));
        }
        let mut cells: Vec<String> = Vec::new();
        let mut j = t.end;
        if !t.self_closing {
            let mut next_col = 0usize;
            while let Some(c) = next_tag(&sx, j) {
                if c.closing && c.name == "row" {
                    j = c.end;
                    break;
                }
                if c.closing || c.name != "c" {
                    j = c.end;
                    continue;
                }
                let col = attr(c.attrs, "r").and_then(|r| col_index(&r)).unwrap_or(next_col);
                next_col = col + 1;
                let ty = attr(c.attrs, "t").unwrap_or_else(|| "n".into());
                let style: usize = attr(c.attrs, "s").and_then(|v| v.parse().ok()).unwrap_or(0);
                let mut value = String::new();
                let mut raw_v: Option<String> = None;
                let mut end = c.end;
                if !c.self_closing {
                    // 在 </c> 之前找 <v> 或 <is>
                    let close = sx[c.end..].find("</c>").map(|p| c.end + p).unwrap_or(sx.len());
                    let body = &sx[c.end..close];
                    if ty == "inlineStr" {
                        let (tx, _) = collect_t(body, 0, "is");
                        value = tx;
                    } else if let Some(vs) = body.find("<v") {
                        if let Some(gt) = body[vs..].find('>') {
                            let st = vs + gt + 1;
                            if body.as_bytes()[st - 2] != b'/' {
                                if let Some(ve) = body[st..].find("</v>") {
                                    raw_v = Some(xml_unescape(&body[st..st + ve]));
                                }
                            }
                        }
                    }
                    end = (close + 4).min(sx.len());
                }
                if let Some(v) = raw_v {
                    value = match ty.as_str() {
                        "s" => v.trim().parse::<usize>().ok().and_then(|k| shared.get(k).cloned()).unwrap_or_default(),
                        "b" => if v.trim() == "1" { "TRUE".into() } else { "FALSE".into() },
                        "str" | "e" | "d" => v,
                        _ => match v.trim().parse::<f64>() {
                            Ok(f) => match date_styles.get(style) {
                                Some((true, has_date)) => excel_date(f, date1904, *has_date),
                                _ => fmt_number(f),
                            },
                            Err(_) => v,
                        },
                    };
                }
                if col < MAX_COLUMNS {
                    if cells.len() <= col {
                        cells.resize(col + 1, String::new());
                    }
                    cells[col] = value;
                }
                j = end;
            }
        }
        while cells.last().map(|s| s.is_empty()).unwrap_or(false) {
            cells.pop();
        }
        if !cells.is_empty() {
            any_content = true;
        }
        let line: Vec<String> = cells.iter().map(|c| csv_quote(c)).collect();
        out_text.push_str(&line.join(","));
        out_text.push_str("\r\n");
        cur_row = rnum;
        row_count += 1;
        i = j;
    }
    if !any_content {
        return Err(format!("工作表「{}」里没有任何内容", chosen.0));
    }
    // 去掉末尾多余的空行（openpyxl 也只输出到最后一个有数据的行）
    while out_text.ends_with("\r\n\r\n") {
        out_text.truncate(out_text.len() - 2);
        row_count -= 1;
    }
    if let Some(p) = out.parent() {
        let _ = std::fs::create_dir_all(p);
    }
    std::fs::write(out, out_text.as_bytes()).map_err(|e| format!("写出 CSV 失败：{e}"))?;
    Ok(format!(
        "已转换为 CSV（工作表「{}」，{row_count} 行，{}，UTF-8 带 BOM，Excel 打开不乱码）",
        chosen.0,
        if has_header { "首行作表头" } else { "首行按普通数据" }
    ))
}

pub fn resolve_direction(path: &Path, direction: &str) -> Result<&'static str, String> {
    let raw = direction.trim().to_lowercase();
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    match raw.as_str() {
        "" | "auto" | "自动" => match ext.as_str() {
            "csv" | "tsv" | "txt" => Ok("to-xlsx"),
            "xlsx" | "xlsm" => Ok("to-csv"),
            _ => Err(format!(
                "无法根据扩展名判断转换方向：{}，请明确选择「转成 Excel」或「转成 CSV」",
                if ext.is_empty() { "（没有扩展名）".to_string() } else { format!(".{ext}") }
            )),
        },
        "to-xlsx" | "to_excel" | "to-excel" => Ok("to-xlsx"),
        "to-csv" | "to_csv" => Ok("to-csv"),
        _ => Err(format!("无法识别的转换方向：「{direction}」，只支持 auto / to-xlsx / to-csv")),
    }
}

// ═════════════════════════════ markdown → HTML ═════════════════════════════

fn html_esc(s: &str) -> String {
    let mut o = String::with_capacity(s.len() + 8);
    for c in s.chars() {
        match c {
            '&' => o.push_str("&amp;"),
            '<' => o.push_str("&lt;"),
            '>' => o.push_str("&gt;"),
            '"' => o.push_str("&quot;"),
            c => o.push(c),
        }
    }
    o
}

fn safe_url(u: &str) -> Option<String> {
    let t = u.trim().trim_start_matches('<').trim_end_matches('>');
    let low = t.to_lowercase();
    if low.starts_with("javascript:") || low.starts_with("vbscript:") || low.starts_with("file:") {
        return None;
    }
    Some(html_esc(t))
}

/// 行内：代码 `x`、粗体 ** / __、斜体 * / _、删除线 ~~、链接 [t](u)、图片 ![a](u)、自动链接 <http..>、转义 \*
pub fn md_inline(s: &str) -> String {
    let chars: Vec<char> = s.chars().collect();
    let mut out = String::new();
    let mut i = 0;
    let n = chars.len();
    let find = |from: usize, pat: &[char]| -> Option<usize> {
        let mut k = from;
        while k + pat.len() <= n {
            if chars[k] == '\\' {
                k += 2;
                continue;
            }
            if chars[k..k + pat.len()] == *pat {
                return Some(k);
            }
            k += 1;
        }
        None
    };
    let collect = |a: usize, b: usize| -> String { chars[a..b].iter().collect() };
    while i < n {
        let c = chars[i];
        // 转义
        if c == '\\' && i + 1 < n && "\\`*_{}[]()#+-.!|~<>\"'".contains(chars[i + 1]) {
            out.push_str(&html_esc(&chars[i + 1].to_string()));
            i += 2;
            continue;
        }
        // 行内代码（支持多反引号）
        if c == '`' {
            let mut ticks = 0;
            while i + ticks < n && chars[i + ticks] == '`' {
                ticks += 1;
            }
            let pat: Vec<char> = std::iter::repeat('`').take(ticks).collect();
            let mut k = i + ticks;
            let mut found = None;
            while k + ticks <= n {
                if chars[k..k + ticks] == pat[..] && (k + ticks == n || chars[k + ticks] != '`') {
                    found = Some(k);
                    break;
                }
                k += 1;
            }
            if let Some(e) = found {
                let code = collect(i + ticks, e);
                let code = if code.starts_with(' ') && code.ends_with(' ') && code.trim() != "" { code[1..code.len() - 1].to_string() } else { code };
                out.push_str(&format!("<code>{}</code>", html_esc(&code)));
                i = e + ticks;
                continue;
            }
            out.push_str(&"`".repeat(ticks));
            i += ticks;
            continue;
        }
        // 图片 / 链接
        if (c == '!' && i + 1 < n && chars[i + 1] == '[') || c == '[' {
            let img = c == '!';
            let lb = if img { i + 1 } else { i };
            // 找匹配的 ]
            let mut depth = 0;
            let mut k = lb;
            let mut rb = None;
            while k < n {
                match chars[k] {
                    '\\' => k += 1,
                    '[' => depth += 1,
                    ']' => {
                        depth -= 1;
                        if depth == 0 {
                            rb = Some(k);
                            break;
                        }
                    }
                    _ => {}
                }
                k += 1;
            }
            if let Some(rb) = rb {
                if rb + 1 < n && chars[rb + 1] == '(' {
                    let mut depth = 0;
                    let mut k = rb + 1;
                    let mut rp = None;
                    while k < n {
                        match chars[k] {
                            '(' => depth += 1,
                            ')' => {
                                depth -= 1;
                                if depth == 0 {
                                    rp = Some(k);
                                    break;
                                }
                            }
                            _ => {}
                        }
                        k += 1;
                    }
                    if let Some(rp) = rp {
                        let label = collect(lb + 1, rb);
                        let inner = collect(rb + 2, rp);
                        let url = inner.split_whitespace().next().unwrap_or("").to_string();
                        if img {
                            match safe_url(&url) {
                                Some(u) if u.starts_with("http") || u.starts_with("data:image") => {
                                    out.push_str(&format!("<img src=\"{u}\" alt=\"{}\">", html_esc(&label)))
                                }
                                _ => out.push_str(&format!("<span class=\"img-alt\">[{}]</span>", html_esc(&label))),
                            }
                        } else {
                            match safe_url(&url) {
                                Some(u) => out.push_str(&format!("<a href=\"{u}\">{}</a>", md_inline(&label))),
                                None => out.push_str(&md_inline(&label)),
                            }
                        }
                        i = rp + 1;
                        continue;
                    }
                }
            }
        }
        // 自动链接 <https://...>
        if c == '<' {
            if let Some(e) = find(i + 1, &['>']) {
                let inner = collect(i + 1, e);
                if (inner.starts_with("http://") || inner.starts_with("https://") || inner.starts_with("mailto:")) && !inner.contains(' ') {
                    let u = html_esc(&inner);
                    out.push_str(&format!("<a href=\"{u}\">{u}</a>"));
                    i = e + 1;
                    continue;
                }
            }
        }
        // 删除线
        if c == '~' && i + 1 < n && chars[i + 1] == '~' {
            if let Some(e) = find(i + 2, &['~', '~']) {
                if e > i + 2 {
                    out.push_str(&format!("<del>{}</del>", md_inline(&collect(i + 2, e))));
                    i = e + 2;
                    continue;
                }
            }
        }
        // 粗体 / 斜体
        if c == '*' || c == '_' {
            let intraword = c == '_' && i > 0 && chars[i - 1].is_alphanumeric();
            if !intraword {
                if i + 2 < n && chars[i + 1] == c && chars[i + 2] == c {
                    if let Some(e) = find(i + 3, &[c, c, c]) {
                        if e > i + 3 && !chars[i + 3].is_whitespace() {
                            out.push_str(&format!("<strong><em>{}</em></strong>", md_inline(&collect(i + 3, e))));
                            i = e + 3;
                            continue;
                        }
                    }
                }
                if i + 1 < n && chars[i + 1] == c {
                    if let Some(e) = find(i + 2, &[c, c]) {
                        if e > i + 2 && !chars[i + 2].is_whitespace() {
                            out.push_str(&format!("<strong>{}</strong>", md_inline(&collect(i + 2, e))));
                            i = e + 2;
                            continue;
                        }
                    }
                }
                if i + 1 < n && !chars[i + 1].is_whitespace() && chars[i + 1] != c {
                    let mut k = i + 1;
                    let mut end = None;
                    while k < n {
                        if chars[k] == '\\' {
                            k += 2;
                            continue;
                        }
                        if chars[k] == c && !chars[k - 1].is_whitespace() && (k + 1 >= n || chars[k + 1] != c) {
                            if c == '_' && k + 1 < n && chars[k + 1].is_alphanumeric() {
                                k += 1;
                                continue;
                            }
                            end = Some(k);
                            break;
                        }
                        if chars[k] == c && k + 1 < n && chars[k + 1] == c {
                            k += 2;
                            continue;
                        }
                        k += 1;
                    }
                    if let Some(e) = end {
                        out.push_str(&format!("<em>{}</em>", md_inline(&collect(i + 1, e))));
                        i = e + 1;
                        continue;
                    }
                }
            }
        }
        // 裸网址
        if (c == 'h') && (s_starts(&chars, i, "http://") || s_starts(&chars, i, "https://")) && (i == 0 || !chars[i - 1].is_alphanumeric()) {
            let mut k = i;
            while k < n && !chars[k].is_whitespace() && !"<>\"'）】」，。".contains(chars[k]) {
                k += 1;
            }
            while k > i && ".,;:!?)".contains(chars[k - 1]) {
                k -= 1;
            }
            let u = html_esc(&collect(i, k));
            out.push_str(&format!("<a href=\"{u}\">{u}</a>"));
            i = k;
            continue;
        }
        out.push_str(&html_esc(&c.to_string()));
        i += 1;
    }
    out
}

fn s_starts(chars: &[char], at: usize, pat: &str) -> bool {
    let p: Vec<char> = pat.chars().collect();
    at + p.len() <= chars.len() && chars[at..at + p.len()] == p[..]
}

fn indent_of(line: &str) -> usize {
    let mut n = 0;
    for c in line.chars() {
        match c {
            ' ' => n += 1,
            '\t' => n += 4 - n % 4,
            _ => break,
        }
    }
    n
}

fn strip_indent(line: &str, cols: usize) -> String {
    let mut n = 0;
    let mut idx = 0;
    for (i, c) in line.char_indices() {
        if n >= cols {
            idx = i;
            break;
        }
        match c {
            ' ' => n += 1,
            '\t' => n += 4 - n % 4,
            _ => {
                idx = i;
                break;
            }
        }
        idx = i + c.len_utf8();
    }
    line[idx..].to_string()
}

fn is_hr(t: &str) -> bool {
    let s: String = t.chars().filter(|c| !c.is_whitespace()).collect();
    s.len() >= 3 && (s.chars().all(|c| c == '-') || s.chars().all(|c| c == '*') || s.chars().all(|c| c == '_'))
}

/// 列表标记：返回 (是否有序, 起始编号, 内容起始列)
fn list_marker(line: &str) -> Option<(bool, u64, usize)> {
    let ind = indent_of(line);
    let t = line.trim_start();
    let b = t.as_bytes();
    if b.is_empty() {
        return None;
    }
    if (b[0] == b'-' || b[0] == b'*' || b[0] == b'+') && (b.len() == 1 || b[1] == b' ' || b[1] == b'\t') {
        if is_hr(t) {
            return None;
        }
        let after = t[1..].chars().take_while(|c| *c == ' ').count().clamp(1, 4);
        return Some((false, 1, ind + 1 + after));
    }
    let digits = t.bytes().take_while(|c| c.is_ascii_digit()).count();
    if (1..=9).contains(&digits) && b.len() > digits && (b[digits] == b'.' || b[digits] == b')') && (b.len() == digits + 1 || b[digits + 1] == b' ') {
        let start = t[..digits].parse().unwrap_or(1);
        let after = t[digits + 1..].chars().take_while(|c| *c == ' ').count().clamp(1, 4);
        return Some((true, start, ind + digits + 1 + after));
    }
    None
}

fn split_row(line: &str) -> Vec<String> {
    let t = line.trim();
    let t = t.strip_prefix('|').unwrap_or(t);
    let t = t.strip_suffix('|').unwrap_or(t);
    let mut cells = Vec::new();
    let mut cur = String::new();
    let mut in_code = false;
    let mut chars = t.chars().peekable();
    while let Some(c) = chars.next() {
        match c {
            '\\' if chars.peek() == Some(&'|') => {
                cur.push('|');
                chars.next();
            }
            '`' => {
                in_code = !in_code;
                cur.push(c);
            }
            '|' if !in_code => cells.push(std::mem::take(&mut cur).trim().to_string()),
            _ => cur.push(c),
        }
    }
    cells.push(cur.trim().to_string());
    cells
}

fn is_table_sep(line: &str) -> Option<Vec<&'static str>> {
    if !line.contains('-') {
        return None;
    }
    let cells = split_row(line);
    let mut al = Vec::new();
    for c in &cells {
        let c = c.trim();
        if c.is_empty() || !c.chars().all(|x| x == '-' || x == ':') || !c.contains('-') {
            return None;
        }
        al.push(match (c.starts_with(':'), c.ends_with(':')) {
            (true, true) => "center",
            (false, true) => "right",
            (true, false) => "left",
            _ => "",
        });
    }
    Some(al)
}

fn starts_block(line: &str) -> bool {
    let t = line.trim_start();
    t.starts_with('#') && t.trim_start_matches('#').starts_with([' ', '\t']) && t.chars().take_while(|c| *c == '#').count() <= 6
        || t.starts_with("```")
        || t.starts_with("~~~")
        || t.starts_with('>')
        || is_hr(t)
        || list_marker(line).is_some()
}

pub fn md_blocks(lines: &[String]) -> String {
    let mut out = String::new();
    let mut i = 0;
    let n = lines.len();
    while i < n {
        let line = &lines[i];
        let t = line.trim();
        if t.is_empty() {
            i += 1;
            continue;
        }
        let ind = indent_of(line);
        // 围栏代码块
        let lt = line.trim_start();
        if lt.starts_with("```") || lt.starts_with("~~~") {
            let fence_ch = lt.chars().next().unwrap();
            let flen = lt.chars().take_while(|c| *c == fence_ch).count();
            let lang = lt[flen..].trim();
            let mut body = Vec::new();
            i += 1;
            while i < n {
                let l = lines[i].trim_start();
                if l.starts_with(&fence_ch.to_string().repeat(flen)) && l.trim_start_matches(fence_ch).trim().is_empty() {
                    i += 1;
                    break;
                }
                body.push(strip_indent(&lines[i], ind));
                i += 1;
            }
            let cls = if lang.is_empty() { String::new() } else { format!(" class=\"lang-{}\"", html_esc(lang.split_whitespace().next().unwrap_or(""))) };
            out.push_str(&format!("<pre><code{cls}>{}</code></pre>\n", html_esc(&body.join("\n"))));
            continue;
        }
        // 缩进代码块
        if ind >= 4 {
            let mut body = Vec::new();
            while i < n && (indent_of(&lines[i]) >= 4 || lines[i].trim().is_empty()) {
                body.push(strip_indent(&lines[i], 4));
                i += 1;
            }
            while body.last().map(|l: &String| l.trim().is_empty()).unwrap_or(false) {
                body.pop();
            }
            out.push_str(&format!("<pre><code>{}</code></pre>\n", html_esc(&body.join("\n"))));
            continue;
        }
        // 标题
        if lt.starts_with('#') {
            let level = lt.chars().take_while(|c| *c == '#').count();
            let rest = &lt[level..];
            if level <= 6 && (rest.is_empty() || rest.starts_with([' ', '\t'])) {
                let mut text = rest.trim().to_string();
                // 去掉结尾的 ###
                let trimmed = text.trim_end_matches('#');
                if trimmed.ends_with(' ') || trimmed.is_empty() {
                    text = trimmed.trim().to_string();
                }
                out.push_str(&format!("<h{level}>{}</h{level}>\n", md_inline(&text)));
                i += 1;
                continue;
            }
        }
        // 分割线
        if is_hr(t) {
            out.push_str("<hr>\n");
            i += 1;
            continue;
        }
        // 引用
        if lt.starts_with('>') {
            let mut inner = Vec::new();
            while i < n {
                let l = lines[i].trim_start();
                if let Some(r) = l.strip_prefix('>') {
                    inner.push(r.strip_prefix(' ').unwrap_or(r).to_string());
                } else if !l.is_empty() && !inner.last().map(|x: &String| x.trim().is_empty()).unwrap_or(true) && !starts_block(&lines[i]) {
                    inner.push(l.to_string()); // 懒惰续行
                } else {
                    break;
                }
                i += 1;
            }
            out.push_str(&format!("<blockquote>\n{}</blockquote>\n", md_blocks(&inner)));
            continue;
        }
        // 列表
        if let Some((ordered, start, _)) = list_marker(line) {
            let base = ind;
            let mut items: Vec<Vec<String>> = Vec::new();
            let mut loose = false;
            while i < n {
                let l = &lines[i];
                match list_marker(l) {
                    Some((o, _, content_col)) if indent_of(l) == base || (indent_of(l) < base + 2 && indent_of(l) >= base) => {
                        if o != ordered {
                            break;
                        }
                        let tl = l.trim_start();
                        let first = tl.get(content_col.saturating_sub(indent_of(l)).min(tl.len())..).unwrap_or("").trim_start().to_string();
                        let mut item = vec![first];
                        i += 1;
                        let mut blank_run = false;
                        while i < n {
                            let x = &lines[i];
                            if x.trim().is_empty() {
                                blank_run = true;
                                item.push(String::new());
                                i += 1;
                                continue;
                            }
                            let xi = indent_of(x);
                            if xi >= content_col.min(base + 2).max(base + 1) && !(xi == base && list_marker(x).is_some()) {
                                if blank_run {
                                    loose = true;
                                }
                                blank_run = false;
                                item.push(strip_indent(x, content_col.min(xi)));
                                i += 1;
                                continue;
                            }
                            if !blank_run && !starts_block(x) && xi < content_col {
                                item.push(x.trim_start().to_string()); // 懒惰续行
                                i += 1;
                                continue;
                            }
                            break;
                        }
                        while item.last().map(|s| s.is_empty()).unwrap_or(false) {
                            item.pop();
                            if i < n && list_marker(&lines[i]).map(|m| m.0 == ordered).unwrap_or(false) && indent_of(&lines[i]) == base {
                                loose = true;
                            }
                        }
                        items.push(item);
                    }
                    _ => break,
                }
            }
            let tag = if ordered { "ol" } else { "ul" };
            let start_attr = if ordered && start != 1 { format!(" start=\"{start}\"") } else { String::new() };
            out.push_str(&format!("<{tag}{start_attr}{}>\n", if loose { " class=\"loose\"" } else { "" }));
            for mut item in items {
                // 任务列表
                let mut prefix = String::new();
                if !ordered {
                    if let Some(f) = item.first_mut() {
                        let low = f.to_lowercase();
                        if low.starts_with("[ ] ") || low.starts_with("[x] ") {
                            let checked = low.starts_with("[x]");
                            prefix = format!("<span class=\"task\">{}</span>", if checked { "☑" } else { "☐" });
                            *f = f[4..].to_string();
                        }
                    }
                }
                let inner = md_blocks(&item);
                let inner = if !loose {
                    // 紧凑列表：首段不包 <p>
                    let s = inner.trim_end().to_string();
                    if let Some(rest) = s.strip_prefix("<p>") {
                        match rest.find("</p>") {
                            Some(p) => format!("{}{}", &rest[..p], &rest[p + 4..]),
                            None => s,
                        }
                    } else {
                        s
                    }
                } else {
                    inner
                };
                out.push_str(&format!("<li>{prefix}{inner}</li>\n"));
            }
            out.push_str(&format!("</{tag}>\n"));
            continue;
        }
        // 表格
        if line.contains('|') && i + 1 < n {
            if let Some(aligns) = is_table_sep(&lines[i + 1]) {
                let head = split_row(line);
                if head.len() == aligns.len() || (head.len() > 0 && aligns.len() > 0) {
                    let cols = aligns.len().max(head.len());
                    let al = |c: usize| -> String {
                        match aligns.get(c).copied().unwrap_or("") {
                            "" => String::new(),
                            a => format!(" style=\"text-align:{a}\""),
                        }
                    };
                    let mut h = String::from("<table>\n<thead><tr>");
                    for c in 0..cols {
                        h.push_str(&format!("<th{}>{}</th>", al(c), md_inline(head.get(c).map(|s| s.as_str()).unwrap_or(""))));
                    }
                    h.push_str("</tr></thead>\n<tbody>\n");
                    i += 2;
                    while i < n && !lines[i].trim().is_empty() && (lines[i].contains('|') || !starts_block(&lines[i])) {
                        if starts_block(&lines[i]) && !lines[i].contains('|') {
                            break;
                        }
                        let row = split_row(&lines[i]);
                        h.push_str("<tr>");
                        for c in 0..cols {
                            h.push_str(&format!("<td{}>{}</td>", al(c), md_inline(row.get(c).map(|s| s.as_str()).unwrap_or(""))));
                        }
                        h.push_str("</tr>\n");
                        i += 1;
                    }
                    h.push_str("</tbody>\n</table>\n");
                    out.push_str(&h);
                    continue;
                }
            }
        }
        // 段落（含 setext 标题）
        let mut para: Vec<String> = Vec::new();
        while i < n {
            let l = &lines[i];
            if l.trim().is_empty() {
                break;
            }
            if !para.is_empty() {
                let tt = l.trim();
                if !tt.is_empty() && tt.chars().all(|c| c == '=') {
                    out.push_str(&format!("<h1>{}</h1>\n", md_inline(&para.join(" ").trim().to_string())));
                    para.clear();
                    i += 1;
                    break;
                }
                if !tt.is_empty() && tt.chars().all(|c| c == '-') && tt.len() >= 2 {
                    out.push_str(&format!("<h2>{}</h2>\n", md_inline(&para.join(" ").trim().to_string())));
                    para.clear();
                    i += 1;
                    break;
                }
                if starts_block(l) || (l.contains('|') && i + 1 < n && is_table_sep(&lines[i + 1]).is_some()) {
                    break;
                }
            }
            para.push(l.clone());
            i += 1;
        }
        if !para.is_empty() {
            let mut html = String::new();
            let last = para.len() - 1;
            for (k, l) in para.iter().enumerate() {
                let hard = k != last && (l.ends_with("  ") || l.ends_with('\\'));
                let content = if l.ends_with('\\') && k != last { &l[..l.len() - 1] } else { l.as_str() };
                html.push_str(&md_inline(content.trim()));
                if k != last {
                    html.push_str(if hard { "<br>\n" } else { "\n" });
                }
            }
            out.push_str(&format!("<p>{html}</p>\n"));
        }
    }
    out
}

pub fn markdown_to_html(md: &str, title: &str, page_size: &str, font_pt: f64) -> String {
    let md = md.replace("\r\n", "\n").replace('\r', "\n");
    let lines: Vec<String> = md.split('\n').map(|s| s.to_string()).collect();
    let body = md_blocks(&lines);
    let size = if page_size == "letter" { "letter" } else { "A4" };
    format!(
        r#"<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>{title}</title>
<style>
@page {{ size: {size}; margin: 18mm 18mm 20mm 18mm;
  @bottom-center {{ content: counter(page) " / " counter(pages); font-size: 9pt; color: #888; font-family: "Microsoft YaHei", sans-serif; }} }}
html {{ -webkit-print-color-adjust: exact; print-color-adjust: exact; }}
body {{ font-family: "Microsoft YaHei", "微软雅黑", "PingFang SC", "Noto Sans CJK SC", "Segoe UI", sans-serif;
  font-size: {font_pt}pt; line-height: 1.65; color: #1a1a1f; margin: 0; word-wrap: break-word; overflow-wrap: anywhere; }}
h1,h2,h3,h4,h5,h6 {{ line-height: 1.35; margin: 1.1em 0 0.5em; font-weight: 700; page-break-after: avoid; break-after: avoid; }}
h1 {{ font-size: 1.9em; border-bottom: 1px solid #ddd; padding-bottom: .25em; }}
h2 {{ font-size: 1.55em; border-bottom: 1px solid #eee; padding-bottom: .2em; }}
h3 {{ font-size: 1.32em; }} h4 {{ font-size: 1.16em; }} h5 {{ font-size: 1.05em; }} h6 {{ font-size: 1em; color: #555; }}
body > :first-child {{ margin-top: 0; }}
p {{ margin: 0 0 .8em; }}
a {{ color: #0d4dbf; text-decoration: none; }}
code {{ font-family: Consolas, "Cascadia Mono", "Microsoft YaHei", monospace; font-size: .9em; color: #9e1f57; background: #f3f4f6; padding: .1em .35em; border-radius: 3px; }}
pre {{ background: #f4f4f6; border-radius: 5px; padding: .8em 1em; white-space: pre-wrap; word-break: break-all; line-height: 1.45; }}
pre code {{ color: #29292f; background: none; padding: 0; font-size: .88em; }}
blockquote {{ margin: 0 0 .8em; padding: .4em 1em; border-left: 4px solid #b8bac7; background: #f4f4f5; color: #444; }}
blockquote > :last-child {{ margin-bottom: 0; }}
ul, ol {{ margin: 0 0 .8em; padding-left: 1.8em; }}
li {{ margin: .15em 0; }} li > p {{ margin: 0 0 .3em; }} li > ul, li > ol {{ margin-bottom: 0; }}
.task {{ margin-right: .35em; }}
hr {{ border: none; border-top: 1px solid #c0c0c6; margin: 1.2em 0; }}
table {{ border-collapse: collapse; margin: 0 0 1em; width: auto; max-width: 100%; font-size: .95em; }}
thead {{ display: table-header-group; }}
tr {{ page-break-inside: avoid; break-inside: avoid; }}
th, td {{ border: 1px solid #b8b8c2; padding: .35em .6em; vertical-align: top; }}
th {{ background: #eef0f6; font-weight: 700; }}
img {{ max-width: 100%; }}
.img-alt {{ color: #888; }}
</style></head><body>
{body}</body></html>"#,
        title = html_esc(title),
        size = size,
        font_pt = font_pt,
        body = body
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn page_list() {
        assert_eq!(parse_page_list("3,1-2", 4).unwrap(), vec![3, 1, 2]);
        assert_eq!(parse_page_list("4-2", 4).unwrap(), vec![4, 3, 2]);
        assert!(parse_page_list("5", 4).is_err());
    }

    #[test]
    fn cells() {
        assert!(matches!(to_cell("007"), Cell::Text(_)));
        assert!(matches!(to_cell("1234567890123456"), Cell::Text(_)));
        assert!(matches!(to_cell("42"), Cell::Num(ref s) if s == "42"));
        assert!(matches!(to_cell("-3.5"), Cell::Num(_)));
        assert!(matches!(to_cell("1e5"), Cell::Num(_)));
        assert!(matches!(to_cell("=1+1"), Cell::Text(_)));
        assert!(matches!(to_cell("12abc"), Cell::Text(_)));
        assert!(matches!(to_cell("0.5"), Cell::Num(_)));
    }

    #[test]
    fn csv_parse() {
        let r = parse_csv("a,\"b,c\"\r\n\"x\"\"y\",\"多\n行\"\n", ',', 100).unwrap();
        assert_eq!(r, vec![vec!["a", "b,c"], vec!["x\"y", "多\n行"]]);
        assert_eq!(detect_delimiter("a;b;c\n1;2;3\n"), ';');
        assert_eq!(detect_delimiter("a\tb\n1\t2\n"), '\t');
    }

    #[test]
    fn dates() {
        assert_eq!(excel_date(45292.0, false, true), "2024-01-01");
        assert_eq!(excel_date(45292.5, false, true), "2024-01-01 12:00:00");
        assert_eq!(excel_date(0.25, false, false), "06:00:00");
        assert_eq!(excel_date(1.0, false, true), "1900-01-01");
        assert_eq!(excel_date(61.0, false, true), "1900-03-01");
        assert_eq!(excel_date(0.0, true, true), "1904-01-01");
    }

    #[test]
    fn markdown() {
        let h = markdown_to_html("# 标题\n\n段落 **粗** *斜* `code` [链接](https://a.b)\n\n- a\n- b\n  - c\n\n1. x\n2. y\n\n| A | B |\n|---|:-:|\n| 1 | 2 |\n\n> 引用\n\n```rust\nfn main() {}\n```\n\n<script>alert(1)</script>\n", "t", "a4", 12.0);
        assert!(h.contains("<h1>标题</h1>"));
        assert!(h.contains("<strong>粗</strong>"));
        assert!(h.contains("<em>斜</em>"));
        assert!(h.contains("<code>code</code>"));
        assert!(h.contains("<a href=\"https://a.b\">链接</a>"));
        assert!(h.contains("<li>b\n<ul>") || h.contains("<li>b<ul>"), "{h}");
        assert!(h.contains("<ol>"));
        assert!(h.contains("<th style=\"text-align:center\">B</th>"));
        assert!(h.contains("<blockquote>"));
        assert!(h.contains("class=\"lang-rust\""));
        assert!(h.contains("&lt;script&gt;"));
        assert!(!h.contains("<script>"));
    }
}
