//! 音频降噪 + 人声分离：Rust 原生实现（替代 Python 扩展里的 audio_denoise.py / vocal_separate.py）。
//!
//! · 解码统一交给内置 FFmpeg（任意音视频 → 44.1kHz 双声道 f32），结果直接写 16 位 PCM WAV；
//! · 降噪：STFT 频谱门限（按最安静的 p% 帧估计噪声底，维纳式软掩膜，保护稳定谐波，时间上三帧平滑）；
//! · 人声分离：UVR MDX-Net ONNX（Voc_FT / Inst_HQ_3），分块 + 汉宁窗重叠相加，另一轨 = 原音 − 目标轨。

use std::path::{Path, PathBuf};
use std::sync::Arc;

use realfft::num_complex::Complex32;
use realfft::{ComplexToReal, RealFftPlanner, RealToComplex};
use serde_json::{json, Map, Value};

use crate::matting_native::{number, progress, results_path, text};

const SR: u32 = 44_100;
const MAX_SECONDS: f64 = 30.0 * 60.0;

pub fn supported(tool: &str) -> bool {
    matches!(tool, "audio-denoise" | "vocal-separate")
}

// ───────────────────────── 入口：建任务 + 后台线程 ─────────────────────────

pub fn start(app: &tauri::AppHandle, tool: &str, args: &Value) -> Result<Value, String> {
    let tool = tool.to_string();
    let mut payload = args.clone();
    let mut uploads: Vec<Value> = Vec::new();
    if let Some(files) = payload.get("__files").and_then(Value::as_array).cloned() {
        let upload_id = crate::jobs::new_job_id_public();
        uploads = crate::jobs::save_request_uploads(app, &upload_id, &files)?;
    }
    if let Some(o) = payload.as_object_mut() {
        o.remove("__files");
        o.remove("__path");
        o.remove("__method");
    }
    let pick = |u: &Value| -> Option<(String, String)> {
        Some((u.get("path").and_then(Value::as_str)?.to_string(), u.get("name").and_then(Value::as_str).unwrap_or("").to_string()))
    };
    let (input, input_name) = uploads
        .iter()
        .find(|u| u.get("field").and_then(Value::as_str) == Some("file"))
        .and_then(pick)
        .or_else(|| uploads.first().and_then(pick))
        .or_else(|| payload.get("file").or_else(|| payload.get("path")).and_then(Value::as_str).map(|s| (s.to_string(), String::new())))
        .ok_or("没有收到要处理的音频")?;
    if !Path::new(&input).is_file() {
        return Err(format!("找不到输入文件：{input}"));
    }
    payload["file"] = json!(input);

    let job = crate::jobs::create_local_job(app, &tool, payload.clone())?;
    let id = job.get("id").and_then(Value::as_str).ok_or("建任务失败")?.to_string();
    let app_bg = app.clone();
    let id_bg = id.clone();
    std::thread::spawn(move || {
        progress(&app_bg, &id_bg, 5, "正在读取音频…");
        let stem = crate::matting_native::display_stem(&input, &input_name);
        let result = match tool.as_str() {
            "audio-denoise" => denoise_job(&app_bg, &id_bg, Path::new(&input), &stem, &payload),
            "vocal-separate" => separate_job(&app_bg, &id_bg, Path::new(&input), &payload),
            other => Err(format!("不支持的工具：{other}")),
        };
        if cancelled(&app_bg, &id_bg) {
            return;
        }
        let mut m = Map::new();
        match result {
            Ok(r) => {
                m.insert("status".into(), json!("completed"));
                m.insert("progress".into(), json!(100));
                if let Some(o) = r.as_object() {
                    for (k, v) in o {
                        m.insert(k.clone(), v.clone());
                    }
                }
                m.insert("engine".into(), json!("rust-native"));
            }
            Err(e) => {
                m.insert("status".into(), json!("failed"));
                m.insert("progress".into(), json!(100));
                m.insert("message".into(), json!("处理失败"));
                m.insert("error".into(), json!(e));
            }
        }
        crate::jobs::update_job(&app_bg, &id_bg, m);
    });
    let current = crate::jobs::read_job_public(app, &id).unwrap_or(job);
    Ok(json!({ "job": current, "ok": true, "engine": "rust-native" }))
}

