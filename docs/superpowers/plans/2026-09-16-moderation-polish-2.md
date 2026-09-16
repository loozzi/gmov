# Plan: moderation polish round 2 (items 1-5, 11)

Follow-up to `2026-09-16-moderation-hardening-and-debt.md`. Product owner
approved items 1-5 and 11 from the outstanding list.

## Global Constraints

- Backend: Python 3.12, FastAPI, SQLAlchemy 2.0 async, Pydantic v2, pytest.
  `snake_case`; modules under ~300 lines; layered router → service → model.
  Full type hints. From `apps/api`: `uv run ruff check app tests` and
  `uv run pytest -q -m "not integration"` must pass (SQLite + fakeredis).
- Frontend: Next.js 15 App Router, TypeScript strict, no `any`. `camelCase`
  vars, `PascalCase` components. From repo root: `pnpm --filter gmov-web
  lint`, `typecheck`, `build` must pass.
- Refactors must preserve behavior, paths and status codes exactly.
- Follow existing patterns; no code comments unless the file already uses them.
- Commits: Conventional Commits, English.
- Do NOT dispatch subagents; do all work yourself.

---

## Task 1: Backend deadlock fix, migration-parity test, `me.py` split

### Deliverables

1. **Deadlock ordering (#1).** `apps/api/app/services/auth_service.py`
   `_revoke_family`: add `.order_by(RefreshToken.id)` to the family
   `SELECT ... FOR UPDATE`, so two concurrent theft revocations cannot
   deadlock (Postgres) by acquiring family rows in a stable order.

2. **Migration-parity test (#5).** `apps/api/tests/test_moderation_data.py`
   `test_model_constraint_metadata_matches_migration` currently only inspects
   model metadata. Make it actually compare against the Alembic migration
   source for `b7c1d9e2f3a4_comment_moderation.py`: assert the migration
   declares `ck_users_role` with the same `role IN (...)` values and
   `uq_comment_reports_comment_reporter`. A source-text assertion is
   acceptable; the test must fail if either name/value diverges.

3. **Split `me.py` (#3).** `apps/api/app/api/v1/routers/me.py` is 312 lines.
   Split into three routers (each `APIRouter(prefix="/me", ...)`), preserving
   every path, method, response model and status code:
   - `routers/progress.py` (tags `["progress"]`): `/progress` PUT/GET/DELETE,
     `/continue-watching`, `/watched` GET/POST, and the `rate_limited_user`
     dependency.
   - `routers/collections.py` (tags `["collections"]`): favorites + watchlist
     routes.
   - `routers/reviews.py` (tags `["reviews"]`): ratings + comments routes, and
     the `rate_limited_comment_user` dependency.
   Delete `me.py` and register the three in `apps/api/app/api/v1/__init__.py`.
   Keep imports minimal and every module well under 300 lines. Existing tests
   (which hit the HTTP paths) must pass unchanged.

### Verification

`uv run ruff check app tests`; `uv run pytest -q -m "not integration"`.

---

## Task 2: Frontend dialog + moderation polish

### Deliverables

1. **`ui/dialog.tsx` unused surface (#4).** Remove exports with no consumers:
   `DialogTrigger`, `DialogClose`, `DialogPortal`, `DialogOverlay` (keep
   `DialogPortal`/`DialogOverlay` as internal, non-exported helpers used by
   `DialogContent`). Exported surface should be exactly what
   `report-dialog.tsx` (and any other consumer) uses. Update imports if
   needed.

2. **Frontend minors (#11)** in `lib/moderation.ts`,
   `components/movies/comment-actions.tsx`, `components/movies/comment-section.tsx`,
   `app/admin/reports/page.tsx`:
   - Type the `ReportAction` `onError` parameter as `unknown` (consistent with
     sibling handlers).
   - Optimistic "Đã báo cáo": show the reported state immediately on submit
     (e.g. treat `isPending` as reported) and revert on error, instead of
     waiting for the refetch.
   - Scope the stale-row loading affordance to real key changes: use
     `isPlaceholderData` (not `isFetching`) so background/window-focus refetches
     do not dim the list or disable pagination.
   - Add `aria-hidden` to the decorative `Loader2` spinners.
   - Scope `useReportComment`'s invalidation to the current movie
     (`["reviews", "comments", movieSlug]`) by taking `movieSlug`; pass it from
     the comment action component.

### Verification

`pnpm --filter gmov-web lint`; `typecheck`; `build`.

---

## Task 3: Playwright E2E for the moderation flow (#2)

Depends on Tasks 1-2. New `apps/web/e2e/moderation.spec.ts`.

### Requirements

- Use the existing helpers (`e2e/helpers/api.ts`, `auth.ts`, `net.ts`) and
  `skipIfNoUpstream()`.
- Uses the global-setup account as BOTH the comment author and the moderator:
  promote it once via the CLI (`docker compose exec -T api python -m
  app.cli set-role <username> moderator`), shelling out like
  `global-setup.ts`'s `resetThrottle`. Keep it best-effort/skip-safe.
- Register exactly ONE extra "reporter" account via the API (the
  register limit is 3/hour/IP; global-setup resets the throttle per run, so
  keep the extra account count at 1). Skip with a clear message if registration
  is throttled.
- Flow to cover:
  1. Author (base account, promoted) posts a comment on a real movie slug.
  2. Reporter logs in via UI and reports that comment through the UI
     (open the report dialog, choose a reason, submit).
  3. Moderator logs in via UI, opens `/admin/reports`, and hides the reported
     comment.
  4. On the movie page as the reporter (normal user), the comment shows the
     hidden placeholder "Bình luận đã bị ẩn" (and the reply/thread header stays).
  5. Moderator unhides; the body is visible again.
  6. Cleanup: delete the comment as the author.
- Do NOT rely on the auto-hide threshold (needs 3 distinct reporters); the
  backend unit tests cover the threshold. Manual hide/unhide is the E2E target.
- Make it robust: unique comment body per run; `reuseExistingServer: false`
  is not needed.

### Verification (must actually run)

- Bring the stack up: `docker compose up -d --build db redis api` (api must
  include the branch code; entrypoint runs migrations).
- Run: `pnpm --filter gmov-web exec playwright test e2e/moderation.spec.ts`
  from the repo root, with `PLAYWRIGHT_BACKEND_URL=http://localhost:8000`.
- Also run the existing suite once to confirm no regression:
  `pnpm --filter gmov-web exec playwright test`.
- If the environment cannot run the stack/spec, report BLOCKED with the exact
  command and error rather than claiming success.

---

## Task 4: Docs

Small doc-only batch after Tasks 1-3: note the E2E coverage in `docs/e2e.md`,
and record the `me.py` split + dialog cleanup in `docs/decisions.md` if not
already implied. No behavior docs change.
