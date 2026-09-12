import type { OmniTool } from "./types";

export const TOOLS: OmniTool[] = [
  // ─────────────────────────────────────────────  图片工具 (image)  ──────────
  {
      "id": "image-upscale",
      "name": "图片强化",
      "description": "使用 Real-ESRGAN AI 模型批量超分放大 2/3/4 倍，高清重绘对比",
      "category": "image",
      "mode": "async",
      "icon": "ZoomIn",
      "selfHostOnly": true,
      "heavyWorkerOnly": true,
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "图片文件",
          "required": true
        },
        {
          "id": "model",
          "type": "select",
          "label": "AI 模型",
          "required": true,
          "defaultValue": "anime-x2",
          "options": [
            {
              "label": "动漫 2倍 (anime-x2)",
              "value": "anime-x2"
            },
            {
              "label": "动漫 3倍 (anime-x3)",
              "value": "anime-x3"
            },
            {
              "label": "动漫 4倍 (anime-x4)",
              "value": "anime-x4"
            },
            {
              "label": "通用 4倍 (real-x4)",
              "value": "real-x4"
            }
          ]
        }
      ]
    },
  {
      "id": "image-obfuscate",
      "name": "图片混淆",
      "description": "空间填充曲线与混沌像素映射算法，支持方块/全像素打乱与可逆解密",
      "category": "image",
      "mode": "sync",
      "icon": "EyeOff",
      "inputs": []
    },
  {
      "id": "image-to-pdf",
      "name": "图片转 PDF",
      "description": "将一张或多张图片合并为 PDF 文件，支持自定义页面与多画质压缩",
      "category": "image",
      "mode": "async",
      "icon": "FileText",
      "inputs": [
        {
          "id": "files",
          "type": "file",
          "label": "图片文件（可多选）",
          "required": true,
          "multiple": true
        },
        {
          "id": "page_size",
          "type": "select",
          "label": "页面大小",
          "required": true,
          "defaultValue": "a4",
          "options": [
            {
              "label": "A4",
              "value": "a4"
            },
            {
              "label": "Letter",
              "value": "letter"
            },
            {
              "label": "原始图片大小",
              "value": "original"
            }
          ]
        },
        {
          "id": "orientation",
          "type": "select",
          "label": "方向",
          "required": true,
          "defaultValue": "portrait",
          "options": [
            {
              "label": "纵向",
              "value": "portrait"
            },
            {
              "label": "横向",
              "value": "landscape"
            }
          ]
        }
      ]
    },
  {
      "id": "file-hide-image",
      "name": "文件伪装为图片",
      "description": "将任意私密文件无损伪装隐藏入图片，或一键提取还原藏匿文件",
      "category": "image",
      "mode": "sync",
      "icon": "FileImage",
      "clientSide": true,
      "inputs": []
    },
  {
      "id": "bg-remove",
      "name": "自动抠图",
      "description": "AI 智能去除图片背景，支持人像、商品、动物等",
      "category": "image",
      "mode": "async",
      "clientSide": true,
      "icon": "Scissors",
      "selfHostOnly": true,
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "图片文件",
          "required": true
        },
        {
          "id": "model",
          "type": "select",
          "label": "AI 模型",
          "required": true,
          "defaultValue": "u2net",
          "options": [
            {
              "label": "通用 (u2net)",
              "value": "u2net"
            },
            {
              "label": "人像 (u2net_human_seg)",
              "value": "u2net_human_seg"
            },
            {
              "label": "快速 (isnet-general-use)",
              "value": "isnet-general-use"
            }
          ]
        }
      ]
    },
  {
      "id": "image-compress",
      "name": "图片压缩",
      "description": "智能压缩图片大小，保持清晰度的同时减小文件体积",
      "category": "image",
      "mode": "async",
      "clientSide": true,
      "icon": "Minimize2",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "multiple": true,
          "label": "图片文件",
          "required": true
        },
        {
          "id": "quality",
          "type": "number",
          "label": "压缩质量 (1-100)",
          "required": false,
          "defaultValue": 75,
          "min": 1,
          "max": 100
        },
        {
          "id": "max_width",
          "type": "number",
          "label": "最大宽度 (像素)",
          "required": false,
          "help": "超过则等比缩放"
        }
      ]
    },
  {
      "id": "image-format-convert",
      "name": "格式转换",
      "description": "在 PNG、JPG、WebP、AVIF、BMP、TIFF、GIF 等格式之间互相转换",
      "category": "image",
      "mode": "async",
      "icon": "Repeat",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "multiple": true,
          "label": "图片文件",
          "required": true
        },
        {
          "id": "format",
          "type": "select",
          "label": "输出格式",
          "required": true,
          "defaultValue": "webp",
          "options": [
            {
              "label": "WebP",
              "value": "webp"
            },
            {
              "label": "PNG",
              "value": "png"
            },
            {
              "label": "JPEG",
              "value": "jpeg"
            },
            {
              "label": "AVIF",
              "value": "avif"
            },
            {
              "label": "TIFF",
              "value": "tiff"
            },
            {
              "label": "BMP",
              "value": "bmp"
            },
            {
              "label": "GIF",
              "value": "gif"
            }
          ]
        },
        {
          "id": "quality",
          "type": "number",
          "label": "质量 (1-100)",
          "required": false,
          "defaultValue": 90,
          "min": 1,
          "max": 100,
          "help": "PNG/GIF 为无损格式，此设置无效"
        }
      ]
    },
  {
      "id": "image-resize",
      "name": "图片改尺寸",
      "description": "按精确尺寸或等比调整图片大小",
      "category": "image",
      "mode": "async",
      "clientSide": true,
      "icon": "Maximize2",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "图片文件",
          "required": true
        },
        {
          "id": "width",
          "type": "number",
          "label": "宽度 (像素)",
          "required": false
        },
        {
          "id": "height",
          "type": "number",
          "label": "高度 (像素)",
          "required": false
        },
        {
          "id": "keep_ratio",
          "type": "select",
          "label": "保持比例",
          "required": true,
          "defaultValue": "true",
          "options": [
            {
              "label": "是",
              "value": "true"
            },
            {
              "label": "否",
              "value": "false"
            }
          ]
        }
      ]
    },
  {
      "id": "image-crop",
      "name": "图片裁剪",
      "description": "按指定位置和尺寸裁剪图片",
      "category": "image",
      "mode": "async",
      "clientSide": true,
      "icon": "Crop",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "图片文件",
          "required": true
        },
        {
          "id": "x",
          "type": "number",
          "label": "起始 X 坐标",
          "required": true,
          "defaultValue": 0
        },
        {
          "id": "y",
          "type": "number",
          "label": "起始 Y 坐标",
          "required": true,
          "defaultValue": 0
        },
        {
          "id": "width",
          "type": "number",
          "label": "裁剪宽度",
          "required": true,
          "defaultValue": 100
        },
        {
          "id": "height",
          "type": "number",
          "label": "裁剪高度",
          "required": true,
          "defaultValue": 100
        }
      ]
    },
  {
      "id": "image-watermark",
      "name": "图片加水印",
      "description": "给图片添加文字水印，支持位置、大小、透明度、旋转角度调整",
      "category": "image",
      "mode": "async",
      "icon": "Droplet",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "图片文件",
          "required": true
        },
        {
          "id": "text",
          "type": "text",
          "label": "水印文字",
          "required": true,
          "defaultValue": "FurinaKit"
        },
        {
          "id": "position",
          "type": "select",
          "label": "水印位置",
          "required": false,
          "defaultValue": "bottom-right",
          "options": [
            {
              "value": "top-left",
              "label": "左上角"
            },
            {
              "value": "top-center",
              "label": "顶部居中"
            },
            {
              "value": "top-right",
              "label": "右上角"
            },
            {
              "value": "center",
              "label": "居中"
            },
            {
              "value": "bottom-left",
              "label": "左下角"
            },
            {
              "value": "bottom-center",
              "label": "底部居中"
            },
            {
              "value": "bottom-right",
              "label": "右下角"
            }
          ]
        },
        {
          "id": "fontSize",
          "type": "number",
          "label": "字体大小",
          "required": false,
          "defaultValue": 36,
          "min": 12,
          "max": 200
        },
        {
          "id": "opacity",
          "type": "number",
          "label": "透明度 (0-100)",
          "required": false,
          "defaultValue": 50,
          "min": 1,
          "max": 100
        },
        {
          "id": "color",
          "type": "color",
          "label": "文字颜色",
          "required": false,
          "defaultValue": "#ffffff"
        },
        {
          "id": "rotate",
          "type": "number",
          "label": "旋转角度",
          "required": false,
          "defaultValue": 0,
          "min": -180,
          "max": 180
        },
        {
          "id": "x_percent",
          "type": "number",
          "label": "水印横向位置（百分比）",
          "required": false,
          "defaultValue": 50
        },
        {
          "id": "y_percent",
          "type": "number",
          "label": "水印纵向位置（百分比）",
          "required": false,
          "defaultValue": 50
        },
        {
          "id": "font_size",
          "type": "number",
          "label": "字号（按原图像素）",
          "required": false,
          "defaultValue": 36
        }
      ]
    },
  {
      "id": "image-merge",
      "name": "图片拼接",
      "description": "将多张图片纵向拼接成长图、横向拼接或宫格排版，支持自定义间距与圆角",
      "category": "image",
      "mode": "sync",
      "clientSide": true,
      "icon": "Layers",
      "inputs": [
        {
          "id": "files",
          "type": "file",
          "multiple": true,
          "label": "图片文件（多张）",
          "required": true
        }
      ]
    },
  {
      "id": "image-split",
      "name": "图片分割",
      "description": "将图片按网格分割成多张",
      "category": "image",
      "mode": "async",
      "clientSide": true,
      "icon": "Grid3x3",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "图片文件",
          "required": true
        },
        {
          "id": "rows",
          "type": "number",
          "label": "行数",
          "required": true,
          "defaultValue": 2,
          "min": 1,
          "max": 10
        },
        {
          "id": "cols",
          "type": "number",
          "label": "列数",
          "required": true,
          "defaultValue": 2,
          "min": 1,
          "max": 10
        }
      ]
    },
  {
      "id": "image-to-ico",
      "name": "图片转 ICO",
      "description": "将图片转换为 Windows 图标文件，支持多尺寸，保持透明通道",
      "category": "image",
      "mode": "async",
      "icon": "Image",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "图片文件",
          "required": true,
          "help": "支持 PNG、JPG、WebP 等格式，建议使用正方形图片"
        },
        {
          "id": "sizes",
          "type": "select",
          "label": "图标尺寸规格",
          "required": true,
          "defaultValue": "all",
          "options": [
            {
              "label": "多尺寸合一 (16/32/48/64/128/256) - 推荐·最佳兼容",
              "value": "all"
            },
            {
              "label": "网页 Favicon (16 × 16 + 32 × 32)",
              "value": "favicon"
            },
            {
              "label": "桌面应用标准 (32 × 32 + 48 × 48 + 256 × 256)",
              "value": "desktop"
            },
            {
              "label": "256 × 256 (超高清大图标)",
              "value": "256"
            },
            {
              "label": "128 × 128 (高清单尺寸)",
              "value": "128"
            },
            {
              "label": "64 × 64 (中等尺寸)",
              "value": "64"
            },
            {
              "label": "48 × 48 (Windows 默认大图标)",
              "value": "48"
            },
            {
              "label": "32 × 32 (标准中等图标)",
              "value": "32"
            },
            {
              "label": "16 × 16 (标准小图标)",
              "value": "16"
            }
          ],
          "help": "选择生成的 ICO 图标内包含的分辨率尺寸"
        }
      ]
    },
  {
      "id": "gif-compress",
      "name": "GIF 压缩",
      "description": "压缩 GIF 动图，减小文件大小",
      "category": "image",
      "mode": "async",
      "icon": "Film",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "GIF 文件",
          "required": true
        },
        {
          "id": "quality",
          "type": "number",
          "label": "压缩质量 (1-100)",
          "required": false,
          "defaultValue": 75,
          "min": 1,
          "max": 100
        }
      ]
    },
  {
      "id": "gif-crop",
      "name": "GIF 裁剪",
      "description": "裁剪 GIF 动图的指定区域",
      "category": "image",
      "mode": "async",
      "icon": "Scissors",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "GIF 文件",
          "required": true
        },
        {
          "id": "x",
          "type": "number",
          "label": "起始 X 坐标",
          "required": true,
          "defaultValue": 0
        },
        {
          "id": "y",
          "type": "number",
          "label": "起始 Y 坐标",
          "required": true,
          "defaultValue": 0
        },
        {
          "id": "width",
          "type": "number",
          "label": "裁剪宽度",
          "required": true,
          "defaultValue": 100
        },
        {
          "id": "height",
          "type": "number",
          "label": "裁剪高度",
          "required": true,
          "defaultValue": 100
        }
      ]
    },
  {
      "id": "image-rotate",
      "name": "图片旋转",
      "description": "旋转图片任意角度",
      "category": "image",
      "mode": "async",
      "icon": "RotateCw",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "图片文件",
          "required": true
        },
        {
          "id": "angle",
          "type": "number",
          "label": "旋转角度",
          "required": true,
          "defaultValue": 90,
          "help": "90=顺时针90度, 180=翻转, 270=逆时针90度"
        }
      ]
    },
  {
      "id": "image-to-jpg",
      "name": "图片转 JPG",
      "description": "将 PNG、WebP、BMP 等格式转换为 JPG",
      "category": "image",
      "mode": "async",
      "icon": "Image",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "图片文件",
          "required": true
        },
        {
          "id": "quality",
          "type": "number",
          "label": "质量 (1-100)",
          "required": false,
          "defaultValue": 95,
          "min": 1,
          "max": 100
        }
      ]
    },
  {
      "id": "image-exif",
      "name": "图片 EXIF 查看",
      "description": "读取照片的拍摄参数，包括机型、镜头、光圈、快门、ISO、拍摄时间与 GPS 位置",
      "category": "image",
      "mode": "sync",
      "icon": "Aperture",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "图片文件",
          "required": true,
          "accept": "image/*"
        }
      ]
    },
  {
      "id": "svg-optimize",
      "name": "SVG 优化压缩",
      "description": "清理 SVG 中的注释、编辑器元数据与冗余空白，在不改变渲染结果的前提下减小体积",
      "category": "image",
      "mode": "sync",
      "icon": "FileCode",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "SVG 文件",
          "required": true,
          "accept": ".svg,image/svg+xml"
        }
      ]
    }
  // ─────────────────────────────────────────────  视频工具 (download)  ──────────
