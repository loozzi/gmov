"""Derived + explicit taste profile for one profile.

Derived signals (favorites, ratings, watch progress, watchlist, card feedback)
are computed on read and never persisted, so resetting onboarding cannot lose
them. Explicit weights (quiz/poster/manual edits) live in `profile_preferences`
and `excluded_genres` there lets the user drop a genre regardless of source.

`taste_profile` is the single source feeding both the recommendation scorer and
the "Gu của tôi" page (effective weights + per-source breakdown).
"""

import uuid
from dataclasses import dataclass, field
from datetime import UTC

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.favorite import Favorite
from app.db.models.profile_preference import ProfilePreference
from app.db.models.rating import Rating
from app.db.models.recommendation_feedback import (
    INTERESTED,
    RecommendationFeedback,
)
from app.db.models.watch_progress import WatchProgress
from app.db.models.watchlist import Watchlist
from app.services import catalog_service
from app.services.preference_service import GENRE_CAP

SOURCE_EXPLICIT = "explicit"
SOURCE_FAVORITE = "favorite"
SOURCE_RATING = "rating"
SOURCE_FINISHED = "finished"
SOURCE_IN_PROGRESS = "in_progress"
SOURCE_WATCHLIST = "watchlist"
SOURCE_FEEDBACK = "feedback"

FAVORITE_WEIGHT = 1.0
LOVED_RATING_WEIGHT = 1.5
DISLIKED_RATING_WEIGHT = -1.5
FINISHED_WEIGHT = 0.5
IN_PROGRESS_WEIGHT = 0.2
WATCHLIST_WEIGHT = 0.3
FEEDBACK_INTERESTED_WEIGHT = 1.0
FEEDBACK_NOT_INTERESTED_WEIGHT = -2.0

LOVED_MIN_STARS = 4
DISLIKED_MAX_STARS = 2
FINISHED_RATIO = 0.9
IN_PROGRESS_RATIO = 0.1
MAX_BACKFILL_SLUGS = 50

_SIGNAL_MODELS = (
    Favorite,
    Rating,
    WatchProgress,
    Watchlist,
    RecommendationFeedback,
)

_SLUG_WEIGHTS = dict[str, dict[str, float]]


@dataclass
class TasteProfile:
    genre_weights: dict[str, float] = field(default_factory=dict)
    country_weights: dict[str, float] = field(default_factory=dict)
    people: set[str] = field(default_factory=set)
    excluded_genres: set[str] = field(default_factory=set)
    seen: set[str] = field(default_factory=set)
    sources: dict[str, dict[str, float]] = field(default_factory=dict)
    has_signals: bool = False


def people_set(value: str | None) -> set[str]:
    if not value:
        return set()
    names: set[str] = set()
    for chunk in value.replace(";", ",").split(","):
        key = "".join(ch for ch in chunk.casefold() if ch.isalnum())
        if key:
            names.add(key)
    return names


def _normalize_dt(value):
    if value is not None and value.tzinfo is None:
        return value.replace(tzinfo=UTC)
    return value


