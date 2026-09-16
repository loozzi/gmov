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
episode_name, server_name?, position_seconds≥0, duration_seconds>0?,
episode_index≥1?, total_episodes≥1?}` with rules `position_seconds <=
duration_seconds` and `episode_index <= total_episodes` when both present
(else 422 `VALIDATION_ERROR`).
Unique key: `(user_id, movie_slug, episode_slug)` — repeat PUTs upsert.

`episode_index`/`total_episodes` (nullable) are the 1-based position within the
selected server and that server's episode count. Rows written before these
columns existed stay `NULL`; the UI falls back to its previous behaviour.

## Favorites

| Method | Path | Success |
|--------|------|---------|
| POST | `/favorites` `{movie_slug, movie_name, poster_url?}` | 201 created / 200 already exists |
| GET | `/favorites?page=&per_page=20` | 200 paginated, newest first |
| GET | `/favorites/{movie_slug}/status` | 200 `{"is_favorite": bool}` |
| DELETE | `/favorites/{movie_slug}` | 200 `{"ok": true}` (idempotent) |

Unique key: `(user_id, movie_slug)`.

## Watchlist ("Muốn xem", separate from favorites)

| Method | Path | Success |
|--------|------|---------|
| POST | `/watchlist` `{movie_slug, movie_name, poster_url?}` | 201 created / 200 already exists |
| GET | `/watchlist?page=&per_page=20` | 200 paginated, newest first |
| GET | `/watchlist/{movie_slug}/status` | 200 `{"is_saved": bool}` |
| DELETE | `/watchlist/{movie_slug}` | 200 `{"ok": true}` (idempotent) |

Unique key: `(user_id, movie_slug)`. Saving progress (`PUT /progress`,
including the explicit `/watched` marker) removes the movie from the
watchlist in the same commit — "started watching" supersedes "want to
watch".

## Watched episodes

| Method | Path | Success |
|--------|------|---------|
| GET | `/watched/{movie_slug}` | 200 `{"episode_slugs": [...]}` (≥90% of known duration) |
| POST | `/watched` `{movie_slug, movie_name, episode_slug, episode_name, ...}` | 200 (explicit marker for players without time access) |

## Ratings (stars 1–5, one per user per movie)

| Method | Path | Success |
|--------|------|---------|
| PUT | `/me/ratings` `{movie_slug, stars}` | 200 `{movie_slug, stars}` (upsert, second PUT wins) |
| GET | `/me/ratings/{movie_slug}/status` | 200 `{stars: int \| null}` |
| DELETE | `/me/ratings/{movie_slug}` | 200 `{"ok": true}` (idempotent) |
| GET | `/movies/{movie_slug}/rating` (public, no auth) | 200 `{average: float \| null (1 decimal), count}` |

Unique key: `(user_id, movie_slug)`. Average computed live (`AVG`/`COUNT`
with index — no cache table at current volume).

## Comments (one reply level, read-public)

| Method | Path | Success |
|--------|------|---------|
| GET | `/comments?movie_slug=&page=&per_page=20` (public, optional token) | 200 paginated top-level (newest first), each with `user`, `replies[]` (oldest first), `reply_count` |
| POST | `/me/comments` `{movie_slug, body 1–2000, parent_id?}` (rate-limited 10 req/min/user) | 201 created comment |
| DELETE | `/me/comments/{id}` | 200 `{"ok": true}` (owner only, deletes subtree; others → 404 `COMMENT_NOT_FOUND`) |

`CommentOut`/`ReplyOut` include `is_hidden: bool`; `body` is `str | null` —
for anonymous/normal users a hidden comment returns `body: null` (client shows
a placeholder) while replies are still returned. A valid moderator/admin token
(there is no 401 without one) widens `body` to the real text even when hidden.
Reporting and moderation live in `docs/api-moderation.md`.

Reply rules: parent must exist, belong to the same movie, and be top-level
(reply-to-reply → 422). Display name read live from `users` (rename applies
retroactively — accepted for v1).

## Notes

- No separate `watch_history` table: progress rows already record
  movie/episode/time, so history = progress ordered by `updated_at`
  (see `docs/decisions.md`).
- Rate limiting is fail-open: if Redis is down, progress writes still succeed.
