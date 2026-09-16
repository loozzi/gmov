# Episode-level Watch Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist each progress row's series position (`episode_index`/`total_episodes`) and show "tập N/M" plus a series-position bar on the detail page, the "Xem tiếp" rail, and the history page.

**Architecture:** Two nullable columns on `watch_progress` carry the 1-based episode index within the selected server and that server's episode count. The watch page (the only writer) computes both from the selected server on every write. Backend schemas expose them; three client components render them with fallbacks to today's episode-name/time behaviour.

**Tech Stack:** Python 3.12 / FastAPI / SQLAlchemy 2.0 async / Alembic / Pydantic v2 (backend, `uv`); Next.js 15 / TypeScript strict / TanStack Query (frontend, pnpm); Playwright for E2E.

**Spec:** `docs/superpowers/specs/2026-09-16-episode-progress-design.md`

## Global Constraints

- Branch: all work on `feat/episode-progress`.
- Backend verify: `cd apps/api && uv run ruff check app tests && uv run pytest -q -m "not integration"`.
- Frontend verify: `pnpm --filter gmov-web lint && pnpm --filter gmov-web typecheck && pnpm --filter gmov-web build`.
- E2E verify: `pnpm --filter gmov-web test:e2e embed-history.spec.ts` (compose `db`/`redis`/`api` must be up; Playwright starts the Next dev server on `:3100`).
- Commits: Conventional Commits, English, one per task.
- Never commit `.env` or `.opencode/`.
- Both new DB columns are `nullable`; legacy rows stay `NULL` and every UI falls back to current behaviour.
- `episode_index`/`total_episodes` are scoped to the **selected server**, not the cross-server flat list.

---

### Task 1: Backend — persist episode position

**Files:**
- Modify: `apps/api/app/db/models/watch_progress.py`
- Modify: `apps/api/app/schemas/library.py`
- Modify: `apps/api/app/services/progress_service.py`
- Modify: `apps/api/app/api/v1/routers/progress.py`
- Create: `apps/api/app/alembic/versions/e3a91c7b5d42_watch_progress_episode_position.py`
- Create: `apps/api/tests/test_progress_migration.py`
- Modify: `apps/api/tests/test_library.py`
- Modify: `docs/api-library.md`
- Modify: `docs/decisions.md`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `ProgressUpsert.episode_index: int | None`, `ProgressUpsert.total_episodes: int | None`; `ProgressOut.episode_index: int | None`, `ProgressOut.total_episodes: int | None`; `WatchedAdd.episode_index: int | None`, `WatchedAdd.total_episodes: int | None`; `progress_service.mark_watched(..., episode_index=None, total_episodes=None)`; DB columns `watch_progress.episode_index`, `watch_progress.total_episodes` (nullable INTEGER).

- [ ] **Step 1: Add the model columns**

In `apps/api/app/db/models/watch_progress.py`, after the `server_name` line (line 38) add:

```python
    episode_index: Mapped[int | None] = mapped_column(Integer, nullable=True)
    total_episodes: Mapped[int | None] = mapped_column(Integer, nullable=True)
```

(`Integer` is already imported.)

- [ ] **Step 2: Write the failing backend tests**

Append to `apps/api/tests/test_library.py`:

```python
async def test_progress_upsert_stores_episode_position(client):
    h = await _auth_headers(client)
    body = {**_progress(), "episode_index": 2, "total_episodes": 12}

    r = await client.put(f"{ME}/progress", headers=h, json=body)
    assert r.status_code == 200, r.text
    assert r.json()["episode_index"] == 2
    assert r.json()["total_episodes"] == 12

    r = await client.get(f"{ME}/progress/mao", headers=h)
    assert r.json()["episode_index"] == 2
    assert r.json()["total_episodes"] == 12


async def test_progress_rejects_index_over_total(client):
    h = await _auth_headers(client)
    body = {**_progress(), "episode_index": 13, "total_episodes": 12}

    r = await client.put(f"{ME}/progress", headers=h, json=body)
    assert r.status_code == 422
    assert r.json()["code"] == "VALIDATION_ERROR"


async def test_watched_marker_stores_episode_position(client):
    h = await _auth_headers(client)

    r = await client.post(
        f"{ME}/watched",
        headers=h,
        json={
            "movie_slug": "mao",
            "movie_name": "Mao",
            "episode_slug": "tap-3",
            "episode_name": "3",
            "episode_index": 3,
            "total_episodes": 12,
        },
    )
    assert r.status_code == 200, r.text

    r = await client.get(f"{ME}/progress/mao", headers=h)
    assert r.json()["episode_slug"] == "tap-3"
    assert r.json()["episode_index"] == 3
    assert r.json()["total_episodes"] == 12


async def test_watched_marker_rejects_index_over_total(client):
    h = await _auth_headers(client)

    r = await client.post(
        f"{ME}/watched",
        headers=h,
        json={
            "movie_slug": "mao",
            "movie_name": "Mao",
            "episode_slug": "tap-3",
            "episode_name": "3",
            "episode_index": 13,
            "total_episodes": 12,
        },
    )
    assert r.status_code == 422
    assert r.json()["code"] == "VALIDATION_ERROR"
```

