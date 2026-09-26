//! PDF 水印 / 页码 / 提取图片 / 压缩 / 扫描件增清 / 改文字与插图：Rust 原生实现（去 Python 化）。
//!
//! 原来走 Python worker（services/worker/app/tools/pdf_tools.py, pdf_enhance.py, pdf_content_edit.py），
//! 现迁移至纯 Rust，基于 lopdf、pdf_render 与 image crate，免除 53MB 的 pymupdf 及 Python 依赖。

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use lopdf::{dictionary, Document, Object, ObjectId, Dictionary, Stream, StringFormat};
use lopdf::content::{Content, Operation};
use serde_json::{json, Map, Value};

use crate::matting_native::{number, results_path, text};

pub fn supported(tool: &str) -> bool {
    matches!(
        tool,
        "pdf-watermark"
            | "pdf-page-numbers"
            | "pdf-extract-images"
            | "pdf-compress"
            | "pdf-enhance"
            | "pdf-content-edit"
    )
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
    fn progress(&self, pct: u32, msg: &str) {
        crate::matting_native::progress(self.app, self.id, pct, msg);
    }
}

fn done(path: &Path, filename: &str, mime: &str, message: String) -> Value {
    json!({
        "path": path.to_string_lossy(),
        "filename": filename,
        "mime": mime,
        "message": message,
    })
}

fn obj_num(val: &Object) -> f64 {
    match val {
        Object::Integer(n) => *n as f64,
        Object::Real(n) => *n as f64,
        _ => 0.0,
    }
}

// ───────────────────────── 入口：建任务 + 后台线程 ─────────────────────────

