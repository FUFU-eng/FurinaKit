//! Native clipboard history, independently implemented. No clipboard contents are logged.
//! SQLite owns text, rich text and PNG copies; Explorer entries retain paths only.
use clipboard_rs::{
    common::{ClipboardContent, ContentFormat, RustImage, RustImageData},
    Clipboard, ClipboardContext,
};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicU32, Ordering},
        Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::Emitter;

static CLIPBOARD_IO: Mutex<()> = Mutex::new(());
static WARNING: Mutex<Option<String>> = Mutex::new(None);
static SKIP_SEQUENCE: AtomicU32 = AtomicU32::new(0);
const MAX_BYTES: usize = 64 * 1024 * 1024;
fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i64
}
fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}
fn verification_mode() -> bool {
    std::env::var("FURINAKIT_VERIFY_CLIPBOARD").ok().as_deref() == Some("1")
}
fn path() -> PathBuf {
    if verification_mode() {
        return std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join("_verify")
            .join("clipboard-native")
            .join("history.sqlite3");
    }
    crate::app_root_public()
        .join("data")
        .join("clipboard")
        .join("history.sqlite3")
}
fn open() -> Result<Connection, String> {
    let p = path();
    std::fs::create_dir_all(p.parent().unwrap()).map_err(err)?;
    let db = Connection::open(p).map_err(err)?;
    db.busy_timeout(Duration::from_secs(5)).map_err(err)?;
    db.execute_batch("PRAGMA journal_mode=WAL; PRAGMA secure_delete=ON;
      CREATE TABLE IF NOT EXISTS settings(id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL, days INTEGER NOT NULL);

      CREATE TABLE IF NOT EXISTS clips(id TEXT PRIMARY KEY, kind TEXT NOT NULL, text TEXT NOT NULL,
        payload BLOB NOT NULL, thumb BLOB, created INTEGER NOT NULL, copied INTEGER NOT NULL,
        expires INTEGER, pinned INTEGER NOT NULL DEFAULT 0, bytes INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS clips_order ON clips(pinned DESC,copied DESC);
      CREATE INDEX IF NOT EXISTS clips_expiry ON clips(expires);").map_err(err)?;
    db.execute(
        "INSERT OR IGNORE INTO settings VALUES(1,?,0)",
        [!verification_mode()],
    )
    .map_err(err)?;
    Ok(db)
}
#[derive(Serialize, Deserialize, Clone)]
pub struct Settings {
    enabled: bool,
    days: u32,
}
fn settings(db: &Connection) -> Result<Settings, String> {
    db.query_row("SELECT enabled,days FROM settings WHERE id=1", [], |r| {
        Ok(Settings {
            enabled: r.get(0)?,
            days: r.get(1)?,
        })
    })
    .map_err(err)
}
fn local(webview: &tauri::Webview) -> Result<(), String> {
    if ["main", "utility-clipboard"].contains(&webview.label()) {
        Ok(())
    } else {
        Err("剪贴板历史仅供本地主窗口和永久剪切板小窗访问".into())
    }
}
fn expiration(days: u32, at: i64) -> Option<i64> {
    if days == 0 {
        None
    } else {
        Some(at + i64::from(days) * 86_400_000)
    }
}
fn cleanup(db: &Connection) -> Result<usize, String> {
    db.execute(
        "DELETE FROM clips WHERE pinned=0 AND expires IS NOT NULL AND expires<=?",
        [now()],
    )
    .map_err(err)
}
#[derive(Default, Serialize, Deserialize)]
struct TextPayload {
    text: String,
    html: Option<String>,
    rtf: Option<String>,
    paths: Vec<String>,
}
struct Captured {
    kind: String,
    text: String,
    payload: Vec<u8>,
    thumb: Vec<u8>,
}
fn prohibited(ctx: &ClipboardContext) -> Result<bool, String> {
    forbids_history(&ctx.available_formats().map_err(err)?, |marker| {
        ctx.get_buffer(marker).map_err(err)
    })
}
fn forbids_history(
    formats: &[String],
    mut buffer: impl FnMut(&str) -> Result<Vec<u8>, String>,
) -> Result<bool, String> {
    for marker in [
        "ExcludeClipboardContentFromMonitor",
        "Clipboard Viewer Ignore",
        "x-kde-passwordManagerHint",
    ] {
        if formats.iter().any(|f| f.eq_ignore_ascii_case(marker)) {
            return Ok(true);
        }
    }
    for marker in ["CanIncludeInClipboardHistory"] {
        if formats.iter().any(|f| f == marker) {
            let v = buffer(marker)?;
            if v.len() < 4 || u32::from_le_bytes(v[..4].try_into().unwrap()) == 0 {
                return Ok(true);
            }
        }
    }
    Ok(false)
}
fn read(ctx: &ClipboardContext) -> Result<Option<Captured>, String> {
    if prohibited(ctx)? {
        return Ok(None);
    }
    let mut p = TextPayload::default();
    let kind;
    if ctx.has(ContentFormat::Files) {
        p.paths = ctx.get_files().map_err(err)?;
        p.paths.retain(|p| !p.is_empty());
        if p.paths.is_empty() {
            return Ok(None);
        }
        p.text = p.paths.join("\n");
        kind = "files";
    } else if let Some(captured) = (|| -> Option<Result<Captured, String>> {
        if !ctx.has(ContentFormat::Image) {
            return None;
        }
        let image = match ctx.get_image() {
            Ok(img) => img,
            Err(_) => return None,
        };
        let (w, h) = image.get_size();
        if u64::from(w) * u64::from(h) > 100_000_000 {
            return Some(Err("图片超过 1 亿像素，未记录（不会截断保存）".into()));
        }
        let payload = match image.to_png() {
            Ok(p) => p.get_bytes().to_vec(),
            Err(e) => return Some(Err(err(e))),
        };
        if payload.len() > MAX_BYTES {
            return Some(Err("图片超过 64 MiB，未记录（不会截断保存）".into()));
        }
        let thumb = match image.thumbnail(180, 180).and_then(|t| t.to_png()) {
            Ok(t) => t.get_bytes().to_vec(),
            Err(e) => return Some(Err(err(e))),
        };
        Some(Ok(Captured {
            kind: "image".into(),
            text: format!("图片 {w} × {h}"),
            payload,
            thumb,
        }))
    })() {
        return captured.map(Some);
    } else {
        if ctx.has(ContentFormat::Text) {
            p.text = ctx.get_text().map_err(err)?;
        }
        if ctx.has(ContentFormat::Html) {
            p.html = Some(ctx.get_html().map_err(err)?);
        }
        if ctx.has(ContentFormat::Rtf) {
            p.rtf = Some(ctx.get_rich_text().map_err(err)?);
        }
        if p.text.is_empty() && p.html.is_none() && p.rtf.is_none() {
            return Ok(None);
        }
        kind = if (p.text.starts_with("https://") || p.text.starts_with("http://"))
            && !p.text.contains(char::is_whitespace)
        {
            "link"
        } else {
            "text"
        };
    }
    let text = if p.text.is_empty() {
        "富文本（保留原格式）".to_string()
    } else {
        p.text.clone()
    };
    let payload = serde_json::to_vec(&p).map_err(err)?;
    if payload.len() > MAX_BYTES {
        return Err("剪切板内容超过 64 MiB，未记录（不会截断保存）".into());
    }
    Ok(Some(Captured {
        kind: kind.into(),
        text,
        payload,
        thumb: vec![],
    }))
}
fn store(db: &Connection, c: &Captured, days: u32, at: i64) -> Result<(), String> {
    let mut h = blake3::Hasher::new();
    h.update(c.kind.as_bytes());
    h.update(&[0]);
    h.update(&c.payload);
    let id = h.finalize().to_hex().to_string();
    db.execute("INSERT INTO clips(id,kind,text,payload,thumb,created,copied,expires,bytes) VALUES(?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET copied=excluded.copied,
       expires=CASE WHEN clips.pinned=1 OR clips.expires IS NULL OR excluded.expires IS NULL THEN NULL ELSE max(clips.expires,excluded.expires) END",
       params![id,c.kind,c.text,c.payload,c.thumb,at,at,expiration(days,at),c.payload.len() as i64]).map_err(err)?;
    Ok(())
}
#[cfg(windows)]
fn sequence() -> u32 {
    #[link(name = "user32")]
    extern "system" {
        fn GetClipboardSequenceNumber() -> u32;
    }
    unsafe { GetClipboardSequenceNumber() }
}
#[cfg(not(windows))]
fn sequence() -> u32 {
    0
}
fn warn(s: String) {
    if let Ok(mut v) = WARNING.lock() {
        *v = Some(s)
    }
}
pub fn clear_warn() {
    if let Ok(mut v) = WARNING.lock() {
        *v = None;
    }
}
/// Only future clipboard changes are captured; never import the pre-launch clipboard.
pub fn start(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let db = match open() {
            Ok(v) => v,
            Err(e) => {
                warn(format!("历史库不可用：{e}"));
                return;
            }
        };
        let ctx = match ClipboardContext::new() {
            Ok(v) => v,
            Err(e) => {
                warn(format!("剪切板不可用：{e}"));
                return;
            }
        };
        let mut previous = sequence();
        let mut tick = 0u32;
        let mut failures = 0u32;
        loop {
            std::thread::sleep(Duration::from_millis(200));
            tick = tick.wrapping_add(1);
            if tick % 300 == 0 {
                match cleanup(&db) {
                    Ok(n) if n > 0 => {
                        let _ = app.emit("clipboard-history-changed", now());
                    }
                    Err(e) => warn(e),
                    _ => {}
                }
            }
            let seq = sequence();
            if seq == previous {
                continue;
            }
            let conf = match settings(&db) {
                Ok(v) => v,
                Err(e) => {
                    warn(e);
                    continue;
                }
            };
            if !conf.enabled || seq == SKIP_SEQUENCE.load(Ordering::SeqCst) {
                previous = seq;
                continue;
            }
            // Retry temporary clipboard contention; discard torn reads when the sequence changes.
            let _io = match CLIPBOARD_IO.lock() {
                Ok(v) => v,
                Err(_) => {
                    warn("剪切板读写锁异常".into());
                    return;
                }
            };
            if seq == SKIP_SEQUENCE.load(Ordering::SeqCst) {
                previous = seq;
                continue;
            }
            match read(&ctx) {
                Ok(value) => {
                    if sequence() != seq {
                        continue;
                    }
                    if let Some(c) = value {
                        // Recheck pause after image encoding; pausing never commits an in-flight read.
                        let save = (|| -> Result<bool, String> {
                            let tx = db.unchecked_transaction().map_err(err)?;
                            let s = settings(&tx)?;
                            if !s.enabled || seq == SKIP_SEQUENCE.load(Ordering::SeqCst) {
                                return Ok(false);
                            }
                            store(&tx, &c, s.days, now())?;
                            tx.commit().map_err(err)?;
                            Ok(true)
                        })();
                        match save {
                            Ok(true) => {
                                clear_warn();
                                let _ = app.emit("clipboard-history-changed", now());
                            }
                            Ok(false) => {}
                            Err(e) => {
                                warn(e);
                                continue;
                            }
                        }
                    } else {
                        clear_warn();
                    }
                    previous = seq;
                    failures = 0;
                }
                Err(e) => {
                    failures += 1;
                    if failures >= 5 {
                        warn(e);
                        previous = seq;
                        failures = 0;
                    }
                }
            }
        }
    });
}
#[tauri::command]
pub async fn clip_settings(webview: tauri::Webview) -> Result<serde_json::Value, String> {
    local(&webview)?;
    let db = open()?;
    let conf = settings(&db)?;
    Ok(
        serde_json::json!({"enabled":conf.enabled,"days":conf.days,"path":path(),"verification":verification_mode(),"warning":WARNING.lock().ok().and_then(|v|v.clone())}),
    )
}
#[tauri::command]
pub async fn clip_dismiss_warning(webview: tauri::Webview) -> Result<(), String> {
    local(&webview)?;
    clear_warn();
    Ok(())
}
#[tauri::command]
pub async fn clip_configure(
    webview: tauri::Webview,
    enabled: bool,
    days: u32,
) -> Result<(), String> {
    local(&webview)?;
    if days > 36500 {
        return Err("保留时间应为 0（永久）至 36500 天".into());
    }
    // Do not collect anything copied while paused when resuming.
    SKIP_SEQUENCE.store(sequence(), Ordering::SeqCst);
    open()?
        .execute(
            "UPDATE settings SET enabled=?,days=? WHERE id=1",
            params![enabled, days],
        )
        .map_err(err)?;
    Ok(())
}
#[tauri::command]
pub async fn clip_list(
    webview: tauri::Webview,
    query: String,
    kind: String,
    offset: u32,
    from: Option<i64>,
    until: Option<i64>,
) -> Result<serde_json::Value, String> {
    local(&webview)?;
    if !["all", "text", "link", "files", "image"].contains(&kind.as_str()) {
        return Err("未知记录类型".into());
    }
    let db = open()?;
    cleanup(&db)?;
    let q = format!(
        "%{}%",
        query
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_")
    );
    let from=from.unwrap_or(0).max(0);let until=until.unwrap_or(i64::MAX);
    if until < from {return Err("结束日期不能早于开始日期".into());}
    let count: i64 = db
        .query_row(
            "SELECT COUNT(*) FROM clips WHERE (?='all' OR kind=?) AND text LIKE ? ESCAPE '\\' AND copied>=? AND copied<=?",
            params![kind, kind, q, from, until],
            |r| r.get(0),
        )
        .map_err(err)?;
    let mut stmt=db.prepare("SELECT id,kind,substr(text,1,400),thumb,copied,expires,pinned,bytes FROM clips
      WHERE (?='all' OR kind=?) AND text LIKE ? ESCAPE '\\' AND copied>=? AND copied<=? ORDER BY pinned DESC,copied DESC LIMIT 30 OFFSET ?").map_err(err)?;
    let rows=stmt.query_map(params![kind,kind,q,from,until,offset],|r|{
        let thumb:Vec<u8>=r.get(3)?;
        Ok(serde_json::json!({"id":r.get::<_,String>(0)?,"kind":r.get::<_,String>(1)?,"text":r.get::<_,String>(2)?,
          "thumbnail":if thumb.is_empty(){None}else{Some(format!("data:image/png;base64,{}",crate::jobs::b64_encode_public(&thumb)))},
          "at":r.get::<_,i64>(4)?,"expires":r.get::<_,Option<i64>>(5)?,"pinned":r.get::<_,bool>(6)?,"bytes":r.get::<_,i64>(7)?}))
    }).map_err(err)?;
    let items: Result<Vec<_>, _> = rows.collect();
    Ok(serde_json::json!({"items":items.map_err(err)?,"total":count}))
}
#[tauri::command]
pub async fn clip_restore(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    paste: Option<bool>,
    id: String,
    as_text: bool,
) -> Result<(), String> {
    local(&webview)?;
    let db = open()?;
    cleanup(&db)?;
    let row = db
        .query_row("SELECT kind,payload FROM clips WHERE id=?", [id], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Vec<u8>>(1)?))
        })
        .optional()
        .map_err(err)?
        .ok_or("记录已删除或过期")?;
    let as_text = as_text || (paste.unwrap_or(false) && row.0 == "text");
    let _io = CLIPBOARD_IO.lock().map_err(err)?;
    let ctx = ClipboardContext::new().map_err(err)?;
    if row.0 == "image" {
        ctx.set_image(RustImageData::from_bytes(&row.1).map_err(err)?)
            .map_err(err)?;
    } else {
        let p: TextPayload = serde_json::from_slice(&row.1).map_err(err)?;
        if row.0 == "files" && !as_text {
            // All-or-nothing; never silently drop missing files or execute any path.
            if p.paths.iter().any(|p| !PathBuf::from(p).exists()) {
                return Err("原文件已移动、删除或当前不可访问；可改用复制路径".into());
            }
            ctx.set_files(p.paths).map_err(err)?;
        } else if as_text {
            ctx.set_text(p.text).map_err(err)?;
        } else {
            let mut data = vec![ClipboardContent::Text(p.text)];
            if let Some(html) = p.html {
                data.push(ClipboardContent::Html(html));
            }
            if let Some(rtf) = p.rtf {
                data.push(ClipboardContent::Rtf(rtf));
            }
            ctx.set(data).map_err(err)?;
        }
    }
    SKIP_SEQUENCE.store(sequence(), Ordering::SeqCst);
    drop(ctx); drop(_io);
    if paste.unwrap_or(false) {
        if webview.label()!="utility-clipboard" {return Err("请从独立剪切板窗口粘贴".into());}
        return crate::utility_windows::paste_to_target(&app);
    }
    Ok(())
}
#[tauri::command]
pub async fn clip_delete(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    id: Option<String>,
    confirm_all: bool,
) -> Result<(), String> {
    local(&webview)?;
    let db = open()?;
    if let Some(id) = id {
        db.execute("DELETE FROM clips WHERE id=?", [id])
            .map_err(err)?;
    } else if confirm_all {
        SKIP_SEQUENCE.store(sequence(), Ordering::SeqCst);
        db.execute("DELETE FROM clips", []).map_err(err)?;
        db.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
            .map_err(err)?;
    } else {
        return Err("清空全部历史需要明确确认".into());
    }
    let _ = app.emit("clipboard-history-changed", now());
    Ok(())
}
fn set_pin(db: &Connection, id: &str, pinned: bool) -> Result<(), String> {
    let changed = db
        .execute(
            "UPDATE clips SET pinned=?,expires=CASE WHEN ? THEN NULL ELSE expires END WHERE id=?",
            params![pinned, pinned, id],
        )
        .map_err(err)?;
    if changed == 0 {
        return Err("记录已删除或过期".into());
    }
    Ok(())
}
fn set_retention(db: &Connection, id: &str, days: u32, at: i64) -> Result<(), String> {
    if days > 36500 {
        return Err("保留时间应为 0（永久）至 36500 天".into());
    }
    let tx = db.unchecked_transaction().map_err(err)?;
    let pinned = tx
        .query_row("SELECT pinned FROM clips WHERE id=?", [id], |r| {
            r.get::<_, bool>(0)
        })
        .optional()
        .map_err(err)?
        .ok_or("记录已删除或过期")?;
    if pinned && days != 0 {
        return Err("置顶记录永久保留；请先取消置顶，再设置有限期限".into());
    }
    tx.execute(
        "UPDATE clips SET expires=? WHERE id=?",
        params![expiration(days, at), id],
    )
    .map_err(err)?;
    tx.commit().map_err(err)?;
    Ok(())
}
fn detail_page(db: &Connection, id: &str, offset: u32) -> Result<serde_json::Value, String> {
    db.query_row("SELECT kind,substr(text,?,32000),length(text),bytes FROM clips WHERE id=?",params![i64::from(offset)+1,id],|r|Ok(serde_json::json!({"kind":r.get::<_,String>(0)?,"text":r.get::<_,String>(1)?,"totalCharacters":r.get::<_,i64>(2)?,"bytes":r.get::<_,i64>(3)?,"offset":offset,"pageSize":32000}))).optional().map_err(err)?.ok_or("记录已删除或过期".into())
}
#[tauri::command]
pub async fn clip_pin(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    id: String,
    pinned: bool,
) -> Result<(), String> {
    local(&webview)?;
    let db = open()?;
    cleanup(&db)?;
    set_pin(&db, &id, pinned)?;
    let _ = app.emit("clipboard-history-changed", now());
    Ok(())
}
#[tauri::command]
pub async fn clip_set_retention(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    id: String,
    days: u32,
) -> Result<(), String> {
    local(&webview)?;
    tauri::async_runtime::spawn_blocking(move || {
        let db = open()?;
        cleanup(&db)?;
        set_retention(&db, &id, days, now())?;
        let _ = app.emit("clipboard-history-changed", now());
        Ok(())
    })
    .await
    .map_err(err)?
}
#[tauri::command]
pub async fn clip_details(
    webview: tauri::Webview,
    id: String,
    offset: u32,
) -> Result<serde_json::Value, String> {
    local(&webview)?;
    tauri::async_runtime::spawn_blocking(move || {
        let db = open()?;
        cleanup(&db)?;
        detail_page(&db, &id, offset)
    })
    .await
    .map_err(err)?
}
#[cfg(test)]
mod tests {
    use super::*;
    fn memory() -> Connection {
        let d = Connection::open_in_memory().unwrap();
        d.execute_batch("CREATE TABLE clips(id TEXT PRIMARY KEY,kind TEXT,text TEXT,payload BLOB,thumb BLOB,created INTEGER,copied INTEGER,expires INTEGER,pinned INTEGER DEFAULT 0,bytes INTEGER);").unwrap();
        d
    }
    fn sample() -> Captured {
        Captured {
            kind: "text".into(),
            text: "测试🙂".into(),
            payload: b"fixture".to_vec(),
            thumb: vec![],
        }
    }
    #[test]
    fn explicit_history_exclusion_wins() {
        assert!(
            forbids_history(&["ExcludeClipboardContentFromMonitor".into()], |_| panic!(
                "must not read data"
            ))
            .unwrap()
        );
        assert!(
            forbids_history(&["CanIncludeInClipboardHistory".into()], |_| Ok(vec![
                0, 0, 0, 0
            ]))
            .unwrap()
        );
        assert!(
            !forbids_history(&["CanIncludeInClipboardHistory".into()], |_| Ok(vec![
                1, 0, 0, 0
            ]))
            .unwrap()
        );
    }
    #[test]
    fn no_cloud_is_not_no_local_history() {
        assert!(
            !forbids_history(&["CanUploadToCloudClipboard".into()], |_| Ok(vec![
                0, 0, 0, 0
            ]))
            .unwrap()
        );
    }
    #[test]
    fn no_two_hundred_item_ceiling() {
        let d = memory();
        for i in 0u32..251 {
            let mut c = sample();
            c.payload = i.to_le_bytes().to_vec();
            store(&d, &c, 0, 10).unwrap();
        }
        assert_eq!(
            d.query_row("SELECT count(*) FROM clips", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            251
        );
    }
    #[test]
    fn text_is_not_truncated_to_twenty_thousand_chars() {
        let d = memory();
        let p = TextPayload {
            text: "汉字🙂".repeat(25000),
            ..Default::default()
        };
        let mut c = sample();
        c.payload = serde_json::to_vec(&p).unwrap();
        store(&d, &c, 0, 10).unwrap();
        let raw: Vec<u8> = d
            .query_row("SELECT payload FROM clips", [], |r| r.get(0))
            .unwrap();
        let restored: TextPayload = serde_json::from_slice(&raw).unwrap();
        assert_eq!(restored.text, p.text);
    }
    #[test]
    fn recopy_never_shortens_existing_expiry() {
        let d = memory();
        store(&d, &sample(), 30, 10).unwrap();
        store(&d, &sample(), 1, 20).unwrap();
        assert_eq!(
            d.query_row("SELECT expires FROM clips", [], |r| r
                .get::<_, Option<i64>>(0))
                .unwrap(),
            expiration(30, 10)
        );
    }
    #[test]
    fn permanent_has_no_expiration() {
        assert_eq!(expiration(0, 123), None);
        assert_eq!(expiration(1, 123), Some(86400123));
    }
    #[test]
    fn repeated_copy_keeps_one_row() {
        let d = memory();
        store(&d, &sample(), 30, 10).unwrap();
        store(&d, &sample(), 30, 20).unwrap();
        assert_eq!(
            d.query_row("SELECT count(*) FROM clips", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            1
        );
        assert_eq!(
            d.query_row("SELECT copied FROM clips", [], |r| r.get::<_, i64>(0))
                .unwrap(),
            20
        );
    }
    #[test]
    fn permanent_survives_recopy_with_shorter_default() {
        let d = memory();
        store(&d, &sample(), 0, 10).unwrap();
        store(&d, &sample(), 1, 20).unwrap();
        assert_eq!(
            d.query_row("SELECT expires FROM clips", [], |r| r
                .get::<_, Option<i64>>(0))
                .unwrap(),
            None
        );
    }
    #[test]
    fn expiry_never_deletes_pins() {
        let d = memory();
        store(&d, &sample(), 1, 10).unwrap();
        d.execute("UPDATE clips SET pinned=1", []).unwrap();
        assert_eq!(cleanup(&d).unwrap(), 0);
        d.execute("UPDATE clips SET pinned=0", []).unwrap();
        assert_eq!(cleanup(&d).unwrap(), 1);
    }
    #[test]
    fn files_payload_preserves_unicode_and_multiple_paths() {
        let p = TextPayload {
            text: "".into(),
            paths: vec![r"E:\资料\视频.mp4".into(), r"E:\a b\doc.pdf".into()],
            ..Default::default()
        };
        let p2: TextPayload = serde_json::from_slice(&serde_json::to_vec(&p).unwrap()).unwrap();
        assert_eq!(p.paths, p2.paths);
    }
    fn first_id(d: &Connection) -> String {
        d.query_row("SELECT id FROM clips LIMIT 1", [], |r| r.get(0))
            .unwrap()
    }
    #[test]
    fn unpin_does_not_shorten_permanent_retention() {
        let d = memory();
        store(&d, &sample(), 0, 10).unwrap();
        let id = first_id(&d);
        set_pin(&d, &id, true).unwrap();
        set_pin(&d, &id, false).unwrap();
        assert_eq!(
            d.query_row("SELECT expires FROM clips", [], |r| r
                .get::<_, Option<i64>>(0))
                .unwrap(),
            None
        );
    }
    #[test]
    fn entry_can_be_permanent_without_pin() {
        let d = memory();
        store(&d, &sample(), 30, 10).unwrap();
        let id = first_id(&d);
        set_retention(&d, &id, 0, 20).unwrap();
        assert_eq!(
            d.query_row("SELECT expires,pinned FROM clips", [], |r| Ok((
                r.get::<_, Option<i64>>(0)?,
                r.get::<_, bool>(1)?
            )))
            .unwrap(),
            (None, false)
        );
    }
    #[test]
    fn explicit_entry_expiry_starts_now() {
        let d = memory();
        store(&d, &sample(), 0, 10).unwrap();
        set_retention(&d, &first_id(&d), 7, 100).unwrap();
        assert_eq!(
            d.query_row("SELECT expires FROM clips", [], |r| r
                .get::<_, Option<i64>>(0))
                .unwrap(),
            expiration(7, 100)
        );
    }
    #[test]
    fn finite_retention_cannot_silently_unpin() {
        let d = memory();
        store(&d, &sample(), 30, 10).unwrap();
        let id = first_id(&d);
        set_pin(&d, &id, true).unwrap();
        assert!(set_retention(&d, &id, 1, 20).is_err());
    }
    #[test]
    fn setting_missing_entry_returns_error() {
        let d = memory();
        assert!(set_retention(&d, "gone", 7, 100).is_err());
        assert!(set_pin(&d, "gone", true).is_err());
    }
    #[test]
    fn details_page_unicode_without_losing_stored_content() {
        let d = memory();
        let mut c = sample();
        c.text = "汉🙂字".repeat(22000);
        store(&d, &c, 0, 10).unwrap();
        let id = first_id(&d);
        let mut text = String::new();
        for offset in [0, 32000, 64000] {
            let page = detail_page(&d, &id, offset).unwrap();
            assert_eq!(page["totalCharacters"], 66000);
            text.push_str(page["text"].as_str().unwrap());
        }
        assert_eq!(text, c.text);
    }
    #[test]
    fn rich_text_payload_roundtrips_all_standard_formats() {
        let p = TextPayload {
            text: "QA <test> 🙂".into(),
            html: Some("<strong>QA &lt;test&gt; 🙂</strong>".into()),
            rtf: Some("{\\rtf1 QA}".into()),
            paths: vec![],
        };
        let raw = serde_json::to_vec(&p).unwrap();
        let restored: TextPayload = serde_json::from_slice(&raw).unwrap();
        assert_eq!(p.text, restored.text);
        assert_eq!(p.html, restored.html);
        assert_eq!(p.rtf, restored.rtf);
    }
}

#[tauri::command]
pub fn clip_licenses() -> String {
    format!(
        "clipboard-rs (MIT)\n{}\n\nrusqlite (MIT), SQLite (public domain)\n{}\n\nBLAKE3 (CC0)\n{}",
        include_str!("../../licenses/clipboard-rs-MIT.txt"),
        include_str!("../../licenses/rusqlite-MIT.txt"),
        include_str!("../../licenses/blake3-CC0.txt")
    )
}

/// Read only a requested image. No clipboard mutation, shell execution, or external upload.
#[tauri::command]
pub async fn clip_image_preview(webview:tauri::Webview,id:String,full:bool)->Result<String,String>{
    static PREVIEW_LOCK:std::sync::Mutex<()>=std::sync::Mutex::new(());
    local(&webview)?;
    tauri::async_runtime::spawn_blocking(move || {
        let _preview_guard=PREVIEW_LOCK.lock().map_err(err)?;
        let db=open()?;cleanup(&db)?;
        let bytes:Vec<u8>=db.query_row("SELECT payload FROM clips WHERE id=? AND kind='image'",[id],|r|r.get(0)).optional().map_err(err)?.ok_or("图片已删除或过期")?;
        if full {return Ok(format!("data:image/png;base64,{}",crate::jobs::b64_encode_public(&bytes)));}
        let image=image::load_from_memory(&bytes).map_err(err)?.thumbnail(1000,700);
        let mut out=std::io::Cursor::new(Vec::new());image.write_to(&mut out,image::ImageFormat::Png).map_err(err)?;
        Ok(format!("data:image/png;base64,{}",crate::jobs::b64_encode_public(out.get_ref())))
    }).await.map_err(err)?
}

/// Explicit screenshot copy only; no history/database reads. Context opens/writes/closes on this thread.
pub fn write_png(bytes:&[u8])->Result<(),String>{
    let _io=CLIPBOARD_IO.lock().map_err(err)?;
    let mut last=String::new();
    for _ in 0..5 {
        let result=(||{let image=RustImageData::from_bytes(bytes).map_err(err)?;let ctx=ClipboardContext::new().map_err(err)?;ctx.set_image(image).map_err(err)})();
        match result{Ok(())=>return Ok(()),Err(e)=>last=e}
        std::thread::sleep(Duration::from_millis(40));
    }
    Err(format!("图片复制失败，剪贴板可能正在被其它程序占用；图片仍保留，可重试或保存：{last}"))
}
