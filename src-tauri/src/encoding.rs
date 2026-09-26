// 文本编码：检测 与 乱码修复
//
// 浏览器只会 UTF-8 编码，不会"把一段文字编回 GBK 字节"，所以乱码修复在纯前端做不了完整。
// Rust 侧本来就有 encoding_rs（Tauri 的依赖，**不增加体积**），这里直接用它：
//   · detect  —— 给一段字节，猜它是什么编码（含 BOM 判断、替换字符与控制字符打分）
//   · repair  —— 给一段"被错误解码后的乱码文字"，反推原始编码再正确解回来
//
// 乱码的原理很简单：原文按编码 A 变成字节，却被当成编码 B 解读了。
// 所以修复 = 用 B 把乱码**编回字节**，再用 A **正确解码**。逐个组合试一遍、按结果可信度排序即可。

use encoding_rs::Encoding;
use serde_json::{json, Value};

use crate::jobs::b64_decode_public;

/// 候选编码（label 用来显示，encoding_rs 的标签用来查表）
const CANDIDATES: [(&str, &str); 8] = [
    ("UTF-8", "utf-8"),
    ("GBK / GB18030（简体中文）", "gb18030"),
    ("Big5（繁体中文）", "big5"),
    ("Shift_JIS（日文）", "shift_jis"),
    ("EUC-KR（韩文）", "euc-kr"),
    ("Windows-1252（西欧）", "windows-1252"),
    ("UTF-16 LE", "utf-16le"),
    ("UTF-16 BE", "utf-16be"),
];

fn enc(label: &str) -> Option<&'static Encoding> {
    Encoding::for_label(label.as_bytes())
}

/// 常用汉字表（约 400 个最高频的字）：用来判断"解出来的是不是正常中文"。
/// 为什么需要：同一个乱码往往有好几种解法都能解出"像样的字"，
/// 例如把 GBK 的字节按 Big5 解会得到一堆生僻字（斕疑ㄛ岍賜ㄐ），
/// 光看"有没有汉字"分不出来，要看"是不是常用字"。
const COMMON_HANZI: &str = "的一是不了在人有我他这个们中来上大为和国地到以说时要就出会可也你对生能而子那得于着下自之年过发后作里用道行所然家种事成方多经么去法学如都同现当没动面起看定天分还进好小部其些主样理心她本前开但因只从想实日军者意无力它与长把机十民第公此已工使情明性知全三又关点正业外将两高间由问很最重并物手应战向头文体政美相见被利什二等产或新己制身果加西斯月话合回特代内信表化老给世位次度门任常先海通教儿原东声提立及比员解水名真论处走义各入几口认条平系气题活尔更别打女变四神总何电数安少报才结反受目太量再感建务做接必场件计管期市直德资命山金指克许统区保至队形社便空决治展马科司五基眼书非则听白却界达光放强即像难且权思王象完设式色路记南品住告类求据程北边死张该交规万取拉格望觉术领共确传师观清今切院让识候带导争运笑飞风步改收根干造言联持组每济车亲极林服快办议往元英士证近失转夫令准布始怎呢存未远叫台单影具罗字爱击流备兵连调深商算质团集百需价花党华城石级整府离况亚请技际约示复病息究线似官火断精满支视消越器容照须九增研写称企八功吗包片史委乎查轻易早曾除农找装广显吧阿李标谈吃图念六引历首医局突专费号尽另周较注语仅考落青随选列武红响虽推势参希古众构房半节土投某案黑维革划敌致陈律足态护七兴派孩验责营星够章音跟志底站严巴例防族供效续施留讲型料终答紧黄绝奇察母京段依批群项故按河米围江织害斗双境客纪采举杀攻父苏密低朝友诉止细愿千值仍男钱破网热助倒育属坐帝限船脸职速刻乐否刚威毛状率甚独球般普怕弹校苦创假久错承印晚兰试股拿脑预谁益阳若哪微尼继送急血惊伤素药适波夜省初喜卫源食险待述陆习置居劳财环排福纳欢雷警获模充负云停木游龙树疑层冷洲冲射略范竟句室异激汉村哈策演简卡罪判担州静退既衣您宗积余痛检差富灵协角占配征修皮挥胜降阶审沉坚善妈刘读啊超免压银买皇养伊谢弟";

/// 中文里最常见的标点（出现它们说明解出来的是"像人话"的句子）
const COMMON_PUNCT: &str = "，。！？、：；（）“”‘’《》【】…—";

