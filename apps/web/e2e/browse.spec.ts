import { expect, test } from "@playwright/test";

test("home -> movie detail loads full info", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: /mới cập nhật/i }),
  ).toBeVisible();
  const firstCard = page.locator('a[href^="/phim/"]').first();
  const slug = (await firstCard.getAttribute("href"))?.split("/phim/")[1];
  expect(slug, "expected at least one movie card").toBeTruthy();
  await firstCard.click();
  await expect(page).toHaveURL(new RegExp(`/phim/${slug}`));
  // Detail essentials.
  await expect(page.getByText(/danh sách tập/i)).toBeVisible();
  const episodeButtons = page.locator('a[href^="/xem/"]');
  expect(await episodeButtons.count()).toBeGreaterThan(0);
});

test("search -> results -> openable", async ({ page }) => {
  await page.goto("/");
  const box = page.getByLabel(/tìm kiếm phim/i).first();
  await box.fill("mao");
  // Quick suggestions (debounced) then the full results page.
  await expect(page.getByText(/xem tất cả kết quả/i)).toBeVisible({
    timeout: 20_000,
  });
  await page.getByText(/xem tất cả kết quả/i).click();
  await expect(page).toHaveURL(/\/tim-kiem\?keyword=mao/);
  const firstResult = page.locator('a[href^="/phim/"]').first();
  await expect(firstResult).toBeVisible({ timeout: 20_000 });
  await firstResult.click();
  await expect(page).toHaveURL(/\/phim\//);
});
