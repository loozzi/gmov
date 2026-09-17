# Onboarding & Recommendations (M2) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mỗi profile khai báo sở thích (quiz thể loại/quốc gia + lọc poster), hệ thống dựng kho phim từ listing upstream và trả rail "Gợi ý cho bạn" theo gu của profile đó.

**Architecture:** `catalog_items` là snapshot phim crawl từ các listing sẵn có (refresh qua APScheduler + CLI, Redis lock); `profile_preferences` lưu trọng số **explicit** (quiz + poster like); engine chấm điểm trong Python trên snapshot, cộng trọng số **hành vi** tính tại thời điểm scoring (favorite/rating/progress), cache Redis theo `(profile, prefs_version)`. Web: `/onboarding` 3 bước (skip được) + rail client-side trên trang chủ (ẩn khi rỗng/chưa đăng nhập).

**Tech Stack:** FastAPI, SQLAlchemy 2.0 async + Alembic (SQLite cho test, Postgres prod), APScheduler (đã dùng cho `token_cleanup`), Redis, Pydantic v2, respx; Next.js 15, TanStack Query v5, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-17-profiles-and-recommendations-design.md` (các mục M2: `profile_preferences`, `catalog_items`, "Recommendation engine", "Catalog snapshot refresh", "API contracts (M2)", "Frontend" M2, Testing).

## Global Constraints

- Chỉ `uv run ruff check app tests` là chuẩn lint backend (88 cột); repo **không** ruff-format-clean → không format toàn file.
- Test backend: `uv run pytest -q -m "not integration"` (SQLite); integration cần Postgres compose: `docker compose --env-file /tmp/e2e.env up -d db redis api`.
- Web: `pnpm exec tsc --noEmit` + `pnpm lint` chạy ở `apps/web`.
- **Không** chạy `next build`/`next dev` song song cùng `apps/web/.next`; trước build/E2E phải kill dev `:3000` + `rm -rf .next`.
- Env mới → `.env.example` + `docker-compose.yml` cùng commit. Không commit `.env`, không `git add .opencode/`.
- Commit Conventional Commits tiếng Anh; mỗi task ≥1 commit; cuối cùng `git push`.
- Docs: prose tiếng Việt, identifier tiếng Anh.
- Router → service → model; không truy cập DB trong router. Module < 300 dòng, full type hints.
- E2E **không đăng ký tài khoản mới** (quota 3 tài khoản/giờ/IP) — dùng account nền + profile tạo/xoá trong test.
- Phase trước (M1) đã có: `profiles`, `get_active_profile` (deps), `services/cache.py` (`cache_key`, `cached_fetch`, `invalidate`), `services/related_service.py` (mẫu fan-out listing + ranking), `services/nguonc.py` (`fetch_candidate_page`, `CandidateCard` có `casts`/`director`), `services/catalog_map.py` (`GENRE_SLUGS`, `COUNTRY_SLUGS`, `genre_slug`, `country_slug`), `services/rating_service.summary`, head migration `79d983c25d9a`.

## Rulings (khoá trước khi implement — đọc kỹ, đừng làm theo spec ở các điểm này)

- **R1 — Quiz lấy lựa chọn từ web tĩnh.** Upstream **không có endpoint menu** thể loại/quốc gia; `lib/catalog.ts` (`GENRES`, `COUNTRIES`) là nguồn duy nhất. Onboarding dùng danh sách tĩnh đó, gửi **slug** lên server (khớp `catalog_map`). Không thêm endpoint menu. *(Nếu sai: thiếu vài thể loại ít gặp như `phim-18` trong quiz — chấp nhận.)*
- **R2 — Bỏ cột `catalog_items.kind`.** `MovieCard` upstream không có `kind`/`type`; suy ra từ loại listing là mong manh. Cột này không được engine dùng → YAGNI, bỏ luôn. *(Nếu sai: thêm cột + migration phụ.)*
- **R3 — Refresh bằng APScheduler, không `BackgroundTasks`.** Repo chưa từng dùng `BackgroundTasks`; mẫu có sẵn là `services/token_cleanup.py` (`run_with_lock` dùng Redis `set(nx=True, ex=...)`, `start_scheduler()` gọi trong `main.py` lifespan). Dùng: job interval (mặc định 6h) refresh khi snapshot cũ > `CATALOG_TTL_HOURS`, + warm-up một lần lúc startup **nếu kho rỗng**, + CLI chạy tay. *(Nếu sai: deploy mới có thể rỗng tới lần job kế tiếp; warm-up + CLI đã chặn ca thường.)*
- **R4 — Rail gợi ý là client component.** Home page (`app/page.tsx`) fetch server-side **không kèm auth**, mà recs cần access token trong memory → rail theo đúng mẫu `components/movies/continue-watching-rail.tsx` (`"use client"` + `useAuth()` + TanStack Query), trả `null` khi chưa đăng nhập hoặc rỗng. *(Nếu sai: phải thêm auth-aware server fetch — việc lớn hơn nhiều.)*
- **R5 — Cache recs dùng `services/cache.py`.** `cached_fetch(key, ttl, model, fetcher)` nhận key tuỳ ý; dùng key `recs:{profile_id}:{prefs_ver}` (không dùng `cache_key()` vì nó gắn prefix `nguonc:`). Kiểm tra `cache.py` trước khi dùng để bám đúng chữ ký + hành vi stale.

## File structure

- API: `app/db/models/{profile_preference,catalog_item}.py`, `app/schemas/{preference,recommendation}.py`, `app/services/{catalog_service,preference_service,recommendation_service}.py`, `app/api/v1/routers/recommendations.py` (prefix `/me`), sửa `app/cli.py`, `app/main.py` (lifespan scheduler), `app/core/config.py`.
- Web: `lib/recommendations.ts`, `components/onboarding/*`, `app/onboarding/page.tsx`, `components/movies/recommendations-rail.tsx`, sửa `app/page.tsx` + `app/profiles/manage/page.tsx`.
- Docs: `docs/api-recommendations.md` (mới), `api-profiles.md`, `web-pages.md`, `decisions.md`, `todo.md`, `e2e.md`.

---

### Task 1: Migration + models (`profile_preferences`, `catalog_items`)

**Files:**
- Create: `apps/api/app/db/models/profile_preference.py`, `apps/api/app/db/models/catalog_item.py`
- Modify: `apps/api/app/db/models/__init__.py`
- Create: `apps/api/app/alembic/versions/<rev>_preferences_and_catalog.py` (`down_revision = "79d983c25d9a"`)
- Test: `apps/api/tests/test_m2_migration.py`

**Interfaces:**
- `ProfilePreference`: `profile_id` Uuid PK **và** FK `profiles.id` ON DELETE CASCADE; `genres` JSON NOT NULL default `{}`; `countries` JSON NOT NULL default `{}`; `onboarding_completed_at` DateTime(tz) NULL; `skipped` Boolean NOT NULL default false; `created_at`/`updated_at` (TimestampMixin).
- `CatalogItem`: `slug` String(255) PK; `name` String(255) NOT NULL; `original_name` String(255) NULL; `poster_url`/`thumb_url` Text NOT NULL (dùng `""` khi upstream thiếu); `year` Integer NULL (index); `genres` JSON NOT NULL default `[]` (list slug); `country` String(64) NULL (slug); `casts` Text NULL; `director` Text NULL; `fetched_at` DateTime(tz) NOT NULL; `source` String(32) NOT NULL.

- [ ] **Step 1: Test migration (đỏ)** — `tests/test_m2_migration.py` theo pattern `tests/test_comment_hidden_default.py`: upgrade tới `79d983c25d9a`, seed 1 user + 1 profile, upgrade head → assert 2 bảng tồn tại với cột/kiểu đúng, `profile_preferences.profile_id` là FK CASCADE (xoá profile → row mất), và head mới `down_revision` đúng chuỗi.
- [ ] **Step 2: Fail** — `cd apps/api && uv run pytest tests/test_m2_migration.py -q`
- [ ] **Step 3: Models + migration** — viết như Interfaces; dùng `JSON` của SQLAlchemy (chạy được cả SQLite lẫn Postgres), `sa.DateTime(timezone=True)`, `server_default=sa.text("'{}'")`/`"'[]'"` cho JSON nếu cần cho backfill rỗng (không có dữ liệu cũ nên bảng mới rỗng — không cần backfill). Đăng ký model trong `__init__.py`.
- [ ] **Step 4: Xanh** — `uv run pytest tests/test_m2_migration.py -q && uv run pytest -q -m "not integration"` (0 fail, 158 + mới).
- [ ] **Step 5: Commit** — `feat(api): add preference and catalog tables`

---

### Task 2: Catalog snapshot service + CLI + scheduler

**Files:**
- Create: `apps/api/app/services/catalog_service.py`
- Modify: `apps/api/app/cli.py` (dispatch theo `args.command` — hiện `main()` hardcode `_set_role`, bắt buộc sửa), `apps/api/app/main.py` (warm-up + interval job trong lifespan), `apps/api/app/core/config.py` (+`.env.example`, `docker-compose.yml`)
- Test: `apps/api/tests/test_catalog_service.py`

**Interfaces:**
- `catalog_service.refresh(db, *, kinds: Sequence[str] | None = None, pages: int = 1) -> RefreshStats` — duyệt listing nguồn (mặc định: mọi slug trong `catalog_map.GENRE_SLUGS.values()` + `COUNTRY_SLUGS.values()` + năm `YEARS` 2016..2026), gom `CandidateCard` từ `nguonc.fetch_candidate_page(kind, key, page)`, upsert theo `slug` (cập nhật `fetched_at`, `source`, và các field metadata), dedupe trong một lần chạy; lỗi một listing chỉ log + đếm, không làm hỏng cả lần refresh.
- `catalog_service.is_stale(db, ttl_hours: int) -> bool` (rỗng hoặc `max(fetched_at)` cũ hơn TTL).
- `catalog_service.list_items(db, *, limit: int | None = None) -> list[CatalogItem]`, `catalog_service.by_slugs(db, slugs: Sequence[str]) -> list[CatalogItem]`, `catalog_service.count(db) -> int`.
- `RefreshStats` dataclass: `listings_ok`, `listings_failed`, `items_upserted`.
- CLI: `uv run python -m app.cli refresh-catalog [--pages N]` in stats rồi exit 0.
- Config mới: `catalog_ttl_hours: int = 24`, `catalog_refresh_interval_minutes: int = 360`, `catalog_refresh_pages: int = 1` (+ `.env.example`, `docker-compose.yml`).

- [ ] **Step 1: Test (đỏ)** — respx mock `fetch_candidate_page`-style HTTP; assert: upsert lần 1 tạo N item; chạy lần 2 không nhân đôi (dedupe theo slug) và cập nhật `fetched_at`; 1 listing lỗi 500 → `listings_failed == 1` nhưng vẫn upsert các listing khác; `is_stale` true khi rỗng, false sau refresh; `by_slugs` trả đúng thứ tự yêu cầu và bỏ slug lạ.
- [ ] **Step 2: Fail** — `uv run pytest tests/test_catalog_service.py -q`
- [ ] **Step 3: Implement service + CLI dispatch + scheduler**
  - Sửa `cli.py`: `main()` dispatch theo `args.command` (`set-role` giữ nguyên hành vi; thêm `refresh-catalog`).
  - `main.py` lifespan: sau `start_scheduler()` của token_cleanup, thêm job interval `catalog_refresh_interval_minutes` gọi `run_with_lock`-style (copy pattern `token_cleanup.run_with_lock`, lock key `catalog:refresh:lock`, TTL 300s) → `refresh()` chỉ khi `is_stale`; và warm-up một lần lúc startup **chỉ khi** `count(db) == 0` (chạy trong job đầu, không chặn khởi động: dùng `scheduler.add_job(..., next_run_time=now)`).
- [ ] **Step 4: Xanh + lint** — `uv run pytest tests/test_catalog_service.py -q && uv run ruff check app tests`
- [ ] **Step 5: Chạy tay trên mạng thật** — `docker compose --env-file /tmp/e2e.env up -d --build api` rồi `docker compose --env-file /tmp/e2e.env exec -T api python -m app.cli refresh-catalog --pages 1`; ghi lại số item thực tế (kỳ vọng vài trăm) vào report.
- [ ] **Step 6: Commit** — `feat(api): crawl an upstream catalog snapshot`

---

### Task 3: Preferences service + endpoints

**Files:**
- Create: `apps/api/app/schemas/preference.py`, `apps/api/app/services/preference_service.py`
- Create: `apps/api/app/api/v1/routers/recommendations.py` (prefix `/me`, tags `recommendations`; mount trong `app/api/v1/__init__.py`)
- Test: `apps/api/tests/test_preferences_api.py`

**Interfaces:**
- Schemas: `PreferencesOut {genres: dict[str,float], countries: dict[str,float], onboarding_completed_at: datetime|None, skipped: bool}`; `PreferencesIn {genres: dict[str,float], countries: dict[str,float], skipped: bool = False}`; `PosterFeedbackIn {liked: list[str] = [], skipped: list[str] = []}`.
- `preference_service.get_or_none(db, profile_id) -> ProfilePreference | None`; `upsert_quiz(db, profile_id, data: PreferencesIn) -> ProfilePreference` (**đè** `genres`/`countries`, set `onboarding_completed_at=now()`, `skipped=data.skipped`); `add_poster_weights(db, profile_id, liked: Sequence[str]) -> ProfilePreference` (tra `catalog_items` theo slug → cộng `+0.5` cho mỗi thể loại của poster đó, cap `3.0` mỗi thể loại); `reset(db, profile_id) -> None` (xoá row); `behavior_weights(db, profile_id) -> tuple[dict[str,float], set[str]]` trả `(trọng số thể loại từ hành vi, tập slug đã tương tác)`.
- Endpoints: `GET /api/v1/me/preferences` (chưa có → trả object rỗng `skipped=false`), `PUT /api/v1/me/preferences` (body `PreferencesIn`), `POST /api/v1/me/preferences/posters` (body `PosterFeedbackIn`; `skipped` chỉ ghi nhận, không đổi trọng số), `DELETE /api/v1/me/preferences` (204).
- Hành vi (behavior): favorite `+1.0`, rating ≥8 `+1.5`, progress ≥90% `+0.5`, rating ≤4 `−1.5`; thể loại lấy từ `catalog_items` của slug đó; slug lạ (không có trong snapshot) → bỏ qua.

- [ ] **Step 1: Test (đỏ)** — `client_env` như `tests/test_profiles_api.py`; assert: PUT đè (gọi 2 lần không cộng dồn) và set `onboarding_completed_at`; `skipped=true` được lưu; poster like cộng 0.5/thể loại và **cap 3.0**; poster like với slug không có trong catalog → không lỗi, không đổi gì; DELETE xoá row → GET trả rỗng; **reset không làm mất trọng số hành vi** (tạo favorite + rating ≥8 rồi reset → `behavior_weights` vẫn trả đúng); cách ly profile (profile khác không thấy preferences của profile này).
- [ ] **Step 2: Fail** — `uv run pytest tests/test_preferences_api.py -q`
- [ ] **Step 3: Implement**
- [ ] **Step 4: Xanh + lint** — `uv run pytest tests/test_preferences_api.py -q && uv run ruff check app tests`
- [ ] **Step 5: Commit** — `feat(api): store per-profile taste preferences`

---

### Task 4: Recommendation engine + endpoint

**Files:**
- Create: `apps/api/app/schemas/recommendation.py`, `apps/api/app/services/recommendation_service.py`
- Modify: `apps/api/app/api/v1/routers/recommendations.py`, `apps/api/app/core/config.py` (+env/compose)
- Test: `apps/api/tests/test_recommendations_api.py`

**Interfaces:**
- Schemas: `RecommendationItem {movie: MovieCard, reason: str | None}`; `RecommendationsOut {items: list[RecommendationItem], source: Literal["personal","popular","newest"]}`.
- `recommendation_service.recommend(db, profile_id, limit: int) -> RecommendationsOut`:
  1. `prefs = preference_service.get_or_none`; nếu `None`/`skipped`/`onboarding_completed_at is None` → fallback `source="popular"` (query mới `preference_service`-independent: `rating_service.top_rated(db, min_count=POPULAR_MIN_RATINGS, limit=limit)` + nếu thiếu thì bù bằng item mới nhất từ catalog, `source="newest"` khi không có rating nào đủ ngưỡng) — item fallback có `reason=None`.
  2. Có gu: `explicit = prefs.genres` (+ countries), `behavior, seen = preference_service.behavior_weights(db, profile_id)`; gộp `w_genre = explicit + behavior`; loại trừ `seen` và mọi slug đã favorite/watchlist/đã xem ≥90%.
  3. Điểm: `3×(Σw_khớp / √số thể loại của phim) + 1×(country khớp) + 2×(casts/director trùng người của phim đã favorite hoặc rating ≥8) + 0.5×(year ≥ 2020) + 1×(avg stars nội bộ nếu count ≥ POPULAR_MIN_RATINGS)`; sort `(-score, slug)`; `reason` = thể loại khớp có trọng số cao nhất, ví dụ `"Vì bạn thích Hành Động"` (dùng nhãn tiếng Việt từ `catalog_map` — cần thêm map slug→label ở backend, xem Step 3).
  4. Cache: `cache.cached_fetch(f"recs:{profile_id}:{prefs_ver}", RECS_CACHE_TTL, RecommendationsOut, fetcher)` với `prefs_ver = int(updated_at.timestamp())` của row preferences (fallback 0); fallback "popular" cache TTL ngắn hơn (300s) để user mới thấy dữ liệu sớm.
- Endpoint: `GET /api/v1/me/recommendations?limit=RECS_LIMIT` (clamp `1..50`).
- `rating_service.top_rated(db, *, min_count: int, limit: int) -> list[tuple[str, float, int]]` (query mới `GROUP BY movie_slug HAVING count>=min_count ORDER BY avg DESC`).
- Config: `recs_limit: int = 20`, `recs_cache_ttl: int = 900`, `popular_min_ratings: int = 3`.

- [ ] **Step 1: Test (đỏ)** — seed catalog giả trong DB (insert trực tiếp) + preferences + favorite/rating; assert: ranking deterministic theo luật (phim khớp nhiều thể loại trọng số cao xếp trước); loại trừ phim đã favorite/đã xem ≥90%; phim đã xong <90% vẫn xuất hiện; người (casts) trùng làm tăng điểm; `reason` đúng nhãn tiếng Việt của thể loại mạnh nhất; chưa onboarding → `source="popular"` và items có `reason=None`; không có rating đủ ngưỡng → `source="newest"`; cache: gọi 2 lần → lần 2 HIT (không chấm lại — kiểm bằng cách sửa DB giữa 2 lần gọi, kết quả không đổi), và reset preferences (đổi `updated_at`) → cache miss.
- [ ] **Step 2: Fail** — `uv run pytest tests/test_recommendations_api.py -q`
- [ ] **Step 3: Implement** — thêm slug→label cho thể loại: mở `catalog_map.py` và thêm `GENRE_LABELS: dict[str,str]` (slug→nhãn hiển thị, tái dùng chính các nhãn trong `GENRE_SLUGS`) + `genre_label(slug) -> str` (fallback = slug). Không sửa `GENRE_SLUGS`/`COUNTRY_SLUGS` hiện có.
- [ ] **Step 4: Xanh + lint + integration** — unit xanh, `ruff` sạch, `docker compose ... up -d --build api` rồi `uv run pytest -q -m integration` 2 passed (đảm bảo migration M2 đã chạy trên Postgres thật).
- [ ] **Step 5: Commit** — `feat(api): rank per-profile recommendations`

---

### Task 5: Web onboarding flow

**Files:**
- Create: `apps/web/lib/recommendations.ts` (types + hooks: `usePreferences`, `useSavePreferences`, `usePosterFeedback`, `useResetPreferences`, `useRecommendations`), `apps/web/app/onboarding/page.tsx`, `apps/web/components/onboarding/{genre-step,poster-step}.tsx`
- Modify: `apps/web/app/profiles/manage/page.tsx` ("Làm lại sở thích")
- Test: tsc + lint + smoke curl (web không có unit runner)

**Interfaces:**
- Bước 1: grid chọn thể loại + quốc gia từ `lib/catalog.ts` (`GENRES`, `COUNTRIES`) → `{genres: {slug: 2.0}, countries: {slug: 2.0}}`.
- Bước 2: 2 hàng × 6 poster lấy từ listing công khai (`/api/v1/movies/latest`, `/genre/<slug>` của thể loại đã chọn — dùng `apiFetch(path, {auth: false})` như `lib/movies.ts`); mỗi poster có nút thích/bỏ qua → `POST /me/preferences/posters`.
- Bước 3: tổng kết + "Bắt đầu xem" → `PUT /me/preferences` (nếu đã PUT ở bước 1 thì bước này chỉ set `onboarding_completed_at`).
- **Skip ở mọi bước** → `PUT /me/preferences` với `skipped: true` (không có gu) rồi về `/`.
- Guard client-side: nếu `usePreferences()` cho thấy `onboarding_completed_at != null` → `router.replace("/")`; chưa đăng nhập → CTA đăng nhập (theo mẫu `/profiles`). Không dùng middleware (middleware chỉ thấy cookie refresh, xem R4/explore item 10).
- "Làm lại sở thích" trong `/profiles/manage`: hộp thoại xác nhận → `useResetPreferences()` → `router.push("/onboarding")`.

- [ ] **Step 1: Viết `lib/recommendations.ts`** theo pattern `lib/profiles.ts` (query keys, `apiFetch`, mutation + invalidate `["me","preferences"]`).
- [ ] **Step 2: UI 3 bước + skip + guard** như Interfaces; tiếng Việt; nhãn/`data-testid` ổn định cho Playwright (`onboarding-genre-<slug>`, `onboarding-poster-like-<slug>`, `onboarding-skip`, `onboarding-next`, `onboarding-finish`).
- [ ] **Step 3: "Làm lại sở thích"** trong `/profiles/manage` (dùng `aria-label` có tên profile như các nút khác để e2e định vị được).
- [ ] **Step 4: Verify** — `cd apps/web && pnpm exec tsc --noEmit && pnpm lint`; smoke: `curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/onboarding` (200/307, không 500).
- [ ] **Step 5: Commit** — `feat(web): onboarding to learn a profile's taste`

---

### Task 6: Web recommendations rail + home integration

**Files:**
- Create: `apps/web/components/movies/recommendations-rail.tsx`
- Modify: `apps/web/app/page.tsx`
- Test: tsc + lint + smoke; e2e ở Task 7

**Interfaces:**
- Rail `"use client"`, theo mẫu `components/movies/continue-watching-rail.tsx`: `useAuth()` (return `null` khi chưa đăng nhập), `useRecommendations()` (enabled khi đã đăng nhập), return `null` khi `items.length === 0` (không bịa rail), render tiêu đề `"Gợi ý cho bạn"` khi `source === "personal"`, `"Phổ biến"` khi `source === "popular"`, `"Mới cập nhật"` khi `"newest"`; card dùng lại component card của `MovieRail` (tái dùng `MovieRail` với `movies` đã map + `title` tương ứng, bỏ `reason` khỏi UI hoặc hiển thị dưới dạng tooltip/`title` — chọn cách đơn giản nhất, không sửa `MovieRail`).
- `app/page.tsx`: chèn `<RecommendationsRail />` ngay sau hero, trước "Mới cập nhật".

- [ ] **Step 1: Implement rail + mount vào home**
- [ ] **Step 2: Verify** — `tsc` + lint sạch; smoke `curl -s http://localhost:3000/ | grep -o "Gợi ý cho bạn"` (đăng nhập chưa có → có thể không thấy; chỉ cần 200 và không lỗi render).
- [ ] **Step 3: Commit** — `feat(web): recommend movies on the home page`

---

### Task 7: E2E + docs + verify + push

**Files:**
- Create: `apps/web/e2e/onboarding.spec.ts`, `docs/api-recommendations.md`
- Modify: `docs/{api-profiles,web-pages,decisions,todo,e2e}.md`, `.env.example`, `docker-compose.yml` (nếu Task 2/4 chưa thêm)

**Interfaces:**
- Spec (dùng account nền, **không đăng ký mới**, tạo/xoá 1 profile phụ rồi làm sạch):
  1. profile mới → `/onboarding` → chọn vài thể loại → thích vài poster → "Bắt đầu xem" → về `/` thấy heading `"Gợi ý cho bạn"` và có card.
  2. skip toàn bộ → về `/`, rail không hiện `"Gợi ý cho bạn"` (fallback "Phổ biến"/"Mới cập nhật" hoặc ẩn) và quay lại `/onboarding` không bị chặn (đã skip).
  3. "Làm lại sở thích" ở `/profiles/manage` → mở lại onboarding → lưu lại → rail vẫn hoạt động (chứng minh reset + onboard lại chạy).
  4. cách ly: profile 2 onboard gu khác profile 1 → rail của profile 1 không đổi ngay (cache TTL) — chỉ assert rail vẫn render được sau khi switch về profile 1 (không assert nội dung y hệt để tránh flake).
- Docs: `api-recommendations.md` (endpoints, shapes, engine + công thức, fallback, cache, giới hạn đã biết từ debt #28: kho upstream nhỏ / không có nhãn tuổi / không có tag), cập nhật `api-profiles.md` (mục "Làm lại sở thích"), `web-pages.md` (`/onboarding`, rail), `decisions.md` (5 rulings R1–R5 + công thức engine + snapshot/lazy refresh), `todo.md` (M2 xong; thêm debt mới nếu có), `e2e.md` (spec mới).

- [ ] **Step 1: Viết spec + chạy** — `cd apps/web && rm -rf .next && pnpm exec playwright test onboarding.spec.ts` (kill dev :3000 trước).
- [ ] **Step 2: Full E2E** — `pnpm test:e2e` → kỳ vọng 24 cũ + 4 mới.
- [ ] **Step 3: Docs** như trên.
- [ ] **Step 4: Verify toàn bộ** — `uv run ruff check app tests`; `uv run pytest -q -m "not integration"`; `docker compose --env-file /tmp/e2e.env up -d --build db redis api` + `-m integration`; `pnpm lint && pnpm exec tsc --noEmit`; `rm -rf .next && pnpm build` (kỳ vọng thêm `/onboarding`).
- [ ] **Step 5: Commit + push** — `docs: document onboarding and recommendations` rồi `git push -u origin feat/onboarding-recommendations`.

---

## Ghi chú cho executor

- Task 1 → 2 → 3 → 4 tuần tự (2 cần bảng của 1; 3/4 cần catalog của 2 để tra thể loại poster). Task 5/6 cần 3/4 ổn định.
- Không mở rộng phạm vi: không kid mode, không upload avatar, không collaborative filtering, không thêm endpoint menu (R1).
- Nếu `cache.cached_fetch` không phù hợp với key `recs:` (ví dụ nó tự prefix `nguonc:`), tự viết helper nhỏ trong `recommendation_service` dùng `get_redis_client()` (từ `app/db/session.py`) với `setex`/`get` JSON — ghi lại quyết định trong report.
- Đừng hứa chất lượng gợi ý: test chỉ khẳng định **luật**, không khẳng định "hay".
