import { localeTag as __localeTag } from "@/lib/language";
"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/encoder-studio-tool.tsx");


/**
 * 编码转换工具箱（11 种编码合并在一个页面）
 *
 * 与已有工具的分工：Base64 / URL / Unicode / 摩斯 / 凯撒 已有独立工具，这里只补缺的：
 * Base32、Base58、Ascii85、Punycode、ROT13、ROT47、XOR、UUencode、HTML 实体、
 * 文本与二进制/十六进制互转、JWT 解析。
 *
 * 同样是数据驱动：每个编码只声明 encode / decode 两个纯函数，界面与双向转换共用一套壳。
 * 全部纯前端，零依赖零体积。
 */

import { useMemo, useState } from "react";
import { ArrowLeftRight, Check, Copy, Download, ShieldCheck, Wand2 } from "lucide-react";
import { Button, Input, Select } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

/* ══════════════════════ 编码实现 ══════════════════════ */

const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const B58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base32Encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  while (out.length % 8 !== 0) out += "=";
  return out;
}

function base32Decode(text: string): string {
  const clean = text.toUpperCase().replace(/=+$/, "").replace(/\s/g, "");
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const ch of clean) {
    const idx = B32_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error(`含有不属于 Base32 的字符：${ch}`);
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new TextDecoder().decode(new Uint8Array(bytes));
}

function base58Encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const digits: number[] = [0];
  for (const b of bytes) {
    let carry = b;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let out = "";
  for (const b of bytes) {
    if (b === 0) out += B58_ALPHABET[0];
    else break;
  }
  for (let i = digits.length - 1; i >= 0; i--) out += B58_ALPHABET[digits[i]];
  return out;
}

function base58Decode(text: string): string {
  const clean = text.trim();
  const bytes: number[] = [0];
  for (const ch of clean) {
    const idx = B58_ALPHABET.indexOf(ch);
    if (idx < 0) throw new Error(`含有不属于 Base58 的字符：${ch}`);
    let carry = idx;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 255;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 255);
      carry >>= 8;
    }
  }
  let zeros = 0;
  for (const ch of clean) {
    if (ch === B58_ALPHABET[0]) zeros++;
    else break;
  }
  const out: number[] = [];
  for (let i = bytes.length - 1; i >= 0; i--) out.push(bytes[i]);
  return new TextDecoder().decode(new Uint8Array([...new Array(zeros).fill(0), ...out]));
}

function ascii85Encode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let out = "";
  for (let i = 0; i < bytes.length; i += 4) {
    const chunk = bytes.slice(i, i + 4);
    const pad = 4 - chunk.length;
    const padded = new Uint8Array([...chunk, ...new Array(pad).fill(0)]);
    let value = ((padded[0] << 24) | (padded[1] << 16) | (padded[2] << 8) | padded[3]) >>> 0;
    if (value === 0 && pad === 0) {
      out += "z";
      continue;
    }
    const group: string[] = [];
    for (let j = 0; j < 5; j++) {
      group.unshift(String.fromCharCode((value % 85) + 33));
      value = Math.floor(value / 85);
    }
    out += group.join("").slice(0, 5 - pad);
  }
  return `<~${out}~>`;
}

function ascii85Decode(text: string): string {
  const clean = text.trim().replace(/^<~/, "").replace(/~>$/, "").replace(/\s/g, "");
  const out: number[] = [];
  let group: number[] = [];
  const flush = () => {
    if (group.length === 0) return;
    const pad = 5 - group.length;
    const g = [...group, ...new Array(pad).fill(84)];
    let value = 0;
    for (const c of g) value = value * 85 + (c - 33);
    for (let i = 3; i >= 0; i--) out.push((value >>> (i * 8)) & 255);
    for (let i = 0; i < pad; i++) out.pop();
    group = [];
  };
  for (const ch of clean) {
    if (ch === "z") {
      out.push(0, 0, 0, 0);
      continue;
    }
    group.push(ch.charCodeAt(0));
    if (group.length === 5) flush();
  }
  flush();
  return new TextDecoder().decode(new Uint8Array(out));
}

