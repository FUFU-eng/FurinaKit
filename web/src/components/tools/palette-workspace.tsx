import { useState, useRef, useMemo } from "react";
import {
  LockKeyhole,
  Unlock,
  Copy,
  Download,
  Shuffle,
  ImagePlus,
  Bookmark,
  BookmarkCheck,
  Eye,
  Sliders,
  Sparkles,
  Search,
  Check,
  Palette,
  ExternalLink,
} from "lucide-react";
import { Button, Input, Label, Select } from "@/components/ui/primitives";
import { useToolDraft } from "@/lib/use-tool-draft";
import { tr, useLanguage } from "@/lib/language";
import { saveOutputBlob, reportOutputSaved } from "@/lib/output-directory";

// ==================== 海量高品质精选色库 ====================

type PresetCategory = "all" | "oriental" | "nature" | "ui" | "art";

interface Preset {
  zh: string;
  en: string;
  category: PresetCategory;
  tags: string[];
  colors: string[];
}

const PRESET_PALETTES: Preset[] = [
  // ── 东方传统美学 ──
  {
    zh: "故宫朱红",
    en: "Forbidden City Vermilion",
    category: "oriental",
    tags: ["故宫", "红色", "古典", "红墙", "琉璃"],
    colors: ["#9B1B1E", "#D93A32", "#E8A375", "#F6E8D5", "#2C3539"],
  },
  {
    zh: "天青过雨",
    en: "Sky After Rain",
    category: "oriental",
    tags: ["汝窑", "天青", "雅致", "雨夜", "青瓷"],
    colors: ["#2B5F75", "#4B8B9B", "#96C2C2", "#D4E5E2", "#F2F7F6"],
  },
  {
    zh: "暮山紫霞",
    en: "Twilight Mountain Violet",
    category: "oriental",
    tags: ["暮山", "紫", "晚霞", "温婉", "古堡"],
    colors: ["#482936", "#734A60", "#A87B95", "#D8B4C8", "#F5EAF0"],
  },
  {
    zh: "缃叶秋金",
    en: "Autumn Amber Leaves",
    category: "oriental",
    tags: ["秋天", "缃叶", "金色", "落叶", "荒原"],
    colors: ["#664614", "#A3782C", "#DCA842", "#F0D283", "#FCF6E5"],
  },
  {
    zh: "敦煌飞天",
    en: "Dunhuang Flying Apsaras",
    category: "oriental",
    tags: ["敦煌", "壁画", "赭石", "石青", "古风"],
    colors: ["#8A3324", "#C85A32", "#E89B38", "#5B8266", "#EEDCC5"],
  },
  {
    zh: "霁蓝釉光",
    en: "Sacrificial Blue Glaze",
    category: "oriental",
    tags: ["霁蓝", "深蓝", "陶瓷", "沉稳", "夜色"],
    colors: ["#0F2540", "#1C497D", "#3E78B2", "#91BCE6", "#E8F2FA"],
  },
  {
    zh: "烟雨江南",
    en: "Misty Jiangnan",
    category: "oriental",
    tags: ["水墨", "雨", "江南", "黑白灰", "淡雅"],
    colors: ["#262C36", "#485669", "#7D8C9D", "#BFCCD6", "#EEF2F6"],
  },
  {
    zh: "胭脂淡粉",
    en: "Rouge Blush",
    category: "oriental",
    tags: ["胭脂", "粉色", "樱花", "娇艳", "水彩"],
    colors: ["#A73252", "#D45277", "#F08CA5", "#FAD0DB", "#FDF2F4"],
  },

  // ── 自然与四季 ──
  {
    zh: "春日落樱",
    en: "Spring Cherry Blossom",
    category: "nature",
    tags: ["春季", "樱花", "粉白", "花瓣", "温柔"],
    colors: ["#D85A7F", "#F2849E", "#FFB6C1", "#FFE4EC", "#FFF9FA"],
  },
  {
    zh: "夏木阴阴",
    en: "Lush Summer Forest",
    category: "nature",
    tags: ["森林", "夏天", "绿意", "树木", "清新"],
    colors: ["#1B4332", "#2D6A4F", "#52B788", "#95D5B2", "#D8F3DC"],
  },
  {
    zh: "秋风红枫",
    en: "Autumn Maple Woods",
    category: "nature",
    tags: ["枫叶", "秋季", "橘红", "温暖", "日落"],
    colors: ["#781D13", "#B33927", "#E05A32", "#F49D6E", "#F8E5D6"],
  },
  {
    zh: "凛冬初雪",
    en: "Winter First Snow",
    category: "nature",
    tags: ["冬天", "雪景", "冰蓝", "纯净", "冷调"],
    colors: ["#1B263B", "#415A77", "#778DA9", "#E0E1DD", "#FFFFFF"],
  },
  {
    zh: "极光夜空",
    en: "Aurora Borealis",
    category: "nature",
    tags: ["极光", "夜空", "荧光绿", "星空", "深邃"],
    colors: ["#0B132B", "#1C2541", "#3A506B", "#5BC0BE", "#6FFFE9"],
  },
  {
    zh: "深海鲸落",
    en: "Deep Ocean Trench",
    category: "nature",
    tags: ["海洋", "深海", "深蓝", "神秘", "宁静"],
    colors: ["#03045E", "#023E8A", "#0077B6", "#0096C7", "#90E0EF"],
  },
  {
    zh: "荒漠落日",
    en: "Desert Sunset Glow",
    category: "nature",
    tags: ["沙漠", "落日", "晚霞", "沙丘", "荒原"],
    colors: ["#4A2825", "#8C3F34", "#D16B47", "#F0A364", "#F7E2BB"],
  },
  {
    zh: "雨夜霓虹",
    en: "Rainy Night Neon",
    category: "nature",
    tags: ["雨夜", "湿润", "街道", "反光", "深色"],
    colors: ["#141926", "#212F45", "#385273", "#749BC2", "#C6D7E8"],
  },

  // ── 现代 UI & 数字产品 ──
  {
    zh: "SaaS 科技蓝",
    en: "Modern SaaS Blue",
    category: "ui",
    tags: ["SaaS", "科技", "蓝色", "专业", "商业"],
    colors: ["#0A2540", "#0066CC", "#00A3FF", "#E6F4FE", "#FFFFFF"],
  },
  {
    zh: "极简暗黑",
    en: "Minimalist Dark Mode",
    category: "ui",
    tags: ["暗黑", "极简", "中性", "高对比", "科技"],
    colors: ["#0F172A", "#1E293B", "#475569", "#94A3B8", "#F8FAFC"],
  },
  {
    zh: "电商活力橙",
    en: "E-Commerce Energy",
    category: "ui",
    tags: ["电商", "促销", "活力", "橙色", "购买"],
    colors: ["#3A1303", "#9A3412", "#EA580C", "#FB923C", "#FFF7ED"],
  },
  {
    zh: "医疗健康绿",
    en: "Medical & Health Green",
    category: "ui",
    tags: ["医疗", "健康", "绿色", "安心", "生机"],
    colors: ["#064E3B", "#059669", "#34D399", "#A7F3D0", "#ECFDF5"],
  },
  {
    zh: "社交甜心粉",
    en: "Social Sweet Macaron",
    category: "ui",
    tags: ["社交", "马卡龙", "年轻", "活跃", "甜美"],
    colors: ["#701A75", "#C026D3", "#F472B6", "#FBCFE8", "#FDF4FF"],
  },
  {
    zh: "金融财富金",
    en: "Fintech Wealth Gold",
    category: "ui",
    tags: ["金融", "财富", "金色", "稳健", "高端"],
    colors: ["#0F172A", "#1E3A5F", "#B45309", "#F59E0B", "#FEF3C7"],
  },
  {
    zh: "清新知识库",
    en: "Notion Clean Workspace",
    category: "ui",
    tags: ["笔记", "知识库", "温和", "无压力", "卡片"],
    colors: ["#2F3437", "#5B6064", "#9CA3AF", "#E5E7EB", "#F7F6F3"],
  },

  // ── 艺术与情绪色彩 ──
  {
    zh: "莫兰迪静谧",
    en: "Morandi Serenity",
    category: "art",
    tags: ["莫兰迪", "低饱和", "静谧", "高级灰", "雅致"],
    colors: ["#5D636B", "#7E857C", "#A29B8B", "#C8C0B5", "#ECE7E1"],
  },
  {
    zh: "赛博朋克 2077",
    en: "Cyberpunk 2077",
    category: "art",
    tags: ["赛博朋克", "黄黑", "电光紫", "科幻", "反叛"],
    colors: ["#08080C", "#FF0055", "#FCEE09", "#00F0FF", "#3E1E68"],
  },
  {
    zh: "韦斯·安德森复古",
    en: "Wes Anderson Palette",
    category: "art",
    tags: ["电影", "布达佩斯", "复古", "对称", "暖调"],
    colors: ["#B83B38", "#E67A4F", "#F4C264", "#43788C", "#F0ECE1"],
  },
  {
    zh: "复古港风胶片",
    en: "Vintage Film Roll",
    category: "art",
    tags: ["复古", "港风", "胶片", "怀旧", "电影感"],
    colors: ["#2B2320", "#593D3B", "#99584D", "#D49B7A", "#F3E2CE"],
  },
  {
    zh: "孟菲斯撞色",
    en: "Memphis Pop Art",
    category: "art",
    tags: ["孟菲斯", "波普", "波普撞色", "趣味", "跳跃"],
    colors: ["#241E4E", "#511845", "#FF5733", "#F9C80E", "#00E5FF"],
  },
  {
    zh: "巴黎塞纳晨雾",
    en: "Parisian Morning Mist",
    category: "art",
    tags: ["法式", "浪漫", "晨雾", "灰调", "柔美"],
    colors: ["#38404B", "#657283", "#9CAAB9", "#CBD4DE", "#F2F5F8"],
  },
];

