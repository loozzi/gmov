import { expect, test } from "@playwright/test";
import { readFile } from "node:fs/promises";

import {
  LAST_USER_FILE,
  addFavorite,
  authHeaders,
  createProfile,
  listFavorites,
  listProfiles,
  loginUser,
  rawApi,
  removeFavorite,
  resetProfiles,
  setProfilePin,
  switchProfile,
  type ApiProfile,
  type ApiProfileListItem,
  type TestAccount,
} from "./helpers/api";
import { loginViaApi } from "./helpers/auth";

// These specs MUST NOT register accounts: register is throttled 3/hour/IP and
// the base account from global-setup is the only one used. Isolation is proven
// with PROFILES created/deleted inside each test. No upstream data is needed
// (favorites accept arbitrary slugs), so this file never skips on CDN access.

test.setTimeout(120_000);

const stamp = () => Date.now().toString(36).slice(-6);

async function loadAccount(): Promise<TestAccount> {
  return JSON.parse(await readFile(LAST_USER_FILE, "utf8")) as TestAccount;
}

async function defaultProfile(token: string): Promise<ApiProfileListItem> {
  const list = await listProfiles(token);
  const found = list.items.find((p) => p.is_default);
  if (!found) throw new Error("test account has no default profile");
  return found;
}

const slugsOf = (page: { items: { movie_slug: string }[] }) =>
  page.items.map((f) => f.movie_slug);

/** Remove the default profile's favorites left by a test, then delete every
 * non-default profile (clearing PINs first) so the account is back to default.
 * Best-effort: cleanup failures are logged, never mask the test result. */
async function cleanup(
  account: TestAccount,
  favoriteSlugs: string[] = [],
  knownPins: Record<string, string> = {},
): Promise<void> {
  try {
    const token = (await loginUser(account)).access_token;
    for (const slug of favoriteSlugs) {
      await removeFavorite(token, slug).catch(() => undefined);
    }
  } catch (e) {
    console.log(`[profiles] favorite cleanup skipped: ${String(e).slice(0, 140)}`);
  }
  try {
    await resetProfiles(account, knownPins);
  } catch (e) {
    console.log(`[profiles] reset skipped: ${String(e).slice(0, 140)}`);
  }
}

test("second profile keeps its own My list and switching back preserves the first", async ({
  page,
}) => {
  const account = await loadAccount();
  const keepSlug = `e2e-default-${stamp()}`;
  const secondSlug = `e2e-second-${stamp()}`;

  try {
    await resetProfiles(account);
    const token = (await loginUser(account)).access_token;
    const def = await defaultProfile(token);
    const second = await createProfile(token, "Bé", "cat");
    await addFavorite(token, keepSlug, `Phim mặc định ${keepSlug}`);

    const switched = await switchProfile(token, second.id);
    expect(switched.access_token).toBeTruthy();
    const secondToken = switched.access_token as string;
    await addFavorite(secondToken, secondSlug, `Phim Bé ${secondSlug}`);

    // The two libraries must not bleed into each other.
    expect(slugsOf(await listFavorites(token))).toContain(keepSlug);
    expect(slugsOf(await listFavorites(token))).not.toContain(secondSlug);
    expect(slugsOf(await listFavorites(secondToken))).toContain(secondSlug);
    expect(slugsOf(await listFavorites(secondToken))).not.toContain(keepSlug);

    await loginViaApi(page);

    // Default profile's My list, through the UI.
    await page.goto("/me/favorites");
    await expect(page.getByText(`Phim mặc định ${keepSlug}`).first()).toBeVisible();
    await expect(page.getByText(`Phim Bé ${secondSlug}`)).toHaveCount(0);

    // Switch to the second profile through the UI.
    await page.goto("/profiles");
    await page.getByTestId(`profile-card-${second.id}`).click();
    await expect(page.getByTestId(`profile-card-${second.id}`)).toHaveAttribute(
      "aria-label",
      "Bé (đang xem)",
    );
    await page.goto("/me/favorites");
    await expect(page.getByText(`Phim Bé ${secondSlug}`).first()).toBeVisible();
    await expect(page.getByText(`Phim mặc định ${keepSlug}`)).toHaveCount(0);

    // Switch back: the first profile's data is intact.
    await page.goto("/profiles");
    await page.getByTestId(`profile-card-${def.id}`).click();
    await expect(page.getByTestId(`profile-card-${def.id}`)).toHaveAttribute(
      "aria-label",
      `${def.name} (đang xem)`,
    );
    await page.goto("/me/favorites");
    await expect(page.getByText(`Phim mặc định ${keepSlug}`).first()).toBeVisible();
    await expect(page.getByText(`Phim Bé ${secondSlug}`)).toHaveCount(0);

    // Delete the created profile WITHOUT a PIN: the UI asks via window.confirm.
    page.on("dialog", (dialog) => void dialog.accept());
    await page.goto("/profiles/manage");
    const row = page.getByTestId(`profile-row-${second.id}`);
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Xoá profile Bé" }).click();
    await expect(page.getByTestId(`profile-row-${second.id}`)).toHaveCount(0);
  } finally {
    await cleanup(account, [keepSlug]);
  }
});

