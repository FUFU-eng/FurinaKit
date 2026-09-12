import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output is only needed for the Docker image (set in the Dockerfile).
  // It requires symlink permissions that fail on Windows, and Vercel doesn't need it.
  output: process.env.NEXT_OUTPUT_STANDALONE === "1" ? "standalone" : undefined,
  // 供并行开发/自动化验证用：设了 FK_DIST_DIR 就把构建产物写到别的目录，
  // 这样另起的 dev/build 进程不会覆盖正在运行的那份 .next。默认不变，仍是 .next。
  distDir: process.env.FK_DIST_DIR || ".next",
  transpilePackages: ["@furinakit/shared"],
  outputFileTracingRoot: path.join(__dirname, "../../"),
  // pdfjs-dist is loaded at runtime (text extraction) — keep it out of the bundle.
  serverExternalPackages: ["pdfjs-dist", "sharp"],
  devIndicators: false,
  experimental: {
    serverActions: {
      bodySizeLimit: "25mb",
    },
  },
};

export default nextConfig;
