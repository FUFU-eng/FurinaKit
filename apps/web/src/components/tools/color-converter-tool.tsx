"use client";

import { useMemo, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Label, Input } from "@/components/ui/primitives";
import { CopyButton } from "@/components/tools/copy-button";

type RGB = { r: number; g: number; b: number };

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function parseColor(input: string): RGB | null {
  const s = input.trim().toLowerCase();
  if (!s) return null;

  // #rgb / #rrggbb
  const hex = s.replace(/^#/, "");
  if (/^[0-9a-f]{3}$/.test(hex)) {
    return {
      r: parseInt(hex[0] + hex[0], 16),
      g: parseInt(hex[1] + hex[1], 16),
      b: parseInt(hex[2] + hex[2], 16),
    };
  }
  if (/^[0-9a-f]{6}$/.test(hex)) {
    return {
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
    };
  }

  // rgb(r,g,b)
  const rgb = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(s);
  if (rgb) {
    return { r: clamp(+rgb[1], 0, 255), g: clamp(+rgb[2], 0, 255), b: clamp(+rgb[3], 0, 255) };
  }

  // hsl(h,s%,l%)
  const hsl = /^hsla?\(\s*(\d+(?:\.\d+)?)[,\s]+(\d+(?:\.\d+)?)%?[,\s]+(\d+(?:\.\d+)?)%?/.exec(s);
  if (hsl) {
    return hslToRgb(+hsl[1], clamp(+hsl[2], 0, 100), clamp(+hsl[3], 0, 100));
  }

  return null;
}

function hslToRgb(h: number, s: number, l: number): RGB {
  h = ((h % 360) + 360) % 360;
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0,
    g = 0,
    b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

function rgbToHsl({ r, g, b }: RGB): { h: number; s: number; l: number } {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function toHex({ r, g, b }: RGB): string {
  return "#" + [r, g, b].map((n) => n.toString(16).padStart(2, "0")).join("");
}

const SWATCHES = ["#6d4aff", "#22d3ee", "#f43f5e", "#10b981", "#f59e0b", "#ec4899"];

export function ColorConverterTool() {
  const [input, setInput] = useState("#6d4aff");
  const rgb = useMemo(() => parseColor(input), [input]);

  const formats = rgb
    ? (() => {
        const hsl = rgbToHsl(rgb);
        return [
          { label: "HEX", value: toHex(rgb) },
          { label: "RGB", value: `rgb(${rgb.r}, ${rgb.g}, ${rgb.b})` },
          { label: "HSL", value: `hsl(${hsl.h}, ${hsl.s}%, ${hsl.l}%)` },
        ];
      })()
    : [];

  return (
    <div className="space-y-5">
      <div className="space-y-2">
        <Label>颜色值（支持 HEX / RGB / HSL）</Label>
        <div className="flex items-center gap-3">
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="#6d4aff · rgb(109,74,255) · hsl(252,100%,64%)"
            className="font-mono-accent"
          />
          <span
            className="h-11 w-11 shrink-0 rounded-md border border-border transition-colors duration-300"
            style={{ background: rgb ? toHex(rgb) : "transparent" }}
            aria-hidden
          />
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setInput(c)}
            className="h-7 w-7 rounded-full border border-border/60 transition-transform hover:scale-110"
            style={{ background: c }}
            aria-label={`使用 ${c}`}
          />
        ))}
      </div>

      {!rgb && input.trim() && (
        <div className="flex items-center gap-2 rounded-md border-l-2 border-l-destructive bg-destructive/10 px-4 py-3 font-mono-accent text-xs text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" /> 无法识别该颜色，请检查格式。
        </div>
      )}

      {rgb && (
        <div className="grid gap-3 animate-fade-in-up sm:grid-cols-3">
          {formats.map((f) => (
            <div key={f.label} className="rounded-md border border-border bg-card p-4">
              <div className="flex items-center justify-between">
                <span className="font-mono-accent text-[10px] uppercase tracking-widest text-muted-foreground">
                  {f.label}
                </span>
                <CopyButton value={f.value} label="" />
              </div>
              <p className="mt-1 font-mono-accent text-sm text-foreground break-all">{f.value}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
