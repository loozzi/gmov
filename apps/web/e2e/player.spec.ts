import { expect, test } from "@playwright/test";

import { loginViaApi } from "./helpers/auth";
import { skipIfNoMux } from "./helpers/net";

skipIfNoMux();

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
  // Best-effort: playback may already be running (autoPlay defaults on and
  // Playwright forces --autoplay-policy=no-user-gesture-required), in which
  // case the overlay button unmounts mid-click and the click never settles.
  // The assertions below check the real outcome, so a failed click is fine.
  await page
    .getByRole("button", { name: /^phát$/i })
    .first()
    .click({ timeout: 5_000 })
    .catch(() => {});
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
  // ...and the player clock must actually be there (±5s per spec, anchored at
  // the real playback position t1). The seek lands on the next media event
  // after the progress fetch resolves (measured ~100ms, longer on a cold
  // cache), so reading the clock once right after the toast races it: wait
  // for the FIRST non-trivial position instead. A correct resume jumps to
  // ~t1 immediately, while a broken one restarts at 0 and only reaches 2s
  // after ~2s of real playback — which the ±5s bound below rejects.
  const resumed = await page.waitForFunction(
    () => {
      const v = document.querySelector("video");
      if (!v || v.currentTime < 2) return null;
      return Number(v.currentTime.toFixed(2));
    },
    undefined,
    { timeout: 30_000, polling: 50 },
  );
  const t2: number = (await resumed.jsonValue()) as number;
  expect(
    t2,
    `expected resume around ${t1.toFixed(1)}s (±5s) after reload, got ${t2}`,
  ).toBeGreaterThanOrEqual(t1 - 5);
  expect(
    t2,
    `expected resume around ${t1.toFixed(1)}s (±5s) after reload, got ${t2}`,
  ).toBeLessThanOrEqual(t1 + 5);
});
