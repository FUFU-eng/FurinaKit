/** Exact decimal rounding to cents, with carry before Chinese amount formatting. */
export function moneyParts(input: string): { intPart: number; decPart: number; negative: boolean } {
  const text = input.trim();
  if (text.length > 2048) throw new Error("金额输入过长");
  const m = /^([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:e([+-]?\d+))?$/i.exec(text);
  if (!m) throw new Error("无效的金额，请输入十进制数字");
  const exponent = Number(m[5] || 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 1000) throw new Error("金额指数超出范围");
  const fraction = m[3] ?? m[4] ?? "";
  const digits = BigInt((m[2] || "0") + fraction);
  const shift = exponent - fraction.length + 2;
  let cents: bigint;
  if (shift >= 0) cents = digits * 10n ** BigInt(shift);
  else {
    const divisor = 10n ** BigInt(-shift);
    cents = digits / divisor + (digits % divisor * 2n >= divisor ? 1n : 0n);
  }
  if (cents >= 100000000000000n) throw new Error("金额过大");
  return { intPart: Number(cents / 100n), decPart: Number(cents % 100n), negative: m[1] === "-" && cents !== 0n };
}

/** Validate every digit, never accept parseInt's valid-prefix truncation. */
export function baseInteger(input: string, radix: number): bigint {
  if (![2, 8, 10, 16].includes(radix)) throw new Error("不支持的进制");
  let value = input.trim();
  if (value.length > 4096) throw new Error("数值输入过长");
  let sign = 1n;
  if (value[0] === "-" || value[0] === "+") {
    if (value[0] === "-") sign = -1n;
    value = value.slice(1);
  }
  const prefix = radix === 16 ? "0x" : radix === 8 ? "0o" : radix === 2 ? "0b" : "";
  if (prefix && value.toLowerCase().startsWith(prefix)) value = value.slice(2);
  if (!value) throw new Error("无效的数值");
  let result = 0n;
  for (const char of value.toLowerCase()) {
    const digit = "0123456789abcdef".indexOf(char);
    if (digit < 0 || digit >= radix) throw new Error(`无效的数值：包含非 ${radix} 进制字符`);
    result = result * BigInt(radix) + BigInt(digit);
  }
  return sign * result;
}
