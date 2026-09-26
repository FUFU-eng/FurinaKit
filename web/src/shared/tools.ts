import { tr as __pdfTr } from "@/lib/language";

import { createUiText as __createUiText } from "@/lib/language";
const __ui = __createUiText("shared/tools.ts");
import {TOOL_PRESENTATION} from "./catalog-presentation";
import {tr} from "@/lib/language";
import {CATALOG,CATEGORY_ORDER,PDF_EDITOR_TOOL_IDS,TOOL_ALIASES} from "./catalog-policy";
import type { OmniTool } from "./types";

const DEFINITIONS: OmniTool[] = [
  {id:"text-transform",name:"文字与数字转换",description:"",category:"text",mode:"sync",clientSide:true,icon:"CaseSensitive",inputs:[]},
  { id:"notes",get "name"() { return __ui("便签"); },get "description"() { return __ui("随手保存文字、图片、文档、视频与浏览器链接；本地持久化，独立小窗与主界面共享"); },category:"utility",mode:"sync",clientSide:true,icon:"FileText",inputs:[] },
  // ─────────────────────────────────────────────  图片工具 (image)  ──────────
  {
      "id": "screenshot-ocr",
      get "name"() { return __ui("图片/截图取字"); },
      get "description"() { return __ui("上传、拖入或粘贴图片，也可直接框选截图；本机识别中英文，导出文本、Markdown和含坐标的JSON，不上传图片"); },
      "category": "image",
      "mode": "sync",
      "clientSide": true,
      "icon": "MonitorUp",
      "inputs": []
    },
  {
      "id": "ocr-pdf",
      get "name"() { return __ui("扫描件转可搜索 PDF"); },
      get "description"() { return __ui("给扫描件 PDF 叠一层不可见文字：文件看起来没变，但文字可以选中、搜索、复制，再转 Word 就是可编辑文字（不需要联网，纯本地识别）"); },
      "category": "pdf",
      "mode": "async",
      "icon": "FileSearch",
      get "disclaimer"() { return __ui("适合没有文字层的扫描件。如果这份 PDF 本来就能选中文字，不需要用本工具。"); },
      "inputs": [
        { "id": "file", "type": "file", get "label"() { return __ui("选择 PDF"); }, "accept": ".pdf", "required": true, get "help"() { return __ui("扫描件、手机拍的文档都可以"); } },
        {
          "id": "dpi", "type": "select", get "label"() { return __ui("识别分辨率"); }, "required": true, "defaultValue": "200",
          "options": [
            { get "label"() { return __ui("150（快，适合清晰的扫描件）"); }, "value": "150" },
            { get "label"() { return __ui("200（推荐）"); }, "value": "200" },
            { get "label"() { return __ui("300（小字更准，更慢）"); }, "value": "300" }
          ]
        },
        {
          "id": "export_text", "type": "select", get "label"() { return __ui("是否另外导出纯文本"); }, "required": true, "defaultValue": "yes",
          "options": [
            { get "label"() { return __ui("要（同时给一份 txt）"); }, "value": "yes" },
            { get "label"() { return __ui("不要（只要可搜索 PDF）"); }, "value": "no" }
          ]
        },
        {
          "id": "strictness", "type": "select", get "label"() { return __ui("识别严格度"); }, "required": true, "defaultValue": "standard",
          "options": [
            { get "label"() { return __ui("标准（推荐）"); }, "value": "standard" },
            { get "label"() { return __ui("严格（把不确定的行也标出来）"); }, "value": "strict" }
          ]
        }
      ]
    },
  {
      "id": "watermark-remove",
      get "name"() { return __ui("图片去水印"); },
      get "description"() { return __ui("把图片上的水印、日期戳、杂物抹掉再用周围像素补回来：可在图上直接框选或用画笔涂出范围，也能自动检测淡灰水印；支持极速修补与模型修补两档，纯本地处理"); },
      "category": "image",
      "mode": "async",
      "clientSide": false,
      "icon": "Eraser",
      "inputs": [
        { "id": "file", "type": "file", get "label"() { return __ui("选择图片"); }, "accept": ".png,.jpg,.jpeg,.webp,.bmp", "required": true }
      ]
    },

  {
      "id": "image-upscale",
      get "name"() { return __ui("图片高清强化"); },
      get "description"() { return __ui("使用 Real-ESRGAN AI 模型批量超分放大 2/3/4 倍，高清重绘对比"); },
      "category": "image",
      "mode": "async",
      "icon": "ZoomIn",
      "selfHostOnly": true,
      "heavyWorkerOnly": true,
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("图片文件"); },
          "required": true
        },
        {
          "id": "model",
          "type": "select",
          get "label"() { return __ui("AI 模型"); },
          "required": true,
          "defaultValue": "anime-x2",
          "options": [
            {
              get "label"() { return __ui("动漫 2倍 (anime-x2)"); },
              "value": "anime-x2"
            },
            {
              get "label"() { return __ui("动漫 3倍 (anime-x3)"); },
              "value": "anime-x3"
            }
          ]
        }
      ]
    },
  {
      "id": "image-obfuscate",
      get "name"() { return __ui("图片混淆"); },
      get "description"() { return __ui("空间填充曲线与混沌像素映射算法，支持方块/全像素打乱与可逆解密"); },
      "category": "image",
      "mode": "sync",
      "icon": "EyeOff",
      "inputs": []
    },
  {
      "id": "image-to-pdf",
      get "name"() { return __ui("图片转 PDF"); },
      get "description"() { return __ui("将一张或多张图片合并为 PDF 文件，支持自定义页面与多画质压缩"); },
      "category": "pdf",
      "mode": "async",
      "icon": "FileText",
      "inputs": [
        {
          "id": "files",
          "type": "file",
          get "label"() { return __ui("图片文件（可多选）"); },
          "required": true,
          "multiple": true
        },
        {
          "id": "page_size",
          "type": "select",
          get "label"() { return __ui("页面大小"); },
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
              get "label"() { return __ui("原始图片大小"); },
              "value": "original"
            }
          ]
        },
        {
          "id": "orientation",
          "type": "select",
          get "label"() { return __ui("方向"); },
          "required": true,
          "defaultValue": "portrait",
          "options": [
            {
              get "label"() { return __ui("纵向"); },
              "value": "portrait"
            },
            {
              get "label"() { return __ui("横向"); },
              "value": "landscape"
            }
          ]
        }
      ]
    },
  {
      "id": "file-hide-image",
      get "name"() { return __ui("文件伪装为图片"); },
      get "description"() { return __ui("将任意私密文件无损伪装隐藏入图片，或一键提取还原藏匿文件"); },
      "category": "security",
      "mode": "sync",
      "icon": "FileImage",
      "clientSide": true,
      "inputs": []
    },
  {
      "id": "image-dedup",
      get "name"() { return __ui("批量图片查重"); },
      get "description"() { return __ui("找出文件夹里内容重复或相似的图片：改名、压缩、裁剪、加过水印都能认出来；按「完全相同 / 高度相似 / 相似」分档展示，每组给出建议保留的一张，确认后只移到「_重复待删除」文件夹，不直接删除任何文件"); },
      "category": "image",
      "mode": "sync",
      "clientSide": true,
      "icon": "CopyCheck",
      "inputs": []
    },
  {
      "id": "ai-outpaint",
      get "name"() { return __ui("AI 扩图"); },
      get "description"() { return __ui("把画面向外扩展、把窄图扩成宽图：可分别设置四边扩展比例，或直接指定目标比例（例如把竖图扩成 16:9 壁纸）；新扩出来的部分由修补模型补成连贯画面，原图区域逐像素保留。需先在设置里下载修补模型（约 198MB）"); },
      "category": "image",
      "mode": "async",
      "icon": "Maximize",
      "inputs": [
        { "id": "file", "type": "file", get "label"() { return __ui("选择图片"); }, "accept": ".png,.jpg,.jpeg,.webp,.bmp", "required": true },
        {
          "id": "preset", "type": "select", get "label"() { return __ui("常用扩法"); }, "required": true, "defaultValue": "all25",
          "options": [
            { get "label"() { return __ui("四边各扩 25%（整体放大一圈）"); }, "value": "all25" },
            { get "label"() { return __ui("左右各扩 50%（竖图变宽）"); }, "value": "lr50" },
            { get "label"() { return __ui("上方扩 50%（给天空留空间）"); }, "value": "top50" },
            { get "label"() { return __ui("扩成 16:9 横图"); }, "value": "169" },
            { get "label"() { return __ui("扩成 9:16 竖图"); }, "value": "916" },
            { get "label"() { return __ui("扩成 1:1 方图"); }, "value": "11" },
            { get "label"() { return __ui("自定义四边比例"); }, "value": "custom" }
          ]
        },
        { "id": "left", "type": "number", get "label"() { return __ui("左边扩展比例（自定义时用，0.25 表示 25%）"); }, "required": false, "defaultValue": "0.25" },
        { "id": "right", "type": "number", get "label"() { return __ui("右边扩展比例"); }, "required": false, "defaultValue": "0.25" },
        { "id": "top", "type": "number", get "label"() { return __ui("上边扩展比例"); }, "required": false, "defaultValue": "0.25" },
        { "id": "bottom", "type": "number", get "label"() { return __ui("下边扩展比例"); }, "required": false, "defaultValue": "0.25" },
        {
          "id": "anchor", "type": "select", get "label"() { return __ui("原图位置（按目标比例扩时）"); }, "required": false, "defaultValue": "center",
          "options": [
            { get "label"() { return __ui("居中"); }, "value": "center" },
            { get "label"() { return __ui("靠左上"); }, "value": "top-left" },
            { get "label"() { return __ui("靠右下"); }, "value": "bottom-right" }
          ]
        }
      ]
    },
  {
      "id": "colorize-photo",
      get "name"() { return __ui("黑白上色"); },
      get "description"() { return __ui("给黑白照片添上颜色，三种做法任选：AI 上色（模型推理，需按需下载 58.8MB，效果最自然）、用一张彩色参考图迁移色彩、或按人像/风景/室内/复古等风格预设上色。三种都保留原图的明暗结构"); },
      "category": "image",
      "mode": "async",
      "icon": "Palette",
      "inputs": [
        { "id": "file", "type": "file", get "label"() { return __ui("选择黑白照片"); }, "accept": ".png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff", "required": true },
        {
          "id": "mode", "type": "select", get "label"() { return __ui("上色方式"); }, "required": true, "defaultValue": "style",
          "options": [
            { get "label"() { return __ui("按风格预设上色（不需要参考图）"); }, "value": "style" },
            { get "label"() { return __ui("用一张彩色图作参考（效果更贴近你想要的味道）"); }, "value": "reference" },
            { get "label"() { return __ui("AI 上色（模型推理，需下载 58.8MB，本页上方可直接下载）"); }, "value": "ai" }
          ]
        },
        {
          "id": "style", "type": "select", get "label"() { return __ui("风格（选「风格预设」时用）"); }, "required": false, "defaultValue": "portrait",
          "options": [
            { get "label"() { return __ui("人像（偏暖，肤色自然）"); }, "value": "portrait" },
            { get "label"() { return __ui("风景（蓝天绿地，色彩通透）"); }, "value": "landscape" },
            { get "label"() { return __ui("室内（暖光，柔和）"); }, "value": "indoor" },
            { get "label"() { return __ui("复古（低饱和偏黄）"); }, "value": "vintage" },
            { get "label"() { return __ui("自然（接近真实，克制）"); }, "value": "neutral" }
          ]
        },
        { "id": "reference_file", "type": "file", get "label"() { return __ui("彩色参考图（选「参考图」时必填）"); }, "accept": ".png,.jpg,.jpeg,.webp,.bmp", "required": false, "requiredWhen": { "field": "mode", "value": "reference" },
          get "help"() { return __ui("挑一张配色与你想要的效果接近的彩色照片"); } },
        {
          "id": "strength", "type": "select", get "label"() { return __ui("上色强度"); }, "required": true, "defaultValue": "1",
          "options": [
            { get "label"() { return __ui("轻微（0.5）"); }, "value": "0.5" },
            { get "label"() { return __ui("适中（0.8）"); }, "value": "0.8" },
            { get "label"() { return __ui("充分（1.0，推荐）"); }, "value": "1" }
          ]
        }
      ]
    },
  {
      "id": "photo-restore",
      get "name"() { return __ui("老照片修复"); },
      get "description"() { return __ui("把泛黄褪色、发灰没层次、有颗粒噪点的老照片修回来：自动去黄、去噪、提亮层次，可选保留原本的暖色调；放大与划痕修补可直接用「图片放大」和「图片去水印」继续处理"); },
      "category": "image",
      "mode": "async",
      "icon": "Sparkle",
      "inputs": [
        { "id": "file", "type": "file", get "label"() { return __ui("选择老照片"); }, "accept": ".png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff", "required": true, get "help"() { return __ui("扫描件、翻拍、老相机的照片都可以"); } },
        {
          "id": "keep_tone", "type": "select", get "label"() { return __ui("色调处理"); }, "required": true, "defaultValue": "no",
          "options": [
            { get "label"() { return __ui("自动去黄褪色（还原成正常色彩）"); }, "value": "no" },
            { get "label"() { return __ui("保留原本的暖黄色调（怀旧感）"); }, "value": "yes" }
          ]
        },
        {
          "id": "denoise", "type": "select", get "label"() { return __ui("去噪强度"); }, "required": true, "defaultValue": "6",
          "options": [
            { get "label"() { return __ui("不处理"); }, "value": "0" },
            { get "label"() { return __ui("轻微（3）"); }, "value": "3" },
            { get "label"() { return __ui("适中（6，推荐）"); }, "value": "6" },
            { get "label"() { return __ui("较强（10，颗粒重时用）"); }, "value": "10" }
          ]
        },
        {
          "id": "balance", "type": "select", get "label"() { return __ui("去黄力度"); }, "required": true, "defaultValue": "0.8",
          "options": [
            { get "label"() { return __ui("轻微（0.5）"); }, "value": "0.5" },
            { get "label"() { return __ui("适中（0.8，推荐）"); }, "value": "0.8" },
            { get "label"() { return __ui("较强（1.0）"); }, "value": "1" }
          ]
        },
        {
          "id": "contrast", "type": "select", get "label"() { return __ui("层次增强"); }, "required": true, "defaultValue": "1.2",
          "options": [
            { get "label"() { return __ui("不处理"); }, "value": "0" },
            { get "label"() { return __ui("轻微（1.0）"); }, "value": "1" },
            { get "label"() { return __ui("适中（1.2，推荐）"); }, "value": "1.2" },
            { get "label"() { return __ui("较强（1.8，发灰严重时用）"); }, "value": "1.8" }
          ]
        },
        {
          "id": "sharpen", "type": "select", get "label"() { return __ui("锐化"); }, "required": false, "defaultValue": "0",
          "options": [
            { get "label"() { return __ui("不锐化（推荐，避免把颗粒提起来）"); }, "value": "0" },
            { get "label"() { return __ui("轻度锐化（0.4）"); }, "value": "0.4" }
          ]
        }
      ]
    },
  {
      "id": "bg-replace",
      get "name"() { return __ui("图片换背景"); },
      get "description"() { return __ui("把主体抠出来后换到新背景：可选纯色底、把原背景虚化成景深效果，或上传自己的背景图；复用精细抠图模型，发丝与半透明边缘同样干净（模型需在设置里按需下载）"); },
      "category": "image",
      "mode": "async",
      "icon": "ImagePlus",
      "inputs": [
        { "id": "file", "type": "file", get "label"() { return __ui("选择图片"); }, "accept": ".png,.jpg,.jpeg,.webp,.bmp", "required": true, get "help"() { return __ui("人像、宠物、商品图都可以"); } },
        {
          "id": "mode", "type": "select", get "label"() { return __ui("背景方式"); }, "required": true, "defaultValue": "color",
          "options": [
            { get "label"() { return __ui("纯色背景"); }, "value": "color" },
            { get "label"() { return __ui("虚化原背景（景深效果）"); }, "value": "blur" },
            { get "label"() { return __ui("使用我上传的背景图"); }, "value": "image" }
          ]
        },
        {
          "id": "color", "type": "select", get "label"() { return __ui("纯色颜色"); }, "required": false, "defaultValue": "white",
          "options": [
            { get "label"() { return __ui("白色"); }, "value": "white" }, { get "label"() { return __ui("证件照蓝"); }, "value": "blue" },
            { get "label"() { return __ui("证件照红"); }, "value": "red" }, { get "label"() { return __ui("黑色"); }, "value": "black" },
            { get "label"() { return __ui("绿色"); }, "value": "green" }, { get "label"() { return __ui("浅灰"); }, "value": "gray" }
          ]
        },
        { "id": "bg_image", "type": "file", get "label"() { return __ui("背景图（仅在选择「使用我上传的背景图」时才会用到，其它方式会自动忽略）"); }, "accept": ".png,.jpg,.jpeg,.webp,.bmp", "required": false },
        {
          "id": "blur", "type": "select", get "label"() { return __ui("虚化强度"); }, "required": false, "defaultValue": "20",
          "options": [
            { get "label"() { return __ui("轻微（10）"); }, "value": "10" }, { get "label"() { return __ui("适中（20）"); }, "value": "20" },
            { get "label"() { return __ui("较强（40）"); }, "value": "40" }
          ]
        },
        {
          "id": "feather", "type": "select", get "label"() { return __ui("边缘羽化"); }, "required": true, "defaultValue": "0",
          "options": [
            { get "label"() { return __ui("不羽化（保留发丝细节，推荐）"); }, "value": "0" },
            { get "label"() { return __ui("轻微羽化 1px"); }, "value": "1" }
          ]
        }
      ]
    },

  {
      "id": "bg-remove",
      get "name"() { return __ui("图片抠图"); },
      get "description"() { return __ui("把主体从背景里抠出来，可输出透明背景 PNG 或换成白/蓝/红/绿灯底。两档模型：内置的通用/人像/快速模型开箱即用；「精细」对发丝、半透明边缘与细小镂空明显更干净（需在设置里按需下载，约 170MB）"); },
      "category": "image",
      "mode": "async",
      "clientSide": true,
      "icon": "Scissors",
      "selfHostOnly": true,
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("图片文件"); },
          "required": true
        },
        {
          "id": "model",
          "type": "select",
          get "label"() { return __ui("抠图模型"); },
          "required": true,
          "defaultValue": "u2net",
          "options": [
            {
              get "label"() { return __ui("通用 (u2net)"); },
              "value": "u2net"
            },
            {
              get "label"() { return __ui("人像 (u2net_human_seg)"); },
              "value": "u2net_human_seg"
            },
            {
              get "label"() { return __ui("精细 (isnet-general-use，需下载约 170MB)"); },
              "value": "isnet-general-use"
            }
          ]
        },
        {
          "id": "background", "type": "select", get "label"() { return __ui("背景"); }, "required": true, "defaultValue": "transparent",
          "options": [
            { get "label"() { return __ui("透明（PNG，可再合成）"); }, "value": "transparent" },
            { get "label"() { return __ui("白色"); }, "value": "white" },
            { get "label"() { return __ui("证件照蓝底"); }, "value": "blue" },
            { get "label"() { return __ui("证件照红底"); }, "value": "red" },
            { get "label"() { return __ui("黑色"); }, "value": "black" },
            { get "label"() { return __ui("绿色（可再做成绿幕）"); }, "value": "green" }
          ]
        },
        {
          "id": "feather", "type": "select", get "label"() { return __ui("边缘羽化"); }, "required": true, "defaultValue": "0",
          "options": [
            { get "label"() { return __ui("不羽化（保留发丝细节，推荐）"); }, "value": "0" },
            { get "label"() { return __ui("轻微羽化 1px"); }, "value": "1" },
            { get "label"() { return __ui("羽化 2px（边缘更柔和）"); }, "value": "2" }
          ]
        }
      ]
    },
  {
      "id": "image-compress",
      get "name"() { return __ui("图片压缩"); },
      get "description"() { return __ui("智能压缩图片大小，保持清晰度的同时减小文件体积"); },
      "category": "image",
      "mode": "async",
      "clientSide": true,
      "icon": "Minimize2",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "multiple": true,
          get "label"() { return __ui("图片文件"); },
          "required": true
        },
        {
          "id": "quality",
          "type": "number",
          get "label"() { return __ui("压缩质量 (1-100)"); },
          "required": false,
          "defaultValue": 75,
          "min": 1,
          "max": 100
        },
        {
          "id": "max_width",
          "type": "number",
          get "label"() { return __ui("最大宽度 (像素)"); },
          "required": false,
          get "help"() { return __ui("超过则等比缩放"); }
        }
      ]
    },
  {
      "id": "image-format-convert",
      get "name"() { return __ui("格式转换"); },
      get "description"() { return __ui("在 PNG、JPG、WebP、AVIF、BMP、TIFF、GIF 等格式之间互相转换"); },
      "category": "image",
      "mode": "async",
      "icon": "Repeat",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "multiple": true,
          get "label"() { return __ui("图片文件"); },
          "required": true
        },
        {
          "id": "format",
          "type": "select",
          get "label"() { return __ui("输出格式"); },
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
          get "label"() { return __ui("质量 (1-100)"); },
          "required": false,
          "defaultValue": 90,
          "min": 1,
          "max": 100,
          get "help"() { return __ui("PNG/GIF 为无损格式，此设置无效"); }
        }
      ]
    },
  {
      "id": "image-resize",
      get "name"() { return __ui("图片改尺寸"); },
      get "description"() { return __ui("按精确尺寸或等比调整图片大小"); },
      "category": "image",
      "mode": "async",
      "clientSide": true,
      "icon": "Maximize2",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("图片文件"); },
          "required": true
        },
        {
          "id": "width",
          "type": "number",
          get "label"() { return __ui("宽度 (像素)"); },
          "required": false
        },
        {
          "id": "height",
          "type": "number",
          get "label"() { return __ui("高度 (像素)"); },
          "required": false
        },
        {
          "id": "keep_ratio",
          "type": "select",
          get "label"() { return __ui("保持比例"); },
          "required": true,
          "defaultValue": "true",
          "options": [
            {
              get "label"() { return __ui("是"); },
              "value": "true"
            },
            {
              get "label"() { return __ui("否"); },
              "value": "false"
            }
          ]
        }
      ]
    },
  {
      "id": "image-crop",
      get "name"() { return __ui("图片裁剪"); },
      get "description"() { return __ui("按指定位置和尺寸裁剪图片"); },
      "category": "image",
      "mode": "async",
      "clientSide": true,
      "icon": "Crop",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("图片文件"); },
          "required": true
        },
        {
          "id": "x",
          "type": "number",
          get "label"() { return __ui("起始 X 坐标"); },
          "required": true,
          "defaultValue": 0
        },
        {
          "id": "y",
          "type": "number",
          get "label"() { return __ui("起始 Y 坐标"); },
          "required": true,
          "defaultValue": 0
        },
        {
          "id": "width",
          "type": "number",
          get "label"() { return __ui("裁剪宽度"); },
          "required": true,
          "defaultValue": 100
        },
        {
          "id": "height",
          "type": "number",
          get "label"() { return __ui("裁剪高度"); },
          "required": true,
          "defaultValue": 100
        }
      ]
    },
  {
      "id": "image-watermark",
      get "name"() { return __ui("图片加水印"); },
      get "description"() { return __ui("给图片添加文字水印，支持位置、大小、透明度、旋转角度调整"); },
      "category": "image",
      "mode": "async",
      "icon": "Droplet",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("图片文件"); },
          "required": true
        },
        {
          "id": "text",
          "type": "text",
          get "label"() { return __ui("水印文字"); },
          "required": true,
          "defaultValue": "FurinaKit"
        },
        {
          "id": "position",
          "type": "select",
          get "label"() { return __ui("水印位置"); },
          "required": false,
          "defaultValue": "bottom-right",
          "options": [
            {
              "value": "top-left",
              get "label"() { return __ui("左上角"); }
            },
            {
              "value": "top-center",
              get "label"() { return __ui("顶部居中"); }
            },
            {
              "value": "top-right",
              get "label"() { return __ui("右上角"); }
            },
            {
              "value": "center",
              get "label"() { return __ui("居中"); }
            },
            {
              "value": "bottom-left",
              get "label"() { return __ui("左下角"); }
            },
            {
              "value": "bottom-center",
              get "label"() { return __ui("底部居中"); }
            },
            {
              "value": "bottom-right",
              get "label"() { return __ui("右下角"); }
            }
          ]
        },
        {
          "id": "fontSize",
          "type": "number",
          get "label"() { return __ui("字体大小"); },
          "required": false,
          "defaultValue": 36,
          "min": 12,
          "max": 200
        },
        {
          "id": "opacity",
          "type": "number",
          get "label"() { return __ui("透明度 (0-100)"); },
          "required": false,
          "defaultValue": 50,
          "min": 1,
          "max": 100
        },
        {
          "id": "color",
          "type": "color",
          get "label"() { return __ui("文字颜色"); },
          "required": false,
          "defaultValue": "#ffffff"
        },
        {
          "id": "rotate",
          "type": "number",
          get "label"() { return __ui("旋转角度"); },
          "required": false,
          "defaultValue": 0,
          "min": -180,
          "max": 180
        },
        {
          "id": "x_percent",
          "type": "number",
          get "label"() { return __ui("水印横向位置（百分比）"); },
          "required": false,
          "defaultValue": 50
        },
        {
          "id": "y_percent",
          "type": "number",
          get "label"() { return __ui("水印纵向位置（百分比）"); },
          "required": false,
          "defaultValue": 50
        },
        {
          "id": "font_size",
          "type": "number",
          get "label"() { return __ui("字号（按原图像素）"); },
          "required": false,
          "defaultValue": 36
        }
      ]
    },
  {
      "id": "image-merge",
      get "name"() { return __ui("图片拼接"); },
      get "description"() { return __ui("将多张图片纵向拼接成长图、横向拼接或宫格排版，支持自定义间距与圆角"); },
      "category": "image",
      "mode": "sync",
      "clientSide": true,
      "icon": "Layers",
      "inputs": [
        {
          "id": "files",
          "type": "file",
          "multiple": true,
          get "label"() { return __ui("图片文件（多张）"); },
          "required": true
        }
      ]
    },
  {
      "id": "image-split",
      get "name"() { return __ui("图片分割"); },
      get "description"() { return __ui("将图片按网格分割成多张"); },
      "category": "image",
      "mode": "async",
      "clientSide": true,
      "icon": "Grid3x3",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("图片文件"); },
          "required": true
        },
        {
          "id": "rows",
          "type": "number",
          get "label"() { return __ui("行数"); },
          "required": true,
          "defaultValue": 2,
          "min": 1,
          "max": 10
        },
        {
          "id": "cols",
          "type": "number",
          get "label"() { return __ui("列数"); },
          "required": true,
          "defaultValue": 2,
          "min": 1,
          "max": 10
        }
      ]
    },
  {
      "id": "image-to-ico",
      get "name"() { return __ui("图片转 ICO"); },
      get "description"() { return __ui("将图片转换为 Windows 图标文件，支持多尺寸，保持透明通道"); },
      "category": "image",
      "mode": "async",
      "icon": "Image",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("图片文件"); },
          "required": true,
          get "help"() { return __ui("支持 PNG、JPG、WebP 等格式，建议使用正方形图片"); }
        },
        {
          "id": "sizes",
          "type": "select",
          get "label"() { return __ui("图标尺寸规格"); },
          "required": true,
          "defaultValue": "all",
          "options": [
            {
              get "label"() { return __ui("多尺寸合一 (16/32/48/64/128/256) - 推荐·最佳兼容"); },
              "value": "all"
            },
            {
              get "label"() { return __ui("网页 Favicon (16 × 16 + 32 × 32)"); },
              "value": "favicon"
            },
            {
              get "label"() { return __ui("桌面应用标准 (32 × 32 + 48 × 48 + 256 × 256)"); },
              "value": "desktop"
            },
            {
              get "label"() { return __ui("256 × 256 (超高清大图标)"); },
              "value": "256"
            },
            {
              get "label"() { return __ui("128 × 128 (高清单尺寸)"); },
              "value": "128"
            },
            {
              get "label"() { return __ui("64 × 64 (中等尺寸)"); },
              "value": "64"
            },
            {
              get "label"() { return __ui("48 × 48 (Windows 默认大图标)"); },
              "value": "48"
            },
            {
              get "label"() { return __ui("32 × 32 (标准中等图标)"); },
              "value": "32"
            },
            {
              get "label"() { return __ui("16 × 16 (标准小图标)"); },
              "value": "16"
            }
          ],
          get "help"() { return __ui("选择生成的 ICO 图标内包含的分辨率尺寸"); }
        }
      ]
    },
  {
      "id": "gif-compress",
      get "name"() { return __ui("GIF 压缩"); },
      get "description"() { return __pdfTr("优化 GIF 动图编码，压缩效果取决于源文件", "Optimize GIF animation encoding; savings depend on the source file"); },
      "category": "image",
      "mode": "async",
      "icon": "Film",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("GIF 文件"); },
          "required": true
        }
      ]
    },
  {
      "id": "gif-crop",
      get "name"() { return __ui("GIF 裁剪"); },
      get "description"() { return __ui("裁剪 GIF 动图的指定区域"); },
      "category": "image",
      "mode": "async",
      "icon": "Scissors",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("GIF 文件"); },
          "required": true
        },
        {
          "id": "x",
          "type": "number",
          get "label"() { return __ui("起始 X 坐标"); },
          "required": true,
          "defaultValue": 0
        },
        {
          "id": "y",
          "type": "number",
          get "label"() { return __ui("起始 Y 坐标"); },
          "required": true,
          "defaultValue": 0
        },
        {
          "id": "width",
          "type": "number",
          get "label"() { return __ui("裁剪宽度"); },
          "required": true,
          "defaultValue": 100
        },
        {
          "id": "height",
          "type": "number",
          get "label"() { return __ui("裁剪高度"); },
          "required": true,
          "defaultValue": 100
        }
      ]
    },
  {
      "id": "image-rotate",
      get "name"() { return __ui("图片旋转"); },
      get "description"() { return __ui("旋转图片（支持 90 / 180 / 270 度，正对齐不留黑边）"); },
      "category": "image",
      "mode": "async",
      "icon": "RotateCw",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("图片文件"); },
          "required": true
        },
        {
          "id": "angle",
          "type": "number",
          get "label"() { return __ui("旋转角度"); },
          "required": true,
          "defaultValue": 90,
          get "help"() { return __ui("90=顺时针90度, 180=翻转, 270=逆时针90度"); }
        }
      ]
    },

  {
      "id": "image-exif",
      get "name"() { return __ui("图片 EXIF 查看"); },
      get "description"() { return __ui("读取照片的拍摄参数，包括机型、镜头、光圈、快门、ISO、拍摄时间与 GPS 位置"); },
      "category": "image",
      "mode": "sync",
      "icon": "Aperture",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("图片文件"); },
          "required": true,
          "accept": "image/*"
        }
      ]
    },
  {
      "id": "svg-optimize",
      get "name"() { return __ui("SVG 优化压缩"); },
      get "description"() { return __ui("清理 SVG 中的注释、编辑器元数据与冗余空白，在不改变渲染结果的前提下减小体积"); },
      "category": "image",
      "mode": "sync",
      "icon": "FileCode",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("SVG 文件"); },
          "required": true,
          "accept": ".svg,image/svg+xml"
        }
      ]
    }
  // ─────────────────────────────────────────────  视频工具 (download)  ──────────
