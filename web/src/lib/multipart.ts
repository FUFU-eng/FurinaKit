/**
 * 流式 multipart/form-data 解析器。
 *
 * ── 为什么需要它（"内存卫生"）──────────────────────────────────────────────
 * 以前所有上传接口都写 `await request.formData()`。这个 API 会把**整个请求体**先收进内存，
 * 再切成一堆 File 对象给你；也就是说上传一个 2GB 的文件，服务进程内存就先涨 2GB，
 * 之后 `Buffer.from(await file.arrayBuffer())` 还要再复制一份，峰值能到两倍文件大小。
 * 而本项目的上传是**不限大小**的（这是产品明确要求），所以这条路迟早会把应用撑爆。
 *
 * 这里改成边收边写：正文只经过一个 64KB 量级的缓冲区，内存占用与文件大小无关。
 *
 * ── 设计 ─────────────────────────────────────────────────────────────────
 * 解析器只负责「切分段 + 给出正文的异步可迭代对象」，**不碰磁盘**。
 * 落盘交给调用方传进来的 saveFile 回调（见 lib/storage.ts 的 saveUploadStream）。
 * 这样解析器不依赖项目里的任何路径别名，可以独立做单元测试。
 *
 * 关键约束：每个段的 body 只能被消费一次，而且必须在解析器开始处理下一个段之前读完
 * （saveFile 返回的 Promise resolve 之后，解析器才会继续往下切）。
 */

const CRLFCRLF = Buffer.from("\r\n\r\n");
/** 单个非文件字段（普通表单值）允许的最大字节数，防止有人用超长字段把内存撑爆 */
const MAX_FIELD_BYTES = 8 * 1024 * 1024;
/** 单个段的头部允许的最大字节数 */
const MAX_HEADER_BYTES = 64 * 1024;

export type MultipartPart = {
  field: string;
  /** 原始文件名（已把浏览器发的原始 UTF-8 字节还原好）；没有 filename 的段是普通字段 */
  filename: string;
  contentType: string;
  /** 该段正文；只能被消费一次 */
  body: AsyncIterable<Buffer>;
};

export type MultipartFileSaver = (part: MultipartPart) => Promise<{ path: string; size: number }>;

export type SavedMultipartFile = {
  field: string;
  filename: string;
  contentType: string;
  /** 落盘后的绝对路径 */
  path: string;
  /** 实际写入的字节数 */
  size: number;
};

export type MultipartResult = {
  fields: Record<string, string>;
  files: SavedMultipartFile[];
};

/** 从 Content-Type 里取 boundary；不是 multipart/form-data 就返回 null */
export function getMultipartBoundary(contentType: string | null | undefined): string | null {
  if (!contentType) return null;
  if (!/^multipart\/form-data\b/i.test(contentType.trim())) return null;
  const match = /;\s*boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  const raw = (match?.[1] ?? match?.[2] ?? "").trim();
  return raw.length > 0 ? raw : null;
}

/** 解析一个段头块（不含结尾的空行），键统一转小写 */
function parsePartHeaders(block: Buffer): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of block.toString("latin1").split("\r\n")) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim().toLowerCase();
    const value = line.slice(index + 1).trim();
    if (key) headers[key] = value;
  }
  return headers;
}

/** 取 Content-Disposition 里的参数（支持带引号与不带引号两种写法） */
function dispositionParams(value: string): Record<string, string> {
  const params: Record<string, string> = {};
  const pattern = /;\s*([A-Za-z0-9*_-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^;]*))/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(value)) !== null) {
    const key = match[1].toLowerCase();
    const raw = match[2] !== undefined ? match[2].replace(/\\(.)/g, "$1") : (match[3] ?? "").trim();
    params[key] = raw;
  }
  return params;
}

/**
 * 还原文件名。
 *
 * 两种来源都要照顾到：
 * 1. `filename*=UTF-8''%E4%B8%AD%E6%96%87.png`（RFC 5987，百分号编码）；
 * 2. `filename="中文.png"` —— 规范要求百分号编码，但浏览器（含 Chromium）实际是把
 *    原始 UTF-8 字节直接塞进引号里。上面整块头是按 latin1 解的，所以这里要
 *    按 latin1 → UTF-8 再还原一次；纯 ASCII 文件名经过这一趟完全不变。
 *    万一原始字节不是 UTF-8（解出来出现替换字符），就退回原样，不做二次破坏。
 */
