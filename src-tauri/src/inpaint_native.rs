//! 去水印（图像修补）：Rust 原生实现，替代 services/worker/app/tools/image_inpaint.py + lama_inpaint.py。
//!
//! 对齐要点：
//!   · 掩膜：矩形填充（含右下边界，与 cv2.rectangle 一致）；单点画圆（半径 brush/2），
//!     多点画粗折线（宽 brush，圆头）；
//!   · 自动识别浅色水印：灰度 − medianBlur(31) → 阈值 max(8, 255−200) → 5×5 闭运算 → 去掉面积 < 30 的连通域；
//!   · 统计像素数后再按 4×4 膨胀（锚点在中心，与 cv2.dilate 默认一致）；
//!   · Telea / NS：逐行移植 OpenCV modules/photo/src/inpaint.cpp（快速行进 + 同样的权重与取整）；
//!   · LaMa：image [1,3,512,512] RGB 0~1（INTER_AREA 缩放），mask [1,1,512,512] 0/1（最近邻），
//!     按名字/形状匹配输入；输出**已经是 0~255**，不要再乘 255；放回原尺寸后只贴回掩膜区域。

use std::cmp::Ordering;
use std::collections::BinaryHeap;
use std::path::{Path, PathBuf};

use image::imageops::FilterType;
use image::RgbImage;
use serde_json::{json, Value};

use crate::matting_native::{load_image, model_in_components, number, progress, results_path, text};

const LAMA: &str = "lama_fp32.onnx";
const MISSING_LAMA: &str = "还没下载「去水印 · 精细模型」，请到设置里的「按需下载组件」下载后重试（约 198MB）";

// ───────────────────────── 任务入口（由 matting_native::start 调度） ─────────────────────────

pub(crate) fn watermark_remove(app: &tauri::AppHandle, id: &str, input: &str, stem: &str, payload: &Value) -> Result<Value, String> {
    let method = text(payload, "method", "telea").to_string();
    if !matches!(method.as_str(), "telea" | "ns" | "lama") {
        return Err(format!("不支持的处理方式「{method}」"));
    }
    let img = load_image(input)?.to_rgb8();
    let (w, h) = img.dimensions();

    progress(app, id, 25, "正在生成修补范围…");
    let (mask, painted) = prepare_mask(&img, payload);
    if painted == 0 {
        return Err("没有需要处理的区域：请先在图上框出或涂出要抹掉的部分".into());
    }

    let result = if method == "lama" {
        let model = payload
            .get("model_path")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty() && Path::new(s).is_file())
            .map(PathBuf::from)
            .or_else(|| model_in_components(app, &[LAMA]))
            .ok_or(MISSING_LAMA)?;
        let filename = model.file_name().and_then(|s| s.to_str()).ok_or("Invalid model filename")?.to_string();
        let _lease = crate::api::component_use(app, &[filename.as_str()])?;
        progress(app, id, 45, "LaMa 正在补全画面…");
        lama_inpaint(&img, &mask, &model)?
    } else {
        progress(app, id, 45, "正在修补…");
        let radius = number(payload, "radius", 4.0) as i64;
        inpaint(&img, &mask, radius.max(1) as f64, method == "ns")
    };

    progress(app, id, 90, "正在保存结果…");
    let plain = format!("{stem}_已去水印.png");
    let path = results_path(app, id, &plain)?;
    result.save(&path).map_err(|_| "图片保存失败".to_string())?;
    let ratio = ((painted as f64 / (w as f64 * h as f64)) * 10000.0).round() / 10000.0;
    let message = format!("已抹除 {painted} 个像素（占 {}%）", py_float(((ratio * 100.0) * 100.0).round() / 100.0));
    Ok(json!({ "path": path.to_string_lossy(), "filename": plain, "mime": "image/png",
               "message": message, "width": w, "height": h,
               "method": method, "paintedPixels": painted, "paintedRatio": ratio }))
}

/// 按 Python str(float) 的习惯输出：整数带 ".0"，否则去掉末尾 0
fn py_float(v: f64) -> String {
    if v.fract() == 0.0 {
        format!("{v:.1}")
    } else {
        let s = format!("{v:.2}");
        s.trim_end_matches('0').to_string()
    }
}

/// 生成最终掩膜（已膨胀，0/255）并返回膨胀前的像素数（与 Python 的 paintedPixels 一致）
pub(crate) fn prepare_mask(img: &RgbImage, payload: &Value) -> (Vec<u8>, usize) {
    let (w, h) = (img.width() as usize, img.height() as usize);
    let rects = list(payload.get("regions"));
    let strokes = list(payload.get("strokes"));
    let brush = number(payload, "brush", 24.0) as i64;
    let mut mask = build_mask(w, h, &rects, &strokes, brush);
    if text(payload, "auto_light", "yes") == "yes" {
        let auto = auto_mask_for_light_watermark(img, 200, 30);
        for (m, a) in mask.iter_mut().zip(auto) {
            *m |= a;
        }
    }
    let painted = mask.iter().filter(|v| **v != 0).count();
    let mask = if painted > 0 { morph(&mask, w, h, 4, true) } else { mask };
    (mask, painted)
}

fn list(v: Option<&Value>) -> Vec<Value> {
    match v {
        Some(Value::Array(a)) => a.clone(),
        Some(Value::String(s)) if !s.trim().is_empty() => match serde_json::from_str::<Value>(s) {
            Ok(Value::Array(a)) => a,
            _ => Vec::new(),
        },
        _ => Vec::new(),
    }
}

