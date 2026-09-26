//! PPT 素材提取 / 文字提取 / 压缩 / 转图片 / 转PDF：Rust 原生与 Windows COM 实现（去 Python 化）。
//!
//! 原来走 Python worker（services/worker/app/tools/ppt_tools.py, ppt_render.py, office_to_pdf.py），
//! 现迁移至纯 Rust + Windows inbox COM (PowerPoint/WPS)，免除 python-pptx 及庞大 Python 运行时。

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

use crate::matting_native::{number, results_path, text};

pub fn supported(tool: &str) -> bool {
    matches!(
        tool,
        "ppt-extract-media"
            | "ppt-extract-text"
            | "ppt-compress"
            | "ppt-to-images"
            | "ppt-to-pdf"
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

pub fn run_ps(script: &str) -> Result<String, String> {
    let script_path = std::env::temp_dir().join(format!("fk_ps_{}.ps1", uuid::Uuid::new_v4().simple()));
    // Windows PowerShell 5.1 读取无 BOM 的 .ps1 会按系统 ANSI(GBK) 解码，中文路径会变成乱码
    // （“调解书.pdf”→“璋冭В涔?pdf”），导致 Office/PPT 全部“输出为空”。必须写 UTF-8 BOM。
    let mut bytes = Vec::with_capacity(script.len() + 128);
    bytes.extend_from_slice(b"\xEF\xBB\xBF");
    bytes.extend_from_slice(b"try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}\r\n");
    bytes.extend_from_slice(script.as_bytes());
    fs::write(&script_path, &bytes).map_err(|e| format!("写入临时 PowerShell 脚本失败: {e}"))?;

    let mut cmd = Command::new("powershell.exe");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let output = cmd
        .arg("-NoProfile")
        .arg("-NonInteractive")
        .arg("-ExecutionPolicy")
        .arg("Bypass")
        .arg("-File")
        .arg(&script_path)
        .output();

    let _ = fs::remove_file(&script_path);

    let output = output.map_err(|e| format!("执行 PowerShell 失败: {e}"))?;

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr);
        return Err(if err.trim().is_empty() {
            String::from_utf8_lossy(&output.stdout).to_string()
        } else {
            err.to_string()
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
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
                let p = s.get("path").and_then(Value::as_str).ok_or("缺少上传的 PPT 文件")?;
                let n = s.get("name").and_then(Value::as_str).unwrap_or("presentation.pptx").to_string();
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
                let n = p.file_name().map(|x| x.to_string_lossy().to_string()).unwrap_or_else(|| "presentation.pptx".into());
                (p, n)
            })
            .collect()
    };

    if inputs.is_empty() {
        return Err("请选择 PPT 文件 / Select a PowerPoint presentation".into());
    }
    for (p, _) in &inputs {
        let m = std::fs::metadata(p).map_err(|e| format!("找不到文件：{e}"))?;
        if !m.is_file() || m.len() == 0 {
            return Err("PPT 文件为空或不存在 / PPT file is empty or missing".into());
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
        .name("native-ppt".into())
        .spawn(move || {
            crate::matting_native::progress(&app_bg, &id_bg, 5, "正在读取 PPT 演示文稿…");
            let ctx = Ctx { app: &app_bg, id: &id_bg };
            let result = match tool.as_str() {
                "ppt-extract-media" => extract_media(&ctx, &inputs[0], &payload),
                "ppt-extract-text" => extract_text(&ctx, &inputs[0], &payload),
                "ppt-compress" => compress_ppt(&ctx, &inputs[0], &payload),
                "ppt-to-images" => to_images(&ctx, &inputs[0], &payload),
                "ppt-to-pdf" => to_pdf(&ctx, &inputs[0], &payload),
                other => Err(format!("不支持的 PPT 原生工具：{other}")),
            };

            if ctx.cancelled() {
                return;
            }

            let mut m = Map::new();
            match result {
                Ok(r) => {
                    m.insert("status".into(), json!("completed"));
                    m.insert("progress".into(), json!(100));
                    m.insert("message".into(), r.get("message").cloned().unwrap_or(json!("PPT 处理完成")));
                    m.insert("resultPath".into(), r.get("path").cloned().unwrap_or(json!("")));
                    m.insert("resultFilename".into(), r.get("filename").cloned().unwrap_or(json!("")));
                    m.insert("resultMimeType".into(), r.get("mime").cloned().unwrap_or(json!("application/octet-stream")));
                    if let Ok(meta) = std::fs::metadata(r.get("path").and_then(Value::as_str).unwrap_or("")) {
                        m.insert("resultBytes".into(), json!(meta.len()));
                    }
                    m.insert("engine".into(), json!("rust-com"));
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
    Ok(json!({ "job": current, "ok": true, "engine": "rust-com" }))
}

// ───────────────────────── 素材提取 ─────────────────────────

fn extract_media(ctx: &Ctx, input: &(PathBuf, String), _payload: &Value) -> Result<Value, String> {
    ctx.progress(15, "正在解压 PPTX 包结构…");
    let storage = crate::jobs::storage_dir_of(ctx.app);
    let scratch = crate::image_artifacts::Scratch::create(&storage.join("tmp"), &format!("ppt-media-{}", ctx.id))?;

    let src_str = input.0.to_string_lossy();
    let dest_str = scratch.0.to_string_lossy();

    let ps_script = format!(
        r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$src = [System.IO.Path]::GetFullPath('{src}')
$dest = [System.IO.Path]::GetFullPath('{dest}')
[System.IO.Compression.ZipFile]::ExtractToDirectory($src, $dest)
"#,
        src = src_str.replace("'", "''"),
        dest = dest_str.replace("'", "''")
    );
    run_ps(&ps_script)?;

    ctx.progress(45, "正在扫描并去重媒体素材…");
    let media_dir = scratch.0.join("ppt").join("media");
    if !media_dir.exists() {
        return Err("该演示文稿未包含任何图片、音视频等媒体素材 / No media found".into());
    }

    let mut entries: Vec<(String, PathBuf)> = Vec::new();
    let mut seen_hashes = BTreeSet::new();

    let read_dir = fs::read_dir(&media_dir).map_err(|e| e.to_string())?;
    for item in read_dir {
        let entry = item.map_err(|e| e.to_string())?;
        let p = entry.path();
        if p.is_file() {
            let bytes = fs::read(&p).map_err(|e| e.to_string())?;
            let mut hasher = Sha256::new();
            hasher.update(&bytes);
            let hash = format!("{:x}", hasher.finalize());
            if seen_hashes.insert(hash) {
                let name = p.file_name().map(|x| x.to_string_lossy().to_string()).unwrap_or_else(|| "media".into());
                entries.push((name, p));
            }
        }
    }

    if entries.is_empty() {
        return Err("该演示文稿未包含可用媒体素材 / No media extracted".into());
    }

    ctx.progress(80, "正在打包素材文件…");
    let stem = Path::new(&input.1).file_stem().and_then(|s| s.to_str()).unwrap_or("presentation");
    let out_name = format!("{stem}_素材.zip");
    let archive = results_path(ctx.app, ctx.id, &out_name)?;

    crate::image_artifacts::zip(&entries, &archive, &|| if ctx.cancelled() { Err("任务已取消".into()) } else { Ok(()) })?;

    Ok(done(&archive, &out_name, "application/zip", format!("共提取 {} 个素材文件（已自动去重）", entries.len())))
}

// ───────────────────────── 文字提取 ─────────────────────────

fn extract_text(ctx: &Ctx, input: &(PathBuf, String), payload: &Value) -> Result<Value, String> {
    ctx.progress(15, "正在解析演示文稿页面文本…");
    let storage = crate::jobs::storage_dir_of(ctx.app);
    let scratch = crate::image_artifacts::Scratch::create(&storage.join("tmp"), &format!("ppt-text-{}", ctx.id))?;

    let src_str = input.0.to_string_lossy();
    let dest_str = scratch.0.to_string_lossy();

    let ps_script = format!(
        r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$src = [System.IO.Path]::GetFullPath('{src}')
$dest = [System.IO.Path]::GetFullPath('{dest}')
[System.IO.Compression.ZipFile]::ExtractToDirectory($src, $dest)
"#,
        src = src_str.replace("'", "''"),
        dest = dest_str.replace("'", "''")
    );
    run_ps(&ps_script)?;

    let slides_dir = scratch.0.join("ppt").join("slides");
    if !slides_dir.exists() {
        return Err("无法找到幻灯片结构 / No slides found".into());
    }

    let fmt = text(payload, "format", "md");
    let include_notes = text(payload, "include_notes", "true") == "true";

    let mut slide_files: Vec<PathBuf> = Vec::new();
    for entry in fs::read_dir(&slides_dir).map_err(|e| e.to_string())? {
        let p = entry.map_err(|e| e.to_string())?.path();
        if p.is_file() && p.extension().map(|e| e == "xml").unwrap_or(false) {
            slide_files.push(p);
        }
    }
    slide_files.sort_by_key(|p| {
        let name = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
        name.trim_start_matches("slide").parse::<u32>().unwrap_or(0)
    });

    let mut notes_by_num: BTreeMap<u32, String> = BTreeMap::new();
    if include_notes {
        let notes_dir = scratch.0.join("ppt").join("notesSlides");
        if notes_dir.exists() {
            if let Ok(entries) = fs::read_dir(&notes_dir) {
                for entry in entries.flatten() {
                    let p = entry.path();
                    if p.is_file() && p.extension().map(|e| e == "xml").unwrap_or(false) {
                        let name = p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
                        let num = name.trim_start_matches("notesSlide").parse::<u32>().unwrap_or(0);
                        if let Ok(content) = fs::read_to_string(&p) {
                            let mut ntexts = Vec::new();
                            let mut rest = content.as_str();
                            while let Some(start) = rest.find("<a:t>") {
                                let after = &rest[start + 5..];
                                if let Some(end) = after.find("</a:t>") {
                                    let txt = &after[..end];
                                    if !txt.trim().is_empty() {
                                        ntexts.push(txt.trim().to_string());
                                    }
                                    rest = &after[end + 6..];
                                } else {
                                    break;
                                }
                            }
                            if !ntexts.is_empty() {
                                notes_by_num.insert(num, ntexts.join(" "));
                            }
                        }
                    }
                }
            }
        }
    }

    let mut full_output = String::new();
    let total = slide_files.len();

    for (idx, slide_path) in slide_files.iter().enumerate() {
        let content = fs::read_to_string(slide_path).unwrap_or_default();
        let mut slide_texts = Vec::new();

        // 提取 <a:t>...</a:t> 标签中的文字
        let mut rest = content.as_str();
        while let Some(start) = rest.find("<a:t>") {
            let after = &rest[start + 5..];
            if let Some(end) = after.find("</a:t>") {
                let txt = &after[..end];
                if !txt.trim().is_empty() {
                    slide_texts.push(txt.to_string());
                }
                rest = &after[end + 6..];
            } else {
                break;
            }
        }

        let slide_no = (idx + 1) as u32;
        if fmt == "md" {
            full_output.push_str(&format!("## 第 {} 页\n\n", slide_no));
            for t in &slide_texts {
                full_output.push_str(&format!("- {t}\n"));
            }
            if let Some(note) = notes_by_num.get(&slide_no) {
                full_output.push_str(&format!("\n> **备注**: {note}\n"));
            }
            full_output.push('\n');
        } else {
            full_output.push_str(&format!("=== 第 {} 页 ===\n", slide_no));
            for t in &slide_texts {
                full_output.push_str(&format!("{t}\n"));
            }
            if let Some(note) = notes_by_num.get(&slide_no) {
                full_output.push_str(&format!("【备注】: {note}\n"));
            }
            full_output.push('\n');
        }
    }

    let stem = Path::new(&input.1).file_stem().and_then(|s| s.to_str()).unwrap_or("presentation");
    let ext = if fmt == "txt" { "txt" } else { "md" };
    let out_name = format!("{stem}_文字.{ext}");
    let out_file = results_path(ctx.app, ctx.id, &out_name)?;

    fs::write(&out_file, full_output.as_bytes()).map_err(|e| format!("保存失败: {e}"))?;

    Ok(done(&out_file, &out_name, if ext == "txt" { "text/plain" } else { "text/markdown" }, format!("成功从 {} 页幻灯片提取文字", total)))
}

// ───────────────────────── PPT 压缩 ─────────────────────────

fn compress_ppt(ctx: &Ctx, input: &(PathBuf, String), payload: &Value) -> Result<Value, String> {
    ctx.progress(15, "正在解压演示文稿以优化资源…");
    let storage = crate::jobs::storage_dir_of(ctx.app);
    let scratch = crate::image_artifacts::Scratch::create(&storage.join("tmp"), &format!("ppt-compress-{}", ctx.id))?;

    let src_str = input.0.to_string_lossy();
    let dest_str = scratch.0.to_string_lossy();

    let ps_script = format!(
        r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$src = [System.IO.Path]::GetFullPath('{src}')
$dest = [System.IO.Path]::GetFullPath('{dest}')
[System.IO.Compression.ZipFile]::ExtractToDirectory($src, $dest)
"#,
        src = src_str.replace("'", "''"),
        dest = dest_str.replace("'", "''")
    );
    run_ps(&ps_script)?;

    let quality = number(payload, "quality", 75.0).clamp(30.0, 95.0) as u8;
    let max_width = number(payload, "max_width", 1920.0).clamp(800.0, 6000.0) as u32;

    let media_dir = scratch.0.join("ppt").join("media");
    let mut compressed_count = 0;

    if media_dir.exists() {
        for entry in fs::read_dir(&media_dir).map_err(|e| e.to_string())? {
            let p = entry.map_err(|e| e.to_string())?.path();
            if p.is_file() {
                let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
                if ext == "jpg" || ext == "jpeg" || ext == "png" {
                    // 必须保持与扩展名一致的编码格式：旧实现把 PNG 编码成 JPEG 却仍叫 .png，
                    // 还会丢掉透明通道，PowerPoint 打开会提示需要修复。
                    let old_len = fs::metadata(&p).map(|m| m.len() as usize).unwrap_or(0);
                    if let Ok(mut dyn_img) = image::open(&p) {
                        let (w, h) = (dyn_img.width(), dyn_img.height());
                        let resized = w > max_width;
                        if resized {
                            let new_h = ((h as f64) * (max_width as f64 / w as f64)).round().max(1.0) as u32;
                            dyn_img = dyn_img.resize_exact(max_width, new_h, image::imageops::FilterType::Lanczos3);
                        }
                        let mut buf = Vec::new();
                        let ok = if ext == "png" {
                            if !resized {
                                false // PNG 本身无损，未缩放时重新编码几乎不会变小，跳过
                            } else {
                                dyn_img.write_to(&mut std::io::Cursor::new(&mut buf), image::ImageFormat::Png).is_ok()
                            }
                        } else {
                            image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, quality)
                                .encode_image(&dyn_img.to_rgb8())
                                .is_ok()
                        };
                        if ok && !buf.is_empty() && buf.len() < old_len {
                            if fs::write(&p, buf).is_ok() {
                                compressed_count += 1;
                            }
                        }
                    }
                }
            }
        }
    }

    ctx.progress(80, "正在重新封装 PPTX…");
    let stem = Path::new(&input.1).file_stem().and_then(|s| s.to_str()).unwrap_or("presentation");
    let out_name = format!("{stem}_已压缩.pptx");
    let out_file = results_path(ctx.app, ctx.id, &out_name)?;

    let zip_script = format!(
        r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$dest = [System.IO.Path]::GetFullPath('{dest}')
$out = [System.IO.Path]::GetFullPath('{out}')
if (Test-Path $out) {{ Remove-Item -Force $out }}
[System.IO.Compression.ZipFile]::CreateFromDirectory($dest, $out)
"#,
        dest = dest_str.replace("'", "''"),
        out = out_file.to_string_lossy().replace("'", "''")
    );
    run_ps(&zip_script)?;

    let old_size = fs::metadata(&input.0).map(|m| m.len()).unwrap_or(0);
    let new_size = fs::metadata(&out_file).map(|m| m.len()).unwrap_or(0);
    let ratio = if old_size > 0 {
        ((1.0 - (new_size as f64 / old_size as f64)) * 100.0).max(0.0)
    } else {
        0.0
    };

    Ok(done(&out_file, &out_name, "application/vnd.openxmlformats-officedocument.presentationml.presentation", format!("压缩完成，减少了 {:.1}% 体积（共压缩 {} 张图片）", ratio, compressed_count)))
}

// ───────────────────────── PPT 转图片 (COM) ─────────────────────────

fn to_images(ctx: &Ctx, input: &(PathBuf, String), payload: &Value) -> Result<Value, String> {
    ctx.progress(15, "正在启动 Office / WPS 引擎导出图片…");
    let storage = crate::jobs::storage_dir_of(ctx.app);
    let scratch = crate::image_artifacts::Scratch::create(&storage.join("tmp"), &format!("ppt-imgs-{}", ctx.id))?;

    let width = number(payload, "width", 1920.0).clamp(320.0, 7680.0) as u32;
    let fmt = if text(payload, "format", "png").eq_ignore_ascii_case("jpg") { "jpg" } else { "png" };

    let src_str = input.0.to_string_lossy();
    let dest_str = scratch.0.to_string_lossy();

    // 逐页 Slide.Export 可以指定分辨率与格式（旧实现用 SaveAs(17) 会忽略宽度/格式设置）。
    let com_script = format!(
        r#"
$src = [System.IO.Path]::GetFullPath('{src}')
$out = [System.IO.Path]::GetFullPath('{out}')
$width = {width}
$fmt = '{fmt}'

$ppt = $null
try {{
    $ppt = New-Object -ComObject PowerPoint.Application
}} catch {{
    try {{
        $ppt = New-Object -ComObject KWPP.Application
    }} catch {{
        Write-Error "NO_OFFICE_INSTALLED"
        exit 12
    }}
}}

$pres = $null
try {{
    # Open(FileName, ReadOnly=msoTrue, Untitled=msoFalse, WithWindow=msoFalse)
    $pres = $ppt.Presentations.Open($src, -1, 0, 0)
    $sw = [double]$pres.PageSetup.SlideWidth
    $sh = [double]$pres.PageSetup.SlideHeight
    $height = [int][Math]::Round($width * $sh / $sw)
    $n = $pres.Slides.Count
    $filter = if ($fmt -eq 'jpg') {{ 'JPG' }} else {{ 'PNG' }}
    for ($i = 1; $i -le $n; $i++) {{
        $name = 'slide_{{0:D3}}.{{1}}' -f $i, $fmt
        $pres.Slides.Item($i).Export((Join-Path $out $name), $filter, $width, $height)
    }}
}} catch {{
    Write-Error "PPT_EXPORT_ERR: $_"
    exit 13
}} finally {{
    try {{ if ($pres) {{ $pres.Close() }} }} catch {{}}
    # PowerPoint 是单实例：用户自己开着 PPT 时不能把它一起关掉
    try {{ if ($ppt.Presentations.Count -eq 0) {{ $ppt.Quit() }} }} catch {{}}
}}
"#,
        src = src_str.replace("'", "''"),
        out = dest_str.replace("'", "''"),
        width = width,
        fmt = fmt
    );

    let res = run_ps(&com_script);
    if let Err(e) = res {
        if e.contains("NO_OFFICE_INSTALLED") {
            return Err("本机未检测到 Microsoft PowerPoint 或 WPS 演示，导出图片需要 Office 支持 / Microsoft PowerPoint or WPS required".into());
        }
        return Err(format!("导出图片失败：{e}"));
    }

    ctx.progress(70, "正在打包导出的幻灯片图片…");
    let mut entries: Vec<(String, PathBuf)> = Vec::new();
    if scratch.0.is_dir() {
        for item in fs::read_dir(&scratch.0).map_err(|e| e.to_string())? {
            let p = item.map_err(|e| e.to_string())?.path();
            let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
            if p.is_file() && (ext == "png" || ext == "jpg" || ext == "jpeg") {
                let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "slide.png".into());
                entries.push((name, p));
            }
        }
    }
    entries.sort_by(|a, b| a.0.cmp(&b.0));

    if entries.is_empty() {
        return Err("未成功生成图片，请确认 PPT 文件内容完整 / No slides exported".into());
    }

    let stem = Path::new(&input.1).file_stem().and_then(|s| s.to_str()).unwrap_or("presentation");
    let out_name = format!("{stem}_幻灯片图片.zip");
    let archive = results_path(ctx.app, ctx.id, &out_name)?;

    crate::image_artifacts::zip(&entries, &archive, &|| if ctx.cancelled() { Err("任务已取消".into()) } else { Ok(()) })?;

    Ok(done(&archive, &out_name, "application/zip", format!("成功导出 {} 张幻灯片图片", entries.len())))
}

// ───────────────────────── PPT 转 PDF (COM) ─────────────────────────

fn to_pdf(ctx: &Ctx, input: &(PathBuf, String), _payload: &Value) -> Result<Value, String> {
    ctx.progress(15, "正在调用 Office / WPS 引擎转换为 PDF…");
    let stem = Path::new(&input.1).file_stem().and_then(|s| s.to_str()).unwrap_or("presentation");
    let out_name = format!("{stem}.pdf");
    let out_file = results_path(ctx.app, ctx.id, &out_name)?;

    let src_str = input.0.to_string_lossy();
    let dest_str = out_file.to_string_lossy();

    let com_script = format!(
        r#"
$src = [System.IO.Path]::GetFullPath('{src}')
$out = [System.IO.Path]::GetFullPath('{out}')

$ppt = $null
try {{
    $ppt = New-Object -ComObject PowerPoint.Application
}} catch {{
    try {{
        $ppt = New-Object -ComObject KWPP.Application
    }} catch {{
        Write-Error "NO_OFFICE_INSTALLED"
        exit 12
    }}
}}

$pres = $null
try {{
    if (Test-Path -LiteralPath $out) {{ Remove-Item -LiteralPath $out -Force }}
    # Open(FileName, ReadOnly=msoTrue, Untitled=msoFalse, WithWindow=msoFalse)
    $pres = $ppt.Presentations.Open($src, -1, 0, 0)
    # 32 = ppSaveAsPDF
    $pres.SaveAs($out, 32)
}} catch {{
    Write-Error "PPT_PDF_ERR: $_"
    exit 13
}} finally {{
    try {{ if ($pres) {{ $pres.Close() }} }} catch {{}}
    try {{ if ($ppt.Presentations.Count -eq 0) {{ $ppt.Quit() }} }} catch {{}}
}}
"#,
        src = src_str.replace("'", "''"),
        out = dest_str.replace("'", "''")
    );

    let res = run_ps(&com_script);
    if let Err(e) = res {
        if e.contains("NO_OFFICE_INSTALLED") {
            return Err("本机未检测到 Microsoft PowerPoint 或 WPS 演示，转换 PDF 需要 Office 支持 / Microsoft PowerPoint or WPS required".into());
        }
        return Err(format!("转换 PDF 失败：{e}"));
    }

    if !out_file.exists() || fs::metadata(&out_file).map(|m| m.len()).unwrap_or(0) == 0 {
        return Err("PDF 转换输出失败，文件为空 / Output PDF is empty".into());
    }

    Ok(done(&out_file, &out_name, "application/pdf", "PPT 转 PDF 转换成功".into()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_native_ppt_structure_and_text() {
        let root = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).parent().unwrap().to_path_buf();
        let pptx = root.join("_verify/mcp-v28/fixtures/public.pptx");
        if !pptx.exists() {
            eprintln!("public.pptx not found at {:?}, skipping test", pptx);
            return;
        }

        let temp_dir = std::env::temp_dir().join("fk_test_ppt_text");
        let _ = fs::remove_dir_all(&temp_dir);
        let _ = fs::create_dir_all(&temp_dir);

        let ps_script = format!(
            r#"
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$src = [System.IO.Path]::GetFullPath('{src}')
$dest = [System.IO.Path]::GetFullPath('{dest}')
[System.IO.Compression.ZipFile]::ExtractToDirectory($src, $dest)
"#,
            src = pptx.to_string_lossy().replace("'", "''"),
            dest = temp_dir.to_string_lossy().replace("'", "''")
        );
        let res = run_ps(&ps_script);
        assert!(res.is_ok(), "run_ps failed: {:?}", res);

        let slides_dir = temp_dir.join("ppt").join("slides");
        assert!(slides_dir.exists(), "slides_dir must exist");

        let mut slide_count = 0;
        for entry in fs::read_dir(&slides_dir).unwrap().flatten() {
            if entry.path().extension().map(|e| e == "xml").unwrap_or(false) {
                slide_count += 1;
            }
        }
        assert!(slide_count >= 2, "Expected >= 2 slides, got {}", slide_count);

        // Check media
        let media_dir = temp_dir.join("ppt").join("media");
        assert!(media_dir.exists(), "media_dir must exist");
        let mut media_count = 0;
        for entry in fs::read_dir(&media_dir).unwrap().flatten() {
            if entry.path().is_file() {
                media_count += 1;
            }
        }
        assert!(media_count >= 1, "Expected >= 1 media file, got {}", media_count);

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_native_ppt_to_pdf_com() {
        let root = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).parent().unwrap().to_path_buf();
        let pptx = root.join("_verify/mcp-v28/fixtures/public.pptx");
        if !pptx.exists() {
            return;
        }

        let temp_dir = std::env::temp_dir().join("fk_test_ppt_pdf");
        let _ = fs::remove_dir_all(&temp_dir);
        let _ = fs::create_dir_all(&temp_dir);
        let out_pdf = temp_dir.join("test_out.pdf");

        let com_script = format!(
            r#"
$src = [System.IO.Path]::GetFullPath('{src}')
$out = [System.IO.Path]::GetFullPath('{out}')

$ppt = $null
try {{
    $ppt = New-Object -ComObject PowerPoint.Application
}} catch {{
    try {{
        $ppt = New-Object -ComObject KWPP.Application
    }} catch {{
        Write-Error "NO_OFFICE_INSTALLED"
        exit 12
    }}
}}

try {{
    $pres = $ppt.Presentations.Open($src, 2, 0, 0)
    $pres.SaveAs($out, 32)
    $pres.Close()
}} finally {{
    try {{ $ppt.Quit() }} catch {{}}
}}
"#,
            src = pptx.to_string_lossy().replace("'", "''"),
            out = out_pdf.to_string_lossy().replace("'", "''")
        );

        let res = run_ps(&com_script);
        assert!(res.is_ok(), "run_ps com_script failed: {:?}", res);
        assert!(out_pdf.exists(), "PDF file must exist");
        let pdf_len = fs::metadata(&out_pdf).map(|m| m.len()).unwrap_or(0);
        assert!(pdf_len > 1000, "PDF size must be > 1000 bytes, got {}", pdf_len);

        let _ = fs::remove_dir_all(&temp_dir);
    }
}

