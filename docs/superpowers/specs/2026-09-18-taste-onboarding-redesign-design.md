# Thiết kế: Gu người xem & onboarding lại (M3)

Ngày: 2026-09-18. Trạng thái: đã chốt design, đang triển khai.

## Vấn đề

Onboarding M2 chỉ thu tín hiệu một lần (quiz thể loại/quốc gia + like poster),
còn engine gợi ý bỏ phí hai nguồn đã có sẵn:

- `watchlist` chỉ bị loại khỏi kết quả (`seen`), không cộng điểm gu.
- Lịch sử xem dở (`10% ≤ vị trí < 90%`) không được dùng; chỉ phim xem xong.
- Không có cách cho người dùng nói "không quan tâm" hay gỡ một thể loại.
- Snapshot `catalog_items` crawl 1 trang/loại nên thiếu phim để map slug→thể
  loại, làm tín hiệu của người dùng mất giá trị.
- Cache gợi ý chỉ đổi khi `profile_preferences` đổi — thêm yêu thích/xem phim
  không làm gợi ý mới.

Mục tiêu: gợi ý sát hơn bằng cách (a) dùng đủ tín hiệu sẵn có, (b) thu phản hồi
ngầm liên tục sau onboarding, (c) cho người dùng xem/sửa gu, (d) tăng độ phủ
metadata.

## Quyết định đã chốt với người dùng

1. Người đã có tín hiệu (yêu thích/watchlist/rating/lịch sử/phản hồi) **không
   chạy lại onboarding**; thay bằng trang `/me/taste` ("Gu của tôi").
   Onboarding chỉ dành cho hồ sơ chưa có tín hiệu.
2. Ưu tiên thu **tín hiệu ngầm sau onboarding** hơn là nhồi thêm bước vào quiz.
3. Cơ chế tín hiệu ngầm: **hai nút trên card gợi ý** — "Quan tâm" /
   "Không quan tâm", ẩn card ngay, có hoàn tác.
4. Trang "Gu của tôi": xem trọng số + **nguồn** đóng góp, gỡ/thêm/chỉnh; quản lý
   danh sách phản hồi để hoàn tác.
5. Độ phủ: tăng `catalog_refresh_pages` (1→5) **và** backfill theo yêu cầu cho
   slug trong tín hiệu người dùng nhưng thiếu trong snapshot.
6. Bỏ e2e trong phạm vi này (người dùng tự manual test).

## Mô hình "gu" hai tầng

### Tầng suy ra (không lưu, tính khi đọc)

`taste_service.taste_profile(db, profile_id, prefs)` trả `TasteProfile`:
`genre_weights`, `country_weights`, `people`, `excluded_genres`, `seen`,
`sources` (mỗi thể loại: đóng góp theo từng nguồn).

Trọng số mỗi phim cộng vào các thể loại của phim (map qua `catalog_items`):

| Nguồn | Trọng số |
|---|---|
| Yêu thích | `+1.0` |
| Rating ≥4★ / ≤2★ | `+1.5` / `-1.5` |
| Xem xong (≥90%) | `+0.5` |
| Xem dở (10–90%) | `+0.2` |
| Watchlist | `+0.3` |
| Phản hồi "Quan tâm" | `+1.0` |
| Phản hồi "Không quan tâm" | `-2.0` (và vào `seen`) |

- `seen`: mọi phim trong lịch sử (kể cả xem dở), yêu thích, watchlist, rating,
  và cả hai loại phản hồi → không gợi ý lại.
- `people`: từ yêu thích, rating ≥4★, và phản hồi "Quan tâm".
- Cộng tầng hiển thị (explicit) với tầng suy ra, sau đó cap mỗi thể loại trong
  `[-3.0, +3.0]`; loại thể loại nằm trong `excluded_genres`.
- Quốc gia: chỉ lấy từ tầng hiển thị (quiz/sửa tay) — không suy ra (YAGNI).