/// Python int()：向零截断；字符串也尽量解析
fn as_int(v: Option<&Value>) -> i64 {
    match v {
        Some(Value::Number(n)) => n.as_f64().map(|f| f.trunc() as i64).unwrap_or(0),
        Some(Value::String(s)) => s.trim().parse::<f64>().map(|f| f.trunc() as i64).unwrap_or(0),
        _ => 0,
    }
}

// ───────────────────────── 掩膜绘制 ─────────────────────────

pub(crate) fn build_mask(w: usize, h: usize, rects: &[Value], strokes: &[Value], brush: i64) -> Vec<u8> {
    let mut mask = vec![0u8; w * h];
    for r in rects {
        let (x, y, rw, rh) = (as_int(r.get("x")), as_int(r.get("y")), as_int(r.get("w")), as_int(r.get("h")));
        if rw > 0 && rh > 0 {
            fill_rect(&mut mask, w, h, x, y, x + rw, y + rh);
        }
    }
    for s in strokes {
        let pts: Vec<(i64, i64)> = s
            .get("points")
            .and_then(Value::as_array)
            .map(|a| {
                a.iter()
                    .filter_map(|p| p.as_array().filter(|p| p.len() >= 2).map(|p| (as_int(p.get(0)), as_int(p.get(1)))))
                    .collect()
            })
            .unwrap_or_default();
        let width = if s.get("brush").is_some() { as_int(s.get("brush")) } else { brush };
        if pts.len() == 1 {
            fill_circle(&mut mask, w, h, pts[0].0 as f64, pts[0].1 as f64, (width / 2).max(1) as f64);
        } else if pts.len() > 1 {
            let r = width.max(1) as f64 / 2.0;
            for seg in pts.windows(2) {
                fill_capsule(&mut mask, w, h, seg[0], seg[1], r);
            }
        }
    }
    mask
}

fn fill_rect(mask: &mut [u8], w: usize, h: usize, x0: i64, y0: i64, x1: i64, y1: i64) {
    let (xa, xb) = (x0.min(x1).max(0), x0.max(x1).min(w as i64 - 1));
    let (ya, yb) = (y0.min(y1).max(0), y0.max(y1).min(h as i64 - 1));
    if xa > xb || ya > yb {
        return;
    }
    for y in ya..=yb {
        let row = y as usize * w;
        mask[row + xa as usize..=row + xb as usize].fill(255);
    }
}

fn fill_circle(mask: &mut [u8], w: usize, h: usize, cx: f64, cy: f64, r: f64) {
    let rr = r * r + 0.5;
    let (ya, yb) = (((cy - r).floor() as i64).max(0), ((cy + r).ceil() as i64).min(h as i64 - 1));
    let (xa, xb) = (((cx - r).floor() as i64).max(0), ((cx + r).ceil() as i64).min(w as i64 - 1));
    for y in ya..=yb {
        for x in xa..=xb {
            let (dx, dy) = (x as f64 - cx, y as f64 - cy);
            if dx * dx + dy * dy <= rr {
                mask[y as usize * w + x as usize] = 255;
            }
        }
    }
}

/// 粗线段（圆头）：到线段距离 ≤ r 的像素
fn fill_capsule(mask: &mut [u8], w: usize, h: usize, a: (i64, i64), b: (i64, i64), r: f64) {
    let (ax, ay, bx, by) = (a.0 as f64, a.1 as f64, b.0 as f64, b.1 as f64);
    let rr = r * r + 0.25;
    let pad = r.ceil() as i64 + 1;
    let (xa, xb) = ((a.0.min(b.0) - pad).max(0), (a.0.max(b.0) + pad).min(w as i64 - 1));
    let (ya, yb) = ((a.1.min(b.1) - pad).max(0), (a.1.max(b.1) + pad).min(h as i64 - 1));
    let (vx, vy) = (bx - ax, by - ay);
    let len2 = vx * vx + vy * vy;
    for y in ya..=yb {
        for x in xa..=xb {
            let (px, py) = (x as f64 - ax, y as f64 - ay);
            let t = if len2 > 0.0 { ((px * vx + py * vy) / len2).clamp(0.0, 1.0) } else { 0.0 };
            let (dx, dy) = (px - t * vx, py - t * vy);
            if dx * dx + dy * dy <= rr {
                mask[y as usize * w + x as usize] = 255;
            }
        }
    }
}

// ───────────────────────── 自动识别浅色水印 ─────────────────────────

/// OpenCV COLOR_RGB2GRAY 的定点公式（RGB2Gray<uchar>，15 位）
pub(crate) fn gray_of(img: &RgbImage) -> Vec<u8> {
    img.pixels()
        .map(|p| ((p[0] as u32 * 9798 + p[1] as u32 * 19235 + p[2] as u32 * 3735 + (1 << 14)) >> 15) as u8)
        .collect()
}

/// cv2.medianBlur(u8, k)：BORDER_REPLICATE，Huang 滑动直方图
pub(crate) fn median_blur(src: &[u8], w: usize, h: usize, k: usize) -> Vec<u8> {
    let r = (k / 2) as isize;
    let half = (k * k / 2) as u32;
    let at = |x: isize, y: isize| src[(y.clamp(0, h as isize - 1) as usize) * w + x.clamp(0, w as isize - 1) as usize];
    let mut out = vec![0u8; w * h];
    for y in 0..h as isize {
        let mut hist = [0u32; 256];
        for dy in -r..=r {
            for dx in -r..=r {
                hist[at(dx, y + dy) as usize] += 1;
            }
        }
        let mut med = 0usize;
        let mut lt = 0u32; // 小于 med 的数量
        while lt + hist[med] <= half {
            lt += hist[med];
            med += 1;
        }
        out[y as usize * w] = med as u8;
        for x in 1..w as isize {
            for dy in -r..=r {
                let old = at(x - r - 1, y + dy) as usize;
                let new = at(x + r, y + dy) as usize;
                hist[old] -= 1;
                if old < med { lt -= 1; }
                hist[new] += 1;
                if new < med { lt += 1; }
            }
            while lt > half {
                med -= 1;
                lt -= hist[med];
            }
            while lt + hist[med] <= half {
                lt += hist[med];
                med += 1;
            }
            out[y as usize * w + x as usize] = med as u8;
        }
    }
    out
}

