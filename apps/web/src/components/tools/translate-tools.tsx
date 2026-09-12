"use client";

/**
 * 多语言翻译工具的界面与逻辑。
 *
 * 目录：
 *  1. PURE LOGIC ZONE（纯逻辑区）：语言表、分段、三个接口的响应解析、错误分类、
 *     provider 降级链、带注入 fetch 的翻译编排器。**不引用 React、不碰 DOM**，
 *     可以整段抽出来在 Node 里跑单测（单测脚本按这两行标记抽取源码）。
 *  2. 共用外观件。
 *  3. 导出组件 TranslatorTool。
 *
 * 关于「用哪个接口」这个决定，是**实测出来的**（详见交付报告里的可达性表），不是猜的：
 *
 *  | 候选接口                       | 本机实测结果 |
 *  |--------------------------------|--------------|
 *  | Google 非官方 gtx 接口          | DNS 能解析，TCP 443 直接不通（超时 8~21s），浏览器里 `Failed to fetch` |
 *  | cn.bing.com/ttranslatev3        | 服务端可达（要抓 IG/IID/token）；**响应不带 CORS 头**，浏览器里取不到数据 |
 *  | LibreTranslate 公开实例（8 个） | 403 / 502 / 502、Cloudflare 人机校验、证书不受信、DNS 不存在；且大多已要求 API key |
 *  | lingva.ml、simplytranslate.org  | 403 / 500，浏览器里 `Failed to fetch` |
 *  | 百度 fanyi transapi             | errno 1022「访问出现异常」（反爬），不可用 |
 *  | **MyMemory**                    | 200，`Access-Control-Allow-Origin: *`，19 种目标语言全部实测可用 |
 *  | **有道 aidemo**                 | 200，`Access-Control-Allow-Origin: *`，中英互译质量好、响应 ~100ms |
 *
 * 所以免密钥可用的是**两个**（MyMemory 与有道 aidemo），两者能力互补：
 *  - 有道：目标语言只支持「简体中文」与「英语」（其余一律 errorCode 102）；支持任意源语言→中文；
 *          有频率限制（实测连续 6 个请求后返回 errorCode 411）；响应 ~0.1~0.4s，中英质量好。
 *  - MyMemory：19 种目标语言任意互译、支持自动检测源语言；**单次查询硬上限 500 字符**
 *          （超过返回 responseStatus 403 + "QUERY LENGTH LIMIT EXCEEDED"）；无密钥但很慢（~3.5s/次）。
 *
 * 因此本工具做的是「多 provider 抽象 + 自动降级链」：按段请求，某一段在某个 provider 上失败
 * 就把游标推进到下一个 provider，并在界面上如实标出每一段实际用的是哪个接口。
 * 用户还可以填自己的 LibreTranslate / 自建接口地址，它会被排到链首。
 *
 * 视觉语言严格跟随 docs/新工具UI规范.md：布局模式 A（转换对照）—— 输入与输出同等重要、
 * 需要互相对照；顶部一条语言选择 + 互换 + 操作栏；只用一个 primary 低透明度渐变做点缀。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowLeftRight,
  Check,
  Copy,
  Gauge,
  Languages,
  Link2,
  Loader2,
  Sparkles,
  Trash2,
  Wand2,
} from "lucide-react";
import {
  Badge,
  Button,
  Input,
  Label,
  ProgressBar,
  Select,
  Textarea,
} from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useToolDraft } from "@/lib/use-tool-draft";
import { cn } from "@/lib/utils";

/* ==========================================================================================
 * PURE LOGIC ZONE START
 * 下面全部是纯函数 / 只依赖全局 fetch 与定时器的编排逻辑：不引用 React、不碰 DOM。
 * 输入输出都是字符串 / 数字 / 数组 / 普通对象（fetch 可注入，便于用假 fetch 跑单测）。
 * ========================================================================================== */

/** 界面上使用的语言码。zh = 简体中文，zh-TW = 繁体中文。 */
export type LangCode =
  | "auto"
  | "zh"
  | "zh-TW"
  | "en"
  | "ja"
  | "ko"
  | "fr"
  | "de"
  | "ru"
  | "es"
  | "pt"
  | "it"
  | "ar"
  | "th"
  | "vi"
  | "nl"
  | "pl"
  | "tr"
  | "id"
  | "hi"
  | "uk";

export type ProviderId = "custom" | "youdao" | "mymemory";

/** 用户在界面上选的接口策略；auto = 按实测能力自动编排降级链。 */
export type ProviderMode = "auto" | ProviderId;

export type ErrorKind =
  | "network"
  | "timeout"
  | "rate_limit"
  | "unsupported_lang"
  | "too_long"
  | "same_language"
  | "empty"
  | "bad_response"
  | "http"
  | "no_provider"
  | "cancelled"
  | "unknown";

export type LangEntry = {
  code: LangCode;
  label: string;
  /** 有道 aidemo 的语言码；null 表示该语言不能作为有道的**目标**语言 */
  youdao: string | null;
  /** MyMemory 的语言码 */
  mymemory: string;
  /** LibreTranslate 的语言码（自定义接口用） */
  libre: string;
};

/**
 * 21 种语言（含「自动检测」）。youdao 列写 null 的依据：实测「英→日/韩/法/德/俄/西…」全部返回
 * errorCode 102（不支持的语言类型），连「英→繁体中文（to=zh-CHT）」也是 102，
 * 所以有道的**目标**语言只有 zh-CHS（简体）与 en（英语）两个。
 */
export const LANGUAGES: LangEntry[] = [
  { code: "auto", label: "自动检测", youdao: "auto", mymemory: "Autodetect", libre: "auto" },
  { code: "zh", label: "简体中文", youdao: "zh-CHS", mymemory: "zh-CN", libre: "zh" },
  { code: "zh-TW", label: "繁体中文", youdao: null, mymemory: "zh-TW", libre: "zt" },
  { code: "en", label: "英语", youdao: "en", mymemory: "en", libre: "en" },
  { code: "ja", label: "日语", youdao: null, mymemory: "ja", libre: "ja" },
  { code: "ko", label: "韩语", youdao: null, mymemory: "ko", libre: "ko" },
  { code: "fr", label: "法语", youdao: null, mymemory: "fr", libre: "fr" },
  { code: "de", label: "德语", youdao: null, mymemory: "de", libre: "de" },
  { code: "ru", label: "俄语", youdao: null, mymemory: "ru", libre: "ru" },
  { code: "es", label: "西班牙语", youdao: null, mymemory: "es", libre: "es" },
  { code: "pt", label: "葡萄牙语", youdao: null, mymemory: "pt", libre: "pt" },
  { code: "it", label: "意大利语", youdao: null, mymemory: "it", libre: "it" },
  { code: "ar", label: "阿拉伯语", youdao: null, mymemory: "ar", libre: "ar" },
  { code: "th", label: "泰语", youdao: null, mymemory: "th", libre: "th" },
  { code: "vi", label: "越南语", youdao: null, mymemory: "vi", libre: "vi" },
  { code: "nl", label: "荷兰语", youdao: null, mymemory: "nl", libre: "nl" },
  { code: "pl", label: "波兰语", youdao: null, mymemory: "pl", libre: "pl" },
  { code: "tr", label: "土耳其语", youdao: null, mymemory: "tr", libre: "tr" },
  { code: "id", label: "印尼语", youdao: null, mymemory: "id", libre: "id" },
  { code: "hi", label: "印地语", youdao: null, mymemory: "hi", libre: "hi" },
  { code: "uk", label: "乌克兰语", youdao: null, mymemory: "uk", libre: "uk" },
];

