import {useLanguage} from "@/lib/language";
import {RecorderPanel} from "@/components/recorder-panel";
import {ThemeProvider} from "@/components/theme-provider";
import {desktopBridge} from '@/bridge';
"use client";

// 应用的根：等价于原版的 `app/layout.tsx` + Next 的文件路由。
//
// 原版布局（layout.tsx）：
//   <html lang="zh-CN" data-theme="dark" className={inter.variable + jetbrainsMono.variable}>
//     <body className="antialiased">
//       <Providers><AppShell>{children}</AppShell></Providers>
// 其中 html 的属性与"首屏前套用主题"的脚本放在 index.html 里，
// 字体变量由 src/fonts.css 提供（内容是从 Next 构建产物里原样导出的），
// 所以这里的结构就是 Providers > AppShell > 页面 —— 与原版逐层对应。

import { Component, useEffect, type ErrorInfo, type ReactNode } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { Providers } from "@/components/providers";
import { NotFoundError, usePathname } from "@/router";

import HomePage from "@/pages/home";
import ToolPage from "@/pages/tool-page";
import FavoritesPage from "@/pages/favorites";
import JobsPage from "@/pages/jobs";
import TransferPage from "@/pages/transfer";
import NotFound from "@/pages/not-found";
import ErrorPage from "@/pages/error";

/** 页面级错误边界：对应原版的 app/error.tsx 与 app/not-found.tsx（都渲染在外壳里面） */
class PageBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[FurinaKit] 页面渲染出错:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    if (error instanceof NotFoundError) return <NotFound />;
    return <ErrorPage error={error} reset={() => this.setState({ error: null })} />;
  }
}

/** 对照 Next 的文件路由把路径映射成页面 */
function CurrentPage() {
  const pathname = usePathname();

  if (pathname === "/" || pathname === "/favorites") return <HomePage />;
  if (pathname === "/jobs") return <JobsPage />;
  if (pathname === "/portal/transfer") return <TransferPage />;
  if (pathname.startsWith("/tools/")) {
    const toolId = decodeURIComponent(pathname.slice("/tools/".length)).replace(/\/+$/, "");
    if (toolId) return <ToolPage toolId={toolId} />;
  }
  return <NotFound />;
}

import { CaptureWindow } from "@/components/capture/capture-window";
import { CaptureActionsProvider } from "@/lib/capture-actions";
import { RegionSelector } from "@/components/region-selector";
import { FloatBallApp } from "@/components/float-ball/float-ball-app";
import { PendingFilesProvider } from "@/lib/pending-files-context";
import { PendingFilesBanner } from "@/components/layout/pending-files-banner";
import { UtilityWindow } from "@/components/utility-window";
import { UtilityShortcuts } from "@/components/utility-shortcuts";

export default function App() {
  useLanguage();
  const pathname = usePathname();

  const isFloatBall =
    typeof window !== "undefined" &&
    (window.location.search.includes("window=float-ball") ||
      window.location.hash.includes("float-ball"));

  const utilityKind = new URLSearchParams(window.location.search).get("window");
  const isUtility = utilityKind === "clipboard" || utilityKind === "notes";
  const isRegionCapture = new URLSearchParams(window.location.search).get("window") === "region-capture";
  const isShotWindow = ["shot-pin", "shot-editor"].includes(new URLSearchParams(window.location.search).get("window") || "");
  useEffect(() => {
    if (isFloatBall || isRegionCapture || isShotWindow || isUtility || utilityKind==="recorder-panel") return;
    // 新装机默认「完整动效」：显式写入，设置页与悬浮球窗口读到的都是同一个明确值
    try { if (localStorage.getItem('furinakit_floatball_reduce_motion') === null) localStorage.setItem('furinakit_floatball_reduce_motion', 'false'); } catch {}
    const prefs=Object.fromEntries(['furinakit_floatball_reduce_motion','furinakit_floatball_grid','furinakit_floatball_tools','furinakit_floatball_opacity','furinakit_floatball_auto_handoff'].map(key=>[key,localStorage.getItem(key)]).filter((entry): entry is [string,string]=>entry[1]!==null));
    void desktopBridge().syncFloatBallPreferences(prefs).catch(console.error);
    const rawFb = localStorage.getItem('furinakit_floatball_enabled');
    const fbEnabled = rawFb === null ? true : rawFb !== 'false';
    if (rawFb === null) {
      try { localStorage.setItem('furinakit_floatball_enabled', 'true'); } catch {}
    }
    void desktopBridge().setFloatBallVisible(fbEnabled).catch(console.error);
  }, [isFloatBall, isRegionCapture, isShotWindow, isUtility]);
  if (utilityKind==="recorder-panel") return <ThemeProvider><RecorderPanel/></ThemeProvider>;
  if (isUtility) return <Providers><UtilityWindow kind={utilityKind as "clipboard"|"notes"}/></Providers>;
  if (isShotWindow) return <ThemeProvider><CaptureWindow /></ThemeProvider>;
  if (isRegionCapture) return <RegionSelector />;
  if (isFloatBall) {
    return <FloatBallApp />;
  }

  return (
    <Providers>
      <UtilityShortcuts/>
      <PendingFilesProvider>
        <CaptureActionsProvider>
        <PendingFilesBanner />
        <AppShell>
          {/* key={pathname}：换页面时把错误状态一起清掉，与原版每次导航都是新页面一致 */}
          <PageBoundary key={pathname}>
            <CurrentPage />
          </PageBoundary>
        </AppShell>
        </CaptureActionsProvider>
      </PendingFilesProvider>
    </Providers>
  );
}
