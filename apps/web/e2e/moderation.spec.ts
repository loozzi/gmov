import { expect, test, type Page } from "@playwright/test";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { promisify } from "node:util";

import {
  LAST_USER_FILE,
  api,
  authHeaders,
  loginUser,
  rawApi,
  registerUser,
  type TestAccount,
} from "./helpers/api";
import { loginViaApi, loginViaUi } from "./helpers/auth";
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

async function setRole(username: string, role: string): Promise<boolean> {
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
        role,
      ],
      { timeout: 60_000 },
    );
    return true;
  } catch {
    return false;
  }
}

function commentCard(page: Page, text: string) {
  return page.locator("div.rounded-xl").filter({ hasText: text }).first();
}

async function deleteComment(
  page: Page,
  slug: string,
  body: string,
): Promise<void> {
  try {
    page.on("dialog", (d) => void d.accept());
    await page.goto(`/phim/${slug}`);
    const card = commentCard(page, body);
    await expect(card).toBeVisible({ timeout: 20_000 });
    await card.getByRole("button", { name: "Xóa bình luận" }).click();
    await expect(page.getByText(body)).toBeHidden({ timeout: 20_000 });
  } catch (e) {
    console.log(`[moderation] cleanup skipped: ${String(e).slice(0, 120)}`);
  }
}

test("report -> hide -> hidden placeholder -> unhide -> cleanup", async ({
  browser,
}) => {
  const account = JSON.parse(
    await readFile(LAST_USER_FILE, "utf8"),
  ) as TestAccount;
  const reporter = freshReporter();

  const promoted = await setRole(account.username, "moderator");
  if (!promoted) {
    test.skip(true, "could not promote the base account to moderator via CLI");
    return;
  }

  try {
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
      let posted = false;

      try {
        await loginViaUi(modPage, account);
        await modPage.goto(`/phim/${slug}`);
        await expect(modPage.getByPlaceholder(/chia sẻ cảm nhận/i)).toBeVisible(
          { timeout: 20_000 },
        );
        await modPage.getByPlaceholder(/chia sẻ cảm nhận/i).fill(body);
        await modPage.getByRole("button", { name: /gửi bình luận/i }).click();
        posted = true;
        await expect(commentCard(modPage, body)).toBeVisible({
          timeout: 20_000,
        });

        await loginViaUi(repPage, reporter);
        await repPage.goto(`/phim/${slug}`);
        const repCard = commentCard(repPage, body);
        const reportButton = repCard.getByRole("button", {
          name: /^báo cáo$/i,
        });
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
        await expect(commentCard(repPage, body)).toBeVisible({
          timeout: 20_000,
        });
      } finally {
        if (posted) await deleteComment(modPage, slug, body);
      }
    } finally {
      await modCtx.close();
      await repCtx.close();
    }
  } finally {
    await setRole(account.username, "user");
  }
});


test("a spoiler comment is veiled and revealed on click", async ({ page }) => {
  const account = JSON.parse(
    await readFile(LAST_USER_FILE, "utf8"),
  ) as TestAccount;
  const latest = (await api("/api/v1/movies/latest?page=1")) as MoviesPage;
  const slug = latest.items[0]?.slug;
  if (!slug) {
    test.skip(true, "upstream returned no movies");
    return;
  }

  const stamp2 = Date.now().toString(36);
  const plainBody = `E2E plain ${stamp2}`;
  const spoilBody = `E2E spoiler ${stamp2}`;
  let plainPosted = false;
  let spoilPosted = false;

  try {
    await loginViaApi(page);
    await page.goto(`/phim/${slug}`);
    const box = page.getByPlaceholder(/chia sẻ cảm nhận/i);
    await expect(box).toBeVisible({ timeout: 20_000 });

    // A comment without the checkbox stays plain.
    await box.fill(plainBody);
    await page.getByRole("button", { name: /gửi bình luận/i }).click();
    plainPosted = true;
    const plainCard = commentCard(page, plainBody);
    await expect(plainCard).toBeVisible({ timeout: 20_000 });
    await expect(plainCard.getByTestId("spoiler-veil")).toHaveCount(0);

    // A spoiler comment is blurred behind a veil until the reader lifts it.
    await box.fill(spoilBody);
    await page.getByLabel(/nội dung có spoiler/i).check();
    await page.getByRole("button", { name: /gửi bình luận/i }).click();
    spoilPosted = true;
    const card = commentCard(page, spoilBody);
    await expect(card).toBeVisible({ timeout: 20_000 });
    const veil = card.getByTestId("spoiler-veil");
    await expect(veil).toBeVisible();
    await expect(veil).toContainText(/nhấn để xem/i);

    await veil.click();
    await expect(card.getByTestId("spoiler-veil")).toHaveCount(0);
    await expect(card.getByText(spoilBody)).toBeVisible();
  } finally {
    // API cleanup: two UI deletes would register the dialog handler twice.
    const token = (await loginUser(account)).access_token;
    for (const [posted, body] of [
      [spoilPosted, spoilBody],
      [plainPosted, plainBody],
    ] as const) {
      if (!posted) continue;
      const listing = (await api(
        `/api/v1/comments?movie_slug=${encodeURIComponent(slug)}&per_page=100`,
      )) as { items: { id: string; body: string | null }[] };
      const mine = listing.items.find((item) => item.body === body);
      if (mine) {
        await rawApi(`/api/v1/me/comments/${mine.id}`, {
          method: "DELETE",
          headers: authHeaders(token),
        }).catch(() => undefined);
      }
    }
  }
});