/** RFC 3492 Punycode（域名里的 xn-- 就是它） */
function punycodeEncode(input: string): string {
  const base = 36, tmin = 1, tmax = 26, skew = 38, damp = 700, initialBias = 72, initialN = 128;
  const adapt = (delta: number, numPoints: number, firstTime: boolean) => {
    delta = firstTime ? Math.floor(delta / damp) : delta >> 1;
    delta += Math.floor(delta / numPoints);
    let k = 0;
    while (delta > ((base - tmin) * tmax) >> 1) {
      delta = Math.floor(delta / (base - tmin));
      k += base;
    }
    return k + Math.floor(((base - tmin + 1) * delta) / (delta + skew));
  };
  const digitToChar = (d: number) => String.fromCharCode(d + 22 + 75 * (d < 26 ? 1 : 0));
  const chars = [...input];
  const basic = chars.filter((c) => c.charCodeAt(0) < 128);
  let out = basic.join("");
  let handled = basic.length;
  if (handled > 0) out += "-";
  let n = initialN, delta = 0, bias = initialBias;
  const codePoints = chars.map((c) => c.codePointAt(0)!);
  while (handled < codePoints.length) {
    let m = Infinity;
    for (const cp of codePoints) if (cp >= n && cp < m) m = cp;
    delta += (m - n) * (handled + 1);
    n = m;
    for (const cp of codePoints) {
      if (cp < n) delta++;
      if (cp === n) {
        let q = delta;
        for (let k = base; ; k += base) {
          const t = k <= bias ? tmin : k >= bias + tmax ? tmax : k - bias;
          if (q < t) break;
          out += digitToChar(t + ((q - t) % (base - t)));
          q = Math.floor((q - t) / (base - t));
        }
        out += digitToChar(q);
        bias = adapt(delta, handled + 1, handled === basic.length);
        delta = 0;
        handled++;
      }
    }
    delta++;
    n++;
  }
  return "xn--" + out;
}

function punycodeDecode(input: string): string {
  const base = 36, tmin = 1, tmax = 26, skew = 38, damp = 700, initialBias = 72, initialN = 128;
  const adapt = (delta: number, numPoints: number, firstTime: boolean) => {
    delta = firstTime ? Math.floor(delta / damp) : delta >> 1;
    delta += Math.floor(delta / numPoints);
    let k = 0;
    while (delta > ((base - tmin) * tmax) >> 1) {
      delta = Math.floor(delta / (base - tmin));
      k += base;
    }
    return k + Math.floor(((base - tmin + 1) * delta) / (delta + skew));
  };
  const str = input.trim().replace(/^xn--/i, "");
  const idx = str.lastIndexOf("-");
  let n = initialN, i = 0, bias = initialBias;
  const out = idx >= 0 ? [...str.slice(0, idx)] : [];
  let pos = idx >= 0 ? idx + 1 : 0;
  while (pos < str.length) {
    const oldi = i;
    let w = 1;
    for (let k = base; ; k += base) {
      if (pos >= str.length) throw new Error("Punycode 内容不完整");
      const c = str.charCodeAt(pos++);
      const digit = c - 48 < 10 ? c - 22 : c - 65 < 26 ? c - 65 : c - 97;
      i += digit * w;
      const t = k <= bias ? tmin : k >= bias + tmax ? tmax : k - bias;
      if (digit < t) break;
      w *= base - t;
    }
    bias = adapt(i - oldi, out.length + 1, oldi === 0);
    n += Math.floor(i / (out.length + 1));
    i %= out.length + 1;
    out.splice(i, 0, String.fromCodePoint(n));
    i++;
  }
  return out.join("");
}