,
  {
      "id": "video-download",
      get "name"() { return __ui("通用视频下载"); },
      get "description"() { return __ui("内嵌酷酷工具视频解析网站，支持范围以网站为准"); },
      "category": "download",
      "mode": "async",
      "icon": "Download",
      "selfHostOnly": true,
      get "disclaimer"() { return __ui("仅供个人使用。下载可能违反平台用户协议，请自行承担风险。"); },
      "inputs": [
        {
          "id": "url",
          "type": "url",
          get "label"() { return __ui("视频链接"); },
          "placeholder": "https://...",
          "required": true,
          get "help"() { return __ui("首次使用需要在弹出的窗口里登录：建议优先用 QQ 邮箱登录，谷歌登录容易被平台拦截"); }
        },
        {
          "id": "format",
          "type": "select",
          get "label"() { return __ui("下载内容"); },
          "required": true,
          "defaultValue": "mp4",
          "options": [
            {
              get "label"() { return __ui("视频 (MP4)"); },
              "value": "mp4"
            },
            {
              get "label"() { return __ui("音频 (MP3)"); },
              "value": "mp3"
            },
            {
              get "label"() { return __ui("封面 (JPG)"); },
              "value": "thumbnail"
            }
          ]
        },
        {
          "id": "quality",
          "type": "select",
          get "label"() { return __ui("画质"); },
          "required": true,
          "defaultValue": "best",
          "options": [
            {
              get "label"() { return __ui("最高画质"); },
              "value": "best"
            },
            {
              get "label"() { return __ui("1080p 最高"); },
              "value": "1080"
            },
            {
              get "label"() { return __ui("720p 最高"); },
              "value": "720"
            },
            {
              get "label"() { return __ui("480p 最高"); },
              "value": "480"
            }
          ]
        }
      ]
    },
  {
      "id": "bilibili-download",
      get "name"() { return __ui("B站视频提取"); },
      get "description"() { return __ui("提取并下载B站视频、音频或封面，支持高清画质"); },
      "category": "download",
      "mode": "async",
      "icon": "Video",
      "selfHostOnly": true,
      get "disclaimer"() { return __ui("仅供个人使用。下载可能违反B站用户协议。"); },
      "inputs": [
        {
          "id": "url",
          "type": "url",
          get "label"() { return __ui("B站视频链接"); },
          "placeholder": "https://www.bilibili.com/video/BV...",
          "required": true
        },
        {
          "id": "format",
          "type": "select",
          get "label"() { return __ui("下载内容"); },
          "required": true,
          "defaultValue": "mp4",
          "options": [
            {
              get "label"() { return __ui("视频 (MP4)"); },
              "value": "mp4"
            },
            {
              get "label"() { return __ui("音频 (MP3)"); },
              "value": "mp3"
            },
            {
              get "label"() { return __ui("封面 (JPG)"); },
              "value": "thumbnail"
            }
          ]
        },
        {
          "id": "quality",
          "type": "select",
          get "label"() { return __ui("画质"); },
          "required": true,
          "defaultValue": "best",
          "options": [
            {
              get "label"() { return __ui("最高画质"); },
              "value": "best"
            },
            {
              get "label"() { return __ui("1080p 最高"); },
              "value": "1080"
            },
            {
              get "label"() { return __ui("720p 最高"); },
              "value": "720"
            },
            {
              get "label"() { return __ui("480p 最高"); },
              "value": "480"
            }
          ]
        }
      ,
        {
          "id": "codec",
          "type": "select",
          get "label"() { return __ui("视频编码"); },
          "required": true,
          "defaultValue": "h264",
          "options": [
            {
              get "label"() { return __ui("H.264（任何播放器均可播放，下载体积会大一点）"); },
              "value": "h264"
            },
            {
              get "label"() { return __ui("AV1（下载体积很小，老式播放器可能不兼容）"); },
              "value": "av1"
            }
          ]
        }
      ]
    },
  {
      "id": "video-format-convert",
      get "name"() { return __ui("视频格式转换"); },
      get "description"() { return __ui("各种视频格式互转，支持 MP4、AVI、MOV、MKV、WebM、FLV 等"); },
      "category": "download",
      "mode": "async",
      "icon": "Repeat",
      "selfHostOnly": true,
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "multiple": true,
          get "label"() { return __ui("视频文件"); },
          "required": true
        },
        {
          "id": "format",
          "type": "select",
          get "label"() { return __ui("目标格式"); },
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
          get "label"() { return __ui("画质"); },
          "required": false,
          "defaultValue": "high",
          "options": [
            {
              get "label"() { return __ui("原画"); },
              "value": "original"
            },
            {
              get "label"() { return __ui("高画质"); },
              "value": "high"
            },
            {
              get "label"() { return __ui("中画质"); },
              "value": "medium"
            },
            {
              get "label"() { return __ui("低画质"); },
              "value": "low"
            }
          ]
        }
      ]
    },
  {
      "id": "video-compress",
      get "name"() { return __ui("视频压缩"); },
      get "description"() { return __ui("压缩视频文件大小，保持画质的同时减小体积"); },
      "category": "download",
      "mode": "async",
      "icon": "Minimize2",
      "selfHostOnly": true,
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("视频文件"); },
          "required": true
        },
        {
          "id": "quality",
          "type": "select",
          get "label"() { return __ui("压缩质量"); },
          "required": false,
          "defaultValue": "medium",
          "options": [
            {
              get "label"() { return __ui("高画质（体积较大）"); },
              "value": "high"
            },
            {
              get "label"() { return __ui("均衡"); },
              "value": "medium"
            },
            {
              get "label"() { return __ui("小体积（画质降低）"); },
              "value": "low"
            }
          ]
        },
        {
          "id": "maxSize",
          "type": "number",
          get "label"() { return __ui("目标大小 (MB)"); },
          "required": false,
          get "help"() { return __ui("设置后自动调整码率达到目标大小"); }
        }
      ]
    },
  {
      "id": "video-to-gif",
      get "name"() { return __ui("视频转 GIF"); },
      get "description"() { return __ui("将视频片段转换为 GIF 动图，支持截取时间段、调整尺寸和帧率"); },
      "category": "download",
      "mode": "async",
      "icon": "Film",
      "selfHostOnly": true,
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("视频文件"); },
          "required": true
        },
        {
          "id": "startTime",
          "type": "text",
          get "label"() { return __ui("开始时间 (秒)"); },
          "required": false,
          "defaultValue": "0",
          get "placeholder"() { return __ui("例如: 5"); }
        },
        {
          "id": "duration",
          "type": "text",
          get "label"() { return __ui("持续时长 (秒)"); },
          "required": false,
          "defaultValue": "5",
          get "placeholder"() { return __ui("例如: 3"); }
        },
        {
          "id": "width",
          "type": "number",
          get "label"() { return __ui("宽度 (像素)"); },
          "required": false,
          "defaultValue": 480,
          get "help"() { return __ui("高度自动等比缩放"); }
        },
        {
          "id": "fps",
          "type": "number",
          get "label"() { return __ui("帧率 (FPS)"); },
          "required": false,
          "defaultValue": 15,
          "min": 5,
          "max": 30
        }
      ]
    },
  {
      "id": "twitter-download",
      get "name"() { return __ui("推特视频提取"); },
      get "description"() { return __ui("提取并下载 Twitter/X 视频、GIF 或封面，支持多种画质与纯音频提取（需代理）"); },
      "category": "download",
      "mode": "async",
      "icon": "Twitter",
      "selfHostOnly": true,
      get "disclaimer"() { return __ui("需开启系统科学上网/网络代理工具才能正常提取与下载推特视频。仅供个人学习使用。"); },
      "inputs": [
        {
          "id": "url",
          "type": "url",
          get "label"() { return __ui("Twitter/X 视频链接"); },
          "placeholder": "https://x.com/username/status/...",
          "required": true
        },
        {
          "id": "format",
          "type": "select",
          get "label"() { return __ui("下载内容"); },
          "required": true,
          "defaultValue": "mp4",
          "options": [
            {
              get "label"() { return __ui("视频 (MP4)"); },
              "value": "mp4"
            },
            {
              get "label"() { return __ui("音频 (MP3)"); },
              "value": "mp3"
            },
            {
              get "label"() { return __ui("封面 (JPG)"); },
              "value": "thumbnail"
            }
          ]
        },
        {
          "id": "quality",
          "type": "select",
          get "label"() { return __ui("画质"); },
          "required": true,
          "defaultValue": "best",
          "options": [
            {
              get "label"() { return __ui("最高画质"); },
              "value": "best"
            },
            {
              get "label"() { return __ui("1080p 最高"); },
              "value": "1080"
            },
            {
              get "label"() { return __ui("720p 最高"); },
              "value": "720"
            },
            {
              get "label"() { return __ui("480p 最高"); },
              "value": "480"
            }
          ]
        }
      ]
    },
  {
      "id": "magnet-download",
      get "name"() { return __ui("磁力种子下载"); },
      get "description"() { return __ui("极速磁力链接与 BT 种子下载，内置优质 Tracker 加速与实时速度监控"); },
      "category": "hardware",
      "mode": "async",
      "icon": "Magnet",
      "selfHostOnly": true,
      get "disclaimer"() { return __ui("仅供个人下载合规资源，请遵守当地法律法规与版权协议。"); },
      "inputs": [
        {
          "id": "url",
          "type": "text",
          get "label"() { return __ui("磁力链接 / Torrent 文件"); },
          get "placeholder"() { return __ui("magnet:?xt=urn:btih:... 或拖入 .torrent 文件"); },
          "required": true
        }
      ]
    },
  {
      "id": "screen-recorder",
      get "name"() { return __ui("录屏"); },
      get "description"() { return __ui("原生窗口与区域录屏：指定窗口或框选区域，15/24/30/60 FPS、三档画质、可选录音设备与鼠标指针；支持暂停继续，结束校验并保存 MP4"); },
      "category": "download",
      "mode": "sync",
      "clientSide": true,
      "icon": "Video",
      "inputs": []
    },
  {
      "id": "video-trim",
      get "name"() { return __ui("视频裁剪"); },
      get "description"() { return __ui("按时间区间裁剪视频，支持不重编码的快速裁剪与切点精确的重编码裁剪"); },
      "category": "download",
      "mode": "async",
      "icon": "Scissors",
      "selfHostOnly": true,
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("视频文件"); },
          "required": true,
          "accept": "video/*"
        },
        {
          "id": "start",
          "type": "line",
          get "label"() { return __ui("开始时间"); },
          get "placeholder"() { return __ui("例如 00:00:10 或 10"); },
          "required": false,
          get "help"() { return __ui("留空表示从开头开始"); }
        },
        {
          "id": "end",
          "type": "line",
          get "label"() { return __ui("结束时间"); },
          get "placeholder"() { return __ui("例如 00:00:30 或 30"); },
          "required": false,
          get "help"() { return __ui("留空表示裁到结尾"); }
        },
        {
          "id": "mode",
          "type": "select",
          get "label"() { return __ui("裁剪方式"); },
          "required": true,
          "defaultValue": "fast",
          "options": [
            { get "label"() { return __ui("快速裁剪（不重编码，秒出，切点对齐关键帧）"); }, "value": "fast" },
            { get "label"() { return __ui("精确裁剪（重新编码，切点精确，稍慢）"); }, "value": "precise" }
          ],
          get "help"() { return __ui("快速裁剪不会重新编码，因此无损且很快，但切点会对齐到最近的关键帧，可能与设定时间差零点几秒"); }
        }
      ]
    },
  {
      "id": "video-frame-extract",
      get "name"() { return __ui("视频抽帧"); },
      get "description"() { return __ui("从视频的指定时间点提取一帧画面，输出 PNG 或 JPG 图片"); },
      "category": "download",
      "mode": "async",
      "icon": "ScanLine",
      "selfHostOnly": true,
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("视频文件"); },
          "required": true,
          "accept": "video/*"
        },
        {
          "id": "time",
          "type": "line",
          get "label"() { return __ui("取帧时间"); },
          get "placeholder"() { return __ui("例如 1.5 或 00:00:01.5"); },
          "required": false,
          get "help"() { return __ui("留空表示取第 0 秒；超出视频时长会提示视频总长度"); }
        },
        {
          "id": "format",
          "type": "select",
          get "label"() { return __ui("输出格式"); },
          "required": true,
          "defaultValue": "png",
          "options": [
            { get "label"() { return __ui("PNG（无损）"); }, "value": "png" },
            { get "label"() { return __ui("JPG（体积小）"); }, "value": "jpg" }
          ]
        },
        {
          "id": "width",
          "type": "number",
          get "label"() { return __ui("输出宽度（像素）"); },
          "required": false,
          get "help"() { return __ui("留空表示保持原始尺寸，填了会等比缩放"); }
        }
      ]
    }
  // ─────────────────────────────────────────────  音频工具 (audio)  ──────────
