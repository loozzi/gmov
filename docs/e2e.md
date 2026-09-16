# E2E testing (Playwright, Batch 4)

## Chạy local

```bash
# 1. Stack API sạch (KHÔNG dùng chung DB dev nếu không muốn lẫn data test):
docker compose down -v
docker compose --env-file /tmp/e2e.env up -d --build db redis api
# /tmp/e2e.env chỉ cần: POSTGRES_PORT=5432, REDIS_PORT=6379, API_PORT=8000
# (bỏ qua repo .env nếu port ở đó bị chiếm)

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
- Mỗi spec tự login qua `loginViaApi()` (POST `/api/auth/login` trên context
  riêng). KHÔNG dùng storageState chung: refresh rotation đốt cookie ngay lần
  dùng đầu tiên nên file cookie tĩnh chỉ đúng cho đúng 1 test.
- `app/e2e/player`: trang harness CHỈ tồn tại ở dev (`notFound()` khi
  production), dựng MovieDetail giả với m3u8 mẫu công khai để test đường HLS
  resume — vì episode upstream thật chỉ có embed (Batch 1 verdict C).

## Test quan trọng nhất (player resume)

`player.spec.ts`: play thật → chờ đủ 20s media → F5 → toast resume + clock
≈ t1 ± 5s. Lưu ý headless decode chậm hơn realtime nên test chờ theo media
clock (tối đa 150s), không phải 20s wall-clock.

**Flake đã biết (pre-existing, không phải regression):** assertion resume đôi
khi ra `expected ~20s, got 0` dù toast "Đã tiếp tục từ" vẫn hiện. Đã chứng minh
không do feature sau này (stash diff → fail y hệt; seed progress 60s → seek
đúng ~67s); nghi race giữa assert và seek hoặc `startedRef` latch — xem
`docs/decisions.md` (#69). Cần buổi debug riêng, không chặn round khác.

## Spec kiểm duyệt (`moderation.spec.ts`)

Phủ trọn một vòng report → hide → placeholder → unhide → cleanup trên bộ phim
thật, dùng **hai** browser context độc lập (moderator + reporter) thay vì
storageState chung:

1. `setModerator` promote account nền của run lên `moderator` bằng CLI
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
   `dialog` confirm của trình duyệt) — test để lại data sạch ngoài row user.

Spec gọi `skipIfNoUpstream()` như các spec cần data khác, timeout 150s, và tái
dùng `commentCard()` (locator `div.rounded-xl`) để bám đúng card theo text.

## CI

E2E không chạy trên CI (chỉ chạy local): suite cần upstream thật + stream
mẫu ngoài mạng, không ổn định trên runner. CI chỉ gate backend (ruff +
pytest unit), frontend (lint/typecheck/build) và docker build. Chạy local:

```bash
PLAYWRIGHT_BACKEND_URL=http://localhost:8008 pnpm --filter gmov-web exec playwright test
```

## Fail-open khi mất mạng ngoài (không phải skip mù)

Upstream đứng sau Cloudflare và chặn IP datacenter (xác minh: `server:
cloudflare` + CI fail đúng 6 specs cần data, 3 specs auth thuần nội bộ vẫn
pass). `global-setup` probe 2 thứ và ghi `e2e/.probe.json`:

- `upstream`: backend trả `latest` có items (fresh CI redis không có stale
  cache nên đây chính là "runner có tới được nguồn không").
- `mux`: sample HLS stream trả playlist `#EXTM3U` thật.

`browse`/`library` skip khi `!upstream`, `player` skip khi `!mux` — skip HIỆN
rõ trong report với lý do, không phải pass giả. Auth specs KHÔNG bao giờ skip
(chỉ đụng code của ta). Test skip path local: `E2E_NET=down`.
