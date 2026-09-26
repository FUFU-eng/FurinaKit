/** Shared local-only validation and arithmetic. No network, worker or persistent storage. */
export function bmiSummary(heightText: string, weightText: string): string {
  const h = finite(heightText, "身高") / 100, w = finite(weightText, "体重");
  if (h <= 0 || w <= 0) throw new Error("身高和体重须大于0 / Height and weight must be positive");
  const bmi = w / (h * h); checked([bmi]);
  if (bmi <= 0) throw new Error("数值超出范围 / Number out of range");
  const status = bmi < 18.5 ? "偏瘦" : bmi < 24 ? "正常" : bmi < 28 ? "偏胖" : "肥胖";
  return `BMI 指数：${bmi.toFixed(1)}\n体重状况：${status}\n\n参考标准：\n偏瘦：< 18.5\n正常：18.5 - 23.9\n偏胖：24.0 - 27.9\n肥胖：≥ 28.0\n\n仅供成人常规估算，不替代医疗意见 / Adult estimate, not medical advice`;
}
function finite(input: string, label: string): number {
  const value = input.trim();
  if (!value || value.length > 128 || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value)) throw new Error(`${label}请输入有效十进制数字 / Enter a decimal number`);
  const n = Number(value);
  if (!Number.isFinite(n)) throw new Error(`${label}超出数值范围 / Number out of range`);
  return n;
}
export function boundedInteger(input: string, min: number, max: number, label = "数值"): number {
  const n = finite(input, label);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${label}须为 ${min}–${max} 的整数 / Integer out of range`);
  return n;
}
/** Rejection sampling: no Math.random, no modulo bias, no insecure fallback. */
function randomBelow(span: bigint): bigint {
  const range = 1n << 64n;
  const limit = range - range % span;
  const words = new Uint32Array(2);
  for (let attempt = 0; attempt < 128; attempt++) {
    globalThis.crypto.getRandomValues(words);
    const value = (BigInt(words[0]) << 32n) | BigInt(words[1]);
    if (value < limit) return value % span;
  }
  throw new Error("安全随机源不可用 / Secure random source unavailable");
}
export function passwordList(lengthText: string, countText: string): string {
  const length = boundedInteger(lengthText, 1, 1024, "密码长度");
  const count = boundedInteger(countText, 1, 50, "数量");
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*()_+-=";
  return Array.from({ length: count }, () => Array.from({ length }, () => alphabet[Number(randomBelow(BigInt(alphabet.length)))]).join("")).join("\n");
}
export function randomIntegerList(minText: string, maxText: string, countText: string): string {
  const min = boundedInteger(minText, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, "最小值");
  const max = boundedInteger(maxText, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, "最大值");
  const count = boundedInteger(countText, 1, 100, "数量");
  if (max < min) throw new Error("最大值不能小于最小值 / Maximum must not be below minimum");
  const low = BigInt(min), span = BigInt(max) - low + 1n;
  return Array.from({ length: count }, () => String(low + randomBelow(span))).join("\n");
}
export function crc32Utf8(text: string): number {
  let crc = 0xffffffff;
  for (const byte of new TextEncoder().encode(text)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
export function ipv4ToInteger(input: string): string {
  const text = input.trim();
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(text)) throw new Error("无效 IPv4：需要四段十进制数字 / Invalid decimal IPv4");
  const parts = text.split(".").map(Number);
  if (parts.some(p => p > 255)) throw new Error("IPv4 每段须为0–255 / IPv4 octet out of range");
  return String(parts.reduce((n, p) => n * 256 + p, 0));
}
export function integerToIpv4(input: string): string {
  if (!/^\d{1,16}$/.test(input.trim())) throw new Error("请输入0–4294967295十进制整数 / Invalid IPv4 integer");
  const n = boundedInteger(input, 0, 4294967295);
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255].join(".");
}
function checked(values: number[]): void {
  if (values.some(n => !Number.isFinite(n))) throw new Error("计算超出数值范围 / Calculation out of range");
}
function annuity(principal: number, rate: number, months: number): number {
  return rate === 0 ? principal / months : principal * rate / -Math.expm1(-months * Math.log1p(rate));
}
export function loanSummary(amountText: string, yearsText: string, rateText: string, method: string): string {
  const p = finite(amountText, "金额") * 10000, months = finite(yearsText, "年限") * 12, rate = finite(rateText, "年利率") / 1200;
  if (!Number.isFinite(p) || p <= 0 || rate < 0 || !Number.isInteger(months) || months < 1 || months > 1200) throw new Error("金额须大于0，利率非负，期限为1–1200个整月 / Invalid loan parameters");
  if (method === "equal") {
    const payment = annuity(p, rate, months), total = payment * months, interest = rate === 0 ? 0 : Math.max(0, total - p);
    checked([payment, total, interest]);
    return `月供：${payment.toFixed(2)} 元\n还款总额：${total.toFixed(2)} 元\n支付利息：${interest.toFixed(2)} 元\n贷款本金：${p.toFixed(2)} 元\n还款月数：${months} 个月`;
  }
  if (method !== "principal") throw new Error("不支持的还款方式 / Unsupported repayment method");
  const principal = p / months, first = principal + p * rate, last = principal * (1 + rate), interest = (months + 1) * p * rate / 2, total = p + interest, decrease = principal * rate;
  checked([principal, first, last, interest, total, decrease]);
  return `首月月供：${first.toFixed(2)} 元\n末月月供：${last.toFixed(2)} 元\n每月递减：${decrease.toFixed(2)} 元\n还款总额：${total.toFixed(2)} 元\n支付利息：${interest.toFixed(2)} 元`;
}
export function creditSummary(amountText: string, periodsText: string, feeText: string): string {
  const amount = finite(amountText, "金额"), n = boundedInteger(periodsText, 1, 1200, "期数"), feeRate = finite(feeText, "手续费率") / 100;
  if (amount <= 0 || feeRate < 0) throw new Error("金额须大于0，手续费率非负 / Invalid installment parameters");
  const totalFee = amount * feeRate, monthlyPrincipal = amount / n, monthlyFee = totalFee / n, payment = monthlyPrincipal + monthlyFee;
  checked([totalFee, monthlyPrincipal, monthlyFee, payment]);
  // Equal monthly end-of-period payments. Monotone bounded bisection, never an input-sized loop.
  let low = 0, high = Math.max(1, feeRate);
  for (let i = 0; i < 100 && feeRate > 0; i++) {
    const mid = (low + high) / 2;
    if (annuity(amount, mid, n) > payment) high = mid; else low = mid;
  }
  const monthlyRate = feeRate === 0 ? 0 : (low + high) / 2;
  const annual = Math.expm1(12 * Math.log1p(monthlyRate)) * 100;
  checked([annual, amount + totalFee]);
  return `分期金额：${amount.toFixed(2)} 元\n分期期数：${n} 期\n手续费率：${feeText}%\n总手续费：${totalFee.toFixed(2)} 元\n每月本金：${monthlyPrincipal.toFixed(2)} 元\n每月手续费：${monthlyFee.toFixed(2)} 元\n每月还款：${payment.toFixed(2)} 元\n还款总额：${(amount + totalFee).toFixed(2)} 元\n实际年化利率（IRR）：约 ${annual.toFixed(2)}%`;
}
export function caesar(text: string, shiftText: string, mode: string): string {
  const value = boundedInteger(shiftText, Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, "偏移量");
  if (mode !== "encrypt" && mode !== "decrypt") throw new Error("不支持的模式 / Unsupported mode");
  const shift = ((value % 26) * (mode === "encrypt" ? 1 : -1) + 26) % 26;
  return text.replace(/[a-z]/gi, c => { const base = c >= "a" ? 97 : 65; return String.fromCharCode((c.charCodeAt(0) - base + shift) % 26 + base); });
}
export function userAgentSummary(ua: string): string {
  let browser = "未知", os = "未知", device = "桌面设备";
  const patterns: [RegExp, string][] = [[/Edg(?:A|iOS)?\/(\d+)/, "Edge"], [/OPR\/(\d+)/, "Opera"], [/(?:Firefox|FxiOS)\/(\d+)/, "Firefox"], [/(?:Chrome|CriOS)\/(\d+)/, "Chrome"], [/Version\/(\d+).*Safari/, "Safari"]];
  for (const [pattern, name] of patterns) { const match = ua.match(pattern); if (match) { browser = `${name} ${match[1]}`; break; } }
  if (browser === "未知" && /Safari/.test(ua)) browser = "Safari";
  if (/iPhone|iPad|iPod/.test(ua)) os = "iOS";
  else if (/Android/.test(ua)) os = "Android";
  else if (/Windows NT 10/.test(ua)) os = "Windows 10/11";
  else if (/Windows NT 6.3/.test(ua)) os = "Windows 8.1";
  else if (/Windows NT 6.1/.test(ua)) os = "Windows 7";
  else if (/Mac OS X/.test(ua)) os = "macOS";
  else if (/Linux/.test(ua)) os = "Linux";
  if (/Tablet|iPad/.test(ua)) device = "平板";
  else if (/Mobile|iPhone|iPod/.test(ua)) device = "移动设备";
  return `浏览器：${browser}\n操作系统：${os}\n设备类型：${device}\n\n原始UA：\n${ua}`;
}
