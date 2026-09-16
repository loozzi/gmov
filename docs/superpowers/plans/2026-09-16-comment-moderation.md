# Plan: comment moderation

Spec: `docs/superpowers/specs/2026-09-16-comment-moderation-design.md` (binding authority).

## Global Constraints

- Backend: Python 3.12, FastAPI, SQLAlchemy 2.0 async, asyncpg/Alembic,
  Pydantic v2, pytest. `snake_case`; modules under ~300 lines; layered
  router → service → model (no DB access in routers). Full type hints.
  Run `uv run ruff check app tests` and `uv run pytest -q -m "not integration"`
  from `apps/api`.
- Frontend: Next.js 15 App Router, TypeScript strict, no `any` without
  justification. `camelCase` vars, `PascalCase` components. Server Components
  by default, `"use client"` only where needed. Run from repo root:
  `pnpm --filter gmov-web lint`, `pnpm --filter gmov-web typecheck`,
  `pnpm --filter gmov-web build`.
- API routes are `/api/v1/<resource>`.
- New env var must be added to `.env.example` and `docker-compose.yml` the
  same change.
- Tests must pass without network. Unit tests use SQLite + fakeredis; never
  `-m integration`.
- Commits: Conventional Commits, English. One meaningful commit minimum per
  task.
- Follow existing patterns exactly: read neighbouring files first (models use
  `app.db.base.Base` + `TimestampMixin`; services raise
  `AppException(msg, CODE, status)`; schemas live in `app/schemas`; routers
  aggregate in `app/api/v1/__init__.py`).
- Do NOT add code comments except where the surrounding file already uses
  them (module docstrings are the norm in this repo).
- Error messages shown to end users are Vietnamese (see
  `docs/api-library.md`); error codes are SCREAMING_SNAKE English.

---

## Task 1: Backend data layer (models, migration, schemas, config, CLI)

Independent of Tasks 2/3; Task 2 depends on this.

### Deliverables

1. `apps/api/app/db/models/user.py` — add `UserRole` enum and `role` column.

```python
class UserRole(str, enum.Enum):
    USER = "user"
    MODERATOR = "moderator"
    ADMIN = "admin"
```

`role: Mapped[UserRole] = mapped_column(
    Enum(UserRole, native_enum=False, length=20, validate_strings=True),
    default=UserRole.USER, server_default=UserRole.USER.value, nullable=False,
)`

2. `apps/api/app/db/models/comment.py` — add
   `is_hidden: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false", nullable=False)`.

3. New `apps/api/app/db/models/comment_report.py`:

```python
class ReportReason(str, enum.Enum):
    SPAM = "spam"
    HARASSMENT = "harassment"
    SPOILER = "spoiler"
    OTHER = "other"


class ReportStatus(str, enum.Enum):
    OPEN = "open"
    RESOLVED = "resolved"
    DISMISSED = "dismissed"


class CommentReport(Base, TimestampMixin):
    __tablename__ = "comment_reports"
    __table_args__ = (UniqueConstraint("comment_id", "reporter_id"),)

    id: uuid.UUID (pk, default uuid4)
    comment_id: FK comments.id ondelete CASCADE, index, nullable=False
    reporter_id: FK users.id ondelete CASCADE, index, nullable=False
    reason: Enum(ReportReason, native_enum=False, length=20, validate_strings=True), nullable=False
    note: Text nullable (default None)
    status: Enum(ReportStatus, native_enum=False, length=20, validate_strings=True),
        default=ReportStatus.OPEN, server_default=ReportStatus.OPEN.value, index, nullable=False
    resolved_by: FK users.id ondelete SET NULL, nullable
    resolved_at: DateTime(timezone=True) nullable
```

4. Export `CommentReport` in `apps/api/app/db/models/__init__.py`.

5. `apps/api/app/core/config.py` — add
   `comment_report_hide_threshold: int = Field(default=3, ge=1)`.

6. `apps/api/app/schemas/user.py` — add `role: UserRole` to `UserOut`.

7. `apps/api/app/schemas/library.py` — `ReplyOut` and `CommentOut`:
   `is_hidden: bool = False`, `body: str | None` (was `str`).

8. New `apps/api/app/schemas/moderation.py`:

