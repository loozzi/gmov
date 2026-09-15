/** Per-test login. Refresh rotation burns a cookie on first use, so a shared
 * storageState file cannot work across tests — each test logs in fresh
 * through the Next auth route handler (fast, ~200ms), which plants the
 * httpOnly cookie in that test's own browser context. */
import { expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

import { LAST_USER_FILE } from "./api";

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
