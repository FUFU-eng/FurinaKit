//! 老照片修复：Rust 原生实现，替代 services/worker/app/tools/photo_restore.py（OpenCV）。
//!
//! 流程与 Python 版相同：去噪 → 白平衡 → 亮度拉伸 → CLAHE → 锐化（默认关）。
//! 用到的 OpenCV 部件逐个移植，并尽量做到逐位一致：
//!   · cvtColor RGB↔Lab（8 位整数版：RGB2Lab_b / Lab2RGBinteger，含 sRGB 与线性两种）；
//!   · fastNlMeansDenoisingColored（LBGR2Lab → L 与 ab 分别做 NLM → 回转；
//!     DistSquared、定点权重表、近似平均距离的移位，都与 fast_nlmeans_denoising_invoker.hpp 相同）；
//!   · createCLAHE(clip, 8×8)（直方图裁剪/重分配、双线性插值、REFLECT_101 补边规则一致）；
//!   · GaussianBlur(σ=2) + addWeighted 锐化。

use std::sync::OnceLock;

use image::RgbImage;
use serde_json::{json, Value};

use crate::matting_native::{load_image, number, progress, results_path, text};

// ───────────────────────── 任务入口 ─────────────────────────

pub(crate) fn photo_restore(app: &tauri::AppHandle, id: &str, input: &str, stem: &str, payload: &Value) -> Result<Value, String> {
    let img = load_image(input)?.to_rgb8();
    let opts = RestoreOptions::from_payload(payload);
    progress(app, id, 20, "正在修复老照片…");
    let r = restore(&img, &opts, |pct, msg| progress(app, id, pct, msg));
    progress(app, id, 92, "正在保存结果…");
    let plain = format!("{stem}_已修复.png");
    let path = results_path(app, id, &plain)?;
    r.image.save(&path).map_err(|_| "图片保存失败".to_string())?;
    let (w, h) = r.image.dimensions();
    Ok(json!({ "path": path.to_string_lossy(), "filename": plain, "mime": "image/png",
               "message": r.message(), "width": w, "height": h,
               "steps": r.steps, "colorCastBefore": r.cast_before, "colorCastAfter": r.cast_after,
               "contrastBefore": r.contrast_before, "contrastAfter": r.contrast_after }))
}

#[derive(Clone, Debug)]
pub(crate) struct RestoreOptions {
    pub balance: f64,
    pub denoise: i64,
    pub contrast: f64,
    pub sharpen: f64,
    pub keep_tone: bool,
}

impl RestoreOptions {
    pub(crate) fn from_payload(p: &Value) -> Self {
        RestoreOptions {
            balance: number(p, "balance", 0.8),
            denoise: number(p, "denoise", 6.0) as i64,
            contrast: number(p, "contrast", 1.2),
            sharpen: number(p, "sharpen", 0.0),
            keep_tone: text(p, "keep_tone", "no") == "yes",
        }
    }
}

pub(crate) struct RestoreResult {
    pub image: RgbImage,
    pub steps: Vec<String>,
    pub cast_before: f64,
    pub cast_after: f64,
    pub contrast_before: f64,
    pub contrast_after: f64,
}

impl RestoreResult {
    pub(crate) fn message(&self) -> String {
        format!(
            "已修复：{}（色偏 {} → {}，层次 {} → {}）",
            self.steps.join(" → "),
            py_float(self.cast_before),
            py_float(self.cast_after),
            py_float(self.contrast_before),
            py_float(self.contrast_after)
        )
    }
}

/// Python 的 str(float)（值已 round 到 2 位）
fn py_float(v: f64) -> String {
    if v == v.trunc() {
        format!("{v:.1}")
    } else {
        let s = format!("{v:.2}");
        let s = s.trim_end_matches('0');
        s.to_string()
    }
}

fn round2(v: f64) -> f64 {
    // Python round(x, 2)：四舍六入五成双（对二进制表示而言），这里用同样的思路
    let s = format!("{:.2}", v);
    s.parse::<f64>().unwrap_or(v)
}

pub(crate) fn restore(img: &RgbImage, o: &RestoreOptions, mut progress: impl FnMut(u32, &str)) -> RestoreResult {
    let mut steps = Vec::new();
    let mut out = img.clone();
    if o.denoise > 0 {
        progress(30, "正在去噪…");
        out = nl_means_colored(&out, o.denoise as f32, o.denoise as f32, 7, 21);
        steps.push(format!("去噪（{}）", o.denoise));
    }
    if !o.keep_tone {
        progress(70, "正在去黄、提亮…");
        out = auto_white_balance(&out, o.balance);
        steps.push(format!("去黄褪色（强度 {}）", py_num(o.balance)));
        out = stretch_levels(&out, 200.0);
        steps.push("提亮到正常黑白点".to_string());
    }
    if o.contrast > 0.0 {
        progress(80, "正在提升层次…");
        out = enhance_contrast(&out, o.contrast, 8);
        steps.push(format!("提升层次（{}）", py_num(o.contrast)));
    }
    if o.sharpen > 0.0 {
        out = unsharp(&out, o.sharpen, 2.0);
        steps.push(format!("锐化（{}，会略微提高颗粒感）", py_num(o.sharpen)));
    }
    let warm = |im: &RgbImage| {
        let (mut r, mut g, mut b) = (0f64, 0f64, 0f64);
        for p in im.pixels() {
            r += p[0] as f64;
            g += p[1] as f64;
            b += p[2] as f64;
        }
        let n = (im.width() as f64 * im.height() as f64).max(1.0);
        let (r, g, b) = (r / n, g / n, b / n);
        if g < 1.0 { 0.0 } else { (r - b) / g }
    };
    let std_gray = |im: &RgbImage| {
        let g = gray(im);
        let n = g.len().max(1) as f64;
        let mean = g.iter().map(|v| *v as f64).sum::<f64>() / n;
        (g.iter().map(|v| { let d = *v as f64 - mean; d * d }).sum::<f64>() / n).sqrt()
    };
    RestoreResult {
        cast_before: round2(warm(img) * 100.0),
        cast_after: round2(warm(&out) * 100.0),
        contrast_before: round2(std_gray(img)),
        contrast_after: round2(std_gray(&out)),
        image: out,
        steps,
    }
}

