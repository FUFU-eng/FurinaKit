"use client";
import { createUiText as __createUiText, uiMessage as __msg, useLanguage as __useLanguage } from "@/lib/language";
const __ui = __createUiText("components/tools/checksum-studio-tool.tsx");


/**
 * 校验与摘要工具箱（补齐已有哈希工具没有的算法）
 *
 * 已有：MD5/SHA-1/SHA-256/SHA-512（hash-generator）、SHA 系列（sha-hash）、CRC 校验（crc-checksum）。
 * 这里补：HMAC 系列、RIPEMD-160、MD4、Adler32、CRC16（Modbus / CCITT）。
 *
 * 关于没做的两个算法，直接说明原因，不用"暂时未支持"糊过去：
 *  · Whirlpool：已不是任何现行标准的推荐算法，纯 JS 实现约 200 行且无实际使用场景；
 *  · MD6：从未标准化、没有公开的使用场景（NIST 竞赛后未采纳）。
 *  真有需要时再补，不值得为它们撑大代码量。
 *
 * 全部纯前端，零依赖零体积；HMAC 走浏览器内置 WebCrypto。
 */

import { useEffect, useMemo, useState } from "react";
import { Check, Copy, FileUp, ShieldCheck, Type } from "lucide-react";
import { Button } from "@/components/ui/primitives";
import { useToast } from "@/components/ui/toast";
import { useTheme } from "@/components/theme-provider";
import { cn } from "@/lib/utils";

/* ══════════════════════ 纯 JS 算法实现 ══════════════════════ */

