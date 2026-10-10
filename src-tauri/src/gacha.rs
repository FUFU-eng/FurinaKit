//! 抽卡记录分析（原神 / 崩坏：星穹铁道 / 绝区零 / 鸣潮，国服）
//!
//! 记录怎么来（三种方式，按推荐顺序）：
//!   1. 米游社扫码登录（原神 / 星铁 / 绝区零）：和小黑盒、米游社工具一样，
//!      扫码拿到通行证凭证 → 查游戏角色 → 生成抽卡记录用的 authkey → 拉官方抽卡记录接口。
//!   2. 读游戏缓存：玩家在游戏里打开过一次抽卡记录页后，游戏缓存里会留下带 authkey 的链接（约 24 小时有效）。
//!      鸣潮不是米哈游的游戏，只能用这种方式（读游戏日志 Client.log 里的抽卡记录链接）。
//!   3. 手动粘贴抽卡记录链接。
//!
//! 记录保存在本机（存储目录/gacha/<游戏>/<UID>.json），下次只拉新增的；支持导入 / 导出 UIGF v4。
//! 登录凭证用 Windows DPAPI 加密后保存在本机，只有当前 Windows 用户能解开；可随时「退出登录」删除。
//! 网络请求用系统自带 curl，国内接口直连（不走系统代理）。

use std::collections::{HashMap, HashSet};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde_json::{json, Map, Value};

// ───────────────────────── 常量 ─────────────────────────

const PASSPORT: &str = "https://passport-api.mihoyo.com";
const PASS_APP_ID: &str = "ddxf5dufpuyo";
const PASS_CLIENT_TYPE: &str = "3";
const PASS_UA: &str = "HYPContainer/1.3.3.182";
const BBS_VERSION: &str = "2.71.1";
const SALT_LK2: &str = "EJncUPGnOHajenjLhBOsdpwEMZmiCmQX";
const SALT_X4: &str = "xV8v4Qu54lUKrEYFZkJhB8cuOh9Asafs";
const PAGE_SIZE: usize = 20;

fn bbs_ua() -> String {
    format!("Mozilla/5.0 (Linux; Android 13; M2101K9C Build/TKQ1.220829.002; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/108.0.5359.128 Mobile Safari/537.36 miHoYoBBS/{BBS_VERSION}")
}

struct Game {
    key: &'static str,
    biz: &'static str,
    url: &'static str,
    type_key: &'static str,
    pools: &'static [&'static str],
    /// 游戏日志位置（%USERPROFILE%\AppData\LocalLow\…）和游戏数据目录名
    log_dir: &'static str,
    data_names: &'static [&'static str],
}

const GAMES: [Game; 3] = [
    Game { key: "genshin", biz: "hk4e_cn", url: "https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog", type_key: "gacha_type",
        pools: &["301", "302", "200", "500", "100"], log_dir: "miHoYo\\原神\\output_log.txt", data_names: &["YuanShen_Data", "GenshinImpact_Data"] },
    Game { key: "starrail", biz: "hkrpg_cn", url: "https://public-operation-hkrpg.mihoyo.com/common/gacha_record/api/getGachaLog", type_key: "gacha_type",
        pools: &["11", "12", "1", "2", "21", "22"], log_dir: "miHoYo\\崩坏：星穹铁道\\Player.log", data_names: &["StarRail_Data"] },
    Game { key: "zzz", biz: "nap_cn", url: "https://public-operation-nap.mihoyo.com/common/gacha_record/api/getGachaLog", type_key: "real_gacha_type",
        pools: &["2", "3", "1", "5"], log_dir: "miHoYo\\绝区零\\Player.log", data_names: &["ZenlessZoneZero_Data"] },
];

fn game(key: &str) -> Result<&'static Game, String> {
    GAMES.iter().find(|g| g.key == key || g.biz == key).ok_or_else(|| "不支持的游戏".to_string())
}

const WW_POOLS: [&str; 11] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "12", "13"];
/// 8/9 新旅唤取、12/13 忆旅唤取是后来加的限时卡池：查询失败（没开过 / 接口不认）时跳过，不影响其它卡池
fn ww_optional_pool(pool: &str) -> bool { matches!(pool, "8" | "9" | "12" | "13") }
const WW_API: &str = "https://gmserver-api.aki-game2.com/gacha/record/query";

// ───────────────────────── 小工具 ─────────────────────────

fn s(v: &Value, k: &str) -> String {
    match &v[k] { Value::String(x) => x.clone(), Value::Number(n) => n.to_string(), _ => String::new() }
}

fn now_ts() -> u64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) }

fn hex(b: &[u8]) -> String { b.iter().map(|x| format!("{x:02x}")).collect() }

fn rand_alnum(n: usize) -> String {
    const C: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let mut out = String::new();
    while out.len() < n {
        for b in uuid::Uuid::new_v4().as_bytes() { if out.len() < n { out.push(C[(*b as usize) % C.len()] as char); } }
    }
    out
}

fn ds1(salt: &str) -> String {
    let t = now_ts();
    let r = rand_alnum(6);
    format!("{t},{r},{}", hex(&crate::pdf_crypt::md5(format!("salt={salt}&t={t}&r={r}").as_bytes())))
}

fn ds2(salt: &str, body: &str, query: &str) -> String {
    let t = now_ts();
    let r = 100001 + (uuid::Uuid::new_v4().as_u128() % 99999) as u64;
    format!("{t},{r},{}", hex(&crate::pdf_crypt::md5(format!("salt={salt}&t={t}&r={r}&b={body}&q={query}").as_bytes())))
}

fn enc(v: &str) -> String {
    let mut o = String::new();
    for b in v.bytes() {
        if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { o.push(b as char) } else { o.push_str(&format!("%{b:02X}")) }
    }
    o
}

/// 发请求（系统 curl，直连）。返回解析后的 JSON。
fn http(method: &str, url: &str, headers: &[(&str, String)], body: Option<&str>) -> Result<Value, String> {
    let exe = crate::owned_tasks::system_tool("curl.exe").unwrap_or_else(|_| "curl".into());
    let mut cmd = Command::new(exe);
    cmd.args(["-sS", "--compressed", "--noproxy", "*", "--max-time", "25", "-X", method]);
    for (k, v) in headers { cmd.arg("-H").arg(format!("{k}: {v}")); }
    if body.is_some() { cmd.args(["--data-binary", "@-"]); }
    cmd.arg(url).stdin(if body.is_some() { Stdio::piped() } else { Stdio::null() }).stdout(Stdio::piped()).stderr(Stdio::piped());
    crate::commands::no_window(&mut cmd);
    let mut child = cmd.spawn().map_err(|e| format!("调用 curl 失败：{e}"))?;
    if let (Some(b), Some(mut stdin)) = (body, child.stdin.take()) { let _ = stdin.write_all(b.as_bytes()); }
    let out = child.wait_with_output().map_err(|e| format!("网络请求失败：{e}"))?;
    if !out.status.success() {
        return Err(format!("网络连接失败：{}", String::from_utf8_lossy(&out.stderr).trim()));
    }
    let text = String::from_utf8_lossy(&out.stdout).to_string();
    serde_json::from_str(&text).map_err(|_| format!("服务器返回内容异常：{}", text.chars().take(120).collect::<String>()))
}

fn mihoyo_error(v: &Value, action: &str) -> String {
    let code = v["retcode"].as_i64().unwrap_or(-1);
    let msg = v["message"].as_str().unwrap_or("");
    match code {
        -100 | -1071 | 10001 | -10001 => "米游社登录已失效，请重新扫码登录".into(),
        -101 => "抽卡记录凭证已过期：请重新获取（扫码账号会自动重新生成；用游戏缓存的需要再到游戏里打开一次抽卡记录）".into(),
        -110 => "请求太频繁，请稍等一会儿再试".into(),
        -3501 | -3505 => "二维码已过期，请刷新".into(),
        _ => format!("{action}失败：{msg}（{code}）"),
    }
}

fn is_authkey_error(v: &Value) -> bool {
    let code = v["retcode"].as_i64().unwrap_or(0);
    let msg = v["message"].as_str().unwrap_or("").to_lowercase();
    code == -101 || msg.contains("authkey") || msg.contains("auth key")
}

/// 抽卡记录接口的报错：这里的 -100 / -1 指的是链接里的 authkey，不是米游社登录。
fn gacha_log_error(v: &Value, source: &str, game: &str) -> String {
    let code = v["retcode"].as_i64().unwrap_or(-1);
    let msg = v["message"].as_str().unwrap_or("").to_lowercase();
    if code == -110 { return "请求太频繁，请稍等一会儿再试".into(); }
    if is_authkey_error(v) {
        let expired = code == -101 || msg.contains("time") || msg.contains("expire");
        return match (expired, source) {
            (_, "account") => "官方拒绝了用米游社账号生成的抽卡凭证（重新登录通常没用）。请改用「读取游戏缓存」：先在游戏里打开一次抽卡历史记录页面再读取；或者粘贴抽卡记录链接".into(),
            (_, "account_starrail") => "星穹铁道目前不接受用米游社账号生成的抽卡凭证（官方限制，重新扫码登录也没用；原神、绝区零不受影响）。请先在游戏里打开一次「跃迁」页面里的「跃迁记录」，再点「读取游戏缓存」；或者粘贴跃迁记录链接".into(),
            (true, "cache") => match game {
                "genshin" => "游戏缓存里的祈愿记录链接已过期（约 24 小时有效）：请再到游戏里打开一次「祈愿」→「历史记录」，然后重新读取".into(),
                "starrail" => "游戏缓存里的跃迁记录链接已过期（约 24 小时有效）：请再到游戏里打开一次「跃迁」→「跃迁记录」，然后重新读取".into(),
                "zzz" => "游戏缓存里的调频记录链接已过期（约 24 小时有效）：请再到游戏里打开一次「调频」→「调频记录」，然后重新读取".into(),
                _ => "游戏缓存里的抽卡链接已过期（约 24 小时有效）：请再到游戏里打开一次抽卡「历史记录」页面，然后重新读取".into(),
            },
            (true, _) => "这个抽卡链接已过期（约 24 小时有效），请重新复制一个新的链接".into(),
            (false, _) => "抽卡链接无效：请复制完整的抽卡记录链接（需要包含 authkey）".into(),
        };
    }
    if code == -111 || msg.contains("game name") { return "链接和所选游戏不匹配，请检查是不是复制了别的游戏的链接".into(); }
    mihoyo_error(v, "获取抽卡记录")
}

// ───────────────────────── 存储 ─────────────────────────

fn gdir(app: &tauri::AppHandle) -> PathBuf {
    let d = crate::jobs::storage_dir_of(app).join("gacha");
    let _ = std::fs::create_dir_all(&d);
    d
}

fn record_path(app: &tauri::AppHandle, game: &str, uid: &str) -> Result<PathBuf, String> {
    if uid.is_empty() || !uid.chars().all(|c| c.is_ascii_alphanumeric()) { return Err("UID 无效".into()); }
    if !["genshin", "starrail", "zzz", "ww"].contains(&game) { return Err("不支持的游戏".into()); }
    let d = gdir(app).join(game);
    std::fs::create_dir_all(&d).map_err(|e| e.to_string())?;
    Ok(d.join(format!("{uid}.json")))
}

fn load_records(app: &tauri::AppHandle, game: &str, uid: &str) -> Value {
    record_path(app, game, uid).ok().and_then(|p| std::fs::read_to_string(p).ok()).and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_else(|| json!({"game": game, "uid": uid, "list": []}))
}