/// Python 里 float 参数的 str()：0.8 → "0.8"，1.0 → "1.0"
fn py_num(v: f64) -> String {
    if v == v.trunc() { format!("{v:.1}") } else { format!("{v}") }
}

fn gray(im: &RgbImage) -> Vec<u8> {
    // OpenCV RGB2Gray<uchar>：15 位定点（RY15/GY15/BY15）
    im.pixels()
        .map(|p| ((p[0] as u32 * 9798 + p[1] as u32 * 19235 + p[2] as u32 * 3735 + (1 << 14)) >> 15) as u8)
        .collect()
}

#[inline]
fn cv_round_f32(v: f32) -> i32 {
    v.round_ties_even() as i32
}
#[inline]
fn cv_round_f64(v: f64) -> i64 {
    v.round_ties_even() as i64
}
#[inline]
fn sat_u8(v: i64) -> u8 {
    v.clamp(0, 255) as u8
}
#[inline]
fn descale(x: i32, n: u32) -> i32 {
    (x + (1 << (n - 1))) >> n
}

// ───────────────────────── Lab（OpenCV 8 位整数实现） ─────────────────────────

const XYZ_SHIFT: u32 = 12;
const GAMMA_SHIFT: u32 = 3;
const LAB_SHIFT2: u32 = XYZ_SHIFT + GAMMA_SHIFT;
const LUT_BASE: i32 = 1 << 14;
const MIN_AB: i32 = -8145;

const SRGB2XYZ: [u64; 9] = [
    0x3fda65a14488c60d, 0x3fd6e297396d0918, 0x3fc71819d2391d58,
    0x3fcb38cda6e75ff6, 0x3fe6e297396d0918, 0x3fb279aae6c8f755,
    0x3f93cc4ac6cdaf4b, 0x3fbe836eb4e98138, 0x3fee68427418d691,
];
const XYZ2SRGB: [u64; 9] = [
    0x4009ec804102ff8f, 0xbff8982a9930be0e, 0xbfdfe7ff583a53b9,
    0xbfef042528ae74f3, 0x3ffe040f23897204, 0x3fa546d3f9e7b80b,
    0x3fac7de5082cf52c, 0xbfca1e14bdfd2631, 0x3ff0eabef06b3786,
];

struct LabTabs {
    srgb_gamma: [u16; 256],
    srgb_inv_gamma: Vec<u16>,
    cbrt: Vec<u16>,
    lab_to_yf: [u16; 512],
    ab_to_xz: Vec<i32>,
    /// RGB→XYZ（已除白点），按行 X/Y/Z，列 R/G/B
    fwd: [i32; 9],
    /// XYZ→RGB（已乘白点），按行 R/G/B，列 X/Y/Z
    inv: [i32; 9],
}

fn apply_gamma(x: f32) -> f32 {
    let xd = x as f64;
    (if xd <= 809.0 / 20000.0 { xd / (323.0 / 25.0) } else { ((xd + 11.0 / 200.0) / (1.0 + 11.0 / 200.0)).powf(12.0 / 5.0) }) as f32
}
fn apply_inv_gamma(x: f32) -> f32 {
    let xd = x as f64;
    (if xd <= 7827.0 / 2500000.0 { xd * (323.0 / 25.0) } else { xd.powf(5.0 / 12.0) * (1.0 + 11.0 / 200.0) - 11.0 / 200.0 }) as f32
}

