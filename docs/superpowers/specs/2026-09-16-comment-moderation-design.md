# Comment moderation — design spec (2026-09-16)

Status: approved by product owner before implementation.

## Goal

Give the public comment system a moderation path: any signed-in user can report
a comment; reports from enough distinct users auto-hide the comment pending
review; moderators/admins get a queue to hide/unhide comments and dismiss
reports.

Non-goals (YAGNI, explicitly out of scope): banning users, spoiler tags, hard
delete by moderators, moderator email notifications, keyword auto-moderation,
per-movie comment locks, appeals.

## Roles

`users.role` is a string enum `user | moderator | admin`, default `user`.
Stored with `Enum(native_enum=False)` (VARCHAR + CHECK) so SQLite tests and
Alembic migrations stay simple and no PostgreSQL enum type is created.

First admin is promoted with a CLI (no hidden auto-promotion):

```
docker compose exec api python -m app.cli set-role <username> <role>
```

## Data model

### `users`
- new `role` column, `NOT NULL`, `server_default='user'`, CHECK constraint.

### `comments`
- new `is_hidden` boolean column, `NOT NULL`, `server_default=false`.
- Existing owner-only hard delete is unchanged. Moderators only toggle
  `is_hidden`.

### new table `comment_reports`
| column | type | notes |
|--------|------|-------|
| id | UUID pk | |
| comment_id | UUID FK comments ON DELETE CASCADE | indexed |
| reporter_id | UUID FK users ON DELETE CASCADE | indexed |
| reason | VARCHAR | `spam \| harassment \| spoiler \| other` |
| note | TEXT nullable | max 500 chars, app-validated |
| status | VARCHAR | `open \| resolved \| dismissed`, server_default `open`, indexed |
| resolved_by | UUID FK users nullable | moderator who acted |
| resolved_at | DATETIME(timezone) nullable | |
| created_at/updated_at | via `TimestampMixin` | |

Constraint: `UNIQUE(comment_id, reporter_id)` — one report per user per comment.

## API contracts

### User-facing

`POST /api/v1/me/reports`
- Auth required. Rate limit 10/min/user, Redis fixed window, fail-open.
- Body: `{comment_id: UUID, reason: "spam"|"harassment"|"spoiler"|"other", note?: string (≤500)}`
- Success: `201 {id, status: "open"}` when created; `200` with the existing row
  when the same user already reported the comment (idempotent).
- Errors:
  - `404 COMMENT_NOT_FOUND` — comment does not exist.
  - `422 CANNOT_REPORT_OWN` — reporter is the comment author.
  - `409 COMMENT_HIDDEN` — target comment is already hidden.
  - `422 VALIDATION_ERROR` — bad reason / note too long.

`GET /api/v1/me/reports/{comment_id}/status`
- Auth required. `200 {reported: bool}`.

`GET /api/v1/comments` (existing, extended)
- Now accepts an **optional** access token (`get_optional_user`): invalid or
  missing token → anonymous, never 401.
- `CommentOut` / `ReplyOut` gain `is_hidden: bool` and `body` becomes
  `str | null`.
- Anonymous / normal user: hidden comment → `body: null` (placeholder rendered
  by the client), replies are still returned.
- Viewer with role `moderator`/`admin`: `body` returned even when hidden.

### Admin (prefix `/api/v1/admin`, dependency `require_role("moderator","admin")`)
- Missing/invalid token → `401`; authenticated but insufficient role → `403 FORBIDDEN`.

`GET /api/v1/admin/reports?status=open&page=1&per_page=20`
- `status` optional; when provided must be one of the three values else `422`.
- Response: `{items: ReportItem[], page, per_page, total_items, open_total}`.
- `ReportItem` = `{id, reason, note, status, created_at, reporter: CommentUser,
  comment: {id, body, is_hidden, movie_slug, user: CommentUser, created_at}}`.
