"""Shared FastAPI dependencies."""

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

import jwt
from fastapi import Depends
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import security
from app.core.exceptions import AppException
from app.db.models.profile import Profile
from app.db.models.user import User, UserRole
from app.db.session import get_db
from app.services import profile_service, user_service

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")
oauth2_optional = OAuth2PasswordBearer(
    tokenUrl="/api/v1/auth/login", auto_error=False
)


@dataclass(frozen=True)
class ActiveProfile:
    user: User
    profile: Profile
    session_jti: str | None


def _decode_access(token: str) -> dict:
    try:
        payload = security.decode_token(token)
    except jwt.ExpiredSignatureError:
        raise AppException("Token expired", "UNAUTHORIZED", 401)
    except jwt.PyJWTError:
        raise AppException("Invalid token", "UNAUTHORIZED", 401)
    if payload.get("type") != security.ACCESS_TOKEN_TYPE:
        raise AppException("Invalid token", "UNAUTHORIZED", 401)
    return payload


async def _load_active_user(db: AsyncSession, payload: dict) -> User:
    try:
        user_id = uuid.UUID(str(payload.get("sub")))
    except (ValueError, TypeError):
        raise AppException("Invalid token", "UNAUTHORIZED", 401)
    user = await user_service.get_by_id(db, user_id)
    if user is None or not user.is_active:
        raise AppException("Invalid token", "UNAUTHORIZED", 401)
    if user.banned_at is not None:
        raise AppException("Account banned", "ACCOUNT_BANNED", 401)
    return user


async def _resolve_user(db: AsyncSession, token: str) -> User:
    payload = _decode_access(token)
    return await _load_active_user(db, payload)


async def _profile_from_claims(
    db: AsyncSession, user: User, payload: dict
) -> Profile:
    raw = payload.get("pid")
    if raw is None:
        return await profile_service.default_for(db, user.id)
    try:
        profile_id = uuid.UUID(str(raw))
    except (ValueError, TypeError):
        raise AppException("Profile not found", "PROFILE_NOT_FOUND", 404)
    profile = await profile_service.get_owned(db, user.id, profile_id)
    if profile is None:
        raise AppException("Profile not found", "PROFILE_NOT_FOUND", 404)
    return profile


async def get_active_profile(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> ActiveProfile:
    payload = _decode_access(token)
    user = await _load_active_user(db, payload)
    profile = await _profile_from_claims(db, user, payload)
    return ActiveProfile(
        user=user, profile=profile, session_jti=payload.get("sid")
    )


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    return await _resolve_user(db, token)


async def get_optional_user(
    token: str | None = Depends(oauth2_optional),
    db: AsyncSession = Depends(get_db),
) -> User | None:
    """Resolve an access token to a user, or None on any failure.

    Used by public endpoints that widen behaviour when a moderator is
    signed in. Never raises: missing, malformed, expired, wrong-type, or
    unknown/inactive-user tokens all degrade to anonymous.
    """
    if not token:
        return None
    try:
        return await _resolve_user(db, token)
    except AppException:
        return None


def require_role(*roles: UserRole) -> Callable[..., Awaitable[User]]:
    """Build a dependency that admits only the given roles."""

    async def dependency(
        current: User = Depends(get_current_user),
    ) -> User:
        if current.role not in roles:
            raise AppException("Insufficient permissions", "FORBIDDEN", 403)
        return current

    return dependency
