# Comment moderation API (Feature: kiểm duyệt bình luận)

Cho phép người dùng đã đăng nhập báo cáo bình luận; đủ số người báo cáo thì
bình luận tự động bị ẩn chờ duyệt; moderator/admin có hàng đợi để ẩn/bỏ ẩn
bình luận và bỏ qua báo cáo. Bình luận chứa từ khoá trong blocklist bị ẩn ngay
khi tạo (auto-moderation) và cũng vào hàng đợi; moderator có thể cấm/bỏ cấm
tài khoản đăng spam.

Base: `/api/v1`. Mọi lỗi là JSON `{"detail": ..., "code": ...}` (xem
`docs/api-auth.md`).

## Roles

`users.role` là enum chuỗi `user | moderator | admin`, mặc định `user`,
lưu bằng `Enum(native_enum=False)` (VARCHAR + CHECK constraint) để test trên
SQLite và migration Alembic không cần tạo PostgreSQL enum type.

Không có auto-promotion ẩn; admin đầu tiên được cấp bằng CLI:

```bash
docker compose exec api python -m app.cli set-role <username> <role>
```

`role` phải là `user`, `moderator` hoặc `admin`; giá trị khác bị argparse từ
chối (CLI thoát code 2, không đụng DB). Username không tồn tại → in lỗi ra
stderr và thoát code 1. Thành công in `user '<username>' role set to '<role>'`.

## Báo cáo bình luận (user-facing)

| Method | Path | Auth | Body / Params | Success |
|--------|------|------|---------------|---------|
| POST | `/me/reports` | Bearer access (rate-limited 10 req/min/user) | `{comment_id, reason, note?}` | 201 `{id, status}` mới / 200 row cũ |
| GET | `/me/reports/{comment_id}/status` | Bearer access | — | 200 `{"reported": bool}` (giữ để tương thích; UI nay đọc từ `GET /comments`) |

`reason` ∈ `spam | harassment | spoiler | other`. `note` tùy chọn, tối đa 500
ký tự. Ràng buộc `UNIQUE(comment_id, reporter_id)` — mỗi người chỉ báo cáo một
bình luận một lần; gửi lại trả 200 kèm row cũ (idempotent, không tạo trùng).

Lỗi:

- `404 COMMENT_NOT_FOUND` — bình luận không tồn tại.
- `422 CANNOT_REPORT_OWN` — người báo cáo chính là tác giả bình luận.
- `409 COMMENT_HIDDEN` — bình luận đã bị ẩn (không nhận báo cáo mới).
- `422 VALIDATION_ERROR` — `reason` sai hoặc `note` quá 500 ký tự.
- `429 RATE_LIMITED` — quá 10 báo cáo/phút/user; fail-open khi Redis chết.

## Danh sách bình luận (mở rộng)

`GET /comments` (public) nay nhận access token **tùy chọn**
(`get_optional_user`): token thiếu/sai/hết hạn → coi như ẩn danh, **không bao
giờ 401**.

`CommentOut`/`ReplyOut` có thêm `is_hidden: bool`, `has_spoiler: bool` và `body`
đổi thành `str | null`:

- Ẩn danh / user thường: bình luận bị ẩn trả `body: null` (client render
  placeholder "Bình luận đã bị ẩn"), `replies[]` và `reply_count` vẫn giữ.
- Người xem có role `moderator`/`admin`: `body` được trả đầy đủ kể cả khi ẩn.

`CommentOut`/`ReplyOut` cũng có thêm `reported: bool` — `true` nếu người xem
đã báo cáo bình luận đó. Khi đã đăng nhập, server batch-load báo cáo của người
xem cho **toàn bộ** comment id trả về bằng một query (không N+1); ẩn danh luôn
nhận `false`. Field này thay cho việc client gọi
`GET /me/reports/{comment_id}/status` từng bình luận (endpoint status vẫn giữ
để tương thích ngược).

## Admin (prefix `/admin`)

Mọi route yêu cầu dependency `require_role("moderator","admin")`: thiếu/sai
token → `401`; đã đăng nhập nhưng role không đủ → `403 FORBIDDEN`.