,
  {
      "id": "video-download",
      "name": "通用视频下载",
      "description": "从 YouTube、TikTok、Instagram 等 1000+ 网站下载视频",
      "category": "download",
      "mode": "async",
      "icon": "Download",
      "selfHostOnly": true,
      "disclaimer": "仅供个人使用。下载可能违反平台用户协议，请自行承担风险。",
      "inputs": [
        {
          "id": "url",
          "type": "url",
          "label": "视频链接",
          "placeholder": "https://...",
          "required": true
        },
        {
          "id": "format",
          "type": "select",
          "label": "下载内容",
          "required": true,
          "defaultValue": "mp4",
          "options": [
            {
              "label": "视频 (MP4)",
              "value": "mp4"
            },
            {
              "label": "音频 (MP3)",
              "value": "mp3"
            },
            {
              "label": "封面 (JPG)",
              "value": "thumbnail"
            }
          ]
        },
        {
          "id": "quality",
          "type": "select",
          "label": "画质",
          "required": true,
          "defaultValue": "best",
          "options": [
            {
              "label": "最高画质",
              "value": "best"
            },
            {
              "label": "1080p 最高",
              "value": "1080"
            },
            {
              "label": "720p 最高",
              "value": "720"
            },
            {
              "label": "480p 最高",
              "value": "480"
            }
          ]
        }
      ]
    },
  {
      "id": "bilibili-download",
      "name": "B站视频提取",
      "description": "提取并下载B站视频、音频或封面，支持高清画质",
      "category": "download",
      "mode": "async",
      "icon": "Video",
      "selfHostOnly": true,
      "disclaimer": "仅供个人使用。下载可能违反B站用户协议。",
      "inputs": [
        {
          "id": "url",
          "type": "url",
          "label": "B站视频链接",
          "placeholder": "https://www.bilibili.com/video/BV...",
          "required": true
        },
        {
          "id": "format",
          "type": "select",
          "label": "下载内容",
          "required": true,
          "defaultValue": "mp4",
          "options": [
            {
              "label": "视频 (MP4)",
              "value": "mp4"
            },
            {
              "label": "音频 (MP3)",
              "value": "mp3"
            },
            {
              "label": "封面 (JPG)",
              "value": "thumbnail"
            }
          ]
        },
        {
          "id": "quality",
          "type": "select",
          "label": "画质",
          "required": true,
          "defaultValue": "best",
          "options": [
            {
              "label": "最高画质",
              "value": "best"
            },
            {
              "label": "1080p 最高",
              "value": "1080"
            },
            {
              "label": "720p 最高",
              "value": "720"
            },
            {
              "label": "480p 最高",
              "value": "480"
            }
          ]
        }
      ]
    },
  {
      "id": "video-format-convert",
      "name": "视频格式转换",
      "description": "各种视频格式互转，支持 MP4、AVI、MOV、MKV、WebM、FLV 等",
      "category": "download",
      "mode": "async",
      "icon": "Repeat",
      "selfHostOnly": true,
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "multiple": true,
          "label": "视频文件",
          "required": true
        },
        {
          "id": "format",
          "type": "select",
          "label": "目标格式",
          "required": true,
          "defaultValue": "mp4",
          "options": [
            {
              "label": "MP4",
              "value": "mp4"
            },
            {
              "label": "AVI",
              "value": "avi"
            },
            {
              "label": "MOV",
              "value": "mov"
            },
            {
              "label": "MKV",
              "value": "mkv"
            },
            {
              "label": "WebM",
              "value": "webm"
            },
            {
              "label": "FLV",
              "value": "flv"
            },
            {
              "label": "WMV",
              "value": "wmv"
            },
            {
              "label": "M4V",
              "value": "m4v"
            }
          ]
        },
        {
          "id": "quality",
          "type": "select",
          "label": "画质",
          "required": false,
          "defaultValue": "high",
          "options": [
            {
              "label": "原画",
              "value": "original"
            },
            {
              "label": "高画质",
              "value": "high"
            },
            {
              "label": "中画质",
              "value": "medium"
            },
            {
              "label": "低画质",
              "value": "low"
            }
          ]
        }
      ]
    },
  {
      "id": "video-compress",
      "name": "视频压缩",
      "description": "压缩视频文件大小，保持画质的同时减小体积",
      "category": "download",
      "mode": "async",
      "icon": "Minimize2",
      "selfHostOnly": true,
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "视频文件",
          "required": true
        },
        {
          "id": "quality",
          "type": "select",
          "label": "压缩质量",
          "required": false,
          "defaultValue": "medium",
          "options": [
            {
              "label": "高画质（体积较大）",
              "value": "high"
            },
            {
              "label": "均衡",
              "value": "medium"
            },
            {
              "label": "小体积（画质降低）",
              "value": "low"
            }
          ]
        },
        {
          "id": "maxSize",
          "type": "number",
          "label": "目标大小 (MB)",
          "required": false,
          "help": "设置后自动调整码率达到目标大小"
        }
      ]
    },
  {
      "id": "video-to-gif",
      "name": "视频转 GIF",
      "description": "将视频片段转换为 GIF 动图，支持截取时间段、调整尺寸和帧率",
      "category": "download",
      "mode": "async",
      "icon": "Film",
      "selfHostOnly": true,
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "视频文件",
          "required": true
        },
        {
          "id": "startTime",
          "type": "text",
          "label": "开始时间 (秒)",
          "required": false,
          "defaultValue": "0",
          "placeholder": "例如: 5"
        },
        {
          "id": "duration",
          "type": "text",
          "label": "持续时长 (秒)",
          "required": false,
          "defaultValue": "5",
          "placeholder": "例如: 3"
        },
        {
          "id": "width",
          "type": "number",
          "label": "宽度 (像素)",
          "required": false,
          "defaultValue": 480,
          "help": "高度自动等比缩放"
        },
        {
          "id": "fps",
          "type": "number",
          "label": "帧率 (FPS)",
          "required": false,
          "defaultValue": 15,
          "min": 5,
          "max": 30
        }
      ]
    },
  {
      "id": "twitter-download",
      "name": "推特视频提取",
      "description": "提取并下载 Twitter/X 视频、GIF 或封面，支持多种画质与纯音频提取（需代理）",
      "category": "download",
      "mode": "async",
      "icon": "Twitter",
      "selfHostOnly": true,
      "disclaimer": "需开启系统科学上网/网络代理工具才能正常提取与下载推特视频。仅供个人学习使用。",
      "inputs": [
        {
          "id": "url",
          "type": "url",
          "label": "Twitter/X 视频链接",
          "placeholder": "https://x.com/username/status/...",
          "required": true
        },
        {
          "id": "format",
          "type": "select",
          "label": "下载内容",
          "required": true,
          "defaultValue": "mp4",
          "options": [
            {
              "label": "视频 (MP4)",
              "value": "mp4"
            },
            {
              "label": "音频 (MP3)",
              "value": "mp3"
            },
            {
              "label": "封面 (JPG)",
              "value": "thumbnail"
            }
          ]
        },
        {
          "id": "quality",
          "type": "select",
          "label": "画质",
          "required": true,
          "defaultValue": "best",
          "options": [
            {
              "label": "最高画质",
              "value": "best"
            },
            {
              "label": "1080p 最高",
              "value": "1080"
            },
            {
              "label": "720p 最高",
              "value": "720"
            },
            {
              "label": "480p 最高",
              "value": "480"
            }
          ]
        }
      ]
    },
  {
      "id": "magnet-download",
      "name": "磁力种子下载",
      "description": "极速磁力链接与 BT 种子下载，内置优质 Tracker 加速与实时速度监控",
      "category": "download",
      "mode": "async",
      "icon": "Magnet",
      "selfHostOnly": true,
      "disclaimer": "仅供个人下载合规资源，请遵守当地法律法规与版权协议。",
      "inputs": [
        {
          "id": "url",
          "type": "text",
          "label": "磁力链接 / Torrent 文件",
          "placeholder": "magnet:?xt=urn:btih:... 或拖入 .torrent 文件",
          "required": true
        }
      ]
    },
  {
      "id": "video-trim",
      "name": "视频裁剪",
      "description": "按时间区间裁剪视频，支持不重编码的快速裁剪与切点精确的重编码裁剪",
      "category": "download",
      "mode": "async",
      "icon": "Scissors",
      "selfHostOnly": true,
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "视频文件",
          "required": true,
          "accept": "video/*"
        },
        {
          "id": "start",
          "type": "line",
          "label": "开始时间",
          "placeholder": "例如 00:00:10 或 10",
          "required": false,
          "help": "留空表示从开头开始"
        },
        {
          "id": "end",
          "type": "line",
          "label": "结束时间",
          "placeholder": "例如 00:00:30 或 30",
          "required": false,
          "help": "留空表示裁到结尾"
        },
        {
          "id": "mode",
          "type": "select",
          "label": "裁剪方式",
          "required": true,
          "defaultValue": "fast",
          "options": [
            { "label": "快速裁剪（不重编码，秒出，切点对齐关键帧）", "value": "fast" },
            { "label": "精确裁剪（重新编码，切点精确，稍慢）", "value": "precise" }
          ],
          "help": "快速裁剪不会重新编码，因此无损且很快，但切点会对齐到最近的关键帧，可能与设定时间差零点几秒"
        }
      ]
    },
  {
      "id": "video-frame-extract",
      "name": "视频抽帧",
      "description": "从视频的指定时间点提取一帧画面，输出 PNG 或 JPG 图片",
      "category": "download",
      "mode": "async",
      "icon": "ScanLine",
      "selfHostOnly": true,
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "视频文件",
          "required": true,
          "accept": "video/*"
        },
        {
          "id": "time",
          "type": "line",
          "label": "取帧时间",
          "placeholder": "例如 1.5 或 00:00:01.5",
          "required": false,
          "help": "留空表示取第 0 秒；超出视频时长会提示视频总长度"
        },
        {
          "id": "format",
          "type": "select",
          "label": "输出格式",
          "required": true,
          "defaultValue": "png",
          "options": [
            { "label": "PNG（无损）", "value": "png" },
            { "label": "JPG（体积小）", "value": "jpg" }
          ]
        },
        {
          "id": "width",
          "type": "number",
          "label": "输出宽度（像素）",
          "required": false,
          "help": "留空表示保持原始尺寸，填了会等比缩放"
        }
      ]
    }
  // ─────────────────────────────────────────────  音频工具 (audio)  ──────────
