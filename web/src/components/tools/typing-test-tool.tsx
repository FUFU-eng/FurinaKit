import { localeTag as __localeTag } from "@/lib/language";
"use client";
import { createUiText as __createUiText, useLanguage as __useLanguage, uiCount as __count } from "@/lib/language";
const __ui = __createUiText("components/tools/typing-test-tool.tsx");


import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, RotateCcw, Timer, Trophy, Zap } from "lucide-react";
import { Button, Select } from "@/components/ui/primitives";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

/** 打字测试语料：中文用常用句，英文用常见词，短句组合避免生僻字影响成绩 */
const ZH_SENTENCES = [
  "生活不是等待暴风雨过去，而是学会在雨中跳舞。",
  "把简单的事情做好就是不简单，把平凡的事情做对就是不平凡。",
  "真正的自由不是想做什么就做什么，而是不想做什么就可以不做。",
  "每一次努力都不会白费，只是结果不一定马上出现。",
  "与其担心未来，不如现在就开始动手做一点改变。",
  "山不在高，有仙则名；水不在深，有龙则灵。",
  "读万卷书不如行万里路，行万里路不如阅人无数。",
  "所有的伟大都源于一个勇敢的开始。",
  "时间是最公平的裁判，它给每个人的一天都是二十四小时。",
  "慢慢来，比较快；稳稳走，才走得远。",
];

const EN_WORDS = "the quick brown fox jumps over lazy dog time work people world life hand part place case week company system program question during play run move live believe hold bring happen write provide sit stand lose pay meet include continue set learn change lead understand watch follow stop create speak read allow add spend grow open walk win offer remember love consider appear buy wait serve die send expect build stay fall cut reach kill remain".split(" ");

function randomZh(count: number) {
  const out: string[] = [];
  while (out.join("").length < count) out.push(ZH_SENTENCES[Math.floor(Math.random() * ZH_SENTENCES.length)]);
  return out.join("");
}

function randomEn(count: number) {
  const out: string[] = [];
  while (out.join(" ").length < count) out.push(EN_WORDS[Math.floor(Math.random() * EN_WORDS.length)]);
  return out.join(" ");
}