fn save_records(app: &tauri::AppHandle, game: &str, uid: &str, doc: &Value) -> Result<(), String> {
    let p = record_path(app, game, uid)?;
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec(doc).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, &p).map_err(|e| e.to_string())
}

// Analysis annotations are separate from raw/UIGF records, so a sync/import cannot erase them.
// Namespaces: game -> UID -> pool -> exact record / banner ID. Never a global off-banner roster.
static ANALYSIS_LOCK: Mutex<()> = Mutex::new(());

fn analysis_path(app: &tauri::AppHandle, game: &str, uid: &str) -> Result<PathBuf, String> {
    record_path(app, game, uid)?; // Existing game/UID path validation.
    Ok(gdir(app).join("analysis").join(game).join(format!("{uid}.json")))
}

fn load_analysis(app: &tauri::AppHandle, game: &str, uid: &str) -> Result<Value, String> {
    let p = analysis_path(app, game, uid)?;
    match std::fs::read(&p) {
        Ok(bytes) => {
            let value: Value = serde_json::from_slice(&bytes).map_err(|_| "分析设置文件损坏，已停止判定；请保留文件并从备份恢复".to_string())?;
            if value["schema"] != 1 || !value["overrides"].is_object() || !value["banners"].is_object() {
                return Err("分析设置格式不支持，未覆盖原文件".into());
            }
            Ok(value)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(json!({"schema":1,"overrides":{},"banners":{}})),
        Err(e) => Err(format!("读取分析设置失败：{e}")),
    }
}

fn set_analysis(app: &tauri::AppHandle, args: &Value) -> Result<Value, String> {
    let _guard = ANALYSIS_LOCK.lock().map_err(|_| "分析设置正在使用，请稍后重试")?;
    let game = s(args, "game");
    let uid = s(args, "uid");
    let p = analysis_path(app, &game, &uid)?;
    let mut doc = load_analysis(app, &game, &uid)?;
    let raw = load_records(app, &game, &uid);
    let list = raw["list"].as_array().ok_or("当前账号没有可核对记录")?;
    update_analysis(&mut doc, &game, list, args)?;
    std::fs::create_dir_all(p.parent().ok_or("分析设置目录无效")?).map_err(|e| e.to_string())?;
    let tmp = p.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec(&doc).map_err(|e| e.to_string())?).map_err(|e| format!("保存分析设置失败：{e}"))?;
    std::fs::rename(&tmp, &p).map_err(|e| format!("提交分析设置失败：{e}"))?;
    Ok(doc)
}

fn update_analysis(doc: &mut Value, game: &str, list: &[Value], args: &Value) -> Result<(), String> {
    let record = args.get("record");
    let banner = args.get("banner");
    if record.is_some() == banner.is_some() { return Err("每次只能修改一条结果或一个卡池期次".into()); }
    let patch = record.or(banner).ok_or("缺少判定设置")?;
    let pool = s(patch, "pool");
    let id = s(patch, "id");
    let valid_pool = match game {
        "genshin" => ["301", "302"].contains(&pool.as_str()),
        "starrail" => ["11", "12", "21", "22"].contains(&pool.as_str()),
        "zzz" => ["2", "3"].contains(&pool.as_str()),
        "ww" => pool == "1",
        _ => false,
    };
    if !valid_pool || id.is_empty() || id.len() > 128 || id.contains(':') { return Err("卡池或记录标识无效".into()); }
    let key = format!("{pool}:{id}");
    if record.is_some() {
        let top = if game == "zzz" { "4" } else { "5" };
        if !list.iter().any(|r| s(r,"_pool")==pool && s(r,"id")==id && s(r,"rank_type")==top) {
            return Err("没有找到当前账号的这条出金记录，未保存".into());
        }
        let value = s(patch, "value");
        if value == "auto" {
            if let Some(o) = doc["overrides"].as_object_mut() { o.remove(&key); }
        } else if ["up", "off", "unknown"].contains(&value.as_str()) {
            doc["overrides"][&key] = json!(value);
        } else { return Err("判定结果无效".into()); }
    } else {
        if id == "0" || !id.chars().all(|c| c.is_ascii_digit()) || !list.iter().any(|r| s(r,"_pool")==pool && s(r,"gacha_id")==id) {
            return Err("当前账号的记录中没有这个具体卡池期次，未保存".into());
        }
        let names = patch["upNames"].as_array().ok_or("UP 名称格式无效")?;
        if names.len() > 16 || names.iter().any(|n| n.as_str().map(|v| v.trim().is_empty() || v.chars().count()>80).unwrap_or(true)) {
            return Err("请填写有效的当期 UP 名称".into());
        }
        if names.is_empty() {
            if let Some(o) = doc["banners"].as_object_mut() { o.remove(&key); }
        } else { doc["banners"][&key] = json!({"upNames":names}); }
    }
    Ok(())
}

/// 记录 id 是纯数字字符串，先比长度再比字典序 = 按数值比较
fn id_cmp(a: &str, b: &str) -> std::cmp::Ordering { a.len().cmp(&b.len()).then_with(|| a.cmp(b)) }

fn sort_records(list: &mut [Value]) {
    list.sort_by(|a, b| id_cmp(&s(a, "id"), &s(b, "id")).then_with(|| s(a, "time").cmp(&s(b, "time"))));
}

// ── 凭证（DPAPI 加密）──

#[cfg(windows)]
mod dpapi {
    use std::ffi::c_void;
    #[repr(C)]
    struct Blob { cb: u32, pb: *mut u8 }
    #[link(name = "crypt32")]
    extern "system" {
        fn CryptProtectData(input: *const Blob, desc: *const u16, entropy: *const Blob, reserved: *mut c_void, prompt: *mut c_void, flags: u32, out: *mut Blob) -> i32;
        fn CryptUnprotectData(input: *const Blob, desc: *mut *mut u16, entropy: *const Blob, reserved: *mut c_void, prompt: *mut c_void, flags: u32, out: *mut Blob) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" { fn LocalFree(h: *mut c_void) -> *mut c_void; }
    const UI_FORBIDDEN: u32 = 1;
    fn run(data: &[u8], protect: bool) -> Option<Vec<u8>> {
        let mut buf = data.to_vec();
        let input = Blob { cb: buf.len() as u32, pb: buf.as_mut_ptr() };
        let mut out = Blob { cb: 0, pb: std::ptr::null_mut() };
        let ok = unsafe {
            if protect { CryptProtectData(&input, std::ptr::null(), std::ptr::null(), std::ptr::null_mut(), std::ptr::null_mut(), UI_FORBIDDEN, &mut out) }
            else { CryptUnprotectData(&input, std::ptr::null_mut(), std::ptr::null(), std::ptr::null_mut(), std::ptr::null_mut(), UI_FORBIDDEN, &mut out) }
        };
        if ok == 0 || out.pb.is_null() { return None; }
        let v = unsafe { std::slice::from_raw_parts(out.pb, out.cb as usize).to_vec() };
        unsafe { LocalFree(out.pb as *mut c_void); }
        Some(v)
    }
    pub fn protect(d: &[u8]) -> Option<Vec<u8>> { run(d, true) }
    pub fn unprotect(d: &[u8]) -> Option<Vec<u8>> { run(d, false) }
}
#[cfg(not(windows))]
mod dpapi {
    pub fn protect(d: &[u8]) -> Option<Vec<u8>> { Some(d.to_vec()) }
    pub fn unprotect(d: &[u8]) -> Option<Vec<u8>> { Some(d.to_vec()) }
}

fn cred_path(app: &tauri::AppHandle, game: Option<&str>) -> PathBuf {
    if let Some(g) = game {
        let g = g.trim().to_lowercase();
        if !g.is_empty() && g != "all" {
            let specific = gdir(app).join(format!("account_{g}.bin"));
            if specific.is_file() {
                return specific;
            }
        }
    }
    gdir(app).join("account.bin")
}

fn load_cred_file(p: &Path) -> Option<Value> {
    let raw = std::fs::read(p).ok()?;
    let mut val: Value = serde_json::from_slice(&dpapi::unprotect(&raw)?).ok()?;
    let is_dedicated = p.file_name().and_then(|f| f.to_str()).map(|f| f.starts_with("account_")).unwrap_or(false);
    val["isDedicated"] = json!(is_dedicated);
    if let Some(o) = val.as_object_mut() { o.remove("_src"); }
    Some(val)
}

/// 优先用本游戏专属凭证，其次共享凭证；都没有时沿用其它游戏专属登录的同一张米哈游通行证
///（只要它名下有这个游戏的角色），玩家不用为每个游戏重复登录。借用的凭证按共享显示，写回时写回原文件。
fn load_cred(app: &tauri::AppHandle, game: Option<&str>) -> Option<Value> {
    let path = cred_path(app, game);
    if let Some(mut v) = load_cred_file(&path) {
        v["_src"] = json!(path.file_name()?.to_string_lossy());
        return Some(v);
    }
    let g = game.map(|g| g.trim().to_lowercase()).unwrap_or_default();
    let mut found: Vec<(std::time::SystemTime, Value)> = Vec::new();
    for e in std::fs::read_dir(gdir(app)).ok()?.flatten() {
        let name = e.file_name().to_string_lossy().into_owned();
        if !(name.starts_with("account_") && name.ends_with(".bin")) { continue; }
        let Some(mut v) = load_cred_file(&e.path()) else { continue };
        let usable = g.is_empty() || g == "all" || v["roles"][g.as_str()].as_array().map(|a| !a.is_empty()).unwrap_or(true);
        if !usable { continue; }
        v["isDedicated"] = json!(false);
        v["_src"] = json!(name);
        let t = e.metadata().and_then(|m| m.modified()).unwrap_or(std::time::UNIX_EPOCH);
        found.push((t, v));
    }
    found.sort_by(|a, b| b.0.cmp(&a.0));
    found.into_iter().next().map(|(_, v)| v)
}

fn credential_has_role(cred: &Value, game: &str, uid: &str) -> bool {
    !uid.is_empty() && cred["roles"][game].as_array().map(|roles| roles.iter().any(|role| s(role, "uid") == uid)).unwrap_or(false)
}

fn archive_cred(dir: &Path, cred: &Value, scope: &str) -> Result<(), String> {
    let aid = s(cred, "aid");
    if aid.is_empty() || !aid.chars().all(|c| c.is_ascii_digit()) { return Err("通行证编号无效，无法保存凭据".into()); }
    if !["all", "genshin", "starrail", "zzz"].contains(&scope) { return Err("凭据范围无效".into()); }
    let mut clean = cred.clone();
    if let Some(o) = clean.as_object_mut() { o.remove("_src"); o.remove("_archive"); o.remove("isDedicated"); }
    clean["_scope"] = json!(scope);
    let data = dpapi::protect(&serde_json::to_vec(&clean).map_err(|e| e.to_string())?).ok_or("保存登录凭证失败（系统加密不可用）")?;
    let archives = dir.join("passports");
    std::fs::create_dir_all(&archives).map_err(|e| e.to_string())?;
    std::fs::write(archives.join(format!("passport_{aid}_{scope}.bin")), data).map_err(|e| e.to_string())
}

fn load_cred_for_uid(app: &tauri::AppHandle, game: &str, uid: &str) -> Option<Value> {
    load_cred_for_uid_in(&gdir(app), game, uid)
}

fn load_cred_for_uid_in(dir: &Path, game: &str, uid: &str) -> Option<Value> {
    let mut candidates = Vec::new();
    for (directory, archived) in [(dir.to_path_buf(), false), (dir.join("passports"), true)] {
        let Ok(entries) = std::fs::read_dir(directory) else { continue };
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !(name.ends_with(".bin") && (name == "account.bin" || name.starts_with("account_") || (archived && name.starts_with("passport_")))) { continue; }
            let Some(mut cred) = load_cred_file(&entry.path()) else { continue };
            if !credential_has_role(&cred, game, uid) { continue; }
            if archived { cred["_archive"] = json!(name); cred["isDedicated"] = json!(s(&cred, "_scope") == game); }
            else { cred["isDedicated"] = json!(name == format!("account_{game}.bin")); cred["_src"] = json!(name); }
            candidates.push(cred);
        }
    }
    candidates.sort_by_key(|c| std::cmp::Reverse(c["loginAt"].as_u64().unwrap_or(0)));
    candidates.into_iter().next()
}

