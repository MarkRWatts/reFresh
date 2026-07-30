import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [{ protocol: "https", hostname: "img.hellofresh.com" }],
  },
  devIndicators: false,
};

export default nextConfig;
