//! 去 Python 化（第二批）：以下工具原来走 Python worker，现在由 Rust 直接完成——
//!   pdf-reorder / pdf-crop / pdf-unlock / pdf-encrypt   （lopdf + 自研标准安全处理器 pdf_crypt.rs）
//!   image-watermark                                    （GDI+ 渲染文字 + Rust 合成）
//!   csv-excel                                          （自研 CSV 解析 + 极简 xlsx 读写 mini_zip.rs）
//!   markdown-to-pdf                                    （Markdown→HTML + 系统 Edge/Chrome 无头打印）
//! 核心算法见 doc_convert.rs；这里只负责上传落盘、建任务、后台线程与进度。

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};

use serde_json::{json, Map, Value};

use crate::doc_convert as dc;
use crate::matting_native::{number, results_path, text};

pub fn supported(tool: &str) -> bool {
    matches!(
        tool,
        "pdf-reorder" | "pdf-crop" | "pdf-unlock" | "pdf-encrypt" | "image-watermark" | "csv-excel" | "markdown-to-pdf"
            | "text-to-speech" | "ppt-from-outline"
    )
}

struct Ctx<'a> {
    app: &'a tauri::AppHandle,
    id: &'a str,
}

impl<'a> Ctx<'a> {
    fn progress(&self, pct: u32, msg: &str) {
        crate::matting_native::progress(self.app, self.id, pct, msg);
    }
    fn cancelled(&self) -> bool {
        crate::jobs::read_job_public(self.app, self.id)
            .and_then(|j| j.get("status").and_then(Value::as_str).map(|s| s == "failed"))
            .unwrap_or(false)
    }
    fn out(&self, name: &str) -> Result<PathBuf, String> {
        results_path(self.app, self.id, name)
    }
}

struct Done {
    path: PathBuf,
    filename: String,
    mime: String,
    message: String,
}

fn stem_of(name: &str, fallback: &str) -> String {
    Path::new(name)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| fallback.to_string())
}

fn ext_of(name: &str) -> String {
    Path::new(name).extension().map(|s| s.to_string_lossy().to_lowercase()).unwrap_or_default()
}

// ───────────────────────── 入口 ─────────────────────────