fn save_cred(app: &tauri::AppHandle, game: Option<&str>, v: &Value) -> Result<(), String> {
    if v["_archive"].as_str().is_some() { return archive_cred(&gdir(app), v, &s(v, "_scope")); }
    // 借用来的凭证（见 load_cred）写回它原来的文件，不另外生成一份专属凭证
    if let Some(src) = v["_src"].as_str().filter(|n| (*n == "account.bin" || n.starts_with("account_")) && n.ends_with(".bin") && !n.contains(['/', '\\'])) {
        let mut clean = v.clone();
        if let Some(o) = clean.as_object_mut() { o.remove("_src"); o.remove("isDedicated"); }
        let data = dpapi::protect(&serde_json::to_vec(&clean).map_err(|e| e.to_string())?)
            .ok_or("保存登录凭证失败（系统加密不可用）")?;
        let scope = src.strip_prefix("account_").and_then(|n| n.strip_suffix(".bin")).unwrap_or("all");
        archive_cred(&gdir(app), &clean, scope)?;
        return std::fs::write(gdir(app).join(src), data).map_err(|e| e.to_string());
    }
    let p = match game {
        Some(g) if !g.trim().is_empty() && g.trim().to_lowercase() != "all" => {
            gdir(app).join(format!("account_{}.bin", g.trim().to_lowercase()))
        }
        _ => gdir(app).join("account.bin"),
    };
    let scope = game.filter(|g| !g.is_empty() && *g != "all").unwrap_or("all");
    if let Some(previous) = load_cred_file(&p) { archive_cred(&gdir(app), &previous, scope)?; }
    archive_cred(&gdir(app), v, scope)?;
    let data = dpapi::protect(&serde_json::to_vec(v).map_err(|e| e.to_string())?)
        .ok_or("保存登录凭证失败（系统加密不可用）")?;
    std::fs::write(p, data).map_err(|e| e.to_string())
}

fn b64_encode(bytes: &[u8]) -> String {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((bytes.len() + 2) / 3 * 4);
    for chunk in bytes.chunks(3) {
        let b0 = chunk[0] as usize;
        let b1 = chunk.get(1).copied().unwrap_or(0) as usize;
        let b2 = chunk.get(2).copied().unwrap_or(0) as usize;
        let triple = (b0 << 16) | (b1 << 8) | b2;
        out.push(TABLE[(triple >> 18) & 0x3f] as char);
        out.push(TABLE[(triple >> 12) & 0x3f] as char);
        if chunk.len() > 1 {
            out.push(TABLE[(triple >> 6) & 0x3f] as char);
        } else {
            out.push('=');
        }
        if chunk.len() > 2 {
            out.push(TABLE[triple & 0x3f] as char);
        } else {
            out.push('=');
        }
    }
    out
}

fn rsa_encrypt(text: &str) -> Result<String, String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        let clean_text: String = text.chars().filter(|c| c.is_ascii_digit() || *c == '+').collect();
        let script = format!(
            "$m=[Convert]::FromBase64String('w73pHTzBzdwGIZv75LSU/mCa+3COQ3LDSqnbMeQ2V9IA7lhbiI83cAbrayGDzZkSdRvMmwyBe6A1tnhKZubDGy/c7PRMVwnb6q5+dahC26o9F8bTEyKWghxUiOdD3z6UxVfV7f4ZslcKJKDlxZQBIAp/kAoBrOdmxaGDLcovsRE=');             $p=New-Object System.Security.Cryptography.RSAParameters;             $p.Modulus=$m;$p.Exponent=[byte[]](1,0,1);             $rsa=[System.Security.Cryptography.RSA]::Create();             $rsa.ImportParameters($p);             $bytes=[System.Text.Encoding]::UTF8.GetBytes('{clean_text}');             $enc=$rsa.Encrypt($bytes,[System.Security.Cryptography.RSAEncryptionPadding]::Pkcs1);             [Convert]::ToBase64String($enc)"
        );
        let utf16: Vec<u8> = script.encode_utf16().flat_map(|u| u.to_le_bytes()).collect();
        let b64 = b64_encode(&utf16);
        let out = Command::new("powershell")
            .args(["-NoProfile", "-NonInteractive", "-EncodedCommand", &b64])
            .creation_flags(CREATE_NO_WINDOW)
            .output()
            .map_err(|e| format!("RSA 加密调用失败：{e}"))?;
        let res: String = String::from_utf8_lossy(&out.stdout)
            .lines()
            .map(|l| l.trim())
            .filter(|l| !l.starts_with('#') && !l.starts_with('<') && !l.is_empty())
            .collect();
        if res.is_empty() {
            let err = String::from_utf8_lossy(&out.stderr);
            return Err(format!("RSA 加密失败：{err}"));
        }
        Ok(res)
    }
    #[cfg(not(windows))]
    {
        Err("RSA 加密仅支持 Windows 环境".into())
    }
}

fn sms_send(app: &tauri::AppHandle, mobile: &str) -> Result<Value, String> {
    let mobile = mobile.trim();
    if mobile.len() != 11 || !mobile.chars().all(|c| c.is_ascii_digit()) {
        return Err("请输入正确的11位中国大陆手机号".into());
    }
    let dev = device_id(app);
    let enc_area = rsa_encrypt("+86")?;
    let enc_mobile = rsa_encrypt(mobile)?;
    let body = json!({
        "area_code": enc_area,
        "mobile": enc_mobile
    }).to_string();

    let headers = vec![
        ("User-Agent", "Mozilla/5.0 miHoYoBBS/2.90.1 Capture/2.2.0".to_string()),
        ("x-rpc-app_id", "bll8iq97cem8".to_string()),
        ("x-rpc-client_type", "2".to_string()),
        ("x-rpc-device_id", dev),
        ("Referer", "https://user.miyoushe.com/".to_string()),
        ("x-rpc-game_biz", "hk4e_cn".to_string()),
        ("Content-Type", "application/json".to_string()),
        ("Accept", "application/json".to_string()),
    ];

    let v = http("POST", "https://passport-api.mihoyo.com/account/ma-cn-verifier/verifier/createLoginCaptcha", &headers, Some(&body))?;
    if v["retcode"].as_i64() != Some(0) {
        return Err(mihoyo_error(&v, "发送短信验证码"));
    }
    let d = &v["data"];
    Ok(json!({
        "ok": true,
        "action_type": s(d, "action_type"),
        "countdown": d["countdown"].as_i64().unwrap_or(60)
    }))
}

fn sms_login(app: &tauri::AppHandle, mobile: &str, code: &str, action_type: &str, game: Option<&str>) -> Result<Value, String> {
    let mobile = mobile.trim();
    let code = code.trim();
    if mobile.len() != 11 {
        return Err("手机号格式不正确".into());
    }
    if code.len() < 4 || code.len() > 8 {
        return Err("请输入收到的短信验证码".into());
    }
    let action = if action_type.trim().is_empty() {
        "login_by_mobile_captcha"
    } else {
        action_type.trim()
    };
    let dev = device_id(app);
    let enc_area = rsa_encrypt("+86")?;
    let enc_mobile = rsa_encrypt(mobile)?;
    let body = json!({
        "area_code": enc_area,
        "mobile": enc_mobile,
        "action_type": action,
        "captcha": code
    }).to_string();

    let headers = vec![
        ("User-Agent", "Mozilla/5.0 miHoYoBBS/2.90.1 Capture/2.2.0".to_string()),
        ("x-rpc-app_id", "bll8iq97cem8".to_string()),
        ("x-rpc-client_type", "2".to_string()),
        ("x-rpc-device_id", dev.clone()),
        ("Referer", "https://user.miyoushe.com/".to_string()),
        ("Content-Type", "application/json".to_string()),
        ("Accept", "application/json".to_string()),
    ];

    let v = http("POST", "https://passport-api.mihoyo.com/account/ma-cn-passport/app/loginByMobileCaptcha", &headers, Some(&body))?;
    if v["retcode"].as_i64() != Some(0) {
        return Err(mihoyo_error(&v, "短信登录"));
    }
    let d = &v["data"];
    let token = s(&d["token"], "token");
    let info = &d["user_info"];
    let aid = { let a = s(info, "aid"); if a.is_empty() { s(info, "account_id") } else { a } };
    let mid = s(info, "mid");
    if token.is_empty() || aid.is_empty() {
        return Err("登录成功，但未返回通行证凭据，请重试".into());
    }
    let mut cred = json!({"stoken": token, "mid": mid, "aid": aid, "loginAt": now_ts()});
    exchange_tokens(&dev, &mut cred);
    save_cred(app, game, &cred)?;
    authkeys().lock().map(|mut m| m.clear()).ok();
    let roles = refresh_roles(app, game).unwrap_or_else(|_| json!({}));
    Ok(json!({"ok": true, "account": account_summary(app, game), "roles": roles}))
}

fn device_id(app: &tauri::AppHandle) -> String {
    let p = gdir(app).join("device.txt");
    if let Ok(t) = std::fs::read_to_string(&p) { let t = t.trim().to_string(); if t.len() >= 32 { return t; } }
    let id = uuid::Uuid::new_v4().to_string();
    let _ = std::fs::write(&p, &id);
    id
}

fn pass_headers(dev: &str) -> Vec<(&'static str, String)> {
    vec![("x-rpc-app_id", PASS_APP_ID.into()), ("x-rpc-client_type", PASS_CLIENT_TYPE.into()), ("User-Agent", PASS_UA.into()),
         ("x-rpc-device_id", dev.into()), ("Accept", "application/json".into()), ("Content-Type", "application/json".into())]
}

fn cookie_stoken(c: &Value) -> String { format!("stuid={};stoken={};mid={}", s(c, "aid"), s(c, "stoken"), s(c, "mid")) }

fn cookie_full(c: &Value) -> String {
    let (aid, mid) = (s(c, "aid"), s(c, "mid"));
    let mut v = format!("stuid={aid}; stoken={}; mid={mid}; ltuid={aid}; ltuid_v2={aid}; account_id={aid}; account_id_v2={aid}; ltmid_v2={mid}; account_mid_v2={mid}", s(c, "stoken"));
    let ct = s(c, "ctoken");
    if !ct.is_empty() { v.push_str(&format!("; cookie_token={ct}; cookie_token_v2={ct}")); }
    let lt = s(c, "ltoken");
    if !lt.is_empty() { v.push_str(&format!("; ltoken={lt}; ltoken_v2={lt}")); }
    v
}

