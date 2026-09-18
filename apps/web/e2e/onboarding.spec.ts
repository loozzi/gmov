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
  sessionForProfile,
  switchProfile,
  type TestAccount,
} from "./helpers/api";
import { loginViaApi } from "./helpers/auth";
import { skipIfNoUpstream } from "./helpers/net";

// These specs MUST NOT register accounts (register is throttled 3/hour/IP).
// They run on the shared base account and prove profile isolation with
// profiles created/deleted inside each test. Onboarding shows real upstream
// posters and the engine ranks the local `catalog_items` snapshot, so the file
// skips visibly when EITHER (a) upstream is unreachable (`skipIfNoUpstream()`)
// OR (b) the snapshot is empty (authenticated probe in `beforeAll` below; seed
// it with `python -m app.cli refresh-catalog --pages 1`).
skipIfNoUpstream();

test.setTimeout(150_000);

const PERSONAL_RAIL = "Gợi ý cho bạn";
const STEP1_HEADING = "Gu của bạn là gì?";
const EMPTY_CATALOG_REASON =
  "catalog snapshot rỗng — chạy `python -m app.cli refresh-catalog`";

const stamp = () => Date.now().toString(36).slice(-6);

async function loadAccount(): Promise<TestAccount> {
  return JSON.parse(await readFile(LAST_USER_FILE, "utf8")) as TestAccount;
}

async function accountToken(account: TestAccount): Promise<string> {
  return (await loginUser(account)).access_token;
}

// The recommendation endpoint reads the local snapshot, so a successful call
// returning an empty `items` list means `catalog_items` has no rows. Probe once
// per file; each test then skips visibly instead of failing when it is empty.
let catalogReady = true;
test.beforeAll(async () => {
  const account = await loadAccount();
  const token = await accountToken(account);
  try {
    const res = await rawApi("/api/v1/me/recommendations?limit=50", {
      headers: authHeaders(token),
    });
    const body = (await res.json()) as { items: unknown[] };
    catalogReady = res.ok && Array.isArray(body.items) && body.items.length > 0;
  } catch {
    catalogReady = false;
  }
});

/** Switch the browser session to `profile` through the "Ai đang xem?" page.
 *  Picking a profile is required, so the chooser hands off to the home page —
 *  verify the switch by the profile chip in the header. */
async function switchViaUi(
  page: Page,
  profile: { id: string; name: string },
): Promise<void> {
  await page.goto("/profiles");
  const card = page.getByTestId(`profile-card-${profile.id}`);
  await expect(card).toBeVisible();
  await card.click();
  await page.waitForURL((url) => url.pathname === "/", { timeout: 20_000 });
  await expect(
    page.locator("header").getByRole("button", { name: /chọn profile/i }),
  ).toContainText(profile.name);
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
    await page.waitForURL((url) => url.pathname === "/", { timeout: 20_000 });
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
  // The control is a toggle: aria-pressed flips to "true" once the like lands.
  await expect(like).toHaveAttribute("aria-pressed", "true");
  // "Tiếp tục" submits the likes, so anchor on the POST before advancing.
  const posted = page.waitForResponse(
    (res) =>
      res.request().method() === "POST" &&
      res.url().includes("/api/v1/me/preferences/posters") &&
      res.ok(),
  );
  await page.getByTestId("onboarding-next").click();
  await posted;
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
  test.skip(!catalogReady, EMPTY_CATALOG_REASON);
  const account = await loadAccount();
  const token = await accountToken(account);
  await resetProfiles(account);
  let profileId = "";
  let profileToken = "";

  try {
    const profile = await createProfile(token, `Gu ${stamp()}`, "star");
    profileId = profile.id;
    profileToken = (await switchProfile(token, profile.id)).access_token ?? "";

    await loginViaApi(page);
    await switchViaUi(page, profile);

    await page.goto("/onboarding");
    await completeOnboarding(page, "hanh-dong");

    await expectPersonalRail(page);
  } finally {
    await leaveOnDefault(page, account).catch(() => undefined);
    await cleanup(account, [{ id: profileId, token: profileToken }]);
  }
});

test("skipping onboarding hides the personal rail and does not trap", async ({
  page,
}) => {
  test.skip(!catalogReady, EMPTY_CATALOG_REASON);
  const account = await loadAccount();
  const token = await accountToken(account);
  await resetProfiles(account);
  let profileId = "";
  let profileToken = "";

  try {
    const profile = await createProfile(token, `Skip ${stamp()}`, "cat");
    profileId = profile.id;
    profileToken = (await switchProfile(token, profile.id)).access_token ?? "";

    await loginViaApi(page);
    await switchViaUi(page, profile);

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

    // Anchor on the API's own classification before asserting the heading is
    // absent, so the check cannot pass before the response actually landed.
    const body = (await (await response).json()) as {
      items: unknown[];
      source: string;
    };
    expect(body.source).not.toBe("personal");

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
    await cleanup(account, [{ id: profileId, token: profileToken }]);
  }
});

test("redo preferences reopens onboarding and the rail comes back", async ({
  page,
}) => {
  test.skip(!catalogReady, EMPTY_CATALOG_REASON);
  const account = await loadAccount();
  const token = await accountToken(account);
  await resetProfiles(account);
  let profileId = "";
  let profileToken = "";

  try {
    const profile = await createProfile(token, `Redo ${stamp()}`, "dino");
    profileId = profile.id;
    profileToken = (await switchProfile(token, profile.id)).access_token ?? "";

    await loginViaApi(page);
    await switchViaUi(page, profile);

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
    await cleanup(account, [{ id: profileId, token: profileToken }]);
  }
});

test("each profile keeps its own personal rail across switches", async ({
  page,
}) => {
  test.skip(!catalogReady, EMPTY_CATALOG_REASON);
  const account = await loadAccount();
  const token = await accountToken(account);
  await resetProfiles(account);
  let firstId = "";
  let secondId = "";
  let firstToken = "";
  let secondToken = "";

  try {
    const first = await createProfile(token, `A ${stamp()}`, "rocket");
    firstId = first.id;
    const second = await createProfile(token, `B ${stamp()}`, "panda");
    secondId = second.id;
    firstToken = await sessionForProfile(account, first.id);
    secondToken = await sessionForProfile(account, second.id);

    await loginViaApi(page);
    await switchViaUi(page, first);
    await page.goto("/onboarding");
    await completeOnboarding(page, "hanh-dong");
    await expectPersonalRail(page);

    // Onboard a second profile with a different taste.
    await switchViaUi(page, second);
    await page.goto("/onboarding");
    await pickGenre(page, "hoat-hinh");
    await skipPosters(page);
    await finishOnboarding(page);
    await expectPersonalRail(page);

    // Back to the first profile: its rail still renders from its own cache/scope.
    // No content-equality assertion on purpose (cache TTL makes ordering noisy).
    await switchViaUi(page, first);
    await page.goto("/");
    await expectPersonalRail(page);
  } finally {
    await leaveOnDefault(page, account).catch(() => undefined);
    await cleanup(account, [
      { id: firstId, token: firstToken },
      { id: secondId, token: secondToken },
    ]);
  }
});
