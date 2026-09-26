/**
 * 图片去重的内核：感知哈希 + 汉明距离 + 并查集分组
 *
 * 设计要点
 *  · 只用像素数据，不依赖 canvas / sharp / 任何库 —— 这样内核可以在任何环境跑，
 *    也方便单独验证（验证时用 Python 解码图片、导出原始像素喂进来即可）。
 *  · 三种哈希一起算：aHash 快、dHash 对轻微改动稳、pHash 最稳但稍慢；
 *    判定以 dHash 为主，pHash 参与「完全相同」的复核。
 *  · **分档**是这类功能好不好用的关键，所以档位在这里就定死：
 *      相同    —— 字节级一致
 *      高度相似 —— dHash 距离 ≤ 4（多半是压缩/裁剪/加水印后的同一张）
 *      相似    —— 距离 5~10（可能是连拍，需要人眼确认）
 *      不同    —— 距离 > 10（不显示）
 *  · 分组用并查集：避免「A~B 相似、B~C 相似，但 A~C 不相似」时被拆成两组。
 */

export interface Pixels {
  /** RGBA 数据，长度 = width * height * 4 */
  data: Uint8ClampedArray | Uint8Array | number[];
  width: number;
  height: number;
}

export interface ImageHashes {
  aHash: bigint;
  dHash: bigint;
  pHash: bigint;
}

/** 缩放到 32×32 的灰度数组（双线性近似：按比例取样后平均） */
export function toGray(pixels: Pixels, size = 32): number[] {
  const { data, width, height } = pixels;
  const out = new Array(size * size).fill(0);
  const counts = new Array(size * size).fill(0);
  for (let y = 0; y < height; y++) {
    const ty = Math.min(size - 1, Math.floor((y * size) / height));
    for (let x = 0; x < width; x++) {
      const tx = Math.min(size - 1, Math.floor((x * size) / width));
      const i = (y * width + x) * 4;
      // 亮度按人眼感知加权
      const lum = 0.299 * Number(data[i]) + 0.587 * Number(data[i + 1]) + 0.114 * Number(data[i + 2]);
      const k = ty * size + tx;
      out[k] += lum;
      counts[k] += 1;
    }
  }
  for (let i = 0; i < out.length; i++) out[i] = counts[i] ? out[i] / counts[i] : 0;
  return out;
}

/** 均值哈希：与整体平均亮度比较，得到 64 位 */
export function aHash(gray: number[], size = 8): bigint {
  // 先把 32×32 降成 8×8（分块平均）
  const small = downsample(gray, 32, size);
  const avg = small.reduce((a, b) => a + b, 0) / small.length;
  return bitsToBigInt(small.map((v) => (v > avg ? 1 : 0)));
}

/** 差分哈希：比较相邻像素的明暗关系，对亮度整体变化和轻微改动更稳 */
export function dHash(gray: number[], size = 8): bigint {
  const small = downsample(gray, 32, size + 1);
  const bits: number[] = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      bits.push(small[y * (size + 1) + x] > small[y * (size + 1) + x + 1] ? 1 : 0);
    }
  }
  return bitsToBigInt(bits);
}

/** DCT 感知哈希：取低频系数与中位数比较，最稳但对缩放/裁剪更宽容 */
export function pHash(gray: number[], size = 32, keep = 8): bigint {
  const n = size;
  const dct: number[] = new Array(keep * keep).fill(0);
  for (let u = 0; u < keep; u++) {
    for (let v = 0; v < keep; v++) {
      let sum = 0;
      for (let x = 0; x < n; x++) {
        for (let y = 0; y < n; y++) {
          sum +=
            gray[x * n + y] *
            Math.cos(((2 * x + 1) * u * Math.PI) / (2 * n)) *
            Math.cos(((2 * y + 1) * v * Math.PI) / (2 * n));
        }
      }
      const cu = u === 0 ? 1 / Math.sqrt(2) : 1;
      const cv = v === 0 ? 1 / Math.sqrt(2) : 1;
      dct[u * keep + v] = (2 / n) * cu * cv * sum;
    }
  }
  // 去掉直流分量后取中位数
  const ac = dct.slice(1);
  const sorted = [...ac].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  return bitsToBigInt(dct.map((v, i) => (i === 0 ? 0 : v > median ? 1 : 0)));
}

