"use client";

import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import QRCode from "qrcode";
import jsQR from "jsqr";
import {
  QrCode,
  Copy,
  Check,
  Download,
  Upload,
  RefreshCw,
  AlertCircle,
  CheckCircle2,
  Wifi,
  User,
  Mail,
  Link as LinkIcon,
  FileText,
  Share2,
  Shield,
  Eye,
  EyeOff,
  Palette,
  ExternalLink,
  ArrowRight,
  Info,
  Sliders,
  Layers,
  Sparkles,
  HelpCircle,
  Phone,
  FileUp,
} from "lucide-react";
import { Button, Input, Select, Textarea } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { tr, useLanguage } from "@/lib/language";
import { cn } from "@/lib/utils";

type QrType = "url" | "text" | "wifi" | "vcard" | "email" | "file" | "media_info";

const COLOR_PRESETS = [
  { nameZh: "经典曜黑", nameEn: "Classic Black", dark: "#0f172a", light: "#ffffff" },
  { nameZh: "海天深蓝", nameEn: "Ocean Blue", dark: "#0369a1", light: "#ffffff" },
  { nameZh: "极光黛紫", nameEn: "Aurora Purple", dark: "#6d28d9", light: "#ffffff" },
  { nameZh: "青翠翠绿", nameEn: "Emerald Green", dark: "#047857", light: "#ffffff" },
  { nameZh: "枫丹红", nameEn: "Fontaine Red", dark: "#be123c", light: "#ffffff" },
  { nameZh: "暖琥珀", nameEn: "Warm Amber", dark: "#b45309", light: "#ffffff" },
  { nameZh: "暗色背景", nameEn: "Dark Glow", dark: "#38bdf8", light: "#0f172a" },
];

