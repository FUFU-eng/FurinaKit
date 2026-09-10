"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  PenTool,
  Download,
  Copy,
  Check,
  Undo2,
  Redo2,
  Trash2,
  Sparkles,
  FileText,
  Stamp,
  Sliders,
  Loader2,
  Wand2,
  Move,
  RefreshCw,
} from "lucide-react";
import { Input } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils";

// 62 种艺术字与一笔签字体样式
export interface YishuziFont {
  id: string;
  name: string;
  group: string;
}

export const YISHUZI_FONTS: YishuziFont[] = [
  // 经典一笔与连笔签
  { id: "901", name: "2.一笔艺术签 (推荐)", group: "经典一笔与连笔签" },
  { id: "904", name: "3.连笔商务签", group: "经典一笔与连笔签" },
  { id: "905", name: "4.一笔商务签", group: "经典一笔与连笔签" },
  { id: "900", name: "1.艺术花鸟签", group: "经典一笔与连笔签" },
  // 名家行草与手书
  { id: "704", name: "5.行楷字", group: "名家行草与手书" },
  { id: "740", name: "27.手迹行楷", group: "名家行草与手书" },
  { id: "725", name: "18.毛笔隶书", group: "名家行草与手书" },
  { id: "764", name: "37.霸燃手书", group: "名家行草与手书" },
  { id: "776", name: "49.手写字体", group: "名家行草与手书" },
  { id: "782", name: "55.毛泽东字体", group: "名家行草与手书" },
  // 古典篆书印刻
  { id: "768", name: "41.古文篆书", group: "古典篆书印刻" },
  { id: "769", name: "42.大篆体字", group: "古典篆书印刻" },
  { id: "770", name: "43.小篆字体", group: "古典篆书印刻" },
  // 创意与潮流艺术
  { id: "703", name: "6.大菱心", group: "创意与潮流艺术" },
  { id: "706", name: "7.小菱心", group: "创意与潮流艺术" },
  { id: "709", name: "8.卡通妖姬", group: "创意与潮流艺术" },
  { id: "710", name: "9.小布丁", group: "创意与潮流艺术" },
  { id: "711", name: "10.莫莉体", group: "创意与潮流艺术" },
  { id: "712", name: "11.云霄体", group: "创意与潮流艺术" },
  { id: "713", name: "12.奶茶体", group: "创意与潮流艺术" },
  { id: "715", name: "13.标题体", group: "创意与潮流艺术" },
  { id: "718", name: "14.非凡体", group: "创意与潮流艺术" },
  { id: "719", name: "15.御守锦书", group: "创意与潮流艺术" },
  { id: "721", name: "16.刀刀体", group: "创意与潮流艺术" },
  { id: "723", name: "17.漫画体", group: "创意与潮流艺术" },
  { id: "728", name: "19.不倒翁弯", group: "创意与潮流艺术" },
  { id: "729", name: "20.巧纸鹤", group: "创意与潮流艺术" },
  { id: "730", name: "21.纸飞机", group: "创意与潮流艺术" },
  { id: "732", name: "22.霓虹体", group: "创意与潮流艺术" },
  { id: "733", name: "23.奶酪体", group: "创意与潮流艺术" },
  { id: "734", name: "24.彩虹高光", group: "创意与潮流艺术" },
  { id: "735", name: "25.萌趣兔兔", group: "创意与潮流艺术" },
  { id: "739", name: "26.妞妞体", group: "创意与潮流艺术" },
  { id: "745", name: "28.少年和风", group: "创意与潮流艺术" },
  { id: "748", name: "29.甜心体", group: "创意与潮流艺术" },
  { id: "753", name: "30.露珠体", group: "创意与潮流艺术" },
  { id: "754", name: "31.千纸鹤", group: "创意与潮流艺术" },
  { id: "755", name: "32.闪电体", group: "创意与潮流艺术" },
  { id: "758", name: "33.方格习字", group: "创意与潮流艺术" },
  { id: "760", name: "34.梦幻体", group: "创意与潮流艺术" },
  { id: "762", name: "35.拼音字", group: "创意与潮流艺术" },
  { id: "763", name: "36.彩虹曲奇", group: "创意与潮流艺术" },
  { id: "765", name: "38.和风体", group: "创意与潮流艺术" },
  { id: "766", name: "39.初林体", group: "创意与潮流艺术" },
  { id: "767", name: "40.少女体", group: "创意与潮流艺术" },
  { id: "771", name: "44.一起去看海", group: "创意与潮流艺术" },
  { id: "772", name: "45.信心相随", group: "创意与潮流艺术" },
  { id: "773", name: "46.小肥泡中文", group: "创意与潮流艺术" },
  { id: "774", name: "47.幸福四叶草", group: "创意与潮流艺术" },
  { id: "775", name: "48.恋爱蝴蝶结", group: "创意与潮流艺术" },
  { id: "777", name: "50.星火爱情", group: "创意与潮流艺术" },
  { id: "778", name: "51.星际Cream", group: "创意与潮流艺术" },
  { id: "779", name: "52.暮夏何其孽", group: "创意与潮流艺术" },
  { id: "780", name: "53.甜菜五道杠", group: "创意与潮流艺术" },
  { id: "781", name: "54.森林字体", group: "创意与潮流艺术" },
  // 英文花体艺术
  { id: "401", name: "56.Filxgirl", group: "英文花体艺术" },
  { id: "402", name: "57.Blazed", group: "英文花体艺术" },
  { id: "403", name: "58.Cotillio", group: "英文花体艺术" },
  { id: "404", name: "59.Cool Text", group: "英文花体艺术" },
  { id: "405", name: "60.Signature", group: "英文花体艺术" },
  { id: "406", name: "61.Handwriting", group: "英文花体艺术" },
  { id: "407", name: "62.Love You", group: "英文花体艺术" },
];

export interface SignatureFont {
  id: string;
  name: string;
  family: string;
  category: "chinese" | "english";
  tag: string;
}

export const SIGNATURE_FONTS: SignatureFont[] = [
  { id: "zhimangxing", name: "钟齐志莽行书", family: "'Zhi Mang Xing', 'STXingkai', '华文行楷', cursive", category: "chinese", tag: "飘逸行书" },
  { id: "mashanzheng", name: "马善政毛笔楷", family: "'Ma Shan Zheng', 'STKaiti', '楷体', cursive", category: "chinese", tag: "苍劲楷书" },
  { id: "longcang", name: "龙藏体草书", family: "'Long Cang', 'STXingkai', cursive", category: "chinese", tag: "狂草连笔" },
  { id: "liujianmaocao", name: "刘建毛草书", family: "'Liu Jian Mao Cao', 'STXingkai', cursive", category: "chinese", tag: "连笔一气" },
  { id: "greatvibes", name: "Great Vibes", family: "'Great Vibes', cursive", category: "english", tag: "奢华花体" },
  { id: "dancingscript", name: "Dancing Script", family: "'Dancing Script', cursive", category: "english", tag: "灵动连笔" },
  { id: "pacifico", name: "Pacifico", family: "'Pacifico', cursive", category: "english", tag: "现代手写" },
  { id: "satisfy", name: "Satisfy", family: "'Satisfy', cursive", category: "english", tag: "商务签字" },
];

export const PRESET_COLORS = [
  { name: "商务蓝", value: "#0000FF" },
  { name: "曜石黑", value: "#000000" },
  { name: "中国红", value: "#DC2626" },
  { name: "奢华金", value: "#D97706" },
  { name: "翡翠绿", value: "#059669" },
  { name: "深海青", value: "#0284C7" },
  { name: "罗兰紫", value: "#7C3AED" },
];