,
  {
      "id": "video-to-audio",
      "name": "视频转音频",
      "description": "从视频中提取音轨并转为 MP3、WAV、FLAC、AAC、M4A、OGG 等音频文件",
      "category": "audio",
      "mode": "async",
      "icon": "FileAudio",
      "selfHostOnly": true,
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "视频文件",
          "required": true,
          "help": "支持 MP4、MOV、MKV、AVI、WebM、FLV 等常见视频格式"
        },
        {
          "id": "format",
          "type": "select",
          "label": "输出音频格式",
          "required": true,
          "defaultValue": "mp3",
          "options": [
            {
              "label": "MP3",
              "value": "mp3"
            },
            {
              "label": "WAV",
              "value": "wav"
            },
            {
              "label": "FLAC（无损）",
              "value": "flac"
            },
            {
              "label": "AAC",
              "value": "aac"
            },
            {
              "label": "M4A",
              "value": "m4a"
            },
            {
              "label": "OGG",
              "value": "ogg"
            },
            {
              "label": "OPUS",
              "value": "opus"
            }
          ]
        },
        {
          "id": "bitrate",
          "type": "select",
          "label": "比特率",
          "required": false,
          "defaultValue": "192k",
          "options": [
            {
              "label": "128 kbps",
              "value": "128k"
            },
            {
              "label": "192 kbps",
              "value": "192k"
            },
            {
              "label": "256 kbps",
              "value": "256k"
            },
            {
              "label": "320 kbps",
              "value": "320k"
            },
            {
              "label": "最高质量",
              "value": "lossless"
            }
          ]
        }
      ]
    },
  {
      "id": "audio-format-convert",
      "name": "音频格式转换",
      "description": "在 MP3、WAV、FLAC、AAC、OGG、M4A 等格式之间互相转换",
      "category": "audio",
      "mode": "async",
      "icon": "Music",
      "selfHostOnly": true,
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "multiple": true,
          "label": "音频文件",
          "required": true
        },
        {
          "id": "format",
          "type": "select",
          "label": "输出格式",
          "required": true,
          "defaultValue": "mp3",
          "options": [
            {
              "label": "MP3",
              "value": "mp3"
            },
            {
              "label": "WAV",
              "value": "wav"
            },
            {
              "label": "FLAC",
              "value": "flac"
            },
            {
              "label": "AAC",
              "value": "aac"
            },
            {
              "label": "OGG",
              "value": "ogg"
            },
            {
              "label": "M4A",
              "value": "m4a"
            },
            {
              "label": "WMA",
              "value": "wma"
            },
            {
              "label": "OPUS",
              "value": "opus"
            }
          ]
        },
        {
          "id": "bitrate",
          "type": "select",
          "label": "比特率",
          "required": false,
          "defaultValue": "192k",
          "options": [
            {
              "label": "128 kbps",
              "value": "128k"
            },
            {
              "label": "192 kbps",
              "value": "192k"
            },
            {
              "label": "256 kbps",
              "value": "256k"
            },
            {
              "label": "320 kbps",
              "value": "320k"
            },
            {
              "label": "无损",
              "value": "lossless"
            }
          ]
        }
      ]
    },
  {
      "id": "audio-merge",
      "name": "音频合并",
      "description": "将多个音频文件合并拼接成一个音频文件",
      "category": "audio",
      "mode": "async",
      "icon": "Merge",
      "selfHostOnly": true,
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "multiple": true,
          "label": "音频文件（多个）",
          "required": true,
          "help": "按选择顺序合并"
        }
      ]
    },
  {
      "id": "audio-volume",
      "name": "音量调节",
      "description": "调节音频音量大小，支持自定义输出格式",
      "category": "audio",
      "mode": "async",
      "icon": "Volume2",
      "selfHostOnly": true,
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "音频文件",
          "required": true
        },
        {
          "id": "volume",
          "type": "number",
          "label": "音量倍数 (0.1-5.0)",
          "required": false,
          "defaultValue": 1,
          "min": 0.1,
          "max": 5,
          "step": 0.1,
          "help": "0.5=减半，2.0=翻倍"
        }
      ]
    },
  {
      "id": "spotify-download",
      "name": "Spotify 下载",
      "description": "从 Spotify 链接下载单曲、专辑或播放列表",
      "category": "audio",
      "mode": "async",
      "icon": "Music",
      "selfHostOnly": true,
      "disclaimer": "仅供个人使用。Spotify 内容受版权保护，下载可能不可用或音质较低。",
      "inputs": [
        {
          "id": "url",
          "type": "url",
          "label": "Spotify 链接",
          "placeholder": "https://open.spotify.com/track/...",
          "required": true
        },
        {
          "id": "format",
          "type": "select",
          "label": "格式",
          "required": true,
          "defaultValue": "mp3",
          "options": [
            {
              "label": "MP3",
              "value": "mp3"
            },
            {
              "label": "FLAC",
              "value": "flac"
            }
          ]
        }
      ]
    },
  {
      "id": "audio-reverse",
      "name": "音频倒放",
      "description": "将音频倒放播放，可自定义输出参数",
      "category": "audio",
      "mode": "async",
      "icon": "Music",
      "selfHostOnly": true,
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "音频文件",
          "required": true
        }
      ]
    },
  {
      "id": "audio-trim",
      "name": "音频裁剪",
      "description": "按时间区间裁剪音频，支持流复制与重编码两种方式",
      "category": "audio",
      "mode": "async",
      "icon": "Scissors",
      "selfHostOnly": true,
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "音频文件",
          "required": true,
          "accept": "audio/*"
        },
        {
          "id": "start",
          "type": "line",
          "label": "开始时间",
          "placeholder": "例如 00:10 或 10",
          "required": false,
          "help": "留空表示从开头开始"
        },
        {
          "id": "end",
          "type": "line",
          "label": "结束时间",
          "placeholder": "例如 01:30 或 90",
          "required": false,
          "help": "留空表示裁到结尾"
        },
        {
          "id": "mode",
          "type": "select",
          "label": "裁剪方式",
          "required": true,
          "defaultValue": "fast",
          "options": [
            { "label": "快速裁剪（不重编码）", "value": "fast" },
            { "label": "精确裁剪（重新编码）", "value": "precise" }
          ]
        }
      ]
    }
  // ─────────────────────────────────────────────  PDF 工具 (pdf)  ──────────
