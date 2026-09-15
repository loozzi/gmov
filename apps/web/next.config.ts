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
};

export default nextConfig;
