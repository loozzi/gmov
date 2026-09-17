"""Related-movies endpoint tests with mocked upstream (respx) + fake redis.

The feature scores candidates pulled from the movie's own genre/country/year
listings, so every listing page the scorer can request has to be mocked. A
missing page route raises inside the gathered task, which the service
deliberately swallows — that would make a test pass for the wrong reason.
"""

import httpx
import pytest
import respx

from app.core.config import settings
from app.schemas.movie import CandidateCard, CandidatePage, MovieDetail
from app.services import nguonc, related_service
from app.services.catalog_map import country_slug

BASE = settings.nguonc_base_url

CARD_KEYS = {
    "slug", "name", "original_name", "thumb_url", "poster_url", "description",
    "year", "quality", "language", "current_episode", "total_episodes", "time",
}


def category(*groups):
    out = {}
    for index, (name, labels) in enumerate(groups, start=1):
        out[str(index)] = {
            "group": {"id": f"g{index}", "name": name},
            "list": [
                {"id": f"{index}-{n}", "name": label}
                for n, label in enumerate(labels)
            ],
        }
    return out


def make_detail(
    *,
    slug="mao",
    name="Mao",
    genres=("Hoạt Hình", "Giả Tưởng"),
    countries=("Nhật Bản",),
    year="2026",
    director="Satou Teruo",
    casts="Aoi Yu, Ken Sato",
):
    groups = []
    if genres:
        groups.append(("Thể loại", list(genres)))
    if countries:
        groups.append(("Quốc gia", list(countries)))
    if year is not None:
        groups.append(("Năm", [year]))
    return {
        "status": "success",
        "movie": {
            "id": "e7fbb55818def36977ba4a90d82958af",
            "name": name,
            "slug": slug,
            "original_name": name,
            "thumb_url": "/public/images/mao.jpg",
            "poster_url": "/public/images/mao1.jpg",
            "description": "Test desc",
            "total_episodes": 24,
            "current_episode": "Hoàn tất (24/24)",
            "time": "23 phút/tập",
            "quality": "HD",
            "language": "Vietsub",
            "year": year,
            "director": director,
            "casts": casts,
            "category": category(*groups),
            "episodes": [],
        },
    }


def candidate(slug, *, director=None, casts=None, year="2026"):
    pretty = slug.replace("-", " ").title()
    return {
        "name": pretty,
        "slug": slug,
        "original_name": pretty,
        "thumb_url": f"/public/images/{slug}.jpg",
        "poster_url": f"/public/images/{slug}1.jpg",
        "description": f"{slug} desc",
        "total_episodes": 12,
        "current_episode": "Hoàn tất (12/12)",
        "time": "24 phút/tập",
        "quality": "HD",
        "language": "Vietsub",
        "director": director,
        "casts": casts,
        "year": year,
    }


def candidate_payload(items):
    return {
        "status": "success",
        "paginate": {"current_page": 1, "total_page": 1, "total_items": len(items)},
        "items": items,
    }


def mock_detail(payload):
    return respx.get(f"{BASE}/film/{payload['movie']['slug']}").mock(
        return_value=httpx.Response(200, json=payload)
    )


def mock_listing(path, pages=None, status=200):
    routes = []
    for page in range(1, related_service.CANDIDATE_PAGES + 1):
        if status == 200:
            response = httpx.Response(
                200, json=candidate_payload((pages or {}).get(page, []))
            )
        else:
            response = httpx.Response(status, json={})
        routes.append(
            respx.get(f"{BASE}{path}", params={"page": page}).mock(
                return_value=response
            )
        )
    return routes


def register_rich_fixture():
    """Detail `mao` + all 12 candidate pages it will request.

    Expected ranking (people > year > genre-count > country):
      co-director   director match(6) + year(2) + genre(2) = 10
      shared-cast   1 cast(3) + year(2) + country(1)        = 6
      same-meta     year(2) + country(1)                    = 3
      year-only     year(2)                                 = 2
      mao (self)    would score 10 but is always excluded
    """
    detail_route = mock_detail(make_detail())
    listing_routes = []
    listing_routes += mock_listing(
        "/films/the-loai/hoat-hinh",
        {
            1: [
                candidate("mao", director="Satou Teruo"),
                candidate("co-director", director="Satou Teruo"),
            ]
        },
    )
    listing_routes += mock_listing("/films/the-loai/gia-tuong")
    listing_routes += mock_listing(
        "/films/quoc-gia/nhat-ban",
        {1: [candidate("shared-cast", casts="Aoi Yu"), candidate("same-meta")]},
    )
    listing_routes += mock_listing(
        "/films/nam-phat-hanh/2026", {1: [candidate("year-only")]}
    )
    return detail_route, listing_routes


