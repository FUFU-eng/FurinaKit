<p align="center">
  <img src="./docs/image/preview.png" alt="FurinaKit Preview" width="850">
</p>

<h1 align="center">FurinaKit (芙宁娜工具箱)</h1>

<p align="center">
  <strong>轻量 · 优雅 · 全能 · 纯本地离线桌面工具箱</strong>
</p>

<p align="center">
  <a href="#-速览">✨ 功能速览</a> •
  <a href="#-工具矩阵概览">🧰 工具矩阵</a> •
  <a href="#-核心系统架构">⚙️ 核心架构</a> •
  <a href="#-下载与安装">🚀 下载安装</a> •
  <a href="#-源码构建与二次开发">💻 开发者指南</a> •
  <a href="CHANGELOG.md">📋 更新日志</a>
</p>

<p align="center">
  <img src="https://img.shields.io/github/v/release/FUFU-eng/FurinaKit?style=flat-square&color=38bdf8" alt="Release" />
  <img src="https://img.shields.io/badge/Tools-120%2B-00dc82?style=flat-square" alt="Tools Count" />
  <img src="https://img.shields.io/badge/Platform-Windows%20x64-0078d7?style=flat-square&logo=windows" alt="Windows" />
  <img src="https://img.shields.io/badge/Next.js-15-000000?style=flat-square&logo=next.js" alt="Next.js" />
  <img src="https://img.shields.io/badge/Electron-44-47848F?style=flat-square&logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/Python-3.11-3776AB?style=flat-square&logo=python" alt="Python" />
  <img src="https://img.shields.io/badge/License-MIT-emerald?style=flat-square" alt="License" />
</p>

---

**FurinaKit 是一个以《原神》芙宁娜（Furina）为核心主题与设计美学的 Windows 全栈离线桌面工具箱。**

> 基于 Electron + Next.js + Python 双核驱动架构深度自研打造。  
> 融合水元素玻璃拟态的优雅交互与卡片流光，集成了涵盖图像处理、PDF 全能套件、音视频下载转码、艺术签名设计、文娱追踪打卡、开发运维及数学计算在内的 **120+ 款实用工具**。  
> **告别繁琐**：使用多个工具时彻底告别频繁打开多个网站和零散软件，只需打开 FurinaKit 即可一站式轻松解决全场景需求；坚持 **100% 纯本地离线运行、零数据上传、永久免费且完全开源**，让每一次工具体验都如水般纯净、自然与优雅。

---

## ✨ 速览

- 🚀 **持续进化与敏捷扩展** — 保持高频迭代，持续新增各领域实用新工具，并对现有工具不断进行深度优化与体验重构
- 🎯 **一站式聚合，告别多端切换** — 使用多个工具时彻底告别打开多个网站和零碎软件的繁琐，只需打开 FurinaKit 即可满足全场景日常需求
- 🎨 **水元素美学设计** — 围绕芙宁娜角色风格量身打造的水元素玻璃拟态（Glassmorphism）与卡片流光交互，原生支持深色与浅色双模沉浸式随心切换
- 🧰 **120+ 款开箱即用工具** — 囊括图片工坊、PDF 套件、媒体下载转码、电子艺术签名、追更打卡、科学计算、开发测试等，无需四处搜寻小软件，一站式满足全场景需求
- 🔒 **100% 纯本地离线隐私** — 所有文件处理与算法计算完全在本地内存与离线 Worker 中闭环完成，不向外部服务器上传任何数据，从根源保障绝对隐私安全
- ⚙️ **双核驱动独立架构** — 内置独立便携 Node.js 运行时与 Python 多媒体运算 Worker，集成工业级 FFmpeg 转码套件与 yt-dlp 解析引擎，无需用户额外配置任何环境，解压即用
- 🔄 **全自动无感在线升级** — 客户端内置多镜像源版本检测中心（支持国内 CDN 高速直达），支持一键全自动后台分块下载与安装包自动覆盖升级
- 📌 **人性化交互细节** — 首页工具自由收藏与高亮置顶、滚动历史视口记忆还原、系统托盘静默常驻、全局自定义输出目录与开机自启

---

## 🧰 工具矩阵概览

FurinaKit 提供模块化分类导航，首页常驻「全部工具」与「我的收藏」，高频工具支持随心置顶：

