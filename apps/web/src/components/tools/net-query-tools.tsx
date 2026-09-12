"use client";

/**
 * 网络与图片信息类工具的自带界面（DNS 查询 / SSL 证书检查 / URL 解析 / 图片 EXIF）。
 *
 * 这四个工具走的是同一类任务：**提交一两个值 → 服务端返回一份「结构化文本报告」**。
 * 通用表单会把报告原样糊在屏幕上，用户得自己一行行读；这里做的核心工作就是
 * 把那份报告解析成结构化数据，再用贴合各自语义的布局呈现：
 *   - DNS：按记录类型分卡片（A / AAAA / CNAME / MX / NS / TXT），没查到的类型折叠成一行灰字；
 *   - SSL：顶部一张状态卡（有效/已过期/不受信任 + 剩余天数），下面两列字段清单；
 *   - URL：把原始网址按部件高亮拆解 + 字段表格 + 查询参数三列表格；
 *   - EXIF：上传区 + 缩略图，结果分「图片基本信息 / 拍摄参数 / GPS」三块字段表。
 *
 * 约定（与项目其它自带界面工具一致）：
 *   - 视觉语言只看 docs/新工具UI规范.md：卡片 rounded-2xl + border-border/70 + shadow-xs，
 *     需要高级感的地方用 bg-card/60 backdrop-blur-md，品牌点缀用 primary/10、primary/20；
 *     颜色一律走主题变量，不写死任何具体色值（只有渐变预览那种"用户选的色"才允许内联）。
 *   - 文本输入用 useToolDraft 记住；选中的文件与它派生出的 objectURL 放在模块级缓存里，
 *     按 pdf-to-images-tool 的纪律释放：**换成新的一份 / 用户清空 / 缓存被替换时释放，
 *     组件卸载（切走工具）不释放** —— 缓存持有链接，切回来预览还能用。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type FormEvent,
  type ReactNode,
} from "react";
import {
  AlertTriangle,
  ArrowRight,
  BadgeCheck,
  Check,
  Clock,
  Copy,
  Eraser,
  FileText,
  Globe,
  Globe2,
  Image as ImageIcon,
  KeyRound,
  Link2,
  Loader2,
  Mail,
  MapPin,
  Network,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Tag,
} from "lucide-react";
import { Badge, Button, Input, Label, PasteButton } from "@/components/ui/primitives";
import { FileDropzone } from "@/components/tools/file-dropzone";
import { consumePendingFiles } from "@/lib/file-handoff";
import { cn, formatBytes } from "@/lib/utils";
import { useToolDraft } from "@/lib/use-tool-draft";

// ══════════════════════════════════════════════════════════════════════════
// #region parsers
// 纯函数解析区：只做「服务端文本报告 → 结构化数据」的转换，不依赖 React / 网络 / DOM，
// 所以可以整段抽出来单独跑单元测试（见验证脚本）。
// ══════════════════════════════════════════════════════════════════════════

/** 报告里的分隔线（"─" × 34）以及同类的横线；命中就跳过，不当数据看 */
const REPORT_RULE_LINE = /^[─—–=-]{6,}$/;

// ───────────────────────────── DNS 报告 ─────────────────────────────

export type DnsRecordGroup = {
  /** 记录类型：A / AAAA / CNAME / MX / NS / TXT */
  kind: string;
  /** 括号里的中文说明，例如「IPv4 地址」 */
  label: string;
  records: string[];
};

export type DnsReport = {
  domain: string;
  queriedAt: string;
  method: string;
  /** 有记录的类别（按报告里的原有顺序） */
  groups: DnsRecordGroup[];
  /** 没有查到的类别（界面上折叠成一行灰字，不占卡片） */
  missing: DnsRecordGroup[];
  note: string;
};

const DNS_SECTION_LINE = /^【(.+?)】$/;
/** 「A 记录（IPv4 地址）」→ kind=A，label=IPv4 地址 */
const DNS_SECTION_TITLE = /^([A-Za-z0-9]+)\s*记录(?:\s*[（(](.+?)[）)])?$/;

/**
 * 解析 DNS 查询报告。
 * 容错原则：认不出来的行直接忽略，绝不抛错 —— 报告格式以后微调时界面只会少显示，
 * 不会整个工具崩掉。
 */
export function parseDnsReport(text: string): DnsReport {
  const report: DnsReport = {
    domain: "",
    queriedAt: "",
    method: "",
    groups: [],
    missing: [],
    note: "",
  };
  if (typeof text !== "string" || text.trim() === "") return report;

  const all: DnsRecordGroup[] = [];
  let current: DnsRecordGroup | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (REPORT_RULE_LINE.test(trimmed)) continue;
    if (trimmed === "DNS 查询报告") continue;

    const section = DNS_SECTION_LINE.exec(trimmed);
    if (section) {
      const title = section[1] ?? "";
      const parsed = DNS_SECTION_TITLE.exec(title);
      current = {
        kind: (parsed?.[1] ?? title).toUpperCase(),
        label: parsed?.[2] ?? "",
        records: [],
      };
      all.push(current);
      continue;
    }

    // 缩进行才是某一类记录的值；「未查询到」是占位符，丢掉（界面上由 missing 表示）
    if (/^\s{2,}\S/.test(line)) {
      if (!current) continue;
      if (trimmed === "未查询到") continue;
      current.records.push(trimmed);
      continue;
    }

    const kv = /^([^：:]{1,24})[：:](.*)$/.exec(trimmed);
    if (!kv) continue;
    const key = (kv[1] ?? "").trim();
    const value = (kv[2] ?? "").trim();
    if (key === "域名") report.domain = value;
    else if (key === "查询时间") report.queriedAt = value;
    else if (key === "查询方式") report.method = value;
    else if (key === "说明") report.note = value;
  }

  for (const group of all) {
    if (group.records.length > 0) report.groups.push(group);
    else report.missing.push(group);
  }
  return report;
}

/** ISO 时间 → 本地可读时间；解析不了就原样返回，不显示 "Invalid Date" */
export function formatQueriedAt(raw: string): string {
  if (typeof raw !== "string" || raw.trim() === "") return "";
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  return date.toLocaleString("zh-CN", { hour12: false });
}

// ───────────────────────────── SSL 报告 ─────────────────────────────

export type SslState = "valid" | "expired" | "untrusted" | "unknown";

export type SslField = { label: string; value: string; wide: boolean };

export type SslReport = {
  state: SslState;
  stateLabel: string;
  /** 状态后面括号里的补充说明，例如「剩余 133 天」「未通过：证书已过期」 */
  stateDetail: string;
  statusRaw: string;
  remainingDays: number | undefined;
  expired: boolean;
  trusted: boolean;
  /** 状态 / 剩余天数 / 是否已过期 已经由状态卡承担，不进字段清单 */
  fields: SslField[];
  san: string[];
  sanCount: number;
  sanDeclared: boolean;
  issuerChain: string;
};

/** 这些字段太长，放在两列网格里要独占一整行 */
const SSL_WIDE_HINTS = ["全称", "颁发者", "指纹", "序列号"];

