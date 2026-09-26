import { uiMessage as __msg } from "@/lib/language";
import { useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import JSZip from "jszip";
import {
  FolderOpen,
  Files,
  ArrowRight,
  AlertTriangle,
  FileEdit,
  Replace,
  Plus,
  CaseSensitive,
  Sparkles,
  Tag,
  Check,
} from "lucide-react";
import { Button, Input, Label, Select } from "@/components/ui/primitives";
import { saveOutputBlob, reportOutputSaved } from "@/lib/output-directory";
import { tr, useLanguage } from "@/lib/language";

type Row = { id: number; name: string; relative: string; size: number };
type Scan = { session: string; rows: Row[]; skipped: number };

type RenameMode = "template" | "replace" | "affix" | "case";

interface RenameRules {
  mode: RenameMode;
  // ── 模板命名模式 ──
  template: string; // 例如: "{name}_{seq}"
  start: number; // 起始序号
  digits: number; // 补齐位数 (1=1, 2=01, 3=001, 4=0001)
  step: number; // 递增步长
  dateFormat: "YYYY-MM-DD" | "YYYYMMDD";
  keepExt: boolean; // 是否自动保留扩展名

  // ── 查找与替换模式 ──
  find: string;
  replace: string;
  isRegex: boolean;
  matchCase: boolean;

  // ── 前后缀模式 ──
  prefix: string;
  suffix: string;

  // ── 大小写与清洗模式 ──
  caseOption: "none" | "lower" | "upper" | "title";
  spaceOption: "none" | "trim" | "underscore" | "hyphen";
}

const DEFAULT_RULES: RenameRules = {
  mode: "template",
  template: "{name}_{seq}",
  start: 1,
  digits: 3,
  step: 1,
  dateFormat: "YYYY-MM-DD",
  keepExt: true,

  find: "",
  replace: "",
  isRegex: false,
  matchCase: false,

  prefix: "",
  suffix: "",

  caseOption: "none",
  spaceOption: "none",
};

// 格式化当前日期/时间
function getFormattedDateTime(dateFormat: "YYYY-MM-DD" | "YYYYMMDD") {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");

  const dateStr = dateFormat === "YYYY-MM-DD" ? `${y}-${m}-${d}` : `${y}${m}${d}`;
  const timeStr = `${hh}${mm}${ss}`;
  return { date: dateStr, time: timeStr };
}

// 单词首字母大写
function toTitleCase(str: string): string {
  return str.replace(/\b\w+/g, (txt) => txt.charAt(0).toUpperCase() + txt.substring(1).toLowerCase());
}

// 计算重命名后的名称
function computeNewName(
  oldName: string,
  index: number,
  rules: RenameRules,
  relativePath: string = ""
): string {
  const dot = oldName.lastIndexOf(".");
  let stem = dot > 0 ? oldName.slice(0, dot) : oldName;
  const ext = dot > 0 ? oldName.slice(dot) : ""; // 含点，例如 .jpg
  const extRaw = ext.startsWith(".") ? ext.slice(1) : ext; // 不含点，例如 jpg

  // 提取父文件夹名
  let folderName = "";
  if (relativePath && relativePath.includes("/")) {
    const parts = relativePath.split("/");
    if (parts.length > 1) {
      folderName = parts[parts.length - 2];
    }
  }

  const seqNum = rules.start + index * Math.max(1, rules.step);
  const sequence = String(seqNum).padStart(Math.max(1, rules.digits), "0");
  const { date, time } = getFormattedDateTime(rules.dateFormat);

  let resultStem = stem;

  switch (rules.mode) {
    case "template": {
      let t = rules.template || "{name}";
      // 替换占位符（兼容中文与英文占位符）
      t = t.replace(/\{name\}|\{原名\}|\{原文件名\}/g, stem);
      t = t.replace(/\{seq\}|\{序号\}|\{编号\}/g, sequence);
      t = t.replace(/\{date\}|\{日期\}/g, date);
      t = t.replace(/\{time\}|\{时间\}/g, time);
      t = t.replace(/\{folder\}|\{目录\}|\{文件夹\}/g, folderName);
      t = t.replace(/\{ext\}|\{扩展名\}/g, extRaw);

      // 如果模板中未显式写 {ext} 且开启自动保留扩展名，则自动加上原有扩展名
      if (rules.keepExt && !rules.template.includes("{ext}") && !rules.template.includes("{扩展名}")) {
        return t + ext;
      }
      return t;
    }

    case "replace": {
      if (rules.find) {
        if (rules.isRegex) {
          try {
            const flags = rules.matchCase ? "g" : "gi";
            const reg = new RegExp(rules.find, flags);
            resultStem = stem.replace(reg, rules.replace);
          } catch {
            resultStem = stem;
          }
        } else {
          if (rules.matchCase) {
            resultStem = stem.split(rules.find).join(rules.replace);
          } else {
            const lowerFind = rules.find.toLowerCase();
            let cur = "";
            let remaining = stem;
            while (remaining) {
              const idx = remaining.toLowerCase().indexOf(lowerFind);
              if (idx === -1) {
                cur += remaining;
                break;
              }
              cur += remaining.slice(0, idx) + rules.replace;
              remaining = remaining.slice(idx + rules.find.length);
            }
            resultStem = cur;
          }
        }
      }
      return resultStem + ext;
    }

    case "affix": {
      return (rules.prefix || "") + stem + (rules.suffix || "") + ext;
    }

    case "case": {
      if (rules.caseOption === "upper") resultStem = stem.toUpperCase();
      else if (rules.caseOption === "lower") resultStem = stem.toLowerCase();
      else if (rules.caseOption === "title") resultStem = toTitleCase(stem);

      if (rules.spaceOption === "trim") {
        resultStem = resultStem.trim();
      } else if (rules.spaceOption === "underscore") {
        resultStem = resultStem.replace(/\s+/g, "_");
      } else if (rules.spaceOption === "hyphen") {
        resultStem = resultStem.replace(/\s+/g, "-");
      }

      return resultStem + ext;
    }
  }

  return oldName;
}

// 检查 Windows 非法文件名
function nameError(name: string): string {
  if (
    !name ||
    name === "." ||
    name === ".." ||
    /[<>:"/\\|?*\x00-\x1f]/.test(name) ||
    /[. ]$/.test(name)
  )
    return tr(
      "包含Windows不允许的字符或结尾",
      "Contains characters or an ending not supported by Windows"
    );
  if (name.length > 255)
    return tr("名称超过255字符", "Name exceeds 255 UTF-16 code units");
  if (
    /^(con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(
      name.split(".")[0].trimEnd()
    )
  )
    return tr("Windows保留的设备名称", "Reserved Windows device name");
  return "";
}

export function RenameWorkspace() {
  const currentLanguage = useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const templateInputRef = useRef<HTMLInputElement>(null);

  const [mode, setMode] = useState<"folder" | "files">("folder");
  const [recursive, setRecursive] = useState(false);
  const [folder, setFolder] = useState("");
  const [scan, setScan] = useState<Scan | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [rules, setRules] = useState<RenameRules>(DEFAULT_RULES);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState("");
  const [confirmation, setConfirmation] = useState<{
    token: string;
    count: number;
  } | null>(null);
  const [page, setPage] = useState(0);

  const rows: Row[] = useMemo(
    () =>
      mode === "folder"
        ? scan?.rows || []
        : files.map((f, id) => ({
            id,
            name: f.name,
            relative: f.name,
            size: f.size,
          })),
    [mode, scan, files]
  );

  // 计算重命名预览与冲突
  const planned = useMemo(() => {
    const seen = new Set<string>();
    return rows.map((r, i) => {
      const name = computeNewName(r.name, i, rules, r.relative);
      const parent =
        mode === "folder"
          ? r.relative.slice(0, r.relative.length - r.name.length)
          : "";
      const key = (parent + name).toUpperCase();
      const err =
        nameError(name) ||
        (seen.has(key) ? tr("目标名称重复", "Duplicate target name") : "");
      seen.add(key);
      return { ...r, next: name, error: err };
    });
  }, [rows, rules, mode, currentLanguage]);

  const changed = planned.filter((r) => r.name !== r.next).length;
  const invalid = planned.some((r) => !!r.error);

  const invalidate = () => {
    setConfirmation(null);
    setError("");
    setReceipt("");
  };

  const updateRule = <K extends keyof RenameRules>(key: K, value: RenameRules[K]) => {
    invalidate();
    setRules((prev) => ({ ...prev, [key]: value }));
  };

  // 在模板光标处插入占位标签
  const insertTag = (tag: string) => {
    invalidate();
    const input = templateInputRef.current;
    if (input) {
      const start = input.selectionStart ?? rules.template.length;
      const end = input.selectionEnd ?? rules.template.length;
      const current = rules.template;
      const next = current.slice(0, start) + tag + current.slice(end);
      updateRule("template", next);
      setTimeout(() => {
        input.focus();
        const newPos = start + tag.length;
        input.setSelectionRange(newPos, newPos);
      }, 50);
    } else {
      updateRule("template", rules.template + tag);
    }
  };

  const readFolder = async (path: string, recurse: boolean) => {
    setBusy(true);
    invalidate();
    try {
      const s = await invoke<Scan>("rename_scan", {
        folder: path,
        recursive: recurse,
      });
      setScan(s);
      setFolder(path);
      setPage(0);
    } catch (e) {
      setScan(null);
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const pickFolder = async () => {
    setBusy(true);
    try {
      if (!window.furinakit?.selectDirectory)
        throw new Error(
          tr("原地重命名需要桌面版环境", "In-place renaming requires the desktop app")
        );
      const p = await window.furinakit.selectDirectory();
      if (p) await readFolder(p, recursive);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const pickFiles = (chosen: File[]) => {
    invalidate();
    if (
      chosen.length > 5000 ||
      chosen.reduce((n, f) => n + f.size, 0) > 256 * 1024 * 1024
    ) {
      setError(
        tr(
          "打包模式最多5000个文件、总计256 MiB；大量文件请使用文件夹原地模式。",
          "ZIP mode supports up to 5,000 files and 256 MiB total. Use in-place folder mode for larger batches."
        )
      );
      return;
    }
    setFiles(
      chosen.sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true })
      )
    );
    setPage(0);
  };

  const prepare = async () => {
    setBusy(true);
    setError("");
    try {
      if (mode === "folder") {
        const p = await invoke<{ token: string; changed: number }>(
          "rename_preview",
          { session: scan!.session, names: planned.map((r) => r.next) }
        );
        setConfirmation({ token: p.token, count: p.changed });
      } else {
        setConfirmation({ token: "zip", count: rows.length });
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const commit = async () => {
    if (!confirmation) return;
    setBusy(true);
    setError("");
    const confirmed = confirmation;
    setConfirmation(null);
    try {
      if (mode === "folder") {
        const result = await invoke<{ changed: number; journal: string }>(
          "rename_commit",
          { token: confirmed.token }
        );
        setReceipt(
          tr(
            `已修改 ${result.changed} 个文件名。恢复清单保存在：${result.journal}`,
            `Renamed ${result.changed} files. Recovery journal: ${result.journal}`
          )
        );
        setScan(null);
      } else {
        const zip = new JSZip();
        planned.forEach((r, i) => zip.file(r.next, files[i]));
        const blob = await zip.generateAsync({
          type: "blob",
          compression: "STORE",
        });
        const path = await saveOutputBlob(blob, "renamed-files.zip");
        reportOutputSaved(path);
        setReceipt(tr("压缩包已保存：", "ZIP saved: ") + path);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  // 示例文件名效果计算
  const exampleOriginal = tr("照片.jpg", "Photo.jpg");
  const exampleResult = useMemo(() => {
    return computeNewName(exampleOriginal, 0, rules, "Camera/" + exampleOriginal);
  }, [rules, exampleOriginal]);

  return (
    <div className="space-y-5 min-w-0">
      {/* ── 头部与模式切换 ── */}
      <div className="rounded-2xl border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold flex items-center gap-2">
              <FileEdit className="text-amber-500" size={22} />
              {tr("批量重命名工具", "Batch Rename")}
            </h2>
            <p className="text-sm text-muted-foreground mt-1">
              {tr(
                "强大的模板标签与多模式重命名，实时毫秒级所见即所得对比，安全防冲突与撤销保障。",
                "Powerful template tags & multi-mode rename, instant WYSIWYG preview, and safe undo journal."
              )}
            </p>
          </div>
          <div className="flex rounded-xl bg-muted/60 p-1">
            <button
              type="button"
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                mode === "folder" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => {
                invalidate();
                setMode("folder");
              }}
            >
              <FolderOpen size={14} />
              {tr("文件夹原地重命名", "In-place Folder")}
            </button>
            <button
              type="button"
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all ${
                mode === "files" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => {
                invalidate();
                setMode("files");
              }}
            >
              <Files size={14} />
              {tr("选文件打包导出", "Files to ZIP")}
            </button>
          </div>
        </div>

        {/* 文件夹/文件选取交互区 */}
        <div className="mt-4 pt-4 border-t flex flex-wrap items-center gap-3">
          {mode === "folder" ? (
            <>
              <Button onClick={pickFolder} disabled={busy} className="gap-2">
                <FolderOpen size={16} />
                {folder ? tr("重新选择文件夹", "Change Folder") : tr("选择工作文件夹", "Select Folder")}
              </Button>
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={recursive}
                  onChange={(e) => {
                    const val = e.target.checked;
                    setRecursive(val);
                    if (folder) void readFolder(folder, val);
                    else invalidate();
                  }}
                />
                <span className="text-xs text-muted-foreground">
                  {tr("包含子文件夹（保留目录层级）", "Include subfolders (preserve structure)")}
                </span>
              </label>
              {folder && (
                <span className="font-mono text-xs bg-muted/70 px-2.5 py-1 rounded-md text-muted-foreground break-all max-w-md">
                  {folder}
                </span>
              )}
            </>
          ) : (
            <>
              <input
                ref={fileInputRef}
                hidden
                type="file"
                multiple
                onChange={(e) => {
                  pickFiles(Array.from(e.target.files || []));
                  e.target.value = "";
                }}
              />
              <Button onClick={() => fileInputRef.current?.click()} disabled={busy} className="gap-2">
                <Files size={16} />
                {files.length ? tr("重新选择文件", "Choose Files") : tr("选择单个或多个文件", "Select Files")}
              </Button>
              {files.length > 0 && (
                <span className="text-xs text-muted-foreground font-medium">
                  {tr(`已加载 ${files.length} 个文件`, `Loaded ${files.length} files`)}
                </span>
              )}
            </>
          )}
        </div>
      </div>

      {/* ── 重命名规则配置面板 ── */}
      <div className="rounded-2xl border bg-card p-5 space-y-4">
        {/* 模式切换 Tab */}
        <div className="flex flex-wrap gap-2 border-b pb-3">
          {[
            { id: "template", label: tr("自由模板命名 (推荐)", "Custom Template"), icon: Sparkles },
            { id: "replace", label: tr("查找与替换", "Find & Replace"), icon: Replace },
            { id: "affix", label: tr("前缀与后缀", "Prefix & Suffix"), icon: Plus },
            { id: "case", label: tr("大小写与清洗", "Case & Clean"), icon: CaseSensitive },
          ].map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => updateRule("mode", item.id as RenameMode)}
              className={`flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold rounded-xl border transition-all ${
                rules.mode === item.id
                  ? "border-amber-500 bg-amber-500/10 text-amber-600 shadow-sm"
                  : "border-transparent text-muted-foreground hover:bg-muted/40"
              }`}
            >
              <item.icon size={15} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        {/* ── 模式 1: 自由模板命名 ── */}
        {rules.mode === "template" && (
          <div className="space-y-4 animate-in fade-in duration-200">
            {/* 模板输入框 */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-xs font-bold text-muted-foreground uppercase">
                  {tr("命名模板格式", "Template Pattern")}
                </Label>
                <span className="text-[11px] text-muted-foreground">
                  {tr("点击下方标签可直接插入对应变量", "Click tags below to insert variables")}
                </span>
              </div>

              <div className="relative">
                <input
                  ref={templateInputRef}
                  className="flex h-11 w-full rounded-lg border border-input bg-card px-3.5 py-2 font-mono text-sm pr-20 text-foreground placeholder:text-muted-foreground/70 transition-all duration-200 focus-visible:outline-none focus-visible:border-primary/60 focus-visible:ring-4 focus-visible:ring-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
                  value={rules.template}
                  onChange={(e) => updateRule("template", e.target.value)}
                  placeholder="{name}_{seq}"
                />
                <button
                  type="button"
                  className="absolute right-2 top-2 h-7 px-2 text-xs text-muted-foreground hover:text-foreground rounded border bg-background"
                  onClick={() => updateRule("template", "{name}")}
                >
                  {tr("重置原名", "Reset")}
                </button>
              </div>
            </div>

            {/* 可点击一键插入的标签胶囊 */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground mr-1 flex items-center gap-1">
                <Tag size={13} />
                {tr("可用变量：", "Insert Tag:")}
              </span>
              {[
                { tag: "{name}", label: tr("原文件名", "Original Name") },
                { tag: "{seq}", label: tr("序号", "Sequence Number") },
                { tag: "{date}", label: tr("当前日期", "Current Date") },
                { tag: "{time}", label: tr("当前时间", "Current Time") },
                { tag: "{folder}", label: tr("父文件夹", "Parent Folder") },
                { tag: "{ext}", label: tr("扩展名", "Extension") },
              ].map((item) => (
                <button
                  key={item.tag}
                  type="button"
                  onClick={() => insertTag(item.tag)}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border bg-muted/50 hover:bg-muted text-xs font-mono transition-colors shadow-xs"
                  title={tr("点击插入 ", "Click to insert ") + item.tag}
                >
                  <span className="font-semibold text-primary">{item.tag}</span>
                  <span className="text-[10px] text-muted-foreground">({item.label})</span>
                </button>
              ))}
            </div>

            {/* 常用模板快捷芯片 */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs text-muted-foreground mr-1">{tr("常用预设：", "Presets:")}</span>
              {[
                { label: tr("原名 + 序号", "Name + Seq"), tpl: "{name}_{seq}" },
                { label: tr("序号 + 原名", "Seq + Name"), tpl: "{seq}_{name}" },
                { label: tr("日期 + 原名", "Date + Name"), tpl: "{date}_{name}" },
                { label: tr("纯编号", "Seq Only"), tpl: "文件_{seq}" },
                { label: tr("照片归档", "Photo Archive"), tpl: "IMG_{date}_{seq}" },
              ].map((p, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => updateRule("template", p.tpl)}
                  className="px-2.5 py-1 rounded-md text-xs font-medium border bg-card hover:bg-muted/60 transition-colors text-muted-foreground hover:text-foreground"
                >
                  {p.label}
                </button>
              ))}
            </div>

            {/* 序号与格式微调行 */}
            <div className="grid gap-3 sm:grid-cols-4 rounded-xl border bg-muted/20 p-4">
              <div>
                <Label className="text-xs">{tr("起始序号", "Start Number")}</Label>
                <Input
                  type="number"
                  min={0}
                  className="h-8 text-xs font-mono"
                  value={rules.start}
                  onChange={(e) => updateRule("start", Math.max(0, parseInt(e.target.value) || 0))}
                />
              </div>

              <div>
                <Label className="text-xs">{tr("序号补齐位数", "Digits Padding")}</Label>
                <div className="flex gap-1 mt-1">
                  {[
                    { d: 1, text: "1" },
                    { d: 2, text: "01" },
                    { d: 3, text: "001" },
                    { d: 4, text: "0001" },
                  ].map((item) => (
                    <button
                      key={item.d}
                      type="button"
                      onClick={() => updateRule("digits", item.d)}
                      className={`flex-1 h-7 rounded text-xs font-mono transition-all border ${
                        rules.digits === item.d
                          ? "bg-amber-600 text-white border-amber-600 font-bold"
                          : "bg-background text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {item.text}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <Label className="text-xs">{tr("日期格式", "Date Format")}</Label>
                <Select
                  className="h-8 text-xs font-mono"
                  value={rules.dateFormat}
                  onChange={(e) => updateRule("dateFormat", e.target.value as any)}
                >
                  <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                  <option value="YYYYMMDD">YYYYMMDD</option>
                </Select>
              </div>

              <div className="flex items-end pb-1">
                <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="rounded"
                    checked={rules.keepExt}
                    onChange={(e) => updateRule("keepExt", e.target.checked)}
                  />
                  <span>{tr("自动保留原扩展名", "Auto keep extension")}</span>
                </label>
              </div>
            </div>
          </div>
        )}

        {/* ── 模式 2: 查找与替换 ── */}
        {rules.mode === "replace" && (
          <div className="space-y-3 animate-in fade-in duration-200">
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label className="text-xs">{tr("查找文字", "Find Text")}</Label>
                <Input
                  value={rules.find}
                  onChange={(e) => updateRule("find", e.target.value)}
                  placeholder={tr("输入要查找的字符，如：IMG_", "e.g. IMG_")}
                />
              </div>
              <div>
                <Label className="text-xs">{tr("替换为（留空则直接删除）", "Replace With (leave empty to delete)")}</Label>
                <Input
                  value={rules.replace}
                  onChange={(e) => updateRule("replace", e.target.value)}
                  placeholder={tr("替换的新文本", "New text")}
                />
              </div>
            </div>
            <div className="flex items-center gap-5 pt-1">
              <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={rules.matchCase}
                  onChange={(e) => updateRule("matchCase", e.target.checked)}
                />
                <span>{tr("区分大小写", "Case sensitive")}</span>
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="rounded"
                  checked={rules.isRegex}
                  onChange={(e) => updateRule("isRegex", e.target.checked)}
                />
                <span>{tr("使用正则表达式 (RegExp)", "Use Regular Expression")}</span>
              </label>
            </div>
          </div>
        )}

        {/* ── 模式 3: 前后缀 ── */}
        {rules.mode === "affix" && (
          <div className="grid gap-3 sm:grid-cols-2 animate-in fade-in duration-200">
            <div>
              <Label className="text-xs">{tr("添加前缀（添加到文件名开头）", "Prefix (Add to start)")}</Label>
              <Input
                value={rules.prefix}
                onChange={(e) => updateRule("prefix", e.target.value)}
                placeholder={tr("例如：项目_", "e.g. Project_")}
              />
            </div>
            <div>
              <Label className="text-xs">{tr("添加后缀（添加到扩展名前）", "Suffix (Add before extension)")}</Label>
              <Input
                value={rules.suffix}
                onChange={(e) => updateRule("suffix", e.target.value)}
                placeholder={tr("例如：_已审核", "e.g. _reviewed")}
              />
            </div>
          </div>
        )}

        {/* ── 模式 4: 大小写与清洗 ── */}
        {rules.mode === "case" && (
          <div className="grid gap-4 sm:grid-cols-2 animate-in fade-in duration-200">
            <div>
              <Label className="text-xs">{tr("字母大小写转换", "Case Conversion")}</Label>
              <Select
                value={rules.caseOption}
                onChange={(e) => updateRule("caseOption", e.target.value as any)}
              >
                <option value="none">{tr("保持原样", "Unchanged")}</option>
                <option value="lower">{tr("全部小写 (lowercase)", "All lowercase")}</option>
                <option value="upper">{tr("全部大写 (UPPERCASE)", "All UPPERCASE")}</option>
                <option value="title">{tr("首字母大写 (Title Case)", "Title Case")}</option>
              </Select>
            </div>
            <div>
              <Label className="text-xs">{tr("空格清洗与格式化", "Space Sanitization")}</Label>
              <Select
                value={rules.spaceOption}
                onChange={(e) => updateRule("spaceOption", e.target.value as any)}
              >
                <option value="none">{tr("不处理空格", "Do not modify spaces")}</option>
                <option value="trim">{tr("去除文件名首尾空格", "Trim start & end spaces")}</option>
                <option value="underscore">{tr("将空格替换为下划线 (_)", "Replace spaces with underscore (_)")}</option>
                <option value="hyphen">{tr("将空格替换为短横线 (-)", "Replace spaces with hyphen (-)")}</option>
              </Select>
            </div>
          </div>
        )}

        {/* ── 实时单行示例条 ── */}
        <div className="flex flex-wrap items-center justify-between rounded-xl bg-amber-500/10 border border-amber-500/20 px-4 py-2.5 text-xs text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-2">
            <Sparkles size={15} className="text-amber-600 shrink-0" />
            <span className="font-semibold">{tr("实时效果示例：", "Live Example:")}</span>
            <span className="font-mono text-muted-foreground">{exampleOriginal}</span>
            <span>➔</span>
            <span className="font-mono font-bold text-amber-600 dark:text-amber-400 bg-background/80 px-2 py-0.5 rounded border border-amber-500/30">
              {exampleResult}
            </span>
          </div>
          <span className="text-[11px] opacity-75">
            {tr("下方表格将实时映射全部文件改名效果", "Full table below updates instantly")}
          </span>
        </div>
      </div>

      {/* ── 文件列表与前后对比表格 ── */}
      {!!rows.length && (
        <div className="rounded-2xl border bg-card overflow-hidden shadow-sm">
          <div className="p-4 flex flex-wrap items-center justify-between gap-3 border-b bg-muted/20">
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-sm">
                {tr(
                  `名称预览 · 共 ${rows.length} 个文件 · ${changed} 项将被重命名`,
                  `Preview · ${rows.length} files · ${changed} to rename`
                )}
              </h3>
              {invalid && (
                <span className="rounded bg-destructive/10 text-destructive text-xs px-2 py-0.5 font-medium flex items-center gap-1">
                  <AlertTriangle size={13} />
                  {tr("存在非法字符或重名冲突", "Errors or conflicts detected")}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2 text-xs">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={page === 0}
                onClick={() => setPage((p) => p - 1)}
              >
                {tr("上一页", "Prev")}
              </Button>
              <span className="font-mono text-muted-foreground">
                {page + 1} / {Math.ceil(rows.length / 100)}
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={(page + 1) * 100 >= rows.length}
                onClick={() => setPage((p) => p + 1)}
              >
                {tr("下一页", "Next")}
              </Button>
            </div>
          </div>

          <div className="max-h-96 overflow-auto">
            <table className="w-full text-xs text-left border-collapse">
              <thead className="sticky top-0 bg-muted/60 backdrop-blur-md border-b">
                <tr>
                  <th className="p-3 font-semibold text-muted-foreground w-12 text-center">#</th>
                  <th className="p-3 font-semibold text-muted-foreground w-2/5">
                    {tr("原名称", "Original Name")}
                  </th>
                  <th className="p-3 font-semibold text-muted-foreground w-2/5">
                    {tr("重命名后 (新名称)", "New Name")}
                  </th>
                  <th className="p-3 font-semibold text-muted-foreground w-1/5">
                    {tr("状态", "Status")}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {planned.slice(page * 100, (page + 1) * 100).map((r, i) => {
                  const isModified = r.name !== r.next;
                  return (
                    <tr
                      key={r.id}
                      className={`hover:bg-muted/30 transition-colors ${
                        r.error ? "bg-destructive/5" : ""
                      }`}
                    >
                      <td className="p-3 text-center text-muted-foreground font-mono">
                        {page * 100 + i + 1}
                      </td>
                      <td className="p-3 break-all font-mono text-muted-foreground">
                        {r.relative}
                      </td>
                      <td className="p-3 break-all font-mono font-semibold">
                        <span
                          className={
                            isModified
                              ? "text-amber-600 dark:text-amber-400"
                              : "text-muted-foreground font-normal"
                          }
                        >
                          {r.next}
                        </span>
                      </td>
                      <td className="p-3">
                        {r.error ? (
                          <span className="text-destructive font-medium flex items-center gap-1">
                            <AlertTriangle size={13} />
                            {__msg(r.error)}
                          </span>
                        ) : isModified ? (
                          <span className="text-emerald-600 font-medium flex items-center gap-1">
                            <Check size={13} />
                            {tr("待重命名", "Ready")}
                          </span>
                        ) : (
                          <span className="text-muted-foreground opacity-60">
                            {tr("无变更", "Unchanged")}
                          </span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── 确认与执行弹窗 / 操作按钮 ── */}
      {confirmation ? (
        <div
          role="alertdialog"
          aria-modal="false"
          className="rounded-2xl border border-amber-500 bg-amber-500/5 p-5 space-y-3 animate-in fade-in"
        >
          <h3 className="font-bold flex items-center gap-2 text-base text-amber-700 dark:text-amber-400">
            <AlertTriangle size={18} />
            {tr("请核对并确认执行重命名", "Confirm Batch Rename Operation")}
          </h3>
          <p className="text-sm leading-relaxed">
            {mode === "folder"
              ? tr(
                  `即将原地修改 ${confirmation.count} 个文件的文件名。执行过程中请勿移动或编辑目标文件夹中的文件；系统会自动记录操作日志，随时可供溯源。`,
                  `Rename ${confirmation.count} files in place. Do not move or edit files during this operation. A recovery journal will be kept.`
                )
              : tr(
                  `将 ${confirmation.count} 个文件按新名称打包导出为 ZIP 压缩包，你的原始文件将完全保持原样不变。`,
                  `Export ${confirmation.count} files as a ZIP archive using the previewed names. Original files remain untouched.`
                )}
          </p>
          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              disabled={busy}
              onClick={commit}
              className="bg-amber-600 hover:bg-amber-700 text-white font-semibold"
            >
              {busy ? tr("正在执行…", "Executing…") : tr("确认并立即执行", "Confirm & Execute")}
            </Button>
            <Button
              disabled={busy}
              variant="outline"
              onClick={() => setConfirmation(null)}
            >
              {tr("返回调整", "Back to Adjust")}
            </Button>
          </div>
        </div>
      ) : (
        <div className="pt-2">
          <Button
            size="lg"
            className="w-full sm:w-auto gap-2 bg-amber-600 hover:bg-amber-700 text-white font-semibold shadow-md"
            disabled={
              busy || !rows.length || invalid || (mode === "folder" && !changed)
            }
            onClick={prepare}
          >
            <ArrowRight size={17} />
            {busy
              ? tr("处理中…", "Working…")
              : mode === "folder"
              ? tr(`预检并确认原地重命名 (${changed}项修改)`, `Validate & Confirm (${changed} changes)`)
              : tr("确认并输出重命名压缩包", "Review & Export ZIP")}
          </Button>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive whitespace-pre-wrap break-all bg-destructive/10 border border-destructive/20 p-3 rounded-xl">
          {__msg(error)}
        </p>
      )}
      {receipt && (
        <p
          role="status"
          className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300 p-4 text-sm font-medium whitespace-pre-wrap break-all flex items-center gap-2"
        >
          <Check size={18} className="shrink-0" />
          <span>{__msg(receipt)}</span>
        </p>
      )}
    </div>
  );
}
