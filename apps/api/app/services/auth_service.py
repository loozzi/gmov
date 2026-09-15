"""Auth business logic: register, login, refresh rotation, logout."""

from datetime import datetime, timedelta, timezone

import jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import security
from app.core.config import settings
from app.core.exceptions import AppException
from app.db.models.refresh_token import RefreshToken
from app.db.models.user import User
from app.schemas.auth import RegisterIn, TokenPair
from app.services import user_service


async def _store_refresh(
    db: AsyncSession, user_id: object, jti: str
) -> None:
    expires_at = datetime.now(timezone.utc) + timedelta(
        days=settings.refresh_token_expire_days
    )
    db.add(RefreshToken(user_id=user_id, jti=jti, expires_at=expires_at))
    await db.commit()


async def _issue_pair(db: AsyncSession, user: User) -> TokenPair:
    access = security.create_access_token(user.id)
    refresh, jti = security.create_refresh_token(user.id)
    await _store_refresh(db, user.id, jti)
    return TokenPair(access_token=access, refresh_token=refresh)


async def register(db: AsyncSession, data: RegisterIn) -> User:
    if await user_service.email_exists(db, str(data.email)):
        raise AppException("Email already registered", "EMAIL_TAKEN", 409)
    if await user_service.username_exists(db, data.username):
        raise AppException("Username already taken", "USERNAME_TAKEN", 409)
    return await user_service.create(db, data)


async def login(db: AsyncSession, login: str, password: str) -> TokenPair:
    user = await user_service.get_by_login(db, login)
    if user is None or not security.verify_password(password, user.hashed_password):
        raise AppException("Invalid credentials", "INVALID_CREDENTIALS", 401)
    if not user.is_active:
        raise AppException("Account is disabled", "ACCOUNT_DISABLED", 403)
    return await _issue_pair(db, user)


def _decode_refresh(token: str) -> dict:
    try:
        payload = security.decode_token(token)
    except jwt.ExpiredSignatureError:
        raise AppException("Refresh token expired", "INVALID_REFRESH_TOKEN", 401)
    except jwt.PyJWTError:
        raise AppException("Invalid refresh token", "INVALID_REFRESH_TOKEN", 401)
    if payload.get("type") != security.REFRESH_TOKEN_TYPE:
        raise AppException("Invalid refresh token", "INVALID_REFRESH_TOKEN", 401)
    return payload


async def _load_valid_refresh(db: AsyncSession, jti: str) -> RefreshToken:
    stmt = select(RefreshToken).where(RefreshToken.jti == jti)
    row = (await db.execute(stmt)).scalar_one_or_none()
    now = datetime.now(timezone.utc)
    expires_at = row.expires_at if row is None else _as_aware(row.expires_at)
    if row is None or row.revoked_at is not None or expires_at <= now:
        raise AppException("Invalid refresh token", "INVALID_REFRESH_TOKEN", 401)
    return row


def _as_aware(value: datetime) -> datetime:
    # SQLite returns naive datetimes; Postgres (tz-aware) returns aware ones.
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


async def refresh(db: AsyncSession, token: str) -> TokenPair:
    payload = _decode_refresh(token)
    row = await _load_valid_refresh(db, str(payload["jti"]))
    row.revoked_at = datetime.now(timezone.utc)  # rotate: revoke old
    user = await user_service.get_by_id(db, row.user_id)
    if user is None or not user.is_active:
        await db.commit()
        raise AppException("Invalid refresh token", "INVALID_REFRESH_TOKEN", 401)
    await db.commit()
    return await _issue_pair(db, user)


async def logout(db: AsyncSession, token: str) -> None:
    """Revoke a refresh token. Idempotent: unknown tokens still return 200."""
    try:
        payload = security.decode_token(token)
    except jwt.PyJWTError:
        return
    jti = payload.get("jti")
    if not jti:
        return
    stmt = select(RefreshToken).where(RefreshToken.jti == str(jti))
    row = (await db.execute(stmt)).scalar_one_or_none()
    if row is not None and row.revoked_at is None:
        row.revoked_at = datetime.now(timezone.utc)
        await db.commit()