fn cancelled(app: &tauri::AppHandle, id: &str) -> bool {
    crate::jobs::read_job_public(app, id)
        .and_then(|j| j.get("status").and_then(Value::as_str).map(|s| s == "failed"))
        .unwrap_or(false)
}

fn check(app: &tauri::AppHandle, id: &str) -> Result<(), String> {
    if cancelled(app, id) { Err("任务已取消".into()) } else { Ok(()) }
}

// ───────────────────────── 解码 / WAV ─────────────────────────

/// 任意音视频 → 44.1kHz 双声道（左、右两路 f32）
fn decode(app: &tauri::AppHandle, id: &str, input: &Path) -> Result<[Vec<f32>; 2], String> {
    let ffmpeg = crate::audio_tags_native::find_ffmpeg(app)?;
    let _lease = crate::api::component_use(app, &["ffmpeg.exe", "ffprobe.exe"]).ok();
    let tmp = std::env::temp_dir().join(format!("fk_audio_{id}.f32"));
    let mut cmd = std::process::Command::new(&ffmpeg);
    cmd.arg("-v").arg("error").arg("-nostdin").arg("-y").arg("-i").arg(input)
        .args(["-vn", "-f", "f32le", "-acodec", "pcm_f32le", "-ac", "2", "-ar", "44100"])
        .arg(&tmp)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped());
    crate::commands::no_window(&mut cmd);
    let out = cmd.output().map_err(|e| format!("无法启动 FFmpeg：{e}"))?;
    let bytes = std::fs::read(&tmp).unwrap_or_default();
    let _ = std::fs::remove_file(&tmp);
    if !out.status.success() || bytes.len() < 8 {
        let err = String::from_utf8_lossy(&out.stderr);
        let last = err.lines().filter(|l| !l.trim().is_empty()).last().unwrap_or("").trim().to_string();
        return Err(if last.is_empty() { "无法解码音频（文件可能不含音轨或已损坏）".into() } else { format!("无法解码音频：{last}") });
    }
    let n = bytes.len() / 8;
    if n as f64 > MAX_SECONDS * SR as f64 {
        return Err("音频超过 30 分钟，请先用「音频剪切」分段后再处理".into());
    }
    let mut l = Vec::with_capacity(n);
    let mut r = Vec::with_capacity(n);
    for f in bytes.chunks_exact(8) {
        let a = f32::from_le_bytes([f[0], f[1], f[2], f[3]]);
        let b = f32::from_le_bytes([f[4], f[5], f[6], f[7]]);
        l.push(if a.is_finite() { a } else { 0.0 });
        r.push(if b.is_finite() { b } else { 0.0 });
    }
    Ok([l, r])
}

/// 16 位 PCM WAV（与 ffmpeg pcm_s16le 一样：×32768 四舍五入后截幅）
fn wav_bytes(ch: &[Vec<f32>; 2]) -> Vec<u8> {
    let n = ch[0].len().min(ch[1].len());
    let data_len = (n * 4) as u32;
    let mut v = Vec::with_capacity(44 + n * 4);
    v.extend_from_slice(b"RIFF");
    v.extend_from_slice(&(36 + data_len).to_le_bytes());
    v.extend_from_slice(b"WAVEfmt ");
    v.extend_from_slice(&16u32.to_le_bytes());
    v.extend_from_slice(&1u16.to_le_bytes());
    v.extend_from_slice(&2u16.to_le_bytes());
    v.extend_from_slice(&SR.to_le_bytes());
    v.extend_from_slice(&(SR * 4).to_le_bytes());
    v.extend_from_slice(&4u16.to_le_bytes());
    v.extend_from_slice(&16u16.to_le_bytes());
    v.extend_from_slice(b"data");
    v.extend_from_slice(&data_len.to_le_bytes());
    let q = |x: f32| -> i16 { (x * 32768.0).round().clamp(-32768.0, 32767.0) as i16 };
    for i in 0..n {
        v.extend_from_slice(&q(ch[0][i]).to_le_bytes());
        v.extend_from_slice(&q(ch[1][i]).to_le_bytes());
    }
    v
}

