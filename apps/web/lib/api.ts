"use client";

import { ApiError, parseApiError } from "./errors";

// Access token lives only in memory (never localStorage).
let accessToken: string | null = null;
// Mutex: concurrent 401s share a single refresh call.
let refreshPromise: Promise<string | null> | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

async function doRefresh(): Promise<string | null> {
  const res = await fetch("/api/auth/refresh", { method: "POST" });
  if (!res.ok) {
    setAccessToken(null);
    return null;
  }
  const data = (await res.json()) as { access_token: string };
  setAccessToken(data.access_token);
  return data.access_token;
}

function refreshOnce(): Promise<string | null> {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => {
      refreshPromise = null;
    });
  }
  return refreshPromise;
}

export interface ApiOptions extends RequestInit {
  auth?: boolean;
}

// Session failures the backend emits with HTTP 401 that a refresh can recover:
// UNAUTHORIZED (deps.py) for expired/invalid access tokens, INVALID_REFRESH_TOKEN
// for a dead refresh token, and SESSION_STALE for an old access token missing
// `sid`. A business 401 such as INVALID_PIN must surface as-is instead (no
// double submit, no refresh-cookie rotation on a PIN typo).
const TOKEN_FAILURE_CODES = new Set([
  "UNAUTHORIZED",
  "INVALID_REFRESH_TOKEN",
  "SESSION_STALE",
]);

async function isTokenFailure(res: Response): Promise<boolean> {
  if (res.status !== 401) return false;
  try {
    const body = (await res.clone().json()) as { code?: unknown };
    return typeof body.code === "string" && TOKEN_FAILURE_CODES.has(body.code);
  } catch {
    return false;
  }
}

export async function apiFetch<T>(
  path: string,
  { auth = true, headers, ...init }: ApiOptions = {},
): Promise<T> {
  // Same-origin: /api/v1/* is proxied to the backend by the
  // app/api/v1/[...path] Route Handler. No client-side base URL.
  const request = async (token: string | null): Promise<Response> =>
    fetch(path, {
      ...init,
      headers: {
        ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
        ...(token && auth ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
    });

  let res = await request(accessToken);
  if (auth && (await isTokenFailure(res))) {
    const fresh = await refreshOnce();
    if (!fresh) {
      throw new ApiError(401, "UNAUTHORIZED", "Bạn cần đăng nhập để tiếp tục.");
    }
    res = await request(fresh);
  }
  if (!res.ok) {
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    throw parseApiError(res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
