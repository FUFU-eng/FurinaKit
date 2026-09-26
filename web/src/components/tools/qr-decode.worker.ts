import jsQR from "jsqr";
self.onmessage = (
  event: MessageEvent<{ pixels: ArrayBuffer; width: number; height: number }>,
) => {
  const { pixels, width, height } = event.data;
  const data = new Uint8ClampedArray(pixels);
  const results: { text: string; points: { x: number; y: number }[] }[] = [];
  try {
    for (let i = 0; i < 12; i++) {
      const code = jsQR(data, width, height, {
        inversionAttempts: "attemptBoth",
      });
      if (!code) break;
      const l = code.location;
      const points = [
        l.topLeftCorner,
        l.topRightCorner,
        l.bottomRightCorner,
        l.bottomLeftCorner,
      ];
      results.push({ text: code.data, points });
      const x0 = Math.max(
          0,
          Math.floor(Math.min(...points.map((p) => p.x))) - 4,
        ),
        x1 = Math.min(
          width,
          Math.ceil(Math.max(...points.map((p) => p.x))) + 4,
        );
      const y0 = Math.max(
          0,
          Math.floor(Math.min(...points.map((p) => p.y))) - 4,
        ),
        y1 = Math.min(
          height,
          Math.ceil(Math.max(...points.map((p) => p.y))) + 4,
        );
      for (let y = y0; y < y1; y++)
        for (let x = x0; x < x1; x++) {
          const k = (y * width + x) * 4;
          data[k] = data[k + 1] = data[k + 2] = data[k + 3] = 255;
        }
    }
    self.postMessage({ results });
  } catch {
    self.postMessage({ error: "decode_failed" });
  }
};
