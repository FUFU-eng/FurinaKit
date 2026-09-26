import { localeTag as __localeTag } from "@/lib/language";
"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage, uiCount as __count } from "@/lib/language";
const __ui = __createUiText("components/tools/record-tools.tsx");


/**
 * 记录类工具：记账本、月经期计算、孕周计算。
 *
 * 布局选择：
 *   · 记账本 —— **模式 D（表格数据）+ 汇总卡片**：记账的本质是"快速录入 + 随时看汇总"，
 *     所以录入区小而顺手（一行搞定），下面是真正的表格与统计。
 *     ★ 作者特别强调"用户可能长期使用的工具，一定要保持用户的数据"：本工具全部数据存在
 *     本机 localStorage，并提供**导出 CSV / 完整备份 JSON / 导入恢复**三件套，且明确提示数据位置。
 *   · 月经期 / 孕周 —— **模式 B（工作台 4:8）**：左边几个参数，右边是日历式的预测与阶段说明。
 *     这两个工具的产出是"一串日期 + 现在处于哪个阶段"，用列表与进度条呈现最直接。
 */

import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Baby,
  CalendarDays,
  CalendarHeart,
  Download,
  Eraser,
  FileSpreadsheet,
  Heart,
  Info,
  Plus,
  Save,
  Sparkles,
  Trash2,
  TrendingDown,
  TrendingUp,
  Upload,
  Wallet,
  X,
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

function ErrorBar({ message }: { message: string }) {
  const __locale = __useLanguage();
  return (
    <div className="flex items-center gap-2 rounded-xl border-l-4 border-l-destructive bg-destructive/10 px-4 py-3 font-mono text-xs text-destructive">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      {__msg(message)}
    </div>
  );
}

