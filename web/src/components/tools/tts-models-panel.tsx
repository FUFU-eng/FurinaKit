"use client";
import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Download, Loader2, RefreshCw, Trash2, Square, Headphones, Check, Wrench, Layers, Cpu } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { tr, uiMessage, useLanguage } from "@/lib/language";
import { ttsRequest, TTS_QUERY_KEY, useTtsComponents } from "@/lib/tts-models";

export function TtsModelsPanel({
  compact = false,
  missingOnly = false,
  focusedId,
  list = false,
  externalBusy = false,
}: {
  compact?: boolean;
  missingOnly?: boolean;
  focusedId?: string | null;
  list?: boolean;
  externalBusy?: boolean;
}) {
  useLanguage();
  const query = useTtsComponents();
  const client = useQueryClient();
  const [error, setError] = useState("");
  const [submittingIds, setSubmittingIds] = useState<Set<string>>(new Set());
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const data = query.data;

  // 跟踪所有当前活跃的下载 ID
  const activeIds = useMemo(() => {
    const ids = new Set<string>();
    if (Array.isArray(data?.activeIds)) {
      data.activeIds.forEach((id) => ids.add(id));
    }
    if (data?.activeId) {
      ids.add(data.activeId);
    }
    return ids;
  }, [data?.activeIds, data?.activeId]);

  async function act(id: string, action: "download" | "delete" | "stop") {
    if (submittingIds.has(id)) return;
    setSubmittingIds((prev) => new Set(prev).add(id));
    setError("");
    setConfirmId(null);
    try {
      await ttsRequest("/api/tts/components", { id, action });
      await client.invalidateQueries({ queryKey: TTS_QUERY_KEY });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmittingIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  }

  const items = data?.components.filter((item) => !missingOnly || !item.downloaded) || [];

  return (
    <section
      id="model-tts-models"
      tabIndex={-1}
      className={list ? "contents" : "min-w-0 rounded-2xl border border-border bg-card p-4 sm:p-5"}
    >
      {!list && (
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="text-sm font-semibold">{tr("本地语音 · 按需下载", "Offline speech · On-demand downloads")}</h3>
            <p className="mt-2 text-xs leading-6 text-muted-foreground">
              {tr("选择适用的语音模型后安装。模型共用一个 CPU 运行库，安装模型时会自动补齐该依赖。", "Install a speech model for your language. Models share a CPU runtime, included automatically with the first model installation.")}
            </p>
            <p className="text-xs leading-6 text-muted-foreground">
              {tr("Kokoro 支持中英双语和 103 个说话人；两个 Piper 模型仅支持英语。安装后按文件完整性显示状态，推理前再次校验哈希。", "Kokoro supports Chinese, English and 103 speakers. Both Piper models are English-only. Installed status checks package files; hashes are checked again before inference.")}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={query.isFetching}
            onClick={() => void query.refetch()}
          >
            <RefreshCw size={14} />
            {tr("刷新", "Refresh")}
          </Button>
        </div>
      )}

      {(error || query.error) && (
        <p role="alert" className="mt-3 break-words text-xs text-destructive">
          {uiMessage(error || query.error?.message || "")}
        </p>
      )}

      {query.isPending && (
        <p className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 size={14} className="animate-spin" />
          {tr("读取组件状态…", "Reading component status…")}
        </p>
      )}

      <div className={list ? "contents" : `mt-4 grid gap-3 ${compact ? "" : "xl:grid-cols-2"}`}>
        {items.map((item) => {
          const operation = data?.operations[item.id];
          const isSubmitting = submittingIds.has(item.id);
          const isThisActive = activeIds.has(item.id) || isSubmitting;
          const itemProgress =
            item.progress ||
            (data?.progress?.id === item.id ? data.progress : data?.progressMap?.[item.id]);

          const stage = itemProgress?.status || (isThisActive ? "downloading" : "");
          const stageText =
            stage === "verifying"
              ? tr("校验 SHA-256…", "Verifying SHA-256…")
              : stage === "extracting"
              ? tr("安全解压并安装…", "Extracting and installing…")
              : stage === "downloading"
              ? tr("正在下载组件…", "Downloading component…")
              : tr("正在准备组件…", "Preparing component…");

          const totalBytes = itemProgress?.total || item.size;
          const receivedBytes = itemProgress?.received || 0;
          const percent =
            totalBytes > 0
              ? Math.min(100, Math.round((receivedBytes / totalBytes) * 100))
              : isThisActive
              ? 5
              : 0;

          return (
            <article
              key={item.id}
              id={`model-${item.id}`}
              tabIndex={-1}
              className={`min-w-0 border bg-card ${
                list
                  ? "mb-3.5 scroll-mt-6 rounded-3xl p-5 transition-shadow hover:shadow-md"
                  : "rounded-xl p-4"
              } ${
                focusedId === item.id
                  ? "border-primary ring-2 ring-primary/15"
                  : "border-border"
              }`}
            >
              <div
                className={
                  list
                    ? "flex flex-col justify-between gap-3 border-b border-border pb-3.5 sm:flex-row sm:items-center"
                    : "space-y-2"
                }
              >
                <div className="flex min-w-0 items-center gap-3.5">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl border border-emerald-500/20 bg-emerald-500/10 text-emerald-500 shadow-xs">
                    {item.kind === "runtime" ? <Cpu size={20} /> : <Headphones size={20} />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="break-words text-[14.5px] font-bold tracking-tight text-foreground">
                        {item.name}
                      </h3>
                      <span className="rounded-lg border border-border/50 bg-muted/60 px-2 py-0.5 font-mono text-[11px] font-bold text-foreground/80">
                        {(item.size / 1048576).toFixed(1)} MiB
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-lg border px-2.5 py-0.5 text-[11px] ${
                          item.downloaded
                            ? "border-emerald-500/30 bg-emerald-500/10 font-bold text-emerald-500"
                            : "border-border bg-background text-muted-foreground"
                        }`}
                      >
                        {item.downloaded && <Check size={12} strokeWidth={3} />}
                        {item.downloaded ? tr("已就绪", "Ready") : tr("未安装", "Not installed")}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2 self-end sm:self-center">
                  <Button
                    type="button"
                    size="sm"
                    variant={item.downloaded ? "outline" : "default"}
                    className={
                      item.downloaded
                        ? "h-9 gap-1.5 rounded-xl px-3 text-xs disabled:opacity-50"
                        : "h-9 gap-1.5 rounded-xl bg-sky-500 px-4 text-xs font-bold text-white hover:bg-sky-400 disabled:opacity-50"
                    }
                    disabled={isThisActive || externalBusy}
                    onClick={() => void act(item.id, "download")}
                  >
                    {isThisActive ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : item.downloaded ? (
                      <RefreshCw size={12} />
                    ) : (
                      <Download size={14} />
                    )}
                    {isThisActive
                      ? tr("正在下载…", "Downloading…")
                      : item.downloaded
                      ? tr("校验 / 修复", "Verify / Repair")
                      : item.kind === "runtime"
                      ? tr("下载运行库", "Download runtime")
                      : tr("下载模型", "Download model")}
                  </Button>
                  {item.downloaded && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-9 gap-1.5 rounded-xl border-rose-500/30 px-3 text-xs text-rose-500 hover:bg-rose-500/10"
                      disabled={isThisActive || externalBusy}
                      onClick={() => setConfirmId(item.id)}
                    >
                      <Trash2 size={12} />
                      {tr("删除模型", "Delete model")}
                    </Button>
                  )}
                </div>
              </div>

              {/* 下载进度条（实时显示已下载大小与百分比，优雅软圆角质感，每组件独立展示） */}
              {isThisActive && (
                <div className="mt-3.5 rounded-2xl bg-sky-500/5 dark:bg-sky-500/10 border border-sky-500/25 p-3.5 space-y-2">
                  <div className="flex items-center justify-between text-[11.5px] font-medium">
                    <span className="flex items-center gap-1.5 text-sky-600 dark:text-sky-400 font-semibold">
                      <Loader2 size={13} className="animate-spin text-sky-500 shrink-0" />
                      <span>{stageText}</span>
                    </span>
                    <div className="flex items-center gap-2.5">
                      <span className="font-mono text-foreground/80 font-bold">
                        {(receivedBytes / 1048576).toFixed(1)} MB / {(totalBytes / 1048576).toFixed(1)} MB ({percent}%)
                      </span>
                      <button
                        type="button"
                        onClick={() => void act(item.id, "stop")}
                        className="inline-flex items-center gap-1 rounded-lg border border-border/60 bg-background/80 px-2 py-0.5 text-[11px] text-muted-foreground hover:text-rose-500 hover:border-rose-500/30 hover:bg-rose-500/10 transition-colors shadow-2xs"
                        title={tr("停止并保留断点", "Stop and keep partial files")}
                      >
                        <Square size={10} />
                        <span>{tr("停止", "Stop")}</span>
                      </button>
                    </div>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-muted/80 border border-border/40">
                    <div
                      className="h-full bg-gradient-to-r from-sky-500 to-primary transition-all duration-300 ease-out rounded-full"
                      style={{ width: `${Math.max(percent, 2)}%` }}
                    />
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2.5 pt-3 text-[12.5px] leading-relaxed">
                <span className="shrink-0 rounded-md bg-sky-500/10 px-2 py-0.5 text-[11px] font-bold text-sky-500">
                  {tr("实用功能", "Use case")}
                </span>
                <span className="font-medium text-foreground/90">
                  {item.kind === "runtime"
                    ? tr("为本地语音模型提供共享离线推理环境", "Shared offline inference runtime for speech models")
                    : item.family === "kokoro"
                    ? tr("中英双语语音合成 · 103 个说话人", "Chinese and English speech synthesis · 103 speakers")
                    : tr("英文语音合成 · 单说话人", "English speech synthesis · One speaker")}
                </span>
              </div>
              <div className="mt-3.5 space-y-3 border-t border-border pt-3">
                <div className="flex flex-wrap items-center gap-2 text-[11.5px]">
                  <span className="flex items-center gap-1 font-semibold text-muted-foreground">
                    <Wrench size={11} />
                    {tr("涉及工具：", "Tools:")}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-0.5 font-medium">
                    <Layers size={10} className="text-sky-400" />
                    {tr("文字转语音", "Text to speech")}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-[11.5px] font-medium text-amber-500">
                  <Cpu size={12} />
                  {tr("算力：CPU · Windows x64 · 无需独立显卡", "Compute: CPU · Windows x64 · No dedicated GPU required")}
                </div>
              </div>
              {!item.downloaded && item.kind === "model" && !data?.components.find((x) => x.id === "tts-sherpa-runtime")?.downloaded && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {tr("首次另需共享运行库 23.7 MiB；下载后磁盘占用高于压缩包大小。", "First install also needs the 23.7 MiB shared runtime. Installed files use more disk space than the archive.")}
                </p>
              )}
              <p className={`mt-2 text-xs leading-5 ${item.id === "tts-piper-ryan" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                {tr(item.licenseNoteZh, item.licenseNoteEn)}
              </p>
              {confirmId === item.id && (
                <div className="mt-3 rounded-lg border border-destructive/30 p-3 text-xs">
                  <p>
                    {tr(
                      "只删除此组件的受管文件，不删除音频结果。共享运行库须先移除依赖模型。确认继续？",
                      "Remove only this managed component, not your audio results. Remove dependent models before the shared runtime. Continue?"
                    )}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button type="button" size="sm" disabled={isThisActive || externalBusy} onClick={() => void act(item.id, "delete")}>
                      {tr("确认删除", "Confirm removal")}
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => setConfirmId(null)}>
                      {tr("取消", "Cancel")}
                    </Button>
                  </div>
                </div>
              )}
              {(item.error || operation?.error) && (
                <p role="alert" className="mt-2 break-words text-xs text-destructive">
                  {uiMessage(item.error || operation?.error || "")}
                </p>
              )}
              <details className="mt-3 text-xs text-muted-foreground">
                <summary className="cursor-pointer">{tr("来源、校验与许可", "Source, checksum and license")}</summary>
                <p className="mt-2 leading-5">
                  {tr("保留上游全部 LICENSE / NOTICE。运行库许可不替代模型及数据集的条款，商用前请阅读模型卡。", "All upstream LICENSE / NOTICE files are retained. Runtime terms do not replace model or dataset terms; read the model card before commercial use.")}
                </p>
                <p className="mt-2 break-all">{item.licenseUrl}</p>
                <p className="mt-2 break-all">{item.url}</p>
                <p className="mt-2 break-all font-mono">SHA-256: {item.sha256}</p>
              </details>
            </article>
          );
        })}
      </div>
      {!list && data && !items.length && (
        <p className="mt-3 text-xs text-muted-foreground">{tr("本地语音组件已全部安装。", "All offline speech components are installed.")}</p>
      )}
    </section>
  );
}

