import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output is only needed for the Docker image (set in the Dockerfile).
  // It requires symlink permissions that fail on Windows, and Vercel doesn't need it.
  output: process.env.NEXT_OUTPUT_STANDALONE === "1" ? "standalone" : undefined,
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