export function parseSslReport(text: string): SslReport {
  const report: SslReport = {
    state: "unknown",
    stateLabel: "未知",
    stateDetail: "",
    statusRaw: "",
    remainingDays: undefined,
    expired: false,
    trusted: false,
    fields: [],
    san: [],
    sanCount: 0,
    sanDeclared: true,
    issuerChain: "",
  };
  if (typeof text !== "string" || text.trim() === "") return report;

  let inSan = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (REPORT_RULE_LINE.test(trimmed)) continue;

    if (inSan && /^\s{2,}\S/.test(line)) {
      if (trimmed === "（证书未声明 SAN 扩展）") report.sanDeclared = false;
      else report.san.push(trimmed);
      continue;
    }
    inSan = false;

    if (!trimmed.includes("：")) continue;
    const index = trimmed.indexOf("：");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();

    if (key === "状态") {
      report.statusRaw = value;
      continue;
    }
    if (/^SAN\s*(?:里的)?域名/.test(key)) {
      inSan = true;
      const count = /共\s*(\d+)\s*个/.exec(key);
      report.sanCount = count ? Number(count[1]) : 0;
      // 有的写法把 SAN 直接列在同一行（逗号分隔），一并接住
      const inline = value.replace(/^[：:]/, "").trim();
      if (inline !== "" && !inline.startsWith("（")) {
        for (const item of inline.split(/[,，、\s]+/)) {
          if (item !== "") report.san.push(item);
        }
        if (report.sanCount === 0) report.sanCount = report.san.length;
      }
      continue;
    }
    if (key === "签发链上一级") {
      report.issuerChain = value;
      continue;
    }
    if (key === "剩余天数") {
      const days = /(-?\d+)\s*天/.exec(value);
      if (days) report.remainingDays = Number(days[1]);
      continue;
    }
    if (key === "是否已过期") {
      if (value === "是") report.expired = true;
      continue;
    }
    report.fields.push({
      label: key,
      value,
      wide: SSL_WIDE_HINTS.some((hint) => key.includes(hint)),
    });
  }

  // 链校验结论：不同版本报告里叫「证书链是否可验证」或「证书链状态」
  const trustField = report.fields.find((field) => field.label.includes("证书链"));
  if (trustField) report.trusted = !/未通过|不受信任/.test(trustField.value);

  const statusExpired = /过期/.test(report.statusRaw);
  const statusUntrusted = /不受信任/.test(report.statusRaw);
  if (statusExpired) report.expired = true;
  if (report.remainingDays === undefined) {
    const remaining = /剩余\s*(\d+)\s*天/.exec(report.statusRaw);
    if (remaining) report.remainingDays = Number(remaining[1]);
  }

  const untrusted = statusUntrusted || (trustField ? !report.trusted : false);
  const hasVerdict = report.statusRaw !== "" || Boolean(trustField);
  if (!hasVerdict) report.state = "unknown";
  else if (untrusted) report.state = "untrusted";
  else if (report.expired) report.state = "expired";
  else report.state = "valid";

  if (report.state === "unknown") report.stateLabel = "未知";
  else if (untrusted && report.expired) report.stateLabel = "已过期 · 不受信任";
  else if (untrusted) report.stateLabel = "不受信任";
  else if (report.expired) report.stateLabel = "已过期";
  else report.stateLabel = "有效";

  const detail = /^[^（(]*[（(](.+?)[）)]\s*$/.exec(report.statusRaw);
  report.stateDetail = detail?.[1]?.trim() ?? "";

  return report;
}

// ───────────────────────────── URL 报告 ─────────────────────────────

export type UrlSegmentKind =
  | "protocol"
  | "userinfo"
  | "host"
  | "port"
  | "path"
  | "query"
  | "hash"
  | "plain";

export type UrlSegment = { text: string; kind: UrlSegmentKind };

export type UrlField = { label: string; value: string; empty: boolean };

export type UrlQueryParam = {
  name: string;
  /** 解码后的值（"+" 会变成空格） */
  decoded: string;
  /** 原始未解码的写法（"%20"、"+" 原样保留） */
  raw: string;
  /** 原始写法与解码值不同 —— 界面上要做个小标记提示 */
  differs: boolean;
};

export type UrlReport = {
  raw: string;
  fields: UrlField[];
  normalized: UrlField[];
  params: UrlQueryParam[];
  encoded: string;
};

function isEmptyUrlValue(value: string): boolean {
  return value === "（无）" || value === "（未指定）" || value === "";
}

/**
 * 把原始网址切成「部件片段」，用于顶部的高亮拆解。
 * 关键是**按原始字符串切**而不是重新拼：拼接会把用户写的 `%20`、`+`、大小写吃掉，
 * 而用户恰恰要看清自己写的那一串。切完后 join("") 一定等于输入（单测里有断言）。
 */
export function segmentUrl(raw: string): UrlSegment[] {
  const segments: UrlSegment[] = [];
  if (typeof raw !== "string") return segments;
  const value = raw.trim();
  if (value === "") return segments;

  const push = (text: string, kind: UrlSegmentKind): void => {
    if (text !== "") segments.push({ text, kind });
  };

  let rest = value;
  const scheme = /^([A-Za-z][A-Za-z0-9+.-]*:)/.exec(rest);
  if (scheme?.[1]) {
    push(scheme[1], "protocol");
    rest = rest.slice(scheme[1].length);
  }

  let hasAuthority = false;
  if (rest.startsWith("//")) {
    hasAuthority = true;
    push("//", "plain");
    rest = rest.slice(2);
  }

  let hash = "";
  const hashAt = rest.indexOf("#");
  if (hashAt !== -1) {
    hash = rest.slice(hashAt);
    rest = rest.slice(0, hashAt);
  }
  let query = "";
  const queryAt = rest.indexOf("?");
  if (queryAt !== -1) {
    query = rest.slice(queryAt);
    rest = rest.slice(0, queryAt);
  }

  let authority = "";
  let path = rest;
  if (hasAuthority) {
    const slash = rest.indexOf("/");
    authority = slash === -1 ? rest : rest.slice(0, slash);
    path = slash === -1 ? "" : rest.slice(slash);
  }

  const at = authority.lastIndexOf("@");
  let hostPart = authority;
  if (at !== -1) {
    push(authority.slice(0, at), "userinfo");
    push("@", "plain");
    hostPart = authority.slice(at + 1);
  }

  if (hostPart.startsWith("[")) {
    // IPv6 字面量：[::1]:8080
    const close = hostPart.indexOf("]");
    if (close === -1) {
      push(hostPart, "host");
    } else {
      push(hostPart.slice(0, close + 1), "host");
      const tail = hostPart.slice(close + 1);
      if (tail.startsWith(":")) {
        push(":", "plain");
        push(tail.slice(1), "port");
      } else {
        push(tail, "host");
      }
    }
  } else {
    const colon = hostPart.indexOf(":");
    if (colon === -1) push(hostPart, "host");
    else {
      push(hostPart.slice(0, colon), "host");
      push(":", "plain");
      push(hostPart.slice(colon + 1), "port");
    }
  }

  push(path, "path");
  push(query, "query");
  push(hash, "hash");
  return segments;
}

/** 解析 URL 解析报告（服务端文本） */
export function parseUrlReport(text: string): UrlReport {
  const report: UrlReport = { raw: "", fields: [], normalized: [], params: [], encoded: "" };
  if (typeof text !== "string" || text.trim() === "") return report;

  let mode: "header" | "params" | "normalized" | "encoded" = "header";
  let pending: UrlQueryParam | null = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (REPORT_RULE_LINE.test(trimmed)) continue;
    if (trimmed === "URL 解析结果") continue;

    if (/^查询参数（共\s*\d+\s*个）[：:]?$/.test(trimmed)) {
      mode = "params";
      continue;
    }
    if (/^各组件重新编码后的结果[：:]?$/.test(trimmed)) {
      mode = "normalized";
      continue;
    }
    if (/encodeURIComponent 编码后的整串/.test(trimmed)) {
      mode = "encoded";
      continue;
    }
    if (mode === "encoded") {
      report.encoded = trimmed;
      continue;
    }
    if (mode === "params") {
      if (trimmed === "（没有查询参数）") continue;
      const rawValue = /^原始未解码值[：:](.*)$/.exec(trimmed);
      if (rawValue) {
        if (pending) {
          const value = (rawValue[1] ?? "").trim();
          pending.raw = value === "（空）" ? "" : value;
        }
        continue;
      }
      const eq = trimmed.indexOf(" = ");
      if (eq === -1) continue;
      const name = trimmed.slice(0, eq).trim();
      const decoded = trimmed.slice(eq + 3).trim();
      const param: UrlQueryParam = {
        name,
        decoded: decoded === "（空值）" ? "" : decoded,
        raw: "",
        differs: false,
      };
      report.params.push(param);
      pending = param;
      continue;
    }

    const index = trimmed.indexOf("：");
    if (index === -1) continue;
    const label = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (mode === "header" && label === "原始输入") {
      report.raw = value;
      continue;
    }
    const field: UrlField = { label, value, empty: isEmptyUrlValue(value) };
    if (mode === "header") report.fields.push(field);
    else report.normalized.push(field);
  }

  for (const param of report.params) param.differs = param.raw !== param.decoded;
  return report;
}

