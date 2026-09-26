import { WorkerImportPanel } from "./worker-import-panel";
import { TtsModelsPanel } from "@/components/tools/tts-models-panel";
import { useTtsComponents, ttsRequest, type TtsCatalog } from "@/lib/tts-models";
import { tr } from "@/lib/language";

import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/layout/components-manager.tsx");
import { getToolById } from "@furinakit/shared";
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Check,
  CheckCircle2,
  CloudDownload,
  Cpu,
  Download,
  FolderOpen,
  HardDrive,
  Headphones,
  Image as ImageIcon,
  Layers,
  Loader2,
  Palette,
  RefreshCw,
  Sparkles,
  Trash2,
  Wrench,
  XCircle,
} from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useTheme } from "@/components/theme-provider";
import {
  COMPONENTS,
  type ComponentCategory,
  type ComponentSpec,
  type ComponentStatus,
} from "@/lib/components-catalog";
import { cn } from "@/lib/utils";
import { takeModelFocus } from "@/lib/model-settings-navigation";

interface MergedComponentItem extends ComponentStatus {
  enName: string;
  category: ComponentCategory;
  categoryName: string;
  summary: string;
  tools: { id: string; name: string }[];
  mirrorsCount: number;
}

export function ComponentsManager() {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  const ttsCatalog = useTtsComponents();
  const ttsItems = ttsCatalog.data?.components || [];
  const { toast } = useToast();
  const [serverComponents, setServerComponents] = useState<
    Record<string, { downloaded: boolean; downloaded_bytes: number; busy?: boolean }>
  >({});
  const [modelDir, setModelDir] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [busyIds, setBusyIds] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<Record<string, string>>({});
  const [selectedCategory, setSelectedCategory] = useState<
    "all" | "image" | "audio" | "missing"
  >("all");

  const [focusedId, setFocusedId] = useState<string | null>(() => takeModelFocus());
  const scrolledTargetRef = useRef<string | null>(null);

  useEffect(() => {
    const focus = () => {
      const id = takeModelFocus();
      if (id) {
        scrolledTargetRef.current = null;
        setSelectedCategory("all");
        setFocusedId(id);
      }
    };
    window.addEventListener("furina:focus-component", focus);
    return () => window.removeEventListener("furina:focus-component", focus);
  }, []);

  useEffect(() => {
    if (!focusedId || loading) return;
    if (scrolledTargetRef.current === focusedId) return;

    const timer = setTimeout(() => {
      const card = document.getElementById(`model-${focusedId}`);
      if (card) {
        scrolledTargetRef.current = focusedId;
        card.focus({ preventScroll: true });
        card.scrollIntoView({
          block: "center",
          behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
        });
      }
    }, 220);
    return () => clearTimeout(timer);
  }, [focusedId, loading, selectedCategory]);

  // 批量下载状态
  const [isBatchDownloading, setIsBatchDownloading] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{
    current: number;
    total: number;
    currentName: string;
  } | null>(null);
  const abortBatchRef = useRef(false);

  // 刷新服务器状态
  const reload = useCallback(async () => {
    try {
      const res = await fetch("/api/components", { cache: "no-store" });
      const data = await res.json();
      if (Array.isArray(data.components)) {
        const map: Record<string, { downloaded: boolean; downloaded_bytes: number; busy?: boolean }> = {};
        for (const c of data.components) {
          map[c.id] = {
            downloaded: Boolean(c.downloaded),
            downloaded_bytes: Number(c.downloaded ? (c.downloaded_bytes || c.size || 0) : (c.downloaded_bytes || 0)),
            busy: Boolean(c.busy),
          };
        }
        setServerComponents(map);
      }
      if (typeof data.dir === "string" && data.dir) {
        setModelDir(data.dir);
      }
    } catch {
      // 保持现状
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const anyBusy = busyIds.size > 0 || isBatchDownloading || Object.values(serverComponents).some((c) => c.busy);
  useEffect(() => {
    if (!anyBusy) return;
    const timer = setInterval(() => {
      void reload();
    }, 800);
    return () => clearInterval(timer);
  }, [anyBusy, reload]);

  // 合并前端元数据与后端实时状态
  const items: MergedComponentItem[] = useMemo(() => {
    return COMPONENTS.map((spec) => {
      const live = serverComponents[spec.id];
      const downloaded = live ? live.downloaded : false;
      const downloadedSize = live ? live.downloaded_bytes : 0;
      const sizeText =
        spec.size >= 1024 ** 3
          ? `${(spec.size / 1024 ** 3).toFixed(2)} GB`
          : `${Math.round(spec.size / 1024 / 1024)} MB`;

      return {
        id: spec.id,
        name: spec.name,
        enName: spec.enName,
        category: spec.category,
        categoryName: spec.categoryName,
        summary: spec.summary,
        purpose: spec.purpose,
        file: spec.file,
        size: spec.size,
        sizeText,
        requirement: spec.requirement,
        tools: spec.tools,
        downloaded,
        downloadedSize,
        filePath: spec.file,
        mirrorsCount: spec.mirrors?.length || 1,
      };
    });
  }, [serverComponents, __locale]);

  // 统计数值
  const totalCount = items.length + ttsItems.length;
  const downloadedCount = items.filter((i) => i.downloaded).length + ttsItems.filter(i=>i.downloaded).length;
  const totalUsedBytes = ttsItems.reduce((sum,it)=>sum+(it.installedBytes||0),0) + items.reduce(
    (sum, i) => (i.downloaded ? sum + (i.downloadedSize || i.size) : sum),
    0
  );
  const missingItems = [...items.filter((i) => !i.downloaded),...ttsItems.filter(i=>!i.downloaded)];
  const missingBytes = missingItems.reduce((sum, i) => sum + i.size, 0);
  const progressPercent = totalCount > 0 ? Math.round((downloadedCount / totalCount) * 100) : 0;

  // 根据标签筛选，并按涉及工具数量降序排列（涉及工具越多的越往前放）
  const filteredItems = useMemo(() => {
    let result = items;
    if (selectedCategory === "missing") {
      result = items.filter((it) => !it.downloaded);
    } else if (selectedCategory !== "all") {
      result = items.filter((it) => selectedCategory === "image" ? it.category === "vision" || it.category === "style" : it.category === "audio");
    }
    return [...result].sort((a, b) => (b.tools?.length || 0) - (a.tools?.length || 0));
  }, [items, selectedCategory, __locale]);

  const highToolItems = useMemo(
    () => filteredItems.filter((it) => (it.tools?.length || 0) > 1),
    [filteredItems]
  );
  const singleToolItems = useMemo(
    () => filteredItems.filter((it) => (it.tools?.length || 0) <= 1),
    [filteredItems]
  );

  // 打开本地模型所在目录
  const handleOpenStorageDir = useCallback(() => {
    if (!modelDir) {
      toast({ title: __ui("目录未初始化"), variant: "info" });
      return;
    }
    if (typeof window !== "undefined" && window.furinakit?.openPath) {
      window.furinakit.openPath(modelDir).catch(() => {});
    } else {
      fetch("/api/transfer?action=open-folder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dir: modelDir }),
      }).catch(() => {});
    }
  }, [modelDir, toast]);

  // 单个组件下载或删除
  const act = async (id: string, action: "download" | "delete") => {
    setBusyIds((prev) => new Set(prev).add(id));
    const liveItem = serverComponents[id];
    const isResuming = liveItem && liveItem.downloaded_bytes > 0;
    setMessage((m) => ({
      ...m,
      [id]: action === "download" ? (isResuming ? __ui("正在从上次进度断点续传…") : __ui("正在调用 curl 高速下载…")) : __ui("正在删除模型…"),
    }));
    try {
      const res = await fetch("/api/components", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, action }),
      });
      const data = await res.json();
      setMessage((m) => ({
        ...m,
        [id]: data.message || (data.ok ? __ui("已就绪") : (data.error || __ui("操作未完成"))),
      }));
      toast({
        title: data.ok ? (action === "download" ? __ui("模型就绪") : __ui("已删除模型")) : __ui("操作失败"),
        description: data.message || data.error,
        variant: data.ok ? "success" : "error",
      });
      await reload();
      window.dispatchEvent(new CustomEvent("furina:components-changed"));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "网络超时或连接失败";
      setMessage((m) => ({ ...m, [id]: msg }));
      toast({ title: "操作异常", description: msg, variant: "error" });
    } finally {
      setBusyIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  // 一键下载全部未下载的模型
  const downloadTts = async (id:string) => {
    let state=await ttsRequest<TtsCatalog>("/api/tts/components");
    if(state.components.find(it=>it.id===id)?.downloaded)return;
    await ttsRequest("/api/tts/components",{id,action:"download"});
    for(;;){
      await new Promise(resolve=>setTimeout(resolve,1200));
      state=await ttsRequest<TtsCatalog>("/api/tts/components");
      if(abortBatchRef.current){if(state.activeId)await ttsRequest("/api/tts/components",{id:state.activeId,action:"stop"});throw new Error(tr("下载已停止","Download stopped"));}
      if(state.activeId)continue;
      if(state.components.find(it=>it.id===id)?.downloaded)return;
      throw new Error(state.operations[id]?.error||tr("组件未安装完成","Component installation did not complete"));
    }
  };
  const handleDownloadAll = async () => {
    if(ttsCatalog.isPending||ttsCatalog.error||ttsCatalog.data?.activeId||isBatchDownloading||busyIds.size>0)return;
    if(missingItems.some(it=>it.id==="tts-piper-ryan")&&!window.confirm(tr("将下载全部待安装组件。Piper Ryan 模型及数据集仅限非商业用途；如用于商业项目，请取消并分别选择其他模型。继续下载？","Download all missing components? Piper Ryan and its dataset are restricted to noncommercial use. For a commercial project, cancel and select other models individually.")))return;
    if (missingItems.length === 0) {
      toast({
        title: "所有模型均已就绪",
        description: tr("当前组件列表中没有待安装项目。", "No missing components in the current catalog."),
        variant: "success",
      });
      return;
    }

    setIsBatchDownloading(true);
    abortBatchRef.current = false;
    let completedCount = 0;

    for (let i = 0; i < missingItems.length; i++) {
      if (abortBatchRef.current) break;
      const target = missingItems[i];
      setBatchProgress({
        current: i + 1,
        total: missingItems.length,
        currentName: target.name,
      });
      setBusyIds(new Set([target.id]));
      setMessage((m) => ({ ...m, [target.id]: "批量下载中…" }));

      try {
        let data:{ok:boolean;message?:string};
        if(target.id.startsWith("tts-")){await downloadTts(target.id);data={ok:true};}
        else {
          const res = await fetch("/api/components", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({id:target.id,action:"download"})});
          data=await res.json();if(!res.ok)throw new Error(data.message||tr("下载失败","Download failed"));
        }
        if (data.ok) {
          completedCount++;
          setMessage((m) => ({ ...m, [target.id]: "下载成功" }));
        } else {
          setMessage((m) => ({ ...m, [target.id]: data.message || "下载受阻" }));
        }
        await reload();await ttsCatalog.refetch();
      } catch (e) {
        setMessage((m) => ({ ...m, [target.id]: e instanceof Error?e.message:String(e) }));
      }
    }

    setBusyIds(new Set());
    setIsBatchDownloading(false);
    setBatchProgress(null);
    await reload();await ttsCatalog.refetch();

    if (abortBatchRef.current) {
      toast({
        title: "批量下载已中断",
        description: `已完成 ${completedCount} 项，剩余项目可随时重试。`,
        variant: "info",
      });
    } else {
      toast({
        title: "批量下载完成",
        description: `成功就绪 ${completedCount} / ${missingItems.length} 款模型组件。`,
        variant: completedCount === missingItems.length ? "success" : "warning",
      });
    }
  };

  // 取消批量下载
  const handleCancelBatch = () => {
    abortBatchRef.current = true;
    toast({
      title: "正在中止",
      description: tr("正在停止下载队列；已下载的数据将保留。", "Stopping the download queue; downloaded data will be kept."),
      variant: "info",
    });
  };

  // 一键清空释放全部模型空间
  const handleClearAllDownloaded = async () => {
    if(!downloadedCount||busyIds.size>0||isBatchDownloading||ttsCatalog.data?.activeId||ttsCatalog.isPending||ttsCatalog.error)return;
    if(!window.confirm(tr("移除列表中全部已安装模型及运行库？不会删除生成的音频或其他处理结果。","Remove all installed models and runtimes in this catalog? Generated audio and other results will remain unchanged.")))return;
    setLoading(true);const failures:string[]=[];let removed=0;
    const installed=[...items.filter(i=>i.downloaded),...ttsItems.filter(i=>i.downloaded).sort((a,b)=>Number(a.kind==='runtime')-Number(b.kind==='runtime'))];
    for(const it of installed){try{
      if(it.id.startsWith('tts-'))await ttsRequest('/api/tts/components',{id:it.id,action:'delete'});
      else {const response=await fetch('/api/components',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:it.id,action:'delete'})});const data=await response.json();if(!response.ok||data.ok===false)throw new Error(data.error||data.message||tr('移除失败','Removal failed'));}
      removed++;
    }catch(e){failures.push(`${it.name}: ${e instanceof Error?e.message:String(e)}`);}}
    await reload();await ttsCatalog.refetch();
    toast({title:failures.length?tr('部分组件未移除','Some components could not be removed'):tr('组件已移除','Components removed'),description:failures.length?failures.join('; '):tr(`已移除 ${removed} 个组件；处理结果未更改。`,`${removed} components removed; generated results are unchanged.`),variant:failures.length?'warning':'success'});
  };

  // 获取分类图标与色调
  const getCategoryTheme = (cat: ComponentCategory) => {
    switch (cat) {
      case "vision":
        return {
          icon: ImageIcon,
          bgClass: "bg-sky-500/10 text-sky-500 dark:text-sky-400",
          borderClass: "border-sky-500/20",
          tagBg: "bg-sky-500/15 text-sky-500 dark:text-sky-400",
        };
      case "audio":
        return {
          icon: Headphones,
          bgClass: "bg-emerald-500/10 text-emerald-500 dark:text-emerald-400",
          borderClass: "border-emerald-500/20",
          tagBg: "bg-emerald-500/15 text-emerald-500 dark:text-emerald-400",
        };
      case "style":
        return {
          icon: Palette,
          bgClass: "bg-purple-500/10 text-purple-500 dark:text-purple-400",
          borderClass: "border-purple-500/20",
          tagBg: "bg-purple-500/15 text-purple-500 dark:text-purple-400",
        };
    }
  };

  const renderCard = (it: MergedComponentItem) => {
    const isBusy = busyIds.has(it.id) || Boolean(serverComponents[it.id]?.busy);
    const theme = getCategoryTheme(it.category);
    const CategoryIcon = theme.icon;

    return (
      <div
        key={it.id}
        id={`model-${it.id}`}
        tabIndex={-1}
        className={cn("group scroll-mt-6 rounded-3xl border p-5 transition-all hover:shadow-md hover:border-primary/40 focus:outline-none", focusedId === it.id && "ring-2 ring-primary/50 ring-offset-2 ring-offset-background")}
        style={{
          borderColor: it.downloaded ? colors.borderSolid : `${colors.borderSolid}`,
          background: colors.card,
        }}
      >
        {/* 顶部标题栏 + 状态 + 操作区 */}
        <div
          className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3.5 border-b"
          style={{ borderColor: colors.border }}
        >
          {/* 左侧：分类图标 + 模型名称 + 文件名 + 体积规格 */}
          <div className="flex items-center gap-3.5 min-w-0">
            <div
              className={cn(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border shadow-xs transition-transform group-hover:scale-105",
                theme.bgClass,
                theme.borderClass
              )}
            >
              <CategoryIcon size={20} />
            </div>

            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3
                  className="text-[14.5px] font-bold tracking-tight text-foreground truncate"
                  style={{ color: colors.text }}
                >
                  {it.name}
                </h3>

                {/* 体积胶囊 */}
                <span className="rounded-lg bg-muted/60 border border-border/50 px-2 py-0.5 font-mono text-[11px] font-bold text-foreground/80">
                  {it.sizeText}
                </span>

                {/* 推荐徽标 */}
                {it.id === "ffmpeg" && (
                  <span className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold text-amber-500 shadow-xs">
                    <Sparkles size={11} />
                    {__ui("推荐")}
                  </span>
                )}

                {/* 就绪状态徽标 */}
                {it.downloaded ? (
                  <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-bold text-emerald-500">
                    <Check size={12} strokeWidth={3} />
                    {__ui("已就绪")}</span>
                ) : (
                  <span
                    className="rounded-lg border px-2.5 py-0.5 text-[11px] font-medium"
                    style={{
                      borderColor: colors.borderSolid,
                      background: colors.bg,
                      color: colors.muted,
                    }}
                  >
                    {__ui("未安装")}</span>
                )}
              </div>
            </div>
          </div>

          {/* 右侧：操作按钮 */}
          <div className="flex items-center gap-2 self-end sm:self-center shrink-0">
            {it.downloaded ? (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8.5 px-3 text-[12px] gap-1.5 text-muted-foreground hover:text-foreground rounded-xl"
                  disabled={isBusy || isBatchDownloading || loading}
                  onClick={() => void act(it.id, "download")}
                  title={__ui("如遇文件损坏或模型升级，可强制重新拉取完整副本")}
                >
                  {isBusy ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  {__ui("重新下载")}</Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8.5 px-3 text-[12px] gap-1.5 border-rose-500/30 text-rose-500 hover:bg-rose-500/10 hover:border-rose-500/50 active:scale-95 rounded-xl"
                  disabled={isBusy || isBatchDownloading || loading}
                  onClick={() => void act(it.id, "delete")}
                  title={__ui("从本地删除此模型文件")}
                >
                  {isBusy ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
                  {__ui("删除模型")}</Button>
              </>
            ) : (
              <Button
                size="sm"
                className="h-9 px-4 text-[12.5px] font-bold gap-1.5 bg-sky-500 hover:bg-sky-400 text-white shadow-xs active:scale-95 rounded-xl"
                disabled={isBusy || isBatchDownloading || loading}
                onClick={() => void act(it.id, "download")}
              >
                {isBusy ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
                {isBusy ? __ui("正在下载…") : __ui("下载模型")}</Button>
            )}
          </div>
        </div>

        {/* 下载进度条（实时显示已下载大小与百分比） */}
        {(isBusy || (!it.downloaded && it.downloadedSize > 0 && (busyIds.has(it.id) || serverComponents[it.id]?.busy))) && (
          <div className="mt-3 rounded-2xl bg-sky-500/5 dark:bg-sky-500/10 border border-sky-500/25 p-3 space-y-1.5">
            <div className="flex items-center justify-between text-[11.5px] font-medium">
              <span className="flex items-center gap-1.5 text-sky-600 dark:text-sky-400 font-semibold">
                <Loader2 size={13} className="animate-spin text-sky-500" />
                {it.downloaded ? __ui("校验中…") : __ui("正在下载组件…")}
              </span>
              <span className="font-mono text-foreground/80 font-bold">
                {(it.downloadedSize / 1048576).toFixed(1)} MB / {(it.size / 1048576).toFixed(1)} MB ({it.size > 0 ? Math.min(100, Math.round((it.downloadedSize / it.size) * 100)) : 0}%)
              </span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted/80 border border-border/40">
              <div
                className="h-full bg-gradient-to-r from-sky-500 to-primary transition-all duration-300 ease-out rounded-full"
                style={{ width: `${Math.max(it.size > 0 ? Math.min(100, Math.round((it.downloadedSize / it.size) * 100)) : 0, 2)}%` }}
              />
            </div>
          </div>
        )}

        {/* 中间核心价值区：通俗人话实用功能 */}
        <div className="pt-3">
          <div className="flex items-center gap-2.5 text-[12.5px] leading-relaxed">
            <span className="inline-flex items-center justify-center shrink-0 rounded-md bg-sky-500/10 text-sky-500 dark:text-sky-400 px-2 py-0.5 text-[11px] font-bold">
              {__ui("实用功能")}</span>
            <span className="text-foreground/90 font-medium">
              {__ui(it.summary)}
            </span>
          </div>
        </div>

        {/* 底部信息行：关联工具胶囊 + 算力硬件说明 */}
        <div
          className="mt-3.5 pt-3 border-t flex flex-col items-start gap-3"
          style={{ borderColor: colors.border }}
        >
          {/* 涉及工具列表（真实工具名，完整换行） */}
          <div className="flex flex-wrap items-start gap-1.5 min-w-0 w-full">
            <span className="text-[11.5px] font-semibold text-muted-foreground shrink-0 flex items-center gap-1">
              <Wrench size={11} /> {__ui("涉及工具：")}</span>
            <div className="flex flex-wrap items-center gap-1.5 min-w-0 flex-1 py-0.5" style={{ flexShrink: 1 }}>
              {it.tools.filter((tool, index, list) => getToolById(tool.id) && list.findIndex(other=>other.id===tool.id)===index).map((tool) => (
                <span
                  key={tool.id}
                  className="inline-flex shrink-0 items-center gap-1 rounded-lg border px-2.5 py-0.5 text-[11px] font-medium"
                  style={{
                    borderColor: colors.borderSolid,
                    background: colors.bg,
                    color: colors.text,
                  }}
                >
                  <Layers size={10} className="text-sky-400" />
                  <span>{getToolById(tool.id)?.name ?? tool.name}</span>
                </span>
              ))}
            </div>
          </div>

          {/* 算力要求 */}
          {it.requirement && (
            <div className="flex items-center gap-1 text-[11.5px] text-amber-500/90 font-medium min-w-0">
              <Cpu size={12} className="shrink-0 text-amber-500" />
              <span className="break-words leading-relaxed">{__ui("算力：")}{__msg(it.requirement)}</span>
            </div>
          )}
        </div>

        {/* 动态执行消息 */}
        {message[it.id] && (
          <div
            className="mt-2.5 flex items-center gap-1.5 text-[11.5px] font-medium rounded-xl border px-3 py-1.5"
            style={{
              borderColor: it.downloaded ? "#10b98140" : colors.borderSolid,
              background: it.downloaded ? "#10b98110" : colors.bg,
              color: it.downloaded ? "#10b981" : colors.muted,
            }}
          >
            <AlertCircle size={12} />
            <span>{__msg(message[it.id])}</span>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="grid grid-cols-[100px_minmax(0,1fr)] items-start gap-4 lg:grid-cols-[120px_minmax(0,1fr)] lg:gap-5">
      <nav aria-label={__ui("模型组件分类")} className="sticky top-0 space-y-1.5 rounded-2xl border border-border bg-card/70 p-2">
        <p className="px-2 pb-2 pt-1 text-[11px] font-semibold tracking-wider text-muted-foreground">{__ui("组件分类")}</p>
        {([{id:"all",name:"全部",icon:Layers,count:items.length+ttsItems.length},{id:"image",name:"图片",icon:ImageIcon,count:items.filter(it=>it.category==="vision"||it.category==="style").length},{id:"audio",name:"音频",icon:Headphones,count:items.filter(it=>it.category==="audio").length+ttsItems.length},{id:"missing",name:"待下载",icon:CloudDownload,count:missingItems.length}] as const).map(tab=><button key={tab.id} type="button" aria-pressed={selectedCategory===tab.id} onClick={()=>setSelectedCategory(tab.id)} className={cn("flex w-full flex-wrap items-center gap-x-1.5 gap-y-1 rounded-xl px-2 py-3 text-left text-[13px] font-medium transition-colors",selectedCategory===tab.id?"bg-primary/10 text-primary":"text-muted-foreground hover:bg-muted hover:text-foreground")}><tab.icon size={16} className="shrink-0"/><span>{__ui(tab.name)}</span><span className="ml-auto text-[11px] tabular-nums opacity-70">{tab.count}</span></button>)}
      </nav>
      <div className="min-w-0 space-y-5">
      {/* ── 顶部微看板与操作区 ────────────────────────────────────────── */}
      <div
        className="rounded-3xl border p-6 transition-all shadow-xs"
        style={{ background: colors.card, borderColor: colors.borderSolid }}
      >
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          {/* 左侧：标题与指标看板 */}
          <div className="space-y-3 flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-xl bg-sky-500/15 text-sky-500 dark:text-sky-400">
                <HardDrive size={16} />
              </span>
              <h2 className="font-bold text-[16px] tracking-tight" style={{ color: colors.text }}>
                {tr("模型与运行组件", "Models and runtimes")}</h2>
              <span className="rounded-full bg-muted/60 border border-border/50 px-2.5 py-0.5 text-[11px] font-mono font-semibold text-foreground/80">
                {downloadedCount} / {totalCount} {__ui("款已就绪")}</span>
              {downloadedCount === totalCount && (
                <span className="flex items-center gap-1 text-[12px] font-bold text-emerald-500">
                  <CheckCircle2 size={14} />
                  {tr("当前批量列表已安装", "Current batch list is installed")}</span>
              )}
            </div>

            {/* 3 项核心指标网格 */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              {/* 指标 1：就绪率 */}
              <div
                className="rounded-2xl border p-3"
                style={{ borderColor: colors.borderSolid, background: colors.bg }}
              >
                <div className="text-[11px] text-muted-foreground font-medium">{tr("批量列表就绪率", "Batch-list readiness")}</div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="text-[18px] font-bold font-mono text-foreground">
                    {progressPercent}%
                  </span>
                  <span className="text-[11px] text-muted-foreground">
                    ({downloadedCount}/{totalCount})
                  </span>
                </div>
                <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-border/40">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${progressPercent}%`,
                      background: progressPercent === 100 ? "#10b981" : "#38bdf8",
                    }}
                  />
                </div>
              </div>

              {/* 指标 2：磁盘占用 */}
              <div
                className="rounded-2xl border p-3"
                style={{ borderColor: colors.borderSolid, background: colors.bg }}
              >
                <div className="text-[11px] text-muted-foreground font-medium">{__ui("本机已占空间")}</div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="text-[18px] font-bold font-mono text-foreground">
                    {(totalUsedBytes / 1024 / 1024).toFixed(1)}
                  </span>
                  <span className="text-[11px] text-muted-foreground font-mono">MB</span>
                </div>
                <div className="mt-1 text-[10.5px] text-muted-foreground truncate">
                  {missingItems.length > 0 ? (
                    <span>
                      {__ui("待下载约")}{" "}
                      <strong className="text-amber-500 font-mono">
                        {(missingBytes / 1024 / 1024).toFixed(0)} MB
                      </strong>
                    </span>
                  ) : (
                    <span className="text-emerald-500">{tr("当前列表中的组件均已安装", "All listed components are installed")}</span>
                  )}
                </div>
              </div>

              {/* 指标 3：存储目录 */}
              <div
                className="rounded-2xl border p-3 flex flex-col justify-between"
                style={{ borderColor: colors.borderSolid, background: colors.bg }}
              >
                <div className="text-[11px] text-muted-foreground font-medium">{__ui("模型权重存储目录")}</div>
                <div
                  className="mt-1 font-mono text-[11px] text-foreground/80 truncate select-all"
                  title={modelDir || __ui("本地模型目录")}
                >
                  {modelDir ? modelDir.split(/[\\/]/).slice(-2).join("/") : "~/.furinakit/models"}
                </div>
                <button
                  type="button"
                  onClick={handleOpenStorageDir}
                  className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-sky-500 hover:text-sky-400 hover:underline cursor-pointer"
                >
                  <FolderOpen size={11} />
                  <span>{__ui("打开目录")}</span>
                </button>
              </div>
            </div>
          </div>

          {/* 右侧：全局操作按钮组 */}
          <div className="flex flex-col sm:flex-row lg:flex-col gap-2.5 shrink-0 self-start lg:self-center">
            {isBatchDownloading ? (
              <Button
                size="sm"
                variant="outline"
                className="h-10 px-4 gap-2 border-rose-500/40 text-rose-500 hover:bg-rose-500/10 font-bold active:scale-95 shadow-xs rounded-xl"
                onClick={handleCancelBatch}
              >
                <XCircle size={15} />
                {__ui("停止批量下载")}</Button>
            ) : (
              <Button
                size="sm"
                className={cn(
                  "h-10 px-5 gap-2 font-bold shadow-xs transition-all active:scale-95 rounded-xl",
                  downloadedCount === totalCount
                    ? "bg-emerald-500/15 border border-emerald-500/30 text-emerald-500 hover:bg-emerald-500/20 shadow-none"
                    : "bg-sky-500 hover:bg-sky-400 text-white shadow-sky-500/20"
                )}
                disabled={loading || downloadedCount === totalCount || ttsCatalog.isPending || !!ttsCatalog.error || !!ttsCatalog.data?.activeId || busyIds.size > 0}
                onClick={() => void handleDownloadAll()}
              >
                {downloadedCount === totalCount ? (
                  <>
                    <Check size={15} strokeWidth={3} />
                    {__ui("所有模型均已就绪")}</>
                ) : (
                  <>
                    <CloudDownload size={16} />
                    {tr("下载全部待安装组件 (", "Download all missing (")}{missingItems.length} {__ui("款 ·")}{(missingBytes / 1024 / 1024).toFixed(0)} MB)
                  </>
                )}
              </Button>
            )}

            <div className="flex items-center gap-2">
              {downloadedCount > 0 && !isBatchDownloading && (
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 h-9 gap-1.5 text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 text-[12px] rounded-xl"
                  onClick={() => void handleClearAllDownloaded()}
                  disabled={busyIds.size > 0 || loading || ttsCatalog.isPending || !!ttsCatalog.error || !!ttsCatalog.data?.activeId}
                  title={tr("移除全部已安装模型与运行库，保留处理结果", "Remove all installed models and runtimes, keeping generated results")}
                >
                  <Trash2 size={13} />
                  {tr("移除全部组件", "Remove all components")}</Button>
              )}

              <Button
                size="sm"
                variant="outline"
                className="flex-1 h-9 gap-1.5 text-muted-foreground hover:text-foreground text-[12px] rounded-xl"
                onClick={() => {void reload();void ttsCatalog.refetch();}}
                disabled={loading || isBatchDownloading}
              >
                {loading ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                {__ui("刷新状态")}</Button>
            </div>
          </div>
        </div>

        {/* 批量下载实时进度条 */}
        {isBatchDownloading && batchProgress && (
          <div className="mt-4 flex items-center justify-between rounded-2xl border border-sky-500/30 bg-sky-500/10 px-4 py-2.5 text-[12.5px] text-sky-400 shadow-xs">
            <div className="flex items-center gap-2.5 min-w-0">
              <Loader2 size={16} className="animate-spin shrink-0 text-sky-400" />
              <span className="truncate">
                {__ui("正在批量同步第")}<strong>{batchProgress.current}</strong> / {batchProgress.total} {__ui("款：")}<span className="font-bold text-foreground ml-1">{__msg(batchProgress.currentName)}</span>
              </span>
            </div>
            <span className="shrink-0 font-mono text-[12px] font-bold">
              {Math.round((batchProgress.current / batchProgress.total) * 100)}%
            </span>
          </div>
        )}
      </div>

      <p className="text-sm text-muted-foreground">{selectedCategory==="image"?__ui("图片 · 超分、消除与上色"):selectedCategory==="audio"?tr("音频 · 识别、分离与合成", "Audio · Recognition, separation and speech"):selectedCategory==="missing"?__ui("待下载组件"):__ui("全部模型与组件")}<span className="ml-2">· {filteredItems.length + (selectedCategory === "image" ? 0 : ttsItems.filter(it => selectedCategory !== "missing" || !it.downloaded).length)} {__ui("款")}</span></p>


      {/* ── 组件卡片列表（排版舒展、呼吸感充足、层次分明） ──────────────── */}
      <div className="space-y-3.5">
        
        {highToolItems.map(renderCard)}
        {selectedCategory !== "image" && <TtsModelsPanel list missingOnly={selectedCategory === "missing"} focusedId={focusedId} externalBusy={isBatchDownloading}/>}
        {singleToolItems.map(renderCard)}
      </div>
      <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{tr("开发验证工具", "Developer verification tools")}</summary><WorkerImportPanel /></details>
      </div>
    </div>
  );
}
