"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

export type Theme = "dark" | "light" | "eye-care";
export type ThemeMode = "system" | "dark" | "light" | "eye-care";

// 深色主题配色（深海蓝）
// 深色主题配色
// 一律照搬 DSH 设计系统（neutral-bluish 中性色阶 + deepseek 强调蓝）：
// 背景 #151517 / 卡片 #1b1b1c / 浮层 #2c2c2e，而不是之前的深蓝底。
// 色阶出处：--dsw-static-neutral-bluish-*、--dsw-static-deepseek-*
const DARK_COLORS = {
  bg: "#151517",
  sidebar: "#0f1115",
  panel: "#151517",
  card: "#1b1b1c",
  cardHover: "#232324",
  border: "rgba(255,255,255,0.06)",
  borderSolid: "#2c2c2e",
  text: "#f9fafb",
  textSecondary: "#ebeef2",
  muted: "#adb2b8",
  mutedDark: "#81858c",
  navText: "#cfd3d6",
  gold: "#ffd166",
  // 金色底上的文字色。深色主题的金色是亮黄(#ffd166)，压白字几乎看不清，
  // 所以这里给一个近黑棕色；浅色/护眼主题的金色偏深，配白字。
  onGold: "#2a1f05",
  blue: "#679efe",
  green: "#3ecf8e",
  red: "#f25a5a",
  btn: "#232324",
  btnHover: "#2c2c2e",
  active: "#232324",
  activeBorder: "rgba(255,255,255,0.12)",
  searchBg: "#1b1b1c",
  searchBorder: "#2c2c2e",
  dropdownBg: "#232324",
  dropdownHover: "rgba(255,255,255,0.06)",
};

// 浅色主题配色（灰白清爽）
const LIGHT_COLORS = {
  bg: "#f1f5f9",
  sidebar: "#ffffff",
  panel: "#ffffff",
  card: "#ffffff",
  cardHover: "#f8fafc",
  border: "rgba(0,0,0,0.08)",
  borderSolid: "#e2e8f0",
  text: "#1e293b",
  textSecondary: "#0f172a",
  muted: "#64748b",
  mutedDark: "#94a3b8",
  navText: "#475569",
  gold: "#d97706",
  onGold: "#ffffff",
  blue: "#0284c7",
  green: "#059669",
  red: "#dc2626",
  btn: "#f1f5f9",
  btnHover: "#e2e8f0",
  active: "#e0f2fe",
  activeBorder: "rgba(2,132,199,0.3)",
  searchBg: "#f8fafc",
  searchBorder: "#e2e8f0",
  dropdownBg: "#ffffff",
  dropdownHover: "rgba(0,0,0,0.04)",
};

// 护眼主题配色（温润羊皮纸/燕麦米色，防蓝光）
const EYE_CARE_COLORS = {
  bg: "#f4efe6",
  sidebar: "#eae3d5",
  panel: "#faf7f2",
  card: "#faf7f2",
  cardHover: "#f0e9dc",
  border: "rgba(100, 80, 60, 0.12)",
  borderSolid: "#ded5c7",
  text: "#38322c",
  textSecondary: "#231f1b",
  muted: "#7d7367",
  mutedDark: "#9c9081",
  navText: "#5c5246",
  gold: "#b45309",
  onGold: "#ffffff",
  blue: "#b45309",
  green: "#2e7d32",
  red: "#c62828",
  btn: "#eae3d5",
  btnHover: "#dfd6c5",
  active: "#e2d7c3",
  activeBorder: "rgba(180, 83, 9, 0.35)",
  searchBg: "#eae3d5",
  searchBorder: "#ded5c7",
  dropdownBg: "#faf7f2",
  dropdownHover: "rgba(100, 80, 60, 0.06)",
};

function getSystemTheme(): Theme {
  if (typeof window === "undefined") return "eye-care";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

const ThemeContext = createContext<{
  theme: Theme;
  themeMode: ThemeMode;
  toggleTheme: () => void;
  setTheme: (t: ThemeMode) => void;
  colors: typeof DARK_COLORS;
  mounted: boolean;
}>({
  theme: "eye-care",
  themeMode: "eye-care",
  toggleTheme: () => {},
  setTheme: () => {},
  colors: EYE_CARE_COLORS,
  mounted: false,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>("eye-care");
  const [theme, setThemeState] = useState<Theme>(() => {
    const initial = typeof document === "undefined" ? null : document.documentElement.getAttribute("data-theme");
    return initial === "dark" || initial === "light" ? initial : "eye-care";
  });
  const [mounted, setMounted] = useState(false);

  const applyThemeMode = (newMode: ThemeMode) => {
    setThemeModeState(newMode);
    try {
      localStorage.setItem("furina-theme-mode", newMode);
    } catch {}

    const resolved: Theme = newMode === "system" ? getSystemTheme() : newMode;
    setThemeState(resolved);
    try {
      localStorage.setItem("furina-theme", resolved);
    } catch {}

    document.documentElement.setAttribute("data-theme", resolved);
    const win = typeof window !== "undefined" ? (window as unknown as { furinakit?: { setTheme?: (t: string) => void } }) : null;
    if (win?.furinakit?.setTheme) {
      win.furinakit.setTheme(resolved);
    }
  };

  // 初始化恢复主题偏好设置
  useEffect(() => {
    let initialMode: ThemeMode = "eye-care";
    try {
      const savedMode = localStorage.getItem("furina-theme-mode") as ThemeMode | null;
      const savedTheme = localStorage.getItem("furina-theme") as Theme | null;
      if (savedMode === "system" || savedMode === "light" || savedMode === "dark" || savedMode === "eye-care") {
        initialMode = savedMode;
      } else if (savedTheme === "light" || savedTheme === "dark" || savedTheme === "eye-care") {
        initialMode = savedTheme;
      }
    } catch {}

    applyThemeMode(initialMode);
    setMounted(true);
  }, []);

  // 当选择“跟随系统”时，监听系统深色/浅色模式的动态切换
  useEffect(() => {
    if (themeMode !== "system" || typeof window === "undefined") return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => {
      const resolved: Theme = e.matches ? "dark" : "light";
      setThemeState(resolved);
      try { localStorage.setItem("furina-theme", resolved); } catch {}
      document.documentElement.setAttribute("data-theme", resolved);
      const win = typeof window !== "undefined" ? (window as unknown as { furinakit?: { setTheme?: (t: string) => void } }) : null;
      if (win?.furinakit?.setTheme) {
        win.furinakit.setTheme(resolved);
      }
    };
    media.addEventListener("change", handler);
    return () => media.removeEventListener("change", handler);
  }, [themeMode]);

  const toggleTheme = () => {
    const modes: ThemeMode[] = ["system", "light", "dark", "eye-care"];
    const idx = modes.indexOf(themeMode);
    const next = modes[(idx + 1) % modes.length];
    applyThemeMode(next);
  };

  const colors = theme === "dark" ? DARK_COLORS : theme === "eye-care" ? EYE_CARE_COLORS : LIGHT_COLORS;

  return (
    <ThemeContext.Provider value={{ theme, themeMode, toggleTheme, setTheme: applyThemeMode, colors, mounted }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
