// PDF 基础操作内核（Rust 版）—— 迁移的第二块
//
// Python 侧的 PDF 靠 pymupdf（53MB）。基础操作（合并、取信息、旋转、删页、拆页）
// 用纯 Rust 的 lopdf 就能做，编译进 exe 只有几百 KB。
//
// 注意分界：
//   · 能做（已实现）：合并、取页数/尺寸、旋转、删页、提取指定页
//   · 暂时做不了（仍走 Python）：提取文字、渲染成图、内容层编辑、PDF 转 Office
//     这些要么需要字体解析、要么需要完整的渲染引擎，Rust 侧还没有成熟且轻量的选择。

use std::fs;
use std::path::{Path, PathBuf};

use lopdf::{dictionary, Document, Object, ObjectId};
use serde_json::{json, Value};
use tauri::Manager;

fn results_dir(app: &tauri::AppHandle) -> PathBuf {
    let dir = crate::jobs::storage_dir_of(app).join("results");
    let _ = fs::create_dir_all(&dir);
    dir
}

fn load(path: &str) -> Result<Document, String> {
    if !Path::new(path).is_file() {
        return Err(format!("文件不存在：{path}"));
    }
    Document::load(path).map_err(|e| format!("不是能读的 PDF：{e}"))
}

fn inputs(args: &Value) -> Vec<String> {
    let mut v: Vec<String> = Vec::new();
    if let Some(arr) = args.get("files").and_then(|a| a.as_array()) {
        for x in arr {
            if let Some(s) = x.as_str() {
                v.push(s.to_string());
            }
        }
    }
    if v.is_empty() {
        if let Some(s) = args.get("file").and_then(|x| x.as_str()) {
            if !s.is_empty() {
                v.push(s.to_string());
            }
        }
    }
    v
}

fn out_path(app: &tauri::AppHandle, stem: &str, suffix: &str) -> PathBuf {
    results_dir(app).join(format!("{stem}{suffix}.pdf"))
}

/// 页码解析：前端可能传 "1,3,5-7"（文本框）、[1,3,5]（数字数组）或 ["1","3"]（字符串数组）。
/// 中文逗号、空格、分号、重复项都容忍；解析不出的片段直接忽略，不让整次操作失败。
/// ★ 以前这里只认数字数组 —— 通用表单的文本框发来的是字符串，结果"明明填了页码
///   还是报 没有指定要删除的页码"。
fn pages_from(args: &Value, keys: &[&str]) -> Vec<u32> {
    let mut out: Vec<u32> = Vec::new();
    for key in keys {
        if !out.is_empty() { break; }
        let Some(v) = args.get(*key) else { continue };
        let mut texts: Vec<String> = Vec::new();
        if let Some(arr) = v.as_array() {
            for x in arr {
                if let Some(n) = x.as_u64() {
                    if (1..=100_000).contains(&n) { out.push(n as u32); }
                } else if let Some(s) = x.as_str() {
                    texts.push(s.to_string());
                }
            }
        } else if let Some(s) = v.as_str() {
            texts.push(s.to_string());
        }
        for s in texts {
            for part in s.split(|c: char| c == ',' || c == '，' || c == ';' || c == '；' || c.is_whitespace()) {
                let part = part.trim();
                if part.is_empty() { continue; }
                if let Some((a, b)) = part.split_once('-') {
                    if let (Ok(a), Ok(b)) = (a.trim().parse::<u32>(), b.trim().parse::<u32>()) {
                        if a >= 1 && b >= a && b - a < 10_000 {
                            for p in a..=b { out.push(p); }
                        }
                    }
                } else if let Ok(n) = part.parse::<u32>() {
                    if n >= 1 { out.push(n); }
                }
            }
        }
    }
    out.sort_unstable();
    out.dedup();
    out
}

