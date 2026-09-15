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

test("search suggestions: arrows + enter + escape (a11y combobox)", async ({
  page,
}) => {
  await page.goto("/");
  const box = page.getByLabel(/tìm kiếm phim/i).first();
  await box.fill("mao");
  const listbox = page.getByRole("listbox", { name: /gợi ý phim/i });
  await expect(listbox).toBeVisible({ timeout: 20_000 });
  await expect(box).toHaveAttribute("aria-expanded", "true");

  // ArrowDown highlights options in order.
  await box.press("ArrowDown");
  const first = listbox.getByRole("option").first();
  await expect(first).toHaveAttribute("aria-selected", "true");
  await expect(box).toHaveAttribute("aria-activedescendant", /option-0$/);
  await box.press("ArrowDown");
  await expect(listbox.getByRole("option").nth(1)).toHaveAttribute(
    "aria-selected",
    "true",
  );

  // Enter opens the highlighted suggestion's detail page.
  await box.press("Enter");
  await expect(page).toHaveURL(/\/phim\//, { timeout: 20_000 });

  // Escape closes the dropdown without navigating.
  await page.goto("/");
  await page.getByLabel(/tìm kiếm phim/i).first().fill("mao");
  await expect(page.getByRole("listbox", { name: /gợi ý phim/i })).toBeVisible({
    timeout: 20_000,
  });
  await page.getByLabel(/tìm kiếm phim/i).first().press("Escape");
  await expect(
    page.getByRole("listbox", { name: /gợi ý phim/i }),
  ).toBeHidden();
  await expect(page).toHaveURL("/");
});
