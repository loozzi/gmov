# NguonC Movie API — observed schema (Phase 0)

Source: https://phim.nguonc.com/api-document
Probed: 2026-09-15 via `curl` (no API key, plain HTTPS GET, JSON).
Base URL: `https://phim.nguonc.com/api`

> Rule: fields below are from REAL responses. Do not invent fields.
> If a response differs from this doc, trust the response and update this doc.

## Endpoints (7)

| # | Method | Path | Params |
|---|--------|------|--------|
| 1 | GET | `/films/phim-moi-cap-nhat` | `page` (int, 1-based) |
| 2 | GET | `/films/danh-sach/{slug}` | `slug` e.g. `dang-chieu`, `phim-le`, `phim-bo`, `tv-shows`; `page` |
| 3 | GET | `/film/{slug}` | `slug` (movie slug) |
| 4 | GET | `/films/the-loai/{slug}` | `slug` e.g. `hanh-dong`; `page` |
| 5 | GET | `/films/quoc-gia/{slug}` | `slug` e.g. `au-my`; `page` |
| 6 | GET | `/films/nam-phat-hanh/{year}` | `year` e.g. `2024`; `page` |
| 7 | GET | `/films/search` | `keyword` (query string) |

Known category slugs (`danh-sach`): `dang-chieu`, `phim-le`, `phim-bo`, `tv-shows`.
Known genre slugs (`the-loai`): `hanh-dong`, `phieu-luu`, `hoat-hinh`, `phim-hai`,
`hinh-su`, `tai-lieu`, `chinh-kich`, `gia-dinh`, `gia-tuong`, `lich-su`, `kinh-di`,
`phim-nhac`, `bi-an`, `lang-man`, `khoa-hoc-vien-tuong`, `gay-can`, `chien-tranh`,
`tam-ly`, `tinh-cam`, `co-trang`, `mien-tay`, `phim-18`.
Known country slugs (`quoc-gia`): `au-my`, `anh`, `trung-quoc`, `indonesia`,
`viet-nam`, `phap`, `hong-kong`, `han-quoc`, `nhat-ban`, `thai-lan`, `dai-loan`,
`nga`, `ha-lan`, `philippines`, `an-do`, `quoc-gia-khac`.

## List response (endpoints 1, 2, 4, 5, 6, 7)

Top-level keys: `status`, `paginate`, `items`, plus `cat` on endpoints 2/4/5/6
(search has NO `cat`).

```json
{
  "status": "success",
  "paginate": {
    "current_page": 1,
    "total_page": 3350,
    "total_items": 33495,
    "items_per_page": 10
  },
  "cat": { "name": "Đang chiếu", "title": "Đang chiếu", "slug": "dang-chieu" },
  "items": [
    {
      "name": "Mao",
      "slug": "mao",
      "original_name": "Mao",
      "thumb_url": "https://phim.nguonc.com/public/images/Post/2/mao.jpg",
      "poster_url": "https://phim.nguonc.com/public/images/Post/2/mao1.jpg",
      "created": "2026-04-06T03:39:38.000000Z",
      "modified": "2026-09-14T16:47:00.000000Z",
      "description": "Nanoka vô tình xuyên qua...",
      "total_episodes": 24,
      "current_episode": "Hoàn tất (24/24)",
      "time": "23 phút/tập",
      "quality": "HD",
      "language": "Vietsub",
      "director": "Satou Teruo",
      "casts": null,
      "year": "2026"
    }
  ]
}
```

Notes (observed):
- List items have NO `id` field. Detail movie HAS `id`.
- List items HAVE `year` (string, may be year like `"2026"`). Detail movie has NO `year`
  (year lives inside `category` group `"Năm"` instead).
- `casts` and `director` can be `null` or comma-separated strings.
- `items_per_page` is 10.
- Out-of-range page: `{"status":"error","message":"Page must be an integer between 1 and 5000."}`

## Detail response (endpoint 3)

Top-level keys: `status`, `movie`. No `paginate`.