fn rms(ch: &[Vec<f32>; 2]) -> f64 {
    let n = (ch[0].len() + ch[1].len()).max(1) as f64;
    (ch.iter().flat_map(|c| c.iter()).map(|x| (*x as f64) * (*x as f64)).sum::<f64>() / n).sqrt()
}

fn round_to(v: f64, d: i32) -> f64 {
    let p = 10f64.powi(d);
    (v * p).round() / p
}

// ───────────────────────── STFT（numpy 版口径） ─────────────────────────

struct Stft {
    n_fft: usize,
    hop: usize,
    window: Vec<f32>,
    fwd: Arc<dyn RealToComplex<f32>>,
    inv: Arc<dyn ComplexToReal<f32>>,
}

impl Stft {
    fn new(n_fft: usize, hop: usize) -> Self {
        let mut planner = RealFftPlanner::<f32>::new();
        // 周期汉宁窗：np.hanning(n+1)[:-1]
        let window = (0..n_fft).map(|k| (0.5 - 0.5 * (2.0 * std::f64::consts::PI * k as f64 / n_fft as f64).cos()) as f32).collect();
        Stft { n_fft, hop, window, fwd: planner.plan_fft_forward(n_fft), inv: planner.plan_fft_inverse(n_fft) }
    }

    fn bins(&self) -> usize {
        self.n_fft / 2 + 1
    }

    /// np.pad(x, n_fft/2, mode="reflect")
    fn padded(&self, x: &[f32]) -> Result<Vec<f32>, String> {
        let p = self.n_fft / 2;
        if x.len() <= p {
            return Err("音频太短，至少需要零点几秒的有效声音".into());
        }
        let n = x.len();
        let mut out = Vec::with_capacity(n + 2 * p);
        for i in (1..=p).rev() {
            out.push(x[i]);
        }
        out.extend_from_slice(x);
        for i in 0..p {
            out.push(x[n - 2 - i]);
        }
        Ok(out)
    }

    fn frames(&self, len: usize) -> usize {
        len / self.hop + 1
    }

    /// 返回 [frame][bin]
    fn forward(&self, x: &[f32]) -> Result<Vec<Vec<Complex32>>, String> {
        let padded = self.padded(x)?;
        let count = self.frames(x.len());
        let mut buf = self.fwd.make_input_vec();
        let mut spec = Vec::with_capacity(count);
        for t in 0..count {
            let s = t * self.hop;
            for k in 0..self.n_fft {
                buf[k] = padded[s + k] * self.window[k];
            }
            let mut out = self.fwd.make_output_vec();
            self.fwd.process(&mut buf, &mut out).map_err(|e| format!("FFT 失败：{e}"))?;
            spec.push(out);
        }
        Ok(spec)
    }

    fn frame(&self, padded: &[f32], t: usize, buf: &mut [f32], out: &mut [Complex32]) -> Result<(), String> {
        let s = t * self.hop;
        for k in 0..self.n_fft {
            buf[k] = padded[s + k] * self.window[k];
        }
        self.fwd.process(buf, out).map_err(|e| format!("FFT 失败：{e}"))
    }

    fn inverse_frame(&self, spec: &mut [Complex32], out: &mut [f32]) -> Result<(), String> {
        let last = spec.len() - 1;
        spec[0].im = 0.0;
        spec[last].im = 0.0;
        self.inv.process(spec, out).map_err(|e| format!("逆 FFT 失败：{e}"))?;
        let scale = 1.0 / self.n_fft as f32;
        for v in out.iter_mut() {
            *v *= scale;
        }
        Ok(())
    }
}

/// 重叠相加（窗平方归一化），取 [n_fft/2 .. n_fft/2+len]
struct Ola {
    acc: Vec<f32>,
    norm: Vec<f32>,
}

