"""Shared FastAPI dependencies."""

import uuid
from collections.abc import Awaitable, Callable

import jwt
from fastapi import Depends
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import security
from app.core.exceptions import AppException
from app.db.models.user import User, UserRole
from app.db.session import get_db
from app.services import user_service

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")
oauth2_optional = OAuth2PasswordBearer(
    tokenUrl="/api/v1/auth/login", auto_error=False
)


async def get_current_user(
    token: str = Depends(oauth2_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    try:
        payload = security.decode_token(token)
    except jwt.ExpiredSignatureError:
        raise AppException("Token expired", "UNAUTHORIZED", 401)
    except jwt.PyJWTError:
        raise AppException("Invalid token", "UNAUTHORIZED", 401)
    if payload.get("type") != security.ACCESS_TOKEN_TYPE:
        raise AppException("Invalid token", "UNAUTHORIZED", 401)
    try:
        user_id = uuid.UUID(str(payload.get("sub")))
    except (ValueError, TypeError):
        raise AppException("Invalid token", "UNAUTHORIZED", 401)
    user = await user_service.get_by_id(db, user_id)
    if user is None or not user.is_active:
        raise AppException("Invalid token", "UNAUTHORIZED", 401)
    return user


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
        payload = security.decode_token(token)
    except jwt.PyJWTError:
        return None
    if payload.get("type") != security.ACCESS_TOKEN_TYPE:
        return None
    try:
        user_id = uuid.UUID(str(payload.get("sub")))
    except (ValueError, TypeError):
        return None
    user = await user_service.get_by_id(db, user_id)
    if user is None or not user.is_active:
        return None
    return user


def require_role(*roles: UserRole) -> Callable[..., Awaitable[User]]:
    """Build a dependency that admits only the given roles."""

    async def dependency(
        current: User = Depends(get_current_user),
    ) -> User:
        if current.role not in roles:
            raise AppException("Insufficient permissions", "FORBIDDEN", 403)
        return current

    return dependency