### Tầng hiển thị (người dùng sửa)

`profile_preferences` giữ `genres`/`countries`; thêm cột `excluded_genres`
(JSON list slug, mặc định `[]`). Gỡ thể loại = thêm vào `excluded_genres`;
thêm/chỉnh = ghi vào `genres`.

### Phản hồi card

Bảng mới `recommendation_feedback`: `id` UUID PK, `profile_id` FK CASCADE
(index), `movie_slug` (index), `kind` ∈ `interested|not_interested`,
`created_at/updated_at`, `UNIQUE(profile_id, movie_slug)`. Đổi ý = update;
hoàn tác = xoá row.

## API (`/api/v1/me`)

| Method | Path | Body/Params | Trả |
|---|---|---|---|
| GET | `/taste` | — | `TasteOut` |
| PUT | `/preferences` | thêm `excluded_genres?: string[]` | `PreferencesOut` |
| GET | `/preferences` | — | thêm `has_signals: bool` |
| POST | `/recommendations/feedback` | `{movie_slug, kind}` | 200 `{movie_slug, kind}` |
| DELETE | `/recommendations/feedback/{movie_slug}` | — | 200 `{ok: true}` |

`TasteOut`: `genre_weights: {slug: float}`, `sources: {slug: {source: float}}`,
`country_weights`, `excluded_genres: string[]`, `feedback: FeedbackItem[]`
(tối đa 100, kèm `MovieCard`), `has_signals`, `onboarding_completed_at`,
`skipped`.

Cache gợi ý: key `recs:{profile_id}:{prefs_version}:{signals_version}`, với
`signals_version` gộp (count + max `updated_at`) của favorite/rating/progress/
watchlist/feedback → thay đổi thư viện làm mới gợi ý.

Cổng gợi ý cá nhân: `has_signals` **hoặc** (`onboarding_completed_at` != null
và không `skipped`).

## Engine

Giữ công thức `_score`, đọc gu hiệu dụng + `people` + năm + điểm phổ biến; bỏ
`seen`, bỏ thể loại bị loại. `reason` theo nguồn mạnh nhất: "Vì bạn yêu thích
phim X" / "Vì bạn quan tâm phim X" / "Có <người> bạn đã xem" / "Được đánh giá
cao"; vẫn `null` khi chỉ có điểm phổ biến.

## Độ phủ metadata

- `catalog_refresh_pages` mặc định `1 → 5`.
- `catalog_service.ensure_metadata(db, slugs)`: slug thiếu trong snapshot →
  fetch detail upstream → upsert `genres/country/casts/director/year`. Chạy
  best-effort trong `taste_profile()`: cap 50 slug, timeout ngắn, fail-open.

## Web

- `/onboarding`: chỉ cho hồ sơ chưa có tín hiệu (hoặc `?again=1`); có tín hiệu
  mà không `again` → chuyển `/me/taste`.
- Home: hồ sơ chưa onboard + chưa có tín hiệu → CTA mềm "Chọn gu để gợi ý sát
  hơn" (không hard-redirect).
- Card gợi ý: overlay "Quan tâm"/"Không quan tâm" + hoàn tác.
- Trang `/me/taste`: chip thể loại kèm thanh trọng số + breakdown nguồn, gỡ/thêm/
  chỉnh; quốc gia; danh sách phản hồi + hoàn tác; nút "Làm lại onboarding".
- Link "Gu của tôi" trong menu hồ sơ.

## Test

Unit/API: aggregation theo nguồn, `excluded_genres`, cap, feedback
upsert/unique/undo, `signals_version` invalidation, cổng personal khi chỉ có
tín hiệu, reason mới, `ensure_metadata` (respx), migration. Lint + tsc. E2E
ngoài phạm vi (người dùng manual test).

## Migration

Bảng `recommendation_feedback` + cột `profile_preferences.excluded_genres`
(`down_revision = a4d9c1e7f2b8`). Thuần additive, không phá API cũ.
