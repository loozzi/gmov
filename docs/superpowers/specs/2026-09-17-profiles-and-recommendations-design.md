# Profiles & recommendations — design spec (2026-09-17)

Trạng thái: đã chốt với user qua brainstorming. Chưa code gì trước khi user
duyệt spec này.

## Goal

Cho một tài khoản nhiều **profile** kiểu Netflix (tối đa 5, switch qua lại, PIN
4 số tuỳ chọn), mỗi profile có gu riêng; trên nền đó thêm **onboarding tìm hiểu
sở thích** và **rail gợi ý phim phù hợp** cho từng profile.

Hai mục tiêu tách rời về rủi ro, nên cùng một spec nhưng chia 2 milestone ship
độc lập:

- **M1 — Profiles**: refactor dữ liệu per-user → per-profile + phiên đăng nhập
  mang profile + CRUD/switch/PIN + UI switcher/quản lý. Không liên quan gợi ý.
- **M2 — Onboarding & gợi ý**: kho catalog snapshot, sở thích per-profile,
  engine xếp hạng, onboarding UI, rail gợi ý ở trang chủ.

Tiêu chí hoàn thành M1: toàn bộ e2e hiện có vẫn xanh **và** e2e profile mới
xanh. Tiêu chí hoàn thành M2: onboarding chạy được cho mọi profile, rail gợi ý
trả kết quả deterministic theo luật đã mô tả, có fallback khi chưa có gu.

## Non-goals (YAGNI, không làm trong spec này)

- Upload ảnh avatar (chỉ chọn từ bộ icon/màu có sẵn).
- Kid mode / lọc theo độ tuổi: upstream **không có nhãn độ tuổi** nên không đáng
  tin; không hứa hẹn.
- Collaborative filtering, embedding, ML thật: rating chỉ của người dùng mình,
  quá thưa; upstream không có tag/keyword/điểm cộng đồng.
- Khôi phục PIN qua email; PIN chỉ là soft-gate trong nhà, không phải ranh giới
  bảo mật như mật khẩu tài khoản.
- Admin xem/quản lý profile người dùng; profile cho khách chưa đăng nhập;
  subscription/billing.

## Decisions (đã chốt với user)

1. **Gu xem theo profile, bình luận theo tài khoản**: `favorite`,
   `watchlist`, `watch_progress`, `rating`, `profile_preferences`,
   recommendations gắn `profile_id`; `comment`/`comment_report` vẫn `user_id` →
   danh tính social và luồng kiểm duyệt/ban không đổi.
2. **Onboarding 2 bước**: chọn thể loại/quốc gia → lọc poster thích/bỏ qua;
   skip được ở mọi bước.
3. **Gợi ý tính từ snapshot catalog trong DB**, refresh lazy theo TTL (không
   gọi upstream mỗi request, không dùng `X-Profile-Id`).
4. **Profile có PIN 4 số tuỳ chọn**, hash bằng passlib, chống brute-force bằng
   rate limit sẵn có.
5. **Profile trong phiên đăng nhập** (không phải header): `refresh_tokens`
   mang `profile_id`, access token mang claim `sid` + `pid` → mỗi thiết bị nhớ
   profile riêng, PIN được enforce ở server trên mọi request.
6. **Xoá profile cần PIN của chính profile đó** (nếu profile có PIN).
7. **Không xoá được profile mặc định**; mọi profile đều onboard lại được bất
   kì lúc nào.
8. Trọng số **explicit** (quiz + poster like) lưu DB; trọng số **hành vi**
   (favorite/rating/xem dở) tính tại thời điểm scoring, không lưu → reset
   onboarding không mất tín hiệu hành vi.

## Data model

### Bảng mới `profiles` (M1)