,
  {
      "id": "video-to-audio",
      get "name"() { return __ui("视频转音频"); },
      get "description"() { return __ui("从视频中提取音轨并转为 MP3、WAV、FLAC、AAC、M4A、OGG 等音频文件"); },
      "category": "audio",
      "mode": "async",
      "icon": "FileAudio",
      "selfHostOnly": true,
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("视频文件"); },
          "required": true,
          get "help"() { return __ui("支持 MP4、MOV、MKV、AVI、WebM、FLV 等常见视频格式"); }
        },
        {
          "id": "format",
          "type": "select",
          get "label"() { return __ui("输出音频格式"); },
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
              get "label"() { return __ui("FLAC（无损）"); },
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
          get "label"() { return __ui("比特率"); },
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
              get "label"() { return __ui("最高质量"); },
              "value": "lossless"
            }
          ]
        }
      ]
    },
  {
      "id": "audio-format-convert",
      get "name"() { return __ui("音频格式转换"); },
      get "description"() { return __ui("在 MP3、WAV、FLAC、AAC、OGG、M4A 等格式之间互相转换"); },
      "category": "audio",
      "mode": "async",
      "icon": "Music",
      "selfHostOnly": true,
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "multiple": true,
          get "label"() { return __ui("音频文件"); },
          "required": true
        },
        {
          "id": "format",
          "type": "select",
          get "label"() { return __ui("输出格式"); },
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
          get "label"() { return __ui("比特率"); },
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
              get "label"() { return __ui("最高质量"); },
              "value": "lossless"
            }
          ]
        }
      ]
    },
  {
      "id": "audio-merge",
      get "name"() { return __ui("音频合并"); },
      get "description"() { return __ui("将多个音频文件合并拼接成一个音频文件"); },
      "category": "audio",
      "mode": "async",
      "icon": "Merge",
      "selfHostOnly": true,
      "inputs": [
        {
          "id": "file",
          "type": "file",
          "multiple": true,
          get "label"() { return __ui("音频文件（多个）"); },
          "required": true,
          get "help"() { return __ui("按选择顺序合并"); }
        }
      ]
    },
  {
      "id": "audio-volume",
      get "name"() { return __ui("音量调节"); },
      get "description"() { return __ui("调节音频音量大小，支持自定义输出格式"); },
      "category": "audio",
      "mode": "async",
      "icon": "Volume2",
      "selfHostOnly": true,
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("音频文件"); },
          "required": true
        },
        {
          "id": "volume",
          "type": "number",
          get "label"() { return __ui("音量倍数 (0.1-5.0)"); },
          "required": false,
          "defaultValue": 1,
          "min": 0.1,
          "max": 5,
          "step": 0.1,
          get "help"() { return __ui("0.5=减半，2.0=翻倍"); }
        }
      ]
    },
  {
      "id": "spotify-download",
      get "name"() { return __ui("Spotify 下载"); },
      get "description"() { return __ui("从 Spotify 链接下载单曲、专辑或播放列表"); },
      "category": "audio",
      "mode": "async",
      "icon": "Music",
      "selfHostOnly": true,
      get "disclaimer"() { return __ui("仅供个人使用。Spotify 内容受版权保护，下载可能不可用或音质较低。"); },
      "inputs": [
        {
          "id": "url",
          "type": "url",
          get "label"() { return __ui("Spotify 链接"); },
          "placeholder": "https://open.spotify.com/track/...",
          "required": true
        },
        {
          "id": "format",
          "type": "select",
          get "label"() { return __ui("格式"); },
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
      get "name"() { return __ui("音频倒放"); },
      get "description"() { return __ui("将音频倒放播放，可自定义输出参数"); },
      "category": "audio",
      "mode": "async",
      "icon": "Music",
      "selfHostOnly": true,
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("音频文件"); },
          "required": true
        }
      ]
    },
  {
      "id": "audio-trim",
      get "name"() { return __ui("音频裁剪"); },
      get "description"() { return __ui("按时间区间裁剪音频，支持流复制与重编码两种方式"); },
      "category": "audio",
      "mode": "async",
      "icon": "Scissors",
      "selfHostOnly": true,
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("音频文件"); },
          "required": true,
          "accept": "audio/*"
        },
        {
          "id": "start",
          "type": "line",
          get "label"() { return __ui("开始时间"); },
          get "placeholder"() { return __ui("例如 00:10 或 10"); },
          "required": false,
          get "help"() { return __ui("留空表示从开头开始"); }
        },
        {
          "id": "end",
          "type": "line",
          get "label"() { return __ui("结束时间"); },
          get "placeholder"() { return __ui("例如 01:30 或 90"); },
          "required": false,
          get "help"() { return __ui("留空表示裁到结尾"); }
        },
        {
          "id": "mode",
          "type": "select",
          get "label"() { return __ui("裁剪方式"); },
          "required": true,
          "defaultValue": "fast",
          "options": [
            { get "label"() { return __ui("快速裁剪（不重编码）"); }, "value": "fast" },
            { get "label"() { return __ui("精确裁剪（重新编码）"); }, "value": "precise" }
          ]
        }
      ]
    },
  {
      "id": "vocal-separate",
      get "name"() { return __ui("人声分离"); },
      get "description"() { return tr("将人声与伴奏分成两条音轨，先试听再保存。支持快速、均衡和精细模式，使用本机 CPU 处理。", "Separate vocals and accompaniment, preview first, then save. Fast, balanced and detailed modes run locally on CPU."); },
      "category": "audio",
      "mode": "async",
      "icon": "Mic2",
      "inputs": [
        {
          "id": "model", "type": "select", get "label"() { return __ui("分离模型"); }, "required": true, "defaultValue": "vocals",
          "options": [
            { get "label"() { return __ui("人声模型（人声更准，伴奏由相减得到）"); }, "value": "vocals" },
            { get "label"() { return tr("伴奏模型（优先提取伴奏）", "Instrumental model (prioritize accompaniment)"); }, "value": "instrumental" }
          ],
          get "help"() { return tr("双核心在本页上方统一下载；每次仅运行选中的一个模型。", "Download the model pair above; each job runs only the selected model."); }
        },
        { "id": "quality", "type": "select", get "label"() { return tr("速度与质量", "Speed and quality"); }, "defaultValue": "balanced", "required": true,
          "options": [
            {"value":"fast", get "label"() {return tr("快速 · 单次推理，较少重叠", "Fast · Single pass, less overlap");}},
            {"value":"balanced", get "label"() {return tr("均衡（推荐）· 单次推理，平滑衔接", "Balanced (recommended) · Single pass, smooth overlap");}},
            {"value":"quality", get "label"() {return tr("精细 · 双次推理，耗时较长", "Detailed · Double pass, slower");}}
          ],
          get "help"() {return tr("均衡模式保留原来的分块重叠，省去第二次模型推理；精细模式保留双次处理。实际耗时取决于音频长度和 CPU，不保证固定倍速。", "Balanced keeps smooth overlap but omits the second inference pass. Detailed retains both passes. Time depends on audio length and CPU; no fixed speedup is guaranteed.");}
        },
        { "id": "file", "type": "file", get "label"() { return __ui("选择音频或视频"); }, "accept": ".mp3,.wav,.flac,.m4a,.aac,.ogg,.mp4,.mkv,.mov", "required": true,
          get "help"() { return __ui("视频文件也可以，会先取出其中音轨"); } }
      ]
    },
  {
      "id": "audio-denoise",
      get "name"() { return __ui("音频降噪"); },
      get "description"() { return __ui("压掉录音里的底噪、电流声与嘶嘶声：在不损伤人声与音乐的前提下，把一直存在的背景噪声压低。实时预览不可用，处理在本机完成，不需要下载模型"); },
      "category": "audio",
      "mode": "async",
      "icon": "VolumeX",
      "inputs": [
        { "id": "file", "type": "file", get "label"() { return __ui("选择音频"); }, "accept": ".mp3,.wav,.flac,.m4a,.aac,.ogg,.mp4,.mkv,.mov", "required": true,
          get "help"() { return __ui("视频文件也可以，会先取出其中音轨"); } },
        {
          "id": "strength", "type": "select", get "label"() { return __ui("降噪强度"); }, "required": true, "defaultValue": "0.6",
          "options": [
            { get "label"() { return __ui("轻微（0.3，只压底噪，最大限度保留原声）"); }, "value": "0.3" },
            { get "label"() { return __ui("适中（0.6，推荐）"); }, "value": "0.6" },
            { get "label"() { return __ui("较强（1.0，噪声很重时用）"); }, "value": "1" }
          ]
        },
        {
          "id": "percentile", "type": "select", get "label"() { return __ui("噪声底估计"); }, "required": false, "defaultValue": "5",
          "options": [
            { get "label"() { return __ui("按最安静的 5% 估计（默认，适合噪声一直存在）"); }, "value": "5" },
            { get "label"() { return __ui("按最安静的 15% 估计（噪声起伏大时更稳）"); }, "value": "15" }
          ]
        },
        {
          "id": "oversubtract", "type": "select", get "label"() { return __ui("压制力度"); }, "required": false, "defaultValue": "1",
          "options": [
            { get "label"() { return __ui("标准（1.0）"); }, "value": "1" },
            { get "label"() { return __ui("更强（1.5，可能让人声略闷）"); }, "value": "1.5" }
          ]
        }
      ]
    },
  {
      "id": "audio-transcribe",
      get "name"() { return __ui("音频转文字"); },
      get "description"() { return __ui("本地语音识别，将音频或视频中的人声转为文字，可导出 TXT 文本与 SRT 字幕"); },
      "category": "audio",
      "mode": "async",
      "icon": "Mic",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("选择音频或视频"); },
          "accept": "audio/*,video/*,.mp3,.wav,.m4a,.aac,.flac,.ogg,.wma,.mp4,.mkv,.mov,.avi,.flv,.wmv",
          "required": true,
          get "help"() { return __ui("支持常见音频与视频格式；视频文件将先自动提取音轨再识别"); }
        },
        {
          "id": "model",
          "type": "select",
          get "label"() { return __ui("语音模型"); },
          "required": true,
          "defaultValue": "large-v3-turbo-q5_0",
          get "help"() { return __ui("模型体积越大，识别准确率越高、处理越慢；未下载的模型需先在页面中下载"); },
          "options": [
            { get "label"() { return __ui("极速版（77MB）"); }, "value": "tiny" },
            { get "label"() { return __ui("轻量版（148MB）"); }, "value": "base" },
            { get "label"() { return __ui("标准版省空间（190MB）"); }, "value": "small-q5_1" },
            { get "label"() { return __ui("标准版（488MB）"); }, "value": "small" },
            { get "label"() { return __ui("高精度版（574MB，推荐）"); }, "value": "large-v3-turbo-q5_0" },
            { get "label"() { return __ui("专业版（1.5GB）"); }, "value": "medium" },
            { get "label"() { return __ui("最高精度版（3.1GB）"); }, "value": "large-v3" }
          ]
        },
        {
          "id": "language",
          "type": "select",
          get "label"() { return __ui("语言"); },
          "required": true,
          "defaultValue": "auto",
          "options": [
            { get "label"() { return __ui("自动识别"); }, "value": "auto" },
            { get "label"() { return __ui("中文"); }, "value": "zh" },
            { get "label"() { return __ui("英语"); }, "value": "en" },
            { get "label"() { return __ui("日语"); }, "value": "ja" },
            { get "label"() { return __ui("韩语"); }, "value": "ko" },
            { get "label"() { return __ui("粤语"); }, "value": "yue" },
            { get "label"() { return __ui("法语"); }, "value": "fr" },
            { get "label"() { return __ui("德语"); }, "value": "de" },
            { get "label"() { return __ui("西班牙语"); }, "value": "es" },
            { get "label"() { return __ui("俄语"); }, "value": "ru" }
          ]
        },
        {
          "id": "output",
          "type": "select",
          get "label"() { return __ui("输出格式"); },
          "required": true,
          "defaultValue": "txt",
          "options": [
            { get "label"() { return __ui("纯文本 TXT"); }, "value": "txt" },
            { get "label"() { return __ui("字幕 SRT（带时间轴）"); }, "value": "srt" },
            { get "label"() { return __ui("两者都要"); }, "value": "both" }
          ]
        }
      ]
    }
  // ─────────────────────────────────────────────  PDF 工具 (pdf)  ──────────
,
  {
      "id": "pdf-to-word",
      get "name"() { return __ui("PDF 转 Word"); },
      get "description"() { return __ui("将 PDF 转换为可编辑的 Word 文档"); },
      "category": "pdf",
      "mode": "async",
      "icon": "FileText",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("PDF 文件"); },
          "required": true
        }
      ]
    },
  {
      "id": "pdf-to-images",
      get "name"() { return __ui("PDF 转图片"); },
      get "description"() { return __ui("将 PDF 每页转换为图片（PNG/JPG）"); },
      "category": "pdf",
      "mode": "async",
      "clientSide": true,
      "icon": "Image",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("PDF 文件"); },
          "required": true
        },
        {
          "id": "format",
          "type": "select",
          get "label"() { return __ui("输出格式"); },
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
          get "label"() { return __ui("图片清晰度 (DPI)"); },
          "required": false,
          "defaultValue": 150,
          "min": 72,
          "max": 300
        }
      ]
    },
  {
      "id": "pdf-compress",
      get "name"() { return __ui("PDF 压缩"); },
      get "description"() { return __ui("压缩 PDF 文件大小，优化图片质量"); },
      "category": "pdf",
      "mode": "async",
      "icon": "Minimize2",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("PDF 文件"); },
          "required": true
        },
        {
          "id": "quality",
          "type": "number",
          get "label"() { return __ui("图片质量 (1-100)"); },
          "required": false,
          "defaultValue": 75,
          "min": 1,
          "max": 100
        }
      ]
    },
  {
      "id": "pdf-merge",
      get "name"() { return __ui("PDF 合并"); },
      get "description"() { return __ui("将多个 PDF 文件按顺序合并为一个"); },
      "category": "pdf",
      "mode": "async",
      "icon": "Merge",
      "inputs": [
        {
          "id": "files",
          "type": "file",
          get "label"() { return __ui("PDF 文件（可多选，按顺序合并）"); },
          "required": true,
          "multiple": true
        }
      ]
    },
  {
      "id": "pdf-split",
      get "name"() { return __ui("PDF 分割"); },
      get "description"() { return __ui("按页码范围将 PDF 分割成多个文件"); },
      "category": "pdf",
      "mode": "async",
      "icon": "Split",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("PDF 文件"); },
          "required": true
        },
        {
          "id": "ranges",
          "type": "text",
          get "label"() { return __ui("分割范围"); },
          "required": true,
          "defaultValue": "1-5,6-10",
          get "placeholder"() { return __ui("例如: 1-3,5,7-9"); },
          get "help"() { return __ui("用逗号分隔多个范围，如 1-3,5,7-9"); }
        }
      ]
    },
  {
      "id": "pdf-unlock",
      get "name"() { return __ui("解锁 PDF"); },
      get "description"() { return __ui("移除 PDF 的密码和权限限制"); },
      "category": "pdf",
      "mode": "async",
      "icon": "Unlock",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("PDF 文件"); },
          "required": true
        },
        {
          "id": "password",
          "type": "text",
          get "label"() { return __ui("密码（如需要）"); },
          "required": false,
          get "placeholder"() { return __ui("输入 PDF 密码"); }
        }
      ]
    },
  {
      "id": "pdf-encrypt",
      get "name"() { return __ui("加密 PDF"); },
      get "description"() { return __ui("为 PDF 添加密码和权限保护"); },
      "category": "pdf",
      "mode": "async",
      "icon": "Lock",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("PDF 文件"); },
          "required": true
        },
        {
          "id": "user_password",
          "type": "text",
          get "label"() { return __ui("打开密码"); },
          "required": false,
          get "placeholder"() { return __ui("设置打开 PDF 的密码"); }
        },
        {
          "id": "owner_password",
          "type": "text",
          get "label"() { return __ui("管理员密码"); },
          "required": false,
          get "placeholder"() { return __ui("设置权限管理密码"); }
        }
      ]
    },
  {
      "id": "pdf-watermark",
      get "name"() { return __ui("pdf添加水印"); },
      get "description"() { return __ui("为 PDF 添加文字水印"); },
      "category": "pdf",
      "mode": "async",
      "icon": "Droplet",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("PDF 文件"); },
          "required": true
        },
        {
          "id": "text",
          "type": "text",
          get "label"() { return __ui("水印文字"); },
          "required": true,
          "defaultValue": "CONFIDENTIAL"
        },
        {
          "id": "font_size",
          "type": "number",
          get "label"() { return __ui("字体大小"); },
          "required": false,
          "defaultValue": 40,
          "min": 10,
          "max": 100
        },
        {
          "id": "opacity",
          "type": "number",
          get "label"() { return __ui("透明度 (0-1)"); },
          "required": false,
          "defaultValue": 0.3,
          "min": 0.1,
          "max": 1,
          "step": 0.1
        },
        {
          "id": "rotation",
          "type": "number",
          get "label"() { return __ui("旋转角度"); },
          "required": false,
          "defaultValue": 45,
          "min": 0,
          "max": 360
        }
      ]
    },
  {
      "id": "pdf-delete-pages",
      get "name"() { return __ui("PDF 删页面"); },
      get "description"() { return __ui("删除 PDF 中指定的页面"); },
      "category": "pdf",
      "mode": "async",
      "icon": "Trash2",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("PDF 文件"); },
          "required": true
        },
        {
          "id": "pages",
          "type": "text",
          get "label"() { return __ui("要删除的页码"); },
          "required": true,
          "defaultValue": "1,3,5",
          get "placeholder"() { return __ui("例如: 1,3,5-7"); },
          get "help"() { return __ui("用逗号分隔，支持范围如 5-7"); }
        }
      ]
    },
  {
      "id": "pdf-reorder",
      get "name"() { return __ui("PDF 改页面顺序"); },
      get "description"() { return __ui("重新排列 PDF 页面的顺序"); },
      "category": "pdf",
      "mode": "async",
      "icon": "ArrowUpDown",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("PDF 文件"); },
          "required": true
        },
        {
          "id": "order",
          "type": "text",
          get "label"() { return __ui("新的页面顺序"); },
          "required": true,
          "defaultValue": "3,1,2,4",
          get "placeholder"() { return __ui("例如: 3,1,2,4"); },
          get "help"() { return __ui("按新顺序列出所有页码，从1开始"); }
        }
      ]
    },
  {
      "id": "pdf-page-numbers",
      get "name"() { return __ui("PDF 添加页码"); },
      get "description"() { return __ui("为 PDF 添加页码，支持多种位置和样式"); },
      "category": "pdf",
      "mode": "async",
      "icon": "Hash",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("PDF 文件"); },
          "required": true
        },
        {
          "id": "position",
          "type": "select",
          get "label"() { return __ui("页码位置"); },
          "required": true,
          "defaultValue": "bottom-center",
          "options": [
            {
              get "label"() { return __ui("底部居中"); },
              "value": "bottom-center"
            },
            {
              get "label"() { return __ui("底部左侧"); },
              "value": "bottom-left"
            },
            {
              get "label"() { return __ui("底部右侧"); },
              "value": "bottom-right"
            },
            {
              get "label"() { return __ui("顶部居中"); },
              "value": "top-center"
            },
            {
              get "label"() { return __ui("顶部左侧"); },
              "value": "top-left"
            },
            {
              get "label"() { return __ui("顶部右侧"); },
              "value": "top-right"
            }
          ]
        },
        {
          "id": "font_size",
          "type": "number",
          get "label"() { return __ui("字体大小"); },
          "required": false,
          "defaultValue": 12,
          "min": 8,
          "max": 36
        },
        {
          "id": "start_from",
          "type": "number",
          get "label"() { return __ui("起始页码"); },
          "required": false,
          "defaultValue": 1,
          "min": 1
        }
      ]
    },
  {
      "id": "pdf-rotate",
      get "name"() { return __ui("PDF 旋转"); },
      get "description"() { return __ui("旋转 PDF 页面，支持顺时针、逆时针、180度"); },
      "category": "pdf",
      "mode": "async",
      "icon": "RotateCw",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("PDF 文件"); },
          "required": true
        },
        {
          "id": "rotation",
          "type": "select",
          get "label"() { return __ui("旋转角度"); },
          "required": true,
          "defaultValue": "90",
          "options": [
            {
              get "label"() { return __ui("顺时针 90°"); },
              "value": "90"
            },
            {
              get "label"() { return __ui("180° 翻转"); },
              "value": "180"
            },
            {
              get "label"() { return __ui("逆时针 90°"); },
              "value": "270"
            }
          ]
        },
        {
          "id": "pages",
          "type": "text",
          get "label"() { return __ui("页面范围"); },
          "required": false,
          "defaultValue": "all",
          get "placeholder"() { return __ui("all 或 1,3,5-7"); },
          get "help"() { return __ui("all=所有页面，或指定页码如 1,3,5-7"); }
        }
      ]
    },
  {
      "id": "pdf-extract-images",
      get "name"() { return __pdfTr("PDF 提取图片", "Extract images from PDF"); },
      get "description"() { return __ui("从 PDF 中提取所有嵌入的图片"); },
      "category": "pdf",
      "mode": "async",
      "icon": "Image",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("PDF 文件"); },
          "required": true
        }
      ]
    },
  {
      "id": "word-to-pdf",
      get "name"() { return __ui("Word 转 PDF"); },
      get "description"() { return __ui("将 Word 文档转换为 PDF"); },
      "category": "pdf",
      "mode": "async",
      "icon": "FileText",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("Word 文件 (.docx/.doc)"); },
          "required": true
        }
      ]
    },
  {
      "id": "excel-to-pdf",
      get "name"() { return __ui("Excel 转 PDF"); },
      get "description"() { return __ui("将 Excel 表格转换为 PDF"); },
      "category": "pdf",
      "mode": "async",
      "icon": "Table",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("Excel 文件 (.xlsx/.xls)"); },
          "required": true
        }
      ]
    },
  {
      "id": "ppt-to-pdf",
      get "name"() { return __ui("PPT 转 PDF"); },
      get "description"() { return __ui("将 PowerPoint 演示文稿转换为 PDF"); },
      "category": "pdf",
      "mode": "async",
      "icon": "Presentation",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("PPT 文件 (.pptx/.ppt)"); },
          "required": true
        }
      ]
    },
  {
      "id": "pdf-to-excel",
      get "name"() { return __ui("PDF 转 Excel"); },
      get "description"() { return __ui("将 PDF 中的表格转换为 Excel"); },
      "category": "pdf",
      "mode": "async",
      "icon": "Table",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("PDF 文件"); },
          "required": true
        }
      ]
    },
  {
      "id": "pdf-to-ppt",
      get "name"() { return __ui("PDF 转 PPT"); },
      get "description"() { return __ui("将 PDF 每页转为 PPT 幻灯片"); },
      "category": "pdf",
      "mode": "async",
      "icon": "Presentation",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("PDF 文件"); },
          "required": true
        },
        {
          "id": "dpi",
          "type": "number",
          get "label"() { return __ui("图片清晰度 (DPI)"); },
          "required": false,
          "defaultValue": 150,
          "min": 72,
          "max": 300
        }
      ]
    }
  // ─────────────────────────────────────────────  生活办公 (utility)  ──────────
