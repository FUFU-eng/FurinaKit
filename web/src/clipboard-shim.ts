/**
 * 剪贴板替身 —— 把浏览器的剪贴板 API 接到软件自己的剪贴板命令上。
 *
 * ── 为什么必须这么做 ──────────────────────────────────────────────────────
 * 软件里有 **50 多处**直接写 `navigator.clipboard.writeText(...)` / `readText()`。
 * 在 WebView2 里，读剪贴板属于需要授权的操作，会弹出那个很出戏的系统提示框：
 *
 *     「http://tauri.localhost 想要 查看复制到剪贴板的文本和图像   [阻止] [允许]」
 *
 * 一个桌面软件弹这种浏览器权限框，用户会以为中了病毒。而 Electron 版没这问题
 * （Electron 的剪贴板走主进程 IPC，不经过网页权限）。
 *
 * 所以这里把 `navigator.clipboard` 整个换掉：读写都走 Rust 侧的剪贴板命令
 * （tauri-plugin-clipboard-manager，直接操作系统剪贴板），**一次都不会再弹框**，
 * 而且 50 多处调用一行都不用改。
 *
 * 覆盖到的：
 *   · writeText / readText      → clipboard_write / clipboard_read
 *   · write([ClipboardItem])    → 图片先转 base64 交给 clipboard_write_image
 *   · read()                    → 暂不支持（项目里没人用），退回原实现
 * 其它方法（writeHTML 之类）保持原样，不影响。
 */

import { invoke } from "@tauri-apps/api/core";

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("读取失败"));
    reader.onload = () => {
      const s = String(reader.result || "");
      resolve(s.slice(s.indexOf(",") + 1));
    };
    reader.readAsDataURL(blob);
  });
}

export function installClipboardShim() {
  if (typeof navigator === "undefined") return;
  const nav = navigator as Navigator & { __fkClipboardPatched?: boolean };
  if (nav.__fkClipboardPatched) return;

  const original = nav.clipboard as (Clipboard & { writeHTML?: (html: string) => Promise<void> }) | undefined;

  const patched = {
    /** 写文本：走系统剪贴板，不弹权限框 */
    async writeText(text: string): Promise<void> {
      await invoke("clipboard_write", { text: String(text ?? "") });
    },

    /** 读文本：走系统剪贴板，不弹权限框 */
    async readText(): Promise<string> {
      return await invoke<string>("clipboard_read");
    },

    /**
     * 写图片（签名工具"复制图片"用的那条路径）：
     * ClipboardItem → Blob → base64 → Rust 解码后写进系统剪贴板
     */
    async write(items: ClipboardItem[]): Promise<void> {
      for (const item of items) {
        const pngType = item.types.find((t) => t === "image/png") || item.types[0];
        if (!pngType || !pngType.startsWith("image/")) continue;
        const blob = await item.getType(pngType);
        const b64 = await blobToBase64(blob);
        await invoke("clipboard_write_image", { data: b64 });
      }
    },

    // 下面这些项目里没人用，但保留转发，免得个别组件调用时直接报"不是函数"
    writeHTML: original?.writeHTML?.bind(original),
    read: original?.read?.bind(original),
  };

  try {
    Object.defineProperty(nav, "clipboard", {
      value: patched,
      configurable: true,
      writable: false,
    });
    nav.__fkClipboardPatched = true;
  } catch (e) {
    console.warn("[FurinaKit] 剪贴板替身安装失败，将退回浏览器实现", e);
  }
}
