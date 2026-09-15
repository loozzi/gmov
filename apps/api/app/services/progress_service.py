"""Watch-progress persistence (also serves as watch history)."""

import uuid
from datetime import UTC, datetime

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import AppException
from app.db.models.watch_progress import WatchProgress
from app.schemas.library import ProgressUpsert


async def upsert(
    db: AsyncSession, user_id: uuid.UUID, data: ProgressUpsert
) -> WatchProgress:
    stmt = select(WatchProgress).where(
        WatchProgress.user_id == user_id,
        WatchProgress.movie_slug == data.movie_slug,
        WatchProgress.episode_slug == data.episode_slug,
    )
    row = (await db.execute(stmt)).scalar_one_or_none()
    now = datetime.now(UTC)
    if row is None:
        row = WatchProgress(
            user_id=user_id, **data.model_dump(), updated_at=now
        )
        db.add(row)
    else:
        for field, value in data.model_dump().items():
            setattr(row, field, value)
        row.updated_at = now
    await db.commit()
    await db.refresh(row)
    return row


async def _latest_per_movie_stmt(user_id: uuid.UUID):
    # ROW_NUMBER keeps exactly one row per movie (ties broken by id, latest wins).
    ranked = (
        select(
            WatchProgress.id,
            func.row_number()
            .over(
                partition_by=WatchProgress.movie_slug,
                order_by=(WatchProgress.updated_at.desc(), WatchProgress.id.desc()),
            )
            .label("rn"),
        )
        .where(WatchProgress.user_id == user_id)
        .subquery()
    )
    return (
        select(WatchProgress)
        .join(ranked, WatchProgress.id == ranked.c.id)
        .where(ranked.c.rn == 1)
        .order_by(WatchProgress.updated_at.desc(), WatchProgress.id.desc())
    )


async def continue_watching(
    db: AsyncSession, user_id: uuid.UUID, page: int, per_page: int
) -> tuple[list[WatchProgress], int]:
    count_stmt = select(func.count(func.distinct(WatchProgress.movie_slug))).where(
        WatchProgress.user_id == user_id
    )
    total = (await db.execute(count_stmt)).scalar_one()
    stmt = await _latest_per_movie_stmt(user_id)
    rows = (
        (await db.execute(stmt.offset((page - 1) * per_page).limit(per_page)))
        .scalars()
        .all()
    )
    return list(rows), total


async def get_for_movie(
    db: AsyncSession, user_id: uuid.UUID, movie_slug: str
) -> WatchProgress:
    stmt = (
        select(WatchProgress)
        .where(
            WatchProgress.user_id == user_id,
            WatchProgress.movie_slug == movie_slug,
        )
        .order_by(WatchProgress.updated_at.desc())
        .limit(1)
    )
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is None:
        raise AppException("No progress for this movie", "PROGRESS_NOT_FOUND", 404)
    return row


async def delete_for_movie(
    db: AsyncSession, user_id: uuid.UUID, movie_slug: str
) -> None:
    await db.execute(
        delete(WatchProgress).where(
            WatchProgress.user_id == user_id,
            WatchProgress.movie_slug == movie_slug,
        )
    )
    await db.commit()


async def watched_episodes(
    db: AsyncSession, user_id: uuid.UUID, movie_slug: str
) -> list[str]:
    """Episode slugs watched >= 90% of known duration."""
    stmt = select(WatchProgress.episode_slug).where(
        WatchProgress.user_id == user_id,
        WatchProgress.movie_slug == movie_slug,
        WatchProgress.duration_seconds.is_not(None),
        WatchProgress.duration_seconds > 0,
        WatchProgress.position_seconds >= 0.9 * WatchProgress.duration_seconds,
    )
    return list((await db.execute(stmt)).scalars().all())


async def mark_watched(
    db: AsyncSession,
    user_id: uuid.UUID,
    movie_slug: str,
    movie_name: str,
    episode_slug: str,
    episode_name: str,
    poster_url: str | None = None,
    server_name: str | None = None,
) -> WatchProgress:
    """Explicit watched marker (e.g. embed player without time access).

    Stored as a completed progress row (position == duration).
    """
    from app.schemas.library import ProgressUpsert

    return await upsert(
        db,
        user_id,
        ProgressUpsert(
            movie_slug=movie_slug,
            movie_name=movie_name,
            poster_url=poster_url,
            episode_slug=episode_slug,
            episode_name=episode_name,
            server_name=server_name,
            position_seconds=1,
            duration_seconds=1,
        ),
    )
