"use client";

import { useState } from "react";
import {
  FolderOpen,
  Zap,
  BookOpen,
  Lock,
  Unlock,
  CheckCircle2,
  HelpCircle,
  Cpu,
} from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { useTheme } from "@/components/theme-provider";

export function ArchprTool() {
  const { colors } = useTheme();
  const { toast } = useToast();
  const [launching, setLaunching] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);

  const handleLaunch = async () => {
    setLaunching(true);
    setStatusMsg("正在调起 ARCHPR 恢复程序...");
    try {
      if (typeof window !== "undefined" && window.furinakit?.launchArchpr) {
        const res = await window.furinakit.launchArchpr();
        if (res.success) {
          toast({
            title: "已成功启动 ARCHPR",
            description: "程序已在桌面运行，请在弹出的窗口中载入需要破解的压缩包。",
            variant: "success",
          });
          setStatusMsg("程序已在独立窗口运行中");
        } else {
          toast({
            title: "启动失败",
            description: res.error || "未找到 ARCHPR.exe，请确认文件路径完整。",
            variant: "error",
          });
          setStatusMsg("未能检测到可执行程序");
        }
      } else {
        toast({
          title: "环境限制",
          description: "当前非 Electron 桌面客户端环境，请在 FurinaKit 桌面应用中直接调用。",
          variant: "error",
        });
        setStatusMsg("请在桌面客户端中运行");
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "启动异常";
      toast({ title: "调用异常", description: msg, variant: "error" });
      setStatusMsg("启动失败");
    } finally {
      setTimeout(() => setLaunching(false), 800);
    }
  };

  const handleOpenDir = async () => {
    try {
      if (typeof window !== "undefined" && window.furinakit?.openArchprDir) {
        const res = await window.furinakit.openArchprDir();
        if (res.success) {
          toast({
            title: "已打开目录",
            description: "已在文件资源管理器中定位到 ARCHPR 及其字典文件夹。",
            variant: "success",
          });
        } else {
          toast({ title: "打开失败", description: res.error, variant: "error" });
        }
      } else {
        toast({ title: "环境限制", description: "请在 FurinaKit 桌面应用中使用此功能。", variant: "error" });
      }
    } catch (err) {
      toast({ title: "操作异常", description: String(err), variant: "error" });
    }
  };

  return (
    <div className="space-y-6">
      {/* 启动与目录操作条 */}
      <div
        className="relative overflow-hidden rounded-2xl border p-5 shadow-sm"
        style={{
          background: `linear-gradient(135deg, ${colors.card} 0%, ${colors.bg} 100%)`,
          borderColor: colors.borderSolid,
        }}
      >
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={handleLaunch}
            disabled={launching}
            className="flex items-center justify-center gap-2 rounded-xl px-5 py-3 text-sm font-bold text-white shadow-lg transition-all hover:brightness-110 active:scale-95 disabled:opacity-50"
            style={{ background: colors.gold }}
          >
            <Zap size={17} />
            {launching ? "正在启动..." : "一键启动 ARCHPR 破解工具"}
          </button>
          <button
            type="button"
            onClick={handleOpenDir}
            className="flex items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-xs font-medium transition-all"
            style={{
              background: colors.card,
              borderColor: colors.borderSolid,
              color: colors.text,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.background = colors.dropdownHover)}
            onMouseLeave={(e) => (e.currentTarget.style.background = colors.card)}
          >
            <FolderOpen size={15} style={{ color: colors.gold }} />
            查看工具与字典文件夹
          </button>
        </div>

        {statusMsg && (
          <div className="mt-4 flex items-center gap-2 text-xs" style={{ color: colors.gold }}>
            <CheckCircle2 size={14} />
            <span>{statusMsg}</span>
          </div>
        )}
      </div>

      {/* 四大核心攻击模式解说 */}
      <div>
        <h3 className="mb-3 text-sm font-semibold flex items-center gap-2" style={{ color: colors.text }}>
          <Cpu size={16} style={{ color: colors.gold }} />
          支持的四种高效破解机制
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div
            className="rounded-xl border p-4 transition-all"
            style={{ background: colors.card, borderColor: colors.borderSolid }}
          >
            <div className="flex items-center gap-2.5 mb-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-500/10 text-blue-500">
                <Zap size={16} />
              </div>
              <h4 className="font-bold text-sm" style={{ color: colors.text }}>
                1. 暴力搜索 (Brute-Force Attack)
              </h4>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: colors.muted }}>
              穷举所有可能的字符组合（数字、字母、符号）。适用于密码长度较短（1~6位）或纯数字密码。ARCHPR 对底层指令集高度优化，百万级碰撞仅需极短时间。
            </p>
          </div>

          <div
            className="rounded-xl border p-4 transition-all"
            style={{ background: colors.card, borderColor: colors.borderSolid }}
          >
            <div className="flex items-center gap-2.5 mb-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-purple-500/10 text-purple-500">
                <Lock size={16} />
              </div>
              <h4 className="font-bold text-sm" style={{ color: colors.text }}>
                2. 掩码规则 (Mask Attack)
              </h4>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: colors.muted }}>
              如果你对密码有模糊印象（例如记得开头是 admin、末尾是4位年份如 199? 或 202?），使用掩码可屏蔽无关组合，直接将搜索空间减少 99.9%！
            </p>
          </div>

          <div
            className="rounded-xl border p-4 transition-all"
            style={{ background: colors.card, borderColor: colors.borderSolid }}
          >
            <div className="flex items-center gap-2.5 mb-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/10 text-amber-500">
                <BookOpen size={16} />
              </div>
              <h4 className="font-bold text-sm" style={{ color: colors.text }}>
                3. 字典词库碰撞 (Dictionary Attack)
              </h4>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: colors.muted }}>
              绝大多数人为设置的密码都遵循常用词汇组合。软件工具包内置了常用的英文与多国词典（.dic），你也可以把社工字典放进字典目录进行秒级碰撞。
            </p>
          </div>

          <div
            className="rounded-xl border p-4 transition-all"
            style={{ background: colors.card, borderColor: colors.borderSolid }}
          >
            <div className="flex items-center gap-2.5 mb-2">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
                <Unlock size={16} />
              </div>
              <h4 className="font-bold text-sm" style={{ color: colors.text }}>
                4. 已知明文攻击 (Plaintext Attack - 终极杀招)
              </h4>
            </div>
            <p className="text-xs leading-relaxed" style={{ color: colors.muted }}>
              如果加密的 ZIP 压缩包内包含了你在网络或其他地方能找到的未加密原文件（哪怕只有一张公开的说明文件、图片或 dll），可直接在数分钟内逆向出加密主密钥！
            </p>
          </div>
        </div>
      </div>

      {/* 使用步骤与语言设置提示 */}
      <div
        className="rounded-xl border p-5 space-y-3"
        style={{ background: colors.bg, borderColor: colors.borderSolid }}
      >
        <h4 className="font-bold text-sm flex items-center gap-2" style={{ color: colors.text }}>
          <HelpCircle size={16} style={{ color: colors.gold }} />
          新手快速使用指南
        </h4>
        <ol className="list-decimal list-inside space-y-2 text-xs" style={{ color: colors.muted }}>
          <li>
            点击上方 <strong style={{ color: colors.text }}>“一键启动 ARCHPR 破解工具”</strong>，启动主程序；
          </li>
          <li>
            如果界面显示为英文，在顶部菜单栏点击 <code className="px-1.5 py-0.5 rounded bg-black/20 text-blue-400">Options -&gt; Language -&gt; 简体中文 (Simplified Chinese)</code> 即可切换为全中文；
          </li>
          <li>
            在“打开”中选择需要解密的 <strong style={{ color: colors.text }}>.zip 或 .rar</strong> 压缩包文件；
          </li>
          <li>
            选择攻击类型（通常推荐先尝试 <strong>字典攻击</strong> 或 <strong>4~6位纯数字掩码攻击</strong>）；
          </li>
          <li>
            点击“开始 (Start)”，密码破解完成后会自动弹出对话框显示明文密码。
          </li>
        </ol>
      </div>
    </div>
  );
}
