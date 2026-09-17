# Profiles API (M1)

Quản lý nhiều profile kiểu Netflix trong một tài khoản (tối đa 5). Base:
`/api/v1/me`, mọi endpoint đều cần Bearer access token. Lỗi là JSON
`{"detail": ..., "code": ...}`.

Thiết kế/động cơ: `docs/superpowers/specs/2026-09-17-profiles-and-recommendations-design.md`.

## Endpoints

| Method | Path | Body | Success |
|--------|------|------|---------|
| GET | `/profile` | — | 200 `ProfileOut` — profile đang hoạt động của phiên |
| GET | `/profiles` | — | 200 `ProfileListOut` — mọi profile của tài khoản, kèm `is_current` |
| POST | `/profiles` | `ProfileCreateIn` | 201 `ProfileOut`; `409 PROFILE_LIMIT_REACHED` khi đủ 5; `409 PROFILE_NAME_TAKEN` |
| PATCH | `/profiles/{id}` | `ProfilePatchIn` | 200 `ProfileOut` — đổi tên/avatar (kể cả profile mặc định); `404 PROFILE_NOT_FOUND`; `409 PROFILE_NAME_TAKEN` |
| POST | `/profiles/{id}/switch` | `ProfileSwitchIn` | 200 `SwitchOut`; `403 PIN_REQUIRED`, `401 INVALID_PIN`, `404 PROFILE_NOT_FOUND`, `401 SESSION_STALE` |
| DELETE | `/profiles/{id}` | `ProfileSwitchIn` | 200 `SwitchOut`; `403 PIN_REQUIRED`, `401 INVALID_PIN`, `409 DEFAULT_PROFILE`, `404 PROFILE_NOT_FOUND` |
| PUT | `/profiles/{id}/pin` | `ProfilePinIn` | 200 `ProfileOut`; `400 INVALID_PASSWORD`, `404 PROFILE_NOT_FOUND` |

## Shapes

```jsonc
// ProfileOut
{
  "id": "uuid",
  "name": "Mặc định",
  "avatar": "popcorn",   // slug trong allowlist
  "position": 0,          // 0..4
  "has_pin": false,       // pin_hash IS NOT NULL; không bao giờ trả hash
  "is_default": true
}

// ProfileListItemOut = ProfileOut + { "is_current": bool }
// ProfileListOut = { "items": [ProfileListItemOut...], "max": 5 }

// ProfileCreateIn = { "name": str 1..32, "avatar": slug }
// ProfilePatchIn  = { "name"?: str 1..32, "avatar"?: slug }

// ProfileSwitchIn = { "pin"?: "1234" }   // regex ^\d{4}$
// ProfilePinIn    = { "password": str, "pin"?: "1234" | null }

// SwitchOut — DELETE non-active trả cả hai null
{ "access_token": "jwt" | null, "profile": ProfileOut | null }
```

- `name` được `trim`, dài 1..32, chặn trùng **không phân biệt hoa/thường**
  (service so `lower()`).
- `avatar` nằm trong allowlist 12 slug (`popcorn`, `rocket`, `cat`, `panda`,
  `robot`, `ghost`, `alien`, `ninja`, `pirate`, `dino`, `star`, `clover`);
  slug lạ → `422 VALIDATION_ERROR`.
- `position` khi tạo = slot trống nhỏ nhất trong `0..4` nên xoá rồi tạo lại
  không sinh khoảng trống vô hạn.

### DELETE trả gì?

- Xoá profile **không phải** profile đang dùng → `{"access_token": null,
  "profile": null}`; phiên hiện tại không đổi.
- Xoá **profile đang dùng** → phiên tự fallback về profile mặc định và response
  mang access token mới trỏ profile mặc định kèm `ProfileOut` của nó, để client
  thay token ngay (`setAccessToken` + `queryClient.clear()`).

Hard delete: dữ liệu của profile mất theo qua FK `ON DELETE CASCADE`
(`favorites`, `watchlist`, `watch_progress`, `ratings`).

## Error codes

| Code | HTTP | Khi nào |
|------|------|---------|
| `PROFILE_LIMIT_REACHED` | 409 | Tạo profile thứ 6 (đủ `MAX_PROFILES = 5`) |
| `PROFILE_NAME_TAKEN` | 409 | Tên trùng (case-insensitive) với profile khác cùng tài khoản |
| `DEFAULT_PROFILE` | 409 | Cố xoá profile `is_default = true` |
| `PROFILE_NOT_FOUND` | 404 | `{id}` không tồn tại **hoặc** không thuộc tài khoản hiện tại |
| `PIN_REQUIRED` | 403 | Profile có PIN nhưng request không gửi `pin` (switch/delete) |
| `INVALID_PIN` | 401 | `pin` sai |
| `INVALID_PASSWORD` | 400 | Mật khẩu tài khoản sai khi đặt/đổi/xoá PIN |
| `SESSION_STALE` | 401 | Switch khi access token thiếu claim `sid` |
| `RATE_LIMITED` | 429 | Vượt ngân sách PIN set hoặc PIN attempt (kèm `Retry-After`) |
| `VALIDATION_ERROR` | 422 | `avatar` ngoài allowlist, `pin` không đúng 4 chữ số, `name` sai độ dài |

