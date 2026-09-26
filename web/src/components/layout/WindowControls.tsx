"use client";
import { createUiText as __createUiText, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/layout/WindowControls.tsx");


import { Minus, Square, X } from "lucide-react";

export function WindowControls() {
  const __locale = __useLanguage();
  const getBridge = () => (typeof window !== "undefined" ? (window.furinakit || window.furinaKit) : undefined);

  return (
    <div style={{ position: "fixed", right: "16px", top: "14px", zIndex: 999999999, display: "flex", alignItems: "center", gap: "8px" }}>
      <button
        onClick={() => getBridge()?.minimize?.()}
        title={__ui("最小化")}
        className="fk-window-control flex h-9 w-9 items-center justify-center rounded-xl border transition-all hover:shadow-sm"
        style={{ borderColor: "#e2e8f0", background: "#ffffff", color: "#1e293b" }}
      >
        <Minus size={16} strokeWidth={2.5} />
      </button>
      <button
        onClick={() => getBridge()?.toggleMaximize?.()}
        title={__ui("最大化/还原")}
        className="fk-window-control flex h-9 w-9 items-center justify-center rounded-xl border transition-all hover:shadow-sm"
        style={{ borderColor: "#e2e8f0", background: "#ffffff", color: "#1e293b" }}
      >
        <Square size={14} strokeWidth={2.5} />
      </button>
      <button
        onClick={() => getBridge()?.close?.()}
        title={__ui("关闭")}
        className="fk-window-control fk-window-control--close flex h-9 w-9 items-center justify-center rounded-xl border transition-all hover:shadow-sm"
        style={{ borderColor: "#e2e8f0", background: "#ffffff", color: "#1e293b" }}
      >
        <X size={16} strokeWidth={2.5} />
      </button>
    </div>
  );
}
