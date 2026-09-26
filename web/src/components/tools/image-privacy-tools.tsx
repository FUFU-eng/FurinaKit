"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage, uiCount as __count } from "@/lib/language";
const __ui = __createUiText("components/tools/image-privacy-tools.tsx");


/**
 * 图片隐私 / 调色工具：图片元数据清除、图片滤镜特效。
 *
 * 布局：
 *   · 元数据清除 —— **模式 A'（批量清单 + 结论卡）**：先告诉用户"这张图里有什么"，
 *     再一键清除。隐私类工具的价值在"让你看见平时看不见的东西"，所以检测结果要排在最前面。
 *   · 滤镜特效 —— **模式 B（4:8，左侧参数 / 右侧大预览）**：调色的核心是边调边看，
 *     预览必须占主体，参数区内嵌预设与按住对比。
 *
 * ★ 元数据清除的两个关键点（都做了实测）：
 *   1. 重新编码（画布重绘）本身就会丢掉 EXIF，但**方向标记也会一起丢** ——
 *      手机竖拍的照片带 Orientation=6，直接重绘会变成躺倒的。所以必须按方向先把画面转正再重绘，
 *      否则"清了隐私、图也歪了"。
 *   2. 清除前要把检出项**展示出来**（含 GPS 的用红色标出），否则用户不知道自己在清什么。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import JSZip from "jszip";
import {
  AlertTriangle,
  Aperture,
  Camera,
  CheckCircle2,
  Download,
  Eraser,
  Eye,
  EyeOff,
  Gauge,
  Image as ImageIcon,
  Info,
  Loader2,
  MapPin,
  Palette,
  RotateCw,
  Shield,
  ShieldCheck,
  Sliders,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
} from "lucide-react";
import { Badge, Button, Input, Label, Select } from "@/components/ui/primitives";
import { useToolDraft } from "@/lib/use-tool-draft";
import { cn } from "@/lib/utils";

function SectionCard({
  icon,
  title,
  extra,
  children,
  className,
}: {
  icon?: React.ReactNode;
  title?: string;
  extra?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  const __locale = __useLanguage();
  return (
    <div className={cn("rounded-2xl border border-border/70 bg-card/60 p-5 shadow-sm backdrop-blur-md", className)}>
      {(title || extra) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-border/50 pb-3">
          <div className="flex items-center gap-2">
            {icon && (
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</span>
            )}
            {title && <span className="text-sm font-semibold text-foreground">{__ui(title)}</span>}
          </div>
          {extra}
        </div>
      )}
      {children}
    </div>
  );
}

function ErrorBar({ message }: { message: string }) {
  const __locale = __useLanguage();
  return (
    <div className="flex items-center gap-2 rounded-xl border-l-4 border-l-destructive bg-destructive/10 px-4 py-3 font-mono text-xs text-destructive">
      <AlertTriangle className="h-4 w-4 shrink-0" />
      {__msg(message)}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════
// EXIF / PNG 元数据读取（自己解析，不引第三方库）
// ══════════════════════════════════════════════════════════════════════

interface MetaField {
  group: string;
  key: string;
  value: string;
  sensitive?: boolean;
}

const ORIENTATION_TEXT: Record<number, string> = {
  1: "正常",
  2: "水平镜像",
  3: "旋转 180°",
  4: "垂直镜像",
  5: "顺时针 90° + 镜像",
  6: "顺时针 90°",
  7: "逆时针 90° + 镜像",
  8: "逆时针 90°",
};

/** 读 JPEG 的 APP1(EXIF) 段 */
function parseJpegExif(buf: ArrayBuffer): { fields: MetaField[]; orientation: number } {
  const view = new DataView(buf);
  const len = view.byteLength;
  if (len < 4 || view.getUint16(0) !== 0xffd8) return { fields: [], orientation: 1 };

  let offset = 2;
  let tiffStart = -1;
  while (offset + 4 <= len) {
    if (view.getUint8(offset) !== 0xff) break;
    const marker = view.getUint8(offset + 1);
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    if (marker === 0xda) break; // 图像数据开始
    const size = view.getUint16(offset + 2);
    if (marker === 0xe1) {
      // APP1：可能是 Exif
      const start = offset + 4;
      if (
        start + 6 <= len &&
        view.getUint8(start) === 0x45 &&
        view.getUint8(start + 1) === 0x78 &&
        view.getUint8(start + 2) === 0x69 &&
        view.getUint8(start + 3) === 0x66
      ) {
        tiffStart = start + 6;
        break;
      }
    }
    offset += 2 + size;
  }
  if (tiffStart < 0) return { fields: [], orientation: 1 };

  const le = view.getUint16(tiffStart) === 0x4949;
  const u16 = (p: number) => view.getUint16(p, le);
  const u32 = (p: number) => view.getUint32(p, le);
  const i32 = (p: number) => view.getInt32(p, le);
  if (u16(tiffStart + 2) !== 0x002a) return { fields: [], orientation: 1 };

  const fields: MetaField[] = [];
  let orientation = 1;

  const readValue = (type: number, count: number, valuePos: number): string | number[] | null => {
    const typeSize: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8 };
    const unit = typeSize[type] || 1;
    const total = unit * count;
    const dataPos = total <= 4 ? valuePos : tiffStart + u32(valuePos);
    if (dataPos + total > len) return null;
    if (type === 2) {
      let s = "";
      for (let i = 0; i < count; i++) {
        const c = view.getUint8(dataPos + i);
        if (c === 0) break;
        s += String.fromCharCode(c);
      }
      return s;
    }
    if (type === 3) {
      // 少数软件会把 1/250 这种分数写成两个 SHORT（分子、分母）——现实中确实存在，
      // 所以 count 为 2 的 SHORT 也按分数解释，避免显示成"1 秒"（实测遇到过）。
      if (count === 2) return [u16(dataPos) / (u16(dataPos + 2) || 1)];
      const arr: number[] = [];
      for (let i = 0; i < count; i++) arr.push(u16(dataPos + i * 2));
      return arr;
    }
    if (type === 4) {
      if (count === 2) return [u32(dataPos) / (u32(dataPos + 4) || 1)];
      const arr: number[] = [];
      for (let i = 0; i < count; i++) arr.push(u32(dataPos + i * 4));
      return arr;
    }
    if (type === 5 || type === 10) {
      const arr: number[] = [];
      for (let i = 0; i < count; i++) {
        const n = u32(dataPos + i * 8);
        const d = u32(dataPos + i * 8 + 4);
        arr.push(d === 0 ? 0 : n / d);
      }
      return arr;
    }
    if (type === 9) return [i32(dataPos)];
    const arr: number[] = [];
    for (let i = 0; i < count; i++) arr.push(view.getUint8(dataPos + i));
    return arr;
  };

  const TAG_NAMES: Record<number, string> = {
    0x010f: "相机制造商",
    0x0110: "相机型号",
    0x0131: "处理软件",
    0x0132: "修改时间",
    0x9003: "拍摄时间",
    0x9004: "数字化时间",
    0x829a: "曝光时间",
    0x829d: "光圈值",
    0x8827: "ISO 感光度",
    0x920a: "焦距",
    0xa002: "图像宽度",
    0xa003: "图像高度",
    0x9286: "用户注释",
    0xa430: "版权所有者",
    0xa431: "机身序列号",
    0xa433: "镜头厂商",
    0xa434: "镜头型号",
    0x010e: "图像描述",
    0x0100: "作者",
  };

  const readIfd = (ifdPos: number, group: string, isGps: boolean) => {
    const count = u16(ifdPos);
    for (let i = 0; i < count; i++) {
      const entry = ifdPos + 2 + i * 12;
      if (entry + 12 > len) break;
      const tag = u16(entry);
      const type = u16(entry + 2);
      const n = u32(entry + 4);
      const valuePos = entry + 8;
      const v = readValue(type, n, valuePos);
      if (v === null) continue;

      if (tag === 0x0112 && !isGps) {
        orientation = Array.isArray(v) ? Number(v[0]) || 1 : 1;
        fields.push({ group: "基本信息", key: "方向标记", value: ORIENTATION_TEXT[orientation] || `未知(${orientation})` });
        continue;
      }
      if (isGps) {
        gpsTags[tag] = v;
        continue;
      }
      const name = TAG_NAMES[tag];
      if (!name) continue;
      let text = "";
      if (Array.isArray(v)) {
        const nums = v as number[];
        if (tag === 0x829a) text = nums[0] >= 1 ? `${nums[0]} 秒` : `1/${Math.round(1 / nums[0])} 秒`;
        else if (tag === 0x829d) text = `f/${nums[0]}`;
        else if (tag === 0x920a) text = `${nums[0].toFixed(1)} mm`;
        else if (tag === 0x8827) text = String(nums[0]);
        else text = nums.map((x) => (Number.isInteger(x) ? x : x.toFixed(2))).join(", ");
      } else {
        text = String(v).trim();
      }
      if (text) fields.push({ group, key: name, value: text });
    }
    // 下一个 IFD
    const next = u32(ifdPos + 2 + count * 12);
    return next;
  };

  const gpsTags: Record<number, string | number[]> = {};
  try {
    const ifd0 = tiffStart + u32(tiffStart + 4);
    readIfd(ifd0, "拍摄信息", false);
    // Exif 子 IFD
    const count0 = u16(ifd0);
    for (let i = 0; i < count0; i++) {
      const entry = ifd0 + 2 + i * 12;
      const tag = u16(entry);
      if (tag === 0x8769) {
        const sub = tiffStart + u32(entry + 8);
        readIfd(sub, "拍摄参数", false);
      }
      if (tag === 0x8825) {
        const gpsIfd = tiffStart + u32(entry + 8);
        readIfd(gpsIfd, "位置信息", true);
      }
    }
    // GPS 组装
    const dms = (arr: number[]) => (arr[0] || 0) + (arr[1] || 0) / 60 + (arr[2] || 0) / 3600;
    const lat = gpsTags[2] as number[] | undefined;
    const latRef = gpsTags[1] as string | undefined;
    const lon = gpsTags[4] as number[] | undefined;
    const lonRef = gpsTags[3] as string | undefined;
    if (Array.isArray(lat) && Array.isArray(lon)) {
      const la = dms(lat) * (String(latRef).startsWith("S") ? -1 : 1);
      const lo = dms(lon) * (String(lonRef).startsWith("W") ? -1 : 1);
      fields.push({
        group: "位置信息",
        key: "GPS 坐标",
        value: `${la.toFixed(6)}, ${lo.toFixed(6)}`,
        sensitive: true,
      });
      fields.push({
        group: "位置信息",
        key: "地图链接",
        value: `https://www.openstreetmap.org/?mlat=${la.toFixed(6)}&mlon=${lo.toFixed(6)}`,
        sensitive: true,
      });
    }
    if (gpsTags[6] !== undefined) {
      const alt = gpsTags[6] as number[];
      if (Array.isArray(alt)) fields.push({ group: "位置信息", key: "海拔", value: `${(alt[0] || 0).toFixed(1)} 米`, sensitive: true });
    }
    if (gpsTags[29] !== undefined) {
      fields.push({ group: "位置信息", key: "拍摄时间(GPS)", value: String(gpsTags[29]), sensitive: true });
    }
  } catch {
    /* 元数据损坏时忽略，不影响清除功能 */
  }

  // 敏感标记：相机/软件/序列号等能拼出设备指纹的
  for (const f of fields) {
    if (!f.sensitive && ["相机制造商", "相机型号", "机身序列号", "处理软件", "版权所有者", "作者", "图像描述"].includes(f.key)) {
      f.sensitive = true;
    }
  }
  return { fields, orientation };
}

