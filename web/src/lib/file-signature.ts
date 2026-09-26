/**
 * 上传文件的"真实身份"校验（按文件头字节判断，也就是 magic bytes）。
 *
 * 为什么需要它：
 *   光看扩展名是会被骗的 —— 有人把 Windows 程序（.exe）改名成 .png 传进来，
 *   扩展名写着"图片"，内容却是可执行文件。真拿去喂给图片/视频解码库，
 *   轻则报一个看不懂的错，重则撞上解码库的漏洞。
 *
 * 为什么**只**校验"表里不一"、而不按扩展名一刀切：
 *   本软件是本地工具箱，"给一个 .exe 算哈希"是完全正当的用法
 *   （哈希、Hex 查看、文件隐藏这些工具本来就该能处理任意文件）。
 *   所以这里只在**内容和扩展名互相矛盾**时才拦，正常的 .exe 上传一律放行。
 *
 * 设计原则：宁可漏放，不可错杀。认不出来的内容一律放行，
 * 绝不因为"我没见过这种格式"就把用户的正常文件挡在门外。
 */

/** 从文件头识别出的类型（只列我们认得的，认不出就是 unknown） */
export type FileKind =
  | "png"
  | "jpeg"
  | "gif"
  | "webp"
  | "bmp"
  | "tiff"
  | "ico"
  | "heic"
  | "avif"
  | "svg"
  | "pdf"
  | "zip"
  | "rar"
  | "7z"
  | "gzip"
  | "mp3"
  | "mp4"
  | "ogg"
  | "wav"
  | "flac"
  | "webm"
  | "windows-pe"
  | "linux-elf"
  | "macos-macho"
  | "script"
  | "unknown";

/** 用于提示的中文名 */
const KIND_LABEL: Record<FileKind, string> = {
  png: "PNG 图片",
  jpeg: "JPEG 图片",
  gif: "GIF 图片",
  webp: "WebP 图片",
  bmp: "BMP 图片",
  tiff: "TIFF 图片",
  ico: "ICO 图标",
  heic: "HEIC 图片",
  avif: "AVIF 图片",
  svg: "SVG 矢量图",
  pdf: "PDF 文档",
  zip: "ZIP 压缩包（也可能是 docx/xlsx 这类 Office 文件）",
  rar: "RAR 压缩包",
  "7z": "7z 压缩包",
  gzip: "GZIP 压缩包",
  mp3: "MP3 音频",
  mp4: "MP4 视频",
  ogg: "OGG 音频",
  wav: "WAV 音频",
  flac: "FLAC 音频",
  webm: "WebM 视频",
  "windows-pe": "Windows 可执行程序（.exe/.dll）",
  "linux-elf": "Linux 可执行程序",
  "macos-macho": "macOS 可执行程序",
  script: "脚本文件",
  unknown: "无法识别的格式",
};

function startsWith(head: Uint8Array, bytes: number[], offset = 0): boolean {
  if (head.length < offset + bytes.length) return false;
  for (let i = 0; i < bytes.length; i++) {
    if (head[offset + i] !== bytes[i]) return false;
  }
  return true;
}

/** 把开头若干字节转成小写 ASCII（用于比对文本型特征，如 <svg、@echo off） */
function asciiHead(head: Uint8Array, max = 1024): string {
  const slice = head.subarray(0, Math.min(head.length, max));
  let out = "";
  for (const b of slice) out += b >= 32 && b < 127 ? String.fromCharCode(b) : " ";
  return out;
}

/**
 * 按文件头判断真实类型。
 * 判断顺序从"特征最独特"到"最宽松"，避免把 SVG 误判成脚本、把 docx 误判成 exe 之类。
 */
