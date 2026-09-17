import { expect, test, type Page } from "@playwright/test";

import { api } from "./helpers/api";
import { skipIfNoUpstream } from "./helpers/net";

skipIfNoUpstream();

const GENRE = "/the-loai/hanh-dong";

/** Movie cards are the only links pointing at a detail page. */
function cards(page: Page) {
  return page.locator('a[href^="/phim/"]');
}

test("browse page appends more films on scroll", async ({ page }) => {
  await page.goto(GENRE);
  await expect(cards(page).first()).toBeVisible({ timeout: 30_000 });
  const initial = await cards(page).count();
  expect(initial).toBeGreaterThan(0);

  // The sentinel prefetches within 600px, so scroll until a new page lands.
  for (let i = 0; i < 10 && (await cards(page).count()) === initial; i++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(600);
  }

  expect(await cards(page).count()).toBeGreaterThan(initial);
});

test("quick switch jumps to another genre", async ({ page }) => {
  await page.goto(GENRE);
  const nav = page.getByRole("navigation", { name: "Chuyển nhanh thể loại" });
  await expect(nav).toBeVisible({ timeout: 30_000 });
  await expect(nav.getByRole("link", { name: "Hành Động" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  await nav.getByRole("link", { name: "Hài", exact: true }).click();
  await expect(page).toHaveURL(/\/the-loai\/phim-hai$/);
  await expect(
    page.getByRole("heading", { name: /thể loại: hài/i }),
  ).toBeVisible();
});

test("?page=2 starts at page 2 and keeps a crawler link", async ({ page }) => {
  const first = await api(`/api/v1/movies/genre/hanh-dong?page=1`);
  const second = await api(`/api/v1/movies/genre/hanh-dong?page=2`);
  expect(second.items[0].slug).not.toBe(first.items[0].slug);

  await page.goto(`${GENRE}?page=2`);
  // The grid starts at page 2, not at page 1.
  await expect(cards(page).first()).toHaveAttribute(
    "href",
    `/phim/${second.items[0].slug}`,
  );

  // The fallback anchor stays a real link for no-JS users and crawlers, and
  // points one page beyond what is loaded (the sentinel may have prefetched).
  const more = page.getByRole("link", { name: "Xem thêm" });
  await expect(more).toBeVisible();
  const href = (await more.getAttribute("href")) ?? "";
  expect(
    Number(new URL(href, "http://localhost").searchParams.get("page")),
  ).toBeGreaterThanOrEqual(3);
});

test("country and year pages have their own quick switch", async ({ page }) => {
  await page.goto("/quoc-gia/han-quoc");
  await expect(
    page.getByRole("navigation", { name: "Chuyển nhanh quốc gia" }),
  ).toBeVisible({ timeout: 30_000 });

  await page.goto("/nam/2024");
  await expect(
    page.getByRole("navigation", { name: "Chuyển nhanh năm" }),
  ).toBeVisible({ timeout: 30_000 });
});

test("search without a keyword prompts instead of listing", async ({
  page,
}) => {
  await page.goto("/tim-kiem");
  await expect(
    page.getByText(/nhập từ khóa vào ô tìm kiếm phía trên/i),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Xem thêm" })).toHaveCount(0);
  await expect(
    page.getByRole("navigation", { name: /chuyển nhanh/i }),
  ).toHaveCount(0);
});
