"""Per-profile thumbs feedback on recommended movies."""

import uuid

from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.recommendation_feedback import RecommendationFeedback

MAX_FEEDBACK_ROWS = 100


async def upsert(
    db: AsyncSession, profile_id: uuid.UUID, movie_slug: str, kind: str
) -> RecommendationFeedback:
    row = (
        await db.execute(
            select(RecommendationFeedback).where(
                RecommendationFeedback.profile_id == profile_id,
                RecommendationFeedback.movie_slug == movie_slug,
            )
        )
    ).scalar_one_or_none()
    if row is None:
        row = RecommendationFeedback(
            profile_id=profile_id, movie_slug=movie_slug, kind=kind
        )
        db.add(row)
    else:
        row.kind = kind
    await db.commit()
    await db.refresh(row)
    return row


async def remove(db: AsyncSession, profile_id: uuid.UUID, movie_slug: str) -> bool:
    result = await db.execute(
        delete(RecommendationFeedback).where(
            RecommendationFeedback.profile_id == profile_id,
            RecommendationFeedback.movie_slug == movie_slug,
        )
    )
    await db.commit()
    return bool(result.rowcount)


async def list_for_profile(
    db: AsyncSession, profile_id: uuid.UUID, limit: int = MAX_FEEDBACK_ROWS
) -> list[RecommendationFeedback]:
    stmt = (
        select(RecommendationFeedback)
        .where(RecommendationFeedback.profile_id == profile_id)
        .order_by(RecommendationFeedback.updated_at.desc())
        .limit(limit)
    )
    return list((await db.execute(stmt)).scalars().all())