export function detectFileKind(head: Uint8Array): FileKind {
  if (head.length === 0) return "unknown";

  // 可执行文件（特征最明确，先判）
  if (startsWith(head, [0x4d, 0x5a])) return "windows-pe"; // "MZ"
  if (startsWith(head, [0x7f, 0x45, 0x4c, 0x46])) return "linux-elf"; // \x7fELF
  if (
    startsWith(head, [0xfe, 0xed, 0xfa, 0xce]) ||
    startsWith(head, [0xfe, 0xed, 0xfa, 0xcf]) ||
    startsWith(head, [0xce, 0xfa, 0xed, 0xfe]) ||
    startsWith(head, [0xcf, 0xfa, 0xed, 0xfe]) ||
    startsWith(head, [0xca, 0xfe, 0xba, 0xbe])
  ) {
    return "macos-macho";
  }

  // 图片 / 文档 / 压缩包
  if (startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "png";
  if (startsWith(head, [0xff, 0xd8, 0xff])) return "jpeg";
  if (startsWith(head, [0x47, 0x49, 0x46, 0x38])) return "gif"; // GIF8
  if (startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x45, 0x42, 0x50], 8)) return "webp";
  if (startsWith(head, [0x42, 0x4d])) return "bmp"; // BM
  if (startsWith(head, [0x49, 0x49, 0x2a, 0x00]) || startsWith(head, [0x4d, 0x4d, 0x00, 0x2a])) return "tiff";
  if (startsWith(head, [0x00, 0x00, 0x01, 0x00])) return "ico";
  if (startsWith(head, [0x25, 0x50, 0x44, 0x46])) return "pdf"; // %PDF
  if (startsWith(head, [0x50, 0x4b, 0x03, 0x04]) || startsWith(head, [0x50, 0x4b, 0x05, 0x06])) return "zip";
  if (startsWith(head, [0x52, 0x61, 0x72, 0x21, 0x1a, 0x07])) return "rar"; // Rar!
  if (startsWith(head, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c])) return "7z";
  if (startsWith(head, [0x1f, 0x8b])) return "gzip";

  // ISO-BMFF 系列：mp4 / heic / avif 共用 ftyp 盒子，按 brand 区分
  if (startsWith(head, [0x66, 0x74, 0x79, 0x70], 4)) {
    const brand = asciiHead(head.subarray(8, 12), 4).trim();
    if (/^(heic|heix|hevc|mif1|msf1)$/.test(brand)) return "heic";
    if (/^(avif|avis)$/.test(brand)) return "avif";
    return "mp4";
  }

  // 音频 / 视频
  if (startsWith(head, [0x49, 0x44, 0x33]) || startsWith(head, [0xff, 0xfb]) || startsWith(head, [0xff, 0xf3])) return "mp3";
  if (startsWith(head, [0x4f, 0x67, 0x67, 0x53])) return "ogg"; // OggS
  if (startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x41, 0x56, 0x45], 8)) return "wav";
  if (startsWith(head, [0x66, 0x4c, 0x61, 0x43])) return "flac"; // fLaC
  if (startsWith(head, [0x1a, 0x45, 0xdf, 0xa3])) return "webm"; // EBML（mkv 同族）

  // 文本型：SVG 与脚本都用文本判断，要注意先后（SVG 必须先判，否则会被当成脚本）
  const text = asciiHead(head, 2048);
  if (/<svg[\s>]/i.test(text) || /<\?xml[^>]*\?>[\s\S]{0,200}<svg[\s>]/i.test(text)) return "svg";
  if (/^\s*(#!|@echo\s+off|@echo\soff|\$ErrorActionPreference|<!doctype\s+html)/i.test(text)) return "script";

  return "unknown";
}

/** 扩展名 → 我们认可的"它应该是什么"（用于判断表里是否一致） */
const EXT_KINDS: Record<string, FileKind[]> = {
  png: ["png"],
  jpg: ["jpeg"],
  jpeg: ["jpeg"],
  jpe: ["jpeg"],
  gif: ["gif"],
  webp: ["webp"],
  bmp: ["bmp"],
  tif: ["tiff"],
  tiff: ["tiff"],
  ico: ["ico"],
  heic: ["heic"],
  heif: ["heic"],
  avif: ["avif"],
  svg: ["svg"],
  pdf: ["pdf"],
  zip: ["zip"],
  docx: ["zip"],
  xlsx: ["zip"],
  pptx: ["zip"],
  epub: ["zip"],
  jar: ["zip"],
  apk: ["zip"],
  rar: ["rar"],
  "7z": ["7z"],
  gz: ["gzip"],
  tgz: ["gzip"],
  mp3: ["mp3"],
  m4a: ["mp4"],
  aac: ["mp3", "mp4", "unknown"],
  mp4: ["mp4"],
  m4v: ["mp4"],
  mov: ["mp4"],
  ogg: ["ogg"],
  oga: ["ogg"],
  opus: ["ogg"],
  wav: ["wav"],
  flac: ["flac"],
  webm: ["webm"],
  mkv: ["webm", "mp4"],
  exe: ["windows-pe"],
  dll: ["windows-pe"],
  sys: ["windows-pe"],
  scr: ["windows-pe"],
  com: ["windows-pe", "unknown"],
  ocx: ["windows-pe"],
  cpl: ["windows-pe"],
  msi: ["unknown", "windows-pe"], // MSI 是 OLE 复合文档，不做严格判定
  so: ["linux-elf"],
  elf: ["linux-elf"],
  bin: ["linux-elf", "windows-pe", "unknown"],
  sh: ["script", "unknown"],
  bash: ["script", "unknown"],
  ps1: ["script", "unknown"],
  bat: ["script", "unknown"],
  cmd: ["script", "unknown"],
  vbs: ["script", "unknown"],
  js: ["script", "unknown"],
  py: ["script", "unknown"],
  txt: ["unknown", "script"],
  csv: ["unknown"],
  json: ["unknown"],
  xml: ["unknown", "svg"],
  html: ["script", "unknown"],
  htm: ["script", "unknown"],
};

export type SignatureVerdict = { ok: true; kind: FileKind } | { ok: false; kind: FileKind; reason: string };

/**
 * 这些工具**必须豁免**文件头校验。
 *
 * 原因：它们的立身之本就是"让文件内容伪装成别的东西"，或者天生要处理任意文件，
 * 用"表里不一"当拦截理由会把它们自己的核心功能挡死。典型例子：
 *   - file-hide-image（文件伪装为图片）：本来就要把 .exe / .zip 藏进一张图片里；
 *   - image-obfuscate（图片混淆与加密）：输出的就是一张"看不出内容"的图片；
 *   - archpr（压缩包密码恢复）：用户手里常常就是改了名的压缩包；
 *   - file-hex / sha-hash / hash-generator：本来就是给任意文件（含 .exe）算哈希的。
 *
 * 现状说明：上面这些工具目前**全部是纯前端完成**（元数据里 clientSide: true，
 * 文件根本不经过服务端），所以这道校验实际上压根碰不到它们。
 * 保留这份名单是为了"以后万一有人把它们改成走服务端也不会踩坑"。
 */
export const SIGNATURE_EXEMPT_TOOLS = new Set([
  "file-hide-image",
  "image-obfuscate",
  "archpr",
  "file-hex",
  "sha-hash",
  "hash-generator",
]);

/** 这个工具是否需要做文件头校验 */
export function needsSignatureCheck(toolId: string): boolean {
  return !SIGNATURE_EXEMPT_TOOLS.has(toolId);
}

/**
 * 校验一个上传文件的"表里是否一致"。
 *
 * 只在**内容是可执行程序/脚本、而扩展名假装成别的东西**时拒绝。
 * 其它一切情况（包括扩展名认不出来、内容认不出来、扩展名与内容不一致但都无害）
 * 一律放行，交给具体工具自己去处理。
 */
export function verifyUploadSignature(head: Uint8Array, filename: string): SignatureVerdict {
  const kind = detectFileKind(head);

  // 只有"可执行/脚本"这一类才值得拦
  const dangerous = kind === "windows-pe" || kind === "linux-elf" || kind === "macos-macho" || kind === "script";
  if (!dangerous) return { ok: true, kind };

  const ext = (filename.split(".").pop() || "").toLowerCase();
  const expected = EXT_KINDS[ext];
  // 扩展名认不出来（比如没后缀）：内容是可执行文件但没人声称它是什么，
  // 属于正常场景（给 .exe 改名成无后缀做哈希测试等），放行。
  if (!expected) return { ok: true, kind };
  if (expected.includes(kind)) return { ok: true, kind };

  return {
    ok: false,
    kind,
    reason:
      `这个文件的内容是「${KIND_LABEL[kind]}」，但扩展名写的是 .${ext}，` +
      `两者对不上，出于安全考虑已拒绝处理。如果你确实想处理这个文件，请先确认它的真实类型。`,
  };
}

/** 给日志/提示用的可读类型名 */
export function describeFileKind(kind: FileKind): string {
  return KIND_LABEL[kind];
}