const rot13 = (text: string) =>
  text.replace(/[a-zA-Z]/g, (c) => String.fromCharCode(((c <= "Z" ? 90 : 122) >= c.charCodeAt(0) + 13 ? c.charCodeAt(0) + 13 : c.charCodeAt(0) - 13)));

const rot47 = (text: string) => text.replace(/[!-~]/g, (c) => String.fromCharCode(33 + ((c.charCodeAt(0) - 33 + 47) % 94)));

function xorCipher(text: string, key: string, outFormat: string): string {
  if (!key) throw new Error("请填写密钥");
  const bytes = new TextEncoder().encode(text);
  const keyBytes = new TextEncoder().encode(key);
  const out = bytes.map((b, i) => b ^ keyBytes[i % keyBytes.length]);
  if (outFormat === "hex") return [...out].map((b) => b.toString(16).padStart(2, "0")).join(" ");
  if (outFormat === "base64") return btoa(String.fromCharCode(...out));
  return new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(out));
}

function uuencode(text: string): string {
  const bytes = new TextEncoder().encode(text);
  const lines: string[] = [];
  for (let i = 0; i < bytes.length; i += 45) {
    const chunk = bytes.slice(i, i + 45);
    let line = String.fromCharCode(chunk.length + 32);
    for (let j = 0; j < chunk.length; j += 3) {
      const g = [chunk[j], chunk[j + 1] ?? 0, chunk[j + 2] ?? 0];
      const value = (g[0] << 16) | (g[1] << 8) | g[2];
      line += [value >> 18, value >> 12, value >> 6, value].map((x) => String.fromCharCode(((x & 63) || 64) + 32)).join("");
    }
    lines.push(line);
  }
  return `begin 644 text.txt\n${lines.join("\n")}\n\`\nend`;
}

function uudecode(text: string): string {
  const lines = text.split("\n").filter((l) => l && !l.startsWith("begin") && !l.startsWith("end") && l !== "`");
  const out: number[] = [];
  for (const line of lines) {
    const len = line.charCodeAt(0) - 32;
    const body = line.slice(1);
    for (let i = 0; i + 3 < body.length + 1; i += 4) {
      const g = [0, 1, 2, 3].map((k) => (body.charCodeAt(i + k) - 32) & 63);
      if (Number.isNaN(g[0])) break;
      const value = (g[0] << 18) | (g[1] << 12) | (g[2] << 6) | g[3];
      out.push((value >> 16) & 255, (value >> 8) & 255, value & 255);
    }
    while (out.length > 0 && out.length > len && out[out.length - 1] === 0 && line.length <= 61) {
      if (out.length <= len) break;
      out.pop();
    }
  }
  return new TextDecoder().decode(new Uint8Array(out.slice(0, out.length)));
}

const htmlEncode = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);

function htmlDecode(text: string): string {
  if (typeof document === "undefined") return text;
  const el = document.createElement("textarea");
  el.innerHTML = text;
  return el.value;
}

const toBinary = (text: string, sep: string) => [...new TextEncoder().encode(text)].map((b) => b.toString(2).padStart(8, "0")).join(sep);
function fromBinary(text: string): string {
  const clean = text.replace(/[^01]/g, "");
  if (clean.length % 8 !== 0) throw new Error("二进制位数不是 8 的倍数");
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 8) bytes.push(parseInt(clean.slice(i, i + 8), 2));
  return new TextDecoder().decode(new Uint8Array(bytes));
}
const toHex = (text: string, sep: string) => [...new TextEncoder().encode(text)].map((b) => b.toString(16).padStart(2, "0")).join(sep);
function fromHex(text: string): string {
  const clean = text.replace(/[^0-9a-fA-F]/g, "");
  if (clean.length % 2 !== 0) throw new Error("十六进制长度为奇数");
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 2) bytes.push(parseInt(clean.slice(i, i + 2), 16));
  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** JWT 解析：只解析不验签，并提示过期时间 */
