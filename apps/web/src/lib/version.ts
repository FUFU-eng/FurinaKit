export const APP_VERSION = "2.0.2";
export const APP_NAME = "FurinaKit 芙宁娜工具箱";
export const APP_SUBTITLE = "轻量、优雅且全能的原神芙宁娜主题工具箱";
export const RELEASE_DATE = "2026-09-09";

export interface VersionInfo {
  version: string;
  releaseDate: string;
  changelog: string[];
  downloadUrl: string;
  mirrors?: Array<{ name: string; url: string }>;
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
    version: "2.0.2",
    releaseDate: "2026-09-09",
    title: "图像核心引擎与离线服务链路深度修复",
    badge: "当前版本",
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
export const DEFAULT_UPDATE_ENDPOINT = "https://raw.githubusercontent.com/Abudora-0/FurinaKit/master/version.json";

/** 备用与国内加速更新源列表 */
export const FALLBACK_UPDATE_ENDPOINTS = [
  "https://cdn.jsdelivr.net/gh/Abudora-0/FurinaKit@master/version.json",
  "https://raw.githubusercontent.com/Abudora-0/FurinaKit/master/version.json",
  "https://ghproxy.net/https://raw.githubusercontent.com/Abudora-0/FurinaKit/master/version.json",
];