const yuan = (n: number) => n.toLocaleString(__localeTag(), { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const todayStr = () => new Date().toLocaleDateString("sv-SE");

// ══════════════════════════════════════════════════════════════════════
// 工具一：记账本（数据存在本机，可导出备份）
// ══════════════════════════════════════════════════════════════════════

const LEDGER_KEY = "furinakit:ledger:v1";

interface Entry {
  id: string;
  date: string;
  type: "in" | "out";
  amount: number;
  category: string;
  note: string;
}

const OUT_CATEGORIES = ["餐饮", "交通", "购物", "居住", "通讯", "医疗", "教育", "娱乐", "人情", "其他"];
const IN_CATEGORIES = ["工资", "奖金", "副业", "红包", "报销", "理财", "其他"];

/** 下拉里"自定义分类…"那一项的值（不会与真实分类名冲突） */
const CUSTOM_SENTINEL = "__custom__";
/** 自定义分类的存储键：加过一次就记住，长期用下来不用反复输入 */
const LEDGER_CATS_KEY = "furinakit:ledger:categories:v1";

function loadLedger(): Entry[] {
  try {
    const raw = localStorage.getItem(LEDGER_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function LedgerTool() {
  const __locale = __useLanguage();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [type, setType] = useToolDraft<"in" | "out">("ledger", "type", "out");
  const [amount, setAmount] = useToolDraft("ledger", "amount", "");
  const [category, setCategory] = useToolDraft("ledger", "category", "餐饮");
  const [note, setNote] = useToolDraft("ledger", "note", "");
  const [date, setDate] = useToolDraft("ledger", "date", todayStr());
  const [monthFilter, setMonthFilter] = useState("all");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  /** 自定义分类（作者要求：内置分类不够用时可以自己加） */
  const [customCategories, setCustomCategories] = useState<string[]>([]);
  const [customOpen, setCustomOpen] = useState(false);
  const [customName, setCustomName] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  // 打开时读本机数据（记账记录 + 自定义分类）
  useEffect(() => {
    setEntries(loadLedger());
    try {
      const raw = localStorage.getItem(LEDGER_CATS_KEY);
      const list = raw ? JSON.parse(raw) : [];
      if (Array.isArray(list)) setCustomCategories(list.filter((x) => typeof x === "string" && x.trim()));
    } catch {
      /* 读不出来就当没有 */
    }
    setLoaded(true);
  }, []);

  /** 新增一个自定义分类并存起来 */
  const addCustomCategory = () => {
    const name = customName.trim();
    if (!name) return;
    const builtin = type === "out" ? OUT_CATEGORIES : IN_CATEGORIES;
    if (builtin.includes(name) || customCategories.includes(name)) {
      setCategory(name);
      setCustomOpen(false);
      setCustomName("");
      return;
    }
    if (name.length > 12) {
      setError("分类名最多 12 个字");
      return;
    }
    const next = [...customCategories, name];
    setCustomCategories(next);
    try {
      localStorage.setItem(LEDGER_CATS_KEY, JSON.stringify(next));
    } catch {
      /* 存不进去也不影响本次使用 */
    }
    setCategory(name);
    setCustomOpen(false);
    setCustomName("");
    setError(null);
  };

  const removeCustomCategory = (name: string) => {
    const next = customCategories.filter((x) => x !== name);
    setCustomCategories(next);
    try {
      localStorage.setItem(LEDGER_CATS_KEY, JSON.stringify(next));
    } catch {
      /* 同上 */
    }
    // 如果当前正选着它，退回内置的第一个
    if (category === name) setCategory(type === "out" ? OUT_CATEGORIES[0] : IN_CATEGORIES[0]);
  };

  // 数据一变就落盘（作者要求：长期使用的工具必须保住用户数据）
  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(LEDGER_KEY, JSON.stringify(entries));
      setSaved(true);
      const t = setTimeout(() => setSaved(false), 1200);
      return () => clearTimeout(t);
    } catch {
      setError("本机存储写入失败（可能是浏览器存储满了或处于隐私模式），请尽快导出备份");
    }
  }, [entries, loaded]);

  const months = useMemo(() => {
    const set = new Set(entries.map((e) => e.date.slice(0, 7)));
    return Array.from(set).sort().reverse();
  }, [entries, __locale]);

  const shown = useMemo(
    () => (monthFilter === "all" ? entries : entries.filter((e) => e.date.startsWith(monthFilter))).slice().sort((a, b) => (a.date < b.date ? 1 : -1)),
    [entries, monthFilter, __locale],
  );

  const summary = useMemo(() => {
    const income = shown.filter((e) => e.type === "in").reduce((s, e) => s + e.amount, 0);
    const expense = shown.filter((e) => e.type === "out").reduce((s, e) => s + e.amount, 0);
    const byCat = new Map<string, number>();
    shown
      .filter((e) => e.type === "out")
      .forEach((e) => byCat.set(e.category, (byCat.get(e.category) || 0) + e.amount));
    const cats = Array.from(byCat.entries()).sort((a, b) => b[1] - a[1]);
    return { income, expense, balance: income - expense, cats };
  }, [shown, __locale]);

  const trend = useMemo(() => {
    const now = new Date();
    const months: Array<{ label: string; income: number; expense: number }> = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      const list = entries.filter((e) => e.date.startsWith(key));
      months.push({
        label: `${d.getMonth() + 1}月`,
        income: list.filter((e) => e.type === "in").reduce((s, e) => s + e.amount, 0),
        expense: list.filter((e) => e.type === "out").reduce((s, e) => s + e.amount, 0),
      });
    }
    return months;
  }, [entries, __locale]);

  const add = () => {
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError("金额要填一个大于 0 的数字");
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setError("日期格式应为 2026-09-15");
      return;
    }
    setError(null);
    setEntries((prev) => [
      { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, date, type, amount: value, category, note: note.trim() },
      ...prev,
    ]);
    setAmount("");
    setNote("");
  };

  const exportCsv = () => {
    const header = "日期,类型,分类,金额,备注\n";
    const body = shown
      .map((e) => `${e.date},${e.type === "in" ? "收入" : "支出"},${e.category},${e.amount},"${e.note.replace(/"/g, '""')}"`)
      .join("\n");
    // 带 BOM，Excel 打开中文才不乱码
    const blob = new Blob(["\ufeff" + header + body], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `记账本-${monthFilter === "all" ? "全部" : monthFilter}.csv`;
    // ★ 游离的 <a> 直接 click() 在 WebView2 里会被忽略（点了没反应）——
    //   必须挂到 DOM 上再点，点完移除（通用结果卡那边用的是页面里的真链接，所以正常）
    document.body.appendChild(a);
    document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 1000);
    setTimeout(() => a.remove(), 1000);
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  };

  const exportBackup = () => {
    const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), entries }, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `记账本备份-${todayStr()}.json`;
    // ★ 游离的 <a> 直接 click() 在 WebView2 里会被忽略（点了没反应）——
    //   必须挂到 DOM 上再点，点完移除（通用结果卡那边用的是页面里的真链接，所以正常）
    document.body.appendChild(a);
    document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 1000);
    setTimeout(() => a.remove(), 1000);
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  };

  const importBackup = async (file: File) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const list: Entry[] = Array.isArray(data) ? data : Array.isArray(data.entries) ? data.entries : [];
      const valid = list.filter((e) => e && typeof e.date === "string" && typeof e.amount === "number");
      if (valid.length === 0) throw new Error("这个文件里没有可识别的记账数据");
      setEntries((prev) => {
        const ids = new Set(prev.map((p) => p.id));
        const merged = [...prev];
        valid.forEach((v) => {
          if (!ids.has(v.id)) merged.push(v);
        });
        return merged.sort((a, b) => (a.date < b.date ? 1 : -1));
      });
      setError(`已导入 ${valid.length} 条记录（重复的会自动跳过）`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "导入失败，文件格式不对");
    }
  };

  const maxTrend = Math.max(1, ...trend.flatMap((t) => [t.income, t.expense]));

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        {/* 左：录入 + 汇总 */}
        <div className="thin-scroll space-y-4 lg:col-span-5">
          <SectionCard
            icon={<Plus className="h-4 w-4" />}
            title={__ui("记一笔")}
            extra={
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Save className={cn("h-3.5 w-3.5", saved && "text-emerald-500")} />
                {saved ? __ui("已保存到本机") : __ui("自动保存")}
              </span>
            }
          >
            <div className="space-y-3">
              <div className="flex gap-1.5 rounded-xl border border-border/60 bg-secondary/30 p-1">
                {[
                  { id: "out" as const, label: "支出", icon: <TrendingDown className="h-3.5 w-3.5" /> },
                  { id: "in" as const, label: "收入", icon: <TrendingUp className="h-3.5 w-3.5" /> },
                ].map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => {
                      setType(t.id);
                      setCategory(t.id === "out" ? "餐饮" : "工资");
                    }}
                    className={cn(
                      "flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
                      type === t.id ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {t.icon}
                    {__ui(t.label)}
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="lg-amount">{__ui("金额（元）")}</Label>
                  <Input
                    id="lg-amount"
                    type="number"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && add()}
                    placeholder="0.00"
                    className="text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="lg-date">{__ui("日期")}</Label>
                  <Input id="lg-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="text-xs" />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="lg-cat">{__ui("分类")}</Label>
                <Select
                  id="lg-cat"
                  value={category}
                  onChange={(e) => {
                    if (e.target.value === CUSTOM_SENTINEL) {
                      setCustomOpen(true);
                      setCustomName("");
                      return;
                    }
                    setCategory(e.target.value);
                  }}
                  className="w-full text-xs"
                >
                  {(type === "out" ? OUT_CATEGORIES : IN_CATEGORIES).map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                  {customCategories.length > 0 && (
                    <optgroup label={__ui("自定义分类")}>
                      {customCategories.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <option value={CUSTOM_SENTINEL}>{__ui("＋ 自定义分类…")}</option>
                </Select>

                {/* 自定义分类：加过一次就会记住，以后直接从下拉里选 */}
                {customOpen && (
                  <div className="flex gap-2">
                    <Input
                      autoFocus
                      value={customName}
                      onChange={(e) => setCustomName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addCustomCategory();
                        }
                        if (e.key === "Escape") setCustomOpen(false);
                      }}
                      placeholder={__ui("输入新分类名，回车确认")}
                      className="text-xs"
                      maxLength={12}
                    />
                    <Button type="button" size="sm" className="shrink-0" onClick={addCustomCategory}>
                      {__ui("添加")}</Button>
                  </div>
                )}
                {customCategories.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10.5px] text-muted-foreground">{__ui("已自定义：")}</span>
                    {customCategories.map((c) => (
                      <span
                        key={c}
                        className="inline-flex items-center gap-1 rounded-md border border-border/60 bg-secondary/30 px-1.5 py-0.5 text-[11px] text-foreground"
                      >
                        {c}
                        <button
                          type="button"
                          onClick={() => removeCustomCategory(c)}
                          className="text-muted-foreground transition-colors hover:text-destructive"
                          aria-label={__msg("删除分类 {0}", c)}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="lg-note">{__ui("备注（可选）")}</Label>
                <Input id="lg-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder={__ui("比如：和同事吃午饭")} className="text-xs" />
              </div>

              <Button type="button" className="w-full gap-1.5" onClick={add}>
                <Plus className="h-3.5 w-3.5" /> {__ui("记下来")}</Button>

              {error && <ErrorBar message={__msg(error)} />}
            </div>
          </SectionCard>

          <SectionCard icon={<Wallet className="h-4 w-4" />} title={__ui("汇总")}>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-xl border border-border/60 bg-secondary/20 px-3 py-2.5">
                <div className="text-[11px] text-muted-foreground">{__ui("收入")}</div>
                <div className="mt-0.5 font-mono text-sm font-semibold text-emerald-600 dark:text-emerald-400">
                  {yuan(summary.income)}
                </div>
              </div>
              <div className="rounded-xl border border-border/60 bg-secondary/20 px-3 py-2.5">
                <div className="text-[11px] text-muted-foreground">{__ui("支出")}</div>
                <div className="mt-0.5 font-mono text-sm font-semibold text-foreground">{yuan(summary.expense)}</div>
              </div>
              <div className="rounded-xl border border-primary/30 bg-primary/[0.07] px-3 py-2.5">
                <div className="text-[11px] text-muted-foreground">{__ui("结余")}</div>
                <div className={cn("mt-0.5 font-mono text-sm font-semibold", summary.balance >= 0 ? "text-primary" : "text-destructive")}>
                  {yuan(summary.balance)}
                </div>
              </div>
            </div>

            {summary.cats.length > 0 && (
              <div className="mt-3">
                <div className="mb-1.5 text-[11.5px] font-medium text-foreground">{__ui("支出分类")}</div>
                <div className="space-y-1">
                  {summary.cats.slice(0, 8).map(([cat, val]) => (
                    <div key={cat} className="flex items-center gap-2 text-[11.5px]">
                      <span className="w-14 shrink-0 text-muted-foreground">{cat}</span>
                      <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
                        <span
                          className="block h-full rounded-full bg-primary"
                          style={{ width: `${(val / Math.max(1, summary.expense)) * 100}%` }}
                        />
                      </span>
                      <span className="w-20 shrink-0 text-right font-mono text-foreground">{yuan(val)}</span>
                      <span className="w-10 shrink-0 text-right text-muted-foreground">
                        {((val / Math.max(1, summary.expense)) * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-3">
              <div className="mb-1.5 text-[11.5px] font-medium text-foreground">{__ui("近半年趋势")}</div>
              <div className="flex items-end gap-1.5" style={{ height: 70 }}>
                {trend.map((t) => (
                  <div key={t.label} className="flex flex-1 flex-col items-center gap-0.5">
                    <div className="flex h-[54px] w-full items-end justify-center gap-0.5">
                      <span
                        className="w-2 rounded-t bg-emerald-500/70"
                        style={{ height: `${(t.income / maxTrend) * 54}px` }}
                        title={__msg("收入 {0}", yuan(t.income))}
                      />
                      <span
                        className="w-2 rounded-t bg-primary/70"
                        style={{ height: `${(t.expense / maxTrend) * 54}px` }}
                        title={__msg("支出 {0}", yuan(t.expense))}
                      />
                    </div>
                    <span className="text-[9.5px] text-muted-foreground">{__ui(t.label)}</span>
                  </div>
                ))}
              </div>
            </div>
          </SectionCard>

          <SectionCard icon={<Info className="h-4 w-4" />} title={__ui("数据存在哪（重要）")}>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {__ui("全部记录仅保存在")}<b className="text-foreground">{__ui("本机的浏览器存储")}</b>{__ui("中，不上传任何服务器。 因此：")}<b className="text-foreground">{__ui("清理浏览器数据、重装系统或更换电脑都会导致数据丢失")}</b>{__ui("， 建议定期使用「完整备份」导出 JSON 文件保存到网盘或移动存储，需要时用「导入恢复」还原。")}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={exportBackup}>
                <Download className="h-3.5 w-3.5" /> {__ui("完整备份")}</Button>
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={() => fileRef.current?.click()}>
                <Upload className="h-3.5 w-3.5" /> {__ui("导入恢复")}</Button>
              <input
                ref={fileRef}
                type="file"
                accept=".json"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void importBackup(f);
                  e.target.value = "";
                }}
              />
              <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={exportCsv}>
                <FileSpreadsheet className="h-3.5 w-3.5" /> {__ui("导出 CSV")}</Button>
            </div>
          </SectionCard>
        </div>

        {/* 右：明细 */}
        <div className="thin-scroll space-y-4 lg:col-span-7">
          <SectionCard
            icon={<CalendarDays className="h-4 w-4" />}
            title={__msg("明细（{0} 条）", shown.length)}
            extra={
              <div className="flex items-center gap-2">
                <Select value={monthFilter} onChange={(e) => setMonthFilter(e.target.value)} className="h-8 w-28 text-[11.5px]">
                  <option value="all">{__ui("全部月份")}</option>
                  {months.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
                {entries.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="gap-1.5"
                    onClick={() => {
                      if (confirm("确定清空全部记账记录吗？建议先执行一次完整备份。")) setEntries([]);
                    }}
                  >
                    <Eraser className="h-3.5 w-3.5" /> {__ui("清空")}</Button>
                )}
              </div>
            }
          >
            {shown.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Wallet className="h-5 w-5" />
                </span>
                <p className="text-sm font-medium text-foreground">{__ui("还没有记录")}</p>
                <p className="max-w-xs text-xs leading-relaxed text-muted-foreground">
                  {__ui("在左侧填写金额并点击「记下来」即可保存到本机，可随时导出备份。")}</p>
              </div>
            ) : (
              <div className="thin-scroll max-h-[520px] overflow-auto rounded-xl border border-border/60">
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="sticky top-0 z-10 bg-muted/80 backdrop-blur">
                      <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("日期")}</th>
                      <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("分类")}</th>
                      <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("备注")}</th>
                      <th className="px-3 py-2 text-right font-semibold text-foreground">{__ui("金额")}</th>
                      <th className="px-2 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((e) => (
                      <tr key={e.id} className="border-t border-border/40 even:bg-muted/20">
                        <td className="whitespace-nowrap px-3 py-1.5 font-mono text-muted-foreground">{e.date}</td>
                        <td className="px-3 py-1.5">
                          <Badge variant="outline" className="font-normal">
                            {e.category}
                          </Badge>
                        </td>
                        <td className="max-w-[220px] truncate px-3 py-1.5 text-muted-foreground">{__ui(e.note) || "—"}</td>
                        <td
                          className={cn(
                            "whitespace-nowrap px-3 py-1.5 text-right font-mono font-semibold",
                            e.type === "in" ? "text-emerald-600 dark:text-emerald-400" : "text-foreground",
                          )}
                        >
                          {e.type === "in" ? "+" : "−"}
                          {yuan(e.amount)}
                        </td>
                        <td className="px-2 py-1.5 text-right">
                          <button
                            type="button"
                            onClick={() => setEntries((prev) => prev.filter((x) => x.id !== e.id))}
                            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                            aria-label={__ui("删除")}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 工具二：月经期计算
// ══════════════════════════════════════════════════════════════════════

export function PeriodTrackerTool() {
  const __locale = __useLanguage();
  const [lastStart, setLastStart] = useToolDraft("period-tracker", "lastStart", todayStr());
  const [cycle, setCycle] = useToolDraft("period-tracker", "cycle", "28");
  const [periodLen, setPeriodLen] = useToolDraft("period-tracker", "periodLen", "5");

  const result = useMemo(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(lastStart)) return { error: "请选择上次月经开始的日期", data: null };
    const c = Number(cycle);
    const p = Number(periodLen);
    if (!(c >= 15 && c <= 60)) return { error: "周期长度一般在 21~35 天，请检查一下", data: null };
    if (!(p >= 1 && p <= 15)) return { error: "经期长度一般在 2~8 天，请检查一下", data: null };

    const start = new Date(lastStart + "T00:00:00");
    const today = new Date(todayStr() + "T00:00:00");
    const dayMs = 86400000;

    // 未来 6 次
    const nexts = Array.from({ length: 6 }, (_, i) => {
      const s = new Date(start.getTime() + c * (i + 1) * dayMs);
      const e = new Date(s.getTime() + (p - 1) * dayMs);
      const ovu = new Date(s.getTime() - 14 * dayMs);
      return {
        index: i + 1,
        start: s,
        end: e,
        ovulation: ovu,
        fertileStart: new Date(ovu.getTime() - 5 * dayMs),
        fertileEnd: new Date(ovu.getTime() + 1 * dayMs),
      };
    });

    // 当前所处的周期位置
    const daysSinceStart = Math.floor((today.getTime() - start.getTime()) / dayMs);
    const dayInCycle = ((daysSinceStart % c) + c) % c; // 0 = 第一天
    const currentPeriodStart = new Date(start.getTime() + Math.floor(daysSinceStart / c) * c * dayMs);
    const nextPeriod = new Date(currentPeriodStart.getTime() + c * dayMs);
    const daysToNext = Math.ceil((nextPeriod.getTime() - today.getTime()) / dayMs);
    const ovulation = new Date(nextPeriod.getTime() - 14 * dayMs);

    let phase = "卵泡期";
    let phaseDesc = "经期结束到排卵前，精力逐渐回升，适合安排强度大一点的事情。";
    if (dayInCycle < p) {
      phase = "月经期";
      phaseDesc = "正在经期，注意保暖、别熬夜，剧烈运动尽量避开。";
    } else if (Math.abs((today.getTime() - ovulation.getTime()) / dayMs) <= 1) {
      phase = "排卵期";
      phaseDesc = "接近排卵日，是最容易受孕的时段（如果不想怀孕，这几天要格外注意）。";
    } else if ((today.getTime() - ovulation.getTime()) / dayMs > 1) {
      phase = "黄体期";
      phaseDesc = "排卵后到下次月经前，容易疲劳、情绪波动，属于正常现象。";
    }

    return {
      error: "",
      data: { start, c, p, nexts, dayInCycle, nextPeriod, daysToNext, ovulation, phase, phaseDesc, cycles: Math.floor(daysSinceStart / c) },
    };
  }, [lastStart, cycle, periodLen, __locale]);

  const d = result.data;
  const fmt = (dt: Date) => dt.toLocaleDateString(__localeTag(), { month: "long", day: "numeric", weekday: "short" });

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="thin-scroll space-y-4 lg:col-span-4">
          <SectionCard
            icon={<CalendarHeart className="h-4 w-4" />}
            title={__ui("你的周期")}
            extra={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  setLastStart(todayStr());
                  setCycle("28");
                  setPeriodLen("5");
                }}
              >
                <Sparkles className="h-3.5 w-3.5" /> {__ui("重置")}</Button>
            }
          >
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="pt-start">{__ui("上次月经开始日")}</Label>
                <Input id="pt-start" type="date" value={lastStart} onChange={(e) => setLastStart(e.target.value)} className="text-xs" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="pt-cycle">{__ui("周期（天）")}</Label>
                  <Input id="pt-cycle" type="number" value={cycle} onChange={(e) => setCycle(e.target.value)} className="text-xs" />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pt-len">{__ui("经期（天）")}</Label>
                  <Input id="pt-len" type="number" value={periodLen} onChange={(e) => setPeriodLen(e.target.value)} className="text-xs" />
                </div>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {__ui("周期指这次月经第一天到下次第一天的天数，一般在 21~35 天之间；不确定可以先按 28 天估。")}</p>
            </div>
          </SectionCard>

          <SectionCard icon={<Info className="h-4 w-4" />} title={__ui("这是估算，不是医学判断")}>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {__ui("按\"固定周期\"推算，实际会受作息、压力、身体状况影响而波动，前后差几天很正常。 仅用于日常安排参考；如果周期长期紊乱、疼痛严重或想避孕/备孕，请咨询医生，不要依赖这个预测。")}</p>
          </SectionCard>
        </div>

        <div className="thin-scroll space-y-4 lg:col-span-8">
          {result.error ? (
            <ErrorBar message={__msg(result.error)} />
          ) : d ? (
            <>
              <SectionCard icon={<Heart className="h-4 w-4" />} title={__ui("现在处于哪个阶段")}>
                <div className="flex flex-wrap items-center gap-3">
                  <div className="rounded-xl border border-primary/30 bg-primary/[0.07] px-4 py-3">
                    <div className="text-[11.5px] text-muted-foreground">{__ui("当前阶段")}</div>
                    <div className="mt-1 text-2xl font-bold text-primary">{d.phase}</div>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-secondary/20 px-4 py-3">
                    <div className="text-[11.5px] text-muted-foreground">{__ui("本周期第几天")}</div>
                    <div className="mt-1 font-mono text-xl font-semibold text-foreground">{__ui("第")}{__count(d.dayInCycle + 1, "天")} </div>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-secondary/20 px-4 py-3">
                    <div className="text-[11.5px] text-muted-foreground">{__ui("距下次月经")}</div>
                    <div className="mt-1 font-mono text-xl font-semibold text-foreground">
                      {d.daysToNext > 0 ? __msg("{0} 天", d.daysToNext) : __ui("就在这几天")}
                    </div>
                  </div>
                </div>
                <p className="mt-3 rounded-xl border border-border/60 bg-background/40 p-3 text-[12px] leading-relaxed text-muted-foreground">
                  {__msg(d.phaseDesc)}
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-[11.5px]">
                  <div className="rounded-lg border border-border/60 bg-secondary/20 px-3 py-2">
                    <div className="text-muted-foreground">{__ui("下次月经开始")}</div>
                    <div className="mt-0.5 text-foreground">{fmt(d.nextPeriod)}</div>
                  </div>
                  <div className="rounded-lg border border-border/60 bg-secondary/20 px-3 py-2">
                    <div className="text-muted-foreground">{__ui("预计排卵日")}</div>
                    <div className="mt-0.5 text-foreground">{fmt(d.ovulation)}</div>
                  </div>
                </div>
              </SectionCard>

              <SectionCard icon={<CalendarDays className="h-4 w-4" />} title={__ui("未来 6 次预测")}>
                <div className="overflow-hidden rounded-xl border border-border/60">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="bg-muted/60">
                        <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("次序")}</th>
                        <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("经期")}</th>
                        <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("易孕期")}</th>
                        <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("排卵日")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.nexts.map((n) => (
                        <tr key={n.index} className="border-t border-border/40 even:bg-muted/20">
                          <td className="px-3 py-2 text-foreground">{__ui("第")}{__count(n.index, "次")} </td>
                          <td className="px-3 py-2 font-mono text-foreground">
                            {n.start.toLocaleDateString(__localeTag(), { month: "2-digit", day: "2-digit" })} –{" "}
                            {n.end.toLocaleDateString(__localeTag(), { month: "2-digit", day: "2-digit" })}
                          </td>
                          <td className="px-3 py-2 font-mono text-muted-foreground">
                            {n.fertileStart.toLocaleDateString(__localeTag(), { month: "2-digit", day: "2-digit" })} –{" "}
                            {n.fertileEnd.toLocaleDateString(__localeTag(), { month: "2-digit", day: "2-digit" })}
                          </td>
                          <td className="px-3 py-2 font-mono text-muted-foreground">
                            {n.ovulation.toLocaleDateString(__localeTag(), { month: "2-digit", day: "2-digit" })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </SectionCard>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// 工具三：孕周计算器
// ══════════════════════════════════════════════════════════════════════

const CHECKS = [
  { weeks: "6–8 周", item: "B 超确认宫内孕、胎心", note: "确认孕周与胎数" },
  { weeks: "11–13⁺⁶ 周", item: "NT 检查 + 早期唐筛", note: "筛查染色体异常的重要节点" },
  { weeks: "15–20 周", item: "中期唐筛 / 无创 DNA", note: "按医生建议选择" },
  { weeks: "20–24 周", item: "大排畸（系统超声）", note: "检查结构发育，注意时间窗" },
  { weeks: "24–28 周", item: "糖耐量试验（OGTT）", note: "筛查妊娠糖尿病" },
  { weeks: "28–32 周", item: "小排畸 + 胎心监护开始", note: "关注胎动规律" },
  { weeks: "36 周后", item: "每周产检 + 胎心监护", note: "评估胎位与分娩方式" },
  { weeks: "37 周", item: "足月", note: "随时可能发动" },
  { weeks: "40 周", item: "预产期", note: "前后两周内分娩都属正常" },
];

export function DueDateTool() {
  const __locale = __useLanguage();
  const [mode, setMode] = useToolDraft<"lmp" | "conception" | "due">("due-date", "mode", "lmp");
  const [dateStr, setDateStr] = useToolDraft("due-date", "date", todayStr());
  const [cycle, setCycle] = useToolDraft("due-date", "cycle", "28");

  const result = useMemo(() => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return { error: "请选择一个日期", data: null };
    const base = new Date(dateStr + "T00:00:00");
    if (Number.isNaN(base.getTime())) return { error: "日期无效", data: null };

    const dayMs = 86400000;
    const cycleAdj = mode === "lmp" ? (Number(cycle) - 28) * dayMs : 0;
    // Naegele 法则：末次月经第一天 + 280 天；受孕日 + 266 天；已知预产期直接用
    const due =
      mode === "lmp"
        ? new Date(base.getTime() + 280 * dayMs + cycleAdj)
        : mode === "conception"
          ? new Date(base.getTime() + 266 * dayMs)
          : base;

    const today = new Date(todayStr() + "T00:00:00");
    const totalDays = Math.round((due.getTime() - today.getTime()) / dayMs);
    const passedDays = Math.round((today.getTime() - due.getTime()) / dayMs) + 280;
    const gestDays = Math.max(0, passedDays);
    const weeks = Math.floor(gestDays / 7);
    const days = gestDays % 7;
    const trimester = weeks < 13 ? "第一孕期（早期）" : weeks < 28 ? "第二孕期（中期）" : "第三孕期（晚期）";
    const trimesterDesc =
      weeks < 13
        ? "胎儿主要器官在这段时期形成，注意补充叶酸、避开烟酒与乱用药。"
        : weeks < 28
          ? "相对舒服的一段，注意营养均衡与适度活动，按时做大排畸与糖耐。"
          : "肚子变大、容易累，注意数胎动、控制体重，提前了解分娩知识。";

    // 各阶段起点日期
    const week = (w: number) => new Date(due.getTime() - (280 - w * 7) * dayMs);

    return {
      error: "",
      data: { due, weeks, days, gestDays, totalDays, trimester, trimesterDesc, week, valid: gestDays >= 0 && gestDays <= 320 },
    };
  }, [mode, dateStr, cycle, __locale]);

  const d = result.data;

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="thin-scroll space-y-4 lg:col-span-4">
          <SectionCard
            icon={<Baby className="h-4 w-4" />}
            title={__ui("按哪个日期算")}
            extra={
              <Button type="button" variant="outline" size="sm" onClick={() => { setMode("lmp"); setDateStr(todayStr()); setCycle("28"); }}>
                <Sparkles className="h-3.5 w-3.5" /> {__ui("重置")}</Button>
            }
          >
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label>{__ui("计算依据")}</Label>
                <div className="space-y-1.5">
                  {[
                    { id: "lmp" as const, label: "末次月经第一天", hint: "最常用，按 +280 天推算" },
                    { id: "conception" as const, label: "受孕日", hint: "按 +266 天推算" },
                    { id: "due" as const, label: "已知预产期", hint: "医生已经给过预产期" },
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setMode(m.id)}
                      className={cn(
                        "w-full rounded-xl border px-3 py-2 text-left transition-colors",
                        mode === m.id ? "border-primary/50 bg-primary/[0.07]" : "border-border/60 hover:bg-muted/50",
                      )}
                    >
                      <div className="text-[12px] font-medium text-foreground">
                        {mode === m.id ? "✓ " : ""}
                        {__ui(m.label)}
                      </div>
                      <div className="text-[11px] text-muted-foreground">{__ui(m.hint)}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="dd-date">{__ui("日期")}</Label>
                <Input id="dd-date" type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} className="text-xs" />
              </div>

              {mode === "lmp" && (
                <div className="space-y-1.5">
                  <Label htmlFor="dd-cycle">{__ui("月经周期长度（天）")}</Label>
                  <Input id="dd-cycle" type="number" value={cycle} onChange={(e) => setCycle(e.target.value)} className="text-xs" />
                  <p className="text-[11px] text-muted-foreground">{__ui("周期不是 28 天时，医生也会做相应调整，这里同样按差值修正。")}</p>
                </div>
              )}
            </div>
          </SectionCard>

          <SectionCard icon={<Info className="h-4 w-4" />} title={__ui("说明")}>
            <p className="text-[11px] leading-relaxed text-muted-foreground">
              {__ui("预产期仅为估算范围：按末次月经推算时，约 5% 的孕妇恰好在预产期分娩， 前后两周内分娩均属正常。准确的孕周以早期 B 超测量为准；若 B 超结果与此处差异较大， 请以医生给出的为准。")}</p>
          </SectionCard>
        </div>

        <div className="thin-scroll space-y-4 lg:col-span-8">
          {result.error ? (
            <ErrorBar message={__msg(result.error)} />
          ) : d ? (
            <>
              <SectionCard icon={<Baby className="h-4 w-4" />} title={__ui("预产期与当前孕周")}>
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-xl border border-primary/30 bg-primary/[0.07] px-4 py-3">
                    <div className="text-[11.5px] text-muted-foreground">{__ui("预产期")}</div>
                    <div className="mt-1 text-xl font-bold text-primary">
                      {d.due.toLocaleDateString(__localeTag(), { year: "numeric", month: "long", day: "numeric" })}
                    </div>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-secondary/20 px-4 py-3">
                    <div className="text-[11.5px] text-muted-foreground">{__ui("当前孕周")}</div>
                    <div className="mt-1 font-mono text-xl font-bold text-foreground">
                      {d.weeks} {__ui("周")}{__count(d.days, "天")} </div>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-secondary/20 px-4 py-3">
                    <div className="text-[11.5px] text-muted-foreground">{__ui("距预产期")}</div>
                    <div className="mt-1 font-mono text-xl font-bold text-foreground">
                      {d.totalDays > 0 ? __msg("{0} 天", d.totalDays) : d.totalDays === 0 ? __ui("就是今天") : __msg("已过 {0} 天", -d.totalDays)}
                    </div>
                  </div>
                </div>

                <div className="mt-3">
                  <div className="mb-1.5 flex items-center justify-between text-[11.5px]">
                    <span className="text-muted-foreground">{__ui("孕期进度（共 40 周）")}</span>
                    <span className="text-foreground">{d.trimester}</span>
                  </div>
                  <div className="relative h-3 w-full overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-primary/70 to-primary"
                      style={{ width: `${Math.max(0, Math.min(100, (d.gestDays / 280) * 100))}%` }}
                    />
                    {[13, 28].map((w) => (
                      <span key={w} className="absolute inset-y-0 border-l border-background/70" style={{ left: `${(w / 40) * 100}%` }} />
                    ))}
                  </div>
                  <p className="mt-2 rounded-xl border border-border/60 bg-background/40 p-3 text-[12px] leading-relaxed text-muted-foreground">
                    {__msg(d.trimesterDesc)}
                  </p>
                </div>

                {!d.valid && (
                  <div className="mt-3 flex items-start gap-2 rounded-xl border-l-4 border-l-amber-500 bg-amber-500/10 px-3 py-2 text-[11.5px] text-foreground">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                    {__ui("按该日期计算出的孕周超出正常范围，请核对所填日期。")}</div>
                )}
              </SectionCard>

              <SectionCard icon={<CalendarDays className="h-4 w-4" />} title={__ui("关键产检时间表")}>
                <div className="overflow-hidden rounded-xl border border-border/60">
                  <table className="w-full border-collapse text-xs">
                    <thead>
                      <tr className="bg-muted/60">
                        <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("孕周")}</th>
                        <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("对应日期")}</th>
                        <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("项目")}</th>
                        <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("说明")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {CHECKS.map((c) => {
                        const startWeek = Number(c.weeks.match(/^(\d+)/)?.[1] || 0);
                        const date = d.week(startWeek);
                        const passed = d.gestDays >= startWeek * 7;
                        return (
                          <tr key={c.item} className={cn("border-t border-border/40 even:bg-muted/20", passed && "opacity-60")}>
                            <td className="whitespace-nowrap px-3 py-2 text-foreground">
                              {c.weeks}
                              {passed && <Badge variant="secondary" className="ml-1.5 font-normal">{__ui("已过")}</Badge>}
                            </td>
                            <td className="whitespace-nowrap px-3 py-2 font-mono text-muted-foreground">
                              {date.toLocaleDateString(__localeTag(), { month: "2-digit", day: "2-digit" })}
                            </td>
                            <td className="px-3 py-2 text-foreground">{c.item}</td>
                            <td className="px-3 py-2 text-muted-foreground">{__ui(c.note)}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  {__ui("这张表是常规产检节奏，仅作提醒用；具体项目与时间以产检医院的安排为准。")}</p>
              </SectionCard>
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
