"""NguonC upstream client: fetch + normalize (never expose raw JSON)."""

import asyncio
from urllib.parse import urljoin, urlparse

import httpx

from app.core.config import settings
from app.core.exceptions import AppException
from app.schemas.movie import (
    Episode,
    MovieCard,
    MovieDetail,
    PaginatedMovies,
    ServerGroup,
)

MAX_RETRIES = 2
BACKOFF_SECONDS = (0.5, 1.0)

_client: httpx.AsyncClient | None = None


def get_client() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(
            base_url=settings.nguonc_base_url,
            timeout=settings.nguonc_timeout_seconds,
            headers={"Accept": "application/json"},
        )
    return _client


async def aclose_client() -> None:
    global _client
    if _client is not None:
        await _client.aclose()
        _client = None


def image_origin() -> str:
    parts = urlparse(settings.nguonc_base_url)
    return f"{parts.scheme}://{parts.netloc}"


def abs_url(value: str | None) -> str | None:
    if not value:
        return None
    if value.startswith("http://") or value.startswith("https://"):
        return value
    return urljoin(image_origin() + "/", value.lstrip("/"))


async def _get(path: str, params: dict | None = None) -> dict:
    last_error: Exception | None = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            resp = await get_client().get(path, params=params)
            if resp.status_code == 404:
                raise AppException("Movie not found", "MOVIE_NOT_FOUND", 404)
            resp.raise_for_status()
            return resp.json()
        except AppException:
            raise
        except (httpx.TransportError, httpx.HTTPStatusError, ValueError) as exc:
            last_error = exc
            if attempt < MAX_RETRIES:
                await asyncio.sleep(BACKOFF_SECONDS[attempt])
    raise AppException(
        f"Upstream movie source unavailable ({last_error})",
        "UPSTREAM_ERROR",
        502,
    )


def to_card(raw: dict) -> MovieCard:
    year = raw.get("year")
    return MovieCard(
        slug=raw.get("slug", ""),
        name=raw.get("name", ""),
        original_name=raw.get("original_name"),
        thumb_url=abs_url(raw.get("thumb_url")),
        poster_url=abs_url(raw.get("poster_url")),
        description=raw.get("description"),
        year=str(year) if year is not None else None,
        quality=raw.get("quality"),
        language=raw.get("language"),
        current_episode=raw.get("current_episode"),
        total_episodes=raw.get("total_episodes"),
        time=raw.get("time"),
    )


def _category_names(category: dict, group_name: str) -> list[str]:
    names: list[str] = []
    for group in category.values():
        if not isinstance(group, dict):
            continue
        grp = group.get("group", {})
        if grp.get("name") != group_name:
            continue
        for item in group.get("list", []):
            if isinstance(item, dict) and item.get("name"):
                names.append(item["name"])
    return names


def to_episode(raw: dict) -> Episode:
    return Episode(
        name=str(raw.get("name", "")),
        slug=raw.get("slug"),
        embed_url=raw.get("embed"),
        m3u8_url=raw.get("link_m3u8") or raw.get("m3u8_url"),
    )


def to_server(raw: dict) -> ServerGroup:
    items = raw.get("items") or raw.get("server_data") or []
    episodes = [to_episode(i) for i in items if isinstance(i, dict)]
    return ServerGroup(name=str(raw.get("server_name", "")), episodes=episodes)


def to_detail(raw: dict) -> MovieDetail:
    card = to_card(raw)
    category = raw.get("category") or {}
    years = _category_names(category, "Năm")
    fields = card.model_dump()
    fields["year"] = card.year or (years[0] if years else None)
    return MovieDetail(
        **fields,
        provider_id=raw.get("id"),
        director=raw.get("director"),
        casts=raw.get("casts"),
        formats=_category_names(category, "Định dạng"),
        genres=_category_names(category, "Thể loại"),
        countries=_category_names(category, "Quốc gia"),
        servers=[to_server(s) for s in (raw.get("episodes") or [])],
    )


def to_paginated(data: dict) -> PaginatedMovies:
    paginate = data.get("paginate", {})
    return PaginatedMovies(
        items=[to_card(i) for i in data.get("items", [])],
        current_page=int(paginate.get("current_page", 1)),
        total_page=int(paginate.get("total_page", 1)),
        total_items=int(paginate.get("total_items", 0)),
        per_page=int(paginate.get("items_per_page", 10)),
    )


def _require_success(data: dict) -> dict:
    if data.get("status") == "error":
        raise AppException(
            str(data.get("message", "Upstream error")), "UPSTREAM_ERROR", 502
        )
    return data


async def fetch_latest(page: int = 1) -> PaginatedMovies:
    data = await _get("/films/phim-moi-cap-nhat", {"page": page})
    return to_paginated(_require_success(data))


async def fetch_list(list_type: str, page: int = 1) -> PaginatedMovies:
    data = await _get(f"/films/danh-sach/{list_type}", {"page": page})
    return to_paginated(_require_success(data))


async def fetch_genre(slug: str, page: int = 1) -> PaginatedMovies:
    data = await _get(f"/films/the-loai/{slug}", {"page": page})
    return to_paginated(_require_success(data))


async def fetch_country(slug: str, page: int = 1) -> PaginatedMovies:
    data = await _get(f"/films/quoc-gia/{slug}", {"page": page})
    return to_paginated(_require_success(data))


async def fetch_year(year: int, page: int = 1) -> PaginatedMovies:
    data = await _get(f"/films/nam-phat-hanh/{year}", {"page": page})
    return to_paginated(_require_success(data))


async def search(keyword: str, page: int = 1) -> PaginatedMovies:
    data = await _get("/films/search", {"keyword": keyword, "page": page})
    return to_paginated(_require_success(data))


async def fetch_detail(slug: str) -> MovieDetail:
    data = await _get(f"/film/{slug}")
    data = _require_success(data)
    return to_detail(data.get("movie", {}))
