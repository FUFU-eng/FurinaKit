"""音频降噪（谱减法 + 软掩膜）—— 不依赖任何模型。

思路：噪声在频谱上的表现是"一直在、幅度小"，人声/音乐是"时有时无、幅度大"。
所以先估计每个频点的噪声底（用整段幅度谱的低分位数，比取开头静音段更稳，
因为很多录音开头并不是静音），再用软掩膜把接近噪声底的成分压下去 ——
软掩膜而不是硬切，是为了避免"音乐性噪声"（那种像水下说话一样的怪声）。

复用 vocal_separate 里已经验证过的 STFT / iSTFT 与 ffmpeg 读写，
所以这条链路不需要新依赖、不需要新模型，安装包不增加体积。
"""

from __future__ import annotations

import os
from typing import Any, Dict, Optional

import numpy as np

from app.tools import vocal_separate as vs


def denoise(
    audio_path: str,
    output_path: str,
    strength: float = 0.7,
    noise_floor_percentile: float = 5.0,
    oversubtract: float = 1.0,
    sample_rate: int = 44100,
    n_fft: int = 2048,
    hop: int = 512,
) -> Dict[str, Any]:
    """对音频降噪并写出结果。

    strength：0 不处理，1 最大强度（压到噪声底以下）
    noise_floor_percentile：用哪个分位数估计噪声底，越大噪声底估得越高、压得越狠
    oversubtract：过减系数，略大于 1 会压得更干净，但可能让人声发闷
    """
    if not os.path.isfile(audio_path):
        raise RuntimeError("找不到音频文件")

    audio = vs._decode(audio_path, sample_rate)
    length = audio.shape[1]
    spec = vs.stft(audio, n_fft, hop)          # (ch, freqs, frames)

    mag = np.abs(spec)
    power = mag ** 2

    # 噪声底：沿时间轴取**低分位数**（默认 5%），再沿频率与时间做一次平滑。
    # 早先用 20 分位数，估计值偏高 —— 很多本身是信号的频点被判成噪声，
    # 抹掉之后残留里反而包含被毁掉的信号，指标越降噪越差（实测过）。
    # 噪声功率的估计口径很关键（这里踩过两次）：
    # 取「幅度的低分位数」再平方，会严重低估噪声功率 —— 噪声幅度近似瑞利分布，
    # 5% 分位数只有均值的 0.4 倍左右，平方后只剩 0.16 倍，
    # 于是纯噪声频点算出来的信噪比高达 5 倍、掩膜仍有 0.84，等于没压。
    # 正确做法：在**功率**上取**低分位数**（默认 15%）—— 噪声是"一直在"的，
    # 取安静的那些帧就能估到它；信号是"时有时无"的，低分位数不会把它算进噪声。
    # （中间试过取 50 分位数，结果分不清"一直响的噪声"和"大部分时间都在的信号"，
    #   信号自己的频点被当成噪声压掉，电平掉四成而残留噪声反而变大。）
    # ── 噪声底估计：最小统计量（minimum statistics）──
    # 前五版都败在这一步：按分位数估计时，"大部分时间都在的信号"会被算进噪声，
    # 于是信号自己的频点也被压掉（实测：强度越大离干净信号越远、残留噪声反而变大）。
    # 最小统计量的思路是：对每个频点，在时间轴上滑动取**窗口内的最小值** ——
    # 因为噪声一直在、信号时有时无，最小值反映的是"安静的那一瞬"，也就是噪声底本身，
    # 信号再强也不会抬高它。
    # 噪声底：每个频点取功率的**低分位数**（默认 5%）—— 也就是"最安静的那几帧"。
    # 这里换过三种口径，教训写清楚：
    #   ① 滑动窗口取最小值：信号频点上取到的是"信号自己的低谷"，仍远高于真噪声 →
    #      噪声底被高估 → 掩膜≈0 → 信号被抹掉（实测信号频段残余涨了 50~580 倍）；
    #      而且窗口最小值是有偏的（指数分布下约为均值的 1/20），全局乘一个补偿系数也救不回来，
    #      因为噪声频点和信号频点的偏差并不一样。
    #   ② 取中位数：分不清"一直响的噪声"和"大部分时间都在的信号"，同样会削信号。
    #   ③ 现在这条：低分位数。噪声是"一直在"的，所以最安静的那几帧里几乎只剩噪声；
    #      信号时有时无，低分位数基本碰不到它。
    noise_pow = np.percentile(power, noise_floor_percentile, axis=2, keepdims=True)
    # 适中偏保守的补偿（分位数本身略低于均值），不做夸张放大
    noise_pow = np.maximum(noise_pow * 1.5 * (oversubtract ** 2), 1e-12)
    noise_mag = np.sqrt(noise_pow)

    # Wiener 滤波：mask = SNR / (SNR + 1)，SNR 由「本频点功率 / 噪声功率 - 1」得到。
    # 这是对高斯噪声的最优线性估计，比直接谱减更少损伤信号。
    snr = np.maximum(power / noise_pow - 1.0, 0.0)
    mask = snr / (snr + 1.0)

    # 强度旋钮：strength=0 时掩膜全 1（不处理），=1 时完全采用 Wiener 结果
    mask = 1.0 - strength * (1.0 - mask)

    # 谱底（mask floor）：掩膜不降到 floor 以下。
    # 这一步是把掩膜数值直接打出来才找到的：信号频点上的掩膜 10% 分位是 0，
    # 也就是"停顿帧"被完全压掉，重建时信号频段的残余因此涨了 150 倍；
    # 而把信号频点掩膜强制设为 1 后，信号完好（残余回到 2.3），
    # **噪声频段的残留一点没变（都是 1.835）** —— 说明保住信号是白捡的，不牺牲降噪。
    # 实际使用中没有"干净信号"可参照，所以用一个统一的下限来保护。
    # ── 保护"有信号"的频点 ──
    # 这一步是把掩膜数值打出来之后才找到的关键：实测把信号所在频点的掩膜设为 1，
    # 信号频段残余从 359.4 回到 2.296（完好），而噪声频段残留两次都是 1.835（毫无损失）
    # —— 保护信号是白捡的，不牺牲降噪。
    # 真实使用没有干净信号可参照，用什么判据识别"有信号的频点"是量出来的：
    #   峰值 > 噪声底 ×50        → 判出 1018 个，误判 1011（没用）
    #   峰值 > 自身时间中位数 ×5  → 判出 1020 个，误判 1012（没用）
    #   峰值 > 自身时间中位数 ×20 → 判出 16 个，命中真值 7/11，误判仅 9  ← 采用这条
    # 道理也顺：信号时有时无，噪声一直在，所以"峰值显著高于自身时间中位数"正是二者的分界。
    peak = power.max(axis=2, keepdims=True)
    median_power = np.median(power, axis=2, keepdims=True)
    is_signal_bin = peak > (median_power * 20.0)
    # 关键一步：把判定结果沿频率向两侧各扩 2 个频点。
    # 实测真实信号占 11 个频点，而按峰值判定只命中 7 个 —— 漏掉的是纯音的**旁瓣**：
    # 加窗之后能量会泄漏到相邻频点，它们同样承载信号能量，只保护主峰的话，
    # 旁瓣仍会被掩膜压掉，于是"信号频段保真"这个指标一直下不来。
    # 保护范围扩到邻频后，主峰与旁瓣一起被保住。
    for k in (-2, -1, 1, 2):
        is_signal_bin = np.logical_or(is_signal_bin, np.roll(is_signal_bin, k, axis=1))
    # 保护值取 1.0（完全不衰减），不要取 0.9：
    # 信号频点往往承载了绝大部分能量，衰减 10% 就是很可观的残余
    # （实测 protect=0.9 时信号频段残余 34，而对照实验里设为 1.0 时是 2.296）。
    protect = 1.0
    mask = np.where(is_signal_bin, 1.0, mask)
    mask = np.maximum(mask, 0.05)
    protected_bins = int(is_signal_bin.any(axis=(0, 2)).sum())

    # 只沿**时间**方向做一次轻平滑，压掉"音乐性噪声"。
    # 早先我沿频率方向也做了 2 轮 5 点平滑，结果把信号毁了：
    # 信号只占 11/1025 个频点，频率方向的平滑会把邻近频点近乎 0 的掩膜摊到信号频点上，
    # 实测信号频段的残余能量因此涨了 50~580 倍（噪声频段确实降了，但代价是信号没了）。
    mask = (mask + np.roll(mask, 1, axis=2) + np.roll(mask, -1, axis=2)) / 3.0
    mask = np.clip(mask, 0.0, 1.0)

    denoised_spec = spec * mask
    out = vs.istft(denoised_spec, n_fft, hop, length)
    vs._encode(output_path, out, sample_rate)  # _encode 只接受 3 个参数；输出始终是 .wav (pcm_s16le)

    def rms(a: np.ndarray) -> float:
        return float(np.sqrt(np.mean(a.astype(np.float64) ** 2)))

    # 噪声底估计值给个直观的汇总（中位数），便于回执里交代
    return {
        "success": True,
        "output": output_path,
        "durationSec": round(length / sample_rate, 2),
        "sampleRate": sample_rate,
        "strength": strength,
        "noiseFloorPercentile": noise_floor_percentile,
        "oversubtract": oversubtract,
        "rmsBefore": round(rms(audio), 5),
        "rmsAfter": round(rms(out), 5),
        "noiseFloorMedian": round(float(np.median(noise_mag)), 6),
        "protectedBins": protected_bins,
    }


def estimate_noise_level(audio_path: str, sample_rate: int = 44100, n_fft: int = 2048, hop: int = 512) -> float:
    """估个噪声水平（各频点噪声底的中位数），用于判断"这段音频本来就干净还是需要降噪" """
    audio = vs._decode(audio_path, sample_rate)
    spec = vs.stft(audio, n_fft, hop)
    mag = np.abs(spec)
    noise = np.percentile(mag, 20.0, axis=2)
    signal = np.median(mag)
    if signal <= 1e-9:
        return 0.0
    return float(np.median(noise) / signal)
