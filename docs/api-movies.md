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
| GET | `/{slug}/related?limit=12` | computed, xem bên dưới | 30 min |

Unknown `type` → 404 `INVALID_LIST_TYPE`; bad year → 400 `INVALID_YEAR`;
unknown slug → 404 `MOVIE_NOT_FOUND` (from upstream); upstream down with no
cache → 502 `UPSTREAM_ERROR`. `limit` ngoài 1–24 → 422.

## Phim liên quan (`/{slug}/related`)

Upstream **không có** endpoint related và search **không index diễn viên/đạo
diễn** (chỉ khớp tên phim — xem `docs/nguonc-api.md`). Nên danh sách này do
backend tự tính từ dữ liệu listing: mỗi item listing đều có `casts`,
`director`, `year`, nên **không cần fetch chi tiết từng ứng viên**.

1. Lấy detail của phim (dùng chung cache key với `/{slug}`).
2. Gom ứng viên từ: tối đa 2 thể loại (3 trang mỗi thể loại), quốc gia (3
   trang), năm (3 trang), và nếu tên có hậu tố phần ("(Phần 2)") thì search
   thêm phần gốc của tên — search chỉ khớp title nên đây là cách chắc chắn
   nhất để với tới các phần khác.
3. Chấm điểm: đạo diễn trùng +6/tên, diễn viên trùng +3/tên (tối đa 3 tên),
   trúng phần gốc tên +5, cùng năm +2, +2 mỗi danh sách thể loại mà ứng viên
   xuất hiện, cùng quốc gia +1, **trừ** khoảng cách năm (tối đa −4) vì listing
   xếp mới-nhất-trước nên dễ lấn át phim cũ. Tên người được chuẩn hoá
   alphanumeric nên "Woo Min-ho" ≡ "Woo Min Ho".
4. Bỏ chính phim đó, bỏ điểm ≤ 0, sắp xếp `(-điểm, slug)` (deterministic, cache
   không đổi thứ tự), cắt theo `limit`. Danh sách rỗng là hợp lệ (frontend ẩn
   rail). Một listing lỗi bị bỏ qua, không làm hỏng cả rail.


## Normalized shapes

Lists return `{items: MovieCard[], current_page, total_page, total_items,
per_page}`. `MovieCard` keeps only: `slug, name, original_name, thumb_url,
poster_url, description, year, quality, language, current_episode,
total_episodes, time`. Relative image paths are joined to the upstream origin.

Detail adds `provider_id, director, casts, formats[], genres[], countries[]`
and `servers[]`. Each server: `{name, episodes: [{name, slug, embed_url,
m3u8_url}]}`. Upstream only provides `embed` page URLs today, so `m3u8_url`
is `null` until direct streams appear (see `docs/nguonc-api.md`).

Related returns `{items: MovieCard[]}` — `director`/`casts` never leak (the
internal candidate model that carries them is not a response model).

## Cache behavior

- Key: `nguonc:{endpoint}:{sha256(params)[:16]}` (+ `:stale` copy kept 24h).
- Upstream error + stale copy present → HTTP 200 with `X-Cache: STALE`.
- Manual purge: `await cache.invalidate()` (prefix `nguonc:`), no public
  endpoint by design.
- Upstream client: singleton `httpx.AsyncClient`, 10s timeout, 2 retries with
  0.5s/1s backoff on transport/HTTP errors.