function parseJwt(token: string): string {
  const parts = token.trim().split(".");
  if (parts.length < 2) throw new Error("不是有效的 JWT（应该用 . 分成三段）");
  const b64 = (s: string) => {
    const pad = s.replace(/-/g, "+").replace(/_/g, "/");
    return decodeURIComponent(
      atob(pad + "=".repeat((4 - (pad.length % 4)) % 4))
        .split("")
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join(""),
    );
  };
  const header = JSON.parse(b64(parts[0]));
  const payload = JSON.parse(b64(parts[1]));
  const lines = ["【头部】", JSON.stringify(header, null, 2), "", "【负载】", JSON.stringify(payload, null, 2)];
  if (payload.exp) {
    const exp = new Date(payload.exp * 1000);
    const expired = exp.getTime() < Date.now();
    lines.push("", `【有效期】${exp.toLocaleString(__localeTag())} ${expired ? "（已过期）" : "（仍有效）"}`);
  }
  if (payload.iat) lines.push(`【签发时间】${new Date(payload.iat * 1000).toLocaleString(__localeTag())}`);
  lines.push("", "【签名】" + (parts[2] ?? "（无）"), "", "说明：这里只解析内容，不做签名校验，请勿用于安全判断。");
  return lines.join("\n");
}

/* ══════════════════════ 编码清单 ══════════════════════ */

interface Codec {
  id: string;
  name: string;
  hint: string;
  /** 需要额外参数的（XOR 密钥、分隔符），可以有多项 */
  options?: {
    id: string;
    label: string;
    type: "text" | "select";
    def: string;
    placeholder?: string;
    choices?: { label: string; value: string }[];
  }[];
  encode: (text: string, o: Record<string, string>) => string;
  decode?: (text: string, o: Record<string, string>) => string;
  /** 单向工具（例如 JWT 解析）没有反向 */
  oneWay?: string;
}

const CODECS: Codec[] = [
  {
    id: "base32",
    name: "Base32",
    hint: "RFC 4648，常用于一次性密码（TOTP）与部分激活码",
    encode: (t) => base32Encode(t),
    decode: (t) => base32Decode(t),
  },
  {
    id: "base58",
    name: "Base58",
    hint: "比特币地址用的编码，去掉了容易看错的 0OIl",
    encode: (t) => base58Encode(t),
    decode: (t) => base58Decode(t),
  },
  {
    id: "ascii85",
    name: "Ascii85",
    hint: "PDF 与 PostScript 里用的编码，比 Base64 更紧凑",
    encode: (t) => ascii85Encode(t),
    decode: (t) => ascii85Decode(t),
  },
  {
    id: "punycode",
    name: "Punycode",
    hint: "中文域名转成 xn-- 开头的形式，两种方向都能转",
    encode: (t) => punycodeEncode(t),
    decode: (t) => punycodeDecode(t),
  },
  {
    id: "rot13",
    name: "ROT13",
    hint: "字母位移 13 位（加密与解密是同一个操作）",
    encode: (t) => rot13(t),
    decode: (t) => rot13(t),
  },
  {
    id: "rot47",
    name: "ROT47",
    hint: "对全部可见字符位移 47 位，能处理数字与符号",
    encode: (t) => rot47(t),
    decode: (t) => rot47(t),
  },
  {
    id: "xor",
    name: "异或运算",
    hint: "用密钥对每个字节做异或，输出可选十六进制、Base64 或原文",
    options: [
      { id: "key", label: "密钥", type: "text", def: "furinakit", placeholder: "用于异或的密钥" },
      {
        id: "format",
        label: "输出格式",
        type: "select",
        def: "hex",
        choices: [
          { label: "十六进制", value: "hex" },
          { label: "Base64", value: "base64" },
          { label: "原文（可能乱码）", value: "text" },
        ],
      },
    ],
    encode: (t, o) => xorCipher(t, o.key, o.format),
    decode: (t, o) => xorCipher(o.format === "base64" ? atob(t.replace(/\s/g, "")) : o.format === "hex" ? fromHex(t) : t, o.key, "text"),
  },
  {
    id: "uuencode",
    name: "UUencode",
    hint: "老式邮件附件编码，Unix 系统里仍能见到",
    encode: (t) => uuencode(t),
    decode: (t) => uudecode(t),
  },
  {
    id: "html",
    name: "HTML 实体",
    hint: "把 < > & \" 等转成实体，或把实体还原成字符",
    encode: (t) => htmlEncode(t),
    decode: (t) => htmlDecode(t),
  },
  {
    id: "binary",
    name: "文本 ↔ 二进制",
    hint: "每个字符转成 8 位二进制，方便看协议与权限位",
    options: [{ id: "sep", label: "分隔符", type: "select", def: " ", choices: [{ label: "空格", value: " " }, { label: "无", value: "" }, { label: "换行", value: "\n" }] }],
    encode: (t, o) => toBinary(t, o.sep),
    decode: (t) => fromBinary(t),
  },
  {
    id: "texthex",
    name: "文本 ↔ 十六进制",
    hint: "字符与十六进制互转，排查乱码与看文件头时常用",
    options: [{ id: "sep", label: "分隔符", type: "select", def: " ", choices: [{ label: "空格", value: " " }, { label: "无", value: "" }, { label: "换行", value: "\n" }] }],
    encode: (t, o) => toHex(t, o.sep),
    decode: (t) => fromHex(t),
  },
  {
    id: "jwt",
    name: "JWT 解析",
    hint: "只看内容不验签，能直接看到负载、签发与过期时间",
    encode: (t) => parseJwt(t),
    oneWay: "JWT 解析是单向的：把完整 token 粘进来即可看到内容",
  },
];

