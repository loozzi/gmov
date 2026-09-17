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

## Batch 4 — Playwright E2E (phát hiện 2 bug thật, đã sửa code)

52. **Refresh boot dedupe phía client** (`bootPromise` module-level +
    cancelled flag): StrictMode double-mount/dev remount bắn 2 silent refresh
    cùng cookie → rotation đốt token của request thua → bay session oan.
53. **Rotation grace 30s phía server**: token vừa revoke xong mà được trình lại
    trong 30s → re-issue thay vì 401 (duplicate delivery, không phải theft).
    Đánh đổi có ý thức: phát hiện trộm thật (reuse muộn) vẫn là việc tương lai
    (todo #2). **Logout thì DELETE row** (không revoke) để có hiệu lực ngay,
    không dính grace.
54. **Không dùng storageState chung cho E2E**: rotation đốt cookie lần đầu nên
    file cookie tĩnh chỉ đúng cho đúng 1 test — mỗi spec tự login qua route
    handler (`loginViaApi`).
55. **Trang harness `/e2e/player` chỉ tồn tại ở dev** (`notFound()` khi
    production): dựng MovieDetail giả với m3u8 mẫu công khai để test đường HLS
    resume — episode upstream thật chỉ có embed (Batch 1 verdict C đứng vững).
56. **CORS defaults mở rộng** (`:3100`, `127.0.0.1`) cho dev/E2E — prod override
    qua env như cũ. E2E bắt được lỗi này ở lần chạy đầu (preflight fail).
57. **Resume effect "quyết định đúng 1 lần/episode"** + seek retry tới 8 lần +
    reset state khi đổi tập: heartbeat refetch trước đây remount player giữa
    lúc đang xem (giật về 0s), seek một phát có thể rơi vào lúc chưa có
    duration. Chỉ lộ ở đường HLS — đường embed không bao giờ thấy.

## Batch 5 — sitemap, runtime config, a11y, PWA

58. **Sitemap lấy 100 trang latest upstream (concurrency 5), dừng sớm khi batch
    rỗng/lỗi** — chịu được upstream chập chờn, revalidate 6h. `/xem/` disallow
    trong robots (player nhúng, nội dung mỏng, tiết kiệm crawl budget).
59. **Runtime config qua `/api/config` (no-store) + cache promise phía client**,
    warm 1 lần ở Providers. `sendProgressKeepalive` thành async (caller
    fire-and-forget sẵn nên tương thích). Fallback localhost khi fetch fail.
60. **Combobox đúng chuẩn ARIA 1.2**: `role=combobox` trên input +
    `listbox/option` + `aria-activedescendant`; Enter khi chưa highlight thì
    submit form như cũ (không cướp hành vi).
61. **PWA tối giản, không dependency**: SW hand-rolled chỉ cache shell
    (`_next/static`, icon, manifest) + fallback `/offline` cho navigation;
    bypass tuyệt đối cross-origin/API/media/Range. Đăng ký SW chỉ ở production.
    OG image vẽ bằng JSX (ImageResponse), không dùng poster phim.

## Fix: frontend dev trỏ nhầm port API

62. **Triệu chứng**: API chạy `:8008`, web dev `:3001`, browser gọi API ở port
    của web. Điều tra bằng headless Chromium ghi lại mọi request cho thấy sự
    thật có 2 phần: (a) `/api/auth/*` + `/api/config` cùng origin là ĐÚNG
    (httpOnly cookie bắt buộc same-origin); (b) data call rơi về fallback
    `:8000` (chết) vì `PUBLIC_API_URL` chưa từng được set — KHÔNG phải bug
    code mà là thiếu config, và console im lặng khiến user đoán sai.
63. **Sửa**: `/api/config` trả thêm `isDefault`, client `console.warn` hướng dẫn
    cụ thể khi rơi vào fallback + README ghi rõ lệnh dev với port tùy chỉnh.
    Không đoán port, không magic probe.
64. **Tái phát với split-brain 2 biến**: browser (`PUBLIC_API_URL=:8008`) OK
    nhưng SSR (`server-movies.ts`) + auth handlers (`lib/server.ts`) dùng
    `BACKEND_URL` (unset → fallback `:8000` chết) → homepage 5 `fetch failed`,
    login 502. Hai biến độc lập = hai sự thật độc lập.
65. **Xóa cơ chế 2 biến, single-origin thật**: browser chỉ gọi relative
    `/api/v1/*`, Route Handler `app/api/v1/[...path]/route.ts` proxy streaming
    server-side tới `BACKEND_URL` (đọc per-request = runtime thật). `rewrites()`
    trong next.config KHÔNG làm được việc này — destination bị bake vào
    routes-manifest.json lúc build (đã chứng minh: build với `:9`, chạy với
    `:8008` vẫn đập vào `:9`). Xóa `/api/config`, `runtime-config.ts`,
    `PUBLIC_API_URL` khỏi mọi compose/script/doc; còn đúng 1 biến `BACKEND_URL`.

## Fix: dark/light mode

66. **Class-based dark mode cho Tailwind v4** (`@custom-variant dark` +
    token sáng ở `:root`, token tối trong `.dark` — utilities dùng var() nên
    tự đổi màu, không sửa từng component). **Provider tự viết, không thêm
    `next-themes`**: localStorage `gmov-theme`, mặc định theo
    `prefers-color-scheme` (fallback dark), tự bám OS khi user chưa chốt,
    script inline chống FOUC + `suppressHydrationWarning` ở `<html>`.
    Nút toggle Sun/Moon ở header cạnh avatar.

## Feature: watchlist "Muốn xem" tách khỏi yêu thích

67. **Hai ý định khác nhau, hai bảng khác nhau**: `watchlist` mirror
    `favorites` (không gộp thành bảng "saved" + type — query đơn giản hơn,
    không migration dữ liệu cũ). **Bắt đầu xem thì tự rớt khỏi watchlist**:
    `progress_service.upsert` xóa row watchlist cùng commit (cả đường PUT
    progress lẫn marker `/watched` đều trúng, vài giây sau khi bấm Xem ngay
    chứ không phải lúc click). Triển khai theo TDD: test RED trước
    (`test_watchlist_flow`, `test_progress_upsert_removes_from_watchlist`),
    migration thử lên/xuống trên sqlite. E2E `library.spec` + teardown dọn
    thêm watchlist;     full suite 10/10.

## Feature: bình luận + đánh giá sao (subagents)

68. **Hai bảng riêng (`ratings` + `comments`), không gộp**: chấm sao không
    cần viết bình luận và ngược lại; gộp thành `reviews` unique(user, phim)
    sẽ giết thảo luận. Reply đúng 1 cấp (DB cho phép cây đầy đủ nhưng API
    từ chối reply-của-reply 422; xóa dùng BFS trong service để đúng cả trên
    sqlite-test lẫn Postgres cascade). Điểm TB tính live, không cache.
    Đọc public (tốt cho SEO/khách), viết cần login + rate-limit riêng
    10/phút. Triển khai bằng 2 subagent song song (backend TDD / frontend)
    trên contract đóng băng — backend 50 pass, e2e library 4/4.
69. **KNOWN-FAIL (pre-existing, không phải do feature này)**:
    `e2e/player.spec.ts` "play 20s → reload → resume" fail 4 lần liên tiếp
    (`expected ~20s, got 0`, toast "Đã tiếp tục từ" vẫn hiện). Đã chứng minh
    không phải regression: stash toàn bộ backend-diff → vẫn fail y hệt;
    probe riêng (seed progress 60s → load harness) seek đúng tới 67s đang
    phát; stream mẫu nhanh (0.2s); máy rảnh (load ~2/6 cores); browser
    không đổi. Nghi vấn còn lại: assert đọc clock ngay sau toast nên thua
    race với seek, hoặc startedRef latch — cần buổi debug riêng, KHÔNG sửa
    player/test trong PR reviews để tránh scope creep.

## Trang chủ phong cách Netflix (ui-ux-pro-max)

70. **Design system đã verify**: query 1 ("movie streaming vibrant")
    trả về style sáng không hợp → retry 1 lần theo skill, query 2
    ("video streaming dark cinematic") cho Hero-Centric + Dark OLED
    (bg `#000`, card `#0c0c0d`, accent red `#E11D48`, Inter) — khớp
    Netflix nên áp dụng. Dark token nudge về gần đen thuần; light mode
    giữ nguyên. Không dùng badge chữ "N" đỏ (nhái brand Netflix) —
    dùng "G" (gmov). Hero full-bleed bằng negative margin (`-mx-4 -mt-6`)
    thay vì sửa layout (tránh ảnh hưởng các trang khác); rails overlap
    hero (`-mt-20`). Auto-rotate tôn trọng `prefers-reduced-motion`.
    Light mode mặc định theo OS (screenshot headless ra sáng là đúng,
    không phải bug). Verify: typecheck + build pass, screenshot
    dark/light đạt.

## Feature: kiểm duyệt bình luận (comment moderation)

71. **`Enum(native_enum=False)` cho `role`/`reason`/`status`** — dùng chung
    một định nghĩa chạy được cả SQLite (test) lẫn Postgres (prod), không tạo
    PG enum type nên Alembic không cần migration kiểu dữ liệu. Kèm
    `values_callable` để lưu đúng **value** (`"user"`, `"open"`) chứ không
    phải tên member — bug này lộ ra ở test và được sửa riêng (32cb61a).
72. **Auto-hide giữ báo cáo `open`** để moderator vẫn phải duyệt; chính thao
    tác hide thủ công mới resolve toàn bộ báo cáo `open` của bình luận đó
    (cùng một commit). Unhide không hồi sinh báo cáo đã resolved.
73. **Gate `/admin` chỉ là defense-in-depth ở UI** (client layout kiểm role,
    `middleware.ts` chỉ redirect theo cookie) — thẩm quyền thật nằm ở
    FastAPI `require_role("moderator","admin")`: 401 khi thiếu token, 403
    `FORBIDDEN` khi đủ danh tính nhưng thiếu quyền.
74. **`GET /comments` dùng optional auth** (`get_optional_user`) để một
    endpoint phục vụ cả khách ẩn danh lẫn moderator: token thiếu/sai → ẩn
    danh (không bao giờ 401), chỉ `moderator`/`admin` thấy `body` của bình
    luận đã ẩn. Tránh nhân đôi route hoặc bắt khách phải đăng nhập.

## Hardening & debt — 2026-09-16

75. **Refresh-token reuse detection theo `family_id` + cờ `compromised`**:
    mỗi login mở một family (`uuid4`), rotation giữ nguyên family. (Register
    không cấp refresh token/family — chỉ login mới mở phiên.) Token đã revoke
    trình lại **trong grace 30s** vẫn là duplicate delivery (boot/tab đua
    nhau) nên re-issue; **quá 30s** là theft → `_revoke_family` revoke mọi
    token còn sống của family và đặt `compromised=true`, trả 401
    `INVALID_REFRESH_TOKEN`. Cờ `compromised` cần vì cửa sổ grace 30s: một
    member vừa bị `_revoke_family` revoke nếu chỉ dựa vào `revoked_at` sẽ rơi
    vào nhánh grace và được re-issue — `compromised` buộc mọi lần trình sau đó
    thất bại thẳng, không qua grace. Migration backfill `family_id = id` cho
    row cũ rồi set NOT NULL + index.
76. **Login brute-force key đổi sang `ip + username`**
    (`ratelimit:login-fail:{ip}:{sha256(username.lower())[:16]}`, kèm bucket
    chặn trần theo IP `ratelimit:login-fail:ip:{ip}` ~20 lần/15 phút): bucket
    IP-only khiến nhiều người sau cùng một NAT chia sẻ hạn mức 5 lần/15 phút
    (một người gõ sai khoá cả lớp). Tách theo username vẫn chặn được
    brute-force một tài khoản; username băm/truncate để không mở khoá Redis vô
    hạn, còn bucket IP giữ trần tổng khi kẻ tấn công thử nhiều username.
    `check`/`record` nhận `(ip, username)`, `clear` chỉ xoá bucket tổ hợp.
77. **`reported` là field batch trên `GET /comments`** thay vì gọi
    `GET /me/reports/{id}/status` cho từng bình luận: khi đã đăng nhập,
    `comment_service.list_paginated` load một query tập `comment_id` mà viewer
    đã báo cáo cho đúng các id sắp trả về (không N+1), ẩn danh luôn `false`.
    Endpoint status giữ nguyên để tương thích; frontend bỏ `useReportStatus`
    và invalidate comments query sau khi báo cáo thành công.
78. **Tách `routers/reports.py` + `components/movies/comment-item.tsx` +
    `components/ui/dialog.tsx`**: hai route report rời `me.py` sang router
    riêng (`prefix="/me"`, path không đổi) cho dễ đọc; `CommentItem`/
    `ReplyItem`/`CommentBody` rời `comment-section.tsx`; dialog Radix dùng
    chung được `report-dialog` tái sử dụng. Refactor thuần, không đổi hành vi.

## Moderation polish round 2 — 2026-09-16

79. **`me.py` tách tiếp thành `progress.py` + `collections.py` + `reviews.py`**
    (giữ nguyên `prefix="/me"` nên toàn bộ path/status không đổi): taxonomy
    theo miền nghiệp vụ — `progress` (playback/heartbeat/continue-watching/
    watched), `collections` (favorites + watchlist, cùng shape add/list/
    status/delete), `reviews` (ratings + comments). Router cũ 312 dòng bị xóa;
    `__init__.py` include 4 router `/me` cạnh nhau. Refactor thuần; đường dẫn
    được các HTTP test sẵn có bao phủ (không có test parity riêng).

80. **Refresh khóa cả family TRƯỚC khi đánh giá**: lookup `jti` không khóa chỉ
    để lấy `family_id`, rồi khóa cả family bằng một `SELECT ... WHERE
    family_id ORDER BY RefreshToken.id FOR UPDATE` (`populate_existing`) và
    đánh giá `revoked_at`/grace/`compromised` trên chính set đã khóa đó. Tránh
    hẳn thứ tự hai lock (khóa một row theo `jti` rồi mới khóa family) vốn để
    hai request đồng thời cùng family khóa ngược thứ tự → deadlock Postgres.
    Không dùng advisory lock (test chạy SQLite); migration/constraint parity
    đã có test chốt.

81. **Optimistic "Đã báo cáo" giữ dialog mounted**: trigger và `ReportDialog`
    render cùng nhau (không early-return thay cả nút) nên `isPending` vẫn hiện
    UI chờ và lỗi mạng giữ nguyên `reason`/`note` người dùng đã nhập; nút
    chuyển disabled "Đã báo cáo" khi `reported || isPending || isSuccess` và
    tự revert khi mutation fail. `onError` type `unknown` đúng chữ ký TanStack
    Query.

82. **`isPlaceholderData` thay `isFetching` cho affordance bảng cũ**
    (`comment-section` + `admin/reports`): chỉ mờ/`aria-busy`/khóa phân trang
    khi dữ liệu đang hiển thị là placeholder của trang trước, tránh nháy mờ
    khi background refetch trả về cùng data. Spinner trang trí gắn
    `aria-hidden`; `useReportComment(movieSlug)` scope invalidation xuống
     `["reviews","comments",movieSlug]` thay vì toàn bộ comments; `ui/dialog.tsx`
     bỏ export không dùng (`DialogTrigger`/`DialogClose`/portal/overlay giữ nội
     bộ), `report-dialog` tái sử dụng không cần chúng.

## Sửa lỗi lịch sử ở chế độ embed — 2026-09-16

83. **"Xem tiếp" phải theo tập vừa mở, không kẹt ở tập 1**: effect embed trước
    đây upsert khi phim CHƯA có progress nào (`savedProgress`) + ref một lần,
    nên sau tập 1 không tập nào ghi thêm → `continue-watching` luôn trả tập 1.
    Nay đăng ký theo TẬP HIỆN TẠI: bỏ qua nếu tập đó đã là row mới nhất
    (`savedProgress.episode_slug === episodeSlug`) hoặc mang marker "đã xem"
    (row 1s/1s — không được ghi đè bằng 0s/0s), chỉ ghi khi danh sách watched
    đã tải xong, và reset ref theo từng tập. Backend không đổi
    (`_latest_per_movie_stmt` vốn đúng). Chốt bằng E2E `embed-history.spec.ts`
    qua harness dev-only `/e2e/embed` (không phụ thuộc upstream).

## Tiến độ theo tập — 2026-09-16

84. **Lưu vị trí tập (`episode_index`/`total_episodes`) trên progress**: hai cột
    nullable trên `watch_progress`, scope theo SERVER đang chọn (không theo flat
    list nhiều server) để không thổi phồng M. Embed không có playtime nên "xem
    đến đâu" ở chế độ embed = tập hiện tại; row cũ `NULL` → UI fallback như trước.
    Không backfill (giá trị điền ở lần ghi kế tiếp).

## Lớp chuyển động (motion) — 2026-09-16

85. **Motion CSS-first, không thêm dependency**: token easing + `@keyframes`
    khai báo trong `@theme` của `app/globals.css`, dùng qua utility
    `animate-*`. Không thêm `framer-motion`/`gsap` vì phần lớn chuyển động cần
    thiết (overlay vào/ra, reveal, shimmer) là khai báo được bằng CSS, repo vốn
    CSS-first, và như vậy không đổi lockfile/bundle. Chi tiết:
    `docs/superpowers/specs/2026-09-16-motion-design.md`.
86. **Reset `prefers-reduced-motion` toàn cục** thay vì override từng animation:
    đặt `animation-duration`/`transition-duration` về `1ms` + `animation-delay:
    0` cho mọi phần tử. Mọi animation kết thúc ở trạng thái cuối ổn định nên nội
    dung luôn hiển thị; giữ được tiền lệ cũ (`hero-fade`) mà không phải nhớ
    override cho từng cái mới.
87. **`Reveal` (IntersectionObserver) không bao giờ ẩn nội dung khi thiếu JS**:
    render mặc định hiển thị, chỉ ẩn SAU mount và chỉ với phần tử nằm dưới màn
    hình, bỏ qua hoàn toàn khi bật giảm chuyển động. Tránh rủi ro nội dung
    "mất tích" nếu JS lỗi hoặc observer không chạy.
88. **`app/template.tsx` cho page transition, chỉ animate `opacity`**: template
    remount mỗi lần điều hướng (đúng chỗ để chạy entrance). Cố ý không dùng
    `transform` ở đây vì transform trên ancestor sẽ tạo containing block cho
    header `sticky` và các portal `fixed`.
89. **Keyframe dialog mang theo `translate(-50%, -50%)`**: dialog căn giữa bằng
    utility translate, nên nếu keyframe zoom chỉ set `scale()` sẽ ghi đè mất
    translate; `dialog-in/out` giữ nguyên cặp translate trong mọi frame.
90. **`toaster` thêm trạng thái `closing`**: toast giữ mounted thêm ~180ms để
    chạy `toast-out` rồi mới xoá (kèm `onAnimationEnd` làm lưới an toàn), thay
    vì biến mất tức thì.

## Tiến độ xem cho khách (localStorage) — 2026-09-17

91. **Local là store một-writer, `useSyncExternalStore` là cầu nối React**:
    `lib/guest-progress.ts` giữ cache module-level (snapshot ổn định — bắt buộc
    để không lặp render vô hạn) và chỉ nó được ghi `localStorage`; component
    không bao giờ chạm localStorage trực tiếp. Key có version (`gmov:progress:v1`)
    để đổi shape không cần migrate; cap 50 entry mới nhất theo `updated_at` và
    mọi lỗi (JSON hỏng, private mode, quota) degrade thành store rỗng.
92. **Gộp một chiều khi đăng nhập, server thắng khi mới hơn hoặc bằng**: entry
    local chỉ được PUT khi server chưa có phim đó hoặc `updated_at` local mới
    hơn; xoá local SAU khi ghi thành công; gặp 429/lỗi mạng thì dừng vòng lặp
    (giữ phần còn lại cho lần sau) thay vì đốt rate limit 20/phút. Log out không
    khôi phục local — đây là hành vi "gộp", không phải hai store song song.
    Gộp chạy ở module-level promise (`GuestProgressMerge`) để StrictMode remount
    không ghi hai lần.
93. **Không lưu "watched markers" theo tập cho khách ở v1**: chỉ progress
    (position/duration/last episode). Dấu ✓ trong EpisodeGrid là trạng thái
    server-only; guest đăng nhập rồi xem tiếp thì các dấu tự sinh lại. Giữ phạm
    vi store ở một khái niệm duy nhất, tránh merge phức tạp cho giá trị nhỏ.
94. **Eslint bỏ qua `playwright-report/**` + `test-results/**`**: đây là artifact
    sinh bởi Playwright (đã gitignore) nhưng `eslint .` vẫn quét và báo hàng nghìn
    lỗi trên file minified, làm `pnpm lint` fail sau mỗi lần chạy E2E.

## Duyệt phim: cuộn vô tận + quick switch — 2026-09-17

95. **Client island nhận `initialData` từ SSR, không bỏ SSR**: `BrowseGrid` chạy
    `useInfiniteQuery` với `initialData` = trang do server component fetch sẵn,
    nên trang 1 vẫn nằm trong HTML trả về (indexable, LCP như cũ) và không bị
    refetch lại (staleTime mặc định 60s). Đánh đổi: First Load JS các trang duyệt
    +~23 kB (113 → 136 kB); chấp nhận vì trước đó các trang này gần như không có
    JS tương tác và cuộn vô tận cần TanStack Query ở client.
96. **Giữ `?page=N` làm điểm vào + nút "Xem thêm" là `<a>` thật**: cuộn vô tận
    không cập nhật URL (không history replace — tránh tranh chấp back/forward).
    `?page=N` vẫn render trang N làm trang bắt đầu rồi cuộn tiếp; nút dự phòng
    giữ `href="?page=N+1"` nên no-JS và crawler vẫn đi được các trang sau, kèm
    `onClick` chuyển sang `fetchNextPage()` khi có JS.
97. **Khử trùng theo `slug` khi gộp các trang**: thứ tự upstream có thể dịch giữa
    hai request nên cùng một phim có thể xuất hiện ở 2 trang; giữ lần xuất hiện
    đầu để tránh key React trùng (repo từng dính lỗi này) và tránh nhảy layout.
98. **`/tim-kiem` không keyword không render grid**: island sẽ fetch
    `keyword=&page=1` từ client, tức một request vô nghĩa; page chặn trước và chỉ
    hiện lời nhắc. Trước đây nhánh này rơi vào trạng thái "Không tải được dữ liệu"
    (sai ngữ nghĩa) nên đây cũng là sửa lỗi nhỏ.
99. **Quick switch = hàng chip sticky, không phải dropdown**: `sticky top-16`
    khớp header `h-16`/`z-40` (`z-30` cho chip), nguồn chip suy ra từ `BrowseSource`
    (`browseChips`) nên không cần state client; điều hướng bằng `<Link>` để server
    page render lại như bình thường.

## Phim liên quan trên trang chi tiết — 2026-09-17

100. **Related do backend tự tính, không có endpoint upstream**: probe xác nhận
     upstream không có related và search **chỉ khớp title** (tìm tên diễn
     viên/đạo diễn trả 0 kết quả). Vì mọi item listing đều kèm `casts`,
     `director`, `year`, backend gom ứng viên từ chính các list thể loại/quốc
     gia/năm của phim rồi chấm điểm — **không fetch chi tiết từng ứng viên** (N
     request sẽ quá đắt). API: `GET /api/v1/movies/{slug}/related?limit=12`,
     cache `nguonc:related:{slug}` TTL 30 phút (dùng lại `cached_fetch`, kèm
     bản `:stale`).
101. **Bản đồ nhãn→slug khoá theo nhãn trong DETAIL** (`services/catalog_map.py`):
     nhãn thể loại/quốc gia trong detail khác `cat.name` của chính list đó
     ("Phim Hài" vs "Hài"; quốc gia list là tiếng Anh "South Korea" còn detail
     là "Hàn Quốc"). Đã xác minh 22/22 genre và 16/16 country trước khi hardcode;
     nhãn lạ → bỏ qua list đó (fallback) thay vì trộn sai category.
102. **Chấm điểm + phạt khoảng cách năm (trần −4)**: đạo diễn +6, diễn viên +3
     (tối đa 3 tên), trúng phần gốc tên +5, cùng năm +2, mỗi list thể loại +2,
     cùng quốc gia +1; trừ `min(|Δnăm|, 4)`. Không có phạt này thì rail của phim
     2015 toàn phim 2026 cùng quốc gia (listing xếp mới nhất trước); trần −4 giữ
     cho match người/thể loại vẫn thắng ở mọi khoảng cách. Sắp xếp `(-điểm, slug)`
     để cache giữ nguyên thứ tự.
103. **Chuẩn hoá tên người theo alphanumeric**: "Woo Min-ho" ≡ "Woo Min Ho",
     "Jung Woo-sung" ≡ "Jung Woo Sung" — nếu so khớp thô thì phần tiếp theo của
     cùng bộ phim không nhận ra nhau.
104. **Search title dùng cho hậu tố phần**: tên có "(Phần N)/(Season N)/(Tập N)"
     thì search thêm phần gốc của tên rồi cộng +5 cho ứng viên khớp. Đây là cách
     duy nhất chắc chắn với tới các phần khác (search chỉ khớp title). Không có
     hậu tố thì không search (chỉ trả về chính phim đó, tốn 1 call vô ích).
105. **`CandidateCard`/`CandidatePage` là model nội bộ, không trả ra public**:
     chúng chỉ thêm `director`/`casts` cho scorer; response `/related` vẫn là
     `MovieCard` nên không leak field, và không làm phình response của các list
     endpoint hiện có (đổi `MovieCard` sẽ ảnh hưởng mọi list + test shape).

106. **`/related` là endpoint catalog duy nhất có rate limit (60/phút/IP)**: mỗi
     cache miss fan-out ~10 call upstream nên nó là chỗ duy nhất có đòn bẩy
     khuếch đại; các endpoint catalog khác chỉ 1 call nên giữ nguyên không giới
     hạn (nhất quán với việc chúng không có limit từ trước). Đếm cả cache HIT
     (mục đích là chặn hammering), dùng `ratelimit.client_ip` — chỉ tin
     `X-Forwarded-For` khi peer là trusted proxy, như auth.

107. **Chấp nhận pool "Phim liên quan" như hiện tại — đã đo, không tối ưu độ
     sâu**: thử nghiệm 2026-09-17 (4 phim, ~90 call listing) cho thấy upstream
     trả 10 item/trang và xếp mới-nhất-trước, match cùng người chỉ nằm ở trang 1;
     tăng `CANDIDATE_PAGES`/`MAX_GENRE_LISTS` không thêm match unique nào (các
     list #3+ chỉ lặp lại hit của #1) nhưng tăng số call upstream ~2×. Vì vậy giữ
     nguyên thiết kế (3 trang × ≤2 genre + country + year + search phần gốc) và
     coi "index cast/director riêng" là hướng nâng cấp thật sự (cần crawl toàn
     catalog — để sau, xem todo #28). Tín hiệu người càng ít thì rail càng
     nghiêng về "cùng năm/thể loại/quốc gia" — chấp nhận, vì đó vẫn là gợi ý hợp lý.