@respx.mock
async def test_related_ranks_shared_people_first(client):
    register_rich_fixture()
    r = await client.get("/api/v1/movies/mao/related?limit=10")
    assert r.status_code == 200, r.text
    slugs = [item["slug"] for item in r.json()["items"]]
    assert slugs == ["co-director", "shared-cast", "same-meta", "year-only"]
    assert "mao" not in slugs


@respx.mock
async def test_related_response_has_no_internal_fields(client):
    register_rich_fixture()
    r = await client.get("/api/v1/movies/mao/related")
    assert r.status_code == 200, r.text
    items = r.json()["items"]
    assert items
    for item in items:
        assert "director" not in item
        assert "casts" not in item
        assert set(item) <= CARD_KEYS


@respx.mock
async def test_related_respects_limit_and_clamps(client):
    register_rich_fixture()

    r = await client.get("/api/v1/movies/mao/related?limit=2")
    assert r.status_code == 200, r.text
    assert len(r.json()["items"]) == 2

    too_big = await client.get("/api/v1/movies/mao/related?limit=999")
    assert too_big.status_code == 422

    zero = await client.get("/api/v1/movies/mao/related?limit=0")
    assert zero.status_code == 422


@respx.mock
async def test_related_second_call_is_cache_hit(client):
    detail_route, listing_routes = register_rich_fixture()

    first = await client.get("/api/v1/movies/mao/related")
    assert first.status_code == 200, first.text
    assert first.headers["X-Cache"] == "MISS"

    second = await client.get("/api/v1/movies/mao/related")
    assert second.headers["X-Cache"] == "HIT"
    assert second.json() == first.json()

    assert detail_route.call_count == 1
    assert all(route.call_count == 1 for route in listing_routes)


@respx.mock
async def test_related_reuses_detail_cache(client):
    detail_route, _ = register_rich_fixture()

    d = await client.get("/api/v1/movies/mao")
    assert d.status_code == 200, d.text

    r = await client.get("/api/v1/movies/mao/related")
    assert r.status_code == 200, r.text
    assert detail_route.call_count == 1


@respx.mock
async def test_related_survives_one_dead_listing(client):
    mock_detail(make_detail())
    mock_listing("/films/the-loai/hoat-hinh", status=500)
    mock_listing("/films/the-loai/gia-tuong")
    mock_listing(
        "/films/quoc-gia/nhat-ban",
        {1: [candidate("shared-cast", casts="Aoi Yu")]},
    )
    mock_listing("/films/nam-phat-hanh/2026", {1: [candidate("year-only")]})

    r = await client.get("/api/v1/movies/mao/related")
    assert r.status_code == 200, r.text
    slugs = [item["slug"] for item in r.json()["items"]]
    assert "shared-cast" in slugs
    assert "year-only" in slugs


@respx.mock
async def test_related_without_year_skips_year_route(client):
    mock_detail(make_detail(year="2026-2027"))
    mock_listing("/films/the-loai/hoat-hinh")
    mock_listing("/films/the-loai/gia-tuong")
    mock_listing(
        "/films/quoc-gia/nhat-ban",
        {1: [candidate("same-meta", year="2026-2027")]},
    )
    year_routes = mock_listing(
        "/films/nam-phat-hanh/2026-2027", {1: [candidate("year-only")]}
    )

    r = await client.get("/api/v1/movies/mao/related")
    assert r.status_code == 200, r.text
    assert all(route.call_count == 0 for route in year_routes)