fn bbs_headers(c: &Value, dev: &str, ds: String) -> Vec<(&'static str, String)> {
    vec![("Cookie", cookie_full(c)), ("User-Agent", bbs_ua()), ("Referer", "https://webstatic.mihoyo.com/".into()), ("Origin", "https://webstatic.mihoyo.com".into()),
         ("X-Requested-With", "com.mihoyo.hyperion".into()), ("x-rpc-app_version", BBS_VERSION.into()), ("x-rpc-client_type", "5".into()),
         ("x-rpc-device_id", dev.into()), ("Accept", "application/json, text/plain, */*".into()), ("Content-Type", "application/json; charset=utf-8".into()), ("DS", ds)]
}

// ───────────────────────── 扫码登录 ─────────────────────────

fn qr_create(app: &tauri::AppHandle) -> Result<Value, String> {
    let dev = device_id(app);
    let v = http("POST", &format!("{PASSPORT}/account/ma-cn-passport/app/createQRLogin"), &pass_headers(&dev), Some("{}"))?;
    if v["retcode"].as_i64() != Some(0) { return Err(mihoyo_error(&v, "生成二维码")); }
    let url = s(&v["data"], "url");
    let expire = url::Url::parse(&url).ok().and_then(|u| u.query_pairs().find(|(k, _)| k == "expire").and_then(|(_, x)| x.parse::<u64>().ok()));
    Ok(json!({"url": url, "ticket": s(&v["data"], "ticket"), "expire": expire, "now": now_ts()}))
}

fn qr_query(app: &tauri::AppHandle, ticket: &str, game: Option<&str>) -> Result<Value, String> {
    if ticket.is_empty() { return Err("缺少二维码编号".into()); }
    let dev = device_id(app);
    let v = http("POST", &format!("{PASSPORT}/account/ma-cn-passport/app/queryQRLoginStatus"), &pass_headers(&dev), Some(&json!({"ticket": ticket}).to_string()))?;
    match v["retcode"].as_i64() {
        Some(0) => {}
        Some(-3501) | Some(-3505) => return Ok(json!({"status": "Expired"})),
        _ => return Ok(json!({"status": "Expired", "message": mihoyo_error(&v, "扫码登录")})),
    }
    let d = &v["data"];
    let status = s(d, "status");
    if status != "Confirmed" { return Ok(json!({"status": if status.is_empty() { "Created".to_string() } else { status }})); }
    let tokens = d["tokens"].as_array().cloned().unwrap_or_default();
    let stoken = tokens.iter().find(|t| t["token_type"].as_i64() == Some(1)).or_else(|| tokens.first()).map(|t| s(t, "token")).unwrap_or_default();
    let info = &d["user_info"];
    let aid = { let a = s(info, "aid"); if a.is_empty() { s(info, "account_id") } else { a } };
    let mid = s(info, "mid");
    if stoken.is_empty() || aid.is_empty() { return Err("扫码成功，但没有拿到登录凭证，请重试".into()); }
    let mut cred = json!({"stoken": stoken, "mid": mid, "aid": aid, "loginAt": now_ts()});
    exchange_tokens(&dev, &mut cred);
    save_cred(app, game, &cred)?;
    authkeys().lock().map(|mut m| m.clear()).ok();
    let roles = refresh_roles(app, game).unwrap_or_else(|_| json!({}));
    Ok(json!({"status": "Confirmed", "account": account_summary(app, game), "roles": roles}))
}

/// stoken → cookie_token / ltoken（查角色要用）；失败不致命
fn exchange_tokens(dev: &str, cred: &mut Value) {
    let mut h = pass_headers(dev);
    h.push(("Cookie", cookie_stoken(cred)));
    if let Ok(v) = http("GET", &format!("{PASSPORT}/account/auth/api/getCookieAccountInfoBySToken"), &h, None) {
        let t = s(&v["data"], "cookie_token");
        if !t.is_empty() { cred["ctoken"] = json!(t); }
    }
    if let Ok(v) = http("GET", &format!("{PASSPORT}/account/auth/api/getLTokenBySToken"), &h, None) {
        let t = s(&v["data"], "ltoken");
        if !t.is_empty() { cred["ltoken"] = json!(t); }
    }
}

fn mask(id: &str) -> String {
    let n = id.chars().count();
    if n <= 4 { return id.to_string(); }
    let head: String = id.chars().take(2).collect();
    let tail: String = id.chars().skip(n - 2).collect();
    format!("{head}{}{tail}", "*".repeat(n - 4))
}

fn account_summary(app: &tauri::AppHandle, game: Option<&str>) -> Value {
    account_summary_for_uid(app, game, None)
}

fn account_summary_for_uid(app: &tauri::AppHandle, game: Option<&str>, uid: Option<&str>) -> Value {
    let cred = match (game, uid.filter(|u| !u.is_empty())) {
        (Some(g), Some(u)) => load_cred_for_uid(app, g, u),
        _ => load_cred(app, game),
    };
    match cred {
        Some(c) => json!({
            "loggedIn": true,
            "aid": mask(&s(&c, "aid")),
            "loginAt": c["loginAt"],
            "roles": c["roles"].clone(),
            "isDedicated": c["isDedicated"].as_bool().unwrap_or(false),
            "game": game.unwrap_or("all")
        }),
        None => json!({
            "loggedIn": false,
            "game": game.unwrap_or("all")
        }),
    }
}

fn refresh_roles(app: &tauri::AppHandle, game: Option<&str>) -> Result<Value, String> {
    refresh_roles_for_uid(app, game, None)
}

fn refresh_roles_for_uid(app: &tauri::AppHandle, game: Option<&str>, uid: Option<&str>) -> Result<Value, String> {
    let mut cred = match (game, uid.filter(|u| !u.is_empty())) {
        (Some(g), Some(u)) => load_cred_for_uid(app, g, u),
        _ => load_cred(app, game),
    }.ok_or("所选账号没有可用的登录凭据，请扫描该账号的米游社二维码，或从对应游戏账号重新获取记录链接")?;
    let dev = device_id(app);
    let mut roles = cred["roles"].as_object().cloned().unwrap_or_default();
    let mut fetched = false;
    let mut last_err = None;
    for g in GAMES.iter() {
        let q = format!("game_biz={}", g.biz);
        let endpoint = format!("https://api-takumi.mihoyo.com/binding/api/getUserGameRolesByCookie?{q}");
        let mut v = match http("GET", &endpoint, &bbs_headers(&cred, &dev, ds2(SALT_X4, "", &q)), None) {
            Ok(v) => v,
            Err(e) => { last_err = Some(e); continue; }
        };
        if v["retcode"].as_i64() == Some(-100) {
            exchange_tokens(&dev, &mut cred);
            v = match http("GET", &endpoint, &bbs_headers(&cred, &dev, ds2(SALT_X4, "", &q)), None) {
                Ok(v) => v,
                Err(e) => { last_err = Some(e); continue; }
            };
        }
        if v["retcode"].as_i64() != Some(0) {
            last_err = Some(mihoyo_error(&v, "获取游戏角色"));
            continue;
        }
        let list: Vec<Value> = v["data"]["list"].as_array().cloned().unwrap_or_default().iter()
            .map(|r| json!({"uid": s(r, "game_uid"), "region": s(r, "region"), "nickname": s(r, "nickname"), "level": r["level"], "regionName": s(r, "region_name")}))
            .collect();
        roles.insert(g.key.into(), Value::Array(list));
        fetched = true;
    }
    if !fetched { return Err(last_err.unwrap_or_else(|| "登录凭据已失效，请重新扫描该通行证的米游社二维码".into())); }
    cred["roles"] = Value::Object(roles.clone());
    save_cred(app, game, &cred)?;
    Ok(Value::Object(roles))
}

fn authkeys() -> &'static Mutex<HashMap<String, (String, Instant)>> {
    static M: std::sync::OnceLock<Mutex<HashMap<String, (String, Instant)>>> = std::sync::OnceLock::new();
    M.get_or_init(|| Mutex::new(HashMap::new()))
}

fn gen_authkey(app: &tauri::AppHandle, g: &Game, uid: &str) -> Result<(String, String), String> {
    let cred = load_cred_for_uid(app, g.key, uid).ok_or("所选账号没有可用的登录凭据，请重新扫描该账号的米游社二维码，或从对应游戏账号获取记录链接")?;
    let role = cred["roles"][g.key].as_array().and_then(|l| l.iter().find(|r| s(r, "uid") == uid).cloned())
        .ok_or("这个账号下没有找到该游戏角色，请点「刷新角色」后重试")?;
    let region = s(&role, "region");
    let cache_key = format!("{}:{uid}:{}:{}", g.biz, s(&cred, "aid"), cred["loginAt"]);
    if let Some((k, at)) = authkeys().lock().ok().and_then(|m| m.get(&cache_key).cloned()) {
        if at.elapsed() < Duration::from_secs(3600) { return Ok((k, region)); }
    }
    let body = json!({"auth_appid": "webview_gacha", "game_biz": g.biz, "game_uid": uid.parse::<u64>().unwrap_or(0), "region": region}).to_string();
    let dev = device_id(app);
    let v = http("POST", "https://api-takumi.miyoushe.com/binding/api/genAuthKey", &bbs_headers(&cred, &dev, ds1(SALT_LK2)), Some(&body))?;
    if v["retcode"].as_i64() != Some(0) { return Err(mihoyo_error(&v, "生成抽卡记录凭证")); }
    let key = s(&v["data"], "authkey");
    if key.is_empty() { return Err("生成抽卡记录凭证失败：返回为空".into()); }
    if let Ok(mut m) = authkeys().lock() { m.insert(cache_key, (key.clone(), Instant::now())); }
    Ok((key, region))
}

// ───────────────────────── 游戏缓存里的链接 ─────────────────────────

/// 日志里形如 `…E:/Games/Genshin Impact Game/YuanShen_Data/…` 的路径 → 数据目录
pub(crate) fn find_data_dir(log: &str, names: &[&str]) -> Option<PathBuf> {
    let mut found = None;
    for line in log.lines() {
        for name in names {
            let Some(end) = line.find(name) else { continue };
            let head = &line[..end];
            // 往前找盘符 "X:/" 或 "X:\"
            let bytes = head.as_bytes();
            let mut start = None;
            for i in (1..bytes.len()).rev() {
                if bytes[i] == b':' && bytes[i - 1].is_ascii_alphabetic() && bytes.get(i + 1).map(|c| *c == b'/' || *c == b'\\').unwrap_or(false) {
                    start = Some(i - 1);
                    break;
                }
            }
            if let Some(st) = start { found = Some(PathBuf::from(format!("{}{}", &line[st..end], name))); }
        }
    }
    found
}

/// 在缓存二进制里找最后一条带 authkey 的抽卡链接
pub(crate) fn last_gacha_url(data: &[u8], must: &[&str]) -> Option<String> {
    let text = String::from_utf8_lossy(data);
    let mut best = None;
    let mut from = 0;
    while let Some(i) = text[from..].find("https://") {
        let st = from + i;
        let end = text[st..].find(|c: char| c == '\0' || c.is_whitespace() || c == '"' || c == '\u{fffd}').map(|e| st + e).unwrap_or(text.len());
        let u = &text[st..end];
        if u.contains("authkey=") && must.iter().any(|m| u.contains(m)) { best = Some(u.to_string()); }
        from = end.max(st + 8);
        if from >= text.len() { break; }
    }
    best
}

