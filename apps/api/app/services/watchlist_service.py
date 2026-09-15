"""Watchlist persistence operations."""

import uuid

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.watchlist import Watchlist
from app.schemas.library import WatchlistAdd


async def add(
    db: AsyncSession, user_id: uuid.UUID, data: WatchlistAdd
) -> tuple[Watchlist, bool]:
    stmt = select(Watchlist).where(
        Watchlist.user_id == user_id, Watchlist.movie_slug == data.movie_slug
    )
    existing = (await db.execute(stmt)).scalar_one_or_none()
    if existing is not None:
        return existing, False
    row = Watchlist(user_id=user_id, **data.model_dump())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row, True


async def remove(db: AsyncSession, user_id: uuid.UUID, movie_slug: str) -> None:
    await db.execute(
        delete(Watchlist).where(
            Watchlist.user_id == user_id, Watchlist.movie_slug == movie_slug
        )
    )
    await db.commit()


async def is_saved(
    db: AsyncSession, user_id: uuid.UUID, movie_slug: str
) -> bool:
    stmt = select(Watchlist.id).where(
        Watchlist.user_id == user_id, Watchlist.movie_slug == movie_slug
    )
    return (await db.execute(stmt)).scalar_one_or_none() is not None


async def list_paginated(
    db: AsyncSession, user_id: uuid.UUID, page: int, per_page: int
) -> tuple[list[Watchlist], int]:
    total = (
        (
            await db.execute(
                select(func.count())
                .select_from(Watchlist)
                .where(Watchlist.user_id == user_id)
            )
        ).scalar_one()
    )
    stmt = (
        select(Watchlist)
        .where(Watchlist.user_id == user_id)
        .order_by(Watchlist.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return list(rows), total