const hex = (bytes: Uint8Array | number[]) => [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

/**
 * RIPEMD-160。
 *
 * 双线并行：左线用 f1..f5、右线用 f5..f1（顺序相反），各自有独立的字序与位移表。
 * 上一版我把轮函数错写成作用于 (a,b,c)，规范里是作用于 (b,c,d)、结果加到 a 上，因此算错；
 * 这个版本过了标准向量（"" / "abc" / "message digest"）。
 */
function ripemd160(bytes: Uint8Array): string {
  const rotl = (x: number, n: number) => ((x << n) | (x >>> (32 - n))) >>> 0;
  const msgLen = bytes.length;
  const total = Math.ceil((msgLen + 9) / 64) * 64;
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[msgLen] = 0x80;
  const bitLen = msgLen * 8;
  const dv = new DataView(buf.buffer);
  dv.setUint32(total - 8, bitLen >>> 0, true);
  dv.setUint32(total - 4, Math.floor(bitLen / 2 ** 32), true);

  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476, h4 = 0xc3d2e1f0;

  const rl = [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15,
    7, 4, 13, 1, 10, 6, 15, 3, 12, 0, 9, 5, 2, 14, 11, 8,
    3, 10, 14, 4, 9, 15, 8, 1, 2, 7, 0, 6, 13, 11, 5, 12,
    1, 9, 11, 10, 0, 8, 12, 4, 13, 3, 7, 15, 14, 5, 6, 2,
    4, 0, 5, 9, 7, 12, 2, 10, 14, 1, 3, 8, 11, 6, 15, 13,
  ];
  const rr = [
    5, 14, 7, 0, 9, 2, 11, 4, 13, 6, 15, 8, 1, 10, 3, 12,
    6, 11, 3, 7, 0, 13, 5, 10, 14, 15, 8, 12, 4, 9, 1, 2,
    15, 5, 1, 3, 7, 14, 6, 9, 11, 8, 12, 2, 10, 0, 4, 13,
    8, 6, 4, 1, 3, 11, 15, 0, 5, 12, 2, 13, 9, 7, 10, 14,
    12, 15, 10, 4, 1, 5, 8, 7, 6, 2, 13, 14, 0, 3, 9, 11,
  ];
  const sl = [
    11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8,
    7, 6, 8, 13, 11, 9, 7, 15, 7, 12, 15, 9, 11, 7, 13, 12,
    11, 13, 6, 7, 14, 9, 13, 15, 14, 8, 13, 6, 5, 12, 7, 5,
    11, 12, 14, 15, 14, 15, 9, 8, 9, 14, 5, 6, 8, 6, 5, 12,
    9, 15, 5, 11, 6, 8, 13, 12, 5, 12, 13, 14, 11, 8, 5, 6,
  ];
  const sr = [
    8, 9, 9, 11, 13, 15, 15, 5, 7, 7, 8, 11, 14, 14, 12, 6,
    9, 13, 15, 7, 12, 8, 9, 11, 7, 7, 12, 7, 6, 15, 13, 11,
    9, 7, 15, 11, 8, 6, 6, 14, 12, 13, 5, 14, 13, 13, 7, 5,
    15, 5, 8, 11, 14, 14, 6, 14, 6, 9, 12, 9, 12, 5, 15, 8,
    8, 5, 12, 9, 12, 5, 14, 6, 8, 13, 6, 5, 15, 13, 11, 11,
  ];
  const KL = [0x00000000, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xa953fd4e];
  const KR = [0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x7a6d76e9, 0x00000000];
  const f = (j: number, x: number, y: number, z: number) => {
    if (j < 16) return x ^ y ^ z;
    if (j < 32) return (x & y) | (~x & z);
    if (j < 48) return (x | ~y) ^ z;
    if (j < 64) return (x & z) | (y & ~z);
    return x ^ (y | ~z);
  };
  const fp = (j: number, x: number, y: number, z: number) => {
    if (j < 16) return x ^ (y | ~z);
    if (j < 32) return (x & z) | (y & ~z);
    if (j < 48) return (x | ~y) ^ z;
    if (j < 64) return (x & y) | (~x & z);
    return x ^ y ^ z;
  };

  const vb = new DataView(buf.buffer);
  for (let i = 0; i < total; i += 64) {
    const x: number[] = [];
    for (let j = 0; j < 16; j++) x.push(vb.getUint32(i + j * 4, true));
    let [al, bl, cl, dl, el] = [h0, h1, h2, h3, h4];
    let [ar, br, cr, dr, er] = [h0, h1, h2, h3, h4];

    for (let j = 0; j < 80; j++) {
      const tl = (rotl((al + f(j, bl, cl, dl) + x[rl[j]] + KL[Math.floor(j / 16)]) >>> 0, sl[j]) + el) >>> 0;
      al = el; el = dl; dl = rotl(cl, 10); cl = bl; bl = tl;

      const tr = (rotl((ar + fp(j, br, cr, dr) + x[rr[j]] + KR[Math.floor(j / 16)]) >>> 0, sr[j]) + er) >>> 0;
      ar = er; er = dr; dr = rotl(cr, 10); cr = br; br = tr;
    }

    const t = (h1 + cl + dr) >>> 0;
    h1 = (h2 + dl + er) >>> 0;
    h2 = (h3 + el + ar) >>> 0;
    h3 = (h4 + al + br) >>> 0;
    h4 = (h0 + bl + cr) >>> 0;
    h0 = t;
  }

  const out = new Uint8Array(20);
  const od = new DataView(out.buffer);
  [h0, h1, h2, h3, h4].forEach((h, i) => od.setUint32(i * 4, h, true));
  return hex(out);
}

/**
 * MD4（RFC 1320）。
 *
 * 写法严格按规范：每步 a = rotl(a + F(b,c,d) + X[k], s)，随后四个寄存器整体轮转。
 * 上一版我用了「按下标轮换变量」的自创写法，测试向量直接算错，所以撤下了；
 * 这个版本过了 RFC 1320 的三个标准向量（空串 / abc / message digest）。
 */
function md4(bytes: Uint8Array): string {
  const rotl = (x: number, n: number) => ((x << n) | (x >>> (32 - n))) >>> 0;
  const msgLen = bytes.length;
  const total = Math.ceil((msgLen + 9) / 64) * 64;
  const buf = new Uint8Array(total);
  buf.set(bytes);
  buf[msgLen] = 0x80;
  const bitLen = msgLen * 8;
  const dvOut = new DataView(buf.buffer);
  dvOut.setUint32(total - 8, bitLen >>> 0, true);
  dvOut.setUint32(total - 4, Math.floor(bitLen / 2 ** 32), true);

  let h0 = 0x67452301, h1 = 0xefcdab89, h2 = 0x98badcfe, h3 = 0x10325476;
  const vb = new DataView(buf.buffer);
  const s1 = [3, 7, 11, 19], s2 = [3, 5, 9, 13], s3 = [3, 9, 11, 15];
  const o2 = [0, 4, 8, 12, 1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15];
  const o3 = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15];

  for (let i = 0; i < total; i += 64) {
    const x: number[] = [];
    for (let j = 0; j < 16; j++) x.push(vb.getUint32(i + j * 4, true));
    let [a, b, c, d] = [h0, h1, h2, h3];

    // 第 1 轮：F(x,y,z) = (x & y) | (~x & z)
    for (let k = 0; k < 16; k++) {
      const t = rotl((a + ((b & c) | (~b & d)) + x[k]) >>> 0, s1[k % 4]);
      a = d; d = c; c = b; b = t;
    }
    // 第 2 轮：G(x,y,z) = (x & y) | (x & z) | (y & z)，加常数 0x5a827999
    for (let k = 0; k < 16; k++) {
      const t = rotl((a + ((b & c) | (b & d) | (c & d)) + x[o2[k]] + 0x5a827999) >>> 0, s2[k % 4]);
      a = d; d = c; c = b; b = t;
    }
    // 第 3 轮：H(x,y,z) = x ^ y ^ z，加常数 0x6ed9eba1
    for (let k = 0; k < 16; k++) {
      const t = rotl((a + (b ^ c ^ d) + x[o3[k]] + 0x6ed9eba1) >>> 0, s3[k % 4]);
      a = d; d = c; c = b; b = t;
    }

    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
  }

  const out = new Uint8Array(16);
  const od = new DataView(out.buffer);
  od.setUint32(0, h0, true);
  od.setUint32(4, h1, true);
  od.setUint32(8, h2, true);
  od.setUint32(12, h3, true);
  return hex(out);
}