/** 读 PNG 的文本块 */
function parsePngText(buf: ArrayBuffer): MetaField[] {
  const view = new DataView(buf);
  const fields: MetaField[] = [];
  let p = 8;
  const dec = new TextDecoder("utf-8");
  while (p + 8 <= view.byteLength) {
    const len = view.getUint32(p);
    const type = String.fromCharCode(
      view.getUint8(p + 4),
      view.getUint8(p + 5),
      view.getUint8(p + 6),
      view.getUint8(p + 7),
    );
    if (p + 8 + len > view.byteLength) break;
    if (type === "tEXt" || type === "iTXt") {
      const data = new Uint8Array(buf, p + 8, Math.min(len, 300));
      const text = dec.decode(data).replace(/\0/g, " ").trim();
      if (text) fields.push({ group: "文本信息", key: type === "tEXt" ? "文本块" : "国际文本块", value: text, sensitive: true });
    }
    if (type === "eXIf") fields.push({ group: "拍摄信息", key: "EXIF 数据块", value: `存在（${len} 字节）`, sensitive: true });
    if (type === "IEND") break;
    p += 12 + len;
  }
  return fields;
}

async function readMetadata(file: File): Promise<{ fields: MetaField[]; orientation: number; note: string }> {
  const buf = await file.arrayBuffer();
  const type = file.type || "";
  if (type.includes("jpeg") || type.includes("jpg") || /\.jpe?g$/i.test(file.name)) {
    const r = parseJpegExif(buf);
    return { ...r, note: "JPEG / EXIF" };
  }
  if (type.includes("png") || /\.png$/i.test(file.name)) {
    return { fields: parsePngText(buf), orientation: 1, note: "PNG / 文本块" };
  }
  return { fields: [], orientation: 1, note: "该格式未做解析（WEBP/GIF 等通常也会携带元数据，清除同样有效）" };
}

