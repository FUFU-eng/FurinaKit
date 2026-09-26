"use client";

import { useRef, type ReactNode, type MouseEvent } from "react";
import { cn } from "@/lib/utils";

type SpotlightCardProps = {
  children: ReactNode;
  className?: string;
  /** Extra class names applied to set the --cat accent variable, e.g. "cat-image". */
  catClass?: string;
};

/**
 * Card that renders a cursor-following radial glow + gradient ring.
 * The pointer position is published to CSS via `--mx` / `--my` custom
 * properties consumed by the `.spotlight-card` rules in globals.css.
 */
export function SpotlightCard({ children, className, catClass }: SpotlightCardProps) {
  const ref = useRef<HTMLDivElement>(null);

  const handleMove = (e: MouseEvent<HTMLDivElement>) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    el.style.setProperty("--mx", `${e.clientX - rect.left}px`);
    el.style.setProperty("--my", `${e.clientY - rect.top}px`);
  };

  return (
    <div
      ref={ref}
      onMouseMove={handleMove}
      className={cn("spotlight-card h-full", catClass, className)}
    >
      {children}
    </div>
  );
}