/* ══════════════════════ 界面 ══════════════════════ */

export function EncoderStudioTool() {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  const { toast } = useToast();
  const [activeId, setActiveId] = useState(CODECS[0].id);
  const active = CODECS.find((c) => c.id === activeId)!;
  const [input, setInput] = useState("");
  const [output, setOutput] = useState("");
  const [error, setError] = useState("");
  const [opts, setOpts] = useState<Record<string, Record<string, string>>>(() =>
    Object.fromEntries(CODECS.map((c) => [c.id, Object.fromEntries((c.options ?? []).map((o) => [o.id, o.def]))])),
  );

  const o = opts[activeId];

  const run = (dir: "encode" | "decode") => {
    setError("");
    try {
      const fn = dir === "encode" ? active.encode : active.decode;
      if (!fn) throw new Error("这个编码只支持正向转换");
      setOutput(fn(input, o));
    } catch (err) {
      setOutput("");
      setError(err instanceof Error ? err.message : "转换失败");
    }
  };

  const swap = () => {
    setInput(output);
    setOutput("");
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(output);
      toast({ title: "已复制结果", variant: "success" });
    } catch {
      toast({ title: "复制失败", variant: "error" });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border p-4" style={{ borderColor: colors.borderSolid, background: colors.card }}>
        <div className="flex flex-wrap gap-2">
          {CODECS.map((c) => {
            const on = c.id === activeId;
            return (
              <button
                key={c.id}
                onClick={() => {
                  setActiveId(c.id);
                  setInput("");
                  setOutput("");
                  setError("");
                }}
                className="rounded-xl border px-3 py-1.5 text-[12.5px] font-medium transition-all"
                style={{ borderColor: on ? "hsl(var(--primary))" : colors.borderSolid, background: on ? colors.active : "transparent", color: colors.text }}
              >
                {__msg(c.name)}
              </button>
            );
          })}
        </div>
        <p className="mt-2.5 flex items-center gap-1.5 text-[11.5px]" style={{ color: colors.muted }}>
          <Wand2 size={12} /> {__ui(active.hint)}
        </p>
      </section>

      {(active.options?.length ?? 0) > 0 && (
        <section className="flex flex-wrap items-end gap-3 rounded-2xl border p-4" style={{ borderColor: colors.borderSolid, background: colors.card }}>
          {active.options!.map((op) => (
            <label key={op.id} className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium" style={{ color: colors.muted }}>{__ui(op.label)}</span>
              {op.type === "select" ? (
                <Select
                  value={o[op.id]}
                  onChange={(e) => setOpts((p) => ({ ...p, [activeId]: { ...p[activeId], [op.id]: e.target.value } }))}
                  className="w-40"
                >
                  {op.choices!.map((c) => (
                    <option key={c.value} value={c.value}>{__ui(c.label)}</option>
                  ))}
                </Select>
              ) : (
                <Input
                  value={o[op.id]}
                  placeholder={__ui(op.placeholder)}
                  onChange={(e) => setOpts((p) => ({ ...p, [activeId]: { ...p[activeId], [op.id]: e.target.value } }))}
                  className="w-48"
                />
              )}
            </label>
          ))}
        </section>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="flex min-w-0 flex-col rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
          <header className="mb-2.5 flex items-center justify-between">
            <h2 className="flex items-center gap-2 text-[13.5px] font-semibold" style={{ color: colors.text }}>
              <ShieldCheck size={15} /> {__ui("输入")}</h2>
            <span className="text-[11.5px]" style={{ color: colors.muted }}>{input.length} {__ui("字")}</span>
          </header>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={active.oneWay ?? __ui("把要转换的内容粘进来")}
            className="h-72 w-full resize-y rounded-xl border p-3.5 font-mono text-[12.5px] leading-relaxed focus:outline-none"
            style={{ borderColor: colors.borderSolid, background: colors.bg, color: colors.text }}
          />
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button size="sm" className="gap-1.5" onClick={() => run("encode")} disabled={!input.trim()}>
              {active.oneWay ? __ui("解析") : __ui("编码 →")}
            </Button>
            {!active.oneWay && (
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => run("decode")} disabled={!input.trim()}>
                {__ui("← 解码")}
              </Button>
            )}
            <Button size="sm" variant="ghost" className="gap-1.5" onClick={swap} disabled={!output}>
              <ArrowLeftRight size={13} /> {__ui("结果移到输入")}</Button>
          </div>
        </section>

        <section className="flex min-w-0 flex-col rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
          <header className="mb-2.5 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-[13.5px] font-semibold" style={{ color: colors.text }}>
              <Check size={15} /> {__ui("结果")}<span className="text-[11.5px] font-normal" style={{ color: colors.muted }}>{output.length} {__ui("字")}</span>
            </h2>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void copy()} disabled={!output}>
                <Copy size={13} /> {__ui("复制")}</Button>
              <Button
                size="sm"
                variant="outline"
                className="gap-1.5"
                disabled={!output}
                onClick={() => {
                  const blob = new Blob([output], { type: "text/plain;charset=utf-8" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${active.id}-result.txt`;
                  a.click();
                  setTimeout(() => URL.revokeObjectURL(url), 4000);
                }}
              >
                <Download size={13} /> {__ui("下载")}</Button>
            </div>
          </header>
          <textarea
            value={output}
            readOnly
            placeholder={__ui("转换结果会显示在这里")}
            className="h-72 w-full resize-y rounded-xl border p-3.5 font-mono text-[12.5px] leading-relaxed focus:outline-none"
            style={{ borderColor: colors.borderSolid, background: colors.bg, color: colors.text }}
          />
          {error && (
            <p className={cn("mt-2.5 rounded-xl border p-3 text-[12px]")} style={{ borderColor: `${colors.red}55`, color: colors.red, background: `${colors.red}0f` }}>
              {__msg(error)}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