fn lab_tabs() -> &'static LabTabs {
    static T: OnceLock<LabTabs> = OnceLock::new();
    T.get_or_init(|| {
        let f255 = 255f32;
        let lthresh = 216f32 / 24389f32;
        let lscale = 841f32 / 108f32;
        let lbias = 16f32 / 116f32;
        let mut srgb_gamma = [0u16; 256];
        let int_scale = (255 * (1 << GAMMA_SHIFT)) as f32;
        for (i, v) in srgb_gamma.iter_mut().enumerate() {
            let x = i as f32 / f255;
            *v = cv_round_f32(int_scale * apply_gamma(x)) as u16;
        }
        let inv_scale = 1f32 / 4096f32;
        let srgb_inv_gamma = (0..4096).map(|i| cv_round_f32(f255 * apply_inv_gamma(inv_scale * i as f32)) as u16).collect();
        let cb_scale = 1f32 / (f255 * (1 << GAMMA_SHIFT) as f32);
        let lshift2 = (1u32 << LAB_SHIFT2) as f32;
        let cbrt = (0..256 * 3 / 2 * (1 << GAMMA_SHIFT))
            .map(|i| {
                let x = cb_scale * i as f32;
                let f = if x < lthresh { x.mul_add(lscale, lbias) } else { (x as f64).cbrt() as f32 };
                cv_round_f32(lshift2 * f) as u16
            })
            .collect();
        let mut lab_to_yf = [0u16; 512];
        for i in 0..256i32 {
            let (y, ify);
            if i <= 20 {
                y = cv_round_f32((i * LUT_BASE * 20 * 9) as f32 / (17 * 29 * 29 * 29) as f32);
                ify = cv_round_f32(LUT_BASE as f32 * (16f32 / 116f32 + (i * 5) as f32 / (3 * 17 * 29) as f32));
            } else {
                let fy = (i * 100 * LUT_BASE) as f32 / (255 * 116) as f32 + (16 * LUT_BASE) as f32 / 116f32;
                ify = cv_round_f32(fy);
                y = cv_round_f32(fy * fy * fy / (LUT_BASE as f32 * LUT_BASE as f32));
            }
            lab_to_yf[i as usize * 2] = y as u16;
            lab_to_yf[i as usize * 2 + 1] = ify as u16;
        }
        let ab_to_xz = (MIN_AB..LUT_BASE * 9 / 4 + MIN_AB)
            .map(|i| {
                if i <= 3390 {
                    i * 108 / 841 - LUT_BASE * 16 / 116 * 108 / 841
                } else {
                    let i = i as i64;
                    (i * i / LUT_BASE as i64 * i / LUT_BASE as i64) as i32
                }
            })
            .collect();
        let white = [f64::from_bits(0x3fee6a22b3892ee8), 1.0, f64::from_bits(0x3ff16b8950763a19)];
        let lshift = (1 << XYZ_SHIFT) as f64;
        let mut fwd = [0i32; 9];
        let mut inv = [0i32; 9];
        for i in 0..3 {
            for j in 0..3 {
                fwd[i * 3 + j] = cv_round_f64(lshift * f64::from_bits(SRGB2XYZ[i * 3 + j]) / white[i]) as i32;
                // inv 行 = 输出通道 R/G/B，列 = X/Y/Z（乘的是列对应的白点）
                inv[j * 3 + i] = cv_round_f64(lshift * f64::from_bits(XYZ2SRGB[j * 3 + i]) * white[i]) as i32;
            }
        }
        LabTabs { srgb_gamma, srgb_inv_gamma, cbrt, lab_to_yf, ab_to_xz, fwd, inv }
    })
}

/// 交错 RGB → 交错 Lab（8 位）。srgb=false 即 OpenCV 的 LRGB2Lab
pub(crate) fn rgb_to_lab(rgb: &[u8], srgb: bool) -> Vec<u8> {
    let t = lab_tabs();
    let c = &t.fwd;
    let lscale = (116 * 255 + 50) / 100;
    let lshift = -((16 * 255 * (1 << LAB_SHIFT2) + 50) / 100);
    let mut out = vec![0u8; rgb.len()];
    for (s, d) in rgb.chunks_exact(3).zip(out.chunks_exact_mut(3)) {
        let (r, g, b) = if srgb {
            (t.srgb_gamma[s[0] as usize] as i32, t.srgb_gamma[s[1] as usize] as i32, t.srgb_gamma[s[2] as usize] as i32)
        } else {
            ((s[0] as i32) << GAMMA_SHIFT, (s[1] as i32) << GAMMA_SHIFT, (s[2] as i32) << GAMMA_SHIFT)
        };
        let fx = t.cbrt[descale(r * c[0] + g * c[1] + b * c[2], XYZ_SHIFT) as usize] as i32;
        let fy = t.cbrt[descale(r * c[3] + g * c[4] + b * c[5], XYZ_SHIFT) as usize] as i32;
        let fz = t.cbrt[descale(r * c[6] + g * c[7] + b * c[8], XYZ_SHIFT) as usize] as i32;
        let l = descale(lscale * fy + lshift, LAB_SHIFT2);
        let a = descale(500 * (fx - fy) + 128 * (1 << LAB_SHIFT2), LAB_SHIFT2);
        let bb = descale(200 * (fy - fz) + 128 * (1 << LAB_SHIFT2), LAB_SHIFT2);
        d[0] = sat_u8(l as i64);
        d[1] = sat_u8(a as i64);
        d[2] = sat_u8(bb as i64);
    }
    out
}

