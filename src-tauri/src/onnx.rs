// ONNX 推理（Rust 版）—— 迁移的第三块，也是最关键的一块
//
// 完成后：抠图、去水印、AI 扩图、超分、上色都能脱离 Python，
// 于是可以卸掉 Python 侧的 onnxruntime(40MB) + rapidocr(13MB) + OCR 模型(44MB)。
//
// ★ 预处理与后处理必须与 Python 侧**完全一致**，否则质量会掉。
//   权威依据是 Python 侧现在实际跑的 `services/worker/app/tools/isnet_matting.py`
//   与 `bg_remove.py`（它们本身是逐像素对比 rembg 调出来的），要点：
//     ① LANCZOS 缩放到模型要求的尺寸（从模型签名读：u2net 320×320、ISNet 1024×1024）
//     ② 归一化**只 /255**，不加 ImageNet 的 mean/std
//        （实测：只 /255 平均差 7.61；加了 mean/std 平均差 73.92，主体中心直接变 0）
//     ③ 排列成 NCHW float32
//     ④ 推理，取**第 0 个输出**
//     ⑤ 后处理用 **min-max 归一化，不是 sigmoid**（sigmoid 实测平均差 110.6）
//        最后用 LANCZOS 放回原图尺寸
//
// ★ 注意 ort 的版本坑（上一轮就是卡在这里）：
//   · ort 目前**只有预发布版**，Cargo.toml 里写 "2" 解析不到，必须写全 `2.0.0-rc.13`。
//   · rc.13 已经把 `Session::inputs()` / `outputs()` 公开了（rc.10 是私有的），
//     所以现在能直接读模型签名，不用再"按约定"写死输入名与尺寸。
//   · `try_extract_tensor` 返回的是**借用**，而 outputs 在语句结束后就没了，
//     链式写法会触发 E0716。必须先把数据拷成自己的 Vec。

use std::path::{Path, PathBuf};

use image::imageops::FilterType;
use image::{DynamicImage, GenericImageView, GrayImage, Luma};
use ort::session::builder::GraphOptimizationLevel;
use ort::session::Session;
use ort::value::{Tensor, ValueType};
use serde_json::{json, Value};

/// 从模型签名读输入尺寸；是动态维度（-1）时退回调用方给的兜底值
pub fn pick_size(session: &Session, fallback: u32) -> u32 {
    for outlet in session.inputs() {
        if let ValueType::Tensor { shape, .. } = outlet.dtype() {
            let dims: &[i64] = shape;
            if dims.len() == 4 && dims[2] > 0 {
                return dims[2] as u32;
            }
        }
    }
    fallback
}

/// 按模型文件名猜兜底尺寸（签名读不到时才用得上）
pub fn fallback_size_for(model_path: &Path) -> u32 {
    let name = model_path
        .file_name()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if name.contains("isnet") || name.contains("birefnet") {
        1024
    } else if name.contains("lama") {
        512
    } else {
        320
    }
}

fn load_session(model_path: &str) -> Result<Session, String> {
    let p = Path::new(model_path);
    if !p.is_file() {
        return Err(format!("模型文件不存在：{model_path}"));
    }
    // 与 Python 侧一致：ORT_ENABLE_ALL。注意 with_optimization_level 是按值消费 self，
    // 返回的是带「可恢复错误」的 BuilderResult，所以先 map_err 再继续建。
    let mut builder = Session::builder()
        .map_err(|e| format!("初始化 ONNX Runtime 失败：{e}"))?
        .with_optimization_level(GraphOptimizationLevel::All)
        .map_err(|e| format!("设置图优化级别失败：{e}"))?;
    builder
        .commit_from_file(p)
        .map_err(|e| format!("加载模型失败：{e}"))
}