fn locallow() -> PathBuf {
    PathBuf::from(std::env::var("USERPROFILE").unwrap_or_default()).join("AppData").join("LocalLow")
}

fn cache_url_mihoyo(g: &Game) -> Result<String, String> {
    let log_path = locallow().join(g.log_dir);
    let log = std::fs::read(&log_path).map_err(|_| "没找到游戏日志：请先在这台电脑上打开一次游戏".to_string())?;
    let dir = find_data_dir(&String::from_utf8_lossy(&log), g.data_names).ok_or("游戏日志里没找到游戏安装位置，请先打开一次游戏")?;
    let web = dir.join("webCaches");
    let mut vers: Vec<PathBuf> = std::fs::read_dir(&web).map_err(|_| "没找到游戏网页缓存，请先在游戏里打开一次抽卡记录页面")?
        .flatten().map(|e| e.path()).filter(|p| p.is_dir()).collect();
    vers.sort_by_key(|p| std::fs::metadata(p.join("Cache").join("Cache_Data").join("data_2")).and_then(|m| m.modified()).ok());
    let must = ["getGachaLog", "gacha_record", "gacha-v", "webview_gacha"];
    for v in vers.iter().rev() {
        let f = v.join("Cache").join("Cache_Data").join("data_2");
        if let Ok(data) = std::fs::read(&f) {
            if let Some(u) = last_gacha_url(&data, &must) { return Ok(u); }
        }
    }
    Err("游戏缓存里没有抽卡记录链接：请先在游戏里打开一次「抽卡记录 / 历史记录」页面，再回来点获取".into())
}

/// 注册表里记录过的程序路径（MuiCache / 兼容性助手），只读取值的名字（= exe 路径），用来找鸣潮装在哪
#[cfg(windows)]
fn reg_value_names(sub: &str) -> Vec<String> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "advapi32")]
    extern "system" {
        fn RegOpenKeyExW(key: isize, sub: *const u16, opt: u32, access: u32, result: *mut isize) -> i32;
        fn RegEnumValueW(key: isize, index: u32, name: *mut u16, name_len: *mut u32, reserved: *mut u32, typ: *mut u32, data: *mut u8, data_len: *mut u32) -> i32;
        fn RegCloseKey(key: isize) -> i32;
    }
    const HKCU: isize = -2147483647;
    let w: Vec<u16> = std::ffi::OsStr::new(sub).encode_wide().chain(Some(0)).collect();
    let mut out = Vec::new();
    unsafe {
        let mut h = 0isize;
        if RegOpenKeyExW(HKCU, w.as_ptr(), 0, 0x20019, &mut h) != 0 { return out; }
        let mut buf = vec![0u16; 4096];
        for i in 0..50_000u32 {
            let mut len = buf.len() as u32;
            let r = RegEnumValueW(h, i, buf.as_mut_ptr(), &mut len, std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut(), std::ptr::null_mut());
            if r == 259 { break; } // ERROR_NO_MORE_ITEMS
            if r == 0 { out.push(String::from_utf16_lossy(&buf[..len as usize])); }
        }
        RegCloseKey(h);
    }
    out
}
#[cfg(not(windows))]
fn reg_value_names(_sub: &str) -> Vec<String> { Vec::new() }

/// 从系统记录的「运行过的程序」里找鸣潮游戏目录（官方启动器、WeGame、Epic 等装在哪里都能找到，只要在这台电脑上运行过）
fn ww_registry_dirs() -> Vec<PathBuf> {
    let mut v: Vec<PathBuf> = Vec::new();
    for key in [r"Software\Classes\Local Settings\Software\Microsoft\Windows\Shell\MuiCache",
                r"Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Compatibility Assistant\Store"] {
        for name in reg_value_names(key) {
            let lower = name.to_ascii_lowercase();
            let Some(e) = lower.find(".exe") else { continue };
            let exe = &name[..e + 4];
            let exe_l = &lower[..e + 4];
            let dir = if let Some(i) = exe_l.find("\\client\\binaries\\win64\\") {
                Some(PathBuf::from(&exe[..i]))
            } else if exe_l.ends_with("\\wuthering waves.exe") {
                Path::new(exe).parent().map(|p| p.to_path_buf())
            } else if exe_l.ends_with("\\launcher.exe") {
                Path::new(exe).parent().map(|p| p.join("Wuthering Waves Game")).filter(|p| p.is_dir())
            } else { None };
            if let Some(d) = dir { if !v.contains(&d) { v.push(d); } }
        }
    }
    v
}

fn ww_dirs(user_dir: Option<&str>) -> Vec<PathBuf> {
    let mut v = Vec::new();
    if let Some(d) = user_dir.filter(|d| !d.trim().is_empty()) {
        let p = PathBuf::from(d.trim().trim_matches('"'));
        v.push(p.clone());
        v.push(p.join("Wuthering Waves Game"));
    }
    v.extend(ww_registry_dirs());
    for drive in b'C'..=b'H' {
        let root = format!("{}:\\", drive as char);
        if !Path::new(&root).exists() { continue; }
        for sub in ["Wuthering Waves", "鸣潮", "Games\\Wuthering Waves", "Games\\鸣潮", "Program Files\\Wuthering Waves", "Program Files\\鸣潮", "Program Files (x86)\\Wuthering Waves", "KuroGames\\鸣潮", "Kuro Games\\Wuthering Waves", "WeGameApps\\鸣潮", "Program Files\\Epic Games\\WutheringWavesj3oFh"] {
            let p = PathBuf::from(&root).join(sub);
            v.push(p.join("Wuthering Waves Game"));
            v.push(p);
        }
    }
    v
}

/// 一个目录（或用户直接填的日志文件 / Logs 目录）下所有可能含链接的日志：Client.log、轮换出来的 Client-backup-*.log、SDK 网页日志
fn ww_log_files(d: &Path) -> Vec<PathBuf> {
    let mut v = Vec::new();
    if d.is_file() { v.push(d.to_path_buf()); return v; }
    for dir in [d.join("Client").join("Saved").join("Logs"), d.to_path_buf()] {
        let Ok(rd) = std::fs::read_dir(&dir) else { continue };
        for e in rd.flatten() {
            let p = e.path();
            let name = p.file_name().map(|n| n.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
            if name.starts_with("client") && name.ends_with(".log") && p.is_file() { v.push(p); }
        }
    }
    let sdk = d.join("Client").join("Binaries").join("Win64").join("ThirdParty").join("KrPcSdk_Mainland").join("KRSDKRes").join("KRSDKWebView").join("debug.log");
    if sdk.is_file() { v.push(sdk); }
    v
}

/// 3.4 版本起 Client.log 按字节加密：偶数字节异或 0xEF、奇数字节异或 0xA5（对旧版明文日志不做这一步）
fn ww_decrypt(data: &[u8]) -> Vec<u8> {
    data.iter().map(|&c| c ^ if c & 1 == 0 { 0xEF } else { 0xA5 }).collect()
}

fn ww_url_in(data: &[u8]) -> Option<String> {
    last_ww_url(data).or_else(|| last_ww_url(&ww_decrypt(data)))
}

fn cache_url_ww(user_dir: Option<&str>) -> Result<String, String> {
    let mut logs: Vec<PathBuf> = Vec::new();
    for d in ww_dirs(user_dir) {
        for l in ww_log_files(&d) { if !logs.contains(&l) { logs.push(l); } }
    }
    // 最近写过的日志优先：里面的链接最新
    logs.sort_by_key(|p| std::cmp::Reverse(std::fs::metadata(p).and_then(|m| m.modified()).ok()));
    for l in &logs {
        if let Ok(data) = std::fs::read(l) {
            if let Some(u) = ww_url_in(&data) { return Ok(u); }
        }
    }
    Err(if !logs.is_empty() { "游戏日志里没有唤取记录链接：请先在游戏里打开「唤取」→「唤取记录」，等记录加载出来（不用关游戏），再回来点获取".into() }
        else { "没找到鸣潮的安装位置：请在「其他获取方式」里的「游戏安装目录」填写鸣潮的安装位置（例如 D:\\Wuthering Waves），或者直接粘贴唤取记录链接".into() })
}

/// 鸣潮链接没有 authkey 字段，单独找：取最后一条带 player_id 和 record_id 的唤取记录链接
fn last_ww_url(data: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(data);
    let mut best = None;
    let mut from = 0;
    while let Some(i) = text[from..].find("https://aki-gm-resources") {
        let st = from + i;
        let end = text[st..].find(|c: char| c == '\0' || c.is_whitespace() || c.is_control() || c == '"' || c == '\'' || c == '<' || c == '>' || c == '\\' || c == '\u{fffd}').map(|e| st + e).unwrap_or(text.len());
        let u = &text[st..end];
        if u.contains("record_id=") && u.contains("player_id=") { best = Some(u.to_string()); }
        from = end.max(st + 8);
        if from >= text.len() { break; }
    }
    best
}

/// 链接里的参数（鸣潮的参数在 # 后面）
fn url_params(u: &str) -> HashMap<String, String> {
    let q = u.split_once('?').map(|(_, q)| q).unwrap_or("");
    let q = q.replace('#', "&");
    url::form_urlencoded::parse(q.as_bytes()).into_owned().collect()
}

// ───────────────────────── 同步 ─────────────────────────

fn sync_state() -> &'static Mutex<Value> {
    static S: std::sync::OnceLock<Mutex<Value>> = std::sync::OnceLock::new();
    S.get_or_init(|| Mutex::new(json!({"running": false})))
}

fn set_state(v: Value) { if let Ok(mut s) = sync_state().lock() { *s = v; } }
fn patch_state(k: &str, v: Value) { if let Ok(mut s) = sync_state().lock() { s[k] = v; } }

fn pool_name(game: &str, pool: &str) -> &'static str {
    match (game, pool) {
        ("genshin", "301") => "角色活动祈愿", ("genshin", "302") => "武器活动祈愿", ("genshin", "200") => "常驻祈愿", ("genshin", "500") => "集录祈愿", ("genshin", "100") => "新手祈愿",
        ("starrail", "11") => "角色活动跃迁", ("starrail", "12") => "光锥活动跃迁", ("starrail", "1") => "常驻跃迁", ("starrail", "2") => "新手跃迁",
        ("starrail", "21") => "角色联动跃迁", ("starrail", "22") => "光锥联动跃迁",
        ("zzz", "2") => "独家频段", ("zzz", "3") => "音擎频段", ("zzz", "1") => "常驻频段", ("zzz", "5") => "邦布频段",
        ("ww", "1") => "角色活动唤取", ("ww", "2") => "武器活动唤取", ("ww", "3") => "角色常驻唤取", ("ww", "4") => "武器常驻唤取",
        ("ww", "5") => "新手唤取", ("ww", "6") => "新手自选唤取", ("ww", "7") => "感恩定向唤取",
        ("ww", "8") => "角色新旅唤取", ("ww", "9") => "武器新旅唤取", ("ww", "12") => "角色忆旅唤取", ("ww", "13") => "武器忆旅唤取",
        _ => "卡池",
    }
}

fn validate_record_uid(expected: &str, actual: &str) -> Result<(), String> {
    if actual.is_empty() { return Err("抽卡记录里没有 UID，无法确认账号".into()); }
    if !expected.is_empty() && expected != actual {
        return Err(format!("记录链接属于另一个账号（UID {}），与所选账号不一致，未保存任何记录。请登录所选游戏账号并重新打开抽卡记录，或重新扫描对应通行证", mask(actual)));
    }
    Ok(())
}