pub(crate) fn lab_to_rgb(lab: &[u8], srgb: bool) -> Vec<u8> {
    let t = lab_tabs();
    let c = &t.inv;
    let shift = XYZ_SHIFT + (14 - 12);
    let mut out = vec![0u8; lab.len()];
    for (s, d) in lab.chunks_exact(3).zip(out.chunks_exact_mut(3)) {
        let (ll, aa, bb) = (s[0] as i32, s[1] as i32, s[2] as i32);
        let y = t.lab_to_yf[ll as usize * 2] as i32;
        let ify = t.lab_to_yf[ll as usize * 2 + 1] as i32;
        let adiv = ((5 * aa * 53687 + (1 << 7)) >> 13) - 128 * LUT_BASE / 500;
        let bdiv = ((bb * 41943 + (1 << 4)) >> 9) - 128 * LUT_BASE / 200 + 1;
        let x = t.ab_to_xz[(ify + adiv - MIN_AB) as usize];
        let z = t.ab_to_xz[(ify - bdiv - MIN_AB) as usize];
        for k in 0..3 {
            let mut v = descale(c[k * 3] * x + c[k * 3 + 1] * y + c[k * 3 + 2] * z, shift).clamp(0, 4095);
            v = if srgb { t.srgb_inv_gamma[v as usize] as i32 } else { ((v << 8) - v) >> 12 };
            d[k] = sat_u8(v as i64);
        }
    }
    out
}

// ───────────────────────── 非局部均值去噪 ─────────────────────────

fn reflect101(i: isize, len: usize) -> usize {
    if len == 1 {
        return 0;
    }
    let n = len as isize;
    let period = 2 * (n - 1);
    let i = i.rem_euclid(period);
    if i >= n { (period - i) as usize } else { i as usize }
}

/// cv::fastNlMeansDenoising（NORM_L2，u8，cn = 1 或 2，单一 h）
pub(crate) fn nl_means(src: &[u8], w: usize, h: usize, cn: usize, hh: f32, tws: usize, sws: usize) -> Vec<u8> {
    let thw = (tws / 2) as isize;
    let shw = (sws / 2) as isize;
    let tws = (thw * 2 + 1) as usize;
    let sws = (shw * 2 + 1) as usize;
    let border = (shw + thw) as usize;
    let (ew, eh) = (w + 2 * border, h + 2 * border);
    // 扩边（BORDER_DEFAULT = REFLECT_101）
    let mut ext = vec![0u8; ew * eh * cn];
    for y in 0..eh {
        let sy = reflect101(y as isize - border as isize, h);
        for x in 0..ew {
            let sx = reflect101(x as isize - border as isize, w);
            for c in 0..cn {
                ext[(y * ew + x) * cn + c] = src[(sy * w + sx) * cn + c];
            }
        }
    }
    // 定点权重表
    let max_est = (sws * sws * 255) as i64;
    let fpm = (i32::MAX as i64 / max_est).min(i32::MAX as i64) as i32;
    let tsq = tws * tws;
    let mut bin_shift = 0u32;
    while (1usize << bin_shift) < tsq {
        bin_shift += 1;
    }
    let mult = (1u64 << bin_shift) as f64 / tsq as f64;
    let max_dist = 255 * 255 * cn as i64;
    let almost_max = (max_dist as f64 / mult + 1.0) as usize;
    let denom = (hh * hh * cn as f32) as f64;
    let weights: Vec<i32> = (0..almost_max)
        .map(|ad| {
            let dist = ad as f64 * mult;
            let mut wv = (-dist / denom).exp();
            if wv.is_nan() {
                wv = 1.0;
            }
            let mut weight = cv_round_f64(fpm as f64 * wv) as i32;
            if (weight as f64) < 0.001 * fpm as f64 {
                weight = 0;
            }
            weight
        })
        .collect();

    let mut out = vec![0u8; w * h * cn];
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(1, 32);
    let rows_per = h.div_ceil(threads).max(1);
    std::thread::scope(|s| {
        for (bi, chunk) in out.chunks_mut(rows_per * w * cn).enumerate() {
            let ext = &ext;
            let weights = &weights;
            s.spawn(move || {
                let r0 = bi * rows_per;
                let rows = chunk.len() / (w * cn);
                let (dr, dc) = (rows + 2 * thw as usize, w + 2 * thw as usize);
                let mut diff = vec![0i32; dr * dc];
                let mut hs = vec![0i32; dr * w];
                let mut est = vec![0i64; rows * w * cn];
                let mut wsum = vec![0i64; rows * w];
                for dy in -shw..=shw {
                    for dx in -shw..=shw {
                        // diff[r][c]：输出行 r0+r-thw、列 c-thw 处的像素与偏移像素的距离
                        for r in 0..dr {
                            let ay = r0 + r + border - thw as usize;
                            let by = (ay as isize + dy) as usize;
                            let arow = &ext[ay * ew * cn..];
                            let brow = &ext[by * ew * cn..];
                            for c in 0..dc {
                                let ax = c + border - thw as usize;
                                let bx = (ax as isize + dx) as usize;
                                let mut d = 0i32;
                                for k in 0..cn {
                                    let v = arow[ax * cn + k] as i32 - brow[bx * cn + k] as i32;
                                    d += v * v;
                                }
                                diff[r * dc + c] = d;
                            }
                        }
                        // 横向 7 点和
                        for r in 0..dr {
                            let row = &diff[r * dc..(r + 1) * dc];
                            let mut acc: i32 = row[..tws].iter().sum();
                            hs[r * w] = acc;
                            for c in 1..w {
                                acc += row[c + tws - 1] - row[c - 1];
                                hs[r * w + c] = acc;
                            }
                        }
                        // 纵向 7 点和 → 权重 → 累加
                        let mut col = vec![0i32; w];
                        for (c, v) in col.iter_mut().enumerate() {
                            *v = (0..tws).map(|r| hs[r * w + c]).sum();
                        }
                        for r in 0..rows {
                            if r > 0 {
                                for c in 0..w {
                                    col[c] += hs[(r + tws - 1) * w + c] - hs[(r - 1) * w + c];
                                }
                            }
                            let py = r0 + r + border;
                            let sy = (py as isize + dy) as usize;
                            for c in 0..w {
                                let wt = weights[(col[c] >> bin_shift) as usize] as i64;
                                if wt == 0 {
                                    continue;
                                }
                                let sx = (c as isize + border as isize + dx) as usize;
                                let p = &ext[(sy * ew + sx) * cn..];
                                let o = (r * w + c) * cn;
                                for k in 0..cn {
                                    est[o + k] += wt * p[k] as i64;
                                }
                                wsum[r * w + c] += wt;
                            }
                        }
                    }
                }
                for i in 0..rows * w {
                    let ws = wsum[i];
                    for k in 0..cn {
                        let v = (est[i * cn + k] as u64 as i64 + ws / 2) / ws;
                        chunk[i * cn + k] = sat_u8(v);
                    }
                }
            });
        }
    });
    out
}