/// 抠图核心：返回与原图同尺寸的 0~255 alpha。
///
/// 传入 `img` 而不是路径，是为了让调用方（例如批量抠图）只解码一次。
pub fn alpha_from_image(
    img: &DynamicImage,
    model_path: &str,
    fallback_size: u32,
) -> Result<Vec<u8>, String> {
    let mut session = load_session(model_path)?;
    let size = pick_size(&session, fallback_size);
    let (w0, h0) = img.dimensions();
    if w0 == 0 || h0 == 0 {
        return Err("图片尺寸是空的".into());
    }
    let input_name = session
        .inputs()
        .first()
        .map(|o| o.name().to_string())
        .ok_or_else(|| format!("模型没有输入：{model_path}"))?;

    // ① LANCZOS 缩放到模型要求的尺寸。
    // 先转成 RGB 丢掉 alpha：Python 侧 cv2.imdecode(IMREAD_COLOR) 也是丢掉 alpha 的，
    // 而且 image crate 的 resize 不做预乘，直接缩带 alpha 的图会在边缘出黑边。
    let rgb = img.to_rgb8();
    let small = image::imageops::resize(&rgb, size, size, FilterType::Lanczos3);

    // ② 只 /255（不加 ImageNet 的 mean/std）  ③ 排成 NCHW float32
    let plane = (size as usize) * (size as usize);
    let mut data = vec![0f32; 3 * plane];
    for (i, px) in small.pixels().enumerate() {
        data[i] = px[0] as f32 / 255.0;
        data[plane + i] = px[1] as f32 / 255.0;
        data[2 * plane + i] = px[2] as f32 / 255.0;
    }

    let tensor = Tensor::from_array(([1usize, 3, size as usize, size as usize], data))
        .map_err(|e| format!("构造输入张量失败：{e}"))?;

    // ④ 推理
    let outputs = session
        .run(ort::inputs![input_name.as_str() => tensor])
        .map_err(|e| format!("推理失败：{e}"))?;

    // 取第 0 个输出（Python 侧同样是 sess.run(None, ...)[0]）。
    // 立刻把形状与数据拷成自己的一份 —— try_extract_tensor 返回的是借用，
    // 把借用带出这个作用域就会报 E0716（上一轮卡住的地方）。
    let (mut dims, raw): (Vec<usize>, Vec<f32>) = {
        let value = outputs
            .iter()
            .next()
            .map(|(_, v)| v)
            .ok_or("模型没有输出")?;
        let (shape, data) = value
            .try_extract_tensor::<f32>()
            .map_err(|e| format!("读取输出失败：{e}（输出的可能不是 float32）"))?;
        (
            shape.iter().map(|d| *d as usize).collect::<Vec<usize>>(),
            data.to_vec(),
        )
    };

    // 输出形状可能是 [1,1,H,W]、[1,H,W]、[1,1,1,H,W]：照 Python 的 while out.ndim > 3 逐层剥
    while dims.len() > 3 {
        dims.remove(0);
    }
    if dims.len() == 2 {
        dims.insert(0, 1);
    }
    if dims.len() != 3 {
        return Err(format!("不认识的输出形状：{dims:?}"));
    }
    let (c, oh, ow) = (dims[0], dims[1], dims[2]);
    if oh == 0 || ow == 0 {
        return Err("模型输出是空的".into());
    }
    let n = oh * ow;
    let planes = if c == 0 { 1 } else { c };
    if raw.len() < n * planes {
        return Err(format!(
            "输出数据与形状对不上：形状 {dims:?} 需要 {} 个数，实际只有 {}",
            n * planes,
            raw.len()
        ));
    }

    // 单通道直接取；多通道按 Python 的做法取逐像素最大值（out.max(axis=0)）
    let mut logits = vec![f32::MIN; n];
    for ci in 0..planes {
        let base = ci * n;
        for i in 0..n {
            let v = raw[base + i];
            if v > logits[i] {
                logits[i] = v;
            }
        }
    }

    // ⑤ min-max 归一化（不是 sigmoid）
    let mut mi = f32::MAX;
    let mut ma = f32::MIN;
    for v in logits.iter() {
        if v.is_finite() {
            if *v < mi {
                mi = *v;
            }
            if *v > ma {
                ma = *v;
            }
        }
    }
    if mi == f32::MAX {
        return Err("模型输出全是无效值（NaN/Inf）".into());
    }
    let range = if (ma - mi).abs() < 1e-6 { 1.0 } else { ma - mi };

    let mut mask = GrayImage::new(ow as u32, oh as u32);
    for i in 0..n {
        // Python 是 (alpha * 255).astype(uint8)，即截断而不是四舍五入，这里保持一致
        let a = ((logits[i] - mi) / range).clamp(0.0, 1.0);
        mask.put_pixel((i % ow) as u32, (i / ow) as u32, Luma([(a * 255.0) as u8]));
    }

    // 放回原图尺寸（LANCZOS）
    let mask = if (ow as u32, oh as u32) != (w0, h0) {
        image::imageops::resize(&mask, w0, h0, FilterType::Lanczos3)
    } else {
        mask
    };
    Ok(mask.into_raw())
}

