"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/quote-card-tool.tsx");


/**
 * 金句诗词卡片生成器。
 *
 * 布局选择：**模式 B（工作台 4:8）** —— 左边挑句子与样式，右边是**卡片本体（实时预览）**。
 * 这类"生成一张图"的工具，预览必须占大头：用户在调的是"看起来怎么样"，
 * 不给足预览面积就没法调。导出按钮放在预览卡上，符合"看到满意就存下来"的动作顺序。
 *
 * 关于 canvas 里的颜色：界面本体全部走主题变量；**卡片成品里的配色**属于导出内容，
 * 用固定配色方案（宣纸、墨色、青绿、暖阳、夜蓝）是刻意的 —— 那些颜色是作品的一部分，
 * 不该跟着软件主题变。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlignCenter,
  Download,
  Eraser,
  Feather,
  Image as ImageIcon,
  Quote,
  RefreshCw,
  Sparkles,
  Type,
} from "lucide-react";
import { Badge, Button, Input, Label, Select } from "@/components/ui/primitives";
import { useToolDraft } from "@/lib/use-tool-draft";
import { cn } from "@/lib/utils";

function SectionCard({
  icon,
  title,
  extra,
  children,
  className,
}: {
  icon?: React.ReactNode;
  title?: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const __locale = __useLanguage();
  return (
    <div className={cn("rounded-2xl border border-border/70 bg-card/60 p-5 shadow-sm backdrop-blur-md", className)}>
      {(title || extra) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
          <div className="flex items-center gap-2">
            {icon && (
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</span>
            )}
            {title && <span className="text-sm font-semibold text-foreground">{__ui(title)}</span>}
          </div>
          {extra}
        </div>
      )}
      {children}
    </div>
  );
}

interface Quote {
  text: string;
  source: string;
  kind: "诗词" | "金句";
}

/** 诗词与金句库（作者要求：不能只有句子，诗词也要有） */
const QUOTES: Quote[] = [
  // ── 古诗词 ──
  { text: "长风破浪会有时，直挂云帆济沧海。", source: "李白《行路难》", kind: "诗词" },
  { text: "会当凌绝顶，一览众山小。", source: "杜甫《望岳》", kind: "诗词" },
  { text: "山重水复疑无路，柳暗花明又一村。", source: "陆游《游山西村》", kind: "诗词" },
  { text: "天生我材必有用，千金散尽还复来。", source: "李白《将进酒》", kind: "诗词" },
  { text: "海内存知己，天涯若比邻。", source: "王勃《送杜少府之任蜀州》", kind: "诗词" },
  { text: "但愿人长久，千里共婵娟。", source: "苏轼《水调歌头》", kind: "诗词" },
  { text: "明月松间照，清泉石上流。", source: "王维《山居秋暝》", kind: "诗词" },
  { text: "采菊东篱下，悠然见南山。", source: "陶渊明《饮酒》", kind: "诗词" },
  { text: "千磨万击还坚劲，任尔东西南北风。", source: "郑燮《竹石》", kind: "诗词" },
  { text: "不经一番寒彻骨，怎得梅花扑鼻香。", source: "黄檗禅师《上堂开示颂》", kind: "诗词" },
  { text: "纸上得来终觉浅，绝知此事要躬行。", source: "陆游《冬夜读书示子聿》", kind: "诗词" },
  { text: "问渠那得清如许？为有源头活水来。", source: "朱熹《观书有感》", kind: "诗词" },
  { text: "莫愁前路无知己，天下谁人不识君。", source: "高适《别董大》", kind: "诗词" },
  { text: "落红不是无情物，化作春泥更护花。", source: "龚自珍《己亥杂诗》", kind: "诗词" },
  { text: "春风得意马蹄疾，一日看尽长安花。", source: "孟郊《登科后》", kind: "诗词" },
  { text: "沉舟侧畔千帆过，病树前头万木春。", source: "刘禹锡《酬乐天扬州初逢席上见赠》", kind: "诗词" },
  { text: "大鹏一日同风起，扶摇直上九万里。", source: "李白《上李邕》", kind: "诗词" },
  { text: "路漫漫其修远兮，吾将上下而求索。", source: "屈原《离骚》", kind: "诗词" },
  { text: "博观而约取，厚积而薄发。", source: "苏轼《稼说送张琥》", kind: "诗词" },
  { text: "咬定青山不放松，立根原在破岩中。", source: "郑燮《竹石》", kind: "诗词" },
  { text: "衣带渐宽终不悔，为伊消得人憔悴。", source: "柳永《蝶恋花》", kind: "诗词" },
  { text: "两情若是久长时，又岂在朝朝暮暮。", source: "秦观《鹊桥仙》", kind: "诗词" },
  { text: "人生若只如初见，何事秋风悲画扇。", source: "纳兰性德《木兰花》", kind: "诗词" },
  { text: "此情可待成追忆，只是当时已惘然。", source: "李商隐《锦瑟》", kind: "诗词" },
  { text: "小荷才露尖尖角，早有蜻蜓立上头。", source: "杨万里《小池》", kind: "诗词" },
  { text: "接天莲叶无穷碧，映日荷花别样红。", source: "杨万里《晓出净慈寺送林子方》", kind: "诗词" },
  { text: "竹外桃花三两枝，春江水暖鸭先知。", source: "苏轼《惠崇春江晚景》", kind: "诗词" },
  { text: "随风潜入夜，润物细无声。", source: "杜甫《春夜喜雨》", kind: "诗词" },
  { text: "独在异乡为异客，每逢佳节倍思亲。", source: "王维《九月九日忆山东兄弟》", kind: "诗词" },
  { text: "谁言寸草心，报得三春晖。", source: "孟郊《游子吟》", kind: "诗词" },
  { text: "不畏浮云遮望眼，自缘身在最高层。", source: "王安石《登飞来峰》", kind: "诗词" },
  { text: "江东子弟多才俊，卷土重来未可知。", source: "杜牧《题乌江亭》", kind: "诗词" },
  { text: "江山代有才人出，各领风骚数百年。", source: "赵翼《论诗》", kind: "诗词" },
  { text: "海纳百川，有容乃大；壁立千仞，无欲则刚。", source: "林则徐", kind: "诗词" },
  { text: "天行健，君子以自强不息。", source: "《周易》", kind: "诗词" },
  { text: "不积跬步，无以至千里；不积小流，无以成江海。", source: "《荀子·劝学》", kind: "诗词" },
  { text: "非淡泊无以明志，非宁静无以致远。", source: "诸葛亮《诫子书》", kind: "诗词" },
  { text: "纸上春秋短，人间岁月长。", source: "佚名", kind: "诗词" },
  { text: "愿有岁月可回首，且以深情共白头。", source: "佚名", kind: "诗词" },
  { text: "世事洞明皆学问，人情练达即文章。", source: "曹雪芹《红楼梦》", kind: "诗词" },
  // ── 现代金句 ──
  { text: "把每一件平凡的事做好，就是不平凡。", source: "励志金句", kind: "金句" },
  { text: "慢慢来，比较快。", source: "励志金句", kind: "金句" },
  { text: "种一棵树最好的时间是十年前，其次是现在。", source: "谚语", kind: "金句" },
  { text: "所有的努力，都不会白费，只是回报的时间未到。", source: "励志金句", kind: "金句" },
  { text: "你只管努力，剩下的交给时间。", source: "励志金句", kind: "金句" },
  { text: "真正的强大，是允许一切发生。", source: "励志金句", kind: "金句" },
  { text: "与其抱怨黑暗，不如点亮一盏灯。", source: "励志金句", kind: "金句" },
  { text: "把时间花在进步上，而不是证明自己上。", source: "励志金句", kind: "金句" },
  { text: "先完成，再完美。", source: "效率金句", kind: "金句" },
  { text: "情绪稳定，是一个人最好的修养。", source: "生活金句", kind: "金句" },
  { text: "允许自己偶尔停一停，才能走得更远。", source: "生活金句", kind: "金句" },
  { text: "少想一点，多做一点，焦虑就少一点。", source: "生活金句", kind: "金句" },
  { text: "把生活过成自己喜欢的样子，就是成功。", source: "生活金句", kind: "金句" },
  { text: "热爱可抵岁月漫长。", source: "生活金句", kind: "金句" },
  { text: "愿你所行皆坦途，所遇皆温柔。", source: "祝福语", kind: "金句" },
  { text: "祝你前途似海，来日方长。", source: "祝福语", kind: "金句" },
  { text: "愿每一份喜欢都能被温柔以待。", source: "祝福语", kind: "金句" },
  { text: "生日快乐，愿你年年有今日，岁岁有今朝。", source: "祝福语", kind: "金句" },
  { text: "新的一年，愿所求皆如愿，所行化坦途。", source: "祝福语", kind: "金句" },
  { text: "万事胜意，平安喜乐。", source: "祝福语", kind: "金句" },
];

