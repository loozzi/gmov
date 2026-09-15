# Personal library API (Phase 3)

All endpoints require Bearer access token. Base: `/api/v1/me`.

## Watch progress

| Method | Path | Body / Params | Success |
|--------|------|---------------|---------|
| PUT | `/progress` | `ProgressUpsert` (rate-limited 20 req/min/user → 429 `RATE_LIMITED`) | 200 `ProgressOut` |
| GET | `/continue-watching?page=&per_page=20` | one row per movie (latest episode), `updated_at` desc | 200 paginated |
| GET | `/progress/{movie_slug}` | latest-episode row for resume | 200 / 404 `PROGRESS_NOT_FOUND` |
| DELETE | `/progress/{movie_slug}` | removes all episodes of the movie | 200 `{"ok": true}` |

`ProgressUpsert = {movie_slug, movie_name, poster_url?, episode_slug,
episode_name, server_name?, position_seconds≥0, duration_seconds>0?}` with
rule `position_seconds <= duration_seconds` (else 422 `VALIDATION_ERROR`).
Unique key: `(user_id, movie_slug, episode_slug)` — repeat PUTs upsert.

## Favorites

| Method | Path | Success |
|--------|------|---------|
| POST | `/favorites` `{movie_slug, movie_name, poster_url?}` | 201 created / 200 already exists |
| GET | `/favorites?page=&per_page=20` | 200 paginated, newest first |
| GET | `/favorites/{movie_slug}/status` | 200 `{"is_favorite": bool}` |
| DELETE | `/favorites/{movie_slug}` | 200 `{"ok": true}` (idempotent) |

Unique key: `(user_id, movie_slug)`.

## Watched episodes

| Method | Path | Success |
|--------|------|---------|
| GET | `/watched/{movie_slug}` | 200 `{"episode_slugs": [...]}` (≥90% of known duration) |
| POST | `/watched` `{movie_slug, movie_name, episode_slug, episode_name, ...}` | 200 (explicit marker for players without time access) |

## Notes

- No separate `watch_history` table: progress rows already record
  movie/episode/time, so history = progress ordered by `updated_at`
  (see `docs/decisions.md`).
- Rate limiting is fail-open: if Redis is down, progress writes still succeed.
