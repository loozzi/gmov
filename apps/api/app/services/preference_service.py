"""Per-profile explicit taste weights + behaviour signals.

Explicit weights (quiz + poster likes) live in `profile_preferences`.
Behaviour weights (favorite/rating/watch progress) are derived from the
per-profile library tables at call time and never persisted, so resetting
onboarding cannot lose them.
"""

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.favorite import Favorite
from app.db.models.profile_preference import ProfilePreference
from app.db.models.rating import Rating
from app.db.models.watch_progress import WatchProgress
from app.db.models.watchlist import Watchlist
from app.schemas.preference import PreferencesIn
from app.services import catalog_service

POSTER_WEIGHT = 0.5
GENRE_CAP = 3.0
FAVORITE_WEIGHT = 1.0
LOVED_RATING_WEIGHT = 1.5
FINISHED_WEIGHT = 0.5
DISLIKED_RATING_WEIGHT = -1.5
LOVED_MIN_STARS = 8
DISLIKED_MAX_STARS = 4
FINISHED_RATIO = 0.9


async def get_or_none(
    db: AsyncSession, profile_id: uuid.UUID
) -> ProfilePreference | None:
    stmt = select(ProfilePreference).where(
        ProfilePreference.profile_id == profile_id
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def _get_or_create(
    db: AsyncSession, profile_id: uuid.UUID
) -> ProfilePreference:
    row = await get_or_none(db, profile_id)
    if row is None:
        row = ProfilePreference(profile_id=profile_id)
        db.add(row)
    return row


async def upsert_quiz(
    db: AsyncSession, profile_id: uuid.UUID, data: PreferencesIn
) -> ProfilePreference:
    row = await _get_or_create(db, profile_id)
    row.genres = dict(data.genres)
    row.countries = dict(data.countries)
    row.skipped = data.skipped
    row.onboarding_completed_at = datetime.now(UTC)
    await db.commit()
    await db.refresh(row)
    return row


async def add_poster_weights(
    db: AsyncSession, profile_id: uuid.UUID, liked: Sequence[str]
) -> ProfilePreference:
    row = await _get_or_create(db, profile_id)
    genres = dict(row.genres or {})
    items = await catalog_service.by_slugs(db, liked)
    for item in items:
        for genre in item.genres or []:
            genres[genre] = min(
                GENRE_CAP, genres.get(genre, 0.0) + POSTER_WEIGHT
            )
    row.genres = genres
    await db.commit()
    await db.refresh(row)
    return row


async def reset(db: AsyncSession, profile_id: uuid.UUID) -> None:
    await db.execute(
        delete(ProfilePreference).where(
            ProfilePreference.profile_id == profile_id
        )
    )
    await db.commit()


async def _finished_slugs(
    db: AsyncSession, profile_id: uuid.UUID
) -> list[str]:
    stmt = (
        select(WatchProgress.movie_slug)
        .where(
            WatchProgress.profile_id == profile_id,
            WatchProgress.duration_seconds.is_not(None),
            WatchProgress.duration_seconds > 0,
            WatchProgress.position_seconds
            >= FINISHED_RATIO * WatchProgress.duration_seconds,
        )
        .distinct()
    )
    return list((await db.execute(stmt)).scalars().all())


async def behavior_weights(
    db: AsyncSession, profile_id: uuid.UUID
) -> tuple[dict[str, float], set[str]]:
    signals: dict[str, float] = {}
    seen: set[str] = set()

    favorites = (
        await db.execute(
            select(Favorite.movie_slug).where(
                Favorite.profile_id == profile_id
            )
        )
    ).scalars().all()
    for slug in favorites:
        seen.add(slug)
        signals[slug] = signals.get(slug, 0.0) + FAVORITE_WEIGHT

    ratings = (
        await db.execute(
            select(Rating.movie_slug, Rating.stars).where(
                Rating.profile_id == profile_id
            )
        )
    ).all()
    for slug, stars in ratings:
        if stars >= LOVED_MIN_STARS:
            signals[slug] = signals.get(slug, 0.0) + LOVED_RATING_WEIGHT
        elif stars <= DISLIKED_MAX_STARS:
            signals[slug] = signals.get(slug, 0.0) + DISLIKED_RATING_WEIGHT

    books = (
        await db.execute(
            select(Watchlist.movie_slug).where(
                Watchlist.profile_id == profile_id
            )
        )
    ).scalars().all()
    seen.update(books)

    for slug in await _finished_slugs(db, profile_id):
        seen.add(slug)
        signals[slug] = signals.get(slug, 0.0) + FINISHED_WEIGHT

    items = await catalog_service.by_slugs(db, list(signals))
    genres_by_slug = {item.slug: item.genres or [] for item in items}
    weights: dict[str, float] = {}
    for slug, amount in signals.items():
        for genre in genres_by_slug.get(slug, []):
            weights[genre] = weights.get(genre, 0.0) + amount
    return weights, seen