/// 方形结构元素的膨胀 / 腐蚀（锚点 = k/2，越界像素忽略，与 OpenCV 默认边界一致）
pub(crate) fn morph(src: &[u8], w: usize, h: usize, k: usize, dilate: bool) -> Vec<u8> {
    let a = (k / 2) as isize;
    let (lo, hi) = (-a, k as isize - 1 - a);
    let pick = |acc: u8, v: u8| if dilate { acc.max(v) } else { acc.min(v) };
    let init = if dilate { 0u8 } else { 255u8 };
    // 横向
    let mut tmp = vec![0u8; w * h];
    for y in 0..h {
        for x in 0..w as isize {
            let mut acc = init;
            for d in lo..=hi {
                let xx = x + d;
                if xx >= 0 && xx < w as isize {
                    acc = pick(acc, src[y * w + xx as usize]);
                }
            }
            tmp[y * w + x as usize] = acc;
        }
    }
    // 纵向
    let mut out = vec![0u8; w * h];
    for y in 0..h as isize {
        for x in 0..w {
            let mut acc = init;
            for d in lo..=hi {
                let yy = y + d;
                if yy >= 0 && yy < h as isize {
                    acc = pick(acc, tmp[yy as usize * w + x]);
                }
            }
            out[y as usize * w + x] = acc;
        }
    }
    out
}

/// 去掉面积 < min_area 的 8 连通域
fn drop_small_components(mask: &[u8], w: usize, h: usize, min_area: usize) -> Vec<u8> {
    let mut out = vec![0u8; w * h];
    let mut seen = vec![false; w * h];
    let mut stack = Vec::new();
    let mut comp = Vec::new();
    for start in 0..w * h {
        if mask[start] == 0 || seen[start] {
            continue;
        }
        comp.clear();
        stack.push(start);
        seen[start] = true;
        while let Some(i) = stack.pop() {
            comp.push(i);
            let (x, y) = ((i % w) as isize, (i / w) as isize);
            for dy in -1..=1isize {
                for dx in -1..=1isize {
                    let (nx, ny) = (x + dx, y + dy);
                    if nx < 0 || ny < 0 || nx >= w as isize || ny >= h as isize {
                        continue;
                    }
                    let j = ny as usize * w + nx as usize;
                    if mask[j] != 0 && !seen[j] {
                        seen[j] = true;
                        stack.push(j);
                    }
                }
            }
        }
        if comp.len() >= min_area {
            for &i in &comp {
                out[i] = 255;
            }
        }
    }
    out
}

pub(crate) fn auto_mask_for_light_watermark(img: &RgbImage, brightness: i32, min_area: usize) -> Vec<u8> {
    let (w, h) = (img.width() as usize, img.height() as usize);
    let gray = gray_of(img);
    let bg = median_blur(&gray, w, h, 31);
    let thr = (255 - brightness).max(8) as u8;
    let bin: Vec<u8> = gray.iter().zip(&bg).map(|(g, b)| if g.saturating_sub(*b) > thr { 255 } else { 0 }).collect();
    let closed = morph(&morph(&bin, w, h, 5, true), w, h, 5, false);
    drop_small_components(&closed, w, h, min_area)
}

// ───────────────────────── Telea / NS（移植自 OpenCV inpaint.cpp） ─────────────────────────

const KNOWN: u8 = 0;
const BAND: u8 = 1;
const INSIDE: u8 = 2;
const CHANGE: u8 = 3;

#[derive(Clone, Copy)]
struct HeapElem {
    t: f32,
    i: usize,
    j: usize,
    order: u64,
}
impl PartialEq for HeapElem {
    fn eq(&self, o: &Self) -> bool { self.cmp(o) == Ordering::Equal }
}
impl Eq for HeapElem {}
impl PartialOrd for HeapElem {
    fn partial_cmp(&self, o: &Self) -> Option<Ordering> { Some(self.cmp(o)) }
}
impl Ord for HeapElem {
    // BinaryHeap 是大顶堆：反过来比，得到 (T, 插入顺序) 最小的先出
    fn cmp(&self, o: &Self) -> Ordering {
        o.t.partial_cmp(&self.t).unwrap_or(Ordering::Equal).then(o.order.cmp(&self.order))
    }
}

struct Pq {
    heap: BinaryHeap<HeapElem>,
    next: u64,
}
impl Pq {
    fn new() -> Self { Pq { heap: BinaryHeap::new(), next: 0 } }
    fn push(&mut self, i: usize, j: usize, t: f32) {
        self.heap.push(HeapElem { t, i, j, order: self.next });
        self.next += 1;
    }
    fn pop(&mut self) -> Option<(usize, usize)> { self.heap.pop().map(|e| (e.i, e.j)) }
    fn add(&mut self, f: &[u8], rows: usize, cols: usize) {
        for i in 0..rows {
            for j in 0..cols {
                if f[i * cols + j] != 0 {
                    self.push(i, j, 0.0);
                }
            }
        }
    }
}

struct Grid {
    rows: usize,
    cols: usize,
}
impl Grid {
    #[inline]
    fn at(&self, i: usize, j: usize) -> usize { i * self.cols + j }
}