/** 可选的**目标**语言（不含「自动检测」）。 */
export const TARGET_LANGUAGES: LangEntry[] = LANGUAGES.filter((l) => l.code !== "auto");

export function langEntry(code: string): LangEntry | undefined {
  return LANGUAGES.find((l) => l.code === code);
}

/** 语言码 → 中文名；接口返回的原始码也能吃（en / zh-CHS / zh-CN / zt …）。 */
export function languageLabel(code: string | undefined): string {
  if (!code) return "未知";
  const normalized = normalizeDetected(code);
  if (normalized) return langEntry(normalized)?.label ?? normalized;
  return code;
}

/** 把各接口返回的源语言码统一成界面语言码；认不出返回 undefined。 */
export function normalizeDetected(raw: string | undefined): LangCode | undefined {
  if (!raw) return undefined;
  const low = raw.trim().toLowerCase();
  if (low === "") return undefined;
  if (low === "zh" || low === "zh-cn" || low === "zh-chs" || low === "zh-hans" || low === "zh_cn") return "zh";
  if (low === "zh-tw" || low === "zh-cht" || low === "zh-hant" || low === "zt") return "zh-TW";
  const hit = LANGUAGES.find((l) => l.code === low);
  if (hit && hit.code !== "auto") return hit.code;
  return undefined;
}

export function isChinese(code: string): boolean {
  return code === "zh" || code === "zh-TW";
}

/**
 * 有道 `from` 参数的例外映射。
 * 繁体中文**不能**作为有道的结果语言（实测 to=zh-CHT → errorCode 102），所以 LANGUAGES 里
 * zh-TW 的 youdao 是 null；但把繁体中文当**源**语言送进去是另一回事，它的码是 zh-CHT。
 */
const YOUDAO_SOURCE_OVERRIDES: Record<string, string> = { "zh-TW": "zh-CHT" };

/**
 * 实测确认过「可以作为有道源语言」的语言。只有这几个才敢把明确的码发给有道；
 * 其余一律传 from=auto，交给有道自己去识别 —— 实测 from=auto 对英语、日语、法语文本都认得很准
 * （返回的 l 分别是 en2zh-CHS / ja2zh-CHS / fr2zh-CHS），比瞎猜一个它可能不认的码安全。
 */
const YOUDAO_VERIFIED_SOURCES = new Set(["zh", "zh-TW", "en", "ja"]);

/** 界面上选的语言码 → 有道 `from` 参数。 */
export function youdaoSourceCode(source: string): string {
  if (source === "auto") return "auto";
  if (!YOUDAO_VERIFIED_SOURCES.has(source)) return "auto";
  // 注意 ?? 会把 null 也当成「没有」，所以最后一档要落到 source 本身（ja 的有道码就是 ja）
  return YOUDAO_SOURCE_OVERRIDES[source] ?? langEntry(source)?.youdao ?? source;
}

/**
 * 有道 aidemo 能否承担这次翻译。
 * 实测：目标 zh-CHS 时任意源语言都行（含 from=auto 自动识别到 en/ja/fr）；
 * 目标是 en 时，只有**源语言是中文**才被接受（日→英、法→英、英→英 都是 errorCode 102）。
 */
export function isYoudaoApplicable(source: string, target: string): boolean {
  if (target === "zh") return true;
  if (target === "en") return source === "auto" || isChinese(source);
  return false;
}

/**
 * 组装 provider 降级链。
 * - 配了自定义接口时，它排第一（用户显式配置的应当优先）；
 * - auto 模式：能用的有道排前（中英又快又好），MyMemory 兜底（语言最全）；
 * - 手动指定某个 provider 时，仍然把它放在链首、其余作为兜底，避免用户选错就完全不能翻。
 */
export function buildProviderChain(
  source: string,
  target: string,
  mode: ProviderMode,
  hasCustom: boolean,
): ProviderId[] {
  if (mode === "custom") return hasCustom ? ["custom"] : [];
  if (mode === "youdao") return ["youdao", "mymemory"];
  if (mode === "mymemory") return ["mymemory"];
  const chain: ProviderId[] = [];
  if (hasCustom) chain.push("custom");
  if (isYoudaoApplicable(source, target)) chain.push("youdao");
  chain.push("mymemory");
  return chain;
}

export function providerLabel(id: ProviderId): string {
  if (id === "youdao") return "有道翻译";
  if (id === "mymemory") return "MyMemory";
  return "自定义接口";
}

/* ---------------------------------------------------------------- 分段 */

/** 单段的字符上限。取 400 是为了同时满足：MyMemory 硬上限 500、有道实测 ~1000 才报 103。 */
export const SEGMENT_MAX_CHARS = 400;
/** 一次最多分多少段（约 400 段 = 16 万字符），超过就直接如实告诉用户太长了。 */
export const MAX_SEGMENTS = 400;
/** 整段输入的上限。 */
export const MAX_INPUT_CHARS = 100000;
/** 看起来像「列表 / 字幕」的行长阈值：块内每行都不超过它，就按行分段以保住对照关系。 */
const LIST_LINE_MAX = 80;

export type SourceSegment = { text: string; gapAfter: boolean };

/** 按句末标点切句（中日文的。！？；、拉丁文的 .!?; 都认）。 */
export function splitSentences(block: string): string[] {
  return block
    .split(/(?<=[。！？；!?;])|(?<=\.)(?=\s)/)
    .map((s) => s.trim())
    .filter((s) => s !== "");
}

/** 把过长的单句再切碎：优先在空格、其次在逗号顿号处断，最后才硬切。 */
function breakLongSentence(sentence: string, maxChars: number): string[] {
  if (sentence.length <= maxChars) return [sentence];
  const out: string[] = [];
  let rest = sentence;
  while (rest.length > maxChars) {
    const window = rest.slice(0, maxChars);
    let cut = Math.max(
      window.lastIndexOf(" "),
      window.lastIndexOf("，"),
      window.lastIndexOf("、"),
      window.lastIndexOf(","),
    );
    if (cut < maxChars * 0.5) cut = maxChars;
    out.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest !== "") out.push(rest);
  return out.filter((s) => s !== "");
}

/** 把一组句子贪心地打包成不超过 maxChars 的段。 */
function packSentences(sentences: string[], maxChars: number): string[] {
  const flat: string[] = [];
  for (const sentence of sentences) flat.push(...breakLongSentence(sentence, maxChars));
  const out: string[] = [];
  let buf = "";
  for (const piece of flat) {
    if (buf === "") {
      buf = piece;
    } else if (buf.length + 1 + piece.length <= maxChars) {
      buf = `${buf} ${piece}`;
    } else {
      out.push(buf);
      buf = piece;
    }
  }
  if (buf !== "") out.push(buf);
  return out;
}

