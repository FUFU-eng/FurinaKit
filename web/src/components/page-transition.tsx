"use client";

import { useLayoutEffect, useRef, type ReactNode } from "react";

/** Animate the existing host, never remount its children just to replay a transition. */
export function PageTransition({ children, routeKey }: { children: ReactNode; routeKey: string }) {
  const host = useRef<HTMLDivElement>(null);
  const previous = useRef(routeKey);
  useLayoutEffect(() => {
    if (previous.current === routeKey) return;
    previous.current = routeKey;
    const node = host.current;
    if (!node || typeof node.animate !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // A short, nearly opaque fade avoids the old blank frame, vertical jump and 320ms wait.
    // No transform: fixed-position tool dialogs keep the viewport as their containing block.
    const animation = node.animate([{ opacity: 0.88 }, { opacity: 1 }], {
      duration: 140, easing: "cubic-bezier(.2,.7,.3,1)",
    });
    return () => animation.cancel(); // rapid switching never queues stale animations
  }, [routeKey]);
  return <div ref={host}>{children}</div>;
}