/** Adler32：zlib 用来做快速完整性校验 */
function adler32(bytes: Uint8Array): string {
  let a = 1;
  let b = 0;
  for (const byte of bytes) {
    a = (a + byte) % 65521;
    b = (b + a) % 65521;
  }
  return (((b << 16) | a) >>> 0).toString(16).padStart(8, "0");
}

/** CRC16，支持常用两种多项式 */
function crc16(bytes: Uint8Array, variant: "modbus" | "ccitt"): string {
  // Modbus 初值 0xFFFF、结果低字节在前；CCITT-FALSE 初值也是 0xFFFF，但不做位反转
    let crc = 0xffff;
  const poly = variant === "modbus" ? 0xa001 : 0x1021;
  for (const byte of bytes) {
    crc ^= variant === "modbus" ? byte : byte << 8;
    for (let i = 0; i < 8; i++) {
      if (variant === "modbus") {
        crc = crc & 1 ? (crc >>> 1) ^ poly : crc >>> 1;
      } else {
        crc = crc & 0x8000 ? ((crc << 1) ^ poly) & 0xffff : (crc << 1) & 0xffff;
      }
    }
  }
  return (crc & 0xffff).toString(16).padStart(4, "0");
}

async function hmac(algo: "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512", key: string, data: Uint8Array): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(key), { name: "HMAC", hash: algo }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, data as unknown as ArrayBuffer);
  return hex(new Uint8Array(sig));
}

/* ══════════════════════ 界面 ══════════════════════ */

type AlgoId = "hmac-sha1" | "hmac-sha256" | "hmac-sha384" | "hmac-sha512" | "ripemd160" | "md4" | "adler32" | "crc16-modbus" | "crc16-ccitt";

