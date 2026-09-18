# Recommendations API (M2 + M3: gu người xem)

Sở thích per-profile + rail gợi ý. Base `/api/v1/me`, mọi endpoint cần Bearer
access token và luôn thao tác trên **profile đang hoạt động** của phiên (claim
`pid`, xem `docs/api-profiles.md`) — không có `X-Profile-Id`. Lỗi trả JSON
`{"detail": ..., "code": ...}`.

Thiết kế/động cơ: `docs/superpowers/specs/2026-09-17-profiles-and-recommendations-design.md`
(các mục M2) + rulings trong plan và `docs/decisions.md`.

## Endpoints

| Method | Path | Body | Success |
|--------|------|------|---------|
| GET | `/preferences` | — | 200 `PreferencesOut`; chưa có row → object rỗng `skipped=false` |
| PUT | `/preferences` | `PreferencesIn` | 200 `PreferencesOut` — **đè** quiz + `excluded_genres`, set `onboarding_completed_at = now()` |
| POST | `/preferences/posters` | `PosterFeedbackIn` | 200 `PreferencesOut` — cộng trọng số thể loại của poster đã thích |
| DELETE | `/preferences` | — | 204 — xoá row của profile hiện tại (reset explicit) |
| GET | `/taste` | — | 200 `TasteOut` — gu hiệu dụng + breakdown theo nguồn + phản hồi |
| POST | `/recommendations/feedback` | `FeedbackIn` | 200 `FeedbackOut` — upsert một thumb/profile+phim |
| DELETE | `/recommendations/feedback/{movie_slug}` | — | 200 `{"ok": true}` — hoàn tác (idempotent) |
| GET | `/recommendations?limit=20` | — | 200 `RecommendationsOut`; `limit` clamp `1..50` |

## Shapes

```jsonc
// PreferencesOut
{
  "genres":    { "hanh-dong": 2.0 },   // slug -> trọng số explicit
  "countries": { "han-quoc": 2.0 },
  "excluded_genres": ["kinh-di"],      // thể loại user gỡ ở "Gu của tôi"
  "onboarding_completed_at": "2026-09-17T10:00:00Z" | null,
  "skipped": false,
  "has_signals": true                  // có ≥1 favorite/rating/progress/watchlist/feedback
}

// PreferencesIn = { "genres": {...}, "countries": {...},
//                   "excluded_genres": [...], "skipped": false }
// PosterFeedbackIn = { "liked": ["slug", ...], "skipped": ["slug", ...] }
// FeedbackIn = { "movie_slug": "slug", "kind": "interested" | "not_interested" }

// RecommendationItem
{ "movie": { /* MovieCard */ }, "reason": "Vì bạn yêu thích phim Hành Động" | null }

// TasteOut
{
  "genre_weights":  { "hanh-dong": 3.0 },
  "sources":        { "hanh-dong": { "explicit": 2.0, "favorite": 1.0 } },
  "country_weights": { "han-quoc": 2.0 },
  "excluded_genres": ["kinh-di"],
  "feedback": [ { "movie": { /* MovieCard */ }, "kind": "interested",
                  "created_at": "..." } ],   // tối đa 100, mới nhất trước
  "has_signals": true,
  "onboarding_completed_at": "..." | null,
  "skipped": false
}

// RecommendationsOut
{ "items": [RecommendationItem...], "source": "personal" | "popular" | "newest" }
```

`MovieCard` giống các endpoint catalog khác (`slug`, `name`, `original_name`,
`thumb_url`, `poster_url`, `year`, …) — engine chỉ điền các field lấy từ
snapshot; các field còn lại (`quality`, `language`, `episodes`…) là `null`.

## Luật trọng số explicit

- **Quiz** (`PUT /preferences`): web gửi mỗi lựa chọn trọng số `2.0`
  (`genres`/`countries` dạng `{slug: weight}`). Server **không** áp thang điểm,
  chỉ lưu đúng những gì client gửi và luôn ghi đè (gọi 2 lần không cộng dồn).
  PUT luôn set `onboarding_completed_at` (kể cả `skipped=true`).
