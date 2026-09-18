# Profiles API (M1)

Quản lý nhiều profile kiểu Netflix trong một tài khoản (tối đa 5). Base:
`/api/v1/me`, mọi endpoint đều cần Bearer access token. Lỗi là JSON
`{"detail": ..., "code": ...}`.

Thiết kế/động cơ: `docs/superpowers/specs/2026-09-17-profiles-and-recommendations-design.md`.

## Endpoints

| Method | Path | Body | Success |
|--------|------|------|---------|
| GET | `/profile` | — | 200 `ProfileOut` — profile đang hoạt động của phiên; `403 PROFILE_REQUIRED` khi phiên chưa chọn profile |
| GET | `/profiles` | — | 200 `ProfileListOut` — mọi profile của tài khoản, kèm `is_current`; **chạy được cả khi chưa chọn profile** (danh sách là đường vào chooser) |
| POST | `/profiles` | `ProfileCreateIn` | 201 `ProfileOut`; `409 PROFILE_LIMIT_REACHED` khi đủ 5; `409 PROFILE_NAME_TAKEN` |
| PATCH | `/profiles/{id}` | `ProfilePatchIn` | 200 `ProfileOut` — đổi tên/avatar (kể cả profile mặc định); `403 PIN_REQUIRED`/`401 INVALID_PIN` khi profile có PIN; `404 PROFILE_NOT_FOUND`; `409 PROFILE_NAME_TAKEN` |
| POST | `/profiles/{id}/switch` | `ProfileSwitchIn` | 200 `SwitchOut` — **cách duy nhất** để có access token gắn profile (đã qua PIN nếu profile có PIN); `403 PIN_REQUIRED`, `401 INVALID_PIN`, `404 PROFILE_NOT_FOUND`, `401 SESSION_STALE` |
| DELETE | `/profiles/{id}` | `ProfileSwitchIn` | 200 `SwitchOut`; `403 PIN_REQUIRED`, `401 INVALID_PIN`, `409 DEFAULT_PROFILE`, `404 PROFILE_NOT_FOUND` |
| PUT | `/profiles/{id}/pin` | `ProfilePinIn` | 200 `ProfileOut`; `403 PIN_REQUIRED`, `401 INVALID_PIN`, `400 INVALID_PASSWORD`, `404 PROFILE_NOT_FOUND`; đặt/đổi PIN **thu hồi lựa chọn của các phiên khác** đang gắn profile |

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
// ProfilePatchIn  = { "name"?: str 1..32, "avatar"?: slug, "pin"?: "1234" }  // pin bắt buộc khi profile đã có PIN

// ProfileSwitchIn = { "pin"?: "1234" }   // regex ^\d{4}$
// ProfilePinIn    = { "password": str, "current_pin"?: "1234", "pin"?: "1234" | null }

// SwitchOut — DELETE luôn trả cả hai null (phiên không nhận profile kế nhiệm)
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

Luôn `{"access_token": null, "profile": null}`.

- Xoá profile **không phải** profile đang dùng → phiên hiện tại không đổi.
- Xoá **profile đang dùng** → phiên trở về **chưa chọn profile**
  (`refresh_tokens.profile_id = NULL`). Server **không** phát token cho profile
  mặc định: nếu profile đó có PIN thì việc "kế thừa" nó sẽ vô hiệu hoá PIN. Web
  đưa người dùng về `/profiles` để chọn lại (`queryClient.clear()` +
  `router.replace("/profiles")`).

Hard delete: dữ liệu của profile mất theo qua FK `ON DELETE CASCADE`
(`favorites`, `watchlist`, `watch_progress`, `ratings`).

## Error codes

| Code | HTTP | Khi nào |
|------|------|---------|
| `PROFILE_LIMIT_REACHED` | 409 | Tạo profile thứ 6 (đủ `MAX_PROFILES = 5`) |
| `PROFILE_NAME_TAKEN` | 409 | Tên trùng (case-insensitive) với profile khác cùng tài khoản |
| `DEFAULT_PROFILE` | 409 | Cố xoá profile `is_default = true` |
| `PROFILE_NOT_FOUND` | 404 | `{id}` không tồn tại **hoặc** không thuộc tài khoản hiện tại; `pid` claim hỏng |
| `PROFILE_REQUIRED` | 403 | Phiên chưa chọn profile (token không có `pid`, hoặc `pid` trỏ profile đã bị xoá) mà gọi endpoint gắn profile |
| `PIN_REQUIRED` | 403 | Profile có PIN nhưng request thiếu `pin` (switch/**rename**/delete) hoặc thiếu `current_pin` (đổi/xoá PIN) |
| `INVALID_PIN` | 401 | `pin` / `current_pin` sai |
| `INVALID_PASSWORD` | 400 | Mật khẩu tài khoản sai khi đặt/đổi/xoá PIN |
| `SESSION_STALE` | 401 | Switch khi access token thiếu claim `sid` |
| `RATE_LIMITED` | 429 | Vượt ngân sách PIN attempt dùng chung theo `(profile, IP)` (kèm `Retry-After`) |
| `VALIDATION_ERROR` | 422 | `avatar` ngoài allowlist, `pin` không đúng 4 chữ số, `name` sai độ dài |