,
  {
      "id": "pdf-to-word",
      "name": "PDF 转 Word",
      "description": "将 PDF 转换为可编辑的 Word 文档",
      "category": "pdf",
      "mode": "async",
      "icon": "FileText",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "PDF 文件",
          "required": true
        }
      ]
    },
  {
      "id": "pdf-to-images",
      "name": "PDF 转图片",
      "description": "将 PDF 每页转换为图片（PNG/JPG）",
      "category": "pdf",
      "mode": "async",
      "clientSide": true,
      "icon": "Image",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "PDF 文件",
          "required": true
        },
        {
          "id": "format",
          "type": "select",
          "label": "输出格式",
          "required": true,
          "defaultValue": "png",
          "options": [
            {
              "label": "PNG",
              "value": "png"
            },
            {
              "label": "JPG",
              "value": "jpg"
            }
          ]
        },
        {
          "id": "dpi",
          "type": "number",
          "label": "图片清晰度 (DPI)",
          "required": false,
          "defaultValue": 150,
          "min": 72,
          "max": 300
        }
      ]
    },
  {
      "id": "pdf-compress",
      "name": "PDF 压缩",
      "description": "压缩 PDF 文件大小，优化图片质量",
      "category": "pdf",
      "mode": "async",
      "icon": "Minimize2",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "PDF 文件",
          "required": true
        },
        {
          "id": "quality",
          "type": "number",
          "label": "图片质量 (1-100)",
          "required": false,
          "defaultValue": 75,
          "min": 1,
          "max": 100
        }
      ]
    },
  {
      "id": "pdf-merge",
      "name": "PDF 合并",
      "description": "将多个 PDF 文件按顺序合并为一个",
      "category": "pdf",
      "mode": "async",
      "icon": "Merge",
      "inputs": [
        {
          "id": "files",
          "type": "file",
          "label": "PDF 文件（可多选，按顺序合并）",
          "required": true,
          "multiple": true
        }
      ]
    },
  {
      "id": "pdf-split",
      "name": "PDF 分割",
      "description": "按页码范围将 PDF 分割成多个文件",
      "category": "pdf",
      "mode": "async",
      "icon": "Split",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "PDF 文件",
          "required": true
        },
        {
          "id": "ranges",
          "type": "text",
          "label": "分割范围",
          "required": true,
          "defaultValue": "1-5,6-10",
          "placeholder": "例如: 1-3,5,7-9",
          "help": "用逗号分隔多个范围，如 1-3,5,7-9"
        }
      ]
    },
  {
      "id": "pdf-unlock",
      "name": "解锁 PDF",
      "description": "移除 PDF 的密码和权限限制",
      "category": "pdf",
      "mode": "async",
      "icon": "Unlock",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "PDF 文件",
          "required": true
        },
        {
          "id": "password",
          "type": "text",
          "label": "密码（如需要）",
          "required": false,
          "placeholder": "输入 PDF 密码"
        }
      ]
    },
  {
      "id": "pdf-encrypt",
      "name": "加密 PDF",
      "description": "为 PDF 添加密码和权限保护",
      "category": "pdf",
      "mode": "async",
      "icon": "Lock",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "PDF 文件",
          "required": true
        },
        {
          "id": "user_password",
          "type": "text",
          "label": "打开密码",
          "required": false,
          "placeholder": "设置打开 PDF 的密码"
        },
        {
          "id": "owner_password",
          "type": "text",
          "label": "管理员密码",
          "required": false,
          "placeholder": "设置权限管理密码"
        }
      ]
    },
  {
      "id": "pdf-watermark",
      "name": "添加水印",
      "description": "为 PDF 添加文字水印",
      "category": "pdf",
      "mode": "async",
      "icon": "Droplet",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "PDF 文件",
          "required": true
        },
        {
          "id": "text",
          "type": "text",
          "label": "水印文字",
          "required": true,
          "defaultValue": "CONFIDENTIAL"
        },
        {
          "id": "font_size",
          "type": "number",
          "label": "字体大小",
          "required": false,
          "defaultValue": 40,
          "min": 10,
          "max": 100
        },
        {
          "id": "opacity",
          "type": "number",
          "label": "透明度 (0-1)",
          "required": false,
          "defaultValue": 0.3,
          "min": 0.1,
          "max": 1,
          "step": 0.1
        },
        {
          "id": "rotation",
          "type": "number",
          "label": "旋转角度",
          "required": false,
          "defaultValue": 45,
          "min": 0,
          "max": 360
        }
      ]
    },
  {
      "id": "pdf-delete-pages",
      "name": "PDF 删页面",
      "description": "删除 PDF 中指定的页面",
      "category": "pdf",
      "mode": "async",
      "icon": "Trash2",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "PDF 文件",
          "required": true
        },
        {
          "id": "pages",
          "type": "text",
          "label": "要删除的页码",
          "required": true,
          "defaultValue": "1,3,5",
          "placeholder": "例如: 1,3,5-7",
          "help": "用逗号分隔，支持范围如 5-7"
        }
      ]
    },
  {
      "id": "pdf-reorder",
      "name": "PDF 改页面顺序",
      "description": "重新排列 PDF 页面的顺序",
      "category": "pdf",
      "mode": "async",
      "icon": "ArrowUpDown",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "PDF 文件",
          "required": true
        },
        {
          "id": "order",
          "type": "text",
          "label": "新的页面顺序",
          "required": true,
          "defaultValue": "3,1,2,4",
          "placeholder": "例如: 3,1,2,4",
          "help": "按新顺序列出所有页码，从1开始"
        }
      ]
    },
  {
      "id": "pdf-page-numbers",
      "name": "添加页码",
      "description": "为 PDF 添加页码，支持多种位置和样式",
      "category": "pdf",
      "mode": "async",
      "icon": "Hash",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "PDF 文件",
          "required": true
        },
        {
          "id": "position",
          "type": "select",
          "label": "页码位置",
          "required": true,
          "defaultValue": "bottom-center",
          "options": [
            {
              "label": "底部居中",
              "value": "bottom-center"
            },
            {
              "label": "底部左侧",
              "value": "bottom-left"
            },
            {
              "label": "底部右侧",
              "value": "bottom-right"
            },
            {
              "label": "顶部居中",
              "value": "top-center"
            },
            {
              "label": "顶部左侧",
              "value": "top-left"
            },
            {
              "label": "顶部右侧",
              "value": "top-right"
            }
          ]
        },
        {
          "id": "font_size",
          "type": "number",
          "label": "字体大小",
          "required": false,
          "defaultValue": 12,
          "min": 8,
          "max": 36
        },
        {
          "id": "start_from",
          "type": "number",
          "label": "起始页码",
          "required": false,
          "defaultValue": 1,
          "min": 1
        }
      ]
    },
  {
      "id": "pdf-rotate",
      "name": "PDF 旋转",
      "description": "旋转 PDF 页面，支持顺时针、逆时针、180度",
      "category": "pdf",
      "mode": "async",
      "icon": "RotateCw",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "PDF 文件",
          "required": true
        },
        {
          "id": "rotation",
          "type": "select",
          "label": "旋转角度",
          "required": true,
          "defaultValue": "90",
          "options": [
            {
              "label": "顺时针 90°",
              "value": "90"
            },
            {
              "label": "180° 翻转",
              "value": "180"
            },
            {
              "label": "逆时针 90°",
              "value": "270"
            }
          ]
        },
        {
          "id": "pages",
          "type": "text",
          "label": "页面范围",
          "required": false,
          "defaultValue": "all",
          "placeholder": "all 或 1,3,5-7",
          "help": "all=所有页面，或指定页码如 1,3,5-7"
        }
      ]
    },
  {
      "id": "pdf-extract-images",
      "name": "提取图片",
      "description": "从 PDF 中提取所有嵌入的图片",
      "category": "pdf",
      "mode": "async",
      "icon": "Image",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "PDF 文件",
          "required": true
        }
      ]
    },
  {
      "id": "word-to-pdf",
      "name": "Word 转 PDF",
      "description": "将 Word 文档转换为 PDF",
      "category": "pdf",
      "mode": "async",
      "icon": "FileText",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "Word 文件 (.docx/.doc)",
          "required": true
        }
      ]
    },
  {
      "id": "excel-to-pdf",
      "name": "Excel 转 PDF",
      "description": "将 Excel 表格转换为 PDF",
      "category": "pdf",
      "mode": "async",
      "icon": "Table",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "Excel 文件 (.xlsx/.xls)",
          "required": true
        }
      ]
    },
  {
      "id": "ppt-to-pdf",
      "name": "PPT 转 PDF",
      "description": "将 PowerPoint 演示文稿转换为 PDF",
      "category": "pdf",
      "mode": "async",
      "icon": "Presentation",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "PPT 文件 (.pptx/.ppt)",
          "required": true
        }
      ]
    },
  {
      "id": "pdf-to-excel",
      "name": "PDF 转 Excel",
      "description": "将 PDF 中的表格转换为 Excel",
      "category": "pdf",
      "mode": "async",
      "icon": "Table",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "PDF 文件",
          "required": true
        }
      ]
    },
  {
      "id": "pdf-to-ppt",
      "name": "PDF 转 PPT",
      "description": "将 PDF 每页转为 PPT 幻灯片",
      "category": "pdf",
      "mode": "async",
      "icon": "Presentation",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "PDF 文件",
          "required": true
        },
        {
          "id": "dpi",
          "type": "number",
          "label": "图片清晰度 (DPI)",
          "required": false,
          "defaultValue": 150,
          "min": 72,
          "max": 300
        }
      ]
    }
  // ─────────────────────────────────────────────  文本工具 (text)  ──────────