- **Poster like** (`POST /preferences/posters`): mỗi poster trong `liked` được
  tra trong `catalog_items`; mỗi thể loại của poster đó được **+0.5**, và tổng
  mỗi thể loại bị **cap 3.0**. Gọi nhiều lần vẫn cộng dồn tới cap. Slug không có
  trong snapshot → bỏ qua im lặng (không lỗi, không đổi gì).
- **`skipped` của poster**: nhận trong body nhưng **không được lưu** — bảng
  `profile_preferences` không có cột này (ruling; xem `docs/decisions.md`).
- **`DELETE /preferences`** chỉ xoá **explicit** (row `profile_preferences`).
  Trọng số hành vi (mục dưới) tính lại từ thư viện nên **không mất** khi reset.

## Trọng số hành vi (tính lúc scoring, không lưu)

Thang rating của app là **1..5 sao** (`RatingUpsert.stars: ge=1, le=5`), nên
ngưỡng dùng `stars >= 4` / `stars <= 2` (không phải ≥8/≤4 — spec ban đầu giả
định thang 10 điểm và đã được sửa, xem `docs/decisions.md`).

| Tín hiệu | Công thức |
|----------|-----------|
| Đã yêu thích (favorite) | `+1.0` |
| Rating `stars >= 4` | `+1.5` |
| Rating `stars <= 2` | `-1.5` |
| Đã xem `>= 90%` (`position/duration`) | `+0.5` |
| Đang xem `10%..90%` | `+0.2` |
| Muốn xem (watchlist) | `+0.3` |
| Phản hồi "Quan tâm" | `+1.0` |
| Phản hồi "Không quan tâm" | `-2.0` |

- Thể loại nhận trọng số lấy từ `catalog_items.genres` của đúng slug đó; slug
  thiếu trong snapshot được **backfill theo yêu cầu** (mục Catalog) trước khi
  tính, nên tín hiệu không còn bị mất vì thiếu metadata.
- Tập **loại trừ** (`seen`) = favorite ∪ rating ∪ watchlist ∪ mọi phim trong
  lịch sử (kể cả xem dở) ∪ cả hai loại phản hồi. Phim trong `seen` không bao giờ
  xuất hiện lại trong rail cá nhân.
- Rating 3 sao (trung tính) không cộng cũng không trừ, nhưng vẫn vào `seen`.
- **Người** (casts/director) lấy từ favorite ∪ rating ≥4 ∪ phản hồi "Quan tâm".

## Trang "Gu của tôi" (`GET /taste`)

`taste_profile()` gộp hai tầng: explicit (`profile_preferences.genres/countries`)
và hành vi tính lúc đọc, rồi cap mỗi thể loại trong `[-3.0, +3.0]`. `excluded_genres`
là một **bộ lọc cứng**: thể loại bị gỡ không nhận điểm (mọi nguồn) **và phim có
bất kỳ thể loại nào trong đó bị loại hẳn khỏi rail cá nhân** — nếu chỉ trừ điểm
thì phim hoạt hình vẫn lọt vì hầu hết cũng gắn `hanh-dong`/`gia-tuong`. `sources`
trả đóng góp từng nguồn để UI giải thích "vì sao có gu này"; web dùng chính dữ
liệu đó để gỡ/thêm thể loại và hoàn tác phản hồi.

## Engine chấm điểm

Với profile **có tín hiệu** (`has_signals`) **hoặc** đã onboarding
(`onboarding_completed_at != null`, `skipped=false`), duyệt toàn bộ
`catalog_items` (trừ `seen`) và chấm bằng Python:

```
score = 3.0 × (Σ w_thể-loại-khớp / √số_thể_loại_của_phim)   # tín hiệu chính
      + 1.0 × (quốc gia khớp countries đã chọn)
      + 2.0 × (casts/director trùng người của phim đã favorite / rating >= 4)
      + 0.5 × (năm >= 2020)
      + 1.0 × (điểm trung bình nội bộ của phim, nếu count >= POPULAR_MIN_RATINGS)
```

