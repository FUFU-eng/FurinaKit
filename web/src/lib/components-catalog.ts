
import { tr } from "@/lib/language";
import { createUiText as __createUiText } from "@/lib/language";
const __ui = __createUiText("lib/components-catalog.ts");
/**
 * 组件（模型）目录：只有有哪些组件、多大、干什么用这类**纯数据**。
 *
 * 从 components-download.ts 里拆出来的 —— 那个文件用的是 Node 的 fs/path，
 * 在 Tauri 的 WebView 里根本不存在，一旦被 import 就会让浏览器构建直接失败
 * （rollup："existsSync" is not exported by "__vite-browser-external"，实测踩过）。
 * 界面只需要这份数据，真正的下载/删除走后端接口。
 */

export interface ComponentMirror {
  name: string;
  url: (file: string) => string;
}

export interface ComponentToolRef {
  id: string;
  name: string;
}

export type ComponentCategory = "vision" | "audio" | "style";

export interface ComponentSpec {
  id: string;
  name: string;
  enName: string;
  category: ComponentCategory;
  categoryName: string;
  summary: string;
  purpose: string;
  file: string;
  size: number;
  mirrors: ComponentMirror[];
  tools: ComponentToolRef[];
  requirement?: string;
  sha256?: string;
}

export interface ComponentStatus {
  id: string;
  name: string;
  enName: string;
  category: ComponentCategory;
  categoryName: string;
  summary: string;
  purpose: string;
  size: number;
  sizeText: string;
  requirement?: string;
  tools: ComponentToolRef[];
  downloaded: boolean;
  downloadedSize: number;
  filePath?: string;
}