interface StrokePoint {
  x: number;
  y: number;
  pressure: number;
  time: number;
}

interface Stroke {
  points: StrokePoint[];
  color: string;
  width: number;
  type: "pen" | "brush" | "marker";
}

export function SignatureDesignerTool() {
  const { toast } = useToast();

  // Tab 状态: onestroke (一笔签名设计) | calligraphy (本地书法字库) | handwriting (自由手写板) | contract (合同实景预览)
  const [activeTab, setActiveTab] = useState<"onestroke" | "calligraphy" | "handwriting" | "contract">("onestroke");

  // ===== 1. 一笔签名设计状态 (默认名字芙宁娜) =====
  const [osName, setOsName] = useState<string>("芙宁娜");
  const [osFontId, setOsFontId] = useState<string>("901"); // 默认 2.一笔艺术签
  const [osColor, setOsColor] = useState<string>("#0000FF"); // 默认商务蓝（与截图一致）
  const [osAutoTransparent, setOsAutoTransparent] = useState<boolean>(true); // 智能去除背景生成纯透明PNG
  const [osLoading, setOsLoading] = useState<boolean>(false);
  const [osResultDataUrl, setOsResultDataUrl] = useState<string | null>(null);
  const [osTransparentDataUrl, setOsTransparentDataUrl] = useState<string | null>(null);
  const [osHistory, setOsHistory] = useState<Array<{ name: string; fontName: string; url: string; transparentUrl: string }>>([]);

  // ===== 2. 书法字库与印章状态 =====
  const [calName, setCalName] = useState<string>("芙宁娜");
  const [calFontId, setCalFontId] = useState<string>("zhimangxing");
  const [calColor, setCalColor] = useState<string>("#0000FF");
  const [showUnderline, setShowUnderline] = useState<boolean>(true);
  const [underlineStyle, setUnderlineStyle] = useState<"flourish" | "straight" | "curve" | "zigzag">("flourish");
  const [hasSeal, setHasSeal] = useState<boolean>(true);
  const [sealText, setSealText] = useState<string>("芙宁娜印");
  const [sealStyle, setSealStyle] = useState<"yang" | "yin">("yang");
  const [sealShape, setSealShape] = useState<"square" | "circle">("square");
  const [showDateStamp, setShowDateStamp] = useState<boolean>(false);
  const [dateStampText, setDateStampText] = useState<string>(new Date().toISOString().split("T")[0]);

  // ===== 3. 手写板状态 =====
  const [hwColor, setHwColor] = useState<string>("#0000FF");
  const [hwPenType, setHwPenType] = useState<"pen" | "brush" | "marker">("pen");
  const [hwBaseWidth, setHwBaseWidth] = useState<number>(4);
  const [showGuidelines, setShowGuidelines] = useState<boolean>(true);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [redoStrokes, setRedoStrokes] = useState<Stroke[]>([]);
  const isDrawingRef = useRef<boolean>(false);
  const currentStrokeRef = useRef<StrokePoint[]>([]);

  // ===== 4. 合同实景预览状态 =====
  const [contractSignatureUrl, setContractSignatureUrl] = useState<string | null>(null);
  const [sigPosition, setSigPosition] = useState<{ x: number; y: number }>({ x: 260, y: 395 });
  const [sigScale, setSigScale] = useState<number>(0.85);
  const [isDragging, setIsDragging] = useState<boolean>(false);
  const dragStartRef = useRef<{ mouseX: number; mouseY: number; startX: number; startY: number }>({ mouseX: 0, mouseY: 0, startX: 0, startY: 0 });

  // DOM 引用
  const calCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const hwCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const contractContainerRef = useRef<HTMLDivElement | null>(null);

  // 引入 Google 艺术书法字体
  useEffect(() => {
    const linkId = "google-signature-fonts";
    if (!document.getElementById(linkId)) {
      const link = document.createElement("link");
      link.id = linkId;
      link.rel = "stylesheet";
      link.href = "https://fonts.googleapis.com/css2?family=Dancing+Script:wght@600;700&family=Great+Vibes&family=Liu+Jian+Mao+Cao&family=Long+Cang&family=Ma+Shan+Zheng&family=Pacifico&family=Satisfy&family=Zhi+Mang+Xing&display=swap";
      document.head.appendChild(link);
    }
  }, []);

  // 将背景像素设为透明并裁切空白
  const processImageToTransparent = useCallback((dataUrl: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const offCanvas = document.createElement("canvas");
        offCanvas.width = img.width;
        offCanvas.height = img.height;
        const ctx = offCanvas.getContext("2d");
        if (!ctx) {
          resolve(dataUrl);
          return;
        }

        ctx.drawImage(img, 0, 0);
        const imgData = ctx.getImageData(0, 0, offCanvas.width, offCanvas.height);
        const data = imgData.data;

        // 查找有效图形的边界以进行自动紧凑剪切
        let minX = offCanvas.width;
        let minY = offCanvas.height;
        let maxX = 0;
        let maxY = 0;
        let found = false;

        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          const minVal = Math.min(r, g, b);

          // 若非常接近白色 (背景)，将其透明化
          if (minVal > 246) {
            data[i + 3] = 0; // 完全透明
          } else if (minVal > 200) {
            // 平滑羽化边缘
            data[i + 3] = Math.round(((246 - minVal) / 46) * 255);
          }

          // 记录非透明像素范围
          if (data[i + 3] > 10) {
            found = true;
            const pixelIndex = i / 4;
            const x = pixelIndex % offCanvas.width;
            const y = Math.floor(pixelIndex / offCanvas.width);
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }

        ctx.putImageData(imgData, 0, 0);

        if (!found) {
          resolve(offCanvas.toDataURL("image/png"));
          return;
        }

        // 紧凑裁切，增加 18px 留白呼吸感
        const padding = 18;
        const cropX = Math.max(0, minX - padding);
        const cropY = Math.max(0, minY - padding);
        const cropW = Math.min(offCanvas.width - cropX, maxX - minX + padding * 2);
        const cropH = Math.min(offCanvas.height - cropY, maxY - minY + padding * 2);

        const cropCanvas = document.createElement("canvas");
        cropCanvas.width = cropW;
        cropCanvas.height = cropH;
        const cropCtx = cropCanvas.getContext("2d");
        if (cropCtx) {
          cropCtx.drawImage(offCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
          resolve(cropCanvas.toDataURL("image/png"));
        } else {
          resolve(offCanvas.toDataURL("image/png"));
        }
      };
      img.onerror = () => resolve(dataUrl);
      img.src = dataUrl;
    });
  }, []);

  // 生成「一笔签名」核心请求方法
  const handleGenerateOneStroke = useCallback(async (customName?: string, customFont?: string, customColor?: string) => {
    const targetName = (customName !== undefined ? customName : osName).trim();
    const targetFont = customFont || osFontId;
    const targetColor = customColor || osColor;

    if (!targetName) {
      toast({ title: "请输入姓名", description: "输入要设计的中文姓名或英文艺术签名", variant: "info" });
      return;
    }

    setOsLoading(true);
    try {
      const res = await fetch("/api/tools/yishuzi-signature", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: targetName,
          fontId: targetFont,
          fontColor: targetColor,
          bgColor: "#FFFFFE",
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success || !data.dataUrl) {
        throw new Error(data.error || "生成失败，请检查网络或稍后重试");
      }

      setOsResultDataUrl(data.dataUrl);

      // 处理为纯透明高保真 PNG
      const transparentPng = await processImageToTransparent(data.dataUrl);
      setOsTransparentDataUrl(transparentPng);

      // 默认同步到合同预览签名源
      setContractSignatureUrl(transparentPng);

      // 存入历史记录
      const fontObj = YISHUZI_FONTS.find((f) => f.id === targetFont);
      setOsHistory((prev) => [
        {
          name: targetName,
          fontName: fontObj ? fontObj.name : "一笔签",
          url: data.dataUrl,
          transparentUrl: transparentPng,
        },
        ...prev.slice(0, 9),
      ]);

      toast({ title: "签名设计成功", description: `已为您生成「${targetName}」的一笔艺术签名`, variant: "success" });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "未能完成签名渲染";
      toast({ title: "设计生成出错", description: msg, variant: "error" });
    } finally {
      setOsLoading(false);
    }
  }, [osName, osFontId, osColor, processImageToTransparent, toast]);

  // 初次加载时自动为默认名字“芙宁娜”生成一笔签名
  useEffect(() => {
    handleGenerateOneStroke("芙宁娜", "901", "#0000FF");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ===== 2. 本地字库签名重绘渲染逻辑 =====
  const renderCalligraphyCanvas = useCallback(() => {
    const canvas = calCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    const fontObj = SIGNATURE_FONTS.find((f) => f.id === calFontId) || SIGNATURE_FONTS[0];
    const text = calName.trim() || "芙宁娜";
    const fontSize = 88;

    ctx.save();
    ctx.font = `${fontSize}px ${fontObj.family}`;
    ctx.fillStyle = calColor;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";

    const textMetrics = ctx.measureText(text);
    const textWidth = textMetrics.width;
    const startX = Math.max(60, (width - textWidth - (hasSeal ? 80 : 0)) / 2 - 20);
    const centerY = height / 2 - 10;

    // 绘制字形主体
    ctx.fillText(text, startX, centerY);

    // 绘制一笔连笔划线或拉花
    if (showUnderline) {
      ctx.lineWidth = 3;
      ctx.strokeStyle = calColor;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      const lineStartY = centerY + fontSize * 0.42;
      const lineEndX = startX + textWidth + 70;

      ctx.beginPath();
      if (underlineStyle === "straight") {
        ctx.moveTo(startX - 20, lineStartY);
        ctx.lineTo(lineEndX, lineStartY);
      } else if (underlineStyle === "curve") {
        ctx.moveTo(startX - 20, lineStartY + 10);
        ctx.quadraticCurveTo(startX + textWidth * 0.5, lineStartY - 15, lineEndX, lineStartY + 5);
      } else if (underlineStyle === "flourish") {
        // 潇洒的连笔拉花
        ctx.moveTo(startX - 25, lineStartY);
        ctx.bezierCurveTo(
          startX + textWidth * 0.4,
          lineStartY + 25,
          startX + textWidth * 0.8,
          lineStartY - 22,
          lineEndX,
          lineStartY - 5
        );
        // 回旋尾翼飞扬
        ctx.bezierCurveTo(
          lineEndX + 45,
          lineStartY + 8,
          lineEndX + 20,
          lineStartY - 30,
          lineEndX - 20,
          lineStartY - 35
        );
      } else if (underlineStyle === "zigzag") {
        ctx.moveTo(startX - 15, lineStartY);
        ctx.lineTo(startX + textWidth * 0.6, lineStartY + 8);
        ctx.lineTo(startX + textWidth * 0.8, lineStartY - 8);
        ctx.lineTo(lineEndX, lineStartY + 4);
      }
      ctx.stroke();
    }

    // 绘制国风朱文/白文印章
    if (hasSeal && sealText.trim()) {
      const sealX = startX + textWidth + 35;
      const sealY = centerY - 25;
      const sealSize = 58;

      ctx.save();
      ctx.translate(sealX + sealSize / 2, sealY + sealSize / 2);
      ctx.rotate(-0.06); // 仿手工微倾角
      ctx.translate(-(sealX + sealSize / 2), -(sealY + sealSize / 2));

      const sealBorderColor = "#B91C1C";
      const sealBgColor = sealStyle === "yin" ? "#B91C1C" : "transparent";
      const sealTextColor = sealStyle === "yin" ? "#FFFFFF" : "#B91C1C";

      if (sealShape === "circle") {
        ctx.beginPath();
        ctx.arc(sealX + sealSize / 2, sealY + sealSize / 2, sealSize / 2, 0, Math.PI * 2);
        if (sealStyle === "yin") {
          ctx.fillStyle = sealBgColor;
          ctx.fill();
        }
        ctx.lineWidth = 3;
        ctx.strokeStyle = sealBorderColor;
        ctx.stroke();
      } else {
        if (sealStyle === "yin") {
          ctx.fillStyle = sealBgColor;
          ctx.fillRect(sealX, sealY, sealSize, sealSize);
        }
        ctx.lineWidth = 3;
        ctx.strokeStyle = sealBorderColor;
        ctx.strokeRect(sealX, sealY, sealSize, sealSize);
        // 双线内边框回纹质感
        ctx.lineWidth = 1;
        ctx.strokeRect(sealX + 3, sealY + 3, sealSize - 6, sealSize - 6);
      }

      // 印章文字 (2x2 或排版)
      ctx.fillStyle = sealTextColor;
      ctx.font = "bold 15px 'STKaiti', 'KaiTi', 'SimSun', serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const chars = sealText.trim().slice(0, 4);
      if (chars.length === 2) {
        ctx.fillText(chars[0], sealX + sealSize / 2, sealY + sealSize * 0.32);
        ctx.fillText(chars[1], sealX + sealSize / 2, sealY + sealSize * 0.72);
      } else if (chars.length === 3) {
        ctx.fillText(chars[0], sealX + sealSize * 0.3, sealY + sealSize * 0.32);
        ctx.fillText(chars[1], sealX + sealSize * 0.7, sealY + sealSize * 0.32);
        ctx.fillText(chars[2], sealX + sealSize / 2, sealY + sealSize * 0.72);
      } else if (chars.length >= 4) {
        ctx.fillText(chars[0], sealX + sealSize * 0.72, sealY + sealSize * 0.3);
        ctx.fillText(chars[1], sealX + sealSize * 0.72, sealY + sealSize * 0.72);
        ctx.fillText(chars[2], sealX + sealSize * 0.28, sealY + sealSize * 0.3);
        ctx.fillText(chars[3], sealX + sealSize * 0.28, sealY + sealSize * 0.72);
      } else {
        ctx.fillText(chars, sealX + sealSize / 2, sealY + sealSize / 2);
      }

      ctx.restore();
    }

    // 绘制签署日期公文戳
    if (showDateStamp) {
      ctx.fillStyle = "#6B7280";
      ctx.font = "14px monospace";
      ctx.textAlign = "left";
      ctx.fillText(`Date: ${dateStampText}`, startX, centerY + fontSize * 0.65);
    }

    ctx.restore();
  }, [calName, calFontId, calColor, showUnderline, underlineStyle, hasSeal, sealText, sealStyle, sealShape, showDateStamp, dateStampText]);

  useEffect(() => {
    if (activeTab === "calligraphy") {
      renderCalligraphyCanvas();
    }
  }, [activeTab, renderCalligraphyCanvas]);

  // ===== 3. 手写板画布绘制逻辑 =====
  const renderHandwritingCanvas = useCallback(() => {
    const canvas = hwCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const width = canvas.width;
    const height = canvas.height;
    ctx.clearRect(0, 0, width, height);

    // 绘制对齐辅助线与网格
    if (showGuidelines) {
      ctx.save();
      ctx.strokeStyle = "rgba(148, 163, 184, 0.25)";
      ctx.lineWidth = 1;
      ctx.setLineDash([6, 6]);

      // 水平基准线
      ctx.beginPath();
      ctx.moveTo(30, height / 2);
      ctx.lineTo(width - 30, height / 2);
      ctx.moveTo(30, height / 2 + 50);
      ctx.lineTo(width - 30, height / 2 + 50);
      ctx.stroke();

      ctx.restore();
    }

    // 绘制笔迹
    for (const stroke of strokes) {
      if (stroke.points.length < 2) continue;
      ctx.save();
      ctx.strokeStyle = stroke.color;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (stroke.type === "marker") {
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = stroke.width * 2.2;
      }

      for (let i = 1; i < stroke.points.length; i++) {
        const p1 = stroke.points[i - 1];
        const p2 = stroke.points[i];
        const midX = (p1.x + p2.x) / 2;
        const midY = (p1.y + p2.y) / 2;

        if (stroke.type === "brush") {
          const speed = Math.hypot(p2.x - p1.x, p2.y - p1.y) / Math.max(1, p2.time - p1.time);
          const brushWidth = Math.max(1.5, stroke.width * (1.6 - Math.min(speed, 1.2) * 0.7));
          ctx.lineWidth = brushWidth;
        } else if (stroke.type === "pen") {
          ctx.lineWidth = stroke.width;
        }

        ctx.beginPath();
        ctx.moveTo(p1.x, p1.y);
        ctx.quadraticCurveTo(p1.x, p1.y, midX, midY);
        ctx.stroke();
      }
      ctx.restore();
    }
  }, [strokes, showGuidelines]);

  useEffect(() => {
    if (activeTab === "handwriting") {
      renderHandwritingCanvas();
    }
  }, [activeTab, renderHandwritingCanvas]);

  // 手写交互事件
  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = hwCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;

    isDrawingRef.current = true;
    currentStrokeRef.current = [{ x, y, pressure: e.pressure || 0.5, time: Date.now() }];
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawingRef.current) return;
    const canvas = hwCanvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;

    currentStrokeRef.current.push({ x, y, pressure: e.pressure || 0.5, time: Date.now() });

    // 实时更新绘制当前笔画
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const pts = currentStrokeRef.current;
    if (pts.length >= 2) {
      const p1 = pts[pts.length - 2];
      const p2 = pts[pts.length - 1];
      ctx.save();
      ctx.strokeStyle = hwColor;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.lineWidth = hwPenType === "marker" ? hwBaseWidth * 2.2 : hwBaseWidth;
      if (hwPenType === "marker") ctx.globalAlpha = 0.55;

      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      ctx.restore();
    }
  };

  const handlePointerUp = () => {
    if (!isDrawingRef.current) return;
    isDrawingRef.current = false;
    if (currentStrokeRef.current.length > 0) {
      const newStroke: Stroke = {
        points: [...currentStrokeRef.current],
        color: hwColor,
        width: hwBaseWidth,
        type: hwPenType,
      };
      setStrokes((prev) => [...prev, newStroke]);
      setRedoStrokes([]);
      currentStrokeRef.current = [];
    }
  };

  // 获得已裁切透明的 Canvas
  const getCroppedCanvas = (sourceCanvas: HTMLCanvasElement): HTMLCanvasElement => {
    const ctx = sourceCanvas.getContext("2d");
    if (!ctx) return sourceCanvas;
    const { width, height } = sourceCanvas;
    const imgData = ctx.getImageData(0, 0, width, height);
    const data = imgData.data;

    let minX = width,
      minY = height,
      maxX = 0,
      maxY = 0,
      found = false;

    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 10) {
        found = true;
        const pixel = i / 4;
        const x = pixel % width;
        const y = Math.floor(pixel / width);
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }

    if (!found) return sourceCanvas;

    const pad = 24;
    const cropX = Math.max(0, minX - pad);
    const cropY = Math.max(0, minY - pad);
    const cropW = Math.min(width - cropX, maxX - minX + pad * 2);
    const cropH = Math.min(height - cropY, maxY - minY + pad * 2);

    const cropped = document.createElement("canvas");
    cropped.width = cropW;
    cropped.height = cropH;
    const cCtx = cropped.getContext("2d");
    if (cCtx) {
      cCtx.drawImage(sourceCanvas, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
      return cropped;
    }
    return sourceCanvas;
  };

  // 通用导出与剪贴板操作
  const copyCanvasToClipboard = async (canvas: HTMLCanvasElement | null, directDataUrl?: string | null) => {
    try {
      if (directDataUrl) {
        const response = await fetch(directDataUrl);
        const blob = await response.blob();
        await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
        toast({ title: "已复制到剪贴板", description: "透明签名图像已就绪，可直接 Ctrl + V 粘贴进文档或聊天窗口", variant: "success" });
        return;
      }

      if (!canvas) return;
      const cropped = getCroppedCanvas(canvas);
      cropped.toBlob(async (blob) => {
        if (!blob) return;
        await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
        toast({ title: "已复制到剪贴板", description: "透明签名图像已复制，支持直接粘贴到 Office/微信", variant: "success" });
      }, "image/png");
    } catch {
      toast({ title: "复制失败", description: "请尝试右键另存或使用下载按钮", variant: "error" });
    }
  };

  const downloadCanvasImage = (canvas: HTMLCanvasElement | null, filename: string, directDataUrl?: string | null) => {
    let url = directDataUrl;
    if (!url && canvas) {
      const cropped = getCroppedCanvas(canvas);
      url = cropped.toDataURL("image/png");
    }
    if (!url) return;

    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}_${Date.now()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast({ title: "下载已开始", description: "已保存透明底高清签名 PNG 文件", variant: "success" });
  };

  // 发送签名至合同预览
  const sendToContractPreview = (url: string | null) => {
    if (!url) return;
    setContractSignatureUrl(url);
    setActiveTab("contract");
    toast({ title: "已载入合同实景", description: "可在 A4 商务协议中自由拖拽移动或缩放签署印迹", variant: "success" });
  };

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6 pb-12">
      {/* 顶部标题与功能定位 */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-card/60 backdrop-blur-md border border-border/70 rounded-2xl p-6 shadow-sm">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="p-2 rounded-xl bg-primary/10 text-primary">
              <PenTool className="w-6 h-6" />
            </span>
            <h1 className="text-2xl font-bold tracking-tight">艺术与电子签名设计器</h1>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-blue-500/10 text-blue-500 font-medium border border-blue-500/20">
              极品连笔 · 手写板 · 合同预览
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            融合一笔签名设计转换算法与平滑压感画布，一键生成飘逸连笔、国风印章与透明无白边高清 PNG。
          </p>
        </div>

        {/* 顶部标签页切换 */}
        <div className="flex items-center gap-1 bg-muted/60 p-1.5 rounded-xl border border-border/50 self-start md:self-auto">
          <button
            onClick={() => setActiveTab("onestroke")}
            className={cn(
              "flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-lg transition-all",
              activeTab === "onestroke"
                ? "bg-background text-foreground shadow-sm font-semibold text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Sparkles className="w-3.5 h-3.5" />
            一笔签名设计
          </button>
          <button
            onClick={() => setActiveTab("calligraphy")}
            className={cn(
              "flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-lg transition-all",
              activeTab === "calligraphy"
                ? "bg-background text-foreground shadow-sm font-semibold text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <Stamp className="w-3.5 h-3.5" />
            书法字库与印章
          </button>
          <button
            onClick={() => setActiveTab("handwriting")}
            className={cn(
              "flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-lg transition-all",
              activeTab === "handwriting"
                ? "bg-background text-foreground shadow-sm font-semibold text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <PenTool className="w-3.5 h-3.5" />
            自由手写板
          </button>
          <button
            onClick={() => setActiveTab("contract")}
            className={cn(
              "flex items-center gap-2 px-3.5 py-1.5 text-xs font-medium rounded-lg transition-all",
              activeTab === "contract"
                ? "bg-background text-foreground shadow-sm font-semibold text-primary"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            <FileText className="w-3.5 h-3.5" />
            合同实景预览
          </button>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* 模式 1: 一笔签名设计在线转换器 (用户重点要求) */}
      {/* ========================================================================= */}
      {activeTab === "onestroke" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* 左侧配置面板 */}
          <div className="lg:col-span-4 space-y-5 bg-card/60 backdrop-blur-md border border-border/70 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-border/50 pb-3">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Sliders className="w-4 h-4 text-primary" />
                签名设计配置
              </h3>
              <span className="text-[11px] text-muted-foreground">62种流派免商字型</span>
            </div>

            {/* 签名姓名输入 (默认芙宁娜) */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground flex items-center justify-between">
                <span>签名文字 / 姓名</span>
                <span className="text-[11px] text-primary/80">支持中英双语</span>
              </label>
              <div className="relative">
                <Input
                  value={osName}
                  onChange={(e) => setOsName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleGenerateOneStroke();
                  }}
                  placeholder="请输入姓名，如：芙宁娜"
                  className="font-medium text-base pr-16"
                  maxLength={18}
                />
                <button
                  type="button"
                  onClick={() => {
                    setOsName("芙宁娜");
                    handleGenerateOneStroke("芙宁娜", osFontId, osColor);
                  }}
                  title="恢复默认名字"
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-medium text-primary hover:underline transition-colors"
                >
                  芙宁娜
                </button>
              </div>
            </div>

            {/* 选择艺术字体 (带分组下拉框) */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground flex items-center justify-between">
                <span>选择艺术字体</span>
                <span className="text-[11px] text-muted-foreground">{YISHUZI_FONTS.length} 种字型</span>
              </label>
              <select
                value={osFontId}
                onChange={(e) => {
                  setOsFontId(e.target.value);
                  handleGenerateOneStroke(osName, e.target.value, osColor);
                }}
                className="w-full h-10 px-3 text-sm rounded-lg border border-input bg-background/80 focus:outline-none focus:ring-2 focus:ring-primary/40"
              >
                {Array.from(new Set(YISHUZI_FONTS.map((f) => f.group))).map((grp) => (
                  <optgroup key={grp} label={grp} className="font-semibold">
                    {YISHUZI_FONTS.filter((f) => f.group === grp).map((font) => (
                      <option key={font.id} value={font.id}>
                        {font.name}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            {/* 签名颜色 */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">签名主色调</label>
              <div className="flex flex-wrap gap-2 pt-1">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => {
                      setOsColor(c.value);
                      handleGenerateOneStroke(osName, osFontId, c.value);
                    }}
                    className={cn(
                      "w-7 h-7 rounded-full transition-transform border flex items-center justify-center",
                      osColor === c.value ? "scale-110 ring-2 ring-primary ring-offset-2" : "opacity-80 hover:opacity-100 hover:scale-105"
                    )}
                    style={{ backgroundColor: c.value }}
                    title={c.name}
                  >
                    {osColor === c.value && <Check className="w-3.5 h-3.5 text-white drop-shadow-sm" />}
                  </button>
                ))}
                {/* 拾色器 */}
                <input
                  type="color"
                  value={osColor}
                  onChange={(e) => setOsColor(e.target.value)}
                  className="w-7 h-7 rounded-full cursor-pointer border border-border p-0 bg-transparent"
                  title="自定义取色"
                />
              </div>
            </div>

            {/* 高级选项：智能透明底色开关 */}
            <div className="pt-2 border-t border-border/40 space-y-3">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <span className="text-xs font-medium">自动抠除白底 (透明 PNG)</span>
                  <p className="text-[11px] text-muted-foreground">去除背景白边，便于插入 Office / 合同</p>
                </div>
                <input
                  type="checkbox"
                  checked={osAutoTransparent}
                  onChange={(e) => setOsAutoTransparent(e.target.checked)}
                  className="w-4 h-4 accent-primary rounded cursor-pointer"
                />
              </div>
            </div>

            {/* 核心设计大按钮 (对应网页 "给我设计") */}
            <button
              onClick={() => handleGenerateOneStroke()}
              disabled={osLoading}
              className="w-full py-3 px-4 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-600 hover:to-amber-700 text-white font-semibold text-sm shadow-md hover:shadow-lg transition-all flex items-center justify-center gap-2 active:scale-[0.99]"
            >
              {osLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  很努力地加载设计中...
                </>
              ) : (
                <>
                  <Wand2 className="w-4 h-4" />
                  给我设计
                </>
              )}
            </button>

            {/* 设计文化与一笔签名介绍 (对应网站说明) */}
            <div className="bg-muted/40 rounded-xl p-3.5 border border-border/40 text-[11px] leading-relaxed text-muted-foreground space-y-1.5">
              <div className="font-semibold text-foreground/80 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                一笔签名设计美学介绍
              </div>
              <p>
                <strong>一笔签</strong>，即签署姓名时飘逸潇洒，一气呵成，给人以酣畅淋漓的视觉冲击。
                注重整体签名的唯美协调，线条自然连贯，浑然一体；运笔跌宕起伏，签名字体迂回婉转之间体现自然之美。
              </p>
            </div>
          </div>

          {/* 右侧设计效果大展示区 */}
          <div className="lg:col-span-8 space-y-4">
            <div className="bg-card/70 backdrop-blur-md border border-border/70 rounded-2xl p-6 shadow-sm space-y-5">
              <div className="flex items-center justify-between border-b border-border/50 pb-3">
                <div className="flex items-center gap-2">
                  <h3 className="font-semibold text-sm">一笔签名设计免费版在线预览</h3>
                  {osLoading && (
                    <span className="text-xs text-amber-500 flex items-center gap-1 animate-pulse">
                      <Loader2 className="w-3 h-3 animate-spin" />
                      正在实时排版与运笔...
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleGenerateOneStroke()}
                    className="text-xs px-2.5 py-1 rounded-lg border border-border hover:bg-muted text-muted-foreground hover:text-foreground transition-colors flex items-center gap-1.5"
                  >
                    <RefreshCw className="w-3 h-3" />
                    重新生成
                  </button>
                </div>
              </div>

              {/* 核心预览图框 (与网站截图版式一致) */}
              <div className="w-full min-h-[300px] flex items-center justify-center rounded-xl border border-border/60 bg-white/95 dark:bg-zinc-950/80 p-8 shadow-inner overflow-hidden relative group">
                {/* 棋盘透明网格背景 (当开启透明模式时直观体现) */}
                {osAutoTransparent && (
                  <div
                    className="absolute inset-0 opacity-15 pointer-events-none"
                    style={{
                      backgroundImage: "radial-gradient(circle, #888 1px, transparent 1px)",
                      backgroundSize: "16px 16px",
                    }}
                  />
                )}

                {osLoading ? (
                  <div className="flex flex-col items-center justify-center space-y-3 py-12 text-muted-foreground">
                    <Loader2 className="w-8 h-8 animate-spin text-amber-500" />
                    <p className="text-sm font-medium">很努力地生成一笔签名中...</p>
                  </div>
                ) : osResultDataUrl ? (
                  <div className="relative flex flex-col items-center justify-center py-4">
                    {/* 显示生成的高清签名 */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={osAutoTransparent && osTransparentDataUrl ? osTransparentDataUrl : osResultDataUrl}
                      alt={osName}
                      className="max-h-56 object-contain select-none transition-transform group-hover:scale-105 duration-300 drop-shadow-sm"
                    />
                    <div className="mt-3 text-xs text-muted-foreground/80 flex items-center gap-2 font-mono">
                      <span>字型：{YISHUZI_FONTS.find((f) => f.id === osFontId)?.name || "一笔签"}</span>
                      <span>·</span>
                      <span>姓名：{osName}</span>
                      <span>·</span>
                      <span>状态：已就绪</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-center text-sm text-muted-foreground py-16">
                    点击左侧「给我设计」即可生成专属艺术签名
                  </div>
                )}
              </div>

              {/* 快捷操作动作条 */}
              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <div className="text-xs text-muted-foreground">
                  已启用智能透明边缘裁剪，无背景白边干扰
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => copyCanvasToClipboard(null, osAutoTransparent && osTransparentDataUrl ? osTransparentDataUrl : osResultDataUrl)}
                    disabled={!osResultDataUrl || osLoading}
                    className="px-3.5 py-2 text-xs font-medium rounded-xl border border-border bg-background hover:bg-muted transition-colors flex items-center gap-1.5 shadow-sm active:scale-95 disabled:opacity-40"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    复制透明图像
                  </button>
                  <button
                    onClick={() =>
                      downloadCanvasImage(
                        null,
                        `${osName}_一笔签`,
                        osAutoTransparent && osTransparentDataUrl ? osTransparentDataUrl : osResultDataUrl
                      )
                    }
                    disabled={!osResultDataUrl || osLoading}
                    className="px-4 py-2 text-xs font-medium rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-1.5 shadow-sm active:scale-95 disabled:opacity-40"
                  >
                    <Download className="w-3.5 h-3.5" />
                    下载透明 PNG
                  </button>
                  <button
                    onClick={() =>
                      sendToContractPreview(osAutoTransparent && osTransparentDataUrl ? osTransparentDataUrl : osResultDataUrl)
                    }
                    disabled={!osResultDataUrl || osLoading}
                    className="px-3 py-2 text-xs font-medium rounded-xl border border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 transition-colors flex items-center gap-1.5 shadow-sm active:scale-95 disabled:opacity-40"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    置入合同预览
                  </button>
                </div>
              </div>
            </div>

            {/* 近期生成记录 */}
            {osHistory.length > 0 && (
              <div className="bg-card/50 backdrop-blur-md border border-border/70 rounded-2xl p-4 shadow-sm space-y-3">
                <div className="flex items-center justify-between text-xs font-semibold text-muted-foreground">
                  <span>历史设计灵感 (快速换选)</span>
                  <span>{osHistory.length} 款记录</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
                  {osHistory.map((item, idx) => (
                    <div
                      key={idx}
                      onClick={() => {
                        setOsName(item.name);
                        setOsResultDataUrl(item.url);
                        setOsTransparentDataUrl(item.transparentUrl);
                      }}
                      className="group p-2.5 rounded-xl border border-border/60 hover:border-primary/50 bg-background/60 hover:bg-muted/50 cursor-pointer transition-all space-y-1.5 flex flex-col items-center text-center"
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={item.transparentUrl || item.url} alt={item.name} className="h-12 object-contain" />
                      <div className="text-[11px] font-medium text-foreground truncate w-full">{item.name}</div>
                      <div className="text-[10px] text-muted-foreground truncate w-full">{item.fontName}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 模式 2: 书法字库与印章 (Google Fonts + 国风姓名印章) */}
      {/* ========================================================================= */}
      {activeTab === "calligraphy" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 space-y-5 bg-card/60 backdrop-blur-md border border-border/70 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-border/50 pb-3">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Stamp className="w-4 h-4 text-primary" />
                书法与印章配置
              </h3>
            </div>

            {/* 签名名字输入 */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">签署姓名 / 昵称</label>
              <Input
                value={calName}
                onChange={(e) => setCalName(e.target.value)}
                placeholder="请输入姓名，如：芙宁娜"
                className="font-medium text-base"
              />
            </div>

            {/* 字体选择 */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">书法字体</label>
              <div className="grid grid-cols-2 gap-2">
                {SIGNATURE_FONTS.map((font) => (
                  <button
                    key={font.id}
                    onClick={() => setCalFontId(font.id)}
                    className={cn(
                      "p-2.5 text-left rounded-xl border transition-all text-xs flex flex-col justify-between h-16",
                      calFontId === font.id
                        ? "border-primary bg-primary/10 text-primary font-semibold shadow-sm"
                        : "border-border/60 hover:bg-muted/60 text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <span className="truncate">{font.name}</span>
                    <span className="text-[10px] opacity-70">{font.tag}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 颜色方案 */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">墨水色调</label>
              <div className="flex flex-wrap gap-2 pt-1">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => setCalColor(c.value)}
                    className={cn(
                      "w-7 h-7 rounded-full border transition-transform flex items-center justify-center",
                      calColor === c.value ? "scale-110 ring-2 ring-primary ring-offset-2" : "opacity-80 hover:opacity-100"
                    )}
                    style={{ backgroundColor: c.value }}
                  >
                    {calColor === c.value && <Check className="w-3.5 h-3.5 text-white drop-shadow-sm" />}
                  </button>
                ))}
              </div>
            </div>

            {/* 一笔签拉花拖尾配置 */}
            <div className="space-y-3 pt-2 border-t border-border/40">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">一笔签拉花划线</span>
                <input
                  type="checkbox"
                  checked={showUnderline}
                  onChange={(e) => setShowUnderline(e.target.checked)}
                  className="w-4 h-4 accent-primary rounded cursor-pointer"
                />
              </div>

              {showUnderline && (
                <div className="grid grid-cols-4 gap-1.5 pt-1">
                  {[
                    { id: "flourish", label: "行云尾翼" },
                    { id: "curve", label: "优雅弧线" },
                    { id: "straight", label: "沉稳横线" },
                    { id: "zigzag", label: "锐利折角" },
                  ].map((st) => (
                    <button
                      key={st.id}
                      onClick={() => setUnderlineStyle(st.id as "flourish" | "straight" | "curve" | "zigzag")}
                      className={cn(
                        "py-1.5 px-2 text-[11px] rounded-lg border text-center transition-all",
                        underlineStyle === st.id
                          ? "border-primary bg-primary/10 text-primary font-medium"
                          : "border-border hover:bg-muted text-muted-foreground"
                      )}
                    >
                      {st.label}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 国风印章配置 */}
            <div className="space-y-3 pt-2 border-t border-border/40">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">国风印章</span>
                <input
                  type="checkbox"
                  checked={hasSeal}
                  onChange={(e) => setHasSeal(e.target.checked)}
                  className="w-4 h-4 accent-primary rounded cursor-pointer"
                />
              </div>

              {hasSeal && (
                <div className="space-y-2.5">
                  <div className="flex gap-2">
                    <Input
                      value={sealText}
                      onChange={(e) => setSealText(e.target.value)}
                      placeholder="印章铭文，如：芙宁娜印"
                      className="text-xs h-8"
                      maxLength={4}
                    />
                    <button
                      onClick={() => setSealStyle(sealStyle === "yang" ? "yin" : "yang")}
                      className="px-2.5 py-1 rounded-lg border border-border bg-muted/50 text-xs font-medium whitespace-nowrap"
                    >
                      {sealStyle === "yang" ? "朱文 (阳刻)" : "白文 (阴刻)"}
                    </button>
                    <button
                      onClick={() => setSealShape(sealShape === "square" ? "circle" : "square")}
                      className="px-2.5 py-1 rounded-lg border border-border bg-muted/50 text-xs font-medium whitespace-nowrap"
                    >
                      {sealShape === "square" ? "方印" : "圆印"}
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 公文日期戳 */}
            <div className="space-y-2 pt-2 border-t border-border/40">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium">签署日期戳</span>
                <input
                  type="checkbox"
                  checked={showDateStamp}
                  onChange={(e) => setShowDateStamp(e.target.checked)}
                  className="w-4 h-4 accent-primary rounded cursor-pointer"
                />
              </div>
              {showDateStamp && (
                <Input
                  value={dateStampText}
                  onChange={(e) => setDateStampText(e.target.value)}
                  className="text-xs h-8 font-mono"
                />
              )}
            </div>
          </div>

          {/* 右侧书法预览画布 */}
          <div className="lg:col-span-8 space-y-4">
            <div className="bg-card/70 backdrop-blur-md border border-border/70 rounded-2xl p-6 shadow-sm space-y-5">
              <div className="flex items-center justify-between border-b border-border/50 pb-3">
                <h3 className="font-semibold text-sm">书法字库与印章渲染</h3>
                <span className="text-xs text-muted-foreground font-mono">1000 × 400 矢量超采样</span>
              </div>

              <div className="w-full flex items-center justify-center rounded-xl border border-border/60 bg-white/95 dark:bg-zinc-950/80 p-4 shadow-inner overflow-hidden">
                <canvas
                  ref={calCanvasRef}
                  width={1000}
                  height={380}
                  className="w-full h-auto max-h-72 object-contain"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <div className="text-xs text-muted-foreground">
                  已开启自动紧致裁剪与透明度优化
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => copyCanvasToClipboard(calCanvasRef.current)}
                    className="px-3.5 py-2 text-xs font-medium rounded-xl border border-border bg-background hover:bg-muted transition-colors flex items-center gap-1.5 shadow-sm active:scale-95"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    复制透明图像
                  </button>
                  <button
                    onClick={() => downloadCanvasImage(calCanvasRef.current, `${calName}_书法签名`)}
                    className="px-4 py-2 text-xs font-medium rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-1.5 shadow-sm active:scale-95"
                  >
                    <Download className="w-3.5 h-3.5" />
                    下载透明 PNG
                  </button>
                  <button
                    onClick={() => {
                      if (calCanvasRef.current) {
                        const cropped = getCroppedCanvas(calCanvasRef.current);
                        sendToContractPreview(cropped.toDataURL("image/png"));
                      }
                    }}
                    className="px-3 py-2 text-xs font-medium rounded-xl border border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 transition-colors flex items-center gap-1.5 shadow-sm active:scale-95"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    置入合同预览
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 模式 3: 自由平滑手写板 (RayByte 平滑压感手写板) */}
      {/* ========================================================================= */}
      {activeTab === "handwriting" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          <div className="lg:col-span-4 space-y-5 bg-card/60 backdrop-blur-md border border-border/70 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between border-b border-border/50 pb-3">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <PenTool className="w-4 h-4 text-primary" />
                画笔与手写设置
              </h3>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    if (strokes.length > 0) {
                      const last = strokes[strokes.length - 1];
                      setStrokes((prev) => prev.slice(0, -1));
                      setRedoStrokes((prev) => [last, ...prev]);
                    }
                  }}
                  disabled={strokes.length === 0}
                  className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40"
                  title="撤销"
                >
                  <Undo2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    if (redoStrokes.length > 0) {
                      const next = redoStrokes[0];
                      setRedoStrokes((prev) => prev.slice(1));
                      setStrokes((prev) => [...prev, next]);
                    }
                  }}
                  disabled={redoStrokes.length === 0}
                  className="p-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-40"
                  title="重做"
                >
                  <Redo2 className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    setStrokes([]);
                    setRedoStrokes([]);
                  }}
                  disabled={strokes.length === 0}
                  className="p-1.5 rounded-lg hover:bg-red-500/10 text-muted-foreground hover:text-red-500 disabled:opacity-40"
                  title="清空手写板"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* 笔触类型 */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">笔触质感</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: "pen", label: "签字笔 / 钢笔", desc: "速度敏感平滑" },
                  { id: "brush", label: "毛笔", desc: "轻重压感顿笔" },
                  { id: "marker", label: "马克笔", desc: "半透叠色" },
                ].map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setHwPenType(p.id as "pen" | "brush" | "marker")}
                    className={cn(
                      "p-2 rounded-xl border text-center transition-all flex flex-col items-center gap-1",
                      hwPenType === p.id
                        ? "border-primary bg-primary/10 text-primary font-semibold"
                        : "border-border/60 hover:bg-muted/60 text-muted-foreground"
                    )}
                  >
                    <span className="text-xs">{p.label}</span>
                    <span className="text-[10px] opacity-70">{p.desc}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* 笔画粗细 */}
            <div className="space-y-2">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>笔触粗细</span>
                <span className="font-mono">{hwBaseWidth} px</span>
              </div>
              <input
                type="range"
                min={2}
                max={14}
                value={hwBaseWidth}
                onChange={(e) => setHwBaseWidth(Number(e.target.value))}
                className="w-full accent-primary cursor-pointer"
              />
            </div>

            {/* 墨水颜色 */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">手写墨水色彩</label>
              <div className="flex flex-wrap gap-2 pt-1">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c.value}
                    onClick={() => setHwColor(c.value)}
                    className={cn(
                      "w-7 h-7 rounded-full border transition-transform flex items-center justify-center",
                      hwColor === c.value ? "scale-110 ring-2 ring-primary ring-offset-2" : "opacity-80 hover:opacity-100"
                    )}
                    style={{ backgroundColor: c.value }}
                  >
                    {hwColor === c.value && <Check className="w-3.5 h-3.5 text-white drop-shadow-sm" />}
                  </button>
                ))}
              </div>
            </div>

            {/* 辅助线 */}
            <div className="pt-2 border-t border-border/40 flex items-center justify-between">
              <span className="text-xs font-medium">显示签名基准参考线</span>
              <input
                type="checkbox"
                checked={showGuidelines}
                onChange={(e) => setShowGuidelines(e.target.checked)}
                className="w-4 h-4 accent-primary rounded cursor-pointer"
              />
            </div>
          </div>

          {/* 右侧手写交互板 */}
          <div className="lg:col-span-8 space-y-4">
            <div className="bg-card/70 backdrop-blur-md border border-border/70 rounded-2xl p-6 shadow-sm space-y-5">
              <div className="flex items-center justify-between border-b border-border/50 pb-3">
                <h3 className="font-semibold text-sm">手写签名画布 (支持数位板与鼠标压感)</h3>
                <span className="text-xs text-muted-foreground">笔画数: {strokes.length}</span>
              </div>

              <div className="w-full flex items-center justify-center rounded-xl border border-border/60 bg-white/95 dark:bg-zinc-950/80 p-2 shadow-inner overflow-hidden cursor-crosshair">
                <canvas
                  ref={hwCanvasRef}
                  width={1000}
                  height={380}
                  onPointerDown={handlePointerDown}
                  onPointerMove={handlePointerMove}
                  onPointerUp={handlePointerUp}
                  onPointerLeave={handlePointerUp}
                  className="w-full h-auto max-h-72 touch-none object-contain"
                />
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                <div className="text-xs text-muted-foreground">
                  导出时将自动裁剪多余边界，生成紧凑透明图形
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => copyCanvasToClipboard(hwCanvasRef.current)}
                    disabled={strokes.length === 0}
                    className="px-3.5 py-2 text-xs font-medium rounded-xl border border-border bg-background hover:bg-muted transition-colors flex items-center gap-1.5 shadow-sm active:scale-95 disabled:opacity-40"
                  >
                    <Copy className="w-3.5 h-3.5" />
                    复制透明图像
                  </button>
                  <button
                    onClick={() => downloadCanvasImage(hwCanvasRef.current, "手写电子签名")}
                    disabled={strokes.length === 0}
                    className="px-4 py-2 text-xs font-medium rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors flex items-center gap-1.5 shadow-sm active:scale-95 disabled:opacity-40"
                  >
                    <Download className="w-3.5 h-3.5" />
                    下载透明 PNG
                  </button>
                  <button
                    onClick={() => {
                      if (hwCanvasRef.current) {
                        const cropped = getCroppedCanvas(hwCanvasRef.current);
                        sendToContractPreview(cropped.toDataURL("image/png"));
                      }
                    }}
                    disabled={strokes.length === 0}
                    className="px-3 py-2 text-xs font-medium rounded-xl border border-blue-500/30 bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 transition-colors flex items-center gap-1.5 shadow-sm active:scale-95 disabled:opacity-40"
                  >
                    <FileText className="w-3.5 h-3.5" />
                    置入合同预览
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* 模式 4: 合同实景预览 (商务合作协议实景 Mockup) */}
      {/* ========================================================================= */}
      {activeTab === "contract" && (
        <div className="space-y-6">
          <div className="bg-card/60 backdrop-blur-md border border-border/70 rounded-2xl p-5 shadow-sm flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="space-y-1">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <FileText className="w-4 h-4 text-primary" />
                商务合同落款实景模拟
              </h3>
              <p className="text-xs text-muted-foreground">
                可按住签名印迹自由拖拽调整落款位置，滑动调整缩放比例，模拟真实 A4 公文效果。
              </p>
            </div>

            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 text-xs">
                <span>签名尺寸缩放:</span>
                <input
                  type="range"
                  min={0.4}
                  max={1.6}
                  step={0.05}
                  value={sigScale}
                  onChange={(e) => setSigScale(Number(e.target.value))}
                  className="w-28 accent-primary cursor-pointer"
                />
                <span className="font-mono text-muted-foreground">{Math.round(sigScale * 100)}%</span>
              </div>

              <button
                onClick={() => {
                  setSigPosition({ x: 260, y: 395 });
                  setSigScale(0.85);
                }}
                className="px-3 py-1.5 rounded-lg border border-border text-xs text-muted-foreground hover:text-foreground"
              >
                重置位置
              </button>
            </div>
          </div>

          {/* A4 纸张拟真容器 */}
          <div className="flex justify-center p-4 bg-muted/40 rounded-2xl border border-border/60 overflow-auto">
            <div
              ref={contractContainerRef}
              className="w-[720px] min-h-[640px] bg-white text-zinc-900 shadow-2xl rounded-sm p-12 relative select-none font-serif border border-zinc-200"
              onMouseMove={(e) => {
                if (!isDragging) return;
                const dx = e.clientX - dragStartRef.current.mouseX;
                const dy = e.clientY - dragStartRef.current.mouseY;
                setSigPosition({
                  x: dragStartRef.current.startX + dx,
                  y: dragStartRef.current.startY + dy,
                });
              }}
              onMouseUp={() => setIsDragging(false)}
            >
              {/* 合同红头与正文 */}
              <div className="text-center space-y-2 border-b-2 border-zinc-800 pb-5 mb-8">
                <h2 className="text-2xl font-bold tracking-widest text-zinc-900">战略项目合作框架协议书</h2>
                <div className="text-xs text-zinc-500 font-sans tracking-wide">
                  合同编号：FRN-2026-0909-SIGN · 签定地点：枫丹廷
                </div>
              </div>

              <div className="text-sm leading-relaxed text-zinc-700 space-y-4 text-justify font-sans">
                <p>
                  <strong>甲方（授权机构）：</strong>枫丹综合科技研创中心
                  <br />
                  <strong>乙方（签署代表）：</strong>{osName || "芙宁娜"}
                </p>
                <p className="indent-8">
                  甲乙双方依据平等自愿、互惠互利的合作原则，就数字化工具箱平台与智能签名交互组件的技术研发达成友好一致意向。
                  双方共同确认项目成果归属双方共享，本协议落款经双方签字或加盖电子印鉴后即时生效。
                </p>
                <p className="indent-8">
                  特此立约，双方谨遵诚实信用原则予以履行。
                </p>
              </div>

              {/* 签名签章区域 */}
              <div className="mt-20 pt-8 border-t border-zinc-300 grid grid-cols-2 gap-12 font-sans text-sm">
                <div className="space-y-4">
                  <p><strong>甲方（盖章）：</strong>枫丹综合科技研创中心</p>
                  <p>法定代表人（签章）：____________</p>
                  <p className="text-zinc-500 text-xs">签署日期：2026 年 09 月 09 日</p>
                </div>

                <div className="space-y-4 relative">
                  <p><strong>乙方（签署）：</strong>{osName || "芙宁娜"}</p>
                  <p>签署代表签字：</p>
                  <p className="text-zinc-500 text-xs">签署日期：2026 年 09 月 09 日</p>

                  {/* 悬浮可拖拽签名 */}
                  {contractSignatureUrl ? (
                    <div
                      style={{
                        position: "absolute",
                        left: `${sigPosition.x}px`,
                        top: `${sigPosition.y}px`,
                        transform: `scale(${sigScale})`,
                        transformOrigin: "center center",
                      }}
                      onMouseDown={(e) => {
                        e.stopPropagation();
                        setIsDragging(true);
                        dragStartRef.current = {
                          mouseX: e.clientX,
                          mouseY: e.clientY,
                          startX: sigPosition.x,
                          startY: sigPosition.y,
                        };
                      }}
                      className={cn(
                        "cursor-grab active:cursor-grabbing p-1 border border-dashed rounded transition-colors group",
                        isDragging ? "border-blue-500 ring-2 ring-blue-500/20" : "border-transparent hover:border-blue-400"
                      )}
                    >
                      <div className="absolute -top-5 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 bg-blue-600 text-white text-[10px] px-2 py-0.5 rounded shadow pointer-events-none whitespace-nowrap flex items-center gap-1">
                        <Move className="w-2.5 h-2.5" />
                        按住拖拽定位
                      </div>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={contractSignatureUrl}
                        alt="合同签名"
                        className="max-h-24 object-contain pointer-events-none drop-shadow-sm"
                      />
                    </div>
                  ) : (
                    <div className="absolute -top-3 left-28 text-xs text-amber-600 border border-dashed border-amber-300 bg-amber-50 p-2 rounded">
                      暂未载入签名，可在一笔签或手写板中点击「置入合同预览」
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
