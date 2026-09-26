//! SVG 优化：Rust 原生实现（此前这个工具请求会落进 Python 队列，而 Python 端并没有对应处理器）。
//!
//! 只做「不改变显示效果」的安全清理：
//! · 去掉 XML 声明、DOCTYPE、注释、<metadata>、编辑器（Inkscape / Sodipodi）私有元素与属性；
//! · 去掉不再使用的 rdf / cc / dc / inkscape / sodipodi 命名空间声明；
//! · 去掉纯缩进的空白（<text> 内部与声明了 xml:space 的文件不动）；
//! · 路径数据 d、points、transform 里的数字保留 3 位小数。
//! 结果如果没有变小，就原样返回。

use serde_json::{json, Value};

const EDITOR_PREFIXES: [&str; 2] = ["inkscape:", "sodipodi:"];
const META_PREFIXES: [&str; 5] = ["rdf", "cc", "dc", "inkscape", "sodipodi"];

enum Tok {
    Text(String),
    /// 原样保留的片段（CDATA 等）
    Raw(String),
    Tag { name: String, attrs: Vec<(String, String, char)>, close: bool, selfclose: bool },
}

fn find_from(s: &str, pat: &str, from: usize) -> Option<usize> {
    s.get(from..)?.find(pat).map(|i| i + from)
}

fn tokenize(src: &str) -> Result<Vec<Tok>, String> {
    let b = src.as_bytes();
    let mut out = Vec::new();
    let mut i = 0;
    while i < b.len() {
        if b[i] != b'<' {
            let end = find_from(src, "<", i).unwrap_or(b.len());
            out.push(Tok::Text(src[i..end].to_string()));
            i = end;
            continue;
        }
        let rest = &src[i..];
        if rest.starts_with("<!--") {
            let end = find_from(src, "-->", i + 4).ok_or("SVG 注释没有闭合")?;
            i = end + 3;
        } else if rest.starts_with("<![CDATA[") {
            let end = find_from(src, "]]>", i + 9).ok_or("SVG 中的 CDATA 没有闭合")?;
            out.push(Tok::Raw(src[i..end + 3].to_string()));
            i = end + 3;
        } else if rest.starts_with("<?") {
            let end = find_from(src, "?>", i + 2).ok_or("SVG 声明没有闭合")?;
            i = end + 2;
        } else if rest.starts_with("<!") {
            // DOCTYPE（可能带 [...] 内部子集）
            let mut j = i + 2;
            let mut depth = 0i32;
            while j < b.len() {
                match b[j] {
                    b'[' => depth += 1,
                    b']' => depth -= 1,
                    b'>' if depth <= 0 => break,
                    _ => {}
                }
                j += 1;
            }
            if j >= b.len() {
                return Err("SVG 的 DOCTYPE 没有闭合".into());
            }
            i = j + 1;
        } else {
            // 普通标签：属性值里可能有 '>'
            let mut j = i + 1;
            let mut quote = 0u8;
            while j < b.len() {
                let c = b[j];
                if quote != 0 {
                    if c == quote {
                        quote = 0;
                    }
                } else if c == b'"' || c == b'\'' {
                    quote = c;
                } else if c == b'>' {
                    break;
                }
                j += 1;
            }
            if j >= b.len() {
                return Err("SVG 标签没有闭合，文件可能已损坏".into());
            }
            out.push(parse_tag(&src[i + 1..j])?);
            i = j + 1;
        }
    }
    Ok(out)
}

