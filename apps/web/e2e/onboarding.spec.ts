import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

import {
  LAST_USER_FILE,
  authHeaders,
  createProfile,
  listProfiles,
  loginUser,
  rawApi,
  resetProfiles,
  switchProfile,
  type TestAccount,
} from "./helpers/api";
import { loginViaApi } from "./helpers/auth";
import { skipIfNoUpstream } from "./helpers/net";

// These specs MUST NOT register accounts (register is throttled 3/hour/IP).
// They run on the shared base account and prove profile isolation with
// profiles created/deleted inside each test. Onboarding shows real posters and
// the engine ranks the upstream catalog snapshot, so the file needs upstream
// access (and a non-empty catalog) — otherwise it skips visibly.
skipIfNoUpstream();

test.setTimeout(150_000);

const PERSONAL_RAIL = "Gợi ý cho bạn";
const STEP1_HEADING = "Gu của bạn là gì?";

const stamp = () => Date.now().toString(36).slice(-6);

async function loadAccount(): Promise<TestAccount> {
  return JSON.parse(await readFile(LAST_USER_FILE, "utf8")) as TestAccount;
}

async function accountToken(account: TestAccount): Promise<string> {
  return (await loginUser(account)).access_token;
}

/** Switch the browser session to `id` through the "Ai đang xem?" page. */
async function switchViaUi(page: Page, id: string): Promise<void> {
  await page.goto("/profiles");
  const card = page.getByTestId(`profile-card-${id}`);
  await expect(card).toBeVisible();
  await card.click();
  await expect(card).toHaveAttribute("aria-label", /đang xem/);
}

/** Best-effort: return the shared browser session to the default profile. */
async function leaveOnDefault(page: Page, account: TestAccount): Promise<void> {
  const token = await accountToken(account);
  const def = (await listProfiles(token)).items.find((p) => p.is_default);
  if (!def) return;
  await page.goto("/profiles");
  const card = page.getByTestId(`profile-card-${def.id}`);
  await expect(card).toBeVisible({ timeout: 15_000 });
  const label = await card.getAttribute("aria-label");
  if (!label?.includes("đang xem")) {
    await card.click();
    await expect(card).toHaveAttribute("aria-label", /đang xem/);
  }
}

/** Reset explicit weights and delete the profiles a test created. */
async function cleanup(
  account: TestAccount,
  profiles: { id: string; token: string }[],
): Promise<void> {
  for (const { token } of profiles) {
    if (!token) continue;
    try {
      await rawApi("/api/v1/me/preferences", {
        method: "DELETE",
        headers: authHeaders(token),
      });
    } catch (e) {
      console.log(
        `[onboarding] preference reset skipped: ${String(e).slice(0, 140)}`,
      );
    }
  }
  try {
    await resetProfiles(account);
  } catch (e) {
    console.log(`[onboarding] profile reset skipped: ${String(e).slice(0, 140)}`);
  }
}

/** Step 1: pick one genre and advance to the poster step. */
async function pickGenre(page: Page, genre: string): Promise<void> {
  await expect(
    page.getByRole("heading", { name: STEP1_HEADING }),
  ).toBeVisible({ timeout: 20_000 });
  await page.getByTestId(`onboarding-genre-${genre}`).click();
  await page.getByTestId("onboarding-next").click();
}

/** Step 2: like the first available poster and advance to the summary. */
async function likeAPoster(page: Page): Promise<void> {
  const like = page
    .locator('[data-testid^="onboarding-poster-like-"]')
    .first();
  await expect(like).toBeVisible({ timeout: 30_000 });
  await like.click();
  await page.getByTestId("onboarding-next").click();
}

/** Step 2 (no likes): advance straight to the summary. */
async function skipPosters(page: Page): Promise<void> {
  // The hint only exists on the poster step, so this also confirms step 2.
  await expect(
    page.getByText(/Thích hoặc bỏ qua vài poster/i),
  ).toBeVisible({ timeout: 30_000 });
  await page.getByTestId("onboarding-next").click();
}

async function finishOnboarding(page: Page): Promise<void> {
  const finish = page.getByTestId("onboarding-finish");
  await expect(finish).toBeVisible({ timeout: 20_000 });
  await finish.click();
  await page.waitForURL((url) => url.pathname === "/");
}

/** Full happy path from a fresh profile sitting on step 1. */
async function completeOnboarding(page: Page, genre: string): Promise<void> {
  await pickGenre(page, genre);
  await likeAPoster(page);
  await finishOnboarding(page);
}

function personalRail(page: Page) {
  return page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: PERSONAL_RAIL }) });
}

async function expectPersonalRail(page: Page): Promise<void> {
  const rail = personalRail(page);
  await expect(rail).toBeVisible({ timeout: 30_000 });
  await expect(rail.locator('a[href^="/phim/"]').first()).toBeVisible({
    timeout: 20_000,
  });
}