/**
 * 把整段输入切成「可直接对照」的小段：
 * - 空行分段；
 * - 块内每行都很短（像列表 / 字幕）时**按行成段**，这样译文能一行对一行；
 * - 否则按句号打包到 maxChars 一段。
 * gapAfter 表示这一段之后原文有空行，整段译文拼接时用它还原段落间隔。
 */
export function splitSegments(text: string, maxChars: number = SEGMENT_MAX_CHARS): SourceSegment[] {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  if (normalized === "") return [];
  const blocks = normalized
    .split(/\n{2,}/)
    .map((b) => b.trim())
    .filter((b) => b !== "");
  const out: SourceSegment[] = [];
  blocks.forEach((block, blockIndex) => {
    const lines = block.split("\n").map((l) => l.trim()).filter((l) => l !== "");
    const looksLikeList = lines.length >= 2 && lines.every((l) => l.length <= LIST_LINE_MAX);
    let pieces: string[];
    if (looksLikeList) {
      pieces = [];
      for (const line of lines) pieces.push(...breakLongSentence(line, maxChars));
    } else {
      pieces = packSentences(splitSentences(block.replace(/\n+/g, " ")), maxChars);
    }
    pieces.forEach((piece, pieceIndex) => {
      const isLastOfBlock = pieceIndex === pieces.length - 1;
      out.push({ text: piece, gapAfter: isLastOfBlock && blockIndex < blocks.length - 1 });
    });
  });
  return out;
}

/** 把逐段译文拼回整段文本：同一块内用空格接，跨块用空行。 */
export function joinSegments(segments: Array<{ target: string; gapAfter: boolean }>): string {
  let out = "";
  segments.forEach((segment, index) => {
    out += segment.target;
    if (index < segments.length - 1) out += segment.gapAfter ? "\n\n" : " ";
  });
  return out;
}

/* ---------------------------------------------------------------- 响应解析 */

export type ParseOk = { ok: true; text: string; detected?: string };
export type ParseErr = { ok: false; kind: ErrorKind; detail: string };
export type ParseResult = ParseOk | ParseErr;