,
  {
      "id": "pomodoro",
      get "name"() { return __ui("番茄钟"); },
      get "description"() { return __ui("专注计时器，支持专注与休息交替、自定义时长与今日完成计数"); },
      "category": "utility",
      "mode": "sync",
      "icon": "Timer",
      "subcategory": "life",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "time-toolbox",
      get "name"() { return __ui("时间管理大师"); },
      get "description"() { return __ui("数字时钟、模拟时钟、倒计时、闹钟、倒数日与秒表，支持一键全屏显示"); },
      "category": "utility",
      "mode": "sync",
      "icon": "Clock",
      "subcategory": "life",
      "clientSide": true,
      "inputs": []
    },
  {
      "id": "qr-generator",
      get "name"() { return __ui("二维码生成"); },
      get "description"() { return __ui("支持网址、文本、WiFi、名片与微型文件，支持中心 Logo 嵌入与实时扫码校验"); },
      "category": "image",
      "mode": "sync",
      "clientSide": true,
      "icon": "QrCode",
      "subcategory": "life",
      "inputs": [
        {
          "id": "text",
          "type": "text",
          get "label"() { return __ui("文字或链接"); },
          "required": true,
          "placeholder": "https://example.com"
        },
        {
          "id": "size",
          "type": "number",
          get "label"() { return __ui("尺寸 (像素)"); },
          "required": true,
          "defaultValue": 512,
          "min": 64,
          "max": 2048
        },
        {
          "id": "ecc",
          "type": "select",
          get "label"() { return __ui("纠错等级"); },
          "required": true,
          "defaultValue": "M",
          "options": [
            {
              get "label"() { return __ui("低 (L)"); },
              "value": "L"
            },
            {
              get "label"() { return __ui("中 (M)"); },
              "value": "M"
            },
            {
              get "label"() { return __ui("较高 (Q)"); },
              "value": "Q"
            },
            {
              get "label"() { return __ui("高 (H)"); },
              "value": "H"
            }
          ]
        }
      ]
    },
  {
      "id": "qr-decoder",
      get "name"() { return __ui("二维码解码器"); },
      get "description"() { return __ui("本地识别二维码，支持区域框选、同图多码、复制内容与导出文本"); },
      "category": "image",
      "mode": "sync",
      "icon": "ScanLine",
      "subcategory": "life",
      "clientSide": true,
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("二维码图片"); },
          "required": true,
          "accept": "image/*"
        }
      ]
    },
  {
      "id": "lan-transfer",
      get "name"() { return __ui("跨设备互传"); },
      get "description"() { return __ui("手机电脑极速跨端快传，连接同一 Wi-Fi 或手机热点，手机免装 App 扫码即传，双向秒通"); },
      "category": "hardware",
      "mode": "sync",
      "icon": "Share2",
      "subcategory": "life",
      "clientSide": true,
      "inputs": []
    },
  {
      "id": "batch-rename",
      get "name"() { return __ui("批量重命名"); },
      get "description"() { return __ui("文件夹原地改名或多文件打包ZIP，支持名称预览、序号、替换、前后缀与重名预检"); },
      "category": "hardware",
      "mode": "sync",
      "clientSide": true,
      "icon": "Edit3",
      "subcategory": "life",
      "inputs": []
    },
  {
      "id": "bmi-calculator",
      get "name"() { return __ui("BMI 计算器"); },
      get "description"() { return __ui("根据身高体重计算 BMI 指数，评估健康状况"); },
      "category": "utility",
      "mode": "sync",
      "icon": "Heart",
      "subcategory": "life",
      "clientSide": true,
      "inputs": [
        {
          "id": "height",
          "type": "number",
          get "label"() { return __ui("身高（cm）"); },
          "required": true,
          "defaultValue": "170"
        },
        {
          "id": "weight",
          "type": "number",
          get "label"() { return __ui("体重（kg）"); },
          "required": true,
          "defaultValue": "65"
        }
      ]
    },
  {
      "id": "media-tracker",
      get "name"() { return __ui("观影追番读书记录器"); },
      get "description"() { return __ui("记录看过的电影、番剧和书籍，打分写短评，统计年度影视书影回顾"); },
      "category": "utility",
      "mode": "sync",
      "clientSide": true,
      "icon": "BookOpen",
      "subcategory": "life",
      "inputs": []
    },
  {
      "id": "periodic-table",
      get "name"() { return __ui("元素周期表"); },
      get "description"() { return __ui("化学元素周期表，展示元素基本信息"); },
      "category": "mathcalc",
      "mode": "sync",
      "icon": "Atom",
      "subcategory": "life",
      "clientSide": true,
      "inputs": []
    },
  {
      "id": "perler-beads",
      get "name"() { return __ui("拼豆图纸"); },
      get "description"() { return __ui("把图片转成拼豆图纸，输出带色号的网格图与用料清单"); },
      "category": "image",
      "mode": "sync",
      "icon": "Grid3x3",
      "subcategory": "life",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "bar-chart",
      get "name"() { return __ui("柱状图"); },
      get "description"() { return __ui("根据数据生成柱状图，支持自定义数据"); },
      "category": "mathcalc",
      "icon": "BarChart",
      "subcategory": "work",
      "mode": "sync",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "line-chart",
      get "name"() { return __ui("折线图"); },
      get "description"() { return __ui("根据数据生成折线图，支持自定义数据"); },
      "category": "mathcalc",
      "icon": "LineChart",
      "subcategory": "work",
      "mode": "sync",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "pie-chart",
      get "name"() { return __ui("饼图"); },
      get "description"() { return __ui("根据数据生成饼图，支持自定义数据"); },
      "category": "mathcalc",
      "icon": "PieChart",
      "subcategory": "work",
      "mode": "sync",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "scatter-chart",
      get "name"() { return __ui("散点图"); },
      get "description"() { return __ui("根据数据生成散点图，支持自定义数据"); },
      "category": "mathcalc",
      "icon": "ChartScatter",
      "subcategory": "work",
      "mode": "sync",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "mind-map",
      get "name"() { return __ui("思维导图"); },
      get "description"() { return __ui("在线创建和编辑思维导图，支持节点编辑、拖拽、导出图片"); },
      "category": "utility",
      "mode": "sync",
      "clientSide": true,
      "icon": "Network",
      "subcategory": "work",
      "inputs": []
    },
  {
      "id": "word-cloud",
      get "name"() { return __ui("文字云"); },
      get "description"() { return __ui("从文本生成文字云，按词频决定字号，支持配色方案与形状遮罩，可导出 SVG 与 PNG"); },
      "category": "image",
      "mode": "sync",
      "icon": "Type",
      "subcategory": "work",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "business-card",
      get "name"() { return __ui("名片生成器"); },
      get "description"() { return __ui("填写信息并选择模板，实时预览名片效果，可导出 2 倍分辨率 PNG"); },
      "category": "image",
      "mode": "sync",
      "icon": "CreditCard",
      "subcategory": "work",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "signature-designer",
      get "name"() { return __ui("艺术与电子签名"); },
      get "description"() { return __ui("一笔艺术签、连笔商务签、平滑手写板与印章设计，一键导出透明电子合同签名"); },
      "category": "image",
      "mode": "sync",
      "icon": "PenTool",
      "subcategory": "work",
      "clientSide": true,
      "inputs": []
    },
  {
      "id": "color-palette",
      get "name"() { return __ui("配色灵感工具"); },
      get "description"() { return __ui("色彩关系生成、图片主色提取、锁定色块、对比度检查与CSS/JSON/PNG导出"); },
      "category": "image",
      "mode": "sync",
      "clientSide": true,
      "icon": "Palette",
      "subcategory": "work",
      "inputs": []
    },
  {
      "id": "color-convert",
      get "name"() { return __ui("颜色转换"); },
      get "description"() { return __ui("在 HEX、RGB、HSL 之间转换颜色，带实时预览"); },
      "category": "image",
      "mode": "sync",
      "icon": "Palette",
      "subcategory": "work",
      "clientSide": true,
      "inputs": [
        {
          "id": "color",
          "type": "text",
          get "label"() { return __ui("颜色值"); },
          "required": true
        }
      ]
    }
  // ─────────────────────────────────────────────  文本工具 (text)  ──────────
,
  {
      "id": "text-lines",
      get "name"() { return __ui("文本行处理"); },
      get "description"() { return __ui("一个页面搞定十几类文本整理：行排序、行去重、清理空行与空格、批量加前后缀、批量加行号、行序反转、行列互换、按分隔符拆列导出 CSV、正则提取、多行合并、命名风格转换、文本统计与词频"); },
      "category": "text",
      "mode": "sync",
      "clientSide": true,
      "icon": "Rows3",
      "inputs": []
    },
  {
      "id": "word-count",
      get "name"() { return __ui("字数统计"); },
      get "description"() { return __ui("快速统计文本字数、字符数、段落数、行数等信息"); },
      "category": "text",
      "mode": "sync",
      "icon": "Type",
      "clientSide": true,
      "inputs": [
        {
          "id": "text",
          "type": "text",
          get "label"() { return __ui("文本内容"); },
          "required": true
        }
      ]
    },
  {
      "id": "text-replace",
      get "name"() { return __ui("文本替换工具"); },
      get "description"() { return __ui("支持普通文本替换和正则表达式替换，支持区分大小写"); },
      "category": "text",
      "mode": "sync",
      "icon": "Replace",
      "clientSide": true,
      "inputs": [
        {
          "id": "text",
          "type": "text",
          get "label"() { return __ui("原文本"); },
          "required": true
        },
        {
          "id": "find",
          "type": "text",
          get "label"() { return __ui("查找内容"); },
          "required": true
        },
        {
          "id": "replace",
          "type": "text",
          get "label"() { return __ui("替换为"); },
          "required": false,
          "defaultValue": ""
        }
      ]
    },
  {
      "id": "text-compare",
      get "name"() { return __ui("文本对比工具"); },
      get "description"() { return __ui("对比两段文本，高亮显示差异"); },
      "category": "text",
      "mode": "sync",
      "icon": "GitCompare",
      "clientSide": true,
      "inputs": [
        {
          "id": "text1",
          "type": "text",
          get "label"() { return __ui("文本1"); },
          "required": true
        },
        {
          "id": "text2",
          "type": "text",
          get "label"() { return __ui("文本2"); },
          "required": true
        }
      ]
    },
  {
      "id": "translator",
      get "name"() { return __ui("多语言翻译"); },
      get "description"() { return __ui("中英日韩法德俄西等常用语言互译，可自动识别源语言，也支持对接自建的翻译接口"); },
      "category": "text",
      "mode": "sync",
      "icon": "Languages",
      "clientSide": true,
      "inputs": []
    },
  {
      "id": "markdown-preview",
      get "name"() { return __ui("Markdown 预览"); },
      get "description"() { return __ui("编写 Markdown 并实时查看渲染效果，左右分屏显示"); },
      "category": "text",
      "mode": "sync",
      "icon": "FileCode",
      "clientSide": true,
      "inputs": [
        {
          "id": "markdown",
          "type": "text",
          get "label"() { return __ui("Markdown 内容"); },
          "required": true
        }
      ]
    },
  {
      "id": "text-dedup",
      get "name"() { return __ui("文本去重"); },
      get "description"() { return __ui("去除重复行，支持保留顺序或排序，实时显示统计信息"); },
      "category": "text",
      "mode": "sync",
      "icon": "Filter",
      "clientSide": true,
      "inputs": [
        {
          "id": "text",
          "type": "text",
          get "label"() { return __ui("文本内容（每行一条）"); },
          "required": true
        }
      ]
    },
  {
      "id": "case-converter",
      get "name"() { return __ui("大小写转换"); },
      get "description"() { return __ui("文本大小写转换，支持全部大写、全部小写、首字母大写、大小写反转"); },
      "category": "text",
      "mode": "sync",
      "icon": "Type",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "chinese-converter",
      get "name"() { return __ui("繁简转换"); },
      get "description"() { return __ui("简体中文和繁体中文互相转换"); },
      "category": "text",
      "mode": "sync",
      "clientSide": true,
      "icon": "Languages",
      "inputs": []
    },
  {
      "id": "pinyin-converter",
      get "name"() { return __ui("拼音转换工具"); },
      get "description"() { return __ui("汉字转拼音，支持声调显示"); },
      "category": "text",
      "mode": "sync",
      "icon": "Languages",
      "clientSide": true,
      "inputs": [
        {
          "id": "text",
          "type": "text",
          get "label"() { return __ui("汉字"); },
          "required": true,
          "defaultValue": "你好世界"
        }
      ]
    },
  {
      "id": "fullwidth-halfwidth",
      get "name"() { return __ui("全角半角转换"); },
      get "description"() { return __ui("全角和半角字符相互转换"); },
      "category": "text",
      "mode": "sync",
      "icon": "ALargeSmall",
      "clientSide": true,
      "inputs": [
        {
          "id": "text",
          "type": "text",
          get "label"() { return __ui("文本内容"); },
          "required": true
        },
        {
          "id": "mode",
          "type": "select",
          get "label"() { return __ui("转换方向"); },
          "required": true,
          "defaultValue": "toHalf",
          "options": [
            {
              get "label"() { return __ui("全角→半角"); },
              "value": "toHalf"
            },
            {
              get "label"() { return __ui("半角→全角"); },
              "value": "toFull"
            }
          ]
        }
      ]
    },
  {
      "id": "special-symbols",
      get "name"() { return __ui("特殊符号大全"); },
      get "description"() { return __ui("常用特殊符号、表情符号、箭头符号等"); },
      "category": "text",
      "mode": "sync",
      "icon": "Smile",
      "clientSide": true,
      "inputs": []
    },
  {
      "id": "markdown-to-pdf",
      get "name"() { return __ui("Markdown 转 PDF"); },
      get "description"() { return __ui("把 Markdown 排版成 PDF 文档，支持中文标题、列表、引用与代码块"); },
      "category": "pdf",
      "mode": "async",
      "icon": "FileText",
      "selfHostOnly": true,
      "inputs": [
        {
          "id": "text",
          "type": "text",
          get "label"() { return __ui("Markdown 内容"); },
          "required": false,
          get "help"() { return __ui("直接在编辑器里写 Markdown，或上传 .md 文件"); }
        },
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("Markdown 文件"); },
          "required": false,
          "accept": ".md,.markdown,.txt"
        },
        {
          "id": "page_size",
          "type": "select",
          get "label"() { return __ui("纸张大小"); },
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
          get "label"() { return __ui("正文字号"); },
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
      get "name"() { return __ui("ASCII 艺术字"); },
      get "description"() { return __ui("把文字拼成大字符画，14 种字体风格可选，中英文混排；也能把图片转成字符画"); },
      "category": "text",
      "mode": "sync",
      "icon": "ALargeSmall",
      "clientSide": true,
      "inputs": []
    },
  {
      "id": "fancy-text",
      get "name"() { return __ui("花体文字转换"); },
      get "description"() { return __ui("将普通文字转换为各种花体字体样式"); },
      "category": "text",
      "mode": "sync",
      "icon": "Type",
      "clientSide": true,
      "inputs": [
        {
          "id": "text",
          "type": "text",
          get "label"() { return __ui("输入文字"); },
          "required": true,
          "defaultValue": "Hello World"
        }
      ]
    }
  // ─────────────────────────────────────────────  数理工具 (mathcalc)  ──────────
