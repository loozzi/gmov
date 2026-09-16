"""Star-rating persistence operations."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.rating import Rating
from app.schemas.library import RatingUpsert


async def upsert(
    db: AsyncSession, user_id: uuid.UUID, data: RatingUpsert
) -> Rating:
    stmt = select(Rating).where(
        Rating.user_id == user_id, Rating.movie_slug == data.movie_slug
    )
    row = (await db.execute(stmt)).scalar_one_or_none()
    now = datetime.now(UTC)
    if row is None:
        row = Rating(
            user_id=user_id,
            movie_slug=data.movie_slug,
            stars=data.stars,
        )
        db.add(row)
    else:
        row.stars = data.stars
        row.updated_at = now
    await db.commit()
    await db.refresh(row)
    return row


async def remove(db: AsyncSession, user_id: uuid.UUID, movie_slug: str) -> None:
    await db.execute(
        delete(Rating).where(
            Rating.user_id == user_id, Rating.movie_slug == movie_slug
        )
    )
    await db.commit()


async def get_stars(
    db: AsyncSession, user_id: uuid.UUID, movie_slug: str
) -> int | None:
    stmt = select(Rating.stars).where(
        Rating.user_id == user_id, Rating.movie_slug == movie_slug
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def summary(db: AsyncSession, movie_slug: str) -> tuple[float | None, int]:
    stmt = select(func.avg(Rating.stars), func.count()).where(
        Rating.movie_slug == movie_slug
    )
    avg_val, count = (await db.execute(stmt)).one()
    if not count:
        return None, 0
    return round(float(avg_val), 1), int(count)