fn fm_solve(g: &Grid, i1: usize, j1: usize, i2: usize, j2: usize, f: &[u8], t: &[f32]) -> f32 {
    let a11 = t[g.at(i1, j1)] as f64;
    let a22 = t[g.at(i2, j2)] as f64;
    let m12 = a11.min(a22);
    let sol = if f[g.at(i1, j1)] != INSIDE {
        if f[g.at(i2, j2)] != INSIDE {
            if (a11 - a22).abs() >= 1.0 { 1.0 + m12 } else { (a11 + a22 + (2.0 - (a11 - a22) * (a11 - a22)).sqrt()) * 0.5 }
        } else {
            1.0 + a11
        }
    } else if f[g.at(i2, j2)] != INSIDE {
        1.0 + a22
    } else {
        1.0 + m12
    };
    sol as f32
}

#[inline]
fn fm_dist(g: &Grid, i: usize, j: usize, f: &[u8], t: &[f32]) -> f32 {
    let a = fm_solve(g, i - 1, j, i, j - 1, f, t);
    let b = fm_solve(g, i + 1, j, i, j - 1, f, t);
    let c = fm_solve(g, i - 1, j, i, j + 1, f, t);
    let d = fm_solve(g, i + 1, j, i, j + 1, f, t);
    a.min(b).min(c.min(d))
}

fn neighbours(ii: usize, jj: usize) -> [(isize, isize); 4] {
    let (ii, jj) = (ii as isize, jj as isize);
    [(ii - 1, jj), (ii, jj - 1), (ii + 1, jj), (ii, jj + 1)]
}

fn calc_fmm(g: &Grid, f: &mut [u8], t: &mut [f32], heap: &mut Pq, negate: bool) {
    while let Some((ii, jj)) = heap.pop() {
        f[g.at(ii, jj)] = if negate { CHANGE } else { KNOWN };
        for (i, j) in neighbours(ii, jj) {
            if i <= 0 || j <= 0 || i >= g.rows as isize || j >= g.cols as isize {
                continue;
            }
            let (i, j) = (i as usize, j as usize);
            if f[g.at(i, j)] == INSIDE {
                let dist = fm_dist(g, i, j, f, t);
                t[g.at(i, j)] = dist;
                f[g.at(i, j)] = BAND;
                heap.push(i, j, dist);
            }
        }
    }
    if negate {
        for k in 0..f.len() {
            if f[k] == CHANGE {
                f[k] = KNOWN;
                t[k] = -t[k];
            }
        }
    }
}

/// OpenCV 的 round_cast<uchar>：saturate_cast<uchar>(val + 0.5)，内部用 cvRound（四舍六入五成双）
#[inline]
fn round_cast_u8(v: f32) -> u8 {
    ((v as f64) + 0.5).round_ties_even().clamp(0.0, 255.0) as u8
}

#[inline]
fn saturate_u8(v: f64) -> u8 {
    v.round_ties_even().clamp(0.0, 255.0) as u8
}

fn telea(g: &Grid, f: &mut [u8], t: &mut [f32], out: &mut [u8], w: usize, range: isize, heap: &mut Pq) {
    let (rows, cols) = (g.rows as isize, g.cols as isize);
    let px = |out: &[u8], r: isize, c: isize, ch: usize| out[(r as usize * w + c as usize) * 3 + ch] as f32;
    while let Some((ii, jj)) = heap.pop() {
        f[g.at(ii, jj)] = KNOWN;
        for (i, j) in neighbours(ii, jj) {
            if i <= 0 || j <= 0 || i > rows - 1 || j > cols - 1 {
                continue;
            }
            let (iu, ju) = (i as usize, j as usize);
            if f[g.at(iu, ju)] != INSIDE {
                continue;
            }
            let dist = fm_dist(g, iu, ju, f, t);
            t[g.at(iu, ju)] = dist;
            let fi = |a: isize, b: isize| f[g.at(a as usize, b as usize)];
            let ti = |a: isize, b: isize| t[g.at(a as usize, b as usize)];

            let grad_tx = if fi(i, j + 1) != INSIDE {
                if fi(i, j - 1) != INSIDE { (ti(i, j + 1) - ti(i, j - 1)) * 0.5 } else { ti(i, j + 1) - ti(i, j) }
            } else if fi(i, j - 1) != INSIDE { ti(i, j) - ti(i, j - 1) } else { 0.0 };
            let grad_ty = if fi(i + 1, j) != INSIDE {
                if fi(i - 1, j) != INSIDE { (ti(i + 1, j) - ti(i - 1, j)) * 0.5 } else { ti(i + 1, j) - ti(i, j) }
            } else if fi(i - 1, j) != INSIDE { ti(i, j) - ti(i - 1, j) } else { 0.0 };

            let mut jx = [0f32; 3];
            let mut jy = [0f32; 3];
            let mut ia = [0f32; 3];
            let mut s = [1.0e-20f32; 3];
            let tij = ti(i, j);
            for k in i - range..=i + range {
                let km = k - 1 + (k == 1) as isize;
                let kp = k - 1 - (k == rows - 2) as isize;
                for l in j - range..=j + range {
                    let lm = l - 1 + (l == 1) as isize;
                    let lp = l - 1 - (l == cols - 2) as isize;
                    if !(k > 0 && l > 0 && k < rows - 1 && l < cols - 1) {
                        continue;
                    }
                    if fi(k, l) == INSIDE || (l - j) * (l - j) + (k - i) * (k - i) > range * range {
                        continue;
                    }
                    let ry = (i - k) as f32;
                    let rx = (j - l) as f32;
                    let vl = rx * rx + ry * ry;
                    let dst = (1.0 / (vl as f64 * (vl as f64).sqrt())) as f32;
                    let lev = (1.0 / (1.0 + ((ti(k, l) - tij).abs()) as f64)) as f32;
                    let mut dir = rx * grad_tx + ry * grad_ty;
                    if (dir as f64).abs() <= 0.01 {
                        dir = 0.000001;
                    }
                    let wgt = (dst * lev * dir).abs();
                    let (fr, fl, fd, fu) = (fi(k, l + 1) != INSIDE, fi(k, l - 1) != INSIDE, fi(k + 1, l) != INSIDE, fi(k - 1, l) != INSIDE);
                    for c in 0..3 {
                        let gx = if fr {
                            if fl { (px(out, km, lp + 1, c) - px(out, km, lm - 1, c)) * 2.0 } else { px(out, km, lp + 1, c) - px(out, km, lm, c) }
                        } else if fl { px(out, km, lp, c) - px(out, km, lm - 1, c) } else { 0.0 };
                        let gy = if fd {
                            if fu { (px(out, kp + 1, lm, c) - px(out, km - 1, lm, c)) * 2.0 } else { px(out, kp + 1, lm, c) - px(out, km, lm, c) }
                        } else if fu { px(out, kp, lm, c) - px(out, km - 1, lm, c) } else { 0.0 };
                        ia[c] += wgt * px(out, k - 1, l - 1, c);
                        jx[c] -= wgt * (gx * rx);
                        jy[c] -= wgt * (gy * ry);
                        s[c] += wgt;
                    }
                }
            }
            let o = ((iu - 1) * w + (ju - 1)) * 3;
            for c in 0..3 {
                let sat = ia[c] / s[c] + (jx[c] + jy[c]) / ((jx[c] * jx[c] + jy[c] * jy[c]).sqrt() + 1.0e-20);
                out[o + c] = round_cast_u8(sat);
            }
            f[g.at(iu, ju)] = BAND;
            heap.push(iu, ju, dist);
        }
    }
}