| cột | kiểu | ghi chú |
| --- | --- | --- |
| `id` | UUID PK | |
| `user_id` | UUID FK `users.id` ON DELETE CASCADE, index | |
| `name` | String(32) NOT NULL | unique `(user_id, name)`; service còn chặn trùng kiểu không phân biệt hoa/thường |
| `avatar` | String(32) NOT NULL, default `"popcorn"` | slug trong allowlist ~12 icon; `422` nếu ngoài allowlist |
| `position` | SmallInteger NOT NULL | 0..4, unique `(user_id, position)`, dùng sắp thứ tự |
| `is_default` | Boolean NOT NULL, default false | partial unique index `(user_id) WHERE is_default` → đúng 1/user |
| `pin_hash` | String(255) NULL | passlib bcrypt; NULL = không khoá |
| `created_at`/`updated_at` | TimestampMixin | |

Quy tắc service: tối đa **5** profile/tài khoản
(`409 PROFILE_LIMIT_REACHED`); `position` khi tạo = slot trống nhỏ nhất (0..4)
nên xoá rồi tạo lại không sinh khoảng trống vô hạn; không xoá profile
`is_default` (`409 DEFAULT_PROFILE`); xoá profile đang hoạt động → phiên
fallback về profile mặc định; tên được trim và chặn trùng kiểu không phân biệt
hoa/thường (`409 PROFILE_NAME_TAKEN`).

### Re-key 4 bảng per-profile (M1)

`favorite`, `watchlist`, `watch_progress`, `rating`: **bỏ `user_id`**, thêm
`profile_id` UUID FK `profiles.id` ON DELETE CASCADE, index; unique constraint
đổi `(user_id, movie_slug)` → `(profile_id, movie_slug)`. Giữ một nguồn sự thật
duy nhất: xoá user → cascade profiles → cascade data; xoá profile → mất data
của profile đó.

### `refresh_tokens` (M1)

Thêm `profile_id` UUID FK `profiles.id` ON DELETE **SET NULL**. Profile bị xoá
→ lần refresh kế tiếp fallback về profile mặc định. Mỗi row = một phiên/thiết
bị, nên mỗi thiết bị nhớ profile riêng.

### Bảng mới `profile_preferences` (M2)

1-1 với profile: `profile_id` PK/FK CASCADE, `genres` JSON `{slug: weight}`,
`countries` JSON `{slug: weight}`, `onboarding_completed_at` DateTime NULL,
`skipped` Boolean NOT NULL default false, `updated_at` (TimestampMixin). Chỉ
chứa trọng số **explicit** — xem Decision 8.

### Bảng mới `catalog_items` (M2)

`slug` String(255) PK, `name`, `original_name` NULL, `poster_url`,
`thumb_url`, `year` Int NULL (index), `genres` JSON (list slug), `country`
String NULL, `casts` Text NULL, `director` Text NULL, `fetched_at` DateTime tz
NOT NULL, `source` String(32) NOT NULL (loại listing đã sinh ra item). Kho nhỏ
(ước tính vài trăm → vài nghìn dòng) nên scoring chạy trong Python, không cần
index GIN.

> **Đã sửa theo ruling R2 (2026-09-17):** cột `kind` String(16) NULL đã bị
> **bỏ** — `MovieCard` upstream không có `kind`/`type`, suy từ loại listing là
> mong manh và engine không dùng. Truy vết loại listing nằm ở `source`. Xem
> `docs/decisions.md` #118.

## Migration (backfill, một chiều về dữ liệu)

`up`:
1. Tạo bảng `profiles`, `profile_preferences` (chỉ M1 cần bảng profiles;
   `profile_preferences` + `catalog_items` sang migration M2).
2. Với mọi user hiện có: insert profile `"Mặc định"`, `position = 0`,
   `is_default = true`, avatar default.
3. Thêm cột `profile_id` (nullable) vào 4 bảng → `UPDATE` gán theo profile mặc
   định của chủ qua `user_id` → set `NOT NULL`.
4. Swap unique constraint + index sang `profile_id`.
5. `refresh_tokens.profile_id` nullable; row cũ để NULL (fallback mặc định).

