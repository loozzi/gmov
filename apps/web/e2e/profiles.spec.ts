import { expect, test, type Page } from "@playwright/test";
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
  type PinCandidates,
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
  knownPins: Record<string, PinCandidates> = {},
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

/** Log in through the actual form so AuthProvider.login() runs in THIS tab.
 * Needed by the picker spec: the picker only appears when the user logged in
 * inside that tab (the module-level intent is not persisted across reloads). */
async function loginViaUi(page: Page, account: TestAccount): Promise<void> {
  await page.goto("/login");
  await page.getByLabel(/email hoặc tên đăng nhập/i).fill(account.username);
  await page.getByLabel(/^mật khẩu$/i).fill(account.password);
  await page.getByRole("button", { name: /^đăng nhập$/i }).click();
  await page.waitForURL((url) => url.pathname !== "/login", {
    timeout: 30_000,
  });
}

/** Leave a fresh session on the default profile after a test switched away. */
async function restoreDefault(account: TestAccount): Promise<void> {
  try {
    const token = (await loginUser(account)).access_token;
    await switchProfile(token, (await defaultProfile(token)).id);
  } catch (e) {
    console.log(`[profiles] default restore skipped: ${String(e).slice(0, 140)}`);
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
    // ...and the deleted profile's scope self-heals to the default profile
    // (`pid` of a removed profile falls back instead of 404-ing) without ever
    // leaking the dead profile's favorites.
    const stale = await rawApi("/api/v1/me/favorites", {
      headers: authHeaders(doomedToken),
    });
    expect(stale.status).toBe(200);
    const staleSlugs = slugsOf(
      (await stale.json()) as { items: { movie_slug: string }[] },
    );
    expect(staleSlugs).toContain(keepSlug);
    expect(staleSlugs).not.toContain(doomedSlug);
  } finally {
    await cleanup(account, [keepSlug], doomedId ? { [doomedId]: "1357" } : {});
  }
});

test("creating a profile from the manage page adds a row", async ({ page }) => {
  const account = await loadAccount();
  const name = `Moi ${stamp()}`;

  try {
    await resetProfiles(account);
    // Spare-capacity guarantee: resetProfiles deleted every non-default
    // profile, so the account is back to a single used slot. The manage
    // page only renders the add control while items.length < max; asserting
    // it here (before any UI) makes the precondition explicit instead of
    // hoping the control is there.
    const token = (await loginUser(account)).access_token;
    const before = await listProfiles(token);
    expect(before.items.length).toBeLessThan(before.max);

    await loginViaApi(page);
    await page.goto("/profiles/manage");
    await page.getByTestId("profile-add").click();

    const dialog = page.getByRole("dialog", { name: "Thêm profile" });
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("Tên profile").fill(name);
    await dialog.getByRole("button", { name: "Tạo profile" }).click();
    await expect(dialog).toBeHidden();

    const row = page
      .locator('[data-testid^="profile-row-"]')
      .filter({ hasText: name });
    await expect(row).toBeVisible();

    // Tidy up through the UI: non-default profiles delete with a confirm().
    page.on("dialog", (confirm) => void confirm.accept());
    await row.getByRole("button", { name: `Xoá profile ${name}` }).click();
    await expect(row).toHaveCount(0);
  } finally {
    await cleanup(account);
  }
});

test("changing a PIN requires the current PIN", async ({ page }) => {
  const account = await loadAccount();
  const name = `Pin ${stamp()}`;
  let profileId = "";

  try {
    await resetProfiles(account);
    const token = (await loginUser(account)).access_token;
    const profile = await createProfile(token, name, "robot");
    profileId = profile.id;
    // First PIN only needs the account password.
    await setProfilePin(token, profileId, account.password, "1111");

    await loginViaApi(page);
    await page.goto("/profiles/manage");
    const row = page.getByTestId(`profile-row-${profileId}`);
    await row.getByRole("button", { name: `Đổi PIN ${name}` }).click();

    const dialog = page.getByRole("dialog", { name: "Đổi PIN" });
    await expect(dialog).toBeVisible();

    // Wrong current PIN is rejected: the dialog stays open with the error.
    await dialog.getByLabel("PIN hiện tại").fill("0000");
    await dialog.getByLabel("Mật khẩu tài khoản").fill(account.password);
    await dialog.getByLabel("PIN mới").fill("2222");
    await dialog.getByRole("button", { name: /^lưu$/i }).click();
    await expect(dialog.getByRole("alert")).toHaveText(
      /PIN hiện tại không đúng/i,
    );

    // Correct current PIN goes through; the stored PIN is now 2222.
    await dialog.getByLabel("PIN hiện tại").fill("1111");
    await dialog.getByRole("button", { name: /^lưu$/i }).click();
    await expect(dialog).toBeHidden();
  } finally {
    await cleanup(account, [], profileId ? { [profileId]: "2222" } : {});
  }
});