fn parse_tag(inner: &str) -> Result<Tok, String> {
    let mut s = inner.trim();
    let close = s.starts_with('/');
    if close {
        s = s[1..].trim_start();
    }
    let selfclose = s.ends_with('/');
    if selfclose {
        s = s[..s.len() - 1].trim_end();
    }
    let name_end = s.find(|c: char| c.is_whitespace()).unwrap_or(s.len());
    let name = s[..name_end].to_string();
    if name.is_empty() {
        return Err("SVG 里有空标签，文件可能已损坏".into());
    }
    let mut attrs = Vec::new();
    let a = s[name_end..].as_bytes();
    let text = &s[name_end..];
    let mut k = 0;
    while k < a.len() {
        while k < a.len() && (a[k] as char).is_whitespace() {
            k += 1;
        }
        if k >= a.len() {
            break;
        }
        let ns = k;
        while k < a.len() && a[k] != b'=' && !(a[k] as char).is_whitespace() {
            k += 1;
        }
        let an = text[ns..k].to_string();
        while k < a.len() && (a[k] as char).is_whitespace() {
            k += 1;
        }
        if k >= a.len() || a[k] != b'=' {
            return Err(format!("属性 {an} 缺少取值，文件可能已损坏"));
        }
        k += 1;
        while k < a.len() && (a[k] as char).is_whitespace() {
            k += 1;
        }
        if k >= a.len() || (a[k] != b'"' && a[k] != b'\'') {
            return Err(format!("属性 {an} 的取值没有加引号"));
        }
        let q = a[k];
        let vs = k + 1;
        let ve = text[vs..].find(q as char).map(|x| x + vs).ok_or("属性值引号没有闭合")?;
        attrs.push((an, text[vs..ve].to_string(), q as char));
        k = ve + 1;
    }
    Ok(Tok::Tag { name, attrs, close, selfclose })
}

fn is_editor(name: &str) -> bool {
    EDITOR_PREFIXES.iter().any(|p| name.starts_with(p))
}

/// 数字保留 3 位小数（科学计数法不动；不会让相邻数字粘连）
pub(crate) fn round_numbers(v: &str) -> String {
    let b = v.as_bytes();
    let mut out = String::with_capacity(v.len());
    let mut i = 0;
    while i < b.len() {
        let c = b[i];
        let starts = c.is_ascii_digit() || (c == b'.' && i + 1 < b.len() && b[i + 1].is_ascii_digit())
            || ((c == b'-' || c == b'+') && i + 1 < b.len() && (b[i + 1].is_ascii_digit() || b[i + 1] == b'.'));
        if !starts {
            out.push(c as char);
            i += 1;
            continue;
        }
        let s = i;
        if c == b'-' || c == b'+' {
            i += 1;
        }
        while i < b.len() && b[i].is_ascii_digit() {
            i += 1;
        }
        let mut decimals = 0;
        if i < b.len() && b[i] == b'.' {
            i += 1;
            while i < b.len() && b[i].is_ascii_digit() {
                i += 1;
                decimals += 1;
            }
        }
        let has_exp = i < b.len() && (b[i] == b'e' || b[i] == b'E')
            && (i + 1 < b.len() && (b[i + 1].is_ascii_digit() || ((b[i + 1] == b'-' || b[i + 1] == b'+') && i + 2 < b.len() && b[i + 2].is_ascii_digit())));
        if has_exp {
            i += 2;
            while i < b.len() && b[i].is_ascii_digit() {
                i += 1;
            }
            out.push_str(&v[s..i]);
            continue;
        }
        let tok = &v[s..i];
        if decimals <= 3 {
            out.push_str(tok);
            continue;
        }
        match tok.parse::<f64>() {
            Ok(x) if x.is_finite() => {
                let mut r = format!("{:.3}", x);
                if r.contains('.') {
                    r = r.trim_end_matches('0').trim_end_matches('.').to_string();
                }
                // “-0” 保留负号：负号常常兼作分隔符（“5-0.00001” 不能变成 “50”）
                // 原来用 “+” 开头的，保留一个分隔效果
                if tok.starts_with('+') && !r.starts_with('-') {
                    r.insert(0, '+');
                }
                // 下一个字符是 “.” 时必须保留小数点，否则 “1.00001.5” 会变成 “1.5”
                if i < b.len() && b[i] == b'.' && !r.contains('.') {
                    r.push_str(".0");
                }
                out.push_str(&r);
            }
            _ => out.push_str(tok),
        }
    }
    out
}