fn sync_mihoyo(app: &tauri::AppHandle, g: &Game, source: &str, uid_hint: &str, pasted: &str) -> Result<Value, String> {
    // 1. 拿到 authkey 和基础参数
    let mut base: Vec<(String, String)> = Vec::new();
    match source {
        "account" => {
            patch_state("message", json!("正在生成抽卡记录凭证…"));
            let (key, region) = gen_authkey(app, g, uid_hint)?;
            base.push(("authkey".into(), key));
            base.push(("region".into(), region));
        }
        _ => {
            let u = if source == "cache" { patch_state("message", json!("正在读取游戏缓存…")); cache_url_mihoyo(g)? } else { pasted.trim().to_string() };
            let p = url_params(&u);
            let key = p.get("authkey").cloned().ok_or("链接里没有 authkey，请复制完整的抽卡记录链接")?;
            base.push(("authkey".into(), key));
            for k in ["region", "lang", "game_biz", "authkey_ver", "sign_type"] { if let Some(v) = p.get(k) { base.push((k.into(), v.clone())); } }
        }
    }
    let mut fixed: Vec<(String, String)> = vec![("authkey_ver".into(), "1".into()), ("sign_type".into(), "2".into()), ("auth_appid".into(), "webview_gacha".into()),
        ("lang".into(), "zh-cn".into()), ("game_biz".into(), g.biz.into()), ("size".into(), PAGE_SIZE.to_string())];
    if g.key == "zzz" { fixed.push(("init_log_gacha_base_type".into(), "2".into())); }
    for (k, v) in base { fixed.retain(|(fk, _)| fk != &k); fixed.push((k, v)); }
    fixed.retain(|(k, _)| k != "lang"); fixed.push(("lang".into(), "zh-cn".into()));

    // 2. 逐个卡池翻页
    let mut uid = uid_hint.to_string();
    let mut doc = if uid.is_empty() { Value::Null } else { load_records(app, g.key, &uid) };
    let mut known: HashSet<String> = doc["list"].as_array().map(|l| l.iter().map(|r| s(r, "id")).collect()).unwrap_or_default();
    let mut fresh: Vec<Value> = Vec::new();
    let mut rekeyed = false;
    // 账号生成的凭证被官方拒绝时（星穹铁道目前就是这样），自动改用游戏缓存里的链接
    let mut fell_back = false;
    for pool in g.pools {
        let mut end_id = "0".to_string();
        let mut page = 1;
        'pages: loop {
            if cancelled() { return Err("已取消".into()); }
            let mut q: Vec<String> = fixed.iter().map(|(k, v)| format!("{k}={}", enc(v))).collect();
            q.push(format!("{}={pool}", g.type_key));
            q.push(format!("page={page}"));
            q.push(format!("end_id={end_id}"));
            let url = format!("{}?{}", g.url, q.join("&"));
            let mut tries = 0u64;
            let v = loop {
                let v = http("GET", &url, &[("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36".into())], None)?;
                if v["retcode"].as_i64() == Some(-110) && tries < 6 { tries += 1; std::thread::sleep(Duration::from_millis(1500 * tries)); continue; }
                break v;
            };
            if v["retcode"].as_i64() != Some(0) {
                let auth = is_authkey_error(&v);
                if auth && source == "account" && !rekeyed {
                    // 缓存的凭证过期了：重新生成一次再试
                    rekeyed = true;
                    if let Ok(mut m) = authkeys().lock() { m.clear(); }
                    let (key, _) = gen_authkey(app, g, uid_hint)?;
                    fixed.retain(|(k, _)| k != "authkey");
                    fixed.push(("authkey".into(), key));
                    continue 'pages;
                }
                if auth && source == "account" && !fell_back {
                    // 新生成的凭证仍被拒绝：不是登录问题，改用游戏缓存里的抽卡链接
                    fell_back = true;
                    if let Ok(mut m) = authkeys().lock() { m.retain(|key, _| !key.starts_with(&format!("{}:{uid_hint}:", g.biz))); }
                    patch_state("message", json!("账号凭证被官方拒绝，正在改用游戏缓存…"));
                    let account_msg = || gacha_log_error(&v, if g.key == "starrail" { "account_starrail" } else { "account" }, g.key);
                    let Ok(u) = cache_url_mihoyo(g) else { return Err(account_msg()); };
                    let p = url_params(&u);
                    let Some(key) = p.get("authkey").cloned() else { return Err(account_msg()); };
                    for k in ["authkey", "region", "authkey_ver", "sign_type"] {
                        if let Some(val) = if k == "authkey" { Some(key.clone()) } else { p.get(k).cloned() } {
                            fixed.retain(|(fk, _)| fk != k);
                            fixed.push((k.into(), val));
                        }
                    }
                    continue 'pages;
                }
                if fell_back { return Err(gacha_log_error(&v, "cache", g.key)); }
                return Err(gacha_log_error(&v, source, g.key));
            }
            let list = v["data"]["list"].as_array().cloned().unwrap_or_default();
            if list.is_empty() { break 'pages; }
            let mut stop = false;
            for item in list.iter() {
                let id = s(item, "id");
                validate_record_uid(&uid, &s(item, "uid"))?;
                if uid.is_empty() {
                    uid = s(item, "uid");
                    if uid.is_empty() { return Err("抽卡记录里没有 UID，无法保存".into()); }
                    doc = load_records(app, g.key, &uid);
                    known = doc["list"].as_array().map(|l| l.iter().map(|r| s(r, "id")).collect()).unwrap_or_default();
                }
                if known.contains(&id) { stop = true; break; }
                let mut item = item.clone();
                item["_pool"] = json!(pool);
                known.insert(id);
                fresh.push(item);
            }
            patch_state("message", json!(format!("正在获取「{}」第 {page} 页 · 已新增 {} 条", pool_name(g.key, pool), fresh.len())));
            patch_state("count", json!(fresh.len()));
            if stop || list.len() < PAGE_SIZE { break 'pages; }
            end_id = s(list.last().unwrap_or(&Value::Null), "id");
            page += 1;
            std::thread::sleep(Duration::from_millis(300));
        }
        std::thread::sleep(Duration::from_millis(250));
    }
    if uid.is_empty() { return Err("没有找到任何抽卡记录（可能这个账号还没抽过卡，或记录已超过官方保存期限）".into()); }
    let mut list = doc["list"].as_array().cloned().unwrap_or_default();
    let added = fresh.len();
    list.extend(fresh);
    sort_records(&mut list);
    let total = list.len();
    let mut nickname = s(&doc, "nickname");
    if let Some(c) = load_cred_for_uid(app, g.key, &uid) {
        if let Some(r) = c["roles"][g.key].as_array().and_then(|l| l.iter().find(|r| s(r, "uid") == uid)) { nickname = s(r, "nickname"); }
    }
    save_records(app, g.key, &uid, &json!({"game": g.key, "uid": uid, "nickname": nickname, "updated": now_ts(), "list": list}))?;
    Ok(json!({"game": g.key, "uid": uid, "added": added, "total": total}))
}

fn cancelled() -> bool { sync_state().lock().map(|s| s["cancel"] == true).unwrap_or(false) }

fn ww_time_digits(t: &str) -> String { t.chars().filter(|c| c.is_ascii_digit()).collect::<String>() }

fn sync_ww(app: &tauri::AppHandle, source: &str, pasted: &str, game_dir: Option<&str>, uid_hint: &str) -> Result<Value, String> {
    let u = if source == "cache" { patch_state("message", json!("正在读取鸣潮游戏日志…")); cache_url_ww(game_dir)? } else { pasted.trim().trim_matches('"').to_string() };
    let p = url_params(&u);
    let player = p.get("player_id").cloned().unwrap_or_default();
    let server = p.get("svr_id").cloned().unwrap_or_default();
    let record = p.get("record_id").cloned().unwrap_or_default();
    if player.is_empty() || record.is_empty() { return Err("链接不完整：需要鸣潮「唤取记录」页面的完整链接（含 player_id 和 record_id）".into()); }
    validate_record_uid(uid_hint, &player)?;
    let pool_id = p.get("resources_id").or_else(|| p.get("gacha_id")).cloned().unwrap_or_default();
    let global = p.get("svr_area").map(|a| a == "global").unwrap_or(false) || u.contains("-oversea");
    let host = if global { "https://gmserver-api.aki-game2.net/gacha/record/query" } else { WW_API };
    let origin = if global { "https://aki-gm-resources-oversea.aki-game.net" } else { "https://aki-gm-resources.aki-game.com" };
    let doc = load_records(app, "ww", &player);
    let old = doc["list"].as_array().cloned().unwrap_or_default();
    let mut merged: Vec<Value> = Vec::new();
    let mut added = 0usize;
    for pool in WW_POOLS {
        if cancelled() { return Err("已取消".into()); }
        patch_state("message", json!(format!("正在获取「{}」…", pool_name("ww", pool))));
        let body = json!({"playerId": player, "serverId": server, "languageCode": "zh-Hans", "recordId": record, "cardPoolId": pool_id, "cardPoolType": pool.parse::<i64>().unwrap_or(1)}).to_string();
        let v = match http("POST", host, &[("Content-Type", "application/json".into()), ("Accept", "application/json".into()), ("Origin", origin.into()), ("Referer", format!("{origin}/"))], Some(&body)) {
            Ok(v) => v,
            Err(_) if ww_optional_pool(pool) => { merged.extend(old.iter().filter(|r| s(r, "_pool") == pool).cloned()); continue; }
            Err(e) => return Err(e),
        };
        if v["code"].as_i64() != Some(0) && ww_optional_pool(pool) {
            merged.extend(old.iter().filter(|r| s(r, "_pool") == pool).cloned());
            continue;
        }
        if v["code"].as_i64() != Some(0) {
            let msg = s(&v, "message");
            return Err(if msg.to_lowercase().contains("record") || msg.contains("过期") || msg.contains("失效") { "唤取记录链接已过期（有效期几个小时）：请再到游戏里打开一次「唤取」→「唤取记录」，然后重新获取".into() } else { format!("获取鸣潮抽卡记录失败：{msg}") });
        }
        let mut items: Vec<Value> = v["data"].as_array().cloned().unwrap_or_default();
        items.reverse(); // 接口是新→旧
        let old_pool: Vec<Value> = old.iter().filter(|r| s(r, "_pool") == pool).cloned().collect();
        if items.is_empty() { merged.extend(old_pool); continue; }
        let min_time = items.iter().map(|i| s(i, "time")).min().unwrap_or_default();
        let kept: Vec<Value> = old_pool.iter().filter(|r| s(r, "time") < min_time).cloned().collect();
        let replaced = old_pool.len() - kept.len();
        added += items.len().saturating_sub(replaced);
        merged.extend(kept);
        let mut last_t = String::new();
        let mut seq = 0u32;
        for i in items {
            let t = s(&i, "time");
            if t == last_t { seq += 1 } else { seq = 0; last_t = t.clone(); }
            merged.push(json!({
                "id": format!("{}{}{:03}", ww_time_digits(&t), pool, seq), "uid": player, "time": t, "name": s(&i, "name"),
                "rank_type": s(&i, "qualityLevel"), "item_type": s(&i, "resourceType"), "item_id": s(&i, "resourceId"),
                "count": s(&i, "count"), "_pool": pool,
            }));
        }
        patch_state("count", json!(added));
        std::thread::sleep(Duration::from_millis(300));
    }
    sort_records(&mut merged);
    let total = merged.len();
    save_records(app, "ww", &player, &json!({"game": "ww", "uid": player, "nickname": "", "updated": now_ts(), "list": merged}))?;
    Ok(json!({"game": "ww", "uid": player, "added": added, "total": total}))
}

fn start_sync(app: &tauri::AppHandle, args: &Value) -> Result<Value, String> {
    let game_key = args["game"].as_str().unwrap_or("").to_string();
    let source = args["source"].as_str().unwrap_or("account").to_string();
    let uid = args["uid"].as_str().unwrap_or("").to_string();
    let url = args["url"].as_str().unwrap_or("").to_string();
    let game_dir = args["gameDir"].as_str().map(|x| x.to_string());
    if game_key != "ww" { game(&game_key)?; }
    if !["account", "cache", "url"].contains(&source.as_str()) { return Err("未知的获取方式".into()); }
    if source == "account" && (game_key == "ww" || uid.is_empty()) { return Err("请先选择要更新的游戏角色".into()); }
    if source == "url" && url.trim().is_empty() { return Err("请先粘贴抽卡记录链接".into()); }
    {
        let mut st = sync_state().lock().map_err(|_| "状态异常")?;
        if st["running"] == true { return Err("正在获取中，请等当前任务完成".into()); }
        *st = json!({"running": true, "game": game_key, "message": "准备中…", "count": 0, "startedAt": now_ts()});
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            if game_key == "ww" { sync_ww(&app, &source, &url, game_dir.as_deref(), &uid) }
            else { game(&game_key).and_then(|g| sync_mihoyo(&app, g, &source, &uid, &url)) }
        })).unwrap_or_else(|_| Err("获取过程出错，请重试".into()));
        set_state(match r {
            Ok(v) => json!({"running": false, "done": true, "ok": true, "game": game_key, "result": v, "message": "完成"}),
            Err(e) => json!({"running": false, "done": true, "ok": false, "game": game_key, "error": e, "message": "失败"}),
        });
    });
    Ok(json!({"started": true}))
}

