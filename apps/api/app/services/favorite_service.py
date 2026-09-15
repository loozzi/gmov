"""Favorite persistence operations."""

import uuid

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.favorite import Favorite
from app.schemas.library import FavoriteAdd


async def add(
    db: AsyncSession, user_id: uuid.UUID, data: FavoriteAdd
) -> tuple[Favorite, bool]:
    stmt = select(Favorite).where(
        Favorite.user_id == user_id, Favorite.movie_slug == data.movie_slug
    )
    existing = (await db.execute(stmt)).scalar_one_or_none()
    if existing is not None:
        return existing, False
    row = Favorite(user_id=user_id, **data.model_dump())
    db.add(row)
    await db.commit()
    await db.refresh(row)
    return row, True


async def remove(db: AsyncSession, user_id: uuid.UUID, movie_slug: str) -> None:
    await db.execute(
        delete(Favorite).where(
            Favorite.user_id == user_id, Favorite.movie_slug == movie_slug
        )
    )
    await db.commit()


async def is_favorite(
    db: AsyncSession, user_id: uuid.UUID, movie_slug: str
) -> bool:
    stmt = select(Favorite.id).where(
        Favorite.user_id == user_id, Favorite.movie_slug == movie_slug
    )
    return (await db.execute(stmt)).scalar_one_or_none() is not None


async def list_paginated(
    db: AsyncSession, user_id: uuid.UUID, page: int, per_page: int
) -> tuple[list[Favorite], int]:
    total = (
        (
            await db.execute(
                select(func.count())
                .select_from(Favorite)
                .where(Favorite.user_id == user_id)
            )
        ).scalar_one()
    )
    stmt = (
        select(Favorite)
        .where(Favorite.user_id == user_id)
        .order_by(Favorite.created_at.desc())
        .offset((page - 1) * per_page)
        .limit(per_page)
    )
    rows = (await db.execute(stmt)).scalars().all()
    return list(rows), total
