import { expect, test, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import {
  LAST_USER_FILE,
  api,
  registerUser,
  type TestAccount,
} from "./helpers/api";
import { skipIfNoUpstream } from "./helpers/net";

skipIfNoUpstream();

test.setTimeout(150_000);

const sh = promisify(execFile);

interface MoviesPage {
  items: { slug: string }[];
}

function freshReporter(): TestAccount {
  const stamp = Date.now().toString(36);
  return {
    email: `e2e-reporter-${stamp}@gmov.dev`,
    username: `e2e_rep_${stamp}`,
    password: "E2e-password-123",
  };
}

async function setModerator(username: string): Promise<boolean> {
  try {
    const root = resolve(LAST_USER_FILE, "..", "..", "..", "..");
    await sh(
      "docker",
      [
        "compose",
        "--project-directory",
        root,
        "exec",
        "-T",
        "api",
        "python",
        "-m",
        "app.cli",
        "set-role",
        username,
        "moderator",
      ],
      { timeout: 60_000 },
    );
    return true;
  } catch {
    return false;
  }
}

async function loginViaUi(page: Page, account: TestAccount): Promise<void> {
  await page.goto("/login");
  await page.getByLabel(/email hoặc tên đăng nhập/i).fill(account.username);
  await page.getByLabel(/^mật khẩu$/i).fill(account.password);
  await page.getByRole("button", { name: /^đăng nhập$/i }).click();
  await page.waitForURL((url) => url.pathname !== "/login", { timeout: 30_000 });
  await expect(
    page.locator("header").getByRole("button", { name: /tài khoản/i }),
  ).toBeVisible({ timeout: 20_000 });
}

function commentCard(page: Page, text: string) {
  return page.locator("div.rounded-xl").filter({ hasText: text }).first();
}

test("report -> hide -> hidden placeholder -> unhide -> cleanup", async ({
  browser,
}) => {
  const account = JSON.parse(
    await readFile(LAST_USER_FILE, "utf8"),
  ) as TestAccount;
  const reporter = freshReporter();

  const promoted = await setModerator(account.username);
  if (!promoted) {
    test.skip(true, "could not promote the base account to moderator via CLI");
    return;
  }

  try {
    await registerUser(reporter);
  } catch (e) {
    test.skip(
      true,
      `reporter registration throttled: ${String(e).slice(0, 120)}`,
    );
    return;
  }

  const latest = (await api("/api/v1/movies/latest?page=1")) as MoviesPage;
  const slug = latest.items[0]?.slug;
  if (!slug) {
    test.skip(true, "upstream returned no movies");
    return;
  }

  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100";
  const body = `E2E moderation ${Date.now().toString(36)}`;
  const modCtx = await browser.newContext({ baseURL });
  const repCtx = await browser.newContext({ baseURL });

  try {
    const modPage = await modCtx.newPage();
    const repPage = await repCtx.newPage();

    await loginViaUi(modPage, account);
    await modPage.goto(`/phim/${slug}`);
    await expect(
      modPage.getByPlaceholder(/chia sẻ cảm nhận/i),
    ).toBeVisible({ timeout: 20_000 });
    await modPage.getByPlaceholder(/chia sẻ cảm nhận/i).fill(body);
    await modPage.getByRole("button", { name: /gửi bình luận/i }).click();
    await expect(commentCard(modPage, body)).toBeVisible({ timeout: 20_000 });

    await loginViaUi(repPage, reporter);
    await repPage.goto(`/phim/${slug}`);
    const repCard = commentCard(repPage, body);
    const reportButton = repCard.getByRole("button", { name: /^báo cáo$/i });
    await expect(reportButton).toBeVisible({ timeout: 20_000 });
    await reportButton.click();

    const dialog = repPage.getByRole("dialog");
    await expect(dialog.getByText(/báo cáo bình luận/i)).toBeVisible();
    await dialog.getByRole("radio", { name: "Spam" }).check();
    await dialog.getByRole("button", { name: /gửi báo cáo/i }).click();
    await expect(repCard.getByText(/đã báo cáo/i)).toBeVisible({
      timeout: 20_000,
    });

    await modPage.goto("/admin/reports");
    const openCard = commentCard(modPage, body);
    await expect(openCard).toBeVisible({ timeout: 20_000 });
    await openCard.getByRole("button", { name: "Ẩn", exact: true }).click();

    await repPage.reload();
    const authorCard = commentCard(repPage, account.username);
    await expect(authorCard.getByText("Bình luận đã bị ẩn")).toBeVisible({
      timeout: 20_000,
    });
    await expect(repPage.getByText(body)).toBeHidden();

    await modPage.getByRole("button", { name: /^đã xử lý$/i }).click();
    const resolvedCard = commentCard(modPage, body);
    await expect(resolvedCard).toBeVisible({ timeout: 20_000 });
    await resolvedCard
      .getByRole("button", { name: "Bỏ ẩn", exact: true })
      .click();
    await expect(
      resolvedCard.getByRole("button", { name: "Ẩn", exact: true }),
    ).toBeVisible({ timeout: 20_000 });

    await repPage.reload();
    await expect(commentCard(repPage, body)).toBeVisible({ timeout: 20_000 });

    modPage.on("dialog", (d) => void d.accept());
    await modPage.goto(`/phim/${slug}`);
    const ownerCard = commentCard(modPage, body);
    await expect(ownerCard).toBeVisible({ timeout: 20_000 });
    await ownerCard.getByRole("button", { name: "Xóa bình luận" }).click();
    await expect(modPage.getByText(body)).toBeHidden({ timeout: 20_000 });
  } finally {
    await modCtx.close();
    await repCtx.close();
  }
});
