import { expect, test, type Page } from "@playwright/test";

import { loginViaApi } from "./helpers/auth";

// Regression: in embed mode (the only mode upstream supports) opening the
// first episode registered the movie's single history row, after which no
// other episode ever updated it — so "Xem tiếp" kept pointing at episode 1
// no matter how far the viewer had moved on.
//
// This drives the real WatchView embed path through the dev-only /e2e/embed
// harness (no external network): open ep1 -> client-side switch to ep2 ->
// the history link must follow ep2.
const progressPut = (page: Page) =>
  page.waitForResponse(
    (r) =>
      r.url().includes("/api/v1/me/progress") &&
      r.request().method() === "PUT",
    { timeout: 20_000 },
  );

test("embed mode: history follows the last opened episode", async ({ page }) => {
  await loginViaApi(page);
  const slug = `e2e-embed-${Date.now().toString(36)}`;
  const movieName = `E2E Embed ${slug}`;

  // Ep1 registration must land first: the bug only bites once a row exists.
  const ep1Saved = progressPut(page);
  await page.goto(`/e2e/embed?slug=${slug}&episode=tap-1`);
  await expect(
    page.getByRole("button", { name: /đánh dấu đã xem/i }),
  ).toBeVisible();
  await ep1Saved;

  // Same-route client-side switch, exactly like the real episode navigation.
  const ep2Saved = progressPut(page);
  await page.getByTestId("e2e-go-tap-2").click();
  await expect(page).toHaveURL(/episode=tap-2/);
  await ep2Saved;

  // The user-visible symptom: the history card must continue at ep2.
  await page.goto("/me/history");
  const nameLink = page.getByRole("link", { name: movieName, exact: true });
  await expect(nameLink).toBeVisible();
  const card = nameLink.locator(
    "xpath=ancestor::div[contains(@class,'rounded-xl')]",
  );
  await expect(card.getByRole("link", { name: /xem tiếp/i })).toHaveAttribute(
    "href",
    `/xem/${slug}/tap-2`,
  );

  // ...and it must show the series position, not just the episode name.
  await expect(card.getByText(/tập 2\/3/)).toBeVisible();

  // Cleanup (best effort) so the shared history page stays tidy.
  await page
    .getByRole("button", { name: `Xóa lịch sử ${movieName}` })
    .click()
    .catch(() => {});
});