@respx.mock
async def test_related_unknown_genre_label_falls_back(client):
    mock_detail(make_detail(genres=("Thể Loại Lạ",)))
    genre_routes = mock_listing("/films/the-loai/hoat-hinh")
    mock_listing("/films/the-loai/gia-tuong")
    mock_listing(
        "/films/quoc-gia/nhat-ban",
        {1: [candidate("shared-cast", casts="Aoi Yu")]},
    )
    mock_listing("/films/nam-phat-hanh/2026", {1: [candidate("year-only")]})

    r = await client.get("/api/v1/movies/mao/related")
    assert r.status_code == 200, r.text
    slugs = [item["slug"] for item in r.json()["items"]]
    assert "shared-cast" in slugs
    assert all(route.call_count == 0 for route in genre_routes)


@respx.mock
async def test_related_empty_when_detail_has_no_categories(client):
    mock_detail(make_detail(genres=(), countries=(), year=None))
    listing_routes = (
        mock_listing("/films/the-loai/hoat-hinh")
        + mock_listing("/films/quoc-gia/nhat-ban")
        + mock_listing("/films/nam-phat-hanh/2026")
    )

    r = await client.get("/api/v1/movies/mao/related")
    assert r.status_code == 200, r.text
    assert r.json() == {"items": []}
    assert all(route.call_count == 0 for route in listing_routes)


def test_rank_candidates_caps_cast_matches():
    detail = MovieDetail(slug="mao", name="Mao", casts="A, B, C", year="2026")
    job = ("genre", "hoat-hinh", 1)
    page = CandidatePage(
        items=[
            CandidateCard(slug="a-three", name="A", casts="A, B, C"),
            CandidateCard(slug="z-many", name="Z", casts="A, B, C, D, E"),
        ]
    )
    ranked = related_service.rank_candidates(detail, [job], [page], 12)
    assert [card.slug for card in ranked] == ["a-three", "z-many"]


def test_rank_candidates_drops_zero_scores():
    detail = MovieDetail(slug="mao", name="Mao", year="2026")
    job = ("year", "2026", 1)
    page = CandidatePage(
        items=[CandidateCard(slug="nobody", name="N", year="1999")]
    )
    assert related_service.rank_candidates(detail, [job], [page], 12) == []


def test_country_slug_normalises_whitespace_and_case():
    assert country_slug("  hàn   quốc ") == "han-quoc"
    assert country_slug("không tồn tại") is None


def detail_model(
    *,
    name="Mao",
    genres=("Hoạt Hình", "Giả Tưởng"),
    countries=("Nhật Bản",),
    year="2026",
    director="Satou Teruo",
    casts="Aoi Yu, Ken Sato",
):
    return MovieDetail(
        slug="mao",
        name=name,
        genres=list(genres),
        countries=list(countries),
        year=year,
        director=director,
        casts=casts,
    )


def test_base_title_strips_part_markers():
    assert related_service.base_title("Đế Chế Đại Hàn (Phần 2)") == "Đế Chế Đại Hàn"
    assert related_service.base_title("Foo [Season 3]") == "Foo"
    assert related_service.base_title("Bar - Tập 12") == "Bar"
    # A title that is only a marker must not be reduced to nothing, and a plain
    # title must come back untouched.
    assert related_service.base_title("Tập 12") == "Tập 12"
    assert related_service.base_title("Hoa Thiên Cốt") == "Hoa Thiên Cốt"


def test_candidate_jobs_search_only_for_part_marked_titles():
    marked = related_service.candidate_jobs(
        detail_model(name="Đế Chế Đại Hàn (Phần 2)")
    )
    assert ("search", "Đế Chế Đại Hàn", 1) in marked
    # A sibling search would only return the film itself, so it is skipped.
    plain = related_service.candidate_jobs(detail_model(name="Hoa Thiên Cốt"))
    assert [job for job in plain if job[0] == "search"] == []


def test_candidate_jobs_skip_unresolvable_labels():
    jobs = related_service.candidate_jobs(
        detail_model(genres=("Thể Loại Lạ",), countries=("Xứ Lạ",), year="2026-2027")
    )
    assert jobs == []


def test_people_match_ignores_punctuation_and_spacing():
    detail = detail_model(director="Woo Min Ho", casts="Jung Woo Sung")
    pages = [
        CandidatePage(
            items=[
                CandidateCard(
                    **candidate(
                        "hyphenated", director="Woo Min-ho", casts="Jung Woo-sung"
                    )
                ),
                # Same slots, wrong person, long past: must score <= 0 and drop.
                CandidateCard(**candidate("stranger", year="1990")),
            ]
        )
    ]
    ranked = related_service.rank_candidates(
        detail, [("country", "han-quoc", 1)], pages, 5
    )
    assert [movie.slug for movie in ranked] == ["hyphenated"]