test("ban the comment author from the queue, then unban", async ({
  browser,
}) => {
  const account = JSON.parse(
    await readFile(LAST_USER_FILE, "utf8"),
  ) as TestAccount;
  const promoted = await setRole(account.username, "moderator");
  if (!promoted) {
    test.skip(true, "could not promote the base account to moderator via CLI");
    return;
  }

  const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3100";
  const author = freshReporter();
  let authorToken = "";
  let slug = "";
  let firstId = "";
  let secondId = "";

  try {
    try {
      await registerUser(author);
    } catch (e) {
      test.skip(
        true,
        `registration throttled: ${String(e).slice(0, 120)}`,
      );
      return;
    }

    const latest = (await api("/api/v1/movies/latest?page=1")) as MoviesPage;
    slug = latest.items[0]?.slug ?? "";
    if (!slug) {
      test.skip(true, "upstream returned no movies");
      return;
    }

    authorToken = (await loginUser(author)).access_token;
    // The base (moderator) account files the report: one registration per test
    // keeps this under the 3-accounts/IP/hour register limit when the whole
    // file runs.
    const reporterToken = (await loginUser(account)).access_token;
    const body = `E2E ban ${Date.now().toString(36)}`;
    firstId = (
      (await api("/api/v1/me/comments", {
        method: "POST",
        headers: authHeaders(authorToken),
        body: JSON.stringify({ movie_slug: slug, body }),
      })) as { id: string }
    ).id;
    await api("/api/v1/me/reports", {
      method: "POST",
      headers: authHeaders(reporterToken),
      body: JSON.stringify({ comment_id: firstId, reason: "spam" }),
    });

    const ctx = await browser.newContext({ baseURL });
    const page = await ctx.newPage();
    page.on("dialog", (d) => void d.accept());
    try {
      await loginViaUi(page, account);
      await page.goto("/admin/reports");
      const row = page
        .locator("div.rounded-xl")
        .filter({ hasText: body })
        .first();
      await expect(row).toBeVisible({ timeout: 20_000 });

      await row.getByRole("button", { name: /^cấm$/i }).click();
      await expect(row.getByText("Đã cấm")).toBeVisible({ timeout: 20_000 });

      // The ban lands immediately: the token the account already holds is
      // refused and it cannot log in again.
      const blocked = await rawApi("/api/v1/me/comments", {
        method: "POST",
        headers: authHeaders(authorToken),
        body: JSON.stringify({ movie_slug: slug, body: "still spamming" }),
      });
      expect(blocked.status).toBe(401);
      expect((await blocked.json()).code).toBe("ACCOUNT_BANNED");
      const relogin = await rawApi("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          username: author.username,
          password: author.password,
        }),
      });
      expect(relogin.status).toBe(403);

      // Unban from the same row: the old token works again, no re-login.
      await row.getByRole("button", { name: /^bỏ cấm$/i }).click();
      await expect(row.getByText("Đã cấm")).toBeHidden({ timeout: 20_000 });
      secondId = (
        (await api("/api/v1/me/comments", {
          method: "POST",
          headers: authHeaders(authorToken),
          body: JSON.stringify({ movie_slug: slug, body: `${body} restored` }),
        })) as { id: string }
      ).id;
    } finally {
      await ctx.close();
    }
  } finally {
    for (const id of [firstId, secondId]) {
      if (id) {
        await rawApi(`/api/v1/me/comments/${id}`, {
          method: "DELETE",
          headers: authHeaders(authorToken),
        }).catch(() => undefined);
      }
    }
    await setRole(account.username, "user");
  }
});
