import { expect, test } from "@playwright/test";

import { continuePastChooser, loginViaApi } from "./helpers/auth";

// NOTE: this spec registers one extra account per run. Server throttle is
// 3 accounts/hour/IP and global-setup reuses its account, so steady-state
// local usage stays within budget (~1 extra registration per run).

test.use({ storageState: { cookies: [], origins: [] } });

test("register -> auto login -> chooser -> name in header", async ({ page }) => {
  const stamp = Date.now().toString(36);
  await page.goto("/register");
  await page.getByLabel(/email/i).fill(`e2e-reg-${stamp}@gmov.dev`);
  await page.getByLabel(/tên đăng nhập/i).fill(`e2e_reg_${stamp}`);
  await page.getByLabel(/^mật khẩu$/i).fill("E2e-password-123");
  await page.getByLabel(/nhập lại mật khẩu/i).fill("E2e-password-123");
  await page.getByRole("button", { name: /^đăng ký$/i }).click();
  // Signing up lands on the profile chooser (the immersive /profiles screen).
  await page.waitForURL((url) => url.pathname === "/profiles", {
    timeout: 20_000,
  });
  await continuePastChooser(page);
  // Logged in: header shows the account menu, not the login link.
  // (The footer always links to /login, so scope the check to the header.)
  const header = page.locator("header");
  await expect(header.getByRole("button", { name: /tài khoản/i })).toBeVisible();
  await expect(
    header.getByRole("link", { name: /đăng nhập/i }),
  ).toHaveCount(0);
});

test("wrong password shows Vietnamese error, no crash", async ({ page }) => {
  await page.goto("/login");
  await page
    .getByLabel(/email hoặc tên đăng nhập/i)
    .fill("khong-ton-tai@gmov.dev");
  await page.getByLabel(/^mật khẩu$/i).fill("sai-mat-khau");
  await page.getByRole("button", { name: /^đăng nhập$/i }).click();
  await expect(page.getByText(/thông tin đăng nhập không đúng/i)).toBeVisible();
  // Still on the login page, form intact.
  await expect(page).toHaveURL(/\/login/);
  await expect(
    page.getByRole("button", { name: /^đăng nhập$/i }),
  ).toBeEnabled();
});

test("logout blocks /me routes", async ({ page }) => {
  await loginViaApi(page);
  const header = page.locator("header");
  await header.getByRole("button", { name: /tài khoản/i }).click();
  await page.getByRole("menuitem", { name: /đăng xuất/i }).click();
  // Prove logout really happened in the header (footer links don't count).
  await expect(
    header.getByRole("button", { name: /tài khoản/i }),
  ).toHaveCount(0);
  await expect(
    header.getByRole("link", { name: /đăng nhập/i }),
  ).toBeVisible();
  await page.goto("/me/favorites");
  await expect(page).toHaveURL(/\/login\?next=/);
});