/// 范围解析（分割用）：必须保留用户书写的顺序与分组，"1-3,5,7-9" → [(1,3),(5,5),(7,9)]。
fn ranges_from(args: &Value, keys: &[&str]) -> Vec<(u32, u32)> {
    let mut out: Vec<(u32, u32)> = Vec::new();
    for key in keys {
        if let Some(v) = args.get(*key) {
            if let Some(s) = v.as_str() {
                for part in s.split(|c: char| c == ',' || c == '，' || c == ';' || c == '；' || c.is_whitespace()) {
                    let part = part.trim();
                    if part.is_empty() { continue; }
                    if let Some((a, b)) = part.split_once('-') {
                        if let (Ok(a), Ok(b)) = (a.trim().parse::<u32>(), b.trim().parse::<u32>()) {
                            if a >= 1 && b >= a { out.push((a, b)); }
                        }
                    } else if let Ok(n) = part.parse::<u32>() {
                        if n >= 1 { out.push((n, n)); }
                    }
                }
            } else if let Some(arr) = v.as_array() {
                for x in arr {
                    if let Some(n) = x.as_u64() {
                        if n >= 1 { out.push((n as u32, n as u32)); }
                    } else if let Some(s) = x.as_str() {
                        if let Some((a, b)) = s.split_once('-') {
                            if let (Ok(a), Ok(b)) = (a.trim().parse::<u32>(), b.trim().parse::<u32>()) {
                                if a >= 1 && b >= a { out.push((a, b)); }
                            }
                        } else if let Ok(n) = s.trim().parse::<u32>() {
                            if n >= 1 { out.push((n, n)); }
                        }
                    }
                }
            }
        }
        if !out.is_empty() { break; }
    }
    out
}

/// 旋转角度：老接口叫 angle，前端表单的输入框 id 是 rotation，个别组件传 rotate —— 三个名字都认。
fn angle_from(args: &Value) -> i64 {
    for key in ["angle", "rotation", "rotate"] {
        if let Some(v) = args.get(key) {
            if let Some(n) = v.as_i64() {
                return n.rem_euclid(360);
            }
            if let Some(s) = v.as_str() {
                if let Ok(n) = s.trim().parse::<i64>() {
                    return n.rem_euclid(360);
                }
            }
        }
    }
    90
}

/// CRC32（IEEE，查表法）—— zip 条目校验用，不引第三方压缩库。
fn crc32(data: &[u8]) -> u32 {
    static TABLE: std::sync::OnceLock<[u32; 256]> = std::sync::OnceLock::new();
    let table = TABLE.get_or_init(|| {
        let mut t = [0u32; 256];
        for (i, e) in t.iter_mut().enumerate() {
            let mut c = i as u32;
            for _ in 0..8 {
                c = if c & 1 != 0 { 0xEDB8_8320 ^ (c >> 1) } else { c >> 1 };
            }
            *e = c;
        }
        t
    });
    let mut crc = 0xFFFF_FFFFu32;
    for &b in data {
        crc = table[((crc ^ b as u32) & 0xFF) as usize] ^ (crc >> 8);
    }
    crc ^ 0xFFFF_FFFF
}

/// 最小「仅存储（store）」zip 打包器：本地产物自用，不压缩，只求结构正确 ——
/// 资源管理器 / Python zipfile / 常见解压工具都认。文件名带中文没问题（UTF-8 标志位）。
fn stored_zip(entries: &[(String, Vec<u8>)]) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::new();
    let mut central: Vec<u8> = Vec::new();
    // DOS 时间字段给固定合法值（2026-01-01），个别解压工具对 0 值挑剔。
    let dos_time: u16 = 0;
    let dos_date: u16 = ((2026 - 1980) << 9) | (1 << 5) | 1;
    for (name, data) in entries {
        let nb = name.as_bytes();
        let crc = crc32(data);
        let mut lh = Vec::with_capacity(30 + nb.len());
        lh.extend_from_slice(b"PK\x03\x04");
        lh.extend_from_slice(&20u16.to_le_bytes());      // version needed
        lh.extend_from_slice(&0x0800u16.to_le_bytes());  // UTF-8 文件名
        lh.extend_from_slice(&0u16.to_le_bytes());       // store，不压缩
        lh.extend_from_slice(&dos_time.to_le_bytes());
        lh.extend_from_slice(&dos_date.to_le_bytes());
        lh.extend_from_slice(&crc.to_le_bytes());
        lh.extend_from_slice(&(data.len() as u32).to_le_bytes());
        lh.extend_from_slice(&(data.len() as u32).to_le_bytes());
        lh.extend_from_slice(&(nb.len() as u16).to_le_bytes());
        lh.extend_from_slice(&0u16.to_le_bytes());       // extra len
        lh.extend_from_slice(nb);
        let offset = out.len() as u32;
        out.extend_from_slice(&lh);
        out.extend_from_slice(data);

        central.extend_from_slice(b"PK\x01\x02");
        central.extend_from_slice(&20u16.to_le_bytes());     // version made by
        central.extend_from_slice(&20u16.to_le_bytes());     // version needed
        central.extend_from_slice(&0x0800u16.to_le_bytes()); // UTF-8
        central.extend_from_slice(&0u16.to_le_bytes());      // store
        central.extend_from_slice(&dos_time.to_le_bytes());
        central.extend_from_slice(&dos_date.to_le_bytes());
        central.extend_from_slice(&crc.to_le_bytes());
        central.extend_from_slice(&(data.len() as u32).to_le_bytes());
        central.extend_from_slice(&(data.len() as u32).to_le_bytes());
        central.extend_from_slice(&(nb.len() as u16).to_le_bytes());
        central.extend_from_slice(&0u16.to_le_bytes());      // extra
        central.extend_from_slice(&0u16.to_le_bytes());      // comment
        central.extend_from_slice(&0u16.to_le_bytes());      // disk start
        central.extend_from_slice(&0u16.to_le_bytes());      // internal attrs
        central.extend_from_slice(&0u32.to_le_bytes());      // external attrs
        central.extend_from_slice(&offset.to_le_bytes());    // 本地头偏移
        central.extend_from_slice(nb);
    }
    let cd_offset = out.len() as u32;
    let cd_len = central.len() as u32;
    out.extend_from_slice(&central);
    out.extend_from_slice(b"PK\x05\x06");
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes());
    out.extend_from_slice(&(entries.len() as u16).to_le_bytes());
    out.extend_from_slice(&(entries.len() as u16).to_le_bytes());
    out.extend_from_slice(&cd_len.to_le_bytes());
    out.extend_from_slice(&cd_offset.to_le_bytes());
    out.extend_from_slice(&0u16.to_le_bytes()); // comment len
    out
}

