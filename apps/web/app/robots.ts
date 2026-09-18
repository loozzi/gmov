import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/seo";

// Rendered per request: `SITE_URL` is runtime-only, so prerendering at build
// would bake the fallback (localhost) into the served file.
export const dynamic = "force-dynamic";

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
