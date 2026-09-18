import { expect, test } from "@playwright/test";

import { api } from "./helpers/api";
import { skipIfNoUpstream } from "./helpers/net";

skipIfNoUpstream();

async function sampleSlug(): Promise<string> {
  const list = await api("/api/v1/movies/genre/hanh-dong?page=1");
  return list.items[0].slug;
}

test("movie detail exposes Open Graph, Twitter and Movie JSON-LD", async ({
  page,
}) => {
  const slug = await sampleSlug();
  await page.goto(`/phim/${slug}`);

  await expect(page.locator('meta[property="og:type"]')).toHaveAttribute(
    "content",
    "video.movie",
  );
  await expect(page.locator('meta[property="og:title"]')).toHaveAttribute(
    "content",
    /.+/,
  );
  await expect(page.locator('meta[property="og:url"]')).toHaveAttribute(
    "content",
    new RegExp(`/phim/${slug}$`),
  );
  const ogImage = await page
    .locator('meta[property="og:image"]')
    .getAttribute("content");
  expect(ogImage).toMatch(/^https?:\/\//);
  expect(ogImage).toContain(`/phim/${slug}/opengraph-image`);
  await expect(page.locator('meta[name="twitter:card"]')).toHaveAttribute(
    "content",
    "summary_large_image",
  );

  const blocks = await page
    .locator('script[type="application/ld+json"]')
    .allTextContents();
  const types = blocks.flatMap((raw) => {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return String(parsed["@type"]);
  });
  expect(types).toContain("WebSite");
  expect(types.some((type) => type === "Movie" || type === "TVSeries")).toBe(
    true,
  );
});

test("dynamic movie OG image returns a PNG", async ({ request }) => {
  const slug = await sampleSlug();
  const res = await request.get(`/phim/${slug}/opengraph-image`);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toContain("image/png");
  expect((await res.body()).length).toBeGreaterThan(1000);
});

test("robots keeps /xem out of the index and points at the sitemap", async ({
  request,
}) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Disallow: /xem/");
  expect(robots).toContain("Sitemap:");

  const sitemap = await (await request.get("/sitemap.xml")).text();
  expect(sitemap).toContain("<urlset");
  expect(sitemap).toContain("/phim/");
});