/// 【检测用】一段解读结果"干净不干净"的分数：越高越好（0~100）。
/// 检测关心的是「按这个编码读，有没有读出乱码符号/控制字符」——
/// 但光看这个不够：把 UTF-8 的字节按 UTF-16 读，会得到一堆**生僻汉字**、一样没有乱码符号。
/// 所以再加两条：解出的汉字是不是常用字（生僻字说明解错了）、有没有 BOM。
fn score_decode(s: &str) -> i32 {
    if s.is_empty() {
        return 0;
    }
    let total = s.chars().count() as i32;
    let mut bad = 0i32;
    let mut cjk = 0i32;
    let mut common = 0i32;
    for c in s.chars() {
        if c == '\u{FFFD}' {
            bad += 3;
        } else if c.is_control() && c != '\n' && c != '\r' && c != '\t' {
            bad += 2;
        } else if ('\u{4E00}'..='\u{9FFF}').contains(&c) {
            cjk += 1;
            if COMMON_HANZI.contains(c) {
                common += 1;
            }
        }
    }
    let mut score = 100 - bad * 12;
    if cjk > 0 {
        // 解出的汉字里常用字占比高 → 这次解读大概率是对的
        let ratio = common as f64 / cjk as f64;
        if ratio >= 0.75 {
            score += 0;
        } else {
            score -= ((0.75 - ratio) * 60.0).round() as i32;
        }
    }
    score.clamp(0, 100)
}

/// 【修复用】一段解读结果"像不像正常中文"的分数：越高越好（0~100）。
/// 修复关心的是「哪个候选读出来最像人话」，所以要按常用字占比来评。
fn score_text(s: &str) -> i32 {
    if s.is_empty() {
        return 0;
    }
    let total = s.chars().count() as i32;
    let mut bad = 0i32;
    let mut common = 0i32; // 常用汉字
    let mut cjk = 0i32; // 任意汉字
    let mut punct = 0i32; // 中文标点

    for c in s.chars() {
        if c == '\u{FFFD}' {
            bad += 3; // 替换字符 = 解错了
        } else if c.is_control() && c != '\n' && c != '\r' && c != '\t' {
            bad += 2;
        } else if ('\u{3100}'..='\u{312F}').contains(&c) {
            bad += 2; // 注音符号（ㄅㄆㄇ）：Big5 解错时的典型产物
        } else if ('\u{FF61}'..='\u{FF9F}').contains(&c) {
            bad += 2; // 半角片假名：Shift_JIS 解错时的典型产物
        } else if ('\u{00C0}'..='\u{00FF}').contains(&c) {
            bad += 1; // 西欧重音字母：还是乱码（没解回中文）的迹象
        } else if ('\u{4E00}'..='\u{9FFF}').contains(&c) {
            cjk += 1;
            if COMMON_HANZI.contains(c) {
                common += 1;
            }
        } else if COMMON_PUNCT.contains(c) {
            punct += 1;
        }
    }

    // 常用字占比权重最高 —— 这是区分"正常中文"与"生僻字乱码"的关键
    let common_ratio = common as f64 / total as f64;
    let cjk_ratio = cjk as f64 / total as f64;
    let punct_ratio = punct as f64 / total as f64;

    let mut score = (common_ratio * 90.0 + cjk_ratio * 15.0 + punct_ratio * 20.0).round() as i32;
    score -= bad * 12;
    score.clamp(0, 100)
}

/// 检测一段字节的编码
pub fn detect(data_b64: &str) -> Result<Value, String> {
    let bytes = b64_decode_public(data_b64);
    if bytes.is_empty() {
        return Err("没有可检测的内容".into());
    }

    // ① BOM 是铁证
    let bom = Encoding::for_bom(&bytes);

    // ② 其余逐个试
    let mut list: Vec<Value> = Vec::new();
    for (label, id) in CANDIDATES {
        let Some(e) = enc(id) else { continue };
        let (text, _, had_errors) = e.decode(&bytes);
        // 检测看的是"读得干不干净"，用 score_decode（不是 score_text —— 那是给乱码修复排序用的）
        let mut score = if had_errors { score_decode(&text) - 30 } else { score_decode(&text) };
        // UTF-16 没有 BOM 几乎不可能（Windows 记事本一定会写 BOM），降权避免"假 100 分"
        if (id == "utf-16le" || id == "utf-16be") && bom.map(|(b, _)| b.name() != e.name()).unwrap_or(true) {
            score -= 50;
        }
        // 字节数是奇数的话，UTF-16 必然读错（它按 2 字节一组）
        if (id == "utf-16le" || id == "utf-16be") && bytes.len() % 2 != 0 {
            score -= 20;
        }
        list.push(json!({
            "encoding": id,
            "label": label,
            "score": score.max(0),
            "hadErrors": had_errors,
            "preview": text.chars().take(120).collect::<String>(),
        }));
    }
    list.sort_by(|a, b| {
        b.get("score").and_then(|v| v.as_i64()).unwrap_or(0)
            .cmp(&a.get("score").and_then(|v| v.as_i64()).unwrap_or(0))
    });

    // 行尾与基本信息
    let text_utf8 = String::from_utf8_lossy(&bytes);
    let crlf = text_utf8.matches("\r\n").count();
    let lf_only = text_utf8.matches('\n').count().saturating_sub(crlf);
    let bom_desc = bom.map(|(e, len)| format!("{}（{} 字节）", e.name(), len));

    Ok(json!({
        "success": true,
        "size": bytes.len(),
        "bom": bom_desc,
        "lineEnding": if crlf > 0 && lf_only == 0 { "CRLF（Windows）".to_string() }
                      else if crlf > 0 { format!("混合（CRLF {crlf} 处 / LF {lf_only} 处）") }
                      else if lf_only > 0 { "LF（Unix）".to_string() } else { "没有换行".to_string() },
        "hexPreview": bytes.iter().take(48).map(|b| format!("{b:02X}")).collect::<Vec<_>>().join(" "),
        "best": list.first().cloned().unwrap_or(json!(null)),
        "candidates": list,
    }))
}