/// cv::fastNlMeansDenoisingColored：LRGB→Lab，L 用 h、ab 用 h_color，再转回
pub(crate) fn nl_means_colored(img: &RgbImage, h: f32, h_color: f32, tws: usize, sws: usize) -> RgbImage {
    let (w, hgt) = (img.width() as usize, img.height() as usize);
    let lab = rgb_to_lab(img.as_raw(), false);
    let l: Vec<u8> = lab.chunks_exact(3).map(|p| p[0]).collect();
    let ab: Vec<u8> = lab.chunks_exact(3).flat_map(|p| [p[1], p[2]]).collect();
    let l = nl_means(&l, w, hgt, 1, h, tws, sws);
    let ab = nl_means(&ab, w, hgt, 2, h_color, tws, sws);
    let mut merged = vec![0u8; w * hgt * 3];
    for i in 0..w * hgt {
        merged[i * 3] = l[i];
        merged[i * 3 + 1] = ab[i * 2];
        merged[i * 3 + 2] = ab[i * 2 + 1];
    }
    RgbImage::from_raw(w as u32, hgt as u32, lab_to_rgb(&merged, false)).expect("size")
}

// ───────────────────────── 白平衡 / 拉伸 / CLAHE / 锐化 ─────────────────────────

fn auto_white_balance(img: &RgbImage, strength: f64) -> RgbImage {
    // 对齐 numpy 2（NEP 50）的 float32 语义：
    //   means = arr.reshape(-1,3).mean(axis=0) —— 沿 axis=0 逐行 float32 累加，再除以 N（float32）；
    //   gray = float(means.mean())；gain = 1 + (gray/means[c] - 1) * s 全程 float32（Python 标量是弱类型）。
    let n = img.width() as usize * img.height() as usize;
    let mut sums = [0f32; 3];
    for p in img.pixels() {
        for c in 0..3 {
            sums[c] += p[c] as f32;
        }
    }
    let means = sums.map(|s| s / n.max(1) as f32);
    let gray = (means[0] + means[1] + means[2]) / 3.0f32;
    let s = strength.clamp(0.0, 1.0) as f32;
    let gains: [f32; 3] = std::array::from_fn(|c| if means[c] > 1.0 { 1.0f32 + (gray / means[c] - 1.0f32) * s } else { 1.0 });
    let mut out = img.clone();
    for p in out.pixels_mut() {
        for c in 0..3 {
            p[c] = (p[c] as f32 * gains[c]).clamp(0.0, 255.0) as u8;
        }
    }
    out
}

/// numpy.percentile（linear）对 u8 数据
fn percentile_u8(hist: &[u64; 256], n: u64, q: f64) -> f64 {
    let pos = q / 100.0 * (n - 1) as f64;
    let lo_i = pos.floor() as u64;
    let hi_i = pos.ceil() as u64;
    let kth = |k: u64| {
        let mut acc = 0u64;
        for (v, c) in hist.iter().enumerate() {
            acc += c;
            if acc > k {
                return v as f64;
            }
        }
        255.0
    };
    let (a, b) = (kth(lo_i), kth(hi_i));
    a + (b - a) * (pos - lo_i as f64)
}

fn stretch_levels(img: &RgbImage, min_span: f64) -> RgbImage {
    let mut lab = rgb_to_lab(img.as_raw(), true);
    let mut hist = [0u64; 256];
    for p in lab.chunks_exact(3) {
        hist[p[0] as usize] += 1;
    }
    let n = (lab.len() / 3) as u64;
    let lo = percentile_u8(&hist, n, 0.5);
    let hi = percentile_u8(&hist, n, 99.5);
    let span = hi - lo;
    if span >= 1.0 && span < min_span {
        let gain = (255.0 / span).min(1.6);
        let off = (255.0 - span * gain) / 2.0;
        for p in lab.chunks_exact_mut(3) {
            p[0] = (((p[0] as f32) as f64 - lo) * gain + off).clamp(0.0, 255.0) as u8;
        }
    }
    RgbImage::from_raw(img.width(), img.height(), lab_to_rgb(&lab, true)).expect("size")
}

