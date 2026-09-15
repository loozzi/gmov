# Auth API (Phase 1)

Base: `/api/v1`. All errors are JSON `{"detail": ..., "code": ...}`.

## Endpoints

| Method | Path | Auth | Body | Success |
|--------|------|------|------|---------|
| POST | `/auth/register` | no | `{email, username(3–32, `[a-zA-Z0-9_.]`), password(≥8)}` | 201 `UserOut` |
| POST | `/auth/login` | no | OAuth2 form `username` (= email **or** username) + `password` | 200 `TokenPair` |
| POST | `/auth/refresh` | no | `{refresh_token}` (rotates: old revoked, new pair issued) | 200 `TokenPair` |
| POST | `/auth/logout` | no | `{refresh_token}` (idempotent, always 200) | 200 `{"ok": true}` |
| GET | `/users/me` | Bearer access | — | 200 `UserOut` |
| PATCH | `/users/me` | Bearer access | `{display_name?, avatar_url?}` | 200 `UserOut` |

`TokenPair = {access_token, refresh_token, token_type: "bearer"}`.
`UserOut = {id, email, username, display_name, avatar_url, is_active, created_at}`
(never includes password hash).

## Tokens

- Access: 30 min (`ACCESS_TOKEN_EXPIRE_MINUTES`), claim `type=access`.
- Refresh: 30 days (`REFRESH_TOKEN_EXPIRE_DAYS`), claim `type=refresh` + `jti`,
  persisted in `refresh_tokens` for rotation/revocation.
- Wrong `type`, expired, or unknown user → 401 `{"detail": ..., "code": "UNAUTHORIZED"}`
  (or `INVALID_REFRESH_TOKEN` on `/refresh`).

## Error codes

`EMAIL_TAKEN` / `USERNAME_TAKEN` (409), `INVALID_CREDENTIALS` (401),
`ACCOUNT_DISABLED` (403), `INVALID_REFRESH_TOKEN` (401),
`UNAUTHORIZED` (401), `VALIDATION_ERROR` (422), `HTTP_ERROR`,
`INTERNAL_ERROR` (500).

## Notes

- Registration does NOT auto-login; the client calls `/login` afterwards.
- Logout only needs the refresh token (no access token required).
- Health: `GET /health` → `{"status": "ok|degraded", "database": "up|down",
  "redis": "up|down"}` (always HTTP 200 so orchestrators don't flap).
