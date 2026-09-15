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
      .then((d) => {
        const url =
          (typeof d?.apiUrl === "string" && d.apiUrl.trim()) || FALLBACK;
        if (d?.isDefault) {
          console.warn(
            `[gmov] PUBLIC_API_URL is not set — API calls fall back to ${FALLBACK}. ` +
              `If your backend runs elsewhere, restart the web server with e.g. ` +
              `PUBLIC_API_URL=http://localhost:8008`,
          );
        }
        return url;
      })
      .catch(() => FALLBACK);
  }
  return promise;
}

/** Warm the cache once at app startup (fire-and-forget). */
export function warmRuntimeConfig(): void {
  void getApiUrl();
}