fn base_stem(p: &str) -> String {
    Path::new(p)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "output".into())
}

/// 合并多个 PDF
pub fn pdf_merge(app: &tauri::AppHandle, args: &Value) -> Result<Value, String> {
    let files = inputs(args);
    if files.len() < 2 {
        return Err("合并至少需要两个 PDF".into());
    }

    let mut merged = Document::with_version("1.7");
    let mut all_pages: Vec<ObjectId> = Vec::new();
    let mut next_id = 1u32;

    for f in &files {
        let mut doc = load(f)?;
        // 关键：先把这份文档的对象编号整体往后挪，避免与已合并的编号冲突。
        // 挪完之后必须【重新取一次页 id】—— 旧 id 已经失效了（这是我第一次写错的地方）。
        doc.renumber_objects_with(next_id);
        next_id = doc.max_id + 1;

        for (_, page_id) in doc.get_pages() {
            all_pages.push(page_id);
        }
        // 把这份文档的全部对象搬进合并文档
        for (id, obj) in doc.objects.iter() {
            merged.objects.insert(*id, obj.clone());
        }
        if doc.max_id > merged.max_id {
            merged.max_id = doc.max_id;
        }
    }

    if all_pages.is_empty() {
        return Err("这些 PDF 里没有页面".into());
    }

    // 重建 Pages 树
    let pages_id = merged.new_object_id();
    let count = all_pages.len() as i64;
    let kids: Vec<Object> = all_pages.iter().map(|id| Object::Reference(*id)).collect();
    merged.objects.insert(
        pages_id,
        Object::Dictionary(dictionary! {
            "Type" => "Pages",
            "Kids" => kids,
            "Count" => count,
        }),
    );
    for pid in &all_pages {
        if let Ok(Object::Dictionary(d)) = merged.get_object_mut(*pid) {
            d.set("Parent", pages_id);
        }
    }
    let catalog_id = merged.add_object(dictionary! {
        "Type" => "Catalog",
        "Pages" => pages_id,
    });
    merged.trailer.set("Root", catalog_id);
    merged.renumber_objects();
    merged.compress();

    let out = out_path(app, &base_stem(&files[0]), "_已合并");
    merged.save(&out).map_err(|e| format!("保存失败：{e}"))?;
    let size = fs::metadata(&out).map(|m| m.len()).unwrap_or(0);

    Ok(json!({
        "success": true, "output": out.to_string_lossy(),
        "filename": out.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        "message": format!("已合并 {} 个文件，共 {} 页", files.len(), all_pages.len()),
        "pages": all_pages.len(), "bytes": size,
    }))
}

