"""Profile business logic: CRUD bounded by the per-account limit."""

import uuid
from typing import TYPE_CHECKING

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import ratelimit, security
from app.core.config import settings
from app.core.exceptions import AppException
from app.db.models.profile import FALLBACK_AVATAR, Profile
from app.db.models.refresh_token import RefreshToken
from app.db.models.user import User

if TYPE_CHECKING:
    from app.core.deps import ActiveProfile

MAX_PROFILES = settings.max_profiles
PIN_MAX_ATTEMPTS = settings.pin_max_attempts
PIN_WINDOW = settings.pin_window
DEFAULT_PROFILE_NAME = "Mặc định"


async def list_for_user(db: AsyncSession, user_id: uuid.UUID) -> list[Profile]:
    stmt = (
        select(Profile)
        .where(Profile.user_id == user_id)
        .order_by(Profile.position)
    )
    return list((await db.execute(stmt)).scalars().all())


async def get_owned(
    db: AsyncSession, user_id: uuid.UUID, profile_id: uuid.UUID
) -> Profile | None:
    stmt = select(Profile).where(
        Profile.id == profile_id, Profile.user_id == user_id
    )
    return (await db.execute(stmt)).scalar_one_or_none()


async def default_for(db: AsyncSession, user_id: uuid.UUID) -> Profile:
    stmt = select(Profile).where(
        Profile.user_id == user_id, Profile.is_default.is_(True)
    )
    return (await db.execute(stmt)).scalar_one()


async def current_profile_for(
    db: AsyncSession, user: User, active: "ActiveProfile | None" = None
) -> Profile:
    """Active profile of a request: the session claim when present, else the
    account's default (old tokens issued before `pid` existed)."""
    if active is not None:
        return active.profile
    return await default_for(db, user.id)


async def _name_taken(
    db: AsyncSession, user_id: uuid.UUID, name: str
) -> bool:
    stmt = select(Profile.id).where(
        Profile.user_id == user_id,
        func.lower(Profile.name) == name.lower(),
    )
    return (await db.execute(stmt)).scalar_one_or_none() is not None


async def create(
    db: AsyncSession, user: User, name: str, avatar: str
) -> Profile:
    cleaned = name.strip()
    if await _name_taken(db, user.id, cleaned):
        raise AppException("Profile name already taken", "PROFILE_NAME_TAKEN", 409)
    profiles = await list_for_user(db, user.id)
    if len(profiles) >= MAX_PROFILES:
        raise AppException("Profile limit reached", "PROFILE_LIMIT_REACHED", 409)
    used = {profile.position for profile in profiles}
    position = next(
        slot for slot in range(MAX_PROFILES) if slot not in used
    )
    profile = Profile(
        user_id=user.id,
        name=cleaned,
        avatar=avatar or FALLBACK_AVATAR,
        position=position,
    )
    db.add(profile)
    await db.commit()
    await db.refresh(profile)
    return profile


async def rename(
    db: AsyncSession,
    profile: Profile,
    name: str | None,
    avatar: str | None,
) -> Profile:
    if name is not None:
        cleaned = name.strip()
        stmt = select(Profile.id).where(
            Profile.user_id == profile.user_id,
            Profile.id != profile.id,
            func.lower(Profile.name) == cleaned.lower(),
        )
        if (await db.execute(stmt)).scalar_one_or_none() is not None:
            raise AppException(
                "Profile name already taken", "PROFILE_NAME_TAKEN", 409
            )
        profile.name = cleaned
    if avatar is not None:
        profile.avatar = avatar
    await db.commit()
    await db.refresh(profile)
    return profile


async def set_pin_hash(
    db: AsyncSession, profile: Profile, pin_hash: str | None
) -> Profile:
    profile.pin_hash = pin_hash
    await db.commit()
    await db.refresh(profile)
    return profile


async def _record_pin_failure(profile_id: uuid.UUID, ip: str) -> None:
    await ratelimit.record_pin_failure(profile_id, ip, PIN_WINDOW)


async def verify_pin(
    db: AsyncSession, profile: Profile, pin: str | None, ip: str = "unknown"
) -> None:
    """No-op for unlocked profiles; otherwise demand the profile PIN. Only
    failed attempts (wrong or missing) consume the shared counter, and an
    exhausted budget returns 429 before any PIN comparison."""
    if profile.pin_hash is None:
        return
    await ratelimit.check_pin_attempt_allowed(
        profile.id, ip, PIN_MAX_ATTEMPTS, PIN_WINDOW
    )
    if not pin:
        await _record_pin_failure(profile.id, ip)
        raise AppException("PIN required", "PIN_REQUIRED", 403)
    if not security.verify_password(pin, profile.pin_hash):
        await _record_pin_failure(profile.id, ip)
        raise AppException("Invalid PIN", "INVALID_PIN", 401)


async def set_pin(
    db: AsyncSession, profile: Profile, password: str, pin: str | None
) -> Profile:
    """Set, change or clear a PIN, gated by the owning account's password."""
    user = await db.get(User, profile.user_id)
    if user is None or not security.verify_password(password, user.hashed_password):
        raise AppException("Invalid password", "INVALID_PASSWORD", 400)
    profile.pin_hash = security.hash_password(pin) if pin is not None else None
    await db.commit()
    await db.refresh(profile)
    return profile


async def activate_session(
    db: AsyncSession, session_jti: str, profile_id: uuid.UUID
) -> None:
    """Point the refresh session at the profile it now operates as."""
    stmt = select(RefreshToken).where(RefreshToken.jti == session_jti)
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is None:
        raise AppException("Session outdated", "SESSION_STALE", 401)
    row.profile_id = profile_id
    await db.commit()


async def delete(db: AsyncSession, profile: Profile) -> None:
    """Hard delete; the profile's rows cascade via their FK."""
    await db.delete(profile)
    await db.commit()