,
  {
      "id": "word-count",
      "name": "字数统计",
      "description": "快速统计文本字数、字符数、段落数、行数等信息",
      "category": "text",
      "mode": "sync",
      "icon": "Type",
      "clientSide": true,
      "inputs": [
        {
          "id": "text",
          "type": "text",
          "label": "文本内容",
          "required": true
        }
      ]
    },
  {
      "id": "text-replace",
      "name": "文本替换工具",
      "description": "支持普通文本替换和正则表达式替换，支持区分大小写",
      "category": "text",
      "mode": "sync",
      "icon": "Replace",
      "clientSide": true,
      "inputs": [
        {
          "id": "text",
          "type": "text",
          "label": "原文本",
          "required": true
        },
        {
          "id": "find",
          "type": "text",
          "label": "查找内容",
          "required": true
        },
        {
          "id": "replace",
          "type": "text",
          "label": "替换为",
          "required": false,
          "defaultValue": ""
        }
      ]
    },
  {
      "id": "text-compare",
      "name": "文本对比工具",
      "description": "对比两段文本，高亮显示差异",
      "category": "text",
      "mode": "sync",
      "icon": "GitCompare",
      "clientSide": true,
      "inputs": [
        {
          "id": "text1",
          "type": "text",
          "label": "文本1",
          "required": true
        },
        {
          "id": "text2",
          "type": "text",
          "label": "文本2",
          "required": true
        }
      ]
    },
  {
      "id": "translator",
      "name": "多语言翻译",
      "description": "中英日韩法德俄西等常用语言互译，可自动识别源语言，也支持对接自建的翻译接口",
      "category": "text",
      "mode": "sync",
      "icon": "Languages",
      "clientSide": true,
      "inputs": []
    },
  {
      "id": "markdown-preview",
      "name": "Markdown 预览",
      "description": "编写 Markdown 并实时查看渲染效果，左右分屏显示",
      "category": "text",
      "mode": "sync",
      "icon": "FileCode",
      "clientSide": true,
      "inputs": [
        {
          "id": "markdown",
          "type": "text",
          "label": "Markdown 内容",
          "required": true
        }
      ]
    },
  {
      "id": "text-dedup",
      "name": "文本去重",
      "description": "去除重复行，支持保留顺序或排序，实时显示统计信息",
      "category": "text",
      "mode": "sync",
      "icon": "Filter",
      "clientSide": true,
      "inputs": [
        {
          "id": "text",
          "type": "text",
          "label": "文本内容（每行一条）",
          "required": true
        }
      ]
    },
  {
      "id": "case-converter",
      "name": "大小写转换",
      "description": "文本大小写转换，支持全部大写、全部小写、首字母大写、大小写反转",
      "category": "text",
      "mode": "sync",
      "icon": "Type",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "chinese-converter",
      "name": "繁简转换",
      "description": "简体中文和繁体中文互相转换",
      "category": "text",
      "mode": "sync",
      "clientSide": true,
      "icon": "Languages",
      "inputs": []
    },
  {
      "id": "pinyin-converter",
      "name": "拼音转换工具",
      "description": "汉字转拼音，支持声调显示",
      "category": "text",
      "mode": "sync",
      "icon": "Languages",
      "clientSide": true,
      "inputs": [
        {
          "id": "text",
          "type": "text",
          "label": "汉字",
          "required": true,
          "defaultValue": "你好世界"
        }
      ]
    },
  {
      "id": "fullwidth-halfwidth",
      "name": "全角半角转换",
      "description": "全角和半角字符相互转换",
      "category": "text",
      "mode": "sync",
      "icon": "ALargeSmall",
      "clientSide": true,
      "inputs": [
        {
          "id": "text",
          "type": "text",
          "label": "文本内容",
          "required": true
        },
        {
          "id": "mode",
          "type": "select",
          "label": "转换方向",
          "required": true,
          "defaultValue": "toHalf",
          "options": [
            {
              "label": "全角→半角",
              "value": "toHalf"
            },
            {
              "label": "半角→全角",
              "value": "toFull"
            }
          ]
        }
      ]
    },
  {
      "id": "special-symbols",
      "name": "特殊符号大全",
      "description": "常用特殊符号、表情符号、箭头符号等",
      "category": "text",
      "mode": "sync",
      "icon": "Smile",
      "clientSide": true,
      "inputs": []
    },
  {
      "id": "markdown-to-pdf",
      "name": "Markdown 转 PDF",
      "description": "把 Markdown 排版成 PDF 文档，支持中文标题、列表、引用与代码块",
      "category": "text",
      "mode": "async",
      "icon": "FileText",
      "selfHostOnly": true,
      "inputs": [
        {
          "id": "text",
          "type": "text",
          "label": "Markdown 内容",
          "required": false,
          "help": "直接在编辑器里写 Markdown，或上传 .md 文件"
        },
        {
          "id": "file",
          "type": "file",
          "label": "Markdown 文件",
          "required": false,
          "accept": ".md,.markdown,.txt"
        },
        {
          "id": "page_size",
          "type": "select",
          "label": "纸张大小",
          "required": false,
          "defaultValue": "a4",
          "options": [
            { "label": "A4", "value": "a4" },
            { "label": "Letter", "value": "letter" }
          ]
        },
        {
          "id": "font_size",
          "type": "select",
          "label": "正文字号",
          "required": false,
          "defaultValue": "15",
          "options": [
            { "label": "13", "value": "13" },
            { "label": "15", "value": "15" },
            { "label": "17", "value": "17" },
            { "label": "19", "value": "19" }
          ]
        }
      ]
    },
  {
      "id": "ascii-art",
      "name": "ASCII 艺术字",
      "description": "把文字拼成大字符画，14 种字体风格可选，中英文混排；也能把图片转成字符画",
      "category": "text",
      "mode": "sync",
      "icon": "ALargeSmall",
      "clientSide": true,
      "inputs": []
    },
  {
      "id": "fancy-text",
      "name": "花体文字转换",
      "description": "将普通文字转换为各种花体字体样式",
      "category": "text",
      "mode": "sync",
      "icon": "Type",
      "clientSide": true,
      "inputs": [
        {
          "id": "text",
          "type": "text",
          "label": "输入文字",
          "required": true,
          "defaultValue": "Hello World"
        }
      ]
    }
  // ─────────────────────────────────────────────  数理工具 (mathcalc)  ──────────
,
  {
      "id": "simple-calculator",
      "name": "全功能科学计算器",
      "description": "支持标准日常、科学函数、程序员多进制位运算与交互式点阵计算",
      "category": "mathcalc",
      "mode": "sync",
      "icon": "Calculator",
      "subcategory": "math",
      "clientSide": true,
      "inputs": [
        {
          "id": "expression",
          "type": "text",
          "label": "表达式",
          "required": false,
          "placeholder": "例如：1+2*3"
        }
      ]
    },
  {
      "id": "function-graph",
      "name": "函数图像",
      "description": "二维与三维函数绘图，支持显函数、隐函数、参数方程、极坐标与曲面渲染，可缩放平移并分析零点、极值、导数与积分",
      "category": "mathcalc",
      "mode": "sync",
      "icon": "LineChart",
      "subcategory": "math",
      "clientSide": true,
      "inputs": []
    },
  {
      "id": "advanced-math",
      "name": "高等数学运算",
      "description": "符号求导、极限、积分、级数、微分方程与线性代数运算，给出分步过程与数值佐证",
      "category": "mathcalc",
      "mode": "sync",
      "icon": "Sigma",
      "subcategory": "math",
      "clientSide": true,
      "inputs": []
    },
  {
      "id": "geometry-calculator",
      "name": "几何计算器",
      "description": "平面图形、立体图形与坐标几何的面积、周长、体积、表面积与角度计算，支持多种已知条件",
      "category": "mathcalc",
      "mode": "sync",
      "icon": "Shapes",
      "subcategory": "math",
      "clientSide": true,
      "inputs": []
    },
  {
      "id": "func-calc",
      "name": "函数计算器",
      "description": "外贸进出口单价、人带料核算、复利金融工程与自定义函数动态公式计算",
      "category": "mathcalc",
      "mode": "sync",
      "icon": "FunctionSquare",
      "subcategory": "math",
      "clientSide": true,
      "inputs": []
    },
  {
      "id": "unit-converter",
      "name": "单位换算",
      "description": "长度、面积、体积、质量、温度、时间、速度、压力、能量、功率、数据存储等 28 类共 360 多个单位互转",
      "category": "mathcalc",
      "mode": "sync",
      "icon": "Ruler",
      "subcategory": "calc",
      "clientSide": true,
      "inputs": []
    },
  {
      "id": "tax-calculator",
      "name": "综合税金税率计算器",
      "description": "囊括个人所得税、增值税、企业所得税、附加税、印花税、消费税与进出口退税",
      "category": "mathcalc",
      "mode": "sync",
      "icon": "Receipt",
      "subcategory": "calc",
      "clientSide": true,
      "inputs": []
    },
  {
      "id": "loan-calculator",
      "name": "贷款计算器",
      "description": "计算等额本息/等额本金还款方式下的月供、总利息等信息",
      "category": "mathcalc",
      "mode": "sync",
      "icon": "Calculator",
      "subcategory": "calc",
      "clientSide": true,
      "inputs": [
        {
          "id": "amount",
          "type": "number",
          "label": "贷款金额（万元）",
          "required": true,
          "defaultValue": "100"
        },
        {
          "id": "years",
          "type": "number",
          "label": "贷款年限（年）",
          "required": true,
          "defaultValue": "30"
        },
        {
          "id": "rate",
          "type": "number",
          "label": "年利率（%）",
          "required": true,
          "defaultValue": "4.2"
        },
        {
          "id": "method",
          "type": "select",
          "label": "还款方式",
          "required": true,
          "defaultValue": "equal",
          "options": [
            {
              "label": "等额本息",
              "value": "equal"
            },
            {
              "label": "等额本金",
              "value": "principal"
            }
          ]
        }
      ]
    },
  {
      "id": "exchange-rate",
      "name": "汇率换算器",
      "description": "主要货币汇率换算（固定汇率参考）",
      "category": "mathcalc",
      "mode": "sync",
      "icon": "TrendingUp",
      "subcategory": "calc",
      "clientSide": true,
      "inputs": [
        {
          "id": "amount",
          "type": "number",
          "label": "金额",
          "required": true,
          "defaultValue": "100"
        },
        {
          "id": "from",
          "type": "select",
          "label": "原货币",
          "required": true,
          "defaultValue": "CNY",
          "options": [
            {
              "label": "人民币 CNY",
              "value": "CNY"
            },
            {
              "label": "美元 USD",
              "value": "USD"
            },
            {
              "label": "欧元 EUR",
              "value": "EUR"
            },
            {
              "label": "日元 JPY",
              "value": "JPY"
            },
            {
              "label": "英镑 GBP",
              "value": "GBP"
            },
            {
              "label": "港币 HKD",
              "value": "HKD"
            }
          ]
        },
        {
          "id": "to",
          "type": "select",
          "label": "目标货币",
          "required": true,
          "defaultValue": "USD",
          "options": [
            {
              "label": "人民币 CNY",
              "value": "CNY"
            },
            {
              "label": "美元 USD",
              "value": "USD"
            },
            {
              "label": "欧元 EUR",
              "value": "EUR"
            },
            {
              "label": "日元 JPY",
              "value": "JPY"
            },
            {
              "label": "英镑 GBP",
              "value": "GBP"
            },
            {
              "label": "港币 HKD",
              "value": "HKD"
            }
          ]
        }
      ]
    },
  {
      "id": "trade-calculator",
      "name": "进出口贸易计算台",
      "description": "含税与不含税单价互转、出口成本与利润、FOB/CFR/CIF 报价换算、进口环节税与运费分摊",
      "category": "mathcalc",
      "mode": "sync",
      "icon": "Globe",
      "subcategory": "calc",
      "clientSide": true,
      "inputs": []
    },
  {
      "id": "credit-card-calculator",
      "name": "信用卡分期计算器",
      "description": "计算信用卡分期的实际利率和总费用",
      "category": "mathcalc",
      "mode": "sync",
      "icon": "CreditCard",
      "subcategory": "calc",
      "clientSide": true,
      "inputs": [
        {
          "id": "amount",
          "type": "number",
          "label": "分期金额（元）",
          "required": true,
          "defaultValue": "10000"
        },
        {
          "id": "periods",
          "type": "number",
          "label": "分期期数",
          "required": true,
          "defaultValue": "12"
        },
        {
          "id": "feeRate",
          "type": "number",
          "label": "手续费率（%）",
          "required": true,
          "defaultValue": "7.2"
        }
      ]
    },
  {
      "id": "date-calculator",
      "name": "日期计算器",
      "description": "支持日期差计算、日期加减、年龄计算",
      "category": "mathcalc",
      "mode": "sync",
      "icon": "Calendar",
      "subcategory": "calc",
      "clientSide": true,
      "inputs": [
        {
          "id": "date1",
          "type": "text",
          "label": "开始日期",
          "required": true,
          "placeholder": "YYYY-MM-DD"
        },
        {
          "id": "date2",
          "type": "text",
          "label": "结束日期",
          "required": false,
          "placeholder": "YYYY-MM-DD（留空则计算日期加减）"
        },
        {
          "id": "days",
          "type": "number",
          "label": "加减天数",
          "required": false,
          "defaultValue": "0"
        }
      ]
    },
  {
      "id": "lunar-calendar",
      "name": "公历农历转换器",
      "description": "公历农历双向转换，提供详细农历信息",
      "category": "mathcalc",
      "mode": "sync",
      "icon": "Moon",
      "subcategory": "calc",
      "clientSide": true,
      "inputs": [
        {
          "id": "date",
          "type": "text",
          "label": "公历日期",
          "required": true,
          "placeholder": "YYYY-MM-DD"
        }
      ]
    },
  {
      "id": "date-converter",
      "name": "日期转换",
      "description": "时间戳与日期时间互相转换",
      "category": "mathcalc",
      "mode": "sync",
      "icon": "Calendar",
      "subcategory": "calc",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "base-converter",
      "name": "进制转换器",
      "description": "支持二进制、八进制、十进制、十六进制互转",
      "category": "mathcalc",
      "mode": "sync",
      "icon": "Binary",
      "subcategory": "calc",
      "clientSide": true,
      "inputs": [
        {
          "id": "value",
          "type": "text",
          "label": "输入数值",
          "required": true,
          "placeholder": "输入要转换的数值"
        },
        {
          "id": "from",
          "type": "select",
          "label": "原进制",
          "required": true,
          "defaultValue": "10",
          "options": [
            {
              "label": "二进制",
              "value": "2"
            },
            {
              "label": "八进制",
              "value": "8"
            },
            {
              "label": "十进制",
              "value": "10"
            },
            {
              "label": "十六进制",
              "value": "16"
            }
          ]
        }
      ]
    },
  {
      "id": "random-number",
      "name": "随机数生成器",
      "description": "生成指定范围内的随机数，支持批量生成",
      "category": "mathcalc",
      "mode": "sync",
      "icon": "Dices",
      "subcategory": "calc",
      "clientSide": true,
      "inputs": [
        {
          "id": "min",
          "type": "number",
          "label": "最小值",
          "required": true,
          "defaultValue": "1"
        },
        {
          "id": "max",
          "type": "number",
          "label": "最大值",
          "required": true,
          "defaultValue": "100"
        },
        {
          "id": "count",
          "type": "number",
          "label": "生成数量",
          "required": true,
          "defaultValue": "5"
        }
      ]
    },
  {
      "id": "roman-numeral",
      "name": "罗马数字转换器",
      "description": "罗马数字与阿拉伯数字双向转换",
      "category": "mathcalc",
      "mode": "sync",
      "icon": "Pilcrow",
      "subcategory": "calc",
      "clientSide": true,
      "inputs": [
        {
          "id": "value",
          "type": "text",
          "label": "输入（数字或罗马数字）",
          "required": true,
          "placeholder": "例如：2024 或 MMXXIV"
        }
      ]
    },
  {
      "id": "number-english",
      "name": "数字英文转换",
      "description": "数字与英文单词双向转换",
      "category": "mathcalc",
      "mode": "sync",
      "icon": "ALargeSmall",
      "subcategory": "calc",
      "clientSide": true,
      "inputs": [
        {
          "id": "number",
          "type": "number",
          "label": "数字",
          "required": true,
          "defaultValue": "1234"
        }
      ]
    },
  {
      "id": "rmb-uppercase",
      "name": "人民币大写转换",
      "description": "将数字金额转换为人民币大写形式，支持批量转换",
      "category": "mathcalc",
      "mode": "sync",
      "icon": "Banknote",
      "subcategory": "calc",
      "clientSide": true,
      "inputs": [
        {
          "id": "amount",
          "type": "text",
          "label": "金额（数字）",
          "placeholder": "例如：1234.56",
          "required": true
        }
      ]
    },
  {
      "id": "english-amount-uppercase",
      "name": "英文金额大写转换",
      "description": "将数字金额转换为英文大写形式",
      "category": "mathcalc",
      "mode": "sync",
      "icon": "Type",
      "subcategory": "calc",
      "clientSide": true,
      "inputs": [
        {
          "id": "amount",
          "type": "number",
          "label": "金额",
          "required": true,
          "defaultValue": "1234.56"
        }
      ]
    }
  // ─────────────────────────────────────────────  开发工具 (dev)  ──────────