/// 取 PDF 信息（页数、每页尺寸）
pub fn pdf_info(args: &Value) -> Result<Value, String> {
    let files = inputs(args);
    let first = files.first().ok_or("没有指定 PDF")?;
    let doc = load(first)?;
    let pages = doc.get_pages();
    let mut sizes: Vec<Value> = Vec::new();
    for (num, id) in pages.iter().take(50) {
        if let Ok(Object::Dictionary(d)) = doc.get_object(*id) {
            let media = d.get(b"MediaBox").ok();
            let arr = match media {
                Some(Object::Array(a)) => Some(a.clone()),
                Some(Object::Reference(r)) => match doc.get_object(*r) {
                    Ok(Object::Array(a)) => Some(a.clone()),
                    _ => None,
                },
                _ => None,
            };
            if let Some(a) = arr {
                let nums: Vec<f64> = a
                    .iter()
                    .filter_map(|o| match o {
                        Object::Integer(i) => Some(*i as f64),
                        Object::Real(r) => Some(*r as f64),
                        _ => None,
                    })
                    .collect();
                if nums.len() == 4 {
                    let pt_w = nums[2] - nums[0];
                    let pt_h = nums[3] - nums[1];
                    sizes.push(json!({
                        "page": num,
                        "widthPt": pt_w.round(), "heightPt": pt_h.round(),
                        "widthMm": (pt_w / 72.0 * 25.4).round(), "heightMm": (pt_h / 72.0 * 25.4).round(),
                    }));
                }
            }
        }
    }
    let size = fs::metadata(first).map(|m| m.len()).unwrap_or(0);
    Ok(json!({
        "pages": pages.len(), "bytes": size, "pageSizes": sizes,
        "message": format!("共 {} 页，{:.1} MB", pages.len(), size as f64 / 1048576.0),
    }))
}

/// 旋转所有页（或指定页）
pub fn pdf_rotate(app: &tauri::AppHandle, args: &Value) -> Result<Value, String> {
    let files = inputs(args);
    let first = files.first().ok_or("没有指定 PDF")?;
    let mut doc = load(first)?;
    // 前端表单的字段名是 rotation（旧接口叫 angle，个别组件传 rotate），三个名字都认。
    let angle = angle_from(args);
    if ![90, 180, 270, 0].contains(&angle) {
        return Err("旋转角度只能是 90 / 180 / 270".into());
    }
    let pages: Vec<(u32, ObjectId)> = doc.get_pages().into_iter().collect();
    let only: Option<Vec<u32>> = {
        let list = pages_from(args, &["pages"]);
        if list.is_empty() { None } else { Some(list) }
    };

    let mut n = 0;
    for (num, id) in pages {
        if let Some(list) = &only {
            if !list.contains(&num) {
                continue;
            }
        }
        if let Ok(Object::Dictionary(d)) = doc.get_object_mut(id) {
            let cur = d.get(b"Rotate").ok().and_then(|o| o.as_i64().ok()).unwrap_or(0);
            d.set("Rotate", (cur + angle).rem_euclid(360));
            n += 1;
        }
    }
    doc.save(&out_path(app, &base_stem(first), "_已旋转"))
        .map_err(|e| format!("保存失败：{e}"))?;
    let out = out_path(app, &base_stem(first), "_已旋转");
    let size = fs::metadata(&out).map(|m| m.len()).unwrap_or(0);
    Ok(json!({
        "success": true, "output": out.to_string_lossy(),
        "filename": out.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        "message": format!("已旋转 {n} 页（{angle}°）"), "bytes": size,
    }))
}

/// 删除指定页
pub fn pdf_delete_pages(app: &tauri::AppHandle, args: &Value) -> Result<Value, String> {
    let files = inputs(args);
    let first = files.first().ok_or("没有指定 PDF")?;
    let mut doc = load(first)?;
    // 前端是文本框（"1,3,5-7"），也可能收到数组 —— pages_from 都接得住
    let mut list: Vec<u32> = pages_from(args, &["pages"]);
    if list.is_empty() {
        return Err("没有指定要删除的页码".into());
    }
    list.sort_unstable();
    list.dedup();
    let total = doc.get_pages().len();
    if list.len() >= total {
        return Err("不能把页全删了".into());
    }
    // 降序删除，避免 1-based 页码前移导致后续页码错位
    let mut desc = list.clone();
    desc.sort_by(|a, b| b.cmp(a));
    for p in &desc {
        let _ = doc.delete_pages(&[*p]);
    }
    doc.renumber_objects();
    doc.compress();
    let out = out_path(app, &base_stem(first), "_已删页");
    doc.save(&out).map_err(|e| format!("保存失败：{e}"))?;
    let size = fs::metadata(&out).map(|m| m.len()).unwrap_or(0);
    Ok(json!({
        "success": true, "output": out.to_string_lossy(),
        "filename": out.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        "message": format!("已删除 {} 页，剩 {} 页", list.len(), total - list.len()),
        "bytes": size,
    }))
}