/// 纯色底的 RGB 值。**这里是 RGB 顺序（PIL/前端用的），不是 cv2 的 BGR。**
/// 取值与前端色卡一致（`bg-remove-tool.tsx` 的 preview）：
/// 纯白 #ffffff、纯黑 #000000、证件蓝 #438edb、证件红 #d92027。
///
/// 顺带记一笔：Python 侧 `tasks.py` 里那张表写的是 `"blue": (219, 68, 55)`，
/// 直接喂给 `Image.new("RGB", ...)` 会出来红色 —— 那是 BGR 顺序的残留，
/// `tools/bg_remove.py` 已经改成 RGB 了，但工具实际走的是 tasks.py 那条路。
/// Rust 这边按**用户在前端看到的那块颜色**来填，不做这种颠倒。
fn bg_rgb(name: &str) -> Option<[u8; 3]> {
    match name.trim() {
        "" => None,
        "white" => Some([255, 255, 255]),
        "black" => Some([0, 0, 0]),
        "blue" => Some([67, 142, 219]),
        "red" => Some([217, 32, 39]),
        "green" => Some([70, 165, 75]),
        "gray" => Some([200, 200, 200]),
        _ => Some([255, 255, 255]),
    }
}

/// 抠图并落盘到 `<storage>/results/`：透明底 PNG 或换成纯色底。
///
/// 命名与 Python 侧的 `_store_result` 一致：文件加 `<jobId>-` 前缀，
/// 而返回给前端的 `resultFilename` 是**不带前缀**的原始名。
pub fn remove_background(
    app: &tauri::AppHandle,
    image_path: &str,
    model_path: &str,
    bg_color: &str,
    job_id: Option<&str>,
) -> Result<Value, String> {
    let filename=Path::new(model_path).file_name().and_then(|s|s.to_str()).ok_or("Invalid model filename")?;
    let _component_lease=crate::api::component_use(app,&[filename])?;
    let bytes = std::fs::read(image_path).map_err(|e| format!("读不到图片：{e}"))?;
    let img = image::load_from_memory(&bytes).map_err(|e| format!("不是能识别的图片：{e}"))?;
    let (w, h) = img.dimensions();
    let fallback = fallback_size_for(Path::new(model_path));
    let alpha = alpha_from_image(&img, model_path, fallback)?;
    let rgb = img.to_rgb8();

    let bg = bg_rgb(bg_color);

    let mut out = image::RgbaImage::new(w, h);
    for y in 0..h {
        for x in 0..w {
            let a = alpha[(y * w + x) as usize];
            let p = rgb.get_pixel(x, y);
            let (r, g, b) = match bg {
                // 换纯色底：按 alpha 混合，输出不透明
                Some(c) => {
                    let f = a as f32 / 255.0;
                    (
                        (p[0] as f32 * f + c[0] as f32 * (1.0 - f)) as u8,
                        (p[1] as f32 * f + c[1] as f32 * (1.0 - f)) as u8,
                        (p[2] as f32 * f + c[2] as f32 * (1.0 - f)) as u8,
                    )
                }
                None => (p[0], p[1], p[2]),
            };
            out.put_pixel(x, y, image::Rgba([r, g, b, if bg.is_some() { 255 } else { a }]));
        }
    }

    let suffix = if bg.is_some() { "_已换底" } else { "_已抠图" };
    let stem = Path::new(image_path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "output".into());
    let plain_name = format!("{stem}{suffix}.png");
    let file_name = match job_id {
        Some(id) => format!("{id}-{plain_name}"),
        None => plain_name.clone(),
    };

    let dir = crate::jobs::storage_dir_of(app).join("results");
    std::fs::create_dir_all(&dir).map_err(|e| format!("建结果目录失败：{e}"))?;
    let path = dir.join(&file_name);
    out.save(&path).map_err(|e| format!("保存失败：{e}"))?;

    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    let center = {
        let cx = (w / 2) as usize;
        let cy = (h / 2) as usize;
        alpha[(cy * w as usize + cx).min(alpha.len() - 1)]
    };

    Ok(json!({
        "success": true,
        "output": path.to_string_lossy(),
        "path": path.to_string_lossy(),
        "filename": plain_name,
        "resultFilename": plain_name,
        "resultMimeType": "image/png",
        "message": format!(
            "{}（{}×{}，中心 alpha {}）",
            if bg.is_some() { "已抠出并换成纯色底" } else { "已抠出透明背景 PNG" },
            w, h, center
        ),
        "width": w, "height": h, "bytes": size, "centerAlpha": center,
        "engine": "rust-onnx",
    }))
}