```python
class ReportIn(BaseModel):
    comment_id: uuid.UUID
    reason: ReportReason
    note: str | None = Field(default=None, max_length=500)

class ReportCreated(BaseModel):
    id: uuid.UUID
    status: ReportStatus

class ReportStatusOut(BaseModel):
    reported: bool

class ReportCommentInfo(BaseModel):   # nested comment in the admin queue
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    body: str
    is_hidden: bool
    movie_slug: str
    user: CommentUser
    created_at: datetime

class ReportItem(BaseModel):
    id: uuid.UUID
    reason: ReportReason
    note: str | None
    status: ReportStatus
    created_at: datetime
    reporter: CommentUser
    comment: ReportCommentInfo

class PaginatedReports(BaseModel):
    items: list[ReportItem]
    page: int
    per_page: int
    total_items: int
    open_total: int

class CommentVisibilityOut(BaseModel):
    ok: bool = True
    is_hidden: bool
```

Import `CommentUser` from `app.schemas.library` inside `moderation.py`.

9. New `apps/api/app/cli.py`:

```python
"""Admin CLI: python -m app.cli set-role <username> <role>"""
```

- argparse with subcommand `set-role`, positional `username`, `role`
  (choices from `UserRole`).
- async `main()` that opens a session via `app.db.session` and updates the
  user's role, prints a confirmation, exits non-zero for unknown username or
  invalid role. Follow the session/engine usage in `app/db/session.py`
  (`async_session_maker` / `engine`); dispose the engine at the end.
- Must be runnable as `uv run python -m app.cli set-role alice admin`.

10. New Alembic migration under `apps/api/app/alembic/versions/` with a
    descriptive English slug, revision id chained to the current head
    (inspect existing versions and `down_revision`). It must:
    - add `users.role` (nullable=False, server_default='user' + CHECK),
    - add `comments.is_hidden` (nullable=False, server_default='false'),
    - create `comment_reports` (all columns + indexes `ix_comment_reports_comment_id`,
      `ix_comment_reports_reporter_id`, `ix_comment_reports_status` + unique
      constraint).
    - include a working `downgrade()`. Use `op.batch_alter_table` for SQLite
      compatibility when adding the CHECK-constrained column or dropping
      columns, matching how existing migrations handle SQLite if they do;
      otherwise plain `op.add_column` is fine for SQLite as long as the test
      upgrade/downgrade passes.

11. Tests — new `apps/api/tests/test_moderation_data.py` (or extend an
    existing test module if more idiomatic):
    - migration upgrade → downgrade → upgrade succeeds against the test DB
      (use the existing conftest fixtures/patterns; if conftest does not run
      Alembic, assert the model metadata + defaults instead and state that in
      the report).
    - `User.role` defaults to `UserRole.USER`; `Comment.is_hidden` defaults
      `False`; `CommentReport` unique constraint rejects a duplicate
      `(comment_id, reporter_id)`.
    - CLI: running `main(["set-role", "<user>", "admin"])` promotes; invalid
      username returns a non-zero exit / raises a handled error; invalid role
      is rejected by argparse. Patch/use the test session so no network is
      needed.

### Verification

From `apps/api`: `uv run ruff check app tests` and
`uv run pytest -q -m "not integration"` (all existing tests must still pass).

---

## Task 2: Backend services, dependencies and routers

Depends on Task 1 (models/schemas). Contract is frozen by the spec.

### Deliverables

1. `apps/api/app/core/deps.py` — add:

```python
oauth2_optional = OAuth2PasswordBearer(
    tokenUrl="/api/v1/auth/login", auto_error=False
)

async def get_optional_user(
    token: str | None = Depends(oauth2_optional),
    db: AsyncSession = Depends(get_db),
) -> User | None:
    # decode token like get_current_user but return None on ANY failure
    # (missing, expired, invalid type, unknown/inactive user) — never raise.

def require_role(*roles: UserRole) -> Callable:
    # returns an async dependency that depends on get_current_user and raises
    # AppException("...", "FORBIDDEN", 403) when current.role not in roles.
```

2. New `apps/api/app/services/report_service.py`:

- `RATE_LIMIT = 10`, `RATE_WINDOW = 60` (the router applies the rate limit
  using `app.core.ratelimit.check_rate_limit` with key
  `ratelimit:reports:{user_id}`; follow the `me.py` pattern).
- `async def create(db, user_id, data: ReportIn) -> tuple[CommentReport, bool]`
  returns `(row, created)`.
  - Load comment; `None` → `AppException("Comment not found", "COMMENT_NOT_FOUND", 404)`.
  - comment.user_id == user_id → `AppException(..., "CANNOT_REPORT_OWN", 422)`.
  - comment.is_hidden → `AppException(..., "COMMENT_HIDDEN", 409)`.
  - existing `(comment_id, reporter_id)` → return `(existing, False)`.
  - insert report, flush.
  - count `open` reports from distinct reporter_id for the comment; if
    `>= settings.comment_report_hide_threshold` set comment.is_hidden = True.
  - single commit; rollback on exception (mirror `auth_service.refresh`).