- `open_total` is the count of all `open` reports regardless of the filter.

`POST /api/v1/admin/comments/{comment_id}/hide`
- Sets `is_hidden=true`, resolves every `open` report of that comment
  (`status=resolved`, `resolved_by=current admin`, `resolved_at=now`) in one
  commit. Returns `{ok: true, is_hidden: true}`. `404 COMMENT_NOT_FOUND`.

`POST /api/v1/admin/comments/{comment_id}/unhide`
- Sets `is_hidden=false`. Does not resurrect resolved reports.
  Returns `{ok: true, is_hidden: false}`. `404 COMMENT_NOT_FOUND`.

`POST /api/v1/admin/reports/{report_id}/dismiss`
- Sets `status=dismissed`, `resolved_by`, `resolved_at`; comment untouched.
  Idempotent when already dismissed. `404 REPORT_NOT_FOUND` when unknown.

### Auto-hide rule

Count `open` reports from distinct reporters for the comment. When the count
reaches `COMMENT_REPORT_HIDE_THRESHOLD` (default 3), set `is_hidden=true`.
Reports stay `open` for moderator review (auto-hide does not resolve them).
New reports against an already-hidden comment are rejected with
`COMMENT_HIDDEN`.

## Config

New setting `comment_report_hide_threshold: int = 3`, env
`COMMENT_REPORT_HIDE_THRESHOLD`. Added to `.env.example` and the `api` service
in `docker-compose.yml` in the same change.

## Error codes added

`CANNOT_REPORT_OWN`, `COMMENT_HIDDEN`, `REPORT_NOT_FOUND`, `FORBIDDEN`,
`INVALID_ROLE`.

## Frontend

- `User` type gains `role`; `AuthProvider` exposes `isModerator` / `isAdmin`.
- `useComments` sends the access token opportunistically (`auth: true` on the
  public endpoint is safe; no refresh loop) so moderators see hidden bodies.
- Comment UI: hidden comment renders a "Bình luận đã bị ẩn" placeholder while
  keeping replies; owners still see their delete button.
- Report action: flag button on each comment/reply for authenticated
  non-owners; dialog with reason radio group + optional note; shows
  "Đã báo cáo" once reported.
- Moderator inline actions: on the movie page, moderators/admins see the body
  of hidden comments plus Ẩn / Bỏ ẩn buttons.
- `/admin`: client layout role-gates (not signed in → `/login`; wrong role →
  `notFound()`), backend enforces for real. `middleware.ts` matcher adds
  `/admin` for the cookie-presence redirect. `/admin/page.tsx` redirects to
  `/admin/reports`. `/admin/reports` lists reports with status tabs and
  actions Ẩn / Bỏ ẩn / Bỏ qua.
- Account menu shows an "Quản trị" link only for moderators/admins.

## Testing

- Backend pytest (SQLite + fakeredis): report create/dedupe/own/hidden,
  auto-hide threshold boundary (distinct reporters), normal user gets 403 on
  admin routes, anonymous gets 401, hide resolves open reports, unhide,
  dismiss idempotency, comments list body masking (anon null vs moderator
  body), migration upgrade/downgrade, CLI set-role promote/demote/invalid
  role/unknown user.
- Frontend: `pnpm --filter gmov-web lint`, `typecheck`, `build`.
- Docs: `docs/api-moderation.md`, plus updates to `docs/api-library.md`,
  `docs/decisions.md`, `docs/todo.md`.

## Decisions to log in docs/decisions.md

1. `Enum(native_enum=False)` for role/reason/status — portable across SQLite
   tests and Postgres, no PG enum type migration.
2. Auto-hide keeps reports `open` (moderator still reviews); moderator hide
   auto-resolves them.
3. `/admin` gate is defense-in-depth UI only; FastAPI `require_role` is the
   authority.
4. `GET /comments` uses optional auth so one endpoint serves both anonymous
   readers and moderator-body visibility.
