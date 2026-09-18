"""Per-profile explicit taste weights (onboarding quiz + poster likes).

Explicit weights live in `profile_preferences`; derived behaviour weights are
computed on read in `taste_service` and never persisted, so resetting onboarding
cannot lose them.
"""

import uuid
from collections.abc import Sequence
from datetime import UTC, datetime

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.profile_preference import ProfilePreference
from app.schemas.preference import PreferencesIn
from app.services import catalog_service

POSTER_WEIGHT = 0.5
GENRE_CAP = 3.0


async def get_or_none(
    db: AsyncSession, profile_id: uuid.UUID
) -> ProfilePreference | None:
    stmt = select(ProfilePreference).where(ProfilePreference.profile_id == profile_id)
    return (await db.execute(stmt)).scalar_one_or_none()


async def _get_or_create(db: AsyncSession, profile_id: uuid.UUID) -> ProfilePreference:
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
    row.excluded_genres = list(data.excluded_genres)
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
            genres[genre] = min(GENRE_CAP, genres.get(genre, 0.0) + POSTER_WEIGHT)
    row.genres = genres
    await db.commit()
    await db.refresh(row)
    return row


async def reset(db: AsyncSession, profile_id: uuid.UUID) -> None:
    await db.execute(
        delete(ProfilePreference).where(ProfilePreference.profile_id == profile_id)
    )
    await db.commit()
