export interface Point {
  x: number;
  y: number;
}
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}
export function canvasPoint(
  client: Point,
  rect: { left: number; top: number; width: number; height: number },
  width: number,
  height: number,
): Point {
  if (rect.width <= 0 || rect.height <= 0) throw new Error("图片尚未就绪");
  return {
    x: Math.max(
      0,
      Math.min(width, ((client.x - rect.left) * width) / rect.width),
    ),
    y: Math.max(
      0,
      Math.min(height, ((client.y - rect.top) * height) / rect.height),
    ),
  };
}
export function cropBetween(
  a: Point,
  b: Point,
  width: number,
  height: number,
): CropRect {
  const x = Math.max(0, Math.min(width, Math.round(Math.min(a.x, b.x)))),
    y = Math.max(0, Math.min(height, Math.round(Math.min(a.y, b.y))));
  const right = Math.max(x, Math.min(width, Math.round(Math.max(a.x, b.x)))),
    bottom = Math.max(y, Math.min(height, Math.round(Math.max(a.y, b.y))));
  return { x, y, width: right - x, height: bottom - y };
}
export function validCrop(rect: CropRect) {
  return rect.width >= 1 && rect.height >= 1;
}
