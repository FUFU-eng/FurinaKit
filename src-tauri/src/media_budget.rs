//! Bounded codec budgets, estimated from pixel surfaces; not memory reservations.
use serde_json::Value;
const MIB: u64 = 1024 * 1024;
const BASE: u64 = 512 * MIB;
const MAX: u64 = 4096 * MIB;
const STEP: u64 = 128 * MIB;
#[derive(Clone, Copy, Debug)]
pub(crate) struct Budget {
    pub memory: usize,
    pub allocation: usize,
}
fn pixels(w: u64, h: u64) -> Result<u64, String> {
    if w == 0 || h == 0 {
        return Err("Invalid media dimensions".into());
    }
    w.checked_mul(h)
        .ok_or_else(|| "Media dimensions overflow".into())
}
fn round(value: u64) -> Result<u64, String> {
    value
        .checked_add(STEP - 1)
        .and_then(|v| (v / STEP).checked_mul(STEP))
        .ok_or_else(|| "Media budget overflow".into())
}
fn admit(estimate: u64, allocation: u64, available: u64) -> Result<Budget, String> {
    let memory = round(estimate)?.max(BASE);
    let allocation = round(allocation)?.max(256 * MIB);
    if memory > MAX || allocation > memory / 2 {
        return Err("分辨率超过本机处理策略上限，请降低分辨率或输出宽度 / Resolution exceeds the bounded media policy; reduce resolution or output width".into());
    }
    // An estimate is not a minimum allocation. Cap it to current headroom instead
    // of rejecting operations that may use much less (e.g. large JPEG frames).
    // Preserve the existing 512 MiB baseline under pressure; never reserve RAM.
    let available_cap = (available.saturating_sub(BASE) / STEP * STEP)
        .max(BASE)
        .min(MAX);
    let memory = memory.min(available_cap);
    let allocation = allocation.min(memory / 2);
    Ok(Budget {
        memory: memory as usize,
        allocation: allocation as usize,
    })
}
#[cfg(windows)]
fn available() -> Result<u64, String> {
    #[repr(C)]
    struct Status {
        length: u32,
        load: u32,
        values: [u64; 7],
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn GlobalMemoryStatusEx(status: *mut Status) -> i32;
    }
    let mut s = Status {
        length: std::mem::size_of::<Status>() as u32,
        load: 0,
        values: [0; 7],
    };
    if unsafe { GlobalMemoryStatusEx(&mut s) } == 0 {
        return Err("Cannot query available codec memory".into());
    }
    // Job limits count committed pages, not resident working-set bytes. Using
    // currently free physical RAM as that limit incorrectly rejects paging-capable
    // codecs. Keep a low-physical-memory guard, a half-total-RAM envelope, and
    // a global commit headroom; this is not a promise of zero paging.
    Ok(commit_envelope(s.values[0], s.values[1], s.values[3]))
}
fn commit_envelope(total: u64, physical: u64, commit: u64) -> u64 {
    if physical < BASE {
        BASE
    } else {
        commit.min(total / 2 + BASE)
    }
}
#[cfg(not(windows))]
fn available() -> Result<u64, String> {
    Err("Adaptive codec budget requires the Windows memory provider".into())
}
fn finish(estimate: u64, allocation: u64) -> Result<Budget, String> {
    admit(
        estimate,
        allocation,
        if estimate > BASE {
            available()?
        } else {
            u64::MAX
        },
    )
}
pub(crate) fn video(w: u64, h: u64, precise: bool, webm: bool) -> Result<Budget, String> {
    if !precise {
        return admit(BASE, 256 * MIB, u64::MAX);
    }
    let estimate = pixels(w, h)?
        .checked_mul(if webm { 192 } else { 224 })
        .and_then(|n| n.checked_add(256 * MIB))
        .ok_or("Video memory estimate overflow")?;
    finish(estimate, 256 * MIB)
}
fn frame_estimate(w: u64, h: u64, width: Option<u32>, swap: bool) -> Result<(u64, u64), String> {
    let source = pixels(w, h)?;
    let (w, h) = if swap { (h, w) } else { (w, h) };
    let out = if let Some(width) = width {
        let width = width as u64;
        let height = width
            .checked_mul(h)
            .and_then(|v| v.checked_add(w - 1))
            .map(|v| v / w)
            .and_then(|v| v.checked_add(1))
            .map(|v| v / 2 * 2)
            .ok_or("Frame dimensions overflow")?;
        pixels(width, height)?
    } else {
        source
    };
    let estimate = out
        .checked_mul(24)
        .and_then(|n| source.checked_mul(16).and_then(|s| n.checked_add(s)))
        .and_then(|n| n.checked_add(256 * MIB))
        .ok_or("Frame memory estimate overflow")?;
    Ok((
        estimate,
        out.checked_mul(8)
            .ok_or("Frame allocation estimate overflow")?,
    ))
}
pub(crate) fn frame(w: u64, h: u64, width: Option<u32>, swap: bool) -> Result<Budget, String> {
    let (e, a) = frame_estimate(w, h, width, swap)?;
    finish(e, a)
}
pub(crate) fn swaps_axes(stream: &Value) -> bool {
    let angle = stream["side_data_list"]
        .as_array()
        .and_then(|items| items.iter().find_map(|s| s["rotation"].as_f64()))
        .or_else(|| {
            stream["tags"]["rotate"]
                .as_str()
                .and_then(|s| s.parse::<f64>().ok())
        })
        .unwrap_or(0.0);
    angle.is_finite() && ((angle.abs() % 180.0) - 90.0).abs() < 0.01
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn small_media_stays_at_previous_budget_and_large_policy_is_bounded() {
        assert_eq!(admit(300 * MIB, 16 * MIB, 0).unwrap().memory, BASE as usize);
        let (e, a) = frame_estimate(3840, 2160, Some(16384), false).unwrap();
        let b = admit(e, a, 64 * 1024 * MIB).unwrap();
        assert_eq!(b.memory, 3840 * MIB as usize);
        assert_eq!(b.allocation, 1152 * MIB as usize);
        assert_eq!(admit(e, a, 1536 * MIB).unwrap().memory, 1024 * MIB as usize);
        assert_eq!(admit(e, a, 400 * MIB).unwrap().memory, 512 * MIB as usize);
        assert!(admit(MAX + 1, 256 * MIB, u64::MAX).is_err());
        assert!(frame_estimate(u64::MAX, 2, None, false).is_err());
        assert!(frame_estimate(0, 1080, None, false).is_err());
        assert_eq!(commit_envelope(8192 * MIB, 400 * MIB, 8192 * MIB), BASE);
        assert_eq!(
            commit_envelope(8192 * MIB, 2048 * MIB, 8192 * MIB),
            4608 * MIB
        );
        assert_eq!(
            commit_envelope(8192 * MIB, 2048 * MIB, 2048 * MIB),
            2048 * MIB
        );
    }
    #[test]
    fn rotated_scaling_and_overflow_are_explicit() {
        let (a, _) = frame_estimate(3840, 2160, Some(8192), false).unwrap();
        let (b, _) = frame_estimate(3840, 2160, Some(8192), true).unwrap();
        assert!(b > a);
        let (e, a) = frame_estimate(3840, 2160, Some(16384), true).unwrap();
        assert!(admit(e, a, u64::MAX).is_err());
        assert!(swaps_axes(&json!({"side_data_list":[{"rotation":-90}]})));
        assert!(!swaps_axes(&json!({"side_data_list":[{"rotation":180}]})));
    }
}