pub fn start(app: &tauri::AppHandle, tool: &str, args: &Value) -> Result<Value, String> {
    let tool = tool.to_string();
    let mut payload = args.clone();

    let inputs: Vec<(PathBuf, String)> = if let Some(files) = args.get("__files").and_then(Value::as_array) {
        if files.is_empty() || files.len() > 100 {
            return Err("每批请选择 1–100 个文件 / Select 1–100 files".into());
        }
        let saved = crate::jobs::save_request_uploads(app, &crate::jobs::new_job_id_public(), files)?;
        saved
            .iter()
            .map(|s| {
                let p = s.get("path").and_then(Value::as_str).ok_or("缺少上传的 PDF 文件")?;
                let n = s.get("name").and_then(Value::as_str).unwrap_or("document.pdf").to_string();
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
                let n = p.file_name().map(|x| x.to_string_lossy().to_string()).unwrap_or_else(|| "document.pdf".into());
                (p, n)
            })
            .collect()
    };

    if inputs.is_empty() {
        return Err("请选择 PDF 文件 / Select a PDF file".into());
    }
    for (p, _) in &inputs {
        let m = std::fs::metadata(p).map_err(|e| format!("找不到文件：{e}"))?;
        if !m.is_file() || m.len() == 0 {
            return Err("PDF 文件为空或不存在 / PDF file is empty or missing".into());
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
        .name("native-pdf".into())
        .spawn(move || {
            crate::matting_native::progress(&app_bg, &id_bg, 5, "正在读取 PDF…");
            let ctx = Ctx { app: &app_bg, id: &id_bg };
            let result = match tool.as_str() {
                "pdf-extract-images" => extract_images(&ctx, &inputs[0], &payload),
                "pdf-page-numbers" => add_page_numbers(&ctx, &inputs[0], &payload),
                "pdf-watermark" => add_watermark(&ctx, &inputs[0], &payload),
                "pdf-compress" => compress(&ctx, &inputs[0], &payload),
                "pdf-enhance" => enhance_pdf(&ctx, &inputs[0], &payload),
                "pdf-content-edit" => content_edit(&ctx, &inputs[0], &payload),
                other => Err(format!("不支持的 PDF 原生工具：{other}")),
            };

            if ctx.cancelled() {
                return;
            }

            let mut m = Map::new();
            match result {
                Ok(r) => {
                    m.insert("status".into(), json!("completed"));
                    m.insert("progress".into(), json!(100));
                    m.insert("message".into(), r.get("message").cloned().unwrap_or(json!("PDF 处理完成")));
                    m.insert("resultPath".into(), r.get("path").cloned().unwrap_or(json!("")));
                    m.insert("resultFilename".into(), r.get("filename").cloned().unwrap_or(json!("")));
                    m.insert("resultMimeType".into(), r.get("mime").cloned().unwrap_or(json!("application/pdf")));
                    if let Ok(meta) = std::fs::metadata(r.get("path").and_then(Value::as_str).unwrap_or("")) {
                        m.insert("resultBytes".into(), json!(meta.len()));
                    }
                    m.insert("engine".into(), json!("rust-native"));
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
    Ok(json!({ "job": current, "ok": true, "engine": "rust-native" }))
}

// ───────────────────────── 核心纯函数：提取图片 ─────────────────────────

pub fn apply_extract_images(input: &Path, output_dir: &Path) -> Result<Vec<(String, PathBuf)>, String> {
    let doc = Document::load(input).map_err(|e| format!("无法读取 PDF: {e}"))?;
    let mut entries = Vec::new();
    let mut img_count = 0;

    let pages: Vec<(u32, ObjectId)> = doc.get_pages().into_iter().collect();
    for (page_idx, page_id) in pages {
        let Ok(Object::Dictionary(page_dict)) = doc.get_object(page_id) else { continue };
        let Ok(res_obj) = page_dict.get(b"Resources") else { continue };
        let Ok(res_dict) = (match res_obj {
            Object::Dictionary(d) => Ok(d),
            Object::Reference(r) => match doc.get_object(*r) {
                Ok(Object::Dictionary(d)) => Ok(d),
                _ => Err(()),
            },
            _ => Err(()),
        }) else { continue };

        let Ok(xobj) = res_dict.get(b"XObject") else { continue };
        let Ok(xobj_dict) = (match xobj {
            Object::Dictionary(d) => Ok(d),
            Object::Reference(r) => match doc.get_object(*r) {
                Ok(Object::Dictionary(d)) => Ok(d),
                _ => Err(()),
            },
            _ => Err(()),
        }) else { continue };

        for (name, obj_ref) in xobj_dict.iter() {
            let stream_obj = match obj_ref {
                Object::Stream(s) => Some(s),
                Object::Reference(r) => match doc.get_object(*r) {
                    Ok(Object::Stream(s)) => Some(s),
                    _ => None,
                },
                _ => None,
            };
            let Some(stream) = stream_obj else { continue };
            if stream.dict.get(b"Subtype").and_then(|s| s.as_name()).ok() == Some(b"Image") {
                img_count += 1;
                let is_dct = stream.dict.get(b"Filter").and_then(|f| f.as_name()).ok() == Some(b"DCTDecode");
                let ext = if is_dct { "jpg" } else { "png" };
                let file_name = format!("page_{:03}_img_{:02}_{}.{}", page_idx, img_count, String::from_utf8_lossy(name), ext);
                let target = output_dir.join(&file_name);

                if is_dct {
                    let _ = std::fs::write(&target, &stream.content);
                } else {
                    let decompressed = stream.decompressed_content().unwrap_or_else(|_| stream.content.clone());
                    let _ = std::fs::write(&target, &decompressed);
                }
                if target.is_file() && std::fs::metadata(&target).map(|m| m.len()).unwrap_or(0) > 0 {
                    entries.push((file_name, target));
                }
            }
        }
    }
    Ok(entries)
}

fn extract_images(ctx: &Ctx, input: &(PathBuf, String), _payload: &Value) -> Result<Value, String> {
    ctx.progress(15, "正在解析 PDF 页面对象…");
    let storage = crate::jobs::storage_dir_of(ctx.app);
    let scratch = crate::image_artifacts::Scratch::create(&storage.join("tmp"), &format!("pdf-img-{}", ctx.id))?;

    let entries = apply_extract_images(&input.0, &scratch.0)?;
    if entries.is_empty() {
        return Err("该 PDF 未提取到可用图片（可能是矢量图或已被扁平化） / No images extracted".into());
    }

    ctx.progress(85, "正在打包提取的图片…");
    let archive = results_path(ctx.app, ctx.id, "extracted_images.zip")?;
    crate::image_artifacts::zip(&entries, &archive, &|| if ctx.cancelled() { Err("任务已取消".into()) } else { Ok(()) })?;

    Ok(done(&archive, "extracted_images.zip", "application/zip", format!("共提取 {} 张图片", entries.len())))
}

// ───────────────────────── 核心纯函数：添加页码 ─────────────────────────

pub fn apply_page_numbers(
    input: &Path,
    output: &Path,
    position: &str,
    font_size: f64,
    start_from: u32,
) -> Result<usize, String> {
    let mut doc = Document::load(input).map_err(|e| format!("无法读取 PDF: {e}"))?;
    let font_size = font_size.clamp(6.0, 36.0);

    let font_id = doc.add_object(dictionary! {
        "Type" => "Font",
        "Subtype" => "Type1",
        "BaseFont" => "Helvetica",
    });

    let pages: Vec<(u32, ObjectId)> = doc.get_pages().into_iter().collect();
    let total_pages = pages.len();

    for (page_idx, page_id) in pages {
        let current_num = page_idx + start_from - 1;
        let num_str = format!("{current_num}");

        let (x0, y0, x1, y1) = page_box(&doc, page_id);
        let (pw, ph) = (x1 - x0, y1 - y0);

        let margin = 36.0;
        let text_width = num_str.len() as f64 * font_size * 0.55;
        let (x, y) = match position {
            "bottom-left" => (margin, margin),
            "bottom-right" => (pw - margin - text_width, margin),
            "top-left" => (margin, ph - margin - font_size),
            "top-center" => ((pw - text_width) / 2.0, ph - margin - font_size),
            "top-right" => (pw - margin - text_width, ph - margin - font_size),
            _ => ((pw - text_width) / 2.0, margin),
        };
        let (x, y) = (x + x0, y + y0);

        let ops = format!(
            "q BT /FkPageNum {font_size:.2} Tf 0.1 0.1 0.1 rg {x:.3} {y:.3} Td ({num_str}) Tj ET Q\n"
        );
        overlay_page(&mut doc, page_id, &[("Font", "FkPageNum", font_id)], ops.into_bytes())?;
    }

    doc.compress();
    doc.save(output).map_err(|e| format!("保存失败: {e}"))?;
    Ok(total_pages)
}

fn add_page_numbers(ctx: &Ctx, input: &(PathBuf, String), payload: &Value) -> Result<Value, String> {
    ctx.progress(20, "正在处理页码…");
    let position = text(payload, "position", "bottom-center");
    let font_size = number(payload, "font_size", 12.0);
    let start_from = number(payload, "start_from", 1.0) as u32;

    let stem = Path::new(&input.1).file_stem().and_then(|s| s.to_str()).unwrap_or("document");
    let out_name = format!("{stem}_已加页码.pdf");
    let out_file = results_path(ctx.app, ctx.id, &out_name)?;

    let total = apply_page_numbers(&input.0, &out_file, &position, font_size, start_from)?;
    Ok(done(&out_file, &out_name, "application/pdf", format!("已为 {} 页添加页码", total)))
}

// ───────────────────────── 核心纯函数：添加水印 ─────────────────────────

// ───────────────────────── 页面叠加通用助手 ─────────────────────────
// 旧实现直接 `page.get("Resources")`，遇到“引用/继承自父节点”的 Resources 会用空字典覆盖，
// 导致原页面字体、图片全部丢失（输出空白/乱码）。这里统一解析引用与继承，并用 q/Q 包住原内容。

fn resolve_dict(doc: &Document, obj: &Object) -> Option<Dictionary> {
    match obj {
        Object::Dictionary(d) => Some(d.clone()),
        Object::Reference(r) => match doc.get_object(*r).ok()? {
            Object::Dictionary(d) => Some(d.clone()),
            _ => None,
        },
        _ => None,
    }
}

fn inherited_attr(doc: &Document, page_id: ObjectId, key: &[u8]) -> Option<Object> {
    let mut cur = Some(page_id);
    let mut guard = 0;
    while let Some(id) = cur {
        guard += 1;
        if guard > 64 { break; }
        let Ok(Object::Dictionary(d)) = doc.get_object(id) else { break };
        if let Ok(v) = d.get(key) {
            return Some(v.clone());
        }
        cur = d.get(b"Parent").ok().and_then(|p| p.as_reference().ok());
    }
    None
}

fn resolve_obj(doc: &Document, obj: Object) -> Object {
    match obj {
        Object::Reference(r) => doc.get_object(r).cloned().unwrap_or(Object::Null),
        o => o,
    }
}

/// 可见区域 (x0, y0, x1, y1)：优先 CropBox，其次 MediaBox，均支持继承与引用。
fn page_box(doc: &Document, page_id: ObjectId) -> (f64, f64, f64, f64) {
    for key in [&b"CropBox"[..], &b"MediaBox"[..]] {
        if let Some(o) = inherited_attr(doc, page_id, key) {
            if let Object::Array(a) = resolve_obj(doc, o) {
                if a.len() == 4 {
                    let v: Vec<f64> = a.iter().map(|x| obj_num(&resolve_obj(doc, x.clone()))).collect();
                    let (x0, x1) = (v[0].min(v[2]), v[0].max(v[2]));
                    let (y0, y1) = (v[1].min(v[3]), v[1].max(v[3]));
                    if x1 - x0 > 1.0 && y1 - y0 > 1.0 {
                        return (x0, y0, x1, y1);
                    }
                }
            }
        }
    }
    (0.0, 0.0, 595.0, 842.0)
}

fn page_rotation(doc: &Document, page_id: ObjectId) -> i64 {
    inherited_attr(doc, page_id, b"Rotate")
        .map(|o| resolve_obj(doc, o))
        .and_then(|o| o.as_i64().ok())
        .map(|r| r.rem_euclid(360))
        .unwrap_or(0)
}

/// 把 `ops` 叠加到页面最上层，并把所需资源合并进页面 Resources。
fn overlay_page(
    doc: &mut Document,
    page_id: ObjectId,
    resources: &[(&str, &str, ObjectId)], // (类别 Font/XObject/ExtGState, 名称, 对象)
    ops: Vec<u8>,
) -> Result<(), String> {
    let mut res = inherited_attr(doc, page_id, b"Resources")
        .and_then(|o| resolve_dict(doc, &o))
        .unwrap_or_else(Dictionary::new);
    for cat in ["Font", "XObject", "ExtGState"] {
        let entries: Vec<_> = resources.iter().filter(|(c, _, _)| *c == cat).collect();
        if entries.is_empty() { continue; }
        let mut sub = res
            .get(cat.as_bytes())
            .ok()
            .and_then(|o| resolve_dict(doc, o))
            .unwrap_or_else(Dictionary::new);
        for (_, name, id) in entries {
            sub.set(name.as_bytes().to_vec(), Object::Reference(*id));
        }
        res.set(cat, Object::Dictionary(sub));
    }

    // 原内容流列表（Contents 可能是引用、数组，或“指向数组的引用”）
    let mut original: Vec<Object> = Vec::new();
    if let Ok(Object::Dictionary(page)) = doc.get_object(page_id) {
        match page.get(b"Contents") {
            Ok(Object::Reference(r)) => match doc.get_object(*r) {
                Ok(Object::Array(a)) => original.extend(a.iter().cloned()),
                _ => original.push(Object::Reference(*r)),
            },
            Ok(Object::Array(a)) => original.extend(a.iter().cloned()),
            _ => {}
        }
    }

    let q_id = doc.add_object(Stream::new(dictionary! {}, b"q\n".to_vec()));
    let mut body = b"\nQ\n".to_vec();
    body.extend(ops);
    let overlay_id = doc.add_object(Stream::new(dictionary! {}, body));

    let mut contents = vec![Object::Reference(q_id)];
    contents.extend(original);
    contents.push(Object::Reference(overlay_id));

    let Ok(Object::Dictionary(page)) = doc.get_object_mut(page_id) else {
        return Err("页面对象无效 / Invalid page object".into());
    };
    page.set("Resources", Object::Dictionary(res));
    page.set("Contents", Object::Array(contents));
    Ok(())
}

/// 用 Windows 自带 GDI+（System.Drawing，微软雅黑）把水印文字渲染成透明 PNG，支持中文/任意 Unicode。
pub(crate) fn render_text_image(text_val: &str, px: u32) -> Result<image::GrayAlphaImage, String> {
    let tmp = std::env::temp_dir();
    let tag = uuid::Uuid::new_v4().simple().to_string();
    let txt = tmp.join(format!("fk_wm_{tag}.txt"));
    let png = tmp.join(format!("fk_wm_{tag}.png"));
    std::fs::write(&txt, text_val.as_bytes()).map_err(|e| e.to_string())?;
    let script = format!(
        r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
$text = [IO.File]::ReadAllText('{txt}', [Text.Encoding]::UTF8)
$px = {px}
$font = $null
foreach ($name in @('Microsoft YaHei', 'Microsoft YaHei UI', 'SimHei', 'Arial')) {{
    try {{ $font = New-Object System.Drawing.Font($name, [single]$px, [System.Drawing.FontStyle]::Bold, [System.Drawing.GraphicsUnit]::Pixel); break }} catch {{}}
}}
$fmt = [System.Drawing.StringFormat]::GenericTypographic
$probe = New-Object System.Drawing.Bitmap 1, 1
$g = [System.Drawing.Graphics]::FromImage($probe)
$size = $g.MeasureString($text, $font, 1000000, $fmt)
$g.Dispose(); $probe.Dispose()
$pad = [int][Math]::Ceiling($px * 0.1)
$w = [int][Math]::Ceiling($size.Width) + 2 * $pad
$h = [int][Math]::Ceiling($px * 1.2) + 2 * $pad
$bmp = New-Object System.Drawing.Bitmap $w, $h, ([System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.Clear([System.Drawing.Color]::Transparent)
$g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAliasGridFit
$brush = New-Object System.Drawing.SolidBrush ([System.Drawing.Color]::FromArgb(255, 128, 128, 128))
$g.DrawString($text, $font, $brush, [single]$pad, [single]($pad + $px * 0.1), $fmt)
$g.Dispose()
$bmp.Save('{png}', [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
"#,
        txt = txt.to_string_lossy().replace('\'', "''"),
        png = png.to_string_lossy().replace('\'', "''"),
        px = px
    );
    let res = crate::office_native::run_ps(&script);
    let _ = std::fs::remove_file(&txt);
    res?;
    let img = image::open(&png).map_err(|e| format!("水印文字渲染失败: {e}"));
    let _ = std::fs::remove_file(&png);
    Ok(img?.to_luma_alpha8())
}

pub fn apply_watermark(
    input: &Path,
    output: &Path,
    text_val: &str,
    font_size: f64,
    mut opacity: f64,
    angle_deg: f64,
) -> Result<usize, String> {
    let mut doc = Document::load(input).map_err(|e| format!("无法读取 PDF: {e}"))?;
    let text_val = text_val.trim();
    if text_val.is_empty() {
        return Err("请填写水印文字 / Watermark text is empty".into());
    }
    let font_size = font_size.clamp(8.0, 200.0);
    if opacity > 1.0 {
        opacity /= 100.0;
    }
    let opacity = opacity.clamp(0.03, 1.0);

    let extgstate_id = doc.add_object(dictionary! {
        "Type" => "ExtGState",
        "ca" => Object::Real(opacity as f32),
        "CA" => Object::Real(opacity as f32),
    });

    // 1) 首选：GDI+ 渲染成带透明通道的图片（中文可用，外观与预览一致：微软雅黑粗体、#808080）
    const PX_PER_PT: f64 = 4.0;
    let rendered = render_text_image(text_val, (font_size * PX_PER_PT).round() as u32);
    let image_ref = match &rendered {
        Ok(img) if img.width() > 0 && img.height() > 0 => {
            let (iw, ih) = (img.width(), img.height());
            let alpha: Vec<u8> = img.pixels().map(|p| p[1]).collect();
            let smask_id = doc.add_object(Stream::new(
                dictionary! {
                    "Type" => "XObject", "Subtype" => "Image",
                    "Width" => iw as i64, "Height" => ih as i64,
                    "ColorSpace" => "DeviceGray", "BitsPerComponent" => 8,
                },
                alpha,
            ));
            let img_id = doc.add_object(Stream::new(
                dictionary! {
                    "Type" => "XObject", "Subtype" => "Image",
                    "Width" => iw as i64, "Height" => ih as i64,
                    "ColorSpace" => "DeviceGray", "BitsPerComponent" => 8,
                    "SMask" => smask_id,
                },
                vec![128u8; (iw * ih) as usize],
            ));
            Some((img_id, iw as f64 / PX_PER_PT, ih as f64 / PX_PER_PT))
        }
        _ => None,
    };
    // 2) 兜底：纯 ASCII 可退回 Helvetica 文字
    let font_id = if image_ref.is_none() {
        if !text_val.is_ascii() {
            return Err(format!(
                "中文水印渲染失败：{}",
                rendered.err().unwrap_or_else(|| "未知错误".into())
            ));
        }
        Some(doc.add_object(dictionary! {
            "Type" => "Font", "Subtype" => "Type1", "BaseFont" => "Helvetica",
        }))
    } else {
        None
    };

    let pages: Vec<(u32, ObjectId)> = doc.get_pages().into_iter().collect();
    let total_pages = pages.len();

    for (_idx, page_id) in pages {
        let (x0, y0, x1, y1) = page_box(&doc, page_id);
        let (cx, cy) = ((x0 + x1) / 2.0, (y0 + y1) / 2.0);
        // 预览里的角度是 CSS 顺时针；PDF 坐标 y 轴朝上，顺时针 = 负角。页面自带 /Rotate 时再抵消。
        let theta = (angle_deg - page_rotation(&doc, page_id) as f64).to_radians();
        let (c, s) = (theta.cos(), theta.sin());

        let (ops, res): (String, Vec<(&str, &str, ObjectId)>) = if let Some((img_id, wpt, hpt)) = image_ref {
            (
                format!(
                    "q /FkWmGS gs 1 0 0 1 {cx:.3} {cy:.3} cm {c:.5} {ns:.5} {s:.5} {c:.5} 0 0 cm {wpt:.3} 0 0 {hpt:.3} {hx:.3} {hy:.3} cm /FkWmImg Do Q\n",
                    ns = -s, hx = -wpt / 2.0, hy = -hpt / 2.0
                ),
                vec![("ExtGState", "FkWmGS", extgstate_id), ("XObject", "FkWmImg", img_id)],
            )
        } else {
            let half = text_val.len() as f64 * font_size * 0.28;
            let esc = text_val.replace('\\', "\\\\").replace('(', "\\(").replace(')', "\\)");
            (
                format!(
                    "q /FkWmGS gs BT /FkWmFont {font_size:.2} Tf 0.5 0.5 0.5 rg {c:.5} {ns:.5} {s:.5} {c:.5} {tx:.3} {ty:.3} Tm ({esc}) Tj ET Q\n",
                    ns = -s,
                    tx = cx - half * c - (font_size * 0.35) * s,
                    ty = cy + half * s - (font_size * 0.35) * c,
                ),
                vec![("ExtGState", "FkWmGS", extgstate_id), ("Font", "FkWmFont", font_id.unwrap())],
            )
        };
        overlay_page(&mut doc, page_id, &res, ops.into_bytes())?;
    }

    doc.compress();
    doc.save(output).map_err(|e| format!("保存失败: {e}"))?;
    Ok(total_pages)
}

fn add_watermark(ctx: &Ctx, input: &(PathBuf, String), payload: &Value) -> Result<Value, String> {
    ctx.progress(20, "正在处理水印…");
    let text_val = text(payload, "text", "CONFIDENTIAL");
    let font_size = number(payload, "fontSize", number(payload, "font_size", 40.0));
    let opacity = number(payload, "opacity", 0.3);
    let angle_deg = number(payload, "angle", number(payload, "rotation", 45.0));

    let stem = Path::new(&input.1).file_stem().and_then(|s| s.to_str()).unwrap_or("document");
    let out_name = format!("{stem}_水印.pdf");
    let out_file = results_path(ctx.app, ctx.id, &out_name)?;

    let total = apply_watermark(&input.0, &out_file, &text_val, font_size, opacity, angle_deg)?;
    Ok(done(&out_file, &out_name, "application/pdf", format!("已为 {} 页添加水印", total)))
}

// ───────────────────────── 核心纯函数：压缩 ─────────────────────────

pub fn apply_compress(input: &Path, output: &Path, quality: u8) -> Result<(usize, f64), String> {
    let mut doc = Document::load(input).map_err(|e| format!("无法读取 PDF: {e}"))?;
    let quality = quality.clamp(20, 95);
    let mut compressed_imgs = 0;

    let keys: Vec<ObjectId> = doc.objects.keys().copied().collect();
    for id in keys {
        let is_image = if let Ok(Object::Stream(stream)) = doc.get_object(id) {
            stream.dict.get(b"Subtype").and_then(|s| s.as_name()).ok() == Some(b"Image")
        } else {
            false
        };

        if is_image {
            let stream = doc.get_object_mut(id).and_then(Object::as_stream_mut).unwrap();
            let is_dct = stream.dict.get(b"Filter").and_then(|f| f.as_name()).ok() == Some(b"DCTDecode");
            if is_dct && stream.content.len() > 10_000 {
                if let Ok(dyn_img) = image::load_from_memory_with_format(&stream.content, image::ImageFormat::Jpeg) {
                    let mut buf = Vec::new();
                    let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, quality);
                    if encoder.encode_image(&dyn_img).is_ok() && buf.len() < stream.content.len() {
                        stream.content = buf;
                        compressed_imgs += 1;
                    }
                }
            }
        }
    }

    doc.compress();
    doc.save(output).map_err(|e| format!("保存失败: {e}"))?;

    let old_size = std::fs::metadata(input).map(|m| m.len()).unwrap_or(0);
    let new_size = std::fs::metadata(output).map(|m| m.len()).unwrap_or(0);
    let ratio = if old_size > 0 {
        ((1.0 - (new_size as f64 / old_size as f64)) * 100.0).max(0.0)
    } else {
        0.0
    };

    Ok((compressed_imgs, ratio))
}

fn compress(ctx: &Ctx, input: &(PathBuf, String), payload: &Value) -> Result<Value, String> {
    ctx.progress(20, "正在压缩 PDF 流…");
    let quality = number(payload, "quality", 75.0) as u8;

    let stem = Path::new(&input.1).file_stem().and_then(|s| s.to_str()).unwrap_or("document");
    let out_name = format!("{stem}_已压缩.pdf");
    let out_file = results_path(ctx.app, ctx.id, &out_name)?;

    let (compressed_imgs, ratio) = apply_compress(&input.0, &out_file, quality)?;
    Ok(done(&out_file, &out_name, "application/pdf", format!("压缩完成，减少了 {:.1}% 体积（共压缩 {} 张图片）", ratio, compressed_imgs)))
}

// ───────────────────────── 核心纯函数：扫描件增清 ─────────────────────────

fn enhance_image(mut img: image::RgbImage, mode: &str, strength: &str) -> image::DynamicImage {
    let contrast_factor = match strength {
        "light" => 1.08,
        "strong" => 1.25,
        _ => 1.15,
    };

    let mut lum_samples: Vec<u8> = img.pixels().step_by(10).map(|p| {
        ((p[0] as u32 * 77 + p[1] as u32 * 150 + p[2] as u32 * 29) >> 8) as u8
    }).collect();
    lum_samples.sort_unstable();
    let paper = if !lum_samples.is_empty() {
        lum_samples[(lum_samples.len() as f64 * 0.95) as usize]
    } else {
        240
    };

    let white_scale = if paper > 30 { 255.0 / (paper as f64).max(1.0) } else { 1.0 };

    for p in img.pixels_mut() {
        for c in 0..3 {
            let val = (p[c] as f64 * white_scale).clamp(0.0, 255.0);
            let centered = (val - 128.0) * contrast_factor + 128.0;
            p[c] = centered.clamp(0.0, 255.0) as u8;
        }
    }

    if mode == "bw" {
        // Otsu 自动阈值（比“平均亮度”更稳，白底文档不会整片发黑）
        let mut hist = [0u64; 256];
        for p in img.pixels() {
            hist[((p[0] as u32 * 77 + p[1] as u32 * 150 + p[2] as u32 * 29) >> 8) as usize] += 1;
        }
        let total: u64 = hist.iter().sum();
        let sum_all: f64 = hist.iter().enumerate().map(|(i, &c)| i as f64 * c as f64).sum();
        let (mut w_b, mut sum_b, mut best, mut threshold) = (0f64, 0f64, -1f64, 128u8);
        for t in 0..256usize {
            w_b += hist[t] as f64;
            if w_b == 0.0 { continue; }
            let w_f = total as f64 - w_b;
            if w_f == 0.0 { break; }
            sum_b += t as f64 * hist[t] as f64;
            let m_b = sum_b / w_b;
            let m_f = (sum_all - sum_b) / w_f;
            let between = w_b * w_f * (m_b - m_f) * (m_b - m_f);
            if between > best { best = between; threshold = t as u8; }
        }
        let mut gray = image::GrayImage::new(img.width(), img.height());
        for (x, y, p) in img.enumerate_pixels() {
            let l = ((p[0] as u32 * 77 + p[1] as u32 * 150 + p[2] as u32 * 29) >> 8) as u8;
            let val = if l > threshold { 255 } else { 0 };
            gray.put_pixel(x, y, image::Luma([val]));
        }
        image::DynamicImage::ImageLuma8(gray)
    } else if mode == "gray" {
        let mut gray = image::GrayImage::new(img.width(), img.height());
        for (x, y, p) in img.enumerate_pixels() {
            let l = ((p[0] as u32 * 77 + p[1] as u32 * 150 + p[2] as u32 * 29) >> 8) as u8;
            gray.put_pixel(x, y, image::Luma([l]));
        }
        image::DynamicImage::ImageLuma8(gray)
    } else {
        image::DynamicImage::ImageRgb8(img)
    }
}

pub fn apply_enhance_pdf(
    input: &Path,
    output: &Path,
    mode: &str,
    strength: &str,
    dpi: u32,
    pages_spec: &str,
    scratch_dir: &Path,
    check: &dyn Fn() -> Result<(), String>,
) -> Result<usize, String> {
    let renderer = crate::pdf_render::Renderer::open(input)?;
    let count = renderer.count()?;
    if count == 0 {
        return Err("PDF 没有页面 / Empty PDF".into());
    }

    let dpi = dpi.clamp(96, 300);
    let target_pages: BTreeSet<u32> = if pages_spec != "all" && !pages_spec.trim().is_empty() {
        let mut set = BTreeSet::new();
        for part in pages_spec.split(',') {
            let part = part.trim();
            if part.is_empty() { continue; }
            if let Some((start, end)) = part.split_once('-') {
                let s: u32 = start.trim().parse().unwrap_or(1);
                let e: u32 = end.trim().parse().unwrap_or(count);
                for p in s.max(1)..=e.min(count) {
                    set.insert(p - 1);
                }
            } else if let Ok(p) = part.parse::<u32>() {
                if p >= 1 && p <= count {
                    set.insert(p - 1);
                }
            }
        }
        if set.is_empty() {
            (0..count).collect()
        } else {
            set
        }
    } else {
        (0..count).collect()
    };

    let mut out_doc = Document::with_version("1.5");
    let pages_id = out_doc.new_object_id();
    let mut kids = Vec::new();

    for seq in 0..count {
        check()?;
        let page_img_path = scratch_dir.join(format!("render_page_{}.png", seq));
        let (w, h, _) = renderer.render(seq, dpi, &page_img_path, check)?;

        // 注意：PDF 的 FlateDecode 需要“原始像素 + zlib”，不能直接塞 PNG 文件字节（否则阅读器显示全黑）。
        // 这里统一输出原始像素（不设 Filter，由 out_doc.compress() 统一 zlib 压缩），彩色增强页用 JPEG。
        let rendered = image::open(&page_img_path).map_err(|e| format!("无法加载渲染图像: {e}"))?;
        let (final_img_bytes, is_jpeg, color_space) = if target_pages.contains(&seq) {
            let enhanced = enhance_image(rendered.to_rgb8(), mode, strength);
            match enhanced {
                image::DynamicImage::ImageLuma8(g) => (g.into_raw(), false, "DeviceGray"),
                other => {
                    let rgb = other.to_rgb8();
                    let mut buf = Vec::new();
                    image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 90)
                        .encode_image(&rgb)
                        .map_err(|e| e.to_string())?;
                    (buf, true, "DeviceRGB")
                }
            }
        } else {
            (rendered.to_rgb8().into_raw(), false, "DeviceRGB")
        };
        let _ = std::fs::remove_file(&page_img_path);

        let pw = (w as f64 * 72.0 / dpi as f64).round();
        let ph = (h as f64 * 72.0 / dpi as f64).round();

        let mut xobj_dict = dictionary! {
            "Type" => "XObject",
            "Subtype" => "Image",
            "Width" => w as i64,
            "Height" => h as i64,
            "ColorSpace" => color_space,
            "BitsPerComponent" => 8,
        };
        if is_jpeg {
            xobj_dict.set("Filter", Object::Name(b"DCTDecode".to_vec()));
        }

        let img_id = out_doc.add_object(Stream::new(xobj_dict, final_img_bytes));
        let content_str = format!("q {pw:.2} 0 0 {ph:.2} 0 0 cm /Im1 Do Q\n");
        let content_id = out_doc.add_object(Stream::new(dictionary!(), content_str.into_bytes()));

        let page_obj_id = out_doc.add_object(dictionary! {
            "Type" => "Page",
            "Parent" => pages_id,
            "MediaBox" => vec![0.into(), 0.into(), pw.into(), ph.into()],
            "Contents" => content_id,
            "Resources" => dictionary! {
                "XObject" => dictionary! {
                    "Im1" => img_id,
                },
            },
        });
        kids.push(Object::Reference(page_obj_id));
    }

    out_doc.objects.insert(pages_id, Object::Dictionary(dictionary! {
        "Type" => "Pages",
        "Kids" => kids,
        "Count" => count as i64,
    }));

    let catalog_id = out_doc.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => pages_id,
    });
    out_doc.trailer.set("Root", catalog_id);

    out_doc.compress();
    out_doc.save(output).map_err(|e| format!("保存失败: {e}"))?;

    Ok(target_pages.len())
}

fn enhance_pdf(ctx: &Ctx, input: &(PathBuf, String), payload: &Value) -> Result<Value, String> {
    ctx.progress(10, "正在启动扫描件增强…");
    let mode = text(payload, "mode", "gray");
    let strength = text(payload, "strength", "medium");
    let dpi = number(payload, "dpi", 200.0) as u32;
    let pages_spec = text(payload, "pages", "all");

    let storage = crate::jobs::storage_dir_of(ctx.app);
    let scratch = crate::image_artifacts::Scratch::create(&storage.join("tmp"), &format!("pdf-enhance-{}", ctx.id))?;

    let stem = Path::new(&input.1).file_stem().and_then(|s| s.to_str()).unwrap_or("document");
    let out_name = format!("{stem}_增强.pdf");
    let out_file = results_path(ctx.app, ctx.id, &out_name)?;

    let check = || if ctx.cancelled() { Err("任务已取消".into()) } else { Ok(()) };
    let total = apply_enhance_pdf(&input.0, &out_file, &mode, &strength, dpi, &pages_spec, &scratch.0, &check)?;

    Ok(done(&out_file, &out_name, "application/pdf", format!("已增强 {} 页扫描件", total)))
}

// ───────────────────────── 核心纯函数：改文字与插图 ─────────────────────────

pub fn apply_content_edit(input: &Path, output: &Path, payload: &Value) -> Result<String, String> {
    let mut doc = Document::load(input).map_err(|e| format!("无法读取 PDF: {e}"))?;

    let mode = text(payload, "mode", "replace");
    let page_num = number(payload, "page", 1.0).max(1.0) as usize;

    let pages: Vec<(u32, ObjectId)> = doc.get_pages().into_iter().collect();
    if page_num > pages.len() {
        return Err(format!("第 {} 页不存在（当前 PDF 共 {} 页）", page_num, pages.len()));
    }
    let (_, page_id) = pages[page_num - 1];

    let ph = {
        let Ok(Object::Dictionary(page_dict)) = doc.get_object(page_id) else {
            return Err("无法读取页面字典".into());
        };
        let media = page_dict.get(b"MediaBox").ok();
        match media {
            Some(Object::Array(a)) if a.len() == 4 => {
                let h = obj_num(&a[3]);
                if h > 0.0 { h } else { 842.0 }
            }
            _ => 842.0,
        }
    };

    match mode.as_ref() {
        "replace" => {
            let old_text = text(payload, "old_text", "");
            let new_text = text(payload, "new_text", "");
            if old_text.is_empty() {
                return Err("文字替换需要提供要查找的原文 / Missing old text".into());
            }

            let content_data = doc.get_page_content(page_id).map_err(|e| format!("无法读取页面内容流: {e}"))?;
            let mut content = Content::decode(&content_data).map_err(|e| format!("无法解析内容操作: {e}"))?;

            let mut replaced_count = 0;
            let replace_all = text(payload, "replace_all", "no") == "yes";
            let old_bytes = old_text.as_bytes();
            let new_bytes = new_text.as_bytes();

            for op in content.operations.iter_mut() {
                if op.operator == "Tj" {
                    if let Some(Object::String(bytes, _)) = op.operands.get_mut(0) {
                        if let Some(pos) = bytes.windows(old_bytes.len()).position(|w| w == old_bytes) {
                            let mut updated = bytes[..pos].to_vec();
                            updated.extend_from_slice(new_bytes);
                            updated.extend_from_slice(&bytes[pos + old_bytes.len()..]);
                            *bytes = updated;
                            replaced_count += 1;
                            if !replace_all {
                                break;
                            }
                        }
                    }
                } else if op.operator == "TJ" {
                    if let Some(Object::Array(arr)) = op.operands.get_mut(0) {
                        for item in arr.iter_mut() {
                            if let Object::String(bytes, _) = item {
                                if let Some(pos) = bytes.windows(old_bytes.len()).position(|w| w == old_bytes) {
                                    let mut updated = bytes[..pos].to_vec();
                                    updated.extend_from_slice(new_bytes);
                                    updated.extend_from_slice(&bytes[pos + old_bytes.len()..]);
                                    *bytes = updated;
                                    replaced_count += 1;
                                    if !replace_all {
                                        break;
                                    }
                                }
                            }
                        }
                        if replaced_count > 0 && !replace_all {
                            break;
                        }
                    }
                }
            }

            if replaced_count == 0 {
                return Err(format!("在第 {} 页未找到完全匹配的文本「{}」，可能被字符排版拆分 / Text not found", page_num, old_text));
            }

            let new_content_bytes = content.encode().map_err(|e| e.to_string())?;
            doc.change_page_content(page_id, new_content_bytes).map_err(|e| e.to_string())?;
        }
        "text" => {
            let insert_text = text(payload, "insert_text", "");
            if insert_text.is_empty() {
                return Err("插入文字需要填写内容 / Missing text to insert".into());
            }
            let x = number(payload, "x", 72.0);
            let y_top = number(payload, "y", 72.0);
            let size = number(payload, "size", 12.0).clamp(6.0, 72.0);
            let pdf_y = ph - y_top - size;

            let font_id = doc.add_object(dictionary! {
                "Type" => "Font",
                "Subtype" => "Type1",
                "BaseFont" => "Helvetica",
            });

            let ops = vec![
                Operation::new("q", vec![]),
                Operation::new("BT", vec![]),
                Operation::new("Tf", vec![Object::Name(b"FEdit".to_vec()), Object::Real(size as f32)]),
                Operation::new("rg", vec![Object::Real(0.0), Object::Real(0.0), Object::Real(0.0)]),
                Operation::new("Td", vec![Object::Real(x as f32), Object::Real(pdf_y as f32)]),
                Operation::new("Tj", vec![Object::String(insert_text.as_bytes().to_vec(), StringFormat::Literal)]),
                Operation::new("ET", vec![]),
                Operation::new("Q", vec![]),
            ];
            let content_bytes = Content { operations: ops }.encode().map_err(|e| e.to_string())?;
            let stream_id = doc.add_object(Stream::new(dictionary!(), content_bytes));

            let Ok(Object::Dictionary(page_dict)) = doc.get_object_mut(page_id) else {
                return Err("无法修改页面字典".into());
            };
            let mut res = match page_dict.get(b"Resources") {
                Ok(Object::Dictionary(d)) => d.clone(),
                _ => Dictionary::new(),
            };
            let mut fonts = match res.get(b"Font") {
                Ok(Object::Dictionary(d)) => d.clone(),
                _ => Dictionary::new(),
            };
            fonts.set("FEdit", Object::Reference(font_id));
            res.set("Font", fonts);
            page_dict.set("Resources", res);

            let new_contents = match page_dict.get(b"Contents") {
                Ok(Object::Reference(r)) => Object::Array(vec![Object::Reference(*r), Object::Reference(stream_id)]),
                Ok(Object::Array(arr)) => {
                    let mut a = arr.clone();
                    a.push(Object::Reference(stream_id));
                    Object::Array(a)
                }
                _ => Object::Reference(stream_id),
            };
            page_dict.set("Contents", new_contents);
        }
        "image" => {
            let img_path_str = text(payload, "insert_image", "");
            let img_path = PathBuf::from(&img_path_str);
            if !img_path.is_file() {
                return Err("未找到要插入的图片文件 / Image file not found".into());
            }

            let dyn_img = image::open(&img_path).map_err(|e| format!("无法加载插入的图片: {e}"))?;
            let (iw, ih) = (dyn_img.width() as f64, dyn_img.height() as f64);
            if iw <= 0.0 || ih <= 0.0 {
                return Err("图片尺寸异常 / Invalid image dimensions".into());
            }

            let x = number(payload, "x", 72.0);
            let y_top = number(payload, "y", 72.0);
            let width = number(payload, "width", 200.0).max(10.0);
            let height = width * (ih / iw);
            let pdf_y = ph - y_top - height;

            let mut buf = Vec::new();
            let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, 88);
            enc.encode_image(&dyn_img).map_err(|e| e.to_string())?;

            let img_xobj_id = doc.add_object(Stream::new(
                dictionary! {
                    "Type" => "XObject",
                    "Subtype" => "Image",
                    "Width" => dyn_img.width() as i64,
                    "Height" => dyn_img.height() as i64,
                    "ColorSpace" => "DeviceRGB",
                    "BitsPerComponent" => 8,
                    "Filter" => "DCTDecode",
                },
                buf,
            ));

            let ops = vec![
                Operation::new("q", vec![]),
                Operation::new("cm", vec![
                    Object::Real(width as f32), Object::Real(0.0),
                    Object::Real(0.0), Object::Real(height as f32),
                    Object::Real(x as f32), Object::Real(pdf_y as f32),
                ]),
                Operation::new("/ImEdit", vec![Object::Name(b"Do".to_vec())]),
                Operation::new("Q", vec![]),
            ];
            let content_bytes = Content { operations: ops }.encode().map_err(|e| e.to_string())?;
            let stream_id = doc.add_object(Stream::new(dictionary!(), content_bytes));

            let Ok(Object::Dictionary(page_dict)) = doc.get_object_mut(page_id) else {
                return Err("无法修改页面字典".into());
            };
            let mut res = match page_dict.get(b"Resources") {
                Ok(Object::Dictionary(d)) => d.clone(),
                _ => Dictionary::new(),
            };
            let mut xobjs = match res.get(b"XObject") {
                Ok(Object::Dictionary(d)) => d.clone(),
                _ => Dictionary::new(),
            };
            xobjs.set("ImEdit", Object::Reference(img_xobj_id));
            res.set("XObject", xobjs);
            page_dict.set("Resources", res);

            let new_contents = match page_dict.get(b"Contents") {
                Ok(Object::Reference(r)) => Object::Array(vec![Object::Reference(*r), Object::Reference(stream_id)]),
                Ok(Object::Array(arr)) => {
                    let mut a = arr.clone();
                    a.push(Object::Reference(stream_id));
                    Object::Array(a)
                }
                _ => Object::Reference(stream_id),
            };
            page_dict.set("Contents", new_contents);
        }
        other => return Err(format!("不支持的操作类型「{other}」 / Unsupported edit mode")),
    }

    doc.compress();
    doc.save(output).map_err(|e| format!("保存失败: {e}"))?;
    Ok(format!("已完成第 {} 页内容层编辑", page_num))
}

fn content_edit(ctx: &Ctx, input: &(PathBuf, String), payload: &Value) -> Result<Value, String> {
    ctx.progress(20, "正在编辑 PDF 内容…");

    let stem = Path::new(&input.1).file_stem().and_then(|s| s.to_str()).unwrap_or("document");
    let out_name = format!("{stem}_已编辑.pdf");
    let out_file = results_path(ctx.app, ctx.id, &out_name)?;

    let msg = apply_content_edit(&input.0, &out_file, payload)?;
    Ok(done(&out_file, &out_name, "application/pdf", msg))
}

// ───────────────────────── 真实文件单元测试 ─────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    fn find_test_fixture() -> PathBuf {
        let candidates = [
            PathBuf::from("../_verify/fixtures/test_doc.pdf"),
            PathBuf::from("_verify/fixtures/test_doc.pdf"),
            PathBuf::from("E:/FurinaKit-Tauri/_verify/fixtures/test_doc.pdf"),
        ];
        for c in &candidates {
            if c.exists() {
                return c.clone();
            }
        }
        candidates[0].clone()
    }

    #[test]
    fn test_native_watermark() {
        let fixture = find_test_fixture();
        if !fixture.exists() {
            eprintln!("跳过测试：未找到 test_doc.pdf");
            return;
        }
        let out = std::env::temp_dir().join("furina_test_watermark.pdf");
        let pages = apply_watermark(&fixture, &out, "CONFIDENTIAL", 40.0, 0.3, 45.0)
            .expect("加水印应该成功");
        assert!(pages > 0);
        assert!(out.exists());
        assert!(std::fs::metadata(&out).unwrap().len() > 0);
        let doc = Document::load(&out).expect("输出应该是有效 PDF");
        assert_eq!(doc.get_pages().len(), pages);
        let _ = std::fs::remove_file(out);
    }

    #[test]
    fn test_native_page_numbers() {
        let fixture = find_test_fixture();
        if !fixture.exists() {
            eprintln!("跳过测试：未找到 test_doc.pdf");
            return;
        }
        let out = std::env::temp_dir().join("furina_test_pagenum.pdf");
        let pages = apply_page_numbers(&fixture, &out, "bottom-center", 12.0, 1)
            .expect("加页码应该成功");
        assert!(pages > 0);
        assert!(out.exists());
        assert!(std::fs::metadata(&out).unwrap().len() > 0);
        let doc = Document::load(&out).expect("输出应该是有效 PDF");
        assert_eq!(doc.get_pages().len(), pages);
        let _ = std::fs::remove_file(out);
    }

    #[test]
    fn test_native_compress() {
        let fixture = find_test_fixture();
        if !fixture.exists() {
            eprintln!("跳过测试：未找到 test_doc.pdf");
            return;
        }
        let out = std::env::temp_dir().join("furina_test_compress.pdf");
        let (_imgs, ratio) = apply_compress(&fixture, &out, 75).expect("压缩应该成功");
        assert!(out.exists());
        assert!(std::fs::metadata(&out).unwrap().len() > 0);
        let doc = Document::load(&out).expect("输出应该是有效 PDF");
        assert!(!doc.get_pages().is_empty());
        println!("PDF 压缩率：{:.1}%", ratio);
        let _ = std::fs::remove_file(out);
    }

    #[test]
    fn test_native_extract_images() {
        let fixture = find_test_fixture();
        if !fixture.exists() {
            eprintln!("跳过测试：未找到 test_doc.pdf");
            return;
        }
        let temp_dir = std::env::temp_dir().join("furina_test_pdf_imgs");
        let _ = std::fs::create_dir_all(&temp_dir);
        let res = apply_extract_images(&fixture, &temp_dir);
        assert!(res.is_ok());
        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_native_content_edit_text() {
        let fixture = find_test_fixture();
        if !fixture.exists() {
            eprintln!("跳过测试：未找到 test_doc.pdf");
            return;
        }
        let out = std::env::temp_dir().join("furina_test_content_edit.pdf");
        let payload = json!({
            "mode": "text",
            "page": 1,
            "insert_text": "FurinaKit Native Test",
            "x": 72.0,
            "y": 72.0,
            "size": 14.0
        });
        let res = apply_content_edit(&fixture, &out, &payload).expect("插入文字应该成功");
        assert!(out.exists());
        let doc = Document::load(&out).expect("输出应该是有效 PDF");
        assert!(!doc.get_pages().is_empty());
        println!("编辑结果：{}", res);
        let _ = std::fs::remove_file(out);
    }
}
