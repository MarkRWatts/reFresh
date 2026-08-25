import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "img.hellofresh.com" },
      // Google account profile pictures (User.image, set by Better Auth on
      // Google sign-in) — see the header avatar in src/app/layout.tsx.
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
    ],
  },
  devIndicators: false,
  experimental: {
    // Server Actions default to a 1MB request body limit — scanned recipe
    // card PDFs (src/lib/pdfImport) routinely run 7-10MB+, and uploading
    // several at once (the import page accepts a multi-file batch) or a
    // large cover-photo replacement (recipeEditActions.ts) adds up fast, so
    // this is set well above what a single normal upload needs.
    serverActions: { bodySizeLimit: "100mb" },
  },
  // These ship native binaries (@napi-rs/canvas, sharp) or dynamically load
  // worker/wasm files at runtime (pdfjs-dist, tesseract.js) — bundling them
  // confuses Turbopack's build trace, so they're loaded via plain require()
  // from node_modules at runtime instead. See src/lib/pdfImport/.
  serverExternalPackages: ["@napi-rs/canvas", "sharp", "pdfjs-dist", "tesseract.js"],
};

export default nextConfig;