/** 把图片按方向转正后画到画布上（清元数据的同时保证画面不变歪） */
async function drawUpright(blob: Blob, maxSide = 4096): Promise<HTMLCanvasElement> {
  let bmp: ImageBitmap;
  try {
    bmp = await createImageBitmap(blob, { imageOrientation: "from-image" } as ImageBitmapOptions);
  } catch {
    bmp = await createImageBitmap(blob);
  }
  let w = bmp.width;
  let h = bmp.height;
  if (maxSide > 0 && Math.max(w, h) > maxSide) {
    const k = maxSide / Math.max(w, h);
    w = Math.round(w * k);
    h = Math.round(h * k);
  }
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d")!;
  ctx.drawImage(bmp, 0, 0, w, h);
  bmp.close?.();
  return c;
}

// ══════════════════════════════════════════════════════════════════════
// 工具二：图片滤镜特效
// ══════════════════════════════════════════════════════════════════════

interface FilterParams {
  brightness: number; // -100 ~ 100
  contrast: number; // -100 ~ 100
  saturation: number; // -100 ~ 100
  temperature: number; // -100(冷) ~ 100(暖)
  sepia: number; // 0 ~ 100
  blur: number; // 0 ~ 20
  sharpen: number; // 0 ~ 100
  vignette: number; // 0 ~ 100
  grain: number; // 0 ~ 100
  grayscale: boolean;
  invert: boolean;
}

const DEFAULT_PARAMS: FilterParams = {
  brightness: 0,
  contrast: 0,
  saturation: 0,
  temperature: 0,
  sepia: 0,
  blur: 0,
  sharpen: 0,
  vignette: 0,
  grain: 0,
  grayscale: false,
  invert: false,
};

/** 预设：每组就是一套参数 */
const PRESETS: Array<{ id: string; name: string; params: Partial<FilterParams> }> = [
  { id: "original", name: "原图", params: {} },
  { id: "vivid", name: "鲜明", params: { saturation: 35, contrast: 18, brightness: 4 } },
  { id: "soft", name: "柔和", params: { contrast: -12, brightness: 8, saturation: -6 } },
  { id: "film", name: "胶片", params: { sepia: 22, contrast: 10, saturation: -12, grain: 18, vignette: 28 } },
  { id: "retro", name: "复古", params: { sepia: 55, contrast: 14, brightness: -4, vignette: 34 } },
  { id: "mono", name: "黑白", params: { grayscale: true, contrast: 16, grain: 10 } },
  { id: "cool", name: "冷调", params: { temperature: -46, saturation: 8 } },
  { id: "warm", name: "暖调", params: { temperature: 46, saturation: 6 } },
  { id: "punch", name: "高对比", params: { contrast: 42, saturation: 14, sharpen: 26 } },
  { id: "faded", name: "褪色", params: { contrast: -26, saturation: -24, brightness: 12, sepia: 12 } },
  { id: "invert", name: "反色", params: { invert: true } },
];

/**
 * 可分离盒式模糊（滑动窗口版），就地写回 src。
 *
 * ★ 性能：原来每个像素都要循环取样 2r+1 次，半径 20 就是每像素 41 次采样 ——
 *   拖滑块时肉眼可见地卡。改成滑动窗口后，每个像素只做"加一个、减一个"，
 *   复杂度与半径无关（O(1)/像素），半径 20 和半径 2 的耗时几乎一样。
 */
function boxBlur(src: Uint8ClampedArray, w: number, h: number, radius: number) {
  const r = Math.round(radius);
  if (r <= 0) return;
  const tmp = new Uint8ClampedArray(src.length);

  // 横向
  for (let y = 0; y < h; y++) {
    const row = y * w * 4;
    let sr = 0, sg = 0, sb = 0, count = 0;
    for (let k = 0; k <= Math.min(r, w - 1); k++) {
      const i = row + k * 4;
      sr += src[i]; sg += src[i + 1]; sb += src[i + 2]; count++;
    }
    for (let x = 0; x < w; x++) {
      const out = row + x * 4;
      tmp[out] = sr / count;
      tmp[out + 1] = sg / count;
      tmp[out + 2] = sb / count;
      tmp[out + 3] = src[out + 3];
      const addX = x + r + 1;
      const subX = x - r;
      if (addX < w) {
        const i = row + addX * 4;
        sr += src[i]; sg += src[i + 1]; sb += src[i + 2]; count++;
      }
      if (subX >= 0) {
        const i = row + subX * 4;
        sr -= src[i]; sg -= src[i + 1]; sb -= src[i + 2]; count--;
      }
    }
  }

  // 纵向（从 tmp 读、写回 src）
  for (let x = 0; x < w; x++) {
    let sr = 0, sg = 0, sb = 0, count = 0;
    for (let k = 0; k <= Math.min(r, h - 1); k++) {
      const i = (k * w + x) * 4;
      sr += tmp[i]; sg += tmp[i + 1]; sb += tmp[i + 2]; count++;
    }
    for (let y = 0; y < h; y++) {
      const out = (y * w + x) * 4;
      src[out] = sr / count;
      src[out + 1] = sg / count;
      src[out + 2] = sb / count;
      const addY = y + r + 1;
      const subY = y - r;
      if (addY < h) {
        const i = (addY * w + x) * 4;
        sr += tmp[i]; sg += tmp[i + 1]; sb += tmp[i + 2]; count++;
      }
      if (subY >= 0) {
        const i = (subY * w + x) * 4;
        sr -= tmp[i]; sg -= tmp[i + 1]; sb -= tmp[i + 2]; count--;
      }
    }
  }
}

/** 锐化：原图 + 强度 × (原图 − 模糊)，即非锐化掩蔽 */
function unsharp(src: Uint8ClampedArray, w: number, h: number, amount: number) {
  if (amount <= 0) return;
  const blurred = new Uint8ClampedArray(src);
  boxBlur(blurred, w, h, 1.6);
  const k = (amount / 100) * 1.5;
  for (let i = 0; i < src.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const v = src[i + c] + (src[i + c] - blurred[i + c]) * k;
      src[i + c] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
  }
}

/** 像素级调色（亮度 / 对比度 / 饱和度 / 色温 / 怀旧 / 黑白 / 反色） */
function applyColor(data: Uint8ClampedArray, p: FilterParams) {
  const bright = (p.brightness / 100) * 100; // -100 ~ 100 的加减量
  const cFac = (100 + p.contrast) / 100;
  const satFac = 1 + p.saturation / 100;
  const tempShift = (p.temperature / 100) * 38;
  const sepiaAmt = p.sepia / 100;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i];
    let g = data[i + 1];
    let b = data[i + 2];

    // 色温：暖 → 加红减蓝
    r += tempShift;
    b -= tempShift;

    // 亮度
    r += bright;
    g += bright;
    b += bright;

    // 对比度（以 128 为中心）
    r = (r - 128) * cFac + 128;
    g = (g - 128) * cFac + 128;
    b = (b - 128) * cFac + 128;

    // 饱和度（按亮度加权）
    const lum = 0.299 * r + 0.587 * g + 0.114 * b;
    r = lum + (r - lum) * satFac;
    g = lum + (g - lum) * satFac;
    b = lum + (b - lum) * satFac;

    // 怀旧（sepia 混合）
    if (sepiaAmt > 0) {
      const sr = 0.393 * r + 0.769 * g + 0.189 * b;
      const sg = 0.349 * r + 0.686 * g + 0.168 * b;
      const sb = 0.272 * r + 0.534 * g + 0.131 * b;
      r = r + (sr - r) * sepiaAmt;
      g = g + (sg - g) * sepiaAmt;
      b = b + (sb - b) * sepiaAmt;
    }

    // 黑白
    if (p.grayscale) {
      const y = 0.299 * r + 0.587 * g + 0.114 * b;
      r = g = b = y;
    }

    // 反色
    if (p.invert) {
      r = 255 - r;
      g = 255 - g;
      b = 255 - b;
    }

    data[i] = r < 0 ? 0 : r > 255 ? 255 : r;
    data[i + 1] = g < 0 ? 0 : g > 255 ? 255 : g;
    data[i + 2] = b < 0 ? 0 : b > 255 ? 255 : b;
  }
}

