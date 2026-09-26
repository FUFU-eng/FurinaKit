import {tr,uiMessage} from "@/lib/language";
import {dropEntries} from "@/lib/folder-import";
import {droppedImages,fileBase64} from "@/lib/dedup-folder-input";
"use client";
import { createUiText as __createUiText, useLanguage as __useLanguage, uiCount as __count } from "@/lib/language";
const __ui = __createUiText("components/tools/image-dedup-tool.tsx");


/**
 * 图片查重（重复图片检测）
 *
 * 流程：选文件夹 → 逐张算感知哈希 → 按相似度分组 → 勾选 → 移到「待删除」文件夹。
 *
 * 几个刻意的设计：
 *  · **绝不直接删文件**：确认后只在所选文件夹下建一个「_重复待删除」目录并保留原目录结构，
 *    用户随时可以自己还原；
 *  · **不替用户做决定**：每组给出「建议保留」的那一张（组内最居中、分辨率最高），
 *    但默认一张都不勾选，删哪些由用户自己定；
 *  · 分档展示：完全相同 / 高度相似 / 相似（可能是连拍），档位不同，用户该谨慎的程度也不同。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FolderOpen, HardDrive, Loader2, ScanSearch, Trash2 } from "lucide-react";
import { Button, Select } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";
import {
  computeHashes,
  groupImages,
  summarize,
  TIER_HINT,
  TIER_LABEL,
  type DedupGroup,
  type DedupItem,
  type Tier,
} from "@/lib/image-dedup";

interface FileEntry {
  path: string;
  name: string;
  size: number;
  mtime: number;
}

interface Bridge {
  dedupPickFolder?: () => Promise<{ success: boolean; dir?: string; error?: string; canceled?: boolean }>;
  dedupListImages?: (dir: string) => Promise<{ success: boolean; files?: FileEntry[]; error?: string }>;
  dedupReadImage?: (p: string) => Promise<{ success: boolean; base64?: string; size?: number; error?: string }>;
  dedupMoveToTrash?: (p: {
    files: string[];
    baseDir: string;
    trashName?: string;
  }) => Promise<{ success: boolean; trashRoot?: string; moved?: string[]; movedSources?: string[]; failed?: string[]; error?: string }>;
}

interface DisplayItem extends DedupItem {
  path: string;
  name: string;
  thumb: string;
}

export function ImageDedupTool() {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  const { toast } = useToast();
  const [dir, setDir] = useState("");
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState("");
  const [total, setTotal] = useState(0);
  const [groups, setGroups] = useState<DedupGroup[]>([]);
  const [meta, setMeta] = useState<Record<string, DisplayItem>>({});
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [tierFilter, setTierFilter] = useState<"all" | Tier>("all");
  const [includeSimilar, setIncludeSimilar] = useState(true);
  const [moving, setMoving] = useState(false);
  const [lastResult, setLastResult] = useState("");
  const [withThumbs, setWithThumbs] = useState(true);
  const abortRef = useRef(false);
  const scanLock=useRef(false);
  useEffect(()=>()=>{abortRef.current=true;},[]);
  const [readOnly,setReadOnly]=useState(false);

  const api = useCallback((): Bridge => (window as unknown as { furinakit?: Bridge }).furinakit ?? {}, []);

  /** 把一张图的字节解成像素（用浏览器原生解码，不需要额外依赖） */
  const pixelsOf = async (base64: string) => {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const blob = new Blob([bytes]);
    const bmp = await createImageBitmap(blob);
    const canvas = document.createElement("canvas");
    // 算哈希只需小尺寸，缩到 64 加快速度（感知哈希本身抗缩放）
    const scale = Math.min(1, 64 / Math.max(bmp.width, bmp.height));
    canvas.width = Math.max(8, Math.round(bmp.width * scale));
    canvas.height = Math.max(8, Math.round(bmp.height * scale));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("无法创建绘图上下文");
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const full = { w: bmp.width, h: bmp.height };
    bmp.close();
    return { data: imgData.data, width: canvas.width, height: canvas.height, full };
  };

  const thumbOf = async (base64: string, maxSide = 240) => {
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([bytes]));
    const canvas = document.createElement("canvas");
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const url = canvas.toDataURL("image/jpeg", 0.75);
    bmp.close();
    return url;
  };

  const scan = async (dropped?:File[]) => {
    if(scanLock.current||moving)return;
    scanLock.current=true;setScanning(true);
    const b=api();
    try {
      let directory=tr('拖入的图片（只读）','Dropped images (read-only)');
      if(!dropped){
        if(!b.dedupPickFolder||!b.dedupListImages||!b.dedupReadImage)throw new Error(tr('请在桌面版中选择文件夹。','Use the desktop app to select a folder.'));
        const picked=await b.dedupPickFolder();
        if(picked.canceled)return;
        if(!picked.success||!picked.dir)throw new Error(picked.error||tr('未能打开文件夹。','Unable to open the folder.'));
        directory=picked.dir;
      }
      setDir(directory);setReadOnly(Boolean(dropped));setGroups([]);setMeta({});setChecked(new Set());setLastResult('');setTotal(0);abortRef.current=false;
      setProgress(tr('正在列出图片…','Listing images…'));
      const listed=dropped?{success:true,files:dropped.map((f,i)=>({path:`dropped:${i}`,name:(f as File&{dedupRelative?:string}).dedupRelative||f.webkitRelativePath||f.name,size:f.size,mtime:f.lastModified})),error:undefined}:await b.dedupListImages!(directory);
      if(!listed.success||!listed.files)throw new Error(listed.error||tr('扫描失败','Scan failed'));
      const files=listed.files;
      let skipped=0;
      setTotal(files.length);
      if (files.length < 2) {
        setProgress("");
        toast({ title: "这个文件夹里的图片不够两张", description: "换个文件夹试试", variant: "info" });
        return;
      }

      const items: DedupItem[] = [];
      const metaMap: Record<string, DisplayItem> = {};
      for (let i = 0; i < files.length; i++) {
        if (abortRef.current) break;
        const f = files[i];
        setProgress(`正在分析 ${i + 1}/${files.length}：${f.name}`);
        try {
          const r = dropped ? {success:true,base64:await fileBase64(dropped[i])} : await b.dedupReadImage!(f.path);
          if (!r.success || !r.base64) {skipped++;continue;}
          const px = await pixelsOf(r.base64);
          const hashes = computeHashes({ data: px.data, width: px.width, height: px.height });
          const item: DedupItem = {
            id: f.path,
            size: f.size,
            width: px.full.w,
            height: px.full.h,
            hashes,
          };
          items.push(item);
          metaMap[f.path] = {
            ...item,
            path: f.path,
            name: f.name,
            thumb: withThumbs ? await thumbOf(r.base64) : "",
          };
        } catch {
          skipped++; // Unsupported/corrupt images are reported, never counted as unique.
        }
        if (i % 4 === 3) await new Promise((res) => setTimeout(res, 0)); // 让界面有机会刷新
      }

      setProgress("正在分组…");
      const gs = groupImages(items, includeSimilar);
      setGroups(gs);
      setMeta(metaMap);
      setProgress("");
      setTotal(items.length);
      setLastResult(tr(`已分析 ${items.length} 张，跳过 ${skipped} 张${abortRef.current?"（已停止）":""}`,`Analyzed ${items.length}; skipped ${skipped}${abortRef.current?" (stopped)":""}`));
      const s = summarize(gs);
      const dupImages = gs.reduce((n, g) => n + g.items.length, 0);
      toast({
        title: gs.length ? `找到 ${gs.length} 组相似图片` : "没有发现重复图片",
        description: gs.length
          ? `共 ${items.length} 张 · 涉及 ${dupImages} 张（完全相同 ${s.identical.images} · 高度相似 ${s.near.images} · 相似 ${s.similar.images}）`
          : `已分析 ${items.length} 张，都互不相似`,
        variant: gs.length ? "success" : "info",
      });
    } catch (err) {
      toast({ title: "分析失败", description: err instanceof Error ? err.message : "", variant: "error" });
      setProgress("");
    } finally {
      setScanning(false);scanLock.current=false;
    }
  };

  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** 除建议保留的那张外，整组勾上 */
  const checkGroupExceptKeep = (g: DedupGroup) => {
    setChecked((prev) => {
      const next = new Set(prev);
      for (const it of g.items) if (it.id !== g.suggestedKeep) next.add(it.id);
      return next;
    });
  };

  const runMove = async () => {
    const b = api();
    if (!b.dedupMoveToTrash || !dir || readOnly || scanning) return;
    const files = [...checked];
    if (!files.length) {
      toast({ title: "还没有勾选任何图片", variant: "info" });
      return;
    }
    if(!window.confirm(tr(`将选中的 ${files.length} 张图片移到原目录的「_重复待删除」文件夹？不会删除文件。`,`Move ${files.length} selected images to the quarantine folder inside the original directory? No files will be deleted.`)))return;
    setMoving(true);
    try {
      const r = await b.dedupMoveToTrash({ files, baseDir: dir, trashName: "_重复待删除" });
      if (!r.success) throw new Error(r.error || "移动失败");
      const moved = r.moved?.length ?? 0;
      const failed = r.failed ?? [];
      setLastResult(`已移动 ${moved} 张到「_重复待删除」${failed.length ? `，${failed.length} 张失败` : ""}`);
      toast({
        title: `已移动 ${moved} 张`,
        description: `文件没有删除，都放在 ${r.trashRoot}，确认无误后再自行清理`,
        variant: "success",
      });
      // 把移走的从结果里剔除
      const movedSet = new Set(r.movedSources || []);
      const remaining = groups
        .map((g) => ({ ...g, items: g.items.filter((i) => !movedSet.has(i.id)) }))
        .filter((g) => g.items.length >= 2);
      setGroups(remaining);
      setChecked(new Set());
    } catch (err) {
      toast({ title: "移动失败", description: err instanceof Error ? err.message : "", variant: "error" });
    } finally {
      setMoving(false);
    }
  };

  const visible = tierFilter === "all" ? groups : groups.filter((g) => g.tier === tierFilter);
  const stats = summarize(groups);
  const checkedSize = [...checked].reduce((n, id) => n + (meta[id]?.size ?? 0), 0);

  const tierColor = (t: Tier) => (t === "identical" ? colors.green : t === "near" ? colors.gold : colors.muted);

  return (
    <div className="flex flex-col gap-4" data-dedup-drop
      onDragOver={e=>{if(Array.from(e.dataTransfer.types).includes('Files')){e.preventDefault();e.stopPropagation();e.dataTransfer.dropEffect=scanning||moving?'none':'copy';}}}
      onDrop={e=>{e.preventDefault();e.stopPropagation();if(scanning||moving||scanLock.current)return;const entries=dropEntries(e.dataTransfer),files=Array.from(e.dataTransfer.files);scanLock.current=true;setScanning(true);void droppedImages(entries,files).then(list=>{scanLock.current=false;setScanning(false);return scan(list);}).catch(err=>{scanLock.current=false;setScanning(false);toast({title:tr('文件夹导入失败','Folder import failed'),description:uiMessage(String(err)),variant:'error'});});}}>
      <p className="rounded-xl border border-border bg-muted/30 p-3 text-xs text-muted-foreground">{tr('可拖入文件夹进行只读查重；如需整理原文件，请使用「选择文件夹」入口。扫描包含最多6层子目录，跳过待删除目录。','Drop a folder for read-only comparison. To organize original files, use Select folder. Scans include up to six subfolder levels and skip quarantine folders.')}</p>
      {readOnly&&<p className="text-xs text-amber-600">{tr('当前为拖入预览，原文件不会被移动或删除。','Read-only drop preview: original files cannot be moved or deleted.')}</p>}
      <div className="grid items-start gap-4 xl:grid-cols-[1fr_300px]">
        {/* 左：分组结果 */}
        <section className="min-w-0 rounded-2xl border p-4" style={{ borderColor: colors.borderSolid, background: colors.card }}>
          <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 text-[13.5px] font-semibold" style={{ color: colors.text }}>
                <ScanSearch size={15} /> {__ui("查重结果")}{total > 0 && (
                  <span className="text-[11.5px] font-normal" style={{ color: colors.muted }}>
                    {__ui("共分析")}{__count(total, "张")} {dir ? ` · ${dir}` : ""}
                  </span>
                )}
              </h2>
              {progress && (
                <p className="mt-1 flex items-center gap-1.5 text-[11.5px]" style={{ color: colors.muted }}>
                  <Loader2 size={11} className="animate-spin" /> {progress}
                </p>
              )}
              {lastResult && <p className="mt-1 text-[11.5px]" style={{ color: colors.green }}>{lastResult}</p>}
            </div>
            {groups.length > 0 && (
              <Select value={tierFilter} onChange={(e) => setTierFilter(e.target.value as "all" | Tier)} className="w-44">
                <option value="all">{__ui("全部档位")}</option>
                <option value="identical">{__ui("仅完全相同（")}{stats.identical.groups}）</option>
                <option value="near">{__ui("仅高度相似（")}{stats.near.groups}）</option>
                <option value="similar">{__ui("仅相似（")}{stats.similar.groups}）</option>
              </Select>
            )}
          </header>

          {groups.length === 0 && !scanning ? (
            <div className="flex flex-col items-center justify-center gap-2.5 rounded-xl border-2 border-dashed border-primary/40 bg-primary/[0.04] py-16">
              <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                <ScanSearch className="h-5 w-5" />
              </span>
              <p className="text-[13.5px] font-semibold" style={{ color: colors.text }}>{__ui("选一个文件夹开始查重")}</p>
              <p className="max-w-md text-center text-[11.5px] leading-relaxed" style={{ color: colors.muted }}>
                {__ui("程序会逐张分析画面内容，把长得像的图片分到一组。 确认后只把勾选的移到「_重复待删除」文件夹 ——")}<strong>{__ui("不会直接删除任何文件")}</strong>。
              </p>
            </div>
          ) : (
            <div className="flex max-h-[68vh] flex-col gap-3.5 overflow-y-auto overscroll-contain pr-1">
              {visible.map((g, gi) => (
                <div key={`${g.tier}-${gi}`} className="rounded-xl border p-3" style={{ borderColor: colors.borderSolid, background: colors.bg }}>
                  <header className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-[12.5px] font-medium" style={{ color: colors.text }}>
                      <span className="rounded px-1.5 py-0.5 text-[11px]" style={{ background: `${tierColor(g.tier)}22`, color: tierColor(g.tier) }}>
                        {__ui(TIER_LABEL[g.tier])}
                      </span>
                      {__count(g.items.length, "张")} <span className="text-[11px] font-normal" style={{ color: colors.muted }}>{TIER_HINT[g.tier]}</span>
                    </span>
                    <div className="flex items-center gap-1.5">
                      <Button size="sm" variant="outline" onClick={() => checkGroupExceptKeep(g)}>
                        {__ui("勾选除建议保留外")}</Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setChecked((prev) => {
                            const next = new Set(prev);
                            g.items.forEach((i) => next.delete(i.id));
                            return next;
                          })
                        }
                      >
                        {__ui("取消本组")}</Button>
                    </div>
                  </header>

                  <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
                    {g.items.map((it) => {
                      const m = meta[it.id];
                      const isKeep = it.id === g.suggestedKeep;
                      const on = checked.has(it.id);
                      return (
                        <button
                          key={it.id}
                          onClick={() => toggle(it.id)}
                          className="group relative overflow-hidden rounded-lg border-2 text-left transition-all"
                          style={{
                            borderColor: on ? colors.red : isKeep ? colors.green : colors.borderSolid,
                            background: colors.card,
                          }}
                          title={m?.path ?? it.id}
                        >
                          {m?.thumb ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={m.thumb} alt={m.name} className="h-24 w-full object-cover" />
                          ) : (
                            <div className="flex h-24 w-full items-center justify-center text-[11px]" style={{ color: colors.muted }}>
                              {withThumbs ? __ui("无预览") : __ui("已关预览")}
                            </div>
                          )}
                          {isKeep && (
                            <span className="absolute left-1 top-1 flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-white" style={{ background: colors.green }}>
                              <CheckCircle2 size={9} /> {__ui("建议保留")}</span>
                          )}
                          {on && (
                            <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full text-[10px] text-white" style={{ background: colors.red }}>
                              ✓
                            </span>
                          )}
                          <span className="block truncate px-1.5 py-1 text-[11px]" style={{ color: colors.text }}>
                            {m?.name ?? it.id.split(/[\\/]/).pop()}
                          </span>
                          <span className="block px-1.5 pb-1 text-[10.5px]" style={{ color: colors.muted }}>
                            {it.width}×{it.height} · {(it.size / 1024).toFixed(0)} KB
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
              {visible.length === 0 && groups.length > 0 && (
                <p className="py-8 text-center text-[12px]" style={{ color: colors.muted }}>{__ui("这个档位下没有分组")}</p>
              )}
            </div>
          )}
          {groups.length > 0 && (
            <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-relaxed" style={{ color: colors.muted }}>
              <AlertTriangle size={11} className="mt-0.5 shrink-0" />
              <span>
                <strong>{__ui("不会删除文件")}</strong>{__ui("：只在所选文件夹下建「_重复待删除」目录并按原目录结构放进去， 确认无误后再自行清理；后悔了直接移回来即可。")}</span>
            </p>
          )}

          {groups.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border px-4 py-2.5 text-[12px]"
                 style={{ borderColor: colors.borderSolid, background: colors.bg }}>
              <span style={{ color: colors.muted }}>{__ui("完全相同")}<b className="font-mono" style={{ color: colors.text }}>{stats.identical.groups} {__ui("组 /")}{__count(stats.identical.images, "张")} </b></span>
              <span style={{ color: colors.muted }}>{__ui("高度相似")}<b className="font-mono" style={{ color: colors.text }}>{stats.near.groups} {__ui("组 /")}{__count(stats.near.images, "张")} </b></span>
              <span style={{ color: colors.muted }}>{__ui("相似")}<b className="font-mono" style={{ color: colors.text }}>{stats.similar.groups} {__ui("组 /")}{__count(stats.similar.images, "张")} </b></span>
              <span className="ml-auto flex items-center gap-3">
                <span style={{ color: colors.muted }}>{__ui("已勾选")}<b className="font-mono" style={{ color: colors.text }}>{checked.size} {__ui("张 ·")}{(checkedSize / 1024 / 1024).toFixed(1)} MB</b></span>
                <Button variant="destructive" size="sm" className="gap-1.5" onClick={() => void runMove()} disabled={moving || scanning || readOnly || checked.size === 0}>
                  {moving ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  {__ui("移到「_重复待删除」")}</Button>
              </span>
            </div>
          )}
        </section>

        {/* 右：操作 */}
        <div className="flex min-w-0 flex-col gap-4 overscroll-contain xl:sticky xl:top-4 xl:max-h-[calc(100vh-190px)] xl:overflow-y-auto xl:pr-1">
          <section className="rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
            <Button className="w-full gap-2" onClick={() => void scan()} disabled={scanning || moving}>
              {scanning ? <Loader2 size={14} className="animate-spin" /> : <FolderOpen size={14} />}
              {scanning ? __ui("正在分析…") : groups.length ? __ui("换一个文件夹") : __ui("选择文件夹开始查重")}
            </Button>
            <label className="mt-3.5 flex flex-col gap-1.5">
              <span className="text-[12.5px]" style={{ color: colors.muted }}>{__ui("相似档位")}</span>
              <Select value={includeSimilar ? "yes" : "no"} onChange={(e) => setIncludeSimilar(e.target.value === "yes")} disabled={scanning || moving}>
                <option value="yes">{__ui("包含「相似」（连拍也能找出来）")}</option>
                <option value="no">{__ui("只看「完全相同 / 高度相似」")}</option>
              </Select>
            </label>
            <label className="mt-3 flex items-center gap-2.5 text-[12.5px]" style={{ color: colors.text }}>
              <input type="checkbox" checked={withThumbs} onChange={(e) => setWithThumbs(e.target.checked)} />
              {__ui("显示缩略图")}</label>
            <p className="mt-2.5 text-[11px] leading-relaxed" style={{ color: colors.muted }}>
              {__ui("分析在本机完成，图片不会上传。改动档位后请重新扫描。")}</p>
          </section>


          <section className="rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
            <h3 className="mb-2.5 flex items-center gap-1.5 text-[12.5px] font-semibold" style={{ color: colors.muted }}>
              <HardDrive size={13} /> {__ui("判定说明")}</h3>
            <p className="text-[11.5px] leading-relaxed" style={{ color: colors.muted }}>
              {__ui("用感知哈希比较画面内容，而不是文件名或大小 —— 所以改名、压缩、加过水印的图同样能找出来。 「建议保留」选的是组内最居中、分辨率最高的那一张，仅作参考，勾选与否由你决定。")}</p>
          </section>
        </div>
      </div>
    </div>
  );
}