function parseJson(raw: string): { ok: true; value: unknown } | { ok: false; detail: string } {
  try {
    return { ok: true, value: JSON.parse(raw) as unknown };
  } catch {
    const head = raw.trim().slice(0, 80).replace(/\s+/g, " ");
    return { ok: false, detail: head === "" ? "响应体是空的" : `不是合法 JSON：${head}` };
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/**
 * 有道的错误码 → 错误类型。依据是**实测**：
 *   102 = 不支持的语言类型（英→日/韩/法、英→英、英→繁中都返回它）
 *   103 = 翻译文本过长（1215 字符的重复句返回它；900 字符正常散文不报）
 *   411 = 访问频率受限（连续 6 个请求之后开始出现，间隔 12s 时不再出现）
 */
export function classifyYoudaoCode(code: string): ErrorKind {
  if (code === "102") return "unsupported_lang";
  if (code === "103") return "too_long";
  if (code === "411") return "rate_limit";
  if (code === "401" || code === "402") return "http";
  return "unknown";
}

/**
 * 解析有道 aidemo 的响应。`l` 字段形如 "en2zh-CHS" / "zh-CHS2en"，从中取出**识别到的源语言**。
 * 真实样例见单测固件 youdao.ok.en-zh.json / youdao.ok.ja-zh.json / youdao.ok.zh-en.json /
 * youdao.err.unsupported.json。
 */
export function parseYoudaoRaw(raw: string): ParseResult {
  const parsed = parseJson(raw);
  if (!parsed.ok) return { ok: false, kind: "bad_response", detail: parsed.detail };
  const body = asRecord(parsed.value);
  if (!body) return { ok: false, kind: "bad_response", detail: "顶层不是 JSON 对象" };

  const code = typeof body.errorCode === "string" ? body.errorCode : "0";
  if (code !== "0") {
    const kind = classifyYoudaoCode(code);
    return { ok: false, kind, detail: `有道 errorCode ${code}` };
  }

  const list = Array.isArray(body.translation) ? body.translation : [];
  const text = list.filter((t): t is string => typeof t === "string").join("");
  if (text.trim() === "") {
    return { ok: false, kind: "empty", detail: "有道返回了空译文" };
  }

  const marker = typeof body.l === "string" ? body.l : "";
  const matched = /^(.*?)2(.*)$/.exec(marker);
  const detected = matched ? normalizeDetected(matched[1]) : undefined;
  return { ok: true, text, detected };
}

/**
 * 解析 MyMemory 的响应。
 * ⚠️ 这个接口**失败时 HTTP 仍然是 200**，错误信息放在 responseDetails / responseData.translatedText，
 * 并且 responseStatus 有时是数字 200、有时是字符串 "403"，所以必须按内容判断。
 * 真实样例见 mymemory.ok.*.json / mymemory.err.*.json。
 * （「今日免费额度用尽」那条文案来自官方文档，本机没触发到，属未实测。）
 */
export function parseMyMemoryRaw(raw: string): ParseResult {
  const parsed = parseJson(raw);
  if (!parsed.ok) return { ok: false, kind: "bad_response", detail: parsed.detail };
  const body = asRecord(parsed.value);
  if (!body) return { ok: false, kind: "bad_response", detail: "顶层不是 JSON 对象" };

  const data = asRecord(body.responseData);
  const details = typeof body.responseDetails === "string" ? body.responseDetails : "";
  const text = data && typeof data.translatedText === "string" ? data.translatedText : "";
  const status = Number(body.responseStatus);
  const haystack = `${details} ${text}`;

  if (/QUERY LENGTH LIMIT EXCEEDED/i.test(haystack)) {
    return { ok: false, kind: "too_long", detail: "MyMemory 单次查询上限 500 字符" };
  }
  if (/PLEASE SELECT TWO DISTINCT LANGUAGES/i.test(haystack)) {
    return { ok: false, kind: "same_language", detail: "源语言与目标语言相同" };
  }
  if (/IS AN INVALID (SOURCE|TARGET) LANGUAGE|INVALID LANGUAGE PAIR/i.test(haystack)) {
    return { ok: false, kind: "unsupported_lang", detail: details || text };
  }
  if (/USED ALL AVAILABLE FREE TRANSLATIONS|MYMEMORY WARNING/i.test(haystack) || body.quotaFinished === true) {
    return { ok: false, kind: "rate_limit", detail: details || "MyMemory 今日免费额度已用尽" };
  }
  if (Number.isFinite(status) && status !== 200) {
    return { ok: false, kind: "http", detail: details || text || `responseStatus ${status}` };
  }
  if (text.trim() === "") {
    return { ok: false, kind: "empty", detail: "MyMemory 返回了空译文" };
  }

  const detected = data && typeof data.detectedLanguage === "string" ? data.detectedLanguage : undefined;
  return { ok: true, text, detected: normalizeDetected(detected) };
}

/**
 * 解析 LibreTranslate（及兼容服务）的响应：{ translatedText, detectedLanguage? }。
 * 也容忍部分部署返回的 { translatedText: [...] } 数组形式。错误放在 error 字段里。
 * ⚠️ 本机没有任何可用的公开实例，所以这一支**只有格式约定、没有真机抓包**。
 */
export function parseLibreRaw(raw: string): ParseResult {
  const parsed = parseJson(raw);
  if (!parsed.ok) return { ok: false, kind: "bad_response", detail: parsed.detail };
  const body = asRecord(parsed.value);
  if (!body) return { ok: false, kind: "bad_response", detail: "顶层不是 JSON 对象" };

  const error = typeof body.error === "string" ? body.error : "";
  if (error !== "") {
    if (/slow down|too many requests|rate limit/i.test(error)) return { ok: false, kind: "rate_limit", detail: error };
    if (/not supported|unsupported|invalid/i.test(error)) return { ok: false, kind: "unsupported_lang", detail: error };
    if (/limit|too long|length/i.test(error)) return { ok: false, kind: "too_long", detail: error };
    return { ok: false, kind: "unknown", detail: error };
  }

  const rawText = body.translatedText;
  let text = "";
  if (typeof rawText === "string") text = rawText;
  else if (Array.isArray(rawText)) {
    text = rawText
      .map((item) => (typeof item === "string" ? item : (asRecord(item)?.translatedText as string) ?? ""))
      .join("");
  }
  if (text.trim() === "") return { ok: false, kind: "empty", detail: "自定义接口返回了空译文" };

  const detectedRaw = asRecord(body.detectedLanguage)?.language;
  return {
    ok: true,
    text,
    detected: typeof detectedRaw === "string" ? normalizeDetected(detectedRaw) : undefined,
  };
}

/* ---------------------------------------------------------------- 错误文案 */

export type FailureInfo = { title: string; detail: string; advice: string };

/** 把「错误类型」翻成人话，并给一条可操作的建议。 */
export function humanizeFailure(kind: ErrorKind, provider: ProviderId, detail: string, extra?: string): FailureInfo {
  const name = providerLabel(provider);
  switch (kind) {
    case "network":
      return {
        title: "网络不通",
        detail: `连不上 ${name}${extra ? `（${extra}）` : ""}。多半是被墙了、或者本机现在没联网。`,
        advice: "在下方「接口设置」里填一个自己搭的翻译接口地址，就能绕开公共接口。",
      };
    case "timeout":
      return {
        title: "接口没响应",
        detail: `${name} 超过 ${extra ?? "若干"} 秒没有返回任何数据。`,
        advice: "网络慢或接口正忙，稍后再试；也可以换成别的接口。",
      };
    case "rate_limit":
      return {
        title: "接口被限流了",
        detail: `${name} 说请求太频繁，暂时拒绝服务。${detail ? `（${detail}）` : ""}`,
        advice: "已经自动改用下一个接口；等十几秒再翻译会更稳。",
      };
    case "unsupported_lang":
      return {
        title: "这个接口不支持这组语言",
        detail: `${name} 不接受当前的语言组合。${detail ? `（${detail}）` : ""}`,
        advice: "已经自动改用下一个接口；如果全都失败，就换一个目标语言试试。",
      };
    case "too_long":
      return {
        title: "文本太长，接口装不下",
        detail: `${name} 拒绝了这段文本。${detail ? `（${detail}）` : ""}`,
        advice: "把文本拆成几段分别翻译，或者换一个自建接口。",
      };
    case "same_language":
      return {
        title: "源语言和目标语言是同一个",
        detail: "识别出来的语言就是你要翻译成的语言，没有可翻的内容。",
        advice: "换一个目标语言，或者把「源语言」明确设成别的语言。",
      };
    case "empty":
      return {
        title: "接口没有返回译文",
        detail: `${name} 返回了空内容。${detail ? `（${detail}）` : ""}`,
        advice: "换一个接口或稍后重试。",
      };
    case "bad_response":
      return {
        title: "接口返回的内容看不懂",
        detail: `${name} 的响应不是预期的格式。${detail ? `（${detail}）` : ""}`,
        advice: "如果用的是自定义接口，请确认它返回 LibreTranslate 格式的 JSON（translatedText 字段）。",
      };
    case "http":
      return {
        title: "接口报错了",
        detail: `${name} 返回了错误。${detail ? `（${detail}）` : ""}`,
        advice: "稍后重试，或者换一个接口。",
      };
    case "no_provider":
      return {
        title: "还没有可用的接口",
        detail: "接口策略选的是「自定义接口」，但地址是空的。",
        advice: "在下方「接口设置」里填入你自己的翻译接口地址，或把策略改回「自动」。",
      };
    case "cancelled":
      return { title: "已取消", detail: "这次翻译被新的请求取代了。", advice: "" };
    default:
      return {
        title: "翻译失败",
        detail: `${name} 没有给出可识别的原因。${detail ? `（${detail}）` : ""}`,
        advice: "稍后重试，或者换一个接口。",
      };
  }
}

/* ---------------------------------------------------------------- 请求 */

/** 结构化的 fetch 类型：只用到这 4 个成员，方便单测注入假 fetch。 */
export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text: () => Promise<string> }>;

export type ProviderPlan = {
  id: ProviderId;
  /** 单段字符上限（本工具统一用 400 的分段计划，这里只用于说明） */
  maxChars: number;
  /** 两次请求之间的最小间隔，用于躲开限流 */
  minIntervalMs: number;
  timeoutMs: number;
  /** 被限流后「等一会儿再来一次」的等待时间；0 表示不重试 */
  retryAfterMs: number;
};

export const PROVIDER_PLANS: Record<ProviderId, ProviderPlan> = {
  // 有道实测：~100ms 响应，但连续 6 个请求后开始 411，所以留 1.3s 间隔并允许等一次
  youdao: { id: "youdao", maxChars: 900, minIntervalMs: 1300, timeoutMs: 12000, retryAfterMs: 2500 },
  // MyMemory 实测 ~3.5s/次，没观察到限流，不需要额外间隔
  mymemory: { id: "mymemory", maxChars: 400, minIntervalMs: 0, timeoutMs: 20000, retryAfterMs: 0 },
  custom: { id: "custom", maxChars: 4000, minIntervalMs: 0, timeoutMs: 25000, retryAfterMs: 0 },
};

export type CustomConfig = { url: string; apiKey: string };

/** 拼出某个 provider 对某一段的请求。纯函数，便于单测断言 URL 组成。 */
export function buildRequest(
  provider: ProviderId,
  segment: string,
  source: string,
  target: string,
  custom: CustomConfig,
): { url: string; init: { method?: string; headers?: Record<string, string>; body?: string } } {
  if (provider === "youdao") {
    const entry = langEntry(target);
    const to = entry?.youdao ?? "zh-CHS";
    // 有道实测支持 from=auto 自动识别；用户明确了源语言时优先用它的语言码
    const from = youdaoSourceCode(source);
    const url =
      `https://aidemo.youdao.com/trans?q=${encodeURIComponent(segment)}` +
      `&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    return { url, init: {} };
  }
  if (provider === "mymemory") {
    const src = source === "auto" ? "Autodetect" : (langEntry(source)?.mymemory ?? "en");
    const tgt = langEntry(target)?.mymemory ?? "en";
    const url =
      `https://api.mymemory.translated.net/get?q=${encodeURIComponent(segment)}` +
      `&langpair=${encodeURIComponent(`${src}|${tgt}`)}`;
    return { url, init: {} };
  }
  const entry = langEntry(target);
  const payload: Record<string, string> = {
    q: segment,
    source: source === "auto" ? "auto" : (langEntry(source)?.libre ?? "auto"),
    target: entry?.libre ?? "en",
    format: "text",
  };
  if (custom.apiKey !== "") payload.api_key = custom.apiKey;
  return {
    url: custom.url,
    init: { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
  };
}

export function parseByProvider(provider: ProviderId, raw: string): ParseResult {  if (provider === "youdao") return parseYoudaoRaw(raw);
  if (provider === "mymemory") return parseMyMemoryRaw(raw);
  return parseLibreRaw(raw);
}

/** 一次「某 provider 翻某一段」的完整过程：定时、超时、限流后退避重试。 */
async function requestSegment(
  provider: ProviderId,
  segment: string,
  source: string,
  target: string,
  custom: CustomConfig,
  fetchImpl: FetchLike,
  sleep: (ms: number) => Promise<void>,
  signal: AbortSignal | undefined,
): Promise<ParseResult> {
  const plan = PROVIDER_PLANS[provider];
  const request = buildRequest(provider, segment, source, target, custom);
  const attempt = async (): Promise<ParseResult> => {
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    if (signal) {
      if (signal.aborted) return { ok: false, kind: "cancelled", detail: "已取消" };
      signal.addEventListener("abort", onAbort, { once: true });
    }
    const timer = setTimeout(() => controller.abort(), plan.timeoutMs);
    try {
      const response = await fetchImpl(request.url, { ...request.init, signal: controller.signal });
      const raw = await response.text();
      if (!response.ok) {
        if (response.status === 429) return { ok: false, kind: "rate_limit", detail: `HTTP 429` };
        // 有的接口把错误也放在 200 里，但 4xx/5xx 一定是失败
        const parsed = parseByProvider(provider, raw);
        if (!parsed.ok && parsed.kind !== "bad_response") return parsed;
        return { ok: false, kind: "http", detail: `HTTP ${response.status}` };
      }
      return parseByProvider(provider, raw);
    } catch (error) {
      const aborted = signal?.aborted === true;
      if (aborted) return { ok: false, kind: "cancelled", detail: "已取消" };
      const message = error instanceof Error ? error.message : String(error);
      // AbortController 触发的超时，与「连不上」要分开报，用户能做的事不一样
      if (controller.signal.aborted) {
        return { ok: false, kind: "timeout", detail: `${Math.round(plan.timeoutMs / 1000)} 秒无响应`, };
      }
      return { ok: false, kind: "network", detail: message };
    } finally {
      clearTimeout(timer);
      if (signal) signal.removeEventListener("abort", onAbort);
    }
  };

  const first = await attempt();
  if (!first.ok && first.kind === "rate_limit" && plan.retryAfterMs > 0) {
    await sleep(plan.retryAfterMs);
    if (signal?.aborted) return { ok: false, kind: "cancelled", detail: "已取消" };
    return attempt();
  }
  return first;
}

/* ---------------------------------------------------------------- 编排 */

export type SegmentPair = {
  source: string;
  target: string;
  provider: ProviderId;
  gapAfter: boolean;
};

export type TranslateSuccess = {
  ok: true;
  /** 拼好的整段译文 */
  text: string;
  segments: SegmentPair[];
  /** 实际用到的接口（按首次出现顺序） */
  providers: ProviderId[];
  /** 中途失败的接口及原因（界面上如实展示「降级过」） */
  degraded: Array<{ provider: ProviderId; kind: ErrorKind; detail: string }>;
  detected?: LangCode;
  elapsedMs: number;
};

export type TranslateFailure = {
  ok: false;
  kind: ErrorKind;
  title: string;
  detail: string;
  advice: string;
  attempts: Array<{ provider: ProviderId; kind: ErrorKind; detail: string }>;
};

export type TranslateOutcome = TranslateSuccess | TranslateFailure;

export type TranslateOptions = {
  text: string;
  source: string;
  target: string;
  chain: ProviderId[];
  custom: CustomConfig;
  fetchImpl?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  signal?: AbortSignal;
  now?: () => number;
  onProgress?: (done: number, total: number) => void;
};

/**
 * 逐段翻译的编排器。
 *
 * 关键行为（也是单测覆盖的点）：
 * 1. 先分段；段数超过 MAX_SEGMENTS 直接如实报「太长」，不去轰炸接口。
 * 2. 维护一个 provider 游标：某一段在某接口上失败，就把游标推进到下一个接口重试**同一段**，
 *    成功的段保留自己的 provider 标记 —— 这样长文本在「有道路数用完」之后会自动切到
 *    MyMemory 继续，而不是整篇重来。
 * 3. 每个 provider 有最小请求间隔（躲限流）；被限流时先等一会儿重试一次。
 * 4. 整条链都失败时返回一条**带人话建议**的失败信息，并保留每个接口各自的失败原因。
 * 5. 通过 signal 取消：所有已发出的请求会被 abort，返回值是 cancelled。
 */
export async function translateText(options: TranslateOptions): Promise<TranslateOutcome> {
  const {
    text,
    source,
    target,
    chain,
    custom,
    fetchImpl = fetch as unknown as FetchLike,
    sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    signal,
    now = () => Date.now(),
    onProgress,
  } = options;

  const started = now();
  const sourceSegments = splitSegments(text);

  if (chain.length === 0) {
    const info = humanizeFailure("no_provider", "custom", "");
    return { ok: false, kind: "no_provider", ...info, attempts: [] };
  }
  if (sourceSegments.length === 0) {
    const info = humanizeFailure("empty", chain[0], "输入是空的");
    return { ok: false, kind: "empty", ...info, attempts: [] };
  }
  if (sourceSegments.length > MAX_SEGMENTS) {
    const info = humanizeFailure(
      "too_long",
      chain[0],
      `需要切成 ${sourceSegments.length} 段，超过上限 ${MAX_SEGMENTS} 段`,
    );
    return { ok: false, kind: "too_long", ...info, attempts: [] };
  }
  if (source !== "auto" && source === target) {
    const info = humanizeFailure("same_language", chain[0], "");
    return { ok: false, kind: "same_language", ...info, attempts: [] };
  }

  const attempts: Array<{ provider: ProviderId; kind: ErrorKind; detail: string }> = [];
  const segments: SegmentPair[] = [];
  const lastRequestAt = new Map<ProviderId, number>();
  let cursor = 0;
  let detected: LangCode | undefined = undefined;

  for (const piece of sourceSegments) {
    let placed = false;
    let lastFailure: { provider: ProviderId; kind: ErrorKind; detail: string } | null = null;

    while (cursor < chain.length) {
      const provider = chain[cursor];
      const plan = PROVIDER_PLANS[provider];
      const previous = lastRequestAt.get(provider);
      if (previous !== undefined && plan.minIntervalMs > 0) {
        const wait = plan.minIntervalMs - (now() - previous);
        if (wait > 0) await sleep(wait);
      }
      lastRequestAt.set(provider, now());

      const result = await requestSegment(provider, piece.text, source, target, custom, fetchImpl, sleep, signal);
      if (signal?.aborted || (!result.ok && result.kind === "cancelled")) {
        const info = humanizeFailure("cancelled", provider, "");
        return { ok: false, kind: "cancelled", ...info, attempts };
      }
      if (result.ok) {
        segments.push({ source: piece.text, target: result.text, provider, gapAfter: piece.gapAfter });
        if (detected === undefined && result.detected) detected = normalizeDetected(result.detected);
        placed = true;
        break;
      }
      // 这一段在这个接口上没成：记下来，推进游标（后面所有段都不会再用它）
      lastFailure = { provider, kind: result.kind, detail: result.detail };
      attempts.push(lastFailure);
      cursor += 1;
    }

    if (!placed) {
      const failure = lastFailure ?? { provider: chain[chain.length - 1], kind: "unknown" as ErrorKind, detail: "" };
      const info = humanizeFailure(failure.kind, failure.provider, failure.detail, sourceSegments.length > 1
        ? `已翻好前 ${segments.length} 段`
        : undefined);
      return { ok: false, kind: failure.kind, ...info, attempts };
    }
    onProgress?.(segments.length, sourceSegments.length);
  }

  const providers: ProviderId[] = [];
  for (const segment of segments) {
    if (!providers.includes(segment.provider)) providers.push(segment.provider);
  }
  return {
    ok: true,
    text: joinSegments(segments),
    segments,
    providers,
    degraded: attempts,
    detected,
    elapsedMs: now() - started,
  };
}

/* ---------------------------------------------------------------- 竞态与防抖 */

/**
 * 「只认最后一次」的代际守卫。
 *
 * 边打边译时会有多次请求重叠：先发的那次可能后返回（接口快慢不同）。如果不管，
 * 慢的那次回来会把新译文盖掉 —— 用户看到的就是「输入框里是新句子、译文是旧句子」。
 * 每次发起翻译前 begin() 拿一个号，结果回来时用 isCurrent() 判断自己还是不是最新的。
 */
export class LatestGuard {
  private generation = 0;

  begin(): number {
    this.generation += 1;
    return this.generation;
  }

  isCurrent(token: number): boolean {
    return token === this.generation;
  }

  invalidate(): void {
    this.generation += 1;
  }
}

export type Debouncer<T> = {
  schedule: (payload: T) => void;
  cancel: () => void;
  isPending: () => boolean;
};

/** 最小间隔防抖：连续调用只会触发最后一次（定时器可注入，便于用假定时器单测）。 */
export function createDebouncer<T>(
  delayMs: number,
  run: (payload: T) => void,
  timers: {
    set: (fn: () => void, ms: number) => unknown;
    clear: (handle: unknown) => void;
  } = {
    set: (fn, ms) => setTimeout(fn, ms),
    clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
  },
): Debouncer<T> {
  let handle: unknown = null;
  let payload: T;
  let hasPayload = false;

  const cancel = () => {
    if (handle !== null) {
      timers.clear(handle);
      handle = null;
    }
    hasPayload = false;
  };

  return {
    schedule: (next: T) => {
      payload = next;
      hasPayload = true;
      if (handle !== null) timers.clear(handle);
      handle = timers.set(() => {
        handle = null;
        if (!hasPayload) return;
        hasPayload = false;
        run(payload);
      }, delayMs);
    },
    cancel,
    isPending: () => handle !== null,
  };
}

/* ==========================================================================================
 * PURE LOGIC ZONE END
 * ========================================================================================== */

/* ---------------------------------------------------------------- 外观件 */

const DEBOUNCE_MS = 800;

const OUTPUT_AREA_CLASS =
  "thin-scroll min-h-[300px] max-h-[520px] overflow-auto rounded-xl border border-border/50 bg-background/40 p-4 text-sm leading-relaxed text-foreground select-text md:min-h-[340px]";

/** 规范第 5 条的固定错误样式。 */
function ErrorBox({ title, detail, advice }: { title: string; detail: string; advice: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border-l-4 border-l-destructive bg-destructive/10 px-4 py-3 text-destructive">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-medium">{title}</p>
        <p className="text-xs leading-relaxed text-destructive/90">{detail}</p>
        {advice !== "" && <p className="text-xs leading-relaxed text-muted-foreground">建议：{advice}</p>}
      </div>
    </div>
  );
}

function MetaText({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("font-mono-accent text-[11px] text-muted-foreground", className)}>{children}</span>;
}

function ProviderBadge({ id }: { id: ProviderId }) {
  return (
    <Badge variant={id === "custom" ? "secondary" : "outline"} className="gap-1">
      {id === "custom" ? <Link2 className="h-3 w-3" /> : <Gauge className="h-3 w-3" />}
      {providerLabel(id)}
    </Badge>
  );
}

/* ---------------------------------------------------------------- 示例 */

const SAMPLE_EN = `Dear team,

Thank you for your hard work on the last release. We shipped three major features ahead of schedule, and customer feedback has been overwhelmingly positive.

Next quarter we will focus on performance. Please review the roadmap document before Friday and leave your comments there.

Best regards,
Furina`;

const SAMPLE_ZH = `各位同事：

感谢大家在上一版发布中的付出。我们比计划提前完成了三个主要功能，用户反馈也很积极。

下个季度我们重点做性能优化。请在周五之前看完路线图文档，并把意见写在文档里。

祝好
芙宁娜`;

/* ---------------------------------------------------------------- 组件 */

/**
 * 多语言翻译。
 *
 * 布局模式 A（转换对照）：翻译这个任务里「原文」和「译文」同等重要、必须互相对照，
 * 所以左右两栏对称、各占一半；顶部一条操作栏放语言选择 + 互换 + 翻译/示例/清空，
 * 下面一条放接口策略与隐私提示。译文区在分段数大于 1 时可以切成「逐句对照」。
 */
export function TranslatorTool() {
  const { toast } = useToast();

  const [input, setInput] = useToolDraft<string>("translator", "input", "");
  const [source, setSource] = useToolDraft<string>("translator", "source", "auto");
  const [target, setTarget] = useToolDraft<string>("translator", "target", "zh");
  const [providerMode, setProviderMode] = useToolDraft<ProviderMode>("translator", "providerMode", "auto");
  const [customUrl, setCustomUrl] = useToolDraft<string>("translator", "customUrl", "");
  const [autoTranslate, setAutoTranslate] = useToolDraft<boolean>("translator", "autoTranslate", true);
  const [viewMode, setViewMode] = useToolDraft<"whole" | "aligned">("translator", "viewMode", "whole");

  // ⚠️ 刻意**不用** useToolDraft：API key 是凭据，不该落到 sessionStorage 里长期驻留。
  const [apiKey, setApiKey] = useState("");
  const [showSettings, setShowSettings] = useState(false);

  const [result, setResult] = useState<TranslateSuccess | null>(null);
  const [failure, setFailure] = useState<TranslateFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  const guardRef = useRef<LatestGuard | null>(null);
  if (!guardRef.current) guardRef.current = new LatestGuard();
  const abortRef = useRef<AbortController | null>(null);

  const hasCustom = customUrl.trim() !== "";
  const chain = useMemo(
    () => buildProviderChain(source, target, providerMode, hasCustom),
    [source, target, providerMode, hasCustom],
  );

  const runTranslation = useCallback(async () => {
    const text = input.trim();
    const guard = guardRef.current as LatestGuard;
    const token = guard.begin();

    abortRef.current?.abort();
    if (text === "") {
      setResult(null);
      setFailure(null);
      setBusy(false);
      setProgress({ done: 0, total: 0 });
      return;
    }
    if (text.length > MAX_INPUT_CHARS) {
      const info = humanizeFailure("too_long", chain[0] ?? "mymemory", `${text.length} 字符`);
      setResult(null);
      setFailure({ ok: false, kind: "too_long", ...info, attempts: [] });
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setFailure(null);
    const total = splitSegments(text).length;
    setProgress({ done: 0, total });

    const outcome = await translateText({
      text,
      source,
      target,
      chain,
      custom: { url: customUrl.trim(), apiKey },
      signal: controller.signal,
      onProgress: (done, all) => {
        if (guard.isCurrent(token)) setProgress({ done, total: all });
      },
    });

    // 迟到的结果直接丢掉：不能让它覆盖后发请求的结果
    if (!guard.isCurrent(token)) return;
    setBusy(false);
    if (outcome.ok) {
      setResult(outcome);
      setFailure(null);
    } else if (outcome.kind !== "cancelled") {
      setResult(null);
      setFailure(outcome);
    }
  }, [apiKey, chain, customUrl, input, source, target]);

  const runRef = useRef(runTranslation);
  useEffect(() => {
    runRef.current = runTranslation;
  }, [runTranslation]);

  const debouncerRef = useRef<Debouncer<void> | null>(null);
  useEffect(() => {
    const debouncer = createDebouncer<void>(DEBOUNCE_MS, () => {
      void runRef.current();
    });
    debouncerRef.current = debouncer;
    return () => {
      debouncer.cancel();
      abortRef.current?.abort();
      (guardRef.current as LatestGuard).invalidate();
    };
  }, []);

  // 边打边译：输入/语言/接口一有变化就重新排一次防抖，连续敲字只会发最后一次
  useEffect(() => {
    if (!autoTranslate) return;
    if (input.trim() === "") {
      (guardRef.current as LatestGuard).invalidate();
      abortRef.current?.abort();
      setResult(null);
      setFailure(null);
      setBusy(false);
      setProgress({ done: 0, total: 0 });
      return;
    }
    debouncerRef.current?.schedule();
  }, [autoTranslate, input, source, target, providerMode, customUrl, apiKey]);

  const copyTranslation = useCallback(async () => {
    const text = result?.text ?? "";
    if (text === "") {
      toast({ title: "还没有可复制的译文", variant: "info", duration: 1800 });
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: "译文已复制到剪贴板", variant: "success", duration: 1600 });
    } catch {
      toast({ title: "复制失败", description: "浏览器拒绝了剪贴板访问，请手动选中复制", variant: "error" });
    }
  }, [result, toast]);

  const fillSample = useCallback(() => {
    // 示例的语言与目标语言相反，保证点了就能看到真正的翻译
    const useEnglish = target === "zh" || target === "zh-TW";
    setInput(useEnglish ? SAMPLE_EN : SAMPLE_ZH);
    setSource(useEnglish ? "en" : "zh");
    toast({ title: "已填入示例文本", variant: "info", duration: 1600 });
  }, [setInput, setSource, target, toast]);

  const swap = useCallback(() => {
    const nextSource = target;
    const nextTarget = source === "auto" ? (result?.detected ?? "en") : source;
    const nextInput = result?.text ?? "";
    setSource(nextSource);
    setTarget(nextTarget);
    setInput(nextInput);
    setResult(null);
    setFailure(null);
    setProgress({ done: 0, total: 0 });
    (guardRef.current as LatestGuard).invalidate();
    abortRef.current?.abort();
  }, [result, setInput, setSource, setTarget, source, target]);

  const clearAll = useCallback(() => {
    setInput("");
    setResult(null);
    setFailure(null);
    setProgress({ done: 0, total: 0 });
    (guardRef.current as LatestGuard).invalidate();
    abortRef.current?.abort();
  }, [setInput]);

  const segmentCount = useMemo(() => splitSegments(input).length, [input]);
  const sameLanguage = source !== "auto" && source === target;
  const outputText = result?.text ?? "";
  const alignedAvailable = (result?.segments.length ?? 0) > 1;

  return (
    <div className="space-y-5">
      {/* ── 顶部操作条：只放控件，不放工具名与描述（规范第 0 条） ── */}
      <div className="rounded-2xl border border-primary/20 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-[150px] space-y-1.5">
            <Label htmlFor="tr-source">原文语言</Label>
            <Select id="tr-source" value={source} onChange={(e) => setSource(e.target.value)}>
              {LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </Select>
          </div>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={swap}
            className="h-11 px-3"
            title="把原文与译文对调，并把译文当作新的原文"
          >
            <ArrowLeftRight className="h-4 w-4" />
            <span className="hidden sm:inline">互换</span>
          </Button>

          <div className="w-[150px] space-y-1.5">
            <Label htmlFor="tr-target">译文语言</Label>
            <Select id="tr-target" value={target} onChange={(e) => setTarget(e.target.value)}>
              {TARGET_LANGUAGES.map((l) => (
                <option key={l.code} value={l.code}>
                  {l.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Button type="button" onClick={() => void runTranslation()} disabled={busy || input.trim() === ""}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
              {busy ? "翻译中…" : "翻译"}
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={fillSample}>
              <Sparkles className="h-3.5 w-3.5" /> 填入示例
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={clearAll}
              className="text-muted-foreground hover:text-destructive"
            >
              <Trash2 className="h-3.5 w-3.5" /> 清空
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border-t border-border/40 pt-3">
          <div className="flex items-center gap-2">
            <Label htmlFor="tr-mode">接口</Label>
            <div className="w-[168px]">
              <Select
                id="tr-mode"
                value={providerMode}
                onChange={(e) => setProviderMode(e.target.value as ProviderMode)}
              >
                <option value="auto">自动选择（推荐）</option>
                <option value="youdao">只用有道翻译</option>
                <option value="mymemory">只用 MyMemory</option>
                <option value="custom">只用自定义接口</option>
              </Select>
            </div>
          </div>

          <Button
            type="button"
            variant={autoTranslate ? "secondary" : "ghost"}
            size="sm"
            aria-pressed={autoTranslate}
            onClick={() => setAutoTranslate(!autoTranslate)}
          >
            <Languages className="h-3.5 w-3.5" />
            {autoTranslate ? "边打边译：开" : "边打边译：关"}
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowSettings((v) => !v)}
          >
            <Link2 className="h-3.5 w-3.5" /> 接口设置
          </Button>

          <Badge variant="outline" className="ml-auto max-w-full whitespace-normal text-left">
            <AlertTriangle className="h-3 w-3 shrink-0" />
            翻译需要联网：原文会发送到第三方翻译服务（有道 / MyMemory 或你自己配置的接口）
          </Badge>
        </div>
      </div>

      {/* ── 接口设置（默认收起） ── */}
      {showSettings && (
        <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
          <div className="space-y-1">
            <Label htmlFor="tr-url">自定义翻译接口地址（可留空）</Label>
            <Input
              id="tr-url"
              value={customUrl}
              onChange={(e) => setCustomUrl(e.target.value)}
              placeholder="https://你的域名/translate"
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">
              填了就会优先用它。需要是 LibreTranslate 兼容接口：POST JSON
              {" { q, source, target, format } "}，返回 {" { translatedText } "}。自建一个
              LibreTranslate 就能完全离线、也不受公共接口限流影响。
            </p>
          </div>

          <div className="space-y-1">
            <Label htmlFor="tr-key">自定义接口的 API key（可留空）</Label>
            <Input
              id="tr-key"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="自建服务一般不需要"
              spellCheck={false}
            />
            <p className="text-xs text-muted-foreground">
              key 只保留在本次页面内存里，不会写进浏览器的会话存储。
            </p>
          </div>

          <div className="space-y-2 rounded-xl border border-border/50 bg-muted/30 p-3">
            <MetaText>当前接口顺序（前一个失败就自动换下一个）：</MetaText>
            <div className="flex flex-wrap items-center gap-2">
              {chain.length === 0 ? (
                <span className="text-xs text-destructive">链是空的 —— 请填地址，或把接口策略改回「自动选择」</span>
              ) : (
                chain.map((id, index) => (
                  <span key={id} className="flex items-center gap-2">
                    {index > 0 && <MetaText>→</MetaText>}
                    <ProviderBadge id={id} />
                  </span>
                ))
              )}
            </div>
            <p className="text-xs leading-relaxed text-muted-foreground">
              实测结论：Google 的免费接口在这台机器上 TCP 不通；Bing 的免费接口没有 CORS 头、浏览器取不到；
              公开的 LibreTranslate 实例大多已停用或要求 API key。所以默认链只有「有道 + MyMemory」两个免密钥接口。
            </p>
          </div>
        </div>
      )}

      {/* ── 左右对照两栏 ── */}
      <div className="grid gap-5 lg:grid-cols-2">
        {/* 原文 */}
        <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="tr-input">原文</Label>
            <MetaText>
              {input.length} 字符
              {segmentCount > 1 ? ` · 分 ${segmentCount} 段翻译` : ""}
            </MetaText>
            {source === "auto" && result?.detected && (
              <Badge variant="success">检测到：{languageLabel(result.detected)}</Badge>
            )}
            <div className="ml-auto">
              <Button type="button" variant="ghost" size="sm" onClick={fillSample}>
                <Sparkles className="h-3.5 w-3.5" /> 示例
              </Button>
            </div>
          </div>

          <Textarea
            id="tr-input"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="把要翻译的文字粘贴或输入到这里，支持几千字的长文本（会自动分段翻译）。"
            className="thin-scroll min-h-[300px] resize-y md:min-h-[340px]"
            spellCheck={false}
          />

          {sameLanguage && (
            <p className="text-xs text-destructive">
              源语言和目标语言都是「{languageLabel(target)}」，没有可翻译的内容，请换一个目标语言。
            </p>
          )}
          {segmentCount > MAX_SEGMENTS && (
            <p className="text-xs text-destructive">
              文本太长：需要切成 {segmentCount} 段，超过上限 {MAX_SEGMENTS} 段（约 {MAX_SEGMENTS * SEGMENT_MAX_CHARS} 字符）。
              请删掉一部分再翻译。
            </p>
          )}
        </div>

        {/* 译文 */}
        <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
          <div className="flex flex-wrap items-center gap-2">
            <Label>译文</Label>
            {result && (
              <>
                <MetaText>{result.text.length} 字符 · {result.elapsedMs} ms</MetaText>
                {result.providers.map((id) => (
                  <ProviderBadge key={id} id={id} />
                ))}
              </>
            )}
            <div className="ml-auto flex items-center gap-1">
              {alignedAvailable && (
                <Button
                  type="button"
                  variant={viewMode === "aligned" ? "secondary" : "ghost"}
                  size="sm"
                  aria-pressed={viewMode === "aligned"}
                  onClick={() => setViewMode(viewMode === "aligned" ? "whole" : "aligned")}
                >
                  {viewMode === "aligned" ? "看整段" : "逐句对照"}
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void copyTranslation()}
                disabled={outputText === ""}
              >
                <Copy className="h-3.5 w-3.5" /> 复制译文
              </Button>
            </div>
          </div>

          {busy && (
            <div className="space-y-2">
              <ProgressBar value={progress.total === 0 ? 0 : (progress.done / progress.total) * 100} />
              <MetaText>
                {progress.total > 1
                  ? `正在翻译 ${Math.min(progress.done + 1, progress.total)} / ${progress.total} 段…`
                  : "正在翻译…"}
              </MetaText>
            </div>
          )}

          {failure && !busy && (
            <ErrorBox title={failure.title} detail={failure.detail} advice={failure.advice} />
          )}

          {failure && failure.attempts.length > 1 && (
            <div className="space-y-1 rounded-xl border border-border/50 bg-muted/30 px-4 py-3">
              <MetaText>各个接口的失败原因：</MetaText>
              {failure.attempts.map((attempt, index) => (
                <p key={`${attempt.provider}-${index}`} className="text-xs text-muted-foreground">
                  · {providerLabel(attempt.provider)}：{humanizeFailure(attempt.kind, attempt.provider, attempt.detail).title}
                  {attempt.detail !== "" ? `（${attempt.detail}）` : ""}
                </p>
              ))}
            </div>
          )}

          {result && result.degraded.length > 0 && (
            <p className="text-xs text-muted-foreground">
              已自动降级：{result.degraded.map((d) => providerLabel(d.provider)).join("、")} 失败后换了下一个接口。
            </p>
          )}

          {!busy && !failure && outputText !== "" && (
            viewMode === "aligned" && alignedAvailable ? (
              <div className="thin-scroll max-h-[520px] divide-y divide-border/40 overflow-auto rounded-xl border border-border/50 bg-background/40">
                {result?.segments.map((segment, index) => (
                  <div key={index} className="space-y-1.5 px-4 py-3">
                    <p className="text-xs leading-relaxed text-muted-foreground">{segment.source}</p>
                    <p className="text-sm leading-relaxed text-foreground select-text">{segment.target}</p>
                    <MetaText>{providerLabel(segment.provider)}</MetaText>
                  </div>
                ))}
              </div>
            ) : (
              <div className={OUTPUT_AREA_CLASS}>{outputText}</div>
            )
          )}

          {!busy && !failure && outputText === "" && (
            <div className={`${OUTPUT_AREA_CLASS} flex flex-col items-center justify-center gap-3 text-center`}>
              {input.trim() === "" ? (
                <>
                  <p className="text-sm text-muted-foreground">
                    左侧输入或粘贴要翻译的文字，译文会显示在这里。
                  </p>
                  <Button type="button" variant="outline" size="sm" onClick={fillSample}>
                    <Sparkles className="h-3.5 w-3.5" /> 填入示例试试
                  </Button>
                </>
              ) : (
                <p className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Check className="h-4 w-4 text-primary" /> 已经准备好了，点「翻译」或打开「边打边译」。
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