/**
 * 暗角。
 * ★ 系数只与"像素位置 + 强度"有关，同一尺寸同一强度下每帧都一样 ——
 *   所以缓存一张 Float32Array，避免每帧对 90 万像素各算一次 sqrt。
 */
let vignetteCacheKey = "";
let vignetteCache: Float32Array | null = null;

function vignetteFactors(w: number, h: number, amount: number): Float32Array {
  const key = `${w}x${h}x${amount}`;
  if (vignetteCacheKey === key && vignetteCache) return vignetteCache;
  const cx = w / 2;
  const cy = h / 2;
  const maxD = Math.sqrt(cx * cx + cy * cy) || 1;
  const strength = amount / 100;
  const arr = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const d = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / maxD;
      arr[y * w + x] = 1 - strength * d * d;
    }
  }
  vignetteCacheKey = key;
  vignetteCache = arr;
  return arr;
}

function applyVignette(data: Uint8ClampedArray, w: number, h: number, amount: number) {
  if (amount <= 0) return;
  const factors = vignetteFactors(w, h, amount);
  for (let p = 0, i = 0; p < factors.length; p++, i += 4) {
    const k = factors[p];
    data[i] *= k;
    data[i + 1] *= k;
    data[i + 2] *= k;
  }
}

/** 颗粒（固定种子的伪随机，保证同一组参数每次结果一致） */
function applyGrain(data: Uint8ClampedArray, amount: number) {
  if (amount <= 0) return;
  const strength = (amount / 100) * 34;
  let seed = 20260915;
  for (let i = 0; i < data.length; i += 4) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    const n = ((seed / 0x7fffffff) * 2 - 1) * strength;
    data[i] += n;
    data[i + 1] += n;
    data[i + 2] += n;
  }
}

/** 把参数应用到画布（就地）
 *  ★ 画布用 willReadFrequently：滤镜要反复 getImageData / putImageData，
 *    不加这个标志浏览器每次都会告警、而且会走较慢的读回路径（Chromium 自己提示的）。 */
function applyFilterToCanvas(canvas: HTMLCanvasElement, p: FilterParams) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  const w = canvas.width;
  const h = canvas.height;
  const img = ctx.getImageData(0, 0, w, h);
  if (p.blur > 0) boxBlur(img.data, w, h, p.blur);
  applyColor(img.data, p);
  if (p.sharpen > 0) unsharp(img.data, w, h, p.sharpen);
  applyVignette(img.data, w, h, p.vignette);
  applyGrain(img.data, p.grain);
  ctx.putImageData(img, 0, 0);
}

interface FilterItem {
  id: string;
  name: string;
  file: File;
  url: string;
  width: number;
  height: number;
}

