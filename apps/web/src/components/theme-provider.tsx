"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

export type Theme = "dark" | "light" | "eye-care";

// 深色主题配色（深海蓝）
const DARK_COLORS = {
  bg: "#0a0f2d",
  sidebar: "#0f172a",
  panel: "#111a2e",
  card: "#0d1526",
  cardHover: "#162038",
  border: "rgba(255,255,255,0.07)",
  borderSolid: "#1e293b",
  text: "#f8fafc",
  textSecondary: "#f4f7ff",
  muted: "#8998b0",
  mutedDark: "#5a6478",
  navText: "#aebbd0",
  gold: "#ffd166",
  blue: "#6ad4ff",
  green: "#3ecf8e",
  red: "#e5484d",
  btn: "#1e2540",
  btnHover: "#18243a",
  active: "#202e48",
  activeBorder: "rgba(106,212,255,0.24)",
  searchBg: "#0a0f2d",
  searchBorder: "#1e293b",
  dropdownBg: "#111a2e",
  dropdownHover: "rgba(255,255,255,0.05)",
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

const ThemeContext = createContext<{
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (t: Theme) => void;
  colors: typeof DARK_COLORS;
  mounted: boolean;
}>({
  theme: "dark",
  toggleTheme: () => {},
  setTheme: () => {},
  colors: DARK_COLORS,
  mounted: false,
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");
  const [mounted, setMounted] = useState(false);

  const applyTheme = (newTheme: Theme) => {
    setThemeState(newTheme);
    localStorage.setItem("furina-theme", newTheme);
    document.documentElement.setAttribute("data-theme", newTheme);
    const win = typeof window !== "undefined" ? (window as unknown as { furinakit?: { setTheme?: (t: string) => void } }) : null;
    if (win?.furinakit?.setTheme) {
      win.furinakit.setTheme(newTheme === "light" ? "light" : "dark");
    }
  };

  useEffect(() => {
    const saved = localStorage.getItem("furina-theme") as Theme | null;
    if (saved === "light" || saved === "dark" || saved === "eye-care") {
      applyTheme(saved);
    } else {
      applyTheme("dark");
    }
    setMounted(true);
  }, []);

  const toggleTheme = () => {
    const next: Theme = theme === "dark" ? "light" : theme === "light" ? "eye-care" : "dark";
    applyTheme(next);
  };

  const colors = theme === "dark" ? DARK_COLORS : theme === "eye-care" ? EYE_CARE_COLORS : LIGHT_COLORS;

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme, setTheme: applyTheme, colors, mounted }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  return useContext(ThemeContext);
}