// ───────────────────────────── EXIF 报告 ─────────────────────────────

export type ExifField = { label: string; value: string };

export type ExifGroup = { title: string; count: number; fields: ExifField[] };

export type ExifGps = {
  decimal?: string;
  latitude?: string;
  longitude?: string;
  altitude?: string;
};

export type ExifReport = {
  hasExif: boolean;
  /** 没有 EXIF 时报告首行给的那句说明 */
  noExifMessage: string;
  /** 文件名 / 格式 / 大小 / 尺寸 */
  basic: ExifField[];
  /** 拍摄参数：Exif 子目录的全部字段 + 其它目录里的相机/镜头/时间等关键项 */
  shoot: ExifField[];
  gps: ExifGps | undefined;
  /** GPS 分组里的原始字段（参考/时间等），单独列出来 */
  gpsFields: ExifField[];
  /** 没被「拍摄参数」消费掉的其它分组 */
  extra: ExifGroup[];
  summary: string;
  notes: string[];
};

/** 这些标签虽然不在 Exif 子目录里，但属于「拍摄参数」，提到主表里更顺手 */
const EXIF_SHOOT_LABELS = [
  "相机制造商",
  "相机型号",
  "方向",
  "镜头制造商",
  "镜头型号",
  "原始拍摄时间",
  "数字化时间",
  "生成软件",
  "文件修改时间",
  "图像描述",
];

const EXIF_GROUP_LINE = /^【(.+?)】共\s*(\d+)\s*项$/;
const EXIF_GPS_LABELS = ["十进制度数", "纬度", "经度", "海拔"];

/**
 * 解析图片信息报告。两种形态都要认：
 *   ① 有 EXIF：摘要 + 若干【分组】共 N 项 + 缩进的「标签：值」；
 *   ② 没有 EXIF：首行「这张图片没有 EXIF 信息（……）」+ 格式/大小/尺寸。
 */
export function parseExifReport(text: string): ExifReport {
  const report: ExifReport = {
    hasExif: false,
    noExifMessage: "",
    basic: [],
    shoot: [],
    gps: undefined,
    gpsFields: [],
    extra: [],
    summary: "",
    notes: [],
  };
  if (typeof text !== "string" || text.trim() === "") return report;

  const groups: ExifGroup[] = [];
  let current: ExifGroup | null = null;
  let inNotes = false;
  let sawGroup = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (REPORT_RULE_LINE.test(trimmed)) continue;

    if (!sawGroup && trimmed.includes("没有 EXIF 信息")) {
      report.noExifMessage = trimmed;
      continue;
    }
    if (/^图片信息$/.test(trimmed)) continue;

    if (/^解析备注[：:]?$/.test(trimmed)) {
      inNotes = true;
      continue;
    }
    if (inNotes) {
      report.notes.push(trimmed);
      continue;
    }

    const header = EXIF_GROUP_LINE.exec(trimmed);
    if (header) {
      current = { title: header[1] ?? "", count: Number(header[2] ?? 0), fields: [] };
      groups.push(current);
      sawGroup = true;
      continue;
    }

    const index = trimmed.indexOf("：");
    if (index === -1) continue;
    const label = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();

    if (label === "摘要") {
      report.summary = value;
      continue;
    }
    if (current) {
      current.fields.push({ label, value });
      continue;
    }
    // 分组之前的顶层字段就是「图片基本信息」
    report.basic.push({ label, value });
  }

  report.hasExif = groups.some((group) => group.fields.length > 0);
  if (!report.hasExif) return report;

  const consumed = new Set<string>();
  const shoot: ExifField[] = [];

  for (const group of groups) {
    const isExifGroup = group.title.includes("Exif 子目录");
    for (const field of group.fields) {
      if (isExifGroup || EXIF_SHOOT_LABELS.includes(field.label)) {
        shoot.push(field);
        consumed.add(`${group.title}\u0000${field.label}`);
      }
    }
  }

  const gps: ExifGps = {};
  for (const group of groups) {
    if (!group.title.includes("GPS")) continue;
    for (const field of group.fields) {
      consumed.add(`${group.title}\u0000${field.label}`);
      if (!EXIF_GPS_LABELS.includes(field.label)) {
        report.gpsFields.push(field);
        continue;
      }
      if (field.label === "十进制度数") gps.decimal = field.value;
      else if (field.label === "纬度") gps.latitude = field.value;
      else if (field.label === "经度") gps.longitude = field.value;
      else if (field.label === "海拔") gps.altitude = field.value;
    }
  }
  if (Object.keys(gps).length > 0) report.gps = gps;

  report.shoot = shoot;
  for (const group of groups) {
    const rest = group.fields.filter((field) => !consumed.has(`${group.title}\u0000${field.label}`));
    if (rest.length === 0) continue;
    report.extra.push({ title: group.title, count: rest.length, fields: rest });
  }

  return report;
}

// #endregion parsers

// ══════════════════════════════════════════════════════════════════════════
// 请求与通用小件
// ══════════════════════════════════════════════════════════════════════════

type ToolResponse =
  | { kind: "text"; text: string; filename: string }
  | { kind: "file"; blob: Blob; filename: string };

/**
 * 调用同步工具接口。四个工具都是「一次请求一次结果」，所以这里不做重试、不做队列，
 * 只把「错误提示是人话」这件事办到：HTTP 非 2xx 时后端一定返回 { error: "中文提示" }。
 */
async function postTool(toolId: string, formData: FormData): Promise<ToolResponse> {
  let response: Response;
  try {
    response = await fetch(`/api/tools/${toolId}`, { method: "POST", body: formData });
  } catch {
    throw new Error("连不上本地服务，请确认左下角显示「服务运行中」后重试");
  }

  const contentType = response.headers.get("content-type") || "";
  if (!response.ok || contentType.includes("application/json")) {
    const data = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error || `请求失败（HTTP ${response.status}）`);
  }

  const rawName = response.headers.get("x-result-filename") || "result";
  let filename = rawName;
  try {
    filename = decodeURIComponent(rawName);
  } catch {
    filename = rawName;
  }
  const kind = (response.headers.get("x-result-kind") as "text" | "file" | null) || "file";
  if (kind === "text") return { kind: "text", text: await response.text(), filename };
  return { kind: "file", blob: await response.blob(), filename };
}

/** 规范第五节的错误样式，全项目统一 */
function ToolError({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border-l-4 border-l-destructive bg-destructive/10 px-4 py-3 font-mono text-xs text-destructive">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      {message}
    </div>
  );
}

/** 一行小字提示（不是错误，用于「未查询到」这类中性说明） */
function HintLine({ children }: { children: ReactNode }) {
  return <p className="text-xs leading-relaxed text-muted-foreground">{children}</p>;
}

function CopyButton({
  text,
  label = "复制",
  className,
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const [state, setState] = useState<"idle" | "done" | "fail">("idle");

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState("done");
    } catch {
      setState("fail");
    }
    setTimeout(() => setState("idle"), 1800);
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={copy}
      disabled={text === "" || state === "fail"}
      className={className}
    >
      {state === "done" ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
      {state === "fail" ? "请手动复制" : state === "done" ? "已复制" : label}
    </Button>
  );
}