fn navier_stokes(g: &Grid, f: &mut [u8], t: &mut [f32], out: &mut [u8], w: usize, range: isize, heap: &mut Pq) {
    let (rows, cols) = (g.rows as isize, g.cols as isize);
    let px = |out: &[u8], r: isize, c: isize, ch: usize| out[(r as usize * w + c as usize) * 3 + ch] as i32;
    while let Some((ii, jj)) = heap.pop() {
        f[g.at(ii, jj)] = KNOWN;
        for (i, j) in neighbours(ii, jj) {
            if i <= 0 || j <= 0 || i > rows - 1 || j > cols - 1 {
                continue;
            }
            let (iu, ju) = (i as usize, j as usize);
            if f[g.at(iu, ju)] != INSIDE {
                continue;
            }
            let dist = fm_dist(g, iu, ju, f, t);
            t[g.at(iu, ju)] = dist;
            let fi = |a: isize, b: isize| f[g.at(a as usize, b as usize)];

            let mut ia = [0f32; 3];
            let mut s = [1.0e-20f32; 3];
            for k in i - range..=i + range {
                let km = k - 1 + (k == 1) as isize;
                let kp = k - 1 - (k == rows - 2) as isize;
                for l in j - range..=j + range {
                    let lm = l - 1 + (l == 1) as isize;
                    let lp = l - 1 - (l == cols - 2) as isize;
                    if !(k > 0 && l > 0 && k < rows - 1 && l < cols - 1) {
                        continue;
                    }
                    if fi(k, l) == INSIDE || (l - j) * (l - j) + (k - i) * (k - i) > range * range {
                        continue;
                    }
                    let ry = (k - i) as f32;
                    let rx = (l - j) as f32;
                    let vl = rx * rx + ry * ry;
                    let dst = 1.0 / (vl * vl + 1.0);
                    let (fd, fu, fr, fl) = (fi(k + 1, l) != INSIDE, fi(k - 1, l) != INSIDE, fi(k, l + 1) != INSIDE, fi(k, l - 1) != INSIDE);
                    for c in 0..3 {
                        let mut gx = if fd {
                            if fu {
                                ((px(out, kp + 1, lm, c) - px(out, kp, lm, c)).abs() + (px(out, kp, lm, c) - px(out, km - 1, lm, c)).abs()) as f32
                            } else { (px(out, kp + 1, lm, c) - px(out, kp, lm, c)).abs() as f32 * 2.0 }
                        } else if fu { (px(out, kp, lm, c) - px(out, km - 1, lm, c)).abs() as f32 * 2.0 } else { 0.0 };
                        let gy = if fr {
                            if fl {
                                ((px(out, km, lp + 1, c) - px(out, km, lm, c)).abs() + (px(out, km, lm, c) - px(out, km, lm - 1, c)).abs()) as f32
                            } else { (px(out, km, lp + 1, c) - px(out, km, lm, c)).abs() as f32 * 2.0 }
                        } else if fl { (px(out, km, lm, c) - px(out, km, lm - 1, c)).abs() as f32 * 2.0 } else { 0.0 };
                        gx = -gx;
                        let mut dir = rx * gx + ry * gy;
                        if (dir as f64).abs() <= 0.01 {
                            dir = 0.000001;
                        } else {
                            let gl = gx * gx + gy * gy;
                            dir = ((rx * gx + ry * gy) as f64 / ((vl * gl) as f64).sqrt()).abs() as f32;
                        }
                        let wgt = dst * dir;
                        ia[c] += wgt * px(out, k - 1, l - 1, c) as f32;
                        s[c] += wgt;
                    }
                }
            }
            let o = ((iu - 1) * w + (ju - 1)) * 3;
            for c in 0..3 {
                out[o + c] = saturate_u8(ia[c] as f64 / s[c] as f64);
            }
            f[g.at(iu, ju)] = BAND;
            heap.push(iu, ju, dist);
        }
    }
}

