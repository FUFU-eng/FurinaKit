//! Confirmed crops only. No desktop frame persistence or third-party webview access.
use serde_json::{json, Value};
use std::{collections::BTreeMap, sync::Mutex};
use tauri::{Emitter, Manager};

#[derive(Clone)]
struct Shot {
    data: String,
    width: u32,
    height: u32,
    anchor: Option<(i32, i32)>,
    layout: Option<crate::capture_layout::PinLayout>,
}
static SHOTS: Mutex<BTreeMap<String, Shot>> = Mutex::new(BTreeMap::new());
static ACTION: Mutex<Option<Value>> = Mutex::new(None);
const MAX_BYTES: usize = 32 * 1024 * 1024;

fn decode(data: &str) -> Result<(Vec<u8>, u32, u32), String> {
    let b64 = data
        .strip_prefix("data:image/png;base64,")
        .ok_or("只接受 PNG 图片")?;
    if b64.len() > MAX_BYTES * 4 / 3 + 4 {
        return Err("截图超过 32 MiB，请缩小选区".into());
    }
    let bytes = crate::jobs::b64_decode_public(b64);
    let (w, h) =
        image::ImageReader::with_format(std::io::Cursor::new(&bytes), image::ImageFormat::Png)
            .into_dimensions()
            .map_err(|e| format!("图片格式错误：{e}"))?;
    if w == 0 || h == 0 || u64::from(w) * u64::from(h) > 24_000_000 {
        return Err("截图超过 2400 万像素，请缩小选区".into());
    }
    image::load_from_memory_with_format(&bytes, image::ImageFormat::Png)
        .map_err(|e| format!("PNG 内容不完整：{e}"))?;
    Ok((bytes, w, h))
}
fn label(id: &str, editor: bool) -> String {
    format!("{}-{id}", if editor { "shot-edit" } else { "shot-pin" })
}
fn owned(webview: &tauri::Webview, id: &str) -> Result<Shot, String> {
    if webview.label() != label(id, false) && webview.label() != label(id, true) {
        return Err("此窗口无权访问该截图".into());
    }
    SHOTS
        .lock()
        .map_err(|_| "截图状态异常")?
        .get(id)
        .cloned()
        .ok_or("截图已关闭".into())
}
fn fit_pin(app: &tauri::AppHandle, id: &str) -> Result<crate::capture_layout::PinLayout, String> {
    let shot = SHOTS
        .lock()
        .map_err(|_| "截图状态异常")?
        .get(id)
        .cloned()
        .ok_or("截图已关闭")?;
    let pin = app.get_webview_window(&label(id, false));
    let anchor = if let (Some(w), Some(old)) = (pin.as_ref(), shot.layout.as_ref()) {
        let pos = w.outer_position().map_err(|e| e.to_string())?;
        let dpi = w.scale_factor().map_err(|e| e.to_string())?;
        Some((
            pos.x
                + ((crate::capture_layout::PAD
                    + if old.dock_left {
                        crate::capture_layout::RAIL + crate::capture_layout::GAP
                    } else {
                        0.0
                    })
                    * dpi)
                    .round() as i32,
            pos.y + (crate::capture_layout::PAD * dpi).round() as i32,
        ))
    } else {
        shot.anchor
    };
    let base = pin
        .as_ref().map(|w| w.as_ref().window())
        .or_else(|| app.get_window("main"))
        .ok_or("找不到本地窗口")?;
    let monitors = base.available_monitors().map_err(|e| e.to_string())?;
    let monitor = anchor
        .and_then(|(x, y)| {
            monitors
                .iter()
                .find(|m| {
                    let p = m.position();
                    let z = m.size();
                    x >= p.x
                        && y >= p.y
                        && (x as i64) < p.x as i64 + z.width as i64
                        && (y as i64) < p.y as i64 + z.height as i64
                })
                .cloned()
        })
        .or(base.current_monitor().map_err(|e| e.to_string())?)
        .or_else(|| monitors.first().cloned())
        .ok_or("找不到显示器")?;
    let p = monitor.position();
    let z = monitor.size();
    let layout = crate::capture_layout::fit(
        shot.width,
        shot.height,
        monitor.scale_factor(),
        (p.x, p.y, z.width, z.height),
        anchor,
    );
    if let Some(w) = pin {
        w.set_position(tauri::PhysicalPosition::new(layout.x, layout.y))
            .map_err(|e| e.to_string())?;
        w.set_size(tauri::LogicalSize::new(layout.width, layout.height))
            .map_err(|e| e.to_string())?;
    }
    if let Some(s) = SHOTS.lock().map_err(|_| "截图状态异常")?.get_mut(id) {
        s.layout = Some(layout.clone());
    }
    Ok(layout)
}
fn open_window(app: &tauri::AppHandle, id: &str, editor: bool) -> Result<(), String> {
    let name = label(id, editor);
    if let Some(w) = app.get_webview_window(&name) {
        w.show().map_err(|e| e.to_string())?;
        return w.set_focus().map_err(|e| e.to_string());
    }
    let layout = if editor {
        None
    } else {
        Some(fit_pin(app, id)?)
    };
    let builder = tauri::WebviewWindowBuilder::new(
        app,
        &name,
        tauri::WebviewUrl::App(
            format!(
                "index.html?window={}&shotId={id}",
                if editor { "shot-editor" } else { "shot-pin" }
            )
            .into(),
        ),
    )
    .title(if editor {
        crate::ui_language::text("FurinaKit 图片编辑", "FurinaKit Image Editor")
    } else {
        crate::ui_language::text("FurinaKit 悬浮截图", "FurinaKit Pinned Screenshot")
    })
    .inner_size(
        layout.as_ref().map(|p| p.width).unwrap_or(980.0),
        layout.as_ref().map(|p| p.height).unwrap_or(740.0),
    )
    .min_inner_size(
        if editor { 380.0 } else { 1.0 },
        if editor { 280.0 } else { 1.0 },
    )
    .decorations(editor)
    .resizable(editor)
    .transparent(!editor)
    .shadow(editor)
    .always_on_top(!editor)
    .visible(false);
    let builder = if editor {
        builder.center()
    } else {
        builder.background_color(tauri::webview::Color(0, 0, 0, 0))
    };
    // Every isolated child shares the explicitly owned WebView directory, never a daily profile.
    #[cfg(windows)]
    let builder=if let Some(root)=crate::startup_policy::isolated_root()? {builder.data_directory(root.join("webview"))}else{builder};
    let w = builder.build().map_err(|e| e.to_string())?;
    if let Some(ref p) = layout {
        w.set_position(tauri::PhysicalPosition::new(p.x, p.y))
            .map_err(|e| e.to_string())?;
        w.set_size(tauri::LogicalSize::new(p.width, p.height))
            .map_err(|e| e.to_string())?;
    }
    if editor {
        if let Some(pin) = app.get_webview_window(&label(id, false)) {
            let _ = pin.hide();
        }
    }
    let app2 = app.clone();
    let id2 = id.to_owned();
    let other = label(id, !editor);
    let window = w.clone();
    w.on_window_event(move |e| {
        if matches!(e,tauri::WindowEvent::Destroyed){crate::capture_hit_region::forget(window.label());}
        if editor {
            if let tauri::WindowEvent::CloseRequested { api, .. } = e {
                api.prevent_close();
                let _ = window.emit("shot-close-requested", ());
            }
        }
        if editor && matches!(e, tauri::WindowEvent::Destroyed) {
            if let Some(pin) = app2.get_webview_window(&other) {
                let _ = pin.show();
            }
        }
        if matches!(e, tauri::WindowEvent::Destroyed) && app2.get_webview_window(&other).is_none() {
            if let Ok(mut s) = SHOTS.lock() {
                s.remove(&id2);
            }
        }
    });
    Ok(())
}