impl Ola {
    fn new(frames: usize, st: &Stft) -> Self {
        let n = (frames.max(1) - 1) * st.hop + st.n_fft;
        Ola { acc: vec![0.0; n], norm: vec![0.0; n] }
    }
    fn add(&mut self, st: &Stft, t: usize, wave: &[f32]) {
        let s = t * st.hop;
        for k in 0..st.n_fft {
            self.acc[s + k] += wave[k] * st.window[k];
            self.norm[s + k] += st.window[k] * st.window[k];
        }
    }
    fn finish(self, st: &Stft, len: usize) -> Vec<f32> {
        let p = st.n_fft / 2;
        (0..len)
            .map(|i| {
                let j = p + i;
                if j < self.acc.len() && self.norm[j] > 1e-8 { self.acc[j] / self.norm[j] } else { 0.0 }
            })
            .collect()
    }
}

fn istft(st: &Stft, spec: &mut [Vec<Complex32>], len: usize) -> Result<Vec<f32>, String> {
    let mut ola = Ola::new(spec.len(), st);
    let mut wave = st.inv.make_output_vec();
    for (t, frame) in spec.iter_mut().enumerate() {
        st.inverse_frame(frame, &mut wave)?;
        ola.add(st, t, &wave);
    }
    Ok(ola.finish(st, len))
}

// ───────────────────────── 降噪 ─────────────────────────

/// numpy.percentile（线性插值）
fn percentile(v: &mut [f32], p: f64) -> f32 {
    let n = v.len();
    if n == 0 {
        return 0.0;
    }
    let pos = (p / 100.0).clamp(0.0, 1.0) * (n - 1) as f64;
    let lo = pos.floor() as usize;
    let hi = (lo + 1).min(n - 1);
    let (_, a, _) = v.select_nth_unstable_by(lo, |x, y| x.total_cmp(y));
    let a = *a;
    if hi == lo {
        return a;
    }
    let b = v[lo + 1..].iter().copied().fold(f32::INFINITY, f32::min);
    a + ((b - a) as f64 * (pos - lo as f64)) as f32
}

pub(crate) fn denoise_channel(x: &[f32], strength: f32, pct: f64, over: f32, check: &dyn Fn() -> Result<(), String>) -> Result<Vec<f32>, String> {
    let st = Stft::new(2048, 512);
    let bins = st.bins();
    let padded = st.padded(x)?;
    let frames = st.frames(x.len());
    // 第一遍：只留功率谱 [bin][frame]
    let mut power = vec![0f32; bins * frames];
    let mut buf = st.fwd.make_input_vec();
    let mut out = st.fwd.make_output_vec();
    for t in 0..frames {
        if t % 2048 == 0 {
            check()?;
        }
        st.frame(&padded, t, &mut buf, &mut out)?;
        for f in 0..bins {
            power[f * frames + t] = out[f].norm_sqr();
        }
    }
    // 每个频点：噪声底、是否为稳定信号
    let mut noise = vec![0f32; bins];
    let mut signal = vec![false; bins];
    let mut scratch = vec![0f32; frames];
    for f in 0..bins {
        let row = &power[f * frames..(f + 1) * frames];
        scratch.copy_from_slice(row);
        let np = percentile(&mut scratch, pct) * 1.5 * over * over;
        noise[f] = np.max(1e-12);
        scratch.copy_from_slice(row);
        let med = percentile(&mut scratch, 50.0);
        let peak = row.iter().copied().fold(0f32, f32::max);
        signal[f] = peak > med * 20.0;
    }
    // 与 np.roll 连续四次（-2,-1,1,2）累积或运算完全一致
    for k in [-2isize, -1, 1, 2] {
        let prev = signal.clone();
        for f in 0..bins {
            let src = (f as isize - k).rem_euclid(bins as isize) as usize;
            signal[f] = prev[f] || prev[src];
        }
    }
    let mask_at = |f: usize, t: usize| -> f32 {
        if signal[f] {
            return 1.0;
        }
        let snr = (power[f * frames + t] / noise[f] - 1.0).max(0.0);
        let m = snr / (snr + 1.0);
        (1.0 - strength * (1.0 - m)).max(0.05)
    };
    // 第二遍：重新做 STFT，乘三帧平滑后的掩膜，重叠相加
    let mut ola = Ola::new(frames, &st);
    let mut wave = st.inv.make_output_vec();
    for t in 0..frames {
        if t % 2048 == 0 {
            check()?;
        }
        st.frame(&padded, t, &mut buf, &mut out)?;
        let (tp, tn) = ((t + frames - 1) % frames, (t + 1) % frames);
        for f in 0..bins {
            let m = ((mask_at(f, t) + mask_at(f, tp) + mask_at(f, tn)) / 3.0).clamp(0.0, 1.0);
            out[f] *= m;
        }
        st.inverse_frame(&mut out, &mut wave)?;
        ola.add(&st, t, &wave);
    }
    Ok(ola.finish(&st, x.len()))
}