/// 等价于 cv2.inpaint(img, mask, radius, INPAINT_TELEA / INPAINT_NS)；mask 非 0 即需修补
pub(crate) fn inpaint(img: &RgbImage, mask: &[u8], radius: f64, ns: bool) -> RgbImage {
    let (w, h) = (img.width() as usize, img.height() as usize);
    let range = (radius.round_ties_even() as isize).clamp(1, 100);
    let g = Grid { rows: h + 2, cols: w + 2 };
    let n = g.rows * g.cols;
    let mut out = img.as_raw().clone();

    // mask（带 1 像素边框）：INSIDE = 待修补
    let mut m = vec![KNOWN; n];
    for y in 0..h {
        for x in 0..w {
            if mask[y * w + x] != 0 {
                m[g.at(y + 1, x + 1)] = INSIDE;
            }
        }
    }
    set_border(&mut m, &g);
    let mut t = vec![1.0e6f32; n];
    // band = dilate(mask, 十字) − mask
    let mut band = vec![0u8; n];
    for i in 0..g.rows {
        for j in 0..g.cols {
            if m[g.at(i, j)] != 0 {
                continue;
            }
            let hit = (i > 0 && m[g.at(i - 1, j)] != 0)
                || (i + 1 < g.rows && m[g.at(i + 1, j)] != 0)
                || (j > 0 && m[g.at(i, j - 1)] != 0)
                || (j + 1 < g.cols && m[g.at(i, j + 1)] != 0);
            if hit {
                band[g.at(i, j)] = INSIDE;
            }
        }
    }
    set_border(&mut band, &g);
    let mut heap = Pq::new();
    heap.add(&band, g.rows, g.cols);
    if heap.heap.is_empty() {
        return img.clone();
    }
    for k in 0..n {
        if band[k] != 0 {
            t[k] = 0.0;
        }
    }

    if !ns {
        // 先在掩膜外 range 圈内算「负距离」，Telea 的 lev 权重要用
        let r = range as usize;
        let mut ring = vec![0u8; n];
        // dilate(mask, (2r+1)² 方形) − mask − band
        let mut rowmax = vec![0u8; n];
        for i in 0..g.rows {
            for j in 0..g.cols {
                let (a, b) = (j.saturating_sub(r), (j + r).min(g.cols - 1));
                rowmax[g.at(i, j)] = (a..=b).map(|jj| m[g.at(i, jj)]).max().unwrap_or(0);
            }
        }
        for i in 0..g.rows {
            let (a, b) = (i.saturating_sub(r), (i + r).min(g.rows - 1));
            for j in 0..g.cols {
                let d = (a..=b).map(|ii| rowmax[g.at(ii, j)]).max().unwrap_or(0);
                let k = g.at(i, j);
                ring[k] = d.saturating_sub(m[k]).saturating_sub(band[k]);
            }
        }
        let mut out_heap = Pq::new();
        out_heap.add(&band, g.rows, g.cols);
        set_border(&mut ring, &g);
        calc_fmm(&g, &mut ring, &mut t, &mut out_heap, true);
        telea(&g, &mut m, &mut t, &mut out, w, range, &mut heap);
    } else {
        navier_stokes(&g, &mut m, &mut t, &mut out, w, range, &mut heap);
    }
    RgbImage::from_raw(w as u32, h as u32, out).expect("same size")
}

fn set_border(a: &mut [u8], g: &Grid) {
    for j in 0..g.cols {
        a[g.at(0, j)] = 0;
        a[g.at(g.rows - 1, j)] = 0;
    }
    for i in 0..g.rows {
        a[g.at(i, 0)] = 0;
        a[g.at(i, g.cols - 1)] = 0;
    }
}

// ───────────────────────── LaMa ─────────────────────────

/// 单轴 INTER_AREA 权重（缩小：按覆盖面积加权；放大：线性插值，与 OpenCV 行为接近）
fn area_weights(src: usize, dst: usize) -> Vec<Vec<(usize, f32)>> {
    let scale = src as f64 / dst as f64;
    (0..dst)
        .map(|d| {
            if scale >= 1.0 {
                let (a, b) = (d as f64 * scale, (d as f64 + 1.0) * scale);
                let mut v = Vec::new();
                let mut s = a.floor() as usize;
                while (s as f64) < b && s < src {
                    let lo = a.max(s as f64);
                    let hi = b.min(s as f64 + 1.0);
                    if hi > lo {
                        v.push((s, ((hi - lo) / scale) as f32));
                    }
                    s += 1;
                }
                v
            } else {
                let fx = ((d as f64 + 0.5) * scale - 0.5).max(0.0);
                let i0 = (fx.floor() as usize).min(src - 1);
                let i1 = (i0 + 1).min(src - 1);
                let t = (fx - i0 as f64) as f32;
                vec![(i0, 1.0 - t), (i1, t)]
            }
        })
        .collect()
}

pub(crate) fn resize_area_rgb(img: &RgbImage, dw: usize, dh: usize) -> Vec<u8> {
    let (w, h) = (img.width() as usize, img.height() as usize);
    let src = img.as_raw();
    let wx = area_weights(w, dw);
    let wy = area_weights(h, dh);
    let mut tmp = vec![0f32; h * dw * 3];
    for y in 0..h {
        for (x, ws) in wx.iter().enumerate() {
            for c in 0..3 {
                tmp[(y * dw + x) * 3 + c] = ws.iter().map(|(sx, wt)| src[(y * w + sx) * 3 + c] as f32 * wt).sum();
            }
        }
    }
    let mut out = vec![0u8; dw * dh * 3];
    for (y, ws) in wy.iter().enumerate() {
        for x in 0..dw {
            for c in 0..3 {
                let v: f32 = ws.iter().map(|(sy, wt)| tmp[(sy * dw + x) * 3 + c] * wt).sum();
                out[(y * dw + x) * 3 + c] = saturate_u8(v as f64);
            }
        }
    }
    out
}