`down`: tái tạo `user_id` từ profile sở hữu (`profiles.user_id`), khôi phục
constraint cũ, drop bảng mới. Ghi rõ trong doc: dữ liệu của profile **phụ** sẽ
gộp về user khi downgrade.

**Test bắt buộc**: chạy alembic trên schema cũ + seed data (2 user, mỗi user có
favorite/watchlist/progress/rating) → upgrade → assert dữ liệu nằm đúng profile
mặc định của từng user, không lẫn; và assert `is_default` đúng 1/user. Chạy
thêm trên Postgres thật của compose trước khi commit (bài học `c41d7e9b2a05`).

## Auth & session (M1)

Access token claims: `sub` (user id), `sid` (jti của refresh session đã phát
hành nó), `pid` (profile hoạt động), `type`, `jti`, `exp`.

- `deps`: decode → check `type` → load user (**ban được kiểm trước**, hành vi
  `ACCOUNT_BANNED` giữ nguyên) → resolve profile từ `pid`. Thiếu `pid` (token
  cũ trước deploy) → dùng profile mặc định (đối xử mềm để session cũ không
  chết). Có `pid` nhưng không tồn tại / không thuộc user → `404
  PROFILE_NOT_FOUND` (không lộ sự tồn tại profile của người khác).
- `POST /me/profiles/{id}/switch` cần `sid`; thiếu → `401 SESSION_STALE`.
  `api.ts` hiện đã tự refresh + retry khi gặp 401 nên client không cần xử lý
  riêng.
- Refresh: đọc row theo jti, `profile_id` NULL hoặc trỏ profile đã xoá → dùng
  profile mặc định; access token mới luôn mang `sid` + `pid`.
- Register: tạo user + profile mặc định (`is_default`) trong **cùng
  transaction**.
- Guest merge (`guest-progress.ts`) giữ nguyên flow client, ghi vào profile
  đang hoạt động.

## API contracts (M1)

Prefix `/api/v1/me` (trừ khi ghi chú), đều cần đăng nhập:

| Method | Path | Body | Kết quả |
| --- | --- | --- | --- |
| GET | `/profile` | | profile hiện tại: `{id, name, avatar, position, has_pin, is_default}` |
| GET | `/profiles` | | danh sách profile của tài khoản, kèm cờ `is_current` |
| POST | `/profiles` | `{name, avatar}` | tạo mới; `409 PROFILE_LIMIT_REACHED` khi đủ 5; `409 PROFILE_NAME_TAKEN` |
| PATCH | `/profiles/{id}` | `{name?, avatar?}` | đổi tên/avatar (kể cả profile mặc định) |
| DELETE | `/profiles/{id}` | `{pin?}` | xoá; `403 PIN_REQUIRED` / `401 INVALID_PIN` nếu profile có PIN; `409 DEFAULT_PROFILE`; nếu là profile đang dùng → trả `{access_token, profile}` mới |
| POST | `/profiles/{id}/switch` | `{pin?}` | `{access_token, profile}`; `403 PIN_REQUIRED`, `401 INVALID_PIN`, `404 PROFILE_NOT_FOUND` |
| PUT | `/profiles/{id}/pin` | `{password, pin: "1234"\|null}` | đặt/đổi/xoá PIN; cần **mật khẩu tài khoản**; `400 INVALID_PASSWORD` |

`/me/*` còn lại (`progress`, `collections`, `reviews`, `reports`) **giữ
nguyên hình dạng**, chỉ ngầm theo profile hoạt động.

## API contracts (M2)