// ───────────────────────── 列表 / 导入导出 ─────────────────────────

fn list_saved(app: &tauri::AppHandle) -> Value {
    let mut out = Map::new();
    for g in ["genshin", "starrail", "zzz", "ww"] {
        let mut arr = Vec::new();
        if let Ok(rd) = std::fs::read_dir(gdir(app).join(g)) {
            for e in rd.flatten() {
                let p = e.path();
                if p.extension().and_then(|x| x.to_str()) != Some("json") { continue; }
                if let Some(doc) = std::fs::read_to_string(&p).ok().and_then(|t| serde_json::from_str::<Value>(&t).ok()) {
                    let uid = s(&doc, "uid");
                    if uid.is_empty() { continue; }
                    arr.push(json!({"uid": uid, "nickname": s(&doc, "nickname"), "updated": doc["updated"], "count": doc["list"].as_array().map(|l| l.len()).unwrap_or(0), "canSync": g != "starrail" && g != "ww" && load_cred_for_uid(app, g, &uid).is_some()}));
                }
            }
        }
        arr.sort_by(|a, b| b["updated"].as_u64().unwrap_or(0).cmp(&a["updated"].as_u64().unwrap_or(0)).then_with(|| s(a, "uid").cmp(&s(b, "uid"))));
        out.insert(g.into(), Value::Array(arr));
    }
    Value::Object(out)
}

fn uigf_key(game: &str) -> &'static str { match game { "genshin" => "hk4e", "starrail" => "hkrpg", "zzz" => "nap", _ => "ww" } }

fn export(app: &tauri::AppHandle, args: &Value) -> Result<Value, String> {
    let game = args["game"].as_str().unwrap_or("");
    let uid = args["uid"].as_str().unwrap_or("");
    let doc = load_records(app, game, uid);
    let list = doc["list"].as_array().cloned().unwrap_or_default();
    if list.is_empty() { return Err("还没有抽卡记录可以导出".into()); }
    let items: Vec<Value> = list.iter().map(|r| {
        let pool = s(r, "_pool");
        let count = { let c = s(r, "count"); if c.is_empty() { "1".to_string() } else { c } };
        let raw_gt = s(r, "gacha_type");
        let gt = if raw_gt.is_empty() || game == "zzz" { pool.clone() } else { raw_gt };
        match game {
            "genshin" => {
                let uigf = if gt == "400" { "301".to_string() } else { gt.clone() };
                json!({"uigf_gacha_type": uigf, "gacha_type": gt, "item_id": s(r, "item_id"), "count": count,
                       "time": s(r, "time"), "name": s(r, "name"), "item_type": s(r, "item_type"), "rank_type": s(r, "rank_type"), "id": s(r, "id")})
            }
            "starrail" | "zzz" => json!({"gacha_id": s(r, "gacha_id"), "gacha_type": gt, "item_id": s(r, "item_id"), "count": count, "time": s(r, "time"),
                       "name": s(r, "name"), "item_type": s(r, "item_type"), "rank_type": s(r, "rank_type"), "id": s(r, "id")}),
            _ => r.clone(),
        }
    }).collect();
    Ok(json!({
        "info": {"export_timestamp": now_ts(), "export_app": "FurinaKit", "export_app_version": env!("CARGO_PKG_VERSION"), "version": "v4.0"},
        uigf_key(game): [{"uid": uid, "timezone": 8, "lang": "zh-cn", "list": items}],
    }))
}

fn nap_pool(gt: &str) -> String {
    if gt.len() > 1 && gt.ends_with("001") { gt[..gt.len() - 3].to_string() } else { gt.to_string() }
}

fn merge_import(app: &tauri::AppHandle, game: &str, uid: &str, items: &[Value]) -> Result<usize, String> {
    let uid: String = uid.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    if uid.is_empty() { return Ok(0); }
    let mut doc = load_records(app, game, &uid);
    let mut list = doc["list"].as_array().cloned().unwrap_or_default();
    let mut known: HashSet<String> = list.iter().map(|r| s(r, "id")).collect();
    let mut n = 0;
    for it in items {
        let id = s(it, "id");
        if id.is_empty() || known.contains(&id) { continue; }
        let mut r = it.clone();
        if s(&r, "_pool").is_empty() {
            let pool = match game {
                "genshin" => { let u = s(it, "uigf_gacha_type"); let gt = s(it, "gacha_type"); let x = if u.is_empty() { gt } else { u }; if x == "400" { "301".to_string() } else { x } }
                "zzz" => nap_pool(&s(it, "gacha_type")),
                _ => s(it, "gacha_type"),
            };
            r["_pool"] = json!(pool);
        }
        if s(&r, "uid").is_empty() { r["uid"] = json!(uid); }
        known.insert(id);
        list.push(r);
        n += 1;
    }
    sort_records(&mut list);
    doc["uid"] = json!(uid);
    doc["game"] = json!(game);
    doc["list"] = Value::Array(list);
    doc["updated"] = json!(now_ts());
    save_records(app, game, &uid, &doc)?;
    Ok(n)
}

fn import(app: &tauri::AppHandle, args: &Value) -> Result<Value, String> {
    let text = args["text"].as_str().unwrap_or("");
    let v: Value = serde_json::from_str(text).map_err(|_| "文件不是有效的 JSON，请选择 UIGF / SRGF 格式的抽卡记录文件".to_string())?;
    let mut report = Vec::new();
    let mut total = 0;
    for (k, game) in [("hk4e", "genshin"), ("hkrpg", "starrail"), ("nap", "zzz"), ("ww", "ww")] {
        if let Some(accs) = v[k].as_array() {
            for a in accs {
                let items = a["list"].as_array().cloned().unwrap_or_default();
                let n = merge_import(app, game, &s(a, "uid"), &items)?;
                total += n;
                report.push(json!({"game": game, "uid": s(a, "uid"), "added": n}));
            }
        }
    }
    // 旧版 UIGF v2/v3（原神）与 SRGF v1（星铁）：info.uid + list
    if report.is_empty() {
        if let Some(items) = v["list"].as_array() {
            let game = if !v["info"]["srgf_version"].is_null() || items.first().map(|i| !i["gacha_id"].is_null()).unwrap_or(false) { "starrail" } else { "genshin" };
            let n = merge_import(app, game, &s(&v["info"], "uid"), items)?;
            total += n;
            report.push(json!({"game": game, "uid": s(&v["info"], "uid"), "added": n}));
        }
    }
    if report.is_empty() { return Err("没有在文件里找到抽卡记录（支持 UIGF v2~v4、SRGF）".into()); }
    Ok(json!({"added": total, "accounts": report}))
}

fn probe() -> Value {
    let mut out = Map::new();
    for g in GAMES.iter() { out.insert(g.key.into(), json!(locallow().join(g.log_dir).is_file())); }
    let ww = ww_dirs(None).iter().any(|d| d.join("Client").join("Saved").join("Logs").join("Client.log").is_file());
    out.insert("ww".into(), json!(ww));
    Value::Object(out)
}

/// 卡池资料的公开数据源白名单：前端只能让本机去取这几个固定地址（这些站点没有跨域头，网页里直接取不到）。
/// 只做 GET，不带任何账号、UID 或抽卡记录；改动时同步 `web/src/components/tools/gacha-banners.ts`
///（`HSR_WARP` / `HSR_NAME_SOURCES`，`scripts/verify-gacha-arena.cjs` 会核对两边一致）。
const BANNER_SOURCES: [&str; 5] = [
    "https://starrailstation.com/api/v1/warp_config",
    "https://raw.githubusercontent.com/Mar-7th/StarRailRes/master/index_new/cn/characters.json",
    "https://raw.githubusercontent.com/Mar-7th/StarRailRes/master/index_new/cn/light_cones.json",
    "https://cdn.jsdelivr.net/gh/Mar-7th/StarRailRes@master/index_new/cn/characters.json",
    "https://cdn.jsdelivr.net/gh/Mar-7th/StarRailRes@master/index_new/cn/light_cones.json",
];

fn banners_fetch(args: &Value) -> Result<Value, String> {
    let url = args["url"].as_str().unwrap_or("").trim();
    if !BANNER_SOURCES.contains(&url) { return Err("不支持的卡池资料地址".into()); }
    http("GET", url, &[("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) FurinaKit".to_string()), ("Accept", "application/json".to_string())], None)
}