export function QrGeneratorTool() {
  useLanguage();
  const { toast } = useToast();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Tab & Type
  const [activeType, setActiveType] = useState<QrType>("url");

  // Form Fields
  const [urlInput, setUrlInput] = useState("https://furinakit.app");
  const [textInput, setTextInput] = useState("欢迎使用 FurinaKit 全能工具箱！");

  // WiFi Fields
  const [wifiSsid, setWifiSsid] = useState("");
  const [wifiPassword, setWifiPassword] = useState("");
  const [wifiAuth, setWifiAuth] = useState<"WPA" | "WEP" | "nopass">("WPA");
  const [wifiHidden, setWifiHidden] = useState(false);
  const [showWifiPass, setShowWifiPass] = useState(false);

  // vCard Fields
  const [vcardName, setVcardName] = useState("");
  const [vcardPhone, setVcardPhone] = useState("");
  const [vcardEmail, setVcardEmail] = useState("");
  const [vcardOrg, setVcardOrg] = useState("");
  const [vcardTitle, setVcardTitle] = useState("");
  const [vcardUrl, setVcardUrl] = useState("");

  // Email Fields
  const [emailTo, setEmailTo] = useState("");
  const [emailSubject, setEmailSubject] = useState("");
  const [emailBody, setEmailBody] = useState("");

  // Micro-file direct embed Fields
  const [embeddedFile, setEmbeddedFile] = useState<{
    name: string;
    size: number;
    mime: string;
    dataUrl: string;
  } | null>(null);

  // QR Visual Customization
  const [ecc, setEcc] = useState<"L" | "M" | "Q" | "H">("M");
  const [size, setSize] = useState<number>(512);
  const [margin, setMargin] = useState<number>(2);
  const [darkColor, setDarkColor] = useState("#0f172a");
  const [lightColor, setLightColor] = useState("#ffffff");
  const [transparentBg, setTransparentBg] = useState(false);

  // Center Logo
  const [enableLogo, setEnableLogo] = useState(false);
  const [logoSrc, setLogoSrc] = useState<string>("");
  const [logoScale, setLogoScale] = useState<number>(0.22);
  const [logoShape, setLogoShape] = useState<"circle" | "rounded" | "square">("rounded");
  const [logoPadding, setLogoPadding] = useState<number>(6);

  // Verification & Copy status
  const [isScannable, setIsScannable] = useState<boolean | null>(null);
  const [copiedImg, setCopiedImg] = useState(false);
  const [copiedText, setCopiedText] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

  // When logo is enabled, force ECC to H (30%) so QR error correction can safely recover covered modules
  useEffect(() => {
    if (enableLogo && ecc !== "H") {
      setEcc("H");
      toast({
        title: tr("纠错等级已提升为高 (H)", "Error correction elevated to Level H"),
        description: tr("开启中心图标需 30% 纠错冗余，以确保扫码 100% 可读。", "Center logo requires 30% redundancy to guarantee scannability."),
        variant: "info",
      });
    }
  }, [enableLogo, ecc, toast]);

  // Compute final QR content string
  const qrContent = useMemo(() => {
    switch (activeType) {
      case "url":
        return urlInput.trim();
      case "text":
        return textInput;
      case "wifi": {
        const ssid = wifiSsid.replace(/([\\;,":])/g, "\\$1");
        const pass = wifiPassword.replace(/([\\;,":])/g, "\\$1");
        const hidden = wifiHidden ? "H:true;" : "";
        return `WIFI:S:${ssid};T:${wifiAuth};P:${pass};${hidden};`;
      }
      case "vcard": {
        const lines = [
          "BEGIN:VCARD",
          "VERSION:3.0",
          `FN:${vcardName}`,
          vcardPhone ? `TEL;TYPE=CELL:${vcardPhone}` : "",
          vcardEmail ? `EMAIL:${vcardEmail}` : "",
          vcardOrg ? `ORG:${vcardOrg}` : "",
          vcardTitle ? `TITLE:${vcardTitle}` : "",
          vcardUrl ? `URL:${vcardUrl}` : "",
          "END:VCARD",
        ].filter(Boolean);
        return lines.join("\n");
      }
      case "email": {
        const params = new URLSearchParams();
        if (emailSubject) params.set("subject", emailSubject);
        if (emailBody) params.set("body", emailBody);
        const qs = params.toString();
        return `mailto:${emailTo}${qs ? "?" + qs : ""}`;
      }
      case "file":
        return embeddedFile ? embeddedFile.dataUrl : "";
      case "media_info":
        return "";
      default:
        return "";
    }
  }, [
    activeType,
    urlInput,
    textInput,
    wifiSsid,
    wifiPassword,
    wifiAuth,
    wifiHidden,
    vcardName,
    vcardPhone,
    vcardEmail,
    vcardOrg,
    vcardTitle,
    vcardUrl,
    emailTo,
    emailSubject,
    emailBody,
    embeddedFile,
  ]);

  // Render QR code to canvas with optional center logo
  const renderQr = useCallback(async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    if (!qrContent) {
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      setIsScannable(null);
      return;
    }

    setIsGenerating(true);
    try {
      const renderSize = Math.max(256, size);
      canvas.width = renderSize;
      canvas.height = renderSize;

      const effectiveLight = transparentBg ? "#00000000" : lightColor;

      await QRCode.toCanvas(canvas, qrContent, {
        width: renderSize,
        margin: margin,
        color: {
          dark: darkColor,
          light: effectiveLight,
        },
        errorCorrectionLevel: enableLogo ? "H" : ecc,
      });

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Draw Center Logo if enabled
      if (enableLogo && logoSrc) {
        await new Promise<void>((resolve) => {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            const logoW = Math.round(renderSize * logoScale);
            const logoH = Math.round(renderSize * logoScale);
            const cx = (renderSize - logoW) / 2;
            const cy = (renderSize - logoH) / 2;
            const pad = logoPadding;

            ctx.save();

            // Draw clean background behind logo
            ctx.fillStyle = lightColor === "#00000000" ? "#ffffff" : lightColor;
            if (logoShape === "circle") {
              ctx.beginPath();
              ctx.arc(renderSize / 2, renderSize / 2, logoW / 2 + pad, 0, Math.PI * 2);
              ctx.fill();
            } else if (logoShape === "rounded") {
              const r = Math.round(logoW * 0.2) + pad;
              drawRoundedRect(
                ctx,
                cx - pad,
                cy - pad,
                logoW + pad * 2,
                logoH + pad * 2,
                r
              );
              ctx.fill();
            } else {
              ctx.fillRect(cx - pad, cy - pad, logoW + pad * 2, logoH + pad * 2);
            }

            // Clip and draw image
            if (logoShape === "circle") {
              ctx.beginPath();
              ctx.arc(renderSize / 2, renderSize / 2, logoW / 2, 0, Math.PI * 2);
              ctx.clip();
            } else if (logoShape === "rounded") {
              const r = Math.round(logoW * 0.2);
              drawRoundedRect(ctx, cx, cy, logoW, logoH, r);
              ctx.clip();
            }

            ctx.drawImage(img, cx, cy, logoW, logoH);
            ctx.restore();
            resolve();
          };
          img.onerror = () => resolve();
          img.src = logoSrc;
        });
      }

      // Verification via jsQR
      const imgData = ctx.getImageData(0, 0, renderSize, renderSize);
      const code = jsQR(imgData.data, renderSize, renderSize, {
        inversionAttempts: "attemptBoth",
      });
      setIsScannable(Boolean(code));
    } catch (e) {
      console.error("QR Generation error:", e);
      setIsScannable(false);
    } finally {
      setIsGenerating(false);
    }
  }, [
    qrContent,
    size,
    margin,
    darkColor,
    lightColor,
    transparentBg,
    enableLogo,
    logoSrc,
    logoScale,
    logoShape,
    logoPadding,
    ecc,
  ]);

  useEffect(() => {
    void renderQr();
  }, [renderQr]);

  // Handle Logo Upload
  const handleLogoFile = (f?: File) => {
    if (!f) return;
    if (!f.type.startsWith("image/")) {
      toast({ title: tr("请选择有效的图片文件", "Please select a valid image"), variant: "error" });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setLogoSrc(reader.result);
        setEnableLogo(true);
      }
    };
    reader.readAsDataURL(f);
  };

  // Handle Micro-file Embed
  const handleMicroFile = (f?: File) => {
    if (!f) return;
    if (f.size > 2800) {
      toast({
        title: tr("文件超过单张二维码物理容量上限", "File exceeds physical QR capacity limit"),
        description: tr(
          `所选文件 ${Math.round(f.size / 1024 * 10) / 10} KB，标准二维码最大仅能容纳约 2.88 KB。音视频等大文件请查看下方「音视频与大文件直传」方案。`,
          `Selected file is ${Math.round(f.size / 1024 * 10) / 10} KB. Max QR capacity is ~2.88 KB.`
        ),
        variant: "error",
      });
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setEmbeddedFile({
          name: f.name,
          size: f.size,
          mime: f.type || "application/octet-stream",
          dataUrl: reader.result,
        });
      }
    };
    reader.readAsDataURL(f);
  };

  // Export PNG
  const handleDownloadPng = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `qrcode_${size}x${size}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
    toast({ title: tr("二维码 PNG 图片已下载", "QR Code PNG downloaded"), variant: "success" });
  };

  // Export SVG
  const handleDownloadSvg = async () => {
    if (!qrContent) return;
    try {
      const svgString = await QRCode.toString(qrContent, {
        type: "svg",
        width: size,
        margin: margin,
        color: {
          dark: darkColor,
          light: transparentBg ? "#00000000" : lightColor,
        },
        errorCorrectionLevel: enableLogo ? "H" : ecc,
      });

      const blob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.download = "qrcode.svg";
      link.href = url;
      link.click();
      URL.revokeObjectURL(url);
      toast({ title: tr("矢量 SVG 文件已下载", "Vector SVG downloaded"), variant: "success" });
    } catch (e) {
      toast({ title: tr("导出 SVG 失败", "Failed to export SVG"), variant: "error" });
    }
  };

  // Copy Image to Clipboard
  const handleCopyImage = async () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      canvas.toBlob((blob) => {
        if (!blob) return;
        navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob }),
        ]).then(() => {
          setCopiedImg(true);
          setTimeout(() => setCopiedImg(false), 2000);
          toast({ title: tr("已将二维码图片复制到剪贴板", "Image copied to clipboard"), variant: "success" });
        });
      }, "image/png");
    } catch {
      toast({ title: tr("复制失败，浏览器可能限制剪贴板图像权限", "Copy failed due to permissions"), variant: "error" });
    }
  };

  // Copy QR Raw Content
  const handleCopyText = () => {
    if (!qrContent) return;
    navigator.clipboard.writeText(qrContent).then(() => {
      setCopiedText(true);
      setTimeout(() => setCopiedText(false), 2000);
      toast({ title: tr("已复制二维码原始文本", "Content copied"), variant: "success" });
    });
  };

  // Byte usage indicator for current content
  const contentByteLength = new TextEncoder().encode(qrContent).length;
  const maxByteLimit = 2953;
  const bytePercentage = Math.min(100, Math.round((contentByteLength / maxByteLimit) * 100));

  return (
    <div className="space-y-6">
      {/* 顶部标签页导航 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border/60 pb-3">
        <button
          onClick={() => setActiveType("url")}
          className={cn(
            "flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-all",
            activeType === "url"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
          )}
        >
          <LinkIcon className="h-4 w-4" />
          <span>{tr("网址链接", "URL Link")}</span>
        </button>

        <button
          onClick={() => setActiveType("text")}
          className={cn(
            "flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-all",
            activeType === "text"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
          )}
        >
          <FileText className="h-4 w-4" />
          <span>{tr("普通文本", "Plain Text")}</span>
        </button>

        <button
          onClick={() => setActiveType("wifi")}
          className={cn(
            "flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-all",
            activeType === "wifi"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
          )}
        >
          <Wifi className="h-4 w-4" />
          <span>{tr("WiFi 扫码连网", "WiFi Connection")}</span>
        </button>

        <button
          onClick={() => setActiveType("vcard")}
          className={cn(
            "flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-all",
            activeType === "vcard"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
          )}
        >
          <User className="h-4 w-4" />
          <span>{tr("电子名片 vCard", "Contact vCard")}</span>
        </button>

        <button
          onClick={() => setActiveType("email")}
          className={cn(
            "flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-all",
            activeType === "email"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
          )}
        >
          <Mail className="h-4 w-4" />
          <span>{tr("发送邮件", "Email")}</span>
        </button>

        <button
          onClick={() => setActiveType("file")}
          className={cn(
            "flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-all",
            activeType === "file"
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-secondary/70 hover:text-foreground"
          )}
        >
          <FileUp className="h-4 w-4" />
          <span>{tr("微型文件内嵌", "Micro File Embed")}</span>
        </button>

        <button
          onClick={() => setActiveType("media_info")}
          className={cn(
            "flex items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium transition-all",
            activeType === "media_info"
              ? "bg-amber-500 text-white shadow-sm"
              : "text-amber-600 dark:text-amber-400 hover:bg-amber-500/10"
          )}
        >
          <HelpCircle className="h-4 w-4" />
          <span>{tr("音视频/大文件能塞二维码吗？", "Can media fit in QR?")}</span>
        </button>
      </div>

      {/* 主工作区左右两列布局 */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* 左侧：输入配置与样式调节 */}
        <div className="lg:col-span-7 space-y-6">
          {/* 输入参数卡片 */}
          <div className="rounded-2xl border border-border/70 bg-card/60 backdrop-blur-sm p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-border/50 pb-3">
              <span className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2">
                <Sliders className="h-4 w-4 text-primary" />
                {tr("内容设置", "Content Settings")}
              </span>
              <span className="text-xs text-muted-foreground">
                {tr("字节占用：", "Bytes:")} {contentByteLength} / {maxByteLimit} B ({bytePercentage}%)
              </span>
            </div>

            {/* 容量进度条 */}
            <div className="w-full bg-secondary/50 rounded-full h-1.5 overflow-hidden">
              <div
                className={cn(
                  "h-full transition-all duration-300",
                  bytePercentage > 90
                    ? "bg-destructive"
                    : bytePercentage > 60
                    ? "bg-amber-500"
                    : "bg-primary"
                )}
                style={{ width: `${bytePercentage}%` }}
              />
            </div>

            {/* 网址输入 */}
            {activeType === "url" && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-foreground">
                  {tr("网页 URL 或跳转链接", "Website URL")}
                </label>
                <Input
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://example.com"
                />
                <div className="flex gap-2 text-xs text-muted-foreground">
                  <span>{tr("快捷填充：", "Quick:")}</span>
                  <button
                    onClick={() => setUrlInput("https://")}
                    className="hover:text-primary transition-colors underline"
                  >
                    https://
                  </button>
                  <button
                    onClick={() => setUrlInput("https://github.com")}
                    className="hover:text-primary transition-colors underline"
                  >
                    GitHub
                  </button>
                  <button
                    onClick={() => setUrlInput("https://bilibili.com")}
                    className="hover:text-primary transition-colors underline"
                  >
                    Bilibili
                  </button>
                </div>
              </div>
            )}

            {/* 普通文本输入 */}
            {activeType === "text" && (
              <div className="space-y-2">
                <label className="text-xs font-medium text-foreground">
                  {tr("任意文字、备忘录或代码段落", "Text or Code Snippet")}
                </label>
                <Textarea
                  rows={4}
                  value={textInput}
                  onChange={(e) => setTextInput(e.target.value)}
                  placeholder={tr("输入您想编入二维码的文字内容…", "Enter text to encode into QR code...")}
                />
              </div>
            )}

            {/* WiFi 配置输入 */}
            {activeType === "wifi" && (
              <div className="space-y-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">
                    {tr("WiFi 网络名称 (SSID)", "Network Name (SSID)")}
                  </label>
                  <Input
                    value={wifiSsid}
                    onChange={(e) => setWifiSsid(e.target.value)}
                    placeholder="My-Home-WiFi"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-foreground">
                    {tr("WiFi 密码", "Password")}
                  </label>
                  <div className="relative">
                    <Input
                      type={showWifiPass ? "text" : "password"}
                      value={wifiPassword}
                      onChange={(e) => setWifiPassword(e.target.value)}
                      placeholder="••••••••"
                      disabled={wifiAuth === "nopass"}
                    />
                    {wifiAuth !== "nopass" && (
                      <button
                        type="button"
                        onClick={() => setShowWifiPass(!showWifiPass)}
                        className="absolute right-3 top-3 text-muted-foreground hover:text-foreground"
                      >
                        {showWifiPass ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="text-xs font-medium text-foreground block mb-1">
                      {tr("加密安全类型", "Encryption Type")}
                    </label>
                    <Select
                      value={wifiAuth}
                      onChange={(e) => setWifiAuth(e.target.value as any)}
                      triggerClassName="h-10 rounded-xl text-xs px-3"
                    >
                      <option value="WPA">{tr("WPA / WPA2 / WPA3 (推荐)", "WPA / WPA2 / WPA3 (Recommended)")}</option>
                      <option value="WEP">{tr("WEP (老旧网络)", "WEP (Legacy)")}</option>
                      <option value="nopass">{tr("无密码 (开放网络)", "None (Open Network)")}</option>
                    </Select>
                  </div>

                  <div className="flex items-center pt-5">
                    <label className="flex items-center gap-2 text-xs font-medium text-foreground cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={wifiHidden}
                        onChange={(e) => setWifiHidden(e.target.checked)}
                        className="rounded border-input text-primary focus:ring-primary h-4 w-4"
                      />
                      <span>{tr("隐藏 SSID 网络", "Hidden Network")}</span>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* 电子名片输入 */}
            {activeType === "vcard" && (
              <div className="space-y-3">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground">{tr("姓名 *", "Name *")}</label>
                    <Input value={vcardName} onChange={(e) => setVcardName(e.target.value)} placeholder="张三" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground">{tr("手机号码", "Phone")}</label>
                    <Input value={vcardPhone} onChange={(e) => setVcardPhone(e.target.value)} placeholder="13800138000" />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground">{tr("电子邮箱", "Email")}</label>
                    <Input value={vcardEmail} onChange={(e) => setVcardEmail(e.target.value)} placeholder="name@company.com" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground">{tr("公司 / 组织", "Organization")}</label>
                    <Input value={vcardOrg} onChange={(e) => setVcardOrg(e.target.value)} placeholder="Furina Tech Studio" />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground">{tr("职位", "Title")}</label>
                    <Input value={vcardTitle} onChange={(e) => setVcardTitle(e.target.value)} placeholder="高级工程师" />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-foreground">{tr("个人 / 公司主页", "Website")}</label>
                    <Input value={vcardUrl} onChange={(e) => setVcardUrl(e.target.value)} placeholder="https://example.com" />
                  </div>
                </div>
              </div>
            )}

            {/* 发送邮件输入 */}
            {activeType === "email" && (
              <div className="space-y-3">
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">{tr("收件人邮箱", "Recipient Email")}</label>
                  <Input value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="support@furinakit.app" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">{tr("邮件主题", "Subject")}</label>
                  <Input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} placeholder="关于软件使用的反馈" />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-foreground">{tr("预设正文", "Body")}</label>
                  <Textarea rows={3} value={emailBody} onChange={(e) => setEmailBody(e.target.value)} placeholder="您好，我在使用中遇到…" />
                </div>
              </div>
            )}

            {/* 微型文件内嵌 */}
            {activeType === "file" && (
              <div className="space-y-3">
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-border/80 hover:border-primary/60 bg-secondary/20 hover:bg-secondary/40 rounded-xl p-6 text-center cursor-pointer transition-colors"
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    className="hidden"
                    onChange={(e) => handleMicroFile(e.target.files?.[0])}
                  />
                  <Upload className="h-8 w-8 text-primary mx-auto mb-2 opacity-80" />
                  <div className="text-sm font-medium text-foreground">
                    {embeddedFile ? embeddedFile.name : tr("点击或拖入微型文件内嵌进二维码", "Click or drop micro-file")}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {tr("支持极小尺寸 SVG、Icon 图标或微型配置文件（限 2.5 KB 内）", "Supports tiny SVG, icons, or micro-configs (< 2.5 KB)")}
                  </div>
                </div>

                {embeddedFile && (
                  <div className="flex items-center justify-between p-3 rounded-lg bg-secondary/40 border border-border text-xs">
                    <div className="flex items-center gap-2">
                      <FileText className="h-4 w-4 text-primary" />
                      <span className="font-medium text-foreground">{embeddedFile.name}</span>
                      <span className="text-muted-foreground">({embeddedFile.size} B)</span>
                    </div>
                    <button
                      onClick={() => setEmbeddedFile(null)}
                      className="text-destructive hover:underline"
                    >
                      {tr("清除", "Remove")}
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* 音视频大文件解答卡片 */}
            {activeType === "media_info" && (
              <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4 text-xs space-y-3">
                <div className="font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-2">
                  <Info className="h-4 w-4 shrink-0" />
                  <span>{tr("为什么不能把图片、视频、音频文件直接全部藏进二维码？", "Why cannot video/audio directly fit inside QR?")}</span>
                </div>
                <div className="text-muted-foreground leading-relaxed space-y-2">
                  <p>
                    {tr(
                      "二维码在国际通信标准（ISO/IEC 18004）中是一种单帧光学二维点阵。即便使用最高密度的 Version 40 矩阵，其整个黑白方块阵列在物理上最多只能容纳 2,953 字节（约 2.88 KB）数据。",
                      "QR Code is an optical 2D matrix. Even Version 40 can only physically hold up to 2,953 bytes (~2.88 KB)."
                    )}
                  </p>
                  <p>
                    {tr(
                      "而现代数字多媒体中：哪怕仅 1 秒钟的极低画质音频至少也在 10 KB ~ 20 KB 以上，视频文件动辄数兆到数百兆字节，高分辨率照片亦有数兆字节。若硬将数兆字节编入点阵，二维码需要拥有数百万个微米级数据块，任何手机摄像头和光学扫描器均无法对焦识别。",
                      "Even 1 second of audio is 10~20 KB, and videos are megabytes. No camera can optically focus on millions of tiny modules."
                    )}
                  </p>
                  <p className="font-medium text-foreground pt-1">
                    {tr("【行业现代工业标准最佳解法】：", "Industry standard solution:")}
                  </p>
                  <p>
                    {tr(
                      "通过局域网文件服务或直链共享：软件在本地启动高速传输通道，把文件在局域网内生成的下载直链制成二维码。手机只要与电脑处于同一 WiFi，扫码即可零流量超高速下载或即刻播放！",
                      "Share via LAN or direct link: The software hosts the file locally and encodes the LAN URL into the QR code."
                    )}
                  </p>
                </div>

                <div className="pt-2">
                  <Button
                    onClick={() => {
                      if (typeof window !== "undefined") {
                        window.location.href = "/tools/lan-transfer";
                      }
                    }}
                    className="w-full flex items-center justify-center gap-2 bg-amber-600 hover:bg-amber-500 text-white"
                  >
                    <Share2 className="h-4 w-4" />
                    <span>{tr("立即打开「局域网极速互传」一键扫码传音视频", "Open LAN Transfer for Media Sharing")}</span>
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
          </div>

          {/* 视觉与样式定制卡片 */}
          <div className="rounded-2xl border border-border/70 bg-card/60 backdrop-blur-sm p-5 shadow-sm space-y-4">
            <div className="flex items-center justify-between border-b border-border/50 pb-3">
              <span className="text-sm font-semibold tracking-tight text-foreground flex items-center gap-2">
                <Palette className="h-4 w-4 text-primary" />
                {tr("视觉与样式外观", "Visual & Styling")}
              </span>
            </div>

            {/* 中心 Logo / 头像叠加设置 */}
            <div className="p-3.5 rounded-xl border border-border/80 bg-secondary/30 space-y-3">
              <div className="flex items-center justify-between">
                <label className="flex items-center gap-2 text-xs font-semibold text-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={enableLogo}
                    onChange={(e) => setEnableLogo(e.target.checked)}
                    className="rounded border-input text-primary focus:ring-primary h-4 w-4"
                  />
                  <span>{tr("在二维码中心嵌入 Logo / 图标", "Embed Center Logo / Icon")}</span>
                </label>
                {enableLogo && (
                  <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                    {tr("✔ 已自动锁定 30% 高纠错 (H)", "Level H (30%) Active")}
                  </span>
                )}
              </div>

              {enableLogo && (
                <div className="space-y-3 pt-2 border-t border-border/50">
                  <div className="flex items-center gap-3">
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => handleLogoFile(e.target.files?.[0])}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => logoInputRef.current?.click()}
                      className="text-xs"
                    >
                      <Upload className="h-3.5 w-3.5 mr-1.5" />
                      {logoSrc ? tr("更换 Logo 图片", "Change Logo") : tr("上传 Logo 图片", "Upload Logo")}
                    </Button>

                    {logoSrc && (
                      <button
                        onClick={() => {
                          setLogoSrc("");
                          setEnableLogo(false);
                        }}
                        className="text-xs text-destructive hover:underline"
                      >
                        {tr("移除图标", "Remove")}
                      </button>
                    )}
                  </div>

                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <div>
                      <label className="text-[11px] font-medium text-muted-foreground block mb-1">
                        {tr("Logo 占幅比例", "Logo Size Ratio")} ({Math.round(logoScale * 100)}%)
                      </label>
                      <input
                        type="range"
                        min="0.15"
                        max="0.28"
                        step="0.01"
                        value={logoScale}
                        onChange={(e) => setLogoScale(parseFloat(e.target.value))}
                        className="w-full accent-primary"
                      />
                    </div>

                    <div>
                      <label className="text-[11px] font-medium text-muted-foreground block mb-1">
                        {tr("图标形状裁剪", "Logo Shape")}
                      </label>
                      <Select
                        value={logoShape}
                        onChange={(e) => setLogoShape(e.target.value as any)}
                        triggerClassName="h-8 rounded-xl text-xs px-2.5"
                      >
                        <option value="rounded">{tr("微圆角 (平滑现代)", "Rounded")}</option>
                        <option value="circle">{tr("圆形 (头像风格)", "Circle")}</option>
                        <option value="square">{tr("直角方形", "Square")}</option>
                      </Select>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* 颜色主题与色板 */}
            <div className="space-y-3">
              <label className="text-xs font-medium text-foreground block">
                {tr("配色预设方案", "Color Presets")}
              </label>
              <div className="flex flex-wrap gap-2">
                {COLOR_PRESETS.map((p, idx) => (
                  <button
                    key={idx}
                    onClick={() => {
                      setDarkColor(p.dark);
                      setLightColor(p.light);
                      setTransparentBg(false);
                    }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-border/80 text-xs hover:border-primary/60 transition-colors"
                  >
                    <span
                      className="w-3.5 h-3.5 rounded-full border border-black/10 inline-block shadow-xs"
                      style={{ backgroundColor: p.dark }}
                    />
                    <span className="text-muted-foreground">{tr(p.nameZh, p.nameEn)}</span>
                  </button>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-3 pt-2">
                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">{tr("码点前景色", "Dark Color")}</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={darkColor}
                      onChange={(e) => setDarkColor(e.target.value)}
                      className="w-8 h-8 rounded-lg cursor-pointer border border-border bg-transparent p-0"
                    />
                    <Input
                      value={darkColor}
                      onChange={(e) => setDarkColor(e.target.value)}
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-xs text-muted-foreground">{tr("背景填充色", "Light Color")}</label>
                  <div className="flex items-center gap-2">
                    <input
                      type="color"
                      value={lightColor}
                      onChange={(e) => {
                        setLightColor(e.target.value);
                        setTransparentBg(false);
                      }}
                      disabled={transparentBg}
                      className="w-8 h-8 rounded-lg cursor-pointer border border-border bg-transparent p-0 disabled:opacity-50"
                    />
                    <Input
                      value={transparentBg ? tr("透明", "Transparent") : lightColor}
                      onChange={(e) => setLightColor(e.target.value)}
                      disabled={transparentBg}
                      className="h-8 text-xs font-mono disabled:opacity-50"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4 pt-1">
                <label className="flex items-center gap-2 text-xs text-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={transparentBg}
                    onChange={(e) => setTransparentBg(e.target.checked)}
                    className="rounded border-input text-primary focus:ring-primary h-3.5 w-3.5"
                  />
                  <span>{tr("透明背景 (适合设计排版导出)", "Transparent Background")}</span>
                </label>
              </div>
            </div>

            {/* 尺寸与纠错等级 */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2 border-t border-border/50">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{tr("导出分辨率", "Resolution")}</label>
                <Select
                  value={size}
                  onChange={(e) => setSize(parseInt(e.target.value))}
                  triggerClassName="h-9 rounded-xl text-xs px-2.5"
                >
                  <option value={256}>{tr("256 × 256 (轻便小图)", "256 × 256 (Compact)")}</option>
                  <option value={512}>{tr("512 × 512 (标准推荐)", "512 × 512 (Standard)")}</option>
                  <option value={1024}>{tr("1024 × 1024 (高清大图)", "1024 × 1024 (High-Res)")}</option>
                  <option value={2048}>{tr("2048 × 2048 (印刷级超清)", "2048 × 2048 (Print Quality)")}</option>
                </Select>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{tr("外边距 (留白)", "Margin")}</label>
                <Select
                  value={margin}
                  onChange={(e) => setMargin(parseInt(e.target.value))}
                  triggerClassName="h-9 rounded-xl text-xs px-2.5"
                >
                  <option value={0}>{tr("0 (无边框紧凑)", "0 (Borderless)")}</option>
                  <option value={1}>{tr("1 (紧凑留白)", "1 (Compact)")}</option>
                  <option value={2}>{tr("2 (标准适中)", "2 (Standard)")}</option>
                  <option value={4}>{tr("4 (宽边舒适)", "4 (Comfortable)")}</option>
                </Select>
              </div>

              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">{tr("纠错能力 (ECC)", "Error Correction")}</label>
                <Select
                  value={ecc}
                  onChange={(e) => setEcc(e.target.value as any)}
                  disabled={enableLogo}
                  triggerClassName="h-9 rounded-xl text-xs px-2.5"
                >
                  <option value="L">{tr("L - 7% (最低密度)", "L - 7% (Lowest Density)")}</option>
                  <option value="M">{tr("M - 15% (标准常用)", "M - 15% (Standard)")}</option>
                  <option value="Q">{tr("Q - 25% (较高冗余)", "Q - 25% (High Redundancy)")}</option>
                  <option value="H">{tr("H - 30% (最高容错/嵌入必选)", "H - 30% (Max Error / With Logo)")}</option>
                </Select>
              </div>
            </div>
          </div>
        </div>

        {/* 右侧：实时画布渲染、校验状态与下载操作 */}
        <div className="lg:col-span-5 space-y-4">
          <div className="rounded-2xl border border-border/70 bg-card/60 backdrop-blur-sm p-6 shadow-sm flex flex-col items-center justify-center text-center space-y-4">
            <div className="text-xs font-semibold text-muted-foreground tracking-wider uppercase flex items-center gap-1.5">
              <QrCode className="h-4 w-4 text-primary" />
              <span>{tr("实时渲染与手机扫码预览", "Live Scan Preview")}</span>
            </div>

            {/* 二维码画布展示区域 */}
            <div className="relative group p-4 rounded-2xl bg-white/95 dark:bg-slate-900 border border-border/80 shadow-md transition-all duration-300">
              <canvas
                ref={canvasRef}
                className="max-w-full h-auto max-h-[300px] object-contain rounded-lg shadow-xs"
              />

              {/* 实时解码自检状态角标 */}
              {qrContent && (
                <div className="absolute top-2 right-2">
                  {isScannable ? (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 backdrop-blur-xs">
                      <CheckCircle2 className="h-3 w-3" />
                      {tr("可秒读", "Scannable")}
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 backdrop-blur-xs">
                      <AlertCircle className="h-3 w-3" />
                      {tr("待调整", "Dense")}
                    </span>
                  )}
                </div>
              )}
            </div>

            {/* 校验提示语 */}
            <div className="text-xs text-muted-foreground min-h-[20px]">
              {isScannable ? (
                <span className="text-emerald-600 dark:text-emerald-400 flex items-center justify-center gap-1">
                  <Check className="h-3.5 w-3.5" />
                  {tr("内核已自动执行扫码算法校验：手机镜头可秒开识别！", "Algorithm verified: instant camera scan ready!")}
                </span>
              ) : qrContent ? (
                <span className="text-amber-600 dark:text-amber-400 flex items-center justify-center gap-1">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {tr("点阵密度较高，建议调小 Logo 比例或切换至纠错 H", "High density, recommend adjusting logo or using ECC H")}
                </span>
              ) : (
                <span>{tr("请输入内容生成二维码", "Enter content to generate")}</span>
              )}
            </div>

            {/* 快捷操作按钮组 */}
            <div className="w-full space-y-2.5 pt-2">
              <Button
                onClick={handleDownloadPng}
                disabled={!qrContent}
                className="w-full flex items-center justify-center gap-2 h-11"
              >
                <Download className="h-4 w-4" />
                <span>{tr("下载高清 PNG 图片", "Download HD PNG")} ({size}×{size})</span>
              </Button>

              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="outline"
                  onClick={handleDownloadSvg}
                  disabled={!qrContent}
                  className="flex items-center justify-center gap-1.5 text-xs h-9"
                >
                  <Layers className="h-3.5 w-3.5" />
                  <span>{tr("导出 SVG 矢量图", "Export SVG")}</span>
                </Button>

                <Button
                  variant="outline"
                  onClick={handleCopyImage}
                  disabled={!qrContent}
                  className="flex items-center justify-center gap-1.5 text-xs h-9"
                >
                  {copiedImg ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copiedImg ? tr("已复制图片", "Copied") : tr("复制图片到剪贴板", "Copy Image")}</span>
                </Button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleCopyText}
                  disabled={!qrContent}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {copiedText ? <Check className="h-3.5 w-3.5 text-emerald-500 mr-1" /> : <Share2 className="h-3.5 w-3.5 mr-1" />}
                  <span>{copiedText ? tr("已复制", "Copied") : tr("复制原始文本", "Copy Content")}</span>
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    if (typeof window !== "undefined") {
                      window.location.href = "/tools/qr-decoder";
                    }
                  }}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  <ExternalLink className="h-3.5 w-3.5 mr-1" />
                  <span>{tr("前往反查解码器", "Go to Decoder")}</span>
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}
