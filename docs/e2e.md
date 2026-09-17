# E2E testing (Playwright, Batch 4)

## Chạy local

```bash
# 1. Stack API sạch (KHÔNG dùng chung DB dev nếu không muốn lẫn data test):
docker compose down -v
docker compose --env-file /tmp/e2e.env up -d --build db redis api
# /tmp/e2e.env chỉ cần: POSTGRES_PORT=5432, REDIS_PORT=6379, API_PORT=8000
# (bỏ qua repo .env nếu port ở đó bị chiếm)
#
# CẢNH BÁO: đừng bao giờ chạy `docker compose up` trần. Không có --env-file thì
# compose đọc .env của repo (5438/6389/8008) → nó TẠO LẠI stack đang chạy sang
# port khác, và nếu port đó bị chiếm (vd 6389) thì stack tắt luôn. Khôi phục
# bằng đúng lệnh --env-file ở trên.

# 2. Chạy suite (tự dựng Next dev :3100 qua webServer config):
pnpm --filter gmov-web exec playwright test

# Xem report lần chạy cuối:
pnpm --filter gmov-web exec playwright show-report
```

## Thiết kế

- `playwright.config.ts`: 1 worker, trace + video khi fail, webServer `next dev :3100`.
- `e2e/global-setup.ts`: chờ backend healthy → reset throttle redis → tái dùng
  1 account nền duy nhất (register bị throttle 3/giờ/IP). Riêng
  `moderation.spec` tự đăng ký thêm 1 reporter (xem mục spec kiểm duyệt).
- `e2e/global-teardown.ts`: xóa progress + favorites + watchlist của account test (user row
  ở lại vì chưa có API xóa account).
- Mỗi spec tự login trên context riêng. Hầu hết dùng `loginViaApi()` (POST
  `/api/auth/login`); riêng `moderation.spec` login qua UI (`loginViaUi`) ở cả
  hai context. KHÔNG dùng storageState chung: refresh rotation đốt cookie ngay
  lần dùng đầu tiên nên file cookie tĩnh chỉ đúng cho đúng 1 test.
- `app/e2e/player`: trang harness CHỈ tồn tại ở dev (`notFound()` khi
  production), dựng MovieDetail giả với m3u8 mẫu công khai để test đường HLS
  resume — vì episode upstream thật chỉ có embed (Batch 1 verdict C).

## Test quan trọng nhất (player resume)

`player.spec.ts`: play thật → chờ đủ 20s media → F5 → toast resume + clock
≈ t1 ± 5s. Lưu ý headless decode chậm hơn realtime nên test chờ theo media
clock (tối đa 150s), không phải 20s wall-clock.