,
  {
      "id": "simple-calculator",
      get "name"() { return __ui("全功能科学计算器"); },
      get "description"() { return __ui("支持标准日常、科学函数、程序员多进制位运算与交互式点阵计算"); },
      "category": "mathcalc",
      "mode": "sync",
      "icon": "Calculator",
      "subcategory": "math",
      "clientSide": true,
      "inputs": [
        {
          "id": "expression",
          "type": "text",
          get "label"() { return __ui("表达式"); },
          "required": false,
          get "placeholder"() { return __ui("例如：1+2*3"); }
        }
      ]
    },
  {
      "id": "function-graph",
      get "name"() { return __ui("函数图像"); },
      get "description"() { return __ui("二维与三维函数绘图，支持显函数、隐函数、参数方程、极坐标与曲面渲染，可缩放平移并分析零点、极值、导数与积分"); },
      "category": "mathcalc",
      "mode": "sync",
      "icon": "LineChart",
      "subcategory": "math",
      "clientSide": true,
      "inputs": []
    },
  {
      "id": "advanced-math",
      get "name"() { return __ui("高等数学运算"); },
      get "description"() { return __ui("符号求导、极限、积分、级数、微分方程与线性代数运算，给出分步过程与数值佐证"); },
      "category": "mathcalc",
      "mode": "sync",
      "icon": "Sigma",
      "subcategory": "math",
      "clientSide": true,
      "inputs": []
    },
  {
      "id": "geometry-calculator",
      get "name"() { return __ui("几何计算器"); },
      get "description"() { return __ui("平面图形、立体图形与坐标几何的面积、周长、体积、表面积与角度计算，支持多种已知条件"); },
      "category": "mathcalc",
      "mode": "sync",
      "icon": "Shapes",
      "subcategory": "math",
      "clientSide": true,
      "inputs": []
    },
  {
      "id": "func-calc",
      get "name"() { return __ui("函数计算器"); },
      get "description"() { return __ui("外贸进出口单价、人带料核算、复利金融工程与自定义函数动态公式计算"); },
      "category": "mathcalc",
      "mode": "sync",
      "icon": "FunctionSquare",
      "subcategory": "math",
      "clientSide": true,
      "inputs": []
    },
  {
      "id": "unit-converter",
      get "name"() { return __ui("单位换算"); },
      get "description"() { return __ui("长度、面积、体积、质量、温度、时间、速度、压力、能量、功率、数据存储等 28 类共 360 多个单位互转"); },
      "category": "mathcalc",
      "mode": "sync",
      "icon": "Ruler",
      "subcategory": "calc",
      "clientSide": true,
      "inputs": []
    },
  {
      "id": "tax-calculator",
      get "name"() { return __ui("综合税金税率计算器"); },
      get "description"() { return __ui("囊括个人所得税、增值税、企业所得税、附加税、印花税、消费税与进出口退税"); },
      "category": "mathcalc",
      "mode": "sync",
      "icon": "Receipt",
      "subcategory": "calc",
      "clientSide": true,
      "inputs": []
    },
  {
      "id": "loan-calculator",
      get "name"() { return __ui("贷款计算器"); },
      get "description"() { return __ui("计算等额本息/等额本金还款方式下的月供、总利息等信息"); },
      "category": "mathcalc",
      "mode": "sync",
      "icon": "Calculator",
      "subcategory": "calc",
      "clientSide": true,
      "inputs": [
        {
          "id": "amount",
          "type": "number",
          get "label"() { return __ui("贷款金额（万元）"); },
          "required": true,
          "defaultValue": "100"
        },
        {
          "id": "years",
          "type": "number",
          get "label"() { return __ui("贷款年限（年）"); },
          "required": true,
          "defaultValue": "30"
        },
        {
          "id": "rate",
          "type": "number",
          get "label"() { return __ui("年利率（%）"); },
          "required": true,
          "defaultValue": "4.2"
        },
        {
          "id": "method",
          "type": "select",
          get "label"() { return __ui("还款方式"); },
          "required": true,
          "defaultValue": "equal",
          "options": [
            {
              get "label"() { return __ui("等额本息"); },
              "value": "equal"
            },
            {
              get "label"() { return __ui("等额本金"); },
              "value": "principal"
            }
          ]
        }
      ]
    },
  {
      "id": "exchange-rate",
      get "name"() { return __ui("汇率换算器"); },
      get "description"() { return __ui("主要货币汇率换算（固定汇率参考）"); },
      "category": "mathcalc",
      "mode": "sync",
      "icon": "TrendingUp",
      "subcategory": "calc",
      "clientSide": true,
      "inputs": [
        {
          "id": "amount",
          "type": "number",
          get "label"() { return __ui("金额"); },
          "required": true,
          "defaultValue": "100"
        },
        {
          "id": "from",
          "type": "select",
          get "label"() { return __ui("原货币"); },
          "required": true,
          "defaultValue": "CNY",
          "options": [
            {
              get "label"() { return __ui("人民币 CNY"); },
              "value": "CNY"
            },
            {
              get "label"() { return __ui("美元 USD"); },
              "value": "USD"
            },
            {
              get "label"() { return __ui("欧元 EUR"); },
              "value": "EUR"
            },
            {
              get "label"() { return __ui("日元 JPY"); },
              "value": "JPY"
            },
            {
              get "label"() { return __ui("英镑 GBP"); },
              "value": "GBP"
            },
            {
              get "label"() { return __ui("港币 HKD"); },
              "value": "HKD"
            }
          ]
        },
        {
          "id": "to",
          "type": "select",
          get "label"() { return __ui("目标货币"); },
          "required": true,
          "defaultValue": "USD",
          "options": [
            {
              get "label"() { return __ui("人民币 CNY"); },
              "value": "CNY"
            },
            {
              get "label"() { return __ui("美元 USD"); },
              "value": "USD"
            },
            {
              get "label"() { return __ui("欧元 EUR"); },
              "value": "EUR"
            },
            {
              get "label"() { return __ui("日元 JPY"); },
              "value": "JPY"
            },
            {
              get "label"() { return __ui("英镑 GBP"); },
              "value": "GBP"
            },
            {
              get "label"() { return __ui("港币 HKD"); },
              "value": "HKD"
            }
          ]
        }
      ]
    },
  {
      "id": "trade-calculator",
      get "name"() { return __ui("进出口贸易计算台"); },
      get "description"() { return __ui("含税与不含税单价互转、出口成本与利润、FOB/CFR/CIF 报价换算、进口环节税与运费分摊"); },
      "category": "mathcalc",
      "mode": "sync",
      "icon": "Globe",
      "subcategory": "calc",
      "clientSide": true,
      "inputs": []
    },
  {
      "id": "credit-card-calculator",
      get "name"() { return __ui("信用卡分期计算器"); },
      get "description"() { return __ui("计算信用卡分期的实际利率和总费用"); },
      "category": "mathcalc",
      "mode": "sync",
      "icon": "CreditCard",
      "subcategory": "calc",
      "clientSide": true,
      "inputs": [
        {
          "id": "amount",
          "type": "number",
          get "label"() { return __ui("分期金额（元）"); },
          "required": true,
          "defaultValue": "10000"
        },
        {
          "id": "periods",
          "type": "number",
          get "label"() { return __ui("分期期数"); },
          "required": true,
          "defaultValue": "12"
        },
        {
          "id": "feeRate",
          "type": "number",
          get "label"() { return __ui("手续费率（%）"); },
          "required": true,
          "defaultValue": "7.2"
        }
      ]
    },
  {
      "id": "date-calculator",
      get "name"() { return __ui("日期计算器"); },
      get "description"() { return __ui("支持日期差计算、日期加减、年龄计算"); },
      "category": "utility",
      "mode": "sync",
      "icon": "Calendar",
      "subcategory": "calc",
      "clientSide": true,
      "inputs": [
        {
          "id": "date1",
          "type": "text",
          get "label"() { return __ui("开始日期"); },
          "required": true,
          "placeholder": "YYYY-MM-DD"
        },
        {
          "id": "date2",
          "type": "text",
          get "label"() { return __ui("结束日期"); },
          "required": false,
          get "placeholder"() { return __ui("YYYY-MM-DD（留空则计算日期加减）"); }
        },
        {
          "id": "days",
          "type": "number",
          get "label"() { return __ui("加减天数"); },
          "required": false,
          "defaultValue": "0"
        }
      ]
    },
  {
      "id": "lunar-calendar",
      get "name"() { return __ui("公历农历转换器"); },
      get "description"() { return __ui("公历农历双向转换，提供详细农历信息"); },
      "category": "mathcalc",
      "mode": "sync",
      "icon": "Moon",
      "subcategory": "calc",
      "clientSide": true,
      "inputs": [
        {
          "id": "date",
          "type": "text",
          get "label"() { return __ui("公历日期"); },
          "required": true,
          "placeholder": "YYYY-MM-DD"
        }
      ]
    },
  {
      "id": "date-converter",
      get "name"() { return __ui("日期转换"); },
      get "description"() { return __ui("时间戳与日期时间互相转换"); },
      "category": "mathcalc",
      "mode": "sync",
      "icon": "Calendar",
      "subcategory": "calc",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "base-converter",
      get "name"() { return __ui("进制转换器"); },
      get "description"() { return __ui("支持二进制、八进制、十进制、十六进制互转"); },
      "category": "mathcalc",
      "mode": "sync",
      "icon": "Binary",
      "subcategory": "calc",
      "clientSide": true,
      "inputs": [
        {
          "id": "value",
          "type": "text",
          get "label"() { return __ui("输入数值"); },
          "required": true,
          get "placeholder"() { return __ui("输入要转换的数值"); }
        },
        {
          "id": "from",
          "type": "select",
          get "label"() { return __ui("原进制"); },
          "required": true,
          "defaultValue": "10",
          "options": [
            {
              get "label"() { return __ui("二进制"); },
              "value": "2"
            },
            {
              get "label"() { return __ui("八进制"); },
              "value": "8"
            },
            {
              get "label"() { return __ui("十进制"); },
              "value": "10"
            },
            {
              get "label"() { return __ui("十六进制"); },
              "value": "16"
            }
          ]
        }
      ]
    },
  {
      "id": "random-number",
      get "name"() { return __ui("随机数生成器"); },
      get "description"() { return __ui("生成指定范围内的随机数，支持批量生成"); },
      "category": "mathcalc",
      "mode": "sync",
      "icon": "Dices",
      "subcategory": "calc",
      "clientSide": true,
      "inputs": [
        {
          "id": "min",
          "type": "number",
          get "label"() { return __ui("最小值"); },
          "required": true,
          "defaultValue": "1"
        },
        {
          "id": "max",
          "type": "number",
          get "label"() { return __ui("最大值"); },
          "required": true,
          "defaultValue": "100"
        },
        {
          "id": "count",
          "type": "number",
          get "label"() { return __ui("生成数量"); },
          "required": true,
          "defaultValue": "5"
        }
      ]
    },
  {
      "id": "roman-numeral",
      get "name"() { return __ui("罗马数字转换器"); },
      get "description"() { return __ui("罗马数字与阿拉伯数字双向转换"); },
      "category": "mathcalc",
      "mode": "sync",
      "icon": "Pilcrow",
      "subcategory": "calc",
      "clientSide": true,
      "inputs": [
        {
          "id": "value",
          "type": "text",
          get "label"() { return __ui("输入（数字或罗马数字）"); },
          "required": true,
          get "placeholder"() { return __ui("例如：2024 或 MMXXIV"); }
        }
      ]
    },
  {
      "id": "number-english",
      get "name"() { return __ui("数字英文转换"); },
      get "description"() { return __ui("数字与英文单词双向转换"); },
      "category": "mathcalc",
      "mode": "sync",
      "icon": "ALargeSmall",
      "subcategory": "calc",
      "clientSide": true,
      "inputs": [
        {
          "id": "number",
          "type": "number",
          get "label"() { return __ui("数字"); },
          "required": true,
          "defaultValue": "1234"
        }
      ]
    },
  {
      "id": "rmb-uppercase",
      get "name"() { return __ui("人民币大写转换"); },
      get "description"() { return __ui("将数字金额转换为人民币大写形式，支持批量转换"); },
      "category": "mathcalc",
      "mode": "sync",
      "icon": "Banknote",
      "subcategory": "calc",
      "clientSide": true,
      "inputs": [
        {
          "id": "amount",
          "type": "text",
          get "label"() { return __ui("金额（数字）"); },
          get "placeholder"() { return __ui("例如：1234.56"); },
          "required": true
        }
      ]
    },
  {
      "id": "english-amount-uppercase",
      get "name"() { return __ui("英文金额大写转换"); },
      get "description"() { return __ui("将数字金额转换为英文大写形式"); },
      "category": "mathcalc",
      "mode": "sync",
      "icon": "Type",
      "subcategory": "calc",
      "clientSide": true,
      "inputs": [
        {
          "id": "amount",
          "type": "number",
          get "label"() { return __ui("金额"); },
          "required": true,
          "defaultValue": "1234.56"
        }
      ]
    }
  // ─────────────────────────────────────────────  开发工具 (dev)  ──────────