/// cv2.resize(..., INTER_NEAREST)：sx = floor(dx * src/dst)
pub(crate) fn resize_nearest(src: &[u8], w: usize, h: usize, dw: usize, dh: usize) -> Vec<u8> {
    let mut out = vec![0u8; dw * dh];
    for y in 0..dh {
        let sy = ((y as f64 * h as f64 / dh as f64).floor() as usize).min(h - 1);
        for x in 0..dw {
            let sx = ((x as f64 * w as f64 / dw as f64).floor() as usize).min(w - 1);
            out[y * dw + x] = src[sy * w + sx];
        }
    }
    out
}

pub(crate) fn lama_inpaint(img: &RgbImage, mask: &[u8], model: &Path) -> Result<RgbImage, String> {
    use ort::session::builder::GraphOptimizationLevel;
    use ort::session::Session;
    use ort::value::{Tensor, ValueType};

    if !model.is_file() {
        return Err("LaMa 模型文件不存在，请在设置里下载「去水印 · 精细模型」".into());
    }
    if !mask.iter().any(|v| *v != 0) {
        return Err("没有需要修补的区域".into());
    }
    let (w, h) = (img.width() as usize, img.height() as usize);
    let size = 512usize;
    let mut session = Session::builder()
        .map_err(|e| format!("初始化 ONNX Runtime 失败：{e}"))?
        .with_optimization_level(GraphOptimizationLevel::All)
        .map_err(|e| format!("设置图优化级别失败：{e}"))?
        .commit_from_file(model)
        .map_err(|e| format!("加载模型失败：{e}"))?;

    let small = resize_area_rgb(img, size, size);
    let plane = size * size;
    let mut image = vec![0f32; 3 * plane];
    for i in 0..plane {
        for c in 0..3 {
            image[c * plane + i] = small[i * 3 + c] as f32 / 255.0;
        }
    }
    let msmall = resize_nearest(mask, w, h, size, size);
    let m: Vec<f32> = msmall.iter().map(|v| if *v > 127 { 1.0 } else { 0.0 }).collect();

    // 按名字/形状匹配：名字含 mask 或第 1 维是 1 的当掩膜
    let mut image_name = None;
    let mut mask_name = None;
    for spec in session.inputs() {
        let name = spec.name().to_string();
        let ch1 = matches!(spec.dtype(), ValueType::Tensor { shape, .. } if shape.len() == 4 && shape[1] == 1);
        let is_mask = name.to_lowercase().contains("mask") || ch1;
        if is_mask && mask_name.is_none() {
            mask_name = Some(name);
        } else if image_name.is_none() {
            image_name = Some(name);
        } else if mask_name.is_none() {
            mask_name = Some(name);
        }
    }
    let (image_name, mask_name) = match (image_name, mask_name) {
        (Some(a), Some(b)) => (a, b),
        _ => return Err("LaMa 模型的输入不是 image + mask 两个".into()),
    };
    let it = Tensor::from_array(([1usize, 3, size, size], image)).map_err(|e| format!("构造输入张量失败：{e}"))?;
    let mt = Tensor::from_array(([1usize, 1, size, size], m)).map_err(|e| format!("构造输入张量失败：{e}"))?;
    let outputs = session
        .run(ort::inputs![image_name.as_str() => it, mask_name.as_str() => mt])
        .map_err(|e| format!("推理失败：{e}"))?;
    let (mut dims, raw): (Vec<usize>, Vec<f32>) = {
        let value = outputs.iter().next().map(|(_, v)| v).ok_or("模型没有输出")?;
        let (shape, data) = value.try_extract_tensor::<f32>().map_err(|e| format!("读取输出失败：{e}"))?;
        (shape.iter().map(|d| *d as usize).collect(), data.to_vec())
    };
    if dims.len() == 4 {
        dims.remove(0);
    }
    if dims.len() != 3 {
        return Err(format!("不认识的输出形状：{dims:?}"));
    }
    // CHW 或 HWC → RGB u8（输出已是 0~255：clip 后截断，与 numpy astype(uint8) 一致）
    let (oh, ow, chw) = if dims[0] == 3 { (dims[1], dims[2], true) } else { (dims[0], dims[1], false) };
    if raw.len() < oh * ow * 3 {
        return Err("输出数据与形状对不上".into());
    }
    let mut rgb = vec![0u8; oh * ow * 3];
    for i in 0..oh * ow {
        for c in 0..3 {
            let v = if chw { raw[c * oh * ow + i] } else { raw[i * 3 + c] };
            rgb[i * 3 + c] = if v.is_nan() { 0 } else { v.clamp(0.0, 255.0) as u8 };
        }
    }
    let mut patch = RgbImage::from_raw(ow as u32, oh as u32, rgb).ok_or("输出尺寸异常")?;
    if (ow, oh) != (w, h) {
        patch = image::imageops::resize(&patch, w as u32, h as u32, FilterType::Lanczos3);
    }
    let mut result = img.clone();
    for (i, mv) in mask.iter().enumerate() {
        if *mv > 127 {
            let (x, y) = ((i % w) as u32, (i / w) as u32);
            result.put_pixel(x, y, *patch.get_pixel(x, y));
        }
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn median_matches_bruteforce() {
        let (w, h) = (23usize, 17usize);
        let src: Vec<u8> = (0..w * h).map(|i| ((i * 7919) % 251) as u8).collect();
        let k = 5;
        let got = median_blur(&src, w, h, k);
        for y in 0..h as isize {
            for x in 0..w as isize {
                let mut v = Vec::new();
                for dy in -2..=2isize {
                    for dx in -2..=2isize {
                        let yy = (y + dy).clamp(0, h as isize - 1) as usize;
                        let xx = (x + dx).clamp(0, w as isize - 1) as usize;
                        v.push(src[yy * w + xx]);
                    }
                }
                v.sort();
                assert_eq!(got[y as usize * w + x as usize], v[12]);
            }
        }
    }

    #[test]
    fn rect_is_inclusive_and_clipped() {
        let m = build_mask(10, 10, &[json!({"x": 2.9, "y": 1, "w": 3, "h": 2}), json!({"x": 8, "y": 8, "w": 5, "h": 5})], &[], 24);
        let count = m.iter().filter(|v| **v != 0).count();
        // (2..=5)×(1..=3) = 12，(8..=9)×(8..=9) = 4
        assert_eq!(count, 16);
    }

    #[test]
    fn inpaint_fills_hole_in_flat_image() {
        let img = RgbImage::from_pixel(40, 30, image::Rgb([120, 60, 200]));
        let mut mask = vec![0u8; 40 * 30];
        for y in 10..20 { for x in 12..28 { mask[y * 40 + x] = 255; } }
        let mut holed = img.clone();
        for y in 10..20 { for x in 12..28 { holed.put_pixel(x as u32, y as u32, image::Rgb([0, 0, 0])); } }
        for ns in [false, true] {
            let out = inpaint(&holed, &mask, 4.0, ns);
            for p in out.pixels() {
                // Telea 公式里的 (Jx+Jy)/|J| 项在纯色区也会带来最多约 ±1.4 的偏移，再加 round_cast 的 +0.5，
                // OpenCV 本身就是这样（与 cv2.inpaint 的逐像素对比为 0 误差），所以容差给 3
                assert!(p.0.iter().zip([120u8, 60, 200]).all(|(a, b)| a.abs_diff(b) <= 3), "ns={ns} {:?}", p.0);
            }
        }
    }

    #[test]
    fn empty_payload_paints_nothing() {
        let img = RgbImage::from_pixel(64, 64, image::Rgb([90, 90, 90]));
        let (_, painted) = prepare_mask(&img, &json!({"regions": "[]", "strokes": "[]", "auto_light": "yes"}));
        assert_eq!(painted, 0);
    }

    /// 与 OpenCV 对比：FK_INPAINT_CMP=<目录>（inp_input.png、inp_cases.json、py_mask_*.png、py_inp_*.png）
    #[test]
    #[ignore = "needs Python reference outputs"]
    fn compare_with_python_reference() {
        let Some(dir) = std::env::var_os("FK_INPAINT_CMP") else { return; };
        let dir = PathBuf::from(dir);
        let img = image::open(dir.join("inp_input.png")).unwrap().to_rgb8();
        let (w, h) = (img.width() as usize, img.height() as usize);
        let cases: Vec<Value> = serde_json::from_slice(&std::fs::read(dir.join("inp_cases.json")).unwrap()).unwrap();
        for case in cases {
            let name = case["name"].as_str().unwrap();
            let payload = &case["payload"];
            // ① 掩膜
            let t0 = std::time::Instant::now();
            let (ours_mask, painted) = prepare_mask(&img, payload);
            let py_mask = image::open(dir.join(format!("py_mask_{name}.png"))).unwrap().to_luma8().into_raw();
            let diff = ours_mask.iter().zip(&py_mask).filter(|(a, b)| (**a != 0) != (**b != 0)).count();
            let py_painted = case["painted"].as_u64().unwrap_or(0);
            // ② 修补：用 Python 的掩膜，隔离算法差异
            let method = payload["method"].as_str().unwrap_or("telea");
            let t1 = std::time::Instant::now();
            let out = if method == "lama" {
                let Some(model) = std::env::var_os("FK_LAMA_MODEL") else {
                    println!("CMP {name} mask_diff={diff}px painted={painted}/{py_painted} (no FK_LAMA_MODEL)");
                    continue;
                };
                lama_inpaint(&img, &py_mask, Path::new(&model)).unwrap()
            } else {
                inpaint(&img, &py_mask, payload["radius"].as_f64().unwrap_or(4.0), method == "ns")
            };
            let ms = t1.elapsed().as_millis();
            out.save(dir.join(format!("rs_inp_{name}.png"))).unwrap();
            let theirs = image::open(dir.join(format!("py_inp_{name}.png"))).unwrap().to_rgb8().into_raw();
            let a = out.as_raw();
            let n = a.len() as f64;
            let masked: Vec<usize> = (0..w * h).filter(|i| py_mask[*i] != 0).collect();
            let mut sum = 0u64; let mut max = 0u8; let mut over8 = 0usize;
            for i in &masked {
                for c in 0..3 {
                    let d = a[i * 3 + c].abs_diff(theirs[i * 3 + c]);
                    sum += d as u64; max = max.max(d); if d > 8 { over8 += 1; }
                }
            }
            let outside = (0..w * h).filter(|i| py_mask[*i] == 0).any(|i| (0..3).any(|c| a[i * 3 + c] != theirs[i * 3 + c]));
            let mn = (masked.len() * 3).max(1) as f64;
            println!("CMP {name} mask_diff={diff}px painted={painted}/{py_painted} hole_mean={:.3} hole_max={max} hole_over8={:.3}% outside_changed={outside} inpaint={ms}ms mask={}ms n={n}",
                sum as f64 / mn, over8 as f64 * 100.0 / mn, (t1 - t0).as_millis());
        }
    }
}