test("a new profile onboards and gets a personal rail", async ({ page }) => {
  const account = await loadAccount();
  const token = await accountToken(account);
  await resetProfiles(account);
  const profile = await createProfile(token, `Gu ${stamp()}`, "star");
  const switched = await switchProfile(token, profile.id);
  const profileToken = switched.access_token as string;

  try {
    await loginViaApi(page);
    await switchViaUi(page, profile.id);

    await page.goto("/onboarding");
    await completeOnboarding(page, "hanh-dong");

    await expectPersonalRail(page);
  } finally {
    await leaveOnDefault(page, account).catch(() => undefined);
    await cleanup(account, [{ id: profile.id, token: profileToken }]);
  }
});

test("skipping onboarding hides the personal rail and does not trap", async ({
  page,
}) => {
  const account = await loadAccount();
  const token = await accountToken(account);
  await resetProfiles(account);
  const profile = await createProfile(token, `Skip ${stamp()}`, "cat");
  const profileToken = (await switchProfile(token, profile.id)).access_token ?? "";

  try {
    await loginViaApi(page);
    await switchViaUi(page, profile.id);

    await page.goto("/onboarding");
    await expect(
      page.getByRole("heading", { name: STEP1_HEADING }),
    ).toBeVisible({ timeout: 20_000 });

    const response = page.waitForResponse(
      (res) =>
        res.url().includes("/api/v1/me/recommendations") &&
        res.status() === 200,
      { timeout: 30_000 },
    );
    await page.getByTestId("onboarding-skip").click();
    await page.waitForURL((url) => url.pathname === "/");
    await response;

    // Skip means no taste: the rail falls back to popular/newest (or hides),
    // never the personal "Gợi ý cho bạn" heading.
    await expect(page.getByRole("heading", { name: PERSONAL_RAIL })).toHaveCount(
      0,
    );

    // Revisiting is not a trap: the guard bounces a finished/skipped profile home.
    await page.goto("/onboarding");
    await page.waitForURL((url) => url.pathname === "/", { timeout: 20_000 });
    await expect(
      page.getByRole("heading", { name: STEP1_HEADING }),
    ).toHaveCount(0);
  } finally {
    await leaveOnDefault(page, account).catch(() => undefined);
    await cleanup(account, [{ id: profile.id, token: profileToken }]);
  }
});

test("redo preferences reopens onboarding and the rail comes back", async ({
  page,
}) => {
  const account = await loadAccount();
  const token = await accountToken(account);
  await resetProfiles(account);
  const profile = await createProfile(token, `Redo ${stamp()}`, "dino");
  const switched = await switchProfile(token, profile.id);
  const profileToken = switched.access_token as string;

  try {
    await loginViaApi(page);
    await switchViaUi(page, profile.id);

    await page.goto("/onboarding");
    await completeOnboarding(page, "hanh-dong");
    await expectPersonalRail(page);

    await page.goto("/profiles/manage");
    const row = page.getByTestId(`profile-row-${profile.id}`);
    await expect(row).toBeVisible();
    page.once("dialog", (dialog) => void dialog.accept());
    await row
      .getByRole("button", { name: `Làm lại sở thích ${profile.name}` })
      .click();

    await page.waitForURL(
      (url) => url.pathname === "/onboarding" && url.searchParams.get("again") === "1",
      { timeout: 20_000 },
    );
    // Finish the redo on the SAME ?again=1 entry (no guard bounce).
    await pickGenre(page, "hoat-hinh");
    await likeAPoster(page);
    await finishOnboarding(page);
    await expectPersonalRail(page);
  } finally {
    await leaveOnDefault(page, account).catch(() => undefined);
    await cleanup(account, [{ id: profile.id, token: profileToken }]);
  }
});

test("each profile keeps its own personal rail across switches", async ({
  page,
}) => {
  const account = await loadAccount();
  const token = await accountToken(account);
  await resetProfiles(account);
  const first = await createProfile(token, `A ${stamp()}`, "rocket");
  const second = await createProfile(token, `B ${stamp()}`, "panda");
  const firstToken = (await switchProfile(token, first.id)).access_token ?? "";
  const secondToken = (await switchProfile(token, second.id)).access_token ?? "";

  try {
    await loginViaApi(page);
    await switchViaUi(page, first.id);
    await page.goto("/onboarding");
    await completeOnboarding(page, "hanh-dong");
    await expectPersonalRail(page);

    // Onboard a second profile with a different taste.
    await switchViaUi(page, second.id);
    await page.goto("/onboarding");
    await pickGenre(page, "hoat-hinh");
    await skipPosters(page);
    await finishOnboarding(page);
    await expectPersonalRail(page);

    // Back to the first profile: its rail still renders from its own cache/scope.
    // No content-equality assertion on purpose (cache TTL makes ordering noisy).
    await switchViaUi(page, first.id);
    await page.goto("/");
    await expectPersonalRail(page);
  } finally {
    await leaveOnDefault(page, account).catch(() => undefined);
    await cleanup(account, [
      { id: first.id, token: firstToken },
      { id: second.id, token: secondToken },
    ]);
  }
});
