import type { MetadataRoute } from "next";

function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
  ).replace(/\/$/, "");
}

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // /api/* là JSON nội bộ, /me/* cần đăng nhập, /xem/* là player nhúng
        // nội dung mỏng — không tốn crawl budget cho 3 nhóm này.
        disallow: ["/api/", "/me/", "/xem/"],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