const ALGOS: { id: AlgoId; name: string; hint: string; needsKey?: boolean }[] = [
  { id: "hmac-sha256", name: "HMAC-SHA256", hint: "接口签名与 webhook 校验最常用的算法", needsKey: true },
  { id: "hmac-sha1", name: "HMAC-SHA1", hint: "部分老接口仍在使用", needsKey: true },
  { id: "hmac-sha384", name: "HMAC-SHA384", hint: "与 SHA-384 配套的带密钥摘要", needsKey: true },
  { id: "hmac-sha512", name: "HMAC-SHA512", hint: "带密钥摘要，输出 128 位十六进制", needsKey: true },
  { id: "ripemd160", name: "RIPEMD-160", hint: "比特币地址与 OpenPGP 里常见，输出 40 位十六进制（已过标准向量校验）" },
  { id: "md4", name: "MD4", hint: "老系统与 NTLM 里出现的算法，一般不用于新场景（已过 RFC 1320 向量校验）" },
  { id: "adler32", name: "Adler32", hint: "zlib 的快速校验和，比 CRC32 更快但更弱" },
  { id: "crc16-modbus", name: "CRC16 · Modbus", hint: "工业通讯协议里的校验，低字节在前" },
  { id: "crc16-ccitt", name: "CRC16 · CCITT-FALSE", hint: "蓝牙等场景使用（初值 0xFFFF）" },
];

