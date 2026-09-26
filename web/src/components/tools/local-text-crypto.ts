/** Versioned local text envelope. New encryption is authenticated; CBC is read-only legacy compatibility. */
const PREFIX = "FKG1:";
const ITERATIONS = 600000;
const MAX_BYTES = 1024 * 1024;
const MAX_ENVELOPE = Math.ceil((MAX_BYTES + 44) / 3) * 4 + PREFIX.length;
function encode64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
function decode64(text: string): Uint8Array<ArrayBuffer> {
  const normalized = text.replace(/\s/g, "");
  if (!normalized || normalized.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(normalized)) throw new Error("密文Base64格式无效 / Invalid ciphertext Base64");
  return Uint8Array.from(atob(normalized), c => c.charCodeAt(0));
}
function passwordBytes(password: string): Uint8Array {
  if (!password.trim() || password.length > 1024) throw new Error("请输入口令（UTF-8不超过1024字节） / Enter a passphrase, at most 1024 UTF-8 bytes");
  const bytes = new TextEncoder().encode(password);
  if (bytes.length > 1024) throw new Error("口令超过1024字节 / Passphrase exceeds 1024 bytes");
  return bytes;
}
async function derive(password: string, salt: Uint8Array, usage: KeyUsage): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", passwordBytes(password) as BufferSource, "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey({ name: "PBKDF2", hash: "SHA-256", salt: salt as BufferSource, iterations: ITERATIONS }, material, { name: "AES-GCM", length: 256 }, false, [usage]);
}
export async function encryptLocalText(text: string, password: string): Promise<string> {
  const secret = passwordBytes(password);
  if ([...password].length < 12) throw new Error("新加密口令至少12个字符 / New encryption requires at least 12 characters");
  if (text.length > MAX_BYTES) throw new Error("文本最多1 MiB / Text exceeds 1 MiB");
  const plain = new TextEncoder().encode(text);
  if (plain.length > MAX_BYTES) throw new Error("UTF-8文本最多1 MiB / UTF-8 text exceeds 1 MiB");
  // No fixed/default secret, salt or nonce. Browser entropy failures propagate.
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await derive(password, salt, "encrypt");
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv, tagLength: 128 }, key, plain));
  const envelope = new Uint8Array(28 + ciphertext.length);
  envelope.set(salt); envelope.set(iv, 16); envelope.set(ciphertext, 28);
  secret.fill(0); // Best effort only: JS strings/key material are not guaranteed zeroizable.
  return PREFIX + encode64(envelope);
}
export async function decryptLocalText(input: string, password: string): Promise<{ text: string; legacy: boolean }> {
  if (input.length > MAX_ENVELOPE) throw new Error("密文超过1 MiB文本预算 / Ciphertext exceeds text budget");
  const text = input.trim();
  if (text.startsWith(PREFIX)) {
    const data = decode64(text.slice(PREFIX.length));
    if (data.length < 44 || data.length > MAX_BYTES + 44) throw new Error("密文长度无效 / Invalid envelope length");
    const key = await derive(password, data.slice(0, 16), "decrypt");
    const decoded = await crypto.subtle.decrypt({ name: "AES-GCM", iv: data.slice(16, 28), tagLength: 128 }, key, data.slice(28));
    return { text: new TextDecoder("utf-8", { fatal: true }).decode(decoded), legacy: false };
  }
  if (text.startsWith("FKG")) throw new Error("不支持的密文版本 / Unsupported envelope version");
  // Match old key-padding/truncation exactly, only for decoding existing unversioned CBC data.
  const data = decode64(text);
  if (!data.length || data.length % 16 !== 0 || data.length > MAX_BYTES + 16) throw new Error("旧密文长度无效 / Invalid legacy ciphertext length");
  const oldKey = new TextEncoder().encode(password.padEnd(16, "0").slice(0, 16));
  const key = await crypto.subtle.importKey("raw", oldKey, { name: "AES-CBC" }, false, ["decrypt"]);
  const decoded = await crypto.subtle.decrypt({ name: "AES-CBC", iv: new Uint8Array(16) }, key, data);
  return { text: new TextDecoder().decode(decoded), legacy: true };
}
