# Episode-level watch progress — design spec (2026-09-16)

Status: approved by product owner before implementation.

## Goal

Show how far a viewer has gotten into a series. Today a progress row only knows
the *current episode* (latest row) and, on the HLS path, a playtime. Embed-only
episodes (all real upstream episodes; see `docs/web-player.md`) expose no
playtime to the parent page, so a per-second bar is impossible for them.

This spec adds an **episode position** to each progress row and displays it as
"Tập N/M" plus a series-position bar on the detail page, the "Xem tiếp" rail,
and the history page.

## Non-goals (YAGNI)

- True playback position/percent for embed episodes (cross-origin iframe cannot
  report it; the provider keeps its own time in its own origin's localStorage).
- Per-episode watched checkmarks on the detail page (the watch page grid already
  has them).
- Auto-marking an episode as "watched" when merely opened.
- Changing the continue-watching ordering (still latest `updated_at` per movie).

## Data model

### `watch_progress` — two new nullable columns

| column | type | notes |
|--------|------|-------|
| `episode_index` | INTEGER NULL | 1-based index of the episode **within the selected server** |
| `total_episodes` | INTEGER NULL | number of episodes in that server at write time |

Index is scoped to the chosen server (not the cross-server flat list) so a movie
with several servers carrying the same episode list does not inflate M.

Legacy rows keep `NULL` and render with the existing fallbacks. There is no
backfill; values populate on the next write for that episode.

## API contracts

### `ProgressUpsert` (PUT `/api/v1/me/progress`)
- add optional `episode_index: int ≥ 1`, `total_episodes: int ≥ 1`.
- validator: when **both** are present, `episode_index <= total_episodes`
  (else `422 VALIDATION_ERROR`, same path as the existing position rule).

### `ProgressOut` (all progress reads)
- add `episode_index: int | null`, `total_episodes: int | null`.
- No route, ordering, or pagination changes; both fields default `null` so
  existing consumers are unaffected.

### `WatchedAdd` / `POST /api/v1/me/watched`
- add the same optional fields and pass them through `mark_watched` so the
  explicit "Đánh dấu đã xem" marker also records the series position.

### Persistence
- `progress_service.upsert` already does `model_dump()` into the model; the two
  fields flow through with no extra branch. `ProgressUpsert` validation covers
  both the manual and the marker path.

## Frontend

### Write (`components/player/watch-view.tsx`)
`buildPayload` computes, from the **currently selected server**:
- `episode_index = episodes.findIndex(key match) + 1`
- `total_episodes = episodes.length`
and includes them for every writer (HLS heartbeat, unload keepalive, embed
registration). The "Đánh dấu đã xem" mutation sends the same values.

`lib/me.ts` types `ProgressUpsert` and `Progress` gain the two fields.

### Display rules

Primary episode label: `tập {episode_index}/{total_episodes}` when both are
present, otherwise the existing `episodeLabel(episode_name)` (`"tập 2"` for bare
numeric upstream names).

- **Detail page** (`components/movies/resume-button.tsx`): `Xem tiếp tập N/M`
  when position data exists, else the current `Xem tiếp tập N`; the
  `từ hh:mm:ss` suffix still appears only when `position_seconds > 10`.
- **"Xem tiếp" rail** (`components/movies/continue-watching-rail.tsx`): badge and
  subtitle use the primary label; bar width = `episode_index / total_episodes`
  when present, else the existing time ratio (`position/duration`, 0 for embed).
  The `còn ...` remaining hint is unchanged (only meaningful with a duration).
- **History page** (`app/me/history/page.tsx`): the episode line uses the
  primary label; its bar uses the same rule.

All three fall back to today's behaviour when the fields are `NULL`.

## Migration

One Alembic revision adding the two nullable INTEGER columns to
`watch_progress` (no data migration, no constraint). Keep the model/migration
parity test green.

## Testing

- **pytest** (`tests/test_library.py` and friends):
  - `ProgressUpsert` accepts the fields and rejects `episode_index > total_episodes`.
  - `PUT /progress` round-trips both fields into `ProgressOut`.
  - `POST /watched` persists both fields.
  - add an inspector assertion that `watch_progress` has both new nullable
    columns (mirrors the column checks in `tests/test_moderation_data.py`).
  - existing progress/continue-watching tests stay green (fields optional).
- **E2E**: extend `e2e/embed-history.spec.ts` to assert the history label reads
  `tập 2/3` after switching to episode 2 in the `/e2e/embed` harness (3
  synthetic episodes), reusing the existing seeding/cleanup.

## Docs

- `docs/api-library.md`: document the two fields on `ProgressUpsert`/`ProgressOut`
  and the `episode_index <= total_episodes` rule.
- `docs/web-player.md`: note that embed/hls writes carry the episode position.
- `docs/decisions.md`: new entry — series-position stored per (movie, episode),
  scoped to the selected server; embed keeps no playtime; no backfill.