,
  {
      "id": "json-formatter",
      "name": "JSON 格式化",
      "description": "验证、美化或压缩 JSON 数据，瞬间在浏览器中完成",
      "category": "dev",
      "mode": "sync",
      "icon": "Braces",
      "clientSide": true,
      "inputs": [
        {
          "id": "json",
          "type": "text",
          "label": "JSON 输入",
          "required": true
        }
      ]
    },
  {
      "id": "regex-tester",
      "name": "正则测试",
      "description": "用示例文本测试正则表达式，实时高亮匹配结果",
      "category": "dev",
      "mode": "sync",
      "icon": "Regex",
      "clientSide": true,
      "inputs": [
        {
          "id": "pattern",
          "type": "text",
          "label": "正则表达式",
          "required": true
        }
      ]
    },
  {
      "id": "timestamp-converter",
      "name": "时间戳转换器",
      "description": "时间戳与日期时间相互转换，支持秒和毫秒",
      "category": "dev",
      "mode": "sync",
      "icon": "Clock",
      "clientSide": true,
      "inputs": [
        {
          "id": "value",
          "type": "text",
          "label": "时间戳或日期",
          "required": true,
          "placeholder": "时间戳（秒/毫秒）或日期时间"
        },
        {
          "id": "unit",
          "type": "select",
          "label": "时间戳单位",
          "required": true,
          "defaultValue": "s",
          "options": [
            {
              "label": "秒",
              "value": "s"
            },
            {
              "label": "毫秒",
              "value": "ms"
            }
          ]
        }
      ]
    },
  {
      "id": "js-formatter",
      "name": "JavaScript 格式化",
      "description": "格式化 JavaScript 代码，自动缩进和换行",
      "category": "dev",
      "mode": "sync",
      "icon": "Code",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "html-formatter",
      "name": "HTML 格式化",
      "description": "格式化 HTML 代码，自动缩进和换行",
      "category": "dev",
      "mode": "sync",
      "icon": "FileCode",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "css-format",
      "name": "CSS 格式化与压缩",
      "description": "格式化或压缩 CSS 代码，支持嵌套规则、注释保留与体积对比",
      "category": "dev",
      "mode": "sync",
      "icon": "Braces",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "sql-format",
      "name": "SQL 格式化",
      "description": "按子句重新排版 SQL 语句，支持关键字大小写与语法高亮",
      "category": "dev",
      "mode": "sync",
      "icon": "Table",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "code-minify",
      "name": "代码压缩",
      "description": "压缩 HTML、CSS 与 JavaScript 代码，去掉注释与多余空白并显示节省比例",
      "category": "dev",
      "mode": "sync",
      "icon": "Minimize2",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "jwt-decode",
      "name": "JWT 解析",
      "description": "查看 JSON Web Token 的头部和载荷内容，无需密钥",
      "category": "dev",
      "mode": "sync",
      "icon": "KeyRound",
      "clientSide": true,
      "inputs": [
        {
          "id": "token",
          "type": "text",
          "label": "JWT 令牌",
          "required": true
        }
      ]
    },
  {
      "id": "json-csv",
      "name": "JSON ↔ CSV",
      "description": "JSON 数组与 CSV 表格双向互转，自动识别分隔符，支持表格预览",
      "category": "dev",
      "mode": "sync",
      "icon": "Table",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "json-yaml",
      "name": "JSON ↔ YAML",
      "description": "JSON 与 YAML 双向互转，自动识别输入格式，出错时定位到具体行",
      "category": "dev",
      "mode": "sync",
      "icon": "ArrowLeftRight",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "json-xml",
      "name": "JSON ↔ XML",
      "description": "JSON 与 XML 双向互转，自动识别输入格式，并说明两种格式的映射规则",
      "category": "dev",
      "mode": "sync",
      "icon": "FileCode",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "csv-excel",
      "name": "CSV ↔ Excel",
      "description": "CSV 与 Excel 表格双向转换，生成可直接用于求和排序的真 .xlsx 文件",
      "category": "dev",
      "mode": "async",
      "icon": "Table",
      "selfHostOnly": true,
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "表格文件",
          "required": true,
          "accept": ".csv,.xlsx,.xlsm"
        },
        {
          "id": "direction",
          "type": "select",
          "label": "转换方向",
          "required": true,
          "defaultValue": "auto",
          "options": [
            { "label": "自动识别", "value": "auto" },
            { "label": "CSV → Excel（.xlsx）", "value": "to-xlsx" },
            { "label": "Excel → CSV", "value": "to-csv" }
          ]
        },
        {
          "id": "delimiter",
          "type": "select",
          "label": "CSV 分隔符",
          "required": false,
          "defaultValue": "auto",
          "options": [
            { "label": "自动识别", "value": "auto" },
            { "label": "逗号", "value": "," },
            { "label": "分号", "value": ";" },
            { "label": "制表符", "value": "\t" },
            { "label": "竖线", "value": "|" }
          ]
        },
        {
          "id": "has_header",
          "type": "select",
          "label": "首行是否为表头",
          "required": false,
          "defaultValue": "true",
          "options": [
            { "label": "是（首行作表头）", "value": "true" },
            { "label": "否（首行是数据）", "value": "false" }
          ]
        },
        {
          "id": "sheet",
          "type": "line",
          "label": "工作表名称",
          "placeholder": "留空表示第一个工作表",
          "required": false,
          "help": "仅从 Excel 转 CSV 时有效"
        }
      ]
    },
  {
      "id": "json-schema-validate",
      "name": "JSON Schema 校验",
      "description": "按 JSON Schema 校验数据，逐条列出不符合约束的字段路径与原因",
      "category": "dev",
      "mode": "sync",
      "icon": "Filter",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "json-to-ts",
      "name": "JSON 转 TS 类型",
      "description": "JSON 转 TypeScript Interface，支持嵌套",
      "category": "dev",
      "mode": "sync",
      "icon": "Braces",
      "clientSide": true,
      "inputs": [
        {
          "id": "json",
          "type": "text",
          "label": "JSON",
          "required": true,
          "defaultValue": "{\"name\":\"test\",\"age\":18}"
        }
      ]
    },
  {
      "id": "file-hex",
      "name": "文件 HEX 值计算",
      "description": "计算文件的 MD5、SHA1、SHA256 哈希值",
      "category": "dev",
      "mode": "sync",
      "icon": "FileDigit",
      "clientSide": true,
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "文件",
          "required": true
        }
      ]
    },
  {
      "id": "image-base64",
      "name": "图片 Base64 转换",
      "description": "图片与 Base64 字符串相互转换",
      "category": "dev",
      "mode": "sync",
      "icon": "Image",
      "clientSide": true,
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "图片文件",
          "required": true,
          "accept": "image/*"
        }
      ]
    },
  {
      "id": "http-status",
      "name": "HTTP 状态查询",
      "description": "查询 HTTP 状态码的含义和分类",
      "category": "dev",
      "mode": "sync",
      "icon": "Server",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "crontab-generator",
      "name": "Crontab 生成器",
      "description": "可视化配置 Crontab 表达式，支持人类可读解释",
      "category": "dev",
      "mode": "sync",
      "icon": "Clock",
      "clientSide": true,
      "inputs": [
        {
          "id": "minute",
          "type": "text",
          "label": "分钟",
          "required": true,
          "defaultValue": "*"
        },
        {
          "id": "hour",
          "type": "text",
          "label": "小时",
          "required": true,
          "defaultValue": "*"
        },
        {
          "id": "day",
          "type": "text",
          "label": "日",
          "required": true,
          "defaultValue": "*"
        },
        {
          "id": "month",
          "type": "text",
          "label": "月",
          "required": true,
          "defaultValue": "*"
        },
        {
          "id": "weekday",
          "type": "text",
          "label": "星期",
          "required": true,
          "defaultValue": "*"
        }
      ]
    },
  {
      "id": "css-gradient",
      "name": "CSS 渐变生成器",
      "description": "生成 CSS 渐变代码及其 Tailwind 写法，支持线性、径向与锥形渐变",
      "category": "dev",
      "mode": "sync",
      "icon": "Palette",
      "inputs": [
        {
          "id": "color1",
          "type": "color",
          "label": "起始颜色",
          "required": true,
          "defaultValue": "#6366f1"
        },
        {
          "id": "color2",
          "type": "color",
          "label": "结束颜色",
          "required": true,
          "defaultValue": "#ec4899"
        },
        {
          "id": "type",
          "type": "select",
          "label": "渐变类型",
          "required": true,
          "defaultValue": "linear",
          "options": [
            { "label": "线性渐变（linear）", "value": "linear" },
            { "label": "径向渐变（radial）", "value": "radial" },
            { "label": "锥形渐变（conic）", "value": "conic" }
          ]
        },
        {
          "id": "direction",
          "type": "select",
          "label": "方向（仅线性渐变有效）",
          "required": false,
          "defaultValue": "to right",
          "options": [
            { "label": "从左到右", "value": "to right" },
            { "label": "从上到下", "value": "to bottom" },
            { "label": "左上到右下", "value": "to bottom right" },
            { "label": "45 度", "value": "45deg" },
            { "label": "135 度", "value": "135deg" }
          ]
        }
      ]
    },
  {
      "id": "lorem-gen",
      "name": "Lorem 占位文本",
      "description": "生成排版测试用的占位文字，支持段落、句子与单词三种长度",
      "category": "dev",
      "mode": "sync",
      "icon": "Pilcrow",
      "inputs": [
        {
          "id": "type",
          "type": "select",
          "label": "生成类型",
          "required": true,
          "defaultValue": "paragraph",
          "options": [
            { "label": "段落", "value": "paragraph" },
            { "label": "句子", "value": "sentence" },
            { "label": "单词", "value": "word" }
          ]
        },
        {
          "id": "count",
          "type": "number",
          "label": "数量",
          "required": true,
          "defaultValue": 3,
          "min": 1,
          "max": 20,
          "help": "生成几个段落 / 句子 / 单词（1~20）"
        }
      ]
    },
  {
      "id": "dns-lookup",
      "name": "DNS 查询",
      "description": "查询域名的 A、AAAA、CNAME、MX、NS、TXT 记录，用于排查域名解析与邮件配置问题",
      "category": "dev",
      "mode": "sync",
      "icon": "Globe",
      "inputs": [
        {
          "id": "domain",
          "type": "line",
          "label": "域名",
          "placeholder": "例如 example.com",
          "required": true,
          "help": "不需要带 http:// 前缀，直接填域名即可"
        }
      ]
    },
  {
      "id": "ssl-checker",
      "name": "SSL 证书检查",
      "description": "读取网站 HTTPS 证书的颁发者、有效期与信任状态，用于排查证书过期或配置错误",
      "category": "dev",
      "mode": "sync",
      "icon": "Shield",
      "inputs": [
        {
          "id": "domain",
          "type": "line",
          "label": "域名",
          "placeholder": "例如 www.baidu.com",
          "required": true,
          "help": "通过该域名的 443 端口读取证书"
        }
      ]
    },
  {
      "id": "speed-test",
      "name": "网速测试",
      "description": "测试网络下载和上传速度，延迟和抖动",
      "category": "dev",
      "mode": "sync",
      "clientSide": true,
      "icon": "Wifi",
      "inputs": []
    },
  {
      "id": "ip-converter",
      "name": "IP 转换",
      "description": "IP 地址与数字互相转换",
      "category": "dev",
      "mode": "sync",
      "icon": "Globe",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "url-parser",
      "name": "URL 解析",
      "description": "解析网址的协议、主机、端口、路径与查询参数，并给出各组成部分的编码结果",
      "category": "dev",
      "mode": "sync",
      "icon": "Link2",
      "inputs": [
        {
          "id": "url",
          "type": "line",
          "label": "网址",
          "placeholder": "https://example.com/path?a=1&b=中文#top",
          "required": true
        }
      ]
    },
  {
      "id": "user-agent-analyzer",
      "name": "User Agent 分析器",
      "description": "解析浏览器、内核、系统、设备类型",
      "category": "dev",
      "mode": "sync",
      "icon": "Monitor",
      "clientSide": true,
      "inputs": [
        {
          "id": "ua",
          "type": "text",
          "label": "User Agent",
          "required": true,
          "defaultValue": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        }
      ]
    }
  // ─────────────────────────────────────────────  编码安全 (security)  ──────────