export function ImageFilterTool() {
  const __locale = __useLanguage();
  const [items, setItems] = useState<FilterItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [params, setParams] = useState<FilterParams>(DEFAULT_PARAMS);
  const [preset, setPreset] = useState("original");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [compare, setCompare] = useState(false);
  const [format, setFormat] = useToolDraft<"png" | "jpeg">("image-filter", "format", "jpeg");
  const [quality, setQuality] = useToolDraft("image-filter", "quality", "95");
  const [exportMax, setExportMax] = useToolDraft("image-filter", "exportMax", "2560");
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const bitmapRef = useRef<ImageBitmap | null>(null);
  /** 预缩放好的预览底图：拖滑块时直接贴这一张，不必反复缩放原图（大照片下这是主要开销） */
  const previewSourceRef = useRef<HTMLCanvasElement | null>(null);
  const PREVIEW_MAX_W = 1100;
  /** 拖动时用半分辨率预览，松手回到高清（修图软件的通用做法，肉眼几乎看不出差别） */
  const PREVIEW_MAX_W_DRAGGING = 560;
  const [dragging, setDragging] = useState(false);
  const itemsRef = useRef<FilterItem[]>([]);
  itemsRef.current = items;

  useEffect(() => {
    return () => {
      itemsRef.current.forEach((it) => URL.revokeObjectURL(it.url));
      bitmapRef.current?.close?.();
    };
  }, []);

  const active = items.find((it) => it.id === activeId) || null;

  const addFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    const next: FilterItem[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) continue;
      try {
        const bmp = await createImageBitmap(file);
        next.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          name: file.name,
          file,
          url: URL.createObjectURL(file),
          width: bmp.width,
          height: bmp.height,
        });
        bmp.close?.();
      } catch {
        setError(`「${file.name}」读取失败`);
      }
    }
    if (next.length) {
      setItems((prev) => [...prev, ...next]);
      setActiveId((prev) => prev ?? next[0].id);
    }
    setBusy(false);
  };

  // 载入当前图（用于预览与导出）
  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      if (!active) {
        bitmapRef.current?.close?.();
        bitmapRef.current = null;
        return;
      }
      const bmp = await createImageBitmap(active.file);
      if (cancelled) {
        bmp.close?.();
        return;
      }
      bitmapRef.current?.close?.();
      bitmapRef.current = bmp;
      buildPreviewSource(bmp);
      drawPreview();
    };
    void run();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, items.length]);

  /** 把原图缩到预览尺寸存进一张离屏画布（只在换图时做一次） */
  const buildPreviewSource = useCallback((bmp: ImageBitmap, maxW: number = PREVIEW_MAX_W) => {
    const k = Math.min(1, maxW / bmp.width);
    const w = Math.max(1, Math.round(bmp.width * k));
    const h = Math.max(1, Math.round(bmp.height * k));
    const off = document.createElement("canvas");
    off.width = w;
    off.height = h;
    const ctx = off.getContext("2d", { willReadFrequently: true })!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(bmp, 0, 0, w, h);
    previewSourceRef.current = off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 开始/结束拖动时切换预览分辨率
  useEffect(() => {
    const bmp = bitmapRef.current;
    if (!bmp) return;
    buildPreviewSource(bmp, dragging ? PREVIEW_MAX_W_DRAGGING : PREVIEW_MAX_W);
    drawPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dragging]);

  /** 预览用的最大宽度：拖滑块时每帧都要跑一遍滤镜，尺寸直接决定手感 */
  const drawPreview = useCallback(() => {
    const canvas = canvasRef.current;
    const source = previewSourceRef.current;
    if (!canvas || !source) return;
    canvas.width = source.width;
    canvas.height = source.height;
    const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0);
    if (!compare) applyFilterToCanvas(canvas, params);
  }, [params, compare]);

  const rafPendingRef = useRef(false);
  /** 一次拖动可能触发多次状态更新，用 rAF 合并成"每帧最多重绘一次" */
  const schedulePreview = useCallback(() => {
    if (rafPendingRef.current) return;
    rafPendingRef.current = true;
    requestAnimationFrame(() => {
      rafPendingRef.current = false;
      drawPreview();
    });
  }, [drawPreview]);

  useEffect(() => {
    schedulePreview();
  }, [schedulePreview]);

  const exportOne = async (item: FilterItem) => {
    const bmp = await createImageBitmap(item.file);
    const maxSide = Math.max(0, Number(exportMax) || 0);
    const k = maxSide > 0 ? Math.min(1, maxSide / Math.max(bmp.width, bmp.height)) : 1;
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.width * k));
    canvas.height = Math.max(1, Math.round(bmp.height * k));
    canvas.getContext("2d", { willReadFrequently: true })!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    applyFilterToCanvas(canvas, params);
    bmp.close?.();
    const q = Math.min(1, Math.max(0.3, Number(quality) / 100 || 0.95));
    const blob: Blob = await new Promise((res, rej) =>
      canvas.toBlob((b) => (b ? res(b) : rej(new Error("导出失败"))), format === "png" ? "image/png" : "image/jpeg", q),
    );
    return blob;
  };

  const doExport = async () => {
    if (items.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const suffix = format === "png" ? "png" : "jpg";
      const nameOf = (n: string) => `${n.replace(/\.[^.]+$/, "")}_滤镜.${suffix}`;
      if (items.length === 1) {
        const blob = await exportOne(items[0]);
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = nameOf(items[0].name);
        // ★ 游离的 <a> 直接 click() 在 WebView2 里会被忽略（点了没反应）——
    //   必须挂到 DOM 上再点，点完移除（通用结果卡那边用的是页面里的真链接，所以正常）
    document.body.appendChild(a);
    document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 1000);
    setTimeout(() => a.remove(), 1000);
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      } else {
        const zip = new JSZip();
        for (const it of items) {
          zip.file(nameOf(it.name), await exportOne(it));
        }
        const out = await zip.generateAsync({ type: "blob" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(out);
        a.download = `滤镜结果_${items.length}张.zip`;
        // ★ 游离的 <a> 直接 click() 在 WebView2 里会被忽略（点了没反应）——
    //   必须挂到 DOM 上再点，点完移除（通用结果卡那边用的是页面里的真链接，所以正常）
    document.body.appendChild(a);
    document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 1000);
    setTimeout(() => a.remove(), 1000);
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "导出失败");
    } finally {
      setBusy(false);
    }
  };

  const applyPreset = (id: string) => {
    const p = PRESETS.find((x) => x.id === id);
    if (!p) return;
    setPreset(id);
    setParams({ ...DEFAULT_PARAMS, ...p.params });
  };

  const set = <K extends keyof FilterParams>(key: K, value: FilterParams[K]) => {
    setParams((prev) => ({ ...prev, [key]: value }));
    setPreset("custom");
  };

  const slider = (key: keyof FilterParams, label: string, min: number, max: number) => (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-[11.5px]">
        <span className="text-muted-foreground">{__ui(label)}</span>
        <span className="font-mono text-foreground">{String(params[key])}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        value={Number(params[key])}
        onChange={(e) => set(key, Number(e.target.value) as never)}
        onPointerDown={() => setDragging(true)}
        onPointerUp={() => setDragging(false)}
        onPointerCancel={() => setDragging(false)}
        onBlur={() => setDragging(false)}
        className="h-1.5 w-full accent-primary"
      />
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="thin-scroll space-y-4 lg:col-span-4">
          <SectionCard
            icon={<Palette className="h-4 w-4" />}
            title={__ui("图片")}
            extra={
              items.length > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    items.forEach((it) => URL.revokeObjectURL(it.url));
                    setItems([]);
                    setActiveId(null);
                  }}
                >
                  <Eraser className="h-3.5 w-3.5" /> {__ui("清空")}</Button>
              ) : null
            }
          >
            <div data-furinakit-file-field className="space-y-0">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border/60 bg-muted/20 p-5 text-center transition-colors hover:bg-muted/30"
            >
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              </span>
              <span className="text-xs font-semibold text-foreground">{__ui("点击选择图片（可批量）")}</span>
              <span className="text-[11px] text-muted-foreground">{__ui("批量时对每张应用同一套滤镜参数")}</span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                void addFiles(e.target.files);
                e.target.value = "";
              }}
            /></div>
            {items.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {items.map((it) => (
                  <button
                    key={it.id}
                    type="button"
                    onClick={() => setActiveId(it.id)}
                    className={cn(
                      "overflow-hidden rounded-lg border-2 transition-all",
                      it.id === activeId ? "border-primary" : "border-transparent opacity-70 hover:opacity-100",
                    )}
                    title={it.name}
                  >
                    <img src={it.url} alt="" className="h-14 w-14 object-cover" />
                  </button>
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard icon={<Wand2 className="h-4 w-4" />} title={__ui("预设效果")}>
            <div className="grid grid-cols-3 gap-1.5">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p.id)}
                  className={cn(
                    "rounded-lg border px-2 py-1.5 text-[11px] transition-colors",
                    preset === p.id
                      ? "border-primary bg-primary/10 font-semibold text-primary"
                      : "border-border/60 text-muted-foreground hover:bg-muted/40",
                  )}
                >
                  {__msg(p.name)}
                </button>
              ))}
            </div>
          </SectionCard>

          <SectionCard icon={<Sliders className="h-4 w-4" />} title={__ui("精细调整")}>
            <div className="space-y-3">
              {slider("brightness", "亮度", -100, 100)}
              {slider("contrast", "对比度", -100, 100)}
              {slider("saturation", "饱和度", -100, 100)}
              {slider("temperature", "色温（冷 ↔ 暖）", -100, 100)}
              {slider("sepia", "怀旧色调", 0, 100)}
              {slider("sharpen", "锐化", 0, 100)}
              {slider("blur", "模糊", 0, 20)}
              {slider("vignette", "暗角", 0, 100)}
              {slider("grain", "颗粒", 0, 100)}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => set("grayscale", !params.grayscale)}
                  className={cn(
                    "flex-1 rounded-lg border px-2 py-1.5 text-[11px] transition-colors",
                    params.grayscale ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border/60 text-muted-foreground hover:bg-muted/40",
                  )}
                >
                  {__ui("黑白")}</button>
                <button
                  type="button"
                  onClick={() => set("invert", !params.invert)}
                  className={cn(
                    "flex-1 rounded-lg border px-2 py-1.5 text-[11px] transition-colors",
                    params.invert ? "border-primary bg-primary/10 font-semibold text-primary" : "border-border/60 text-muted-foreground hover:bg-muted/40",
                  )}
                >
                  {__ui("反色")}</button>
                <button
                  type="button"
                  onClick={() => {
                    setParams(DEFAULT_PARAMS);
                    setPreset("original");
                  }}
                  className="flex-1 rounded-lg border border-border/60 px-2 py-1.5 text-[11px] text-muted-foreground transition-colors hover:bg-muted/40"
                >
                  {__ui("复位")}</button>
              </div>
            </div>
          </SectionCard>
        </div>

        <div className="thin-scroll space-y-4 lg:col-span-8">
          <SectionCard
            icon={<Aperture className="h-4 w-4" />}
            title={__ui("预览")}
            extra={
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onMouseDown={() => setCompare(true)}
                  onMouseUp={() => setCompare(false)}
                  onMouseLeave={() => setCompare(false)}
                  disabled={!active}
                >
                  {__ui("按住看原图")}</Button>
                <Button type="button" size="sm" className="gap-1.5" onClick={() => void doExport()} disabled={busy || !active}>
                  {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  {__ui("导出")}{items.length > 1 ? __msg("（{0} 张）", items.length) : ""}
                </Button>
              </div>
            }
          >
            {active ? (
              <>
                <div className="relative flex items-center justify-center overflow-hidden rounded-xl border border-border/60 bg-muted/20 p-2">
                  <canvas ref={canvasRef} className="max-h-[440px] w-auto max-w-full rounded-lg object-contain" />
                  {compare && (
                    <span className="absolute right-3 top-3 rounded-lg bg-background/90 px-2 py-1 text-[11px] text-foreground">{__ui("原图")}</span>
                  )}
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1.5">
                    <Gauge className="h-3.5 w-3.5" />
                    {__ui("原图")}{active.width}×{active.height}
                  </span>
                  <span className="flex items-center gap-1.5">
                    <RotateCw className="h-3.5 w-3.5" />
                    {__ui("预览等比缩放，导出按原尺寸")}</span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="if-format">{__ui("导出格式")}</Label>
                    <Select id="if-format" value={format} onChange={(e) => setFormat(e.target.value as "png" | "jpeg")} className="w-full text-xs">
                      <option value="jpeg">{__ui("JPEG（体积小）")}</option>
                      <option value="png">{__ui("PNG（无损）")}</option>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="if-quality">{__ui("JPEG 质量（")}{quality}）</Label>
                    <Input
                      id="if-quality"
                      type="number"
                      min={30}
                      max={100}
                      value={quality}
                      onChange={(e) => setQuality(e.target.value)}
                      disabled={format === "png"}
                      className="text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="if-max">{__ui("导出长边上限")}</Label>
                    <Input id="if-max" type="number" value={exportMax} onChange={(e) => setExportMax(e.target.value)} className="text-xs" />
                  </div>
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                  {__ui("长边上限用于控制导出体积（例如填 1920 会等比缩到长边 1920）。填 0 表示保持原始尺寸。 滤镜只改变像素颜色，不写入任何拍摄信息。")}</p>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center gap-2.5 py-20 text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Palette className="h-5 w-5" />
                </span>
                <p className="text-sm font-medium text-foreground">{__ui("选择图片后开始调色")}</p>
                <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
                  {__ui("内置 11 套预设，也可以逐项调整亮度、对比度、饱和度、色温、怀旧、锐化、模糊、暗角与颗粒。")}</p>
              </div>
            )}
          </SectionCard>

          <SectionCard icon={<Info className="h-4 w-4" />} title={__ui("说明")}>
            <ul className="space-y-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
              <li>{__ui("· 处理顺序为：模糊 → 亮度/对比度/饱和度/色温/怀旧/黑白/反色 → 锐化 → 暗角 → 颗粒，与常见修图软件的顺序一致。")}</li>
              <li>{__ui("· 预览为等比缩放后的画面，导出按原尺寸（或你设置的长边上限）重新完整计算一次，因此导出会比预览更精细。")}</li>
              <li>{__ui("· 全部在本机完成，图片不会上传。")}</li>
            </ul>
          </SectionCard>
        </div>
      </div>

      {error && <ErrorBar message={__msg(error)} />}
    </div>
  );
}