/** 加载骨架：网络类工具在等的时候必须让用户看得出「在等」 */
function SkeletonBlock({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2.5" aria-hidden>
      {Array.from({ length: rows }).map((_, index) => (
        <div
          key={index}
          className="h-4 animate-pulse rounded-md bg-muted"
          style={{ width: `${100 - index * 11}%` }}
        />
      ))}
    </div>
  );
}

/** 「填入示例 / 清空」这一对按钮，四个工具都有 */
function ExampleActions({
  onExample,
  onClear,
  disabled,
  exampleLabel = "填入示例",
}: {
  onExample: () => void;
  onClear: () => void;
  disabled?: boolean;
  exampleLabel?: string;
}) {
  return (
    <div className="flex items-center gap-2">
      {/* 示例只在空闲时可点（正在查询时换掉输入框会让结果与输入对不上）；清空随时可用，用来中断等待 */}
      <Button type="button" variant="outline" size="sm" onClick={onExample} disabled={disabled}>
        <Sparkles className="h-3.5 w-3.5" />
        {exampleLabel}
      </Button>
      <Button type="button" variant="ghost" size="sm" onClick={onClear}>
        <Eraser className="h-3.5 w-3.5" />
        清空
      </Button>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// 1. DNS 查询
// ══════════════════════════════════════════════════════════════════════════

/** 每类记录给一个小图标：A 是地址、MX 是邮件、NS 是服务器……比清一色圆点好认 */
const DNS_KIND_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  A: Network,
  AAAA: Globe2,
  CNAME: Link2,
  MX: Mail,
  NS: Server,
  TXT: FileText,
};

export function DnsLookupTool() {
  const [domain, setDomain] = useToolDraft("dns-lookup", "domain", "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<DnsReport | null>(null);

  /** 请求序号：只有最后一次请求的结果才允许落到界面上（用户连点两次时不会错乱） */
  const requestIdRef = useRef(0);

  const run = useCallback(
    async (value: string) => {
      const target = value.trim();
      if (target === "") {
        setError("请输入要查询的域名，例如 example.com");
        setReport(null);
        return;
      }
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setBusy(true);
      setError(null);
      try {
        const formData = new FormData();
        formData.append("domain", target);
        const response = await postTool("dns-lookup", formData);
        if (requestIdRef.current !== requestId) return;
        if (response.kind !== "text") throw new Error("查询返回了意外的内容，请稍后重试");
        setReport(parseDnsReport(response.text));
      } catch (err) {
        if (requestIdRef.current !== requestId) return;
        setReport(null);
        setError(err instanceof Error ? err.message : "查询失败，请检查网络后重试");
      } finally {
        if (requestIdRef.current === requestId) setBusy(false);
      }
    },
    [],
  );

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void run(domain);
  };

  const clear = () => {
    requestIdRef.current += 1;
    setDomain("");
    setReport(null);
    setError(null);
    setBusy(false);
  };

  const found = report?.groups ?? [];
  const queriedAt = report ? formatQueriedAt(report.queriedAt) : "";
  const totalRecords = found.reduce((sum, group) => sum + group.records.length, 0);

  return (
    <div className="space-y-4">
      <form
        onSubmit={handleSubmit}
        className="space-y-3 rounded-2xl border border-border/70 bg-card p-5 shadow-xs"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="dns-domain">要查询的域名</Label>
            <Badge>只读查询 · 不改动域名</Badge>
          </div>
          <ExampleActions onExample={() => setDomain("example.com")} onClear={clear} disabled={busy} />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative w-full">
            <Input
              id="dns-domain"
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              placeholder="example.com（不用带 http://）"
              autoComplete="off"
              spellCheck={false}
              className="pr-24 font-mono text-sm"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <PasteButton onPaste={(text) => setDomain(text.trim())} />
            </div>
          </div>
          <Button type="submit" disabled={busy} className="sm:w-32">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {busy ? "查询中…" : "查询"}
          </Button>
        </div>
        <HintLine>
          查询由本机 Node 运行时直接发出，只读取公开的 DNS 记录，不会访问网站内容。
        </HintLine>
      </form>

      {error ? <ToolError message={error} /> : null}

      {busy ? (
        <div className="grid gap-4 sm:grid-cols-2">
          {[0, 1].map((index) => (
            <div
              key={index}
              className="space-y-3 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-xs backdrop-blur-md"
            >
              <div className="flex items-center gap-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                <span className="text-xs text-muted-foreground">正在查询…</span>
              </div>
              <SkeletonBlock rows={3} />
            </div>
          ))}
        </div>
      ) : null}

      {!busy && !report && !error ? (
        <div className="space-y-3 rounded-2xl border border-dashed border-border/70 bg-card/40 px-6 py-12 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Globe className="h-5 w-5" />
          </span>
          <p className="text-sm font-medium text-foreground">还没有查询结果</p>
          <p className="mx-auto max-w-md text-xs leading-relaxed text-muted-foreground">
            输入一个域名后开始查询，也可以先用「填入示例」载入 example.com。
          </p>
        </div>
      ) : null}

      {!busy && report ? (
        <div className="space-y-4">
          {/* 域名 + 查询时间的信息条 */}
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 rounded-2xl border border-border/70 bg-card/60 p-4 shadow-xs backdrop-blur-md">
            <div className="flex items-center gap-2">
              <Globe className="h-4 w-4 text-primary" />
              <span className="font-mono text-sm font-semibold text-foreground">
                {report.domain || "（报告里没写域名）"}
              </span>
            </div>
            {queriedAt ? (
              <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3.5 w-3.5" />
                查询时间 {queriedAt}
              </span>
            ) : null}
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Tag className="h-3.5 w-3.5" />
              命中 {found.length} / {found.length + (report.missing.length || 0)} 类 · 共 {totalRecords} 条记录
            </span>
          </div>

          {found.length === 0 ? (
            <div className="space-y-3 rounded-2xl border border-dashed border-border/70 bg-card/40 px-6 py-12 text-center">
              <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <Search className="h-5 w-5" />
              </span>
              <p className="text-sm font-medium text-foreground">这个域名没有任何可解析的记录</p>
              <p className="mx-auto max-w-md text-xs leading-relaxed text-muted-foreground">
                先确认域名拼写是否正确（别把斜杠、空格、http:// 带进来）。
                如果域名刚刚解析、或用了新的 DNS 服务器，本地缓存可能需要几分钟才更新。
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              {found.map((group) => {
                const Icon = DNS_KIND_ICONS[group.kind] ?? Network;
                return (
                  <div
                    key={group.kind + group.label}
                    className="space-y-3 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-xs backdrop-blur-md"
                  >
                    <div className="flex items-center justify-between gap-2 border-b border-border/50 pb-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                          <Icon className="h-3.5 w-3.5" />
                        </span>
                        <Badge>{group.kind}</Badge>
                        {group.label ? (
                          <span className="truncate text-xs text-muted-foreground">{group.label}</span>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="font-mono-accent text-[10px] uppercase tracking-widest text-muted-foreground">
                          {group.records.length} 条
                        </span>
                        <CopyButton text={group.records.join("\n")} />
                      </div>
                    </div>
                    <ul className="space-y-1.5">
                      {group.records.map((record) => (
                        <li
                          key={record}
                          className="rounded-lg border border-border/40 bg-muted/30 px-2.5 py-1.5 font-mono text-xs leading-relaxed break-all text-foreground"
                        >
                          {record}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}

          {report.missing.length > 0 && found.length > 0 ? (
            <HintLine>
              <span className="text-muted-foreground/80">未查询到：</span>
              {report.missing.map((group) => group.kind).join("、")}
              <span className="text-muted-foreground/80">
                {" "}
                —— CNAME / MX / TXT 等记录对很多域名本来就不存在，属于正常结果。
              </span>
            </HintLine>
          ) : null}

          {report.note ? <HintLine>{report.note}</HintLine> : null}
        </div>
      ) : null}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// 2. SSL 证书检查
// ══════════════════════════════════════════════════════════════════════════

/** 状态卡上的大号天数：有效 → 剩余天数，已过期 → 已过期天数，未知 → — */
function daysCaption(report: SslReport): { value: string; unit: string; caption: string } {
  const days = report.remainingDays;
  if (report.state === "unknown" || days === undefined) {
    return { value: "—", unit: "", caption: "无法计算剩余天数（证书时间字段缺失）" };
  }
  if (report.state === "expired" || days < 0) {
    return { value: String(Math.abs(days)), unit: "天", caption: "证书已过期" };
  }
  return { value: String(days), unit: "天", caption: "证书剩余有效期" };
}

export function SslCheckerTool() {
  const [domain, setDomain] = useToolDraft("ssl-checker", "domain", "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<SslReport | null>(null);
  const requestIdRef = useRef(0);

  const run = useCallback(async (value: string) => {
    const target = value.trim();
    if (target === "") {
      setError("请输入要检查的域名，例如 www.baidu.com");
      setReport(null);
      return;
    }
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setBusy(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("domain", target);
      const response = await postTool("ssl-checker", formData);
      if (requestIdRef.current !== requestId) return;
      if (response.kind !== "text") throw new Error("检查返回了意外的内容，请稍后重试");
      setReport(parseSslReport(response.text));
    } catch (err) {
      if (requestIdRef.current !== requestId) return;
      setReport(null);
      setError(err instanceof Error ? err.message : "检查失败，请稍后重试");
    } finally {
      if (requestIdRef.current === requestId) setBusy(false);
    }
  }, []);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void run(domain);
  };

  const clear = () => {
    requestIdRef.current += 1;
    setDomain("");
    setReport(null);
    setError(null);
    setBusy(false);
  };

  const days = report ? daysCaption(report) : null;
  const isGood = report?.state === "valid";
  const statusTone = isGood
    ? "border-success/30 bg-gradient-to-r from-success/10 via-success/5 to-transparent"
    : "border-destructive/30 bg-gradient-to-r from-destructive/10 via-destructive/5 to-transparent";
  const statusText = isGood ? "text-success" : "text-destructive";
  const StatusIcon = isGood ? ShieldCheck : ShieldAlert;
  const validRatio =
    report && report.remainingDays !== undefined && report.remainingDays > 0
      ? Math.min(100, Math.max(4, (report.remainingDays / 365) * 100))
      : 0;

  return (
    <div className="space-y-4">
      <form
        onSubmit={handleSubmit}
        className="space-y-3 rounded-2xl border border-border/70 bg-card p-5 shadow-xs"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="ssl-domain">要检查的域名</Label>
            <Badge>只做握手 · 不抓取网页</Badge>
          </div>
          <ExampleActions onExample={() => setDomain("www.baidu.com")} onClear={clear} disabled={busy} />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative w-full">
            <Input
              id="ssl-domain"
              value={domain}
              onChange={(event) => setDomain(event.target.value)}
              placeholder="www.baidu.com（可带 :端口）"
              autoComplete="off"
              spellCheck={false}
              className="pr-24 font-mono text-sm"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <PasteButton onPaste={(text) => setDomain(text.trim())} />
            </div>
          </div>
          <Button type="submit" disabled={busy} className="sm:w-36">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
            {busy ? "检查中…" : "检查证书"}
          </Button>
        </div>
        <HintLine>
          证书链会做一次真校验：不受信任时会给出具体原因（自签名、过期、域名不匹配等）。
        </HintLine>
      </form>

      {error ? <ToolError message={error} /> : null}

      {busy ? (
        <div className="space-y-4 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-xs backdrop-blur-md">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            正在建立 TLS 连接并读取证书，最长约 15 秒…
          </div>
          <SkeletonBlock rows={5} />
        </div>
      ) : null}

      {!busy && !report && !error ? (
        <div className="space-y-3 rounded-2xl border border-dashed border-border/70 bg-card/40 px-6 py-12 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ShieldCheck className="h-5 w-5" />
          </span>
          <p className="text-sm font-medium text-foreground">还没有检查结果</p>
          <p className="mx-auto max-w-md text-xs leading-relaxed text-muted-foreground">
            填入域名后点击「检查证书」，最上方会显示有效 / 已过期 / 不受信任的大号结论与剩余天数。
          </p>
        </div>
      ) : null}

      {!busy && report ? (
        <div className="space-y-4">
          {/* 状态卡：结论 + 剩余天数 */}
          <div className={cn("rounded-2xl border p-5 shadow-sm", statusTone)}>
            <div className="flex flex-wrap items-center justify-between gap-5">
              <div className="flex min-w-0 items-center gap-3">
                <span
                  className={cn(
                    "flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-card/70",
                    statusText,
                  )}
                >
                  <StatusIcon className="h-6 w-6" />
                </span>
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("text-2xl font-bold tracking-tight", statusText)}>
                      {report.stateLabel}
                    </span>
                    <Badge variant={isGood ? "success" : "outline"} className={isGood ? "" : statusText}>
                      {report.statusRaw || "报告里没有状态行"}
                    </Badge>
                  </div>
                  {report.stateDetail ? (
                    <p className="text-xs leading-relaxed text-muted-foreground">{report.stateDetail}</p>
                  ) : null}
                </div>
              </div>

              {days ? (
                <div className="min-w-[8rem] space-y-1 text-right">
                  <div className="flex items-end justify-end gap-1">
                    <span className={cn("text-4xl font-bold leading-none tracking-tight", statusText)}>
                      {days.value}
                    </span>
                    {days.unit ? (
                      <span className={cn("pb-0.5 text-sm font-semibold", statusText)}>{days.unit}</span>
                    ) : null}
                  </div>
                  <p className="text-[11px] text-muted-foreground">{days.caption}</p>
                  {validRatio > 0 ? (
                    <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
                      <div
                        className="h-full rounded-full bg-success transition-[width] duration-500 ease-out"
                        style={{ width: `${validRatio}%` }}
                      />
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>

            {report.state === "valid" && report.remainingDays !== undefined && report.remainingDays <= 30 ? (
              <p className="mt-4 flex items-center gap-1.5 text-xs text-destructive">
                <AlertTriangle className="h-3.5 w-3.5" />
                距离到期不足 30 天，建议尽快续期（部分客户端对即将过期的证书会直接报错）。
              </p>
            ) : null}
          </div>

          {/* 字段清单：左标签灰字，右值等宽，长文本独占一行并自动换行 */}
          <div className="space-y-4 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-xs backdrop-blur-md">
            <div className="flex items-center gap-2 border-b border-border/50 pb-3">
              <BadgeCheck className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold text-foreground">证书字段</h3>
              <span className="text-xs text-muted-foreground">共 {report.fields.length} 项</span>
            </div>
            {report.fields.length === 0 ? (
              <HintLine>报告里没有可展示的证书字段。</HintLine>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2">
                {report.fields.map((field) => (
                  <div
                    key={field.label}
                    className={cn("min-w-0 space-y-1", field.wide && "sm:col-span-2")}
                  >
                    <div className="text-[11px] font-medium tracking-wide text-muted-foreground">
                      {field.label}
                    </div>
                    <div className="font-mono text-xs leading-relaxed break-all text-foreground">
                      {field.value || "（无）"}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* SAN 域名 */}
          <div className="space-y-3 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-xs backdrop-blur-md">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
              <div className="flex items-center gap-2">
                <KeyRound className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">SAN 域名（证书保护范围）</h3>
                <span className="text-xs text-muted-foreground">
                  共 {report.sanCount || report.san.length} 个
                </span>
              </div>
              <CopyButton text={report.san.join("\n")} />
            </div>
            {report.san.length === 0 ? (
              <HintLine>
                {report.sanDeclared
                  ? "证书没有声明 SAN 扩展，浏览器会退回用证书主体(CN)匹配域名。"
                  : "证书未声明 SAN 扩展。"}
              </HintLine>
            ) : (
              <div className="flex flex-wrap gap-2">
                {report.san.map((item) => (
                  <Badge key={item} variant="outline" className="font-mono">
                    {item}
                  </Badge>
                ))}
              </div>
            )}
            {report.issuerChain ? (
              <div className="min-w-0 space-y-1 border-t border-border/40 pt-3">
                <div className="text-[11px] font-medium tracking-wide text-muted-foreground">
                  签发链上一级
                </div>
                <div className="font-mono text-xs leading-relaxed break-all text-foreground">
                  {report.issuerChain}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// 3. URL 解析
// ══════════════════════════════════════════════════════════════════════════

/** 高亮配色：全部走主题变量，三套主题下都协调 */
const URL_SEGMENT_CLASS: Record<UrlSegmentKind, string> = {
  protocol: "text-muted-foreground",
  userinfo: "rounded bg-primary/20 px-1 text-primary",
  host: "rounded bg-primary/10 px-1 font-semibold text-primary",
  port: "rounded bg-primary/10 px-1 text-primary/80",
  path: "rounded bg-muted px-1 text-foreground",
  query: "rounded bg-accent px-1 text-accent-foreground",
  hash: "rounded bg-secondary px-1 text-muted-foreground",
  plain: "text-muted-foreground",
};

const URL_LEGEND: { kind: UrlSegmentKind; label: string; swatch: string }[] = [
  { kind: "protocol", label: "协议", swatch: "bg-muted" },
  { kind: "userinfo", label: "用户名/密码", swatch: "bg-primary/30" },
  { kind: "host", label: "主机名", swatch: "bg-primary/20" },
  { kind: "port", label: "端口", swatch: "bg-primary/10" },
  { kind: "path", label: "路径", swatch: "bg-muted" },
  { kind: "query", label: "查询串", swatch: "bg-accent" },
  { kind: "hash", label: "锚点", swatch: "bg-secondary" },
];

export function UrlParserTool() {
  const [url, setUrl] = useToolDraft("url-parser", "url", "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<UrlReport | null>(null);
  const requestIdRef = useRef(0);

  const run = useCallback(async (value: string) => {
    const target = value.trim();
    if (target === "") {
      setError("请输入完整的网址（要带 http:// 或 https://）");
      setReport(null);
      return;
    }
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setBusy(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("url", target);
      const response = await postTool("url-parser", formData);
      if (requestIdRef.current !== requestId) return;
      if (response.kind !== "text") throw new Error("解析返回了意外的内容，请稍后重试");
      setReport(parseUrlReport(response.text));
    } catch (err) {
      if (requestIdRef.current !== requestId) return;
      setReport(null);
      setError(err instanceof Error ? err.message : "解析失败，请稍后重试");
    } finally {
      if (requestIdRef.current === requestId) setBusy(false);
    }
  }, []);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    void run(url);
  };

  const clear = () => {
    requestIdRef.current += 1;
    setUrl("");
    setReport(null);
    setError(null);
    setBusy(false);
  };

  const segments = useMemo(() => (report ? segmentUrl(report.raw) : []), [report]);
  const params = report?.params ?? [];

  return (
    <div className="space-y-4">
      <form
        onSubmit={handleSubmit}
        className="space-y-3 rounded-2xl border border-border/70 bg-card p-5 shadow-xs"
      >
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="url-input">要解析的网址</Label>
            <Badge>纯文本解析 · 不发起访问</Badge>
          </div>
          <ExampleActions
            onExample={() =>
              setUrl("https://furina:kit@example.com:8443/docs/guide?a=hello+world&b=%E4%B8%AD%E6%96%87&c=#top")
            }
            onClear={clear}
            disabled={busy}
          />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative w-full">
            <Input
              id="url-input"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="https://example.com/path?a=1&b=2#top"
              autoComplete="off"
              spellCheck={false}
              className="pr-24 font-mono text-sm"
            />
            <div className="absolute right-3 top-1/2 -translate-y-1/2">
              <PasteButton onPaste={(text) => setUrl(text.trim())} />
            </div>
          </div>
          <Button type="submit" disabled={busy} className="sm:w-28">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            {busy ? "解析中…" : "解析"}
          </Button>
        </div>
        <HintLine>
          网址需要带 http:// 或 https:// 前缀，未写协议时不做解析。
        </HintLine>
      </form>

      {error ? <ToolError message={error} /> : null}

      {busy ? (
        <div className="space-y-3 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-xs backdrop-blur-md">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            正在解析网址…
          </div>
          <SkeletonBlock rows={4} />
        </div>
      ) : null}

      {!busy && !report && !error ? (
        <div className="space-y-3 rounded-2xl border border-dashed border-border/70 bg-card/40 px-6 py-12 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Link2 className="h-5 w-5" />
          </span>
          <p className="text-sm font-medium text-foreground">还没有解析结果</p>
          <p className="mx-auto max-w-md text-xs leading-relaxed text-muted-foreground">
            粘贴一条带查询参数的网址后开始解析，也可以先用「填入示例」载入示例网址。
          </p>
        </div>
      ) : null}

      {!busy && report ? (
        <div className="space-y-4">
          {/* 高亮拆解：这个工具最直观的一块 */}
          <div className="space-y-3 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-xs backdrop-blur-md">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
              <h3 className="text-sm font-semibold text-foreground">原始网址拆解</h3>
              <CopyButton text={report.raw} label="复制原始网址" />
            </div>
            <div className="overflow-x-auto rounded-xl border border-border/60 bg-muted/20 p-3">
              <code className="font-mono text-sm leading-loose whitespace-pre-wrap break-all text-foreground">
                {segments.length === 0 ? (
                  <span className="text-muted-foreground">（没有解析到可拆解的网址）</span>
                ) : (
                  segments.map((segment, index) => (
                    <span key={`${segment.kind}-${index}`} className={URL_SEGMENT_CLASS[segment.kind]}>
                      {segment.text}
                    </span>
                  ))
                )}
              </code>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-2">
              {URL_LEGEND.map((item) => (
                <span key={item.kind} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <span className={cn("inline-block h-3 w-5 rounded", item.swatch)} />
                  {item.label}
                </span>
              ))}
            </div>
          </div>

          {/* 部件字段表 */}
          <div className="space-y-3 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-xs backdrop-blur-md">
            <h3 className="text-sm font-semibold text-foreground">各部件明细</h3>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-left text-xs">
                <thead>
                  <tr className="font-mono-accent text-[10px] uppercase tracking-widest text-muted-foreground">
                    <th className="px-3 py-2 font-medium">部件</th>
                    <th className="px-3 py-2 font-medium">值</th>
                    <th className="w-20 px-3 py-2 text-right font-medium">是否为空</th>
                  </tr>
                </thead>
                <tbody>
                  {report.fields.map((field) => (
                    <tr
                      key={field.label}
                      className="border-t border-border/40 even:bg-muted/20"
                    >
                      <td className="whitespace-nowrap px-3 py-2 align-top text-muted-foreground">
                        {field.label}
                      </td>
                      <td className="px-3 py-2 align-top font-mono leading-relaxed break-all text-foreground">
                        {field.value}
                      </td>
                      <td className="px-3 py-2 text-right align-top">
                        {field.empty ? (
                          <Badge variant="outline">空</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* 查询参数表 */}
          <div className="space-y-3 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-xs backdrop-blur-md">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-foreground">
                查询参数（共 {params.length} 个）
              </h3>
              {params.length > 0 ? (
                <CopyButton
                  text={params.map((param) => `${param.name} = ${param.raw}`).join("\n")}
                  label="复制原始参数"
                />
              ) : null}
            </div>
            {params.length === 0 ? (
              <HintLine>这条网址没有查询参数。</HintLine>
            ) : (
              <>
                <HintLine>
                  「+」与「%20」在查询串中都表示空格，两者的原始写法不同；下表同时列出解码值与原始值。
                </HintLine>
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="font-mono-accent text-[10px] uppercase tracking-widest text-muted-foreground">
                        <th className="px-3 py-2 font-medium">参数名</th>
                        <th className="px-3 py-2 font-medium">解码后的值</th>
                        <th className="px-3 py-2 font-medium">原始未解码值</th>
                      </tr>
                    </thead>
                    <tbody>
                      {params.map((param, index) => (
                        <tr
                          key={`${param.name}-${index}`}
                          className="border-t border-border/40 even:bg-muted/20"
                        >
                          <td className="px-3 py-2 align-top font-mono break-all text-primary">
                            {param.name}
                          </td>
                          <td className="px-3 py-2 align-top font-mono leading-relaxed break-all text-foreground">
                            {param.decoded === "" ? (
                              <span className="text-muted-foreground">（空值）</span>
                            ) : (
                              param.decoded
                            )}
                          </td>
                          <td className="px-3 py-2 align-top font-mono leading-relaxed break-all text-muted-foreground">
                            {param.raw === "" ? "（空）" : param.raw}
                            {param.differs ? (
                              <span className="ml-2 whitespace-nowrap text-[10px] text-accent-foreground">
                                ← 与解码值不同
                              </span>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>

          {/* 规范化结果 */}
          {report.normalized.length > 0 ? (
            <div className="space-y-3 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-xs backdrop-blur-md">
              <h3 className="text-sm font-semibold text-foreground">各组件重新编码后的结果</h3>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {report.normalized.map((field) => (
                  <div key={field.label} className="min-w-0 space-y-1">
                    <div className="font-mono text-[11px] text-muted-foreground">{field.label}</div>
                    <div className="font-mono text-xs leading-relaxed break-all text-foreground">
                      {field.value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}

          {/* 编码后的整串 */}
          <div className="space-y-3 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-xs backdrop-blur-md">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ArrowRight className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">
                  encodeURIComponent 编码后的整串
                </h3>
              </div>
              <CopyButton text={report.encoded} label="复制编码结果" />
            </div>
            <pre className="thin-scroll max-h-40 overflow-auto rounded-xl border border-border/60 bg-muted/30 p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap text-foreground">
              {report.encoded || "（报告里没有给出编码结果）"}
            </pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// 4. 图片 EXIF
// ══════════════════════════════════════════════════════════════════════════

type ExifCacheEntry = {
  file: File | null;
  previewUrl: string | null;
  report: ExifReport | null;
};

/**
 * 模块级缓存（单槽）：选中的图片、它的预览链接、解析结果。
 * 链接归缓存持有，释放时机只有三种：换成新图片、用户清空、被新的一份替换；
 * 组件卸载（切到别的工具）一律不释放 —— 保证切回来预览还在用（pdf-to-images-tool 同款纪律）。
 */
const exifCache: ExifCacheEntry = { file: null, previewUrl: null, report: null };

function rememberExifCache(next: ExifCacheEntry): void {
  const previousUrl = exifCache.previewUrl;
  exifCache.file = next.file;
  exifCache.previewUrl = next.previewUrl;
  exifCache.report = next.report;
  if (previousUrl && previousUrl !== next.previewUrl) URL.revokeObjectURL(previousUrl);
}

function ExifFieldGrid({ fields }: { fields: ExifField[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {fields.map((field) => (
        <div key={field.label} className="min-w-0 space-y-1">
          <div className="text-[11px] font-medium tracking-wide text-muted-foreground">
            {field.label}
          </div>
          <div className="font-mono text-xs leading-relaxed break-all text-foreground">
            {field.value || "（空）"}
          </div>
        </div>
      ))}
    </div>
  );
}

export function ImageExifTool() {
  const [file, setFile] = useState<File | null>(exifCache.file);
  const [previewUrl, setPreviewUrl] = useState<string | null>(exifCache.previewUrl);
  const [report, setReport] = useState<ExifReport | null>(exifCache.report);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 只显示关键参数：EXIF 标签动辄几十项，普通用户只想看相机/曝光/GPS */
  const [onlyKey, setOnlyKey] = useToolDraft("image-exif", "onlyKey", false);
  const requestIdRef = useRef(0);

  const run = useCallback(async (target: File) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setBusy(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append("file", target);
      const response = await postTool("image-exif", formData);
      if (requestIdRef.current !== requestId) return;
      if (response.kind !== "text") throw new Error("解析返回了意外的内容，请稍后重试");
      const parsed = parseExifReport(response.text);
      setReport(parsed);
      rememberExifCache({ file: exifCache.file, previewUrl: exifCache.previewUrl, report: parsed });
    } catch (err) {
      if (requestIdRef.current !== requestId) return;
      setReport(null);
      rememberExifCache({ file: exifCache.file, previewUrl: exifCache.previewUrl, report: null });
      setError(err instanceof Error ? err.message : "解析失败，请换一张图片再试");
    } finally {
      if (requestIdRef.current === requestId) setBusy(false);
    }
  }, []);

  const selectFiles = useCallback(
    (files: File[]) => {
      const next = files[0] ?? null;
      // 先建新链接再写缓存：写缓存时会按「链接变了」把上一条释放掉
      const nextUrl = next ? URL.createObjectURL(next) : null;
      rememberExifCache({ file: next, previewUrl: nextUrl, report: null });
      setFile(next);
      setPreviewUrl(nextUrl);
      setReport(null);
      setError(null);
      if (next) void run(next);
      else requestIdRef.current += 1;
    },
    [run],
  );

  const clear = () => {
    requestIdRef.current += 1;
    rememberExifCache({ file: null, previewUrl: null, report: null });
    setFile(null);
    setPreviewUrl(null);
    setReport(null);
    setError(null);
    setBusy(false);
  };

  // 接收从全局拖拽或其他工具移交的文件（本工具是收文件的，必须自己取这份交接）
  useEffect(() => {
    const pending = consumePendingFiles();
    if (pending.length > 0) selectFiles(pending);
  }, [selectFiles]);

  /** 示例用项目自带的 PNG 图片：它没有 EXIF，正好演示「没有拍摄参数」时的界面 */
  const loadExample = async () => {
    setError(null);
    try {
      const response = await fetch("/furina-logo.png", { cache: "force-cache" });
      if (!response.ok) throw new Error("bad status");
      const blob = await response.blob();
      selectFiles([new File([blob], "furina-logo.png", { type: blob.type || "image/png" })]);
    } catch {
      setError("示例图片读取失败，请直接拖入一张自己拍的照片");
    }
  };

  // 后端拿到的文件名是 ASCII 化过的（中文会变成下划线），所以「文件名」这一项用本地 File.name 覆盖，
  // 用户看到的必须是自己那张图的名字。
  const basic = useMemo(() => {
    const fields = report?.basic ?? [];
    if (!file) return fields;
    return fields.map((field) =>
      field.label === "文件名" ? { label: field.label, value: file.name } : field,
    );
  }, [report, file]);
  const shoot = report?.shoot ?? [];
  const gps = report?.gps;
  const extra = report?.extra ?? [];
  const showExtra = !onlyKey && extra.length > 0;

  return (
    <div className="space-y-4">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Label>图片文件</Label>
            <Badge>支持 JPEG / PNG / TIFF / WebP / GIF</Badge>
          </div>
          <ExampleActions
            onExample={() => void loadExample()}
            onClear={clear}
            disabled={busy}
            exampleLabel="填入示例"
          />
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_15rem]">
          <FileDropzone
            files={file ? [file] : []}
            onChange={selectFiles}
            accept={{
              "image/jpeg": [".jpg", ".jpeg"],
              "image/png": [".png"],
              "image/tiff": [".tif", ".tiff"],
              "image/webp": [".webp"],
              "image/gif": [".gif"],
            }}
          />

          {/* 缩略图预览 */}
          <div className="space-y-2 rounded-2xl border border-border/70 bg-card/60 p-4 shadow-xs backdrop-blur-md">
            <div className="text-xs font-medium text-muted-foreground">预览</div>
            <div className="flex h-32 items-center justify-center overflow-hidden rounded-xl border border-border/60 bg-muted/30">
              {previewUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={previewUrl}
                  alt={file?.name ?? "待解析的图片"}
                  className="max-h-full max-w-full object-contain"
                />
              ) : (
                <ImageIcon className="h-6 w-6 text-muted-foreground" />
              )}
            </div>
            {file ? (
              <div className="min-w-0 space-y-0.5">
                <p className="truncate text-xs font-medium text-foreground" title={file.name}>
                  {file.name}
                </p>
                <p className="font-mono-accent text-[10px] uppercase tracking-widest text-muted-foreground">
                  {formatBytes(file.size)}
                </p>
              </div>
            ) : (
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                选一张照片，右侧会显示缩略图，下面给出拍摄参数。
              </p>
            )}
          </div>
        </div>

        <HintLine>
          「填入示例」载入的是一张不带 EXIF 的 PNG，用于演示无拍摄参数时的情形；查看完整参数请使用相机或手机直出的 JPEG。
        </HintLine>
      </div>

      {error ? <ToolError message={error} /> : null}

      {busy ? (
        <div className="space-y-3 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-xs backdrop-blur-md">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            正在解析图片信息…
          </div>
          <SkeletonBlock rows={4} />
        </div>
      ) : null}

      {!busy && !report && !error ? (
        <div className="space-y-3 rounded-2xl border border-dashed border-border/70 bg-card/40 px-6 py-12 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <ImageIcon className="h-5 w-5" />
          </span>
          <p className="text-sm font-medium text-foreground">还没有解析结果</p>
          <p className="mx-auto max-w-md text-xs leading-relaxed text-muted-foreground">
            上传一张照片即可读取相机型号、镜头、光圈、快门、ISO 与拍摄时间等信息。
          </p>
        </div>
      ) : null}

      {!busy && report ? (
        <div className="space-y-4">
          {!report.hasExif ? (
            <div className="space-y-3 rounded-2xl border border-border/70 border-l-4 border-l-primary/70 bg-primary/[0.06] px-5 py-5">
              <div className="flex items-start gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/15 text-primary">
                  <AlertTriangle className="h-5 w-5" />
                </span>
                <div className="min-w-0 space-y-1">
                  <p className="text-sm font-semibold text-foreground">这张图片没有拍摄参数</p>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    {report.noExifMessage ||
                      "报告里没有 EXIF 数据。"}
                    <br />
                    PNG 图片、经过聊天软件 / 压缩工具转存过的照片，元数据通常会被清掉；
                    这不影响图片本身，只是看不出相机、时间与位置了。用相机或手机直出的 JPEG 一般都有。
                  </p>
                </div>
              </div>
              {report.notes.length > 0 ? (
                <ul className="space-y-1 border-t border-border/40 pt-3">
                  {report.notes.map((note) => (
                    <li key={note} className="font-mono text-[11px] text-muted-foreground">
                      {note}
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {report.summary ? (
            <div className="flex items-start gap-2 rounded-2xl border border-border/70 border-l-4 border-l-primary/70 bg-card/60 px-5 py-4 shadow-xs backdrop-blur-md">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <span className="font-mono text-xs leading-relaxed break-all text-foreground">
                {report.summary}
              </span>
            </div>
          ) : null}

          {/* 图片基本信息 */}
          {basic.length > 0 ? (
            <div className="space-y-4 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-xs backdrop-blur-md">
              <div className="flex items-center gap-2 border-b border-border/50 pb-3">
                <ImageIcon className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">图片基本信息</h3>
              </div>
              <ExifFieldGrid fields={basic} />
            </div>
          ) : null}

          {/* 拍摄参数 */}
          {shoot.length > 0 ? (
            <div className="space-y-4 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-xs backdrop-blur-md">
              <div className="flex items-center gap-2 border-b border-border/50 pb-3">
                <Sparkles className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">拍摄参数</h3>
                <span className="text-xs text-muted-foreground">共 {shoot.length} 项</span>
              </div>
              <ExifFieldGrid fields={shoot} />
            </div>
          ) : null}

          {/* GPS：可读的度分秒 + 小数两种写法 */}
          {gps ? (
            <div className="space-y-4 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-xs backdrop-blur-md">
              <div className="flex items-center gap-2 border-b border-border/50 pb-3">
                <MapPin className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">GPS 定位信息</h3>
                <Badge variant="outline">照片里带了经纬度</Badge>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="min-w-0 space-y-1">
                  <div className="text-[11px] font-medium tracking-wide text-muted-foreground">
                    十进制度数（可直接粘贴到地图）
                  </div>
                  <div className="font-mono text-xs leading-relaxed break-all text-foreground">
                    {gps.decimal || "（无）"}
                  </div>
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="text-[11px] font-medium tracking-wide text-muted-foreground">
                    海拔
                  </div>
                  <div className="font-mono text-xs leading-relaxed break-all text-foreground">
                    {gps.altitude || "（未记录）"}
                  </div>
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="text-[11px] font-medium tracking-wide text-muted-foreground">
                    纬度（度分秒）
                  </div>
                  <div className="font-mono text-xs leading-relaxed break-all text-foreground">
                    {gps.latitude || "（无）"}
                  </div>
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="text-[11px] font-medium tracking-wide text-muted-foreground">
                    经度（度分秒）
                  </div>
                  <div className="font-mono text-xs leading-relaxed break-all text-foreground">
                    {gps.longitude || "（无）"}
                  </div>
                </div>
              </div>
              {report.gpsFields.length > 0 ? (
                <div className="space-y-3 border-t border-border/40 pt-3">
                  <ExifFieldGrid fields={report.gpsFields} />
                </div>
              ) : null}
              <HintLine>
                这张照片记录了拍摄位置 —— 分享原图前记得确认是否愿意公开这个坐标。
              </HintLine>
            </div>
          ) : null}

          {/* 其它 EXIF 标签 */}
          {report.hasExif && extra.length > 0 ? (
            <div className="space-y-4 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-xs backdrop-blur-md">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-3">
                <div className="flex items-center gap-2">
                  <Tag className="h-4 w-4 text-primary" />
                  <h3 className="text-sm font-semibold text-foreground">其它 EXIF 标签</h3>
                </div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  <input
                    type="checkbox"
                    checked={onlyKey}
                    onChange={(event) => setOnlyKey(event.target.checked)}
                    className="h-3.5 w-3.5 cursor-pointer rounded accent-primary"
                  />
                  只看关键参数
                </label>
              </div>
              {showExtra ? (
                <div className="space-y-5">
                  {extra.map((group) => (
                    <div key={group.title} className="space-y-3">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-foreground">{group.title}</span>
                        <span className="font-mono-accent text-[10px] uppercase tracking-widest text-muted-foreground">
                          {group.count} 项
                        </span>
                      </div>
                      <ExifFieldGrid fields={group.fields} />
                    </div>
                  ))}
                </div>
              ) : (
                <HintLine>
                  已隐藏 {extra.reduce((sum, group) => sum + group.count, 0)} 项边角标签，取消勾选即可展开。
                </HintLine>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