test("a locked profile asks for its PIN", async ({ page }) => {
  const account = await loadAccount();
  let lockedId = "";

  try {
    await resetProfiles(account);
    const token = (await loginUser(account)).access_token;
    const locked = await createProfile(token, "Bé", "panda");
    lockedId = locked.id;
    await setProfilePin(token, locked.id, account.password, "2468");

    await loginViaApi(page);
    await page.goto("/profiles");
    await page.getByTestId(`profile-card-${locked.id}`).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Wrong PIN: the dialog stays open and shows the error.
    await dialog.getByLabel("Mã PIN").fill("0000");
    await dialog.getByRole("button", { name: /^xác nhận$/i }).click();
    await expect(dialog.getByRole("alert")).toHaveText(/PIN không đúng/i);

    // Right PIN: the switch goes through and the card becomes current.
    await dialog.getByLabel("Mã PIN").fill("2468");
    await dialog.getByRole("button", { name: /^xác nhận$/i }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByTestId(`profile-card-${locked.id}`)).toHaveAttribute(
      "aria-label",
      "Bé (đang xem)",
    );
  } finally {
    await cleanup(account, [], lockedId ? { [lockedId]: "2468" } : {});
  }
});

test("the default profile cannot be deleted and the sixth is rejected", async ({
  page,
}) => {
  const account = await loadAccount();
  const nameBase = `Test ${stamp()}`;

  try {
    await resetProfiles(account);
    const token = (await loginUser(account)).access_token;
    const def = await defaultProfile(token);

    // Fill up to the account's ACTUAL limit (tolerates a leftover profile from
    // an interrupted earlier run instead of assuming four free slots).
    const created: ApiProfile[] = [];
    let list = await listProfiles(token);
    while (list.items.length < list.max) {
      created.push(
        await createProfile(token, `${nameBase} ${created.length + 1}`, "star"),
      );
      list = await listProfiles(token);
    }
    expect(list.items.length).toBe(list.max);

    await loginViaApi(page);
    await page.goto("/profiles/manage");

    // The default row has no delete control at all.
    const defaultRow = page.getByTestId(`profile-row-${def.id}`);
    await expect(defaultRow).toBeVisible();
    await expect(
      defaultRow.getByRole("button", { name: `Xoá profile ${def.name}` }),
    ).toHaveCount(0);

    // ...while a non-default row does (control for the assertion above).
    const sample = created[0] ?? list.items.find((item) => !item.is_default);
    if (!sample) throw new Error("no non-default profile to assert against");
    await expect(
      page
        .getByTestId(`profile-row-${sample.id}`)
        .getByRole("button", { name: `Xoá profile ${sample.name}` }),
    ).toBeVisible();

    // One more profile is refused server-side, at the real limit.
    const res = await rawApi("/api/v1/me/profiles", {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ name: `${nameBase} overflow`, avatar: "star" }),
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { code?: string };
    expect(body.code).toBe("PROFILE_LIMIT_REACHED");
  } finally {
    await cleanup(account);
  }
});

test("deleting a profile removes only its data", async ({ page }) => {
  const account = await loadAccount();
  const keepSlug = `e2e-keep-${stamp()}`;
  const doomedSlug = `e2e-doomed-${stamp()}`;
  let doomedId = "";

  try {
    await resetProfiles(account);
    const token = (await loginUser(account)).access_token;
    const doomed = await createProfile(token, "Bé Hai", "dino");
    doomedId = doomed.id;
    await addFavorite(token, keepSlug, `Phim giữ ${keepSlug}`);

    // Unlocked at this point, so the switch needs no PIN; lock it afterwards
    // (setting a PIN only needs the account password, not the active profile).
    const switched = await switchProfile(token, doomed.id);
    const doomedToken = switched.access_token as string;
    await addFavorite(doomedToken, doomedSlug, `Phim xoá ${doomedSlug}`);
    await setProfilePin(token, doomed.id, account.password, "1357");

    await loginViaApi(page);
    await page.goto("/profiles/manage");
    const row = page.getByTestId(`profile-row-${doomed.id}`);
    await expect(row).toBeVisible();
    await row.getByRole("button", { name: "Xoá profile Bé Hai" }).click();

    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Mã PIN").fill("1357");
    await dialog.getByRole("button", { name: /xác nhận xoá/i }).click();
    await expect(page.getByTestId(`profile-row-${doomed.id}`)).toHaveCount(0);

    // Gone from the account list...
    expect((await listProfiles(token)).items.map((p) => p.id)).not.toContain(
      doomed.id,
    );
    // ...the other profile's library is untouched...
    const defaultSlugs = slugsOf(await listFavorites(token));
    expect(defaultSlugs).toContain(keepSlug);
    expect(defaultSlugs).not.toContain(doomedSlug);
    // ...and the deleted profile's scope no longer resolves at all.
    const stale = await rawApi("/api/v1/me/favorites", {
      headers: authHeaders(doomedToken),
    });
    expect(stale.status).toBe(404);
    const staleBody = (await stale.json()) as { code?: string };
    expect(staleBody.code).toBe("PROFILE_NOT_FOUND");
  } finally {
    await cleanup(account, [keepSlug], doomedId ? { [doomedId]: "1357" } : {});
  }
});