// ==================== 工具函数 ====================

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  const num = parseInt(clean, 16);
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((x) =>
        Math.max(0, Math.min(255, Math.round(x)))
          .toString(16)
          .padStart(2, "0")
      )
      .join("")
      .toUpperCase()
  );
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = (h % 360 + 360) % 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
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
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b),
    min = Math.min(r, g, b);
  let h = 0,
    s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      case b:
        h = (r - g) / d + 4;
        break;
    }
    h *= 60;
  }
  return [h, s, l];
}

function getContrastRatio(hex1: string, hex2: string): number {
  const lum = (hex: string) => {
    const [r, g, b] = hexToRgb(hex).map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const l1 = lum(hex1);
  const l2 = lum(hex2);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function getTextColorForBg(bgHex: string): string {
  const [r, g, b] = hexToRgb(bgHex);
  const brightness = (r * 299 + g * 587 + b * 114) / 1000;
  return brightness > 145 ? "#111827" : "#FFFFFF";
}

// 基于色彩学规则和谐生成调色板
function generateHarmony(
  baseHex: string,
  mode: string,
  count: number = 5
): string[] {
  const [h, s, l] = rgbToHsl(...hexToRgb(baseHex));
  const res: string[] = [];

  switch (mode) {
    case "complementary": {
      // 互补撞色：主色、互补色、以及它们的明度深浅变体
      const compH = (h + 180) % 360;
      res.push(rgbToHex(...hslToRgb(h, s, Math.max(0.2, l - 0.2))));
      res.push(baseHex);
      res.push(rgbToHex(...hslToRgb(h, Math.max(0.2, s * 0.7), Math.min(0.9, l + 0.3))));
      res.push(rgbToHex(...hslToRgb(compH, s, l)));
      res.push(rgbToHex(...hslToRgb(compH, Math.min(1, s * 1.1), Math.max(0.25, l - 0.15))));
      break;
    }
    case "analogous": {
      // 邻近色：在基色两旁各偏移 25~35 度
      const angles = [-40, -20, 0, 20, 40];
      angles.forEach((offset, idx) => {
        const curH = (h + offset + 360) % 360;
        const curL = Math.max(0.18, Math.min(0.88, l + (idx - 2) * 0.1));
        res.push(rgbToHex(...hslToRgb(curH, s, curL)));
      });
      break;
    }
    case "triadic": {
      // 三色平衡：基色、+120度、+240度
      const h2 = (h + 120) % 360;
      const h3 = (h + 240) % 360;
      res.push(baseHex);
      res.push(rgbToHex(...hslToRgb(h, s * 0.6, Math.min(0.9, l + 0.25))));
      res.push(rgbToHex(...hslToRgb(h2, s, l)));
      res.push(rgbToHex(...hslToRgb(h3, s, l)));
      res.push(rgbToHex(...hslToRgb(h3, s * 0.8, Math.max(0.2, l - 0.2))));
      break;
    }
    case "split": {
      // 分裂互补：基色、180-30度、180+30度
      const s1 = (h + 150) % 360;
      const s2 = (h + 210) % 360;
      res.push(rgbToHex(...hslToRgb(h, s, Math.max(0.2, l - 0.15))));
      res.push(baseHex);
      res.push(rgbToHex(...hslToRgb(h, s * 0.5, Math.min(0.92, l + 0.25))));
      res.push(rgbToHex(...hslToRgb(s1, s, l)));
      res.push(rgbToHex(...hslToRgb(s2, s, l)));
      break;
    }
    case "mono":
    default: {
      // 单色阶梯：色相固定，饱与明度做优雅阶梯
      const steps = [0.18, 0.35, 0.52, 0.72, 0.88];
      steps.forEach((targetL) => {
        const targetS = Math.min(1, s * (targetL > 0.8 ? 0.6 : 1));
        res.push(rgbToHex(...hslToRgb(h, targetS, targetL)));
      });
      break;
    }
  }

  return res.slice(0, count);
}

// 从图片中提取主色调 (Canvas 像素聚类)
async function extractPaletteFromImage(file: File, count: number = 5): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const reader = new FileReader();
    reader.onload = (e) => {
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    img.onload = () => {
      const canvas = document.createElement("canvas");
      const ctx = canvas.getContext("2d");
      if (!ctx) {
        reject(new Error(tr("无法创建画布", "Failed to create canvas")));
        return;
      }
      const maxDim = 120;
      const scale = Math.min(maxDim / img.width, maxDim / img.height, 1);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      canvas.width = w;
      canvas.height = h;
      ctx.drawImage(img, 0, 0, w, h);
      const data = ctx.getImageData(0, 0, w, h).data;

      // 统计色块桶 (简单的 4-bit 量化)
      const buckets: Record<string, { r: number; g: number; b: number; count: number }> = {};
      for (let i = 0; i < data.length; i += 16) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const a = data[i + 3];
        if (a < 128) continue; // 跳过透明
        // 量化到 32 步长
        const qr = Math.floor(r / 28) * 28;
        const qg = Math.floor(g / 28) * 28;
        const qb = Math.floor(b / 28) * 28;
        const key = `${qr},${qg},${qb}`;
        if (!buckets[key]) buckets[key] = { r, g, b, count: 0 };
        buckets[key].count++;
      }

      const sorted = Object.values(buckets).sort((a, b) => b.count - a.count);
      const result: string[] = [];
      for (const item of sorted) {
        const hex = rgbToHex(item.r, item.g, item.b);
        // 确保颜色之间有一定色差
        if (!result.some((existing) => getContrastRatio(existing, hex) < 1.15)) {
          result.push(hex);
        }
        if (result.length >= count) break;
      }
      while (result.length < count) {
        result.push(rgbToHex(Math.random() * 255, Math.random() * 255, Math.random() * 255));
      }
      resolve(result);
    };
    reader.readAsDataURL(file);
  });
}

