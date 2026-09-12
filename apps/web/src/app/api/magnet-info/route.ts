/* eslint-disable @typescript-eslint/no-explicit-any */
import { NextResponse } from "next/server";
import crypto from "crypto";
import { saveUpload } from "@/lib/storage";
import { guardApiRequest } from "@/lib/api-guard";

export const runtime = "nodejs";

export interface MagnetTorrentInfo {
  name: string;
  infoHash: string;
  size: number;
  sizeText: string;
  fileCount: number;
  files: Array<{
    path: string;
    size: number;
    sizeText: string;
  }>;
  trackers: string[];
  magnetUri: string;
  torrentPath?: string;
  type: "magnet" | "torrent";
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return "大小未知 (下载时获取)";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let val = bytes;
  while (val >= 1024 && i < units.length - 1) {
    val /= 1024;
    i++;
  }
  return `${val.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

// Base32 解码（支持 32 位 BTIH 转 40 位十六进制 Hash）
function base32ToHex(base32: string): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (let i = 0; i < base32.length; i++) {
    const val = alphabet.indexOf(base32[i].toUpperCase());
    if (val === -1) continue;
    bits += val.toString(2).padStart(5, "0");
  }
  let hex = "";
  for (let i = 0; i + 4 <= bits.length; i += 4) {
    const chunk = bits.substring(i, i + 4);
    hex += parseInt(chunk, 2).toString(16);
  }
  return hex;
}

/**
 * 极简、高效、无外部依赖的 Bencode 解析器
 */
class BencodeParser {
  private pos = 0;
  private buf: Buffer;

  constructor(buffer: Buffer) {
    this.buf = buffer;
  }

  parse(): { value: any; infoRaw?: Buffer } {
    const value = this.next();
    return { value };
  }

  private next(): any {
    if (this.pos >= this.buf.length) return null;
    const char = String.fromCharCode(this.buf[this.pos]);

    if (char === "i") {
      return this.parseInteger();
    } else if (char === "l") {
      return this.parseList();
    } else if (char === "d") {
      return this.parseDictionary();
    } else if (char >= "0" && char <= "9") {
      return this.parseString();
    }
    throw new Error(`Invalid bencode token '${char}' at index ${this.pos}`);
  }

  private parseDictionary(): Record<string, any> {
    return this.parseDictionaryWithInfo().dict;
  }

  private parseInteger(): number {
    this.pos++; // skip 'i'
    const end = this.buf.indexOf(0x65 /* 'e' */, this.pos);
    if (end === -1) throw new Error("Unterminated integer");
    const numStr = this.buf.toString("ascii", this.pos, end);
    this.pos = end + 1;
    return parseInt(numStr, 10);
  }

  private parseString(): Buffer {
    const colon = this.buf.indexOf(0x3a /* ':' */, this.pos);
    if (colon === -1) throw new Error("Invalid string length format");
    const len = parseInt(this.buf.toString("ascii", this.pos, colon), 10);
    if (isNaN(len) || len < 0) throw new Error("Invalid bencode string length");
    this.pos = colon + 1;
    const data = this.buf.subarray(this.pos, this.pos + len);
    this.pos += len;
    return data;
  }

  private parseList(): any[] {
    this.pos++; // skip 'l'
    const list: any[] = [];
    while (this.pos < this.buf.length && this.buf[this.pos] !== 0x65 /* 'e' */) {
      list.push(this.next());
    }
    this.pos++; // skip 'e'
    return list;
  }

  parseDictionaryWithInfo(): { dict: Record<string, any>; infoRaw?: Buffer } {
    if (this.buf[this.pos] !== 0x64 /* 'd' */) {
      throw new Error("Expected dictionary");
    }
    this.pos++; // skip 'd'
    const dict: Record<string, any> = {};
    let infoRaw: Buffer | undefined;

    while (this.pos < this.buf.length && this.buf[this.pos] !== 0x65 /* 'e' */) {
      const keyBuf = this.parseString();
      const key = keyBuf.toString("utf8");

      if (key === "info") {
        const infoStart = this.pos;
        const infoVal = this.next();
        const infoEnd = this.pos;
        infoRaw = this.buf.subarray(infoStart, infoEnd);
        dict[key] = infoVal;
      } else {
        dict[key] = this.next();
      }
    }
    this.pos++; // skip 'e'
    return { dict, infoRaw };
  }
}

/**
 * 解析 .torrent 种子文件 Buffer
 */
function parseTorrentBuffer(buffer: Buffer): MagnetTorrentInfo {
  const parser = new BencodeParser(buffer);
  const { dict, infoRaw } = parser.parseDictionaryWithInfo();
  const info = dict.info || {};

  // 计算精准 info_hash
  let infoHash = "";
  if (infoRaw) {
    infoHash = crypto.createHash("sha1").update(infoRaw).digest("hex");
  }

  // 获取种子名称（支持 utf-8 扩展字段）
  const nameBuffer: Buffer = info["name.utf-8"] || info.name;
  const name = nameBuffer ? nameBuffer.toString("utf8") : "未命名种子资源";

  // 获取文件列表与总大小
  let totalSize = 0;
  const files: Array<{ path: string; size: number; sizeText: string }> = [];

  if (Array.isArray(info.files)) {
    // 多文件种子
    for (const f of info.files) {
      const fLength = typeof f.length === "number" ? f.length : 0;
      totalSize += fLength;
      const pathParts: Buffer[] = f["path.utf-8"] || f.path || [];
      const relPath = pathParts.map((p) => p.toString("utf8")).join("/");
      files.push({
        path: relPath,
        size: fLength,
        sizeText: formatBytes(fLength),
      });
    }
  } else if (typeof info.length === "number") {
    // 单文件种子
    totalSize = info.length;
    files.push({
      path: name,
      size: totalSize,
      sizeText: formatBytes(totalSize),
    });
  }

  // 提取 Tracker
  const trackersSet = new Set<string>();
  if (dict.announce) {
    trackersSet.add(dict.announce.toString("utf8"));
  }
  if (Array.isArray(dict["announce-list"])) {
    for (const group of dict["announce-list"]) {
      if (Array.isArray(group)) {
        for (const t of group) {
          if (t) trackersSet.add(t.toString("utf8"));
        }
      }
    }
  }

  const trackers = Array.from(trackersSet).filter((t) => t.startsWith("http") || t.startsWith("udp"));

  // 构建完整 magnet 链接
  let magnetUri = `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(name)}`;
  for (const t of trackers) {
    magnetUri += `&tr=${encodeURIComponent(t)}`;
  }

  return {
    name,
    infoHash,
    size: totalSize,
    sizeText: formatBytes(totalSize),
    fileCount: files.length,
    files,
    trackers,
    magnetUri,
    type: "torrent",
  };
}

/**
 * 解析磁力链接 (magnet:?xt=urn:btih:...)
 */
function parseMagnetUri(uri: string): MagnetTorrentInfo {
  const match = uri.match(/magnet:\?[^\s"'<>]+/i);
  const cleanUri = match ? match[0] : uri.trim();

  // 提取 xt (urn:btih:...)
  const xtMatch = cleanUri.match(/[?&]xt=urn:btih:([a-zA-Z0-9]+)/i);
  if (!xtMatch) {
    throw new Error("无效的磁力链接，缺少 urn:btih 参数");
  }

  const rawHash = xtMatch[1];
  let infoHash = rawHash;
  if (rawHash.length === 32) {
    // 32 位 base32 转换为 40 位 hex
    try {
      infoHash = base32ToHex(rawHash);
    } catch {
      infoHash = rawHash;
    }
  }

  // 提取 dn (Display Name)
  let name = "";
  const dnMatch = cleanUri.match(/[?&]dn=([^&]+)/i);
  if (dnMatch) {
    try {
      name = decodeURIComponent(dnMatch[1].replace(/\+/g, " "));
    } catch {
      name = dnMatch[1];
    }
  }
  if (!name) {
    name = `磁力资源 [${infoHash.slice(0, 10).toUpperCase()}]`;
  }

  // 提取 xl (Exact Length)
  let size = 0;
  const xlMatch = cleanUri.match(/[?&]xl=([0-9]+)/i);
  if (xlMatch) {
    size = parseInt(xlMatch[1], 10);
  }

  // 提取所有 tr (Trackers)
  const trackers: string[] = [];
  const trMatches = cleanUri.matchAll(/[?&]tr=([^&]+)/gi);
  for (const m of trMatches) {
    try {
      const decoded = decodeURIComponent(m[1]);
      if (!trackers.includes(decoded)) trackers.push(decoded);
    } catch {}
  }

  return {
    name,
    infoHash,
    size,
    sizeText: formatBytes(size),
    fileCount: size > 0 ? 1 : 0,
    files: size > 0 ? [{ path: name, size, sizeText: formatBytes(size) }] : [],
    trackers,
    magnetUri: cleanUri,
    type: "magnet",
  };
}

export async function POST(request: Request) {
  const denied = guardApiRequest(request);
  if (denied) return denied;
  try {
    const contentType = request.headers.get("content-type") || "";

    // 1. 处理上传的 .torrent 文件 (multipart/form-data)
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const file = formData.get("file");

      if (file instanceof File && file.size > 0) {
        const buffer = Buffer.from(await file.arrayBuffer());
        const info = parseTorrentBuffer(buffer);

        // 将文件临时存入 uploads 目录以便 aria2 直接调用
        const savedPath = await saveUpload(file, "torrent");
        info.torrentPath = savedPath;

        return NextResponse.json(info);
      }

      const rawUrl = String(formData.get("url") || "").trim();
      if (rawUrl) {
        const info = parseMagnetUri(rawUrl);
        return NextResponse.json(info);
      }

      return NextResponse.json({ error: "请上传 .torrent 文件或输入磁力链接" }, { status: 400 });
    }

    // 2. 处理 JSON 请求 (粘贴磁力链接)
    const body = await request.json();
    const rawUrl = String(body.url || "").trim();

    if (!rawUrl) {
      return NextResponse.json({ error: "请输入磁力链接" }, { status: 400 });
    }

    const info = parseMagnetUri(rawUrl);
    return NextResponse.json(info);
  } catch (error) {
    console.error("[magnet-info] 解析异常:", error);
    const message = error instanceof Error ? error.message : "解析失败";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