fn py_num(v: f64) -> String {
    if v.fract() == 0.0 { format!("{v:.1}") } else { format!("{v}") }
}

fn denoise_job(app: &tauri::AppHandle, id: &str, input: &Path, stem: &str, payload: &Value) -> Result<Value, String> {
    let strength = number(payload, "strength", 0.6).clamp(0.0, 1.0);
    let pct = number(payload, "percentile", 5.0).clamp(1.0, 50.0);
    let over = number(payload, "oversubtract", 1.0).clamp(0.5, 3.0);
    let audio = decode(app, id, input)?;
    check(app, id)?;
    let len = audio[0].len();
    let ck = || check(app, id);
    let mut outs: Vec<Vec<f32>> = Vec::with_capacity(2);
    for (i, ch) in audio.iter().enumerate() {
        progress(app, id, 20 + i as u32 * 35, &format!("正在分析噪声并降噪（{}/2 声道）…", i + 1));
        outs.push(denoise_channel(ch, strength as f32, pct, over as f32, &ck)?);
    }
    let r = outs.pop().unwrap_or_default();
    let l = outs.pop().unwrap_or_default();
    let cleaned = [l, r];
    progress(app, id, 92, "正在保存结果…");
    let plain = format!("{stem}_已降噪.wav");
    let path = results_path(app, id, &plain)?;
    std::fs::write(&path, wav_bytes(&cleaned)).map_err(|e| format!("保存结果失败：{e}"))?;
    let (before, after) = (round_to(rms(&audio), 5), round_to(rms(&cleaned), 5));
    let dur = round_to(len as f64 / SR as f64, 2);
    let message = format!("已降噪（强度 {}）：电平 {} → {}，时长 {} 秒", py_num(strength), py_num(before), py_num(after), py_num(dur));
    Ok(json!({
        "message": message, "resultPath": path.to_string_lossy(), "resultFilename": plain, "resultMimeType": "audio/wav",
        "rmsBefore": before, "rmsAfter": after, "durationSec": dur, "strength": strength,
    }))
}

// ───────────────────────── 人声分离（MDX-Net） ─────────────────────────

struct Profile {
    file: &'static str,
    size: u64,
    compensate: f32,
    dim_f: usize,
    dim_t: usize,
    n_fft: usize,
    vocals_primary: bool,
}

const VOC_FT: Profile = Profile { file: "UVR-MDX-NET-Voc_FT.onnx", size: 66_762_490, compensate: 1.021, dim_f: 3072, dim_t: 256, n_fft: 7680, vocals_primary: true };
const INST_HQ3: Profile = Profile { file: "UVR-MDX-NET-Inst_HQ_3.onnx", size: 66_759_214, compensate: 1.022, dim_f: 3072, dim_t: 256, n_fft: 6144, vocals_primary: false };
const MISSING_MDX: &str = "请在设置中下载人声与伴奏双核心组件（也可以直接点本页上方的下载按钮） / Download the vocal and instrumental model pair in Settings";

struct Mdx {
    session: ort::session::Session,
    input: String,
    st: Stft,
    p: &'static Profile,
    double: bool,
}