### 🖼️ 图像工坊 (Image Studio)
- **AI 智能抠图**：内置离线深度学习模型，一键精准识别人像、商品、动物并移除背景。
- **智能图片压缩**：在极致保持原画画质与清晰度的同时大幅缩减体积，支持批量多图并行处理。
- **全格式互转 / 尺寸微调**：支持 PNG、JPG、WEBP、AVIF、TIFF、ICO、BMP、SVG 等主流图片格式无损互转与等比/自由缩放。
- **智能去水印 / 消除笔**：采用本地算法涂抹修复，快速消除图片上的杂物、文字与水印瑕疵。
- **长图拼接 / 多宫格切图**：支持横向/纵向拼图自适应排版，支持九宫格及任意网格智能切图。
- **滤镜调色与特效处理**：色温、饱和度、对比度、亮度、高斯模糊、反相与黑白灰度精细调节。

### 📄 PDF 全能套件 (PDF Master)
- **PDF 转 Word / 文档互转**：离线高质量解析版式与排版，将 PDF 一键精准还原为可编辑 Word（.docx）文档。
- **PDF 与图片双向互转**：支持将多张图片毫秒级合成为高清 PDF，或将 PDF 各页无损导出为图片集。
- **页面全能管理**：支持页面任意角度旋转、指定页删除、多页拖拽自由重排与提取子集。
- **PDF 合并与拆分**：多文件无缝合并，或按指定页码、范围一键精准分割。
- **安全加密与权限解密**：一键添加/移除 PDF 阅读权限密码，支持打印与编辑权限策略重置。
- **水印铭刻与页码编排**：批量为 PDF 文档添加防伪自定义文字水印与智能页眉页脚页码。

### 🎬 音视频套件与全网提取 (Media Suite)
- **B 站视频高清解析下载**：支持 Bilibili 视频、分 P 列表、合集高清无损解析与音视频自动合并提取。
- **全网主流平台下载**：支持 YouTube、TikTok、Instagram、Twitter/X、Reddit 等多平台音视频提取。
- **音频提取与格式转码**：视频秒级抽取 MP3/AAC/FLAC/WAV，支持音频比特率与声道无损调校。
- **内置 FFmpeg 引擎**：桌面端内置工业级 FFmpeg 与 ffprobe 套件，杜绝环境变量配置门槛。

### 🖋️ 创意办公与生活百宝箱 (Creativity & Daily)
- **艺术与电子签名设计器**：内置 62 款主流一笔签与连笔艺术签流派、平滑压感手写板、仿古朱文/白文国风印章，支持无白边透明 PNG 合同签名一键导出。
- **影视 · 图书 · 番剧记录中心**：三位一体文娱记录中心，支持季度进度打卡、集数追踪、心路评分与状态归档。
- **科学与程序员全进制计算器**：支持 HEX/DEC/OCT/BIN 多进制快速换算、按位逻辑运算与大数高精度科学计算。
- **思维导图编辑器**：轻量级头脑风暴节点思维导图，支持自由编辑、色彩主题切换与大图导出。
- **实用密码生成与文本比对**：高强度安全随机密码生成、双栏差异化文本增删实时对比高亮。

### 💻 开发者与编码测试工具 (Dev Utilities)
- **JSON 格式化校验**：语法高亮、精准错误定位、层级折叠展开、压缩与格式化。
- **JWT 解密调试**：离线解析 Header/Payload，直观查看签发机构、有效期与加密算法。
- **正则表达式测试器**：实时匹配、捕获组提取、高频常用表达式速查库。
- **多功能编解码器**：URL 编解码、Base64 文本/图片双向转换、颜色格式转换 (HEX/RGB/HSL)。
- **超大罗马数字体系转换**：突破常规 1-3999 限制，全面支持千万级上划线罗马数字体系与十进制双向换算。

---

## ⚙️ 核心系统架构

FurinaKit 采用前后端同构的本地桌面双核架构：

```text
               ┌──────────────────────────────────────────────┐
               │         FurinaKit Windows Desktop App        │
               └──────────────────────┬───────────────────────┘
                                      │
           ┌──────────────────────────┴──────────────────────────┐
           ▼                                                     ▼
┌───────────────────────┐                             ┌───────────────────────┐
│     Electron Shell    │                             │  Next.js 15 (Local)   │
│  窗口管理 / 原生托盘   │ ◄────── 本地 IPC / HTTP ─────► │  现代化玻璃拟态 UI    │
│  一键自动下载 / 升级   │                             │  120+ 前端工具运行时  │
└──────────┬────────────┘                             └───────────┬───────────┘
           │                                                      │
           │                                                      │ 内部任务队列
           │                                                      ▼
           │                                          ┌───────────────────────┐
           │                                          │ Python Worker 守护服务│
           └──────────────── 统一运行时调度 ─────────►│ FFmpeg / yt-dlp / AI  │
                                                      │ PDF转Word / 音视频转码│
                                                      └───────────────────────┘
```

