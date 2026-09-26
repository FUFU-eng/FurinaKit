export interface TotpConfig {
  secret: string;
  digits: number;
  period: number;
  algorithm: "SHA-1" | "SHA-256" | "SHA-512";
  issuer?: string;
  account?: string;
}
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Decode(input: string): Uint8Array<ArrayBuffer> {
  const clean = input.toUpperCase().replace(/[\s-]/g, "");
  if (!/^[A-Z2-7]+=*$/.test(clean)) throw new Error("密钥应当只包含 Base32 字符（A–Z 与 2–7）");
  const raw = clean.replace(/=+$/, "");
  const rem = raw.length % 8;
  if (raw.length > 1024 || ![0, 2, 4, 5, 7].includes(rem)) throw new Error("Base32 密钥长度无效（最多1024个字符）");
  const padding = clean.length - raw.length;
  if (padding && padding !== (8 - rem) % 8) throw new Error("Base32 填充格式不正确");
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of raw) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) { bits -= 8; out.push((value >>> bits) & 255); }
    value &= (1 << bits) - 1;
  }
  if (value !== 0 || !out.length) throw new Error("Base32 末尾填充位无效");
  return new Uint8Array(out);
}

function validate(config: TotpConfig): void {
  if (!Number.isInteger(config.digits) || config.digits < 6 || config.digits > 8) throw new Error("验证码位数必须是6、7或8");
  if (!Number.isInteger(config.period) || config.period < 1 || config.period > 86400) throw new Error("刷新周期必须是1至86400之间的整数秒");
  if (!["SHA-1", "SHA-256", "SHA-512"].includes(config.algorithm)) throw new Error("仅支持 SHA-1、SHA-256 和 SHA-512 算法");
}

export function parseSecret(input: string): TotpConfig | { error: string } {
  try {
    const raw = input.trim();
    if (!raw) throw new Error("请填写密钥（或粘贴 otpauth:// 链接）");
    if (raw.length > 8192) throw new Error("输入过长（最多8192个字符）");
    let config: TotpConfig = {secret: raw, digits: 6, period: 30, algorithm: "SHA-1"};
    if (/^otpauth:/i.test(raw)) {
      const url = new URL(raw);
      if (url.hostname.toLowerCase() !== "totp" || url.username || url.password || url.port || url.hash) throw new Error("仅支持 otpauth://totp/ 链接，不支持 HOTP 或带凭据的链接");
      const params = url.searchParams;
      for (const key of ["secret", "digits", "period", "algorithm", "issuer"]) {
        if (params.getAll(key).length > 1) throw new Error(`链接含重复参数：${key}`);
      }
      if (params.has("counter")) throw new Error("TOTP 链接不支持 HOTP counter 参数");
      const label = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      const colon = label.indexOf(":");
      const issuerFromLabel = colon < 0 ? "" : label.slice(0, colon);
      const account = colon < 0 ? label : label.slice(colon + 1);
      const issuer = params.get("issuer") || issuerFromLabel;
      if (issuerFromLabel && issuer && issuerFromLabel !== issuer) throw new Error("链接标签与 issuer 参数不一致");
      const secret = params.get("secret") || "";
      if (!secret) throw new Error("这个链接里没有 secret 参数");
      const integer = (name: string, fallback: number) => {
        const text = params.get(name);
        if (text === null) return fallback;
        if (!/^\d+$/.test(text)) throw new Error(`${name} 参数必须是整数`);
        return Number(text);
      };
      const algorithm = (params.get("algorithm") ?? "SHA1").toUpperCase();
      const match = /^SHA-?(1|256|512)$/.exec(algorithm);
      if (!match) throw new Error("仅支持 SHA-1、SHA-256 和 SHA-512 算法");
      config = {secret, digits: integer("digits", 6), period: integer("period", 30), algorithm: `SHA-${match[1]}` as TotpConfig["algorithm"], issuer: issuer || undefined, account: account || undefined};
    }
    config.secret = config.secret.replace(/[\s-]/g, "").toUpperCase();
    validate(config);
    base32Decode(config.secret);
    return config;
  } catch (e) {
    return {error: e instanceof TypeError || e instanceof URIError ? "otpauth 链接格式不对，检查一下有没有粘贴完整" : e instanceof Error ? e.message : "密钥格式无效"};
  }
}

export async function totp(config: TotpConfig, timestamp = Date.now()): Promise<string> {
  validate(config);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error("系统时间无效");
  const keyBytes = base32Decode(config.secret);
  const counter = Math.floor(timestamp / 1000 / config.period);
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint32(0, Math.floor(counter / 0x100000000));
  view.setUint32(4, counter >>> 0);
  const key = await crypto.subtle.importKey("raw", keyBytes, {name: "HMAC", hash: config.algorithm}, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, buf));
  const offset = sig[sig.length - 1] & 15;
  const code = ((sig[offset] & 127) << 24) | (sig[offset + 1] << 16) | (sig[offset + 2] << 8) | sig[offset + 3];
  return String(code % 10 ** config.digits).padStart(config.digits, "0");
}