- `w_thể-loại-khớp` = trọng số explicit (quiz + poster) **+** trọng số hành vi,
  cộng dồn theo từng thể loại.
- Số hạng trung bình nội bộ là **`1 × avg`** (không phải bonus cố định): phim
  được chấm điểm rating cao hơn sẽ nhích lên, tối đa xấp xỉ 5 điểm (thang 5).
  `avg` lấy từ `rating_service.top_rated` (chỉ phim có `count >= POPULAR_MIN_RATINGS`).
- Tên người được chuẩn hoá alphanumeric + casefold ("Woo Min-ho" ≡ "Woo Min Ho").
- Sắp xếp `(-score, slug)` để thứ tự deterministic; lấy `limit` item đầu.
- `reason` chọn theo **nguồn mạnh nhất** của thể loại khớp có trọng số cao nhất:
  `"Vì bạn thích phim <nhãn>"` (explicit), `"Vì bạn yêu thích phim <nhãn>"`,
  `"Vì bạn đánh giá cao phim <nhãn>"`, `"Vì bạn đã xem hết phim <nhãn>"`,
  `"Vì bạn đang xem phim <nhãn>"`, `"Vì bạn muốn xem phim <nhãn>"`,
  `"Vì bạn quan tâm phim <nhãn>"` (nhãn tiếng Việt từ `catalog_map.genre_label`).
  Không khớp thể loại dương nào → `"Có <người> bạn đã xem"` nếu trùng
  casts/director → `"Được đánh giá cao"` nếu phim đủ ngưỡng rating → `null`.

## Fallback + khi rail ẩn

`source` cho biết rail nên hiển thị gì:

| `source` | Khi nào | Tiêu đề web |
|----------|---------|-------------|
| `personal` | Profile **có tín hiệu** (favorite/rating/progress/watchlist/feedback) **hoặc** đã onboarding không skip | **Gợi ý cho bạn** |
| `popular` | Không tín hiệu và chưa onboarding/đã skip, **và** có phim đạt `POPULAR_MIN_RATINGS` | **Phổ biến** |
| `newest` | Như trên, và **không** có phim nào đủ ngưỡng rating | *(rail ẩn)* |

- Fallback `popular` xếp theo điểm trung bình nội bộ; nếu chưa đủ `limit`, bù
  thêm phim mới nhất từ snapshot. Item fallback luôn `reason = null`.
- **Web ẩn hẳn rail** khi: chưa đăng nhập, query lỗi/đang tải, `items.length === 0`,
  hoặc `source === "newest"`. Việc ẩn `newest` là ruling vì nó trùng rail tĩnh
  "Mới cập nhật" đã có trên trang chủ (xem `docs/decisions.md`).
- Kho snapshot rỗng → `items: []` → rail ẩn (không bịa gợi ý).

## Cache

- Key `recs:{profile_id}:{engine_ver}:{prefs_ver}:{signals_ver}` với `engine_ver`
  = `recommendation_service.ENGINE_VERSION` (tăng khi đổi luật chấm/lọc; đổi code
  không bump `prefs_ver`/`signals_ver` nên nếu thiếu thành phần này sẽ phục vụ
  rail cũ tới hết TTL), `prefs_ver` = epoch
  `updated_at` của row `profile_preferences` (fallback `0` khi chưa có row) và
  `signals_ver` = fingerprint `(count, max updated_at)` gộp từ
  favorite/rating/watch_progress/watchlist/recommendation_feedback. Key này
  **cố ý** không đi qua `cache_key()` để tránh prefix `nguonc:` (ruling R5).
- TTL: `RECS_CACHE_TTL` (mặc định 900s) cho `personal`; **300s** cho fallback
  `popular`/`newest` để user mới thấy dữ liệu sớm.
- Onboarding/reset/thêm favorite/xem phim/phản hồi đều đổi key → miss (bust tức
  thì). Trước M3 chỉ `profile_preferences` bump key nên tín hiệu thư viện bị trễ;
  nay đã sửa.

## Catalog snapshot

Engine chấm trên `catalog_items`, không gọi upstream mỗi request.