/// 模型清单（供前端列出可用模型；界面还没接上，先留着）
#[allow(dead_code)]
pub fn available_models(app: &tauri::AppHandle) -> Result<Vec<Value>,String> {
    let dir = crate::api::components_dir(app)?;
    let known = [
        ("u2net.onnx", "u2net", "通用快速", 320u32),
        ("u2net_human_seg.onnx", "u2net_human_seg", "人像", 320),
        ("isnet-general-use.onnx", "isnet-general-use", "精细", 1024),
        ("lama_fp32.onnx", "lama", "去水印/扩图", 512),
        ("manga-colorize-fp16.onnx", "manga-colorize", "AI 上色", 512),
    ];
    let mut out = Vec::new();
    for (file, id, label, size) in known {
        let p = dir.join(file);
        out.push(json!({
            "id": id, "file": file, "label": label, "inputSize": size,
            "downloaded": p.is_file(),
            "bytes": std::fs::metadata(&p).map(|m| m.len()).unwrap_or(0),
            "path": p.to_string_lossy(),
        }));
    }
    Ok(out)
}

/// 诊断：给出模型的输入输出签名（排查形状/名字问题时用，命令行也能调）
pub fn describe(model_path: &str) -> Result<Value, String> {
    let session = load_session(model_path)?;
    let dump = |outlets: &[ort::value::Outlet]| -> Vec<Value> {
        outlets
            .iter()
            .map(|o| {
                let (ty, shape) = match o.dtype() {
                    ValueType::Tensor { ty, shape, .. } => {
                        (format!("{ty:?}"), shape.iter().map(|d| *d as i64).collect::<Vec<i64>>())
                    }
                    other => (format!("{other:?}"), Vec::new()),
                };
                json!({ "name": o.name(), "type": ty, "shape": shape })
            })
            .collect()
    };
    Ok(json!({
        "loaded": true,
        "inputs": dump(session.inputs()),
        "outputs": dump(session.outputs()),
        "sizeHint": pick_size(&session, 0),
    }))
}

/// 找到模型文件的完整路径。
/// 指定的没下载就退回任意一个已下载的可用模型（与 Python 侧 `_resolve_model` 一致）。
pub fn model_path(app: &tauri::AppHandle, id: &str) -> Result<PathBuf,String> {
    let dir = crate::api::components_dir(app)?;
    let file = match id {
        "u2net" => "u2net.onnx",
        "u2net_human_seg" => "u2net_human_seg.onnx",
        "isnet-general-use" | "isnet" => "isnet-general-use.onnx",
        "lama" => "lama_fp32.onnx",
        "manga-colorize" => "manga-colorize-fp16.onnx",
        other => return Ok(dir.join(format!("{other}.onnx"))),
    };
    let p = dir.join(file);
    if p.is_file() {
        return Ok(p);
    }
    for alt in ["isnet-general-use.onnx", "u2net.onnx", "u2net_human_seg.onnx"] {
        let q = dir.join(alt);
        if q.is_file() {
            return Ok(q);
        }
    }
    Ok(p)
}