,
  {
      "id": "base64",
      "name": "Base64 编码/解码",
      "description": "将文本编码为 Base64 或解码还原，支持完整 Unicode",
      "category": "security",
      "mode": "sync",
      "icon": "Binary",
      "clientSide": true,
      "inputs": [
        {
          "id": "text",
          "type": "text",
          "label": "文本",
          "required": true
        }
      ]
    },
  {
      "id": "url-encode",
      "name": "URL 编码/解码",
      "description": "对 URL 和查询字符串进行百分号编码或解码，瞬间完成",
      "category": "security",
      "mode": "sync",
      "icon": "Link2",
      "clientSide": true,
      "inputs": [
        {
          "id": "text",
          "type": "text",
          "label": "文本",
          "required": true
        }
      ]
    },
  {
      "id": "hash-generator",
      "name": "哈希计算",
      "description": "计算 MD5、SHA-1、SHA-256、SHA-512 哈希值",
      "category": "security",
      "mode": "sync",
      "icon": "Hash",
      "inputs": [
        {
          "id": "text",
          "type": "text",
          "label": "输入文本",
          "required": true
        },
        {
          "id": "algorithm",
          "type": "select",
          "label": "算法",
          "required": true,
          "defaultValue": "sha256",
          "options": [
            {
              "label": "SHA-256",
              "value": "sha256"
            },
            {
              "label": "SHA-1",
              "value": "sha1"
            },
            {
              "label": "SHA-512",
              "value": "sha512"
            },
            {
              "label": "MD5",
              "value": "md5"
            }
          ]
        }
      ]
    },
  {
      "id": "sha-hash",
      "name": "SHA 哈希工具",
      "description": "SHA1、SHA256、SHA384、SHA512 哈希计算",
      "category": "security",
      "mode": "sync",
      "icon": "Hash",
      "clientSide": true,
      "inputs": [
        {
          "id": "text",
          "type": "text",
          "label": "输入文本",
          "required": true
        }
      ]
    },
  {
      "id": "aes-encrypt",
      "name": "AES 加密解密",
      "description": "在线进行 AES 加密和解密操作，支持多种模式",
      "category": "security",
      "mode": "sync",
      "icon": "Lock",
      "clientSide": true,
      "inputs": [
        {
          "id": "text",
          "type": "text",
          "label": "输入内容",
          "required": true
        },
        {
          "id": "key",
          "type": "text",
          "label": "密钥",
          "required": true,
          "defaultValue": "1234567890123456"
        },
        {
          "id": "mode",
          "type": "select",
          "label": "模式",
          "required": true,
          "defaultValue": "encrypt",
          "options": [
            {
              "label": "加密",
              "value": "encrypt"
            },
            {
              "label": "解密",
              "value": "decrypt"
            }
          ]
        }
      ]
    },
  {
      "id": "crc-checksum",
      "name": "CRC 校验工具",
      "description": "计算文本的 CRC32 校验值",
      "category": "security",
      "mode": "sync",
      "icon": "Hash",
      "clientSide": true,
      "inputs": [
        {
          "id": "text",
          "type": "text",
          "label": "输入文本",
          "required": true
        }
      ]
    },
  {
      "id": "unicode-converter",
      "name": "Unicode 编码转换",
      "description": "Unicode 与中文相互转换",
      "category": "security",
      "mode": "sync",
      "icon": "Code",
      "clientSide": true,
      "inputs": [
        {
          "id": "text",
          "type": "text",
          "label": "输入内容",
          "required": true
        },
        {
          "id": "mode",
          "type": "select",
          "label": "模式",
          "required": true,
          "defaultValue": "encode",
          "options": [
            {
              "label": "中文→Unicode",
              "value": "encode"
            },
            {
              "label": "Unicode→中文",
              "value": "decode"
            }
          ]
        }
      ]
    },
  {
      "id": "password-generator",
      "name": "随机密码生成",
      "description": "生成包含大小写字母、数字、特殊符号的随机密码",
      "category": "security",
      "mode": "sync",
      "icon": "Key",
      "clientSide": true,
      "inputs": [
        {
          "id": "length",
          "type": "number",
          "label": "密码长度",
          "required": true,
          "defaultValue": "16"
        },
        {
          "id": "count",
          "type": "number",
          "label": "生成数量",
          "required": true,
          "defaultValue": "5"
        }
      ]
    },
  {
      "id": "uuid-generator",
      "name": "UUID 生成器",
      "description": "批量生成全局唯一标识符 UUID，支持多种格式",
      "category": "security",
      "mode": "sync",
      "icon": "Fingerprint",
      "clientSide": true,
      "inputs": [
        {
          "id": "count",
          "type": "number",
          "label": "生成数量",
          "required": true,
          "defaultValue": "5"
        }
      ]
    },
  {
      "id": "guid-generator",
      "name": "GUID 生成工具",
      "description": "生成全局唯一标识符 GUID",
      "category": "security",
      "mode": "sync",
      "icon": "Fingerprint",
      "clientSide": true,
      "inputs": [
        {
          "id": "count",
          "type": "number",
          "label": "生成数量",
          "required": true,
          "defaultValue": "5"
        }
      ]
    },
  {
      "id": "morse-code",
      "name": "摩斯电码",
      "description": "摩斯电码和原文之间的双向转换",
      "category": "security",
      "mode": "sync",
      "icon": "Radio",
      "clientSide": true,
      "inputs": [
        {
          "id": "text",
          "type": "text",
          "label": "输入内容",
          "required": true
        },
        {
          "id": "mode",
          "type": "select",
          "label": "转换方向",
          "required": true,
          "defaultValue": "encode",
          "options": [
            {
              "label": "文本→摩斯电码",
              "value": "encode"
            },
            {
              "label": "摩斯电码→文本",
              "value": "decode"
            }
          ]
        }
      ]
    },
  {
      "id": "caesar-cipher",
      "name": "凯撒密码",
      "description": "通过字符偏移进行加密和解密的经典密码学工具",
      "category": "security",
      "mode": "sync",
      "icon": "Shield",
      "clientSide": true,
      "inputs": [
        {
          "id": "text",
          "type": "text",
          "label": "输入内容",
          "required": true
        },
        {
          "id": "shift",
          "type": "number",
          "label": "偏移量",
          "required": true,
          "defaultValue": "3"
        },
        {
          "id": "mode",
          "type": "select",
          "label": "模式",
          "required": true,
          "defaultValue": "encrypt",
          "options": [
            {
              "label": "加密",
              "value": "encrypt"
            },
            {
              "label": "解密",
              "value": "decrypt"
            }
          ]
        }
      ]
    },
  {
      "id": "archpr",
      "name": "压缩包密码恢复",
      "description": "专业级 ZIP / RAR / 7Z / ACE 密码恢复利器 (ARCHPR)，支持纯暴力破解、掩码搜索、密码字典碰撞与已知明文攻击",
      "category": "security",
      "mode": "sync",
      "clientSide": true,
      "icon": "KeyRound",
      "inputs": []
    }
  // ─────────────────────────────────────────────  生活办公 (utility)  ──────────