## PIN rules

- PIN đúng **4 chữ số** (`^\d{4}$`), hash bằng passlib (bcrypt) vào
  `profiles.pin_hash`; không lưu thô, không log.
- **Switch**, **đổi tên/avatar**, **xoá** hoặc **đổi/xoá PIN của** profile có PIN →
  phải nhập PIN **của chính profile đó** (`switch`/`delete`/`PATCH` dùng `pin`,
  đổi PIN dùng `current_pin`): trang quản lý không phải lối vòng qua khoá. Bốn
  đường dùng **chung một bộ đếm** theo `(profile_id, IP)`
  (`ratelimit:pin:{profile_id}:{ip}`) với `PIN_MAX_ATTEMPTS = 5` /
  `PIN_WINDOW = 60`s → `429 RATE_LIMITED` + `Retry-After`. Đổi endpoint không
  mở thêm ngân sách.
- **Chỉ lần thử thất bại mới bị đếm** (thiếu PIN/`current_pin` hoặc sai); một
  lần PIN đúng không tiêu ngân sách, nên thao tác hợp lệ không bao giờ tự khoá
  mình.
- **Đặt/đổi/xoá PIN cần mật khẩu tài khoản** (`ProfilePinIn.password`, kiểm tra
  bcrypt với `users.hashed_password`). Trẻ con không biết mật khẩu nên không tự
  gỡ được khoá. Thứ tự kiểm tra: `current_pin` trước, mật khẩu tài khoản sau.
- **`current_pin` chỉ bắt buộc khi profile đã có PIN**: đặt PIN lần đầu hoặc
  "xoá" PIN khi profile chưa có PIN đều bỏ qua `current_pin`. Nhờ vậy không có
  ngõ cụt cho tài khoản chưa từng đặt PIN.
- PIN/`current_pin` sai → `401 INVALID_PIN`; thiếu khi đang cần → `403
  PIN_REQUIRED` (khác nhau để UI biết khi nào mở dialog).
- **Đặt/đổi PIN thu hồi lựa chọn của mọi phiên KHÁC đang gắn profile đó**
  (`refresh_tokens.profile_id = NULL`), kể cả access token chưa hết hạn: token
  mang `pid` không còn khớp `profile_id` của phiên mình → `403 PROFILE_REQUIRED`,
  buộc chọn lại + nhập PIN mới. Phiên vừa thao tác giữ nguyên (nó đã chứng minh
  mật khẩu tài khoản + `current_pin`). **Xoá PIN không thu hồi gì** (quyền chỉ
  mở rộng ra).

Key PIN nằm trong namespace `ratelimit:*` để E2E `global-setup` reset được
counters giữa các lần chạy.

## Session model

Profile là một phần của phiên đăng nhập, **không** phải header `X-Profile-Id`:
PIN chỉ có nghĩa khi server enforce trên mọi request.

- **Access token** mang claim `sub` (user id), `sid` (jti của refresh session đã
  phát hành nó), `type`, `jti`, `exp` (`app/core/security.py`), và `pid` (profile
  đang hoạt động) **chỉ khi phiên đã chọn profile**.
- **Login/Register không chọn profile**: `/auth/login` xác thực *tài khoản* rồi
  phát cặp token **không có `pid`**; profile mặc định cũng không được
  tự động kích hoạt, nên PIN của nó vẫn có hiệu lực.
- **`pid` vắng mặt = "chưa chọn"**, không phải "dùng mặc định": mọi endpoint gắn
  profile (`/me/profile`, `/me/favorites`, progress, ratings, recommendations…)
  trả `403 PROFILE_REQUIRED` cho tới khi client gọi `POST /me/profiles/{id}/switch`.
  Riêng `GET /me/profiles`, `POST /switch` và `DELETE` chạy ở tầng tài khoản
  (`get_session_context`, profile có thể `None`) để còn đường thoát; nhóm quản lý
  profile (`POST /profiles`, `PATCH /profiles/{id}`, `PUT .../pin`) chỉ cần
  `get_current_user` vì không phụ thuộc profile đang chọn.
- **`refresh_tokens`** có cột `profile_id` UUID FK `profiles.id` `ON DELETE SET
  NULL`. Mỗi row = một phiên/thiết bị → **mỗi thiết bị nhớ profile riêng**;
  không dùng localStorage.
- **Thiếu `pid`** (token cũ phát trước khi deploy, hoặc phiên mới chưa chọn) →
  `403 PROFILE_REQUIRED`. Token phát trước khi có profiles coi như "chưa chọn":
  một lần `switch` là dùng lại được, không có nhánh nào tự nhảy vào profile mặc
  định.