export function TypingTestTool() {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  const [lang, setLang] = useState<"zh" | "en">("zh");
  const [duration, setDuration] = useState(60);
  const [target, setTarget] = useState("");
  const [typed, setTyped] = useState("");
  const [started, setStarted] = useState(false);
  const [finished, setFinished] = useState(false);
  const [timeLeft, setTimeLeft] = useState(60);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const historyRef = useRef<{ wpm: number; accuracy: number; at: string }[]>([]);
  const [history, setHistory] = useState<{ wpm: number; accuracy: number; at: string }[]>([]);

  const genText = useCallback(
    (l: "zh" | "en" = lang) => {
      const text = l === "zh" ? randomZh(180) : randomEn(220);
      setTarget(text);
      setTyped("");
      setStarted(false);
      setFinished(false);
      setTimeLeft(duration);
      setTimeout(() => inputRef.current?.focus(), 60);
    },
    [lang, duration],
  );

  useEffect(() => {
    genText();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lang]);

  // 计时器：第一次输入才开始，中途不暂停
  useEffect(() => {
    if (!started || finished) return;
    const timer = setInterval(() => {
      setTimeLeft((t) => {
        if (t <= 1) {
          setFinished(true);
          setStarted(false);
          return 0;
        }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [started, finished]);

  const stats = useMemo(() => {
    const elapsed = duration - timeLeft || 1;
    let correct = 0;
    let wrong = 0;
    for (let i = 0; i < typed.length; i++) {
      if (typed[i] === target[i]) correct++;
      else wrong++;
    }
    const total = correct + wrong || 1;
    const accuracy = (correct / total) * 100;
    // 中文按「字/分钟」，英文按「词/分钟」
    const units = lang === "zh" ? correct : typed.trim().split(/\s+/).filter(Boolean).length;
    const perMinute = started || finished ? (units / elapsed) * 60 : 0;
    const progress = target.length ? Math.min(100, (typed.length / target.length) * 100) : 0;
    return { correct, wrong, accuracy, perMinute: Math.round(perMinute), progress };
  }, [typed, target, timeLeft, duration, started, finished, lang, __locale]);

  // 结束或打完整段时记录一次成绩
  useEffect(() => {
    if (!finished) return;
    const entry = { wpm: stats.perMinute, accuracy: Math.round(stats.accuracy), at: new Date().toLocaleTimeString(__localeTag()) };
    historyRef.current = [entry, ...historyRef.current].slice(0, 8);
    setHistory([...historyRef.current]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  const handleInput = (value: string) => {
    if (finished) return;
    if (!started && value.length > 0) setStarted(true);
    setTyped(value);
    if (value.length >= target.length && target.length > 0) {
      setFinished(true);
      setStarted(false);
    }
  };

  const best = history.length ? Math.max(...history.map((h) => h.wpm)) : 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={lang} onChange={(e) => setLang(e.target.value as "zh" | "en")} className="w-40">
          <option value="zh">{__ui("中文（字/分钟）")}</option>
          <option value="en">{__ui("英文（词/分钟）")}</option>
        </Select>
        <Select
          value={String(duration)}
          onChange={(e) => {
            const d = Number(e.target.value);
            setDuration(d);
            setTimeLeft(d);
            setStarted(false);
            setFinished(false);
            setTyped("");
          }}
          className="w-32"
        >
          <option value="30">{__ui("30 秒")}</option>
          <option value="60">{__ui("60 秒")}</option>
          <option value="120">{__ui("120 秒")}</option>
          <option value="180">{__ui("180 秒")}</option>
        </Select>
        <Button variant="outline" className="gap-1.5" onClick={() => genText()}>
          <RotateCcw size={14} /> {__ui("换一段")}</Button>
        <div className="flex-1" />
        <div className="flex items-center gap-4 text-[12.5px]" style={{ color: colors.muted }}>
          <span className="flex items-center gap-1.5">
            <Timer size={13} /> {__count(timeLeft, "秒")} </span>
          <span className="flex items-center gap-1.5">
            <Zap size={13} /> {stats.perMinute} {lang === "zh" ? __ui("字/分") : __ui("词/分")}
          </span>
          <span style={{ color: stats.accuracy >= 95 ? colors.green : stats.accuracy >= 85 ? colors.gold : colors.red }}>
            {__ui("正确率")}{stats.accuracy.toFixed(0)}%
          </span>
        </div>
      </div>

      <section className="rounded-2xl border p-6" style={{ borderColor: colors.borderSolid, background: colors.card }}>
        <p className="select-none text-[19px] leading-[2] tracking-wide" style={{ fontFamily: lang === "zh" ? undefined : "ui-monospace, monospace" }}>
          {target.split("").map((ch, i) => {
            const state = i < typed.length ? (typed[i] === ch ? "ok" : "bad") : i === typed.length ? "cur" : "todo";
            return (
              <span
                key={i}
                style={{
                  color:
                    state === "ok" ? colors.green : state === "bad" ? colors.red : state === "cur" ? colors.text : colors.muted,
                  background: state === "bad" ? `${colors.red}22` : state === "cur" ? colors.active : "transparent",
                  borderRadius: state === "cur" ? 3 : 0,
                  textDecoration: state === "bad" ? "underline" : "none",
                }}
              >
                {ch}
              </span>
            );
          })}
        </p>

        <textarea
          ref={inputRef}
          value={typed}
          onChange={(e) => handleInput(e.target.value)}
          disabled={finished}
          placeholder={started ? "" : __ui("在这里开始输入，计时会自动开始…")}
          className="mt-5 h-28 w-full resize-none rounded-xl border p-4 text-[15px] leading-relaxed focus:outline-none"
          style={{ borderColor: colors.borderSolid, background: colors.bg, color: colors.text }}
        />

        <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full" style={{ background: colors.btnHover }}>
          <div className="h-full rounded-full transition-all" style={{ width: `${stats.progress}%`, background: colors.blue }} />
        </div>

        {(started || finished) && (
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            {[
              { label: lang === "zh" ? "速度（字/分）" : "速度（词/分）", value: stats.perMinute, tone: colors.blue },
              { label: "正确率", value: `${stats.accuracy.toFixed(0)}%`, tone: stats.accuracy >= 95 ? colors.green : colors.gold },
              { label: "正确字符", value: stats.correct, tone: colors.green },
              { label: "错误字符", value: stats.wrong, tone: stats.wrong > 0 ? colors.red : colors.muted },
            ].map((x) => (
              <div key={x.label} className="rounded-xl border px-4 py-3" style={{ borderColor: colors.borderSolid, background: colors.bg }}>
                <p className="text-[11.5px]" style={{ color: colors.muted }}>{__ui(x.label)}</p>
                <p className="mt-1 text-[20px] font-semibold leading-none" style={{ color: x.tone }}>{x.value}</p>
              </div>
            ))}
          </div>
        )}

        {finished && (
          <div className="mt-4 flex items-center gap-2 rounded-xl border p-3.5" style={{ borderColor: colors.borderSolid }}>
            <Trophy size={15} style={{ color: colors.gold }} />
            <p className="text-[13px]" style={{ color: colors.text }}>
              {__ui("本轮成绩：")}{stats.perMinute} {lang === "zh" ? __ui("字/分") : __ui("词/分")}{__ui("，正确率")}{stats.accuracy.toFixed(0)}%
              {stats.perMinute >= best && history.length > 1 ? __ui(" —— 刷新了本次最好成绩！") : ""}
            </p>
            <div className="flex-1" />
            <Button size="sm" variant="outline" onClick={() => genText()}>{__ui("再测一次")}</Button>
          </div>
        )}
      </section>

      {history.length > 0 && (
        <section className="rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
          <header className="mb-3 flex items-center gap-2">
            <Keyboard size={15} />
            <h2 className="text-[14px] font-semibold" style={{ color: colors.text }}>{__ui("本次测试记录")}</h2>
            <span className="text-[11.5px]" style={{ color: colors.muted }}>{__ui("最多保留最近 8 次")}</span>
          </header>
          <div className="flex flex-wrap gap-2">
            {history.map((h, i) => (
              <div
                key={i}
                className={cn("rounded-xl border px-3.5 py-2 text-[12.5px]")}
                style={{
                  borderColor: h.wpm === best ? "hsl(var(--primary))" : colors.borderSolid,
                  background: h.wpm === best ? colors.active : "transparent",
                  color: colors.text,
                }}
              >
                <span className="font-semibold">{h.wpm}</span>
                <span style={{ color: colors.muted }}> {lang === "zh" ? __ui("字/分") : __ui("词/分")} · {h.accuracy}% · {h.at}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="rounded-2xl border p-4" style={{ borderColor: colors.borderSolid }}>
        <p className="text-[11.5px] leading-relaxed" style={{ color: colors.muted }}>
          {__ui("速度按正确字符数计算（打错的不计入），英文按空格分词。一般办公场景 40~60 字/分、90% 以上正确率即可满足日常使用；专业录入通常需要 100 字/分以上。")}</p>
      </section>
    </div>
  );
}
