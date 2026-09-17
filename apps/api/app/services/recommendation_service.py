"""Per-profile recommendation rail scoring over the catalog snapshot."""

import math
import uuid
from datetime import UTC
from functools import partial

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models.catalog_item import CatalogItem
from app.db.models.favorite import Favorite
from app.db.models.profile_preference import ProfilePreference
from app.db.models.rating import Rating
from app.schemas.movie import MovieCard
from app.schemas.recommendation import RecommendationItem, RecommendationsOut
from app.services import cache, catalog_service, preference_service, rating_service
from app.services.catalog_map import genre_label
from app.services.preference_service import LOVED_MIN_STARS

MAX_LIMIT = 50
FALLBACK_TTL_SECONDS = 300
GENRE_WEIGHT = 3.0
COUNTRY_WEIGHT = 1.0
PEOPLE_WEIGHT = 2.0
FRESH_YEAR_WEIGHT = 0.5
FRESH_YEAR = 2020


def _people(value: str | None) -> set[str]:
    if not value:
        return set()
    names: set[str] = set()
    for chunk in value.replace(";", ",").split(","):
        key = "".join(ch for ch in chunk.casefold() if ch.isalnum())
        if key:
            names.add(key)
    return names


def _card(item: CatalogItem) -> MovieCard:
    return MovieCard(
        slug=item.slug,
        name=item.name,
        original_name=item.original_name,
        thumb_url=item.thumb_url or None,
        poster_url=item.poster_url or None,
        year=str(item.year) if item.year is not None else None,
    )


def _version_of(prefs: ProfilePreference | None) -> int:
    if prefs is None or prefs.updated_at is None:
        return 0
    updated = prefs.updated_at
    if updated.tzinfo is None:
        updated = updated.replace(tzinfo=UTC)
    return int(updated.timestamp())


def _score(
    item: CatalogItem,
    genre_weights: dict[str, float],
    countries: dict[str, float],
    people: set[str],
    popular_avgs: dict[str, float],
) -> tuple[float, str | None]:
    genres = item.genres or []
    matched = [(g, genre_weights[g]) for g in genres if g in genre_weights]
    genre_part = 0.0
    if genres:
        genre_part = GENRE_WEIGHT * sum(w for _, w in matched) / math.sqrt(len(genres))
    reason_genre = None
    if matched:
        best_genre, best_weight = max(
            matched, key=lambda pair: (pair[1], pair[0])
        )
        if best_weight > 0:
            reason_genre = best_genre

    score = genre_part
    if item.country and item.country in countries:
        score += COUNTRY_WEIGHT
    if people and (_people(item.casts) | _people(item.director)) & people:
        score += PEOPLE_WEIGHT
    if item.year is not None and item.year >= FRESH_YEAR:
        score += FRESH_YEAR_WEIGHT
    score += popular_avgs.get(item.slug, 0.0)
    return score, reason_genre


async def _loved_people(
    db: AsyncSession, profile_id: uuid.UUID
) -> set[str]:
    favorites = (
        await db.execute(
            select(Favorite.movie_slug).where(Favorite.profile_id == profile_id)
        )
    ).scalars().all()
    loved = (
        await db.execute(
            select(Rating.movie_slug).where(
                Rating.profile_id == profile_id,
                Rating.stars >= LOVED_MIN_STARS,
            )
        )
    ).scalars().all()
    slugs = set(favorites) | set(loved)
    if not slugs:
        return set()
    people: set[str] = set()
    for item in await catalog_service.by_slugs(db, list(slugs)):
        people |= _people(item.casts)
        people |= _people(item.director)
    return people


async def _personal(
    db: AsyncSession,
    profile_id: uuid.UUID,
    prefs: ProfilePreference,
    limit: int,
) -> RecommendationsOut:
    behavior, seen = await preference_service.behavior_weights(db, profile_id)
    genre_weights = dict(prefs.genres or {})
    for genre, weight in behavior.items():
        genre_weights[genre] = genre_weights.get(genre, 0.0) + weight
    countries = dict(prefs.countries or {})
    people = await _loved_people(db, profile_id)

    items = await catalog_service.list_items(db)
    popular_avgs: dict[str, float] = {}
    if items:
        rated_slugs = (
            await db.execute(
                select(func.count(func.distinct(Rating.movie_slug)))
            )
        ).scalar() or 0
        popular_avgs = {
            slug: avg
            for slug, avg, _count in await rating_service.top_rated(
                db,
                min_count=settings.popular_min_ratings,
                limit=max(1, int(rated_slugs)),
            )
        }

    scored: list[tuple[float, str, str | None]] = []
    for item in items:
        if item.slug in seen:
            continue
        score, reason_genre = _score(
            item, genre_weights, countries, people, popular_avgs
        )
        scored.append((score, item.slug, reason_genre))
    scored.sort(key=lambda row: (-row[0], row[1]))

    by_slug = {item.slug: item for item in items}
    out = [
        RecommendationItem(
            movie=_card(by_slug[slug]),
            reason=f"Vì bạn thích {genre_label(genre)}" if genre else None,
        )
        for _score_value, slug, genre in scored[:limit]
    ]
    return RecommendationsOut(items=out, source="personal")


async def _newest(db: AsyncSession, limit: int) -> list[RecommendationItem]:
    stmt = (
        select(CatalogItem)
        .order_by(
            CatalogItem.year.is_(None),
            CatalogItem.year.desc(),
            CatalogItem.slug,
        )
        .limit(limit)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return [RecommendationItem(movie=_card(row), reason=None) for row in rows]


async def _fallback(db: AsyncSession, limit: int) -> RecommendationsOut:
    rated = await rating_service.top_rated(
        db, min_count=settings.popular_min_ratings, limit=limit
    )
    slugs = [slug for slug, _avg, _count in rated]
    catalog = {
        item.slug: item for item in await catalog_service.by_slugs(db, slugs)
    }
    items = [
        RecommendationItem(movie=_card(catalog[slug]), reason=None)
        for slug in slugs
        if slug in catalog
    ]
    source: str = "popular" if rated else "newest"
    if len(items) < limit:
        have = {item.movie.slug for item in items}
        for item in await _newest(db, limit + len(items)):
            if item.movie.slug not in have:
                items.append(item)
            if len(items) >= limit:
                break
    return RecommendationsOut(items=items[:limit], source=source)


async def recommend(
    db: AsyncSession, profile_id: uuid.UUID, limit: int
) -> RecommendationsOut:
    limit = max(1, min(limit, MAX_LIMIT))
    prefs = await preference_service.get_or_none(db, profile_id)
    version = _version_of(prefs)
    key = f"recs:{profile_id}:{version}"
    if (
        prefs is not None
        and prefs.onboarding_completed_at is not None
        and not prefs.skipped
    ):
        fetcher = partial(_personal, db, profile_id, prefs, MAX_LIMIT)
        ttl = settings.recs_cache_ttl
    else:
        fetcher = partial(_fallback, db, MAX_LIMIT)
        ttl = FALLBACK_TTL_SECONDS
    data, _status = await cache.cached_fetch(
        key, ttl, RecommendationsOut, fetcher
    )
    if limit >= len(data.items):
        return data
    return RecommendationsOut(items=data.items[:limit], source=data.source)
