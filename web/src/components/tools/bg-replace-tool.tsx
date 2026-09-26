"use client";
import { createUiText as __createUiText, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/bg-replace-tool.tsx");


/**
 * 图片换背景（自绘界面）
 *
 * 为什么要自绘而不是用通用表单：这个工具有三套互斥的参数，通用表单会把它们全摆出来，
 * 于是出现"选了虚化却还看到背景图上传框"这种让人困惑的情况。这里按选择只显示该显示的。
 *
 * 背景方式三种：纯色（给色块预览，选中的会打勾）、虚化原背景（只显示虚化强度）、
 * 上传背景图（只有这一种才显示上传框）。
 */

import { useState } from "react";
import { Check, Download, ImagePlus, Loader2, Sparkles, Upload, Wand2 } from "lucide-react";
import { Button, Select } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useTheme } from "@/components/theme-provider";
import { EmptyDropzone } from "@/components/tools/dropzone-empty";
import { cn } from "@/lib/utils";

type Mode = "color" | "blur" | "image";

const COLORS: { value: string; label: string; css: string }[] = [
  { value: "white", label: "白色", css: "#ffffff" },
  { value: "blue", label: "证件照蓝", css: "#438edb" },
  { value: "red", label: "证件照红", css: "#ed1c24" },
  { value: "black", label: "黑色", css: "#111111" },
  { value: "green", label: "绿色（绿幕）", css: "#50af4c" },
  { value: "gray", label: "浅灰", css: "#c8c8c8" },
];

const MODES: { value: Mode; label: string; hint: string }[] = [
  { value: "color", label: "纯色背景", hint: "证件照、商品图常用" },
  { value: "blur", label: "虚化原背景", hint: "保留原场景，做出景深效果" },
  { value: "image", label: "使用我上传的背景图", hint: "换成自己的风景或素材" },
];