test("the picker appears after login and enforces the PIN", async ({
  page,
}) => {
  const account = await loadAccount();
  const name = `Chon ${stamp()}`;
  let spareId = "";

  try {
    await resetProfiles(account);
    const token = (await loginUser(account)).access_token;
    const spare = await createProfile(token, name, "ghost");
    spareId = spare.id;
    await setProfilePin(token, spareId, account.password, "4321");

    // Log in through the form in THIS tab: only then does the picker fire.
    await loginViaUi(page, account);

    const picker = page.getByTestId("profile-picker");
    await expect(picker).toBeVisible();

    // A locked profile prompts for its PIN before switching.
    await page.getByTestId(`profile-picker-option-${spareId}`).click();
    const pinDialog = page.getByRole("dialog", {
      name: `Nhập PIN cho ${name}`,
    });
    await expect(pinDialog).toBeVisible();

    await pinDialog.getByLabel("Mã PIN").fill("0000");
    await pinDialog.getByRole("button", { name: /^xác nhận$/i }).click();
    await expect(pinDialog.getByRole("alert")).toHaveText(/PIN không đúng/i);

    await pinDialog.getByLabel("Mã PIN").fill("4321");
    await pinDialog.getByRole("button", { name: /^xác nhận$/i }).click();

    await expect(picker).toBeHidden();
    await expect(
      page.locator("header").getByRole("button", { name: /chọn profile/i }),
    ).toContainText(name);
  } finally {
    await cleanup(account, [], spareId ? { [spareId]: "4321" } : {});
    await restoreDefault(account);
  }
});

test("a stale has_pin reveals the current-PIN field on PIN_REQUIRED", async ({
  page,
}) => {
  const account = await loadAccount();
  const name = `Stale ${stamp()}`;
  let profileId = "";

  try {
    await resetProfiles(account);
    const token = (await loginUser(account)).access_token;
    const profile = await createProfile(token, name, "clover");
    profileId = profile.id;

    // Load the manage page while the profile is still unlocked, so the client
    // caches has_pin === false.
    await loginViaApi(page);
    await page.goto("/profiles/manage");
    const row = page.getByTestId(`profile-row-${profileId}`);
    await expect(
      row.getByRole("button", { name: `Đặt PIN ${name}` }),
    ).toBeVisible();

    // Set the PIN behind the client's back; the cached list still says the
    // profile is unlocked (no reload, so has_pin stays stale).
    await setProfilePin(token, profileId, account.password, "1357");

    await row.getByRole("button", { name: `Đặt PIN ${name}` }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // The stale cache hides the current-PIN field at this point.
    await expect(dialog.getByLabel("PIN hiện tại")).toHaveCount(0);

    await dialog.getByLabel("Mật khẩu tài khoản").fill(account.password);
    await dialog.getByLabel("PIN mới").fill("2468");
    await dialog.getByRole("button", { name: /^lưu$/i }).click();

    // The server answers PIN_REQUIRED; the dialog must reveal the field (and
    // switch its title to "Đổi PIN") instead of leaving the user stuck.
    await expect(dialog.getByLabel("PIN hiện tại")).toBeVisible();
    await expect(dialog.getByRole("alert")).toHaveText(/cần PIN hiện tại/i);

    await dialog.getByLabel("PIN hiện tại").fill("1357");
    await dialog.getByRole("button", { name: /^lưu$/i }).click();
    await expect(dialog).toBeHidden();
  } finally {
    // The PIN change may not have completed if the reveal assertion failed, so
    // accept either the new or the original PIN; cleanup tries both.
    await cleanup(
      account,
      [],
      profileId ? { [profileId]: ["2468", "1357"] } : {},
    );
  }
});

test("the profile menu never locks page scroll (no scrollbar flicker)", async ({
  page,
}) => {
  const account = await loadAccount();
  const name = `Scroll ${stamp()}`;
  let spareId = "";

  try {
    await resetProfiles(account);
    const token = (await loginUser(account)).access_token;
    spareId = (await createProfile(token, name, "ghost")).id;

    // Two profiles so the picker fires on login; dismiss it to reach the header.
    await loginViaUi(page, account);
    await page.getByTestId("profile-picker-dismiss").click();
    await expect(page.getByTestId("profile-picker")).toBeHidden();

    const scrollState = () =>
      page.evaluate(() => ({
        locked: document.body.getAttribute("data-scroll-locked"),
        bodyOverflow: getComputedStyle(document.body).overflow,
        pageHasScroll:
          document.documentElement.scrollHeight >
          document.documentElement.clientHeight,
      }));

    const before = await scrollState();
    expect(before.locked).toBeNull();
    // The page must actually be scrollable, otherwise "no lock" is trivially
    // true and the regression this guards (a hiding scrollbar) can't happen.
    expect(before.pageHasScroll).toBe(true);

    await page.getByRole("button", { name: "Chọn profile" }).click();
    await expect(
      page.getByRole("menuitem", { name: /Quản lý profile/ }),
    ).toBeVisible();

    // A transient menu must not lock the page scroll: hiding the viewport
    // scrollbar while the menu is open is what made it flicker on open/close.
    const during = await scrollState();
    expect(during.locked).toBeNull();
    expect(during.bodyOverflow).not.toBe("hidden");
    expect(during.pageHasScroll).toBe(true);

    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("menuitem", { name: /Quản lý profile/ }),
    ).toBeHidden();

    // The account menu lives in the same header and had the same default.
    await page.getByRole("button", { name: "Tài khoản" }).click();
    await expect(page.getByRole("menuitem", { name: /Trang cá nhân/ })).toBeVisible();
    const accountDuring = await scrollState();
    expect(accountDuring.locked).toBeNull();
    expect(accountDuring.bodyOverflow).not.toBe("hidden");
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("menuitem", { name: /Trang cá nhân/ }),
    ).toBeHidden();

    const after = await scrollState();
    expect(after.locked).toBeNull();
    expect(after.bodyOverflow).not.toBe("hidden");
  } finally {
    await cleanup(account, [], spareId ? { [spareId]: [] } : {});
    await restoreDefault(account);
  }
});

