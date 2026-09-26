//! Native window shape: transparent space below/around a pin must not cover the desktop.
use serde::Deserialize;
type Rects=Vec<(i32,i32,i32,i32)>;
static SHAPES:std::sync::Mutex<std::collections::BTreeMap<String,Rects>>=std::sync::Mutex::new(std::collections::BTreeMap::new());
pub fn forget(label:&str){if let Ok(mut shapes)=SHAPES.lock(){shapes.remove(label);}}
#[derive(Clone, Deserialize)]
pub struct Area {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
fn pixels(areas: &[Area], dpi: f64, size: (u32, u32)) -> Result<Vec<(i32, i32, i32, i32)>, String> {
    if areas.is_empty()
        || areas.len() > 32
        || !dpi.is_finite()
        || dpi <= 0.0
        || size.0 > i32::MAX as u32
        || size.1 > i32::MAX as u32
    {
        return Err("无效的贴图交互区域".into());
    }
    let mut out = Vec::new();
    for r in areas {
        if ![r.x, r.y, r.width, r.height].iter().all(|n| n.is_finite())
            || r.width <= 0.0
            || r.height <= 0.0

        {
            return Err("贴图交互区域超出窗口".into());
        }
        // During DPI/layout changes, intersect finite rectangles with the client size rather than rejecting them.
        // Reserve the CSS shadow/entrance-animation area without making the entire window solid.
        let left = ((r.x - 16.0) * dpi).floor().clamp(0.0, size.0 as f64) as i32;
        let top = ((r.y - 16.0) * dpi).floor().clamp(0.0, size.1 as f64) as i32;
        let right = ((r.x + r.width + 16.0) * dpi)
            .ceil()
            .clamp(0.0, size.0 as f64) as i32;
        let bottom = ((r.y + r.height + 16.0) * dpi)
            .ceil()
            .clamp(0.0, size.1 as f64) as i32;
        if right > left && bottom > top {
            out.push((left, top, right, bottom));
        }
    }
    if out.is_empty() {
        return Err("贴图交互区域为空".into());
    }
    Ok(out)
}
pub fn apply(window: &tauri::WebviewWindow, areas: &[Area]) -> Result<(), String> {
    let size = window.inner_size().map_err(|e| e.to_string())?;
    let rects = pixels(
        areas,
        window.scale_factor().map_err(|e| e.to_string())?,
        (size.width, size.height),
    )?;
    if SHAPES.lock().map_err(|_|"交互区域缓存异常")?.get(window.label())==Some(&rects){return Ok(());}
    #[cfg(windows)]
    {
        set_shape(window, &rects)?;
    }
    #[cfg(not(windows))]
    {
        let _ = &rects;
    }
    SHAPES.lock().map_err(|_|"交互区域缓存异常")?.insert(window.label().to_owned(),rects);
    Ok(())
}
#[cfg(windows)]
fn set_shape(window: &tauri::WebviewWindow, rects: &[(i32, i32, i32, i32)]) -> Result<(), String> {
    #[link(name = "gdi32")]
    extern "system" {
        fn CreateRectRgn(l: i32, t: i32, r: i32, b: i32) -> isize;
        fn CombineRgn(dest: isize, a: isize, b: isize, mode: i32) -> i32;
        fn DeleteObject(object: *mut std::ffi::c_void) -> i32;
    }
    #[link(name = "user32")]
    extern "system" {
        fn SetWindowRgn(hwnd: isize, region: isize, redraw: i32) -> i32;
    }
    let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as isize;
    unsafe {
        let region = CreateRectRgn(0, 0, 0, 0);
        if region == 0 {
            return Err("创建贴图窗口区域失败".into());
        }
        for &(l, t, r, b) in rects {
            let part = CreateRectRgn(l, t, r, b);
            if part == 0 {
                DeleteObject(region as *mut std::ffi::c_void);
                return Err("创建贴图子区域失败".into());
            }
            let ok = CombineRgn(region, region, part, 2);
            DeleteObject(part as *mut std::ffi::c_void);
            if ok == 0 {
                DeleteObject(region as *mut std::ffi::c_void);
                return Err("合并贴图窗口区域失败".into());
            }
        }
        // Windows takes ownership only when SetWindowRgn succeeds.
        if SetWindowRgn(hwnd, region, 1) == 0 {
            DeleteObject(region as *mut std::ffi::c_void);
            return Err("设置贴图点击穿透边界失败".into());
        }
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn physical_bounds_at_fractional_dpi() {
        assert_eq!(
            pixels(
                &[Area {
                    x: 16.0,
                    y: 16.0,
                    width: 400.0,
                    height: 200.0
                }],
                1.5,
                (900, 600)
            )
            .unwrap(),
            vec![(0, 0, 648, 348)]
        );
    }
    #[test]
    fn blank_space_below_short_image_is_outside_region() {
        let rs = pixels(
            &[
                Area {
                    x: 16.0,
                    y: 16.0,
                    width: 120.0,
                    height: 40.0,
                },
                Area {
                    x: 148.0,
                    y: 16.0,
                    width: 96.0,
                    height: 324.0,
                },
            ],
            1.0,
            (260, 356),
        )
        .unwrap();
        assert!(!rs
            .iter()
            .any(|&(l, t, r, b)| 30 >= l && 30 < r && 250 >= t && 250 < b));
    }
    #[test]
    fn nonfinite_shape_is_rejected() {
        assert!(pixels(
            &[Area {
                x: f64::NAN,
                y: 0.0,
                width: 20.0,
                height: 20.0
            }],
            1.0,
            (100, 100)
        )
        .is_err());
    }
    #[test]
    fn shape_is_clipped_to_client_area() {
        assert_eq!(
            pixels(
                &[Area {
                    x: -5.0,
                    y: -5.0,
                    width: 100.0,
                    height: 100.0
                }],
                1.0,
                (100, 100)
            )
            .unwrap(),
            vec![(0, 0, 100, 100)]
        );
    }
    #[test]
    fn toast_can_extend_the_hit_region() {
        let rs = pixels(
            &[
                Area {
                    x: 16.0,
                    y: 16.0,
                    width: 120.0,
                    height: 40.0,
                },
                Area {
                    x: 148.0,
                    y: 16.0,
                    width: 96.0,
                    height: 324.0,
                },
                Area {
                    x: 16.0,
                    y: 310.0,
                    width: 228.0,
                    height: 30.0,
                },
            ],
            1.0,
            (260, 356),
        )
        .unwrap();
        assert!(rs
            .iter()
            .any(|&(l, t, r, b)| 30 >= l && 30 < r && 320 >= t && 320 < b));
    }
}