pub fn start(app: &tauri::AppHandle, tool: &str, args: &Value) -> Result<Value, String> {
    let tool = tool.to_string();
    let mut payload = args.clone();

    let inputs: Vec<(PathBuf, String)> = if let Some(files) = args.get("__files").and_then(Value::as_array) {
        if files.len() > 100 {
            return Err("每批最多 100 个文件 / Select at most 100 files".into());
        }
        if files.is_empty() {
            Vec::new()
        } else {
            let saved = crate::jobs::save_request_uploads(app, &crate::jobs::new_job_id_public(), files)?;
            saved
                .iter()
                .map(|s| {
                    let p = s.get("path").and_then(Value::as_str).ok_or("缺少上传的文件")?;
                    let n = s.get("name").and_then(Value::as_str).unwrap_or("upload.bin").to_string();
                    Ok((PathBuf::from(p), n))
                })
                .collect::<Result<_, String>>()?
        }
    } else {
        let list: Vec<String> = if let Some(arr) = args.get("files").and_then(Value::as_array) {
            arr.iter().filter_map(Value::as_str).map(str::to_string).collect()
        } else {
            args.get("file")
                .or_else(|| args.get("path"))
                .and_then(Value::as_str)
                .filter(|s| !s.trim().is_empty())
                .map(|s| vec![s.to_string()])
                .unwrap_or_default()
        };
        list.into_iter()
            .map(|s| {
                let p = PathBuf::from(&s);
                let n = p.file_name().map(|x| x.to_string_lossy().to_string()).unwrap_or_else(|| "upload.bin".into());
                (p, n)
            })
            .collect()
    };

    let needs_file = !matches!(tool.as_str(), "markdown-to-pdf" | "text-to-speech" | "ppt-from-outline");
    if needs_file && inputs.is_empty() {
        return Err("请先选择文件 / Select a file first".into());
    }
    if tool == "text-to-speech" && text(&payload, "text", "").trim().is_empty() {
        return Err("请输入要朗读的文字 / Enter some text".into());
    }
    if tool == "markdown-to-pdf" && inputs.is_empty() && text(&payload, "text", "").trim().is_empty() {
        return Err("没有可转换的 Markdown 内容：请上传 .md 文件或粘贴 Markdown 源码".into());
    }
    for (p, _) in &inputs {
        let m = std::fs::metadata(p).map_err(|e| format!("找不到文件：{e}"))?;
        if !m.is_file() {
            return Err("文件不存在 / File is missing".into());
        }
    }

    if let Some(o) = payload.as_object_mut() {
        o.remove("__files");
        o.remove("__path");
        o.remove("__method");
        // 密码不写进任务记录（任务列表会持久化到磁盘）
        for k in ["password", "user_password", "owner_password"] {
            if o.contains_key(k) {
                o.insert(k.into(), json!("***"));
            }
        }
        o.insert("files".into(), json!(inputs.iter().map(|(p, _)| p.to_string_lossy()).collect::<Vec<_>>()));
    }
    let secrets = args.clone();

    let job = crate::jobs::create_local_job(app, &tool, payload.clone())?;
    let id = job.get("id").and_then(Value::as_str).ok_or("建任务失败")?.to_string();

    let app_bg = app.clone();
    let id_bg = id.clone();
    std::thread::Builder::new()
        .name("native-doc".into())
        .spawn(move || {
            let ctx = Ctx { app: &app_bg, id: &id_bg };
            ctx.progress(5, "正在读取文件…");
            let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| run(&ctx, &tool, &inputs, &secrets)))
                .unwrap_or_else(|_| Err("处理时发生内部错误（文件可能已损坏）".into()));
            if ctx.cancelled() {
                return;
            }
            let mut m = Map::new();
            match result {
                Ok(d) => {
                    m.insert("status".into(), json!("completed"));
                    m.insert("progress".into(), json!(100));
                    m.insert("message".into(), json!(d.message));
                    m.insert("resultPath".into(), json!(d.path.to_string_lossy()));
                    m.insert("resultFilename".into(), json!(d.filename));
                    m.insert("resultMimeType".into(), json!(d.mime));
                    if let Ok(meta) = std::fs::metadata(&d.path) {
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

fn run(ctx: &Ctx, tool: &str, inputs: &[(PathBuf, String)], p: &Value) -> Result<Done, String> {
    match tool {
        "text-to-speech" => {
            let comps = crate::api::components_dir(ctx.app)?;
            ctx.progress(15, "正在合成语音…");
            let (o, message) = crate::tts_native::synthesize(
                &comps,
                p,
                &|n: &str| ctx.out(n),
                &|| ctx.cancelled(),
                &|pct: u32| ctx.progress(pct, "正在合成语音…"),
            )?;
            Ok(Done { path: o.path, filename: format!("语音.{}", o.ext), mime: o.mime.into(), message })
        }
        "ppt-from-outline" => {
            ctx.progress(20, "正在生成 PPT…");
            let filename = "AI生成草稿.pptx".to_string();
            let out = ctx.out(&filename)?;
            // 前端可能直接传 JSON 对象，也可能传字符串
            let outline_owned = match p.get("outline") {
                Some(Value::String(v)) => v.clone(),
                Some(v @ (Value::Object(_) | Value::Array(_))) => v.to_string(),
                _ => String::new(),
            };
            let outline = outline_owned.as_str();
            let theme = text(p, "theme", "business");
            let with_toc = match p.get("with_toc") {
                Some(Value::Bool(b)) => *b,
                Some(Value::String(v)) => !matches!(v.trim().to_ascii_lowercase().as_str(), "false" | "0" | "no" | "off"),
                _ => true,
            };
            let slides = crate::ppt_build::build_from_json(outline, &out, theme, with_toc)?;
            Ok(Done {
                path: out,
                filename,
                mime: "application/vnd.openxmlformats-officedocument.presentationml.presentation".into(),
                message: format!("已生成 {slides} 页可编辑草稿"),
            })
        }
        "pdf-reorder" => {
            let (src, name) = &inputs[0];
            let stem = stem_of(name, "document");
            let filename = format!("{stem}_reordered.pdf");
            let out = ctx.out(&filename)?;
            ctx.progress(30, "正在重排页面…");
            let msg = dc::pdf_reorder(src, &out, text(p, "order", ""))?;
            Ok(Done { path: out, filename, mime: "application/pdf".into(), message: msg })
        }
        "pdf-unlock" => {
            let (src, name) = &inputs[0];
            let stem = stem_of(name, "document");
            let filename = format!("{stem}_unlocked.pdf");
            let out = ctx.out(&filename)?;
            ctx.progress(30, "正在解锁…");
            let msg = dc::pdf_unlock(src, &out, text(p, "password", ""))?;
            Ok(Done { path: out, filename, mime: "application/pdf".into(), message: msg })
        }
        "pdf-encrypt" => {
            let (src, name) = &inputs[0];
            let stem = stem_of(name, "document");
            let filename = format!("{stem}_encrypted.pdf");
            let out = ctx.out(&filename)?;
            ctx.progress(30, "正在加密…");
            let user = text(p, "user_password", text(p, "password", ""));
            let owner = text(p, "owner_password", "");
            let msg = dc::pdf_encrypt(src, &out, user, owner)?;
            Ok(Done { path: out, filename, mime: "application/pdf".into(), message: msg })
        }
        "pdf-crop" => pdf_crop(ctx, &inputs[0], p),
        "image-watermark" => image_watermark(ctx, inputs, p),
        "csv-excel" => csv_excel(ctx, &inputs[0], p),
        "markdown-to-pdf" => markdown_pdf(ctx, inputs.first(), p),
        other => Err(format!("不支持的工具：{other}")),
    }
}

// ───────────────────────── pdf-crop ─────────────────────────

fn pdf_crop(ctx: &Ctx, input: &(PathBuf, String), p: &Value) -> Result<Done, String> {
    let (src, name) = input;
    let stem = stem_of(name, "document");
    let filename = format!("{stem}_cropped.pdf");
    let out = ctx.out(&filename)?;
    ctx.progress(30, "正在裁剪页面…");

    let mut per_page: HashMap<usize, dc::Margins> = HashMap::new();
    let raw = p.get("per_page").cloned().unwrap_or(Value::Null);
    let parsed = match raw {
        Value::String(s) if !s.trim().is_empty() => serde_json::from_str::<Value>(&s).ok(),
        Value::Object(_) => Some(raw),
        _ => None,
    };
    let unit;
    let mut default = None;
    if let Some(Value::Object(map)) = parsed {
        unit = text(p, "unit", "mm").to_string();
        for (k, v) in map {
            if let Ok(n) = k.trim().parse::<usize>() {
                let get = |key: &str| number(&v, key, 0.0).max(0.0);
                per_page.insert(n, dc::Margins { top: get("top"), bottom: get("bottom"), left: get("left"), right: get("right") });
            }
        }
    } else {
        // 老版界面：四个统一边距 + 页码范围
        unit = text(p, "unit", "percent").to_string();
        let m = dc::Margins {
            top: number(p, "top", 0.0).max(0.0),
            bottom: number(p, "bottom", 0.0).max(0.0),
            left: number(p, "left", 0.0).max(0.0),
            right: number(p, "right", 0.0).max(0.0),
        };
        let pages = text(p, "pages", "").trim().to_string();
        let set = if pages.is_empty() || pages == "all" {
            None
        } else {
            let total = lopdf::Document::load(src).map(|d| d.get_pages().len()).unwrap_or(9999);
            Some(dc::parse_page_list(&pages, total)?.into_iter().collect::<HashSet<_>>())
        };
        default = Some((m, set));
    }
    let msg = dc::pdf_crop(src, &out, &per_page, default, if unit == "percent" { "percent" } else { "mm" })?;
    Ok(Done { path: out, filename, mime: "application/pdf".into(), message: msg })
}

// ───────────────────────── image-watermark ─────────────────────────

/// 依次尝试多个字段名（前端会同时发 font_size / fontSize / size 等别名），取第一个有效数字
fn first_num(p: &Value, keys: &[&str], default: f64, skip_zero: bool) -> f64 {
    for k in keys {
        let v = number(p, k, f64::NAN);
        if v.is_finite() && !(skip_zero && v == 0.0) {
            return v;
        }
    }
    default
}

fn image_watermark(ctx: &Ctx, inputs: &[(PathBuf, String)], p: &Value) -> Result<Done, String> {
    let text_val = text(p, "text", "FurinaKit").to_string();
    if text_val.trim().is_empty() {
        return Err("请填写水印文字".into());
    }
    let font_px = first_num(p, &["actual_font_size", "font_size", "fontSize", "size"], 36.0, true).clamp(4.0, 2000.0) as u32;
    let rotate = first_num(p, &["rotate", "angle", "rotation"], 0.0, false) as f32;
    let xp = first_num(p, &["x_percent", "x"], -1.0, false) as f32;
    let yp = first_num(p, &["y_percent", "y"], -1.0, false) as f32;
    let params = dc::WatermarkParams {
        position: text(p, "position", "bottom-right").to_string(),
        font_px,
        opacity: number(p, "opacity", 50.0) as f32,
        color: dc::parse_hex_color(text(p, "color", "#ffffff")),
        rotate_deg: rotate,
        x_percent: xp,
        y_percent: yp,
    };
    ctx.progress(15, "正在渲染水印文字…");
    let mask = crate::pdf_native::render_text_image(&text_val, font_px)?;

    let total = inputs.len();
    let mut outputs: Vec<(PathBuf, String, &'static str)> = Vec::new();
    for (i, (src, name)) in inputs.iter().enumerate() {
        ctx.progress(20 + (i * 70 / total.max(1)) as u32, &format!("处理中 {}/{total}：{name}", i + 1));
        let mut img = dc::open_oriented(src)?.to_rgba8();
        dc::apply_image_watermark(&mut img, &mask, &params);
        let ext = match ext_of(name).as_str() {
            "" => "png".to_string(),
            e => e.to_string(),
        };
        let fname = format!("{}_watermarked.{ext}", stem_of(name, "image"));
        let out = ctx.out(&fname)?;
        let (real, mime) = dc::save_by_ext(&img, &out)?;
        let real_name = if real != out { Path::new(&fname).with_extension("png").to_string_lossy().to_string() } else { fname };
        outputs.push((real, real_name, mime));
    }
    if outputs.len() == 1 {
        let (path, filename, mime) = outputs.pop().unwrap();
        return Ok(Done { path, filename, mime: mime.into(), message: "水印已添加".into() });
    }
    ctx.progress(92, "正在打包…");
    let mut z = crate::mini_zip::ZipWriter::new();
    let mut used = HashSet::new();
    for (path, name, _) in &outputs {
        let mut n = name.clone();
        let mut k = 2;
        while !used.insert(n.clone()) {
            n = format!("{}_{k}.{}", stem_of(name, "image"), ext_of(name));
            k += 1;
        }
        z.add(&n, &std::fs::read(path).map_err(|e| e.to_string())?)?;
    }
    let filename = "watermarked_images.zip".to_string();
    let out = ctx.out(&filename)?;
    std::fs::write(&out, z.finish()).map_err(|e| format!("写出压缩包失败：{e}"))?;
    for (path, _, _) in &outputs {
        let _ = std::fs::remove_file(path);
    }
    Ok(Done { path: out, filename, mime: "application/zip".into(), message: format!("已为 {total} 张图片添加水印") })
}

// ───────────────────────── csv-excel ─────────────────────────

fn csv_excel(ctx: &Ctx, input: &(PathBuf, String), p: &Value) -> Result<Done, String> {
    let (src, name) = input;
    // 按原始文件名判断方向（落盘文件名可能带批次前缀）
    let direction = dc::resolve_direction(Path::new(name), text(p, "direction", "auto"))?;
    let has_header = dc::parse_has_header(p.get("has_header"));
    let sheet = p.get("sheet").and_then(Value::as_str).filter(|s| !s.trim().is_empty());
    let stem = stem_of(name, "converted");
    ctx.progress(35, "正在转换表格…");
    if direction == "to-xlsx" {
        let filename = format!("{stem}.xlsx");
        let out = ctx.out(&filename)?;
        let msg = dc::csv_to_xlsx(src, &out, sheet, text(p, "delimiter", "auto"), has_header)?;
        Ok(Done { path: out, filename, mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet".into(), message: msg })
    } else {
        let filename = format!("{stem}.csv");
        let out = ctx.out(&filename)?;
        let msg = dc::xlsx_to_csv(src, &out, sheet, has_header)?;
        Ok(Done { path: out, filename, mime: "text/csv".into(), message: msg })
    }
}

// ───────────────────────── markdown-to-pdf ─────────────────────────

fn markdown_pdf(ctx: &Ctx, input: Option<&(PathBuf, String)>, p: &Value) -> Result<Done, String> {
    let (md, stem) = match input {
        Some((src, name)) => {
            let data = std::fs::read(src).map_err(|e| format!("无法读取 Markdown 文件：{e}"))?;
            if data.len() > 5 * 1024 * 1024 {
                return Err(format!("Markdown 文件太大（{:.1} MB），超过 5 MB 上限", data.len() as f64 / 1048576.0));
            }
            (dc::decode_text_bytes(&data).0, stem_of(name, "document"))
        }
        None => (text(p, "text", "").to_string(), "document".to_string()),
    };
    if md.trim().is_empty() {
        return Err("没有可转换的 Markdown 内容".into());
    }
    let size_raw = number(p, "font_size", 12.0);
    if !(6.0..=72.0).contains(&size_raw) {
        return Err(format!("字号必须在 6 到 72 之间，收到的是 {size_raw}"));
    }
    let page = match text(p, "page_size", "a4").trim().to_lowercase().as_str() {
        "letter" | "us-letter" | "usletter" | "信纸" => "letter",
        "a4" | "" | "a4纸" | "iso-a4" => "a4",
        other => return Err(format!("不支持的纸张尺寸：「{other}」，仅支持 a4 或 letter")),
    };
    ctx.progress(30, "正在排版…");
    let html = dc::markdown_to_html(&md, &stem, page, size_raw);
    let work = std::env::temp_dir().join(format!("fk-md-{}", ctx.id));
    std::fs::create_dir_all(&work).map_err(|e| format!("创建临时目录失败：{e}"))?;
    let html_path = work.join("doc.html");
    std::fs::write(&html_path, html.as_bytes()).map_err(|e| format!("写临时文件失败：{e}"))?;
    let filename = format!("{stem}.pdf");
    let out = ctx.out(&filename)?;
    let _ = std::fs::remove_file(&out);
    ctx.progress(55, "正在生成 PDF（调用系统 Edge/Chrome 渲染）…");
    let url = crate::webcap::normalize_target(&html_path.to_string_lossy(), true)?;
    let r = crate::webcap::print_to_pdf(&url, &out, false, true, 1500);
    let _ = std::fs::remove_dir_all(&work);
    r?;
    let pages = lopdf::Document::load(&out).map(|d| d.get_pages().len()).unwrap_or(0);
    Ok(Done {
        path: out,
        filename,
        mime: "application/pdf".into(),
        message: format!(
            "Markdown 已转换为 PDF（{pages} 页，{} 纸，正文 {size_raw} 号字）",
            if page == "letter" { "Letter" } else { "A4" }
        ),
    })
}