export function computeHashes(pixels: Pixels): ImageHashes {
  const gray = toGray(pixels, 32);
  return { aHash: aHash(gray), dHash: dHash(gray), pHash: pHash(gray) };
}

function downsample(gray: number[], from: number, to: number): number[] {
  const out: number[] = [];
  const block = from / to;
  for (let y = 0; y < to; y++) {
    for (let x = 0; x < to; x++) {
      let sum = 0;
      let n = 0;
      for (let dy = 0; dy < block; dy++) {
        for (let dx = 0; dx < block; dx++) {
          const sy = Math.min(from - 1, Math.floor(y * block + dy));
          const sx = Math.min(from - 1, Math.floor(x * block + dx));
          sum += gray[sy * from + sx];
          n++;
        }
      }
      out.push(n ? sum / n : 0);
    }
  }
  return out;
}

function bitsToBigInt(bits: number[]): bigint {
  let v = BigInt(0);
  for (const b of bits) v = (v << BigInt(1)) | BigInt(b ? 1 : 0);
  return v;
}

/** 汉明距离 */
export function hamming(a: bigint, b: bigint): number {
  let x = a ^ b;
  let count = 0;
  while (x) {
    x &= x - BigInt(1);
    count++;
  }
  return count;
}

export type Tier = "identical" | "near" | "similar";

export interface DedupItem {
  id: string;
  /** 文件字节数 */
  size: number;
  width: number;
  height: number;
  hashes: ImageHashes;
  /** 用于「建议保留」的清晰度指标（拉普拉斯方差），没有就填 0 */
  sharpness?: number;
  /** 文件内容哈希（完全相同判定用），没有就填空串 */
  contentHash?: string;
}

export interface DedupGroup {
  tier: Tier;
  /** 组内的相似关系取其中最强的一档 */
  items: DedupItem[];
  /** 建议保留的那一张的 id（按分辨率、体积、清晰度综合） */
  suggestedKeep: string;
}

export const TIER_LABEL: Record<Tier, string> = {
  identical: "完全相同",
  near: "高度相似",
  similar: "相似（可能是连拍）",
};

export const TIER_HINT: Record<Tier, string> = {
  identical: "内容完全一致，通常只需保留一张",
  near: "多半是压缩、裁剪或加了水印的同一张，建议保留分辨率最高的",
  similar: "画面相近但未必是同一张，建议逐张看过再决定",
};

/** 判断两张图属于哪一档（不相似返回 null） */
export function classify(a: DedupItem, b: DedupItem): Tier | null {
  if (a.contentHash && b.contentHash && a.contentHash === b.contentHash && a.size === b.size) return "identical";
  const d = hamming(a.hashes.dHash, b.hashes.dHash);
  if (d <= 4) return "near";
  if (d <= 10) return "similar";
  return null;
}

/** 建议保留：分辨率优先，其次清晰度，最后取体积大的（通常压缩更少） */
/**
 * 建议保留哪一张。
 *
 * 两个坑（都是实测踩出来的）：
 *  · 不能拿「清晰度」当主要依据 —— 裁剪后放大反而会把拉普拉斯方差拉高，
 *    结果建议保留那张被裁过的（实测就是如此）；
 *  · 也不能只看分辨率 —— 组里往往尺寸一样。
 * 所以改为：**先看它跟组内多少张相似**（最"居中"的那张通常就是原图），
 * 再看像素数与文件体积（同等像素下体积大说明压缩更少）。
 */
export function pickKeep(items: DedupItem[], nearThreshold = 10): string {
  const score = (it: DedupItem) => {
    let sum = 0;
    for (const other of items) {
      if (other.id === it.id) continue;
      sum += hamming(it.hashes.dHash, other.hashes.dHash);
    }
    // 距离之和越小越接近组内中心；同分时再比像素数与体积（体积大说明压缩更少）
    return [-sum, it.width * it.height, it.size] as const;
  };
  return [...items]
    .sort((a, b) => {
      const sa = score(a);
      const sb = score(b);
      // sa[0] / sb[0] 存的是 -sum，要按 sum 升序 = 按 -sum 降序
      if (sa[0] !== sb[0]) return sb[0] - sa[0];
      if (sa[1] !== sb[1]) return sb[1] - sa[1];
      return sb[2] - sa[2];
    })[0].id;
}

