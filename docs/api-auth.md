# Auth API (Phase 1)

Base: `/api/v1`. All errors are JSON `{"detail": ..., "code": ...}`.

## Endpoints

| Method | Path | Auth | Body | Success |
|--------|------|------|------|---------|
| POST | `/auth/register` | no | `{email, username(3–32, `[a-zA-Z0-9_.]`), password(≥8)}` + honeypot `website` (phải để trống) | 201 `UserOut` |
| POST | `/auth/login` | no | OAuth2 form `username` (= email **or** username) + `password` | 200 `TokenPair` |
| POST | `/auth/refresh` | no | `{refresh_token}` (rotates: old revoked, new pair issued) | 200 `TokenPair` |
| POST | `/auth/logout` | no | `{refresh_token}` (idempotent, always 200) | 200 `{"ok": true}` |
| GET | `/users/me` | Bearer access | — | 200 `UserOut` |
| PATCH | `/users/me` | Bearer access | `{display_name?, avatar_url?}` | 200 `UserOut` |

`TokenPair = {access_token, refresh_token, token_type: "bearer"}`.
`UserOut = {id, email, username, display_name, avatar_url, is_active, created_at}`
(never includes password hash).

## Tokens

- Access: 30 min (`ACCESS_TOKEN_EXPIRE_MINUTES`), claim `type=access` +
  `sub` (user id) + `sid` + `pid`. `sid` = jti của refresh session đã phát hành
  access token; `pid` = profile đang hoạt động của phiên **và chỉ xuất hiện sau
  khi phiên chọn profile** (`POST /me/profiles/{id}/switch`, đã qua PIN nếu
  profile có PIN). Nhờ đó mỗi thiết bị nhớ profile riêng và PIN được enforce ở
  server trên mọi request.
- Refresh: 30 days (`REFRESH_TOKEN_EXPIRE_DAYS`), claim `type=refresh` + `jti`,
  persisted in `refresh_tokens` (kèm `profile_id`) for rotation/revocation.
- Wrong `type`, expired, or unknown user → 401 `{"detail": ..., "code": "UNAUTHORIZED"}`
  (or `INVALID_REFRESH_TOKEN` on `/refresh`).
- **Login/Register KHÔNG chọn profile**: cặp token phát ra không có `pid`, kể cả
  profile mặc định — nên PIN của nó vẫn có hiệu lực (#136).
- **`pid` vắng mặt = chưa chọn profile** → mọi endpoint gắn profile trả `403
  PROFILE_REQUIRED`; muốn tiếp tục phải gọi `POST /me/profiles/{id}/switch`.
  **`pid` trỏ profile đã bị xoá** → phiên được đưa về "chưa chọn"
  (`refresh_tokens.profile_id = NULL`) rồi `403 PROFILE_REQUIRED`. **`pid` thuộc
  user khác hoặc hỏng** → `404 PROFILE_NOT_FOUND` (không lộ profile của người
  khác). Ban được kiểm **trước** khi resolve profile nên user bị cấm vẫn `401
  ACCOUNT_BANNED` dù `pid` hợp lệ. Khi refresh, `profile_id` NULL hoặc trỏ profile
  đã xoá → token mới **không có `pid`** (không tự nhảy về profile mặc định).
  Chi tiết: `docs/api-profiles.md`.
- **Register tạo profile mặc định** (`name = "Mặc định"`, `position = 0`,
  `is_default = true`) trong cùng transaction với user, nên mọi tài khoản luôn
  có ít nhất một profile. Register vẫn KHÔNG auto-login (client gọi `/login`).

## Error codes

`EMAIL_TAKEN` / `USERNAME_TAKEN` (409), `INVALID_CREDENTIALS` (401),
`ACCOUNT_DISABLED` (403), `INVALID_REFRESH_TOKEN` (401),
`BOT_DETECTED` (400, honeypot có giá trị),
`UNAUTHORIZED` (401), `VALIDATION_ERROR` (422), `HTTP_ERROR`,
`INTERNAL_ERROR` (500).

## Throttling

- Login sai: 5 lần / 15 phút / IP → 429 `RATE_LIMITED` + header `Retry-After`.
- Register: 3 tài khoản / IP / giờ, 10 / IP / ngày → 429 + `Retry-After`.
  IP client đọc từ `X-Forwarded-For` chỉ khi peer là proxy nội bộ tin cậy
  (`TRUSTED_PROXIES`, mặc định dải private + loopback).

## Notes

- Registration does NOT auto-login; the client calls `/login` afterwards.
- Logout only needs the refresh token (no access token required).
- Health: `GET /health` → `{"status": "ok|degraded", "database": "up|down",
  "redis": "up|down"}` (always HTTP 200 so orchestrators don't flap).
