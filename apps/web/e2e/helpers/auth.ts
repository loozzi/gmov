/** Per-test login. Refresh rotation burns a cookie on first use, so a shared
 * storageState file cannot work across tests — each test logs in fresh
 * through the Next auth route handler (fast, ~200ms), which plants the
 * httpOnly cookie in that test's own browser context. */
import { expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { LAST_USER_FILE } from "./api";

export interface UiAccount {
  username: string;
  password: string;
}

export async function loginViaApi(page: Page): Promise<void> {
  const account = JSON.parse(await readFile(LAST_USER_FILE, "utf8"));
  const res = await page.request.post("/api/auth/login", {
    data: { username: account.username, password: account.password },
  });
  expect(
    res.ok(),
    `test login via /api/auth/login must succeed, got ${res.status()}`,
  ).toBeTruthy();
  await page.goto("/");
  await expect(page.getByRole("button", { name: /tài khoản/i })).toBeVisible({
    timeout: 20_000,
  });
}

/** Pick the profile that is already active and leave the immersive chooser.
 *  Specs that need the app chrome (header/footer) must call this: logging in
 *  always lands on /profiles, which shows no header. */
export async function continuePastChooser(
  page: Page,
  target = "/",
): Promise<void> {
  await expect(page.getByTestId("profile-chooser")).toBeVisible({
    timeout: 20_000,
  });
  await page
    .locator('[data-testid^="profile-card-"][aria-label*="(đang xem)"]')
    .click();
  await page.waitForURL((url) => url.pathname === target, {
    timeout: 20_000,
  });
}

/** Log in through the actual form (so AuthProvider.login() runs in THIS tab)
 *  and continue past the profile chooser to `target`. */
export async function loginViaUi(
  page: Page,
  account: UiAccount,
  target = "/",
): Promise<void> {
  await page.goto("/login");
  await page.getByLabel(/email hoặc tên đăng nhập/i).fill(account.username);
  await page.getByLabel(/^mật khẩu$/i).fill(account.password);
  await page.getByRole("button", { name: /^đăng nhập$/i }).click();
  await page.waitForURL((url) => url.pathname !== "/login", {
    timeout: 30_000,
  });
  await continuePastChooser(page, target);
}