const THEMES = [
  { id: "paper", name: "宣纸", bg: ["#f7f3ea", "#efe7d8"], ink: "#3a3226", sub: "#8a7a63", accent: "#b98a3c" },
  { id: "ink", name: "墨色", bg: ["#f4f4f2", "#e6e6e2"], ink: "#1f1f1f", sub: "#6b6b6b", accent: "#2f2f2f" },
  { id: "jade", name: "青绿", bg: ["#eef6f1", "#d9ece0"], ink: "#1d3b2c", sub: "#5e7d6c", accent: "#2f7a55" },
  { id: "sun", name: "暖阳", bg: ["#fff5e6", "#ffe6c7"], ink: "#4a3216", sub: "#93704a", accent: "#d9822b" },
  { id: "night", name: "夜蓝", bg: ["#1d2739", "#101724"], ink: "#eef2f8", sub: "#9fb0c8", accent: "#7fb2ff" },
];

const SIZES = [
  { id: "poster", name: "竖版海报", w: 1080, h: 1440 },
  { id: "square", name: "方形", w: 1080, h: 1080 },
  { id: "wide", name: "横版", w: 1280, h: 720 },
];

const FONT_STACKS = [
  { id: "song", name: "宋体（传统）", css: '"Songti SC", "SimSun", "Noto Serif SC", serif' },
  { id: "kai", name: "楷体（手写感）", css: '"Kaiti SC", "KaiTi", "STKaiti", serif' },
  { id: "hei", name: "黑体（现代）", css: '"Microsoft YaHei", "PingFang SC", "Hiragino Sans GB", sans-serif' },
];