| Method | Path | Ghi chú |
| --- | --- | --- |
| GET | `/me/preferences` | `{genres, countries, onboarding_completed_at, skipped}` |
| PUT | `/me/preferences` | ghi kết quả quiz (đè, không cộng dồn), set `onboarding_completed_at` |
| POST | `/me/preferences/posters` | `{liked: [slug], skipped: [slug]}` → cộng trọng số thể loại của poster (+0.5/thể loại, cap 3) |
| DELETE | `/me/preferences` | reset cho profile hiện tại → xoá row, `onboarding_completed_at = null` |
| GET | `/me/recommendations?limit=20` | `{items: [{movie, reason}]}`; fallback "Phổ biến" khi chưa có gu |

## Error codes added

`PROFILE_LIMIT_REACHED` 409 · `PROFILE_NAME_TAKEN` 409 · `DEFAULT_PROFILE` 409 ·
`PROFILE_NOT_FOUND` 404 · `PIN_REQUIRED` 403 · `INVALID_PIN` 401 ·
`INVALID_PASSWORD` 400 · `SESSION_STALE` 401. Avatar ngoài allowlist → `422`
(schema validation). PIN sai/thiếu bị đếm chung bộ đếm rate limit.

## PIN rules

- PIN đúng 4 chữ số; hash bằng passlib (bcrypt), không lưu thô, không log.
- **Switch** và **xoá** profile có PIN → phải nhập PIN của profile đó. Dùng
  chung bộ đếm `(profile_id, IP)`: `PIN_MAX_ATTEMPTS = 5` / `PIN_WINDOW = 60`s
  → `429 RATE_LIMITED` + `Retry-After` (không thể brute-force bằng cách đổi
  endpoint).
- **Đặt/đổi/xoá PIN** cần mật khẩu tài khoản (trẻ con không biết mật khẩu nên
  không tự gỡ khoá được), rate limit riêng theo IP.
- PIN sai trả `401 INVALID_PIN`, thiếu khi đang cần trả `403 PIN_REQUIRED` —
  khác nhau để UI biết khi nào mở dialog.

## Recommendation engine (M2)

Trọng số explicit từ `profile_preferences`: quiz chọn = 2.0/thể loại; poster
like = +0.5/thể loại của poster đó, cap 3.0. Trọng số hành vi tính tại lúc
scoring: favorite +1.0, rating ≥4 +1.5, xem ≥90% +0.5, rating ≤2 −1.5.

> **Đã sửa (2026-09-17):** rating của app là thang **1..5 sao**
> (`RatingUpsert.stars: ge=1, le=5`), nên ngưỡng đúng là `stars >= 4` /
> `stars <= 2`. Ngưỡng ≥8/≤4 ban đầu giả định thang 10 điểm và là **sai**. Xem
> `docs/decisions.md` #122.

Điểm ứng viên (catalog trong DB, chấm bằng Python):

```
score = 3×(Σw_thể loại khớp / √số thể loại của phim)      # tín hiệu chính
      + 1×quốc gia khớp với countries đã chọn
      + 2×(casts/director trùng người của phim đã favorite / rating ≥4)
      + 0.5×độ mới (năm ≥ 2020)
      + 1×điểm trung bình từ bảng ratings nội bộ (nếu ≥ POPULAR_MIN_RATINGS)
```

- Loại trừ phim đã favorite, đã có trong watchlist, hoặc đã xem ≥90%.
- Trả kèm `reason` ngắn ("Vì bạn thích Hành Động") để UI hiển thị; item của rail
  fallback ("Phổ biến"/"Mới cập nhật") có `reason = null` và UI dùng tiêu đề
  rail tương ứng thay vì reason.
- Fallback: chưa onboarding / đã skip → rail "Phổ biến" (xếp theo điểm trung
  bình nội bộ ≥ `POPULAR_MIN_RATINGS`) + "Mới cập nhật"; kho rỗng → `items: []`
  và web **ẩn rail** (không bịa gợi ý).
- Cache redis `recs:{profile_id}:{prefs_ver}` TTL `RECS_CACHE_TTL = 900`s;
  `prefs_ver` = `profile_preferences.updated_at` epoch (bust khi onboarding /
  reset). Thay đổi favorite/rating chấp nhận trễ ≤15 phút.