impl Mdx {
    fn chunk(&self) -> usize {
        self.st.hop * (self.p.dim_t - 1)
    }

    fn infer(&mut self, x: Vec<f32>) -> Result<Vec<f32>, String> {
        use ort::value::Tensor;
        let t = Tensor::from_array(([1usize, 4, self.p.dim_f, self.p.dim_t], x)).map_err(|e| format!("构造输入张量失败：{e}"))?;
        let outputs = self.session.run(ort::inputs![self.input.as_str() => t]).map_err(|e| format!("人声分离推理失败：{e}"))?;
        let value = outputs.iter().next().map(|(_, v)| v).ok_or("模型没有输出")?;
        let (_, data) = value.try_extract_tensor::<f32>().map_err(|e| format!("读取输出失败：{e}"))?;
        if data.len() < 4 * self.p.dim_f * self.p.dim_t {
            return Err("模型输出大小不对".into());
        }
        Ok(data.to_vec())
    }

    /// 一块 (2, chunk) 波形 → 预测的目标轨 (2, chunk)
    fn predict(&mut self, wave: [&[f32]; 2]) -> Result<[Vec<f32>; 2], String> {
        let (df, dt) = (self.p.dim_f, self.p.dim_t);
        let chunk = self.chunk();
        let specs = [self.st.forward(wave[0])?, self.st.forward(wave[1])?];
        let mut x = vec![0f32; 4 * df * dt];
        for c in 0..2 {
            for t in 0..dt.min(specs[c].len()) {
                for f in 3..df {
                    let v = specs[c][t][f];
                    x[((2 * c) * df + f) * dt + t] = v.re;
                    x[((2 * c + 1) * df + f) * dt + t] = v.im;
                }
            }
        }
        let y = if self.double {
            let neg: Vec<f32> = x.iter().map(|v| -v).collect();
            let a = self.infer(x)?;
            let b = self.infer(neg)?;
            a.iter().zip(&b).map(|(p, n)| (p - n) * 0.5).collect()
        } else {
            self.infer(x)?
        };
        let bins = self.st.bins();
        let mut out: [Vec<f32>; 2] = [Vec::new(), Vec::new()];
        for c in 0..2 {
            let mut spec: Vec<Vec<Complex32>> = vec![vec![Complex32::new(0.0, 0.0); bins]; dt];
            for t in 0..dt {
                for f in 0..df.min(bins) {
                    spec[t][f] = Complex32::new(y[((2 * c) * df + f) * dt + t], y[((2 * c + 1) * df + f) * dt + t]);
                }
            }
            out[c] = istft(&self.st, &mut spec, chunk)?;
        }
        Ok(out)
    }
}

fn load_mdx(model: &Path, p: &'static Profile, double: bool) -> Result<Mdx, String> {
    use ort::session::builder::GraphOptimizationLevel;
    use ort::session::Session;
    let threads = (std::thread::available_parallelism().map(|n| n.get()).unwrap_or(2) / 2).clamp(1, 4);
    let session = Session::builder()
        .map_err(|e| format!("初始化 ONNX Runtime 失败：{e}"))?
        .with_optimization_level(GraphOptimizationLevel::All)
        .map_err(|e| format!("设置图优化级别失败：{e}"))?
        .with_intra_threads(threads)
        .map_err(|e| format!("设置线程数失败：{e}"))?
        .commit_from_file(model)
        .map_err(|e| format!("加载人声分离模型失败：{e}"))?;
    let input = session.inputs().first().map(|s| s.name().to_string()).ok_or("模型没有输入")?;
    Ok(Mdx { session, input, st: Stft::new(p.n_fft, 1024), p, double })
}

