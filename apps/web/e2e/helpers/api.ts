/** Shared backend helpers for seeding/cleanup (Node side, no browser). */
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const BACKEND =
  process.env.PLAYWRIGHT_BACKEND_URL ?? "http://localhost:8000";

/** Absolute path of apps/web/e2e regardless of the invoker cwd. */
export const E2E_DIR = existsSync(resolve("apps/web/e2e"))
  ? resolve("apps/web/e2e")
  : resolve("e2e");
export const LAST_USER_FILE = join(E2E_DIR, ".last-user.json");

export interface TestAccount {
  email: string;
  username: string;
  password: string;
}

export async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${BACKEND}${path}`, init);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${path} -> ${res.status}: ${body.slice(0, 300)}`);
  }
  return res.json();
}

export async function registerUser(acc: TestAccount): Promise<void> {
  await api("/api/v1/auth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(acc),
  });
}

export async function loginUser(acc: TestAccount): Promise<{
  access_token: string;
  refresh_token: string;
}> {
  const form = new URLSearchParams({
    username: acc.username,
    password: acc.password,
  });
  return api("/api/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
}

export function authHeaders(token: string): Record<string, string> {
  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

export async function waitForBackend(timeoutMs = 120_000): Promise<void> {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(`${BACKEND}/health`);
      if (res.ok) return;
    } catch {
      // retry
    }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`backend ${BACKEND} never became healthy`);
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
}
