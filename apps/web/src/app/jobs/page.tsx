"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ArrowLeft, Download, RotateCw, Loader2, CheckCircle2, XCircle } from "lucide-react";
import type { Job } from "@furinakit/shared";
import { getToolById } from "@furinakit/shared";
import { Badge, Card } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/utils";
import { useTheme } from "@/components/theme-provider";

type JobsResponse = { jobs: Job[]; disabled?: boolean };

const STATUS_LABEL: Record<string, string> = {
  pending: "排队中",
  processing: "处理中",
  completed: "已完成",
  failed: "失败",
};

const ACTIVE_STATUSES = ["pending", "processing"];
const DONE_STATUSES = ["completed", "failed"];

async function fetchJobs(): Promise<JobsResponse> {
  const response = await fetch("/api/jobs", { cache: "no-store" });
  if (!response.ok) throw new Error("加载任务失败");
  return response.json();
}

export default function JobsPage() {
  const [tab, setTab] = useState<"active" | "done">("active");
  const { colors } = useTheme();
  const { data, isLoading, error, isFetching, refetch } = useQuery({
    queryKey: ["jobs"],
    queryFn: fetchJobs,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
    retry: 1,
    staleTime: 3000,
  });
  const { toast } = useToast();

  const jobs = data?.jobs ?? [];
  const disabled = data?.disabled;

  const activeJobs = jobs.filter((j) => ACTIVE_STATUSES.includes(j.status));
  const doneJobs = jobs.filter((j) => DONE_STATUSES.includes(j.status));
  const displayJobs = tab === "active" ? activeJobs : doneJobs;

  const download = async (e: React.MouseEvent, job: Job) => {
    e.preventDefault();
    if (!job.resultFilename) return;
    try {
      const res = await fetch(`/api/jobs/${job.id}/download`);
      if (!res.ok) throw new Error("下载失败");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = job.resultFilename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (err) {
      toast({ title: "下载失败", description: err instanceof Error ? err.message : "请重试", variant: "error" });
    }
  };

  const tabs = [
    { key: "active" as const, label: "进行中", count: activeJobs.length, icon: Loader2 },
    { key: "done" as const, label: "已完成", count: doneJobs.length, icon: CheckCircle2 },
  ];

  return (
    <div className="mx-auto max-w-[1100px] space-y-5 p-6 lg:p-8">
      <nav className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
        <Link
          href="/"
          className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-card transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
        </Link>
        <span className="px-1">任务记录</span>
      </nav>

      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-[20px] font-bold">任务记录</h1>
          <p className="mt-1 text-[13px] text-muted-foreground">
            视频 / 音频提取、文件转换、AI 处理等后台任务的进度与结果
          </p>
        </div>
        <button
          onClick={() => refetch()}
          className="flex h-9 items-center gap-1.5 whitespace-nowrap rounded-lg border border-border bg-card px-3 text-[13px] text-muted-foreground transition-colors hover:text-foreground"
        >
          <RotateCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          刷新
        </button>
      </div>

      {/* 页签 */}
      <div className="flex gap-2 border-b border-border pb-0">
        {tabs.map((t) => {
          const Icon = t.icon;
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className="relative flex items-center gap-2 px-4 py-2.5 text-[14px] font-medium transition-colors"
              style={{
                color: active ? colors.text : colors.muted,
                borderBottom: active ? `2px solid ${colors.blue}` : "2px solid transparent",
                marginBottom: "-1px",
              }}
            >
              <Icon className={`h-4 w-4`} />
              {t.label}
              {t.count > 0 && (
                <span
                  className="flex h-5 min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-semibold"
                  style={{
                    background: active ? colors.blue : colors.muted + "33",
                    color: active ? "#fff" : colors.muted,
                  }}
                >
                  {t.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {disabled && (
        <Card className="p-6 text-sm text-muted-foreground">
          下载与 AI 处理需要本地服务支持。请确认左下角显示「服务运行中」；若未运行，请通过桌面快捷方式重启软件。
        </Card>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">正在加载任务…</p>}
      {error && <p className="text-sm text-destructive">任务加载失败，若持续出现请重启软件。</p>}

      <div className="space-y-3">
        {displayJobs.length === 0 && !isLoading ? (
          <Card className="p-10 text-center text-sm text-muted-foreground">
            {tab === "active" ? "暂无进行中的任务" : "暂无已完成的任务"}
          </Card>
        ) : (
          displayJobs.map((job) => {
            const tool = getToolById(job.toolId);
            const isFailed = job.status === "failed";
            return (
              <Card key={job.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-medium text-foreground">{tool?.name ?? job.toolId}</p>
                    {isFailed && <XCircle className="h-4 w-4 shrink-0 text-red-500" />}
                    {job.status === "completed" && <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />}
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatDate(job.createdAt)} · {job.progress}%
                  </p>
                  {job.error && <p className="mt-1 text-xs text-red-500">{job.error}</p>}
                  {job.message && job.status === "processing" && (
                    <p className="mt-1 text-xs text-blue-400">{job.message}</p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <Badge variant="outline">{STATUS_LABEL[job.status] ?? job.status}</Badge>
                  {job.status === "completed" && job.resultFilename && (
                    <button
                      onClick={(e) => download(e, job)}
                      className="flex items-center gap-1 whitespace-nowrap text-sm text-primary hover:underline"
                    >
                      <Download className="h-3.5 w-3.5" /> 下载
                    </button>
                  )}
                  <Link href={`/tools/${job.toolId}`} className="whitespace-nowrap text-sm text-muted-foreground hover:text-foreground">
                    打开工具
                  </Link>
                </div>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
