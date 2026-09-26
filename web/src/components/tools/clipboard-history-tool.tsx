
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/clipboard-history-tool.tsx");
import {ClipboardImage} from "./clipboard-image";
import {ShortcutHint} from "@/lib/tool-shortcut";
"use client";
import { useEscapeDismiss } from "@/lib/use-escape-dismiss";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  ClipboardList,
  RefreshCw,
  Copy,
  Pause,
  Play,
  Pin,
  Search,
  Trash2,
  Clock3,
  FileText,
  X,
} from "lucide-react";
import { Button, Input, Select } from "@/components/ui/primitives";
import { useScopedToast } from "@/components/ui/toast";
import { retentionDays } from "@/lib/clipboard-policy";

type Item = {
  id: string;
  kind: string;
  text: string;
  thumbnail: string | null;
  at: number;
  expires: number | null;
  pinned: boolean;
  bytes: number;
};
type Detail = {
  id: string;
  kind: string;
  text: string;
  offset: number;
  pageSize: number;
  totalCharacters: number;
  bytes: number;
};
type Config = {
  enabled: boolean;
  days: number;
  path: string;
  warning: string | null;
  verification?: boolean;
};
const kinds: Record<string, string> = {
  all: "全部",
  text: "文字",
  link: "链接",
  image: "图片",
  files: "文件",
};
export function ClipboardHistoryTool({compact=false}:{compact?:boolean}) {
  const __locale = __useLanguage();
  const { toast } = useScopedToast("clipboard-history");
  const [config, setConfig] = useState<Config | null>(null),
    [items, setItems] = useState<Item[]>([]),
    [total, setTotal] = useState(0);
  const [query, setQuery] = useState(""),
    [kind, setKind] = useState("all"),
    [page, setPage] = useState(0);
  const [from,setFrom]=useState(""),[until,setUntil]=useState("");
  const queryKey = JSON.stringify([query, kind, page, from, until]);
  const currentQuery = useRef(queryKey);
  const [renderedQuery, setRenderedQuery] = useState("");
  const queryPending = renderedQuery !== queryKey;
  useLayoutEffect(() => { currentQuery.current = queryKey; }, [queryKey]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [dismissedWarning, setDismissedWarning] = useState<string | null>(null),
    [confirm, setConfirm] = useState(false),
    [days, setDays] = useState("0");
  const [licenses, setLicenses] = useState("");
  const [retention, setRetention] = useState<Item | null>(null),
    [entryDays, setEntryDays] = useState("0"),
    [detail, setDetail] = useState<Detail | null>(null);
  useEscapeDismiss(()=>{if(busy)return;if(retention)setRetention(null);else if(detail)setDetail(null);else setConfirm(false);},!!retention||!!detail||confirm,100);
  const actionLock = useRef(false);
  const generation = useRef(0),
    mounted = useRef(true);
  const reload = useCallback(async () => {
    const g = ++generation.current;
    try {
      const [r, c] = await Promise.all([
        invoke<{ items: Item[]; total: number }>("clip_list", {
          query,
          kind,
          offset: page * 30,
          from: from ? new Date(`${from}T00:00:00`).getTime() : null,
          until: until ? new Date(`${until}T23:59:59.999`).getTime() : null,
        }),
        invoke<Config>("clip_settings"),
      ]);
      if (!mounted.current || g !== generation.current || currentQuery.current !== queryKey) return;
      setItems(r.items);
      setTotal(r.total);
      setConfig(c);
      setError("");
      setRenderedQuery(queryKey);
      const maxPage = Math.max(0, Math.ceil(r.total / 30) - 1);
      if (page > maxPage) setPage(maxPage);
    } catch (e) {
      if (mounted.current && g === generation.current && currentQuery.current === queryKey) {
        setItems([]); setTotal(0); setRenderedQuery(queryKey);
        setError(e instanceof Error ? e.message : String(e));
      }
    }
  }, [query, kind, page, queryKey, from, until]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      ++generation.current;
    };
  }, []);
  useEffect(() => {
    void reload();
    let off: (() => void) | undefined,
      ended = false;
    void listen("clipboard-history-changed", () => void reload())
      .then((fn) => {
        if (ended) fn();
        else off = fn;
      })
      .catch(() => {});
    return () => {
      ended = true;
      off?.();
      ++generation.current;
    };
  }, [reload]);
  useEffect(() => {
    if (config) setDays(String(config.days));
  }, [config?.days]);
  const act = async (fn: () => Promise<unknown>, message?: string) => {
    if (actionLock.current) return false;
    actionLock.current = true;
    setBusy(true);
    try {
      await fn();
      await reload();
      if (message && mounted.current)
        toast({ title: __ui(message), variant: "success" });
      return true;
    } catch (e) {
      if (mounted.current)
        toast({
          title: __ui("操作未完成"),
          description: String(e),
          variant: "error",
        });
      return false;
    } finally {
      actionLock.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  const saveConfig = (enabled: boolean) => {
    try {
      const n = retentionDays(days);
      void act(
        () => invoke("clip_configure", { enabled, days: n }),
        "剪贴板设置已保存",
      );
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : String(e), variant: "error" });
    }
  };
  const toggleRecording = () => {
    if (config)
      void act(
        () =>
          invoke("clip_configure", {
            enabled: !config.enabled,
            days: config.days,
          }),
        config.enabled ? "已暂停记录" : "已继续记录",
      );
  };
  const saveEntry = () => {
    if (!retention) return;
    try {
      const n = retentionDays(entryDays);
      void act(async () => {
        await invoke("clip_set_retention", { id: retention.id, days: n });
        if (mounted.current) setRetention(null);
      }, "此条记录的保存期限已更新");
    } catch (e) {
      toast({ title: e instanceof Error ? e.message : String(e), variant: "error" });
    }
  };
  const dismissWarning = async () => {
    setDismissedWarning(config?.warning || error || "dismissed");
    setError("");
    try {
      await invoke("clip_dismiss_warning");
      setConfig((prev) => (prev ? { ...prev, warning: null } : null));
    } catch (_) {}
  };
  const showDetails = (id: string, offset = 0) =>
    void act(async () => {
      const d = await invoke<Omit<Detail, "id">>("clip_details", {
        id,
        offset,
      });
      if (mounted.current) setDetail({ ...d, id });
    });
  return (
    <div className="space-y-4">
      <section className={compact?"space-y-3":"rounded-2xl border border-border bg-card p-4"}>
        <div className={compact?"hidden":"mb-4 flex flex-wrap items-center gap-3"}>
          {!compact&&<><span className="rounded-xl bg-primary/10 p-3 text-primary">
            <ClipboardList size={21} />
          </span>
          <div className="flex-1">
            <h2 className="font-semibold">{__ui("永久剪切板")}</h2>
            <p className="text-xs text-muted-foreground">
              {__ui("复制过的内容，留在本机。")}</p>
          </div>
          </>}

        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_100px] items-center gap-2">
          <div className="relative min-w-0"><Search size={15} className="pointer-events-none absolute left-3 top-1/2 z-10 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="w-full pl-9"
            placeholder={__ui("搜索文字、链接或文件路径")}
            disabled={busy}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setPage(0);
            }}
          />
          </div>
          <Select
            disabled={busy}
            value={kind}
            onChange={(e) => {
              setKind(e.target.value);
              setPage(0);
            }}
          >
            {Object.entries(kinds).map(([k, v]) => (
              <option key={k} value={k}>
                {__ui(v)}
              </option>
            ))}
          </Select>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <label className="flex items-center gap-1">{__ui("从")}<Input aria-label={__ui("起始日期")} type="date" className="w-36 text-xs" value={from} onChange={e=>{setFrom(e.target.value);setPage(0);}}/></label>
          <label className="flex items-center gap-1">{__ui("至")}<Input aria-label={__ui("结束日期")} type="date" className="w-36 text-xs" value={until} onChange={e=>{setUntil(e.target.value);setPage(0);}}/></label>
          {(from||until)&&<Button size="sm" variant="ghost" onClick={()=>{setFrom("");setUntil("");setPage(0);}}>{__ui("全部日期")}</Button>}
          <div className="ml-auto flex items-center gap-1 rounded-xl border border-border bg-card/70 p-1"><button type="button" title={__ui("刷新历史")} aria-label={__ui("刷新历史")} className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-40" disabled={busy} onClick={()=>void reload()}><RefreshCw size={14}/>{__ui("刷新")}</button><span className="h-4 border-l border-border"/><button type="button" className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs hover:bg-muted disabled:opacity-40" disabled={!config||busy} onClick={toggleRecording}>{config?.enabled?<Pause size={14}/>:<Play size={14}/>} {config?.enabled?__ui("暂停记录"):__ui("继续记录")}</button></div>
        </div>
        <details className="mt-3 text-xs text-muted-foreground"><summary className="cursor-pointer select-none">{__ui("保留期限、隐私与存储设置")}</summary>
        <div className="mt-4 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-muted-foreground">{__ui("新记录默认保留")}</span>
          <Input
            aria-label={__ui("保留天数")}
            className="w-24"
            type="number"
            min={0}
            max={36500}
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
          <span className="text-muted-foreground">{__ui("天（0 为永久）")}</span>
          <Button
            size="sm"
            variant="outline"
            disabled={!config || busy}
            onClick={() => config && saveConfig(config.enabled)}
          >
            {__ui("保存")}</Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => {
              setDays("0");
            }}
          >
            {__ui("填入永久")}</Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => setConfirm(true)}
          >
            <Trash2 size={13} />
            {__ui("清空历史")}</Button>
        </div>
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          {config?.enabled ? __ui("正在记录") : __ui("已暂停")} {__ui("· 文字、链接、图片保存完整副本；文件和文件夹只保存路径。置顶记录永久保留。更改默认天数不缩短已有记录的期限。每条记录也可单独设置期限；取消置顶后仍保留永久期限。")}</p>
        {config?.verification && (
          <p className="mt-2 text-xs text-primary">
            {__ui("隔离验证模式：当前记录不会写入正式历史库。")}</p>
        )}
        <p className="mt-2 text-xs leading-relaxed text-amber-600 dark:text-amber-400">
          {__ui("广泛记录可能包含密码等敏感内容；已识别的“禁止历史记录”标记会被跳过，但无法识别所有秘密或应用私有格式。历史未加密，请及时暂停或删除。")}</p>
        {config && (
          <details className="mt-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer">{__ui("存储位置与限制")}</summary>
            <p className="mt-2 break-all">{config.path}</p>
            <p>
              {__ui("单条最多 64 MiB，超限不截断保存；图片最多 1 亿像素。不上传历史，不自动打开链接或文件。清空历史不修改当前系统剪贴板。")}</p>
          </details>
        )}
        <details
          className="mt-2 text-xs text-muted-foreground"
          onToggle={(e) => {
            if (e.currentTarget.open && !licenses)
              void invoke<string>("clip_licenses")
                .then(setLicenses)
                .catch((e) => setLicenses(String(e)));
          }}
        >
          <summary className="cursor-pointer">{__ui("开源组件与许可证")}</summary>
          <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap text-[11px]">
            {licenses || __ui("正在读取…")}
          </pre>
        </details>
        </details>
      </section>
      {!queryPending && (error || (config?.warning && config.warning !== dismissedWarning)) && (
        <div
          role="alert"
          className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm"
        >
          <span className="flex-1 min-w-0 break-words">{__msg(error) || __msg(config?.warning)}</span>
          <button
            type="button"
            className="shrink-0 rounded-lg p-1 text-muted-foreground hover:bg-amber-500/10 hover:text-foreground transition-colors"
            title={__ui("关闭提示")}
            aria-label={__ui("关闭提示")}
            onClick={() => void dismissWarning()}
          >
            <X size={15} />
          </button>
        </div>
      )}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span role="status">{queryPending ? __ui("正在加载历史…") : __msg("找到 {0} 条 · 每页 30 条", total)}</span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            disabled={!page || busy || queryPending}
            onClick={() => setPage((p) => p - 1)}
          >
            {__ui("上一页")}</Button>
          <span>{page + 1}</span>
          <Button
            size="sm"
            variant="ghost"
            disabled={(page + 1) * 30 >= total || busy || queryPending}
            onClick={() => setPage((p) => p + 1)}
          >
            {__ui("下一页")}</Button>
        </div>
      </div>
      {!queryPending && !items.length && !error && (
        <div className="rounded-2xl border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
          {query || kind !== "all" ? __ui("没有匹配的历史，可清除筛选条件再试。") : __ui("暂无记录。开启记录后，复制新内容即可。")}
        </div>
      )}
      {items.map((item) => (
        <section
          key={item.id}
          className="flex cursor-pointer items-start gap-4 rounded-2xl border border-border bg-card p-4 transition-colors hover:border-primary/40"
          tabIndex={0} aria-label={compact?__ui("粘贴此条内容到原输入窗口"):__ui("复制此条内容")}
          onClick={e=>{if(busy||queryPending||(e.target as HTMLElement).closest("button,input,select,a"))return;void act(()=>invoke("clip_restore",{id:item.id,asText:false,paste:compact}),compact?undefined:"已复制到系统剪贴板");}}
          onKeyDown={e=>{if(e.target!==e.currentTarget||busy||queryPending)return;if(e.key==="Enter"){e.preventDefault();void act(()=>invoke("clip_restore",{id:item.id,asText:false,paste:compact}));}}}
        >
          {item.thumbnail&&<ClipboardImage id={item.id} thumbnail={item.thumbnail}/>}
          <div className="min-w-0 flex-1">
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="rounded-md bg-secondary px-2 py-1">
                {__ui(kinds[item.kind] || item.kind)}
              </span>
              <span>{new Date(item.at).toLocaleString()}</span>
              <span>
                {item.pinned
                  ? __ui("已置顶 · 永久")
                  : item.expires
                    ? __msg("保留至 {0}", new Date(item.expires).toLocaleDateString())
                    : __ui("永久保留")}
              </span>
            </div>
            <p className="line-clamp-4 whitespace-pre-wrap break-all text-sm leading-relaxed">
              {item.text}
            </p>
            {item.kind === "files" && (
              <p className="mt-2 text-xs text-muted-foreground">
                {__ui("仅路径记录：原文件移动、删除或离线后无法还原文件复制。")}</p>
            )}
          </div>
          <div className="flex shrink-0 flex-col gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                void act(
                  () => invoke("clip_restore", { id: item.id, asText: false }),
                  "已复制到系统剪贴板",
                )
              }
            >
              <Copy size={13} />
              {__ui("复制")}</Button>
            {item.kind === "files" && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() =>
                  void act(
                    () => invoke("clip_restore", { id: item.id, asText: true }),
                    "已复制路径",
                  )
                }
              >
                {__ui("复制路径")}</Button>
            )}
            {item.kind !== "image" && (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => showDetails(item.id)}
              >
                <FileText size={13} />
                {__ui("查看内容")}</Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setRetention(item);
                setEntryDays(
                  item.expires
                    ? String(
                        Math.max(
                          1,
                          Math.ceil((item.expires - Date.now()) / 86400000),
                        ),
                      )
                    : "0",
                );
              }}
            >
              <Clock3 size={13} />
              {__ui("保存期限")}</Button>
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                aria-label={
                  item.pinned ? __ui("取消置顶（仍永久保留）") : __ui("置顶并永久保存")
                }
                title={
                  item.pinned ? __ui("取消置顶（仍永久保留）") : __ui("置顶并永久保存")
                }
                onClick={() =>
                  void act(() =>
                    invoke("clip_pin", { id: item.id, pinned: !item.pinned }),
                  )
                }
              >
                <Pin
                  size={14}
                  className={item.pinned ? "text-primary" : "opacity-50"}
                />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                aria-label={__ui("删除记录")}
                onClick={() =>
                  void act(() =>
                    invoke("clip_delete", { id: item.id, confirmAll: false }),
                  )
                }
              >
                <Trash2 size={14} />
              </Button>
            </div>
          </div>
        </section>
      ))}
      {retention && (
        <div
          className="fixed inset-0 z-[210] grid place-items-center bg-black/40 p-6 backdrop-blur-sm"
          onKeyDown={(e) => {
            if (e.key === "Escape") {e.preventDefault();e.stopPropagation();if(!busy)setRetention(null);}
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="clip-retention-title"
            className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl"
          >
            <h2 id="clip-retention-title" className="font-semibold">
              {__ui("设置这条记录的保存期限")}</h2>
            <p className="my-3 text-sm text-muted-foreground">
              {__ui("只修改当前记录。有限天数从现在起计算；0 为永久。")}{retention.pinned
                ? __ui("此条已置顶，设置有限期限前请先取消置顶。")
                : ""}
            </p>
            <label className="flex items-center gap-3 text-sm">
              {__ui("保留天数")}<Input
                autoFocus
                aria-label={__ui("此条记录保留天数")}
                type="number"
                min={0}
                max={36500}
                value={entryDays}
                disabled={busy}
                onChange={(e) => setEntryDays(e.target.value)}
                className="w-28"
              />
            </label>
            <div className="my-4 flex flex-wrap gap-2">
              {[7, 30, 90, 0].map((n) => (
                <Button
                  key={n}
                  size="sm"
                  variant="outline"
                  disabled={busy || (retention.pinned && n !== 0)}
                  onClick={() => setEntryDays(String(n))}
                >
                  {n ? __msg("{0} 天", n) : __ui("永久")}
                </Button>
              ))}
            </div>
            <div className="flex justify-end gap-3">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => setRetention(null)}
              >
                {__ui("取消")}</Button>
              <Button disabled={busy} onClick={saveEntry}>
                {__ui("保存期限")}</Button>
            </div>
          </section>
        </div>
      )}
      {detail && (
        <div
          className="fixed inset-0 z-[210] grid place-items-center bg-black/40 p-6 backdrop-blur-sm"
          onKeyDown={(e) => {
            if (e.key === "Escape") {e.preventDefault();e.stopPropagation();if(!busy)setDetail(null);}
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="clip-detail-title"
            className="flex max-h-[85vh] w-full max-w-3xl flex-col rounded-2xl border border-border bg-card p-6 shadow-xl"
          >
            <h2 id="clip-detail-title" className="font-semibold">
              {__ui("剪贴板内容")}</h2>
            <p className="my-3 text-xs text-muted-foreground">
              {__ui("共")}{detail.totalCharacters.toLocaleString()} {__ui("字符，每页最多 32000 字符；下方复制操作使用完整原记录，不仅是当前预览。富文本在这里安全显示为纯文本，不执行 HTML。")}</p>
            <pre className="min-h-24 flex-1 overflow-auto whitespace-pre-wrap break-all rounded-xl bg-secondary/40 p-4 font-sans text-sm leading-relaxed">
              {detail.text}
            </pre>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy || detail.offset === 0}
                  onClick={() =>
                    showDetails(
                      detail.id,
                      Math.max(0, detail.offset - detail.pageSize),
                    )
                  }
                >
                  {__ui("上一段")}</Button>
                <span className="text-xs text-muted-foreground">
                  {__ui("第")}{Math.floor(detail.offset / detail.pageSize) + 1} /{" "}
                  {Math.max(
                    1,
                    Math.ceil(detail.totalCharacters / detail.pageSize),
                  )}{" "}
                  {__ui("段")}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={
                    busy ||
                    detail.offset + detail.pageSize >= detail.totalCharacters
                  }
                  onClick={() =>
                    showDetails(detail.id, detail.offset + detail.pageSize)
                  }
                >
                  {__ui("下一段")}</Button>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () =>
                        invoke("clip_restore", { id: detail.id, asText: true }),
                      "已复制完整文本",
                    )
                  }
                >
                  <Copy size={13} />
                  {__ui("复制完整文本")}</Button>
                <Button
                  autoFocus
                  disabled={busy}
                  onClick={() => setDetail(null)}
                >
                  {__ui("关闭")}</Button>
              </div>
            </div>
          </section>
        </div>
      )}
      {confirm && (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40 p-6 backdrop-blur-sm"
          onKeyDown={(e) => {
            if (e.key === "Escape") {e.preventDefault();e.stopPropagation();if(!busy)setConfirm(false);}
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="clip-clear-title"
            className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-xl"
          >
            <h2 id="clip-clear-title" className="font-semibold">
              {__ui("清空全部剪贴板历史？")}</h2>
            <p className="my-4 text-sm text-muted-foreground">
              {__ui("包括置顶和永久记录。此操作不可撤销，但不会删除原文件，也不会清空当前系统剪贴板。")}</p>
            <div className="flex justify-end gap-3">
              <Button
                autoFocus
                variant="outline"
                disabled={busy}
                onClick={() => setConfirm(false)}
              >
                {__ui("取消")}</Button>
              <Button
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await invoke("clip_delete", { id: null, confirmAll: true });
                    setConfirm(false);
                    setPage(0);
                  }, "历史已清空")
                }
              >
                {__ui("确认清空")}</Button>
            </div>
          </section>
        </div>
      )}
      {!compact&&<div className="flex justify-end"><ShortcutHint toolId="clipboard-history"/></div>}
    </div>
  );
}
