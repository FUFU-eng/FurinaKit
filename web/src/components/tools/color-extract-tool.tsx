"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/color-extract-tool.tsx");


import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Copy, Download, Droplet, Eye, Image as ImageIcon, Pipette, Upload } from "lucide-react";
import { Button, Select } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

interface Swatch {
  hex: string;
  rgb: [number, number, number];
  count: number;
  ratio: number;
}

const toHex = (r: number, g: number, b: number) =>
  "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");

const luminance = (r: number, g: number, b: number) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

/** 用 k-means 找出主色；样本先缩到小尺寸，几千个像素就足够稳 */
function extractPalette(pixels: [number, number, number][], k: number): Swatch[] {
  if (pixels.length === 0) return [];
  // 先用中位数切分的简易手法取初始中心，比随机取点收敛更快
  const sorted = [...pixels].sort((a, b) => luminance(...a) - luminance(...b));
  const centers: [number, number, number][] = Array.from({ length: k }, (_, i) => {
    const idx = Math.min(sorted.length - 1, Math.floor(((i + 0.5) / k) * sorted.length));
    return [...sorted[idx]] as [number, number, number];
  });

  const assign = new Array(pixels.length).fill(0);
  for (let iter = 0; iter < 12; iter++) {
    const sums = Array.from({ length: k }, () => [0, 0, 0, 0]);
    for (let i = 0; i < pixels.length; i++) {
      const [r, g, b] = pixels[i];
      let best = 0;
      let bestDist = Infinity;
      for (let c = 0; c < centers.length; c++) {
        const [cr, cg, cb] = centers[c];
        const d = (r - cr) ** 2 + (g - cg) ** 2 + (b - cb) ** 2;
        if (d < bestDist) {
          bestDist = d;
          best = c;
        }
      }
      assign[i] = best;
      sums[best][0] += r;
      sums[best][1] += g;
      sums[best][2] += b;
      sums[best][3] += 1;
    }
    let moved = 0;
    for (let c = 0; c < k; c++) {
      if (sums[c][3] === 0) continue;
      const next: [number, number, number] = [sums[c][0] / sums[c][3], sums[c][1] / sums[c][3], sums[c][2] / sums[c][3]];
      moved += Math.abs(next[0] - centers[c][0]) + Math.abs(next[1] - centers[c][1]) + Math.abs(next[2] - centers[c][2]);
      centers[c] = next;
    }
    if (moved < 1.5) break;
  }

  const counts = new Array(k).fill(0);
  for (const a of assign) counts[a]++;
  return centers
    .map((c, i) => ({
      hex: toHex(c[0], c[1], c[2]),
      rgb: [Math.round(c[0]), Math.round(c[1]), Math.round(c[2])] as [number, number, number],
      count: counts[i],
      ratio: counts[i] / pixels.length,
    }))
    .filter((s) => s.count > 0)
    .sort((a, b) => b.ratio - a.ratio);
}

