# FurinaKit 2.1.0 — 许可与第三方组件说明

FurinaKit 自有源码沿用本仓库的 MIT License（见 LICENSE）。此许可不替代任何第三方程序、库、模型、字体或素材的许可证。安装本软件不代表获得第三方商业软件的永久许可或再分发权。

## 原生候选包说明（方案 C）

原生基础候选不携带 Python 或 site-packages；现随附精简动漫 2x/3x 超分（NCNN 引擎和两组模型，共 5 个资源文件，8,662,490 字节），截图强化与图片超分使用 Rust 原生任务。以下 Python 描述仅适用于历史完整包或相应可选扩展；Real-ESRGAN 描述也适用于本次内置精简资源。原生图片 OCR 携带约 13.71 MB 的原有 PP-OCRv3 检测/识别与 v2 方向分类模型；SHA-256 见 models/ocr-v3/manifest.json。算法与模型的 Apache-2.0、边界追踪的 imageproc MIT 许可，以及改动说明随包保留于 licenses/project-dependencies/ocr-NOTICE.md、ocr-Apache-2.0-LICENSE.txt、imageproc-contours-LICENSE.txt。此候选仍未通过完整功能和模型输出质量验收，不是正式完整安装包。

## 运行环境与引擎

- Tauri / Rust / React / Vite：保留各自的依赖许可证。
- Python 3.14.2 Windows embeddable distribution：来自 python.org，遵循 Python Software Foundation License。原始 LICENSE.txt 随嵌入解释器提供。
- Python 依赖：许可证保留在各个包的 *.dist-info / licenses 目录；其中包含 NumPy、OpenCV、PyMuPDF、pdf2docx、python-docx、python-pptx、ONNX Runtime、RapidOCR、yt-dlp、pywin32 等。PyMuPDF 等组件的授权条款并非 MIT；请分别核对其原始许可。
- FFmpeg / FFprobe：不随安装包提供，由设置中的同一组件显式下载两个程序并校验 SHA-256。来自 FFmpeg / Gyan Windows builds。遵循对应构建的 LGPL/GPL 条款；二进制的 -version 输出列出实际构建选项。源码与构建来源：https://ffmpeg.org/ 、https://www.gyan.dev/ffmpeg/builds/ 。相关许可文件保留于 licenses/ffmpeg/。
- whisper.cpp：来源 https://github.com/ggml-org/whisper.cpp ，许可及来源说明位于 tools/engines/whisper/。
- aria2：来源 https://github.com/aria2/aria2 ，COPYING、OpenSSL 许可与来源说明位于 tools/engines/aria2/。
- Real-ESRGAN ncnn Vulkan：来源 https://github.com/xinntao/Real-ESRGAN-ncnn-vulkan 。当前内置仅为动漫 2x/3x，不等价替代写实或 4x 模型。上游包装器 MIT、Real-ESRGAN 项目 BSD-3-Clause、ncnn 复合许可原文和固定来源记录位于 licenses/project-dependencies/upscale-lite/（源码目录 licenses/upscale-lite/）。这些材料不表示当前 EXE 的构建来源、全部静态依赖或每份模型制品授权已经逐一核验；详见该目录 NOTICE.md。
- Microsoft Visual C++ Runtime、DirectML、WebView2：微软组件，遵循各自许可，不属于本项目 MIT 源码。WebView2 不存在时安装程序会调用微软签名的官方安装器，需要联网。

## 按需下载的模型

FFmpeg / FFprobe、Sherpa C-API 语音运行组件、Whisper、LaMa、ISNet、U2Net、BiRefNet、漫画上色、人声/伴奏分离，以及 Kokoro/Piper 扩展语音模型不放入本次完整安装包；在设置中由使用者按需获取。下载、使用或再分发模型仍需遵守模型作者的许可。设置提供来源、容量和用途信息。基础 OCR 和基础超分所需的小型运行资源保留，以保证原有开箱功能。

主要上游：https://huggingface.co/ggerganov/whisper.cpp 、https://github.com/danielgatis/rembg 、https://github.com/ZhengPeng7/BiRefNet 、https://github.com/k2-fsa/sherpa-onnx 、https://github.com/TRvlvr/model_repo 。完整容量与校验信息以应用组件目录为准。

## 外部商业程序 ARCHPR