export function BgReplaceTool() {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  const { toast } = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [bgFile, setBgFile] = useState<File | null>(null);
  const [mode, setMode] = useState<Mode>("color");
  const [color, setColor] = useState("white");
  const [blur, setBlur] = useState("20");
  const [feather, setFeather] = useState("0");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [result, setResult] = useState<{ url: string; name: string } | null>(null);

  const run = async () => {
    if (!file) {
      toast({ title: "先选一张要处理的图片", variant: "info" });
      return;
    }
    if (mode === "image" && !bgFile) {
      toast({ title: "选了「使用我上传的背景图」，请上传一张背景图", variant: "info" });
      return;
    }
    setBusy(true);
    setProgress("正在处理…");
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("mode", mode);
      fd.append("color", color);
      fd.append("blur", blur);
      fd.append("feather", feather);
      // 只有在上传背景图这一种方式下才带上背景图，避免"选了虚化却还传了一张图"
      if (mode === "image" && bgFile) fd.append("bg_image", bgFile);

      const res = await fetch("/api/tools/bg-replace", { method: "POST", body: fd });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "创建任务失败");
      const jobId = data.job?.id;
      for (let i = 0; i < 180; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const j = await (await fetch(`/api/jobs/${jobId}`, { cache: "no-store" })).json();
        const st = j.job?.status;
        if (st === "completed") {
          setProgress("");
          setResult({ url: `/api/jobs/${jobId}/download`, name: j.job.resultFilename });
          toast({ title: "处理完成", description: j.job.message, variant: "success" });
          return;
        }
        if (st === "failed") throw new Error(j.job?.error || "处理失败");
        setProgress(`正在处理… ${j.job?.progress ?? 0}%`);
      }
      throw new Error("处理超时");
    } catch (err) {
      toast({ title: "处理失败", description: err instanceof Error ? err.message : "", variant: "error" });
      setProgress("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="grid items-start gap-4 xl:grid-cols-[1fr_320px]">
        {/* 左：图片 */}
        <section className="min-w-0 rounded-2xl border p-4" style={{ borderColor: colors.borderSolid, background: colors.card }}>
          {!file ? (
            <EmptyDropzone
              title={__ui("点击选择图片，或将文件拖拽到此处")}
              subtitle={__ui("人像、宠物、商品图都可以；背景越简单效果越好")}
              hint={__ui("单个文件 · PNG / JPG / WEBP")}
              accept="image/*"
              onFiles={(f) => setFile(f[0] ?? null)}
            />
          ) : (
            <>
              <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <span className="truncate text-[12.5px] font-medium" style={{ color: colors.text }}>{file.name}</span>
                <Button size="sm" variant="ghost" className="gap-1.5" onClick={() => { setFile(null); setResult(null); }}>
                  <Upload size={12} /> {__ui("换一张")}</Button>
              </header>
              <div
                className="flex max-h-[62vh] items-center justify-center overflow-hidden rounded-xl p-3"
                style={{
                  background: colors.bg,
                  backgroundImage:
                    "linear-gradient(45deg, rgba(127,127,127,0.10) 25%, transparent 25%), linear-gradient(-45deg, rgba(127,127,127,0.10) 25%, transparent 25%)",
                  backgroundSize: "18px 18px",
                }}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={result ? result.url : URL.createObjectURL(file)} alt={__ui("预览")} className="max-h-[56vh] max-w-full rounded-lg object-contain" />
              </div>
              {result && (
                <div className="mt-3 flex flex-wrap items-center gap-2.5">
                  <a
                    href={result.url}
                    download={result.name}
                    className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-[12.5px] font-medium"
                    style={{ borderColor: colors.borderSolid, color: colors.text }}
                  >
                    <Download size={13} /> {__ui("保存结果")}</a>
                  <span className="text-[11.5px]" style={{ color: colors.green }}>{result.name}</span>
                </div>
              )}
            </>
          )}

          {/* 边缘羽化：放在左栏与工作区一起，让左右两栏的高度更接近，不会一边长一边短 */}
          <div className="mt-3 rounded-xl border p-4" style={{ borderColor: colors.borderSolid, background: colors.bg }}>
            <h3 className="mb-2.5 text-[12.5px] font-semibold" style={{ color: colors.text }}>{__ui("边缘处理")}</h3>
            <label className="flex flex-col gap-1.5">
              <span className="text-[12.5px]" style={{ color: colors.muted }}>{__ui("边缘羽化")}</span>
              <Select value={feather} onChange={(e) => setFeather(e.target.value)}>
                <option value="0">{__ui("不羽化（保留发丝细节，推荐）")}</option>
                <option value="1">{__ui("轻微羽化 1px")}</option>
                <option value="2">{__ui("羽化 2px（边缘更柔和）")}</option>
              </Select>
            </label>
          </div>

          {/* 未选文件时，左栏下方空着不好看，这里放真正有用的内容：怎么用 + 常见用途的推荐设置 */}
          {!file && (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border p-4" style={{ borderColor: colors.borderSolid, background: colors.bg }}>
                <h3 className="mb-2.5 text-[12.5px] font-semibold" style={{ color: colors.text }}>{__ui("怎么用")}</h3>
                <ol className="flex flex-col gap-2 text-[11.5px] leading-relaxed" style={{ color: colors.muted }}>
                  <li><b style={{ color: colors.text }}>{__ui("1. 选图片")}</b>　{__ui("人像、宠物、商品图都可以，背景越简单越干净")}</li>
                  <li><b style={{ color: colors.text }}>{__ui("2. 选背景方式")}</b>　{__ui("纯色 / 虚化原背景 / 用自己的背景图，三种任选")}</li>
                  <li><b style={{ color: colors.text }}>{__ui("3. 开始换背景")}</b>　{__ui("完成后右侧参数可继续调整再处理一次")}</li>
                </ol>
              </div>
              <div className="rounded-xl border p-4" style={{ borderColor: colors.borderSolid, background: colors.bg }}>
                <h3 className="mb-2.5 text-[12.5px] font-semibold" style={{ color: colors.text }}>{__ui("常见用途的推荐设置")}</h3>
                <ul className="flex flex-col gap-2 text-[11.5px] leading-relaxed" style={{ color: colors.muted }}>
                  <li><b style={{ color: colors.text }}>{__ui("证件照")}</b>　{__ui("纯色 + 证件照蓝或红，边缘羽化选「不羽化」")}</li>
                  <li><b style={{ color: colors.text }}>{__ui("商品白底图")}</b>　{__ui("纯色 + 白色，越干净越好上架")}</li>
                  <li><b style={{ color: colors.text }}>{__ui("绿幕素材")}</b>　{__ui("纯色 + 绿色，方便后期再合成")}</li>
                  <li><b style={{ color: colors.text }}>{__ui("人像景深")}</b>　{__ui("虚化原背景，强度 20 左右最自然")}</li>
                  <li><b style={{ color: colors.text }}>{__ui("换风景")}</b>　{__ui("用自己上传的背景图，会自动等比铺满不拉变形")}</li>
                </ul>
              </div>
            </div>
          )}
        </section>

        {/* 右：操作 */}
        <div className="flex min-w-0 flex-col gap-3.5">
          <section className="rounded-2xl border p-4" style={{ borderColor: colors.borderSolid, background: colors.card }}>
            <h3 className="mb-2.5 text-[12.5px] font-semibold" style={{ color: colors.muted }}>{__ui("背景方式")}</h3>
            <div className="flex flex-col gap-1.5">
              {MODES.map((m) => {
                const on = m.value === mode;
                return (
                  <button
                    key={m.value}
                    onClick={() => { setMode(m.value); setResult(null); }}
                    className="flex items-start gap-2.5 rounded-lg border px-3 py-2 text-left transition-all"
                    style={{
                      borderColor: on ? "hsl(var(--primary))" : colors.borderSolid,
                      background: on ? "hsl(var(--primary) / 0.06)" : "transparent",
                    }}
                  >
                    <span
                      className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border"
                      style={{ borderColor: on ? "hsl(var(--primary))" : colors.borderSolid, background: on ? "hsl(var(--primary))" : "transparent" }}
                    >
                      {on && <Check size={10} className="text-primary-foreground" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[12.5px]" style={{ color: colors.text }}>{__ui(m.label)}</span>
                      <span className="block text-[11px]" style={{ color: colors.muted }}>{__ui(m.hint)}</span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 颜色：色块预览，选中的打勾 */}
          {mode === "color" && (
            <section className="rounded-2xl border p-4" style={{ borderColor: colors.borderSolid, background: colors.card }}>
              <h3 className="mb-2.5 flex items-center gap-1.5 text-[12.5px] font-semibold" style={{ color: colors.muted }}>
                <ImagePlus size={13} /> {__ui("背景颜色")}</h3>
              <div className="grid grid-cols-3 gap-2">
                {COLORS.map((c) => {
                  const on = c.value === color;
                  return (
                    <button
                      key={c.value}
                      onClick={() => { setColor(c.value); setResult(null); }}
                      title={__ui(c.label)}
                      className="flex flex-col items-center gap-1.5 rounded-lg border p-2 transition-all"
                      style={{ borderColor: on ? "hsl(var(--primary))" : colors.borderSolid, background: on ? "hsl(var(--primary) / 0.06)" : "transparent" }}
                    >
                      <span
                        className="relative flex h-8 w-full items-center justify-center rounded-md border"
                        style={{ background: c.css, borderColor: "rgba(0,0,0,0.12)" }}
                      >
                        {on && (
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-black/45">
                            <Check size={12} className="text-white" />
                          </span>
                        )}
                      </span>
                      <span className="text-[11px]" style={{ color: on ? colors.text : colors.muted }}>{__ui(c.label)}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {mode === "blur" && (
            <section className="rounded-2xl border p-4" style={{ borderColor: colors.borderSolid, background: colors.card }}>
              <label className="flex flex-col gap-1.5">
                <span className="flex items-center justify-between text-[12.5px]" style={{ color: colors.muted }}>
                  <span>{__ui("虚化强度")}</span>
                  <span className="font-mono" style={{ color: colors.text }}>{blur}</span>
                </span>
                <input type="range" min={6} max={60} step={2} value={Number(blur)} onChange={(e) => setBlur(e.target.value)} />
                <span className="text-[11px]" style={{ color: colors.muted }}>{__ui("数值越大背景越糊，主体越突出")}</span>
              </label>
            </section>
          )}

          {/* 只有选「上传背景图」才显示上传框 */}
          {mode === "image" && (
            <section className="rounded-2xl border p-4" style={{ borderColor: colors.borderSolid, background: colors.card }}>
              <h3 className="mb-2.5 text-[12.5px] font-semibold" style={{ color: colors.muted }}>{__ui("背景图")}</h3>
              <label
                className={cn("flex cursor-pointer items-center justify-center gap-2 rounded-lg border-2 border-dashed px-3 py-4 text-[12px]")}
                style={{ borderColor: bgFile ? colors.green : "hsl(var(--primary) / 0.4)", color: colors.muted }}
              >
                <input type="file" accept="image/*" className="hidden" onChange={(e) => { setBgFile(e.target.files?.[0] ?? null); setResult(null); }} />
                <Upload size={14} />
                {bgFile ? bgFile.name : __ui("点击选择背景图")}
              </label>
              <p className="mt-2 text-[11px]" style={{ color: colors.muted }}>{__ui("会按原图尺寸等比铺满并居中裁切，不会把图片拉变形")}</p>
            </section>
          )}

          <section className="rounded-2xl border p-4" style={{ borderColor: colors.borderSolid, background: colors.card }}>

            <Button className="mt-3.5 w-full gap-2" onClick={() => void run()} disabled={busy || !file}>
              {busy ? <Loader2 size={14} className="animate-spin" /> : <Wand2 size={14} />}
              {busy ? progress || __ui("正在处理…") : __ui("开始换背景")}
            </Button>
            <p className="mt-2.5 flex items-start gap-1.5 text-[11px] leading-relaxed" style={{ color: colors.muted }}>
              <Sparkles size={11} className="mt-0.5 shrink-0" />
              <span>{__ui("用的是精细抠图模型，发丝与半透明边缘都处理得比较干净；模型没下载时上方可直接下载。")}</span>
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
