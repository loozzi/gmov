# Plan: moderation hardening + auth debt + polish + refactor

Spec addendum (binding): `docs/superpowers/specs/2026-09-16-hardening-addendum-design.md`
Prior spec: `docs/superpowers/specs/2026-09-16-comment-moderation-design.md`

## Global Constraints

- Backend: Python 3.12, FastAPI, SQLAlchemy 2.0 async, asyncpg/Alembic,
  Pydantic v2, pytest. `snake_case`; modules under ~300 lines; layered
  router → service → model (no DB access in routers). Full type hints.
  From `apps/api`: `uv run ruff check app tests` and
  `uv run pytest -q -m "not integration"` must pass (no network; SQLite +
  fakeredis). Never `-m integration`.
- Frontend: Next.js 15 App Router, TypeScript strict, no `any`. `camelCase`
  vars, `PascalCase` components. Server Components by default. From repo root:
  `pnpm --filter gmov-web lint`, `typecheck`, `build` must pass.
- Follow existing patterns; read neighbouring files first. Do NOT add code
  comments except where the file already uses them.
- Commits: Conventional Commits, English. At least one meaningful commit.
- Do NOT dispatch subagents; do all work yourself.

---

## Task 1: Moderation hardening + `reported` field

Independent of Task 2 (different files). Task 3 consumes the `reported` field.

### Deliverables

1. `apps/api/app/core/deps.py` — extract `_resolve_user(db, token) -> User`
   preserving current error messages (`"Token expired"`, `"Invalid token"`,
   both `UNAUTHORIZED` 401, plus type/sub/unknown-user checks).
   - `get_current_user` delegates to it.
   - `get_optional_user` returns `None` for missing token and catches
     `AppException` from `_resolve_user` → `None` (still never raises).
   - Keep `require_role` unchanged.

2. `apps/api/app/services/report_service.py`:
   - In `create`, after loading the comment, re-select it with
     `select(Comment).where(Comment.id == data.comment_id).with_for_update()`
     before the open-report count and the hide mutation. Keep the existing
     duplicate-before-hidden ordering (already correct). SQLite ignores
     `FOR UPDATE`; do not add SQLite-specific branches.
   - Add the same `try/except Exception: await db.rollback(); raise` wrapper
     used by `create`/`hide_comment` to `unhide_comment` and `dismiss`.

3. `apps/api/app/db/models/comment_report.py` — name the unique constraint
   `uq_comment_reports_comment_reporter`.

4. `apps/api/app/db/models/user.py` — add `__table_args__` with
   `CheckConstraint("role IN ('user','moderator','admin')", name="ck_users_role")`.
   Confirm the migration already creates the identical constraint (do NOT add
   a migration).

5. `apps/api/app/cli.py` — guarantee `engine.dispose()` runs on argparse
   `SystemExit` (move parsing inside the `try`, or use `try/finally`).

6. `reported` field:
   - `apps/api/app/schemas/library.py`: `ReplyOut` and `CommentOut` gain
     `reported: bool = False`.
   - `apps/api/app/services/comment_service.py`: `list_paginated` receives the
     `viewer` already; when `viewer is not None`, batch-query
     `CommentReport.reporter_id == viewer.id` for all returned top-level +
     reply ids and set `reported` per item. Import `CommentReport`. Anonymous
     (`viewer is None`) → all `False`, no extra query.

7. Tests (`apps/api/tests/test_moderation.py`, `test_moderation_data.py`):
   - `test_report_service_marks_hidden_at_threshold` must assert `is_hidden`
     is actually set (not just the row count); if it duplicates
     `test_auto_hide_threshold_distinct_reporters`, fold it in and remove the
     redundant test.
   - `test_admin_reports_filter_and_shape`: replace loose set-membership
     assertions with exact expected values.
   - Add: auto-hidden comment's reports stay `open`; dismissing a `resolved`
     report is a no-op (status unchanged, still 200); a signed-in viewer's
     `reported` flag is true only for comments they personally reported and
     false for anonymous.
   - `test_moderation_data.py`: derive `PREVIOUS_HEAD` from the migration
     module's `down_revision` instead of the hardcoded `"a1b2c3d4e5f6"`;
     replace the `settings.comment_report_hide_threshold == 3` assertion with a
     freshly constructed `Settings()` default check so an exported env var
     cannot break it.

### Verification

`uv run ruff check app tests`; `uv run pytest -q -m "not integration"`.

---

## Task 2: Auth debt — refresh reuse detection + composite login key

Independent of Task 1 (touches auth/refresh/migration only). Adds the ONLY
new migration in this plan, chained after head `b7c1d9e2f3a4`.

### Deliverables

1. `apps/api/app/db/models/refresh_token.py` — add
   `family_id: Mapped[uuid.UUID] = mapped_column(Uuid, index=True, nullable=False)`.

