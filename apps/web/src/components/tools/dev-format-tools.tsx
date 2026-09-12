"use client";

/**
 * 开发与创作类工具的自带界面（CSS 渐变生成器 / SVG 优化压缩 / ASCII 艺术字）。
 *
 * 三个工具的任务模型完全不同，所以布局也各不相同：
 *   - CSS 渐变：**工作台（模式 B）** —— 左边调参数（可视化色块 + 分段控件 + 预设），
 *     右边一大块实时预览 + 三段可复制代码。生成器看不见成品就是白做，所以预览必须在；
 *     预览与代码都在前端实时算（服务端接口只用来核对 + 给出「颜色非法」这类注意事项）。
 *   - SVG 优化：**前后对照（模式 C 的变体）** —— 上传区 + 压缩前后的大号数字与对比条 +
 *     原图/优化后并排预览。这个工具的卖点就是"省了多少"，所以对比摆在最显眼的位置。
 *   - ASCII 艺术字：**文档预览（模式 F）的变体** —— 上方输入 + 参数带，下方一整块等宽结果区
 *     （横向滚动、绝不折行破坏字形）。文字与参数一改就重算，没有"生成"按钮；
 *     字体风格是写死在代码里的点阵 + 变换（14 种，零依赖、离线可用），中文现场光栅化。
 *     另一半是「图片转字符画」：上传 → 灰阶映射 → 可复制、可导出 .txt / .png。
 *
 * 视觉语言与全站一致（见 docs/新工具UI规范.md）：rounded-2xl + border-border/70 + shadow-xs，
 * 需要高级感处用 bg-card/60 backdrop-blur-md，品牌点缀用 primary/10、primary/20。
 * 代码里出现的十六进制色值只有三类，都属于规范允许的例外：
 *   ① 用户自己选/预设的渐变色（预览必须画出真颜色）；
 *   ② 示例 SVG 文件的内容（那是"用户文件"，不是界面）；
 *   ③ ASCII 工具导出 PNG 的文字色/底色默认值（同样是用户可改的内容色，不是界面颜色）。
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentType,
  type CSSProperties,
} from "react";
import {
  AlertTriangle,
  ArrowRight,
  Braces,
  Check,
  Copy,
  Download,
  Eraser,
  FileDown,
  Image as ImageIcon,
  ImagePlus,
  Layers,
  Loader2,
  Minimize2,
  ScanLine,
  Sparkles,
  Type as TypeIcon,
  Upload,
  X,
} from "lucide-react";
import { Badge, Button, Input, Label, PasteButton, Select, Textarea } from "@/components/ui/primitives";
import { FileDropzone } from "@/components/tools/file-dropzone";
import { consumePendingFiles } from "@/lib/file-handoff";
import { cn, formatBytes } from "@/lib/utils";
import { useToolDraft } from "@/lib/use-tool-draft";

// ══════════════════════════════════════════════════════════════════════════
// #region parsers
// 纯函数区：颜色归一化、渐变代码拼装、服务端报告解析、字符替换、压缩率计算。
// 不依赖 React / DOM / 网络，可整段抽出来单独跑单元测试。
// ══════════════════════════════════════════════════════════════════════════

/** 报告里的分隔线（"─" × 34） */
const REPORT_RULE_LINE = /^[─—–=-]{6,}$/;

export type GradientType = "linear" | "radial" | "conic";

export type GradientCode = {
  /** 可直接写进 style 的渐变函数，例如 linear-gradient(to right, #a, #b) */
  css: string;
  /** 分开声明写法（原样一样，只是给 background-image 用） */
  separate: string;
  tailwind: string;
  /** 「你填的颜色没被采用」这类说明，来自本地校验（与服务端同一套规则） */
  notes: string[];
};

/** 与后端同一套规则：3/4/6/8 位十六进制都认，非法返回 null 由调用方回退 */
export function normalizeHexColor(value: string | undefined): string | null {
  const text = (value ?? "").trim();
  if (text === "") return null;
  const withHash = text.startsWith("#") ? text : `#${text}`;
  if (!/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(withHash)) {
    return null;
  }
  const body = withHash.slice(1).toLowerCase();
  if (body.length === 3 || body.length === 4) {
    return `#${body
      .split("")
      .map((ch) => ch + ch)
      .join("")}`;
  }
  return `#${body}`;
}

const LINEAR_TAILWIND: Record<string, string> = {
  "to right": "bg-gradient-to-r",
  "to bottom": "bg-gradient-to-b",
  "to bottom right": "bg-gradient-to-br",
};

export const GRADIENT_TYPE_VALUES: GradientType[] = ["linear", "radial", "conic"];
export const GRADIENT_DIRECTIONS = ["to right", "to bottom", "to bottom right", "45deg", "135deg"];

/**
 * 本地拼装渐变代码（与后端 /api/tools/css-gradient 完全同一套规则）。
 * 之所以前端也留一份：色板拖动时的反馈必须是即时的，等一次网络往返会让工具显得很迟钝。
 */
export function buildGradientCode(
  type: GradientType,
  direction: string,
  color1: string,
  color2: string,
): GradientCode {
  const notes: string[] = [];
  const parsed1 = normalizeHexColor(color1);
  const parsed2 = normalizeHexColor(color2);
  const final1 = parsed1 ?? "#6366f1";
  const final2 = parsed2 ?? "#ec4899";
  if (color1.trim() !== "" && !parsed1) {
    notes.push(`颜色 1「${color1.trim()}」不是合法的 hex 颜色，已回退为默认值 ${final1}`);
  }
  if (color2.trim() !== "" && !parsed2) {
    notes.push(`颜色 2「${color2.trim()}」不是合法的 hex 颜色，已回退为默认值 ${final2}`);
  }

  const kind: GradientType = GRADIENT_TYPE_VALUES.includes(type) ? type : "linear";
  const dir = GRADIENT_DIRECTIONS.includes(direction) ? direction : "to right";

  let css: string;
  if (kind === "radial") css = `radial-gradient(circle, ${final1}, ${final2})`;
  else if (kind === "conic") css = `conic-gradient(from 0deg at 50% 50%, ${final1}, ${final2})`;
  else css = `linear-gradient(${dir}, ${final1}, ${final2})`;

  const tailwindClass = LINEAR_TAILWIND[dir];
  const tailwind =
    kind === "linear" && tailwindClass
      ? `${tailwindClass} from-[${final1}] to-[${final2}]`
      : `bg-[${css.replace(/\s+/g, "")}]`;

  return { css, separate: css, tailwind, notes };
}

export type GradientReport = {
  code: GradientCode;
  /** 报告末尾「使用参数」那一行解析出来的实际参数 */
  type: string;
  direction: string;
  colors: string;
};

/** 解析 CSS 渐变报告（服务端文本）；认不出来的行忽略，不抛错 */
export function parseGradientReport(text: string): GradientReport {
  const empty: GradientCode = { css: "", separate: "", tailwind: "", notes: [] };
  const report: GradientReport = { code: empty, type: "", direction: "", colors: "" };
  if (typeof text !== "string" || text.trim() === "") return report;

  let section: "" | "css" | "separate" | "tailwind" | "notes" = "";

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/\s+$/, "");
    const trimmed = line.trim();
    if (trimmed === "") continue;
    if (REPORT_RULE_LINE.test(trimmed)) continue;

    if (/^可直接复制的 CSS[：:]?$/.test(trimmed)) {
      section = "css";
      continue;
    }
    if (/^分开声明也可以[：:]?$/.test(trimmed)) {
      section = "separate";
      continue;
    }
    if (/^Tailwind 写法[：:]?$/.test(trimmed)) {
      section = "tailwind";
      continue;
    }
    if (/^注意[：:]?$/.test(trimmed)) {
      section = "notes";
      continue;
    }
    if (/^使用参数[：:]/.test(trimmed)) {
      // 方向值本身带空格（to right / to bottom right），所以用「到下一个中文逗号为止」来切
      const params = /类型=(.+?)[，,]\s*方向=(.+?)[，,]\s*色标=(.+)$/.exec(trimmed);
      if (params) {
        report.type = (params[1] ?? "").trim();
        report.direction = (params[2] ?? "").trim();
        report.colors = (params[3] ?? "").trim();
      }
      section = "";
      continue;
    }

    if (section === "css") {
      report.code.css = trimmed.replace(/^background\s*:\s*/, "").replace(/;\s*$/, "");
      continue;
    }
    if (section === "separate") {
      report.code.separate = trimmed.replace(/^background-image\s*:\s*/, "").replace(/;\s*$/, "");
      continue;
    }
    if (section === "tailwind") {
      // 「（Tailwind 3.x 没有内置的……）」这类补充说明以全角括号开头，不是代码
      if (!trimmed.startsWith("（")) report.code.tailwind = trimmed;
      continue;
    }
    if (section === "notes") {
      report.code.notes.push(trimmed);
      continue;
    }
  }

  return report;
}

/** 把 5 行高的 '#' 字符画换成用户挑的填充字符（只允许单个字符，避免把画面撑坏） */
export function applyFillChar(art: string, fill: string): string {
  if (typeof art !== "string" || art === "") return "";
  if (typeof fill !== "string" || [...fill].length !== 1) return art;
  return art.replace(/#/g, fill);
}

export type SvgSaving = {
  savedBytes: number;
  percent: number;
  /** 真的变小了才算「有可压缩空间」 */
  reduced: boolean;
};

/** 压缩率：优化前用上传文件的大小，优化后用拿到的 blob 大小（都在前端算得出来） */
export function computeSvgSaving(before: number, after: number): SvgSaving {
  const from = Number.isFinite(before) && before > 0 ? before : 0;
  const to = Number.isFinite(after) && after > 0 ? after : 0;
  if (from === 0 || to === 0 || to >= from) {
    return { savedBytes: Math.max(0, from - to), percent: 0, reduced: false };
  }
  const savedBytes = from - to;
  return {
    savedBytes,
    percent: Math.max(1, Math.round((savedBytes / from) * 100)),
    reduced: true,
  };
}

// #endregion parsers

// ══════════════════════════════════════════════════════════════════════════
// 请求与通用小件
// ══════════════════════════════════════════════════════════════════════════

type ToolResponse =
  | { kind: "text"; text: string; filename: string }
  | { kind: "file"; blob: Blob; filename: string };

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

/** 规范第五节的错误样式 */
function ToolError({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl border-l-4 border-l-destructive bg-destructive/10 px-4 py-3 font-mono text-xs text-destructive">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      {message}
    </div>
  );
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

/** 分段控件（规范里点着玩的工具一律用按钮组，不用下拉框） */
function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled,
}: {
  value: T;
  options: { value: T; label: string; icon?: ComponentType<{ className?: string }> }[];
  onChange: (next: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        const active = option.value === value;
        const Icon = option.icon;
        return (
          <button
            key={option.value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(option.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-medium transition-all",
              active
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border/70 bg-card text-muted-foreground hover:bg-secondary hover:text-foreground",
              disabled && "cursor-not-allowed opacity-40 hover:bg-card hover:text-muted-foreground",
            )}
          >
            {Icon ? <Icon className="h-3.5 w-3.5" /> : null}
            {option.label}
            {active ? <Check className="h-3.5 w-3.5" /> : null}
          </button>
        );
      })}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// 5. CSS 渐变生成器
// ══════════════════════════════════════════════════════════════════════════

/** 工具初始色（也是后端回退时用的默认色）：这两个值属于「用户可改的颜色」 */
const DEFAULT_COLOR_1 = "#6366f1";
const DEFAULT_COLOR_2 = "#ec4899";

const GRADIENT_TYPE_OPTIONS: {
  value: GradientType;
  label: string;
  icon: ComponentType<{ className?: string }>;
}[] = [
  { value: "linear", label: "线性", icon: ArrowRight },
  { value: "radial", label: "径向", icon: Sparkles },
  { value: "conic", label: "锥形", icon: Layers },
];

const GRADIENT_DIRECTION_OPTIONS: { value: string; label: string }[] = [
  { value: "to right", label: "向右" },
  { value: "to bottom", label: "向下" },
  { value: "to bottom right", label: "右下" },
  { value: "45deg", label: "45°" },
  { value: "135deg", label: "135°" },
];

/** 预设渐变：点一下就套用，让这个工具"点着玩" */
const GRADIENT_PRESETS: {
  name: string;
  color1: string;
  color2: string;
  type: GradientType;
  direction: string;
}[] = [
  { name: "日落", color1: "#ff7e5f", color2: "#feb47b", type: "linear", direction: "to right" },
  { name: "海洋", color1: "#2193b0", color2: "#6dd5ed", type: "linear", direction: "to bottom" },
  { name: "薄荷", color1: "#00b09b", color2: "#96c93d", type: "linear", direction: "135deg" },
  { name: "樱花", color1: "#ffafbd", color2: "#ffc3a0", type: "linear", direction: "to bottom right" },
  { name: "极光", color1: "#7f7fd5", color2: "#86a8e7", type: "linear", direction: "45deg" },
  { name: "夜幕", color1: "#232526", color2: "#414345", type: "linear", direction: "to bottom" },
  { name: "紫罗兰", color1: "#8e2de2", color2: "#4a00e0", type: "linear", direction: "to bottom right" },
  { name: "晨曦", color1: "#f6d365", color2: "#fda085", type: "linear", direction: "to right" },
];

function CodeBlock({ title, code, note }: { title: string; code: string; note?: string }) {
  return (
    <div className="space-y-2 rounded-xl border border-border/60 bg-muted/20 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-medium tracking-wide text-muted-foreground">{title}</span>
        <CopyButton text={code} />
      </div>
      <pre className="thin-scroll overflow-x-auto font-mono text-xs leading-relaxed text-foreground">
        {code}
      </pre>
      {note ? <p className="text-[11px] leading-relaxed text-muted-foreground">{note}</p> : null}
    </div>
  );
}

