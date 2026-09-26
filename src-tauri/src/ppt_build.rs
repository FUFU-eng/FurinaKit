//! 用大纲 JSON 生成可编辑 PPTX（原 Python 版 py_ppt_build.py 的 Rust 移植，不再依赖 Python）。
//!
//! 版式：封面 + 目录（可选，内容页多于 1 页时）+ 内容页（标题条 + 分级要点 + 备注）+ 结束页。
//! 所有文字都是普通文本框，打开后可直接编辑；母版 / 主题取自 python-pptx 默认模板（MIT）。

use serde_json::Value;
use std::path::Path;

const EMU_PER_INCH: f64 = 914_400.0;
const CN_FONT: &str = "微软雅黑";
const SLIDE_CX: i64 = 12_192_000;
const SLIDE_CY: i64 = 6_858_000;

const T_MASTER: &str = include_str!("ppt_template/slideMaster1.xml");
const T_LAYOUT: &str = include_str!("ppt_template/slideLayout1.xml");
const T_THEME1: &str = include_str!("ppt_template/theme1.xml");
const T_THEME2: &str = include_str!("ppt_template/theme2.xml");
const T_NOTES_MASTER: &str = include_str!("ppt_template/notesMaster1.xml");
const T_PRES_PROPS: &str = include_str!("ppt_template/presProps.xml");
const T_VIEW_PROPS: &str = include_str!("ppt_template/viewProps.xml");
const T_TABLE_STYLES: &str = include_str!("ppt_template/tableStyles.xml");

const NS: &str = r#"xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main""#;
const REL_NS: &str = "http://schemas.openxmlformats.org/package/2006/relationships";
const R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const XML_HEAD: &str = "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n";

struct Theme {
    primary: &'static str,
    dark: &'static str,
    text: &'static str,
}

fn theme(id: &str) -> Theme {
    match id {
        "fresh" => Theme { primary: "1B7F5A", dark: "14604A", text: "1F2937" },
        "warm" => Theme { primary: "C2410C", dark: "9A3412", text: "1F2937" },
        "dark" => Theme { primary: "5B21B6", dark: "3C1580", text: "1F2937" },
        _ => Theme { primary: "1F4E79", dark: "17375E", text: "1F2937" },
    }
}

fn emu(inches: f64) -> i64 {
    (inches * EMU_PER_INCH).round() as i64
}

/// XML 转义，并去掉 XML 1.0 不允许的控制字符
pub(crate) fn esc(s: &str) -> String {
    let mut o = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '&' => o.push_str("&amp;"),
            '<' => o.push_str("&lt;"),
            '>' => o.push_str("&gt;"),
            '"' => o.push_str("&quot;"),
            '\t' => o.push(' '),
            '\n' | '\r' => o.push(' '),
            c if (c as u32) < 0x20 || c == '\u{FFFE}' || c == '\u{FFFF}' => {}
            c => o.push(c),
        }
    }
    o
}

/// JSON 值转文字（与 Python 的 str() 行为接近）
fn val_text(v: Option<&Value>) -> String {
    match v {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Bool(b)) => if *b { "True".into() } else { "False".into() },
        Some(other) => other.to_string(),
    }
}

fn run(text: &str, size: u32, bold: bool, color: &str) -> String {
    format!(
        r#"<a:r><a:rPr lang="zh-CN" altLang="en-US" sz="{}" b="{}" dirty="0"><a:solidFill><a:srgbClr val="{}"/></a:solidFill><a:latin typeface="{f}"/><a:ea typeface="{f}"/></a:rPr><a:t>{}</a:t></a:r>"#,
        size * 100,
        if bold { 1 } else { 0 },
        color,
        esc(text),
        f = CN_FONT
    )
}

fn para(ppr: &str, runs: &str) -> String {
    format!("<a:p>{ppr}{runs}</a:p>")
}