interface MetaItem {
  id: string;
  file: File;
  name: string;
  size: number;
  url: string;
  fields: MetaField[];
  orientation: number;
  note: string;
  status: "ready" | "done";
  outUrl?: string;
  outSize?: number;
}

// ══════════════════════════════════════════════════════════════════════
// 工具一：图片元数据清除
// ══════════════════════════════════════════════════════════════════════

export function ImageMetadataCleanTool() {
  const __locale = __useLanguage();
  const [items, setItems] = useState<MetaItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [format, setFormat] = useToolDraft<"png" | "jpeg">("image-metadata-clean", "format", "jpeg");
  const [quality, setQuality] = useToolDraft("image-metadata-clean", "quality", "95");
  const [showAll, setShowAll] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<MetaItem[]>([]);
  itemsRef.current = items;

  useEffect(() => {
    return () => {
      itemsRef.current.forEach((it) => {
        URL.revokeObjectURL(it.url);
        if (it.outUrl) URL.revokeObjectURL(it.outUrl);
      });
    };
  }, []);

  const addFiles = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setError(null);
    const next: MetaItem[] = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith("image/")) {
        setError(`「${file.name}」不是图片，已跳过`);
        continue;
      }
      try {
        const meta = await readMetadata(file);
        next.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          file,
          name: file.name,
          size: file.size,
          url: URL.createObjectURL(file),
          fields: meta.fields,
          orientation: meta.orientation,
          note: meta.note,
          status: "ready",
        });
      } catch {
        setError(`「${file.name}」读取失败，可能是文件损坏或格式特殊`);
      }
    }
    if (next.length) {
      setItems((prev) => [...prev, ...next]);
      setActiveId((prev) => prev ?? next[0].id);
    }
    setBusy(false);
  }, []);

  const clean = useCallback(
    async (target: MetaItem) => {
      const canvas = await drawUpright(target.file, 0);
      const q = Math.min(1, Math.max(0.3, Number(quality) / 100 || 0.95));
      const blob: Blob = await new Promise((res, rej) =>
        canvas.toBlob((b) => (b ? res(b) : rej(new Error("导出失败"))), format === "png" ? "image/png" : "image/jpeg", q),
      );
      return { url: URL.createObjectURL(blob), size: blob.size };
    },
    [format, quality],
  );

  const cleanAll = async () => {
    if (items.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const updated = [...items];
      for (let i = 0; i < updated.length; i++) {
        const it = updated[i];
        if (it.status === "done" && it.outUrl) URL.revokeObjectURL(it.outUrl);
        const out = await clean(it);
        updated[i] = { ...it, status: "done", outUrl: out.url, outSize: out.size };
      }
      setItems(updated);
    } catch (e) {
      setError(e instanceof Error ? e.message : "处理失败");
    } finally {
      setBusy(false);
    }
  };

  const downloadAll = async () => {
    const done = items.filter((it) => it.status === "done" && it.outUrl);
    if (done.length === 0) return;
    setBusy(true);
    try {
      if (done.length === 1) {
        const a = document.createElement("a");
        a.href = done[0].outUrl!;
        a.download = `已清除_${done[0].name.replace(/\.[^.]+$/, "")}.${format === "png" ? "png" : "jpg"}`;
        // ★ 游离的 <a> 直接 click() 在 WebView2 里会被忽略（点了没反应）——
    //   必须挂到 DOM 上再点，点完移除（通用结果卡那边用的是页面里的真链接，所以正常）
    document.body.appendChild(a);
    document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 1000);
    setTimeout(() => a.remove(), 1000);
      } else {
        const zip = new JSZip();
        for (const it of done) {
          const blob = await fetch(it.outUrl!).then((r) => r.blob());
          zip.file(`已清除_${it.name.replace(/\.[^.]+$/, "")}.${format === "png" ? "png" : "jpg"}`, blob);
        }
        const out = await zip.generateAsync({ type: "blob" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(out);
        a.download = `已清除元数据_${done.length}张.zip`;
        // ★ 游离的 <a> 直接 click() 在 WebView2 里会被忽略（点了没反应）——
    //   必须挂到 DOM 上再点，点完移除（通用结果卡那边用的是页面里的真链接，所以正常）
    document.body.appendChild(a);
    document.body.appendChild(a);
  a.click();
  setTimeout(() => a.remove(), 1000);
    setTimeout(() => a.remove(), 1000);
        setTimeout(() => URL.revokeObjectURL(a.href), 5000);
      }
    } finally {
      setBusy(false);
    }
  };

  const active = items.find((it) => it.id === activeId) || null;
  const sensitiveCount = items.reduce((s, it) => s + it.fields.filter((f) => f.sensitive).length, 0);
  const gpsCount = items.filter((it) => it.fields.some((f) => f.key === "GPS 坐标")).length;
  const shownFields = active ? (showAll ? active.fields : active.fields.slice(0, 12)) : [];

  return (
    <div className="space-y-4">
      <div className="grid gap-5 lg:grid-cols-12">
        <div className="thin-scroll space-y-4 lg:col-span-5">
          <SectionCard
            icon={<Shield className="h-4 w-4" />}
            title={__ui("添加图片")}
            extra={
              items.length > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1.5"
                  onClick={() => {
                    items.forEach((it) => {
                      URL.revokeObjectURL(it.url);
                      if (it.outUrl) URL.revokeObjectURL(it.outUrl);
                    });
                    setItems([]);
                    setActiveId(null);
                  }}
                >
                  <Eraser className="h-3.5 w-3.5" /> {__ui("清空")}</Button>
              ) : null
            }
          >
            <div data-furinakit-file-field className="space-y-0">
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="flex w-full flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-border/60 bg-muted/20 p-6 text-center transition-colors hover:bg-muted/30"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                {busy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Upload className="h-5 w-5" />}
              </span>
              <span className="text-xs font-semibold text-foreground">{__ui("点击选择图片（支持多选批量）")}</span>
              <span className="text-[11px] text-muted-foreground">{__ui("支持 JPEG / PNG；检测与清除均在本机完成")}</span>
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                void addFiles(e.target.files);
                e.target.value = "";
              }}
            /></div>

            {items.length > 0 && (
              <>
                <div className="mt-3 grid grid-cols-3 gap-2">
                  <div className="rounded-xl border border-border/60 bg-secondary/20 px-3 py-2">
                    <div className="text-[11px] text-muted-foreground">{__ui("图片")}</div>
                    <div className="mt-0.5 font-mono text-sm font-semibold text-foreground">{__count(items.length, "张")} </div>
                  </div>
                  <div className={cn("rounded-xl border px-3 py-2", gpsCount > 0 ? "border-destructive/40 bg-destructive/10" : "border-border/60 bg-secondary/20")}>
                    <div className="text-[11px] text-muted-foreground">{__ui("含定位")}</div>
                    <div className={cn("mt-0.5 font-mono text-sm font-semibold", gpsCount > 0 ? "text-destructive" : "text-foreground")}>
                      {__count(gpsCount, "张")} </div>
                  </div>
                  <div className="rounded-xl border border-border/60 bg-secondary/20 px-3 py-2">
                    <div className="text-[11px] text-muted-foreground">{__ui("敏感字段")}</div>
                    <div className="mt-0.5 font-mono text-sm font-semibold text-foreground">{__count(sensitiveCount, "项")} </div>
                  </div>
                </div>

                <div className="mt-3 space-y-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="mc-format">{__ui("输出格式")}</Label>
                      <Select id="mc-format" value={format} onChange={(e) => setFormat(e.target.value as "png" | "jpeg")} className="w-full text-xs">
                        <option value="jpeg">{__ui("JPEG（体积小）")}</option>
                        <option value="png">{__ui("PNG（无损）")}</option>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="mc-quality">{__ui("JPEG 质量（")}{quality}）</Label>
                      <Input
                        id="mc-quality"
                        type="number"
                        min={30}
                        max={100}
                        value={quality}
                        onChange={(e) => setQuality(e.target.value)}
                        disabled={format === "png"}
                        className="text-xs"
                      />
                    </div>
                  </div>
                  <p className="text-[11px] leading-relaxed text-muted-foreground">
                    {__ui("清除方式为重新编码：新文件只包含像素数据，原始拍摄信息与定位信息全部不再写入。 图片会先按方向标记转正再重绘，因此画面不会变歪。")}</p>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" className="flex-1 gap-1.5" onClick={() => void cleanAll()} disabled={busy}>
                      {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
                      {__ui("一键清除全部")}</Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="gap-1.5"
                      onClick={() => void downloadAll()}
                      disabled={busy || !items.some((it) => it.status === "done")}
                    >
                      <Download className="h-3.5 w-3.5" /> {__ui("下载结果")}</Button>
                  </div>
                </div>

                <div className="mt-3 space-y-2">
                  {items.map((it) => (
                    <div
                      key={it.id}
                      onClick={() => setActiveId(it.id)}
                      className={cn(
                        "flex cursor-pointer items-center gap-3 rounded-xl border p-2.5 transition-colors",
                        it.id === activeId ? "border-primary/50 bg-primary/[0.07]" : "border-border/60 hover:bg-muted/30",
                      )}
                    >
                      <img src={it.url} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] font-medium text-foreground">{it.name}</div>
                        <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-muted-foreground">
                          <span>{__ui(it.note)}</span>
                          {it.fields.some((f) => f.key === "GPS 坐标") && (
                            <Badge variant="outline" className="border-destructive/50 font-normal text-destructive">
                              {__ui("含定位")}</Badge>
                          )}
                          {it.fields.length === 0 && <span className="text-emerald-600 dark:text-emerald-400">{__ui("未检出元数据")}</span>}
                        </div>
                      </div>
                      {it.status === "done" ? (
                        <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                      ) : (
                        <span className="shrink-0 text-[10.5px] text-muted-foreground">{__ui("待清除")}</span>
                      )}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          URL.revokeObjectURL(it.url);
                          if (it.outUrl) URL.revokeObjectURL(it.outUrl);
                          setItems((prev) => prev.filter((x) => x.id !== it.id));
                          setActiveId((prev) => (prev === it.id ? null : prev));
                        }}
                        className="shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                        aria-label={__ui("移除")}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            )}

            {error && <div className="mt-3"><ErrorBar message={__msg(error)} /></div>}
          </SectionCard>

          <SectionCard icon={<Info className="h-4 w-4" />} title={__ui("关于图片元数据")}>
            <ul className="space-y-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
              <li>{__ui("· 手机与相机拍的照片通常会写入：设备厂商与型号、拍摄时间、光圈快门 ISO 焦距、处理软件，部分还带有")}<b className="text-foreground">{__ui("精确的 GPS 坐标")}</b>。</li>
              <li>{__ui("· 把这类照片原图发到公开场合，任何人都能读出拍摄地点与设备型号。")}</li>
              <li>{__ui("· 社交平台通常会自行抹掉元数据，但")}<b className="text-foreground">{__ui("以原图 / 文件方式发送时不会")}</b>{__ui("，本工具用于这种情况。")}</li>
              <li>{__ui("· 截图类图片一般不含元数据；若这里显示\"未检出\"，说明无需处理。")}</li>
            </ul>
          </SectionCard>
        </div>

        <div className="thin-scroll space-y-4 lg:col-span-7">
          {active ? (
            <>
              <SectionCard
                icon={<Camera className="h-4 w-4" />}
                title={__msg("检出内容 · {0}", active.name)}
                extra={
                  active.fields.length > 0 ? (
                    <button type="button" onClick={() => setShowAll((v) => !v)} className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                      {showAll ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      {showAll ? __ui("收起") : __msg("展开全部 {0} 项", active.fields.length)}
                    </button>
                  ) : null
                }
              >
                {active.fields.length === 0 ? (
                  <div className="flex flex-col items-center gap-2 py-10 text-center">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-500">
                      <ShieldCheck className="h-5 w-5" />
                    </span>
                    <p className="text-sm font-medium text-foreground">{__ui("未检出元数据")}</p>
                    <p className="max-w-sm text-xs leading-relaxed text-muted-foreground">
                      {__ui(active.note)}{__ui("。这张图不含拍摄信息或定位信息，无需清除。")}</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {gpsCount > 0 && active.fields.some((f) => f.key === "GPS 坐标") && (
                      <div className="flex items-start gap-2 rounded-xl border-l-4 border-l-destructive bg-destructive/10 px-3 py-2.5">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
                        <div className="text-[12px] leading-relaxed text-foreground">
                          <b>{__ui("这张图带有 GPS 定位信息")}</b>{__ui("，坐标见下表。分享原图前建议先清除。")}</div>
                      </div>
                    )}
                    <div className="overflow-hidden rounded-xl border border-border/60">
                      <table className="w-full border-collapse text-xs">
                        <thead>
                          <tr className="bg-muted/60">
                            <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("分类")}</th>
                            <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("字段")}</th>
                            <th className="px-3 py-2 text-left font-semibold text-foreground">{__ui("内容")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {shownFields.map((f, i) => (
                            <tr key={`${f.key}-${i}`} className="border-t border-border/40 even:bg-muted/20">
                              <td className="whitespace-nowrap px-3 py-1.5 text-muted-foreground">{f.group}</td>
                              <td className="whitespace-nowrap px-3 py-1.5 text-foreground">
                                {f.key}
                                {f.sensitive && <span className="ml-1.5 text-[10px] text-destructive">{__ui("敏感")}</span>}
                              </td>
                              <td className="max-w-[280px] break-all px-3 py-1.5 font-mono text-[11.5px] text-muted-foreground">{f.value}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </SectionCard>

              <SectionCard icon={<ImageIcon className="h-4 w-4" />} title={__ui("清除前后对比")}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-2">
                    <div className="text-[11.5px] font-medium text-foreground">{__ui("清除前")}</div>
                    <img src={active.url} alt="" className="max-h-[260px] w-full rounded-xl border border-border/60 object-contain" />
                    <div className="text-[11px] text-muted-foreground">
                      {__ui("文件大小")}{Math.round(active.size / 1024)} KB
                      {active.fields.some((f) => f.key === "方向标记") &&
                        __msg(" · 方向：{0}", active.fields.find((f) => f.key === "方向标记")?.value)}
                    </div>
                  </div>
                  <div className="space-y-2">
                    <div className="text-[11.5px] font-medium text-foreground">{__ui("清除后")}</div>
                    {active.outUrl ? (
                      <>
                        <img src={active.outUrl} alt="" className="max-h-[260px] w-full rounded-xl border border-emerald-500/40 object-contain" />
                        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                          <span>
                            {__ui("文件大小")}{active.outSize ? Math.round(active.outSize / 1024) : 0} KB
                          </span>
                          <Badge variant="outline" className="border-emerald-500/40 font-normal text-emerald-600 dark:text-emerald-400">
                            {__ui("已无拍摄信息")}</Badge>
                        </div>
                      </>
                    ) : (
                      <div className="flex h-[260px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border/60 text-center">
                        <Sparkles className="h-5 w-5 text-muted-foreground" />
                        <p className="text-xs text-muted-foreground">{__ui("点击左侧「一键清除全部」查看处理结果")}</p>
                      </div>
                    )}
                  </div>
                </div>
                {active.outUrl && (
                  <div className="mt-3 flex gap-2">
                    <a
                      href={active.outUrl}
                      download={`已清除_${active.name.replace(/\.[^.]+$/, "")}.${format === "png" ? "png" : "jpg"}`}
                      className="inline-flex"
                    >
                      <Button type="button" size="sm" className="gap-1.5">
                        <Download className="h-3.5 w-3.5" /> {__ui("下载这张")}</Button>
                    </a>
                    <span className="self-center text-[11px] text-muted-foreground">
                      {__ui("画面与原图一致，仅去掉了文件里的附加信息")}</span>
                  </div>
                )}
              </SectionCard>
            </>
          ) : (
            <SectionCard>
              <div className="flex flex-col items-center justify-center gap-2.5 py-20 text-center">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Camera className="h-5 w-5" />
                </span>
                <p className="text-sm font-medium text-foreground">{__ui("先看看照片里藏了什么")}</p>
                <p className="max-w-md text-xs leading-relaxed text-muted-foreground">
                  {__ui("添加图片后会列出全部可读到的拍摄信息与定位信息，再一键清除。 文字自动识别类信息（如截图里的内容）不在元数据范围内。")}</p>
              </div>
            </SectionCard>
          )}
        </div>
      </div>
    </div>
  );
}
