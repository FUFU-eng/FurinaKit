"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import JSZip from "jszip";
import {
  Shuffle,
  Download,
  Upload,
  Sparkles,
  Sliders,
  CheckCircle2,
  AlertCircle,
  RotateCw,
  Layers,
  Key,
  ChevronsLeftRight,
  Trash2,
  Image as ImageIcon,
} from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { cn, formatBytes } from "@/lib/utils";
import { trackToolUsage } from "@/lib/analytics";

// ==========================================
// 算法 1：广义空间填充曲线（Gilbert Space-Filling Curve）
// ==========================================
function gilbert2d(
  x: number,
  y: number,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  coords: number[]
) {
  const w = Math.abs(ax + ay);
  const h = Math.abs(bx + by);
  const dax = Math.sign(ax);
  const day = Math.sign(ay);
  const dbx = Math.sign(bx);
  const dby = Math.sign(by);

  if (h === 1) {
    for (let i = 0; i < w; i++) {
      coords.push(x, y);
      x += dax;
      y += day;
    }
    return;
  }
  if (w === 1) {
    for (let i = 0; i < h; i++) {
      coords.push(x, y);
      x += dbx;
      y += dby;
    }
    return;
  }

  let ax2 = Math.trunc(ax / 2);
  let ay2 = Math.trunc(ay / 2);
  let bx2 = Math.trunc(bx / 2);
  let by2 = Math.trunc(by / 2);

  const w2 = Math.abs(ax2 + ay2);
  const h2 = Math.abs(bx2 + by2);

  if (2 * w > 3 * h) {
    if (w2 % 2 && w > 2) {
      ax2 += dax;
      ay2 += day;
    }
    gilbert2d(x, y, ax2, ay2, bx, by, coords);
    gilbert2d(x + ax2, y + ay2, ax - ax2, ay - ay2, bx, by, coords);
    return;
  }

  if (h2 % 2 && h > 2) {
    bx2 += dbx;
    by2 += dby;
  }

  gilbert2d(x, y, bx2, by2, ax2, ay2, coords);
  gilbert2d(x + bx2, y + by2, ax, ay, bx - bx2, by - by2, coords);
  gilbert2d(
    x + (ax - dax) + (bx2 - dbx),
    y + (ay - day) + (by2 - dby),
    -bx2,
    -by2,
    -(ax - ax2),
    -(ay - ay2),
    coords
  );
}

function processGilbertCurve(
  imageData: ImageData,
  mode: "scramble" | "restore"
): ImageData {
  const { width: w, height: h, data } = imageData;
  const totalPixels = w * h;
  const coords: number[] = [];
  gilbert2d(0, 0, w, 0, 0, h, coords);

  const step = Math.round(((Math.sqrt(5) - 1) / 2) * totalPixels);
  const out = new ImageData(new Uint8ClampedArray(data), w, h);
  const src = data;
  const dst = out.data;

  for (let i = 0; i < totalPixels; i++) {
    const targetIndex =
      mode === "scramble"
        ? (i + step) % totalPixels
        : (i - step + totalPixels) % totalPixels;

    const srcX = coords[i * 2];
    const srcY = coords[i * 2 + 1];
    const dstX = coords[targetIndex * 2];
    const dstY = coords[targetIndex * 2 + 1];

    const srcPos = (srcY * w + srcX) * 4;
    const dstPos = (dstY * w + dstX) * 4;

    dst[dstPos] = src[srcPos];
    dst[dstPos + 1] = src[srcPos + 1];
    dst[dstPos + 2] = src[srcPos + 2];
    dst[dstPos + 3] = src[srcPos + 3];
  }

  return out;
}

// ==========================================
// 算法 2：YBZJ 混沌像素映射 (Logistic Map & 5 大混淆模式)
// ==========================================
function strToSeed(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  const val = Math.abs(hash) / 2147483648;
  return val === 0 ? 0.666 : val;
}

function parseChaosKey(keyStr: string): number {
  const num = parseFloat(keyStr);
  if (!isNaN(num) && num > 0 && num < 1) {
    return num;
  }
  return strToSeed(keyStr || "0.666");
}

function getChaosSequence(length: number, seed: number): number[] {
  const arr: number[] = new Array(length);
  let x = seed;
  for (let i = 0; i < length; i++) {
    x = 3.9999999 * x * (1 - x);
    arr[i] = x;
  }
  return arr;
}

