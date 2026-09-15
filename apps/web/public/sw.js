/* gmov app-shell service worker (hand-rolled, no dependency).
 *
 * - Offline-first for same-origin static assets (_next/static, fonts).
 * - Network-first for navigations, falling back to the cached /offline page.
 * - NEVER touches: cross-origin requests, /api/*, media playlists/segments
 *   (.m3u8/.mp4/.ts/.m4s), or Range requests (video streaming).
 */
const VERSION = "gmov-shell-v1";
const STATIC_CACHE = `${VERSION}-static`;
const PAGES_CACHE = `${VERSION}-pages`;
const OFFLINE_URL = "/offline";

const MEDIA_RE = /\.(m3u8|mp4|m4s|ts|webm)(\?|$)/i;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGES_CACHE)
      .then((cache) => cache.add(OFFLINE_URL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("gmov-shell-") && k !== STATIC_CACHE && k !== PAGES_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isCacheableStatic(req) {
  try {
    const url = new URL(req.url);
    return (
      url.origin === self.location.origin &&
      (url.pathname.startsWith("/_next/static/") ||
        url.pathname === "/icon.svg" ||
        url.pathname === "/manifest.webmanifest")
    );
  } catch {
    return false;
  }
}

function isBypassed(req, url) {
  if (req.method !== "GET") return true;
  if (url.origin !== self.location.origin) return true; // embeds, images, streams
  if (url.pathname.startsWith("/api/")) return true;
  if (MEDIA_RE.test(url.pathname)) return true;
  if (req.headers.has("range")) return true;
  return false;
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }
  if (isBypassed(request, url)) return; // let the network handle it

  if (isCacheableStatic(request)) {
    // Cache-first for immutable build assets.
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ??
          fetch(request).then((res) => {
            const copy = res.clone();
            caches.open(STATIC_CACHE).then((c) => c.put(request, copy));
            return res;
          }),
      ),
    );
    return;
  }

  if (request.mode === "navigate") {
    // Network-first for pages, offline fallback (never cache HTML pages:
    // catalog content changes constantly).
    event.respondWith(
      fetch(request).catch(() => caches.match(OFFLINE_URL)),
    );
  }
});