## PIN rules

- PIN đúng **4 chữ số** (`^\d{4}$`), hash bằng passlib (bcrypt) vào
  `profiles.pin_hash`; không lưu thô, không log.
- **Switch** và **xoá** profile có PIN → phải nhập PIN **của chính profile đó**.
  Hai đường dùng **chung một bộ đếm** theo `(profile_id, IP)`
  (`ratelimit:pin:{profile_id}:{ip}`) với `PIN_MAX_ATTEMPTS = 5` /
  `PIN_WINDOW = 60`s → `429 RATE_LIMITED` + `Retry-After`. Đổi endpoint không
  mở thêm ngân sách.
- **Chỉ lần thử thất bại mới bị đếm** (thiếu PIN hoặc PIN sai); một lần PIN
  đúng không tiêu ngân sách, nên thao tác hợp lệ không bao giờ tự khoá mình.
- **Đặt/đổi/xoá PIN cần mật khẩu tài khoản** (`ProfilePinIn.password`, kiểm tra
  bcrypt với `users.hashed_password`). Trẻ con không biết mật khẩu nên không tự
  gỡ được khoá. Endpoint này có rate limit riêng theo IP
  (`ratelimit:pin-set:{ip}`, cùng `PIN_MAX_ATTEMPTS`/`PIN_WINDOW`).
- PIN sai → `401 INVALID_PIN`; thiếu khi đang cần → `403 PIN_REQUIRED` (khác
  nhau để UI biết khi nào mở dialog).

Cả hai key PIN nằm trong namespace `ratelimit:*` để E2E `global-setup` reset
được counters giữa các lần chạy.

## Session model

Profile là một phần của phiên đăng nhập, **không** phải header `X-Profile-Id`:
PIN chỉ có nghĩa khi server enforce trên mọi request.

- **Access token** mang claim `sub` (user id), `sid` (jti của refresh session đã
  phát hành nó), `pid` (profile đang hoạt động), `type`, `jti`, `exp`
  (`app/core/security.py`).
- **`refresh_tokens`** có cột `profile_id` UUID FK `profiles.id` `ON DELETE SET
  NULL`. Mỗi row = một phiên/thiết bị → **mỗi thiết bị nhớ profile riêng**;
  không dùng localStorage.
- **Thiếu `pid`** (token cũ phát trước khi deploy) → `deps` đối xử mềm và dùng
  profile **mặc định**, nên session cũ không chết.
- **`pid` lạ / profile đã xoá / thuộc user khác** → `404 PROFILE_NOT_FOUND`
  (không lộ sự tồn tại profile của người khác). Ban được kiểm **trước** khi
  resolve profile nên user bị cấm vẫn `401 ACCOUNT_BANNED`.
- **Switch cần `sid`**: thiếu → `401 SESSION_STALE`. `activate_session` ghi lại
  `refresh_tokens.profile_id` của đúng phiên đang gọi rồi phát access token mới.
- **Refresh**: đọc row theo `jti`; nếu `profile_id` là NULL hoặc trỏ profile đã
  bị xoá → fallback profile mặc định; access token mới luôn mang `sid` + `pid`.
- **Register** tạo user + profile mặc định (`is_default`) trong **cùng một
  transaction** (`app/services/user_service.py`).

## Migration

`79d983c25d9a_profiles_and_profile_scoped_data.py` tạo bảng `profiles`, thêm
`profile_id` cho `favorite`/`watchlist`/`rating`/`watch_progress`, backfill mọi
row cũ về profile mặc định của chủ rồi set `NOT NULL`, đổi unique/index sang
`profile_id` và bỏ `user_id`; thêm `refresh_tokens.profile_id` (nullable).

**Một chiều về dữ liệu**: `downgrade()` tái tạo `user_id` từ
`profiles.user_id` của profile sở hữu, nên dữ liệu của các profile **phụ** sẽ
**gộp về user** (schema cũ chỉ có một hàng mỗi user cho mỗi `movie_slug`).
Đây là lựa chọn chấp nhận: rollback trả về mô hình một-người-một-gu, có thể
mất tính tách biệt giữa các profile.

## Config

`MAX_PROFILES = 5` · `PIN_MAX_ATTEMPTS = 5` · `PIN_WINDOW = 60`
(`app/core/config.py`, `.env.example`, `docker-compose.yml`).