,
  {
      "id": "net-query",
      get "name"() { return __ui("网络查询"); },
      get "description"() { return __ui("四种常用网络查询：IP 归属地（国家地区与运营商）、域名 Whois（注册商与到期时间）、短链展开（看清最终跳到哪）、ICP 备案；结果都标明数据来源，查不到时给出具体原因。此工具需要联网"); },
      "category": "dev",
      "mode": "sync",
      "clientSide": true,
      "icon": "Globe",
      "inputs": []
    },
  {
      "id": "clipboard-history",
      get "name"() { return __ui("永久剪切板"); },
      get "description"() { return __ui("自动记录复制过的文字，随时搜回来重新复制：支持搜索、置顶常用片段、单条删除与一键清空；最多保留 200 条，数据只存在本机"); },
      "category": "hardware",
      "mode": "sync",
      "clientSide": true,
      "icon": "ClipboardList",
      "inputs": []
    },
  {
      "id": "json-studio",
      get "name"() { return __ui("JSON 工具箱"); },
      get "description"() { return __ui("10 个 JSON 相关功能：格式化与语法校验（报错带行列位置）、压缩、转 Java Bean / C# 实体 / Go struct / Python dataclass、JSONPath 查询、两份 JSON 差异对比、转 TOML 与 INI"); },
      "category": "dev",
      "mode": "sync",
      "clientSide": true,
      "icon": "Braces",
      "inputs": []
    },
  {
      "id": "css-studio",
      get "name"() { return __ui("CSS 样式生成器"); },
      get "description"() { return __ui("14 个常用样式的可视化生成器：阴影、圆角、渐变背景、玻璃拟态、加载动画、开关按钮、渐变文字、文字描边、缓动曲线、背景图案、滚动条美化、Flex 布局、Grid 布局、按钮样式，每项都有实时预览与可复制的 CSS"); },
      "category": "dev",
      "mode": "sync",
      "clientSide": true,
      "icon": "Palette",
      "inputs": []
    },
  {
      "id": "json-formatter",
      get "name"() { return __ui("JSON 格式化"); },
      get "description"() { return __ui("验证、美化或压缩 JSON 数据，瞬间在浏览器中完成"); },
      "category": "dev",
      "mode": "sync",
      "icon": "Braces",
      "clientSide": true,
      "inputs": [
        {
          "id": "json",
          "type": "text",
          get "label"() { return __ui("JSON 输入"); },
          "required": true
        }
      ]
    },
  {
      "id": "regex-tester",
      get "name"() { return __ui("正则测试"); },
      get "description"() { return __ui("用示例文本测试正则表达式，实时高亮匹配结果"); },
      "category": "dev",
      "mode": "sync",
      "icon": "Regex",
      "clientSide": true,
      "inputs": [
        {
          "id": "pattern",
          "type": "text",
          get "label"() { return __ui("正则表达式"); },
          "required": true
        }
      ]
    },
  {
      "id": "timestamp-converter",
      get "name"() { return __ui("时间戳转换器"); },
      get "description"() { return __ui("时间戳与日期时间相互转换，支持秒和毫秒"); },
      "category": "dev",
      "mode": "sync",
      "icon": "Clock",
      "clientSide": true,
      "inputs": [
        {
          "id": "value",
          "type": "text",
          get "label"() { return __ui("时间戳或日期"); },
          "required": true,
          get "placeholder"() { return __ui("时间戳（秒/毫秒）或日期时间"); }
        },
        {
          "id": "unit",
          "type": "select",
          get "label"() { return __ui("时间戳单位"); },
          "required": true,
          "defaultValue": "s",
          "options": [
            {
              get "label"() { return __ui("秒"); },
              "value": "s"
            },
            {
              get "label"() { return __ui("毫秒"); },
              "value": "ms"
            }
          ]
        }
      ]
    },
  {
      "id": "js-formatter",
      get "name"() { return __ui("JavaScript 格式化"); },
      get "description"() { return __ui("格式化 JavaScript 代码，自动缩进和换行"); },
      "category": "dev",
      "mode": "sync",
      "icon": "Code",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "html-formatter",
      get "name"() { return __ui("HTML 格式化"); },
      get "description"() { return __ui("格式化 HTML 代码，自动缩进和换行"); },
      "category": "dev",
      "mode": "sync",
      "icon": "FileCode",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "css-format",
      get "name"() { return __ui("CSS 格式化与压缩"); },
      get "description"() { return __ui("格式化或压缩 CSS 代码，支持嵌套规则、注释保留与体积对比"); },
      "category": "dev",
      "mode": "sync",
      "icon": "Braces",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "sql-format",
      get "name"() { return __ui("SQL 格式化"); },
      get "description"() { return __ui("按子句重新排版 SQL 语句，支持关键字大小写与语法高亮"); },
      "category": "dev",
      "mode": "sync",
      "icon": "Table",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "code-minify",
      get "name"() { return __ui("代码压缩"); },
      get "description"() { return __ui("压缩 HTML、CSS 与 JavaScript 代码，去掉注释与多余空白并显示节省比例"); },
      "category": "dev",
      "mode": "sync",
      "icon": "Minimize2",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "jwt-decode",
      get "name"() { return __ui("JWT 解析"); },
      get "description"() { return __ui("查看 JSON Web Token 的头部和载荷内容，无需密钥"); },
      "category": "security",
      "mode": "sync",
      "icon": "KeyRound",
      "clientSide": true,
      "inputs": [
        {
          "id": "token",
          "type": "text",
          get "label"() { return __ui("JWT 令牌"); },
          "required": true
        }
      ]
    },
  {
      "id": "json-csv",
      "name": "JSON ↔ CSV",
      get "description"() { return __ui("JSON 数组与 CSV 表格双向互转，自动识别分隔符，支持表格预览"); },
      "category": "dev",
      "mode": "sync",
      "icon": "Table",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "json-yaml",
      "name": "JSON ↔ YAML",
      get "description"() { return __ui("JSON 与 YAML 双向互转，自动识别输入格式，出错时定位到具体行"); },
      "category": "dev",
      "mode": "sync",
      "icon": "ArrowLeftRight",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "json-xml",
      "name": "JSON ↔ XML",
      get "description"() { return __ui("JSON 与 XML 双向互转，自动识别输入格式，并说明两种格式的映射规则"); },
      "category": "dev",
      "mode": "sync",
      "icon": "FileCode",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "csv-excel",
      "name": "CSV ↔ Excel",
      get "description"() { return __ui("CSV 与 Excel 表格双向转换，生成可直接用于求和排序的真 .xlsx 文件"); },
      "category": "dev",
      "mode": "async",
      "icon": "Table",
      "selfHostOnly": true,
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("表格文件"); },
          "required": true,
          "accept": ".csv,.xlsx,.xlsm"
        },
        {
          "id": "direction",
          "type": "select",
          get "label"() { return __ui("转换方向"); },
          "required": true,
          "defaultValue": "auto",
          "options": [
            { get "label"() { return __ui("自动识别"); }, "value": "auto" },
            { "label": "CSV → Excel（.xlsx）", "value": "to-xlsx" },
            { "label": "Excel → CSV", "value": "to-csv" }
          ]
        },
        {
          "id": "delimiter",
          "type": "select",
          get "label"() { return __ui("CSV 分隔符"); },
          "required": false,
          "defaultValue": "auto",
          "options": [
            { get "label"() { return __ui("自动识别"); }, "value": "auto" },
            { get "label"() { return __ui("逗号"); }, "value": "," },
            { get "label"() { return __ui("分号"); }, "value": ";" },
            { get "label"() { return __ui("制表符"); }, "value": "\t" },
            { get "label"() { return __ui("竖线"); }, "value": "|" }
          ]
        },
        {
          "id": "has_header",
          "type": "select",
          get "label"() { return __ui("首行是否为表头"); },
          "required": false,
          "defaultValue": "true",
          "options": [
            { get "label"() { return __ui("是（首行作表头）"); }, "value": "true" },
            { get "label"() { return __ui("否（首行是数据）"); }, "value": "false" }
          ]
        },
        {
          "id": "sheet",
          "type": "line",
          get "label"() { return __ui("工作表名称"); },
          get "placeholder"() { return __ui("留空表示第一个工作表"); },
          "required": false,
          get "help"() { return __ui("仅从 Excel 转 CSV 时有效"); }
        }
      ]
    },
  {
      "id": "json-schema-validate",
      get "name"() { return __ui("JSON Schema 校验"); },
      get "description"() { return __ui("按 JSON Schema 校验数据，逐条列出不符合约束的字段路径与原因"); },
      "category": "dev",
      "mode": "sync",
      "icon": "Filter",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "json-to-ts",
      get "name"() { return __ui("JSON 转 TS 类型"); },
      get "description"() { return __ui("JSON 转 TypeScript Interface，支持嵌套"); },
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
      get "name"() { return __ui("文本 / 文件 HEX 值计算"); },
      get "description"() { return __ui("查看文本UTF-8与文件字节的HEX转储，计算MD5、SHA-1、SHA-256、SHA-512摘要"); },
      "category": "security",
      "mode": "sync",
      "icon": "FileDigit",
      "clientSide": true,
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("文件"); },
          "required": true
        }
      ]
    },
  {
      "id": "image-base64",
      get "name"() { return __ui("图片 Base64 转换"); },
      get "description"() { return __ui("图片与 Base64 字符串相互转换"); },
      "category": "image",
      "mode": "sync",
      "icon": "Image",
      "clientSide": true,
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("图片文件"); },
          "required": true,
          "accept": "image/*"
        }
      ]
    },
  {
      "id": "http-status",
      get "name"() { return __ui("HTTP 状态查询"); },
      get "description"() { return __ui("查询 HTTP 状态码的含义和分类"); },
      "category": "dev",
      "mode": "sync",
      "icon": "Server",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "crontab-generator",
      get "name"() { return __ui("Crontab 生成器"); },
      get "description"() { return __ui("可视化配置 Crontab 表达式，支持人类可读解释"); },
      "category": "dev",
      "mode": "sync",
      "icon": "Clock",
      "clientSide": true,
      "inputs": [
        {
          "id": "minute",
          "type": "text",
          get "label"() { return __ui("分钟"); },
          "required": true,
          "defaultValue": "*"
        },
        {
          "id": "hour",
          "type": "text",
          get "label"() { return __ui("小时"); },
          "required": true,
          "defaultValue": "*"
        },
        {
          "id": "day",
          "type": "text",
          get "label"() { return __ui("日"); },
          "required": true,
          "defaultValue": "*"
        },
        {
          "id": "month",
          "type": "text",
          get "label"() { return __ui("月"); },
          "required": true,
          "defaultValue": "*"
        },
        {
          "id": "weekday",
          "type": "text",
          get "label"() { return __ui("星期"); },
          "required": true,
          "defaultValue": "*"
        }
      ]
    },
  {
      "id": "css-gradient",
      get "name"() { return __ui("CSS 渐变生成器"); },
      get "description"() { return __ui("生成 CSS 渐变代码及其 Tailwind 写法，支持线性、径向与锥形渐变"); },
      "category": "dev",
      "mode": "sync",
      "icon": "Palette",
      "inputs": [
        {
          "id": "color1",
          "type": "color",
          get "label"() { return __ui("起始颜色"); },
          "required": true,
          "defaultValue": "#6366f1"
        },
        {
          "id": "color2",
          "type": "color",
          get "label"() { return __ui("结束颜色"); },
          "required": true,
          "defaultValue": "#ec4899"
        },
        {
          "id": "type",
          "type": "select",
          get "label"() { return __ui("渐变类型"); },
          "required": true,
          "defaultValue": "linear",
          "options": [
            { get "label"() { return __ui("线性渐变（linear）"); }, "value": "linear" },
            { get "label"() { return __ui("径向渐变（radial）"); }, "value": "radial" },
            { get "label"() { return __ui("锥形渐变（conic）"); }, "value": "conic" }
          ]
        },
        {
          "id": "direction",
          "type": "select",
          get "label"() { return __ui("方向（仅线性渐变有效）"); },
          "required": false,
          "defaultValue": "to right",
          "options": [
            { get "label"() { return __ui("从左到右"); }, "value": "to right" },
            { get "label"() { return __ui("从上到下"); }, "value": "to bottom" },
            { get "label"() { return __ui("左上到右下"); }, "value": "to bottom right" },
            { get "label"() { return __ui("45 度"); }, "value": "45deg" },
            { get "label"() { return __ui("135 度"); }, "value": "135deg" }
          ]
        }
      ]
    },
  {
      "id": "lorem-gen",
      get "name"() { return __ui("Lorem 占位文本"); },
      get "description"() { return __ui("生成排版测试用的占位文字，支持段落、句子与单词三种长度"); },
      "category": "dev",
      "mode": "sync",
      "clientSide": true,
      "icon": "Pilcrow",
      "inputs": [
        {
          "id": "type",
          "type": "select",
          get "label"() { return __ui("生成类型"); },
          "required": true,
          "defaultValue": "paragraph",
          "options": [
            { get "label"() { return __ui("段落"); }, "value": "paragraph" },
            { get "label"() { return __ui("句子"); }, "value": "sentence" },
            { get "label"() { return __ui("单词"); }, "value": "word" }
          ]
        },
        {
          "id": "count",
          "type": "number",
          get "label"() { return __ui("数量"); },
          "required": true,
          "defaultValue": 3,
          "min": 1,
          "max": 20,
          get "help"() { return __ui("生成几个段落 / 句子 / 单词（1~20）"); }
        }
      ]
    },
  {
      "id": "dns-lookup",
      get "name"() { return __ui("DNS 查询"); },
      get "description"() { return __ui("查询域名的 A、AAAA、CNAME、MX、NS、TXT 记录，用于排查域名解析与邮件配置问题"); },
      "category": "dev",
      "mode": "sync",
      "icon": "Globe",
      "inputs": [
        {
          "id": "domain",
          "type": "line",
          get "label"() { return __ui("域名"); },
          get "placeholder"() { return __ui("例如 example.com"); },
          "required": true,
          get "help"() { return __ui("不需要带 http:// 前缀，直接填域名即可"); }
        }
      ]
    },
  {
      "id": "ssl-checker",
      get "name"() { return __ui("SSL 证书检查"); },
      get "description"() { return __ui("读取网站 HTTPS 证书的颁发者、有效期与信任状态，用于排查证书过期或配置错误"); },
      "category": "dev",
      "mode": "sync",
      "icon": "Shield",
      "inputs": [
        {
          "id": "domain",
          "type": "line",
          get "label"() { return __ui("域名"); },
          get "placeholder"() { return __ui("例如 www.baidu.com"); },
          "required": true,
          get "help"() { return __ui("通过该域名的 443 端口读取证书"); }
        }
      ]
    },
  {
      "id": "speed-test",
      get "name"() { return __ui("网速测试"); },
      get "description"() { return __ui("测试网络下载和上传速度，延迟和抖动"); },
      "category": "hardware",
      "mode": "sync",
      "clientSide": true,
      "icon": "Wifi",
      "inputs": []
    },
  {
      "id": "ip-converter",
      get "name"() { return __ui("IP 转换"); },
      get "description"() { return __ui("IP 地址与数字互相转换"); },
      "category": "dev",
      "mode": "sync",
      "icon": "Globe",
      "inputs": [],
      "clientSide": true
    },
  {
      "id": "url-parser",
      get "name"() { return __ui("URL 解析"); },
      get "description"() { return __ui("解析网址的协议、主机、端口、路径与查询参数，并给出各组成部分的编码结果"); },
      "category": "dev",
      "mode": "sync",
      "icon": "Link2",
      "inputs": [
        {
          "id": "url",
          "type": "line",
          get "label"() { return __ui("网址"); },
          get "placeholder"() { return __ui("https://example.com/path?a=1&b=中文#top"); },
          "required": true
        }
      ]
    },
  {
      "id": "user-agent-analyzer",
      get "name"() { return __ui("User Agent 分析器"); },
      get "description"() { return __ui("解析浏览器、内核、系统、设备类型"); },
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
      "id": "checksum-studio",
      get "name"() { return __ui("校验与摘要工具箱"); },
      get "description"() { return __ui("补齐常见哈希工具没有的算法：HMAC-SHA1/256/384/512、RIPEMD-160、MD4、Adler32、CRC16（Modbus 与 CCITT），文本与文件两种模式，结果实时更新"); },
      "category": "security",
      "mode": "sync",
      "clientSide": true,
      "icon": "ShieldCheck",
      "inputs": []
    },
  {
      "id": "encoder-studio",
      get "name"() { return __ui("编码转换工具箱"); },
      get "description"() { return __ui("11 种编码互转：Base32、Base58、Ascii85、Punycode（中文域名）、ROT13、ROT47、异或运算、UUencode、HTML 实体、文本与二进制/十六进制互转，还能直接解析 JWT 的负载与过期时间"); },
      "category": "security",
      "mode": "sync",
      "clientSide": true,
      "icon": "Binary",
      "inputs": []
    },
  {
      "id": "base64",
      get "name"() { return __ui("Base64 编码/解码"); },
      get "description"() { return __ui("将文本编码为 Base64 或解码还原，支持完整 Unicode"); },
      "category": "security",
      "mode": "sync",
      "icon": "Binary",
      "clientSide": true,
      "inputs": [
        {
          "id": "text",
          "type": "text",
          get "label"() { return __ui("文本"); },
          "required": true
        }
      ]
    },
  {
      "id": "url-encode",
      get "name"() { return __ui("URL 编码/解码"); },
      get "description"() { return __ui("对 URL 和查询字符串进行百分号编码或解码，瞬间完成"); },
      "category": "security",
      "mode": "sync",
      "icon": "Link2",
      "clientSide": true,
      "inputs": [
        {
          "id": "text",
          "type": "text",
          get "label"() { return __ui("文本"); },
          "required": true
        }
      ]
    },
  {
      "id": "hash-generator",
      get "name"() { return __ui("哈希计算"); },
      get "description"() { return __ui("计算 MD5、SHA-1、SHA-256、SHA-512 哈希值"); },
      "category": "security",
      "mode": "sync",
      "icon": "Hash",
      "inputs": [
        {
          "id": "text",
          "type": "text",
          get "label"() { return __ui("输入文本"); },
          "required": true
        },
        {
          "id": "algorithm",
          "type": "select",
          get "label"() { return __ui("算法"); },
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
      get "name"() { return __ui("SHA 哈希工具"); },
      get "description"() { return __ui("SHA1、SHA256、SHA384、SHA512 哈希计算"); },
      "category": "security",
      "mode": "sync",
      "icon": "Hash",
      "clientSide": true,
      "inputs": [
        {
          "id": "text",
          "type": "text",
          get "label"() { return __ui("输入文本"); },
          "required": true
        }
      ]
    },
  {
      "id": "aes-encrypt",
      get "name"() { return __ui("AES 加密解密"); },
      get "description"() { return __ui("在线进行 AES 加密和解密操作，支持多种模式"); },
      "category": "security",
      "mode": "sync",
      "icon": "Lock",
      "clientSide": true,
      "inputs": [
        {
          "id": "text",
          "type": "text",
          get "label"() { return __ui("输入内容"); },
          "required": true
        },
        {
          "id": "key",
          "type": "text",
          get "label"() { return __ui("密钥"); },
          "required": true,
          "defaultValue": "1234567890123456"
        },
        {
          "id": "mode",
          "type": "select",
          get "label"() { return __ui("模式"); },
          "required": true,
          "defaultValue": "encrypt",
          "options": [
            {
              get "label"() { return __ui("加密"); },
              "value": "encrypt"
            },
            {
              get "label"() { return __ui("解密"); },
              "value": "decrypt"
            }
          ]
        }
      ]
    },
  {
      "id": "crc-checksum",
      get "name"() { return __ui("CRC 校验工具"); },
      get "description"() { return __ui("计算文本的 CRC32 校验值"); },
      "category": "security",
      "mode": "sync",
      "icon": "Hash",
      "clientSide": true,
      "inputs": [
        {
          "id": "text",
          "type": "text",
          get "label"() { return __ui("输入文本"); },
          "required": true
        }
      ]
    },
  {
      "id": "unicode-converter",
      get "name"() { return __ui("Unicode 编码转换"); },
      get "description"() { return __ui("Unicode 与中文相互转换"); },
      "category": "security",
      "mode": "sync",
      "icon": "Code",
      "clientSide": true,
      "inputs": [
        {
          "id": "text",
          "type": "text",
          get "label"() { return __ui("输入内容"); },
          "required": true
        },
        {
          "id": "mode",
          "type": "select",
          get "label"() { return __ui("模式"); },
          "required": true,
          "defaultValue": "encode",
          "options": [
            {
              get "label"() { return __ui("中文→Unicode"); },
              "value": "encode"
            },
            {
              get "label"() { return __ui("Unicode→中文"); },
              "value": "decode"
            }
          ]
        }
      ]
    },
  {
      "id": "password-generator",
      get "name"() { return __ui("随机密码生成"); },
      get "description"() { return __ui("生成包含大小写字母、数字、特殊符号的随机密码"); },
      "category": "security",
      "mode": "sync",
      "icon": "Key",
      "clientSide": true,
      "inputs": [
        {
          "id": "length",
          "type": "number",
          get "label"() { return __ui("密码长度"); },
          "required": true,
          "defaultValue": "16"
        },
        {
          "id": "count",
          "type": "number",
          get "label"() { return __ui("生成数量"); },
          "required": true,
          "defaultValue": "5"
        }
      ]
    },
  {
      "id": "uuid-generator",
      get "name"() { return __ui("UUID 生成器"); },
      get "description"() { return __ui("批量生成全局唯一标识符 UUID，支持多种格式"); },
      "category": "security",
      "mode": "sync",
      "icon": "Fingerprint",
      "clientSide": true,
      "inputs": [
        {
          "id": "count",
          "type": "number",
          get "label"() { return __ui("生成数量"); },
          "required": true,
          "defaultValue": "5"
        }
      ]
    },
  {
      "id": "guid-generator",
      get "name"() { return __ui("GUID 生成工具"); },
      get "description"() { return __ui("生成全局唯一标识符 GUID"); },
      "category": "security",
      "mode": "sync",
      "icon": "Fingerprint",
      "clientSide": true,
      "inputs": [
        {
          "id": "count",
          "type": "number",
          get "label"() { return __ui("生成数量"); },
          "required": true,
          "defaultValue": "5"
        }
      ]
    },
  {
      "id": "morse-code",
      get "name"() { return __ui("摩斯电码"); },
      get "description"() { return __ui("摩斯电码和原文之间的双向转换"); },
      "category": "security",
      "mode": "sync",
      "icon": "Radio",
      "clientSide": true,
      "inputs": [
        {
          "id": "text",
          "type": "text",
          get "label"() { return __ui("输入内容"); },
          "required": true
        },
        {
          "id": "mode",
          "type": "select",
          get "label"() { return __ui("转换方向"); },
          "required": true,
          "defaultValue": "encode",
          "options": [
            {
              get "label"() { return __ui("文本→摩斯电码"); },
              "value": "encode"
            },
            {
              get "label"() { return __ui("摩斯电码→文本"); },
              "value": "decode"
            }
          ]
        }
      ]
    },
  {
      "id": "caesar-cipher",
      get "name"() { return __ui("凯撒密码"); },
      get "description"() { return __ui("通过字符偏移进行加密和解密的经典密码学工具"); },
      "category": "security",
      "mode": "sync",
      "icon": "Shield",
      "clientSide": true,
      "inputs": [
        {
          "id": "text",
          "type": "text",
          get "label"() { return __ui("输入内容"); },
          "required": true
        },
        {
          "id": "shift",
          "type": "number",
          get "label"() { return __ui("偏移量"); },
          "required": true,
          "defaultValue": "3"
        },
        {
          "id": "mode",
          "type": "select",
          get "label"() { return __ui("模式"); },
          "required": true,
          "defaultValue": "encrypt",
          "options": [
            {
              get "label"() { return __ui("加密"); },
              "value": "encrypt"
            },
            {
              get "label"() { return __ui("解密"); },
              "value": "decrypt"
            }
          ]
        }
      ]
    },
  {
      "id": "archpr",
      get "name"() { return __ui("压缩包密码恢复"); },
      get "description"() { return __ui("专业级 ZIP / RAR / 7Z / ACE 密码恢复利器 (ARCHPR)，支持纯暴力破解、掩码搜索、密码字典碰撞与已知明文攻击"); },
      "category": "security",
      "mode": "sync",
      "clientSide": true,
      "icon": "KeyRound",
      "inputs": []
    },
  {
      "id": "sys-overview",
      get "name"() { return __ui("设备概况"); },
      get "description"() { return __ui("一眼看清这台电脑：系统版本与激活状态、处理器、显卡、内存、磁盘与开机时长，可一键复制完整配置信息"); },
      "category": "hardware",
      "mode": "sync",
      "clientSide": true,
      "icon": "Monitor",
      "inputs": []
    },
  {
      "id": "sys-cpu-memory",
      get "name"() { return __ui("处理器与内存"); },
      get "description"() { return __ui("实时查看处理器占用与每个核心的负载、内存与提交内存使用率，以及每根内存条的容量、频率、类型与插槽"); },
      "category": "hardware",
      "mode": "sync",
      "clientSide": true,
      "icon": "Cpu",
      "inputs": []
    },
  {
      "id": "sys-gpu-display",
      get "name"() { return __ui("显卡与显示器"); },
      get "description"() { return __ui("查看显卡型号、显存、驱动版本与日期，以及各显示器的型号、尺寸、分辨率与刷新率"); },
      "category": "hardware",
      "mode": "sync",
      "clientSide": true,
      "icon": "MonitorPlay",
      "inputs": []
    },
  {
      "id": "sys-board-bios",
      get "name"() { return __ui("主板与 BIOS"); },
      get "description"() { return __ui("查看主板型号与序列号、BIOS 版本与日期、固件类型（UEFI/Legacy）、安全启动、TPM 与虚拟化状态"); },
      "category": "hardware",
      "mode": "sync",
      "clientSide": true,
      "icon": "CircuitBoard",
      "inputs": []
    },
  {
      "id": "sys-storage",
      get "name"() { return __ui("硬盘健康"); },
      get "description"() { return __ui("查看每块硬盘的型号、介质类型（固态/机械）、接口总线、健康状态与固件版本，以及各分区的容量占用"); },
      "category": "hardware",
      "mode": "sync",
      "clientSide": true,
      "icon": "HardDrive",
      "inputs": []
    },
  {
      "id": "sys-network",
      get "name"() { return __ui("网络适配器"); },
      get "description"() { return __ui("查看全部网卡及其连接状态、IP 地址、默认网关、DNS 与无线网络的 SSID、信号强度、信道"); },
      "category": "hardware",
      "mode": "sync",
      "clientSide": true,
      "icon": "Wifi",
      "inputs": []
    },
  {
      "id": "sys-power",
      get "name"() { return __ui("电源与温度"); },
      get "description"() { return __ui("查看电池电量、充放电状态、满电容量与电源方案，以及温度传感器读数与处理器负载"); },
      "category": "hardware",
      "mode": "sync",
      "clientSide": true,
      "icon": "BatteryCharging",
      "inputs": []
    },
  {
      "id": "teleprompter",
      get "name"() { return __ui("口播提词器"); },
      get "description"() { return __ui("把台词粘进来就能对着念：自动匀速滚动、聚焦线只亮中间一行、支持镜像与全屏，带 3 秒倒计时和预计时长"); },
      "category": "utility",
      "mode": "sync",
      "clientSide": true,
      "icon": "ScrollText",
      "inputs": []
    },
  {
      "id": "typing-test",
      get "name"() { return __ui("打字速度测试"); },
      get "description"() { return __ui("中英文打字测速：实时标出打错的字，统计速度（字/分或词/分）与正确率，保留最近 8 次成绩"); },
      "category": "utility",
      "mode": "sync",
      "clientSide": true,
      "icon": "Keyboard",
      "inputs": []
    },
  {
      "id": "body-fat",
      get "name"() { return __ui("体脂率估算"); },
      get "description"() { return __ui("用围度法（美国海军公式）估算体脂率，并与 BMI 推算法对比，同时给出体脂重量、去脂体重与基础代谢"); },
      "category": "utility",
      "mode": "sync",
      "clientSide": true,
      "icon": "Activity",
      "inputs": []
    },
  {
      "id": "interest-calc",
      get "name"() { return __ui("存贷利息计算"); },
      get "description"() { return __ui("存款复利（可设按年/季/月/日计息）、贷款等额本息与等额本金（含每期明细表）、单利与复利对比"); },
      "category": "mathcalc",
      "mode": "sync",
      "clientSide": true,
      "icon": "Percent",
      "inputs": []
    },
  {
      "id": "color-extract",
      get "name"() { return __ui("图片取色"); },
      get "description"() { return __ui("从图片中提取主色调与配色比例，支持逐点取色、复制 HEX/RGB、导出 CSS 与 JSON，并可导出成色卡图片"); },
      "category": "image",
      "mode": "sync",
      "clientSide": true,
      "icon": "Pipette",
      "inputs": []
    },
  {
      "id": "bpm-detect",
      get "name"() { return __ui("音乐节拍检测"); },
      get "description"() { return __ui("分析音乐的速度（BPM）并画出鼓点强度分布，支持手动击拍交叉验证，全部在本机计算"); },
      "category": "audio",
      "mode": "sync",
      "clientSide": true,
      "icon": "AudioWaveform",
      "inputs": []
    },
  {
      "id": "ppt-extract-media",
      get "name"() { return __ui("PPT 素材提取"); },
      get "description"() { return __ui("把 PPT 里的图片、音频、视频素材全部导出，自动按内容去重（同一张 logo 用了几十次也只留一份），打包附清单"); },
      "category": "pdf",
      "mode": "async",
      "icon": "Images",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("选择演示文稿"); },
          "accept": ".pptx,.pptm,.ppsx",
          "required": true,
          get "help"() { return __ui("支持 .pptx / .pptm；.ppt 旧格式请先用 PowerPoint 另存为 pptx"); }
        }
      ]
    },
  {
      "id": "ppt-extract-text",
      get "name"() { return __ui("PPT 文字提取"); },
      get "description"() { return __ui("按页提取 PPT 的标题、正文、表格与演讲者备注，可导出 Markdown / 纯文本 / JSON"); },
      "category": "pdf",
      "mode": "async",
      "icon": "FileOutput",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("选择演示文稿"); },
          "accept": ".pptx,.pptm,.ppsx",
          "required": true
        },
        {
          "id": "format",
          "type": "select",
          get "label"() { return __ui("导出格式"); },
          "required": true,
          "defaultValue": "md",
          "options": [
            { get "label"() { return __ui("Markdown（保留标题层级与表格）"); }, "value": "md" },
            { get "label"() { return __ui("纯文本 TXT"); }, "value": "txt" },
            { get "label"() { return __ui("JSON（便于程序处理）"); }, "value": "json" }
          ]
        },
        {
          "id": "include_notes",
          "type": "select",
          get "label"() { return __ui("是否包含备注"); },
          "required": true,
          "defaultValue": "true",
          "options": [
            { get "label"() { return __ui("包含演讲者备注"); }, "value": "true" },
            { get "label"() { return __ui("只要幻灯片上的文字"); }, "value": "false" }
          ]
        },
        {
          "id": "include_tables",
          "type": "select",
          get "label"() { return __ui("是否包含表格"); },
          "required": true,
          "defaultValue": "true",
          "options": [
            { get "label"() { return __ui("包含表格内容"); }, "value": "true" },
            { get "label"() { return __ui("跳过表格"); }, "value": "false" }
          ]
        }
      ]
    },
  {
      "id": "ppt-compress",
      get "name"() { return __ui("PPT 压缩"); },
      get "description"() { return __ui("重新压缩 PPT 里的图片来减小体积：超宽图等比缩小、按质量重新编码，矢量图与音视频原样保留"); },
      "category": "pdf",
      "mode": "async",
      "icon": "FileArchive",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("选择演示文稿"); },
          "accept": ".pptx,.pptm,.ppsx",
          "required": true
        },
        {
          "id": "quality",
          "type": "select",
          get "label"() { return __ui("压缩强度"); },
          "required": true,
          "defaultValue": "75",
          "options": [
            { get "label"() { return __ui("轻度（质量 85，几乎看不出差别）"); }, "value": "85" },
            { get "label"() { return __ui("标准（质量 75，推荐）"); }, "value": "75" },
            { get "label"() { return __ui("较高（质量 60，体积更小）"); }, "value": "60" },
            { get "label"() { return __ui("极限（质量 45，用于邮件发送）"); }, "value": "45" }
          ]
        },
        {
          "id": "max_width",
          "type": "select",
          get "label"() { return __ui("图片最大宽度"); },
          "required": true,
          "defaultValue": "1920",
          "options": [
            { get "label"() { return __ui("保持原尺寸（不缩小）"); }, "value": "6000" },
            { get "label"() { return __ui("1920 像素（推荐，投影够用）"); }, "value": "1920" },
            { get "label"() { return __ui("1280 像素（体积最小）"); }, "value": "1280" }
          ]
        }
      ]
    },
  {
      "id": "pdf-enhance",
      get "name"() { return __ui("扫描件增清"); },
      get "description"() { return __ui("把手机拍的文档、老扫描件处理得更清楚：去噪、提亮灰底、锐化字边，可输出灰度或黑白，处理强度三档可调"); },
      "category": "pdf",
      "mode": "async",
      "icon": "Sparkles",
      get "disclaimer"() { return __ui("增强后页面会变成整页位图，原有文字层不再保留；需要可搜索文字的 PDF 请不要使用本工具。"); },
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("选择 PDF 文件"); },
          "accept": ".pdf",
          "required": true,
          get "help"() { return __ui("适合扫描件、手机拍摄的文档"); }
        },
        {
          "id": "strength",
          "type": "select",
          get "label"() { return __ui("处理强度"); },
          "required": true,
          "defaultValue": "medium",
          "options": [
            { get "label"() { return __ui("轻度（只提亮，保留原质感）"); }, "value": "light" },
            { get "label"() { return __ui("标准（推荐）"); }, "value": "medium" },
            { get "label"() { return __ui("强力（灰底重、噪点多时用）"); }, "value": "strong" }
          ]
        },
        {
          "id": "mode",
          "type": "select",
          get "label"() { return __ui("输出模式"); },
          "required": true,
          "defaultValue": "gray",
          "options": [
            { get "label"() { return __ui("灰度（推荐，阅读舒服、体积小）"); }, "value": "gray" },
            { get "label"() { return __ui("黑白（文字最锐利，适合打印）"); }, "value": "bw" },
            { get "label"() { return __ui("彩色增强（保留彩色印章与图表）"); }, "value": "color" }
          ]
        },
        {
          "id": "dpi",
          "type": "select",
          get "label"() { return __ui("处理分辨率"); },
          "required": true,
          "defaultValue": "200",
          "options": [
            { get "label"() { return __ui("150（体积小、速度快）"); }, "value": "150" },
            { get "label"() { return __ui("200（推荐）"); }, "value": "200" },
            { get "label"() { return __ui("300（更清晰，体积更大）"); }, "value": "300" }
          ]
        },
        {
          "id": "pages",
          "type": "text",
          get "label"() { return __ui("要处理的页面"); },
          "required": false,
          get "placeholder"() { return __ui("留空表示全部页面，也可填 1-3,5"); }
        }
      ]
    },
  {
      "id": "pdf-content-edit",
      get "name"() { return __ui("PDF 改文字与插图"); },
      get "description"() { return __ui("直接改 PDF 里的内容：把某段文字换成新的（按页定位、可整页替换）、在指定位置插入文字、或把图片贴进页面；中文用内置中文字体写入，替换后字号与原文字一致，不留明显痕迹"); },
      "category": "pdf",
      "mode": "async",
      "icon": "FilePen",
      "inputs": [
        { "id": "file", "type": "file", get "label"() { return __ui("选择 PDF"); }, "accept": ".pdf", "required": true },
        {
          "id": "mode", "type": "select", get "label"() { return __ui("操作类型"); }, "required": true, "defaultValue": "replace",
          "options": [
            { get "label"() { return __ui("替换文字"); }, "value": "replace" },
            { get "label"() { return __ui("插入文字"); }, "value": "text" },
            { get "label"() { return __ui("插入图片"); }, "value": "image" }
          ]
        },
        { "id": "page", "type": "number", get "label"() { return __ui("第几页"); }, "required": true, "defaultValue": "1", get "help"() { return __ui("页码从 1 开始"); } },
        { "id": "old_text", "type": "text", get "label"() { return __ui("要替换掉的原文（选「替换文字」时填写）"); }, "required": false,
          get "help"() { return __ui("需与 PDF 上的文字完全一致，可以在 PDF 阅读器里复制过来"); } },
        { "id": "new_text", "type": "text", get "label"() { return __ui("替换成（选「替换文字」时填写）"); }, "required": false },
        {
          "id": "replace_all", "type": "select", get "label"() { return __ui("替换范围"); }, "required": false, "defaultValue": "no",
          "options": [
            { get "label"() { return __ui("只替换第一处"); }, "value": "no" },
            { get "label"() { return __ui("替换本页全部相同文字"); }, "value": "yes" }
          ]
        },
        { "id": "insert_text", "type": "text", get "label"() { return __ui("要插入的文字（选「插入文字」时填写）"); }, "required": false },
        { "id": "insert_image", "type": "file", get "label"() { return __ui("要插入的图片（选「插入图片」时选）"); }, "accept": ".png,.jpg,.jpeg,.webp", "required": false },
        { "id": "x", "type": "number", get "label"() { return __ui("横向位置（磅，从左侧算）"); }, "required": false, "defaultValue": "72" },
        { "id": "y", "type": "number", get "label"() { return __ui("纵向位置（磅，从顶部算）"); }, "required": false, "defaultValue": "72" },
        { "id": "size", "type": "number", get "label"() { return __ui("字号（插入文字用）"); }, "required": false, "defaultValue": "12" },
        { "id": "width", "type": "number", get "label"() { return __ui("图片宽度（插入图片用）"); }, "required": false, "defaultValue": "200" }
      ]
    },
  {
      "id": "pdf-editor",
      get "name"() { return __ui("PDF 编辑器"); },
      get "description"() { return __ui("按清单编辑 PDF 页面：删除、复制、旋转、移动到指定位置、插入空白页、整份倒序，还能把另一份 PDF 追加进来；左侧看缩略图多选页面，右侧排好操作顺序一次执行"); },
      "category": "pdf",
      "mode": "async",
      "icon": "FileEdit",
      "inputs": [
        { "id": "file", "type": "file", get "label"() { return __ui("选择 PDF"); }, "accept": ".pdf", "required": true },
        { "id": "append_file", "type": "file", get "label"() { return __ui("要追加的 PDF（可选）"); }, "accept": ".pdf", "required": false,
          get "help"() { return __ui("只有在操作清单里用到「追加 PDF」时才需要"); } }
      ]
    },
  {
      "id": "pdf-crop",
      get "name"() { return __ui("PDF 页面裁剪"); },
      get "description"() { return __ui("可视化裁剪 PDF 页面白边：在页面预览上直接拖动裁剪框（八个控制点），边距精确到毫米，带页面缩略图、自动边距、撤销重做与逐页不同设置"); },
      "category": "pdf",
      "mode": "async",
      "icon": "Crop",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("选择 PDF 文件"); },
          "accept": ".pdf",
          "required": true
        },
        {
          "id": "top",
          "type": "number",
          get "label"() { return __ui("上边距"); },
          "required": true,
          "defaultValue": "5",
          get "help"() { return __ui("按百分比的填写 0~45，表示裁掉页面高度的百分之几"); }
        },
        {
          "id": "bottom",
          "type": "number",
          get "label"() { return __ui("下边距"); },
          "required": true,
          "defaultValue": "5"
        },
        {
          "id": "left",
          "type": "number",
          get "label"() { return __ui("左边距"); },
          "required": true,
          "defaultValue": "5"
        },
        {
          "id": "right",
          "type": "number",
          get "label"() { return __ui("右边距"); },
          "required": true,
          "defaultValue": "5"
        },
        {
          "id": "per_page",
          "type": "text",
          get "label"() { return __ui("逐页边距（可视化界面自动填写）"); },
          "required": false,
          get "placeholder"() { return __ui("由拖框界面自动生成，一般无需手动填写"); },
          get "help"() { return __ui("格式为 JSON：{\"1\":{\"top\":10,\"bottom\":5,\"left\":5,\"right\":5}}，键是页码"); }
        },
        {
          "id": "unit",
          "type": "select",
          get "label"() { return __ui("边距单位"); },
          "required": true,
          "defaultValue": "percent",
          "options": [
            { get "label"() { return __ui("百分比（按页面宽高）"); }, "value": "percent" },
            { get "label"() { return __ui("毫米（精确尺寸）"); }, "value": "mm" }
          ]
        },
        {
          "id": "pages",
          "type": "text",
          get "label"() { return __ui("要裁剪的页面"); },
          "required": false,
          get "placeholder"() { return __ui("留空表示全部页面，也可填 1-3,5"); },
          get "help"() { return __ui("留空裁全部页面"); }
        }
      ]
    },
  {
      "id": "ppt-to-images",
      get "name"() { return __ui("PPT 转图片"); },
      get "description"() { return __ui("把演示文稿逐页导出为高清图片，可指定输出分辨率与 PNG/JPG 格式，多页自动打包成 zip（本机装了 Office、WPS 或 LibreOffice 即可）"); },
      "category": "pdf",
      "mode": "async",
      "icon": "Images",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("选择演示文稿"); },
          "accept": ".pptx,.pptm,.ppsx,.ppt",
          "required": true
        },
        {
          "id": "width",
          "type": "select",
          get "label"() { return __ui("输出宽度"); },
          "required": true,
          "defaultValue": "1920",
          "options": [
            { get "label"() { return __ui("1280 像素（体积小）"); }, "value": "1280" },
            { get "label"() { return __ui("1920 像素（推荐，1080P 投影够用）"); }, "value": "1920" },
            { get "label"() { return __ui("2560 像素（高清）"); }, "value": "2560" },
            { get "label"() { return __ui("3840 像素（4K）"); }, "value": "3840" }
          ]
        },
        {
          "id": "height",
          "type": "select",
          get "label"() { return __ui("输出高度"); },
          "required": true,
          "defaultValue": "1080",
          "options": [
            { "label": "720（16:9）", "value": "720" },
            { get "label"() { return __ui("1080（16:9，推荐）"); }, "value": "1080" },
            { "label": "1440（16:9）", "value": "1440" },
            { "label": "2160（16:9，4K）", "value": "2160" }
          ]
        },
        {
          "id": "format",
          "type": "select",
          get "label"() { return __ui("图片格式"); },
          "required": true,
          "defaultValue": "png",
          "options": [
            { get "label"() { return __ui("PNG（无损，适合演示截图）"); }, "value": "png" },
            { get "label"() { return __ui("JPG（体积小，适合分享）"); }, "value": "jpg" }
          ]
        }
      ]
    },
  {
      "id": "app-icon-generator",
      get "name"() { return __ui("应用图标生成"); },
      get "description"() { return __ui("一张图生成全套图标：12 种尺寸 PNG、多尺寸 ICO、内嵌位图的 SVG，可加圆角与底色，打包附尺寸用途说明"); },
      "category": "image",
      "mode": "async",
      "icon": "AppWindow",
      "inputs": [
        {
          "id": "file",
          "type": "file",
          get "label"() { return __ui("选择原图"); },
          "accept": "image/*",
          "required": true,
          get "help"() { return __ui("建议使用 1024×1024 的正方形图片；非正方形会自动居中裁剪"); }
        },
        {
          "id": "rounded",
          "type": "number",
          get "label"() { return __ui("圆角百分比"); },
          "required": true,
          "defaultValue": "0",
          get "help"() { return __ui("0 为直角；22 左右接近主流手机 App 图标的圆角观感"); }
        },
        {
          "id": "background",
          "type": "color",
          get "label"() { return __ui("垫底色"); },
          "required": false,
          "defaultValue": "",
          get "help"() { return __ui("透明图片需要底色时填写，例如 #1E90FF；留空保持透明"); }
        }
      ]
    },
  {
      "id": "big-file-scan",
      get "name"() { return __ui("占用空间排查"); },
      get "description"() { return __ui("找出最占地方的文件与文件夹：按体积排序、可直接在资源管理器中定位；仅只读排查，不提供删除功能"); },
      "category": "hardware",
      "mode": "sync",
      "clientSide": true,
      "icon": "FolderSearch",
      "inputs": []
    },
  {
      "id": "ai-polish",
      get "name"() { return __ui("AI 文字润色"); },
      get "description"() { return __ui("把文字改正式、改口语、精简、扩写、纠错校对或提取要点，七种模式一键切换，结果可直接编辑导出"); },
      "category": "ai",
      "mode": "sync",
      "clientSide": true,
      "icon": "Wand2",
      "inputs": []
    },
  {
      "id": "ai-translate",
      get "name"() { return __ui("AI 智能翻译"); },
      get "description"() { return __ui("13 种语言互译，自动识别源语言，保留原文段落结构，支持术语表与语气设定，适合长文与技术文档"); },
      "category": "ai",
      "mode": "sync",
      "clientSide": true,
      "icon": "Languages",
      "inputs": []
    },
  {
      "id": "ai-document",
      get "name"() { return __ui("AI 文档撰写"); },
      get "description"() { return __ui("给出主题就能写出成稿：说明文档、工作总结、活动方案、演讲稿、公众号文章等十种文种，带排版预览与 Markdown 导出"); },
      "category": "ai",
      "mode": "sync",
      "clientSide": true,
      "icon": "FileText",
      "inputs": []
    },
  {
      "id": "ai-ppt-draft",
      get "name"() { return __ui("AI 生成 PPT 草稿"); },
      get "description"() { return __ui("从主题与资料直接生成可编辑的 PPTX：封面、目录、内容页与结束页俱全，附演讲者备注，内置四套配色主题"); },
      "category": "ai",
      "mode": "sync",
      "clientSide": true,
      "icon": "Presentation",
      "inputs": []
    },
  {
      "id": "ai-table",
      get "name"() { return __ui("AI 表格生成"); },
      get "description"() { return __ui("描述需求就能生成结构化表格，支持指定行数，结果可直接预览、复制并导出 CSV"); },
      "category": "ai",
      "mode": "sync",
      "clientSide": true,
      "icon": "Table2",
      "inputs": []
    },
  {
      "id": "color-space-lab",
      get "name"() { return __ui("色彩空间对照"); },
      get "description"() { return __ui("11 种色彩空间的联动滑杆：拖动任意一个分量，其余空间实时跟着变，滑杆轨道按真实颜色渐变；另带色域覆盖检测、两色色差与文字对比度检查"); },
      "category": "image",
      "mode": "sync",
      "clientSide": true,
      "icon": "Palette",
      "inputs": []
    },
  {
      "id": "color-replace",
      get "name"() { return __ui("图片色彩替换"); },
      get "description"() { return __ui("把图片里的某个颜色换成另一个颜色：画布可缩放平移、吸管取色、可调容差与边缘柔化、保留明暗层次、智能保护相连区域，支持撤销重做并导出 PNG/JPG/WEBP/BMP"); },
      "category": "image",
      "mode": "sync",
      "clientSide": true,
      "icon": "Pipette",
      "inputs": []
    },
  // ────────── 2026-09 新增：编码类（本地可算，走 Rust 侧 encoding_rs）──────────
  {
      "id": "charset-detect",
      get "name"() { return __ui("字符编码自动检测"); },
      get "description"() { return __ui("判断一段文本或一个文件到底是用哪种编码存的：给出判定结论与可信度、候选编码对照、BOM 与换行风格，支持粘贴文本、十六进制字节或直接上传文件"); },
      "category": "text",
      "mode": "sync",
      "clientSide": true,
      "icon": "FileSearch",
      "inputs": []
    },
  {
      "id": "encoding-repair",
      get "name"() { return __ui("乱码修复"); },
      get "description"() { return __ui("把「编码读错」造成的乱码还原成正常文字：自动试遍常见编码组合并按可信度排序，给出多个候选原文供挑选与复制"); },
      "category": "text",
      "mode": "sync",
      "clientSide": true,
      "icon": "Wand2",
      "inputs": []
    },
  // ────────── 2026-09 新增：开发/文本类 ──────────
  {
      "id": "curl-to-code",
      get "name"() { return __ui("cURL 转代码"); },
      get "description"() { return __ui("把从浏览器或接口文档里复制的 curl 命令转成可运行的请求代码，支持 Python、JavaScript、Node、Go、PHP、Java、C#、PowerShell、Rust 九种语言，并先把命令解析出来供核对"); },
      "category": "dev",
      "mode": "sync",
      "clientSide": true,
      "icon": "Terminal",
      "inputs": []
    },
  {
      "id": "regex-cheatsheet",
      get "name"() { return __ui("正则速查表"); },
      get "description"() { return __ui("按字符类、量词、位置、分组、断言、标志分类整理正则写法与常用模式（手机号、邮箱、身份证、IPv4 等），可搜索、可一键送进旁边的测试框验证"); },
      "category": "dev",
      "mode": "sync",
      "clientSide": true,
      "icon": "BookMarked",
      "inputs": []
    },
  {
      "id": "html-to-markdown",
      get "name"() { return __ui("HTML 转 Markdown"); },
      get "description"() { return __ui("把网页源码或 HTML 片段转成 Markdown：标题、列表、链接、图片、引用、代码块、表格都会转成对应写法，可导出 .md 文件"); },
      "category": "text",
      "mode": "sync",
      "clientSide": true,
      "icon": "FileCode2",
      "inputs": []
    },
  // ────────── 2026-09 新增：时间类 ──────────
  {
      "id": "timezone-convert",
      get "name"() { return __ui("时区时间转换"); },
      get "description"() { return __ui("把一个时间换算到全球二十多个时区：给出各城市对应的日期、时间、星期与时差，跨天会明确标出，夏令时自动处理"); },
      "category": "utility",
      "mode": "sync",
      "clientSide": true,
      "icon": "Globe2",
      "inputs": []
    },
  {
      "id": "sunrise-sunset",
      get "name"() { return __ui("日出日落计算"); },
      get "description"() { return __ui("按经纬度查询某天的日出、日落、正午、民用晨光始与暮光终、昼长与正午太阳高度角，内置近三十个城市预设，极昼极夜也会如实说明"); },
      "category": "utility",
      "mode": "sync",
      "clientSide": true,
      "icon": "Sunrise",
      "inputs": []
    },
  // ────────── 2026-09 新增：健康与饮食 ──────────
  {
      "id": "bmr-calculator",
      get "name"() { return __ui("基础代谢计算"); },
      get "description"() { return __ui("按性别、年龄、身高、体重与活动量算出基础代谢与每日总消耗，给出减脂、维持、增肌三档热量参考，并附 BMI、理想体重与两种公式对照"); },
      "category": "utility",
      "mode": "sync",
      "clientSide": true,
      "icon": "Flame",
      "inputs": []
    },
  {
      "id": "calorie-deficit",
      get "name"() { return __ui("卡路里缺口计算"); },
      get "description"() { return __ui("按当前体重、目标体重与计划周期算出每天该吃多少、缺口多大、是否过快，并直接告诉你会消耗在哪个日期达成目标"); },
      "category": "utility",
      "mode": "sync",
      "clientSide": true,
      "icon": "TrendingDown",
      "inputs": []
    },
  {
      "id": "food-calories",
      get "name"() { return __ui("食物热量查询"); },
      get "description"() { return __ui("查常见食物的热量与三大营养素，把吃的东西按克数加进当日清单，自动合计热量与营养并对照每日预算"); },
      "category": "utility",
      "mode": "sync",
      "clientSide": true,
      "icon": "Apple",
      "inputs": []
    },
  {
      "id": "nutrition-facts",
      get "name"() { return __ui("营养成分查询"); },
      get "description"() { return __ui("查看一种食物的完整营养构成与三大营养素供能比，对照每日参考摄入量，并可横向比较同类食物的热量高低"); },
      "category": "utility",
      "mode": "sync",
      "clientSide": true,
      "icon": "Leaf",
      "inputs": []
    },
  {
      "id": "running-pace",
      get "name"() { return __ui("跑步配速计算"); },
      get "description"() { return __ui("距离、时间、配速、速度四者互算，给出每公里分段与 5K、10K、半马、全马的预计完赛时间"); },
      "category": "utility",
      "mode": "sync",
      "clientSide": true,
      "icon": "Footprints",
      "inputs": []
    },
  {
      "id": "sleep-cycle",
      get "name"() { return __ui("睡眠周期计算"); },
      get "description"() { return __ui("按 90 分钟睡眠周期推算：给出起床时间就告诉你该几点睡，给出入睡时间就告诉你该几点起，避开深睡期被闹钟叫醒"); },
      "category": "utility",
      "mode": "sync",
      "clientSide": true,
      "icon": "Moon",
      "inputs": []
    },
  // ────────── 2026-09 新增：财务计算 ──────────
  {
      "id": "mortgage-calculator",
      get "name"() { return __ui("房贷车贷计算器"); },
      get "description"() { return __ui("算房贷与车贷的月供、总利息和完整还款计划：支持等额本息与等额本金、商贷与公积金组合贷，车贷还会估算购置税与落地价"); },
      "category": "mathcalc",
      "mode": "sync",
      "clientSide": true,
      "icon": "Home",
      "inputs": []
    },
  {
      "id": "mortgage-prepay",
      get "name"() { return __ui("房贷提前还款对比"); },
      get "description"() { return __ui("对比提前还款与不还两种做法：算出各自的剩余期数、月供与利息总额，得出能省多少利息，支持缩短期限与减少月供两种方式并计入违约金"); },
      "category": "mathcalc",
      "mode": "sync",
      "clientSide": true,
      "icon": "Banknote",
      "inputs": []
    },
  {
      "id": "stock-pnl",
      get "name"() { return __ui("股票成本盈亏"); },
      get "description"() { return __ui("按分批买入卖出记录算出摊薄成本价、持仓市值、浮动与已实现盈亏，并把佣金、印花税等费用一并计入，给出保本价"); },
      "category": "mathcalc",
      "mode": "sync",
      "clientSide": true,
      "icon": "LineChart",
      "inputs": []
    },
  // ────────── 2026-09 新增：生活小工具 ──────────
  {
      "id": "zodiac-sign",
      get "name"() { return __ui("生肖星座计算"); },
      get "description"() { return __ui("输入一个日期，算出对应的生肖、干支纪年与星座，附十二生肖年份对照与十二星座日期、属性、守护星"); },
      "category": "utility",
      "mode": "sync",
      "clientSide": true,
      "icon": "Star",
      "inputs": []
    },
  {
      "id": "totp-generator",
      get "name"() { return __ui("TOTP 验证码生成器"); },
      get "description"() { return __ui("按 RFC 6238 在本机生成两步验证动态口令：粘贴 otpauth 链接或 Base32 密钥即可，显示剩余有效秒数，密钥不上传"); },
      "category": "security",
      "mode": "sync",
      "clientSide": true,
      "icon": "KeyRound",
      "inputs": []
    },
  {
      "id": "lucky-wheel",
      get "name"() { return __ui("抽奖转盘"); },
      get "description"() { return __ui("可自定义奖项与权重的抽奖转盘：按权重决定中奖概率并转到对应扇区，支持不重复中奖与中奖记录"); },
      "category": "utility",
      "mode": "sync",
      "clientSide": true,
      "icon": "RotateCcw",
      "inputs": []
    },
  {
      "id": "random-decision",
      get "name"() { return __ui("随机决策器"); },
      get "description"() { return __ui("选不出来就交给随机数：随机抽一个、打乱排序、不重复抽签，也能抛硬币与掷骰子（面数可自定义）"); },
      "category": "utility",
      "mode": "sync",
      "clientSide": true,
      "icon": "Shuffle",
      "inputs": []
    },
  {
      "id": "quote-card",
      get "name"() { return __ui("金句诗词卡片"); },
      get "description"() { return __ui("把诗词名句或寄语做成一张卡片：内置数十条古诗词与现代金句，可选横排竖排、五种配色、三种字体与三种尺寸，导出高清 PNG"); },
      "category": "utility",
      "mode": "sync",
      "clientSide": true,
      "icon": "Quote",
      "inputs": []
    },
  {
      "id": "ledger",
      get "name"() { return __ui("记账本"); },
      get "description"() { return __ui("记录每天的收入与支出，自动汇总月度收支、分类占比与近半年趋势；数据只存在本机并支持导出 CSV 与完整备份/导入恢复"); },
      "category": "utility",
      "mode": "sync",
      "clientSide": true,
      "icon": "Wallet",
      "inputs": []
    },
  {
      "id": "period-tracker",
      get "name"() { return __ui("月经期计算"); },
      get "description"() { return __ui("按上次月经与周期长度预测未来六次经期、易孕期与排卵日，并说明当前处于哪个阶段"); },
      "category": "utility",
      "mode": "sync",
      "clientSide": true,
      "icon": "CalendarHeart",
      "inputs": []
    },
  {
      "id": "due-date",
      get "name"() { return __ui("孕周计算器"); },
      get "description"() { return __ui("按末次月经、受孕日或已知预产期推算预产期与当前孕周，展示孕期三阶段进度与关键产检时间表"); },
      "category": "utility",
      "mode": "sync",
      "clientSide": true,
      "icon": "Baby",
      "inputs": []
    },
  // ────────── 2026-09 新增：联网查询（接口均已实测可直连）──────────
  {
      "id": "weather-query",
      get "name"() { return __ui("天气查询"); },
      get "description"() { return __ui("查任意城市的实时天气与未来预报：当前温度、体感、湿度、风速风向、气压，未来 24 小时逐时与未来 7 天趋势、日出日落"); },
      "category": "utility",
      "mode": "sync",
      "clientSide": true,
      "icon": "CloudSun",
      "inputs": []
    },
  {
      "id": "public-ip",
      get "name"() { return __ui("我的公网 IP 查询"); },
      get "description"() { return __ui("查出当前对外的公网 IP（含 IPv4/IPv6 判断）与所在地、运营商，并说明这个地址暴露了什么、开代理时会怎样"); },
      "category": "hardware",
      "mode": "sync",
      "clientSide": true,
      "icon": "Globe",
      "inputs": []
    },
  {
      "id": "phone-location",
      get "name"() { return __ui("手机号归属地"); },
      get "description"() { return __ui("查手机号段的归属省份与运营商，支持连续查询与历史记录；只查号段归属，不涉及机主信息"); },
      "category": "utility",
      "mode": "sync",
      "clientSide": true,
      "icon": "Phone",
      "inputs": []
    },
  {
      "id": "express-query",
      get "name"() { return __ui("快递单号查询"); },
      get "description"() { return __ui("粘贴快递单号自动识别快递公司并按时间倒序列出全部物流轨迹，含当前状态与最近查询记录"); },
      "category": "utility",
      "mode": "sync",
      "clientSide": true,
      "icon": "Package",
      "inputs": []
    },
  {
      "id": "domain-check",
      get "name"() { return __ui("域名可用性查询"); },
      get "description"() { return __ui("查一个域名是否已被注册：看 NS 与 A 记录判断，.com 还能拿到注册商、注册与到期时间；支持一键试常见后缀"); },
      "category": "dev",
      "mode": "sync",
      "clientSide": true,
      "icon": "Globe2",
      "inputs": []
    },
  {
      "id": "image-metadata-clean",
      get "name"() { return __ui("图片元数据清除"); },
      get "description"() { return __ui("先列出照片里实际写入了什么（设备型号、拍摄参数、精确 GPS 定位等），再一键清除；支持批量与打包下载，保留画面不变歪"); },
      "category": "image",
      "mode": "sync",
      "clientSide": true,
      "icon": "Shield",
      "inputs": []
    },
  {
      "id": "image-filter",
      get "name"() { return __ui("图片滤镜特效"); },
      get "description"() { return __ui("11 套预设（鲜明/胶片/复古/黑白/冷调/暖调/高对比/褪色/反色等）加亮度、对比度、饱和度、色温、怀旧、锐化、模糊、暗角、颗粒逐项微调，可按住看原图并批量导出"); },
      "category": "image",
      "mode": "sync",
      "clientSide": true,
      "icon": "Palette",
      "inputs": []
    },
  {
      "id": "kinship",
      get "name"() { return __ui("亲戚关系计算"); },
      get "description"() { return __ui("算出「爸爸的哥哥的儿子」该怎么称呼（堂哥/堂弟），也能反向算「他该叫我什么」；支持直系、旁系与姻亲，并说明为什么会有两个答案"); },
      "category": "utility",
      "mode": "sync",
      "clientSide": true,
      "icon": "Users",
      "inputs": []
    },
  {
      "id": "subtitle-convert",
      get "name"() { return __ui("字幕格式转换"); },
      get "description"() { return __ui("SRT / VTT / ASS(SSA) / LRC / 纯文本互转，可整体平移时间轴、按帧率换算（23.976↔25 等）、清理样式标记，带时间轴预览"); },
      "category": "download",
      "mode": "sync",
      "clientSide": true,
      "icon": "Captions",
      "inputs": []
    },
  {
      "id": "battery-health",
      get "name"() { return __ui("电池健康详情"); },
      get "description"() { return __ui("读取 Windows 自带的电池报告：健康度（满充容量÷设计容量）、设计容量与当前容量、充电循环次数、续航估算、容量衰减历史与最近用电记录"); },
      "category": "hardware",
      "mode": "sync",
      "clientSide": true,
      "icon": "BatteryFull",
      "inputs": []
    },
  {
      "id": "media-info",
      get "name"() { return __ui("媒体信息查看器"); },
      get "description"() { return __ui("读取视频/音频/图片的真实参数：容器格式、总时长与码率，以及每条流的编码、分辨率、帧率、采样率、声道、语言与章节"); },
      "category": "download",
      "mode": "sync",
      "clientSide": true,
      "icon": "Film",
      "inputs": []
    },
  {
      "id": "web-export",
      get "name"() { return __ui("网页转图片 / PDF"); },
      get "description"() { return __ui("把网页导出成 PNG 或 PDF：用系统自带的 Edge 真浏览器渲染，版式与浏览器里一致；可选尺寸、横向、去页眉页脚与等待时间"); },
      "category": "pdf",
      "mode": "sync",
      "clientSide": true,
      "icon": "Globe",
      "inputs": []
    },
  {
      "id": "audio-tags",
      get "name"() { return __ui("MP3 标签编辑器"); },
      get "description"() { return __ui("修改音频文件的标题、艺术家、专辑、年份、流派、音轨号、作曲、备注与歌词，也能更换或移除封面；结果是改好标签的副本，原文件不动"); },
      "category": "audio",
      "mode": "async",
      "icon": "Tags",
      "inputs": [
        { "id": "file", "type": "file", get "label"() { return __ui("音频文件"); }, "accept": ".mp3,.flac,.m4a,.ogg,.opus,.wav", "required": true,
          get "help"() { return __ui("支持 MP3 / FLAC / M4A / OGG / WAV。想先看看现在有哪些标签，可以用「媒体信息查看器」"); } },
        { "id": "title", "type": "text", get "label"() { return __ui("标题"); }, "required": false, get "placeholder"() { return __ui("留空表示不改这一项"); } },
        { "id": "artist", "type": "text", get "label"() { return __ui("艺术家"); }, "required": false, get "placeholder"() { return __ui("留空表示不改这一项"); } },
        { "id": "album", "type": "text", get "label"() { return __ui("专辑"); }, "required": false, get "placeholder"() { return __ui("留空表示不改这一项"); } },
        { "id": "albumartist", "type": "text", get "label"() { return __ui("专辑艺术家"); }, "required": false, get "placeholder"() { return __ui("留空表示不改这一项"); } },
        { "id": "date", "type": "text", get "label"() { return __ui("年份"); }, "required": false, get "placeholder"() { return __ui("例如 2026"); } },
        { "id": "genre", "type": "text", get "label"() { return __ui("流派"); }, "required": false, get "placeholder"() { return __ui("例如 流行"); } },
        { "id": "track", "type": "text", get "label"() { return __ui("音轨号"); }, "required": false, get "placeholder"() { return __ui("例如 3"); } },
        { "id": "composer", "type": "text", get "label"() { return __ui("作曲"); }, "required": false, get "placeholder"() { return __ui("留空表示不改这一项"); } },
        { "id": "comment", "type": "text", get "label"() { return __ui("备注"); }, "required": false, get "placeholder"() { return __ui("留空表示不改这一项"); } },
        { "id": "lyrics", "type": "text", get "label"() { return __ui("歌词"); }, "required": false, get "placeholder"() { return __ui("留空表示不改这一项"); } },
        { "id": "cover_file", "type": "file", get "label"() { return __ui("封面图片（可选）"); }, "accept": ".jpg,.jpeg,.png", "required": false,
          get "help"() { return __ui("选了就替换封面；不选则保持原封面不变"); } },
        { "id": "remove_cover", "type": "select", get "label"() { return __ui("是否移除封面"); }, "required": false, "defaultValue": "no",
          "options": [ { get "label"() { return __ui("不移除"); }, "value": "no" }, { get "label"() { return __ui("移除封面"); }, "value": "yes" } ] }
      ]
    },
  {
      "id": "id-photo",
      get "name"() { return __ui("证件照制作"); },
      get "description"() { return __ui("把普通照片变成标准证件照：自动抠人像、换白/蓝/红/灰底色、按一寸二寸等规格以 300dpi 输出精确像素，还能在 6 寸相纸上排版 8 张"); },
      "category": "image",
      "mode": "async",
      "icon": "Contact",
      "inputs": [
        { "id": "file", "type": "file", get "label"() { return __ui("人像照片"); }, "accept": ".png,.jpg,.jpeg,.webp,.bmp", "required": true,
          get "help"() { return __ui("背景干净、光线均匀、正脸的照片效果最好"); } },
        { "id": "spec", "type": "select", get "label"() { return __ui("尺寸规格"); }, "required": true, "defaultValue": "one",
          "options": [
            { get "label"() { return __ui("一寸 25×35mm（最常用）"); }, "value": "one" },
            { get "label"() { return __ui("大一寸 33×48mm"); }, "value": "one-big" },
            { get "label"() { return __ui("小一寸 22×32mm"); }, "value": "one-small" },
            { get "label"() { return __ui("二寸 35×49mm"); }, "value": "two" },
            { get "label"() { return __ui("小二寸 35×45mm"); }, "value": "two-small" },
            { get "label"() { return __ui("大二寸 35×53mm"); }, "value": "two-big" },
            { get "label"() { return __ui("护照 33×48mm"); }, "value": "passport" }
          ] },
        { "id": "bg", "type": "select", get "label"() { return __ui("背景色"); }, "required": true, "defaultValue": "white",
          "options": [
            { get "label"() { return __ui("白底"); }, "value": "white" },
            { get "label"() { return __ui("蓝底（证件照标准蓝）"); }, "value": "blue" },
            { get "label"() { return __ui("红底（证件照标准红）"); }, "value": "red" },
            { get "label"() { return __ui("灰底"); }, "value": "gray" }
          ] },
        { "id": "layout", "type": "select", get "label"() { return __ui("是否排版"); }, "required": false, "defaultValue": "no",
          "options": [
            { get "label"() { return __ui("只出一张（单张证件照）"); }, "value": "no" },
            { get "label"() { return __ui("6 寸相纸排版（最多 8 张，保持实际冲印尺寸）"); }, "value": "yes" }
          ] }
      ]
    },
  {
      "id": "pdf-to-markdown",
      get "name"() { return __ui("PDF 转 Markdown"); },
      get "description"() { return __ui("把 PDF 还原成 Markdown：按字号识别标题层级、识别列表与表格、内嵌图片，保留段落结构而不是只抽文字"); },
      "category": "pdf",
      "mode": "async",
      "icon": "FileCode2",
      "inputs": [
        { "id": "file", "type": "file", get "label"() { return __ui("PDF 文件"); }, "accept": ".pdf", "required": true },
        { "id": "keepImages", "type": "select", get "label"() { return __ui("是否内嵌图片"); }, "required": false, "defaultValue": "true",
          "options": [ { get "label"() { return __ui("内嵌图片（文件会大一些）"); }, "value": "true" }, { get "label"() { return __ui("不要图片（只有文字）"); }, "value": "false" } ] },
        { "id": "detectTables", "type": "select", get "label"() { return __ui("是否识别表格"); }, "required": false, "defaultValue": "true",
          "options": [ { get "label"() { return __ui("识别成 Markdown 表格"); }, "value": "true" }, { get "label"() { return __ui("不识别（表格按普通文字）"); }, "value": "false" } ] },
        { "id": "pageBreak", "type": "select", get "label"() { return __ui("分页标记"); }, "required": false, "defaultValue": "false",
          "options": [ { get "label"() { return __ui("不插入"); }, "value": "false" }, { get "label"() { return __ui("每页之间插入 ---"); }, "value": "true" } ] }
      ]
    },
  {
      "id": "pdf-to-html",
      get "name"() { return __ui("PDF 转 HTML"); },
      get "description"() { return __ui("把 PDF 转成可在浏览器打开的 HTML：保留标题层级与段落、表格转成真正的表格、图片内嵌，并带一套适合阅读的样式"); },
      "category": "pdf",
      "mode": "async",
      "icon": "Globe",
      "inputs": [
        { "id": "file", "type": "file", get "label"() { return __ui("PDF 文件"); }, "accept": ".pdf", "required": true },
        { "id": "keepImages", "type": "select", get "label"() { return __ui("是否内嵌图片"); }, "required": false, "defaultValue": "true",
          "options": [ { get "label"() { return __ui("内嵌图片"); }, "value": "true" }, { get "label"() { return __ui("不要图片"); }, "value": "false" } ] },
        { "id": "detectTables", "type": "select", get "label"() { return __ui("是否识别表格"); }, "required": false, "defaultValue": "true",
          "options": [ { get "label"() { return __ui("识别成表格"); }, "value": "true" }, { get "label"() { return __ui("不识别"); }, "value": "false" } ] }
      ]
    },
  {
      "id": "meme-maker",
      get "name"() { return __ui("表情包制作"); },
      get "description"() { return __ui("给图片加白字黑边的上下两行大字，文字可拖动、可调字号颜色描边、内置常用表情；不选图片也能用纯色底做字图，一键导出 PNG"); },
      "category": "image",
      "mode": "sync",
      "clientSide": true,
      "icon": "Smile",
      "inputs": []
    },
  {
      "id": "video-watermark-remove",
      get "name"() { return __ui("视频去水印"); },
      get "description"() { return __ui("去掉视频里的水印：可选 delogo 插值覆盖（适合纯色背景）、区域模糊（适合复杂画面）或直接裁掉边缘；支持位置预设与自定义区域"); },
      "category": "download",
      "mode": "async",
      "icon": "Eraser",
      "inputs": [
        { "id": "file", "type": "file", get "label"() { return __ui("视频文件"); }, "accept": ".mp4,.mov,.mkv,.avi,.webm,.flv,.wmv,.m4v", "required": true },
        { "id": "mode", "type": "select", get "label"() { return __ui("处理方式"); }, "required": true, "defaultValue": "delogo",
          "options": [
            { get "label"() { return __ui("delogo 插值覆盖（推荐，适合纯色/渐变背景上的水印）"); }, "value": "delogo" },
            { get "label"() { return __ui("区域模糊（适合压在复杂画面上的水印）"); }, "value": "blur" },
            { get "label"() { return __ui("裁掉边缘（最干净，但画面会变小）"); }, "value": "crop" }
          ] },
        { "id": "position", "type": "select", get "label"() { return __ui("水印位置"); }, "required": true, "defaultValue": "bottom-right",
          "options": [
            { get "label"() { return __ui("右下角"); }, "value": "bottom-right" },
            { get "label"() { return __ui("左下角"); }, "value": "bottom-left" },
            { get "label"() { return __ui("底部居中"); }, "value": "bottom-center" },
            { get "label"() { return __ui("右上角"); }, "value": "top-right" },
            { get "label"() { return __ui("左上角"); }, "value": "top-left" },
            { get "label"() { return __ui("顶部居中"); }, "value": "top-center" },
            { get "label"() { return __ui("自定义坐标（填下面四项）"); }, "value": "custom" }
          ] },
        { "id": "rectX", "type": "number", get "label"() { return __ui("自定义：左边距（像素）"); }, "required": false, "defaultValue": 0 },
        { "id": "rectY", "type": "number", get "label"() { return __ui("自定义：上边距（像素）"); }, "required": false, "defaultValue": 0 },
        { "id": "rectW", "type": "number", get "label"() { return __ui("自定义：宽度（0=按视频宽自动）"); }, "required": false, "defaultValue": 0 },
        { "id": "rectH", "type": "number", get "label"() { return __ui("自定义：高度（0=按视频高自动）"); }, "required": false, "defaultValue": 0,
          get "help"() { return __ui("先用「媒体信息查看器」看清分辨率再填会更准"); } }
      ]
    },
  {
      "id": "text-to-speech",
      get "name"() { return __ui("文字转语音"); },
      get "description"() { return tr("文字合成语音，先试听再保存：真实系统声线、Edge 在线神经语音，以及按需下载的本地神经模型；按实际引擎输出 MP3 或 WAV。", "Turn text into speech and preview before saving: installed system voices, online Edge neural voices, or on-demand offline neural models. Output is MP3 or WAV according to the engine."); },
      "category": "audio",
      "mode": "async",
      "icon": "Volume2",
      "inputs": [
        { "id": "text", "type": "text", get "label"() { return __ui("要朗读的文字"); }, "required": true, get "placeholder"() { return __ui("在这里输入或粘贴要读的文字"); } },
        { "id": "engine", "type": "select", get "label"() { return __ui("合成方式"); }, "required": true, "defaultValue": "sapi",
          "options": [
            { get "label"() { return __ui("系统语音（离线，完全不需要联网，也不需要下载）"); }, "value": "sapi" },
            { get "label"() { return __ui("在线神经音色（质量更高，需要联网；微软接口有变动时可能不可用）"); }, "value": "edge" },
            { get "label"() { return tr("本地神经语音（模型按需下载）", "Offline neural speech (on-demand models)"); }, "value": "local" }
          ] },
        { "id": "voice", "type": "select", get "label"() { return __ui("音色"); }, "required": false, "defaultValue": "",
          "options": [{ get "label"() { return tr("在专用工作台选择真实声线", "Select an available voice in the speech workspace"); }, "value": "" }] },
        { "id": "rate", "type": "number", get "label"() { return __ui("语速（-50 慢 ~ 50 快，0 为正常）"); }, "required": false, "defaultValue": 0 },
        { "id": "pitch", "type": "number", get "label"() { return __ui("音调（-50 低 ~ 50 高，仅在线音色有效）"); }, "required": false, "defaultValue": 0 }
      ]
    },
  {
      "id": "floating-screenshot",
      get "name"() { return __ui("悬浮截图"); },
      get "description"() { return __ui("桌面区域框选后悬浮贴图，复制、取字、翻译、强化、独立编辑和加入待办文件"); },
      "category": "image",
      "mode": "sync",
      "clientSide": true,
      "icon": "Camera",
      "inputs": []
    },
  {
      "id": "screenshot-translate",
      get "name"() { return __ui("截图翻译"); },
      get "description"() { return __ui("截屏或选一张图，自动识别文字并翻译：也支持直接粘贴文字翻译；中英日韩法德俄西互译，译文可一键复制"); },
      "category": "image",
      "mode": "sync",
      "clientSide": true,
      "icon": "Languages",
      "inputs": []
    },
]