- Nguồn: các listing sẵn có của upstream — mọi slug trong `catalog_map.GENRE_SLUGS`
  (`/films/the-loai/{slug}`) **trừ `phim-18`** (`EXCLUDED_GENRE_SLUGS`, xem
  `docs/decisions.md`), `COUNTRY_SLUGS` (`/films/quoc-gia/{slug}`) và các năm
  `2016..2026` (`/films/nam-phat-hanh/{year}`), mặc định **5 trang/listing**
  (đo 2026-09-18: 5 trang đầu của một listing là 50 slug **khác nhau**; fan-out
  bị chặn ở 8 request đồng thời).
  Vẫn crawl `phim-18` được khi chỉ định tường minh (`refresh(..., kinds=[...])`
  hoặc `python -m app.cli refresh-catalog --kinds phim-18`).
- Gom `CandidateCard` (có `casts`/`director`), dedupe theo `slug` trong một lần
  chạy, union genres, upsert (cập nhật `fetched_at` + metadata). Một listing lỗi
  chỉ log + đếm (`listings_failed`), không làm hỏng cả lần refresh.
- Refresh cadence: job APScheduler interval `CATALOG_REFRESH_INTERVAL_MINUTES`
  (mặc định 360 phút) chạy khi snapshot cũ hơn `CATALOG_TTL_HOURS` (24h), cộng
  warm-up một lần lúc startup **nếu kho rỗng**. Không dùng `BackgroundTasks`.
- Chống chạy trùng giữa các worker bằng Redis lock `catalog:refresh:lock`
  (`SET NX EX 300`).
- **Backfill theo yêu cầu**: `catalog_service.ensure_metadata(db, slugs)` — slug
  có tín hiệu người dùng nhưng thiếu trong snapshot → fetch `/film/{slug}`, map
  nhãn thể loại/quốc gia sang slug, upsert (`source="backfill"`). Chạy best-effort
  trong `taste_profile` (cap 50 slug, 5 request đồng thời, lỗi mạng chỉ log) nên
  tín hiệu cũ/ít-list luôn map được sang thể loại.
- CLI chạy tay: `uv run python -m app.cli refresh-catalog --pages 5` (in
  `items/listings`).

## Config

`CATALOG_TTL_HOURS=24` · `CATALOG_REFRESH_INTERVAL_MINUTES=360` ·
`CATALOG_REFRESH_PAGES=5` · `RECS_LIMIT=20` · `RECS_CACHE_TTL=900` ·
`POPULAR_MIN_RATINGS=3` (`app/core/config.py`, `.env.example`,
`docker-compose.yml`).

## Hạn chế đã biết (đừng hứa quá)

- **Kho upstream nông**: mọi listing trả **10 item/trang**, xếp mới-nhất-trước.
  Đo lại 2026-09-18: 5 trang đầu của `the-loai/hanh-dong`, `quoc-gia/han-quoc`,
  `nam-phat-hanh/2024` cho **50 slug khác nhau mỗi listing** → lấy 5 trang thật
  sự tăng phủ, và backfill lo phần phim cũ không nằm trong listing nào. Tín hiệu
  "cùng người" vẫn chủ yếu ở các trang đầu (casts chỉ có trên card listing, không
  phải mọi card).
- **Không có nhãn độ tuổi** ở upstream → không có kid mode / lọc theo tuổi.
  Vì quiz (R1) không có lựa chọn 18+ nên không profile nào biểu đạt hay tắt
  được thể loại `phim-18`; nó bị loại khỏi crawl mặc định (`EXCLUDED_GENRE_SLUGS`)
  để phim 18+ (thường kèm thể loại phổ thông) không lọt vào "Gợi ý cho bạn".
  Cờ tuổi/kid mode đúng nghĩa là việc tương lai (xem `docs/todo.md`).
- **Không có tag/keyword/điểm cộng đồng** → không thể collaborative filtering /
  embedding; gợi ý chỉ từ gu của chính profile + metadata thô.
- Chất lượng gợi ý **có hạn theo thiết kế**; rail chỉ đảm bảo *luật* (loại trừ,
  xếp hạng, fallback), không đảm bảo "hay".