async def _signals(
    db: AsyncSession, profile_id: uuid.UUID
) -> tuple[_SLUG_WEIGHTS, set[str], set[str]]:
    """Return (slug -> {source: weight}, seen slugs, people-source slugs)."""
    signals: _SLUG_WEIGHTS = {}
    seen: set[str] = set()

    def add(slug: str, source: str, amount: float) -> None:
        per = signals.setdefault(slug, {})
        per[source] = per.get(source, 0.0) + amount

    favorites = (
        (
            await db.execute(
                select(Favorite.movie_slug).where(Favorite.profile_id == profile_id)
            )
        )
        .scalars()
        .all()
    )
    for slug in favorites:
        seen.add(slug)
        add(slug, SOURCE_FAVORITE, FAVORITE_WEIGHT)

    people_slugs = set(favorites)
    ratings = (
        await db.execute(
            select(Rating.movie_slug, Rating.stars).where(
                Rating.profile_id == profile_id
            )
        )
    ).all()
    for slug, stars in ratings:
        seen.add(slug)
        if stars >= LOVED_MIN_STARS:
            add(slug, SOURCE_RATING, LOVED_RATING_WEIGHT)
            people_slugs.add(slug)
        elif stars <= DISLIKED_MAX_STARS:
            add(slug, SOURCE_RATING, DISLIKED_RATING_WEIGHT)

    books = (
        (
            await db.execute(
                select(Watchlist.movie_slug).where(Watchlist.profile_id == profile_id)
            )
        )
        .scalars()
        .all()
    )
    for slug in books:
        seen.add(slug)
        add(slug, SOURCE_WATCHLIST, WATCHLIST_WEIGHT)

    progress = (
        await db.execute(
            select(
                WatchProgress.movie_slug,
                WatchProgress.position_seconds,
                WatchProgress.duration_seconds,
            ).where(WatchProgress.profile_id == profile_id)
        )
    ).all()
    best_ratio: dict[str, float] = {}
    for slug, position, duration in progress:
        seen.add(slug)
        if duration and duration > 0:
            ratio = position / duration
            best_ratio[slug] = max(best_ratio.get(slug, 0.0), ratio)
    for slug, ratio in best_ratio.items():
        if ratio >= FINISHED_RATIO:
            add(slug, SOURCE_FINISHED, FINISHED_WEIGHT)
        elif ratio >= IN_PROGRESS_RATIO:
            add(slug, SOURCE_IN_PROGRESS, IN_PROGRESS_WEIGHT)

    feedback = (
        await db.execute(
            select(
                RecommendationFeedback.movie_slug, RecommendationFeedback.kind
            ).where(RecommendationFeedback.profile_id == profile_id)
        )
    ).all()
    for slug, kind in feedback:
        seen.add(slug)
        if kind == INTERESTED:
            add(slug, SOURCE_FEEDBACK, FEEDBACK_INTERESTED_WEIGHT)
            people_slugs.add(slug)
        else:
            add(slug, SOURCE_FEEDBACK, FEEDBACK_NOT_INTERESTED_WEIGHT)

    return signals, seen, people_slugs


async def has_signals(db: AsyncSession, profile_id: uuid.UUID) -> bool:
    for model in _SIGNAL_MODELS:
        found = (
            await db.execute(
                select(model.id).where(model.profile_id == profile_id).limit(1)
            )
        ).first()
        if found is not None:
            return True
    return False


async def signals_version(db: AsyncSession, profile_id: uuid.UUID) -> str:
    """Compact fingerprint of the signal tables for the recommendation cache."""
    parts: list[str] = []
    for model in _SIGNAL_MODELS:
        count, latest = (
            await db.execute(
                select(func.count(), func.max(model.updated_at)).where(
                    model.profile_id == profile_id
                )
            )
        ).one()
        latest = _normalize_dt(latest)
        stamp = int(latest.timestamp()) if latest is not None else 0
        parts.append(f"{count}:{stamp}")
    return "-".join(parts)


async def taste_profile(
    db: AsyncSession,
    profile_id: uuid.UUID,
    prefs: ProfilePreference | None,
) -> TasteProfile:
    explicit_genres = dict(prefs.genres or {}) if prefs else {}
    explicit_countries = dict(prefs.countries or {}) if prefs else {}
    excluded = set(prefs.excluded_genres or []) if prefs else set()

    signals, seen, people_slugs = await _signals(db, profile_id)
    items = await catalog_service.ensure_metadata(
        db, list(signals), limit=MAX_BACKFILL_SLUGS
    )
    by_slug = {item.slug: item for item in items}

    weights: dict[str, float] = {}
    sources: dict[str, dict[str, float]] = {}

    def add_genre(genre: str, source: str, amount: float) -> None:
        per = sources.setdefault(genre, {})
        per[source] = per.get(source, 0.0) + amount
        weights[genre] = weights.get(genre, 0.0) + amount

    for genre, amount in explicit_genres.items():
        add_genre(genre, SOURCE_EXPLICIT, amount)

    for slug, per_source in signals.items():
        item = by_slug.get(slug)
        if item is None:
            continue
        for genre in item.genres or []:
            for source, amount in per_source.items():
                add_genre(genre, source, amount)

    for genre in list(weights):
        if genre in excluded:
            weights.pop(genre)
            sources.pop(genre, None)
            continue
        weights[genre] = max(-GENRE_CAP, min(GENRE_CAP, weights[genre]))

    people: set[str] = set()
    for item in await catalog_service.by_slugs(db, list(people_slugs)):
        people |= people_set(item.casts)
        people |= people_set(item.director)

    return TasteProfile(
        genre_weights=weights,
        country_weights=explicit_countries,
        people=people,
        excluded_genres=excluded,
        seen=seen,
        sources=sources,
        has_signals=bool(seen),
    )
