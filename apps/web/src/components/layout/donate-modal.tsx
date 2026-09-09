"use client";

import { X, Heart } from "lucide-react";
import { useEffect } from "react";

interface DonateModalProps {
  open: boolean;
  onClose: () => void;
}

export default function DonateModal({ open, onClose }: DonateModalProps) {
  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/65 backdrop-blur-sm p-4 animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        className="relative w-[600px] max-w-[94vw] rounded-3xl border border-white/10 p-6 sm:p-8 shadow-2xl transition-all"
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "linear-gradient(145deg, #1e293b 0%, #0f172a 100%)",
        }}
      >
        {/* 关闭按钮 */}
        <button
          onClick={onClose}
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
          aria-label="关闭"
        >
          <X size={18} />
        </button>

        {/* 标题 */}
        <div className="mb-6 text-center">
          <div className="inline-flex items-center justify-center gap-2 mb-2">
            <span className="text-2xl">🎂</span>
            <h2 className="text-2xl font-bold text-white tracking-wide">
              投喂芙芙小蛋糕
            </h2>
            <span className="text-2xl">🎂</span>
          </div>
          <p className="text-sm leading-relaxed text-slate-300">
            多投喂芙芙点小蛋糕，就有力气做出更棒功能啦！
            <br />
            <span className="text-xs text-slate-400">芙芙承诺所有功能永久免费使用哦~</span>
          </p>
        </div>

        {/* 双收款码展示区 (左边支付宝，右边微信) */}
        <div className="mb-6 grid grid-cols-2 gap-4 sm:gap-6">
          {/* 左侧：支付宝 */}
          <div className="flex flex-col items-center rounded-2xl border border-blue-500/20 bg-blue-500/[0.04] p-4 transition-all duration-200 hover:border-blue-500/40 hover:bg-blue-500/[0.07]">
            <div className="flex h-[180px] w-[180px] sm:h-[200px] sm:w-[200px] items-center justify-center rounded-2xl bg-white p-2.5 shadow-lg shadow-black/20">
              <img
                src="/donate-alipay.jpg"
                alt="支付宝赞赏码"
                className="h-full w-full object-contain rounded-xl"
              />
            </div>
            <div className="mt-3.5 flex items-center gap-1.5 rounded-full bg-[#1677ff]/15 px-3.5 py-1 text-xs font-semibold text-[#4096ff] border border-[#1677ff]/30">
              <span>支付宝</span>
            </div>
          </div>

          {/* 右侧：微信支付 */}
          <div className="flex flex-col items-center rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04] p-4 transition-all duration-200 hover:border-emerald-500/40 hover:bg-emerald-500/[0.07]">
            <div className="flex h-[180px] w-[180px] sm:h-[200px] sm:w-[200px] items-center justify-center rounded-2xl bg-white p-2.5 shadow-lg shadow-black/20">
              <img
                src="/donate-wechat.png"
                alt="微信赞赏码"
                className="h-full w-full object-contain rounded-xl"
              />
            </div>
            <div className="mt-3.5 flex items-center gap-1.5 rounded-full bg-[#07c160]/15 px-3.5 py-1 text-xs font-semibold text-[#10b981] border border-[#07c160]/30">
              <span>微信</span>
            </div>
          </div>
        </div>

        {/* 底部感谢与标语 */}
        <div className="border-t border-white/10 pt-4 text-center">
          <p className="flex items-center justify-center gap-1.5 text-xs text-slate-400">
            <span>感谢每一位投喂的小伙伴，大家的喜爱与支持是芙芙最大的动力</span>
            <Heart size={13} className="text-blue-400 fill-blue-400 inline" />
          </p>
        </div>
      </div>
    </div>
  );
}