| Method | Path | Params | Success |
|--------|------|--------|---------|
| GET | `/admin/reports` | `status?` (`open\|resolved\|dismissed`), `page=1`, `per_page=20` (≤100) | 200 `PaginatedReports` |
| POST | `/admin/comments/{comment_id}/hide` | — | 200 `{"ok": true, "is_hidden": true}` |
| POST | `/admin/comments/{comment_id}/unhide` | — | 200 `{"ok": true, "is_hidden": false}` |
| POST | `/admin/comments/{comment_id}/spoiler` | — | 200 `{"ok": true, "has_spoiler": true}` (idempotent) |
| POST | `/admin/comments/{comment_id}/unspoiler` | — | 200 `{"ok": true, "has_spoiler": false}` |
| POST | `/admin/reports/{report_id}/dismiss` | — | 200 `{"ok": true}` |
| POST | `/admin/users/{user_id}/ban` | body `{reason?}` (≤200 ký tự) | 200 `BannedUserOut` |
| POST | `/admin/users/{user_id}/unban` | — | 200 `BannedUserOut` |

`status` không hợp lệ → 422. `PaginatedReports = {items: ReportItem[], page,
per_page, total_items, open_total}`; `open_total` là tổng số báo cáo `open`
**bất kể filter**, dùng cho badge trên UI.

`ReportItem = {id, reason, note, status, source, created_at, reporter, comment}`
với `source ∈ user | auto`. Sắp xếp mới nhất trước.
`reporter: AdminCommentUser | null` — `null` với báo cáo do bộ lọc từ khoá tạo
(`source=auto`). `comment.user` cũng là `AdminCommentUser`.
`AdminCommentUser = {id, username, display_name, banned_at}` — có `id` để
moderator thao tác lên tài khoản và `banned_at` để UI render nút cấm/bỏ cấm mà
không cần request thứ hai. (`CommentUser` công khai ở `/comments` vẫn chỉ có
`username`, `display_name`.)

Hành vi:

- **hide**: đặt `is_hidden=true` và chuyển toàn bộ báo cáo `open` của bình
  luận đó sang `resolved` (`resolved_by` = moderator hiện tại,
  `resolved_at` = now) trong **một commit**. `404 COMMENT_NOT_FOUND`.
- **unhide**: đặt `is_hidden=false`, **không** hồi sinh báo cáo đã resolved.
  `404 COMMENT_NOT_FOUND`.
- **dismiss**: đặt `status=dismissed`, ghi `resolved_by`/`resolved_at`,
  **không đụng** bình luận. Idempotent khi đã dismissed. `404 REPORT_NOT_FOUND`
  khi không có row.

Xóa cứng bình luận vẫn chỉ dành cho chủ sở hữu (`DELETE /me/comments/{id}`);
moderator chỉ bật/tắt `is_hidden`.

### Cấm người dùng

`POST /admin/users/{user_id}/ban` đặt `users.banned_at = now` +
`users.ban_reason = reason`; `unban` xóa cả hai (no-op nếu chưa bị cấm). Cả hai
idempotent, trả `{id, username, banned_at, ban_reason}`.

- Không cấm được chính mình và không cấm được tài khoản role
  `moderator`/`admin` → `403 CANNOT_BAN_STAFF` (một moderator bị chiếm tài
  khoản không thể "dọn" cả ban quản trị).
- `404 USER_NOT_FOUND` khi id không tồn tại; cần `require_role` như mọi route
  admin khác.
- Hiệu lực tức thì: `deps._resolve_user` từ chối `banned_at is not null`
  (`401 ACCOUNT_BANNED`) nên **access token cũ chết ngay**; login trả
  `403 ACCOUNT_BANNED`; refresh token (kể cả token phát hành trước khi cấm) bị
  từ chối `401 INVALID_REFRESH_TOKEN`. Bỏ cấm thì token cũ dùng lại được (không
  cần đăng nhập lại).
- Cấm **không** ẩn bình luận cũ: đây là biện pháp lên tài khoản, không phải
  chỉnh sửa nội dung hồi tố. Nội dung spam đã bị ẩn bằng hide/auto-hide.

## Auto-hide

Đếm số báo cáo `open` từ các reporter **khác nhau** cho một bình luận. Khi đạt
`COMMENT_REPORT_HIDE_THRESHOLD` (mặc định 3), hệ thống đặt `is_hidden=true`.
Báo cáo vẫn giữ `open` để moderator duyệt (auto-hide không resolve). Báo cáo
mới nhắm vào bình luận đã ẩn bị từ chối `409 COMMENT_HIDDEN`. Hide thủ công
của moderator mới là thao tác resolve báo cáo. (Ngưỡng spoiler ở mục dưới hoạt
động độc lập và chỉ che mờ, không ẩn.)

