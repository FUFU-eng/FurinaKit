// 翻译（截图翻译工具用）。
//
// 用的是两个**免密钥、国内可直连**的公开接口（已实测）：
//   ① 腾讯 transmart —— 走 POST JSON，实测可用，支持一次传多段文本、也能自动识别源语言；
//   ② 有道 aidemo   —— 备用，实测可用。
//
// 为什么不用那些需要 key 的服务：用户装上就能用，不该让作者再去申请密钥；
// 也不该把密钥打进客户端。这两个接口都是网页端自己就在用的公开接口。
//
// 失败时会明确告诉用户"是网络问题还是接口变了"，而不是抛一句英文异常。

use serde_json::{json, Value};

fn post_json(url: &str, body: &str, referer: &str, timeout: u32) -> Result<String, String> {
    let attempt = |proxy: Option<&str>| -> Result<String, String> {
        let mut cmd = std::process::Command::new("curl");
        cmd.args(["-sS", "--max-time", &timeout.to_string(), "--connect-timeout", "10", "--fail"]);
        match proxy { Some(p) => { cmd.args(["--noproxy", "", "--proxy", p]); }, None => { cmd.args(["--noproxy", "*"]); } }
        cmd.args(["-A", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36"]);
        cmd.args(["-H", "Content-Type: application/json"]);
        cmd.args(["-H", &format!("Referer: {referer}")]);
        cmd.args(["-H", &format!("Origin: {}", url::Url::parse(referer).map_err(|e|e.to_string())?.origin().ascii_serialization())]);
        cmd.args(["-X", "POST", "--data", body, url]);
        crate::commands::no_window(&mut cmd);
        let out = cmd.output().map_err(|e| format!("调用 curl 失败：{e}"))?;
        if !out.status.success() {
            return Err(String::from_utf8_lossy(&out.stderr).trim().to_string());
        }
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    };
    match attempt(None) {
        Ok(s) => Ok(s),
        Err(first) => match crate::video::system_proxy(url) {
            Some(p) => attempt(Some(&p)).map_err(|_| first),
            None => Err(first),
        },
    }
}

/// 腾讯 transmart：一次可以传多段，返回同样数量的译文
fn tencent(texts: &[String], from: &str, to: &str) -> Result<Vec<String>, String> {
    let payload = json!({
        "header": {
            "fn": "auto_translation",
            "client_key": "browser-chrome-130.0.0.0",
            "client_version": "1.0.0",
            "client_platform": "web"
        },
        "type": "plain",
        "model_category": "normal",
        "source": { "lang": from, "text_list": texts },
        "target": { "lang": to }
    });
    let body = serde_json::to_string(&payload).map_err(|e| format!("构造请求失败：{e}"))?;
    let out = post_json(
        "https://transmart.qq.com/api/imt",
        &body,
        "https://transmart.qq.com/zh-CN/index",
        25,
    )?;
    let v: Value = serde_json::from_str(&out).map_err(|_| "翻译接口返回的不是有效 JSON（接口可能变了）".to_string())?;
    let ret = v
        .get("header")
        .and_then(|h| h.get("ret_code"))
        .and_then(|x| x.as_str())
        .unwrap_or("");
    if ret != "succ" {
        let msg = v
            .get("header")
            .and_then(|h| h.get("ret_code"))
            .and_then(|x| x.as_str())
            .unwrap_or("未知");
        return Err(format!("翻译服务返回了错误（{msg}）"));
    }
    let list = v
        .get("auto_translation")
        .and_then(|x| x.as_array())
        .map(|arr| arr.iter().map(|s| s.as_str().unwrap_or("").to_string()).collect::<Vec<_>>())
        .unwrap_or_default();
    validate_translations(&list, texts.len())?;
    Ok(list)
}

/// 有道 aidemo（备用）：一次一段
fn youdao(text: &str, from: &str, to: &str) -> Result<Vec<String>, String> {
    let url = format!(
        "https://aidemo.youdao.com/trans?q={}&from={}&to={}",
        crate::netquery::url_encode(text),
        crate::netquery::url_encode(from),
        crate::netquery::url_encode(to)
    );
    let out = crate::netquery::http_get(&url, 25)?;
    let v: Value = serde_json::from_str(&out).map_err(|_| "备用翻译接口返回的不是有效 JSON".to_string())?;
    // 有道返回的 translation 是数组
    let list = v
        .get("translation")
        .and_then(|x| x.as_array())
        .map(|arr| arr.iter().map(|s| s.as_str().unwrap_or("").to_string()).collect::<Vec<_>>())
        .unwrap_or_default();
    if list.is_empty() || list.iter().any(|t| t.trim().is_empty()) {
        return Err("备用翻译接口没有返回完整译文".into());
    }
    Ok(vec![list.join("\n")])
}

/// 语言代码在两家之间不一致，这里统一成内部代码再各自映射
fn norm_lang(code: &str) -> String {
    match code {
        "" | "auto" => "auto".into(),
        "zh" | "zh-CN" | "zh-Hans" | "zh-CHS" => "zh".into(),
        "zh-TW" | "zh-Hant" => "zh-TW".into(),
        "en" => "en".into(),
        "ja" => "ja".into(),
        "ko" => "ko".into(),
        "fr" => "fr".into(),
        "de" => "de".into(),
        "es" => "es".into(),
        "ru" => "ru".into(),
        other => other.to_string(),
    }
}

fn tencent_lang(code: &str) -> String {
    match code {
        "zh" => "zh".into(),
        "zh-TW" => "zh-TW".into(),
        "auto" => "auto".into(),
        other => other.to_string(),
    }
}

fn youdao_lang(code: &str) -> String {
    match code {
        "zh" => "zh-CHS".into(),
        "zh-TW" => "zh-CHT".into(),
        "auto" => "AUTO".into(),
        other => other.to_string(),
    }
}

fn validate_translations(list: &[String], expected: usize) -> Result<(),String> {
    if list.len() != expected || list.iter().any(|t| t.trim().is_empty()) {
        return Err("翻译接口返回的段落不完整".into());
    }
    Ok(())
}

/// 按文字体系粗判一段文本的语言；纯拉丁字母等返回 "auto"，交给腾讯在不含中日韩文字的分组里自行识别。
fn detect_script(text: &str) -> &'static str {
    let (mut han, mut kana, mut hangul, mut cyr) = (0usize, 0usize, 0usize, 0usize);
    for c in text.chars() {
        match c as u32 {
            0x3040..=0x30FF | 0x31F0..=0x31FF => kana += 1,
            0xAC00..=0xD7AF | 0x1100..=0x11FF | 0x3130..=0x318F => hangul += 1,
            0x3400..=0x4DBF | 0x4E00..=0x9FFF | 0xF900..=0xFAFF => han += 1,
            0x0400..=0x04FF => cyr += 1,
            _ => {}
        }
    }
    if kana > 0 { "ja" } else if hangul > 0 { "ko" } else if han > 0 { "zh" } else if cyr > 0 { "ru" } else { "auto" }
}

fn tencent_grouped(texts: &[String], tid: &str) -> Result<Vec<String>, String> {
    let mut out: Vec<Option<String>> = vec![None; texts.len()];
    let mut groups: Vec<(&'static str, Vec<usize>)> = Vec::new();
    for (i, t) in texts.iter().enumerate() {
        let lang = detect_script(t);
        // 已是目标语言（简体中文目标 + 含汉字段落等）不再请求，避免被整批误判
        if lang == tid { out[i] = Some(t.clone()); continue; }
        match groups.iter_mut().find(|(l, _)| *l == lang) { Some((_, v)) => v.push(i), None => groups.push((lang, vec![i])) }
    }
    for (lang, idx) in groups {
        let part: Vec<String> = idx.iter().map(|&i| texts[i].clone()).collect();
        let translated = tencent(&part, &tencent_lang(lang), &tencent_lang(tid))?;
        for (k, i) in idx.into_iter().enumerate() { out[i] = Some(translated[k].clone()); }
    }
    let list: Vec<String> = out.into_iter().map(|x| x.unwrap_or_default()).collect();
    validate_translations(&list, texts.len())?;
    Ok(list)
}

/// 翻译一批文本
pub fn translate(texts: Vec<String>, from: &str, to: &str) -> Result<Value, String> {
    let texts: Vec<String> = texts.into_iter().filter(|t| !t.trim().is_empty()).collect();
    if texts.is_empty() {
        return Err("没有要翻译的内容".into());
    }
    if texts.len() > 200 {
        return Err("一次最多翻译 200 段，请分批".into());
    }
    if texts.iter().any(|t|t.chars().count()>5000) || texts.iter().map(|t|t.chars().count()).sum::<usize>()>20000 {
        return Err("单段最多 5000 字、一次最多 20000 字，请分批翻译".into());
    }
    if to == "auto" || to.trim().is_empty() {return Err("请选择译文语言".into());}
    let started = std::time::Instant::now();
    let fid = norm_lang(from);
    let tid = norm_lang(to);

    // ① 首选腾讯。
    // 修复“译文语言选中文却原样返回”：腾讯 auto 是按整批文本只判一次源语言，截图里夹着中文标签时
    // 整批会被判成 zh → zh，于是全部原样返回。现在源语言为“自动”时按段在本地判定文字体系，
    // 同语种分组各自带明确源语言请求；已经是目标语言的段落直接保留原文。
    let tencent_result = if fid == "auto" { tencent_grouped(&texts, &tid) } else { tencent(&texts, &tencent_lang(&fid), &tencent_lang(&tid)) };
    match tencent_result {
        Ok(list) => {
            return Ok(json!({ "success": true, "provider": "腾讯翻译", "translations": list }));
        }
        Err(e1) => {
            // ② 备用有道（一次一段）
            let mut list = Vec::new();
            for t in &texts {
                if started.elapsed().as_secs() > 60 { return Err("备用翻译等待过久，请减少段落后重试；未完成的译文不会当作成功结果".into()); }
                match youdao(t, &youdao_lang(&fid), &youdao_lang(&tid)) {
                    Ok(mut one) => list.push(one.pop().unwrap_or_default()),
                    Err(e2) => {
                        return Err(format!(
                            "两个翻译服务都不可用。腾讯：{e1}；有道：{e2}。请检查网络是否能访问国内网站。"
                        ))
                    }
                }
            }
            return Ok(json!({ "success": true, "provider": "有道翻译（备用）", "translations": list }));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn rejects_missing_paragraphs() { assert!(validate_translations(&["第一段".into()],2).is_err()); }
    #[test] fn rejects_blank_paragraphs() { assert!(validate_translations(&["第一段".into()," ".into()],2).is_err()); }
    #[test] fn accepts_complete_result() { assert!(validate_translations(&["第一段".into(),"第二段".into()],2).is_ok()); }
    #[test] fn detects_scripts() { assert_eq!(detect_script("额度时钟"),"zh"); assert_eq!(detect_script("カタカナ"),"ja"); assert_eq!(detect_script("한국어"),"ko"); assert_eq!(detect_script("Tools"),"auto"); }
    #[test] fn rejects_auto_target_before_network() { assert!(translate(vec!["test".into()],"en","auto").is_err()); }
}
