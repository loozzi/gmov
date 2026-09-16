import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { LAST_USER_FILE, api, authHeaders, loginUser } from "./helpers/api";
import { loginViaApi } from "./helpers/auth";
import { skipIfNoUpstream } from "./helpers/net";

skipIfNoUpstream();

async function accessToken(): Promise<string> {
  const account = JSON.parse(await readFile(LAST_USER_FILE, "utf8"));
  const { access_token } = await loginUser(account);
  return access_token;
}

async function firstMovieSlug(page: Page) {
  await page.goto("/tim-kiem?keyword=mao");
  const first = page.locator('a[href^="/phim/"]').first();
  await expect(first).toBeVisible({ timeout: 20_000 });
  const slug = (await first.getAttribute("href"))?.split("/phim/")[1];
  expect(slug).toBeTruthy();
  return slug as string;
}

test("favorite add/remove survives reload", async ({ page }) => {
  await loginViaApi(page);
  const slug = await firstMovieSlug(page);
  await page.goto(`/phim/${slug}`);

  const favButton = page.getByRole("button", { name: /^yêu thích$/i });
  await expect(favButton).toBeVisible({ timeout: 20_000 });
  await favButton.click();
  await expect(page.getByText(/đã thêm vào yêu thích/i)).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole("button", { name: /đã yêu thích/i }),
  ).toBeVisible({ timeout: 20_000 });

  // Remove via the detail button, confirm empty state after reload.
  await page.getByRole("button", { name: /đã yêu thích/i }).click();
  await expect(page.getByText(/đã bỏ khỏi yêu thích/i)).toBeVisible();
  await page.goto("/me/favorites");
  await expect(page.getByText(/bạn chưa lưu phim nào/i)).toBeVisible({
    timeout: 20_000,
  });
});

test("continue-watching shows the seeded film", async ({ page }) => {
  await loginViaApi(page);
  const slug = await firstMovieSlug(page);
  const token = await accessToken();
  await api(`/api/v1/me/progress`, {
    method: "PUT",
    headers: authHeaders(token),
    body: JSON.stringify({
      movie_slug: slug,
      movie_name: "E2E Seeded Film",
      poster_url: null,
      episode_slug: "tap-1",
      episode_name: "Tập 1",
      server_name: "E2E",
      position_seconds: 123,
      duration_seconds: 1200,
    }),
  });

  await page.goto("/");
  const rail = page.getByRole("heading", { name: /^xem tiếp$/i });
  await expect(rail).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("E2E Seeded Film").first()).toBeVisible();
});

test("watchlist add survives reload, watching drops it", async ({ page }) => {
  await loginViaApi(page);
  const slug = await firstMovieSlug(page);
  await page.goto(`/phim/${slug}`);

  const wlButton = page.getByRole("button", { name: /^muốn xem$/i });
  await expect(wlButton).toBeVisible({ timeout: 20_000 });
  await wlButton.click();
  await expect(page.getByText(/đã thêm vào danh sách muốn xem/i)).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: /đã lưu/i })).toBeVisible({
    timeout: 20_000,
  });

  // Starting to watch removes it from the watchlist (server-side).
  const token = await accessToken();
  await api(`/api/v1/me/progress`, {
    method: "PUT",
    headers: authHeaders(token),
    body: JSON.stringify({
      movie_slug: slug,
      movie_name: "E2E Seeded Film",
      poster_url: null,
      episode_slug: "tap-1",
      episode_name: "Tập 1",
      server_name: "E2E",
      position_seconds: 123,
      duration_seconds: 1200,
    }),
  });

  await page.goto("/me/watchlist");
  await expect(page.getByText(/danh sách trống/i)).toBeVisible({
    timeout: 20_000,
  });
});

test("rating + comment flow", async ({ page }) => {
  await loginViaApi(page);
  const slug = await firstMovieSlug(page);
  await page.goto(`/phim/${slug}`);
  page.on("dialog", (dialog) => void dialog.accept());

  const star4 = page.getByRole("radio", { name: /4 sao/i });
  await expect(star4).toBeVisible({ timeout: 20_000 });
  await star4.click();
  await expect(page.getByText(/đã đánh giá 4 sao/i)).toBeVisible();
  await expect(page.getByText(/1 lượt đánh giá/i)).toBeVisible({
    timeout: 20_000,
  });

  const stamp = Date.now();
  const commentBody = `E2E binh luan ${stamp}`;
  const replyBody = `E2E tra loi ${stamp}`;
  await expect(
    page.getByPlaceholder(/chia sẻ cảm nhận/i),
  ).toBeVisible({ timeout: 20_000 });
  await page.getByPlaceholder(/chia sẻ cảm nhận/i).fill(commentBody);
  await page.getByRole("button", { name: /gửi bình luận/i }).click();
  await expect(page.getByText(commentBody)).toBeVisible({ timeout: 20_000 });

  await page.getByRole("button", { name: /^trả lời$/i }).first().click();
  await expect(
    page.getByPlaceholder(/viết câu trả lời/i),
  ).toBeVisible({ timeout: 20_000 });
  await page.getByPlaceholder(/viết câu trả lời/i).fill(replyBody);
  await page.getByRole("button", { name: /gửi trả lời/i }).click();
  await expect(page.getByText(replyBody)).toBeVisible({ timeout: 20_000 });

  // Cleanup: delete reply, comment, then rating.
  await page.getByRole("button", { name: /xóa trả lời/i }).first().click();
  await expect(page.getByText(replyBody)).toBeHidden({ timeout: 20_000 });
  await page.getByRole("button", { name: /xóa bình luận/i }).first().click();
  await expect(page.getByText(commentBody)).toBeHidden({ timeout: 20_000 });

  await page.getByRole("button", { name: /gỡ đánh giá/i }).click();
  await expect(page.getByText(/chưa có đánh giá/i)).toBeVisible({
    timeout: 20_000,
  });
});