ARCHPR（Advanced Archive Password Recovery）是 ElcomSoft 的第三方商业软件，不是 FurinaKit 的开源代码，也不会因为此工具箱免费、开源或非商业使用而自动转为开源。其版权、使用、注册及再分发条件由原厂约定；本项目的 MIT License 不授予 ARCHPR 的许可。官方来源：https://www.elcomsoft.com/archpr.html 。请仅用于你有权访问和恢复的文件。

## 隐私与网络

本地工具默认在设备内处理相应文件。下载/联网查询、在线 AI 接口、匿名安装/启动/工具使用计数和主动发送的反馈需要联网；不能把整个应用理解为“完全不联网”或“零遥测”。在线 AI 使用你自行配置的服务与密钥。匿名计数不包含文档内容；反馈按提交的内容发送到既有反馈渠道。安装量是尽力上报的计数，不是严格去重的身份统计。

## 品牌与同人素材

这是非官方项目，与角色、游戏及相关商标权利方无关联。第三方角色、图标、字体或商标的权利归各自权利人所有；自有代码的许可证不对这些素材作额外授权。

## 原生 PDF OCR 的系统依赖与字体

原生候选通过 Windows 自带的 Windows.Data.Pdf 渲染 PDF，不重新分发 Windows PDF 服务、PDFium 或 MuPDF。Rust API 绑定复用 windows 0.61.3（MIT，Copyright (c) Microsoft Corporation），完整许可随包保留于 licenses/project-dependencies/windows-MIT.txt，源码路径为 licenses/windows-MIT.txt。不可见文字层使用项目自行生成的空字形 TrueType 字体和 Unicode 映射，不复制、嵌入或分发系统中文字体。项目自有生成器及字体适用项目许可；既有 OCR 模型与算法的第三方许可不变。此实现尚未通过 PDF 阅读器和识别效果验收。

## 原生 GIF 与批量图片处理

原生图片候选直接使用已锁定的 gif 0.14.2（此前已为 image 的传递依赖），选择其 MIT 许可；完整版权和许可见 licenses/gif-MIT.txt，随包复制到 licenses/project-dependencies/gif-MIT.txt。PNG/JPEG/BMP/TIFF/WebP/ICO 使用既有 image 0.25.10 的 Rust 编解码链；本轮未引入 Pillow、OpenCV、FFmpeg 或新模型。GIF 帧/调色板处理、ICO 容器与流式 ZIP 的项目自有集成适用仓库许可。格式转换的完整 WebP/AVIF 路径及实际图像/动图质量仍未验收。

## G03 隔离图片工作进程：真实 WebP / AVIF 与颜色管理

原生基础包新增 furinakit-image-worker.exe。锁定的 image 0.25.10 / png 0.18.1 / moxcms 0.8.1 / webp 0.3.1（libwebp）/ ravif 0.13.0（rav1e）/ rav1d 1.1.0 和 libavif 1.4.2 容器适配的完整许可、复合子组件说明及 PATENTS 保存在 licenses/project-dependencies/image-codecs-g03；manifest.json 记录解析依赖闭包、features、来源、文件与源包 SHA-256。包含 build/proc-macro 依赖，不表示它们全部链接进运行程序。原有许可证不删除。

rav1d 使用 MPL-2.0，未修改该 crate。对应源码随包提供于同目录 sources/rav1d-1.1.0.crate（gzip tar，可用支持 tar/gzip 的解压工具打开），与 Cargo.lock 上游 SHA-256 一致；亦可从 https://static.crates.io/crates/rav1d/rav1d-1.1.0.crate 获取。项目的 libavif/rav1d 容器桥接是独立集成；保留 libavif 复合授权、libwebp 与 rav1e 专利授权全文，不据此声明免于所有专利风险。

atomig-macro 与 profiling 系列在 crate 内漏带的许可从 crate 记录的精确 VCS 提交补齐；simd_helpers 的精确上游提交也没有独立许可文件，保留其 MIT 声明与作者原始 manifest，并明确提供发行方补充的标准 MIT 文本/归属说明，不冒充上游原文件。

颜色策略为受管理 sRGB；HDR 使用明确标记的 SDR 映射，gain map 使用基础图像，静态格式转换使用首帧并剥离源 Exif/XMP。ICC CMYK 的源空间解码、全部视觉质量和最终安装/升级尚未验收。此段只陈述实现与许可材料，不表示方案 C 已完成。