#[tauri::command]
pub async fn capture_floating(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    delay_ms: Option<u64>,
) -> Result<Value, String> {
    // capture_region verifies main/float-ball caller and restores their original visibility.
    if SHOTS.lock().map_err(|_| "截图状态异常")?.len() >= 8 {
        return Err("最多保留 8 张贴图，请先关闭不用的贴图和编辑器".into());
    }
    let result = crate::region_capture::capture_region(app.clone(), webview, delay_ms).await?;
    if result["cancelled"].as_bool() == Some(true) {
        return Ok(result);
    }
    let data = result["dataUrl"]
        .as_str()
        .ok_or("截图没有返回图片")?
        .to_owned();
    let anchor = result["region"]["x"]
        .as_i64()
        .zip(result["region"]["y"].as_i64())
        .and_then(|(x, y)| Some((i32::try_from(x).ok()?, i32::try_from(y).ok()?)));
    create_shot(&app, data, anchor)
}
// An explicit PNG upload may also be pinned without capturing the desktop.
#[tauri::command]
pub async fn pin_image(
    app: tauri::AppHandle,
    webview: tauri::Webview,
    data_url: String,
) -> Result<Value, String> {
    if webview.label() != "main" {
        return Err("仅主窗口可导入贴图".into());
    }
    create_shot(&app, data_url, None)
}
fn create_shot(
    app: &tauri::AppHandle,
    data: String,
    anchor: Option<(i32, i32)>,
) -> Result<Value, String> {
    let (_, width, height) = decode(&data)?;
    let id = crate::jobs::new_job_id_public();
    {
        let mut shots = SHOTS.lock().map_err(|_| "截图状态异常")?;
        if shots.len() >= 8
            || shots.values().map(|s| s.data.len()).sum::<usize>() + data.len() > 128 * 1024 * 1024
        {
            return Err("贴图缓存已满，请关闭不用的贴图".into());
        }
        shots.insert(
            id.clone(),
            Shot {
                data,
                width,
                height,
                anchor,
                layout: None,
            },
        );
    }
    if let Err(e) = open_window(app, &id, false) {
        SHOTS.lock().unwrap_or_else(|e| e.into_inner()).remove(&id);
        return Err(e);
    }
    Ok(json!({"success":true,"id":id}))
}
#[tauri::command]
pub fn shot_get(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    id: String,
) -> Result<Value, String> {
    let s = owned(&webview, &id)?;
    if let Some(w) = app
        .get_webview_window(webview.label())
        .filter(|_| webview.label() == label(&id, true))
    {
        w.show().map_err(|e| e.to_string())?;
    }
    Ok(json!({"dataUrl":s.data,"width":s.width,"height":s.height,"layout":s.layout,"pinned":app.get_webview_window(webview.label()).and_then(|w|w.is_always_on_top().ok()).unwrap_or(false)}))
}
#[tauri::command]
pub async fn shot_shape(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    id: String,
    areas: Vec<crate::capture_hit_region::Area>,
) -> Result<(), String> {
    owned(&webview, &id)?;
    if webview.label() != label(&id, false) {
        return Err("仅贴图可设置透明交互边界".into());
    }
    let window = app
        .get_webview_window(webview.label())
        .ok_or("贴图窗口已关闭")?;
    tauri::async_runtime::spawn_blocking(move||crate::capture_hit_region::apply(&window, &areas)).await.map_err(|e|e.to_string())?
}
#[tauri::command]
pub async fn shot_window(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    id: String,
    operation: String,
    display_width: Option<f64>,
    display_height: Option<f64>,
    offset_x: Option<f64>,
    offset_y: Option<f64>,
) -> Result<(), String> {
    owned(&webview, &id)?;
    let w = app
        .get_webview_window(webview.label())
        .ok_or("窗口已关闭")?;
    if crate::capture_validation::enabled() && !crate::capture_validation::shot_window_allowed(&operation) {
        return Err("Window operation unavailable in capture/save validation".into());
    }
    match operation.as_str() {
        "ready" => {
            // A hidden pin may reload while its editor saves; do not surface it over that editor.
            if webview.label() == label(&id, false)
                && app.get_webview_window(&label(&id, true)).is_some()
            {
                return Ok(());
            }
            w.show().map_err(|e| e.to_string())?;
            w.set_focus().map_err(|e| e.to_string())
        }
        "pin" => w.set_always_on_top(true).map_err(|e|e.to_string()),
        "unpin" => w.set_always_on_top(false).map_err(|e|e.to_string()),
        "close" => w.destroy().map_err(|e| e.to_string()),
        "drag" => {
            w.emit("shot-drag-state",true).map_err(|e|e.to_string())?;
            #[cfg(windows)] {
                // Move the actual HWND in physical pixels. Do not enter Windows' outline-drag
                // loop, whose behaviour depends on the user's "show window contents" setting.
                #[repr(C)] struct Point{x:i32,y:i32}
                #[link(name="user32")] extern "system"{fn GetCursorPos(p:*mut Point)->i32;fn GetAsyncKeyState(k:i32)->i16;fn SetWindowPos(w:isize,after:isize,x:i32,y:i32,cx:i32,cy:i32,flags:u32)->i32;fn IsWindow(w:isize)->i32;}
                let origin=w.outer_position().map_err(|e|e.to_string())?;
                let hwnd=w.hwnd().map_err(|e|e.to_string())?.0 as isize;
                let mut point=Point{x:0,y:0};if unsafe{GetCursorPos(&mut point)}==0{return Err("无法读取鼠标位置".into());}
                let first=(point.x,point.y);let observer=w.clone();
                std::thread::spawn(move||{
                    let start=std::time::Instant::now();
                    while start.elapsed()<std::time::Duration::from_secs(180) && unsafe{GetAsyncKeyState(1)}<0 && unsafe{IsWindow(hwnd)}!=0{
                        let mut p=Point{x:0,y:0};if unsafe{GetCursorPos(&mut p)}!=0{unsafe{SetWindowPos(hwnd,0,origin.x+p.x-first.0,origin.y+p.y-first.1,0,0,0x0015);}}
                        std::thread::sleep(std::time::Duration::from_millis(8));
                    }
                    let _=observer.emit("shot-drag-state",false);
                });
                Ok(())
            }
            #[cfg(not(windows))] {let result=w.start_dragging().map_err(|e|e.to_string());let _=w.emit("shot-drag-state",false);result}
        },
        "resize" => {
            if webview.label()!=label(&id,false){return Err("仅贴图可缩放".into());}
            let width=display_width.ok_or("缺少宽度")?;let height=display_height.ok_or("缺少高度")?;
            let dx=offset_x.unwrap_or(0.0);let dy=offset_y.unwrap_or(0.0);
            if ![width,height,dx,dy].iter().all(|v|v.is_finite())||width<16.0||height<16.0{return Err("缩放尺寸无效".into());}
            let monitor=w.current_monitor().map_err(|e|e.to_string())?.ok_or("显示器不可用")?;let dpi=w.scale_factor().map_err(|e|e.to_string())?;
            let pos=w.outer_position().map_err(|e|e.to_string())?;
            let mut shots=SHOTS.lock().map_err(|_|"截图状态异常")?;let shot=shots.get_mut(&id).ok_or("截图已关闭")?;let layout=shot.layout.as_mut().ok_or("布局未就绪")?;
            let iw=width.min((monitor.size().width as f64/dpi-2.0*crate::capture_layout::PAD-crate::capture_layout::GAP-crate::capture_layout::RAIL).max(16.0));
            let ih=height.min((monitor.size().height as f64/dpi-2.0*crate::capture_layout::PAD).max(16.0));
            layout.image_width=iw;layout.image_height=ih;layout.width=iw+2.0*crate::capture_layout::PAD+crate::capture_layout::GAP+crate::capture_layout::RAIL;layout.height=ih.max(crate::capture_layout::RAIL_HEIGHT.min(monitor.size().height as f64/dpi-2.0*crate::capture_layout::PAD))+2.0*crate::capture_layout::PAD;
            layout.x=pos.x+(dx*dpi).round() as i32;layout.y=pos.y+(dy*dpi).round() as i32;
            let next=layout.clone();drop(shots);
            w.set_size(tauri::LogicalSize::new(next.width,next.height)).map_err(|e|e.to_string())?;
            w.set_position(tauri::PhysicalPosition::new(next.x,next.y)).map_err(|e|e.to_string())?;
            w.emit("shot-layout",next).map_err(|e|e.to_string())
        },
        "edit" => open_window(&app, &id, true),
        _ => Err("未知窗口操作".into()),
    }
}
#[tauri::command]
pub fn shot_update(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    id: String,
    data_url: String,
) -> Result<(), String> {
    // owned() restricts both inline and detached editors to their own screenshot.
    let previous = owned(&webview, &id)?;
    let (_, width, height) = decode(&data_url)?;
    {
        let mut shots = SHOTS.lock().map_err(|_| "截图状态异常")?;
        let total = shots
            .iter()
            .filter(|(k, _)| *k != &id)
            .map(|(_, v)| v.data.len())
            .sum::<usize>();
        if total + data_url.len() > 128 * 1024 * 1024 {
            return Err("贴图缓存已满".into());
        }
        shots.insert(
            id.clone(),
            Shot {
                data: data_url,
                width,
                height,
                anchor: previous.anchor,
                layout: previous.layout.clone(),
            },
        );
    }
    if previous.layout.is_none(){fit_pin(&app, &id)?;}
    if let Some(w) = app.get_webview_window(&label(&id, false)) {
        let _ = w.emit("shot-updated", ());
    }
    Ok(())
}
#[tauri::command]
pub async fn shot_save(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    id: String,
    data_url: Option<String>,
) -> Result<bool, String> {
    let s = owned(&webview, &id)?;
    let data = if let Some(data) = data_url {
        if webview.label() != label(&id, true) {
            return Err("仅编辑器可另存未应用的编辑内容".into());
        }
        data
    } else {
        s.data
    };
    let (bytes, _, _) = decode(&data)?;
    tauri::async_runtime::spawn_blocking(move || {
        crate::default_output::save_bytes(&app, &bytes, "截图.png")?;
        Ok(true)
    })
    .await
    .map_err(|e| e.to_string())?
}
#[tauri::command]
pub async fn shot_action(
    webview: tauri::Webview,
    app: tauri::AppHandle,
    id: String,
    action: String,
) -> Result<(), String> {
    let s = owned(&webview, &id)?;
    if crate::capture_validation::enabled() && !crate::capture_validation::shot_action_allowed(&action) {
        return Err("Screenshot action unavailable in capture/save validation".into());
    }
    if action == "copy" {
        return crate::commands::clipboard_write_image(
            app,
            s.data
                .trim_start_matches("data:image/png;base64,")
                .to_owned(),
        ).await;
    }
    if !["ocr", "translate", "upscale", "pending"].contains(&action.as_str()) {
        return Err("不支持的截图动作".into());
    }
    let main = app
        .get_window("main")
        .ok_or("主窗口不存在，截图仍保留在贴图中")?;
    let request_id = crate::jobs::new_job_id_public();
    {
        let mut q = ACTION.lock().map_err(|_| "动作队列异常")?;
        if q.is_some() {
            return Err("上一个截图动作尚未被主窗口接收，请稍后重试".into());
        }
        *q = Some(
            json!({"requestId":request_id,"action":action,"dataUrl":s.data,"width":s.width,"height":s.height}),
        );
    }
    let result = (|| {
        main.unminimize().map_err(|e| e.to_string())?;
        main.show().map_err(|e| e.to_string())?;
        main.set_focus().map_err(|e| e.to_string())?;
        main.emit("capture-action-ready", ())
            .map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let mut q = ACTION.lock().unwrap_or_else(|e| e.into_inner());
        if q.as_ref().and_then(|v| v["requestId"].as_str()) == Some(&request_id) {
            q.take();
        }
    }
    result
}
#[tauri::command]
pub fn shot_take_action(webview: tauri::Webview) -> Result<Option<Value>, String> {
    if webview.label() != "main" {
        return Err("仅主窗口可接收截图动作".into());
    }
    Ok(ACTION.lock().map_err(|_| "动作队列异常")?.take())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn wrong_format_rejected() {
        assert!(decode("data:text/plain;base64,YQ==").is_err());
    }
    #[test]
    fn malformed_png_rejected() {
        assert!(decode("data:image/png;base64,YQ==").is_err());
    }
    #[test]
    fn labels_are_disjoint() {
        assert_ne!(label("test", false), label("test", true));
    }
    #[test]
    fn png_dimensions_preserved() {
        let img = image::RgbaImage::new(19, 31);
        let mut b = std::io::Cursor::new(Vec::new());
        image::DynamicImage::ImageRgba8(img)
            .write_to(&mut b, image::ImageFormat::Png)
            .unwrap();
        let u = format!(
            "data:image/png;base64,{}",
            crate::jobs::b64_encode_public(b.get_ref())
        );
        let (_, w, h) = decode(&u).unwrap();
        assert_eq!((w, h), (19, 31));
    }
}
