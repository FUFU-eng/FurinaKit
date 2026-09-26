// /api/* 的 Rust 实现
//
// 设计：**只注册一个 api_call 命令**，内部按路径分发。
// 这样以后每加一个接口，只改这个文件，不用动 tauri 的命令注册表。
//
// 前端（fetch-bridge.ts）把 fetch("/api/xxx") 转成：
//     invoke("api_call", { path: "/api/xxx", method: "GET", args: {...} })
//
// 已实现的：
//   /api/output-dir   读写「输出目录」设置
//   /api/components   列出/下载/删除按需下载的模型
//   /api/system/info  基本系统信息
// 其余路径统一返回 501，前端会明确显示「这个功能还没搬到 Tauri 版」。

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::Manager;

// Bound preview reads before base64/IPC allocation, including files growing mid-read.
const MAX_PREVIEW_BYTES: u64 = 32 * 1024 * 1024;

fn read_preview_bytes(reader: impl std::io::Read, limit: u64) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let mut bytes = Vec::new();
    reader.take(limit + 1).read_to_end(&mut bytes)
        .map_err(|e| format!("读预览失败：{e}"))?;
    if bytes.len() as u64 > limit {
        return Err("产物超过预览大小上限，请下载后查看".into());
    }
    Ok(bytes)
}

#[cfg(test)]
mod preview_tests {
    use super::read_preview_bytes;
    #[test]
    fn preview_read_boundaries() {
        assert_eq!(read_preview_bytes(&b""[..], 4).unwrap(), b"");
        assert_eq!(read_preview_bytes(&b"1234"[..], 4).unwrap(), b"1234");
        assert!(read_preview_bytes(&b"12345"[..], 4).is_err());
        let mut source = std::io::Cursor::new(vec![0; 100]);
        assert!(read_preview_bytes(&mut source, 4).is_err());
        assert_eq!(source.position(), 5);
    }
}

/// 应用数据目录（存设置文件）
fn data_dir(app: &tauri::AppHandle) -> PathBuf {
    let dir = app
        .path()
        .app_data_dir()
        .unwrap_or_else(|_| PathBuf::from("."));
    let _ = fs::create_dir_all(&dir);
    dir
}

