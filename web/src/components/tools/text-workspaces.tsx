import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownUp,
  Copy,
  Download,
  RotateCcw,
  FileUp,
  Sparkles,
  ChevronRight,
} from "lucide-react";
import { Button, Input, Select, Textarea } from "@/components/ui/primitives";
import { tr, useLanguage } from "@/lib/language";
import { saveOutputBlob, reportOutputSaved } from "@/lib/output-directory";
import {
  organizeLines,
  LINE_DEFAULTS,
  characterCase,
  characterWidth,
  type LineOptions,
} from "@/lib/text-workbench-core";
const card = "rounded-2xl border border-border bg-card p-5";
function Choice({
  value,
  active,
  onClick,
  children,
}: {
  value: string;
  active: string;
  onClick: (s: string) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={value === active}
      onClick={() => onClick(value)}
      className={`min-h-10 rounded-xl border px-4 py-2 text-sm transition ${value === active ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border bg-card text-muted-foreground hover:bg-muted"}`}
    >
      {children}
    </button>
  );
}
function Tick({
  checked,
  onChange,
  children,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  children: ReactNode;
}) {
  return (
    <label className="flex min-h-10 cursor-pointer items-center gap-2 text-sm">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[hsl(var(--primary))]"
      />
      {children}
    </label>
  );
}
function OutputActions({
  value,
  name,
  onMessage,
}: {
  value: string;
  name: string;
  onMessage: (s: string) => void;
}) {
  const [saving, setSaving] = useState(false);
  async function save() {
    setSaving(true);
    try {
      reportOutputSaved(
        await saveOutputBlob(
          new Blob([value], { type: "text/plain;charset=utf-8" }),
          name,
        ),
      );
      onMessage(tr("已保存到输出目录", "Saved to the output folder"));
    } catch (e) {
      onMessage(tr("保存失败：", "Could not save: ") + String(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="flex flex-wrap gap-2">
      <Button
        variant="secondary"
        disabled={!value}
        onClick={() =>
          navigator.clipboard
            .writeText(value)
            .then(() => onMessage(tr("已复制结果", "Result copied")))
            .catch(() =>
              onMessage(
                tr(
                  "复制失败，请选中结果手动复制",
                  "Copy failed. Select the result and copy it manually.",
                ),
              ),
            )
        }
      >
        <Copy size={15} />
        {tr("复制", "Copy")}
      </Button>
      <Button disabled={!value || saving} onClick={() => void save()}>
        <Download size={15} />
        {saving ? tr("正在保存…", "Saving…") : tr("保存 TXT", "Save TXT")}
      </Button>
    </div>
  );
}
export function TextTransformWorkspace({ initial = "" }: { initial?: string }) {
  const locale = useLanguage();
  type Tab = "script" | "pinyin" | "case" | "width";
  const initialTab: Tab =
    initial === "pinyin-converter"
      ? "pinyin"
      : initial === "case-converter"
        ? "case"
        : initial === "fullwidth-halfwidth"
          ? "width"
          : "script";
  const [tab, setTab] = useState<Tab>(initialTab),
    [text, setText] = useState(""),
    [result, setResult] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [message, setMessage] = useState("");
  const [script, setScript] = useState("cn-tw"),
    [tone, setTone] = useState("symbol"),
    [casing, setCasing] = useState("financial"),
    [width, setWidth] = useState("half");
  const generation = useRef(0);
  useEffect(() => {
    const g = ++generation.current;
    setError("");
    setMessage("");
    setResult("");
    if (!text) {
      setBusy(false);
      return;
    }
    setBusy(true);
    const timer = setTimeout(async () => {
      try {
        let next = "";
        if (tab === "script") {
          const OpenCC = await import("opencc-js");
          const [from, to] = script.split("-");
          next = OpenCC.Converter({
            from: from as "cn" | "tw" | "hk",
            to: to as "cn" | "tw" | "hk",
          })(text);
        } else if (tab === "pinyin") {
          const { pinyin } = await import("pinyin-pro");
          next = pinyin(text, {
            toneType:
              tone === "first" ? "none" : (tone as "symbol" | "num" | "none"),
            pattern: tone === "first" ? "first" : "pinyin",
            nonZh: "consecutive",
          });
        } else if (tab === "case") next = characterCase(text, casing);
        else next = characterWidth(text, width === "full");
        if (g === generation.current) setResult(next);
      } catch (e) {
        if (g === generation.current)
          setError(tr("转换失败：", "Conversion failed: ") + String(e));
      } finally {
        if (g === generation.current) setBusy(false);
      }
    }, 180);
    return () => {
      clearTimeout(timer);
      generation.current++;
    };
  }, [text, tab, script, tone, casing, width, locale]);
  const tabs: [Tab, string][] = [
    ["script", tr("简繁转换", "Chinese scripts")],
    ["pinyin", tr("汉字拼音", "Pinyin")],
    ["case", tr("大小写", "Case & numerals")],
    ["width", tr("全角 / 半角", "Character width")],
  ];
  const options: Record<Tab, [string, string][]> = {
    script: [
      ["cn-tw", tr("简体 → 繁体（台湾）", "Simplified → Traditional (Taiwan)")],
      ["tw-cn", tr("繁体 → 简体", "Traditional → Simplified")],
      [
        "cn-hk",
        tr("简体 → 繁体（香港）", "Simplified → Traditional (Hong Kong)"),
      ],
      ["hk-cn", tr("香港繁体 → 简体", "Hong Kong Traditional → Simplified")],
    ],
    pinyin: [
      ["symbol", tr("声调符号", "Tone marks")],
      ["num", tr("声调数字", "Tone numbers")],
      ["none", tr("无声调", "No tones")],
      ["first", tr("首字母", "Initials")],
    ],
    case: [
      ["financial", tr("中文数字大写", "Chinese financial numerals")],
      ["ordinary", tr("中文数字小写", "Ordinary Chinese numerals")],
      ["upper", tr("英文大写", "UPPERCASE")],
      ["lower", tr("英文小写", "lowercase")],
      ["title", tr("单词首字母大写", "Title Case")],
      ["toggle", tr("反转英文大小写", "Toggle letter case")],
    ],
    width: [
      ["half", tr("转为半角", "To half-width")],
      ["full", tr("转为全角", "To full-width")],
    ],
  };
  const active =
    tab === "script"
      ? script
      : tab === "pinyin"
        ? tone
        : tab === "case"
          ? casing
          : width;
  const setActive =
    tab === "script"
      ? setScript
      : tab === "pinyin"
        ? setTone
        : tab === "case"
          ? setCasing
          : setWidth;
  return (
    <div className="space-y-5">
      <nav
        className="flex flex-wrap gap-2"
        aria-label={tr("转换类型", "Conversion type")}
      >
        {tabs.map(([id, label]) => (
          <Choice
            key={id}
            value={id}
            active={tab}
            onClick={(v) => setTab(v as Tab)}
          >
            {label}
          </Choice>
        ))}
      </nav>
      <div className={card}>
        <div className="flex flex-wrap gap-2">
          {options[tab].map(([id, label]) => (
            <Choice key={id} value={id} active={active} onClick={setActive}>
              {label}
            </Choice>
          ))}
        </div>
        <p className="mt-3 text-xs leading-5 text-muted-foreground">
          {tab === "case"
            ? tr(
                "中文数字逐字转换：一二三 → 壹贰叁。金额整句转换请使用「人民币大写」。",
                "Numerals are converted character by character: 一二三 → 壹贰叁. For monetary amounts, use RMB Uppercase.",
              )
            : tab === "pinyin"
              ? tr(
                  "使用词典识别多音字；人名和专有名词请核对读音。",
                  "Dictionary-based contextual pronunciation. Review personal names and specialist terms.",
                )
              : tab === "script"
                ? tr(
                    "词组级简繁转换在本机运行。不同地区用词仍建议人工核对。",
                    "Phrase-aware conversion runs locally. Review region-specific vocabulary.",
                  )
                : tr(
                    "仅转换 ASCII 字符及其全角形式，不改中文标点或正文语义。",
                    "Converts ASCII characters and their full-width forms, not Chinese punctuation or meaning.",
                  )}
        </p>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <section className={card}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <label htmlFor="conversion-source" className="font-semibold">
              {tr("原文", "Original")}
            </label>
            <span className="text-xs text-muted-foreground">
              {text.length.toLocaleString()} / 50,000
            </span>
          </div>
          <Textarea
            id="conversion-source"
            value={text}
            maxLength={50000}
            onChange={(e) => setText(e.target.value)}
            className="min-h-[300px] font-mono"
            placeholder={tr(
              "输入或粘贴文字，例如：一二三，Hello World！",
              "Type or paste text, for example: 一二三, Hello World!",
            )}
          />
          <div className="mt-3 flex gap-2">
            <Button
              variant="ghost"
              onClick={() => setText("")}
              disabled={!text}
            >
              {tr("清空原文", "Clear original")}
            </Button>
            <Button
              variant="ghost"
              onClick={() =>
                setText(
                  tab === "pinyin"
                    ? "银行的行长在重庆工作。"
                    : tab === "script"
                      ? "软件与数据库：汉字转换。"
                      : "一二三四五，Hello World！",
                )
              }
            >
              {tr("填入示例", "Use example")}
            </Button>
          </div>
        </section>
        <section className={card}>
          <div className="mb-3 flex items-center justify-between gap-3">
            <label htmlFor="conversion-result" className="font-semibold">
              {tr("转换结果", "Result")}
            </label>
            <span className="text-xs text-primary">
              {busy
                ? tr("正在转换…", "Converting…")
                : tr("本机处理", "Processed locally")}
            </span>
          </div>
          <Textarea
            id="conversion-result"
            value={result}
            readOnly
            className="min-h-[300px] font-mono"
            placeholder={tr(
              "转换后的文字会显示在这里",
              "Your converted text appears here",
            )}
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <OutputActions
              value={busy ? "" : result}
              name="converted-text.txt"
              onMessage={setMessage}
            />
            <Button
              variant="ghost"
              disabled={!result || busy}
              onClick={() => {
                setText(result);
                if (tab === "script")
                  setScript(
                    script.endsWith("-cn")
                      ? "cn-tw"
                      : script.startsWith("cn-hk")
                        ? "hk-cn"
                        : "tw-cn",
                  );
                else if (tab === "width")
                  setWidth(width === "full" ? "half" : "full");
                else if (tab === "case")
                  setCasing(
                    casing === "financial"
                      ? "ordinary"
                      : casing === "ordinary"
                        ? "financial"
                        : casing === "upper"
                          ? "lower"
                          : "upper",
                  );
              }}
            >
              <ArrowDownUp size={15} />
              {tr("结果作为原文", "Use result as input")}
            </Button>
          </div>
        </section>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm text-primary">
          {message}
        </p>
      )}
    </div>
  );
}
export function TextOrganizerWorkspace() {
  const locale = useLanguage(),
    input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState(""),
    [o, setO] = useState<LineOptions>({ ...LINE_DEFAULTS }),
    [stage, setStage] = useState("clean"),
    [message, setMessage] = useState(""),
    [history, setHistory] = useState<string[]>([]);
  const patch = (next: Partial<LineOptions>) => {
    setO((prev) => ({ ...prev, ...next }));
    setMessage("");
  };
  const result = useMemo(() => {
    try {
      return { ...organizeLines(text, o, locale), error: "" };
    } catch {
      return {
        output: "",
        inputLines: 0,
        outputLines: 0,
        removed: 0,
        error: tr(
          "最多处理 150,000 字符或 20,000 行，请拆分文本。",
          "Limit: 150,000 characters or 20,000 lines. Split larger text into parts.",
        ),
      };
    }
  }, [text, o, locale]);
  async function load(file?: File) {
    if (!file) return;
    try {
      if (file.size > 512 * 1024)
        throw new Error(
          tr("文件不能超过 512 KB", "File must not exceed 512 KB"),
        );
      const value = new TextDecoder("utf-8", { fatal: true }).decode(
        await file.arrayBuffer(),
      );
      if (value.length > 150000)
        throw new Error(
          tr("文件超过 150,000 字符", "File exceeds 150,000 characters"),
        );
      setHistory((h) => [...h.slice(-9), text]);
      setText(value);
      setMessage("");
    } catch (e) {
      setMessage(
        tr(
          "导入失败，请选择 UTF-8 文本：",
          "Import failed. Select UTF-8 text: ",
        ) + String(e),
      );
    }
  }
  const activeSteps = [
    o.trim && tr("去首尾空格", "Trim"),
    o.blank && tr("去空行", "Remove blanks"),
    o.dedupe && tr("去重", "Deduplicate"),
    o.filter && tr("筛选", "Filter"),
    o.sort !== "keep" && tr("排序", "Sort"),
    (o.number || o.prefix || o.suffix || o.join !== "lines") &&
      tr("格式", "Format"),
  ].filter(Boolean);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {[
            ["clean", tr("清理", "Clean")],
            ["filter", tr("筛选", "Filter")],
            ["sort", tr("排序", "Sort")],
            ["format", tr("格式", "Format")],
          ].map(([id, label], i) => (
            <Choice key={id} value={id} active={stage} onClick={setStage}>
              {i + 1}. {label}
            </Choice>
          ))}
        </div>
        <Button variant="ghost" onClick={() => setO({ ...LINE_DEFAULTS })}>
          <RotateCcw size={15} />
          {tr("重置规则", "Reset rules")}
        </Button>
      </div>
      <section className={card}>
        {stage === "clean" && (
          <div className="flex flex-wrap gap-x-7 gap-y-2">
            <Tick checked={o.trim} onChange={(v) => patch({ trim: v })}>
              {tr("去掉每行首尾空格", "Trim each line")}
            </Tick>
            <Tick checked={o.blank} onChange={(v) => patch({ blank: v })}>
              {tr("去掉空白行", "Remove blank lines")}
            </Tick>
            <Tick checked={o.dedupe} onChange={(v) => patch({ dedupe: v })}>
              {tr("重复行只保留第一条", "Keep the first duplicate only")}
            </Tick>
            <Tick checked={o.fold} onChange={(v) => patch({ fold: v })}>
              {tr("忽略英文大小写", "Ignore letter case")}
            </Tick>
          </div>
        )}
        {stage === "filter" && (
          <div className="grid items-center gap-4 sm:grid-cols-[1fr_auto]">
            <label className="space-y-2 text-sm">
              <span>
                {tr(
                  "按包含的文字筛选（非正则）",
                  "Filter by literal text, not regex",
                )}
              </span>
              <Input
                value={o.filter}
                maxLength={500}
                onChange={(e) => patch({ filter: e.target.value })}
                placeholder={tr(
                  "留空表示不过滤",
                  "Leave blank to keep all lines",
                )}
              />
            </label>
            <Tick checked={o.exclude} onChange={(v) => patch({ exclude: v })}>
              {tr("排除匹配行", "Exclude matching lines")}
            </Tick>
          </div>
        )}
        {stage === "sort" && (
          <div className="flex flex-wrap gap-2">
            {[
              ["keep", tr("保持原顺序", "Original order")],
              ["asc", tr("自然升序", "Natural ascending")],
              ["desc", tr("自然降序", "Natural descending")],
              ["length", tr("长度从短到长", "Shortest first")],
              ["reverse", tr("倒转行序", "Reverse lines")],
            ].map(([id, label]) => (
              <Choice
                key={id}
                active={o.sort}
                value={id}
                onClick={(s) => patch({ sort: s as LineOptions["sort"] })}
              >
                {label}
              </Choice>
            ))}
          </div>
        )}
        {stage === "format" && (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <label className="space-y-2 text-sm">
              {tr("每行前缀", "Line prefix")}
              <Input
                value={o.prefix}
                maxLength={100}
                onChange={(e) => patch({ prefix: e.target.value })}
              />
            </label>
            <label className="space-y-2 text-sm">
              {tr("每行后缀", "Line suffix")}
              <Input
                value={o.suffix}
                maxLength={100}
                onChange={(e) => patch({ suffix: e.target.value })}
              />
            </label>
            <div>
              <Tick checked={o.number} onChange={(v) => patch({ number: v })}>
                {tr("添加行号", "Number lines")}
              </Tick>
              <Input
                type="number"
                aria-label={tr("起始行号", "Starting number")}
                min={0}
                max={999999}
                value={o.start}
                disabled={!o.number}
                onChange={(e) =>
                  patch({
                    start: Math.max(
                      0,
                      Math.min(999999, Math.floor(Number(e.target.value) || 0)),
                    ),
                  })
                }
              />
            </div>
            <label className="space-y-2 text-sm">
              {tr("输出分隔符", "Output separator")}
              <Select
                value={o.join}
                onChange={(e) =>
                  patch({ join: e.target.value as LineOptions["join"] })
                }
              >
                <option value="lines">{tr("换行", "Newline")}</option>
                <option value="space">{tr("空格", "Space")}</option>
                <option value="comma">
                  {tr("逗号（非 CSV 转义）", "Comma (not CSV-escaped)")}
                </option>
              </Select>
            </label>
          </div>
        )}
        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4 text-xs text-muted-foreground">
          <Sparkles size={14} />
          {tr("处理链", "Pipeline")}
          {activeSteps.length
            ? activeSteps.map((s, i) => (
                <span key={i} className="inline-flex items-center gap-2">
                  <ChevronRight size={12} />
                  {s}
                </span>
              ))
            : tr("：保持原文", " · Unchanged")}
        </div>
      </section>
      <div className="grid gap-5 lg:grid-cols-2">
        <section className={card}>
          <div className="mb-3 flex items-center justify-between gap-2">
            <label htmlFor="organizer-source" className="font-semibold">
              {tr("原文", "Original")}
            </label>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => input.current?.click()}
            >
              <FileUp size={14} />
              {tr("导入 UTF-8 文本", "Import UTF-8 text")}
            </Button>
            <input
              ref={input}
              type="file"
              accept=".txt,.csv,.log,.md"
              className="hidden"
              onChange={(e) => {
                void load(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
          </div>
          <Textarea
            id="organizer-source"
            value={text}
            maxLength={150000}
            onChange={(e) => {
              setText(e.target.value);
              setMessage("");
            }}
            className="min-h-[330px] font-mono"
            placeholder={tr(
              "把需要整理的多行文本放在这里，规则会实时预览。",
              "Paste multiline text here. Rule changes update the preview.",
            )}
          />
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="ghost"
              onClick={() => {
                setHistory((h) => [...h.slice(-9), text]);
                setText("  苹果\n香蕉\n\n苹果\n橘子  \nitem10\nitem2");
              }}
            >
              {tr("示例文本", "Example text")}
            </Button>
            <Button
              variant="ghost"
              disabled={!history.length}
              onClick={() => {
                setText(history[history.length - 1]);
                setHistory((h) => h.slice(0, -1));
              }}
            >
              <RotateCcw size={14} />
              {tr("撤销替换原文", "Undo input replacement")}
            </Button>
          </div>
        </section>
        <section className={card}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="organizer-result" className="font-semibold">
              {tr("结果预览", "Result preview")}
            </label>
            <span className="text-xs text-primary">
              {tr(
                `${result.inputLines} 行 → ${result.outputLines} 行，移除 ${result.removed} 行`,
                `${result.inputLines} → ${result.outputLines} lines · ${result.removed} removed`,
              )}
            </span>
          </div>
          <Textarea
            id="organizer-result"
            value={result.output}
            readOnly
            className="min-h-[330px] font-mono"
            placeholder={tr(
              "不会自动覆盖原文或保存文件",
              "Your original is not overwritten and files are not saved automatically",
            )}
          />
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <OutputActions
              value={result.output}
              name="organized-text.txt"
              onMessage={setMessage}
            />
            <Button
              variant="ghost"
              disabled={!result.output || result.output === text}
              onClick={() => {
                setHistory((h) => [...h.slice(-9), text]);
                setText(result.output);
                setO({ ...LINE_DEFAULTS, trim: false, blank: false });
              }}
            >
              {tr("用结果替换原文", "Use result as input")}
            </Button>
          </div>
        </section>
      </div>
      {result.error && (
        <p role="alert" className="text-sm text-destructive">
          {result.error}
        </p>
      )}
      {message && (
        <p role="status" className="text-sm text-primary">
          {message}
        </p>
      )}
    </div>
  );
}