/// 返回 (目标轨)；调用方用 原音 − 目标 得到另一轨
fn separate(mdx: &mut Mdx, audio: &[Vec<f32>; 2], fast: bool, on_chunk: &mut dyn FnMut(usize, usize) -> Result<(), String>) -> Result<[Vec<f32>; 2], String> {
    let length = audio[0].len();
    let chunk = mdx.chunk();
    let trim = mdx.p.n_fft / 2;
    let useful = chunk - 2 * trim;
    let step = if fast { useful * 3 / 4 } else { useful / 2 }.max(1);
    // np.hanning(useful+2)[1:-1]
    let m = (useful + 2) as f64;
    let window: Vec<f32> = (1..=useful).map(|k| (0.5 - 0.5 * (2.0 * std::f64::consts::PI * k as f64 / (m - 1.0)).cos()) as f32).collect();
    let pad = |c: &Vec<f32>| {
        let mut v = vec![0f32; trim];
        v.extend_from_slice(c);
        v.extend(std::iter::repeat(0f32).take(chunk));
        v
    };
    let padded = [pad(&audio[0]), pad(&audio[1])];
    let mut target = [vec![0f32; length], vec![0f32; length]];
    let mut weights = vec![0f32; length];
    let starts: Vec<usize> = (0..length).step_by(step).collect();
    for (i, &s) in starts.iter().enumerate() {
        on_chunk(i, starts.len())?;
        let pred = mdx.predict([&padded[0][s..s + chunk], &padded[1][s..s + chunk]])?;
        let end = length.min(s + useful);
        let size = end - s;
        for c in 0..2 {
            for k in 0..size {
                target[c][s + k] += pred[c][trim + k] * window[k];
            }
        }
        for k in 0..size {
            weights[s + k] += window[k];
        }
    }
    for c in 0..2 {
        for (v, w) in target[c].iter_mut().zip(&weights) {
            *v = *v / w.max(1e-8) * mdx.p.compensate;
        }
    }
    Ok(target)
}

