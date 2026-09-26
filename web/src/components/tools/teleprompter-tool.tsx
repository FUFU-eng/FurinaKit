"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/teleprompter-tool.tsx");


import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown, ChevronUp, FlipHorizontal, Focus, Maximize2, Mic, MicOff, Minimize2,
  Pause, Play, RotateCcw, Settings2, Timer, Type,
} from "lucide-react";
import { Button, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useTheme } from "@/components/theme-provider";
import { useToolDraft } from "@/lib/use-tool-draft";
import { cn } from "@/lib/utils";

const SAMPLE = `大家好，欢迎来到本期视频。

今天我们聊三个话题：第一，这个工具能解决什么问题；第二，它和同类软件相比好在哪里；第三，怎么上手最快。

先说第一点。很多人在处理日常文件时，最烦的其实不是操作有多难，而是工具太散——图片要开一个软件，PDF 要开另一个，视频又得换一个。

我们要做的，就是把这些常用的小工具收拢到一个地方。

第二点，速度和体积。同类工具动不动一两个 G，我们这边装完不到一个 G，启动只要几秒。

第三点，上手成本。打开就是全部工具，左边分类，上面搜索，按 Ctrl 加空格直接找。

如果你觉得有用，记得点个关注，我们下期见。`;

export function TeleprompterTool() {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  const { toast } = useToast();
  const [script, setScript] = useToolDraft("teleprompter", "script", SAMPLE);
  const [speed, setSpeed] = useToolDraft("teleprompter", "speed", "55"); // 像素/秒
  const [fontSize, setFontSize] = useToolDraft("teleprompter", "fontSize", "46");
  const [lineHeight, setLineHeight] = useToolDraft("teleprompter", "lineHeight", "1.7");
  const [mirror, setMirror] = useState(false);
  const [focus, setFocus] = useState(true);
  const [fontWeight, setFontWeight] = useToolDraft("teleprompter", "fontWeight", "600");
  const [playing, setPlaying] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const [reading, setReading] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [progress, setProgress] = useState(0);

  /* ── 语音跟随：录一小段 → 本地识别 → 找到读到哪一句 → 自动滚过去 ── */
  const [following, setFollowing] = useState(false);
  const [followStatus, setFollowStatus] = useState("");
  const [heard, setHeard] = useState("");
  const [focusLine, setFocusLine] = useState(-1);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const bufferRef = useRef<Float32Array[]>([]);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const busyRef = useRef(false);
  const viewRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<HTMLElement>(null);
  /** 是否拿到了系统级全屏（true 时浏览器会把整块舞台铺满屏幕，含隐藏任务栏） */
  const [nativeFullscreen, setNativeFullscreen] = useState(false);
  const rafRef = useRef<number | null>(null);
  const lastRef = useRef<number>(0);
  const playingRef = useRef(false);

  // 朗读模式：文字大幅放大、只留中间一行，适合对着镜头读
  const effectiveFont = reading ? Math.round(Number(fontSize) * 1.35) : Number(fontSize);

  const lines = useMemo(
    () => script.split("\n").map((l) => l.trim()).filter(Boolean),
    [script, __locale],
  );
  const totalSeconds = useMemo(() => {
    const px = viewRef.current?.scrollHeight ?? 0;
    return px > 0 && Number(speed) > 0 ? Math.round(px / Number(speed)) : 0;
  }, [speed, script, __locale]);

  /* ── 自动滚动：用 requestAnimationFrame 保证不同机器上速度一致 ── */
  const step = useCallback(
    (now: number) => {
      const el = viewRef.current;
      if (!el || !playingRef.current) return;
      const dt = lastRef.current ? (now - lastRef.current) / 1000 : 0;
      lastRef.current = now;
      el.scrollTop += Number(speed) * dt;
      const max = el.scrollHeight - el.clientHeight;
      setProgress(max > 0 ? Math.min(100, (el.scrollTop / max) * 100) : 0);
      if (el.scrollTop >= max - 1) {
        playingRef.current = false;
        setPlaying(false);
        return;
      }
      rafRef.current = requestAnimationFrame(step);
    },
    [speed],
  );

  const play = useCallback(() => {
    playingRef.current = true;
    lastRef.current = 0;
    setPlaying(true);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(step);
  }, [step]);

  const pause = useCallback(() => {
    playingRef.current = false;
    setPlaying(false);
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  const startWithCountdown = useCallback(() => {
    if (countdown > 0) return;
    setCountdown(3);
    const timer = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(timer);
          play();
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  }, [countdown, play]);

  const reset = useCallback(() => {
    pause();
    const el = viewRef.current;
    if (el) el.scrollTop = 0;
    setProgress(0);
  }, [pause]);

  /* ────────────── 语音跟随的实现 ────────────── */

  /** 把录到的浮点采样编码成 16kHz 单声道 16bit WAV（whisper 认这个格式） */
  const encodeWav = (chunks: Float32Array[], sampleRate: number): Blob => {
    const total = chunks.reduce((n, c) => n + c.length, 0);
    const merged = new Float32Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.length;
    }
    const target = 16000;
    const ratio = sampleRate / target;
    const outLen = Math.max(1, Math.floor(merged.length / ratio));
    const pcm = new Int16Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const v = merged[Math.floor(i * ratio)] ?? 0;
      pcm[i] = Math.max(-1, Math.min(1, v)) * 0x7fff;
    }
    const buffer = new ArrayBuffer(44 + pcm.length * 2);
    const view = new DataView(buffer);
    const writeStr = (o: number, str: string) => {
      for (let i = 0; i < str.length; i++) view.setUint8(o + i, str.charCodeAt(i));
    };
    writeStr(0, "RIFF");
    view.setUint32(4, 36 + pcm.length * 2, true);
    writeStr(8, "WAVE");
    writeStr(12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, target, true);
    view.setUint32(28, target * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeStr(36, "data");
    view.setUint32(40, pcm.length * 2, true);
    new Int16Array(buffer, 44).set(pcm);
    return new Blob([buffer], { type: "audio/wav" });
  };

  /** 相似度：识别文本与某一句有多少重合的二字组合 */
  const similarity = (a: string, b: string) => {
    const clean = (t: string) => t.replace(/[\s，。、！？：；「」『』（）《》,.!?:;'"()\[\]]/g, "");
    const A = clean(a);
    const B = clean(b);
    if (!A || !B) return 0;
    const grams = new Set<string>();
    for (let i = 0; i < B.length - 1; i++) grams.add(B.slice(i, i + 2));
    if (grams.size === 0) return A.includes(B) ? 1 : 0;
    let hit = 0;
    const seen = new Set<string>();
    for (let i = 0; i < A.length - 1; i++) {
      const g = A.slice(i, i + 2);
      if (grams.has(g) && !seen.has(g)) {
        seen.add(g);
        hit++;
      }
    }
    return hit / grams.size;
  };

  /** 根据识别结果把对应句子滚到聚焦线 */
  const seekToText = useCallback(
    (text: string) => {
      const el = viewRef.current;
      if (!el || lines.length === 0 || !text.trim()) return;
      let best = -1;
      let bestScore = 0;
      lines.forEach((line, i) => {
        const score = similarity(text, line);
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      });
      if (best < 0 || bestScore < 0.45) return;
      setFocusLine(best);
      const nodes = el.querySelectorAll("p");
      const node = nodes[best] as HTMLElement | undefined;
      if (node) {
        const target = node.offsetTop - el.clientHeight * 0.41;
        if (Math.abs(el.scrollTop - target) > 4) el.scrollTop = Math.max(0, target);
      }
    },
    [lines],
  );

  /** 开/关语音跟随 */
  const toggleFollow = useCallback(async () => {
    if (following) {
      setFollowing(false);
      setFollowStatus("");
      if (timerRef.current) clearInterval(timerRef.current);
      processorRef.current?.disconnect();
      streamRef.current?.getTracks().forEach((t) => t.stop());
      void audioCtxRef.current?.close();
      audioCtxRef.current = null;
      return;
    }

    try {
      const res = await fetch("/api/whisper/models", { cache: "no-store" });
      const data = await res.json();
      const downloaded = (data.models || []).filter((m: { downloaded: boolean }) => m.downloaded);
      if (!data.ready || downloaded.length === 0) {
        toast({
          title: "语音跟随需要本地语音模型",
          description: "请先到「音频转文字」工具里下载一个语音模型，再回来开启跟随",
          variant: "error",
        });
        return;
      }
      const modelId = (downloaded[0] as { id: string }).id;

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new Ctx();
      audioCtxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      bufferRef.current = [];
      processor.onaudioprocess = (e) => {
        bufferRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(ctx.destination);
      setFollowing(true);
      setFollowStatus("正在聆听…");

      timerRef.current = setInterval(async () => {
        if (busyRef.current) return;
        const chunks = bufferRef.current;
        if (chunks.length === 0) return;
        bufferRef.current = [];
        busyRef.current = true;
        try {
          const wav = encodeWav(chunks, ctx.sampleRate);
          const fd = new FormData();
          fd.append("file", wav, "chunk.wav");
          fd.append("model", modelId);
          fd.append("language", "auto");
          fd.append("output", "txt");
          const startRes = await fetch("/api/tools/audio-transcribe", { method: "POST", body: fd });
          const startData = await startRes.json();
          if (!startRes.ok) throw new Error(startData.error || "识别失败");
          const jobId = startData.job?.id;
          for (let i = 0; i < 20; i++) {
            await new Promise((r) => setTimeout(r, 600));
            const j = await (await fetch(`/api/jobs/${jobId}`, { cache: "no-store" })).json();
            const st = j.job?.status;
            if (st === "completed") {
              const r = await fetch(`/api/whisper/result?job=${jobId}`, { cache: "no-store" });
              const rd = await r.json();
              const text = String(rd.text || "").trim();
              if (text) {
                setHeard(text.slice(-40));
                setFollowStatus("已定位");
                seekToText(text);
              }
              break;
            }
            if (st === "failed") {
              setFollowStatus("识别失败，仍在聆听…");
              break;
            }
          }
        } catch {
          setFollowStatus("识别出错，仍在聆听…");
        } finally {
          busyRef.current = false;
        }
      }, 4000);

      toast({ title: "已开启语音跟随", description: "读到哪一句，提词器就自动滚到哪一句", variant: "success" });
    } catch (err) {
      setFollowing(false);
      toast({
        title: "无法使用麦克风",
        description: err instanceof Error ? err.message : "请检查系统的麦克风权限",
        variant: "error",
      });
    }
  }, [following, toast, seekToText]);

  // 组件卸载时收尾，避免麦克风一直开着
  useEffect(() => () => {
    if (timerRef.current) clearInterval(timerRef.current);
    processorRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((t) => t.stop());
    void audioCtxRef.current?.close();
  }, []);

  /**
   * 全屏：优先要系统级全屏（整块舞台铺满屏幕、连任务栏一起盖住），
   * 浏览器拒绝或环境不支持时退回「铺满窗口」的沉浸模式，功能不受影响。
   */
  const toggleFullscreen = useCallback(async () => {
    const already = nativeFullscreen || Boolean(document.fullscreenElement);
    if (already) {
      try {
        await document.exitFullscreen();
      } catch {
        /* 忽略 */
      }
      setNativeFullscreen(false);
      setFullscreen(false);
      return;
    }
    const el = stageRef.current;
    if (el?.requestFullscreen) {
      try {
        await el.requestFullscreen({ navigationUI: "hide" });
        setNativeFullscreen(true);
        setFullscreen(true);
        return;
      } catch {
        /* 落到下面的沉浸模式 */
      }
    }
    setFullscreen((f) => !f);
  }, [nativeFullscreen]);

  // 用户按 Esc 或系统退出全屏时同步状态，避免出现「界面以为还在全屏」
  useEffect(() => {
    const onChange = () => {
      const active = document.fullscreenElement !== null;
      setNativeFullscreen(active);
      if (!active) setFullscreen(false);
      else setFullscreen(true);
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  // 键盘：空格播放/暂停，上下调速度，R 回到开头，Esc 退出全屏
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target && (target.tagName === "TEXTAREA" || target.tagName === "INPUT")) return;
      if (e.code === "Space") {
        e.preventDefault();
        playing ? pause() : startWithCountdown();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSpeed(String(Math.min(400, Number(speed) + 5)));
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSpeed(String(Math.max(5, Number(speed) - 5)));
      } else if (e.key.toLowerCase() === "r") {
        reset();
      } else if (e.key === "Escape") {
        // 系统全屏由浏览器自己响应 Esc；这里只兜底沉浸模式
        if (!document.fullscreenElement) setFullscreen(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [playing, pause, startWithCountdown, speed, setSpeed, reset]);

  useEffect(() => () => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
  }, []);

  const body = (
    <div className="flex flex-col gap-4">
      {/* 控制条 */}
      <div
        className="flex flex-wrap items-center gap-3 rounded-2xl border px-4 py-3"
        style={{ borderColor: colors.borderSolid, background: colors.card }}
      >
        <Button
          className="gap-1.5"
          onClick={() => (playing ? pause() : startWithCountdown())}
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
          {playing ? __ui("暂停") : __ui("开始")}
        </Button>
        <Button variant="outline" size="sm" className="gap-1.5" onClick={reset}>
          <RotateCcw size={13} /> {__ui("回到开头")}</Button>
        <div className="flex items-center gap-2">
          <span className="text-[12px]" style={{ color: colors.muted }}>{__ui("速度")}</span>
          <input
            type="range"
            min={5}
            max={220}
            value={speed}
            onChange={(e) => setSpeed(e.target.value)}
            className="w-32 accent-current"
          />
          <span className="w-14 text-[12px] font-mono" style={{ color: colors.text }}>{speed} px/s</span>
        </div>
        <div className="flex items-center gap-2">
          <Type size={14} style={{ color: colors.muted }} />
          <input
            type="range"
            min={20}
            max={110}
            value={fontSize}
            onChange={(e) => setFontSize(e.target.value)}
            className="w-28 accent-current"
          />
          <span className="w-10 text-[12px] font-mono" style={{ color: colors.text }}>{fontSize}px</span>
        </div>
        <div className="flex-1" />
        <button
          onClick={() => setMirror((m) => !m)}
          title={__ui("镜像（对着提词器玻璃用时打开）")}
          className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] transition-all"
          style={{
            borderColor: mirror ? "hsl(var(--primary))" : colors.borderSolid,
            background: mirror ? colors.active : "transparent",
            color: colors.text,
          }}
        >
          <FlipHorizontal size={13} /> {__ui("镜像")}</button>
        <button
          onClick={() => setFocus((f) => !f)}
          title={__ui("聚焦线：只高亮中间一行")}
          className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] transition-all"
          style={{
            borderColor: focus ? "hsl(var(--primary))" : colors.borderSolid,
            background: focus ? colors.active : "transparent",
            color: colors.text,
          }}
        >
          <Focus size={13} /> {__ui("聚焦线")}</button>
        <button
          onClick={() => setReading((r) => !r)}
          title={__ui("朗读模式：字更大，适合对着镜头")}
          className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] transition-all"
          style={{
            borderColor: reading ? "hsl(var(--primary))" : colors.borderSolid,
            background: reading ? colors.active : "transparent",
            color: colors.text,
          }}
        >
          <Mic size={13} /> {__ui("朗读模式")}</button>
        <button
          onClick={() => void toggleFollow()}
          title={__ui("开启后录音只在本机识别，用来判断你读到了哪一句")}
          className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] transition-all"
          style={{
            borderColor: following ? colors.green : colors.borderSolid,
            background: following ? `${colors.green}14` : "transparent",
            color: following ? colors.green : colors.text,
          }}
        >
          {following ? <Mic size={13} /> : <MicOff size={13} />} {__ui("语音跟随")}</button>
        <button
          onClick={() => void toggleFullscreen()}
          title={__ui("进入系统全屏（再点一次或按 Esc 退出）")}
          className="flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[12px] transition-all"
          style={{
            borderColor: fullscreen ? "hsl(var(--primary))" : colors.borderSolid,
            background: fullscreen ? colors.active : "transparent",
            color: colors.text,
          }}
        >
          {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />} {__ui("全屏")}</button>
      </div>

      <div className={cn("grid gap-4", fullscreen ? "grid-cols-1" : "lg:grid-cols-[1.6fr_1fr]")}>
        {/* 提词区 */}
        <section
          ref={stageRef}
          className={cn(
            "relative overflow-hidden border",
            fullscreen ? "fixed inset-0 z-[999] rounded-none" : "rounded-2xl",
          )}
          style={{ borderColor: colors.borderSolid, background: "#0b0b0d" }}
        >
          {countdown > 0 && (
            <div className="absolute inset-0 z-20 flex items-center justify-center" style={{ background: "rgba(0,0,0,0.72)" }}>
              <span className="text-[96px] font-bold" style={{ color: "#fff" }}>{countdown}</span>
            </div>
          )}

          {/* 聚焦线：中间一条亮带，上下淡出 */}
          {focus && (
            <>
              <div
                className="pointer-events-none absolute left-0 right-0 z-10 h-[18%]"
                style={{
                  top: "41%",
                  background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.06) 30%, rgba(255,255,255,0.06) 70%, transparent 100%)",
                  borderTop: "1px solid rgba(255,255,255,0.18)",
                  borderBottom: "1px solid rgba(255,255,255,0.18)",
                }}
              />
              <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-[38%]" style={{ background: "linear-gradient(180deg, rgba(0,0,0,0.85), transparent)" }} />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-[38%]" style={{ background: "linear-gradient(0deg, rgba(0,0,0,0.85), transparent)" }} />
            </>
          )}

          <div
            ref={viewRef}
            className={cn("thin-scroll overflow-y-auto px-10", fullscreen ? "h-screen py-[42vh]" : "h-[62vh] py-[36vh]")}
            style={{
              transform: mirror ? "scaleX(-1)" : undefined,
              color: "#f8fafc",
              fontSize: effectiveFont,
              lineHeight: Number(lineHeight),
              fontWeight: Number(fontWeight),
              letterSpacing: "0.02em",
            }}
          >
            {lines.length === 0 ? (
              <p className="text-center text-[20px]" style={{ color: "#94a3b8" }}>{__ui("在右侧粘贴你的台词")}</p>
            ) : (
              lines.map((line, i) => (
                <p
                  key={i}
                  className="mb-4 text-center transition-opacity"
                  style={{ opacity: focusLine >= 0 && i !== focusLine ? 0.45 : 1 }}
                >
                  {line}
                </p>
              ))
            )}
            <div style={{ height: "20vh" }} />
          </div>

          {/* 进度与计时 */}
          <div className="absolute bottom-0 left-0 right-0 z-20 flex items-center gap-3 px-4 py-2.5" style={{ background: "rgba(0,0,0,0.55)" }}>
            <Timer size={13} style={{ color: "#cbd5e1" }} />
            <span className="text-[11.5px] font-mono" style={{ color: "#cbd5e1" }}>
              {__ui("预计")}{Math.floor(totalSeconds / 60)}:{String(totalSeconds % 60).padStart(2, "0")}
            </span>
            <div className="h-1 flex-1 overflow-hidden rounded-full" style={{ background: "rgba(255,255,255,0.16)" }}>
              <div className="h-full rounded-full" style={{ width: `${progress}%`, background: "#f8fafc" }} />
            </div>
            <span className="text-[11.5px] font-mono" style={{ color: "#cbd5e1" }}>{progress.toFixed(0)}%</span>
          </div>
        </section>

        {/* 台词与设置 */}
        {!fullscreen && (
          <div className="flex flex-col gap-4">
            <section className="rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
              <header className="mb-3 flex items-center gap-2">
                <Settings2 size={15} />
                <h2 className="text-[14px] font-semibold" style={{ color: colors.text }}>{__ui("台词")}</h2>
                <span className="text-[11.5px]" style={{ color: colors.muted }}>
                  {lines.length} {__ui("行 ·")}{script.replace(/\s/g, "").length} {__ui("字")}</span>
              </header>
              <Textarea
                value={script}
                onChange={(e) => setScript(e.target.value)}
                rows={12}
                placeholder={__ui("把要读的内容粘贴到这里，一行一句，方便对着读")}
                className="min-h-[240px] font-normal"
              />
              <p className="mt-2 text-[11px]" style={{ color: colors.muted }}>
                {__ui("空行会被忽略；建议一行一句、每行不要太长，滚动时更容易跟上。")}</p>
            </section>

            <section className="rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
              <h2 className="mb-3 text-[14px] font-semibold" style={{ color: colors.text }}>{__ui("显示设置")}</h2>
              <div className="flex flex-col gap-3.5">
                <label className="flex items-center justify-between gap-3">
                  <span className="text-[12.5px]" style={{ color: colors.muted }}>{__ui("行距")}</span>
                  <div className="flex items-center gap-2">
                    <input type="range" min={1.2} max={2.6} step={0.1} value={lineHeight} onChange={(e) => setLineHeight(e.target.value)} className="w-28" />
                    <span className="w-8 text-[12px] font-mono" style={{ color: colors.text }}>{lineHeight}</span>
                  </div>
                </label>
                <label className="flex items-center justify-between gap-3">
                  <span className="text-[12.5px]" style={{ color: colors.muted }}>{__ui("字重")}</span>
                  <div className="flex items-center gap-2">
                    <input type="range" min={400} max={800} step={100} value={fontWeight} onChange={(e) => setFontWeight(e.target.value)} className="w-28" />
                    <span className="w-8 text-[12px] font-mono" style={{ color: colors.text }}>{fontWeight}</span>
                  </div>
                </label>
              </div>
              <div className="mt-4 flex items-center gap-2">
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => {
                  const el = viewRef.current;
                  if (el) el.scrollTop = Math.max(0, el.scrollTop - el.clientHeight * 0.5);
                }}>
                  <ChevronUp size={13} /> {__ui("上翻半屏")}</Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => {
                  const el = viewRef.current;
                  if (el) el.scrollTop += el.clientHeight * 0.5;
                }}>
                  <ChevronDown size={13} /> {__ui("下翻半屏")}</Button>
              </div>
            </section>

            {following && (
              <section className="flex flex-wrap items-center gap-2 rounded-2xl border p-3.5" style={{ borderColor: colors.green }}>
                <Mic size={14} style={{ color: colors.green }} />
                <span className="text-[12.5px]" style={{ color: colors.text }}>{__msg(followStatus)}</span>
                {heard && (
                  <span className="min-w-0 flex-1 truncate text-[11.5px]" style={{ color: colors.muted }}>
                    {__ui("听到：")}{heard}
                  </span>
                )}
                {focusLine >= 0 && (
                  <span className="text-[11.5px]" style={{ color: colors.green }}>{__ui("当前第")}{focusLine + 1} {__ui("句")}</span>
                )}
              </section>
            )}

            <section className="rounded-2xl border p-4" style={{ borderColor: colors.borderSolid }}>
              <p className="text-[11.5px] leading-relaxed" style={{ color: colors.muted }}>
                {__ui("快捷键：空格 播放/暂停 · ↑↓ 调整速度 · R 回到开头 · Esc 退出全屏。 对着提词器玻璃使用时打开「镜像」；只想要中间一行清晰、上下淡出就打开「聚焦线」。")}</p>
            </section>
          </div>
        )}
      </div>
    </div>
  );

  return body;
}
