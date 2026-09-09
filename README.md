<div align="center">

<img src="apps/web/public/furina-logo.png" width="130" height="130" alt="FurinaKit Logo" />

# FurinaKit 芙宁娜工具箱

**轻量、优雅且全能的原神芙宁娜主题全栈离线桌面工具箱 🎭✨**

[![GitHub release](https://img.shields.io/github/v/release/Abudora-0/FurinaKit?style=flat-square&color=38bdf8)](https://github.com/Abudora-0/FurinaKit/releases)
[![Version](https://img.shields.io/badge/Version-v2.0.2-blue?style=flat-square)](https://github.com/Abudora-0/FurinaKit/releases/latest)
[![Tools Count](https://img.shields.io/badge/Tools-120%2B-00dc82?style=flat-square)](packages/shared/src/tools.ts)
[![Platform](https://img.shields.io/badge/Platform-Windows%20x64-0078d7?style=flat-square&logo=windows)](https://github.com/Abudora-0/FurinaKit/releases/latest)
[![License](https://img.shields.io/badge/License-MIT-emerald?style=flat-square)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-15-000000?style=flat-square&logo=next.js)](https://nextjs.org/)
[![Electron](https://img.shields.io/badge/Electron-44-47848F?style=flat-square&logo=electron)](https://www.electronjs.org/)
[![Python](https://img.shields.io/badge/Python-3.11-3776AB?style=flat-square&logo=python)](https://www.python.org/)

[🚀 立即下载最新版安装包 (v2.0.2)](https://github.com/Abudora-0/FurinaKit/releases/latest) · [📋 详细更新日志](CHANGELOG.md) · [💬 提交反馈 / 提出新功能需求](https://github.com/Abudora-0/FurinaKit/issues)

</div>

---

## 🌟 项目亮点 (Highlights)

- **🎨 芙宁娜水元素沉浸式美学**：采用定制的水元素玻璃拟态（Glassmorphism）与卡片流光交互，原生支持深色与浅色双模沉浸式随心切换。
- **🧰 120+ 款开箱即用工具**：涵盖图片编辑、PDF全能套件、音视频下载转码、艺术签名设计、文娱追踪打卡、开发编码辅助、数学进制计算等方方面面。
- **🔒 100% 本地离线运行，零隐私泄露**：全部工具均在本地机器内存或离线 Worker 中运算，文件不出本地，彻底告别数据上传泄露风险。
- **⚙️ 双核独立引擎架构**：集成独立便携 Node.js 运行时与 Python 多媒体运算 Worker，内置 FFmpeg 转码套件与 yt-dlp 解析引擎，开箱即用，无需用户额外配置复杂环境。
- **🔄 全自动无感版本更新**：客户端内置多镜像源版本检测中心（支持 CDN 国内高速直达），支持一键全自动下载与覆盖安装升级。

---

## 📦 工具矩阵概览 (120+ Tools)

FurinaKit 将庞杂的功能分门别类，首栏常驻「全部工具」与「我的收藏」，高频常用工具随心置顶：

### 🖼️ 图像工坊 (Image Studio)
| 工具名称 | 功能描述 |
|---|---|
| **AI 智能抠图** | 纯本地离线模型，一键智能识别人像、商品、动物并移除背景 |
| **智能图片压缩** | 在保持原画清晰度前提下，大幅减少图片文件体积，支持批量导出 |
| **格式互转 / 调整尺寸** | 支持 PNG、JPG、WEBP、AVIF、TIFF、ICO、BMP、SVG 等主流格式互转 |
| **智能消除笔 / 去水印** | 本地画笔涂抹智能算法修复，快速去除画面杂物与瑕疵 |
| **长图拼接 / 切图** | 支持横向/纵向拼图、多宫格智能裁切与自适应缩放 |
| **高级滤镜与微调** | 色温、饱和度、亮度、高斯模糊、反相、黑白灰度调节 |

### 📄 PDF 全能套件 (PDF Master)
| 工具名称 | 功能描述 |
|---|---|
| **PDF 转 Word / 文档互转** | 离线高质量解析版式与排版，将 PDF 一键还原为可编辑 Word 文档 |
| **PDF 与图片双向互转** | 支持多图快速合成高清 PDF，或将 PDF 各页无损导出为图片压缩包 |
| **页面管理** | 页面任意角度旋转、删除指定页、多页拖拽自由排序、提取子集 |
| **PDF 合并与拆分** | 多个 PDF 毫秒级无损合并，或按页码范围一键分割 |
| **加密与解密** | 添加/移除 PDF 阅读权限密码，重置打印与编辑限制 |
| **页码与文本水印铭刻** | 批量添加自定义文字水印、页脚智能编排页码 |

### 🎬 音视频与全网下载 (Media Suite)
| 工具名称 | 功能描述 |
|---|---|
| **B 站高清视频解析下载** | 支持 Bilibili 视频、分 P、合集高清无损解析与音视频自动合并下载 |
| **全网多平台下载** | 支持 YouTube、TikTok、Instagram、Twitter/X、Reddit 等主流平台多媒体下载 |
| **音频提取与格式转码** | 视频秒转 MP3/AAC/FLAC/WAV，支持音频比特率无损调校 |
| **内置 FFmpeg 引擎** | 桌面端内置工业级 FFmpeg 转码套件，无需用户配置环境变量 |

### 🖋️ 创意办公与文娱记录 (Creativity & Daily)
| 工具名称 | 功能描述 |
|---|---|
| **艺术与电子签名设计器** | 内置 62 种主流艺术签流派、平滑压感手写板、国风仿古印章铭刻及无白边透明 PNG 智能导出 |
| **影视 · 图书 · 番剧记录中心** | 三位一体文娱记录中心，支持追更打卡、评分心路、状态归档 |
| **科学与程序员全功能计算器** | 支持 HEX/DEC/OCT/BIN 多进制位运算与复杂科学工程函数 |
| **思维导图编辑器** | 快速绘制头脑风暴节点脑图，支持多种色彩主题与大图导出 |
| **密码生成器 / 文本比对** | 高强度安全随机密码生成、双栏差异化文本对比高亮 |

### 💻 开发者与编码百宝箱 (Dev Utilities)
| 工具名称 | 功能描述 |
|---|---|
| **JSON 格式化校验** | 语法高亮、错误定位、层级折叠、压缩与美化 |
| **JWT 解密调试** | 离线解析 Header/Payload，查看过期时间与签名算法 |
| **正则表达式测试器** | 实时匹配、捕获组提取、常用表达式快捷库 |
| **编解码转换器** | URL 编码/解码、Base64 文本/图片互转、颜色格式互转 (HEX/RGB/HSL) |
| **超大罗马数字体系转换** | 突破常规限制，全面支持千万级上划线罗马数字与十进制双向换算 |

---

## 💻 快速开始与使用 (Quick Start)

### 方式一：下载 Windows 桌面安装包 (推荐)
直接前往 [Releases 页面](https://github.com/Abudora-0/FurinaKit/releases/latest) 下载最新的 **`FurinaKit Setup 2.0.2.exe`**：
1. 双击运行安装程序，选择安装路径并完成安装。
2. 启动桌面快捷方式 **FurinaKit**，享受 120+ 款纯本地运行的全能工具！
3. 后续若有新版本发布，只需点击软件内右上角「设置」->「检查更新」，即可**一键全自动极速升级**！

---

### 方式二：源码运行与二次开发 (Developers)

本项目为基于 **pnpm workspaces** 的 Monorepo 架构：
```text
FurinaKit/
├── apps/
│   └── web/                # Next.js 15 前端 + Electron 44 桌面主进程
├── packages/
│   └── shared/             # 共享工具注册中心、类型定义与验证 Schema
└── services/
    └── worker/             # Python 3.11 离线多媒体与重型任务运算服务
```

#### 1. 克隆代码仓库
```bash
git clone https://github.com/Abudora-0/FurinaKit.git
cd FurinaKit
```

#### 2. 安装 Node.js 依赖
```bash
pnpm install
```

#### 3. 启动前端开发调试
```bash
# 启动 Web 端调试
pnpm dev

# 或在 apps/web 目录下启动 Electron 桌面调试
cd apps/web
npx electron .
```

#### 4. 启动 Python 离线 Worker (可选，用于多媒体下载与重型任务)
```bash
cd services/worker
python -m venv .venv
.venv\Scripts\activate      # Windows
pip install -r requirements.txt
python worker.py
```

#### 5. 本地打包构建桌面安装包
```bash
pnpm --filter @furinakit/web build
pnpm --filter @furinakit/web dist
```
构建成功后，将在 `apps/web/dist-installer/` 目录下生成 `FurinaKit Setup 2.0.2.exe` 安装包。

---

## 🎂 投喂芙芙小蛋糕 (Sponsor)

如果您喜欢 FurinaKit，或者它为您的工作与生活带来了便利，欢迎投喂芙芙一点小蛋糕！🍰  
大家的喜爱与支持是芙芙持续更新与做出更多惊艳功能的最大动力 💙  
*(芙芙承诺软件所有功能永远免费开源使用哦~)*

<div align="center">

| 支付宝 (Alipay) | 微信支付 (WeChat Pay) |
| :---: | :---: |
| <img src="apps/web/public/donate-alipay.jpg" width="210" height="210" alt="支付宝赞赏码" /> | <img src="apps/web/public/donate-wechat.png" width="210" height="210" alt="微信赞赏码" /> |
| **支付宝** | **微信** |

</div>

---

## 📜 免责声明 (Disclaimer)

1. 本项目涉及的「原神」及「芙宁娜」相关角色形象、名称及元素知识产权均归 **米哈游（miHoYo / HoYoverse）** 所有。本项目为个人非营利开源同人与实用工具作品，旨在提供优雅的桌面工具体验，严禁用于任何侵犯版权的商业营利行为。
2. 音视频下载工具仅供个人学习研究及合法合规使用，用户须遵守各平台服务条款及相关法律法规。

---

## 📄 开源许可证 (License)

本项目遵循 [MIT License](LICENSE) 开源协议。欢迎 Star、Fork 与提交 Pull Request！
