"use client";

import { useMemo } from "react";
import { motion } from "framer-motion";

const COLORS = [
  "hsl(var(--brand-1))",
  "hsl(var(--brand-2))",
  "hsl(var(--brand-3))",
  "hsl(var(--success))",
];

/**
 * One-shot confetti burst. Mounts once (e.g. inside a success panel) and fires
 * a single celebratory burst from the top-center. Inert under reduced motion.
 */
export function Confetti({ count = 26 }: { count?: number }) {
  const pieces = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const dir = Math.random() * 2 - 1;
        return {
          id: i,
          color: COLORS[i % COLORS.length],
          x: dir * (60 + Math.random() * 190),
          yUp: -(50 + Math.random() * 120),
          yDown: 150 + Math.random() * 230,
          rot: (Math.random() * 2 - 1) * 240,
          dur: 1 + Math.random() * 0.9,
          delay: Math.random() * 0.12,
          size: 5 + Math.random() * 5,
        };
      }),
    [count],
  );

  const prefersReduced =
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (prefersReduced) return null;

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 overflow-visible" aria-hidden>
      {pieces.map((p) => (
        <motion.span
          key={p.id}
          initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 1 }}
          animate={{
            x: [0, p.x * 0.5, p.x],
            y: [0, p.yUp, p.yDown],
            opacity: [1, 1, 0],
            rotate: [0, p.rot * 0.5, p.rot],
            scale: [1, 1, 0.5],
          }}
          transition={{ duration: p.dur, delay: p.delay, ease: "easeOut", times: [0, 0.3, 1] }}
          className="absolute left-1/2 top-0 rounded-[1px]"
          style={{ width: p.size, height: p.size, background: p.color }}
        />
      ))}
    </div>
  );
}
