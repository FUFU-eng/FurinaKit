//! Geometry for borderless pinned images. Source pixels remain untouched.
use serde::Serialize;
pub const PAD: f64 = 16.0;
pub const GAP: f64 = 12.0;
pub const RAIL: f64 = 210.0;
pub const RAIL_HEIGHT: f64 = 400.0;
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PinLayout {
    pub width: f64,
    pub height: f64,
    pub image_width: f64,
    pub image_height: f64,
    pub x: i32,
    pub y: i32,
    pub dock_left: bool,
}
pub fn fit(
    width: u32,
    height: u32,
    dpi: f64,
    monitor: (i32, i32, u32, u32),
    anchor: Option<(i32, i32)>,
) -> PinLayout {
    let dpi = if dpi.is_finite() && dpi > 0.0 {
        dpi
    } else {
        1.0
    };
    let mw = monitor.2 as f64 / dpi;
    let mh = monitor.3 as f64 / dpi;
    let iw = width.max(1) as f64 / dpi;
    let ih = height.max(1) as f64 / dpi;
    let scale = 1.0_f64
        .min(((mw - 2.0 * PAD - GAP - RAIL).max(1.0)) / iw)
        .min((mh - 2.0 * PAD).max(1.0) / ih);
    let image_width = iw * scale;
    let image_height = ih * scale;
    let width = image_width + GAP + RAIL + 2.0 * PAD;
    let height = image_height.max(RAIL_HEIGHT.min((mh - 2.0 * PAD).max(1.0))) + 2.0 * PAD;
    let (ax, ay) = anchor.unwrap_or((
        monitor.0 + ((mw - width) * dpi / 2.0 + PAD * dpi).round() as i32,
        monitor.1 + ((mh - height) * dpi / 2.0 + PAD * dpi).round() as i32,
    ));
    let dock_left = ax as f64 + (image_width + GAP + RAIL + PAD) * dpi
        > (monitor.0 as f64 + monitor.2 as f64)
        && ax as f64 - (PAD + GAP + RAIL) * dpi >= monitor.0 as f64;
    let image_offset = PAD + if dock_left { RAIL + GAP } else { 0.0 };
    let x = (ax as f64 - image_offset * dpi).clamp(
        monitor.0 as f64,
        (monitor.0 as f64 + monitor.2 as f64 - width * dpi).max(monitor.0 as f64),
    );
    let y = (ay as f64 - PAD * dpi).clamp(
        monitor.1 as f64,
        (monitor.1 as f64 + monitor.3 as f64 - height * dpi).max(monitor.1 as f64),
    );
    PinLayout {
        width,
        height,
        image_width,
        image_height,
        x: x.round() as i32,
        y: y.round() as i32,
        dock_left,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_pixel_scale_and_anchor_at_150_percent() {
        let p = fit(600, 300, 1.5, (0, 0, 2560, 1600), Some((300, 300)));
        assert_eq!(p.image_width, 400.0);
        assert_eq!(p.image_height, 200.0);
        assert_eq!(p.x, 276);
        assert_eq!(p.y, 276);
    }
    #[test]
    fn rail_flips_before_moving_image() {
        let p = fit(400, 300, 1.0, (0, 0, 1920, 1080), Some((1450, 300)));
        assert!(p.dock_left);
        assert_eq!(p.x + (PAD + RAIL + GAP) as i32, 1450);
    }
    #[test]
    fn large_images_fit_without_distortion() {
        let p = fit(4000, 2000, 1.5, (0, 0, 1920, 1080), None);
        assert!(p.width * 1.5 <= 1921.0);
        assert!(p.height * 1.5 <= 1081.0);
        assert!((p.image_width / p.image_height - 2.0).abs() < 0.00001);
    }
    #[test]
    fn negative_monitor_origin_is_preserved() {
        let p = fit(400, 200, 1.0, (-1920, 0, 1920, 1080), Some((-1700, 200)));
        assert_eq!(p.x, -1716);
    }
}