export function CssGradientTool() {
  const [color1, setColor1] = useToolDraft("css-gradient", "color1", DEFAULT_COLOR_1);
  const [color2, setColor2] = useToolDraft("css-gradient", "color2", DEFAULT_COLOR_2);
  const [type, setType] = useToolDraft<GradientType>("css-gradient", "type", "linear");
  const [direction, setDirection] = useToolDraft("css-gradient", "direction", "to right");
  const [serverNotes, setServerNotes] = useState<string[]>([]);
  /** 与服务端核对的状态：本地算的代码立刻可用，这个状态只是如实告诉用户核对结果 */
  const [verify, setVerify] = useState<"idle" | "checking" | "ok" | "offline">("idle");

  // 本地实时算：色板一动预览就跟着变，不需要点任何按钮
  const local = useMemo(
    () => buildGradientCode(type, direction, color1, color2),
    [type, direction, color1, color2],
  );
  const localNotes = local.notes;

  /**
   * 防抖调用一次服务端接口，用它给出的「注意事项」做交叉核对。
   * 结果文本本身与本地一致（同一套规则），所以界面上的代码块不必等它 ——
   * 网络不通时这个工具照样完全可用，这正是本地算一份的意义。
   */
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        setVerify("checking");
        try {
          const formData = new FormData();
          formData.append("color1", color1);
          formData.append("color2", color2);
          formData.append("type", type);
          formData.append("direction", direction);
          const response = await postTool("css-gradient", formData);
          if (cancelled) return;
          if (response.kind !== "text") throw new Error("unexpected");
          setServerNotes(parseGradientReport(response.text).code.notes);
          setVerify("ok");
        } catch {
          // 服务端不可用不影响使用：本地已经有同样的代码与校验
          if (!cancelled) {
            setServerNotes([]);
            setVerify("offline");
          }
        }
      })();
    }, 320);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [color1, color2, type, direction]);

  const applyPreset = (preset: (typeof GRADIENT_PRESETS)[number]) => {
    setColor1(preset.color1);
    setColor2(preset.color2);
    setType(preset.type);
    setDirection(preset.direction);
  };

  const clear = () => {
    setColor1(DEFAULT_COLOR_1);
    setColor2(DEFAULT_COLOR_2);
    setType("linear");
    setDirection("to right");
  };

  const directionDisabled = type !== "linear";
  const directionLabel =
    GRADIENT_DIRECTION_OPTIONS.find((option) => option.value === direction)?.label ?? direction;
  const typeLabel = GRADIENT_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? type;
  const notes = serverNotes.length > 0 ? serverNotes : localNotes;
  const solid1 = normalizeHexColor(color1) ?? DEFAULT_COLOR_1;
  const solid2 = normalizeHexColor(color2) ?? DEFAULT_COLOR_2;

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        {/* 左：参数配置 */}
        <div className="space-y-5 lg:col-span-4">
          <div className="space-y-5 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-sm backdrop-blur-md">
            <div className="flex items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground">颜色</h3>
                <Badge>纯前端实时预览</Badge>
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={clear}>
                <Eraser className="h-3.5 w-3.5" />
                清空
              </Button>
            </div>

            {(
              [
                { label: "起始色", value: color1, set: setColor1, solid: solid1 },
                { label: "结束色", value: color2, set: setColor2, solid: solid2 },
              ] as const
            ).map((item) => (
              <div key={item.label} className="space-y-2">
                <Label htmlFor={`gradient-${item.label}`}>{item.label}</Label>
                <div className="flex items-center gap-3">
                  <div className="relative h-11 w-11 shrink-0 overflow-hidden rounded-lg border border-border">
                    <input
                      id={`gradient-${item.label}`}
                      type="color"
                      value={item.solid}
                      onChange={(event) => item.set(event.target.value)}
                      className="absolute -inset-2 h-[calc(100%+1rem)] w-[calc(100%+1rem)] cursor-pointer border-0 bg-transparent p-0"
                      aria-label={item.label}
                    />
                  </div>
                  <Input
                    value={item.value}
                    onChange={(event) => item.set(event.target.value)}
                    className="font-mono text-sm"
                    spellCheck={false}
                    autoComplete="off"
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-5 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-sm backdrop-blur-md">
            <div className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">渐变类型</h3>
              <Segmented value={type} options={GRADIENT_TYPE_OPTIONS} onChange={setType} />
            </div>

            <div className="space-y-2 border-t border-border/40 pt-4">
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-sm font-semibold text-foreground">方向</h3>
                {directionDisabled ? (
                  <span className="text-[11px] text-muted-foreground">
                    {type === "radial" ? "径向渐变不用方向" : "锥形渐变不用方向"}
                  </span>
                ) : null}
              </div>
              <Segmented
                value={direction}
                options={GRADIENT_DIRECTION_OPTIONS}
                onChange={setDirection}
                disabled={directionDisabled}
              />
            </div>
          </div>

          {/* 预设渐变 */}
          <div className="space-y-3 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-sm backdrop-blur-md">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-foreground">预设渐变</h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => applyPreset(GRADIENT_PRESETS[0]!)}
              >
                <Sparkles className="h-3.5 w-3.5" />
                填入示例
              </Button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {GRADIENT_PRESETS.map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  className={cn(
                    "group flex items-center gap-2 rounded-xl border p-1.5 text-left transition-all",
                    preset.color1 === solid1 && preset.color2 === solid2
                      ? "border-primary/50 bg-primary/10"
                      : "border-border/60 hover:border-primary/40 hover:bg-secondary/60",
                  )}
                >
                  <span
                    className="h-7 w-9 shrink-0 rounded-lg border border-border/60"
                    style={{
                      background: buildGradientCode("linear", "to right", preset.color1, preset.color2).css,
                    }}
                  />
                  <span className="truncate text-[11px] text-foreground">{preset.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 右：实时预览 + 代码 */}
        <div className="space-y-5 lg:col-span-8">
          <div className="space-y-4 rounded-2xl border border-border/70 bg-card/70 p-5 shadow-sm backdrop-blur-md">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground">实时预览</h3>
                <Badge variant="outline">
                  {typeLabel}
                  {directionDisabled ? "" : ` · ${directionLabel}`}
                </Badge>
              </div>
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                {verify === "checking" ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" />
                    与服务端核对中…
                  </>
                ) : verify === "ok" ? (
                  <>
                    <Check className="h-3 w-3 text-success" />
                    已与本地服务结果核对
                  </>
                ) : verify === "offline" ? (
                  <>
                    <AlertTriangle className="h-3 w-3" />
                    服务端暂时没响应，代码由本地实时计算
                  </>
                ) : (
                  "本地实时计算"
                )}
              </span>
            </div>

            {/* 成品预览：直接画出来，颜色是用户自己选的 */}
            <div
              className="relative h-40 w-full overflow-hidden rounded-2xl border border-border/60"
              style={{ background: local.css }}
            >
              <span className="absolute bottom-3 left-3 rounded-lg border border-border/60 bg-card/70 px-2.5 py-1 font-mono text-[10px] text-foreground backdrop-blur-md">
                {solid1} → {solid2}
              </span>
              <span className="absolute right-3 top-3 rounded-lg border border-border/60 bg-card/70 px-2.5 py-1 font-mono text-[10px] text-muted-foreground backdrop-blur-md">
                {local.css}
              </span>
            </div>

            {notes.length > 0 ? (
              <ul className="space-y-1">
                {notes.map((note) => (
                  <li
                    key={note}
                    className="flex items-start gap-1.5 text-[11px] leading-relaxed text-destructive"
                  >
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
                    {note}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          <div className="space-y-4 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-sm backdrop-blur-md">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
              <div className="flex items-center gap-2">
                <Braces className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">三种写法</h3>
              </div>
              <CopyButton text={`background: ${local.css};`} label="复制 CSS" />
            </div>
            <div className="space-y-3">
              <CodeBlock title="可直接复制的 CSS" code={`background: ${local.css};`} />
              <CodeBlock title="分开声明也可以" code={`background-image: ${local.css};`} />
              <CodeBlock
                title="Tailwind 写法"
                code={local.tailwind}
                note={
                  type === "linear" && LINEAR_TAILWIND[direction]
                    ? undefined
                    : "Tailwind 3.x 没有内置这个方向/类型的类，这里用的是任意值写法 bg-[...]。"
                }
              />
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              使用参数：类型={type}，方向={directionDisabled ? "（该类型不使用方向）" : direction}，色标=
              {solid1} → {solid2}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// 6. SVG 优化压缩
// ══════════════════════════════════════════════════════════════════════════

type SvgResult = { url: string; size: number; text: string; name: string };

type SvgCacheEntry = {
  file: File | null;
  beforeUrl: string | null;
  beforeText: string;
  result: SvgResult | null;
};

/**
 * 模块级缓存（单槽）：上传的 SVG、原文件预览链接、原文件源码、优化结果。
 * 两条 objectURL（beforeUrl / result.url）都由缓存持有，释放时机：
 *   ① 换成新文件（beforeUrl 变）② 结果被换成新的一份或被置空（result.url 变）
 *   ③ 组件卸载**不释放** —— 缓存还持有它们，切回工具时预览与下载照常可用。
 * 判定依据是「链接字符串是否还是同一条」而不是无条件释放：无条件释放会把正在显示的链接掐断。
 */
const svgCache: SvgCacheEntry = { file: null, beforeUrl: null, beforeText: "", result: null };

function rememberSvgCache(next: SvgCacheEntry): void {
  if (svgCache.beforeUrl && svgCache.beforeUrl !== next.beforeUrl) {
    URL.revokeObjectURL(svgCache.beforeUrl);
  }
  const previousResultUrl = svgCache.result?.url;
  if (previousResultUrl && previousResultUrl !== next.result?.url) {
    URL.revokeObjectURL(previousResultUrl);
  }
  svgCache.file = next.file;
  svgCache.beforeUrl = next.beforeUrl;
  svgCache.beforeText = next.beforeText;
  svgCache.result = next.result;
}

/**
 * 示例 SVG：刻意写成「人类手写的样子」—— 缩进、注释、metadata、属性之间的多余空格，
 * 这些正是优化器要处理的东西，所以拿它当示例能立刻看到压缩效果。
 * 里面的颜色是**文件内容**（不是界面配色），用中性色是为了在浅底和深底预览上都看得清。
 */
const SAMPLE_SVG = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200">
    <!-- 优化示例：注释、metadata、缩进与属性间的多余空格都会被处理掉 -->
    <metadata>   FurinaKit SVG 优化示例文件   </metadata>
    <defs>
        <linearGradient id="furinaSky" x1="0"   y1="0"   x2="1"   y2="1">
            <stop offset="0"   stop-color="#6366f1" stop-opacity="0.85"   />
            <stop offset="1"   stop-color="#a855f7" stop-opacity="0.15"   />
        </linearGradient>
    </defs>
    <rect x="0"   y="0"   width="320"   height="200"   rx="18"   ry="18"   fill="url(#furinaSky)"   />
    <circle cx="110"   cy="100"   r="52"   fill="none"   stroke="#475569"   stroke-width="4"   />
    <path d="M 110 48 L 160 100 L 110 152 L 60 100 Z"   fill="none"   stroke="#475569"   stroke-width="3"   stroke-linejoin="round"   />
    <text x="178"   y="107"   font-family="monospace"   font-size="16"   fill="#475569">FurinaKit</text>
</svg>
`;

/** 预览底色：都是主题变量派生出来的，三套主题下都自洽 */
const PREVIEW_BACKGROUNDS: { value: string; label: string; style: CSSProperties }[] = [
  {
    value: "checker",
    label: "棋盘",
    style: {
      backgroundColor: "hsl(var(--card))",
      backgroundImage:
        "linear-gradient(45deg, hsl(var(--muted)) 25%, transparent 25%, transparent 75%, hsl(var(--muted)) 75%), linear-gradient(45deg, hsl(var(--muted)) 25%, transparent 25%, transparent 75%, hsl(var(--muted)) 75%)",
      backgroundSize: "16px 16px",
      backgroundPosition: "0 0, 8px 8px",
    },
  },
  { value: "base", label: "主题底色", style: { backgroundColor: "hsl(var(--secondary))" } },
  { value: "contrast", label: "对比底色", style: { backgroundColor: "hsl(var(--foreground))" } },
];

export function SvgOptimizeTool() {
  const [file, setFile] = useState<File | null>(svgCache.file);
  const [beforeUrl, setBeforeUrl] = useState<string | null>(svgCache.beforeUrl);
  const [beforeText, setBeforeText] = useState<string>(svgCache.beforeText);
  const [result, setResult] = useState<SvgResult | null>(svgCache.result);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** 预览底色选择：透明 SVG 在浅底/深底上表现完全不同，这个开关是真的有用所以记住它 */
  const [previewBg, setPreviewBg] = useToolDraft("svg-optimize", "previewBg", "checker");
  const requestIdRef = useRef(0);

  const run = useCallback(async (target: File) => {
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    setBusy(true);
    setError(null);
    // 先把旧结果置空：写回缓存时会把上一条结果的链接释放掉，反复优化不会把旧 blob 钉在内存里
    rememberSvgCache({
      file: svgCache.file,
      beforeUrl: svgCache.beforeUrl,
      beforeText: svgCache.beforeText,
      result: null,
    });
    setResult(null);
    try {
      const formData = new FormData();
      formData.append("file", target);
      const response = await postTool("svg-optimize", formData);
      if (requestIdRef.current !== requestId) return;
      if (response.kind !== "file") throw new Error("优化返回了意外的内容，请稍后重试");
      const text = await response.blob.text();
      const next: SvgResult = {
        url: URL.createObjectURL(response.blob),
        size: response.blob.size,
        text,
        // 后端返回的文件名是 ASCII 化过的（中文会变成下划线），这里按原始文件名重算一份给用户看
        name: `${target.name.replace(/\.svg$/i, "") || "image"}-optimized.svg`,
      };
      if (requestIdRef.current !== requestId) {
        URL.revokeObjectURL(next.url);
        return;
      }
      setResult(next);
      rememberSvgCache({
        file: svgCache.file,
        beforeUrl: svgCache.beforeUrl,
        beforeText: svgCache.beforeText,
        result: next,
      });
    } catch (err) {
      if (requestIdRef.current !== requestId) return;
      setError(err instanceof Error ? err.message : "优化失败，请确认这是一个 SVG 文件");
    } finally {
      if (requestIdRef.current === requestId) setBusy(false);
    }
  }, []);

  const selectFiles = useCallback(
    async (files: File[]) => {
      const next = files[0] ?? null;
      if (!next) {
        // 用户在拖拽区里点了「移除」：等价于清空（链接该释放就释放）
        requestIdRef.current += 1;
        rememberSvgCache({ file: null, beforeUrl: null, beforeText: "", result: null });
        setFile(null);
        setBeforeUrl(null);
        setBeforeText("");
        setResult(null);
        setError(null);
        setBusy(false);
        return;
      }
      requestIdRef.current += 1;
      setError(null);
      const nextBeforeUrl = URL.createObjectURL(next);
      let text = "";
      try {
        text = await next.text();
      } catch {
        text = "";
      }
      rememberSvgCache({ file: next, beforeUrl: nextBeforeUrl, beforeText: text, result: null });
      setFile(next);
      setBeforeUrl(nextBeforeUrl);
      setBeforeText(text);
      setResult(null);
      void run(next);
    },
    [run],
  );

  const clear = () => {
    requestIdRef.current += 1;
    rememberSvgCache({ file: null, beforeUrl: null, beforeText: "", result: null });
    setFile(null);
    setBeforeUrl(null);
    setBeforeText("");
    setResult(null);
    setError(null);
    setBusy(false);
  };

  const loadExample = () => {
    void selectFiles([new File([SAMPLE_SVG], "sample-icon.svg", { type: "image/svg+xml" })]);
  };

  // 接收从全局拖拽或其他工具移交的文件（本工具是收文件的，必须自己取这份交接）
  useEffect(() => {
    const pending = consumePendingFiles();
    if (pending.length > 0) void selectFiles(pending);
  }, [selectFiles]);

  const beforeSize = file?.size ?? 0;
  const afterSize = result?.size ?? 0;
  const saving = useMemo(() => computeSvgSaving(beforeSize, afterSize), [beforeSize, afterSize]);
  const background = PREVIEW_BACKGROUNDS.find((item) => item.value === previewBg) ?? PREVIEW_BACKGROUNDS[0]!;
  const beforeBarWidth = 100;
  const afterBarWidth = beforeSize > 0 ? Math.max(2, Math.min(100, (afterSize / beforeSize) * 100)) : 0;

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Label>SVG 文件</Label>
            <Badge>本地处理 · 不失真</Badge>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={loadExample} disabled={busy}>
              <Sparkles className="h-3.5 w-3.5" />
              填入示例
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={clear}>
              <Eraser className="h-3.5 w-3.5" />
              清空
            </Button>
          </div>
        </div>
        <FileDropzone
          files={file ? [file] : []}
          onChange={(files) => void selectFiles(files)}
          accept={{ "image/svg+xml": [".svg"] }}
        />
        <p className="text-xs leading-relaxed text-muted-foreground">
          选好文件就会自动开始优化。优化器只做「不改变渲染结果」的删减：注释、metadata、
          编辑器命名空间、以及标签之间的空白；<code className="font-mono">text / style / script</code>{" "}
          这类对空白敏感的节点会被完整保留。
        </p>
      </div>

      {error ? <ToolError message={error} /> : null}

      {busy ? (
        <div className="flex items-center gap-2 rounded-2xl border border-border/70 bg-card/60 p-5 text-xs text-muted-foreground shadow-xs backdrop-blur-md">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          正在优化并生成对比…
        </div>
      ) : null}

      {!file && !busy ? (
        <div className="space-y-3 rounded-2xl border border-dashed border-border/70 bg-card/40 px-6 py-12 text-center">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
            <Minimize2 className="h-5 w-5" />
          </span>
          <p className="text-sm font-medium text-foreground">还没有优化结果</p>
          <p className="mx-auto max-w-md text-xs leading-relaxed text-muted-foreground">
            拖入一个 .svg 文件即可开始优化，也可以点「填入示例」载入示例文件。
          </p>
        </div>
      ) : null}

      {result && file ? (
        <div className="space-y-4">
          {/* 体积对比：这个工具的核心卖点 */}
          <div className="space-y-4 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-xs backdrop-blur-md">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex items-end gap-3">
                <span className="text-3xl font-bold leading-none tracking-tight text-primary">
                  {formatBytes(afterSize)}
                </span>
                <span className="pb-1 text-sm text-muted-foreground line-through">
                  {formatBytes(beforeSize)}
                </span>
                {saving.reduced ? (
                  <Badge variant="success">省了 {saving.percent}%</Badge>
                ) : (
                  <Badge variant="outline">无可压缩空间</Badge>
                )}
              </div>
              <div className="text-right">
                <div className="text-sm font-semibold text-foreground">
                  {saving.reduced ? `少 ${formatBytes(saving.savedBytes)}` : "大小没有变化"}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  优化前 {formatBytes(beforeSize)} → 优化后 {formatBytes(afterSize)}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <span className="w-12 shrink-0 text-xs text-muted-foreground">优化前</span>
                <div className="h-3 flex-1 overflow-hidden rounded-full border border-border/60 bg-secondary">
                  <div
                    className="h-full rounded-full bg-muted-foreground/50"
                    style={{ width: `${beforeBarWidth}%` }}
                  />
                </div>
                <span className="w-16 shrink-0 text-right font-mono text-xs text-foreground">
                  {formatBytes(beforeSize)}
                </span>
              </div>
              <div className="flex items-center gap-3">
                <span className="w-12 shrink-0 text-xs text-muted-foreground">优化后</span>
                <div className="h-3 flex-1 overflow-hidden rounded-full border border-border/60 bg-secondary">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary to-primary/60 transition-[width] duration-500 ease-out"
                    style={{ width: `${afterBarWidth}%` }}
                  />
                </div>
                <span className="w-16 shrink-0 text-right font-mono text-xs text-foreground">
                  {formatBytes(afterSize)}
                </span>
              </div>
            </div>

            {!saving.reduced ? (
              <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted-foreground">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                这个文件已经很精简了，没有可压缩的空间（优化器只会做不劣化的事，所以原样返回了你的文件）。
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 border-t border-border/40 pt-4">
              <a
                href={result.url}
                download={result.name}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-5 text-sm font-medium text-primary-foreground shadow-[0_8px_24px_-12px_hsl(var(--primary)/0.7)] transition-all hover:brightness-110 active:scale-[0.98]"
              >
                <Download className="h-4 w-4" />
                下载优化后的 SVG
              </a>
              <CopyButton text={result.text} label="复制优化后源码" />
              <CopyButton text={beforeText} label="复制原文件源码" />
              <span className="font-mono-accent text-[10px] uppercase tracking-widest text-muted-foreground">
                {result.name}
              </span>
            </div>
          </div>

          {/* 前后并排预览 */}
          <div className="space-y-4 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-xs backdrop-blur-md">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-3">
              <div className="flex items-center gap-2">
                <ImageIcon className="h-4 w-4 text-primary" />
                <h3 className="text-sm font-semibold text-foreground">优化前后对比</h3>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-[11px] text-muted-foreground">预览底色</span>
                <div className="flex gap-1.5">
                  {PREVIEW_BACKGROUNDS.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      onClick={() => setPreviewBg(item.value)}
                      className={cn(
                        "rounded-lg border px-2.5 py-1 text-[11px] transition-all",
                        item.value === previewBg
                          ? "border-primary/50 bg-primary/10 text-primary"
                          : "border-border/70 bg-card text-muted-foreground hover:bg-secondary hover:text-foreground",
                      )}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              {[
                { title: "原文件", url: beforeUrl, size: beforeSize },
                { title: "优化后", url: result.url, size: afterSize },
              ].map((panel) => (
                <div key={panel.title} className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-foreground">{panel.title}</span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {formatBytes(panel.size)}
                    </span>
                  </div>
                  <div
                    className="flex h-56 items-center justify-center overflow-hidden rounded-xl border border-border/60 p-3"
                    style={background.style}
                  >
                    {panel.url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={panel.url}
                        alt={panel.title}
                        className="max-h-full max-w-full object-contain"
                      />
                    ) : (
                      <ImageIcon className="h-6 w-6 text-muted-foreground" />
                    )}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              SVG 用 &lt;img&gt; 加载，脚本与外链资源都不会执行；两个预览用的是同一张画布底色，
              可以直接对比线条、渐变和文字位置有没有变化。
            </p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════
// 7. ASCII 艺术字（字符画 + 图片转字符画）
// ══════════════════════════════════════════════════════════════════════════
//
// 任务模型：**输入 → 立刻看到大字符画**，是「文档预览」模式（模式 F）的变体：
//   上方输入 + 一条参数带，下方一整块等宽结果区（横向滚动，绝不折行破坏字形）。
//   文字和参数一改结果就重算（纯前端、同步、不联网），所以这里**没有「生成」按钮** ——
//   边打边出才是这个工具的体验核心。图片模式同理：上传区 + 参数带 + 结果区。
//
// 字体不是外部字体文件，而是「一份写在代码里的 5×5 / 3×5 点阵 + 一个变换」：
//   实心 / 空心 / 阴影 / 立体挤出 / 倾斜 / 放大 / 描边成线框 / 反白。
//   所以零依赖、断网可用，共 14 种风格。
// 中文等非 ASCII 字符用离屏 canvas 现场光栅化成点阵（依旧零依赖），按「双宽字符」处理；
// 服务端渲染阶段没有 canvas，这时退回空心方块占位（首屏永远是空输入，不会闪）。
//
// 本文件里出现的颜色只有两类，都属于规范允许的例外（和 CSS 渐变工具同一口径）：
//   ① 导出 PNG 时的文字色/底色 —— 那是**用户自己选的颜色**，不是界面颜色；
//   ② 示例图片与光栅化遮罩的内部填充 —— 前者是"用户文件"，后者只读 alpha，从不显示。

// #region ascii-art-engine
// 纯逻辑区（无 React / 无 DOM / 无网络）：字体点阵、字形变换、排版、灰阶映射。
// 单测就是把这整段用 tsc 转译后在 Node 里直接跑断言，测的是真正发货的这份代码。

/** 一个字形：等高的若干行，'.' 或空格表示没有墨。 */
export type GlyphRows = string[];
/** 字符 → 字形；返回 null 表示这个字符画不出来（调用方会用空心方块顶上）。 */
export type GlyphProvider = (char: string) => GlyphRows | null;

/** 点阵里的一格：0 空 / 1 主体 / 2 影子 / 3 立体挤出的斜线。 */
export type CellKind = 0 | 1 | 2 | 3;
export type Bitmap = { w: number; h: number; cells: CellKind[][] };

export type AsciiFontId =
  | "block"
  | "mini"
  | "big"
  | "wide"
  | "tall"
  | "slant"
  | "hollow"
  | "shadow"
  | "solid3d"
  | "inverse"
  | "frame"
  | "double"
  | "ascii"
  | "script";

export type AsciiAlign = "left" | "center" | "right";
export type AsciiBorderId = "none" | "single" | "double" | "round" | "ascii" | "star" | "hash";
export type AsciiCommentId =
  | "none"
  | "hash"
  | "slash"
  | "block"
  | "xml"
  | "sql"
  | "lua"
  | "vb"
  | "fortran"
  | "ini"
  | "tex"
  | "echo";

export const EMPTY_CELL: CellKind = 0;
export const MAIN_CELL: CellKind = 1;
export const SHADOW_CELL: CellKind = 2;
export const DIAG_CELL: CellKind = 3;

/** 影子层用的字符（比主体淡一档，才有"影"的感觉） */
export const SHADOW_CHAR = "░";
/** 立体挤出用的字符 */
export const DIAG_CHAR = "/";

// ── 5×5 基础点阵（A-Z / 0-9 / 常用符号，共 68 个字形）──────────────────────
// 只画大写：小写字母在取字形前统一转大写（5×5 画不出大小写区别，界面上有说明）。
const GLYPH_5X5_RAW: Record<string, string[]> = {
  " ": ["     ", "     ", "     ", "     ", "     "],
  A: [".###.", "#...#", "#####", "#...#", "#...#"],
  B: ["####.", "#...#", "####.", "#...#", "####."],
  C: [".###.", "#...#", "#....", "#...#", ".###."],
  D: ["####.", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "####.", "#....", "#####"],
  F: ["#####", "#....", "####.", "#....", "#...."],
  G: [".###.", "#...#", "#.###", "#...#", ".###."],
  H: ["#...#", "#...#", "#####", "#...#", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "#####"],
  J: ["....#", "....#", "....#", "#...#", ".###."],
  K: ["#...#", "#..#.", "###..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "####.", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "####.", "#..#.", "#...#"],
  S: [".####", "#....", ".###.", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", ".#.#.", "..#..", ".#.#.", "#...#"],
  Y: ["#...#", ".#.#.", "..#..", "..#..", "..#.."],
  Z: ["#####", "...#.", "..#..", ".#...", "#####"],
  "0": [".###.", "#..##", "#.#.#", "##..#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "..##.", ".#...", "#####"],
  "3": ["####.", "....#", ".###.", "....#", "####."],
  "4": ["#..#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "####."],
  "6": [".###.", "#....", "####.", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", "..#.."],
  "8": [".###.", "#...#", ".###.", "#...#", ".###."],
  "9": [".###.", "#...#", ".####", "....#", ".###."],
  "!": ["..#..", "..#..", "..#..", ".....", "..#.."],
  "?": [".###.", "#...#", "..##.", ".....", "..#.."],
  ".": [".....", ".....", ".....", ".##..", ".##.."],
  ",": [".....", ".....", ".....", ".##..", ".#..."],
  ":": [".....", ".##..", ".....", ".##..", "....."],
  ";": [".....", ".##..", ".....", ".##..", ".#..."],
  "-": [".....", ".....", ".###.", ".....", "....."],
  _: [".....", ".....", ".....", ".....", "#####"],
  "+": [".....", "..#..", ".###.", "..#..", "....."],
  "=": [".....", ".###.", ".....", ".###.", "....."],
  "*": [".....", "#.#.#", ".###.", "#.#.#", "....."],
  "/": ["....#", "...#.", "..#..", ".#...", "#...."],
  "\\": ["#....", ".#...", "..#..", "...#.", "....#"],
  "(": ["..##.", ".#...", ".#...", ".#...", "..##."],
  ")": [".##..", "...#.", "...#.", "...#.", ".##.."],
  "[": [".###.", ".#...", ".#...", ".#...", ".###."],
  "]": [".###.", "...#.", "...#.", "...#.", ".###."],
  "{": ["..##.", "..#..", ".##..", "..#..", "..##."],
  "}": [".##..", "..#..", "..##.", "..#..", ".##.."],
  "<": ["...#.", "..#..", ".#...", "..#..", "...#."],
  ">": [".#...", "..#..", "...#.", "..#..", ".#..."],
  "'": ["..#..", "..#..", ".....", ".....", "....."],
  '"': [".#.#.", ".#.#.", ".....", ".....", "....."],
  "&": [".##..", "#.#.#", ".##..", "#.#.#", ".##.#"],
  "@": [".###.", "#...#", "#.###", "#....", ".###."],
  "#": [".#.#.", "#####", ".#.#.", "#####", ".#.#."],
  $: ["..#..", ".####", "#.#..", ".###.", "..#.#"],
  "%": ["##..#", "##.#.", "..#..", ".#.##", "#..##"],
  "^": ["..#..", ".#.#.", "#...#", ".....", "....."],
  "~": [".....", ".#..#", "#.#.#", "#..#.", "....."],
  "|": ["..#..", "..#..", "..#..", "..#..", "..#.."],
  "`": [".#...", "..#..", ".....", ".....", "....."],
};

// ── 3×5 迷你点阵（A-Z / 0-9 / 少量符号）：只有 3 列宽，字号最小的风格 ────────
const GLYPH_3X5_RAW: Record<string, string[]> = {
  " ": ["   ", "   ", "   ", "   ", "   "],
  A: [".#.", "#.#", "###", "#.#", "#.#"],
  B: ["##.", "#.#", "##.", "#.#", "##."],
  C: [".##", "#..", "#..", "#..", ".##"],
  D: ["##.", "#.#", "#.#", "#.#", "##."],
  E: ["###", "#..", "##.", "#..", "###"],
  F: ["###", "#..", "##.", "#..", "#.."],
  G: [".##", "#..", "#.#", "#.#", ".##"],
  H: ["#.#", "#.#", "###", "#.#", "#.#"],
  I: ["###", ".#.", ".#.", ".#.", "###"],
  J: ["..#", "..#", "..#", "#.#", ".#."],
  K: ["#.#", "#.#", "##.", "#.#", "#.#"],
  L: ["#..", "#..", "#..", "#..", "###"],
  M: ["#.#", "###", "###", "#.#", "#.#"],
  N: ["##.", "#.#", "#.#", "#.#", "#.#"],
  O: [".#.", "#.#", "#.#", "#.#", ".#."],
  P: ["##.", "#.#", "##.", "#..", "#.."],
  Q: [".#.", "#.#", "#.#", "##.", ".##"],
  R: ["##.", "#.#", "##.", "#.#", "#.#"],
  S: [".##", "#..", ".#.", "..#", "##."],
  T: ["###", ".#.", ".#.", ".#.", ".#."],
  U: ["#.#", "#.#", "#.#", "#.#", ".##"],
  V: ["#.#", "#.#", "#.#", "#.#", ".#."],
  W: ["#.#", "#.#", "#.#", "###", "#.#"],
  X: ["#.#", "#.#", ".#.", "#.#", "#.#"],
  Y: ["#.#", "#.#", ".#.", ".#.", ".#."],
  Z: ["###", "..#", ".#.", "#..", "###"],
  "0": ["###", "#.#", "#.#", "#.#", "###"],
  "1": [".#.", "##.", ".#.", ".#.", "###"],
  "2": ["##.", "..#", ".#.", "#..", "###"],
  "3": ["##.", "..#", ".#.", "..#", "##."],
  "4": ["#.#", "#.#", "###", "..#", "..#"],
  "5": ["###", "#..", "##.", "..#", "##."],
  "6": [".##", "#..", "##.", "#.#", ".#."],
  "7": ["###", "..#", ".#.", ".#.", ".#."],
  "8": [".#.", "#.#", ".#.", "#.#", ".#."],
  "9": [".#.", "#.#", ".##", "..#", "##."],
  "!": [".#.", ".#.", ".#.", "...", ".#."],
  "?": [".##", "..#", ".#.", "...", ".#."],
  ".": ["...", "...", "...", ".#.", ".#."],
  ",": ["...", "...", "...", ".#.", "#.."],
  ":": ["...", ".#.", "...", ".#.", "..."],
  "-": ["...", "...", "###", "...", "..."],
  "+": ["...", ".#.", "###", ".#.", "..."],
  "/": ["..#", "..#", ".#.", "#..", "#.."],
  "'": [".#.", ".#.", "...", "...", "..."],
  "<": ["..#", ".#.", "#..", ".#.", "..#"],
  ">": ["#..", ".#.", "..#", ".#.", "#.."],
};

/** 画不出来的字符（含服务端渲染阶段的中文）用空心方块占位，一眼能看出"这里缺字"。 */
export const MISSING_BOX_5: GlyphRows = ["#####", "#...#", "#...#", "#...#", "#####"];
export const MISSING_BOX_3: GlyphRows = ["###", "#.#", "#.#", "#.#", "###"];

export const GLYPH_5X5: Record<string, GlyphRows> = GLYPH_5X5_RAW;
export const GLYPH_3X5: Record<string, GlyphRows> = GLYPH_3X5_RAW;

/**
 * 静态字形提供者（纯逻辑，Node 里也能跑）：只认 A-Z / 0-9 / 常用符号，
 * 小写自动转大写；繁体、全角、中文都不认（这里返回 null，交给调用方决定怎么兜底）。
 */
export function createStaticGlyphProvider(font: AsciiFontId): GlyphProvider {
  const narrow = font === "mini";
  return (char: string) => {
    const key = char.toUpperCase();
    const narrowGlyph = narrow ? GLYPH_3X5[key] : undefined;
    return narrowGlyph ?? GLYPH_5X5[key] ?? null;
  };
}

/** 字形的列数（取最长的一行） */
export function glyphWidth(rows: GlyphRows): number {
  return rows.reduce((max, row) => Math.max(max, row.length), 0);
}

/** 点阵字体 → 布尔点阵 */
export function rowsToBitmap(rows: GlyphRows): Bitmap {
  const h = rows.length;
  const w = glyphWidth(rows);
  const cells: CellKind[][] = rows.map((row) => {
    const line: CellKind[] = new Array(w).fill(EMPTY_CELL);
    for (let x = 0; x < row.length; x += 1) {
      if (row[x] !== " " && row[x] !== ".") line[x] = MAIN_CELL;
    }
    return line;
  });
  return { w, h, cells };
}

function emptyCells(w: number, h: number): CellKind[][] {
  return Array.from({ length: Math.max(h, 0) }, () => new Array<CellKind>(Math.max(w, 0)).fill(EMPTY_CELL));
}

/** 去掉左右两侧全空的列（字形自带的留白），让边框/对齐贴合实际内容 */
export function cropBitmap(bm: Bitmap): Bitmap {
  if (bm.w === 0 || bm.h === 0) return bm;
  let min = bm.w;
  let max = -1;
  for (let y = 0; y < bm.h; y += 1) {
    for (let x = 0; x < bm.w; x += 1) {
      if (bm.cells[y][x] !== EMPTY_CELL) {
        if (x < min) min = x;
        if (x > max) max = x;
      }
    }
  }
  if (max < 0) return { w: 0, h: bm.h, cells: emptyCells(0, bm.h) };
  const w = max - min + 1;
  const cells = emptyCells(w, bm.h);
  for (let y = 0; y < bm.h; y += 1) {
    for (let x = 0; x < w; x += 1) cells[y][x] = bm.cells[y][x + min];
  }
  return { w, h: bm.h, cells };
}

/** 把一行文字按字形横向拼成一块点阵（字形高度不齐时按底对齐，像文字落在基线上） */
export function composeLine(
  chars: string[],
  glyphs: GlyphProvider,
  spacing: number,
  missing: GlyphRows = MISSING_BOX_5,
): Bitmap {
  if (chars.length === 0) return { w: 0, h: 0, cells: [] };
  const parts = chars.map((char) => glyphs(char) ?? missing);
  const gap = Math.max(0, Math.floor(spacing));
  const height = parts.reduce((max, part) => Math.max(max, part.length), 0);
  const width = parts.reduce((sum, part) => sum + glyphWidth(part), 0) + gap * (parts.length - 1);
  const cells = emptyCells(width, height);
  let x = 0;
  parts.forEach((part, index) => {
    const offsetY = height - part.length;
    for (let y = 0; y < part.length; y += 1) {
      const row = part[y];
      const target = cells[y + offsetY];
      if (!target) continue;
      for (let i = 0; i < row.length; i += 1) {
        if (row[i] !== " " && row[i] !== "." && x + i < width) target[x + i] = MAIN_CELL;
      }
    }
    x += glyphWidth(parts[index]) + gap;
  });
  return cropBitmap({ w: width, h: height, cells });
}

// ── 字形变换（全部是纯函数，输入输出都是点阵）─────────────────────────────

/** 放大：sx 倍宽、sy 倍高 */
export function scaleBitmap(bm: Bitmap, sx: number, sy: number): Bitmap {
  const fx = Math.max(1, Math.round(sx));
  const fy = Math.max(1, Math.round(sy));
  if (fx === 1 && fy === 1) return bm;
  const w = bm.w * fx;
  const h = bm.h * fy;
  const cells = emptyCells(w, h);
  for (let y = 0; y < bm.h; y += 1) {
    for (let x = 0; x < bm.w; x += 1) {
      const value = bm.cells[y][x];
      if (value === EMPTY_CELL) continue;
      for (let dy = 0; dy < fy; dy += 1) {
        for (let dx = 0; dx < fx; dx += 1) cells[y * fy + dy][x * fx + dx] = value;
      }
    }
  }
  return { w, h, cells };
}

/** 倾斜（斜体）：越靠上的行往右挪得越多，lean = 每行的偏移系数 */
export function skewBitmap(bm: Bitmap, lean = 0.5): Bitmap {
  const shifts = Array.from({ length: bm.h }, (_, y) => Math.round((bm.h - 1 - y) * lean));
  const extra = shifts.reduce((max, value) => Math.max(max, value), 0);
  const w = bm.w + extra;
  const cells = emptyCells(w, bm.h);
  for (let y = 0; y < bm.h; y += 1) {
    for (let x = 0; x < bm.w; x += 1) {
      const value = bm.cells[y][x];
      if (value === EMPTY_CELL) continue;
      cells[y][x + shifts[y]] = value;
    }
  }
  return { w, h: bm.h, cells };
}

/** 空心：只留边界格（上下左右有一个是空的） */
export function hollowBitmap(bm: Bitmap): Bitmap {
  const filled = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < bm.w && y < bm.h && bm.cells[y][x] !== EMPTY_CELL;
  const cells = emptyCells(bm.w, bm.h);
  for (let y = 0; y < bm.h; y += 1) {
    for (let x = 0; x < bm.w; x += 1) {
      if (!filled(x, y)) continue;
      const boundary = !filled(x, y - 1) || !filled(x, y + 1) || !filled(x - 1, y) || !filled(x + 1, y);
      if (boundary) cells[y][x] = MAIN_CELL;
    }
  }
  return { w: bm.w, h: bm.h, cells };
}

/**
 * 从点阵外圈往里灌水，标出"字形外面的空格"。
 * 阴影与立体挤出只在字形外面落笔 —— 否则字母内部那个封闭的洞（比如 A 的三角孔）
 * 会被塞满影子，看着就是一坨噪点。
 */
function outsideMask(bm: Bitmap): boolean[][] {
  const mask: boolean[][] = Array.from({ length: bm.h }, () => new Array<boolean>(bm.w).fill(false));
  const stack: number[][] = [];
  const visit = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= bm.w || y >= bm.h) return;
    if (mask[y][x] || bm.cells[y][x] !== EMPTY_CELL) return;
    mask[y][x] = true;
    stack.push([x, y]);
  };
  for (let x = 0; x < bm.w; x += 1) {
    visit(x, 0);
    visit(x, bm.h - 1);
  }
  for (let y = 0; y < bm.h; y += 1) {
    visit(0, y);
    visit(bm.w - 1, y);
  }
  while (stack.length > 0) {
    const point = stack.pop();
    if (!point) break;
    const [x, y] = point;
    visit(x - 1, y);
    visit(x + 1, y);
    visit(x, y - 1);
    visit(x, y + 1);
  }
  return mask;
}

/** 目标格是否在字形外面（越界也算外面），且当前是空的；span = 结果画布比字形多出的格数 */
function canMark(bm: Bitmap, outside: boolean[][], x: number, y: number, span: number): boolean {
  if (x < 0 || y < 0 || x > bm.w + span - 1 || y > bm.h + span - 1) return false;
  if (x < bm.w && y < bm.h && bm.cells[y][x] !== EMPTY_CELL) return false;
  if (x >= bm.w || y >= bm.h) return true;
  return outside[y][x];
}

/** 字形"右下轮廓"上的格子：每行最右一格 + 每列最下一格 */
function edgeCells(bm: Bitmap): number[][] {
  const edge: number[][] = [];
  for (let y = 0; y < bm.h; y += 1) {
    for (let x = bm.w - 1; x >= 0; x -= 1) {
      if (bm.cells[y][x] !== EMPTY_CELL) {
        edge.push([x, y]);
        break;
      }
    }
  }
  for (let x = 0; x < bm.w; x += 1) {
    for (let y = bm.h - 1; y >= 0; y -= 1) {
      if (bm.cells[y][x] !== EMPTY_CELL) {
        edge.push([x, y]);
        break;
      }
    }
  }
  return edge;
}

/**
 * 阴影：把"右下轮廓"往右下挪一格画一层淡影。
 *
 * 注意这里不是把整个字形都挪一格 —— 那样字母内部的横笔画（E 的中间一横、A 的横梁）
 * 会把影子甩进字母的空当里，整行都变成噪点（实测过，很难看）。
 * 只描轮廓那一圈，出来的才是一层干净的投影。
 */
export function shadowBitmap(bm: Bitmap): Bitmap {
  const outside = outsideMask(bm);
  const cells = emptyCells(bm.w + 1, bm.h + 1);
  for (const [x, y] of edgeCells(bm)) {
    if (canMark(bm, outside, x + 1, y + 1, 1)) cells[y + 1][x + 1] = SHADOW_CELL;
  }
  for (let y = 0; y < bm.h; y += 1) {
    for (let x = 0; x < bm.w; x += 1) {
      if (bm.cells[y][x] !== EMPTY_CELL) cells[y][x] = MAIN_CELL;
    }
  }
  return { w: bm.w + 1, h: bm.h + 1, cells };
}

/** 立体：沿"右下轮廓"往右下挤出 depth 格斜线，做出厚度（同样只描轮廓，不糊字） */
export function extrudeBitmap(bm: Bitmap, depth = 2): Bitmap {
  const d = Math.max(1, Math.floor(depth));
  const outside = outsideMask(bm);
  const cells = emptyCells(bm.w + d, bm.h + d);
  for (const [x, y] of edgeCells(bm)) {
    for (let step = d; step >= 1; step -= 1) {
      if (canMark(bm, outside, x + step, y + step, d)) cells[y + step][x + step] = DIAG_CELL;
    }
  }
  for (let y = 0; y < bm.h; y += 1) {
    for (let x = 0; x < bm.w; x += 1) {
      if (bm.cells[y][x] !== EMPTY_CELL) cells[y][x] = MAIN_CELL;
    }
  }
  return { w: bm.w + d, h: bm.h + d, cells };
}

/** 反白：字挖空、其余填满（整块"实心底色"里透出字） */
export function invertBitmap(bm: Bitmap): Bitmap {
  const cells = emptyCells(bm.w, bm.h);
  for (let y = 0; y < bm.h; y += 1) {
    for (let x = 0; x < bm.w; x += 1) {
      cells[y][x] = bm.cells[y][x] === EMPTY_CELL ? MAIN_CELL : EMPTY_CELL;
    }
  }
  return { w: bm.w, h: bm.h, cells };
}

// ── 线框：把点阵描成方框字符（单线 / 双线 / 纯 ASCII 线条）─────────────────
// key = 上(1) 下(2) 左(4) 右(8) 的位掩码，值 = 该处画什么。
const BOX_SINGLE: Record<number, string> = {
  0: "·",
  1: "│",
  2: "│",
  3: "│",
  4: "─",
  5: "┘",
  6: "┐",
  7: "┤",
  8: "─",
  9: "└",
  10: "┌",
  11: "├",
  12: "─",
  13: "┴",
  14: "┬",
  15: " ",
};
const BOX_DOUBLE: Record<number, string> = {
  0: "·",
  1: "║",
  2: "║",
  3: "║",
  4: "═",
  5: "╝",
  6: "╗",
  7: "╣",
  8: "═",
  9: "╚",
  10: "╔",
  11: "╠",
  12: "═",
  13: "╩",
  14: "╦",
  15: " ",
};
// 纯 ASCII 版：拐角用 / 与 \，方向按"笔画从哪来、往哪去"选，和 classic figlet 的 O 一致。
const BOX_ASCII: Record<number, string> = {
  0: "+",
  1: "|",
  2: "|",
  3: "|",
  4: "_",
  5: "/",
  6: "\\",
  7: "+",
  8: "_",
  9: "\\",
  10: "/",
  11: "+",
  12: "_",
  13: "+",
  14: "+",
  15: " ",
};

/** 用方框字符把点阵描成线框图（内部实心区域留空，看着才像"描边"） */
export function renderOutline(bm: Bitmap, charset: Record<number, string>): string[] {
  const filled = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < bm.w && y < bm.h && bm.cells[y][x] !== EMPTY_CELL;
  const rows: string[] = [];
  for (let y = 0; y < bm.h; y += 1) {
    let line = "";
    for (let x = 0; x < bm.w; x += 1) {
      if (!filled(x, y)) {
        line += " ";
        continue;
      }
      const mask =
        (filled(x, y - 1) ? 1 : 0) |
        (filled(x, y + 1) ? 2 : 0) |
        (filled(x - 1, y) ? 4 : 0) |
        (filled(x + 1, y) ? 8 : 0);
      line += charset[mask] ?? " ";
    }
    rows.push(line);
  }
  return rows;
}

/** 实心类字体的渲染：主体用填充字符，影子用 ░，立体挤出用 / */
export function renderKinds(bm: Bitmap, fill: string, shadow = SHADOW_CHAR, diag = DIAG_CHAR): string[] {
  const main = fill === "" ? "#" : fill;
  const rows: string[] = [];
  for (let y = 0; y < bm.h; y += 1) {
    let line = "";
    for (let x = 0; x < bm.w; x += 1) {
      const value = bm.cells[y][x];
      if (value === MAIN_CELL) line += main;
      else if (value === SHADOW_CELL) line += shadow;
      else if (value === DIAG_CELL) line += diag;
      else line += " ";
    }
    rows.push(line);
  }
  return rows;
}

/** 每种字体在纵向 / 横向上的放大倍数（行宽换算要用到） */
const FONT_SCALE: Record<AsciiFontId, { sx: number; sy: number }> = {
  block: { sx: 1, sy: 1 },
  mini: { sx: 1, sy: 1 },
  big: { sx: 2, sy: 2 },
  wide: { sx: 2, sy: 1 },
  tall: { sx: 1, sy: 2 },
  slant: { sx: 1, sy: 1 },
  hollow: { sx: 1, sy: 1 },
  shadow: { sx: 1, sy: 1 },
  solid3d: { sx: 1, sy: 1 },
  inverse: { sx: 1, sy: 1 },
  frame: { sx: 1, sy: 1 },
  double: { sx: 1, sy: 1 },
  ascii: { sx: 1, sy: 1 },
  script: { sx: 1, sy: 1 },
};

export const ASCII_FONTS: {
  id: AsciiFontId;
  name: string;
  hint: string;
  usesFill: boolean;
}[] = [
  { id: "block", name: "方正", hint: "5×5 实心点阵，最经典的字符画", usesFill: true },
  { id: "big", name: "特大", hint: "正方整体放大一倍", usesFill: true },
  { id: "mini", name: "迷你", hint: "3×5 窄点阵，一行能塞更多字", usesFill: true },
  { id: "wide", name: "宽体", hint: "横向拉宽一倍", usesFill: true },
  { id: "tall", name: "长体", hint: "纵向拉高一倍", usesFill: true },
  { id: "slant", name: "斜体", hint: "整体向右倾斜", usesFill: true },
  { id: "hollow", name: "空心", hint: "放大 3 倍后只留轮廓（笔画 1 格粗时挖不出空心）", usesFill: true },
  { id: "shadow", name: "阴影", hint: "右下角带一层灰影", usesFill: true },
  { id: "solid3d", name: "立体", hint: "沿轮廓向右下挤出斜线，有厚度", usesFill: true },
  { id: "inverse", name: "反白", hint: "实心底色里把字镂空", usesFill: true },
  { id: "frame", name: "单线", hint: "用单线把字形描出来", usesFill: false },
  { id: "double", name: "双线", hint: "用双线把字形描出来", usesFill: false },
  { id: "ascii", name: "线条", hint: "纯 ASCII 的 _ | / \\ 线条", usesFill: false },
  { id: "script", name: "手写", hint: "倾斜的线条风格，像手写", usesFill: false },
];

export const ASCII_ALIGNMENTS: { value: AsciiAlign; name: string }[] = [
  { value: "left", name: "左对齐" },
  { value: "center", name: "居中" },
  { value: "right", name: "右对齐" },
];

export const ASCII_BORDERS: {
  id: AsciiBorderId;
  name: string;
  chars: { tl: string; tr: string; bl: string; br: string; h: string; v: string } | null;
}[] = [
  { id: "none", name: "不加边框", chars: null },
  { id: "single", name: "单线框", chars: { tl: "┌", tr: "┐", bl: "└", br: "┘", h: "─", v: "│" } },
  { id: "double", name: "双线框", chars: { tl: "╔", tr: "╗", bl: "╚", br: "╝", h: "═", v: "║" } },
  { id: "round", name: "圆角框", chars: { tl: "╭", tr: "╮", bl: "╰", br: "╯", h: "─", v: "│" } },
  { id: "ascii", name: "ASCII 框", chars: { tl: "+", tr: "+", bl: "+", br: "+", h: "-", v: "|" } },
  { id: "star", name: "星号框", chars: { tl: "*", tr: "*", bl: "*", br: "*", h: "*", v: "*" } },
  { id: "hash", name: "井号框", chars: { tl: "#", tr: "#", bl: "#", br: "#", h: "#", v: "#" } },
];

export const ASCII_COMMENTS: {
  id: AsciiCommentId;
  name: string;
  prefix?: string;
  suffix?: string;
  wrap?: [string, string];
  middle?: string;
}[] = [
  { id: "none", name: "不加注释符号" },
  { id: "hash", name: "Bash / Python  # ", prefix: "# " },
  { id: "slash", name: "C++ / JS  //", prefix: "// " },
  { id: "block", name: "C / Java  /* */", wrap: ["/*", "*/"], middle: " * " },
  { id: "xml", name: "HTML  <!-- -->", wrap: ["<!--", "-->"], middle: "  " },
  { id: "sql", name: "SQL / Lua  --", prefix: "-- " },
  { id: "lua", name: "Lua  --[[ ]]", wrap: ["--[[", "]]"], middle: "" },
  { id: "vb", name: "VB  '", prefix: "' " },
  { id: "fortran", name: "Fortran  !", prefix: "! " },
  { id: "ini", name: "INI / ASM  ;", prefix: "; " },
  { id: "tex", name: "LaTeX  %", prefix: "% " },
  { id: "echo", name: "Echo 命令", prefix: 'echo "', suffix: '"' },
];

/** 按选中的注释风格给整段结果套壳 */
export function applyComment(rows: string[], id: AsciiCommentId): string[] {
  if (id === "none" || rows.length === 0) return rows;
  const spec = ASCII_COMMENTS.find((item) => item.id === id);
  if (!spec) return rows;
  if (spec.wrap) {
    const [open, close] = spec.wrap;
    const middle = spec.middle ?? "";
    const isBlock = id === "block";
    return [
      open,
      ...rows.map((row) => (isBlock && row.trim() === "" ? " *" : `${middle}${row}`)),
      // 块注释的收尾行缩进一格，和中间行的 " * " 对齐
      isBlock ? ` ${close}` : close,
    ];
  }
  const prefix = spec.prefix ?? "";
  const suffix = spec.suffix ?? "";
  return rows.map((row) => `${prefix}${row}${suffix}`);
}

/** 给整段结果加一层边框（左右各留一列空白，不然字和框线会粘在一起） */
export function applyBorder(rows: string[], id: AsciiBorderId): string[] {
  const spec = ASCII_BORDERS.find((item) => item.id === id);
  if (!spec?.chars || rows.length === 0) return rows;
  const { tl, tr, bl, br, h, v } = spec.chars;
  const inner = rows.reduce((max, row) => Math.max(max, [...row].length), 0);
  const top = tl + h.repeat(inner + 2) + tr;
  const bottom = bl + h.repeat(inner + 2) + br;
  const body = rows.map((row) => {
    const pad = inner - [...row].length;
    return `${v} ${row}${" ".repeat(Math.max(0, pad))} ${v}`;
  });
  return [top, ...body, bottom];
}

function padRows(rows: string[], align: AsciiAlign): string[] {
  const width = rows.reduce((max, row) => Math.max(max, [...row].length), 0);
  if (align === "left" || width === 0) return rows;
  return rows.map((row) => {
    const pad = width - [...row].length;
    if (pad <= 0) return row;
    if (align === "right") return " ".repeat(pad) + row;
    const left = Math.floor(pad / 2);
    return " ".repeat(left) + row + " ".repeat(pad - left);
  });
}

/**
 * 按"行宽（列数）"折行。
 * 每一列的宽度由字形自己决定（迷你 3 列、方正 5 列、中文点阵 12 列），
 * 所以先用字形量出真实宽度再贪心塞，塞不下时优先在最近的空格处断（保证不把单词劈开）。
 */
export function wrapChars(
  chars: string[],
  glyphs: GlyphProvider,
  spacing: number,
  maxWidth: number,
  missing: GlyphRows = MISSING_BOX_5,
  scaleX = 1,
): string[][] {
  if (chars.length === 0) return [[]];
  if (maxWidth <= 0) return [chars];
  const gap = Math.max(0, Math.floor(spacing)) * scaleX;
  const widthOf = (char: string) => glyphWidth(glyphs(char) ?? missing) * scaleX + gap;
  const total = (list: string[]) => list.reduce((sum, char) => sum + widthOf(char), 0) - gap * Math.max(0, list.length - 1);
  const lines: string[][] = [];
  let current: string[] = [];
  for (const char of chars) {
    const next = [...current, char];
    if (current.length > 0 && total(next) > maxWidth) {
      const breakAt = current.lastIndexOf(" ");
      if (breakAt > 0) {
        lines.push(current.slice(0, breakAt));
        current = current.slice(breakAt + 1);
        // 断在空格处之后，剩下的尾巴如果自己还是超宽，就只能硬断
        if (current.length > 0 && total([...current, char]) > maxWidth) {
          lines.push(current);
          current = [];
        }
      } else {
        lines.push(current);
        current = [];
      }
    }
    // 行首不排空格：断在空格处时，那个空格就当作断点被吃掉了
    if (current.length === 0 && char === " ") continue;
    current.push(char);
  }
  if (current.length > 0) lines.push(current);
  return lines.length > 0 ? lines : [[]];
}

export type AsciiArtOptions = {
  font: AsciiFontId;
  fill: string;
  /** 字母间距（列） */
  spacing: number;
  /** 行宽上限（列）；0 表示不折行 */
  maxWidth: number;
  align: AsciiAlign;
  border: AsciiBorderId;
  comment: AsciiCommentId;
  glyphs: GlyphProvider;
  missing?: GlyphRows;
};

/** 主入口：文字 → 字符画（同步、纯函数，Node 里可断言） */
export function renderAsciiArt(input: string, options: AsciiArtOptions): string {
  const { font, fill, glyphs, missing = MISSING_BOX_5, align, border, comment } = options;
  const spacing = Math.max(0, Math.floor(options.spacing));
  const maxWidth = Math.max(0, Math.floor(options.maxWidth));
  const scaleX = FONT_SCALE[font].sx;
  const source = input.replace(/\r\n?/g, "\n");
  const blocks: string[][] = [];
  for (const raw of source.split("\n")) {
    const chars = [...raw].map((char) => (char === "\t" ? " " : char));
    const wrapped = wrapChars(chars, glyphs, spacing, maxWidth, missing, scaleX);
    for (const line of wrapped) {
      const bitmap = composeLine(line, glyphs, spacing, missing);
      blocks.push(renderFontRows(bitmap, font, fill));
    }
  }
  if (blocks.length === 0) return "";
  const rows: string[] = [];
  for (const block of blocks) {
    if (block.length === 0) continue;
    rows.push(...block);
  }
  const trimmed = trimRows(rows);
  if (trimmed.length === 0) return "";
  return applyComment(applyBorder(padRows(trimmed, align), border), comment).join("\n");
}

/** 去掉整行全空的头尾（换行符产生的空行），中间的空行保留 */
export function trimRows(rows: string[]): string[] {
  let start = 0;
  let end = rows.length;
  while (start < end && rows[start].trim() === "") start += 1;
  while (end > start && rows[end - 1].trim() === "") end -= 1;
  return rows.slice(start, end);
}

/** 把点阵按字体风格画成字符行 */
export function renderFontRows(bm: Bitmap, font: AsciiFontId, fill: string): string[] {
  switch (font) {
    case "big":
      return renderKinds(scaleBitmap(bm, 2, 2), fill);
    case "wide":
      return renderKinds(scaleBitmap(bm, 2, 1), fill);
    case "tall":
      return renderKinds(scaleBitmap(bm, 1, 2), fill);
    case "slant":
      return renderKinds(skewBitmap(bm, 0.5), fill);
    case "hollow":
      // 5×5 点阵的笔画只有 1 格粗，直接挖空等于什么都没挖（实测空心和方正一模一样），
      // 所以先放大 3 倍让笔画变粗，再挖掉内部 —— 出来的才是真正的"空心描边字"。
      return renderKinds(hollowBitmap(scaleBitmap(bm, 3, 3)), fill);
    case "shadow":
      return renderKinds(shadowBitmap(bm), fill);
    case "solid3d":
      return renderKinds(extrudeBitmap(bm, 2), fill);
    case "inverse":
      return renderKinds(invertBitmap(bm), fill);
    case "frame":
      return renderOutline(bm, BOX_SINGLE);
    case "double":
      return renderOutline(bm, BOX_DOUBLE);
    case "ascii":
      return renderOutline(bm, BOX_ASCII);
    case "script":
      return renderOutline(skewBitmap(bm, 0.5), BOX_ASCII);
    case "mini":
    case "block":
    default:
      return renderKinds(bm, fill);
  }
}

export type ArtStats = {
  /** 结果行数 */
  lines: number;
  /** 最宽一行的列数 */
  columns: number;
  /** 结果总字符数（含空格与换行） */
  chars: number;
};

export function measureArt(art: string): ArtStats {
  if (art === "") return { lines: 0, columns: 0, chars: 0 };
  const rows = art.split("\n");
  return {
    lines: rows.length,
    columns: rows.reduce((max, row) => Math.max(max, [...row].length), 0),
    chars: rows.reduce((sum, row) => sum + [...row].length, 0),
  };
}

/** 需要走 canvas 光栅化的字符（非 ASCII 可打印字符；换行/制表符不算） */
export function needsRasterGlyphs(input: string): boolean {
  for (const char of [...input]) {
    const code = char.codePointAt(0) ?? 0;
    if (code === 9 || code === 10 || code === 13) continue;
    if (code > 0x7e || code < 0x20) return true;
  }
  return false;
}

// ── 图片转字符画（纯逻辑）────────────────────────────────────────────────

export const IMAGE_RAMPS: { id: string; name: string; chars: string }[] = [
  { id: "standard", name: "标准 10 级", chars: " .:-=+*#%@" },
  {
    id: "detailed",
    name: "细密 70 级",
    chars: " .'`^\",:;Il!i~+_-?][}{1)(|\\/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$",
  },
  { id: "minimal", name: "简约 5 级", chars: " .:*#@" },
  { id: "blocks", name: "方块密度", chars: " ░▒▓█" },
  { id: "custom", name: "自定义", chars: "" },
];

/** 结果区最多多少列 / 多少行（和站点一样限 300，超了既看不清也拖慢渲染） */
export const IMAGE_MIN_COLS = 20;
export const IMAGE_MAX_COLS = 300;

export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

/** sRGB 亮度（Rec.709 系数）—— 灰阶映射的唯一依据 */
export function luminance(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** 单通道灰度 → 字符：灰阶越高，取字符集里越靠后的字符（反色则反过来） */
export function grayToChar(gray: number, ramp: string, invert: boolean): string {
  const chars = [...ramp];
  if (chars.length === 0) return " ";
  const value = Number.isFinite(gray) ? Math.min(255, Math.max(0, gray)) : 0;
  const mapped = invert ? 255 - value : value;
  const index = Math.round((mapped / 255) * (chars.length - 1));
  return chars[clampInt(index, 0, chars.length - 1)];
}

/** 自定义字符集：去掉换行与重复字符；少于 2 个字符就退回过默认字符集 */
export function normalizeRamp(input: string, fallback: string): string {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const char of [...input.replace(/[\r\n\t]/g, "")]) {
    if (seen.has(char)) continue;
    seen.add(char);
    out.push(char);
  }
  return out.length >= 2 ? out.join("") : fallback;
}

/**
 * 按列数算行数：等宽字符的高大约是宽的 2 倍，
 * 所以一张正方形的图用 N 列画出来只需要 N/2 行（cellAspect = 0.5）。
 */
export function computeImageRows(cols: number, srcWidth: number, srcHeight: number, cellAspect = 0.5): number {
  const c = clampInt(cols, IMAGE_MIN_COLS, IMAGE_MAX_COLS);
  if (!Number.isFinite(srcWidth) || !Number.isFinite(srcHeight) || srcWidth <= 0 || srcHeight <= 0) return 0;
  return clampInt((c * srcHeight * cellAspect) / srcWidth, 1, IMAGE_MAX_COLS);
}

export type ImageAsciiCell = { char: string; r: number; g: number; b: number };

export type PixelSource = { data: ArrayLike<number>; width: number; height: number };

/**
 * 像素 → 字符网格。data 是 canvas 的 RGBA 平铺数组（已按目标尺寸缩放好）。
 * 纯函数：单测直接喂构造出来的像素数组即可。
 */
export function pixelsToCells(
  source: PixelSource,
  options: { ramp: string; invert: boolean; colored: boolean },
): ImageAsciiCell[][] {
  const ramp = options.ramp === "" ? " " : options.ramp;
  const grid: ImageAsciiCell[][] = [];
  for (let y = 0; y < source.height; y += 1) {
    const row: ImageAsciiCell[] = [];
    for (let x = 0; x < source.width; x += 1) {
      const offset = (y * source.width + x) * 4;
      const r = source.data[offset] ?? 0;
      const g = source.data[offset + 1] ?? 0;
      const b = source.data[offset + 2] ?? 0;
      const alpha = source.data[offset + 3] ?? 255;
      // 透明的地方当白底处理（PNG 透明背景常见），否则边缘会糊成一团黑
      const mix = alpha / 255;
      const rr = r * mix + 255 * (1 - mix);
      const gg = g * mix + 255 * (1 - mix);
      const bb = b * mix + 255 * (1 - mix);
      row.push({
        char: grayToChar(luminance(rr, gg, bb), ramp, options.invert),
        r: Math.round(rr),
        g: Math.round(gg),
        b: Math.round(bb),
      });
    }
    grid.push(row);
  }
  return grid;
}

/** 字符网格 → 每行的文本（行尾空格去掉，不然复制出来一片拖尾空格） */
export function cellsToLines(cells: ImageAsciiCell[][]): string[] {
  return cells.map((row) => row.map((cell) => cell.char).join("").replace(/\s+$/, ""));
}

export function cellsToText(cells: ImageAsciiCell[][]): string {
  return cellsToLines(cells).join("\n");
}

/** 结果里出现了多少个"替换字符"（画不出来的字符），用来给用户一句人话提示 */
export function countMissingGlyphs(input: string, glyphs: GlyphProvider): number {
  let count = 0;
  for (const char of [...input]) {
    if (char === "\n" || char === "\r" || char === "\t") continue;
    if (glyphs(char) === null) count += 1;
  }
  return count;
}

// #endregion ascii-art-engine


// ── 7.1 非 ASCII 字符的光栅化（浏览器侧，零依赖）───────────────────────────
//
// 中文、日文、全角符号没有点阵数据，也不该硬编码进来 —— 所以这里现场用离屏 canvas
// 把字形画出来，只读 alpha 通道得到一个 12×12 的点阵，再喂给同一套字形变换。
// 按"双宽字符"处理：中文占 12 列，拉丁字母占 12 列的一半（5×5 点阵放大一倍 = 10 列）。
// 服务端渲染阶段拿不到 canvas（返回 null），这时会退回空心方块占位。

/** 混排模式下一个字格的高度（也是中文点阵的边长） */
const MIXED_BOX = 12;
/** 混排模式下拉丁字形的放大倍数：5×5 → 10×10，底对齐放进 12 行的格子里 */
const MIXED_LATIN_SCALE = 2;
const rasterCache = new Map<string, GlyphRows>();

function scaleGlyphRows(rows: GlyphRows, factor: number): GlyphRows {
  const out: string[] = [];
  for (const row of rows) {
    const wide = [...row].map((char) => char.repeat(factor)).join("");
    for (let i = 0; i < factor; i += 1) out.push(wide);
  }
  return out;
}

function alignGlyphRows(rows: GlyphRows, height: number): GlyphRows {
  const width = rows.reduce((max, row) => Math.max(max, row.length), 0);
  const pad = Math.max(0, height - rows.length);
  const blank = " ".repeat(width);
  return [...Array.from({ length: pad }, () => blank), ...rows];
}

/** 混排模式下的缺字占位（和拉丁字形一样放大后底对齐） */
const MIXED_MISSING: GlyphRows = alignGlyphRows(
  scaleGlyphRows(MISSING_BOX_5, MIXED_LATIN_SCALE),
  MIXED_BOX,
);

/**
 * 把一个字符画成 size×size 的点阵。只读 alpha，所以填充色是什么无所谓（这里用关键字黑，
 * 不用写死十六进制色值）；描边阈值取 96，太细的笔画会糊，太粗会粘连。
 */
function rasterizeGlyph(char: string, size: number): GlyphRows | null {
  if (typeof document === "undefined") return null;
  const key = `${size}\u0000${char}`;
  const cached = rasterCache.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = "black";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `700 ${Math.round(size * 0.94)}px "Microsoft YaHei", "PingFang SC", system-ui, sans-serif`;
  ctx.fillText(char, size / 2, size / 2);
  const data = ctx.getImageData(0, 0, size, size).data;
  const rows: GlyphRows = [];
  let inked = 0;
  for (let y = 0; y < size; y += 1) {
    let row = "";
    for (let x = 0; x < size; x += 1) {
      const alpha = data[(y * size + x) * 4 + 3];
      const on = alpha > 96;
      if (on) inked += 1;
      row += on ? "#" : " ";
    }
    rows.push(row);
  }
  if (inked === 0) return null;
  rasterCache.set(key, rows);
  return rows;
}

/**
 * 混排字形提供者：拉丁字符用静态点阵放大后底对齐，其余（中文等）现场光栅化。
 * 光栅化失败（服务端渲染、Emoji 之类）就返回 null，由渲染器用空心方块顶上。
 */
function createMixedGlyphProvider(font: AsciiFontId): GlyphProvider {
  const staticProvider = createStaticGlyphProvider(font);
  return (char: string) => {
    const base = staticProvider(char);
    if (base) return alignGlyphRows(scaleGlyphRows(base, MIXED_LATIN_SCALE), MIXED_BOX);
    return rasterizeGlyph(char, MIXED_BOX);
  };
}

// ── 7.2 图片模式用到的浏览器侧小工具（取样、画布渲染、下载）───────────────

/** 把图片缩到 cols×rows 的小画布上，再读回像素 —— 缩放交给浏览器（质量比自己采样好） */
function samplePixels(bitmap: ImageBitmap, cols: number, rows: number): PixelSource | null {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, cols);
  canvas.height = Math.max(1, rows);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  return { data, width: canvas.width, height: canvas.height };
}

const ART_FONT_SIZE = 16;
const ART_PAD = 12;

/**
 * 把字符网格画到画布上（黑白就整行同色，彩色就逐字上色）。
 * 等宽字体的字符宽度用 measureText 量出来，这样每一列都严丝合缝。
 */
function drawArtToCanvas(
  canvas: HTMLCanvasElement,
  cells: ImageAsciiCell[][],
  options: { colored: boolean; fg: string; bg: string },
): boolean {
  const rows = cells.length;
  const cols = rows > 0 ? cells[0].length : 0;
  if (rows === 0 || cols === 0) return false;
  const ctx = canvas.getContext("2d");
  if (!ctx) return false;
  const font = `${ART_FONT_SIZE}px ui-monospace, "Cascadia Code", Consolas, monospace`;
  ctx.font = font;
  const advance = Math.max(1, ctx.measureText("M".repeat(20)).width / 20);
  const lineHeight = Math.round(ART_FONT_SIZE * 1.25);
  canvas.width = Math.ceil(advance * cols) + ART_PAD * 2;
  canvas.height = lineHeight * rows + ART_PAD * 2;
  // 改过尺寸以后画布状态会重置，字体和基线要重设
  ctx.font = font;
  ctx.textBaseline = "top";
  ctx.fillStyle = options.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      const cell = cells[y][x];
      if (!cell) continue;
      ctx.fillStyle = options.colored ? `rgb(${cell.r},${cell.g},${cell.b})` : options.fg;
      ctx.fillText(cell.char, ART_PAD + x * advance, ART_PAD + y * lineHeight);
    }
  }
  return true;
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("导出 PNG 失败，请换一张小一点的图片"));
    }, "image/png");
  });
}