/// `/api/gacha/<sub>` 分发
pub fn api(app: &tauri::AppHandle, sub: &str, args: &Value) -> Result<Value, String> {
    let game_scope = args.get("game").and_then(|v| v.as_str());
    match sub {
        "account" => Ok(account_summary_for_uid(app, game_scope, args["uid"].as_str())),
        "qr/create" => qr_create(app),
        "qr/query" => qr_query(app, args["ticket"].as_str().unwrap_or(""), game_scope),
        "sms/send" => sms_send(app, args["mobile"].as_str().unwrap_or("")),
        "sms/login" => sms_login(app, args["mobile"].as_str().unwrap_or(""), args["code"].as_str().unwrap_or(""), args["action_type"].as_str().unwrap_or(""), game_scope),
        "logout" => {
            match game_scope {
                Some(g) if !g.trim().is_empty() && g.trim().to_lowercase() != "all" => {
                    let p = gdir(app).join(format!("account_{}.bin", g.trim().to_lowercase()));
                    if !p.is_file() {
                        return Err("这个游戏用的是共享的米哈游通行证，没有单独的凭据可解绑；要删除请点「退出全部凭据」".into());
                    }
                    let _ = std::fs::remove_file(p);
                    if let Ok(entries) = std::fs::read_dir(gdir(app).join("passports")) {
                        for entry in entries.flatten() {
                            if entry.file_name().to_string_lossy().ends_with(&format!("_{g}.bin")) { std::fs::remove_file(entry.path()).map_err(|e| e.to_string())?; }
                        }
                    }
                }
                _ => {
                    // 退出全部：共享凭证和各游戏专属凭证都删除
                    if let Ok(dir) = std::fs::read_dir(gdir(app)) {
                        for e in dir.flatten() {
                            let name = e.file_name().to_string_lossy().into_owned();
                            if name == "account.bin" || (name.starts_with("account_") && name.ends_with(".bin")) { let _ = std::fs::remove_file(e.path()); }
                        }
                    }
                    if let Ok(entries) = std::fs::read_dir(gdir(app).join("passports")) {
                        for entry in entries.flatten() {
                            let name = entry.file_name().to_string_lossy().into_owned();
                            if name.starts_with("passport_") && name.ends_with(".bin") { std::fs::remove_file(entry.path()).map_err(|e| e.to_string())?; }
                        }
                    }
                }
            }
            if let Ok(mut m) = authkeys().lock() { m.clear(); }
            Ok(json!({"ok": true}))
        }
        "roles" => refresh_roles_for_uid(app, game_scope, args["uid"].as_str()).map(|r| json!({"roles": r})),
        "sync" => start_sync(app, args),
        "sync/status" => Ok(sync_state().lock().map(|s| s.clone()).unwrap_or(Value::Null)),
        "sync/cancel" => { patch_state("cancel", json!(true)); Ok(json!({"ok": true})) }
        "list" => Ok(list_saved(app)),
        "records" => {
            let game = args["game"].as_str().unwrap_or("");
            let uid = args["uid"].as_str().unwrap_or("");
            record_path(app, game, uid)?;
            let mut doc = load_records(app, game, uid);
            doc["_analysis"] = load_analysis(app, game, uid)?;
            Ok(doc)
        }
        "analysis/set" => set_analysis(app, args),
        "delete" => {
            let p = record_path(app, args["game"].as_str().unwrap_or(""), args["uid"].as_str().unwrap_or(""))?;
            let _ = std::fs::remove_file(p);
            Ok(json!({"ok": true}))
        }
        "export" => export(app, args),
        "import" => import(app, args),
        "probe" => Ok(probe()),
        "banners/fetch" => banners_fetch(args),
        _ => Err("未知的抽卡记录分析接口".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn record_uid_must_match_the_selected_archive() {
        assert!(validate_record_uid("123456789", "123456789").is_ok());
        assert!(validate_record_uid("", "123456789").is_ok());
        assert!(validate_record_uid("123456789", "987654321").is_err());
        assert!(validate_record_uid("123456789", "").is_err());
        assert!(validate_record_uid("", "").is_err());
    }
    #[test] fn passport_archives_preserve_accounts_and_select_the_latest_matching_game_uid() {
        let dir = std::env::temp_dir().join(format!("furinakit-gacha-passports-{}", uuid::Uuid::new_v4()));
        let a = json!({"aid":"111111", "stoken":"fixture-a", "loginAt":1, "roles":{"genshin":[{"uid":"100001"}], "zzz":[{"uid":"100001"}]}});
        let b = json!({"aid":"222222", "stoken":"fixture-b", "loginAt":2, "roles":{"genshin":[{"uid":"100002"}]}});
        archive_cred(&dir, &a, "all").unwrap();
        archive_cred(&dir, &b, "genshin").unwrap();
        let selected_a = load_cred_for_uid_in(&dir, "genshin", "100001").unwrap();
        assert_eq!(selected_a["aid"], "111111");
        assert_eq!(selected_a["isDedicated"], false);
        let selected_b = load_cred_for_uid_in(&dir, "genshin", "100002").unwrap();
        assert_eq!(selected_b["aid"], "222222");
        assert_eq!(selected_b["isDedicated"], true);
        assert!(load_cred_for_uid_in(&dir, "zzz", "100002").is_none());
        assert!(load_cred_for_uid_in(&dir, "genshin", "").is_none());
        let mut newer = a.clone(); newer["loginAt"] = json!(3); newer["stoken"] = json!("fixture-new");
        archive_cred(&dir, &newer, "genshin").unwrap();
        assert_eq!(load_cred_for_uid_in(&dir, "genshin", "100001").unwrap()["stoken"], "fixture-new");
        assert_eq!(load_cred_for_uid_in(&dir, "zzz", "100001").unwrap()["stoken"], "fixture-new");
        assert_eq!(load_cred_file(&dir.join("passports/passport_111111_all.bin")).unwrap()["stoken"], "fixture-a");
        assert_eq!(load_cred_for_uid_in(&dir, "genshin", "100002").unwrap()["aid"], "222222");
        assert!(archive_cred(&dir, &json!({"aid":"../x"}), "all").is_err());
        assert!(archive_cred(&dir, &a, "../x").is_err());
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test] fn analysis_annotations_are_per_record_and_do_not_rewrite_raw() {
        let list = vec![json!({"id":"42","_pool":"2","rank_type":"4","name":"凯撒","gacha_id":"9001"}),
                        json!({"id":"43","_pool":"2","rank_type":"4","name":"凯撒","gacha_id":"9002"})];
        let original = list.clone();
        let mut doc = json!({"schema":1,"overrides":{},"banners":{}});
        update_analysis(&mut doc,"zzz",&list,&json!({"record":{"pool":"2","id":"42","value":"off"}})).unwrap();
        update_analysis(&mut doc,"zzz",&list,&json!({"record":{"pool":"2","id":"43","value":"up"}})).unwrap();
        assert_eq!(doc["overrides"]["2:42"], "off");
        assert_eq!(doc["overrides"]["2:43"], "up");
        assert_eq!(list, original);
        assert!(update_analysis(&mut doc,"zzz",&[],&json!({"record":{"pool":"2","id":"42","value":"up"}})).is_err());
        update_analysis(&mut doc,"zzz",&list,&json!({"record":{"pool":"2","id":"42","value":"auto"}})).unwrap();
        assert!(doc["overrides"]["2:42"].is_null());
        assert_eq!(doc["overrides"]["2:43"], "up");
    }
    #[test] fn analysis_rejects_wrong_pool_banner_or_patch() {
        let list = vec![json!({"id":"42","_pool":"2","rank_type":"4","gacha_id":"9001"})];
        let mut doc = json!({"schema":1,"overrides":{},"banners":{}});
        assert!(update_analysis(&mut doc,"zzz",&list,&json!({"record":{"pool":"3","id":"42","value":"off"}})).is_err());
        assert!(update_analysis(&mut doc,"zzz",&list,&json!({"banner":{"pool":"2","id":"9002","upNames":["凯撒"]}})).is_err());
        assert!(update_analysis(&mut doc,"zzz",&list,&json!({"record":{},"banner":{}})).is_err());
        update_analysis(&mut doc,"zzz",&list,&json!({"banner":{"pool":"2","id":"9001","upNames":["星见雅"]}})).unwrap();
        assert_eq!(doc["banners"]["2:9001"]["upNames"][0], "星见雅");
        update_analysis(&mut doc,"zzz",&list,&json!({"banner":{"pool":"2","id":"9001","upNames":[]}})).unwrap();
        assert!(doc["banners"]["2:9001"].is_null());
    }
    #[test] fn finds_data_dir() {
        let log = "[x] Loading player data from E:/Games/Genshin Impact/Genshin Impact Game/YuanShen_Data/data.unity3d\n";
        assert_eq!(find_data_dir(log, &["YuanShen_Data"]).unwrap(), PathBuf::from("E:/Games/Genshin Impact/Genshin Impact Game/YuanShen_Data"));
        assert!(find_data_dir("nothing here", &["StarRail_Data"]).is_none());
    }
    #[test] fn finds_last_url() {
        let data = b"\0https://webstatic.mihoyo.com/x?authkey=old&game_biz=hk4e_cn#/log\0junk https://public-operation-hk4e.mihoyo.com/gacha_info/api/getGachaLog?authkey=NEW%2B&gacha_type=301\0";
        let u = last_gacha_url(data, &["getGachaLog"]).unwrap();
        assert!(u.contains("authkey=NEW"));
        assert_eq!(url_params(&u).get("authkey").unwrap(), "NEW+");
    }
    #[test] fn ww_params_after_hash() {
        let p = url_params("https://aki-gm-resources.aki-game.com/aki/gacha/index.html#/record?svr_id=abc&player_id=100&record_id=r1&resources_id=x");
        assert_eq!(p.get("player_id").unwrap(), "100");
        assert_eq!(p.get("record_id").unwrap(), "r1");
    }
    #[test] fn ww_url_from_plain_and_encrypted_log() {
        let plain = b"[x] open https://aki-gm-resources.aki-game.com/aki/gacha/index.html\n[y] url https://aki-gm-resources.aki-game.com/aki/gacha/index.html#/record?svr_id=s1&player_id=100&lang=zh-Hans&gacha_id=1&gacha_type=1&svr_area=cn&record_id=OLD&resources_id=r\n[z] url https://aki-gm-resources.aki-game.com/aki/gacha/index.html#/record?svr_id=s1&player_id=100&lang=zh-Hans&gacha_id=1&gacha_type=1&svr_area=cn&record_id=NEW&resources_id=r\r\n[w] https://aki-gm-resources.aki-game.com/aki/gacha/assets/x.png\n";
        let u = ww_url_in(plain).unwrap();
        assert!(u.ends_with("record_id=NEW&resources_id=r"));
        // 3.4+ encrypted log: even bytes ^ 0xEF, odd bytes ^ 0xA5 (an involution on parity classes)
        let enc: Vec<u8> = plain.iter().map(|&p| p ^ if p & 1 == 1 { 0xEF } else { 0xA5 }).collect();
        assert_eq!(ww_decrypt(&enc), plain.to_vec());
        assert_eq!(ww_url_in(&enc).unwrap(), u);
        assert_eq!(url_params(&u).get("record_id").unwrap(), "NEW");
        assert!(ww_url_in(b"no links here").is_none());
    }
    #[test] fn ids_numeric_order() {
        let mut v = vec![json!({"id": "100"}), json!({"id": "99"}), json!({"id": "1000"})];
        sort_records(&mut v);
        assert_eq!(v.iter().map(|x| s(x, "id")).collect::<Vec<_>>(), vec!["99", "100", "1000"]);
    }
    #[test] fn ds_format() {
        let d = ds1(SALT_LK2);
        assert_eq!(d.split(',').count(), 3);
        assert_eq!(d.split(',').nth(2).unwrap().len(), 32);
        assert_eq!(nap_pool("2001"), "2");
        assert_eq!(nap_pool("3"), "3");
    }
    #[test] fn banner_sources_are_a_fixed_allowlist() {
        // Every rejected call returns before any network access.
        assert!(banners_fetch(&json!({"url": "https://example.com/warp_config"})).is_err());
        assert!(banners_fetch(&json!({"url": "http://starrailstation.com/api/v1/warp_config"})).is_err());
        assert!(banners_fetch(&json!({"url": "https://starrailstation.com/api/v1/warp_config?x=1"})).is_err());
        assert!(banners_fetch(&json!({})).is_err());
        assert!(BANNER_SOURCES.iter().all(|u| u.starts_with("https://")));
    }
}
