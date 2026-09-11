"use client";

import React, { useState, useEffect, useTransition } from "react";
import {
  BarChart3,
  Monitor,
  Calendar,
  Flame,
  ShieldCheck,
  AlertTriangle,
  ExternalLink,
  RefreshCw,
  X,
  Layers,
  Sparkles,
  Award,
} from "lucide-react";
import {
  getAppTelemetry,
  fetchRemoteStats,
  AppTelemetryData,
} from "@/lib/analytics";
import { TOOLS, type OmniTool } from "@furinakit/shared";
import { APP_VERSION, APP_NAME } from "@/lib/version";


interface StatsModalProps {
  open: boolean;
  onClose: () => void;
}

export function StatsModal({ open, onClose }: StatsModalProps) {
  const [telemetry, setTelemetry] = useState<AppTelemetryData | null>(null);
  const [remoteStats, setRemoteStats] = useState<{ installs: number | null; launches: number | null }>({
    installs: null,
    launches: null,
  });
  const [isLoading, startTransition] = useTransition();

  const loadData = () => {
    startTransition(async () => {
      const local = getAppTelemetry();
      setTelemetry(local);
      const remote = await fetchRemoteStats();
      setRemoteStats(remote);
    });
  };

  useEffect(() => {
    if (open) {
      loadData();
    }
  }, [open]);

  if (!open || !telemetry) return null;

  // 排序工具使用量
  const toolNameMap = new Map<string, string>(TOOLS.map((t: OmniTool) => [t.id.toLowerCase(), t.name]));
  const sortedUsage = Object.entries(telemetry.toolUsage)
    .map(([id, info]) => {
      const toolName: string = toolNameMap.get(id) || id;
      return {
        id,
        name: toolName,
        count: info.count,
        lastUsed: info.lastUsed,
      };
    })
    .sort((a, b) => b.count - a.count);


  const topTools = sortedUsage.slice(0, 8);
  const maxCount = topTools.length > 0 ? topTools[0].count : 1;

  // 错误列表
  const errorEntries = Object.entries(telemetry.toolErrors);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <div
        className="relative flex max-h-[85vh] w-[720px] max-w-[95vw] flex-col rounded-2xl border border-primary/20 bg-background/95 shadow-2xl backdrop-blur-md dark:border-primary/30"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 顶部标题栏 */}
        <div className="flex items-center justify-between border-b border-border/60 px-6 py-4">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <BarChart3 size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-[16px] font-bold text-foreground">
                  数据洞察与后台统计看板
                </h2>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                  芙芙观测台
                </span>
              </div>
              <p className="text-[12px] text-muted-foreground">
                全量使用频次、设备环境特征与匿名诊断监控
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={loadData}
              disabled={isLoading}
              title="刷新数据"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <RefreshCw size={15} className={isLoading ? "animate-spin" : ""} />
            </button>
            <button
              onClick={onClose}
              className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* 滚动内容区 */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          {/* 四格核心数据卡片 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-xl border border-border/60 bg-card/60 p-3.5 shadow-xs">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-[11px] font-medium">累计安装总量</span>
                <Flame size={14} className="text-amber-500" />
              </div>
              <div className="mt-1.5 flex items-baseline gap-1">
                <span className="text-[20px] font-extrabold text-foreground font-mono">
                  {remoteStats.installs !== null ? remoteStats.installs.toLocaleString() : "--"}
                </span>
                <span className="text-[10px] text-muted-foreground">人次</span>
              </div>
              <p className="mt-0.5 text-[10px] text-muted-foreground">全球独立设备</p>
            </div>

            <div className="rounded-xl border border-border/60 bg-card/60 p-3.5 shadow-xs">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-[11px] font-medium">软件启动次数</span>
                <Sparkles size={14} className="text-primary" />
              </div>
              <div className="mt-1.5 flex items-baseline gap-1">
                <span className="text-[20px] font-extrabold text-foreground font-mono">
                  {telemetry.launchCount}
                </span>
                <span className="text-[10px] text-muted-foreground">次</span>
              </div>
              <p className="mt-0.5 text-[10px] text-muted-foreground">活跃使用会话</p>
            </div>

            <div className="rounded-xl border border-border/60 bg-card/60 p-3.5 shadow-xs">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-[11px] font-medium">累计使用天数</span>
                <Calendar size={14} className="text-emerald-500" />
              </div>
              <div className="mt-1.5 flex items-baseline gap-1">
                <span className="text-[20px] font-extrabold text-foreground font-mono">
                  {telemetry.activeDaysCount}
                </span>
                <span className="text-[10px] text-muted-foreground">天</span>
              </div>
              <p className="mt-0.5 text-[10px] text-muted-foreground">长效陪伴周期</p>
            </div>

            <div className="rounded-xl border border-border/60 bg-card/60 p-3.5 shadow-xs">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-[11px] font-medium">工具调用总数</span>
                <Layers size={14} className="text-sky-500" />
              </div>
              <div className="mt-1.5 flex items-baseline gap-1">
                <span className="text-[20px] font-extrabold text-foreground font-mono">
                  {telemetry.totalToolUses}
                </span>
                <span className="text-[10px] text-muted-foreground">次</span>
              </div>
              <p className="mt-0.5 text-[10px] text-muted-foreground">累计高效产出</p>
            </div>
          </div>

          {/* 工具使用排行榜 */}
          <div className="rounded-2xl border border-border/60 bg-card/50 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Award size={16} className="text-amber-500" />
                <h3 className="text-[13px] font-semibold text-foreground">
                  工具热度排行榜（按使用频次）
                </h3>
              </div>
              <span className="text-[11px] text-muted-foreground">
                已使用 {sortedUsage.length} 款不同工具
              </span>
            </div>

            {topTools.length === 0 ? (
              <div className="py-6 text-center text-[12px] text-muted-foreground">
                尚未记录工具调用，快去主页体验各项实用功能吧~
              </div>
            ) : (
              <div className="space-y-2.5">
                {topTools.map((t, idx) => {
                  const percent = Math.min(100, Math.round((t.count / maxCount) * 100));
                  return (
                    <div key={t.id} className="group flex items-center gap-3 text-[12px]">
                      <span className="w-5 font-mono text-[11px] font-bold text-muted-foreground group-hover:text-primary">
                        #{idx + 1}
                      </span>
                      <span className="w-28 truncate font-medium text-foreground" title={t.name}>
                        {t.name}
                      </span>
                      <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                        <div
                          className="h-full rounded-full bg-gradient-to-r from-primary/80 to-primary transition-all duration-500"
                          style={{ width: `${percent}%` }}
                        />
                      </div>
                      <span className="w-12 text-right font-mono font-semibold text-foreground">
                        {t.count} 次
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 设备与运行环境卡片 */}
          <div className="rounded-2xl border border-border/60 bg-card/50 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Monitor size={16} className="text-sky-500" />
              <h3 className="text-[13px] font-semibold text-foreground">
                设备与运行环境分布
              </h3>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[12px]">
              <div className="rounded-lg bg-background/60 p-2.5 border border-border/40">
                <span className="text-[10px] text-muted-foreground block">操作系统</span>
                <span className="font-semibold text-foreground mt-0.5 block truncate">
                  {telemetry.system.os}
                </span>
              </div>
              <div className="rounded-lg bg-background/60 p-2.5 border border-border/40">
                <span className="text-[10px] text-muted-foreground block">主屏分辨率</span>
                <span className="font-semibold text-foreground mt-0.5 block truncate">
                  {telemetry.system.screenResolution} ({telemetry.system.devicePixelRatio}x)
                </span>
              </div>
              <div className="rounded-lg bg-background/60 p-2.5 border border-border/40">
                <span className="text-[10px] text-muted-foreground block">系统语言</span>
                <span className="font-semibold text-foreground mt-0.5 block truncate">
                  {telemetry.system.language}
                </span>
              </div>
              <div className="rounded-lg bg-background/60 p-2.5 border border-border/40">
                <span className="text-[10px] text-muted-foreground block">运行环境</span>
                <span className="font-semibold text-foreground mt-0.5 block truncate">
                  {telemetry.system.isElectron ? "桌面原生客户端" : "Web 浏览器"}
                </span>
              </div>
            </div>
          </div>

          {/* 工具运行健康状况 */}
          <div className="rounded-2xl border border-border/60 bg-card/50 p-4">
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck size={16} className="text-emerald-500" />
              <h3 className="text-[13px] font-semibold text-foreground">
                工具运行健康度与自检
              </h3>
            </div>
            {errorEntries.length === 0 ? (
              <div className="flex items-center gap-2 rounded-xl bg-emerald-500/10 border border-emerald-500/20 px-3.5 py-2.5 text-[12px] text-emerald-600 dark:text-emerald-400">
                <ShieldCheck size={16} />
                <span>全工具运行状况良好，无崩溃或格式处理异常记录。</span>
              </div>
            ) : (
              <div className="space-y-1.5">
                {errorEntries.map(([id, err]) => (
                  <div
                    key={id}
                    className="flex items-center justify-between rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-[11px]"
                  >
                    <div className="flex items-center gap-2 truncate">
                      <AlertTriangle size={13} className="text-amber-500 shrink-0" />
                      <span className="font-bold text-amber-700 dark:text-amber-300">
                        {id}
                      </span>
                      <span className="text-muted-foreground truncate max-w-[280px]">
                        {err.lastError}
                      </span>
                    </div>
                    <span className="font-mono text-amber-600 dark:text-amber-400 shrink-0">
                      报错 {err.count} 次
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 全球用户建议箱入口 */}
          <div className="flex items-center justify-between rounded-2xl border border-primary/30 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent p-4">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles size={15} className="text-primary" />
                <h4 className="text-[13px] font-bold text-foreground">
                  全球用户建议与心愿箱 · 实时云端看板
                </h4>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                全球用户提出的新工具心愿、改进反馈已自动汇聚在专用通道，支持手机端与浏览器即时接收。
              </p>
            </div>
            <a
              href="https://ntfy.sh/furinakit_feedback_hq"
              target="_blank"
              rel="noreferrer"
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl bg-primary px-3.5 text-[12px] font-semibold text-primary-foreground shadow-sm hover:opacity-90 transition-opacity"
            >
              <span>打开建议箱</span>
              <ExternalLink size={13} />
            </a>
          </div>
        </div>

        {/* 底部 */}
        <div className="flex items-center justify-between border-t border-border/60 px-6 py-3.5 bg-muted/20">
          <div className="text-[11px] text-muted-foreground">
            {APP_NAME} v{APP_VERSION} · 尊重隐私，所有文件均在本地离线处理
          </div>
          <button
            onClick={onClose}
            className="h-8 rounded-lg bg-primary px-4 text-[12px] font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
          >
            关闭看板
          </button>
        </div>
      </div>
    </div>
  );
}