/**
 * 示例图片：中等明度的渐变底 + 一深一浅两个圆。
 * 特意不用"深底 + 亮图形"（那种图黑白模式好看，但彩色模式下字符颜色本身就很暗，
 * 配深色底几乎看不见）；中等明度在两种模式下都立得住。
 */
function createSampleImageFile(): Promise<File> {
  return new Promise((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = 480;
    canvas.height = 320;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      reject(new Error("浏览器不支持画布，换一个浏览器试试"));
      return;
    }
    const sky = ctx.createLinearGradient(0, 0, 480, 320);
    sky.addColorStop(0, "hsl(205 62% 46%)");
    sky.addColorStop(1, "hsl(292 48% 38%)");
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "hsl(48 96% 88%)";
    ctx.beginPath();
    ctx.arc(180, 160, 78, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "hsl(220 55% 16%)";
    ctx.beginPath();
    ctx.arc(300, 160, 78, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "hsl(0 0% 100%)";
    ctx.font = "700 44px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("FURINA", 240, 288);
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(new Error("生成示例图片失败"));
        return;
      }
      resolve(new File([blob], "ascii-sample.png", { type: "image/png" }));
    }, "image/png");
  });
}

// ── 7.3 界面 ──────────────────────────────────────────────────────────────

type AsciiMode = "text" | "image";
type BinaryChoice = "normal" | "alter";

