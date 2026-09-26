"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type TooltipProps = {
  label: string;
  children: ReactNode;
  side?: "top" | "bottom";
  className?: string;
};

/** Lightweight hover/focus tooltip for icon-only controls. */
export function Tooltip({ label, children, side = "bottom", className }: TooltipProps) {
  return (
    <span className={cn("group/tt relative inline-flex", className)}>
      {children}
      <span
        role="tooltip"
        className={cn(
          "pointer-events-none absolute left-1/2 z-[60] -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-popover px-2 py-1 text-[11px] font-medium text-foreground opacity-0 shadow-lg shadow-black/40 transition-all duration-150 group-hover/tt:opacity-100 group-focus-within/tt:opacity-100",
          side === "bottom" ? "top-full mt-2 translate-y-1 group-hover/tt:translate-y-0" : "bottom-full mb-2 -translate-y-1 group-hover/tt:translate-y-0",
        )}
      >
        {label}
      </span>
    </span>
  );
}