fn separate_job(app: &tauri::AppHandle, id: &str, input: &Path, payload: &Value) -> Result<Value, String> {
    let which = text(payload, "model", "vocals");
    let quality = text(payload, "quality", "balanced").to_string();
    let profile: &'static Profile = if which == "instrumental" { &INST_HQ3 } else { &VOC_FT };
    let dir = crate::api::components_dir(app)?;
    let ready = |p: &Profile| std::fs::metadata(dir.join(p.file)).map(|m| m.is_file() && m.len() == p.size).unwrap_or(false);
    if !ready(&VOC_FT) || !ready(&INST_HQ3) {
        return Err(MISSING_MDX.into());
    }
    let model: PathBuf = dir.join(profile.file);
    let _lease = crate::api::component_use(app, &[VOC_FT.file, INST_HQ3.file])?;

    let audio = decode(app, id, input)?;
    let length = audio[0].len();
    if length < SR as usize / 10 {
        return Err("音频太短（不足 0.1 秒）".into());
    }
    check(app, id)?;
    progress(app, id, 12, "正在加载分离模型…");
    let mut mdx = load_mdx(&model, profile, quality == "quality")?;
    let mut on_chunk = |i: usize, n: usize| -> Result<(), String> {
        check(app, id)?;
        let pct = 15 + (i as f64 / n.max(1) as f64 * 75.0) as u32;
        progress(app, id, pct, &format!("正在分离人声与伴奏（{}/{} 段）…", i + 1, n));
        Ok(())
    };
    let target = separate(&mut mdx, &audio, quality == "fast", &mut on_chunk)?;
    drop(mdx);
    let other = [
        audio[0].iter().zip(&target[0]).map(|(a, t)| a - t).collect::<Vec<f32>>(),
        audio[1].iter().zip(&target[1]).map(|(a, t)| a - t).collect::<Vec<f32>>(),
    ];
    let (mut vocals, mut inst) = if profile.vocals_primary { (target, other) } else { (other, target) };
    for stem in [&mut vocals, &mut inst] {
        let peak = stem.iter().flat_map(|c| c.iter()).fold(0f32, |m, v| m.max(v.abs()));
        let gain = if peak > 0.0 { (0.99 / peak).min(1.0) } else { 1.0 };
        if gain < 1.0 {
            for c in stem.iter_mut() {
                for v in c.iter_mut() {
                    *v *= gain;
                }
            }
        }
    }
    progress(app, id, 93, "正在保存人声与伴奏…");
    let vw = wav_bytes(&vocals);
    let iw = wav_bytes(&inst);
    std::fs::write(results_path(app, id, "vocals.wav")?, &vw).map_err(|e| format!("保存人声失败：{e}"))?;
    std::fs::write(results_path(app, id, "instrumental.wav")?, &iw).map_err(|e| format!("保存伴奏失败：{e}"))?;
    let mut zip = crate::mini_zip::ZipWriter::new();
    zip.add("vocals.wav", &vw)?;
    zip.add("instrumental.wav", &iw)?;
    let plain = "vocal-and-instrumental.zip";
    let zip_path = results_path(app, id, plain)?;
    std::fs::write(&zip_path, zip.finish()).map_err(|e| format!("保存压缩包失败：{e}"))?;
    let dur = round_to(length as f64 / SR as f64, 2);
    let label = if profile.vocals_primary { "人声模型" } else { "伴奏模型" };
    let q = match quality.as_str() { "fast" => "快速", "quality" => "精细", _ => "均衡" };
    Ok(json!({
        "message": format!("已分离人声与伴奏（{label} · {q}），时长 {} 秒", py_num(dur)),
        "resultPath": zip_path.to_string_lossy(), "resultFilename": plain, "resultMimeType": "application/zip",
        "audioStems": true, "durationSec": dur, "model": which, "quality": quality,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stft_roundtrip() {
        let x: Vec<f32> = (0..20000).map(|i| ((i as f32) * 0.01).sin() * 0.5 + ((i as f32) * 0.37).cos() * 0.1).collect();
        let st = Stft::new(2048, 512);
        let mut spec = st.forward(&x).unwrap();
        let y = istft(&st, &mut spec, x.len()).unwrap();
        let err = x.iter().zip(&y).map(|(a, b)| (a - b).abs()).fold(0f32, f32::max);
        assert!(err < 1e-4, "err {err}");
        // MDX 口径：块长 261120 → 256 帧
        let st2 = Stft::new(7680, 1024);
        assert_eq!(st2.frames(1024 * 255), 256);
    }

    #[test]
    fn percentile_matches_numpy() {
        let mut v = vec![5.0, 1.0, 4.0, 2.0, 3.0];
        assert_eq!(percentile(&mut v, 50.0), 3.0);
        let mut v = vec![1.0, 2.0, 3.0, 4.0];
        assert!((percentile(&mut v, 50.0) - 2.5).abs() < 1e-6);
        let mut v = vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0];
        assert!((percentile(&mut v, 5.0) - 1.45).abs() < 1e-5);
    }

    #[test]
    fn denoise_reduces_noise_keeps_tone() {
        // 1kHz 正弦 + 白噪声
        let mut seed = 12345u32;
        let mut rnd = || {
            seed = seed.wrapping_mul(1664525).wrapping_add(1013904223);
            (seed >> 8) as f32 / (1u32 << 24) as f32 - 0.5
        };
        let n = 44100;
        let tone: Vec<f32> = (0..n).map(|i| (2.0 * std::f32::consts::PI * 1000.0 * i as f32 / 44100.0).sin() * 0.3).collect();
        let noisy: Vec<f32> = tone.iter().map(|t| t + rnd() * 0.05).collect();
        let out = denoise_channel(&noisy, 1.0, 5.0, 1.0, &|| Ok(())).unwrap();
        let err_before: f32 = noisy.iter().zip(&tone).map(|(a, b)| (a - b).powi(2)).sum();
        let err_after: f32 = out.iter().zip(&tone).map(|(a, b)| (a - b).powi(2)).sum();
        assert!(err_after < err_before * 0.8, "{err_after} vs {err_before}");
    }

    #[test]
    fn wav_header() {
        let w = wav_bytes(&[vec![0.0, 1.0], vec![-1.0, 0.5]]);
        assert_eq!(&w[0..4], b"RIFF");
        assert_eq!(w.len(), 44 + 8);
        assert_eq!(i16::from_le_bytes([w[46], w[47]]), -32768);
        assert_eq!(i16::from_le_bytes([w[48], w[49]]), 32767);
    }
}
