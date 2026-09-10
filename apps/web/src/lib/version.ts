export const APP_VERSION = "2.0.4";
export const APP_NAME = "FurinaKit 芙宁娜工具箱";
export const APP_SUBTITLE = "轻量、优雅且全能的原神芙宁娜主题工具箱";
export const RELEASE_DATE = "2026-09-10";

export interface VersionInfo {
  version: string;
  releaseDate: string;
  changelog: string[];
  downloadUrl: string;
  fullSize?: string;
  patchUrl?: string;
  patchSize?: string;
  minPatchVersion?: string;
  mirrors?: Array<{ name: string; url: string }>;
  patchMirrors?: Array<{ name: string; url: string }>;
  isMandatory?: boolean;
}

export interface ReleaseLog {
  version: string;
  releaseDate: string;
  title: string;
  badge?: string;
  highlights: string[];
  details: {
    category: string;
    items: string[];
  }[];
}

/** 软件官方版本发布与更新日志 */
export const APP_CHANGELOG: ReleaseLog[] = [
  {
    version: "2.0.4",
    releaseDate: "2026-09-10",
    title: "全新上线磁力下载器，视频种子双重存，下载更快更贴心",
    badge: "当前版本",
    highlights: [
      "✨ 全新推出「磁力与种子高速下载」工具：视频、大文件直接下，无需安装任何额外软件",
      "🔍 超贴心「先预览后下载」：粘贴链接秒出视频名字、准确大小与文件清单，绝不下错资源",
      "⚡ 内置 40+ 全球高速加速节点：自动寻找最快做种人，冷门资源也能跑满网速",
      "💾 视频与种子双重自动保存：视频下好的同时备份 .torrent 种子文件，方便转存网盘或分享好友",
      "🛡️ 智能防覆盖与一键直达：已下载资源智能识别秒开，新增「打开所在文件夹」快捷按钮",
      "🔄 软件更新与后台服务全面优化：告别繁琐设置，后续版本一键全自动检测与升级",
    ],
    details: [
      {
        category: "新增功能 · 磁力链接与 BT 种子高速下载",
        items: [
          "在「视频工具」中正式上线专属下载器，直接粘贴 magnet 磁力链接或把 .torrent 种子文件拖进窗口即可下载",
          "独家提供资源预先解析卡片：还没开始下载就能提前看到文件名字、总容量大小以及包含的具体文件",
          "下载时不仅完整下载原画质视频，还会自动在下载目录保存一份对应的种子文件，方便备份与离线转存网盘",
        ],
      },
      {
        category: "速度与网络加速优化",
        items: [
          "内置全球精选 40 多个高速加速节点（Trackers），自动连接活跃做种节点，显著提升连接速度与下载稳定性",
          "采用主流客户端协议伪装，防止下载被限速或误拦截，国内网络环境下下载更加流畅",
        ],
      },
      {
        category: "贴心体验与防误删保护",
        items: [
          "新增文件智能保护机制：如果下载目录已存在同名完整视频，直接识别为已完成并提供播放/打开按钮，绝不误清空文件",
          "下载界面实时显示速度、剩余时间、已连接人数，下载完成后可一键在电脑文件夹中快速定位打开",
        ],
      },
      {
        category: "稳定性与自动更新升级",
        items: [
          "优化软件在线更新检测通道，提供更安全的网络校验与超时自愈，升级更加丝滑可靠",
          "优化后台任务退出时的资源清理，关闭软件时更干净利落，不留后台垃圾残留",
        ],
      },
    ],
  },
  {
    version: "2.0.3",
    releaseDate: "2026-09-10",
    title: "视频下载引擎深度重构与任务死锁彻底修复",
    highlights: [
      "彻底解决 B 站与全网视频下载在桌面打包环境下卡死在 40% 的致命 Bug",
      "重构视频下载执行链路：改由 Node.js 服务层原生调度内置 yt-dlp.exe 与 ffmpeg.exe，彻底切断 Python 打包进程死锁",
      "实现真实流式进度上报：实时解析标准输出流百分比，进度条从 0% 到 100% 丝滑过渡",
      "优化 DASH 媒体流自动合并与音视频提取，提升 Bilibili、YouTube、X (Twitter) 等平台的下载稳定性",
    ],
    details: [
      {
        category: "视频下载引擎与执行链路重构",
        items: [
          "排查并彻底拔除 PyInstaller 二进制可执行文件调用 `sys.executable -m yt_dlp` 导致无限派生空 Worker 造成的读取死锁",
          "在服务层直接调用内置打包的 standalone yt-dlp.exe 与 ffmpeg.exe，下载过程脱离外部 Python 依赖，保障 100% 可用",
          "增加智能进度解析正则，将底层下载百分比平滑映射到任务队列状态流中，用户可实时获知下载进度与速率",
        ],
      },
      {
        category: "媒体流处理与平台兼容优化",
        items: [
          "完善 B 站多画质（1080p/720p/480p）与纯音频 MP3 自动提取合成机制",
          "优化内置 FFmpeg 路径检测，无论在源码开发环境还是打包安装路径下均能精准寻址",
        ],
      },
    ],
  },
  {
    version: "2.0.2",
    releaseDate: "2026-09-09",
    title: "图像核心引擎与离线服务链路深度修复",
    highlights: [
      "彻底修复桌面打包环境下缺失原生图像处理运行时（@img/sharp-win32-x64）导致的图片转换、压缩 500 异常",
      "修复 PDF 转 Word、Office 文档转换等重型离线 Worker 任务队列调度与通信环境变量",
      "修复 B 站与全网视频解析后下载任务异常，完善内置 ffmpeg 路径解析与跨进程调用链路",
      "优化应用启动时本地存储目录（jobs/queue/uploads/results）预创建机制，增强多任务并发与系统稳定性",
    ],
    details: [
      {
        category: "图像处理与格式转换底层修复",
        items: [
          "将 @img/sharp-win32-x64 原生二进制文件全量固化并打包入安装包，彻底解决外部安装机器上图片转换、压缩、调整大小时报 500（Unexpected token '<'）的问题",
          "优化图片与文件处理接口错误兜底提示，统一返回结构化异常信息",
        ],
      },
      {
        category: "离线 Worker 运算与文档转换",
        items: [
          "修正内置轻量文件队列与重型任务调用标识（USE_FILE_QUEUE、NEXT_PUBLIC_ENABLE_HEAVY_WORKER_TOOLS），使 PDF 转 Word、抠图等重型离线计算稳定派发到后台 Worker",
          "优化 Worker 守护进程的跨进程握手心跳与自动唤起流程",
        ],
      },
      {
        category: "多媒体下载与视听套件",
        items: [
          "完善打包后 resources 目录内 ffmpeg.exe 与 yt-dlp.exe 的绝对路径探测逻辑，解决 B 站视频解析成功却因环境丢失而无法下载的问题",
          "优化音视频下载过程中的临时转码分块清理与存储占用",
        ],
      },
      {
        category: "运行环境自检与工程规范",
        items: [
          "在主进程启动前预先创建 storage/jobs、storage/queue、storage/uploads、storage/results 等完整工作目录体系，防止首次运行因文件夹缺失导致任务中断",
          "新增全流程一键在线更新与安装包自动下载拉起支持",
        ],
      },
    ],
  },
  {
    version: "2.0.1",
    releaseDate: "2026-09-09",
    title: "艺术签名设计器上线与全域交互体验重构",
    highlights: [
      "全新上线「艺术与电子签名设计器」，融合一笔艺术签、平滑压感手写板、国风仿古印章与商务合同实景预览",
      "「观影读书记录器」升级为「影视 · 图书 · 番剧」三位一体文娱记录中心，新增追更管理",
      "重构「全功能科学与程序员计算器」，支持 HEX/DEC/OCT/BIN 多进制位运算与复杂科学工程函数",
      "优化工具箱分类架构与滚动历史记忆，返回主页自动恢复浏览位置",
    ],
    details: [
      {
        category: "新增工具与功能扩展",
        items: [
          "新增「艺术与电子签名设计器」：集成 62 种艺术签流派、平滑压感手写板、国风朱文/白文印章铭刻及无白边透明 PNG 智能导出",
          "扩展「影视/读书/番剧记录器」：新增番剧追踪模式，支持季度进度追踪、集数打卡、追番状态与心路记录",
          "升级「全功能科学与程序员计算器」：支持跨进制快速转换、按位逻辑运算与大数高精度科学计算",
          "升级「罗马数字转换器」：突破 1-3999 限制，全面支持千万级上划线罗马数字体系与正负大数双向互转",
        ],
      },
      {
        category: "交互体验与界面美化",
        items: [
          "重构工具箱分类与优先级矩阵，首栏固定「全部工具」与「我的收藏」，高频常用工具前置排列",
          "新增滚动位置记忆与自动还原机制，退出工具详情页自动定位回原视口，避免重复翻找",
          "优化卡片置顶层级交互：消除标题重叠图钉，仅保留右下角精致高亮置顶标识",
          "优化系统托盘与关闭提醒：首次关闭提示后自动记住偏好，杜绝频繁弹窗打扰",
          "精简界面视觉干扰，移除全局冗余悬浮置顶按钮，优化深浅色模式水元素毛玻璃质感",
        ],
      },
      {
        category: "系统性能与工程优化",
        items: [
          "剔除冗余无效工具模块与临时工程测试素材，优化打包压缩比，保障全套离线运行稳定性",
        ],
      },
    ],
  },
  {
    version: "2.0.0",
    releaseDate: "2026-09-04",
    title: "FurinaKit 2.0 桌面端架构全新发布",
    highlights: [
      "基于 Electron + Next.js 独立桌面架构重构，带来全新芙宁娜主题设计语言",
      "100+ 款离线工具全量就绪，内置 Python 全能 Worker 与 FFmpeg 媒体处理套件",
    ],
    details: [
      {
        category: "架构升级",
        items: [
          "双核驱动架构：内置独立便携 Node.js 服务端与 Python 媒体运算 Worker",
          "全新玻璃拟态主题体系，支持深色/浅色随心切换，纯本地无网络依赖可用",
        ],
      },
    ],
  },
];

/** 默认检查更新源地址（用户或开发者可在设置中自定义） */
export const DEFAULT_UPDATE_ENDPOINT = "https://cdn.jsdelivr.net/gh/furinakit/releases@main/version.json";

/** 备用与国内加速更新源列表 */
export const FALLBACK_UPDATE_ENDPOINTS = [
  "https://cdn.jsdelivr.net/gh/furinakit/releases@main/version.json",
  "https://raw.githubusercontent.com/furinakit/releases/main/version.json",
  "https://ghproxy.net/https://raw.githubusercontent.com/furinakit/releases/main/version.json",
  "https://cdn.jsdelivr.net/gh/FUFU-eng/FurinaKit@main/version.json",
  "https://raw.githubusercontent.com/FUFU-eng/FurinaKit/main/version.json",
];
