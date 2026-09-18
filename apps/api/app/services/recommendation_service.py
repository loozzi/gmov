"""Per-profile recommendation rail scoring over the catalog snapshot."""

import math
import uuid
from datetime import UTC
from functools import partial

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.models.catalog_item import CatalogItem
from app.db.models.profile_preference import ProfilePreference
from app.db.models.rating import Rating
from app.schemas.recommendation import RecommendationItem, RecommendationsOut
from app.services import (
    cache,
    catalog_service,
    preference_service,
    rating_service,
    taste_service,
)
from app.services.catalog_map import genre_label
from app.services.taste_service import TasteProfile

MAX_LIMIT = 50
FALLBACK_TTL_SECONDS = 300
# Bump when scoring/exclusion rules change: the cache key otherwise only tracks
# user data, so a deployed algorithm change would serve stale rails for the TTL.
ENGINE_VERSION = 2
GENRE_WEIGHT = 3.0
COUNTRY_WEIGHT = 1.0
PEOPLE_WEIGHT = 2.0
FRESH_YEAR_WEIGHT = 0.5
FRESH_YEAR = 2020

SOURCE_REASONS = {
    taste_service.SOURCE_EXPLICIT: "Vì bạn thích phim {genre}",
    taste_service.SOURCE_FAVORITE: "Vì bạn yêu thích phim {genre}",
    taste_service.SOURCE_RATING: "Vì bạn đánh giá cao phim {genre}",
    taste_service.SOURCE_FINISHED: "Vì bạn đã xem hết phim {genre}",
    taste_service.SOURCE_IN_PROGRESS: "Vì bạn đang xem phim {genre}",
    taste_service.SOURCE_WATCHLIST: "Vì bạn muốn xem phim {genre}",
    taste_service.SOURCE_FEEDBACK: "Vì bạn quan tâm phim {genre}",
}
POPULAR_REASON = "Được đánh giá cao"


def _matched_person(item: CatalogItem, people: set[str]) -> str | None:
    if not people:
        return None
    for value in (item.casts, item.director):
        if not value:
            continue
        for chunk in value.replace(";", ",").split(","):
            name = chunk.strip()
            key = "".join(ch for ch in name.casefold() if ch.isalnum())
            if key and key in people:
                return name
    return None


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
) -> tuple[float, str | None, str | None]:
    genres = item.genres or []
    matched = [(g, genre_weights[g]) for g in genres if g in genre_weights]
    genre_part = 0.0
    if genres:
        genre_part = GENRE_WEIGHT * sum(w for _, w in matched) / math.sqrt(len(genres))
    best_genre = None
    if matched:
        candidate, weight = max(matched, key=lambda pair: (pair[1], pair[0]))
        if weight > 0:
            best_genre = candidate

    score = genre_part
    if item.country and item.country in countries:
        score += COUNTRY_WEIGHT
    person = _matched_person(item, people)
    if person:
        score += PEOPLE_WEIGHT
    if item.year is not None and item.year >= FRESH_YEAR:
        score += FRESH_YEAR_WEIGHT
    score += popular_avgs.get(item.slug, 0.0)
    return score, best_genre, person


def _genre_reason(taste: TasteProfile, genre: str) -> str:
    per_source = taste.sources.get(genre, {})
    if not per_source:
        return f"Vì bạn thích phim {genre_label(genre)}"
    source = max(per_source, key=lambda key: per_source[key])
    template = SOURCE_REASONS.get(source, "Vì bạn thích phim {genre}")
    return template.format(genre=genre_label(genre))


async def _popular_avgs(db: AsyncSession) -> dict[str, float]:
    rated_slugs = (
        await db.execute(select(func.count(func.distinct(Rating.movie_slug))))
    ).scalar() or 0
    if not rated_slugs:
        return {}
    return {
        slug: avg
        for slug, avg, _count in await rating_service.top_rated(
            db,
            min_count=settings.popular_min_ratings,
            limit=max(1, int(rated_slugs)),
        )
    }


async def _personal(
    db: AsyncSession,
    profile_id: uuid.UUID,
    prefs: ProfilePreference | None,
    limit: int,
) -> RecommendationsOut:
    taste = await taste_service.taste_profile(db, profile_id, prefs)
    items = await catalog_service.list_items(db)
    popular_avgs = await _popular_avgs(db) if items else {}

    scored: list[tuple[float, str, str | None, str | None]] = []
    for item in items:
        if item.slug in taste.seen:
            continue
        # Excluding a genre drops the movie entirely, not just its weight: most
        # animation titles also carry a liked genre ("hanh-dong", "gia-tuong"),
        # so zeroing the weight alone still recommended them.
        if taste.excluded_genres and set(item.genres or []) & taste.excluded_genres:
            continue
        score, best_genre, person = _score(
            item,
            taste.genre_weights,
            taste.country_weights,
            taste.people,
            popular_avgs,
        )
        scored.append((score, item.slug, best_genre, person))
    scored.sort(key=lambda row: (-row[0], row[1]))

    by_slug = {item.slug: item for item in items}
    out: list[RecommendationItem] = []
    for _score_value, slug, genre, person in scored[:limit]:
        item = by_slug[slug]
        reason = _genre_reason(taste, genre) if genre else None
        if reason is None and person:
            reason = f"Có {person} bạn đã xem"
        if reason is None and slug in popular_avgs:
            reason = POPULAR_REASON
        out.append(
            RecommendationItem(movie=catalog_service.card_of(item), reason=reason)
        )
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
    return [
        RecommendationItem(movie=catalog_service.card_of(row), reason=None)
        for row in rows
    ]


async def _fallback(db: AsyncSession, limit: int) -> RecommendationsOut:
    rated = await rating_service.top_rated(
        db, min_count=settings.popular_min_ratings, limit=limit
    )
    slugs = [slug for slug, _avg, _count in rated]
    catalog = {item.slug: item for item in await catalog_service.by_slugs(db, slugs)}
    items = [
        RecommendationItem(movie=catalog_service.card_of(catalog[slug]), reason=None)
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
    onboarded = (
        prefs is not None
        and prefs.onboarding_completed_at is not None
        and not prefs.skipped
    )
    if onboarded or await taste_service.has_signals(db, profile_id):
        signals_version = await taste_service.signals_version(db, profile_id)
        key = (
            f"recs:{profile_id}:{ENGINE_VERSION}:"
            f"{_version_of(prefs)}:{signals_version}"
        )
        fetcher = partial(_personal, db, profile_id, prefs, MAX_LIMIT)
        ttl = settings.recs_cache_ttl
    else:
        key = f"recs:{profile_id}:{ENGINE_VERSION}:{_version_of(prefs)}"
        fetcher = partial(_fallback, db, MAX_LIMIT)
        ttl = FALLBACK_TTL_SECONDS
    data, _status = await cache.cached_fetch(key, ttl, RecommendationsOut, fetcher)
    if limit >= len(data.items):
        return data
    return RecommendationsOut(items=data.items[:limit], source=data.source)