/// cv::createCLAHE(clip, (grid, grid)).apply（u8）
pub(crate) fn clahe(src: &[u8], w: usize, h: usize, clip: f64, grid: usize) -> Vec<u8> {
    let (tx_n, ty_n) = (grid, grid);
    let (ew, eh) = if w % tx_n == 0 && h % ty_n == 0 { (w, h) } else { (w + tx_n - w % tx_n, h + ty_n - h % ty_n) };
    let at = |x: usize, y: usize| src[reflect101(y as isize, h) * w + reflect101(x as isize, w)];
    let (tw, th) = (ew / tx_n, eh / ty_n);
    let total = (tw * th) as i32;
    let lut_scale = 255f32 / total as f32;
    let clip_limit = if clip > 0.0 { ((clip * total as f64 / 256.0) as i32).max(1) } else { 0 };
    let mut lut = vec![0u8; tx_n * ty_n * 256];
    for k in 0..tx_n * ty_n {
        let (ty, tx) = (k / tx_n, k % tx_n);
        let mut hist = [0i32; 256];
        for y in ty * th..(ty + 1) * th {
            for x in tx * tw..(tx + 1) * tw {
                hist[at(x, y) as usize] += 1;
            }
        }
        if clip_limit > 0 {
            let mut clipped = 0;
            for v in hist.iter_mut() {
                if *v > clip_limit {
                    clipped += *v - clip_limit;
                    *v = clip_limit;
                }
            }
            let batch = clipped / 256;
            let mut residual = clipped - batch * 256;
            for v in hist.iter_mut() {
                *v += batch;
            }
            if residual != 0 {
                let step = (256 / residual).max(1) as usize;
                let mut i = 0usize;
                while i < 256 && residual > 0 {
                    hist[i] += 1;
                    i += step;
                    residual -= 1;
                }
            }
        }
        let mut sum = 0i32;
        for i in 0..256 {
            sum += hist[i];
            lut[k * 256 + i] = cv_round_f32(sum as f32 * lut_scale).clamp(0, 255) as u8;
        }
    }
    let inv_tw = 1f32 / tw as f32;
    let inv_th = 1f32 / th as f32;
    let xs: Vec<(usize, usize, f32, f32)> = (0..w)
        .map(|x| {
            let txf = x as f32 * inv_tw - 0.5;
            let t1 = txf.floor() as i32;
            let xa = txf - t1 as f32;
            ((t1.max(0)) as usize, ((t1 + 1).min(tx_n as i32 - 1)) as usize, xa, 1.0 - xa)
        })
        .collect();
    let mut out = vec![0u8; w * h];
    for y in 0..h {
        let tyf = y as f32 * inv_th - 0.5;
        let t1 = tyf.floor() as i32;
        let ya = tyf - t1 as f32;
        let ya1 = 1.0 - ya;
        let p1 = (t1.max(0) as usize) * tx_n;
        let p2 = ((t1 + 1).min(ty_n as i32 - 1) as usize) * tx_n;
        for x in 0..w {
            let v = src[y * w + x] as usize;
            let (i1, i2, xa, xa1) = xs[x];
            let res = (lut[(p1 + i1) * 256 + v] as f32 * xa1 + lut[(p1 + i2) * 256 + v] as f32 * xa) * ya1
                + (lut[(p2 + i1) * 256 + v] as f32 * xa1 + lut[(p2 + i2) * 256 + v] as f32 * xa) * ya;
            out[y * w + x] = cv_round_f32(res).clamp(0, 255) as u8;
        }
    }
    out
}

fn enhance_contrast(img: &RgbImage, clip: f64, grid: usize) -> RgbImage {
    let (w, h) = (img.width() as usize, img.height() as usize);
    let mut lab = rgb_to_lab(img.as_raw(), true);
    let l: Vec<u8> = lab.chunks_exact(3).map(|p| p[0]).collect();
    let l = clahe(&l, w, h, clip, grid);
    for (p, v) in lab.chunks_exact_mut(3).zip(l) {
        p[0] = v;
    }
    RgbImage::from_raw(w as u32, h as u32, lab_to_rgb(&lab, true)).expect("size")
}