- **Electron 44 容器**：负责本地系统托盘、多窗口状态记忆、原生文件流式下载与安装程序静默拉起。
- **Next.js 15 内核**：全套响应式前端页面与 API 接口，通过 `@img/sharp-win32-x64` 原生模块高效处理轻量级同步图像与文件任务。
- **Python Worker 引擎**：独立的便携式 Python 守护进程，专职接管高计算量重型任务（PDF 转 Word、AI 抠图、音视频分块转码与提取）。

---

## 🚀 下载与安装

### 方式一：下载 Windows 安装包 (推荐所有普通用户)

1. 点击前往官方发布页下载最新版安装包：  
   👉 **[FurinaKit Releases 最新发布页](https://github.com/FUFU-eng/FurinaKit/releases/latest)**
2. 下载 **`FurinaKit Setup 2.0.3.exe`**。
3. 双击安装程序，自由选择安装目录并勾选创建桌面快捷方式，等待 10 秒即可安装完成。
4. **后续升级**：软件内置自动更新功能，发布新版本后只需点击右上角设置内的「检查更新」，即可**一键自动下载并无感升级**，无需反复重新下载安装！

---

### 方式二：源码构建与二次开发 (针对开发者)

#### 1. 环境准备
- Node.js >= 20.0.0
- pnpm >= 9.0.0
- Python >= 3.10（如需调试 Worker）

#### 2. 克隆项目与安装依赖
```bash
git clone https://github.com/FUFU-eng/FurinaKit.git
cd FurinaKit
pnpm install
```

#### 3. 启动本地开发服务
```bash
# 启动 Web 前端服务 (http://localhost:3000)
pnpm dev

# 或在独立终端启动 Electron 桌面调试环境
cd apps/web
npx electron .
```

#### 4. 编译 Python 离线 Worker (可选)
```bash
cd services/worker
python -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
python worker.py
```

#### 5. 打包生成 Windows 安装包
```bash
pnpm --filter @furinakit/web build
pnpm --filter @furinakit/web dist
```
打包成功后，安装包将输出至 `apps/web/dist-installer/FurinaKit Setup 2.0.3.exe`。

---

## 🙏 致谢与鸣谢 (Acknowledgements)

本项目在开发与架构演进过程中，特别鸣谢以下杰出的开源先驱与开源项目：

- **[OmniKit](https://github.com/Abudora-0)** by **[Abdullah (@Abudora-0)](https://github.com/Abudora-0)**:  
  衷心感谢 Abdullah 设计并开源了优秀的 OmniKit 工具箱架构。FurinaKit 早期版本基于其优秀的多工具体系与双核驱动构想，在此坚实基础之上完成了芙宁娜主题重构、全离线桌面原生固化、视频下载链路重构及上百款功能套件扩展。向其开源探索与卓越贡献致以崇高敬意！
- **[yt-dlp](https://github.com/yt-dlp/yt-dlp)**：强大的跨平台全网多媒体流提取引擎。
- **[FFmpeg](https://ffmpeg.org/)**：顶级的开源音视频多媒体处理基石。
- **[Next.js](https://nextjs.org/)** & **[Electron](https://www.electronjs.org/)**：现代跨平台桌面与 Web 应用工程体系。

---

## 📜 免责声明 (Disclaimer)

1. 本项目涉及的《原神》及「芙宁娜」相关角色形象、名称及音画元素知识产权均归 **米哈游（miHoYo / HoYoverse）** 所有。本项目仅为粉丝爱好者出于对角色的喜爱所制作的非营利开源同人作品，严禁用于任何侵犯版权的商业营利行为。
2. 音视频下载功能基于开源项目 `yt-dlp` 实现，仅供个人技术学习、研究及合法离线备份使用。用户在使用时须遵守相关国家法律法规及各网络服务平台条款。

---

## 📄 开源许可证 (License)

本项目遵循 **[MIT License](LICENSE)** 开源许可证。  
欢迎大家 Star ⭐️、Fork、提交 Issue 与 Pull Request，共同参与 FurinaKit 的建设！
