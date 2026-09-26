"use client";

import { useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Draggable before/after image comparison. "before" (original) sits on the
 * LEFT of the handle; "after" (result) is the base layer revealed on the RIGHT.
 * Dragging right moves the handle right, expanding the before region.
 */
export function BeforeAfterSlider({ before, after }: { before: string; after: string }) {
  const [pos, setPos] = useState(50);
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);

  const setFromClientX = (clientX: number) => {
    const el = ref.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setPos(Math.min(100, Math.max(0, pct)));
  };

  return (
    <div
      ref={ref}
      className="relative w-full cursor-ew-resize select-none overflow-hidden rounded-md border border-border bg-background"
      onPointerDown={(e) => {
        dragging.current = true;
        (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
        setFromClientX(e.clientX);
      }}
      onPointerMove={(e) => dragging.current && setFromClientX(e.clientX)}
      onPointerUp={() => (dragging.current = false)}
      onPointerCancel={() => (dragging.current = false)}
    >
      {/* Base layer: after (result). Visible everywhere. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={after} alt="after" className="block w-full" draggable={false} />
      {/* Overlay: before (original). Clipped to the LEFT of the handle. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={before}
        alt="before"
        draggable={false}
        className="absolute inset-0 block h-full w-full object-contain"
        style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}
      />

      {/* Corner labels: left = before (original), right = after (result) */}
      <span className="pointer-events-none absolute left-2 top-2 rounded bg-background/80 px-1.5 py-0.5 font-mono-accent text-[9px] uppercase tracking-widest text-muted-foreground">
        before
      </span>
      <span className="pointer-events-none absolute right-2 top-2 rounded bg-background/80 px-1.5 py-0.5 font-mono-accent text-[9px] uppercase tracking-widest text-primary">
        after
      </span>

      {/* Divider + handle */}
      <div
        className="pointer-events-none absolute inset-y-0 w-0.5 bg-primary/90 shadow-[0_0_12px_hsl(var(--primary)/0.7)]"
        style={{ left: `${pos}%` }}
      >
        <span className="absolute top-1/2 left-1/2 flex h-8 w-8 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-primary/60 bg-background/90 text-primary backdrop-blur">
          <ChevronLeft className="h-3 w-3" />
          <ChevronRight className="h-3 w-3" />
        </span>
      </div>
    </div>
  );
}