/// OpenCV getGaussianKernelBitExact + getGaussianKernelFixedPoint_ED（8 位小数，ufixedpoint16）
pub(crate) fn gaussian_kernel_fixed(n: usize, sigma: f64) -> Vec<u32> {
    let table: Option<&[f64]> = if sigma <= 0.0 {
        match n {
            1 => Some(&[1.0]),
            3 => Some(&[0.25, 0.5, 0.25]),
            5 => Some(&[0.0625, 0.25, 0.375, 0.25, 0.0625]),
            7 => Some(&[0.03125, 0.109375, 0.21875, 0.28125, 0.21875, 0.109375, 0.03125]),
            9 => Some(&[4.0 / 256.0, 13.0 / 256.0, 30.0 / 256.0, 51.0 / 256.0, 60.0 / 256.0, 51.0 / 256.0, 30.0 / 256.0, 13.0 / 256.0, 4.0 / 256.0]),
            _ => None,
        }
    } else {
        None
    };
    let k: Vec<f64> = match table {
        Some(t) => t.to_vec(),
        None => {
            let sx = if sigma > 0.0 { sigma } else { (n as f64).mul_add(0.15, 0.35) };
            let scale2 = -0.125 / (sx * sx);
            let n2 = (n - 1) / 2;
            let mut vals = Vec::with_capacity(n2);
            let mut sum = 0f64;
            let mut x = 1 - n as i64;
            for _ in 0..n2 {
                let t = ((x * x) as f64 * scale2).exp();
                vals.push(t);
                sum += t;
                x += 2;
            }
            sum = sum * 2.0 + 1.0;
            let mul1 = 1.0 / sum;
            let mut res = vec![0f64; n];
            for i in 0..n2 {
                res[i] = vals[i] * mul1;
                res[n - 1 - i] = res[i];
            }
            res[n2] = mul1;
            res
        }
    };
    let n2 = n / 2;
    let mut out = vec![0u32; n];
    let mut err = 0f64;
    let mut sum = 0i64;
    for i in 0..n2 {
        let adj = k[i] * 256.0 + err;
        let v0 = adj.round_ties_even() as i64;
        err = adj - v0 as f64;
        out[i] = v0 as u32;
        out[n - 1 - i] = v0 as u32;
        sum += v0;
    }
    out[n2] = (256 - 2 * sum) as u32;
    out
}

/// cv::GaussianBlur 的 8 位定点实现（GaussianBlurFixedPoint）：
/// 横向 Σ k·p 存为 8.8 定点（u16），纵向 Σ k·h 为 16.16 定点，最后 (v + 2^15) >> 16。边界 REFLECT_101。
pub(crate) fn gaussian_blur_fixed(src: &[u8], w: usize, h: usize, cn: usize, ksize: usize, sigma: f64) -> Vec<u8> {
    if w == 0 || h == 0 {
        return src.to_vec();
    }
    let k = gaussian_kernel_fixed(ksize, sigma);
    let r = (ksize / 2) as isize;
    let xs: Vec<Vec<usize>> = (0..w).map(|x| (0..ksize).map(|t| reflect101(x as isize + t as isize - r, w)).collect()).collect();
    let mut tmp = vec![0u16; w * h * cn];
    for y in 0..h {
        let row = &src[y * w * cn..(y + 1) * w * cn];
        let dst = &mut tmp[y * w * cn..(y + 1) * w * cn];
        for x in 0..w {
            for c in 0..cn {
                let mut acc = 0u32;
                for (t, &sx) in xs[x].iter().enumerate() {
                    acc += k[t] * row[sx * cn + c] as u32;
                }
                dst[x * cn + c] = acc.min(u16::MAX as u32) as u16;
            }
        }
    }
    let mut out = vec![0u8; w * h * cn];
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(4).clamp(1, 16);
    let rows_per = h.div_ceil(threads).max(1);
    std::thread::scope(|s| {
        for (ci, chunk) in out.chunks_mut(rows_per * w * cn).enumerate() {
            let (tmp, k) = (&tmp, &k);
            s.spawn(move || {
                for (ry, row) in chunk.chunks_mut(w * cn).enumerate() {
                    let y = ci * rows_per + ry;
                    let ys: Vec<usize> = (0..ksize).map(|t| reflect101(y as isize + t as isize - r, h)).collect();
                    for i in 0..w * cn {
                        let mut acc = 0u32;
                        for (t, &sy) in ys.iter().enumerate() {
                            acc = acc.wrapping_add(k[t] * tmp[sy * w * cn + i] as u32);
                        }
                        row[i] = ((acc as u64 + (1 << 15)) >> 16).min(255) as u8;
                    }
                }
            });
        }
    });
    out
}