function copyDisplayDefinition(definition: OmniTool, overrides: Partial<OmniTool>): OmniTool {
  return Object.defineProperties({}, { ...Object.getOwnPropertyDescriptors(definition), ...Object.getOwnPropertyDescriptors(overrides) }) as OmniTool;
}

function presentationDefinition(tool:OmniTool):OmniTool {
  const label=TOOL_PRESENTATION[tool.id];
  return label ? copyDisplayDefinition(tool,{get name(){return tr(label[0],label[1]);},get description(){return label[2]&&label[3]?tr(label[2],label[3]):tool.description;}}) : tool;
}
/** Raw worker-operation metadata for grouped tools; never resolve the public navigation alias here. */
export function getRawToolById(id:string):OmniTool|undefined{return DEFINITIONS.find(t=>t.id===id);}
export const TOOLS:OmniTool[]=CATEGORY_ORDER.flatMap(category=>CATALOG[category].map(id=>{const raw=DEFINITIONS.find(t=>t.id===id);if(!raw)throw new Error(`Missing tool definition: ${id}`);const definition=presentationDefinition(raw);return copyDisplayDefinition(definition,{category,...(id==='pdf-editor'?{inputs:[{id:'file',type:'file' as const,get "label"() { return __ui("选择PDF"); },accept:'.pdf',required:true}]}:{})});}));
export function resolveToolId(id:string):string{return TOOL_ALIASES[id]||id;}
export function getToolById(id:string):OmniTool|undefined{const resolved=resolveToolId(id);return TOOLS.find(t=>t.id===resolved)||(PDF_EDITOR_TOOL_IDS.includes(resolved)?DEFINITIONS.find(t=>t.id===resolved):undefined);}

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