- `async def status(db, user_id, comment_id) -> bool`.
- `async def list_reports(db, status, page, per_page) -> tuple[list[ReportItem], int, int]`
  returns `(items, total_items, open_total)`:
  - filter by status when given; order `created_at desc, id desc`; paginate.
  - join comment + reporter + comment author to build `ReportItem`.
  - `open_total` counts all `open` reports.
- `async def hide_comment(db, actor, comment_id) -> None`:
  - `404 COMMENT_NOT_FOUND`; set `is_hidden=True`; update every open report for
    the comment to resolved with `resolved_by=actor.id`, `resolved_at=now`;
    one commit.
- `async def unhide_comment(db, actor, comment_id) -> None`:
  - `404 COMMENT_NOT_FOUND`; set `is_hidden=False`; commit.
- `async def dismiss(db, actor, report_id) -> None`:
  - `404 REPORT_NOT_FOUND`; if already dismissed/no-op for resolved? Only
    dismiss `open`; setting a non-open report to dismissed is a no-op that
    still returns success (idempotent). Set actor/time; commit.

3. `apps/api/app/services/comment_service.py` — `list_paginated(..., viewer: User | None = None)`:
   - include `is_hidden` on top-level and replies.
   - when `viewer is None or viewer.role == UserRole.USER` and `is_hidden`,
     emit `body=None`; otherwise the real body.
   Keep the existing signature working by defaulting `viewer=None`.

4. `apps/api/app/api/v1/routers/movies.py` — `list_comments` gains
   `viewer: User | None = Depends(get_optional_user)` and forwards `viewer`.

5. `apps/api/app/api/v1/routers/me.py` — add report endpoints:
   - `POST /me/reports` (`ReportCreated`, 201) using a rate-limited user
     dependency analogous to `rate_limited_comment_user` with key
     `ratelimit:reports:{id}`.
   - Return HTTP 200 (not 201) when the report already existed; use
     `Response.status_code` or two return paths consistently with how the
     favorites router signals created/already-exists (inspect it first and
     mirror the approach).
   - `GET /me/reports/{comment_id}/status` → `ReportStatusOut`.

6. New `apps/api/app/api/v1/routers/admin.py`:
   - `router = APIRouter(prefix="/admin", tags=["admin"])` — **not** included
     with the `/me` prefix; add it in `app/api/v1/__init__.py` as
     `api_router.include_router(admin.router)`.
   - All routes depend on `require_role(UserRole.MODERATOR, UserRole.ADMIN)`.
   - `GET /reports` → `PaginatedReports` (Query validation: status optional,
     page ≥1, per_page 1..100). Invalid status → 422.
   - `POST /comments/{comment_id}/hide` → `CommentVisibilityOut`.
   - `POST /comments/{comment_id}/unhide` → `CommentVisibilityOut`.
   - `POST /reports/{report_id}/dismiss` → `{"ok": true}`.

7. New `apps/api/tests/test_moderation.py` covering:
   - create report 201; duplicate → 200 and no second row.
   - report own comment → 422 `CANNOT_REPORT_OWN`.
   - report hidden comment → 409 `COMMENT_HIDDEN`.
   - unknown comment → 404 `COMMENT_NOT_FOUND`.
   - auto-hide: below threshold stays visible; at threshold from distinct
     users becomes hidden; a second report from the SAME user does not count.
   - `GET /me/reports/{id}/status` reflects reported/unreported.
   - `GET /comments`: anonymous and normal user get `body: null` for hidden
     comments (with `is_hidden: true`); a moderator/admin token gets the body.
   - admin routes: anonymous → 401, normal user → 403, moderator/admin → 200.
   - hide resolves open reports (`resolved_by`/`resolved_at` set); unhide
     leaves them resolved; dismiss idempotent; unknown report → 404.
   - rate limit is not asserted (fail-open) unless trivial.
   - Follow the existing test setup in `tests/conftest.py` for auth tokens,
     DB override and fakeredis.

### Verification

From `apps/api`: `uv run ruff check app tests` and
`uv run pytest -q -m "not integration"`.

---

## Task 3: Frontend moderation UI

Depends only on the frozen API contract (spec). May run in parallel with
Task 2 (separate app, no file overlap).

### Deliverables

