"use client";

import React, { useState, useMemo } from "react";
import {
  Pilcrow,
  Copy,
  Check,
  Download,
  RefreshCw,
  Sparkles,
  FileText,
  Sliders,
  Code,
  Languages,
} from "lucide-react";
import { Button, Input, Select, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { tr, useLanguage } from "@/lib/language";
import { cn } from "@/lib/utils";

const LATIN_WORDS = [
  "lorem", "ipsum", "dolor", "sit", "amet", "consectetur", "adipiscing", "elit",
  "sed", "do", "eiusmod", "tempor", "incididunt", "ut", "labore", "et", "dolore",
  "magna", "aliqua", "enim", "ad", "minim", "veniam", "quis", "nostrud",
  "exercitation", "ullamco", "laboris", "nisi", "aliquip", "ex", "ea", "commodo",
  "consequat", "duis", "aute", "irure", "in", "reprehenderit", "voluptate",
  "velit", "esse", "cillum", "fugiat", "nulla", "pariatur", "excepteur", "sint",
  "occaecat", "cupidatat", "non", "proident", "sunt", "culpa", "qui", "officia",
  "deserunt", "mollit", "anim", "id", "est", "laborum", "at", "vero", "eos",
  "accusamus", "iusto", "odio", "dignissimos", "ducimus", "blanditiis", "praesentium",
  "voluptatum", "deleniti", "atque", "corrupti", "quos", "dolores", "quas",
  "molestias", "excepturi", "sint", "obcaecati", "cupiditate", "provident"
];

const CHINESE_SENTENCES = [
  "天地玄黄，宇宙洪荒，日月盈昃，辰宿列张。",
  "寒来暑往，秋收冬藏，闰余成岁，律吕调阳。",
  "云腾致雨，露结为霜，金生丽水，玉出昆冈。",
  "剑号巨阙，珠称夜光，果珍李柰，菜重芥姜。",
  "海咸河淡，鳞潜羽翔，龙师火帝，鸟官人皇。",
  "始制文字，乃服衣裳，推位让国，有虞陶唐。",
  "吊民伐罪，周发殷汤，坐朝问道，垂拱平章。",
  "爱育黎首，臣伏戎羌，遐迩一体，率宾归王。",
  "鸣凤在竹，白驹食场，化被草木，赖及万方。",
  "盖此身发，四大五常，恭惟鞠养，岂敢毁伤。",
  "女慕贞洁，男效才良，知过必改，得能莫忘。",
  "罔谈彼短，靡恃己长，信使可覆，器欲难量。"
];

const TECH_SENTENCES = [
  "分布式微服务架构在多数据中心场景下展现出优异的高可用与弹性容灾能力。",
  "基于事件驱动的响应式状态管理大幅简化了跨组件异步数据流的维护成本。",
  "端侧边缘计算节点结合硬件神经网络加速器，有效降低了高频推理任务的端到端延迟。",
  "容器化集群通过声明式资源编排与自动扩缩容机制，实现了计算资源的精细化利用。",
  "采用非阻塞异步 I/O 模型与零拷贝内存池技术，极大地提升了网关服务的吞吐瓶颈。",
  "细粒度访问控制策略配合端到端传输层加密，构建起坚固的纵深安全防御体系。",
  "跨平台原生渲染管线兼顾了流畅的操作响应帧率与低能耗运行特征。"
];

export function LoremGenTool() {
  useLanguage();
  const { toast } = useToast();

  const [language, setLanguage] = useState<"latin" | "chinese" | "tech">("latin");
  const [unit, setUnit] = useState<"paragraphs" | "sentences" | "words">("paragraphs");
  const [count, setCount] = useState<number>(3);
  const [wrapTags, setWrapTags] = useState<"none" | "p" | "li">("none");
  const [startWithLorem, setStartWithLorem] = useState<boolean>(true);
  const [seed, setSeed] = useState<number>(0);
  const [copied, setCopied] = useState(false);

  // Generate text
  const generatedText = useMemo(() => {
    // pseudo-random with seed
    let s = seed + 1;
    const random = () => {
      const x = Math.sin(s++) * 10000;
      return x - Math.floor(x);
    };

    if (language === "latin") {
      if (unit === "words") {
        const words: string[] = [];
        if (startWithLorem && count >= 2) {
          words.push("Lorem", "ipsum");
        }
        while (words.length < count) {
          const w = LATIN_WORDS[Math.floor(random() * LATIN_WORDS.length)];
          words.push(w);
        }
        const text = words.join(" ");
        return wrapTags === "p" ? `<p>${text}</p>` : wrapTags === "li" ? `<li>${text}</li>` : text;
      }

      if (unit === "sentences") {
        const sentences: string[] = [];
        for (let i = 0; i < count; i++) {
          const len = Math.floor(random() * 8) + 8;
          const words: string[] = [];
          if (i === 0 && startWithLorem && len >= 5) {
            words.push("Lorem", "ipsum", "dolor", "sit", "amet");
          }
          while (words.length < len) {
            words.push(LATIN_WORDS[Math.floor(random() * LATIN_WORDS.length)]);
          }
          let sent = words.join(" ");
          sent = sent.charAt(0).toUpperCase() + sent.slice(1) + ".";
          sentences.push(sent);
        }
        if (wrapTags === "p") return sentences.map((s) => `<p>${s}</p>`).join("\n\n");
        if (wrapTags === "li") return sentences.map((s) => `<li>${s}</li>`).join("\n");
        return sentences.join(" ");
      }

      // Paragraphs
      const paragraphs: string[] = [];
      for (let p = 0; p < count; p++) {
        const sentenceCount = Math.floor(random() * 3) + 4;
        const sentences: string[] = [];
        for (let i = 0; i < sentenceCount; i++) {
          const len = Math.floor(random() * 8) + 8;
          const words: string[] = [];
          if (p === 0 && i === 0 && startWithLorem && len >= 5) {
            words.push("Lorem", "ipsum", "dolor", "sit", "amet, consectetur adipiscing elit");
          }
          while (words.length < len) {
            words.push(LATIN_WORDS[Math.floor(random() * LATIN_WORDS.length)]);
          }
          let sent = words.join(" ");
          sent = sent.charAt(0).toUpperCase() + sent.slice(1) + ".";
          sentences.push(sent);
        }
        paragraphs.push(sentences.join(" "));
      }

      if (wrapTags === "p") return paragraphs.map((p) => `<p>${p}</p>`).join("\n\n");
      if (wrapTags === "li") return paragraphs.map((p) => `<li>${p}</li>`).join("\n");
      return paragraphs.join("\n\n");
    }

    // Chinese or Tech
    const pool = language === "chinese" ? CHINESE_SENTENCES : TECH_SENTENCES;

    if (unit === "words") {
      let chars = "";
      while (chars.length < count) {
        chars += pool[Math.floor(random() * pool.length)];
      }
      const text = chars.slice(0, count);
      return wrapTags === "p" ? `<p>${text}</p>` : wrapTags === "li" ? `<li>${text}</li>` : text;
    }

    if (unit === "sentences") {
      const sents: string[] = [];
      for (let i = 0; i < count; i++) {
        sents.push(pool[Math.floor(random() * pool.length)]);
      }
      if (wrapTags === "p") return sents.map((s) => `<p>${s}</p>`).join("\n\n");
      if (wrapTags === "li") return sents.map((s) => `<li>${s}</li>`).join("\n");
      return sents.join("");
    }

    // Paragraphs
    const paras: string[] = [];
    for (let p = 0; p < count; p++) {
      const sCount = Math.floor(random() * 3) + 3;
      const sents: string[] = [];
      for (let i = 0; i < sCount; i++) {
        sents.push(pool[Math.floor(random() * pool.length)]);
      }
      paras.push(sents.join(""));
    }

    if (wrapTags === "p") return paras.map((p) => `<p>${p}</p>`).join("\n\n");
    if (wrapTags === "li") return paras.map((p) => `<li>${p}</li>`).join("\n");
    return paras.join("\n\n");
  }, [language, unit, count, wrapTags, startWithLorem, seed]);

  // Statistics
  const charCount = generatedText.length;
  const wordCount = language === "latin"
    ? generatedText.replace(/<[^>]*>/g, "").trim().split(/\s+/).filter(Boolean).length
    : generatedText.replace(/<[^>]*>/g, "").replace(/[，。、；]/g, "").length;
  const paraCount = generatedText.split(/\n\n+/).filter(Boolean).length;

  // Actions
  const handleCopy = () => {
    navigator.clipboard.writeText(generatedText).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      toast({ title: tr("占位文本已复制到剪贴板", "Text copied to clipboard"), variant: "success" });
    });
  };

  const handleDownload = () => {
    const blob = new Blob([generatedText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `lorem_ipsum_${unit}_${count}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast({ title: tr("文件已下载", "File downloaded"), variant: "success" });
  };

  return (
    <div className="space-y-6">
      {/* 顶部控制面板 */}
      <div className="rounded-2xl border border-border/70 bg-card/60 backdrop-blur-sm p-5 shadow-sm space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-3">
          <div className="flex items-center gap-2">
            <Pilcrow className="h-5 w-5 text-primary" />
            <span className="text-sm font-semibold tracking-tight text-foreground">
              {tr("Lorem 占位文本生成参数", "Placeholder Settings")}
            </span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSeed((s) => s + 1)}
              className="text-xs"
            >
              <RefreshCw className="h-3.5 w-3.5 mr-1" />
              <span>{tr("随机刷新", "Randomize")}</span>
            </Button>
            <Button
              size="sm"
              onClick={handleCopy}
              className="text-xs"
            >
              {copied ? <Check className="h-3.5 w-3.5 mr-1 text-emerald-400" /> : <Copy className="h-3.5 w-3.5 mr-1" />}
              <span>{copied ? tr("已复制", "Copied") : tr("一键复制", "Copy All")}</span>
            </Button>
          </div>
        </div>

        {/* 选项栅格 */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* 语言风格 */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
              <Languages className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{tr("语言风格", "Style / Language")}</span>
            </label>
            <Select
              value={language}
              onChange={(e) => setLanguage(e.target.value as any)}
              triggerClassName="h-10 rounded-xl text-xs px-3"
            >
              <option value="latin">经典拉丁文 (Classic Latin)</option>
              <option value="chinese">传统中文 (千字文排版)</option>
              <option value="tech">科技/互联网 (白话通用)</option>
            </Select>
          </div>

          {/* 生成单位 */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
              <Sliders className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{tr("生成类型", "Unit Type")}</span>
            </label>
            <Select
              value={unit}
              onChange={(e) => setUnit(e.target.value as any)}
              triggerClassName="h-10 rounded-xl text-xs px-3"
            >
              <option value="paragraphs">{tr("段落 (Paragraphs)", "Paragraphs")}</option>
              <option value="sentences">{tr("句子 (Sentences)", "Sentences")}</option>
              <option value="words">{tr("单词/字数 (Words)", "Words")}</option>
            </Select>
          </div>

          {/* 数量 */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
              <span>{tr("数量", "Count")}</span>
              <span className="text-[11px] text-muted-foreground">({count})</span>
            </label>
            <Input
              type="number"
              min={1}
              max={unit === "words" ? 500 : 30}
              value={count}
              onChange={(e) => setCount(Math.max(1, parseInt(e.target.value) || 1))}
              className="h-10 text-xs"
            />
          </div>

          {/* HTML 标签包裹 */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-foreground flex items-center gap-1.5">
              <Code className="h-3.5 w-3.5 text-muted-foreground" />
              <span>{tr("HTML 格式包装", "HTML Tag Wrap")}</span>
            </label>
            <Select
              value={wrapTags}
              onChange={(e) => setWrapTags(e.target.value as any)}
              triggerClassName="h-10 rounded-xl text-xs px-3"
            >
              <option value="none">{tr("纯文本 (无标签)", "Plain Text")}</option>
              <option value="p">&lt;p&gt; 段落标签</option>
              <option value="li">&lt;li&gt; 列表标签</option>
            </Select>
          </div>
        </div>

        {/* 额外配置 */}
        {language === "latin" && (
          <div className="flex items-center gap-2 pt-1 border-t border-border/40">
            <label className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer select-none">
              <input
                type="checkbox"
                checked={startWithLorem}
                onChange={(e) => setStartWithLorem(e.target.checked)}
                className="rounded border-input text-primary focus:ring-primary h-3.5 w-3.5"
              />
              <span>{tr("以 “Lorem ipsum dolor sit amet…” 标准首句起始", "Start with Lorem ipsum...")}</span>
            </label>
          </div>
        )}
      </div>

      {/* 生成结果展示卡片 */}
      <div className="rounded-2xl border border-border/70 bg-card/60 backdrop-blur-sm p-5 shadow-sm space-y-3">
        <div className="flex items-center justify-between border-b border-border/50 pb-2.5">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <span>{tr("统计：", "Stats:")}</span>
            <span className="font-medium text-foreground">{charCount} {tr("字符", "chars")}</span>
            <span>•</span>
            <span className="font-medium text-foreground">{wordCount} {tr(language === "latin" ? "单词" : "字", "words")}</span>
            <span>•</span>
            <span className="font-medium text-foreground">{paraCount} {tr("段落", "paragraphs")}</span>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownload}
              className="text-xs h-8"
            >
              <Download className="h-3.5 w-3.5 mr-1" />
              <span>{tr("保存为 TXT", "Download TXT")}</span>
            </Button>
          </div>
        </div>

        <Textarea
          readOnly
          rows={12}
          value={generatedText}
          className="font-mono text-xs leading-relaxed bg-secondary/20 resize-y"
        />
      </div>
    </div>
  );
}