Create `apps/api/tests/test_progress_migration.py`:

```python
"""Migration schema check: watch_progress carries the episode-position columns."""

from pathlib import Path

from sqlalchemy import create_engine, inspect

from app.core.config import settings

APP_DIR = Path(__file__).resolve().parents[1]


def test_migration_adds_nullable_episode_position(tmp_path, monkeypatch):
    from alembic import command
    from alembic.config import Config

    db_path = tmp_path / "progress_migration.db"
    monkeypatch.setattr(settings, "database_url", f"sqlite+aiosqlite:///{db_path}")
    cfg = Config(str(APP_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(APP_DIR / "app" / "alembic"))

    command.upgrade(cfg, "head")

    engine = create_engine(f"sqlite:///{db_path}")
    try:
        cols = {c["name"]: c for c in inspect(engine).get_columns("watch_progress")}
    finally:
        engine.dispose()

    assert cols["episode_index"]["nullable"] is True
    assert cols["total_episodes"]["nullable"] is True
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `cd apps/api && uv run pytest -q tests/test_library.py -k "episode_position or index_over_total" tests/test_progress_migration.py`
Expected: FAIL — `ProgressOut` has no `episode_index`, `PUT` rejects unknown extra fields are ignored (assert on `r.json()["episode_index"]` raises `KeyError`), and the migration test errors because the columns/table columns are absent.

- [ ] **Step 4: Add the schema fields**

In `apps/api/app/schemas/library.py`, in `ProgressUpsert` after `server_name` (line 15) add:

```python
    episode_index: int | None = Field(default=None, ge=1)
    total_episodes: int | None = Field(default=None, ge=1)
```

Extend the existing `_check_position` validator (lines 19-26) so its body becomes:

```python
        if (
            self.duration_seconds is not None
            and self.position_seconds > self.duration_seconds
        ):
            raise ValueError("position_seconds must not exceed duration_seconds")
        if (
            self.episode_index is not None
            and self.total_episodes is not None
            and self.episode_index > self.total_episodes
        ):
            raise ValueError("episode_index must not exceed total_episodes")
        return self
```

In `ProgressOut` after `server_name` (line 38) add:

```python
    episode_index: int | None
    total_episodes: int | None
```

In `WatchedAdd` after `server_name` (line 111) add the fields and a validator:

```python
    episode_index: int | None = Field(default=None, ge=1)
    total_episodes: int | None = Field(default=None, ge=1)

    @model_validator(mode="after")
    def _check_index(self) -> "WatchedAdd":
        if (
            self.episode_index is not None
            and self.total_episodes is not None
            and self.episode_index > self.total_episodes
        ):
            raise ValueError("episode_index must not exceed total_episodes")
        return self
```

(`model_validator` is already imported.)

- [ ] **Step 5: Thread the fields through the service and router**

In `apps/api/app/services/progress_service.py`, change `mark_watched` to accept and forward the two values:

```python
async def mark_watched(
    db: AsyncSession,
    user_id: uuid.UUID,
    movie_slug: str,
    movie_name: str,
    episode_slug: str,
    episode_name: str,
    poster_url: str | None = None,
    server_name: str | None = None,
    episode_index: int | None = None,
    total_episodes: int | None = None,
) -> WatchProgress:
```

and in its `ProgressUpsert(...)` call add:

```python
            episode_index=episode_index,
            total_episodes=total_episodes,