- Hạn chế đã biết (ghi vào `docs/api-recommendations.md`): kho ứng viên upstream
  nhỏ (đo ở debt #28 — 10 item/trang, trang sâu ~0 unique, người chỉ có ở trang
  1), upstream không có nhãn độ tuổi/tag/điểm cộng đồng → chất lượng gợi ý có
  hạn; đây là lựa chọn chấp nhận, không phải bug.

## Catalog snapshot refresh (M2)

Nguồn: các listing sẵn có (thể loại, quốc gia, năm — trang 1, tái dùng
`catalog_map` + client `nguonc` và kiểu job của `related_service`). Upsert theo
`slug`, dedupe, ghi `fetched_at`.

- CLI `python -m app.cli refresh-catalog` (chạy tay, có log tiến độ).
- Lazy refresh: khi snapshot cũ hơn `CATALOG_TTL_HOURS = 24` → lấy redis lock
  `catalog:refresh:lock` (TTL 5 phút, chống crawl trùng) và chạy nền,
  **không chặn response**.
- Warm-up lúc startup nếu kho **rỗng** (lần deploy đầu); best-effort, lỗi mạng
  chỉ log và để lần request sau thử lại.

> **Đã sửa theo ruling R3 (2026-09-17):** dùng **APScheduler interval job**
> (`token_cleanup` pattern) thay `BackgroundTasks` — job chu kỳ
> `CATALOG_REFRESH_INTERVAL_MINUTES`, warm-up một lần lúc startup nếu kho rỗng,
> cộng CLI chạy tay. Độ cũ tính theo `max(fetched_at)`. Xem `docs/decisions.md`
> #119.

## Config

`MAX_PROFILES = 5` · `PIN_MAX_ATTEMPTS = 5` · `PIN_WINDOW = 60` ·
`CATALOG_TTL_HOURS = 24` · `RECS_LIMIT = 20` · `RECS_CACHE_TTL = 900` ·
`POPULAR_MIN_RATINGS = 3`. Tất cả thêm vào `app/core/config.py`,
`.env.example` và `docker-compose.yml` trong cùng PR (theo AGENTS.md).

## Frontend

**M1**: `lib/profiles.ts` (types + hooks theo pattern `lib/moderation.ts`):
`useProfiles`, `useCurrentProfile`, `useSwitchProfile`, `useCreateProfile`,
`useUpdateProfile`, `useDeleteProfile`, `useSetProfilePin`. Component
`components/profile/profile-menu.tsx` (avatar + tên ở header → dropdown chọn
profile + "Quản lý profile") và `profile-pin-dialog.tsx` (shadcn Dialog,
`inputMode="numeric"`). Trang `/profiles` kiểu "Ai đang xem?" (grid avatar,
"Thêm profile") và `/profiles/manage` (đổi tên/avatar, đặt-xoá PIN, xoá profile
kèm ô PIN khi `has_pin` + cảnh báo mất data). Sau
`switch`: `setAccessToken` mới + `queryClient.clear()` (data per-profile nằm
rải ở nhiều key). Không dùng localStorage — profile nhớ theo phiên/thiết bị qua
refresh cookie.

**M2**: `/onboarding` 3 bước (thể loại/quốc gia → poster thích/bỏ qua → xong,
skip ở mọi bước); tự mở khi profile hiện tại chưa làm và chưa skip; rail "Gợi ý
cho bạn" (kèm `reason`) ngay sau hero; "Phổ biến"/"Mới cập nhật" cho người chưa
có gu. "Làm lại sở thích" trong `/profiles/manage` cho **mọi** profile: nếu là
profile khác profile hiện tại thì switch trước (kèm PIN dialog nếu khoá) rồi
mới mở onboarding.

