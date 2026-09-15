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

## 2026-09-15 — Phase 6 player

29. **Dual-mode player (iframe primary).** Embed pages contain no extractable
    m3u8 (5KB JS-player shell), so reverse-engineering direct streams was
    rejected as fragile. hls.js path stays code-split on `/xem` for when
    `m3u8_url` appears.
30. **`notFound()` returns 200 on streamed routes — documented Next.js
    behavior** (root `loading.tsx` forces streaming; noindex still injected).
    Verified via isolation route; not a bug, no workaround applied.
31. **Unload save uses keepalive fetch, not sendBeacon** (beacon can't set
    `Authorization` headers).
32. **`.next/cache` chown'd to appuser** in Dockerfile.web (fixed EACCES
    prerender-cache writes as non-root).
33. **Watched = progress ≥90% of known duration** (+ explicit POST marker for
    embed mode stored as a completed 1s/1s row).

## 2026-09-15 — Phase 7 production packaging

34. **Postgres service renamed `postgres` → `db`** (matches spec; volume data
    kept under the same `pgdata` volume name).
35. **API entrypoint runs `alembic upgrade head` then execs uvicorn**
    (`docker/entrypoint-api.sh`); workers via `UVICORN_WORKERS` (default 2,
    dev override pins 1 for `--reload` compatibility).
36. **nginx terminates :80** (`/` → web, `/api/*` + `/health` → api) with basic
    security headers; direct ports stay exposed for debugging.
37. **`NEXT_PUBLIC_API_URL` is a build ARG** (baked into client bundle);
    server-side calls use runtime `BACKEND_URL`. Documented in README.
38. **Dev override uses builder target + bind mounts** (anonymous volumes keep
    container `node_modules`); nginx disabled in dev via `prod` profile.

## 2026-09-15 — Phase 8 hardening & handoff

39. **Login brute-force guard: 5 failures / 15 min / IP** (Redis counter,
    fail-open; success clears). Only failures count, correct logins always pass.
40. **CI gates everything**: ruff + pytest (unit) + web lint/typecheck/build +
    both image builds. Integration tests (`-m integration`) excluded from CI.
41. **Lighthouse measured, not guessed**: home 93, detail 95 (target ≥85) via
    headless Chromium; hero `fetchPriority=high` + preconnect to image origin.
42. **Leftover debt logged in `docs/todo.md`** instead of being silently dropped
    (register throttling, token-family reuse detection, sitemap, TLS, backups).

## Batch 2 — register throttling, enforced secrets, TLS

43. **Register throttle đếm tài khoản tạo thành công** (3/giờ, 10/ngày/IP),
    không đếm request lỗi — đúng chữ "3 tài khoản". Honeypot `website` trả 400
    `BOT_DETECTED` công khai (theo spec "từ chối", không fake-201).
44. **`X-Forwarded-For` chỉ tin khi peer thuộc `TRUSTED_PROXIES`** (mặc định
    private + loopback, bao trùm nginx compose 172.x). Spoof từ IP public bị
    bỏ qua, dùng peer IP.
45. **Production guard chết ngay lúc import settings** (SystemExit qua
    `_load_settings`), kiểm tra cả default lẫn độ dài <32 cho JWT_SECRET và
    POSTGRES_PASSWORD. Dev hoàn toàn không ảnh hưởng.
46. **Prod compose dùng `${VAR:?}`** — thiếu secret là compose báo lỗi ngay,
    không boot nửa vời. Certbot chạy tay (first: standalone, renew: webroot +
    cron host) vì auto-certonly mỗi lần `up` sẽ dính rate limit Let's Encrypt.
47. **TLS template dùng `$$` escape cho envsubst**; CSP cơ bản vẫn giữ
    `'unsafe-inline'` cho script/style (Next cần) — ghi nợ thắt chặt bằng
    nonce ở `docs/todo.md`.

## Batch 3 — backups, token cleanup, atomic refresh

48. **Refresh rotation is one transaction** (revoke-old + issue-new share a
    single commit, explicit rollback in `except`). Proven by breaking the
    signer mid-rotation in tests: the old token stays usable.
49. **Cleanup token chạy in-process (APScheduler) + Redis lock** thay vì cron
    container riêng — ít moving part hơn; lock `SET NX EX` chống chạy trùng
    giữa các uvicorn workers. Index `expires_at` (migration 3).
50. **Backup sidecar chạy root** (volume mới root-owned, UID host không ghi
    được); file 644 nên host vẫn đọc/copy được, mọi thao tác qua container.
51. **Dump dùng `--clean --if-exists`** để restore được cả vào DB đã có schema
    (ghi đè), không bắt buộc DB trống.
