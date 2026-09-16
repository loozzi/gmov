# Comment moderation API (Feature: kiểm duyệt bình luận)

Cho phép người dùng đã đăng nhập báo cáo bình luận; đủ số người báo cáo thì
bình luận tự động bị ẩn chờ duyệt; moderator/admin có hàng đợi để ẩn/bỏ ẩn
bình luận và bỏ qua báo cáo.

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
| GET | `/me/reports/{comment_id}/status` | Bearer access | — | 200 `{"reported": bool}` |

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

`CommentOut`/`ReplyOut` có thêm `is_hidden: bool` và `body` đổi thành `str |
null`:

- Ẩn danh / user thường: bình luận bị ẩn trả `body: null` (client render
  placeholder "Bình luận đã bị ẩn"), `replies[]` và `reply_count` vẫn giữ.
- Người xem có role `moderator`/`admin`: `body` được trả đầy đủ kể cả khi ẩn.

## Admin (prefix `/admin`)

Mọi route yêu cầu dependency `require_role("moderator","admin")`: thiếu/sai
token → `401`; đã đăng nhập nhưng role không đủ → `403 FORBIDDEN`.

| Method | Path | Params | Success |
|--------|------|--------|---------|
| GET | `/admin/reports` | `status?` (`open\|resolved\|dismissed`), `page=1`, `per_page=20` (≤100) | 200 `PaginatedReports` |
| POST | `/admin/comments/{comment_id}/hide` | — | 200 `{"ok": true, "is_hidden": true}` |
| POST | `/admin/comments/{comment_id}/unhide` | — | 200 `{"ok": true, "is_hidden": false}` |
| POST | `/admin/reports/{report_id}/dismiss` | — | 200 `{"ok": true}` |

`status` không hợp lệ → 422. `PaginatedReports = {items: ReportItem[], page,
per_page, total_items, open_total}`; `open_total` là tổng số báo cáo `open`
**bất kể filter**, dùng cho badge trên UI.

`ReportItem = {id, reason, note, status, created_at, reporter: CommentUser,
comment: {id, body, is_hidden, movie_slug, user: CommentUser, created_at}}`.
Sắp xếp mới nhất trước. `CommentUser = {username, display_name}`.

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

## Auto-hide

Đếm số báo cáo `open` từ các reporter **khác nhau** cho một bình luận. Khi đạt
`COMMENT_REPORT_HIDE_THRESHOLD` (mặc định 3), hệ thống đặt `is_hidden=true`.
Báo cáo vẫn giữ `open` để moderator duyệt (auto-hide không resolve). Báo cáo
mới nhắm vào bình luận đã ẩn bị từ chối `409 COMMENT_HIDDEN`. Hide thủ công
của moderator mới là thao tác resolve báo cáo.

## Config

| Setting | Env | Mặc định |
|---------|-----|----------|
| `comment_report_hide_threshold` | `COMMENT_REPORT_HIDE_THRESHOLD` | `3` |

Có mặt trong `.env.example` và service `api` của `docker-compose.yml`.

## Error codes

`CANNOT_REPORT_OWN` (422), `COMMENT_HIDDEN` (409), `REPORT_NOT_FOUND` (404),
`FORBIDDEN` (403). `INVALID_ROLE` có trong map lỗi phía web nhưng backend
chưa phát mã này: CLI chặn role sai bằng argparse `choices` (thoát code 2).