/// 按指定编码把字节解成文字
pub fn decode(data_b64: &str, encoding: &str) -> Result<Value, String> {
    let bytes = b64_decode_public(data_b64);
    let e = enc(encoding).ok_or_else(|| format!("不认识的编码：{encoding}"))?;
    let (text, _, had_errors) = e.decode(&bytes);
    Ok(json!({ "success": true, "text": text, "hadErrors": had_errors, "encoding": e.name() }))
}

/// 把文字编成指定编码的字节（base64 返回，前端可下载）
pub fn encode(text: &str, encoding: &str) -> Result<Value, String> {
    let e = enc(encoding).ok_or_else(|| format!("不认识的编码：{encoding}"))?;
    let (bytes, _, had_errors) = e.encode(text);
    Ok(json!({
        "success": true,
        "data": crate::jobs::b64_encode_public(&bytes),
        "size": bytes.len(),
        "encoding": e.name(),
        "hadErrors": had_errors,
        "note": if had_errors { "有些字符这个编码表示不了，已用 ? 代替" } else { "" },
    }))
}

/// 乱码修复：把可能"编错/解错"的组合都试一遍，按可信度排序
pub fn repair(text: &str) -> Result<Value, String> {
    if text.trim().is_empty() {
        return Err("请先粘贴乱码内容".into());
    }
    // 乱码常见的两种情况：
    //   ① 原文是 A 编码的字节，被当成 B 读了 → 修：按 B 编回去，再按 A 解
    //   ② 只是"看起来像 Latin-1/Windows-1252 的西欧字符"（UTF-8 被当西欧编码读）
    let wrong_list = ["gb18030", "big5", "shift_jis", "euc-kr", "windows-1252"];
    let right_list = ["utf-8", "gb18030", "big5", "shift_jis"];

    let mut out: Vec<Value> = Vec::new();
    for wrong in wrong_list {
        let Some(w) = enc(wrong) else { continue };
        let (bytes, _, enc_err) = w.encode(text);
        if enc_err {
            continue; // 这段文字根本编不进这种编码，说明不是这条路
        }
        for right in right_list {
            if right == wrong {
                continue;
            }
            let Some(r) = enc(right) else { continue };
            let (fixed, _, dec_err) = r.decode(&bytes);
            if fixed == text {
                continue;
            }
            let mut score = score_text(&fixed);
            if dec_err {
                score -= 20;
            }
            // 原文里出现"涓€浣犲ソ"这类特征是 UTF-8 被当 GBK 读的典型，给这种组合加权
            if wrong == "gb18030" && right == "utf-8" && fixed.chars().any(|c| ('\u{4E00}'..='\u{9FFF}').contains(&c)) {
                score += 10;
            }
            if fixed.chars().all(|c| c.is_control() && c != '\n' && c != '\t') {
                continue;
            }
            out.push(json!({
                "from": wrong,
                "to": right,
                "score": score.clamp(0, 100),
                "text": fixed.chars().take(400).collect::<String>(),
                "truncated": fixed.chars().count() > 400,
            }));
        }
    }
    out.sort_by(|a, b| {
        b.get("score").and_then(|v| v.as_i64()).unwrap_or(0)
            .cmp(&a.get("score").and_then(|v| v.as_i64()).unwrap_or(0))
    });
    out.dedup_by(|a, b| a.get("text") == b.get("text"));
    out.truncate(8);

    // 输入里含替换字符（�）说明：当初读错编码的那个程序就已经把无法识别的字节丢掉了，
    // 信息已经不在，谁都恢复不了。这种情况要**明确告诉用户"只能恢复到这种程度"**，
    // 而不是给一个看着像样子、其实缺字的结​果让他以为修好了。
    let damaged = text.contains('\u{FFFD}');

    Ok(json!({
        "success": true,
        "candidates": out,
        "count": out.len(),
        "inputDamaged": damaged,
        "damageNote": if damaged {
            "这段乱码里已经含有「�」——说明当初读错编码时就有字节被丢掉了，那部分内容已经无法恢复，只能尽量还原剩下的。"
        } else {
            ""
        },
    }))
}
