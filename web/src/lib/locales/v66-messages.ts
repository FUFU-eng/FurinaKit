// Authored V66 system messages only. Never call this on user documents,
// input text, filenames or voice names. Dynamic diagnostic suffixes stay intact.
const PAIRS: readonly (readonly [string, string, string])[] = [
  [
    "在线合成失败，已重试；请检查网络、代理、系统时间或改选离线方式 / Online synthesis failed after retries; check network, proxy and system clock, or choose an offline engine (",
    "在线合成失败，已重试；请检查网络、代理、系统时间或改选离线方式",
    "Online synthesis failed after retries; check network, proxy and system clock, or choose an offline engine ("
  ],
  [
    "分离完成，可先试听再保存 / Separation ready for preview ({result['durationSec']} s; gain {result['outputGain']:.4f})",
    "分离完成，可先试听再保存",
    "Separation ready for preview ({result['durationSec']} s; gain {result['outputGain']:.4f})"
  ],
  [
    "本机没有可用 SAPI 声线，请在 Windows 设置安装语音包 / No SAPI voices are installed; add a Windows speech language pack",
    "本机没有可用 SAPI 声线，请在 Windows 设置安装语音包",
    "No SAPI voices are installed; add a Windows speech language pack"
  ],
  [
    "在线音色清单获取失败，请检查网络、代理和系统时间 / Could not retrieve online voices; check network, proxy and system clock",
    "在线音色清单获取失败，请检查网络、代理和系统时间",
    "Could not retrieve online voices; check network, proxy and system clock"
  ],
  [
    "本地语音进程失败，请检查组件完整性及可用内存 / Offline speech process failed; check components and available memory",
    "本地语音进程失败，请检查组件完整性及可用内存",
    "Offline speech process failed; check components and available memory"
  ],
  [
    "处理返回 Dict 的工具结果（image_tools / pdf_tools / audio_tools / office_to_pdf / pdf_convert）",
    "处理返回 Dict 的工具结果（image_tools",
    "pdf_tools / audio_tools / office_to_pdf / pdf_convert）"
  ],
  [
    "缺少 V66 语音辅助源码或随应用提供的 Python，请使用完整源码安装 / V66 TTS helper or bundled Python is missing",
    "缺少 V66 语音辅助源码或随应用提供的 Python，请使用完整源码安装",
    "V66 TTS helper or bundled Python is missing"
  ],
  [
    "离线引擎不支持音调偏移或音量增益 / Offline engines do not support pitch shifting or volume boost",
    "离线引擎不支持音调偏移或音量增益",
    "Offline engines do not support pitch shifting or volume boost"
  ],
  [
    "所选系统声线未安装，不会自动替换 / Selected system voice is not installed; no fallback was used",
    "所选系统声线未安装，不会自动替换",
    "Selected system voice is not installed; no fallback was used"
  ],
  [
    "下载不完整或 SHA-256 不匹配，未安装 / Incomplete download or SHA-256 mismatch; not installed",
    "下载不完整或 SHA-256 不匹配，未安装",
    "Incomplete download or SHA-256 mismatch; not installed"
  ],
  [
    "请在设置中下载人声与伴奏双核心组件 / Download the vocal and instrumental model pair in Settings",
    "请在设置中下载人声与伴奏双核心组件",
    "Download the vocal and instrumental model pair in Settings"
  ],
  [
    "系统语音失败；所选声线可能不可用，请刷新真实声线列表 / SAPI failed; refresh the installed voice list",
    "系统语音失败；所选声线可能不可用，请刷新真实声线列表",
    "SAPI failed; refresh the installed voice list"
  ],
  [
    "请先下载或修复所选模型与运行库 / Download or repair the selected model and runtime first",
    "请先下载或修复所选模型与运行库",
    "Download or repair the selected model and runtime first"
  ],
  [
    "Kokoro 组件目录不能包含逗号 / Kokoro component paths must not contain commas",
    "Kokoro 组件目录不能包含逗号",
    "Kokoro component paths must not contain commas"
  ],
  [
    "无法确认目录归属，未删除 / Cannot confirm package ownership; nothing deleted",
    "无法确认目录归属，未删除",
    "Cannot confirm package ownership; nothing deleted"
  ],
  [
    "语音辅助进程未返回结果，请确认源码版本 / No TTS helper reply; check source version",
    "语音辅助进程未返回结果，请确认源码版本",
    "No TTS helper reply; check source version"
  ],
  [
    "在线合成总时长超限，请缩短文本 / Online synthesis timed out; shorten the text",
    "在线合成总时长超限，请缩短文本",
    "Online synthesis timed out; shorten the text"
  ],
  [
    "本地合成超时，请缩短文本 / Offline synthesis timed out; shorten the text",
    "本地合成超时，请缩短文本",
    "Offline synthesis timed out; shorten the text"
  ],
  [
    "本地语音运行库要求 64 位 Windows / Offline TTS requires 64-bit Windows",
    "本地语音运行库要求 64 位 Windows",
    "Offline TTS requires 64-bit Windows"
  ],
  [
    "模型实际说话人编号不匹配 / Speaker ID does not match the installed model",
    "模型实际说话人编号不匹配",
    "Speaker ID does not match the installed model"
  ],
  [
    "文本包含不支持的控制字符 / Text contains unsupported control characters",
    "文本包含不支持的控制字符",
    "Text contains unsupported control characters"
  ],
  [
    "在线音频分段超出大小限制 / Online audio segment exceeds the size limit",
    "在线音频分段超出大小限制",
    "Online audio segment exceeds the size limit"
  ],
  [
    "缺少 Windows PowerShell / Windows PowerShell is unavailable",
    "缺少 Windows PowerShell",
    "Windows PowerShell is unavailable"
  ],
  [
    "本地语音需要 64 位 Windows / Offline TTS requires 64-bit Windows",
    "本地语音需要 64 位 Windows",
    "Offline TTS requires 64-bit Windows"
  ],
  [
    "未配置组件目录，请从桌面应用运行 / Component directory is not configured",
    "未配置组件目录，请从桌面应用运行",
    "Component directory is not configured"
  ],
  [
    "本地语音引擎无法加载组件 / Offline TTS could not load its components",
    "本地语音引擎无法加载组件",
    "Offline TTS could not load its components"
  ],
  [
    "下载已停止，断点文件已保留 / Download stopped; partial files retained",
    "下载已停止，断点文件已保留",
    "Download stopped; partial files retained"
  ],
  [
    "缺少 websockets 组件 / The websockets dependency is missing",
    "缺少 websockets 组件",
    "The websockets dependency is missing"
  ],
  [
    "在线服务未返回完整音频 / Online service returned no complete audio",
    "在线服务未返回完整音频",
    "Online service returned no complete audio"
  ],
  [
    "组件路径不能含链接或重解析点 / Linked component paths are not allowed",
    "组件路径不能含链接或重解析点",
    "Linked component paths are not allowed"
  ],
  [
    "下载超时，已保留断点 / Download timed out; partial file retained",
    "下载超时，已保留断点",
    "Download timed out; partial file retained"
  ],
  [
    "本地语音组件正在使用或下载，请稍后重试 / Offline TTS components are busy",
    "本地语音组件正在使用或下载，请稍后重试",
    "Offline TTS components are busy"
  ],
  [
    "请先删除依赖此运行库的本地音色 / Remove dependent voice models first",
    "请先删除依赖此运行库的本地音色",
    "Remove dependent voice models first"
  ],
  [
    "文本应为 1–20000 字 / Text must contain 1–20000 characters",
    "文本应为 1–20000 字",
    "Text must contain 1–20000 characters"
  ],
  [
    "语速、音调或音量超出范围 / Rate, pitch or volume is out of range",
    "语速、音调或音量超出范围",
    "Rate, pitch or volume is out of range"
  ],
  [
    "系统未应用所选声线 / System did not apply the selected voice",
    "系统未应用所选声线",
    "System did not apply the selected voice"
  ],
  [
    "没有此组件的活动下载 / No active download for this component",
    "没有此组件的活动下载",
    "No active download for this component"
  ],
  [
    "合成完成，可先试听再保存 / Speech ready; preview before saving",
    "合成完成，可先试听再保存",
    "Speech ready; preview before saving"
  ],
  [
    "系统语音返回了无效结果 / Invalid response from system speech",
    "系统语音返回了无效结果",
    "Invalid response from system speech"
  ],
  [
    "请选择本地模型及说话人 / Select an offline model and speaker",
    "请选择本地模型及说话人",
    "Select an offline model and speaker"
  ],
  [
    "语音组件正在更新，请稍后再试 / TTS components are being updated",
    "语音组件正在更新，请稍后再试",
    "TTS components are being updated"
  ],
  [
    "系统语音仅适用于 Windows / System voices require Windows",
    "系统语音仅适用于 Windows",
    "System voices require Windows"
  ],
  [
    "组件文件缺失或不唯一 / Missing or ambiguous package file: ",
    "组件文件缺失或不唯一",
    "Missing or ambiguous package file: "
  ],
  [
    "未生成有效 WAV 音频 / No valid WAV audio was generated",
    "未生成有效 WAV 音频",
    "No valid WAV audio was generated"
  ],
  [
    "未配置组件目录 / Component directory is not configured",
    "未配置组件目录",
    "Component directory is not configured"
  ],
  [
    "未找到唯一的量化模型 / Cannot locate the quantized model",
    "未找到唯一的量化模型",
    "Cannot locate the quantized model"
  ],
  [
    "模型产生了无效采样 / Model produced a non-finite sample",
    "模型产生了无效采样",
    "Model produced a non-finite sample"
  ],
  [
    "语音结果过大 / Speech output exceeds the size limit",
    "语音结果过大",
    "Speech output exceeds the size limit"
  ],
  [
    "请输入 1–20000 字的朗读文本 / Enter 1–20000 characters",
    "请输入 1–20000 字的朗读文本",
    "Enter 1–20000 characters"
  ],
  [
    "下载文件超过预期大小 / Download exceeds the pinned size",
    "下载文件超过预期大小",
    "Download exceeds the pinned size"
  ],
  [
    "压缩包路径越界 / Archive path escapes its directory",
    "压缩包路径越界",
    "Archive path escapes its directory"
  ],
  [
    "本地模型未生成音频 / Offline model returned no audio",
    "本地模型未生成音频",
    "Offline model returned no audio"
  ],
  [
    "在线服务返回了不完整帧 / Truncated online audio frame",
    "在线服务返回了不完整帧",
    "Truncated online audio frame"
  ],
  [
    "在线音频格式不匹配 / Unexpected online audio format",
    "在线音频格式不匹配",
    "Unexpected online audio format"
  ],
  [
    "音频采样率不一致 / Inconsistent audio sample rates",
    "音频采样率不一致",
    "Inconsistent audio sample rates"
  ],
  [
    "拒绝不安全的下载重定向 / Insecure download redirect",
    "拒绝不安全的下载重定向",
    "Insecure download redirect"
  ],
  [
    "无法读取系统声线 / Could not read system voices",
    "无法读取系统声线",
    "Could not read system voices"
  ],
  [
    "在线响应任务不匹配 / Online response ID mismatch",
    "在线响应任务不匹配",
    "Online response ID mismatch"
  ],
  [
    "下载服务未返回有效文件 / Invalid download response",
    "下载服务未返回有效文件",
    "Invalid download response"
  ],
  [
    "在线服务帧头无效 / Invalid online frame header",
    "在线服务帧头无效",
    "Invalid online frame header"
  ],
  [
    "组件路径类型不安全 / Unsafe component path type",
    "组件路径类型不安全",
    "Unsafe component path type"
  ],
  [
    "拒绝链接、特殊文件或过多文件 / Unsafe archive member",
    "拒绝链接、特殊文件或过多文件",
    "Unsafe archive member"
  ],
  [
    "不支持的分离模式 / Unsupported separation mode",
    "不支持的分离模式",
    "Unsupported separation mode"
  ],
  [
    "解压大小超限 / Unpacked size limit exceeded",
    "解压大小超限",
    "Unpacked size limit exceeded"
  ],
  [
    "无法读取组件文件 / Cannot read archive member",
    "无法读取组件文件",
    "Cannot read archive member"
  ],
  [
    "在线声线名称无效 / Invalid online voice name",
    "在线声线名称无效",
    "Invalid online voice name"
  ],
  [
    "不支持的语音引擎 / Unsupported speech engine",
    "不支持的语音引擎",
    "Unsupported speech engine"
  ],
  [
    "不支持的语音操作 / Unsupported TTS operation",
    "不支持的语音操作",
    "Unsupported TTS operation"
  ],
  [
    "模型返回的音频无效 / Invalid audio from model",
    "模型返回的音频无效",
    "Invalid audio from model"
  ],
  [
    "语音辅助结果解析失败 / Invalid TTS helper JSON",
    "语音辅助结果解析失败",
    "Invalid TTS helper JSON"
  ],
  [
    "组件解压不完整 / Incomplete extracted file",
    "组件解压不完整",
    "Incomplete extracted file"
  ],
  [
    "语音辅助结果无效 / Invalid TTS helper reply",
    "语音辅助结果无效",
    "Invalid TTS helper reply"
  ],
  [
    "下载断点响应不匹配 / Invalid download range",
    "下载断点响应不匹配",
    "Invalid download range"
  ],
  [
    "音频长度超过一小时 / Audio exceeds one hour",
    "音频长度超过一小时",
    "Audio exceeds one hour"
  ],
  [
    "本地语音失败 / Offline synthesis failed",
    "本地语音失败",
    "Offline synthesis failed"
  ],
  [
    "压缩包包含保留路径 / Reserved archive path",
    "压缩包包含保留路径",
    "Reserved archive path"
  ],
  [
    "系统语音超时 / System speech timed out",
    "系统语音超时",
    "System speech timed out"
  ],
  [
    "压缩包路径重复 / Duplicate archive path",
    "压缩包路径重复",
    "Duplicate archive path"
  ],
  [
    "语音操作失败 / Speech operation failed",
    "语音操作失败",
    "Speech operation failed"
  ],
  [
    "压缩包含非法路径 / Invalid archive path",
    "压缩包含非法路径",
    "Invalid archive path"
  ],
  [
    "语音辅助操作超时 / TTS helper timed out",
    "语音辅助操作超时",
    "TTS helper timed out"
  ],
  [
    "本地声线无效 / Invalid offline voice",
    "本地声线无效",
    "Invalid offline voice"
  ],
  [
    "未知语音组件 / Unknown TTS component",
    "未知语音组件",
    "Unknown TTS component"
  ],
  [
    "请选择语音模型 / Select a voice model",
    "请选择语音模型",
    "Select a voice model"
  ],
  [
    "语音辅助进程退出 / TTS helper exited: ",
    "语音辅助进程退出",
    "TTS helper exited: "
  ],
  [
    "说话人编号无效 / Invalid speaker ID",
    "说话人编号无效",
    "Invalid speaker ID"
  ]
] as const;
export function v66Message(value: string, locale: "zh-CN" | "en"): string | undefined {
  for (const [source, zh, en] of PAIRS) {
    const target = locale === "en" ? en : zh;
    if (value === source) return target;
    if ((source.endsWith(": ") || source.endsWith("(")) && value.startsWith(source)) return target + (locale === "zh-CN" ? source.endsWith("(") ? " (" : ": " : "") + value.slice(source.length);
  }
  const separation = "分离完成，可先试听再保存 / Separation ready for preview (";
  if (value.startsWith(separation)) return (locale === "en" ? "Separation ready for preview (" : "分离完成，可先试听再保存 (") + value.slice(separation.length);
  return undefined;
}
