"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/bpm-detect-tool.tsx");


import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Activity, AudioWaveform, Gauge, Music, Play, Square, Upload } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

/**
 * 节拍（BPM）检测
 *
 * 完全不依赖后端与第三方库：用 Web Audio 解码音频，自己算能量包络与自相关。
 *  1. 按 1024 采样窗（跳步 512）计算短时能量
 *  2. 对能量做一阶差分并去掉负值 → 起音包络（onset envelope）
 *  3. 对起音包络做自相关，在 60~200 BPM 范围内找峰值
 * 另外提供手动击拍（tap tempo）作为交叉验证 —— 电子音乐与现场演奏用它能更快确认。
 */
export function BpmDetectTool() {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  const { toast } = useToast();
  const [fileName, setFileName] = useState("");
  const [audioUrl,setAudioUrl]=useState("");
  useEffect(()=>()=>{if(audioUrl)URL.revokeObjectURL(audioUrl);},[audioUrl]);
  const [analyzing, setAnalyzing] = useState(false);
  const [bpm, setBpm] = useState<number | null>(null);
  const [envelope, setEnvelope] = useState<number[]>([]);
  const [duration, setDuration] = useState(0);
  const [taps, setTaps] = useState<number[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const analyze = useCallback(
    async (file: File | null | undefined) => {
      if (!file) return;
      if (!file.type.startsWith("audio/") && !file.type.startsWith("video/") && !/\.(mp3|wav|m4a|flac|ogg|aac)$/i.test(file.name)) {
        toast({ title: "请选择音频文件", description: "支持 MP3 / WAV / M4A / FLAC 等", variant: "error" });
        return;
      }
      setAnalyzing(true);
      setFileName(file.name);
      setAudioUrl(URL.createObjectURL(file));
      setBpm(null);
      setEnvelope([]);
      try {
        const buf = await file.arrayBuffer();
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new AudioCtx();
        const audio = await ctx.decodeAudioData(buf.slice(0));
        setDuration(audio.duration);

        // 多声道混合成单声道
        const ch = audio.numberOfChannels;
        const len = audio.length;
        const mono = new Float32Array(len);
        for (let c = 0; c < ch; c++) {
          const data = audio.getChannelData(c);
          for (let i = 0; i < len; i++) mono[i] += data[i] / ch;
        }
        await ctx.close();

        // 只取前 120 秒，避免长音频算太久
        const maxSamples = Math.min(len, audio.sampleRate * 120);
        const win = 1024;
        const hop = 512;
        const frames = Math.floor((maxSamples - win) / hop);
        const energy = new Float32Array(Math.max(0, frames));
        for (let f = 0; f < frames; f++) {
          let sum = 0;
          const start = f * hop;
          for (let i = 0; i < win; i += 2) {
            const v = mono[start + i];
            sum += v * v;
          }
          energy[f] = Math.sqrt(sum / (win / 2));
        }

        // 起音包络 + 去均值
        const onset = new Float32Array(frames);
        for (let f = 1; f < frames; f++) onset[f] = Math.max(0, energy[f] - energy[f - 1]);
        let mean = 0;
        for (const v of onset) mean += v;
        mean /= frames || 1;
        for (let f = 0; f < frames; f++) onset[f] = Math.max(0, onset[f] - mean);

        // 自相关找周期
        const fps = audio.sampleRate / hop; // 每秒多少帧
        const minBpm = 60, maxBpm = 200;
        const minLag = Math.floor((60 / maxBpm) * fps);
        const maxLag = Math.ceil((60 / minBpm) * fps);
        let bestLag = 0;
        let bestScore = 0;
        for (let lag = minLag; lag <= maxLag && lag < frames; lag++) {
          let score = 0;
          for (let f = 0; f + lag < frames; f++) score += onset[f] * onset[f + lag];
          score /= frames - lag;
          // 抑制 2 倍周期造成的倍频误判
          const half = Math.round(lag / 2);
          if (half >= minLag) {
            let halfScore = 0;
            for (let f = 0; f + half < frames; f++) halfScore += onset[f] * onset[f + half];
            halfScore /= frames - half;
            if (halfScore > score * 0.82) score *= 0.86;
          }
          if (score > bestScore) {
            bestScore = score;
            bestLag = lag;
          }
        }

        const detected = bestLag ? (60 / (bestLag / fps)) : 0;
        // 结果统一到 70~180 的常用区间
        let normalized = detected;
        while (normalized > 0 && normalized < 70) normalized *= 2;
        while (normalized > 180) normalized /= 2;

        setBpm(normalized > 0 ? Math.round(normalized * 10) / 10 : null);
        // 存一份用于画波形（抽样到 320 点）
        const step = Math.max(1, Math.floor(onset.length / 320));
        const slim: number[] = [];
        for (let i = 0; i < onset.length; i += step) {
          let mx = 0;
          for (let j = i; j < Math.min(i + step, onset.length); j++) mx = Math.max(mx, onset[j]);
          slim.push(mx);
        }
        setEnvelope(slim);
        if (!normalized) toast({ title: "没有检测到明显的节拍", description: "可能是纯人声、古典乐或环境音", variant: "info" });
      } catch (err) {
        toast({ title: "音频解析失败", description: err instanceof Error ? err.message : "", variant: "error" });
      } finally {
        setAnalyzing(false);
      }
    },
    [toast],
  );

  /** 手动击拍：连点几下取平均间隔 */
  const tap = () => {
    const now = performance.now();
    const next = [...taps.filter((t) => now - t < 3000), now];
    setTaps(next.length > 12 ? next.slice(-12) : next);
  };

  const tapBpm = useMemo(() => {
    if (taps.length < 2) return null;
    const gaps: number[] = [];
    for (let i = 1; i < taps.length; i++) gaps.push(taps[i] - taps[i - 1]);
    const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    return avg > 0 ? Math.round((60000 / avg) * 10) / 10 : null;
  }, [taps, __locale]);

  const maxEnv = Math.max(...envelope, 0.0001);

  return (
    <div className="flex flex-col gap-4">
      {audioUrl&&<section className="space-y-2 rounded-xl border border-border bg-card p-4"><h3 className="text-sm font-semibold">{__ui("试听 ·")}{fileName}</h3><audio key={audioUrl} controls preload="metadata" src={audioUrl} className="w-full" onError={()=>toast({title:"此音频暂不能由播放器解码",description:"可先转换为MP3或WAV后再试听",variant:"error"})}/><p className="text-xs leading-5 text-muted-foreground">{__ui("BPM表示每分钟约有多少拍，不是音量或音质评分。先播放音乐，再跟着节奏点击右侧击拍；自动分析可能识别成半速或双速，结果仅供参考。")}</p></section>}
      <input
        ref={fileRef}
        type="file"
        accept="audio/*,video/*,.mp3,.wav,.m4a,.flac,.ogg,.aac"
        className="hidden"
        onChange={(e) => analyze(e.target.files?.[0])}
      />

      <div
        onClick={() => fileRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          analyze(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          // 与其它工具的上传区统一：2 像素主题色描边 + 淡主题色底
          // （原来是 1 像素、颜色用 borderSolid 的虚线框，几乎看不见）
          "flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-primary/35 bg-primary/[0.06] py-12 transition-all",
          dragging ? "border-primary bg-primary/15 ring-4 ring-primary/20" : "hover:border-primary/60 hover:bg-primary/10",
        )}
      >
        {analyzing ? (
          <>
            <Activity size={28} className="animate-pulse" style={{ color: colors.blue }} />
            <p className="text-[13.5px]" style={{ color: colors.text }}>{__ui("正在分析节拍…")}</p>
          </>
        ) : (
          <>
            <AudioWaveform size={28} style={{ color: colors.muted }} />
            <p className="text-[13.5px] font-medium" style={{ color: colors.text }}>
              {fileName || __ui("点击选择音乐文件，或把文件拖进来")}
            </p>
            <p className="text-[11.5px]" style={{ color: colors.muted }}>{__ui("支持 MP3 / WAV / M4A / FLAC，分析过程全部在本机完成")}</p>
          </>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-2xl border p-5 lg:col-span-2" style={{ borderColor: colors.borderSolid, background: colors.card }}>
          <header className="mb-3 flex items-center gap-2">
            <Gauge size={15} />
            <h2 className="text-[14px] font-semibold" style={{ color: colors.text }}>{__ui("检测结果")}</h2>
            {duration > 0 && (
              <span className="text-[11.5px]" style={{ color: colors.muted }}>
                {__ui("· 时长")}{Math.floor(duration / 60)}:{String(Math.floor(duration % 60)).padStart(2, "0")}
                {duration > 120 && __ui("（仅分析前 2 分钟）")}
              </span>
            )}
          </header>

          {bpm ? (
            <>
              <div className="flex flex-wrap items-end gap-5">
                <div>
                  <p className="text-[11.5px]" style={{ color: colors.muted }}>{__ui("节拍速度")}</p>
                  <p className="flex items-baseline gap-1.5">
                    <span className="text-[40px] font-bold leading-none" style={{ color: colors.blue }}>{bpm.toFixed(1)}</span>
                    <span className="text-[13px]" style={{ color: colors.muted }}>BPM</span>
                  </p>
                </div>
                <div className="flex flex-col gap-1 text-[12px]" style={{ color: colors.muted }}>
                  <span>{__ui("每拍时长")}{(60000 / bpm).toFixed(0)} {__ui("毫秒")}</span>
                  <span>{__ui("每秒约")}{(bpm / 60).toFixed(2)} {__ui("拍")}</span>
                  <span>
                    {__ui("常见归类：")}{bpm < 60 ? __ui("慢板") : bpm < 76 ? __ui("行板") : bpm < 120 ? __ui("中速") : bpm < 156 ? __ui("快板") : __ui("很快")}
                  </span>
                </div>
              </div>

              {envelope.length > 0 && (
                <div className="mt-5">
                  <p className="mb-2 text-[11.5px]" style={{ color: colors.muted }}>{__ui("起音强度分布（声音变化的峰值，不一定是鼓点）")}</p>
                  <div className="flex h-24 items-end gap-[1px]">
                    {envelope.map((v, i) => {
                      const beatMs = 60000 / bpm;
                      const idxSec = (i / envelope.length) * Math.min(duration, 120);
                      const phase = (idxSec * 1000) % beatMs;
                      const isBeat = phase < beatMs * 0.12;
                      return (
                        <div
                          key={i}
                          className="flex-1 rounded-t-sm"
                          style={{
                            height: `${Math.max(2, (v / maxEnv) * 100)}%`,
                            background: isBeat ? colors.blue : colors.mutedDark,
                            opacity: isBeat ? 1 : 0.55,
                          }}
                          title={__msg("{0} 秒", idxSec.toFixed(2))}
                        />
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
            <p className="py-8 text-center text-[13px]" style={{ color: colors.muted }}>
              {fileName ? __ui("没有检测到明显节拍，可以试试下面的手动击拍") : __ui("选择音乐文件后会自动分析")}
            </p>
          )}
        </section>

        <section className="rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
          <header className="mb-3 flex items-center gap-2">
            <Music size={15} />
            <h2 className="text-[14px] font-semibold" style={{ color: colors.text }}>{__ui("手动击拍")}</h2>
          </header>
          <button
            onClick={tap}
            className="flex h-28 w-full flex-col items-center justify-center gap-1.5 rounded-2xl border-2 transition-all active:scale-[0.98]"
            style={{ borderColor: "hsl(var(--primary))", background: colors.active, color: colors.text }}
          >
            <Play size={20} />
            <span className="text-[13.5px] font-medium">{__ui("跟着播放的音乐击拍")}</span>
            <span className="text-[11px]" style={{ color: colors.muted }}>{__ui("连点 4 下以上更准")}</span>
          </button>
          <div className="mt-3 flex items-center justify-between">
            <div>
              <p className="text-[11.5px]" style={{ color: colors.muted }}>{__ui("击拍结果")}</p>
              <p className="text-[24px] font-semibold leading-none" style={{ color: colors.text }}>
                {tapBpm ? tapBpm.toFixed(1) : "—"}
                <span className="ml-1 text-[12px] font-normal" style={{ color: colors.muted }}>BPM</span>
              </p>
            </div>
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setTaps([])} disabled={taps.length === 0}>
              <Square size={12} /> {__ui("重来")}</Button>
          </div>
          <p className="mt-2 text-[11px]" style={{ color: colors.muted }}>{__ui("已记录")}{taps.length} {__ui("次击拍")}</p>
        </section>
      </div>

      <section className="flex items-start gap-2 rounded-2xl border p-4" style={{ borderColor: colors.borderSolid }}>
        <Upload size={14} className="mt-0.5 shrink-0" style={{ color: colors.muted }} />
        <p className="text-[11.5px] leading-relaxed" style={{ color: colors.muted }}>
          {__ui("检测原理：把音频混成单声道后计算短时能量包络与自相关，在 60~200 BPM 区间找周期性峰值，结果会统一到 70~180 的常用区间。 速度会给出可选倍数（例如 85 与 170 都合理），以你听感为准；纯人声或自由节拍的曲目建议用右侧手动击拍。")}</p>
      </section>
    </div>
  );
}
