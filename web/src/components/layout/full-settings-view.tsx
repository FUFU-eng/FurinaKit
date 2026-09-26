import { Select as RoundedSelect } from "@/components/ui/primitives";

import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/layout/full-settings-view.tsx");
import {publicToolId,REMOVED_TOOL_IDS} from "@/shared/catalog-policy";
"use client";
import { setLanguage } from "@/lib/language";
import {OpenSourceLicenses} from "./open-source-licenses";
import { Languages as LanguageIcon } from "lucide-react";
import { useEscapeDismiss } from "@/lib/use-escape-dismiss";
import { ToolChooser } from "./tool-chooser";
import { ShortcutSettings } from "@/components/layout/shortcut-settings";
import {useFavorites} from '@/lib/use-tool-prefs';
import './float-ball-settings.css';
import {desktopBridge} from '@/bridge';
import { ensureOutputDirectory, openOutputDirectory } from "@/lib/output-directory";

import { useState, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  ArrowLeft,
  FolderOpen,
  Power,
  Check,
  Sparkles,
  RefreshCw,
  ArrowUpCircle,
  LogOut,
  FileText,
  Wrench,
  MessageSquareHeart,
  CircleDot,
  Sliders,
  Settings,
  Palette,
  Keyboard,
  Bot,
  HardDrive,
  HelpCircle,
  Search,
  ChevronRight,
  Sun,
  Moon,
  Eye,
  Monitor,
  Bell,
  Trash2,
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
  Heart,
  Minus,
  Square,
  Copy,
  Folder,
  Layers,
  Zap,
  BookOpen,
  Shield,
  FileCode,
  UserCheck,
  Tag,
  FileCode2,
  Scissors,
  Video,
  AlertTriangle,
  RotateCcw,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { useTheme, type ThemeMode } from "@/components/theme-provider";
import { AiConfigPanel } from "@/components/tools/ai-tools";
import { ComponentsManager } from "@/components/layout/components-manager";
import { APP_VERSION, APP_NAME, APP_CHANGELOG } from "@/lib/version";
import { UpdateModal } from "@/components/layout/update-modal";
import { RepairModal } from "@/components/layout/repair-modal";
import { FeedbackModal } from "@/components/layout/feedback-modal";
import { getCachedReply, checkMyReply, markReplySeen, type MyReply } from "@/lib/my-reply";
import { checkForUpdates } from "@/lib/updater";
import { cn } from "@/lib/utils";
import { ALL_CONFIGURABLE_TOOLS, DEFAULT_TOOL_IDS } from "@/components/float-ball/float-ball-app";
import { getAvailableTools, type OmniTool, CATEGORY_LABELS } from "@furinakit/shared";
import { getToolIcon } from "@/lib/tool-icons";

export type SettingsSection =
  | "general"
  | "appearance"
  | "floatball"
  | "shortcuts"
  | "ai"
  | "components"
  | "updates"
  | "about"
  | "donate";

interface SettingsData {
  autoStart: boolean;
  outputDir: string;
  closeAction: "tray" | "quit";
  notifyOnComplete: boolean;
  reduceMotion: boolean;
  themeMode: ThemeMode;
  accentColor: string;
}

const DEFAULT_SETTINGS_DATA: SettingsData = {
  autoStart: false,
  outputDir: "",
  closeAction: "tray",
  notifyOnComplete: true,
  reduceMotion: false,
  themeMode: "eye-care",
  accentColor: "cyan",
};

const STORAGE_KEY = "furinakit:settings";

const SECTIONS: {
  id: SettingsSection;
  name: string;
  enName: string;
  icon: React.ComponentType<{ size?: number; className?: string; style?: React.CSSProperties; fill?: string }>;
  desc: string;
  badge?: string;
  highlight?: boolean;
  important?: boolean;
}[] = [
  { id: "general", name: "常规与系统", enName: "General & System", icon: Settings, desc: "开机自启、关闭行为、输出目录与系统选项" },
  { id: "appearance", name: "外观与主题", enName: "Appearance & Style", icon: Palette, desc: "视觉模式、主题色彩、动效与布局外观" },
  { id: "floatball", name: "桌面悬浮球", enName: "Desktop Float Ball", icon: CircleDot, desc: "悬浮球启闭、毛玻璃透明度、常用工具与拖拽感知" },
  { id: "shortcuts", name: "快捷键设置", enName: "Hotkeys & Shortcuts", icon: Keyboard, desc: "一个主界面快捷键，四个自选工具快捷键" },
  { id: "ai", name: "AI 模型配置", enName: "AI Model Configuration", icon: Bot, desc: "大语言模型服务商、API Key、端点与参数配置" },
  { id: "components", name: "组件与存储空间", enName: "Components & Storage", icon: HardDrive, desc: "按需离线组件、运行模型、缓存清理与目录管理" },
  { id: "updates", name: "版本更新与反馈", enName: "Updates & Diagnostics", icon: RefreshCw, desc: "更新日志、版本检测、意见反馈与环境自检" },
  { id: "donate", name: "支持作者", enName: "Support Author", icon: Heart, desc: "赞赏支持与永久免费承诺", highlight: true },
  { id: "about", name: "关于", enName: "About & Feedback", icon: MessageSquareHeart, desc: "软件信息、技术架构与使用规范" },
];

const ACCENT_COLORS = [
  { id: "cyan", name: "水波天蓝", hex: "#38bdf8", bgClass: "bg-sky-400" },
  { id: "gold", name: "琥珀暖金", hex: "#f59e0b", bgClass: "bg-amber-500" },
  { id: "emerald", name: "翡翠清绿", hex: "#10b981", bgClass: "bg-emerald-500" },
  { id: "purple", name: "幻梦紫罗兰", hex: "#a855f7", bgClass: "bg-purple-500" },
  { id: "rose", name: "落樱粉红", hex: "#ec4899", bgClass: "bg-pink-500" },
];

export function FullSettingsView({
  open,
  onClose,
  initialSection = "general",
}: {
  open: boolean;
  onClose: () => void;
  initialSection?: SettingsSection;
}) {
  const __locale = __useLanguage();
  const [savingLanguage, setSavingLanguage] = useState(false);
  const [languageError, setLanguageError] = useState("");
  const changeLanguage = async (value: string) => {
    setSavingLanguage(true); setLanguageError("");
    try { await setLanguage(value === "en" ? "en" : "zh-CN"); }
    catch (error) { setLanguageError(String(error)); }
    finally { setSavingLanguage(false); }
  };
  const { colors, themeMode, setTheme } = useTheme();
  const { toast } = useToast();

  // 板块导航状态
  const [activeSection, setActiveSection] = useState<SettingsSection>(initialSection);
  const [searchQuery, setSearchQuery] = useState("");

  // 法律文件子视图 ("statement" | "rules" | null)
  const [legalDoc, setLegalDoc] = useState<"statement" | "rules" | null>(null);

  // 设置状态
  const [settings, setSettings] = useState<SettingsData>(DEFAULT_SETTINGS_DATA);
  const [savedTick, setSavedTick] = useState(false);

  // 悬浮球专项状态
  const [floatBallEnabled, setFloatBallEnabled] = useState(true);
  const [floatBallOpacity, setFloatBallOpacity] = useState(85);
  const [floatBallReduceMotion,setFloatBallReduceMotion]=useState(false);
  const [floatBallGrid, setFloatBallGrid] = useState(4);
  const [floatBallTools, setFloatBallTools] = useState<string[]>(DEFAULT_TOOL_IDS);
  const [floatBallAutoHandoff, setFloatBallAutoHandoff] = useState(true);
  // 本次构建时间：这个应用有单实例保护，旧进程没关掉时改动看起来"没生效"，
  // 靠它一眼分辨跑的是哪一版（改完记得先退出程序再重新打开）

  // 获取全部可用工具
  const allAvailableTools = useMemo(() => {
    try {
      return getAvailableTools().filter((t) => !t.comingSoon);
    } catch {
      return [];
    }
  }, [ __locale]);

  // 子模态框
  const [updateOpen, setUpdateOpen] = useState(false);
  const [logVersion,setLogVersion]=useState(APP_CHANGELOG[0]?.version||"");
  const selectedLog=APP_CHANGELOG.find(log=>log.version===logVersion)||APP_CHANGELOG[0];
  const [updateTab, setUpdateTab] = useState<"check" | "changelog">("check");
  const [hasUpdate, setHasUpdate] = useState(false);
  const [repairOpen, setRepairOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [myReply, setMyReply] = useState<MyReply | null>(null);

  // 缓存清理提示
  const [clearingCache, setClearingCache] = useState(false);
  const [cacheClearedText, setCacheClearedText] = useState("");

  // 窗口最大化状态
  const [isMaximized, setIsMaximized] = useState(false);

  // 同步外部传入的 initialSection
  useEffect(() => {
    if (open && initialSection) {
      setActiveSection(initialSection);
      setLegalDoc(null);
    }
  }, [open, initialSection]);

  // 监听窗口最大化
  useEffect(() => {
    if (typeof window === "undefined" || !window.furinakit?.isElectron) return;
    let cancelled = false;
    window.furinakit.getIsMaximized?.()
      .then((v) => { if (!cancelled) setIsMaximized(Boolean(v)); })
      .catch(() => {});
    const un = window.furinakit.onMaximizedChange?.((m) => {
      if (!cancelled) setIsMaximized(Boolean(m));
    });
    return () => {
      cancelled = true;
      un?.();
    };
  }, []);

  // 加载设置
  useEffect(() => {
    if (!open) return;
    let loadedOutputDir = "";
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        setSettings((prev) => ({ ...prev, ...parsed }));
        if (parsed.outputDir && typeof parsed.outputDir === "string" && parsed.outputDir.trim()) {
          loadedOutputDir = parsed.outputDir.trim();
        }
      }
    } catch {}

    // 若当前没有设置真实的输出目录，主动读取系统默认下载/桌面目录并填入真实展示
    if (!loadedOutputDir && typeof window !== "undefined" && window.furinakit?.getDefaultOutputDir) {
      window.furinakit
        .getDefaultOutputDir()
        .then((dir) => {
          if (dir && dir.trim()) {
            setSettings((prev) => {
              if (prev.outputDir && prev.outputDir.trim()) return prev;
              const next = { ...prev, outputDir: dir.trim() };
              try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
              } catch {}
              return next;
            });
          }
        })
        .catch(() => {});
    }

    try {
      const fbEnabled = localStorage.getItem("furinakit_floatball_enabled");
      const enabled = fbEnabled === null ? true : fbEnabled !== "false";
      if (fbEnabled === null) {
        try { localStorage.setItem("furinakit_floatball_enabled", "true"); } catch {}
      }
      setFloatBallEnabled(enabled);
      const fbOpacity = localStorage.getItem("furinakit_floatball_opacity");
      if (fbOpacity) setFloatBallOpacity(Number(fbOpacity));
      setFloatBallReduceMotion(localStorage.getItem('furinakit_floatball_reduce_motion')==='true');
      const fbGrid=Number(localStorage.getItem('furinakit_floatball_grid')||4);
      setFloatBallGrid([4,6,9].includes(fbGrid)?fbGrid:4);
      const fbTools = localStorage.getItem("furinakit_floatball_tools");
      if (fbTools) {
        const parsed = JSON.parse(fbTools);
        if (Array.isArray(parsed) && parsed.length > 0) setFloatBallTools([...new Set(parsed.filter((id):id is string=>typeof id==='string'&&!REMOVED_TOOL_IDS.includes(id)).map(publicToolId))]);
      }
      const fbAutoHandoff = localStorage.getItem("furinakit_floatball_auto_handoff");
      if (fbAutoHandoff !== null) setFloatBallAutoHandoff(fbAutoHandoff !== "false");
    } catch {}

    // 检测更新与作者回复
    checkForUpdates().then((res) => setHasUpdate(res.hasUpdate)).catch(() => {});
    setMyReply(getCachedReply());
    checkMyReply().then((r) => { if (r) setMyReply(r); }).catch(() => {});
  }, [open]);

  useEscapeDismiss(()=>{if(legalDoc)setLegalDoc(null);else onClose();},open&&!updateOpen&&!repairOpen&&!feedbackOpen,50);

  // 保存设置辅助函数
  const triggerSavedIndicator = useCallback(() => {
    setSavedTick(true);
    const timer = setTimeout(() => setSavedTick(false), 1800);
    return () => clearTimeout(timer);
  }, []);

  const updateSetting = useCallback(
    <K extends keyof SettingsData>(key: K, val: SettingsData[K]) => {
      setSettings((prev) => {
        const next = { ...prev, [key]: val };
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
          if (typeof window !== "undefined" && window.furinakit?.applySettings) {
            window.furinakit.applySettings(next as unknown as Record<string, unknown>);
          }
        } catch {}
        return next;
      });
      triggerSavedIndicator();
    },
    [triggerSavedIndicator]
  );

  useEffect(() => {
    if (!open) return;
    const timer = setTimeout(() => {
      const keys = ['furinakit_floatball_reduce_motion','furinakit_floatball_grid','furinakit_floatball_tools','furinakit_floatball_opacity','furinakit_floatball_auto_handoff'];
      // 没存过的项用各自真正的默认值（以前一律补 'true'，会把「减少动态」悄悄写成开启 → 新装机显示成减少动效）
      const defaults: Record<string, string> = {
        furinakit_floatball_reduce_motion: 'false',
        furinakit_floatball_grid: '4',
        furinakit_floatball_tools: JSON.stringify(DEFAULT_TOOL_IDS),
        furinakit_floatball_opacity: '85',
        furinakit_floatball_auto_handoff: 'true',
      };
      const prefs = Object.fromEntries(keys.map(key => [key, localStorage.getItem(key) || defaults[key]]));
      void desktopBridge().syncFloatBallPreferences(prefs);
    }, 80);
    return () => clearTimeout(timer);
  }, [open, floatBallReduceMotion, floatBallGrid, floatBallTools, floatBallOpacity, floatBallAutoHandoff]);

  // 悬浮球设置变更
  const handleToggleFloatBall = useCallback((val: boolean) => {
    setFloatBallEnabled(val);
    localStorage.setItem("furinakit_floatball_enabled", String(val));
    if (window.furinakit?.setFloatBallVisible) {
      window.furinakit.setFloatBallVisible(val);
    }
    triggerSavedIndicator();
  }, [triggerSavedIndicator]);

  const handleChangeFloatBallOpacity = useCallback((val: number) => {
    setFloatBallOpacity(val);
    localStorage.setItem("furinakit_floatball_opacity", String(val));
    window.dispatchEvent(new StorageEvent("storage", { key: "furinakit_floatball_opacity" }));
    triggerSavedIndicator();
  }, [triggerSavedIndicator]);

  const handleToggleToolSelection = useCallback((id: string) => {
    setFloatBallTools((prev) => {
      let next = [...prev];
      if (next.includes(id)) {
        if (next.length <= 1) return prev;
        next = next.filter((t) => t !== id);
      } else {
        if (next.length >= floatBallGrid) return prev;
        next.push(id);
      }
      localStorage.setItem("furinakit_floatball_tools", JSON.stringify(next));
      window.dispatchEvent(new StorageEvent("storage", { key: "furinakit_floatball_tools" }));
      return next;
    });
    triggerSavedIndicator();
  }, [triggerSavedIndicator, floatBallGrid]);

  const handleToggleFloatBallHandoff = useCallback((val: boolean) => {
    setFloatBallAutoHandoff(val);
    localStorage.setItem("furinakit_floatball_auto_handoff", String(val));
    triggerSavedIndicator();
  }, [triggerSavedIndicator]);

  // Persist the existing local preference for native exporters as well; never hide failures.
  useEffect(() => {
    if (!open || !settings.outputDir.trim()) return;
    const timer = setTimeout(() => {
      void ensureOutputDirectory().catch(error => toast({ title: "默认输出目录不可用", description: String(error), variant: "error" }));
    }, 500);
    return () => clearTimeout(timer);
  }, [open, settings.outputDir, toast]);

  // 文件夹选择与打开
  const handleSelectOutputDir = useCallback(() => {
    if (typeof window !== "undefined" && window.furinakit?.selectDirectory) {
      window.furinakit
        .selectDirectory()
        .then((dir) => {
          if (dir && dir.trim()) {
            updateSetting("outputDir", dir.trim());
          }
        })
        .catch(() => {});
    } else {
      const dir = prompt(__ui("请输入输出目录路径:"), settings.outputDir);
      if (dir !== null && dir.trim()) updateSetting("outputDir", dir.trim());
    }
  }, [settings.outputDir, updateSetting]);

  const handleOpenOutputDir = useCallback(() => {
    void openOutputDirectory().catch(error => toast({ title: "无法打开输出目录", description: String(error), variant: "error" }));
  }, [toast]);

  // 清理缓存
  const handleClearCache = useCallback(async () => {
    setClearingCache(true);
    try {
      sessionStorage.clear();
      localStorage.removeItem("furinakit_pending_files");
      await new Promise((r) => setTimeout(r, 600));
      setCacheClearedText("已清理临时缓存与待办队列");
      setTimeout(() => setCacheClearedText(""), 2500);
    } catch {
      setCacheClearedText("清理失败");
    } finally {
      setClearingCache(false);
    }
  }, []);

  // 搜索过滤板块
  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return null;
    return SECTIONS.filter(
      (s) =>
        __ui(s.name).toLowerCase().includes(q) || s.name.toLowerCase().includes(q) ||
        s.enName.toLowerCase().includes(q) ||
        __ui(s.desc).toLowerCase().includes(q) || s.desc.toLowerCase().includes(q)
    );
  }, [searchQuery, __locale]);

  if (!open) return null;

  const currentSectionMeta = SECTIONS.find((s) => s.id === activeSection) || SECTIONS[0];

  return (
    <div
      className="fk-settings-view fixed inset-0 z-50 flex flex-col select-none overflow-hidden"
      style={{
        background: colors.bg,
        color: colors.text,
      }}
    >
      {/* ── 顶部导航栏 ─────────────────────────────────────────────── */}
      <header
        data-tauri-drag-region
        className="relative flex h-14 shrink-0 items-center justify-between border-b px-4 z-20 gap-3 select-none"
        style={{
          borderColor: colors.borderSolid,
          background: colors.card,
          WebkitAppRegion: "drag",
        } as React.CSSProperties}
        onPointerDown={(e) => {
          if (e.button === 0 && (e.target as HTMLElement)?.closest('button, input, textarea, select, [data-tauri-drag-region="false"]') === null) {
            import("@tauri-apps/api/window").then(({ getCurrentWindow }) => getCurrentWindow().startDragging()).catch(() => {});
          }
        }}
      >
        {/* 左侧：返回按钮 + 面包屑 */}
        <div data-tauri-drag-region="false" className="flex items-center gap-2.5 z-10 shrink-0 min-w-0" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <button
            type="button"
            onClick={legalDoc ? () => setLegalDoc(null) : onClose}
            title={legalDoc ? __ui("返回关于界面") : __ui("返回应用主界面 (ESC)")}
            className="flex h-9 items-center gap-2 rounded-xl border px-3 text-[13px] font-medium transition-all shadow-xs active:scale-95 hover:shadow-sm"
            style={{
              borderColor: colors.borderSolid,
              background: colors.bg,
              color: colors.text,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = colors.dropdownHover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = colors.bg)}
          >
            <ArrowLeft size={16} />
            <span>{legalDoc ? __ui("返回上一级") : __ui("返回主页")}</span>
            <kbd className="rounded border px-1.5 py-0.2 text-[10px] font-mono text-muted-foreground" style={{ borderColor: colors.borderSolid }}>
              ESC
            </kbd>
          </button>

          <div className="h-4 w-px bg-border/60 mx-1" />

          <div className="flex items-center gap-1.5 text-[14px] min-w-0 truncate">
            <span className="font-bold text-foreground shrink-0 whitespace-nowrap">{__ui("设置中心")}</span>
            <ChevronRight size={14} className="text-muted-foreground/60 shrink-0" />
            <span className="text-muted-foreground text-[13px] truncate whitespace-nowrap">
              {legalDoc === "statement" ? __ui("程序声明") : legalDoc === "rules" ? __ui("使用规范") : (__locale === "en" && currentSectionMeta.enName ? currentSectionMeta.enName : __msg(currentSectionMeta.name))}
            </span>
          </div>
        </div>

        {/* 中间：全局设置搜索框（流式居中，与左右两侧自适应弹性分离，彻底杜绝重叠） */}
        <div data-tauri-drag-region="false" className="flex-1 flex items-center justify-center min-w-0 px-2 z-10" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <div className="relative w-full max-w-xs">
            <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              if (legalDoc) setLegalDoc(null);
            }}
            placeholder={__ui("搜索设置项（常规、悬浮球、快捷键、模型...）")}
            className="h-8.5 w-full rounded-xl border pl-9 pr-8 text-[12.5px] outline-none transition-all placeholder:text-muted-foreground/70"
            style={{
              background: colors.bg,
              borderColor: colors.borderSolid,
              color: colors.text,
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = "#38bdf8")}
            onBlur={(e) => (e.currentTarget.style.borderColor = colors.borderSolid)}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
            >
              <X size={14} />
            </button>
          )}
          </div>
        </div>

        {/* 右侧：保存状态 + 窗口控制 */}
        <div data-tauri-drag-region="false" className="flex items-center gap-2 shrink-0 z-10" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
          <AnimatePresence>
            {savedTick && (
              <motion.div
                initial={{ opacity: 0, scale: 0.92 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.92 }}
                transition={{ duration: 0.15 }}
                className="flex items-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11.5px] font-medium text-emerald-500 mr-2 shadow-xs"
              >
                <Check size={12} strokeWidth={3} />
                <span>{__ui("已自动保存")}</span>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 窗口控制按钮 */}
          <button
            onClick={() => window.furinakit?.minimize?.()}
            title={__ui("最小化")}
            className="fk-window-control flex h-8 w-8 items-center justify-center rounded-lg border transition-all"
            style={{ borderColor: colors.borderSolid, background: colors.bg, color: colors.text }}
          >
            <Minus size={14} strokeWidth={2.5} />
          </button>
          <button
            onClick={() => window.furinakit?.toggleMaximize?.()}
            title={isMaximized ? __ui("还原") : __ui("最大化")}
            className="fk-window-control flex h-8 w-8 items-center justify-center rounded-lg border transition-all"
            style={{ borderColor: colors.borderSolid, background: colors.bg, color: colors.text }}
          >
            {isMaximized ? <Copy size={12} strokeWidth={2.5} /> : <Square size={12} strokeWidth={2.5} />}
          </button>
          <button
            onClick={onClose}
            title={__ui("关闭设置")}
            className="fk-window-control fk-window-control--close flex h-8 w-8 items-center justify-center rounded-lg border transition-all hover:bg-rose-500 hover:text-white hover:border-rose-500"
            style={{ borderColor: colors.borderSolid, background: colors.bg, color: colors.text }}
          >
            <X size={15} strokeWidth={2.5} />
          </button>
        </div>
      </header>

      {/* ── 主体双栏区域 ───────────────────────────────────────────── */}
      <div className="flex flex-1 min-h-0 w-full overflow-hidden">
        {/* ── 左侧边栏：设置板块列表 ── */}
        <aside
          className={cn(
            __locale === "en" ? "w-[268px]" : "w-52",
            "shrink-0 flex flex-col border-r py-3 px-2 overflow-y-auto thin-scroll transition-[width] duration-150"
          )}
          style={{
            borderColor: colors.borderSolid,
            background: colors.sidebar,
          }}
        >
          <div className="px-3 pb-2.5 pt-1 text-[11.5px] font-bold tracking-wider text-foreground/80 dark:text-foreground/75 uppercase">
            {__ui("设置目录")}</div>

          <div className="space-y-1">
            {SECTIONS.map((sec) => {
              const active = activeSection === sec.id && !legalDoc;
              const Icon = sec.icon;
              const hasBadge =
                (sec.id === "updates" && hasUpdate) ||
                (sec.id === "updates" && myReply !== null);
              const isAbout = sec.id === "updates";

              return (
                <button
                  key={sec.id}
                  type="button"
                  onClick={() => {
                    setActiveSection(sec.id);
                    setSearchQuery("");
                    setLegalDoc(null);
                  }}
                  className={cn(
                    "group relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-all",
                    active
                      ? isAbout
                        ? "bg-sky-500/15 text-sky-500 font-bold shadow-xs border border-sky-500/30"
                        : sec.highlight
                        ? "bg-pink-500/15 text-pink-500 font-bold shadow-xs border border-pink-500/30"
                        : "bg-primary/15 text-primary font-bold shadow-xs border border-primary/30"
                      : isAbout
                      ? "text-sky-500 dark:text-sky-400 font-bold hover:bg-sky-500/10 border border-transparent"
                      : sec.highlight
                      ? "text-pink-500 dark:text-pink-400 font-semibold hover:bg-pink-500/10 border border-transparent"
                      : "text-foreground/85 dark:text-slate-200 font-medium hover:bg-muted/50 hover:text-foreground border border-transparent"
                  )}
                  style={{
                    background: active ? colors.active : undefined,
                    color: active ? (isAbout ? "#0284c7" : sec.highlight ? "#ec4899" : "#38bdf8") : undefined,
                  }}
                >
                  <div
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-transform",
                      active ? "scale-105" : "",
                      isAbout
                        ? "text-sky-500 dark:text-sky-400"
                        : sec.highlight
                        ? "text-pink-500 dark:text-pink-400"
                        : active
                        ? "text-primary"
                        : "text-foreground/70 group-hover:text-foreground"
                    )}
                    style={{ color: active ? (isAbout ? "#0284c7" : sec.highlight ? "#ec4899" : "#38bdf8") : undefined }}
                  >
                    <Icon size={18} fill={sec.highlight ? "currentColor" : "none"} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span
                        title={__locale === "en" && sec.enName ? sec.enName : __msg(sec.name)}
                        className={cn(
                          "text-[13px] truncate",
                          isAbout
                            ? "font-bold text-sky-500 dark:text-sky-400"
                            : sec.highlight
                            ? "font-bold text-pink-500 dark:text-pink-400"
                            : active
                            ? "font-bold text-primary"
                            : "font-medium text-foreground/90 dark:text-slate-100"
                        )}
                      >
                        {__locale === "en" && sec.enName ? sec.enName : __msg(sec.name)}
                      </span>
                      {hasBadge && (
                        <span className="flex h-2 w-2 rounded-full bg-rose-500 ring-2 ring-rose-500/20 animate-pulse shrink-0" />
                      )}
                    </div>

                  </div>
                </button>
              );
            })}
          </div>

        </aside>

        {/* ── 右侧详情内容区 ────────────────────────────────────────── */}
        <main className="flex-1 h-full overflow-y-auto px-8 py-8 thin-scroll" style={{ background: colors.bg }}>
          <div className="mx-auto max-w-4xl space-y-6">
            {/* 搜索模式结果直达列表 */}
            {searchResults ? (
              <div>
                <div className="mb-4">
                  <h2 className="text-[18px] font-bold text-foreground">{__ui("搜索结果")}</h2>
                  <p className="text-[12px] text-muted-foreground">{__ui("找到与 “")}{searchQuery}{__ui("” 相关的板块")}</p>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  {searchResults.map((s) => {
                    const Icon = s.icon;
                    return (
                      <button
                        key={s.id}
                        type="button"
                        onClick={() => {
                          setActiveSection(s.id);
                          setSearchQuery("");
                          setLegalDoc(null);
                        }}
                        className="flex items-start gap-3 rounded-2xl border p-4 text-left transition-all hover:border-primary hover:shadow-sm"
                        style={{
                          background: colors.card,
                          borderColor: colors.borderSolid,
                        }}
                      >
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                          <Icon size={20} />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[14px] font-bold text-foreground">{__locale === "en" && s.enName ? s.enName : __msg(s.name)}</div>
                          <div className="text-[11px] text-muted-foreground mt-0.5">{__ui(s.desc)}</div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : legalDoc === "statement" ? (
              /* ── 详情页：程序声明（完全按照参考图2风格与规范定制） ── */
              <div className="space-y-6 pb-12">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setLegalDoc(null)}
                    className="flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[12px] font-medium transition-all hover:border-primary"
                    style={{ borderColor: colors.borderSolid, background: colors.card }}
                  >
                    <ArrowLeft size={14} />
                    <span>{__ui("返回")}</span>
                  </button>
                  <h2 className="text-[16px] font-bold">{__ui("程序声明")}</h2>
                </div>

                <div className="rounded-3xl border p-7 space-y-6" style={{ background: colors.card, borderColor: colors.borderSolid }}>
                  <div>
                    <h1 className="text-[24px] font-bold text-foreground">{__ui("程序声明")}</h1>
                    <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                      {__ui("本声明适用于")}{__ui(APP_NAME)} Desktop {APP_VERSION} {__ui("及本仓库发布的桌面协同与原生组件，用于说明软件性质、数据边界、第三方依赖与责任范围。使用前请结合实际任务阅读；继续使用即表示你理解本声明所述边界。")}</p>
                  </div>

                  {/* 一、软件性质与开源许可 */}
                  <div className="space-y-2 border-t pt-5" style={{ borderColor: colors.border }}>
                    <h3 className="text-[15px] font-bold text-foreground">{__ui("一、软件性质与开源许可")}</h3>
                    <p className="text-[13px] leading-relaxed text-muted-foreground">
                      {__ui(APP_NAME)} {__ui("Desktop 是面向 Windows 10 / 11（64 位）的免费、本地优先文件工作台与效率工具箱，桌面端已发布源代码遵循开放许可证，你可以在遵守相关开源协议的前提下使用、修改和分发代码。")}</p>
                    <p className="text-[13px] leading-relaxed text-muted-foreground">
                      {__ui(APP_NAME)} {__ui("官网托管服务、域名、服务账号以及")}{__ui(APP_NAME)} {__ui("名称、Logo 和芙宁娜主题视觉标识不因代码开源而自动获得授权。网页端与桌面开源仓库属于相关但边界独立的产品。")}</p>
                  </div>

                  {/* 二、本地文件处理 */}
                  <div className="space-y-2 border-t pt-5" style={{ borderColor: colors.border }}>
                    <h3 className="text-[15px] font-bold text-foreground">{__ui("二、本地文件处理")}</h3>
                    <p className="text-[13px] leading-relaxed text-muted-foreground">
                      {__ui("PDF、图片、音视频、文档格式转换、文本、数理计算、硬件查看和清理等非云端 AI 文件能力默认在用户设备上运行，源文件绝对不会上传到任何服务器。输出文件写入用户选择的本地目录，程序默认不覆盖已有文件。")}</p>
                    <p className="text-[13px] leading-relaxed text-muted-foreground">
                      {__ui("离线文字识别调用本机 OCR 算法；音视频处理会调用本机 FFmpeg；超分画质增强会调用本机 NCNN 神经网络引擎；离线语音转写会调用本机 Whisper 模型。这些处理完全在本机完成。")}</p>
                  </div>

                  {/* 三、AI 与联网边界 */}
                  <div className="space-y-2 border-t pt-5" style={{ borderColor: colors.border }}>
                    <h3 className="text-[15px] font-bold text-foreground">{__ui("三、AI 与联网边界")}</h3>
                    <p className="text-[13px] leading-relaxed text-muted-foreground">
                      {__ui("只有用户主动执行 AI 文字润色、AI 翻译、AI 文档处理或智能对话等功能时，程序才会向用户选择并配置的第三方 AI 服务发起请求。")}</p>
                    <ul className="list-disc pl-5 space-y-1 text-[12.5px] text-muted-foreground leading-relaxed">
                      <li>{__ui("润色、翻译、文档等 AI 能力仅会发送用户当前输入的文字或从本地选定文件提取出的文字；源文件本体不会上传。")}</li>
                      <li>{__ui("语音识别二次润色只发送已识别的字幕文本，绝不发送音频或视频原文件。")}</li>
                      <li>{__ui("第三方 AI 服务如何保存和处理请求，受该服务自己的条款与隐私政策约束，")}{__ui(APP_NAME)} {__ui("无法替代其作出保证。")}</li>
                    </ul>
                  </div>

                  {/* 四、其他网络访问 */}
                  <div className="space-y-2 border-t pt-5" style={{ borderColor: colors.border }}>
                    <h3 className="text-[15px] font-bold text-foreground">{__ui("四、其他网络访问")}</h3>
                    <p className="text-[13px] leading-relaxed text-muted-foreground">
                      {__ui("桌面端不会进行静默行为分析或广告追踪。仅以下操作可能联网：")}</p>
                    <ul className="list-disc pl-5 space-y-1 text-[12.5px] text-muted-foreground leading-relaxed">
                      <li>{__ui("版本检查：仅向更新源发起请求比对最新版本号与发布说明；")}</li>
                      <li>{__ui("按需组件下载：用户主动点击下载 OCR 库、超分引擎或离线语音模型等依赖文件；")}</li>
                      <li>{__ui("建议反馈：用户主动给作者留言或拉取作者对历史建议的答复；")}</li>
                      <li>{__ui("跨设备互传：仅在局域网配对设备间点对点传输，不经公网中转。")}</li>
                    </ul>
                  </div>
                </div>
              </div>
            ) : legalDoc === "rules" ? (
              /* ── 详情页：使用规范（完全按照参考图3风格与规范定制） ── */
              <div className="space-y-6 pb-12">
                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={() => setLegalDoc(null)}
                    className="flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[12px] font-medium transition-all hover:border-primary"
                    style={{ borderColor: colors.borderSolid, background: colors.card }}
                  >
                    <ArrowLeft size={14} />
                    <span>{__ui("返回")}</span>
                  </button>
                  <h2 className="text-[16px] font-bold">{__ui("使用规范")}</h2>
                </div>

                <div className="rounded-3xl border p-7 space-y-6" style={{ background: colors.card, borderColor: colors.borderSolid }}>
                  <div>
                    <h1 className="text-[24px] font-bold text-foreground">{__ui("使用规范")}</h1>
                    <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                      {__ui("本规范说明使用")}{__ui(APP_NAME)} {__ui("Desktop 及相关组件时应遵守的基本规则。无论工具在本地还是通过 AI 服务处理，用户都应确保输入、操作和输出用途合法、安全并获得必要授权。")}</p>
                  </div>

                  {/* 一、合法与授权使用 */}
                  <div className="space-y-2 border-t pt-5" style={{ borderColor: colors.border }}>
                    <h3 className="text-[15px] font-bold text-foreground">{__ui("一、合法与授权使用")}</h3>
                    <ul className="list-disc pl-5 space-y-1.5 text-[12.5px] text-muted-foreground leading-relaxed">
                      <li>{__ui("不得利用本软件制作、处理或传播违法、侵权、欺诈、恶意或危害他人的内容。")}</li>
                      <li>{__ui("处理他人文件、个人信息、商业资料、受版权保护内容或录音录像前，应取得相应授权。")}</li>
                      <li>{__ui("国家秘密、商业机密、医疗、财务、身份凭证等高敏感资料，应使用符合所属组织要求的设备和流程，不应仅依赖通用工具的技术边界。")}</li>
                    </ul>
                  </div>

                  {/* 二、文件处理与输出检查 */}
                  <div className="space-y-2 border-t pt-5" style={{ borderColor: colors.border }}>
                    <h3 className="text-[15px] font-bold text-foreground">{__ui("二、文件处理与输出检查")}</h3>
                    <ul className="list-disc pl-5 space-y-1.5 text-[12.5px] text-muted-foreground leading-relaxed">
                      <li>{__ui("处理重要文件前保留原件和独立备份；不要把唯一副本作为输入。")}</li>
                      <li>{__ui("导出后检查页数、文字、图片、公式、音画同步、压缩质量和目标格式兼容性，再删除原文件。")}</li>
                      <li>{__ui("妥善保管 PDF 加密密码。遗忘密码时，")}{__ui(APP_NAME)} {__ui("不能保证能够恢复内容。")}</li>
                      <li>{__ui("大文件和高分辨率任务会占用较多 CPU、内存和磁盘空间；处理期间避免强制结束程序或拔出存储设备。")}</li>
                    </ul>
                  </div>

                  {/* 三、AI 使用与敏感信息 */}
                  <div className="space-y-2 border-t pt-5" style={{ borderColor: colors.border }}>
                    <h3 className="text-[15px] font-bold text-foreground">{__ui("三、AI 使用与敏感信息")}</h3>
                    <ul className="list-disc pl-5 space-y-1.5 text-[12.5px] text-muted-foreground leading-relaxed">
                      <li>{__ui("不要在提示词、导入文档或对话中粘贴 API Key、账户密码、身份证号、银行卡号或未经授权的敏感信息。")}</li>
                      <li>{__ui("使用前了解所选 AI 服务的地区、计费、内容与隐私政策，并自行承担第三方服务产生的费用。")}</li>
                      <li>{__ui("AI 输出必须人工复核，不得把未经核验的内容直接作为专业结论、正式合同、医疗诊断或财务决策。")}</li>
                      <li>{__ui("不得使用自动化脚本恶意高频调用第三方 AI 服务或依赖镜像。")}</li>
                    </ul>
                  </div>

                  {/* 四、清理、硬件与屏幕取色 */}
                  <div className="space-y-2 border-t pt-5" style={{ borderColor: colors.border }}>
                    <h3 className="text-[15px] font-bold text-foreground">{__ui("四、清理、硬件与屏幕取色")}</h3>
                    <ul className="list-disc pl-5 space-y-1.5 text-[12.5px] text-muted-foreground leading-relaxed">
                      <li>{__ui("临时缓存清理会先扫描本地临时目录，只有用户确认后才会释放。重要工程与资料应当逐项复核。")}</li>
                      <li>{__ui("硬件工具仅用于只读查看系统可返回的信息，不应当被当作专业硬件诊断、超频或安全审计工具。")}</li>
                      <li>{__ui("屏幕取色应只用于用户有权查看的画面。取色完成或不再使用时应退出取色状态，避免误操作。")}</li>
                    </ul>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {/* 顶部板块标题与简介 */}
                <div className="border-b pb-5" style={{ borderColor: colors.border }}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3.5">
                      <div
                        className="flex h-12 w-12 items-center justify-center rounded-2xl shadow-xs"
                        style={{
                          background: currentSectionMeta.highlight ? "#ec489920" : `${colors.gold}20`,
                          color: currentSectionMeta.highlight ? "#ec4899" : colors.gold,
                        }}
                      >
                        <currentSectionMeta.icon size={26} fill={currentSectionMeta.highlight ? "currentColor" : "none"} />
                      </div>
                      <div>
                        <h1 className="text-[22px] font-bold tracking-tight" style={{ color: colors.text }}>
                          {__msg(currentSectionMeta.name)}
                        </h1>
                        <p className="text-[12.5px] text-muted-foreground mt-0.5">{__ui(currentSectionMeta.desc)}</p>
                      </div>
                    </div>
                  </div>
                </div>

                {/* ── 板块一：常规与系统设置 ── */}
                {activeSection === "general" && (
                  <div className="space-y-4">
                    <section className="fk-language-card rounded-2xl border p-5 shadow-xs" style={{background:colors.card,borderColor:colors.borderSolid}} aria-labelledby="fk-language-heading">
                      <div className="flex min-w-0 flex-wrap items-start justify-between gap-4">
                        <div className="flex min-w-0 flex-1 items-start gap-3.5">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/40 bg-muted/70"><LanguageIcon size={21}/></span>
                          <div className="min-w-0">
                            <h3 id="fk-language-heading" className="text-[14.5px] font-bold">{__ui("界面语言")}</h3>
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{__locale === "en" ? "Changes apply to every FurinaKit window without restarting." : "切换会同步到所有 FurinaKit 窗口，无需重启。"}</p>
                            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{__ui("切换界面语言，不会翻译或修改你的文件、输入内容和历史记录。")}</p>
                          </div>
                        </div>
                        <label className="block w-full max-w-[230px] shrink-0">
                          <span className="sr-only">{__ui("界面语言")}</span>
                          <RoundedSelect value={__locale} disabled={savingLanguage} onChange={e=>void changeLanguage(e.target.value)} className="w-full">
                            <option value="zh-CN">简体中文</option>
                            <option value="en">English</option>
                          </RoundedSelect>
                        </label>
                      </div>
                      {savingLanguage&&<p className="mt-3 text-xs text-muted-foreground" role="status">{__ui("正在保存语言设置…")}</p>}
                      {languageError&&<p className="mt-3 break-words text-xs text-destructive" role="alert">{__ui("语言设置保存失败")} · {__msg(languageError)}</p>}
                    </section>
                    {/* 开机自启动 */}
                    <div
                      className="rounded-2xl border p-5 transition-all shadow-xs"
                      style={{ background: colors.card, borderColor: colors.borderSolid }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3.5">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/70 text-foreground/80 border border-border/40">
                            <Power size={20} />
                          </div>
                          <div>
                            <div className="text-[14.5px] font-bold" style={{ color: colors.text }}>
                              {__ui("开机自启动")}</div>
                            <div className="text-[12px] text-muted-foreground mt-0.5">
                              {__ui("开启后，Windows 登录系统时自动静默启动 FurinaKit，随时准备调用")}</div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => updateSetting("autoStart", !settings.autoStart)}
                          className="relative h-6 w-11 shrink-0 overflow-hidden rounded-full transition-colors"
                          style={{ background: settings.autoStart ? colors.gold : colors.mutedDark }}
                        >
                          <span
                            className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-200"
                            style={{
                              transform: settings.autoStart ? "translateX(22px)" : "translateX(2px)",
                              left: 0,
                            }}
                          />
                        </button>
                      </div>
                    </div>

                    {/* 关闭主窗口时动作 */}
                    <div
                      className="rounded-2xl border p-5 transition-all shadow-xs"
                      style={{ background: colors.card, borderColor: colors.borderSolid }}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex items-center gap-3.5">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/70 text-foreground/80 border border-border/40">
                            <LogOut size={20} />
                          </div>
                          <div>
                            <div className="text-[14.5px] font-bold" style={{ color: colors.text }}>
                              {__ui("关闭主窗口时的行为")}</div>
                            <div className="text-[12px] text-muted-foreground mt-0.5">
                              {__ui("点击窗口右上角关闭按钮 (✕) 时，选择保持常驻托盘或彻底释放进程")}</div>
                          </div>
                        </div>

                        <div
                          className="flex items-center gap-1.5 rounded-xl p-1 shrink-0"
                          style={{ background: colors.bg, border: `1px solid ${colors.borderSolid}` }}
                        >
                          <button
                            type="button"
                            onClick={() => updateSetting("closeAction", "tray")}
                            className={cn(
                              "rounded-lg px-3.5 py-1.5 text-[12px] font-semibold transition-all",
                              settings.closeAction === "tray" ? "shadow-xs text-white" : "text-muted-foreground hover:text-foreground"
                            )}
                            style={{
                              background: settings.closeAction === "tray" ? colors.gold : "transparent",
                              color: settings.closeAction === "tray" ? colors.onGold : undefined,
                            }}
                          >
                            {__ui("最小化到托盘")}</button>
                          <button
                            type="button"
                            onClick={() => updateSetting("closeAction", "quit")}
                            className={cn(
                              "rounded-lg px-3.5 py-1.5 text-[12px] font-semibold transition-all",
                              settings.closeAction === "quit" ? "shadow-xs text-white" : "text-muted-foreground hover:text-foreground"
                            )}
                            style={{
                              background: settings.closeAction === "quit" ? colors.gold : "transparent",
                              color: settings.closeAction === "quit" ? colors.onGold : undefined,
                            }}
                          >
                            {__ui("彻底退出软件")}</button>
                        </div>
                      </div>
                    </div>

                    {/* 默认输出目录 */}
                    <div
                      className="rounded-2xl border p-5 transition-all shadow-xs"
                      style={{ background: colors.card, borderColor: colors.borderSolid }}
                    >
                      <div className="mb-3 flex items-center justify-between">
                        <div className="flex items-center gap-3.5">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/70 text-foreground/80 border border-border/40">
                            <Folder size={20} />
                          </div>
                          <div>
                            <div className="text-[14.5px] font-bold" style={{ color: colors.text }}>
                              {__ui("默认输出目录")}</div>
                            <div className="text-[12px] text-muted-foreground mt-0.5">
                              {__ui("格式转换、超分强化、视频导出等工具产物文件的保存位置")}</div>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 mt-4">
                        <input
                          type="text"
                          value={settings.outputDir}
                          onChange={(e) => updateSetting("outputDir", e.target.value)}
                          placeholder={__ui("默认保存在系统下载目录或对应工具指定位置")}
                          className="flex-1 rounded-xl border px-3.5 py-2.5 text-[13px] outline-none transition-all"
                          style={{
                            background: colors.bg,
                            borderColor: colors.borderSolid,
                            color: colors.text,
                          }}
                          onFocus={(e) => (e.currentTarget.style.borderColor = "#38bdf8")}
                          onBlur={(e) => (e.currentTarget.style.borderColor = colors.borderSolid)}
                        />
                        <button
                          type="button"
                          onClick={handleSelectOutputDir}
                          className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl border px-4 text-[13px] font-medium transition-all shadow-xs hover:border-primary"
                          style={{
                            background: colors.card,
                            borderColor: colors.borderSolid,
                            color: colors.text,
                          }}
                        >
                          <FolderOpen size={16} />
                          {__ui("浏览目录")}</button>
                        <button
                          type="button"
                          onClick={handleOpenOutputDir}
                          className="flex h-10 shrink-0 items-center gap-1.5 rounded-xl border px-4 text-[13px] font-medium transition-all shadow-xs hover:border-primary"
                          style={{
                            background: colors.card,
                            borderColor: colors.borderSolid,
                            color: colors.text,
                          }}
                        >
                          <ExternalLink size={15} className="text-amber-500" />
                          {__ui("打开")}</button>
                      </div>
                    </div>

                    {/* 操作完成通知 */}
                    <div
                      className="rounded-2xl border p-5 transition-all shadow-xs"
                      style={{ background: colors.card, borderColor: colors.borderSolid }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3.5">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/70 text-foreground/80 border border-border/40">
                            <Bell size={20} />
                          </div>
                          <div>
                            <div className="text-[14.5px] font-bold" style={{ color: colors.text }}>
                              {__ui("任务完成时通知")}</div>
                            <div className="text-[12px] text-muted-foreground mt-0.5">
                              {__ui("耗时较长的批量压缩、模型生成等任务完成时，通过系统通知提醒")}</div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => updateSetting("notifyOnComplete", !settings.notifyOnComplete)}
                          className="relative h-6 w-11 shrink-0 overflow-hidden rounded-full transition-colors"
                          style={{ background: settings.notifyOnComplete ? colors.gold : colors.mutedDark }}
                        >
                          <span
                            className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-200"
                            style={{
                              transform: settings.notifyOnComplete ? "translateX(22px)" : "translateX(2px)",
                              left: 0,
                            }}
                          />
                        </button>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── 板块二：外观与主题 ── */}
                {activeSection === "appearance" && (
                  <div className="space-y-5">
                    {/* 视觉模式卡片选择 */}
                    <div
                      className="rounded-2xl border p-5 transition-all shadow-xs"
                      style={{ background: colors.card, borderColor: colors.borderSolid }}
                    >
                      <div className="mb-4">
                        <h3 className="text-[14.5px] font-bold" style={{ color: colors.text }}>
                          {__ui("视觉色彩模式")}</h3>
                        <p className="text-[12px] text-muted-foreground mt-0.5">
                          {__ui("精心调配的 4 种视觉模式，适配不同光照环境与护眼需求")}</p>
                      </div>

                      <div className="grid grid-cols-4 gap-3">
                        {[
                          { id: "dark", label: "深色模式", sub: "深邃优雅", icon: Moon, bg: "#151517", fg: "#f9fafb" },
                          { id: "light", label: "浅色模式", sub: "清晰清爽", icon: Sun, bg: "#f1f5f9", fg: "#1e293b" },
                          { id: "eye-care", label: "护眼暖色", sub: "舒缓低蓝光", icon: Eye, bg: "#fbf0d9", fg: "#3f2c1d" },
                          { id: "system", label: "跟随系统", sub: "自动动态同步", icon: Monitor, bg: "#1e293b", fg: "#f8fafc" },
                        ].map((m) => {
                          const isSelected = themeMode === m.id;
                          const Icon = m.icon;
                          return (
                            <button
                              key={m.id}
                              type="button"
                              onClick={() => setTheme(m.id as ThemeMode)}
                              className={cn(
                                "group relative flex flex-col items-center rounded-2xl border p-4 text-center transition-all",
                                isSelected
                                  ? "border-sky-400 ring-2 ring-sky-400/30 shadow-md scale-[1.02]"
                                  : "border-border/60 hover:border-border hover:bg-muted/30"
                              )}
                              style={{ background: colors.bg }}
                            >
                              <div
                                className="flex h-10 w-10 items-center justify-center rounded-xl mb-3 transition-transform group-hover:scale-110"
                                style={{ background: m.bg, color: m.fg, border: `1px solid ${colors.borderSolid}` }}
                              >
                                <Icon size={20} />
                              </div>
                              <span className="text-[13.5px] font-bold" style={{ color: isSelected ? "#38bdf8" : colors.text }}>
                                {__ui(m.label)}
                              </span>
                              <span className="text-[11px] text-muted-foreground mt-0.5">{m.sub}</span>
                              {isSelected && (
                                <div className="absolute top-2.5 right-2.5 flex h-4.5 w-4.5 items-center justify-center rounded-full bg-sky-400 text-slate-950 font-bold">
                                  <Check size={11} strokeWidth={3} />
                                </div>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <p className="px-2 pt-4 text-sm leading-7 text-muted-foreground">{__ui("后续更新可能会加入可供自行开关的芙宁娜元素外观，敬请期待！")}</p>
                  </div>
                )}

                {/* ── 板块三：桌面悬浮球 ── */}
                {activeSection === "floatball" && (
                  <div className="space-y-4">
                    {/* 悬浮球总开关 */}
                    <div
                      className="rounded-2xl border p-5 transition-all shadow-xs"
                      style={{ background: colors.card, borderColor: colors.borderSolid }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3.5">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/70 text-foreground/80 border border-border/40">
                            <CircleDot size={20} />
                          </div>
                          <div>
                            <div className="text-[14.5px] font-bold" style={{ color: colors.text }}>
                              {__ui("启用桌面悬浮球")}</div>
                            <div className="text-[12px] text-muted-foreground mt-0.5">
                              {__ui("常驻桌面边缘，提供平滑拖拽、水波纹灵动交互与 4/6 格快捷小面板")}</div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleToggleFloatBall(!floatBallEnabled)}
                          className="relative h-6 w-11 shrink-0 overflow-hidden rounded-full transition-colors"
                          style={{ background: floatBallEnabled ? colors.gold : colors.mutedDark }}
                        >
                          <span
                            className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-200"
                            style={{
                              transform: floatBallEnabled ? "translateX(22px)" : "translateX(2px)",
                              left: 0,
                            }}
                          />
                        </button>
                      </div>
                    </div>

                    {/* 磨砂玻璃透明度 */}
                    {floatBallEnabled && (
                      <div
                        className="rounded-2xl border p-5 transition-all shadow-xs"
                        style={{ background: colors.card, borderColor: colors.borderSolid }}
                      >
                        <div className="mb-3 flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-400">
                              <Sliders size={18} />
                            </div>
                            <div>
                              <div className="text-[14px] font-bold" style={{ color: colors.text }}>
                                {__ui("展开面板小窗格透明度")}</div>
                              <div className="text-[11.5px] text-muted-foreground">
                                {__ui("调节快捷面板在桌面展开时的背景通透感")}</div>
                            </div>
                          </div>
                          <span className="font-mono text-[14px] font-bold text-sky-400">
                            {floatBallOpacity}%
                          </span>
                        </div>

                        <div className="pt-2">
                          <input
                            type="range"
                            min="50"
                            max="100"
                            step="5"
                            value={floatBallOpacity}
                            onChange={(e) => handleChangeFloatBallOpacity(Number(e.target.value))}
                            className="h-2 w-full cursor-pointer appearance-none rounded-lg bg-slate-700 accent-sky-400"
                          />
                          <div className="flex justify-between text-[10.5px] text-muted-foreground mt-1.5 font-mono">
                            <span>{__ui("50% 半透明透光")}</span>
                            <span>{__ui("85% 推荐")}</span>
                            <span>{__ui("100% 实体纯色")}</span>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 常用工具自定义选择：支持从全部工具中自由挑选 */}
                    {floatBallEnabled && (
                      <div
                        className="fbs-editor rounded-2xl border p-5"
                        style={{ background: colors.card, borderColor: colors.borderSolid }}
                      >
                        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
                          <div>
                            <div className="text-[14.5px] font-bold" style={{ color: colors.text }}>
                              {__ui("自定义常用工具")}</div>
                            <div className="text-[11.5px] text-muted-foreground mt-0.5">
                              {__ui("当前已勾选")}{floatBallTools.length} {__ui("个（")}{floatBallTools.length === 4
                                ? __ui("4 格紧凑方阵")
                                : floatBallTools.length === 6
                                ? __ui("6 格紧凑方阵")
                                : floatBallTools.length === 9 ? __ui("9 格九宫格")
                                : __ui("未选满时，空位将自动补齐默认工具")}
                              ）
                            </div>
                          </div>

                          <span
                            className={cn(
                              "self-start sm:self-auto rounded-full px-2.5 py-0.5 text-[11px] font-semibold font-mono",
                              floatBallTools.length === floatBallGrid
                                ? "bg-emerald-500/15 text-emerald-500 border border-emerald-500/30"
                                : "bg-amber-500/15 text-amber-500 border border-amber-500/30"
                            )}
                          >
                            {__ui("已选")}{floatBallTools.length}/{floatBallGrid}
                          </span>
                        </div>

                        <div className="fbs-options">
                          <div className="fbs-option-row">
                            <div className="fbs-option-label">{__ui("窗格布局")}<span>{__ui("选择工具的排列方式")}</span></div>
                            <div className="fbs-segments fbs-layouts" role="group" aria-label={__ui("悬浮窗格布局")}>
                              {[4,6,9].map(count=><button key={count} type="button" aria-pressed={floatBallGrid===count}
                                onClick={()=>{setFloatBallGrid(count);localStorage.setItem('furinakit_floatball_grid',String(count));
                                  const next=floatBallTools.slice(0,count);setFloatBallTools(next);localStorage.setItem('furinakit_floatball_tools',JSON.stringify(next));triggerSavedIndicator();}}>
                                <span className="fbs-layout-symbol" style={{gridTemplateColumns:`repeat(${count===4?2:3},4px)`}} aria-hidden="true">{Array.from({length:count},(_,i)=><i key={i}/>)}</span>
                                <span>{count} {__ui("格")}</span>
                              </button>)}
                            </div>
                          </div>
                          <div className="fbs-option-row">
                            <div className="fbs-option-label">{__ui("交互动效")}<span>{__ui("仅影响悬浮球，不修改系统设置")}</span></div>
                            <div className="fbs-segments" role="group" aria-label={__ui("悬浮球动态效果")}>
                              {[false,true].map(reduced=><button key={String(reduced)} type="button" aria-pressed={floatBallReduceMotion===reduced}
                                onClick={()=>{setFloatBallReduceMotion(reduced);localStorage.setItem('furinakit_floatball_reduce_motion',String(reduced));triggerSavedIndicator();}}>
                                {reduced?<CircleDot size={14}/>:<Sparkles size={14}/>}<span>{reduced?__ui("减少动态"):__ui("完整动效")}</span>
                              </button>)}
                            </div>
                          </div>
                        </div>
                        {/* 已选工具快速托盘 */}
                        <div className="fbs-selected-tray">
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="text-[12px] font-bold text-foreground">{__ui("已选工具")}</span>
                              <span className="text-[11px] text-muted-foreground font-mono">{__ui("点击 × 移出")}</span>
                            </div>
                            <span className="fbs-tray-count">
                              {floatBallTools.length} / {floatBallGrid}
                            </span>
                          </div>

                          <div className="flex flex-wrap gap-2">
                            {floatBallTools.map((id) => {
                              const t = allAvailableTools.find((item) => item.id === id) || ALL_CONFIGURABLE_TOOLS.find((item) => item.id === id);
                              const Icon = getToolIcon(allAvailableTools.find(item=>item.id===id)?.icon || "Wrench");
                              return (
                                <div
                                  key={id}
                                  className="fbs-selected-chip"
                                >
                                  <Icon size={14} className="shrink-0" />
                                  <span className="max-w-[120px] truncate">{t?.name || id}</span>
                                  <button
                                    type="button"
                                    onClick={() => handleToggleToolSelection(id)}
                                    className="fbs-chip-remove"
                                    title={__ui("移除此工具")} aria-label={__msg("移除{0}", t?.name || id)}
                                  >
                                    <X size={12} />
                                  </button>
                                </div>
                              );
                            })}
                            {floatBallTools.length === 0 && (
                              <div className="text-[12px] text-muted-foreground py-1">
                                {__ui("暂未选择任何工具，请在下方全部工具库中点击勾选")}</div>
                            )}
                          </div>
                        </div>

                        <ToolChooser selected={floatBallTools} onChoose={handleToggleToolSelection} multiple limit={floatBallGrid}/>

                      </div>
                    )}

                    {/* 拖入文件自动装填待办 */}
                    {floatBallEnabled && (
                      <div
                        className="rounded-2xl border p-5 transition-all shadow-xs"
                        style={{ background: colors.card, borderColor: colors.borderSolid }}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3.5">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/70 text-foreground/80 border border-border/40">
                              <Layers size={20} />
                            </div>
                            <div>
                              <div className="text-[14.5px] font-bold" style={{ color: colors.text }}>
                                {__ui("文件拖拽待办与智能工具推荐")}</div>
                              <div className="text-[12px] text-muted-foreground mt-0.5">
                                {__ui("将 PDF、图片、视频拖入悬浮球时，自动推荐对应工具并在打开后秒级自动装配文件")}</div>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => handleToggleFloatBallHandoff(!floatBallAutoHandoff)}
                            className="relative h-6 w-11 shrink-0 overflow-hidden rounded-full transition-colors"
                            style={{ background: floatBallAutoHandoff ? colors.gold : colors.mutedDark }}
                          >
                            <span
                              className="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-md transition-transform duration-200"
                              style={{
                                transform: floatBallAutoHandoff ? "translateX(22px)" : "translateX(2px)",
                                left: 0,
                              }}
                            />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {activeSection === "shortcuts" && <ShortcutSettings />}

                {activeSection === "ai" && (
                  <div className="space-y-4">
                    <div
                      className="rounded-2xl border p-5 transition-all shadow-xs"
                      style={{ background: colors.card, borderColor: colors.borderSolid }}
                    >
                      <div className="mb-4">
                        <div className="flex items-center gap-2">
                          <h3 className="text-[15px] font-bold" style={{ color: colors.text }}>
                            {__ui("大模型 API 服务配置")}</h3>
                          <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-semibold text-emerald-500">
                            {__ui("保存在本机")}</span>
                        </div>
                        <p className="text-[12px] text-muted-foreground mt-1">
                          {__ui("支持 DeepSeek、OpenAI、智谱清言、本地 Ollama，以及自定义的 OpenAI 兼容服务")}</p>
                      </div>

                      <AiConfigPanel compact={false} />
                    </div>
                  </div>
                )}

                {/* ── 板块六：组件与存储空间 ── */}
                {activeSection === "components" && (
                  <div className="space-y-5">
                    {/* 按需下载离线组件 */}
                    <div
                      className="rounded-2xl border p-5 transition-all shadow-xs"
                      style={{ background: colors.card, borderColor: colors.borderSolid }}
                    >
                      <div className="mb-4">
                        <h3 className="text-[15px] font-bold" style={{ color: colors.text }}>
                          {__ui("按需离线引擎与模型")}</h3>
                      </div>

                      <ComponentsManager />
                    </div>

                    {/* 缓存清理与存储分析 */}
                    <div
                      className="rounded-2xl border p-5 transition-all shadow-xs"
                      style={{ background: colors.card, borderColor: colors.borderSolid }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3.5">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-muted/70 text-foreground/80 border border-border/40">
                            <Trash2 size={20} />
                          </div>
                          <div>
                            <div className="text-[14.5px] font-bold" style={{ color: colors.text }}>
                              {__ui("临时缓存与待办队列清理")}</div>
                            <div className="text-[12px] text-muted-foreground mt-0.5">
                              {__ui("清理已完成任务的预览缓存、历史 Base64 待办流，释放系统内存与磁盘")}</div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          {cacheClearedText && (
                            <span className="text-[12px] font-medium text-emerald-500 flex items-center gap-1">
                              <Check size={13} strokeWidth={3} />
                              {cacheClearedText}
                            </span>
                          )}
                          <button
                            type="button"
                            onClick={handleClearCache}
                            disabled={clearingCache}
                            className="flex h-9 items-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-500/10 px-4 text-[12.5px] font-semibold text-rose-500 transition-all hover:bg-rose-500/20 active:scale-95"
                          >
                            <Trash2 size={14} />
                            {clearingCache ? __ui("正在清理…") : __ui("一键清理缓存")}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ── 板块七：版本更新与自检 ── */}
                {activeSection === "updates" && (
                  <div className="space-y-4">
                    {/* 版本更新卡片 */}
                    <div
                      className={cn(
                        "rounded-2xl border p-5 transition-all shadow-xs",
                        hasUpdate
                          ? "border-sky-400/50 bg-gradient-to-r from-sky-500/10 via-sky-500/5 to-transparent"
                          : ""
                      )}
                      style={{
                        background: hasUpdate ? undefined : colors.card,
                        borderColor: hasUpdate ? undefined : colors.borderSolid,
                      }}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div className="flex items-center gap-3.5 min-w-0">
                          <div
                            className={cn(
                              "flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl shadow-xs",
                              hasUpdate ? "bg-sky-400 text-slate-950 font-bold" : "bg-sky-500/10 text-sky-400"
                            )}
                          >
                            {hasUpdate ? <ArrowUpCircle size={26} className="animate-pulse" /> : <Sparkles size={24} />}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-[16px] font-bold tracking-tight" style={{ color: colors.text }}>
                                {__ui(APP_NAME)}
                              </span>
                              <span className="inline-flex items-center rounded-md border border-sky-400/30 bg-sky-400/10 px-2 py-0.5 text-[11px] font-mono font-semibold text-sky-400">
                                v{APP_VERSION}
                              </span>
                            </div>
                            <p className="mt-1 text-[12.5px] text-muted-foreground">
                              {hasUpdate ? __ui("🎉 云端发现全新版本，包含新功能与稳定性优化！") : __ui("当前已是最新发布版本，环境运行正常")}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2.5 shrink-0">

                          <button
                            type="button"
                            onClick={() => {
                              setUpdateTab("check");
                              setUpdateOpen(true);
                            }}
                            className={cn(
                              "inline-flex h-9 items-center gap-1.5 rounded-xl px-4 text-[12.5px] font-semibold transition-all shadow-xs active:scale-95",
                              hasUpdate
                                ? "bg-sky-400 text-slate-950 hover:brightness-105"
                                : "border hover:border-sky-400 text-sky-400 hover:bg-sky-500/5"
                            )}
                            style={{ borderColor: hasUpdate ? undefined : colors.borderSolid }}
                          >
                            <RefreshCw size={14} className={hasUpdate ? "animate-spin-slow" : ""} />
                            {hasUpdate ? __ui("查看新版本") : __ui("检查更新")}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* 作者回复高亮卡片（如果有回复） */}
                    {myReply && (
                      <div className="rounded-2xl border-2 border-emerald-500/45 bg-emerald-500/[0.09] p-4 shadow-sm">
                        <div className="flex items-start gap-3.5">
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-500">
                            <MessageSquareHeart size={22} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-[15px] font-bold text-emerald-600 dark:text-emerald-400">{__ui("芙芙回复你啦！")}</span>
                              {myReply.status && (
                                <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                                  {__msg(myReply.status)}
                                </span>
                              )}
                              {myReply.at && <span className="text-[11px] text-muted-foreground">{myReply.at}</span>}
                            </div>
                            <p className="mt-2 text-[13px] leading-relaxed text-foreground whitespace-pre-wrap">{myReply.text}</p>
                            <div className="mt-3 flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => {
                                  markReplySeen();
                                  setMyReply(null);
                                }}
                                className="inline-flex h-7 items-center rounded-lg bg-emerald-500 px-3 text-[11.5px] font-semibold text-white hover:opacity-90"
                              >
                                {__ui("我知道了")}</button>
                              <button
                                type="button"
                                onClick={() => setFeedbackOpen(true)}
                                className="inline-flex h-7 items-center rounded-lg border border-border px-3 text-[11.5px] font-medium text-muted-foreground hover:bg-muted"
                              >
                                {__ui("再提一条建议")}</button>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* 直通作者留言 */}
                    <div
                      className="flex items-center justify-between rounded-2xl border p-5 transition-all shadow-xs border-primary/30 bg-gradient-to-r from-primary/10 via-primary/5 to-transparent"
                    >
                      <div className="flex items-center gap-3.5 min-w-0">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/20 text-primary">
                          <MessageSquareHeart size={22} />
                        </div>
                        <div className="min-w-0">
                          <div className="text-[15px] font-bold" style={{ color: colors.text }}>
                            {__ui("对芙芙说的话 / 工具心愿单")}</div>
                          <div className="text-[12px] text-muted-foreground mt-0.5">
                            {__ui("有什么想要新增的工具、功能建议或改进意见，直接留言提交给作者")}</div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => setFeedbackOpen(true)}
                        className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-4 text-[12.5px] font-bold text-primary-foreground transition-all hover:opacity-90 active:scale-95 shrink-0 shadow-xs ml-3"
                      >
                        <MessageSquareHeart size={15} />
                        {__ui("给芙芙留言")}</button>
                    </div>

                    {/* 一键自检修复 */}
                    <div
                      className="rounded-2xl border p-5 transition-all shadow-xs"
                      style={{ background: colors.card, borderColor: colors.borderSolid }}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3.5 min-w-0">
                          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-amber-500/15 text-amber-500">
                            <Wrench size={22} />
                          </div>
                          <div className="min-w-0">
                            <div className="text-[15px] font-bold" style={{ color: colors.text }}>
                              {__ui("系统环境一键自检与自动修复")}</div>
                            <div className="text-[12px] text-muted-foreground mt-0.5">
                              {__ui("扫描本地后台服务进程、超分引擎、端口冲突与依赖文件完整性，出现故障时秒级一键修护")}</div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => setRepairOpen(true)}
                          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-amber-400 px-4 text-[12.5px] font-bold text-neutral-900 transition-all hover:brightness-105 active:scale-95 shrink-0 shadow-xs ml-3"
                        >
                          <Wrench size={14} />
                          {__ui("开始环境检测")}</button>
                      </div>
                    </div>
                    <section className="rounded-2xl border p-5 shadow-xs" style={{background:colors.card,borderColor:colors.borderSolid}}>
                      <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><h3 className="flex items-center gap-2 text-base font-bold"><FileText size={19} className="text-sky-500"/>{__ui("更新日志")}</h3><label className="flex items-center gap-2 text-sm text-muted-foreground">{__ui("版本")}<RoundedSelect aria-label={__ui("选择更新日志版本")} className="rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground" value={logVersion} onChange={e=>setLogVersion(e.target.value)}>{APP_CHANGELOG.map(log=><option key={log.version} value={log.version}>v{log.version} · {log.releaseDate}</option>)}</RoundedSelect></label></div>
                      {selectedLog&&<article key={selectedLog.version}><div className="mb-3 flex items-center gap-3"><span className="rounded-lg bg-sky-500/10 px-3 py-1 text-sm font-semibold text-sky-500">v{selectedLog.version}</span><time className="text-sm text-muted-foreground">{selectedLog.releaseDate}</time></div><h4 className="mb-4 text-[17px] font-semibold leading-relaxed">{__msg(selectedLog.title)}</h4><ul className="list-disc space-y-3 pl-5 text-[15px] leading-7 text-foreground/85">{selectedLog.highlights.map((item,i)=><li key={i}>{__msg(item)}</li>)}</ul>{selectedLog.details.length>0&&<details className="mt-5 border-t border-border pt-4"><summary className="cursor-pointer text-sm font-medium text-sky-500">{__ui("本版本详细记录")}</summary><div className="mt-4 space-y-5">{selectedLog.details.map(group=><section key={group.category}><h5 className="mb-2 text-[15px] font-semibold">{__msg(group.category)}</h5><ul className="list-disc space-y-2 pl-5 text-[14px] leading-7 text-muted-foreground">{group.items.map((text,i)=><li key={i}>{__msg(text)}</li>)}</ul></section>)}</div></details>}</article>}
                    </section>
                  </div>
                )}

                {/* ── 板块八：关于 ── */}
                {activeSection === "about" && (
                  <div className="space-y-4">
                    <OpenSourceLicenses/>
                    {/* 软件主关于卡片 */}
                    <div
                      className="rounded-2xl border p-6 transition-all shadow-xs"
                      style={{ background: colors.card, borderColor: colors.borderSolid }}
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-4">
                          <img
                            src="/furina-logo.png"
                            alt="FurinaKit"
                            className="h-14 w-14 rounded-2xl object-cover shadow-sm ring-1 ring-sky-400/30 shrink-0"
                          />
                          <div>
                            <div className="flex items-center gap-2">
                              <h3 className="text-[17px] font-bold text-foreground">{__ui(APP_NAME)} {__ui("桌面端")}</h3>
                              <span className="rounded-md border border-sky-400/30 bg-sky-400/10 px-2 py-0.5 text-[11px] font-mono font-bold text-sky-400">
                                v{APP_VERSION}
                              </span>

                            </div>
                            <p className="text-[12.5px] text-muted-foreground mt-1">
                              {__ui("现代化多功能桌面工具箱 · 极速轻量 · 100% 隐私安全保护")}</p>

                          </div>
                        </div>
                      </div>

                      {/* 用户指定特性胶囊徽章（图1）：无需登录 · 数据私有 · 本地保存 */}
                      <div className="flex flex-wrap items-center gap-2.5 mt-4 pt-4 border-t" style={{ borderColor: colors.border }}>
                        <div className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 px-3 py-1 text-[12px] font-medium text-emerald-600 dark:text-emerald-400 shadow-2xs">
                          <UserCheck size={14} className="stroke-[2.2]" />
                          <span>{__ui("无需登录")}</span>
                        </div>
                        <div className="inline-flex items-center gap-1.5 rounded-full bg-blue-500/10 border border-blue-500/25 px-3 py-1 text-[12px] font-medium text-blue-600 dark:text-blue-400 shadow-2xs">
                          <ShieldCheck size={14} className="stroke-[2.2]" />
                          <span>{__ui("数据私有")}</span>
                        </div>
                        <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 border border-amber-500/25 px-3 py-1 text-[12px] font-medium text-amber-600 dark:text-amber-500 shadow-2xs">
                          <HardDrive size={14} className="stroke-[2.2]" />
                          <span>{__ui("本地保存")}</span>
                        </div>
                      </div>
                    </div>

                    {/* 安全治理与技术合规专区（全新原创 Bento Card 布局，彻底摆脱旧版单一卡片抄袭感） */}
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between px-1">
                        <div>
                          <div className="text-[14px] font-bold text-foreground">{__ui("技术治理与合规准则")}</div>
                          <div className="text-[11.5px] text-muted-foreground">{__ui("严格遵循纯本地离线处理原则与开源技术协议，保障您的数字资产权利")}</div>
                        </div>
                      </div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                        {/* 声明卡片 */}
                        <div
                          className="group relative flex flex-col justify-between rounded-2xl border p-5 transition-all shadow-xs hover:border-sky-400/60 hover:shadow-md"
                          style={{ background: colors.card, borderColor: colors.borderSolid }}
                        >
                          <div>
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/15 text-sky-400 group-hover:scale-105 transition-transform">
                                <FileCode2 size={19} />
                              </div>
                              <span className="rounded-full bg-sky-500/10 border border-sky-500/25 px-2.5 py-0.5 text-[10.5px] font-semibold text-sky-400">
                                {__ui("架构与协议")}</span>
                            </div>
                            <h4 className="text-[14.5px] font-bold text-foreground group-hover:text-sky-400 transition-colors">
                              {__ui("程序与技术声明")}</h4>
                            <p className="text-[12px] text-muted-foreground mt-1.5 leading-relaxed">
                              {__ui("基于 Tauri v2 纯本地引擎，FFmpeg 音视频转换、OCR 提取与 AI 模型推演均在您本地设备直接运行，不设任何中心化收集节点。")}</p>
                            <div className="flex flex-wrap gap-1.5 mt-3 pt-2 border-t border-border/40">
                              <span className="rounded-md bg-muted/60 px-2 py-0.5 text-[10.5px] text-muted-foreground font-mono">{__ui("100% 本地运算")}</span>
                              <span className="rounded-md bg-muted/60 px-2 py-0.5 text-[10.5px] text-muted-foreground font-mono">{__ui("MIT/Apache 遵循")}</span>
                              <span className="rounded-md bg-muted/60 px-2 py-0.5 text-[10.5px] text-muted-foreground font-mono">{__ui("Key 本机保存")}</span>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => setLegalDoc("statement")}
                            className="mt-4 flex items-center justify-between rounded-xl border border-sky-400/30 bg-sky-500/5 px-4 py-2.5 text-[12px] font-semibold text-sky-400 transition-all hover:bg-sky-500/15 active:scale-98 cursor-pointer"
                          >
                            <span>{__ui("阅读完整技术声明全文")}</span>
                            <ChevronRight size={14} className="transition-transform group-hover:translate-x-0.5" />
                          </button>
                        </div>

                        {/* 规范卡片 */}
                        <div
                          className="group relative flex flex-col justify-between rounded-2xl border p-5 transition-all shadow-xs hover:border-emerald-400/60 hover:shadow-md"
                          style={{ background: colors.card, borderColor: colors.borderSolid }}
                        >
                          <div>
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-400 group-hover:scale-105 transition-transform">
                                <ShieldCheck size={19} />
                              </div>
                              <span className="rounded-full bg-emerald-500/10 border border-emerald-500/25 px-2.5 py-0.5 text-[10.5px] font-semibold text-emerald-400">
                                {__ui("权利与合规")}</span>
                            </div>
                            <h4 className="text-[14.5px] font-bold text-foreground group-hover:text-emerald-400 transition-colors">
                              {__ui("用户使用规范")}</h4>
                            <p className="text-[12px] text-muted-foreground mt-1.5 leading-relaxed">
                              {__ui("本工具作为中立离线软件，经由本程序处理、导出与重构的任何素材版权均归用户所有；清晰界定合理使用与法律合规边界。")}</p>
                            <div className="flex flex-wrap gap-1.5 mt-3 pt-2 border-t border-border/40">
                              <span className="rounded-md bg-muted/60 px-2 py-0.5 text-[10.5px] text-muted-foreground font-mono">{__ui("成果权益归用户")}</span>
                              <span className="rounded-md bg-muted/60 px-2 py-0.5 text-[10.5px] text-muted-foreground font-mono">{__ui("技术中立原则")}</span>
                              <span className="rounded-md bg-muted/60 px-2 py-0.5 text-[10.5px] text-muted-foreground font-mono">{__ui("合规使用准则")}</span>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={() => setLegalDoc("rules")}
                            className="mt-4 flex items-center justify-between rounded-xl border border-emerald-400/30 bg-emerald-500/5 px-4 py-2.5 text-[12px] font-semibold text-emerald-400 transition-all hover:bg-emerald-500/15 active:scale-98 cursor-pointer"
                          >
                            <span>{__ui("查阅使用合规规范准则")}</span>
                            <ChevronRight size={14} className="transition-transform group-hover:translate-x-0.5" />
                          </button>
                        </div>
                      </div>
                    </div>

                  </div>
                )}

                {/* ── 板块九：支持芙芙（赞赏搬移到设置里，命名为支持芙芙） ── */}
                {activeSection === "donate" && (
                  <div className="space-y-6">
                    <div
                      className="rounded-3xl border p-7 text-center transition-all shadow-sm"
                      style={{ background: colors.card, borderColor: colors.borderSolid }}
                    >
                      {/* 标题 */}
                      <div className="mb-6">
                        <div className="inline-flex items-center justify-center gap-2 mb-2">
                          <span className="text-2xl">🍰</span>
                          <h2 className="text-2xl font-bold tracking-wide text-foreground">
                            {__ui("支持芙芙 · 鼓励开发者")}</h2>
                          <span className="text-2xl">🍰</span>
                        </div>
                        <p className="text-sm leading-relaxed text-muted-foreground">
                          {__ui("大家的每一份喜爱与支持，都将用于持续开发优化与服务器运行维护！")}<br />
                          <span className="text-xs font-semibold text-pink-400 mt-1 inline-block">
                            {__ui("✨ 芙芙承诺所有功能永久免费使用，绝不植入任何商业广告 ✨")}</span>
                        </p>
                      </div>

                      {/* 双收款码展示区 (左边支付宝，右边微信) */}
                      <div className="mb-6 grid grid-cols-2 gap-6 max-w-lg mx-auto">
                        {/* 左侧：支付宝 */}
                        <div className="flex flex-col items-center rounded-2xl border border-blue-500/25 bg-blue-500/[0.04] p-5 transition-all duration-200 hover:border-blue-500/50 hover:bg-blue-500/[0.08]">
                          <div className="flex h-[190px] w-[190px] items-center justify-center rounded-2xl bg-white p-2.5 shadow-md">
                            <img
                              src="/donate-alipay.jpg"
                              alt={__ui("支付宝赞赏码")}
                              className="h-full w-full object-contain rounded-xl"
                            />
                          </div>
                        </div>

                        {/* 右侧：微信支付 */}
                        <div className="flex flex-col items-center rounded-2xl border border-emerald-500/25 bg-emerald-500/[0.04] p-5 transition-all duration-200 hover:border-emerald-500/50 hover:bg-emerald-500/[0.08]">
                          <div className="flex h-[190px] w-[190px] items-center justify-center rounded-2xl bg-white p-2.5 shadow-md">
                            <img
                              src="/donate-wechat.png"
                              alt={__ui("微信赞赏码")}
                              className="h-full w-full object-contain rounded-xl"
                            />
                          </div>
                        </div>
                      </div>

                      {/* 底部感谢 */}
                      <div className="border-t pt-4 text-center" style={{ borderColor: colors.border }}>
                        <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
                          <span>{__ui("感谢每一位支持与喜爱芙芙的小伙伴，大家的认可与陪伴是芙芙前行最大的动力")}</span>
                          <Heart size={14} className="text-pink-400 fill-pink-400 inline" />
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </main>
      </div>

      {/* 嵌入的子弹窗 */}
      <UpdateModal open={updateOpen} onClose={() => setUpdateOpen(false)} initialTab={updateTab} />
      <RepairModal open={repairOpen} onClose={() => setRepairOpen(false)} />
      <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
    </div>
  );
}
