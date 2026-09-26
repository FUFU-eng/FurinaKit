"use client";

import { useEffect, useState } from "react";

type CountUpProps = {
  value: number;
  duration?: number;
  className?: string;
};

/** Animates an integer from 0 → value with an ease-out, honoring reduced motion. */
export function CountUp({ value, duration = 900, className }: CountUpProps) {
  const [display, setDisplay] = useState(0);

  useEffect(() => {
    // Skip the animation (and just show the final value) when motion is
    // reduced or the tab is hidden — rAF is throttled in background tabs,
    // which would otherwise leave the number stuck at 0.
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || document.hidden) {
      setDisplay(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    // Safety net: if rAF never settles (e.g. tab backgrounded mid-animation),
    // ensure the final value still lands.
    const fallback = window.setTimeout(() => setDisplay(value), duration + 250);
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setDisplay(Math.round(eased * value));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(fallback);
    };
  }, [value, duration]);

  return <span className={className}>{display}</span>;
}
