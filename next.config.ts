import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "img.hellofresh.com" }],
  },
  devIndicators: false,
  // These ship native binaries (@napi-rs/canvas, sharp) or dynamically load
  // worker/wasm files at runtime (pdfjs-dist, tesseract.js) — bundling them
  // confuses Turbopack's build trace, so they're loaded via plain require()
  // from node_modules at runtime instead. See src/lib/pdfImport/.
  serverExternalPackages: ["@napi-rs/canvas", "sharp", "pdfjs-dist", "tesseract.js"],
};

export default nextConfig;
