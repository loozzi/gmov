# Architecture decisions

Log ambiguous decisions here (Phase 0+). Newest last.

## 2026-09-15 — Phase 0 bootstrap

1. **No questions asked for trivial choices.** Per project instructions, the agent
   picks the most common option and records it here.
2. **Upstream identity = `slug`.** List items have no `id`; only detail has one.
   All user data (favorites, history, progress) keys by `slug`.
3. **Backend proxies + caches NguonC; frontend never calls NguonC directly.**
   Reason: single place for caching (Redis), timeout/retry, schema normalization,
   and hiding upstream flakiness. Cache key `nguonc:{path}:{query}`, TTL ~1h.
4. **JWT auth with PyJWT (HS256), no email verification.** Matches product spec
   (plain username/password accounts). `passlib[bcrypt]` for password hashing.
   (Known risk: passlib 1.7.4 vs bcrypt>=4.1 incompatibility — pin/evaluate in
   the auth phase; alternative is `pwdlib`.)
5. **Tailwind CSS v4 (`@import "tailwindcss"`) from day one.** shadcn/ui,
   TanStack Query, zustand, hls.js land in their feature phases, not Phase 0.
6. **pnpm workspace, single `pnpm-lock.yaml` at root; `uv.lock` committed for
   `apps/api`.** Both lockfiles are committed for reproducible Docker builds.
7. **Docker multi-stage for both apps; `docker-compose.yml` works with zero
   config** (sane `VAR:-default` fallbacks, `.env` optional). `nginx` deferred
   to a later hardening phase.
8. **`episodes[].server_data` observed empty on 2026-09-15.** Episode/stream
   parsing stays TBD until re-probed in the player phase; parser must handle
   empty lists. No stream field names invented.

## 2026-09-15 — Phase 1 auth

9. **Env renamed to spec:** `JWT_SECRET_KEY`/`JWT_EXPIRE_MINUTES` → `JWT_SECRET`,
   `ACCESS_TOKEN_EXPIRE_MINUTES=30`, `REFRESH_TOKEN_EXPIRE_DAYS=30`, plus
   `CORS_ORIGINS` (CSV, parsed with `NoDecode`). Compose + `.env.example`
   updated in the same change.
10. **Login = OAuth2 form** (`username` accepts email or username), per user
    choice — Swagger Authorize compatible; frontend posts form data.
11. **Refresh rotation ON**, revocation via **`refresh_tokens` DB table**
    (not Redis blacklist): durable, testable on sqlite; logout is idempotent.
12. **bcrypt pinned `>=4.0.1,<4.1`** — last version with `__about__`, required
    by passlib 1.7.4. Verified hash/verify in tests.
13. **`/me` lives under `/users`** (`/api/v1/users/me`), auth actions under
    `/api/v1/auth/*`. `/health` always HTTP 200 with per-component status.

## 2026-09-15 — Phase 2 movies + cache

14. **Re-probed episodes: servers use `items: [{name, slug, embed}]`** (not
    `server_data`); parser accepts both keys. No `link_m3u8` exists upstream —
    only `embed.php` page URLs — so our schema exposes `embed_url` +
    nullable `m3u8_url` instead of inventing stream fields.
15. **Stale-on-error**: fresh key (TTL 5/10/30 min) + `:stale` copy (24h);
    upstream failure serves stale with `X-Cache: STALE`, else 502.
    `invalidate()` is code-only, no public endpoint (avoids unauthenticated
    cache purges).
16. **Tests mock httpx via respx + redis via fakeredis** (fakeredis>=2.23 for
    redis-py 5.x compat); one `@pytest.mark.integration` test hits the real API.

## 2026-09-15 — Phase 3 library

17. **No `watch_history` table.** `watch_progress` rows already capture
    movie/episode/timestamp, so history and continue-watching are queries over
    one table (latest-episode-per-movie via `ROW_NUMBER()` partition). Avoids
    dual-write inconsistency.
18. **Progress rate limit 20 req/min/user** (Redis fixed window, fail-open).
    Matches player heartbeat every 15s with headroom for seeks.
19. **`updated_at` set explicitly in Python on upsert** (not only DB default):
    sqlite `CURRENT_TIMESTAMP` has 1-second precision, causing ties that broke
    latest-per-movie ordering; UUID PKs can't break ties (random order).
20. **Validation errors are JSON-sanitized** (`jsonable_encoder`): raw
    `exc.errors()` contains non-serializable `ValueError` in `ctx`.

## 2026-09-15 — Phase 4 web shell

21. **Access in memory, refresh in httpOnly cookie** via Next Route Handlers
    (backend stays the only JWT issuer; rotation preserved). 401 → single
    mutex-guarded refresh + one retry.
22. **Dark-first, rose accent** (`#e11d48`) as Tailwind v4 `@theme` vars;
    shadcn-style hand-rolled primitives (no CLI) to keep the Docker build lean.
23. **pnpm `allowBuilds: unrs-resolver: true`** committed — pnpm v12 blocks
    installs otherwise (`ERR_PNPM_IGNORED_BUILDS` broke the Docker build).
24. **eslint pinned to v9** (v10 breaks `eslint-config-next@15`'s rushstack
    patch); lint via flat `FlatCompat` config.
25. **Route handlers use `BACKEND_URL`** (`http://api:8000` in compose) since
    `localhost` inside the web container is wrong; browser calls still use
    `NEXT_PUBLIC_API_URL`.

## 2026-09-15 — Phase 5 content pages

26. **Browse pages are `force-dynamic`, not pre-rendered.** Docker build has no
    backend, so static prerender would bake EMPTY grids until revalidation.
    SSR-on-request keeps SEO (full HTML) with fresh data; backend Redis cache
    absorbs the load. Detail keeps `revalidate=1800` (dynamic route).
27. **Search moved `/search` → `/tim-kiem`** per spec (old path 307-redirects).
28. **`/xem/[slug]/[episode]` links are dead until Phase 6** (player) —
    accepted per phasing; detail/resume/history all point there.