2. Migration `apps/api/app/alembic/versions/<hash>_refresh_token_family.py`:
   - `down_revision = "b7c1d9e2f3a4"`.
   - add `family_id` nullable, backfill `family_id = id`, then set NOT NULL.
     Use `op.batch_alter_table` for the alter steps so SQLite tests work.
   - working `downgrade()` dropping the column + its index.

3. `apps/api/app/services/auth_service.py`:
   - `_build_pair(user_id, family_id)` sets `family_id` on the new row.
   - `_issue_pair` / login / register start a NEW family (`uuid4()`).
   - `refresh`:
     - not revoked → normal rotation, new row keeps `row.family_id`.
     - revoked within `REFRESH_GRACE_SECONDS` → re-issue, same family.
     - revoked beyond grace → **reuse detected**: set `revoked_at = now` on
       every row of that family that is not yet revoked, commit, raise
       `AppException("Invalid refresh token", "INVALID_REFRESH_TOKEN", 401)`.
   - `logout` unchanged (deletes the single row).
   - Keep the single-transaction/rollback structure.

4. `apps/api/app/core/ratelimit.py` — change the login-failure key to
   `ratelimit:login-fail:{ip}:{username.lower()}`; the three login functions
   take `(ip: str, username: str)`.

5. `apps/api/app/api/v1/routers/auth.py` — pass `form.username` to
   `check_login_allowed` / `record_login_failure` / `clear_login_failures`.

6. Tests (`apps/api/tests/test_auth.py`):
   - reuse after grace → 401 AND every token in that family is revoked (a
     freshly rotated sibling token also fails).
   - reuse within grace still re-issues (existing test must keep passing).
   - a different family/session is NOT affected by another family's reuse.
   - login lockout: failures for one `(ip, username)` do not lock out a
     different username from the same IP.
   - migration upgrade → downgrade → upgrade still passes
     (`test_moderation_data.py` guards this; ensure it still chains).

### Verification

`uv run ruff check app tests`; `uv run pytest -q -m "not integration"`.

---

## Task 3: Frontend polish + consume `reported`

Depends on Task 1 (`reported` field). May run in parallel with Task 2 (separate
app). Base is the Task 1 commit.

### Deliverables

1. `apps/web/lib/reviews.ts`:
   - `MovieComment` and `CommentReply` gain `reported: boolean`.
   - Remove `useReportStatus` and its `MyReportStatus`/endpoint usage; the
     report state now comes from the comment payload.
2. `apps/web/lib/moderation.ts`: remove the per-comment status hook/exports no
   longer used; keep `useReportComment` (invalidate the comments query on
   success so `reported` refreshes).
3. `apps/web/components/movies/comment-actions.tsx` and
   `comment-section.tsx`: use `comment.reported` / `reply.reported` for the
   "Đã báo cáo" state; no per-comment status request.
4. Surface real error codes: in report + moderation mutations, call
   `toVietnameseMessage(error)` for the toast message instead of hardcoded
   strings (see `lib/errors.ts`).
5. `apps/web/components/movies/report-dialog.tsx`: disable the close/cancel
   controls while a submit is pending.
6. `/admin/reports` and comment list: show a loading affordance when switching
   status tabs / pages while previous data is displayed
   (`isFetching`/`isPlaceholderData`), instead of silently showing stale rows.

### Verification

`pnpm --filter gmov-web lint`; `typecheck`; `build`.

---

## Task 4: Structure refactor

Depends on Tasks 1-3.

### Deliverables

1. New `apps/api/app/api/v1/routers/reports.py` (`APIRouter(prefix="/me",
   tags=["reports"])`) holding `create_report`, `report_status` and the
   `rate_limited_report_user` dependency moved from `me.py`; register it in
   `apps/api/app/api/v1/__init__.py`. Remove the moved code + now-unused
   imports from `me.py`. Behaviour, paths and status codes must not change;
   `test_moderation.py` must still pass unchanged.
2. New `apps/web/components/movies/comment-item.tsx` containing `Avatar`,
   `CommentBody`, `ReplyItem`, `CommentItem` extracted from
   `comment-section.tsx`; `comment-section.tsx` imports them. No behaviour
   change.
3. New `apps/web/components/ui/dialog.tsx` (Radix-based, mirroring the style
   of `components/ui/sheet.tsx`); refactor `report-dialog.tsx` to use it,
   dropping the duplicated overlay/content styling.

### Verification

Backend: ruff + pytest. Frontend: lint + typecheck + build. No wire/behaviour
changes.

---

## Task 5: Docs + final verification

Depends on Tasks 1-4.

- `docs/api-moderation.md`: document `reported` on comments; adjust the
  error-code note if needed.
- `docs/todo.md`: mark #2 (reuse detection) and #5 (composite login key) DONE
  with a one-line description; keep #6/#14/#16/#17 and #18-#21 as debt.
- `docs/decisions.md`: append dated entries for family-id reuse detection, the
  composite login key, the `reported`-field batch approach, and the refactor.
- Confirm README/docs index still accurate.
- Run the full verification once: backend ruff + pytest, web lint + typecheck +
  build.