/// GaussianBlur(img, (0,0), sigma) + addWeighted(img, 1+a, blur, -a, 0)
fn unsharp(img: &RgbImage, amount: f64, sigma: f64) -> RgbImage {
    let (w, h) = (img.width() as usize, img.height() as usize);
    let ksize = (((sigma * 3.0 * 2.0 + 1.0).round_ties_even() as i64) | 1) as usize;
    let src = img.as_raw();
    let blur = gaussian_blur_fixed(src, w, h, 3, ksize, sigma);
    let (a1, a2) = ((1.0 + amount) as f32, (-amount) as f32);
    let out: Vec<u8> = src
        .iter()
        .zip(&blur)
        .map(|(s, b)| cv_round_f32(*s as f32 * a1 + *b as f32 * a2).clamp(0, 255) as u8)
        .collect();
    RgbImage::from_raw(w as u32, h as u32, out).expect("size")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn lab_known_values() {
        // 白 → (255,128,128)，黑 → (0,128,128)
        assert_eq!(rgb_to_lab(&[255, 255, 255, 0, 0, 0], true), vec![255, 128, 128, 0, 128, 128]);
        let back = lab_to_rgb(&[255, 128, 128, 0, 128, 128], true);
        assert!(back[..3].iter().all(|v| *v >= 254) && back[3..].iter().all(|v| *v <= 1), "{back:?}");
    }

    #[test]
    fn nlm_keeps_flat_image() {
        let src = vec![93u8; 30 * 20];
        assert_eq!(nl_means(&src, 30, 20, 1, 6.0, 7, 21), src);
    }

    #[test]
    fn clahe_keeps_size() {
        let src: Vec<u8> = (0..37 * 29).map(|i| (i % 251) as u8).collect();
        assert_eq!(clahe(&src, 37, 29, 1.2, 8).len(), src.len());
    }

    fn read_bin(dir: &PathBuf, name: &str) -> Vec<u8> {
        std::fs::read(dir.join(name)).unwrap()
    }

    fn stats(name: &str, a: &[u8], b: &[u8]) {
        assert_eq!(a.len(), b.len(), "{name} len");
        let mut sum = 0u64;
        let mut max = 0u8;
        let mut neq = 0usize;
        for (x, y) in a.iter().zip(b) {
            let d = x.abs_diff(*y);
            sum += d as u64;
            max = max.max(d);
            if d != 0 { neq += 1; }
        }
        println!("CMP {name} mean={:.4} max={max} diff_px={:.4}%", sum as f64 / a.len() as f64, neq as f64 * 100.0 / a.len() as f64);
    }

    /// 与 OpenCV 逐项对比：FK_RESTORE_CMP=<目录>（由 py_restore_ref.py 生成）
    #[test]
    #[ignore = "needs Python reference outputs"]
    fn compare_with_python_reference() {
        let Some(dir) = std::env::var_os("FK_RESTORE_CMP") else { return; };
        let dir = PathBuf::from(dir);
        let meta: Value = serde_json::from_slice(&read_bin(&dir, "meta.json")).unwrap();
        let (w, h) = (meta["w"].as_u64().unwrap() as usize, meta["h"].as_u64().unwrap() as usize);
        // ① Lab 转换（随机像素）
        let rnd = read_bin(&dir, "rand_rgb.bin");
        stats("rgb2lab_srgb", &rgb_to_lab(&rnd, true), &read_bin(&dir, "rand_lab_srgb.bin"));
        stats("rgb2lab_linear", &rgb_to_lab(&rnd, false), &read_bin(&dir, "rand_lab_linear.bin"));
        stats("lab2rgb_srgb", &lab_to_rgb(&rnd, true), &read_bin(&dir, "rand_back_srgb.bin"));
        stats("lab2rgb_linear", &lab_to_rgb(&rnd, false), &read_bin(&dir, "rand_back_linear.bin"));
        // ② 原子操作
        let img = read_bin(&dir, "input_rgb.bin");
        let g = gray(&RgbImage::from_raw(w as u32, h as u32, img.clone()).unwrap());
        stats("gray", &g, &read_bin(&dir, "gray.bin"));
        let g = read_bin(&dir, "gray.bin");
        // 逐步对比：每一步都用 Python 上一步的输出作为输入，隔离误差来源
        let im = |name: &str| RgbImage::from_raw(w as u32, h as u32, read_bin(&dir, name)).unwrap();
        stats("stage_wb", auto_white_balance(&im("stage_nlm.bin"), 0.8).as_raw(), &read_bin(&dir, "stage_wb.bin"));
        stats("stage_stretch", stretch_levels(&im("stage_wb.bin"), 200.0).as_raw(), &read_bin(&dir, "stage_stretch.bin"));
        stats("stage_clahe", enhance_contrast(&im("stage_stretch.bin"), 1.2, 8).as_raw(), &read_bin(&dir, "stage_clahe.bin"));
        stats("stage_unsharp", unsharp(&im("stage_clahe.bin"), 0.6, 2.0).as_raw(), &read_bin(&dir, "stage_unsharp.bin"));
        stats("clahe_gray", &clahe(&g, w, h, 1.2, 8), &read_bin(&dir, "clahe_gray.bin"));
        let t = std::time::Instant::now();
        stats("nlm_gray", &nl_means(&g, w, h, 1, 6.0, 7, 21), &read_bin(&dir, "nlm_gray.bin"));
        println!("nlm_gray {}ms", t.elapsed().as_millis());
        let rgb = RgbImage::from_raw(w as u32, h as u32, img.clone()).unwrap();
        let t = std::time::Instant::now();
        stats("nlm_colored", nl_means_colored(&rgb, 6.0, 6.0, 7, 21).as_raw(), &read_bin(&dir, "nlm_colored.bin"));
        println!("nlm_colored {}ms", t.elapsed().as_millis());
        // ③ 完整流程
        for case in meta["cases"].as_array().unwrap() {
            let name = case["name"].as_str().unwrap();
            let o = RestoreOptions::from_payload(&case["payload"]);
            let t = std::time::Instant::now();
            let r = restore(&rgb, &o, |_, _| {});
            let ms = t.elapsed().as_millis();
            stats(&format!("restore_{name}"), r.image.as_raw(), &read_bin(&dir, &format!("restore_{name}.bin")));
            println!("  rust: {}  ({ms}ms)\n  py  : {}", r.message(), case["message"].as_str().unwrap_or(""));
            r.image.save(dir.join(format!("rs_restore_{name}.png"))).unwrap();
        }
    }
}
