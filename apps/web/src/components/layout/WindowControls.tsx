"use client";

import { Minus, Square, X } from "lucide-react";

declare global {
  interface Window {
    furinaKit?: {
      minimize?: () => void;
      toggleMaximize?: () => void;
      close?: () => void;
    };
  }
}

export function WindowControls() {
  return (
    <div style={{ position: "fixed", right: "16px", top: "14px", zIndex: 999999999, display: "flex", alignItems: "center", gap: "8px" }}>
      <button
        onClick={() => { if (typeof window !== "undefined" && window.furinaKit) window.furinaKit.minimize?.(); }}
        title="最小化"
        className="flex h-9 w-9 items-center justify-center rounded-xl border transition-all hover:shadow-sm"
        style={{ borderColor: "#e2e8f0", background: "#ffffff", color: "#1e293b" }}
      >
        <Minus size={16} strokeWidth={2.5} />
      </button>
      <button
        onClick={() => { if (typeof window !== "undefined" && window.furinaKit) window.furinaKit.toggleMaximize?.(); }}
        title="最大化/还原"
        className="flex h-9 w-9 items-center justify-center rounded-xl border transition-all hover:shadow-sm"
        style={{ borderColor: "#e2e8f0", background: "#ffffff", color: "#1e293b" }}
      >
        <Square size={14} strokeWidth={2.5} />
      </button>
      <button
        onClick={() => { if (typeof window !== "undefined" && window.furinaKit) window.furinaKit.close?.(); }}
        title="关闭"
        className="flex h-9 w-9 items-center justify-center rounded-xl border transition-all hover:shadow-sm"
        style={{ borderColor: "#e2e8f0", background: "#ffffff", color: "#1e293b" }}
        onMouseEnter={(e) => { e.currentTarget.style.background = "#ef4444"; e.currentTarget.style.color = "#fff"; e.currentTarget.style.borderColor = "#ef4444"; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = "#ffffff"; e.currentTarget.style.color = "#1e293b"; e.currentTarget.style.borderColor = "#e2e8f0"; }}
      >
        <X size={16} strokeWidth={2.5} />
      </button>
    </div>
  );
}
