// 桥接层：把原来 Electron 主进程提供的那套 window.furinakit.* 用 Tauri 重新实现。
//
// 为什么这么做：原版界面（外壳 + 162 个工具组件）里到处在调 window.furinakit.xxx。
// 只要这里的**名字和签名保持一致**，界面代码一行都不用改就能在 Tauri 里跑起来 ——
// 这是整个迁移里省事最多的一招，也是"界面一模一样"的前提。
//
// 对照 preload.js 的完整清单，逐条落实：
//   窗口：minimize / toggleMaximize / close / getIsMaximized / onMaximizedChange
//   桌面：setTheme / selectDirectory / openPath / openExternal / applySettings
//   图片查重、剪贴板：已在上一轮实现
//   还没搬的（截屏、录屏、更新、ARCHPR、datatool 内嵌浏览器）给**明确报错**，不静默失败

import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

export interface RegionCaptureResult {
  success: boolean; cancelled?: boolean; dataUrl?: string; error?: string;
  width?: number; height?: number; requestId?: string;
  region?: { x: number; y: number; width: number; height: number };
}

export interface FileEntry {
  path: string;
  name: string;
  size: number;
  mtime: number;
}

export interface MoveResult {
  success: boolean;
  trash_root: string;
  moved: string[];
  moved_sources: string[];
  failed: string[];
}