> **Đã sửa (2026-09-17):** UI **không** tự switch kèm PIN dialog. Profile không
> hoạt động chỉ hiện thông báo `Hãy chuyển sang profile <name> trước khi làm
> lại sở thích.` rồi dừng. Đây là deviation có chủ đích. Xem
> `docs/decisions.md` #124.

## Testing

Unit (SQLite, không cần mạng):

- Migration backfill (alembic từ schema cũ + seed → upgrade → assert đúng
  profile, đúng `is_default`).
- CRUD profile: limit 5, `DEFAULT_PROFILE`, `PROFILE_NAME_TAKEN`, avatar
  allowlist, position.
- **Isolation từng resource**: user B không đọc/ghi/xoá được data profile của
  user A → `404` (phủ đủ 4 resource + preferences).
- Token: claim `sid`/`pid`; thiếu `pid` → profile mặc định; `pid` lạ → 404;
  thiếu `sid` khi switch → 401; **ban thắng profile** (user bị cấm vẫn 401 dù
  `pid` hợp lệ).
- Switch/delete: happy, `PIN_REQUIRED`, `INVALID_PIN`, chung counter → 429;
  xoá profile đang dùng trả token mới trỏ profile mặc định.
- `PUT /pin` cần mật khẩu: sai → `400`, đúng → set/clear, hash không lưu thô.
- Engine: tích luỹ trọng số quiz + poster, cap; hành vi (favorite/rating/xem dở);
  ranking deterministic trên fixture; loại trừ phim đã xem ≥90%; fallback khi
  chưa có gu; `DELETE /preferences` **không** làm mất trọng số hành vi.
- Catalog: parse listing (respx), upsert/dedupe, lock lazy refresh, CLI.
- Register tạo profile mặc định cùng transaction.

E2E (Playwright, **chỉ dùng account nền, không đăng ký mới** — quota register
`3 tài khoản/giờ/IP`, đã từng dính):

- Tạo profile 2 → My list/tiếp tục xem tách biệt → switch → data khác → quay
  lại profile 1 thấy nguyên vẹn.
- Đặt PIN → switch đòi PIN → sai PIN có lỗi → đúng PIN vào được.
- Xoá profile có PIN: thiếu PIN → chặn; đúng PIN → mất data của profile đó,
  profile khác nguyên vẹn; không có nút xoá cho profile mặc định.
- Chặn tạo profile thứ 6.
- M2: profile mới → onboarding quiz + poster → rail gợi ý xuất hiện; "Làm lại
  sở thích" chạy lại được cho profile cũ.

## Risks

1. **Migration một chiều trên 4 bảng** (mất `user_id`) → giảm thiểu bằng
   backfill test + chạy thử trên Postgres thật của compose trước khi commit.
2. **Sót filter `user_id` ở service nào thì rò data giữa profile** → test
   isolation phải phủ **từng** resource, không chỉ một.
3. **Chất lượng gợi ý có hạn** do kho upstream nhỏ và metadata nghèo (đo ở
   #28) → ghi thành hạn chế đã biết, không hứa "cá nhân hoá thông minh".
4. **Switch = xoay access token** → nhiều query đang cache per-user có thể giữ
   data cũ; xử lý bằng `queryClient.clear()` và test e2e đổi profile.

## Decisions to log in docs/decisions.md

- Profile là một phần của phiên đăng nhập (`sid`/`pid`) thay vì header
  `X-Profile-Id` — vì PIN chỉ có nghĩa khi server enforce.
- `comment`/`comment_report` giữ `user_id`; chỉ 4 bảng tín hiệu xem re-key sang
  `profile_id`.
- Profile mặc định bất tử; PIN là soft-gate trong nhà, đặt/đổi/xoá PIN cần mật
  khẩu tài khoản.
- Trọng số explicit lưu DB, trọng số hành vi tính tại scoring.
- Gợi ý dùng snapshot catalog + refresh lazy TTL 24h (không gọi upstream mỗi
  request); chấp nhận giới hạn chất lượng đã đo.