**Flake cũ đã sửa (2026-09-17, decision #111):** assertion resume từng ra
`expected ~20s, got 0` sau reload. Đo timeline cho thấy đây là race của **test**
chứ không phải bug player: (a) `VideoPlayer` mặc định `autoPlay = true` cộng
`--autoplay-policy=no-user-gesture-required` của Playwright khiến nút overlay
"Phát" unmount giữa lúc click → Playwright retry tới hết timeout 240s (test
treo), và (b) test đọc `currentTime` **một lần** ngay sau toast, rơi vào khe
~100ms giữa toast (fetch progress xong) và seek (áp ở media event kế tiếp).
Fix: click best-effort (`timeout: 5s` + `catch`) và chờ **vị trí khác 0 đầu
tiên** (≥2s) thay vì đọc một lần. Resume đúng nhảy ngay tới ~t1; resume hỏng
phát lại từ 0 nên chỉ đạt 2s sau ~2s và vẫn bị bound ±5s bắt (đã verify bằng
mutation ép `target = 0` → fail `got 2.05`).

## Spec kiểm duyệt (`moderation.spec.ts`)

Phủ trọn một vòng report → hide → placeholder → unhide → cleanup trên bộ phim
thật, dùng **hai** browser context độc lập (moderator + reporter) thay vì
storageState chung:

1. `setRole` promote account nền của run lên `moderator` bằng CLI
   (`docker compose exec api python -m app.cli set-role <username> moderator`,
   chạy từ repo root). Không gọi được docker/CLI → `test.skip` kèm lý do.
2. Đăng ký **thêm MỘT account reporter** mới (ngoài account nền) để báo cáo;
   register throttle `3/giờ/IP` (Batch 2) nên nếu cạn hạn mức spec `skip` kèm
   lý do thay vì fail. `global-setup` reset redis `ratelimit:*` trước mỗi run
   nên bình thường vẫn đủ quota cho 1 account.
3. Moderator tạo bình luận trên `/phim/<slug>`; reporter mở dialog, chọn lý do
   `Spam`, gửi → trigger hiện optimistic "Đã báo cáo" (test thấy ngay, không
   chờ refetch).
4. Moderator vào `/admin/reports`, bấm "Ẩn" ở card `open`.
5. Reporter F5 → card hiện placeholder "Bình luận đã bị ẩn", body gốc biến mất.
6. Moderator chuyển filter "Đã xử lý" (report đã `resolved`), bấm "Bỏ ẩn";
   reporter F5 → bình luận trở lại.
7. Cleanup: moderator xóa bình luận của chính mình (`Xóa bình luận`, accept
   `dialog` confirm của trình duyệt) và hạ account nền về `user` — test để lại
   data sạch ngoài row user.

Spec gọi `skipIfNoUpstream()` như các spec cần data khác, timeout 150s, và tái
dùng `commentCard()` (locator `div.rounded-xl`) để bám đúng card theo text.

Test thứ hai — `ban the comment author from the queue, then unban` — phủ luồng
cấm tài khoản: author (1 account đăng ký mới) đăng bình luận qua API, **account
nền** (đang là moderator) nộp báo cáo qua API, moderator bấm "Cấm" trên card
`/admin/reports` (accept `window.confirm`) → assert pill "Đã cấm"; kiểm tra
khoá tức thì bằng `rawApi` (token cũ `401 ACCOUNT_BANNED`, login `403`), rồi
"Bỏ cấm" và assert token cũ dùng lại được. Chỉ đăng ký **một** account: cả file
dùng 2/3 quota `3 tài khoản/giờ/IP`, tránh `skip` vì throttle (đã từng dính khi
test này còn đăng ký 2 account). Cleanup xoá bình luận qua API (xoá comment →
cascade xoá report) + hạ account nền về `user`.

## Spec profiles (`profiles.spec.ts`)

4 test phủ M1, **chỉ dùng account nền** — KHÔNG đăng ký account nào (register
bị throttle `3 tài khoản/giờ/IP`, đã từng dính). Cách ly được chứng minh bằng
các profile tạo/xoá bên trong từng test; không cần data upstream (favorites
nhận slug tuỳ ý) nên spec này không skip khi CDN chặn. Timeout 120s/test.

1. `second profile keeps its own My list...` — tạo profile thứ hai → My list
   tách biệt → switch qua UI `/profiles` → data khác → quay lại profile đầu
   thấy nguyên vẹn; xoá profile đã tạo qua `/profiles/manage` (không PIN →
   `window.confirm`).
2. `a locked profile asks for its PIN` — đặt PIN → switch từ UI đòi PIN; PIN sai
   hiện `alert` "PIN không đúng"; PIN đúng thì switch thành công.
3. `the default profile cannot be deleted and the sixth is rejected` — hàng
   profile mặc định không có nút xoá; tạo tới `max` rồi profile thứ 6 bị
   server từ chối `409 PROFILE_LIMIT_REACHED`.
4. `deleting a profile removes only its data` — xoá profile có PIN (dialog nhập
   PIN): data của profile đó mất, profile khác nguyên vẹn, và scope của profile
   đã xoá trả `404 PROFILE_NOT_FOUND`.

Cleanup dùng helper `resetProfiles` (xoá PIN + xoá mọi profile non-default) và
xoá favorites đã thêm, best-effort để trả account về profile mặc định.

## Spec onboarding & gợi ý (`onboarding.spec.ts`)

4 test phủ M2, **chỉ dùng account nền, không đăng ký tài khoản nào**. Mỗi test
tạo 1–2 profile phụ rồi dọn trong `finally`: reset quyền sở thích bằng
`DELETE /me/preferences` qua `rawApi`, xoá profile (`resetProfiles`), và đưa
session trình duyệt về profile mặc định. timeout 150s.

Có **hai guard skip hiện rõ**:

- `skipIfNoUpstream()` — poster ở bước 2 lấy từ listing upstream thật.
- **Catalog probe** trong `beforeAll`: gọi có xác thực
  `GET /api/v1/me/recommendations?limit=50` bằng account nền; `items` rỗng ⇒
  `catalog_items` rỗng ⇒ mỗi test `test.skip(true, "catalog snapshot rỗng — chạy
  `python -m app.cli refresh-catalog`")`. Seed bằng:
  `docker compose exec -T api python -m app.cli refresh-catalog --pages 1`.

Test chỉ khẳng định **luật** (rail hiện/ẩn, guard, poster like đã ghi nhận),
không so nội dung gợi ý — tránh flake do cache TTL/thứ tự.

1. `a new profile onboards and gets a personal rail` — profile mới → switch qua
   UI `/profiles` → `/onboarding` chọn thể loại + thích ≥1 poster → "Bắt đầu
   xem" → về `/` thấy heading **"Gợi ý cho bạn"** và ít nhất một card.
2. `skipping onboarding hides the personal rail and does not trap` — "Bỏ qua" ở
   bước 1 → về `/`, chờ response `/me/recommendations` rồi assert **không** có
   heading "Gợi ý cho bạn" (fallback "Phổ biến"/"Mới cập nhật" hoặc ẩn); vào lại
   `/onboarding` bị guard đẩy về `/` (đã skip nên không kẹt).
3. `redo preferences reopens onboarding and the rail comes back` — onboard →
   `/profiles/manage` bấm "Làm lại sở thích `<name>`" (accept
   `window.confirm`) → `DELETE /me/preferences` + mở `/onboarding?again=1` →
   hoàn tất lại → rail vẫn render.
4. `each profile keeps its own personal rail across switches` — onboard profile
   A (gu này) và profile B (gu khác) → switch qua lại → rail của mỗi profile
   vẫn render. Không assert nội dung y hệt (cache TTL làm thứ tự nhiễu).

Lưu ý: rail chỉ nằm trên `/`, nên sau mỗi lần switch qua UI phải quay về `/`
mới assert.

## CI

E2E không chạy trên CI (chỉ chạy local): suite cần upstream thật + stream
mẫu ngoài mạng, không ổn định trên runner. CI chỉ gate backend (ruff +
pytest unit), frontend (lint/typecheck/build) và docker build. Chạy local:

```bash
PLAYWRIGHT_BACKEND_URL=http://localhost:8008 pnpm --filter gmov-web exec playwright test
```

## Fail-open khi mất mạng ngoài (không phải skip mù)

Upstream đứng sau Cloudflare và chặn IP datacenter (xác minh: `server:
cloudflare` + CI fail đúng 7 specs cần data, 3 specs auth thuần nội bộ vẫn
pass). `global-setup` probe 2 thứ và ghi `e2e/.probe.json`:

- `upstream`: backend trả `latest` có items (fresh CI redis không có stale
  cache nên đây chính là "runner có tới được nguồn không").
- `mux`: sample HLS stream trả playlist `#EXTM3U` thật.

`browse`/`library`/`moderation` skip khi `!upstream`, `player` skip khi `!mux`
— skip HIỆN rõ trong report với lý do, không phải pass giả. Auth specs KHÔNG
bao giờ skip (chỉ đụng code của ta). Test skip path local: `E2E_NET=down`.