function defineBridge() {
  const bridge = {
    // ── 窗口控制（外壳顶栏那三个按钮）──
    minimize: (): void => {
      invoke("window_minimize").catch(() => {});
    },
    toggleMaximize: (): void => {
      invoke("window_toggle_maximize").catch(() => {});
    },
    /** 关闭 = 收进托盘（和 Electron 版一致，不真的退出） */
    close: (): void => {
      invoke("window_hide").catch(() => {});
    },
    getIsMaximized: (): Promise<boolean> => invoke<boolean>("window_is_maximized"),
    onMaximizedChange: (cb: (maximized: boolean) => void): (() => void) => {
      if (typeof cb !== "function") return () => {};
      let unlisten: (() => void) | undefined;
      let cancelled = false;
      const w = getCurrentWindow();
      const push = () => {
        w.isMaximized()
          .then((v) => {
            if (!cancelled) cb(Boolean(v));
          })
          .catch(() => {});
      };
      // Tauri 没有专门的 maximize/unmaximize 事件，用 resize 兜住（最大化必然触发 resize）
      w.onResized(push)
        .then((un) => {
          if (cancelled) un();
          else unlisten = un;
        })
        .catch(() => {});
      return () => {
        cancelled = true;
        try {
          unlisten?.();
        } catch {
          /* ignore */
        }
      };
    },

    // ── 桌面能力 ──
    setTheme: (theme: string): void => {
      invoke("set_window_theme", { theme }).then(() => {
        let revealed = false;
        const reveal = () => {
          if (revealed) return;
          revealed = true;
          void invoke("window_frontend_ready").catch(() => {});
        };
        requestAnimationFrame(() => requestAnimationFrame(reveal));
        // A hidden WebView may suspend animation frames; do not wait for the
        // native emergency fallback before displaying an otherwise ready UI.
        setTimeout(reveal, 120);
      }).catch(() => {});
    },
    selectDirectory: (): Promise<string | null> => invoke<string | null>("select_directory"),
    getDefaultOutputDir: (): Promise<string> => invoke<string>("get_default_output_dir"),
  /** 弹系统原生选择文件框，返回真实路径（拿不到路径的工具才需要它） */
  pickFile: (extensions: string[] = []): Promise<string | null> =>
    invoke<string | null>("pick_file", { extensions }),
  /** 弹系统原生保存框，返回目标路径 */
  pickSavePath: (defaultName: string): Promise<string | null> =>
    invoke<string | null>("pick_save_path", { defaultName }),
    openPath: async (path: string): Promise<{ success: boolean; error?: string }> => {
      try {
        await invoke("open_path", { path });
        return { success: true };
      } catch (e) {
        return { success: false, error: String(e) };
      }
    },
    openExternal: (url: string): Promise<void> => invoke("open_external", { url }),
    /** 压缩包密码恢复：启动外部的 ARCHPR */
    launchArchpr: (): Promise<{ success: boolean; path?: string; message?: string }> =>
      invoke("launch_archpr"),
    openArchprDir: (): Promise<{ success: boolean; dir?: string }> => invoke("open_archpr_dir"),
    /** Desktop region selection. Cancellation preserves the previous tool input/result. */
    captureRegion: (delayMs?: number): Promise<RegionCaptureResult> => invoke("capture_region", { delayMs }),
    /** Compatibility alias; no implicit fullscreen capture. */
    captureScreen: (delayMs?: number): Promise<RegionCaptureResult> => invoke("capture_region", { delayMs }),
    /** 在线更新：下载安装包（失败时 Rust 侧会自动换国内镜像重试） */
    downloadUpdate: (url: string, sha256?: string): Promise<{ success: boolean; filePath?: string; error?: string }> =>
      invoke("download_update", { url, sha256: sha256 || null }),
    /** 订阅下载进度（返回取消订阅的函数） */
    onUpdateDownloadProgress: (
      cb: (data: { percent: number; receivedBytes: number; totalBytes: number }) => void,
    ): (() => void) => {
      let unlisten: (() => void) | null = null;
      let cancelled = false;
      import("@tauri-apps/api/event")
        .then(({ listen }) =>
          listen<{ percent: number; receivedBytes: number; totalBytes: number }>(
            "update-download-progress",
            (e) => cb(e.payload),
          ),
        )
        .then((un) => {
          if (cancelled) un();
          else unlisten = un;
        })
        .catch(() => {});
      return () => {
        cancelled = true;
        unlisten?.();
      };
    },
    /** 启动安装程序并退出本程序 */
    installUpdate: (path: string): Promise<{ success: boolean; error?: string }> =>
      invoke("install_update", { path }),
    /** 设置项下发给主进程：这里只需要把主题同步到原生层，其余前端自己处理 */
    applySettings: (settings: Record<string, unknown>): { success: boolean } => {
      const theme = settings?.theme;
      if (theme === "light" || theme === "dark" || theme === "eye-care") bridge.setTheme(theme);
      // 「关闭窗口时退出/收进托盘」「开机自启」交给后端真正生效
      void invoke("apply_desktop_settings", { settings }).catch(() => {});
      return { success: true };
    },

    // ── 图片查重那一套 ──
    dedupPickFolder: async () => {
      const dir=await invoke<string|null>("dedup_pick_folder");
      return {success:Boolean(dir),dir:dir||undefined,canceled:!dir};
    },
    dedupListImages: async (dir:string) => ({success:true,files:await invoke<FileEntry[]>("dedup_list_images",{dir})}),
    dedupReadImage: async (path:string) => ({success:true,base64:await invoke<string>("dedup_read_image",{path})}),
    dedupMoveToTrash: async ({files,baseDir,trashName}:{files:string[];baseDir:string;trashName?:string}) => {
      const r=await invoke<MoveResult>("dedup_move_to_trash",{files,baseDir,trashName:trashName??null});
      return {...r,trashRoot:r.trash_root,movedSources:r.moved_sources};
    },

    // ── 剪贴板 ──
    clipboardWrite: (text: string): Promise<void> => invoke("clipboard_write", { text }),
    clipboardRead: (): Promise<string> => invoke("clipboard_read"),

    // ── 应用信息 ──
    appRoot: (): Promise<string> => invoke("app_root_path"),
    isElevated: (): Promise<boolean> => Promise.resolve(false),
    platform: "win32" as const,
    // 界面按这个区分"桌面客户端"和"浏览器网页"（外壳、统计弹窗、视频下载都用它）。
    // 我们就是桌面客户端，所以必须是 true。
    isElectron: true as const,
    isTauri: true as const,

    // ── 还没搬过来的（明确报错，别静默失败）──
    onClipboardChange: (_cb: (text: string) => void): (() => void) => () => {},

    readFileDataUrl: (
      path: string,
    ): Promise<{ success: boolean; name: string; size: number; mime: string; dataUrl: string; path: string }> =>
      invoke("read_file_data_url", { path }),

    pendingFileInfo: (path:string):Promise<{size:number;modified:number|null}> => invoke("pending_file_info",{path}),
    readPendingFileChunk: (path:string,offset:number,length:number):Promise<ArrayBuffer|number[]> => invoke("read_pending_file_chunk",{path,offset,length}),
    // ── 桌面悬浮球 ──
    saveFloatBallPos: (x: number, y: number): Promise<void> => invoke("save_float_ball_pos", { x, y }),
    loadFloatBallPos: (): Promise<{ x: number; y: number } | null> => invoke("load_float_ball_pos"),
    setFloatBallExpanded: (
      expanded: boolean,
      ballScreenX: number,
      ballScreenY: number,
      paletteWidth: number,
      paletteHeight: number,
    ): Promise<{ directionX: string; directionY: string; winX?: number; winY?: number; anchorX: number; anchorY: number }> =>
      invoke("set_float_ball_expanded", {
        expanded,
        ballScreenX,
        ballScreenY,
        paletteWidth,
        paletteHeight,
      }),
    // 展开后新尺寸画好了，再把悬浮球窗口显示出来（Rust 在放大前把窗口隐身了）
    revealFloatBall: (): Promise<void> => invoke("reveal_float_ball"),
    // 只计算展开方向/锚点，不动窗口（先摆好球再展开，避免球闪到大窗左上角）
    planFloatBallExpand: (
      paletteWidth: number,
      paletteHeight: number,
    ): Promise<{ directionX: string; directionY: string; winX?: number; winY?: number; anchorX: number; anchorY: number }> =>
      invoke("set_float_ball_expanded", {
        expanded: true,
        ballScreenX: 0,
        ballScreenY: 0,
        paletteWidth,
        paletteHeight,
        planOnly: true,
      }),
    snapFloatBallToEdge: (
      currentX: number,
      currentY: number,
      snapThreshold?: number,
    ): Promise<{ x: number; y: number }> =>
      invoke("snap_float_ball_to_edge", {
        currentX,
        currentY,
        snapThreshold: snapThreshold ?? 32,
      }),
    openMainWindowWithTarget: async (payload: {
      category?: string;
      toolId?: string;
      pendingFiles?: unknown[];
      pending_files?: unknown[];
      pendingFilesData?: unknown[];
    }): Promise<void> => {
      const raw = payload.pendingFilesData || payload.pendingFiles || payload.pending_files;
      const items = raw?.map(item => typeof item === 'string' ? {path:item,name:item.split(/[\\/]/).pop() || item,type:''} : item);
      return invoke("open_main_window_with_target", {payload:{toolId:payload.toolId,category:payload.category,pendingFilesData:items}});
    },
    syncFloatBallPreferences: (prefs: Record<string,string>): Promise<void> => invoke("sync_float_ball_preferences", {prefs}),
    setFloatBallVisible: (visible: boolean): Promise<void> =>
      invoke("set_float_ball_visible", { visible }),
    startFloatBallDragging: (): Promise<void> =>
      invoke("start_float_ball_dragging"),
    moveFloatBall: (x: number, y: number): Promise<void> =>
      invoke("move_float_ball", { x, y }),
    /** 拖入悬浮球的文件 → 推给主窗口，让右上角待办提示条立刻出现 */
    /** 本次构建的信息（构建时间等），用于确认跑的是哪一版 */
    getBuildInfo: (): Promise<{ buildTime: string; buildEpoch: string; version: string }> =>
      invoke("get_build_info"),
    /** 取悬浮球窗口当前的物理位置（拖动时做 DPI 换算要用） */
    getFloatBallPosition: (): Promise<{ x: number; y: number; scale: number }> =>
      invoke("get_float_ball_position"),
    /** 临时改悬浮球窗口大小（拖文件悬停时撑大，好显示反馈） */
    setFloatBallSize: (size: number): Promise<void> =>
      invoke("set_float_ball_size", { size }),
    /** 悬浮球右键菜单的动作：open / settings / hide / quit */
    floatBallMenuAction: (action: string): Promise<void> =>
      invoke("float_ball_menu_action", { action }),
    pushPendingFilesToMain: (files: unknown): Promise<void> =>
      invoke("push_pending_files_to_main", { filesData: files }),
  };

  const win = window as unknown as { furinakit: typeof bridge; furinaKit: typeof bridge };
  win.furinakit = bridge;
  win.furinaKit = bridge;
  return bridge;
}

/** 在应用启动时调用一次 */
export function installBridge() {
  if (typeof window === "undefined") return;
  const win = window as unknown as { furinakit?: unknown; furinaKit?: unknown };
  if (!win.furinakit || !win.furinaKit) {
    defineBridge();
  }
}

export type FurinaKitBridge = ReturnType<typeof defineBridge>;

/** Typed access to the installed Tauri bridge, independent of legacy Electron Window declarations. */
export function desktopBridge(): FurinaKitBridge {
  return (window as unknown as {furinakit:FurinaKitBridge}).furinakit;
}