export function QuoteCardTool() {
  const __locale = __useLanguage();
  const [quoteText, setQuoteText] = useToolDraft(
    "quote-card",
    "text",
    "长风破浪会有时，直挂云帆济沧海。",
  );
  const [source, setSource] = useToolDraft("quote-card", "source", "李白《行路难》");
  const [signature, setSignature] = useToolDraft("quote-card", "signature", "");
  const [themeId, setThemeId] = useToolDraft("quote-card", "theme", "paper");
  const [sizeId, setSizeId] = useToolDraft("quote-card", "size", "poster");
  const [fontId, setFontId] = useToolDraft("quote-card", "font", "song");
  const [vertical, setVertical] = useToolDraft("quote-card", "vertical", false);
  const [fontScale, setFontScale] = useToolDraft("quote-card", "fontScale", 100);
  const [filter, setFilter] = useToolDraft<"all" | "诗词" | "金句">("quote-card", "filter", "all");
  const [keyword, setKeyword] = useState("");
  const canvasRef = useRef<HTMLCanvasElement>(null);

  const theme = THEMES.find((t) => t.id === themeId) || THEMES[0];
  const size = SIZES.find((s) => s.id === sizeId) || SIZES[0];
  const font = FONT_STACKS.find((f) => f.id === fontId) || FONT_STACKS[0];

  const list = useMemo(() => {
    const kw = keyword.trim();
    return QUOTES.filter((q) => (filter === "all" || q.kind === filter) && (!kw || q.text.includes(kw) || q.source.includes(kw)));
  }, [filter, keyword, __locale]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const { w, h } = size;
    canvas.width = w;
    canvas.height = h;

    // 背景
    const grad = ctx.createLinearGradient(0, 0, w, h);
    grad.addColorStop(0, theme.bg[0]);
    grad.addColorStop(1, theme.bg[1]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // 细边框
    ctx.strokeStyle = theme.accent + "55";
    ctx.lineWidth = Math.max(2, w / 400);
    ctx.strokeRect(w * 0.045, h * 0.04, w * 0.91, h * 0.92);

    const scale = fontScale / 100;
    const isNight = theme.id === "night";

    // 引号装饰
    ctx.font = `${Math.round(w * 0.12 * scale)}px ${font.css}`;
    ctx.fillStyle = theme.accent + (isNight ? "44" : "33");
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillText("“", w * 0.09, h * 0.08);

    const text = quoteText.trim() || "（在这里写点什么）";

    if (vertical) {
      // 竖排：从右往左，每列一字
      const fontSize = Math.round(w * 0.075 * scale);
      ctx.font = `${fontSize}px ${font.css}`;
      const chars = Array.from(text).filter((c) => c !== "\n");
      const lineHeight = fontSize * 1.18;
      const perCol = Math.max(1, Math.floor((h * 0.72) / lineHeight));
      const cols: string[][] = [];
      for (let i = 0; i < chars.length; i += perCol) cols.push(chars.slice(i, i + perCol));
      const colGap = fontSize * 1.45;
      const startX = w * 0.82;
      const startY = h * 0.16;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = theme.ink;
      cols.forEach((col, ci) => {
        col.forEach((ch, ri) => {
          ctx.fillText(ch, startX - ci * colGap, startY + ri * lineHeight);
        });
      });
      // 落款
      ctx.font = `${Math.round(fontSize * 0.5)}px ${font.css}`;
      ctx.fillStyle = theme.sub;
      ctx.fillText(source || "", startX - (cols.length + 0.9) * colGap, startY + fontSize * 0.9);
      if (signature.trim()) {
        ctx.fillStyle = theme.accent;
        ctx.fillText(signature.trim(), startX - (cols.length + 0.9) * colGap, startY + fontSize * 1.8);
      }
      // 印章
      ctx.fillStyle = theme.accent;
      ctx.globalAlpha = 0.85;
      ctx.fillRect(startX - (cols.length + 1.1) * colGap - fontSize * 0.35, h - h * 0.2, fontSize * 0.7, fontSize * 0.7);
      ctx.globalAlpha = 1;
      return;
    }

    // 横排：自动换行、居中
    const fontSize = Math.round(w * (sizeId === "wide" ? 0.055 : 0.062) * scale);
    ctx.font = `${fontSize}px ${font.css}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const maxWidth = w * 0.78;
    const lines: string[] = [];
    for (const paragraph of text.split("\n")) {
      let cur = "";
      for (const ch of paragraph) {
        if (ctx.measureText(cur + ch).width > maxWidth && cur) {
          lines.push(cur);
          cur = ch;
        } else {
          cur += ch;
        }
      }
      if (cur) lines.push(cur);
    }
    const lineHeight = fontSize * 1.55;
    const centerY = h * (sizeId === "wide" ? 0.46 : 0.44);
    const startY = centerY - ((lines.length - 1) * lineHeight) / 2;
    ctx.fillStyle = theme.ink;
    lines.forEach((line, i) => {
      ctx.fillText(line, w / 2, startY + i * lineHeight);
    });

    // 分隔线
    const dividerY = startY + lines.length * lineHeight + fontSize * 0.5;
    ctx.strokeStyle = theme.accent + "66";
    ctx.lineWidth = Math.max(1.5, w / 600);
    ctx.beginPath();
    ctx.moveTo(w / 2 - w * 0.06, dividerY);
    ctx.lineTo(w / 2 + w * 0.06, dividerY);
    ctx.stroke();

    // 出处
    ctx.font = `${Math.round(fontSize * 0.5)}px ${font.css}`;
    ctx.fillStyle = theme.sub;
    ctx.fillText(source || "", w / 2, dividerY + fontSize * 0.75);
    if (signature.trim()) {
      ctx.fillStyle = theme.accent;
      ctx.font = `${Math.round(fontSize * 0.42)}px ${font.css}`;
      ctx.fillText(signature.trim(), w / 2, dividerY + fontSize * 1.5);
    }

    // 右下角小字
    ctx.textAlign = "right";
    ctx.font = `${Math.round(fontSize * 0.28)}px ${font.css}`;
    ctx.fillStyle = theme.sub + "aa";
    ctx.fillText(__ui("由 FurinaKit 制作"), w - w * 0.06, h - h * 0.06);
  }, [quoteText, source, signature, theme, size, font, vertical, fontScale, sizeId]);

  useEffect(() => {
    draw();
  }, [draw]);

  const download = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `金句卡片-${size.w}x${size.h}.png`;
      document.body.appendChild(a);
      // ★ 游离的 <a> 直接 click() 在 WebView2 里会被忽略（点了没反应）——
    //   必须挂到 DOM 上再点，点完移除（通用结果卡那边用的是页面里的真链接，所以正常）
    document.body.appendChild(a);
    document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 1000);
    setTimeout(() => a.remove(), 1000);
      a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    }, "image/png");
  };

  const randomOne = () => {
    const pool = list.length ? list : QUOTES;
    const q = pool[Math.floor(Math.random() * pool.length)];
    setQuoteText(q.text);
    setSource(q.source);
  };

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        {/* 左：选句子与样式 */}
        <div className="thin-scroll space-y-4 lg:col-span-5">
          <SectionCard
            icon={<Quote className="h-4 w-4" />}
            title={__msg("句子库（{0} 条）", list.length)}
            extra={
              <div className="flex items-center gap-1.5">
                <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={randomOne}>
                  <RefreshCw className="h-3.5 w-3.5" /> {__ui("随机一条")}</Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    setQuoteText("");
                    setSource("");
                    setSignature("");
                  }}
                >
                  <Eraser className="h-3.5 w-3.5" /> {__ui("清空")}</Button>
              </div>
            }
          >
            <div className="mb-3 flex flex-wrap gap-1.5">
              {(["all", "诗词", "金句"] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-[11.5px] font-medium transition-colors",
                    filter === f ? "bg-primary text-primary-foreground" : "bg-secondary/40 text-muted-foreground hover:bg-muted",
                  )}
                >
                  {f === "all" ? __ui("全部") : f}
                </button>
              ))}
              <Input
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                placeholder={__ui("搜句子或出处")}
                className="ml-auto h-7 w-36 text-[11.5px]"
              />
            </div>

            <div className="thin-scroll max-h-[260px] overflow-auto rounded-xl border border-border/60">
              {list.map((q) => (
                <button
                  key={q.text}
                  type="button"
                  onClick={() => {
                    setQuoteText(q.text);
                    setSource(q.source);
                  }}
                  className={cn(
                    "block w-full border-b border-border/40 px-3 py-2 text-left transition-colors last:border-0 hover:bg-muted/50",
                    quoteText === q.text && "bg-primary/[0.08]",
                  )}
                >
                  <div className="flex items-start gap-2">
                    <Badge variant="outline" className="mt-0.5 shrink-0 text-[10px]">
                      {q.kind}
                    </Badge>
                    <div className="min-w-0">
                      <div className="text-[12.5px] leading-relaxed text-foreground">{q.text}</div>
                      <div className="mt-0.5 text-[10.5px] text-muted-foreground">{q.source}</div>
                    </div>
                  </div>
                </button>
              ))}
              {list.length === 0 && <p className="px-3 py-6 text-center text-xs text-muted-foreground">{__ui("未找到匹配内容，请更换关键词")}</p>}
            </div>
          </SectionCard>

          <SectionCard icon={<Type className="h-4 w-4" />} title={__ui("内容与样式")}>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="qc-text">{__ui("正文（自己写也可以）")}</Label>
                <textarea
                  id="qc-text"
                  value={quoteText}
                  onChange={(e) => setQuoteText(e.target.value)}
                  className="thin-scroll min-h-[80px] w-full rounded-xl border border-border/60 bg-background/50 px-3 py-2 text-[12.5px] leading-relaxed text-foreground outline-none focus:border-primary"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="qc-source">{__ui("出处 / 作者")}</Label>
                  <Input id="qc-source" value={source} onChange={(e) => setSource(e.target.value)} className="text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="qc-sign">{__ui("落款（可选）")}</Label>
                  <Input id="qc-sign" value={signature} onChange={(e) => setSignature(e.target.value)} placeholder={__ui("送给谁")} className="text-xs" />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>{__ui("配色")}</Label>
                <div className="flex flex-wrap gap-1.5">
                  {THEMES.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setThemeId(t.id)}
                      className={cn(
                        "flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11.5px] transition-colors",
                        themeId === t.id ? "border-primary bg-primary/10 text-primary" : "border-border/60 text-muted-foreground hover:bg-muted",
                      )}
                    >
                      <span
                        className="h-3.5 w-3.5 rounded-sm border border-border/40"
                        style={{ background: `linear-gradient(135deg, ${t.bg[0]}, ${t.bg[1]})` }}
                      />
                      {__msg(t.name)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="qc-size">{__ui("尺寸")}</Label>
                  {/* 选项按"像素在前"写，比「竖版海报（1080×1440）」短，窄列里不会被截断 */}
                  <Select id="qc-size" value={sizeId} onChange={(e) => setSizeId(e.target.value)} className="w-full text-xs">
                    {SIZES.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.w}×{s.h}
                      </option>
                    ))}
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="qc-font">{__ui("字体")}</Label>
                  <Select id="qc-font" value={fontId} onChange={(e) => setFontId(e.target.value)} className="w-full text-xs">
                    {FONT_STACKS.map((f) => (
                      <option key={f.id} value={f.id}>
                        {__msg(f.name)}
                      </option>
                    ))}
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="qc-scale">{__ui("字号")}{fontScale}%</Label>
                  <input
                    id="qc-scale"
                    type="range"
                    min="70"
                    max="150"
                    value={fontScale}
                    onChange={(e) => setFontScale(Number(e.target.value))}
                    className="h-1.5 w-full accent-primary"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>{__ui("排版")}</Label>
                  <div className="flex gap-1.5 rounded-xl border border-border/60 bg-secondary/30 p-1">
                    {[
                      { v: false, label: "横排" },
                      { v: true, label: "竖排" },
                    ].map((o) => (
                      <button
                        key={String(o.v)}
                        type="button"
                        onClick={() => setVertical(o.v)}
                        className={cn(
                          "flex-1 rounded-lg px-2 py-1 text-[11.5px] font-medium transition-colors",
                          vertical === o.v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                        )}
                      >
                        {__ui(o.label)}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </SectionCard>
        </div>

        {/* 右：预览 */}
        <div className="thin-scroll space-y-4 lg:col-span-7">
          <SectionCard
            icon={<ImageIcon className="h-4 w-4" />}
            title={__ui("卡片预览")}
            extra={
              <Button type="button" className="gap-1.5" onClick={download}>
                <Download className="h-3.5 w-3.5" /> {__ui("导出 PNG")}</Button>
            }
          >
            <div className="flex flex-col items-center gap-3">
              <div className="overflow-hidden rounded-xl border border-border/60 shadow-sm">
                <canvas ref={canvasRef} className="block h-auto w-full max-w-[420px]" />
              </div>
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <AlignCenter className="h-3.5 w-3.5" />
                {size.w} × {size.h} {__ui("像素")}<span>·</span>
                {__msg(theme.name)}{__ui("配色")}<span>·</span>
                {__msg(font.name)}
              </div>
            </div>
          </SectionCard>

          <SectionCard icon={<Feather className="h-4 w-4" />} title={__ui("小提示")}>
            <ul className="space-y-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
              <li>{__ui("· 长句自动换行；字号滑块可整体调整，内容不会溢出画布。")}</li>
              <li>{__ui("· 「竖排」采用传统诗词的自右向左读法，字号会自动适配列数。")}</li>
              <li>{__ui("· 卡片配色属于作品内容，不随软件主题变化。")}</li>
              <li>{__ui("· 导出的 PNG 分辨率为预览的两倍，适合直接分享。")}</li>
            </ul>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