// ==================== 主组件 ====================

export function PaletteWorkspace() {
  useLanguage();

  // 当前主展示的调色板 (5个颜色)
  const [colors, setColors] = useToolDraft<string[]>(
    "color-palette",
    "v68-colors",
    PRESET_PALETTES[0].colors
  );
  // 已锁定的色块
  const [locked, setLocked] = useState<boolean[]>([false, false, false, false, false]);
  // 收藏列表
  const [saved, setSaved] = useToolDraft<Preset[]>("color-palette", "v68-saved-list", []);
  // 和谐模式
  const [harmonyMode, setHarmonyMode] = useState<string>("analogous");
  // 当前子标签页
  const [activeTab, setActiveTab] = useState<"library" | "generate" | "preview" | "image" | "export" | "saved">("library");
  // 预设分类筛选
  const [categoryFilter, setCategoryFilter] = useState<PresetCategory>("all");
  // 搜索关键词
  const [searchQuery, setSearchQuery] = useState("");
  // 复制/通知状态
  const [toastMsg, setToastMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // 正在微调哪一个色块的索引
  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const notify = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(""), 2200);
  };

  const copyToClipboard = async (text: string, label: string = tr("已复制", "Copied")) => {
    try {
      await navigator.clipboard.writeText(text);
      notify(`${label}: ${text}`);
    } catch {
      notify(tr("复制失败，请手动复制", "Copy failed, please copy manually"));
    }
  };

  // 随机生成 / 换一组
  const handleRandomize = () => {
    // 找出首个锁定的颜色作为种子，若无则随机生成一个
    const lockedIdx = locked.findIndex(Boolean);
    let baseColor = "";
    if (lockedIdx !== -1 && colors[lockedIdx]) {
      baseColor = colors[lockedIdx];
    } else {
      const h = Math.floor(Math.random() * 360);
      const s = 0.5 + Math.random() * 0.4;
      const l = 0.35 + Math.random() * 0.35;
      baseColor = rgbToHex(...hslToRgb(h, s, l));
    }

    const generated = generateHarmony(baseColor, harmonyMode, 5);
    // 保留被锁定的位置
    const nextColors = colors.map((col, idx) => (locked[idx] ? col : generated[idx]));
    setColors(nextColors);
    setEditingIndex(null);
    notify(tr("已生成新灵感配色", "Generated new palette"));
  };

  // 应用某组配色
  const applyPalette = (newColors: string[]) => {
    setColors([...newColors]);
    setLocked([false, false, false, false, false]);
    setEditingIndex(null);
    notify(tr("已应用配色方案", "Palette applied"));
  };

  // 切换色块锁定状态
  const toggleLock = (index: number) => {
    setLocked((prev) => {
      const next = [...prev];
      next[index] = !next[index];
      return next;
    });
  };

  // 收藏当前调色板
  const handleBookmark = () => {
    const currentHexes = colors.join(",");
    const isAlreadySaved = saved.some((s) => s.colors.join(",") === currentHexes);
    if (isAlreadySaved) {
      setSaved(saved.filter((s) => s.colors.join(",") !== currentHexes));
      notify(tr("已取消收藏", "Removed from saved"));
    } else {
      const newPreset: Preset = {
        zh: tr(`自定义配色 #${saved.length + 1}`, `Custom #${saved.length + 1}`),
        en: `Custom #${saved.length + 1}`,
        category: "all",
        tags: ["自定义", "收藏"],
        colors: [...colors],
      };
      setSaved([newPreset, ...saved]);
      notify(tr("已加入我的收藏", "Saved to favorites"));
    }
  };

  const isCurrentBookmarked = useMemo(() => {
    const currentHexes = colors.join(",");
    return saved.some((s) => s.colors.join(",") === currentHexes);
  }, [colors, saved]);

  // 过滤预设库
  const filteredPresets = useMemo(() => {
    return PRESET_PALETTES.filter((p) => {
      if (categoryFilter !== "all" && p.category !== categoryFilter) return false;
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const matchName = p.zh.toLowerCase().includes(q) || p.en.toLowerCase().includes(q);
        const matchTag = p.tags.some((t) => t.toLowerCase().includes(q));
        const matchHex = p.colors.some((c) => c.toLowerCase().includes(q));
        return matchName || matchTag || matchHex;
      }
      return true;
    });
  }, [categoryFilter, searchQuery]);

  // 处理图片取色
  const handleImageFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const extracted = await extractPaletteFromImage(file, 5);
      applyPalette(extracted);
      notify(tr("成功从图片中提取 5 种主色调", "Extracted 5 dominant colors from image"));
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };

  // 导出色卡 PNG
  const exportSwatchPng = async () => {
    try {
      const canvas = document.createElement("canvas");
      canvas.width = 1500;
      canvas.height = 900;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const swatchW = canvas.width / colors.length;
      colors.forEach((col, idx) => {
        // 色块
        ctx.fillStyle = col;
        ctx.fillRect(idx * swatchW, 0, swatchW, canvas.height);

        // 文字
        const textColor = getTextColorForBg(col);
        ctx.fillStyle = textColor;
        ctx.font = "bold 32px 'JetBrains Mono', monospace";
        ctx.textAlign = "center";
        ctx.fillText(col, (idx + 0.5) * swatchW, canvas.height - 100);

        const [r, g, b] = hexToRgb(col);
        ctx.font = "20px 'Inter', sans-serif";
        ctx.fillText(`RGB(${r}, ${g}, ${b})`, (idx + 0.5) * swatchW, canvas.height - 60);

        ctx.font = "bold 24px 'Inter', sans-serif";
        ctx.fillText(`0${idx + 1}`, (idx + 0.5) * swatchW, 60);
      });

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error(tr("生成图片失败", "Failed to generate image")))), "image/png");
      });
      const path = await saveOutputBlob(blob, `palette-${Date.now()}.png`);
      reportOutputSaved(path);
      notify(tr(`已保存色卡图片：${path}`, `Saved swatch image to ${path}`));
    } catch (err) {
      setError(String(err));
    }
  };

  // 生成的代码格式
  const cssVarsCode = `:root {\n${colors.map((c, i) => `  --color-${i + 1}: ${c};`).join("\n")}\n}`;
  const tailwindConfigCode = `// tailwind.config.js\nmodule.exports = {\n  theme: {\n    extend: {\n      colors: {\n        brand: {\n${colors.map((c, i) => `          ${(i + 1) * 100}: '${c}',`).join("\n")}\n        }\n      }\n    }\n  }\n}`;
  const jsonCode = JSON.stringify({ name: "Palette", colors }, null, 2);

  return (
    <div className="space-y-6 min-w-0">
      {/* ── 顶部操作栏 ── */}
      <header className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border bg-card p-5">
        <div>
          <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
            <Palette className="text-amber-500" size={22} />
            {tr("配色灵感工作台", "Color Palette Studio")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {tr("精选海量大师级主题配色，色彩理论智能推导，支持图片取色与实景模拟。", "Master-grade preset palettes, color theory harmony generator, image extraction & live preview.")}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            className="gap-1.5"
            onClick={handleBookmark}
            title={isCurrentBookmarked ? tr("已收藏", "Bookmarked") : tr("收藏当前配色", "Bookmark current")}
          >
            {isCurrentBookmarked ? (
              <BookmarkCheck size={16} className="text-amber-500" />
            ) : (
              <Bookmark size={16} />
            )}
            {isCurrentBookmarked ? tr("已收藏", "Saved") : tr("收藏", "Save")}
          </Button>

          <Button
            variant="outline"
            className="gap-1.5"
            onClick={() => fileInputRef.current?.click()}
          >
            <ImagePlus size={16} />
            {tr("图片提色", "From Image")}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            hidden
            accept="image/*"
            onChange={handleImageFile}
          />

          <Button
            className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white font-medium"
            onClick={handleRandomize}
          >
            <Shuffle size={16} />
            {tr("换一组灵感", "New Palette")}
          </Button>
        </div>
      </header>

      {/* ── 状态/轻量提示 ── */}
      {toastMsg && (
        <div className="rounded-xl border border-primary/20 bg-primary/10 px-4 py-2 text-sm text-primary flex items-center gap-2 animate-in fade-in duration-200">
          <Check size={16} />
          <span>{toastMsg}</span>
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-destructive/20 bg-destructive/10 px-4 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {/* ── 核心调色板超大色块展示 ── */}
      <section
        className="overflow-hidden rounded-2xl border shadow-sm flex flex-col md:flex-row min-h-[280px] md:min-h-[360px]"
        aria-label={tr("当前配色展示", "Current Palette Display")}
      >
        {colors.map((hex, idx) => {
          const textColor = getTextColorForBg(hex);
          const isLocked = locked[idx];
          const [r, g, b] = hexToRgb(hex);
          const isEditing = editingIndex === idx;

          return (
            <div
              key={idx}
              style={{ backgroundColor: hex, color: textColor }}
              className="relative flex flex-1 flex-col justify-between p-5 transition-all duration-200 group min-h-[100px] md:min-h-0"
            >
              {/* 顶部：序号与锁定按钮 */}
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold opacity-60">0{idx + 1}</span>
                <button
                  type="button"
                  onClick={() => toggleLock(idx)}
                  title={isLocked ? tr("点击解锁", "Click to unlock") : tr("锁定此颜色（生成时不改变）", "Lock color")}
                  className={`grid h-8 w-8 place-items-center rounded-full border transition-all ${
                    isLocked
                      ? "bg-black/20 border-white/40 shadow-inner"
                      : "border-current/20 hover:bg-black/10 opacity-75 group-hover:opacity-100"
                  }`}
                >
                  {isLocked ? <LockKeyhole size={15} /> : <Unlock size={15} />}
                </button>
              </div>

              {/* 中间/底部信息：点击一键复制色值 */}
              <div className="space-y-2 mt-4 md:mt-0">
                <button
                  type="button"
                  onClick={() => copyToClipboard(hex, tr("已复制色值", "Copied"))}
                  className="flex items-center gap-1.5 font-mono text-lg font-bold tracking-wider hover:underline text-left w-full"
                  title={tr("点击复制 HEX 色值", "Click to copy HEX")}
                >
                  <span>{hex}</span>
                  <Copy size={14} className="opacity-60 group-hover:opacity-100" />
                </button>
                <div className="font-mono text-[11px] opacity-70">
                  RGB({r}, {g}, {b})
                </div>

                {/* 调色按钮 */}
                <div className="pt-1 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingIndex(isEditing ? null : idx)}
                    className="inline-flex items-center gap-1 rounded-md border border-current/30 px-2 py-0.5 text-xs font-medium hover:bg-black/10 transition-colors"
                  >
                    <Sliders size={12} />
                    {isEditing ? tr("收起", "Close") : tr("微调", "Edit")}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </section>

      {/* ── 展开微调面板 ── */}
      {editingIndex !== null && colors[editingIndex] && (
        <div className="flex flex-wrap items-center gap-4 rounded-xl border bg-card p-4 shadow-sm animate-in fade-in">
          <Label className="font-semibold text-sm">
            {tr(`微调第 ${editingIndex + 1} 个色块`, `Tune color ${editingIndex + 1}`)}:
          </Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={colors[editingIndex]}
              onChange={(e) => {
                const nextHex = e.target.value.toUpperCase();
                setColors((prev) => prev.map((c, i) => (i === editingIndex ? nextHex : c)));
              }}
              className="h-9 w-12 cursor-pointer rounded border p-0.5 bg-background"
            />
            <Input
              className="w-28 font-mono uppercase"
              maxLength={7}
              value={colors[editingIndex]}
              onChange={(e) => {
                let v = e.target.value;
                if (!v.startsWith("#")) v = "#" + v;
                setColors((prev) => prev.map((c, i) => (i === editingIndex ? v.toUpperCase() : c)));
              }}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            {tr("调整此颜色后，可锁定该色块，并点击右上角换一组生成与它呼应的搭配。", "Lock this color and click 'New Palette' to generate harmonious matches around it.")}
          </p>
          <Button variant="ghost" size="sm" onClick={() => setEditingIndex(null)} className="ml-auto">
            {tr("完成", "Done")}
          </Button>
        </div>
      )}

      {/* ── 功能 Tab 切换区 ── */}
      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between border-b gap-2 pb-1">
          <div className="flex flex-wrap gap-1">
            {[
              { key: "library", label: tr("灵感主题库", "Preset Library"), icon: Sparkles },
              { key: "generate", label: tr("色彩理论搭配", "Harmony Rules"), icon: Sliders },
              { key: "preview", label: tr("场景效果预览", "Live Preview"), icon: Eye },
              { key: "export", label: tr("导出与代码", "Export & Code"), icon: Download },
              {
                key: "saved",
                label: `${tr("我的收藏", "Favorites")} (${saved.length})`,
                icon: Bookmark,
              },
            ].map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setActiveTab(key as any)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-all ${
                  activeTab === key
                    ? "border-amber-500 text-amber-600 font-semibold"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Icon size={16} />
                <span>{label}</span>
              </button>
            ))}
          </div>

          {activeTab === "library" && (
            <div className="flex items-center gap-2">
              <div className="relative">
                <Search size={14} className="absolute left-2.5 top-2.5 text-muted-foreground" />
                <Input
                  className="w-44 pl-8 h-8 text-xs"
                  placeholder={tr("搜索灵感、关键词…", "Search presets, tags…")}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </div>
            </div>
          )}
        </div>

        {/* ── Tab 1: 灵感主题库 ── */}
        {activeTab === "library" && (
          <div className="space-y-4">
            {/* 分类快捷标签 */}
            <div className="flex flex-wrap gap-1.5">
              {[
                { id: "all", name: tr("全部", "All") },
                { id: "oriental", name: tr("🏮 东方传统美学", "🏮 Oriental") },
                { id: "nature", name: tr("🌸 自然与四季", "🌸 Nature & Seasons") },
                { id: "ui", name: tr("💻 现代 UI / 产品", "💻 Modern UI") },
                { id: "art", name: tr("🎨 艺术与流行情绪", "🎨 Art & Pop") },
              ].map((cat) => (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => setCategoryFilter(cat.id as PresetCategory)}
                  className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                    categoryFilter === cat.id
                      ? "bg-amber-600 text-white"
                      : "bg-muted text-muted-foreground hover:bg-muted/80"
                  }`}
                >
                  {cat.name}
                </button>
              ))}
            </div>

            {/* 卡片网格 */}
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filteredPresets.map((preset, pIdx) => (
                <div
                  key={pIdx}
                  className="overflow-hidden rounded-xl border bg-card text-left transition-all hover:shadow-md hover:border-amber-500/40 group"
                >
                  {/* 5色水平条 */}
                  <div
                    className="flex h-20 w-full cursor-pointer"
                    title={tr("点击应用此配色", "Click to apply")}
                    onClick={() => applyPalette(preset.colors)}
                  >
                    {preset.colors.map((c, cIdx) => (
                      <span
                        key={cIdx}
                        className="flex-1 h-full transition-transform hover:scale-105"
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>

                  <div className="p-3.5 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-sm">
                        {tr(preset.zh, preset.en)}
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs px-2 text-muted-foreground hover:text-amber-600"
                        onClick={() => applyPalette(preset.colors)}
                      >
                        {tr("应用", "Apply")} →
                      </Button>
                    </div>

                    <div className="flex flex-wrap gap-1">
                      {preset.tags.slice(0, 3).map((tag, tIdx) => (
                        <span
                          key={tIdx}
                          className="rounded bg-muted/60 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                        >
                          #{tag}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            {filteredPresets.length === 0 && (
              <div className="text-center py-12 text-sm text-muted-foreground">
                {tr("没有找到匹配的配色方案，换个搜索词试试", "No matching palettes found")}
              </div>
            )}
          </div>
        )}

        {/* ── Tab 2: 色彩理论搭配 ── */}
        {activeTab === "generate" && (
          <div className="grid gap-6 md:grid-cols-2 rounded-2xl border bg-card p-6">
            <div className="space-y-4">
              <h3 className="font-semibold text-base flex items-center gap-2">
                <Sliders size={18} className="text-amber-500" />
                {tr("基于经典色彩学的智能推导", "Harmony Theory Generator")}
              </h3>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {tr(
                  "选择一种色彩调和规则，算法将以你当前锁定的主色为锚点，自动计算在色相环上具备完美视觉张力与舒适感的色盘。",
                  "Select a color harmony rule. The algorithm anchors to your locked color and computes optimal hues on the color wheel."
                )}
              </p>

              <div className="space-y-3 pt-2">
                <Label>{tr("选择调和模式", "Color Harmony Rule")}</Label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {[
                    { id: "analogous", title: tr("柔和邻近色", "Analogous"), desc: tr("色相相邻 30°，温润统一自然", "Adjacent hues for soothing feel") },
                    { id: "complementary", title: tr("互补撞色", "Complementary"), desc: tr("色相对冲 180°，吸睛强烈反差", "Opposite hues for high contrast") },
                    { id: "split", title: tr("分裂互补色", "Split-Complementary"), desc: tr("对立两侧各偏移，富于张力", "Contrast with less tension") },
                    { id: "triadic", title: tr("三色平衡", "Triadic"), desc: tr("120° 等边三角形，生动和谐", "Balanced vibrant trio") },
                    { id: "mono", title: tr("单色阶梯", "Monochromatic"), desc: tr("同色相明度变化，简约高级", "Pure tint and shade scale") },
                  ].map((rule) => (
                    <button
                      key={rule.id}
                      type="button"
                      onClick={() => setHarmonyMode(rule.id)}
                      className={`text-left p-3 rounded-xl border transition-all ${
                        harmonyMode === rule.id
                          ? "border-amber-500 bg-amber-500/10 font-semibold"
                          : "border-border hover:bg-muted/40"
                      }`}
                    >
                      <div className="text-sm">{rule.title}</div>
                      <div className="text-[11px] text-muted-foreground mt-0.5">{rule.desc}</div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="pt-2">
                <Button className="w-full gap-2 bg-amber-600 hover:bg-amber-700 text-white" onClick={handleRandomize}>
                  <Sparkles size={16} />
                  {tr("按此规则立即计算新色盘", "Generate Palette with Rule")}
                </Button>
              </div>
            </div>

            {/* 对比度即时检测小工具 */}
            <div className="rounded-xl border bg-muted/20 p-5 space-y-4">
              <h4 className="font-semibold text-sm flex items-center gap-2">
                <Eye size={16} />
                {tr("无障碍对比度检测 (WCAG 2.1)", "Accessibility Contrast Check")}
              </h4>
              <p className="text-xs text-muted-foreground">
                {tr("测试色盘内前景色与背景色的对比度，确保文字清晰易读。", "Test contrast between foreground and background in your palette.")}
              </p>

              <div className="grid grid-cols-2 gap-3">
                {colors.slice(0, 4).map((c, i) => {
                  const bg = colors[4] || "#FFFFFF";
                  const ratio = getContrastRatio(c, bg);
                  const isPassAA = ratio >= 4.5;
                  const isPassAAA = ratio >= 7.0;

                  return (
                    <div key={i} className="p-3 rounded-lg border bg-card space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="w-4 h-4 rounded-full border" style={{ backgroundColor: c }} />
                        <span className="font-mono text-xs font-semibold">{c}</span>
                      </div>
                      <div className="text-xs font-mono text-muted-foreground">
                        {ratio.toFixed(2)} : 1
                      </div>
                      <div className="flex gap-2 text-[10px]">
                        <span className={isPassAA ? "text-emerald-600 font-bold" : "text-destructive"}>
                          AA {isPassAA ? "✓" : "✗"}
                        </span>
                        <span className={isPassAAA ? "text-emerald-600 font-bold" : "text-muted-foreground"}>
                          AAA {isPassAAA ? "✓" : "✗"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        {/* ── Tab 3: 场景效果预览 ── */}
        {activeTab === "preview" && (
          <div className="grid gap-6 lg:grid-cols-2">
            {/* UI 组件卡片模拟 */}
            <div
              className="rounded-2xl border p-6 space-y-6 shadow-sm"
              style={{ backgroundColor: colors[4] || "#F8FAFC", color: getTextColorForBg(colors[4] || "#FFFFFF") }}
            >
              <div className="flex items-center justify-between border-b pb-3 border-current/10">
                <div className="flex items-center gap-2">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: colors[0] }} />
                  <span className="font-bold text-sm">Dashboard UI Component</span>
                </div>
                <span
                  className="rounded-full px-2 py-0.5 text-xs font-medium"
                  style={{ backgroundColor: colors[1], color: getTextColorForBg(colors[1]) }}
                >
                  Featured
                </span>
              </div>

              <div className="space-y-2">
                <h4 className="text-2xl font-bold tracking-tight" style={{ color: colors[0] }}>
                  {tr("优雅的视觉层级与舒适度", "Visual Hierarchy & Harmony")}
                </h4>
                <p className="text-sm opacity-80 leading-relaxed">
                  {tr("通过合理的深浅搭配，主视觉色突出核心操作，辅助色传达次级信息，让界面既专业又具辨识度。", "Well-balanced hues accentuate primary actions while complementary shades communicate secondary info with clarity.")}
                </p>
              </div>

              {/* 模拟按钮组件 */}
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  className="rounded-xl px-5 py-2 text-sm font-semibold shadow-md transition-transform hover:scale-105"
                  style={{ backgroundColor: colors[0], color: getTextColorForBg(colors[0]) }}
                >
                  {tr("主要操作按钮", "Primary Action")}
                </button>
                <button
                  type="button"
                  className="rounded-xl px-5 py-2 text-sm font-semibold border transition-colors"
                  style={{ borderColor: colors[1], color: colors[1] }}
                >
                  {tr("次级操作", "Secondary Action")}
                </button>
                <button
                  type="button"
                  className="rounded-xl px-3 py-2 text-sm font-medium"
                  style={{ backgroundColor: colors[2] + "30", color: colors[0] }}
                >
                  {tr("轻量标签", "Subtle Badge")}
                </button>
              </div>

              {/* 模拟图表条 */}
              <div className="space-y-2 pt-2">
                <div className="text-xs opacity-70">{tr("数据图表配色预览：", "Data Chart Preview:")}</div>
                <div className="flex h-3 w-full rounded-full overflow-hidden">
                  <span style={{ width: "35%", backgroundColor: colors[0] }} />
                  <span style={{ width: "25%", backgroundColor: colors[1] }} />
                  <span style={{ width: "20%", backgroundColor: colors[2] }} />
                  <span style={{ width: "20%", backgroundColor: colors[3] }} />
                </div>
              </div>
            </div>

            {/* 渐变与海报模拟 */}
            <div className="space-y-4">
              <div
                className="h-64 rounded-2xl p-6 flex flex-col justify-between text-white shadow-md relative overflow-hidden"
                style={{
                  background: `linear-gradient(135deg, ${colors[0]} 0%, ${colors[1]} 50%, ${colors[2]} 100%)`,
                }}
              >
                <div className="flex justify-between items-start">
                  <span className="rounded-full bg-white/20 backdrop-blur-md px-3 py-1 text-xs font-semibold">
                    {tr("CSS 渐变模拟", "CSS Gradient Preview")}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 text-xs bg-white/20 border-white/30 text-white hover:bg-white/30"
                    onClick={() => copyToClipboard(`background: linear-gradient(135deg, ${colors[0]} 0%, ${colors[1]} 50%, ${colors[2]} 100%);`)}
                  >
                    {tr("复制 CSS 渐变", "Copy CSS Gradient")}
                  </Button>
                </div>

                <div className="space-y-1">
                  <div className="text-2xl font-bold font-mono tracking-tight">
                    {colors[0]} ➔ {colors[1]} ➔ {colors[2]}
                  </div>
                  <div className="text-xs opacity-80">
                    {tr("适用于 Banner、海报背景、强调区卡片与装饰渐变", "Ideal for banners, cards, hero sections and gradients")}
                  </div>
                </div>
              </div>

              {/* 色块明细条目 */}
              <div className="grid grid-cols-5 gap-2">
                {colors.map((c, i) => (
                  <div
                    key={i}
                    onClick={() => copyToClipboard(c)}
                    className="p-3 rounded-xl border bg-card text-center cursor-pointer hover:border-amber-500 transition-colors"
                  >
                    <div className="w-full h-8 rounded-lg mb-2" style={{ backgroundColor: c }} />
                    <div className="font-mono text-xs font-bold truncate">{c}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Tab 4: 导出与代码 ── */}
        {activeTab === "export" && (
          <div className="space-y-4 rounded-2xl border bg-card p-6">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b pb-4">
              <div>
                <h3 className="font-semibold text-base">{tr("导出配色资产", "Export Palette Assets")}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {tr("支持直接复制 CSS 变量、Tailwind 配置、JSON 或保存高清色卡图片。", "Copy CSS vars, Tailwind config, JSON, or download HD swatch PNG.")}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  className="gap-1.5"
                  onClick={exportSwatchPng}
                >
                  <Download size={15} />
                  {tr("下载高清色卡 PNG", "Download Swatch PNG")}
                </Button>
                <Button
                  className="gap-1.5 bg-amber-600 hover:bg-amber-700 text-white"
                  onClick={() => copyToClipboard(cssVarsCode, tr("已复制 CSS 变量", "Copied CSS Vars"))}
                >
                  <Copy size={15} />
                  {tr("复制全部 CSS 变量", "Copy CSS Vars")}
                </Button>
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-3 pt-2">
              {/* CSS 变量 */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-muted-foreground uppercase">CSS Variables</span>
                  <button
                    onClick={() => copyToClipboard(cssVarsCode)}
                    className="text-xs text-amber-600 hover:underline"
                  >
                    {tr("复制", "Copy")}
                  </button>
                </div>
                <pre className="p-3 rounded-xl bg-muted/40 font-mono text-xs overflow-x-auto max-h-56">
                  {cssVarsCode}
                </pre>
              </div>

              {/* Tailwind Config */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-muted-foreground uppercase">Tailwind Config</span>
                  <button
                    onClick={() => copyToClipboard(tailwindConfigCode)}
                    className="text-xs text-amber-600 hover:underline"
                  >
                    {tr("复制", "Copy")}
                  </button>
                </div>
                <pre className="p-3 rounded-xl bg-muted/40 font-mono text-xs overflow-x-auto max-h-56">
                  {tailwindConfigCode}
                </pre>
              </div>

              {/* JSON */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-muted-foreground uppercase">JSON Array</span>
                  <button
                    onClick={() => copyToClipboard(jsonCode)}
                    className="text-xs text-amber-600 hover:underline"
                  >
                    {tr("复制", "Copy")}
                  </button>
                </div>
                <pre className="p-3 rounded-xl bg-muted/40 font-mono text-xs overflow-x-auto max-h-56">
                  {jsonCode}
                </pre>
              </div>
            </div>
          </div>
        )}

        {/* ── Tab 5: 我的收藏 ── */}
        {activeTab === "saved" && (
          <div className="space-y-4">
            {saved.length === 0 ? (
              <div className="text-center py-16 rounded-2xl border border-dashed bg-card space-y-2">
                <Bookmark size={32} className="mx-auto text-muted-foreground opacity-40" />
                <h4 className="font-semibold text-sm">{tr("暂无收藏配色", "No saved palettes yet")}</h4>
                <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                  {tr("在上方调色板或预设库中找到心仪的搭配，点击右上角【收藏】即可常驻保存于此。", "Find combinations you love and click 'Save' to keep them here permanently.")}
                </p>
              </div>
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {saved.map((item, idx) => (
                  <div
                    key={idx}
                    className="overflow-hidden rounded-xl border bg-card text-left shadow-sm group hover:border-amber-500/50"
                  >
                    <div
                      className="flex h-20 w-full cursor-pointer"
                      onClick={() => applyPalette(item.colors)}
                      title={tr("点击应用此配色", "Apply")}
                    >
                      {item.colors.map((c, i) => (
                        <span key={i} className="flex-1 h-full" style={{ backgroundColor: c }} />
                      ))}
                    </div>
                    <div className="p-3 flex items-center justify-between">
                      <span className="text-xs font-medium">{item.zh}</span>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs px-2"
                          onClick={() => applyPalette(item.colors)}
                        >
                          {tr("应用", "Apply")}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs px-2 text-destructive hover:bg-destructive/10"
                          onClick={() => setSaved(saved.filter((_, i) => i !== idx))}
                        >
                          {tr("删除", "Delete")}
                        </Button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