fn spc_aft(pts: u32) -> String {
    format!(r#"<a:spcAft><a:spcPts val="{}"/></a:spcAft>"#, pts * 100)
}

struct Shapes {
    xml: String,
    next_id: u32,
}

impl Shapes {
    fn new() -> Self {
        Shapes { xml: String::new(), next_id: 2 }
    }

    fn rect(&mut self, x: f64, y: f64, cx: f64, cy: f64, color: &str) {
        let id = self.next_id;
        self.next_id += 1;
        self.xml.push_str(&format!(
            r#"<p:sp><p:nvSpPr><p:cNvPr id="{id}" name="Rectangle {n}"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="{}" y="{}"/><a:ext cx="{}" cy="{}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="{color}"/></a:solidFill><a:ln><a:noFill/></a:ln></p:spPr><p:txBody><a:bodyPr rtlCol="0" anchor="ctr"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:endParaRPr lang="zh-CN" altLang="en-US"/></a:p></p:txBody></p:sp>"#,
            emu(x),
            emu(y),
            emu(cx),
            emu(cy),
            n = id - 1
        ));
    }

    fn textbox(&mut self, x: f64, y: f64, cx: f64, cy: f64, wrap: bool, paras: &[String]) {
        let id = self.next_id;
        self.next_id += 1;
        let body = if paras.is_empty() { "<a:p><a:endParaRPr lang=\"zh-CN\"/></a:p>".to_string() } else { paras.concat() };
        self.xml.push_str(&format!(
            r#"<p:sp><p:nvSpPr><p:cNvPr id="{id}" name="TextBox {n}"/><p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr><p:spPr><a:xfrm><a:off x="{}" y="{}"/><a:ext cx="{}" cy="{}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/></p:spPr><p:txBody><a:bodyPr wrap="{}" rtlCol="0"><a:spAutoFit/></a:bodyPr><a:lstStyle/>{body}</p:txBody></p:sp>"#,
            emu(x),
            emu(y),
            emu(cx),
            emu(cy),
            if wrap { "square" } else { "none" },
            n = id - 1
        ));
    }
}

fn slide_xml(bg: &str, shapes: &Shapes) -> String {
    format!(
        r#"{XML_HEAD}<p:sld {NS}><p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="{bg}"/></a:solidFill><a:effectLst/></p:bgPr></p:bg><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>{}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>"#,
        shapes.xml
    )
}

fn notes_xml(text: &str) -> String {
    let paras: String = text
        .lines()
        .map(|l| {
            if l.is_empty() {
                "<a:p><a:endParaRPr lang=\"zh-CN\"/></a:p>".to_string()
            } else {
                format!("<a:p><a:r><a:rPr lang=\"zh-CN\" altLang=\"en-US\" dirty=\"0\"/><a:t>{}</a:t></a:r></a:p>", esc(l))
            }
        })
        .collect();
    format!(
        r#"{XML_HEAD}<p:notes {NS}><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:sp><p:nvSpPr><p:cNvPr id="2" name="Slide Image Placeholder 1"/><p:cNvSpPr><a:spLocks noGrp="1" noRot="1" noChangeAspect="1"/></p:cNvSpPr><p:nvPr><p:ph type="sldImg" idx="2"/></p:nvPr></p:nvSpPr><p:spPr/></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Notes Placeholder 2"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" sz="quarter" idx="3"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>{paras}</p:txBody></p:sp></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:notes>"#
    )
}

fn rels(items: &[(&str, &str, String)]) -> String {
    let mut s = format!(r#"{XML_HEAD}<Relationships xmlns="{REL_NS}">"#);
    for (id, ty, target) in items {
        s.push_str(&format!(r#"<Relationship Id="{id}" Type="{R}/{ty}" Target="{}"/>"#, esc(target)));
    }
    s.push_str("</Relationships>");
    s
}

fn title_bar(sh: &mut Shapes, t: &Theme, title: &str, subtitle: &str) {
    sh.rect(0.6, 0.55, 0.12, 0.62, t.primary);
    let mut paras = vec![para("", &run(title, 28, true, t.dark))];
    if !subtitle.is_empty() {
        paras.push(para("", &run(subtitle, 13, false, "6B7280")));
    }
    sh.textbox(0.9, 0.45, 11.8, 0.9, true, &paras);
}

struct Built {
    xml: String,
    notes: Option<String>,
}

/// 生成 PPTX 字节；返回 (字节, 总页数)
pub fn build_bytes(outline: &Value, theme_id: &str, with_toc: bool) -> Result<(Vec<u8>, usize), String> {
    let t = theme(theme_id);
    let items: Vec<&Value> = match outline.get("slides") {
        Some(Value::Array(a)) if !a.is_empty() => a.iter().collect(),
        _ => return Err("大纲里没有任何内容页 / The outline has no content slides".into()),
    };
    let title_text = {
        let s = val_text(outline.get("title"));
        if s.trim().is_empty() { "演示文稿".to_string() } else { s }
    };
    let subtitle_text = val_text(outline.get("subtitle"));

    let slide_title = |s: &Value| -> String {
        match s {
            Value::Object(_) => val_text(s.get("title")),
            Value::String(x) => x.clone(),
            _ => String::new(),
        }
    };

    let mut built: Vec<Built> = Vec::new();

    // 封面
    let mut sh = Shapes::new();
    sh.textbox(1.0, 2.5, 11.3, 1.6, true, &[para("", &run(&title_text, 44, true, "FFFFFF"))]);
    if !subtitle_text.is_empty() {
        sh.textbox(1.05, 4.15, 11.0, 0.8, true, &[para("", &run(&subtitle_text, 18, false, "E5E7EB"))]);
    }
    built.push(Built { xml: slide_xml(t.dark, &sh), notes: None });

    // 目录
    if with_toc && items.len() > 1 {
        let mut sh = Shapes::new();
        title_bar(&mut sh, &t, "目录", &format!("共 {} 个部分", items.len()));
        let paras: Vec<String> = items
            .iter()
            .enumerate()
            .map(|(i, s)| para(&format!("<a:pPr>{}</a:pPr>", spc_aft(10)), &run(&format!("{:02}   {}", i + 1, slide_title(s)), 18, false, t.text)))
            .collect();
        sh.textbox(1.1, 1.7, 11.0, 5.2, true, &paras);
        built.push(Built { xml: slide_xml("FFFFFF", &sh), notes: None });
    }

    // 内容页
    for s in &items {
        let mut sh = Shapes::new();
        title_bar(&mut sh, &t, &slide_title(s), "");
        let mut points: Vec<String> = match s.get("points") {
            Some(Value::Array(a)) => a.iter().map(|v| val_text(Some(v))).collect(),
            Some(Value::String(x)) if !x.is_empty() => vec![x.clone()],
            _ => Vec::new(),
        };
        if points.is_empty() {
            let c = val_text(s.get("content"));
            if !c.is_empty() {
                points.push(c);
            }
        }
        let paras: Vec<String> = points
            .iter()
            .map(|pt| {
                let trimmed = pt.trim_start();
                let sub = trimmed.starts_with(['-', '•', '·']);
                if sub {
                    let text = trimmed.trim_start_matches(['-', '•', '·']).trim();
                    para(&format!("<a:pPr lvl=\"1\">{}</a:pPr>", spc_aft(9)), &run(&format!("– {text}"), 16, false, "4B5563"))
                } else {
                    para(&format!("<a:pPr>{}</a:pPr>", spc_aft(9)), &run(&format!("• {pt}"), 18, false, t.text))
                }
            })
            .collect();
        sh.textbox(1.05, 1.65, 11.3, 5.0, true, &paras);
        let notes = val_text(s.get("notes")).trim().to_string();
        built.push(Built { xml: slide_xml("FFFFFF", &sh), notes: if notes.is_empty() { None } else { Some(notes) } });
    }

    // 结束页
    let mut sh = Shapes::new();
    sh.textbox(1.0, 3.2, 11.3, 1.2, false, &[para("<a:pPr algn=\"ctr\"/>", &run("谢谢观看", 36, true, "FFFFFF"))]);
    built.push(Built { xml: slide_xml(t.dark, &sh), notes: None });

    // ---- 打包 ----
    let n = built.len();
    let mut z = crate::mini_zip::ZipWriter::new();
    let ct_slide = "application/vnd.openxmlformats-officedocument.presentationml.slide+xml";
    let ct_notes = "application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml";
    let mut ct = format!(
        r#"{XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/notesMasters/notesMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.notesMaster+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/theme/theme2.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/presProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presProps+xml"/><Override PartName="/ppt/viewProps.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/><Override PartName="/ppt/tableStyles.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>"#
    );
    let mut pres_rels: Vec<(String, &str, String)> = vec![
        ("rId1".into(), "slideMaster", "slideMasters/slideMaster1.xml".into()),
        ("rId2".into(), "notesMaster", "notesMasters/notesMaster1.xml".into()),
        ("rId3".into(), "presProps", "presProps.xml".into()),
        ("rId4".into(), "viewProps", "viewProps.xml".into()),
        ("rId5".into(), "theme", "theme/theme1.xml".into()),
        ("rId6".into(), "tableStyles", "tableStyles.xml".into()),
    ];
    let mut sld_ids = String::new();
    let mut notes_no = 0usize;
    for (i, b) in built.iter().enumerate() {
        let k = i + 1;
        let rid = format!("rId{}", 6 + k);
        sld_ids.push_str(&format!(r#"<p:sldId id="{}" r:id="{rid}"/>"#, 255 + k));
        pres_rels.push((rid, "slide", format!("slides/slide{k}.xml")));
        ct.push_str(&format!(r#"<Override PartName="/ppt/slides/slide{k}.xml" ContentType="{ct_slide}"/>"#));
        z.add(&format!("ppt/slides/slide{k}.xml"), b.xml.as_bytes())?;
        let mut srels = vec![("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml".to_string())];
        if let Some(notes) = &b.notes {
            notes_no += 1;
            srels.push(("rId2", "notesSlide", format!("../notesSlides/notesSlide{notes_no}.xml")));
            ct.push_str(&format!(r#"<Override PartName="/ppt/notesSlides/notesSlide{notes_no}.xml" ContentType="{ct_notes}"/>"#));
            z.add(&format!("ppt/notesSlides/notesSlide{notes_no}.xml"), notes_xml(notes).as_bytes())?;
            z.add(
                &format!("ppt/notesSlides/_rels/notesSlide{notes_no}.xml.rels"),
                rels(&[
                    ("rId1", "notesMaster", "../notesMasters/notesMaster1.xml".into()),
                    ("rId2", "slide", format!("../slides/slide{k}.xml")),
                ])
                .as_bytes(),
            )?;
        }
        z.add(&format!("ppt/slides/_rels/slide{k}.xml.rels"), rels(&srels).as_bytes())?;
    }
    ct.push_str("</Types>");

    let pres = format!(
        r#"{XML_HEAD}<p:presentation {NS} saveSubsetFonts="1"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:notesMasterIdLst><p:notesMasterId r:id="rId2"/></p:notesMasterIdLst><p:sldIdLst>{sld_ids}</p:sldIdLst><p:sldSz cx="{SLIDE_CX}" cy="{SLIDE_CY}"/><p:notesSz cx="6858000" cy="9144000"/><p:defaultTextStyle><a:defPPr><a:defRPr lang="zh-CN"/></a:defPPr></p:defaultTextStyle></p:presentation>"#
    );
    let pres_rels_ref: Vec<(&str, &str, String)> = pres_rels.iter().map(|(a, b, c)| (a.as_str(), *b, c.clone())).collect();

    z.add("[Content_Types].xml", ct.as_bytes())?;
    z.add(
        "_rels/.rels",
        rels(&[
            ("rId1", "officeDocument", "ppt/presentation.xml".into()),
            ("rId2", "extended-properties", "docProps/app.xml".into()),
        ])
        .replace("</Relationships>", r#"<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>"#)
        .as_bytes(),
    )?;
    z.add("ppt/presentation.xml", pres.as_bytes())?;
    z.add("ppt/_rels/presentation.xml.rels", rels(&pres_rels_ref).as_bytes())?;
    z.add("ppt/slideMasters/slideMaster1.xml", T_MASTER.as_bytes())?;
    z.add(
        "ppt/slideMasters/_rels/slideMaster1.xml.rels",
        rels(&[("rId1", "slideLayout", "../slideLayouts/slideLayout1.xml".into()), ("rId2", "theme", "../theme/theme1.xml".into())]).as_bytes(),
    )?;
    z.add("ppt/slideLayouts/slideLayout1.xml", T_LAYOUT.as_bytes())?;
    z.add("ppt/slideLayouts/_rels/slideLayout1.xml.rels", rels(&[("rId1", "slideMaster", "../slideMasters/slideMaster1.xml".into())]).as_bytes())?;
    z.add("ppt/notesMasters/notesMaster1.xml", T_NOTES_MASTER.as_bytes())?;
    z.add("ppt/notesMasters/_rels/notesMaster1.xml.rels", rels(&[("rId1", "theme", "../theme/theme2.xml".into())]).as_bytes())?;
    z.add("ppt/theme/theme1.xml", T_THEME1.as_bytes())?;
    z.add("ppt/theme/theme2.xml", T_THEME2.as_bytes())?;
    z.add("ppt/presProps.xml", T_PRES_PROPS.as_bytes())?;
    z.add("ppt/viewProps.xml", T_VIEW_PROPS.as_bytes())?;
    z.add("ppt/tableStyles.xml", T_TABLE_STYLES.as_bytes())?;
    z.add(
        "docProps/core.xml",
        format!(
            r#"{XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>{}</dc:title><dc:creator>FurinaKit</dc:creator></cp:coreProperties>"#,
            esc(&title_text)
        )
        .as_bytes(),
    )?;
    z.add(
        "docProps/app.xml",
        format!(
            r#"{XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>FurinaKit</Application><PresentationFormat>宽屏</PresentationFormat><Slides>{n}</Slides><Notes>{notes_no}</Notes></Properties>"#
        )
        .as_bytes(),
    )?;
    Ok((z.finish(), n))
}

/// 大纲为 JSON 字符串；写到 out，返回总页数
pub fn build_from_json(outline_json: &str, out: &Path, theme_id: &str, with_toc: bool) -> Result<usize, String> {
    if outline_json.trim().is_empty() {
        return Err("请先生成或填写大纲 / Outline is empty".into());
    }
    let outline: Value = serde_json::from_str(outline_json).map_err(|e| format!("大纲数据不是合法 JSON：{e}"))?;
    if !outline.is_object() {
        return Err("大纲数据格式不对：应为 JSON 对象".into());
    }
    let (bytes, n) = build_bytes(&outline, theme_id, with_toc)?;
    if let Some(parent) = out.parent() {
        std::fs::create_dir_all(parent).map_err(|e| format!("创建输出目录失败：{e}"))?;
    }
    std::fs::write(out, bytes).map_err(|e| format!("写入 PPT 失败：{e}"))?;
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds() {
        let v: Value = serde_json::from_str(r#"{"title":"测试 & <标题>","subtitle":"副","slides":[{"title":"一","points":["a","- b"],"notes":"备注\n第二行"},{"title":"二","content":"c"}]}"#).unwrap();
        let (b, n) = build_bytes(&v, "fresh", true).unwrap();
        assert_eq!(n, 5);
        std::fs::write(std::env::temp_dir().join("fk_ppt_test.pptx"), b).unwrap();
        let v: Value = serde_json::from_str(r#"{"slides":[]}"#).unwrap();
        assert!(build_bytes(&v, "x", true).is_err());
    }
}
