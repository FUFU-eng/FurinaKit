import React from "react";
import { initializeLanguage } from "./lib/language";
import "./i18n-layout.css";
import ReactDOM from "react-dom/client";
import App from "./App";
import { installBridge } from "./bridge";
import { installFetchBridge } from "./fetch-bridge";
import { installClipboardShim } from "./clipboard-shim";
import { installMediaShim } from "./media-shim";
import { installDropAnywhere } from "./lib/drop-anywhere";
import { runLegacyImport } from "./lib/legacy-import";
// 样式：index.css 就是原版的 app/globals.css（逐字节搬过来的）
import "./index.css";
// 字体：从 Next 构建产物里原样导出的 @font-face（Inter / JetBrains Mono）
import "./fonts.css";

// 这些兼容层必须在 React 渲染之前装好：
//  · bridge        —— 补上原 Electron 主进程那套 window.furinakit.*
//  · fetchBridge   —— 把 fetch("/api/xxx") 改写成 Tauri 的 invoke
//  · clipboardShim —— 把 navigator.clipboard 接到系统剪贴板
//                     （不接的话读剪贴板会弹浏览器的权限框，很出戏）
//  · mediaShim     —— 让 <img src="/api/..."> 这类预览也能显示
//                     （img 是浏览器自己取资源，fetch 补丁拦不到）
document.documentElement.dataset.window = new URLSearchParams(location.search).get("window") || "main";

void initializeLanguage();
installBridge();
installFetchBridge();
installClipboardShim();
installMediaShim();
// 让所有工具的上传区都能接收拖拽（很多上传区是各自手写的，只支持点击）
installDropAnywhere();

const render = () =>
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );

// 主窗口先把 2.0.6 的旧数据导入（只做一次，最多等 4 秒），再渲染界面，这样收藏/设置一进来就在
if (document.documentElement.dataset.window === "main") {
  void runLegacyImport().finally(render);
} else {
  render();
}
