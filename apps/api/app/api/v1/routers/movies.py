"""Public movie catalog router (proxied NguonC + Redis cache)."""

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.deps import get_optional_user
from app.core.exceptions import AppException
from app.db.models.user import User
from app.db.session import get_db
from app.schemas.library import CommentOut, PaginatedComments, RatingSummary
from app.schemas.movie import MovieDetail, PaginatedMovies
from app.services import cache, comment_service, nguonc, rating_service
from app.services.cache import DETAIL_TTL, LIST_TTL, SEARCH_TTL

router = APIRouter(prefix="/movies", tags=["movies"])

comments_router = APIRouter(tags=["comments"])

LIST_TYPES = ("dang-chieu", "phim-le", "phim-bo", "tv-shows")


async def _cached(
    response: Response,
    cache_name: str,
    params: dict,
    ttl: int,
    model,
    fetcher,
):
    data, status = await cache.cached_fetch(
        cache.cache_key(cache_name, params), ttl, model, fetcher
    )
    response.headers["X-Cache"] = status
    return data


@router.get("/latest", response_model=PaginatedMovies)
async def latest(
    response: Response, page: int = Query(default=1, ge=1, le=5000)
):
    return await _cached(
        response, "latest", {"page": page}, LIST_TTL, PaginatedMovies,
        lambda: nguonc.fetch_latest(page),
    )


@router.get("/list/{list_type}", response_model=PaginatedMovies)
async def by_list(
    list_type: str, response: Response, page: int = Query(default=1, ge=1, le=5000)
):
    if list_type not in LIST_TYPES:
        raise AppException(
            f"Unknown list type. Use one of: {', '.join(LIST_TYPES)}",
            "INVALID_LIST_TYPE",
            404,
        )
    return await _cached(
        response, f"list:{list_type}", {"page": page}, LIST_TTL, PaginatedMovies,
        lambda: nguonc.fetch_list(list_type, page),
    )


@router.get("/genre/{slug}", response_model=PaginatedMovies)
async def by_genre(
    slug: str, response: Response, page: int = Query(default=1, ge=1, le=5000)
):
    return await _cached(
        response, f"genre:{slug}", {"page": page}, LIST_TTL, PaginatedMovies,
        lambda: nguonc.fetch_genre(slug, page),
    )


@router.get("/country/{slug}", response_model=PaginatedMovies)
async def by_country(
    slug: str, response: Response, page: int = Query(default=1, ge=1, le=5000)
):
    return await _cached(
        response, f"country:{slug}", {"page": page}, LIST_TTL, PaginatedMovies,
        lambda: nguonc.fetch_country(slug, page),
    )


@router.get("/year/{year}", response_model=PaginatedMovies)
async def by_year(
    year: int, response: Response, page: int = Query(default=1, ge=1, le=5000)
):
    if year < 1900 or year > 2100:
        raise AppException("Year must be between 1900 and 2100", "INVALID_YEAR", 400)
    return await _cached(
        response, f"year:{year}", {"page": page}, LIST_TTL, PaginatedMovies,
        lambda: nguonc.fetch_year(year, page),
    )


@router.get("/search", response_model=PaginatedMovies)
async def search(
    response: Response,
    keyword: str = Query(min_length=1, max_length=100),
    page: int = Query(default=1, ge=1, le=5000),
):
    return await _cached(
        response, "search", {"keyword": keyword, "page": page},
        SEARCH_TTL, PaginatedMovies,
        lambda: nguonc.search(keyword, page),
    )


@router.get("/{slug}", response_model=MovieDetail)
async def detail(slug: str, response: Response):
    return await _cached(
        response, f"detail:{slug}", {}, DETAIL_TTL, MovieDetail,
        lambda: nguonc.fetch_detail(slug),
    )


@router.get("/{movie_slug}/rating", response_model=RatingSummary)
async def rating_summary(
    movie_slug: str,
    db: AsyncSession = Depends(get_db),
) -> RatingSummary:
    avg, count = await rating_service.summary(db, movie_slug)
    return RatingSummary(average=avg, count=count)


@comments_router.get("/comments", response_model=PaginatedComments)
async def list_comments(
    movie_slug: str = Query(min_length=1),
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    viewer: User | None = Depends(get_optional_user),
    db: AsyncSession = Depends(get_db),
) -> PaginatedComments:
    rows, total = await comment_service.list_paginated(
        db, movie_slug, page, per_page, viewer=viewer
    )
    return PaginatedComments(
        items=[CommentOut.model_validate(r) for r in rows],
        page=page,
        per_page=per_page,
        total_items=total,
    )