export function ColorExtractTool() {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  const { toast } = useToast();
  const [imageUrl, setImageUrl] = useState("");
  const [imageName, setImageName] = useState("");
  const [palette, setPalette] = useState<Swatch[]>([]);
  const [k, setK] = useState("6");
  const [picked, setPicked] = useState<string>("");
  const [picking, setPicking] = useState(false);
  const [dragging, setDragging] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const loadFile = useCallback(
    (f: File | null | undefined) => {
      if (!f) return;
      if (!f.type.startsWith("image/")) {
        toast({ title: "请选择图片文件", variant: "error" });
        return;
      }
      setImageUrl(URL.createObjectURL(f));
      setImageName(f.name);
      setPicked("");
      setPalette([]);
    },
    [toast],
  );

  // 图片与取样数量变化时重新提取
  useEffect(() => {
    if (!imageUrl) return;
    const img = new Image();
    img.onload = () => {
      const canvas = canvasRef.current ?? document.createElement("canvas");
      const maxSide = 240;
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const pixels: [number, number, number][] = [];
      for (let i = 0; i < data.length; i += 4) {
        // 跳过近似全透明的像素
        if (data[i + 3] < 24) continue;
        pixels.push([data[i], data[i + 1], data[i + 2]]);
      }
      const result = extractPalette(pixels, Number(k));
      setPalette(result);
    };
    img.src = imageUrl;
  }, [imageUrl, k]);

  /** 在预览图上点击取单个像素的颜色 */
  const handlePick = (e: React.MouseEvent<HTMLImageElement>) => {
    if (!picking) return;
    const img = e.currentTarget;
    const rect = img.getBoundingClientRect();
    const x = Math.floor(((e.clientX - rect.left) / rect.width) * img.naturalWidth);
    const y = Math.floor(((e.clientY - rect.top) / rect.height) * img.naturalHeight);
    const canvas = document.createElement("canvas");
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(x, y, 1, 1).data;
    const hex = toHex(d[0], d[1], d[2]);
    setPicked(hex);
    setPicking(false);
    void navigator.clipboard.writeText(hex).then(
      () => toast({ title: `已取色并复制 ${hex.toUpperCase()}`, variant: "success" }),
      () => toast({ title: `取到颜色 ${hex.toUpperCase()}`, variant: "info" }),
    );
  };

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `已复制${label}`, variant: "success" });
    } catch {
      toast({ title: "复制失败", variant: "error" });
    }
  };

  const cssText = useMemo(
    () => palette.map((s, i) => `  --color-${i + 1}: ${s.hex.toUpperCase()};`).join("\n"),
    [palette, __locale],
  );
  const jsonText = useMemo(() => JSON.stringify(palette.map((s) => ({ hex: s.hex.toUpperCase(), ratio: Number(s.ratio.toFixed(3)) })), null, 2), [palette, __locale]);

  /** 把色卡导出成一张 PNG，方便直接发给设计师 */
  const exportImage = () => {
    if (!palette.length) return;
    const w = 900, h = 260, pad = 28, gap = 14;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    const blockW = (w - pad * 2 - gap * (palette.length - 1)) / palette.length;
    palette.forEach((s, i) => {
      const x = pad + i * (blockW + gap);
      ctx.fillStyle = s.hex;
      ctx.fillRect(x, pad, blockW, 130);
      ctx.fillStyle = "#111827";
      ctx.font = "600 15px system-ui, sans-serif";
      ctx.fillText(s.hex.toUpperCase(), x, pad + 158);
      ctx.fillStyle = "#6b7280";
      ctx.font = "13px system-ui, sans-serif";
      ctx.fillText(__msg("占比 {0}%", (s.ratio * 100).toFixed(1)), x, pad + 180);
    });
    ctx.fillStyle = "#9ca3af";
    ctx.font = "12px system-ui, sans-serif";
    ctx.fillText(__ui("FurinaKit 配色提取"), pad, h - 14);
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = `配色-${Date.now()}.png`;
    a.click();
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={k} onChange={(e) => setK(e.target.value)} className="w-36">
          <option value="4">{__ui("4 种颜色")}</option>
          <option value="6">{__ui("6 种颜色")}</option>
          <option value="8">{__ui("8 种颜色")}</option>
          <option value="12">{__ui("12 种颜色")}</option>
        </Select>
        {imageUrl && (
          <>
            <Button
              variant={picking ? "default" : "outline"}
              className="gap-1.5"
              onClick={() => setPicking((p) => !p)}
            >
              <Pipette size={14} /> {picking ? __ui("点图上任意位置取色") : __ui("单点取色")}
            </Button>
            <Button variant="outline" className="gap-1.5" onClick={exportImage} disabled={!palette.length}>
              <Download size={14} /> {__ui("导出色卡")}</Button>
            <Button variant="ghost" className="gap-1.5" onClick={() => fileRef.current?.click()}>
              <Upload size={14} /> {__ui("换一张")}</Button>
          </>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => loadFile(e.target.files?.[0])}
      />

      {!imageUrl ? (
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            loadFile(e.dataTransfer.files?.[0]);
          }}
          className={cn(
            "group flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-primary/40 bg-primary/[0.04] px-6 py-12 transition-all duration-200",
            dragging ? "border-primary bg-primary/15 ring-4 ring-primary/20" : "hover:border-primary/60 hover:bg-primary/10",
          )}
        >
          <ImageIcon size={34} style={{ color: colors.muted }} />
          <p className="text-[13.5px] font-semibold" style={{ color: colors.text }}>{__ui("点击选择文件，或将文件拖拽到此处")}</p>
          <p className="mt-1 text-[11.5px]" style={{ color: colors.muted }}>{__ui("从图片里提取主色调与配色比例，可逐点取色")}</p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="rounded-2xl border p-4" style={{ borderColor: colors.borderSolid, background: colors.card }}>
            <p className="mb-2.5 truncate text-[12px]" style={{ color: colors.muted }}>{imageName}</p>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imageUrl}
              alt={__ui("待取色图片")}
              onClick={handlePick}
              className={cn("max-h-[420px] w-full rounded-xl object-contain", picking && "cursor-crosshair")}
            />
            <canvas ref={canvasRef} className="hidden" />
          </section>

          <div className="flex flex-col gap-4">
            <section className="rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
              <header className="mb-3.5 flex items-center gap-2">
                <Droplet size={15} />
                <h2 className="text-[14px] font-semibold" style={{ color: colors.text }}>{__ui("主色调（按占比排序）")}</h2>
              </header>
              <div className="flex flex-col gap-2.5">
                {palette.map((s) => (
                  <button
                    key={s.hex}
                    onClick={() => copy(s.hex.toUpperCase(), "色值")}
                    className="flex items-center gap-3 rounded-xl border px-3 py-2 text-left transition-all hover:border-primary/60"
                    style={{ borderColor: colors.borderSolid }}
                  >
                    <span className="h-9 w-9 shrink-0 rounded-lg border" style={{ background: s.hex, borderColor: colors.border }} />
                    <span className="min-w-0 flex-1">
                      <span className="block font-mono text-[13px]" style={{ color: colors.text }}>{s.hex.toUpperCase()}</span>
                      <span className="block text-[11px]" style={{ color: colors.muted }}>
                        rgb({s.rgb.join(", ")}{__ui(") · 占比")}{(s.ratio * 100).toFixed(1)}%
                      </span>
                    </span>
                    <span
                      className="shrink-0 rounded-md px-2 py-0.5 text-[10.5px]"
                      style={{
                        background: luminance(...s.rgb) > 0.6 ? "#1f2937" : "#f3f4f6",
                        color: luminance(...s.rgb) > 0.6 ? "#f9fafb" : "#1f2937",
                      }}
                    >
                      {luminance(...s.rgb) > 0.6 ? __ui("浅色底用深字") : __ui("深色底用浅字")}
                    </span>
                  </button>
                ))}
              </div>
              <div className="mt-3.5 flex flex-wrap gap-2">
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => copy(palette.map((s) => s.hex.toUpperCase()).join(", "), "全部色值")}>
                  <Copy size={13} /> {__ui("复制全部色值")}</Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => copy(cssText, "CSS 变量")}>
                  <Copy size={13} /> {__ui("CSS 变量")}</Button>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => copy(jsonText, "JSON")}>
                  <Copy size={13} /> JSON
                </Button>
              </div>
            </section>

            {picked && (
              <section className="flex items-center gap-3.5 rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
                <span className="h-14 w-14 shrink-0 rounded-xl border" style={{ background: picked, borderColor: colors.border }} />
                <div className="min-w-0 flex-1">
                  <p className="text-[11.5px]" style={{ color: colors.muted }}>{__ui("单点取色结果")}</p>
                  <p className="font-mono text-[16px]" style={{ color: colors.text }}>{picked.toUpperCase()}</p>
                </div>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={() => copy(picked.toUpperCase(), "色值")}>
                  <Copy size={13} /> {__ui("复制")}</Button>
              </section>
            )}

            <section className="flex items-start gap-2 rounded-2xl border p-4" style={{ borderColor: colors.borderSolid }}>
              <Eye size={14} className="mt-0.5 shrink-0" style={{ color: colors.muted }} />
              <p className="text-[11.5px] leading-relaxed" style={{ color: colors.muted }}>
                {__ui("主色调用 k-means 聚类得出，已跳过透明像素；图片会在本机缩小后取样，不上传任何服务器。 想取某个具体位置的颜色，点「单点取色」后在图上点击即可。")}</p>
            </section>
          </div>
        </div>
      )}
    </div>
  );
}
