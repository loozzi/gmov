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

/** Same base URL as `api()`, but returns the raw Response so a test can
 * assert on error paths (401/403) that `api()` would throw on. */
export function rawApi(path: string, init?: RequestInit) {
  return fetch(`${BACKEND}${path}`, init);
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

/** Public sample stream used by the dev-only /e2e/player harness.
 * MUST stay in sync with apps/web/app/e2e/player/page.tsx. */
export const SAMPLE_M3U8 =
  "https://test-streams.mux.dev/x36xhzz/x36xhzz.m3u8";

/** True when OUR backend can serve upstream catalog data right now
 * (fresh CI redis has no stale cache to fall back on, so this fails
 * exactly when runners can't reach the source). */
export async function probeUpstream(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    const res = await fetch(`${BACKEND}/api/v1/movies/latest?page=1`, {
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return false;
    const data = await res.json();
    return Array.isArray(data?.items) && data.items.length > 0;
  } catch {
    return false;
  }
}

/** True when the sample HLS stream for the resume test is reachable. */
export async function probeMux(): Promise<boolean> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 25000);
    const res = await fetch(SAMPLE_M3U8, { signal: ctrl.signal });
    clearTimeout(timer);
    if (!res.ok) return false;
    const text = await res.text();
    return text.includes("#EXTM3U");
  } catch {
    return false;
  }
}