/// 提取指定页为一个新 PDF（拆分的基础）
pub fn pdf_extract(app: &tauri::AppHandle, args: &Value) -> Result<Value, String> {
    let files = inputs(args);
    let first = files.first().ok_or("没有指定 PDF")?;
    let mut doc = load(first)?;
    // 同 pdf_delete_pages：文本 / 数组两种页码写法都接
    let mut list: Vec<u32> = pages_from(args, &["pages"]);
    if list.is_empty() {
        return Err("没有指定要提取的页码".into());
    }
    list.sort_unstable();
    list.dedup();
    let total = doc.get_pages().len();
    let keep_set: std::collections::HashSet<u32> = list.iter().copied().collect();
    let mut to_delete: Vec<u32> = (1..=(total as u32)).filter(|p| !keep_set.contains(p)).collect();
    if to_delete.len() >= total {
        return Err("提取后没有剩余有效页面，请检查页码范围".into());
    }
    // 降序删除未选中的页面，仅保留用户指定的提取页面
    to_delete.sort_by(|a, b| b.cmp(a));
    for p in &to_delete {
        let _ = doc.delete_pages(&[*p]);
    }
    doc.renumber_objects();
    doc.compress();
    let kept_count = total - to_delete.len();
    let suffix = format!("_已提取_{}页", kept_count);
    let out = out_path(app, &base_stem(first), &suffix);
    doc.save(&out).map_err(|e| format!("保存失败：{e}"))?;
    let size = fs::metadata(&out).map(|m| m.len()).unwrap_or(0);
    Ok(json!({
        "success": true, "output": out.to_string_lossy(),
        "filename": out.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default(),
        "message": format!("已提取，共保留 {} 页", kept_count), "bytes": size,
    }))
}

