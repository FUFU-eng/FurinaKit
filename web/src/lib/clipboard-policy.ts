/** Blank input is not the same thing as explicitly choosing permanent retention. */
export function retentionDays(value: string): number {
  const raw = value.trim();
  if (!/^\d+$/.test(raw))
    throw new Error("请输入 0 至 36500 的整数天数；0 表示永久");
  const days = Number(raw);
  if (!Number.isSafeInteger(days) || days > 36500)
    throw new Error("请输入 0 至 36500 的整数天数；0 表示永久");
  return days;
}