/** 填充字符：都是画得出连续图形的字符，避免结果被"撑破" */
const ASCII_FILL_CHARS = ["#", "@", "*", "+", "█", "▓", "▒", "◆"];

const ASCII_MODE_OPTIONS: {
  value: AsciiMode;
  label: string;
  icon: ComponentType<{ className?: string }>;
}[] = [
  { value: "text", label: "字符画", icon: TypeIcon },
  { value: "image", label: "图片转字符画", icon: ImageIcon },
];

const ASCII_FONT_OPTIONS: { value: AsciiFontId; label: string }[] = ASCII_FONTS.map((item) => ({
  value: item.id,
  label: item.name,
}));

const ASCII_ALIGN_OPTIONS: { value: AsciiAlign; label: string }[] = ASCII_ALIGNMENTS.map((item) => ({
  value: item.value,
  label: item.name,
}));

const ASCII_EXAMPLE_TEXT = "FURINA\n你好";
const ASCII_COL_PRESETS = [80, 120, 160, 240];

const ASCII_COLOR_OPTIONS: { value: BinaryChoice; label: string }[] = [
  { value: "normal", label: "黑白" },
  { value: "alter", label: "彩色" },
];

const ASCII_INVERT_OPTIONS: { value: BinaryChoice; label: string }[] = [
  { value: "normal", label: "正常" },
  { value: "alter", label: "反色" },
];