,
  {
      "id": "pomodoro",
      "name": "番茄钟",
      "description": "专注计时器，支持专注与休息交替、自定义时长与今日完成计数",
      "category": "utility",
      "mode": "sync",
      "icon": "Timer",
      "subcategory": "life",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "time-toolbox",
      "name": "时间管理大师",
      "description": "数字时钟、模拟时钟、倒计时、闹钟、倒数日与秒表，支持一键全屏显示",
      "category": "utility",
      "mode": "sync",
      "icon": "Clock",
      "subcategory": "life",
      "clientSide": true,
      "inputs": []
    },
  {
      "id": "qr-generator",
      "name": "二维码生成",
      "description": "从文字或链接生成二维码 PNG 图片",
      "category": "utility",
      "mode": "sync",
      "icon": "QrCode",
      "subcategory": "life",
      "inputs": [
        {
          "id": "text",
          "type": "text",
          "label": "文字或链接",
          "required": true,
          "placeholder": "https://example.com"
        },
        {
          "id": "size",
          "type": "number",
          "label": "尺寸 (像素)",
          "required": true,
          "defaultValue": 512,
          "min": 64,
          "max": 2048
        },
        {
          "id": "ecc",
          "type": "select",
          "label": "纠错等级",
          "required": true,
          "defaultValue": "M",
          "options": [
            {
              "label": "低 (L)",
              "value": "L"
            },
            {
              "label": "中 (M)",
              "value": "M"
            },
            {
              "label": "较高 (Q)",
              "value": "Q"
            },
            {
              "label": "高 (H)",
              "value": "H"
            }
          ]
        }
      ]
    },
  {
      "id": "qr-decoder",
      "name": "二维码解码器",
      "description": "识别二维码图片内容",
      "category": "utility",
      "mode": "sync",
      "icon": "ScanLine",
      "subcategory": "life",
      "clientSide": true,
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "label": "二维码图片",
          "required": true,
          "accept": "image/*"
        }
      ]
    },
  {
      "id": "lan-transfer",
      "name": "跨设备互传",
      "description": "手机电脑极速跨端快传，连接同一 Wi-Fi 或手机热点，手机免装 App 扫码即传，双向秒通",
      "category": "utility",
      "mode": "sync",
      "icon": "Share2",
      "subcategory": "life",
      "clientSide": true,
      "inputs": []
    },
  {
      "id": "batch-rename",
      "name": "批量重命名",
      "description": "批量重命名文件，支持序号、查找替换、添加前后缀、大小写转换",
      "category": "utility",
      "mode": "sync",
      "clientSide": true,
      "icon": "Edit3",
      "subcategory": "life",
      "inputs": []
    },
  {
      "id": "bmi-calculator",
      "name": "BMI 计算器",
      "description": "根据身高体重计算 BMI 指数，评估健康状况",
      "category": "utility",
      "mode": "sync",
      "icon": "Heart",
      "subcategory": "life",
      "clientSide": true,
      "inputs": [
        {
          "id": "height",
          "type": "number",
          "label": "身高（cm）",
          "required": true,
          "defaultValue": "170"
        },
        {
          "id": "weight",
          "type": "number",
          "label": "体重（kg）",
          "required": true,
          "defaultValue": "65"
        }
      ]
    },
  {
      "id": "media-tracker",
      "name": "观影追番读书记录器",
      "description": "记录看过的电影、番剧和书籍，打分写短评，统计年度影视书影回顾",
      "category": "utility",
      "mode": "sync",
      "clientSide": true,
      "icon": "BookOpen",
      "subcategory": "life",
      "inputs": []
    },
  {
      "id": "periodic-table",
      "name": "元素周期表",
      "description": "化学元素周期表，展示元素基本信息",
      "category": "utility",
      "mode": "sync",
      "icon": "Atom",
      "subcategory": "life",
      "clientSide": true,
      "inputs": []
    },
  {
      "id": "perler-beads",
      "name": "拼豆图纸",
      "description": "把图片转成拼豆图纸，输出带色号的网格图与用料清单",
      "category": "utility",
      "mode": "sync",
      "icon": "Grid3x3",
      "subcategory": "life",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "bar-chart",
      "name": "柱状图",
      "description": "根据数据生成柱状图，支持自定义数据",
      "category": "utility",
      "icon": "BarChart",
      "subcategory": "work",
      "mode": "sync",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "line-chart",
      "name": "折线图",
      "description": "根据数据生成折线图，支持自定义数据",
      "category": "utility",
      "icon": "LineChart",
      "subcategory": "work",
      "mode": "sync",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "pie-chart",
      "name": "饼图",
      "description": "根据数据生成饼图，支持自定义数据",
      "category": "utility",
      "icon": "PieChart",
      "subcategory": "work",
      "mode": "sync",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "scatter-chart",
      "name": "散点图",
      "description": "根据数据生成散点图，支持自定义数据",
      "category": "utility",
      "icon": "ChartScatter",
      "subcategory": "work",
      "mode": "sync",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "mind-map",
      "name": "思维导图",
      "description": "在线创建和编辑思维导图，支持节点编辑、拖拽、导出图片",
      "category": "utility",
      "mode": "sync",
      "clientSide": true,
      "icon": "Network",
      "subcategory": "work",
      "inputs": []
    },
  {
      "id": "word-cloud",
      "name": "文字云",
      "description": "从文本生成文字云，按词频决定字号，支持配色方案与形状遮罩，可导出 SVG 与 PNG",
      "category": "utility",
      "mode": "sync",
      "icon": "Type",
      "subcategory": "work",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "business-card",
      "name": "名片生成器",
      "description": "填写信息并选择模板，实时预览名片效果，可导出 2 倍分辨率 PNG",
      "category": "utility",
      "mode": "sync",
      "icon": "CreditCard",
      "subcategory": "work",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "signature-designer",
      "name": "艺术与电子签名",
      "description": "一笔艺术签、连笔商务签、平滑手写板与印章设计，一键导出透明电子合同签名",
      "category": "utility",
      "mode": "sync",
      "icon": "PenTool",
      "subcategory": "work",
      "clientSide": true,
      "inputs": []
    },
  {
      "id": "color-palette",
      "name": "配色灵感工具",
      "description": "输入关键词生成配色，导入图片提取配色，导出色卡",
      "category": "utility",
      "mode": "sync",
      "clientSide": true,
      "icon": "Palette",
      "subcategory": "work",
      "inputs": []
    },
  {
      "id": "color-convert",
      "name": "颜色转换",
      "description": "在 HEX、RGB、HSL 之间转换颜色，带实时预览",
      "category": "utility",
      "mode": "sync",
      "icon": "Palette",
      "subcategory": "work",
      "clientSide": true,
      "inputs": [
        {
          "id": "color",
          "type": "text",
          "label": "颜色值",
          "required": true
        }
      ]
    },
]


export function getToolById(id: string): OmniTool | undefined {
  return TOOLS.find((tool) => tool.id === id);
}

export function getToolsByCategory(category: OmniTool["category"]): OmniTool[] {
  return TOOLS.filter((tool) => tool.category === category);
}

/**
 * 下载器和 AI 去背景需要自托管 Python Worker 支持。
 * 未设置 NEXT_PUBLIC_ENABLE_DOWNLOADS=1 时这些工具会被隐藏。
 */
export function downloadsEnabled() {
  return process.env.NEXT_PUBLIC_ENABLE_DOWNLOADS === "1";
}

/**
 * Worker 端的 AI 去背景会加载约 200-400MB 的 ONNX 模型到内存，
 * 低配置服务器（如 1GB 内存）可以设置为 "0" 来隐藏此工具。
 * 浏览器端的 bg-remove-client 仍然可以正常使用。
 */
export function heavyWorkerToolsEnabled() {
  return process.env.NEXT_PUBLIC_ENABLE_HEAVY_WORKER_TOOLS !== "0";
}

export function getAvailableTools(): OmniTool[] {
  const downloads = downloadsEnabled();
  const heavy = heavyWorkerToolsEnabled();
  return TOOLS.filter((tool) => {
    if (tool.selfHostOnly && !downloads) return false;
    if (tool.heavyWorkerOnly && !heavy) return false;
    return true;
  });
}
