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

/** Profile/like helpers used by the profile specs. All of them are scoped to
 * the account's ACTIVE PROFILE carried in `token`: switch first to operate as
 * another profile. None of them register accounts (register quota is tight). */
export interface ApiProfile {
  id: string;
  name: string;
  avatar: string;
  position: number;
  has_pin: boolean;
  is_default: boolean;
}

export interface ApiProfileListItem extends ApiProfile {
  is_current: boolean;
}

export interface ProfileListResponse {
  items: ApiProfileListItem[];
  max: number;
}

export interface SwitchResponse {
  access_token: string | null;
  profile: ApiProfile | null;
}

export interface FavoriteItem {
  id: string;
  movie_slug: string;
  movie_name: string;
  poster_url: string | null;
}

export interface FavoriteListResponse {
  items: FavoriteItem[];
  page: number;
  per_page: number;
  total_items: number;
}

export function listProfiles(token: string): Promise<ProfileListResponse> {
  return api("/api/v1/me/profiles", { headers: authHeaders(token) });
}

export function createProfile(
  token: string,
  name: string,
  avatar = "popcorn",
): Promise<ApiProfile> {
  return api("/api/v1/me/profiles", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ name, avatar }),
  });
}

export function switchProfile(
  token: string,
  id: string,
  pin?: string,
): Promise<SwitchResponse> {
  return api(`/api/v1/me/profiles/${id}/switch`, {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify(pin ? { pin } : {}),
  });
}

export function deleteProfile(
  token: string,
  id: string,
  pin?: string,
): Promise<SwitchResponse> {
  return api(`/api/v1/me/profiles/${id}`, {
    method: "DELETE",
    headers: authHeaders(token),
    body: JSON.stringify(pin ? { pin } : {}),
  });
}

export function setProfilePin(
  token: string,
  id: string,
  password: string,
  pin: string | null,
): Promise<ApiProfile> {
  return api(`/api/v1/me/profiles/${id}/pin`, {
    method: "PUT",
    headers: authHeaders(token),
    body: JSON.stringify({ password, pin }),
  });
}

export function listFavorites(token: string): Promise<FavoriteListResponse> {
  return api("/api/v1/me/favorites", { headers: authHeaders(token) });
}

export function addFavorite(
  token: string,
  movieSlug: string,
  movieName: string,
): Promise<FavoriteItem> {
  return api("/api/v1/me/favorites", {
    method: "POST",
    headers: authHeaders(token),
    body: JSON.stringify({ movie_slug: movieSlug, movie_name: movieName }),
  });
}

export async function removeFavorite(
  token: string,
  movieSlug: string,
): Promise<void> {
  await api(`/api/v1/me/favorites/${encodeURIComponent(movieSlug)}`, {
    method: "DELETE",
    headers: authHeaders(token),
  });
}

/** Delete every non-default profile of the account (clearing PINs first) and
 * leave the session on the default profile. Used by the profile specs to make
 * runs idempotent on the shared account WITHOUT registering new ones. */
export async function resetProfiles(
  account: TestAccount,
  knownPins: Record<string, string> = {},
): Promise<void> {
  let token = (await loginUser(account)).access_token;
  for (const profile of (await listProfiles(token)).items) {
    if (profile.is_default) continue;
    try {
      // Prefer deleting a locked profile with its PIN the test set: clearing
      // the PIN first costs an extra `profile-pin-set` token, whose counter is
      // shared per IP and is NOT covered by the `ratelimit:*` setup reset.
      const knownPin = knownPins[profile.id];
      if (profile.has_pin && !knownPin) {
        await setProfilePin(token, profile.id, account.password, null);
      }
      const result = await deleteProfile(token, profile.id, knownPin);
      if (result.access_token) token = result.access_token;
    } catch (e) {
      console.log(
        `[helpers] could not delete profile ${profile.name}: ${String(e).slice(0, 120)}`,
      );
    }
  }
  // Surface leftovers instead of hiding them: a silently-kept profile breaks
  // the next run's "at limit" precondition.
  const remaining = (await listProfiles(token)).items.filter(
    (profile) => !profile.is_default,
  );
  if (remaining.length > 0) {
    console.log(
      `[helpers] ${remaining.length} profile(s) left behind: ${remaining
        .map((profile) => profile.name)
        .join(", ")}`,
    );
  }
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