pub(crate) fn optimize(src: &str) -> Result<String, String> {
    let src = src.trim_start_matches('\u{feff}');
    if !src.contains("<svg") {
        return Err("这不是 SVG 文件（没有找到 <svg> 标签）".into());
    }
    let toks = tokenize(src)?;
    let preserve_space = src.contains("xml:space");
    // 第一遍：删元素（metadata 与编辑器私有元素，整棵子树）、删编辑器属性
    let mut kept: Vec<Tok> = Vec::with_capacity(toks.len());
    let mut skip: Option<(String, i32)> = None;
    for t in toks {
        if let Some((name, depth)) = skip.as_mut() {
            if let Tok::Tag { name: n, close, selfclose, .. } = &t {
                if n == name {
                    if *close {
                        *depth -= 1;
                    } else if !*selfclose {
                        *depth += 1;
                    }
                }
            }
            if *depth == 0 {
                skip = None;
            }
            continue;
        }
        match t {
            Tok::Tag { name, attrs, close, selfclose } => {
                let drop = name == "metadata" || is_editor(&name);
                if drop {
                    if !close && !selfclose {
                        skip = Some((name, 1));
                    }
                    continue;
                }
                let attrs = attrs.into_iter().filter(|(n, _, _)| !is_editor(n) && !n.starts_with("xmlns:inkscape") && !n.starts_with("xmlns:sodipodi")).collect();
                kept.push(Tok::Tag { name, attrs, close, selfclose });
            }
            other => kept.push(other),
        }
    }
    // 还在用的命名空间前缀
    let mut used: Vec<String> = Vec::new();
    for t in &kept {
        if let Tok::Tag { name, attrs, .. } = t {
            for n in std::iter::once(name.as_str()).chain(attrs.iter().map(|(n, _, _)| n.as_str())) {
                if let Some((p, _)) = n.split_once(':') {
                    if p != "xmlns" && !used.iter().any(|u| u == p) {
                        used.push(p.to_string());
                    }
                }
            }
        }
    }
    // 第二遍：输出
    let mut out = String::with_capacity(src.len());
    let mut in_text = 0i32;
    for t in &kept {
        match t {
            Tok::Text(s) => {
                let indent_only = s.trim().is_empty() && s.contains('\n');
                if indent_only && in_text == 0 && !preserve_space {
                    continue;
                }
                out.push_str(s);
            }
            Tok::Raw(s) => out.push_str(s),
            Tok::Tag { name, attrs, close, selfclose } => {
                let local = name.rsplit(':').next().unwrap_or(name);
                if local == "text" {
                    if *close {
                        in_text -= 1;
                    } else if !*selfclose {
                        in_text += 1;
                    }
                }
                out.push('<');
                if *close {
                    out.push('/');
                }
                out.push_str(name);
                for (n, v, q) in attrs {
                    if let Some(p) = n.strip_prefix("xmlns:") {
                        if META_PREFIXES.contains(&p) && !used.iter().any(|u| u == p) {
                            continue;
                        }
                    }
                    let v = if matches!(n.as_str(), "d" | "points" | "transform") { round_numbers(v) } else { v.clone() };
                    out.push(' ');
                    out.push_str(n);
                    out.push('=');
                    out.push(*q);
                    out.push_str(&v);
                    out.push(*q);
                }
                if *selfclose {
                    out.push('/');
                }
                out.push('>');
            }
        }
    }
    let out = out.trim().to_string();
    if !out.contains("<svg") {
        return Err("优化后没有剩下 <svg> 内容，已放弃".into());
    }
    Ok(if out.len() < src.len() { out } else { src.to_string() })
}

fn ascii_stem(name: &str) -> String {
    let stem = std::path::Path::new(name).file_stem().and_then(|s| s.to_str()).unwrap_or("image");
    let s: String = stem.chars().map(|c| if c.is_ascii_alphanumeric() || c == '-' || c == '_' { c } else { '_' }).take(80).collect();
    if s.trim_matches('_').is_empty() { "image".into() } else { s }
}

