"use client";

import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { getToolById } from "@furinakit/shared";
import { useTheme } from "@/components/theme-provider";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Download,
  ChevronDown,
  ListTodo,
  Clock,
  StopCircle,
  FolderOpen,
} from "lucide-react";

interface Job {
  id: string;
  toolId: string;
  status: "queued" | "processing" | "completed" | "failed";
  progress: number;
  message?: string;
  resultFilename?: string;
  resultMimeType?: string;
  createdAt?: string;
  updatedAt?: string;
  error?: string;
}

export function TaskFloatBall() {
  const router = useRouter();
  const { colors } = useTheme();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [tab, setTab] = useState<"running" | "finished">("running");

  // 轮询任务状态
  useEffect(() => {
    const fetchJobs = async () => {
      try {
        const res = await fetch("/api/jobs", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          if (data.jobs) setJobs(data.jobs);
        }
      } catch {
        // 静默失败
      }
    };

    fetchJobs();
    const timer = setInterval(fetchJobs, 2000);
    window.addEventListener("furinakit:jobs-updated", fetchJobs);
    return () => {
      clearInterval(timer);
      window.removeEventListener("furinakit:jobs-updated", fetchJobs);
    };
  }, []);

  const runningJobs = jobs.filter((j) => (j.status as string) === "pending" || (j.status as string) === "queued" || (j.status as string) === "processing");
  const finishedJobs = jobs.filter((j) => j.status === "completed" || j.status === "failed" || (j.status as string) === "canceled");
  const runningCount = runningJobs.length;

  // ============ 悬浮球拖拽 ============
  const BALL_SIZE = 48;
  const MARGIN = 24;
  const [mounted, setMounted] = useState(false);
  const [pos, setPos] = useState<{ x: number; y: number }>({ x: 1200, y: 700 });
  const [ballSide, setBallSide] = useState<"left" | "right">("right");
  const suppressClick = useRef(false);

  // 客户端挂载后初始化位置（右下角，确保在窗口内）
  useEffect(() => {
    setMounted(true);
    const x = Math.max(0, window.innerWidth - MARGIN - BALL_SIZE);
    const y = Math.max(0, window.innerHeight - MARGIN - BALL_SIZE);
    setPos({ x, y });
    setBallSide("right");
  }, []);

  // 窗口尺寸变化时把悬浮球固定到右下角
  useEffect(() => {
    const onResize = () => {
      const x = Math.max(0, window.innerWidth - MARGIN - BALL_SIZE);
      const y = Math.max(0, window.innerHeight - MARGIN - BALL_SIZE);
      setPos({ x, y });
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const onBallPointerDown = (e: React.PointerEvent) => {
    if (!pos) return;
    // 只响应主键（鼠标左键 / 触摸 / 笔）
    if (e.button !== undefined && e.button !== 0) return;
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const origX = pos.x;
    const origY = pos.y;
    let moved = false;
    const el = e.currentTarget as HTMLElement;
    try {
      el.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!moved && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) moved = true;
      if (!moved) return;
      const maxX = window.innerWidth - BALL_SIZE;
      const maxY = window.innerHeight - BALL_SIZE;
      const nx = Math.max(0, Math.min(maxX, origX + dx));
      const ny = Math.max(0, Math.min(maxY, origY + dy));
      setPos({ x: nx, y: ny });
    };

    const onUp = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (moved) {
        suppressClick.current = true;
        // 吸附到最近的左右边缘
        setPos((prev) => {
          if (!prev) return prev;
          const isOnLeft = prev.x + BALL_SIZE / 2 < window.innerWidth / 2;
          const snappedX = isOnLeft
            ? MARGIN
            : window.innerWidth - BALL_SIZE - MARGIN;
          const next = { x: snappedX, y: prev.y };
          localStorage.setItem("furinakit-ball-pos", JSON.stringify(next));
          // 记录悬浮球在哪一边
          setBallSide(isOnLeft ? "left" : "right");
          return next;
        });
      }
      try {
        el.releasePointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }
    };

    // 挂到 window，快速拖动 / 指针移出球体也不会丢事件
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  const onBallClick = () => {
    if (suppressClick.current) {
      suppressClick.current = false;
      return; // 拖拽结束，不展开/收起
    }
    setExpanded((v) => !v);
  };

  // 球靠近左半边时面板左对齐，否则右对齐
  const onLeftSide = mounted && pos.x + BALL_SIZE / 2 < window.innerWidth / 2;

  const downloadResult = async (jobId: string, e: React.MouseEvent, filename?: string) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/jobs/${jobId}/download?download=1`);
      if (!res.ok) throw new Error("下载失败");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename || "download";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch (err) {
      console.error("下载失败:", err);
    }
  };

  const goToTool = (toolId: string, jobId?: string) => {
    if (jobId) {
      try {
        sessionStorage.setItem(`furina:job:${toolId}`, jobId);
        sessionStorage.setItem("furina:active_job_global", jobId);
        window.dispatchEvent(
          new CustomEvent("furinakit:select-job", { detail: { toolId, jobId } })
        );
      } catch {}
      router.push(`/tools/${toolId}?jobId=${encodeURIComponent(jobId)}`);
    } else {
      router.push(`/tools/${toolId}`);
    }
    setExpanded(false);
  };

  // 停止任务
  const cancelTask = async (jobId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const res = await fetch(`/api/jobs/${jobId}/cancel`, { method: "POST" });
      if (res.ok) {
        // 刷新任务列表
        const jobsRes = await fetch("/api/jobs", { cache: "no-store" });
        const data = await jobsRes.json();
        if (data.jobs) setJobs(data.jobs);
      }
    } catch (err) {
      console.error("取消任务失败:", err);
    }
  };

  // 打开输出文件夹
  const openOutputFolder = async (job: Job, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      // 从API获取输出目录
      const res = await fetch("/api/output-dir", { cache: "no-store" });
      if (!res.ok) {
        console.error("获取输出目录失败");
        return;
      }
      const data = await res.json();
      const outputDir = data.outputDir || data.resultsDir;
      
      if (!outputDir) {
        console.error("输出目录为空");
        return;
      }
      
      // 调用Electron打开文件夹
      if (window.furinakit?.openPath) {
        const result = await window.furinakit.openPath(outputDir);
        if (!result.success) {
          console.error("打开文件夹失败:", result.error);
        }
      } else {
        console.error("window.furinakit.openPath 不可用");
      }
    } catch (err) {
      console.error("打开文件夹失败:", err);
    }
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case "pending":
      case "queued":
        return <Clock size={14} style={{ color: "hsl(var(--muted-foreground))" }} />;
      case "processing":
        return <Loader2 size={14} className="animate-spin" style={{ color: "hsl(var(--primary))" }} />;
      case "completed":
        return <CheckCircle2 size={14} style={{ color: "hsl(var(--success))" }} />;
      case "failed":
        return <XCircle size={14} style={{ color: "hsl(var(--destructive))" }} />;
      case "canceled":
        return <XCircle size={14} style={{ color: "hsl(var(--muted-foreground))" }} />;
      default:
        return <Clock size={14} style={{ color: "hsl(var(--muted-foreground))" }} />;
    }
  };

  const statusText = (status: string) => {
    switch (status) {
      case "pending":
      case "queued": return "排队中";
      case "processing": return "处理中";
      case "completed": return "已完成";
      case "failed": return "失败";
      case "canceled": return "已取消";
      default: return status;
    }
  };

  const displayJobs = tab === "running" ? runningJobs : finishedJobs.slice(0, 20);
  const panelBg = colors.sidebar || "#0d1526";
  const borderCol = colors.borderSolid || "#1e293b";

  return (
    <>
      {/* 透明遮罩：点击关闭面板 */}
      {expanded && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setExpanded(false)}
        />
      )}

      {/* 任务列表面板（跟随悬浮球位置，在球的上方展开） */}
      {expanded && pos && (
          <div
            className="fixed z-50 w-80 overflow-hidden rounded-2xl border shadow-2xl"
            style={{
              backgroundColor: panelBg,
              borderColor: borderCol,
              bottom: window.innerHeight - pos.y - 8,
              ...(onLeftSide
                ? { left: pos.x }
                : { right: window.innerWidth - pos.x - BALL_SIZE }),
            }}
          >
            {/* 面板头部 */}
            <div className="flex items-center gap-2 border-b px-4 py-3" style={{ borderColor: borderCol }}>
              <ListTodo size={16} style={{ color: "#2dd4bf" }} />
              <span className="text-sm font-semibold" style={{ color: colors.text }}>任务列表</span>
              <div className="flex-1" />
              <button
                onClick={() => setExpanded(false)}
                className="rounded p-1 transition-colors hover:bg-white/10"
                style={{ color: colors.muted }}
              >
                <ChevronDown size={14} />
              </button>
            </div>

            {/* Tab 切换 */}
            <div className="flex border-b" style={{ borderColor: borderCol }}>
              <button
                onClick={() => setTab("running")}
                className="flex-1 py-2 text-xs font-medium transition-colors"
                style={{
                  color: tab === "running" ? "#2dd4bf" : colors.muted,
                  borderBottom: tab === "running" ? "2px solid #2dd4bf" : "2px solid transparent",
                }}
              >
                进行中 ({runningJobs.length})
              </button>
              <button
                onClick={() => setTab("finished")}
                className="flex-1 py-2 text-xs font-medium transition-colors"
                style={{
                  color: tab === "finished" ? "#2dd4bf" : colors.muted,
                  borderBottom: tab === "finished" ? "2px solid #2dd4bf" : "2px solid transparent",
                }}
              >
                已完成 ({finishedJobs.length})
              </button>
            </div>

            {/* 任务列表 */}
            <div className="max-h-80 overflow-y-auto">
              {displayJobs.length === 0 ? (
                <div className="py-10 text-center text-xs" style={{ color: colors.muted }}>
                  {tab === "running" ? "当前没有进行中的任务" : "还没有已完成的任务"}
                </div>
              ) : (
                displayJobs.map((job) => {
                  const tool = getToolById(job.toolId);
                  const toolName = tool?.name || job.toolId;
                  return (
                    <div
                      key={job.id}
                      className="group cursor-pointer border-b px-4 py-3 transition-colors hover:bg-white/[0.05] last:border-b-0"
                      style={{ borderColor: borderCol }}
                      onClick={() => goToTool(job.toolId, job.id)}
                      title={`点击进入「${toolName}」查看此任务详情`}
                    >
                      <div className="flex items-center gap-2">
                        {statusIcon(job.status)}
                        <span
                          className="flex-1 truncate text-sm font-medium group-hover:underline"
                          style={{ color: colors.text }}
                          title={toolName}
                        >
                          {toolName}
                        </span>
                        <span className="text-xs" style={{ color: colors.muted }}>
                          {statusText(job.status)}
                        </span>
                        {job.status === "completed" && job.resultFilename && (
                          <button
                            onClick={(e) => downloadResult(job.id, e, job.resultFilename)}
                            className="rounded p-1 transition-colors hover:bg-white/10"
                            style={{ color: "#3ecf8e" }}
                            title="下载结果"
                          >
                            <Download size={14} />
                          </button>
                        )}
                        {job.status === "completed" && (
                          <button
                            onClick={(e) => openOutputFolder(job, e)}
                            className="rounded p-1 transition-colors hover:bg-white/10"
                            style={{ color: "#60a5fa" }}
                            title="打开输出文件夹"
                          >
                            <FolderOpen size={14} />
                          </button>
                        )}
                        {((job.status as string) === "pending" || (job.status as string) === "queued" || job.status === "processing") && (
                          <button
                            onClick={(e) => cancelTask(job.id, e)}
                            className="rounded p-1 transition-colors hover:bg-white/10"
                            style={{ color: "#f87171" }}
                            title="停止任务"
                          >
                            <StopCircle size={14} />
                          </button>
                        )}
                      </div>

                      {job.status === "processing" && (
                        <div className="mt-2">
                          <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: "hsl(var(--secondary))" }}>
                            <div
                              className="h-full rounded-full transition-all duration-500"
                              style={{ width: `${job.progress || 0}%`, backgroundColor: "hsl(var(--primary))" }}
                            />
                          </div>
                          <div className="mt-1 flex items-center justify-between">
                            <span className="truncate text-xs" style={{ color: colors.muted }}>
                              {job.message || "处理中..."}
                            </span>
                            <span className="ml-2 flex-shrink-0 text-xs" style={{ color: colors.muted }}>
                              {job.progress || 0}%
                            </span>
                          </div>
                        </div>
                      )}

                      {job.status === "failed" && job.error && (
                        <p className="mt-1 line-clamp-2 text-xs" style={{ color: "#ef4444" }}>
                          {job.error}
                        </p>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}

        {/* 悬浮球按钮（可随意拖动，松手吸附左右边缘） */}
        <button
          onPointerDown={onBallPointerDown}
          onClick={onBallClick}
          className="fixed z-50 flex touch-none select-none items-center justify-center rounded-full shadow-lg transition-transform hover:scale-105"
          style={{
            left: pos.x,
            top: pos.y,
            width: BALL_SIZE,
            height: BALL_SIZE,
            background: "linear-gradient(135deg, #1e40af, #38bdf8 55%, #bae6fd)",
            color: "white",
            cursor: "grab",
          }}
          title="任务列表（按住可拖动）"
        >
          {runningCount > 0 ? (
            <>
              <Loader2 size={22} className="animate-spin" />
              <span className="absolute -right-1 -top-1 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-red-500 px-1 text-xs font-bold text-white">
                {runningCount}
              </span>
            </>
          ) : (
            <ListTodo size={22} />
          )}
        </button>
    </>
  );
}