/// 真正的「分割」：按用户给的范围一段一段拆（1-3 一份、5 一份、7-9 一份）。
/// 只有一段时直接给 PDF；多段时打包成 zip（stored_zip），下载走现成的产物链路。
/// ★ 以前这里和 pdf_extract 共用逻辑，只会"留下指定页"出一个文件 ——
///   但界面上这个工具承诺的是"按页码范围分割成多个文件"。
pub fn pdf_split(app: &tauri::AppHandle, args: &Value) -> Result<Value, String> {
    let files = inputs(args);
    let first = files.first().ok_or("没有指定 PDF")?;
    let ranges = ranges_from(args, &["ranges", "pages"]);
    if ranges.is_empty() {
        return Err("没有指定分割范围，例如 1-3,5,7-9".into());
    }
    let total = load(first)?.get_pages().len() as u32;
    if total == 0 {
        return Err("这份 PDF 里没有页面".into());
    }
    let stem = base_stem(first);
    let mut parts: Vec<(String, Vec<u8>)> = Vec::new();
    for (a, b) in ranges {
        let a = a.max(1);
        let b = b.min(total);
        if a > b {
            continue; // 超出总页数的段直接跳过
        }
        let mut doc = load(first)?;
        // 降序删除段外的页，避免 1-based 页码前移错位（与 pdf_extract 同一套手法）
        let mut to_delete: Vec<u32> = (1..=total).filter(|p| *p < a || *p > b).collect();
        to_delete.sort_by(|x, y| y.cmp(x));
        for p in &to_delete {
            let _ = doc.delete_pages(&[*p]);
        }
        doc.renumber_objects();
        doc.compress();
        let mut buf = Vec::new();
        doc.save_to(&mut buf).map_err(|e| format!("保存失败：{e}"))?;
        let name = if a == b {
            format!("{stem}_第{a}页.pdf")
        } else {
            format!("{stem}_第{a}-{b}页.pdf")
        };
        parts.push((name, buf));
    }
    if parts.is_empty() {
        return Err("给定的范围都超出了这份 PDF 的页数".into());
    }
    if parts.len() == 1 {
        let (name, buf) = parts.remove(0);
        let out = results_dir(app).join(&name);
        fs::write(&out, &buf).map_err(|e| format!("保存失败：{e}"))?;
        return Ok(json!({
            "success": true, "output": out.to_string_lossy(),
            "filename": name,
            "message": "已分割出 1 个文件".to_string(),
            "bytes": buf.len(),
        }));
    }
    let zip_name = format!("{stem}_已分割.zip");
    let out = results_dir(app).join(&zip_name);
    let bytes = stored_zip(&parts);
    fs::write(&out, &bytes).map_err(|e| format!("保存失败：{e}"))?;
    Ok(json!({
        "success": true, "output": out.to_string_lossy(),
        "filename": zip_name,
        "message": format!("已按 {} 个范围分割，打包为 zip", parts.len()),
        "bytes": bytes.len(),
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn pages_from_accepts_string_array_and_ranges() {
        assert_eq!(pages_from(&json!({"pages": "1,3,5-7"}), &["pages"]), vec![1, 3, 5, 6, 7]);
        assert_eq!(pages_from(&json!({"pages": [2, 4, "6"]}), &["pages"]), vec![2, 4, 6]);
        // 中文逗号 / 分号 / 混入垃圾片段：能认的认，认不了的忽略
        assert_eq!(pages_from(&json!({"pages": "2，4-5；x，,9"}), &["pages"]), vec![2, 4, 5, 9]);
        assert!(pages_from(&json!({}), &["pages", "page"]).is_empty());
        // 范围倒写（5-3）不产出任何页
        assert!(pages_from(&json!({"pages": "5-3"}), &["pages"]).is_empty());
    }

    #[test]
    fn ranges_from_keeps_order_and_groups() {
        assert_eq!(
            ranges_from(&json!({"ranges": "1-3,5,7-9"}), &["ranges", "pages"]),
            vec![(1, 3), (5, 5), (7, 9)]
        );
        assert!(ranges_from(&json!({"ranges": "abc"}), &["ranges"]).is_empty());
    }

    #[test]
    fn angle_from_reads_all_field_names() {
        assert_eq!(angle_from(&json!({"angle": "180"})), 180);
        assert_eq!(angle_from(&json!({"rotation": 270})), 270);
        assert_eq!(angle_from(&json!({"rotate": -90})), 270);
        assert_eq!(angle_from(&json!({})), 90);
    }

    #[test]
    fn stored_zip_is_structurally_valid() {
        let bytes = stored_zip(&[
            ("第一段.pdf".into(), vec![1u8, 2, 3]),
            ("second.pdf".into(), vec![4, 5, 6, 7]),
        ]);
        assert_eq!(&bytes[0..4], b"PK\x03\x04");
        let eocd = bytes
            .windows(4)
            .rposition(|w| w == b"PK\x05\x06")
            .expect("EOCD 签名");
        assert_eq!(u16::from_le_bytes([bytes[eocd + 10], bytes[eocd + 11]]), 2);
        // 结构不变量：cd_offset + cd_size + 22（EOCD 自身） == 总长
        let cd_size = u32::from_le_bytes([
            bytes[eocd + 12], bytes[eocd + 13], bytes[eocd + 14], bytes[eocd + 15],
        ]) as usize;
        let cd_offset = u32::from_le_bytes([
            bytes[eocd + 16], bytes[eocd + 17], bytes[eocd + 18], bytes[eocd + 19],
        ]) as usize;
        assert_eq!(cd_offset + cd_size + 22, bytes.len());

        // 落盘后用系统 Python 的 zipfile 严格验一遍（机器上没 python 就跳过）
        let path = std::env::temp_dir().join("furinakit-zip-selftest.zip");
        if std::fs::write(&path, &bytes).is_ok() {
            let code = format!(
                "import zipfile; z=zipfile.ZipFile(r'{}'); n=z.namelist(); assert n==['第一段.pdf','second.pdf'], n; assert z.read('second.pdf')==bytes([4,5,6,7]); print('ok')",
                path.to_string_lossy()
            );
            if let Ok(o) = std::process::Command::new("python").args(["-c", &code]).output() {
                assert!(
                    o.status.success(),
                    "python zipfile 校验失败: {}",
                    String::from_utf8_lossy(&o.stderr)
                );
            }
        }
    }
}