```

In `apps/api/app/api/v1/routers/progress.py`, in `mark_watched` pass the new fields:

```python
        data.poster_url,
        data.server_name,
        data.episode_index,
        data.total_episodes,
    )
```

(`upsert` already persists them via `data.model_dump()` — no change.)

- [ ] **Step 6: Add the migration**

Create `apps/api/app/alembic/versions/e3a91c7b5d42_watch_progress_episode_position.py`:

```python
"""add episode position to watch progress

Revision ID: e3a91c7b5d42
Revises: dbb15b23f242
Create Date: 2026-09-16 15:00:00.000000

"""
import sqlalchemy as sa
from alembic import op

revision = 'e3a91c7b5d42'
down_revision = 'dbb15b23f242'
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table('watch_progress', schema=None) as batch_op:
        batch_op.add_column(sa.Column('episode_index', sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column('total_episodes', sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table('watch_progress', schema=None) as batch_op:
        batch_op.drop_column('total_episodes')
        batch_op.drop_column('episode_index')
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `cd apps/api && uv run ruff check app tests && uv run pytest -q -m "not integration"`
Expected: PASS — all new tests green and the existing suite unchanged.

- [ ] **Step 8: Update docs**

In `docs/api-library.md`, in the `ProgressUpsert` paragraph (lines 14-17) add the two optional fields and the rule, e.g. extend the text to:

```
`ProgressUpsert = {movie_slug, movie_name, poster_url?, episode_slug,
episode_name, server_name?, position_seconds≥0, duration_seconds>0?,
episode_index≥1?, total_episodes≥1?}` with rules `position_seconds <=
duration_seconds` and `episode_index <= total_episodes` when both present
(else 422 `VALIDATION_ERROR`).
```

and add a line under the table documenting that `episode_index`/`total_episodes`
(nullable) are the 1-based position within the selected server and that server's
episode count.

In `docs/decisions.md`, append a new section:

```markdown
## Tiến độ theo tập — 2026-09-16

84. **Lưu vị trí tập (`episode_index`/`total_episodes`) trên progress**: hai cột
    nullable trên `watch_progress`, scope theo SERVER đang chọn (không theo flat
    list nhiều server) để không thổi phồng M. Embed không có playtime nên "xem
    đến đâu" ở chế độ embed = tập hiện tại; row cũ `NULL` → UI fallback như trước.
    Không backfill (giá trị điền ở lần ghi kế tiếp).
```

- [ ] **Step 9: Commit**

```bash
git add apps/api/app/db/models/watch_progress.py apps/api/app/schemas/library.py apps/api/app/services/progress_service.py apps/api/app/api/v1/routers/progress.py apps/api/app/alembic/versions/e3a91c7b5d42_watch_progress_episode_position.py apps/api/tests/test_library.py apps/api/tests/test_progress_migration.py docs/api-library.md docs/decisions.md
git commit -m "feat(api): persist episode position on watch progress"
```

---

### Task 2: Frontend — send episode position on every progress write

**Files:**
- Modify: `apps/web/lib/me.ts`
- Modify: `apps/web/components/player/watch-view.tsx`
- Modify: `docs/web-player.md`

**Interfaces:**
- Consumes: Task 1 API fields `episode_index`/`total_episodes` on `PUT /me/progress` and `POST /me/watched`.
- Produces: `Progress.episode_index: number | null`, `Progress.total_episodes: number | null`; `ProgressUpsert.episode_index: number | null`, `ProgressUpsert.total_episodes: number | null`; `useMarkWatched` mutation input accepts optional `episode_index`/`total_episodes`. Every progress row written by the watch page carries the selected server's index/count.

- [ ] **Step 1: Extend the client types**

In `apps/web/lib/me.ts`, add to `interface Progress` (after `server_name`):

```ts
  episode_index: number | null;
  total_episodes: number | null;
```

add to `interface ProgressUpsert` (after `server_name`):

```ts
  episode_index: number | null;
  total_episodes: number | null;
```

and in `useMarkWatched`'s `mutationFn` input type (after `server_name`) add:

```ts
      episode_index?: number | null;
      total_episodes?: number | null;
```

- [ ] **Step 2: Compute the position once and use it in every write**

In `apps/web/components/player/watch-view.tsx`, after `currentKey` is derived
(line 76) add:

```ts
  // Series position within the selected server (not the cross-server flat
  // list): "tập N/M" for the history/rail/detail UI.
  const seriesPosition = useMemo(() => {
    const eps = server?.episodes ?? [];
    const idx = eps.findIndex((e) => (e.slug ?? e.name) === currentKey) + 1;
    return {
      episode_index: idx > 0 ? idx : null,
      total_episodes: eps.length > 0 ? eps.length : null,
    };
  }, [server, currentKey]);
```

In `buildPayload` (lines 93-105) spread it into the returned object and extend the
dependency array:

```ts
  const buildPayload = useCallback(
    (t: number, d: number): ProgressUpsert => ({
      movie_slug: detail.slug,
      movie_name: detail.name,
      poster_url: poster,
      episode_slug: episodeSlug,
      episode_name: currentEp?.name ?? episodeSlug,
      server_name: server?.name ?? null,
      position_seconds: Math.floor(t),
      duration_seconds: d > 0 ? Math.floor(d) : null,
      ...seriesPosition,
    }),
    [detail, episodeSlug, currentEp, server, poster, seriesPosition],
  );
```

In the "Đánh dấu đã xem" mutation call (lines 386-399) add the position:

```tsx
              markWatched.mutate(
                {
                  movie_name: detail.name,
                  episode_slug: currentKey,
                  episode_name: currentEp.name,
                  poster_url: poster,
                  server_name: server?.name ?? null,
                  ...seriesPosition,
                },
```

- [ ] **Step 3: Verify**

Run: `pnpm --filter gmov-web lint && pnpm --filter gmov-web typecheck && pnpm --filter gmov-web build`
Expected: clean.

- [ ] **Step 4: Update docs**

In `docs/web-player.md` under "Progress sync (logged-in only)" add:

```markdown
- Every write (HLS heartbeat, unload, embed registration, "Đánh dấu đã xem")
  also records the episode's 1-based position within the selected server and
  that server's episode count, powering "tập N/M" in the library UI.
```

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/me.ts apps/web/components/player/watch-view.tsx docs/web-player.md
git commit -m "feat(web): save episode position with watch progress"
```

---

### Task 3: Frontend — show "tập N/M" + series bar

**Files:**
- Create: `apps/web/lib/progress.ts`
- Modify: `apps/web/components/movies/resume-button.tsx`
- Modify: `apps/web/components/movies/continue-watching-rail.tsx`
- Modify: `apps/web/app/me/history/page.tsx`

**Interfaces:**
- Consumes: `Progress.episode_index`/`Progress.total_episodes` (Task 2).
- Produces: `lib/progress.ts` exporting `episodeLabel(name)`, `seriesLabel(index, total)`, `progressLabel(index, total, name)`, `progressPercent(index, total, position, duration)`.

- [ ] **Step 1: Create the shared display helpers**

Create `apps/web/lib/progress.ts`:

```ts
/** Upstream episode names are bare numbers ("1", "2"); read them as "tập 2". */
export function episodeLabel(name: string): string {
  const trimmed = name.trim();
  return /^\d+$/.test(trimmed) ? `tập ${trimmed}` : trimmed;
}

/** "tập 2/12" when the saved row carries a series position, else null. */
export function seriesLabel(
  index: number | null | undefined,
  total: number | null | undefined,
): string | null {
  return index != null && total != null && total > 0
    ? `tập ${index}/${total}`
    : null;
}

export function progressLabel(
  index: number | null | undefined,
  total: number | null | undefined,
  name: string,
): string {
  return seriesLabel(index, total) ?? episodeLabel(name);
}

/** 0–100 series position; falls back to the time ratio when no position. */
export function progressPercent(
  index: number | null | undefined,
  total: number | null | undefined,
  position: number,
  duration: number | null | undefined,
): number {
  if (index != null && total != null && total > 0) {
    return Math.min(100, Math.max(0, (index / total) * 100));
  }
  if (duration != null && duration > 0) {
    return Math.min(100, Math.max(0, (position / duration) * 100));
  }
  return 0;
}
```

- [ ] **Step 2: Use it on the detail resume button**

In `apps/web/components/movies/resume-button.tsx`:
- delete the local `episodeLabel` function (lines 11-16);
- add `import { progressLabel } from "@/lib/progress";`
- replace the label inside the `progress` branch:

```tsx
        <Link href={`/xem/${movieSlug}/${progress.episode_slug}`}>
          <History /> Xem tiếp{" "}
          {progressLabel(
            progress.episode_index,
            progress.total_episodes,
            progress.episode_name,
          )}
          {fromTime}
        </Link>
```

- [ ] **Step 3: Use it in the "Xem tiếp" rail**

In `apps/web/components/movies/continue-watching-rail.tsx`:
- add `import { progressLabel, progressPercent } from "@/lib/progress";`
- replace the `ratio` computation (lines 46-49) with:

```ts
          const ratio = progressPercent(
            p.episode_index,
            p.total_episodes,
            p.position_seconds,
            p.duration_seconds,
          );
```

- replace the badge text `{p.episode_name}` (line 65) with
  `{progressLabel(p.episode_index, p.total_episodes, p.episode_name)}`;
- replace the subtitle `{p.episode_name}` (line 73) with
  `{progressLabel(p.episode_index, p.total_episodes, p.episode_name)}`.

- [ ] **Step 4: Use it on the history page**

In `apps/web/app/me/history/page.tsx`:
- add `import { progressLabel, progressPercent } from "@/lib/progress";`
- the list currently uses a concise arrow (`{data.items.map((p) => (`); convert it
  to a block body (`{data.items.map((p) => {`) and close it with `})}`), then
  before the `return (` add:

```ts
              const label = progressLabel(
                p.episode_index,
                p.total_episodes,
                p.episode_name,
              );
              const hasSeries =
                p.episode_index != null && p.total_episodes != null;
```

- replace the episode text `{p.episode_name}` (line 96) with `{label}`;
- change the bar condition (line 108) from `{p.duration_seconds ? (` to
  `{hasSeries || p.duration_seconds ? (` and set the width to:

```tsx
                          width: `${progressPercent(
                            p.episode_index,
                            p.total_episodes,
                            p.position_seconds,
                            p.duration_seconds,
                          )}%`,
```

- [ ] **Step 5: Verify**

Run: `pnpm --filter gmov-web lint && pnpm --filter gmov-web typecheck && pnpm --filter gmov-web build`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/web/lib/progress.ts apps/web/components/movies/resume-button.tsx apps/web/components/movies/continue-watching-rail.tsx apps/web/app/me/history/page.tsx
git commit -m "feat(web): show series position in library UI"
```

---

### Task 4: E2E — history shows "tập 2/3"

**Files:**
- Modify: `apps/web/e2e/embed-history.spec.ts`

**Interfaces:**
- Consumes: Tasks 1-3 (write + display). The `/e2e/embed` harness has three synthetic episodes (`tap-1`, `tap-2`, `tap-3`).
- Produces: an end-to-end assertion that switching to episode 2 makes the history card read `tập 2/3`.

- [ ] **Step 1: Extend the existing spec**

In `apps/web/e2e/embed-history.spec.ts`, after the `toHaveAttribute("href", ...)`
assertion and before the cleanup block, add:

```ts
  // ...and it must show the series position, not just the episode name.
  await expect(card.getByText(/tập 2\/3/)).toBeVisible();
```

- [ ] **Step 2: Run the spec (RED if Tasks 1-3 are absent, GREEN now)**

Run: `pnpm --filter gmov-web test:e2e embed-history.spec.ts`
Expected: PASS (1 passed). The compose `db`/`redis`/`api` stack must be up; Playwright starts the dev server on `:3100`.

- [ ] **Step 3: Re-run the backend and frontend suites together**

Run: `cd apps/api && uv run ruff check app tests && uv run pytest -q -m "not integration"`
Run: `pnpm --filter gmov-web lint && pnpm --filter gmov-web typecheck`
Expected: all clean.

- [ ] **Step 4: Commit**

```bash
git add apps/web/e2e/embed-history.spec.ts
git commit -m "test(e2e): assert history shows the series position"
```