/** 混沌序列是否已经退化（取值几乎全都相同） */
function isDegenerateSequence(seq: number[]): boolean {
  if (seq.length < 2) return true;
  let min = Infinity;
  let max = -Infinity;
  for (const v of seq) {
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return !(max - min > 1e-12);
}

function getChaosPermutation(length: number, seed: number): number[] {
  // 注意：logistic 映射在个别密钥下会退化。例如取 r=3.9999999 时不动点是
  // x* = 1 - 1/r ≈ 0.74999999375，密钥填 0.75 迭代几十次后所有取值在 double 精度下
  // 完全相同，排序结果就是「恒等置换」—— 界面提示"已加密"，实际一个像素都没动。
  // 这里检测到退化就确定性地扰动密钥重试，保证同一密钥每次得到同一结果。
  let currentSeed = seed;
  for (let attempt = 0; attempt < 8; attempt++) {
    const seq = getChaosSequence(length, currentSeed);
    if (!isDegenerateSequence(seq)) {
      const indices = Array.from({ length }, (_, i) => i);
      indices.sort((a, b) => seq[a] - seq[b]);
      return indices;
    }
    // 用黄金比例做确定性偏移，避免随机性（否则解混淆无法还原）
    currentSeed = (currentSeed + 0.6180339887498949) % 1;
    if (!(currentSeed > 0 && currentSeed < 1)) currentSeed = 0.6180339887498949;
  }

  const seq = getChaosSequence(length, currentSeed);
  const indices = Array.from({ length }, (_, i) => i);
  indices.sort((a, b) => seq[a] - seq[b]);
  return indices;
}

// 5 种模式的混淆与解混淆
function processYbzj(
  imageData: ImageData,
  mode: "scramble" | "restore",
  type: "block" | "row_pixel" | "pixel" | "row_mode" | "row_col",
  keyVal: string
): ImageData {
  const { width: w, height: h, data } = imageData;
  const seed = parseChaosKey(keyVal);
  const out = new ImageData(new Uint8ClampedArray(data), w, h);
  const src = data;
  const dst = out.data;

  if (type === "pixel") {
    // 全像素混沌打乱
    const total = w * h;
    const perm = getChaosPermutation(total, seed);
    if (mode === "scramble") {
      for (let i = 0; i < total; i++) {
        const destI = perm[i];
        const s = i * 4;
        const d = destI * 4;
        dst[d] = src[s];
        dst[d + 1] = src[s + 1];
        dst[d + 2] = src[s + 2];
        dst[d + 3] = src[s + 3];
      }
    } else {
      for (let i = 0; i < total; i++) {
        const destI = perm[i];
        const s = destI * 4;
        const d = i * 4;
        dst[d] = src[s];
        dst[d + 1] = src[s + 1];
        dst[d + 2] = src[s + 2];
        dst[d + 3] = src[s + 3];
      }
    }
  } else if (type === "row_pixel") {
    // 逐行内像素打乱
    const perm = getChaosPermutation(w, seed);
    for (let y = 0; y < h; y++) {
      const rowOffset = y * w * 4;
      if (mode === "scramble") {
        for (let x = 0; x < w; x++) {
          const destX = perm[x];
          const s = rowOffset + x * 4;
          const d = rowOffset + destX * 4;
          dst[d] = src[s];
          dst[d + 1] = src[s + 1];
          dst[d + 2] = src[s + 2];
          dst[d + 3] = src[s + 3];
        }
      } else {
        for (let x = 0; x < w; x++) {
          const destX = perm[x];
          const s = rowOffset + destX * 4;
          const d = rowOffset + x * 4;
          dst[d] = src[s];
          dst[d + 1] = src[s + 1];
          dst[d + 2] = src[s + 2];
          dst[d + 3] = src[s + 3];
        }
      }
    }
  } else if (type === "row_mode") {
    // 行置乱模式 (PE1)
    const perm = getChaosPermutation(h, seed);
    const rowBytes = w * 4;
    for (let y = 0; y < h; y++) {
      const targetY = perm[y];
      const srcRow = (mode === "scramble" ? y : targetY) * rowBytes;
      const dstRow = (mode === "scramble" ? targetY : y) * rowBytes;
      for (let i = 0; i < rowBytes; i++) {
        dst[dstRow + i] = src[srcRow + i];
      }
    }
  } else if (type === "row_col") {
    // 行列置乱模式 (PE2)
    const rowPerm = getChaosPermutation(h, seed);
    const colPerm = getChaosPermutation(w, seed);

    if (mode === "scramble") {
      for (let y = 0; y < h; y++) {
        const ny = rowPerm[y];
        for (let x = 0; x < w; x++) {
          const nx = colPerm[x];
          const s = (y * w + x) * 4;
          const d = (ny * w + nx) * 4;
          dst[d] = src[s];
          dst[d + 1] = src[s + 1];
          dst[d + 2] = src[s + 2];
          dst[d + 3] = src[s + 3];
        }
      }
    } else {
      for (let y = 0; y < h; y++) {
        const ny = rowPerm[y];
        for (let x = 0; x < w; x++) {
          const nx = colPerm[x];
          const s = (ny * w + nx) * 4;
          const d = (y * w + x) * 4;
          dst[d] = src[s];
          dst[d + 1] = src[s + 1];
          dst[d + 2] = src[s + 2];
          dst[d + 3] = src[s + 3];
        }
      }
    }
  } else {
    // 方块混淆 (32x32 像素块置乱)
    //
    // 关键：只对「完整落在图像内的方块」做置换，右侧/底部不足一整块的边缘区域保持原样。
    // 旧实现按 ceil(w/32) × ceil(h/32) 生成置换，但边缘的不完整方块「读」和「写」的矩形
    // 不一致（写入范围由来源方块决定、读走范围由目标方块决定），于是有些像素在被覆盖之前
    // 从未被搬到别处 —— 结果不可逆、永久丢像素，而界面却承诺「完全可逆、无损还原」。
    // 限制在完整方块内之后，置换是这些方块之间的双射，scramble 与 restore 严格互逆。
    const blockSize = 32;
    const fullCols = Math.floor(w / blockSize);
    const fullRows = Math.floor(h / blockSize);
    const totalBlocks = fullCols * fullRows;

    // 少于 2 个完整方块时置换没有意义（等价于原图），此时保持原样即可
    if (totalBlocks >= 2) {
      const perm = getChaosPermutation(totalBlocks, seed);

      for (let bi = 0; bi < totalBlocks; bi++) {
        const targetBi = perm[bi];
        const srcBlock = mode === "scramble" ? bi : targetBi;
        const dstBlock = mode === "scramble" ? targetBi : bi;

        const srcBx = srcBlock % fullCols;
        const srcBy = Math.floor(srcBlock / fullCols);
        const dstBx = dstBlock % fullCols;
        const dstBy = Math.floor(dstBlock / fullCols);

        for (let py = 0; py < blockSize; py++) {
          const sy = srcBy * blockSize + py;
          const dy = dstBy * blockSize + py;

          for (let px = 0; px < blockSize; px++) {
            const sx = srcBx * blockSize + px;
            const dx = dstBx * blockSize + px;

            const s = (sy * w + sx) * 4;
            const d = (dy * w + dx) * 4;
            dst[d] = src[s];
            dst[d + 1] = src[s + 1];
            dst[d + 2] = src[s + 2];
            dst[d + 3] = src[s + 3];
          }
        }
      }
    }
  }

  return out;
}

interface ImageItem {
  id: string;
  file: File;
  name: string;
  size: number;
  originalUrl: string;
  processedUrl?: string;
  processedBlob?: Blob;
  status: "idle" | "processing" | "done" | "error";
  error?: string;
}

// ==========================================================================
// 模块级缓存：离开页面（切到别的工具、回首页）再回来时，恢复图片、混淆结果与参数。
//
// 为什么必须是模块级：File / Blob 无法序列化进 storage，组件卸载后 useState 就清空了。
// 做法与 fileHideCache、imagesToPdfCache、tool-runner 的 toolDraftCache 一致。
//
// 为什么 object URL 也归缓存持有：原图与混淆结果的链接以前只会在「清空列表」时释放，
// 组件卸载时既不释放（泄漏）也无法还原（回来一看链接可能已经断了）。
// 现在链接统一归缓存持有，只在三种情况下释放：
//   ① 那张图 / 那份结果被换成新的一份（重新选图、重新处理）
//   ② 用户移除 / 清空列表
//   ③ 缓存条目被淘汰
// 判断依据是「上一份快照里的链接与新一份是否还是同一条」，不是每次保存都释放；
// 恢复时直接复用缓存里的链接，绝不重新 createObjectURL。
// ==========================================================================
interface ObfuscateCacheEntry {
  items: ImageItem[];
  algoMode: "gilbert" | "ybzj";
  direction: "scramble" | "restore";
  ybzjType: "block" | "row_pixel" | "pixel" | "row_mode" | "row_col";
  chaosKey: string;
  selectedIndex: number;
  sliderPos: number;
}

const OBFUSCATE_CACHE_KEY = "image-obfuscate";
/** 最多保留 6 个条目，与 tool-runner 的 TOOL_DRAFT_LIMIT 对齐；本工具只用一个 key，实际只占 1 份 */
const OBFUSCATE_CACHE_LIMIT = 6;
const obfuscateCache = new Map<string, ObfuscateCacheEntry>();

const OBFUSCATE_CACHE_DEFAULTS = {
  algoMode: "gilbert" as "gilbert" | "ybzj",
  direction: "scramble" as "scramble" | "restore",
  ybzjType: "pixel" as "block" | "row_pixel" | "pixel" | "row_mode" | "row_col",
  chaosKey: "0.666",
  selectedIndex: 0,
  sliderPos: 50,
};

/** 释放单张图片占用的 object URL；原图与结果是两条不同的链接，各释放一次 */
function releaseObfuscateItem(item: ImageItem): void {
  if (item.originalUrl) URL.revokeObjectURL(item.originalUrl);
  if (item.processedUrl && item.processedUrl !== item.originalUrl) {
    URL.revokeObjectURL(item.processedUrl);
  }
}

/** 恢复用快照：浅拷贝一份，避免运行期的原地改动写进缓存 */
function snapshotObfuscateItems(items: ImageItem[]): ImageItem[] {
  return items.map((it) => ({ ...it }));
}

/** 从缓存恢复图片列表（处理中的项回退到「待处理」，免得回来时永远转圈） */
function readObfuscateItems(): ImageItem[] {
  const cached = obfuscateCache.get(OBFUSCATE_CACHE_KEY);
  if (!cached) return [];
  return snapshotObfuscateItems(cached.items).map((it) => ({
    ...it,
    status: it.status === "processing" ? "idle" : it.status,
  }));
}

/** 从缓存恢复「当前查看第几张」，并夹在列表范围内，避免恢复后右侧空白 */
function readObfuscateSelectedIndex(): number {
  const cached = obfuscateCache.get(OBFUSCATE_CACHE_KEY);
  if (!cached) return OBFUSCATE_CACHE_DEFAULTS.selectedIndex;
  const max = cached.items.length - 1;
  if (max < 0) return 0;
  return Math.min(Math.max(0, cached.selectedIndex), max);
}

/** 写入缓存：先释放被替换 / 被移除的链接，再按最近使用顺序存入并做上限淘汰 */
function rememberObfuscateEntry(key: string, entry: ObfuscateCacheEntry): void {
  const previous = obfuscateCache.get(key);

  if (previous) {
    const nextById = new Map(entry.items.map((it) => [it.id, it]));
    previous.items.forEach((prevItem) => {
      const nextItem = nextById.get(prevItem.id);
      if (!nextItem) {
        // 用户移除单项 / 清空列表
        releaseObfuscateItem(prevItem);
        return;
      }
      // 原图换了新的一份才释放旧链接
      if (prevItem.originalUrl !== nextItem.originalUrl) {
        URL.revokeObjectURL(prevItem.originalUrl);
      }
      // 结果换了新的一份才释放旧链接（重新处理 / 重新选图都会换）
      if (
        prevItem.processedUrl &&
        prevItem.processedUrl !== prevItem.originalUrl &&
        prevItem.processedUrl !== nextItem.processedUrl
      ) {
        URL.revokeObjectURL(prevItem.processedUrl);
      }
    });
  }

  // 先删再存：让 Map 的迭代顺序等于「最近使用顺序」
  obfuscateCache.delete(key);
  obfuscateCache.set(key, { ...entry, items: snapshotObfuscateItems(entry.items) });

  while (obfuscateCache.size > OBFUSCATE_CACHE_LIMIT) {
    const oldestKey = obfuscateCache.keys().next().value;
    if (oldestKey === undefined) break;
    const oldest = obfuscateCache.get(oldestKey);
    if (oldest) oldest.items.forEach((it) => releaseObfuscateItem(it));
    obfuscateCache.delete(oldestKey);
  }
}

export function ImageObfuscateTool() {
  const { toast } = useToast();
  const [algoMode, setAlgoMode] = useState<"gilbert" | "ybzj">(
    () => obfuscateCache.get(OBFUSCATE_CACHE_KEY)?.algoMode ?? OBFUSCATE_CACHE_DEFAULTS.algoMode
  );
  const [direction, setDirection] = useState<"scramble" | "restore">(
    () => obfuscateCache.get(OBFUSCATE_CACHE_KEY)?.direction ?? OBFUSCATE_CACHE_DEFAULTS.direction
  );

  // YBZJ 设置
  const [ybzjType, setYbzjType] = useState<"block" | "row_pixel" | "pixel" | "row_mode" | "row_col">(
    () => obfuscateCache.get(OBFUSCATE_CACHE_KEY)?.ybzjType ?? OBFUSCATE_CACHE_DEFAULTS.ybzjType
  );
  const [chaosKey, setChaosKey] = useState<string>(
    () => obfuscateCache.get(OBFUSCATE_CACHE_KEY)?.chaosKey ?? OBFUSCATE_CACHE_DEFAULTS.chaosKey
  );

  // 批量图片列表与当前选中项（挂载时从模块级缓存恢复）
  const [items, setItems] = useState<ImageItem[]>(() => readObfuscateItems());
  const [selectedIndex, setSelectedIndex] = useState<number>(() => readObfuscateSelectedIndex());
  const [isProcessing, setIsProcessing] = useState(false);

  // 对比滑块
  const [sliderPos, setSliderPos] = useState<number>(
    () => obfuscateCache.get(OBFUSCATE_CACHE_KEY)?.sliderPos ?? OBFUSCATE_CACHE_DEFAULTS.sliderPos
  );
  const [isDragging, setIsDragging] = useState(false);
  const compareRef = useRef<HTMLDivElement>(null);

  // 离开本工具（组件卸载）时不做任何释放 —— 原图与结果的链接归缓存持有，
  // 这样回来时预览、对比滑块、下载按钮都还能用。释放时机见 rememberObfuscateEntry()。
  // 每次变化都写回缓存，保证离开时缓存里是最新的。
  useEffect(() => {
    rememberObfuscateEntry(OBFUSCATE_CACHE_KEY, {
      items,
      algoMode,
      direction,
      ybzjType,
      chaosKey,
      selectedIndex,
      sliderPos,
    });
  }, [items, algoMode, direction, ybzjType, chaosKey, selectedIndex, sliderPos]);

  const updateSlider = useCallback((clientX: number) => {
    if (!compareRef.current) return;
    const rect = compareRef.current.getBoundingClientRect();
    const pct = ((clientX - rect.left) / rect.width) * 100;
    setSliderPos(Math.min(100, Math.max(0, pct)));
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (isDragging) updateSlider(e.clientX);
    };
    const onTouch = (e: TouchEvent) => {
      if (isDragging && e.touches.length > 0) updateSlider(e.touches[0].clientX);
    };
    const onUp = () => setIsDragging(false);

    if (isDragging) {
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
      window.addEventListener("touchmove", onTouch);
      window.addEventListener("touchend", onUp);
    }
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      window.removeEventListener("touchmove", onTouch);
      window.removeEventListener("touchend", onUp);
    };
  }, [isDragging, updateSlider]);

  // 添加文件
  const handleAddFiles = (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const files = Array.from(fileList).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) return;

    const newItems: ImageItem[] = files.map((file, idx) => ({
      id: `obf_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 6)}`,
      file,
      name: file.name,
      size: file.size,
      originalUrl: URL.createObjectURL(file),
      status: "idle",
    }));

    setItems((prev) => [...prev, ...newItems]);
  };

  // 移除单个文件
  const handleRemoveItem = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setItems((prev) => {
      const filtered = prev.filter((it) => it.id !== id);
      if (selectedIndex >= filtered.length) {
        setSelectedIndex(Math.max(0, filtered.length - 1));
      }
      return filtered;
    });
  };

  // 清空列表：这里不再手动 revoke —— 链接归缓存所有，setItems([]) 之后由
  // rememberObfuscateEntry 判定「上一份有、新一份没有」统一释放，恰好一次。
  const handleClearAll = () => {
    setItems([]);
    setSelectedIndex(0);
  };

  // 处理单张图片算法执行（纯离线 Canvas 运算）
  const processImageFile = async (
    file: File
  ): Promise<{ blob: Blob; url: string }> => {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const tempUrl = URL.createObjectURL(file);
      img.src = tempUrl;

      img.onload = () => {
        URL.revokeObjectURL(tempUrl);
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d", { willReadFrequently: true });
        if (!ctx) {
          reject(new Error("无法获取 Canvas 上下文"));
          return;
        }

        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);

        let processed: ImageData;
        if (algoMode === "gilbert") {
          processed = processGilbertCurve(imgData, direction);
        } else {
          processed = processYbzj(imgData, direction, ybzjType, chaosKey);
        }

        ctx.putImageData(processed, 0, 0);

        canvas.toBlob((blob) => {
          if (!blob) {
            reject(new Error("Canvas 输出 Blob 失败"));
            return;
          }
          const outUrl = URL.createObjectURL(blob);
          resolve({ blob, url: outUrl });
        }, "image/png");
      };

      img.onerror = () => {
        URL.revokeObjectURL(tempUrl);
        reject(new Error("图片加载失败"));
      };
    });
  };

  // 开始执行批量/单张处理
  const handleStartProcess = async () => {
    if (items.length === 0 || isProcessing) return;
    setIsProcessing(true);
    trackToolUsage("image-obfuscate");

    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      setItems((prev) =>
        prev.map((it, idx) => (idx === i ? { ...it, status: "processing" } : it))
      );

      try {
        const { blob, url } = await processImageFile(item.file);
        setItems((prev) =>
          prev.map((it, idx) =>
            idx === i
              ? {
                  ...it,
                  status: "done",
                  processedUrl: url,
                  processedBlob: blob,
                }
              : it
          )
        );
      } catch (err) {
        setItems((prev) =>
          prev.map((it, idx) =>
            idx === i
              ? {
                  ...it,
                  status: "error",
                  error: err instanceof Error ? err.message : "处理失败",
                }
              : it
          )
        );
      }
    }

    setIsProcessing(false);
    toast({
      title: direction === "scramble" ? "混淆处理完成！" : "解混淆还原完成！",
      description: `已处理 ${items.length} 张图片`,
      variant: "success",
    });
  };

  // 打包下载所有结果为 ZIP
  const handleDownloadAllZip = async () => {
    const doneItems = items.filter((it) => it.status === "done" && it.processedBlob);
    if (doneItems.length === 0) return;

    const zip = new JSZip();
    for (const it of doneItems) {
      const prefix = direction === "scramble" ? "obfuscated" : "restored";
      const baseName = it.name.replace(/\.[^.]+$/, "");
      zip.file(`${baseName}_${prefix}.png`, it.processedBlob!);
    }

    const zipBlob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(zipBlob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `FurinaKit_${direction === "scramble" ? "混淆" : "还原"}_${Date.now()}.zip`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const currentItem = items[selectedIndex] || null;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      {/* 方向切换：混淆打乱 / 解混淆还原 */}
      <div className="flex w-fit rounded-xl bg-muted/60 p-1 border border-border/40">
        <button
          onClick={() => setDirection("scramble")}
          className={cn(
            "flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg transition-all",
            direction === "scramble"
              ? "bg-indigo-500 text-white shadow-sm font-bold"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Shuffle className="h-3.5 w-3.5" />
          混淆打乱 (加密)
        </button>
        <button
          onClick={() => setDirection("restore")}
          className={cn(
            "flex items-center gap-1.5 px-4 py-2 text-xs font-semibold rounded-lg transition-all",
            direction === "restore"
              ? "bg-emerald-500 text-white shadow-sm font-bold"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Sparkles className="h-3.5 w-3.5" />
          解混淆还原 (解密)
        </button>
      </div>

      {/* 算法模式与参数控制卡片 */}
      <div className="rounded-2xl border border-border/40 bg-card/60 p-5 backdrop-blur-md shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <Sliders className="h-4 w-4 text-sky-500" />
            <span className="text-sm font-semibold text-foreground">
              算法引擎选择：
            </span>
          </div>

          <div className="flex rounded-xl bg-muted/60 p-1 border border-border/40">
            <button
              onClick={() => setAlgoMode("gilbert")}
              className={cn(
                "px-4 py-1.5 text-xs font-semibold rounded-lg transition-all",
                algoMode === "gilbert"
                  ? "bg-background text-foreground shadow-sm font-bold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              空间填充曲线混淆 (Gilbert 空间曲线)
            </button>
            <button
              onClick={() => setAlgoMode("ybzj")}
              className={cn(
                "px-4 py-1.5 text-xs font-semibold rounded-lg transition-all",
                algoMode === "ybzj"
                  ? "bg-background text-foreground shadow-sm font-bold"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              YBZJ 混沌映射加密 (支持 0.666 及自定义密钥)
            </button>
          </div>
        </div>

        {/* 算法模式的具体参数配置 */}
        {algoMode === "gilbert" ? (
          <div className="rounded-xl bg-muted/30 p-3.5 border border-border/40 flex items-center gap-3 text-xs text-muted-foreground">
            <Sparkles className="h-4 w-4 text-sky-500 shrink-0" />
            <span>
              <b>Gilbert 空间填充曲线：</b>
              通过任意尺寸通用广义空间填充曲线与黄金分割位移实现无损打乱，混淆后仍保留图像局部平滑纹理，不易被内容风控识别为恶意噪点，解密时完全 1:1 无损还原。
            </span>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 rounded-xl bg-muted/30 p-3.5 border border-border/40">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Layers className="h-3.5 w-3.5 text-indigo-500" />
                混淆模式选择：
              </label>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                {[
                  { id: "block", name: "方块混淆 (32x32)" },
                  { id: "row_pixel", name: "行像素混淆" },
                  { id: "pixel", name: "全像素打乱" },
                  { id: "row_mode", name: "行模式 (PE1)" },
                  { id: "row_col", name: "行列混淆 (PE2)" },
                ].map((m) => (
                  <button
                    key={m.id}
                    onClick={() =>
                      setYbzjType(
                        m.id as
                          | "block"
                          | "row_pixel"
                          | "pixel"
                          | "row_mode"
                          | "row_col"
                      )
                    }
                    className={cn(
                      "px-2 py-1.5 text-[11px] rounded-lg border text-center transition-all",
                      ybzjType === m.id
                        ? "bg-indigo-500 text-white border-indigo-500 font-semibold shadow-sm"
                        : "bg-background/60 text-muted-foreground border-border/40 hover:bg-background"
                    )}
                  >
                    {m.name}
                  </button>
                ))}
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-foreground flex items-center justify-between">
                <span className="flex items-center gap-1.5">
                  <Key className="h-3.5 w-3.5 text-amber-500" />
                  混淆/解密密钥 (默认 0.666)：
                </span>
                <span className="text-[10px] text-muted-foreground">
                  支持小数或任意自定义文本字符串
                </span>
              </label>
              <input
                type="text"
                value={chaosKey}
                onChange={(e) => setChaosKey(e.target.value)}
                placeholder="0.666"
                className="w-full rounded-lg bg-background/80 border border-border/60 px-3 py-1.5 text-xs text-foreground font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/50"
              />
            </div>
          </div>
        )}
      </div>

      {/* 主体交互区域：上传列表 + 对比展示 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 左侧：文件上传与管理列表 */}
        <div className="space-y-4">
          <div
            onClick={() => {
              const input = document.createElement("input");
              input.type = "file";
              input.multiple = true;
              input.accept = "image/*";
              input.onchange = (e) => handleAddFiles((e.target as HTMLInputElement).files);
              input.click();
            }}
            className="group flex flex-col items-center justify-center p-6 rounded-2xl border-2 border-dashed border-border/60 bg-muted/20 hover:bg-muted/30 transition-all cursor-pointer text-center"
          >
            <div className="h-10 w-10 rounded-xl bg-indigo-500/10 text-indigo-500 flex items-center justify-center group-hover:scale-110 transition-transform mb-2">
              <Upload className="h-5 w-5" />
            </div>
            <div className="text-xs font-semibold text-foreground">
              点击或拖拽上传图片
            </div>
            <div className="text-[11px] text-muted-foreground">
              支持单张或批量多选，纯本地高速处理
            </div>
          </div>

          {/* 列表头部操作 */}
          {items.length > 0 && (
            <div className="flex items-center justify-between text-xs px-1">
              <span className="text-muted-foreground font-medium">
                已导入 {items.length} 张图片
              </span>
              <button
                onClick={handleClearAll}
                className="text-red-500 hover:text-red-600 transition-colors flex items-center gap-1 text-[11px]"
              >
                <Trash2 className="h-3 w-3" />
                清空列表
              </button>
            </div>
          )}

          {/* 图片缩略图选择列表 */}
          <div className="max-h-[380px] overflow-y-auto space-y-2 pr-1">
            {items.map((it, idx) => (
              <div
                key={it.id}
                onClick={() => setSelectedIndex(idx)}
                className={cn(
                  "group flex items-center justify-between p-2.5 rounded-xl border transition-all cursor-pointer",
                  selectedIndex === idx
                    ? "bg-indigo-500/10 border-indigo-500/50 shadow-sm"
                    : "bg-card/60 border-border/40 hover:bg-card/80"
                )}
              >
                <div className="flex items-center gap-2.5 truncate">
                  <div className="h-9 w-9 rounded-lg overflow-hidden shrink-0 border border-border/40 bg-background/50">
                    <img
                      src={it.processedUrl || it.originalUrl}
                      alt="Thumbnail"
                      className="h-full w-full object-cover"
                    />
                  </div>
                  <div className="truncate text-left">
                    <div className="text-xs font-medium text-foreground truncate">
                      {it.name}
                    </div>
                    <div className="text-[10px] text-muted-foreground font-mono">
                      {formatBytes(it.size)}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  {it.status === "processing" && (
                    <RotateCw className="h-3.5 w-3.5 text-sky-500 animate-spin" />
                  )}
                  {it.status === "done" && (
                    <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                  )}
                  {it.status === "error" && (
                    <AlertCircle className="h-3.5 w-3.5 text-red-500" />
                  )}
                  <button
                    onClick={(e) => handleRemoveItem(it.id, e)}
                    className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-red-500 transition-opacity p-1"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* 启动处理与批量下载 */}
          {items.length > 0 && (
            <div className="space-y-2 pt-2">
              <Button
                onClick={handleStartProcess}
                disabled={isProcessing}
                className="w-full bg-gradient-to-r from-indigo-500 to-sky-600 hover:from-indigo-600 hover:to-sky-700 text-white shadow-md shadow-indigo-500/20"
              >
                {isProcessing ? (
                  <>
                    <RotateCw className="mr-2 h-4 w-4 animate-spin" />
                    正在计算中...
                  </>
                ) : (
                  <>
                    <Shuffle className="mr-2 h-4 w-4" />
                    {direction === "scramble" ? "开始一键混淆" : "开始一键解混淆"}
                  </>
                )}
              </Button>

              {items.some((it) => it.status === "done") && (
                <Button
                  onClick={handleDownloadAllZip}
                  variant="secondary"
                  className="w-full text-xs"
                >
                  <Download className="mr-2 h-3.5 w-3.5" />
                  一键打包下载全部结果 (ZIP)
                </Button>
              )}
            </div>
          )}
        </div>

        {/* 右侧：交互式对比视图 */}
        <div className="lg:col-span-2 rounded-2xl border border-border/40 bg-card/60 p-5 backdrop-blur-md shadow-sm flex flex-col justify-between min-h-[440px]">
          {currentItem ? (
            <div className="space-y-4 flex-1 flex flex-col justify-between">
              {/* 头部信息与单图下载 */}
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    {currentItem.name}
                  </h3>
                  <p className="text-[11px] text-muted-foreground">
                    {currentItem.processedUrl
                      ? "拖动中间滑块对比混淆前后的实际效果"
                      : "点击下方或左侧按钮即可开始执行"}
                  </p>
                </div>

                {currentItem.processedUrl && (
                  <a
                    href={currentItem.processedUrl}
                    download={`${currentItem.name.replace(/\.[^.]+$/, "")}_${direction === "scramble" ? "obfuscated" : "restored"}.png`}
                  >
                    <Button size="sm" className="bg-sky-500 hover:bg-sky-600 text-white text-xs">
                      <Download className="mr-1.5 h-3.5 w-3.5" />
                      下载当前图
                    </Button>
                  </a>
                )}
              </div>

              {/* 对比视窗 */}
              <div
                ref={compareRef}
                onMouseDown={() => setIsDragging(true)}
                onTouchStart={() => setIsDragging(true)}
                className="relative flex-1 w-full min-h-[300px] rounded-xl overflow-hidden bg-muted/20 border border-border/40 select-none flex items-center justify-center"
              >
                {currentItem.processedUrl ? (
                  <>
                    {/* 底层：处理后图片 */}
                    <img
                      src={currentItem.processedUrl}
                      alt="Processed"
                      className="absolute inset-0 h-full w-full object-contain pointer-events-none"
                    />

                    {/* 顶层：原图（受 clip-path 裁剪） */}
                    <div
                      className="absolute inset-0 h-full w-full overflow-hidden pointer-events-none"
                      style={{ clipPath: `inset(0 ${100 - sliderPos}% 0 0)` }}
                    >
                      <img
                        src={currentItem.originalUrl}
                        alt="Original"
                        className="absolute inset-0 h-full w-full object-contain"
                      />
                    </div>

                    {/* 对比分界线与手柄 */}
                    <div
                      className="absolute top-0 bottom-0 w-0.5 bg-white shadow-[0_0_10px_rgba(0,0,0,0.5)] z-20 cursor-ew-resize pointer-events-none"
                      style={{ left: `${sliderPos}%` }}
                    >
                      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-8 w-8 rounded-full bg-white text-slate-800 shadow-lg flex items-center justify-center border border-border/40">
                        <ChevronsLeftRight className="h-4 w-4" />
                      </div>
                    </div>

                    {/* 标签提示 */}
                    <div className="absolute top-3 left-3 px-2 py-1 rounded bg-black/60 backdrop-blur-sm text-[10px] text-white font-medium z-10 pointer-events-none">
                      输入原图
                    </div>
                    <div className="absolute top-3 right-3 px-2 py-1 rounded bg-black/60 backdrop-blur-sm text-[10px] text-white font-medium z-10 pointer-events-none">
                      {direction === "scramble" ? "混淆后效果" : "解密还原后效果"}
                    </div>
                  </>
                ) : (
                  <div className="flex flex-col items-center justify-center gap-2 p-6">
                    <img
                      src={currentItem.originalUrl}
                      alt="Current"
                      className="max-h-64 object-contain rounded-lg shadow-sm border border-border/30"
                    />
                    <span className="text-xs text-muted-foreground">
                      当前尚未处理，点击左侧按钮立即执行
                    </span>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-center p-8 text-muted-foreground">
              <ImageIcon className="h-12 w-12 stroke-[1.2] mb-3 text-muted-foreground/40" />
              <div className="text-sm font-semibold text-foreground">
                暂未选择任何图片
              </div>
              <div className="text-xs text-muted-foreground max-w-sm mt-1">
                请在左侧上传需要混淆或解混淆的图片，支持任意长宽与色彩模式
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
