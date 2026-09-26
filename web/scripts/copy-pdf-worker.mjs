// 把 pdf.js 的 worker 复制到 /public，让 PDF 工具能同源加载它
// （不依赖 CDN，处理全程留在本地）。挂在 predev/prebuild 上，
// 保证 worker 版本始终与安装的 pdfjs-dist 一致。
//
// ── 为什么 Tauri 版必须补这一步 ──────────────────────────────────────────
// Electron 版靠这个脚本把 pdf.worker.min.mjs 放进 public，构建产物里就有它。
// Tauri 版一开始漏了这个脚本，结果 /pdf.worker.min.mjs 请求落到静态服务上
// 返回了 index.html（HTML 而非 JS），pdf.js 的 worker 起不来 —— 实测后果是
// 「PDF 页面裁剪 / PDF 编辑器 / PDF 转图片」三个工具**解析不出任何 PDF**
// （界面显示"共 0 页"，预览缩成一小块）。补上这个脚本即可。
import { copyFileSync, mkdirSync } from "fs";
import path from "path";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const pkgPath = require.resolve("pdfjs-dist/package.json");
const src = path.join(path.dirname(pkgPath), "build", "pdf.worker.min.mjs");
const destDir = path.join(process.cwd(), "public");
const dest = path.join(destDir, "pdf.worker.min.mjs");

mkdirSync(destDir, { recursive: true });
copyFileSync(src, dest);
console.log(`[copy-pdf-worker] ${src} -> ${dest}`);
