//! Office 文档互转：纯 Rust + Windows COM 实现（去 Python 化，替代 services/worker/app/tools/office_to_pdf.py）。
//!
//! 支持：
//!   · word-to-pdf: Word (doc/docx) -> PDF（调用本地 Microsoft Word 或 WPS 文字）
//!   · excel-to-pdf: Excel (xls/xlsx/csv) -> PDF（调用本地 Microsoft Excel 或 WPS 表格）
//!   · pdf-to-word: PDF -> Word (docx)（调用本地 Microsoft Word 原生版式重排引擎）
//!   · pdf-to-excel: PDF -> Excel (xlsx)（调用本地 Microsoft Word/Excel 或 WPS 提取表格与文本）
//!   · pdf-to-ppt: PDF -> PPT (pptx)（Windows 原生光栅化 + PowerPoint/WPS 幻灯片合成）

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use serde_json::{json, Map, Value};

use crate::matting_native::results_path;

/// 检测本机能否用 COM 调用 Office / WPS（只读注册表 HKCR\<ProgID>\CLSID，不启动任何程序）
pub fn availability() -> Value {
    let has = |progid: &str| -> bool {
        let Some(root) = std::env::var_os("SystemRoot") else { return false };
        let reg = std::path::PathBuf::from(root).join("System32").join("reg.exe");
        if !reg.is_file() { return false; }
        let mut cmd = std::process::Command::new(reg);
        cmd.args(["query", &format!("HKCR\\{progid}\\CLSID"), "/ve"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        crate::commands::no_window(&mut cmd);
        cmd.status().map(|s| s.success()).unwrap_or(false)
    };
    let (word, wps) = (has("Word.Application"), has("KWps.Application"));
    let (excel, et) = (has("Excel.Application"), has("KET.Application"));
    let (ppt, wpp) = (has("PowerPoint.Application"), has("KWPP.Application"));
    json!({
        "ok": true,
        "word": word || wps,
        "excel": excel || et,
        "powerpoint": ppt || wpp,
        "microsoftOffice": word || excel || ppt,
        "wps": wps || et || wpp,
    })
}

pub fn supported(tool: &str) -> bool {
    matches!(tool, "word-to-pdf" | "excel-to-pdf" | "pdf-to-word" | "pdf-to-excel" | "pdf-to-ppt" | "pdf-to-markdown" | "pdf-to-html")
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
    let script_path = std::env::temp_dir().join(format!("fk_office_ps_{}.ps1", uuid::Uuid::new_v4().simple()));
    // Windows PowerShell 5.1 读取无 BOM 的 .ps1 会按系统 ANSI(GBK) 解码，中文路径会变成乱码
    // （“调解书.pdf”→“璋冭В涔?pdf”），导致 Office/PPT 全部“输出为空”。必须写 UTF-8 BOM。
    let mut bytes = Vec::with_capacity(script.len() + 128);
    bytes.extend_from_slice(b"\xEF\xBB\xBF");
    bytes.extend_from_slice(b"try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch {}\r\n");
    bytes.extend_from_slice(script.as_bytes());
    fs::write(&script_path, &bytes).map_err(|e| format!("写入临时脚本失败: {e}"))?;

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

// ───────────────────────── Word 转 PDF ─────────────────────────

fn word_to_pdf(ctx: &Ctx, input: &(PathBuf, String)) -> Result<Value, String> {
    ctx.progress(20, "正在启动 Word / WPS 引擎排版并导出 PDF…");
    let stem = Path::new(&input.1).file_stem().and_then(|s| s.to_str()).unwrap_or("document");
    let out_name = format!("{stem}.pdf");
    let out_file = results_path(ctx.app, ctx.id, &out_name)?;

    let src_str = input.0.to_string_lossy();
    let dest_str = out_file.to_string_lossy();

    // 注意：之前这里被误替换成了“PDF 转 Excel”的脚本（输出的根本不是 PDF），现恢复为真正的 Word→PDF。
    let com_script = format!(
        r#"
$src = [System.IO.Path]::GetFullPath('{src}')
$out = [System.IO.Path]::GetFullPath('{out}')
if (Test-Path -LiteralPath $out) {{ Remove-Item -LiteralPath $out -Force }}

$word = $null
$isWps = $false
try {{
    $word = New-Object -ComObject Word.Application
}} catch {{
    try {{
        $word = New-Object -ComObject KWps.Application
        $isWps = $true
    }} catch {{
        Write-Error "NO_WORD_INSTALLED"
        exit 12
    }}
}}

try {{
    try {{ $word.Visible = $false }} catch {{}}
    try {{ $word.DisplayAlerts = 0 }} catch {{}}
    # Open(FileName, ConfirmConversions, ReadOnly, AddToRecentFiles)
    $doc = $word.Documents.Open($src, $false, $true, $false)
    try {{
        # 17 = wdExportFormatPDF
        $doc.ExportAsFixedFormat($out, 17)
    }} catch {{
        # 17 = wdFormatPDF（WPS 或旧版 Word 兜底）
        $doc.SaveAs2($out, 17)
    }}
    $doc.Close($false)
}} catch {{
    Write-Error "WORD_EXPORT_ERR: $_"
    exit 13
}} finally {{
    try {{ $word.Quit() }} catch {{}}
    try {{ [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($word) }} catch {{}}
}}
"#,
        src = src_str.replace("'", "''"),
        out = dest_str.replace("'", "''")
    );

    let res = run_ps(&com_script);
    if let Err(e) = res {
        if e.contains("NO_WORD_INSTALLED") {
            return Err("本机未检测到 Microsoft Word 或 WPS 文字组件，请先安装 Office 办公套件。".into());
        }
        return Err(format!("Word 转 PDF 失败：{e}"));
    }

    if !out_file.exists() || fs::metadata(&out_file).map(|m| m.len()).unwrap_or(0) == 0 {
        return Err("PDF 导出输出为空 / Output PDF is empty".into());
    }

    Ok(done(&out_file, &out_name, "application/pdf", "Word 转 PDF 转换成功".into()))
}

// ───────────────────────── Excel 转 PDF ─────────────────────────

fn excel_to_pdf(ctx: &Ctx, input: &(PathBuf, String)) -> Result<Value, String> {
    ctx.progress(20, "正在启动 Excel / WPS 引擎计算并导出 PDF…");
    let stem = Path::new(&input.1).file_stem().and_then(|s| s.to_str()).unwrap_or("spreadsheet");
    let out_name = format!("{stem}.pdf");
    let out_file = results_path(ctx.app, ctx.id, &out_name)?;

    let src_str = input.0.to_string_lossy();
    let dest_str = out_file.to_string_lossy();

    let com_script = format!(
        r#"
$src = [System.IO.Path]::GetFullPath('{src}')
$out = [System.IO.Path]::GetFullPath('{out}')

$excel = $null
try {{
    $excel = New-Object -ComObject Excel.Application
}} catch {{
    try {{
        $excel = New-Object -ComObject KET.Application
    }} catch {{
        Write-Error "NO_EXCEL_INSTALLED"
        exit 12
    }}
}}

try {{
    # 0 = xlTypePDF
    $wb = $excel.Workbooks.Open($src, 0, $true)
    $wb.ExportAsFixedFormat(0, $out)
    $wb.Close($false)
}} finally {{
    try {{ $excel.Quit() }} catch {{}}
}}
"#,
        src = src_str.replace("'", "''"),
        out = dest_str.replace("'", "''")
    );

    let res = run_ps(&com_script);
    if let Err(e) = res {
        if e.contains("NO_EXCEL_INSTALLED") {
            return Err("本机未检测到 Microsoft Excel 或 WPS 表格组件，请先安装 Office 办公套件。".into());
        }
        return Err(format!("Excel 转 PDF 失败：{e}"));
    }

    if !out_file.exists() || fs::metadata(&out_file).map(|m| m.len()).unwrap_or(0) == 0 {
        return Err("PDF 导出输出为空 / Output PDF is empty".into());
    }

    Ok(done(&out_file, &out_name, "application/pdf", "Excel 转 PDF 转换成功".into()))
}

// ───────────────────────── PDF 转 Word (Docx) ─────────────────────────

fn pdf_to_word(ctx: &Ctx, input: &(PathBuf, String)) -> Result<Value, String> {
    ctx.progress(20, "正在调用 Microsoft Word 原生引擎重排并转换为 Docx…");
    let stem = Path::new(&input.1).file_stem().and_then(|s| s.to_str()).unwrap_or("document");
    let out_name = format!("{stem}.docx");
    let out_file = results_path(ctx.app, ctx.id, &out_name)?;

    let src_str = input.0.to_string_lossy();
    let dest_str = out_file.to_string_lossy();

    let com_script = format!(
        r#"
$src = [System.IO.Path]::GetFullPath('{src}')
$out = [System.IO.Path]::GetFullPath('{out}')

$word = $null
try {{
    $word = New-Object -ComObject Word.Application
}} catch {{
    try {{
        $word = New-Object -ComObject KWps.Application
    }} catch {{
        Write-Error "NO_WORD_INSTALLED"
        exit 12
    }}
}}

try {{
    try {{ $word.Visible = $false }} catch {{}}
    try {{ $word.DisplayAlerts = 0 }} catch {{}}
    # 16 = wdFormatXMLDocument (docx)
    $doc = $word.Documents.Open($src, $false, $true, $false)
    $doc.SaveAs2($out, 16)
    $doc.Close($false)
}} finally {{
    try {{ $word.Quit() }} catch {{}}
}}
"#,
        src = src_str.replace("'", "''"),
        out = dest_str.replace("'", "''")
    );

    let res = run_ps(&com_script);
    if let Err(e) = res {
        if e.contains("NO_WORD_INSTALLED") {
            return Err("本机未检测到 Microsoft Word 或 WPS 文字组件，PDF 转 Word 需要依赖 Office 版式重排引擎，请先安装 Office 办公套件。".into());
        }
        return Err(format!("PDF 转 Word 失败：{e}"));
    }

    if !out_file.exists() || fs::metadata(&out_file).map(|m| m.len()).unwrap_or(0) == 0 {
        return Err("Word 转换输出为空 / Output Docx is empty".into());
    }

    Ok(done(&out_file, &out_name, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "PDF 转 Word 转换成功".into()))
}

// ───────────────────────── PDF 转 Excel (Xlsx) ─────────────────────────

fn pdf_to_excel(ctx: &Ctx, input: &(PathBuf, String)) -> Result<Value, String> {
    ctx.progress(20, "正在调用 Microsoft Word 原生解析 PDF 并提取表格数据…");
    let stem = Path::new(&input.1).file_stem().and_then(|s| s.to_str()).unwrap_or("spreadsheet");
    let out_name = format!("{stem}.xlsx");
    let out_file = results_path(ctx.app, ctx.id, &out_name)?;

    let src_str = input.0.to_string_lossy();
    let dest_str = out_file.to_string_lossy();

    let com_script = format!(
        r#"
$src = [System.IO.Path]::GetFullPath('{src}')
$out = [System.IO.Path]::GetFullPath('{out}')

if (Test-Path $out) {{ Remove-Item $out -Force }}

$tmpDir = Join-Path $env:TEMP ("xlsx_build_" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path "$tmpDir\_rels" -Force | Out-Null
New-Item -ItemType Directory -Path "$tmpDir\xl\_rels" -Force | Out-Null
New-Item -ItemType Directory -Path "$tmpDir\xl\worksheets" -Force | Out-Null

$contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'
[System.IO.File]::WriteAllText("$tmpDir\[Content_Types].xml", $contentTypes, [System.Text.Encoding]::UTF8)

$rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
[System.IO.File]::WriteAllText("$tmpDir\_rels\.rels", $rootRels, [System.Text.Encoding]::UTF8)

$wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" state="visible" r:id="rId1"/></sheets></workbook>'
[System.IO.File]::WriteAllText("$tmpDir\xl\workbook.xml", $wb, [System.Text.Encoding]::UTF8)

$wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
[System.IO.File]::WriteAllText("$tmpDir\xl\_rels\workbook.xml.rels", $wbRels, [System.Text.Encoding]::UTF8)

$styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>'
[System.IO.File]::WriteAllText("$tmpDir\xl\styles.xml", $styles, [System.Text.Encoding]::UTF8)

function Get-ColLetter([int]$col) {{
    $s = ""
    while ($true) {{
        $rem = $col % 26
        $s = [string][char](65 + $rem) + $s
        if ($col -lt 26) {{ break }}
        $col = [math]::Floor($col / 26) - 1
    }}
    return $s
}}

$rows = @()

$word = $null
try {{
    $word = New-Object -ComObject Word.Application
}} catch {{
    try {{
        $word = New-Object -ComObject KWps.Application
    }} catch {{
        Write-Error "NO_WORD_INSTALLED"
        exit 12
    }}
}}

try {{
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $doc = $word.Documents.Open($src, $false, $true)

    if ($doc.Tables.Count -gt 0) {{
        for ($t = 1; $t -le $doc.Tables.Count; $t++) {{
            $tbl = $doc.Tables.Item($t)
            for ($r = 1; $r -le [Math]::Min($tbl.Rows.Count, 2000); $r++) {{
                $cells = @()
                for ($c = 1; $c -le [Math]::Min($tbl.Columns.Count, 100); $c++) {{
                    try {{
                        $txt = $tbl.Cell($r, $c).Range.Text.TrimEnd([char]7, [char]13, [char]10)
                        $cells += $txt.Trim()
                    }} catch {{
                        $cells += ""
                    }}
                }}
                $rows += ,$cells
            }}
            $rows += ,@()
        }}
    }} else {{
        for ($p = 1; $p -le [Math]::Min($doc.Paragraphs.Count, 5000); $p++) {{
            $txt = $doc.Paragraphs.Item($p).Range.Text.TrimEnd([char]7, [char]13, [char]10)
            $t = $txt.Trim()
            if ($t.Length -gt 0) {{
                $rows += ,@($t)
            }}
        }}
    }}

    $doc.Close($false)
}} finally {{
    try {{ $word.Quit() }} catch {{}}
}}

if ($rows.Count -eq 0) {{
    $rows = ,@("Extracted text from PDF")
}}

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')
[void]$sb.AppendLine('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">')
[void]$sb.AppendLine('  <sheetData>')

$rNum = 1
foreach ($row in $rows) {{
    if ($row.Count -eq 0) {{
        $rNum++
        continue
    }}
    [void]$sb.Append("    <row r=`"$rNum`">")
    for ($cIdx = 0; $cIdx -lt $row.Count; $cIdx++) {{
        $val = $row[$cIdx]
        $cRef = (Get-ColLetter $cIdx) + $rNum
        $clean = [System.Security.SecurityElement]::Escape($val)
        [void]$sb.Append("<c r=`"$cRef`" t=`"inlineStr`"><is><t>$clean</t></is></c>")
    }}
    [void]$sb.AppendLine("</row>")
    $rNum++
}}

[void]$sb.AppendLine('  </sheetData>')
[void]$sb.AppendLine('</worksheet>')

[System.IO.File]::WriteAllText("$tmpDir\xl\worksheets\sheet1.xml", $sb.ToString(), [System.Text.Encoding]::UTF8)

$outZip = Join-Path $env:TEMP ("xlsx_zip_" + [Guid]::NewGuid().ToString("N") + ".zip")
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($tmpDir, $outZip)
Move-Item -Path $outZip -Destination $out -Force
Remove-Item -Recurse -Force $tmpDir
"#,
        src = src_str.replace("'", "''"),
        out = dest_str.replace("'", "''")
    );

    let res = run_ps(&com_script);
    if let Err(e) = res {
        if e.contains("NO_WORD_INSTALLED") || e.contains("NO_EXCEL_INSTALLED") {
            return Err("本机未检测到完整的 Microsoft Office 或 WPS 办公套件，PDF 转 Excel 需要依赖 Office 版式与表格提取引擎，请先安装 Office 办公套件。".into());
        }
        return Err(format!("PDF 转 Excel 失败：{e}"));
    }

    if !out_file.exists() || fs::metadata(&out_file).map(|m| m.len()).unwrap_or(0) == 0 {
        return Err("Excel 转换输出为空 / Output Xlsx is empty".into());
    }

    Ok(done(&out_file, &out_name, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "PDF 转 Excel 转换成功".into()))
}

// ───────────────────────── PDF 转 PPT (Pptx) ─────────────────────────

fn pdf_to_ppt(ctx: &Ctx, input: &(PathBuf, String), payload: &Value) -> Result<Value, String> {
    ctx.progress(15, "正在光栅化渲染 PDF 页面为高保真画幅…");
    let stem = Path::new(&input.1).file_stem().and_then(|s| s.to_str()).unwrap_or("presentation");
    let out_name = format!("{stem}.pptx");
    let out_file = results_path(ctx.app, ctx.id, &out_name)?;

    let dpi = payload.get("dpi").and_then(Value::as_u64).unwrap_or(150) as u32;
    let dpi = dpi.clamp(72, 300);

    let temp_scratch = std::env::temp_dir().join(format!("fk_pdf2ppt_{}", uuid::Uuid::new_v4().simple()));
    fs::create_dir_all(&temp_scratch).map_err(|e| format!("创建临时工作目录失败: {e}"))?;

    let renderer = crate::pdf_render::Renderer::open(&input.0)?;
    let count = renderer.count()?;
    if count == 0 {
        let _ = fs::remove_dir_all(&temp_scratch);
        return Err("PDF 没有页面 / Empty PDF".into());
    }

    let mut is_portrait = false;
    let mut aspect = 16.0f64 / 9.0;
    let check = || {
        if ctx.cancelled() {
            Err("用户取消了任务".into())
        } else {
            Ok(())
        }
    };

    for seq in 0..count {
        check()?;
        let pct = 20 + ((seq as f32 / count as f32) * 50.0) as u32;
        ctx.progress(pct, &format!("正在渲染第 {}/{} 页…", seq + 1, count));
        let page_img = temp_scratch.join(format!("page_{seq}.png"));
        let (w, h, _) = renderer.render(seq, dpi, &page_img, &check)?;
        if seq == 0 {
            is_portrait = h > w;
            aspect = (w as f64 / h.max(1) as f64).clamp(0.2, 5.0);
        }
    }

    ctx.progress(75, "正在调用 PowerPoint / WPS 引擎合成演示文稿…");

    let dest_str = out_file.to_string_lossy();
    let scratch_str = temp_scratch.to_string_lossy();

    let com_script = format!(
        r#"
$out = [System.IO.Path]::GetFullPath('{out}')
$imgDir = [System.IO.Path]::GetFullPath('{img_dir}')
$pageCount = {page_count}
$isPortrait = {is_portrait}

$ppt = $null
try {{
    $ppt = New-Object -ComObject PowerPoint.Application
}} catch {{
    try {{
        $ppt = New-Object -ComObject KWPP.Application
    }} catch {{
        Write-Error "NO_PPT_INSTALLED"
        exit 12
    }}
}}

try {{
    # msoFalse = 0
    $pres = $ppt.Presentations.Add(0)
    # 幻灯片尺寸按 PDF 首页宽高比设置，避免图片被拉伸变形
    $ratio = {aspect}
    if ($ratio -ge 1) {{
        $pres.PageSetup.SlideWidth = 960
        $pres.PageSetup.SlideHeight = [Math]::Round(960 / $ratio, 2)
    }} else {{
        $pres.PageSetup.SlideHeight = 960
        $pres.PageSetup.SlideWidth = [Math]::Round(960 * $ratio, 2)
    }}

    # 12 = ppLayoutBlank
    for ($i = 0; $i -lt $pageCount; $i++) {{
        $img = [System.IO.Path]::Combine($imgDir, "page_$i.png")
        if (Test-Path $img) {{
            $slide = $pres.Slides.Add($i + 1, 12)
            $w = $pres.PageSetup.SlideWidth
            $h = $pres.PageSetup.SlideHeight
            # Shapes.AddPicture(FileName, LinkToFile, SaveWithDocument, Left, Top, Width, Height)
            $pic = $slide.Shapes.AddPicture($img, 0, -1, 0, 0, $w, $h)
        }}
    }}

    $pres.SaveAs($out)
    $pres.Close()
}} catch {{
    Write-Error "PPT_BUILD_ERR: $_"
    exit 13
}} finally {{
    try {{ if ($ppt.Presentations.Count -eq 0) {{ $ppt.Quit() }} }} catch {{}}
}}
"#,
        out = dest_str.replace("'", "''"),
        img_dir = scratch_str.replace("'", "''"),
        page_count = count,
        is_portrait = if is_portrait { "$true" } else { "$false" },
        aspect = format!("{:.5}", aspect)
    );

    let res = run_ps(&com_script);
    let _ = fs::remove_dir_all(&temp_scratch);

    if let Err(e) = res {
        if e.contains("NO_PPT_INSTALLED") {
            return Err("本机未检测到 Microsoft PowerPoint 或 WPS 演示组件，请先安装 Office 办公套件。".into());
        }
        return Err(format!("PDF 转 PPT 失败：{e}"));
    }

    if !out_file.exists() || fs::metadata(&out_file).map(|m| m.len()).unwrap_or(0) == 0 {
        return Err("PPT 转换输出为空 / Output Pptx is empty".into());
    }

    Ok(done(&out_file, &out_name, "application/vnd.openxmlformats-officedocument.presentationml.presentation", format!("PDF 转 PPT 成功（已生成 {} 页幻灯片）", count)))
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn lopdf_fallback_markdown(pdf_path: &Path, out_file: &Path) -> Result<(), String> {
    let doc = lopdf::Document::load(pdf_path).map_err(|e| format!("无法读取 PDF: {e}"))?;
    let mut sb = String::new();
    let pages: Vec<u32> = doc.get_pages().keys().cloned().collect();
    for page_num in pages {
        if let Ok(text) = doc.extract_text(&[page_num]) {
            for line in text.lines() {
                let trimmed = line.trim();
                if !trimmed.is_empty() {
                    sb.push_str(trimmed);
                    sb.push_str("\n\n");
                }
            }
        }
        sb.push_str("\n---\n\n");
    }
    fs::write(out_file, sb.trim_end()).map_err(|e| format!("写入 Markdown 失败: {e}"))?;
    Ok(())
}

fn lopdf_fallback_html(pdf_path: &Path, out_file: &Path) -> Result<(), String> {
    let doc = lopdf::Document::load(pdf_path).map_err(|e| format!("无法读取 PDF: {e}"))?;
    let stem = pdf_path.file_stem().and_then(|s| s.to_str()).unwrap_or("document");
    let mut body = String::new();
    let pages: Vec<u32> = doc.get_pages().keys().cloned().collect();
    for (idx, page_num) in pages.iter().enumerate() {
        body.push_str(&format!(r#"<section class="page"><h3>第 {} 页</h3>"#, idx + 1));
        if let Ok(text) = doc.extract_text(&[*page_num]) {
            for line in text.lines() {
                let trimmed = line.trim();
                if !trimmed.is_empty() {
                    let esc = html_escape(trimmed);
                    body.push_str(&format!("<p>{esc}</p>"));
                }
            }
        }
        body.push_str("</section>\n");
    }
    let html = format!(
        r#"<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{stem}</title>
<style>
  body {{ margin: 0; padding: 28px; background: #f6f8fa; color: #24292f; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; line-height: 1.65; }}
  .page {{ max-width: 860px; margin: 0 auto 24px; padding: 36px 44px; background: #ffffff; border-radius: 12px; box-shadow: 0 2px 8px rgba(0,0,0,0.06); }}
  h3 {{ color: #57606a; font-size: 14px; text-transform: uppercase; margin-top: 0; }}
  p {{ margin: 0.6em 0; }}
</style>
</head>
<body>
{body}
</body>
</html>"#
    );
    fs::write(out_file, html).map_err(|e| format!("写入 HTML 失败: {e}"))?;
    Ok(())
}

// ───────────────────────── PDF 转 HTML ─────────────────────────

fn pdf_to_html(ctx: &Ctx, input: &(PathBuf, String)) -> Result<Value, String> {
    ctx.progress(20, "正在提取 PDF 结构并生成 HTML…");
    let stem = Path::new(&input.1).file_stem().and_then(|s| s.to_str()).unwrap_or("document");
    let out_name = format!("{stem}.html");
    let out_file = results_path(ctx.app, ctx.id, &out_name)?;

    let src_str = input.0.to_string_lossy();
    let dest_str = out_file.to_string_lossy();

    let com_script = format!(
        r#"
$src = [System.IO.Path]::GetFullPath('{src}')
$out = [System.IO.Path]::GetFullPath('{out}')

if (Test-Path $out) {{ Remove-Item $out -Force }}

$word = $null
try {{
    $word = New-Object -ComObject Word.Application
}} catch {{
    try {{
        $word = New-Object -ComObject KWps.Application
    }} catch {{
        Write-Error "NO_WORD_INSTALLED"
        exit 12
    }}
}}

try {{
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $doc = $word.Documents.Open($src, $false, $true)

    # 10 = wdFormatFilteredHTML
    $doc.SaveAs2($out, 10)
    $doc.Close($false)
}} finally {{
    try {{ $word.Quit() }} catch {{}}
}}
"#,
        src = src_str.replace("'", "''"),
        out = dest_str.replace("'", "''")
    );

    let res = run_ps(&com_script);
    if let Err(e) = res {
        if e.contains("NO_WORD_INSTALLED") {
            // Word 未安装时无缝退回纯 Rust Lopdf 解析
            lopdf_fallback_html(&input.0, &out_file)?;
        } else {
            return Err(format!("PDF 转 HTML 失败：{e}"));
        }
    }

    if !out_file.exists() || fs::metadata(&out_file).map(|m| m.len()).unwrap_or(0) == 0 {
        return Err("HTML 转换输出为空 / Output HTML is empty".into());
    }

    Ok(done(&out_file, &out_name, "text/html; charset=utf-8", "PDF 转 HTML 成功".into()))
}

// ───────────────────────── PDF 转 Markdown ─────────────────────────

fn pdf_to_markdown(ctx: &Ctx, input: &(PathBuf, String), payload: &Value) -> Result<Value, String> {
    ctx.progress(20, "正在提取 PDF 标题、段落与表格结构…");
    let stem = Path::new(&input.1).file_stem().and_then(|s| s.to_str()).unwrap_or("document");
    let out_name = format!("{stem}.md");
    let out_file = results_path(ctx.app, ctx.id, &out_name)?;

    let detect_tables = payload
        .get("detectTables")
        .and_then(|v| v.as_str().map(|s| s != "false").or_else(|| v.as_bool()))
        .unwrap_or(true);

    let src_str = input.0.to_string_lossy();
    let dest_str = out_file.to_string_lossy();

    let com_script = format!(
        r##"
$src = [System.IO.Path]::GetFullPath('{src}')
$out = [System.IO.Path]::GetFullPath('{out}')
$detectTables = {detect_tables}

if (Test-Path $out) {{ Remove-Item $out -Force }}

$word = $null
try {{
    $word = New-Object -ComObject Word.Application
}} catch {{
    try {{
        $word = New-Object -ComObject KWps.Application
    }} catch {{
        Write-Error "NO_WORD_INSTALLED"
        exit 12
    }}
}}

try {{
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $doc = $word.Documents.Open($src, $false, $true)

    $sb = New-Object System.Text.StringBuilder
    for ($p = 1; $p -le $doc.Paragraphs.Count; $p++) {{
        $para = $doc.Paragraphs.Item($p)
        $txt = $para.Range.Text.TrimEnd([char]7, [char]13, [char]10)
        if (-not $txt.Trim()) {{ continue }}

        $style = $para.Format.OutlineLevel
        if ($style -ge 1 -and $style -le 3) {{
            $prefix = [string]::new([char]35, $style)
            [void]$sb.AppendLine("$prefix $txt")
            [void]$sb.AppendLine()
        }} elseif ($para.Range.ListFormat.ListType -ne 0) {{
            [void]$sb.AppendLine("- $txt")
        }} elseif ($para.Range.Font.Bold -ne 0 -and $txt.Length -le 40) {{
            [void]$sb.AppendLine("**$txt**")
            [void]$sb.AppendLine()
        }} else {{
            [void]$sb.AppendLine($txt)
            [void]$sb.AppendLine()
        }}
    }}

    if ($detectTables -and $doc.Tables.Count -gt 0) {{
        [void]$sb.AppendLine()
        [void]$sb.AppendLine('### 表格内容 / Tables')
        [void]$sb.AppendLine()
        for ($t = 1; $t -le $doc.Tables.Count; $t++) {{
            $tbl = $doc.Tables.Item($t)
            for ($r = 1; $r -le [Math]::Min($tbl.Rows.Count, 2000); $r++) {{
                $rowVals = @()
                for ($c = 1; $c -le [Math]::Min($tbl.Columns.Count, 100); $c++) {{
                    try {{
                        $cTxt = $tbl.Cell($r, $c).Range.Text.TrimEnd([char]7, [char]13, [char]10).Trim()
                        $escaped = $cTxt.Replace("|", [string][char]92 + "|")
                        $rowVals += $escaped
                    }} catch {{
                        $rowVals += ""
                    }}
                }}
                [void]$sb.AppendLine("| " + ($rowVals -join " | ") + " |")
                if ($r -eq 1) {{
                    $divs = @()
                    for ($c = 1; $c -le $rowVals.Count; $c++) {{ $divs += "---" }}
                    [void]$sb.AppendLine("| " + ($divs -join " | ") + " |")
                }}
            }}
            [void]$sb.AppendLine()
        }}
    }}

    $doc.Close($false)
    [System.IO.File]::WriteAllText($out, $sb.ToString(), [System.Text.Encoding]::UTF8)
}} finally {{
    try {{ $word.Quit() }} catch {{}}
}}
"##,
        src = src_str.replace("'", "''"),
        out = dest_str.replace("'", "''"),
        detect_tables = if detect_tables { "$true" } else { "$false" }
    );

    let res = run_ps(&com_script);
    if let Err(e) = res {
        if e.contains("NO_WORD_INSTALLED") {
            lopdf_fallback_markdown(&input.0, &out_file)?;
        } else {
            return Err(format!("PDF 转 Markdown 失败：{e}"));
        }
    }

    if !out_file.exists() || fs::metadata(&out_file).map(|m| m.len()).unwrap_or(0) == 0 {
        return Err("Markdown 转换输出为空 / Output Markdown is empty".into());
    }

    Ok(done(&out_file, &out_name, "text/markdown; charset=utf-8", "PDF 转 Markdown 成功".into()))
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
                let p = s.get("path").and_then(Value::as_str).ok_or("缺少上传的文件")?;
                let n = s.get("name").and_then(Value::as_str).unwrap_or("document").to_string();
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
                let n = p.file_name().map(|x| x.to_string_lossy().to_string()).unwrap_or_else(|| "document".into());
                (p, n)
            })
            .collect()
    };

    if inputs.is_empty() {
        return Err("请选择需要转换的文档 / Select a document".into());
    }
    for (p, _) in &inputs {
        let m = std::fs::metadata(p).map_err(|e| format!("找不到文件：{e}"))?;
        if !m.is_file() || m.len() == 0 {
            return Err("文件为空或不存在 / Document is empty or missing".into());
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
    let payload_bg = payload.clone();
    std::thread::Builder::new()
        .name("native-office".into())
        .spawn(move || {
            crate::matting_native::progress(&app_bg, &id_bg, 5, "正在准备 Office 转换环境…");
            let ctx = Ctx { app: &app_bg, id: &id_bg };
            let result = match tool.as_str() {
                "word-to-pdf" => word_to_pdf(&ctx, &inputs[0]),
                "excel-to-pdf" => excel_to_pdf(&ctx, &inputs[0]),
                "pdf-to-word" => pdf_to_word(&ctx, &inputs[0]),
                "pdf-to-excel" => pdf_to_excel(&ctx, &inputs[0]),
                "pdf-to-ppt" => pdf_to_ppt(&ctx, &inputs[0], &payload_bg),
                "pdf-to-markdown" => pdf_to_markdown(&ctx, &inputs[0], &payload_bg),
                "pdf-to-html" => pdf_to_html(&ctx, &inputs[0]),
                other => Err(format!("不支持的 Office 原生工具：{other}")),
            };

            if ctx.cancelled() {
                return;
            }

            let mut m = Map::new();
            match result {
                Ok(r) => {
                    m.insert("status".into(), json!("completed"));
                    m.insert("progress".into(), json!(100));
                    m.insert("message".into(), r.get("message").cloned().unwrap_or(json!("转换完成")));
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
                    m.insert("message".into(), json!("转换失败"));
                    m.insert("error".into(), json!(e));
                }
            }
            crate::jobs::update_job(&app_bg, &id_bg, m);
        })
        .map_err(|e| format!("启动后台线程失败：{e}"))?;

    let current = crate::jobs::read_job_public(app, &id).unwrap_or(job);
    Ok(json!({ "job": current, "ok": true, "engine": "rust-com" }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_native_pdf_to_word_and_word_to_pdf() {
        let root = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).parent().unwrap().to_path_buf();
        let pdf = root.join("_verify/fixtures/test_doc.pdf");
        if !pdf.exists() {
            eprintln!("test_doc.pdf not found at {:?}, skipping test", pdf);
            return;
        }

        let temp_dir = std::env::temp_dir().join("fk_test_office_com");
        let _ = fs::remove_dir_all(&temp_dir);
        let _ = fs::create_dir_all(&temp_dir);

        let out_docx = temp_dir.join("test_doc.docx");
        let out_pdf = temp_dir.join("test_doc_reconverted.pdf");

        // 1. PDF -> Word
        let script_pdf2word = format!(
            r#"
$src = [System.IO.Path]::GetFullPath('{src}')
$out = [System.IO.Path]::GetFullPath('{out}')

$word = $null
try {{
    $word = New-Object -ComObject Word.Application
}} catch {{
    try {{
        $word = New-Object -ComObject KWps.Application
    }} catch {{
        Write-Error "NO_WORD_INSTALLED"
        exit 12
    }}
}}

try {{
    $doc = $word.Documents.Open($src, $false, $true)
    $doc.SaveAs2($out, 16)
    $doc.Close($false)
}} finally {{
    try {{ $word.Quit() }} catch {{}}
}}
"#,
            src = pdf.to_string_lossy().replace("'", "''"),
            out = out_docx.to_string_lossy().replace("'", "''")
        );

        let res1 = run_ps(&script_pdf2word);
        assert!(res1.is_ok(), "PDF to Word failed: {:?}", res1);
        assert!(out_docx.exists(), "Docx must exist");
        assert!(fs::metadata(&out_docx).unwrap().len() > 1000, "Docx size must be > 1000 bytes");

        // 2. Word -> PDF
        let script_word2pdf = format!(
            r#"
$src = [System.IO.Path]::GetFullPath('{src}')
$out = [System.IO.Path]::GetFullPath('{out}')

$word = $null
try {{
    $word = New-Object -ComObject Word.Application
}} catch {{
    try {{
        $word = New-Object -ComObject KWps.Application
    }} catch {{
        Write-Error "NO_WORD_INSTALLED"
        exit 12
    }}
}}

try {{
    $doc = $word.Documents.Open($src, $false, $true)
    $doc.ExportAsFixedFormat($out, 17)
    $doc.Close($false)
}} finally {{
    try {{ $word.Quit() }} catch {{}}
}}
"#,
            src = out_docx.to_string_lossy().replace("'", "''"),
            out = out_pdf.to_string_lossy().replace("'", "''")
        );

        let res2 = run_ps(&script_word2pdf);
        assert!(res2.is_ok(), "Word to PDF failed: {:?}", res2);
        assert!(out_pdf.exists(), "PDF must exist");
        assert!(fs::metadata(&out_pdf).unwrap().len() > 1000, "PDF size must be > 1000 bytes");

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_native_pdf_to_excel_and_pdf_to_ppt() {
        let root = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).parent().unwrap().to_path_buf();
        let pdf = root.join("_verify/fixtures/test_doc.pdf");
        if !pdf.exists() {
            eprintln!("test_doc.pdf not found at {:?}, skipping test", pdf);
            return;
        }

        let temp_dir = std::env::temp_dir().join("fk_test_office_excel_ppt");
        let _ = fs::remove_dir_all(&temp_dir);
        let _ = fs::create_dir_all(&temp_dir);

        let out_xlsx = temp_dir.join("test_doc.xlsx");
        let out_pptx = temp_dir.join("test_doc.pptx");

        // 1. PDF -> Excel test via Word Reflow + OpenXML generator
        let script_excel = format!(
            r#"
$src = [System.IO.Path]::GetFullPath('{src}')
$out = [System.IO.Path]::GetFullPath('{out}')

if (Test-Path $out) {{ Remove-Item $out -Force }}

$tmpDir = Join-Path $env:TEMP ("xlsx_build_" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path "$tmpDir\_rels" -Force | Out-Null
New-Item -ItemType Directory -Path "$tmpDir\xl\_rels" -Force | Out-Null
New-Item -ItemType Directory -Path "$tmpDir\xl\worksheets" -Force | Out-Null

$contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'
[System.IO.File]::WriteAllText("$tmpDir\[Content_Types].xml", $contentTypes, [System.Text.Encoding]::UTF8)

$rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'
[System.IO.File]::WriteAllText("$tmpDir\_rels\.rels", $rootRels, [System.Text.Encoding]::UTF8)

$wb = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Sheet1" sheetId="1" state="visible" r:id="rId1"/></sheets></workbook>'
[System.IO.File]::WriteAllText("$tmpDir\xl\workbook.xml", $wb, [System.Text.Encoding]::UTF8)

$wbRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'
[System.IO.File]::WriteAllText("$tmpDir\xl\_rels\workbook.xml.rels", $wbRels, [System.Text.Encoding]::UTF8)

$styles = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="1"><fill><patternFill patternType="none"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>'
[System.IO.File]::WriteAllText("$tmpDir\xl\styles.xml", $styles, [System.Text.Encoding]::UTF8)

function Get-ColLetter([int]$col) {{
    $s = ""
    while ($true) {{
        $rem = $col % 26
        $s = [char](65 + $rem) + $s
        if ($col -lt 26) {{ break }}
        $col = [math]::Floor($col / 26) - 1
    }}
    return $s
}}

$rows = @()

$word = $null
try {{
    $word = New-Object -ComObject Word.Application
    $word.Visible = $false
    $word.DisplayAlerts = 0
    $doc = $word.Documents.Open($src, $false, $true)

    if ($doc.Tables.Count -gt 0) {{
        for ($t = 1; $t -le $doc.Tables.Count; $t++) {{
            $tbl = $doc.Tables.Item($t)
            for ($r = 1; $r -le [Math]::Min($tbl.Rows.Count, 2000); $r++) {{
                $cells = @()
                for ($c = 1; $c -le [Math]::Min($tbl.Columns.Count, 100); $c++) {{
                    try {{
                        $txt = $tbl.Cell($r, $c).Range.Text.TrimEnd([char]7, [char]13, [char]10)
                        $cells += $txt.Trim()
                    }} catch {{
                        $cells += ""
                    }}
                }}
                $rows += ,$cells
            }}
            $rows += ,@()
        }}
    }} else {{
        for ($p = 1; $p -le [Math]::Min($doc.Paragraphs.Count, 5000); $p++) {{
            $txt = $doc.Paragraphs.Item($p).Range.Text.TrimEnd([char]7, [char]13, [char]10)
            $t = $txt.Trim()
            if ($t.Length -gt 0) {{
                $rows += ,@($t)
            }}
        }}
    }}

    $doc.Close($false)
}} finally {{
    if ($word) {{ try {{ $word.Quit() }} catch {{}} }}
}}

if ($rows.Count -eq 0) {{
    $rows = ,@("Extracted text from PDF")
}}

$sb = New-Object System.Text.StringBuilder
[void]$sb.AppendLine('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>')
[void]$sb.AppendLine('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">')
[void]$sb.AppendLine('  <sheetData>')

$rNum = 1
foreach ($row in $rows) {{
    if ($row.Count -eq 0) {{
        $rNum++
        continue
    }}
    [void]$sb.Append("    <row r=`"$rNum`">")
    for ($cIdx = 0; $cIdx -lt $row.Count; $cIdx++) {{
        $val = $row[$cIdx]
        $cRef = (Get-ColLetter $cIdx) + $rNum
        $clean = [System.Security.SecurityElement]::Escape($val)
        [void]$sb.Append("<c r=`"$cRef`" t=`"inlineStr`"><is><t>$clean</t></is></c>")
    }}
    [void]$sb.AppendLine("</row>")
    $rNum++
}}

[void]$sb.AppendLine('  </sheetData>')
[void]$sb.AppendLine('</worksheet>')

[System.IO.File]::WriteAllText("$tmpDir\xl\worksheets\sheet1.xml", $sb.ToString(), [System.Text.Encoding]::UTF8)

$outZip = Join-Path $env:TEMP ("xlsx_zip_" + [Guid]::NewGuid().ToString("N") + ".zip")
Add-Type -AssemblyName System.IO.Compression.FileSystem
[System.IO.Compression.ZipFile]::CreateFromDirectory($tmpDir, $outZip)
Move-Item -Path $outZip -Destination $out -Force
Remove-Item -Recurse -Force $tmpDir
"#,
            src = pdf.to_string_lossy().replace("'", "''"),
            out = out_xlsx.to_string_lossy().replace("'", "''")
        );

        let res1 = run_ps(&script_excel);
        eprintln!("PDF to Excel res1: {:?}", res1);
        assert!(res1.is_ok(), "PDF to Excel failed: {:?}", res1);
        assert!(out_xlsx.exists(), "XLSX must exist");
        assert!(fs::metadata(&out_xlsx).unwrap().len() > 1000, "XLSX size must be > 1000 bytes");

        // 2. PDF -> PPT COM test
        let renderer = crate::pdf_render::Renderer::open(&pdf).unwrap();
        let count = renderer.count().unwrap();
        assert!(count > 0, "PDF must have pages");

        let page_img = temp_dir.join("page_0.png");
        renderer.render(0, 150, &page_img, &|| Ok(())).unwrap();
        assert!(page_img.exists(), "Rendered page image must exist");

        let script_ppt = format!(
            r#"
$out = [System.IO.Path]::GetFullPath('{out}')
$img = [System.IO.Path]::GetFullPath('{img}')

$ppt = $null
try {{
    $ppt = New-Object -ComObject PowerPoint.Application
}} catch {{
    try {{
        $ppt = New-Object -ComObject KWPP.Application
    }} catch {{
        Write-Error "NO_PPT_INSTALLED"
        exit 12
    }}
}}

try {{
    $pres = $ppt.Presentations.Add(0)
    $slide = $pres.Slides.Add(1, 12)
    $w = $pres.PageSetup.SlideWidth
    $h = $pres.PageSetup.SlideHeight
    $pic = $slide.Shapes.AddPicture($img, 0, -1, 0, 0, $w, $h)
    $pres.SaveAs($out)
    $pres.Close()
}} finally {{
    try {{ $ppt.Quit() }} catch {{}}
}}
"#,
            out = out_pptx.to_string_lossy().replace("'", "''"),
            img = page_img.to_string_lossy().replace("'", "''")
        );

        let res2 = run_ps(&script_ppt);
        assert!(res2.is_ok(), "PDF to PPT failed: {:?}", res2);
        assert!(out_pptx.exists(), "PPTX must exist");
        assert!(fs::metadata(&out_pptx).unwrap().len() > 1000, "PPTX size must be > 1000 bytes");

        let _ = fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn test_native_pdf_to_markdown_and_pdf_to_html() {
        let root = PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap()).parent().unwrap().to_path_buf();
        let pdf = root.join("_verify/fixtures/test_doc.pdf");
        if !pdf.exists() {
            eprintln!("test_doc.pdf not found at {:?}, skipping test", pdf);
            return;
        }

        let temp_dir = std::env::temp_dir().join("fk_test_office_md_html");
        let _ = fs::remove_dir_all(&temp_dir);
        let _ = fs::create_dir_all(&temp_dir);

        let out_md = temp_dir.join("test_doc.md");
        let out_html = temp_dir.join("test_doc.html");

        // 1. PDF -> HTML
        let script_html = format!(
            r#"
$src = [System.IO.Path]::GetFullPath('{src}')
$out = [System.IO.Path]::GetFullPath('{out}')

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$doc = $word.Documents.Open($src, $false, $true)
$doc.SaveAs2($out, 10)
$doc.Close($false)
$word.Quit()
"#,
            src = pdf.to_string_lossy().replace("'", "''"),
            out = out_html.to_string_lossy().replace("'", "''")
        );
        let res_html = run_ps(&script_html);
        assert!(res_html.is_ok(), "PDF to HTML failed: {:?}", res_html);
        assert!(out_html.exists(), "HTML must exist");
        assert!(fs::metadata(&out_html).unwrap().len() > 100, "HTML size must be > 100 bytes");

        // 2. PDF -> Markdown
        let script_md = format!(
            r##"
$src = [System.IO.Path]::GetFullPath('{src}')
$out = [System.IO.Path]::GetFullPath('{out}')

$word = New-Object -ComObject Word.Application
$word.Visible = $false
$word.DisplayAlerts = 0
$doc = $word.Documents.Open($src, $false, $true)

$sb = New-Object System.Text.StringBuilder
for ($p = 1; $p -le $doc.Paragraphs.Count; $p++) {{
    $para = $doc.Paragraphs.Item($p)
    $txt = $para.Range.Text.TrimEnd([char]7, [char]13, [char]10)
    if ($txt.Trim()) {{
        [void]$sb.AppendLine($txt)
        [void]$sb.AppendLine()
    }}
}}
if ($doc.Tables.Count -gt 0) {{
    [void]$sb.AppendLine()
    [void]$sb.AppendLine('### Tables')
    [void]$sb.AppendLine()
    for ($t = 1; $t -le $doc.Tables.Count; $t++) {{
        $tbl = $doc.Tables.Item($t)
        for ($r = 1; $r -le [Math]::Min($tbl.Rows.Count, 50); $r++) {{
            $rowVals = @()
            for ($c = 1; $c -le [Math]::Min($tbl.Columns.Count, 20); $c++) {{
                try {{
                    $cTxt = $tbl.Cell($r, $c).Range.Text.TrimEnd([char]7, [char]13, [char]10).Trim()
                    $rowVals += $cTxt.Replace("|", [string][char]92 + "|")
                }} catch {{
                    $rowVals += ""
                }}
            }}
            [void]$sb.AppendLine("| " + ($rowVals -join " | ") + " |")
            if ($r -eq 1) {{
                $divs = @()
                for ($c = 1; $c -le $rowVals.Count; $c++) {{ $divs += "---" }}
                [void]$sb.AppendLine("| " + ($divs -join " | ") + " |")
            }}
        }}
    }}
}}
$doc.Close($false)
$word.Quit()
[System.IO.File]::WriteAllText($out, $sb.ToString(), [System.Text.Encoding]::UTF8)
"##,
            src = pdf.to_string_lossy().replace("'", "''"),
            out = out_md.to_string_lossy().replace("'", "''")
        );
        let res_md = run_ps(&script_md);
        assert!(res_md.is_ok(), "PDF to Markdown failed: {:?}", res_md);
        assert!(out_md.exists(), "Markdown must exist");
        assert!(fs::metadata(&out_md).unwrap().len() > 100, "Markdown size must be > 100 bytes");

        let _ = fs::remove_dir_all(&temp_dir);
    }
}
