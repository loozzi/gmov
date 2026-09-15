# Movies API (Phase 2)

Public catalog proxied from NguonC, normalized and cached in Redis.
Base: `/api/v1/movies`. Every response carries `X-Cache: HIT | MISS | STALE`.

## Endpoints (all public)

| Method | Path | Upstream | Cache TTL |
|--------|------|----------|-----------|
| GET | `/latest?page=1` | `/films/phim-moi-cap-nhat` | 10 min |
| GET | `/list/{type}?page=1` | `/films/danh-sach/{type}` (`dang-chieu`, `phim-le`, `phim-bo`, `tv-shows`) | 10 min |
| GET | `/genre/{slug}?page=1` | `/films/the-loai/{slug}` | 10 min |
| GET | `/country/{slug}?page=1` | `/films/quoc-gia/{slug}` | 10 min |
| GET | `/year/{year}?page=1` | `/films/nam-phat-hanh/{year}` (1900–2100) | 10 min |
| GET | `/search?keyword=&page=1` | `/films/search` | 5 min |
| GET | `/{slug}` | `/film/{slug}` | 30 min |

Unknown `type` → 404 `INVALID_LIST_TYPE`; bad year → 400 `INVALID_YEAR`;
unknown slug → 404 `MOVIE_NOT_FOUND` (from upstream); upstream down with no
cache → 502 `UPSTREAM_ERROR`.

## Normalized shapes

Lists return `{items: MovieCard[], current_page, total_page, total_items,
per_page}`. `MovieCard` keeps only: `slug, name, original_name, thumb_url,
poster_url, description, year, quality, language, current_episode,
total_episodes, time`. Relative image paths are joined to the upstream origin.

Detail adds `provider_id, director, casts, formats[], genres[], countries[]`
and `servers[]`. Each server: `{name, episodes: [{name, slug, embed_url,
m3u8_url}]}`. Upstream only provides `embed` page URLs today, so `m3u8_url`
is `null` until direct streams appear (see `docs/nguonc-api.md`).

## Cache behavior

- Key: `nguonc:{endpoint}:{sha256(params)[:16]}` (+ `:stale` copy kept 24h).
- Upstream error + stale copy present → HTTP 200 with `X-Cache: STALE`.
- Manual purge: `await cache.invalidate()` (prefix `nguonc:`), no public
  endpoint by design.
- Upstream client: singleton `httpx.AsyncClient`, 10s timeout, 2 retries with
  0.5s/1s backoff on transport/HTTP errors.