export const COMPONENTS: ComponentSpec[] = [
  {...{"id": "whisper-base", "name": "Whisper base", "enName": "whisper.cpp base", "category": "audio", "categoryName": "音频模型", "summary": "普通CPU推荐，内存占用较低", "purpose": "语音转写模型；任选其一，无需全部下载。首次下载需要联网，音频始终在本机处理。", "file": "ggml-base.bin", "size": 147951465, "tools": [{"id": "audio-transcribe", get "name"() { return __ui("音频转文字"); }}], "requirement": "普通CPU推荐，内存占用较低", "sha256": "60ed5bc3dd14eea856493d334349b405782ddcaf0028d4b5df4088345fba2efe"}, mirrors: [{name:"ModelScope",url:file=>`https://www.modelscope.cn/models/iceCream2025/whisper.cpp/resolve/master/${file}`},{name:"ModelScope 备用",url:file=>`https://www.modelscope.cn/models/viggocx/whisper.cpp/resolve/master/${file}`},{name:"HF 镜像",url:file=>`https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/${file}`},{name:"Hugging Face",url:file=>`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${file}`} ]},
  {...{"id": "whisper-large-v3-turbo-q5_0", "name": "Whisper large-v3-turbo-q5_0", "enName": "whisper.cpp large-v3-turbo-q5_0", "category": "audio", "categoryName": "音频模型", "summary": "量化多语言模型，建议至少4GB可用内存", "purpose": "语音转写模型；任选其一，无需全部下载。首次下载需要联网，音频始终在本机处理。", "file": "ggml-large-v3-turbo-q5_0.bin", "size": 574041195, "tools": [{"id": "audio-transcribe", get "name"() { return __ui("音频转文字"); }}], "requirement": "量化多语言模型，建议至少4GB可用内存", "sha256": "394221709cd5ad1f40c46e6031ca61bce88931e6e088c188294c6d5a55ffa7e2"}, mirrors: [{name:"ModelScope",url:file=>`https://www.modelscope.cn/models/iceCream2025/whisper.cpp/resolve/master/${file}`},{name:"ModelScope 备用",url:file=>`https://www.modelscope.cn/models/viggocx/whisper.cpp/resolve/master/${file}`},{name:"HF 镜像",url:file=>`https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/${file}`},{name:"Hugging Face",url:file=>`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${file}`} ]},
  {...{"id": "whisper-medium", "name": "Whisper medium", "enName": "whisper.cpp medium", "category": "audio", "categoryName": "音频模型", "summary": "较大模型，建议至少6GB可用内存", "purpose": "语音转写模型；任选其一，无需全部下载。首次下载需要联网，音频始终在本机处理。", "file": "ggml-medium.bin", "size": 1533763059, "tools": [{"id": "audio-transcribe", get "name"() { return __ui("音频转文字"); }}], "requirement": "较大模型，建议至少6GB可用内存", "sha256": "6c14d5adee5f86394037b4e4e8b59f1673b6cee10e3cf0b11bbdbee79c156208"}, mirrors: [{name:"ModelScope",url:file=>`https://www.modelscope.cn/models/iceCream2025/whisper.cpp/resolve/master/${file}`},{name:"ModelScope 备用",url:file=>`https://www.modelscope.cn/models/viggocx/whisper.cpp/resolve/master/${file}`},{name:"HF 镜像",url:file=>`https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/${file}`},{name:"Hugging Face",url:file=>`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${file}`} ]},
  {...{"id": "whisper-small", "name": "Whisper small", "enName": "whisper.cpp small", "category": "audio", "categoryName": "音频模型", "summary": "更注重准确率，CPU处理更慢", "purpose": "语音转写模型；任选其一，无需全部下载。首次下载需要联网，音频始终在本机处理。", "file": "ggml-small.bin", "size": 487601967, "tools": [{"id": "audio-transcribe", get "name"() { return __ui("音频转文字"); }}], "requirement": "更注重准确率，CPU处理更慢", "sha256": "1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b"}, mirrors: [{name:"ModelScope",url:file=>`https://www.modelscope.cn/models/iceCream2025/whisper.cpp/resolve/master/${file}`},{name:"ModelScope 备用",url:file=>`https://www.modelscope.cn/models/viggocx/whisper.cpp/resolve/master/${file}`},{name:"HF 镜像",url:file=>`https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/${file}`},{name:"Hugging Face",url:file=>`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${file}`} ]},
  {...{"id": "whisper-tiny", "name": "Whisper tiny", "enName": "whisper.cpp tiny", "category": "audio", "categoryName": "音频模型", "summary": "轻量快速，适合试用", "purpose": "语音转写模型；任选其一，无需全部下载。首次下载需要联网，音频始终在本机处理。", "file": "ggml-tiny.bin", "size": 77691713, "tools": [{"id": "audio-transcribe", get "name"() { return __ui("音频转文字"); }}], "requirement": "轻量快速，适合试用", "sha256": "be07e048e1e599ad46341c8d2a135645097a538221678b7acdd1b1919c6e1b21"}, mirrors: [{name:"ModelScope",url:file=>`https://www.modelscope.cn/models/iceCream2025/whisper.cpp/resolve/master/${file}`},{name:"ModelScope 备用",url:file=>`https://www.modelscope.cn/models/viggocx/whisper.cpp/resolve/master/${file}`},{name:"HF 镜像",url:file=>`https://hf-mirror.com/ggerganov/whisper.cpp/resolve/main/${file}`},{name:"Hugging Face",url:file=>`https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${file}`} ]},

  // ── 图像视觉与智能消除 (4 款) ──
  {
    id: "lama-inpaint",
    get "name"() { return __ui("LaMa 大面积图像纹理修复模型"); },
    enName: "Large Mask Inpainting (LaMa FFC)",
    category: "vision",
    categoryName: "图像视觉与消除",
    summary: "智能抹除画面杂物与路人、无痕去除复杂水印污渍、老照片划痕修补与向外画布扩展。",
    purpose: "基于快速傅里叶卷积 (Fast Fourier Convolution, FFC) 神经架构，具备超大感受野与高频纹理全局一致性推断能力，有效解决大面积遮挡修复时的模糊与断裂问题。",
    file: "lama_fp32.onnx",
    size: 203_000_000,
    tools: [
      { id: "watermark-remove", get "name"() { return __ui("图片去水印"); } },
      { id: "ai-outpaint", get "name"() { return __ui("AI 画面扩展 / 扩图"); } },
      { id: "photo-restore", get "name"() { return __ui("老照片修复 (划痕修补)"); } },
    ],
    mirrors: [
      { get "name"() { return __ui("国内高速"); }, url: (f) => `https://www.modelscope.cn/models/codetrend/LaMa_Inpainting_Model_ONNX/resolve/master/${f}` },
      { get "name"() { return __ui("国内镜像"); }, url: (f) => `https://hf-mirror.com/Carve/LaMa-ONNX/resolve/main/${f}` },
      { get "name"() { return __ui("官方源"); }, url: (f) => `https://huggingface.co/Carve/LaMa-ONNX/resolve/main/${f}` },
    ],
    requirement: "普通 CPU 单图约 8~18 秒；支持 DirectML / CUDA 硬件加速",
  },
  {
    id: "isnet-matting",
    get "name"() { return __ui("ISNet 显著目标高精发丝抠图模型"); },
    enName: "DIS ISNet High-Precision Matting",
    category: "vision",
    categoryName: "图像视觉与消除",
    summary: "高精提取人像发丝、微细轮廓与半透明织物，生成边缘过渡自然、无白边的高质量透明背景。",
    purpose: "采用高分辨率两分目标分割 (DIS) 架构，通过多级特征融合与高频边缘导数约束，提供亚像素级精细 Alpha 遮罩预测与半透明过渡保留。",
    file: "isnet-general-use.onnx",
    size: 175_000_000,
    tools: [
      { id: "bg-remove", get "name"() { return __ui("智能抠图 / 去除背景"); } },
      { id: "bg-replace", get "name"() { return __ui("图片换背景"); } },
      { id: "id-photo", get "name"() { return __ui("智能证件照制作"); } },
      { id: "precise-matting", get "name"() { return __ui("高精发丝抠图"); } },
    ],
    mirrors: [
      { get "name"() { return __ui("国内高速"); }, url: (f) => `https://www.modelscope.cn/models/shiertier/rembg/resolve/master/${f}` },
      { get "name"() { return __ui("国内镜像"); }, url: (f) => `https://ghproxy.net/https://github.com/danielgatis/rembg/releases/download/v0.0.0/${f}` },
      { get "name"() { return __ui("备用加速"); }, url: (f) => `https://gh-proxy.com/https://github.com/danielgatis/rembg/releases/download/v0.0.0/${f}` },
      { get "name"() { return __ui("GitHub 官方"); }, url: (f) => `https://github.com/danielgatis/rembg/releases/download/v0.0.0/${f}` },
    ],
    requirement: "建议内存 ≥ 1GB，普通 CPU 单图耗时约 3~6 秒",
  },
  {
    id: "u2net-fast",
    get "name"() { return __ui("U²-Net 通用显著目标快速分割模型"); },
    enName: "U²-Net Salient Object Detector",
    category: "vision",
    categoryName: "图像视觉与消除",
    summary: "日常电商商品、常规人像与各类实体快速抠像，运行速度极快且占用系统资源极低。",
    purpose: "基于双层嵌套 U 型结构 (ReSQU) 设计，无需依赖大参数量骨干网络，兼顾全局结构轮廓与局部边缘的高效捕获，适合大量素材批量预处理。",
    file: "u2net.onnx",
    size: 176_000_000,
    tools: [
      { id: "bg-remove", get "name"() { return __ui("智能抠图 (极速模式)"); } },
      { id: "bg-replace", get "name"() { return __ui("图片换背景 (极速模式)"); } },
      { id: "id-photo", get "name"() { return __ui("智能证件照 (快速档)"); } },
    ],
    mirrors: [
      { get "name"() { return __ui("国内高速"); }, url: (f) => `https://www.modelscope.cn/models/shiertier/rembg/resolve/master/${f}` },
      { get "name"() { return __ui("国内镜像"); }, url: (f) => `https://ghproxy.net/https://github.com/danielgatis/rembg/releases/download/v0.0.0/${f}` },
      { get "name"() { return __ui("备用加速"); }, url: (f) => `https://gh-proxy.com/https://github.com/danielgatis/rembg/releases/download/v0.0.0/${f}` },
      { get "name"() { return __ui("GitHub 官方"); }, url: (f) => `https://github.com/danielgatis/rembg/releases/download/v0.0.0/${f}` },
    ],
    requirement: "极低系统资源占用，普通 CPU 单图仅需 1~2 秒",
  },
  {
    id: "birefnet-matting",
    get "name"() { return __ui("BiRefNet 超高分辨率双边参考抠图模型"); },
    enName: "Bilateral Reference Network (BiRefNet)",
    category: "vision",
    categoryName: "图像视觉与消除",
    summary: "面向 4K/8K 级超高清人像与微距摄影的极致精细抠像，支持影棚级发丝细微透光分离。",
    purpose: "采用双边参考引导与多尺度感受野特征重构算法，针对超大分辨率图像中的极细微毛发、薄纱和工业级边缘提供专业影棚级细节还原。",
    file: "birefnet.onnx",
    size: 972_000_000,
    tools: [
      { id: "bg-remove", get "name"() { return __ui("智能抠图 (4K/8K 精抠档)"); } },
      { id: "precise-matting", get "name"() { return __ui("超高清微距发丝抠图"); } },
    ],
    mirrors: [
      { get "name"() { return __ui("国内高速"); }, url: (f) => `https://www.modelscope.cn/models/onnx-community/BiRefNet-ONNX/resolve/master/onnx/${f}` },
      { get "name"() { return __ui("国内镜像"); }, url: (f) => `https://hf-mirror.com/onnx-community/BiRefNet-ONNX/resolve/main/onnx/${f}` },
      { get "name"() { return __ui("官方源"); }, url: (f) => `https://huggingface.co/onnx-community/BiRefNet-ONNX/resolve/main/onnx/${f}` },
    ],
    requirement: "模型参数量较大（972 MB），建议配合独立显卡或现代多核处理器",
  },

  // One item, two independently checksummed files. Downloads are owned by the native API.
  {
    id: "mdx-separation",
    get name() { return tr("人声与伴奏分离 · 双核心", "Vocal & instrumental separation · model pair"); },
    enName: "UVR MDX Voc_FT + Inst_HQ_3",
    category: "audio",
    categoryName: "深度声学音轨分离",
    get summary() { return tr("一次下载人声与伴奏两种核心，自动复用已校验文件。", "Download both models together; verified existing files are reused."); },
    get purpose() { return tr("按选择使用人声或伴奏专用模型；两条结果先试听，用户决定是否保存。分离质量取决于原曲。", "Choose a vocal or instrumental model. Preview both tracks before saving. Separation quality depends on the mix."); },
    file: "mdx-separation",
    size: 133_521_704,
    tools: [{ id: "vocal-separate", get name() { return tr("人声伴奏分离", "Vocal & instrumental separation"); } }],
    mirrors: [],
    get requirement() { return tr("CPU 本机推理 · 双文件 SHA-256 校验 · 总计约 127.3 MiB", "Local CPU inference · SHA-256 verification of both files · 127.3 MiB total"); },
  },

  // ── 风格重建与色彩重绘 (1 款) ──
  {
    id: "manga-colorize",
    get "name"() { return __ui("Manga Colorization 神经风格色彩重构模型"); },
    enName: "Manga Colorization ONNX Engine",
    category: "style",
    categoryName: "风格色彩与漫线上色",
    summary: "黑白老照片智能还原自然真实色彩，黑白漫画线稿与线框图自动推断色彩并一键上色。",
    purpose: "基于前馈条件自编码网络架构，学习图像灰度空间与丰富色彩先验的映射关系，智能推断画面景深、光影过渡与合理的色彩饱和度分布。",
    file: "manga-colorize-fp16.onnx",
    size: 61_700_000,
    tools: [
      { id: "colorize-photo", get "name"() { return __ui("黑白照片上色 (AI 模型模式)"); } },
      { id: "manga-translator", get "name"() { return __ui("漫画生肉翻译 / 汉化上色"); } },
    ],
    mirrors: [
      { get "name"() { return __ui("国内镜像"); }, url: (f) => `https://hf-mirror.com/Faridzar/manga-colorization-v2-onnx/resolve/main/${f}` },
      { get "name"() { return __ui("官方源"); }, url: (f) => `https://huggingface.co/Faridzar/manga-colorization-v2-onnx/resolve/main/${f}` },
    ],
    requirement: "FP16 轻量优化版，普通 CPU 单图推理耗时仅 2~4 秒",
  },
  {
    id: "ffmpeg",
    get "name"() { return __ui("FFmpeg 核心多媒体音视频处理引擎"); },
    enName: "FFmpeg Multi-Media Codec Engine",
    category: "audio",
    categoryName: "音视频核心引擎",
    summary: "提供音视频格式转码、视频压缩、无损裁剪、音频提取、抽帧与屏幕录制封装等全部媒体底层能力。",
    purpose: "跨平台多媒体编解码框架核心，为录屏、视频剪辑、格式转换与音频转写等数十款工具提供原生高速编解码推流与格式封装能力。",
    file: "ffmpeg.exe",
    size: 205_508_608,
    tools: [
      { id: "screen-recorder", get "name"() { return __ui("屏幕录制"); } },
      { id: "video-format-convert", get "name"() { return __ui("视频格式转换"); } },
      { id: "video-compress", get "name"() { return __ui("视频压缩"); } },
      { id: "video-trim", get "name"() { return __ui("视频剪切"); } },
      { id: "video-to-gif", get "name"() { return __ui("视频转 GIF"); } },
      { id: "video-frame-extract", get "name"() { return __ui("视频抽帧"); } },
      { id: "video-to-audio", get "name"() { return __ui("提取音频"); } },
      { id: "audio-format-convert", get "name"() { return __ui("音频格式转换"); } },
      { id: "audio-trim", get "name"() { return __ui("音频剪切"); } },
      { id: "audio-merge", get "name"() { return __ui("音频合并"); } },
      { id: "audio-transcribe", get "name"() { return __ui("音频转文字"); } },
    ],
    mirrors: [
      { get "name"() { return __ui("安装包内置"); }, url: (f) => `bundled://tools/engines/ffmpeg/${f}` },
    ],
    requirement: "已随安装包内置（FFmpeg 9.0.1 essentials，FFmpeg 与 FFprobe 合计约 196 MiB），无需下载",
  },
];
