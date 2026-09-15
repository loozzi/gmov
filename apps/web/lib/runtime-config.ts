"use client";

const FALLBACK = "http://localhost:8000";

let promise: Promise<string> | null = null;

/**
 * Backend base URL resolved at RUNTIME via /api/config (cached process-wide
 * after the first call). Never bake API URLs into the client bundle.
 */
export function getApiUrl(): Promise<string> {
  if (!promise) {
    promise = fetch("/api/config", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (d) =>
          (typeof d?.apiUrl === "string" && d.apiUrl.trim()) || FALLBACK,
      )
      .catch(() => FALLBACK);
  }
  return promise;
}

/** Warm the cache once at app startup (fire-and-forget). */
export function warmRuntimeConfig(): void {
  void getApiUrl();
}
