import { expect, test } from "@playwright/test";

import { loginViaApi } from "./helpers/auth";

// THE key test: play for real 20s -> reload -> the player must resume at
// ~20s (±5s). This runs against the genuine HLS path (VideoPlayer + heartbeat
// + reload + seek) with a public sample stream, because upstream episodes
// only carry embed URLs (Batch 1 verdict) and an iframe exposes no clock.
//
// Each run uses a unique movie slug so no stale progress can pollute it.
test.setTimeout(240_000);

const currentTime = () =>
  document.querySelector("video")?.currentTime ?? -1;

test("play 20s -> reload -> resumes around 20s", async ({ page }) => {
  await loginViaApi(page);
  const slug = `e2e-resume-${Date.now().toString(36)}`;
  await page.goto(`/e2e/player?slug=${slug}`);

  const video = page.locator("video");
  await expect(video).toBeVisible({ timeout: 30_000 });

  // Real user gesture to start playback (the big center overlay button).
  await page.getByRole("button", { name: /^phát$/i }).first().click();
  await page.waitForFunction(
    () => {
      const v = document.querySelector("video");
      return !!v && !v.paused && v.currentTime > 1;
    },
    { timeout: 30_000 },
  );

  // Wait for 20s of GENUINE media playback. (Wall clock may be longer:
  // headless software decoding runs slower than realtime. What matters is
  // 20s of content actually watched, heartbeats persisted, then reload.)
  await page.waitForFunction(
    () => {
      const v = document.querySelector("video");
      return !!v && v.currentTime >= 20;
    },
    { timeout: 150_000 },
  );
  const t1: number = await page.evaluate(currentTime);
  // Prove genuine playback happened (not a stalled frame).
  expect(t1, `expected >=20s of real playback, got ${t1}`).toBeGreaterThanOrEqual(
    20,
  );

  await page.reload();
  // Resume intent must be announced...
  await expect(page.getByText(/đã tiếp tục từ/i)).toBeVisible({
    timeout: 30_000,
  });
  // ...and the player clock must actually be there (±5s per spec,
  // anchored at the real playback position t1).
  const t2: number = await page.evaluate(currentTime);
  expect(
    t2,
    `expected resume around ${t1.toFixed(1)}s (±5s) after reload, got ${t2}`,
  ).toBeGreaterThanOrEqual(t1 - 5);
  expect(
    t2,
    `expected resume around ${t1.toFixed(1)}s (±5s) after reload, got ${t2}`,
  ).toBeLessThanOrEqual(t1 + 5);
});
