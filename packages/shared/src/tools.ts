import type { OmniTool } from "./types";

export const TOOLS: OmniTool[] = [
  // ─────────────────────────────────────────────  图片工具 (image)  ──────────
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
    "id": "image-upscale",
    "name": "图片强化",
    "description": "使用 Real-ESRGAN AI 模型将图片放大 2/3/4 倍，高清重绘",
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
    "id": "image-to-pdf",
    "name": "图片转 PDF",
    "description": "将一张或多张图片合并为 PDF 文件",
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
  // ─────────────────────────────────────────────  PDF 工具 (pdf)  ──────────
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
  },
  {
    "id": "images-to-pdf",
    "name": "图片转 PDF",
    "description": "将多张图片合并为 PDF 文件",
    "category": "pdf",
    "mode": "async",
    "icon": "FileText",
    "disclaimer": "建议单次转换 100 张以内。一次性转换过多高分辨率图片可能导致系统内存激增、处理耗时成倍增加，且生成的超大 PDF 文件在部分阅读器中可能卡顿。",
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
  // ─────────────────────────────────────────────  视频工具 (download)  ──────────
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
  // ─────────────────────────────────────────────  音频工具 (audio)  ──────────
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
  // ─────────────────────────────────────────────  文本办公 (text)  ──────────
  {
    "id": "signature-designer",
    "name": "艺术与电子签名",
    "description": "一笔艺术签、连笔商务签、平滑手写板与印章设计，一键导出透明电子合同签名",
    "category": "text",
    "mode": "sync",
    "icon": "PenTool",
    "clientSide": true,
    "inputs": []
  },
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
    "id": "mind-map",
    "name": "思维导图",
    "description": "在线创建和编辑思维导图，支持节点编辑、拖拽、导出图片",
    "category": "text",
    "mode": "sync",
    "clientSide": true,
    "icon": "Network",
    "inputs": []
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
    "id": "bar-chart",
    "name": "柱状图",
    "description": "根据数据生成柱状图，支持自定义数据",
    "category": "text",
    "icon": "BarChart",
    "mode": "sync",
    "inputs": [],
    "clientSide": true
  },
  {
    "id": "line-chart",
    "name": "折线图",
    "description": "根据数据生成折线图，支持自定义数据",
    "category": "text",
    "icon": "LineChart",
    "mode": "sync",
    "inputs": [],
    "clientSide": true
  },
  {
    "id": "pie-chart",
    "name": "饼图",
    "description": "根据数据生成饼图，支持自定义数据",
    "category": "text",
    "icon": "PieChart",
    "mode": "sync",
    "inputs": [],
    "clientSide": true
  },
  {
    "id": "scatter-chart",
    "name": "散点图",
    "description": "根据数据生成散点图，支持自定义数据",
    "category": "text",
    "icon": "ChartScatter",
    "mode": "sync",
    "inputs": [],
    "clientSide": true
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
  },
  // ─────────────────────────────────────────────  开发运维 (dev)  ──────────
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
    "id": "date-converter",
    "name": "日期转换",
    "description": "时间戳与日期时间互相转换",
    "category": "dev",
    "mode": "sync",
    "icon": "Calendar",
    "inputs": [],
    "clientSide": true
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
  // ─────────────────────────────────────────────  密码编码 (encode)  ──────────
  {
    "id": "base64",
    "name": "Base64 编码/解码",
    "description": "将文本编码为 Base64 或解码还原，支持完整 Unicode",
    "category": "encode",
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
    "category": "encode",
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
    "category": "encode",
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
    "id": "password-generator",
    "name": "随机密码生成",
    "description": "生成包含大小写字母、数字、特殊符号的随机密码",
    "category": "encode",
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
    "category": "encode",
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
    "id": "base-converter",
    "name": "进制转换器",
    "description": "支持二进制、八进制、十进制、十六进制互转",
    "category": "encode",
    "mode": "sync",
    "icon": "Binary",
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
    "id": "byte-converter",
    "name": "字节单位转换器",
    "description": "支持 Byte、KB、MB、GB、TB 等存储单位转换，1024进制",
    "category": "encode",
    "mode": "sync",
    "icon": "HardDrive",
    "clientSide": true,
    "inputs": [
      {
        "id": "value",
        "type": "number",
        "label": "数值",
        "required": true,
        "defaultValue": "1"
      },
      {
        "id": "unit",
        "type": "select",
        "label": "单位",
        "required": true,
        "defaultValue": "GB",
        "options": [
          {
            "label": "Byte",
            "value": "B"
          },
          {
            "label": "KB",
            "value": "KB"
          },
          {
            "label": "MB",
            "value": "MB"
          },
          {
            "label": "GB",
            "value": "GB"
          },
          {
            "label": "TB",
            "value": "TB"
          }
        ]
      }
    ]
  },
  {
    "id": "sha-hash",
    "name": "SHA 哈希工具",
    "description": "SHA1、SHA256、SHA384、SHA512 哈希计算",
    "category": "encode",
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
    "category": "encode",
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
    "id": "unicode-converter",
    "name": "Unicode 编码转换",
    "description": "Unicode 与中文相互转换",
    "category": "encode",
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
    "id": "guid-generator",
    "name": "GUID 生成工具",
    "description": "生成全局唯一标识符 GUID",
    "category": "encode",
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
    "id": "crc-checksum",
    "name": "CRC 校验工具",
    "description": "计算文本的 CRC32 校验值",
    "category": "encode",
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
    "id": "random-number",
    "name": "随机数生成器",
    "description": "生成指定范围内的随机数，支持批量生成",
    "category": "encode",
    "mode": "sync",
    "icon": "Dices",
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
    "id": "morse-code",
    "name": "摩斯电码",
    "description": "摩斯电码和原文之间的双向转换",
    "category": "encode",
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
    "category": "encode",
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
  // ─────────────────────────────────────────────  实用生活 (utility)  ──────────
  {
    "id": "archpr",
    "name": "压缩包密码恢复",
    "description": "专业级 ZIP / RAR / 7Z / ACE 密码恢复利器 (ARCHPR)，支持纯暴力破解、掩码搜索、密码字典碰撞与已知明文攻击",
    "category": "utility",
    "subcategory": "sys",
    "mode": "sync",
    "clientSide": true,
    "icon": "KeyRound",
    "inputs": []
  },
  {
    "id": "qr-generator",
    "name": "二维码生成",
    "description": "从文字或链接生成二维码 PNG 图片",
    "category": "utility",
    "mode": "sync",
    "icon": "QrCode",
    "subcategory": "design",
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
    "clientSide": true,
    "subcategory": "design",
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
    "id": "batch-rename",
    "name": "批量重命名",
    "description": "批量重命名文件，支持序号、查找替换、添加前后缀、大小写转换",
    "category": "utility",
    "subcategory": "life",
    "mode": "sync",
    "clientSide": true,
    "icon": "Edit3",
    "inputs": []
  },
  {
    "id": "color-palette",
    "name": "配色灵感工具",
    "description": "输入关键词生成配色，导入图片提取配色，导出色卡",
    "category": "utility",
    "subcategory": "design",
    "mode": "sync",
    "clientSide": true,
    "icon": "Palette",
    "inputs": []
  },
  {
    "id": "color-convert",
    "name": "颜色转换",
    "description": "在 HEX、RGB、HSL 之间转换颜色，带实时预览",
    "category": "utility",
    "mode": "sync",
    "icon": "Palette",
    "clientSide": true,
    "subcategory": "design",
    "inputs": [
      {
        "id": "color",
        "type": "text",
        "label": "颜色值",
        "required": true
      }
    ]
  },
  {
    "id": "speed-test",
    "name": "网速测试",
    "description": "测试网络下载和上传速度，延迟和抖动",
    "category": "utility",
    "subcategory": "life",
    "mode": "sync",
    "clientSide": true,
    "icon": "Wifi",
    "inputs": []
  },
  {
    "id": "media-tracker",
    "name": "观影追番读书记录器",
    "description": "记录看过的电影、番剧和书籍，打分写短评，统计年度影视书影回顾",
    "category": "utility",
    "subcategory": "life",
    "mode": "sync",
    "clientSide": true,
    "icon": "BookOpen",
    "inputs": []
  },
  {
    "id": "simple-calculator",
    "name": "全功能科学计算器",
    "description": "支持标准日常、科学函数、程序员多进制位运算与交互式点阵计算",
    "category": "utility",
    "mode": "sync",
    "icon": "Calculator",
    "clientSide": true,
    "subcategory": "calc",
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
    "id": "loan-calculator",
    "name": "贷款计算器",
    "description": "计算等额本息/等额本金还款方式下的月供、总利息等信息",
    "category": "utility",
    "mode": "sync",
    "icon": "Calculator",
    "clientSide": true,
    "subcategory": "finance",
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
    "id": "income-tax-calculator",
    "name": "个人所得税计算器",
    "description": "计算工资薪金个人所得税，支持五险一金扣除",
    "category": "utility",
    "mode": "sync",
    "icon": "Wallet",
    "clientSide": true,
    "subcategory": "finance",
    "inputs": [
      {
        "id": "salary",
        "type": "number",
        "label": "税前工资（元）",
        "required": true,
        "defaultValue": "10000"
      },
      {
        "id": "social",
        "type": "number",
        "label": "五险一金（元）",
        "required": false,
        "defaultValue": "0"
      },
      {
        "id": "special",
        "type": "number",
        "label": "专项附加扣除（元）",
        "required": false,
        "defaultValue": "0"
      }
    ]
  },
  {
    "id": "exchange-rate",
    "name": "汇率换算器",
    "description": "主要货币汇率换算（固定汇率参考）",
    "category": "utility",
    "mode": "sync",
    "icon": "TrendingUp",
    "clientSide": true,
    "subcategory": "finance",
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
    "id": "tax-calculator",
    "name": "税金税率计算器",
    "description": "计算含税金额、未含税金额、税额及税率",
    "category": "utility",
    "mode": "sync",
    "icon": "Receipt",
    "clientSide": true,
    "subcategory": "finance",
    "inputs": [
      {
        "id": "amount",
        "type": "number",
        "label": "金额",
        "required": true,
        "defaultValue": "10000"
      },
      {
        "id": "rate",
        "type": "number",
        "label": "税率（%）",
        "required": true,
        "defaultValue": "13"
      },
      {
        "id": "type",
        "type": "select",
        "label": "金额类型",
        "required": true,
        "defaultValue": "withTax",
        "options": [
          {
            "label": "含税金额",
            "value": "withTax"
          },
          {
            "label": "不含税金额",
            "value": "withoutTax"
          }
        ]
      }
    ]
  },
  {
    "id": "credit-card-calculator",
    "name": "信用卡分期计算器",
    "description": "计算信用卡分期的实际利率和总费用",
    "category": "utility",
    "mode": "sync",
    "icon": "CreditCard",
    "clientSide": true,
    "subcategory": "finance",
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
    "id": "rmb-uppercase",
    "name": "人民币大写转换",
    "description": "将数字金额转换为人民币大写形式，支持批量转换",
    "category": "utility",
    "mode": "sync",
    "icon": "Banknote",
    "clientSide": true,
    "subcategory": "finance",
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
    "category": "utility",
    "mode": "sync",
    "icon": "Type",
    "clientSide": true,
    "subcategory": "finance",
    "inputs": [
      {
        "id": "amount",
        "type": "number",
        "label": "金额",
        "required": true,
        "defaultValue": "1234.56"
      }
    ]
  },
  {
    "id": "unit-converter",
    "name": "综合单位转换器",
    "description": "长度、重量、面积、体积、温度等综合转换",
    "category": "utility",
    "mode": "sync",
    "icon": "ArrowLeftRight",
    "clientSide": true,
    "subcategory": "convert",
    "inputs": [
      {
        "id": "category",
        "type": "select",
        "label": "转换类型",
        "required": true,
        "defaultValue": "length",
        "options": [
          {
            "label": "长度",
            "value": "length"
          },
          {
            "label": "重量",
            "value": "weight"
          },
          {
            "label": "面积",
            "value": "area"
          },
          {
            "label": "体积",
            "value": "volume"
          },
          {
            "label": "温度",
            "value": "temperature"
          }
        ]
      },
      {
        "id": "value",
        "type": "number",
        "label": "数值",
        "required": true,
        "defaultValue": "1"
      }
    ]
  },
  {
    "id": "lunar-calendar",
    "name": "公历农历转换器",
    "description": "公历农历双向转换，提供详细农历信息",
    "category": "utility",
    "mode": "sync",
    "icon": "Moon",
    "clientSide": true,
    "subcategory": "calc",
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
    "id": "date-calculator",
    "name": "日期计算器",
    "description": "支持日期差计算、日期加减、年龄计算",
    "category": "utility",
    "mode": "sync",
    "icon": "Calendar",
    "clientSide": true,
    "subcategory": "calc",
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
    "id": "stopwatch",
    "name": "秒表计时器",
    "description": "精确到毫秒的秒表，支持计次",
    "category": "utility",
    "mode": "sync",
    "icon": "Timer",
    "clientSide": true,
    "subcategory": "calc",
    "inputs": []
  },
  {
    "id": "bmi-calculator",
    "name": "BMI 计算器",
    "description": "根据身高体重计算 BMI 指数，评估健康状况",
    "category": "utility",
    "mode": "sync",
    "icon": "Heart",
    "clientSide": true,
    "subcategory": "calc",
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
    "id": "length-converter",
    "name": "长度单位转换器",
    "description": "支持公制、英制、市制等多种长度单位互转",
    "category": "utility",
    "mode": "sync",
    "icon": "Ruler",
    "clientSide": true,
    "subcategory": "convert",
    "inputs": [
      {
        "id": "value",
        "type": "number",
        "label": "数值",
        "required": true,
        "defaultValue": "1"
      },
      {
        "id": "unit",
        "type": "select",
        "label": "单位",
        "required": true,
        "defaultValue": "m",
        "options": [
          {
            "label": "毫米 mm",
            "value": "mm"
          },
          {
            "label": "厘米 cm",
            "value": "cm"
          },
          {
            "label": "米 m",
            "value": "m"
          },
          {
            "label": "千米 km",
            "value": "km"
          },
          {
            "label": "英寸 in",
            "value": "in"
          },
          {
            "label": "英尺 ft",
            "value": "ft"
          },
          {
            "label": "码 yd",
            "value": "yd"
          },
          {
            "label": "英里 mi",
            "value": "mi"
          }
        ]
      }
    ]
  },
  {
    "id": "area-converter",
    "name": "面积转换器",
    "description": "支持平方米、平方英尺、亩、公顷等多种面积单位转换",
    "category": "utility",
    "mode": "sync",
    "icon": "Square",
    "clientSide": true,
    "subcategory": "convert",
    "inputs": [
      {
        "id": "value",
        "type": "number",
        "label": "数值",
        "required": true,
        "defaultValue": "1"
      },
      {
        "id": "unit",
        "type": "select",
        "label": "单位",
        "required": true,
        "defaultValue": "m2",
        "options": [
          {
            "label": "平方米",
            "value": "m2"
          },
          {
            "label": "平方千米",
            "value": "km2"
          },
          {
            "label": "平方英尺",
            "value": "ft2"
          },
          {
            "label": "平方英寸",
            "value": "in2"
          },
          {
            "label": "亩",
            "value": "mu"
          },
          {
            "label": "公顷",
            "value": "ha"
          },
          {
            "label": "英亩",
            "value": "acre"
          }
        ]
      }
    ]
  },
  {
    "id": "weight-converter",
    "name": "重量单位转换器",
    "description": "支持公制、市制、英制等多种重量单位互转",
    "category": "utility",
    "mode": "sync",
    "icon": "Scale",
    "clientSide": true,
    "subcategory": "convert",
    "inputs": [
      {
        "id": "value",
        "type": "number",
        "label": "数值",
        "required": true,
        "defaultValue": "1"
      },
      {
        "id": "unit",
        "type": "select",
        "label": "单位",
        "required": true,
        "defaultValue": "kg",
        "options": [
          {
            "label": "毫克 mg",
            "value": "mg"
          },
          {
            "label": "克 g",
            "value": "g"
          },
          {
            "label": "千克 kg",
            "value": "kg"
          },
          {
            "label": "吨 t",
            "value": "t"
          },
          {
            "label": "斤",
            "value": "jin"
          },
          {
            "label": "两",
            "value": "liang"
          },
          {
            "label": "磅 lb",
            "value": "lb"
          },
          {
            "label": "盎司 oz",
            "value": "oz"
          }
        ]
      }
    ]
  },
  {
    "id": "volume-converter",
    "name": "体积单位转换器",
    "description": "立方米、升、毫升、加仑、盎司等体积单位转换",
    "category": "utility",
    "mode": "sync",
    "icon": "Box",
    "clientSide": true,
    "subcategory": "convert",
    "inputs": [
      {
        "id": "value",
        "type": "number",
        "label": "数值",
        "required": true,
        "defaultValue": "1"
      },
      {
        "id": "unit",
        "type": "select",
        "label": "单位",
        "required": true,
        "defaultValue": "L",
        "options": [
          {
            "label": "立方米 m³",
            "value": "m3"
          },
          {
            "label": "升 L",
            "value": "L"
          },
          {
            "label": "毫升 mL",
            "value": "mL"
          },
          {
            "label": "加仑 gal",
            "value": "gal"
          },
          {
            "label": "液盎司 fl oz",
            "value": "floz"
          }
        ]
      }
    ]
  },
  {
    "id": "time-converter",
    "name": "时间单位转换器",
    "description": "支持毫秒、秒、分、时、天、周、月、年等时间单位转换",
    "category": "utility",
    "mode": "sync",
    "icon": "Hourglass",
    "clientSide": true,
    "subcategory": "convert",
    "inputs": [
      {
        "id": "value",
        "type": "number",
        "label": "数值",
        "required": true,
        "defaultValue": "1"
      },
      {
        "id": "unit",
        "type": "select",
        "label": "单位",
        "required": true,
        "defaultValue": "day",
        "options": [
          {
            "label": "毫秒",
            "value": "ms"
          },
          {
            "label": "秒",
            "value": "s"
          },
          {
            "label": "分钟",
            "value": "min"
          },
          {
            "label": "小时",
            "value": "h"
          },
          {
            "label": "天",
            "value": "day"
          },
          {
            "label": "周",
            "value": "week"
          },
          {
            "label": "月(30天)",
            "value": "month"
          },
          {
            "label": "年(365天)",
            "value": "year"
          }
        ]
      }
    ]
  },
  {
    "id": "periodic-table",
    "name": "元素周期表",
    "description": "化学元素周期表，展示元素基本信息",
    "category": "utility",
    "mode": "sync",
    "icon": "Atom",
    "clientSide": true,
    "subcategory": "life",
    "inputs": []
  },
  {
    "id": "number-sum",
    "name": "数字求和工具",
    "description": "智能解析多行数字数据，计算总和、平均数、最大值、最小值",
    "category": "utility",
    "mode": "sync",
    "icon": "Sigma",
    "clientSide": true,
    "subcategory": "calc",
    "inputs": [
      {
        "id": "numbers",
        "type": "text",
        "label": "数字（每行一个或用逗号分隔）",
        "required": true
      }
    ]
  },
  {
    "id": "geometry-calculator",
    "name": "几何计算器",
    "description": "矩形、圆形、三角形等图形的面积周长计算",
    "category": "utility",
    "mode": "sync",
    "icon": "Shapes",
    "clientSide": true,
    "subcategory": "calc",
    "inputs": [
      {
        "id": "shape",
        "type": "select",
        "label": "图形",
        "required": true,
        "defaultValue": "rectangle",
        "options": [
          {
            "label": "矩形",
            "value": "rectangle"
          },
          {
            "label": "圆形",
            "value": "circle"
          },
          {
            "label": "三角形",
            "value": "triangle"
          },
          {
            "label": "梯形",
            "value": "trapezoid"
          }
        ]
      },
      {
        "id": "a",
        "type": "number",
        "label": "参数1（长/半径/底）",
        "required": true,
        "defaultValue": "10"
      },
      {
        "id": "b",
        "type": "number",
        "label": "参数2（宽/高/高）",
        "required": false,
        "defaultValue": "5"
      }
    ]
  },
  {
    "id": "roman-numeral",
    "name": "罗马数字转换器",
    "description": "罗马数字与阿拉伯数字双向转换",
    "category": "utility",
    "mode": "sync",
    "icon": "Pilcrow",
    "clientSide": true,
    "subcategory": "convert",
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
    "category": "utility",
    "mode": "sync",
    "icon": "ALargeSmall",
    "clientSide": true,
    "subcategory": "calc",
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
];

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
