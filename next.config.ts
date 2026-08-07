import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Fully client-side app — static export deploys straight to Cloudflare Pages
  // (build output: out/).
  output: "export",
};

export default nextConfig;
