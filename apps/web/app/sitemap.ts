import type { MetadataRoute } from "next";

import { siteUrl } from "@/lib/seo";
import { fetchLatest } from "@/lib/server-movies";

export const revalidate = 21600; // 6h: sitemap regen chậm, upstream mới vẫn index được

const MAX_PAGES = 100; // 100 trang x 10 phim = ~1000 URL
const CONCURRENCY = 5;

async function collectSlugs(): Promise<string[]> {
  const seen = new Set<string>();
  for (let start = 1; start <= MAX_PAGES; start += CONCURRENCY) {
    const batch = await Promise.all(
      Array.from({ length: CONCURRENCY }, (_, i) =>
        fetchLatest(start + i).catch(() => null),
      ),
    );
    let empty = true;
    for (const page of batch) {
      if (!page || page.items.length === 0) continue;
      empty = false;
      for (const m of page.items) seen.add(m.slug);
    }
    if (empty) break; // upstream hết hoặc lỗi toàn batch -> dừng sớm
  }
  return [...seen];
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const staticRoutes: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: "daily", priority: 1 },
    { url: `${base}/tim-kiem`, changeFrequency: "monthly", priority: 0.3 },
    { url: `${base}/list/phim-le`, changeFrequency: "daily", priority: 0.7 },
    { url: `${base}/list/phim-bo`, changeFrequency: "daily", priority: 0.7 },
  ];
  const slugs = await collectSlugs().catch(() => [] as string[]);
  const movieRoutes: MetadataRoute.Sitemap = slugs.map((slug, i) => ({
    url: `${base}/phim/${slug}`,
    // Phim mới (đầu danh sách) ưu tiên cao hơn, giảm dần tới 0.5.
    priority: Math.max(0.5, 0.9 - (i / Math.max(slugs.length, 1)) * 0.4),
    changeFrequency: "weekly" as const,
  }));
  return [...staticRoutes, ...movieRoutes];
}