/// POST /api/tools/svg-optimize（FormData: file）→ 直接回优化后的文件
pub fn handle(app: &tauri::AppHandle, args: &Value) -> Result<Value, String> {
    let files = args.get("__files").and_then(Value::as_array).cloned().unwrap_or_default();
    if files.is_empty() {
        return Err("请先选择一个 SVG 文件".into());
    }
    let id = crate::jobs::new_job_id_public();
    let saved = crate::jobs::save_request_uploads(app, &id, &files)?;
    let first = saved.first().ok_or("请先选择一个 SVG 文件")?;
    let path = first.get("path").and_then(Value::as_str).ok_or("上传的文件丢失了")?;
    let name = first.get("name").and_then(Value::as_str).unwrap_or("image.svg");
    let meta = std::fs::metadata(path).map_err(|e| format!("读不到文件：{e}"))?;
    if meta.len() > 50 * 1024 * 1024 {
        return Err("SVG 文件超过 50MB，太大了".into());
    }
    let bytes = std::fs::read(path).map_err(|e| format!("读不到文件：{e}"))?;
    let text = String::from_utf8(bytes).map_err(|_| "SVG 文件不是 UTF-8 文本，无法优化".to_string())?;
    let out = optimize(&text)?;
    Ok(json!({
        "__binary": {
            "data": crate::jobs::b64_encode_public(out.as_bytes()),
            "name": format!("{}-optimized.svg", ascii_stem(name)),
            "mime": "image/svg+xml",
            "kind": "file",
        }
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rounding() {
        assert_eq!(round_numbers("M10.123456,20.5 L-0.00001 3"), "M10.123,20.5 L-0 3");
        assert_eq!(round_numbers("5-0.00001"), "5-0");
        assert_eq!(round_numbers("1.00001.5"), "1.0.5");
        assert_eq!(round_numbers("1e-5 2.5E+3 3.14159"), "1e-5 2.5E+3 3.142");
        assert_eq!(round_numbers("matrix(0.707106781,0.707106781,-0.707106781,0.707106781,0,0)"), "matrix(0.707,0.707,-0.707,0.707,0,0)");
        assert_eq!(round_numbers("M.123456.5"), "M0.123.5");
    }

    #[test]
    fn inkscape_cleanup() {
        let src = r##"<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!-- Created with Inkscape -->
<svg xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:cc="http://creativecommons.org/ns#" xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://www.w3.org/2000/svg" xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" width="100" height="100" inkscape:version="1.0" sodipodi:docname="a.svg">
  <sodipodi:namedview id="base" pagecolor="#ffffff">
    <inkscape:grid type="xygrid"/>
  </sodipodi:namedview>
  <metadata id="m"><rdf:RDF><cc:Work rdf:about=""><dc:format>image/svg+xml</dc:format></cc:Work></rdf:RDF></metadata>
  <g inkscape:label="Layer 1" inkscape:groupmode="layer">
    <path d="M 10.123456,10.987654 L 90.5,90.5 Z" style="fill:#f00"/>
    <text x="1" y="2"><tspan>a</tspan>
      <tspan>b</tspan></text>
  </g>
</svg>
"##;
        let out = optimize(src).unwrap();
        assert!(!out.contains("inkscape") && !out.contains("sodipodi") && !out.contains("metadata") && !out.contains("rdf"), "{out}");
        assert!(out.starts_with("<svg xmlns=\"http://www.w3.org/2000/svg\""), "{out}");
        assert!(out.contains("d=\"M 10.123,10.988 L 90.5,90.5 Z\""));
        assert!(out.contains("<tspan>a</tspan>\n      <tspan>b</tspan>"), "text whitespace kept: {out}");
        assert!(out.len() < src.len());
    }

    #[test]
    fn keeps_used_namespace_and_cdata() {
        let src = "<svg xmlns=\"http://www.w3.org/2000/svg\" xmlns:xlink=\"http://www.w3.org/1999/xlink\">\n  <style><![CDATA[ a > b { fill: red } ]]></style>\n  <use xlink:href=\"#a\"/>\n</svg>";
        let out = optimize(src).unwrap();
        assert!(out.contains("xmlns:xlink") && out.contains("<![CDATA[ a > b { fill: red } ]]>"), "{out}");
    }

    #[test]
    fn rejects_non_svg() {
        assert!(optimize("<html></html>").is_err());
        assert!(optimize("<svg><g></svg").is_err());
    }
}
