"use client";

import React, { useState } from "react";
import {
  MessageSquareHeart,
  Sparkles,
  Send,
  X,
  CheckCircle2,
  Lightbulb,
  Wrench,
  Bug,
  Heart,
  Loader2,
} from "lucide-react";
import { APP_VERSION } from "@/lib/version";
import { getSystemEnvironmentInfo } from "@/lib/analytics";

interface FeedbackModalProps {
  open: boolean;
  onClose: () => void;
}

const CATEGORIES = [
  { id: "新工具心愿", label: "新工具心愿", icon: Lightbulb, color: "text-amber-500" },
  { id: "现有功能优化", label: "现有功能优化", icon: Wrench, color: "text-sky-500" },
  { id: "遇到Bug报错", label: "遇到Bug/报错", icon: Bug, color: "text-rose-500" },
  { id: "对芙芙说的话", label: "对芙芙说的话", icon: Heart, color: "text-pink-500" },
];

export function FeedbackModal({ open, onClose }: FeedbackModalProps) {
  const [category, setCategory] = useState("新工具心愿");
  const [content, setContent] = useState("");
  const [contact, setContact] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  if (!open) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = content.trim();
    if (!trimmed) {
      setErrorMsg("请写下你的宝贵建议或想对芙芙说的话哦~");
      return;
    }

    setSubmitting(true);
    setErrorMsg(null);

    try {
      const sys = getSystemEnvironmentInfo();
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: trimmed,
          category,
          contact: contact.trim(),
          version: APP_VERSION,
          os: `${sys.os} (${sys.screenResolution})`,
        }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "发送失败，请稍后重试");
      }

      setSubmitted(true);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "提交失败，请检查网络后重试";
      setErrorMsg(message);
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setContent("");
    setContact("");
    setSubmitted(false);
    setErrorMsg(null);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,0.6)", backdropFilter: "blur(6px)" }}
      onClick={onClose}
    >
      <div
        className="relative w-[560px] max-w-[94vw] rounded-2xl border border-primary/30 bg-background/95 p-6 shadow-2xl backdrop-blur-md dark:border-primary/40"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X size={18} />
        </button>

        {submitted ? (
          /* 提交成功回执卡片 */
          <div className="py-8 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/10 text-emerald-500">
              <CheckCircle2 size={36} />
            </div>
            <h3 className="mt-4 text-[18px] font-bold text-foreground">
              芙芙已经收到你的宝贵建议啦！✨
            </h3>
            <p className="mx-auto mt-2 max-w-md text-[13px] leading-relaxed text-muted-foreground">
              “哼哼~ 每一个建议芙芙都会亲自认真阅读并记录进开发日程哦！感谢你让芙宁娜工具箱变得更加出色与全能~”
            </p>
            <div className="mt-6 flex justify-center gap-3">
              <button
                onClick={handleReset}
                className="h-9 rounded-xl bg-primary px-6 text-[13px] font-semibold text-primary-foreground shadow-sm hover:opacity-90 transition-opacity"
              >
                好的，芙芙
              </button>
            </div>
          </div>
        ) : (
          /* 建议填写表单 */
          <form onSubmit={handleSubmit} className="space-y-4">
            {/* 头部标题与芙芙心愿文案 */}
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <MessageSquareHeart size={22} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-[17px] font-bold text-foreground">
                    提建议与工具心愿
                  </h2>
                  <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                    <Sparkles size={11} />
                    直达作者后台
                  </span>
                </div>
                {/* 核心文案：严格遵守用户指定文案 */}
                <p className="mt-1 text-[13px] font-medium leading-relaxed text-primary/90 dark:text-primary/80">
                  有什么建议想对芙芙说的吗，或者你还希望添加什么工具，尽管告诉芙芙吧！
                </p>
              </div>
            </div>

            {/* 分类标签选择 */}
            <div className="space-y-1.5">
              <label className="text-[12px] font-medium text-muted-foreground">
                建议类型
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {CATEGORIES.map((cat) => {
                  const Icon = cat.icon;
                  const isSelected = category === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setCategory(cat.id)}
                      className={`flex items-center justify-center gap-1.5 rounded-xl border px-2.5 py-2 text-[12px] font-medium transition-all ${
                        isSelected
                          ? "border-primary bg-primary/10 text-primary font-semibold shadow-xs"
                          : "border-border/60 bg-muted/40 text-muted-foreground hover:border-border hover:text-foreground"
                      }`}
                    >
                      <Icon size={14} className={isSelected ? "text-primary" : cat.color} />
                      <span>{cat.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 内容输入框 */}
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-[12px] font-medium text-muted-foreground">
                  详细描述
                </label>
                <span className="text-[11px] text-muted-foreground font-mono">
                  {content.length}/500
                </span>
              </div>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                maxLength={500}
                rows={4}
                placeholder="例如：希望加入批量图片压缩格式转换、或者视频剪辑片段提取，或某个工具的使用体验建议..."
                className="w-full resize-none rounded-xl border border-border/70 bg-muted/30 p-3 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* 选填联系方式 */}
            <div className="space-y-1.5">
              <label className="text-[12px] font-medium text-muted-foreground">
                联系方式 (选填)
              </label>
              <input
                type="text"
                value={contact}
                onChange={(e) => setContact(e.target.value)}
                placeholder="邮箱 / QQ / 微信 / GitHub，方便芙芙在实现后向你汇报~"
                className="w-full rounded-xl border border-border/70 bg-muted/30 px-3 py-2 text-[13px] text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* 错误提示 */}
            {errorMsg && (
              <div className="rounded-xl bg-destructive/10 border border-destructive/20 p-2.5 text-[12px] text-destructive">
                {errorMsg}
              </div>
            )}

            {/* 底部按钮栏 */}
            <div className="flex items-center justify-between pt-2 border-t border-border/60">
              <span className="text-[11px] text-muted-foreground font-mono">
                v{APP_VERSION}
              </span>
              <div className="flex items-center gap-2">

                <button
                  type="button"
                  onClick={onClose}
                  className="h-9 rounded-xl border border-border/70 px-4 text-[13px] font-medium text-muted-foreground hover:bg-muted transition-colors"
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={submitting || !content.trim()}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-primary px-5 text-[13px] font-semibold text-primary-foreground shadow-sm transition-all hover:opacity-90 disabled:opacity-50"
                >
                  {submitting ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>正在送达...</span>
                    </>
                  ) : (
                    <>
                      <Send size={14} />
                      <span>发送给芙芙</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