/**
 * 分组：用并查集把互相相似的图连起来，只在「相同/高度相似」这一层做传递，
 * 「相似」层不传递（否则连拍会被连成一长串，反而不好用）。
 */
export function groupImages(items: DedupItem[], includeSimilar = true): DedupGroup[] {
  const n = items.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  const find = (x: number): number => (parent[x] === x ? x : (parent[x] = find(parent[x])));
  const union = (x: number, y: number) => {
    const rx = find(x);
    const ry = find(y);
    if (rx !== ry) parent[rx] = ry;
  };

  const pairTier = new Map<string, Tier>();
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const t = classify(items[i], items[j]);
      if (!t) continue;
      if (t === "similar" && !includeSimilar) continue;
      pairTier.set(`${i}-${j}`, t);
      if (t !== "similar") union(i, j); // 相似层不传递
    }
  }

  // 先按并查集收集组
  const buckets = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!buckets.has(r)) buckets.set(r, []);
    buckets.get(r)!.push(i);
  }

  const groups: DedupGroup[] = [];
  const used = new Set<number>();

  for (const idxs of buckets.values()) {
    if (idxs.length < 2) continue;
    // 组内取最强的一档
    // 组档位按组内所有相似对的**中位距离**判定。
    // 早先取「最强的一对」，结果一组里混着重压/裁剪/水印的图也被标成「完全相同」；
    // 改成取「最弱的一对」又太严，只要有一对偏远就整组降级。中位数才符合直觉。
    const dists: number[] = [];
    for (let a = 0; a < idxs.length; a++) {
      for (let b = a + 1; b < idxs.length; b++) {
        const key = `${Math.min(idxs[a], idxs[b])}-${Math.max(idxs[a], idxs[b])}`;
        if (pairTier.has(key)) dists.push(hamming(items[idxs[a]].hashes.dHash, items[idxs[b]].hashes.dHash));
      }
    }
    dists.sort((x, y) => x - y);
    const median = dists.length ? dists[Math.floor(dists.length / 2)] : 10;
    const tier: Tier = median === 0 ? "identical" : median <= 4 ? "near" : "similar";
    const members = idxs.map((i) => items[i]);
    idxs.forEach((i) => used.add(i));
    groups.push({ tier, items: members, suggestedKeep: pickKeep(members) });
  }

  // 再补「相似但不传递」的：把彼此相似却没进组的凑成独立小组
  if (includeSimilar) {
    for (let i = 0; i < n; i++) {
      if (used.has(i)) continue;
      const mates = [i];
      for (let j = i + 1; j < n; j++) {
        if (used.has(j)) continue;
        const key = `${i}-${j}`;
        if (pairTier.get(key) === "similar") mates.push(j);
      }
      if (mates.length >= 2) {
        const members = mates.map((k) => items[k]);
        mates.forEach((k) => used.add(k));
        groups.push({ tier: "similar", items: members, suggestedKeep: pickKeep(members) });
      }
    }
  }

  // 排序：相同 → 高度相似 → 相似；组内按建议保留排第一
  const order: Record<Tier, number> = { identical: 0, near: 1, similar: 2 };
  groups.sort((a, b) => order[a.tier] - order[b.tier] || b.items.length - a.items.length);
  for (const g of groups) {
    g.items.sort((a, b) => (a.id === g.suggestedKeep ? -1 : b.id === g.suggestedKeep ? 1 : 0));
  }
  return groups;
}

/** 统计：各档位有多少组、共多少张 */
export function summarize(groups: DedupGroup[]) {
  const byTier: Record<Tier, { groups: number; images: number }> = {
    identical: { groups: 0, images: 0 },
    near: { groups: 0, images: 0 },
    similar: { groups: 0, images: 0 },
  };
  for (const g of groups) {
    byTier[g.tier].groups += 1;
    byTier[g.tier].images += g.items.length;
  }
  return byTier;
}