@respx.mock
async def test_related_slices_one_cached_pool(client):
    detail_route, _ = register_rich_fixture()

    small = await client.get("/api/v1/movies/mao/related?limit=2")
    assert small.status_code == 200, small.text
    assert small.headers["X-Cache"] == "MISS"
    assert len(small.json()["items"]) == 2

    # A different limit is the same computation: served from the same entry,
    # without touching upstream again.
    wider = await client.get("/api/v1/movies/mao/related?limit=4")
    assert wider.headers["X-Cache"] == "HIT"
    assert len(wider.json()["items"]) == 4
    assert wider.json()["items"][:2] == small.json()["items"]
    assert detail_route.call_count == 1


@pytest.fixture(autouse=True)
def _no_retry_backoff(monkeypatch):
    """Upstream failures are expected here; do not sleep between retries."""
    monkeypatch.setattr(nguonc, "BACKOFF_SECONDS", (0.0, 0.0))


def register_franchise_fixture():
    """Detail whose name carries a part marker + the franchise-root search."""
    detail_route = mock_detail(make_detail(name="Đế Chế Đại Hàn (Phần 2)"))
    listing_routes = []
    listing_routes += mock_listing("/films/the-loai/hoat-hinh")
    listing_routes += mock_listing("/films/the-loai/gia-tuong")
    listing_routes += mock_listing("/films/quoc-gia/nhat-ban")
    listing_routes += mock_listing(
        "/films/nam-phat-hanh/2026", {1: [candidate("decoy")]}
    )
    search_route = respx.get(
        f"{BASE}/films/search", params={"keyword": "Đế Chế Đại Hàn", "page": 1}
    ).mock(
        return_value=httpx.Response(
            200,
            json=candidate_payload(
                # Search items carry no year, like the real upstream.
                [candidate("part-1", director="Satou Teruo", casts="Aoi Yu", year=None)]
            ),
        )
    )
    return detail_route, search_route, listing_routes


@respx.mock
async def test_related_searches_franchise_root(client):
    _, search_route, _ = register_franchise_fixture()
    r = await client.get("/api/v1/movies/mao/related?limit=6")
    assert r.status_code == 200, r.text
    slugs = [item["slug"] for item in r.json()["items"]]
    # director(6) + cast(3) + franchise root(5) beats the same-year decoy(2).
    assert slugs[0] == "part-1"
    assert search_route.call_count == 1
    assert search_route.calls[0].request.url.params["keyword"] == "Đế Chế Đại Hàn"


@respx.mock
async def test_related_all_listings_down_is_empty_not_error(client):
    mock_detail(make_detail())
    for path in (
        "/films/the-loai/hoat-hinh",
        "/films/the-loai/gia-tuong",
        "/films/quoc-gia/nhat-ban",
        "/films/nam-phat-hanh/2026",
    ):
        mock_listing(path, status=500)

    r = await client.get("/api/v1/movies/mao/related")
    assert r.status_code == 200, r.text
    assert r.json() == {"items": []}


@respx.mock
async def test_related_unknown_slug_is_404(client):
    respx.get(f"{BASE}/film/khong-ton-tai").mock(
        return_value=httpx.Response(404, json={"status": "error"})
    )
    r = await client.get("/api/v1/movies/khong-ton-tai/related")
    assert r.status_code == 404
    assert r.json()["code"] == "MOVIE_NOT_FOUND"


@respx.mock
async def test_related_rate_limit(client, monkeypatch):
    # Keep the window small instead of firing 60 requests.
    from app.api.v1.routers import movies

    monkeypatch.setattr(movies, "RELATED_RATE_LIMIT", 2)
    register_rich_fixture()

    for _ in range(2):
        ok = await client.get("/api/v1/movies/mao/related?limit=2")
        assert ok.status_code == 200, ok.text

    blocked = await client.get("/api/v1/movies/mao/related?limit=2")
    assert blocked.status_code == 429
    assert blocked.json()["code"] == "RATE_LIMITED"