/** 导出 PNG 的默认色（用户可改；属于"用户内容"，不是界面颜色） */
const ART_EXPORT_FG = "#e5e7eb";
const ART_EXPORT_BG = "#111827";

export function AsciiArtTool() {
  const [mode, setMode] = useToolDraft<AsciiMode>("ascii-art", "mode", "text");

  // 文字模式
  const [text, setText] = useToolDraft("ascii-art", "text", "");
  const [font, setFont] = useToolDraft<AsciiFontId>("ascii-art", "font", "block");
  const [fill, setFill] = useToolDraft("ascii-art", "fill", "#");
  const [spacingRaw, setSpacingRaw] = useToolDraft("ascii-art", "spacing", "1");
  const [maxWidthRaw, setMaxWidthRaw] = useToolDraft("ascii-art", "maxWidth", "0");
  const [align, setAlign] = useToolDraft<AsciiAlign>("ascii-art", "align", "left");
  const [border, setBorder] = useToolDraft<AsciiBorderId>("ascii-art", "border", "none");
  const [comment, setComment] = useToolDraft<AsciiCommentId>("ascii-art", "comment", "none");

  // 图片模式
  const [imageColsRaw, setImageColsRaw] = useToolDraft("ascii-art", "imageCols", "120");
  const [rampId, setRampId] = useToolDraft("ascii-art", "ramp", "standard");
  const [customRamp, setCustomRamp] = useToolDraft("ascii-art", "customRamp", "");
  const [invertChoice, setInvertChoice] = useToolDraft<BinaryChoice>("ascii-art", "invert", "normal");
  const [colorChoice, setColorChoice] = useToolDraft<BinaryChoice>("ascii-art", "colorMode", "normal");
  const [exportFg, setExportFg] = useToolDraft("ascii-art", "exportFg", ART_EXPORT_FG);
  const [exportBg, setExportBg] = useToolDraft("ascii-art", "exportBg", ART_EXPORT_BG);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [imageInfo, setImageInfo] = useState<{ name: string; size: number; width: number; height: number } | null>(
    null,
  );
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const colorCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const bitmapRef = useRef<ImageBitmap | null>(null);
  const urlRef = useRef<string | null>(null);

  // ── 文字模式：全部在本地实时算，没有按钮、不等网络 ──
  const spacing = clampInt(Number(spacingRaw), 0, 6);
  const maxWidth = clampInt(Number(maxWidthRaw), 0, 2000);
  const rampSource = IMAGE_RAMPS.find((item) => item.id === rampId) ?? IMAGE_RAMPS[0];
  const ramp = rampId === "custom" ? normalizeRamp(customRamp, IMAGE_RAMPS[0].chars) : rampSource.chars;
  const colored = colorChoice === "alter";
  const inverted = invertChoice === "alter";
  const fontSpec = ASCII_FONTS.find((item) => item.id === font) ?? ASCII_FONTS[0];
  const usesFill = fontSpec.usesFill;

  const mixed = needsRasterGlyphs(text);
  const glyphs = useMemo<GlyphProvider>(
    () => (mixed ? createMixedGlyphProvider(font) : createStaticGlyphProvider(font)),
    [mixed, font],
  );

  const art = useMemo(
    () =>
      renderAsciiArt(text, {
        font,
        fill,
        spacing,
        maxWidth,
        align,
        border,
        comment,
        glyphs,
        missing: mixed ? MIXED_MISSING : MISSING_BOX_5,
      }),
    [text, font, fill, spacing, maxWidth, align, border, comment, glyphs, mixed],
  );
  const artStats = useMemo(() => measureArt(art), [art]);
  const missingCount = useMemo(() => countMissingGlyphs(text, glyphs), [text, glyphs]);

  // ── 图片模式：缩放到目标分辨率后按灰阶映射成字符 ──
  const imageCols = clampInt(Number(imageColsRaw), IMAGE_MIN_COLS, IMAGE_MAX_COLS);

  const imageGrid = useMemo<ImageAsciiCell[][]>(() => {
    if (!bitmap) return [];
    const rows = computeImageRows(imageCols, bitmap.width, bitmap.height);
    if (rows <= 0) return [];
    const pixels = samplePixels(bitmap, imageCols, rows);
    if (!pixels) return [];
    return pixelsToCells(pixels, { ramp, invert: inverted, colored });
  }, [bitmap, imageCols, ramp, inverted, colored]);

  const imageText = useMemo(() => cellsToText(imageGrid), [imageGrid]);
  const imageStats = useMemo(() => measureArt(imageText), [imageText]);

  // 彩色预览直接画在可见画布上（和导出的 PNG 是同一套绘制代码，所见即所得）
  useEffect(() => {
    const canvas = colorCanvasRef.current;
    if (!canvas || !colored || imageGrid.length === 0) return;
    drawArtToCanvas(canvas, imageGrid, { colored: true, fg: exportFg, bg: exportBg });
  }, [imageGrid, colored, exportFg, exportBg]);

  const releaseImage = useCallback(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    bitmapRef.current?.close?.();
    bitmapRef.current = null;
  }, []);

  const loadFile = useCallback(
    async (file: File | null | undefined) => {
      if (!file) return;
      if (!file.type.startsWith("image/") && !/\.(png|jpe?g|gif|webp|bmp)$/i.test(file.name)) {
        setImageError("这不是图片文件，请选 PNG / JPG / WebP / GIF / BMP");
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        setImageError("图片超过 10MB，先用「图片压缩」压一下再来");
        return;
      }
      setBusy(true);
      setImageError(null);
      try {
        const next = await createImageBitmap(file);
        releaseImage();
        bitmapRef.current = next;
        urlRef.current = URL.createObjectURL(file);
        setBitmap(next);
        setImageInfo({ name: file.name, size: file.size, width: next.width, height: next.height });
        setImageUrl(urlRef.current);
      } catch {
        setImageError("这张图片打不开，换一张试试");
      } finally {
        setBusy(false);
      }
    },
    [releaseImage],
  );

  const clearImage = useCallback(() => {
    releaseImage();
    setBitmap(null);
    setImageInfo(null);
    setImageUrl(null);
    setImageError(null);
  }, [releaseImage]);

  // 组件卸载时释放位图与预览链接
  useEffect(() => releaseImage, [releaseImage]);

  // 接收全局拖拽 / 其他工具移交过来的图片（本工具是收文件的，要自己取这份交接）
  useEffect(() => {
    const pending = consumePendingFiles();
    if (pending.length === 0) return;
    setMode("image");
    void loadFile(pending[0]);
  }, [loadFile, setMode]);

  const loadSampleImage = async () => {
    try {
      setMode("image");
      await loadFile(await createSampleImageFile());
    } catch (err) {
      setImageError(err instanceof Error ? err.message : "生成示例图片失败");
    }
  };

  const resetText = () => {
    setText("");
    setFont("block");
    setFill("#");
    setSpacingRaw("1");
    setMaxWidthRaw("0");
    setAlign("left");
    setBorder("none");
    setComment("none");
    setHint(null);
  };

  const exportText = () => {
    if (!art) return;
    downloadBlob(new Blob([art], { type: "text/plain;charset=utf-8" }), "字符画.txt");
  };

  const exportImageText = () => {
    if (!imageText) return;
    downloadBlob(new Blob([imageText], { type: "text/plain;charset=utf-8" }), "图片字符画.txt");
  };

  const exportImagePng = async () => {
    if (imageGrid.length === 0) return;
    const canvas = document.createElement("canvas");
    const ok = drawArtToCanvas(canvas, imageGrid, { colored, fg: exportFg, bg: exportBg });
    if (!ok) {
      setHint("画布创建失败，请换一张小一点的图片");
      return;
    }
    try {
      downloadBlob(await canvasToPngBlob(canvas), `图片字符画-${imageStats.columns}x${imageStats.lines}.png`);
      setHint("PNG 已导出（尺寸就是上面的列数 × 行数）");
    } catch (err) {
      setHint(err instanceof Error ? err.message : "导出 PNG 失败");
    }
  };

  return (
    <div className="space-y-4">
      {/* 顶部只放模式切换与小字提示：工具名和描述由公共外壳负责 */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/70 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-4">
        <Segmented value={mode} options={ASCII_MODE_OPTIONS} onChange={setMode} />
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <Badge>纯前端 · 不联网</Badge>
          <span className="hidden sm:inline">
            {mode === "text"
              ? `${ASCII_FONTS.length} 种字体风格，边打字边出图`
              : "图片在本机缩放取样，不上传"}
          </span>
        </div>
      </div>

      {mode === "text" ? (
        <>
          {/* 上方：输入 + 参数带。
              字体风格那一排独占一整行（14 个风格在窄列里会折成 3 行，白白吃掉近百像素高度），
              下面再把「输入」和「参数」并成两列 —— 这样高度压得住，结果区能留在首屏里。 */}
          <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Label>字体风格</Label>
                <span className="text-xs text-muted-foreground">{fontSpec.hint}</span>
                {usesFill ? null : <Badge variant="outline">线条风格不需要填充字符</Badge>}
              </div>
              <Segmented value={font} options={ASCII_FONT_OPTIONS} onChange={setFont} />
            </div>

            <div className="grid gap-5 border-t border-border/40 pt-4 lg:grid-cols-12">
              <div className="space-y-3 lg:col-span-5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Label htmlFor="ascii-text">要转换的文字</Label>
                    <Badge variant="outline">小写自动转大写</Badge>
                    {mixed ? <Badge variant="outline">中文按双宽点阵</Badge> : null}
                  </div>
                  <span className="font-mono-accent text-[10px] uppercase tracking-widest text-muted-foreground">
                    {[...text].length} / 120
                  </span>
                </div>

                <div className="relative">
                  <Textarea
                    id="ascii-text"
                    value={text}
                    onChange={(event) => setText(event.target.value.slice(0, 120))}
                    placeholder={"输入文字，例如 HELLO\n可以回车换行，支持中文"}
                    spellCheck={false}
                    autoComplete="off"
                    className="font-mono-accent"
                  />
                  <div className="absolute right-3 top-3">
                    <PasteButton onPaste={(value) => setText(value.slice(0, 120))} />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => setText(ASCII_EXAMPLE_TEXT)}>
                    <Sparkles className="h-3.5 w-3.5" />
                    填入示例
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={resetText}>
                    <Eraser className="h-3.5 w-3.5" />
                    清空
                  </Button>
                  {missingCount > 0 ? (
                    <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <AlertTriangle className="h-3.5 w-3.5 text-primary" />
                      {missingCount} 个字符没有字形，用空心方块顶上
                    </span>
                  ) : null}
                </div>
              </div>

              <div className="space-y-4 lg:col-span-7">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Label>填充字符</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {ASCII_FILL_CHARS.map((char) => (
                        <button
                          key={char}
                          type="button"
                          disabled={!usesFill}
                          onClick={() => setFill(char)}
                          aria-label={`填充字符 ${char}`}
                          title={usesFill ? `用 ${char} 填充` : "当前字体风格不使用填充字符"}
                          className={cn(
                            "flex h-8 w-8 items-center justify-center rounded-lg border font-mono-accent text-sm transition-all",
                            char === fill && usesFill
                              ? "border-primary/50 bg-primary/10 text-primary"
                              : "border-border/70 bg-card text-muted-foreground hover:bg-secondary hover:text-foreground",
                            !usesFill && "cursor-not-allowed opacity-40 hover:bg-card hover:text-muted-foreground",
                          )}
                        >
                          {char}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>对齐</Label>
                    <Segmented value={align} options={ASCII_ALIGN_OPTIONS} onChange={setAlign} />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="ascii-border">边框</Label>
                    <Select
                      id="ascii-border"
                      value={border}
                      onChange={(event) => setBorder(event.target.value as AsciiBorderId)}
                    >
                      {ASCII_BORDERS.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="ascii-comment">注释风格</Label>
                    <Select
                      id="ascii-comment"
                      value={comment}
                      onChange={(event) => setComment(event.target.value as AsciiCommentId)}
                    >
                      {ASCII_COMMENTS.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="ascii-width">行宽（列）</Label>
                    <Input
                      id="ascii-width"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={2000}
                      value={maxWidthRaw}
                      onChange={(event) => setMaxWidthRaw(event.target.value)}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="ascii-spacing">字母间距（列）</Label>
                    <Input
                      id="ascii-spacing"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={6}
                      value={spacingRaw}
                      onChange={(event) => setSpacingRaw(event.target.value)}
                    />
                  </div>
                </div>

                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  行宽 0 = 不折行（建议 100 以上，太小会放不下一个字）；字母间距可填 0–6 列，默认 1 列。
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-sm backdrop-blur-md">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground">字符画</h3>
                {art ? (
                  <Badge variant="outline">
                    {artStats.lines} 行 · 最宽 {artStats.columns} 列 · {artStats.chars} 字符
                  </Badge>
                ) : null}
                <span className="font-mono-accent text-[10px] uppercase tracking-widest text-muted-foreground">
                  {fontSpec.name}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <CopyButton text={art} label="复制字符画" />
                <Button type="button" variant="outline" size="sm" onClick={exportText} disabled={!art}>
                  <Download className="h-3.5 w-3.5" />
                  导出 .txt
                </Button>
              </div>
            </div>

            {art ? (
              <pre className="thin-scroll max-h-[60vh] overflow-auto rounded-xl border border-border/60 bg-muted/30 p-4 font-mono-accent text-sm leading-none whitespace-pre text-foreground">
                {art}
              </pre>
            ) : (
              <div className="space-y-3 rounded-xl border border-dashed border-border/70 bg-card/40 px-6 py-10 text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <TypeIcon className="h-5 w-5" />
                </span>
                <p className="text-sm font-medium text-foreground">输入文字就能看到大字符画</p>
                <p className="mx-auto max-w-md text-xs leading-relaxed text-muted-foreground">
                  结果随输入实时更新，不需要点生成；换字体风格、改间距都会立刻重画。
                </p>
                <Button type="button" variant="outline" size="sm" onClick={() => setText(ASCII_EXAMPLE_TEXT)}>
                  <Sparkles className="h-3.5 w-3.5" />
                  填入示例
                </Button>
              </div>
            )}
          </div>
        </>
      ) : (
        <>
          <div className="space-y-4 rounded-2xl border border-border/70 bg-card p-5 shadow-xs">
            {imageInfo && imageUrl ? (
              <div className="flex flex-wrap items-center gap-4">
                {/* 预览用的是本机 object URL，图片不会离开这台电脑 */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={imageUrl}
                  alt={imageInfo.name}
                  className="h-20 w-20 rounded-xl border border-border/70 object-cover"
                />
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate text-sm font-medium text-foreground">{imageInfo.name}</p>
                  <p className="font-mono-accent text-[11px] text-muted-foreground">
                    {imageInfo.width} × {imageInfo.height} px · {formatBytes(imageInfo.size)}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                      <Upload className="h-3.5 w-3.5" />
                      换一张
                    </Button>
                    <Button type="button" variant="ghost" size="sm" onClick={clearImage}>
                      <X className="h-3.5 w-3.5" />
                      移除图片
                    </Button>
                  </div>
                </div>
                <Badge variant="outline">行数由宽度和图片比例自动算</Badge>
              </div>
            ) : (
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  void loadFile(event.dataTransfer?.files?.[0]);
                }}
                className={cn(
                  "flex flex-col items-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center transition-colors",
                  dragging ? "border-primary/60 bg-primary/5" : "border-border/70 bg-card/40",
                )}
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <ImagePlus className="h-5 w-5" />
                </span>
                <p className="text-sm font-medium text-foreground">把图片拖到这里，或者点下面的按钮选择</p>
                <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
                  PNG / JPG / WebP / GIF / BMP，最大 10MB。图片只在本机缩放取样，不会上传。
                </p>
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                    <Upload className="h-3.5 w-3.5" />
                    选择图片
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => void loadSampleImage()}>
                    <Sparkles className="h-3.5 w-3.5" />
                    用示例图片
                  </Button>
                </div>
              </div>
            )}

            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                void loadFile(event.target.files?.[0]);
                event.target.value = "";
              }}
            />

            {imageError ? <ToolError message={imageError} /> : null}
            {busy ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin text-primary" />
                正在读取图片…
              </p>
            ) : null}

            <div className="grid gap-4 border-t border-border/40 pt-4 sm:grid-cols-2 xl:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="ascii-image-width">宽度（列）</Label>
                <Input
                  id="ascii-image-width"
                  type="number"
                  inputMode="numeric"
                  min={IMAGE_MIN_COLS}
                  max={IMAGE_MAX_COLS}
                  value={imageColsRaw}
                  onChange={(event) => setImageColsRaw(event.target.value)}
                />
                <div className="flex flex-wrap gap-1.5">
                  {ASCII_COL_PRESETS.map((cols) => (
                    <button
                      key={cols}
                      type="button"
                      onClick={() => setImageColsRaw(String(cols))}
                      className={cn(
                        "rounded-lg border px-2 py-1 font-mono-accent text-[11px] transition-colors",
                        imageCols === cols
                          ? "border-primary/50 bg-primary/10 text-primary"
                          : "border-border/70 bg-card text-muted-foreground hover:bg-secondary hover:text-foreground",
                      )}
                    >
                      {cols}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="ascii-image-ramp">字符集</Label>
                <Select
                  id="ascii-image-ramp"
                  value={rampId}
                  onChange={(event) => setRampId(event.target.value)}
                >
                  {IMAGE_RAMPS.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </Select>
                {rampId === "custom" ? (
                  <Input
                    value={customRamp}
                    onChange={(event) => setCustomRamp(event.target.value)}
                    placeholder="例如 .:-=+*#%@"
                    className="font-mono-accent"
                    spellCheck={false}
                  />
                ) : (
                  <p className="truncate font-mono-accent text-[11px] text-muted-foreground">{ramp}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label>明暗与颜色</Label>
                <Segmented value={colorChoice} options={ASCII_COLOR_OPTIONS} onChange={setColorChoice} />
                <Segmented value={invertChoice} options={ASCII_INVERT_OPTIONS} onChange={setInvertChoice} />
              </div>

              <div className="space-y-2">
                <Label>导出 PNG 的颜色</Label>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="color"
                      value={exportFg}
                      onChange={(event) => setExportFg(event.target.value)}
                      className="h-8 w-10 cursor-pointer rounded-lg border border-border/70 bg-card"
                      aria-label="文字颜色"
                    />
                    文字
                  </label>
                  <label className="flex items-center gap-2 text-xs text-muted-foreground">
                    <input
                      type="color"
                      value={exportBg}
                      onChange={(event) => setExportBg(event.target.value)}
                      className="h-8 w-10 cursor-pointer rounded-lg border border-border/70 bg-card"
                      aria-label="背景颜色"
                    />
                    底色
                  </label>
                </div>
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  只影响导出的 PNG；预览里的黑白字符画跟随主题。
                </p>
              </div>
            </div>
          </div>

          <div className="space-y-3 rounded-2xl border border-border/70 bg-card/60 p-5 shadow-sm backdrop-blur-md">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/50 pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground">字符画</h3>
                {imageText ? (
                  <Badge variant="outline">
                    {imageStats.lines} 行 · 每行 {imageStats.columns} 字符 · {imageStats.chars} 字符
                  </Badge>
                ) : null}
                {colored ? <Badge variant="outline">彩色字符画</Badge> : null}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <CopyButton text={imageText} label="复制字符画" />
                <Button type="button" variant="outline" size="sm" onClick={exportImageText} disabled={!imageText}>
                  <Download className="h-3.5 w-3.5" />
                  导出 .txt
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void exportImagePng()}
                  disabled={imageGrid.length === 0}
                >
                  <FileDown className="h-3.5 w-3.5" />
                  导出 .png
                </Button>
              </div>
            </div>

            {imageGrid.length === 0 ? (
              <div className="space-y-3 rounded-xl border border-dashed border-border/70 bg-card/40 px-6 py-10 text-center">
                <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <ScanLine className="h-5 w-5" />
                </span>
                <p className="text-sm font-medium text-foreground">还没有字符画</p>
                <p className="mx-auto max-w-md text-xs leading-relaxed text-muted-foreground">
                  上传一张图片，这里会按灰阶把它换成字符；宽度、字符集、反色、彩色都是实时生效的。
                </p>
                <Button type="button" variant="ghost" size="sm" onClick={() => void loadSampleImage()}>
                  <Sparkles className="h-3.5 w-3.5" />
                  用示例图片试试
                </Button>
              </div>
            ) : colored ? (
              <div className="space-y-2">
                <canvas
                  ref={colorCanvasRef}
                  className="thin-scroll h-auto max-w-full rounded-xl border border-border/60"
                />
                <p className="text-[11px] leading-relaxed text-muted-foreground">
                  彩色模式下每个字符单独上色，导出的 PNG 就是这个画面；底色最好选得和图片整体明暗相反，
                  字符才看得清楚。复制按钮给的是同内容的纯文本。
                </p>
              </div>
            ) : (
              <pre className="thin-scroll max-h-[60vh] overflow-auto rounded-xl border border-border/60 bg-muted/30 p-4 font-mono-accent text-[10px] leading-none whitespace-pre text-foreground">
                {imageText}
              </pre>
            )}

            {hint ? <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p> : null}
          </div>
        </>
      )}
    </div>
  );
}
