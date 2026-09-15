import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "phim.nguonc.com", pathname: "/**" },
    ],
  },
  async redirects() {
    return [
      {
        source: "/search",
        destination: "/tim-kiem",
        permanent: false,
      },
    ];
  },
  // NOTE: /api/v1/* is proxied by the app/api/v1/[...path] Route Handler
  // (runtime, per request). Do NOT add a rewrites() rule for it: rewrite
  // destinations are baked at BUILD time and would shadow the handler.
};

export default nextConfig;
