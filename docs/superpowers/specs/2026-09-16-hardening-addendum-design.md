# Hardening & debt addendum — 2026-09-16

Follow-up to `2026-09-16-comment-moderation-design.md`. Scope approved by the
product owner while closing review findings and `docs/todo.md` items.

## 1. Moderation hardening

- **Auto-hide race**: `report_service.create` must lock the target comment row
  (`SELECT ... FOR UPDATE`) before counting open reports, so two concurrent
  reports cannot both miss the threshold. SQLite (tests) ignores `FOR UPDATE`;
  the guarantee applies to PostgreSQL.
- **Auth resolution DRY**: extract a single `_resolve_user(db, token)` in
  `app/core/deps.py` raising the existing `AppException` messages;
  `get_current_user` delegates to it, `get_optional_user` returns `None` on
  any `AppException`.
- **Rollback consistency**: `unhide_comment` and `dismiss` use the same
  try/except-rollback-raise pattern as `create`/`hide_comment`.
- **Schema/metadata parity**: name the `CommentReport` unique constraint
  `uq_comment_reports_comment_reporter` and add
  `CheckConstraint("role IN ('user','moderator','admin')", name="ck_users_role")`
  to the `User` model so `create_all` matches the Alembic schema. No migration
  needed (the migration already created both).
- **CLI**: ensure `engine.dispose()` always runs even when argparse exits.
- **`reported` on comments**: `GET /api/v1/comments` gains a `reported: bool`
  field on `CommentOut`/`ReplyOut` (always `false` for anonymous). When the
  viewer is signed in, `comment_service.list_paginated` batch-loads the
  viewer's reports for the returned comment ids. This removes the frontend's
  per-comment status requests. `GET /me/reports/{comment_id}/status` is kept
  for compatibility.

## 2. Auth debt (`docs/todo.md` #2, #5)

### Refresh-token reuse detection (#2)

Add `family_id` to `refresh_tokens` (one family per login session).
- Login/register open a new family (`family_id = uuid4()`).
- Normal rotation keeps the family; a recent-revoked reuse inside the 30s
  grace window is still treated as duplicate delivery and re-issued.
- A revoked token presented after the grace window is theft: revoke every
  still-active token in that family and return `401 INVALID_REFRESH_TOKEN`.
- Logout keeps deleting the single row (immediate effect).

Migration: add `family_id` (nullable, backfilled from `id`), then make it
NOT NULL, chained after the current head `b7c1d9e2f3a4`. SQLite-compatible via
`batch_alter_table`.

### Login rate-limit key (#5)

Change the brute-force bucket key from IP-only to `ip + username`
(`ratelimit:login-fail:{ip}:{username.lower()}`) so shared NATs do not share a
bucket. `check_login_allowed`, `record_login_failure`, `clear_login_failures`
take `(ip, username)`.

## 3. Frontend polish

- Consume `reported` from the comments payload; delete `useReportStatus`.
- Surface server error codes via `toVietnameseMessage(error)` in report and
  moderation mutations instead of hardcoded toasts.
- Disable the report dialog close/cancel while a submit is pending.
- Show a loading affordance when switching status tabs/pages while
  `keepPreviousData` displays stale rows.

## 4. Structure refactor

- Move the two report routes out of `app/api/v1/routers/me.py` into a new
  `app/api/v1/routers/reports.py` (`prefix="/me"`, same paths), registered in
  `app/api/v1/__init__.py`.
- Extract `CommentItem` / `ReplyItem` / `CommentBody` from
  `components/movies/comment-section.tsx` into
  `components/movies/comment-item.tsx`.
- Add `components/ui/dialog.tsx` (Radix) and refactor `report-dialog.tsx` to
  use it.

## Non-goals

`docs/todo.md` #6 (health 200, intentional), #14 (registry push), #16 off-site
backup, #17 CSP nonce — these need external services/decisions, left as debt.
Moderation features #18-#21 remain future work.
