/** Media parameter boundaries shared by submission and component validation. */
export function frameTimeIssue(time: number | null, duration: number): string | null {
  if (time === null || !Number.isFinite(time) || time < 0) {
    return "取帧时间看不懂，可以写 5、00:05 或 00:00:05.5。";
  }
  if (Number.isFinite(duration) && duration > 0 && time >= duration) {
    return "取帧时间必须小于视频总长，请将播放位置向前移动一点。";
  }
  return null;
}

export function frameWidthIssue(raw: string): string | null {
  if (!raw.trim()) return null;
  const width = Number(raw);
  return Number.isSafeInteger(width) && width >= 16 && width <= 7680
    ? null : "宽度请填 16 – 7680 之间的整数（留空表示保持原始尺寸）。";
}

// Do not round a visible final frame forward to the end-of-file timestamp.
export function currentFrameTime(time: number, duration: number): string | null {
  if (!Number.isFinite(duration) || duration <= 0 || frameTimeIssue(time, duration)) return null;
  return String(Math.floor(time * 1000) / 1000);
}

export function videoRegionIssue(
  values: Record<string, string>,
  dimensions?: { w: number; h: number } | null,
): string | null {
  const x = Number(values.rectX ?? 0), y = Number(values.rectY ?? 0);
  const w = Number(values.rectW), h = Number(values.rectH);
  if (![x, y, w, h].every(Number.isSafeInteger) || x < 0 || y < 0 || w <= 0 || h <= 0) {
    return "自定义区域必须使用整数像素：左边距/上边距不能小于 0，宽度/高度必须大于 0。";
  }
  if (dimensions && (x >= dimensions.w || y >= dimensions.h || w > dimensions.w - x || h > dimensions.h - y)) {
    return `自定义区域超出了画面（视频 ${dimensions.w}×${dimensions.h}）。请缩小区域或调整位置。`;
  }
  return null;
}