```json
{
  "status": "success",
  "movie": {
    "id": "bb43b255f1e4020e7ad8f6cd9d39fa9d",
    "name": "Hoa Thiên Cốt",
    "slug": "hoa-thien-cot",
    "original_name": "The Journey Of Flower",
    "thumb_url": "https://...",
    "poster_url": "https://...",
    "created": "2023-08-11T19:36:38.000000Z",
    "modified": "2024-04-29T13:26:43.000000Z",
    "description": "<p>Hoa Thiên Cốt: ...</p>",
    "total_episodes": 50,
    "current_episode": "Hoàn tất (50/50)",
    "time": "45 phút/tập",
    "quality": "HD",
    "language": "Vietsub + Lồng Tiếng",
    "director": "Cao Lâm Báo, ...",
    "casts": "Hoắc Kiến Hoa, Triệu Lệ Dĩnh, ...",
    "category": {
      "1": {
        "group": { "id": "c4ca4238a0b923820dcc509a6f75849b", "name": "Định dạng" },
        "list": [{ "id": "eccbc87e4b5ce2fe28308fd9f2a7baf3", "name": "Phim bộ" }]
      },
      "2": {
        "group": { "id": "1679091c5a880faf6fb5e6087eb1b2dc", "name": "Thể loại" },
        "list": [{ "id": "a8baa56554f96369ab93e4f3bb068c22", "name": "Cổ Trang" }]
      },
      "3": {
        "group": { "id": "8e296a067a37563370ded05f5a3bf3ec", "name": "Năm" },
        "list": [{ "id": "a5771bce93e200c36f7cd9dfd0e5deaa", "name": "2015" }]
      },
      "4": {
        "group": { "id": "67c6a1e7ce56d3d6fa748ab6d9af3fd7", "name": "Quốc gia" },
        "list": [{ "id": "c0c7c76d30bd3dcaefc96f40275bdc0a", "name": "Trung Quốc" }]
      }
    },
    "episodes": [
      { "server_name": "Vietsub #1", "server_data": [] },
      { "server_name": "Lồng Tiếng #1", "server_data": [] }
    ]
  }
}
```

Notes (observed 2026-09-15, re-probed):
- `category` is a dict keyed by `"1".."4"` (Định dạng / Thể loại / Năm / Quốc gia),
  NOT a list. Backend must parse it as `dict[str, CategoryGroup]`.
- `episodes` is a list of server objects. Observed server keys:
  `{server_name, items}` on current responses (older probes also showed an empty
  `server_data` key — the parser MUST accept both `items` and `server_data`).
- Episode item keys observed: `{name, slug, embed}` where `embed` is an
  `https://embed*.streamc.xyz/embed.php?hash=...` page URL. **No `link_m3u8`
  field exists in real responses** — our API exposes `embed_url` and a nullable
  `m3u8_url` (null until upstream provides direct streams).
- The episode parser must tolerate empty `items`/`server_data` and `episodes: []`.
- `description` may contain raw HTML (`<p>...</p>`) — sanitize before rendering.
- Unknown slug → HTTP 404 `{"status":"error","message":"Movie doesn't exist"}`.
- Timestamps are `YYYY-MM-DDTHH:mm:ss.ffffffZ` strings.

### Search & listing fields (re-probed 2026-09-17, for "related movies")

- **`/films/search` matches TITLES ONLY.** Searching a known actor or director
  ("Hyun Bin", "Woo Min Ho", "Hoắc Kiến Hoa") returns **0 items**; searching a
  film title returns that film (and remakes/同名). Không có cách tìm theo người
  từ upstream.
- **List items carry people**: every `items[]` entry of endpoints 2/4/5/6/7 (and
  search) includes `casts`, `director`, `year` — the same fields as the detail.
  This is what makes content-based "related" possible without N detail calls.
  (Our public `MovieCard` intentionally drops them; the related scorer uses an
  internal model.)
- **`)` search items have NO `year`** (`year: null`) while the browse lists DO.
- Hậu tố phần trong tên: "Đế Chế Đại Hàn (Phần 2)" → searching the root
  "Đế Chế Đại Hàn" returns both parts (each with its own `casts`/`director`).
- Cùng một người được viết khác nhau giữa các phim: "Woo Min-ho" vs
  "Woo Min Ho", "Jung Woo-sung" vs "Jung Woo Sung" → phải chuẩn hoá khi so khớp.
- Nhãn của `/films/the-loai/{slug}` trong `cat.name` **không khớp** nhãn trong
  detail của chính các phim đó: list nói "Hài"/"Nhạc", detail nói
  "Phim Hài"/"Phim Nhạc"; và `cat.name` của `/films/quoc-gia/{slug}` là **tiếng
  Anh** ("South Korea") trong khi detail dùng tiếng Việt ("Hàn Quốc"). Bản đồ
  nhãn→slug vì vậy phải lấy theo nhãn **trong detail**
  (`apps/api/app/services/catalog_map.py`, đã xác minh 22/22 genre, 16/16 quốc gia).


## Mapping to our internal models (proposal for later phases)

- `FilmListItem` ← list `items[]`: `slug` (PK/stable id), `name`, `original_name`,
  `thumb_url`, `poster_url`, `description`, `total_episodes`, `current_episode`,
  `time`, `quality`, `language`, `director`, `casts`, `year` (nullable),
  `modified` (for sorting/cache).
- `FilmDetail` ← `movie`: all above + provider `id`, `category` groups
  (format/genres/year/country as string lists), `episodes` (servers).
- Upstream has no integer PK for list items → OUR backend uses `slug` as the
  stable identity everywhere (favorites, history, progress keyed by slug).
- Cache key suggestion: `nguonc:{path}:{query}` with TTL ~1h (see decisions.md).