1. `apps/web/lib/types.ts` — `export type UserRole = "user" | "moderator" | "admin"`
   and `User.role: UserRole`.

2. `apps/web/components/auth/auth-provider.tsx` — expose
   `isModerator: boolean` and `isAdmin: boolean` in the context value
   (`isModerator = role is moderator or admin`).

3. `apps/web/lib/reviews.ts`:
   - `CommentReply` / `MovieComment`: add `is_hidden: boolean`, `body: string | null`.
   - `useComments` uses `auth: true` (endpoint stays public; token is sent
     opportunistically so moderators receive hidden bodies).

4. New `apps/web/lib/moderation.ts` with TanStack Query hooks:
   - `useReportStatus(commentId, enabled)` → `GET /api/v1/me/reports/{id}/status`.
   - `useReportComment()` → `POST /api/v1/me/reports`; invalidate the status
     query on success.
   - `useReports(status, page)` → `GET /api/v1/admin/reports`.
   - `useHideComment(movieSlug)`, `useUnhideComment(movieSlug)` →
     `POST /api/v1/admin/comments/{id}/hide|unhide`; invalidate the admin
     reports query and the movie comments query.
   - `useDismissReport()` → `POST /api/v1/admin/reports/{id}/dismiss`;
     invalidate reports.
   - Export types `ReportItem`, `PaginatedReports`, `ReportReason`
     (`"spam" | "harassment" | "spoiler" | "other"`), and a
     `REPORT_REASON_LABELS: Record<ReportReason, string>` with Vietnamese
     labels (Spam / Quấy rối, xúc phạm / Tiết lộ nội dung / Khác).

5. New `apps/web/components/movies/report-dialog.tsx` — accessible modal
   (reuse existing dialog/sheet primitives if present, otherwise a small
   hand-rolled overlay following the style of `components/ui/*`): radio group
   of reasons + optional note textarea (maxLength 500) + submit/cancel.
   Callback receives `{reason, note}`.

6. `apps/web/components/movies/comment-section.tsx`:
   - Hidden comment: render a muted "Bình luận đã bị ẩn" placeholder instead
     of the body, keep the author/date header and still render replies.
   - For authenticated non-owners and non-hidden comments: a "Báo cáo" action
     opening `ReportDialog`; after success show "Đã báo cáo" (disabled).
   - For moderators/admins: show the body even when hidden, a small "Đang ẩn"
     badge, and Ẩn / Bỏ ẩn buttons calling the hooks.
   - Keep the existing delete (owner) behaviour and accessibility props.
   - Handle `body: string | null` safely in both `CommentItem` and `ReplyItem`.

7. `apps/web/app/admin/layout.tsx` (client) — role gate:
   - `isLoading` → skeleton; not authenticated → `router.replace("/login?next=/admin/reports")`;
   - authenticated with role `user` → `notFound()`;
   - otherwise render children with a simple admin header/nav (link to
     "Báo cáo").
   `apps/web/middleware.ts` matcher adds `"/admin/:path*"` (cookie-presence
   redirect only, defense in depth).

8. `apps/web/app/admin/page.tsx` → `redirect("/admin/reports")`.

9. `apps/web/app/admin/reports/page.tsx` (client) — uses `useReports` with
   status tabs `open | resolved | dismissed | all`, page navigation, list
   rendering reason label, reporter, movie link (`/phim/{slug}`), comment body
   (or placeholder when hidden), and actions: Ẩn (if visible), Bỏ ẩn (if
   hidden), Bỏ qua (dismiss, only for open reports). Show `open_total`.

10. `apps/web/components/layout/site-header.tsx` (or its account menu
    component) — show a "Quản trị" link to `/admin/reports` only when
    `isModerator`.

### Verification (from repo root)

`pnpm --filter gmov-web lint` && `pnpm --filter gmov-web typecheck` &&
`pnpm --filter gmov-web build` must all pass.

---

## Task 4: Docs update

Small documentation-only batch; run after Tasks 1-3.

- New `docs/api-moderation.md` documenting every new endpoint, the auto-hide
  rule, roles and the CLI.
- `docs/api-library.md`: note `is_hidden`/nullable `body` on comments.
- `docs/decisions.md`: append the four decisions listed in the spec.
- `docs/todo.md`: remove/mark the moderation gap if present, add any deferrals
  (ban, spoiler, notifications).
- `.env.example` + `docker-compose.yml`: `COMMENT_REPORT_HIDE_THRESHOLD=3`
  (verify Task 1 added it; if not, add here).