function resolveFilename(params: Record<string, string>): string | null {
  const extended = params["filename*"];
  if (extended) {
    const match = /^([^']*)'[^']*'(.*)$/.exec(extended);
    try {
      return decodeURIComponent(match ? match[2] : extended);
    } catch {
      /* 编码坏了就往下走，用 filename */
    }
  }
  if (params.filename === undefined) return null;
  const raw = params.filename;
  const restored = Buffer.from(raw, "latin1").toString("utf8");
  return restored.includes("\uFFFD") ? raw : restored;
}

type MultipartSource = {
  headers: { get(name: string): string | null };
  body: ReadableStream<Uint8Array> | null;
};

/**
 * 解析 multipart 请求体：文件段交给 saveFile 边收边落盘，普通字段收进 fields。
 *
 * 行为与 `request.formData()` 对齐的部分：字段顺序、同名字段（后者覆盖前者，
 * 与 FormData.get 一致）、文件按出现顺序排列。
 */
export async function parseMultipart(
  source: MultipartSource,
  saveFile: MultipartFileSaver,
): Promise<MultipartResult> {
  const boundary = getMultipartBoundary(source.headers.get("content-type"));
  if (!boundary) throw new Error("请求不是 multipart/form-data");
  if (!source.body) throw new Error("请求体为空");

  /** 落在「当前分段」里的分隔符：正文里出现不带 CRLF 的 --boundary 不算结束 */
  const delimiter = Buffer.from(`\r\n--${boundary}`);
  /** 正文开头那一个分隔符没有前导 CRLF */
  const firstDelimiter = Buffer.from(`--${boundary}`);

  const reader = source.body.getReader();
  // 显式标注成 Buffer<ArrayBufferLike>：请求体切出来的块与 Buffer.alloc 的泛型参数不同，
  // 不标注的话每次重新赋值都会报类型不兼容。
  let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let ended = false;

  const readMore = async (): Promise<boolean> => {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) {
        ended = true;
        return false;
      }
      if (!value || value.byteLength === 0) continue;
      const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
      buffer = buffer.length === 0 ? chunk : Buffer.concat([buffer, chunk]);
      return true;
    }
  };

  const readExactly = async (count: number): Promise<Buffer> => {
    while (buffer.length < count) {
      if (!(await readMore())) throw new Error("multipart 数据提前结束");
    }
    const out = buffer.subarray(0, count);
    buffer = buffer.subarray(count);
    return out;
  };

  const readUntil = async (needle: Buffer, limit: number): Promise<Buffer> => {
    for (;;) {
      const index = buffer.indexOf(needle);
      if (index !== -1) {
        const out = buffer.subarray(0, index);
        buffer = buffer.subarray(index + needle.length);
        return out;
      }
      if (buffer.length > limit) throw new Error("multipart 分段头部过长");
      if (!(await readMore())) throw new Error("multipart 数据提前结束（没找到分隔符）");
    }
  };

  /** 当前段的正文：一边从网络读、一边把除尾部保护字节外的内容交给消费方 */
  const currentBody = async function* (): AsyncGenerator<Buffer> {
    for (;;) {
      const index = buffer.indexOf(delimiter);
      if (index !== -1) {
        if (index > 0) yield buffer.subarray(0, index);
        buffer = buffer.subarray(index + delimiter.length);
        return;
      }
      // 末尾 delimiter.length-1 个字节可能是被切断的分隔符，先扣住不发
      const safe = buffer.length - (delimiter.length - 1);
      if (safe > 0) {
        yield buffer.subarray(0, safe);
        buffer = buffer.subarray(safe);
      }
      if (!(await readMore())) throw new Error("multipart 数据提前结束（正文没有正常收尾）");
    }
  };

  const fields: Record<string, string> = {};
  const files: SavedMultipartFile[] = [];

  try {
    // 开头可能有前导内容（规范允许），一律丢掉
    await readUntil(firstDelimiter, MAX_HEADER_BYTES);

    for (;;) {
      const marker = await readExactly(2);
      if (marker[0] === 0x2d && marker[1] === 0x2d) break; // "--" 结束
      if (marker[0] !== 0x0d || marker[1] !== 0x0a) throw new Error("multipart 分隔符格式不正确");

      const headerBlock = await readUntil(CRLFCRLF, MAX_HEADER_BYTES);
      const headers = parsePartHeaders(headerBlock);
      const params = dispositionParams(headers["content-disposition"] ?? "");
      const field = params.name;
      if (!field) throw new Error("multipart 分段缺少 name");
      const filename = resolveFilename(params);
      const contentType = headers["content-type"] ?? "";

      if (filename === null) {
        const chunks: Buffer[] = [];
        let total = 0;
        for await (const chunk of currentBody()) {
          total += chunk.length;
          if (total > MAX_FIELD_BYTES) throw new Error("multipart 表单字段过大");
          chunks.push(Buffer.from(chunk));
        }
        fields[field] = Buffer.concat(chunks).toString("utf8");
        continue;
      }

      const saved = await saveFile({ field, filename, contentType, body: currentBody() });
      files.push({ field, filename, contentType, path: saved.path, size: saved.size });
    }
  } finally {
    if (!ended) await reader.cancel().catch(() => {});
  }

  return { fields, files };
}
