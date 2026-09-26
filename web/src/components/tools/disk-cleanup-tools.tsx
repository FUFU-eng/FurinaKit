"use client";
import { createUiText as __createUiText, useLanguage as __useLanguage, uiCount as __count } from "@/lib/language";
const __ui = __createUiText("components/tools/disk-cleanup-tools.tsx");


import { useCallback, useEffect, useState } from "react";
import { FolderOpen, Loader2 } from "lucide-react";
import { Button, Select } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useTheme } from "@/components/theme-provider";

const gb = (bytes: number) => (bytes / 1024 ** 3 >= 1 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${(bytes / 1024 ** 2).toFixed(0)} MB`);

/* ────────────────────────── 占用空间排查（只读） ────────────────────────── */

interface BigFile {
  path: string;
  name: string;
  sizeBytes: number;
  modified: number | string | null;
  kind: string;
}

interface DirUsage {
  path: string;
  name: string;
  sizeBytes: number;
  fileCount: number;
}

/** 文件所在目录：按文件名最后一次出现的位置截取，避免 replace 误伤同名父目录 */
const parentDirOf = (path: string, name: string) => {
  const idx = path.lastIndexOf(name);
  return idx > 0 ? path.slice(0, idx) : path;
};

export function BigFileScanTool() {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  const { toast } = useToast();
  const [roots, setRoots] = useState<{ id: string; label: string; path: string }[]>([]);
  const [root, setRoot] = useState("");
  const [mode, setMode] = useState<"files" | "dirs">("files");
  const [minMB, setMinMB] = useState("100");
  const [files, setFiles] = useState<BigFile[]>([]);
  const [dirs, setDirs] = useState<DirUsage[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanNotice, setScanNotice] = useState("");
  const [hasScanned, setHasScanned] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/system/big-files", { cache: "no-store" });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "目录列表读取失败");
        setRoots(data.roots || []);
        if (data.roots?.length) setRoot((current) => current || data.roots[0].path);
      } catch (err) {
        setScanNotice(err instanceof Error ? err.message : "目录列表读取失败");
      }
    })();
  }, []);

  const scan = useCallback(async () => {
    if (!root) return;
    setScanning(true);
    setFiles([]);
    setDirs([]);
    setScanNotice("");
    setHasScanned(false);
    try {
      const res = await fetch(
        `/api/system/big-files?root=${encodeURIComponent(root)}&mode=${mode}&minMB=${minMB}`,
        { cache: "no-store" },
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "扫描失败");
      setFiles(data.files || []);
      setDirs(data.dirs || []);
      setHasScanned(true);
      if (data.scanTruncated || data.resultsTruncated || data.skippedEntries) {
        setScanNotice(`有限扫描：${data.scanTruncated ? "已达到时间、深度或条目上限；" : ""}${data.resultsTruncated ? "仅显示前 300 项；" : ""}${data.skippedEntries || 0} 项不可访问或联接项已跳过。`);
      }
      if (mode === "files" && (data.files || []).length === 0) {
        toast({ title: "没有找到符合条件的文件", description: "试试把体积下限调小一点", variant: "info" });
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "扫描失败";
      setScanNotice(message);
      toast({ title: "扫描失败", description: message, variant: "error" });
    } finally {
      setScanning(false);
    }
  }, [root, mode, minMB, toast]);

  const revealInExplorer = async (p: string) => {
    try {
      if (typeof window !== "undefined" && window.furinakit?.openPath) {
        await window.furinakit.openPath(p);
      } else {
        const { invoke } = await import("@tauri-apps/api/core");
        await invoke("open_path", { path: p });
      }
    } catch (e) {
      toast({ title: "打开失败", description: e instanceof Error ? e.message : String(e), variant: "error" });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium" style={{ color: colors.text }}>{__ui("扫描位置")}</span>
            <Select value={root} onChange={(e) => { setRoot(e.target.value); setFiles([]); setDirs([]); setHasScanned(false); }} disabled={scanning} className="w-56">
              {root && !roots.some((r) => r.path === root) && <option value={root}>{__ui("自定义目录")}</option>}
              {roots.map((r) => (
                <option key={r.id} value={r.path}>{__ui(r.label)}</option>
              ))}
            </Select>
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[12.5px] font-medium" style={{ color: colors.text }}>{__ui("看什么")}</span>
            <Select value={mode} onChange={(e) => { setMode(e.target.value as "files" | "dirs"); setFiles([]); setDirs([]); setHasScanned(false); }} disabled={scanning} className="w-44">
              <option value="files">{__ui("最大的文件")}</option>
              <option value="dirs">{__ui("最占地方的文件夹")}</option>
            </Select>
          </label>
          {mode === "files" && (
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px] font-medium" style={{ color: colors.text }}>{__ui("体积下限")}</span>
              <Select value={minMB} onChange={(e) => { setMinMB(e.target.value); setFiles([]); setDirs([]); setHasScanned(false); }} disabled={scanning} className="w-32">
                <option value="10">10 MB</option>
                <option value="50">50 MB</option>
                <option value="100">100 MB</option>
                <option value="500">500 MB</option>
                <option value="1024">1 GB</option>
              </Select>
            </label>
          )}
          <Button className="gap-1.5" onClick={() => void scan()} disabled={scanning || !root}>
            {scanning ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
            {scanning ? __ui("正在扫描…") : __ui("开始扫描")}
          </Button>
        </div>
        <p className="mt-3 text-[11.5px]" style={{ color: colors.muted }}>
          {__ui("只在点击开始后扫描，仅读取文件元数据，不读取内容；有深度、时间和条目上限，跳过联接与符号链接。本工具仅做只读排查，不提供删除功能。")}</p>
        <label className="mt-3 flex flex-col gap-1.5 text-xs text-muted-foreground">
          {__ui("自定义扫描目录（完整路径）")}<input aria-label={__ui("自定义扫描目录")} className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground" value={root} disabled={scanning} onChange={(e) => { setRoot(e.target.value); setFiles([]); setDirs([]); setHasScanned(false); }} placeholder={__ui("例如 E:\\测试资料")} />
        </label>
        {scanNotice && <p role="status" className="mt-3 text-xs text-amber-600 dark:text-amber-400">{scanNotice}</p>}
      </section>

      {mode === "files" && files.length > 0 && (
        <section className="rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
          <h2 className="mb-3 text-[14px] font-semibold" style={{ color: colors.text }}>
            {__ui("最大的")}{__count(files.length, "个文件")} <span className="ml-2 text-[12px] font-normal" style={{ color: colors.muted }}>
              {__ui("合计")}{gb(files.reduce((s, f) => s + f.sizeBytes, 0))}
            </span>
          </h2>
          <div className="max-h-[520px] overflow-y-auto">
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0" style={{ background: colors.card }}>
                <tr style={{ color: colors.muted }}>
                  <th className="py-2 text-left font-medium">{__ui("文件")}</th>
                  <th className="py-2 text-right font-medium">{__ui("体积")}</th>
                  <th className="py-2 text-right font-medium">{__ui("修改时间")}</th>
                  <th className="w-16 py-2" />
                </tr>
              </thead>
              <tbody>
                {files.map((f) => (
                  <tr key={f.path} className="border-t" style={{ borderColor: colors.border }}>
                    <td className="min-w-0 py-1.5 pl-1" style={{ color: colors.text }}>
                      <span className="block truncate" title={f.path}>{f.name}</span>
                      <span className="block truncate text-[11px]" style={{ color: colors.muted }} title={f.path}>
                        {parentDirOf(f.path, f.name)}
                      </span>
                    </td>
                    <td className="py-1.5 text-right font-mono" style={{ color: colors.text }}>{gb(f.sizeBytes)}</td>
                    <td className="py-1.5 text-right" style={{ color: colors.muted }}>{f.modified === null ? "—" : new Date(f.modified).toLocaleString()}</td>
                    <td className="py-1.5 text-center">
                      <button onClick={() => revealInExplorer(f.path)} title={__ui("在文件夹中显示")} style={{ color: colors.muted }}>
                        <FolderOpen size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {mode === "dirs" && dirs.length > 0 && (
        <section className="rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
          <h2 className="mb-3 text-[14px] font-semibold" style={{ color: colors.text }}>{__ui("最占地方的文件夹")}</h2>
          <div className="flex flex-col gap-3">
            {dirs.map((d) => {
              const max = dirs[0]?.sizeBytes || 1;
              return (
                <div key={d.path}>
                  <div className="mb-1 flex items-center justify-between text-[12.5px]">
                    <div className="flex items-center gap-2 truncate">
                      <button
                        onClick={() => revealInExplorer(d.path)}
                        title={__ui("在文件夹中显示")}
                        className="hover:opacity-80 transition-opacity shrink-0"
                        style={{ color: colors.blue }}
                      >
                        <FolderOpen size={14} />
                      </button>
                      <span className="truncate cursor-pointer hover:underline" onClick={() => revealInExplorer(d.path)} style={{ color: colors.text }} title={d.path}>{d.name}</span>
                    </div>
                    <span className="shrink-0 pl-3" style={{ color: colors.muted }}>
                      {gb(d.sizeBytes)} · {__count(d.fileCount, "个文件")} </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full" style={{ background: colors.btnHover }}>
                    <div className="h-full rounded-full" style={{ width: `${(d.sizeBytes / max) * 100}%`, background: colors.blue }} />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {!scanning && hasScanned && files.length === 0 && dirs.length === 0 && (
        <section className="rounded-2xl border p-8 text-center" style={{ borderColor: colors.borderSolid }}>
          <p className="text-[13px]" style={{ color: colors.muted }}>
            {__ui("本次扫描没有找到符合条件的结果")}{mode === "files" ? __ui("，试试调小体积下限或换个目录") : __ui("，换个目录试试")}。
          </p>
        </section>
      )}

      {!scanning && !hasScanned && files.length === 0 && dirs.length === 0 && (
        <section className="rounded-2xl border p-8 text-center" style={{ borderColor: colors.borderSolid }}>
          <p className="text-[13px]" style={{ color: colors.muted }}>
            {__ui("选择位置后点「开始扫描」，找出真正占地方的文件与文件夹")}</p>
        </section>
      )}
    </div>
  );
}