export function ChecksumStudioTool() {
  const __locale = __useLanguage();
  const { colors } = useTheme();
  const { toast } = useToast();
  const [activeId, setActiveId] = useState<AlgoId>("hmac-sha256");
  const [mode, setMode] = useState<"text" | "file">("text");
  const [text, setText] = useState("");
  const [key, setKey] = useState("");
  const [fileName, setFileName] = useState("");
  const [fileBytes, setFileBytes] = useState<Uint8Array | null>(null);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");

  const active = ALGOS.find((a) => a.id === activeId)!;
  const data = useMemo(() => (mode === "file" ? fileBytes : new TextEncoder().encode(text)), [mode, fileBytes, text, __locale]);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setError("");
      if (!data) {
        setResult("");
        return;
      }
      // 空串也是合法输入：空字符串的摘要本身就有用（例如判断这是不是一个空文件）。
      // 只有文件模式下「还没选文件」才不计算。
      if (mode === "file" && data.length === 0) {
        setResult("");
        return;
      }
      try {
        let out = "";
        if (active.id.startsWith("hmac")) {
          if (!key) throw new Error("HMAC 需要填写密钥");
          const algo = active.id.replace("hmac-", "").toUpperCase().replace("SHA", "SHA-") as "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512";
          out = await hmac(algo, key, data);
        } else if (active.id === "ripemd160") out = ripemd160(data);
        else if (active.id === "md4") out = md4(data);
        else if (active.id === "adler32") out = adler32(data);
        else if (active.id === "crc16-modbus") out = crc16(data, "modbus");
        else out = crc16(data, "ccitt");
        if (!cancelled) setResult(out);
      } catch (err) {
        if (!cancelled) {
          setResult("");
          setError(err instanceof Error ? err.message : "计算失败");
        }
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [active, data, key, mode]);

  const pickFile = async (f: File | undefined) => {
    if (!f) return;
    setFileName(f.name);
    setFileBytes(new Uint8Array(await f.arrayBuffer()));
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result);
      toast({ title: "已复制", variant: "success" });
    } catch {
      toast({ title: "复制失败", variant: "error" });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <section className="rounded-2xl border p-4" style={{ borderColor: colors.borderSolid, background: colors.card }}>
        <div className="flex flex-wrap gap-2">
          {ALGOS.map((a) => {
            const on = a.id === activeId;
            return (
              <button
                key={a.id}
                onClick={() => setActiveId(a.id)}
                className="rounded-xl border px-3 py-1.5 text-[12.5px] font-medium transition-all"
                style={{ borderColor: on ? "hsl(var(--primary))" : colors.borderSolid, background: on ? colors.active : "transparent", color: colors.text }}
              >
                {__msg(a.name)}
              </button>
            );
          })}
        </div>
        <p className="mt-2.5 flex items-center gap-1.5 text-[11.5px]" style={{ color: colors.muted }}>
          <ShieldCheck size={12} /> {__ui(active.hint)}
        </p>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className="flex min-w-0 flex-col gap-3.5 rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
          <div className="flex items-center gap-2">
            <Button size="sm" variant={mode === "text" ? "default" : "outline"} className="gap-1.5" onClick={() => setMode("text")}>
              <Type size={13} /> {__ui("文本")}</Button>
            <Button size="sm" variant={mode === "file" ? "default" : "outline"} className="gap-1.5" onClick={() => setMode("file")}>
              <FileUp size={13} /> {__ui("文件")}</Button>
          </div>

          {active.needsKey && (
            <label className="flex flex-col gap-1.5">
              <span className="text-[12px] font-medium" style={{ color: colors.muted }}>{__ui("密钥")}</span>
              <input
                value={key}
                onChange={(e) => setKey(e.target.value)}
                placeholder={__ui("HMAC 的密钥（secret）")}
                className="rounded-xl border px-3 py-2 font-mono text-[12.5px] focus:outline-none"
                style={{ borderColor: colors.borderSolid, background: colors.bg, color: colors.text }}
              />
            </label>
          )}

          {mode === "text" ? (
            <>
              <span className="text-[12px] font-medium" style={{ color: colors.muted }}>{__ui("要计算的内容")}</span>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder={__ui("粘贴文本，结果会实时更新")}
                className="h-64 w-full resize-y rounded-xl border p-3.5 font-mono text-[12.5px] leading-relaxed focus:outline-none"
                style={{ borderColor: colors.borderSolid, background: colors.bg, color: colors.text }}
              />
            </>
          ) : (
            <>
              <span className="text-[12px] font-medium" style={{ color: colors.muted }}>{__ui("选择文件")}</span>
              <label
                className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-primary/40 bg-primary/[0.04] px-6 py-10 transition-all hover:border-primary/60 hover:bg-primary/10"
              >
                <input type="file" className="hidden" onChange={(e) => void pickFile(e.target.files?.[0])} />
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                  <FileUp className="h-5 w-5" />
                </span>
                <span className="text-[13.5px] font-semibold" style={{ color: colors.text }}>{__ui("点击选择文件，或将文件拖拽到此处")}</span>
                <span className="text-[11.5px]" style={{ color: colors.muted }}>
                  {fileName ? __msg("{0} · {1} 字节", fileName, (fileBytes?.length ?? 0).toLocaleString()) : __ui("文件只在本机读取，不会上传")}
                </span>
              </label>
            </>
          )}
        </section>

        <section className="flex min-w-0 flex-col rounded-2xl border p-5" style={{ borderColor: colors.borderSolid, background: colors.card }}>
          <header className="mb-3 flex items-center justify-between gap-2">
            <h2 className="flex items-center gap-2 text-[13.5px] font-semibold" style={{ color: colors.text }}>
              <Check size={15} /> {__msg(active.name)} {__ui("结果")}</h2>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => void copy()} disabled={!result}>
              <Copy size={13} /> {__ui("复制")}</Button>
          </header>
          <div
            className="flex min-h-[80px] items-center break-all rounded-xl border px-4 py-3.5 font-mono text-[13px]"
            style={{ borderColor: colors.borderSolid, background: colors.bg, color: colors.text }}
          >
            {result || <span style={{ color: colors.muted }}>{mode === "file" ? __ui("选择文件后自动计算") : __ui("在上方输入内容后自动计算")}</span>}
          </div>

          {error && (
            <p className={cn("mt-3 rounded-xl border p-3 text-[12px]")} style={{ borderColor: `${colors.red}55`, color: colors.red, background: `${colors.red}0f` }}>
              {__msg(error)}
            </p>
          )}

          <div className="mt-4 rounded-xl border p-3.5" style={{ borderColor: colors.borderSolid }}>
            <p className="text-[11.5px] leading-relaxed" style={{ color: colors.muted }}>
              {__ui("说明：HMAC 使用浏览器内置的 WebCrypto 计算；Adler32 与 CRC16 为纯前端实现。 已支持的 MD5 / SHA 系列见「哈希计算」工具，CRC32 见「CRC 校验工具」。")}<br />
              <br />
              <strong>{__ui("暂未提供的算法与原因")}</strong>{__ui("：Whirlpool 已非现行标准推荐、MD6 从未被标准化， 两者申请场景极少；bcrypt / scrypt 属于口令存储算法，需要成本因子与盐，交互形态与工具类场景不符。")}</p>
          </div>
        </section>
      </div>
    </div>
  );
}
