"""User persistence operations (used by services, not routers)."""

import uuid

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.db.models.user import User
from app.schemas.auth import RegisterIn


async def get_by_id(db: AsyncSession, user_id: uuid.UUID) -> User | None:
    return await db.get(User, user_id)


async def get_by_login(db: AsyncSession, login: str) -> User | None:
    """Find by email or username (login form accepts either)."""
    stmt = select(User).where(
        or_(User.email == login.lower(), User.username == login)
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def email_exists(db: AsyncSession, email: str) -> bool:
    stmt = select(User.id).where(User.email == email.lower())
    return (await db.execute(stmt)).scalar_one_or_none() is not None


async def username_exists(db: AsyncSession, username: str) -> bool:
    stmt = select(User.id).where(User.username == username)
    return (await db.execute(stmt)).scalar_one_or_none() is not None


async def create(db: AsyncSession, data: RegisterIn) -> User:
    user = User(
        email=data.email.lower(),
        username=data.username,
        hashed_password=hash_password(data.password),
        display_name=data.username,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user


async def update_profile(
    db: AsyncSession,
    user: User,
    display_name: str | None,
    avatar_url: str | None,
) -> User:
    if display_name is not None:
        user.display_name = display_name
    if avatar_url is not None:
        user.avatar_url = avatar_url or None
    await db.commit()
    await db.refresh(user)
    return user