- **`pid` thuộc user khác** → `404 PROFILE_NOT_FOUND` (không lộ sự tồn tại
  profile của người khác). `pid` hỏng (không phải UUID) cũng `404`. Ban được
  kiểm **trước** khi resolve profile nên user bị cấm vẫn `401 ACCOUNT_BANNED`.
- **`pid` trỏ profile đã bị xoá → phiên về "chưa chọn"**: server ghi
  `refresh_tokens.profile_id = NULL` (best-effort — phiên đã logout thì bỏ qua)
  rồi trả `403 PROFILE_REQUIRED`; `GET /me/profiles` vẫn `200` nên client luôn có
  chooser để chọn lại. Không fallback về profile mặc định (có thể đang khoá PIN).
- **Token phải khớp lựa chọn của phiên**: `pid` trong access token bị so với
  `refresh_tokens.profile_id` của `sid`; lệch nhau (phiên đã switch ở tab khác,
  hoặc vừa bị thu hồi do đổi PIN) → `403 PROFILE_REQUIRED`. Nhờ vậy access token
  phát trước đó không dùng tiếp được. Token không có `sid` (cũ) bỏ qua phép so
  này; endpoint chỉ-cần-tài-khoản (`GET /me/profiles`, `switch`, `DELETE`) coi
  lệch là "chưa chọn" nên chooser luôn mở được.
- **Switch cần `sid`**: thiếu → `401 SESSION_STALE`. `activate_session` ghi lại
  `refresh_tokens.profile_id` của đúng phiên đang gọi rồi phát access token mới.
- **Refresh**: đọc row theo `jti`; `pid` mới = `refresh_tokens.profile_id`.
  NULL, hoặc trỏ profile đã bị xoá → token mới **không có `pid`** (phiên chưa
  chọn; client về chooser). Nhờ vậy đăng nhập lại sau khi profile bị xoá không
  bao giờ rơi vào profile mặc định mà không qua PIN.
- **Register** tạo user + profile mặc định (`is_default`) trong **cùng một
  transaction** (`app/services/user_service.py`).

> **Có thể thoát (multi-device)**: profile đang dùng bị xoá ở thiết bị khác thì
> request kế tiếp trên thiết bị này trả `403 PROFILE_REQUIRED` và `GET
> /me/profiles` vẫn `200`, nên UI hiển thị chooser + nút "Thêm profile" ngay mà
> không cần chờ access token hết hạn.

## Migration

`79d983c25d9a_profiles_and_profile_scoped_data.py` tạo bảng `profiles`, thêm
`profile_id` cho `favorites`/`watchlist`/`ratings`/`watch_progress`, backfill
mọi row cũ về profile mặc định của chủ rồi set `NOT NULL`, đổi unique/index
sang `profile_id` và bỏ `user_id`; thêm `refresh_tokens.profile_id`
(nullable).

**Một chiều về dữ liệu**: `downgrade()` tái tạo `user_id` từ
`profiles.user_id` của profile sở hữu, nên dữ liệu của các profile **phụ** sẽ
**gộp về user** (schema cũ chỉ có một hàng mỗi user cho mỗi `movie_slug`, và
một hàng mỗi `movie_slug` + `episode_slug` với `watch_progress`). Trước khi
tạo lại unique constraint cũ, mỗi bảng được **dedupe**: các hàng trùng khoá
giữa nhiều profile gộp còn **một hàng cập nhật gần nhất** (theo `updated_at`,
đồng hạng thì theo `id`), nên rollback không abort vì xung đột dữ liệu. Đây là
lựa chọn chấp nhận: rollback trả về mô hình một-người-một-gu, có thể mất tính
tách biệt giữa các profile.

## Làm lại sở thích (M2)

Mỗi hàng profile ở `/profiles/manage` có nút **"Làm lại sở thích `<name>`"**.

- **Chỉ làm lại được cho profile đang hoạt động.** Nếu profile đó không phải
  profile hiện tại, UI hiện thông báo tiếng Việt yêu cầu chuyển trước
  (`Hãy chuyển sang profile <name> trước khi làm lại sở thích.`) và **không**
  tự switch. Đây là **deviation có chủ đích** so với spec (spec nói switch kèm
  PIN dialog) — xem `docs/decisions.md`.
- Với profile hiện tại: xác nhận (`window.confirm`) → `DELETE /me/preferences`
  (204, reset trọng số **explicit**) → điều hướng `/onboarding?again=1`.
- Tham số `again=1` bỏ qua guard client-side (guard vốn bounce profile đã
  `onboarding_completed_at` về `/`), nên user làm lại được dù đã hoàn thành.
- Reset **không** mất trọng số hành vi (favorite/rating/progress) — chúng được
  tính lại lúc scoring; xem `docs/api-recommendations.md`.

## Config

`MAX_PROFILES = 5` · `PIN_MAX_ATTEMPTS = 5` · `PIN_WINDOW = 60`
(`app/core/config.py`, `.env.example`, `docker-compose.yml`).