Báo cáo do bộ lọc từ khoá tạo (`source=auto`, `reporter_id=NULL`) **không** được
đếm vào ngưỡng này: phép đếm là `count(distinct reporter_id)` và SQL bỏ qua
`NULL` — nếu không, vài lần auto-ẩn sẽ vô tình đạt ngưỡng của báo cáo người dùng.

## Spoiler veil (`has_spoiler`)

Che nội dung tiết lộ là chuyện **khác** ẩn kiểm duyệt: `is_hidden` gỡ bình luận
khỏi tầm đọc (`body: null` với non-staff), còn `has_spoiler` chỉ báo cho client
che mờ nội dung kèm nút "Nhấn để xem" — `body` vẫn được trả về (veil là tiện
ích cho người đọc, không phải hàng rào bảo mật), và client tự mở được không cần
gọi server. Staff (`moderator`/`admin`) không bị che.

- **Tác giả tự khai**: `POST /me/comments` nhận thêm `has_spoiler?: bool`
  (mặc định `false`) — dùng cho checkbox "Nội dung có spoiler" ở form bình luận.
- **Tự động theo ngưỡng**: khi một báo cáo `reason=spoiler` được tạo, đếm số
  reporter **khác nhau** đang có báo cáo `open` **cùng reason spoiler**; đạt
  `COMMENT_SPOILER_REPORT_THRESHOLD` (mặc định 2) → đặt `has_spoiler=true`.
  Báo cáo vẫn `open` để moderator duyệt (giống auto-hide), và ngưỡng ẩn
  (`COMMENT_REPORT_HIDE_THRESHOLD`, đếm **mọi** reason) vẫn độc lập.
- **Moderator sửa tay**: `/admin/comments/{id}/spoiler` và `/unspoiler` (cần
  thiết vì auto-veil phải có đường hoàn tác; cũng dùng để che bình luận không ai
  báo). Queue `/admin/reports` trả `comment.has_spoiler` + nút "Đánh dấu
  spoiler"/"Bỏ spoiler".
- `CommentVisibilityOut` (response của hide/unhide/spoiler/unspoiler) nay có
  `has_spoiler`.

## Auto-moderation theo từ khoá

`comment_service.create` (đường ghi duy nhất cho cả bình luận gốc lẫn trả lời)
so khớp `body` với `MODERATION_BLOCKED_KEYWORDS` **trước khi** lưu. So khớp
không phân biệt hoa/thường, **không phân biệt dấu tiếng Việt**, gộp khoảng
trắng (`normalize()` trong `services/moderation_filter.py`) và là khớp chuỗi
con — nên "CÁ   ĐỘ" khớp "cá độ", "ca do" cũng khớp. Không xử lý obfuscation
kiểu "s.p.a.m" (xem `docs/todo.md`).

Khi khớp: bình luận được lưu với `is_hidden=true` **và** một `CommentReport`
`source=auto, reason=spam, reporter_id=NULL, status=open` được tạo với `note`
liệt kê từ khoá khớp (`note` cắt còn 500 ký tự) → xuất hiện trong
`/admin/reports` như mọi báo cáo khác, moderator có thể bỏ ẩn (`unhide`) hoặc
dismiss. Mặc định danh sách rỗng = tắt hoàn toàn (không đổi hành vi cũ).

## Config

| Setting | Env | Mặc định |
|---------|-----|----------|
| `comment_report_hide_threshold` | `COMMENT_REPORT_HIDE_THRESHOLD` | `3` |
| `comment_spoiler_report_threshold` | `COMMENT_SPOILER_REPORT_THRESHOLD` | `2` |
| `moderation_blocked_keywords` | `MODERATION_BLOCKED_KEYWORDS` | rỗng (tắt) |

Có mặt trong `.env.example` và service `api` của `docker-compose.yml`.

## Error codes

`CANNOT_REPORT_OWN` (422), `COMMENT_HIDDEN` (409), `REPORT_NOT_FOUND` (404),
`USER_NOT_FOUND` (404), `CANNOT_BAN_STAFF` (403), `ACCOUNT_BANNED` (401/403),
`FORBIDDEN` (403). `INVALID_ROLE` có trong map lỗi phía web nhưng backend
chưa phát mã này: CLI chặn role sai bằng argparse `choices` (thoát code 2).