/// 在系统 PATH 里找可执行文件（不引第三方库，就按 `;` 拆开逐个拼）
pub fn which_on_path(name: &str) -> Option<PathBuf> {
    if let Ok(path) = std::env::var("PATH") {
        for dir in path.split(';') {
            let dir = dir.trim().trim_matches('"');
            if dir.is_empty() {
                continue;
            }
            let p = PathBuf::from(dir).join(name);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}

/// 按扩展名猜 MIME（产物下载时给前端用）
fn mime_of(p: &Path) -> String {
    let ext = p
        .extension()
        .and_then(|x| x.to_str())
        .map(|s| s.to_lowercase())
        .unwrap_or_default();
    match ext.as_str() {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "bmp" => "image/bmp",
        "tif" | "tiff" => "image/tiff",
        "pdf" => "application/pdf",
        "zip" => "application/zip",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "flac" => "audio/flac",
        "m4a" => "audio/mp4",
        "mp4" => "video/mp4",
        "txt" => "text/plain",
        "json" => "application/json",
        "csv" => "text/csv",
        _ => "application/octet-stream",
    }
    .to_string()
}

/// All consumers and diagnostics use the same startup-pinned component location.
/// A failed initialization remains an explicit error; never create or choose a fallback here.
pub fn components_dir(_app: &tauri::AppHandle) -> Result<PathBuf,String> {
    crate::runtime_layout::registered_components_dir()
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ComponentInfo {
    pub id: String,
    pub name: String,
    pub purpose: String,
    pub file: String,
    pub size: u64,
    pub mirrors: Vec<String>,
    pub requirement: String,
    pub downloaded: bool,
    pub downloaded_bytes: u64,
    #[serde(default, rename = "filePath")]
    pub file_path: String,
    #[serde(default)]
    pub busy: bool,
}

impl ComponentInfo {
    fn inspect(&mut self, dir: &Path) {
        if self.id == crate::mdx_components::ID { crate::mdx_components::inspect(self, dir); return; }
        if self.id == crate::ffmpeg_components::ID { crate::ffmpeg_components::inspect(self, dir); return; }
        let path = dir.join(&self.file);
        let file_bytes = fs::metadata(&path).ok().filter(|m| m.is_file()).map(|m| m.len()).unwrap_or(0);
        let ready = file_bytes > 0 && file_bytes == self.size;
        let part_path = dir.join(format!("{}.part", self.file));
        let part_bytes = fs::metadata(&part_path).ok().filter(|m| m.is_file()).map(|m| m.len().min(self.size)).unwrap_or(0);
        self.downloaded_bytes = if ready { self.size } else if file_bytes > 0 { file_bytes } else { part_bytes };
        self.downloaded = ready;
        self.file_path = if self.downloaded { path.to_string_lossy().into_owned() } else { String::new() };
        self.busy = component_busy(&self.id);
    }
}

#[cfg(test)]
mod component_contract_tests {
    use super::*;
    #[test]
    fn ready_component_returns_worker_path_and_partial_files_do_not() {
        let root = std::env::temp_dir().join(format!("fk-component-{}", crate::jobs::new_job_id_public()));
        fs::create_dir_all(&root).unwrap();
        let mut model = component_specs().remove(0); model.size = 1000;
        model.inspect(&root); assert!(!model.downloaded); assert!(model.file_path.is_empty());
        fs::write(root.join(&model.file), vec![0; 20]).unwrap();
        model.inspect(&root); assert!(!model.downloaded); assert_eq!(model.downloaded_bytes, 20);
        fs::write(root.join(&model.file), vec![0; 1000]).unwrap();
        model.inspect(&root); assert!(model.downloaded);
        let json = serde_json::to_value(&model).unwrap();
        assert_eq!(json["filePath"].as_str().unwrap(), root.join(&model.file).to_string_lossy());
        fs::remove_file(root.join(&model.file)).unwrap();
        model.inspect(&root); assert!(!model.downloaded); assert!(model.file_path.is_empty());
        fs::remove_dir_all(root).unwrap();
    }
}

pub(crate) fn component_lease(app:&tauri::AppHandle, files:&[&str], mode:crate::component_leases::Mode)->Result<crate::component_leases::Lease,String>{
    let store=app.path().app_cache_dir().map_err(|e|e.to_string())?.join("component-leases-v1");
    crate::component_leases::acquire(&store,&components_dir(app)?,files,mode)
}
pub(crate) fn component_use(app:&tauri::AppHandle, files:&[&str])->Result<crate::component_leases::Lease,String>{
    component_lease(app,files,crate::component_leases::Mode::Use)
}
fn component_files(spec:&ComponentInfo)->Vec<&str>{
    if spec.id==crate::ffmpeg_components::ID{crate::ffmpeg_components::MODELS.iter().map(|m|m.file).collect()}
        else if spec.id==crate::mdx_components::ID{crate::mdx_components::MODELS.iter().map(|m|m.file).collect()}
        else{vec![spec.file.as_str()]}
}
/// Source workers conservatively reserve every managed resource for each actual job.
/// The namespace is resolved here, so Python does not guess Windows canonical path hashing.
pub(crate) fn configure_component_leases(app:&tauri::AppHandle,cmd:&mut Command)->Result<(),String>{
    let store=app.path().app_cache_dir().map_err(|e|e.to_string())?.join("component-leases-v1");
    let namespace=crate::component_leases::namespace(&store,&components_dir(app)?)?;
    let mut files:Vec<String>=component_specs().iter().flat_map(|s|component_files(s).into_iter().map(str::to_owned).collect::<Vec<_>>()).collect();
    files.extend(crate::tts_components::IDS.iter().map(|s|s.to_string()));
    cmd.env("FURINAKIT_COMPONENT_LEASE_NAMESPACE",namespace).env("FURINAKIT_COMPONENT_LEASE_FILES",serde_json::to_string(&files).map_err(|e|e.to_string())?);
    Ok(())
}
fn component_change(app:&tauri::AppHandle,dir:&Path,spec:&ComponentInfo)->Result<crate::component_leases::Lease,String>{
    let files=component_files(spec);
    let store=app.path().app_cache_dir().map_err(|e|e.to_string())?.join("component-leases-v1");
    crate::component_leases::acquire(&store,dir,&files,crate::component_leases::Mode::Change)
}

fn component_downloads() -> &'static std::sync::Mutex<std::collections::HashSet<String>> {
    static ACTIVE: std::sync::OnceLock<std::sync::Mutex<std::collections::HashSet<String>>> = std::sync::OnceLock::new();
    ACTIVE.get_or_init(|| std::sync::Mutex::new(std::collections::HashSet::new()))
}
pub(crate) fn component_busy(id:&str)->bool { component_downloads().lock().unwrap_or_else(|e|e.into_inner()).contains(id) }
struct ComponentLease(String);
impl Drop for ComponentLease { fn drop(&mut self) { component_downloads().lock().unwrap_or_else(|e|e.into_inner()).remove(&self.0); } }
// SHA-256 from the upstream Hugging Face LFS metadata; filenames alone are not integrity.
fn component_sha256(id: &str) -> Option<&'static str> {
    match id {
        "lama-inpaint" => Some("1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6"),
        "birefnet-matting" => Some("58f621f00f5d756097615970a88a791584600dcf7c45b18a0a6267535a1ebd3c"),
        "manga-colorize" => Some("39660d0047ea6f1a0ddee6aa89054997f95ea566f4d56ff762f66dbcf1a1a7ef"),
        "isnet-matting" => Some("60920e99c45464f2ba57bee2ad08c919a52bbf852739e96947fbb4358c0d964a"),
        "u2net-fast" => Some("8d10d2f3bb75ae3b6d527c77944fc5e7dcd94b29809d47a739a7a728a912b491"),
        _ => None,
    }
}
pub(crate) fn download_component(app: &tauri::AppHandle, id: &str) -> Result<Value,String> {
    let id = crate::mdx_components::canonical_id(id);
    let spec = component_specs().into_iter().find(|c|c.id==id).ok_or("没有这个模型")?;
    if !component_downloads().lock().map_err(|_|"下载状态异常")?.insert(id.into()) { return Err("此模型正在下载或等待辅助进程退出，请稍候（设置与工具共用同一下载任务）".into()); }
    let busy_guard=ComponentLease(id.into());
    let dir=components_dir(app)?;fs::create_dir_all(&dir).map_err(|e|e.to_string())?;let dir=fs::canonicalize(dir).map_err(|e|e.to_string())?;
    let resources: crate::resource_custody::SharedResource = std::sync::Arc::new((component_change(app,&dir,&spec)?, busy_guard));
    if id == crate::mdx_components::ID { return crate::mdx_components::download(&dir, resources); }
    if id == crate::ffmpeg_components::ID { return crate::ffmpeg_components::download(&dir, resources); }
    let target=dir.join(&spec.file);let part=dir.join(format!("{}.part",spec.file));
    let model=id.strip_prefix("whisper-").map(crate::speech::model).transpose()?;
    let valid=|path:&Path|->bool {
        if let Some(m)=model { return crate::speech::verify(path,m).is_ok(); }
        if !fs::symlink_metadata(path).map(|m|m.is_file()&&!m.file_type().is_symlink()&&m.len()==spec.size).unwrap_or(false) { return false; }
        component_sha256(id).map(|expected|crate::owned_tasks::digest(path).map(|hash|hash==expected).unwrap_or(false)).unwrap_or(true)
    };
    if valid(&target) { return Ok(json!({"ok":true,"message":"模型文件已就绪"})); }
    if target.exists() {
        fs::rename(&target,dir.join(format!("{}.invalid-{}",spec.file,crate::jobs::new_job_id_public()))).map_err(|e|format!("保留原模型失败：{e}"))?;
    }
    if valid(&part) { fs::rename(&part,&target).map_err(|e|e.to_string())?;return Ok(json!({"ok":true,"message":"已校验并恢复下载完成的模型"})); }
    let control=crate::owned_tasks::Control{request:std::sync::atomic::AtomicU8::new(0),engine:"component-download".into()};
    let mut error=String::new();
    for url in &spec.mirrors {
        let mut args=vec!["-f".into(),"-sS".into(),"-L".into(),"--ssl-no-revoke".into(),"--proto".into(),"=https".into(),"--proto-redir".into(),"=https".into()];
        if part.exists() && fs::metadata(&part).map(|m|m.len()>0).unwrap_or(false) {
            args.extend(["-C".into(),"-".into()]);
        }
        args.extend(["--retry".into(),"2".into(),"--connect-timeout".into(),"8".into(),"--speed-limit".into(),"20480".into(),"--speed-time".into(),"30".into(),"--max-time".into(),"7200".into(),"--max-filesize".into(),(spec.size.saturating_mul(2)).to_string(),"-o".into(),part.to_string_lossy().into_owned(),url.clone()]);
        let result=match crate::download_process::OwnedProcess::spawn(&crate::owned_tasks::system_tool("curl.exe")?,&args,&dir) {
            Ok(p) => {
                let p=crate::resource_custody::Custody::new(p, resources.clone());
                let outcome=crate::owned_tasks::wait(&p,&control,std::time::Duration::from_secs(3650));
                // No mirror retry or partial-file rename until the OLD tree is gone.
                p.after_exit(outcome)?
            },
            Err(error) => Err(error),
        };
        if result.is_ok() && valid(&part) { fs::rename(&part,&target).map_err(|e|format!("模型落盘失败：{e}"))?;return Ok(json!({"ok":true,"message":format!("{} 下载完成{}",spec.name,if model.is_some()||component_sha256(id).is_some(){"，SHA-256校验通过"}else{""})})); }
        error=result.err().unwrap_or_else(||"模型文件大小或SHA-256校验不符".into());
        if fs::metadata(&part).map(|m|m.len()>=spec.size).unwrap_or(false) { let _=fs::rename(&part,dir.join(format!("{}.invalid-{}",spec.file,crate::jobs::new_job_id_public()))); }
    }
    Err(format!("下载失败：{error}。需要可访问模型源的网络；未完成部分已保留，可稍后继续。"))
}

/// 按需下载的模型清单（与原 Electron 版一致）
fn component_specs() -> Vec<ComponentInfo> {
    let mk = |id: &str, name: &str, purpose: &str, file: &str, size: u64, mirrors: Vec<&str>, req: &str| ComponentInfo {
        id: id.into(),
        name: name.into(),
        purpose: purpose.into(),
        file: file.into(),
        size,
        mirrors: mirrors.into_iter().map(|s| s.to_string()).collect(),
        requirement: req.into(),
        downloaded: false,
        downloaded_bytes: 0,
        file_path: String::new(),
        busy: false,
    };
    let mut list = vec![
        mk(
            "lama-inpaint",
            "LaMa 大面积图像高频纹理修复与画面延展模型",
            "基于快速傅里叶卷积 (FFC) 神经架构的高精度图像修复引擎，针对大范围遮挡、复杂纹理连续性与长距离全局特征一致性深度优化，为局部消除水印、路人杂物抹除与无损画面向外智能扩展提供高质量像素推断。",
            "lama_fp32.onnx",
            208_044_816,
            vec![
                "https://www.modelscope.cn/models/codetrend/LaMa_Inpainting_Model_ONNX/resolve/master/lama_fp32.onnx",
                "https://www.modelscope.cn/models/tida1024/lama-onnx/resolve/master/lama_fp32.onnx",
                "https://hf-mirror.com/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx",
                "https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx",
            ],
            "纯 CPU 环境支持运行（单图约 10~25s）；支持独立显卡 DirectML / CUDA 硬件加速",
        ),
        mk(
            "isnet-matting",
            "ISNet 显著目标高精边缘发丝级抠图模型",
            "高分辨率两分目标分割 (DIS) 深度神经网络，在多级特征融合中强化高频边缘导数，对复杂发丝、半透明织物、反光边缘与细小网孔结构提供亚像素级 Alpha 遮罩生成。",
            "isnet-general-use.onnx",
            178_648_008,
            vec![
                "https://www.modelscope.cn/models/shiertier/rembg/resolve/master/isnet-general-use.onnx",
                "https://www.modelscope.cn/models/shiertier/ComfyUI-rembg/resolve/master/isnet-general-use.onnx",
                "https://gh-proxy.com/https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx",
                "https://ghproxy.net/https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx",
                "https://ghfast.top/https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx",
                "https://github.com/danielgatis/rembg/releases/download/v0.0.0/isnet-general-use.onnx",
            ],
            "建议可用内存 ≥ 1GB，纯 CPU 环境平均 3~8 秒完成单张高分辨率图像边缘提取",
        ),
        mk(
            "u2net-fast",
            "U²-Net 通用显著目标快速分割模型",
            "双层嵌套 U 型网络结构的通用轻量抠图引擎，无需预训练骨干网络即可高效捕获不同尺度的局部与全局特征。在保证轮廓准确度的同时具备极高吞吐率，适合常规素材与批量素材的极速预处理。",
            "u2net.onnx",
            175_997_641,
            vec![
                "https://www.modelscope.cn/models/AI-ModelScope/u2net/resolve/master/u2net.onnx",
                "https://www.modelscope.cn/models/shiertier/rembg/resolve/master/u2net.onnx",
                "https://gh-proxy.com/https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx",
                "https://ghproxy.net/https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx",
                "https://ghfast.top/https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx",
                "https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2net.onnx",
            ],
            "超低系统资源占用，通用 CPU 单图处理仅需 1~2 秒",
        ),
        mk(
            "birefnet-matting",
            "BiRefNet 超高分辨率双边参考图像抠图模型",
            "采用双边参考引导机制的前沿分割模型，集成双向高频细节重构与超大感受野特征融合模块，专为 4K/8K 级人像发丝与高精度工业级微距素材设计。",
            "birefnet.onnx",
            972_666_916,
            vec![
                "https://www.modelscope.cn/models/onnx-community/BiRefNet-ONNX/resolve/master/onnx/model.onnx",
                "https://www.modelscope.cn/models/onnx-community/BiRefNet-general-epoch_244/resolve/master/onnx/model.onnx",
                "https://hf-mirror.com/onnx-community/BiRefNet-ONNX/resolve/534d3c82d3bb8b2f0867db6dfbc3a525b8e42f67/onnx/model.onnx",
                "https://huggingface.co/onnx-community/BiRefNet-ONNX/resolve/534d3c82d3bb8b2f0867db6dfbc3a525b8e42f67/onnx/model.onnx",
            ],
            "模型参数规模较大（约 972 MB），建议配备独立 GPU（显存 ≥ 4GB）；纯 CPU 推理耗时较长",
        ),
        crate::mdx_components::component(),
        mk(
            "manga-colorize",
            "Manga Colorization 神经风格色彩重构与漫线上色模型",
            "基于深度前馈条件自编码架构，针对线稿明暗拓扑、景深遮挡与光照渐变自动推断合理的色相与饱和度分布，快速完成黑白照片色彩重建与动漫线稿自动着色铺底。",
            "manga-colorize-fp16.onnx",
            61_650_260,
            vec![
                "https://hf-mirror.com/Faridzar/manga-colorization-v2-onnx/resolve/main/manga-colorize-fp16.onnx",
                "https://huggingface.co/Faridzar/manga-colorization-v2-onnx/resolve/main/manga-colorize-fp16.onnx",
            ],
            "FP16 轻量量化，普通 CPU 推理单图耗时仅需 2~4 秒",
        ),
        crate::ffmpeg_components::component(),
    ];
    list.extend(crate::speech::components());
    list
}

/// 输出目录：存在数据目录的 settings.json 里，默认用桌面
fn settings_path(app: &tauri::AppHandle) -> PathBuf {
    data_dir(app).join("settings.json")
}

fn read_settings(app: &tauri::AppHandle) -> Value {
    let p = settings_path(app);
    fs::read_to_string(&p)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_else(|| json!({}))
}

// Convert the Markdown requested by the production table prompt into the UI contract.
// Unsupported/malformed content stays visible as raw text instead of being discarded.
fn table_cells(line: &str) -> Option<Vec<String>> {
    let mut cells = Vec::new();
    let mut current = String::new();
    let mut chars = line.trim().chars().peekable();
    let mut separators = 0;
    while let Some(c) = chars.next() {
        if c == '\\' && matches!(chars.peek(), Some('|') | Some('\\')) {
            current.push(chars.next()?);
        } else if c == '|' {
            cells.push(current.trim().to_string());
            current.clear();
            separators += 1;
        } else { current.push(c); }
    }
    if separators == 0 { return None; }
    cells.push(current.trim().to_string());
    if line.trim_start().starts_with('|') { cells.remove(0); }
    // Only drop a syntactic trailing delimiter, not an escaped literal pipe.
    let tail = line.trim_end();
    let trailing_slashes = tail.strip_suffix('|').map(|s| s.chars().rev().take_while(|c| *c == '\\').count()).unwrap_or(1);
    if tail.ends_with('|') && trailing_slashes % 2 == 0 { cells.pop(); }
    Some(cells)
}

fn ai_table_response(content: &str) -> Value {
    let raw = || json!({"ok": true, "raw": content});
    let mut lines: Vec<&str> = content.lines().filter(|l| !l.trim().is_empty()).collect();
    if lines.first().is_some_and(|l| matches!(l.trim(), "```" | "```markdown" | "```md")) && lines.last().is_some_and(|l| l.trim() == "```") {
        lines.remove(0); lines.pop();
    }
    if lines.len() < 3 || lines.len() > 1002 { return raw(); }
    let Some(columns) = table_cells(lines[0]) else { return raw(); };
    if columns.is_empty() || columns.len() > 100 || columns.iter().any(|c| c.is_empty()) { return raw(); }
    let Some(separator) = table_cells(lines[1]) else { return raw(); };
    if separator.len() != columns.len() || separator.iter().any(|s| {
        let body = s.trim_matches(':'); body.len() < 3 || !body.chars().all(|c| c == '-')
    }) { return raw(); }
    let mut rows = Vec::new();
    for line in &lines[2..] {
        let Some(cells) = table_cells(line) else { return raw(); };
        if cells.len() != columns.len() { return raw(); }
        rows.push(cells);
    }
    json!({"ok": true, "table": {"columns": columns, "rows": rows}})
}

#[cfg(test)]
mod ai_table_tests {
    use super::*;
    #[test]
    fn real_v16_fixture() {
        let r = ai_table_response("| 名称 | 数量 |\n|------|------|\n| 苹果 | 3 |\n| 香蕉 | 5 |");
        assert_eq!(r["table"]["columns"], json!(["名称", "数量"]));
        assert_eq!(r["table"]["rows"], json!([["苹果", "3"], ["香蕉", "5"]]));
        assert!(r.get("result").is_none());
    }
    #[test]
    fn fence_alignment_empty_and_escaped_cells() {
        let r = ai_table_response("```markdown\n| A | B |\n|:---|---:|\n| a\\|b | 001 |\n| | x |\n```");
        assert_eq!(r["table"]["rows"], json!([["a|b", "001"], ["", "x"]]));
    }
    #[test]
    fn no_outer_pipes_and_literal_backslash() {
        let r = ai_table_response("A | B\n--- | ---\nx\\\\y | z");
        assert_eq!(r["table"]["rows"], json!([["x\\y", "z"]]));
    }
    #[test]
    fn malformed_output_is_not_lost() {
        for raw in ["hello", "A|B\n---|---\nx", "|A|B|\n|x|y|\n|1|2|", "|A|B|\n|---|---|\n|1|2|3|", "|A||\n|---|---|\n|1|2|"] {
            let r = ai_table_response(raw);
            assert_eq!(r["raw"], raw); assert!(r.get("table").is_none());
        }
    }
}

fn public_ai_config(ai: Option<&Value>) -> Value {
    let mut cfg = ai.cloned().filter(Value::is_object).unwrap_or_else(|| json!({}));
    let has_key = cfg.get("apiKey").and_then(Value::as_str).map(|s| !s.trim().is_empty()).unwrap_or(false);
    if let Some(obj) = cfg.as_object_mut() {
        obj.remove("apiKey");
        obj.remove("apiKeyEnc");
        obj.insert("hasKey".to_string(), json!(has_key));
    }
    cfg
}

#[cfg(test)]
mod ai_public_config_tests {
    use super::*;
    #[test]
    fn hides_credentials_preserves_public_fields() {
        let source = json!({"apiKey":"PUBLIC_TEST_SECRET", "apiKeyEnc":"PUBLIC_TEST_CIPHER", "model":"fixture", "hasKey":false});
        let result = public_ai_config(Some(&source));
        assert!(result.get("apiKey").is_none());
        assert!(result.get("apiKeyEnc").is_none());
        assert_eq!(result["hasKey"], true);
        assert_eq!(result["model"], "fixture");
        assert_eq!(source["apiKey"], "PUBLIC_TEST_SECRET");
    }
    #[test]
    fn missing_empty_and_malformed_have_no_key() {
        for source in [json!(null), json!(12), json!({}), json!({"apiKey":"  ","hasKey":true})] {
            assert_eq!(public_ai_config(Some(&source))["hasKey"], false);
        }
        assert_eq!(public_ai_config(None)["hasKey"], false);
    }
}

fn write_settings(app: &tauri::AppHandle, v: &Value) -> Result<(), String> {
    let p = settings_path(app);
    fs::write(&p, serde_json::to_string_pretty(v).map_err(|e| e.to_string())?)
        .map_err(|e| format!("保存设置失败：{e}"))
}

// ── 给其它模块（互传的局域网服务）用的公开包装 ──
pub fn read_settings_public(app: &tauri::AppHandle) -> Value {
    read_settings(app)
}

pub fn write_settings_public(app: &tauri::AppHandle, v: &Value) -> Result<(), String> {
    write_settings(app, v)
}

/// 生成一个 6 位配对码（与本文件里 /api/lan-token 用的是同一套规则）
pub fn new_lan_token() -> String {
    use std::collections::hash_map::RandomState;
    use std::hash::{BuildHasher, Hasher};
    let seed1 = RandomState::new().build_hasher().finish();
    let seed2 = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let val = ((seed1 ^ (seed2 as u64)) % 900000) + 100000;
    format!("{:06}", val)
}

fn default_output_dir() -> String {
    let home = std::env::var("USERPROFILE").unwrap_or_else(|_| ".".into());
    PathBuf::from(home).join("Desktop").to_string_lossy().to_string()
}

/// 唯一入口：按路径分发
#[tauri::command]
pub async fn api_call(
    app: tauri::AppHandle,
    path: String,
    method: String,
    args: Value,
) -> Result<Value, String> {
    if !crate::upscale_validation::api_allowed(!crate::startup_policy::current().ancillary,&path,&method,&args){return Err("API unavailable in isolated validation".into());}
    crate::upscale_validation::authorize_job(&app,&path)?;
    let (clean, query) = match path.split_once('?') {
        Some((c, q)) => (c.trim_end_matches('/').to_string(), Some(q)),
        None => (path.trim_end_matches('/').to_string(), None),
    };
    let mut args = args;
    if let Some(q) = query {
        if !args.is_object() {
            args = Value::Object(serde_json::Map::new());
        }
        if let Some(obj) = args.as_object_mut() {
            for pair in q.split('&') {
                if let Some((k, v)) = pair.split_once('=') {
                    obj.entry(k.to_string()).or_insert(Value::String(v.to_string()));
                }
            }
        }
    }
    match clean.as_str() {
        "/api/validation/upscale/info" => crate::upscale_validation::info(),
        "/api/validation/upscale/exit" => crate::upscale_validation::finish(&app),
        // 翻译（截图翻译用）：腾讯首选、有道备用，都是免密钥的国内可直连接口
        "/api/translate" => {
            let texts = args
                .get("texts")
                .and_then(|v| v.as_array())
                .map(|arr| arr.iter().filter_map(|x| x.as_str().map(|s| s.to_string())).collect::<Vec<_>>())
                .unwrap_or_default();
            let from = args.get("from").and_then(|v| v.as_str()).unwrap_or("auto");
            let to = args.get("to").and_then(|v| v.as_str()).unwrap_or("zh");
            crate::translate::translate(texts, from, to)
        }

        // ── 媒体信息 / 网页导出 ──
        // 媒体信息：直接对**真实文件路径**跑 ffprobe（路径来自系统原生文件选择框），
        // 不把文件读进内存，大文件也是瞬间出结果。
        "/api/media/probe" => {
            let path = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
            crate::webcap::probe(path).map(|json| serde_json::json!({ "success": true, "json": json }))
        }
        // 网页 → PDF
        "/api/webcap/pdf" => {
            let url = args.get("url").and_then(|v| v.as_str()).unwrap_or("");
            let is_file = args.get("isFile").and_then(|v| v.as_bool()).unwrap_or(false);
            let landscape = args.get("landscape").and_then(|v| v.as_bool()).unwrap_or(false);
            let no_header = args.get("noHeader").and_then(|v| v.as_bool()).unwrap_or(true);
            let wait = args.get("waitMs").and_then(|v| v.as_u64()).unwrap_or(6000) as u32;
            let target = crate::webcap::normalize_target(url, is_file)?;
            let out = crate::webcap::export_path("pdf");
            crate::webcap::print_to_pdf(&target, &out, landscape, no_header, wait)?;
            let size = std::fs::metadata(&out).map(|m| m.len()).unwrap_or(0);
            Ok(serde_json::json!({
                "success": true,
                "path": out.to_string_lossy(),
                "size": size,
                "dir": crate::webcap::export_dir().to_string_lossy(),
            }))
        }
        // 网页 → 图片
        "/api/webcap/image" => {
            let url = args.get("url").and_then(|v| v.as_str()).unwrap_or("");
            let is_file = args.get("isFile").and_then(|v| v.as_bool()).unwrap_or(false);
            let width = args.get("width").and_then(|v| v.as_u64()).unwrap_or(1280) as u32;
            let height = args.get("height").and_then(|v| v.as_u64()).unwrap_or(900) as u32;
            let wait = args.get("waitMs").and_then(|v| v.as_u64()).unwrap_or(6000) as u32;
            let target = crate::webcap::normalize_target(url, is_file)?;
            let out = crate::webcap::export_path("png");
            crate::webcap::screenshot(&target, &out, width, height, wait)?;
            let size = std::fs::metadata(&out).map(|m| m.len()).unwrap_or(0);
            Ok(serde_json::json!({
                "success": true,
                "path": out.to_string_lossy(),
                "size": size,
                "dir": crate::webcap::export_dir().to_string_lossy(),
            }))
        }

        // 电池健康：读 Windows 自带的电池报告（powercfg /batteryreport /xml）
        // 只把 XML 原文交给前端解析，Rust 侧不做解析、不引 XML 依赖。
        "/api/battery" => crate::battery::report_xml().map(|xml| serde_json::json!({ "success": true, "xml": xml })),

        // ══ 联网查询（天气 / 公网IP / 手机号 / 快递 / 域名）══
        //  这几家的接口都没有 CORS 头，网页里直接 fetch 会被拦，所以由 Rust 用 curl 转发。
        //  接口可用性是逐个实测挑出来的，见 src/netquery.rs 顶部注释。
        "/api/net/geocode" => {
            let name = args.get("name").and_then(|v| v.as_str()).unwrap_or("");
            crate::netquery::geocode(name)
        }
        "/api/net/weather" => {
            // ★ 注意：查询串过来的参数**都是字符串**（前端用 `?lat=39.9&lon=116.4` 调的），
            //   只写 as_f64() 会拿到 None、报"缺少纬度"。所以字符串也要能解析（踩过）。
            let num_arg = |key: &str| -> Option<f64> {
                args.get(key).and_then(|v| {
                    v.as_f64()
                        .or_else(|| v.as_str().and_then(|s| s.trim().parse::<f64>().ok()))
                })
            };
            let lat = num_arg("lat").ok_or("缺少纬度")?;
            let lon = num_arg("lon").ok_or("缺少经度")?;
            let tz = args.get("timezone").and_then(|v| v.as_str()).unwrap_or("auto");
            crate::netquery::weather(lat, lon, tz)
        }
        "/api/net/public-ip" => crate::netquery::public_ip(),
        "/api/net/phone" => {
            let n = args.get("number").and_then(|v| v.as_str()).unwrap_or("");
            crate::netquery::phone(n)
        }
        "/api/net/express" => {
            let n = args.get("number").and_then(|v| v.as_str()).unwrap_or("");
            let company = args.get("company").and_then(|v| v.as_str()).unwrap_or("");
            crate::netquery::express(n, company, args.get("phone").and_then(|v|v.as_str()).unwrap_or(""))
        }
        "/api/net/domain" => {
            let n = args.get("domain").and_then(|v| v.as_str()).unwrap_or("");
            crate::netquery::domain(n)
        }

        // ══ 文本编码：检测 / 解码 / 编码 / 乱码修复 ══
        //  （乱码修复需要"把文字编回 GBK 字节"，浏览器做不到，所以放 Rust 用 encoding_rs）
        "/api/encoding/convert" => {
            let action = args.get("action").and_then(|v| v.as_str()).unwrap_or("detect");
            let encoding = args.get("encoding").and_then(|v| v.as_str()).unwrap_or("utf-8");
            match action {
                "detect" => {
                    let data = args.get("data").and_then(|v| v.as_str()).ok_or("没有要检测的内容")?;
                    crate::encoding::detect(data)
                }
                "decode" => {
                    let data = args.get("data").and_then(|v| v.as_str()).ok_or("没有要解码的内容")?;
                    crate::encoding::decode(data, encoding)
                }
                "encode" => {
                    let text = args.get("text").and_then(|v| v.as_str()).unwrap_or("");
                    crate::encoding::encode(text, encoding)
                }
                "repair" => {
                    let text = args.get("text").and_then(|v| v.as_str()).unwrap_or("");
                    crate::encoding::repair(text)
                }
                other => Err(format!("不支持的编码操作：{other}")),
            }
        }

        // Read-only diagnostics: never purge history/results or infer successful engine execution.
        "/api/system/scan" => {
            let root=crate::app_root_of(&app);
            let components=components_dir(&app)?;
            let aria2=crate::owned_tasks::engine(&app,"aria2").ok();
            let whisper=crate::owned_tasks::engine(&app,"whisper").ok();
            // Content verification is blocking IO. Never perform it on an async executor
            // thread or queue unbounded duplicate scans after a non-abortable UI timeout.
            let admission=crate::diagnostic_admission::begin()?;
            tauri::async_runtime::spawn_blocking(move || {
                let _admission=admission;
                Ok(crate::runtime_diagnostics::scan(&root,&components,aria2.as_deref(),whisper.as_deref()))
            }).await.map_err(|_|"自检任务异常；未确认修复 / Diagnostics task failed; no repair verified".to_owned())?
        }

        // ══ 意见反馈 + 作者回复 ══
        //  POST = 提交建议（推 ntfy 频道 + 本地留底，返回一个查询码）
        //  GET  = 本机留底的历史
        "/api/feedback" => {
            if method == "POST" {
                crate::feedback::submit(&app, &args)
            } else {
                Ok(crate::feedback::history(&app))
            }
        }

        // 用查询码看看作者回复了没（回复文件放在作者的 releases 仓库里）
        "/api/feedback/replies" => {
            let code = args.get("code").and_then(|v| v.as_str()).unwrap_or("");
            crate::feedback::replies(&app, code)
        }

        // ══ 视频信息解析（B站/推特/通用下载的"解析"这一步）══
        //  原版是 apps/web/src/app/api/video-info/route.ts（259 行，调 yt-dlp）。
        //  逻辑照搬，见 src/video.rs 里的注释。
        "/api/video-info" => {
            let url = args
                .get("url")
                .and_then(|v| v.as_str())
                .ok_or("请提供视频链接")?
                .to_string();
            crate::video::info(&app, &url)
        }

        // ── 健康检查 ──
        //  外壳侧栏那个"服务运行中 / 服务未运行"就是轮询这个接口（app-shell.tsx 里 fetch("/api/health")）。
        //  原版返回 { ok, queue, message }，这里保持一致 —— 字段名对上，界面才不会显示"服务未运行"。
        "/api/health" => Ok(crate::runtime_diagnostics::health(&crate::app_root_of(&app))),

        // ── 输出目录 ──
        "/api/output-dir" => {
            if method == "POST" || method == "PUT" {
                if args.get("action").and_then(|v| v.as_str()) == Some("reveal") {
                    let p = args.get("path").and_then(|v| v.as_str()).unwrap_or("");
                    if !p.is_empty() {
                        crate::commands::open_path(app.clone(), p.to_string())?;
                        return Ok(json!({ "ok": true }));
                    }
                }
                let dir = args
                    .get("dir")
                    .or_else(|| args.get("path"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("");
                if dir.is_empty() {
                    return Err("没有指定目录".into());
                }
                let p = PathBuf::from(dir);
                if !p.is_dir() {
                    return Err(format!("目录不存在：{dir}"));
                }
                let mut s = read_settings(&app);
                s["outputDir"] = json!(dir);
                write_settings(&app, &s)?;
                Ok(json!({ "ok": true, "outputDir": dir }))
            } else {
                let s = read_settings(&app);
                let dir = s
                    .get("outputDir")
                    .and_then(|v| v.as_str())
                    .map(|x| x.to_string())
                    .unwrap_or_else(default_output_dir);
                Ok(json!({ "outputDir": dir }))
            }
        }

        // ── 按需下载的模型 ──
        // Explicitly gated local import. Never accept an IPC-controlled destination.
        #[cfg(windows)]
        "/api/worker-extension/import" => crate::worker_import_control::dispatch(
            &method,&args,crate::worker_extension::experimental_enabled(),components_dir(&app)),

        #[cfg(windows)]
        "/api/worker-extension/download" => crate::worker_import_control::dispatch_download(
            &method,&args,crate::worker_extension::experimental_enabled(),components_dir(&app)),

        "/api/worker-extension/catalog" => {
            if method!="GET"{return Err("Read-only component delivery catalog".into());}
            let mut cat = crate::worker_delivery::catalog();
            if let Ok(dir) = components_dir(&app) {
                let root = crate::app_root_of(&app);
                let installed = crate::runtime_layout::worker_root(&root, &dir).is_some()
                    || crate::worker_extension::select(&root, &dir).is_ok();
                cat["component"]["installed"] = serde_json::json!(installed);
            }
            Ok(cat)
        }

        "/api/components" => {
            let dir = components_dir(&app)?;
            let mut list = component_specs();
            for c in list.iter_mut() {
                c.inspect(&dir);
            }
            if method == "POST" {
                let id = args.get("id").and_then(|v| v.as_str()).unwrap_or("");
                let id = crate::mdx_components::canonical_id(id);
                let action = args.get("action").and_then(|v| v.as_str()).unwrap_or("download");
                let spec = list.iter().find(|c| c.id == id).ok_or_else(|| format!("没有这个组件：{id}"))?.clone();
                let target = dir.join(&spec.file);

                match action {
                    "delete" => {
                        let _active=component_downloads().lock().map_err(|_|"下载状态异常")?;
                        if _active.contains(id) { return Err("模型正在下载，不能删除".into()); }
                        let _component_change=component_change(&app,&dir,&spec)?;
                        if id == crate::mdx_components::ID { return crate::mdx_components::delete(&dir); }
                        if id == crate::ffmpeg_components::ID { return crate::ffmpeg_components::delete(&dir); }
                        if target.is_file() {
                            fs::remove_file(&target).map_err(|e| format!("删除失败：{e}"))?;
                        }
                        return Ok(json!({ "ok": true, "message": format!("已删除 {}", spec.name) }));
                    }
                    "download" => {
                        let id=id.to_owned();
                        return tauri::async_runtime::spawn_blocking(move || download_component(&app,&id)).await.map_err(|_|"模型下载任务异常".to_string())?;
                    }
                    _ => return Err(format!("不支持的操作：{action}")),
                }
            }
            Ok(json!({ "components": list, "dir": dir.to_string_lossy() }))
        }

        // V66: the tool and Settings share this opt-in component inventory.
        "/api/tts/components" => {
            if method == "POST" {
                let id = args.get("id").and_then(Value::as_str).unwrap_or("");
                let action = args.get("action").and_then(Value::as_str).unwrap_or("download");
                return crate::tts_components::action(&app, id, action);
            }
            tauri::async_runtime::spawn_blocking(move || crate::tts_components::catalog(&app))
                .await.map_err(|_| "TTS catalog task failed".to_string())?
        }
        "/api/tts/voices" => {
            let engine = args.get("engine").and_then(Value::as_str).unwrap_or("sapi").to_owned();
            tauri::async_runtime::spawn_blocking(move || crate::tts_components::voices(&app, &engine))
                .await.map_err(|_| "TTS voice enumeration failed".to_string())?
        }

        // Office / WPS 是否可用（Word/Excel/PPT 相关工具页据此提示）
        "/api/office/availability" => {
            tauri::async_runtime::spawn_blocking(crate::office_native::availability)
                .await.map_err(|_| "Office 检测任务异常".to_string())
        }

        // ── 系统信息 ──
        "/api/system/info" => {
            let section = args.get("section").and_then(Value::as_str).unwrap_or("overview").to_owned();
            let data = tauri::async_runtime::spawn_blocking(move || crate::system_info::query(&section))
                .await.map_err(|_| "硬件查询任务异常".to_string())??;
            Ok(json!({ "data": data, "format": "cim-v1" }))
        }


        // Catalog requests are metadata-only; scans require an explicit root.
        "/api/system/big-files" => {
            let args = args.clone();
            let method = method.to_string();
            tauri::async_runtime::spawn_blocking(move || crate::disk_scan::dispatch(&method, &args))
                .await.map_err(|_| "文件扫描任务异常".to_string())?
        }

        // ── AI 配置（支持预设返回、连接探测与本地持久化）──
        "/api/ai/config" => {
            let mut st = read_settings(&app);
            if method == "POST" || method == "PUT" {
                if let Some(obj) = args.as_object() {
                    // 如果是测试连接动作
                    if obj.get("action").and_then(|v| v.as_str()) == Some("test") {
                        let ai = st.get("ai").cloned().unwrap_or(json!({}));
                        return match tauri::async_runtime::spawn_blocking(move||crate::ai_connection::request(ai,false)).await.map_err(|e|e.to_string())? {
                            Ok(value)=>Ok(value),Err(error)=>Ok(json!({"ok":false,"message":error}))
                        };
                    }

                    // 常规保存配置
                    if st.get("ai").is_none() {
                        st["ai"] = json!({});
                    }
                    let mut next=st["ai"].clone();
                    for (k,v) in obj { if ["provider","providerName","baseUrl","model","temperature","maxTokens","apiKey"].contains(&k.as_str()){next[k]=v.clone();} }
                    for field in ["provider","providerName","baseUrl","model"] {if let Some(text)=next[field].as_str(){next[field]=json!(text.trim());}}
                    crate::ai_connection::validate(&next)?;
                    // Never silently send an existing vendor's secret to a newly selected host.
                    if next["baseUrl"]!=st["ai"]["baseUrl"] && !obj.contains_key("apiKey") {next["apiKey"]=json!("");}
                    st["ai"]=next;
                    write_settings(&app, &st)?;
                }
                return Ok(json!({ "ok": true, "config": public_ai_config(st.get("ai")) }));
            }

            // GET 请求：返回已保存配置与完整的内置服务商预设列表
            let presets = json!([
                {
                    "id": "deepseek",
                    "name": "DeepSeek (深度求索)",
                    "baseUrl": "https://api.deepseek.com/v1",
                    "models": ["deepseek-chat", "deepseek-reasoner"]
                },
                {
                    "id": "openai",
                    "name": "OpenAI (官方 / 兼容代理)",
                    "baseUrl": "https://api.openai.com/v1",
                    "models": ["gpt-4o-mini", "gpt-4o", "o3-mini"]
                },
                {
                    "id": "kimi",
                    "name": "月之暗面 (Kimi / Moonshot)",
                    "baseUrl": "https://api.moonshot.cn/v1",
                    "models": ["moonshot-v1-8k", "moonshot-v1-32k", "moonshot-v1-128k"]
                },
                {
                    "id": "qwen",
                    "name": "通义千问 (阿里云百炼)",
                    "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
                    "models": ["qwen-plus", "qwen-turbo", "qwen-max"]
                },
                {
                    "id": "glm",
                    "name": "智谱清言 (BigModel)",
                    "baseUrl": "https://open.bigmodel.cn/api/paas/v4",
                    "models": ["glm-4-flash", "glm-4-plus", "glm-4"]
                },
                {
                    "id": "ollama",
                    "name": "Ollama (本地私有大模型)",
                    "baseUrl": "http://localhost:11434/v1",
                    "models": ["llama3:latest", "qwen2.5:latest", "deepseek-r1:latest"]
                },
                {
                    "id": "custom",
                    "name": "自定义 OpenAI 兼容接口",
                    "baseUrl": "",
                    "models": []
                }
            ]);

            let cfg = public_ai_config(st.get("ai"));
            let has_key = cfg.get("hasKey").and_then(Value::as_bool).unwrap_or(false);
            Ok(json!({
                "config": cfg,
                "presets": presets,
                "configured": has_key || cfg.get("baseUrl").is_some()
            }))
        }

        "/api/ai/models" => {
            let mut ai=read_settings(&app).get("ai").cloned().unwrap_or(json!({}));
            if let Some(obj)=args.as_object(){
                if obj.get("baseUrl").is_some() && args["baseUrl"]!=ai["baseUrl"] {ai["apiKey"]=json!("");}
                for field in ["provider","providerName","baseUrl","model","apiKey"] {if let Some(value)=obj.get(field){ai[field]=value.clone();}}
            }
            if ai["model"].as_str().unwrap_or("").trim().is_empty(){ai["model"]=json!("model-list");}
            tauri::async_runtime::spawn_blocking(move||crate::ai_connection::request(ai,true)).await.map_err(|e|e.to_string())?
        }

        "/api/whisper/models" => Ok(crate::speech::models(&app)),
        "/api/tools/audio-transcribe" => crate::speech::start(&app,&args),

        // ── 磁力链接解析（纯解析，不联网、不下载）──
        "/api/magnet-info" => { let mut result=crate::magnet_info::parse(&args)?;let ready=crate::owned_tasks::engine(&app,"aria2");result["downloadSupported"]=json!(ready.is_ok());if let Some(obj)=result.as_object_mut(){obj.remove("downloadUnavailableReason");if let Err(error)=ready {obj.insert("downloadUnavailableReason".into(),json!(error));}}Ok(result) },
        "/api/magnet-download" => crate::magnet_tasks::api(&app,&args),
        "/api/tools/magnet-download" => { let mut args=args.clone();args["action"]=json!("start");crate::magnet_tasks::api(&app,&args) },


        // ══ 任务流水线（对应原 Next 版的 /api/jobs/* 与 /api/tools/*）══

        // 列出任务
        "/api/jobs" if method == "GET" => {
            let list = crate::jobs::list_jobs(&app);
            Ok(json!({ "jobs": list, "count": list.len() }))
        }

        // 提交任务 / 查任务 / 取消 / 取产物
        p if p.starts_with("/api/jobs/") => {
            let rest = p.trim_start_matches("/api/jobs/");
            let (id, action) = match rest.split_once('/') {
                Some((i, act)) => (i, act),
                None => (rest, ""),
            };
            match action {
                "" => {
                    let mut job = crate::jobs::read_job_public(&app, id)
                        .ok_or_else(|| format!("找不到任务 {id}"))?;
                    // 顺手补一个产物大小：前端用它对比"压缩后没有变小"这类情况（worker 不写这个字段）。
                    if job.get("status").and_then(|v| v.as_str()) == Some("completed")
                        && job.get("resultBytes").and_then(|v| v.as_u64()).unwrap_or(0) == 0
                    {
                        if let Some(p) = crate::jobs::job_artifact(&app, &job) {
                            if let Ok(md) = fs::metadata(&p) {
                                job.as_object_mut().map(|o| o.insert("resultBytes".into(), json!(md.len())));
                            }
                        }
                    }
                    Ok(json!({ "job": job }))
                }
                "cancel" => crate::jobs::cancel_job(&app, id),
                "download" => {
                    let job = crate::jobs::read_job_public(&app, id)
                        .ok_or_else(|| format!("找不到任务 {id}"))?;
                    match crate::jobs::job_artifact(&app, &job) {
                        Some(p) => {
                            let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                            let size = fs::metadata(&p).map(|m| m.len()).unwrap_or(0);
                            let mime = job
                                .get("resultMimeType")
                                .and_then(|v| v.as_str())
                                .map(|s| s.to_string())
                                .unwrap_or_else(|| mime_of(&p));
                            // 前端要的是二进制流（fetch(...).then(r => r.blob())），
                            // 所以把文件内容 base64 放进 __binary，由 fetch-bridge 解回 Blob。
                            // 同时保留 path / filename 等字段，方便排查。
                            let preview = args.get("preview").and_then(Value::as_str) == Some("1");
                            let bytes = if preview {
                                let file = fs::File::open(&p).map_err(|e| format!("读产物失败：{e}"))?;
                                let length = file.metadata().map_err(|e| format!("读产物信息失败：{e}"))?.len();
                                if length > MAX_PREVIEW_BYTES {
                                    return Err("产物超过 32 MiB 预览上限，请下载后查看".into());
                                }
                                read_preview_bytes(file, MAX_PREVIEW_BYTES)?
                            } else {
                                fs::read(&p).map_err(|e| format!("读产物失败：{e}"))?
                            };
                            Ok(json!({
                                "__binary": {
                                    "data": crate::jobs::b64_encode_public(&bytes),
                                    "name": name,
                                    "mime": mime,
                                    "size": size,
                                },
                                "path": p.to_string_lossy(),
                                "filename": name,
                                "size": size,
                                "url": format!("asset://localhost/{}", p.to_string_lossy().replace('\\', "/")),
                            }))
                        }
                        None => Err("这个任务还没有产物文件".into()),
                    }
                }
                other => Err(format!("不支持的任务操作：{other}")),
            }
        }

        // ══ DNS / SSL 诊断：Rust 原生实现 ══
        //  以前这两个工具落到通用异步分支 → Python worker 没有对应处理器 → 任务必失败。
        //  实际上一次 PowerShell 就能拿到全部记录 / 完整证书链，同步返回文本报告即可
        //  （net-query-tools.tsx 里的 parseDnsReport / parseSslReport 本来就按这份格式写）。
        //  必须排在通用的 /api/tools/* 之前。
        // SVG 优化：Rust 原生（svg_native.rs），直接回文件
        "/api/tools/svg-optimize" if method == "POST" || method == "PUT" => {
            let app2 = app.clone();
            let args2 = args.clone();
            tauri::async_runtime::spawn_blocking(move || crate::svg_native::handle(&app2, &args2))
                .await.map_err(|_| "SVG 优化任务异常".to_string())?
        }
        "/api/tools/dns-lookup" if method == "POST" || method == "PUT" => {
            let domain = args.get("domain").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
            let report = crate::netcheck::dns_report(&domain)?;
            Ok(json!({
                "__binary": {
                    "data": crate::jobs::b64_encode_public(report.as_bytes()),
                    "name": "dns-report.txt",
                    "mime": "text/plain; charset=utf-8",
                    "kind": "text",
                }
            }))
        }
        "/api/tools/ssl-checker" if method == "POST" || method == "PUT" => {
            let domain = args.get("domain").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
            let report = crate::netcheck::ssl_report(&domain)?;
            Ok(json!({
                "__binary": {
                    "data": crate::jobs::b64_encode_public(report.as_bytes()),
                    "name": "ssl-report.txt",
                    "mime": "text/plain; charset=utf-8",
                    "kind": "text",
                }
            }))
        }

        // Preserve the full installation's existing OCR until native output quality is accepted.
        // Native-base and explicit development opt-in use the Rust image-OCR pipeline.
        "/api/tools/ocr-image" if (method == "POST" || method == "PUT") && crate::ocr_native::enabled(&app) => {
            crate::ocr_native::start(&app, &args)
        }

        "/api/tools/ocr-pdf" if (method == "POST" || method == "PUT") && crate::ocr_native::enabled(&app) => {
            crate::pdf_ocr::start(&app, &args)
        }

        // ══ PDF 基础操作：由 Rust 直接做（迁移第二块）══
        //  这些原本靠 Python 的 pymupdf（53MB）。合并/信息/旋转/删页/提取用纯 Rust 的 lopdf 完成。
        //  ★ 只拦 Rust **已经实现**的那几个：其余 pdf-* 工具（转 Markdown / 转 HTML / 转 Office /
        //    提取文字 / 渲染成图…）让它落到下面通用的异步分支，交给 Python 工作进程 ——
        //    这些功能原版就是 worker 在做、现在也还能做，以前这里一律报"还没搬到 Rust"，
        //    等于把能用的功能挡掉了。
        p if p.starts_with("/api/tools/pdf-")
            && matches!(
                p.trim_start_matches("/api/tools/"),
                "pdf-merge" | "pdf-info" | "pdf-rotate" | "pdf-delete-pages" | "pdf-extract" | "pdf-split"
            ) => {
            let tool = p.trim_start_matches("/api/tools/").to_string();
            let mut args = args.clone();
            if let Some(files) = args.get("__files").and_then(|v| v.as_array()).cloned() {
                let id = crate::jobs::new_job_id_public();
                let saved = crate::jobs::save_request_uploads(&app, &id, &files)?;
                let paths: Vec<String> = saved.iter()
                    .filter_map(|s| s.get("path").and_then(|v| v.as_str()).map(|x| x.to_string()))
                    .collect();
                args["files"] = json!(paths);
                if let Some(first) = paths.first() {
                    args["file"] = json!(first);
                }
                args.as_object_mut().map(|o| o.remove("__files"));
            }
            args.as_object_mut().map(|o| { o.remove("__path"); o.remove("__method"); });

            let r = match tool.as_str() {
                "pdf-merge" => crate::pdf::pdf_merge(&app, &args),
                "pdf-info" => crate::pdf::pdf_info(&args),
                "pdf-rotate" => crate::pdf::pdf_rotate(&app, &args),
                "pdf-delete-pages" => crate::pdf::pdf_delete_pages(&app, &args),
                "pdf-extract" => crate::pdf::pdf_extract(&app, &args),
                // split 此前与 extract 共用逻辑，只会"留下指定页"出一个文件；
                // 界面上这个工具承诺的是"按范围拆成多个"，现在真拆（多段打包 zip）。
                "pdf-split" => crate::pdf::pdf_split(&app, &args),
                other => Err(format!("PDF 工具 {other} 不该走到这里（守卫已经限定了名单）")),
            }?;
            // 前端通用表单的契约是"建任务 → 拿 job 号轮询"，直接回 {ok,result}
            // 会得到"任务未创建"。照 bg-remove 的思路记一条本地任务（不进队列），
            // 内联完成后立刻写终态再返回 —— 轮询、下载全都走现成链路。
            let job = crate::jobs::complete_local_job(&app, &tool, &args, &r)?;
            return Ok(json!({ "ok": true, "job": job, "result": r, "engine": "rust" }));
        }

        // ══ 抠图：由 Rust 直接推理（迁移第三块：ONNX Runtime）══
        //
        //  这几件事必须一起做对，否则前端一行都不用改这件事就保不住：
        //   · 前端仍是 POST /api/tools/bg-remove（FormData）→ 拿 { job } 去轮询
        //   · 所以这里照旧建任务，但用的是 create_local_job：**不写队列条目**，
        //     免得被 Python 工作进程取走（那还是 Python 在干活）
        //   · 真正干活的是 std::thread + onnx.rs，进度与结果按 Python 的字段名回写
        //     （progress 是数字、终态要有 resultFilename / error）
        //   · 产物落在 <storage>/results/<jobId>-<名字>.png，
        //     /api/jobs/<id>/download 那条现成的逻辑就能找到它
        //
        //  注意顺序：必须排在通用的 /api/tools/* 之前。
        "/api/tools/bg-remove" if method == "POST" || method == "PUT" => {
            let mut payload = args.clone();
            let upload_id = crate::jobs::new_job_id_public();

            let input = if let Some(files) = payload.get("__files").and_then(|v| v.as_array()).cloned() {
                let saved = crate::jobs::save_request_uploads(&app, &upload_id, &files)?;
                payload.as_object_mut().map(|o| o.remove("__files"));
                saved
                    .first()
                    .and_then(|s| s.get("path"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            } else {
                // 兼容直接给路径的调用方式（和 image-* 那几个工具一致）
                payload
                    .get("file")
                    .or_else(|| payload.get("path"))
                    .and_then(|v| v.as_str())
                    .map(|s| s.to_string())
            }
            .ok_or("没有收到要抠的图片")?;
            if !Path::new(&input).is_file() {
                return Err(format!("找不到输入图片：{input}"));
            }

            let model_id = payload
                .get("model")
                .and_then(|v| v.as_str())
                .unwrap_or("u2net")
                .to_string();
            let bg_color = payload
                .get("bg_color")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            payload["file"] = json!(input);

            let job = crate::jobs::create_local_job(&app, "bg-remove", payload)?;
            let id = job
                .get("id")
                .and_then(|v| v.as_str())
                .ok_or("建任务失败")?
                .to_string();

            // 后台线程去推理，接口立刻返回任务号（前端照旧轮询进度）
            let app_bg = app.clone();
            let id_bg = id.clone();
            std::thread::spawn(move || {
                let mut m = serde_json::Map::new();
                m.insert("status".into(), json!("processing"));
                m.insert("progress".into(), json!(15));
                m.insert("message".into(), json!("AI 正在分析主体轮廓…"));
                crate::jobs::update_job(&app_bg, &id_bg, m);

                let result = (|| -> Result<Value,String> {
                let model_path = crate::onnx::model_path(&app_bg, &model_id)?;
                if model_path.is_file() {
                    crate::onnx::remove_background(
                        &app_bg,
                        &input,
                        &model_path.to_string_lossy(),
                        &bg_color,
                        Some(&id_bg),
                    )
                } else {
                    Err(format!(
                        "还没下载抠图模型（{}），请在工具页上方或设置里的「按需下载组件」下载后重试",
                        model_path
                            .file_name()
                            .map(|n| n.to_string_lossy().to_string())
                            .unwrap_or_default()
                    ))
                }
                })();

                // 被取消过就别再写终态（update_job 允许终态覆盖终态，
                // 否则用户点了取消、界面又会突然变成"已完成"）
                let cancelled = crate::jobs::read_job_public(&app_bg, &id_bg)
                    .and_then(|j| j.get("status").and_then(|v| v.as_str()).map(|s| s == "failed"))
                    .unwrap_or(false);
                if cancelled {
                    return;
                }

                let mut m = serde_json::Map::new();
                match result {
                    Ok(r) => {
                        m.insert("status".into(), json!("completed"));
                        m.insert("progress".into(), json!(100));
                        m.insert("message".into(), r.get("message").cloned().unwrap_or(json!("抠图完成")));
                        m.insert("resultPath".into(), r.get("path").cloned().unwrap_or(json!("")));
                        m.insert("resultFilename".into(), r.get("filename").cloned().unwrap_or(json!("")));
                        m.insert("resultMimeType".into(), json!("image/png"));
                        m.insert("engine".into(), json!("rust-onnx"));
                    }
                    Err(e) => {
                        m.insert("status".into(), json!("failed"));
                        m.insert("progress".into(), json!(100));
                        m.insert("message".into(), json!("抠图失败"));
                        m.insert("error".into(), json!(e));
                    }
                }
                crate::jobs::update_job(&app_bg, &id_bg, m);
            });

            let current = crate::jobs::read_job_public(&app, &id).unwrap_or(job);
            Ok(json!({ "job": current, "ok": true, "engine": "rust-onnx" }))
        }

        // ══ 换背景 / 精细抠图 / 证件照：Rust 原生（去 Python 化，替代 OpenCV）══
        //  必须排在通用的 /api/tools/* 之前，否则会被送进 Python 队列。
        // 视频格式转换/压缩/转GIF/去水印：Rust 直接调用 ffmpeg（去 Python 化，video_native.rs）
        p if (method == "POST" || method == "PUT")
            && p.starts_with("/api/tools/")
            && crate::video_native::supported(p.trim_start_matches("/api/tools/")) => {
            crate::video_native::start(&app, p.trim_start_matches("/api/tools/"), &args)
        }

        // PDF 水印/页码/提取图片/压缩：Rust 原生实现（去 Python 化，pdf_native.rs）
        p if (method == "POST" || method == "PUT")
            && p.starts_with("/api/tools/")
            && crate::pdf_native::supported(p.trim_start_matches("/api/tools/")) => {
            crate::pdf_native::start(&app, p.trim_start_matches("/api/tools/"), &args)
        }

        // PDF 重排/裁剪/加密/解锁、图片水印、CSV↔Excel、Markdown→PDF：Rust 原生（去 Python 化，doc_native.rs）
        p if (method == "POST" || method == "PUT")
            && p.starts_with("/api/tools/")
            && crate::doc_native::supported(p.trim_start_matches("/api/tools/")) => {
            crate::doc_native::start(&app, p.trim_start_matches("/api/tools/"), &args)
        }

        // PPT 素材提取/文字提取/压缩/转图片/转PDF：Rust 原生与 COM 实现（去 Python 化，ppt_native.rs）
        p if (method == "POST" || method == "PUT")
            && p.starts_with("/api/tools/")
            && crate::ppt_native::supported(p.trim_start_matches("/api/tools/")) => {
            crate::ppt_native::start(&app, p.trim_start_matches("/api/tools/"), &args)
        }

        // 应用图标生成器：Rust 原生实现（去 Python 化，icon_native.rs）
        p if (method == "POST" || method == "PUT")
            && p.starts_with("/api/tools/")
            && crate::icon_native::supported(p.trim_start_matches("/api/tools/")) => {
            crate::icon_native::start(&app, p.trim_start_matches("/api/tools/"), &args)
        }

        // Office 互转套件 (Word/Excel转PDF, PDF转Word)：Rust 原生与 COM 实现（去 Python 化，office_native.rs）
        p if (method == "POST" || method == "PUT")
            && p.starts_with("/api/tools/")
            && crate::office_native::supported(p.trim_start_matches("/api/tools/")) => {
            crate::office_native::start(&app, p.trim_start_matches("/api/tools/"), &args)
        }

        // Spotify 下载器：Rust 原生与 yt-dlp + FFmpeg 搜索引擎实现（去 Python 化，spotify_native.rs）
        p if (method == "POST" || method == "PUT")
            && p.starts_with("/api/tools/")
            && crate::spotify_native::supported(p.trim_start_matches("/api/tools/")) => {
            crate::spotify_native::start(&app, p.trim_start_matches("/api/tools/"), &args)
        }

        // MP3 / 音频标签编辑器：Rust 原生与 FFmpeg 实现（去 Python 化，audio_tags_native.rs）
        p if (method == "POST" || method == "PUT")
            && p.starts_with("/api/tools/")
            && crate::audio_tags_native::supported(p.trim_start_matches("/api/tools/")) => {
            crate::audio_tags_native::start(&app, p.trim_start_matches("/api/tools/"), &args)
        }

        p if (method == "POST" || method == "PUT")
            && p.starts_with("/api/tools/")
            && crate::audio_ai_native::supported(p.trim_start_matches("/api/tools/")) => {
            crate::audio_ai_native::start(&app, p.trim_start_matches("/api/tools/"), &args)
        }

        p if (method == "POST" || method == "PUT")
            && p.starts_with("/api/tools/")
            && crate::matting_native::supported(p.trim_start_matches("/api/tools/")) => {
            crate::matting_native::start(&app, p.trim_start_matches("/api/tools/"), &args)
        }

        // Bundled lite upscale is a core feature, including screenshot enhancement.
        #[cfg(windows)]
        "/api/tools/image-upscale" if method == "POST" || method == "PUT" => {
            crate::upscale_native::start(&app, &args)
        }

        // Native-base batch-safe endpoints. Legacy full installations keep their current routes.
        p if p.starts_with("/api/tools/") && (method == "POST" || method == "PUT")
            && crate::image_native::supported(p.trim_start_matches("/api/tools/"))
            && crate::image_native::enabled(&app) => {
            crate::image_native::start(&app, p.trim_start_matches("/api/tools/"), &args)
        }

        // ══ 图像基础操作：由 Rust 直接做（迁移的第一步）══
        //  这几个原来要提交给 Python 工作进程、用 opencv 干；
        //  现在 Rust 自己完成，好处是既快又省体积（opencv 112MB 是 Python 侧最大的包）。
        //  注意：必须排在通用的 /api/tools/* 之前，否则会被后者接走送进队列。
        p if matches!(p,
            "/api/tools/image-compress" | "/api/tools/image-resize" |
            "/api/tools/image-convert" | "/api/tools/image-to-jpg" | "/api/tools/image-to-png" |
            "/api/tools/image-crop" | "/api/tools/image-rotate" | "/api/tools/image-flip" |
            "/api/tools/image-info") => {
            let tool = p.trim_start_matches("/api/tools/").to_string();
            let mut args = args.clone();

            // 前端上传的文件（base64）先落盘，再交给图像函数处理
            if let Some(files) = args.get("__files").and_then(|v| v.as_array()).cloned() {
                let id = crate::jobs::new_job_id_public();
                let saved = crate::jobs::save_request_uploads(&app, &id, &files)?;
                if let Some(first) = saved.first().and_then(|s| s.get("path")).and_then(|v| v.as_str()) {
                    args["file"] = json!(first);
                }
                args.as_object_mut().map(|o| o.remove("__files"));
            }
            args.as_object_mut().map(|o| {
                o.remove("__path");
                o.remove("__method");
            });

            let r = match tool.as_str() {
                "image-compress" => crate::media::image_compress(&app, &args),
                "image-resize" => crate::media::image_resize(&app, &args),
                "image-convert" | "image-to-jpg" | "image-to-png" => crate::media::image_convert(&app, &args),
                "image-crop" => crate::media::image_crop(&app, &args),
                "image-rotate" | "image-flip" => crate::media::image_rotate(&app, &args),
                "image-info" => crate::media::image_info(&args),
                _ => Err(format!("图像工具 {tool} 还没搬到 Rust")),
            }?;
            // 与 PDF 分支同理：补一条"即完任务"，让通用表单（image-rotate / image-flip /
            // image-info 这些没有专属页面的工具）照常轮询与下载，不再报"任务未创建"。
            let job = crate::jobs::complete_local_job(&app, &tool, &args, &r)?;
            return Ok(json!({ "ok": true, "job": job, "result": r, "engine": "rust" }));
        }

        // Video jobs have one native owner, explicit progress and a bounded stall timeout.
        "/api/tools/bilibili-download" | "/api/tools/twitter-download" | "/api/tools/video-download"
            if method == "POST" => {
                crate::video_download::start(&app, path.trim_start_matches("/api/tools/"), &args)
            }

        // Real native media execution in native-base; preserve legacy routing in full installs.
        p if p.starts_with("/api/tools/") && (method == "POST" || method == "PUT")
            && crate::media_audio::supported(p.trim_start_matches("/api/tools/"))
            && crate::media_native::enabled(&app) => {
                crate::media_native::start(&app,p.trim_start_matches("/api/tools/"),&args)
            }

        // 提交工具任务：前端 POST /api/tools/<toolId>
        p if p.starts_with("/api/tools/") && (method == "POST" || method == "PUT") => {
            let tool_id = p.trim_start_matches("/api/tools/").to_string();
            if tool_id.is_empty() {
                return Err("没有指定工具".into());
            }
            let mut payload = args.clone();
            // 上传的文件：拦截层会把文件放在 args.__files 里（base64）
            if let Some(files) = payload.get("__files").and_then(|v| v.as_array()).cloned() {
                let id = crate::jobs::new_job_id_public();
                let saved = crate::jobs::save_request_uploads(&app, &id, &files)?;
                // 关键：按工作进程期望的字段名放进去（它读 payload["file"] / payload["files"]）
                let paths: Vec<String> = saved
                    .iter()
                    .filter_map(|s| s.get("path").and_then(|v| v.as_str()).map(|x| x.to_string()))
                    .collect();
                // ★ 多文件工具（音频合并等）在 worker 里读的是 files 列表；
                //   以前不管几个文件都塞 file，worker 优先取 file 就只看到第一个 →
                //   明明选了两个还是报"请选择至少两个音频文件"。
                //   现在仅单文件时写 file，多文件只留 files。
                if paths.len() == 1 {
                    if let Some(first) = paths.first() {
                        payload["file"] = json!(first);
                    }
                }
                payload["files"] = json!(paths);
                payload["__uploads"] = json!(saved);
                payload.as_object_mut().map(|o| o.remove("__files"));
            }
            payload.as_object_mut().map(|o| {
                o.remove("__path");
                o.remove("__method");
            });
            let worker_app=app.clone();
            let job=tauri::async_runtime::spawn_blocking(move||crate::jobs::create_job(&worker_app,&tool_id,payload)).await
                .map_err(|e|format!("Worker startup task failed: {e}"))?
                .map_err(|e| {
                    if e.contains("os error 2") || e.contains("系统找不到指定的文件") || e.contains("Processing extension not installed") {
                        "未检测到 Python 扩展组件。该工具需要 Python 运行时支持，请前往「设置 → 组件」下载安装 Python 扩展组件后使用。".to_string()
                    } else {
                        e
                    }
                })?;
            Ok(json!({ "job": job, "ok": true }))
        }

        // 存储根目录（给 asset 协议用）
        //
        //  ★ 这里原来是 `p if p.starts_with("/api/storage")` 的兜底前缀路由，
        //    结果把后面具体的 /api/storage/info 先接走了 —— 界面上的"存储信息"
        //    因此显示成 "undefined 个文件 / NaN MB"（拿到的是 {storage} 而不是 {files,bytes}）。
        //    兜底路由要么排在具体路由后面，要么像这样精确匹配。前端只用到 /api/storage/info。
        "/api/storage" => {
            Ok(json!({ "storage": crate::jobs::storage_dir_of(&app).to_string_lossy() }))
        }


        // ══ 局域网传输 ══
        "/api/lan-token" => {
            let mut st = read_settings(&app);
            if method == "POST" {
                // 生成一个 6 位配对码
                let t = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|d| d.as_nanos())
                    .unwrap_or(0);
                let code = format!("{:06}", (t % 900000) + 100000);
                st["lanToken"] = json!(code);
                write_settings(&app, &st)?;
                return Ok(json!({ "ok": true, "token": code }));
            }
            Ok(json!({ "token": st.get("lanToken").cloned().unwrap_or(json!(null)) }))
        }

        // ══ 跨设备互传（对应原版 /api/transfer）══
        //  原来这里是个空壳（只会建一个任务）—— 结果界面里 IP 是空的、链接不显示、
        //  二维码一直"生成中"。现在按原版的字段与目录布局实现了。
        //  注意：GET 是界面每 3 秒轮询的状态接口；POST 是各种操作。
        "/api/transfer" => {
            if method == "GET" {
                return crate::transfer::state(&app).map(|v| v);
            }
            let action = args.get("action").and_then(|v| v.as_str()).unwrap_or("");
            // 上传的文件（共享给手机）会以 __files 传进来
            let mut uploads = Vec::new();
            if let Some(files) = args.get("__files").and_then(|v| v.as_array()) {
                uploads = crate::jobs::save_request_uploads(&app, &crate::jobs::new_job_id_public(), files)?;
            }
            crate::transfer::action(&app, action, &args, &uploads)
        }

        // 互传文件的下载（共享列表 / 已接收列表里点下载）
        "/api/transfer/download" => {
            let id = args.get("id").and_then(|v| v.as_str()).unwrap_or("");
            let kind = args.get("type").and_then(|v| v.as_str()).unwrap_or("received");
            if id.is_empty() {
                return Err("没有指定文件".into());
            }
            match crate::transfer::artifact_path(&app, id, kind) {
                Some((path, name)) => {
                    let bytes = fs::read(&path).map_err(|e| format!("读文件失败：{e}"))?;
                    Ok(json!({
                        "__binary": {
                            "data": crate::jobs::b64_encode_public(&bytes),
                            "name": name,
                            "mime": mime_of(&path),
                            "size": bytes.len(),
                        },
                        "path": path.to_string_lossy(),
                        "filename": name,
                        "size": bytes.len(),
                    }))
                }
                None => Err("找不到这个文件（可能已被移除）".into()),
            }
        }

        // ══ Genuine local whisper.cpp ══
        "/api/whisper/result" => crate::speech::result(&app,&args),
        "/api/whisper/download" => crate::speech::start_download(&app,args["model"].as_str().unwrap_or("base")),

        // ══ 网络查询（走系统 curl，不引第三方网络库）══
        "/api/net-query" => {
            let kind = args.get("type").or_else(|| args.get("kind")).and_then(|v| v.as_str()).unwrap_or("ip");
            let target = args.get("target").or_else(|| args.get("query")).and_then(|v| v.as_str()).unwrap_or("");
            // 短链展开：用 curl 手动跟随跳转，最多 12 跳，能看出每一跳的落点
            if kind == "shortlink" {
                let mut cur = if target.starts_with("http") { target.to_string() } else { format!("http://{target}") };
                let mut hops: Vec<Value> = Vec::new();
                for _ in 0..12 {
                    let out = std::process::Command::new("curl")
                        .args(["-sS", "--ssl-no-revoke", "-o", "NUL", "-w", "%{http_code} %{redirect_url}", "--max-time", "15", &cur])
                        .output()
                        .map_err(|e| format!("调用 curl 失败：{e}"))?;
                    let txt = String::from_utf8_lossy(&out.stdout).trim().to_string();
                    let mut parts = txt.splitn(2, ' ');
                    let code = parts.next().unwrap_or("").to_string();
                    let next = parts.next().unwrap_or("").trim().to_string();
                    hops.push(json!({ "url": cur, "status": code, "next": next }));
                    if next.is_empty() || !(code.starts_with('3')) {
                        return Ok(json!({ "ok": true, "type": kind, "final": cur, "hops": hops }));
                    }
                    cur = next;
                }
                return Ok(json!({ "ok": true, "type": kind, "final": cur, "hops": hops, "note": "跳转次数达到上限" }));
            }

            // whois：43 端口的纯 TCP 文本协议，Rust 标准库就能做
            // （iana 根 → 注册局 → 注册商，最多跟三跳；以前这里直接拒绝）
            if kind == "whois" {
                return crate::netcheck::whois_lookup(&target);
            }

            let url = match kind {
                "ip" => format!("http://ip-api.com/json/{}?lang=zh-CN", target),
                "icp" => return Err("ICP 备案查询的公开接口不稳定，暂时保留在网页版；已知可用入口：https://beian.miit.gov.cn".into()),
                _ => return Err(format!("不支持的查询类型：{kind}")),
            };
            let out = std::process::Command::new("curl")
                .args(["-sS", "--ssl-no-revoke", "--max-time", "20", &url])
                .output()
                .map_err(|e| format!("调用 curl 失败：{e}"))?;
            if !out.status.success() {
                return Err("查询失败：网络不通或接口不可用".into());
            }
            let txt = String::from_utf8_lossy(&out.stdout).to_string();
            let parsed: Value = serde_json::from_str(&txt).unwrap_or(json!({ "raw": txt }));
            // ip 查询：把 ip-api 的原始字段摊平并改成界面认识的键名。
            // ★ 以前整包塞进 data，界面把嵌套对象渲染成 "[object Object]"。
            if kind == "ip" {
                if let Some(o) = parsed.as_object() {
                    if o.get("status").and_then(|v| v.as_str()) == Some("fail") {
                        let msg = o.get("message").and_then(|v| v.as_str()).unwrap_or("没有查到这个 IP 的归属地");
                        return Err(msg.to_string());
                    }
                    let g = |k: &str| o.get(k).cloned().unwrap_or(Value::Null);
                    let mut flat: Vec<(String, Value)> = vec![
                        ("ip".into(), g("query")),
                        ("country".into(), g("country")),
                        ("region".into(), g("regionName")),
                        ("city".into(), g("city")),
                        ("isp".into(), g("isp")),
                        ("org".into(), g("org")),
                        ("asn".into(), g("as")),
                        ("timezone".into(), g("timezone")),
                        ("proxy".into(), g("proxy")),
                        ("hosting".into(), g("hosting")),
                        ("mobile".into(), g("mobile")),
                        ("source".into(), json!(url)),
                    ];
                    if let (Some(la), Some(lo)) = (o.get("lat"), o.get("lon")) {
                        flat.push(("location".into(), json!(format!("{la}, {lo}"))));
                    }
                    let mut resp = serde_json::Map::new();
                    resp.insert("ok".into(), json!(true));
                    resp.insert("type".into(), json!(kind));
                    for (k, v) in flat {
                        if !v.is_null() {
                            resp.insert(k, v);
                        }
                    }
                    return Ok(Value::Object(resp));
                }
            }
            Ok(json!({ "ok": true, "type": kind, "data": parsed, "source": url }))
        }

        // ══ 系统信息补充 ══
        "/api/system/processes" => {
            let out = std::process::Command::new("tasklist")
                .args(["/FO", "CSV", "/NH"])
                .output()
                .map_err(|e| format!("读取进程列表失败：{e}"))?;
            let txt = String::from_utf8_lossy(&out.stdout);
            let mut procs: Vec<Value> = Vec::new();
            for line in txt.lines().take(400) {
                let f: Vec<&str> = line.split("\",\"").collect();
                if f.len() >= 5 {
                    procs.push(json!({
                        "name": f[0].trim_matches('"'),
                        "pid": f[1].trim_matches('"'),
                        "mem": f[4].trim_matches('"'),
                    }));
                }
            }
            Ok(json!({ "processes": procs, "count": procs.len() }))
        }

        "/api/system/disk" => {
            // 用 wmic 取各盘剩余空间
            let out = std::process::Command::new("wmic")
                .args(["logicaldisk", "get", "DeviceID,Size,FreeSpace", "/format:csv"])
                .output()
                .map_err(|e| format!("读取磁盘信息失败：{e}"))?;
            let txt = String::from_utf8_lossy(&out.stdout);
            let mut disks: Vec<Value> = Vec::new();
            for line in txt.lines().skip(1) {
                let f: Vec<&str> = line.split(',').collect();
                if f.len() >= 4 && !f[1].trim().is_empty() {
                    let total: u64 = f[2].trim().parse().unwrap_or(0);
                    let free: u64 = f[3].trim().parse().unwrap_or(0);
                    disks.push(json!({
                        "drive": f[1].trim(),
                        "totalBytes": total,
                        "freeBytes": free,
                        "usedPercent": if total > 0 { ((total - free) as f64 / total as f64 * 100.0).round() } else { 0.0 },
                    }));
                }
            }
            Ok(json!({ "disks": disks }))
        }

        // ══ AI 执行：调用用户配置的服务商进行真实推理 ══
        "/api/ai/run" => {
            let st = read_settings(&app);
            let ai = st.get("ai").ok_or("尚未配置 AI 服务，请先前往设置配置 API Key 与接口地址")?;
            let base_url = ai.get("baseUrl").and_then(|v| v.as_str()).unwrap_or("").trim().trim_end_matches('/').to_string();
            let api_key = ai.get("apiKey").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
            let model = ai.get("model").and_then(|v| v.as_str()).unwrap_or("deepseek-chat").trim().to_string();
            let temperature = ai.get("temperature").and_then(|v| v.as_str()).and_then(|s| s.parse::<f64>().ok())
                .or_else(|| ai.get("temperature").and_then(|v| v.as_f64()))
                .unwrap_or(0.3);

            if base_url.is_empty() {
                return Err("尚未配置 AI 接口地址，请先在工具顶部或设置中心配置".into());
            }

            let action = args.get("action").and_then(|v| v.as_str()).unwrap_or("");

            let (system_prompt, user_prompt) = match action {
                "polish" => {
                    let text = args.get("text").and_then(|v| v.as_str()).unwrap_or("");
                    let mode = args.get("mode").and_then(|v| v.as_str()).unwrap_or("formal");
                    let req = args.get("requirement").and_then(|v| v.as_str()).unwrap_or("");
                    let mode_desc = match mode {
                        "formal" => "正式书面化，严谨专业",
                        "casual" => "通俗口语化，轻松亲和",
                        "concise" => "精简凝练，去冗除杂",
                        "expand" => "逻辑充实，细致扩写",
                        "proofread" => "纠错校对，修复错别字与语病",
                        "polite" => "委婉礼貌，得体周到",
                        "summary" => "提炼要点，突出核心信息",
                        _ => "文字优化与润色",
                    };
                    (
                        "你是一位精通汉语与多文体写作的专业文案专家。请严格按照要求润色文本，保持原意，语言流畅自然。直接输出润色后的正文，不要输出任何前言、开场白或解释说明。".to_string(),
                        format!("【润色目标】：{}\n【额外要求】：{}\n【原始文本】：\n{}", mode_desc, req, text)
                    )
                }
                "translate" => {
                    let text = args.get("text").and_then(|v| v.as_str()).unwrap_or("");
                    let target = args.get("target").and_then(|v| v.as_str()).unwrap_or("中文");
                    let source = args.get("language").and_then(|v| v.as_str()).unwrap_or("自动识别");
                    let tone = args.get("tone").and_then(|v| v.as_str()).unwrap_or("通顺自然");
                    let terms = args.get("terminology").and_then(|v| v.as_str()).unwrap_or("");
                    (
                        "你是一位资深多语言同传翻译专家。请准确、流畅地将用户给出的文本翻译为目标语言，忠实原文，文采自然。直接输出最终译文，不要带有任何多余说明或问候。".to_string(),
                        format!("【源语言】：{}\n【目标语言】：{}\n【翻译基调】：{}\n【专有名词对照】：{}\n【待翻译文本】：\n{}", source, target, tone, terms, text)
                    )
                }
                "document" => {
                    let topic = args.get("topic").and_then(|v| v.as_str()).unwrap_or("");
                    let doc_type = args.get("docType").and_then(|v| v.as_str()).unwrap_or("通知");
                    let length = args.get("length").and_then(|v| v.as_str()).unwrap_or("适中");
                    let audience = args.get("audience").and_then(|v| v.as_str()).unwrap_or("大众");
                    let points = args.get("points").and_then(|v| v.as_str()).unwrap_or("");
                    (
                        "你是一位经验丰富的高级公文与专业策划撰稿人。请根据用户需求撰写高质量文档，结构清晰，格式规范，用词严谨。直接输出文档正文。".to_string(),
                        format!("【文档主题】：{}\n【文体类型】：{}\n【目标受众】：{}\n【篇幅要求】：{}\n【核心要点】：\n{}", topic, doc_type, audience, length, points)
                    )
                }
                "table" => {
                    let req = args.get("requirement").and_then(|v| v.as_str()).unwrap_or("");
                    let rows = args.get("rows").and_then(|v| v.as_str()).unwrap_or("10");
                    (
                        "你是一位资深数据规划与结构化整理专家。请将用户需求转化为整洁的标准 Markdown 格式表格，表头清晰，字段完整。直接输出 Markdown 表格代码，不要包含多余寒暄。".to_string(),
                        format!("【需求描述】：{}\n【行数规模】：约 {} 行", req, rows)
                    )
                }
                "ppt_outline" => {
                    let topic = args.get("topic").and_then(|v| v.as_str()).unwrap_or("");
                    let materials = args.get("materials").and_then(|v| v.as_str()).unwrap_or("");
                    let audience = args.get("audience").and_then(|v| v.as_str()).unwrap_or("");
                    let slide_count = args.get("slideCount").and_then(|v| v.as_u64()).unwrap_or(8);
                    let style = args.get("style").and_then(|v| v.as_str()).unwrap_or("商务正式");
                    (
                        "你是一位资深商业演讲与 PPT 架构设计专家。请严格以 JSON 格式输出 PPT 结构大纲，不要输出任何 Markdown 格式或额外文字说明。JSON 格式必须严格符合：{\"title\":\"主标题\",\"subtitle\":\"副标题\",\"slides\":[{\"title\":\"幻灯片标题\",\"points\":[\"要点1\",\"要点2\"],\"notes\":\"演讲者备注\"}]}".to_string(),
                        format!("【演示主题】：{}\n【幻灯片页数】：{} 页\n【风格基调】：{}\n【受众群体】：{}\n【参考素材与要点】：\n{}", topic, slide_count, style, audience, materials)
                    )
                }
                _ => {
                    let prompt = args.get("prompt").or_else(|| args.get("text")).and_then(|v| v.as_str()).unwrap_or("");
                    (
                        "你是一位聪明、高效的 AI 助理。请直接回答用户的问题。".to_string(),
                        prompt.to_string()
                    )
                }
            };

            let req_body = json!({
                "model": model,
                "messages": [
                    { "role": "system", "content": system_prompt },
                    { "role": "user", "content": user_prompt }
                ],
                "temperature": temperature
            });

            let req_uuid = uuid::Uuid::new_v4().to_string();
            let tmp_req = std::env::temp_dir().join(format!("furina_ai_req_{}_{}.json", std::process::id(), req_uuid));
            let tmp_cfg = std::env::temp_dir().join(format!("furina_ai_cfg_{}_{}.txt", std::process::id(), req_uuid));
            fs::write(&tmp_req, req_body.to_string()).map_err(|e| format!("写入请求临时文件失败：{e}"))?;

            // W08 安全加固：通过 curl 配置文件传入 Authorization 头，避免在进程命令行中明文暴露 Key
            let mut cfg_content = String::new();
            if !api_key.is_empty() {
                cfg_content.push_str(&format!("header = \"Authorization: Bearer {api_key}\"
"));
            }
            let _ = fs::write(&tmp_cfg, &cfg_content);

            let mut cmd = Command::new("curl");
            crate::commands::no_window(&mut cmd);
            cmd.arg("-s")
                .arg("-S")
                .arg("--max-time")
                .arg("90")
                .arg("-X")
                .arg("POST")
                .arg(format!("{}/chat/completions", base_url))
                .arg("-H")
                .arg("Content-Type: application/json")
                .arg("-K")
                .arg(&tmp_cfg)
                .arg("-d")
                .arg(format!("@{}", tmp_req.to_string_lossy()));

            let out = cmd.output().map_err(|e| {
                let _ = fs::remove_file(&tmp_req);
                let _ = fs::remove_file(&tmp_cfg);
                format!("执行网络请求失败：{e}")
            })?;
            let _ = fs::remove_file(&tmp_req);
            let _ = fs::remove_file(&tmp_cfg);

            let stdout = String::from_utf8_lossy(&out.stdout);
            let stderr = String::from_utf8_lossy(&out.stderr);

            if !out.status.success() {
                return Err(format!("网络请求失败：{}", stderr.trim()));
            }

            let resp_val: Value = serde_json::from_str(&stdout).map_err(|e| {
                format!("解析服务商响应失败：{}，原始输出：{}", e, stdout.chars().take(200).collect::<String>())
            })?;

            if let Some(err_obj) = resp_val.get("error") {
                let err_msg = err_obj.get("message").and_then(|v| v.as_str()).unwrap_or("服务商返回未知错误");
                return Err(format!("服务商错误：{}", err_msg));
            }

            let content = resp_val
                .get("choices")
                .and_then(|c| c.get(0))
                .and_then(|ch| ch.get("message"))
                .and_then(|m| m.get("content"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim();

            if action == "ppt_outline" {
                let clean_json = content
                    .trim_start_matches("```json")
                    .trim_start_matches("```")
                    .trim_end_matches("```")
                    .trim();
                let outline_obj: Value = serde_json::from_str(clean_json).map_err(|e| {
                    format!("解析 PPT 大纲 JSON 失败：{}，模型返回内容：{}", e, content)
                })?;
                return Ok(json!({ "ok": true, "outline": outline_obj }));
            }

            if action == "table" {
                if content.is_empty() { return Err("AI 未返回表格内容，请重试".into()); }
                return Ok(ai_table_response(content));
            }
            Ok(json!({ "ok": true, "result": content }))
        }

        "/api/ppt/build" => {
            let outline = match args.get("outline") {
                Some(Value::String(s)) => serde_json::from_str::<Value>(s).map_err(|_| "PPT大纲不是有效JSON")?,
                Some(v) if v.is_object() => v.clone(),
                _ => return Err("缺少PPT大纲".into()),
            };
            let slides=outline.get("slides").and_then(Value::as_array).ok_or("大纲缺少内容页")?;
            if slides.is_empty() { return Err("大纲中至少需要一页内容".into()); }
            let theme=args.get("theme").and_then(Value::as_str).unwrap_or("business");
            if !["business","fresh","warm","dark"].contains(&theme) { return Err("不支持的PPT配色".into()); }
            let payload=json!({"outline":serde_json::to_string(&outline).map_err(|e|e.to_string())?,"theme":theme,"with_toc":args.get("with_toc").and_then(Value::as_bool).unwrap_or(true)});
            // Rust 原生生成（ppt_build.rs），不再依赖 Python 扩展
            crate::doc_native::start(&app, "ppt-from-outline", &payload)
        }

        // ══ 输出目录：列出里面的文件 ══
        "/api/output-dir/files" => {
            let st = read_settings(&app);
            let dir = st.get("outputDir").and_then(|v| v.as_str()).map(|s| s.to_string())
                .unwrap_or_else(default_output_dir);
            let mut files: Vec<Value> = Vec::new();
            if let Ok(entries) = fs::read_dir(&dir) {
                for e in entries.flatten() {
                    if let Ok(m) = e.metadata() {
                        if m.is_file() {
                            files.push(json!({
                                "name": e.file_name().to_string_lossy(),
                                "size": m.len(),
                                "path": e.path().to_string_lossy(),
                            }));
                        }
                    }
                }
            }
            files.sort_by(|a, b| b["size"].as_u64().cmp(&a["size"].as_u64()));
            files.truncate(200);
            Ok(json!({ "dir": dir, "files": files }))
        }

        // ══ 存储与任务维护 ══
        "/api/storage/info" => {
            let root = crate::jobs::storage_dir_of(&app);
            let mut size = 0u64;
            let mut count = 0usize;
            let mut stack = vec![root.clone()];
            while let Some(d) = stack.pop() {
                if let Ok(entries) = fs::read_dir(&d) {
                    for e in entries.flatten() {
                        if let Ok(m) = e.metadata() {
                            if m.is_dir() { stack.push(e.path()); }
                            else { size += m.len(); count += 1; }
                        }
                    }
                }
            }
            Ok(json!({ "dir": root.to_string_lossy(), "bytes": size, "files": count }))
        }

        "/api/jobs/purge" if method == "POST" => {
            let n = crate::jobs::purge_expired(&app, 24);
            Ok(json!({ "ok": true, "purged": n, "message": format!("清理了 {n} 个过期任务") }))
        }

        // ── 还没搬过来的 ──
        other => Err(format!("这个功能还没搬到 Tauri 版（缺少接口 {other}）")),
    }
}

/// 本次构建的信息（构建时间由 build.rs 在编译期写入）。
///
/// 用途：界面上直接显示「这是哪一版」。这个应用有单实例保护，旧进程没关掉时
/// 点快捷方式只会把旧窗口调到前台 —— 有了构建时间就能一眼分辨，不用再猜。
#[tauri::command]
pub fn get_build_info() -> serde_json::Value {
    serde_json::json!({
        "buildTime": env!("FURINAKIT_BUILD_TIME"),
        "buildEpoch": env!("FURINAKIT_BUILD_EPOCH"),
        "version": env!("CARGO_PKG_VERSION"),
    })
}
